import { McpClient, type Transport } from "./client.ts";
import { GovernedMcpClient, type BlockedMcpItem, type McpAuditLine, type McpGovernance } from "./govern.ts";

/** One federated item pulled from an MCP server. */
export type McpItem = {
  server: string;      // config key, e.g. "confluence"
  serverName: string;  // what the server reported in initialize
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  text: string;        // resource text; base64 blobs are skipped with a note
};

export type McpCollection = { items: McpItem[]; audit: McpAuditLine[]; blocked: BlockedMcpItem[] };

const TEXTUAL = /^(text\/|application\/(json|xml|x-yaml|yaml|markdown|x-ndjson))/i;

/**
 * Connect to one MCP server, list every resource, read each, and return the
 * textual ones. Read-only: `initialize` + `resources/list` + `resources/read`.
 */
export async function collectMcp(
  server: string, transport: Transport, opts: { maxResources?: number; governance: McpGovernance },
): Promise<McpCollection> {
  const client = new GovernedMcpClient(new McpClient(transport), opts.governance);
  const info = await client.initialize();
  const resources = await client.listResources(opts.maxResources ?? 5_000);

  const items: McpItem[] = [];
  const audit: McpAuditLine[] = [];
  const blocked: BlockedMcpItem[] = [];
  for (const r of resources) {
    const read = await client.readResource(r.uri);
    audit.push(read.audit);
    if (read.blocked) { blocked.push(read.blocked); continue; }
    if (read.error) continue; // an upstream failure is audited and skipped, not fatal
    const contents = read.contents;
    const parts: string[] = [];
    for (const c of contents) {
      if (typeof c.text === "string" && c.text.length) parts.push(c.text);
      else if (c.blob) parts.push(`_(binary ${c.mimeType ?? "blob"} — not ingested)_`);
    }
    const text = parts.join("\n\n").trim();
    if (!text) continue;
    const mimeType = r.mimeType ?? contents.find((c) => c.mimeType)?.mimeType ?? "text/plain";
    if (r.mimeType && !TEXTUAL.test(r.mimeType) && !contents.some((c) => c.text)) continue;
    items.push({
      server,
      serverName: info.name,
      uri: r.uri,
      name: r.name || r.uri,
      description: r.description ?? "",
      mimeType,
      text,
    });
  }
  return { items: items.sort((a, b) => a.uri.localeCompare(b.uri)), audit, blocked };
}
