/**
 * DEV-ONLY: harvest the Lairs & Encounters lair listings into proposed
 * register rows.
 *
 * Reads the Judge's own copy (the LOCAL-ONLY reference printing) and, for the
 * listings of Chapter 3, finds each one's heading by the same key the compiler
 * anchors on (`axHeadingKeys`, `printKey`), its first and last page, and the
 * plate its "Full ... Lair on p. N" pointer names. Nothing it reads is written
 * into a tracked file: a row is an ordinal, a hash locator and page numbers,
 * and the report names a heading only on stdout and in the `--out` file, which
 * belongs in a scratch folder.
 *
 * - **Listings and numbering.** The outline's depth-2 items under the chapter
 *   are the listings; its depth-1 item is the container the how-to prose
 *   opens. Every heading of the chapter's pages must answer to one outline
 *   item and the reverse, or the run stops. A listing's number is its place in
 *   print order: pages ascending, left column before right, top to bottom.
 * - **Last page.** A listing's flow ends at the next heading, so its last page
 *   is that heading's page when any body-size run of the listing precedes it
 *   there, and the page before when none does.
 * - **Plates.** A pointer is paired to the listing whose title it names: the
 *   same letters, else within a few edits, else all its words among the
 *   title's. A stem that names two listings only partly, or none, falls back
 *   to the heading above it and is reported as positional. The map a pointer
 *   captions can float above its own heading or beyond the next one, so
 *   position alone is never trusted where a name answers.
 * - **Proposed `meta.of`.** The ACKS II monster whose name is the listing's,
 *   or the one the Compatibility Guide's conversion table renames it to, or a
 *   reordering of its words; the nearest names by shared words follow. A
 *   proposal is a lead for the author, never a row's value.
 *
 * `--decisions <file>` carries the author's rulings, keyed by hash and by
 * pointer so no name is in it: `{"pairs": {"<pointer page>:<plate>": "<hash>"},
 * "of": {"<hash>": "mm.<id>" | null}}`. A pair overrides the proposal; `of`
 * is the only source of a row's `meta.of`. `--register <dir>` writes the
 * register files (the container and every listing, split by page range), and
 * removes the `*-lairs.json` files it did not write.
 *
 * Usage: node tools/importer/harvest-lairs.mjs [--out <file>]
 *          [--decisions <file>] [--register <dir>]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBook } from "../../scripts/importer/extract.mjs";
import { foldLabel, printKey } from "../../scripts/importer/printed-name.mjs";
import { axHeadingKeys, axPageItems, useAxBands } from "./compile-cookbook.mjs";
import { FILES } from "./reference-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTER = path.join(HERE, "..", "..", "register");
const BOOK = "le";
const SPACE = "le.lairs";
/** The largest run height body prose is set at (compile-cookbook's `AX_BODY_MAX_H`). */
const BODY_MAX_H = 10.6;
/** A pointer: "<stem> Lair on p. NNN", the stem opening "Full". */
const POINTER = /^(.*?)\s*lair\s*(?:map\s*)?(?:on|see|,)?\s*p\.?\s*(\d{3})\b/i;
/** Listings per register file. */
const CHUNK = 28;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? null : args[i + 1];
};
const outFile = flag("--out");
const decisions = flag("--decisions") ? JSON.parse(fs.readFileSync(flag("--decisions"), "utf8")) : { pairs: {}, of: {} };
const registerDir = flag("--register");

/** Levenshtein distance of two short strings. */
function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
const wordsOf = (s) => String(s).toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").split(/[^a-z0-9]+/).filter(Boolean);
const stemWord = (w) => w.replace(/(?:es|s)$/, "");

const file = FILES[BOOK];
if (!file || !fs.existsSync(file)) {
  console.error(`no local PDF for book "${BOOK}" (expected ${file})`);
  process.exit(2);
}
const { doc } = await openBook(fs.readFileSync(file), { book: BOOK });
useAxBands(doc, BOOK);

