/**
 * Reads text printed inside a picture: the pinned pixel path from pdf.js's raw
 * samples to a binary PGM, and the vendored Tesseract engine that reads it.
 * The path is integer arithmetic throughout, so a read is the same bytes on
 * every seat. Runs in the Foundry client and in Node.
 */
import { getDocument, OPS } from "../../vendor/pdfjs/pdf.mjs";
import { pageObject } from "./extract.mjs";

/** The vendored engine's folder, beside the module's `scripts/`. */
const VENDOR = new URL("../../vendor/tesseract/", import.meta.url);

/** pdf.js ImageKind values. */
export const KIND = Object.freeze({ GRAYSCALE_1BPP: 1, RGB_24BPP: 2, RGBA_32BPP: 3 });

/** The page segmentation mode a reader starts in; a read naming another sets it for that read alone. */
const DEFAULT_PSM = 3;

/** How long a page's picture object may take to arrive, in milliseconds. */
const OBJECT_WAIT_MS = 10000;

/* ------------------------------------------------------------------ pictures */

/**
 * Open a PDF with the pdf.js paths that return pictures as browser bitmaps
 * switched off, so a picture's samples come back raw; the caller destroys it
 * with `doc.loadingTask.destroy()`.
 *
 * @param {ArrayBuffer|Uint8Array} data
 * @param {{wasmUrl?: string}} [options] where the wasm image decoders live, as
 *   `extract.mjs` `setWasmUrl` takes it
 */
export async function openPinned(data, { wasmUrl = null } = {}) {
  return getDocument({
    data: new Uint8Array(data),
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    verbosity: 0,
    ...(wasmUrl ? { wasmUrl } : {}),
  }).promise;
}

/**
 * The decoded samples `{ width, height, kind, data }` of one named picture, or
 * null when the page paints none of that name or it never arrives. Throws when
 * it arrived with no raw samples (the document was not opened by `openPinned`).
 *
 * @param {object} page a pdf.js page
 * @param {string} name
 */
export async function pictureSamples(page, name) {
  await page.getOperatorList();
  const img = await pageObject(page, name, OBJECT_WAIT_MS);
  if (!img) return null;
  if (!img.data) throw new Error(`picture ${name} has no raw samples; open the document with openPinned`);
  return img;
}

/**
 * Every picture a page paints, `{ name, width, height, kind }`, largest first.
 *
 * @param {object} page a pdf.js page
 */
export async function pagePictures(page) {
  const ops = await page.getOperatorList();
  const names = new Set();
  for (let i = 0; i < ops.fnArray.length; i++) if (ops.fnArray[i] === OPS.paintImageXObject) names.add(ops.argsArray[i][0]);
  const out = [];
  for (const name of names) {
    const img = await pageObject(page, name, OBJECT_WAIT_MS);
    if (img) out.push({ name, width: img.width, height: img.height, kind: img.kind });
  }
  return out.sort((a, b) => b.width * b.height - a.width * a.height);
}

/**
 * The samples of the one picture a page paints at an exact size, which names
 * a picture independent of evaluation order. Throws when none or several have it.
 *
 * @param {object} page a pdf.js page
 * @param {{w: number, h: number}} size the picture's width and height in samples
 */
export async function pictureBySize(page, { w, h }) {
  const held = (await pagePictures(page)).filter((p) => p.width === w && p.height === h);
  if (held.length !== 1) throw new Error(`the page paints ${held.length} pictures of ${w}x${h} samples, not one`);
  const samples = await pictureSamples(page, held[0].name);
  if (!samples) throw new Error(`the ${w}x${h} picture never arrived`);
  return samples;
}

/**
 * One grey byte per pixel from a pdf.js image object (`{ width, height, kind,
 * data }`). Rec. 601 luma in 10-bit fixed point; a 1-bit image is black or
 * white.
 */
export function toGrey({ width, height, kind, data }) {
  const out = new Uint8Array(width * height);
  if (kind === KIND.RGB_24BPP || kind === KIND.RGBA_32BPP) {
    const step = kind === KIND.RGB_24BPP ? 3 : 4;
    for (let i = 0, j = 0; i < out.length; i++, j += step) out[i] = (306 * data[j] + 601 * data[j + 1] + 117 * data[j + 2] + 512) >> 10;
  } else if (kind === KIND.GRAYSCALE_1BPP) {
    const rowBytes = (width + 7) >> 3;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[y * width + x] = data[y * rowBytes + (x >> 3)] & (128 >> (x & 7)) ? 255 : 0;
  } else throw new Error(`unsupported image kind ${kind}`);
  return out;
}

