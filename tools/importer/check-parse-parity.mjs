/**
 * Parse-once parity gate: a book read from its saved text must read exactly as
 * the PDF reads.
 *
 * For each book it opens the LOCAL reference PDF, parses every page into the
 * saved form (`parsed-book.mjs`, the code the module ships), round-trips it
 * through JSON, and compares, live document against saved text:
 *
 *   - every page's `pageItems`, deep-equal;
 *   - every cookbook entry's executed node (`ok`, `fields`, `misses`),
 *     deep-equal, through the shipping executor over a handle-shaped document
 *     whose pixel calls reach the live one, as a `BookHandle`'s do. The entries
 *     are the book's own cookbook and, from the content cookbooks (equipment,
 *     powers, spells and the rest), every entry that names the book;
 *   - the saved image placements, live against saved (the boxes
 *     `pageArtPlacements` answers, without the image's name): every page a
 *     scene recipe of the book names, which is what a parse saves, and, so a
 *     book with no scene recipe still checks something, twelve pages spread
 *     across it. The count of pages compared is printed;
 *   - the saved wall traces, live against saved: for each walled scene recipe of
 *     the book (the ones `cookbookWalledScenes` names), the saved walls read
 *     back through JSON against a trace of the same recipe from another open;
 *     `sceneWallTrace` over a handle-shaped document, which must answer from
 *     the saved file with the live document never asked for; and a recipe
 *     edited in its `walls` block, which must not be answered from the file
 *     and so reaches the live document. The counts of recipes and walls are
 *     printed, never a wall. The page renders through `@napi-rs/canvas`, set
 *     up only around each trace, so this proves the saved walls are the
 *     tracer's output on a Node render; a browser's render is not compared;
 *   - that a second parse of the same file from another open is the same file
 *     byte for byte (the digest), since racing seats must write one file.
 *
 * The one normalisation is the font id. pdf.js numbers a font by the document
 * that loaded it and by the order its pages were read in, so a live read's
 * `alias` and the saved form's are different names for the same fonts, and the
 * engine only ever asks whether two runs of one document share one. The gate
 * therefore compares the items without their alias, and then holds the two
 * namings to one-to-one across the whole book: no live font is two saved fonts,
 * and no saved font is two live ones.
 *
 * Operations that read pixels (`art`, `ocr`) are skipped on both sides: the
 * saved form holds text only and they take the live document either way.
 *
 * LOCAL ONLY, like verify-cookbook: it needs the licensed reference PDFs
 * (reference-lib.mjs), never runs in CI, and prints counts, page numbers and
 * digests, never a run of text. Writes a book's file with `--out <dir>`.
 *
 * The digest covers the file's header, which names the PDF's path and size, so
 * it equals a seat's uploaded file only for the same `--src` (the path the
 * shelf journal's PDF page holds) and the same PDF. Without `--src` the header
 * names `shelf/<book>.pdf`.
 *
 * Usage: node tools/importer/check-parse-parity.mjs [--out dir] [--src path] [book ...]   (default: rr jj)
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { openBook, pageArtPlacements, pageItems, placementsOfPage, sceneWallTrace, traceRecipeWalls, useTypography } from "../../scripts/importer/extract.mjs";
import { executeEntry } from "../../scripts/importer/executor.mjs";
import { isSceneRecipe } from "../../scripts/importer/scene-binding.mjs";
import { PARSE_STAMP, SavedBook, fontId, parseDocument } from "../../scripts/importer/parsed-book.mjs";
import { wallTraceInputs } from "../../scripts/importer/wall-trace.mjs";
import { releaseDoc } from "../../scripts/importer/release-doc.mjs";
import { FILES } from "./reference-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COOKBOOK = path.join(HERE, "..", "..", "cookbook");

const args = process.argv.slice(2);
let outDir = null;
let srcArg = null;
const books = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") outDir = args[++i];
  else if (args[i] === "--src") srcArg = args[++i];
  else books.push(args[i]);
}
if (!books.length) books.push("rr", "jj");

/** A value with every -0 as 0 and every font alias blanked, for deep comparison. */
function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = k === "alias" ? "@font" : canon(v);
    return out;
  }
  return Object.is(value, -0) ? 0 : value;
}

