import assert from "node:assert/strict";
import test from "node:test";
import { renderReceipt } from "../lib/skills/receipt-render.ts";
import { verifyReceipt, type SkillRunReceipt } from "../lib/skills/receipt.ts";

function run(overrides: Partial<SkillRunReceipt> = {}): SkillRunReceipt {
  return {
    skill: "project-status",
    scope: { name: "delivery", federatedRead: ["shared", "engineering"] },
    startedAt: "2026-08-30T09:00:00.000Z",
    endedAt: "2026-08-30T09:00:02.000Z",
    steps: [{
      step: "1. Gather evidence",
      declaredReads: ["shared", "engineering"],
      actualReads: ["shared"],
      startedAt: "2026-08-30T09:00:00.000Z",
      endedAt: "2026-08-30T09:00:01.000Z",
      note: "Found the current project page.",
    }],
    violations: ["stale finding"],
    ...overrides,
  };
}

test("verifyReceipt accepts a clean run without mutating its input", () => {
  const input = run();
  const verified = verifyReceipt(input, ["shared", "engineering"]);
  assert.deepEqual(verified.violations, []);
  assert.deepEqual(input.violations, ["stale finding"]);
  assert.notEqual(verified, input);
  assert.notEqual(verified.steps[0], input.steps[0]);
});

test("verifyReceipt reports a source absent from approved skill reads", () => {
  const input = run({
    scope: { name: "delivery", federatedRead: ["shared", "finance"] },
    steps: [{ ...run().steps[0], declaredReads: ["shared"], actualReads: ["shared", "finance"] }],
  });
  assert.deepEqual(verifyReceipt(input, ["shared"]).violations, [
    'Step "1. Gather evidence" read undeclared source "finance".',
  ]);
});

test("verifyReceipt reports an approved skill source outside the run scope", () => {
  const input = run({
    scope: { name: "shared-only", federatedRead: ["shared"] },
    steps: [{ ...run().steps[0], actualReads: ["engineering"] }],
  });
  assert.deepEqual(verifyReceipt(input, ["shared", "engineering"]).violations, [
    'Step "1. Gather evidence" read out-of-scope source "engineering".',
  ]);
});

test("renderReceipt produces stable per-step Markdown", () => {
  const input = run({
    scope: { name: "shared-only", federatedRead: ["shared"] },
    steps: [{ ...run().steps[0], declaredReads: ["engineering", "shared"], actualReads: ["finance", "shared"] }],
  });
  const verified = verifyReceipt(input, ["engineering", "shared"]);
  assert.equal(renderReceipt(verified), `# Skill run receipt: project-status

- Scope: shared-only
- Federated read: \`shared\`
- Started: 2026-08-30T09:00:00.000Z
- Ended: 2026-08-30T09:00:02.000Z

## Violations

- ✗ Step "1. Gather evidence" read undeclared source "finance".
- ✗ Step "1. Gather evidence" read out-of-scope source "finance".

## Steps

### 1. Gather evidence

- Started: 2026-08-30T09:00:00.000Z
- Ended: 2026-08-30T09:00:01.000Z
- Sources:
  - ✓ \`engineering\` — declared; not read
  - ✗ \`finance\` — read; undeclared; outside scope
  - ✓ \`shared\` — read
- Note: Found the current project page.
`);
});
