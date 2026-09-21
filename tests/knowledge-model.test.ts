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

test("newKnowledgeItem gives different ids to items with the same injected `now` and a shared 24+ char title prefix", () => {
  const a = base({ title: "Quarterly security review process for vendors" });
  const b = base({ title: "Quarterly security review process for contractors" });
  assert.notEqual(a.id, b.id);
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

import {
  markUnderReview, recordReviewerDecision,
} from "../lib/knowledge/model.ts";

test("markUnderReview moves draft -> under_review and records the linked ReviewItem id", () => {
  const item = base();
  const underReview = markUnderReview(item, "rev_abc123", NOW);
  assert.equal(item.status, "draft"); // original untouched
  assert.equal(underReview.status, "under_review");
  assert.equal(underReview.reviewItemId, "rev_abc123");
});

test("recordReviewerDecision approves only when canApproveKnowledgeItem is ok, and is append-only", () => {
  const reviewed = markUnderReview(base(), "rev_1", NOW);
  const approved = recordReviewerDecision(reviewed, "approved", "Taro", "looks correct", "2026-09-23T00:00:00.000Z");
  assert.equal(approved.status, "approved");
  assert.equal(approved.lastReviewedAt, "2026-09-23T00:00:00.000Z");
  assert.equal(approved.reviewHistory.length, 1);
  assert.deepEqual(approved.reviewHistory[0], {
    verdict: "approved", by: "Taro", at: "2026-09-23T00:00:00.000Z", note: "looks correct",
  });

  // A second decision appends, never overwrites.
  const reApproved = recordReviewerDecision(approved, "approved", "Grace", "confirmed again", "2026-09-24T00:00:00.000Z");
  assert.equal(reApproved.reviewHistory.length, 2);
  assert.equal(reApproved.reviewHistory[0].by, "Taro"); // first entry untouched
});

test("recordReviewerDecision refuses to approve a knowledge item with no evidence or owner", () => {
  const reviewed = markUnderReview(base({ evidence: [], ownerId: "" }), "rev_2", NOW);
  assert.throws(
    () => recordReviewerDecision(reviewed, "approved", "Taro", "", NOW),
    /no evidence anchor attached.*no owner assigned|no owner assigned.*no evidence anchor attached/,
  );
});

test("recordReviewerDecision: revise sends the item back to draft; rejected is terminal but retains history", () => {
  const reviewed = markUnderReview(base(), "rev_3", NOW);
  const revised = recordReviewerDecision(reviewed, "revise", "Taro", "needs a real owner", NOW);
  assert.equal(revised.status, "draft");
  assert.equal(revised.reviewHistory.length, 1);

  const rejected = recordReviewerDecision(markUnderReview(base(), "rev_4", NOW), "rejected", "Taro", "out of date", NOW);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.reviewHistory.length, 1);
  assert.equal(rejected.reviewHistory[0].verdict, "rejected");
});

test("recordReviewerDecision: escalated keeps the item under_review, just logs the escalation", () => {
  const reviewed = markUnderReview(base(), "rev_5", NOW);
  const escalated = recordReviewerDecision(reviewed, "escalated", "Taro", "needs legal review", NOW);
  assert.equal(escalated.status, "under_review");
  assert.equal(escalated.reviewHistory[0].verdict, "escalated");
});

test("recordReviewerDecision refuses any verdict once an item is approved or rejected (terminal)", () => {
  const approved = recordReviewerDecision(markUnderReview(base(), "rev_6", NOW), "approved", "Taro", "", NOW);
  assert.throws(() => recordReviewerDecision(approved, "revise", "Grace", "", NOW), /terminal/);

  const rejected = recordReviewerDecision(markUnderReview(base(), "rev_7", NOW), "rejected", "Taro", "", NOW);
  assert.throws(() => recordReviewerDecision(rejected, "approved", "Grace", "", NOW), /terminal/);
});

test("recordReviewerDecision throws when called on an item that never went through markUnderReview", () => {
  const draft = base();
  assert.throws(
    () => recordReviewerDecision(draft, "approved", "Taro", "", NOW),
    /must be under_review/,
  );
});

test("recordReviewerDecision throws when `by` is blank, even on an under_review item", () => {
  const reviewed = markUnderReview(base(), "rev_blank", NOW);
  assert.throws(
    () => recordReviewerDecision(reviewed, "approved", "", "", NOW),
    /requires a named reviewer/,
  );
  assert.throws(
    () => recordReviewerDecision(reviewed, "approved", "   ", "", NOW),
    /requires a named reviewer/,
  );
});

import { isDueForFreshnessReview, recordFreshnessCheck, supersede } from "../lib/knowledge/model.ts";

test("recordFreshnessCheck sets lastReviewedAt and nextFreshnessReviewAt without touching status or history", () => {
  const approved = recordReviewerDecision(markUnderReview(base(), "rev_8", NOW), "approved", "Taro", "", NOW);
  const rechecked = recordFreshnessCheck(approved, "2026-12-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z");
  assert.equal(rechecked.status, "approved");
  assert.equal(rechecked.reviewHistory.length, 1); // unchanged
  assert.equal(rechecked.lastReviewedAt, "2026-11-01T00:00:00.000Z");
  assert.equal(rechecked.nextFreshnessReviewAt, "2026-12-01T00:00:00.000Z");
});

test("isDueForFreshnessReview is true only for an approved item past its review date", () => {
  const approved = recordFreshnessCheck(
    recordReviewerDecision(markUnderReview(base(), "rev_9", NOW), "approved", "Taro", "", NOW),
    "2026-10-01T00:00:00.000Z",
    NOW,
  );
  assert.equal(isDueForFreshnessReview(approved, "2026-09-30T00:00:00.000Z"), false);
  assert.equal(isDueForFreshnessReview(approved, "2026-10-02T00:00:00.000Z"), true);
  assert.equal(isDueForFreshnessReview(base(), "2099-01-01T00:00:00.000Z"), false, "a draft item is never 'due' for freshness review");
});

test("supersede marks the old item superseded and links to its replacement", () => {
  const approved = recordReviewerDecision(markUnderReview(base(), "rev_10", NOW), "approved", "Taro", "", NOW);
  const superseded = supersede(approved, "ki_new_replacement", "2026-11-01T00:00:00.000Z");
  assert.equal(superseded.status, "superseded");
  assert.deepEqual(superseded.relations, [{ type: "superseded_by", targetId: "ki_new_replacement" }]);
});

import { receiptLine } from "../lib/knowledge/model.ts";

test("receiptLine renders a one-line audit summary matching lib/review/model.ts's style", () => {
  const draft = base();
  assert.match(receiptLine(draft), /^pending \(draft\) — type:procedure — owner:grace@example\.com — evidence:1$/);

  const approved = recordReviewerDecision(markUnderReview(base(), "rev_11", NOW), "approved", "Taro", "confirmed", "2026-09-23T00:00:00.000Z");
  assert.match(receiptLine(approved), /^approved by Taro on 2026-09-23 — type:procedure — owner:grace@example\.com — evidence:1 — confirmed$/);
});
