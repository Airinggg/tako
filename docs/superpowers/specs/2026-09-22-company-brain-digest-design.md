# Company-Brain Digest — Design Spec

Status: Draft, awaiting review
Author: brainstormed with the product owner, 2026-09-22
Related: `docs/BRAIN_CONNECTORS.md`, `lib/skills/`, `lib/workers/`, `lib/review/model.ts`, `lib/govern/policy.ts`

## 0. Objective

Tako's differentiation against an all-in-one hosted suite (e.g. Lark) is not
"we also answer questions" — Ask already does that, one source at a time,
only when asked. This spec adds two things Ask cannot do:

1. **Proactive synthesis** — surface what changed, and what contradicts an
   earlier statement, without the user having to ask.
2. **Institutional memory** — show how a fact or decision evolved over time
   across every connected source, not just its current value.

Both land on one new screen: **Digest**.

## 1. Non-goals

- Not a replacement for Ask. Ask stays the pull-based, single-source Q&A
  surface it is today.
- Not a governed/approved output. Digest entries are internal browsing
  aids — labeled AI-detected and cited, same trust model Ask already uses.
  They do not enter `lib/review/model.ts`'s approval queue, and Tako's
  "never sends or publishes anything on its own" guarantee is unaffected
  because nothing here is ever sent anywhere; it is displayed to signed-in
  users of this same instance.
- Not full cross-source *search* (the Ask screen's current one-source-at-a-
  time limitation is a separate, pre-existing gap, tracked independently of
  this spec). Digest's cross-source analysis works differently — see §3 —
  and doesn't require fixing Ask's search first.
- Not a general entity-linking or knowledge-graph system. Topic identity
  (§2) is intentionally simple text-matching, not NLP entity resolution.

## 2. Data model — the topic ledger

