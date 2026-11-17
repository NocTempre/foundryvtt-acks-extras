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
 * The option a row belongs to in its choice group: its own `pickOption` token,
 * else its row key, so a group authored one row to an option keeps working.
 * @param {object} row
 * @param {string} [key]  the row's key in the spell, where the caller has it keyed (`rowKeyOf`)
 */
export const optionTokenOf = (row, key = row?.key) => String(row?.pickOption ?? "").trim() || String(key ?? "");

/**
 * The choice groups of a mode: rows sharing a `pick` id, of which the caster
 * takes one option. Rows sharing `(pick, pickOption)` are one option, so an
 * option may be several rows; a group holding a single option offers no choice
 * and is left out. `rows` is every row of the group, `options` its options in
 * the spell's order.
 * @returns {Array<{id: string, rows: Array<{row: object, key: string, index: number}>, options: Array<{token: string, rows: Array<{row: object, key: string, index: number}>}>}>}
 */
export function pickGroups(rows, mode) {
  const groups = new Map();
  for (const entry of rowsOfMode(rows, mode)) {
    const id = String(entry.row.pick ?? "").trim();
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, new Map());
    const options = groups.get(id);
    const token = optionTokenOf(entry.row, entry.key);
    if (!options.has(token)) options.set(token, []);
    options.get(token).push(entry);
  }
  return [...groups]
    .filter(([, options]) => options.size > 1)
    .map(([id, options]) => ({ id, rows: [...options.values()].flat(), options: [...options].map(([token, members]) => ({ token, rows: members })) }));
}

/**
 * The rows one cast keeps: the mode's rows, and from each choice group only the
 * rows of the one option `picks` names (the group's first option when it names
 * none, or one the group does not hold). A pick names an option token, or the
 * key of one of an option's rows, which is what a group keyed by row key stored.
 *
 * @param {object[]} rows
 * @param {string} mode  a `CAST_MODES` key
 * @param {Record<string, string>} [picks]  group id to option token
 */
export function rowsForMode(rows, mode, picks = {}) {
  const kept = rowsOfMode(rows, mode);
  const chosen = new Map();
  for (const group of pickGroups(rows, mode)) {
    const named = picks?.[group.id];
    const option = group.options.find((o) => o.token === named) ?? group.options.find((o) => o.rows.some((r) => r.key === named)) ?? group.options[0];
    chosen.set(group.id, option.token);
  }
  return kept.filter(({ row, key }) => {
    const id = String(row.pick ?? "").trim();
    return !chosen.has(id) || chosen.get(id) === optionTokenOf(row, key);
  });
}

/** The values of a row's `recur` that repeat it. `eachRound` resolves at the cast and then recurs; `laterRounds` only after the cast. */
export const RECURRENCES = Object.freeze(["eachRound", "laterRounds"]);

/** The moments a recurring row resolves at (`recurAt`). */
export const RECUR_MOMENTS = Object.freeze(["casterTurn", "bearerStart", "bearerEnd"]);

/** Does this row repeat while the spell lasts? */
export const isRecurring = (row) => RECURRENCES.includes(row?.recur);

/** Does this row resolve at the cast itself? A damage or heal row that recurs `laterRounds` waits for its first moment. */
export const resolvesAtCast = (row) => row?.recur !== "laterRounds";

/**
 * The recurring rows of one moment, from keyed rows (`keyedRows`, `rowsForMode`):
 * those that repeat and name that moment in `recurAt`. A recurring row with no
 * moment is named at none.
 * @param {Array<{row: object, key: string, index: number}>} rows
 * @param {"casterTurn"|"bearerStart"|"bearerEnd"} moment
 */
export const recurringRows = (rows, moment) => (rows ?? []).filter(({ row }) => isRecurring(row) && row.recurAt === moment);

/** Does any of these keyed rows recur on the caster's turn? Such a cast keeps the caster's record while it lasts. */
export const castersTurnRecurs = (rows) => recurringRows(rows, "casterTurn").length > 0;

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

/** Does this row apply to the caster rather than to what the cast is aimed at? */
export const aimedAtSelf = (row) => row?.appliesTo === "self";

/**
 * The damage one of the spell's own rows deals, as `lib/defenses.mjs` reads it:
 * the types it lists and its extraordinary mark. The mark is three-valued, and a
 * row whose mark was never read (null) is not read as mundane. Read off the
 * spell's row, never off the card's display of it, which keeps only a boolean.
 *
 * @param {object} row
 * @returns {{types: string[], extraordinary: boolean|null}}
 */
export function damageOfRow(row) {
  const q = row?.extraordinary;
  return { types: Array.from(row?.damage ?? []).filter((t) => typeof t === "string" && t), extraordinary: q === true ? true : q === false ? false : null };
}

/**
 * The damage a target's save is rolled against: the union of every damage row the
 * save governs (no throw decides it and it is not the caster's own), over the
 * spell's keyed rows for the cast's mode and picks. Its quality is stated only
 * where every row states the same one. Null where no row qualifies, so a spell
 * with no damage (a condition alone) meets no defense on its save. The cast and
 * the relay both call this over the spell's rows, so the save the relay
 * recomputes is the save that was rolled.
 *
 * @param {Array<{row: object}>} keyed
 * @returns {{types: string[], extraordinary: boolean|null}|null}
 */
export function resistedDamage(keyed) {
  const dealt = (keyed ?? []).map(({ row }) => row).filter((row) => row?.type === "damage" && !aimedAtSelf(row) && !rowNeedsThrow(row)).map(damageOfRow);
  if (!dealt.length) return null;
  const marks = new Set(dealt.map((d) => d.extraordinary));
  return { types: [...new Set(dealt.flatMap((d) => d.types))], extraordinary: marks.size === 1 ? [...marks][0] : null };
}
