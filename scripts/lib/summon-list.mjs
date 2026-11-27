/**
 * A spell's list of the creatures it may call, the pure half. A spell holds one
 * `summon` row per creature (`ref`) and per number (`amount`); the rows that
 * share an invocation band, a summon format and a control kind are one list,
 * the open row included, in store order. The editor window shows the list as
 * one block and writes it back as rows, so no schema holds a list and a row
 * still names one creature. Foundry-free: every document lookup is passed in.
 */
import { REGISTER_ORIGIN } from "./magic-vocab.mjs";
import { creatureOpens, normalizeRef, packIdOfUuid, seatLabel } from "./summons-logic.mjs";

/** The fields two summon rows share to be one list. */
const LIST_FIELDS = ["invocationFrom", "invocationTo", "summonFormat", "control"];

/** A field's value as the list compares it: a blank, a missing and a null are one. */
const sameness = (value) => String(value ?? "").trim();

/** Is this a summon row? */
const isSummon = (row) => row?.type === "summon";

/** Does the row name a creature? */
const names = (row) => normalizeRef(row?.ref) !== "";

/**
 * The indexes of the rows in the open row's list: the summon rows sharing its
 * invocation band, summon format and control, the open row among them, in store
 * order. Empty where the open row is no summon row.
 * @param {object[]} rows the spell's effect rows
 * @param {number} index the open row
 * @returns {number[]}
 */
export function summonListOf(rows, index) {
  const open = rows?.[index];
  if (!isSummon(open)) return [];
  const out = [];
  rows.forEach((row, i) => {
    if (isSummon(row) && LIST_FIELDS.every((field) => sameness(row[field]) === sameness(open[field]))) out.push(i);
  });
  return out;
}

/** A row an edit by hand changed: the importer's mark comes off, as `mergeRowEdit` takes it off. */
const byHand = (row) => (row.origin ? { ...row, origin: "" } : row);

/**
 * Add a creature to the open row's list. A blank or repeated ref (compared
 * through `normalizeRef`) changes nothing. Where the open row names no
 * creature it takes the ref and keeps its number; otherwise a new row is
 * inserted after the list's last row, a copy of the open row with the ref set
 * and no name, no importer mark, no note of unread fields and a key of its own. The open row keeps its
 * index either way.
 * @param {object[]} rows the spell's effect rows
 * @param {number} index the open row
 * @param {string} ref the creature's uuid, or the text typed
 * @param {{newKey: () => string}} o `newKey` mints a hand key for the new row
 * @returns {{rows: object[], index: number, added: object|null}} the rows as they now stand, the open row's index, and the row that took the creature (null where nothing changed)
 */
export function addSummonCreature(rows, index, ref, { newKey }) {
  const unchanged = { rows, index, added: null };
  const list = summonListOf(rows, index);
  const wanted = normalizeRef(ref);
  if (!list.length || !wanted) return unchanged;
  if (list.some((i) => normalizeRef(rows[i].ref) === wanted)) return unchanged;
  const typed = String(ref).trim();
  const next = rows.map((row) => ({ ...row }));
  if (!names(rows[index])) {
    next[index] = { ...byHand(next[index]), ref: typed, name: "" };
    return { rows: next, index, added: next[index] };
  }
  // The import's note of fields it left blank describes the open row, never a row a hand made.
  const { unread: _unread, ...copy } = next[index];
  const row = { ...copy, ref: typed, name: "", origin: "", key: newKey() };
  next.splice(list[list.length - 1] + 1, 0, row);
  return { rows: next, index, added: row };
}

/**
 * Take a creature off the open row's list. A list of one keeps its row and
 * blanks its creature: the row's format, number and control are the spell's
 * setup and outlast the creature. Otherwise the target row is spliced out.
 * @param {object[]} rows the spell's effect rows
 * @param {number} index the open row
 * @param {number} target the row to take off; it must be in the open row's list
 * @returns {{rows: object[], index: number, removed: object|null}} the rows as they now stand, the open row's index (the next row of the list when the open row itself went, else the one before it), and the row that was spliced out (null for a list of one or a target outside the list)
 */
export function removeSummonCreature(rows, index, target) {
  const list = summonListOf(rows, index);
  if (!list.includes(target)) return { rows, index, removed: null };
  const next = rows.map((row) => ({ ...row }));
  if (list.length === 1) {
    next[target] = { ...byHand(next[target]), ref: "", name: "" };
    return { rows: next, index, removed: null };
  }
  const [removed] = next.splice(target, 1);
  if (target !== index) return { rows: next, index: target < index ? index - 1 : index, removed };
  const after = list.find((i) => i > target);
  return { rows: next, index: after === undefined ? list[list.length - 2] : after - 1, removed };
}

/**
 * What a Number box reads as: blank is no number (null, never 0), a finite
 * figure from zero up is that figure, and anything else is no edit at all.
 * @param {string} text what the box holds
 * @returns {number|null|undefined} undefined for text that is no number
 */
