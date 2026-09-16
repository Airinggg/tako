# Self-test: Notion source and personal brain endpoint

This is a manual acceptance test using only the developer's own Notion content.
It needs a Notion token and network access for collection, and a running local
GBrain server for the endpoint step. CI must skip every numbered step below;
the connector's checked-in fixture tests cover its offline behavior.

## 1. Create a limited Notion integration (network + token)

In Notion, create an internal integration with access-token authentication and
the **Read content** capability only. Share exactly one test database or page
with it using **••• → Connections**, then copy its `ntn_...` token. Do not put
the token in a tracked file or shell history.

## 2. Configure the local connector (token)

```bash
cp config/connectors.example.json config/connectors.json
# Edit config/connectors.json: replace <database-id> with the shared database ID.
# For a standalone page instead, put its ID in the pages array and leave databases empty.
export NOTION_TOKEN='ntn_...'
```

`config/connectors.json` and `brain-sources/` are ignored. The default source
directory must become a Git repository before it can be registered with GBrain.

## 3. Collect Markdown (network + token)

```bash
npm run connectors:notion
```

Expected output: `wrote N markdown files to brain-sources/notion/...`.
Subsequent runs write only records newer than `.notion-cursor.json`; pass
`--full` to collect and rewrite all configured records.

Review the generated Markdown, then establish its Git history:

```bash
git -C brain-sources init
git -C brain-sources add notion .notion-cursor.json
git -C brain-sources commit -m "Import Notion source"
```

Use a private remote if the generated content must be shared or backed up.

## 4. Register and sync the source (local models; Git repo required)

```bash
cd packages/brain
export GBRAIN_HOME="$HOME/.aletheia-brain"
bun src/cli.ts sources add notion --path "<absolute-repo-path>/brain-sources" --name "Notion"
bun src/cli.ts sync --source notion
```

The source command requires the directory to be a Git repository with committed
files. `sync --source notion` imports that source only. Do not use the default
`~/.gbrain/` home.

## 5. Ask a content-specific question (local models)

```bash
export GBRAIN_HOME="$HOME/.aletheia-brain"
bun src/cli.ts think "<a question only the shared Notion content can answer>"
```

Expect a synthesized answer with citations. If the source does not contain the
answer, expect the response to state a gap rather than fabricate one. First use
can be slow while local Ollama models load.

## 6. Add a personal Claude Code endpoint (running local server required)

Start the server described in `docs/CONSOLE_SETUP.md`, then on the brain host:

```bash
export GBRAIN_HOME="$HOME/.aletheia-brain"
bun src/cli.ts agent register me --harness claude-code --preset daily-driver \
  --url http://localhost:8787/mcp --show-token
```

Copy the printed `claude mcp add ...` block into Claude Code and ask the same
question. The endpoint is personal and scoped by the generated credential; keep
the printed token private. This step needs the local server, not a hosted model.

---

## Slack (network + `xoxb-` token)

Same git-backed-source flow as Notion; the connector writes into
`brain-sources/slack/` inside the same source directory.

1. Create a Slack app (api.slack.com/apps → **Blank app**). Under
   **OAuth & Permissions → Bot Token Scopes** add `channels:history`,
   `channels:read`, `users:read` (+ `groups:history`, `groups:read` for private
   channels). **Install to Workspace**, copy the **Bot User OAuth Token**
   (`xoxb-…`). In Slack, `/invite @<app name>` in each channel to be read.
2. Edit `config/connectors.json` → `slack` block: put the `xoxb-` token in
   (literal, or keep `env:SLACK_BOT_TOKEN` and export it) and list channel names
   or IDs in `channels`. `lookbackDays` bounds the first pull.
3. `npm run connectors:slack` → `wrote N thread file(s) to brain-sources/slack/`.
   Re-runs are incremental (`.slack-cursor.json`); `-- --full` re-pulls the window.
4. Commit `brain-sources` again, then `gbrain sync --source notion` (the source
   already covers the whole `brain-sources` tree, Slack included).
5. `bun src/cli.ts think "<a question your Slack answers>" --model ollama:qwen2.5:3b-instruct`
   → cited answer spanning Slack + Notion.

---

## Local notes (no token)

Ingest a folder of your own Markdown/text notes.

1. `config/connectors.json` → add a `notes` block: `roots` = absolute path(s) to
   your notes folder(s), `extensions` defaults to `.md .markdown .txt`.
   (`.git`, `node_modules`, `.obsidian`, and other dot-dirs are skipped.)
2. `npm run connectors:notes` → `wrote N note file(s) to brain-sources/notes/`.
   Each note keeps its relative path, gets provenance frontmatter, and any
   existing YAML frontmatter is unwrapped so it doesn't nest. Incremental by
   mtime (`.notes-cursor.json`); `-- --full` re-copies everything.
3. Commit `brain-sources`, `gbrain sync --source notion` (same one source).
4. `gbrain think "<a question your notes answer>" --model ollama:qwen2.5:3b-instruct`.

---

## Discord (network + bot token) — for the owner's own team

Same git-backed-source flow. Discord permalinks are deterministic (no extra API call).

1. https://discord.com/developers/applications → New Application → Bot → Reset Token,
   copy the token. Enable **Message Content Intent** (Bot → Privileged Gateway
   Intents). Invite the bot to your server with **View Channels** +
   **Read Message History** (OAuth2 URL Generator, `bot` scope).
2. Get the server (guild) id and channel ids: enable Developer Mode in Discord
   (Settings → Advanced), right-click the server / channel → Copy ID. Channel
   names also work.
3. `config/connectors.json` → `discord` block: `token`, `guildId`, `channels`
   (ids or names), `subdir` (e.g. `engineering`), `lookbackDays`.
4. `npm run connectors:discord` → `wrote N conversation file(s) to
   brain-sources/<subdir>/discord/`. Main-channel messages are grouped one file
   per UTC day; active threads get one file each. Incremental via
   `.discord-cursor.json` (highest message id per channel); `-- --full` re-pulls
   the window.
5. Commit `brain-sources/<subdir>`, `gbrain sync --source <that source>`.
