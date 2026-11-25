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
import { MODULE_ID, FLAG_SPELL, FLAG_SPELL_DIE } from "./constants.mjs";
import { libraryTwin } from "./summon-spell.mjs";
import { resolveLevelValue, rowInInvocationRange } from "../lib/vocab.mjs";

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
  if (own.length) return { rows: withKeptDice(own, spell), from: "own" };
  const twin = lookups ? libraryTwin(spell, lookups) : null;
  const rows = twin ? effectRowsOf(twin) : [];
  return rows.length ? { rows: withKeptDice(rows, spell, twin), from: "twin" } : { rows: [], from: "none" };
}

/** The dice kept on a spell copy, by row key: `{}` for a copy with none. */
export const keptDiceOf = (item) => {
  const kept = item?.flags?.[MODULE_ID]?.[FLAG_SPELL_DIE];
  return kept && typeof kept === "object" ? kept : {};
};

/** Whether a damage row states no die. */
export const damageBlank = (row) => row?.type === "damage" && !String(row.roll ?? "").trim();

/**
 * The rows with each damage row that states no die given the die kept for it:
 * the copy's own first, then each source's after it. A row that states a die, or
 * has none kept, is the very object it was.
 *
 * @param {object[]} rows
 * @param {...object} sources  the copies whose kept dice are read, in order
 */
export function withKeptDice(rows, ...sources) {
  const kept = sources.map(keptDiceOf);
  if (!kept.some((map) => Object.keys(map).length)) return rows;
  return rows.map((row, i) => {
    if (!damageBlank(row)) return row;
    const die = kept.map((map) => map[rowKeyOf(row, i)]).find((value) => typeof value === "string" && value.trim());
    return die ? { ...row, roll: die } : row;
  });
}

/** The key a row goes by in a cast: its own, else its position. */
export const rowKeyOf = (row, i) => row?.key || `#${i}`;

/** Every row with its key and position, in the spell's order. */
export const keyedRows = (rows) => (rows ?? []).map((row, index) => ({ row, key: rowKeyOf(row, index), index }));

/** The scale a spell's figures and rows key on to read the invocation level (`VALUE_SCALES`). */
const INVOCATION_SCALE = "invocationLevel";

/**
 * The invocation level a cast reads its rows at, as `at` carries it: the whole
 * number `at.invocationLevel` holds, else null (none set). Nothing coerces, so
 * a stored "3" is no level.
 * @param {{invocationLevel?: number|null}|null} [at]
 */
const levelAt = (at) => (Number.isInteger(at?.invocationLevel) ? at.invocationLevel : null);

/** Is this a LevelValue keyed on the invocation scale? */
const onScale = (node) => node?.kind === "conditional" && node.on === INVOCATION_SCALE;

/**
 * The invocation level a card was cast at, as `at` for the rows, figures and
 * gates read off its spell again: `{invocationLevel}`, null where the card
 * carries none. Every place that turns a card back into rows reads it here.
 * @param {{invocationLevel?: number|null}|null} card
 */
export const castAt = (card) => ({ invocationLevel: levelAt(card), ...(typedDiceOf(card) ? { dice: typedDiceOf(card) } : {}) });

/**
 * The dice a cast was typed at, by row key: `card.dice`, which holds only what a
 * seat typed into the damage window for a recurring row that states no die.
 * Null where the card holds none, so a card with none reads as it always did.
 * @param {{dice?: Record<string, string>}|null} card
 */
const typedDiceOf = (card) => {
  const dice = card?.dice;
  return dice && typeof dice === "object" && Object.keys(dice).length ? dice : null;
};

/**
 * A copy of `node` with each conditional LevelValue on the invocation scale
 * replaced by the number it resolves to at `at`: null below the scale's first
 * rung, and null with no level set. Everything else is carried as it stands, and
 * a branch that holds no such conditional is the very object it was, so a row
 * with none comes back unchanged and nothing is ever written through `node`.
 * @param {*} node  a row, a figure object, or any value inside one
 * @param {{invocationLevel?: number|null}|null} [at]
 */
export function flattenAt(node, at = null) {
  if (!node || typeof node !== "object") return node;
  if (onScale(node)) return resolveLevelValue(node, 1, { [INVOCATION_SCALE]: levelAt(at) });
  if (Array.isArray(node)) {
    const mapped = node.map((v) => flattenAt(v, at));
    return mapped.some((v, i) => v !== node[i]) ? mapped : node;
  }
  let copy = null;
  for (const [key, value] of Object.entries(node)) {
    const flat = flattenAt(value, at);
    if (flat === value) continue;
    copy ??= { ...node };
    copy[key] = flat;
  }
  return copy ?? node;
}

