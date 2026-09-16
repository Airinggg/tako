import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

export type OcrBuffer = ArrayBuffer | Uint8Array;
export type TimeoutWrapper = <T>(work: Promise<T>, label: string) => Promise<T>;

export type OcrOptions = {
  enabled?: boolean;
  lang?: string;
  langPath?: string;
  gzip?: boolean;
  minTextChars?: number;
  withTimeout?: TimeoutWrapper;
};

function enabled(opts: OcrOptions): boolean {
  return opts.enabled ?? process.env.OCR_ENABLED !== "0";
}

function language(opts: OcrOptions): { lang: string; langPath: string; gzip: boolean } {
  const lang = opts.lang ?? process.env.OCR_LANG ?? "eng";
  const configured = opts.langPath ?? process.env.OCR_LANG_PATH;
  if (configured && /^[a-z][a-z0-9+.-]*:/i.test(configured) && !/^[a-z]:[\\/]/i.test(configured)) {
    throw new Error("OCR_LANG_PATH must be a local filesystem path");
  }
  if (configured) {
    return {
      lang,
      langPath: resolve(configured),
      gzip: opts.gzip ?? process.env.OCR_LANG_GZIP !== "0",
    };
  }
  if (lang !== "eng") throw new Error(`no local traineddata configured for OCR language "${lang}"`);

  // The official language package is installed with the app. Resolving its
  // file guarantees Tesseract never falls back to its jsDelivr default.
  const require = createRequire(import.meta.url);
  const trainedData = require.resolve("@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz");
  return { lang, langPath: dirname(trainedData), gzip: true };
}

function bytes(buffer: OcrBuffer): Uint8Array {
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

async function recognize(images: readonly Uint8Array[], opts: OcrOptions): Promise<string> {
  if (!images.length) return "";
  const { lang, langPath, gzip } = language(opts);
  const { createWorker, OEM } = await import("tesseract.js");
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    worker = await createWorker(lang, OEM.LSTM_ONLY, {
      langPath,
      gzip,
      cacheMethod: "none",
      logger: () => {},
      // Tesseract otherwise throws worker job failures on its message handler
      // in addition to rejecting recognize(), escaping our failure fallback.
      errorHandler: () => {},
    });
    const text: string[] = [];
    for (const image of images) {
      const result = await worker.recognize(image);
      if (result.data.text.trim()) text.push(result.data.text.trim());
    }
    return text.join("\n\n");
  } finally {
    await worker?.terminate();
  }
}

async function bounded<T>(work: Promise<T>, label: string, opts: OcrOptions): Promise<T> {
  return opts.withTimeout ? opts.withTimeout(work, label) : work;
}

/** OCR one local image. Disabled or failed OCR always returns an empty string. */
export async function ocrImage(buffer: OcrBuffer, opts: OcrOptions = {}): Promise<string> {
  if (!enabled(opts)) return "";
  try {
    return await bounded(recognize([bytes(buffer)], opts), "image OCR", opts);
  } catch {
    return "";
  }
}

/** Encode PDF.js raw pixels as a simple 24-bit BMP accepted by Tesseract. */
function rawImageAsBmp(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  channels: 1 | 3 | 4,
): Uint8Array {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const output = new Uint8Array(54 + pixelBytes);
  const view = new DataView(output.buffer);
  output[0] = 0x42;
  output[1] = 0x4d;
  view.setUint32(2, output.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelBytes, true);

  for (let y = 0; y < height; y++) {
    const targetRow = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * channels;
      const gray = channels === 1 ? data[source] : 0;
      let r = channels === 1 ? gray : data[source];
      let g = channels === 1 ? gray : data[source + 1];
      let b = channels === 1 ? gray : data[source + 2];
      if (channels === 4) {
        const alpha = data[source + 3] / 255;
        r = Math.round(255 - (255 - r) * alpha);
        g = Math.round(255 - (255 - g) * alpha);
        b = Math.round(255 - (255 - b) * alpha);
      }
      const target = targetRow + x * 3;
      output[target] = b;
      output[target + 1] = g;
      output[target + 2] = r;
    }
  }
  return output;
}

/** OCR embedded page images only when normal PDF extraction found no useful text. */
export async function ocrPdfIfEmpty(
  buffer: OcrBuffer,
  extractedText: string,
  opts: OcrOptions = {},
): Promise<string> {
  if (!enabled(opts) || extractedText.trim().length >= (opts.minTextChars ?? 20)) return extractedText;
  try {
    const work = (async () => {
      const { extractImages, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(bytes(buffer));
      try {
        const images: Uint8Array[] = [];
        for (let page = 1; page <= pdf.numPages; page++) {
          for (const image of await extractImages(pdf, page)) {
            images.push(rawImageAsBmp(image.data, image.width, image.height, image.channels));
          }
        }
        const text = await recognize(images, opts);
        return text || extractedText;
      } finally {
        await pdf.destroy();
      }
    })();
    return await bounded(work, "PDF OCR", opts);
  } catch {
    return extractedText;
  }
}
