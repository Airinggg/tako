/**
 * Append-only provenance log for what a connector sync actually indexed —
 * closes the "no trail of what got embedded, when, by whom" gap (P1-07 in
 * docs/PROTOTYPE_SECURITY_CHECKLIST.md). This is deliberately NOT an
 * approval gate: content still becomes searchable immediately on sync, as
 * scoped for a single trusted customer's own connectors, not a multi-tenant
 * ingestion pipeline. It is an audit trail, so a customer or operator can
 * always answer "what did this sync add to the index."
 */
import { createHash } from "node:crypto";

export type SyncLogEntry = {
  source: string;   // connector name, e.g. "notion"
  path: string;     // path relative to brain-sources/, e.g. "shared/notion/abc.md"
  hash: string;      // sha256 of the file's content at sync time
  syncedBy: string;  // who/what triggered this sync — "operator" for the
                     // single-admin-token model this product uses today
  syncedAt: string;  // ISO timestamp
};

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** One JSON object per line, ready to append to a .jsonl file — never
 *  rewrite this file, only ever append to it. */
export function formatSyncLogLines(entries: readonly SyncLogEntry[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "");
}

/** Parse `git status --porcelain` output (run inside the brain-sources repo,
 *  scoped to one connector's subdir) into the list of changed/added paths a
 *  sync just touched. Deleted paths are excluded — nothing to hash or index. */
export function parseChangedPaths(porcelainOutput: string): string[] {
  return porcelainOutput
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => !line.startsWith(" D") && !line.startsWith("D "))
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}
