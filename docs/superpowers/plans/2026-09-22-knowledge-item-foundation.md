# Knowledge Item Foundation (Tasks 1–2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure `KnowledgeItem` data model and its local, owner-only
persistence layer — the foundation the rest of the Company Brain knowledge
layer (review-bridge, freshness sync, query views, meeting adapter, Takeover
Packs) will be built on in later plans.

**Architecture:** Two small, focused modules under `lib/knowledge/`, built
exactly the way `lib/review/model.ts` and `lib/workers/state.ts` already do
it in this codebase: a pure, I/O-free model module (`model.ts`) holding
types and state-transition functions, and a persistence module (`store.ts`)
that reads/writes one owner-only JSON file via the existing
`writePrivateFileAtomic()` helper. Neither module talks to gbrain, the
review queue, or the demo server yet — those integrations are later tasks
in the roadmap this plan implements a slice of.

**Tech Stack:** TypeScript (Bun runtime, `node --experimental-strip-types`
test runner per this repo's existing convention), `node:test` +
`node:assert/strict`, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-22-company-brain-foundation-architecture.md`
(Part B.3 for the `KnowledgeItem` metadata contract, Part F Tasks 1–2 for
scope). This plan implements Tasks 1 and 2 from that spec's roadmap only.

## Global Constraints

- No new npm/bun dependencies. Reuse `lib/util/private-file.ts` for atomic,
  owner-only-permission writes — do not reimplement tmp-write-then-rename.
- Every persisted file must end up mode `0600`, matching the existing
  `writePrivateFileAtomic()` guarantee and the precedent set by
  `lib/sync/state.ts`/`lib/workers/state.ts` (`{ mode: 0o600 }` on write).
- `lib/knowledge/model.ts` must be pure — no filesystem or network I/O,
  matching `lib/review/model.ts`'s explicit "Pure — no I/O" header comment.
- A `KnowledgeItem` can only reach `status: "approved"` through
  `recordReviewerDecision()` with verdict `"approved"`, and only when
  `canApproveKnowledgeItem()` says it may — never by direct field
  assignment. This is the spec's central evidence-before-approval rule
  (Part B.4.1).
- `reviewHistory` is append-only: a re-decision adds a new entry, it never
  overwrites or removes a prior one, mirroring `lib/review/model.ts:43-46`'s
  `decisions[]` design intent exactly.
- Resolved naming decision (the spec's Part B.2/Part E used two slightly
  different phrasings for meeting-derived items — "decision_rationale" /
  "meeting_derived_action" — without locking an exact enum). This plan fixes
  the `KnowledgeType` enum as 8 closed string values, with meeting-derived
  candidate **decisions** reusing the general `"decision"` type (origin
  `"model-suggested"` distinguishes them from human-authored decisions) and
  meeting-derived candidate **open actions** getting their own `"open_action"`
  type. This is the one new type not explicitly named in spec Part B.2's
  list of 8 category labels; it is what B.2 item 8 ("meeting-derived
  candidate decision **and open action**") actually requires once decisions
  are folded into the existing `"decision"` type.

---

### Task 1: `KnowledgeItem` pure model module

**Files:**
- Create: `lib/knowledge/model.ts`
- Test: `tests/knowledge-model.test.ts`

**Interfaces:**
- Consumes: nothing (pure, first module in the layer).
- Produces (for later tasks — Task 2 and beyond consume these exact names):
  - `type KnowledgeItemId = string`
  - `type KnowledgeType = "policy" | "procedure" | "decision" | "project" | "customer_product" | "team_role" | "onboarding" | "open_action"`
  - `const KNOWLEDGE_TYPES: KnowledgeType[]`
  - `type KnowledgeStatus = "draft" | "under_review" | "approved" | "superseded" | "rejected" | "archived"`
  - `const KNOWLEDGE_STATUSES: KnowledgeStatus[]`
  - `type KnowledgeOrigin = "source-authored" | "human-authored" | "model-suggested"`
  - `type KnowledgeClassification = "internal" | "confidential" | "restricted" | "public" | "export-controlled"`
  - `type EvidenceAnchor = { pageSlug: string; chunkIndex?: number; excerpt?: string }`
  - `type RelationType = "relates_to" | "supersedes" | "superseded_by" | "derived_from" | "blocks" | "blocked_by" | "part_of"`
  - `type KnowledgeRelation = { type: RelationType; targetId: KnowledgeItemId }`
  - `type ReviewVerdict = "approved" | "revise" | "rejected" | "escalated"`
  - `type ReviewerDecisionRecord = { verdict: ReviewVerdict; by: string; at: string; note: string }`
  - `type KnowledgeItem = { id, type, title, description, evidence, sourceWorkspace, sourceConnector, classification, origin, status, ownerId, createdAt, sourceUpdatedAt, lastReviewedAt, nextFreshnessReviewAt, relations, reviewHistory, retention: { policyRef, deletionImplication }, reviewItemId? }`
  - `function newKnowledgeItem(input): KnowledgeItem`
  - `function canApproveKnowledgeItem(item: KnowledgeItem): { ok: boolean; reasons: string[] }`
  - `function markUnderReview(item: KnowledgeItem, reviewItemId: string, now?: string): KnowledgeItem`
  - `function recordReviewerDecision(item: KnowledgeItem, verdict: ReviewVerdict, by: string, note?: string, now?: string): KnowledgeItem`
  - `function recordFreshnessCheck(item: KnowledgeItem, nextFreshnessReviewAt: string, now?: string): KnowledgeItem`
  - `function isDueForFreshnessReview(item: KnowledgeItem, now?: string): boolean`
  - `function supersede(item: KnowledgeItem, supersededById: KnowledgeItemId, now?: string): KnowledgeItem`
  - `function latestReviewerDecision(item: KnowledgeItem): ReviewerDecisionRecord | null`
  - `function receiptLine(item: KnowledgeItem): string`

- [ ] **Step 1: Write failing tests for types, `newKnowledgeItem`, and `canApproveKnowledgeItem`**

Create `tests/knowledge-model.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import {
  canApproveKnowledgeItem, KNOWLEDGE_STATUSES, KNOWLEDGE_TYPES, latestReviewerDecision,
  newKnowledgeItem, type KnowledgeItem,
} from "../lib/knowledge/model.ts";

const NOW = "2026-09-22T00:00:00.000Z";

function base(over: Partial<Parameters<typeof newKnowledgeItem>[0]> = {}): KnowledgeItem {
  return newKnowledgeItem({
    type: "procedure",
    title: "How to request a new connector",
    description: "Steps to get a new data source onboarded and approved.",
    evidence: [{ pageSlug: "notion/onboarding/connector-request", excerpt: "File a request via..." }],
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

test("newKnowledgeItem starts in draft with no review history and a stable id prefix", () => {
  const item = base();
  assert.equal(item.status, "draft");
  assert.deepEqual(item.reviewHistory, []);
  assert.deepEqual(item.relations, []);
  assert.equal(latestReviewerDecision(item), null);
  assert.ok(item.id.startsWith("ki_"));
  assert.equal(item.createdAt, NOW);
  assert.equal(item.sourceUpdatedAt, null);
  assert.equal(item.lastReviewedAt, null);
  assert.equal(item.nextFreshnessReviewAt, null);
});

test("KNOWLEDGE_TYPES and KNOWLEDGE_STATUSES list the 8 types and 6 statuses the spec defines", () => {
  assert.deepEqual(KNOWLEDGE_TYPES, [
    "policy", "procedure", "decision", "project",
    "customer_product", "team_role", "onboarding", "open_action",
  ]);
  assert.deepEqual(KNOWLEDGE_STATUSES, [
    "draft", "under_review", "approved", "superseded", "rejected", "archived",
  ]);
});

test("canApproveKnowledgeItem requires at least one evidence anchor", () => {
  const withEvidence = base();
  assert.equal(canApproveKnowledgeItem(withEvidence).ok, true);

  const noEvidence = base({ evidence: [] });
  const result = canApproveKnowledgeItem(noEvidence);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => /evidence/i.test(r)));
});

test("canApproveKnowledgeItem requires a non-blank ownerId", () => {
  const result = canApproveKnowledgeItem(base({ ownerId: "" }));
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => /owner/i.test(r)));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test tests/knowledge-model.test.ts`
Expected: FAIL — `lib/knowledge/model.ts` does not exist yet (module not found).

- [ ] **Step 3: Implement types, `newKnowledgeItem`, and `canApproveKnowledgeItem`**

Create `lib/knowledge/model.ts`:

```typescript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/knowledge-model.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge/model.ts tests/knowledge-model.test.ts
git commit -m "feat: add KnowledgeItem types, newKnowledgeItem, canApproveKnowledgeItem"
```

- [ ] **Step 6: Write failing tests for `markUnderReview` and `recordReviewerDecision`**

Append to `tests/knowledge-model.test.ts`:

```typescript
import {
  markUnderReview, recordReviewerDecision,
} from "../lib/knowledge/model.ts";

test("markUnderReview moves draft -> under_review and records the linked ReviewItem id", () => {
  const item = base();
  const underReview = markUnderReview(item, "rev_abc123", NOW);
  assert.equal(item.status, "draft"); // original untouched
  assert.equal(underReview.status, "under_review");
  assert.equal(underReview.reviewItemId, "rev_abc123");
});

test("recordReviewerDecision approves only when canApproveKnowledgeItem is ok, and is append-only", () => {
  const reviewed = markUnderReview(base(), "rev_1", NOW);
  const approved = recordReviewerDecision(reviewed, "approved", "Taro", "looks correct", "2026-09-23T00:00:00.000Z");
  assert.equal(approved.status, "approved");
  assert.equal(approved.lastReviewedAt, "2026-09-23T00:00:00.000Z");
  assert.equal(approved.reviewHistory.length, 1);
  assert.deepEqual(approved.reviewHistory[0], {
    verdict: "approved", by: "Taro", at: "2026-09-23T00:00:00.000Z", note: "looks correct",
  });

  // A second decision appends, never overwrites.
  const reApproved = recordReviewerDecision(approved, "approved", "Grace", "confirmed again", "2026-09-24T00:00:00.000Z");
  assert.equal(reApproved.reviewHistory.length, 2);
  assert.equal(reApproved.reviewHistory[0].by, "Taro"); // first entry untouched
});

test("recordReviewerDecision refuses to approve a knowledge item with no evidence or owner", () => {
  const reviewed = markUnderReview(base({ evidence: [], ownerId: "" }), "rev_2", NOW);
  assert.throws(
    () => recordReviewerDecision(reviewed, "approved", "Taro", "", NOW),
    /no evidence anchor attached.*no owner assigned|no owner assigned.*no evidence anchor attached/,
  );
});

test("recordReviewerDecision: revise sends the item back to draft; rejected is terminal but retains history", () => {
  const reviewed = markUnderReview(base(), "rev_3", NOW);
  const revised = recordReviewerDecision(reviewed, "revise", "Taro", "needs a real owner", NOW);
  assert.equal(revised.status, "draft");
  assert.equal(revised.reviewHistory.length, 1);

  const rejected = recordReviewerDecision(markUnderReview(base(), "rev_4", NOW), "rejected", "Taro", "out of date", NOW);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.reviewHistory.length, 1);
  assert.equal(rejected.reviewHistory[0].verdict, "rejected");
});

test("recordReviewerDecision: escalated keeps the item under_review, just logs the escalation", () => {
  const reviewed = markUnderReview(base(), "rev_5", NOW);
  const escalated = recordReviewerDecision(reviewed, "escalated", "Taro", "needs legal review", NOW);
  assert.equal(escalated.status, "under_review");
  assert.equal(escalated.reviewHistory[0].verdict, "escalated");
});

test("recordReviewerDecision refuses any verdict once an item is approved or rejected (terminal)", () => {
  const approved = recordReviewerDecision(markUnderReview(base(), "rev_6", NOW), "approved", "Taro", "", NOW);
  assert.throws(() => recordReviewerDecision(approved, "revise", "Grace", "", NOW), /terminal/);

  const rejected = recordReviewerDecision(markUnderReview(base(), "rev_7", NOW), "rejected", "Taro", "", NOW);
  assert.throws(() => recordReviewerDecision(rejected, "approved", "Grace", "", NOW), /terminal/);
});
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test tests/knowledge-model.test.ts`
Expected: FAIL — `markUnderReview`/`recordReviewerDecision` not exported.

- [ ] **Step 8: Implement `markUnderReview` and `recordReviewerDecision`**

Append to `lib/knowledge/model.ts`:

```typescript
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
  if (item.status === "approved" || item.status === "rejected") {
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
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/knowledge-model.test.ts`
Expected: PASS (10 tests total).

- [ ] **Step 10: Commit**

```bash
git add lib/knowledge/model.ts tests/knowledge-model.test.ts
git commit -m "feat: add markUnderReview and recordReviewerDecision to KnowledgeItem model"
```

- [ ] **Step 11: Write failing tests for freshness and `supersede`**

Append to `tests/knowledge-model.test.ts`:

```typescript
import { isDueForFreshnessReview, recordFreshnessCheck, supersede } from "../lib/knowledge/model.ts";

test("recordFreshnessCheck sets lastReviewedAt and nextFreshnessReviewAt without touching status or history", () => {
  const approved = recordReviewerDecision(markUnderReview(base(), "rev_8", NOW), "approved", "Taro", "", NOW);
  const rechecked = recordFreshnessCheck(approved, "2026-12-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z");
  assert.equal(rechecked.status, "approved");
  assert.equal(rechecked.reviewHistory.length, 1); // unchanged
  assert.equal(rechecked.lastReviewedAt, "2026-11-01T00:00:00.000Z");
  assert.equal(rechecked.nextFreshnessReviewAt, "2026-12-01T00:00:00.000Z");
});

test("isDueForFreshnessReview is true only for an approved item past its review date", () => {
  const approved = recordFreshnessCheck(
    recordReviewerDecision(markUnderReview(base(), "rev_9", NOW), "approved", "Taro", "", NOW),
    "2026-10-01T00:00:00.000Z",
    NOW,
  );
  assert.equal(isDueForFreshnessReview(approved, "2026-09-30T00:00:00.000Z"), false);
  assert.equal(isDueForFreshnessReview(approved, "2026-10-02T00:00:00.000Z"), true);
  assert.equal(isDueForFreshnessReview(base(), "2099-01-01T00:00:00.000Z"), false, "a draft item is never 'due' for freshness review");
});

test("supersede marks the old item superseded and links to its replacement", () => {
  const approved = recordReviewerDecision(markUnderReview(base(), "rev_10", NOW), "approved", "Taro", "", NOW);
  const superseded = supersede(approved, "ki_new_replacement", "2026-11-01T00:00:00.000Z");
  assert.equal(superseded.status, "superseded");
  assert.deepEqual(superseded.relations, [{ type: "superseded_by", targetId: "ki_new_replacement" }]);
});
```

- [ ] **Step 12: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test tests/knowledge-model.test.ts`
Expected: FAIL — `recordFreshnessCheck`/`isDueForFreshnessReview`/`supersede` not exported.

- [ ] **Step 13: Implement `recordFreshnessCheck`, `isDueForFreshnessReview`, and `supersede`**

Append to `lib/knowledge/model.ts`:

```typescript
/** A human re-confirms an approved item is still current, or updates when it
 *  should next be checked, without that being a new formal review decision
 *  (no reviewHistory entry — see spec Part B.4.4: freshness is cleared by a
 *  human, but it is not itself a Verdict). */
export function recordFreshnessCheck(item: KnowledgeItem, nextFreshnessReviewAt: string, now = new Date().toISOString()): KnowledgeItem {
  const next = clone(item);
  next.lastReviewedAt = now;
  next.nextFreshnessReviewAt = nextFreshnessReviewAt;
  return next;
}

/** True only for an approved item whose freshness-review date has passed —
 *  a draft/rejected/superseded item is never "due," it is simply not
 *  current trusted knowledge yet (or any more). */
export function isDueForFreshnessReview(item: KnowledgeItem, now = new Date().toISOString()): boolean {
  return item.status === "approved" && item.nextFreshnessReviewAt !== null && item.nextFreshnessReviewAt <= now;
}

/** An approved item is replaced by a newer one. The old item is retained
 *  (never deleted) with status `superseded` and a relation pointing at its
 *  replacement, so retrieval and citation history can still resolve it. */
export function supersede(item: KnowledgeItem, supersededById: KnowledgeItemId, now = new Date().toISOString()): KnowledgeItem {
  const next = clone(item);
  next.status = "superseded";
  next.relations = [...next.relations, { type: "superseded_by", targetId: supersededById }];
  next.lastReviewedAt = now;
  return next;
}
```

- [ ] **Step 14: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/knowledge-model.test.ts`
Expected: PASS (13 tests total).

- [ ] **Step 15: Write a failing test for `receiptLine`, implement it, verify, commit**

Append to `tests/knowledge-model.test.ts`:

```typescript
import { receiptLine } from "../lib/knowledge/model.ts";

test("receiptLine renders a one-line audit summary matching lib/review/model.ts's style", () => {
  const draft = base();
  assert.match(receiptLine(draft), /^pending \(draft\) — type:procedure — owner:grace@example\.com — evidence:1$/);

  const approved = recordReviewerDecision(markUnderReview(base(), "rev_11", NOW), "approved", "Taro", "confirmed", "2026-09-23T00:00:00.000Z");
  assert.match(receiptLine(approved), /^approved by Taro on 2026-09-23 — type:procedure — owner:grace@example\.com — evidence:1 — confirmed$/);
});
```

Run: `node --experimental-strip-types --test tests/knowledge-model.test.ts`
Expected: FAIL — `receiptLine` not exported.

Append to `lib/knowledge/model.ts`:

```typescript
/** One-line audit entry, mirroring lib/review/model.ts's receiptLine() —
 *  what a reviewer or steward would paste into an audit note. */
export function receiptLine(item: KnowledgeItem): string {
  const d = latestReviewerDecision(item);
  const head = d ? `${d.verdict} by ${d.by} on ${d.at.slice(0, 10)}` : `pending (${item.status})`;
  const tail = d?.note ? ` — ${d.note}` : "";
  return `${head} — type:${item.type} — owner:${item.ownerId || "(none)"} — evidence:${item.evidence.length}${tail}`;
}
```

Run: `node --experimental-strip-types --test tests/knowledge-model.test.ts`
Expected: PASS (14 tests total).

```bash
git add lib/knowledge/model.ts tests/knowledge-model.test.ts
git commit -m "feat: add freshness tracking, supersede, and receiptLine to KnowledgeItem model"
```

---

### Task 2: Local, owner-only persistence layer

**Files:**
- Create: `lib/knowledge/store.ts`
- Test: `tests/knowledge-store.test.ts`

**Interfaces:**
- Consumes: `KnowledgeItem` type from `lib/knowledge/model.ts` (Task 1);
  `writePrivateFileAtomic()` from `lib/util/private-file.ts` (existing).
- Produces (for later tasks — the review-bridge, freshness sync, and query
  views tasks in the roadmap consume these exact names):
  - `const DEFAULT_KNOWLEDGE_STORE_PATH: string`
  - `function loadKnowledgeItems(path?: string): KnowledgeItem[]`
  - `function saveKnowledgeItems(items: readonly KnowledgeItem[], path?: string): void`
  - `function upsertKnowledgeItem(item: KnowledgeItem, path?: string): KnowledgeItem[]`
  - `function getKnowledgeItem(id: string, path?: string): KnowledgeItem | undefined`

- [ ] **Step 1: Write failing tests for load/save round-trip and corrupt-file handling**

Create `tests/knowledge-store.test.ts`:

```typescript
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { newKnowledgeItem } from "../lib/knowledge/model.ts";
import { loadKnowledgeItems, saveKnowledgeItems } from "../lib/knowledge/store.ts";

const NOW = "2026-09-22T00:00:00.000Z";

function sampleItem() {
  return newKnowledgeItem({
    type: "policy",
    title: "Remote work expense policy",
    description: "What counts as a reimbursable remote-work expense.",
    evidence: [{ pageSlug: "notion/hr/remote-expense-policy" }],
    sourceWorkspace: "hr",
    sourceConnector: "notion",
    classification: "internal",
    origin: "source-authored",
    ownerId: "hr-team@example.com",
    retention: { policyRef: "workspace-default-90d", deletionImplication: "removed if the HR page is deleted" },
    now: NOW,
  });
}

test("missing and corrupt store files are treated as empty, not an error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tako-knowledge-store-"));
  const path = join(dir, "knowledge-items.json");
  try {
    assert.deepEqual(loadKnowledgeItems(path), []);
    await writeFile(path, "not json\n");
    assert.deepEqual(loadKnowledgeItems(path), []);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("saveKnowledgeItems writes atomically, owner-only, and round-trips", { skip: process.platform === "win32" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "tako-knowledge-store-"));
  const path = join(dir, "knowledge-items.json");
  const items = [sampleItem()];
  try {
    saveKnowledgeItems(items, path);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await readFile(path, "utf8")).endsWith("\n"), true);
    assert.deepEqual(loadKnowledgeItems(path), items);
  } finally {
    await rm(dir, { recursive: true });
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test tests/knowledge-store.test.ts`
Expected: FAIL — `lib/knowledge/store.ts` does not exist yet.

- [ ] **Step 3: Implement `loadKnowledgeItems` and `saveKnowledgeItems`**

Create `lib/knowledge/store.ts`:

```typescript
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writePrivateFileAtomic } from "../util/private-file.ts";
import { KNOWLEDGE_STATUSES, KNOWLEDGE_TYPES, type KnowledgeItem } from "./model.ts";

