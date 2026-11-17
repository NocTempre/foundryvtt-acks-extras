/**
 * The cast record: the Active Effect a cast leaves on an actor, marked so the
 * module can tell which cast made it, who cast it and which side of the cast
 * the bearer is. The mark is `flags["acks-extras"].spellEffect`; `origin` is
 * the spell's uuid, which is what the effects tab already reads as a magic
 * effect.
 *
 * FOUNDRY-FREE: these build and read plain data. The record is not a managed
 * effect (`lib/managed-effects.mjs` locks only the markers a feature
 * registers, and this one is never registered), so its owner may delete it
 * by hand and the cast it stands for simply stops being tracked.
 */
import { MODULE_ID, FLAG_SPELL_EFFECT } from "./constants.mjs";
import { FLAG_ROLL_MODS } from "../lib/constants.mjs";

/** The two sides of a cast a record can sit on. */
export const SPELL_EFFECT_ROLES = Object.freeze(["caster", "recipient"]);

/** A random id of the length asked, for hosts with no `foundry.utils.randomID`. */
const fallbackRandomId = (length) => {
  let id = "";
  while (id.length < length) id += Math.random().toString(36).slice(2);
  return id.slice(0, length);
};

/**
 * A fresh id tying together every record one cast writes (the caster's and
 * each recipient's). Uses `foundry.utils.randomID` when the host has it;
 * `randomID` injects a source for tests.
 *
 * @param {{randomID?: (length: number) => string}} [options]
 */
export function newCastId({ randomID } = {}) {
  const make = randomID ?? globalThis.foundry?.utils?.randomID ?? fallbackRandomId;
  return make(16);
}

/**
 * Active Effect creation data for one record of a cast.
 *
 * `duration` is the `{ value, units }` fragment `castDuration` returns; a
 * `{ none }` or an absent one leaves the record without a duration, so it
 * stays until its owner removes it. `changes` and `transfer` pass through
 * untouched; a record that is only a mark carries no change and does not
 * transfer from an item.
 *
 * A record that carries a status or changes, or that is given a `startTime`,
 * is timed by this module's own clock: its `duration` and `startTime` ride in
 * the flag and core's `duration` stays unset, because core counts a rounds
 * duration it cannot convert as already run. A condition rides a record of its
 * own, at most one status and never with changes, so removing that record by id
 * ends that condition alone (`toggleStatusEffect` off deletes whole records
 * that hold only the toggled status, changes included).
 *
 * @param {object} cast
 * @param {{uuid: string, name: string, img: string}} cast.spell
 * @param {{uuid: string}} cast.caster
 * @param {string} cast.castId
 * @param {"caster"|"recipient"} cast.role
 * @param {{value: number, units: string}|{none: string}} [cast.duration]
 * @param {object[]} [cast.changes]
 * @param {boolean} [cast.transfer]
 * @param {string} [cast.name]  Defaults to the spell's name.
 * @param {string[]} [cast.statuses]  At most one status id; never with `changes`.
 * @param {string} [cast.rowKey]  The spell row this record came from.
 * @param {object} [cast.resist]  `{kind, category, total, target, success}` of the recipient's saving throw.
 * @param {string} [cast.sourceAlignment]  The caster's alignment key, read by a row scoped to it.
 * @param {number} [cast.startTime]  World time the record began; makes it flag-timed.
 * @param {{id: string, name: string}} [cast.item]  The weapon a buff names.
 * @param {"mobile"|"stationary"} [cast.held]  Marks the caster's record of a concentration spell, naming the kind held.
 * @param {{value: number, units: string}|{none: string}} [cast.tail]  What the cast's effects outlast the concentration by: a duration, or a `{none}` where the import read none.
 * @param {object} [cast.pending]  A declared spell awaiting the caster's turn: `{spellUuid, mode, picks, casterLevel, situational, visibility, item, combatId, round, at}`. Such a record holds no status.
 * @param {{id: string|null, label: string, cite: string, sourceAlignment: string|null, parts: object[]}} [cast.rollMods]
 *   The buff lib reads at the roll (`lib/roll-mods.mjs`), written at lib's flag. A record that carries it holds no status and no changes.
 * @returns {object}
 */
