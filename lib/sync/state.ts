import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ConnectorRunState, SyncScheduleState } from "./schedule.ts";

export const DEFAULT_SYNC_STATE_PATH = join(process.cwd(), "config/sync-state.json");

function isRunState(value: unknown): value is ConnectorRunState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return (state.lastRunAt === null || typeof state.lastRunAt === "string")
    && (state.lastStatus === null || state.lastStatus === "success" || state.lastStatus === "failure")
    && typeof state.consecutiveFailures === "number"
    && Number.isInteger(state.consecutiveFailures)
    && state.consecutiveFailures >= 0;
}

export async function loadSyncState(path = DEFAULT_SYNC_STATE_PATH): Promise<SyncScheduleState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (!entries.every(([, value]) => isRunState(value))) return {};
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

export async function saveSyncState(state: Readonly<SyncScheduleState>, path = DEFAULT_SYNC_STATE_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    try { await unlink(temporary); } catch { /* no temporary file to remove */ }
    throw error;
  }
}
