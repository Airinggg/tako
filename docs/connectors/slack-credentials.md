# Slack credentials

Create a Slack app in your company's workspace and use its **Bot User OAuth Token**. The bot reads only channels it can access. Your workspace may require an administrator to approve or install the app.

## Create and install the app

1. Open [Slack Your Apps](https://api.slack.com/apps), sign in, and select **Create New App** > **From scratch**. Name it `Tako read-only` and choose the correct workspace.
2. Open **OAuth & Permissions** in the app's left menu. Under **Bot Token Scopes**, add `users:read`, `channels:read`, and `channels:history`. Tako uses these to resolve names, list public channels, and read public-channel messages and threads.
3. Only if you need private channels, also add `groups:read` and `groups:history`. Do not grant `chat:write`, `files:read`, admin scopes, or DM scopes for this connector. Tako's configured channel list does not collect DMs or file contents.
4. Near the top of **OAuth & Permissions**, select **Install to Workspace** (or **Reinstall to Workspace** after changing scopes), review the permission request, and select **Allow**. If installation is blocked, ask a workspace administrator to approve it; do not use a personal user token as a workaround.
5. Return to **OAuth & Permissions** and copy the **Bot User OAuth Token**, not the User OAuth Token or app-level token.
6. In each selected Slack channel, invite the app/bot as a member. For a private channel, an existing member must invite it. A history scope does not bypass channel membership.

Put the bot token in the `SLACK_BOT_TOKEN` environment variable on the machine running Tako. Replace the placeholder with your own token:

```bash
export SLACK_BOT_TOKEN='<your-slack-bot-token>'
```

This command lasts only for the current terminal session. For repeated use, store the token in your company's approved local secret store or shell environment; never put the real value in `config/connectors.json`, Git, chat, or screenshots. `config/connectors.example.json` already refers to `env:SLACK_BOT_TOKEN`.

In `config/connectors.json`, replace `<channel-id-or-name>` under `slack.channels` with the selected channel ID or name. From the repository directory, run `./bin/omnibrain setup` and then `./bin/omnibrain connect slack`. If a channel is missing or returns an access error, check bot membership, the channel ID, scopes, and whether you reinstalled after changing scopes.

Sources: [Slack bot tokens](https://docs.slack.dev/authentication/tokens/), [retrieving messages and installation](https://docs.slack.dev/messaging/retrieving-messages/), [thread replies](https://docs.slack.dev/reference/methods/conversations.replies/).
