import type { DriveConnectorConfig } from "../shared/config.ts";
import { ocrImage, ocrPdfIfEmpty } from "../shared/ocr.ts";

export type DriveFile = {
  id: string; name: string; mimeType: string; modifiedTime: string;
  webViewLink?: string; text: string;
  /** true when skipped by the incremental cursor — metadata only, no content fetch. */
  skipped?: boolean;
};
type Request = (path: string) => Promise<Response>;

// Google-native types that `files/{id}/export?mimeType=text/plain` handles.
const googleExportable = new Set([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.presentation",
]);
const rawText = new Set(["text/plain", "text/markdown"]);
const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const IMAGES = new Set(["image/png", "image/jpeg", "image/webp", "image/tiff"]);

function isSupported(mimeType: string): boolean {
  return googleExportable.has(mimeType) || rawText.has(mimeType)
    || mimeType === PDF || mimeType === DOCX || mimeType === PPTX || IMAGES.has(mimeType);
}

/** Binary document extraction on a large or CID-font-heavy file can take minutes. Bound it. */
const EXTRACT_TIMEOUT_MS = Number(process.env.DRIVE_EXTRACT_TIMEOUT_MS) || 45_000;
function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${EXTRACT_TIMEOUT_MS}ms`)), EXTRACT_TIMEOUT_MS).unref?.()),
  ]);
}

async function extractContent(request: Request, file: { id: string; mimeType: string }): Promise<string> {
  const id = encodeURIComponent(file.id);
  if (googleExportable.has(file.mimeType)) {
    return (await request(`/files/${id}/export?mimeType=text%2Fplain`)).text();
  }
  if (rawText.has(file.mimeType)) {
    return (await request(`/files/${id}?alt=media`)).text();
  }
  if (file.mimeType === PDF) {
    try {
      const buffer = await (await request(`/files/${id}?alt=media`)).arrayBuffer();
      const text = await withTimeout((async () => {
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(new Uint8Array(buffer));
        try {
          const extracted = await extractText(pdf, { mergePages: true });
          return extracted.text;
        } finally {
          await pdf.destroy();
        }
      })(), "pdf");
      return await ocrPdfIfEmpty(buffer, text, { withTimeout });
    } catch (error) {
      console.warn(`drive: skipped PDF text for "${file.id}": ${(error as Error).message}`);
      return "";
    }
  }
  if (file.mimeType === DOCX) {
    try {
      const buffer = await (await request(`/files/${id}?alt=media`)).arrayBuffer();
      return await withTimeout((async () => {
        const mammoth = (await import("mammoth")).default;
        const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
        return value;
      })(), "docx");
    } catch (error) {
      console.warn(`drive: skipped DOCX text for "${file.id}": ${(error as Error).message}`);
      return "";
    }
  }
  if (file.mimeType === PPTX) {
    try {
      const buffer = await (await request(`/files/${id}?alt=media`)).arrayBuffer();
      return await withTimeout((async () => {
        const [{ strFromU8, unzipSync }, { XMLParser }] = await Promise.all([
          import("fflate"),
          import("fast-xml-parser"),
        ]);
        const archive = unzipSync(new Uint8Array(buffer));
        const slides = Object.entries(archive)
          .flatMap(([path, contents]) => {
            const match = path.match(/^ppt\/slides\/slide(\d+)\.xml$/i);
            return match ? [{ number: Number(match[1]), contents }] : [];
          })
          .sort((a, b) => a.number - b.number);
        const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, trimValues: false });

        function textValue(value: unknown): string {
          if (typeof value === "string" || typeof value === "number") return String(value);
          if (Array.isArray(value)) return value.map(textValue).join("");
          if (!value || typeof value !== "object") return "";
          return Object.entries(value as Record<string, unknown>)
            .filter(([key]) => key !== ":@")
            .map(([, child]) => textValue(child))
            .join("");
        }

        function textRuns(value: unknown, out: string[]): void {
          if (Array.isArray(value)) {
            for (const item of value) textRuns(item, out);
            return;
          }
          if (!value || typeof value !== "object") return;
          for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            if (key === "a:t") {
              const text = textValue(child);
              if (text.trim()) out.push(text.trim());
            } else {
              textRuns(child, out);
            }
          }
        }

        return slides.map((slide) => {
          const runs: string[] = [];
          textRuns(parser.parse(strFromU8(slide.contents)), runs);
          return `## Slide ${slide.number}${runs.length ? `\n\n${runs.join(" ")}` : ""}`;
        }).join("\n\n");
      })(), "pptx");
    } catch (error) {
      console.warn(`drive: skipped PPTX text for "${file.id}": ${(error as Error).message}`);
      return "";
    }
  }
  if (IMAGES.has(file.mimeType)) {
    try {
      const buffer = await (await request(`/files/${id}?alt=media`)).arrayBuffer();
      return await ocrImage(buffer, { withTimeout });
    } catch (error) {
      console.warn(`drive: skipped image OCR for "${file.id}": ${(error as Error).message}`);
      return "";
    }
  }
  return "";
}

/**
 * List and extract text from files directly in each configured folder.
 * `since` (ISO modifiedTime) skips content extraction for unchanged files; those
 * are still returned (skipped:true) so pruning keeps their existing Markdown.
 */
export async function collectDrive(
  request: Request,
  config: Pick<DriveConnectorConfig, "folderIds">,
  since?: string,
  /** fired as soon as each file's content is ready, so callers can persist
   * incrementally (PDF batches are slow and may be interrupted). */
  onFile?: (file: DriveFile) => void | Promise<void>,
): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  for (const rawFolderId of config.folderIds) {
    // Accept a bare id, a "folders/<id>" fragment, or a full Drive URL.
    const folderId = rawFolderId
      .replace(/^https?:\/\/[^/]+\/(?:drive\/)?(?:u\/\d+\/)?folders\//, "")
      .replace(/^folders\//, "")
      .split(/[?&#]/)[0];
    const query = encodeURIComponent(`'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`);
    const fields = encodeURIComponent("files(id,name,mimeType,modifiedTime,webViewLink),nextPageToken");
    for (let token = "";;) {
      const page = await (await request(`/files?q=${query}&fields=${fields}&pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`)).json() as any;
      for (const file of page.files ?? []) {
        if (!isSupported(file.mimeType)) continue;
        if (since && file.modifiedTime && file.modifiedTime <= since) {
          out.push({ ...file, text: "", skipped: true });
          continue;
        }
        const record: DriveFile = { ...file, text: await extractContent(request, file) };
        out.push(record);
        await onFile?.(record);
      }
      if (!page.nextPageToken) break;
      token = page.nextPageToken;
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
