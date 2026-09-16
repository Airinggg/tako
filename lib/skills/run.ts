import { grantsForScope } from "../scopes/grants.ts";
import { verifyReceipt, type SkillRunReceipt, type StepReceipt } from "./receipt.ts";
import type { ParsedSkill } from "./parse.ts";

export type StepRunResult = { text: string; pagesRead: string[] };
export type SkillStepRunner = (instruction: string, sources: string[]) => Promise<StepRunResult>;

export type RunSkillOptions = {
  scope: string;
  grantedSources: readonly string[];
  stepRunner: SkillStepRunner;
  /** Injectable for deterministic receipts. */
  now?: () => string;
};

/** A page read is encoded as `<source>/<page-slug>` by step runners. */
export function sourcePrefix(pageRead: string): string {
  const value = pageRead.trim();
  const colon = value.indexOf(":");
  const slash = value.indexOf("/");
  if (colon > 0 && (slash < 0 || colon < slash)) return value.slice(0, colon);
  return slash > 0 ? value.slice(0, slash) : value;
}

function scopeGrants(skill: ParsedSkill, opts: RunSkillOptions): boolean {
  const grants = grantsForScope({
    name: opts.scope,
    purpose: "",
    rules: [],
    includePrefixes: [],
    createdAt: "",
    realisedSources: [...new Set(opts.grantedSources)],
  }, [{ name: skill.name, reads: skill.reads, source: "runtime" }], []);
  return grants.skills.includes(skill.name);
}

/** Execute a reviewed skill without performing I/O beyond its injected runner. */
export async function runSkill(skill: ParsedSkill, opts: RunSkillOptions): Promise<SkillRunReceipt> {
  const now = opts.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const scope = { name: opts.scope, federatedRead: [...new Set(opts.grantedSources)] };

  if (!scopeGrants(skill, opts)) {
    const missing = skill.reads.filter((source) => !scope.federatedRead.includes(source));
    const base = verifyReceipt({
      skill: skill.name,
      scope,
      startedAt,
      endedAt: now(),
      steps: [],
      violations: [],
    }, skill.reads);
    return {
      ...base,
      violations: [`Skill "${skill.name}" is not granted to scope "${opts.scope}"; missing source${missing.length === 1 ? "" : "s"}: ${missing.join(", ") || "declared reads"}.`],
    };
  }

  const allowedSources = [...new Set(skill.reads)];
  const steps: StepReceipt[] = [];
  for (let index = 0; index < skill.steps.length; index++) {
    const stepStarted = now();
    const result = await opts.stepRunner(skill.steps[index], [...allowedSources]);
    steps.push({
      step: index + 1,
      declaredReads: [...skill.reads],
      actualReads: [...new Set(result.pagesRead.map(sourcePrefix).filter(Boolean))],
      startedAt: stepStarted,
      endedAt: now(),
      ...(result.text ? { note: result.text } : {}),
    });
  }

  return verifyReceipt({
    skill: skill.name,
    scope,
    startedAt,
    endedAt: now(),
    steps,
    violations: [],
  }, skill.reads);
}
