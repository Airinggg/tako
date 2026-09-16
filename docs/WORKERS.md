# Read-only workers

A worker combines one reviewed skill, one realised scope, a schedule, and a
human-facing draft destination. Running a worker reads only the skill's declared
sources through local GBrain/Ollama, attaches a per-step receipt, and places the
result in a local approval queue. It never sends, posts, emails, or otherwise
delivers the result.

## Configure

Copy `config/workers.example.json` to the gitignored `config/workers.json`, then
edit each entry:

```json
{
  "id": "monday-project-digest",
  "name": "Monday project digest",
  "skill": "weekly-digest",
  "scope": "all-hands",
  "schedule": "weekly@mon09:00",
  "deliverTo": "#general — DRAFT",
  "lastRunAt": null,
  "lastStatus": null
}
```

`skill` must name a reviewed `brain-sources/*/skills/*/SKILL.md`. `scope` must
name a realised entry in `config/scopes.json`; the run is refused before
retrieval if that scope does not grant every source in the skill's `reads:`.
`deliverTo` is display-only metadata for the approving human.

Schedules use UTC and accept these forms:

- `daily@09:00`
- `weekly@mon09:00` (`sun` through `sat`)
- `everyNhours:6`

With no state, a worker is due on the first scheduling pass. Subsequent runs use
the ignored `config/workers-state.json`; the definition's `lastRunAt` and
`lastStatus` provide an optional initial fallback.

## Run and inspect

Run one pass for cron or launchd:

```bash
npm run workers:run -- --once
```

Or keep the local scheduler in the foreground (30-second polling by default):

```bash
npm run workers:run
npm run workers:run -- --interval 60
```

Stop foreground mode with Ctrl-C or SIGTERM. Every attempted worker emits one
JSON log line. The process forcibly sets
`GBRAIN_HOME="$HOME/.aletheia-brain"`; the live adapter uses the existing local
retrieve-then-extract runner and Ollama only.

Inspect configured workers, next runs, and approval queue depth without running
anything:

```bash
omnibrain workers
```

## Approval queue

Each result is appended to the gitignored `config/worker-queue.json` with:

- `approvalStatus: "pending"`;
- the intended `deliverTo` label;
- the final-step output;
- the complete `SkillRunReceipt`, including any observed-read violations.

Refused runs also enter the queue so a human can see the reason. There is no
approval or delivery implementation in this layer: changing a queue record
cannot trigger an external action.
