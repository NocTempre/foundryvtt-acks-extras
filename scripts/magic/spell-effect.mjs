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
import { FLAG_ROLL_MODS, FLAG_TURN_LIFE, FLAG_ENDS_ON } from "../lib/constants.mjs";
import { readTurnLife } from "../lib/turn-life.mjs";
import { readEndsOn } from "../lib/ends-on.mjs";
import { sealMark } from "./cast-seal.mjs";
import { magicLightRecord } from "../lib/light.mjs";

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

/** Whether two plain values hold the same data. */
const sameData = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
 * own, naming one condition, so removing that record by id ends that condition
 * alone. The record is the effect Foundry builds for that condition
 * (`statusEffectData`, `lib/held-condition.mjs`): the statuses beyond the named
 * one are the ones its entry brings, and `system.changes` are the entry's, and
 * the record takes exactly what the builder returned (`condition`), checked
 * here, since this file reads no `CONFIG`. A record holds no change a hand
 * wrote, and one condition's figure counts once however many effects carry it
 * (`countsOnce`, `lib/roll-mods.mjs`).
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
 * @param {string[]} [cast.statuses]  The one condition's status id, and the statuses its entry brings after it, exactly as `cast.condition` has them; never with `changes`.
 * @param {{changes?: object[]}} [cast.system]  The entry's `system`, carried as `condition` has it; present only with a status.
 * @param {{statuses: string[], system?: {changes?: object[]}}} [cast.condition]  What `statusEffectData` returned for the first status. Required where `statuses` has more than one, or `system` holds a change.
 * @param {string} [cast.rowKey]  The spell row this record came from.
 * @param {object} [cast.resist]  `{kind, category, total, target, success}` of the recipient's saving throw.
 * @param {string} [cast.sourceAlignment]  The caster's alignment key, read by a row scoped to it.
 * @param {number} [cast.invocationLevel]  The whole invocation level the cast was made at; not written where it is no whole number from one up.
 * @param {number} [cast.startTime]  World time the record began; makes it flag-timed.
 * @param {{id: string, name: string}} [cast.item]  The weapon a buff names.
 * @param {"mobile"|"stationary"} [cast.held]  Marks the caster's record of a concentration spell, naming the kind held.
 * @param {{value: number, units: string}|{none: string}} [cast.tail]  What the cast's effects outlast the concentration by: a duration, or a `{none}` where the import read none.
 * @param {object} [cast.pending]  A declared spell awaiting the caster's turn: `{spellUuid, ...the answer's fields (cast-declare.mjs `ANSWER_FIELDS`), combatId, round, declaredRound, at}` (`round` is the round the declaration lapses in; a record written before `declaredRound` was stored has none). Such a record holds no status.
 * @param {{id: string|null, label: string, cite: string, sourceAlignment: string|null, parts: object[]}} [cast.rollMods]
 *   The buff lib reads at the roll (`lib/roll-mods.mjs`), written at lib's flag. A record that carries it holds no status and no changes.
 * @param {{combatId: string, combatantId: string, edge: "start"|"end", count: number, seen?: number}} [cast.turnLife]
 *   The turns the record lasts (`lib/turn-life.mjs`), written at lib's flag beside the mark, where lib lifts it at its edge by id. A flag that is not a well-formed record is not written.
 * @param {{sceneId: string, wallId: string}} [cast.seal]  The door the cast sealed, written into the mark on the caster's record (`sealMark`); a pick missing either id is not written.
 * @param {string[]} [cast.endsOn]
 *   What ends the record (`lib/ends-on.mjs` `ENDS_ON_CAUSES`), written at lib's flag, where lib's loss hooks delete it by id. Words that are no cause are not written, and none writes no flag.
 * @param {{bands: {daylight?: number|null, bright?: number|null, dim?: number|null}, cite?: string}} [cast.light]
 *   The light this record sheds (`magicLightRecord`, `lib/light.mjs`): its three band changes join `changes` and its page flag joins the module's flags. Such a record holds no status, no buff and no declaration, so the record's own deletion is the light's end.
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
  system,
  condition,
  rowKey,
  resist,
  sourceAlignment,
  invocationLevel,
  startTime,
  item,
  rollMods,
  held,
  tail,
  pending,
  turnLife,
  endsOn,
  seal,
  light,
}) {
  if (!SPELL_EFFECT_ROLES.includes(role)) throw new Error(`spellEffectData: unknown role "${role}"`);
  const figures = Array.from(system?.changes ?? []);
  const shed = light ? magicLightRecord(light) : null;
  const written = shed ? [...changes, ...shed.changes] : changes;
  if (rollMods && (statuses.length || written.length || figures.length)) throw new Error("spellEffectData: a buff record holds no status and no changes");
  if (pending && (statuses.length || written.length || figures.length)) throw new Error("spellEffectData: a pending declaration holds no status and no changes");
  if (statuses.length && written.length) throw new Error("spellEffectData: a record that holds a status holds the entry's system changes and no others");
  if (statuses.length > 1 || figures.length) {
    const same = sameData(statuses, condition?.statuses ?? []) && sameData(figures, condition?.system?.changes ?? []);
    if (!statuses.length || !same) throw new Error("spellEffectData: a record's brought statuses and changes are exactly what the builder returned for its one condition");
  }
  const mark = { spellUuid: spell.uuid, castId, casterUuid: caster.uuid, role };
  if (held) mark.held = held === "stationary" ? "stationary" : "mobile";
  if (held && tail && typeof tail === "object") mark.tail = tail;
  if (pending && typeof pending === "object") mark.pending = pending;
  if (rowKey) mark.rowKey = String(rowKey);
  if (resist) mark.resist = resist;
  if (sourceAlignment) mark.sourceAlignment = String(sourceAlignment);
  if (Number.isInteger(invocationLevel) && invocationLevel >= 1) mark.invocationLevel = invocationLevel;
  if (item?.id) mark.item = { id: String(item.id), name: String(item.name ?? "") };
  const sealed = role === "caster" ? sealMark(seal) : null;
  if (sealed) mark.seal = sealed;
  const data = {
    name: name ?? spell.name,
    img: spell.img,
    origin: spell.uuid,
    transfer,
    disabled: false,
    changes: written,
    flags: { [MODULE_ID]: { [FLAG_SPELL_EFFECT]: mark, ...shed?.flags } },
  };
  if (rollMods) data.flags[MODULE_ID][FLAG_ROLL_MODS] = rollMods;
  const life = readTurnLife(turnLife);
  if (life) data.flags[MODULE_ID][FLAG_TURN_LIFE] = life;
  const ends = readEndsOn(endsOn);
  if (ends.length) data.flags[MODULE_ID][FLAG_ENDS_ON] = ends;
  if (statuses.length) data.statuses = [...statuses];
  // The figures ride at `system.changes` alone: a change list beside them would be a second copy of the same field.
  if (figures.length) {
    delete data.changes;
    data.system = { changes: figures.map((change) => ({ ...change })) };
  }
  const timed = duration && !duration.none && Number.isFinite(duration.value) && duration.units;
  const flagTimed = statuses.length > 0 || written.length > 0 || Number.isFinite(startTime);
  if (Number.isFinite(startTime)) mark.startTime = startTime;
  if (timed && flagTimed) mark.duration = { value: duration.value, units: duration.units };
  else if (timed) data.duration = { value: duration.value, units: duration.units };
  return data;
}

/**
 * The record an Active Effect carries, `{ spellUuid, castId, casterUuid, role }` and
 * whichever of `rowKey`, `resist`, `sourceAlignment`, `invocationLevel`, `item`, `held`, `tail`, `pending` (with its `lost` stamp where the declaration was lost), `seal` (a caster's: `{sceneId, wallId}`), `startTime` and `duration` it was written with,
 * or null for an effect no cast made (or one whose mark is incomplete). A
 * record whose end has been announced also carries `ended`, the world time it
 * was stamped at (`cast-expiry.mjs`). A buff record's `rollMods` is read back
 * whole, from lib's flag beside the mark, and so is a `turnLife` (`readTurnLife`'s
 * record, with the turns seen so far).
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
  if (Number.isInteger(raw.invocationLevel) && raw.invocationLevel >= 1) record.invocationLevel = raw.invocationLevel;
  if (raw.item && typeof raw.item === "object" && raw.item.id) record.item = { id: String(raw.item.id), name: String(raw.item.name ?? "") };
  if (raw.held) record.held = raw.held === "stationary" ? "stationary" : "mobile";
  if (raw.tail && typeof raw.tail === "object") record.tail = raw.tail;
  if (raw.pending && typeof raw.pending === "object") record.pending = raw.pending;
  if (raw.role === "caster" && sealMark(raw.seal ?? {})) record.seal = sealMark(raw.seal);
  const mods = effect?.flags?.[MODULE_ID]?.[FLAG_ROLL_MODS] ?? effect?.getFlag?.(MODULE_ID, FLAG_ROLL_MODS);
  if (mods && typeof mods === "object" && Array.isArray(mods.parts)) record.rollMods = mods;
  const life = readTurnLife(effect?.flags?.[MODULE_ID]?.[FLAG_TURN_LIFE] ?? effect?.getFlag?.(MODULE_ID, FLAG_TURN_LIFE));
  if (life) record.turnLife = life;
  if (raw.startTime != null && Number.isFinite(Number(raw.startTime))) record.startTime = Number(raw.startTime);
  if (raw.duration && typeof raw.duration === "object" && Number.isFinite(Number(raw.duration.value)) && raw.duration.units) {
    record.duration = { value: Number(raw.duration.value), units: String(raw.duration.units) };
  }
  return record;
}
