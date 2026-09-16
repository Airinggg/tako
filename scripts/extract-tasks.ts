/**
 *   npm run tasks:extract              # default source (engineering)
 *   npm run tasks:extract -- shared
 *   TASKS_MODEL=qwen3.5:9b npm run tasks:extract
 *
 * Mines ongoing-task items from a source's ingested Markdown with a LOCAL model
 * and writes them to config/tasks.json. The demo's Working-memory view then
 * triages them (hot / warm / cold / noise) — nothing is published, nothing
 * leaves the machine.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mineTasks, ollamaModel, type CorpusDoc } from "../lib/tasks/extract.ts";

const REPO = join(import.meta.dir, "..");
const source = process.argv.slice(2).find((a) => !a.startsWith("-")) || process.env.TASKS_SOURCE || "engineering";
const root = join(REPO, "brain-sources", source);

async function corpus(): Promise<CorpusDoc[]> {
  const files = await readdir(root, { recursive: true }).catch(() => [] as string[]);
  const docs: CorpusDoc[] = [];
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    if (f.startsWith("skills/") || f.includes("/skills/") || f.includes(".cursor")) continue;
    const text = await readFile(join(root, f), "utf8").catch(() => "");
    const fm = text.startsWith("---\n") ? text.slice(4, text.indexOf("\n---", 4)) : "";
    const date = fm.match(/^(?:updated|day|date):\s*["']?(\d{4}-\d{2}-\d{2})/m)?.[1];
    const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
    if (body.length > 40) docs.push({ path: `${source}/${f}`, text: body, date });
  }
  return docs;
}

const docs = await corpus();
if (!docs.length) {
  console.error(`no content under brain-sources/${source}/`);
  process.exit(1);
}
process.stdout.write(`mining tasks from ${docs.length} page(s) in "${source}"… `);
const tasks = await mineTasks(docs, ollamaModel());
console.log(`${tasks.length} task(s)`);

const out = { source, extractedAt: new Date().toISOString(), tasks };
await writeFile(join(REPO, "config/tasks.json"), JSON.stringify(out, null, 2) + "\n");
console.log("wrote config/tasks.json");
for (const t of tasks) {
  console.log(`  [${t.state}] ${t.title}${t.owner ? ` — ${t.owner}` : ""}${t.hasDeadline ? " ⏰" : ""}  (${t.firstSeen}, ×${t.mentions})`);
}
