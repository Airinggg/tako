# Notion credentials

Use a Notion **internal connection** belonging to your own workspace. It only reads the pages and databases you give it access to. A Notion Workspace Owner must create it; ask an owner if you cannot see that option.

## Create the connection

1. Open the [Notion Developer portal](https://www.notion.so/profile/integrations) and sign in to the Notion workspace you want to connect.
2. Under **Build**, open **Internal connections** and select **Create a new connection**.
3. Give it a recognizable name such as `Tako read-only`, and choose the correct workspace.
4. Open the connection's **Configuration** tab. Allow **Read content**. Do not enable **Insert content** or **Update content**. Enable **Read user information** only if your workspace requires it for the pages you chose.
5. Open **Content access** > **Edit access**. Select only the pages and databases Tako should read. Alternatively, open each page or database in Notion, choose **•••** > **Connections**, and add this connection. A token alone does not grant access to a page.
6. In **Configuration**, copy the **Installation access token**. Do not copy a connection ID instead.

Put that token in the `NOTION_TOKEN` environment variable on the machine running Tako. For example, in a terminal, replace the placeholder with your own token:

```bash
export NOTION_TOKEN='<your-notion-installation-access-token>'
```

This command lasts only for the current terminal session. For repeated use, store the token in your company's approved local secret store or shell environment; do not put the real value in `config/connectors.json`, a committed file, a chat message, or a screenshot. `config/connectors.example.json` already refers to `env:NOTION_TOKEN`.

In `config/connectors.json`, replace `<database-id>` under `notion.databases` with the ID of an authorized database, or add authorized page IDs under `notion.pages`. From the repository directory, run `./bin/omnibrain setup` and then `./bin/omnibrain connect notion`. If a page is missing or returns 403/404, check both its ID and the connection's **Content access**.

Source: [Notion internal connections](https://developers.notion.com/guides/get-started/internal-connections).
