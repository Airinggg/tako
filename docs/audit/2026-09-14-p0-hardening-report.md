# P0 hardening report

Implements the fixes specified in
`docs/audit/2026-09-14-p0-hardening-brief.md` for 4 of the 10 P0 findings in
`docs/audit/2026-09-14-p0-audit.md` (P0-01 auth, P0-04 input validation,
P0-06 error leakage, P0-07 rate limiting), plus the P0-10 rollback item.

## What changed

### New shared module: `lib/util/http-security.ts`
- `ClientError` — an `Error` subclass carrying an HTTP status, for messages
  that are safe and intentional to show a client verbatim.
- `readJsonBody<T>(req, maxBytes = 1_000_000)` — fast-fails on
  `Content-Length` over the cap (413), re-checks actual body length (413),
  and turns a JSON parse failure into a 400 `ClientError` rather than letting
  a raw `SyntaxError` or unbounded body reach the client or process.
- `resolveAdminToken()` — returns `process.env.ADMIN_TOKEN`, or generates one
  with `crypto.randomUUID()` and prints it once. Called exactly once, inside
  each file's `if (import.meta.main)` block, right before `Bun.serve(...)`.
- `isValidAdminToken(provided, expected)` — constant-time comparison via
  `node:crypto`'s `timingSafeEqual`.
- `requireAdmin(req, expectedToken)` — checks the `X-Admin-Token` header,
  returns `null` or a 401 `ClientError`.
- `checkRateLimit(key, limit, windowMs)` — simple in-memory fixed-window
  limiter (module-level `Map`, resets on process restart, not distributed —
  intentionally simple per the brief).
- `clientKey(req, server)` — `server.requestIP(req)?.address ?? "unknown"`.
- `safeErrorResponse(err, json)` — a `ClientError` returns its own
  message/status; anything else gets a short correlation id, is
  `console.error`'d in full server-side, and the client gets a generic
  `internal error (ref <id>) — see server logs` at 500.

### `scripts/demo.ts` / `scripts/console.ts`
- Both files' `fetch` handler now checks a per-file `ADMIN_ROUTES: Set<string>`
  once, before the route if-chain, and calls `requireAdmin` for any `POST` to
  a gated route.
  - `demo.ts` gated: `/api/automations/create`, `/api/activity/retry`,
    `/api/review-submit`, `/api/review-decide`, `/api/connectors/save`,
    `/api/connectors/test`, `/api/connectors/sync`.
  - `console.ts` gated: `/api/invite`, `/api/revoke`.
- Every `await req.json()` in a route handler replaced with
  `await readJsonBody<ExpectedShape>(req)`.
- Every deliberate, developer-authored `throw new Error(...)` in these two
  files' server-side code converted to `throw new ClientError(...)` — 15
  sites in `demo.ts`, 5 in `console.ts` (full list below). Left untouched, as
  the brief specifies:
  - `scripts/console.ts:39` — the `gb()` helper wrapping the gbrain CLI's raw
    stderr (can contain internal file paths; this is the actual P0-06 leak
    path).
  - `lib/eval/qa.ts`'s `gb()` — not modified at all, per the brief; only the
    top-level catch treats its thrown errors differently now.
  - The two client-side `<script>` `const api=...` helpers (`demo.ts` line
    ~2025, `console.ts` line ~299) — these `throw new Error(...)` calls run
    in the browser, not the server; out of scope.
- Both files' top-level `catch (err) { ... }` in the `fetch` handler replaced
  with `return safeErrorResponse(err, json);` — this closes the P0-06 leak:
  a real gbrain-stderr error (or any other unexpected error) now reaches the
  client only as `internal error (ref xxxxxxxx) — see server logs`, with the
  full detail server-side only.
- `Bun.serve`'s `fetch(req)` signature changed to `fetch(req, server)` in
  both files, to get `server.requestIP(req)` for `clientKey`.
