import assert from "node:assert/strict";
import test from "node:test";
import { credentialGuidePath, extractEnvPlaceholders, missingEnvVars, planConfigScaffold } from "../lib/cli/setup.ts";

test("planConfigScaffold copies missing files and leaves existing ones alone", () => {
  const plan = planConfigScaffold(
    ["connectors.example.json", "scopes.example.json", "people.example.json", "meeting-inbox.example.json"],
    new Set(["scopes.json"]),
  );
  assert.deepEqual(plan.toCopy.sort(), ["connectors.json", "meeting-inbox.json", "people.json"]);
  assert.deepEqual(plan.alreadyPresent, ["scopes.json"]);
});

test("planConfigScaffold with everything already present copies nothing", () => {
  const plan = planConfigScaffold(["connectors.example.json"], new Set(["connectors.json"]));
  assert.deepEqual(plan.toCopy, []);
  assert.deepEqual(plan.alreadyPresent, ["connectors.json"]);
});

test("extractEnvPlaceholders finds every env: token, nested and repeated", () => {
  const found = extractEnvPlaceholders({
    notion: { token: "env:NOTION_TOKEN", databases: ["abc"] },
    slack: { token: "env:SLACK_BOT_TOKEN", channels: ["general"] },
    notes: { roots: ["/x"] },
  });
  assert.deepEqual([...found].sort(), ["NOTION_TOKEN", "SLACK_BOT_TOKEN"]);
});

test("extractEnvPlaceholders ignores plain strings and non-env values", () => {
  const found = extractEnvPlaceholders({ a: "plain-value", b: 5, c: null, d: ["env:X", "plain"] });
  assert.deepEqual([...found], ["X"]);
});

test("missingEnvVars filters to only the unset names", () => {
  assert.deepEqual(missingEnvVars(["A", "B", "C"], { A: "set", C: "" }), ["B", "C"]);
  assert.deepEqual(missingEnvVars(["A"], { A: "set" }), []);
});

test("credentialGuidePath is stable and per-connector", () => {
  assert.equal(credentialGuidePath("notion"), "docs/connectors/notion-credentials.md");
  assert.equal(credentialGuidePath("slack"), "docs/connectors/slack-credentials.md");
});
