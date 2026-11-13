/**
 * Enumerations and reference tables for the ACKS II Monstrous Manual, extracted
 * from the Monster Overview / Monster Creation / Monster Rules chapters (see
 * acks-rules/acks-monsters/RULES.md for the exhaustive prose extract).
 *
 * PURE DATA — no `foundry` references — so this module is imported by both the
 * runtime (config for the data model & sheet) and the Node build tooling
 * (sample-monster generation).
 *
 * Convention: each enumeration is a plain object keyed by the stored value; the
 * value carries an English `label` plus any rules metadata. Labels are plain
 * strings (single source of truth); the sheet's {{selectOptions ... localize=true}}
 * passes unknown strings through unchanged. `choicesOf()` derives the
 * { key: label } map that Foundry DataModel `choices` and <select> builders use.
 */

// Enums shared across the ACKS module family — damage / natural-weapon / vision
// / sense / movement types and alignment — plus the { key: label } choices-map
// helper now live in acks-lib (single source of truth). acks-lib's
// NATURAL_WEAPONS is the superset: it carries this sheet's sting / feeler /
// envelopment beyond its own list, so nothing is lost. Re-exported here so this
// module's own consumers keep importing them from ./config.mjs unchanged.
// `USAGE` is lib's `SPELL_LIKE_FREQ`: one frequency vocabulary for monster
// powers, abilities and item powers, and every key a sheet stored under the
// former local table is a member of it.
// Monster-specific enums (types, sizes, body forms, saves LUT, …) stay below.
export {
  choicesOf,
  DAMAGE_TYPES,
  NATURAL_WEAPONS,
  VISION_TYPES,
  SENSE_TYPES,
  MOVEMENT_TYPES,
  ALIGNMENTS,
  EFFECT_KEYS,
  CONDITION_KEYS,
  SPELL_LIKE_FREQ as USAGE,
} from "../lib/vocab.mjs";

/* -------------------------------------------- */
/*  Type, size, alignment, intelligence         */
/* -------------------------------------------- */

/** Monster types (MM Overview p.9; Creation Monster Type table p.389). */
export const MONSTER_TYPES = {
  animal: { label: "Animal" },
  beastman: { label: "Beastman" },
  construct: { label: "Construct" },
  enchanted: { label: "Enchanted Creature" },
  giant: { label: "Giant" },
  humanoid: { label: "Humanoid" },
  incarnation: { label: "Incarnation" },
  monstrosity: { label: "Monstrosity" },
  ooze: { label: "Ooze" },
  plant: { label: "Plant" },
  undead: { label: "Undead" },
  vermin: { label: "Vermin" },
};

/**
 * Size categories (MM Overview p.11; Creation Mass & Size table p.390), in
 * ascending order. The frontage each occupies on a battle grid is imported
 * (`sizes.mjs`), never held here.
 */
export const SIZES = {
  small: { label: "Small" },
  man: { label: "Man-Sized" },
  large: { label: "Large" },
  huge: { label: "Huge" },
  gigantic: { label: "Gigantic" },
  colossal: { label: "Colossal" },
};

/** Degree of intelligence (Creation p.396). */
export const INTELLIGENCE = {
  mindless: { label: "Mindless" },
  bestial: { label: "Bestial" },
  semiSapient: { label: "Semi-Sapient" },
  sapient: { label: "Sapient" },
};

/* -------------------------------------------- */
/*  Saves, treasure, ages                       */
/* -------------------------------------------- */

/** Save-as class progressions (MM Rules; abbreviations MM Overview p.12). */
export const SAVE_CLASSES = {
  fighter: { label: "Fighter (F)", abbr: "F" },
  crusader: { label: "Crusader (C)", abbr: "C" },
  mage: { label: "Mage (M)", abbr: "M" },
  thief: { label: "Thief (T)", abbr: "T" },
  dwarvenVaultguard: { label: "Dwarven Vaultguard (D)", abbr: "D" },
  dwarvenCraftpriest: { label: "Dwarven Craftpriest", abbr: "DC" },
  elvenSpellsword: { label: "Elven Spellsword (E)", abbr: "E" },
  elvenNightblade: { label: "Elven Nightblade", abbr: "EN" },
};

/** Treasure types A–R plus "none" (MM Overview p.15; Creation p.400). */
export const TREASURE_TYPES = {
  none: { label: "None" },
  ...Object.fromEntries("ABCDEFGHIJKLMNOPQR".split("").map((letter) => [letter, { label: letter, letter }])),
};

/** Age categories that make up a lifespan (MM Overview p.14; Creation p.399). */
export const AGE_CATEGORIES = {
  baby: { label: "Baby", pct: 0 },
  juvenile: { label: "Juvenile", pct: 1 },
  adolescent: { label: "Adolescent", pct: 5 },
  adult: { label: "Adult", pct: 10 },
  middleAged: { label: "Middle-Aged", pct: 40 },
  old: { label: "Old", pct: 60 },
  ancient: { label: "Ancient", pct: 80 },
  maximum: { label: "Maximum", pct: 100 },
};

