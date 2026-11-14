/**
 * The `ocr` op: text a book prints inside a picture, read at import from the
 * Judge's own copy and handed to the executor's own ops as text runs.
 * The crop padding, the scale and the line derivation are fixed here because the
 * recipe's corrections are fitted on them. A page is read once per document; its
 * engine closes when idle and on `closePictureReads`.
 */
import { openPinned, pictureBySize, scaledPicture, createReader } from "./ocr.mjs";
import { LANG_PREFIX } from "./constants.mjs";
import { progressBar } from "./progress.mjs";

/** The integer scale a picture is read at. */
export const SCALE = 2;

/** Source samples added on every side of a box before it is cut. */
export const BOX_PAD = 4;

/** How long a read engine may sit unused before it and the pinned copy are closed, in milliseconds. */
export const IDLE_MS = 30000;

/** The box `{x0, x1, y0, y1}` of a recipe as the `[x, y, w, h]` the reader cuts, padded. */
export const sampleBox = ({ x0, x1, y0, y1 }) => [x0 - BOX_PAD, y0 - BOX_PAD, x1 - x0 + 2 * BOX_PAD, y1 - y0 + 2 * BOX_PAD];

/* ------------------------------------------------------------------ the read */

/**
 * One box's read in the shape the corrections and an author's stored read use:
 * `{ box, psm, origin, k, lines: [{ bbox, words }] }`.
 */
function boxReadOf(spec, read, k) {
  return {
    box: spec.box,
    psm: spec.psm,
    origin: read.origin,
    k,
    lines: read.lines.map((line) => ({ bbox: line.bbox, words: line.words.map((w) => w.text) })),
  };
}

/**
 * A page's picture in grey and scaled once, `{ samples, scaled }`; throws when the
 * page paints none, or more than one, of that size.
 *
 * @param {object} pinned a document opened by `openPinned`
 * @param {number} page
 * @param {{w: number, h: number}} size the picture's width and height in samples
 */
export async function pictureScaled(pinned, page, size) {
  const pdfPage = await pinned.getPage(page);
  try {
    const samples = await pictureBySize(pdfPage, size).catch((err) => {
      throw new Error(`p.${page}: ${err.message}`);
    });
    return { samples, scaled: scaledPicture(samples, SCALE) };
  } finally {
    pdfPage.cleanup?.();
  }
}

/**
 * Every box of a recipe read in order from one scaled picture, one
 * `{ box, psm, origin, k, lines }` per `picture.read` entry; `onBox` is called after each.
 *
 * @param {{readBox: Function}} reader a reader from `createReader`
 * @param {object} scaled `scaledPicture`'s result
 * @param {{read: {box: object, psm: number}[]}} picture a page's recipe
 * @param {(done: number) => void} [onBox]
 */
export async function readBoxReads(reader, scaled, picture, onBox) {
  const out = [];
  for (const spec of picture.read) {
    out.push(boxReadOf(spec, await reader.readBox(scaled, sampleBox(spec.box), { psm: spec.psm }), scaled.k));
    onBox?.(out.length);
  }
  return out;
}

/* ---------------------------------------------------------------- the runs */

/** The matches of a correction in a text, `g` forced. */
function matchesOf(text, find, flags) {
  return [...text.matchAll(new RegExp(find, flags.includes("g") ? flags : `${flags}g`))];
}

/**
 * A page's text runs from its box reads: each box's lines are corrected in list
 * order, then become one run per line in the picture's source samples.
 * Returns `{ runs, boxText, hits, spans }`; `hits[j]` is correction j's match count
 * and `spans[j]` how many of them cross a line break, which a correction may not.
 *
 * @param {object[]} boxReads `readBoxReads`'s result, or an author's read
 * @param {{corrections?: object[]}} picture a page's recipe
 */
export function pictureRuns(boxReads, picture) {
  const corrections = picture.corrections ?? [];
  const runs = [];
  const boxText = [];
  const hits = corrections.map(() => 0);
  const spans = corrections.map(() => 0);
  boxReads.forEach((read, i) => {
    let text = read.lines.map((line) => line.words.join(" ")).join("\n");
    corrections.forEach((c, j) => {
      if (c.box !== i) return;
      const flags = c.flags ?? "";
      const found = matchesOf(text, c.find, flags);
      hits[j] = found.length;
      spans[j] = found.filter((m) => m[0].includes("\n")).length;
      text = text.replace(new RegExp(c.find, flags), c.to);
    });
    boxText.push(text);
    if (!read.lines.length) return;
    const [ox, oy] = read.origin;
    const heights = read.lines.map(({ bbox }) => bbox.y1 - bbox.y0).sort((a, b) => a - b);
    const mid = heights.length >> 1;
    const h = (heights.length % 2 ? heights[mid] : (heights[mid - 1] + heights[mid]) / 2) / read.k;
    text.split("\n").forEach((str, j) => {
      const { x0, y0, x1, y1 } = read.lines[Math.min(j, read.lines.length - 1)].bbox;
      runs.push({ str: `${str} `, x: (ox + x0) / read.k, y: (oy + (y0 + y1) / 2) / read.k, w: (x1 - x0) / read.k, h });
    });
  });
  return { runs, boxText, hits, spans };
}

/* ------------------------------------------------------------- per document */

/** Per document: the pages read and the engine that reads them. Weakly held, so a closed book frees its lines. */
const STATES = new WeakMap();

/** The states whose engine is open, for `closePictureReads`. */
const OPEN = new Set();

