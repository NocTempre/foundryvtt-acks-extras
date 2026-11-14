/**
 * J0 proof: read the JJ's scenario pictures in a browser through the pinned
 * pixel path and hash what comes out, so two browsers can be compared. The
 * read text never leaves the page; only hashes, sizes, confidences and
 * timings are reported (window.__proof).
 *
 * Query: ?src=<same-origin url> reads the PDF from that url instead of the
 * file input; ?pages=417-425 picks the pages; ?scale=2 the factor.
 */
import { GlobalWorkerOptions } from "../../../vendor/pdfjs/pdf.mjs";
import { openPinned, pagePictures, pictureSamples, scaledPicture, toPgm, createReader } from "../../../scripts/importer/ocr.mjs";

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

async function run(bytes) {
  state.status = "opening";
  show();
  const doc = await openPinned(bytes, { wasmUrl: at("vendor/pdfjs/wasm/") });
  state.status = "starting engine";
  show();
  const t0 = performance.now();
  const reader = await createReader();
  state.engineStartMs = Math.round(performance.now() - t0);
  for (let p = first; p <= last; p++) {
    state.status = `page ${p}`;
    show();
    const page = await doc.getPage(p);
    const pics = await pagePictures(page);
    const row = { page: p, rotate: page.rotate, images: pics.map((img) => `${img.name} ${img.width}x${img.height} kind ${img.kind}`) };
    state.pages.push(row);
    // The scenario is the one picture about 1340 × 1034 (a recipe names its
    // XObject); the larger ones are the page's frame art.
    const chosen = pics.find((img) => img.width >= 1300 && img.width <= 1400 && img.height >= 1000 && img.height <= 1060);
    row.picture = chosen?.name ?? null;
    const pic = chosen ? await pictureSamples(page, chosen.name) : null;
    if (!pic?.data) { row.error = "no decoded samples"; continue; }
    row.samplesSha = await hex(pic.data);
    const t = performance.now();
    const big = scaledPicture(pic, SCALE);
    row.scaledSha = await hex(big.grey);
    const read = await reader.read(toPgm(big.grey, big.width, big.height));
    row.seconds = Math.round(performance.now() - t) / 1000;
    row.chars = read.text.length;
    row.confidence = read.confidence;
    row.textSha = await hex(new TextEncoder().encode(read.text));
    show();
  }
  await reader.terminate();
  await doc.loadingTask.destroy();
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
