/**
 * A cast's modifier and ward rows as one buff: the parts lib reads at the roll
 * (`lib/roll-mods.mjs`, the flag `flags["acks-extras"].rollMods`), built once per
 * recipient from the spell's own rows. A row becomes a part only where the
 * answer to `modifierDisposition(row, {bearer: true})` is that it waits for a
 * roll (a scope to settle against the other party, an item gate, a roll gate)
 * and its target is a roll a part can sit on. Any other row stays a line on the
 * card until standing spell modifiers are built, and a row whose figure the
 * import left blank writes no part.
 *
 * Every part provides `SPELL_RECORD_CAP`, so two spell records never add; a
 * printed clause that two spells do add, or that a spell does not stack with a
 * weapon's own bonus, rides on the part as `stacksWith` and `notStacksWith`.
 * Importing `lib/roll-mods.mjs` registers the item gates `isItemGate` answers
 * for, so this file imports it before it asks. Foundry-free.
 */
import { SPELL_RECORD_CAP } from "./constants.mjs";
import { spellEffectData } from "./spell-effect.mjs";
import { modifierDisposition, DISPOSITION, isItemGate, gateVerdict } from "../lib/typed-modifiers.mjs";
import { resolveLevelValue, SCOPE_BRANCH_FIELDS } from "../lib/vocab.mjs";
import { rollModsOf, spellStackingPart, resolveItemParts, itemBonusParts } from "../lib/roll-mods.mjs";

/** The roll a modifier row's target sits on, as lib's part names it; a target not listed here is no part. */
export const ROW_ON = Object.freeze({ attackThrow: "attack", damage: "damage", ac: "ac", save: "save" });

/** The subjects a ward row may carry for whoever the record is on. */
const WARD_SUBJECTS = Object.freeze(["", "self", "target", "recipient", "area"]);

/** Is this row one that becomes part of a buff? */
export const isModRow = (row) => row?.type === "modifier" || row?.type === "ward";

/** A plain copy of a value Foundry's data models hand out, safe to write into a flag. */
const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * A row's figure at a caster level: a flat figure as it is, any other shape
 * only when a level is known, and null where the import read none.
 *
 * @param {object} row
 * @param {number|null} level
 * @returns {number|null}
 */
export function modifierFigure(row, level) {
  const value = row?.value;
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "object") return null;
  if ((value.kind ?? (value.flat != null ? "flat" : "")) === "flat") return value.flat != null && Number.isFinite(Number(value.flat)) ? Number(value.flat) : null;
  if (!Number.isFinite(Number(level)) || Number(level) < 1) return null;
  const resolved = resolveLevelValue(value, Number(level));
  return Number.isFinite(resolved) ? resolved : null;
}

/** Does any of these keyed rows (`[{row, key}]`) wait on the weapon of a roll, so the cast must name one bearer? */
export const needsBearer = (rows) => (rows ?? []).some(({ row }) => isModRow(row) && row.type === "modifier" && isItemGate(row.gate?.kind));

/** The scope fields of a row, as plain data: only the ones it declares. */
function scopeOf(row) {
  const out = {};
  if (row.vsKinds?.length) out.vsKinds = plain(Array.from(row.vsKinds));
  if (row.vsAlignment) out.vsAlignment = row.vsAlignment;
  if (row.vsAlignmentOf) out.vsAlignmentOf = row.vsAlignmentOf;
  if (row.vsAlignmentMode && row.vsAlignmentMode !== "gate") out.vsAlignmentMode = row.vsAlignmentMode;
  if (row.vsEnemy === true) out.vsEnemy = true;
  if (row.anyOf?.length) {
    out.anyOf = Array.from(row.anyOf).map(branchOf);
  }
  return out;
}

/** One `anyOf` branch as plain data: the scope fields it declares. */
function branchOf(branch) {
  const out = {};
  for (const field of SCOPE_BRANCH_FIELDS) {
    const value = branch?.[field];
    if (value == null || value === "" || value === false) continue;
    if (typeof value === "object") {
      const list = Array.from(value);
      if (list.length) out[field] = plain(list);
    } else out[field] = value;
  }
  return out;
}

/** The refs a row names in `stacksWith` or `notStacksWith`, as plain data. */
const refsOf = (list) => plain(Array.from(list ?? []));

/**
 * The parts a set of keyed rows write on one recipient.
 *
 * `parts` are lib's roll-mod parts, in the rows' order; `lines` are the keyed
 * rows that stay a card line (a standing figure, a target no part sits on, a
 * subject that is not the bearer's, an item-gated row with no weapon named);
 * `blank` are the keys of rows whose figure the import left blank; `lasting` is
 * whether any row in `parts` lasts for the cast's duration.
 *
 * @param {Array<{row: object, key: string}>} rows  the cast's kept rows
 * @param {object} o
 * @param {number|null} [o.level]  the caster level, null when unknown
 * @param {string} [o.actorType]  the bearer's actor type
 * @param {string|null} [o.itemId]  the weapon named for this bearer
 * @returns {{parts: object[], lines: Array<{row: object, key: string}>, blank: string[], lasting: boolean}}
 */
