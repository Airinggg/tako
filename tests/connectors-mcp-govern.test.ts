import assert from "node:assert/strict";
import test from "node:test";
import { McpClient, type JsonRpcRequest, type JsonRpcResponse, type Transport } from "../lib/connectors/mcp/client.ts";
import { collectMcp } from "../lib/connectors/mcp/collect.ts";
import { GovernedMcpClient, RESOURCE_READ_INPUT_SCHEMA, schemaHash, type McpGovernance } from "../lib/connectors/mcp/govern.ts";

function governance(readSources = ["wiki"]): McpGovernance {
  return {
    connector: "wiki@1.0.0",
    tool: {
      name: "resources_read", source: "wiki", inputSchemaHash: `sha256:${"0".repeat(64)}`,
      risk: "read", approval: "none", idempotency: "none", timeoutMs: 5_000,
      maxAttempts: 1, dataClassifications: ["internal"], enabledByDefault: false,
      verificationRequired: false,
    },
    scope: { name: "engineering", readSources }, dataClass: "internal", env: "dev",
    now: () => "2026-08-31T00:00:00.000Z",
  };
}

function server(counter: { reads: number }): Transport {
  return async (req: JsonRpcRequest): Promise<JsonRpcResponse> => {
    const ok = (result: unknown) => ({ jsonrpc: "2.0" as const, id: req.id, result });
    if (req.method === "initialize") return ok({ serverInfo: { name: "wiki", version: "1" } });
    if (req.method === "resources/list") return ok({ resources: [{ uri: "wiki://secret", name: "Secret" }] });
    if (req.method === "resources/read") {
      counter.reads += 1;
      return ok({ contents: [{ uri: "wiki://secret", text: "Owner ada@example.com" }] });
    }
    return { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "missing" } };
  };
}

test("governed collection evaluates, redacts, hashes, and emits an audit line", async () => {
  const counter = { reads: 0 };
  const result = await collectMcp("wiki", server(counter), { governance: governance() });
  assert.equal(counter.reads, 1);
  assert.equal(result.items.length, 1);
  assert.doesNotMatch(result.items[0].text, /ada@example\.com/);
  assert.deepEqual(result.audit.map((line) => line.decision), ["allow"]);
  assert.equal(result.audit[0].inputSchemaHash, schemaHash(RESOURCE_READ_INPUT_SCHEMA));
  assert.match(result.audit[0].resultHash ?? "", /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(result.audit[0].redactionHits.map((hit) => hit.rule), ["email"]);
});

test("an out-of-scope read is blocked and audited without fetching", async () => {
  const counter = { reads: 0 };
  const client = new GovernedMcpClient(new McpClient(server(counter)), governance(["erp"]));
  const result = await client.readResource("wiki://secret");
  assert.equal(counter.reads, 0);
  assert.equal(result.blocked?.decision, "deny");
  assert.match(result.audit.reason, /^source-out-of-scope/);
  assert.equal(result.audit.resultHash, null);
});

test("audit summaries never retain raw redaction matches", async () => {
  const counter = { reads: 0 };
  const result = await collectMcp("wiki", server(counter), { governance: governance() });
  assert.doesNotMatch(JSON.stringify(result.audit), /ada@example\.com/);
});

test("a block-level redaction suppresses the item and records a denied audit", async () => {
  const blockedServer: Transport = async (request) => {
    const ok = (result: unknown) => ({ jsonrpc: "2.0" as const, id: request.id, result });
    if (request.method === "initialize") return ok({ serverInfo: { name: "wiki" } });
    if (request.method === "resources/list") return ok({ resources: [{ uri: "wiki://token", name: "Token" }] });
    return ok({ contents: [{ uri: "wiki://token", text: "xoxb-123456789012-abcdefghijklmnop" }] });
  };
  const result = await collectMcp("wiki", blockedServer, { governance: governance() });
  assert.deepEqual(result.items, []);
  assert.equal(result.blocked[0].reason, "result-redaction-blocked");
  assert.equal(result.audit[0].decision, "deny");
  assert.doesNotMatch(JSON.stringify(result.audit), /xoxb-/);
});

test("an upstream read failure is still audited and does not fail the collection", async () => {
  const counter = { reads: 0 };
  const failing: Transport = async (request) => {
    if (request.method === "initialize") return { jsonrpc: "2.0", id: request.id, result: { serverInfo: { name: "wiki" } } };
    if (request.method === "resources/list") return { jsonrpc: "2.0", id: request.id, result: { resources: [{ uri: "wiki://gone", name: "Gone" }] } };
    counter.reads += 1;
    return { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "gone" } };
  };
  const result = await collectMcp("wiki", failing, { governance: governance() });
  assert.equal(counter.reads, 1);
  assert.deepEqual(result.items, []);
  assert.match(result.audit[0].reason, /upstream-read-failed/);
  assert.equal(result.audit[0].resultHash, null);
});
