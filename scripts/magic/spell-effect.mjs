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
 * `{ none }` or an absent one leaves the effect's duration at Foundry's
 * default, so the record stays until its owner removes it. `changes` and
 * `transfer` pass through untouched; a record that is only a mark carries no
 * change and does not transfer from an item.
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
 * @returns {object}
 */
export function spellEffectData({ spell, caster, castId, role, duration, changes = [], transfer = false, name }) {
  if (!SPELL_EFFECT_ROLES.includes(role)) throw new Error(`spellEffectData: unknown role "${role}"`);
  const data = {
    name: name ?? spell.name,
    img: spell.img,
    origin: spell.uuid,
    transfer,
    disabled: false,
    changes,
    flags: {
      [MODULE_ID]: {
        [FLAG_SPELL_EFFECT]: { spellUuid: spell.uuid, castId, casterUuid: caster.uuid, role },
      },
    },
  };
  if (duration && !duration.none && Number.isFinite(duration.value) && duration.units) {
    data.duration = { value: duration.value, units: duration.units };
  }
  return data;
}

/**
 * The record an Active Effect carries, `{ spellUuid, castId, casterUuid, role }`,
 * or null for an effect no cast made (or one whose mark is incomplete).
 *
 * @param {object} effect  An Active Effect document or its plain data.
 */
export function spellEffectOf(effect) {
  const raw = effect?.flags?.[MODULE_ID]?.[FLAG_SPELL_EFFECT] ?? effect?.getFlag?.(MODULE_ID, FLAG_SPELL_EFFECT);
  if (!raw || typeof raw !== "object" || !raw.castId || !SPELL_EFFECT_ROLES.includes(raw.role)) return null;
  return {
    spellUuid: String(raw.spellUuid ?? ""),
    castId: String(raw.castId),
    casterUuid: String(raw.casterUuid ?? ""),
    role: raw.role,
  };
}
