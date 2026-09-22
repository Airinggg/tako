# Real Follow-Up Meeting Creation (Zoom) — Design Spec

**Status:** Design approved in chat; written up for review before an
implementation plan. No implementation code, packages, or deployments are
authorized by this document.

## 0. Objective and non-goals

### Objective

Give the Automations page one genuinely real, end-to-end capability: a
manager sees a real, stale-or-unresolved `KnowledgeItem` (from the Company
Brain foundation merged earlier this session), proposes a follow-up
meeting citing that item's real evidence, and — only after explicitly
confirming the details — the system creates a real Zoom meeting via Zoom's
API and shows the real join link. This is the first thing in the product
that both executes on its own schedule-free trigger (a button click, not a
cron) and reaches outside the local machine.

### Why this, why now

Verified today (via direct code inspection, not assumption):
`createAutomation()` (`scripts/demo.ts:254`) only writes a `SKILL.md`
description file. There is no scheduler, no trigger detection, and no
execution engine wired into the running server — `lib/workers/run.ts`'s own
header comment states "Run a worker into the approval queue. This function
never delivers output," and that module isn't even called from
`scripts/demo.ts`. The single "Automation run" activity entry visible in the
demo (`scripts/demo.ts:826-938`, the module-level `skillRun` variable) is
one hardcoded example run, not live execution. This feature closes that gap
for one concrete, real, governed use case rather than building a general
execution engine no one has asked for yet (YAGNI).

### Non-goals

- Not a general automation execution engine. This does not wire up
  `lib/workers/` or make the existing trigger/action builder
  (`AB_TRIGGER_OPTIONS`/`AB_ACTION_OPTIONS`, `createAutomation()`) live.
  Those stay exactly as they are.
- Not a 6th trigger type on the existing builder. `AB_TRIGGER_OPTIONS` and
  the automation-canvas adapter's `CONNECTOR_SPECS` mapping
  (`docs/superpowers/specs/2026-09-22-automation-canvas-design.md`) are
  owned by concurrent, in-flight work on this same branch — this feature
  does not touch either, to avoid colliding with it mid-flight.
- Not calendar free/busy integration. Per the meeting-publish-inbox spec's
  §12 scheduling boundary, Tako has no calendar connector; this feature
  does not invent one. The human supplies the proposed time directly.
- Not tied to the meeting-publish-inbox's transcript-derived
  "meeting-necessity-review" signal — that feature lives on a separate
  branch (`feat/meeting-publish-inbox`), is not built yet even there
  (no `lib/meetings/analysis.ts` exists), and this spec does not touch or
  duplicate that work. This feature's evidence source is the
  `KnowledgeItem` store merged earlier this session instead.
- Not dependent on the paused Task 4 (review-bridge) plan. A
  `KnowledgeItem` can be stale, unresolved, or ownerless regardless of
  whether the review-bridge exists; this feature only reads the store.
- No automatic meeting creation of any kind. Every Zoom API call happens
  synchronously inside a request a human just issued by clicking a
  specific "Create Zoom Meeting" button after reviewing the exact details.
- No editing of the underlying `KnowledgeItem` itself (status, evidence,
  etc.) — this feature only reads knowledge items, it never mutates one.
- No change to the stopped Graflow experiment or the Local Meeting
  Transcriber.

## 1. Evidence source: stale/unresolved KnowledgeItem query

New, pure function, `lib/knowledge/queries.ts`:

