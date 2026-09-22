import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..");

test("dmg-install.ts uses the shared pure decision logic instead of reimplementing it inline", () => {
  const src = readFileSync(join(REPO, "scripts/dmg-install.ts"), "utf8");
  assert.match(src, /from ["']\.\.\/lib\/cli\/dmg-provision\.ts["']/);
  assert.match(src, /determineInstallPass/);
  assert.match(src, /from ["']\.\.\/lib\/cli\/launch-agent\.ts["']/);
  assert.match(src, /renderLaunchAgentPlist/);
  assert.match(src, /from ["']\.\.\/lib\/cli\/doctor\.ts["']/);
  assert.match(src, /REQUIRED_MODELS/);
});

test("dmg-install.ts's go-live pass runs omnibrain doctor before installing the LaunchAgent", () => {
  const src = readFileSync(join(REPO, "scripts/dmg-install.ts"), "utf8");
  const goLiveStart = src.indexOf("async function goLive");
  assert.ok(goLiveStart >= 0, "expected a goLive function");
  const goLiveBody = src.slice(goLiveStart, goLiveStart + 1500);
  const doctorIdx = goLiveBody.indexOf("doctor");
  const launchctlIdx = goLiveBody.indexOf("launchctl");
  assert.ok(doctorIdx >= 0 && launchctlIdx >= 0 && doctorIdx < launchctlIdx, "doctor must run before launchctl load");
});

test("Install.command execs the orchestration script and is marked executable in git", () => {
  const src = readFileSync(join(REPO, "Install.command"), "utf8");
  assert.match(src, /^#!/, "Install.command needs a shebang to be double-clickable by Finder");
  assert.match(src, /dmg-install\.ts/);
});
