/* global game, ui */
/**
 * Spell books — RR p. 145 (the item) and p. 391 (value of a scribed spell).
 *
 * A spell book is a RECOGNISED item class (the RR "Spell Book" the importer
 * generates from the equipment list), and only it carries the page/value model.
 * Recognition is by name, or by an already-stored spell list.
 *
 * A book's pages fill by spell level, and its weight is the item's own whatever
 * it holds (RR p. 145). Its spells are stored as DATA on the book (name +
 * level), not as links to spell documents, so a looted book's formulae appear
 * on nobody's Spells tab until learned.
 *
 * A book's worth is its blank cost plus the scribing value of every spell in
 * it, by level (RR p. 391).
 *
 * The three figures the model runs on, a book's pages, a blank book's price and
 * the value of one spell level, are the Judge's import (the `equipment`
 * ruledata tables in `SPELLBOOK_TABLES`). Each is null until imported, and so
 * is everything derived from it: no capacity, no over-capacity verdict, no
 * value. Nothing answers in a missing figure's place.
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";
import { citeOf, getDoc, getLayer, hasDoc, PRIORITY } from "../lib/tables.mjs";
import { RULEDATA_DOC } from "./overlays/scavenged.mjs";

/**
 * The three `equipment` tables the spell book reads, each holding one figure
 * under the key named here: the pages a book holds, a blank book's price in gp
 * and one scribed spell level's value in gp. `min` is the least a figure can
 * be: a book holds at least a page. The ids are written as literals in
 * `module.mjs` `expectTables`, because the validate gate reads that call from
 * source.
 */
export const SPELLBOOK_TABLES = Object.freeze({
  pages: { table: "spellBookPages", key: "pages", min: 1 },
  blank: { table: "spellBookBlank", key: "value", min: 0 },
  scribing: { table: "spellBookScribing", key: "perLevel", min: 0 },
});

/** One imported figure as a finite number, or null for blank, absent, not a number, or below its floor. */
function figure({ table, key, min }) {
  if (!hasDoc(RULEDATA_DOC)) return null;
  const raw = getDoc(RULEDATA_DOC)?.tables?.[table]?.[key];
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? n : null;
}

/**
 * Where a figure came from, at render: `{state: "judge"}` where the Judge's own
 * edit holds its table, `{state: "page", cite}` where the import recorded the
 * page it read, and `{state: "none"}` where it is not imported (a blank figure).
 * @param {"pages"|"blank"|"scribing"} which a key of `SPELLBOOK_TABLES`
 */
export function spellbookFigureSource(which) {
  const spec = SPELLBOOK_TABLES[which];
  if (!spec || figure(spec) === null) return { state: "none", cite: null };
  if (getLayer(RULEDATA_DOC, PRIORITY.OVERRIDE)?.tables?.[spec.table] != null) return { state: "judge", cite: null };
  return { state: "page", cite: citeOf(RULEDATA_DOC, spec.table) };
}

/**
 * The tooltip of a spell book figure: the page it was read from or that the
 * Judge set it; empty where the figure is not imported.
 * @param {"pages"|"blank"|"scribing"} which a key of `SPELLBOOK_TABLES`
 */
export function spellbookFigureTip(which) {
  const { state, cite } = spellbookFigureSource(which);
  if (state === "none") return "";
  const what = game.i18n.localize(`ACKS-EQUIPMENT.spellbook.tip.what.${which}`);
  if (state === "judge") return game.i18n.format("ACKS-EQUIPMENT.spellbook.tip.judge", { what });
  return game.i18n.format(cite ? "ACKS-EQUIPMENT.spellbook.tip.page" : "ACKS-EQUIPMENT.spellbook.tip.book", { what, cite });
}

/** The pages a spell book holds, or null until imported. The same for every book. */
export const pagesPerBook = () => figure(SPELLBOOK_TABLES.pages);

/** A blank spell book's price in gp, or null until imported. */
export const blankBookValue = () => figure(SPELLBOOK_TABLES.blank);