```ts
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

This reuses `isDueForFreshnessReview()` from the already-merged
`lib/knowledge/model.ts` verbatim — no new field or timestamp is added to
`KnowledgeItem`. "Unresolved" deliberately does not attempt a
duration-based staleness check (e.g. "under review for N days") because
`KnowledgeItem` has no field recording when it entered `under_review` — Part
B.3 of the Company Brain spec does not include one, and inventing one here
would be scope creep for this feature. Any item currently `under_review` is
surfaced; a later task (Task 3, freshness sync, or a future refinement) can
add duration-awareness without changing this function's signature.

## 2. The MeetingProposal draft model

New, pure module, `lib/integrations/zoom/proposal.ts`:

```ts
export type MeetingProposalId = string; // "mtgprop_" + lowercase hex

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
```

Functions:

- `draftMeetingProposal(item: KnowledgeItem, reasons: StaleReason[], input: { createdBy: string; now?: string }): MeetingProposal` —
  `topic` = `item.title`; `agendaText` is built from `item.description`
  plus one line per evidence anchor (`"Evidence: <pageSlug>"`, no invented
  detail); `evidence` is copied from `item.evidence` verbatim; everything
  else starts empty/null; `status: "draft"`. Refuses (throws) if `reasons`
  is empty — a proposal must always cite why it was suggested.
- `confirmMeetingProposal(proposal: MeetingProposal, input: { proposedStartAt: string; proposedDurationMinutes?: number; participantEmails: string[]; confirmedBy: string; now?: string }): MeetingProposal` —
  requires `status === "draft"` (throws otherwise); requires
  `proposedStartAt` to parse as a valid date and `confirmedBy` to be
  non-blank (throws otherwise); sets `status: "confirmed"`,
  `proposedDurationMinutes` defaults to `30` if omitted.
- `markMeetingCreated(proposal: MeetingProposal, zoomMeeting: { id: string; joinUrl: string; startUrl: string }, now?: string): MeetingProposal` —
  requires `status === "confirmed"` (throws otherwise); sets
  `status: "created"`.

This module is pure — it never calls Zoom's API itself. It composes with
the client (§3) the same way `lib/knowledge/model.ts` composes with
`lib/review/model.ts` via the review-bridge: the pure model decides what
states are valid, a caller does the actual I/O.

## 3. The Zoom client — the only module that touches the network

New module, `lib/integrations/zoom/client.ts`:

```ts
export type ZoomCredentials = { accountId: string; clientId: string; clientSecret: string };

export function resolveZoomCredentials(env?: Record<string, string | undefined>): ZoomCredentials;
// resolveSecret("env:ZOOM_ACCOUNT_ID", env), same for ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET,
// reusing lib/connectors/shared/config.ts's existing resolveSecret() verbatim.

export type ZoomMeetingResult = { id: string; joinUrl: string; startUrl: string };

