/**
 * Does every description stop where the passage stops?
 *
 * `check-prose-boxes` asks whether a description STARTS in the right column.
 * Nothing asked the other half, and the other half is where the silent losses
 * are: a box whose last line is mid-sentence has thrown away the rest of the
 * passage, and the recipe still looks well-formed — the executor found text,
 * the text was prose, and a reader who does not own the book cannot tell the
 * ability was cut in half.
 *
 * The test is a clause-boundary comparison across the box's bottom edge. A
 * description is asked the question only when the answer is decidable: there
 * must be a body line immediately below the box, in the same column and x band,
 * that no other entry has claimed. Where the next line belongs to a neighbour,
 * or the column simply ends, the geometry says nothing about whether the
 * passage continued, and the entry gets NO VERDICT rather than a guess. That is
 * why the pass line reports how many descriptions reached a discrimination
 * rather than how many exist: most do not reach one.
 *
 * A stop is open only when both halves agree the sentence runs on — the last
 * line ends without terminal punctuation AND the next line opens lower-case.
 * Either alone is ordinary: a paragraph may end on a colon, and a line may open
 * lower-case because extraction rendered small caps that way.
 *
 * `prose-stops.json` is the ledger, and it ratchets. `known` holds truncations
 * that are real and not yet authored, so a new one fails the build while an old
 * one is counted and named. `waived` holds stops that look open and are not,
 * each with its reason. An id in neither fails.
 *
 * Never print what a box contains. A failure names the entry, its page and its
 * coordinates, which is what an author needs and carries no book text.
 *
 * Requires the LOCAL reference PDFs, so it SKIPS (exit 0) wherever they are
 * absent — CI included.
 *
 * Usage: node tools/importer/check-prose-stops.mjs   (also runs via `npm run validate`)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FILES, OSE_FILES, referenceComplete } from "./reference-lib.mjs";
import { openBook, pageItems, detectColumns, colOf } from "../../scripts/importer/extract.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const COOKBOOK = path.join(ROOT, "cookbook");
const LEDGER = path.join(HERE, "prose-stops.json");
const ALL = { ...FILES, ...OSE_FILES };

if (!referenceComplete()) {
  console.log("prose stops: SKIPPED — local reference PDFs not on this machine.");
  process.exit(0);
}
if (!fs.existsSync(COOKBOOK)) {
  console.log("prose stops: SKIPPED — no cookbook/ to read.");
  process.exit(0);
}

const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : { known: {}, waived: {} };

/** Body type. Furniture and headings are not part of a passage. */
const BODY_MIN_H = 8;
const BODY_MAX_H = 11.5;
/** A run this far outside the box's x band belongs to another column. */
const X_SLACK = 12;
/** The next line has to be within a line or two, or it is a different block. */
const NEXT_MAX_GAP = 26;

const entries = [];
/** book -> page -> every box any entry claims, so a neighbour's line is recognisable. */
const claims = new Map();
const claim = (book, page, b, id) => {
  if (!claims.has(book)) claims.set(book, new Map());
  const byPage = claims.get(book);
  if (!byPage.has(page)) byPage.set(page, []);
  byPage.get(page).push({ ...b, id });
};
const walkBoxes = (node, page, out) => {
  if (!node || typeof node !== "object") return;
  const p = node.page ?? page;
  if (node.box?.x0 != null) out.push({ ...node.box, page: p });
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) for (const x of v) walkBoxes(x, p, out);
    else if (v && typeof v === "object") walkBoxes(v, p, out);
  }
};
for (const f of fs.readdirSync(COOKBOOK).sort()) {
  if (!f.endsWith(".json") || f === "index.json" || f === "registers.json") continue;
  const cb = JSON.parse(fs.readFileSync(path.join(COOKBOOK, f), "utf8"));
  for (const [id, e] of Object.entries(cb.entries ?? {})) {
    const book = e.book ?? cb.book?.id;
    if (!book) continue;
    const every = [];
    for (const instr of Object.values(e.fields ?? {})) walkBoxes(instr, instr.page, every);
    for (const b of every) claim(book, b.page, b, id);
    const d = e.fields?.description;
    if (e.aliasOf || d?.op !== "text" || !d.paras?.length) continue;
    const boxes = d.paras.map((p) => ({ ...p.box, page: p.page ?? d.page }));
    const last = boxes.reduce((a, b) => (b.page > a.page || (b.page === a.page && b.y1 > a.y1) ? b : a));
    entries.push({ id, book, last });
  }
}

