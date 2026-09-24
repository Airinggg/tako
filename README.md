# Tako

Tako is an on-premise **company knowledge register** — 「社内知識の台帳」.
It federates read-only connections to a company's scattered tools (Notion,
Slack, Discord, Google Drive, CAD systems, and arbitrary MCP servers),
answers plain-language questions by retrieving from those sources, and drafts
answers using **local models only** (Ollama) — nothing is sent to a hosted
API. Every claim is cited back to its source, and nothing goes external
without a named person's approval.

This is a STAPS (graduate engineering) thesis project. [Lirem](https://lirem.co.jp/),
a Japanese SME consulting/staffing company, is the actual first customer —
the thesis's measurable contribution is an evaluation run on real project
data, not just a demo.

## The governed path

Every outward-facing step ends on a named human. This is not a feature, it
is the product's reason to exist:

```
質問 (Ask) → 検索 (Retrieve, cited) → 下書き (Draft, local model only)
  → フィルタ (Filter / mask PII) → 人間の承認 (Human approval — required)
```

Tako never sends or publishes anything on its own.

## Status

- Engine, connectors, governance gate, and the demo UI are built and tested
  (`npm test` — currently green).
- Self-serve onboarding is built: `./bin/omnibrain doctor` checks a machine
  is ready (Bun version, Ollama reachable, required models pulled),
  `./bin/omnibrain setup` scaffolds `config/*.json` from the committed
  `*.example.json` templates, and
  [`docs/CONNECTOR_CREDENTIALS.md`](docs/CONNECTOR_CREDENTIALS.md) indexes
  every connector's step-by-step token guide (also linked directly from the
  Connected Apps screen in the app itself). Google Drive is a
  supervised-trial connector for now — see its guide for why.
- Security hardening against `docs/PROTOTYPE_SECURITY_CHECKLIST.md` is
  substantially done: the P0 (public-demo) gate is a clean GO, and most of
  the P1 (real-customer-pilot) items that matter for a single-tenant
  instance are closed too — see that file for the current line-by-line
  state and `docs/audit/` for the underlying evidence.
- Ask can narrow a question by department (Finance/HR/Engineering/Sales/
  Legal/Operations/General) via keyword-based classification
  (`lib/govern/categorize.ts`) — deliberately independent of the
  access-control `subdir` scope, so a wrong classification only misfiles
  something for browsing, never exposes it. This is a real-time filter on
  one source's search results, not a persistent index or a memory of past
  questions.
- Settings and Help are real, live screens now (model/provider state, brain
  location, connected-source counts, a quick app tour, and the credential
  guides), not placeholders.
- Core app portability: real macOS-only bugs (`HOME` env var assumptions,
  a Unix-only process-detection fallback) are fixed so the app should run
  on Windows too — but this has not yet been verified end-to-end on a real
  Windows machine. There is no Windows installer yet (macOS has a `.dmg`;
  see `docs/DMG_DISTRIBUTION.md`) — Windows setup today is manual (see
  "Run it locally" above).
- The evaluation has run on synthetic data only so far. Running it on Lirem's
  real data is the thesis milestone still ahead.
