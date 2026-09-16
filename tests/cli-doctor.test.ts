import assert from "node:assert/strict";
import test from "node:test";
import { checkBunVersion, checkConnectorsConfig, checkGbrainHome, checkModelsPulled, formatReport, parseOllamaTags } from "../lib/cli/doctor.ts";

test("checkBunVersion passes at and above the minimum, fails below it", () => {
  assert.equal(checkBunVersion("1.3.10").ok, true);
  assert.equal(checkBunVersion("1.4.0").ok, true);
  assert.equal(checkBunVersion("1.10.0").ok, true);
  assert.equal(checkBunVersion("1.3.9").ok, false);
  assert.equal(checkBunVersion("1.2.99").ok, false);
  assert.match(checkBunVersion("1.2.0").fix ?? "", /bun\.sh\/install/);
});

test("parseOllamaTags extracts model names from the /api/tags shape", () => {
  assert.deepEqual(parseOllamaTags({ models: [{ name: "bge-m3:latest" }, { name: "qwen3.5:9b" }] }), ["bge-m3:latest", "qwen3.5:9b"]);
  assert.deepEqual(parseOllamaTags({ models: [] }), []);
  assert.deepEqual(parseOllamaTags({}), []);
});

test("checkModelsPulled matches by prefix, not exact string", () => {
  const results = checkModelsPulled(["bge-m3:latest", "qwen3.5:9b-instruct"]);
  assert.equal(results.length, 2);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, true);
});

test("checkModelsPulled fails a model that isn't present at all", () => {
  const results = checkModelsPulled(["llama3:8b"]);
  assert.equal(results.every((r) => !r.ok), true);
  for (const r of results) assert.match(r.fix ?? "", /^ollama pull /);
});

test("checkGbrainHome and checkConnectorsConfig are advisory, never failing", () => {
  assert.equal(checkGbrainHome(false, "/tmp/x").ok, true);
  assert.equal(checkGbrainHome(true, "/tmp/x").ok, true);
  assert.equal(checkConnectorsConfig(false, "config/connectors.json").ok, true);
  assert.match(checkConnectorsConfig(false, "config/connectors.json").fix ?? "", /omnibrain setup/);
});

test("formatReport summarises pass/fail and lists fixes only for failures", () => {
  const report = formatReport([
    { name: "a", ok: true, detail: "fine" },
    { name: "b", ok: false, detail: "broken", fix: "do the thing" },
  ]);
  assert.match(report, /✓ a — fine/);
  assert.match(report, /✗ b — broken/);
  assert.match(report, /do the thing/);
  assert.match(report, /1 check\(s\) failed/);
});

test("formatReport reports all-clear when nothing failed", () => {
  const report = formatReport([{ name: "a", ok: true, detail: "fine" }]);
  assert.match(report, /All checks passed/);
});