const lineOf = (items) => items.map((i) => String(i.str)).join(" ").replace(/\s+/g, " ").trim();
/** A clause that has closed. Quotes and brackets close one as surely as a stop does. */
const CLOSED = /[.!?:;»”’"')\]]$/u;

const open = [];
const waivedSeen = new Set();
let decided = 0;
let noNext = 0;
let neighbour = 0;
const cache = new Map();

for (const book of [...new Set(entries.map((e) => e.book))].sort()) {
  const file = ALL[book];
  if (!file || !fs.existsSync(file)) continue;
  const { doc } = await openBook(fs.readFileSync(file));
  for (const e of entries.filter((x) => x.book === book)) {
    const { last } = e;
    if (!(last.page >= 1 && last.page <= doc.numPages)) continue;
    const key = `${book}|${last.page}`;
    if (!cache.has(key)) {
      const pd = await pageItems(doc, last.page);
      cache.set(key, { pd, cols: detectColumns(pd.items) });
    }
    const { pd, cols } = cache.get(key);
    const col = colOf(last.x0, cols);
    const body = pd.items.filter(
      (i) => String(i.str).trim() && i.h >= BODY_MIN_H && i.h <= BODY_MAX_H && colOf(i.x, cols) === col,
    );
    const inBand = (i) => i.x >= last.x0 - X_SLACK && i.x <= last.x1 + X_SLACK;
    // The passage's own last line: the runs sitting on the box's bottom edge.
    const mine = body.filter((i) => i.y > last.y1 - 12 && i.y <= last.y1 + 1 && inBand(i));
    const below = body.filter((i) => i.y > last.y1 + 1 && inBand(i)).sort((a, b) => a.y - b.y);
    if (!mine.length) continue;
    if (!below.length || below[0].y - last.y1 > NEXT_MAX_GAP) {
      noNext++;
      continue;
    }
    const nextY = below[0].y;
    const nextLine = below.filter((i) => Math.abs(i.y - nextY) < 3).sort((a, b) => a.x - b.x);
    const taken = (claims.get(book)?.get(last.page) ?? []).some(
      (c) =>
        c.id !== e.id &&
        nextLine[0].x >= c.x0 - 1 &&
        nextLine[0].x <= c.x1 + 1 &&
        nextY >= c.y0 - 1 &&
        nextY <= c.y1 + 1,
    );
    if (taken) {
      neighbour++;
      continue;
    }
    decided++;
    if (CLOSED.test(lineOf(mine))) continue;
    if (!/^[a-z]/.test(lineOf(nextLine))) continue;
    if (ledger.waived?.[e.id]) {
      waivedSeen.add(e.id);
      continue;
    }
    open.push({ id: e.id, book, page: last.page, y1: last.y1, nextY, known: !!ledger.known?.[e.id] });
  }
}

const fresh = open.filter((o) => !o.known);
for (const o of open) {
  const line = `${o.id} (${o.book} p.${o.page}): box ends y=${o.y1.toFixed(0)}, the passage continues at y=${o.nextY.toFixed(0)}`;
  if (o.known) console.log(`prose stops: known — ${line}`);
  else console.error(`prose stops: ${line}`);
}
const tally =
  `${decided} of ${entries.length} descriptions reached a stop discrimination; ` +
  `${open.length} open (${open.length - fresh.length} known, ${fresh.length} new), ${waivedSeen.size} waived; ` +
  `${neighbour + noNext} gave no verdict (next line claimed by a neighbour ${neighbour}, column ends ${noNext})`;
if (fresh.length) {
  console.error(`prose stops: FAILED — ${tally}.`);
  console.error(`prose stops: extend the box to the end of the passage, or record the id in tools/importer/prose-stops.json.`);
  process.exit(1);
}
console.log(`prose stops: OK — ${tally}.`);
