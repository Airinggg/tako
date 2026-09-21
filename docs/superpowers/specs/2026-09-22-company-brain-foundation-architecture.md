# Company Brain Foundation — Architecture Specification (Phase 0 / Phase 1)

**Status:** Architecture checkpoint for review. No implementation code, package
installs, deployments, credential changes, or Graflow/Local-Meeting-Transcriber
changes are authorized by this document.

**Scope note:** This document was written against the `tako` repository at
`feature/connector-credentials-and-categorization` (HEAD `edc4efb`), cross-
checked against the in-flight meeting-publish inbox work on the
`feat/meeting-publish-inbox` worktree (HEAD `4f1cfdd`) and its approved
architecture spec (`docs/superpowers/specs/2026-09-18-meeting-publish-inbox-architecture.md`)
and plan (`docs/superpowers/plans/2026-09-18-meeting-publish-inbox.md`). That
work is **not duplicated or modified here** — this document designs the
general knowledge layer that the meeting analysis output (once built) plugs
into, using the same `ReviewItem` contract the meeting spec already commits to.

---

## Part A — Verified current-state findings

Every claim below is grounded in source at the stated file. Where no evidence
was found, that is stated explicitly rather than assumed.

### A.1 Connector layer (`lib/connectors/`)

- Registry (`lib/connectors/registry.ts:19`) declares
  `ConnectorName = "notion" | "slack" | "drive" | "discord" | "notes" | "cad"`.
  MCP (`lib/connectors/mcp/`) and the in-flight meeting connector
  (`lib/connectors/meetings/`, on the meeting-plan branch) sit outside this
  registry with their own config/manifest system.
- **There is no shared TypeScript interface all connectors implement.** Each
  connector directory follows the same file *shape* by convention
  (`client.ts`, `collect.ts`, `render.ts`, `run.ts`), but `render.ts` in each
  independently returns a structurally-identical, not nominally-shared, shape:
  `{ path: string; markdown: string }` (verified independently in
  `lib/connectors/slack/render.ts:13`, `lib/connectors/notion/render.ts:4`,
  `lib/connectors/drive/render.ts:3`, `lib/connectors/discord/render.ts:6`,
  `lib/connectors/notes/render.ts:9`, `lib/connectors/cad/render.ts:6`,
  `lib/connectors/mcp/render.ts:18`).
- **A normalized record is a Markdown file with YAML frontmatter**, written
  into a git-backed tree (`brain-sources/`) that `gbrain sync` later ingests —
  not a database row, not a shared JS object. Frontmatter fields differ per
  connector (e.g. Slack: `source, channel, channel_id, root_ts, url,
  participants, updated`; Notion: `id, source, title, url, author, created,
  updated`; CAD: `source, cad_system, doc_type, part_number, revision,
  material, state, modified_by, updated`).
- Connector configs live in `lib/connectors/shared/config.ts`. Each carries a
  `subdir` (e.g. `"engineering"`, `"shared"`) used as a coarse browsing-scope
  prefix — **not** a formal tenant/workspace field with enforcement.
- The **only** connector config carrying a data-classification field is
  `McpServerEntry.dataClass?: "public" | "internal" | "confidential" |
  "restricted" | "export-controlled"` (`lib/connectors/shared/config.ts:166`,
  default `"internal"` at `lib/connectors/mcp/run.ts:41`).

### A.2 gbrain storage/retrieval (`packages/brain/`)

- Vendored engine at `packages/brain/`, Postgres/pgvector schema at
  `packages/brain/src/schema.sql` (also mirrored for PGLite/embedded use).
- **`pages`** table (`schema.sql:85-153`) is the core content unit: `id,
  source_id, slug, type, page_kind, title, compiled_truth, frontmatter
  JSONB, content_hash, created_at, updated_at, deleted_at, effective_date,
  last_retrieved_at, generation` (cache-invalidation counter). No document-
  level classification, ownership, or provenance column exists on `pages` —
  those live only inside the opaque `frontmatter JSONB` blob, per-connector,
  with no fixed schema Tako enforces.
- **`content_chunks`** table (`schema.sql:296-332`): `page_id, chunk_index,
  chunk_text, embedding vector(1536)` (schema default only), `model`,
  `token_count`, `embedded_at`, plus code-symbol columns and a chunk-grain
  `search_vector TSVECTOR`.
