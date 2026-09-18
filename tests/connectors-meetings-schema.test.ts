import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTranscriptJsonl, validateMeetingManifest } from "../lib/connectors/meetings/schema.ts";

const fixture = (name: string) => fileURLToPath(new URL(`./__fixtures__/meetings/valid/${name}`, import.meta.url));
const validManifest = () => JSON.parse(readFileSync(fixture("manifest.json"), "utf8"));
const validTranscript = () => readFileSync(fixture("transcript.jsonl"), "utf8");

function errorCodes(result: ReturnType<typeof validateMeetingManifest>): string[] {
  return result.ok ? [] : result.errors.map((error) => `${error.path}:${error.code}`);
}

test("accepts the exact v1 manifest and transcript contract", () => {
  const manifest = validateMeetingManifest(validManifest());
  assert.equal(manifest.ok, true, manifest.ok ? undefined : JSON.stringify(manifest.errors));
  const transcript = parseTranscriptJsonl(validTranscript(), 30 * 60 * 1000);
  assert.equal(transcript.ok, true, transcript.ok ? undefined : JSON.stringify(transcript.errors));
  if (transcript.ok) assert.equal(transcript.value.length, 2);
});

test("rejects unsupported package types, malformed IDs, times, zones and unknown fields", () => {
  const value = validManifest();
  value.packageType = "meeting";
  value.meeting.id = "mtg_NOT-A-UUID";
  value.meeting.endedAt = value.meeting.startedAt;
  value.meeting.timezone = "Japan/Tokyoish";
  value.meeting.speaker = "not supported";
  const codes = errorCodes(validateMeetingManifest(value));
  assert.ok(codes.includes("$.packageType:invalid_value"));
  assert.ok(codes.includes("$.meeting.id:invalid_id"));
  assert.ok(codes.includes("$.meeting.endedAt:invalid_range"));
  assert.ok(codes.includes("$.meeting.timezone:invalid_timezone"));
  assert.ok(codes.includes("$.meeting.speaker:unknown_field"));
});

test("accepts internal only and requires a named publisher's personal affirmation", () => {
  for (const classification of ["public", "confidential", "personal-or-highly-restricted"]) {
    const value = validManifest();
    value.meeting.classification = classification;
    assert.ok(errorCodes(validateMeetingManifest(value)).includes("$.meeting.classification:invalid_value"));
  }
  const value = validManifest();
  value.publisher.displayName = "  ";
  value.consent.affirmedByPublisher = false;
  const codes = errorCodes(validateMeetingManifest(value));
  assert.ok(codes.includes("$.publisher.displayName:out_of_bounds"));
  assert.ok(codes.includes("$.consent.affirmedByPublisher:consent_required"));
});

test("requires the canonical analysis targets and allowlisted artifact names", () => {
  const value = validManifest();
  value.analysisRequest.targets.reverse();
  value.artifacts.transcript.path = "../transcript.jsonl";
  value.artifacts.localSummary = {
    path: "summary.md",
    bytes: 20,
    sha256: `sha256:${"c".repeat(64)}`,
    mediaType: "text/markdown",
  };
  const codes = errorCodes(validateMeetingManifest(value));
  assert.ok(codes.includes("$.analysisRequest.targets:invalid_targets"));
  assert.ok(codes.includes("$.artifacts.transcript.path:invalid_value"));
  assert.ok(codes.includes("$.artifacts.localSummary.path:invalid_value"));
});

test("enforces participant, digest, byte-count and string bounds", () => {
  const value = validManifest();
  value.meeting.participants = Array.from({ length: 501 }, () => ({ displayName: "参加者" }));
  value.capture.whisperModelSha256 = "sha256:ABC";
  value.artifacts.transcript.bytes = 0;
  value.meeting.title = "x".repeat(201);
  const codes = errorCodes(validateMeetingManifest(value));
  assert.ok(codes.includes("$.meeting.participants:out_of_bounds"));
  assert.ok(codes.includes("$.capture.whisperModelSha256:invalid_digest"));
  assert.ok(codes.includes("$.artifacts.transcript.bytes:out_of_bounds"));
  assert.ok(codes.includes("$.meeting.title:out_of_bounds"));
});

test("rejects partial, unordered, overly overlapping and over-duration transcript segments", () => {
  const lines = [
    { schemaVersion: "1.0", id: "seg_000001", startMs: 5000, endMs: 9000, text: "first", language: "en", partial: false },
    { schemaVersion: "1.0", id: "seg_000009", startMs: 1000, endMs: 50_000, text: "second", language: "en", partial: true },
  ].map((segment) => JSON.stringify(segment)).join("\n");
  const result = parseTranscriptJsonl(lines, 10_000);
  assert.equal(result.ok, false);
  if (!result.ok) {
    const codes = result.errors.map((error) => `${error.path}:${error.code}`);
    assert.ok(codes.includes("$[1].id:invalid_value"));
    assert.ok(codes.includes("$[1].startMs:out_of_order"));
    assert.ok(codes.includes("$[1].startMs:overlap_exceeded"));
    assert.ok(codes.includes("$[1].endMs:duration_exceeded"));
    assert.ok(codes.includes("$[1].partial:partial_segment"));
  }
});

test("rejects speaker ownership, NUL content, blank text and excessive UTF-8 bytes", () => {
  const result = parseTranscriptJsonl(JSON.stringify({
    schemaVersion: "1.0",
    id: "seg_000001",
    startMs: 0,
    endMs: 1000,
    text: `\0${"界".repeat(6000)}`,
    language: "ja",
    partial: false,
    speaker: "inferred person",
    participantId: "p1",
  }), 10_000);
  assert.equal(result.ok, false);
  if (!result.ok) {
    const codes = result.errors.map((error) => `${error.path}:${error.code}`);
    assert.ok(codes.includes("$[0].speaker:unknown_field"));
    assert.ok(codes.includes("$[0].participantId:unknown_field"));
    assert.ok(codes.includes("$[0].text:invalid_text"));
    assert.ok(codes.includes("$[0].text:too_large"));
  }
});
