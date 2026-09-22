import assert from "node:assert/strict";
import test from "node:test";
import { newKnowledgeItem, type KnowledgeItem } from "../lib/knowledge/model.ts";
import { draftMeetingProposal } from "../lib/integrations/zoom/proposal.ts";

const NOW = "2026-09-23T00:00:00.000Z";

function knowledgeItem(): KnowledgeItem {
  return newKnowledgeItem({
    type: "procedure",
    title: "How to request a new connector",
    description: "Steps to get a new data source onboarded.",
    evidence: [{ pageSlug: "notion/onboarding/connector-request", excerpt: "File a request via..." }],
    sourceWorkspace: "engineering",
    sourceConnector: "notion",
    classification: "internal",
    origin: "source-authored",
    ownerId: "grace@example.com",
    retention: { policyRef: "workspace-default-90d", deletionImplication: "removed when the source page is deleted" },
    now: NOW,
  });
}

test("draftMeetingProposal builds a draft citing the item's real title/description/evidence", () => {
  const item = knowledgeItem();
  const proposal = draftMeetingProposal(item, ["unresolved_review"], { createdBy: "Taro", now: NOW });

  assert.equal(proposal.knowledgeItemId, item.id);
  assert.deepEqual(proposal.reasons, ["unresolved_review"]);
  assert.equal(proposal.topic, item.title);
  assert.match(proposal.agendaText, /Steps to get a new data source onboarded\./);
  assert.match(proposal.agendaText, /Evidence: notion\/onboarding\/connector-request/);
  assert.deepEqual(proposal.evidence, item.evidence);
  assert.equal(proposal.status, "draft");
  assert.equal(proposal.proposedStartAt, null);
  assert.equal(proposal.proposedDurationMinutes, 30);
  assert.deepEqual(proposal.participantEmails, []);
  assert.equal(proposal.createdBy, "Taro");
  assert.equal(proposal.createdAt, NOW);
  assert.equal(proposal.confirmedAt, null);
  assert.equal(proposal.confirmedBy, null);
  assert.equal(proposal.zoomMeeting, null);
  assert.ok(proposal.id.startsWith("mtgprop_"));
});

test("draftMeetingProposal refuses an empty reasons list", () => {
  assert.throws(() => draftMeetingProposal(knowledgeItem(), [], { createdBy: "Taro", now: NOW }), /reasons/);
});
