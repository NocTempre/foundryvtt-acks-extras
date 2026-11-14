/**
 * The compile half of the `ocr` op: `kind.picture` rows and the entry rows that
 * read through them.
 *
 * A `kind.picture` row IS the recipe for the picture on one page (`picture`:
 * the XObject, the boxes to read with a page segmentation mode each, the
 * corrections applied to a box's text), and passes into the book cookbook's
 * `pictures` block unchanged less its notes. An entry row on that page carries
 * `ocr: {<field>: <instruction>}` in place of an anchor; each instruction is
 * the `then` of an `ocr` op on the page, a `value` instruction's `unread` list
 * riding on the op. What ships never depends on the author's read, so the
 * drift check stays a byte compare.
 *
 * Checked against the author's read (`ocr-author-read.mjs`, LOCAL-ONLY) when
 * one exists: every box lies inside the samples, every correction's `hits`
 * holds and no match crosses a line, each entry's instructions replayed over
 * the corrected lines meet the kind's test, and lines no instruction selects
 * are reported. With no read it says so once, naming the path. Findings are
 * warnings naming rows and indices, never a read word.
 */
import { executeEntry } from "../../scripts/importer/executor.mjs";
import { pageArtPlacements } from "../../scripts/importer/extract.mjs";
import { citeFor } from "../../scripts/importer/books.mjs";
import { pictureRuns, seedPictureRead } from "../../scripts/importer/picture-text.mjs";
import { loadRead } from "./ocr-author-read.mjs";

/** The register kind whose rows are page recipes. */
export const PICTURE_KIND = "kind.picture";

/** A picture row's recipe as the cookbook ships it: the register's block less every authoring note. */
export function pictureBlock(row) {
  const { name, read = [], corrections = [] } = row.picture ?? {};
  const bare = ({ note: _note, ...rest }) => rest;
  return { name, read: read.map(bare), corrections: corrections.map(bare) };
}

/** The instruction an entry row's `ocr` field becomes: an `ocr` op on the row's page, with a `value`'s `unread` lifted onto it. */
export function ocrInstruction(page, spec) {
  const { unread, ...then } = spec;
  return { op: "ocr", page, then, ...(unread ? { unread } : {}) };
}

/** An entry row as the cookbook carries it: its identity and one `ocr` instruction per field. */
export function ocrEntry(row) {
  const page = row.pages[0];
  const fields = {};
  for (const [field, spec] of Object.entries(row.ocr)) fields[field] = ocrInstruction(page, spec);
  return { kind: row.kind, name: row.name, cite: citeFor(row.book, page), pages: row.pages, ...(row.meta ? { meta: row.meta } : {}), fields };
}

/** The boxes an instruction reads through, wherever its shape keeps them. */
function boxesOf(instr, out = []) {
  if (!instr || typeof instr !== "object") return out;
  if (instr.box) out.push(instr.box);
  for (const b of instr.boxes ?? []) out.push(b);
  for (const part of [...(instr.paras ?? []), ...(instr.parts ?? [])]) boxesOf(part, out);
  return out;
}

const wordsOf = (paras) => (paras ?? []).reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0);

/**
 * What a replayed entry owes its kind, by the same test `verify-cookbook`
 * makes: a name read, and the kind's body. Problems are returned as text that
 * names fields and counts, never content.
 */
function kindProblems(entry, res) {
  const f = res.fields;
  const out = res.misses.filter((m) => m.error).map((m) => `${m.field}: ${m.error}`);
  const nameThen = entry.fields.name?.then;
  const named = f.name?.ok && (nameThen?.op !== "heading" || nameThen.names === false || !!String(f.name?.title ?? "").trim());
  if (!named) out.push("the name's check failed or read nothing");
  const rows = Array.isArray(f.rows) ? f.rows : [];
  switch (entry.kind) {
    case "kind.location":
    case "kind.prose":
    case "kind.adventureItem":
      if (!wordsOf(f.description)) out.push("the description read no words");
      break;
    case "kind.npc":
    case "kind.pregen":
      if (!(f.statline && (f.statline.class || f.statline.hp != null || f.statline.ac != null))) out.push("the stat line parsed to nothing");
      break;
    case "kind.settingTable":
      if (!rows.length || (f.labels ?? []).length !== rows.length) out.push(`${(f.labels ?? []).length} label(s) for ${rows.length} row(s)`);
      break;
    case "kind.rolltable":
      if (!rows.length) out.push("no rows read");
      break;
    default:
  }
  return out;
}

