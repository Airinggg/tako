#!/usr/bin/env bun
import { join } from "node:path";
import { dueWorkers, nextRun } from "../lib/workers/model.ts";
import { loadWorkerQueue, loadWorkers, loadWorkersState } from "../lib/workers/state.ts";

const REPO = join(import.meta.dir, "..");
const CONFIG = join(REPO, "config");
const workers = await loadWorkers(join(CONFIG, "workers.json"));
const state = await loadWorkersState(join(CONFIG, "workers-state.json"));
const queue = await loadWorkerQueue(join(CONFIG, "worker-queue.json"));
const now = new Date();
const due = new Set(dueWorkers(workers, state, now).map((worker) => worker.id));
const pending = queue.filter((item) => item.approvalStatus === "pending").length;

console.log(`Workers (${workers.length}) · approval queue: ${pending}`);
for (const worker of workers.sort((left, right) => left.id.localeCompare(right.id))) {
  const runState = state[worker.id];
  const effective = runState
    ? { ...worker, lastRunAt: runState.lastRunAt, lastStatus: runState.lastStatus }
    : worker;
  let scheduled: string;
  try {
    scheduled = due.has(worker.id) ? now.toISOString() : nextRun(effective, now);
  } catch (error) {
    scheduled = `invalid (${(error as Error).message})`;
  }
  console.log(`- ${worker.id} — ${worker.name}`);
  console.log(`  skill: ${worker.skill}; scope: ${worker.scope}`);
  console.log(`  schedule: ${worker.schedule}; next: ${scheduled}`);
  console.log(`  last: ${effective.lastRunAt ?? "never"} (${effective.lastStatus ?? "never"})`);
  console.log(`  draft target: ${worker.deliverTo} (never auto-delivered)`);
}
if (!workers.length) console.log("No workers configured — copy config/workers.example.json to config/workers.json.");
