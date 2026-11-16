/**
 * The rows a cast acts on, read off a spell and shaped for one cast: whose
 * rows they are (the copy's own, else its library twin's), which of them the
 * chosen mode and picks keep, which need an attack throw first, and what a
 * target's saving throw leaves of each. FOUNDRY-FREE: it reads the raw spell
 * flag the way `summon-spell.mjs` does, and every world lookup is passed in.
 *
 * A row is told apart by its key. A register row carries an authored one and a
 * Judge's own row `_` and a random id (`lib/fields.mjs` `effectField`); a row
 * with neither, an older copy's, is keyed by its position, `#<index>`.
 */
import { MODULE_ID, FLAG_SPELL } from "./constants.mjs";
import { libraryTwin } from "./summon-spell.mjs";

/** The effect-row types a cast resolves on the card. Every other type is a record and a line (`describe.mjs`). */
export const ROLLED_KINDS = Object.freeze(["damage", "heal"]);

/** The two forms of a reversible spell, as a cast's `mode`. */
export const CAST_MODES = Object.freeze({ normal: "normal", reversed: "reversed" });

/** The delivery kinds that make the caster land an attack throw first. */
const THROWN = Object.freeze(["melee", "missile"]);

/** The raw `effects` of an item's spell flag, as an array of rows; `effects` may arrive numeric-keyed. */
export function effectRowsOf(item) {
  const effects = item?.flags?.[MODULE_ID]?.[FLAG_SPELL]?.effects;
  const rows = Array.isArray(effects) ? effects : effects && typeof effects === "object" ? Object.values(effects) : [];
  return rows.filter((row) => row && typeof row === "object");
}

/**
 * A spell's rows: its own, else its library twin's (read only when the copy has
 * none). `from` says which, or `none`.
 *
 * @param {object} spell
 * @param {{byCookbookId: Function, fromUuidSync: Function}} lookups
 * @returns {{rows: object[], from: "own"|"twin"|"none"}}
 */
export function rowsOf(spell, lookups) {
  const own = effectRowsOf(spell);
  if (own.length) return { rows: own, from: "own" };
  const twin = lookups ? libraryTwin(spell, lookups) : null;
  const rows = twin ? effectRowsOf(twin) : [];
  return rows.length ? { rows, from: "twin" } : { rows: [], from: "none" };
}

/** The key a row goes by in a cast: its own, else its position. */
export const rowKeyOf = (row, i) => row?.key || `#${i}`;

/** Every row with its key and position, in the spell's order. */
export const keyedRows = (rows) => (rows ?? []).map((row, index) => ({ row, key: rowKeyOf(row, index), index }));

/** The rows of one form: a reversed row belongs to the reverse form alone, every other row to the plain one. */
export const rowsOfMode = (rows, mode) => keyedRows(rows).filter(({ row }) => Boolean(row.reversed) === (mode === CAST_MODES.reversed));

/**
 * The choice groups of a mode: rows sharing a `pick` id, of which the caster
 * takes one. A group of one row offers no choice and is left out.
 * @returns {Array<{id: string, rows: Array<{row: object, key: string, index: number}>}>}
 */
export function pickGroups(rows, mode) {
  const groups = new Map();
  for (const entry of rowsOfMode(rows, mode)) {
    const id = String(entry.row.pick ?? "").trim();
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(entry);
  }
  return [...groups].filter(([, members]) => members.length > 1).map(([id, members]) => ({ id, rows: members }));
}

/**
 * The rows one cast keeps: the mode's rows, and from each choice group only the
 * one `picks` names by key (the group's first when it names none).
 *
 * @param {object[]} rows
 * @param {string} mode  a `CAST_MODES` key
 * @param {Record<string, string>} [picks]  group id to row key
 */
export function rowsForMode(rows, mode, picks = {}) {
  const kept = rowsOfMode(rows, mode);
  const chosen = new Map();
  for (const group of pickGroups(rows, mode)) {
    const named = group.rows.find((r) => r.key === picks?.[group.id]);
    chosen.set(group.id, (named ?? group.rows[0]).key);
  }
  return kept.filter(({ row, key }) => {
    const id = String(row.pick ?? "").trim();
    return !chosen.has(id) || chosen.get(id) === key;
  });
}

/** Does this row need the caster's attack throw to land before it applies? */
export const rowNeedsThrow = (row) => row?.type === "damage" && THROWN.includes(row.delivery);

/** Does a spell hold a reverse form among its rows? */
export const hasReversedRows = (rows) => (rows ?? []).some((row) => row?.reversed === true);

/**
 * What a target's saving throw leaves of one row. A row's own `saveEffect`
 * wins over the spell's `save.effect`. Negation leaves nothing and halving half
 * of the amount; any other effect on a passed save has no figure the module
 * can compute, so the fraction is null and the entry is the Judge's. A failed
 * save, and a spell with no save to make, leave the whole amount.
 *
 * @param {object} row
 * @param {{category?: string, effect?: string}} spellSave  the spell's `save`
 * @param {{success?: boolean|null}|null} resist  the target's resist, null when none was made
 * @returns {{fraction: number|null, effect: string, saved: boolean|null}}
 */
export function saveFractionOf(row, spellSave, resist) {
  const effect = String(row?.saveEffect || spellSave?.effect || "");
  const success = resist?.success;
  if (success !== true) return { fraction: 1, effect, saved: success === false ? false : null };
  if (effect === "negates") return { fraction: 0, effect, saved: true };
  if (effect === "half") return { fraction: 0.5, effect, saved: true };
  return { fraction: null, effect, saved: true };
}

/** Does the spell call for a saving throw by the target? A category of none, or a blank one, calls for none. */
export const spellSaves = (save) => Boolean(save?.category) && save.category !== "none" && (save.kind || "save") === "save";