- Rate limiting applied: `/api/ask` (10/60s per IP), `/api/activity/retry`
  (2/60s), `/api/connectors/sync` (5/60s) — all in `demo.ts`, matching the
  brief. On limit exceeded: `{"error":"too many requests, try again shortly"}`
  at 429.
- `scripts/console.ts` did not previously have an `if (import.meta.main)`
  guard around its `Bun.serve(...)` call (unlike `demo.ts`) — added one, so
  `resolveAdminToken()`'s console.log/random-token side effect can't fire
  from an import (none of the current tests import `console.ts`, but this
  keeps both files consistent and safe for any future test that does).
- Client-side: added an `adminFetch(url, opts)` wrapper (and a thin
  `adminApi` built on it, matching each file's existing `api()` convention)
  in both files' `<script>` blocks. It reads `localStorage.getItem
  ('tako-admin-token')`, attaches `X-Admin-Token`, and on a 401 uses
  `prompt('Admin token required for this action:')`, stores what's entered,
  and retries once. Every existing call site that hits an admin-gated
  endpoint was switched from `api(...)` to `adminApi(...)` — 7 sites in
  `demo.ts`, 2 in `console.ts`. No other `fetch`/`api` call sites were
  touched.

### `tests/http-security.test.ts`
New file (bun test, `node:test`/`node:assert` style, matching
`tests/eval-qa.test.ts`). 11 tests covering `readJsonBody` (oversized via
header, oversized via actual length, malformed JSON, valid body),
`isValidAdminToken` (exact match only), `requireAdmin` (null vs 401),
`checkRateLimit` (per-key limit, independent keys, window reset), and
`safeErrorResponse` (ClientError passthrough; plain Error masked, asserting
no substring of the original message leaks through).

### `docs/ROLLBACK_RUNBOOK.md`
New file. Under one page. Describes finding the last good tag
(`git tag --sort=-creatordate`; `pre-p0-hardening-2026-09-14` is the first
one), redeploying by stopping the process / `git checkout` / restarting
`bun scripts/demo.ts` (or `console.ts`), and tagging before each future
release. Explicitly states there is no CI/CD and no staging environment
today, rather than describing infrastructure that doesn't exist.

### Rollback tag
`pre-p0-hardening-2026-09-14` tagged at the pre-hardening `main` HEAD
(`28122598c70a0a377772273d1dcd52a451d0a9c2`), before this work's commit.

## Deviations / interpretation notes (flagging per the brief's instruction)

1. **`adminFetch`/`adminApi` naming.** The brief describes replacing "direct
   `fetch(...)` calls to admin-gated endpoints with `adminFetch(...)`." In
   practice neither file calls `fetch` directly from route-triggering code —
   both already wrap it in a small `api(p,o)` helper used by every client
   call site. I added `adminFetch` exactly as specified (localStorage read,
   header attach, 401-prompt-and-retry-once), and additionally added a thin
   `adminApi` on top of it (mirroring the existing `api` helper's
   response-parsing/error-throwing) so the admin-gated call sites could be
   updated with a one-word change (`api(` → `adminApi(`) instead of inlining
   response handling at each call site. This keeps the existing code's own
   abstraction style rather than introducing a new one. Functionally it's
   what the brief asked for; the extra `adminApi` name is the one addition
   beyond the brief's literal text.
2. **New test file not wired into `npm run test`'s script line.** The
   brief's `git add` list for the commit does not include `package.json`,
   and I did not modify it. `npm test`'s script still explicitly lists
   `tests/tako-ui.test.ts tests/eval-qa.test.ts` as the two bun-test files;
   `tests/http-security.test.ts` is not in that list, so a future
   `npm test` will not run it automatically — it must be run directly
   (`bun test tests/http-security.test.ts`) or `package.json` updated
   separately. Flagging this since it means the new tests aren't part of
   the standard regression gate going forward.
3. **`console.ts` previously had no `if (import.meta.main)` guard.** The
   brief's instruction to call `resolveAdminToken()` "inside each file's
   `if (import.meta.main) { ... }` block" assumed both files already had
   one; only `demo.ts` did. I added the guard to `console.ts` around its
   `Bun.serve(...)` call and the closing `console.log`, matching `demo.ts`'s
   existing pattern. No test currently imports `console.ts` (only
   `tests/cli-dispatch.test.ts` references its path as a string), so this
   had no behavioral effect on existing tests, but it's a structural change
   beyond a literal line-by-line reading of the brief.

No other deviations. All gated-route sets, rate-limit numbers, status codes,
and file boundaries match the brief exactly.

## Test results

- `bun test tests/http-security.test.ts` — **11 pass, 0 fail.**
- `npm test` (full suite) — node:test suite: **153 pass, 0 fail**. Trailing
  `bun test tests/tako-ui.test.ts tests/eval-qa.test.ts` — **37 pass, 1
  fail**. The 1 failure is `tests/tako-ui.test.ts`'s "no screen exposes
  internal platform jargon" test failing on the string "MCP" (the Connect
  screen's `mcp:` connector label) — this is the pre-existing, known,
  deliberately out-of-scope failure named in the task brief. No other
  regressions.

## Manual curl verification

Both servers were started with no `ADMIN_TOKEN` set, so each printed a
generated one-time token to its own log at startup; that printed token was
then used as the `X-Admin-Token` header value below. Both servers were
stopped after verification.

### `scripts/demo.ts` (port 4406)

```
=== 1. Gated route WITHOUT token (expect 401) ===
HTTP 401
{"error":"admin token required"}
=== 2. Gated route WITH WRONG token (expect 401) ===
HTTP 401
{"error":"admin token required"}
=== 3. Gated route WITH CORRECT token (expect 200) ===
HTTP 200
{"ok":true,"slug":"run-the-decision-audit-notify-the-team-channel"}
=== 4. Non-gated route /api/ask WITHOUT token (expect 200) ===
HTTP 200
{"answer":"Based on the information provided in the sources, the most recent decision regarding the meeting time was made on August 28, 2026. The participants decided that the meeting could be held on
=== 5. Oversized body on gated route (expect 413) ===
HTTP 413
{"error":"request body too large"}
=== 6. Malformed JSON on gated route (expect 400) ===
HTTP 400
{"error":"malformed JSON body"}
```

### `scripts/console.ts` (port 4407)

```
=== console.ts: /api/invite WITHOUT token (expect 401) ===
HTTP 401
{"error":"admin token required"}
=== console.ts: /api/invite WITH WRONG token (expect 401) ===
HTTP 401
{"error":"admin token required"}
=== console.ts: /api/revoke WITHOUT token (expect 401) ===
HTTP 401
{"error":"admin token required"}
=== console.ts: /api/brains (non-gated GET) WITHOUT token (expect 200) ===
HTTP 200
{"mode":"scopes","banner":"","brains":[{"kind":"scope","id":"hearing-team","name":"hearing-team","purpose":"ヒアリング担当者向け。企業別...
```

Rate limiting (`/api/ask` 10/60s, `/api/activity/retry` 2/60s,
`/api/connectors/sync` 5/60s) is covered by the `checkRateLimit` unit tests
(per-key limit enforcement, independent keys, window reset) in
`tests/http-security.test.ts`; it was not separately re-verified live via
curl in this pass because `/api/ask` calls the real local model per request
(10-30s each), making a live 11-request burst slow to script reliably in
this environment. The unit tests exercise the exact same function the route
calls, so this is considered adequately covered — flagging it here rather
than silently skipping it.

## Status

DONE_WITH_CONCERNS — functionally complete and verified per the brief; the
"concerns" are the three deviations noted above (none are behavior bugs, all
are interpretation/structural notes) and that the rate-limit routes were
verified via unit test rather than a live curl burst.
