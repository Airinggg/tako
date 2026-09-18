import { closeSync, chmodSync, constants, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export type MeetingImportRecord = {
  meetingId: string;
  packageDigest: string;
  transcriptDigest: string;
  status: "processed" | "quarantined";
  recordedAt: string;
};

export type MeetingImportState = {
  schemaVersion: "1.0";
  records: MeetingImportRecord[];
};

export type ImportDisposition = "new" | "no-op" | "conflict" | "possible-duplicate";

export function classifyMeetingImport(
  state: MeetingImportState,
  meetingId: string,
  packageDigest: string,
  transcriptDigest: string,
): ImportDisposition {
  const sameId = state.records.find((record) => record.meetingId === meetingId);
  if (sameId) return sameId.packageDigest === packageDigest ? "no-op" : "conflict";
  return state.records.some((record) => record.transcriptDigest === transcriptDigest) ? "possible-duplicate" : "new";
}

export function loadMeetingImportState(path: string): MeetingImportState {
  if (!existsSync(path)) return { schemaVersion: "1.0", records: [] };
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (value?.schemaVersion !== "1.0" || !Array.isArray(value.records)) throw new Error("invalid");
    return value as MeetingImportState;
  } catch {
    throw new Error("meeting_import_state_invalid");
  }
}

/** Atomic owner-only state write, including a directory fsync after rename. */
export function saveMeetingImportState(path: string, state: MeetingImportState): void {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  chmodSync(parent, 0o700);
  const tmp = join(parent, `.${randomUUID()}.tmp`);
  const fd = openSync(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  chmodSync(path, 0o600);
  const dirFd = openSync(parent, constants.O_RDONLY);
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }
}
