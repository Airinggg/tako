import assert from "node:assert/strict";
import test from "node:test";
import { newKnowledgeItem, recordFreshnessCheck, recordReviewerDecision, markUnderReview, type KnowledgeItem } from "../lib/knowledge/model.ts";
import { findStaleOrUnresolvedKnowledgeItems } from "../lib/knowledge/queries.ts";

const NOW = "2026-09-23T00:00:00.000Z";

function base(over: Partial<Parameters<typeof newKnowledgeItem>[0]> = {}): KnowledgeItem {
  return newKnowledgeItem({
    type: "procedure",
    title: "How to request a new connector",
    description: "Steps to get a new data source onboarded.",
    evidence: [{ pageSlug: "notion/onboarding/connector-request" }],
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

test("an approved item past its freshness-review date gets freshness_due", () => {
  const approved = recordReviewerDecision(markUnderReview(base(), "rev_1", NOW), "approved", "Taro", "", NOW);
  const overdue = recordFreshnessCheck(approved, "2026-09-01T00:00:00.000Z", NOW);
  const result = findStaleOrUnresolvedKnowledgeItems([overdue], "2026-09-23T00:00:00.000Z");
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].reasons, ["freshness_due"]);
});

test("an under_review item gets unresolved_review", () => {
  const underReview = markUnderReview(base(), "rev_2", NOW);
  const result = findStaleOrUnresolvedKnowledgeItems([underReview], NOW);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].reasons, ["unresolved_review"]);
});

test("a draft item with no owner gets ownerless", () => {
  const ownerless = base({ ownerId: "" });
  const result = findStaleOrUnresolvedKnowledgeItems([ownerless], NOW);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].reasons, ["ownerless"]);
});

test("a rejected item with no owner is settled — no reasons, not returned", () => {
  const rejected = recordReviewerDecision(markUnderReview(base({ ownerId: "" }), "rev_3", NOW), "rejected", "Taro", "", NOW);
  const result = findStaleOrUnresolvedKnowledgeItems([rejected], NOW);
  assert.equal(result.length, 0);
});

test("an item can carry multiple reasons at once", () => {
  const underReviewAndOwnerless = markUnderReview(base({ ownerId: "" }), "rev_4", NOW);
  const result = findStaleOrUnresolvedKnowledgeItems([underReviewAndOwnerless], NOW);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].reasons.sort(), ["ownerless", "unresolved_review"]);
});

test("a fresh, owned, approved item is not returned", () => {
  const approved = recordReviewerDecision(markUnderReview(base(), "rev_5", NOW), "approved", "Taro", "", NOW);
  const fresh = recordFreshnessCheck(approved, "2099-01-01T00:00:00.000Z", NOW);
  assert.equal(findStaleOrUnresolvedKnowledgeItems([fresh], NOW).length, 0);
});
