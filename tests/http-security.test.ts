import assert from "node:assert/strict";
import test from "node:test";
import {
  checkRateLimit,
  ClientError,
  isValidAdminToken,
  readJsonBody,
  requireAdmin,
  safeErrorResponse,
} from "../lib/util/http-security.ts";

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

test("readJsonBody rejects an oversized body via Content-Length", async () => {
  const req = jsonRequest(JSON.stringify({ ok: true }), { "content-length": "2000000" });
  await assert.rejects(
    () => readJsonBody(req, 1_000_000),
    (err: unknown) => err instanceof ClientError && err.status === 413,
  );
});

test("readJsonBody rejects an oversized body by actual length even without a matching header", async () => {
  const big = "x".repeat(200);
  const req = jsonRequest(JSON.stringify({ big }));
  await assert.rejects(
    () => readJsonBody(req, 50),
    (err: unknown) => err instanceof ClientError && err.status === 413,
  );
});

test("readJsonBody rejects malformed JSON with a 400 ClientError", async () => {
  const req = jsonRequest("{not valid json");
  await assert.rejects(
    () => readJsonBody(req),
    (err: unknown) => err instanceof ClientError && err.status === 400,
  );
});

test("readJsonBody returns parsed JSON for a valid small body", async () => {
  const req = jsonRequest(JSON.stringify({ hello: "world", n: 3 }));
  const parsed = await readJsonBody<{ hello: string; n: number }>(req);
  assert.deepEqual(parsed, { hello: "world", n: 3 });
});

test("isValidAdminToken returns true only for an exact match", () => {
  assert.equal(isValidAdminToken("secret-123", "secret-123"), true);
  assert.equal(isValidAdminToken("wrong", "secret-123"), false);
  assert.equal(isValidAdminToken("", "secret-123"), false);
  assert.equal(isValidAdminToken(undefined, "secret-123"), false);
  assert.equal(isValidAdminToken(null, "secret-123"), false);
  assert.equal(isValidAdminToken("secret-123", ""), false);
});

test("requireAdmin returns null when the header matches, a 401 ClientError when it does not", () => {
  const good = new Request("http://localhost/api/test", { headers: { "x-admin-token": "tok" } });
  assert.equal(requireAdmin(good, "tok"), null);

  const bad = new Request("http://localhost/api/test", { headers: { "x-admin-token": "nope" } });
  const err = requireAdmin(bad, "tok");
  assert.ok(err instanceof ClientError);
  assert.equal(err?.status, 401);

  const missing = new Request("http://localhost/api/test");
  const err2 = requireAdmin(missing, "tok");
  assert.ok(err2 instanceof ClientError);
  assert.equal(err2?.status, 401);
});

test("checkRateLimit allows up to `limit` calls per key within the window, then rejects", () => {
  const key = `k-${Math.random()}`;
  assert.equal(checkRateLimit(key, 3, 60_000), true);
  assert.equal(checkRateLimit(key, 3, 60_000), true);
  assert.equal(checkRateLimit(key, 3, 60_000), true);
  assert.equal(checkRateLimit(key, 3, 60_000), false);
  assert.equal(checkRateLimit(key, 3, 60_000), false);
});

test("checkRateLimit tracks independent keys separately", () => {
  const a = `a-${Math.random()}`;
  const b = `b-${Math.random()}`;
  assert.equal(checkRateLimit(a, 1, 60_000), true);
  assert.equal(checkRateLimit(a, 1, 60_000), false);
  assert.equal(checkRateLimit(b, 1, 60_000), true);
});

test("checkRateLimit resets once the window elapses", async () => {
  const key = `w-${Math.random()}`;
  assert.equal(checkRateLimit(key, 1, 50), true);
  assert.equal(checkRateLimit(key, 1, 50), false);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(checkRateLimit(key, 1, 50), true);
});

test("safeErrorResponse returns the ClientError's own message and status", async () => {
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
  const res = safeErrorResponse(new ClientError("bad input", 422), json);
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.deepEqual(body, { error: "bad input" });
});

test("safeErrorResponse masks a plain Error behind a generic message, leaking nothing", async () => {
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
  const secret = "gbrain sync failed: /Users/someone/.aletheia-brain/private/path.db is locked";
  const res = safeErrorResponse(new Error(secret), json);
  assert.equal(res.status, 500);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /internal error \(ref [0-9a-f]{8}\)/);
  assert.doesNotMatch(body.error, /\.aletheia-brain/);
  assert.doesNotMatch(body.error, /path\.db/);
  for (const word of secret.split(/\s+/)) {
    assert.ok(!body.error.includes(word), `leaked fragment of original error: ${word}`);
  }
});