export function amountFromBox(text) {
  const typed = String(text ?? "").trim();
  if (typed === "") return null;
  const n = Number(typed);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * The provenance of a row's Number box, worded for the row and never for the
 * figure: an edit of a row takes its importer mark off, and a row made from
 * another keeps that row's figure, so no word may say more than that this row
 * was written by the import or set by hand. An imported row names the
 * store's page after it. A blank figure carries the page reference and nothing
 * else, and nothing where the store cites none.
 * @param {object} row the summon row
 * @param {{cite?: string, say: (key: string, data?: object) => string}} o `say` reads the editor's lang (`tip.amountRead`, `tip.amountHand`, `tip.cite`)
 * @returns {string}
 */
export function amountTip(row, { cite = "", say }) {
  if (sameness(row?.amount) === "") return cite ? say("tip.cite", { cite }) : "";
  if (row.origin !== REGISTER_ORIGIN) return say("tip.amountHand");
  return [say("tip.amountRead"), cite && say("tip.cite", { cite })].filter(Boolean).join(" · ");
}

/**
 * The creature a ref names, read synchronously through the lookups passed in:
 * the document (or compendium index entry) its uuid names, else the library
 * creature carrying it as an importer cookbook id. Null where neither answers,
 * where the uuid names something that is not an Actor, or where a lookup throws.
 * @param {string} ref
 * @param {{fromUuidSync: (uuid: string) => object|null, byCookbookId: (type: string, id: string) => object|null}} lookups
 * @returns {object|null}
 */
export function resolveCreature(ref, { fromUuidSync, byCookbookId }) {
  const key = normalizeRef(ref);
  if (!key) return null;
  let doc = null;
  try {
    doc = fromUuidSync?.(key) ?? null;
  } catch {
    doc = null;
  }
  if (doc && (doc.documentName ?? "Actor") !== "Actor") doc = null;
  if (!doc) {
    try {
      doc = byCookbookId?.("Actor", key) ?? null;
    } catch {
      doc = null;
    }
  }
  return doc;
}

/**
 * The stamp lookup a summon surface hands `resolveCreature` and `summonRefName`,
 * answering from the index: `rowOf(type, id)` is the creature's index row, which
 * carries the name, the uuid and the shelf it is in, and no document is loaded.
 * A row that names no shelf is a world actor, which is in memory, so it is
 * answered as the document, whose own permission test `creatureOpens` reads; a
 * row in a shelf has none, and is tested against its shelf. Of several copies
 * carrying the id, the one `opens` answers true for is taken, so the sheet names
 * the copy the cast summons for this seat (`sourceReadable`), and a world copy
 * the seat cannot observe never hides a shelf copy it can.
 * @param {(type: string, id: string, prefer: ((row: object) => boolean)|null) => {_id: string, pack: string|null}|null} rowOf
 * @param {(id: string) => object|null} worldActor the world's actor of this id
 * @param {((creature: object) => boolean)|null} [opens] whether this seat opens a creature (`creatureOpens`)
 * @returns {(type: string, id: string) => object|null}
 */
export const creatureByStamp = (rowOf, worldActor, opens = null) => (type, id) => {
  const asCreature = (row) => (row && !row.pack ? (worldActor(row._id) ?? row) : row);
  return asCreature(rowOf(type, id, opens ? (row) => opens(asCreature(row)) : null));
};

/**
 * How one creature reads on one seat. The name is the creature's own where the
 * seat can open it (`creatureOpens`), else the neutral label and nothing that
 * spells the creature: no row name, no ref. A Judge's seat reads the name, and
 * for a ref it cannot resolve the row's imported name, else the ref as written.
 * @param {object} row the summon row
 * @param {object} o
 * @param {(ref: string) => object|null} o.resolve the world's lookup, `resolveCreature` bound
 * @param {object} o.user the seat's user
 * @param {(uuid: string) => object|null} o.packOf the compendium a uuid is in
 * @param {string} o.neutral the label for a creature the seat cannot open
 * @returns {{blank: boolean, label: string, opens: boolean, source: {kind: "pack", pack: string}|{kind: "world"}|{kind: "unknown"}|null}} `source` is where the creature is from, null for a blank row and for a seat that cannot open it
 */
export function creatureView(row, { resolve, user, packOf, neutral }) {
  const ref = normalizeRef(row?.ref);
  if (!ref) return { blank: true, label: "", opens: true, source: null };
  const found = resolve(ref);
  const opens = creatureOpens(found, user, { packOf });
  const name = String(found?.name ?? "").trim() || String(row.name ?? "").trim() || ref;
  const label = seatLabel({ name, opens, neutral });
  if (!opens) return { blank: false, label, opens, source: null };
  const uuid = String(found?.uuid ?? "");
  const pack = packIdOfUuid(uuid);
  const source = !found ? { kind: "unknown" } : pack ? { kind: "pack", pack } : uuid.startsWith("Actor.") ? { kind: "world" } : { kind: "unknown" };
  return { blank: false, label, opens, source };
}

/**
 * The name a Mechanics line gives a summon row's creature on this seat: the
 * creature's name where the seat can open it, the neutral label where it
 * cannot, and null where a Judge's seat cannot resolve the ref (the line then
 * reads the ref as written).
 * @param {string} ref
 * @param {object} o `resolve`, `user`, `packOf` and `neutral` as `creatureView` takes them
 * @returns {string|null}
 */
export function seatNameOf(ref, { resolve, user, packOf, neutral }) {
  const found = resolve(ref);
  if (!creatureOpens(found, user, { packOf })) return neutral;
  return String(found?.name ?? "").trim() || null;
}