// The outline: the chapter's depth-1 container and its depth-2 listings.
const outline = [];
async function walk(items, depth) {
  for (const it of items ?? []) {
    let page = null;
    try {
      const dest = typeof it.dest === "string" ? await doc.getDestination(it.dest) : it.dest;
      if (dest) page = (await doc.getPageIndex(dest[0])) + 1;
    } catch {
      page = null;
    }
    outline.push({ depth, title: it.title, page });
    await walk(it.items, depth + 1);
  }
}
await walk(await doc.getOutline(), 0);
const chapterAt = outline.findIndex((o) => o.depth === 0 && /^Chapter\s*3\b/i.test(o.title));
if (chapterAt < 0) throw new Error("harvest-lairs: no Chapter 3 in the outline");
const nextAt = outline.findIndex((o, i) => i > chapterAt && o.depth === 0);
const chapter = outline.slice(chapterAt + 1, nextAt < 0 ? undefined : nextAt);
const containers = chapter.filter((o) => o.depth === 1);
const listed = chapter.filter((o) => o.depth === 2);
const firstPage = chapter[0].page;
const endPage = outline[nextAt].page; // the next chapter's page ends the last flow
console.log(`outline: ${chapter.length} items under the chapter: ${containers.length} depth-1, ${listed.length} depth-2 (listings); pages ${firstPage}..${endPage - 1}`);
if (containers.length !== 1) throw new Error("harvest-lairs: expected exactly one depth-1 container");

// Every heading of the chapter's pages, in print order, with the page's body runs.
const pages = new Map();
const heads = [];
for (let p = firstPage; p <= endPage; p++) {
  const pd = await axPageItems(doc, p);
  pages.set(p, pd);
  for (const h of axHeadingKeys(pd, {})) heads.push({ page: p, col: h.x0 < pd.width / 2 ? 0 : 1, y: h.y, hash: h.hash });
}
const order = (a, b) => a.page - b.page || a.col - b.col || a.y - b.y;
heads.sort(order);
const terminator = heads.pop(); // the next chapter's own heading, the first on its page
if (terminator.page !== endPage) throw new Error("harvest-lairs: the next chapter's heading is not where the outline says");

const byHash = new Map();
for (const o of [...containers, ...listed]) {
  const k = printKey(o.title);
  if (byHash.has(k)) throw new Error(`harvest-lairs: two outline items share a key (pages ${byHash.get(k).page} and ${o.page})`);
  byHash.set(k, o);
}
const seen = new Set();
for (const h of heads) {
  if (seen.has(h.hash)) throw new Error(`harvest-lairs: two headings share the key ${h.hash} (p.${h.page})`);
  seen.add(h.hash);
  h.item = byHash.get(h.hash);
}
const unmatched = heads.filter((h) => !h.item);
const missing = [...byHash.values()].filter((o) => !heads.some((h) => h.item === o));
console.log(`headings: ${heads.length} on the chapter's pages, ${unmatched.length} with no outline item, ${missing.length} outline items with no heading`);
if (unmatched.length || missing.length) {
  for (const h of unmatched) console.log(`  unmatched heading ${h.hash} p.${h.page}`);
  for (const o of missing) console.log(`  unmatched outline item "${o.title}" p.${o.page}`);
  process.exit(1);
}

/** Whether a body-size run of the flow stands on `page`, before the heading `next` when one is given. */
function bodyBefore(page, next) {
  const pd = pages.get(page);
  const top = pd.axBands?.topBand ?? 60;
  const foot = pd.axBands?.footY ?? 750;
  return pd.items.some((it) => {
    if (it.h > BODY_MAX_H || !it.str.trim() || it.y <= top || it.y >= foot) return false;
    if (!next) return true;
    const col = it.x < pd.width / 2 ? 0 : 1;
    return col < next.col || (col === next.col && it.y < next.y - 4);
  });
}

