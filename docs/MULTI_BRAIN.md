# Multi-brain sources and scopes

This installation uses GBrain's source-level access controls: source IDs are
the permission boundary, and connector output is written beneath the matching
source repository. GBrain enforces `--federated-read` on the server, rather
than relying on a client-side filtering convention.

## Source split

| Source ID | Contents | Connector configuration |
| --- | --- | --- |
| `shared` | Company-wide Notion knowledge that can be read across departments | `notion`: `sourceDir: "brain-sources"`, `subdir: "shared"` |
| `engineering` | Engineering collaboration captured from Slack | `slack`: `sourceDir: "brain-sources"`, `subdir: "engineering"` |
| `personal-notes` | Local notes, isolated by default | `notes`: `sourceDir: "brain-sources"`, `subdir: "personal-notes"` |

Each connector still owns its own provenance directory below its configured
source (for example, `brain-sources/shared/notion/` and
`brain-sources/engineering/slack/`). Cursor files are also source-local. The
`subdir` field is required, relative to `sourceDir`, and is validated so it
cannot escape that directory. Adding a department is therefore a configuration
and source-registration change, not a code change.

The current source repositories are local Git repositories because `gbrain
sources add` requires a committed repository. They can be moved to private
remotes later; do not put customer content in a public remote.

## Host setup

All host-side commands use the dedicated brain home, never `~/.gbrain/`:

```bash
export GBRAIN_HOME="$HOME/.aletheia-brain"
cd packages/brain

bun src/cli.ts sources add shared --path "<repo>/brain-sources/shared" --name "Shared company knowledge"
bun src/cli.ts sources add engineering --path "<repo>/brain-sources/engineering" --name "Engineering collaboration"
bun src/cli.ts sources add personal-notes --path "<repo>/brain-sources/personal-notes" --name "Personal notes"
bun src/cli.ts sync --all
bun src/cli.ts sources status
```

Connector runs pick up the department destinations from the gitignored
`config/connectors.json`:

```bash
npm run connectors:notion
npm run connectors:slack
npm run connectors:notes
```

## Scoped clients

Register one client for every person or their agent. Use a person-specific
name supplied by the operator; do not reuse the test names below for a real
person. A typical read-only roster looks like:

```bash
export GBRAIN_HOME="$HOME/.aletheia-brain"
cd packages/brain

bun src/cli.ts auth register-client <engineering-person> --scopes "read" --source engineering --federated-read engineering,shared
bun src/cli.ts auth register-client <shared-person> --scopes "read" --source shared --federated-read shared
bun src/cli.ts auth register-client <notes-person> --scopes "read" --source personal-notes --federated-read personal-notes,shared
```

The command prints the client secret once. Store it only in the person's local
agent secret store. Add `write` only when that person needs to create pages,
and use `--bound-slug-prefixes <person>/` for a write-capable client where its
writes must be limited to a folder.

## Isolation check

For the initial setup, three read-only verification clients were registered:
`test-engineering`, `test-shared`, and `test-personal-notes`. Their credentials
are retained only under the isolated brain home with owner-only permissions.

Run the server on the host:

```bash
export GBRAIN_HOME="$HOME/.aletheia-brain"
cd packages/brain
bun src/cli.ts serve --http --port 8787 --bind 127.0.0.1
```

On a separate machine, or an ephemeral scratch home on the same machine, make
a thin client using a test person's client ID and secret. A scratch home is
intentional here: it prevents the thin-client config from overwriting the host
brain configuration and never touches `~/.gbrain/`.

```bash
export GBRAIN_HOME="$(mktemp -d /tmp/tako-scope-test.XXXXXX)"
cd packages/brain
bun src/cli.ts init --mcp-only \
  --issuer-url http://127.0.0.1:8787 \
  --mcp-url http://127.0.0.1:8787/mcp \
  --oauth-client-id <engineering-person-client-id> \
  --oauth-client-secret <engineering-person-client-secret>

bun src/cli.ts list --source engineering  # allowed
bun src/cli.ts list --source shared       # allowed
bun src/cli.ts list --source personal-notes  # must fail: permission_denied
```

The initial check passed: the engineering thin client listed `engineering` and
`shared`; the shared thin client's request for `engineering` failed with
`permission_denied`. This verifies the server-side source scope, not merely a
UI filter. Repeat it whenever clients or federated reads change.

All ingestion, embeddings, and synthesis remain local-only (Ollama); this
setup sends no ingested content to a hosted API.

## Post-split notes (verified 2026-08-28 by Claude)

- After splitting into `shared` / `engineering` / `personal-notes`, the migrated
  pages imported but did **not** re-embed automatically (`sources status` showed
  EMBED 0%). Fix: `GBRAIN_HOME=~/.aletheia-brain bun src/cli.ts embed --all`
  (now 100%). Run `embed --all` after any source re-registration.
- The legacy `default` source cannot be removed ("it backs the pre-v0.17 brain").
  It is empty and harmless — ignore the "never synced" warning for it.
- `gbrain think --source X` takes a **single** source id (not comma-separated).
  To query across departments, either set the relevant sources `federated: true`
  or run `think` once per source. Decide this when wiring saved questions.
- Verified working: `think --source shared "…PoC…" --model ollama:qwen2.5:3b-instruct`
  returns a cited JA answer from the Notion page.
