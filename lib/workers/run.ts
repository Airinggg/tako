import type { ParsedSkill } from "../skills/parse.ts";
import { runSkill, type SkillStepRunner } from "../skills/run.ts";
import type { SkillRunReceipt } from "../skills/receipt.ts";
import type { Worker } from "./model.ts";

export type WorkerRunResult = {
  worker: Worker;
  ranAt: string;
  receipt: SkillRunReceipt;
  output: string;
  status: "queued" | "refused";
};

export type RunWorkerOptions = {
  /** Parsed definition named by worker.skill. Omit when worker.skill is already parsed. */
  skill?: ParsedSkill;
  grantedSources: readonly string[];
  stepRunner: SkillStepRunner;
  /** Injectable for deterministic orchestration and receipts. */
  now?: () => string;
};

/** Run a worker into the approval queue. This function never delivers output. */
export async function runWorker(
  worker: Worker | Worker<ParsedSkill>,
  opts: RunWorkerOptions,
): Promise<WorkerRunResult> {
  const now = opts.now ?? (() => new Date().toISOString());
  const ranAt = now();
  const configuredName = typeof worker.skill === "string" ? worker.skill : worker.skill.name;
  const skill = opts.skill ?? (typeof worker.skill === "string" ? undefined : worker.skill);
  const serializableWorker: Worker = { ...worker, skill: configuredName };
  if (!skill) {
    const receipt: SkillRunReceipt = {
      skill: configuredName,
      scope: { name: worker.scope, federatedRead: [...new Set(opts.grantedSources)] },
      startedAt: ranAt,
      endedAt: now(),
      steps: [],
      violations: [`Configured skill "${configuredName}" was not loaded.`],
    };
    return { worker: serializableWorker, ranAt, receipt, output: "", status: "refused" };
  }
  if (skill.name !== configuredName) {
    const receipt: SkillRunReceipt = {
      skill: configuredName,
      scope: { name: worker.scope, federatedRead: [...new Set(opts.grantedSources)] },
      startedAt: ranAt,
      endedAt: now(),
      steps: [],
      violations: [`Configured skill "${configuredName}" does not match loaded skill "${skill.name}".`],
    };
    return { worker: serializableWorker, ranAt, receipt, output: "", status: "refused" };
  }

  const receipt = await runSkill(skill, {
    scope: worker.scope,
    grantedSources: opts.grantedSources,
    stepRunner: opts.stepRunner,
    now,
  });
  const refused = receipt.steps.length === 0
    && receipt.violations.some((violation) => violation.includes("is not granted to scope"));

  return {
    worker: serializableWorker,
    ranAt,
    receipt,
    output: refused ? "" : (receipt.steps.at(-1)?.note ?? ""),
    status: refused ? "refused" : "queued",
  };
}
