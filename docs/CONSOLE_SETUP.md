# GBrain console setup

The product console is GBrain's bundled admin SPA, served at `/admin`. It is
local-first: keep `GBRAIN_HOME` set to the isolated Tako brain and do not
send Lirem content to hosted services.

## Build and serve

From the repository root:

```sh
cd packages/brain/admin
bun install
bun run build

cd ..
export GBRAIN_HOME="$HOME/.aletheia-brain"
bun src/cli.ts serve --http --port 8787
```

`serve --http` binds to `127.0.0.1` by default. Open
`http://localhost:8787/admin` (the trailing slash is added by the server).
For a remote deployment, use an authenticated HTTPS reverse proxy and set
`--public-url`; do not expose the local brain casually with `--bind 0.0.0.0`.

The server creates a fresh admin bootstrap token on each start and prints it
only to an interactive terminal by default. Paste it into the `/admin` login
screen; that POST creates a 24-hour HttpOnly session cookie. For an explicit,
stable operator secret, set `GBRAIN_ADMIN_BOOTSTRAP_TOKEN` to a 32+-character
`[A-Za-z0-9_-]` value before starting the server. An operator/agent holding
that bootstrap token can alternatively POST it as `Authorization: Bearer …` to
`/admin/api/issue-magic-link`, then open the returned single-use URL (valid for
five minutes). Use `--print-admin-token` only when deliberately accepting the
risk of putting the generated secret in non-interactive logs.

## Console pages

- **Dashboard** — aggregate brain statistics and health indicators.
- **Agents** — scoped OAuth clients, source grants, token lifetimes, and legacy API keys.
- **Request Log** — paginated recent MCP requests (the live activity feed is `/admin/events`).
- **Jobs Watch** — a snapshot of durable/minion job state.
- **Calibration** — owner/holder calibration profiles and SVG charts.

On a newly initialized or near-empty brain, these pages should render with
empty/zero-state data; that is expected.

## Admin API used by the SPA

All endpoints below are same-origin and require the admin cookie unless noted.

- `POST /admin/login` — exchange the bootstrap token for an admin session.
- `POST /admin/api/sign-out-everywhere` — revoke active admin sessions.
- `GET /admin/api/stats` and `GET /admin/api/health-indicators` — dashboard data.
- `GET /admin/api/agents` and `GET /admin/api/sources` — agents and sources.
- `GET /admin/api/requests?page=N…` — request-log data.
- `GET|POST /admin/api/api-keys`, `POST /admin/api/api-keys/revoke` — legacy API-key management.
- `POST /admin/api/update-client-ttl`, `POST /admin/api/rescope-client`, and
  `POST /admin/api/revoke-client` — scoped client administration.
- `GET /admin/api/calibration/profile?holder=…` and
  `GET /admin/api/calibration/charts/:type?holder=…` — calibration data/chart SVG.
- `GET /admin/api/jobs/watch` — jobs dashboard data.

The server also exposes `POST /admin/api/issue-magic-link` (bootstrap bearer
token, not an admin cookie) and `GET /admin/events` for the authenticated SSE
feed. Additional server-only admin routes include spending, full stats,
calibration patterns, and client registration; they are not called by the
current SPA API wrapper.

## Vendored UI boundary

Do not rebrand or edit `packages/brain/admin/`: it is vendored upstream code.
If Tako needs a branded console later, copy `admin/` to `apps/console/` and
repoint the build/serve integration there. Keep the upstream subtree intact.

## Scoped endpoints

Register each employee on the brain host. This writes a scoped OAuth client to
the local brain and exchanges its client credentials locally; it does not call
a hosted model or API. The HTTP server need not already be running to mint the
client, although the command probes `/health` when it is reachable and the
employee needs the server running before their MCP client can connect.

For a read-only employee with access only to the `default` source:

```sh
cd packages/brain
export GBRAIN_HOME="$HOME/.aletheia-brain"
bun src/cli.ts agent register lirem-aoki \
  --harness claude-code \
  --scopes read \
  --source default \
  --federated-read default \
  --port 8787 \
  --show-token
```

Replace `default` with the specific Lirem source IDs that person may read, and
list every allowed source explicitly in `--federated-read`. Use only `read`
for employees who should not write. Never grant `admin`, `users_admin`, or
`sources_admin`; `agent register` itself blocks those operator scopes. The
minted access token defaults to a 30-day TTL (`2592000` seconds); choose a
shorter `--token-ttl SECONDS` where appropriate. The HTTP server's general
token default is one hour, so do not omit the agent command's TTL expectation.

The command prints the secret only with `--show-token`; paste its generated
block privately and do not commit it. The Claude Code equivalent is:

```sh
claude mcp add lirem-aoki -t http http://localhost:8787/mcp \
  -H 'Authorization: Bearer <PRINTED_ACCESS_TOKEN>'
```

For a shared/non-local deployment, replace the loopback URL with the brain
host's HTTPS `/mcp` URL. Reissue a lost credential with
`gbrain agent register --reissue <client-id> --harness claude-code --port 8787
--show-token`; revoke a departing employee with `gbrain auth revoke-client
<client-id>`.
