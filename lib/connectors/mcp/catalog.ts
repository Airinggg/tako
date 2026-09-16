/**
 * MCP catalog — pull the public MCP ecosystem from API-first sources (no HTML
 * scraping) and classify each server as a **read-source** we can federate
 * read-only, an **action / app-driver** we deliberately don't wrap, or unknown.
 *
 * Sources: mcpvault.io/api/servers (rich category/topics/tools) and the
 * official registry.modelcontextprotocol.io (canonical connection URLs).
 */

export type CatalogServer = {
  name: string;
  slug: string;
  description: string;
  category: string;
  topics: string[];
  repoUrl: string;
  homepageUrl: string;
  stars: number;
  license: string;
  updated: string;
  klass: "read-source" | "action" | "unknown";
  reason: string;
  /** streamable-http URL from the official registry, if this server has one */
  connectUrl: string;
  localCommand?: string;
  reachable?: boolean;
  curated?: boolean;
  industrial?: IndustrialConnector;
};

export type IndustrialConnector = {
  id: string;
  label: string;
  domain: string;
  executionPattern: string;
  riskCeiling: "read" | "create-isolated" | "mutate" | "destructive" | "physical-control";
  proposedWave: string;
  evidence: string;
  note: string;
  localCommand?: string;
};

const catalogKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Merge the reviewed industrial register over discovery results. */
export function mergeIndustrialCatalog(scraped: readonly CatalogServer[], curated: readonly IndustrialConnector[]): CatalogServer[] {
  const byKey = new Map(scraped.map((server) => [catalogKey(server.slug || server.name), { ...server }]));
  for (const row of curated) {
    const key = catalogKey(row.id);
    const prior = byKey.get(key);
    const klass: CatalogServer["klass"] = row.riskCeiling === "read" ? "read-source" : "action";
    const merged: CatalogServer = {
      name: row.label,
      slug: row.id,
      description: row.note,
      category: row.domain,
      topics: [...new Set([...(prior?.topics ?? []), "industrial", row.domain])],
      repoUrl: row.evidence.startsWith("http") ? row.evidence : prior?.repoUrl ?? "",
      homepageUrl: prior?.homepageUrl ?? "",
      stars: prior?.stars ?? 0,
      license: prior?.license ?? "",
      updated: prior?.updated ?? "",
      klass,
      reason: `curated industrial policy: risk ceiling ${row.riskCeiling}`,
      connectUrl: prior?.connectUrl ?? "",
      localCommand: row.localCommand,
      reachable: Boolean(prior?.connectUrl || row.localCommand),
      curated: true,
      industrial: { ...row },
    };
    byKey.set(key, merged);
  }
  return [...byKey.values()].sort((a, b) => Number(Boolean(b.curated)) - Number(Boolean(a.curated)) || a.slug.localeCompare(b.slug));
}

const READ_CATS = /database|files|storage|search|web|knowledge|docs|analytics|monitoring|communication/i;
const ACTION_CATS = /automation|devops|deploy|browser|design|cad|3d|robot|payment|infrastructure|iac/i;
const READ_WORDS = /\b(read|search|query|fetch|retrieve|list|browse|docs?|documentation|knowledge|wiki|notes?|index|semantic)\b/i;
const ACTION_WORDS = /\b(control|drive|automate|execute|run\s|create|delete|deploy|send|post|write|render|build|generate|rpa|orchestrat)\b/i;