// The container and the listings, in print order; the next heading closes each.
const container = heads.find((h) => h.item === containers[0]);
const listings = [];
heads.forEach((h, i) => {
  const next = heads[i + 1] ?? terminator;
  let last = h.page;
  for (let p = next.page; p > h.page && last === h.page; p--) if (bodyBefore(p, p === next.page ? next : null)) last = p;
  const row = { start: h.page, last, col: h.col, y: h.y, hash: h.hash, title: h.item.title };
  if (h === container) container.pages = [h.page, last];
  else listings.push(row);
});
if (heads.indexOf(container) !== 0) throw new Error("harvest-lairs: the container is not the first heading");
listings.forEach((l, i) => {
  l.n = i + 1;
  l.id = `${BOOK}.lair${l.n}`;
  l.pages = Array.from({ length: l.last - l.start + 1 }, (_, k) => l.start + k);
});
if (listings.length !== listed.length) throw new Error("harvest-lairs: a listing is missing from the headings");

// The pointers and the plates they name.
const pointers = [];
for (let p = firstPage; p < endPage; p++) {
  const pd = pages.get(p);
  for (const it of pd.items) {
    const m = POINTER.exec(it.str.trim());
    if (!m || Number(m[2]) < endPage) continue;
    pointers.push({ page: p, col: it.x + it.w / 2 < pd.width / 2 ? 0 : 1, y: it.y, plate: Number(m[2]), stem: foldLabel(m[1].replace(/^full\s*/i, "")), words: wordsOf(m[1].replace(/^full\s*/i, "")) });
  }
}
pointers.sort(order);
for (const q of pointers) {
  q.key = `${q.page}:${q.plate}`;
  const forced = decisions.pairs?.[q.key];
  const exact = listings.filter((l) => foldLabel(l.title) === q.stem);
  const near = listings.filter((l) => editDistance(foldLabel(l.title), q.stem) <= Math.max(1, Math.floor(q.stem.length / 4)));
  const nearBest = Math.min(...near.map((l) => editDistance(foldLabel(l.title), q.stem)));
  const nearOne = near.filter((l) => editDistance(foldLabel(l.title), q.stem) === nearBest);
  const sub = listings.filter((l) => q.words.every((w) => wordsOf(l.title).map(stemWord).includes(stemWord(w))));
  let hit = null;
  if (forced) [hit, q.tier] = [listings.find((l) => l.hash === forced), "decided"];
  else if (exact.length === 1) [hit, q.tier] = [exact[0], "named"];
  else if (nearOne.length === 1) [hit, q.tier] = [nearOne[0], "near-spelling"];
  else if (sub.length === 1) [hit, q.tier] = [sub[0], "words-within"];
  else {
    const above = listings.filter((l) => order({ page: l.start, col: l.col, y: l.y }, q) <= 0);
    [hit, q.tier] = [above[above.length - 1], "positional"];
  }
  q.listing = hit;
}

