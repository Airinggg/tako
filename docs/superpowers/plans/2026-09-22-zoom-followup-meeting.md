# Real Zoom Follow-Up Meeting Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Automations page one genuinely real, end-to-end
capability: a manager sees a real stale/unresolved `KnowledgeItem`,
proposes a follow-up meeting citing its real evidence, edits the details,
and — only after an explicit confirm click — the system creates a real
Zoom meeting via Zoom's API and shows the real join link.

**Architecture:** Three new pure modules (`lib/knowledge/queries.ts`,
`lib/integrations/zoom/proposal.ts`, and the persistence module
`lib/integrations/zoom/proposal-store.ts`, mirroring the already-reviewed
`lib/knowledge/store.ts` pattern exactly), one impure module that is the
only thing touching the network (`lib/integrations/zoom/client.ts`,
credentials via env vars, an injectable `fetch` for tests), and additive
wiring in `scripts/demo.ts` (two new exported functions following the
`submitReview()`/`reviewDecide()` precedent, two new admin-gated routes, a
new source in the existing `activityView()`, and a new UI section on the
Automations screen that does not touch the existing trigger/action
builder). A small seed script populates realistic fixture `KnowledgeItem`s
so the new UI has something real to show.

**Tech Stack:** TypeScript (Bun runtime, `node --experimental-strip-types`
test runner per this repo's convention), `node:test` + `node:assert/strict`,
no new dependencies (Zoom's REST API is called with the platform `fetch`).

**Spec:** `docs/superpowers/specs/2026-09-22-zoom-followup-meeting-design.md`.
This plan implements that spec in full.

## Global Constraints

- No new npm/bun dependencies.
- `lib/knowledge/queries.ts`, `lib/integrations/zoom/proposal.ts`, and
  `lib/integrations/zoom/proposal-store.ts` must be pure or I/O-limited to
  their own store file exactly like `lib/knowledge/model.ts`/`store.ts` —
  no network calls from any of them.
- `lib/integrations/zoom/client.ts` is the **only** module in this feature
  that calls the network. Every function there accepts an
  `opts?: { fetchImpl?: typeof fetch }` so tests never reach the real Zoom
  API.
- Zoom credentials are resolved only via `resolveSecret("env:ZOOM_...",
  env)` (reusing `lib/connectors/shared/config.ts`'s existing
  `resolveSecret`, not reimplementing credential resolution) — never a
  literal value, never logged, never written to any file this feature
  creates.
- A Zoom meeting is only ever created inside `confirmZoomMeeting()`, and
  only after a human-supplied `proposedStartAt`/`participantEmails`/
  `confirmedBy` have been validated by the pure `confirmMeetingProposal()`
  gate — there is no path that creates a meeting from `proposeZoomMeeting()`
  alone.
- `config/meeting-proposals.json` and its `.tmp`/`.corrupt-*.bak` patterns
  must be added to `.gitignore`, matching every other local store in this
  repo (`config/reviews.json`, `config/knowledge-items.json`, etc.).
- This repo has **no appendable activity log** — `activityView()`
  (`scripts/demo.ts:918-966`) recomputes `ActivityEntry[]` live from real
  state on every call. This feature must extend that function with a third
  source (reading `config/meeting-proposals.json`), exactly like its
  existing `reviewsView().rows` source — it must not invent a new
  persisted log.
- `scripts/demo.ts` is under active, concurrent edits from other work on
  this same branch (automation-canvas, connector-credentials work). Before
  editing its route if-chain, `ADMIN_ROUTES`, or the Automations-screen
  markup, re-read the current file and insert relative to named anchors
  (`#automation-builder`, `ADMIN_ROUTES`, `activityView()`) — never assume
  the line numbers quoted in this plan still match exactly.
- This feature does not touch `AB_TRIGGER_OPTIONS`, `AB_ACTION_OPTIONS`,
  `createAutomation()`, or the automation-canvas adapter
  (`lib/connectors/automation-canvas/`) — it is fully additive.

---

### Task 1: Stale/unresolved KnowledgeItem query

**Files:**
- Create: `lib/knowledge/queries.ts`
- Test: `tests/knowledge-queries.test.ts`

**Interfaces:**
- Consumes: `isDueForFreshnessReview`, `type KnowledgeItem` from
  `../lib/knowledge/model.ts` (existing, unmodified).
- Produces (Task 5 consumes these exact names):
  `type StaleReason = "freshness_due" | "unresolved_review" | "ownerless"`,
  `type StaleKnowledgeItem = { item: KnowledgeItem; reasons: StaleReason[] }`,
  `function findStaleOrUnresolvedKnowledgeItems(items: readonly KnowledgeItem[], now: string): StaleKnowledgeItem[]`.

- [ ] **Step 1: Write failing tests**

Create `tests/knowledge-queries.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { newKnowledgeItem, recordFreshnessCheck, recordReviewerDecision, markUnderReview, type KnowledgeItem } from "../lib/knowledge/model.ts";
import { findStaleOrUnresolvedKnowledgeItems } from "../lib/knowledge/queries.ts";

const NOW = "2026-09-23T00:00:00.000Z";

function base(over: Partial<Parameters<typeof newKnowledgeItem>[0]> = {}): KnowledgeItem {
  return newKnowledgeItem({
    type: "procedure",
    title: "How to request a new connector",
    description: "Steps to get a new data source onboarded.",
    evidence: [{ pageSlug: "notion/onboarding/connector-request" }],
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

test("an approved item past its freshness-review date gets freshness_due", () => {
  const approved = recordReviewerDecision(markUnderReview(base(), "rev_1", NOW), "approved", "Taro", "", NOW);
  const overdue = recordFreshnessCheck(approved, "2026-09-01T00:00:00.000Z", NOW);
  const result = findStaleOrUnresolvedKnowledgeItems([overdue], "2026-09-23T00:00:00.000Z");
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].reasons, ["freshness_due"]);
});

test("an under_review item gets unresolved_review", () => {
  const underReview = markUnderReview(base(), "rev_2", NOW);
  const result = findStaleOrUnresolvedKnowledgeItems([underReview], NOW);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].reasons, ["unresolved_review"]);
});

test("a draft item with no owner gets ownerless", () => {
  const ownerless = base({ ownerId: "" });
  const result = findStaleOrUnresolvedKnowledgeItems([ownerless], NOW);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].reasons, ["ownerless"]);
});

test("a rejected item with no owner is settled — no reasons, not returned", () => {
  const rejected = recordReviewerDecision(markUnderReview(base({ ownerId: "" }), "rev_3", NOW), "rejected", "Taro", "", NOW);
  const result = findStaleOrUnresolvedKnowledgeItems([rejected], NOW);
  assert.equal(result.length, 0);
});

test("an item can carry multiple reasons at once", () => {
  const underReviewAndOwnerless = markUnderReview(base({ ownerId: "" }), "rev_4", NOW);
  const result = findStaleOrUnresolvedKnowledgeItems([underReviewAndOwnerless], NOW);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].reasons.sort(), ["ownerless", "unresolved_review"]);
});

test("a fresh, owned, approved item is not returned", () => {
  const approved = recordReviewerDecision(markUnderReview(base(), "rev_5", NOW), "approved", "Taro", "", NOW);
  const fresh = recordFreshnessCheck(approved, "2099-01-01T00:00:00.000Z", NOW);
  assert.equal(findStaleOrUnresolvedKnowledgeItems([fresh], NOW).length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test tests/knowledge-queries.test.ts`
Expected: FAIL — `lib/knowledge/queries.ts` does not exist yet.

- [ ] **Step 3: Implement**

Create `lib/knowledge/queries.ts`:

```typescript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/knowledge-queries.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge/queries.ts tests/knowledge-queries.test.ts
git commit -m "feat: add findStaleOrUnresolvedKnowledgeItems query"
```

---

### Task 2: MeetingProposal pure model

**Files:**
- Create: `lib/integrations/zoom/proposal.ts`
- Test: `tests/zoom-proposal.test.ts`

**Interfaces:**
- Consumes: `type EvidenceAnchor, type KnowledgeItem` from
  `../../knowledge/model.ts`; `type StaleReason` from
  `../../knowledge/queries.ts` (both existing, unmodified after Task 1).
- Produces (Task 4/Task 5 consume these exact names):
  `type MeetingProposalId = string`,
  `type MeetingProposalStatus = "draft" | "confirmed" | "created"`,
  `type MeetingProposal = { id, knowledgeItemId, reasons, topic, agendaText, evidence, proposedStartAt, proposedDurationMinutes, participantEmails, status, createdAt, createdBy, confirmedAt, confirmedBy, zoomMeeting }`,
  `function draftMeetingProposal(item: KnowledgeItem, reasons: StaleReason[], input: { createdBy: string; now?: string }): MeetingProposal`,
  `function confirmMeetingProposal(proposal: MeetingProposal, input: { proposedStartAt: string; proposedDurationMinutes?: number; participantEmails: string[]; confirmedBy: string; now?: string }): MeetingProposal`,
  `function markMeetingCreated(proposal: MeetingProposal, zoomMeeting: { id: string; joinUrl: string; startUrl: string }, now?: string): MeetingProposal`.

- [ ] **Step 1: Write failing tests for `draftMeetingProposal`**

Create `tests/zoom-proposal.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test tests/zoom-proposal.test.ts`
Expected: FAIL — `lib/integrations/zoom/proposal.ts` does not exist yet.

- [ ] **Step 3: Implement `draftMeetingProposal`**

Create `lib/integrations/zoom/proposal.ts`:

```typescript
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
    throw new Error("draftMeetingProposal requires at least one reason");
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/zoom-proposal.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/zoom/proposal.ts tests/zoom-proposal.test.ts
git commit -m "feat: add draftMeetingProposal"
```

- [ ] **Step 6: Write failing tests for `confirmMeetingProposal` and `markMeetingCreated`**

Append to `tests/zoom-proposal.test.ts`:

```typescript
import { confirmMeetingProposal, markMeetingCreated } from "../lib/integrations/zoom/proposal.ts";

function draft() {
  return draftMeetingProposal(knowledgeItem(), ["unresolved_review"], { createdBy: "Taro", now: NOW });
}

test("confirmMeetingProposal fills in the human-supplied details and moves to confirmed", () => {
  const confirmed = confirmMeetingProposal(draft(), {
    proposedStartAt: "2026-10-01T09:00:00.000Z",
    proposedDurationMinutes: 45,
    participantEmails: ["grace@example.com", "taro@example.com"],
    confirmedBy: "Grace",
    now: "2026-09-24T00:00:00.000Z",
  });
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.proposedStartAt, "2026-10-01T09:00:00.000Z");
  assert.equal(confirmed.proposedDurationMinutes, 45);
  assert.deepEqual(confirmed.participantEmails, ["grace@example.com", "taro@example.com"]);
  assert.equal(confirmed.confirmedBy, "Grace");
  assert.equal(confirmed.confirmedAt, "2026-09-24T00:00:00.000Z");
});

test("confirmMeetingProposal defaults duration to 30 when omitted", () => {
  const confirmed = confirmMeetingProposal(draft(), {
    proposedStartAt: "2026-10-01T09:00:00.000Z",
    participantEmails: [],
    confirmedBy: "Grace",
    now: NOW,
  });
  assert.equal(confirmed.proposedDurationMinutes, 30);
});

test("confirmMeetingProposal refuses a non-draft proposal, an invalid date, or a blank confirmedBy", () => {
  const already = confirmMeetingProposal(draft(), { proposedStartAt: "2026-10-01T09:00:00.000Z", participantEmails: [], confirmedBy: "Grace", now: NOW });
  assert.throws(() => confirmMeetingProposal(already, { proposedStartAt: "2026-10-01T09:00:00.000Z", participantEmails: [], confirmedBy: "Grace", now: NOW }), /draft/);
  assert.throws(() => confirmMeetingProposal(draft(), { proposedStartAt: "not-a-date", participantEmails: [], confirmedBy: "Grace", now: NOW }), /proposedStartAt/);
  assert.throws(() => confirmMeetingProposal(draft(), { proposedStartAt: "2026-10-01T09:00:00.000Z", participantEmails: [], confirmedBy: "", now: NOW }), /confirmedBy/);
});

test("markMeetingCreated moves confirmed -> created and attaches the real Zoom result", () => {
  const confirmed = confirmMeetingProposal(draft(), { proposedStartAt: "2026-10-01T09:00:00.000Z", participantEmails: [], confirmedBy: "Grace", now: NOW });
  const created = markMeetingCreated(confirmed, { id: "123456789", joinUrl: "https://zoom.us/j/123456789", startUrl: "https://zoom.us/s/123456789" }, "2026-09-24T00:01:00.000Z");
  assert.equal(created.status, "created");
  assert.deepEqual(created.zoomMeeting, { id: "123456789", joinUrl: "https://zoom.us/j/123456789", startUrl: "https://zoom.us/s/123456789" });
});

test("markMeetingCreated refuses a proposal that isn't confirmed", () => {
  assert.throws(() => markMeetingCreated(draft(), { id: "1", joinUrl: "x", startUrl: "y" }, NOW), /confirmed/);
});
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test tests/zoom-proposal.test.ts`
Expected: FAIL — `confirmMeetingProposal`/`markMeetingCreated` not exported.

- [ ] **Step 8: Implement `confirmMeetingProposal` and `markMeetingCreated`**

Append to `lib/integrations/zoom/proposal.ts`:

```typescript
/** A human supplies the concrete time/duration/participants and confirms.
 *  Requires the proposal to still be `draft` (a proposal can only be
 *  confirmed once), a parseable `proposedStartAt`, and a non-blank
 *  `confirmedBy` — no meeting detail is guessed. */
export function confirmMeetingProposal(
  proposal: MeetingProposal,
  input: { proposedStartAt: string; proposedDurationMinutes?: number; participantEmails: string[]; confirmedBy: string; now?: string },
): MeetingProposal {
  if (proposal.status !== "draft") {
    throw new Error(`meeting proposal "${proposal.id}" must be "draft" to confirm (current status: "${proposal.status}")`);
  }
  if (Number.isNaN(Date.parse(input.proposedStartAt))) {
    throw new Error(`proposedStartAt "${input.proposedStartAt}" is not a valid date`);
  }
  if (input.confirmedBy.trim() === "") {
    throw new Error("confirmMeetingProposal requires a non-blank confirmedBy");
  }
  const now = input.now ?? new Date().toISOString();
  const next = clone(proposal);
  next.status = "confirmed";
  next.proposedStartAt = input.proposedStartAt;
  next.proposedDurationMinutes = input.proposedDurationMinutes ?? 30;
  next.participantEmails = [...input.participantEmails];
  next.confirmedBy = input.confirmedBy;
  next.confirmedAt = now;
  return next;
}

/** The real Zoom API call succeeded (made by lib/integrations/zoom/client.ts,
 *  outside this pure module) — attach its result and move to `created`.
 *  Requires the proposal to be `confirmed` first. */
export function markMeetingCreated(
  proposal: MeetingProposal,
  zoomMeeting: { id: string; joinUrl: string; startUrl: string },
  now = new Date().toISOString(),
): MeetingProposal {
  if (proposal.status !== "confirmed") {
    throw new Error(`meeting proposal "${proposal.id}" must be "confirmed" before it can be marked created (current status: "${proposal.status}")`);
  }
  const next = clone(proposal);
  next.status = "created";
  next.zoomMeeting = { ...zoomMeeting };
  return next;
}
```

Note: `now` is unused in `markMeetingCreated` beyond its default — this
matches the plan's own interface signature (`now?: string`); leave the
parameter as specified even though the current implementation doesn't
store it on the record, since a later task may want a `createdAt`-style
timestamp on `zoomMeeting` and changing this signature later would be a
breaking change for no reason now.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/zoom-proposal.test.ts`
Expected: PASS (7 tests total).

- [ ] **Step 10: Commit**

```bash
git add lib/integrations/zoom/proposal.ts tests/zoom-proposal.test.ts
git commit -m "feat: add confirmMeetingProposal and markMeetingCreated"
```

---

### Task 3: Zoom API client

**Files:**
- Create: `lib/integrations/zoom/client.ts`
- Test: `tests/zoom-client.test.ts`

**Interfaces:**
- Consumes: `resolveSecret` from `../connectors/shared/config.ts` (existing,
  unmodified).
- Produces (Task 5 consumes these exact names):
  `type ZoomCredentials = { accountId: string; clientId: string; clientSecret: string }`,
  `function resolveZoomCredentials(env?: Record<string, string | undefined>): ZoomCredentials`,
  `type ZoomMeetingResult = { id: string; joinUrl: string; startUrl: string }`,
  `function createZoomMeeting(creds: ZoomCredentials, input: { topic: string; agenda: string; startTime: string; durationMinutes: number }, opts?: { fetchImpl?: typeof fetch }): Promise<ZoomMeetingResult>`.

- [ ] **Step 1: Write failing tests**

Create `tests/zoom-client.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { createZoomMeeting, resolveZoomCredentials, type ZoomCredentials } from "../lib/integrations/zoom/client.ts";

const CREDS: ZoomCredentials = { accountId: "acct_123", clientId: "client_abc", clientSecret: "secret_xyz" };

test("resolveZoomCredentials reads the three env vars via resolveSecret", () => {
  const env = { ZOOM_ACCOUNT_ID: "acct_1", ZOOM_CLIENT_ID: "client_1", ZOOM_CLIENT_SECRET: "secret_1" };
  assert.deepEqual(resolveZoomCredentials(env), { accountId: "acct_1", clientId: "client_1", clientSecret: "secret_1" });
});

test("resolveZoomCredentials throws a clear error when a var is missing", () => {
  assert.throws(() => resolveZoomCredentials({}), /ZOOM_ACCOUNT_ID/);
});

test("createZoomMeeting calls the OAuth token endpoint then the meeting-create endpoint with the exact expected request shape", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("zoom.us/oauth/token")) {
      return new Response(JSON.stringify({ access_token: "fake-token" }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 987654321, join_url: "https://zoom.us/j/987654321", start_url: "https://zoom.us/s/987654321" }), { status: 201 });
  }) as typeof fetch;

  const result = await createZoomMeeting(CREDS, {
    topic: "Follow-up: connector request process",
    agenda: "Steps to get a new data source onboarded.\n\nEvidence: notion/onboarding/connector-request",
    startTime: "2026-10-01T09:00:00.000Z",
    durationMinutes: 45,
  }, { fetchImpl });

  assert.deepEqual(result, { id: "987654321", joinUrl: "https://zoom.us/j/987654321", startUrl: "https://zoom.us/s/987654321" });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /^https:\/\/zoom\.us\/oauth\/token\?grant_type=account_credentials&account_id=acct_123$/);
  assert.equal(calls[0].init.method, "POST");
  const authHeader = (calls[0].init.headers as Record<string, string>).Authorization;
  assert.equal(authHeader, `Basic ${Buffer.from("client_abc:secret_xyz").toString("base64")}`);

  assert.equal(calls[1].url, "https://api.zoom.us/v2/users/me/meetings");
  assert.equal(calls[1].init.method, "POST");
  assert.equal((calls[1].init.headers as Record<string, string>).Authorization, "Bearer fake-token");
  const body = JSON.parse(calls[1].init.body as string);
  assert.equal(body.topic, "Follow-up: connector request process");
  assert.equal(body.type, 2);
  assert.equal(body.start_time, "2026-10-01T09:00:00.000Z");
  assert.equal(body.duration, 45);
  assert.equal(body.settings.join_before_host, false);
});

