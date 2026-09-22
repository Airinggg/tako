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
