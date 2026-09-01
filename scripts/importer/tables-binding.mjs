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
import { extractTable } from "./table-extract.mjs";
import { TABLE_RECIPES } from "./table-recipes.mjs";
import { BOOKS } from "./books.mjs";
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { hasDoc, getDoc, PRIORITY } from "../lib/tables.mjs";

async function locatePage(doc, recipe) {
  const guess = recipe.printedPage ?? recipe.pdfPage ?? 1;
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
    if (hit) {
      if (!recipe.pageSpan) return items;
      // Multi-page tables (the JJ occupation packages) merge the span.
      const span = [items];
      for (let k = 1; k < recipe.pageSpan && p + k <= doc.numPages; k++) span.push((await pageItems(doc, p + k)).items);
      return span;
    }
  }
  return null;
}

/**
 * How many table recipes a full run works through — the denominator a caller
 * needs to draw a progress bar, without it having to know the recipe shape.
 */
export const tableRecipeCount = () =>
  Object.values(TABLE_RECIPES).reduce((n, doc) => n + Object.keys(doc.tables).length, 0);

/**
 * @param {Map} sessionDocs - bookId → { doc } for connected books
 * @param {object} [options]
 * @param {number} [options.priority] - acksLib table priority (default WORLD)
 * @param {(name: string) => void} [options.onProgress] - called once per recipe,
 *        found or not: locating a table scans pages until it hits, so a full run
 *        is minutes and the caller is the one holding the progress bar.
 * @returns {Promise<{imported, missingBooks, missingTables}>}
 */
export async function importTables(sessionDocs, { priority, onProgress } = {}) {
  const svc = services.get("ruledata-import");
  if (!svc) {
    throw new Error(`${MODULE_ID}: no ruledata-import provider — enable acks-location (the table host).`);
  }
  const P = priority ?? PRIORITY.WORLD;
  const report = { imported: [], missingBooks: new Set(), missingTables: [] };

  // Self-locating culture blocks: the anchor (a list's first name) finds the
  // page and print column; two-column reading order is stitched into one
  // virtual column so a list can wrap column→column→page.
  const runBlocks = async (recipe) => {
    const list = {};
    for (const block of recipe.blocks) {
      const bk = block.book ?? recipe.book;
      const session = sessionDocs.get(bk);
      if (!session?.doc) { report.missingBooks.add(bk); continue; }
      const span = await locatePage(session.doc, { printedPage: block.printedPage, locate: block.anchor, pageSpan: 2 });
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
    if (!session?.doc) { report.missingBooks.add(recipe.book); return null; }
    for (const st of recipe.subTables) {
      const items = await locatePage(session.doc, { printedPage: st.printedPage, locate: st.locate ?? st.anchor, locateBare: true });
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
    if (!session?.doc) { report.missingBooks.add(recipe.book); return null; }
    for (const block of recipe.valueBlocks) {
      const items = await locatePage(session.doc, { printedPage: block.printedPage, locate: block.locate, locateBare: true });
      if (!items) continue; // a printing without that class simply omits it
      const got = extractTable(items, { ...recipe, valueBlocks: null, emit: null, values: block.values, column: block.column ?? recipe.column });
      if (Object.keys(got).length) out[block.id] = got;
    }
    return recipe.emit?.path?.length ? { [recipe.emit.path[0]]: out } : out;
  };

  for (const [docId, docRec] of Object.entries(TABLE_RECIPES)) {
    const fresh = {};
    for (const [tableId, recipe] of Object.entries(docRec.tables)) {
      // Every path out of this body — imported, book missing, page not found,
      // extraction threw — has consumed one recipe's worth of the run, so the
      // report fires from a `finally` rather than being repeated at each exit.
      try {
        if (recipe.valueBlocks) {
          const out = await runValueBlocks(recipe);
          if (out && Object.keys(out.classes ?? out).length) fresh[tableId] = out;
          continue;
        }
        if (recipe.blocks) {
          const out = await runBlocks(recipe);
          if (Object.keys(out.list).length) fresh[tableId] = out;
          continue;
        }
        if (recipe.subTables) {
          const out = await runSubTables(recipe);
          if (out && Object.keys(out.categories).length) fresh[tableId] = out;
          continue;
        }
        const session = sessionDocs.get(recipe.book);
        if (!session?.doc) {
          report.missingBooks.add(recipe.book);
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

    // Merge over whatever is already imported for this doc, so partial
    // coverage accumulates instead of replacing.
    const existing = hasDoc(docId) ? getDoc(docId).tables ?? {} : {};
    const doc = { id: docId, source: docRec.source, tables: { ...existing, ...fresh } };
    await svc.importDoc(doc, { priority: P, source: MODULE_ID });
    report.imported.push({ docId, tables: Object.keys(fresh) });
  }
  report.missingBooks = [...report.missingBooks].map((b) => BOOKS[b]?.label ?? b);
  return report;
}