test("createZoomMeeting throws with status and body on a non-2xx OAuth response", async () => {
  const fetchImpl = (async () => new Response("invalid_client", { status: 401 })) as typeof fetch;
  await assert.rejects(
    createZoomMeeting(CREDS, { topic: "x", agenda: "y", startTime: "2026-10-01T09:00:00.000Z", durationMinutes: 30 }, { fetchImpl }),
    /401.*invalid_client/s,
  );
});

test("createZoomMeeting throws with status and body on a non-2xx meeting-create response", async () => {
  const fetchImpl = (async (url: string) => {
    if (String(url).includes("oauth/token")) return new Response(JSON.stringify({ access_token: "fake-token" }), { status: 200 });
    return new Response("start_time is invalid", { status: 400 });
  }) as typeof fetch;
  await assert.rejects(
    createZoomMeeting(CREDS, { topic: "x", agenda: "y", startTime: "bad", durationMinutes: 30 }, { fetchImpl }),
    /400.*start_time is invalid/s,
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test tests/zoom-client.test.ts`
Expected: FAIL — `lib/integrations/zoom/client.ts` does not exist yet.

- [ ] **Step 3: Implement**

Create `lib/integrations/zoom/client.ts`:

```typescript
/**
 * The only network-touching module in the Zoom follow-up meeting feature.
 * Server-to-Server OAuth against Zoom's REST API. Credentials are resolved
 * only from environment variables via the repo's existing resolveSecret()
 * — never a literal value, never logged. See
 * docs/superpowers/specs/2026-09-22-zoom-followup-meeting-design.md Part 3.
 */

import { resolveSecret } from "../../connectors/shared/config.ts";

export type ZoomCredentials = { accountId: string; clientId: string; clientSecret: string };

export function resolveZoomCredentials(env: Record<string, string | undefined> = process.env): ZoomCredentials {
  return {
    accountId: resolveSecret("env:ZOOM_ACCOUNT_ID", env),
    clientId: resolveSecret("env:ZOOM_CLIENT_ID", env),
    clientSecret: resolveSecret("env:ZOOM_CLIENT_SECRET", env),
  };
}

export type ZoomMeetingResult = { id: string; joinUrl: string; startUrl: string };

async function getAccessToken(creds: ZoomCredentials, fetchImpl: typeof fetch): Promise<string> {
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const res = await fetchImpl(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${creds.accountId}`,
    { method: "POST", headers: { Authorization: `Basic ${basic}` } },
  );
  if (!res.ok) throw new Error(`zoom oauth ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

/** Creates a real Zoom meeting. Every call requires a human to have already
 *  confirmed the exact topic/agenda/time — see
 *  lib/integrations/zoom/proposal.ts's confirmMeetingProposal(), which the
 *  caller (scripts/demo.ts's confirmZoomMeeting()) must run first. */
export async function createZoomMeeting(
  creds: ZoomCredentials,
  input: { topic: string; agenda: string; startTime: string; durationMinutes: number },
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<ZoomMeetingResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const token = await getAccessToken(creds, fetchImpl);
  const res = await fetchImpl("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      topic: input.topic,
      agenda: input.agenda,
      type: 2,
      start_time: input.startTime,
      duration: input.durationMinutes,
      settings: { join_before_host: false },
    }),
  });
  if (!res.ok) throw new Error(`zoom create meeting ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { id: String(data.id), joinUrl: data.join_url, startUrl: data.start_url };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/zoom-client.test.ts`
Expected: PASS (5 tests). Confirm no test made a real network request (all
`fetchImpl` values are local fakes).

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/zoom/client.ts tests/zoom-client.test.ts
git commit -m "feat: add the Zoom API client (Server-to-Server OAuth, injectable fetch)"
```

---

### Task 4: MeetingProposal persistence

**Files:**
- Create: `lib/integrations/zoom/proposal-store.ts`
- Test: `tests/zoom-proposal-store.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `writePrivateFileAtomic` from `../../util/private-file.ts`;
  `type MeetingProposal, type MeetingProposalStatus` from `./proposal.ts`
  (existing, unmodified after Task 2).
- Produces (Task 5 consumes these exact names):
  `const DEFAULT_PROPOSAL_STORE_PATH: string`,
  `function loadMeetingProposals(path?: string): MeetingProposal[]`,
  `function saveMeetingProposals(items: readonly MeetingProposal[], path?: string): void`,
  `function upsertMeetingProposal(proposal: MeetingProposal, path?: string): MeetingProposal[]`,
  `function getMeetingProposal(id: string, path?: string): MeetingProposal | undefined`.

This task mirrors `lib/knowledge/store.ts` (Task 2 of the prior plan)
exactly, including the corrupt-file-backup-before-overwrite guard that
plan's final review required — it does not need to reinvent or re-discover
that design, only apply the same, already-proven pattern to a new type.

- [ ] **Step 1: Write failing tests**

Create `tests/zoom-proposal-store.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test tests/zoom-proposal-store.test.ts`
Expected: FAIL — `lib/integrations/zoom/proposal-store.ts` does not exist yet.

- [ ] **Step 3: Implement**

Create `lib/integrations/zoom/proposal-store.ts`:

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writePrivateFileAtomic } from "../../util/private-file.ts";
import type { MeetingProposal, MeetingProposalStatus } from "./proposal.ts";

/** Local, owner-only-permission JSON store for MeetingProposals — mirrors
 *  lib/knowledge/store.ts exactly, including its corrupt-file-backup-
 *  before-overwrite guard (a prior plan's final review hardened this
 *  pattern; this module reuses it rather than re-deriving it). */
export const DEFAULT_PROPOSAL_STORE_PATH = join(process.cwd(), "config/meeting-proposals.json");

type ProposalStoreFile = { proposals: MeetingProposal[] };

const STATUSES: MeetingProposalStatus[] = ["draft", "confirmed", "created"];

function isEvidenceAnchor(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.pageSlug === "string"
    && (v.chunkIndex === undefined || typeof v.chunkIndex === "number")
    && (v.excerpt === undefined || typeof v.excerpt === "string");
}

function isZoomMeeting(value: unknown): boolean {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.joinUrl === "string" && typeof v.startUrl === "string";
}

function isMeetingProposal(value: unknown): value is MeetingProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string"
    && typeof v.knowledgeItemId === "string"
    && Array.isArray(v.reasons)
    && typeof v.topic === "string"
    && typeof v.agendaText === "string"
    && Array.isArray(v.evidence) && v.evidence.every(isEvidenceAnchor)
    && (v.proposedStartAt === null || typeof v.proposedStartAt === "string")
    && typeof v.proposedDurationMinutes === "number"
    && Array.isArray(v.participantEmails)
    && STATUSES.includes(v.status as never)
    && typeof v.createdAt === "string"
    && typeof v.createdBy === "string"
    && (v.confirmedAt === null || typeof v.confirmedAt === "string")
    && (v.confirmedBy === null || typeof v.confirmedBy === "string")
    && isZoomMeeting(v.zoomMeeting);
}

/** Missing or corrupt store files are treated as an empty store, not an
 *  error — the store has no rows before the first proposal is ever saved. */
export function loadMeetingProposals(path: string = DEFAULT_PROPOSAL_STORE_PATH): MeetingProposal[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ProposalStoreFile>;
    const proposals = Array.isArray(parsed.proposals) ? parsed.proposals : [];
    return proposals.filter(isMeetingProposal);
  } catch {
    return [];
  }
}

export function saveMeetingProposals(proposals: readonly MeetingProposal[], path: string = DEFAULT_PROPOSAL_STORE_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  const file: ProposalStoreFile = { proposals: [...proposals] };
  writePrivateFileAtomic(path, `${JSON.stringify(file, null, 2)}\n`);
}

/** If `path` exists but its raw content does not parse as JSON, best-effort
 *  copy the corrupt bytes aside before they get overwritten by the next
 *  save — same guard as lib/knowledge/store.ts's backUpIfCorrupt(). */
function backUpIfCorrupt(path: string): void {
  try {
    if (!existsSync(path)) return;
    const raw = readFileSync(path, "utf8");
    try {
      JSON.parse(raw);
      return;
    } catch {
      writeFileSync(`${path}.corrupt-${Date.now()}.bak`, raw, "utf8");
    }
  } catch {
    // best-effort only — never block the actual upsert.
  }
}

export function upsertMeetingProposal(proposal: MeetingProposal, path: string = DEFAULT_PROPOSAL_STORE_PATH): MeetingProposal[] {
  const proposals = loadMeetingProposals(path);
  backUpIfCorrupt(path);
  const idx = proposals.findIndex((p) => p.id === proposal.id);
  const next = idx >= 0 ? [...proposals.slice(0, idx), proposal, ...proposals.slice(idx + 1)] : [...proposals, proposal];
  saveMeetingProposals(next, path);
  return next;
}

export function getMeetingProposal(id: string, path: string = DEFAULT_PROPOSAL_STORE_PATH): MeetingProposal | undefined {
  return loadMeetingProposals(path).find((p) => p.id === id);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/zoom-proposal-store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add `.gitignore` entries**

Add these three lines to `.gitignore`, in the same block as
`/config/knowledge-items.json` (added by the prior plan):

```
/config/meeting-proposals.json
/config/meeting-proposals.json.*.tmp
/config/meeting-proposals.json.corrupt-*.bak
```

- [ ] **Step 6: Commit**

```bash
git add lib/integrations/zoom/proposal-store.ts tests/zoom-proposal-store.test.ts .gitignore
git commit -m "feat: add owner-only JSON persistence for MeetingProposals"
```

---

### Task 5: Wire into `scripts/demo.ts` — routes, business logic, activity, UI

**Files:**
- Modify: `scripts/demo.ts`
- Test: `tests/zoom-meeting-routes.test.ts` (new file)
- Modify: `tests/tako-ui.test.ts` (add the `activityView()` third-source test)
- Modify: `package.json:2` (register both new test files)

**Interfaces:**
- Consumes: everything produced by Tasks 1–4
  (`findStaleOrUnresolvedKnowledgeItems`, `draftMeetingProposal`,
  `confirmMeetingProposal`, `markMeetingCreated`, `resolveZoomCredentials`,
  `createZoomMeeting`, `loadMeetingProposals`, `upsertMeetingProposal`,
  `getMeetingProposal`), plus the existing, unmodified
  `loadKnowledgeItems`/`getKnowledgeItem` from `../lib/knowledge/store.ts`,
  `REPO`, `ClientError`, `json`, `ADMIN_ROUTES` (all already in
  `scripts/demo.ts`).
- Produces: `function proposeZoomMeeting(...)`,
  `async function confirmZoomMeeting(...)` exported from `scripts/demo.ts`
  (no later task in this plan consumes these — they're the terminal layer).

**Before starting:** re-read the current `scripts/demo.ts` in full around
`ADMIN_ROUTES`, the route if-chain, `activityView()`, and the
`data-name="automations"` markup block — other work has been landing on
this file continuously; do not assume the line numbers in this plan or the
spec still match.

- [ ] **Step 1: Write failing tests for `proposeZoomMeeting` and `confirmZoomMeeting`**

Create `tests/zoom-meeting-routes.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test tests/zoom-meeting-routes.test.ts`
Expected: FAIL — `proposeZoomMeeting`/`confirmZoomMeeting` not exported from
`scripts/demo.ts` yet.

- [ ] **Step 3: Add the imports and business-logic functions to `scripts/demo.ts`**

Add these imports near the top of `scripts/demo.ts`, alongside its existing
`lib/` imports:

```typescript
import { findStaleOrUnresolvedKnowledgeItems } from "../lib/knowledge/queries.ts";
import { getKnowledgeItem, loadKnowledgeItems } from "../lib/knowledge/store.ts";
import { createZoomMeeting, resolveZoomCredentials, type ZoomCredentials } from "../lib/integrations/zoom/client.ts";
import { confirmMeetingProposal, draftMeetingProposal, markMeetingCreated } from "../lib/integrations/zoom/proposal.ts";
import {
  DEFAULT_PROPOSAL_STORE_PATH, getMeetingProposal, loadMeetingProposals, upsertMeetingProposal,
} from "../lib/integrations/zoom/proposal-store.ts";
```

Add the two business-logic functions (place them near `submitReview()`/
`reviewDecide()` — same section of the file, same style):

```typescript
const KNOWLEDGE_STORE_PATH = join(REPO, "config/knowledge-items.json");
const PROPOSAL_STORE_PATH = join(REPO, "config/meeting-proposals.json");

/** Drafts a real follow-up-meeting proposal for a real stale/unresolved
 *  KnowledgeItem — see docs/superpowers/specs/2026-09-22-zoom-followup-meeting-design.md
 *  Part 5. Reasons are recomputed server-side; a client can never invent
 *  why an item was "stale." */
export function proposeZoomMeeting(
  input: { knowledgeItemId: string; createdBy: string },
  opts: { knowledgeStorePath?: string; proposalStorePath?: string; now?: string } = {},
) {
  const knowledgeStorePath = opts.knowledgeStorePath ?? KNOWLEDGE_STORE_PATH;
  const proposalStorePath = opts.proposalStorePath ?? PROPOSAL_STORE_PATH;
  const item = getKnowledgeItem(input.knowledgeItemId, knowledgeStorePath);
  if (!item) throw new ClientError(`knowledge item "${input.knowledgeItemId}" not found`);
  const now = opts.now ?? new Date().toISOString();
  const [stale] = findStaleOrUnresolvedKnowledgeItems([item], now);
  if (!stale) throw new ClientError(`knowledge item "${input.knowledgeItemId}" is not stale or unresolved`);
  const proposal = draftMeetingProposal(item, stale.reasons, { createdBy: input.createdBy, now });
  upsertMeetingProposal(proposal, proposalStorePath);
  return proposal;
}

/** Confirms a proposal's human-supplied details, then makes the one real
 *  outbound call this feature exists to make — creating the Zoom meeting.
 *  The proposal is persisted as "confirmed" before the Zoom call, so a
 *  failed call never loses the human's confirmed details; it can be
 *  retried by re-POSTing confirm with the same proposalId once the
 *  underlying problem (e.g. bad credentials) is fixed. */
export async function confirmZoomMeeting(
  input: { proposalId: string; proposedStartAt: string; proposedDurationMinutes?: number; participantEmails: string[]; confirmedBy: string },
  opts: { proposalStorePath?: string; now?: string; zoomCredentials?: ZoomCredentials; fetchImpl?: typeof fetch } = {},
) {
  const proposalStorePath = opts.proposalStorePath ?? PROPOSAL_STORE_PATH;
  const existing = getMeetingProposal(input.proposalId, proposalStorePath);
  if (!existing) throw new ClientError(`meeting proposal "${input.proposalId}" not found`);
  const confirmed = confirmMeetingProposal(existing, {
    proposedStartAt: input.proposedStartAt,
    proposedDurationMinutes: input.proposedDurationMinutes,
    participantEmails: input.participantEmails,
    confirmedBy: input.confirmedBy,
    now: opts.now,
  });
  upsertMeetingProposal(confirmed, proposalStorePath);

  const creds = opts.zoomCredentials ?? resolveZoomCredentials();
  const zoomMeeting = await createZoomMeeting(creds, {
    topic: confirmed.topic,
    agenda: confirmed.agendaText,
    startTime: confirmed.proposedStartAt!,
    durationMinutes: confirmed.proposedDurationMinutes,
  }, { fetchImpl: opts.fetchImpl });

  const created = markMeetingCreated(confirmed, zoomMeeting, opts.now);
  upsertMeetingProposal(created, proposalStorePath);
  return created;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/zoom-meeting-routes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/demo.ts tests/zoom-meeting-routes.test.ts
git commit -m "feat: add proposeZoomMeeting and confirmZoomMeeting business logic"
```

- [ ] **Step 6: Add the two HTTP routes and extend `ADMIN_ROUTES`**

Re-read the current `ADMIN_ROUTES` set and route if-chain first (per the
"Before starting" note above — other commits may have changed their exact
shape). Add these two route strings to the `ADMIN_ROUTES` set:

```
"/api/automations/zoom-meeting/propose",
"/api/automations/zoom-meeting/confirm",
```

Add the two route handlers to the if-chain, following the existing
`/api/review-submit`/`/api/review-decide` handlers' shape exactly (parse
body via `readJsonBody`, call the business function, wrap in the same
try/catch -> `safeErrorResponse(err, json)` pattern already used
throughout the file):

```typescript
if (url.pathname === "/api/automations/zoom-meeting/propose" && req.method === "POST") {
  try {
    const body = await readJsonBody(req);
    return json(proposeZoomMeeting({ knowledgeItemId: String(body.knowledgeItemId ?? ""), createdBy: String(body.createdBy ?? "") }));
  } catch (err) {
    return safeErrorResponse(err, json);
  }
}
if (url.pathname === "/api/automations/zoom-meeting/confirm" && req.method === "POST") {
  try {
    const body = await readJsonBody(req);
    const result = await confirmZoomMeeting({
      proposalId: String(body.proposalId ?? ""),
      proposedStartAt: String(body.proposedStartAt ?? ""),
      proposedDurationMinutes: body.proposedDurationMinutes ? Number(body.proposedDurationMinutes) : undefined,
      participantEmails: Array.isArray(body.participantEmails) ? body.participantEmails.map(String) : [],
      confirmedBy: String(body.confirmedBy ?? ""),
    });
    return json(result);
  } catch (err) {
    return safeErrorResponse(err, json);
  }
}
```

Also add one read-only route (not in `ADMIN_ROUTES`, matching the existing
unauthenticated-GET convention):

```typescript
if (url.pathname === "/api/knowledge/stale" && req.method === "GET") {
  const items = loadKnowledgeItems(KNOWLEDGE_STORE_PATH);
  return json({ items: findStaleOrUnresolvedKnowledgeItems(items, new Date().toISOString()) });
}
if (url.pathname === "/api/automations/zoom-meeting/proposals" && req.method === "GET") {
  return json({ proposals: loadMeetingProposals(PROPOSAL_STORE_PATH) });
}
```

- [ ] **Step 7: Run the full existing test suite (routes not yet wired into `activityView()` — that's the next step)**

Run: `node --experimental-strip-types --test tests/zoom-meeting-routes.test.ts`
Expected: still PASS (routes don't change the business-logic functions'
behavior, only expose them over HTTP).

- [ ] **Step 8: Commit**

```bash
git add scripts/demo.ts
git commit -m "feat: add the propose/confirm/list Zoom meeting HTTP routes"
```

- [ ] **Step 9: Write a failing test for `activityView()`'s new third source**

Read `tests/tako-ui.test.ts`'s existing `withSeededRetryReview()` helper
(top of the file) before writing this — mirror its exact save/restore
discipline. Add a `PROPOSALS_PATH` constant and a
`withSeededMeetingProposal()` helper, then a new test, appended to
`tests/tako-ui.test.ts`:

```typescript
const PROPOSALS_PATH = join(import.meta.dir, "..", "config", "meeting-proposals.json");
function withSeededMeetingProposal<T>(status: "draft" | "confirmed" | "created", fn: () => T): T {
  const existed = existsSync(PROPOSALS_PATH);
  const original = existed ? readFileSync(PROPOSALS_PATH, "utf8") : null;
  const fixture = {
    proposals: [{
      id: "mtgprop_test_fixture",
      knowledgeItemId: "ki_test_fixture",
      reasons: ["ownerless"],
      topic: "Test fixture follow-up",
      agendaText: "test agenda",
      evidence: [{ pageSlug: "shared/notes/x" }],
      proposedStartAt: status === "draft" ? null : "2026-10-01T09:00:00.000Z",
      proposedDurationMinutes: 30,
      participantEmails: [],
      status,
      createdAt: "2026-09-23T00:00:00.000Z",
      createdBy: "test",
      confirmedAt: status === "draft" ? null : "2026-09-24T00:00:00.000Z",
      confirmedBy: status === "draft" ? null : "test",
      zoomMeeting: status === "created" ? { id: "1", joinUrl: "https://zoom.us/j/1", startUrl: "https://zoom.us/s/1" } : null,
    }],
  };
  try {
    writeFileSync(PROPOSALS_PATH, JSON.stringify(fixture, null, 2));
    return fn();
  } finally {
    if (existed) writeFileSync(PROPOSALS_PATH, original!);
    else if (existsSync(PROPOSALS_PATH)) unlinkSync(PROPOSALS_PATH);
  }
}

test("activityView surfaces a created Zoom meeting proposal as a success entry, and nothing for draft/confirmed", () => {
  withSeededMeetingProposal("created", () => {
    const { entries } = activityView();
    const entry = entries.find((e) => e.id === "mtgprop_test_fixture");
    assert.ok(entry, "expected a created proposal to produce an activity entry");
    assert.equal(entry!.label, "Zoom meeting created: Test fixture follow-up");
    assert.equal(entry!.outcome, "success");
    assert.equal(entry!.initiator, "test");
  });
  withSeededMeetingProposal("confirmed", () => {
    const { entries } = activityView();
    assert.equal(entries.find((e) => e.id === "mtgprop_test_fixture"), undefined);
  });
  withSeededMeetingProposal("draft", () => {
    const { entries } = activityView();
    assert.equal(entries.find((e) => e.id === "mtgprop_test_fixture"), undefined);
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `bun test tests/tako-ui.test.ts` (this file already runs under `bun
test`, per the existing `package.json` test script's second command)
Expected: FAIL — `activityView()` has no third source yet, so no matching
entry is found for the `"created"` case.

- [ ] **Step 11: Extend `activityView()` with the third source**

In `scripts/demo.ts`, inside `activityView()`, add a third block after the
existing "Source 2: every real review-submission event" loop:

```typescript
// Source 3: every real Zoom meeting actually created via a follow-up
// proposal. A "draft" or "confirmed" (not yet created) proposal
// contributes nothing here — an unconfirmed or failed-to-create meeting
// never happened, so it must not appear to have.
for (const p of loadMeetingProposals(PROPOSAL_STORE_PATH)) {
  if (p.status !== "created") continue;
  entries.push({
    id: p.id,
    time: p.confirmedAt,
    label: `Zoom meeting created: ${p.topic}`,
    initiator: p.confirmedBy ?? "—",
    sources: p.evidence.map((e) => e.pageSlug),
    outcome: "success",
    outcomeLabel: "Success",
    duration: "—",
    needsRetry: false,
  });
}
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `bun test tests/tako-ui.test.ts`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add scripts/demo.ts tests/tako-ui.test.ts
git commit -m "feat: surface created Zoom meetings in activityView()"
```

- [ ] **Step 14: Add the Automations-screen UI section**

Re-read the current Automations screen markup around
`data-name="automations"` (per the "Before starting" note). Insert a new,
clearly separate block immediately after the existing
`#automation-success` block's closing tag (do not restructure or remove
any existing element):

```html
<section class="tako-followup-meetings" id="followup-meetings-section">
  <h2>Follow-up meeting suggestions</h2>
  <p class="hint">Real knowledge items that are overdue for review, stuck awaiting a decision, or have no owner.</p>
  <ul id="followup-meeting-list"><li class="tako-skeleton tako-skeleton-row" aria-hidden="true"></li></ul>
  <div class="tako-panel" id="followup-meeting-draft-panel" hidden>
    <h3 id="followup-draft-topic"></h3>
    <pre id="followup-draft-agenda"></pre>
    <label>Start time <input type="datetime-local" id="followup-start-time"></label>
    <label>Duration (minutes) <input type="number" id="followup-duration" value="30"></label>
    <label>Participant emails (comma-separated) <input type="text" id="followup-participants"></label>
    <div class="note-err" id="followup-draft-error" hidden></div>
    <button class="tako-btn tako-btn--primary" data-action="confirm-zoom-meeting">Create Zoom Meeting</button>
  </div>
  <div id="followup-meeting-result" hidden></div>
</section>
```

Add a small client-side script block (inline `<script>`, matching this
file's existing pattern of inline client JS elsewhere on the page) that:
fetches `/api/knowledge/stale` on the Automations screen's activation and
renders `#followup-meeting-list`; on a "Propose follow-up meeting" button
click, `POST`s `/api/automations/zoom-meeting/propose` with the item's id
and the admin token (same `adminApi()` helper the existing builder already
uses, e.g. `scripts/demo.ts:2623`'s call pattern) and shows the returned
draft in `#followup-meeting-draft-panel`; on `data-action="confirm-zoom-
meeting"`, `POST`s `/api/automations/zoom-meeting/confirm` with the edited
fields and displays either the real `joinUrl` in
`#followup-meeting-result` or the error message in
`#followup-draft-error`.

- [ ] **Step 15: Register the new test file and run the full suite**

**Files:**
- Modify: `package.json:2`

Insert `tests/knowledge-queries.test.ts tests/zoom-proposal.test.ts
tests/zoom-client.test.ts tests/zoom-proposal-store.test.ts
tests/zoom-meeting-routes.test.ts` into the `node --experimental-strip-
types --test ...` file list (position: anywhere after
`tests/knowledge-store.test.ts`, matching where the prior plan's knowledge
tests were inserted).

Run: `bun run test`
Expected: PASS — every existing test plus all new tests from Tasks 1–5
pass, with 0 failures.

- [ ] **Step 16: Commit**

```bash
git add scripts/demo.ts package.json
git commit -m "feat: add the follow-up meeting suggestions UI section to Automations"
```

---

### Task 6: Seed fixture data

**Files:**
- Create: `scripts/seed-knowledge-items.ts`

**Interfaces:**
- Consumes: `newKnowledgeItem`, `markUnderReview`, `recordReviewerDecision`,
  `recordFreshnessCheck` from `../lib/knowledge/model.ts`;
  `upsertKnowledgeItem` from `../lib/knowledge/store.ts` (all existing,
  unmodified).

- [ ] **Step 1: Write the seed script**

Create `scripts/seed-knowledge-items.ts`:

```typescript
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
```

- [ ] **Step 2: Run it and verify real output**

Run: `bun scripts/seed-knowledge-items.ts`
Expected: prints three `seeded ki_... — [SEED] ...` lines, and
`config/knowledge-items.json` now exists with three items whose ids all
appear when running `bun -e 'import { loadKnowledgeItems } from "./lib/knowledge/store.ts"; console.log(loadKnowledgeItems().map(i => [i.id, i.status]))'`.
Then run `node --experimental-strip-types --test tests/knowledge-queries.test.ts`
once more to confirm the seed script's presence doesn't affect that test
file's own (temp-path-based) tests.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-knowledge-items.ts
git commit -m "feat: add a seed script for demo KnowledgeItem fixture data"
```

---

## Self-Review Notes (for whoever executes this plan)

- **Spec coverage:** implements every part of
  `docs/superpowers/specs/2026-09-22-zoom-followup-meeting-design.md`
  (Parts 1–6 map to Tasks 1–6; Part 7's security requirements are satisfied
  by Task 3's credential handling and Task 5's error propagation; Part 8's
  tests are all present across the six tasks' test steps).
- **No new trigger type, no touching `AB_TRIGGER_OPTIONS`/
  `AB_ACTION_OPTIONS`/`createAutomation()`/the automation-canvas adapter** —
  verified against every task's file list above.
- **No appendable activity log invented** — Task 5 Step 11 extends the
  existing `activityView()` function in place, per the spec's correction.
- **No real Zoom API call in any test** — every test across Tasks 3 and 5
  injects a fake `fetchImpl`.
- **Local Meeting Transcriber, Graflow, meeting-publish-inbox branches:**
  not touched by any task.
- **Type consistency check performed:** `MeetingProposal`'s field names and
  `StaleReason`/`ZoomCredentials`/`ZoomMeetingResult` types are used
  identically across Tasks 2–5's code blocks; no drift found between a
  type's definition (Task 2 or 3) and its later consumers (Tasks 4–5).
