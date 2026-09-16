import assert from "node:assert/strict";
import test from "node:test";
import { evaluate, type ToolPolicy } from "../lib/govern/policy.ts";

const tool = (risk: ToolPolicy["risk"], extra: Partial<ToolPolicy> = {}): ToolPolicy => ({
  name: `test_${risk}`, source: "cad", inputSchemaHash: `sha256:${"1".repeat(64)}`,
  risk, approval: risk === "read" ? "none" : "always", idempotency: "none",
  timeoutMs: 5_000, maxAttempts: 1, dataClassifications: ["internal"],
  enabledByDefault: false, verificationRequired: risk !== "read", ...extra,
});
const input = (risk: ToolPolicy["risk"], extra: Record<string, unknown> = {}) => ({
  tool: tool(risk), args: {}, scope: { name: "engineering", readSources: ["cad"] },
  dataClass: "internal" as const, env: "dev" as const, ...extra,
});

test("read is allowed inside classification and scope gates", () => {
  assert.deepEqual(evaluate(input("read")), { decision: "allow", reason: "read-entitled:engineering" });
});

test("create-isolated and mutate require approval", () => {
  assert.equal(evaluate(input("create-isolated")).decision, "approval-required");
  assert.equal(evaluate(input("mutate")).decision, "approval-required");
});

test("create-isolated can never overwrite production", () => {
  assert.deepEqual(evaluate({ ...input("create-isolated"), env: "prod", args: { overwrite: true } }), {
    decision: "deny", reason: "production-overwrite-forbidden",
  });
});

test("destructive and physical-control are denied", () => {
  assert.equal(evaluate(input("destructive")).decision, "deny");
  assert.equal(evaluate(input("physical-control")).decision, "deny");
});

test("unknown tools, disallowed data, and out-of-scope sources are denied", () => {
  assert.equal(evaluate({ ...input("read"), tool: { ...tool("read"), risk: "unknown" as any } }).reason, "unknown-tool-risk");
  assert.match(evaluate({ ...input("read"), dataClass: "restricted" }).reason, /^data-classification-not-allowed/);
  assert.match(evaluate({ ...input("read"), scope: { name: "finance", readSources: ["erp"] } }).reason, /^source-out-of-scope/);
});
