import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectSlack, resolveText } from "../lib/connectors/slack/collect.ts";
import { renderSlack, tsToIso } from "../lib/connectors/slack/render.ts";
import { keepWithinWindow, pruneStale } from "../lib/connectors/shared/prune.ts";

const api = JSON.parse(await readFile(new URL("../lib/connectors/slack/__fixtures__/slack-api.json", import.meta.url), "utf8"));
const request = async (method: string, params: Record<string, any> = {}) => {
  const keyed = method === "conversations.history" ? `conversations.history:${params.channel}`
    : method === "conversations.replies" ? `conversations.replies:${params.ts}`
    : method === "chat.getPermalink" ? `chat.getPermalink:${params.message_ts}`
    : method;
  const hit = api[keyed];
  if (!hit) throw new Error(`no fixture for ${keyed}`);
  return hit;
};

test("resolveText rewrites Slack markup to plain text", () => {
  const users = new Map([["U01", "ada"]]);
  assert.equal(resolveText("hi <@U01> in <#C100|planning> read <https://x.dev|docs>", users), "hi @ada in #planning read docs (https://x.dev)");
  assert.equal(resolveText("unknown <@U99>", users), "unknown @U99");
});

test("collectSlack assembles standalone messages and threads with resolved names", async () => {
  const threads = await collectSlack(request, { channels: ["C100"], includeThreads: true, lookbackDays: 30 });
  assert.equal(threads.length, 2);

  const [thread, standalone] = threads.sort((a, b) => a.rootTs.localeCompare(b.rootTs));
  // rootTs 1724800000 (thread) sorts before 1724800200 (standalone)
  assert.equal(thread.messages.length, 3);
  // U01 -> profile.display_name "ada"; U02 -> display_name is "", falls back to real_name.
  assert.deepEqual(thread.participants, ["Bea Example", "ada"]);
  assert.equal(thread.lastTs, "1724800900.000400");
  assert.equal(thread.messages[2].text, "Shipping the plan (https://example.com)");
  assert.equal(thread.permalink, "https://acme.slack.com/archives/C100/p1724800000000200");

  assert.equal(standalone.messages.length, 1);
  assert.equal(standalone.messages[0].text, "Standalone note for @ada see #planning");
});

test("renderSlack produces deterministic Markdown", () => {
  const md = renderSlack({
    channelId: "C100", channelName: "planning", rootTs: "1724800000.000200",
    permalink: "https://acme.slack.com/archives/C100/p1724800000000200",
    participants: ["ada", "bea"], lastTs: "1724800900.000400",
    messages: [
      { user: "ada", ts: "1724800000.000200", text: "Kickoff thread", isRoot: true },
      { user: "bea", ts: "1724800050.000300", text: "On it", isRoot: false },
    ],
  }).markdown;
  assert.match(md, /^---\nsource: slack\nchannel: "#planning"\nchannel_id: "C100"\nroot_ts: "1724800000\.000200"/);
  assert.match(md, /participants: "ada, bea"/);
  assert.match(md, /\*\*@ada\*\* \(2024-08-27 23:06\):\n\nKickoff thread\n\n---\n\n\*\*@bea\*\* \(2024-08-27 23:07\):\n\nOn it\n$/);
});

test("tsToIso converts Slack epoch-seconds", () => {
  assert.equal(tsToIso("1724800000.000200"), "2024-08-27T23:06:40.000Z");
});

test("pruneStale drops slack markdown no longer in the pull", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slack-prune-"));
  await mkdir(join(dir, "slack", "planning"), { recursive: true });
  await mkdir(join(dir, "notion", "wiki"), { recursive: true });
  const keep = join(dir, "slack", "planning", "1.md");
  await writeFile(keep, "keep");
  await writeFile(join(dir, "slack", "planning", "2-stale.md"), "stale");
  await writeFile(join(dir, "notion", "wiki", "untouched.md"), "notion"); // other connector, must survive

  const removed = await pruneStale(dir, "slack", [keep]);

  assert.deepEqual(removed, ["slack/planning/2-stale.md"]);
  assert.deepEqual(await readdir(join(dir, "slack", "planning")), ["1.md"]);
  assert.deepEqual(await readdir(join(dir, "notion", "wiki")), ["untouched.md"]);
});

test("keepWithinWindow preserves undated and still-fresh paths, drops only stale-dated ones", () => {
  const dateOf = (rel: string) => rel.match(/([\d.]+)\.md$/)?.[1] && tsToIso(rel.match(/([\d.]+)\.md$/)![1]).slice(0, 10);
  const now = new Date("2026-09-16T00:00:00.000Z");
  const paths = [
    "planning/1724800000.000200.md", // 2024-08-27 -- long past a 30-day window
    "planning/1789430400.000000.md", // 2026-09-15 -- inside a 30-day window
  ];
  assert.deepEqual(keepWithinWindow(paths, dateOf, 30, now), ["planning/1789430400.000000.md"]);
});

test("keepWithinWindow: an incremental sync with zero new threads must not wipe every existing thread file (regression for #3)", () => {
  // Simulates the real bug: collectSlack() returns nothing for a quiet channel,
  // so run.ts's naive keepPaths (built only from this run's threads) would be
  // empty, and pruneStale would then delete every previously-synced thread.
  const dateOf = (rel: string) => rel.match(/([\d.]+)\.md$/)?.[1] && tsToIso(rel.match(/([\d.]+)\.md$/)![1]).slice(0, 10);
  const existingFiles = ["planning/1789430400.000000.md", "planning/1789344000.000000.md"];
  const now = new Date("2026-09-16T00:00:00.000Z"); // both files are from the last two days
  const kept = keepWithinWindow(existingFiles, dateOf, 30, now);
  assert.deepEqual(kept.sort(), existingFiles.sort());
});
