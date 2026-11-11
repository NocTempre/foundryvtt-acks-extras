/* global game */
/**
 * Proficiency resolution — weapon, armour, and thief-skill armour gates.
 *
 * RAW proficiency comes from a character's class, which the core system does not
 * store. So the actor carries a per-actor proficiency profile via flags
 * (permissive defaults until a GM narrows them), extended by data-driven effect
 * flags from proficiency items (Martial Training, Armour Training):
 *   flags.acks-extras.weaponProficiency  "all" | CSV of categories/weapon keys
 *   flags.acks-extras.armorMax           unarmored|veryLight|light|medium|heavy
 *   flags.acks-extras.martialWeapons     (effect) CSV of added weapon categories
 *   flags.acks-extras.armorTraining      (effect) integer categories added
 * The training a character's imported proficiency items state (read through
 * lib/proficiency-strip.mjs, as the Training pills read it) widens a declared
 * weapon list or armour limit and adds fighting styles; it never declares a
 * list on its own.
 */
import { MODULE_ID, ACTOR_FLAGS, EFFECT_DOMAINS, SETTINGS } from "./constants.mjs";
import { ARMOR_LADDER, ARMOR_GATED_SKILLS, ARMOR_GATE_MAX } from "./config.mjs";
import { slug, SELECTION_VOCAB, matchSelectionKey } from "../lib/vocab.mjs";
import { keyForName, hasWeaponRows } from "../lib/weapons.mjs";
import { abilityContributions, abilityGrants, weaponTokenClasses } from "../lib/proficiency-strip.mjs";
import { collectStringFlags, sumEffectModifiers } from "./effects.mjs";

/**
 * Is proficiency ENFORCEMENT live?
 *
 * This module infers proficiency from its own `flags.acks-extras.*` actor
 * flags and effect markers — what the class's training sets (character sheet →
 * Stats tab → Training block) and what imported proficiency abilities carry:
 * weapon and armour proficiency lists, and fighting styles. The weapon and
 * armour resolvers stay PERMISSIVE when the actor carries no such flags (no
 * list ⇒ proficient), so an un-configured character is not penalised for those.
 * A trained fighting STYLE, however, is required to use any weapon at all
 * (RR p. 15), so a weapon-wielding character with no trained style reads as
 * non-proficient once enforcement is on — configure the class's training (a
 * style plus the weapon/armour lists) or give the character the proficiency
 * abilities, and the gate is correct.
 *
 * The abilities feature owns a richer model of the same facts but cannot yet
 * express the base class proficiency LISTS; its POSITIVE grants (Weapon
 * Finesse, a specialization's style, Martial/Armour Training, Weapon Focus)
 * still apply through the bridge regardless of this setting.
 *
 * The `proficiencyEnforcement` world setting selects the policy:
 *   "on"   (default) — always enforce; a declared training limit is real.
 *   "auto"           — enforce only while `acksExtras.abilities` is absent.
 *                      The abilities feature assigns it unconditionally at
 *                      init, so in a running world this reads as "off".
 *   "off"            — never enforce; all proficiency gating goes permissive.
 *
 * Scope: this toggles the PENALTIES (the non-proficient use package, RR p. 15:
 * attacks as a 0th-level fighter, no attribute bonus to attack or AC), not the
 * module. Equip limits, containers, wear buckets, the loadout effect, and
 * bridged acks-abilities bonuses are unaffected.
 */
export function enforcementActive() {
  let mode = "on";
  try {
    mode = game.settings?.get?.(MODULE_ID, SETTINGS.PROFICIENCY_ENFORCEMENT) ?? "on";
  } catch {
    // Settings not registered yet, or a bare harness — assume the default.
  }
  if (mode === "on") return true;
  if (mode === "off") return false;
  return !globalThis.acksExtras?.abilities; // "auto" — off while the abilities feature is present
}

/** Ladder index of an armour category (higher = heavier); -1 if unknown. */
export function armorRank(category) {
  return ARMOR_LADDER.indexOf(category);
}

/** Raise an armour category up the ladder by `steps`, clamped. */
function raiseCategory(category, steps) {
  const i = armorRank(category);
  if (i < 0) return category;
  return ARMOR_LADDER[Math.min(ARMOR_LADDER.length - 1, i + Math.max(0, steps))];
}

