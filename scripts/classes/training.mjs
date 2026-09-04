/* global game, fromUuidSync */
/**
 * The class's combat training as something a Judge can EDIT, slot by slot —
 * and the answer to WHERE each piece of a character's training came from.
 *
 * `apply.mjs` writes the training effect; this reads and rewrites the grants
 * inside it. The two are deliberately separate concerns: applying a class
 * REPLACES the effect wholesale from the class document, while these edits
 * adjust the copy already on the character — which is the point of the copy
 * (a character's training is theirs, and editing the class should not retrain
 * everyone who ever took it).
 *
 * A weapon edit is made at the granularity of the UNIT — one weapon — or of
 * any wider clause the grammar has (a category, a size, every missile,
 * everything), and the grant is always written back in canonical form
 * (`equipment/training-view.mjs`): the shortest clause list that covers
 * exactly the units now granted, in a fixed order. Nothing is ever widened by
 * an edit, because a single weapon can always be named; nothing needs to stay
 * explicit for a later edit's sake, because the canonical form is a function
 * of the set and not of its history. A token nothing recognises is kept as
 * written through every edit.
 *
 * Armour is a ladder and edits like one: a rung sets the ceiling, the ceiling
 * clears it. Styles toggle. The shield is not an armour rung — it is the
 * Weapon & Shield style, and toggling it toggles that.
 *
 * A character whose class states no training has no effect to edit; the first
 * edit made by hand creates one, stamped `fromClass: "manual"`, which applying
 * a class later replaces the way it replaces any training it wrote.
 */
import { MODULE_ID, FLAG_FROM_CLASS, LANG_PREFIX } from "./constants.mjs";
import { SLOT_VOCAB, weaponTokenClasses, abilityContributions } from "../lib/proficiency-strip.mjs";
import { appliedEffects } from "../lib/effect-scan.mjs";
import { coveredUnits, grantTokens, toggledGrant } from "../equipment/training-view.mjs";
import { bridgeContributions } from "../equipment/abilities-bridge.mjs";
import { pathTrainingChanges, actorPaths } from "./paths.mjs";
import { syncClassTraining } from "./apply.mjs";

/** Change keys the training effect writes, one per slot group. */
const KEY = Object.freeze({
  weapons: `flags.${MODULE_ID}.weaponProf`,
  armour: `flags.${MODULE_ID}.armourProficiency`,
  styles: `flags.${MODULE_ID}.styleProficient`,
});

/** The stamp a hand-made training effect carries instead of a class uuid. */
export const MANUAL_TRAINING = "manual";

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");

/** Every module-managed training effect on an actor: the class's, and a path option's. */
export function trainingEffects(actor) {
  return (actor?.effects ?? []).filter((e) => e.getFlag?.(MODULE_ID, FLAG_FROM_CLASS));
}

/** The first module-managed training effect on an actor, or null. */
export const trainingEffect = (actor) => trainingEffects(actor)[0] ?? null;

/** The raw value of one slot group's change, or "" when the effect grants none. */
function rawValue(effect, group) {
  return String((effect?.changes ?? []).find((c) => c.key === KEY[group])?.value ?? "");
}

/** The effect an edit of `group` targets: the one already carrying the change, else the first. */
function targetEffect(actor, group) {
  const mine = trainingEffects(actor);
  return mine.find((e) => (e.changes ?? []).some((c) => c.key === KEY[group])) ?? mine[0] ?? null;
}

/**
 * Which slot keys of a group this effect grants, at CLASS granularity — what
 * the system sheet's injected section still draws as chips.
 *
 * Weapons are read through `weaponTokenClasses`, the one resolver of the grant
 * grammar at class granularity. Armour is a LADDER, not a set: the stored
 * value is the heaviest rung allowed, so every rung at or below it reads as
 * granted.
 * @returns {Set<string>} normalised slot keys (`SLOT_VOCAB[group][].key`)
 */
export function grantedKeys(effect, group) {
  const value = rawValue(effect, group);
  const slots = SLOT_VOCAB[group] ?? [];
  if (group === "armour") {
    const rank = slots.findIndex((s) => s.key === norm(value));
    return new Set(rank < 0 ? [] : slots.slice(0, rank + 1).map((s) => s.key));
  }
  if (group === "weapons") return new Set(grantTokens(value).flatMap((t) => weaponTokenClasses(t)));
  const tokens = value.split(",").map(norm).filter(Boolean);
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
  // v14 names a change by its string `type`; the numeric `mode` is a shim
  // whose setter would turn a string into NaN.
  else changes.push({ key: KEY[group], type: "add", value, priority: 20 });
  return changes;
}

/**
 * The training effect a hand edit writes into, created when the actor has
 * none. A class applied later deletes it with everything else it stamped.
 */
