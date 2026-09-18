export const MEETING_LIMITS = {
  manifestBytes: 64 * 1024,
  transcriptBytes: 10 * 1024 * 1024,
  summaryBytes: 1024 * 1024,
  packageBytes: 12 * 1024 * 1024,
  segments: 20_000,
  segmentTextBytes: 16 * 1024,
  participants: 500,
} as const;

export type PersonRef = {
  displayName: string;
  email?: string;
  externalId?: string;
};

export type ArtifactRef = {
  path: string;
  bytes: number;
  sha256: string;
};

export type MeetingPackageManifestV1 = {
  schemaVersion: "1.0";
  packageType: "tako.meeting";
  meeting: {
    id: string;
    title: string;
    workspaceId: string;
    classification: "internal";
    startedAt: string;
    endedAt: string;
    timezone: string;
    organizer?: PersonRef;
    participants?: PersonRef[];
    recurrence?: { seriesId?: string; cadenceLabel?: string };
  };
  publisher: { memberId?: string; displayName: string; email?: string };
  consent: {
    affirmedByPublisher: true;
    affirmedAt: string;
    statementVersion: "1.0";
    note?: string;
  };
  capture: {
    mode: "file" | "live";
    transcriberVersion: string;
    whisperModel: string;
    whisperModelSha256: string;
    language: string;
    outputMode: "transcribe" | "translate-to-english";
    completedAt: string;
  };
  artifacts: {
    transcript: ArtifactRef & { mediaType: "application/x-ndjson" };
    localSummary?: ArtifactRef & { mediaType: "text/markdown" };
  };
  analysisRequest: {
    schemaVersion: "1.0";
    targets: [
      "candidate-decisions",
      "candidate-open-actions",
      "meeting-necessity-review",
      "follow-up-need",
    ];
  };
  package: { createdAt: string; createdBy: string; nonce: string };
};

export type TranscriptSegmentV1 = {
  schemaVersion: "1.0";
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  language: string;
  partial: false;
};

export type ValidationError = { path: string; code: string; message: string };

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ValidationError[] };

const UUID_V7 = /^mtg_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WORKSPACE_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const LANGUAGE = /^(?:und|[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)$/;
const TARGETS = [
  "candidate-decisions",
  "candidate-open-actions",
  "meeting-necessity-review",
  "follow-up-need",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function add(errors: ValidationError[], path: string, code: string, message: string): void {
  errors.push({ path, code, message });
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: ValidationError[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) add(errors, `${path}.${key}`, "unknown_field", "Field is not allowed by schema 1.0");
  }
}

function requiredRecord(
  value: unknown,
  path: string,
  errors: ValidationError[],
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    add(errors, path, "invalid_type", "Expected an object");
    return undefined;
  }
  return value;
}

function boundedString(
  value: unknown,
  path: string,
  errors: ValidationError[],
  min: number,
  max: number,
): value is string {
  if (typeof value !== "string") {
    add(errors, path, "invalid_type", "Expected a string");
    return false;
  }
  if (value.includes("\0") || value.includes("\uFFFD")) {
    add(errors, path, "invalid_text", "Text must be valid UTF-8 without NUL bytes");
    return false;
  }
  const length = Array.from(value).length;
  if (length < min || length > max || (min > 0 && value.trim().length === 0)) {
    add(errors, path, "out_of_bounds", `Expected ${min}–${max} characters`);
    return false;
  }
  return true;
}

function exactString(value: unknown, expected: string, path: string, errors: ValidationError[]): void {
  if (value !== expected) add(errors, path, "invalid_value", `Must equal ${expected}`);
}

function timestamp(value: unknown, path: string, errors: ValidationError[]): value is string {
  if (typeof value !== "string" || !RFC3339.test(value) || !Number.isFinite(Date.parse(value))) {
    add(errors, path, "invalid_timestamp", "Expected an RFC 3339 timestamp with Z or a numeric offset");
    return false;
  }
  return true;
}

