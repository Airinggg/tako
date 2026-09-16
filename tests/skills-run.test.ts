import assert from "node:assert/strict";
import test from "node:test";
import { parseSkill } from "../lib/skills/parse.ts";
import { renderReceipt } from "../lib/skills/receipt-render.ts";
import { runSkill, type SkillStepRunner } from "../lib/skills/run.ts";

const MARKDOWN = `---
name: project-status
description: Report a project's current state.
triggers:
  - "status of"
  - 案件の状況
reads:
  - shared # project documents
  - engineering # team chat
---

# project-status

## Procedure

1. **Find the project.** Search for its current record.
   Include the owner and stage.
2. **Gather activity.** Find the newest team discussion.

## Output shape
Return a cited summary.
`;

function clock(...values: string[]): () => string {
  let index = 0;
  return () => {
    assert.ok(index < values.length, "clock exhausted");
    return values[index++];
  };
}

test("parseSkill reads frontmatter and numbered Procedure steps", () => {
  assert.deepEqual(parseSkill(MARKDOWN), {
    name: "project-status",
    description: "Report a project's current state.",
    triggers: ["status of", "案件の状況"],
    reads: ["shared", "engineering"],
    steps: [
      "**Find the project.** Search for its current record. Include the owner and stage.",
      "**Gather activity.** Find the newest team discussion.",
    ],
  });
  assert.deepEqual(parseSkill("---\nname: empty\n---\n# Empty").steps, []);
});

test("runSkill executes each step with a clean verified receipt", async () => {
  const skill = parseSkill(MARKDOWN);
  const calls: Array<{ instruction: string; sources: string[] }> = [];
  const runner: SkillStepRunner = async (instruction, sources) => {
    calls.push({ instruction, sources });
    return calls.length === 1
      ? { text: "Found the record.", pagesRead: ["shared/notion/project-a"] }
      : { text: "Found the thread.", pagesRead: ["engineering/slack/project-a"] };
  };
  const receipt = await runSkill(skill, {
    scope: "delivery",
    grantedSources: ["shared", "engineering"],
    stepRunner: runner,
    now: clock(
      "2026-08-31T00:00:00.000Z", "2026-08-31T00:00:01.000Z",
      "2026-08-31T00:00:02.000Z", "2026-08-31T00:00:03.000Z",
      "2026-08-31T00:00:04.000Z", "2026-08-31T00:00:05.000Z",
    ),
  });

  assert.deepEqual(calls.map((call) => call.sources), [
    ["shared", "engineering"],
    ["shared", "engineering"],
  ]);
  assert.deepEqual(receipt.steps.map((step) => step.actualReads), [["shared"], ["engineering"]]);
  assert.deepEqual(receipt.violations, []);

  assert.equal(renderReceipt(receipt), `# Skill run receipt: project-status

- Scope: delivery
- Federated read: \`shared\`, \`engineering\`
- Started: 2026-08-31T00:00:00.000Z
- Ended: 2026-08-31T00:00:05.000Z

## Violations

- ✓ None

## Steps

### 1

- Started: 2026-08-31T00:00:01.000Z
- Ended: 2026-08-31T00:00:02.000Z
- Sources:
  - ✓ \`engineering\` — declared; not read
  - ✓ \`shared\` — read
- Note: Found the record.

### 2

- Started: 2026-08-31T00:00:03.000Z
- Ended: 2026-08-31T00:00:04.000Z
- Sources:
  - ✓ \`engineering\` — read
  - ✓ \`shared\` — declared; not read
- Note: Found the thread.
`);
});

test("runSkill refuses a scope missing one required source", async () => {
  let calls = 0;
  const receipt = await runSkill(parseSkill(MARKDOWN), {
    scope: "documents-only",
    grantedSources: ["shared"],
    stepRunner: async () => { calls++; return { text: "", pagesRead: [] }; },
    now: clock("2026-08-31T01:00:00.000Z", "2026-08-31T01:00:00.001Z"),
  });

  assert.equal(calls, 0);
  assert.deepEqual(receipt.steps, []);
  assert.deepEqual(receipt.violations, [
    'Skill "project-status" is not granted to scope "documents-only"; missing source: engineering.',
  ]);
});

test("runSkill reports a step that reads an undeclared source", async () => {
  const skill = parseSkill(`---
name: docs-only
description: Read documents.
triggers: [docs]
reads: [shared]
---
## Procedure
1. Search the documents.
`);
  const receipt = await runSkill(skill, {
    scope: "broad",
    grantedSources: ["shared", "engineering"],
    stepRunner: async () => ({ text: "Unexpected chat result.", pagesRead: ["engineering/slack/general"] }),
    now: clock(
      "2026-08-31T02:00:00.000Z", "2026-08-31T02:00:01.000Z",
      "2026-08-31T02:00:02.000Z", "2026-08-31T02:00:03.000Z",
    ),
  });

  assert.deepEqual(receipt.violations, ['Step "1" read undeclared source "engineering".']);
});
