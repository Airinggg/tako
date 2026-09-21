/**
 * Company Brain knowledge items — evidence-backed institutional knowledge
 * derived from or authored alongside gbrain source pages. A KnowledgeItem
 * never copies source content; it only cites gbrain page slugs. It can only
 * reach `approved` through a recorded human ReviewerDecisionRecord, never by
 * retrieval frequency, model confidence, or direct field assignment. Pure —
 * no I/O. See docs/superpowers/specs/2026-09-22-company-brain-foundation-architecture.md
 * Part B.3–B.4.
 */

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

export type KnowledgeClassification =
  | "internal" | "confidential" | "restricted" | "public" | "export-controlled";

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
    id: input.id ?? `ki_${(Date.parse(now) || 0).toString(36)}_${input.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24) || "item"}`,
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
 *  state — the escalation itself is the new reviewHistory entry. `approved`
 *  and `rejected` are terminal: no further decision may be recorded. */
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
