/**
 * Read-only brain/scope/member data for the department console and the demo app.
 * Extracted from scripts/console.ts so both surfaces share one implementation.
 * Nothing here mutates the brain — invite/revoke stay in scripts/console.ts.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { gbrainHome } from "../eval/qa.ts";
import { grantsForScope, parseSkillFrontmatter, type SkillFrontmatter } from "../scopes/grants.ts";
import { buildTree, excluded, included, type Scope } from "../scopes/model.ts";

const REPO = join(import.meta.dir, "..", "..");
const BRAIN_CLI = join(REPO, "packages/brain/src/cli.ts");
export const GBRAIN_HOME = gbrainHome();
const SCOPES_PATH = join(REPO, "config/scopes.json");
const BRAIN_SOURCES = join(REPO, "brain-sources");

const CACHE_TTL_MS = Number(process.env.CONSOLE_CACHE_MS) || 8_000;
const cache = new Map<string, { at: number; out: string }>();

/** Clear the read cache (call after a mutation elsewhere). */
export function clearConsoleCache(): void {
  cache.clear();
}

export function gb(args: string[], opts: { cache?: boolean } = {}): string {
  const key = JSON.stringify(args);
  if (opts.cache) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.out;
  }
  const result = spawnSync("bun", [BRAIN_CLI, ...args], {
    cwd: join(REPO, "packages/brain"),
    // GBRAIN_SKIP_STARTUP_HOOKS: stop the detached check-update child that
    // otherwise keeps spawnSync blocked on inherited pipes past command exit.
    env: { ...process.env, GBRAIN_HOME, GBRAIN_DISABLE_UPGRADE_CHECK: "1", GBRAIN_SKIP_STARTUP_HOOKS: "1" },
    encoding: "utf8",
    timeout: 60_000,
  });
  if (result.status !== 0) throw new Error(`gbrain ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  const out = result.stdout
    .split(/\r?\n/)
    .filter((l) => !/^UPGRADE_AVAILABLE\b/.test(l) && !/^gbrain \d[\d.]* -> .*available\. Run:/.test(l))
    .join("\n")
    .trim();
  if (opts.cache) cache.set(key, { at: Date.now(), out });
  return out;
}

export function gbJson<T>(args: string[]): T {
  const out = gb(args, { cache: true });
  const start = out.search(/[\[{]/);
  return JSON.parse(start >= 0 ? out.slice(start) : out) as T;
}

export type SourceStatus = {
  source_id: string; name: string; local_path: string | null; federated: boolean;
  total_pages: number; embed_coverage_pct: number; last_sync_at: string | null;
  lag_seconds: number | null; sync_running: boolean;
};
export type Client = {
  client_id: string; client_name: string; scopes: string;
  source_id: string; federated_read: string[];
};
export type PageEntry = { slug: string; source: string };

export function readScopes(): Scope[] {
  try {
    const value = JSON.parse(readFileSync(SCOPES_PATH, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

/** Page slugs from `gbrain list --source X` (TSV: slug\ttype\tdate\ttitle). */
export function sourceEntries(sourceId: string): PageEntry[] {
  return gb(["list", "--source", sourceId], { cache: true }).split("\n").flatMap((line) => {
    const slug = line.split("\t")[0]?.trim();
    return slug?.includes("/") ? [{ slug, source: sourceId }] : [];
  });
}

function walkFiles(directory: string, files: string[] = []): string[] {
  if (!existsSync(directory)) return files;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(path, files);
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function loadSkillInventory(): { skills: SkillFrontmatter[]; rules: string[] } {
  const skills: SkillFrontmatter[] = [];
  const rules: string[] = [];
  if (!existsSync(BRAIN_SOURCES)) return { skills, rules };
  for (const sourceEntry of readdirSync(BRAIN_SOURCES, { withFileTypes: true })) {
    if (!sourceEntry.isDirectory()) continue;
    const source = sourceEntry.name;
    for (const file of walkFiles(join(BRAIN_SOURCES, source, "skills"))) {
      if (basename(file) === "SKILL.md") {
        const parsed = parseSkillFrontmatter(readFileSync(file, "utf8"), source);
        if (parsed) skills.push(parsed);
      } else if (/^_.*-rules\.md$/.test(basename(file))) {
        rules.push(file);
      }
    }
  }
  return { skills, rules };
}

function matchesScope(slug: string, scope: Scope): boolean {
  return scope.includePrefixes.some((prefix) => slug.startsWith(prefix));
}

function realisedAccess(scope: Scope, sources: readonly SourceStatus[], entries: readonly PageEntry[]) {
  const bySource = new Map<string, PageEntry[]>();
  for (const entry of entries) {
    const group = bySource.get(entry.source) ?? [];
    group.push(entry);
    bySource.set(entry.source, group);
  }

  const readable = new Set<string>();
  const partial = new Set<string>();
  for (const [source, pages] of bySource) {
    const selected = pages.filter((page) => matchesScope(page.slug, scope));
    if (!selected.length) continue;
    if (selected.length === pages.length) readable.add(source);
    else partial.add(source);
  }

  const namedPages = bySource.get(scope.name) ?? [];
  const namedSourceIsContained = namedPages.length > 0 && namedPages.every((page) => matchesScope(page.slug, scope));
  const hasAnySelection = entries.some((entry) => matchesScope(entry.slug, scope));
  const unresolved = !hasAnySelection || (partial.size > 0 && !namedSourceIsContained);
  const realisedSources = [...readable].sort();
  const primarySource = realisedSources.includes(scope.name) ? scope.name : realisedSources[0] ?? "";
  const missingSources = realisedSources.filter((id) => !sources.some((source) => source.source_id === id));
  return { realisedSources, primarySource, unresolved: unresolved || missingSources.length > 0 };
}

function syncView(sourceIds: readonly string[], sources: readonly SourceStatus[], unresolved: boolean) {
  const status = sourceIds.flatMap((id) => sources.filter((source) => source.source_id === id));
  if (unresolved || !status.length) return { syncStatus: "realisation needed", syncTone: "warn", lastSync: null };
  if (status.some((source) => source.sync_running)) return { syncStatus: `${status.length} source${status.length === 1 ? "" : "s"} syncing`, syncTone: "warn", lastSync: null };
  const embedPct = Math.min(...status.map((source) => source.embed_coverage_pct));
  const dates = status.map((source) => source.last_sync_at).filter((date): date is string => Boolean(date)).sort();
  const lastSync = dates[0] ?? null;
  if (embedPct < 100) return { syncStatus: `embed ${embedPct}%`, syncTone: "warn", lastSync };
  if (status.every((source) => source.last_sync_at)) return { syncStatus: "up to date", syncTone: "ok", lastSync };
  return { syncStatus: "never synced", syncTone: "warn", lastSync };
}

export function sourceCards(sources: readonly SourceStatus[], clients: readonly Client[], entries: readonly PageEntry[]) {
  return sources.map((source) => {
    let docs = 0, skills = 0, rules = 0;
    for (const entry of entries.filter((page) => page.source === source.source_id)) {
      if (/^skills\/_/.test(entry.slug)) rules++;
      else if (/^skills\/.+\/skill$/.test(entry.slug)) skills++;
      else docs++;
    }
    return {
      kind: "source", id: source.source_id, name: source.name, purpose: "",
      docs, skills, rules,
      members: clients.filter((client) => client.source_id === source.source_id || client.federated_read.includes(source.source_id)).length,
      included: [] as Array<{ prefix: string; pages: number }>, excluded: [] as Array<{ prefix: string; pages: number }>, warnings: [] as string[],
      primarySource: source.source_id, readSources: [source.source_id], shareable: true,
      syncStatus: source.sync_running ? "syncing" : source.embed_coverage_pct < 100 ? `embed ${source.embed_coverage_pct}%` : source.last_sync_at ? "up to date" : "never synced",
      syncTone: source.sync_running || source.embed_coverage_pct < 100 || !source.last_sync_at ? "warn" : "ok",
      lastSync: source.last_sync_at,
      skillNames: [] as string[],
    };
  });
}

export type DashboardCard = ReturnType<typeof sourceCards>[number] & {
  purpose: string; skillNames: string[];
  included: Array<{ prefix: string; pages: number }>;
  excluded: Array<{ prefix: string; pages: number }>;
  warnings: string[];
};
export type Dashboard = { mode: "sources" | "scopes"; banner: string; brains: DashboardCard[] };

export function loadDashboard(): Dashboard {
  const sources = gbJson<{ sources: SourceStatus[] }>(["sources", "status", "--json"]).sources
    .filter((source) => source.source_id !== "default");
  const clients = gbJson<{ clients: Client[] }>(["auth", "clients", "--json"]).clients;
  const entries = sources.flatMap((source) => sourceEntries(source.source_id));
  const scopes = readScopes();
  if (!scopes.length) {
    return { mode: "sources", banner: "No scopes yet — run `npm run scope:build`", brains: sourceCards(sources, clients, entries) as DashboardCard[] };
  }

  const tree = buildTree(entries);
  const inventory = loadSkillInventory();
  const brains = scopes.map((scope): DashboardCard => {
    const inside = included(tree, scope.includePrefixes);
    const outside = excluded(tree, scope.includePrefixes);
    const access = realisedAccess(scope, sources, entries);
    const grants = grantsForScope({ ...scope, realisedSources: access.realisedSources }, inventory.skills, inventory.rules);
    const sync = syncView(access.realisedSources, sources, access.unresolved);
    const members = clients.filter((client) => {
      const readable = new Set(client.federated_read);
      return access.realisedSources.length > 0 && access.realisedSources.every((source) => readable.has(source));
    });
    return {
      kind: "scope", id: scope.name, name: scope.name, purpose: scope.purpose,
      docs: inside.reduce((sum, node) => sum + node.pageCount, 0),
      skills: grants.skills.length, skillNames: grants.skills,
      rules: grants.rules.length, members: members.length,
      included: inside.map((node) => ({ prefix: node.prefix, pages: node.pageCount })),
      excluded: outside.nodes.map((node) => ({ prefix: node.prefix, pages: node.pageCount })),
      warnings: outside.sharedSourceWarning,
      primarySource: access.primarySource, readSources: access.realisedSources,
      shareable: !access.unresolved && Boolean(access.primarySource),
      ...sync,
    } as DashboardCard;
  });
  return { mode: "scopes", banner: "", brains };
}

export type Member = { id: string; name: string; scopes: string; write: string; read: string[] };

export function loadMembers(): Member[] {
  return gbJson<{ clients: Client[] }>(["auth", "clients", "--json"]).clients.map((client) => ({
    id: client.client_id, name: client.client_name, scopes: client.scopes,
    write: client.source_id, read: client.federated_read,
  }));
}
