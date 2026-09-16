# Taskboard — feat/brain-foundation

Updated 2026-08-28. Read `cowork/HANDOFF.md` first. Detail: `docs/OMNIBRAIN_PARITY.md`.

## Done (committed)

- [x] OmniBrain onboarding screen 4 — local scope builder with source-tree
      counts, Included/Excluded preview, shared-source warnings, persisted
      definitions, and review-only GBrain realisation plans. `npm run
      scope:build`; `docs/OMNIBRAIN_ONBOARDING.md`.
- [x] OmniBrain onboarding screen 5 — `scripts/console.ts` renders configured
      scope cards with grants, boundaries, members and sync state, then hands
      the selected scope to the existing invite/revoke flow. Raw source cards
      remain as the no-scopes fallback. `docs/DEPARTMENT_CONSOLE.md`.
- [x] OmniBrain gap #2 — pure per-step skill receipts verify actual reads
      against approved skill `reads:` and the effective scope, with deterministic
      Markdown rendering. The skill executor now parses reviewed procedures,
      enforces scope grants before execution, injects retrieve/extract work, and
      emits verified receipts. `lib/skills/run.ts`; `docs/SKILLS.md`.
- [x] `omnibrain skills` — read-only inventory of parsed skills, declared reads,
      and the configured scopes that grant every required source.
- [x] Read-only workers — UTC daily/weekly/interval scheduling composes reviewed
      skills with realised scopes, runs only against granted local sources, and
      persists output plus receipts to a human-approval queue. No delivery path
      exists. `npm run workers:run`; `omnibrain workers`; `docs/WORKERS.md`.
- [x] `bin/omnibrain` thin local dispatcher — one front door for connectors,
      sync/embed with serve restart, ask, console, scopes, evaluation, serve,
      and read-only status. Always uses `~/.aletheia-brain`. `docs/CLI.md`.
- [x] Continuous sync runner — connector scheduling with per-connector
      intervals, capped failure backoff, atomic local state, overlap lock,
      JSONL actions, and serve-safe source sync/embed. `omnibrain sync
      --watch` or `--once`; `docs/CONTINUOUS_SYNC.md`.
- [x] Vendor `garrytan/gbrain` (MIT) → `packages/brain/`.
- [x] Brain at `~/.aletheia-brain` (option A: `ollama:bge-m3` + `qwen*`). `docs/BRAIN_SETUP.md`.
- [x] gbrain admin console = product surface, built + verified at `/admin`. `docs/CONSOLE_SETUP.md`.
- [x] Notion connector — live-verified (columns, prune, incremental).
- [x] Slack connector — live-verified (threads, markup resolution, permalinks).
- [x] Local-notes connector — built + tested (not yet live-run).
- [x] Local OCR — Drive images and image-only PDFs are converted to searchable
      text with Tesseract.js, a bundled English traineddata package, explicit
      local-only language paths, timeout/failure fallback, and `OCR_ENABLED=0`.
      `docs/BRAIN_CONNECTORS.md`.
- [x] CAD operations wiring — `connectors:all`, `omnibrain connect cad`, and
      continuous sync run the read-only CAD metadata snapshot across every
      configured `cad.systems` entry on a 900-second default interval. The old
      `solidworks` connector alias was retired 2026-09-02 in favour of one
      registry (`lib/connectors/registry.ts`). `docs/BRAIN_CONNECTORS.md`.
- [x] Shared `pruneStale(dir, subdir, keep)`; 21 tests pass.
- [x] Cross-source `gbrain think` verified (Notion + Slack, cited).
- [x] OmniBrain demo watched frame-by-frame → `docs/OMNIBRAIN_PARITY.md`.

## PARKED (do not delete / extend)

- `app/(projects)/` bespoke dashboard + `cowork/handoff/case-state-contract.ts`.

## Next (parity roadmap, in order)

- [x] 1. **Multi-brain / scopes** — `shared`, `engineering`, and
        `personal-notes` sources registered; scoped read clients and thin-client
        isolation verified. See `docs/MULTI_BRAIN.md`.