export async function ensureTrainingEffect(actor) {
  const have = trainingEffect(actor);
  if (have) return have;
  const [made] = await actor.createEmbeddedDocuments("ActiveEffect", [
    {
      name: game.i18n.localize(`${LANG_PREFIX}.training.manual`),
      img: "icons/svg/upgrade.svg",
      changes: [],
      transfer: false,
      disabled: false,
      flags: { [MODULE_ID]: { [FLAG_FROM_CLASS]: MANUAL_TRAINING } },
    },
  ]);
  return made ?? null;
}

/**
 * Toggle one slot of the class training on or off.
 *
 * Weapons take ANY grant token — a weapon key, a category, `melee:<size>`,
 * `missile:all`, `all`: ON adds every unit the token covers, OFF removes
 * them, and the grant is rewritten canonically. Armour is a ladder: a rung
 * SETS the ceiling, and the rung that is already the ceiling clears the grant
 * — a character trained in heavy armour but not light is not a state the
 * profile has. `shield` is the Weapon & Shield style by another name.
 *
 * @param {Actor} actor
 * @param {"styles"|"weapons"|"armour"} group
 * @param {string} key a slot key or, for weapons, any grant token
 * @param {{create?: boolean, on?: boolean|null}} [options] `create` the effect
 *   when the actor has none; `on` forces the direction of a weapon toggle
 *   (a chip lit at class granularity for a partly covered category withdraws
 *   on click rather than completing it)
 * @returns {Promise<boolean>} whether anything was written
 */
export async function toggleTraining(actor, group, key, { create = false, on = null } = {}) {
  if (group === "armour" && key === "shield") return toggleTraining(actor, "styles", "weaponshield", { create });
  if (!SLOT_VOCAB[group]) return false;
  let effect = targetEffect(actor, group);
  if (!effect && create) effect = await ensureTrainingEffect(actor);
  if (!effect) return false;
  const slots = SLOT_VOCAB[group];

  let value;
  if (group === "weapons") {
    value = toggledGrant(rawValue(effect, "weapons"), key, on);
    if (value == null) return false;
  } else {
    const slot = slots.find((s) => s.key === key);
    if (!slot) return false;
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
  }
  await effect.update({ changes: withGroup(effect, group, value) });
  return true;
}

/** Does the actor have a class training effect to edit at all? */
export const hasTraining = (actor) => trainingEffect(actor) !== null;

/** The class document a training effect was copied from, or null (a hand-made one, or a class since deleted). */
export function trainingClassItem(actor) {
  const uuid = trainingEffect(actor)?.getFlag?.(MODULE_ID, FLAG_FROM_CLASS);
  if (!uuid || uuid === MANUAL_TRAINING) return null;
  try {
    const item = fromUuidSync(uuid);
    return item?.type === `${MODULE_ID}.class` ? item : null;
  } catch {
    return null;
  }
}

/**
 * Put the class's printed training back: re-apply the training alone, which
 * replaces every effect this module stamped — the standing undo for a hand
 * edit. False when there is no class document to read it from.
 */
export async function resetTraining(actor) {
  const classItem = trainingClassItem(actor);
  if (!classItem) return false;
  await syncClassTraining(actor, classItem);
  return true;
}

/** The class this training was copied from, for a section's subtitle. */
export function trainingSourceName(actor) {
  const uuid = trainingEffect(actor)?.getFlag?.(MODULE_ID, FLAG_FROM_CLASS);
  if (!uuid) return "";
  if (uuid === MANUAL_TRAINING) return game.i18n.localize(`${LANG_PREFIX}.training.manual`);
  return actor?.system?.details?.class || game.i18n.localize("ACKS.details.class");
}

/* -------------------------------------------- */
/*  Provenance                                   */
/* -------------------------------------------- */

/** Change keys read for provenance, by slot group; `armorTraining` is a count of rungs, not a rung. */
const DOMAIN_KEYS = Object.freeze({
  weapons: [`flags.${MODULE_ID}.weaponProf`, `flags.${MODULE_ID}.martialWeapons`],
  armour: [`flags.${MODULE_ID}.armourProficiency`, `flags.${MODULE_ID}.armorTraining`],
  styles: [`flags.${MODULE_ID}.styleProficient`],
});
const BRIDGE_DOMAINS = Object.freeze({ weapons: ["weaponProf", "martialWeapons"], armour: ["armourProficiency", "armorTraining"], styles: ["styleProficient"] });
const ACTOR_FLAG = Object.freeze({ weapons: "weaponProficiency", armour: "armorMax", styles: "styles" });

const csvTokens = (v) => (Array.isArray(v) ? v.map(String) : String(v ?? "").split(",")).map((s) => s.trim()).filter(Boolean);

