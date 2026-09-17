import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { collectDrive } from "../lib/connectors/drive/collect.ts";
import { renderDrive } from "../lib/connectors/drive/render.ts";

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const FOLDER_LISTING = {
  files: [
    { id: "doc-1", name: "Plan", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-08-28T00:00:00Z" },
    { id: "slides-1", name: "Deck", mimeType: "application/vnd.google-apps.presentation", modifiedTime: "2026-08-28T00:00:00Z" },
    { id: "md-1", name: "notes.md", mimeType: "text/markdown", modifiedTime: "2026-08-28T00:00:00Z" },
    { id: "pdf-1", name: "Report.pdf", mimeType: "application/pdf", modifiedTime: "2026-08-29T00:00:00Z" },
    { id: "docx-1", name: "Memo.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", modifiedTime: "2026-08-29T00:00:00Z" },
    { id: "sheet-1", name: "Budget", mimeType: "application/vnd.google-apps.spreadsheet", modifiedTime: "2026-08-29T00:00:00Z" },
  ],
};

function makeRequest(calls: string[]) {
  return async (path: string) => {
    calls.push(path);
    if (path.startsWith("/files?q=")) return new Response(JSON.stringify(FOLDER_LISTING));
    if (path.includes("export?mimeType=")) return new Response(`exported ${path.match(/files\/([^/?]+)/)?.[1]}`);
    // raw media: text for md; the PDF/DOCX branches import unpdf/mammoth and are
    // covered by the live run, so this test uses only text-extractable types.
    return new Response("raw markdown body");
  };
}

test("routes Google types to export and text types to media; skips Sheets", async () => {
  const calls: string[] = [];
  const files = await collectDrive(makeRequest(calls), { folderIds: ["folder-1"] });
  // PDF + DOCX are now recognised (they reach extractContent); Sheets is not.
  assert.deepEqual(files.map((f) => f.id).sort(), ["doc-1", "docx-1", "md-1", "pdf-1", "slides-1"]);
  assert.match(renderDrive(files.find((f) => f.id === "doc-1")!).markdown, /exported doc-1/);
  assert.match(renderDrive(files.find((f) => f.id === "slides-1")!).markdown, /exported slides-1/);
  assert.match(renderDrive(files.find((f) => f.id === "md-1")!).markdown, /raw markdown body/);
});

test("incremental cursor skips files at or before `since` without fetching content", async () => {
  const calls: string[] = [];
  // Only the 2026-08-29 files (pdf-1, docx-1) are newer than this cursor.
  const files = await collectDrive(makeRequest(calls), { folderIds: ["folder-1"] }, { "folder-1": "2026-08-28T12:00:00Z" });

  const skipped = files.filter((f) => f.skipped).map((f) => f.id).sort();
  assert.deepEqual(skipped, ["doc-1", "md-1", "slides-1"]);
  // No content call was made for the skipped ids.
  assert.ok(!calls.some((c) => c.includes("doc-1") || c.includes("slides-1") || c.includes("md-1")));
  // Newer files were still processed (a content fetch happened for them).
  assert.ok(calls.some((c) => c.includes("pdf-1")) && calls.some((c) => c.includes("docx-1")));
});

test("a folder added after earlier syncs is fully ingested even though its files are older than another folder's cursor (regression for #10)", async () => {
  const listings: Record<string, any> = {
    "folder-old": { files: [{ id: "old-1", name: "Recent", mimeType: "text/markdown", modifiedTime: "2026-09-10T00:00:00Z" }] },
    "folder-new": { files: [{ id: "new-1", name: "Older but never synced", mimeType: "text/markdown", modifiedTime: "2026-01-01T00:00:00Z" }] },
  };
  const calls: string[] = [];
  const request = async (path: string) => {
    calls.push(path);
    if (path.startsWith("/files?q=")) {
      const folder = path.includes("folder-old") ? "folder-old" : "folder-new";
      return new Response(JSON.stringify(listings[folder]));
    }
    return new Response("raw markdown body");
  };

  // folder-old's cursor (from many prior syncs) is far newer than folder-new's
  // only file's modifiedTime -- folder-new was only just added to the config.
  const sinceByFolder = { "folder-old": "2026-09-01T00:00:00Z" };
  const files = await collectDrive(request, { folderIds: ["folder-old", "folder-new"] }, sinceByFolder);

  const newFile = files.find((f) => f.id === "new-1");
  assert.ok(newFile, "the newly-added folder's file must be returned at all");
  assert.equal(newFile!.skipped, undefined, "must not be skipped -- it has never been synced before");
  assert.ok(calls.some((c) => c.includes("new-1")), "content must actually be fetched for it");
});

test("accepts a folders/<id> fragment or full Drive URL as folderId", async () => {
  const calls: string[] = [];
  await collectDrive(makeRequest(calls), { folderIds: ["https://drive.google.com/drive/folders/abc123?usp=sharing"] });
  assert.ok(calls[0].includes("abc123") && !calls[0].includes("folders%2Fabc123"));
});

async function collectPptx(body: Uint8Array, id = "pptx-1") {
  return collectDrive(async (path) => {
    if (path.startsWith("/files?q=")) {
      return new Response(JSON.stringify({ files: [
        { id, name: "Lean canvas.pptx", mimeType: PPTX, modifiedTime: "2026-08-30T00:00:00Z" },
      ] }));
    }
    return new Response(body);
  }, { folderIds: ["folder-1"] });
}

test("extracts PPTX slide text with numeric ordering and headers", async () => {
  const fixture = await readFile(new URL("../lib/connectors/drive/fixtures/two-slides.pptx", import.meta.url));
  const [file] = await collectPptx(fixture);

  assert.equal(file.text, [
    "## Slide 1",
    "",
    "Lean Canvas 顧客課題 と解決策",
    "",
    "## Slide 2",
    "",
    "Revenue & Costs Second slide",
  ].join("\n"));
});

test("a corrupt PPTX yields empty text instead of throwing", async () => {
  const [file] = await collectPptx(new TextEncoder().encode("not a zip"), "corrupt-pptx");
  assert.equal(file.text, "");
});