/** Local, owner-only-permission JSON store for KnowledgeItems — mirrors the
 *  existing config/reviews.json and config/workers-state.json pattern in
 *  this repo (one JSON file, atomic tmp-write-then-rename), but enforces
 *  0600 via the shared writePrivateFileAtomic() helper since knowledge
 *  items, like the review items they route through, are sensitive
 *  operational data, not public content. See spec Part B.5 for why this is
 *  a thin layer beside gbrain rather than a schema change to it. */
export const DEFAULT_KNOWLEDGE_STORE_PATH = join(process.cwd(), "config/knowledge-items.json");

type KnowledgeStoreFile = { items: KnowledgeItem[] };

function isEvidenceAnchor(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.pageSlug === "string"
    && (v.chunkIndex === undefined || typeof v.chunkIndex === "number")
    && (v.excerpt === undefined || typeof v.excerpt === "string");
}

function isKnowledgeItem(value: unknown): value is KnowledgeItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string"
    && KNOWLEDGE_TYPES.includes(v.type as never)
    && typeof v.title === "string"
    && typeof v.description === "string"
    && Array.isArray(v.evidence) && v.evidence.every(isEvidenceAnchor)
    && typeof v.sourceWorkspace === "string"
    && typeof v.sourceConnector === "string"
    && typeof v.classification === "string"
    && typeof v.origin === "string"
    && KNOWLEDGE_STATUSES.includes(v.status as never)
    && typeof v.ownerId === "string"
    && typeof v.createdAt === "string"
    && (v.sourceUpdatedAt === null || typeof v.sourceUpdatedAt === "string")
    && (v.lastReviewedAt === null || typeof v.lastReviewedAt === "string")
    && (v.nextFreshnessReviewAt === null || typeof v.nextFreshnessReviewAt === "string")
    && Array.isArray(v.relations)
    && Array.isArray(v.reviewHistory)
    && !!v.retention && typeof v.retention === "object";
}

