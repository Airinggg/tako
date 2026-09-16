import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadNotesConfig } from "../shared/config.ts";
import { pruneStale } from "../shared/prune.ts";
import { collectNotes } from "./collect.ts";
import { renderNote } from "./render.ts";

const full = process.argv.includes("--full");
const config = await loadNotesConfig();
const outputDir = join(config.sourceDir, config.subdir);
const cursorPath = join(outputDir, ".notes-cursor.json");

let cursor: string | undefined;
try { cursor = JSON.parse(await readFile(cursorPath, "utf8")).updated; } catch { /* first run */ }

const records = await collectNotes(config);
const keepPaths = records.map((record) => join(outputDir, renderNote(record).path));

const selected = full ? records : records.filter((record) => !cursor || record.updated > cursor);
for (const record of selected) {
  const output = renderNote(record);
  const target = join(outputDir, output.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, output.markdown);
}

const pruned = await pruneStale(outputDir, "notes", keepPaths);

const newest = records.map((record) => record.updated).sort().at(-1) ?? cursor;
if (newest) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(cursorPath, `${JSON.stringify({ updated: newest }, null, 2)}\n`);
}

console.log(`wrote ${selected.length} note file(s) to ${outputDir}/notes/ (from ${records.length} found)`);
if (pruned.length) console.log(`pruned ${pruned.length} file(s) no longer in the notes roots:\n  ${pruned.join("\n  ")}`);
