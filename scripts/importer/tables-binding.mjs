/**
 * Table import binding: materialize ruledata tables from the seat's connected
 * PDFs and hand them to the acks-lib `ruledata-import` contract (provider:
 * acks-location) at world priority. Sibling modules (acks-henchmen) then read
 * them from `acksLib.tables`. No values ship — they are read here, live, from
 * the reader's book and persist only in their world.
 *
 * Tables MERGE into any doc already imported, so coverage can grow one book /
 * one table at a time without dropping what is already present.
 */
import { pageItems } from "./extract.mjs";
import { extractTable, pdfGuess } from "./table-extract.mjs";
import { TABLE_RECIPES } from "./table-recipes.mjs";
import { BOOKS } from "./books.mjs";
import { recipeCite } from "./produces.mjs";
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { getLayer, PRIORITY } from "../lib/tables.mjs";

/**
 * The PDF page whose text holds `recipe.locate`, searched outward from
 * `pdfGuess` and then through the whole book; null when no page holds it.
 */
export async function locatePageNumber(doc, recipe) {
  const guess = pdfGuess(recipe);
  const order = [];
  for (let d = 0; d <= (recipe.searchRadius ?? 12); d++) {
    if (guess + d <= doc.numPages) order.push(guess + d);
    if (d && guess - d >= 1) order.push(guess - d);
  }
  const seen = new Set(order);
  for (let p = 1; p <= doc.numPages; p++) if (!seen.has(p)) order.push(p);
  const bare = (s) => String(s).replace(/\s+/g, "").toLowerCase();
  for (const p of order) {
    const { items } = await pageItems(doc, p);
    const hit = recipe.locateBare
      ? bare(items.map((i) => i.str).join("")).includes(bare(recipe.locate))
      : items.map((i) => i.str).join(" ").includes(recipe.locate);
    if (hit) return p;
  }
  return null;
}

/** The located page's items; with `pageSpan`, one items array per page of the span. */
async function locatePage(doc, recipe) {
  const p = await locatePageNumber(doc, recipe);
  if (p == null) return null;
  const { items } = await pageItems(doc, p);
  if (!recipe.pageSpan) return items;
  // Multi-page tables (the JJ occupation packages) merge the span.
  const span = [items];
  for (let k = 1; k < recipe.pageSpan && p + k <= doc.numPages; k++) span.push((await pageItems(doc, p + k)).items);
  return span;
}

// The search each kind of block makes. A culture block's anchor is a list's
// first name, and its list may wrap onto the next page.
const blockLocate = (recipe, block) => ({ book: block.book ?? recipe.book, printedPage: block.printedPage, locate: block.anchor, pageSpan: 2 });
const subTableLocate = (recipe, st) => ({ book: recipe.book, printedPage: st.printedPage, locate: st.locate ?? st.anchor, locateBare: true });
const valueBlockLocate = (recipe, block) => ({ book: recipe.book, printedPage: block.printedPage, locate: block.locate, locateBare: true });

/**
 * Every page search one recipe makes, as `[{id, args}]`: `args` is what the
 * import hands `locatePage`, and `id` names the block (null for the recipe
 * itself).
 */
export function recipeLocates(recipe) {
  if (recipe.valueBlocks) return recipe.valueBlocks.map((b) => ({ id: b.id, args: valueBlockLocate(recipe, b) }));
  if (recipe.blocks) return recipe.blocks.map((b) => ({ id: b.cultureId, args: blockLocate(recipe, b) }));
  if (recipe.subTables) return recipe.subTables.map((st) => ({ id: st.id, args: subTableLocate(recipe, st) }));
  return [{ id: null, args: recipe }];
}

/** Every book a table recipe or one of its blocks reads. */
export function tableRecipeBooks() {
  const books = new Set();
  for (const doc of Object.values(TABLE_RECIPES)) {
    for (const recipe of Object.values(doc.tables)) {
      if (recipe.book) books.add(recipe.book);
      for (const block of recipe.blocks ?? []) if (block.book ?? recipe.book) books.add(block.book ?? recipe.book);
    }
  }
  return books;
}

/**
 * The tables layer `P` holds for `docId`, less any the layers beneath it supply
 * identically. Such a table changes no read, and keeping it would freeze the
 * lower layer's copy: a module's sample could no longer update through it.
 */
