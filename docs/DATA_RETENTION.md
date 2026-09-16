# Data retention and deletion

## Policy

This instance's retention default is **90 days since a page was last
updated**, recorded in `config/retention.json` (copy from
`config/retention.example.json` via `./bin/omnibrain setup`). No
Lirem-specific contractual retention number exists yet — 90 days is a
proposed, documented default, not something the code enforces
automatically. Revisit this once a real customer agreement specifies a
number, and update `config/retention.json` accordingly.

This is a policy record, not an automated job: nothing currently deletes
content on a schedule. Enforcing it today means periodically running the
"find stale content" procedure below and deciding what to remove.

## The deletion mechanism (already built, not previously documented)

The underlying `gbrain` engine (vendored at `packages/brain/`) already has
real, working deletion machinery — this section documents how to actually
use it. Run these from `packages/brain/`, with `GBRAIN_HOME` set to this
instance's brain home (see `docs/BRAIN_SETUP.md`).

### Delete one page

```bash
bun src/cli.ts delete <slug>
```

### Remove an entire source (a connector's synced content)

```bash
# Soft-delete: hides it from search immediately, recoverable for 72h
bun src/cli.ts sources archive <source-id>

# Undo, within 72h
bun src/cli.ts sources restore <source-id>

# Permanently delete now, instead of waiting for the 72h auto-purge
bun src/cli.ts sources purge <source-id> --confirm-destructive

# Or skip the soft-delete step entirely and remove immediately
bun src/cli.ts sources remove <source-id> --confirm-destructive
```

**Verified 2026-09-15** (transcript in
`docs/audit/2026-09-15-retention-cycle-test.md`): a page was added,
confirmed searchable, archived (confirmed the actual search path Tako's
Ask feature uses correctly refuses an archived source), then purged
(confirmed permanently gone, including from `--include-deleted` listings).
One observed quirk, noted for accuracy: `gbrain list --source-id <id>`
(a raw listing command, not the search/retrieval path) still showed the
archived page until purge — this does not affect what Ask can actually
retrieve, since `gbrain search`/`think` correctly refuse an archived
source outright, but don't rely on `list`'s output alone to confirm a
source is really hidden.

### Connector-level pruning happens automatically already

Every connector (`lib/connectors/{notion,slack,drive,discord,notes,cad}/run.ts`)
already calls a prune step that removes local `.md` files under
`brain-sources/<connector>/` for content no longer present upstream (e.g. a
deleted Slack message or an unshared Notion page) — this runs on every
sync, no separate action needed. The next `gbrain sync` then propagates
that removal into the index via `sync-delta.ts`'s git diff.

### Finding stale content (older than the retention window)

There is no single "delete everything older than N days" command. List
pages oldest-first and review them against the retention window:

```bash
bun src/cli.ts list --sort updated_asc --limit 50
```

Compare each page's date against `config/retention.json`'s
`retentionDays`, and delete/archive what's past the window using the
commands above.

## What this does not cover

- No automatic, scheduled enforcement of the retention window — this is a
  manual (or scriptable-later) procedure, not a cron job today.
- No per-connector or per-page-type retention override — one number for
  the whole instance.
- This governs the *brain*/index only. `config/reviews.json`,
  `config/connectors.json`, and other local app state are not covered by
  this policy; they're operational state, not customer content.
