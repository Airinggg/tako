import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";

test("connectors:all skips absent blocks and unresolved tokens", () => {
  const result = spawnSync("bun", ["scripts/run-connectors.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      CONNECTORS_CONFIG_PATH: "tests/__fixtures__/connectors-partial.json",
      CONNECTORS_DRY_RUN: "1",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[notion\] skipped: token absent/);
  assert.match(result.stdout, /\[notes\] ready/);
  assert.match(result.stdout, /\[drive\] skipped: config block absent/);
  assert.match(result.stdout, /\[cad\] ready/);
});
