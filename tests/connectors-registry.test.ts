import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import {
  CONNECTORS, CONNECTOR_NAMES, connectorDescriptor, connectorRunner, isConnectorName,
} from "../lib/connectors/registry.ts";

const repo = fileURLToPath(new URL("..", import.meta.url));

test("every connector is named once and exposes a uniform shape", () => {
  assert.deepEqual([...CONNECTOR_NAMES], ["notion", "slack", "drive", "discord", "notes", "cad", "meetings"]);
  assert.equal(new Set(CONNECTOR_NAMES).size, CONNECTORS.length, "connector names must be unique");
  for (const c of CONNECTORS) {
    assert.equal(typeof c.needsToken, "boolean", `${c.name} must declare needsToken`);
  }
});

test("the retired solidworks alias is gone from the registry", () => {
  assert.equal(isConnectorName("solidworks"), false);
  assert.equal(connectorDescriptor("solidworks"), undefined);
  assert.equal(isConnectorName("cad"), true);
});

test("only remote connectors require a token; file-based ones do not", () => {
  const needs = CONNECTORS.filter((c) => c.needsToken).map((c) => c.name);
  assert.deepEqual(needs, ["notion", "slack", "drive", "discord"]);
  assert.equal(connectorDescriptor("notes")?.needsToken, false);
  assert.equal(connectorDescriptor("cad")?.needsToken, false);
  assert.equal(connectorDescriptor("meetings")?.needsToken, false);
});

test("cad re-reads a whole export, so it gets a slower default cadence", () => {
  assert.equal(connectorDescriptor("cad")?.defaultIntervalSeconds, 900);
  // API connectors fall through to the daemon's own default
  assert.equal(connectorDescriptor("notion")?.defaultIntervalSeconds, undefined);
});

test("meetings polls the local inbox conservatively", () => {
  assert.equal(connectorDescriptor("meetings")?.defaultIntervalSeconds, 600);
});

test("every registered connector has a runner on disk and an npm script", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const name of CONNECTOR_NAMES) {
    const runner = connectorRunner(name);
    assert.equal(runner, `lib/connectors/${name}/run.ts`);
    assert.ok(existsSync(repo + runner), `${runner} must exist`);
    assert.equal(pkg.scripts[`connectors:${name}`], `bun ${runner}`,
      `package.json needs connectors:${name}`);
  }
  assert.equal(pkg.scripts["connectors:solidworks"], undefined, "retired alias must be gone");
});
