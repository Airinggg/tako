import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { basename, isAbsolute, join, resolve } from "node:path";
import {
  MEETING_LIMITS,
  parseTranscriptJsonl,
  validateMeetingManifest,
  type MeetingPackageManifestV1,
  type TranscriptSegmentV1,
} from "./schema.ts";

const STATES = ["staging", "ready", "processing", "processed", "quarantine"] as const;
const PACKAGE_NAME = /^mtg_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.meeting$/;

export type MeetingInboxWorkspace = {
  id: string;
  label: string;
  sourceId: string;
  classification: "internal";
  retentionDays: number;
  enabled: boolean;
};

export type MeetingInboxConfig = {
  schemaVersion: "1.0";
  inboxRoot: string;
  processedRecoveryDays: number;
  workspaces: MeetingInboxWorkspace[];
};

export type ClaimedPackage = {
  root: string;
  name: string;
  path: string;
};

export type ValidatedMeetingPackage = {
  claim: ClaimedPackage;
  manifest: MeetingPackageManifestV1;
  transcript: TranscriptSegmentV1[];
  transcriptText: string;
  localSummary?: string;
  workspace: MeetingInboxWorkspace;
  packageDigest: string;
  transcriptDigest: string;
};

export type SafeReason =
  | "invalid-name"
  | "invalid-filesystem-object"
  | "invalid-permissions"
  | "unexpected-file"
  | "package-too-large"
  | "invalid-manifest"
  | "invalid-transcript"
  | "artifact-mismatch"
  | "unknown-workspace"
  | "classification-denied"
  | "duplicate-conflict";

function sha256(buffer: Buffer | string): string {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fsyncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function assertCanonicalRoot(root: string): void {
  if (!isAbsolute(root) || resolve(root) !== root) throw new Error("meeting_inbox_root_not_canonical");
  if (existsSync(root) && realpathSync(root) !== root) throw new Error("meeting_inbox_root_not_canonical");
}

function assertPrivateDirectory(path: string): void {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("meeting_inbox_invalid_directory");
  if ((metadata.mode & 0o777) !== 0o700) throw new Error("meeting_inbox_invalid_permissions");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) throw new Error("meeting_inbox_invalid_owner");
}

export async function ensureMeetingInbox(config: MeetingInboxConfig): Promise<void> {
  assertCanonicalRoot(config.inboxRoot);
  mkdirSync(config.inboxRoot, { recursive: true, mode: 0o700 });
  chmodSync(config.inboxRoot, 0o700);
  if (realpathSync(config.inboxRoot) !== config.inboxRoot) throw new Error("meeting_inbox_root_not_canonical");
  for (const state of STATES) {
    const path = join(config.inboxRoot, state);
    mkdirSync(path, { mode: 0o700 });
    chmodSync(path, 0o700);
    assertPrivateDirectory(path);
  }
}

export async function listReadyPackages(root: string): Promise<string[]> {
  const ready = join(root, "ready");
  assertPrivateDirectory(ready);
  return readdirSync(ready, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && PACKAGE_NAME.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export async function claimPackage(root: string, name: string): Promise<ClaimedPackage> {
  if (basename(name) !== name || !PACKAGE_NAME.test(name)) throw new Error("meeting_package_invalid_name");
  const source = join(root, "ready", name);
  const destination = join(root, "processing", name);
  renameSync(source, destination);
  fsyncDirectory(join(root, "ready"));
  fsyncDirectory(join(root, "processing"));
  assertPrivateDirectory(destination);
  return { root, name, path: destination };
}

function readPrivateRegularFile(path: string, maxBytes: number): Buffer {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error("meeting_file_invalid_type");
  if ((before.mode & 0o400) === 0 || (before.mode & 0o177) !== 0) throw new Error("meeting_file_invalid_permissions");
  if (typeof process.getuid === "function" && before.uid !== process.getuid()) throw new Error("meeting_file_invalid_owner");
  if (before.size > maxBytes) throw new Error("meeting_file_too_large");
  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  const fd = openSync(path, constants.O_RDONLY | noFollow);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new Error("meeting_file_changed");
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    const current = lstatSync(path);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || current.dev !== opened.dev || current.ino !== opened.ino || current.size !== opened.size) throw new Error("meeting_file_changed");
    if (bytes.byteLength > maxBytes) throw new Error("meeting_file_too_large");
    return bytes;
  } finally {
    closeSync(fd);
  }
}

/** Reject duplicate object keys before JSON.parse can silently overwrite one. */
export function hasDuplicateJsonKeys(text: string): boolean {
  let at = 0;
  const whitespace = () => { while (/\s/.test(text[at] ?? "")) at += 1; };
  const stringToken = (): string => {
    const start = at;
    if (text[at] !== '"') throw new Error("json");
    at += 1;
    while (at < text.length) {
      if (text[at] === "\\") { at += 2; continue; }
      if (text[at] === '"') { at += 1; return JSON.parse(text.slice(start, at)); }
      at += 1;
    }
    throw new Error("json");
  };
  const value = (): boolean => {
    whitespace();
    if (text[at] === '"') { stringToken(); return false; }
    if (text[at] === "{") {
      at += 1;
      whitespace();
      const keys = new Set<string>();
      let duplicate = false;
      if (text[at] === "}") { at += 1; return false; }
      while (at < text.length) {
        whitespace();
        const key = stringToken();
        if (keys.has(key)) duplicate = true;
        keys.add(key);
        whitespace();
        if (text[at++] !== ":") throw new Error("json");
        duplicate = value() || duplicate;
        whitespace();
        if (text[at] === "}") { at += 1; return duplicate; }
        if (text[at++] !== ",") throw new Error("json");
      }
      throw new Error("json");
    }
    if (text[at] === "[") {
      at += 1;
      whitespace();
      let duplicate = false;
      if (text[at] === "]") { at += 1; return false; }
      while (at < text.length) {
        duplicate = value() || duplicate;
        whitespace();
        if (text[at] === "]") { at += 1; return duplicate; }
        if (text[at++] !== ",") throw new Error("json");
      }
      throw new Error("json");
    }
    const match = text.slice(at).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (!match) throw new Error("json");
    at += match[0].length;
    return false;
  };
  const duplicate = value();
  whitespace();
  if (at !== text.length) throw new Error("json");
  return duplicate;
}

