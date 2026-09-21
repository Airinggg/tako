import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { newKnowledgeItem } from "../lib/knowledge/model.ts";
import { loadKnowledgeItems, saveKnowledgeItems } from "../lib/knowledge/store.ts";

const NOW = "2026-09-22T00:00:00.000Z";

function sampleItem() {
  return newKnowledgeItem({
    type: "policy",
    title: "Remote work expense policy",
    description: "What counts as a reimbursable remote-work expense.",
    evidence: [{ pageSlug: "notion/hr/remote-expense-policy" }],
    sourceWorkspace: "hr",
    sourceConnector: "notion",
    classification: "internal",
    origin: "source-authored",
    ownerId: "hr-team@example.com",
    retention: { policyRef: "workspace-default-90d", deletionImplication: "removed if the HR page is deleted" },
    now: NOW,
  });
}

test("missing and corrupt store files are treated as empty, not an error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tako-knowledge-store-"));
  const path = join(dir, "knowledge-items.json");
  try {
    assert.deepEqual(loadKnowledgeItems(path), []);
    await writeFile(path, "not json\n");
    assert.deepEqual(loadKnowledgeItems(path), []);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("saveKnowledgeItems writes atomically, owner-only, and round-trips", { skip: process.platform === "win32" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "tako-knowledge-store-"));
  const path = join(dir, "knowledge-items.json");
  const items = [sampleItem()];
  try {
    saveKnowledgeItems(items, path);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await readFile(path, "utf8")).endsWith("\n"), true);
    assert.deepEqual(loadKnowledgeItems(path), items);
  } finally {
    await rm(dir, { recursive: true });
  }
});
