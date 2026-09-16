import assert from "node:assert/strict";
import test from "node:test";
import { McpClient, type JsonRpcRequest, type JsonRpcResponse, type Transport } from "../lib/connectors/mcp/client.ts";
import { collectMcp } from "../lib/connectors/mcp/collect.ts";
import { renderMcp } from "../lib/connectors/mcp/render.ts";
import type { McpGovernance } from "../lib/connectors/mcp/govern.ts";

/** A tiny in-memory MCP server: initialize + paginated resources/list + resources/read. */
function fakeServer(resources: { uri: string; name: string; mimeType?: string; description?: string }[],
  bodies: Record<string, { text?: string; blob?: string; mimeType?: string }[]>): Transport {
  return async (req: JsonRpcRequest): Promise<JsonRpcResponse> => {
    const ok = (result: unknown) => ({ jsonrpc: "2.0" as const, id: req.id, result });
    if (req.method === "initialize") return ok({ protocolVersion: "2025-06-18", serverInfo: { name: "fake-wiki", version: "9.9" }, capabilities: { resources: {} } });
    if (req.method === "resources/list") {
      const cursor = (req.params as any)?.cursor;
      if (!cursor) return ok({ resources: resources.slice(0, 1), nextCursor: "p2" });
      if (cursor === "p2") return ok({ resources: resources.slice(1) });
      return ok({ resources: [] });
    }
    if (req.method === "resources/read") {
      const uri = (req.params as any).uri as string;
      if (!(uri in bodies)) return { jsonrpc: "2.0", id: req.id, error: { code: -32602, message: "no such resource" } };
      return ok({ contents: bodies[uri].map((c) => ({ uri, ...c })) });
    }
    return { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "method not found" } };
  };
}

const resources = [
  { uri: "wiki://space/HOME", name: "Home", mimeType: "text/markdown" },
  { uri: "wiki://space/RUNBOOK", name: "Runbook", mimeType: "text/markdown", description: "Ops runbook" },
  { uri: "wiki://attach/logo.png", name: "logo.png", mimeType: "image/png" },
  { uri: "wiki://space/BROKEN", name: "Broken", mimeType: "text/markdown" },
];
const bodies = {
  "wiki://space/HOME": [{ text: "# Home\n\nWelcome.", mimeType: "text/markdown" }],
  "wiki://space/RUNBOOK": [{ text: "1. page on-call\n2. check dashboards", mimeType: "text/markdown" }],
  "wiki://attach/logo.png": [{ blob: "aGVsbG8=", mimeType: "image/png" }],
  // BROKEN intentionally absent -> read errors -> skipped
};

const governance = (extra: Partial<McpGovernance> = {}): McpGovernance => ({
  connector: "wiki@1.0.0",
  tool: {
    name: "resources_read", source: "wiki", inputSchemaHash: `sha256:${"0".repeat(64)}`,
    risk: "read", approval: "none", idempotency: "none", timeoutMs: 5_000,
    maxAttempts: 1, dataClassifications: ["internal"], enabledByDefault: false,
    verificationRequired: false,
  },
  scope: { name: "engineering", readSources: ["wiki"] },
  dataClass: "internal", env: "dev", now: () => "2026-08-31T00:00:00.000Z",
  ...extra,
});

test("McpClient.listResources follows nextCursor", async () => {
  const c = new McpClient(fakeServer(resources, bodies));
  const list = await c.listResources();
  assert.deepEqual(list.map((r) => r.uri), resources.map((r) => r.uri));
});

test("collectMcp initialises, reads textual resources, skips binaries and unreadable ones", async () => {
  const { items } = await collectMcp("wiki", fakeServer(resources, bodies), { governance: governance() });
  assert.deepEqual(items.map((i) => i.uri), ["wiki://space/HOME", "wiki://space/RUNBOOK"]);
  assert.equal(items[0].serverName, "fake-wiki");
  assert.equal(items[1].description, "Ops runbook");
  assert.match(items[1].text, /page on-call/);
});

test("collectMcp keeps a binary resource only if it also returns text", async () => {
  const withText = { ...bodies, "wiki://attach/logo.png": [{ text: "alt: company logo", mimeType: "image/png" }] };
  const { items } = await collectMcp("wiki", fakeServer(resources, withText as any), { governance: governance() });
  assert.ok(items.some((i) => i.uri === "wiki://attach/logo.png" && /company logo/.test(i.text)));
});

test("renderMcp produces a deterministic, collision-resistant path with frontmatter", async () => {
  const { items: [home, runbook] } = await collectMcp("wiki", fakeServer(resources, bodies), { governance: governance() });
  const r = renderMcp(runbook);
  assert.match(r.path, /^mcp\/wiki\/space\/runbook-[a-z0-9]{6}\.md$/);
  assert.match(r.markdown, /^---\nsource: mcp\nmcp_server: "wiki"\nserver_name: "fake-wiki"\nuri: "wiki:\/\/space\/RUNBOOK"/);
  assert.match(r.markdown, /# Runbook/);
  assert.match(r.markdown, /1\. page on-call/);

  // different URIs never collide even if the tail slug matches
  assert.notEqual(renderMcp(home).path, r.path);
  assert.equal(renderMcp(runbook).markdown, renderMcp(runbook).markdown); // stable
});
