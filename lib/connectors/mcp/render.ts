import { slugify, yamlString } from "../shared/markdown.ts";
import type { McpItem } from "./collect.ts";

/** Stable, short slug for an arbitrary resource URI. */
function uriSlug(uri: string): string {
  const cleaned = uri
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")   // scheme://
    .replace(/^[a-z][a-z0-9+.-]*:/i, "")        // scheme: (opaque)
    .replace(/[?#].*$/, "");
  const parts = cleaned.split(/[/\\]+/).filter(Boolean).map(slugify).filter(Boolean);
  const tail = parts.slice(-3).join("/") || "resource";
  // guard against collisions from truncation with a short hash of the full uri
  let h = 2166136261;
  for (let i = 0; i < uri.length; i++) { h ^= uri.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${tail}-${(h >>> 0).toString(36).slice(0, 6)}`;
}

export function renderMcp(item: McpItem): { path: string; markdown: string } {
  const path = `mcp/${slugify(item.server)}/${uriSlug(item.uri)}.md`;
  const fm = [
    "---",
    "source: mcp",
    `mcp_server: ${yamlString(item.server)}`,
    `server_name: ${yamlString(item.serverName)}`,
    `uri: ${yamlString(item.uri)}`,
    `title: ${yamlString(item.name || item.uri)}`,
    item.mimeType ? `mime_type: ${yamlString(item.mimeType)}` : "",
    "---",
  ].filter(Boolean).join("\n");

  const body = [
    `# ${item.name || item.uri}`,
    "",
    item.description ? `${item.description}\n` : "",
    "```",
    `uri: ${item.uri}`,
    "```",
    "",
    item.text,
  ].filter((l) => l !== "").join("\n");

  return { path, markdown: `${fm}\n\n${body.trim()}\n` };
}
