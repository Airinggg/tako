import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSecret } from "../lib/connectors/shared/config.ts";
import { writePrivateFileAtomic } from "../lib/util/private-file.ts";

test("resolves every env-configured connector token without exposing the placeholder (regression for #7)", () => {
  const env = {
    NOTION_TOKEN: "notion-secret",
    SLACK_BOT_TOKEN: "slack-secret",
    GOOGLE_DRIVE_ACCESS_TOKEN: "drive-secret",
    DISCORD_BOT_TOKEN: "discord-secret",
  };
  for (const [name, expected] of Object.entries(env)) {
    assert.equal(resolveSecret(`env:${name}`, env), expected);
  }
  assert.equal(resolveSecret("literal-token", env), "literal-token");
  assert.throws(() => resolveSecret("env:MISSING_TOKEN", env), /Environment variable MISSING_TOKEN is required/);
});

test("connector credential files are atomically written with owner-only permissions (regression for #9)", { skip: process.platform === "win32" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "tako-private-file-"));
  const path = join(dir, "connectors.json");
  writePrivateFileAtomic(path, '{"token":"placeholder"}\n');

  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(await readFile(path, "utf8"), '{"token":"placeholder"}\n');
});

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