- **Actual embedding configuration** (not the schema's hardcoded default):
  `docs/BRAIN_SETUP.md:33-52` configures `ollama:bge-m3`, 1024 dimensions,
  against local PGLite — fully local, no hosted call.
- **Chunking**: semantic sentence-boundary chunker with a recursive/token-
  window fallback (`packages/brain/src/core/chunkers/semantic.ts`,
  `recursive.ts`); separate code-aware chunker (`core/chunkers/code.ts`).
- **Citation/anchor mechanism**: pages are cited by **slug**
  (`lib/eval/qa.ts:172-193, 263` — the model is told to emit
  `[slug]` after each fact; `citedSlugs()` parses it back out; line numbers
  reflect this branch's uncommitted `qa.ts` edits present at time of writing). The link to
  the original external record (Slack permalink, Notion URL, Drive
  `webViewLink`) lives in that page's frontmatter `url:` field set at
  connector-render time — **no separate citation/anchor table exists.**
  `packages/brain/src/core/output/validators/citation.ts:31` separately
  enforces, at the gbrain content layer, that factual paragraphs in
  `compiled_truth` carry a `[Source: ...]` tag or inline URL link.
- **Retrieval**: hybrid keyword (`tsvector`/GIN) + vector (pgvector HNSW,
  cosine) search fused with Reciprocal Rank Fusion, `RRF_K = 60`
  (`packages/brain/src/core/search/hybrid.ts:1-104`), followed by query-intent
  classification, reranking, autocut, and token-budget stages.
- **No `db/` or `drizzle/` directory exists in this repo** — `schema.sql` is
  the sole schema source of truth (hand-written DDL, not ORM migrations).
- **No document-level classification enum exists on `pages`/`content_chunks`**
  (verified: no such column in `schema.sql`). The only classification enum in
  the whole repo, `DataClassification` (`lib/govern/manifest.ts:6`), governs
  **MCP/industrial tool-invocation policy**, not knowledge-base documents.

### A.3 Governance (`lib/govern/`)

- **`categorize.ts`**: department bucketing (`finance/hr/engineering/sales/
  legal/operations/general`) by keyword-substring score. Explicitly *not*
  access control — header comment states it "never changes who can read
  what" (`categorize.ts:1-9`); used only to filter Ask candidate pools
  (`lib/eval/qa.ts:214-216`).
- **`redact.ts`**: PII/secret masking (`mask`/`flag`/`block`), used both at
  ingestion and on review-body display, and inside the MCP resource-read path
  (`lib/connectors/mcp/govern.ts:66-82`).
- **`policy.ts`**: deny-by-default decision engine (`evaluate()`,
  `policy.ts:31-56`) checking tool risk, `dataClass` membership, and scope
  `readSources`, dispatching allow/approval-required/deny by risk tier
  (`read` / `create-isolated` / `mutate` / `destructive` / `physical-control`).
  **The only verified call site is `lib/connectors/mcp/govern.ts:103-148`** —
  i.e. classification enforcement currently applies to the MCP connector path
  only, not to Notion/Slack/Drive/Discord ingestion or to the Ask/retrieval
  path (`lib/eval/qa.ts` has no call into `lib/govern/policy.ts`).
- **`sync-log.ts`**: append-only per-sync provenance log (`source, path,
  action, sha256 hash, syncedBy, syncedAt`), written to
  `config/sync-log.jsonl`. Header comment is explicit: "deliberately NOT an
  approval gate — content still becomes searchable immediately on sync"
  (`sync-log.ts:1-9`). Confirms **P1-07 (RAG-poisoning / approval-gated
  ingestion) is only partially addressed today**: an audit trail exists, no
  pre-index approval gate does.
- **`manifest.ts`**: pure validator for industrial/MCP connector manifests
  (deny-by-default enablement, pinned revisions/hashes, `secret://` refs
  only, approval-required destructive tools).
- **Retention/deletion**: documented policy (`docs/DATA_RETENTION.md`, 90-day
  default recorded in `config/retention.json`), explicitly "a policy record,
  not an automated job — nothing currently deletes content on a schedule."
  Deletion mechanics live in the vendored `packages/brain` CLI
  (`bun src/cli.ts delete/archive/restore/purge`), separate from `lib/govern/`.

### A.4 Review model (`lib/review/model.ts`) — read directly, in full

- `ReviewItem` (`model.ts:32-47`): `id, title, intent, audience, body,
  sources[], submittedBy, submittedAt, state, checks, decisions[]`.
- Five fixed checks (`CHECK_KEYS`, `model.ts:12-13`): `intent, merit, harm,
  evidence, policy`, each `"ok" | "concern" | "blocker" | "unchecked"`.
- States (`model.ts:26-27`): `submitted, in_review, approved, revise,
  rejected, escalated`. `approved`/`rejected` are terminal
  (`allowedVerdicts()`, `model.ts:110-114`).
- `canApprove()` (`model.ts:100-107`) requires: every check non-`unchecked`,
  no `blocker`, `evidence` check explicitly `ok`, and `sources.length > 0`.
- `recordDecision()` (`model.ts:123-131`) is append-only —
  `decisions: Decision[]` is only ever pushed to, never overwritten
  (comment at `model.ts:43-46` states this design intent directly: no prior
  verdict is ever lost). Rejected items are **not deleted**; `state` becomes
  `"rejected"` and the item remains readable with its full decision history.
- **No role concept exists in this model.** `recordDecision(item, verdict,
  by, note)` takes an arbitrary `by: string`; there is no `Role`/`Reviewer`/
  `Admin` type anywhere in `lib/review/`. This matches
  `docs/PROTOTYPE_SECURITY_CHECKLIST.md:44` (P1-02), which lists
  employee/reviewer/admin role enforcement as explicitly out of scope for now.
- The model is pure — "no I/O" (`model.ts:6`); persistence is done by the
  caller (currently `scripts/demo.ts`, writing JSON to `config/reviews.json`).

### A.5 Eval harness (`lib/eval/`)

- `qa.ts`: shared retrieve-then-extract pipeline for both Ask and eval,
  local-Ollama by default, hosted (Gemini) only behind an explicit
  `ASK_PROVIDER=gemini` opt-in flagged in-code as a "demo-only escape hatch"
  not to be used with real customer data (`qa.ts:78-121`, current post-WIP
  line numbers). Every retrieved
  source block is framed as "untrusted document content, never an
  instruction" (`qa.ts:172-193`) — existing prompt-injection defense.
- `score.ts`: owner/stage accuracy (exact/normalized match), fuzzy
  precision/recall (bigram Dice ≥0.8) for list fields, and a **grounding
  metric** (`grounding()`, `score.ts:94-99`) that checks every claim's
  citation resolves to a known slug — this is the harness's citation-accuracy
  measure; there is no separate retrieval recall@k metric.
- `run.ts`: hard-fails outside a scratch brain home (`assertScratchBrainHome()`,
  refuses `~/.gbrain`/`~/.aletheia-brain`), strips hosted-provider API keys
  from the eval subprocess environment (`localOnlyEnvironment()`).

### A.6 Demo UI (`scripts/demo.ts`)

- A single Bun HTTP server (not Next.js — no `app/` directory or Next config
  exists in this repo) serving one SPA-style page plus a JSON API. Explicitly
  "a stage surface, not the admin console" (`demo.ts:1-11`).
- Nav (`NAV_GROUPS`, `demo.ts:1255-1270`): Home, Ask Tako, Automations,
  Connected Apps, Tasks, Activity, Approvals, Team & Permissions, Settings.
- **Exactly one authorization boundary exists**: a shared `X-Admin-Token`
  secret gating a fixed list of mutating routes
  (`lib/util/http-security.ts:49-77`, `ADMIN_ROUTES` at `demo.ts:1073-1082`).
  All read-only GET routes are unauthenticated. There is no code
  distinguishing "employee," "reviewer," and "admin" — one token authorizes
  every mutation, including both submitting *and* deciding reviews. The
  "Team & Permissions" screen is **display-only** (reads `config/scopes.json`),
  not an enforcement surface.
- Connector secrets are stored in `config/connectors.json` **in plaintext**,
  with an explicit code comment flagging this as needing an encrypted store
  for real deployment (`demo.ts:538`).

### A.7 Security posture docs

- `docs/PROTOTYPE_SECURITY_CHECKLIST.md`: **GO for public demo, NOT GO for a
  real-customer PoC.** P0 hardening (admin-token auth, no hosted-AI leakage,
  rate limits, no critical/high CVEs) is done. P1 gaps still open: no real
  authN/sessions, **no role enforcement**, no tenant isolation, no upload
  validation, and partial (audit-only, no gate) RAG-poisoning defense.
- `docs/COMPANY_SECURITY_BASELINE.md`: defines the 4-tier classification
  (Public/Internal/Confidential/Personal-or-highly-restricted) and states
  plainly that persistent tenant-separated storage, SSO/MFA, RBAC, audit
  logging, retention/export/deletion, and secure upload are **not yet
  enforced** — a real-document PoC is explicitly **NO-GO** until they have
  implementation evidence, not just policy statements.

### A.8 In-flight meeting-publish-inbox work (not to be duplicated)

On `feat/meeting-publish-inbox` (uncommitted-work worktree, not yet merged):
package contract, fail-closed local inbox, importer, canonical transcript
rendering, and setup checks are **already implemented**
(`lib/connectors/meetings/{schema,inbox,import,render,run,state}.ts`). The
approved spec commits to:

- accepting **`internal`-only** meeting classification in v1;
- one stable gbrain page per meeting (`brain-sources/<sourceId>/meetings/
  <meetingId>.md`), transcript-as-evidence, local extractive summary as
  **non-authoritative, non-citable** supplementary text only;
- a `MeetingAnalysisDraftV1` contract (candidate decisions, candidate open
  actions, a meeting-necessity *review question* — never a judgment — and a
  follow-up-need assessment, every claim requiring an `EvidenceRef` to a
  transcript segment);
- routing that draft into the **existing** `ReviewItem` model verbatim (no
  meeting-specific reviewer role, no bypass of `canApprove()`), with approval
  materializing only the approved subset into the canonical page, and
  rejection remaining visible as an append-only audit status without
  promoting rejected content.

**Not yet built** (per file inventory — no `lib/meetings/analysis.ts` or
review-bridge code exists on that branch yet): the local extraction worker
itself and the bridge that turns its draft into a `ReviewItem`. This is the
first concrete consumer of the knowledge layer proposed below.

### A.9 Pending per-member authentication design (not yet implemented)

`docs/superpowers/specs/2026-09-16-per-member-auth-design.md` — **status:
"Pending user approval before writing-plans. Not implemented."** This is the
concrete, near-term plan for closing the P1-02 role gap noted throughout this
document, and it must be read alongside Parts C–F below, not in isolation:

- The planned role model is **binary**: `role: "admin" | "member"`
  (`per-member-auth-design.md:258`), not a three-tier employee/reviewer/admin
  split.
- The planned route matrix puts `/api/reviews`, `/api/review-submit`, and
  `/api/review-decide` behind **"session required, any role"**
  (`per-member-auth-design.md:64,65`) — i.e. review submission and decision
  stay open to any authenticated member, exactly matching the current,
  already-verified absence of a reviewer role in `lib/review/model.ts` (A.4).
  This spec's knowledge layer must not invent a reviewer role that
  contradicts that design.
- The design explicitly scopes itself to **authentication only** for v1 and
  names **"source authorization — which indexed documents a specific person
  may retrieve … Not built in this spec"** as an admitted, stated limitation
  (`per-member-auth-design.md:79-90`), not a future nice-to-have. This is the
  same gap Risk 2 below describes independently from the retrieval side; the
  two documents now corroborate each other.

**Implication for this spec:** Part C's "Employee / Manager / Administrator"
framing must be read as three **query scopes**, not three **enforced
authorization tiers**. Until a richer RBAC extension is separately designed
and approved, every authenticated `member` can technically run any of Part
C's queries; only the `admin`-role split (config/connector mutation, user
management) is planned to be enforced at the route level. Part C is corrected
below to say this plainly rather than implying a manager tier that doesn't
exist in the concrete design already on the table.

### A.10 Same-day automation-canvas spec (checked, no conflict)

`docs/superpowers/specs/2026-09-22-automation-canvas-design.md` (also on this
branch, dated the same day) adds a visual node/edge view over the existing
`trigger`/`action1`/`action2` automation record — it does not touch
`lib/review/`, `lib/govern/`, gbrain storage, or introduce any new data model.
It confirms independently, from the automations side, the same finding this
document makes from the review side: today's worker/automation system
"writes a `SKILL.md` description" and "never delivers output anywhere"
(automation-canvas spec §0, corroborating this document's A.8 note on the
meeting spec's §11.3 automation-limitation language). No part of this
Company Brain spec depends on or conflicts with the automation canvas work;
they touch disjoint code paths.

### A.11 Distinguishing verified fact from proposal

Everything in A.1–A.9 is existing, verified behavior (A.10 is a
cross-check against a sibling in-flight design, also verified). Everything
from Part B onward is proposed and requires review before any implementation
begins.

---

## Part B — Company Brain V1 knowledge model

### B.1 Design stance

Add a **thin, explicit knowledge-item layer that references evidence, it does
not replace it.** A knowledge item never stores its own copy of source
content; it always points at one or more gbrain pages (by slug) plus, where
useful, a byte/character anchor within that page. This keeps `pages` as the
single copy of truth and avoids the "duplicate content" failure mode the
meeting-inbox spec already rejected for the Notes-connector-reuse option
(§B.5 evaluates this formally against two alternatives).

### B.2 Knowledge categories (V1)

1. **Policy / rule** — company policy, compliance rule, must-follow constraint.
2. **Procedure / how-to** — operating procedure, runbook, checklist.
3. **Decision & rationale** — a decision that was made, why, by whom, when.
4. **Project / current context** — active project state, scope, status.
5. **Customer / product / service** — classification-gated; excluded entirely
   from a knowledge item where the underlying evidence's classification
   would forbid this category's typical audience.
6. **Team / role knowledge** — who owns what, role responsibilities.
7. **Onboarding / takeover knowledge** — durable knowledge meant to survive a
   person leaving a role (feeds Takeover Packs, Part D).
8. **Meeting-derived candidate decision / open action** — the category the
   in-flight meeting analysis work will populate; identical shape to
   category 3/procedure candidates but always `origin: "model-suggested"`
   and always sourced from `EvidenceRef`s into a meeting transcript page.

These are a closed enum (`KnowledgeType`), not a taxonomy tree, matching the
instruction to prefer explainable records over an autonomous knowledge graph.

### B.3 Required metadata (every knowledge item)

```ts
type KnowledgeItemId = string; // "ki_" + lowercase UUIDv7

type KnowledgeStatus =
  | "draft"            // model-suggested or human-drafted, not yet reviewed
  | "under_review"     // a ReviewItem exists and is not yet decided
  | "approved"         // materialized as trusted knowledge
  | "superseded"       // approved, but a newer approved item replaces it
  | "rejected"         // reviewed and declined; visible, not deleted
  | "archived";        // approved once, now retired (retention/lifecycle)

type KnowledgeOrigin = "source-authored" | "human-authored" | "model-suggested";

type EvidenceAnchor = {
  pageSlug: string;          // gbrain page slug — the only citation anchor
  chunkIndex?: number;       // optional: content_chunks.chunk_index, when known
  excerpt?: string;          // short bounded quote, for human verification
};

type KnowledgeRelation = {
  type: "relates_to" | "supersedes" | "superseded_by" | "derived_from"
      | "blocks" | "blocked_by" | "part_of";
  targetId: KnowledgeItemId;
};

type ReviewerDecisionRecord = {
  verdict: "approved" | "revise" | "rejected" | "escalated"; // mirrors lib/review/model.ts Verdict
  by: string;
  at: string;   // ISO
  note: string;
};

type KnowledgeItem = {
  id: KnowledgeItemId;
  type: KnowledgeType;                 // one of the 8 categories in B.2
  title: string;
  description: string;                 // short, human-scannable summary
  evidence: EvidenceAnchor[];           // >=1 for approved items (mirrors canApprove())
  sourceWorkspace: string;              // matches connector `subdir` / meeting workspaceId
  sourceConnector: string;              // "notion" | "slack" | "drive" | "discord" |
                                         // "meetings" | "mcp:<server>" | "human"
  classification: "internal" | "confidential" | "restricted" | "public" | "export-controlled";
  origin: KnowledgeOrigin;
  status: KnowledgeStatus;
  ownerId: string;                      // a named person or a workspace id — never blank for approved
  createdAt: string;                    // ISO, when the item was first drafted
  sourceUpdatedAt: string | null;       // ISO, last time cited evidence changed upstream
  lastReviewedAt: string | null;        // ISO, last human review decision
  nextFreshnessReviewAt: string | null; // ISO, see B.4
  relations: KnowledgeRelation[];
  reviewHistory: ReviewerDecisionRecord[]; // append-only, mirrors ReviewItem.decisions
  retention: {
    policyRef: string;                  // e.g. workspace retention policy id
    deletionImplication: string;        // human-readable: what deleting the source page does to this item
  };
  reviewItemId?: string;                // set once a ReviewItem exists (lib/review/model.ts)
};
```

Every field above is either directly required by the assignment's metadata
list or is a narrower, already-existing type reused from the codebase
(`Verdict`, `by`, `at`, `note` come straight from `lib/review/model.ts`'s
`Decision` type — deliberately not reinvented).

### B.4 Evidence and freshness rules

1. **Nothing model-generated is automatically authoritative.** Every
   `KnowledgeItem` is created with `status: "draft"` and `origin:
   "model-suggested"` when a model (Ask synthesis, meeting analysis, or any
   future extractor) proposes it. It can only reach `"approved"` through the
   existing `lib/review/model.ts` state machine — no new approval path is
   introduced. This directly satisfies the requirement that frequent
   retrieval, high confidence score, or model certainty can never itself
   move an item to `approved`; only a recorded human `Decision` can.
2. **Evidence is always inspectable.** `evidence: EvidenceAnchor[]` must
   resolve to a real `pages.slug` at approval time (checked the same way
   `canApprove()` already requires `sources.length > 0`) — this spec adds no
   new grounding rule, it reuses the existing one at the knowledge-item
   layer.
3. **Staleness/conflict handling.** When the gbrain `pages` row a
   `KnowledgeItem` cites changes (`pages.updated_at` advances, or
   `pages.deleted_at` is set, or `pages.generation` increments past what was
   cited), the item does **not** silently remain `approved`. It transitions
   to `under_review` with a system-authored review note ("cited evidence
   changed since last approval") and a fresh `ReviewItem` is opened
   referencing the same evidence. This is a polling/comparison job run at
   sync time (see roadmap, Task 3) — not a new database trigger inside
   `packages/brain`, since that package is vendored and should not be
   casually modified (`AGENTS.md:22-27`).
4. **Freshness model (deliberately simple, timestamp-based, no scoring).**
   Each `KnowledgeItem` carries `nextFreshnessReviewAt`, set at approval time
   to `lastReviewedAt + <category default interval>` (e.g. policy: 180 days;
   procedure: 180 days; project/current-context: 30 days; decision: none —
   decisions don't go stale, only get superseded; meeting-derived: 30 days
   before folding into a takeover pack). Crossing that date does not delete
   or hide the item; it surfaces it on the Manager view (Part C) as
   "due for freshness review," which a human clears by re-confirming or
   updating it — never automatically.
5. **Multi-source citation behavior.** When an answer (Ask, or a Takeover
   Pack section) combines multiple `KnowledgeItem`s or raw pages, every
   sentence keeps its own bracketed citation set, exactly as
   `lib/eval/qa.ts`'s existing `[slug]` convention already requires per
   fact — the knowledge layer does not change this convention, it just also
   lets a citation point at `[ki_xxxx]` (a knowledge item) which itself
   carries its own `evidence[]` for one more hop back to raw pages when a
   reader wants to "verify source." No new synthesis-time behavior is
   introduced; `citedSlugs()`-style parsing is extended to also accept
   `ki_` prefixed ids.

### B.5 Decision matrix — where the knowledge layer lives

| Criterion | (1) Thin layer on gbrain (recommended) | (2) Extend `pages` schema in place | (3) Separate knowledge graph DB |
|---|---|---|---|
| Local-only guarantee | Preserved — same DB, same process | Preserved | Preserved if also local, but a new DB is a new local-only surface to re-verify |
| Evidence traceability | Direct — `evidence[]` always points at a real `pages.slug` | Direct, but blurs "this is the document" vs "this is a claim about the document" in one row | Indirect — needs a sync/consistency layer between two stores |
| Security & classification enforcement | Item inherits + is checked against its cited page(s)' classification at read time — one enforcement point | Same enforcement point, but classification logic must special-case which rows are "raw" vs "derived" | Duplicate enforcement point; risk of the two stores disagreeing |
| Retrieval quality | No change to existing hybrid search; knowledge items are a thin index the app queries directly by id/type/status, not through gbrain's vector search | Risk of derived rows polluting hybrid search results (e.g. a draft decision ranking alongside real transcript evidence) unless heavily filtered | Best possible dedicated retrieval for knowledge items, but requires building a second retrieval path from scratch |
| Duplicate-content risk | None — items reference, never copy, content | Some — encourages copying summary text into new page rows | Highest — a graph DB tends to accumulate its own descriptive text |
| Auditability | Reuses `lib/review/model.ts`'s existing append-only decisions; one audit trail | Same reuse is possible but harder to keep clean alongside raw ingestion rows | Needs its own audit trail parallel to the existing one — divergence risk |
| Operational complexity | Lowest — one new table/JSON store, no new service, no new schema migration of vendored `packages/brain` | Medium — requires ALTERing or forking the vendored `schema.sql`, contradicting `AGENTS.md`'s "don't casually modify" rule | Highest — new datastore, new backup/retention/security review surface |
| Compatible with current pilot | Yes — additive, no migration of existing rows | Requires a migration of the vendored schema before the Lirem pilot | Requires provisioning and hardening a new datastore before the pilot |
| Future multi-tenant needs | Neutral — item's `sourceWorkspace`/`classification` fields already carry what multi-tenant enforcement would need | Neutral | Neutral, but the second store doubles the future tenant-isolation surface |
| Onboarding/takeover & meeting-derived support | Directly designed for it — meeting analysis drafts and takeover packs are both just `KnowledgeItem` queries by type/relation | Workable but the "is this a real document or a claim" ambiguity gets worse as more derived types are added | Workable, but the highest cost for the least differentiated benefit at V1 scale |

**Recommendation: Option 1 — a lightweight governed knowledge-item layer on
top of existing gbrain source records.** It is additive (no migration of the
vendored, do-not-casually-modify `schema.sql`), reuses the existing
`ReviewItem` audit trail and `canApprove()` gate verbatim, does not touch
hybrid search ranking, and is the option the meeting-publish-inbox spec's own
review-bridge design already implicitly assumes (a draft → `ReviewItem` →
materialized-page flow, which is exactly what `KnowledgeItem` formalizes and
generalizes past meetings alone).

Concretely: a new, small, owner-only-permissioned JSON or SQLite store (not a
schema change to `packages/brain`), e.g. `config/knowledge-items/*.json` or a
single `knowledge.sqlite`, holding `KnowledgeItem` rows exactly as typed in
B.3, keyed by `id`. This mirrors how `lib/review/` already persists reviews
today (`config/reviews.json`, written by `scripts/demo.ts`) rather than
inventing a new persistence pattern.

---

## Part C — Role-centred product experiences (V1)

All roles use the same `KnowledgeItem` store and the same `ReviewItem`
pipeline; only the queries and available actions differ. No separate
employee/manager data silo is introduced.

**Caveat that must be visible to whoever implements this (updated against
the pending per-member-auth design, A.9):** the concrete, near-term
authorization model on the table is binary — `admin | member`
(`2026-09-16-per-member-auth-design.md:258`), and that design's own route
matrix puts review submit/decide behind "any role" (A.9), matching
`lib/review/model.ts`'s existing lack of a reviewer concept (A.4). So:

- "Employee" and "Manager / team lead" below are **the same enforced role**
  (`member`) — they differ only in which saved queries/screens a person
  chooses to open, not in what the backend would let them do. A `member`
  is not technically prevented from opening the manager queue view in V1.
- "Administrator / knowledge steward" maps onto the design's `admin` role
  for the actions that already require it there (connector config, user
  management); the read-only aggregation views described below need no new
  permission tier beyond "authenticated."
- **Do not build Part C assuming a manager tier is enforced.** If review
  workload or knowledge-gap visibility later needs to be restricted to an
  actual subset of members, that is a new, separately-designed RBAC
  extension on top of the per-member-auth spec — not something this
  document should quietly assume into existence.
- Today, with neither design implemented yet, both "employee view" and
  "manager view" are unauthenticated *screens* in `scripts/demo.ts`, gated
  only by the single shared admin token (A.6) — the gap is worse than "no
  manager tier," it's "no login at all." That is the per-member-auth spec's
  problem to close, not this one's; this document only needs to build its
  query layer so that plugging in real sessions later is additive.

**Employee**
- Ask a question in plain language → existing Ask pipeline (`lib/eval/qa.ts`)
  answers with page-slug citations as today (this pipeline is under active
  revision on this branch — uncommitted changes at the time of writing widen
  candidate recall and add source dates to the prompt; they do not change
  the slug-citation convention this spec builds on); additionally, when a
  matching `approved` `KnowledgeItem` exists, its title/description is
  surfaced first with a "verify source" link that resolves to its
  `evidence[]` pages.
- Browse by category (the 8 types in B.2) and by `sourceWorkspace`, filtered
  to items whose `classification` the employee's workspace access permits
  (today: connector `subdir` scoping; see Part E for the real gap here).
- "Flag as outdated" and "Request missing knowledge item" both create a new
  `draft` `KnowledgeItem` (`origin: "human-authored"` for a request with no
  content yet, or a system-authored `under_review` item that cites the
  existing item plus the flag reason) — never a silent edit to an approved
  item.

**Manager / team lead**
- A queue view over `KnowledgeItem`s filtered to: `status = under_review`
  (open decisions), `nextFreshnessReviewAt < now` and `status = approved`
  (stale/ownerless knowledge — "ownerless" specifically means `ownerId` is
  empty or points to a workspace rather than a named person), and
  `type = "meeting-derived"` with `status = draft` (unresolved action
  candidates awaiting review).
- Reviews proposed extractions through the **existing** review screen/flow —
  no new approval UI, just `ReviewItem`s whose `body` renders a
  `KnowledgeItem` draft.
- Requests a Takeover Pack (Part D) for a role/project/person, scoped to
  their own manager permissions over that workspace.

**Administrator / knowledge steward**
- Sees connector sync status (existing `sync-log.jsonl` + connector config),
  classification counts per workspace, retention state (existing
  `config/retention.json`), and review backlog size/age — all read
  aggregations over existing stores plus the new `KnowledgeItem` store, no
  new governance mechanism.
- Taxonomy/workspace mapping stays config-driven (`config/connectors.json`,
  the meeting spec's proposed `config/meeting-inbox.json` workspace list) —
  this document does not introduce a taxonomy editor UI.

---

## Part D — Takeover Packs

A Takeover Pack is **a saved query + a review gate**, not a new content type.

```ts
type TakeoverPack = {
  id: string;                 // "pack_" + UUIDv7
  scope: { kind: "role" | "project" | "person"; label: string; workspaceId: string };
  status: "draft" | "approved";      // approved = a human has read and signed off the assembled pack
  sections: Array<{
    heading: string;                 // "Purpose", "Open decisions", "Key contacts", etc.
    itemIds: KnowledgeItemId[];      // only approved KnowledgeItems may populate a section
    narrative: string;               // model-drafted connective prose — always labeled draft until pack.status = "approved"
    unresolved: string[];            // explicit "what remains unknown" bullets — never silently omitted
  }>;
  generatedAt: string;
  approvedBy?: string;
  approvedAt?: string;
};
```

Rules directly satisfying the assignment's requirements:

- **No fabrication:** a section may only cite `KnowledgeItem`s that already
  exist with `status = "approved"`. If a required section (e.g. "current
  decisions") has zero approved items, the pack states that plainly in
  `unresolved`, it does not generate placeholder content.
- **Draft until approved:** `narrative` text is generated but the whole
  `TakeoverPack.status` starts `"draft"`; nothing is handed to the incoming
  person until a named manager sets `status = "approved"` — this reuses the
  same human-gate pattern as `ReviewItem`, but a pack-level gate rather than
  routing every pack through the general review queue (a pack is an
  assembly of already-approved items, not new AI-assisted output going
  external, so it does not need the six-check `ReviewItem` flow — it needs
  one named sign-off that the assembly is correct and complete).
- **Citations preserved:** every `itemIds` entry keeps that `KnowledgeItem`'s
  own `evidence[]` reachable from the pack UI — two hops back to raw
  evidence, never flattened into unsourced prose.
- **Least privilege:** pack assembly is filtered by the same
  `classification`/workspace rules as Part C's employee browse view before
  the new employee ever sees it — a pack cannot leak confidential items into
  a broader audience than the underlying items already permit.
- **Not a surveillance feature:** a pack is built only from `KnowledgeItem`s
  that already went through approval for other reasons (policies,
  decisions, procedures, project context) or that a manager explicitly
  selects into scope. It contains no behavioral data — no query logs, no
  access history, no "how often did this person use X" signal.

---

## Part E — Meeting-derived knowledge and coordination support

This section maps the meeting-publish-inbox spec's `MeetingAnalysisDraftV1`
(already fully specified, not repeated here in full) onto `KnowledgeItem`:

- `candidateDecisions[]` → one `KnowledgeItem` each,
  `type: "decision_rationale"`, `origin: "model-suggested"`,
  `status: "draft"`, `evidence` built from each `EvidenceRef.segmentId`
  resolved to the meeting's gbrain page slug + excerpt.
- `candidateOpenActions[]` → `type: "meeting_derived_action"`,
  same origin/status pattern; `ownerId` is left blank unless the meeting
  spec's own rule is honored — **owner is only set when explicitly stated in
  the transcript** (`MeetingAnalysisDraftV1.candidateOpenActions[].owner`
  already encodes this constraint; the knowledge layer must not infer one).
- `meetingNecessityReview` → **not** a `KnowledgeItem` on its own. It stays
  exactly what the meeting spec already defines it as: a review-queue
  question attached to the meeting's `ReviewItem`, phrased as the example in
  the assignment ("Would the meeting owner like to review its purpose,
  frequency, or attendee list?"). No automation may act on it — this
  document adds no new capability here, it inherits the meeting spec's §10
  and §11.3 constraints verbatim (no cancellation, no calendar mutation, no
  external notification without going through the existing approval-gated
  `mutate`/`create-isolated` policy tiers).
- Every one of these `KnowledgeItem`s enters review exactly once — as part
  of the single `ReviewItem` the meeting spec already defines per meeting
  (§11.2) — not as N separate review items per candidate. On approval, only
  the reviewer-approved subset is materialized (mirrors the meeting spec's
  own "approval materializes only the reviewer-approved subset" rule,
  §11.2) — the knowledge layer adds no second approval path.
- Recurring-meeting review prompts ("this recurring meeting has no approved
  unresolved actions/decisions across recent meetings") are a **query**, not
  a new stored type: `KnowledgeItem`s of `type: meeting_derived_*` and
  `relations: [{type: "part_of", targetId: <seriesId>}]` (using the meeting
  manifest's optional `recurrence.seriesId`) grouped and counted. If the
  count across the recent window is zero, the Manager view (Part C) surfaces
  the review prompt — worded exactly as the assignment specifies, never as a
  declarative judgment about the meeting or its attendees.

---

## Part F — Implementation roadmap (tasks only; no code authorized here)

Each task is independently testable and, unless stated otherwise, does not
require changing the Local Meeting Transcriber.

**Task 1 — `KnowledgeItem` type + pure model module**
- Files: new `lib/knowledge/model.ts` (types from B.3, pure functions
  mirroring `lib/review/model.ts`'s style: `newKnowledgeItem()`,
  `canApproveKnowledgeItem()`, `recordFreshnessCheck()`).
- Migration/compat: none — additive, no existing data touched.
- Security/privacy: none yet — no I/O, no new attack surface.
- Tests: pure unit tests mirroring `lib/review/model.ts`'s existing test
  style (state transitions, `canApprove` gating, append-only history).
- Acceptance: a `KnowledgeItem` cannot reach `approved` without ≥1 evidence
  anchor and a recorded human decision; rejected items retain full history.
- Local Meeting Transcriber: not touched.

**Task 2 — Persistence layer**
- Files: new `lib/knowledge/store.ts` (owner-only JSON files under
  `config/knowledge-items/`, following the same atomic-write pattern already
  used for `config/reviews.json`/`config/connectors.json`).
- Migration/compat: none — new directory, empty at first run.
- Security/privacy: file permissions must match the existing `0600` pattern
  used elsewhere in this repo (per AGENTS.md and the meeting spec's
  precedent); no secrets are stored here, only references to page slugs.
- Tests: crash-safety (atomic write, no partial file), concurrent-write
  rejection or serialization.
- Acceptance: a store write either fully succeeds or leaves the prior file
  intact.
- Local Meeting Transcriber: not touched.

**Task 3 — Freshness/staleness sync job**
- Files: new `lib/knowledge/freshness.ts`, invoked from the existing sync
  entrypoint (wherever `appendSyncLog`/`scripts/demo.ts:676-712` is called
  today) — read-only against `pages.updated_at`/`deleted_at`/`generation`.
- Migration/compat: none — reads existing `packages/brain` tables, no schema
  change to the vendored package.
- Security/privacy: read-only; must not log page content, only slugs/ids.
- Tests: fixture with a page updated after a `KnowledgeItem`'s
  `lastReviewedAt` → item flips to `under_review` with a system note; a page
  unchanged → no transition.
- Acceptance: staleness detection never silently keeps an item `approved`
  past a cited page's deletion.
- Local Meeting Transcriber: not touched.

**Task 4 — Review-bridge for Ask/manual knowledge drafting**
- Files: new `lib/knowledge/review-bridge.ts`, wiring `KnowledgeItem` drafts
  into `lib/review/model.ts`'s `newReview()`/`recordDecision()` exactly as
  the meeting spec's §11.2 already specifies for meetings; on `approved`,
  writes back `KnowledgeItem.status = "approved"` and appends to
  `reviewHistory`.
- Migration/compat: none.
- Security/privacy: reuses existing review-audit guarantees; no new PII
  surface.
- Tests: an approved `ReviewItem` must produce exactly one matching
  `KnowledgeItem` status update; a `revise`/`rejected`/`escalated` verdict
  must never flip `KnowledgeItem.status` to `approved`.
- Acceptance: knowledge items can only become `approved` via a recorded
  `Decision`, never by direct write.
- Local Meeting Transcriber: not touched.

**Task 5 — Meeting-analysis → `KnowledgeItem` adapter** (depends on the
in-flight meeting work's still-unbuilt `lib/meetings/analysis.ts` landing
first, per A.8)
- Files: new `lib/knowledge/from-meeting.ts`, mapping
  `MeetingAnalysisDraftV1` → `KnowledgeItem[]` per Part E.
- Migration/compat: none — purely additive once the analysis worker exists.
- Security/privacy: must preserve the meeting spec's constraint that no
  speaker/participation inference ever enters a `KnowledgeItem` field.
- Tests: reuse the meeting spec's own planned fixtures (§17 items 9–12 in
  the meeting spec) to prove the adapter cannot invent an owner, date, or
  necessity judgment beyond what the draft already asserts.
- Acceptance: every produced `KnowledgeItem` traces to a valid
  `EvidenceRef`; no item is created for a signal with no evidence.
- Local Meeting Transcriber: not touched (this task only consumes Tako-side
  output).

**Task 6 — Employee/Manager/Admin query views**
- Files: read-only query functions in `lib/knowledge/queries.ts`; UI wiring
  is out of scope for this document (separate frontend spec once this
  foundation is approved).
- Migration/compat: none.
- Security/privacy: **must not ship without at least a documented interim
  access check** — see Risk E.1 below; do not silently rely on `subdir`
  scoping being real access control.
- Tests: query-filter correctness (status, type, freshness, ownerless
  detection) against fixture data.
- Acceptance: each of the three role views in Part C returns the specified
  filtered set against a known fixture store.
- Local Meeting Transcriber: not touched.

**Task 7 — Takeover Pack assembly**
- Files: `lib/knowledge/takeover-pack.ts` (pure assembly + narrative-draft
  hook), reusing Task 4's review-bridge pattern for the pack-level approval
  gate described in Part D.
- Migration/compat: none.
- Security/privacy: pack assembly must re-check each item's classification
  against the requesting scope at assembly time, not just at item-approval
  time (classification of the underlying evidence could theoretically be
  revised later).
- Tests: a pack with zero approved items in a section renders "unresolved,"
  never fabricated narrative; a pack cannot include a `confidential` item for
  an out-of-scope requester.
- Acceptance: matches all Part D rules.
- Local Meeting Transcriber: not touched.

---

## Checkpoint

**Verified current-state findings:** Connectors normalize into
frontmatter-tagged Markdown, not typed records, with no shared interface;
gbrain's `pages`/`content_chunks` schema has no document-level classification,
ownership, or provenance columns — that data lives only in unstructured
frontmatter; citation today is page-slug-based with no dedicated anchor
table; classification enforcement (`lib/govern/policy.ts`) is wired only into
the MCP connector path, not into ingestion or Ask/retrieval; the review model
(`lib/review/model.ts`) is a clean, pure, append-only, role-agnostic state
machine already well-suited to extension; there is no employee/reviewer/admin
role separation anywhere in the running demo; the meeting-publish-inbox work
is substantially built (package contract through import) but its analysis
worker and review-bridge are not yet written, which is exactly where this
knowledge layer is designed to plug in.

**Proposed Company Brain V1 model:** An 8-category `KnowledgeItem` (Part B.2)
with a fixed, fully-specified metadata contract (Part B.3) that never copies
source content — it only cites gbrain page slugs — and that can only reach
`approved` through the existing `lib/review/model.ts` state machine, never
through retrieval frequency, model confidence, or direct write.

**Recommended implementation approach and why:** Option 1 — a lightweight
governed knowledge-item layer stored alongside (not inside) `packages/brain`,
reusing the existing review, audit, and classification primitives verbatim.
It requires no migration of the vendored gbrain schema, adds no second
retrieval path, and is the option the meeting-publish-inbox spec's own
draft-to-review design already assumes exists.

**Important risks and unanswered product decisions:**
1. **No real role enforcement exists today, and the concrete plan to add it
   (per-member-auth-design, A.9, pending approval) is a two-tier `admin |
   member` model, not three tiers.** Part C is written to match that design
   rather than invent a manager tier that isn't on the roadmap — its
   "employee" and "manager" views are query scopes on the same `member`
   role, not separate trust boundaries, until a further RBAC extension is
   separately designed. Implementing Task 6 ahead of the auth spec landing
   would repeat the same "policy statement presented as evidence" failure
   `docs/COMPANY_SECURITY_BASELINE.md` warns against.
2. **Classification enforcement is not yet wired to ingestion or Ask/
   retrieval at all**, and the pending per-member-auth design independently
   confirms this from the authorization side: it explicitly scopes
   "source authorization — which indexed documents a specific person may
   retrieve" as **not built** (A.9). The knowledge layer's classification
   field is only as trustworthy as whatever eventually enforces both of
   these gaps on the base `pages` an item cites — this predates and is
   broader than this spec, and this spec does not close it.
3. **Open product decision:** should `KnowledgeItem` freshness intervals
   (B.4.4) be configurable per workspace/category from day one, or fixed
   defaults until a real customer (Lirem) signals a need? This spec assumes
   fixed defaults to avoid inventing an unused configuration surface.
4. **Open product decision:** should a rejected `KnowledgeItem` be
   resubmittable as a new draft citing the same evidence, or must it stay
   terminal like `ReviewItem.rejected` today? This spec currently inherits
   the terminal behavior from `lib/review/model.ts` without modification;
   revisiting it is a governance decision, not an engineering one.
5. **Dependency risk:** Task 5 depends on the meeting-analysis worker
   (`lib/meetings/analysis.ts`) landing on the meeting-publish-inbox branch
   first; this document does not assume or require changes to that branch.

**Proposed implementation task sequence:** Task 1 (model) → Task 2
(persistence) → Task 4 (review-bridge, generalized) → Task 3 (freshness sync)
→ Task 6 (query views) → Task 5 (meeting adapter, once upstream work lands)
→ Task 7 (Takeover Packs, last, since it composes everything above).

**Confirmation:** No product code was written or modified, no packages were
installed, nothing was deployed, no credentials were touched, and no file on
`experiment/graflow-local-orchestration`, `design/meeting-publish-inbox-plan`,
or `feat/meeting-publish-inbox` was changed. Only this new specification file
was created, in the main `tako` worktree on
`feature/connector-credentials-and-categorization`.

Stopping here for review, as instructed.
