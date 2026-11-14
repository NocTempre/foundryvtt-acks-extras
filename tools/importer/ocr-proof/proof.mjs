/**
 * J0 proof: read the JJ's scenario pictures in a browser through the pinned
 * pixel path and hash what comes out, so two browsers can be compared. The
 * read text never leaves the page; only hashes, sizes, confidences and
 * timings are reported (window.__proof).
 *
 * Query: ?src=<same-origin url> reads the PDF from that url instead of the
 * file input; ?pages=417-425 picks the pages; ?scale=2 the factor.
 */
import { getDocument, GlobalWorkerOptions, OPS } from "../../../vendor/pdfjs/pdf.mjs";
import Tesseract from "../../../vendor/tesseract/tesseract.esm.min.js";
import { toGrey, scaleUp, toPgm } from "./pixels.mjs";

const base = new URL("../../../", import.meta.url);
const at = (p) => new URL(p, base).href;
GlobalWorkerOptions.workerSrc = at("vendor/pdfjs/pdf.worker.mjs");

const q = new URLSearchParams(location.search);
const [first, last] = (q.get("pages") ?? "417-425").split("-").map(Number);
const SCALE = Number(q.get("scale") ?? 2);
const state = (window.__proof = { status: "idle", ua: navigator.userAgent, scale: SCALE, pages: [], violations: [], error: null });
document.addEventListener("securitypolicyviolation", (e) => state.violations.push(`${e.violatedDirective} ${e.blockedURI}`));

const hex = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
const show = () => {
  document.getElementById("status").textContent = state.status;
  document.getElementById("out").textContent = JSON.stringify({ ...state, ua: undefined }, null, 1);
};

/** The page's image objects, resolved through page.objs, largest first. */
async function pictures(page) {
  const ops = await page.getOperatorList();
  const names = new Set();
  for (let i = 0; i < ops.fnArray.length; i++) if (ops.fnArray[i] === OPS.paintImageXObject) names.add(ops.argsArray[i][0]);
  const out = [];
  for (const name of names) {
    const img = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), 10000);
      const done = (v) => { clearTimeout(t); resolve(v ?? null); };
      try { page.objs.get(name, done); } catch { try { page.commonObjs.get(name, done); } catch { done(null); } }
    });
    if (img) out.push({ name, img });
  }
  return out.sort((a, b) => b.img.width * b.img.height - a.img.width * a.img.height);
}

async function run(bytes) {
  state.status = "opening";
  show();
  const task = getDocument({
    data: new Uint8Array(bytes),
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    wasmUrl: at("vendor/pdfjs/wasm/"),
    verbosity: 0,
  });
  const doc = await task.promise;
  state.status = "starting engine";
  show();
  const t0 = performance.now();
  const worker = await Tesseract.createWorker("eng", 1, {
    workerPath: at("vendor/tesseract/worker.min.js"),
    corePath: at("vendor/tesseract/tesseract-core-simd-lstm.wasm.js"),
    langPath: at("vendor/tesseract/lang"),
    gzip: true,
    cacheMethod: "none",
    workerBlobURL: false,
  });
  await worker.setParameters({ tessedit_pageseg_mode: "3" });
  state.engineStartMs = Math.round(performance.now() - t0);
  for (let p = first; p <= last; p++) {
    state.status = `page ${p}`;
    show();
    const page = await doc.getPage(p);
    const pics = await pictures(page);
    const row = { page: p, rotate: page.rotate, images: pics.map(({ name, img }) => `${name} ${img.width}x${img.height} kind ${img.kind} ${img.bitmap ? "BITMAP" : img.data ? img.data.length : "no data"}`) };
    state.pages.push(row);
    // The scenario is the one picture about 1340 × 1034 (a recipe names its
    // XObject); the larger ones are the page's frame art.
    const chosen = pics.find(({ img }) => img.width >= 1300 && img.width <= 1400 && img.height >= 1000 && img.height <= 1060);
    row.picture = chosen?.name ?? null;
    const pic = chosen?.img;
    if (!pic?.data) { row.error = "no decoded samples"; continue; }
    row.samplesSha = await hex(pic.data);
    const t = performance.now();
    const grey = toGrey(pic);
    const big = scaleUp(grey, pic.width, pic.height, SCALE);
    row.scaledSha = await hex(big.grey);
    const { data } = await worker.recognize(toPgm(big.grey, big.width, big.height), {}, { text: true });
    row.seconds = Math.round(performance.now() - t) / 1000;
    row.chars = data.text.length;
    row.confidence = data.confidence;
    row.textSha = await hex(new TextEncoder().encode(data.text));
    show();
  }
  await worker.terminate();
  await task.destroy();
  state.status = "done";
  show();
}

const go = (getBytes) => {
  if (state.status !== "idle" && state.status !== "done" && state.status !== "failed") return;
  state.pages = [];
  getBytes()
    .then(run)
    .catch((e) => { state.status = "failed"; state.error = String(e?.stack ?? e); show(); });
};
document.getElementById("run").addEventListener("click", () => {
  const src = q.get("src");
  const file = document.getElementById("pdf").files[0];
  if (src) go(() => fetch(src).then((r) => r.arrayBuffer()));
  else if (file) go(() => file.arrayBuffer());
  else { state.status = "choose a file"; show(); }
});
show();
