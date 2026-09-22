# Knowledge Review Bridge (Task 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `KnowledgeItem` drafts (from `lib/knowledge/model.ts`, merged
in the prior plan) into the existing `lib/review/model.ts` review state
machine, so a `KnowledgeItem` can only ever reach `approved` by going
through a real, recorded `ReviewItem` decision — never by direct field
assignment and never by a second, competing approval path.

**Architecture:** One small, pure module, `lib/knowledge/review-bridge.ts`,
with exactly two functions: one that opens a `ReviewItem` for a draft
`KnowledgeItem` and links them, and one that applies a decided `ReviewItem`'s
verdict back onto its linked `KnowledgeItem`. Both functions are pure
(no I/O) and compose the two existing pure model modules
(`lib/review/model.ts` and `lib/knowledge/model.ts`) without modifying
either — this task only adds the bridge between them. No HTTP route wiring
(`scripts/demo.ts`) is in scope for this task; that is separate follow-up
work once this bridge exists and is reviewed.

**Tech Stack:** TypeScript (Bun runtime, `node --experimental-strip-types`
test runner per this repo's existing convention), `node:test` +
`node:assert/strict`, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-22-company-brain-foundation-architecture.md`
(Part F, Task 4). This plan implements Task 4 from that spec's roadmap only.
It builds on Tasks 1–2, already merged to
`feature/connector-credentials-and-categorization`
(`lib/knowledge/model.ts`, `lib/knowledge/store.ts`).

## Global Constraints

- No new npm/bun dependencies.
- `lib/knowledge/review-bridge.ts` must be pure — no filesystem or network
  I/O, matching `lib/review/model.ts` and `lib/knowledge/model.ts`'s own
  "Pure — no I/O" convention. It must not read or write
  `config/reviews.json` or `config/knowledge-items.json` directly — that
  persistence wiring is a separate, later task.
- A `KnowledgeItem` may only reach `status: "approved"` by way of
  `applyReviewDecisionToKnowledgeItem()` relaying a real `ReviewItem`
  decision through `lib/knowledge/model.ts`'s existing
  `recordReviewerDecision()` — this task must not add any other write path
  to `KnowledgeItem.status`.
- A knowledge item may only be submitted for review from `status: "draft"`
  — submitting an item that is already `under_review`, `approved`,
  `rejected`, `superseded`, or `archived` is refused with a thrown error,
  not silently accepted.
- `applyReviewDecisionToKnowledgeItem()` must refuse to apply a decision
  from a `ReviewItem` the `KnowledgeItem` isn't actually linked to (i.e.
  `knowledgeItem.reviewItemId !== reviewItem.id`) — this prevents one
  knowledge item's approval being triggered by an unrelated review.
- `applyReviewDecisionToKnowledgeItem()` must refuse to apply a decision
  from a `ReviewItem` that has no decision yet (`latestDecision(reviewItem)`
  is `null`).
- Every existing test in `tests/knowledge-model.test.ts`,
  `tests/knowledge-store.test.ts`, and `tests/review-model.test.ts` must
  continue to pass unchanged — this task does not modify
  `lib/knowledge/model.ts`, `lib/knowledge/store.ts`, or
  `lib/review/model.ts`.

---

### Task 4: `lib/knowledge/review-bridge.ts` — link ReviewItem decisions to KnowledgeItem status

**Files:**
- Create: `lib/knowledge/review-bridge.ts`
- Test: `tests/knowledge-review-bridge.test.ts`
- Modify: `package.json:2` (register the new test file in the `"test"` script)

**Interfaces:**
- Consumes:
  - From `lib/review/model.ts` (existing, unmodified):
    `newReview(input: Pick<ReviewItem, "title"|"intent"|"audience"|"body"|"submittedBy"> & { sources?: string[]; id?: string; now?: string }): ReviewItem`,
    `latestDecision(item: ReviewItem): Decision | null`,
    `type ReviewItem`, `type Decision = { verdict: Verdict; by: string; at: string; note: string }`.
  - From `lib/knowledge/model.ts` (existing, unmodified):
    `markUnderReview(item: KnowledgeItem, reviewItemId: string, now?: string): KnowledgeItem`,
    `recordReviewerDecision(item: KnowledgeItem, verdict: ReviewVerdict, by: string, note?: string, now?: string): KnowledgeItem`,
    `type KnowledgeItem`.
- Produces (for later tasks — the eventual `scripts/demo.ts` route wiring
  and the freshness-sync task consume these exact names):
  - `function submitKnowledgeItemForReview(item: KnowledgeItem, input: { intent: string; audience: string; submittedBy: string; now?: string }): { reviewItem: ReviewItem; knowledgeItem: KnowledgeItem }`
  - `function applyReviewDecisionToKnowledgeItem(knowledgeItem: KnowledgeItem, reviewItem: ReviewItem): KnowledgeItem`

- [ ] **Step 1: Write failing tests for `submitKnowledgeItemForReview`**

Create `tests/knowledge-review-bridge.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { newKnowledgeItem, type KnowledgeItem } from "../lib/knowledge/model.ts";
import { submitKnowledgeItemForReview } from "../lib/knowledge/review-bridge.ts";

const NOW = "2026-09-23T00:00:00.000Z";

function draftItem(over: Partial<Parameters<typeof newKnowledgeItem>[0]> = {}): KnowledgeItem {
  return newKnowledgeItem({
    type: "procedure",
    title: "How to request a new connector",
    description: "Steps to get a new data source onboarded and approved.",
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

test("submitKnowledgeItemForReview opens a linked ReviewItem and moves the knowledge item to under_review", () => {
  const item = draftItem();
  const { reviewItem, knowledgeItem } = submitKnowledgeItemForReview(item, {
    intent: "Confirm this procedure is accurate and safe to publish",
    audience: "Engineering team knowledge base",
    submittedBy: "Taro",
    now: NOW,
  });

  assert.equal(knowledgeItem.status, "under_review");
  assert.equal(knowledgeItem.reviewItemId, reviewItem.id);
  assert.equal(reviewItem.title, "Knowledge review — How to request a new connector");
  assert.equal(reviewItem.intent, "Confirm this procedure is accurate and safe to publish");
  assert.equal(reviewItem.audience, "Engineering team knowledge base");
  assert.equal(reviewItem.submittedBy, "Taro");
  assert.deepEqual(reviewItem.sources, ["notion/onboarding/connector-request"]);
  assert.equal(reviewItem.state, "submitted");
  assert.equal(item.status, "draft"); // original untouched
});

test("submitKnowledgeItemForReview refuses an item that is not in draft status", () => {
  const item = draftItem();
  const { knowledgeItem: underReview } = submitKnowledgeItemForReview(item, {
    intent: "x", audience: "y", submittedBy: "Taro", now: NOW,
  });
  assert.throws(
    () => submitKnowledgeItemForReview(underReview, { intent: "x", audience: "y", submittedBy: "Taro", now: NOW }),
    /must be "draft"/,
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test tests/knowledge-review-bridge.test.ts`
Expected: FAIL — `lib/knowledge/review-bridge.ts` does not exist yet.

- [ ] **Step 3: Implement `submitKnowledgeItemForReview`**

Create `lib/knowledge/review-bridge.ts`:

```typescript
/**
 * Bridges KnowledgeItem drafts (lib/knowledge/model.ts) into the existing
 * Intent-Merit Review queue (lib/review/model.ts) so a KnowledgeItem can
 * only ever become `approved` through a real, recorded reviewer decision —
 * never by direct field assignment, and never through a second competing
 * approval path. Pure — no I/O; this module does not read or write
 * config/reviews.json or config/knowledge-items.json. See
 * docs/superpowers/specs/2026-09-22-company-brain-foundation-architecture.md
 * Part F, Task 4.
 */

import { latestDecision, newReview, type ReviewItem } from "../review/model.ts";
import { markUnderReview, recordReviewerDecision, type KnowledgeItem } from "./model.ts";

/** Opens a ReviewItem for a draft KnowledgeItem and links the two records
 *  (knowledgeItem.reviewItemId -> reviewItem.id). Only a `draft` item may be
 *  submitted — an item already under review, approved, rejected,
 *  superseded, or archived would otherwise get a second, orphaned
 *  ReviewItem pointed at it. */
export function submitKnowledgeItemForReview(
  item: KnowledgeItem,
  input: { intent: string; audience: string; submittedBy: string; now?: string },
): { reviewItem: ReviewItem; knowledgeItem: KnowledgeItem } {
  if (item.status !== "draft") {
    throw new Error(`knowledge item "${item.id}" must be "draft" to submit for review (current status: "${item.status}")`);
  }
  const reviewItem = newReview({
    title: `Knowledge review — ${item.title}`,
    intent: input.intent,
    audience: input.audience,
    body: `${item.title}\n\n${item.description}`,
    sources: item.evidence.map((e) => e.pageSlug),
    submittedBy: input.submittedBy,
    now: input.now,
  });
  const knowledgeItem = markUnderReview(item, reviewItem.id, input.now);
  return { reviewItem, knowledgeItem };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/knowledge-review-bridge.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge/review-bridge.ts tests/knowledge-review-bridge.test.ts
git commit -m "feat: add submitKnowledgeItemForReview bridge to the review queue"
```

- [ ] **Step 6: Write failing tests for `applyReviewDecisionToKnowledgeItem`**

Append to `tests/knowledge-review-bridge.test.ts`:

```typescript
import {
  CHECK_KEYS, recordDecision, setCheck, type CheckKey, type ReviewItem as ReviewItemType,
} from "../lib/review/model.ts";
import { applyReviewDecisionToKnowledgeItem } from "../lib/knowledge/review-bridge.ts";

function allChecksOk(item: ReviewItemType): ReviewItemType {
  return (CHECK_KEYS as CheckKey[]).reduce((acc, k) => setCheck(acc, k, { status: "ok", note: "" }), item);
}

function submitted(over: Partial<Parameters<typeof draftItem>[0]> = {}) {
  const item = draftItem(over);
  return submitKnowledgeItemForReview(item, {
    intent: "Confirm accuracy", audience: "Engineering", submittedBy: "Taro", now: NOW,
  });
}

test("applyReviewDecisionToKnowledgeItem approves the knowledge item when the linked review is approved", () => {
  const { reviewItem, knowledgeItem } = submitted();
  const decided = recordDecision(allChecksOk(reviewItem), "approved", "Grace", "confirmed accurate", "2026-09-24T00:00:00.000Z");
  const result = applyReviewDecisionToKnowledgeItem(knowledgeItem, decided);

  assert.equal(result.status, "approved");
  assert.equal(result.reviewHistory.length, 1);
  assert.deepEqual(result.reviewHistory[0], {
    verdict: "approved", by: "Grace", at: "2026-09-24T00:00:00.000Z", note: "confirmed accurate",
  });
});

test("applyReviewDecisionToKnowledgeItem: revise sends the knowledge item back to draft, never approved", () => {
  const { reviewItem, knowledgeItem } = submitted();
  const decided = recordDecision(reviewItem, "revise", "Grace", "needs a clearer title", "2026-09-24T00:00:00.000Z");
  const result = applyReviewDecisionToKnowledgeItem(knowledgeItem, decided);

  assert.equal(result.status, "draft");
  assert.notEqual(result.status, "approved");
});

test("applyReviewDecisionToKnowledgeItem: rejected is terminal on the knowledge item too", () => {
  const { reviewItem, knowledgeItem } = submitted();
  const decided = recordDecision(reviewItem, "rejected", "Grace", "out of date", "2026-09-24T00:00:00.000Z");
  const result = applyReviewDecisionToKnowledgeItem(knowledgeItem, decided);

  assert.equal(result.status, "rejected");
});

test("applyReviewDecisionToKnowledgeItem: escalated leaves the knowledge item under_review", () => {
  const { reviewItem, knowledgeItem } = submitted();
  const decided = recordDecision(reviewItem, "escalated", "Grace", "needs legal review", "2026-09-24T00:00:00.000Z");
  const result = applyReviewDecisionToKnowledgeItem(knowledgeItem, decided);

  assert.equal(result.status, "under_review");
});

test("applyReviewDecisionToKnowledgeItem throws if the ReviewItem has no decision yet", () => {
  const { reviewItem, knowledgeItem } = submitted();
  assert.throws(() => applyReviewDecisionToKnowledgeItem(knowledgeItem, reviewItem), /no decision/);
});

test("applyReviewDecisionToKnowledgeItem throws if the knowledge item is linked to a different review", () => {
  const { knowledgeItem } = submitted();
  const { reviewItem: unrelatedReview } = submitted({ title: "A different procedure" });
  const decidedUnrelated = recordDecision(allChecksOk(unrelatedReview), "approved", "Grace", "", "2026-09-24T00:00:00.000Z");
  assert.throws(
    () => applyReviewDecisionToKnowledgeItem(knowledgeItem, decidedUnrelated),
    /not linked/,
  );
});
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test tests/knowledge-review-bridge.test.ts`
Expected: FAIL — `applyReviewDecisionToKnowledgeItem` not exported.

- [ ] **Step 8: Implement `applyReviewDecisionToKnowledgeItem`**

Append to `lib/knowledge/review-bridge.ts`:

```typescript
/** Applies a decided ReviewItem's verdict onto its linked KnowledgeItem via
 *  lib/knowledge/model.ts's recordReviewerDecision() — the single write
 *  path to KnowledgeItem.status. Refuses to act on a review with no
 *  decision yet, and refuses to apply a decision from a review the
 *  knowledge item isn't actually linked to (its own reviewItemId must
 *  match), so one knowledge item's approval can never be triggered by an
 *  unrelated review's outcome. */
export function applyReviewDecisionToKnowledgeItem(knowledgeItem: KnowledgeItem, reviewItem: ReviewItem): KnowledgeItem {
  if (knowledgeItem.reviewItemId !== reviewItem.id) {
    throw new Error(`knowledge item "${knowledgeItem.id}" is not linked to review "${reviewItem.id}" (linked to "${knowledgeItem.reviewItemId ?? "none"}")`);
  }
  const decision = latestDecision(reviewItem);
  if (!decision) {
    throw new Error(`review "${reviewItem.id}" has no decision yet`);
  }
  return recordReviewerDecision(knowledgeItem, decision.verdict, decision.by, decision.note, decision.at);
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/knowledge-review-bridge.test.ts`
Expected: PASS (8 tests total).

- [ ] **Step 10: Commit**

```bash
git add lib/knowledge/review-bridge.ts tests/knowledge-review-bridge.test.ts
git commit -m "feat: add applyReviewDecisionToKnowledgeItem to close the review loop"
```

- [ ] **Step 11: Register the new test file in the repo's test script**

**Files:**
- Modify: `package.json:2` (the `"test"` script)

In the `"test"` script's `node --experimental-strip-types --test ...` file
list, insert `tests/knowledge-review-bridge.test.ts` immediately after
`tests/knowledge-store.test.ts` (which was itself inserted after
`tests/review-model.test.ts` by the prior plan). Change:

```
...tests/review-model.test.ts tests/knowledge-model.test.ts tests/knowledge-store.test.ts tests/govern-redact.test.ts...
```

to:

```
...tests/review-model.test.ts tests/knowledge-model.test.ts tests/knowledge-store.test.ts tests/knowledge-review-bridge.test.ts tests/govern-redact.test.ts...
```

(the rest of the script line, before and after this segment, is unchanged;
if the exact surrounding text differs slightly from what's shown here
because other work has changed nearby entries, insert
`tests/knowledge-review-bridge.test.ts` right after
`tests/knowledge-store.test.ts` wherever that entry currently sits).

- [ ] **Step 12: Run the full existing test suite to confirm nothing else broke**

Run: `bun run test`
Expected: PASS — all existing tests plus the 8 new tests in
`knowledge-review-bridge.test.ts` pass.

- [ ] **Step 13: Commit**

```bash
git add package.json
git commit -m "test: wire knowledge-review-bridge tests into the test script"
```

---

## Self-Review Notes (for whoever executes this plan)

- **Spec coverage:** This plan implements spec Part F Task 4 exactly — a
  pure bridge between `ReviewItem` decisions and `KnowledgeItem` status. It
  deliberately does not wire this bridge into `scripts/demo.ts`'s HTTP
  routes or into `config/reviews.json`/`config/knowledge-items.json`
  persistence — that orchestration is separate follow-up work, once this
  bridge exists and is reviewed on its own.
- **No changes to `lib/review/model.ts`, `lib/knowledge/model.ts`, or
  `lib/knowledge/store.ts`.** This task only adds a new file that imports
  from those three (two of the three; `store.ts` is not imported by this
  task at all, since persistence isn't in scope).
- **Local Meeting Transcriber, Graflow, meeting-publish-inbox branches:**
  not touched by this task.
- **Type consistency check performed:** `submitKnowledgeItemForReview`'s
  return shape (`{ reviewItem, knowledgeItem }`) and
  `applyReviewDecisionToKnowledgeItem`'s single-`KnowledgeItem` return are
  used consistently across all 8 tests; no signature drift between the
  Step 3/Step 8 implementations and the Step 1/Step 6 tests.