- Designed but not yet built: a **Digest** feature (proactive "what
  changed" / contradiction surfacing + a per-topic history across sources)
  — see `docs/superpowers/specs/2026-09-22-company-brain-digest-design.md`
  and its implementation plan in `docs/superpowers/plans/`.

## Run it locally

Prerequisites (same on every platform):

- [Bun](https://bun.sh) 1.3+
- [Ollama](https://ollama.com), with `bge-m3`, `qwen2.5:3b-instruct` pulled
  (`ollama pull bge-m3`, etc.)

### macOS / Linux

```bash
npm install
cd packages/brain && bun install && cd ../..
bun bin/omnibrain setup   # scaffolds config/*.json
bun scripts/demo.ts
```

### Windows

Windows support covers running the app itself — there is no installer for
Windows yet (macOS has a `.dmg`; see `docs/DMG_DISTRIBUTION.md`).

```powershell
# 1. Install Bun
powershell -c "irm bun.sh/install.ps1 | iex"

# 2. Install Ollama for Windows: https://ollama.com/download/windows
#    (its own installer — there's no one-line command for Windows)
ollama pull bge-m3
ollama pull qwen2.5:3b-instruct

# 3. Clone and check out this branch
git clone https://github.com/Airinggg/tako.git
cd tako
git checkout feature/connector-credentials-and-categorization

# 4. Install dependencies (two separate installs, matching the app's structure)
npm install
cd packages/brain
bun install
cd ../..

# 5. Scaffold config -- always invoke via "bun bin/omnibrain", never
#    "./bin/omnibrain": Windows has no shebang/execute-bit support
bun bin/omnibrain setup

# 6. Fill in config/connectors.json with real credentials, then check readiness
bun bin/omnibrain doctor

# 7. Run it
bun scripts/demo.ts
```

The repo is private — cloning will prompt you to sign in with a GitHub
account that has access if this machine hasn't authenticated before.

Both platforms open at `http://localhost:4400`. Without any connectors
configured, most screens will be empty — see `cowork/HANDOFF.md` and
`docs/BRAIN_CONNECTORS.md` for how to connect a source.

## Architecture at a glance

| Piece | Where |
| --- | --- |
| Vendored knowledge-brain engine ([gbrain](https://github.com/garrytan/gbrain), MIT) | `packages/brain/` |
| Connectors (Notion, Slack, Discord, Drive, notes, CAD, generic MCP) | `lib/connectors/` |
| Governance: manifest validation, policy, redaction, audit | `lib/govern/` |
| Demo UI (the screen this README points you to) | `scripts/demo.ts` |
| Department console (operator view) | `scripts/console.ts` |
| Evaluation harness | `lib/eval/`, `scripts/eval.ts` |

Full internal state, what's done, and the task queue: `cowork/HANDOFF.md`.
Design/roadmap detail: `docs/OMNIBRAIN_PARITY.md`.

## Security posture

No content ingested from a connected source is sent to a hosted API — only
local models process it. The one documented exception is unrelated to this
platform: a separate SEO-audit script that reads *public* websites (see
`docs/LOCAL_LLM_PLAN.md` and the security notes in `docs/`).

Full detail lives in `docs/PROTOTYPE_SECURITY_CHECKLIST.md` (the actual
launch gate, with a Go/No-Go verdict per tier) and `docs/audit/` (the
evidence behind each line). As of the last audit:

| Area | State |
| --- | --- |
| Public-demo gate (P0: auth, input validation, error handling, rate limits, dependencies, rollback) | **GO** — all 10 items pass or correctly not-applicable |
| Real-customer-pilot items that matter for a single-tenant instance (P1: prompt injection, RAG-poisoning audit trail, AI/tool permissions, audit trail, log minimization, incident response) | 5 of 6 pass, 1 partial by design (see below) |

What's fixed and how, briefly:
- **Admin auth** — every mutating route (`lib/util/http-security.ts`)
  requires an `X-Admin-Token` header, checked in constant time.
- **Input validation** — request bodies are size-capped and schema-checked
  before they reach any handler.
- **Error sanitization** — an unexpected failure returns a generic message
  and a correlation id to the client; the real detail (which can include
  internal paths) is logged server-side only.
- **Rate limiting** — the expensive routes (`/api/ask`,
  `/api/activity/retry`, `/api/connectors/sync`) cap requests per client.
- **Prompt injection** — the LLM's instructions and retrieved document
  content are sent as separate fields (`lib/eval/qa.ts`'s `buildAnswerPrompt`),
  and every document block is explicitly framed as data, never a command.
- **RAG poisoning** — deliberately an audit trail, not an approval gate, for
  this pilot's scope: every connector sync logs what it indexed (source,
  content hash, who, when) to `config/sync-log.jsonl`, so there's always a
  trail of what became searchable and when.
- **Audit trail** — a review item's decision history is append-only
  (`ReviewItem.decisions`), so a "revise" or "escalated" verdict's history
  survives a later re-decision instead of being silently overwritten.
- **Incident response** — `docs/SECURITY_INCIDENT_RUNBOOK.md` covers a data
  leak, an accidental hosted-API send, a wrongly-recorded approval, and a
  leaked credential; `docs/ROLLBACK_RUNBOOK.md` covers a bad code release
  instead (a different scenario).

### Can I connect my own ChatGPT or Claude subscription instead of Ollama?

No — and not just as a policy choice. A ChatGPT Plus or Claude Pro
subscription has no API behind it: OpenAI's and Anthropic's APIs are
separate, pay-per-token products with their own billing and API keys, not
something a consumer subscription unlocks. There is no supported way to make
a personal chat-app login answer programmatic requests; the only ways to
fake it involve scraping that web session's cookies/tokens, which violates
those providers' terms of service and is not something this project will
build.

Google's Gemini API does have a genuine free tier issued from Google AI
Studio, separate from a "Gemini" app subscription. Tako has an explicit,
opt-in **demo-mode** switch to it (`ASK_PROVIDER=gemini` in `.env`, or the
in-app toggle on the Ask screen) for when the local model is too slow to
demo with — it is never the default, every screen that claims "local only"
checks the real state (`usesHostedProvider()` in `lib/eval/qa.ts`) instead
of assuming it, and both the server startup log and the Ask screen show an
explicit warning while it's active. This is a demo convenience, not a
tenant-data-safe production path — do not enable it with real customer
data.

## The earlier prototype

Tako began as a document-review desk for Japanese SMEs (evidence-grounded
claim checking against company sources, with Word/Excel add-ins). That
prototype is maintained separately in
[`Airinggg/aletheia-ai-adoption-desk`](https://github.com/Airinggg/aletheia-ai-adoption-desk),
and a hosted copy remains live at
<https://aletheia-ai-adoption-desk.hasegawaresearchlab.chatgpt.site/> for
continuity. It is a different, earlier product from what this repository
builds today.

## For an AI agent picking this up

Start at [`AGENTS.md`](AGENTS.md), then `cowork/HANDOFF.md`.