/**
 * Where each piece of the character's training comes from — one contribution
 * per source per group, tokens as written:
 *   class    the class's own training effect (or a path option's)
 *   effect   any other effect carrying a training change (an item's, a hand's)
 *   ability  an ability item read through the abilities model
 *   flag     the actor's own profile flag (the Configure Proficiencies macro)
 * Explains; never decides — the lit state is the profile's own answer.
 * @returns {{weapons: object[], armour: object[], styles: object[]}}
 */
export function trainingProvenance(actor) {
  const out = { weapons: [], armour: [], styles: [] };
  if (!actor) return out;
  for (const effect of appliedEffects(actor)) {
    if (effect.disabled) continue;
    const fromClass = !!effect.getFlag?.(MODULE_ID, FLAG_FROM_CLASS);
    for (const [group, keys] of Object.entries(DOMAIN_KEYS)) {
      const tokens = (effect.changes ?? []).filter((c) => keys.includes(c.key)).flatMap((c) => csvTokens(c.value));
      if (tokens.length) out[group].push({ source: fromClass ? "class" : "effect", name: effect.name ?? "", tokens });
    }
  }
  for (const c of abilityContributions(actor)) {
    const group = c.category === "fightingStyle" ? "styles" : c.category === "weaponProficiency" ? "weapons" : c.category === "armorProficiency" ? "armour" : null;
    if (group && c.tokens.length) out[group].push({ source: "ability", name: c.name, tokens: c.tokens });
  }
  let bridged = null;
  try {
    bridged = bridgeContributions(actor);
  } catch {
    bridged = null;
  }
  for (const [group, domains] of Object.entries(BRIDGE_DOMAINS)) {
    for (const domain of domains) {
      for (const [name, tokens] of bridged?.origins?.get(domain) ?? []) {
        if (tokens.size) out[group].push({ source: "ability", name, tokens: [...tokens] });
      }
    }
  }
  for (const [group, flag] of Object.entries(ACTOR_FLAG)) {
    const v = actor.getFlag?.(MODULE_ID, flag);
    const tokens = csvTokens(v);
    if (tokens.length) out[group].push({ source: "flag", name: "", tokens });
  }
  return out;
}

/**
 * What the class PRINTS: the training its document states plus the chosen
 * path options', as token lists per group — or null when the class document
 * cannot be found (a hand-made training, a class since deleted), in which
 * case no edit can be told from a printed grant.
 * @returns {{weapons: string[], armour: string, styles: string[]}|null}
 */
export function printedTraining(actor) {
  const classItem = trainingClassItem(actor);
  if (!classItem) return null;
  // A document's `effects` is an EmbeddedCollection — iterable, with `map`
  // and `filter`, but no `flatMap`; spread it to an array before reading.
  const changes = [
    ...Array.from(classItem.effects ?? []).flatMap((e) => e.changes ?? []),
    ...pathTrainingChanges(classItem.system, actorPaths(actor)),
  ];
  const of = (group) => changes.filter((c) => c.key === KEY[group]).flatMap((c) => csvTokens(c.value));
  return { weapons: of("weapons"), armour: of("armour").at(-1) ?? "", styles: of("styles") };
}

/** The class effects' own grant per group, the same shape as `printedTraining`. */
export function classTraining(actor) {
  const mine = trainingEffects(actor);
  const of = (group) => mine.flatMap((e) => csvTokens(rawValue(e, group)));
  return { weapons: of("weapons"), armour: of("armour").at(-1) ?? "", styles: of("styles") };
}

/**
 * Which slots differ between what the class effect holds and what the class
 * prints — the badge. Empty sets when nothing is printed to compare against.
 * @returns {{weapons: Set<string>, armour: Set<string>, styles: Set<string>, known: boolean}}
 */
export function editedSlots(actor) {
  const printed = printedTraining(actor);
  const empty = { weapons: new Set(), armour: new Set(), styles: new Set(), known: false };
  if (!printed) return empty;
  const now = classTraining(actor);
  const diff = (a, b) => new Set([...a].filter((x) => !b.has(x)).concat([...b].filter((x) => !a.has(x))));
  const weapons = diff(coveredUnits(now.weapons).units, coveredUnits(printed.weapons).units);
  const rung = (v) => SLOT_VOCAB.armour.findIndex((s) => s.key === norm(v));
  const [lo, hi] = [rung(now.armour), rung(printed.armour)].sort((x, y) => x - y);
  const armour = new Set(SLOT_VOCAB.armour.slice(lo + 1, hi + 1).map((s) => s.key));
  const styles = diff(new Set(now.styles.map(norm)), new Set(printed.styles.map(norm)));
  return { weapons, armour, styles, known: true };
}
