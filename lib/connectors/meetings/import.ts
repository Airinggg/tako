import { chmodSync, closeSync, constants, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { evaluate } from "../../govern/policy.ts";
import { formatSyncLogLines, hashContent } from "../../govern/sync-log.ts";
import { writePrivateFileAtomic } from "../../util/private-file.ts";
import {
  claimPackage,
  finishPackage,
  listReadyPackages,
  quarantinePackage,
  validateClaimedPackage,
  type MeetingInboxConfig,
  type SafeReason,
} from "./inbox.ts";
import { renderMeetingEvidence } from "./render.ts";
import {
  classifyMeetingImport,
  loadMeetingImportState,
  saveMeetingImportState,
  type MeetingImportRecord,
} from "./state.ts";

export type MeetingImportReceipt = {
  schemaVersion: "1.0";
  meetingId: string | null;
  packageDigest: string | null;
  workspaceId: string | null;
  sourceId: string | null;
  status: "processed" | "no-op" | "quarantined";
  reason: string;
  recordedAt: string;
};

export type MeetingImportOptions = {
  sourceRoot: string;
  statePath: string;
  receiptsPath: string;
  syncLogPath: string;
  analysisQueuePath: string;
  now?: () => string;
};

export type MeetingImportSummary = { processed: number; noOp: number; quarantined: number; queued: number };

function appendPrivate(path: string, line: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY, 0o600);
  try {
    writeFileSync(fd, line, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(path, 0o600);
}

type AnalysisQueue = { schemaVersion: "1.0"; items: Array<{ meetingId: string; packageDigest: string; transcriptDigest: string; sourceId: string; status: "pending"; queuedAt: string }> };

function loadQueue(path: string): AnalysisQueue {
  if (!existsSync(path)) return { schemaVersion: "1.0", items: [] };
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (value?.schemaVersion !== "1.0" || !Array.isArray(value.items)) throw new Error("invalid");
    return value;
  } catch {
    throw new Error("meeting_analysis_queue_invalid");
  }
}

function saveQueue(path: string, queue: AnalysisQueue): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writePrivateFileAtomic(path, `${JSON.stringify(queue, null, 2)}\n`);
}

function receipt(options: MeetingImportOptions, value: MeetingImportReceipt): void {
  appendPrivate(options.receiptsPath, `${JSON.stringify(value)}\n`);
}

function safeReason(error: unknown): SafeReason {
  const message = error instanceof Error ? error.message : "";
  if (/permission|owner/.test(message)) return "invalid-permissions";
  if (/too_large/.test(message)) return "package-too-large";
  if (/unexpected|missing_file|invalid_type/.test(message)) return "unexpected-file";
  if (/manifest/.test(message)) return "invalid-manifest";
  if (/transcript/.test(message)) return "invalid-transcript";
  if (/workspace/.test(message)) return "unknown-workspace";
  if (/classification/.test(message)) return "classification-denied";
  return "invalid-filesystem-object";
}

