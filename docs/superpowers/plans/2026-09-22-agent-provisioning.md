# Agent Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin issue a named Team & Permissions member a real,
scoped, revocable MCP endpoint their own AI agent can connect to directly
— read-only, bounded to exactly the sources they already have in tako.

**Architecture:** Fix a `GBRAIN_HOME` bug shared by two files by having
them both reuse `lib/eval/qa.ts`'s already-correct `gbrainHome()`. Extract
`scripts/console.ts`'s existing (but incomplete) `invite`/`revoke`
functions into a new shared module, closing their real gap (never pinning
`--surface starter`) along the way. Wire two new admin-gated routes in
`scripts/demo.ts` that call the shared module, lazily starting the
existing `gbrain serve --http` daemon (`lib/cli/serve-runtime.ts`) if it
isn't already running. Extend the Team & Permissions member panel with an
"Issue agent access" button and a revocable client list.

**Tech Stack:** Bun/TypeScript, the vendored `gbrain` CLI's OAuth 2.1
client commands (`auth register-client`/`rescope-client`/`revoke-client`/
`clients --json`), `node:test` + `bun:test` per existing convention.

**Spec:** `docs/superpowers/specs/2026-09-22-agent-provisioning-design.md`

## Global Constraints

- Admin-only, explicit per person — no self-service request flow (spec §1).
- Read-only: always `--scopes read`, never `write`/`admin`; always
  `--surface starter`, never `full` (spec §1, §5).
- Scope is a ceiling, not a choice: the endpoint's `--federated-read` is
  always exactly the member's existing `Member.read` (`lib/console/data.ts`)
  — never admin-typed, never broader (spec §1, §5).
- `--token-endpoint-auth-method none` — no standing client secret (spec §5).
- No new tako-owned credential state — `gbrain auth clients --json` is the
  only source of truth Team & Permissions reads (spec §2).
- One shared implementation for `invite`/`revoke` — `scripts/console.ts`
  and `scripts/demo.ts` both call it; no parallel/duplicate gbrain
  shell-outs (spec §2).

---

### Task 1: Fix the `GBRAIN_HOME` bug by reusing the already-correct helper

**Files:**
- Modify: `lib/cli/serve-runtime.ts:9` (the `GBRAIN_HOME` constant)
- Modify: `scripts/console.ts:19` (the `GBRAIN_HOME` constant)
- Test: `tests/serve-runtime-home.test.ts`

**Interfaces:**
- Consumes: `gbrainHome(): string` from `../lib/eval/qa.ts` (already
  exists, already correct: `process.env.GBRAIN_HOME || join(process.env.HOME
  || "", ".aletheia-brain")`).
- Produces: both files' `GBRAIN_HOME` constants now resolve the same way
  `lib/console/data.ts`'s already does — no new export needed, later tasks
  just rely on this being fixed.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/serve-runtime-home.test.ts
import assert from "node:assert/strict";
import test from "node:test";