/**
 * Check a page's recipe and the entries reading it against the author's read.
 * Every finding goes to `warn`.
 */
async function checkAgainstRead({ row, entries, registers, warn }) {
  const page = row.pages[0];
  const block = pictureBlock(row);
  const { reads, file, stale, samples } = loadRead(row.book, page, block);
  if (!reads) {
    warn(`${row.id}: ${stale ? `the author's read at ${file} is ${stale}` : `no author's read at ${file}`} — recipe unchecked; run tools/importer/ocr-author-read.mjs ${row.book} ${page}`);
    return;
  }
  block.read.forEach(({ box }, i) => {
    if (!(box.x0 >= 0 && box.y0 >= 0 && box.x0 < box.x1 && box.y0 < box.y1 && box.x1 <= samples.width && box.y1 <= samples.height)) {
      warn(`${row.id}: read box ${i} lies outside the ${samples.width}x${samples.height} samples`);
    }
  });
  const { runs, hits, spans } = pictureRuns(reads, block);
  block.corrections.forEach((c, j) => {
    if (hits[j] !== c.hits) warn(`${row.id}: correction ${j} matches ${hits[j]} time(s) on the author's read, expects ${c.hits}`);
    if (spans[j]) warn(`${row.id}: correction ${j} has ${spans[j]} match(es) crossing a line break`);
    if (c.box >= block.read.length) warn(`${row.id}: correction ${j} names box ${c.box}, which the recipe does not read`);
  });
  const claimed = new Set();
  for (const e of entries) {
    const entry = ocrEntry(e);
    const doc = {};
    seedPictureRead(doc, page, block, reads);
    const res = await executeEntry(doc, { schema: "acks-cookbook/2", entries: { [e.id]: entry }, pictures: { [page]: block } }, registers, e.id, {});
    for (const problem of kindProblems(entry, res)) warn(`${e.id}: replayed on the author's read, ${problem}`);
    const boxes = Object.values(entry.fields).flatMap((instr) => boxesOf(instr.then));
    runs.forEach((r, i) => {
      if (boxes.some((b) => r.x >= b.x0 && r.x <= b.x1 && r.y >= b.y0 && r.y <= b.y1)) claimed.add(i);
    });
  }
  const residue = runs.map((_, i) => i).filter((i) => !claimed.has(i));
  if (residue.length) warn(`${row.id}: ${residue.length} line(s) of the read are selected by no entry (runs ${residue.slice(0, 12).join(", ")}${residue.length > 12 ? ", …" : ""})`);
}

/**
 * The compile loop's route for a `kind.picture` row or an entry row carrying
 * `ocr`. A picture row is checked against the page's own XObjects, passes into
 * `out.pictures[<page>]`, and is checked against the author's read; an entry row
 * becomes an entry of `out.entries`.
 *
 * @param {object} doc the opened book
 * @param {object} row the register row
 * @param {{list: object[], out: object, registers: object, warn: Function}} ctx the book's rows, its output, the compiled registers
 */
export async function compilePictureRow(doc, row, { list, out, registers, warn }) {
  const page = row.pages[0];
  try {
    if (row.kind === PICTURE_KIND) {
      const block = pictureBlock(row);
      const placed = await pageArtPlacements(doc, page);
      if (!placed.some((p) => p.name === block.name)) throw new Error(`p.${page} paints no picture named ${block.name}`);
      (out.pictures ??= {})[page] = block;
      console.error(`OK   ${row.id}: picture (${block.read.length} box(es), ${block.corrections.length} correction(s))`);
      const entries = list.filter((e) => e.ocr && e.pages?.[0] === page && !(e.status && e.status !== "active"));
      await checkAgainstRead({ row, entries, registers, warn });
      return;
    }
    if (!list.some((e) => e.kind === PICTURE_KIND && e.pages?.[0] === page)) throw new Error(`reads through p.${page}, which has no ${PICTURE_KIND} row`);
    out.entries[row.id] = ocrEntry(row);
    console.error(`OK   ${row.id}: ${Object.keys(row.ocr).length} instructions [ocr]`);
  } catch (err) {
    warn(`${row.id}: ${err.message}`);
  }
}
