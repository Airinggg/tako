import assert from "node:assert/strict";
import test from "node:test";
import { determineInstallPass, needsProvisioning } from "../lib/cli/dmg-provision.ts";

test("needsProvisioning is the inverse of commandFound", () => {
  assert.equal(needsProvisioning(true), false);
  assert.equal(needsProvisioning(false), true);
});

test("determineInstallPass returns provision when connectors.json doesn't exist yet", () => {
  assert.equal(determineInstallPass(false, null, {}), "provision");
});

test("determineInstallPass returns provision when a scaffolded placeholder's env var isn't set", () => {
  const config = { slack: { token: "env:SLACK_BOT_TOKEN" } };
  assert.equal(determineInstallPass(true, config, {}), "provision");
});

test("determineInstallPass returns go-live once the placeholder's env var is set", () => {
  const config = { slack: { token: "env:SLACK_BOT_TOKEN" } };
  assert.equal(determineInstallPass(true, config, { SLACK_BOT_TOKEN: "xoxb-real" }), "go-live");
});

test("determineInstallPass returns go-live when the owner hardcoded a real token directly, bypassing the env: convention", () => {
  const config = { slack: { token: "xoxb-11904732386992-real-token" } };
  assert.equal(determineInstallPass(true, config, {}), "go-live");
});

test("determineInstallPass with a mix of connectors stays in provision until every placeholder is resolved", () => {
  const config = {
    slack: { token: "xoxb-real-token" },
    drive: { token: "env:GOOGLE_DRIVE_ACCESS_TOKEN" },
  };
  assert.equal(determineInstallPass(true, config, {}), "provision");
  assert.equal(determineInstallPass(true, config, { GOOGLE_DRIVE_ACCESS_TOKEN: "ya29.real" }), "go-live");
});