export async function createZoomMeeting(
  creds: ZoomCredentials,
  input: { topic: string; agenda: string; startTime: string; durationMinutes: number },
  opts?: { fetchImpl?: typeof fetch },
): Promise<ZoomMeetingResult>;
// 1. POST https://zoom.us/oauth/token?grant_type=account_credentials&account_id=<id>
//    with Basic auth (base64 clientId:clientSecret) -> { access_token }
// 2. POST https://api.zoom.us/v2/users/me/meetings with Bearer token,
//    { topic, agenda, type: 2, start_time: startTime, duration: durationMinutes,
//      settings: { join_before_host: false } }
// 3. Returns { id, joinUrl: join_url, startUrl: start_url } from the real response.
// Throws with the response status + body text on any non-2xx from either call.
```

`opts.fetchImpl` (defaulting to the global `fetch`) exists purely so tests
can inject a fake implementation and assert on the exact request shape
without making a real network call — no test in this feature may call the
real Zoom API. Credentials are never logged, never included in error
messages, and never written to any file this feature creates (matching the
existing `lib/govern/redact.ts`-adjacent posture already in this repo).

**Local-only guarantee note:** this is a deliberate, narrow, human-gated
exception to "nothing leaves this machine," exactly parallel to how the SEO
line's hosted-model exception is a named, scoped, documented exception
rather than a silent one (see memory: `aletheia-seo-hosted-model-exception`).
It is opt-in (the feature does nothing if the three `ZOOM_*` env vars aren't
set — `resolveSecret` throws a clear "environment variable required" error,
surfaced to the operator, not swallowed), and every single outbound call
requires the human confirmation step in §4 — there is no path from
"KnowledgeItem exists" to "Zoom meeting created" that skips a person
reading and confirming the specific details first.

## 4. Persistence

New module, `lib/integrations/zoom/proposal-store.ts`, mirroring
`lib/knowledge/store.ts`'s exact shape (same atomic-write pattern via the
shared `writePrivateFileAtomic()`, same "corrupt file -> empty store, never
silently destroyed on next write" discipline the final review on the prior
plan hardened):

- `DEFAULT_PROPOSAL_STORE_PATH = config/meeting-proposals.json`
- `loadMeetingProposals(path?): MeetingProposal[]`
- `saveMeetingProposals(items, path?): void`
- `upsertMeetingProposal(proposal, path?): MeetingProposal[]` (insert-or-
  replace by `id`, with the same corrupt-file backup-before-overwrite
  guard already built for `lib/knowledge/store.ts`)
- `getMeetingProposal(id, path?): MeetingProposal | undefined`

`config/meeting-proposals.json` (and its `.tmp`/`.corrupt-*.bak` siblings)
must be added to `.gitignore`, matching every other local store in this
repo.

## 5. Server wiring (`scripts/demo.ts`)

**Confirmed testing convention (verified against `tests/tako-ui.test.ts`):**
this repo tests `scripts/demo.ts` by importing its exported business-logic
functions directly (e.g. `activityView`, `readSkillFiles`) and calling them
in-process — it never spins up a real `Bun.serve` server and issues HTTP
requests in tests. This feature follows the same precedent set by
`submitReview()`/`reviewDecide()` (also plain exported functions in
`scripts/demo.ts`, called by the route if-chain, tested directly): the new
route logic is two exported functions, and the HTTP routes are thin
wrappers around them.

```ts
export function proposeZoomMeeting(
  input: { knowledgeItemId: string; createdBy: string },
  opts?: { knowledgeStorePath?: string; proposalStorePath?: string; now?: string },
): MeetingProposal;
// Loads the item via getKnowledgeItem(input.knowledgeItemId, opts?.knowledgeStorePath),
// throws ClientError if not found; recomputes reasons via
// findStaleOrUnresolvedKnowledgeItems([item], now) server-side (never trusts
// a client-supplied reason); throws ClientError if reasons is empty (item
// isn't actually stale/unresolved); calls draftMeetingProposal(); persists
// via upsertMeetingProposal(proposal, opts?.proposalStorePath); returns it.

