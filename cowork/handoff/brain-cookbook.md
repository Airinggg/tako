# gbrain cookbook — this project

The brain is already initialised (see `docs/BRAIN_SETUP.md`). This is the command
set you'll actually use. **Every command must be prefixed with the isolated
home**, or you'll hit the developer's personal brain:

```bash
export GBRAIN_HOME="$HOME/.aletheia-brain"
cd packages/brain            # no global install; run the vendored CLI
alias gb='bun src/cli.ts'    # optional, for this shell
```

All examples below assume `GBRAIN_HOME` is exported and you're in `packages/brain/`.

## Health

```bash
bun src/cli.ts doctor --json          # NB: prints a "[gbrain] …" log line before the JSON
bun src/cli.ts engine status          # which engine + DB path
```

## Write / read pages

```bash
# write from stdin
printf '%s\n' '# 案件: X' '' '本文…' | bun src/cli.ts put "messages/slack/C123/1699999999"

bun src/cli.ts get  "messages/slack/C123/1699999999"
bun src/cli.ts list [--type T] [--tag T] [--limit N]
bun src/cli.ts delete "slug"
```

`write_through … skipped: no_repo_configured` in the output is expected and
harmless — it just means the brain isn't mirroring pages back to a git repo.

## Search

```bash
bun src/cli.ts search "ワイヤーフレーム"      # keyword / BM25 — fast, no model, WORKS NOW
bun src/cli.ts query  "誰がWFの担当か"        # hybrid (vector + BM25 + RRF) + synthesis
```

**Known issue (option A / local models):** the first `query`/`search` after a
cold start throws `query embed deadline 6000ms exceeded` because `bge-m3` takes
>6 s to load. BM25 results still come back. Fixes, pick one:
- pre-warm: `curl -s localhost:11434/api/embeddings -d '{"model":"bge-m3","prompt":"warmup"}' >/dev/null` before the first query, or keep Ollama's `keep_alive` long;
- raise gbrain's embed deadline (grep `6000` / `embed deadline` under `packages/brain/src/core/ai/`);
- accept BM25-only for slice 1 (`search.mode = conservative` is already set).

## Bulk import (useful for connectors)

```bash
bun src/cli.ts import ./some-dir --no-embed    # load a markdown dir; embed later
bun src/cli.ts import ./some-dir               # load + embed
```

## Integrations / connectors (step 2 of HANDOFF)

```bash
bun src/cli.ts integrations --help
bun src/cli.ts integrations list
```

Recipes for model providers live in `packages/brain/src/core/ai/recipes/`
(there's an `ollama.ts` — that's how local models are wired). Data-source
integration code + docs: search `packages/brain/src/core/` for `integration`,
`sense`, `reflex`; read `packages/brain/docs/` (start at `llms.txt`).

## Direct Ollama (bypass gbrain, for the extraction pipeline)

```bash
curl -s localhost:11434/api/generate -d '{
  "model":"qwen3.5:9b",
  "prompt":"次のSlackログから 案件名/担当/期限/決定 をJSONで抽出:\n…",
  "stream":false,
  "format":"json"
}'
```

Models present: `qwen3.5:9b` (extraction/synthesis), `bge-m3` (embeddings),
`qwen2.5:3b-instruct` (small/fast). `ollama list` to check.
