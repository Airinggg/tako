import { readdir, rm, rmdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

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
