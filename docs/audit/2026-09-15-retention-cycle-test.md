# Create → delete cycle test — 2026-09-15

Real evidence for P1-11's required "create-delete 検証" (create-delete
verification). Run against a fully isolated scratch `GBRAIN_HOME` and a
throwaway scratch source — no real Lirem/customer data was touched.

## Setup

```
$ mkdir /tmp/retention-test-source && cd it, git init, add one test-page.md, commit
$ export GBRAIN_HOME=/tmp/retention-test-gbrain
$ bun src/cli.ts init --pglite --non-interactive --embedding-model ollama:bge-m3 --embedding-dimensions 1024
$ bun src/cli.ts sources add retention-test --path /tmp/retention-test-source --no-federated
Created source "retention-test" → /tmp/retention-test-source
```

## Sync and confirm indexed

```
$ bun src/cli.ts sync --source retention-test --no-embed
Import complete: 1 pages imported, 1 chunks created

$ bun src/cli.ts list --source-id retention-test
test-page   concept   2026-09-15   Retention test page
```

## Archive (soft-delete) and confirm the real search path excludes it

```
$ bun src/cli.ts sources archive retention-test
  Removed from search. Data intact.
  Restore:  gbrain sources restore retention-test
  Purge now: gbrain sources purge retention-test --confirm-destructive

$ bun src/cli.ts search "retention test throwaway page" --source retention-test
Source "retention-test" not found or is archived. Available active sources: ...
```

This confirms the actual retrieval path Tako's Ask feature uses
(`lib/eval/qa.ts`'s `gb(["search", ...])`) correctly refuses an archived
source outright.

**Noted quirk:** `gbrain list --source-id retention-test` (with or without
`--include-deleted`) still returned the page after archiving, even though
`sources archived` correctly listed it as archived with a 72h expiry. This
is a listing-command inconsistency, not a retrieval-path problem — `search`
is what matters for what Ask can actually answer from, and it was correct.
Documented in `docs/DATA_RETENTION.md` so a future operator isn't confused
by `list`'s looser behavior.

## Purge and confirm permanent removal

```
$ bun src/cli.ts sources purge retention-test --confirm-destructive
  Pages: 1, Chunks: 1, Embeddings: 0
  Permanently deleted source "retention-test" (1 pages cascaded).

$ bun src/cli.ts list --source-id retention-test --include-deleted
No pages found.

$ bun src/cli.ts sources list
SOURCES
  default   federated   0 pages   never synced
```

`retention-test` is fully gone — not listed even with `--include-deleted`.

## Cleanup

```
$ rm -rf /tmp/retention-test-source /tmp/retention-test-gbrain
```

Scratch environment removed; nothing from this test persists anywhere.
