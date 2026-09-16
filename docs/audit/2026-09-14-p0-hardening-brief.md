# P0 hardening brief

Fixes 4 confirmed P0 failures from `docs/audit/2026-09-14-p0-audit.md`
(also summarized in `docs/PROTOTYPE_SECURITY_CHECKLIST.md`): no auth on
mutating routes, no input size/schema validation, raw error messages
leaking internal details, no rate limiting. Plus a small rollback item
(git tag + runbook). This is hardening of existing code, not a redesign
— follow existing patterns in `scripts/demo.ts`/`scripts/console.ts`
exactly (verbose if-chain route dispatch, no router abstraction, no
framework).

Work directly in the repo, no worktree:
`/Users/khewailing/Downloads/Alethia STAPS 2026/aletheia-prototype`
Branch: `main` (already checked out).

## Approved design (do not deviate without flagging in your report)

**Auth — shared secret via env var:**
- `ADMIN_TOKEN` env var. If unset, generate one with `crypto.randomUUID()` at server startup and print it once to the console log (so local single-operator use still works with zero setup, but a stable value can be set for anything beyond pure local use).
- Required as an `X-Admin-Token` request header on every mutating (state-changing) route. Compare with `node:crypto`'s `timingSafeEqual`, not `===`.
- Client-side: do NOT embed the token in the served HTML (the page itself stays unauthenticated per the checklist's intent — "public demo" screens must stay reachable; only admin actions are gated). Instead, add a small `adminFetch(url, opts)` wrapper in the page's own `<script>` that reads a token from `localStorage.getItem('tako-admin-token')`, attaches it as `X-Admin-Token`, and on a 401 response, uses `prompt("Admin token required for this action:")`, stores what the user enters in localStorage, and retries the request once. Replace the existing direct `fetch(...)` calls to admin-gated endpoints with `adminFetch(...)` — do not change any other fetch calls.

**Input validation:**
- Add a shared `readJsonBody<T>(req, maxBytes = 1_000_000)` helper: check `Content-Length` header first (fast-fail over the cap), read the body text, re-check actual length, then `JSON.parse` in a try/catch. Throw a `ClientError` (see below) with status 413 for oversized bodies and 400 for malformed JSON — never let a raw `SyntaxError` or unbounded body reach the client or the process.
- Replace every `await req.json()` call in both files' route handlers with `await readJsonBody<ExpectedShape>(req)`, keeping the existing type annotations.

**Error sanitization:**
- Add a `ClientError` class (message + status, default 400) for errors that are safe and intentional to show the client verbatim (validation failures, the existing READ_ONLY guard messages, etc.).
- Change every EXISTING `throw new Error(...)` site in `scripts/demo.ts` and `scripts/console.ts` that is a deliberate, safe, developer-authored user-facing message (grep for `throw new Error` in both files — there are ~20 sites) to `throw new ClientError(...)` instead, EXCEPT:
  - `scripts/console.ts:38` (the `gb()`-style helper wrapping the gbrain CLI's raw stderr) — this one must stay a plain `Error`, because its message can contain internal file paths and must NOT reach the client verbatim. This is intentional: it's the actual P0-06 leak this fix closes.
  - Also check `lib/eval/qa.ts`'s `gb()` function (used by demo.ts transitively) — same reasoning, leave it as a plain `Error`, do not touch that file's throw itself, only how the top-level handler treats uncaught errors (see next point).
- Replace the top-level `catch (err) { return json({ error: (err as Error).message }, 500); }` in `scripts/demo.ts` and the equivalent in `scripts/console.ts` with a shared `safeErrorResponse(err, json)` helper: if `err instanceof ClientError`, return `{error: err.message}` at `err.status`; otherwise generate a short correlation id (`randomUUID().slice(0,8)`), `console.error` the FULL error server-side with that id, and return a generic `{error: \`internal error (ref ${id}) — see server logs\`}` at 500. This is what actually closes the P0-06 finding — verify by reading the current gbrain-stderr leak path (`lib/eval/qa.ts` `gb()`, reached via `/api/ask`, `/api/page`, `/api/access`, `/api/skills`, `/api/tasks`, `/api/reviews`, `/api/activity`, `/api/connectors`) and confirming a thrown error from there now produces a generic client-facing message with the detail only in the server console.

**Rate limiting:**
- Add a simple in-memory fixed-window rate limiter: `checkRateLimit(key, limit, windowMs): boolean`, keyed by client IP (`server.requestIP(req)?.address ?? "unknown"` — you'll need to change the `fetch(req)` signature to `fetch(req, server)` in both files to get this).
- Apply to: `/api/ask` (limit 10 requests / 60s per IP), `/api/activity/retry` (2 / 60s), `/api/connectors/sync` (5 / 60s). On limit exceeded, return `{error: "too many requests, try again shortly"}` at 429.
- This is intentionally simple (in-memory, resets on restart, not distributed) — do not build anything more elaborate.

**Shared module:**
- Put `ClientError`, `readJsonBody`, `resolveAdminToken`, `isValidAdminToken`, `requireAdmin`, `checkRateLimit`, `clientKey`, `safeErrorResponse` in a new shared file: `lib/util/http-security.ts`. Import from both `scripts/demo.ts` and `scripts/console.ts`. Do not duplicate this logic between the two files.
- `resolveAdminToken()` must only be called once, inside each file's `if (import.meta.main) { ... }` block (right before `Bun.serve(...)`) — NOT at module top-level, so importing `demo.ts`/`console.ts` for tests (as `tests/tako-ui.test.ts` already does for `renderPage`/`NAV_GROUPS`) never triggers the console.log/random-token side effect.

**Which routes are admin-gated (apply auth + validation, and rate-limit the three named above):**

`scripts/demo.ts`: `/api/automations/create`, `/api/activity/retry`, `/api/review-submit`, `/api/review-decide`, `/api/connectors/save`, `/api/connectors/test`, `/api/connectors/sync`. (`/api/ask` and `/api/redact-try` are NOT admin-gated — they don't mutate persistent state — but `/api/ask` DOES get the rate limit above regardless.)

`scripts/console.ts`: `/api/invite`, `/api/revoke`.

Define the gated-route set as a `Set<string>` checked once near the top of the route-dispatch chain (before the long if-chain), not repeated per-route:
```ts
const ADMIN_ROUTES = new Set(["/api/automations/create", "/api/activity/retry", "/api/review-submit", "/api/review-decide", "/api/connectors/save", "/api/connectors/test", "/api/connectors/sync"]);
// inside fetch, after computing url, before the route if-chain:
if (req.method === "POST" && ADMIN_ROUTES.has(url.pathname)) {
  const err = requireAdmin(req, ADMIN_TOKEN);
  if (err) return json({ error: err.message }, err.status);
}
```

## Testing

Existing tests only exercise `renderPage()` and pure functions imported from `scripts/demo.ts` (see `tests/tako-ui.test.ts`) — nothing spins up a live `Bun.serve()` server today. Follow that same style: write unit tests for the new PURE functions directly.

Create `tests/http-security.test.ts` (bun test, matching `tests/eval-qa.test.ts`'s style) covering, at minimum:
- `readJsonBody` rejects an oversized body (mock a `Request` with a `content-length` header over the cap, or with an actual oversized text body) with a `ClientError` status 413.
- `readJsonBody` rejects malformed JSON with a `ClientError` status 400.
- `readJsonBody` returns parsed JSON for a valid small body.
- `isValidAdminToken` returns true only for an exact match, false for wrong/missing/empty token.
- `requireAdmin` returns null (no error) when the header matches, a `ClientError` with status 401 when it doesn't.
- `checkRateLimit` allows up to `limit` calls within the window for the same key, then rejects; a different key is independent; after the window elapses (you can fake this by calling with a small `windowMs` like 50ms and awaiting past it) it resets.
- `safeErrorResponse` returns the `ClientError`'s own message+status for a `ClientError`, and a generic message (not containing the original error's text) at 500 for a plain `Error` — assert the generic response does NOT contain any substring of the original error message, proving no leak.

For the route-level wiring (which routes are gated, that the READ_ONLY messages still reach the client as their own text, that a real gbrain-style error gets masked) — since there's no existing live-server test harness, verify these manually: start the server (`PORT=4405 bun scripts/demo.ts &`, capture the printed admin token from stdout), use `curl` to hit a gated endpoint with and without the correct `X-Admin-Token` header, confirm 401 vs success, then confirm a request to a non-gated endpoint like `/api/ask` still works without any token, then kill the server. Document what you ran and its output in your report — this is expected to be manual verification, not an automated test, matching how prior work in this codebase (e.g. `createAutomation`'s READ_ONLY guard) was manually curl-verified when it isn't exported for direct unit testing.

Run the full existing suite too (`npm test`) and confirm nothing regresses — the one pre-existing "MCP" jargon test failure in `tests/tako-ui.test.ts` is known, deliberate, and out of scope; ignore it, don't fix it.

## Rollback item (separate, small, do after the above)

1. Tag the current `main` HEAD as a pre-hardening rollback point: `git tag pre-p0-hardening-2026-09-14` (do this BEFORE your own commit, capturing the state as of right now).
2. Write `docs/ROLLBACK_RUNBOOK.md`: a short (under 1 page) procedure for reverting a bad public release — how to find the last known-good tag/commit, how to redeploy it (this is a `bun scripts/demo.ts` process today, so "redeploy" just means checking out that commit and restarting the process), and where to record a new tag after each release. Keep it honest about the current state (no CI/CD, no staging environment yet) rather than describing infrastructure that doesn't exist.

## Report

Write your full report to:
`docs/audit/2026-09-14-p0-hardening-report.md`

Then commit (one commit is fine, or a couple of logical ones — your call):
```bash
git add lib/util/http-security.ts scripts/demo.ts scripts/console.ts tests/http-security.test.ts docs/ROLLBACK_RUNBOOK.md docs/audit/2026-09-14-p0-hardening-report.md
git commit -m "Harden P0 findings: admin auth, input caps, error sanitization, rate limits"
```
Do not push — report back and let the controller review first. Do not touch `docs/PROTOTYPE_SECURITY_CHECKLIST.md` (the controller updates that after review).

Return to the controller ONLY: status (DONE/DONE_WITH_CONCERNS/BLOCKED), commit hash(es), a one-line test summary, the manual curl verification output (paste it — this is the one thing worth pasting back directly since it's the evidence for the auth fix), and any concerns or deviations from this brief.

You must not dispatch any subagents of your own.