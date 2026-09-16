import type { DiscordConnectorConfig } from "../shared/config.ts";
import type { DiscordRequest } from "./client.ts";

export type DiscordMessage = { author: string; id: string; timestamp: string; text: string };
export type DiscordConversation = {
  guildId: string; channelId: string; channelName: string;
  kind: "day" | "thread";
  key: string;            // YYYY-MM-DD (day) or thread id
  threadName?: string;
  url: string;            // permalink of the first message
  participants: string[];
  updated: string;        // ISO of the last message
  messages: DiscordMessage[];
};

// Message types that carry conversational content. Skip joins, pins, boosts, etc.
const CONTENT_TYPES = new Set([0, 19, 21]); // default, reply, thread-starter

const authorName = (u: any): string => u?.global_name || u?.username || u?.id || "unknown";

/** Resolve `<@id>` / `<@!id>` mentions, `<#id>` channels, `<:name:id>` emoji. */
export function resolveContent(text: string, mentions: any[], channels: Map<string, string>): string {
  const users = new Map<string, string>((mentions ?? []).map((u) => [u.id, authorName(u)]));
  return (text ?? "")
    .replace(/<@!?(\d+)>/g, (_m, id) => `@${users.get(id) ?? id}`)
    .replace(/<#(\d+)>/g, (_m, id) => `#${channels.get(id) ?? id}`)
    .replace(/<a?:(\w+):\d+>/g, (_m, name) => `:${name}:`);
}

async function messagesSince(
  request: DiscordRequest, channelId: string, after: string | undefined, cutoffMs: number,
): Promise<any[]> {
  const out: any[] = [];
  if (after) {
    // incremental: page forward from the cursor (Discord returns newest-first even with `after`)
    let cursor = after;
    for (;;) {
      const page: any[] = await request(`/channels/${channelId}/messages`, { after: cursor, limit: 100 });
      if (!page.length) break;
      out.push(...page);
      cursor = page.reduce((max, m) => (BigInt(m.id) > BigInt(max) ? m.id : max), cursor);
      if (page.length < 100) break;
    }
  } else {
    // first run: page backward until older than the lookback cutoff
    let before: string | undefined;
    for (;;) {
      const page: any[] = await request(`/channels/${channelId}/messages`, { before, limit: 100 });
      if (!page.length) break;
      out.push(...page);
      const oldest = page[page.length - 1];
      before = oldest.id;
      if (Date.parse(oldest.timestamp) < cutoffMs || page.length < 100) break;
    }
  }
  return out
    .filter((m) =>
      CONTENT_TYPES.has(m.type ?? 0) &&
      Date.parse(m.timestamp) >= cutoffMs &&
      !m.author?.bot &&                 // drop bot / webhook chatter (incl. this connector's own bot)
      (m.content ?? "").trim() !== ""   // drop empty posts (attachment-only, embeds, stray newlines)
    )
    .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)); // oldest-first
}

export async function collectDiscord(
  request: DiscordRequest,
  config: Pick<DiscordConnectorConfig, "guildId" | "channels" | "includeThreads" | "lookbackDays">,
  now = Date.now(),
  cursorByChannel: Record<string, string> = {},
): Promise<DiscordConversation[]> {
  const cutoffMs = now - config.lookbackDays * 86_400_000;

  const guildChannels: any[] = await request(`/guilds/${config.guildId}/channels`);
  const nameById = new Map<string, string>(guildChannels.map((c) => [c.id, c.name]));

  const wanted: { id: string; name: string }[] = [];
  for (const entry of config.channels) {
    if (/^\d+$/.test(entry)) {
      wanted.push({ id: entry, name: nameById.get(entry) ?? entry });
    } else {
      const hit = guildChannels.find((c) => c.name?.toLowerCase() === entry.replace(/^#/, "").toLowerCase());
      if (hit) wanted.push({ id: hit.id, name: hit.name });
      else console.warn(`discord: channel "#${entry}" not in guild. Visible: ${guildChannels.map((c) => c.name).join(", ")}`);
    }
  }

  // Active threads whose parent is a wanted channel.
  const threadChannels: { id: string; name: string; parentId: string; threadName: string }[] = [];
  if (config.includeThreads) {
    try {
      const active = await request(`/guilds/${config.guildId}/threads/active`);
      for (const t of active.threads ?? []) {
        if (wanted.some((w) => w.id === t.parent_id)) {
          threadChannels.push({ id: t.id, name: nameById.get(t.parent_id) ?? t.parent_id, parentId: t.parent_id, threadName: t.name });
        }
      }
    } catch { /* needs the GUILD scope; best-effort */ }
  }

  const conversations: DiscordConversation[] = [];

  for (const channel of wanted) {
    const raw = await messagesSince(request, channel.id, cursorByChannel[channel.id], cutoffMs);
    // group by UTC date
    const byDay = new Map<string, any[]>();
    for (const m of raw) {
      const day = m.timestamp.slice(0, 10);
      let bucket = byDay.get(day);
      if (!bucket) byDay.set(day, (bucket = []));
      bucket.push(m);
    }
    for (const [day, msgs] of byDay) {
      conversations.push(buildConversation(config.guildId, channel, "day", day, undefined, msgs));
    }
  }

  for (const thread of threadChannels) {
    const raw = await messagesSince(request, thread.id, cursorByChannel[thread.id], cutoffMs);
    if (raw.length) {
      conversations.push(
        buildConversation(config.guildId, { id: thread.id, name: thread.name }, "thread", thread.id, thread.threadName, raw),
      );
    }
  }

  return conversations.sort((a, b) => (a.channelId + a.key).localeCompare(b.channelId + b.key));

  function buildConversation(
    guildId: string, ch: { id: string; name: string }, kind: "day" | "thread",
    key: string, threadName: string | undefined, raw: any[],
  ): DiscordConversation {
    const messages: DiscordMessage[] = raw.map((m) => ({
      author: authorName(m.author),
      id: m.id,
      timestamp: m.timestamp,
      text: resolveContent(m.content ?? "", m.mentions ?? [], nameById),
    }));
    const first = raw[0];
    return {
      guildId, channelId: ch.id, channelName: ch.name, kind, key, threadName,
      url: `https://discord.com/channels/${guildId}/${ch.id}/${first.id}`,
      participants: [...new Set(messages.map((m) => m.author))].sort(),
      updated: raw[raw.length - 1].timestamp,
      messages,
    };
  }
}