/** Where the browser finds pdf.js's image decoders; Node reads none. */
const wasmUrl = () => (typeof globalThis.window === "undefined" ? null : new URL("../../vendor/pdfjs/wasm/", import.meta.url).href);

function stateOf(doc) {
  if (!STATES.has(doc)) STATES.set(doc, { pages: new Map(), queue: Promise.resolve(), engine: null, timer: null, token: 0 });
  return STATES.get(doc);
}

/** Close a state's engine and pinned copy; the corrected lines stay. */
async function teardown(st) {
  clearTimeout(st.timer);
  st.timer = null;
  OPEN.delete(st);
  const engine = st.engine;
  st.engine = null;
  if (!engine) return;
  const { pinned, reader } = await engine.catch(() => ({}));
  await reader?.terminate().catch(() => {});
  await pinned?.loadingTask?.destroy().catch(() => {});
}

/** Run `task` with the state's engine, one task at a time, and start its idle timer after. */
function withEngine(doc, st, task) {
  const run = st.queue.then(async () => {
    st.token++;
    clearTimeout(st.timer);
    st.engine ??= (async () => ({ pinned: await openPinned(await doc.getData(), { wasmUrl: wasmUrl() }), reader: await createReader() }))();
    OPEN.add(st);
    try {
      return await task(await st.engine);
    } catch (err) {
      // An engine that failed to start is not kept: the next read starts it again.
      if (st.engine) await st.engine.then(() => null, () => (st.engine = null));
      throw err;
    } finally {
      const token = st.token;
      st.timer = setTimeout(() => {
        st.queue = st.queue.then(() => (st.token === token ? teardown(st) : null));
      }, IDLE_MS);
      st.timer.unref?.();
    }
  });
  st.queue = run.catch(() => {});
  return run;
}

/**
 * Store a page's box reads for a document as if it had been read, so no engine
 * starts; the compiler seeds an author's read.
 *
 * @param {object} doc the document the read is for
 * @param {number} page
 * @param {object} picture the page's recipe, which the corrected lines are computed from
 * @param {object[]} boxReads `readBoxReads`'s shape
 */
export function seedPictureRead(doc, page, picture, boxReads) {
  stateOf(doc).pages.set(page, { picture, result: Promise.resolve({ ...pictureRuns(boxReads, picture), boxReads }) });
}

/**
 * The progress bar a real read shows, one step a box; null where there is no UI
 * or no strings to label it (a Node run).
 */
function readBar(page, boxes) {
  if (!globalThis.ui?.notifications || !globalThis.game?.i18n) return null;
  return progressBar(game.i18n.format(`${LANG_PREFIX}.ui.progressPictureText`, { page }), boxes);
}

/**
 * A page's corrected lines, `{ runs, boxText, hits, spans, boxReads }`, read at
 * first ask, shared by every entry on the page and cached for the document; a
 * failed read is not cached.
 *
 * @param {object} doc the session's document, which hands back its own bytes through `getData()`
 * @param {number} page
 * @param {object} picture the page's recipe
 */
export function pictureReadFor(doc, page, picture) {
  const st = stateOf(doc);
  const held = st.pages.get(page);
  if (held?.picture === picture) return held.result;
  const bar = readBar(page, picture.read.length);
  const result = withEngine(doc, st, async ({ pinned, reader }) => {
    const { scaled } = await pictureScaled(pinned, page, picture.size);
    const boxReads = await readBoxReads(reader, scaled, picture, () => bar?.step());
    return { ...pictureRuns(boxReads, picture), boxReads };
  }).finally(() => bar?.finish());
  st.pages.set(page, { picture, result });
  result.catch(() => {
    if (st.pages.get(page)?.result === result) st.pages.delete(page);
  });
  return result;
}

/** Close every open engine and pinned copy; what was read stays cached. */
export async function closePictureReads() {
  await Promise.all([...OPEN].map((st) => (st.queue = st.queue.then(() => teardown(st)))));
}

/* ---------------------------------------------------------------- the op */

/** Delete the value at a dotted path of an object, when it is there. */
function deletePath(obj, path) {
  const keys = path.split(".");
  let at = obj;
  for (const key of keys.slice(0, -1)) {
    at = at?.[key];
    if (!at || typeof at !== "object") return;
  }
  delete at[keys[keys.length - 1]];
}

/**
 * Execute an `ocr` instruction `{ op: "ocr", page, then, unread? }`: `then` runs over
 * the page's corrected lines as its text runs. `unread`, on a `value` only, lists
 * parse paths deleted after the run, each recorded as a miss and echoed as
 * `result.unread`. Throws when the page has no recipe.
 *
 * @param {object} instr the instruction
 * @param {object} ctx the executor's context for the field
 * @param {object} picture the page's recipe (`bookCookbook.pictures[page]`)
 * @param {Function} run the executor's `execInstruction`
 */
export async function readPictureText(instr, ctx, picture, run) {
  if (!picture) throw new Error(`no picture recipe for p.${instr.page}`);
  if (!instr.then?.op) throw new Error("an ocr instruction needs a then");
  const { runs } = await pictureReadFor(ctx.doc, instr.page, picture);
  const result = await run({ ...instr.then, page: instr.page }, { ...ctx, claims: null, getPage: async () => ({ items: runs }) });
  if (instr.then.op !== "value" || !instr.unread?.length) return result;
  for (const path of instr.unread) {
    if (result && typeof result === "object") deletePath(result, path);
    ctx.misses.push({ field: ctx.field, unread: path });
  }
  if (result && typeof result === "object") result.unread = [...instr.unread];
  return result;
}
