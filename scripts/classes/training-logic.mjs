/**
 * The one shape of a class's combat training and the one builder of the
 * Active Effect changes that carry it. Foundry-free, so the harness can
 * assert it.
 *
 * A training is three groups — `weapons` (grant tokens: `all`, `missile:all`,
 * `melee:<size>`, a category, a weapon), `armour` (the heaviest rung allowed)
 * and `styles` (fighting styles) — and it travels as three `add` changes on
 * one effect, one per non-empty group. Every writer of that effect (the
 * importer, a path option, the class sheet's editor) builds its changes here,
 * and every reader (the character's training view, the edit badge) parses
 * them here, so a change written by one is always read back by the other.
 */
import { MODULE_ID } from "./constants.mjs";

/** The change key each training group is written under. */
export const TRAINING_KEYS = Object.freeze({
  weapons: `flags.${MODULE_ID}.weaponProf`,
  armour: `flags.${MODULE_ID}.armourProficiency`,
  styles: `flags.${MODULE_ID}.styleProficient`,
});

/** The groups, in the order the effect lists them. */
export const TRAINING_GROUPS = Object.freeze(["weapons", "armour", "styles"]);

/**
 * The tokens of a list given as CSV text or as an array: trimmed, empties
 * dropped, case kept. An array's elements are split too — the model casts a
 * submitted text box to a one-element array before a sheet can read it.
 */
export const trainingTokens = (value) =>
  (Array.isArray(value) ? value : [value])
    .flatMap((v) => String(v ?? "").split(","))
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * A training in canonical shape from whatever a form or a document holds:
 * lists as arrays of tokens, the armour rung as a trimmed string. A blank
 * group stays blank — an empty text box is an empty list, never `[""]`.
 * @returns {{weapons: string[], armour: string, styles: string[]}}
 */
export function normalizeTraining(raw) {
  return {
    weapons: trainingTokens(raw?.weapons),
    armour: String(raw?.armour ?? "").trim(),
    styles: trainingTokens(raw?.styles),
  };
}

/** Whether a training grants nothing in any group. */
export const trainingIsBlank = (training) => {
  const t = normalizeTraining(training);
  return !t.weapons.length && !t.armour && !t.styles.length;
};

/**
 * The effect changes that carry `training`: one `add` per non-empty group,
 * lists joined with commas. `type` is the string form — on v14 the numeric
 * `mode` is a coercing shim that would turn a string into NaN.
 */
export function trainingChanges(training) {
  const t = normalizeTraining(training);
  const changes = [];
  const add = (group, value) => {
    if (value) changes.push({ key: TRAINING_KEYS[group], type: "add", value, priority: 20 });
  };
  add("weapons", t.weapons.join(","));
  add("armour", t.armour);
  add("styles", t.styles.join(","));
  return changes;
}

/**
 * The training a list of changes states, reading every change on a group's
 * key: lists accumulate, and the armour rung is the last one written.
 * @returns {{weapons: string[], armour: string, styles: string[]}}
 */
export function trainingOf(changes) {
  const of = (group) => (changes ?? []).filter((c) => c?.key === TRAINING_KEYS[group]).flatMap((c) => trainingTokens(c.value));
  return { weapons: of("weapons"), armour: of("armour").at(-1) ?? "", styles: of("styles") };
}

/**
 * `changes` with its training replaced by `training`: the three keys are
 * rewritten (dropped where the group is blank) and every other change is kept
 * where it was. Returns a new array of copied changes.
 */
export function withTraining(changes, training) {
  const keys = new Set(Object.values(TRAINING_KEYS));
  const kept = (changes ?? []).filter((c) => !keys.has(c?.key)).map((c) => ({ ...c }));
  return [...kept, ...trainingChanges(training)];
}

/** Whether a change carries one of the training keys. */
export const isTrainingChange = (change) => Object.values(TRAINING_KEYS).includes(change?.key);

/**
 * The effect on a class document that carries its training — the first one
 * with a training change — or null when the class states none.
 */
export function classTrainingEffect(classItem) {
  for (const effect of classItem?.effects ?? []) {
    if ((effect.changes ?? []).some(isTrainingChange)) return effect;
  }
  return null;
}

/**
 * Keys a training write never compares or sends: identity, core's metadata,
 * and the `start` core stamps on an effect the moment an actor receives it
 * (world time, combat), which no class effect states.
 */
const UNCOMPARED = new Set(["_id", "_stats", "start"]);

const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const canon = (v) =>
  Array.isArray(v) ? v.map(canon) : isPlain(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/** Whether merging `want` into `have` leaves it as it is: objects by the keys `want` names, anything else whole. */
const covers = (have, want) =>
  isPlain(want) && isPlain(have) ? Object.keys(want).every((k) => covers(have[k], want[k])) : same(have, want);

/**
 * Whether writing `want` over the held effect `have` changes it. This module's
 * flags compare whole, because the write replaces them whole; every other
 * field compares the way an update merges.
 */
function trainingDiffers(have, want) {
  const { flags: wantFlags = {}, ...wantBody } = want;
  const { flags: haveFlags = {}, ...haveBody } = have;
  const { [MODULE_ID]: wantOwn = {}, ...wantOther } = wantFlags;
  const { [MODULE_ID]: haveOwn = {}, ...haveOther } = haveFlags;
  const body = Object.keys(wantBody).filter((k) => !UNCOMPARED.has(k));
  return !(body.every((k) => covers(haveBody[k], wantBody[k])) && same(haveOwn, wantOwn) && covers(haveOther, wantOther));
}

/**
 * The writes that turn the training effects a character holds into the ones
 * an apply wants, made IN PLACE: each wanted effect takes over a held one —
 * the one of its own name first, else the next unclaimed — and is written
 * only where that changes it. Only a surplus is created or removed, so a
 * re-apply of the class already held writes nothing.
 *
 * In place is what keeps the character trained through the swap: a removal
 * ahead of the create leaves a moment holding no training, and a reader that
 * runs in it (the equipment loadout) writes for an untrained character.
 *
 * @param {object[]} held the held effects' source data, each with its `_id`
 * @param {object[]} wanted the effect data an apply would create
 * @returns {{update: Array<{_id: string, data: object}>, create: object[], remove: string[]}}
 */
export function planTrainingSync(held, wanted) {
  const free = [...(held ?? [])];
  const pairs = (wanted ?? []).map((want) => {
    const at = free.findIndex((h) => h.name === want.name);
    return { want, have: at < 0 ? null : free.splice(at, 1)[0] };
  });
  for (const pair of pairs) pair.have ??= free.shift() ?? null;
  const update = [];
  const create = [];
  for (const { want, have } of pairs) {
    if (!have) create.push(want);
    else if (trainingDiffers(have, want)) {
      update.push({ _id: have._id, data: Object.fromEntries(Object.entries(want).filter(([k]) => !UNCOMPARED.has(k))) });
    }
  }
  return { update, create, remove: free.map((h) => h._id) };
}