test("serve-runtime's GBRAIN_HOME respects a GBRAIN_HOME override", async () => {
  const original = process.env.GBRAIN_HOME;
  process.env.GBRAIN_HOME = "/tmp/test-override-brain";
  try {
    // Re-import with a cache-busting query so the module re-reads env.
    const mod = await import(`../lib/cli/serve-runtime.ts?t=${Date.now()}`);
    assert.equal(mod.GBRAIN_HOME, "/tmp/test-override-brain");
  } finally {
    if (original === undefined) delete process.env.GBRAIN_HOME; else process.env.GBRAIN_HOME = original;
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-strip-types --test tests/serve-runtime-home.test.ts`
Expected: FAIL — `GBRAIN_HOME` is `/Users/<home>/.aletheia-brain`, not the override

- [ ] **Step 3: Fix `lib/cli/serve-runtime.ts`**

Change:
```typescript
export const GBRAIN_HOME = join(process.env.HOME || "", ".aletheia-brain");
```
to:
```typescript
import { gbrainHome } from "../eval/qa.ts";
export const GBRAIN_HOME = gbrainHome();
```

- [ ] **Step 4: Fix `scripts/console.ts`**

Change:
```typescript
const GBRAIN_HOME = join(process.env.HOME || "", ".aletheia-brain");
```
to:
```typescript
import { gbrainHome } from "../lib/eval/qa.ts";
const GBRAIN_HOME = gbrainHome();
```

(This import goes near `console.ts`'s other `../lib/...` imports, e.g.
next to `import { grantsForScope, ... } from "../lib/scopes/grants.ts";`.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --experimental-strip-types --test tests/serve-runtime-home.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full suite to confirm nothing else broke**

Run: `npm test`
Expected: PASS, same count as before plus this task's 1 new test

- [ ] **Step 7: Commit**

```bash
git add lib/cli/serve-runtime.ts scripts/console.ts tests/serve-runtime-home.test.ts
git commit -m "Fix GBRAIN_HOME hardcoding in serve-runtime.ts and console.ts"
```

---

### Task 2: Extract and fix `invite`/`revoke` into a shared module

**Files:**
- Create: `lib/console/provision.ts`
- Modify: `scripts/console.ts` (remove the local `invite`/`revoke`
  functions and their `ClientError` import path if now unused there,
  import from the new module instead)
- Test: `tests/console-provision.test.ts`

**Interfaces:**
- Consumes: `gb(args: string[], opts?: { cache?: boolean }): string` —
  copy the exact helper already in `scripts/console.ts`/`lib/console/data.ts`
  (this module needs its own copy since it's a new file, not importing
  `lib/console/data.ts`'s cached read-only `gb` — mutations must never be
  cached; see the pattern already used consistently across the codebase
  of a local `gb` per file that shells out).
- Produces: `type InviteResult = { name: string; email: string; source: string; reads: string[]; clientId: string; secret: string; raw: string }`;
  `invite(name: string, email: string, source: string, federatedRead: string[]): InviteResult`;
  `revoke(clientId: string): string`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/console-provision.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { invite, revoke } from "../lib/console/provision.ts";

test("invite rejects a non-kebab-case name before calling gbrain", () => {
  assert.throws(() => invite("Not Kebab Case", "a@b.com", "shared", []), /kebab-case/);
});

test("invite rejects an invalid email before calling gbrain", () => {
  assert.throws(() => invite("alice-agent", "not-an-email", "shared", []), /valid email/);
});

test("invite rejects when there is no realised source to read from", () => {
  assert.throws(() => invite("alice-agent", "a@b.com", "", []), /no realised source/);
});

test("revoke rejects a malformed client id before calling gbrain", () => {
  assert.throws(() => revoke("not-a-real-id"), /bad client id/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test tests/console-provision.test.ts`
Expected: FAIL — `Cannot find module '../lib/console/provision.ts'`

- [ ] **Step 3: Implement the shared module**

```typescript
// lib/console/provision.ts
/**
 * Brain-mutating client provisioning — register-client/rescope-client/
 * revoke-client. Extracted from scripts/console.ts (which had the same
 * logic duplicated) so scripts/console.ts and scripts/demo.ts share one
 * implementation. Read-only brain access lives in lib/console/data.ts;
 * this file is deliberately the one place that mutates.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { gbrainHome } from "../eval/qa.ts";

const REPO = join(import.meta.dir, "..", "..");
const BRAIN_CLI = join(REPO, "packages/brain/src/cli.ts");

class ProvisionError extends Error {}

function gb(args: string[]): string {
  const result = spawnSync("bun", [BRAIN_CLI, ...args], {
    cwd: join(REPO, "packages/brain"),
    env: { ...process.env, GBRAIN_HOME: gbrainHome() },
    encoding: "utf8",
    timeout: 60_000,
  });
  if (result.status !== 0) throw new Error(`gbrain ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout.replace(/^gbrain \d.*available\. Run:.*$/m, "").trim();
}

export type InviteResult = {
  name: string; email: string; source: string; reads: string[];
  clientId: string; secret: string; raw: string;
};

/** Registers a read-only, starter-surface, no-standing-secret OAuth
 *  client scoped to exactly `federatedRead`. Always pins the tool
 *  surface via a second rescope-client call — register-client does not
 *  accept --surface at creation time. */
export function invite(name: string, email: string, source: string, federatedRead: string[]): InviteResult {
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(name)) throw new ProvisionError("name must be kebab-case, 2-64 chars");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ProvisionError("enter a valid email address");
  const reads = [...new Set([source, ...federatedRead])].filter(Boolean);
  if (!source || !reads.length) throw new ProvisionError("the selected scope has no realised source yet");

  const out = gb([
    "auth", "register-client", name,
    "--scopes", "read",
    "--source", source,
    "--federated-read", reads.join(","),
    "--token-endpoint-auth-method", "none",
  ]);
  const clientId = out.match(/(gbrain_cl_[a-f0-9]{16,})/)?.[1] ?? "";
  if (!clientId) throw new Error(`could not parse a client id from gbrain's output: ${out}`);
  gb(["auth", "rescope-client", clientId, "--surface", "starter"]);
  return { name, email, source, reads, clientId, secret: "", raw: out };
}

export function revoke(clientId: string): string {
  if (!/^gbrain_cl_[a-f0-9]+$/.test(clientId)) throw new ProvisionError("bad client id");
  return gb(["auth", "revoke-client", clientId]);
}
```

Note: `secret` is always `""` now — `--token-endpoint-auth-method none`
mints a public PKCE-only client, so there is never a secret to return
(the original `scripts/console.ts` version tried to regex a secret out of
`register-client`'s stdout; with `none` there isn't one, so that regex is
correctly dropped here rather than carried forward misleadingly).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/console-provision.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Refactor `scripts/console.ts` to use the shared module**

Remove `scripts/console.ts`'s own `invite`/`revoke` function definitions
(lines currently ~218-235) and its now-unused `ClientError` import if
nothing else in that file throws it (check with a search for
`ClientError` elsewhere in the file first — if `readJsonBody`/
`requireAdmin` still reference it via `http-security.ts`, keep the
import; only remove `invite`/`revoke`'s own usage). Add:

```typescript
import { invite, revoke } from "../lib/console/provision.ts";
```

The existing `/api/invite` and `/api/revoke` route handlers
(`scripts/console.ts`'s `url.pathname === "/api/invite"` /
`"/api/revoke"` blocks) call these exact same function names with the
exact same signature already — no route-handler changes needed, only the
function definitions move.

- [ ] **Step 6: Run the full suite to confirm the refactor didn't break anything**

Run: `npm test`
Expected: PASS, same count as before plus this task's 4 new tests

- [ ] **Step 7: Commit**

```bash
git add lib/console/provision.ts scripts/console.ts tests/console-provision.test.ts
git commit -m "Extract invite/revoke into lib/console/provision.ts, fix surface pinning"
```

---

### Task 3: Wire the provisioning routes into `scripts/demo.ts`

**Files:**
- Modify: `scripts/demo.ts` (imports, `ADMIN_ROUTES`, two new routes)
- Test: `tests/demo-provision-routes.test.ts`

**Interfaces:**
- Consumes: `invite`, `revoke` from `../lib/console/provision.ts` (Task 2);
  `loadMembers`, `type Member` from `../lib/console/data.ts` (already
  exists); `findAlethiaServe`, `serveGbrain` from `../lib/cli/serve-runtime.ts`
  (already exists, Task 1 fixed its `GBRAIN_HOME`).
- Produces: `POST /api/permissions/provision` → `{ clientId, mcpUrl,
  cliCommand }`; `POST /api/permissions/revoke-provision` → `{ ok: true }`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/demo-provision-routes.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..");

test("the provisioning routes are registered as admin-gated", () => {
  const src = readFileSync(join(REPO, "scripts/demo.ts"), "utf8");
  assert.match(src, /"\/api\/permissions\/provision"/);
  assert.match(src, /"\/api\/permissions\/revoke-provision"/);
  const adminRoutesBlock = src.slice(src.indexOf("const ADMIN_ROUTES"), src.indexOf("]);", src.indexOf("const ADMIN_ROUTES")));
  assert.match(adminRoutesBlock, /\/api\/permissions\/provision/);
  assert.match(adminRoutesBlock, /\/api\/permissions\/revoke-provision/);
});

test("the provision route derives the personal client name, never accepts an admin-typed one", () => {
  const src = readFileSync(join(REPO, "scripts/demo.ts"), "utf8");
  const routeStart = src.indexOf('"/api/permissions/provision"');
  const routeBody = src.slice(routeStart, routeStart + 800);
  // The client name must be computed from the member, not read from the
  // request body -- readJsonBody for this route should only destructure memberId.
  assert.match(routeBody, /memberId/);
  assert.doesNotMatch(routeBody, /body\.name|body\.clientName/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test tests/demo-provision-routes.test.ts`
Expected: FAIL — routes don't exist yet

- [ ] **Step 3: Add the imports**

Near `scripts/demo.ts`'s existing `lib/console/data.ts` import, add:

```typescript
import { loadMembers } from "../lib/console/data.ts";
import { invite, revoke } from "../lib/console/provision.ts";
import { findAlethiaServe, serveGbrain } from "../lib/cli/serve-runtime.ts";
```

(If `loadMembers` is already imported for the read-only member list
rendering, just add `invite`, `revoke`, `findAlethiaServe`, `serveGbrain`
to the existing import lines rather than duplicating an import
statement.)

- [ ] **Step 4: Add the two routes to `ADMIN_ROUTES`**

```typescript
const ADMIN_ROUTES = new Set([
  // ...existing entries...
  "/api/permissions/provision",
  "/api/permissions/revoke-provision",
]);
```

- [ ] **Step 5: Implement the routes**

Add near the other `/api/permissions`-style or `/api/connectors/sync`
route handlers inside the `Bun.serve` handler:

```typescript
        if (url.pathname === "/api/permissions/provision" && req.method === "POST") {
          const { memberId } = await readJsonBody<{ memberId?: string }>(req);
          const member = loadMembers().find((m) => m.id === memberId);
          if (!member) return json({ error: "member not found" }, 404);
          if (!member.read.length) return json({ error: "this member has no granted access to provision from" }, 400);
          if (!findAlethiaServe()) {
            try { serveGbrain([]); } catch (err) {
              return json({ error: `could not start the MCP server: ${(err as Error).message}` }, 500);
            }
          }
          const personalClientName = `${member.name}-agent`.replace(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 64);
          const result = invite(personalClientName, `${member.name}@agent.local`, member.write, member.read);
          const serving = findAlethiaServe();
          const mcpUrl = serving ? `http://localhost:${serving.port}` : "";
          return json({
            clientId: result.clientId,
            mcpUrl,
            cliCommand: `gbrain connect ${mcpUrl} --install`,
          });
        }

        if (url.pathname === "/api/permissions/revoke-provision" && req.method === "POST") {
          const { clientId } = await readJsonBody<{ clientId?: string }>(req);
          revoke(String(clientId));
          return json({ ok: true });
        }
