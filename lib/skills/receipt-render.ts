import type { SkillRunReceipt, StepReceipt } from "./receipt.ts";

function sourceLines(step: StepReceipt, scopeReads: ReadonlySet<string>): string[] {
  const declared = new Set(step.declaredReads);
  const actual = new Set(step.actualReads);
  const sources = [...new Set([...step.declaredReads, ...step.actualReads])].sort();
  if (!sources.length) return ["- Sources: none"];
  return ["- Sources:", ...sources.map((source) => {
    if (!actual.has(source)) return `  - ✓ \`${source}\` — declared; not read`;
    const problems = [
      !declared.has(source) ? "undeclared" : "",
      !scopeReads.has(source) ? "outside scope" : "",
    ].filter(Boolean);
    return problems.length
      ? `  - ✗ \`${source}\` — read; ${problems.join("; ")}`
      : `  - ✓ \`${source}\` — read`;
  })];
}

/** Render a stable, human-reviewable Markdown audit receipt. */
export function renderReceipt(run: SkillRunReceipt): string {
  const lines = [
    `# Skill run receipt: ${run.skill}`,
    "",
    `- Scope: ${run.scope.name}`,
    `- Federated read: ${run.scope.federatedRead.length ? run.scope.federatedRead.map((source) => `\`${source}\``).join(", ") : "none"}`,
    `- Started: ${run.startedAt}`,
    `- Ended: ${run.endedAt}`,
    "",
    "## Violations",
    "",
    ...(run.violations.length ? run.violations.map((violation) => `- ✗ ${violation}`) : ["- ✓ None"]),
    "",
    "## Steps",
  ];
  const scopeReads = new Set(run.scope.federatedRead);
  run.steps.forEach((step) => {
    lines.push(
      "",
      `### ${step.step}`,
      "",
      `- Started: ${step.startedAt}`,
      `- Ended: ${step.endedAt}`,
      ...sourceLines(step, scopeReads),
    );
    if (step.note) lines.push(`- Note: ${step.note}`);
  });
  return `${lines.join("\n")}\n`;
}
