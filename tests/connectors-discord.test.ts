import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { collectDiscord, resolveContent } from "../lib/connectors/discord/collect.ts";
import { renderDiscord } from "../lib/connectors/discord/render.ts";

const api = JSON.parse(await readFile(new URL("../lib/connectors/discord/__fixtures__/discord-api.json", import.meta.url), "utf8"));
const request = async (path: string) => {
  if (path in api) return api[path];
  throw new Error(`no fixture for ${path}`);
};

test("resolveContent rewrites mentions, channel refs and emoji", () => {
  const out = resolveContent("hi <@222> in <#200> <:wave:1> <@!999>", [{ id: "222", global_name: "Bea Example" }], new Map([["200", "random"]]));
  assert.equal(out, "hi @Bea Example in #random :wave: @999");
});

test("collectDiscord groups a channel by day, includes threads, skips non-content types", async () => {
  const convs = await collectDiscord(request, { guildId: "G1", channels: ["planning"], includeThreads: true, lookbackDays: 3650 }, Date.parse("2026-08-29T00:00:00Z"));
  // one "day" conversation for 2026-08-28 (the type:7 join on 08-27 is skipped -> no 08-27 file) + one thread
  const day = convs.find((c) => c.kind === "day");
  const thread = convs.find((c) => c.kind === "thread");
  assert.ok(day && thread);
  assert.equal(day.key, "2026-08-28");
  assert.equal(day.messages.length, 2); // bot post ("Tako brain") and whitespace-only post are dropped
  assert.ok(!day.messages.some((m) => m.author === "Tako brain"), "bot messages excluded");
  assert.ok(!day.messages.some((m) => m.text.trim() === ""), "empty messages excluded");
  assert.deepEqual(day.messages.map((m) => m.author), ["Ada Example", "Ada Example"]); // oldest-first
  assert.equal(day.messages[0].text, "hey @Bea Example can you check #random");
  assert.match(day.messages[1].text, /:tada: https:\/\/ex\.dev\/plan$/);
  assert.equal(day.url, "https://discord.com/channels/G1/100/40"); // permalink of first (oldest) message
  assert.deepEqual(day.participants, ["Ada Example"]);
  assert.equal(thread.threadName, "spec review");
  assert.equal(thread.messages[0].text, "spec: use option A");
});

test("renderDiscord is deterministic and path-scoped", async () => {
  const [conv] = await collectDiscord(request, { guildId: "G1", channels: ["planning"], includeThreads: false, lookbackDays: 3650 }, Date.parse("2026-08-29T00:00:00Z"));
  const { path, markdown } = renderDiscord(conv);
  assert.equal(path, "discord/planning/2026-08-28.md");
  assert.match(markdown, /^---\nsource: discord\nchannel: "#planning"\nchannel_id: "100"\nguild_id: "G1"\nday: "2026-08-28"/);
  assert.match(markdown, /url: "https:\/\/discord\.com\/channels\/G1\/100\/40"/);
  assert.match(markdown, /\*\*@Ada Example\*\* \(2026-08-28 09:00\):\n\nhey @Bea Example can you check #random/);
});