export async function confirmZoomMeeting(
  input: { proposalId: string; proposedStartAt: string; proposedDurationMinutes?: number; participantEmails: string[]; confirmedBy: string },
  opts?: { proposalStorePath?: string; now?: string; zoomCredentials?: ZoomCredentials; fetchImpl?: typeof fetch },
): Promise<MeetingProposal>;
// Loads the proposal via getMeetingProposal(); throws ClientError if not
// found; calls confirmMeetingProposal() (pure) and persists the "confirmed"
// state immediately; then resolves credentials (opts.zoomCredentials ??
// resolveZoomCredentials()) and calls createZoomMeeting(creds, {...},
// { fetchImpl: opts?.fetchImpl }); on success calls markMeetingCreated(),
// persists "created", and returns the proposal with zoomMeeting populated;
// on failure, re-throws the client's error as-is (proposal stays
// "confirmed" in the store — the caller, i.e. the HTTP route below, is
// responsible for not writing an ActivityEntry on this path).
```

Both functions accept path/credential/fetch overrides specifically so tests
can inject a temp-directory store path and a fake `fetchImpl`, exactly like
`tests/knowledge-store.test.ts` already does for the knowledge store —
no test needs to read or write the real repo's `config/*.json`.

New routes, added to the existing route if-chain (not restructuring
anything around them), each a thin wrapper calling the functions above:

- `GET /api/knowledge/stale` — unauthenticated (matches this repo's
  existing convention that read-only GETs, e.g. `/api/reviews`, don't
  require the admin token — a pre-existing gap this feature doesn't
  introduce or worsen). Loads `config/knowledge-items.json` via
  `loadKnowledgeItems()`, runs `findStaleOrUnresolvedKnowledgeItems()`,
  returns the list.
- `POST /api/automations/zoom-meeting/propose` — **added to
  `ADMIN_ROUTES`**. Body: `{ knowledgeItemId, createdBy }`. Thin wrapper:
  parses the body, calls `proposeZoomMeeting(input)` (§5's exported
  function, which does the load/recompute/draft/persist work), returns its
  result as JSON. `ClientError`s thrown by `proposeZoomMeeting` propagate
  through the existing error-response convention unchanged.
- `POST /api/automations/zoom-meeting/confirm` — **added to
  `ADMIN_ROUTES`**. Body: `{ proposalId, proposedStartAt,
  proposedDurationMinutes, participantEmails, confirmedBy }`. Calls
  `await confirmZoomMeeting(input)`. On success (the returned proposal has
  `status: "created"`), the route itself appends a real `ActivityEntry`
  (`label: "Zoom meeting created: <topic>"`, reusing the existing
  `ActivityEntry` shape at `scripts/demo.ts:861`) — this is the route's own
  responsibility, not `confirmZoomMeeting`'s, so a caller of the function in
  a test never has to also fake an activity-log write to verify success. On
  a thrown error from `confirmZoomMeeting` (Zoom API failure, missing
  credentials, invalid input), the route returns it via the existing
  `ClientError`/error-response convention and writes **no** `ActivityEntry`
  — a failed attempt must never look like a successful one in the activity
  log. The proposal itself was already persisted as `"confirmed"` before
  the Zoom call, so it is not lost or duplicated on retry.
- `GET /api/automations/zoom-meeting/proposals` — unauthenticated, same
  reasoning as `/api/knowledge/stale`. Returns all proposals (for the UI to
  show status/history).

**UI:** a new section on the Automations screen
(`scripts/demo.ts`'s `data-name="automations"` block), placed after the
existing `#automation-builder`/`#automation-success` markup as its own
clearly-delimited block (new ids: `#followup-meetings-section`,
`#followup-meeting-list`, `#followup-meeting-draft-panel`) so it cannot be
mistaken for part of the trigger/action builder or the in-progress canvas
view. It lists stale items (from `/api/knowledge/stale`) each with a
"Propose follow-up meeting" button; clicking opens a small panel showing
the server-computed draft (topic, agenda, evidence citations) with editable
start-time/duration/participant fields and a "Create Zoom Meeting" button
that calls the confirm route and then displays the real join URL (or the
error, retryable, on failure).

**Concurrency note for whoever implements this:** `scripts/demo.ts` has had
multiple other sessions committing to it during the same day this spec was
written (automation-canvas work, connector-credential work). Before editing
its Automations-screen markup or its `ADMIN_ROUTES`/route if-chain, re-read
the current file rather than assuming the line numbers/structure quoted
here still match exactly — insert relative to the named anchors
(`#automation-builder`, `ADMIN_ROUTES`), not fixed line numbers.

## 6. Seed data

New script, `scripts/seed-knowledge-items.ts` (a one-off operator utility,
in the same spirit as this repo's other narrow `scripts/*.ts` tools like
`scripts/eval.ts`) — writes 2-3 realistic, clearly-fictional sample
`KnowledgeItem`s to `config/knowledge-items.json` via
`upsertKnowledgeItem()`: one `approved` item with a past
`nextFreshnessReviewAt` (freshness-due), one `under_review` item
(unresolved), one `draft` item with `ownerId: ""` (ownerless). This exists
purely so the new Automations-page section has something real to show
without waiting on Task 4/6 or a live ingestion pipeline. It is explicitly
labeled as seed/fixture data in its own file header comment — never
confused with real customer data.

## 7. Error handling and security

- Every route already listed in `ADMIN_ROUTES` follows the existing
  `requireAdmin()` gate (`lib/util/http-security.ts`) — no new
  authorization mechanism is introduced.
- Zoom credentials are read once per confirm request via
  `resolveZoomCredentials()`; a missing env var throws immediately with a
  clear message, before any network call is attempted.
- `createZoomMeeting()`'s two HTTP calls (OAuth token, then create meeting)
  each check `res.ok` and throw with the status and response body — no
  swallowed errors, no partial success reported as success.
- No participant email, credential, or Zoom response body is written to
  any log; the `ActivityEntry` created on success records only the topic,
  timestamp, and outcome, matching the shape existing `ActivityEntry`s
  already use.

## 8. Testing

- `lib/knowledge/queries.ts`: pure unit tests — an approved+overdue item
  gets `freshness_due`; an `under_review` item gets `unresolved_review`; an
  ownerless `draft` item gets `ownerless`; a settled (`rejected`) ownerless
  item gets no reasons; an item with multiple reasons gets all of them.
- `lib/integrations/zoom/proposal.ts`: pure unit tests mirroring
  `lib/knowledge/model.ts`'s test style — draft requires non-empty
  `reasons`; confirm requires `status === "draft"` and a valid
  `proposedStartAt`; `markMeetingCreated` requires `status === "confirmed"`.
- `lib/integrations/zoom/client.ts`: tests inject `opts.fetchImpl` with a
  fake `fetch` that asserts the exact request URL/method/headers/body for
  both the OAuth and meeting-creation calls, and returns a canned response;
  a second test asserts a non-2xx response from either call throws with the
  status/body in the message. **No test may reach the real Zoom API.**
- `lib/integrations/zoom/proposal-store.ts`: same test shape as
  `tests/knowledge-store.test.ts` (round-trip, corrupt-file handling,
  upsert-by-id, corrupt-backup-before-overwrite) — the store's own tests
  already proved this pattern once; this task reuses it, not reinvents it.
- `proposeZoomMeeting()`/`confirmZoomMeeting()` (exported from
  `scripts/demo.ts`, per the confirmed convention in §5 of testing that
  file's logic by importing and calling its exported functions directly,
  never via a real HTTP request): tests use temp-directory store paths and
  an injected fake `fetchImpl`, proving (a) proposing a non-stale item
  throws, (b) a successful confirm returns `status: "created"` with the
  fake Zoom response's `id`/`joinUrl`/`startUrl`, (c) a fake `fetchImpl`
  that returns a non-2xx response leaves the persisted proposal
  `"confirmed"` (verified by re-loading the store), and the thrown error is
  the one `confirmZoomMeeting` propagates. The `ActivityEntry`-on-success
  behavior described in §5 lives in the HTTP route wrapper itself, not in
  `confirmZoomMeeting` — if this repo's convention has no precedent for
  testing that thin route-wrapper layer in isolation, note that as a gap in
  the implementation report rather than skip verifying it silently.

## 9. Decision record

- Evidence source is the `KnowledgeItem` store, not the meeting-inbox's
  transcript-derived necessity signal (that feature isn't built yet and
  lives on a separate branch this work must not touch).
- This feature does not extend the trigger/action builder or the
  automation-canvas adapter — it is fully additive, to avoid colliding with
  concurrent work on those.
- "Unresolved" means "currently `under_review`," not a duration-based
  staleness check — `KnowledgeItem` has no field for that today, and adding
  one is out of scope for this feature.
- The Zoom API call happens synchronously inside the confirm request, after
  the pure `confirmMeetingProposal()` transition — there is no
  fire-and-forget queue for the Zoom call itself in this version.

This design is approved for an implementation plan. Implementation still
requires review and approval of that plan before code work begins.