export function modParts(rows, { level = null, actorType = "character", itemId = null } = {}) {
  const out = { parts: [], lines: [], blank: [], lasting: false };
  for (const keyed of rows ?? []) {
    const { row, key } = keyed;
    if (!isModRow(row)) continue;
    const provides = [SPELL_RECORD_CAP, ...Array.from(row.provides ?? [])];
    if (row.type === "ward") {
      if (!WARD_SUBJECTS.includes(row.appliesTo ?? "")) {
        out.lines.push(keyed);
        continue;
      }
      out.parts.push({ key, on: "ward", provides, stacksWith: refsOf(row.stacksWith), notStacksWith: refsOf(row.notStacksWith), ...scopeOf(row) });
      if (row.lasts === "duration") out.lasting = true;
      continue;
    }
    const on = ROW_ON[row.target];
    const disposition = modifierDisposition(row, { actorType, bearer: true });
    if (!on || row.appliesTo === "opponent" || disposition?.kind !== DISPOSITION.AT_ROLL) {
      out.lines.push(keyed);
      continue;
    }
    const itemGated = isItemGate(row.gate?.kind);
    if (itemGated && !itemId) {
      out.lines.push(keyed);
      continue;
    }
    const value = modifierFigure(row, level);
    if (value === null) {
      out.blank.push(key);
      continue;
    }
    const part = { key, on, value, provides, stacksWith: refsOf(row.stacksWith), notStacksWith: refsOf(row.notStacksWith), ...scopeOf(row) };
    if (itemGated) part.itemId = String(itemId);
    if (row.gate?.kind) part.gate = plain(row.gate);
    out.parts.push(part);
    if (row.lasts === "duration") out.lasting = true;
  }
  return out;
}

/**
 * The buff record one recipient takes: `spellEffectData` carrying lib's
 * `rollMods`, or null with no parts. It holds no status and no change, and is
 * timed by `duration` only where the cast is timed and its rows last.
 *
 * @param {{castId: string, casterUuid: string}} card
 * @param {object[]} parts  from `modParts`
 * @param {object} o
 * @param {{uuid: string, name: string, img?: string, id?: string|null, cite?: string}} o.spell  read from the spell document, never the card
 * @param {number} o.startTime  the world time the record begins
 * @param {{id: string, name: string}|null} [o.item]
 * @param {string|null} [o.sourceAlignment]  the caster's alignment key
 * @param {object} [o.resist]  the recipient's saving throw
 * @param {{value: number, units: string}|{none: string}} [o.duration]
 * @param {boolean} [o.lasting]  `modParts`' answer
 */
export function modRecordData(card, parts, { spell, startTime, item = null, sourceAlignment = null, resist, duration, lasting = false } = {}) {
  if (!parts?.length) return null;
  const timed = lasting && duration && !duration.none;
  return spellEffectData({
    spell: { uuid: spell.uuid, name: spell.name, img: spell.img },
    caster: { uuid: card.casterUuid },
    castId: card.castId,
    role: "recipient",
    item: item ?? undefined,
    resist,
    sourceAlignment: sourceAlignment || undefined,
    startTime,
    duration: timed ? duration : undefined,
    rollMods: { id: spell.id ?? null, label: spell.name, cite: spell.cite ?? "", sourceAlignment: sourceAlignment || null, parts },
  });
}

/**
 * Which of these parts would yield, were the cast applied now: for the attack
 * and damage parts that name the weapon, lib's own resolver is run against the
 * weapon's own bonus (`registerItemBonusSource`) and the spell parts already on
 * the bearer for that weapon and field. A part that yields answers the label of
 * what it yielded to; the roll decides again, since a later tier or a second
 * cast changes the answer.
 *
 * @param {object[]} parts  from `modParts`
 * @param {object} o
 * @param {object|null} o.item  the bearer's weapon
 * @param {object} o.bearer  the bearer's actor
 * @param {{id: string|null, name: string, cite?: string}} o.spell
 * @param {string|null} [o.sourceAlignment]
 * @returns {Record<string, string>}  part key to the label it yields to
 */
export function dryYields(parts, { item, bearer, spell, sourceAlignment = null }) {
  const out = {};
  if (!item) return out;
  const holds = (p) => !p.gate?.kind || gateVerdict(bearer, p.gate, { item }) === true;
  for (const on of ["attack", "damage"]) {
    const mine = parts.filter((p) => p.on === on && p.itemId === item.id && Number.isFinite(p.value) && p.value !== 0 && holds(p));
    if (!mine.length) continue;
    const standing = rollModsOf(bearer)
      .filter((e) => e.part.on === on && (!e.part.itemId || e.part.itemId === item.id) && holds(e.part))
      .map((e) => spellStackingPart(e));
    const fresh = mine.map((p) => spellStackingPart({ effect: null, id: spell.id ?? null, label: spell.name, cite: spell.cite ?? "", sourceAlignment, part: p }));
    const { droppedSpells } = resolveItemParts(itemBonusParts(item, on), [...standing, ...fresh]);
    for (const dropped of droppedSpells) if (dropped.effect == null) out[dropped.key] = dropped.yieldsTo;
  }
  return out;
}
