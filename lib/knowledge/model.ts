/**
 * Company Brain knowledge items — evidence-backed institutional knowledge
 * derived from or authored alongside gbrain source pages. A KnowledgeItem
 * never copies source content; it only cites gbrain page slugs. It can only
 * reach `approved` through a recorded human ReviewerDecisionRecord, never by
 * retrieval frequency, model confidence, or direct field assignment. Pure —
 * no I/O. See docs/superpowers/specs/2026-09-22-company-brain-foundation-architecture.md
 * Part B.3–B.4.
 */

import { randomUUID } from "node:crypto";

export type KnowledgeItemId = string;

export type KnowledgeType =
  | "policy" | "procedure" | "decision" | "project"
  | "customer_product" | "team_role" | "onboarding" | "open_action";

export const KNOWLEDGE_TYPES: KnowledgeType[] = [
  "policy", "procedure", "decision", "project",
  "customer_product", "team_role", "onboarding", "open_action",
];

export type KnowledgeStatus =
  | "draft" | "under_review" | "approved" | "superseded" | "rejected" | "archived";

export const KNOWLEDGE_STATUSES: KnowledgeStatus[] = [
  "draft", "under_review", "approved", "superseded", "rejected", "archived",
];

export type KnowledgeOrigin = "source-authored" | "human-authored" | "model-suggested";

export const KNOWLEDGE_ORIGINS: KnowledgeOrigin[] = ["source-authored", "human-authored", "model-suggested"];

export type KnowledgeClassification =
  | "internal" | "confidential" | "restricted" | "public" | "export-controlled";

export const KNOWLEDGE_CLASSIFICATIONS: KnowledgeClassification[] = [
  "internal", "confidential", "restricted", "public", "export-controlled",
];

export type EvidenceAnchor = { pageSlug: string; chunkIndex?: number; excerpt?: string };

export type RelationType =
  | "relates_to" | "supersedes" | "superseded_by" | "derived_from"
  | "blocks" | "blocked_by" | "part_of";

export type KnowledgeRelation = { type: RelationType; targetId: KnowledgeItemId };

export type ReviewVerdict = "approved" | "revise" | "rejected" | "escalated";

export type ReviewerDecisionRecord = { verdict: ReviewVerdict; by: string; at: string; note: string };

export type KnowledgeItem = {
  id: KnowledgeItemId;
  type: KnowledgeType;
  title: string;
  description: string;
  evidence: EvidenceAnchor[];
  sourceWorkspace: string;
  sourceConnector: string;
  classification: KnowledgeClassification;
  origin: KnowledgeOrigin;
  status: KnowledgeStatus;
  ownerId: string;
  createdAt: string;
  sourceUpdatedAt: string | null;
  lastReviewedAt: string | null;
  nextFreshnessReviewAt: string | null;
  relations: KnowledgeRelation[];
  reviewHistory: ReviewerDecisionRecord[];
  retention: { policyRef: string; deletionImplication: string };
  reviewItemId?: string;
};

const clone = <T>(v: T): T => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

/** A fresh knowledge item in `draft` status. */
export function newKnowledgeItem(
  input: Pick<KnowledgeItem, "type" | "title" | "description" | "sourceWorkspace" | "sourceConnector" | "classification" | "origin" | "ownerId" | "retention"> & {
    evidence?: EvidenceAnchor[];
    relations?: KnowledgeRelation[];
    id?: string;
    now?: string;
  },
): KnowledgeItem {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id ?? `ki_${(Date.parse(now) || 0).toString(36)}_${input.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24) || "item"}_${randomUUID().slice(0, 8)}`,
    type: input.type,
    title: input.title.trim(),
    description: input.description.trim(),
    evidence: [...(input.evidence ?? [])],
    sourceWorkspace: input.sourceWorkspace,
    sourceConnector: input.sourceConnector,
    classification: input.classification,
    origin: input.origin,
    status: "draft",
    ownerId: input.ownerId,
    createdAt: now,
    sourceUpdatedAt: null,
    lastReviewedAt: null,
    nextFreshnessReviewAt: null,
    relations: [...(input.relations ?? [])],
    reviewHistory: [],
    retention: { ...input.retention },
  };
}

/** Approval needs at least one evidence anchor and a named owner — the same
 *  "grounded, ownable claim" bar the spec (Part B.4.1) requires before a
 *  model-suggested or human-authored claim can become trusted knowledge. */
export function canApproveKnowledgeItem(item: KnowledgeItem): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (item.evidence.length === 0) reasons.push("no evidence anchor attached");
  if (item.ownerId.trim() === "") reasons.push("no owner assigned");
  return { ok: reasons.length === 0, reasons };
}

/** The current reviewer decision, if any — the last entry in the append-only log. */
export function latestReviewerDecision(item: KnowledgeItem): ReviewerDecisionRecord | null {
  return item.reviewHistory.length ? item.reviewHistory[item.reviewHistory.length - 1] : null;
}

