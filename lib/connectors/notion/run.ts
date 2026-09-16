import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadNotionConfig } from "../shared/config.ts";
import { NotionClient } from "./client.ts";
import { collectNotion } from "./collect.ts";
import { renderNotion } from "./render.ts";
import { pruneStale } from "../shared/prune.ts";
import { loadPeople, canonicalPerson } from "../shared/people.ts";

const full = process.argv.includes("--full");
const config = await loadNotionConfig();
const outputDir = join(config.sourceDir, config.subdir);
const cursorPath = join(outputDir, ".notion-cursor.json");
let cursor: string | undefined;
try { cursor = JSON.parse(await readFile(cursorPath, "utf8")).lastEditedTime; } catch { /* first run */ }

const client = new NotionClient(config.token, config.notionVersion);
const records = await collectNotion(client.request.bind(client), config);

// Resolve authors to canonical names shared across connectors (config/people.json).
const people = await loadPeople();
for (const record of records) record.author = canonicalPerson(record.author, people);

// Every current record maps to one file; that set is authoritative for pruning
// even on an incremental run (collectNotion always pulls the full current set).
const keepPaths = records.map((record) => join(outputDir, renderNotion(record).path));

const selected = full ? records : records.filter((record) => !cursor || record.lastEditedTime > cursor);
for (const record of selected) {
  const output = renderNotion(record);
  const target = join(outputDir, output.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, output.markdown);
}

const pruned = await pruneStale(outputDir, "notion", keepPaths);

const newest = records.map((record) => record.lastEditedTime).sort().at(-1) ?? cursor;
if (newest) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(cursorPath, `${JSON.stringify({ lastEditedTime: newest }, null, 2)}\n`);
}

console.log(`wrote ${selected.length} markdown file(s) to ${outputDir}/notion/`);
if (pruned.length) console.log(`pruned ${pruned.length} file(s) no longer in Notion:\n  ${pruned.join("\n  ")}`);