/** Missing or corrupt store files are treated as an empty store, not an
 *  error — the store has no rows before the first item is ever saved. */
export function loadKnowledgeItems(path: string = DEFAULT_KNOWLEDGE_STORE_PATH): KnowledgeItem[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<KnowledgeStoreFile>;
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    return items.filter(isKnowledgeItem);
  } catch {
    return [];
  }
}

export function saveKnowledgeItems(items: readonly KnowledgeItem[], path: string = DEFAULT_KNOWLEDGE_STORE_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  const file: KnowledgeStoreFile = { items: [...items] };
  writePrivateFileAtomic(path, `${JSON.stringify(file, null, 2)}\n`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/knowledge-store.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge/store.ts tests/knowledge-store.test.ts
git commit -m "feat: add owner-only JSON persistence for KnowledgeItems"
```

- [ ] **Step 6: Write failing tests for `upsertKnowledgeItem` and `getKnowledgeItem`**

Append to `tests/knowledge-store.test.ts`:

```typescript
import { getKnowledgeItem, upsertKnowledgeItem } from "../lib/knowledge/store.ts";
import { recordReviewerDecision, markUnderReview } from "../lib/knowledge/model.ts";

test("upsertKnowledgeItem inserts a new item and updates an existing one by id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tako-knowledge-store-"));
  const path = join(dir, "knowledge-items.json");
  try {
    const item = sampleItem();
    upsertKnowledgeItem(item, path);
    assert.deepEqual(loadKnowledgeItems(path), [item]);

    const approved = recordReviewerDecision(markUnderReview(item, "rev_1", NOW), "approved", "Taro", "", NOW);
    upsertKnowledgeItem(approved, path);
    const stored = loadKnowledgeItems(path);
    assert.equal(stored.length, 1, "same id must update in place, not append a duplicate row");
    assert.equal(stored[0].status, "approved");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("getKnowledgeItem finds an item by id or returns undefined", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tako-knowledge-store-"));
  const path = join(dir, "knowledge-items.json");
  try {
    const item = sampleItem();
    upsertKnowledgeItem(item, path);
    assert.deepEqual(getKnowledgeItem(item.id, path), item);
    assert.equal(getKnowledgeItem("ki_does_not_exist", path), undefined);
  } finally {
    await rm(dir, { recursive: true });
  }
});
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test tests/knowledge-store.test.ts`
Expected: FAIL — `upsertKnowledgeItem`/`getKnowledgeItem` not exported.

- [ ] **Step 8: Implement `upsertKnowledgeItem` and `getKnowledgeItem`**

Append to `lib/knowledge/store.ts`:

```typescript
/** Insert-or-replace by id, then persist the whole store atomically.
 *  Returns the resulting full list, matching lib/review/model.ts-adjacent
 *  callers' habit of reading back the post-write state without a second
 *  disk read. */
export function upsertKnowledgeItem(item: KnowledgeItem, path: string = DEFAULT_KNOWLEDGE_STORE_PATH): KnowledgeItem[] {
  const items = loadKnowledgeItems(path);
  const idx = items.findIndex((i) => i.id === item.id);
  const next = idx >= 0 ? [...items.slice(0, idx), item, ...items.slice(idx + 1)] : [...items, item];
  saveKnowledgeItems(next, path);
  return next;
}

export function getKnowledgeItem(id: string, path: string = DEFAULT_KNOWLEDGE_STORE_PATH): KnowledgeItem | undefined {
  return loadKnowledgeItems(path).find((i) => i.id === id);
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/knowledge-store.test.ts`
Expected: PASS (4 tests total).

- [ ] **Step 10: Register both new test files in the repo's test script**

**Files:**
- Modify: `package.json:2` (the `"test"` script)

In the `"test"` script's `node --experimental-strip-types --test ...` file
list, insert `tests/knowledge-model.test.ts tests/knowledge-store.test.ts`
immediately after `tests/review-model.test.ts` (these are the same kind of
pure-model unit tests, no `bun test`-only fixtures needed). Change:

```
...tests/workers-model.test.ts tests/workers-run.test.ts tests/review-model.test.ts tests/govern-redact.test.ts...
```

to:

```
...tests/workers-model.test.ts tests/workers-run.test.ts tests/review-model.test.ts tests/knowledge-model.test.ts tests/knowledge-store.test.ts tests/govern-redact.test.ts...
```

(the rest of the script line, before and after this segment, is unchanged).

- [ ] **Step 11: Run the full existing test suite to confirm nothing else broke**

Run: `bun run test`
Expected: PASS — all existing tests plus the 18 new tests
(`knowledge-model.test.ts`: 14, `knowledge-store.test.ts`: 4) pass.

- [ ] **Step 12: Commit**

```bash
git add lib/knowledge/store.ts tests/knowledge-store.test.ts package.json
git commit -m "feat: add upsertKnowledgeItem/getKnowledgeItem and wire tests into the test script"
```

---

## Self-Review Notes (for whoever executes this plan)

- **Spec coverage:** This plan implements exactly spec Part F Tasks 1–2 —
  the pure model and its persistence. It deliberately does **not** implement
  the review-bridge (Task 4), freshness sync job (Task 3), query views
  (Task 6), meeting adapter (Task 5), or Takeover Packs (Task 7) — those are
  separate plans, each depending on this one, per the spec's recommended
  task order (Task 1 → 2 → 4 → 3 → 6 → 5 → 7).
- **No gbrain, review queue, or demo server wiring in this plan.** Nothing
  here reads or writes `packages/brain/`, `lib/review/model.ts`'s store
  (`config/reviews.json`), or `scripts/demo.ts`. That integration is Task 4's
  job, next.
- **Local Meeting Transcriber:** not touched by either task.
- **Graflow / meeting-publish-inbox branches:** not touched — this plan only
  creates new files under `lib/knowledge/` and `tests/`, plus one line added
  to `package.json`'s existing test script.
