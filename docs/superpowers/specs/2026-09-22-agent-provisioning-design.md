# Agent Provisioning — Design Spec

Status: Draft, awaiting review
Author: brainstormed with the product owner, 2026-09-22
Related: `docs/BRAIN_CONNECTORS.md`, `lib/console/data.ts`, `packages/brain/src/cli.ts` (`gbrain auth`, `gbrain serve --http`)

## 0. Objective

Close the fourth step of the pipeline the user referenced (Federate → Scope
→ Extract skills → **Provision**): let an admin issue a named person a
real, scoped, revocable endpoint that their own AI agent/tool can connect
to directly — not just browse tako's own Ask screen. The other three steps
already exist in tako (connectors, per-member access groups, skill
extraction); this spec closes the one real gap.

## 1. Non-goals

- **Not self-service.** Only an admin issues or revokes an endpoint
  (decided in brainstorming) — no employee-initiated request flow, no
  fully open self-serve minting.
- **Not write access.** A provisioned endpoint is read-only knowledge
  access — no `write`/`admin` gbrain scope, no skill execution
  (`submit_agent`), no `put_page`/`delete_page`. This is the same
  boundary as what the person already sees in tako's own Ask screen,
  just reachable from their own tool.
- **Not a new token/scope system.** This wires tako's existing
  Team & Permissions access-group model onto `gbrain`'s existing OAuth
  2.1 client infrastructure (`gbrain auth create`/`rescope-client`/
  `revoke-client`) — it does not reimplement token issuance, storage, or
  the OAuth flow itself.
- **Not federation beyond a person's existing scope.** A provisioned
  endpoint's `--federated-read` list is computed *from* the member's
  current access group (`Member.read`, `lib/console/data.ts`) — an admin
  cannot grant an endpoint broader access than that person already has
  in tako's own UI.

## 2. Architecture overview

Two things need to exist for provisioning to mean anything:

1. **A running `gbrain serve --http` daemon** — the actual MCP HTTP
   server every provisioned client connects to. This does not exist in
   tako's operational setup today (confirmed: no reference to
   `serve --http` anywhere in `bin/omnibrain` or the sync daemon). It
   needs to be started and kept alive the same way `bin/omnibrain`
   already manages the `alethia serve` process (see `stopAlethiaServe`/
   `findAlethiaServe` in `bin/omnibrain`) — one long-running process per
   `GBRAIN_HOME`, not one per provisioned client.
2. **A provisioning layer in `scripts/demo.ts`** that, given a member id,
   reads their current `Member.read` sources, shells out to
   `gbrain auth create --federated-read <sources> --surface starter
   --scopes read --token-endpoint-auth-method none` (public PKCE-only
   client — no secret to leak, matching the "revocable any time, no
   standing secret to rotate" goal), and returns the resulting client's
   connection info to the UI exactly once.

Tako stores **no new credential state of its own** — `gbrain auth
clients --json` is the source of truth for what's issued, to whom, and
with what scope. Team & Permissions reads that list to render each
member's provisioned-endpoint status; it never caches or duplicates it.

## 3. Provisioning flow

New admin-gated route, `POST /api/permissions/provision`, in
`scripts/demo.ts`:

```
{ memberId: string }
  → look up Member by id (lib/console/data.ts:loadMembers)
  → if no member.read sources: 400, "this member has no granted access to provision from"
  → gbrain auth create --federated-read <member.read.join(",")> --surface starter
      --scopes read --token-endpoint-auth-method none
  → parse the created client's id + connection URL from gbrain's output
  → return { clientId, mcpUrl, cliCommand } — shown ONCE in the UI,
    same "reveal once, never re-displayed" pattern already used for the
    one-time admin token at server startup
```

**UI (Team & Permissions member detail panel):** a new "Issue agent
access" button, gated behind the existing admin-token flow (same
`adminApi()` client helper every other mutating action already uses).
On success, a dismissible panel shows the MCP URL and the equivalent
`omnibrain connect` CLI command once, with a clear "copy this now — it
will not be shown again" notice, and the panel's "Provisioned agent
access" row updates to show the new client's id and issue date (read
from `gbrain auth clients --json`, not tako's own state).

## 4. Revocation flow

New admin-gated route, `POST /api/permissions/revoke-provision`:

```
{ clientId: string } → gbrain auth revoke-client <clientId>
```

