# Zoom credentials

Zoom is different from tako's other connectors: it does not ingest data. It's used only by the Automations page's follow-up-meeting flow — after you propose and confirm a meeting there, tako calls Zoom's API to actually create it. Because of that, its credentials are **environment variables on the machine running tako, not something typed into this app.**

Create a **Server-to-Server OAuth app**, not a regular user-login app — this connector never asks a person to sign in with Zoom; it authenticates as your Zoom account directly.

## Create the app

1. Sign in to the [Zoom App Marketplace](https://marketplace.zoom.us/) with an account that has permission to manage apps for your Zoom account (an account owner or admin, typically).
2. Select **Develop** > **Build App**, then choose **Server-to-Server OAuth** as the app type. Name it something recognizable, e.g. `tako`.
3. On the app's **Scopes** page, add:
   - `meeting:write:meeting` (or the closest available "create meeting" scope for your Zoom plan) — needed to create the meeting.
   - `meeting:read:meeting` — needed to read back the created meeting's join/start links.
   Do not add broader scopes (recording access, user management, webinar access, etc.) — this connector only creates and reads back individual meetings.
4. On the app's **App Credentials** page, copy the **Account ID**, **Client ID**, and **Client Secret**. These three values authenticate tako directly to your Zoom account — there is no per-user login step.
5. Activate the app (Server-to-Server apps must be explicitly activated before their credentials work).

## Set the environment variables

Put all three values in the environment on the machine running tako:

```bash
export ZOOM_ACCOUNT_ID='<your-zoom-account-id>'
export ZOOM_CLIENT_ID='<your-zoom-client-id>'
export ZOOM_CLIENT_SECRET='<your-zoom-client-secret>'
```

These commands last only for the current terminal session. For repeated use, store them in your company's approved local secret store or shell profile — never put the real values in `config/connectors.json`, Git, chat, or screenshots. tako never writes them to any file it creates.

Once set, restart tako. The Zoom card on this screen will show "Connected" once all three variables resolve — this is a local presence check, not a live call to Zoom, so it confirms the variables are set but not that the values are actually valid. The first real confirmation is trying to create a meeting from the Automations page; a bad credential surfaces there as a clear error naming the failed step, before anything is reported as created.

Sources: [Zoom Server-to-Server OAuth app guide](https://developers.zoom.us/docs/internal-apps/create/), [Zoom API scopes reference](https://developers.zoom.us/docs/internal-apps/scopes/).
