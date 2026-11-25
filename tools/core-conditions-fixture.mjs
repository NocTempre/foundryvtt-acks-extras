/**
 * Test fixture: the eleven conditions whose Active Effect carries changes in
 * core's `CONFIG.ACKS.conditions`, as the offline suites mock them.
 *
 * EVERY FIGURE HERE IS INVENTED. A mock effect that carried no `system.changes`
 * could not show a figure counted once, so each mock carries them; the values
 * come from one rule that reads neither core's source nor a page:
 *
 *   value(id, key) = base[key] + sign(base[key]) * 40 * index(id)
 *
 * where `index` is the id's place in `CONDITION_ORDER`. The keys are the ones
 * core's entries carry. Only the keys are core's; no size is.
 */

/** The ids that carry changes, in the order the value rule indexes them. */
export const CONDITION_ORDER = Object.freeze([
  "berserk", "blessed", "blinded", "charging", "disordered", "hungry",
  "infuriated", "inspired", "prone", "queasy", "shaken",
]);

/** The change keys each of the eleven carries. */
export const CONDITION_KEYS = Object.freeze({
  berserk: ["system.attack.mod.melee", "system.ac.mod"],
  blessed: ["system.attack.mod.melee", "system.attack.mod.missile", "system.ac.mod"],
  blinded: ["system.attack.mod.melee"],
  charging: ["system.attack.mod.melee"],
  disordered: ["system.ac.mod"],
  hungry: ["system.attack.mod.melee", "system.attack.mod.missile", "system.save.mod"],
  infuriated: ["system.attack.mod.melee", "system.attack.mod.missile", "system.ac.mod"],
  inspired: ["system.attack.mod.melee", "system.attack.mod.missile", "system.ac.mod"],
  prone: ["system.attack.mod.melee", "system.attack.mod.missile"],
  queasy: ["system.attack.mod.melee", "system.attack.mod.missile", "system.damage.mod.melee", "system.damage.mod.missile"],
  shaken: ["system.attack.mod.melee", "system.attack.mod.missile", "system.ac.mod"],
});

const BASE = Object.freeze({
  "system.attack.mod.melee": 21,
  "system.attack.mod.missile": -23,
  "system.ac.mod": 27,
  "system.save.mod": -29,
  "system.damage.mod.melee": 31,
  "system.damage.mod.missile": -33,
});

/** The invented figure the mock gives condition `id` on change `key`. */
export function conditionValue(id, key) {
  const index = CONDITION_ORDER.indexOf(id);
  if (index < 0 || !(key in BASE)) throw new Error(`no mock figure for ${id} on ${key}`);
  return BASE[key] + Math.sign(BASE[key]) * 40 * index;
}

/** The change rows of condition `id`, as core's entry carries them: `[{key, type: "add", value}]`. */
export const conditionChanges = (id) => (CONDITION_KEYS[id] ?? []).map((key) => ({ key, type: "add", value: conditionValue(id, key) }));

/**
 * Ids core ships that carry no change, so the reader's filter has something to
 * refuse. The last three are ids whose catalogue entry implies a condition that
 * does carry changes.
 */
export const PLAIN_CORE_IDS = Object.freeze(["restrained", "cowering", "mute", "starving", "underfed", "slumbering"]);

/** The states the mock list makes qualify as ones that bring a condition: each implies one of the eleven and may act. */
export const IMPLYING_IDS = Object.freeze(["charging", "countercharging", "retreating", "starving", "underfed"]);

/** The condition each id of `IMPLYING_IDS` brings. */
export const BROUGHT = Object.freeze({
  charging: "disordered", countercharging: "disordered", retreating: "disordered", starving: "hungry", underfed: "hungry",
});

/** The mock `CONFIG.ACKS.conditions`: the eleven with their changes, and a few ids with none. */
export function coreConditions() {
  return [
    ...CONDITION_ORDER.map((id) => ({ id, name: `core.${id}`, img: `core/${id}.svg`, system: { changes: conditionChanges(id) } })),
    ...PLAIN_CORE_IDS.map((id) => ({ id, name: `core.${id}`, img: `core/${id}.svg` })),
  ];
}

/**
 * A mock Active Effect for one status: the changes ride at `system.changes` and
 * at `changes`, as a live v14 document carries them. Pass `statuses` for an
 * effect of several, `changes` to replace the rows (a hand effect carrying none
 * passes `[]`), and `extra` for the flags, the origin or `disabled`.
 */
export function effectOf(id, { statuses = [id], changes = conditionChanges(id), name = `effect.${id}`, ...extra } = {}) {
  return { id: `fx${++made}`, name, statuses: new Set(statuses), disabled: false, system: { changes }, changes, ...extra };
}

let made = 0;

/**
 * The effect Foundry builds for a state that brings a condition: its own status
 * and the brought one, and its own changes followed by the brought condition's
 * (a state with no change of its own contributes none). Pass `extra` for the
 * name, the flags or `disabled`.
 */
export function implyingEffect(id, extra = {}) {
  const brought = BROUGHT[id];
  return effectOf(id, { statuses: [id, brought], changes: [...(CONDITION_KEYS[id] ? conditionChanges(id) : []), ...conditionChanges(brought)], ...extra });
}

/**
 * A mock actor holding `effects`. A character is shown as a prepared one is:
 * core folded every enabled effect's `ac.mod` into `system.ac.value` and its
 * `save.mod` into `system.save.mod`, from the stored `ac` and `saveMod`. A
 * monster is shown as core leaves it: the stored figures, no step folded in.
 * Each effect is given its actor (`effect.actor`, which a live document has),
 * and the actor answers `allApplicableEffects` as Foundry's does.
 */
export function actorOf(type, effects, { ac = 100, saveMod = 0, extra = {} } = {}) {
  const sum = (key) => effects
    .filter((e) => !e.disabled)
    .flatMap((e) => e.changes ?? [])
    .filter((c) => c.key === key)
    .reduce((total, c) => total + Number(c.value), 0);
  const folded = type === "character";
  const statuses = new Set(effects.filter((e) => !e.disabled).flatMap((e) => [...e.statuses]));
  const actor = {
    type,
    name: `${type}.mock`,
    uuid: `Actor.${type}.mock`,
    statuses,
    effects,
    appliedEffects: effects,
    *allApplicableEffects() { yield* effects; },
    items: [],
    system: {
      ac: { value: ac + (folded ? sum("system.ac.mod") : 0), mod: folded ? sum("system.ac.mod") : 0 },
      save: { mod: saveMod + (folded ? sum("system.save.mod") : 0) },
      saves: { death: { value: 14 }, blast: { value: 15 }, spell: { value: 16 } },
      scores: { dex: { mod: 0 }, wis: { mod: 0 } },
    },
    ...extra,
  };
  for (const effect of effects) Object.defineProperty(effect, "actor", { value: actor, enumerable: false, configurable: true, writable: true });
  return actor;
}
