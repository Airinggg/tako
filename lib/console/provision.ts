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
import { ClientError } from "../util/http-security.ts";

const REPO = join(import.meta.dir, "..", "..");
const BRAIN_CLI = join(REPO, "packages/brain/src/cli.ts");

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
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(name)) throw new ClientError("name must be kebab-case, 2-64 chars");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ClientError("enter a valid email address");
  const reads = [...new Set([source, ...federatedRead])].filter(Boolean);
  if (!source || !reads.length) throw new ClientError("the selected scope has no realised source yet");

  const out = gb([
    "auth", "register-client", name,
    "--scopes", "read",
    "--source", source,
    "--federated-read", reads.join(","),
    "--token-endpoint-auth-method", "none",
  ]);
  const clientId = out.match(/(gbrain_cl_[a-f0-9]{16,})/)?.[1] ?? "";
  if (!clientId) throw new Error(`could not parse a client id from gbrain's output: ${out}`);
  try {
    gb(["auth", "rescope-client", clientId, "--surface", "starter"]);
  } catch (err) {
    // A client that fails to pin --surface starter is left at gbrain's
    // default (full) surface -- every operator-level op, not just read
    // ones. Never let a half-provisioned client survive: revoke it and
    // surface the real failure, rather than leaving a live, wide-open
    // client with no record that provisioning "failed."
    try { gb(["auth", "revoke-client", clientId]); } catch { /* best effort */ }
    throw err;
  }
  return { name, email, source, reads, clientId, secret: "", raw: out };
}

export function revoke(clientId: string): string {
  if (!/^gbrain_cl_[a-f0-9]+$/.test(clientId)) throw new ClientError("bad client id");
  try {
    return gb(["auth", "revoke-client", clientId]);
  } catch (err) {
    // Revoking a client that's already gone (e.g. a race between two admin
    // tabs) is the caller's desired end state, not a failure -- treat it as
    // success rather than surfacing a 500 (spec section 7).
    if (err instanceof Error && /No client found/i.test(err.message)) {
      return `client ${clientId} was already revoked`;
    }
    throw err;
  }
}
