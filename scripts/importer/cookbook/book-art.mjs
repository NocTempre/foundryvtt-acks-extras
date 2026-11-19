/**
 * Cookbook runtime: a book's pictures as world art. Each open book whose
 * manifest entry declares a `bookArt` recipe has its pictures cut from the
 * Judge's own copy into the world's art directory, and the rows that name them
 * written into the `bookArt` registry document a treasure card reads
 * (`scripts/lib/book-art.mjs`). The pure half is `../book-art-binding.mjs`;
 * the facade ../cookbook.mjs re-exports what the rest of the module imports by
 * name.
 */
import { MODULE_ID, LANG_PREFIX } from "../constants.mjs";
import { progressBar } from "../progress.mjs";
import * as services from "../../lib/services.mjs";
import { getLayer, PRIORITY } from "../../lib/tables.mjs";
import { BOOK_ART_DOC } from "../../lib/book-art.mjs";
import { BOOK_CODE } from "../books/index.mjs";
import {
  booksWithArt, bookOfArtClaim, planBookArt, bookArtRows, bookArtDoc, refusedArtRows,
} from "../book-art-binding.mjs";
import { ctx, bookLabel } from "./state.mjs";

/** How long one picture may take before it counts as not found. */
const PICTURE_MS = 30000;

/**
 * The import kind of a book's art table (`IMPORT_KINDS`, `import-kinds.mjs`):
 * one claim per manifest book that declares art, `<book>.bookArt`, present
 * when the WORLD layer holds that book's table. It writes no document, so it
 * has no type, and its run takes the books.
 */
export const BOOK_ART_SOURCE = {
  key: "BookArt",
  type: null,
  idsRefill: "cookbookImportBookArt",
  // The entry picker offers no row: its typeless path is the rules tables' ids refill, and
  // re-running the step is this kind's repair (no per-picture rebuild in v1).
  entries: () => [],
  owns: (claim) => bookOfArtClaim(claim) !== null,
  book: (claim) => bookOfArtClaim(claim),
  make: { run: "cookbookImportBookArt", takes: ["books"] },
  chain: "stepBookArt",
  present: (claim) => {
    const book = bookOfArtClaim(claim);
    return !!book && Array.isArray(getLayer(BOOK_ART_DOC, PRIORITY.WORLD)?.tables?.[book]);
  },
};

/**
 * One picture through the context's uploader, bounded at 30 s: `{path, cached}`
 * when it came back, else `{reason}` (`no-uploader`, `timeout`, `error`,
 * `not-found`).
 */
async function fetchPicture(doc, pic) {
  const upload = ctx?.uploadBookPicture;
  if (typeof upload !== "function") return { reason: "no-uploader" };
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ reason: "timeout" }), PICTURE_MS);
  });
  try {
    const got = await Promise.race([
      Promise.resolve()
        .then(() => upload(doc, { stem: pic.stem, page: pic.page, box: pic.box, size: pic.size }))
        .then((r) => r ?? { reason: "not-found" })
        .catch(() => ({ reason: "error" })),
      timeout,
    ]);
    return got?.path ? got : { reason: got?.reason ?? "not-found" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The book-art step. For each open book with art (narrowed to `books` when
 * given), one progress bar fetches every picture once; each use of a picture
 * that came back becomes a row, and this run's rows replace that book's table
 * in the WORLD `bookArt` document, every other book's kept. A book that is not
 * open is left untouched; so is a book none of whose pictures resolved (a
 * wrong printing, or no uploader), and the Judge is warned. Quiet when no open
 * book has art. One notification counts the pictures written, reused, and not
 * found on this copy; the console lists the ordinals missed with their reasons.
 * GM only.
 * @returns {Promise<{written: number, reused: number, missed: number, books: string[], untouched: string[]}>}
 */
export async function cookbookImportBookArt({ books = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);
  const wanted = books ? new Set(books) : null;
  const jobs = booksWithArt()
    .filter((id) => ctx?.sessionDocs?.has(id) && (!wanted || wanted.has(id)))
    .map((id) => ({ bookId: id, planned: planBookArt(id, BOOK_CODE[id].bookArt) }))
    .filter((job) => job.planned.length);
  const counts = { written: 0, reused: 0, missed: 0, books: [], untouched: [] };
  if (!jobs.length) return counts;
  const noUploader = typeof ctx?.uploadBookPicture !== "function";
  let layer = getLayer(BOOK_ART_DOC, PRIORITY.WORLD) ?? null;
  const start = layer;
  for (const { bookId, planned } of jobs) {
    const doc = ctx.sessionDocs.get(bookId)?.doc ?? null;
    const results = new Map();
    const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressBookArt`), planned.length);
    try {
      for (const pic of planned) {
        bar.step(pic.id);
        results.set(pic.n, await fetchPicture(doc, pic));
      }
    } finally {
      bar.finish();
    }
    const missed = [];
    for (const pic of planned) {
      const r = results.get(pic.n);
      if (!r?.path) missed.push(`art${pic.n} (${r?.reason ?? "not-found"})`);
      else if (r.cached) counts.reused++;
      else counts.written++;
    }
    counts.missed += missed.length;
    if (missed.length) console.warn(`${MODULE_ID} | book art ${bookId}: not found on this copy: ${missed.join(", ")}`);
    let rows = bookArtRows(bookId, planned, results);
    const refused = refusedArtRows(rows);
    if (refused.length) {
      console.error(`${MODULE_ID} | book art ${bookId}: rows refused by the row check`, refused);
      const bad = new Set(refused.map((r) => r.i));
      rows = rows.filter((_, i) => !bad.has(i));
    }
    if (!rows.length) {
      counts.untouched.push(bookId);
      continue;
    }
    layer = bookArtDoc(layer, bookId, rows);
    counts.books.push(bookId);
  }
  const svc = services.get("ruledata-import");
  if (layer !== start) {
    if (svc) await svc.importDoc(layer, { priority: PRIORITY.WORLD, source: MODULE_ID });
    else {
      console.error(`${MODULE_ID} | book art: no ruledata-import service; nothing written.`);
      counts.untouched.push(...counts.books.splice(0));
    }
  }
  const parts = [game.i18n.format(`${LANG_PREFIX}.bookArt.done`, counts)];
  if (counts.untouched.length) parts.push(game.i18n.format(`${LANG_PREFIX}.bookArt.untouched`, { books: counts.untouched.map(bookLabel).join(", ") }));
  if (noUploader) parts.push(game.i18n.localize(`${LANG_PREFIX}.bookArt.noUploader`));
  ui.notifications[counts.missed || counts.untouched.length ? "warn" : "info"](`${MODULE_ID} | ${parts.join(" ")}`);
  return counts;
}
