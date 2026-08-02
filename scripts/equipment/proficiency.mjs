/* global game */
/**
 * Proficiency resolution — weapon, armour, and thief-skill armour gates.
 *
 * RAW proficiency comes from a character's class, which the core system does not
 * store. So the actor carries a per-actor proficiency profile via flags
 * (permissive defaults until a GM narrows them), extended by data-driven effect
 * flags from proficiency items (Martial Training, Armour Training):
 *   flags.acks-equipment.weaponProficiency  "all" | CSV of categories/weapon keys
 *   flags.acks-equipment.armorMax           unarmored|veryLight|light|medium|heavy
 *   flags.acks-equipment.martialWeapons     (effect) CSV of added weapon categories
 *   flags.acks-equipment.armorTraining      (effect) integer categories added
 */
import { MODULE_ID, ACTOR_FLAGS, EFFECT_DOMAINS, SETTINGS, ABILITIES_ID } from "./constants.mjs";
import { ARMOR_LADDER, ARMOR_GATED_SKILLS, ARMOR_GATE_MAX, WEAPONS, WEAPON_ALIASES, normalizeName } from "./config.mjs";
import { collectStringFlags, sumEffectModifiers, hasEffectFlag } from "./effects.mjs";

/**
 * Is proficiency ENFORCEMENT live?
 *
 * This module infers proficiency from its own `flags.acks-equipment.*` actor
 * flags and effect markers — the ones the ACKS Class Training compendium items
 * set: weapon and armour proficiency lists, and fighting styles. The weapon and
 * armour resolvers stay PERMISSIVE when the actor carries no such flags (no
 * list ⇒ proficient), so an un-configured character is not penalised for those.
 * A trained fighting STYLE, however, is required to use any weapon at all
 * (RR p.106), so a weapon-wielding character with no Class-Training style item
 * reads as non-proficient once enforcement is on — configure each character
 * with its Class Training items (a style plus the weapon/armour lists) and the
 * gate is correct.
 *
 * acks-abilities owns a richer model of the same facts but cannot yet express
 * the base class proficiency LISTS; its POSITIVE grants (Weapon Finesse, a
 * specialization's style, Martial/Armour Training, Weapon Focus) still apply
 * through the bridge regardless of this setting.
 *
 * The `proficiencyEnforcement` world setting selects the policy:
 *   "on"   (default) — always enforce; a declared Class-Training limit is real.
 *   "auto"           — enforce only while acks-abilities is NOT active (the old
 *                      default); use it if characters rely on acks-abilities and
 *                      read as falsely non-proficient.
 *   "off"            — never enforce; all proficiency gating goes permissive.
 *
 * Scope: this toggles the PENALTIES (the RR p.106 Non-Proficient Use package:
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
  return !game.modules?.get?.(ABILITIES_ID)?.active; // "auto"
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
 * ii as "any tiny, small, or medium melee weapons", so `tiny,small,medium` is
 * what a Judge types — and both size-based choices are melee, so a bare size can
 * only mean `melee:<size>`. Accepting it here means the shorthand works
 * everywhere a grant is read (the macro, an actor flag, a class-training effect)
 * rather than in one of them.
 */
export function normalizeGrantToken(token) {
  const t = String(token ?? "").trim().toLowerCase();
  return SIZE_TOKENS.has(t) ? `melee:${t}` : t;
}

/** The canonical WEAPONS key a token names (aliases resolved), or "". */
function weaponTokenKey(token) {
  const key = normalizeName(token);
  if (WEAPONS[key]) return key;
  const alias = WEAPON_ALIASES[key];
  return alias && WEAPONS[alias] ? alias : "";
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
  if (CATEGORY_TOKENS.has(normalizeName(t))) return "category";
  return weaponTokenKey(t) ? "weapon" : "unknown";
}

/**
 * Grant-token grammar for class training (JJ p. 290). A proficiency grant is a
 * CSV of tokens; the class's selection chunks are expressed with these:
 *   all                 unrestricted
 *   missile:all         every missile weapon (broad choice v)
 *   melee:<size>        melee weapons of that size — broad choices i and ii are
 *                       size-based ("any tiny, small, or medium melee weapons"),
 *                       not category-based, so sizes are first-class here. A
 *                       bare `tiny` / `small` / `medium` / `large` means this.
 *   <category>          axe | bow | crossbow | flailHammerMace | swordDagger |
 *                       spearPolearm | other
 *   <weaponKey>         a single named weapon (the restricted list), by any name
 *                       config.mjs knows — "Great Sword" reaches twohandedsword
 *
 * A token outside the grammar (`classifyGrantToken` → "unknown") matches
 * nothing. That is not a silent no-op: a profile with ONLY unknown tokens still
 * counts as a declared restriction, so the actor reads as non-proficient with
 * everything. The Configure Proficiencies macro warns rather than let that pass.
 */
export function grantMatches(token, profile) {
  const t = normalizeGrantToken(token);
  if (!t) return false;
  if (t === "all") return true;
  if (t === "missile:all") return !!profile.missile;
  if (t.startsWith("melee:")) return !!profile.melee && String(profile.size).toLowerCase() === t.slice(6);
  if (CATEGORY_TOKENS.has(normalizeName(t))) return String(profile.cat).toLowerCase() === normalizeName(t);
  const key = weaponTokenKey(t);
  return !!key && profile.key === key;
}

/**
 * The actor's resolved weapon proficiency: the per-actor profile flag, plus the
 * class-training chunks and Martial Training grants carried as effect markers.
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
  return { all: tokens.has("all"), tokens };
}

/** Is a weapon (resolved profile) one the actor is proficient with? */
export function isWeaponProficient(actor, profile, prof = weaponProficiency(actor)) {
  if (!enforcementActive()) return true; // kill switch: never penalise
  if (prof.all) return true;
  for (const token of prof.tokens) {
    if (grantMatches(token, profile)) return true;
  }
  return false;
}

/**
 * Highest armour category the actor may wear without penalty: the best of the
 * per-actor profile flag and any class-training chunk, then raised by Armour
 * Training. With neither flag nor chunk we stay permissive ("heavy") rather than
 * penalise an un-configured character.
 */
export function armorMax(actor) {
  const granted = [...collectStringFlags(actor, EFFECT_DOMAINS.ARMOR_PROF)];
  const flag = actor.getFlag?.(MODULE_ID, ACTOR_FLAGS.ARMOR_MAX);
  const candidates = [...granted];
  if (flag) candidates.push(String(flag).toLowerCase());
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
  const n = normalizeName(name);
  return ARMOR_GATED_SKILLS.some((s) => n.includes(normalizeName(s)));
}

/**
 * Swashbuckling AC bonus (RR p. 117): +1 (→+2 at L7, +3 at L13) while wearing
 * ≤ light armour and carrying ≤ 5 stone. 0 unless the actor has the proficiency.
 */
export function swashbucklingAC(actor, loadout) {
  if (!hasEffectFlag(actor, EFFECT_DOMAINS.SWASHBUCKLING)) return 0;
  const armorCat = loadout?.armor?.system?.type ?? "unarmored";
  const enc = Number(actor.system?.encumbrance?.value ?? 0);
  if (armorRank(armorCat) > armorRank("light") || enc > 5) return 0;
  const level = Number(actor.system?.details?.level ?? 1);
  return level >= 13 ? 3 : level >= 7 ? 2 : 1;
}