- [x] 2. **Google Drive connector** — git-backed Drive text/Google Docs
        collection with config-driven OAuth access token and folder allow-list.
        Live-verified: Google Docs/Slides + .txt/.md + PDF (unpdf) + DOCX (mammoth). Incremental cursor, per-file timeout, incremental write. PDF slow on JP CID fonts.
- [x] 3. **Continuous sync** — optional-safe `connectors:all`, connector-aware
        daemon/cron runner with backoff, multi-source `sync:watch`, and
        autopilot operations documented in `docs/CONTINUOUS_SYNC.md`.
- [x] 4. **Rules** — 5 `_*-rules.md` in `brain-sources/shared/skills/`, synced + searchable. `docs/RULES.md`.
- [x] 5. **Skills** — `project-status` + `weekly-digest` + RESOLVER in `brain-sources/shared/skills/`, synced + searchable. `docs/SKILLS.md`.
- [x] 6. **Department dashboard + invite flow** — `scripts/console.ts` (`npm run console:serve`): brain cards (docs/skills/rules/members/sync), invite → `register-client`, members table → `revoke-client`. Live-verified. `docs/DEPARTMENT_CONSOLE.md`.
- [ ] 7. **(hosted only)** OAuth source-connect + data-region.

Also outstanding from before: cross-tool person/entity resolution; a set of saved
questions. Fold these into #4 / #5.

## Ground rules

- Security **option A**: no ingested content to any hosted API. Local models only.
- Always `export GBRAIN_HOME="$HOME/.aletheia-brain"`. Never touch `~/.gbrain/`.
- `packages/brain/` vendored — build on top, don't edit.
- Config-driven only. `npm test` + `npm run build` green before each commit.
- Owner supplies live tokens via gitignored `config/connectors.json`.

## Cross-requests

