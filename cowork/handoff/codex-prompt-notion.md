You are Codex on branch `feat/brain-foundation`. Read `cowork/HANDOFF.md`,
`cowork/TASKBOARD.md`, and `docs/BRAIN_CONNECTORS.md` first. Then read
`packages/brain/docs/tutorials/company-brain.md` Parts 3 and 4 — they define
gbrain's native connector model. Do tasks 1-3 below, then STOP.

## Design change (important)
gbrain's native ingestion model is **git-backed source directories**:
`gbrain sources add <id> --path <dir>` then `gbrain sync`, where `<dir>` is a
folder of markdown files. "Git as system of record." A connector's job is to
WRITE MARKDOWN FILES into that folder — NOT to keep a bespoke local store and
shell out to `gbrain put`. Supersede the "local raw store + derived entities"
design in `docs/BRAIN_CONNECTORS.md` with this. Update that doc to match.

## Hard rules
- Security option A: no ingested content to any hosted API. Local models only.
- Config-driven only. No hardcoded workspace names, tokens, or "Lirem".
- Always `export GBRAIN_HOME="$HOME/.aletheia-brain"` before any `gbrain` command.
  Never touch `~/.gbrain/`.
- Do NOT edit vendored code under `packages/brain/`.
- Do NOT touch `app/` routes. `npm run build` (repo root) green before each commit.
- Commit after each task. Trailer: `Co-Authored-By: Codex <noreply@openai.com>`.
- Never commit a real token or real Notion content. `config/connectors.json` and
  `brain-sources/` are gitignored (already in `.gitignore` for connectors.json;
  add `brain-sources/`). Commit `config/connectors.example.json`.
- If the sandbox blocks network / a port / `.git/index.lock`: do everything
  offline (code + fixture + unit tests + docs), record what's blocked in
  `cowork/handoff/codex-notion-report.md`, let Claude do the live run.

## TASK 1 — confirm the model
- `cd packages/brain && GBRAIN_HOME="$HOME/.aletheia-brain" bun src/cli.ts integrations list`,
  `... sources add --help`, `... sync --help`. Confirm: no built-in Notion sense;
  whether `gbrain sync` requires the source dir to be a git repo or accepts a
  plain dir; the exact `sources add` / `sync` flags.
- Rewrite `docs/BRAIN_CONNECTORS.md` to the git-backed-source model (keep it
  general, not Lirem-specific). Commit. Tick task 1.

## TASK 2 — generic Notion → markdown connector
Create `lib/connectors/` (project-owned, NOT under packages/brain):

```
lib/connectors/
  shared/config.ts        # load config/connectors.json; "env:NAME" => process.env.NAME; hand-rolled validation, no new deps
  shared/markdown.ts       # record -> markdown string with YAML frontmatter; slugify
  notion/client.ts         # fetch wrapper over https://api.notion.com/v1 (Notion-Version header, token from config)
  notion/collect.ts        # list DB rows / pages from config; fetch block children; -> NotionRecord[]
  notion/render.ts         # NotionRecord -> { path, markdown }  (path under the source dir)
  notion/run.ts            # runnable: collect -> write .md files into <sourceDir> -> print summary
```

- `NotionRecord`: `{ id, workspace, kind: "page"|"db_row", title, url, author?, createdTime, lastEditedTime, text }`.
  `text` = plain-text flattening of the Notion blocks (headings, paragraphs,
  lists, to-dos, callouts, code). Good enough for retrieval; not pixel-perfect.
- Each record becomes `<sourceDir>/notion/<workspace>/<slug>-<id>.md` with
  frontmatter: `id, source: notion, title, url, author, created, updated`.
  Body = the flattened text. Deterministic: same input -> same file.
- Incremental: write `<sourceDir>/.notion-cursor.json` with the max
  `lastEditedTime` seen; on re-run, skip records not newer (still allow `--full`).
- Config `config/connectors.example.json`:
  ```json
  {
    "notion": {
      "token": "env:NOTION_TOKEN",
      "sourceDir": "brain-sources",
      "databases": ["<database-id>"],
      "pages": [],
      "notionVersion": "2022-06-28"
    }
  }
  ```
- Unit tests: checked-in `lib/connectors/notion/__fixtures__/notion-*.json`
  (invented but realistic Notion API payloads for a DB query + a page + block
  children). Assert `collect.ts` mapping and `render.ts` output (frontmatter +
  flattened text). No network, no token in tests. Wire into the repo's test
  runner (check `package.json` `test` and `tests/`).
- Add an npm script `connectors:notion` -> `bun lib/connectors/notion/run.ts`.
- `.gitignore`: add `brain-sources/`. Commit code + example + fixtures + tests.
  Tick task 2.

## TASK 3 — docs/SELF_TEST.md
End-to-end, run on the developer's OWN Notion:
1. Notion: create an internal integration (access-token auth), Read content only,
   share ONE database/page with it (••• -> Connections). Copy the `ntn_...` token.
2. `cp config/connectors.example.json config/connectors.json`; put the database
   id in `databases`; `export NOTION_TOKEN=ntn_...`.
3. `npm run connectors:notion` -> expect "wrote N markdown files to brain-sources/notion/...".
4. Register + sync the source (one time):
   `cd packages/brain && GBRAIN_HOME="$HOME/.aletheia-brain" bun src/cli.ts sources add notion --path "<repo>/brain-sources" --name "Notion"`
   then `... sync` (adjust to the real flags you found in task 1).
5. `... bun src/cli.ts think "<a question only that Notion content can answer>"`
   -> expect a synthesized, cited answer (and a "gap noted" if relevant).
6. Personal endpoint: `... bun src/cli.ts agent register me --harness claude-code
   --preset daily-driver --url http://localhost:8787/mcp --show-token` (server
   from `docs/CONSOLE_SETUP.md` must be running), then `claude mcp add ...` the
   printed block and ask Claude Code the same question.
Mark which steps need network/token so CI skips them. Commit.
Write `cowork/handoff/codex-notion-report.md` (6-12 lines): what you built, what's
tested offline, what needs the live token, and anything the sandbox blocked.

Then STOP. Do not start the Slack connector.