The member detail panel's "Provisioned agent access" row gets a
"Revoke" button next to each listed client. Revocation is immediate and
irreversible (`gbrain auth revoke-client` hard-deletes the client,
cascading to its tokens) — this matches tako's existing "revocable any
time" requirement literally, and needs no confirmation dialog beyond the
button label itself (consistent with how Reject/Ask administrator work
in Approvals today — no extra confirm step for an admin-gated action).

## 5. Security considerations

This is the one part of tako that, once shipped, lets something other
than tako's own server read company knowledge directly. Treat it with
the same weight as the redaction/approval gates elsewhere:

- **Scope ceiling, not scope choice.** The admin does not pick which
  sources to grant — the endpoint is always computed from the member's
  *already-granted* `Member.read` list. This removes an entire class of
  mistake (an admin accidentally over-granting a scope in the
  provisioning UI that the person doesn't have in tako itself).
- **`--surface starter`, never `full`.** `full` exposes every gbrain op,
  including operator-level ones (`config`, `autopilot`, `storage`); an
  external agent has no business reaching those. `starter` is gbrain's
  own "~20-op" middle tier — read/search operations only, matching the
  read-only decision.
- **No standing secret.** `--token-endpoint-auth-method none` mints a
  public, PKCE-only OAuth client — there is no client secret for tako,
  the admin, or a leaked screenshot to expose. The connection itself
  still requires the person's own OAuth consent on first use.
- **Token TTL stays at gbrain's default** (`--token-ttl` defaults to
  3600s access tokens, refreshed transparently by the OAuth flow) — do
  not raise it for convenience; a shorter-lived access token bounds the
  blast radius of a leaked one automatically.
- **Audit.** `gbrain auth clients --usage --json` already gives a
  per-client op-call count and last-seen timestamp — surface this in the
  member detail panel (read-only, no action needed) so "is this
  endpoint actually being used, and for what" is answerable without a
  separate audit system.
- **This is genuinely different from everything else in Team &
  Permissions today**, and the UI copy must say so plainly: existing
  access groups control what a person sees *inside tako's own screens*;
  a provisioned endpoint is the first thing in tako that lets an
  external tool reach the data directly. The "Issue agent access" button
  and its confirmation copy must not read like just another checkbox.

## 6. Operational concerns

`gbrain serve --http` needs a lifecycle owner. Two options, deferred to
the implementation plan to decide against real constraints (not decided
here):

- Extend `bin/omnibrain`'s existing daemon-management pattern
  (`findAlethiaServe`/`stopAlethiaServe`) to also manage an MCP-serve
  process, started once and left running.
- Start it lazily on first provisioning request and manage its PID the
  same way `scripts/sync-daemon.ts` manages its own lock file
  (`config/.sync-daemon.lock`).

Either way: if no MCP server is running, the "Issue agent access" flow
must fail clearly ("no MCP server running — start it with `omnibrain
serve` first") rather than mint a client credential that points at
nothing.

## 7. Error handling

- `gbrain auth create` failing (e.g. no brain configured) returns the
  real error text to the admin, not a generic failure — this is an
  admin-only, low-frequency action where a clear error matters more than
  a friendly one.
- A member with an empty `Member.read` list is rejected before ever
  calling `gbrain auth create` (400, clear message) rather than minting
  a scopeless/useless client.
- Revoking a `clientId` that no longer exists (already revoked, e.g. in
  a race between two admin tabs) is treated as success, not an error —
  the end state (client does not exist) is what the caller wanted.

## 8. Testing strategy

- The route handlers' input validation (empty `Member.read`, missing
  `memberId`) is unit-testable without a real `gbrain` call, following
  the existing pattern in `tests/console-scopes.test.ts`.
- The `gbrain auth create`/`revoke-client` shell-outs themselves are
  integration-tested against a real local gbrain instance in CI/manual
  verification only (same precedent as `tests/connectors-all.test.ts`'s
  real-sync tests) — not mocked, since the whole point is confirming the
  minted client can actually connect with the right scope.
- Manual verification step for the implementation plan: after issuing an
  endpoint, connect an actual MCP client (e.g. `gbrain auth test <url>
  --token <token>`, already a built-in smoke-test command) and confirm
  it can read only the member's granted sources and nothing else.

## 9. Removal / fallback

If this needs to be pulled back after shipping: revoke every issued
client (`gbrain auth clients --json` lists them all), stop the MCP HTTP
daemon, remove the two new routes and the UI button. No tako-owned data
model to migrate away from, since state lives entirely in gbrain's own
OAuth client store.