export function spellEffectData({
  spell,
  caster,
  castId,
  role,
  duration,
  changes = [],
  transfer = false,
  name,
  statuses = [],
  rowKey,
  resist,
  sourceAlignment,
  startTime,
  item,
  rollMods,
  held,
  tail,
  pending,
}) {
  if (!SPELL_EFFECT_ROLES.includes(role)) throw new Error(`spellEffectData: unknown role "${role}"`);
  if (statuses.length > 1) throw new Error("spellEffectData: a record holds at most one status");
  if (statuses.length && changes.length) throw new Error("spellEffectData: a record that holds a status holds no changes");
  if (rollMods && (statuses.length || changes.length)) throw new Error("spellEffectData: a buff record holds no status and no changes");
  if (pending && (statuses.length || changes.length)) throw new Error("spellEffectData: a pending declaration holds no status and no changes");
  const mark = { spellUuid: spell.uuid, castId, casterUuid: caster.uuid, role };
  if (held) mark.held = held === "stationary" ? "stationary" : "mobile";
  if (held && tail && typeof tail === "object") mark.tail = tail;
  if (pending && typeof pending === "object") mark.pending = pending;
  if (rowKey) mark.rowKey = String(rowKey);
  if (resist) mark.resist = resist;
  if (sourceAlignment) mark.sourceAlignment = String(sourceAlignment);
  if (item?.id) mark.item = { id: String(item.id), name: String(item.name ?? "") };
  const data = {
    name: name ?? spell.name,
    img: spell.img,
    origin: spell.uuid,
    transfer,
    disabled: false,
    changes,
    flags: { [MODULE_ID]: { [FLAG_SPELL_EFFECT]: mark } },
  };
  if (rollMods) data.flags[MODULE_ID][FLAG_ROLL_MODS] = rollMods;
  if (statuses.length) data.statuses = [...statuses];
  const timed = duration && !duration.none && Number.isFinite(duration.value) && duration.units;
  const flagTimed = statuses.length > 0 || changes.length > 0 || Number.isFinite(startTime);
  if (Number.isFinite(startTime)) mark.startTime = startTime;
  if (timed && flagTimed) mark.duration = { value: duration.value, units: duration.units };
  else if (timed) data.duration = { value: duration.value, units: duration.units };
  return data;
}

/**
 * The record an Active Effect carries, `{ spellUuid, castId, casterUuid, role }` and
 * whichever of `rowKey`, `resist`, `sourceAlignment`, `item`, `held`, `tail`, `pending` (with its `lost` stamp where the declaration was lost), `startTime` and `duration` it was written with,
 * or null for an effect no cast made (or one whose mark is incomplete). A
 * record whose end has been announced also carries `ended`, the world time it
 * was stamped at (`cast-expiry.mjs`). A buff record's `rollMods` is read back
 * whole, from lib's flag beside the mark.
 *
 * @param {object} effect  An Active Effect document or its plain data.
 */
export function spellEffectOf(effect) {
  const raw = effect?.flags?.[MODULE_ID]?.[FLAG_SPELL_EFFECT] ?? effect?.getFlag?.(MODULE_ID, FLAG_SPELL_EFFECT);
  if (!raw || typeof raw !== "object" || !raw.castId || !SPELL_EFFECT_ROLES.includes(raw.role)) return null;
  const record = {
    spellUuid: String(raw.spellUuid ?? ""),
    castId: String(raw.castId),
    casterUuid: String(raw.casterUuid ?? ""),
    role: raw.role,
  };
  if (raw.ended != null && Number.isFinite(Number(raw.ended))) record.ended = Number(raw.ended);
  if (raw.rowKey) record.rowKey = String(raw.rowKey);
  if (raw.resist && typeof raw.resist === "object") record.resist = raw.resist;
  if (raw.sourceAlignment) record.sourceAlignment = String(raw.sourceAlignment);
  if (raw.item && typeof raw.item === "object" && raw.item.id) record.item = { id: String(raw.item.id), name: String(raw.item.name ?? "") };
  if (raw.held) record.held = raw.held === "stationary" ? "stationary" : "mobile";
  if (raw.tail && typeof raw.tail === "object") record.tail = raw.tail;
  if (raw.pending && typeof raw.pending === "object") record.pending = raw.pending;
  const mods = effect?.flags?.[MODULE_ID]?.[FLAG_ROLL_MODS] ?? effect?.getFlag?.(MODULE_ID, FLAG_ROLL_MODS);
  if (mods && typeof mods === "object" && Array.isArray(mods.parts)) record.rollMods = mods;
  if (raw.startTime != null && Number.isFinite(Number(raw.startTime))) record.startTime = Number(raw.startTime);
  if (raw.duration && typeof raw.duration === "object" && Number.isFinite(Number(raw.duration.value)) && raw.duration.units) {
    record.duration = { value: Number(raw.duration.value), units: String(raw.duration.units) };
  }
  return record;
}