function person(value: unknown, path: string, errors: ValidationError[]): void {
  const record = requiredRecord(value, path, errors);
  if (!record) return;
  rejectUnknown(record, ["displayName", "email", "externalId"], path, errors);
  boundedString(record.displayName, `${path}.displayName`, errors, 1, 120);
  if (record.email !== undefined) boundedString(record.email, `${path}.email`, errors, 3, 254);
  if (record.externalId !== undefined) boundedString(record.externalId, `${path}.externalId`, errors, 1, 256);
}

function artifact(
  value: unknown,
  path: string,
  errors: ValidationError[],
  expectedPath: string,
  expectedType: string,
  maxBytes: number,
): void {
  const record = requiredRecord(value, path, errors);
  if (!record) return;
  rejectUnknown(record, ["path", "bytes", "sha256", "mediaType"], path, errors);
  exactString(record.path, expectedPath, `${path}.path`, errors);
  exactString(record.mediaType, expectedType, `${path}.mediaType`, errors);
  if (!Number.isSafeInteger(record.bytes) || Number(record.bytes) < 1 || Number(record.bytes) > maxBytes) {
    add(errors, `${path}.bytes`, "out_of_bounds", `Expected an integer between 1 and ${maxBytes}`);
  }
  if (typeof record.sha256 !== "string" || !SHA256.test(record.sha256)) {
    add(errors, `${path}.sha256`, "invalid_digest", "Expected sha256 followed by 64 lowercase hexadecimal characters");
  }
}

function timezone(value: unknown, path: string, errors: ValidationError[]): void {
  if (typeof value !== "string") {
    add(errors, path, "invalid_timezone", "Expected an IANA timezone name");
    return;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
  } catch {
    add(errors, path, "invalid_timezone", "Expected an IANA timezone name");
  }
}