/** Roles a tamed monster can be trained for (MM Overview p.14). */
export const TRAINED_ROLES = {
  guard: { label: "Guard" },
  warMount: { label: "War Mount" },
  mount: { label: "Mount" },
  workbeast: { label: "Workbeast" },
  hunter: { label: "Hunter" },
  herald: { label: "Herald" },
  other: { label: "Other" },
};

/** Reproduction offspring kinds. */
export const YOUNG_TYPES = {
  egg: { label: "Egg" },
  infant: { label: "Infant" },
  juvenile: { label: "Juvenile" },
  live: { label: "Live Young" },
  litter: { label: "Litter" },
  spawn: { label: "Spawn" },
};

/** Time units for reproduction intervals & the like. */
export const INTERVAL_UNITS = {
  day: { label: "Day(s)" },
  week: { label: "Week(s)" },
  month: { label: "Month(s)" },
  season: { label: "Season(s)" },
  year: { label: "Year(s)" },
};

/* -------------------------------------------- */
/*  Ability scores                              */
/* -------------------------------------------- */

/** Monster attribute keys (MM Rules p.349; the default score is `load-rule.mjs` `defaultScore`). */
export const ABILITY_SCORES = {
  str: { label: "STR" },
  int: { label: "INT" },
  wis: { label: "WIS" },
  dex: { label: "DEX" },
  con: { label: "CON" },
  cha: { label: "CHA" },
};

/* -------------------------------------------- */
/*  Special abilities (Creation table pp.393-4; */
/*  Overview glossary pp.16-21)                 */
/* -------------------------------------------- */

/**
 * Special-ability categories used to tag `ability` items. `xp` records the
 * XP-weight marker from the Monster Special Abilities table (* major, # minor,
 * "varies" case-by-case). `kind`: "minor" | "major" | "varies".
 */
export const SPECIAL_ABILITIES = {
  acid: { label: "Acid", xp: "*", kind: "major" },
  aura: { label: "Aura", xp: "*", kind: "major" },
  berserk: { label: "Berserk", xp: "##", kind: "minor" },
  bonusAttack: { label: "Bonus Attack", xp: "varies", kind: "varies" },
  breathWeapon: { label: "Breath Weapon", xp: "*", kind: "major" },
  charge: { label: "Charge", xp: "##", kind: "minor" },
  classPowers: { label: "Class Powers / Proficiencies", xp: "varies", kind: "varies" },
  damageImmunity: { label: "Damage Immunity", xp: "varies", kind: "varies" },
  damageResistance: { label: "Damage Resistance", xp: "varies", kind: "varies" },
  disease: { label: "Disease", xp: "varies", kind: "varies" },
  diveAttack: { label: "Dive Attack", xp: "varies", kind: "varies" },
  dreadful: { label: "Dreadful", xp: "*", kind: "major" },
  effectImmunity: { label: "Effect Immunity", xp: "varies", kind: "varies" },
  effectResistance: { label: "Effect Resistance", xp: "varies", kind: "varies" },
  enervation: { label: "Enervation", xp: "**", kind: "major" },
  enslave: { label: "Enslave", xp: "*", kind: "major" },
  flying: { label: "Flying", xp: "####", kind: "minor" },
  gazeAttack: { label: "Gaze Attack", xp: "varies", kind: "varies" },
  grabRestrain: { label: "Grab / Restrain", xp: "*", kind: "major" },
  horrific: { label: "Horrific", xp: "*", kind: "major" },
  hug: { label: "Hug", xp: "##", kind: "minor" },
  immunity: { label: "Immunity", xp: "varies", kind: "varies" },
  incorporeal: { label: "Incorporeal", xp: "*", kind: "major" },
  infectious: { label: "Infectious", xp: "##", kind: "minor" },
  invisibility: { label: "Invisibility", xp: "*", kind: "major" },
  lightningReflexes: { label: "Lightning Reflexes", xp: "##", kind: "minor" },
  magicResistance: { label: "Magic Resistance", xp: "*", kind: "major" },
  ongoingDamage: { label: "Ongoing Damage", xp: "####", kind: "minor" },
  paralysis: { label: "Paralysis", xp: "*", kind: "major" },
  petrification: { label: "Petrification", xp: "**", kind: "major" },
  poison: { label: "Poison", xp: "*", kind: "major" },
  regeneration: { label: "Regeneration", xp: "*", kind: "major" },
  resistance: { label: "Resistance", xp: "varies", kind: "varies" },
  specialSenses: { label: "Special Senses", xp: "varies", kind: "varies" },
  spellcasting: { label: "Spellcasting", xp: "varies", kind: "varies" },
  spellLike: { label: "Spell-like Abilities", xp: "varies", kind: "varies" },
  stealth: { label: "Stealth", xp: "#", kind: "minor" },
  susceptibility: { label: "Susceptibility", xp: "varies", kind: "varies" },
  swallowAttack: { label: "Swallow Attack", xp: "*", kind: "major" },
  swift: { label: "Swift", xp: "##", kind: "minor" },
  terrifying: { label: "Terrifying", xp: "*", kind: "major" },
  toppleAndFling: { label: "Topple and Fling", xp: "####", kind: "minor" },
  tough: { label: "Tough", xp: "varies", kind: "varies" },
  trample: { label: "Trample", xp: "##", kind: "minor" },
  triggeredAttack: { label: "Triggered Attack", xp: "varies", kind: "varies" },
  viciousAttack: { label: "Vicious Attack", xp: "####", kind: "minor" },
  unusual: { label: "Unusual", xp: "varies", kind: "varies" },
};

