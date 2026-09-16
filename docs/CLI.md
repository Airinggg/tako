# OmniBrain CLI

`bin/omnibrain` is the single local entry point for the existing connectors,
operator pages, evaluation harness, and vendored GBrain CLI. It adds no hosted
service or retrieval capability.

Run it directly from the repository:

```bash
./bin/omnibrain --help
```

The package also declares the `omnibrain` bin entry, so `npm link` makes the
same command available on the local shell path.

## Commands

```bash
# Pull one configured source. Connector flags pass through unchanged.
omnibrain connect notion
omnibrain connect slack --full
omnibrain connect drive
omnibrain connect notes
omnibrain connect discord
omnibrain connect cad

# Sync every registered source, then embed all pages.
omnibrain sync

# Or sync one source, then embed all pages.
omnibrain sync --source engineering

# Continuously pull due connectors, then sync/embed their affected sources.
omnibrain sync --watch --interval 300

# Run one scheduling pass, suitable for cron or launchd.
omnibrain sync --once --interval 300

# Local operator pages.
omnibrain ask
omnibrain console
omnibrain scopes

# List reviewed skills, declared reads, and granting configured scopes.
omnibrain skills

# List scheduled workers, their next run, and local approval queue depth.
omnibrain workers

# Evaluation harness (still uses its own scratch brain home).
omnibrain eval synthetic

# Vendored GBrain HTTP/MCP/admin server.
omnibrain serve
omnibrain serve --port 8788

# Read-only operational summary.
omnibrain status
```

`ask`, `console`, `scopes`, and `serve` stay in the foreground and stop with
Ctrl-C. Connector credentials still come from the existing gitignored
`config/connectors.json`; the dispatcher does not add credential storage.

`omnibrain connect cad` runs the read-only CAD connector across every system
configured under `cad.systems` (Fusion, SolidWorks, CATIA, NX — the connector is
system-agnostic). It re-reads each configured metadata export file on every run;
it never connects to a CAD application, a PDM vault, or a hosted service. The
continuous sync runner schedules it every 900 seconds by default, overridable
with `cad.intervalSeconds`.

`omnibrain skills` is read-only. It parses project-owned `SKILL.md` files and
reports each skill's declared source reads plus the configured scopes whose
realised source sets grant every declared read. A scope that is not yet realised
does not grant the skill. The command inventories execution eligibility; it
does not run a skill.

`omnibrain workers` is also read-only. It reports `config/workers.json` together
with ignored run state and approval-queue depth. Workers run separately with
`npm run workers:run` (continuous) or `npm run workers:run -- --once`; see
`docs/WORKERS.md`. A worker's delivery target is a label only, and every result
stays in the local queue for human approval.

## Sync and serve lifecycle

`omnibrain sync` defaults to `gbrain sync --all`. If `--source <id>` or `--all`
is supplied, that selection passes through unchanged. The command:

1. detects and stops an Alethia `gbrain serve --http` process if one is running;
2. runs sync through `packages/brain/src/cli.ts`;
3. runs `gbrain embed --all` after a successful sync;
4. restarts serve on its previous port, including when sync fails.

Serve process metadata is kept in a per-user temporary file, outside the brain
and repository. The wrapper also recognises an Alethia serve process whose
command line identifies this vendored CLI or the protected brain home. It does
not stop an unrelated personal GBrain process.

`omnibrain sync --watch` runs the continuous connector scheduler. `--interval`
sets its default connector interval in seconds (300 by default). A connector's
optional `intervalSeconds` in `config/connectors.json` overrides that default.
Each due connector runs through its existing `connectors:<name>` npm script;
after success, only its configured `subdir` source is synced with
`--working-tree`, then embeddings are refreshed. The same serve stop/restart
helper is used around that GBrain work.

`omnibrain sync --once` performs one scheduling pass and exits. Both modes keep
run state in the ignored `config/sync-state.json`, apply capped exponential
backoff after failures, emit one JSON object per action to stdout, and hold
`config/.sync-daemon.lock` to prevent overlap. Stop watch mode with Ctrl-C or
SIGTERM; the active child is terminated, serve is restored if the runner had
stopped it, and the lock is released.

## Isolation guarantee

Every GBrain child receives exactly:

```bash
GBRAIN_HOME="$HOME/.aletheia-brain"
```

The dispatcher ignores an inherited `GBRAIN_HOME`, never points at `~/.gbrain/`,
and does not modify `packages/brain/`. `omnibrain status` is read-only. The only
mutations remain those of the underlying commands the operator explicitly
chooses: connector pulls, sync/embed, evaluation scratch setup, and the existing
console invite/revoke actions.