- Google Drive connector (#2) needs a Drive OAuth token or service-account JSON
  from the owner, scoped to the folders to ingest.

## Notes

- `codex exec` hung twice here — prefer building directly; if delegating, scope
  tight, `< /dev/null`, kill if stalled >5 min. Codex sandbox also blocks
  `.git/index.lock` and long-lived ports.

---

## Codex brief — adopt the MCP iPaaS governance contract (increment 1)

**Status: complete (2026-08-31).** Manifest/policy validation, governed MCP
reads with local redaction and JSONL audit, the 24-row curated industrial
register, and the demo catalog endpoint/UI are implemented. Operator contract:
`docs/MCP_GOVERNANCE.md`. The Foundation wave remains explicitly out of scope.

Context: `docs/mcp-ipaas/` (blueprint pack the owner supplied). We already have a
read-only MCP source connector (`lib/connectors/mcp/`), Intent-Merit Review
(`lib/review/`), redaction (`lib/govern/redact.ts`), scopes (`lib/scopes/`). This
increment upgrades the naive MCP connector to *manifest-declared, policy-gated,
audited* — the actual product differentiator. Do NOT build the multi-tenant
control plane / Windows edge agent / secret vault — that's the separate Foundation
wave in `docs/mcp-ipaas/CLAUDE_BUILD_HANDOFF.md`.

Deliver, in small reviewable commits on `feat/brain-foundation`:

1. **lib/govern/manifest.ts** (pure) — TypeScript types for the connector
   manifest + a validator that mirrors `docs/mcp-ipaas/connector-manifest.schema.json`
   (subset that matters: `id`, `version`, `domain`, `provenance.{license,
   licenseApproved,revision}`, `execution.{placement,transport,command|endpointRef}`,
   `auth.{type,secretRefs}` (reject any literal secret — must match `^secret://`),
   `capabilities`, `tools[]` with the risk overlay). Enforce the conditional rules:
   `enabledByDefault` must be `false`; `risk:destructive|physical-control` ⇒
   `approval:"always"` & `maxAttempts:1`; `risk:mutate|destructive` ⇒
   `checkpointRequired` & `verificationRequired`. `validateManifest(obj) ->
   { ok, errors[] }`. Tests: the sample manifest passes; a literal secret, a
   mutable version, `enabledByDefault:true`, and a destructive tool with
   `approval:"policy"` each fail.

2. **lib/govern/policy.ts** (pure) — `evaluate(input) -> { decision:
   "allow"|"deny"|"approval-required", reason }` where input = `{ tool:
   ToolPolicy, args: unknown, scope: { name, readSources[] }, dataClass:
   "public"|"internal"|"confidential"|"restricted"|"export-controlled", env:
   "dev"|"prod" }`. Rules from blueprint §6: `read` ⇒ allow if the tool's
   `dataClassifications` includes `dataClass` and the connector's domain source is
   in `scope.readSources`; `create-isolated` ⇒ `approval-required` (never
   overwrite prod); `mutate` ⇒ `approval-required`; `destructive` /
   `physical-control` ⇒ `deny` (this product is read-first). Unknown tool ⇒ deny.
   Tests cover each branch + the data-classification gate + the scope gate.

3. **lib/connectors/mcp/govern.ts** — wrap `McpClient` so each `resources/read`
   (and any future tool call) runs: freeze the tool's input schema hash →
   `policy.evaluate` on the actual args → deny/approval short-circuits (record a
   `blocked` item, don't fetch) → on allow, fetch → `redact()` the result text
   (from `lib/govern/redact.ts`) before it's returned → emit an audit line
   `{ ts, connector, tool, uri, decision, reason, resultHash, redactionHits }`.
   For the current read-only connector every `resources/read` is a `read` tool, so
   most are `allow`; the wiring is what matters. Return the audit lines from
   `collectMcp` so `run.ts` can write them to
   `brain-sources/<subdir>/mcp/_audit.jsonl`. Tests use the in-memory fake server
   from `tests/connectors-mcp.test.ts`.

4. **config/industrial-connectors.json** — convert
   `docs/mcp-ipaas/industrial-connectors.catalog.yaml` to JSON (24 entries:
   id, label, domain, executionPattern, riskCeiling, proposedWave, evidence,
   note). `scripts/mcp-catalog.ts` should merge this curated list in and mark
   entries we can reach (`connectUrl` or a local command) — it takes precedence
   over the scraped mcpvault rows. Add `npm run` nothing new; just read it.

5. **scripts/demo.ts — 接続 screen**: under the MCP card, render the industrial
   catalog grouped by domain (cad / plm / cae / erp / mes / qms / ot) with each
   entry's risk ceiling + wave + a ● if it's built here (cad, mcp-generic) / ○ if
   catalog-only. New endpoint `/api/mcp-industrial` (cached) reading
   `config/industrial-connectors.json`. Keep it read-only display; no new writes.
   Follow the existing "The Register" CSS (ledger rows, ◯/△/× marks, no accent
   side-borders — the impeccable detector will flag those).

6. Update `docs/SKILLS.md`? no — add `docs/MCP_GOVERNANCE.md` describing the
   manifest + policy + audit flow and how it maps to the blueprint. Update
   `cowork/HANDOFF.md` CURRENT STATE.

Run `npm test` (add the new test files to package.json "test") and
`node ~/.claude/skills/impeccable/scripts/detect.mjs --json scripts/demo.ts`
after the demo edit. Do NOT touch `packages/brain/`, `lib/eval/qa.ts`,
`lib/review/model.ts`, `lib/tasks/`.

---

## Codex brief — Yoom-style UI/UX pass on the demo interface (2026-09-01)

**Ask (from user):** make the prototype interface "like Yoom". Yoom is the UX
benchmark for *an iPaaS a non-engineer can operate*. We adopt its information
architecture and interaction model — NOT its plush-mascot visual skin, and NOT
its "automate doing" semantics. Tako stays "govern knowing": every outward
step is a proposal a human approves.

Codex cannot reach the tab open in the user's browser (Chrome extension not
connected). What Claude saw on yoom.fun / lp.yoom.fun, use as reference:

- **Hero = a single prompt box.** "どんなAI社員がほしいですか?" — one big rounded
  input with mic + send. You describe the outcome in plain language; the system
  proposes a flow. Ours: "何を知りたい / 何を自動提案してほしいですか?" → returns a
  proposed **skill + scope + schedule**, never a running automation.
- **Flow shown as a vertical chip stack:** trigger → step → step → "担当者に確認
  依頼" (ask a person to confirm). Yoom always ends outward actions on a human
  check. Keep that; make the final "人間の承認" chip non-optional and visually the
  anchor of every flow.
- **連携アプリ一覧 (integrations catalog):** left rail of categories
  (業務一般 / チャットツール / 会計・経理 / 人事・労務 / セールス / ファイル管理 …) +
  search, main area = grid of rounded white cards, each logo + name. A muted
  "この サービスの連携を希望" affordance for anything not listed. This is the model
  for our **接続 / Connect** screen — regroup the existing connector + CAD + MCP +
  industrial-catalog cards into this catalog layout.
- **Templates gallery:** pre-built flows by department. Ours = the reviewed
  skills library (`omnibrain skills`) surfaced as a gallery you can preview and
  "この手順を提案として取り込む".
- **Visual:** light, generous whitespace, one accent, black pills for primary
  actions, Noto Sans JP. Friendly but not childish.

**Visual reconciliation — decide and write it down.** The current demo is "The
Register" (台帳): austere accounting ledger, `#F6F2E9` stock, vermilion margin
rule, `◯/△/×`, no accent side-borders (the impeccable detector flags those).
That aesthetic *is* the governance argument. Options:
  a) keep The Register palette/type, adopt only Yoom's IA + prompt-first flow;
  b) warm The Register up — same ink/vermilion/indigo tokens, more whitespace,
     rounded cards, lighter rules — a "ledger you'd enjoy using".
