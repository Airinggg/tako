import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadSlackConfig } from "../shared/config.ts";
import { keepWithinWindow, pruneStale } from "../shared/prune.ts";
import { SlackClient } from "./client.ts";
import { collectSlack } from "./collect.ts";
import { renderSlack, tsToIso } from "./render.ts";
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
const keepPaths = new Set(threads.map((thread) => join(outputDir, renderSlack(thread).path)));

// Incremental runs only fetch threads with activity *after* the per-channel
// cursor (see collectSlack's `oldest` handling), so a channel with no new
// activity produces no thread this run. Without this, pruneStale would treat
// that as "every existing thread in that channel was deleted upstream" --
// this is what deleted an operator's entire local Slack corpus on a quiet
// sync (see the regression test below). Mirror Discord's run.ts: on an
// incremental run, also keep every existing file still inside the lookback
// window; only `--full` (an authoritative crawl of the whole window) prunes
// purely by what it re-collected, which is how upstream deletions eventually
// drop out.
if (!full) {
  let existing: string[] = [];
  try { existing = await readdir(join(outputDir, "slack"), { recursive: true }); } catch { /* none yet */ }
  const mdPaths = existing.filter((rel) => rel.endsWith(".md"));
  const dateOf = (rel: string) => {
    const rootTs = rel.match(/([\d.]+)\.md$/)?.[1];
    return rootTs ? tsToIso(rootTs).slice(0, 10) : undefined;
  };
  for (const rel of keepWithinWindow(mdPaths, dateOf, config.lookbackDays)) {
    keepPaths.add(join(outputDir, "slack", rel));
  }
}

const selected = full
  ? threads
  : threads.filter((thread) => !cursor[thread.channelId] || thread.lastTs > cursor[thread.channelId]);

for (const thread of selected) {
  const output = renderSlack(thread);
  const target = join(outputDir, output.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, output.markdown);
}

const pruned = await pruneStale(outputDir, "slack", [...keepPaths]);

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
if (pruned.length) console.log(`pruned ${pruned.length} file(s) no longer in the window:\n  ${pruned.join("\n  ")}`);
