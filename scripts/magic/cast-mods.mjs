/**
 * A cast's modifier, ward, modifies, grants and immunity rows as one buff: the
 * parts lib reads at the roll (`lib/roll-mods.mjs`, the flag
 * `flags["acks-extras"].rollMods`), built once per recipient from the spell's own
 * rows. A modifier row becomes a part only where the answer to
 * `modifierDisposition(row, {bearer: true})` is that it waits for a roll (a
 * scope to settle against the other party, an item or status gate, a narrowing
 * by attack kind, a set armour class) or is the throw or reaction another
 * feature reads, and its target is a roll a part can sit on. The other kinds are
 * parts by their type. Any other row stays a line on the card until standing
 * spell modifiers are built, and a row whose figure the import left blank writes
 * no part. A modifier on the spell's own save (`ownSave`) is no part: it is read
 * at that throw (`ownSaveRows`).
 *
 * Every part provides `SPELL_RECORD_CAP`, so two spell records never add; a
 * printed clause that two spells do add, or that a spell does not stack with a
 * weapon's own bonus, rides on the part as `stacksWith` and `notStacksWith`.
 * Importing `lib/roll-mods.mjs` registers the item gates `isItemGate` answers
 * for, so this file imports it before it asks. Foundry-free.
 */
import { SPELL_RECORD_CAP } from "./constants.mjs";
import { spellEffectData } from "./spell-effect.mjs";
import { saveGoverns, spellSaves } from "./cast-rows.mjs";
import { modifierDisposition, DISPOSITION, isItemGate, gateVerdict, saveKeyOf } from "../lib/typed-modifiers.mjs";
import { resolveLevelValue, levelFactor, SCOPE_BRANCH_FIELDS } from "../lib/vocab.mjs";
import { rollModsOf, spellStackingPart, resolveItemParts, itemBonusParts } from "../lib/roll-mods.mjs";

/**
 * The roll a modifier row's target sits on, as lib's part names it; a target not
 * listed here is no part. A `grants` row is a `grant` part and an `immunity` row
 * an `immune` part by their type (`ROW_TYPE_ON`), whatever their target.
 */
export const ROW_ON = Object.freeze({ attackThrow: "attack", damage: "damage", ac: "ac", save: "save", proficiencyThrow: "throw", reaction: "reaction", grant: "grant" });

/** The part a row of these types is, whatever its target. */
const ROW_TYPE_ON = Object.freeze({ grants: "grant", immunity: "immune" });

/** The `on` values whose parts another feature reads: a proficiency's throw and a reaction, which `modifierDisposition` answers `consumed`. */
const READ_ELSEWHERE = Object.freeze({ abilities: "throw", influence: "reaction" });

/** The row types that become parts of a buff. */
const MOD_TYPES = Object.freeze(["modifier", "ward", "modifies", "grants", "immunity"]);

/** The subjects a ward row may carry for whoever the record is on. */
const WARD_SUBJECTS = Object.freeze(["", "self", "target", "recipient", "area"]);

/** Is this row one that becomes part of a buff? */
export const isModRow = (row) => MOD_TYPES.includes(row?.type);

/** The part a modifier-family row is (`on`), or "" where it is none. */
const onOf = (row) => ROW_TYPE_ON[row.type] ?? ROW_ON[row.target] ?? "";

/** Is this a modifier on the saving throw made against the spell itself (`ownSave`)? Its figure is read at that throw, never carried by a record. */
export const isOwnSaveRow = (row) => row?.type === "modifier" && row.target === "save" && row.ownSave === true;

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
 * Does the row wait for a roll a part can sit on? A `modifier` row is asked of
 * `modifierDisposition` (read on the bearer): at the roll, whatever the reason
 * (a scope, an item or status gate, a narrowing by attack kind, a set armour
 * class), or consumed by the abilities or influence feature where the part is
 * the throw or the reaction they read. Every other kind of the family is a part
 * by its type.
 */
function admitted(row, on, actorType) {
  if (row.type !== "modifier") return true;
  const disposition = modifierDisposition(row, { actorType, bearer: true });
  if (disposition?.kind === DISPOSITION.AT_ROLL) return true;
  return disposition?.kind === DISPOSITION.CONSUMED && READ_ELSEWHERE[disposition.consumer] === on;
}

/**
 * One row as the part lib reads, or null where it is a card line (a throw or a
 * grant naming nothing, an immunity naming no spell or condition, a save
 * narrowed to a word that is no saving throw). `blank` is true where the row's
 * figure was left unread; a grant, an immunity and a throw of mode `auto` carry
 * none by nature. The row's own fields ride on the part: `mode`,
 * `attackKinds`, `saves` (from `forWhat`, `saveKeyOf`), `ref`/`refs`, `rollKey`
 * (from `appliesToRoll`), `ifHas`, the gate with its occasion, and a grant's
 * `atLevel`. A `pickKind` row is narrowed to the one kind chosen at the cast.
 */
