import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedSkill } from "../lib/skills/parse.ts";
import type { Worker } from "../lib/workers/model.ts";
import { runWorker } from "../lib/workers/run.ts";

const skill: ParsedSkill = {
  name: "weekly-digest",
  description: "A reviewed digest",
  triggers: ["weekly digest"],
  reads: ["shared", "engineering"],
  steps: ["Collect updates.", "Write the draft."],
};

const worker: Worker = {
  id: "monday-digest",
  name: "Monday digest",
  skill: "weekly-digest",
  scope: "all-hands",
  schedule: "weekly@mon09:00",
  deliverTo: "#general — DRAFT",
  lastRunAt: null,
  lastStatus: null,
};

function clock(...values: string[]): () => string {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

test("a granted worker queues the final step and attaches its receipt", async () => {
  const instructions: string[] = [];
  const result = await runWorker(worker, {
    skill,
    grantedSources: ["shared", "engineering"],
    stepRunner: async (instruction, sources) => {
      instructions.push(instruction);
      return {
        text: instruction === "Collect updates." ? "collected" : "final draft",
        pagesRead: sources.map((source) => `${source}/page`),
      };
    },
    now: clock(
      "2026-08-31T09:00:00.000Z", "2026-08-31T09:00:00.001Z",
      "2026-08-31T09:00:00.002Z", "2026-08-31T09:00:00.003Z",
      "2026-08-31T09:00:00.004Z", "2026-08-31T09:00:00.005Z",
      "2026-08-31T09:00:00.006Z",
    ),
  });

  assert.equal(result.status, "queued");
  assert.equal(result.output, "final draft");
  assert.deepEqual(instructions, skill.steps);
  assert.equal(result.receipt.steps.length, 2);
  assert.deepEqual(result.receipt.violations, []);
  assert.equal(result.receipt.steps[1].note, "final draft");
});

test("an ungranted scope refuses before calling the runner", async () => {
  let called = false;
  const result = await runWorker(worker, {
    skill,
    grantedSources: ["shared"],
    stepRunner: async () => {
      called = true;
      return { text: "must not run", pagesRead: [] };
    },
    now: () => "2026-08-31T09:00:00.000Z",
  });

  assert.equal(called, false);
  assert.equal(result.status, "refused");
  assert.equal(result.output, "");
  assert.equal(result.receipt.steps.length, 0);
  assert.match(result.receipt.violations[0], /missing source: engineering/);
});

test("a worker may carry its parsed skill directly", async () => {
  const result = await runWorker({ ...worker, skill }, {
    grantedSources: ["shared", "engineering"],
    stepRunner: async (instruction) => ({ text: instruction, pagesRead: [] }),
    now: () => "2026-08-31T09:00:00.000Z",
  });
  assert.equal(result.status, "queued");
  assert.equal(result.worker.skill, "weekly-digest");
  assert.equal(result.output, "Write the draft.");
});

test("receipt violations remain attached to queued output", async () => {
  const result = await runWorker(worker, {
    skill,
    grantedSources: ["shared", "engineering"],
    stepRunner: async () => ({ text: "draft", pagesRead: ["finance/private-page"] }),
    now: () => "2026-08-31T09:00:00.000Z",
  });

  assert.equal(result.status, "queued");
  assert.equal(result.output, "draft");
  assert.match(result.receipt.violations.join("\n"), /undeclared source "finance"/);
  assert.match(result.receipt.violations.join("\n"), /out-of-scope source "finance"/);
});
