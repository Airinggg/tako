# Discord credentials

Create a Discord application with a **bot** and install it in the server you want Tako to read. The bot token is not a personal Discord login token. A server member with **Manage Server** permission must authorize the installation.

## Create and install the bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications), sign in, and select **New Application**. Give it a recognizable name such as `Tako read-only`.
2. Open **Bot** in the left menu. Under **Token**, select **Reset Token** (Discord may ask for account verification), then copy the newly displayed bot token and keep it private. If you lose it, reset it again; the previous token will stop working.
3. Open **Installation**. Enable **Guild Install**. Under **Default Install Settings** for Guild Install, select the `bot` scope and only the **View Channels** and **Read Message History** bot permissions. Do not grant Administrator, Send Messages, Manage Messages, or other write permissions.
4. Copy the install link, open it, choose **Add to server**, select the correct server, and authorize. If you cannot select the server, ask a person with **Manage Server** permission to install it.
5. In the server, check the bot's role and each selected channel's permission overrides. It must be allowed to **View Channel** and **Read Message History** in the channels and threads Tako should read. Keep unrelated/private channels inaccessible.
6. Open **User Settings** > **Advanced** in Discord and enable **Developer Mode**. Right-click the server and choose **Copy Server ID**; right-click each chosen channel and choose **Copy Channel ID**. These IDs are not secrets.

Put the bot token in the `DISCORD_BOT_TOKEN` environment variable on the machine running Tako. Replace the placeholder with your own bot token:

```bash
export DISCORD_BOT_TOKEN='<your-discord-bot-token>'
```

This command lasts only for the current terminal session. For repeated use, store the token in your company's approved local secret store or shell environment. Never put the real value in `config/connectors.json`, Git, chat, or screenshots. `config/connectors.example.json` already refers to `env:DISCORD_BOT_TOKEN`.

In `config/connectors.json`, replace `<guild-id>` under `discord.guildId` and `<channel-id-or-name>` under `discord.channels`. From the repository directory, run `./bin/omnibrain setup` and then `./bin/omnibrain connect discord`. If channels are empty, check server/channel IDs and channel permissions. If message bodies are empty, review Discord's **Bot** > **Privileged Gateway Intents** > **Message Content Intent** setting and any approval requirement; do not enable unrelated intents. Tako uses the HTTP API, but Discord's message-content restriction can affect returned message fields.

Sources: [Discord first bot setup](https://docs.discord.com/developers/quick-start/getting-started), [bot authorization and permissions](https://docs.discord.com/developers/platform/oauth2-and-permissions), [reading channel messages](https://docs.discord.com/developers/resources/message).
