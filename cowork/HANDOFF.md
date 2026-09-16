# Tako handoff — current standalone repository

Updated 2026-09-16. Active branch: **`main`**.

This file replaces the historical `feat/brain-foundation` handoff from the old
monorepo. That earlier narrative described removed `app/` routes, old commits
and an obsolete task queue. Use Git history if that implementation history is
needed; the state below describes this repository now.

## Current product

Tako is a single-customer, on-premise company-knowledge assistant. Read-only
connectors collect approved company sources into a local gbrain index. Retrieval
and answer drafting use Ollama, citations point back to source material, and
outward-facing work passes through a named human approval flow.

Lirem is the first intended supervised pilot customer. The repository is not a
multi-tenant SaaS and does not contain the earlier Aletheia web application.

## Verification baseline

Run:

```bash
npm test
```

Current baseline after the 2026-09-16 connector/onboarding fixes:

- Node suite: **171 passed, 0 failed**.
- Bun UI/evaluation suite: **39 passed, 2 failed**.
- Total: **210 passed, 2 known failures**.

The two expected failures are already tracked:

- #1 — the activity test depends on a locally seeded reviews fixture.
- #2 — the Connect screen exposes the internal `MCP` label.

No additional failure is an accepted baseline.

## Architecture

```text
Notion / Slack / Discord / Drive / notes / CAD / reviewed MCP sources
  -> lib/connectors/<tool>/run.ts
  -> Markdown with provenance under brain-sources/ (gitignored)
  -> vendored gbrain in packages/brain/
  -> local PGlite index + Ollama models
  -> scripts/demo.ts UI/server on 127.0.0.1:4400
```

The working model defaults are:

- embeddings: `bge-m3`
- query expansion and synthesis: `qwen2.5:3b-instruct`

`qwen3.5:9b` was evaluated but exceeded the working hardware/time budget. The
doctor, README and brain setup guide therefore use `qwen2.5:3b-instruct`.

## Important implementation areas

| Area | Path |
| --- | --- |
| Demo UI and HTTP server | `scripts/demo.ts` |
| Connector implementations | `lib/connectors/` |
| Connector configuration | `config/connectors.example.json` |
| Local brain engine | `packages/brain/` |
| Review/approval state | `lib/review/` |
| Redaction, policy and provenance | `lib/govern/` |
| HTTP security | `lib/util/http-security.ts` |
| Evaluation | `lib/eval/`, `evals/` |
| Operational/security evidence | `docs/audit/` |

## Recently corrected connector behavior

- Slack and Discord incremental sync preserve still-valid existing files (#3,
  #5), using `lib/connectors/shared/prune.ts::keepWithinWindow`.
- Discord merges incremental messages with the previously written conversation
  (#5), using `mergeConversationMessages`.
- Notion recursively collects nested blocks with cycle/depth protection (#6).
- Slack revisits known thread roots so late replies are collected (#4).
- UI connector tests resolve `env:VARNAME` tokens through the same path as real
  connector runs (#7).
- Connector configuration writes use owner-only `0600` permissions (#9).

## Known open work

Check GitHub issues before starting. At this update, important remaining work
includes:

- #1 and #2 — the two known test failures above.
- #10 — Drive's global cursor can skip older files in a newly added folder.
- #11 — sync provenance can misattribute unrelated dirty files in a shared
  source directory.

The per-member authentication design is documented at
`docs/superpowers/specs/2026-09-16-per-member-auth-design.md`; it is a design,
not an implemented login system.

## Security and operational rules

- Local models only for customer content; no hosted AI keys or APIs.
- Keep the demo bound to loopback unless a reviewed reverse-proxy/TLS deployment
  is being installed on customer-controlled infrastructure.
- Tokens and real connector configuration belong only in gitignored local
  files or environment variables.
- Use least-privilege, read-only connector credentials.
- Do not edit `packages/brain/` unless the task explicitly concerns vendored
  engine behavior.
- Preserve citations, approval gates, redaction and append-only decision
  history when changing user flows.
- Run the complete `npm test` command and report the exact delta from the known
  baseline.

## Setup and operations

```bash
./bin/omnibrain doctor
./bin/omnibrain setup
npm run demo
```

More detail:

- `docs/BRAIN_SETUP.md`
- `docs/BRAIN_CONNECTORS.md`
- `docs/CONSOLE_SETUP.md`
- `docs/SELF_TEST.md`
- `docs/SECURITY_INCIDENT_RUNBOOK.md`
- `docs/BACKUP_RESTORE_RUNBOOK.md`
- `docs/DATA_RETENTION.md`

Historical files under `cowork/` may describe the original monorepo build and
should not override this handoff, `AGENTS.md`, the current code or GitHub issues.
