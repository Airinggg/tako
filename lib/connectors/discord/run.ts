import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadDiscordConfig } from "../shared/config.ts";
import { pruneStale } from "../shared/prune.ts";
import { DiscordClient } from "./client.ts";
import { collectDiscord } from "./collect.ts";
import { renderDiscord } from "./render.ts";
import { loadPeople, canonicalPerson } from "../shared/people.ts";

const full = process.argv.includes("--full");
const config = await loadDiscordConfig();
const outputDir = join(config.sourceDir, config.subdir);
const cursorPath = join(outputDir, ".discord-cursor.json");

let cursor: Record<string, string> = {};
try { cursor = JSON.parse(await readFile(cursorPath, "utf8")); } catch { /* first run */ }

const client = new DiscordClient(config.token);
const conversations = await collectDiscord(client.get, config, Date.now(), full ? {} : cursor);

// Canonicalise authors across connectors (config/people.json).
const people = await loadPeople();
for (const conv of conversations) {
  for (const m of conv.messages) m.author = canonicalPerson(m.author, people);
  conv.participants = [...new Set(conv.messages.map((m) => m.author))].sort();
}

// A "day" file for an ongoing day is rewritten every run (new messages append),
// so pruning must keep every current conversation's path.
const keepPaths = new Set(conversations.map((c) => join(outputDir, renderDiscord(c).path)));

// Incremental runs only fetch messages *after* the per-channel cursor, so a
// channel with no new activity produces no conversation this run. Without this,
// pruneStale would delete its still-in-window files. So on an incremental run we
// also keep every existing file that is younger than the lookback cutoff; only
// `--full` (an authoritative crawl of the whole window) prunes purely by what it
// re-collected, which is how upstream deletions eventually drop out.
if (!full) {
  const cutoffDay = new Date(Date.now() - config.lookbackDays * 86_400_000).toISOString().slice(0, 10);
  let existing: string[] = [];
  try { existing = await readdir(join(outputDir, "discord"), { recursive: true }); } catch { /* none yet */ }
  for (const rel of existing) {
    if (!rel.endsWith(".md")) continue;
    const day = rel.match(/(\d{4}-\d{2}-\d{2})\.md$/)?.[1];
    // day files: keep if still in window; thread files (no date): keep (staleness needs a full crawl)
    if (!day || day >= cutoffDay) keepPaths.add(join(outputDir, "discord", rel));
  }
}

let written = 0;
for (const conv of conversations) {
  const out = renderDiscord(conv);
  const target = join(outputDir, out.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, out.markdown);
  written += 1;
}

const pruned = await pruneStale(outputDir, "discord", [...keepPaths]);

// cursor = highest message id seen per channel
const nextCursor = { ...cursor };
for (const conv of conversations) {
  const maxId = conv.messages.reduce((max, m) => (BigInt(m.id) > BigInt(max || "0") ? m.id : max), nextCursor[conv.channelId] ?? "");
  if (maxId) nextCursor[conv.channelId] = maxId;
}
if (Object.keys(nextCursor).length) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(cursorPath, `${JSON.stringify(nextCursor, null, 2)}\n`);
}

console.log(`wrote ${written} conversation file(s) to ${outputDir}/discord/`);
if (pruned.length) console.log(`pruned ${pruned.length} file(s) no longer in the window:\n  ${pruned.join("\n  ")}`);
