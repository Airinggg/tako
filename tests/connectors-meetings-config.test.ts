import assert from "node:assert/strict";
import test from "node:test";
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMeetingInboxConfig, writeMeetingWorkspaceCatalog } from "../lib/connectors/shared/config.ts";

function base(root: string): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    inboxRoot: root,
    processedRecoveryDays: 7,
    workspaces: [{ id: "engineering", label: "Engineering", sourceId: "engineering-meetings", classification: "internal", retentionDays: 90, enabled: true }],
  };
}

async function load(value: unknown) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "tako-meeting-config-")));
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(value));
  return loadMeetingInboxConfig(path);
}

test("loads an exact internal-only config with a server-owned source mapping", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tako-meeting-root-")));
  const config = await load(base(root));
  assert.equal(config.processedRecoveryDays, 7);
  assert.equal(config.workspaces[0].classification, "internal");
  assert.equal(config.workspaces[0].sourceId, "engineering-meetings");
});

test("rejects non-canonical roots, recovery periods other than seven and unsafe or duplicate workspaces", async () => {
  await assert.rejects(() => load(base("relative/inbox")), /canonical absolute/);
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tako-meeting-root-")));
  await assert.rejects(() => load({ ...base(root), processedRecoveryDays: 30 }), /must equal 7/);
  const unsafe = base(root) as any;
  unsafe.workspaces[0].sourceId = "../escape";
  await assert.rejects(() => load(unsafe), /path-safe/);
  const duplicate = base(root) as any;
  duplicate.workspaces.push({ ...duplicate.workspaces[0] });
  await assert.rejects(() => load(duplicate), /must be unique/);
  const confidential = base(root) as any;
  confidential.workspaces[0].classification = "confidential";
  await assert.rejects(() => load(confidential), /must equal internal/);
});

test("writes an owner-only catalog containing only enabled public choices", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tako-meeting-root-")));
  mkdirSync(join(root, "ready"), { mode: 0o700 });
  const config = await load(base(root));
  config.workspaces.push({ id: "disabled", label: "Disabled", sourceId: "disabled-meetings", classification: "internal", retentionDays: 90, enabled: false });
  const path = writeMeetingWorkspaceCatalog(config, "2026-09-18T00:00:00.000Z");
  const catalog = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(catalog, {
    schemaVersion: "1.0",
    workspaces: [{ id: "engineering", label: "Engineering", classification: "internal" }],
    updatedAt: "2026-09-18T00:00:00.000Z",
  });
  assert.equal(lstatSync(path).mode & 0o777, 0o600);
  assert.doesNotMatch(JSON.stringify(catalog), /sourceId|retentionDays|inboxRoot/);
});
