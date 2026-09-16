# Google Drive credentials

Tako reads files in the folder IDs you configure. It needs a Google **OAuth access token** for an account that can read those folders. A Google API key or OAuth client ID is not an access token. You may need a Google Cloud or Workspace administrator to approve the OAuth app.

**Current limit:** Tako uses `GOOGLE_DRIVE_ACCESS_TOKEN` as a fixed value and does not refresh it. Google access tokens expire, commonly after about an hour. The steps below are suitable for a first, supervised trial. They do **not** make Drive sync self-serve for continuous use; a local OAuth renewal flow is still needed.

## Create an OAuth app for a supervised trial

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select or create a project owned by your organization.
2. Under **APIs & Services** > **Library**, search for **Google Drive API** and select **Enable**.
3. Open **Google Auth platform** > **Branding** and configure the consent screen. Choose **Internal** if only members of your Google Workspace organization will use it; otherwise choose **External** and add the intended account under **Audience** > **Test users** while testing. Your administrator may restrict OAuth apps or require approval.
4. Under **Google Auth platform** > **Data Access**, add the scope `https://www.googleapis.com/auth/drive.readonly`. This permits reading and downloading files. Do not choose the broader read/write `drive` scope. Google classifies `drive.readonly` as restricted; check your organization's approval and Google's verification requirements before a wider rollout.
5. Under **Google Auth platform** > **Clients**, select **Create client** > **Web application**. Name it `Tako Drive trial`. Under **Authorized redirect URIs**, add `https://developers.google.com/oauthplayground`, then create the client. Keep its client ID and client secret private.
6. Open Google's [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/). Select the settings gear, keep **OAuth endpoints: Google**, check **Use your own OAuth credentials**, and enter that web application's client ID and client secret. The Playground is a Google-operated testing tool, not Tako's production credential store; use it only if your organization's policy permits it.
7. In **Step 1**, enter `https://www.googleapis.com/auth/drive.readonly` and select **Authorize APIs**. Sign in as the account that can read the chosen folders and approve the requested read-only access.
8. In **Step 2**, select **Exchange authorization code for tokens**. Copy only the **Access token**. Do not paste the refresh token into Tako; the current connector cannot use it.

Put the access token in the `GOOGLE_DRIVE_ACCESS_TOKEN` environment variable on the machine running Tako. Replace the placeholder with your own access token:

```bash
export GOOGLE_DRIVE_ACCESS_TOKEN='<your-google-drive-access-token>'
```

This command lasts only for the current terminal session. Keep the real value out of `config/connectors.json`, Git, chat, and screenshots. `config/connectors.example.json` already refers to `env:GOOGLE_DRIVE_ACCESS_TOKEN`.

In `config/connectors.json`, replace `<folder-id>` under `drive.folderIds` with a folder ID from that account's Drive URL. From the repository directory, run `./bin/omnibrain setup` and then `./bin/omnibrain connect drive` before the token expires. If it later returns 401, renew the access token; if it returns 403, check account access, OAuth scope, and administrator approval. Do not treat this temporary token flow as a finished unattended deployment.

Sources: [Drive OAuth scopes and token lifetime](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Google Auth platform setup](https://developers.google.com/workspace/drive/api/quickstart/js), [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
