import assert from "node:assert/strict";
import test from "node:test";
import { createZoomMeeting, resolveZoomCredentials, type ZoomCredentials } from "../lib/integrations/zoom/client.ts";

const CREDS: ZoomCredentials = { accountId: "acct_123", clientId: "client_abc", clientSecret: "secret_xyz" };

test("resolveZoomCredentials reads the three env vars via resolveSecret", () => {
  const env = { ZOOM_ACCOUNT_ID: "acct_1", ZOOM_CLIENT_ID: "client_1", ZOOM_CLIENT_SECRET: "secret_1" };
  assert.deepEqual(resolveZoomCredentials(env), { accountId: "acct_1", clientId: "client_1", clientSecret: "secret_1" });
});

test("resolveZoomCredentials throws a clear error when a var is missing", () => {
  assert.throws(() => resolveZoomCredentials({}), /ZOOM_ACCOUNT_ID/);
});

test("createZoomMeeting calls the OAuth token endpoint then the meeting-create endpoint with the exact expected request shape", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("zoom.us/oauth/token")) {
      return new Response(JSON.stringify({ access_token: "fake-token" }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 987654321, join_url: "https://zoom.us/j/987654321", start_url: "https://zoom.us/s/987654321" }), { status: 201 });
  }) as typeof fetch;

  const result = await createZoomMeeting(CREDS, {
    topic: "Follow-up: connector request process",
    agenda: "Steps to get a new data source onboarded.\n\nEvidence: notion/onboarding/connector-request",
    startTime: "2026-10-01T09:00:00.000Z",
    durationMinutes: 45,
  }, { fetchImpl });

  assert.deepEqual(result, { id: "987654321", joinUrl: "https://zoom.us/j/987654321", startUrl: "https://zoom.us/s/987654321" });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /^https:\/\/zoom\.us\/oauth\/token\?grant_type=account_credentials&account_id=acct_123$/);
  assert.equal(calls[0].init.method, "POST");
  const authHeader = (calls[0].init.headers as Record<string, string>).Authorization;
  assert.equal(authHeader, `Basic ${Buffer.from("client_abc:secret_xyz").toString("base64")}`);

  assert.equal(calls[1].url, "https://api.zoom.us/v2/users/me/meetings");
  assert.equal(calls[1].init.method, "POST");
  assert.equal((calls[1].init.headers as Record<string, string>).Authorization, "Bearer fake-token");
  const body = JSON.parse(calls[1].init.body as string);
  assert.equal(body.topic, "Follow-up: connector request process");
  assert.equal(body.type, 2);
  assert.equal(body.start_time, "2026-10-01T09:00:00.000Z");
  assert.equal(body.duration, 45);
  assert.equal(body.settings.join_before_host, false);
});

test("createZoomMeeting throws with status and body on a non-2xx OAuth response", async () => {
  const fetchImpl = (async () => new Response("invalid_client", { status: 401 })) as typeof fetch;
  await assert.rejects(
    createZoomMeeting(CREDS, { topic: "x", agenda: "y", startTime: "2026-10-01T09:00:00.000Z", durationMinutes: 30 }, { fetchImpl }),
    /401.*invalid_client/s,
  );
});

test("createZoomMeeting throws with status and body on a non-2xx meeting-create response", async () => {
  const fetchImpl = (async (url: string) => {
    if (String(url).includes("oauth/token")) return new Response(JSON.stringify({ access_token: "fake-token" }), { status: 200 });
    return new Response("start_time is invalid", { status: 400 });
  }) as typeof fetch;
  await assert.rejects(
    createZoomMeeting(CREDS, { topic: "x", agenda: "y", startTime: "bad", durationMinutes: 30 }, { fetchImpl }),
    /400.*start_time is invalid/s,
  );
});
