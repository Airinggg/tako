import { readdir, rm, rmdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/**
 * Which of an incremental run's existing files to ADD to its keep-set, on top
 * of whatever the pull itself just returned. An incremental connector pull
 * only returns items with activity since the last cursor -- a quiet channel/
 * thread produces nothing this run, which is indistinguishable from "deleted
 * upstream" unless something else keeps its file alive. `dateOf` extracts a
 * YYYY-MM-DD from a relative path (return undefined if it can't be dated,
 * e.g. a thread file with no date in its name -- those are always kept, since
 * only a `--full` crawl can tell a merely-undated file from a truly-deleted
 * one). Only a `--full` run should omit this and prune by pull results alone.
 */
export function keepWithinWindow(existingRelPaths: readonly string[], dateOf: (relPath: string) => string | undefined, lookbackDays: number, now = new Date()): string[] {
  const cutoffDay = new Date(now.getTime() - lookbackDays * 86_400_000).toISOString().slice(0, 10);
  return existingRelPaths.filter((rel) => {
    const day = dateOf(rel);
    return !day || day >= cutoffDay;
  });
}

/**
 * Delete Markdown files under `<sourceDir>/<subdir>/` that are not in `keepPaths`
 * (absolute paths of files the current pull produced). This is how a page deleted
 * upstream stops being in the brain: `gbrain sync` prunes a source page when its
 * file disappears.
 *
 * Only touches `.md` files beneath `<sourceDir>/<subdir>/`. The cursor file and
 * every other connector's subdir are left alone.
 */
export async function pruneStale(sourceDir: string, subdir: string, keepPaths: Iterable<string>): Promise<string[]> {
  const root = join(sourceDir, subdir);
  const keep = new Set(keepPaths);
  let entries: string[];
  try {
    entries = await readdir(root, { recursive: true });
  } catch {
    return []; // subdir not created yet — nothing to prune
  }

  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const absolute = join(root, entry);
    if (keep.has(absolute)) continue;
    await rm(absolute, { force: true });
    removed.push(relative(sourceDir, absolute).split(sep).join("/"));
  }

  // Best-effort: drop child directories left empty by the prune.
  for (const entry of entries) {
    if (entry.includes(sep) || entry.endsWith(".md")) continue;
    await rmdir(join(root, entry)).catch(() => {});
  }

  return removed;
}
