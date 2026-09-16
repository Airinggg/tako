import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadCadConfig } from "../shared/config.ts";
import { pruneStale } from "../shared/prune.ts";
import { collectCad } from "./collect.ts";
import { renderCad } from "./render.ts";

const config = await loadCadConfig();
const outputDir = join(config.sourceDir, config.subdir);

let written = 0;
const keepPaths: string[] = [];
for (const [system, { exportFile }] of Object.entries(config.systems)) {
  const docs = await collectCad(exportFile, system);
  for (const doc of docs) {
    const out = renderCad(doc);
    const target = join(outputDir, out.path);
    keepPaths.push(target);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, out.markdown);
    written += 1;
  }
  console.log(`  ${system}: ${docs.length} doc(s) from ${exportFile}`);
}

const pruned = await pruneStale(outputDir, "cad", keepPaths);
console.log(`wrote ${written} CAD doc(s) to ${outputDir}/cad/`);
if (pruned.length) console.log(`pruned ${pruned.length} file(s) no longer in an export:\n  ${pruned.join("\n  ")}`);
