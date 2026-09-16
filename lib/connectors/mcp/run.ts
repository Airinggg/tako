import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { loadMcpConfig } from "../shared/config.ts";
import { pruneStale } from "../shared/prune.ts";
import { collectMcp } from "./collect.ts";
import { renderMcp } from "./render.ts";
import { httpTransport, stdioTransport, type Transport } from "./client.ts";
import { validateManifest, type ConnectorManifest } from "../../govern/manifest.ts";
import type { ToolPolicy } from "../../govern/policy.ts";

const config = await loadMcpConfig();
const outputDir = join(config.sourceDir, config.subdir);

let written = 0;
const keepPaths: string[] = [];
const auditLines: string[] = [];

for (const [name, entry] of Object.entries(config.servers)) {
  let transport: Transport | undefined;
  let close: (() => void) | undefined;
  try {
    const manifestPath = isAbsolute(entry.manifest) ? entry.manifest : join(process.cwd(), entry.manifest);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ConnectorManifest;
    const validation = validateManifest(manifest);
    if (!validation.ok) throw new Error(`manifest rejected: ${validation.errors.join("; ")}`);
    const declared = manifest.tools.find((tool) => tool.name === "resources_read" || tool.name === "resources/read");
    if (!declared || declared.risk !== "read") throw new Error('manifest needs a read tool named "resources_read"');
    if (entry.url) {
      transport = httpTransport(entry.url, entry.headers ?? {});
    } else {
      const t = stdioTransport(entry.command!, entry.args ?? [], entry.env ?? {});
      transport = t; close = t.close;
    }
    const source = entry.source ?? config.subdir;
    const tool = { ...declared, source } as ToolPolicy;
    const result = await collectMcp(name, transport, {
      governance: {
        connector: `${manifest.id}@${manifest.version}`,
        tool,
        scope: { name: config.subdir, readSources: entry.readSources ?? [source] },
        dataClass: entry.dataClass ?? "internal",
        env: entry.environment ?? "dev",
      },
    });
    const { items } = result;
    auditLines.push(...result.audit.map((line) => JSON.stringify(line)));
    for (const item of items) {
      const out = renderMcp(item);
      const target = join(outputDir, out.path);
      keepPaths.push(target);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, out.markdown);
      written += 1;
    }
    console.log(`  ${name}: ${items.length} resource(s), ${result.blocked.length} blocked`);
  } catch (err) {
    console.warn(`  ${name}: ${(err as Error).message}`);
  } finally {
    close?.();
  }
}

const auditPath = join(outputDir, "mcp", "_audit.jsonl");
await mkdir(dirname(auditPath), { recursive: true });
if (auditLines.length) await appendFile(auditPath, `${auditLines.join("\n")}\n`, "utf8");

const pruned = await pruneStale(outputDir, "mcp", keepPaths);
console.log(`wrote ${written} MCP resource(s) to ${outputDir}/mcp/`);
if (pruned.length) console.log(`pruned ${pruned.length} file(s) no longer served:\n  ${pruned.join("\n  ")}`);
