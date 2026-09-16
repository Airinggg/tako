import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Worker, WorkersState } from "./model.ts";
import type { WorkerRunResult } from "./run.ts";

export const DEFAULT_WORKERS_PATH = join(process.cwd(), "config/workers.json");
export const DEFAULT_WORKERS_STATE_PATH = join(process.cwd(), "config/workers-state.json");
export const DEFAULT_WORKER_QUEUE_PATH = join(process.cwd(), "config/worker-queue.json");

export type WorkerQueueItem = {
  id: string;
  approvalStatus: "pending";
  queuedAt: string;
  deliverTo: string;
  result: WorkerRunResult;
};

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    try { await unlink(temporary); } catch { /* no temporary file to remove */ }
    throw error;
  }
}

function isWorker(value: unknown): value is Worker {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const worker = value as Record<string, unknown>;
  return ["id", "name", "skill", "scope", "schedule", "deliverTo"]
    .every((key) => typeof worker[key] === "string")
    && (worker.lastRunAt === null || typeof worker.lastRunAt === "string")
    && (worker.lastStatus === null || ["queued", "refused", "failure"].includes(String(worker.lastStatus)));
}

export async function loadWorkers(path = DEFAULT_WORKERS_PATH): Promise<Worker[]> {
  const parsed = await readJson(path);
  return Array.isArray(parsed) ? parsed.filter(isWorker) : [];
}

export async function loadWorkersState(path = DEFAULT_WORKERS_STATE_PATH): Promise<WorkersState> {
  const parsed = await readJson(path);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const entries = Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, NonNullable<WorkersState[string]>] => {
    const value = entry[1];
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const state = value as Record<string, unknown>;
    return (state.lastRunAt === null || typeof state.lastRunAt === "string")
      && (state.lastStatus === null || ["queued", "refused", "failure"].includes(String(state.lastStatus)));
  });
  return Object.fromEntries(entries);
}

export function saveWorkersState(state: Readonly<WorkersState>, path = DEFAULT_WORKERS_STATE_PATH): Promise<void> {
  return atomicJson(path, state);
}

export async function loadWorkerQueue(path = DEFAULT_WORKER_QUEUE_PATH): Promise<WorkerQueueItem[]> {
  const parsed = await readJson(path);
  return Array.isArray(parsed) ? parsed as WorkerQueueItem[] : [];
}

export function saveWorkerQueue(queue: readonly WorkerQueueItem[], path = DEFAULT_WORKER_QUEUE_PATH): Promise<void> {
  return atomicJson(path, queue);
}
