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
  action: "synced" | "deleted";
  hash: string;      // sha256 of the file's content at sync time; "" for a deleted entry
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
 *  sync just touched. Deleted paths are excluded — nothing to hash or index.
 *  Kept for compatibility with existing callers that only care about
 *  additions/modifications; `parseGitStatus` below returns both. */
export function parseChangedPaths(porcelainOutput: string): string[] {
  return parseGitStatus(porcelainOutput).changed;
}

/** Same parse as `parseChangedPaths`, but also returns deleted paths
 *  separately — a real audit trail needs to record a removal, not just
 *  silently drop it (a connector's prune step can delete indexed files;
 *  that's a provenance event too, not a no-op). */
export function parseGitStatus(porcelainOutput: string): { changed: string[]; deleted: string[] } {
  const changed: string[] = [];
  const deleted: string[] = [];
  for (const raw of porcelainOutput.split("\n")) {
    const line = raw.trimEnd();
    if (!line) continue;
    const path = line.slice(3).trim();
    if (!path) continue;
    if (line.startsWith(" D") || line.startsWith("D ")) deleted.push(path);
    else changed.push(path);
  }
  return { changed, deleted };
}

/**
 * Which of `after`'s changed/deleted paths are actually attributable to
 * THIS run — i.e. weren't already dirty in `before`. Two connectors
 * sharing a subdir (e.g. notion and drive both under "shared" by default)
 * can each leave the other's uncommitted output sitting in `git status`;
 * without this diff, a sync run attributes every currently-dirty file to
 * whichever connector happened to run last (see the regression test for
 * the exact two-connector scenario this fixes).
 */
export function diffGitStatus(
  before: { changed: string[]; deleted: string[] },
  after: { changed: string[]; deleted: string[] },
): { changed: string[]; deleted: string[] } {
  const beforeChanged = new Set(before.changed);
  const beforeDeleted = new Set(before.deleted);
  return {
    changed: after.changed.filter((p) => !beforeChanged.has(p)),
    deleted: after.deleted.filter((p) => !beforeDeleted.has(p)),
  };
}
