import assert from "node:assert/strict";
import test from "node:test";
import { renderMeetingEvidence } from "../lib/connectors/meetings/render.ts";
import type { ValidatedMeetingPackage } from "../lib/connectors/meetings/inbox.ts";

function meetingPackage(): ValidatedMeetingPackage {
  return {
    claim: { root: "/not/rendered/in/output", name: "mtg_018f1f0c-7b4a-7cc1-8bc2-123456789abc.meeting", path: "/not/rendered/in/output/processing/package" },
    manifest: {
      schemaVersion: "1.0",
      packageType: "tako.meeting",
      meeting: {
        id: "mtg_018f1f0c-7b4a-7cc1-8bc2-123456789abc",
        title: "週次プロジェクト確認",
        workspaceId: "engineering",
        classification: "internal",
        startedAt: "2026-09-18T09:00:00+09:00",
        endedAt: "2026-09-18T09:30:00+09:00",
        timezone: "Asia/Tokyo",
        organizer: { displayName: "佐藤 花子", email: "organizer@example.test" },
        participants: [{ displayName: "田中 太郎", email: "private@example.test" }],
      },
      publisher: { displayName: "佐藤 花子", email: "publisher@example.test" },
      consent: { affirmedByPublisher: true, affirmedAt: "2026-09-18T09:35:00+09:00", statementVersion: "1.0" },
      capture: { mode: "live", transcriberVersion: "1.0.0", whisperModel: "small", whisperModelSha256: `sha256:${"a".repeat(64)}`, language: "ja", outputMode: "transcribe", completedAt: "2026-09-18T09:31:00+09:00" },
      artifacts: {
        transcript: { path: "transcript.jsonl", bytes: 100, sha256: `sha256:${"b".repeat(64)}`, mediaType: "application/x-ndjson" },
        localSummary: { path: "local-summary.md", bytes: 50, sha256: `sha256:${"c".repeat(64)}`, mediaType: "text/markdown" },
      },
      analysisRequest: { schemaVersion: "1.0", targets: ["candidate-decisions", "candidate-open-actions", "meeting-necessity-review", "follow-up-need"] },
      package: { createdAt: "2026-09-18T09:35:01+09:00", createdBy: "test", nonce: "AQIDBAUGBwgJCgsMDQ4PEA" },
    },
    transcript: [
      { schemaVersion: "1.0", id: "seg_000001", startMs: 0, endMs: 5500, text: "金曜日までに確認します。", language: "ja", partial: false },
      { schemaVersion: "1.0", id: "seg_000002", startMs: 5000, endMs: 12_000, text: "```を含む原文も保持します。", language: "ja", partial: false },
    ],
    transcriptText: "raw transcript JSONL",
    localSummary: "自動要約：これは根拠として使わない。",
    workspace: { id: "engineering", label: "Engineering", sourceId: "engineering-meetings", classification: "internal", retentionDays: 90, enabled: true },
    packageDigest: `sha256:${"d".repeat(64)}`,
    transcriptDigest: `sha256:${"e".repeat(64)}`,
  };
}

test("renders one deterministic canonical meeting page with stable evidence anchors", () => {
  const rendered = renderMeetingEvidence(meetingPackage());
  assert.equal(rendered.relativePath, "meetings/mtg_018f1f0c-7b4a-7cc1-8bc2-123456789abc.md");
  assert.match(rendered.markdown, /<a id="seg_000001"><\/a>/);
  assert.match(rendered.markdown, /seg_000001 · 00:00:00\.000–00:00:05\.500/);
  assert.match(rendered.markdown, /classification: internal/);
  assert.match(rendered.markdown, /workspace_id: "engineering"/);
  assert.match(rendered.markdown, /package_digest: "sha256:d{64}"/);
  assert.match(rendered.markdown, /transcript_digest: "sha256:e{64}"/);
  assert.equal(renderMeetingEvidence(meetingPackage()).markdown, rendered.markdown);
});

test("labels machine evidence and human-review status without unsupported speaker claims", () => {
  const { markdown } = renderMeetingEvidence(meetingPackage());
  assert.match(markdown, /machine-generated evidence/);
  assert.match(markdown, /analysis_status: pending-human-review/);
  assert.match(markdown, /Publisher:\*\* 佐藤 花子/);
  assert.match(markdown, /consent_affirmed_at:/);
  assert.doesNotMatch(markdown, /speaker|said by|発言者/i);
});

test("keeps the local summary outside the evidence boundary and omits private paths and emails", () => {
  const { markdown } = renderMeetingEvidence(meetingPackage());
  assert.match(markdown, /## Supplementary, not evidence/);
  const evidence = markdown.match(/<!-- meeting-evidence:start -->([\s\S]*?)<!-- meeting-evidence:end -->/)?.[1] ?? "";
  assert.doesNotMatch(evidence, /自動要約/);
  assert.match(markdown, /自動要約/);
  assert.doesNotMatch(markdown, /private@example\.test|publisher@example\.test|organizer@example\.test/);
  assert.doesNotMatch(markdown, /\/not\/rendered|audio|ChatGPT summary prompt/i);
});
