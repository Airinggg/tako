export type StepReceipt = {
  step: string | number;
  declaredReads: string[];
  actualReads: string[];
  startedAt: string;
  endedAt: string;
  note?: string;
};

export type ReceiptScope = {
  name: string;
  federatedRead: string[];
};

export type SkillRunReceipt = {
  skill: string;
  scope: ReceiptScope;
  startedAt: string;
  endedAt: string;
  steps: StepReceipt[];
  violations: string[];
};

/**
 * Verify observed reads against the approved skill frontmatter and the run's
 * effective scope. The input is never mutated; prior violation text is replaced
 * by the findings derived from this run.
 */
export function verifyReceipt(run: SkillRunReceipt, skillReads: readonly string[]): SkillRunReceipt {
  const declaredBySkill = new Set(skillReads);
  const allowedByScope = new Set(run.scope.federatedRead);
  const violations: string[] = [];

  run.steps.forEach((step) => {
    [...new Set(step.actualReads)].forEach((source) => {
      if (!declaredBySkill.has(source)) {
        violations.push(`Step "${step.step}" read undeclared source "${source}".`);
      }
      if (!allowedByScope.has(source)) {
        violations.push(`Step "${step.step}" read out-of-scope source "${source}".`);
      }
    });
  });

  return {
    ...run,
    scope: { ...run.scope, federatedRead: [...run.scope.federatedRead] },
    steps: run.steps.map((step) => ({
      ...step,
      declaredReads: [...step.declaredReads],
      actualReads: [...step.actualReads],
    })),
    violations,
  };
}