// Proposed meta.of: names from the register's ACKS II monsters and the conversion pairs.
const mmRows = [];
for (const f of fs.readdirSync(path.join(REGISTER, "mm")).filter((x) => x.endsWith(".json"))) {
  for (const r of JSON.parse(fs.readFileSync(path.join(REGISTER, "mm", f), "utf8"))) {
    if (r.kind === "kind.monster" || r.kind === "kind.monsterTemplate") mmRows.push(r);
  }
}
const mmByFold = new Map(mmRows.map((r) => [foldLabel(r.name), r]));
const conversion = JSON.parse(fs.readFileSync(path.join(REGISTER, "_refs", "conversion.json"), "utf8")).table;
const convByFold = new Map(Object.entries(conversion).filter(([, v]) => v.category === "monster").map(([k, v]) => [foldLabel(k), v]));
const STOP = new Set(["giant", "common", "greater", "lesser", "men", "man", "npc", "of", "the"]);
for (const l of listings) {
  const props = [];
  const add = (r, route) => r && !props.some((p) => p.id === r.id) && props.push({ id: r.id, route });
  add(mmByFold.get(foldLabel(l.title)), "same-name");
  const c = convByFold.get(foldLabel(l.title));
  if (c?.status === "renamed") add(mmByFold.get(foldLabel(c.to)), "conversion");
  else if (c) props.push({ id: null, route: `conversion-${c.status}` });
  const ws = wordsOf(l.title);
  if (ws.length === 2) add(mmByFold.get(foldLabel(`${ws[1]} ${ws[0]}`)), "reordered");
  const mine = new Set(ws.map(stemWord).filter((w) => !STOP.has(w)));
  const near = mmRows
    .map((r) => ({ id: r.id, shared: wordsOf(r.name).map(stemWord).filter((w) => mine.has(w)).length }))
    .filter((r) => r.shared > 0)
    .sort((a, b) => b.shared - a.shared)
    .slice(0, 5)
    .map((r) => r.id);
  l.proposals = props;
  l.near = near;
  l.of = decisions.of?.[l.hash] ?? null;
  l.plates = pointers.filter((q) => q.listing === l);
}

const rows = listings.map((l) => ({
  id: l.id, n: l.n, hash: l.hash, title: l.title, pages: [l.start, l.last], proposals: l.proposals, near: l.near, of: l.of,
  plates: l.plates.map((q) => ({ pointerPage: q.page, plate: q.plate, tier: q.tier, outsidePages: !l.pages.includes(q.page) })),
}));
const tiers = {};
for (const q of pointers) tiers[q.tier] = (tiers[q.tier] ?? 0) + 1;
console.log(`listings: ${listings.length}; container hash ${container.hash} pages ${container.pages.join("-")}`);
console.log(`pointers: ${pointers.length} to ${new Set(pointers.map((q) => q.plate)).size} plate pages; tiers ${JSON.stringify(tiers)}`);
console.log(`listings with a plate: ${rows.filter((r) => r.plates.length).length}; a pointer outside its listing's pages: ${rows.filter((r) => r.plates.some((p) => p.outsidePages)).length}`);
console.log(`listings with a proposal: ${rows.filter((r) => r.proposals.some((p) => p.id)).length}; with an authored meta.of: ${rows.filter((r) => r.of).length}`);
for (const q of pointers.filter((x) => x.tier !== "named")) console.log(`  pointer ${q.key} (${q.tier}) -> ${q.listing.id}`);
if (outFile) {
  fs.writeFileSync(outFile, JSON.stringify({ container: { hash: container.hash, pages: container.pages }, rows }, null, 1) + "\n");
  console.log(`wrote ${outFile}`);
}

if (registerDir) {
  const dir = path.resolve(registerDir);
  const written = new Set();
  for (let at = 0; at < listings.length; at += CHUNK) {
    const part = listings.slice(at, at + CHUNK);
    const out = [];
    if (at === 0) {
      out.push({ id: SPACE, kind: "kind.location", book: BOOK, name: "Lairs", anchor: { hash: container.hash }, pages: container.pages[0] === container.pages[1] ? [container.pages[0]] : container.pages });
    }
    for (const l of part) {
      out.push({
        id: l.id, kind: "kind.location", book: BOOK, name: `Lair ${l.n}`, anchor: { hash: l.hash }, pages: l.pages,
        meta: { space: SPACE, parent: SPACE, ...(l.of ? { of: l.of } : {}) },
      });
    }
    const name = `p${at === 0 ? container.pages[0] : part[0].start}-p${part[part.length - 1].last}-lairs.json`;
    fs.writeFileSync(path.join(dir, name), JSON.stringify(out, null, 2) + "\n");
    written.add(name);
  }
  for (const f of fs.readdirSync(dir)) if (f.endsWith("-lairs.json") && !written.has(f)) fs.rmSync(path.join(dir, f));
  console.log(`register: ${[...written].join(", ")}`);
}
