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
 * A grant wider than one class is expanded on the first edit that narrows it. A
 * class granting every weapon stores the single token `all`; a class trained in
 * every missile weapon and every melee weapon up to medium size stores
 * `missile:all` and three `melee:<size>` clauses. Switching one class off
 * cannot be expressed by removing a letter from any of those, so the grant is
 * written out as the explicit class list minus the one being dropped — and a
 * size or missile clause loses its finer grain in the process (every sword,
 * not swords up to medium size), which is the cost of editing at class
 * granularity; re-applying the class restores the printed clause. Switching a
 * class ON appends its key and leaves the wider clauses as written.
 * Re-selecting everything does NOT collapse back to `all` — the explicit list
 * means the same thing to the profile, and silently rewriting a Judge's list to
 * a wildcard would discard the distinction the next edit depends on.
 */
import { MODULE_ID, FLAG_FROM_CLASS } from "./constants.mjs";
import { SLOT_VOCAB, weaponTokenClasses } from "../lib/proficiency-strip.mjs";

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

/** The weapon grant as the tokens it was written with, spelling kept. */
const weaponTokens = (value) =>
  String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Which slot keys of a group this effect grants.
 *
 * Weapons are read through `weaponTokenClasses`, the one resolver of the grant
 * grammar at class granularity: `all` shows as every class, `missile:all` as
 * the missile classes, a `melee:<size>` as every melee class, a named weapon as
 * the class it is filed under. Armour is a LADDER, not a set: the stored value
 * is the heaviest rung allowed, so every rung at or below it reads as granted.
 * @returns {Set<string>} normalised slot keys (`SLOT_VOCAB[group][].key`)
 */
export function grantedKeys(effect, group) {
  const value = rawValue(effect, group);
  const slots = SLOT_VOCAB[group] ?? [];
  if (group === "armour") {
    const rank = slots.findIndex((s) => s.key === norm(value));
    return new Set(rank < 0 ? [] : slots.slice(0, rank + 1).map((s) => s.key));
  }
  if (group === "weapons") return new Set(weaponTokens(value).flatMap((t) => weaponTokenClasses(t)));
  const tokens = value.split(",").map(norm).filter(Boolean);
  return new Set(tokens.filter((t) => slots.some((s) => s.key === t)));
}

/**
 * The weapon grant with one class switched.
 *
 * ON appends the class key and leaves every other clause as the Judge or the
 * import wrote it. OFF drops the tokens that grant this class alone — its key,
 * or a weapon filed under it — and if a wider clause (`all`, `missile:all`, a
 * `melee:<size>`) still covers the class, the whole grant is written out as the
 * explicit class list minus this one, because a wider clause cannot lose a
 * class without being expanded. A token nothing recognises covers no class and
 * is kept as written through either edit, so a typo is never silently
 * discarded by a click beside it.
 */
function toggledWeaponGrant(raw, key, slots) {
  const tokens = weaponTokens(raw);
  const resolved = tokens.map((t) => ({ t, classes: weaponTokenClasses(t) }));
  const covered = new Set(resolved.flatMap((r) => r.classes));
  if (!covered.has(key)) return [...tokens, slots.find((s) => s.key === key)?.token ?? key].join(",");
  const kept = resolved.filter((r) => !(r.classes.length === 1 && r.classes[0] === key));
  if (kept.some((r) => r.classes.includes(key))) {
    // Emit in vocabulary order, so a hand-read of the effect is stable.
    const explicit = slots.filter((s) => covered.has(s.key) && s.key !== key).map((s) => s.token ?? s.key);
    return [...explicit, ...kept.filter((r) => !r.classes.length).map((r) => r.t)].join(",");
  }
  return kept.map((r) => r.t).join(",");
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
  } else if (group === "weapons") {
    value = toggledWeaponGrant(rawValue(effect, "weapons"), key, slots);
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
