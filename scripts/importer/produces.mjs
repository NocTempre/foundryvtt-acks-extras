/**
 * Where an imported table was read, and what a binding makes of it.
 *
 * Every binding that assembles engine tables out of raw ones exports
 * `PRODUCES = { [docId]: { engineKey: rawKey | rawKey[] } }`. Two readers
 * take that one map: `tools/validate-producers.mjs`, which proves every table
 * a feature declares has something that writes it, and `assembledDoc` below,
 * which gives each assembled table the pages of the raw tables it was read
 * from. Pure — Node tests and the gate import it.
 */
import { BOOKS } from "./books.mjs";

/** One citation's book-and-pages part, `"RR p.272, 274-275"`. */
const CITE_PART = /^([A-Z0-9]+)\s*p\.\s*(.+)$/;

/** A page run longer than this is not a page list; it is left out rather than expanded. */
const MAX_RUN = 200;

/** Ascending pages as runs: `[229, 230, 231, 247]` → `"229-231, 247"`. */
function foldPages(pages) {
  const runs = [];
  for (const p of pages) {
    const last = runs[runs.length - 1];
    if (last && p === last[1] + 1) last[1] = p;
    else runs.push([p, p]);
  }
  return runs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(", ");
}

/**
 * Several citations as one: each book once, its pages merged and folded into
 * runs, books in first-seen order. A part that is not in the `"XX p.N"` form
 * is kept as written, once. Null when nothing is left.
 *
 * @param {Array<string|null|undefined>} cites
 * @returns {string|null}
 */
export function joinCites(cites) {
  const byBook = new Map();
  const loose = [];
  for (const cite of cites) {
    for (const raw of String(cite ?? "").split(/;\s*/)) {
      const part = raw.trim();
      if (!part) continue;
      const m = CITE_PART.exec(part);
      if (!m) {
        if (!loose.includes(part)) loose.push(part);
        continue;
      }
      const pages = byBook.get(m[1]) ?? new Set();
      for (const tok of m[2].split(/,\s*/)) {
        const r = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(tok.trim());
        if (!r) continue;
        const from = Number(r[1]);
        const to = Number(r[2] ?? r[1]);
        if (to < from || to - from > MAX_RUN) continue;
        for (let p = from; p <= to; p++) pages.add(p);
      }
      if (pages.size) byBook.set(m[1], pages);
    }
  }
  const parts = [...byBook].map(([book, pages]) => `${book} p.${foldPages([...pages].sort((a, b) => a - b))}`);
  return [...parts, ...loose].join("; ") || null;
}

/**
 * The printed page one table recipe reads, in the cookbook's citation form
 * (`"RR p.505"`): the recipe's own page, every page a span covers, or each
 * block's page for a table gathered from several. Null for a recipe that
 * names no printed page.
 *
 * @param {object} recipe one `TABLE_RECIPES` table spec
 * @param {Set<string>} [read] the block ids a run actually read; omitted,
 *        every block cites. A supplement's block that was never opened cites
 *        nothing.
 * @returns {string|null}
 */
export function recipeCite(recipe, read = null) {
  const cites = [];
  const took = (id) => !read || read.has(id);
  const add = (book, page, span = 1) => {
    const from = page == null || page === "" ? Number.NaN : Number(page);
    if (!book || !(from > 0)) return;
    const short = BOOKS[book]?.short ?? String(book).toUpperCase();
    cites.push(`${short} p.${span > 1 ? `${from}-${from + span - 1}` : from}`);
  };
  if (recipe?.blocks) {
    for (const b of recipe.blocks) if (took(b.cultureId)) add(b.book ?? recipe.book, b.printedPage);
  } else if (recipe?.subTables) {
    for (const st of recipe.subTables) if (took(st.id)) add(recipe.book, st.printedPage);
  } else if (recipe?.valueBlocks) {
    for (const b of recipe.valueBlocks) if (took(b.id)) add(recipe.book, b.printedPage);
  } else {
    add(recipe?.book, recipe?.printedPage, recipe?.pageSpan ?? 1);
  }
  return joinCites(cites);
}

/**
 * The document a binding writes back: its raw tables with the engine tables
 * beside them, and each engine table citing the pages of the raw tables
 * `from` (its entry in the binding's `PRODUCES`) names. An engine table whose
 * raw tables carry no page cites nothing rather than a stale page.
 *
 * @param {{id: string, source?: object, cites?: object, tables?: object}} doc the import's own layer
 * @param {object} engine the assembled tables, by key
 * @param {Record<string, string|string[]>} [from] engine key → the raw table key(s) it reads
 */
export function assembledDoc(doc, engine, from = {}) {
  const cites = { ...(doc.cites ?? {}) };
  for (const key of Object.keys(engine)) {
    const cite = joinCites([].concat(from[key] ?? []).map((raw) => doc.cites?.[raw]));
    if (cite) cites[key] = cite;
    else delete cites[key];
  }
  return { id: doc.id, source: doc.source, cites, tables: { ...(doc.tables ?? {}), ...engine } };
}
