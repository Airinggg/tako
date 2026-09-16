# Continuous local sync

Continuous sync has two stages: connectors refresh Markdown in the configured
department repositories, then GBrain imports those repositories into the local
brain. No connector content is sent to a hosted model; embeddings and synthesis
remain on Ollama.

## Recommended runner

From the repository root, start the connector-aware daemon:

```bash
./bin/omnibrain sync --watch --interval 300
```

On its first pass, every connector with a block in `config/connectors.json` is
due. Later passes use the default interval above, or that connector's optional
`intervalSeconds` setting:

```json
{
  "notion": {
    "sourceDir": "brain-sources",
    "subdir": "shared",
    "intervalSeconds": 300
  }
}
```

For each due connector, the runner calls its existing `connectors:<name>` npm
script. On success it temporarily stops an Alethia GBrain HTTP server, syncs the
connector's configured `subdir` source with `--working-tree`, runs `embed --all`,
and restores the server on its previous port. It never stops an unrelated
personal GBrain process. Every GBrain command receives exactly
`GBRAIN_HOME="$HOME/.aletheia-brain"`.

Each action is one JSON line on stdout, suitable for local log collection. Run
history is stored atomically in ignored `config/sync-state.json`. Failures use
exponential backoff (`interval × 2^consecutiveFailures`) capped at 24 hours. The
ignored `config/.sync-daemon.lock` prevents two daemon or cron passes from
overlapping; a stale lock is reclaimed when its process is gone.

Stop watch mode with Ctrl-C or SIGTERM. The runner terminates its active child,
restores serve if necessary, saves state, and removes its lock.

For cron or launchd, run exactly one pass:

```bash
./bin/omnibrain sync --once --interval 300
```

For example, a macOS LaunchAgent can invoke `/bin/zsh -lc 'cd <repo> &&
./bin/omnibrain sync --once --interval 300'` with `StartInterval` set to `60`.
The scheduler state still decides which connectors are due, so the launch
interval may be shorter than connector intervals. Do not put tokens or ingested
content in the plist.

## Run every configured connector

From the repository root:

```bash
npm run connectors:all
```

The command runs every connector in `lib/connectors/registry.ts` sequentially:
Notion, Slack, Drive, Discord, notes, and CAD. A connector is skipped
successfully when its `config/connectors.json` block is absent. A token-based
connector is also skipped when `token` is absent or references an unset
`env:VARIABLE`. The notes and CAD connectors are file-based and tokenless; CAD
re-reads its complete metadata export on each due run and defaults to a
900-second interval. Other connector failures stop the sequence so stale or
partial ingestion is visible to the operator.

## GBrain-only watcher

```bash
export GBRAIN_HOME="$HOME/.aletheia-brain"
npm run sync:watch
```

This runs the vendored command `bun src/cli.ts sync --all --watch` from
`packages/brain`; GBrain checks every registered source every 60 seconds. Stop
it with `Ctrl-C`. Connector output is intentionally not committed automatically:
review and commit each department repository, and the watcher will import the
new commit on its next interval. This older `npm run sync:watch` path does not
run connectors; use `omnibrain sync --watch` for the complete pipeline.

After a source re-registration or a sync that leaves embedding coverage stale,
run:

```bash
export GBRAIN_HOME="$HOME/.aletheia-brain"
cd packages/brain
bun src/cli.ts embed --all
```

## Legacy simple local loop

The daemon above replaces the manual loop. For reference, a trusted local
machine can still import reviewed-but-uncommitted connector output with:

```bash
while true; do
  npm run connectors:all
  export GBRAIN_HOME="$HOME/.aletheia-brain"
  (cd packages/brain && bun src/cli.ts sync --all --working-tree)
  sleep 300
done
```

Stop it with `Ctrl-C`. Redirect stdout/stderr to a local log when running it
from `launchd`; keep tokens only in the ignored config or the launch agent's
environment. A macOS LaunchAgent can invoke `/bin/zsh -lc 'cd <repo> && npm run
connectors:all && export GBRAIN_HOME="$HOME/.aletheia-brain" && cd packages/brain
&& bun src/cli.ts sync --all --working-tree'` with `StartInterval` set to `300`.
Do not place tokens or ingested content in the plist.

## Background maintenance

In a separate terminal, the local maintenance daemon is:

```bash
export GBRAIN_HOME="$HOME/.aletheia-brain"
cd packages/brain
bun src/cli.ts autopilot
```

Autopilot covers all sources in the brain database. It periodically checks
health and submits targeted maintenance work when needed; stop it with
`Ctrl-C`. It is maintenance, not a replacement for connector collection or
`sync --watch`.

The admin console's Jobs view shows queued/running maintenance and ingestion
work. Request Log shows scoped MCP activity and failures. Use `bun src/cli.ts
sources status` with the isolated `GBRAIN_HOME` for per-source sync time, page
count, embedding coverage, and unacknowledged failures.