function partOf(row, on, { key, provides, level, kind }) {
  const refs = refsOf(row.refs);
  const ref = String(row.ref ?? "").trim();
  const named = ref ? [ref, ...refs] : refs;
  const conditions = Array.from(row.conditions ?? []).map(String);
  if ((on === "throw" || on === "grant") && !named.length) return null;
  if (on === "immune" && !named.length && !conditions.length) return null;
  const mode = row.mode ? String(row.mode) : "";
  const bare = on === "grant" || on === "immune" || (on === "throw" && mode === "auto");
  const value = on === "immune" || (on === "throw" && mode === "auto") ? null : modifierFigure(row, level);
  if (value === null && !bare) return { blank: true };
  const part = { key, on, ...(on === "immune" ? {} : { value }), provides, stacksWith: refsOf(row.stacksWith), notStacksWith: refsOf(row.notStacksWith), ...scopeOf(row) };
  if (mode) part.mode = mode;
  if (row.attackKinds?.length) part.attackKinds = plain(Array.from(row.attackKinds));
  if (on === "save") {
    const word = String(row.forWhat ?? "").trim();
    if (word) {
      const saveKey = saveKeyOf(word);
      if (!saveKey) return null;
      part.saves = [saveKey];
    }
  }
  if (ref) part.ref = ref;
  if (refs.length) part.refs = refs;
  if (row.appliesToRoll) part.rollKey = String(row.appliesToRoll);
  if (row.ifHas?.length) part.ifHas = refsOf(row.ifHas);
  if (row.gate?.kind) part.gate = plain(row.gate);
  if (on === "immune") {
    if (refs.length) part.spells = refs;
    if (conditions.length) part.conditions = conditions;
  }
  if (on === "grant" && Number(row.atLevelNum) > 0 && Number(row.atLevelDen) > 0 && Number.isFinite(Number(level)) && Number(level) >= 1) {
    const factor = levelFactor(row);
    part.atLevel = { value: Number(level) * factor, parts: [{ key: "level", value: Number(level) }, { key: "fraction", value: factor }] };
  }
  let picked = null;
  if (row.pickKind === true && row.vsKinds?.length) {
    const authored = Array.from(row.vsKinds).map(String);
    const chosen = authored.includes(kind) ? kind : authored[0];
    part.vsKinds = [chosen];
    picked = { key: chosen, authored, defaulted: chosen !== kind };
  }
  return { part, picked };
}

/**
 * The parts a set of keyed rows write on one recipient.
 *
 * `parts` are lib's roll-mod parts, in the rows' order; `lines` are the keyed
 * rows that stay a card line (a standing figure, a target no part sits on, a
 * subject that is not the bearer's, an item-gated row with no weapon named);
 * `blank` are the keys of rows whose figure the import left blank; `lasting` is
 * whether any row in `parts` lasts for the cast's duration; `endsOn` is what the
 * parts' rows end on, each cause once (the buff is one record, so it ends on the
 * first cause any of its rows names).
 *
 * A ward part carries `save`, the spell's save category, where a saving throw
 * governs its row (`saveGoverns`): lib's ward notice names the attacker's target
 * for it.
 *
 * @param {Array<{row: object, key: string}>} rows  the cast's kept rows
 * @param {object} o
 * @param {number|null} [o.level]  the caster level, null when unknown
 * @param {string} [o.actorType]  the bearer's actor type
 * @param {string|null} [o.itemId]  the weapon named for this bearer
 * @param {{category?: string, effect?: string}|null} [o.save]  the spell's `save`
 * @param {string|null} [o.kind]  the creature kind a `pickKind` row is narrowed to; absent or not one of the row's authored kinds, the row's first
 * @returns {{parts: object[], lines: Array<{row: object, key: string}>, blank: string[], lasting: boolean, endsOn: string[], kind: {key: string, authored: string[], defaulted: boolean}|null}}
 *   `kind` is the pick the `pickKind` rows were narrowed to, with the union of their authored kinds and whether it was defaulted
 */
