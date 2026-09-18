import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { chmodSync, linkSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimPackage,
  ensureMeetingInbox,
  finishPackage,
  hasDuplicateJsonKeys,
  listReadyPackages,
  quarantinePackage,
  validateClaimedPackage,
  type MeetingInboxConfig,
} from "../lib/connectors/meetings/inbox.ts";
import { classifyMeetingImport, loadMeetingImportState, saveMeetingImportState } from "../lib/connectors/meetings/state.ts";

const meetingId = "mtg_018f1f0c-7b4a-7cc1-8bc2-123456789abc";
const digest = (bytes: string | Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function config(): MeetingInboxConfig {
  return {
    schemaVersion: "1.0",
    inboxRoot: realpathSync(mkdtempSync(join(tmpdir(), "tako-meeting-inbox-"))),
    processedRecoveryDays: 7,
    workspaces: [{ id: "engineering", label: "Engineering", sourceId: "engineering-meetings", classification: "internal", retentionDays: 90, enabled: true }],
  };
}

function writePackage(root: string, overrides: Record<string, unknown> = {}): string {
  const transcript = `${JSON.stringify({ schemaVersion: "1.0", id: "seg_000001", startMs: 0, endMs: 5000, text: "決定事項を確認しました。", language: "ja", partial: false })}\n`;
  const manifest: Record<string, any> = {
    schemaVersion: "1.0",
    packageType: "tako.meeting",
    meeting: { id: meetingId, title: "週次確認", workspaceId: "engineering", classification: "internal", startedAt: "2026-09-18T09:00:00+09:00", endedAt: "2026-09-18T09:30:00+09:00", timezone: "Asia/Tokyo" },
    publisher: { displayName: "佐藤 花子" },
    consent: { affirmedByPublisher: true, affirmedAt: "2026-09-18T09:35:00+09:00", statementVersion: "1.0" },
    capture: { mode: "live", transcriberVersion: "1.0.0", whisperModel: "small", whisperModelSha256: `sha256:${"a".repeat(64)}`, language: "ja", outputMode: "transcribe", completedAt: "2026-09-18T09:31:00+09:00" },
    artifacts: { transcript: { path: "transcript.jsonl", bytes: Buffer.byteLength(transcript), sha256: digest(transcript), mediaType: "application/x-ndjson" } },
    analysisRequest: { schemaVersion: "1.0", targets: ["candidate-decisions", "candidate-open-actions", "meeting-necessity-review", "follow-up-need"] },
    package: { createdAt: "2026-09-18T09:35:01+09:00", createdBy: "test", nonce: "AQIDBAUGBwgJCgsMDQ4PEA" },
    ...overrides,
  };
  const packagePath = join(root, "ready", `${meetingId}.meeting`);
  mkdirSync(packagePath, { mode: 0o700 });
  writeFileSync(join(packagePath, "transcript.jsonl"), transcript, { mode: 0o600 });
  writeFileSync(join(packagePath, "manifest.json"), `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
  return packagePath;
}

test("creates a canonical owner-only inbox and ignores incomplete or unknown entries", async () => {
  const cfg = config();
  await ensureMeetingInbox(cfg);
  for (const name of ["staging", "ready", "processing", "processed", "quarantine"]) assert.equal(lstatSync(join(cfg.inboxRoot, name)).mode & 0o777, 0o700);
  mkdirSync(join(cfg.inboxRoot, "ready", ".partial"));
  mkdirSync(join(cfg.inboxRoot, "ready", "notes"));
  writePackage(cfg.inboxRoot);
  assert.deepEqual(await listReadyPackages(cfg.inboxRoot), [`${meetingId}.meeting`]);
});

test("claims a package once and validates bytes, digests, workspace and transcript", async () => {
  const cfg = config();
  await ensureMeetingInbox(cfg);
  writePackage(cfg.inboxRoot);
  const claim = await claimPackage(cfg.inboxRoot, `${meetingId}.meeting`);
  await assert.rejects(() => claimPackage(cfg.inboxRoot, `${meetingId}.meeting`));
  const validated = await validateClaimedPackage(claim, cfg);
  assert.equal(validated.manifest.meeting.id, meetingId);
  assert.equal(validated.workspace.sourceId, "engineering-meetings");
  assert.match(validated.packageDigest, /^sha256:[0-9a-f]{64}$/);
  await finishPackage(claim);
  assert.equal(lstatSync(join(cfg.inboxRoot, "processed", `${meetingId}.meeting`)).isDirectory(), true);
});

test("rejects broad file permissions, symlinks, hard links and unexpected files", async () => {
  for (const kind of ["permissions", "symlink", "hardlink", "unexpected"] as const) {
    const cfg = config();
    await ensureMeetingInbox(cfg);
    const packagePath = writePackage(cfg.inboxRoot);
    const transcript = join(packagePath, "transcript.jsonl");
    if (kind === "permissions") chmodSync(transcript, 0o644);
    if (kind === "symlink") {
      const target = join(cfg.inboxRoot, "outside");
      writeFileSync(target, "outside", { mode: 0o600 });
      writeFileSync(transcript, "replacement", { mode: 0o600 });
      const old = `${transcript}.old`;
      // Keep an unknown old file out of the package; replace only the transcript.
      writeFileSync(old, readFileSync(transcript));
      unlinkSync(transcript);
      symlinkSync(target, transcript);
      unlinkSync(old);
    }
    if (kind === "hardlink") linkSync(transcript, join(packagePath, "linked-copy"));
    if (kind === "unexpected") writeFileSync(join(packagePath, "audio.wav"), "audio", { mode: 0o600 });
    const claim = await claimPackage(cfg.inboxRoot, `${meetingId}.meeting`);
    await assert.rejects(() => validateClaimedPackage(claim, cfg));
  }
});

test("rejects duplicate manifest keys before JSON parsing", () => {
  assert.equal(hasDuplicateJsonKeys('{"schemaVersion":"1.0","nested":{"a":1,"a":2}}'), true);
  assert.equal(hasDuplicateJsonKeys('{"schemaVersion":"1.0","nested":{"a":1,"b":2}}'), false);
});

test("rejects a transcript whose declared bytes or digest do not match", async () => {
  const cfg = config();
  await ensureMeetingInbox(cfg);
  const packagePath = writePackage(cfg.inboxRoot);
  writeFileSync(join(packagePath, "transcript.jsonl"), "tampered\n", { mode: 0o600 });
  const claim = await claimPackage(cfg.inboxRoot, `${meetingId}.meeting`);
  await assert.rejects(() => validateClaimedPackage(claim, cfg), /artifact_mismatch/);
});

test("quarantine reason contains safe metadata but no transcript content", async () => {
  const cfg = config();
  await ensureMeetingInbox(cfg);
  writePackage(cfg.inboxRoot);
  const claim = await claimPackage(cfg.inboxRoot, `${meetingId}.meeting`);
  await quarantinePackage(claim, "invalid-transcript", { meetingId, packageDigest: "sha256:safe" });
  const reasonName = readdirSync(join(cfg.inboxRoot, "quarantine")).find((name) => name.endsWith(".reason.json"));
  assert.ok(reasonName);
  const reason = readFileSync(join(cfg.inboxRoot, "quarantine", reasonName), "utf8");
  assert.match(reason, /invalid-transcript/);
  assert.doesNotMatch(reason, /決定事項/);
  assert.equal(lstatSync(join(cfg.inboxRoot, "quarantine", reasonName)).mode & 0o777, 0o600);
});

test("import state distinguishes no-op, conflict and possible duplicate and stays owner-only", () => {
  const cfg = config();
  const path = join(cfg.inboxRoot, "state", "meeting-imports.json");
  const state = { schemaVersion: "1.0" as const, records: [{ meetingId, packageDigest: "pkg-a", transcriptDigest: "tx-a", status: "processed" as const, recordedAt: new Date(0).toISOString() }] };
  assert.equal(classifyMeetingImport(state, meetingId, "pkg-a", "tx-a"), "no-op");
  assert.equal(classifyMeetingImport(state, meetingId, "pkg-b", "tx-a"), "conflict");
  assert.equal(classifyMeetingImport(state, `${meetingId}-other`, "pkg-c", "tx-a"), "possible-duplicate");
  assert.equal(classifyMeetingImport(state, `${meetingId}-new`, "pkg-d", "tx-d"), "new");
  saveMeetingImportState(path, state);
  assert.deepEqual(loadMeetingImportState(path), state);
  assert.equal(lstatSync(path).mode & 0o777, 0o600);
});