/**
 * Bilinear integer upscale by `k`, pixel centres aligned, edges clamped.
 */
export function scaleUp(grey, width, height, k) {
  const W = width * k, H = height * k, d = 2 * k, dd = d * d, half = dd >> 1;
  const xs0 = new Int32Array(W), xs1 = new Int32Array(W), xw = new Int32Array(W);
  for (let x = 0; x < W; x++) {
    const n = 2 * x + 1 - k;
    const i = Math.floor(n / d);
    xw[x] = n - i * d;
    xs0[x] = Math.min(width - 1, Math.max(0, i));
    xs1[x] = Math.min(width - 1, Math.max(0, i + 1));
  }
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const n = 2 * y + 1 - k;
    const j = Math.floor(n / d);
    const fy = n - j * d;
    const r0 = Math.min(height - 1, Math.max(0, j)) * width;
    const r1 = Math.min(height - 1, Math.max(0, j + 1)) * width;
    for (let x = 0; x < W; x++) {
      const fx = xw[x], a = xs0[x], b = xs1[x];
      const top = grey[r0 + a] * (d - fx) + grey[r0 + b] * fx;
      const bot = grey[r1 + a] * (d - fx) + grey[r1 + b] * fx;
      out[y * W + x] = (top * (d - fy) + bot * fy + half) / dd | 0;
    }
  }
  return { grey: out, width: W, height: H };
}

/** A binary PGM (P5) of a grey buffer. */
export function toPgm(grey, width, height) {
  const head = new TextEncoder().encode(`P5\n${width} ${height}\n255\n`);
  const out = new Uint8Array(head.length + grey.length);
  out.set(head, 0);
  out.set(grey, head.length);
  return out;
}

/**
 * A picture in grey, scaled once by `k`: `{ grey, width, height, k }`. Every box is
 * cut from this one image, so its edges come from the picture's own pixels.
 *
 * @param {{width: number, height: number, kind: number, data: Uint8Array}} samples a pdf.js image object
 * @param {number} [k] integer scale factor
 */
export function scaledPicture(samples, k = 2) {
  const big = scaleUp(toGrey(samples), samples.width, samples.height, k);
  return { ...big, k };
}

/**
 * One box `[x, y, w, h]` (in source samples) cut from a scaled picture, as
 * `{ pgm, width, height, origin }`, `origin` being the crop's corner in scaled
 * pixels. Throws on a box outside the picture.
 *
 * @param {{grey: Uint8Array, width: number, height: number, k: number}} scaled `scaledPicture`'s result
 * @param {number[]} box `[x, y, w, h]`
 */
export function cropBox(scaled, box) {
  const [bx, by, bw, bh] = box;
  const x0 = Math.max(0, Math.round(bx * scaled.k));
  const y0 = Math.max(0, Math.round(by * scaled.k));
  const x1 = Math.min(scaled.width, Math.round((bx + bw) * scaled.k));
  const y1 = Math.min(scaled.height, Math.round((by + bh) * scaled.k));
  const width = x1 - x0, height = y1 - y0;
  if (!(width > 0 && height > 0)) throw new Error(`box ${JSON.stringify(box)} is outside the picture`);
  const grey = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) grey.set(scaled.grey.subarray((y0 + y) * scaled.width + x0, (y0 + y) * scaled.width + x1), y * width);
  return { pgm: toPgm(grey, width, height), width, height, origin: [x0, y0] };
}

/* ------------------------------------------------------------------- reading */

/**
 * What a read returns: `text`, `confidence` and `lines` of `{ text, confidence,
 * bbox, words }`. A `bbox` is in the read PGM's pixels; `origin` places that PGM
 * in the scaled picture.
 *
 * @typedef {object} OcrRead
 */

/**
 * The engine's blocks flattened to lines and words in reading order.
 */
function shapeRead({ text, confidence, blocks }, origin) {
  const lines = [];
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        lines.push({
          text: line.text,
          confidence: line.confidence,
          bbox: line.bbox,
          words: (line.words ?? []).map((w) => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })),
        });
      }
    }
  }
  return { text, confidence, lines, origin };
}

/**
 * One reader that starts the engine once and reads any number of pictures:
 * `read(pgm, {psm})` and `readBox(scaled, box, {psm})` resolve to an `OcrRead`,
 * and `terminate()` ends it. `psm` is the page segmentation mode (3 by default).
 *
 * @returns {Promise<{read: Function, readBox: Function, terminate: Function}>}
 */