/** Known weapon-category tokens (JJ p. 290 narrow/broad groupings). */
const CATEGORY_TOKENS = new Set(["axe", "bow", "crossbow", "flailhammermace", "sworddagger", "spearpolearm", "other"]);

/** Weapon sizes (RR p. 127) — the axis broad choices i and ii select on. */
const SIZE_TOKENS = new Set(["tiny", "small", "medium", "large"]);

/**
 * Canonicalise a grant token.
 *
 * The only liberty taken is the bare SIZE: the book writes broad choices i and
 * ii by melee weapon size, so `tiny,small,medium` is what a Judge types — and both size-based choices are melee, so a bare size can
 * only mean `melee:<size>`. Accepting it here means the shorthand works
 * everywhere a grant is read (the macro, an actor flag, a class-training effect)
 * rather than in one of them.
 */
export function normalizeGrantToken(token) {
  const t = String(token ?? "").trim().toLowerCase();
  return SIZE_TOKENS.has(t) ? `melee:${t}` : t;
}

/** The canonical weapon-table key a token names (aliases resolved), or "". */
function weaponTokenKey(token) {
  return keyForName(token) ?? "";
}

/**
 * What KIND of grant a token is — the grammar, made inspectable so a
 * configuration UI can offer the vocabulary instead of asking for it blind, and
 * can say when a token will never match anything.
 * @returns {"all"|"missile"|"meleeSize"|"category"|"weapon"|"unknown"|""}
 */
export function classifyGrantToken(token) {
  const t = normalizeGrantToken(token);
  if (!t) return "";
  if (t === "all") return "all";
  if (t === "missile:all") return "missile";
  if (t.startsWith("melee:")) return SIZE_TOKENS.has(t.slice(6)) ? "meleeSize" : "unknown";
  if (t.startsWith("weapon:")) return weaponTokenKey(t.slice(7)) ? "weapon" : "unknown";
  if (CATEGORY_TOKENS.has(slug(t))) return "category";
  return weaponTokenKey(t) ? "weapon" : "unknown";
}

/**
 * What one grant token says of one weapon profile: `true` it covers it,
 * `false` it does not, `null` it cannot say. A token cannot say where the
 * figure it asks of the profile is not imported: a size grant against a weapon
 * of no stated size, a category grant against one of no stated class, and a
 * weapon name or key when the weapon table holds no rows to resolve it by. A
 * token outside the grammar is `false` while the table holds rows.
 */
export function grantVerdict(token, profile) {
  const t = normalizeGrantToken(token);
  if (!t) return false;
  if (t === "all") return true;
  if (t === "missile:all") return !!profile.missile;
  if (t.startsWith("melee:")) {
    if (!profile.melee) return false;
    return profile.size == null ? null : String(profile.size).toLowerCase() === t.slice(6);
  }
  // `weapon:<key>` names ONE weapon even where the bare key is also a category
  // (`crossbow` is both): the category reading wins on a bare token, so a
  // writer that means the single weapon says so.
  const named = (name) => {
    const key = weaponTokenKey(name);
    if (!key) return hasWeaponRows() ? false : null;
    return profile.key === key;
  };
  if (t.startsWith("weapon:")) return named(t.slice(7));
  if (CATEGORY_TOKENS.has(slug(t))) return profile.cat == null ? null : String(profile.cat).toLowerCase() === slug(t);
  return named(t);
}

/**
 * Does one grant token cover one weapon profile? Only a token that says so
 * does: a token that cannot say (`grantVerdict` null) covers nothing here, and
 * `isWeaponProficient` is what treats it as undecided rather than as a refusal.
 *
 * Grant-token grammar for class training (JJ p. 290). A proficiency grant is a
 * CSV of tokens; the class's selection chunks are expressed with these:
 *   all                 unrestricted
 *   missile:all         every missile weapon (broad choice v)
 *   melee:<size>        melee weapons of that size — broad choices i and ii are
 *                       size-based, not category-based, so sizes are
 *                       first-class here. A
 *                       bare `tiny` / `small` / `medium` / `large` means this.
 *   <category>          axe | bow | crossbow | flailHammerMace | swordDagger |
 *                       spearPolearm | other
 *   <weaponKey>         a single named weapon (the restricted list), by any name
 *                       the weapon table knows — "Great Sword" reaches twohandedsword
 *   weapon:<key>        the same, written so it cannot be read as a category
 *                       where the key is also one (`crossbow`)
 *
 * A token outside the grammar (`classifyGrantToken` → "unknown") matches
 * nothing. That is not a silent no-op: a profile with ONLY unknown tokens still
 * counts as a declared restriction, so the actor reads as non-proficient with
 * everything. The Configure Proficiencies macro warns rather than let that pass.
 */