export function validateMeetingManifest(value: unknown): ValidationResult<MeetingPackageManifestV1> {
  const errors: ValidationError[] = [];
  const root = requiredRecord(value, "$", errors);
  if (!root) return { ok: false, errors };
  rejectUnknown(root, ["schemaVersion", "packageType", "meeting", "publisher", "consent", "capture", "artifacts", "analysisRequest", "package"], "$", errors);
  exactString(root.schemaVersion, "1.0", "$.schemaVersion", errors);
  exactString(root.packageType, "tako.meeting", "$.packageType", errors);

  const meeting = requiredRecord(root.meeting, "$.meeting", errors);
  if (meeting) {
    rejectUnknown(meeting, ["id", "title", "workspaceId", "classification", "startedAt", "endedAt", "timezone", "organizer", "participants", "recurrence"], "$.meeting", errors);
    if (typeof meeting.id !== "string" || !UUID_V7.test(meeting.id)) add(errors, "$.meeting.id", "invalid_id", "Expected mtg_ followed by a lowercase UUIDv7");
    boundedString(meeting.title, "$.meeting.title", errors, 1, 200);
    if (typeof meeting.workspaceId !== "string" || !WORKSPACE_ID.test(meeting.workspaceId)) add(errors, "$.meeting.workspaceId", "invalid_workspace", "Workspace ID must use lowercase letters, digits and hyphens");
    exactString(meeting.classification, "internal", "$.meeting.classification", errors);
    const startedOk = timestamp(meeting.startedAt, "$.meeting.startedAt", errors);
    const endedOk = timestamp(meeting.endedAt, "$.meeting.endedAt", errors);
    if (startedOk && endedOk && Date.parse(meeting.endedAt as string) <= Date.parse(meeting.startedAt as string)) {
      add(errors, "$.meeting.endedAt", "invalid_range", "Meeting end must be after its start");
    }
    timezone(meeting.timezone, "$.meeting.timezone", errors);
    if (meeting.organizer !== undefined) person(meeting.organizer, "$.meeting.organizer", errors);
    if (meeting.participants !== undefined) {
      if (!Array.isArray(meeting.participants)) add(errors, "$.meeting.participants", "invalid_type", "Expected an array");
      else if (meeting.participants.length > MEETING_LIMITS.participants) add(errors, "$.meeting.participants", "out_of_bounds", `At most ${MEETING_LIMITS.participants} participants are allowed`);
      else meeting.participants.forEach((entry, index) => person(entry, `$.meeting.participants[${index}]`, errors));
    }
    if (meeting.recurrence !== undefined) {
      const recurrence = requiredRecord(meeting.recurrence, "$.meeting.recurrence", errors);
      if (recurrence) {
        rejectUnknown(recurrence, ["seriesId", "cadenceLabel"], "$.meeting.recurrence", errors);
        if (recurrence.seriesId !== undefined) boundedString(recurrence.seriesId, "$.meeting.recurrence.seriesId", errors, 1, 256);
        if (recurrence.cadenceLabel !== undefined) boundedString(recurrence.cadenceLabel, "$.meeting.recurrence.cadenceLabel", errors, 1, 120);
      }
    }
  }

  const publisher = requiredRecord(root.publisher, "$.publisher", errors);
  if (publisher) {
    rejectUnknown(publisher, ["memberId", "displayName", "email"], "$.publisher", errors);
    boundedString(publisher.displayName, "$.publisher.displayName", errors, 1, 120);
    if (publisher.memberId !== undefined) boundedString(publisher.memberId, "$.publisher.memberId", errors, 1, 128);
    if (publisher.email !== undefined) boundedString(publisher.email, "$.publisher.email", errors, 3, 254);
  }

  const consent = requiredRecord(root.consent, "$.consent", errors);
  if (consent) {
    rejectUnknown(consent, ["affirmedByPublisher", "affirmedAt", "statementVersion", "note"], "$.consent", errors);
    if (consent.affirmedByPublisher !== true) add(errors, "$.consent.affirmedByPublisher", "consent_required", "The named publisher must personally affirm consent");
    timestamp(consent.affirmedAt, "$.consent.affirmedAt", errors);
    exactString(consent.statementVersion, "1.0", "$.consent.statementVersion", errors);
    if (consent.note !== undefined) boundedString(consent.note, "$.consent.note", errors, 0, 500);
  }

  const capture = requiredRecord(root.capture, "$.capture", errors);
  if (capture) {
    rejectUnknown(capture, ["mode", "transcriberVersion", "whisperModel", "whisperModelSha256", "language", "outputMode", "completedAt"], "$.capture", errors);
    if (capture.mode !== "file" && capture.mode !== "live") add(errors, "$.capture.mode", "invalid_value", "Must equal file or live");
    boundedString(capture.transcriberVersion, "$.capture.transcriberVersion", errors, 1, 64);
    boundedString(capture.whisperModel, "$.capture.whisperModel", errors, 1, 120);
    if (typeof capture.whisperModelSha256 !== "string" || !SHA256.test(capture.whisperModelSha256)) add(errors, "$.capture.whisperModelSha256", "invalid_digest", "Expected a pinned lowercase SHA-256 digest");
    if (typeof capture.language !== "string" || !LANGUAGE.test(capture.language)) add(errors, "$.capture.language", "invalid_language", "Expected a BCP 47 language tag or und");
    if (capture.outputMode !== "transcribe" && capture.outputMode !== "translate-to-english") add(errors, "$.capture.outputMode", "invalid_value", "Must equal transcribe or translate-to-english");
    timestamp(capture.completedAt, "$.capture.completedAt", errors);
  }

  const artifacts = requiredRecord(root.artifacts, "$.artifacts", errors);
  if (artifacts) {
    rejectUnknown(artifacts, ["transcript", "localSummary"], "$.artifacts", errors);
    artifact(artifacts.transcript, "$.artifacts.transcript", errors, "transcript.jsonl", "application/x-ndjson", MEETING_LIMITS.transcriptBytes);
    if (artifacts.localSummary !== undefined) artifact(artifacts.localSummary, "$.artifacts.localSummary", errors, "local-summary.md", "text/markdown", MEETING_LIMITS.summaryBytes);
  }

  const analysis = requiredRecord(root.analysisRequest, "$.analysisRequest", errors);
  if (analysis) {
    rejectUnknown(analysis, ["schemaVersion", "targets"], "$.analysisRequest", errors);
    exactString(analysis.schemaVersion, "1.0", "$.analysisRequest.schemaVersion", errors);
    const targets = analysis.targets;
    if (!Array.isArray(targets) || targets.length !== TARGETS.length || TARGETS.some((target, index) => targets[index] !== target)) {
      add(errors, "$.analysisRequest.targets", "invalid_targets", "Must contain the four canonical analysis targets in order");
    }
  }

  const packageInfo = requiredRecord(root.package, "$.package", errors);
  if (packageInfo) {
    rejectUnknown(packageInfo, ["createdAt", "createdBy", "nonce"], "$.package", errors);
    timestamp(packageInfo.createdAt, "$.package.createdAt", errors);
    boundedString(packageInfo.createdBy, "$.package.createdBy", errors, 1, 120);
    if (typeof packageInfo.nonce !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(packageInfo.nonce)) add(errors, "$.package.nonce", "invalid_nonce", "Expected an unpadded 128-bit base64url nonce");
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: root as MeetingPackageManifestV1 };
}

