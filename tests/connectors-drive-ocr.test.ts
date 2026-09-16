import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { collectDrive } from "../lib/connectors/drive/collect.ts";

const PNG = "image/png";

async function collectImage(body: Uint8Array, id = "ocr-image") {
  return collectDrive(async (path) => {
    if (path.startsWith("/files?q=")) {
      return new Response(JSON.stringify({ files: [
        { id, name: `${id}.png`, mimeType: PNG, modifiedTime: "2026-08-31T00:00:00Z" },
      ] }));
    }
    return new Response(body);
  }, { folderIds: ["folder-1"] });
}

async function withOcrSetting<T>(value: string, work: () => Promise<T>): Promise<T> {
  const previous = process.env.OCR_ENABLED;
  process.env.OCR_ENABLED = value;
  try {
    return await work();
  } finally {
    if (previous === undefined) delete process.env.OCR_ENABLED;
    else process.env.OCR_ENABLED = previous;
  }
}

test("Drive image OCR extracts known text locally", async () => {
  const fixture = await readFile(new URL("../lib/connectors/drive/__fixtures__/ocr-known.png", import.meta.url));
  const [file] = await withOcrSetting("1", () => collectImage(fixture));
  assert.match(file.text, /LOCAL OCR WORKS/);
});

test("OCR_ENABLED=0 leaves a Drive image empty", async () => {
  const fixture = await readFile(new URL("../lib/connectors/drive/__fixtures__/ocr-known.png", import.meta.url));
  const [file] = await withOcrSetting("0", () => collectImage(fixture, "disabled-image"));
  assert.equal(file.text, "");
});

test("a corrupt image buffer returns empty text instead of throwing", async () => {
  const corrupt = new TextEncoder().encode("not an image");
  const [file] = await withOcrSetting("1", () => collectImage(corrupt, "corrupt-image"));
  assert.equal(file.text, "");
});
