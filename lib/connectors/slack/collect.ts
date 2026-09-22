import type { SlackConnectorConfig } from "../shared/config.ts";
import type { SlackRequest } from "./client.ts";

export type SlackMessage = { user: string; ts: string; text: string; isRoot: boolean };
export type SlackThread = {
  channelId: string; channelName: string; rootTs: string; permalink: string;
  participants: string[]; lastTs: string; messages: SlackMessage[];
  /** True when this root has replies and must be revisited on later incremental pulls. */
  isThread: boolean;
};

const SKIP_SUBTYPES = new Set(["channel_join", "channel_leave", "channel_topic", "channel_purpose", "channel_name", "bot_add", "bot_remove"]);

/** Replace Slack's `<@U…>` and `<#C…|name>` and `<url|label>` markup with plain text. */
export function resolveText(text: string, users: Map<string, string>): string {
  return (text ?? "")
    .replace(/<@([A-Z0-9]+)(\|[^>]+)?>/g, (_m, id) => `@${users.get(id) ?? id}`)
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, (_m, name) => `#${name}`)
    .replace(/<#([A-Z0-9]+)>/g, (_m, id) => `#${id}`)
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, (_m, url, label) => `${label} (${url})`)
    .replace(/<(https?:[^|>]+)>/g, (_m, url) => url);
}

async function paginate(request: SlackRequest, method: string, params: Record<string, any>, key: string): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  do {
    const page = await request(method, { ...params, limit: 200, cursor });
    out.push(...(page[key] ?? []));
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return out;
}

async function userMap(request: SlackRequest): Promise<Map<string, string>> {
  const members = await paginate(request, "users.list", {}, "members");
  const map = new Map<string, string>();
  for (const member of members) {
    const name = member.profile?.display_name || member.real_name || member.name || member.id;
    map.set(member.id, name);
  }
  return map;
}

async function resolveChannels(request: SlackRequest, wanted: string[]): Promise<{ id: string; name: string }[]> {
  const byId = wanted.filter((c) => /^[CG][A-Z0-9]+$/.test(c));
  const byName = wanted.filter((c) => !/^[CG][A-Z0-9]+$/.test(c)).map((c) => c.replace(/^#/, ""));
  const resolved: { id: string; name: string }[] = [];

  if (byName.length) {
    // Requesting private_channel alongside public_channel needs the bot's
    // groups:read scope even when every wanted channel is public — fall back
    // to public-only rather than fail the whole run over a scope the config
    // may not need yet, and say so once instead of erroring silently later.
    let channels: any[];
    try {
      channels = await paginate(request, "conversations.list", { types: "public_channel,private_channel", exclude_archived: true }, "channels");
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes("missing_scope")) throw err;
      console.warn("slack: missing groups:read scope — falling back to public channels only. Private channels will not resolve by name until the bot has groups:read.");
      channels = await paginate(request, "conversations.list", { types: "public_channel", exclude_archived: true }, "channels");
    }
    for (const name of byName) {
      const hit = channels.find((c: any) => c.name?.toLowerCase() === name.toLowerCase());
      if (hit) resolved.push({ id: hit.id, name: hit.name });
      else console.warn(`slack: channel "#${name}" not found. Visible channels: ${channels.map((c: any) => c.name).join(", ") || "(none)"}`);
    }
  }
  for (const id of byId) {
    try {
      const info = await request("conversations.info", { channel: id });
      resolved.push({ id, name: info.channel?.name ?? id });
    } catch {
      resolved.push({ id, name: id });
    }
  }
  return resolved;
}

export async function collectSlack(
  request: SlackRequest,
  config: Pick<SlackConnectorConfig, "channels" | "includeThreads" | "lookbackDays">,
  now = Date.now(),
  oldestByChannel: Record<string, string> = {},
  knownThreadRootsByChannel: Record<string, string[]> = {},
): Promise<SlackThread[]> {
  const users = await userMap(request);
  const channels = await resolveChannels(request, config.channels);
  const defaultOldest = ((now - config.lookbackDays * 86_400_000) / 1000).toFixed(6);
  const threads: SlackThread[] = [];

  for (const channel of channels) {
    const oldest = oldestByChannel[channel.id] ?? defaultOldest;
    const history = await paginate(request, "conversations.history", { channel: channel.id, oldest }, "messages");
    const knownRoots = new Set(knownThreadRootsByChannel[channel.id] ?? []);
    const roots = new Map<string, any>();
    for (const root of history) if (root.ts) roots.set(root.ts, root);
    // conversations.history only returns roots newer than `oldest`. Revisit
    // previously-known thread roots separately so a new reply on an old root
    // is not invisible to incremental sync.
    for (const rootTs of knownRoots) {
      if (!roots.has(rootTs)) roots.set(rootTs, { ts: rootTs, thread_ts: rootTs });
    }

    for (const root of roots.values()) {
      if (root.subtype && SKIP_SUBTYPES.has(root.subtype)) continue;
      if (!root.ts) continue;

      let raw: any[] = [root];
      const isThread = config.includeThreads && (root.reply_count > 0 || knownRoots.has(root.ts));
      if (isThread) {
        const replies = await paginate(request, "conversations.replies", { channel: channel.id, ts: root.thread_ts ?? root.ts }, "messages");
        if (!replies.length && knownRoots.has(root.ts)) continue;
        if (replies.length) raw = replies;
      }

      const messages: SlackMessage[] = raw
        .filter((m) => m.ts && !(m.subtype && SKIP_SUBTYPES.has(m.subtype)))
        .map((m, index) => ({
          user: users.get(m.user) ?? m.user ?? (m.bot_id ? "bot" : "unknown"),
          ts: m.ts,
          text: resolveText(m.text ?? "", users),
          isRoot: index === 0,
        }));
      if (!messages.length) continue;

      let permalink = "";
      try {
        permalink = (await request("chat.getPermalink", { channel: channel.id, message_ts: root.ts })).permalink ?? "";
      } catch { /* permalink is best-effort */ }

      threads.push({
        channelId: channel.id,
        channelName: channel.name,
        rootTs: root.ts,
        permalink,
        participants: [...new Set(messages.map((m) => m.user))].sort(),
        lastTs: messages.reduce((max, m) => (m.ts > max ? m.ts : max), root.ts),
        messages,
        isThread,
      });
    }
  }

  return threads.sort((a, b) => (a.channelId + a.rootTs).localeCompare(b.channelId + b.rootTs));
}