Recommend (b). Do NOT ship Yoom's mascots, gradients, or bubble-logo hero.

**Progress (Claude, 2026-09-01, commit 1534149f):** items 1 and 2 below are
DONE — `scripts/demo.ts` now has a prompt-first `ホーム / HOME` screen (default)
with the governed flow-chip stack + mandatory 人間の承認 anchor + shortcut cards,
and the Connect screen is a Yoom-style catalog (category rail + search + card
grid + config panel). Detector clean, 148 tests pass. Remaining for Codex:
items 3 (Skills gallery → "取り込む(提案として)" producing a review item) and any
deeper visual warming. Items 4–5 already satisfied by the Home flow chip and
the catalog fold-in.

**Scope of work**
1. [DONE] `scripts/demo.ts` — restructure the section nav around the Yoom IA:
   `ホーム(prompt-first)` / `接続` / `質問` / `スキル(gallery)` / `作業メモリ` /
   `レビュー` / `アクセス`. Home screen = the single prompt box + a live example
   flow-chip stack + shortcuts into the other screens.
2. Connect screen → catalog layout (left categories + search + card grid),
   folding the existing connector / CAD / MCP / `/api/mcp-industrial` data in.
   No new write paths; keep `DEMO_READONLY` honoured.
3. Skills screen → gallery cards with a "取り込む(提案として)" action that produces
   a review item, not an execution.
4. Every flow visualisation ends on a mandatory "人間の承認" chip.
5. Keep it bilingual (Japanese primary, English line under each label) — the
   user asked for this earlier and it stays.
6. Run `npm test` and
   `node ~/.claude/skills/impeccable/scripts/detect.mjs --json scripts/demo.ts`
   after each demo edit; detector must stay clean (no side-tab accent borders).

**Do NOT touch:** `packages/brain/`, `lib/eval/qa.ts`, `lib/review/model.ts`,
`lib/tasks/`, `lib/connectors/cad/`, `tools/fusion-export/`. Bilingual copy and
the human-approval line are hard requirements, not suggestions.

---

## Codex brief — VISUAL redesign of the demo, referencing Yoom (2026-09-01, supersedes visual direction above)

User feedback on Claude's pass (commit 1534149f): **"that UI doesn't look
nice."** The IA is right (prompt-first Home, catalog Connect, mandatory
人間の承認 chip) — keep it. The **visual execution is not good enough** and is
now Codex's to own. Run the `impeccable` skill properly for this
(`/impeccable` → refine or bolder on `scripts/demo.ts`); give it the full pass,
not a quick polish.