export function parseTranscriptJsonl(text: string, meetingDurationMs: number): ValidationResult<TranscriptSegmentV1[]> {
  const errors: ValidationError[] = [];
  if (Buffer.byteLength(text, "utf8") > MEETING_LIMITS.transcriptBytes) add(errors, "$", "too_large", "Transcript exceeds the 10 MiB limit");
  if (text.includes("\0") || text.includes("\uFFFD")) add(errors, "$", "invalid_text", "Transcript must be valid UTF-8 without NUL bytes");
  if (!Number.isSafeInteger(meetingDurationMs) || meetingDurationMs <= 0) add(errors, "$duration", "invalid_duration", "Meeting duration must be a positive integer");

  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) add(errors, "$", "empty_transcript", "Transcript must contain at least one segment");
  if (lines.length > MEETING_LIMITS.segments) add(errors, "$", "too_many_segments", `Transcript may contain at most ${MEETING_LIMITS.segments} segments`);

  const segments: TranscriptSegmentV1[] = [];
  for (let index = 0; index < Math.min(lines.length, MEETING_LIMITS.segments + 1); index += 1) {
    const path = `$[${index}]`;
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[index]);
    } catch {
      add(errors, path, "invalid_json", "Line is not valid JSON");
      continue;
    }
    const segment = requiredRecord(parsed, path, errors);
    if (!segment) continue;
    rejectUnknown(segment, ["schemaVersion", "id", "startMs", "endMs", "text", "language", "partial"], path, errors);
    exactString(segment.schemaVersion, "1.0", `${path}.schemaVersion`, errors);
    const expectedId = `seg_${String(index + 1).padStart(6, "0")}`;
    exactString(segment.id, expectedId, `${path}.id`, errors);
    if (!Number.isSafeInteger(segment.startMs) || Number(segment.startMs) < 0) add(errors, `${path}.startMs`, "invalid_timestamp", "Expected a non-negative integer");
    if (!Number.isSafeInteger(segment.endMs) || Number(segment.endMs) <= Number(segment.startMs)) add(errors, `${path}.endMs`, "invalid_timestamp", "Expected an integer after startMs");
    if (Number(segment.endMs) > meetingDurationMs + 30_000) add(errors, `${path}.endMs`, "duration_exceeded", "Segment exceeds meeting duration tolerance");
    if (index > 0 && segments.length) {
      const prior = segments[segments.length - 1];
      if (Number(segment.startMs) < prior.startMs) add(errors, `${path}.startMs`, "out_of_order", "Segments must be ordered by start time");
      if (prior.endMs - Number(segment.startMs) > 2_000) add(errors, `${path}.startMs`, "overlap_exceeded", "Segments may overlap by at most two seconds");
    }
    boundedString(segment.text, `${path}.text`, errors, 1, MEETING_LIMITS.segmentTextBytes);
    if (typeof segment.text === "string" && Buffer.byteLength(segment.text, "utf8") > MEETING_LIMITS.segmentTextBytes) {
      add(errors, `${path}.text`, "too_large", "Segment text exceeds the 16 KiB UTF-8 limit");
    }
    if (typeof segment.language !== "string" || !LANGUAGE.test(segment.language)) add(errors, `${path}.language`, "invalid_language", "Expected a BCP 47 language tag or und");
    if (segment.partial !== false) add(errors, `${path}.partial`, "partial_segment", "Only final transcript segments may be published");
    segments.push(segment as TranscriptSegmentV1);
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: segments };
}