/* -------------------------------------------- */
/*  Body forms (Creation pp.389, 397; Org p.395)*/
/* -------------------------------------------- */

/**
 * Body-form reference table: AC modifier (acMod), recommended natural attacks
 * & movement, and training modifier (tm). The sheet reads only the label.
 * Draconine AC follows a special formula (acMod null).
 */
export const BODY_FORMS = {
  accipitrine: { label: "Accipitrine (raptor)", acMod: 0, attacks: "2 talons", move: "450'-480' (fly)", tm: 1 },
  aquiline: { label: "Aquiline (roc)", acMod: 1, attacks: "2 talons, 1 bite", move: "450'-480' (fly)", tm: 1 },
  apian: { label: "Apian (giant bee)", acMod: 1, attacks: "1 sting", move: "150' (fly)", tm: 0 },
  arachnine: { label: "Arachnine (spider)", acMod: 1, attacks: "1 bite", move: "60'-120', 120' (web)", tm: 2 },
  basilicine: { label: "Basilicine (basilisk)", acMod: 0, attacks: "1 bite", move: "60'", tm: 0 },
  bovine: { label: "Bovine (herd animal)", acMod: 0, attacks: "1 horn", move: "240'", tm: -1 },
  cameline: { label: "Cameline (camel)", acMod: 1, attacks: "1 bite, 1 hoof", move: "150'", tm: 1 },
  cancrine: { label: "Cancrine (giant crab)", acMod: 5, attacks: "2 pincers (large claw)", move: "60'", tm: -2 },
  canine: { label: "Canine (dog/wolf)", acMod: 0, attacks: "1 bite", move: "120'-180'", tm: 1 },
  cetacean: { label: "Cetacean (whale)", acMod: 1, attacks: "1 bite or ram", move: "180'-240' (swim)", tm: 2 },
  coleopteran: { label: "Coleopteran (beetle)", acMod: 3, attacks: "1 bite", move: "120'-150'", tm: -2 },
  crocodilian: { label: "Crocodilian (crocodile)", acMod: 3, attacks: "1 bite", move: "90', 90' (swim)", tm: -2 },
  dinosaurian: { label: "Dinosaurian (dinosaur)", acMod: 1, attacks: "1 bite; 1 tail; or 1 tusk", move: "60'-120'", tm: -1 },
  dipterous: { label: "Dipterous (carnivorous fly)", acMod: 0, attacks: "1 bite", move: "90', 180' (fly)", tm: -2 },
  draconine: { label: "Draconine (dragon)", acMod: null, attacks: "2 claws, 1 bite", move: "90', 240' (fly)", tm: 3 },
  elephantine: { label: "Elephantine (elephant)", acMod: 1, attacks: "2 tusks", move: "120'", tm: 3 },
  equine: { label: "Equine (horse)", acMod: 1, attacks: "1 or 2 hooves; or 1 bite, 1 hoof", move: "120'-240'", tm: 1 },
  feline: { label: "Feline (large cat)", acMod: 0, attacks: "2 claws, 1 bite", move: "150'-360'", tm: 1 },
  formic: { label: "Formic (giant ant)", acMod: 3, attacks: "1 bite", move: "180'", tm: 0 },
  humanoid: { label: "Humanoid", acMod: 0, attacks: "1 weapon; or 2 claws, 1 bite", move: "120'", tm: null },
  lacertine: { label: "Lacertine (giant lizard)", acMod: 1, attacks: "1 bite; 1 bite, 1 horn; or 2 claws, 1 bite", move: "120'", tm: -2 },
  monadine: { label: "Monadine (ooze)", acMod: 0, attacks: "1 envelopment", move: "0'-30'", tm: -3 },
  murine: { label: "Murine (giant rat)", acMod: 1, attacks: "1 bite", move: "120', 60' (swim)", tm: 0 },
  musteline: { label: "Musteline (weasel/ferret)", acMod: 3, attacks: "1 bite", move: "150'", tm: 0 },
  octopine: { label: "Octopine (octopus/squid)", acMod: -3, attacks: "1 bite, 8 tentacles", move: "90'-120' (swim)", tm: 1 },
  piscine: { label: "Piscine (giant fish)", acMod: 1, attacks: "1 bite, 0-4 feelers, 0-4 spines", move: "90'-180' (swim)", tm: -3 },
  porcine: { label: "Porcine (boar)", acMod: 0, attacks: "1 tusk", move: "120'-150'", tm: 2 },
  pterosaurian: { label: "Pterosaurian (pterodactyl)", acMod: 0, attacks: "1 bite", move: "180'-240' (fly)", tm: -1 },
  ranine: { label: "Ranine (giant frog/toad)", acMod: 0, attacks: "1 bite", move: "90'", tm: -2 },
  rhinocerine: { label: "Rhinocerine (rhinoceros)", acMod: 1, attacks: "1 tusk", move: "120'", tm: 0 },
  salamandrine: { label: "Salamandrine (salamander)", acMod: -1, attacks: "2-4 claws, 1 bite", move: "120'", tm: -2 },
  scolopendrine: { label: "Scolopendrine (centipede)", acMod: 0, attacks: "1 bite, 0-8 tentacles", move: "120'", tm: -3 },
  selachian: { label: "Selachian (shark)", acMod: 3, attacks: "1 bite", move: "180' (swim)", tm: -3 },
  serpentine: { label: "Serpentine (snake)", acMod: 0, attacks: "1 bite; 0-1 constriction", move: "90'-120', 120' (swim)", tm: -3 },
  simian: { label: "Simian (baboon/gorilla)", acMod: 0, attacks: "2 claws; or 1 bite, 1 weapon", move: "120'", tm: 3 },
  soricine: { label: "Soricine (giant shrew)", acMod: 3, attacks: "2 bites", move: "180'", tm: 0 },
  ursine: { label: "Ursine (bear)", acMod: 0, attacks: "2 claws, 1 bite", move: "120'", tm: 1 },
  vermian: { label: "Vermian (giant worm)", acMod: -3, attacks: "1 bite; or 1 bite, 1 sting", move: "60'", tm: -3 },
  vespertilionine: { label: "Vespertilionine (bat)", acMod: 1, attacks: "1 bite", move: "120'-180' (fly)", tm: 1 },
  wyverine: { label: "Wyverine (wyvern)", acMod: 1, attacks: "2 talons and 1 bite, 1 sting", move: "90', 240' (fly)", tm: 3 },
};

