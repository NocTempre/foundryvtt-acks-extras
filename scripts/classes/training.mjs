/* global game */
/**
 * The class's combat training as something a Judge can EDIT, slot by slot.
 *
 * `apply.mjs` writes the training effect; this reads and rewrites the grants
 * inside it. The two are deliberately separate concerns: applying a class
 * REPLACES the effect wholesale from the class document, while these edits
 * adjust the copy already on the character — which is the point of the copy
 * (a character's training is theirs, and editing the class should not retrain
 * everyone who ever took it).
 *
 * WHAT IS READ HERE IS THE EFFECT'S OWN GRANT, not the character's effective
 * profile. Those are different questions and the module answers both: the
 * Inventory strip shows what the character is trained in *however it was
 * granted* (abilities, items, flags, this effect), while the Class-modifiers
 * editor shows only what THIS effect grants, because that is the only part a
 * toggle here can honestly change. A pill lit by an ability would otherwise
 * refuse to switch off and read as a broken control.
 *
 * "all" is expanded on first edit. A class granting every weapon stores the
 * single token `all`; switching one class off cannot be expressed by removing
 * a letter from that, so the grant is written out as the explicit list minus
 * the one being dropped. Re-selecting everything does NOT collapse back to
 * `all` — the explicit list means the same thing to the profile, and silently
 * rewriting a Judge's list to a wildcard would discard the distinction the
 * next edit depends on.
 */
import { MODULE_ID, FLAG_FROM_CLASS } from "./constants.mjs";
import { SLOT_VOCAB } from "../lib/proficiency-strip.mjs";

/** Change keys the training effect writes, one per slot group. */
const KEY = Object.freeze({
  weapons: `flags.${MODULE_ID}.weaponProf`,
  armour: `flags.${MODULE_ID}.armourProficiency`,
  styles: `flags.${MODULE_ID}.styleProficient`,
});

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");

/** The module-managed training effect on an actor, or null. */
export function trainingEffect(actor) {
  return (actor?.effects ?? []).find((e) => e.getFlag?.(MODULE_ID, FLAG_FROM_CLASS)) ?? null;
}

/** The raw value of one slot group's change, or "" when the effect grants none. */
function rawValue(effect, group) {
  return String((effect?.changes ?? []).find((c) => c.key === KEY[group])?.value ?? "");
}

/**
 * Which slot keys of a group this effect grants.
 *
 * Weapons expand `all` to every class, so the editor can show a wildcard grant
 * as the full set it means. Armour is a LADDER, not a set: the stored value is
 * the heaviest rung allowed, so every rung at or below it reads as granted.
 * @returns {Set<string>} normalised slot keys (`SLOT_VOCAB[group][].key`)
 */
export function grantedKeys(effect, group) {
  const value = rawValue(effect, group);
  const slots = SLOT_VOCAB[group] ?? [];
  if (group === "armour") {
    const rank = slots.findIndex((s) => s.key === norm(value));
    return new Set(rank < 0 ? [] : slots.slice(0, rank + 1).map((s) => s.key));
  }
  const tokens = value.split(",").map(norm).filter(Boolean);
  if (group === "weapons" && tokens.includes("all")) return new Set(slots.map((s) => s.key));
  return new Set(tokens.filter((t) => slots.some((s) => s.key === t)));
}

/** Write one slot group's change, dropping the change entirely when empty. */
function withGroup(effect, group, value) {
  const changes = (effect.changes ?? []).map((c) => ({ ...c }));
  const at = changes.findIndex((c) => c.key === KEY[group]);
  if (!value) {
    if (at >= 0) changes.splice(at, 1);
    return changes;
  }
  if (at >= 0) changes[at].value = value;
  else changes.push({ key: KEY[group], mode: 2, value, priority: 20 });
  return changes;
}

/**
 * Toggle one slot of the class training on or off.
 *
 * Armour is a ladder and behaves like one: clicking a rung SETS the ceiling to
 * that rung rather than punching a hole in the middle, and clicking the rung
 * that is already the ceiling clears the grant. Nothing else can be expressed
 * — a character trained in heavy armour but not light is not a state the
 * profile has.
 *
 * @param {Actor} actor
 * @param {"styles"|"weapons"|"armour"} group
 * @param {string} key a `SLOT_VOCAB[group][].key`
 * @returns {Promise<boolean>} whether anything was written
 */
export async function toggleTraining(actor, group, key) {
  const effect = trainingEffect(actor);
  if (!effect || !SLOT_VOCAB[group]) return false;
  const slots = SLOT_VOCAB[group];
  const slot = slots.find((s) => s.key === key);
  if (!slot) return false;

  let value;
  if (group === "armour") {
    const current = norm(rawValue(effect, "armour"));
    value = current === key ? "" : slot.token;
  } else {
    const granted = grantedKeys(effect, group);
    if (granted.has(key)) granted.delete(key);
    else granted.add(key);
    // Emit in vocabulary order, so a hand-read of the effect is stable.
    value = slots.filter((s) => granted.has(s.key)).map((s) => s.token ?? s.key).join(",");
  }
  await effect.update({ changes: withGroup(effect, group, value) });
  return true;
}

/** Does the actor have a class training effect to edit at all? */
export const hasTraining = (actor) => trainingEffect(actor) !== null;

/** The class this training was copied from, for the section's subtitle. */
export function trainingSourceName(actor) {
  const effect = trainingEffect(actor);
  const uuid = effect?.getFlag?.(MODULE_ID, FLAG_FROM_CLASS);
  if (!uuid) return "";
  return actor?.system?.details?.class || game.i18n.localize("ACKS.details.class");
}
