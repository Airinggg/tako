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
  `*.example.json` templates, and `docs/connectors/*-credentials.md` walks
  through getting each connector's own API token from scratch. Google Drive
  is a supervised-trial connector for now — see its guide for why.
- Security hardening against `docs/PROTOTYPE_SECURITY_CHECKLIST.md` is
  substantially done: the P0 (public-demo) gate is a clean GO, and most of
  the P1 (real-customer-pilot) items that matter for a single-tenant
  instance are closed too — see that file for the current line-by-line
  state and `docs/audit/` for the underlying evidence.
- The evaluation has run on synthetic data only so far. Running it on Lirem's
  real data is the thesis milestone still ahead.

## Run it locally (macOS)

Prerequisites:

- [Bun](https://bun.sh) 1.3+
- [Ollama](https://ollama.com), with `bge-m3`, `qwen2.5:3b-instruct` pulled
  (`ollama pull bge-m3`, etc.)

```bash
npm install
bun scripts/demo.ts
```

Opens at `http://localhost:4400`. Without any connectors configured, most
screens will be empty — see `cowork/HANDOFF.md` and `docs/BRAIN_CONNECTORS.md`
for how to connect a source.

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
Studio, separate from a "Gemini" app subscription — a locally-run,
tenant-data-safe way to use it (gated behind the on-premise rule above) is
possible future work, not built yet.

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
