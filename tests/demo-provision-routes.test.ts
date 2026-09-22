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
  // Anchor on the route handler's own conditional, not the ADMIN_ROUTES set
  // entry (which contains the same quoted string but appears earlier in
  // the file and holds no request-handling code to assert against).
  const routeStart = src.indexOf('url.pathname === "/api/permissions/provision"');
  const routeBody = src.slice(routeStart, routeStart + 800);
  // The client name must be computed from the member, not read from the
  // request body -- readJsonBody for this route should only destructure memberId.
  assert.match(routeBody, /memberId/);
  assert.doesNotMatch(routeBody, /body\.name|body\.clientName/);
});

test("the provision route awaits/catches serveGbrain instead of firing it unawaited", () => {
  const src = readFileSync(join(REPO, "scripts/demo.ts"), "utf8");
  const routeStart = src.indexOf('url.pathname === "/api/permissions/provision"');
  const routeBody = src.slice(routeStart, routeStart + 3000);
  // Regression for the bug where `try { serveGbrain([]); } catch {}` could
  // never catch a rejection because serveGbrain() is async and the call was
  // never awaited -- any failure became an unhandled promise rejection
  // instead of a 500 to the admin (spec section 7: "errors must surface
  // clearly to the admin, not fail silently").
  //
  // serveGbrain() only resolves once the spawned daemon process exits, so a
  // literal `await serveGbrain([])` would hang the whole request on every
  // successful cold start -- the fix must instead attach a rejection
  // handler (`.catch`) to observe a real startup failure, and separately
  // poll findAlethiaServe() -- the daemon's own readiness signal -- until
  // it is up or a bounded wait is exhausted.
  assert.match(routeBody, /serveGbrain\(\[\]\)\s*\.catch/);
  assert.match(routeBody, /findAlethiaServe\(\)/);
  // A bounded retry loop (not an unbounded/blocking wait) must poll for
  // readiness, and a still-not-ready outcome must return a clear error
  // rather than silently falling through to an empty mcpUrl.
  assert.match(routeBody, /for\s*\([^)]*attempt[^)]*\)/);
  assert.match(routeBody, /did not start in time|could not start the MCP server/);
});

test("the provision route never widens the federated-read grant past member.read", () => {
  const src = readFileSync(join(REPO, "scripts/demo.ts"), "utf8");
  const routeStart = src.indexOf('url.pathname === "/api/permissions/provision"');
  const routeBody = src.slice(routeStart, routeStart + 4000);
  // invite()'s `source` argument is folded into its returned federated-read
  // set (by design, for scripts/console.ts's own admin-picks-both flow).
  // Passing member.write here would silently grant the agent read access
  // to a source the member's own Member.read ceiling doesn't include --
  // this asserts the route passes a member.read entry as `source` instead,
  // never member.write.
  assert.doesNotMatch(routeBody, /invite\([^)]*member\.write/);
  assert.match(routeBody, /invite\(personalClientName,[^)]*member\.read\[0\][^)]*member\.read\)/);
});
