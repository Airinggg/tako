import { slugify, yamlString } from "../shared/markdown.ts";
import type { DiscordConversation } from "./collect.ts";

const stamp = (iso: string) => iso.replace("T", " ").slice(0, 16); // YYYY-MM-DD HH:MM (UTC)

export function renderDiscord(conv: DiscordConversation): { path: string; markdown: string } {
  const chSlug = slugify(conv.channelName);
  const path = conv.kind === "thread"
    ? `discord/${chSlug}/thread-${slugify(conv.threadName ?? conv.key)}-${conv.key}.md`
    : `discord/${chSlug}/${conv.key}.md`;

  const frontmatter = [
    "---",
    "source: discord",
    `channel: ${yamlString(`#${conv.channelName}`)}`,
    `channel_id: ${yamlString(conv.channelId)}`,
    `guild_id: ${yamlString(conv.guildId)}`,
    conv.kind === "thread" ? `thread: ${yamlString(conv.threadName ?? conv.key)}` : `day: ${yamlString(conv.key)}`,
    `url: ${yamlString(conv.url)}`,
    `participants: ${yamlString(conv.participants.join(", "))}`,
    `updated: ${yamlString(conv.updated)}`,
    "---",
  ].join("\n");

  const body = conv.messages
    .map((m) => `**@${m.author}** (${stamp(m.timestamp)}):\n\n${m.text.trim()}`)
    .join("\n\n");

  return { path, markdown: `${frontmatter}\n\n${body}\n` };
}
