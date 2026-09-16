import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateManifest } from "../lib/govern/manifest.ts";

const sample = () => JSON.parse(readFileSync(new URL("../docs/mcp-ipaas/sample-connector-manifest.json", import.meta.url), "utf8"));

test("sample industrial connector manifest passes", () => {
  assert.deepEqual(validateManifest(sample()), { ok: true, errors: [] });
});

test("literal secrets are rejected", () => {
  const manifest = sample();
  manifest.auth.secretRefs = ["top-secret-token"];
  const result = validateManifest(manifest);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /literal secrets are forbidden/);
});

test("mutable versions and enabled-by-default tools are rejected", () => {
  const manifest = sample();
  manifest.version = "latest";
  manifest.tools[0].enabledByDefault = true;
  const result = validateManifest(manifest);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /immutable semantic version/);
  assert.match(result.errors.join("\n"), /deny by default/);
});

test("a destructive tool must always require approval and exactly one attempt", () => {
  const manifest = sample();
  manifest.tools[0] = {
    ...manifest.tools[0], risk: "destructive", approval: "policy", maxAttempts: 2,
    checkpointRequired: true, verificationRequired: true,
  };
  const result = validateManifest(manifest);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /destructive tools require always/);
  assert.match(result.errors.join("\n"), /exactly one attempt/);
});
