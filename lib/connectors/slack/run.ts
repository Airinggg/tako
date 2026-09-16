import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadSlackConfig } from "../shared/config.ts";
import { pruneStale } from "../shared/prune.ts";
import { SlackClient } from "./client.ts";
import { collectSlack } from "./collect.ts";
import { renderSlack } from "./render.ts";
import { loadPeople, canonicalPerson } from "../shared/people.ts";

const full = process.argv.includes("--full");
const config = await loadSlackConfig();
const outputDir = join(config.sourceDir, config.subdir);
const cursorPath = join(outputDir, ".slack-cursor.json");

let cursor: Record<string, string> = {};
try { cursor = JSON.parse(await readFile(cursorPath, "utf8")); } catch { /* first run */ }

const client = new SlackClient(config.token);
const threads = await collectSlack(client.request, config, Date.now(), full ? {} : cursor);

// Resolve Slack display names to canonical names shared across connectors.
const people = await loadPeople();
for (const thread of threads) {
  for (const message of thread.messages) message.user = canonicalPerson(message.user, people);
  thread.participants = [...new Set(thread.messages.map((m) => m.user))].sort();
}

// Every current thread maps to one file; that set drives pruning.
const keepPaths = threads.map((thread) => join(outputDir, renderSlack(thread).path));

const selected = full
  ? threads
  : threads.filter((thread) => !cursor[thread.channelId] || thread.lastTs > cursor[thread.channelId]);

for (const thread of selected) {
  const output = renderSlack(thread);
  const target = join(outputDir, output.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, output.markdown);
}

const pruned = await pruneStale(outputDir, "slack", keepPaths);

const nextCursor = { ...cursor };
for (const thread of threads) {
  if (!nextCursor[thread.channelId] || thread.lastTs > nextCursor[thread.channelId]) {
    nextCursor[thread.channelId] = thread.lastTs;
  }
}
if (Object.keys(nextCursor).length) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(cursorPath, `${JSON.stringify(nextCursor, null, 2)}\n`);
}

console.log(`wrote ${selected.length} thread file(s) to ${outputDir}/slack/`);
if (pruned.length) console.log(`pruned ${pruned.length} file(s) no longer in the pull:\n  ${pruned.join("\n  ")}`);
