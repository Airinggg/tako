import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

test("serve-runtime's GBRAIN_HOME respects a GBRAIN_HOME override", () => {
  // Use a subprocess with bun to test env var handling
  // This avoids issues with import.meta.dir in Node.js
  const dir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(dir, "..");
  
  // Create a small eval script to import and print GBRAIN_HOME
  const code = 'import { GBRAIN_HOME } from "./lib/cli/serve-runtime.ts"; console.log(GBRAIN_HOME);';
  
  const result = spawnSync("bun", ["--eval", code], {
    cwd: repoRoot,
    env: { ...process.env, GBRAIN_HOME: "/tmp/test-override-brain" },
    encoding: "utf8",
  });
  
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`bun eval failed: ${result.stderr}`);
  
  const output = result.stdout.trim();
  assert.equal(
    output,
    "/tmp/test-override-brain",
    `Expected GBRAIN_HOME to be /tmp/test-override-brain but got ${output}`
  );
});