A new persisted file, `config/digest-ledger.json` (git-ignored, alongside
`config/tasks.json` and `config/reviews.json` — same "local state, not
committed" precedent), holds every topic's history:

```ts
type LedgerEntry = {
  id: string;              // stable id for this one claim
  claim: string;           // one-sentence extracted statement
  source: string;          // page slug, e.g. "discord/general/2026-09-21"
  extractedAt: string;     // ISO timestamp of when the digest job ran
  contentDate: string;     // best-known date the claim was made (extractPageDate)
};

type Topic = {
  key: string;              // stable topic identifier, see below
  label: string;            // human-facing title, e.g. "Meeting with 堀さん"
  entries: LedgerEntry[];   // chronological, oldest first
  contradictions: {
    laterEntryId: string;   // the entry that triggered the flag
    earlierEntryId: string; // the entry it contradicts
    explanation: string;    // one sentence from the model, e.g. "time changed from 14:00 to 20:00"
    detectedAt: string;
  }[];
};

type DigestLedger = {
  lastProcessedAt: Record<string, string>; // per-source: newest contentDate already processed
  topics: Topic[];
};
```

**Topic identity** is deliberately simple: the extraction step (§3) assigns
each claim a short topic key itself (e.g. `meeting-hori-san`,
`pricing-ai-review-desk`), and a new claim merges into an existing topic
only on an exact key match. No fuzzy matching, no embeddings-based topic
clustering — that's real future work (§8), but exact-key matching is
enough to prove the concept and keeps the model's job simple: "extract
claims and give each one a short, stable, kebab-case key."

## 3. Extraction pipeline

Runs as a new function, `runDigestPass()`, in a new file
`lib/digest/run.ts`, triggered per §5.

For each configured source:

1. List pages via the same `gb(["list", "--source", source])` call
   `breakdown()` already uses (`scripts/demo.ts`).
2. Compare each page's date (`extractPageDate`, already in `lib/eval/qa.ts`)
   against `lastProcessedAt[source]`. Only pages newer than the watermark
   are processed — this is what keeps the job cheap and bounded per run,
   not O(whole corpus) every time.
3. For each new/changed page, one local-model call
   (`ollamaAnswer`/`synthesizeAnswer` from `lib/eval/qa.ts` — same
   provider-dispatch this session already added, so it also benefits from
   the Gemini demo-mode switch) with a fixed extraction prompt:
   > "List the concrete claims or decisions in this text as JSON:
   > `[{claim, topicKey, topicLabel}]`. A claim is a specific fact, decision,
   > date, time, price, or assignment — not general chat. If there are none,
   > return `[]`."
4. Each returned claim becomes a `LedgerEntry` appended to its topic (new
   topic created if the key doesn't exist yet).
5. Update `lastProcessedAt[source]` to the newest page date processed.

## 4. Contradiction detection

After extraction, for every topic that received a *new* entry this run:
one more model call compares the new entry's claim against only the
**immediately preceding** entry in that topic (not the whole history —
bounded cost):

> "Claim A (earlier): {prior.claim}. Claim B (later): {new.claim}. Does B
> contradict or change A? Answer JSON: `{contradicts: bool, explanation}`."

A `true` result appends to the topic's `contradictions` array. This is
intentionally the *only* pairwise comparison made — chaining means a topic
with N entries costs N model calls total across its whole lifetime, not
N² at any point.

## 5. Trigger

Hooked directly into the sync-completion paths that already exist —
not through the schedule-based `Worker` abstraction (`lib/workers/model.ts`),
since that's interval/daily/weekly scheduling and there is no
event-triggered hook there today. Two call sites:

- `scripts/demo.ts`'s `/api/connectors/sync` handler (manual "Sync now"),
  after a successful sync.
- `scripts/sync-daemon.ts`'s scheduled sync loop, after each cycle.

Both call `runDigestPass()` fire-and-forget (logged, not awaited by the
HTTP response) so a slow digest pass never blocks the sync action itself
from returning — consistent with this session's finding that a blocking
synchronous call anywhere in the request path freezes the whole server.

## 6. Digest screen

New sidebar entry, grouped under **Automate** (alongside Automations,
Connected Apps, Tasks, Activity — it's a read surface fed by connectors,
same family): `{ id: "digest", label: "Digest" }` in `NAV_GROUPS`
(`scripts/demo.ts`).

Two sections, newest first:

- **Changed recently** — every `LedgerEntry` added since the user's last
  visit (tracked client-side, e.g. `localStorage`, purely a "seen" marker,
  never a source of truth).
- **Contradictions** — every entry in every topic's `contradictions` array,
  showing both claims side by side, their sources, and the explanation.

Each item carries a cited source slug (linking to the existing page-detail
drawer Ask already uses) and the label: *"AI-detected — verify against
sources"* — the same disclaimer Ask's answers already carry, so the trust
model is consistent across the app, not a new one to learn.

Clicking a topic's label opens its full timeline — every `LedgerEntry` in
chronological order. This *is* the institutional-memory view from §0.2;
no separate feature is needed for it beyond rendering `Topic.entries`.

## 7. Error handling

- A page whose extraction call fails (timeout, malformed JSON from the
  model) is skipped for this run and retried on the *next* digest pass —
  it is not marked processed, so `lastProcessedAt` only advances past pages
  that were actually handled.
- A malformed contradiction-check response defaults to `contradicts: false`
  — a missed contradiction is a lesser failure than a false accusation
  surfaced to the user without evidence.
- The ledger file is written with the same atomic-write pattern already
  used for other local JSON state (`writePrivateFileAtomic`,
  `lib/util/private-file.ts`) — a crash mid-write must not corrupt
  previously-recorded history.

## 8. Explicitly deferred (future work, not this spec)

- Fuzzy/semantic topic matching (embeddings-based clustering instead of
  exact key match) — needed once real usage shows the model's topic keys
  drift for what should be the same topic.
- Cross-referencing Digest's topic ledger back into Ask's retrieval (e.g.
  "Ask, informed by known contradictions") — a natural follow-up once both
  systems are proven independently.
- Any UI for dismissing/archiving a stale contradiction — v1 just shows
  the running list; pruning is future work once real volume is observed.

## 9. Testing strategy

- `lib/digest/run.ts`'s watermark logic (`lastProcessedAt` comparison) is
  pure and unit-testable without a real model call, same style as
  `tests/eval-qa.test.ts`'s `extractPageDate` tests.
- Extraction and contradiction-check prompt parsing (JSON-from-model
  handling) tested against fixed sample model outputs, including malformed
  ones (empty array, prose-wrapped JSON, truncated JSON) — mirroring
  `tests/skills-extract.test.ts`'s existing `mineSkills` tests, which
  already cover exactly this class of problem (parsing a local model's
  JSON output tolerantly).
- No test depends on a live Ollama/Gemini call — all model interaction is
  injected/mocked, consistent with how `answerFromSource`'s own tests work.
