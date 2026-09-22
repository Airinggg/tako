/**
 * A follow-up meeting proposal drafted from a stale/unresolved
 * KnowledgeItem. Pure — no I/O, no network. The actual Zoom API call lives
 * in lib/integrations/zoom/client.ts; this module only decides what states
 * are valid. See docs/superpowers/specs/2026-09-22-zoom-followup-meeting-design.md
 * Part 2.
 */

import { randomUUID } from "node:crypto";
import type { EvidenceAnchor, KnowledgeItem } from "../../knowledge/model.ts";
import type { StaleReason } from "../../knowledge/queries.ts";

export type MeetingProposalId = string;

export type MeetingProposalStatus = "draft" | "confirmed" | "created";

export type MeetingProposal = {
  id: MeetingProposalId;
  knowledgeItemId: string;
  reasons: StaleReason[];
  topic: string;
  agendaText: string;
  evidence: EvidenceAnchor[];
  proposedStartAt: string | null;
  proposedDurationMinutes: number;
  participantEmails: string[];
  status: MeetingProposalStatus;
  createdAt: string;
  createdBy: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  zoomMeeting: { id: string; joinUrl: string; startUrl: string } | null;
};

const clone = <T>(v: T): T => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

/** Builds a draft proposal from a real KnowledgeItem — topic and agenda are
 *  taken directly from the item's own title/description/evidence, nothing
 *  is invented. Refuses an empty `reasons` list: a proposal must always be
 *  able to say why it was suggested. */
export function draftMeetingProposal(
  item: KnowledgeItem,
  reasons: StaleReason[],
  input: { createdBy: string; now?: string },
): MeetingProposal {
  if (reasons.length === 0) {
    throw new Error("draftMeetingProposal requires at least one reason in reasons");
  }
  const now = input.now ?? new Date().toISOString();
  const evidenceLines = item.evidence.map((e) => `Evidence: ${e.pageSlug}`).join("\n");
  return {
    id: `mtgprop_${(Date.parse(now) || 0).toString(36)}_${randomUUID().slice(0, 8)}`,
    knowledgeItemId: item.id,
    reasons: [...reasons],
    topic: item.title,
    agendaText: `${item.description}\n\n${evidenceLines}`,
    evidence: [...item.evidence],
    proposedStartAt: null,
    proposedDurationMinutes: 30,
    participantEmails: [],
    status: "draft",
    createdAt: now,
    createdBy: input.createdBy,
    confirmedAt: null,
    confirmedBy: null,
    zoomMeeting: null,
  };
}
