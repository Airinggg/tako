# Agent Provisioning — Design Spec

Status: Draft, awaiting review
Author: brainstormed with the product owner, 2026-09-22
Related: `docs/BRAIN_CONNECTORS.md`, `lib/console/data.ts`, `scripts/console.ts`
(existing `invite`/`revoke` — this spec extracts and fixes them, not a
from-scratch build), `lib/cli/serve-runtime.ts`, `packages/brain/src/cli.ts`
(`gbrain auth`, `gbrain serve --http`)

## 0. Objective

Close the fourth step of the pipeline the user referenced (Federate → Scope
→ Extract skills → **Provision**): let an admin issue a named person a
real, scoped, revocable endpoint that their own AI agent/tool can connect
to directly — not just browse tako's own Ask screen. The other three steps
already exist in tako (connectors, per-member access groups, skill
extraction); this spec closes the one real gap.

**Important correction found while grounding this spec:** Team &
Permissions' existing "members" (`lib/console/data.ts:loadMembers`) are
*already* gbrain OAuth clients — `loadMembers()` reads directly from
`gbrain auth clients --json` and maps each one's `federated_read` into
`Member.read`. So a "member" is not a separate tako-owned employee
record with no credential yet; it already has one. This is exactly why
provisioning must mint a **second, dedicated, separately-revocable
client** per person for personal agent use — reusing or rescoping
whatever client already backs their "member" entry would silently change
the scope/purpose of a credential that may already be serving something
else. §2 and §3 already reflect this (a fresh `register-client` call,
never a `rescope-client` of the member's own existing client id).

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
  2.1 client infrastructure (`gbrain auth register-client`/
  `rescope-client`/`revoke-client`) — it does not reimplement token
  issuance, storage, or the OAuth flow itself.
- **Not federation beyond a person's existing scope.** A provisioned
  endpoint's `--federated-read` list is computed *from* the member's
  current access group (`Member.read`, `lib/console/data.ts`) — an admin
  cannot grant an endpoint broader access than that person already has
  in tako's own UI.

## 2. Architecture overview

Two things need to exist for provisioning to mean anything:

1. **A running `gbrain serve --http` daemon** — the actual MCP HTTP
   server every provisioned client connects to. Correction from the
   brainstorming draft: this is **not new work** — `lib/cli/serve-runtime.ts`
   already fully implements this (`serveGbrain()` spawns `gbrain serve
   --http`, `findAlethiaServe()`/`stopAlethiaServe()` manage its
   lifecycle via a state file, and `./bin/omnibrain serve` already calls
   `serveGbrain()`). What's missing is only: (a) the provisioning route
   calling `findAlethiaServe()` to check it's up before minting a client,
   starting it via `serveGbrain()` if not; and (b) a real bug —
   `serve-runtime.ts`'s `GBRAIN_HOME` constant is hardcoded to
   `~/.aletheia-brain` and does not read `process.env.GBRAIN_HOME`, unlike
   `lib/eval/qa.ts`'s `gbrainHome()`. Left as-is, the MCP server would
   serve the wrong brain home whenever `GBRAIN_HOME` is overridden (as it
   already is via `.env` in this project). This must be fixed as part of
   this feature (Task 1 in the plan) or every provisioned endpoint will
   point at an empty or wrong brain.
2. **A provisioning layer — reused, not duplicated.** Second correction:
   `scripts/console.ts` already has a working `invite()`/`revoke()` pair
   doing almost exactly this (its own header: "the only brain mutations
   exposed here are the existing register-client and revoke-client invite
   actions"). Its `invite()` runs:
   ```typescript
   gb(["auth", "register-client", name, "--scopes", "read", "--source", source, "--federated-read", reads.join(",")])
   ```
   confirming `register-client` (not `auth create`) is correct — but it
   has two gaps this feature must close, not re-solve elsewhere:
   - It never pins `--surface starter` after registration, so an invited
     client gets whatever surface the server defaults to (`full`, per
     gbrain's own help text) — every non-goal in §1 about read-only,
     starter-tier access depends on this being fixed.
   - It uses the same hardcoded `GBRAIN_HOME` (`~/.aletheia-brain`,
     ignoring `process.env.GBRAIN_HOME`) as `serve-runtime.ts` — the same
     bug, in a second file.

   **Resolved architecture:** extract `invite`/`revoke` out of
   `scripts/console.ts` into a new shared module, `lib/console/provision.ts`
   (mutations live separately from `lib/console/data.ts`'s read-only
   helpers, preserving that file's own documented boundary — "nothing
   here mutates the brain"). The extracted `invite()` gains the missing
   `rescope-client --surface starter` call and the `GBRAIN_HOME` fix
   (reading `process.env.GBRAIN_HOME`, matching `lib/console/data.ts`'s
   already-correct pattern). `scripts/console.ts` is refactored to import
   from it instead of keeping its own copy (DRY — one implementation, two
   UIs). `scripts/demo.ts`'s new routes import the same module. No
   parallel/duplicate provisioning logic exists after this.

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
  → findAlethiaServe() (lib/cli/serve-runtime.ts) — if not running, call
    serveGbrain() to start it before proceeding
  → lib/console/provision.ts:invite(personalClientName, member.write, member.read,
      { surface: "starter", tokenEndpointAuthMethod: "none" })
    (personalClientName is derived, not admin-typed — e.g. `${member.name}-agent`,
     so it's visibly distinct from the member's own existing client in
     `gbrain auth clients` and never collides with it)
  → invite() internally: register-client (--scopes read, --federated-read,
    --token-endpoint-auth-method none) then rescope-client --surface starter,
    returns { clientId, ... }
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
{ clientId: string } → lib/console/provision.ts:revoke(clientId)
  (thin wrapper over gbrain auth revoke-client, same validation
  scripts/console.ts's revoke() already has: reject anything not
  matching /^gbrain_cl_[a-f0-9]+$/ before shelling out)
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

## 6. Operational concerns — resolved

**Resolved (was open in the first draft): reuse the existing daemon
pattern, do not build a lazy lock-file alternative.**
`lib/cli/serve-runtime.ts` already owns this lifecycle end to end
(`serveGbrain()`, `findAlethiaServe()`, `stopAlethiaServe()`, a state
file keyed by repo root) and `./bin/omnibrain serve` already exposes it.
The provisioning route calls `findAlethiaServe()`; if it returns `null`,
the route calls `serveGbrain([])` itself before proceeding, rather than
failing and telling the admin to run a separate command — provisioning
should "just work" the first time an admin uses it. The
`GBRAIN_HOME`-hardcoding bug noted in §2 must be fixed first, or the
started server points at the wrong brain home.

## 7. Error handling

- `gbrain auth register-client`/`rescope-client` failing (e.g. no brain
  configured) returns the real error text to the admin, not a generic
  failure — this is an admin-only, low-frequency action where a clear
  error matters more than a friendly one.
- A member with an empty `Member.read` list is rejected before ever
  calling `gbrain auth register-client` (400, clear message) rather than
  minting a scopeless/useless client.
- Revoking a `clientId` that no longer exists (already revoked, e.g. in
  a race between two admin tabs) is treated as success, not an error —
  the end state (client does not exist) is what the caller wanted.

## 8. Testing strategy

- The route handlers' input validation (empty `Member.read`, missing
  `memberId`) is unit-testable without a real `gbrain` call, following
  the existing pattern in `tests/console-scopes.test.ts`.
- The `gbrain auth register-client`/`rescope-client`/`revoke-client`
  shell-outs themselves are
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