/** One book's font namings, live against saved: every pair seen, and the pairs that break one-to-one. */
function fontPairing() {
  const live = new Map();
  const saved = new Map();
  const broken = new Set();
  return {
    /** Pair the aliases of two pages' items, index by index; the pages are already equal in every other field. */
    add(a, b) {
      for (let i = 0; i < a.items.length; i++) {
        const x = fontId(a.items[i].alias);
        const y = b.items[i].alias;
        if (live.has(x) && live.get(x) !== y) broken.add(`live ${x}`);
        if (saved.has(y) && saved.get(y) !== x) broken.add(`saved ${y}`);
        live.set(x, y);
        saved.set(y, x);
      }
    },
    get fonts() {
      return live.size;
    },
    get broken() {
      return [...broken];
    },
  };
}

/** First path at which two canonical values differ, or null. */
function firstDiff(a, b, at = "") {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return Number.isNaN(a) && Number.isNaN(b) ? null : at || "(root)";
  if (Array.isArray(a) !== Array.isArray(b)) return at;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = firstDiff(a[k], b[k], `${at}.${k}`);
    if (d) return d;
  }
  return null;
}

/**
 * Run `run` with a `document` whose canvases are `@napi-rs/canvas`'s, which is
 * all `extractPageGray` asks of a browser, and with none before and after: the
 * text passes never see one.
 */
async function withCanvas(run) {
  const { createCanvas } = createRequire(import.meta.url)("@napi-rs/canvas");
  globalThis.document = { createElement: () => createCanvas(1, 1) };
  try {
    return await run();
  } finally {
    delete globalThis.document;
  }
}

/** The tracer a parse and the live side share, over the open document. */
const traceOnNode = (doc, recipe) => withCanvas(() => traceRecipeWalls(doc, recipe));

/** A document shaped as a `BookHandle` is: text from the saved book, everything else from the live document; `calls.live` counts the asks for the live one. */
function handleOver(saved, live, bookId, calls = { live: 0 }) {
  const doc = {
    isBookHandle: true,
    numPages: saved.numPages,
    title: saved.title,
    verified: true,
    getPage: (n) => saved.getPage(n),
    savedPlacements: async (n) => saved.placements(n),
    savedWalls: async (id, inputs) => saved.walls(id, inputs),
    verify: async () => true,
    live: async () => {
      calls.live++;
      return live;
    },
  };
  return useTypography(doc, bookId);
}

let failures = 0;
let ran = 0;

