import type { ParsedSkill } from "../skills/parse.ts";
import { createLiveStepRunner, type LiveStepRunnerOptions } from "../skills/run-live.ts";
import type { Worker } from "./model.ts";
import { runWorker, type WorkerRunResult } from "./run.ts";

export type RunLiveWorkerOptions = LiveStepRunnerOptions & {
  skill: ParsedSkill;
  grantedSources: readonly string[];
  now?: () => string;
};

/** Local GBrain/Ollama adapter; the result is returned for review and never delivered. */
export function runLiveWorker(worker: Worker, opts: RunLiveWorkerOptions): Promise<WorkerRunResult> {
  return runWorker(worker, {
    skill: opts.skill,
    grantedSources: opts.grantedSources,
    stepRunner: createLiveStepRunner(opts),
    now: opts.now,
  });
}
