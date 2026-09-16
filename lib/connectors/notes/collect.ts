import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";
import type { NotesConnectorConfig } from "../shared/config.ts";

export type NoteRecord = {
  root: string;        // absolute root the file was found under
  rootName: string;    // basename of the root, for the output path
  relPath: string;     // path relative to root, POSIX separators
  absPath: string;
  title: string;
  updated: string;     // ISO mtime
  text: string;
};

const IGNORE_DIRS = new Set([".git", "node_modules", ".obsidian", ".trash"]);

function titleOf(text: string, fallback: string): string {
  const heading = text.split("\n").find((line) => /^#{1,6}\s+\S/.test(line));
  if (heading) return heading.replace(/^#{1,6}\s+/, "").trim();
  const firstLine = text.split("\n").map((l) => l.trim()).find(Boolean);
  return firstLine && firstLine.length <= 120 ? firstLine : fallback;
}

async function walk(dir: string, extensions: string[], out: string[]): Promise<void> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith(".")) await walk(full, extensions, out);
    } else if (entry.isFile() && extensions.includes(extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
}

export async function collectNotes(config: Pick<NotesConnectorConfig, "roots" | "extensions">): Promise<NoteRecord[]> {
  const records: NoteRecord[] = [];
  for (const root of config.roots) {
    const files: string[] = [];
    await walk(root, config.extensions, files);
    for (const absPath of files) {
      const text = await readFile(absPath, "utf8");
      const info = await stat(absPath);
      const relPath = relative(root, absPath).split(sep).join("/");
      records.push({
        root,
        rootName: basename(root) || "notes",
        relPath,
        absPath,
        title: titleOf(text, basename(absPath, extname(absPath))),
        updated: info.mtime.toISOString(),
        text,
      });
    }
  }
  return records.sort((a, b) => (a.rootName + "/" + a.relPath).localeCompare(b.rootName + "/" + b.relPath));
}