/** Import every complete package currently visible in `ready`, without syncing or delivering externally. */
export async function importReadyMeetings(config: MeetingInboxConfig, options: MeetingImportOptions): Promise<MeetingImportSummary> {
  const summary: MeetingImportSummary = { processed: 0, noOp: 0, quarantined: 0, queued: 0 };
  const state = loadMeetingImportState(options.statePath);
  const now = options.now ?? (() => new Date().toISOString());

  for (const name of await listReadyPackages(config.inboxRoot)) {
    const claim = await claimPackage(config.inboxRoot, name);
    let validated: Awaited<ReturnType<typeof validateClaimedPackage>> | undefined;
    try {
      validated = await validateClaimedPackage(claim, config);
      const disposition = classifyMeetingImport(state, validated.manifest.meeting.id, validated.packageDigest, validated.transcriptDigest);
      if (disposition === "conflict" || disposition === "possible-duplicate") {
        await quarantinePackage(claim, "duplicate-conflict", { meetingId: validated.manifest.meeting.id, packageDigest: validated.packageDigest });
        receipt(options, { schemaVersion: "1.0", meetingId: validated.manifest.meeting.id, packageDigest: validated.packageDigest, workspaceId: validated.manifest.meeting.workspaceId, sourceId: validated.workspace.sourceId, status: "quarantined", reason: disposition, recordedAt: now() });
        summary.quarantined += 1;
        continue;
      }
      if (disposition === "no-op") {
        rmSync(claim.path, { recursive: true });
        receipt(options, { schemaVersion: "1.0", meetingId: validated.manifest.meeting.id, packageDigest: validated.packageDigest, workspaceId: validated.manifest.meeting.workspaceId, sourceId: validated.workspace.sourceId, status: "no-op", reason: "already-processed", recordedAt: now() });
        summary.noOp += 1;
        continue;
      }

      const decision = evaluate({
        tool: {
          name: "meeting-package-read",
          inputSchemaHash: `sha256:${"0".repeat(64)}`,
          risk: "read",
          approval: "none",
          idempotency: "required",
          timeoutMs: 30_000,
          maxAttempts: 1,
          dataClassifications: ["internal"],
          enabledByDefault: false,
          verificationRequired: true,
          source: validated.workspace.sourceId,
        },
        args: { meetingId: validated.manifest.meeting.id, packageDigest: validated.packageDigest },
        scope: { name: `meeting:${validated.manifest.meeting.workspaceId}`, readSources: [validated.workspace.sourceId] },
        dataClass: "internal",
        env: "prod",
      });
      if (decision.decision !== "allow") throw new Error("meeting_policy_denied");

      const rendered = renderMeetingEvidence(validated);
      const target = join(options.sourceRoot, validated.workspace.sourceId, rendered.relativePath);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writePrivateFileAtomic(target, rendered.markdown);

      appendPrivate(options.syncLogPath, formatSyncLogLines([{
        source: "meetings",
        path: `${validated.workspace.sourceId}/${rendered.relativePath}`,
        action: "synced",
        hash: hashContent(rendered.markdown),
        syncedBy: "local-meeting-importer",
        syncedAt: now(),
      }]));
      const queue = loadQueue(options.analysisQueuePath);
      if (!queue.items.some((item) => item.meetingId === validated!.manifest.meeting.id && item.packageDigest === validated!.packageDigest)) {
        queue.items.push({ meetingId: validated.manifest.meeting.id, packageDigest: validated.packageDigest, transcriptDigest: validated.transcriptDigest, sourceId: validated.workspace.sourceId, status: "pending", queuedAt: now() });
        saveQueue(options.analysisQueuePath, queue);
        summary.queued += 1;
      }
      const record: MeetingImportRecord = { meetingId: validated.manifest.meeting.id, packageDigest: validated.packageDigest, transcriptDigest: validated.transcriptDigest, status: "processed", recordedAt: now() };
      state.records.push(record);
      saveMeetingImportState(options.statePath, state);
      receipt(options, { schemaVersion: "1.0", meetingId: record.meetingId, packageDigest: record.packageDigest, workspaceId: validated.manifest.meeting.workspaceId, sourceId: validated.workspace.sourceId, status: "processed", reason: decision.reason, recordedAt: record.recordedAt });
      await finishPackage(claim);
      summary.processed += 1;
    } catch (error) {
      if (existsSync(claim.path)) await quarantinePackage(claim, safeReason(error), { meetingId: validated?.manifest.meeting.id, packageDigest: validated?.packageDigest });
      receipt(options, { schemaVersion: "1.0", meetingId: validated?.manifest.meeting.id ?? null, packageDigest: validated?.packageDigest ?? null, workspaceId: validated?.manifest.meeting.workspaceId ?? null, sourceId: validated?.workspace.sourceId ?? null, status: "quarantined", reason: safeReason(error), recordedAt: now() });
      summary.quarantined += 1;
    }
  }
  return summary;
}
