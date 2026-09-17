import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadDriveConfig } from "../shared/config.ts";
import { pruneStale } from "../shared/prune.ts";
import { DriveClient } from "./client.ts";
import { collectDrive, normalizeFolderId, type DriveFile } from "./collect.ts";
import { renderDrive } from "./render.ts";

const full = process.argv.includes("--full");
const config = await loadDriveConfig();
const outputDir = join(config.sourceDir, config.subdir);
const cursorPath = join(outputDir, ".drive-cursor.json");

// Cursor is keyed per folder ID, not one global modifiedTime -- a folder
// added after earlier syncs must have no entry here, so collectDrive()
// treats it as a first (full) sync for itself rather than skipping its
// files as "already synced" against another folder's cursor.
let cursorByFolder: Record<string, string> = {};
try {
  const raw = JSON.parse(await readFile(cursorPath, "utf8"));
  // One-time migration from the old single-cursor format ({modifiedTime}):
  // apply it to every currently configured folder, since those are the
  // folders it could plausibly have covered. Any folder added later still
  // correctly gets no entry and syncs fully.
  if (typeof raw.modifiedTime === "string") {
    for (const rawFolderId of config.folderIds) cursorByFolder[normalizeFolderId(rawFolderId)] = raw.modifiedTime;
  } else {
    cursorByFolder = raw;
  }
} catch { /* first run */ }

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

const files = await collectDrive(client.request.bind(client), config, full ? undefined : cursorByFolder, persist);

// Every current file maps to one path; that set drives pruning (skipped included).
const keepPaths = files.map((file) => join(outputDir, renderDrive(file).path));
const pruned = await pruneStale(outputDir, "drive", keepPaths);

const nextCursorByFolder = full ? {} : { ...cursorByFolder };
for (const file of files) {
  if (!file.modifiedTime) continue;
  if (!nextCursorByFolder[file.folderId] || file.modifiedTime > nextCursorByFolder[file.folderId]) {
    nextCursorByFolder[file.folderId] = file.modifiedTime;
  }
}
if (Object.keys(nextCursorByFolder).length) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(cursorPath, `${JSON.stringify(nextCursorByFolder, null, 2)}\n`);
}

console.log(`wrote ${writtenCount} Drive file(s) to ${outputDir}/drive/ (${files.length} in folder(s))`);
if (pruned.length) console.log(`pruned ${pruned.length} file(s) no longer in Drive:\n  ${pruned.join("\n  ")}`);