export function ownTables(docId, P) {
  const beneath = {};
  for (const q of Object.values(PRIORITY).filter((x) => x < P).sort((a, b) => a - b)) {
    Object.assign(beneath, getLayer(docId, q)?.tables ?? {});
  }
  const same = (k, v) => k in beneath && JSON.stringify(beneath[k]) === JSON.stringify(v);
  return Object.fromEntries(Object.entries(getLayer(docId, P)?.tables ?? {}).filter(([k, v]) => !same(k, v)));
}

/**
 * How many table recipes a run works through — the denominator a caller needs
 * to draw a progress bar, without it having to know the recipe shape.
 *
 * @param {string[]|Set<string>} [only] ruledata document ids; omitted, every one.
 */
export const tableRecipeCount = (only = null) => {
  const pick = only ? new Set(only) : null;
  return Object.entries(TABLE_RECIPES).reduce(
    (n, [docId, doc]) => (pick && !pick.has(docId) ? n : n + Object.keys(doc.tables).length),
    0,
  );
};

/**
 * Read the ruledata tables from the connected books and merge each document
 * into the store's world layer.
 *
 * A recipe or culture block marked `optional` comes from a supplement: a book
 * it needs that is not open is reported apart from the books the core tables
 * need, so a seat without the supplement is told what it is missing rather
 * than warned.
 *
 * @param {Map} sessionDocs - bookId → { doc } for connected books
 * @param {object} [options]
 * @param {number} [options.priority] - acksLib table priority (default WORLD)
 * @param {(name: string) => void} [options.onProgress] - called once per recipe,
 *        found or not: locating a table scans pages until it hits, so a full run
 *        is minutes and the caller is the one holding the progress bar.
 * @param {string[]|Set<string>} [options.only] - ruledata document ids to read;
 *        omitted, every one. A subset is what makes re-reading ONE document
 *        affordable — a full run scans pages for every recipe there is.
 * @returns {Promise<{imported, missingBooks, optionalBooks, missingTables}>}
 *   `missingBooks` and `optionalBooks` are book labels; a book any required
 *   recipe needs is listed only as missing.
 */