export async function createReader() {
  const engine = isNode() ? await nodeEngine(VENDOR) : await browserEngine(VENDOR);
  return {
    async read(pgm, { psm = DEFAULT_PSM, origin = [0, 0] } = {}) {
      return shapeRead(await engine.recognize(pgm, psm), origin);
    },
    async readBox(scaled, box, { psm = DEFAULT_PSM } = {}) {
      const { pgm, origin } = cropBox(scaled, box);
      return shapeRead(await engine.recognize(pgm, psm), origin);
    },
    async terminate() {
      await engine.close();
    },
  };
}

/** True in a plain Node process; false in the browser, Foundry's included. */
function isNode() {
  return typeof globalThis.process?.versions?.node === "string" && typeof globalThis.window === "undefined" && typeof globalThis.document === "undefined";
}

/**
 * The browser engine: tesseract.js's worker over the vendored files, with its
 * CDN, cache and blob-worker defaults off. The empty `errorHandler` stops the
 * library throwing a second time.
 */
async function browserEngine(root) {
  const { default: Tesseract } = await import("../../vendor/tesseract/tesseract.esm.min.js");
  const worker = await Tesseract.createWorker("eng", 1, {
    workerPath: new URL("worker.min.js", root).href,
    corePath: new URL("tesseract-core-simd-lstm.wasm.js", root).href,
    langPath: new URL("lang", root).href,
    gzip: true,
    cacheMethod: "none",
    workerBlobURL: false,
    errorHandler: () => {},
  });
  await worker.setParameters({ tessedit_pageseg_mode: String(DEFAULT_PSM) });
  return {
    async recognize(pgm, psm) {
      const options = psm === DEFAULT_PSM ? {} : { tessedit_pageseg_mode: String(psm) };
      const { data } = await worker.recognize(pgm, options, { text: true, blocks: true });
      return { text: data.text, confidence: data.confidence, blocks: data.blocks };
    },
    close: () => worker.terminate(),
  };
}

/**
 * The Node engine: the vendored core file driven through the calls
 * tesseract.js's worker makes on it, in its order. The core's console output is
 * dropped and a failure reaches the caller as a thrown error.
 */
async function nodeEngine(root) {
  const [{ readFile }, { gunzipSync }, { createRequire }, { fileURLToPath }, vm] = await Promise.all([
    import("node:fs/promises"),
    import("node:zlib"),
    import("node:module"),
    import("node:url"),
    import("node:vm"),
  ]);
  const corePath = fileURLToPath(new URL("tesseract-core-simd-lstm.wasm.js", root));
  const source = await readFile(corePath, "utf8");
  const mod = { exports: {} };
  // A CommonJS bundle under an ESM package type, so it compiles as a function.
  vm.compileFunction(source, ["exports", "require", "module", "__filename", "__dirname"], { filename: corePath })(
    mod.exports, createRequire(corePath), mod, corePath, fileURLToPath(root));
  const Module = await mod.exports({ TesseractProgress() {}, print() {}, printErr() {} });
  const data = gunzipSync(await readFile(fileURLToPath(new URL("lang/eng.traineddata.gz", root))));
  Module.FS.writeFile("./eng.traineddata", data);
  const api = new Module.TessBaseAPI();
  if (api.Init(null, "eng", 1, undefined) === -1) throw new Error("the OCR engine failed to start");
  api.SetVariable("tessedit_pageseg_mode", String(DEFAULT_PSM));
  return {
    async recognize(pgm, psm) {
      const changed = psm !== DEFAULT_PSM;
      if (changed) {
        api.SaveParameters();
        api.SetVariable("tessedit_pageseg_mode", String(psm));
      }
      Module.FS.writeFile("/input", pgm);
      if (api.SetImageFile(exifOrientation(pgm), 0) === 1) throw new Error("the OCR engine could not read the image");
      api.Recognize(null);
      const text = api.GetUTF8Text();
      const confidence = api.MeanTextConf();
      const blocks = JSON.parse(api.GetJSONText()).blocks;
      if (changed) api.RestoreParameters();
      return { text, confidence, blocks };
    },
    close() {
      api.End();
    },
  };
}

/**
 * The orientation tesseract.js reads from an image's first 500 bytes (1 when
 * it finds none); applied here because a read must match the worker's.
 */
function exifOrientation(image) {
  return parseInt(image.slice(0, 500).join(" ").match(/1 18 0 3 0 0 0 1 0 (\d)/)?.[1], 10) || 1;
}