### What's wrong with the current pass (fix these)
- Flow chips are flat grey boxes that wrap awkwardly; the arrows float. It reads
  as a wireframe, not a designed diagram.
- Catalog cards are the generic "letter-in-a-rounded-square + name" pattern —
  the exact lazy-card look. The logo tiles are fake (first letter of the label).
- The Home hero is just stacked text + an input; no composition, no focal point.
- The "warmed Register" is half-committed: border-radius bolted onto an
  otherwise austere ledger. Either commit to a warm identity or commit to the
  ledger — not both at 50%.
- Overall: timid. Spacing is even everywhere, no hierarchy of emphasis.

### Yoom as reference — Codex must look at it directly
Claude cannot see the tab open in the user's browser (no Chrome-extension
bridge), and neither can Codex. Use the **public** surfaces — they carry the
same design language:
- `https://lp.yoom.fun/` — hero: one big rounded prompt box ("どんなAI社員が
  ほしいですか?"), example-flow chips floating to the right, plush mascots (do
  NOT copy the mascots), black pill CTAs.
- `https://lp.yoom.fun/apps` — the integrations catalog: **this is the model for
  our Connect screen.**
Open them with your browser tools / WebFetch and study the real spacing, we
ights, and card treatment before touching CSS. If you need the user's exact
logged-in view, ask them to paste a screenshot into the repo at
`cowork/refs/`.

### Yoom visual spec (from Claude's capture, 2026-09-01)
- **Ground:** white `#FFFFFF` cards on a very light cool-grey page (~`#F5F6F8`);
  the hero band is a slightly lighter grey with a faint swoosh graphic.
- **Type:** Noto Sans JP. Headings are *black weight* (700–900) and large;
  body is regular. Big jump between heading and body — real hierarchy.
- **Primary action:** solid near-black, fully-rounded pill.
- **Search field:** full-width pill, ~10–12px radius, 1px `#E8EAED` border,
  magnifier icon inset left, grey placeholder, generous height (~52px).
- **Category rail:** plain bold-text list, no boxes/chrome, ~36–40px vertical
  rhythm; active item just darker/heavier.
- **App cards:** white, ~12px radius, 1px hairline `#E8EAED`, **almost no
  shadow** (a whisper on hover only), real logo ~24px left + name mid-weight in
  one row. 3-up grid, ~12–16px gap. Calm, not busy.
- **Accent:** ONE friendly blue (~`#2D6DF6`), used sparingly — links, one
  floating "connect request" affordance. Everything else is black/grey/white.
- **Feel:** airy, calm, lots of white, soft corners, minimal borders. Friendly
  through space and roundness, never through color or illustration.

### The reconciliation to make (write it into a short comment at top of the PAGE block)
Tako is a governance product; Yoom is an automation product. Borrow Yoom's
**calm, airy, high-whitespace, soft-card layout language** but keep Tako's
own accent identity — do NOT adopt Yoom's blue. Options, pick one and commit:
  a) Warm ledger — cream/off-white ground, Noto Serif JP display, vermilion as
     the single accent, Yoom's spacing + card calm. (recommended)
  b) Clean neutral — near-white ground like Yoom, but vermilion accent + serif
     display keep it Tako. 
Either way: real hierarchy, one focal point per screen, generous whitespace,
proper hover/focus/empty states. Keep `◯/△/×` marks and the receipt/audit
language — that's product truth.

### Hard constraints (unchanged)
- Bilingual: Japanese primary, English gloss under each label.
- Every outward-flow visual ends on a non-optional 人間の承認 / HUMAN APPROVAL step.
- `DEMO_READONLY` still disables all writes; no new write paths.
- Do NOT touch: `packages/brain/`, `lib/eval/qa.ts`, `lib/review/model.ts`,
  `lib/tasks/`, `lib/connectors/`, `tools/fusion-export/`.
- After each demo edit: `npm test` (148 baseline) and
  `node ~/.claude/skills/impeccable/scripts/detect.mjs --json scripts/demo.ts`
  — detector must stay clean (no accent side-borders, no gradient text).
- Server: `npm run demo` → http://localhost:4400 . Verify Home + Connect +
  one Ask round-trip in a browser before committing.