export function grantMatches(token, profile) {
  return grantVerdict(token, profile) === true;
}

/**
 * The weapon grant tokens the character's imported proficiency items state,
 * in this file's grant grammar. A pick the sheet's vocabulary names is its
 * key, and a pick the grammar already reads (one named weapon) is itself;
 * anything else is placed at class granularity by `weaponTokenClasses`, the
 * reading that lights the Training pill.
 */
function abilityWeaponTokens(actor) {
  const out = [];
  for (const { category, tokens } of abilityContributions(actor)) {
    if (category !== "weaponProficiency") continue;
    for (const pick of tokens) {
      const read = [matchSelectionKey(SELECTION_VOCAB.weaponProficiency, pick), pick].find((t) => t && !["", "unknown"].includes(classifyGrantToken(t)));
      if (read) out.push(normalizeGrantToken(read));
      else for (const k of weaponTokenClasses(pick)) if (CATEGORY_TOKENS.has(k)) out.push(k);
    }
  }
  return out;
}

/**
 * The actor's resolved weapon proficiency: the per-actor profile flag, the
 * class-training chunks and Martial Training grants carried as effect
 * markers, and the training the character's imported proficiency items
 * state.
 * @returns {{all:boolean, tokens:Set<string>}}
 */
export function weaponProficiency(actor) {
  const tokens = new Set();
  const add = (t) => {
    const token = normalizeGrantToken(t);
    if (token) tokens.add(token);
  };
  for (const t of collectStringFlags(actor, EFFECT_DOMAINS.WEAPON_PROF)) add(t);
  for (const t of collectStringFlags(actor, EFFECT_DOMAINS.MARTIAL_WEAPONS)) add(t);
  const flag = actor.getFlag?.(MODULE_ID, ACTOR_FLAGS.WEAPON_PROF);
  if (flag != null) String(flag).split(",").forEach(add);
  // No profile and no training chunks: stay permissive rather than penalise
  // every un-configured character. A profile that parses to NO tokens (blank,
  // or nothing but separators) is likewise no profile — reading it as
  // "proficient with nothing" turned a slip of the keyboard into a character
  // non-proficient with every weapon it owns, and said nothing about it.
  if (!tokens.size) return { all: true, tokens };
  // An imported proficiency's training widens a declared list; it never
  // declares one, so a character with no list stays permissive above.
  for (const t of abilityWeaponTokens(actor)) tokens.add(t);
  return { all: tokens.has("all"), tokens };
}

/**
 * Is a weapon (resolved profile) one the actor is proficient with?
 *
 * Something every character may throw (`profile.anyoneThrows`: a flask, a
 * bottle, a rock, a torch — RR ch. 1, Weapon Proficiency) is proficient
 * whatever the grants say, except swung in melee: only the throw is everyone's.
 * With no `attack` the question is whether carrying it equipped is the
 * non-proficient use package, and it is not, since every class can throw it.
 *
 * A weapon the grants cannot decide is proficient: where a figure a grant asks
 * of the weapon is not imported (`grantVerdict` null) and no grant covers it,
 * nothing refuses it. `weaponProficiencyDecided` names that state for a surface
 * that says "not imported".
 *
 * @param {{attack?: "melee"|"missile"|"thrown"|null, grantsOnly?: boolean}} [options]
 *   `grantsOnly` answers what the grants cover and nothing else — the Training
 *   pills, which edit grants and must not light for a rule that is not one,
 *   nor for a weapon they cannot decide.
 */
export function isWeaponProficient(actor, profile, prof = weaponProficiency(actor), { attack = null, grantsOnly = false } = {}) {
  if (!enforcementActive()) return true; // kill switch: never penalise
  if (!grantsOnly && profile?.anyoneThrows && !(attack === "melee" && profile.melee)) return true;
  const coverage = grantCoverage(prof, profile);
  return coverage === "covered" || (coverage === "undecided" && !grantsOnly);
}

/** Do the grants cover the weapon, refuse it, or fail to say? */
function grantCoverage(prof, profile) {
  if (prof.all) return "covered";
  let undecided = false;
  for (const token of prof.tokens) {
    const verdict = grantVerdict(token, profile);
    if (verdict === true) return "covered";
    if (verdict === null) undecided = true;
  }
  return undecided ? "undecided" : "refused";
}

