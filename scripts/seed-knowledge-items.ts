/**
 * One-off operator utility: seeds config/knowledge-items.json with a few
 * realistic, clearly-fictional sample KnowledgeItems so the Automations
 * page's "Follow-up meeting suggestions" section has something real to
 * show without waiting on a live ingestion pipeline. This is fixture data
 * for demonstration — never real customer knowledge. Run with:
 *   bun scripts/seed-knowledge-items.ts
 */

import { join } from "node:path";
import {
  markUnderReview, newKnowledgeItem, recordFreshnessCheck, recordReviewerDecision,
} from "../lib/knowledge/model.ts";
import { upsertKnowledgeItem } from "../lib/knowledge/store.ts";

const REPO = import.meta.dir ? join(import.meta.dir, "..") : process.cwd();
const STORE_PATH = join(REPO, "config/knowledge-items.json");
const NOW = new Date().toISOString();

function overdueApproved() {
  const item = newKnowledgeItem({
    type: "policy",
    title: "[SEED] Vendor security review checklist",
    description: "Required checklist before onboarding any new external vendor with data access.",
    evidence: [{ pageSlug: "notion/security/vendor-review-checklist" }],
    sourceWorkspace: "security",
    sourceConnector: "notion",
    classification: "internal",
    origin: "source-authored",
    ownerId: "security-team@example.com",
    retention: { policyRef: "workspace-default-90d", deletionImplication: "removed when the source page is deleted" },
    now: NOW,
  });
  const approved = recordReviewerDecision(markUnderReview(item, "rev_seed_1", NOW), "approved", "Grace", "looks good", NOW);
  return recordFreshnessCheck(approved, "2026-01-01T00:00:00.000Z", NOW); // long past due
}

function stuckUnderReview() {
  const item = newKnowledgeItem({
    type: "decision",
    title: "[SEED] Decision: pause the Q3 pricing experiment",
    description: "Candidate decision drafted from a recurring pricing sync — needs reviewer confirmation.",
    evidence: [{ pageSlug: "slack/pricing-sync/2026-09-10" }],
    sourceWorkspace: "sales",
    sourceConnector: "slack",
    classification: "internal",
    origin: "model-suggested",
    ownerId: "",
    retention: { policyRef: "workspace-default-90d", deletionImplication: "removed when the source page is deleted" },
    now: NOW,
  });
  return markUnderReview(item, "rev_seed_2", NOW);
}

function ownerless() {
  return newKnowledgeItem({
    type: "procedure",
    title: "[SEED] Incident escalation runbook",
    description: "Steps to escalate a production incident outside business hours — no owner assigned yet.",
    evidence: [{ pageSlug: "notion/ops/incident-escalation" }],
    sourceWorkspace: "operations",
    sourceConnector: "notion",
    classification: "internal",
    origin: "source-authored",
    ownerId: "",
    retention: { policyRef: "workspace-default-90d", deletionImplication: "removed when the source page is deleted" },
    now: NOW,
  });
}

for (const item of [overdueApproved(), stuckUnderReview(), ownerless()]) {
  upsertKnowledgeItem(item, STORE_PATH);
  console.log(`seeded ${item.id} — ${item.title}`);
}