export function modParts(rows, { level = null, actorType = "character", itemId = null, save = null, kind = null } = {}) {
  const out = { parts: [], lines: [], blank: [], lasting: false, endsOn: [], kind: null };
  const ends = (row) => {
    for (const cause of Array.from(row.endsOn ?? [])) if (!out.endsOn.includes(cause)) out.endsOn.push(cause);
  };
  for (const keyed of rows ?? []) {
    const { row, key } = keyed;
    if (!isModRow(row)) continue;
    const provides = [SPELL_RECORD_CAP, ...Array.from(row.provides ?? [])];
    if (row.type === "ward") {
      if (!WARD_SUBJECTS.includes(row.appliesTo ?? "")) {
        out.lines.push(keyed);
        continue;
      }
      const part = { key, on: "ward", provides, stacksWith: refsOf(row.stacksWith), notStacksWith: refsOf(row.notStacksWith), ...scopeOf(row) };
      if (spellSaves(save) && saveGoverns(row, save)) part.save = save.category;
      out.parts.push(part);
      ends(row);
      if (row.lasts === "duration") out.lasting = true;
      continue;
    }
    if (isOwnSaveRow(row)) {
      out.lines.push(keyed);
      continue;
    }
    const on = onOf(row);
    const spoken = row.type === "modifier" ? row.appliesTo !== "opponent" : WARD_SUBJECTS.includes(row.appliesTo ?? "");
    if (!on || !spoken || !admitted(row, on, actorType)) {
      out.lines.push(keyed);
      continue;
    }
    const itemGated = isItemGate(row.gate?.kind);
    if (itemGated && !itemId) {
      out.lines.push(keyed);
      continue;
    }
    const made = partOf(row, on, { key, provides, level, kind });
    if (!made) {
      out.lines.push(keyed);
      continue;
    }
    if (made.blank) {
      out.blank.push(key);
      continue;
    }
    if (itemGated) made.part.itemId = String(itemId);
    if (made.picked) {
      out.kind = out.kind ? { ...out.kind, authored: [...new Set([...out.kind.authored, ...made.picked.authored])] } : made.picked;
    }
    out.parts.push(made.part);
    ends(row);
    if (row.lasts === "duration") out.lasting = true;
  }
  return out;
}

/**
 * The rows of the spell's own saving throw (modifiers marked `ownSave`) as lib's
 * `saveSpec` takes them in `ownRows`: each saver is tested against them at the
 * throw (`ownSaveParts`), so a figure that holds lowers that saver's target and
 * one that cannot be told is listed. A row with no figure, or a `forWhat` that
 * names no saving throw, is left out. The casting seat, the card's presses and
 * the relay all call this over the same rows at the same level, so the target
 * the relay recomputes is the one that was rolled.
 *
 * @param {Array<{row: object, key: string}>} rows  the cast's kept rows
 * @param {object} o
 * @param {number|null} [o.level]  the caster level, null when unknown
 * @param {string} [o.label]  the spell's name, which labels each part
 * @param {string} [o.cite]  the spell's page reference
 * @returns {Array<{key: string, label: string, cite: string, value: number, gate?: object, ifHas: string[], saves: string[]}>}
 */
export function ownSaveRows(rows, { level = null, label = "", cite = "" } = {}) {
  const out = [];
  for (const { row, key } of rows ?? []) {
    if (!isOwnSaveRow(row)) continue;
    const value = modifierFigure(row, level);
    if (value === null) continue;
    const word = String(row.forWhat ?? "").trim();
    const saveKey = word ? saveKeyOf(word) : null;
    if (word && !saveKey) continue;
    out.push({ key, label, cite, value, ...(row.gate?.kind ? { gate: plain(row.gate) } : {}), ifHas: refsOf(row.ifHas), saves: saveKey ? [saveKey] : [] });
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
 * @param {string[]} [o.endsOn]  `modParts`' answer: what the record ends on
 */
export function modRecordData(card, parts, { spell, startTime, item = null, sourceAlignment = null, resist, duration, lasting = false, endsOn = [] } = {}) {
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
    endsOn,
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

/**
 * The spell's own modifier on its saving throw (`save.modifier`, a level value),
 * read at a caster level: the signed figure as written, null where the import
 * read none or a per-level figure has no level yet.
 *
 * @param {{modifier?: unknown}|null|undefined} save  the spell's `save` figures
 * @param {number|null} level
 * @returns {number|null}
 */
export const saveModifierOf = (save, level) => modifierFigure({ value: save?.modifier }, level);

/**
 * The part the spell's own save modifier is on each target's throw, once the seat
 * has switched it on for the cast: one part named by the spell, its figure the
 * card's level reading (the casting seat and the relay both read it here, so the
 * throw's bounds agree). None where it is off or has no figure.
 *
 * @param {{modifier?: unknown}|null|undefined} save
 * @param {{level: number|null, applied: boolean, label: string}} o
 * @returns {Array<{key: string, label: string, value: number}>}
 */
export function spellSaveParts(save, { level, applied, label }) {
  const value = applied === true ? saveModifierOf(save, level) : null;
  return value == null || value === 0 ? [] : [{ key: "spell:save", label: String(label ?? ""), value }];
}

/**
 * The creature kinds a cast offers for its `pickKind` rows: the union of their
 * authored `vsKinds`, each once, in the order the rows list them. One pick covers
 * every such row (`modParts` narrows each to it).
 *
 * @param {Array<{row: object}>} rows  the cast's kept rows
 * @returns {string[]}
 */
export function kindChoices(rows) {
  const out = [];
  for (const { row } of rows ?? []) {
    if (row?.pickKind !== true) continue;
    for (const kind of Array.from(row.vsKinds ?? []).map(String)) if (!out.includes(kind)) out.push(kind);
  }
  return out;
}
