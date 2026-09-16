import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadDiscordConfig } from "../shared/config.ts";
import { keepWithinWindow, pruneStale } from "../shared/prune.ts";
import { DiscordClient } from "./client.ts";
import { collectDiscord, mergeConversationMessages, type DiscordConversation } from "./collect.ts";
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
  let existing: string[] = [];
  try { existing = await readdir(join(outputDir, "discord"), { recursive: true }); } catch { /* none yet */ }
  const mdPaths = existing.filter((rel) => rel.endsWith(".md"));
  const dateOf = (rel: string) => rel.match(/(\d{4}-\d{2}-\d{2})\.md$/)?.[1];
  for (const rel of keepWithinWindow(mdPaths, dateOf, config.lookbackDays)) {
    keepPaths.add(join(outputDir, "discord", rel));
  }
}

// A conversation this run DOES rewrite (day/thread with new activity) must not
// lose the messages it already had — an incremental collectDiscord() call only
// returns messages *after* the cursor, so writing that alone would replace an
// existing file's full history with just the newest slice. Merge against what
// was cached from the last write of this exact conversation, keyed by its
// rendered path (see mergeConversationMessages's own doc comment for why).
const cachePath = join(outputDir, "discord", ".messages-cache.json");
let cache: Record<string, DiscordConversation["messages"]> = {};
try { cache = JSON.parse(await readFile(cachePath, "utf8")); } catch { /* first run */ }

let written = 0;
const nextCache: Record<string, DiscordConversation["messages"]> = {};
for (const conv of conversations) {
  const path = renderDiscord(conv).path;
  const merged = full ? conv : mergeConversationMessages(conv, cache[path] ?? []);
  const out = renderDiscord(merged);
  const target = join(outputDir, out.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, out.markdown);
  nextCache[path] = merged.messages;
  written += 1;
}
// Carry forward cache entries for files this run didn't touch but are still
// being kept (the window-preservation case above) — otherwise a later run
// that DOES touch them would merge against nothing and silently regress.
for (const path of Object.keys(cache)) {
  if (keepPaths.has(join(outputDir, path)) && !(path in nextCache)) nextCache[path] = cache[path];
}

const pruned = await pruneStale(outputDir, "discord", [...keepPaths]);
// Drop cache entries for anything pruneStale just removed, so the cache
// never grows unbounded with dead paths. pruneStale's return paths are
// relative to sourceDir (i.e. prefixed with config.subdir); strip that
// prefix to compare against the cache's own outputDir-relative keys.
const prunedRelToOutput = new Set(pruned.map((p) => p.slice(config.subdir.length + 1)));
const survivingCache = Object.fromEntries(Object.entries(nextCache).filter(([path]) => !prunedRelToOutput.has(path)));
await mkdir(dirname(cachePath), { recursive: true });
await writeFile(cachePath, `${JSON.stringify(survivingCache, null, 2)}\n`);

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
