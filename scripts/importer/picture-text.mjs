/**
 * The `ocr` op: text a book prints inside a picture, read at import from the
 * Judge's own copy and handed to the executor's own ops.
 *
 * A page's recipe (`bookCookbook.pictures[<page>]`) names the picture by its
 * sample size `{w, h}`, lists the boxes to read in reading order, each with a page
 * segmentation mode, and lists the corrections applied to a box's text after
 * the read. `pictureRuns` turns the corrected lines into the text runs the
 * executor's ops take (`{str, x, y, w, h}` in the picture's source samples), and
 * `readPictureText` runs the instruction's `then` over them through the
 * executor's own `execInstruction`, so key-number checks, paragraph assembly,
 * stat-line parsing and creature lookups stay the existing code.
 *
 * The crop padding, the scale and the line derivation are fixed here because
 * the corrections are fitted on them: change one and every correction moves.
 *
 * A page is read once per document and its corrected lines are kept as long as
 * the document is. The engine and the pinned copy of the PDF that feeds it are
 * not: they close when idle (the timer never holds a Node process open) and on
 * `closePictureReads`, and the next page read opens them again.
 */
import { openPinned, pictureBySize, scaledPicture, createReader } from "./ocr.mjs";

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
 * The reader's output for one box in the shape the corrections and the runs
 * are computed from, and the shape an author's read stores: `{ box, psm,
 * origin, k, lines: [{ bbox, words }] }`, each word a string, each bbox the
 * engine's `{x0, y0, x1, y1}` in the crop's pixels and `origin` the crop's
 * corner in the scaled picture.
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
 * A picture of a page in grey and scaled once, with its samples: `{ samples,
 * scaled }`, or throws when the page paints no picture, or more than one, of
 * that size.
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
 * Every box of a recipe read in order from one scaled picture: an array of
 * `{ box, psm, origin, k, lines }`, one per `picture.read` entry.
 *
 * @param {{readBox: Function}} reader a reader from `createReader`
 * @param {object} scaled `scaledPicture`'s result
 * @param {{read: {box: object, psm: number}[]}} picture a page's recipe
 */
export async function readBoxReads(reader, scaled, picture) {
  const out = [];
  for (const spec of picture.read) out.push(boxReadOf(spec, await reader.readBox(scaled, sampleBox(spec.box), { psm: spec.psm }), scaled.k));
  return out;
}

/* ---------------------------------------------------------------- the runs */

/** The matches of a correction in a text, `g` forced. */
function matchesOf(text, find, flags) {
  return [...text.matchAll(new RegExp(find, flags.includes("g") ? flags : `${flags}g`))];
}

/**
 * A page's text runs from its box reads, and what the corrections did.
 *
 * A box's lines are the words of each read line joined by single spaces; the
 * box's text is its lines joined by newlines, and its corrections run on that
 * text in list order, each on the previous one's output, as JS `replace` with
 * the correction's `flags`. The corrected text is split on newlines again: line
 * i keeps raw line i's box, and a line past the raw count keeps the last one's.
 * Each line is one run `{str: text + " ", x: left edge, y: vertical centre, w,
 * h}` in the picture's source samples. A box that read no line gives no run.
 *
 * Returns `{ runs, boxText, hits, spans }`: `boxText[i]` is box i's corrected
 * text, `hits[j]` the number of matches correction j had at its place in the
 * list, `g` forced, which compile and verify hold against the correction's
 * `hits`, and `spans[j]` how many of them cross a line break, which a
 * correction may not.
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
    text.split("\n").forEach((str, j) => {
      const { x0, y0, x1, y1 } = read.lines[Math.min(j, read.lines.length - 1)].bbox;
      runs.push({ str: `${str} `, x: (ox + x0) / read.k, y: (oy + (y0 + y1) / 2) / read.k, w: (x1 - x0) / read.k, h: (y1 - y0) / read.k });
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
 * Store a page's box reads for a document as if the document had been read, so
 * the page's runs come from them and no engine starts. The compiler seeds an
 * author's read; the suite seeds an invented one.
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
 * A page's corrected lines for a document, read at first ask: `{ runs,
 * boxText, hits, spans, boxReads }`. The read is shared by every entry on the page
 * and cached for as long as the document; a failed read is not cached.
 *
 * @param {object} doc the session's document, which hands back its own bytes through `getData()`
 * @param {number} page
 * @param {object} picture the page's recipe
 */
export function pictureReadFor(doc, page, picture) {
  const st = stateOf(doc);
  const held = st.pages.get(page);
  if (held?.picture === picture) return held.result;
  const result = withEngine(doc, st, async ({ pinned, reader }) => {
    const { scaled } = await pictureScaled(pinned, page, picture.size);
    const boxReads = await readBoxReads(reader, scaled, picture);
    return { ...pictureRuns(boxReads, picture), boxReads };
  });
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
 * Execute an `ocr` instruction: `{ op: "ocr", page, then, unread? }`. The
 * page's corrected lines are read (once per document), and `then`, an
 * instruction of the executor's own, runs over them as the page's text runs,
 * on the instruction's page. `unread`, allowed on a `value` only, lists paths
 * into the parse that are deleted after it runs: each is recorded as a miss
 * `{field, unread}` and echoed as `result.unread`, so a surface can say it was
 * not imported. Throws when the page has no recipe, inside the executor's own
 * try, so it becomes a miss of the field.
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
