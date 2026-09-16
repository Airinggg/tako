import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadDriveConfig } from "../shared/config.ts";
import { pruneStale } from "../shared/prune.ts";
import { DriveClient } from "./client.ts";
import { collectDrive, type DriveFile } from "./collect.ts";
import { renderDrive } from "./render.ts";

const full = process.argv.includes("--full");
const config = await loadDriveConfig();
const outputDir = join(config.sourceDir, config.subdir);
const cursorPath = join(outputDir, ".drive-cursor.json");

let cursor: string | undefined;
try { cursor = JSON.parse(await readFile(cursorPath, "utf8")).modifiedTime; } catch { /* first run */ }

const client = new DriveClient(config.token);

// Write each file the moment its content is ready — PDF/DOCX extraction is slow
// and a batch may be interrupted; partial progress then survives.
let writtenCount = 0;
const persist = async (file: DriveFile) => {
  if (file.skipped) return;
  const output = renderDrive(file);
  const target = join(outputDir, output.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, output.markdown);
  writtenCount += 1;
};

const files = await collectDrive(client.request.bind(client), config, full ? undefined : cursor, persist);

// Every current file maps to one path; that set drives pruning (skipped included).
const keepPaths = files.map((file) => join(outputDir, renderDrive(file).path));
const pruned = await pruneStale(outputDir, "drive", keepPaths);

const newest = files.map((file) => file.modifiedTime).filter(Boolean).sort().at(-1) ?? cursor;
if (newest) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(cursorPath, `${JSON.stringify({ modifiedTime: newest }, null, 2)}\n`);
}

console.log(`wrote ${writtenCount} Drive file(s) to ${outputDir}/drive/ (${files.length} in folder(s))`);
if (pruned.length) console.log(`pruned ${pruned.length} file(s) no longer in Drive:\n  ${pruned.join("\n  ")}`);
