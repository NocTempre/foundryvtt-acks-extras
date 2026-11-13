/**
 * Cookbook runtime: reading one entry off the seat's own book for an import or a repair, the passed-over tally, the per-run page cache.
 * The facade ../cookbook.mjs re-exports what the rest of the module imports by name.
 */
import { MODULE_ID } from "../constants.mjs";
import { repairWrite } from "../refresh.mjs";
import { executeEntry } from "../executor.mjs";
import { data, ctx, cookbookEntry, bookOf } from "./state.mjs";

/**
 * Write a fresh read of `id` over one imported document: execute the entry on
 * this seat, bind it with `build(node)`, and write the build under `policy`
 * (`repairWrite`). Resolves to the written plan, or to why nothing was
 * written — `book-closed` when the entry's book is not open here, `no-match`
 * when its page no longer matches, `error` when the binding threw. The
 * tally's `decision`, or its force, says what becomes of a hand-written
 * description.
 */
export async function repairFromEntry(doc, id, build, policy, tally = null) {
  const found = cookbookEntry(id);
  const session = found ? ctx.sessionDocs.get(bookOf(found)) : null;
  if (!session) return "book-closed";
  const node = await executeEntry(session.doc, found.cb, data.registers, id).catch(() => null);
  if (!node?.ok) return "no-match";
  let built;
  try {
    built = await build(node);
  } catch (err) {
    console.error(`${MODULE_ID} | repair ${id}: the binding failed`, err);
    return "error";
  }
  return repairWrite(doc, built, policy, tally);
}

/**
 * Read one entry off the seat's own book for an import: `{node}` when the
 * page yielded one, else `{node: null, reason}` — `book-closed` when the
 * entry's book is not open here, `no-match` when its page no longer matches
 * the cookbook. An import creates nothing from a null node: a document built
 * from the entry's shape alone reads as the thing on every sheet, and a book
 * opened later imports what was passed over, since every import steps over
 * what the world holds and builds the rest. `opts` is `executeEntry`'s.
 */
export async function readForImport(id, opts = {}) {
  const found = cookbookEntry(id);
  const session = found ? ctx.sessionDocs.get(bookOf(found)) : null;
  if (!session) return { node: null, reason: "book-closed" };
  const node = await executeEntry(session.doc, found.cb, data.registers, id, opts);
  return node?.ok ? { node, reason: null } : { node: null, reason: "no-match" };
}

/**
 * What an import run passed over with nothing read, counted by
 * `readForImport`'s reason. `count` records one and returns null, so a build
 * returns it; `lines` says each count in a notice's words, and `clause` is
 * those lines ready to follow a notice's own counts.
 */
export function passedOver() {
  const counts = { "book-closed": 0, "no-match": 0 };
  return {
    count(reason) {
      if (reason in counts) counts[reason]++;
      return null;
    },
    get closed() {
      return counts["book-closed"];
    },
    get unmatched() {
      return counts["no-match"];
    },
    get lines() {
      const out = [];
      if (counts["book-closed"]) out.push(`${counts["book-closed"]} passed over — their book is not open on this seat`);
      if (counts["no-match"]) out.push(`${counts["no-match"]} passed over — their page did not match the cookbook`);
      return out;
    },
    get clause() {
      return this.lines.map((l) => `; ${l}`).join("");
    },
  };
}

/**
 * One page cache per BOOK, living exactly as long as one bulk run.
 * `executeEntry` caches pages only for the duration of a single call, which
 * re-extracts the same page for every entry printed on it. Nothing here
 * outlives the run — a session-long cache would hold every page of every
 * opened book for as long as the world is up.
 * See docs/importer/DECISIONS.md, "Writes are batched, because a write costs what the shelf already holds".
 *
 * @returns a `(bookId) => Map` to pass as `executeEntry`'s `opts.pageCache`
 */
export function runPageCache() {
  const perBook = new Map();
  return (bookId) => {
    if (!perBook.has(bookId)) perBook.set(bookId, new Map());
    return perBook.get(bookId);
  };
}