export async function validateClaimedPackage(
  claim: ClaimedPackage,
  config: MeetingInboxConfig,
): Promise<ValidatedMeetingPackage> {
  assertPrivateDirectory(claim.path);
  const entries = readdirSync(claim.path, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  const allowed = new Set(["manifest.json", "transcript.jsonl", "local-summary.md"]);
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink() || !allowed.has(entry.name))) throw new Error("meeting_package_unexpected_file");
  if (!names.includes("manifest.json") || !names.includes("transcript.jsonl")) throw new Error("meeting_package_missing_file");

  const sizes = names.map((name) => statSync(join(claim.path, name)).size);
  if (sizes.reduce((sum, size) => sum + size, 0) > MEETING_LIMITS.packageBytes) throw new Error("meeting_package_too_large");

  const manifestBytes = readPrivateRegularFile(join(claim.path, "manifest.json"), MEETING_LIMITS.manifestBytes);
  const manifestText = manifestBytes.toString("utf8");
  let parsed: unknown;
  try {
    if (hasDuplicateJsonKeys(manifestText)) throw new Error("duplicate");
    parsed = JSON.parse(manifestText);
  } catch {
    throw new Error("meeting_manifest_invalid_json");
  }
  const checked = validateMeetingManifest(parsed);
  if (!checked.ok) throw new Error("meeting_manifest_invalid_schema");
  const manifest = checked.value;
  if (`${manifest.meeting.id}.meeting` !== claim.name) throw new Error("meeting_manifest_id_mismatch");
  const workspace = config.workspaces.find((entry) => entry.id === manifest.meeting.workspaceId && entry.enabled);
  if (!workspace) throw new Error("meeting_workspace_unknown");
  if (workspace.classification !== "internal" || manifest.meeting.classification !== "internal") throw new Error("meeting_classification_denied");

  const transcriptBytes = readPrivateRegularFile(join(claim.path, "transcript.jsonl"), MEETING_LIMITS.transcriptBytes);
  if (manifest.artifacts.transcript.bytes !== transcriptBytes.byteLength || manifest.artifacts.transcript.sha256 !== sha256(transcriptBytes)) throw new Error("meeting_transcript_artifact_mismatch");
  const duration = Date.parse(manifest.meeting.endedAt) - Date.parse(manifest.meeting.startedAt);
  const transcriptText = transcriptBytes.toString("utf8");
  const transcript = parseTranscriptJsonl(transcriptText, duration);
  if (!transcript.ok) throw new Error("meeting_transcript_invalid");

  let localSummary: string | undefined;
  if (manifest.artifacts.localSummary) {
    if (!names.includes("local-summary.md")) throw new Error("meeting_summary_missing");
    const summaryBytes = readPrivateRegularFile(join(claim.path, "local-summary.md"), MEETING_LIMITS.summaryBytes);
    if (manifest.artifacts.localSummary.bytes !== summaryBytes.byteLength || manifest.artifacts.localSummary.sha256 !== sha256(summaryBytes)) throw new Error("meeting_summary_artifact_mismatch");
    localSummary = summaryBytes.toString("utf8");
    if (localSummary.includes("\0") || localSummary.includes("\uFFFD")) throw new Error("meeting_summary_invalid_text");
  } else if (names.includes("local-summary.md")) {
    throw new Error("meeting_summary_undeclared");
  }

  const transcriptDigest = sha256(transcriptBytes);
  const packageDigest = sha256(`${canonicalJson(manifest)}\n${transcriptDigest}\n${manifest.artifacts.localSummary?.sha256 ?? ""}`);
  return { claim, manifest, transcript: transcript.value, transcriptText, localSummary, workspace, packageDigest, transcriptDigest };
}

export async function finishPackage(claim: ClaimedPackage): Promise<void> {
  renameSync(claim.path, join(claim.root, "processed", claim.name));
  fsyncDirectory(join(claim.root, "processing"));
  fsyncDirectory(join(claim.root, "processed"));
}

export async function quarantinePackage(
  claim: ClaimedPackage,
  reason: SafeReason,
  metadata: { meetingId?: string; packageDigest?: string } = {},
): Promise<void> {
  const suffix = `${Date.now()}-${randomUUID()}`;
  const destination = join(claim.root, "quarantine", `${claim.name.replace(/\.meeting$/, "")}.${suffix}.meeting`);
  renameSync(claim.path, destination);
  const reasonPath = `${destination}.reason.json`;
  const fd = openSync(reasonPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify({ schemaVersion: "1.0", reason, meetingId: metadata.meetingId, packageDigest: metadata.packageDigest, quarantinedAt: new Date().toISOString() })}\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(reasonPath, 0o600);
  fsyncDirectory(join(claim.root, "processing"));
  fsyncDirectory(join(claim.root, "quarantine"));
}
