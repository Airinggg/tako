/**
 * Read-only queries over the KnowledgeItem store surfaced to managers on
 * the Automations page's follow-up-meeting suggestions. Pure — takes an
 * already-loaded array, never touches the filesystem itself (the caller
 * loads via lib/knowledge/store.ts's loadKnowledgeItems()). See
 * docs/superpowers/specs/2026-09-22-zoom-followup-meeting-design.md Part 1.
 */

import { isDueForFreshnessReview, type KnowledgeItem } from "./model.ts";

export type StaleReason = "freshness_due" | "unresolved_review" | "ownerless";

export type StaleKnowledgeItem = { item: KnowledgeItem; reasons: StaleReason[] };

const SETTLED_STATUSES = new Set(["rejected", "archived", "superseded"]);

/** Surfaces KnowledgeItems a manager should look at: approved items past
 *  their freshness-review date, items stuck `under_review` awaiting a
 *  decision, and items with no named owner (excluding rejected/archived/
 *  superseded items, which are already settled and don't need an owner). */
export function findStaleOrUnresolvedKnowledgeItems(
  items: readonly KnowledgeItem[],
  now: string,
): StaleKnowledgeItem[] {
  const results: StaleKnowledgeItem[] = [];
  for (const item of items) {
    const reasons: StaleReason[] = [];
    if (isDueForFreshnessReview(item, now)) reasons.push("freshness_due");
    if (item.status === "under_review") reasons.push("unresolved_review");
    if (item.ownerId.trim() === "" && !SETTLED_STATUSES.has(item.status)) reasons.push("ownerless");
    if (reasons.length > 0) results.push({ item, reasons });
  }
  return results;
}
