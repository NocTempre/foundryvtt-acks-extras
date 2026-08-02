/* global game, ui */
/**
 * Spell books — RR p. 145 (the item) and p. 390 (value of a scribed spell).
 *
 * A spell book is a RECOGNISED item class, not a property switched on for
 * arbitrary gear: the RR "Spell Book" (which acks-content generates from the
 * equipment list) IS the spell book, and only it carries the page/value model.
 * Recognition is by name, or by an already-stored spell list so a configured
 * book keeps its identity even if renamed.
 *
 * RAW: a grimoire has 100 pages; each spell takes one page per spell level; the
 * book counts as 1/2 stone whatever it holds; a blank book costs 20gp. Its spells
 * are stored as DATA on the book (name + level) rather than by linking the
 * finder's own spell documents — so a looted book's formulae travel with it and
 * appear on nobody's Spells tab until they are actually learned.
 *
 * Value follows the Magic Research material cost (RR p390): 1,000gp per spell
 * level. A book's worth is the blank cost plus 1,000gp × the level of every spell
 * scribed in it.
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";

export const SPELLBOOK_PAGES = 100; // RR p145
export const SPELL_VALUE_PER_LEVEL = 1000; // RR p390 (Material Cost)
export const BLANK_SPELLBOOK_VALUE = 20; // RR p145

/** Names that read as a spell book — the RR canonical item plus a common synonym. */
export const SPELLBOOK_NAME = /\bspell\s*book\b|\bgrimoire\b/i;

/** The spell-list record on a book, or null. */
export function spellbookOf(item) {
  return item?.getFlag?.(MODULE_ID, ITEM_FLAGS.SPELLBOOK) ?? null;
}

/**
 * Is this item a spell book? A recognised class — the RR "Spell Book" — by name,
 * or by an already-stored spell list (a configured book keeps its identity if
 * renamed). Never true for a weapon, a backpack, or ordinary gear.
 */
export function isSpellbook(item) {
  if (item?.type !== "item") return false;
  return SPELLBOOK_NAME.test(item.name ?? "") || !!spellbookOf(item);
}

/** The spells recorded in the book: [{name, lvl}], always an array. */
export function spellbookSpells(item) {
  const s = spellbookOf(item)?.spells;
  return Array.isArray(s) ? s : [];
}

/** Page capacity (RR default 100). */
export function pagesCapacity(item) {
  return Number(spellbookOf(item)?.pages ?? SPELLBOOK_PAGES);
}

/** Pages used — one page per spell level (a 3rd-level spell fills three pages). */
export function pagesUsed(item) {
  return spellbookSpells(item).reduce((n, sp) => n + Math.max(0, Number(sp.lvl ?? 0)), 0);
}

/** Is the book scribed past its page capacity? */
export function overCapacity(item) {
  return pagesUsed(item) > pagesCapacity(item);
}

/** RAW value: blank cost + 1,000gp × the level of every spell scribed. */
export function spellbookValue(item) {
  return BLANK_SPELLBOOK_VALUE + spellbookSpells(item).reduce((gp, sp) => gp + SPELL_VALUE_PER_LEVEL * Math.max(0, Number(sp.lvl ?? 0)), 0);
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
  const rec = spellbookOf(item) ?? { pages: SPELLBOOK_PAGES };
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
