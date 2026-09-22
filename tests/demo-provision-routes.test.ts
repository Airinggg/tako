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
