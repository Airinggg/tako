# Brain setup — option A (local models, nothing leaves the machine)

The project-intelligence layer runs on [GBrain](https://github.com/garrytan/gbrain),
vendored at `packages/brain/` (MIT). This document is the reproducible setup for
**security option A**: Lirem's private messages are read and embedded by local
models only. No message content is sent to a hosted API.

## Why a separate brain

The developer's personal GBrain lives at `~/.gbrain/`. Lirem's data must not mix
with it. We isolate with `GBRAIN_HOME`, which GBrain treats as a parent dir and
appends `.gbrain/` to.

```
export GBRAIN_HOME="$HOME/.aletheia-brain"   # config + DB land in ~/.aletheia-brain/.gbrain/
```

Put that line in your shell profile, or prefix every `gbrain` call with it.

For day-to-day repository operations, use the thin local dispatcher instead of
remembering each npm script and vendored CLI path:

```bash
./bin/omnibrain status
./bin/omnibrain connect notion
./bin/omnibrain sync --source shared
./bin/omnibrain serve --port 8787
```

It always supplies the protected brain home itself. See `docs/CLI.md` for every
subcommand and the sync/serve restart behavior.

## Prerequisites

- `bun` >= 1.3.10 (`packages/brain` requires it).
- [Ollama](https://ollama.ai) running locally (`ollama serve`).
- Local models pulled:
  ```
  ollama pull bge-m3            # embeddings, 1024-dim, ~1.2 GB
  ollama pull qwen3.5:9b        # query expansion + synthesis, ~6.6 GB
  ```
  `qwen3.5:9b` is used over a coder model for better Japanese. Swap in a larger
  local model later if extraction quality needs it (that is the option-A tuning
  knob; option B — a hosted model with Lirem's written consent — is the fallback,
  not the default).

## Initialise

Run from `packages/brain/` (no global install needed):

```
cd packages/brain
GBRAIN_HOME="$HOME/.aletheia-brain" bun src/cli.ts init --pglite --non-interactive \
  --embedding-model ollama:bge-m3 \
  --embedding-dimensions 1024 \
  --expansion-model ollama:qwen3.5:9b \
  --chat-model ollama:qwen3.5:9b
```

- `--pglite`: embedded Postgres-in-WASM, no server. DB at
  `~/.aletheia-brain/.gbrain/brain.pglite`. Move to real Postgres + pgvector only
  when the corpus outgrows PGLite (~50K pages) or goes multi-user.
- The Ollama recipe (`packages/brain/src/core/ai/recipes/ollama.ts`) sets
  `base_url` to `http://localhost:11434/v1` and needs no API key (pass the
  literal `ollama` if one is asked for).

## Verify

```
GBRAIN_HOME="$HOME/.aletheia-brain" bun src/cli.ts doctor --json
```

Expect `status: ok` or `warnings` with only the opt-in probes disabled. A
`connection` error means PGLite did not initialise; a `test-embed` failure means
Ollama is not serving `bge-m3`.

## What is NOT configured here

- Subagent / "dream cycle" autonomy: the Ollama chat recipe declares
  `supports_tools: false`, so the autonomous ingest-enrich-consolidate loop does
  not run on pure local models. Slice 1 does not need it (ingest -> embed ->
  query -> synthesize is enough). Revisit if the daemon becomes necessary.
- Connectors for Slack / Notion / Drive: built by Tako on top, not part of
  this setup. See `cowork/TASKBOARD.md`.