export async function importTables(sessionDocs, { priority, onProgress, only = null } = {}) {
  const pick = only ? new Set(only) : null;
  const svc = services.get("ruledata-import");
  if (!svc) {
    throw new Error(`${MODULE_ID}: no ruledata-import provider — enable acks-location (the table host).`);
  }
  const P = priority ?? PRIORITY.WORLD;
  const report = { imported: [], missingBooks: new Set(), missingTables: [] };
  const optionalBooks = new Set();
  const bookMissing = (book, optional) => (optional ? optionalBooks : report.missingBooks).add(book);

  // Self-locating culture blocks: the anchor (a list's first name) finds the
  // page and print column; two-column reading order is stitched into one
  // virtual column so a list can wrap column→column→page.
  const runBlocks = async (recipe) => {
    const list = {};
    for (const block of recipe.blocks) {
      const bk = block.book ?? recipe.book;
      const session = sessionDocs.get(bk);
      if (!session?.doc) { bookMissing(bk, block.optional ?? recipe.optional); continue; }
      const span = await locatePage(session.doc, blockLocate(recipe, block));
      if (!span) { report.missingTables.push(`cultures.${block.cultureId} (page not found)`); continue; }
      const seg = (pg, side) => (pg ?? []).filter((it) => (side === "L" ? it.x >= 25 && it.x < 295 : it.x >= 295 && it.x < 585));
      const run = span[0].find((it) => it.str.includes(block.anchor));
      const startSide = run && run.x >= 295 ? 1 : 0;
      const flow = [[span[0], "L"], [span[0], "R"], [span[1], "L"], [span[1], "R"]].slice(startSide);
      const stitched = flow.flatMap(([pg, side], si) =>
        seg(pg, side).map((it) => ({ ...it, x: side === "R" ? it.x - 268 : it.x, y: it.y + si * 2000, _p2: si > 0 }))
      );
      const names = extractTable(stitched, { ...recipe, blocks: null, column: { xMin: 25, xMax: 320 }, startAfter: block.anchor });
      list[block.cultureId] = { ...block.meta, ...names };
    }
    return { list };
  };

  // Occupation sub-tables: window geometry is explicit per table (the JJ
  // mixes half-page pairs, quarter tables, and full-width layouts).
  const runSubTables = async (recipe) => {
    const categories = {};
    const session = sessionDocs.get(recipe.book);
    if (!session?.doc) { bookMissing(recipe.book, recipe.optional); return null; }
    for (const st of recipe.subTables) {
      const items = await locatePage(session.doc, subTableLocate(recipe, st));
      if (!items) { report.missingTables.push(`occupationSubTables.${st.id} (page not found)`); continue; }
      const windowed = items.filter((it) => it.x >= st.window[0] && it.x < st.window[1]);
      categories[st.id] = extractTable(windowed, { ...recipe, subTables: null, startAfter: st.anchor, bandWindow: st.bandWindow, occWindow: st.occWindow, specialWindow: st.specialWindow });
    }
    return { categories };
  };

  // Per-entity prose blocks (class restrictions): each block self-locates
  // its own page and contributes one keyed entry.
  const runValueBlocks = async (recipe) => {
    const out = {};
    const session = sessionDocs.get(recipe.book);
    if (!session?.doc) { bookMissing(recipe.book, recipe.optional); return null; }
    for (const block of recipe.valueBlocks) {
      const items = await locatePage(session.doc, valueBlockLocate(recipe, block));
      if (!items) continue; // a printing without that class simply omits it
      const got = extractTable(items, { ...recipe, valueBlocks: null, emit: null, values: block.values, column: block.column ?? recipe.column });
      if (Object.keys(got).length) out[block.id] = got;
    }
    return recipe.emit?.path?.length ? { [recipe.emit.path[0]]: out } : out;
  };

  for (const [docId, docRec] of Object.entries(TABLE_RECIPES)) {
    if (pick && !pick.has(docId)) continue;
    const fresh = {};
    // The blocks each gathered table actually read, so its citation names the
    // pages that were opened and not a supplement's that was not.
    const readBlocks = {};
    for (const [tableId, recipe] of Object.entries(docRec.tables)) {
      // Every path out of this body — imported, book missing, page not found,
      // extraction threw — has consumed one recipe's worth of the run, so the
      // report fires from a `finally` rather than being repeated at each exit.
      try {
        if (recipe.valueBlocks) {
          const out = await runValueBlocks(recipe);
          const got = out && (recipe.emit?.path?.length ? out[recipe.emit.path[0]] : out);
          if (got && Object.keys(got).length) {
            fresh[tableId] = out;
            readBlocks[tableId] = new Set(Object.keys(got));
          }
          continue;
        }
        if (recipe.blocks) {
          const out = await runBlocks(recipe);
          if (Object.keys(out.list).length) {
            fresh[tableId] = out;
            readBlocks[tableId] = new Set(Object.keys(out.list));
          }
          continue;
        }
        if (recipe.subTables) {
          const out = await runSubTables(recipe);
          if (out && Object.keys(out.categories).length) {
            fresh[tableId] = out;
            readBlocks[tableId] = new Set(Object.keys(out.categories));
          }
          continue;
        }
        const session = sessionDocs.get(recipe.book);
        if (!session?.doc) {
          bookMissing(recipe.book, recipe.optional);
          continue;
        }
        try {
          const items = await locatePage(session.doc, recipe);
          if (!items) {
            report.missingTables.push(`${docId}.${tableId} (page not found)`);
            continue;
          }
          fresh[tableId] = recipe.pageSpan
            ? Object.assign({}, ...items.map((pg) => extractTable(pg, recipe)))
            : extractTable(items, recipe);
        } catch (err) {
          report.missingTables.push(`${docId}.${tableId} (${err.message})`);
        }
      } finally {
        onProgress?.(`${docId}.${tableId}`);
      }
    }
    if (!Object.keys(fresh).length) continue;

    // Merge over what the import itself holds for this doc (its own layer,
    // `getLayer`), so partial coverage accumulates instead of replacing, and
    // no override or sample is carried into it. A kept table keeps the page it
    // was read from; a fresh one cites its recipe's.
    const existing = ownTables(docId, P);
    const prior = getLayer(docId, P)?.cites ?? {};
    const cites = Object.fromEntries(Object.keys(existing).filter((k) => prior[k]).map((k) => [k, prior[k]]));
    for (const tableId of Object.keys(fresh)) {
      const cite = recipeCite(docRec.tables[tableId], readBlocks[tableId]);
      if (cite) cites[tableId] = cite;
      else delete cites[tableId];
    }
    const doc = { id: docId, source: docRec.source, cites, tables: { ...existing, ...fresh } };
    await svc.importDoc(doc, { priority: P, source: MODULE_ID });
    report.imported.push({ docId, tables: Object.keys(fresh) });
  }
  const label = (b) => BOOKS[b]?.label ?? b;
  report.optionalBooks = [...optionalBooks].filter((b) => !report.missingBooks.has(b)).map(label);
  report.missingBooks = [...report.missingBooks].map(label);
  return report;
}
