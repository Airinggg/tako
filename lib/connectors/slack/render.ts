import { slugify, yamlString } from "../shared/markdown.ts";
import type { SlackThread } from "./collect.ts";

/** Slack ts ("1724800000.123456", epoch seconds) -> ISO 8601. */
export function tsToIso(ts: string): string {
  return new Date(Math.round(parseFloat(ts) * 1000)).toISOString();
}

function stamp(ts: string): string {
  return tsToIso(ts).replace("T", " ").slice(0, 16); // YYYY-MM-DD HH:MM (UTC)
}

export function renderSlack(thread: SlackThread): { path: string; markdown: string } {
  const path = `slack/${slugify(thread.channelName)}/${thread.rootTs}.md`;

  const frontmatter = [
    "---",
    "source: slack",
    `channel: ${yamlString(`#${thread.channelName}`)}`,
    `channel_id: ${yamlString(thread.channelId)}`,
    `root_ts: ${yamlString(thread.rootTs)}`,
    `url: ${yamlString(thread.permalink)}`,
    `participants: ${yamlString(thread.participants.join(", "))}`,
    `updated: ${yamlString(tsToIso(thread.lastTs))}`,
    "---",
  ].join("\n");

  const block = (m: { user: string; ts: string; text: string }) => `**@${m.user}** (${stamp(m.ts)}):\n\n${m.text.trim()}`;
  const [root, ...replies] = thread.messages;
  const body = replies.length
    ? `${block(root)}\n\n---\n\n${replies.map(block).join("\n\n")}`
    : block(root);

  return { path, markdown: `${frontmatter}\n\n${body}\n` };
}
