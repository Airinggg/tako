import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMeetingInbox, type MeetingInboxConfig } from "../lib/connectors/meetings/inbox.ts";
import { importReadyMeetings, type MeetingImportOptions } from "../lib/connectors/meetings/import.ts";

const meetingId = "mtg_018f1f0c-7b4a-7cc1-8bc2-123456789abc";
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function paths(root: string): MeetingImportOptions {
  return {
    sourceRoot: join(root, "brain-sources"),
    statePath: join(root, "config", "meeting-import-state.json"),
    receiptsPath: join(root, "config", "meeting-import-receipts.jsonl"),
    syncLogPath: join(root, "config", "sync-log.jsonl"),
    analysisQueuePath: join(root, "config", "meeting-analysis-queue.json"),
    now: () => "2026-09-18T12:00:00.000Z",
  };
}

function config(inboxRoot: string): MeetingInboxConfig {
  return { schemaVersion: "1.0", inboxRoot, processedRecoveryDays: 7, workspaces: [{ id: "engineering", label: "Engineering", sourceId: "engineering", classification: "internal", retentionDays: 90, enabled: true }] };
}

function createPackage(inboxRoot: string, classification = "internal"): string {
  const transcript = `${JSON.stringify({ schemaVersion: "1.0", id: "seg_000001", startMs: 0, endMs: 4000, text: "金曜日までに確認することを決定しました。", language: "ja", partial: false })}\n`;
  const manifest = {
    schemaVersion: "1.0", packageType: "tako.meeting",
    meeting: { id: meetingId, title: "週次会議", workspaceId: "engineering", classification, startedAt: "2026-09-18T09:00:00+09:00", endedAt: "2026-09-18T09:30:00+09:00", timezone: "Asia/Tokyo" },
    publisher: { displayName: "佐藤 花子", email: "private@example.test" },
    consent: { affirmedByPublisher: true, affirmedAt: "2026-09-18T09:35:00+09:00", statementVersion: "1.0" },
    capture: { mode: "live", transcriberVersion: "1.0.0", whisperModel: "small", whisperModelSha256: `sha256:${"a".repeat(64)}`, language: "ja", outputMode: "transcribe", completedAt: "2026-09-18T09:31:00+09:00" },
    artifacts: { transcript: { path: "transcript.jsonl", bytes: Buffer.byteLength(transcript), sha256: digest(transcript), mediaType: "application/x-ndjson" } },
    analysisRequest: { schemaVersion: "1.0", targets: ["candidate-decisions", "candidate-open-actions", "meeting-necessity-review", "follow-up-need"] },
    package: { createdAt: "2026-09-18T09:35:01+09:00", createdBy: "test", nonce: "AQIDBAUGBwgJCgsMDQ4PEA" },
  };
  const target = join(inboxRoot, "ready", `${meetingId}.meeting`);
  mkdirSync(target, { mode: 0o700 });
  writeFileSync(join(target, "transcript.jsonl"), transcript, { mode: 0o600 });
  writeFileSync(join(target, "manifest.json"), `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
  return target;
}

test("imports one governed canonical page, receipt and analysis queue without delivery", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tako-meeting-import-")));
  const inbox = join(root, "inbox");
  const cfg = config(inbox);
  await ensureMeetingInbox(cfg);
  createPackage(inbox);
  const options = paths(root);
  const result = await importReadyMeetings(cfg, options);
  assert.deepEqual(result, { processed: 1, noOp: 0, quarantined: 0, queued: 1 });

  const page = join(options.sourceRoot, "engineering", "meetings", `${meetingId}.md`);
  assert.equal(existsSync(page), true);
  assert.equal(lstatSync(page).mode & 0o777, 0o600);
  assert.match(readFileSync(page, "utf8"), /seg_000001/);
  assert.equal(lstatSync(join(inbox, "processed", `${meetingId}.meeting`)).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(inbox, "processed", `${meetingId}.meeting`, "manifest.json")).mode & 0o777, 0o600);

  const receipt = readFileSync(options.receiptsPath, "utf8");
  assert.match(receipt, /"status":"processed"/);
  assert.doesNotMatch(receipt, /金曜日|private@example|\/tmp\//);
  const queue = JSON.parse(readFileSync(options.analysisQueuePath, "utf8"));
  assert.deepEqual(queue.items.map((item: any) => item.status), ["pending"]);
  assert.equal(existsSync(join(root, "slack")), false);
  assert.equal(existsSync(join(root, "calendar")), false);
  assert.match(readFileSync(options.syncLogPath, "utf8"), /engineering\/meetings/);

  cpSync(join(inbox, "processed", `${meetingId}.meeting`), join(inbox, "ready", `${meetingId}.meeting`), { recursive: true });
  chmodSync(join(inbox, "ready", `${meetingId}.meeting`), 0o700);
  const retry = await importReadyMeetings(cfg, options);
  assert.deepEqual(retry, { processed: 0, noOp: 1, quarantined: 0, queued: 0 });
  assert.equal(JSON.parse(readFileSync(options.analysisQueuePath, "utf8")).items.length, 1);
});

test("a rejected package is quarantined without writing under brain-sources", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tako-meeting-import-")));
  const inbox = join(root, "inbox");
  const cfg = config(inbox);
  await ensureMeetingInbox(cfg);
  createPackage(inbox, "public");
  const options = paths(root);
  const result = await importReadyMeetings(cfg, options);
  assert.deepEqual(result, { processed: 0, noOp: 0, quarantined: 1, queued: 0 });
  assert.equal(existsSync(options.sourceRoot), false);
  assert.ok(readdirSync(join(inbox, "quarantine")).some((name) => name.endsWith(".meeting")));
  const receipt = readFileSync(options.receiptsPath, "utf8");
  assert.doesNotMatch(receipt, /金曜日|private@example/);
});
