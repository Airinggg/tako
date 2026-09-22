import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { newKnowledgeItem } from "../lib/knowledge/model.ts";
import { upsertKnowledgeItem } from "../lib/knowledge/store.ts";
import { loadMeetingProposals } from "../lib/integrations/zoom/proposal-store.ts";
import { confirmZoomMeeting, proposeZoomMeeting } from "../scripts/demo.ts";

const NOW = "2026-09-23T00:00:00.000Z";

async function withTempStores<T>(fn: (paths: { knowledgeStorePath: string; proposalStorePath: string }) => Promise<T> | T): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "tako-zoom-routes-"));
  try {
    return await fn({ knowledgeStorePath: join(dir, "knowledge-items.json"), proposalStorePath: join(dir, "meeting-proposals.json") });
  } finally {
    await rm(dir, { recursive: true });
  }
}

function unresolvedItem() {
  return newKnowledgeItem({
    type: "procedure", title: "How to request a new connector", description: "Steps to onboard a new source.",
    evidence: [{ pageSlug: "notion/onboarding/connector-request" }],
    sourceWorkspace: "engineering", sourceConnector: "notion", classification: "internal", origin: "source-authored",
    ownerId: "", // ownerless AND we'll also mark it under_review below via the test setup where needed
    retention: { policyRef: "workspace-default-90d", deletionImplication: "removed when the source page is deleted" },
    now: NOW,
  });
}

test("proposeZoomMeeting drafts a proposal for a real stale item and persists it", async () => {
  await withTempStores(async ({ knowledgeStorePath, proposalStorePath }) => {
    const item = unresolvedItem(); // ownerless -> stale
    upsertKnowledgeItem(item, knowledgeStorePath);

    const proposal = proposeZoomMeeting({ knowledgeItemId: item.id, createdBy: "Taro" }, { knowledgeStorePath, proposalStorePath, now: NOW });

    assert.equal(proposal.knowledgeItemId, item.id);
    assert.deepEqual(proposal.reasons, ["ownerless"]);
    assert.deepEqual(loadMeetingProposals(proposalStorePath).map((p) => p.id), [proposal.id]);
  });
});

test("proposeZoomMeeting refuses an item that isn't actually stale/unresolved", async () => {
  await withTempStores(async ({ knowledgeStorePath, proposalStorePath }) => {
    const item = { ...unresolvedItem(), ownerId: "grace@example.com" }; // owned, draft, not under_review — no reasons
    upsertKnowledgeItem(item, knowledgeStorePath);
    assert.throws(
      () => proposeZoomMeeting({ knowledgeItemId: item.id, createdBy: "Taro" }, { knowledgeStorePath, proposalStorePath, now: NOW }),
      /stale/,
    );
  });
});

test("proposeZoomMeeting refuses an unknown knowledgeItemId", async () => {
  await withTempStores(async ({ knowledgeStorePath, proposalStorePath }) => {
    assert.throws(
      () => proposeZoomMeeting({ knowledgeItemId: "ki_does_not_exist", createdBy: "Taro" }, { knowledgeStorePath, proposalStorePath, now: NOW }),
      /not found/,
    );
  });
});

test("confirmZoomMeeting confirms, calls Zoom via the injected fetch, and persists status created", async () => {
  await withTempStores(async ({ knowledgeStorePath, proposalStorePath }) => {
    const item = unresolvedItem();
    upsertKnowledgeItem(item, knowledgeStorePath);
    const proposal = proposeZoomMeeting({ knowledgeItemId: item.id, createdBy: "Taro" }, { knowledgeStorePath, proposalStorePath, now: NOW });

    const fetchImpl = (async (url: string) => {
      if (String(url).includes("oauth/token")) return new Response(JSON.stringify({ access_token: "fake-token" }), { status: 200 });
      return new Response(JSON.stringify({ id: 111, join_url: "https://zoom.us/j/111", start_url: "https://zoom.us/s/111" }), { status: 201 });
    }) as typeof fetch;

    const result = await confirmZoomMeeting(
      { proposalId: proposal.id, proposedStartAt: "2026-10-01T09:00:00.000Z", participantEmails: ["grace@example.com"], confirmedBy: "Grace" },
      { proposalStorePath, now: "2026-09-24T00:00:00.000Z", zoomCredentials: { accountId: "a", clientId: "b", clientSecret: "c" }, fetchImpl },
    );

    assert.equal(result.status, "created");
    assert.deepEqual(result.zoomMeeting, { id: "111", joinUrl: "https://zoom.us/j/111", startUrl: "https://zoom.us/s/111" });
    const stored = loadMeetingProposals(proposalStorePath);
    assert.equal(stored.find((p) => p.id === proposal.id)?.status, "created");
  });
});

test("confirmZoomMeeting leaves the proposal confirmed (not created) when Zoom's API fails", async () => {
  await withTempStores(async ({ knowledgeStorePath, proposalStorePath }) => {
    const item = unresolvedItem();
    upsertKnowledgeItem(item, knowledgeStorePath);
    const proposal = proposeZoomMeeting({ knowledgeItemId: item.id, createdBy: "Taro" }, { knowledgeStorePath, proposalStorePath, now: NOW });

    const fetchImpl = (async () => new Response("invalid_client", { status: 401 })) as typeof fetch;

    await assert.rejects(
      confirmZoomMeeting(
        { proposalId: proposal.id, proposedStartAt: "2026-10-01T09:00:00.000Z", participantEmails: [], confirmedBy: "Grace" },
        { proposalStorePath, now: NOW, zoomCredentials: { accountId: "a", clientId: "b", clientSecret: "c" }, fetchImpl },
      ),
      /401/,
    );
    const stored = loadMeetingProposals(proposalStorePath);
    assert.equal(stored.find((p) => p.id === proposal.id)?.status, "confirmed");
  });
});