/** Classify from category / topics / tool names / description. */
export function classify(s: { category?: string; topics?: string[]; tools?: unknown[]; description?: string }): { klass: CatalogServer["klass"]; reason: string } {
  const cat = s.category ?? "";
  const topics = (s.topics ?? []).join(" ");
  const toolNames = (s.tools ?? []).map((t) => (typeof t === "string" ? t : (t as any)?.name ?? "")).join(" ").toLowerCase();
  const desc = s.description ?? "";
  const hay = `${topics} ${desc}`;

  const readHit = READ_CATS.test(cat) || READ_WORDS.test(hay) || /(search|list|get|read|query)_/.test(toolNames);
  const actionHit = ACTION_CATS.test(cat) || ACTION_WORDS.test(hay) || /(create|update|delete|run|deploy|send|write)_/.test(toolNames);

  if (readHit && !actionHit) return { klass: "read-source", reason: `category "${cat}", read-shaped` };
  if (actionHit && !readHit) return { klass: "action", reason: `category "${cat}", action/driver` };
  if (readHit && actionHit) return { klass: "read-source", reason: "mixed — has read surface, ingest read-only" };
  return { klass: "unknown", reason: `category "${cat}", unclear` };
}

async function getJson(url: string, timeoutMs = 15_000): Promise<any> {
  const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "tako-mcp-catalog" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

/** Official registry name → streamable-http URL. Paginated by cursor. */
export async function registryConnectUrls(maxPages = 20): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let cursor = "";
  for (let p = 0; p < maxPages; p++) {
    const j = await getJson(`https://registry.modelcontextprotocol.io/v0/servers?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    for (const row of j.servers ?? []) {
      const srv = row.server ?? row;
      const remote = (srv.remotes ?? []).find((r: any) => /streamable-http|sse/i.test(r.type ?? ""));
      if (srv.name && remote?.url && !out.has(srv.name)) out.set(srv.name, remote.url);
    }
    cursor = j.metadata?.nextCursor ?? "";
    if (!cursor) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  return out;
}

/** Fetch the mcpvault catalog, classify, attach connect URLs. */
export async function buildCatalog(opts: { maxServers?: number; withRegistry?: boolean } = {}): Promise<CatalogServer[]> {
  const cap = opts.maxServers ?? 400;
  const rows: any[] = [];
  for (let offset = 0; rows.length < cap; offset += 100) {
    const j = await getJson(`https://mcpvault.io/api/servers?limit=100&offset=${offset}`);
    const batch: any[] = j.servers ?? j.data ?? [];
    if (!batch.length) break;
    rows.push(...batch);
    await new Promise((r) => setTimeout(r, 200));
  }

  const connect = opts.withRegistry ? await registryConnectUrls().catch(() => new Map<string, string>()) : new Map<string, string>();
  const looseEntries = [...connect].map(([name, url]) => [name.toLowerCase().replace(/[^a-z0-9]/g, ""), url] as const);
  const matchUrl = (slug: string): string => {
    const key = slug.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key || key.length < 4) return "";
    const hit = looseEntries.find(([k]) => k === key || k.endsWith(key) || key.endsWith(k));
    return hit?.[1] ?? "";
  };

  // Keep entries that actually look like an MCP server (mcpvault indexes broadly).
  const isMcpish = (s: any) =>
    (s.topics ?? []).some((t: string) => /mcp|model.context.protocol/i.test(t)) ||
    /\bmcp\b/i.test(`${s.name} ${s.slug}`) ||
    (Array.isArray(s.tools) && s.tools.length > 0) ||
    connect.has(s.name ?? "") ||
    !!matchUrl(String(s.slug ?? s.name ?? ""));

  return rows.filter(isMcpish).slice(0, cap).map((s) => {
    const { klass, reason } = classify(s);
    return {
      name: s.name ?? s.slug ?? "",
      slug: s.slug ?? "",
      description: s.description ?? "",
      category: s.category ?? "",
      topics: s.topics ?? [],
      repoUrl: s.repoUrl ?? "",
      homepageUrl: s.homepageUrl ?? "",
      stars: Number(s.stars ?? 0),
      license: s.license ?? "",
      updated: s.lastUpdated ?? "",
      klass, reason,
      connectUrl: connect.get(s.name ?? "") ?? matchUrl(String(s.slug ?? s.name ?? "")),
    } satisfies CatalogServer;
  });
}