for (const bookId of books) {
  const file = FILES[bookId];
  if (!file || !fs.existsSync(file)) {
    console.log(`SKIP ${bookId}: reference PDF not found`);
    continue;
  }
  ran++;
  const registers = JSON.parse(fs.readFileSync(path.join(COOKBOOK, "registers.json"), "utf8"));
  const cookbooks = fs
    .readdirSync(COOKBOOK)
    .filter((f) => f.endsWith(".json") && f !== "registers.json" && f !== "index.json")
    .map((f) => JSON.parse(fs.readFileSync(path.join(COOKBOOK, f), "utf8")))
    .map((cb) => ({ cb, ids: Object.keys(cb.entries ?? {}).filter((id) => (cb.book ? cb.book.id === bookId : cb.entries[id].book === bookId)) }))
    .filter(({ ids }) => ids.length);
  // The pages a scene recipe names: the shipping rule (`isSceneRecipe`), over this book's own cookbook.
  const scenePages = [
    ...new Set(
      cookbooks
        .filter(({ cb }) => cb.book?.id === bookId)
        .flatMap(({ cb }) => Object.values(cb.scenes ?? {}))
        .filter((row) => isSceneRecipe(row))
        .map((row) => Number(row.scene.page)),
    ),
  ].sort((a, b) => a - b);
  // The scene recipes of this book's own cookbook that carry a walls block: the shipping rule, `cookbookWalledScenes`'s.
  const wallScenes = cookbooks
    .filter(({ cb }) => cb.book?.id === bookId)
    .flatMap(({ cb }) => Object.entries(cb.scenes ?? {}))
    .filter(([, row]) => isSceneRecipe(row) && row.scene.walls)
    .map(([id, row]) => ({ id, recipe: row.scene }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const bytes = fs.readFileSync(file);
  const t0 = Date.now();
  const first = await openBook(bytes, { book: bookId });
  const sampled = Array.from({ length: 12 }, (_, i) => 1 + Math.floor((i * first.numPages) / 12));
  const placementPages = [...new Set([...scenePages, ...sampled])].sort((a, b) => a - b);
  const text = JSON.stringify(await parseDocument(first.doc, { book: bookId, src: srcArg ?? `shelf/${bookId}.pdf`, bytes: bytes.length, title: first.title, placementPages, wallScenes, trace: traceOnNode }));
  await releaseDoc(first.doc);
  const secondOpen = await openBook(bytes, { book: bookId });
  const again = JSON.stringify(await parseDocument(secondOpen.doc, { book: bookId, src: srcArg ?? `shelf/${bookId}.pdf`, bytes: bytes.length, title: secondOpen.title, placementPages, wallScenes, trace: traceOnNode }));
  await releaseDoc(secondOpen.doc);
  const digest = createHash("sha256").update(text).digest("hex");
  const deterministic = text === again;
  console.log(`book ${bookId}: ${first.numPages}pp parsed in ${Math.round((Date.now() - t0) / 1000)}s (two opens), ${(text.length / 1048576).toFixed(1)} MB, stamp ${PARSE_STAMP}`);
  console.log(`  sha256 ${digest}`);
  console.log(`  second parse from another open: ${deterministic ? "identical" : "DIFFERENT"}`);
  if (!deterministic) failures++;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${bookId}-${PARSE_STAMP}.json`), text);
  }

  const saved = new SavedBook(JSON.parse(text));
  const live = (await openBook(bytes, { book: bookId })).doc;

  // Every page.
  let pageBad = 0;
  const badPages = [];
  const pairing = fontPairing();
  const savedHandle = handleOver(saved, live, bookId);
  for (let n = 1; n <= saved.numPages; n++) {
    const rawA = await pageItems(live, n);
    const rawB = await pageItems(savedHandle, n);
    const d = firstDiff(canon(rawA), canon(rawB));
    if (d) {
      pageBad++;
      if (badPages.length < 10) badPages.push(`p${n}${d}`);
    } else pairing.add(rawA, rawB);
  }
  console.log(`  pageItems: ${saved.numPages - pageBad}/${saved.numPages} pages equal${pageBad ? ` — DIFFER: ${badPages.join(", ")}` : ""}`);
  console.log(`  fonts: ${pairing.fonts} live names, ${pairing.broken.length ? `NOT one-to-one: ${pairing.broken.slice(0, 5).join(", ")}` : "one-to-one with the saved names"}`);
  failures += pageBad + pairing.broken.length;

  // Every saved page's placements.
  let placeBad = 0;
  let placeImages = 0;
  const badPlaces = [];
  for (const n of placementPages) {
    const mine = saved.placements(n);
    const boxes = (await placementsOfPage(await live.getPage(n))).map(({ x, y, w, h }) => ({ x, y, w, h }));
    const viaHandle = await pageArtPlacements(savedHandle, n);
    placeImages += boxes.length;
    const d = firstDiff(canon(boxes), canon(mine)) ?? firstDiff(canon(boxes), canon(viaHandle));
    if (d) {
      placeBad++;
      if (badPlaces.length < 10) badPlaces.push(`p${n}${d}`);
    }
  }
  console.log(`  placements: ${placementPages.length - placeBad}/${placementPages.length} pages equal (${scenePages.length} scene page(s), ${placeImages} image(s) in all)${placeBad ? ` — DIFFER: ${badPlaces.join(", ")}` : ""}`);
  failures += placeBad;

  // Every walled scene's saved trace.
  const walled = JSON.parse(text).walls;
  let wallBad = 0;
  let wallCount = 0;
  const badWalls = [];
  const walkCalls = { live: 0 };
  const walkHandle = handleOver(saved, live, bookId, walkCalls);
  const walkLive = (doc, recipe) => withCanvas(() => traceRecipeWalls(doc, recipe));
  for (const { id, recipe } of wallScenes) {
    const inputs = wallTraceInputs(recipe);
    const fresh = await traceOnNode(live, recipe);
    const mine = saved.walls(id, inputs);
    walkCalls.live = 0;
    const asked = await sceneWallTrace(walkHandle, id, recipe, walkLive);
    const askedLive = walkCalls.live;
    const threshold = recipe.walls.threshold < 254 ? recipe.walls.threshold + 1 : recipe.walls.threshold - 1;
    const edited = { ...recipe, walls: { ...recipe.walls, threshold } };
    const reached = await sceneWallTrace(walkHandle, id, edited, walkLive);
    const d =
      (!fresh ? "no live trace" : null) ??
      firstDiff(canon(fresh), canon(mine)) ??
      (asked.saved ? null : "not answered from the saved file") ??
      firstDiff(canon(fresh), canon(asked.traced)) ??
      (askedLive === 0 ? null : "the live document was asked for") ??
      (!reached.saved && walkCalls.live > 0 ? null : "an edited recipe was answered from the saved file");
    wallCount += fresh?.walls.length ?? 0;
    if (d) {
      wallBad++;
      if (badWalls.length < 10) badWalls.push(`${id}${d}`);
    }
  }
  console.log(`  walls: ${wallScenes.length - wallBad}/${wallScenes.length} walled recipes equal, live trace vs saved vs handle (${wallCount} wall segment(s) in all, ${Object.keys(walled).length} saved, the live document never asked for on a saved scene, an edited recipe traced live)${wallBad ? ` — DIFFER: ${badWalls.join(", ")}` : ""}`);
  failures += wallBad + (Object.keys(walled).length === wallScenes.length ? 0 : 1);

  // Every entry's node, through the shipping executor.
  const skipOps = ["art", "ocr"];
  const liveCache = new Map();
  const savedCache = new Map();
  const savedDoc = handleOver(saved, live, bookId);
  let total = 0;
  let bad = 0;
  const badIds = [];
  for (const { cb, ids } of cookbooks) {
    for (const id of ids) {
      total++;
      const a = await executeEntry(live, cb, registers, id, { skipOps, pageCache: liveCache });
      const b = await executeEntry(savedDoc, cb, registers, id, { skipOps, pageCache: savedCache });
      const d = firstDiff(canon({ ok: a.ok, reason: a.reason, fields: a.fields, misses: a.misses }), canon({ ok: b.ok, reason: b.reason, fields: b.fields, misses: b.misses }));
      if (d) {
        bad++;
        if (badIds.length < 10) badIds.push(`${id}${d}`);
      }
    }
  }
  console.log(`  entries: ${total - bad}/${total} nodes equal across ${cookbooks.length} cookbook file(s)${bad ? ` — DIFFER: ${badIds.join(", ")}` : ""} (art and ocr skipped on both sides)`);
  failures += bad;
  await releaseDoc(live);
}

if (!ran) {
  console.log("no reference PDF found: nothing checked");
  process.exit(0);
}
console.log(failures ? `FAIL: ${failures} difference(s)` : "PASS: the saved text reads as the PDF reads");
process.exit(failures ? 1 : 0);
