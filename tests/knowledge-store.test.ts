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

import { getKnowledgeItem, upsertKnowledgeItem } from "../lib/knowledge/store.ts";
import { recordReviewerDecision, markUnderReview } from "../lib/knowledge/model.ts";

test("upsertKnowledgeItem inserts a new item and updates an existing one by id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tako-knowledge-store-"));
  const path = join(dir, "knowledge-items.json");
  try {
    const item = sampleItem();
    upsertKnowledgeItem(item, path);
    assert.deepEqual(loadKnowledgeItems(path), [item]);

    const approved = recordReviewerDecision(markUnderReview(item, "rev_1", NOW), "approved", "Taro", "", NOW);
    upsertKnowledgeItem(approved, path);
    const stored = loadKnowledgeItems(path);
    assert.equal(stored.length, 1, "same id must update in place, not append a duplicate row");
    assert.equal(stored[0].status, "approved");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("getKnowledgeItem finds an item by id or returns undefined", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tako-knowledge-store-"));
  const path = join(dir, "knowledge-items.json");
  try {
    const item = sampleItem();
    upsertKnowledgeItem(item, path);
    assert.deepEqual(getKnowledgeItem(item.id, path), item);
    assert.equal(getKnowledgeItem("ki_does_not_exist", path), undefined);
  } finally {
    await rm(dir, { recursive: true });
  }
});
