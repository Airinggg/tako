import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderLaunchAgentPlist } from "../lib/cli/launch-agent.ts";

const SAMPLE_OPTS = {
  label: "com.tako.demo",
  bunPath: "/opt/homebrew/bin/bun",
  scriptPath: "/Users/test/tako/scripts/demo.ts",
  workingDirectory: "/Users/test/tako",
  stdoutPath: "/Users/test/Library/Logs/tako/demo.log",
  stderrPath: "/Users/test/Library/Logs/tako/demo.log",
};

test("renderLaunchAgentPlist produces valid plist XML with the required keys", () => {
  const xml = renderLaunchAgentPlist(SAMPLE_OPTS);
  for (const key of ["Label", "ProgramArguments", "KeepAlive", "StandardOutPath", "StandardErrorPath", "WorkingDirectory"]) {
    assert.match(xml, new RegExp(`<key>${key}</key>`));
  }
  // plutil -lint is macOS's own plist validator -- real syntactic
  // validation, not just "does it look like XML."
  const tmp = join(tmpdir(), `launch-agent-test-${Date.now()}.plist`);
  writeFileSync(tmp, xml);
  try {
    execFileSync("plutil", ["-lint", tmp], { encoding: "utf8" });
  } finally {
    unlinkSync(tmp);
  }
});

test("renderLaunchAgentPlist escapes XML-special characters in paths", () => {
  const xml = renderLaunchAgentPlist({ ...SAMPLE_OPTS, workingDirectory: "/Users/test/tako & co" });
  assert.match(xml, /tako &amp; co/);
  assert.doesNotMatch(xml, /tako & co</);
});

test("renderLaunchAgentPlist sets KeepAlive and RunAtLoad true, for an always-on background service", () => {
  const xml = renderLaunchAgentPlist(SAMPLE_OPTS);
  assert.match(xml, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
});
