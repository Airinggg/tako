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
