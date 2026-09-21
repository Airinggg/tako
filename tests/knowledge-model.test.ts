import assert from "node:assert/strict";
import test from "node:test";
import {
  canApproveKnowledgeItem, KNOWLEDGE_STATUSES, KNOWLEDGE_TYPES, latestReviewerDecision,
  newKnowledgeItem, type KnowledgeItem,
} from "../lib/knowledge/model.ts";

const NOW = "2026-09-22T00:00:00.000Z";

function base(over: Partial<Parameters<typeof newKnowledgeItem>[0]> = {}): KnowledgeItem {
  return newKnowledgeItem({
    type: "procedure",
    title: "How to request a new connector",
    description: "Steps to get a new data source onboarded and approved.",
    evidence: [{ pageSlug: "notion/onboarding/connector-request", excerpt: "File a request via..." }],
    sourceWorkspace: "engineering",
    sourceConnector: "notion",
    classification: "internal",
    origin: "source-authored",
    ownerId: "grace@example.com",
    retention: { policyRef: "workspace-default-90d", deletionImplication: "removed when the source page is deleted" },
    now: NOW,
    ...over,
  });
}

test("newKnowledgeItem starts in draft with no review history and a stable id prefix", () => {
  const item = base();
  assert.equal(item.status, "draft");
  assert.deepEqual(item.reviewHistory, []);
  assert.deepEqual(item.relations, []);
  assert.equal(latestReviewerDecision(item), null);
  assert.ok(item.id.startsWith("ki_"));
  assert.equal(item.createdAt, NOW);
  assert.equal(item.sourceUpdatedAt, null);
  assert.equal(item.lastReviewedAt, null);
  assert.equal(item.nextFreshnessReviewAt, null);
});

test("KNOWLEDGE_TYPES and KNOWLEDGE_STATUSES list the 8 types and 6 statuses the spec defines", () => {
  assert.deepEqual(KNOWLEDGE_TYPES, [
    "policy", "procedure", "decision", "project",
    "customer_product", "team_role", "onboarding", "open_action",
  ]);
  assert.deepEqual(KNOWLEDGE_STATUSES, [
    "draft", "under_review", "approved", "superseded", "rejected", "archived",
  ]);
});

test("canApproveKnowledgeItem requires at least one evidence anchor", () => {
  const withEvidence = base();
  assert.equal(canApproveKnowledgeItem(withEvidence).ok, true);

  const noEvidence = base({ evidence: [] });
  const result = canApproveKnowledgeItem(noEvidence);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => /evidence/i.test(r)));
});

test("canApproveKnowledgeItem requires a non-blank ownerId", () => {
  const result = canApproveKnowledgeItem(base({ ownerId: "" }));
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => /owner/i.test(r)));
});
