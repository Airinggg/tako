/**
 * Shared HTTP hardening for the demo/console admin surfaces: auth, input
 * validation, error sanitization, and a simple rate limiter. Both
 * `scripts/demo.ts` and `scripts/console.ts` import from here rather than
 * duplicating this logic — see docs/audit/2026-09-14-p0-hardening-brief.md.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";

/** An error whose message is safe and intended to reach the client verbatim
 *  (validation failures, the existing READ_ONLY guard messages, etc.) —
 *  as opposed to a plain `Error`, which may carry internal details (file
 *  paths, subprocess stderr) and must be masked before it reaches a client. */
export class ClientError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ClientError";
    this.status = status;
  }
}

/** Read and parse a JSON request body, fast-failing on an oversized body
 *  (checked first via Content-Length, then again against the actual text
 *  length) and turning a malformed body into a `ClientError` rather than
 *  letting a raw SyntaxError or unbounded body reach the client/process. */
export async function readJsonBody<T>(req: Request, maxBytes = 1_000_000): Promise<T> {
  const declaredLength = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ClientError("request body too large", 413);
  }
  const text = await req.text();
  if (text.length > maxBytes) {
    throw new ClientError("request body too large", 413);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ClientError("malformed JSON body", 400);
  }
}

/** The shared secret gating mutating routes. If `ADMIN_TOKEN` isn't set,
 *  generate one so a local single-operator run still works with zero setup —
 *  printed once so the operator can copy it into the client's localStorage
 *  prompt. Call this exactly once, inside `if (import.meta.main)`, right
 *  before `Bun.serve(...)` — never at module top-level, so importing this
 *  file's callers for tests never triggers the console.log/random-token side
 *  effect. */
export function resolveAdminToken(): string {
  const fromEnv = process.env.ADMIN_TOKEN;
  if (fromEnv) return fromEnv;
  const generated = randomUUID();
  console.log(`  no ADMIN_TOKEN set — generated one-time admin token: ${generated}`);
  console.log(`  set ADMIN_TOKEN in the environment to keep a stable value across restarts`);
  return generated;
}

/** Constant-time comparison (via node:crypto's timingSafeEqual) so a wrong
 *  guess can't be narrowed down by response timing. */
export function isValidAdminToken(provided: string | null | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Check the `X-Admin-Token` header on a mutating request. Returns `null`
 *  when it matches, or a `ClientError` (401) when it doesn't — the caller
 *  returns that as the response and skips the route handler. */
export function requireAdmin(req: Request, expectedToken: string): ClientError | null {
  const provided = req.headers.get("x-admin-token");
  if (!isValidAdminToken(provided, expectedToken)) {
    return new ClientError("admin token required", 401);
  }
  return null;
}

type RateBucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();

/** A simple in-memory fixed-window rate limiter, keyed by caller-supplied
 *  `key` (see `clientKey`). Intentionally simple — in-memory, resets on
 *  restart, not distributed. Returns `true` when the call is allowed. */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

/** The rate-limit key for a request: the client's IP via Bun's
 *  `server.requestIP(req)`, or "unknown" when it can't be determined. */
export function clientKey(req: Request, server: { requestIP: (req: Request) => { address: string } | null }): string {
  return server.requestIP(req)?.address ?? "unknown";
}

/** The one place an uncaught route error becomes an HTTP response. A
 *  `ClientError` is safe and intentional, so its own message/status go
 *  straight to the client. Anything else (a plain `Error` — e.g. the gbrain
 *  CLI's raw stderr, which can contain internal file paths) is logged in
 *  full server-side with a short correlation id and replaced with a generic
 *  message client-side — this is what closes the P0-06 leak. */
export function safeErrorResponse(err: unknown, json: (data: unknown, status?: number) => Response): Response {
  if (err instanceof ClientError) {
    return json({ error: err.message }, err.status);
  }
  const id = randomUUID().slice(0, 8);
  console.error(`[error ref ${id}]`, err);
  return json({ error: `internal error (ref ${id}) — see server logs` }, 500);
}
