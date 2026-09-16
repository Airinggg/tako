/**
 *   npm run mcp:catalog                 # ~400 servers, classified
 *   npm run mcp:catalog -- --all --registry   # deeper + attach connect URLs
 *
 * Pulls the public MCP ecosystem from API-first sources (mcpvault + the official
 * registry — no HTML scraping), classifies each server as a read-source we can
 * federate read-only vs an action/driver we don't, and writes
 * config/mcp-catalog.json. Nothing is auto-connected; you pick from the list.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCatalog, mergeIndustrialCatalog, type IndustrialConnector } from "../lib/connectors/mcp/catalog.ts";

const args = new Set(process.argv.slice(2));
const scraped = await buildCatalog({
  maxServers: args.has("--all") ? 2_000 : 400,
  withRegistry: args.has("--registry") || args.has("--all"),
}).catch((error) => {
  console.warn(`public MCP discovery unavailable; writing curated register only: ${(error as Error).message}`);
  return [];
});
const curated = JSON.parse(readFileSync(join(import.meta.dir, "..", "config/industrial-connectors.json"), "utf8")) as IndustrialConnector[];
const catalog = mergeIndustrialCatalog(scraped, curated);

const by = { "read-source": 0, action: 0, unknown: 0 } as Record<string, number>;
for (const s of catalog) by[s.klass]++;

const out = {
  fetchedAt: new Date().toISOString(),
  industrialCount: curated.length,
  reachableIndustrial: catalog.filter((row) => row.curated && row.reachable).length,
  total: catalog.length,
  byClass: by,
  servers: catalog.sort((a, b) => (a.klass === b.klass ? b.stars - a.stars : a.klass.localeCompare(b.klass))),
};
writeFileSync(join(import.meta.dir, "..", "config/mcp-catalog.json"), JSON.stringify(out, null, 2) + "\n");

console.log(`\n${catalog.length} servers · read-source ${by["read-source"]} · action ${by.action} · unknown ${by.unknown}`);
console.log(`wrote config/mcp-catalog.json\n`);
console.log("top read-sources (drop into config.mcp.servers):");
for (const s of catalog.filter((s) => s.klass === "read-source").sort((a, b) => b.stars - a.stars).slice(0, 15)) {
  console.log(`  ${s.name.padEnd(28)} ${s.category.padEnd(14)} ${s.connectUrl || s.repoUrl}`);
}
