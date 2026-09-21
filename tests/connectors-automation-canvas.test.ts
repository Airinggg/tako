import assert from "node:assert/strict";
import test from "node:test";
import { skillToEdge, edgeInputToAutomationPayload, TRIGGER_NODE_TO_STRING } from "../lib/connectors/automation-canvas/adapter.ts";
import { AB_TRIGGER_OPTIONS } from "../scripts/demo.ts";

test("skillToEdge maps a well-formed automation to a canvas edge", () => {
  const edge = skillToEdge({
    name: "summarize-and-post",
    trigger: "New message in Slack",
    procedureSteps: ["Summarize the content", "Post to Slack"],
  });
  assert.deepEqual(edge, {
    automationName: "summarize-and-post",
    triggerNode: "slack",
    actionSteps: ["Summarize the content", "Post to Slack"],
  });
});

test("skillToEdge maps every known trigger string to its node id", () => {
  const cases: Array<[string, string]> = [
    ["New file added to Drive", "drive"],
    ["New page added to Notion", "notion"],
    ["New message in Slack", "slack"],
    ["Every Monday morning", "schedule"],
    ["Manual", "manual"],
  ];
  for (const [trigger, expected] of cases) {
    const edge = skillToEdge({ name: "x", trigger, procedureSteps: ["a", "b"] });
    assert.equal(edge?.triggerNode, expected);
  }
});

test("skillToEdge returns null for an unrecognized trigger string", () => {
  const edge = skillToEdge({ name: "hand-edited", trigger: "Something nobody selected", procedureSteps: ["a", "b"] });
  assert.equal(edge, null);
});

test("skillToEdge returns null when procedureSteps isn't exactly two entries", () => {
  assert.equal(skillToEdge({ name: "x", trigger: "Manual", procedureSteps: [] }), null);
  assert.equal(skillToEdge({ name: "x", trigger: "Manual", procedureSteps: ["only-one"] }), null);
  assert.equal(skillToEdge({ name: "x", trigger: "Manual", procedureSteps: ["a", "b", "c"] }), null);
});

test("edgeInputToAutomationPayload reverses the trigger-node mapping", () => {
  const payload = edgeInputToAutomationPayload("notion", ["Draft a notification", "Notify the team channel"]);
  assert.deepEqual(payload, {
    trigger: "New page added to Notion",
    action1: "Draft a notification",
    action2: "Notify the team channel",
  });
});

test("skillToEdge and edgeInputToAutomationPayload round-trip for every trigger", () => {
  for (const trigger of Object.values(TRIGGER_NODE_TO_STRING)) {
    const edge = skillToEdge({ name: "x", trigger, procedureSteps: ["Summarize the content", "Post to Slack"] });
    assert.ok(edge);
    const payload = edgeInputToAutomationPayload(edge!.triggerNode, edge!.actionSteps);
    assert.equal(payload.trigger, trigger);
  }
});

test("every adapter trigger string is one of the builder's real AB_TRIGGER_OPTIONS", () => {
  for (const str of Object.values(TRIGGER_NODE_TO_STRING)) {
    assert.ok(AB_TRIGGER_OPTIONS.includes(str), `"${str}" is not in AB_TRIGGER_OPTIONS`);
  }
  assert.equal(Object.values(TRIGGER_NODE_TO_STRING).length, AB_TRIGGER_OPTIONS.length);
});
