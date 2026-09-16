import assert from "node:assert/strict";
import test from "node:test";
import { grantsForScope, parseSkillFrontmatter, type RealisedScope } from "../lib/scopes/grants.ts";

const scope: RealisedScope = {
  name: "delivery",
  purpose: "Delivery work",
  rules: [],
  includePrefixes: ["notion/projects/", "slack/platform/"],
  createdAt: "2026-08-30T00:00:00.000Z",
  realisedSources: ["engineering", "shared"],
};

test("parseSkillFrontmatter reads list values and strips YAML comments", () => {
  const parsed = parseSkillFrontmatter(`---
name: project-status
reads:
  - shared # project docs
  - engineering
description: 状況をまとめる
---
# Project status
`, "shared");
  assert.deepEqual(parsed, { name: "project-status", reads: ["engineering", "shared"], source: "shared" });
});

test("scope grants only skills whose complete reads set is covered", () => {
  const result = grantsForScope(scope, [
    { name: "project-status", reads: ["shared", "engineering"], source: "shared" },
    { name: "finance-audit", reads: ["shared", "finance"], source: "shared" },
    { name: "undeclared", reads: [], source: "shared" },
  ], []);
  assert.deepEqual(result.skills, ["project-status"]);
});

test("scope grants rule files only from readable sources", () => {
  const result = grantsForScope(scope, [], [
    "/repo/brain-sources/shared/skills/_operating-rules.md",
    "/repo/brain-sources/engineering/skills/_output-rules.md",
    "/repo/brain-sources/finance/skills/_finance-rules.md",
    "/repo/brain-sources/shared/skills/_excluded-people.md",
  ]);
  assert.deepEqual(result.rules, [
    "/repo/brain-sources/engineering/skills/_output-rules.md",
    "/repo/brain-sources/shared/skills/_operating-rules.md",
  ]);
});
