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
