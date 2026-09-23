import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { draftMeetingProposal } from "../lib/integrations/zoom/proposal.ts";
import { newKnowledgeItem } from "../lib/knowledge/model.ts";
import {
  getMeetingProposal, loadMeetingProposals, saveMeetingProposals, upsertMeetingProposal,
} from "../lib/integrations/zoom/proposal-store.ts";

const NOW = "2026-09-23T00:00:00.000Z";

function sampleProposal() {
  const item = newKnowledgeItem({
    type: "policy", title: "Remote work expense policy", description: "What counts as reimbursable.",
    evidence: [{ pageSlug: "notion/hr/remote-expense-policy" }],
    sourceWorkspace: "hr", sourceConnector: "notion", classification: "internal", origin: "source-authored",
    ownerId: "hr-team@example.com",
    retention: { policyRef: "workspace-default-90d", deletionImplication: "removed if the HR page is deleted" },
    now: NOW,
  });
  return draftMeetingProposal(item, ["unresolved_review"], { createdBy: "Taro", now: NOW });
}

test("missing and corrupt store files are treated as empty, not an error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tako-zoom-proposal-store-"));
  const path = join(dir, "meeting-proposals.json");
  try {
    assert.deepEqual(loadMeetingProposals(path), []);
    await writeFile(path, "not json\n");
    assert.deepEqual(loadMeetingProposals(path), []);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("saveMeetingProposals writes atomically, owner-only, and round-trips", { skip: process.platform === "win32" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "tako-zoom-proposal-store-"));
  const path = join(dir, "meeting-proposals.json");
  const proposals = [sampleProposal()];
  try {
    saveMeetingProposals(proposals, path);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await readFile(path, "utf8")).endsWith("\n"), true);
    assert.deepEqual(loadMeetingProposals(path), proposals);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("upsertMeetingProposal inserts new and updates existing by id, never duplicating", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tako-zoom-proposal-store-"));
  const path = join(dir, "meeting-proposals.json");
  try {
    const proposal = sampleProposal();
    upsertMeetingProposal(proposal, path);
    assert.deepEqual(loadMeetingProposals(path), [proposal]);

    const updated = { ...proposal, status: "confirmed" as const };
    upsertMeetingProposal(updated, path);
    const stored = loadMeetingProposals(path);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].status, "confirmed");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("getMeetingProposal finds by id or returns undefined", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tako-zoom-proposal-store-"));
  const path = join(dir, "meeting-proposals.json");
  try {
    const proposal = sampleProposal();
    upsertMeetingProposal(proposal, path);
    assert.deepEqual(getMeetingProposal(proposal.id, path), proposal);
    assert.equal(getMeetingProposal("mtgprop_does_not_exist", path), undefined);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("upsertMeetingProposal backs up a corrupt destination file before overwriting it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tako-zoom-proposal-store-"));
  const path = join(dir, "meeting-proposals.json");
  try {
    await writeFile(path, "not json at all\n");
    const proposal = sampleProposal();
    upsertMeetingProposal(proposal, path);
    assert.deepEqual(loadMeetingProposals(path), [proposal]);
    const fs = await import("node:fs/promises");
    const files = await fs.readdir(dir);
    const backup = files.find((f) => f.includes(".corrupt-") && f.endsWith(".bak"));
    assert.ok(backup, "expected a .corrupt-*.bak file to exist");
    assert.equal(await readFile(join(dir, backup!), "utf8"), "not json at all\n");
  } finally {
    await rm(dir, { recursive: true });
  }
});