/** draft -> under_review, linking the ReviewItem a reviewer will act on. */
export function markUnderReview(item: KnowledgeItem, reviewItemId: string, now = new Date().toISOString()): KnowledgeItem {
  const next = clone(item);
  next.status = "under_review";
  next.reviewItemId = reviewItemId;
  return next;
}

/** Records a human reviewer's verdict. Append-only: a re-decision adds a new
 *  entry to `reviewHistory` rather than overwriting the last one, mirroring
 *  lib/review/model.ts's `decisions[]` design intent so no prior verdict's
 *  by/at/note is ever lost. `approved` is only reachable when
 *  `canApproveKnowledgeItem()` says the item is ready; `revise` sends the
 *  item back to `draft` for rework; `rejected` is terminal but the item and
 *  its full history remain readable; `escalated` leaves status unchanged
 *  (still `under_review`) since KnowledgeStatus has no separate escalated
 *  state — the escalation itself is the new reviewHistory entry. `rejected`
 *  is strictly terminal: no further decision of any kind may be recorded.
 *  An already-`approved` item is not otherwise terminal — it accepts one
 *  more `"approved"` verdict as a re-confirmation (it appends to
 *  `reviewHistory` and refreshes `lastReviewedAt`), but any other verdict on
 *  an approved item still throws. A decision can only be recorded on an item
 *  that is `under_review` (i.e. has gone through `markUnderReview()`), and
 *  `by` must be a non-blank named reviewer. */
export function recordReviewerDecision(
  item: KnowledgeItem,
  verdict: ReviewVerdict,
  by: string,
  note = "",
  now = new Date().toISOString(),
): KnowledgeItem {
  if (item.status === "rejected") {
    throw new Error(`knowledge item "${item.id}" is terminal (status "${item.status}") and cannot receive another decision`);
  }
  if (item.status === "approved" && verdict !== "approved") {
    throw new Error(`knowledge item "${item.id}" is terminal (status "${item.status}") and cannot receive another decision`);
  }
  // An already-`approved` item reaching here is being re-confirmed with
  // another "approved" verdict, which is allowed without having gone back
  // through `markUnderReview()`. Any other status must first be under_review.
  if (item.status !== "under_review" && item.status !== "approved") {
    throw new Error(`knowledge item "${item.id}" must be under_review before a decision can be recorded (current status: "${item.status}")`);
  }
  if (by.trim() === "") {
    throw new Error(`recordReviewerDecision requires a named reviewer ("by")`);
  }
  if (verdict === "approved") {
    const gate = canApproveKnowledgeItem(item);
    if (!gate.ok) throw new Error(`cannot approve "${item.id}": ${gate.reasons.join("; ")}`);
  }
  const next = clone(item);
  next.reviewHistory = [...next.reviewHistory, { verdict, by, at: now, note: note.trim() }];
  if (verdict === "approved") {
    next.status = "approved";
    next.lastReviewedAt = now;
  } else if (verdict === "rejected") {
    next.status = "rejected";
    next.lastReviewedAt = now;
  } else if (verdict === "revise") {
    next.status = "draft";
    next.lastReviewedAt = now;
  }
  // "escalated" leaves next.status as-is (still "under_review").
  return next;
}

/** A human re-confirms an approved item is still current, or updates when it
 *  should next be checked, without that being a new formal review decision
 *  (no reviewHistory entry — see spec Part B.4.4: freshness is cleared by a
 *  human, but it is not itself a Verdict). */
export function recordFreshnessCheck(item: KnowledgeItem, nextFreshnessReviewAt: string, now = new Date().toISOString()): KnowledgeItem {
  const next = clone(item);
  next.lastReviewedAt = now;
  next.nextFreshnessReviewAt = nextFreshnessReviewAt;
  return next;
}

/** True only for an approved item whose freshness-review date has passed —
 *  a draft/rejected/superseded item is never "due," it is simply not
 *  current trusted knowledge yet (or any more). */
export function isDueForFreshnessReview(item: KnowledgeItem, now = new Date().toISOString()): boolean {
  return item.status === "approved" && item.nextFreshnessReviewAt !== null && item.nextFreshnessReviewAt <= now;
}

/** An approved item is replaced by a newer one. The old item is retained
 *  (never deleted) with status `superseded` and a relation pointing at its
 *  replacement, so retrieval and citation history can still resolve it. */
export function supersede(item: KnowledgeItem, supersededById: KnowledgeItemId, now = new Date().toISOString()): KnowledgeItem {
  const next = clone(item);
  next.status = "superseded";
  next.relations = [...next.relations, { type: "superseded_by", targetId: supersededById }];
  next.lastReviewedAt = now;
  return next;
}

/** One-line audit entry, mirroring lib/review/model.ts's receiptLine() —
 *  what a reviewer or steward would paste into an audit note. */
export function receiptLine(item: KnowledgeItem): string {
  const d = latestReviewerDecision(item);
  const head = d ? `${d.verdict} by ${d.by} on ${d.at.slice(0, 10)}` : `pending (${item.status})`;
  const tail = d?.note ? ` — ${d.note}` : "";
  return `${head} — type:${item.type} — owner:${item.ownerId || "(none)"} — evidence:${item.evidence.length}${tail}`;
}