/**
 * Does any of this read the invocation level: a row bounded by it, or a
 * LevelValue keyed on it, anywhere inside? Asked of the RAW rows and figures,
 * before a gate drops a row or a flatten replaces a figure, since with no level
 * set neither leaves a sign.
 * @param {*} node  rows, a row, or a figure object
 */
export function readsInvocation(node) {
  if (!node || typeof node !== "object") return false;
  if (onScale(node) || Number.isInteger(node.invocationFrom) || Number.isInteger(node.invocationTo)) return true;
  return Object.values(node).some(readsInvocation);
}

/**
 * The rows of one form: a reversed row belongs to the reverse form alone, every
 * other row to the plain one. A row bounded by the invocation level stands only
 * inside its range, and with no level set in `at` every bounded row is out; the
 * rows that stand come back with the scale's conditionals flattened at the level
 * (`flattenAt`). A row keeps the key and position it has in the whole spell,
 * whichever of its neighbours the level drops.
 * @param {object[]} rows
 * @param {string} mode  a `CAST_MODES` key
 * @param {{invocationLevel?: number|null, dice?: Record<string, string>}|null} [at]
 */
export const rowsOfMode = (rows, mode, at = null) =>
  keyedRows(rows)
    .filter(({ row }) => Boolean(row.reversed) === (mode === CAST_MODES.reversed) && rowInInvocationRange(row, levelAt(at)))
    .map((keyed) => ({ ...keyed, row: typedDie(flattenAt(keyed.row, at), keyed.key, at) }));

/** A damage row that states no die given the die its cast was typed (`castAt`); any other row is the very object it was. */
function typedDie(row, key, at) {
  const die = at?.dice?.[key];
  return damageBlank(row) && typeof die === "string" && die.trim() ? { ...row, roll: die } : row;
}

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
 * The groups are read over the rows that stand at `at` (`rowsOfMode`).
 * @param {{invocationLevel?: number|null}|null} [at]
 * @returns {Array<{id: string, rows: Array<{row: object, key: string, index: number}>, options: Array<{token: string, rows: Array<{row: object, key: string, index: number}>}>}>}
 */
export function pickGroups(rows, mode, at = null) {
  const groups = new Map();
  for (const entry of rowsOfMode(rows, mode, at)) {
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
 * @param {{invocationLevel?: number|null}|null} [at]  the invocation level the rows are read at (`rowsOfMode`)
 */
export function rowsForMode(rows, mode, picks = {}, at = null) {
  const kept = rowsOfMode(rows, mode, at);
  const chosen = new Map();
  for (const group of pickGroups(rows, mode, at)) {
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
 * Is this a condition row that waits for a failed recurring save? A `laterRounds` condition row with
 * `recurSave: fail` writes nothing at the cast but its anchor (no cast save is rolled for it); each
 * moment it recurs at, a failed press writes its conditions. An `eachRound` twin resolves at the cast as
 * any condition row does.
 */
export const awaitsFail = (row) => row?.type === "conditionGrant" && row.recur === "laterRounds" && row.recurSave === "fail";

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
 * save, and a spell with no save to make, leave the whole amount. A row no
 * saving throw governs (`saveEffect: none`) takes the whole amount whatever the
 * target rolled, and the entry is not marked saved.
 *
 * @param {object} row
 * @param {{category?: string, effect?: string}} spellSave  the spell's `save`
 * @param {{success?: boolean|null}|null} resist  the target's resist, null when none was made
 * @returns {{fraction: number|null, effect: string, saved: boolean|null}}
 */
export function saveFractionOf(row, spellSave, resist) {
  const effect = String(row?.saveEffect || spellSave?.effect || "");
  const success = resist?.success;
  if (effect === "none") return { fraction: 1, effect, saved: null };
  if (success !== true) return { fraction: 1, effect, saved: success === false ? false : null };
  if (effect === "negates") return { fraction: 0, effect, saved: true };
  if (effect === "half") return { fraction: 0.5, effect, saved: true };
  return { fraction: null, effect, saved: true };
}

/** Does a saving throw govern this row? Not where its effect, its own or the spell's, is `none`. */
export const saveGoverns = (row, spellSave) => String(row?.saveEffect || spellSave?.effect || "") !== "none";

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