/* -------------------------------------------- */
/*  Saving-throw lookup by save-as HD           */
/* -------------------------------------------- */

/**
 * Monster saving throws by the Hit-Dice band a creature "saves as" (mirrors the
 * acks system's config.mjs `monster_saves`, remapped to current save keys).
 * Keyed by the minimum HD of each band; `savesForLevel` floors a save-as level
 * to the nearest band.
 */
export const MONSTER_SAVES_LUT = {
  0: { band: "Normal Human", paralysis: 14, death: 15, blast: 16, implements: 17, spell: 18 },
  1: { band: "1", paralysis: 13, death: 14, blast: 15, implements: 16, spell: 17 },
  2: { band: "2-3", paralysis: 12, death: 13, blast: 14, implements: 15, spell: 16 },
  4: { band: "4", paralysis: 11, death: 12, blast: 13, implements: 14, spell: 15 },
  5: { band: "5-6", paralysis: 10, death: 11, blast: 12, implements: 13, spell: 14 },
  7: { band: "7", paralysis: 9, death: 10, blast: 11, implements: 12, spell: 13 },
  8: { band: "8-9", paralysis: 8, death: 9, blast: 10, implements: 11, spell: 12 },
  10: { band: "10", paralysis: 7, death: 8, blast: 9, implements: 10, spell: 11 },
  11: { band: "11-12", paralysis: 6, death: 7, blast: 8, implements: 9, spell: 10 },
  13: { band: "13", paralysis: 5, death: 6, blast: 7, implements: 8, spell: 9 },
  14: { band: "14+", paralysis: 4, death: 5, blast: 6, implements: 7, spell: 8 },
};

/** Return the save row for a given save-as level (floors to the band). */
export function savesForLevel(level) {
  const bands = Object.keys(MONSTER_SAVES_LUT)
    .map(Number)
    .sort((a, b) => a - b);
  let chosen = 0;
  for (const b of bands) if (level >= b) chosen = b;
  return MONSTER_SAVES_LUT[chosen];
}