/**
 * Can the actor's grants decide this weapon? False when a grant asks of it a
 * figure that is not imported and none covers it: the weapon reads as
 * proficient (`isWeaponProficient`), and a surface says why instead of
 * showing a verdict. True for an actor with no declared list, which decides
 * nothing and refuses nothing.
 */
export function weaponProficiencyDecided(actor, profile, prof = weaponProficiency(actor)) {
  return grantCoverage(prof, profile) !== "undecided";
}

/**
 * Highest armour category the actor may wear without penalty: the best of the
 * per-actor profile flag, any class-training chunk and the armour training an
 * imported proficiency item states, then raised by Armour Training. With
 * neither flag nor chunk we stay permissive ("heavy") rather than penalise an
 * un-configured character.
 */
export function armorMax(actor) {
  const granted = [...collectStringFlags(actor, EFFECT_DOMAINS.ARMOR_PROF)];
  const flag = actor.getFlag?.(MODULE_ID, ACTOR_FLAGS.ARMOR_MAX);
  const candidates = [...granted];
  if (flag) candidates.push(String(flag).toLowerCase());
  // An imported proficiency raises a declared limit and never declares one.
  // The strips' armour ladder is this one, rung for rung.
  const abilityRung = candidates.length ? ARMOR_LADDER[abilityGrants(actor).armourRank] : undefined;
  if (abilityRung) candidates.push(abilityRung);
  // Compare case-insensitively against the ladder (which is camelCase).
  const rankOf = (c) => ARMOR_LADDER.findIndex((l) => l.toLowerCase() === String(c).toLowerCase());
  let base = "heavy";
  if (candidates.length) {
    base = candidates.reduce((best, c) => (rankOf(c) > rankOf(best) ? c : best), candidates[0]);
    const i = rankOf(base);
    base = i >= 0 ? ARMOR_LADDER[i] : "heavy";
  }
  const training = sumEffectModifiers(actor, EFFECT_DOMAINS.ARMOR_TRAINING);
  return raiseCategory(base, training);
}

/** Is a worn armour item within the actor's proficiency? Shields are style-gated. */
export function isArmorProficient(actor, armorItem, max = armorMax(actor)) {
  if (!enforcementActive()) return true; // kill switch: never penalise
  const cat = armorItem?.system?.type;
  if (!cat || cat === "shield") return true;
  const r = armorRank(cat);
  return r < 0 ? true : r <= armorRank(max);
}

/**
 * Thief-skill armour gate (JJ p. 292): Backstabbing, Hiding, Pickpocketing, and
 * Sneaking require ≤ leather (light) armour and no shield.
 * @returns {boolean} true if the gated skills are currently BLOCKED.
 */
export function thiefSkillsGated(loadout) {
  const armorCat = loadout?.armor?.system?.type ?? "unarmored";
  const overLight = armorRank(armorCat) > armorRank(ARMOR_GATE_MAX);
  const hasShield = !!loadout?.shield;
  return overLight || hasShield;
}

/** Is a named skill/ability subject to the armour gate? */
export function isArmorGatedSkill(name) {
  const n = slug(name);
  return ARMOR_GATED_SKILLS.some((s) => n.includes(slug(s)));
}

/**
 * Whether the character fights lightly equipped, by a `lightlyEquipped`
 * gate's arguments: armour no heavier than `armourMax` and a load of no more
 * than `loadMax` stone. Both arguments are read off the ability's own page
 * by its import (Swashbuckling, RR ch. 3; the bladedancer's powers, RR ch. 2
 * and JJ ch. 6), so a gate missing either cannot be decided and answers null.
 * @param {Actor} actor
 * @param {{armor?: Item|null}} loadout
 * @param {{armourMax?: string, loadMax?: number|null}} [gate]
 * @returns {boolean|null}
 */
export function lightlyEquipped(actor, loadout, { armourMax = "", loadMax = null } = {}) {
  const cap = Number(loadMax);
  if (!armourMax || armorRank(armourMax) < 0 || loadMax === null || loadMax === "" || !Number.isFinite(cap)) return null;
  const armorCat = loadout?.armor?.system?.type ?? "unarmored";
  const enc = Number(actor.system?.encumbrance?.value ?? 0);
  return armorRank(armorCat) <= armorRank(armourMax) && enc <= cap;
}
