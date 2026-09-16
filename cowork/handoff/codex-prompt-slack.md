You are Codex on branch `feat/brain-foundation`. Read `cowork/HANDOFF.md`,
`cowork/TASKBOARD.md`, `docs/BRAIN_CONNECTORS.md`, and the existing
`lib/connectors/notion/` (your reference implementation). Then read
`packages/brain/docs/tutorials/company-brain.md` Part 8 ("Wire Slack carefully").
Build the Slack connector, then STOP. Do not start person-resolution or saved questions.

## Hard rules
- Security option A: no ingested content to any hosted API. Local models only.
- Config-driven only. No hardcoded workspace names, tokens, channels.
- Always `export GBRAIN_HOME="$HOME/.aletheia-brain"` before any `gbrain` command.
  Never touch `~/.gbrain/`.
- Do NOT edit vendored code under `packages/brain/`.
- Do NOT touch `app/` routes. `npm run build` + `npm test` green before each commit.
- Commit after each task. Trailer: `Co-Authored-By: Codex <noreply@openai.com>`.
- Never commit a real token or real Slack content. `config/connectors.json` and
  `brain-sources/` are already gitignored. Extend `config/connectors.example.json`.
- If the sandbox blocks network / a port / `.git/index.lock`: do everything
  offline (code + fixtures + unit tests + docs), record blockers in
  `cowork/handoff/codex-slack-report.md`, let Claude do the live run.

## Model: same as Notion
Slack messages -> normalised records -> deterministic Markdown files in a
git-backed source dir -> `gbrain sources add` + `gbrain sync`. Mirror the Notion
connector's structure and quality.

## TASK 1 — shared cleanup
- Generalise `lib/connectors/notion/prune.ts` into `lib/connectors/shared/prune.ts`
  exporting `pruneStale(sourceDir, subdir, keepPaths)` (subdir e.g. "notion" | "slack").
  Update `notion/run.ts` to call the shared one. Keep notion tests green.
- Commit. 

## TASK 2 — Slack connector  `lib/connectors/slack/`
```
lib/connectors/slack/
  client.ts     # fetch wrapper over https://slack.com/api (Bearer token, application/json;
                # Slack returns { ok:false, error } with HTTP 200 — throw on ok:false)
  collect.ts    # -> SlackThread[]  (see below)
  render.ts     # SlackThread -> { path, markdown }
  run.ts        # config -> collect -> write .md -> pruneStale -> cursor
  __fixtures__/  # invented Slack API payloads for the unit tests
```

### Collect
- Config (`config/connectors.example.json`, add a `slack` key):
  ```json
  {
    "slack": {
      "token": "env:SLACK_BOT_TOKEN",
      "sourceDir": "brain-sources",
      "channels": ["<channel-id-or-name>"],
      "includeThreads": true,
      "lookbackDays": 30
    }
  }
  ```
- Resolve `channels` entries that aren't IDs (don't start with `C`/`G`) against
  `conversations.list` (types `public_channel,private_channel`). Skip + warn on unknown names.
- For each channel: `conversations.history` (paginate `cursor`, `oldest` =
  now - lookbackDays on the first run, else the stored cursor ts). For each root
  message with `reply_count > 0` and `includeThreads`, pull `conversations.replies`.
- Resolve users once via `users.list` into `Map<id, {name, real_name}>`. Replace
  `<@U…>` mentions in text with `@name`. Resolve `<#C…|name>` to `#name`.
- Permalinks: call `chat.getPermalink` for the thread root (one call per thread);
  store it. Never construct or LLM-compose Slack URLs.
- `SlackThread`: `{ channelId, channelName, rootTs, permalink, participants: string[],
  lastTs, messages: { user: string, ts: string, text: string, isRoot: boolean }[] }`.
  A standalone message is a thread of length 1.

### Render
- One file per thread: `slack/<channel-name-slug>/<rootTs>.md`.
- Frontmatter: `source: slack`, `channel`, `channel_id`, `root_ts`, `url` (permalink),
  `participants` (comma-joined), `updated` (lastTs as ISO — convert the Slack
  epoch-seconds string).
- Body: each message as `**@user** (YYYY-MM-DD HH:MM):\n\n<text>\n` in order,
  replies indented or under a `---`. Keep it plain and deterministic.

### Cursor / prune
- `<sourceDir>/.slack-cursor.json`: `{ "<channelId>": "<lastTs>" }` per channel.
- `pruneStale(sourceDir, "slack", keepPaths)` after writing — a thread deleted in
  Slack (or now outside lookback and re-scoped) drops on next sync. NOTE: with a
  rolling `lookbackDays`, older threads naturally fall out of the pull; that's
  acceptable for slice 1, but say so in the report so we can add a `--since` /
  archive mode later.
- `--full` flag: ignore the cursor, re-pull the whole lookback window.

### Tests (offline, fixtures — no token, no network)
- user + channel mention resolution in `collect.ts`
- thread assembly (root + replies, participants, lastTs)
- `render.ts` frontmatter + message formatting is deterministic
- `pruneStale` for the slack subdir
Wire into `package.json` `test` (it currently names test files explicitly).
Add npm script `connectors:slack` -> `bun lib/connectors/slack/run.ts`.

## TASK 3 — docs
- Extend `docs/SELF_TEST.md` with a Slack section: create a Slack app at
  api.slack.com/apps, add bot scopes `channels:history channels:read groups:history
  groups:read users:read`, install to the workspace, copy the `xoxb-` token,
  invite the bot to the test channel(s), set `config/connectors.json`, run
  `npm run connectors:slack`, then `gbrain sync --source <same 'notion' source or
  a new 'slack' source?>` — decide and document: does Slack share the one
  `brain-sources` source with Notion (recommended — one `gbrain sources add` for
  the whole `brain-sources` dir) or get its own? Reflect the choice in
  `docs/BRAIN_CONNECTORS.md`.
- Update `cowork/TASKBOARD.md` (tick Slack), write `cowork/handoff/codex-slack-report.md`
  (what you built, what's tested offline, what needs the live token, blockers).

Then STOP.
