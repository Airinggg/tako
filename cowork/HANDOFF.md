# Baton pass — Tako → OmniBrain-style knowledge brain

## CURRENT STATE — 2026-08-31 (read this first)

Branch `feat/brain-foundation`. `npm test` → **146 pass**. Demo: `npm run demo` → :4400.

**Positioning shifted** (owner's call): Tako is now framed as a **governed iPaaS
for the engineering digital thread** — federate PLM / PDM / QMS / docs / chat
**read-only** via MCP, answer across them with citations, route outward AI outputs
through Intent-Merit Review + masking. Pricing: ZoikoVertex-style 4 tiers on a
governance-maturity axis (file: `positioning-pricing.html`, sent to owner).

**Built since the old handoff:**
- **Governed MCP iPaaS contract (increment 1)** — connector manifests are
  validated deny-by-default; actual reads pass scope/data-class/risk policy,
  local redaction, and hashed JSONL audit. Approval-required and denied calls do
  not reach upstream. `docs/MCP_GOVERNANCE.md`.
- **Industrial connector register** — 24 reviewed rows (22 supplied products +
  the built `cad` and `mcp-generic` adapters), merged ahead of public discovery.
  The demo 接続 screen groups them by domain with risk ceiling, wave, and ●/○
  reachability. `GET /api/mcp-industrial`.
- Demo app `scripts/demo.ts` — 7 sections: 概要 / 接続 / 質問 / スキル / 作業メモリ / レビュー / アクセス. All read the live brain; no brain mutations except the local config writes (Connect + Review intake).
- `lib/review/` — Intent-Merit Review (5 checks, verdicts, receipts). `lib/govern/redact.ts` — filtering/masking (block/mask/flag). Both pure + tested. Demo: **レビュー** section.
- `lib/tasks/` — working-memory triage (hot/warm/cold/noise, decay policy, rollup). Demo: **作業メモリ**.
- `lib/skills/{parse,run,run-live,receipt}` — skill executor with per-step receipts (Codex). Demo: **スキル**.
- `lib/workers/` — scheduled skill runs → approval queue (Codex).
- `lib/connectors/cad/` — read-only CAD metadata (SolidWorks / CATIA / NX), one export per system → `cad/<system>/…`. `npm run connectors:cad`.
- `lib/connectors/mcp/` — **generic read-only MCP source connector** (initialize + resources/list + resources/read; http + stdio transports). `config.mcp.servers`. `npm run connectors:mcp`.
- `lib/connectors/mcp/catalog.ts` + `scripts/mcp-catalog.ts` — API-first MCP ecosystem catalog + read-source/action classifier.
- `lib/connectors/drive` — local OCR added (Codex).
- Connect screen `scripts/demo.ts` writes `config/connectors.json` from a form (per-service + nested cad/mcp).
- `docs/mcp-ipaas/` — **the blueprint pack** (owner supplied): architecture, `connector-manifest.schema.json`, deny-by-default sample manifest, 24-app `industrial-connectors.catalog.yaml`, `CLAUDE_BUILD_HANDOFF.md`.

**NEXT for whoever picks this up:** increment 1 is complete. Before a live MCP
ingest, create a reviewed manifest with a `resources_read` policy for every
configured server and add its `manifest` path to `config/connectors.json`. The
full Foundation wave (multi-tenant control plane, Windows edge agent, secret
vault, durable CAE jobs) remains a separate larger build in
`docs/mcp-ipaas/CLAUDE_BUILD_HANDOFF.md`; do not infer it from this increment.

Fixed 2026-08-31: `lib/review/model.ts` + `tests/review-model.test.ts` were
never actually committed by `068642b1` (only the example configs were). Now
committed in `0da825f9`; `lib/govern/redact.ts` was similarly recovered by
`9b8bcd3d`. A fresh checkout of `feat/brain-foundation` is now coherent.

Known infra flakiness: gbrain `search` intermittently hangs/empties on this
machine; `gb()` in `lib/eval/qa.ts` caps it at 12s SIGKILL. Full `sync --full`
+ `embed --all` usually clears it.

---

Last updated 2026-08-29 by Claude. Branch: **`feat/brain-foundation`** (HEAD `e5056f84`).
**OmniBrain parity roadmap steps 1–6 are all done.** Step 7 (hosted-only OAuth +
data-region) is deliberately skipped for self-host. What's left is polish and a
real-data pass, not new architecture — see NEXT.
Any AI picking this up: read this file top to bottom, then `cowork/TASKBOARD.md`.

## Goal

A general **OmniBrain-style knowledge brain**: connect scattered tools (Notion,
Slack, Google Drive, local notes), run **local models only** over them (security
option A — nothing leaves the machine), get a brain + a scoped MCP endpoint that
agents (Claude Code, Codex, Cursor) plug into, and query it with citations via
`gbrain think`. The product surface is **gbrain's own admin console** at `/admin`.

**Not Lirem-specific.** Lirem (lirem.co.jp) is the first real customer / example.
Everything is config-driven — any workspace, any token. No hardcoded "Lirem".

Reference: OmniBrain is "gbrain for a company" (Xpress AI pitch, no public repo).
The build recipe is `packages/brain/docs/tutorials/company-brain.md`. Frame-by-frame
demo breakdown + full parity roadmap: **`docs/OMNIBRAIN_PARITY.md`**.

## Architecture (as built)

```
Notion / Slack / Drive / notes
  └─ lib/connectors/<tool>/run.ts   deterministic; NEVER interprets content
        writes Markdown + provenance frontmatter into
  brain-sources/<tool>/…            git-backed source dir (gitignored)
        └─ gbrain sources add + gbrain sync   →  ~/.aletheia-brain/.gbrain/brain.pglite
              embed: ollama:bge-m3      synth: ollama:qwen2.5:3b-instruct (--model flag)
        served by: gbrain serve --http :8787  →  /admin console + /mcp endpoint
```

- Isolated brain via `GBRAIN_HOME="$HOME/.aletheia-brain"`. **Never touch
  `~/.gbrain/`** (owner's personal brain).
- `packages/brain/` is vendored `garrytan/gbrain` (MIT, `git subtree`). Build on
  top; don't edit it. Rebuilding `admin/dist` is fine (reproducible).
- Config + tokens live in **gitignored** `config/connectors.json`
  (`config/connectors.example.json` is committed). `brain-sources/` is gitignored.
- The pre-pivot Tako app under `app/` is untouched. `app/(projects)/` (an
  earlier bespoke dashboard) is PARKED — don't delete, don't extend.

## DONE (all committed on `feat/brain-foundation`)

Roadmap steps **1–6 complete**. Step 7 (hosted-only) skipped for self-host.

- **gbrain vendored** `packages/brain/` (`1295e91c`).
- **Admin console** built + verified at `/admin`. `docs/CONSOLE_SETUP.md`.
  Login: set `GBRAIN_ADMIN_BOOTSTRAP_TOKEN` for local dev. `5a45673e`.
- **Brain** `~/.aletheia-brain`, Ollama `bge-m3` (embed) + `qwen2.5:3b-instruct`
  (synth via `--model`; `qwen3.5:9b` times out in `think`'s budget). `docs/BRAIN_SETUP.md`.
- **4 connectors**, all config-driven, git-backed-source model, incremental
  cursor + shared `pruneStale(dir, subdir, keep)`:
  - **Notion** `lib/connectors/notion/` — DB rows + pages, `## Properties` from
    columns, block flattening. Live-verified.
  - **Slack** `lib/connectors/slack/` — history + threads, `<@U>`/`<#C>`/`<url>`
    resolved, `chat.getPermalink`, per-channel cursor. Live-verified (`all-hestia`).
  - **Google Drive** `lib/connectors/drive/` — Google Docs/Slides + `.txt/.md` +
    **PDF (`unpdf`)** + **DOCX (`mammoth`)**. Per-file extraction timeout
    (`DRIVE_EXTRACT_TIMEOUT_MS`, default 45s) + incremental write (PDF is slow on
    JP CID fonts — ~30-60s each, doesn't scale to hundreds). Live-verified on a
    Google Doc and 6 lab-report PDF/DOCX.
  - **Local notes** `lib/connectors/notes/` — recursive folder walk of
    `.md/.markdown/.txt`. Built + tested, **not yet live-run** (needs a `notes`
    block with a real folder path).
- **Multi-brain / scopes** (`40e13651`) — sources `shared` / `engineering` /
  `personal-notes`, `subdir` per connector, server-enforced `--federated-read`,
  thin-client isolation check passed. `docs/MULTI_BRAIN.md`.
  NB: after re-registering a source, run `gbrain embed --all` (sync doesn't re-embed).
- **Continuous sync** (`d31816ee`) — `npm run connectors:all` (skips absent
  configs), `npm run sync:watch`, `docs/CONTINUOUS_SYNC.md`.
- **Rules** (`f2d03950`) — `brain-sources/shared/skills/_*-rules.md`:
  `_operating` (option A, human-in-loop), `_output` (cite everything, plain
  language), `_brain-filing`, `_excluded-people` (privacy gate),
  `_connector`. Synced into the shared brain. `docs/RULES.md`.
- **Skills** (`a92edbd3`) — `brain-sources/shared/skills/{project-status,
  weekly-digest}/SKILL.md` + `RESOLVER.md`. Read-only, cite-everything, synced +
  searchable (search hits `project-status` at 0.87). `docs/SKILLS.md`.
- **Department console** (`e5056f84`) — `scripts/console.ts` (`npm run
  console:serve`): per-source brain cards (docs / skills / rules / members /
  sync), an invite form → `gbrain auth register-client` (key shown once), a
  members table → `revoke-client`. Live-verified. `docs/DEPARTMENT_CONSOLE.md`.
- **25 tests pass** (`npm test`), build green. Each connector: fixture-based offline tests.
- **Brain state**: `shared` = 16 pages (1 Notion + 1 Drive Doc + 6 Drive PDF/DOCX
  + 5 rules + 2 skills + RESOLVER), `engineering` = 1 (Slack), all embedded.
  Cross-source cited `think`/`search` verified.

## Evaluation harness — BUILT + baselined

`npm run eval -- synthetic`. Scorer + runner + 7-project bilingual synthetic set,
scratch brain, security-guarded (rejects persistent homes, strips hosted keys).
**Baseline (qwen2.5:3b, local, retrieve-then-extract):** owner 1.00, stage 1.00,
overdue/dropped recall 0.80, decisions 0.60, grounding 0.84, ~50s/project. Report
checkedin at `evals/synthetic/report.md`. `docs/EVAL_HARNESS.md`.

### NEXT on the eval

**Framing settled 2026-08-29**: this is a STAPS thesis; **Lirem is a real
customer**. The next assignment is the **evaluation harness** — the thesis's
measurable contribution. Spec: `docs/EVAL_HARNESS.md`.

- Hand-labelled ground truth per project: owner / stage / overdue tasks /
  dropped tasks / decided-but-not-executed. `evals/<dataset>/labels.jsonl`.
- Runner: run the `project-status` / `decision-log-audit` / `weekly-digest`
  skills (and raw `gbrain think`) against the brain, capture answers.
- Scorer: precision / recall per dimension + a "every surfaced claim cites a
  real source page" check. `evals/<dataset>/report.md`.
- Config-driven per dataset — owner's own team data (Discord/Slack + Notion) for
  dev; Lirem's data for the thesis result (needs Lirem to grant a Slack bot +
  Notion integration).

Also queued (not blocking the eval):
- **Discord connector** — for the owner's own team testing (Hestia), same
  git-backed pattern as Slack. Deterministic permalinks. Needs a bot + Message
  Content Intent.

## Also: real-data pass (needed for the eval to mean anything)

1. **Real-data pass.** Widen Slack channels, run the notes connector once
   (owner sets `notes.roots`), re-ingest Drive with a fresh token, then walk the
   department console + a scoped `gbrain agent register` endpoint into a real
   Claude Code and ask real questions. This is the demo / thesis milestone.
2. ~~Cross-tool person resolution~~ — **DONE** (`c95713f9`): `config/people.json`
   alias map + `lib/connectors/shared/people.ts`, applied in notion + slack
   `run.ts`. Owner fills `config/people.json` with real aliases. `docs/PEOPLE.md`.
3. **Skill coverage** — `shared` has 3 hand-written skills. **Automatic
   extraction** exists (`npm run skills:extract` → `skill-drafts/`, local model,
   drafts only). Run it once the brain has real team chat/process content — the
   current corpus (strategy doc, trip plan, lab reports) has no procedures to
   mine. `docs/SKILL_EXTRACTION.md`. Promote drafts by hand.
4. **Drive at scale** — no OCR for scanned PDFs; `unpdf` is slow on JP CID fonts
   (~30-60 s each). Swap for native `pdftotext` (poppler) if PDF volume grows.
5. **Console hardening** — `scripts/console.ts` has no auth (localhost only) and
   a slow first paint (many CLI spawns). Fine as an operator tool; cache or add
   auth before exposing it.
6. **Step 7 (hosted only)** — OAuth source-connect + data-region selection.
   Only if this is offered as SaaS rather than self-hosted. Skipped for now.

## Ground rules

- **Security option A is hard**: no ingested content (owner's or a customer's) to
  any hosted API. Local models only. Blocked by that? Write it in
  `cowork/TASKBOARD.md` "Cross-requests" — needs an explicit human decision.
- Always `export GBRAIN_HOME="$HOME/.aletheia-brain"` before any `gbrain` call.
- Run gbrain via the vendored CLI: `cd packages/brain && bun src/cli.ts <cmd>`
  (no global install). Cookbook: `cowork/handoff/brain-cookbook.md`.
- `npm test` + `npm run build` green before every commit. Small logical commits.
- Config-driven only. No hardcoded workspace names, tokens, channels, "Lirem".
- The owner runs live token commands (or pastes tokens into gitignored
  `config/connectors.json`); Claude/Codex can then run the ingest via Bash.

## Operating note

`codex exec` has **hung twice** on this repo (51 min, zero output). Claude has
been building the connectors directly and committing. If delegating to Codex:
scope tightly, `< /dev/null`, and check for progress within ~5 min — kill and do
it directly if stalled. Codex's sandbox also blocks `.git/index.lock` and
long-lived server ports, so Claude commits its work and does live runs.

## What the owner still needs to provide

| Item | For |
|---|---|
| Fresh `ya29.` Drive token (hourly) | any Drive re-ingest |
| Which extra Slack channels (`social`, `new-channel`) | widening `engineering` |
| A `notes.roots` folder path | first live notes run |
| Real person names | replacing the `test-*` scoped clients |
| Lirem Slack/Notion tokens | only if Lirem goes live |

## Key files

| Path | What |
|---|---|
| `docs/OMNIBRAIN_PARITY.md` | demo breakdown + roadmap |
| `docs/BRAIN_SETUP.md` | option-A brain init |
| `docs/MULTI_BRAIN.md` | sources + scopes + isolation check |
| `docs/CONTINUOUS_SYNC.md` | connectors:all / sync:watch / autopilot |
| `docs/RULES.md` | the `_*-rules.md` policy files |
| `docs/SKILLS.md` | brain skills + how to add one |
| `docs/DEPARTMENT_CONSOLE.md` | `npm run console:serve` — cards + invite + members |
| `docs/PEOPLE.md` | cross-tool person alias map |
| `docs/SKILL_EXTRACTION.md` | `npm run skills:extract` — mine procedures → draft skills |
| `docs/CONSOLE_SETUP.md` | build + serve `/admin`, scoped-endpoint flow |
| `docs/BRAIN_CONNECTORS.md` | git-backed-source connector model |
| `docs/SELF_TEST.md` | end-to-end walkthrough on your own data |
| `cowork/handoff/brain-cookbook.md` | gbrain command set for this project |
| `cowork/handoff/self-test-result.md` | what was live-verified + known gaps |
| `cowork/TASKBOARD.md` | live checklist |
