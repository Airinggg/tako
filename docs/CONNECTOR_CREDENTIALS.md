# Where do I get each connector's access token?

One place to find every connector's credential guide, so you don't have to
ask again. Each service also links here directly from the app itself:
open **Connected Apps**, select a service, and use its **"Where do I get
this token?"** link — served read-only from this same directory
(`docs/connectors/`) by the demo app, so it's always in sync with what's
below.

| Service | Env var (`config/connectors.json`) | Guide |
|---|---|---|
| Notion | `NOTION_TOKEN` | [notion-credentials.md](connectors/notion-credentials.md) — internal connection, read-only, scoped to specific pages/databases |
| Slack | `SLACK_BOT_TOKEN` | [slack-credentials.md](connectors/slack-credentials.md) — bot token, `channels:history`/`channels:read`/`users:read` scopes |
| Google Drive | `GOOGLE_DRIVE_ACCESS_TOKEN` | [drive-credentials.md](connectors/drive-credentials.md) — OAuth access token, `drive.readonly` scope; supervised-trial only, expires ~hourly |
| Discord | `DISCORD_BOT_TOKEN` | [discord-credentials.md](connectors/discord-credentials.md) — bot token, view-channel + read-message-history permissions only |

Local Notes, CAD exports, and MCP servers don't need a token from an
external provider — see `docs/BRAIN_CONNECTORS.md` for those.

## Common rules across every guide above

- Never put the real token value in `config/connectors.json` (only
  `env:VARNAME` references belong there), Git, chat, or a screenshot.
- Set it as an environment variable on the machine running Tako:
  ```bash
  export NOTION_TOKEN='<your-token>'
  ```
  This lasts only for the current terminal session — for repeated use,
  store it in your organization's approved local secret store.
- `config/connectors.example.json` already shows the exact `env:` reference
  each connector expects.
- After setting the token, run `./bin/omnibrain setup` then
  `./bin/omnibrain connect <service>` to verify the connection.