```

Note on the `${member.name}@agent.local` placeholder email: `invite()`
requires a syntactically valid email (Task 2's validation), but this
feature has no real employee-email input anywhere in tako today — Team &
Permissions members are gbrain clients (`lib/console/data.ts:loadMembers`),
not directory records with email addresses. `agent.local` is a clearly
synthetic, non-routable placeholder domain (RFC 6761 reserves
`.local` for non-DNS use) so this can never accidentally resemble a real
address; a future task can wire a real email field if tako grows an
actual employee-directory concept.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/demo-provision-routes.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS, same count as before plus this task's 2 new tests

- [ ] **Step 8: Commit**

```bash
git add scripts/demo.ts tests/demo-provision-routes.test.ts
git commit -m "Wire /api/permissions/provision and revoke-provision routes"
```

---

### Task 4: Team & Permissions UI — issue and revoke agent access

**Files:**
- Modify: `scripts/demo.ts` (the `permissions` section's member detail
  panel markup and its client-side `openPermissionsPanel`/related JS)
- Test: `tests/tako-ui.test.ts` (append)

**Interfaces:**
- Consumes: `POST /api/permissions/provision`, `POST
  /api/permissions/revoke-provision` (Task 3); the existing `adminApi()`
  client helper (already used by every other mutating action in this
  file — e.g. the Ask-screen provider toggle wired earlier this session).
- Produces: nothing new for later tasks — this is the leaf UI task.

- [ ] **Step 1: Write the failing UI test**

```typescript
// append to tests/tako-ui.test.ts
test("Team & Permissions member panel offers Issue agent access", () => {
  const html = renderPage();
  assert.match(html, /Issue agent access/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/tako-ui.test.ts`
Expected: FAIL — no such text in the rendered page

- [ ] **Step 3: Find the member detail panel markup**

Locate `scripts/demo.ts`'s `openPermissionsPanel` client function (search
for `function openPermissionsPanel`) — it currently renders a member's
name, owner/member status, and their connected-content list into
`#permissions-panel-body`.

- [ ] **Step 4: Extend the panel markup**

Add a new block to `openPermissionsPanel`'s rendered HTML, after the
existing "Connected content" list:

```javascript
    +'<h3>Agent access</h3>'
    +'<p class="tako-supporting">Lets this person\'s own AI tool connect directly, scoped to exactly what they can already see here.</p>'
    +'<button class="tako-btn tako-btn--secondary" id="permissions-issue-agent" data-member-id="'+esc(m.id)+'">Issue agent access</button>'
    +'<div id="permissions-agent-out"></div>'
```

- [ ] **Step 5: Wire the issue/reveal-once flow**

Add near the existing `$('#permissions-panel-close')` handler:

```javascript
document.addEventListener('click', async e => {
  if (e.target?.id !== 'permissions-issue-agent') return;
  const memberId = e.target.dataset.memberId;
  const out = $('#permissions-agent-out');
  out.innerHTML = '<p class="hint">Issuing…</p>';
  try {
    const r = await adminApi('/api/permissions/provision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId }) });
    out.innerHTML =
      '<div class="cx-summary" style="margin-top:8px">'
      + '<p class="hint" style="color:var(--tako-danger,#b00);font-weight:600">⚠ Copy this now — it will not be shown again.</p>'
      + '<div class="cx-summary-row"><span class="cx-summary-label">MCP URL</span><span class="mono">' + esc(r.mcpUrl) + '</span></div>'
      + '<div class="cx-summary-row"><span class="cx-summary-label">Client ID</span><span class="mono">' + esc(r.clientId) + '</span></div>'
      + '<div class="cx-summary-row"><span class="cx-summary-label">CLI</span><span class="mono">' + esc(r.cliCommand) + '</span></div>'
      + '<button class="tako-btn tako-btn--secondary" data-revoke-client="' + esc(r.clientId) + '" style="margin-top:8px">Revoke</button>'
      + '</div>';
  } catch (err) {
    out.innerHTML = '<div class="note-err">' + esc(err.message) + '</div>';
  }
});

document.addEventListener('click', async e => {
  if (!e.target?.dataset?.revokeClient) return;
  const clientId = e.target.dataset.revokeClient;
  const out = $('#permissions-agent-out');
  try {
    await adminApi('/api/permissions/revoke-provision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId }) });
    out.innerHTML = '<p class="hint">Revoked.</p>';
  } catch (err) {
    out.innerHTML = '<div class="note-err">' + esc(err.message) + '</div>';
  }
});
```

(Two separate `document.addEventListener('click', ...)` blocks rather
than binding directly to `#permissions-issue-agent` at render time,
because that button is re-created fresh every time `openPermissionsPanel`
runs — a delegated listener on `document` survives that re-render without
needing re-binding, matching how this file already handles other
dynamically-inserted buttons elsewhere.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test tests/tako-ui.test.ts`
Expected: PASS

Run: `npm test`
Expected: PASS, full suite green

- [ ] **Step 7: Manual verification**

Start the demo server (`bun scripts/demo.ts`), open Team & Permissions,
select a member with at least one granted source, click "Issue agent
access", confirm the MCP URL/client id/CLI command panel appears. Then
run the spec's own suggested smoke test:
```bash
cd packages/brain && bun src/cli.ts auth test <the mcpUrl> --token <n/a — PKCE client, no static token>
```
— since this client is PKCE-only, the practical verification is instead:
`bun src/cli.ts auth clients --json` shows the new client with
`"surface": "starter"` and `"scopes": "read"`, and `federated_read`
exactly matching the member's own `read` list from `/api/permissions`'s
existing member data. Then click "Revoke" and confirm the same listing
no longer shows that client id.

- [ ] **Step 8: Commit**

```bash
git add scripts/demo.ts tests/tako-ui.test.ts
git commit -m "Add Issue/Revoke agent access to the Team & Permissions member panel"
```

---

## Self-Review Notes

- **Spec coverage:** §2 (architecture, the `GBRAIN_HOME` bug + reuse of
  `scripts/console.ts`'s `invite`/`revoke`) → Tasks 1–2. §3 (provisioning
  flow, lazy-starting the MCP daemon) → Task 3. §4 (revocation flow) →
  Task 3 + Task 4's UI. §5 (security: scope ceiling not choice, starter
  surface, no standing secret, audit) is enforced structurally across
  Tasks 2–3 (never admin-typed scope, always `--surface starter` via
  Task 2's `invite()`, always `--token-endpoint-auth-method none`) — no
  separate task needed, it is the *shape* of the other tasks, not an
  add-on. §6 (operational concerns, resolved) → Task 3's
  `findAlethiaServe`/`serveGbrain` lazy-start. §7 (error handling: clear
  gbrain error text, reject empty `Member.read`, idempotent-ish revoke)
  → Task 3's route implementations.
- **Not covered by this plan, intentionally (spec §1 non-goals):**
  self-service requests, write/admin scopes, skill execution over the
  provisioned endpoint, a new tako-owned credential data model.
- **Type consistency:** `InviteResult` is defined once in Task 2 and
  consumed as-is by Task 3's route (`result.clientId`). `Member`/
  `Member.read`/`Member.write` come from the existing
  `lib/console/data.ts` type, unchanged by this plan. `findAlethiaServe`'s
  `ServeProcess` type (`{ pid, port, managed }`) is read only for its
  `.port` field in Task 3 — no new type needed there.
