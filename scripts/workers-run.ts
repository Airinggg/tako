#!/usr/bin/env bun
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseSkill, type ParsedSkill } from "../lib/skills/parse.ts";
import { dueWorkers, type WorkersState } from "../lib/workers/model.ts";
import { runLiveWorker } from "../lib/workers/run-live.ts";
import {
  loadWorkerQueue, loadWorkers, loadWorkersState, saveWorkerQueue, saveWorkersState,
  type WorkerQueueItem,
} from "../lib/workers/state.ts";

const REPO = join(import.meta.dir, "..");
const CONFIG = join(REPO, "config");
// homedir() (not process.env.HOME) so this resolves on Windows too, where
// HOME isn't set by default. Deliberately not gbrainHome() -- this pins to
// the real ~/.aletheia-brain regardless of any GBRAIN_HOME override, so a
// worker process can never read ~/.gbrain or another brain.
const PROTECTED_BRAIN_HOME = join(homedir(), ".aletheia-brain");
// Ignore inherited values so this process can never read ~/.gbrain or another brain.
process.env.GBRAIN_HOME = PROTECTED_BRAIN_HOME;

function log(action: Record<string, unknown>): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), ...action }));
}

function skillInventory(): Map<string, ParsedSkill> {
  const result = new Map<string, ParsedSkill>();
  const roots = join(REPO, "brain-sources");
  if (!existsSync(roots)) return result;
  for (const source of readdirSync(roots, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const skills = join(roots, source.name, "skills");
    if (!existsSync(skills)) continue;
    for (const directory of readdirSync(skills, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      const path = join(skills, directory.name, "SKILL.md");
      if (!existsSync(path)) continue;
      const parsed = parseSkill(readFileSync(path, "utf8"));
      if (parsed.name) result.set(parsed.name, parsed);
    }
  }
  return result;
}

function parseArgs(args: readonly string[]): { once: boolean; pollMs: number } {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: npm run workers:run -- [--once] [--interval SEC]");
    process.exit(0);
  }
  const intervalIndex = args.indexOf("--interval");
  const intervalSeconds = intervalIndex >= 0 ? Number(args[intervalIndex + 1]) : 30;
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    throw new Error("--interval requires a positive number of seconds");
  }
  const known = new Set(["--once", "--interval", ...(intervalIndex >= 0 ? [args[intervalIndex + 1]] : [])]);
  const unknown = args.filter((arg) => !known.has(arg));
  if (unknown.length) throw new Error(`unknown flag: ${unknown[0]}`);
  return { once: args.includes("--once"), pollMs: intervalSeconds * 1_000 };
}

async function pass(): Promise<number> {
  const workersPath = join(CONFIG, "workers.json");
  const statePath = join(CONFIG, "workers-state.json");
  const queuePath = join(CONFIG, "worker-queue.json");
  const workers = await loadWorkers(workersPath);
  const state = await loadWorkersState(statePath);
  const now = new Date();
  const due = dueWorkers(workers, state, now);
  if (!due.length) {
    log({ action: "pass", status: "idle", workers: workers.length });
    return 0;
  }

  // Import after pinning GBRAIN_HOME; loadDashboard performs read-only GBrain calls.
  const { loadDashboard } = await import("../lib/console/data.ts");
  const dashboard = loadDashboard();
  const scopes = new Map(dashboard.mode === "scopes"
    ? dashboard.brains.map((scope) => [scope.name, scope.readSources] as const)
    : []);
  const skills = skillInventory();
  const queue = await loadWorkerQueue(queuePath);
  const nextState: WorkersState = { ...state };

  for (const worker of due) {
    const ranAt = new Date().toISOString();
    const skill = skills.get(worker.skill);
    if (!skill) {
      nextState[worker.id] = { lastRunAt: ranAt, lastStatus: "failure" };
      await saveWorkersState(nextState, statePath);
      log({ action: "worker", worker: worker.id, status: "failure", error: `skill not found: ${worker.skill}` });
      continue;
    }

    try {
      const result = await runLiveWorker(worker, {
        skill,
        grantedSources: scopes.get(worker.scope) ?? [],
        home: PROTECTED_BRAIN_HOME,
      });
      const item: WorkerQueueItem = {
        id: `${worker.id}:${result.ranAt}`,
        approvalStatus: "pending",
        queuedAt: result.ranAt,
        deliverTo: worker.deliverTo,
        result,
      };
      queue.push(item);
      await saveWorkerQueue(queue, queuePath);
      nextState[worker.id] = { lastRunAt: result.ranAt, lastStatus: result.status };
      await saveWorkersState(nextState, statePath);
      log({
        action: "worker", worker: worker.id, status: result.status,
        queued: true, queueItem: item.id, delivery: "human approval required",
      });
    } catch (error) {
      nextState[worker.id] = { lastRunAt: ranAt, lastStatus: "failure" };
      await saveWorkersState(nextState, statePath);
      log({ action: "worker", worker: worker.id, status: "failure", error: (error as Error).message });
    }
  }
  return due.length;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  let stopping = false;
  let wake: (() => void) | undefined;
  const shutdown = () => {
    stopping = true;
    wake?.();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  do {
    await pass();
    if (options.once || stopping) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, options.pollMs);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    wake = undefined;
  } while (!stopping);
  log({ action: "daemon", status: "stopped" });
}

main().catch((error) => {
  log({ action: "daemon", status: "failure", error: (error as Error).message });
  process.exitCode = 1;
});