/** The scribing value of one spell level in gp, or null until imported. */
export const valuePerSpellLevel = () => figure(SPELLBOOK_TABLES.scribing);

/** Names that read as a spell book — the RR canonical item plus a common synonym. */
export const SPELLBOOK_NAME = /\bspell\s*book\b|\bgrimoire\b/i;

/** The spell-list record on a book, or null. */
export function spellbookOf(item) {
  return item?.getFlag?.(MODULE_ID, ITEM_FLAGS.SPELLBOOK) ?? null;
}

/**
 * Is this item a spell book? By name, or by an already-stored spell list (a
 * configured book keeps its identity if renamed). Only an `item`-type document
 * qualifies.
 */
export function isSpellbook(item) {
  if (item?.type !== ITEM_TYPE.item) return false;
  return SPELLBOOK_NAME.test(item.name ?? "") || !!spellbookOf(item);
}

/** The spells recorded in the book: [{name, lvl}], always an array. */
export function spellbookSpells(item) {
  const s = spellbookOf(item)?.spells;
  return Array.isArray(s) ? s : [];
}

/**
 * Page capacity: what the imported table says a book holds, or null until it is
 * imported. A book records no page count of its own, so a Judge's edit of the
 * table reaches every book.
 */
export function pagesCapacity() {
  return pagesPerBook();
}

/** Pages used — one page per spell level (a 3rd-level spell fills three pages). */
export function pagesUsed(item) {
  return spellbookSpells(item).reduce((n, sp) => n + Math.max(0, Number(sp.lvl ?? 0)), 0);
}

/** Is the book scribed past its page capacity? Never, while the capacity is not imported. */
export function overCapacity(item) {
  const cap = pagesCapacity(item);
  return cap !== null && pagesUsed(item) > cap;
}

/**
 * The book's value in gp: the blank cost plus the per-level value of every spell
 * scribed. Null while the blank cost is not imported, or while a spell is
 * recorded and the per-level value is not.
 */
export function spellbookValue(item) {
  const blank = blankBookValue();
  if (blank === null) return null;
  const levels = pagesUsed(item);
  if (levels === 0) return blank;
  const perLevel = valuePerSpellLevel();
  return perLevel === null ? null : blank + perLevel * levels;
}

/**
 * Parse a free-text spell list — one spell per line, level as a trailing number
 * or "(N)" ("Fireball, 3" / "Fireball (3)" / "Fireball 3"). A line with no level
 * defaults to 1. Blank lines are ignored.
 * @returns {{name:string, lvl:number}[]}
 */
export function parseSpellList(text) {
  const out = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.*?)[\s,(]*\(?(\d+)\)?\s*$/.exec(line);
    if (m && m[1].trim()) out.push({ name: m[1].trim().replace(/[,(]\s*$/, "").trim(), lvl: parseInt(m[2], 10) });
    else out.push({ name: line, lvl: 1 });
  }
  return out;
}

/** Render a spell list back to editable text ("Fireball, 3"). */
export function formatSpellList(spells) {
  return (spells ?? []).map((sp) => `${sp.name}, ${sp.lvl}`).join("\n");
}

/** Replace a book's spell list (validated to {name, lvl}); warns if over pages. */
export async function setSpellbookSpells(item, spells) {
  const rec = spellbookOf(item) ?? {};
  const clean = (spells ?? [])
    .map((sp) => ({ name: String(sp.name ?? "").trim(), lvl: Math.max(0, parseInt(sp.lvl, 10) || 0) }))
    .filter((sp) => sp.name);
  await item.setFlag?.(MODULE_ID, ITEM_FLAGS.SPELLBOOK, { ...rec, spells: clean });
  if (overCapacity(item) && game?.i18n) {
    ui.notifications?.warn?.(
      game.i18n.has("ACKS-EQUIPMENT.spellbook.over")
        ? game.i18n.format("ACKS-EQUIPMENT.spellbook.over", { name: item.name, used: pagesUsed(item), cap: pagesCapacity(item) })
        : `${item.name}: ${pagesUsed(item)}/${pagesCapacity(item)} pages — over capacity.`,
    );
  }
}
