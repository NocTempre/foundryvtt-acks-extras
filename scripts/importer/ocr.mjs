/**
 * Reading text printed inside a picture: the pinned pixel path and the engine
 * that reads it.
 *
 * A page picture reaches the engine as the same bytes on every seat, because
 * every step between pdf.js's decoded samples and the engine's input is
 * integer arithmetic over data the module owns: the document is opened with
 * pdf.js's canvas and image-decoder paths off (the samples arrive raw from
 * `page.objs`, kind 2, 24-bit RGB), grey is Rec. 601 luma in 10-bit fixed
 * point, the scale is bilinear in integers, and the engine is handed a binary
 * PGM. No canvas sits between.
 *
 * The engine is the vendored Tesseract (`vendor/tesseract/`), one core build
 * (SIMD, LSTM only) and the English data, opened with OEM 1 and PSM 3 unless a
 * read names another. The browser reader is tesseract.js's `createWorker`;
 * the Node reader loads the same core file and data itself and makes the same
 * calls on it that the worker script makes, so a PGM read there and here is
 * the same read. Every path the library would default to a CDN for is set
 * here, and no read touches the network or the browser's caches.
 *
 * Runs in the Foundry client and in Node. Nothing from `node:` or from the
 * engine bundle is imported until a reader asks for it.
 */
import { getDocument, OPS } from "../../vendor/pdfjs/pdf.mjs";

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
 * Open a PDF with the two pdf.js paths that would hand pictures back as
 * browser bitmaps switched off, so a picture's samples come back raw. Returns
 * the document; the caller destroys it with `doc.loadingTask.destroy()`.
 * The worker source is whatever `GlobalWorkerOptions.workerSrc` holds
 * (`extract.mjs` `setWorker`).
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
 * The decoded samples of one picture on a page, by pdf.js's object name for it
 * (the name `pagePictures` lists): `{ width, height, kind, data }`, or null
 * when the page paints no picture of that name or the object never arrived.
 * Throws when it arrived with no raw samples, which means the document was not
 * opened by `openPinned`.
 *
 * @param {object} page a pdf.js page
 * @param {string} name
 */
export async function pictureSamples(page, name) {
  await page.getOperatorList();
  const img = await objectNamed(page, name);
  if (!img) return null;
  if (!img.data) throw new Error(`picture ${name} has no raw samples; open the document with openPinned`);
  return img;
}

/**
 * Every picture a page paints, `{ name, width, height, kind }`, largest first.
 * A recipe names the one it wants; the largest on a page is often frame art.
 *
 * @param {object} page a pdf.js page
 */
export async function pagePictures(page) {
  const ops = await page.getOperatorList();
  const names = new Set();
  for (let i = 0; i < ops.fnArray.length; i++) if (ops.fnArray[i] === OPS.paintImageXObject) names.add(ops.argsArray[i][0]);
  const out = [];
  for (const name of names) {
    const img = await objectNamed(page, name);
    if (img) out.push({ name, width: img.width, height: img.height, kind: img.kind });
  }
  return out.sort((a, b) => b.width * b.height - a.width * a.height);
}

/** A page's object by name, null when it does not arrive in time. */
function objectNamed(page, name) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), OBJECT_WAIT_MS);
    const done = (value) => {
      clearTimeout(timer);
      resolve(value ?? null);
    };
    try {
      page.objs.get(name, done);
    } catch {
      try {
        page.commonObjs.get(name, done);
      } catch {
        done(null);
      }
    }
  });
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
 * Bilinear upscale by integer factor `k`, pixel centres aligned, edges
 * clamped. Weights are exact rationals over 2k, so the result is integer
 * arithmetic throughout.
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
 * A picture in grey and scaled once by `k`, ready for boxes:
 * `{ grey, width, height, k }`, the size being the scaled one. Every box of a
 * picture is cut from this one image, so a box's edge pixels come from the
 * picture's real neighbours and never from a picture scaled on its own.
 *
 * @param {{width: number, height: number, kind: number, data: Uint8Array}} samples a pdf.js image object
 * @param {number} [k] integer scale factor
 */
export function scaledPicture(samples, k = 2) {
  const big = scaleUp(toGrey(samples), samples.width, samples.height, k);
  return { ...big, k };
}

/**
 * One box cut from a scaled picture. The box is `[x, y, w, h]` in the picture's
 * source samples and is taken at `k` times its coordinates, clamped to the
 * image. Returns the crop as a PGM with its size and `origin`, the crop's
 * top-left corner in the scaled picture's pixels, which is what to add to a
 * read's word positions to place them in the scaled picture (divide by `k` for
 * source samples). Throws on a box with nothing inside the picture.
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
 * What a read returns: `text`, the engine's mean `confidence`, and `lines`,
 * each `{ text, confidence, bbox, words }` with each word `{ text,
 * confidence, bbox }`. A `bbox` is the engine's `{ x0, y0, x1, y1 }` in the
 * pixels of the PGM that was read; `origin` is where that PGM's corner sits in
 * the scaled picture (`[0, 0]` for a whole picture).
 *
 * @typedef {object} OcrRead
 */

/**
 * The reader's shape of what the engine returned: the blocks the engine's JSON
 * holds, flattened to lines and words in reading order.
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
 * One reader, to be torn down with `terminate()` when the run is done: the
 * engine starts once and reads any number of pictures. `read(pgm, {psm})`
 * takes a PGM and a page segmentation mode (3 by default; 6 is a block of
 * text, 7 a single line) and resolves to an `OcrRead`. `readBox(scaled, box,
 * {psm})` cuts the box from a `scaledPicture` and reads it, its `origin` set.
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
 * The browser engine: tesseract.js's worker, started from the vendored files
 * with the three paths it would default to a CDN for set, no cache and no blob
 * worker. A failed job rejects its promise; the empty `errorHandler` only
 * stops the library throwing a second time from inside its message handler.
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
 * The Node engine: the vendored core file compiled here and driven through the
 * calls tesseract.js's worker script makes on it, in its order — the language
 * data written to `./eng.traineddata`, `TessBaseAPI.Init(null, "eng", 1)`,
 * `SetVariable` for the page segmentation mode (saved and restored around a
 * read that names another), the image written to `/input` and loaded with
 * `SetImageFile`, `Recognize`, then the text, the mean confidence and the JSON
 * blocks. The core is the file the browser reads, never an npm copy and never
 * a build picked by feature detection. The core's own console output (a
 * resolution estimate on every read) is dropped; a failure reaches the caller
 * as a thrown error.
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
  // The core is a CommonJS bundle; the repo's package type makes `.js` ESM,
  // so it is compiled as a function of the CommonJS arguments.
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
 * The orientation tesseract.js reads out of an image's first 500 bytes with a
 * pattern over their decimal values (1 when it finds none). Kept because the
 * worker script applies it to every image, a PGM's pixel bytes included, and a
 * read here must be the read it makes.
 */
function exifOrientation(image) {
  return parseInt(image.slice(0, 500).join(" ").match(/1 18 0 3 0 0 0 1 0 (\d)/)?.[1], 10) || 1;
}
