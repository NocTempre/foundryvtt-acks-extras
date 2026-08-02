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
// Monster-specific enums (types, sizes, body forms, saves LUT, …) stay below.
export {
  choicesOf,
  DAMAGE_TYPES,
  NATURAL_WEAPONS,
  VISION_TYPES,
  SENSE_TYPES,
  MOVEMENT_TYPES,
  ALIGNMENTS,
} from "../lib/vocab.mjs";

/* -------------------------------------------- */
/*  Type, size, alignment, intelligence         */
/* -------------------------------------------- */

/** Monster types (MM Overview p.9; Creation Monster Type table p.389). */
export const MONSTER_TYPES = {
  animal: { label: "Animal", saveProgression: "F(HD/2)" },
  beastman: { label: "Beastman", saveProgression: "F(HD)" },
  construct: { label: "Construct", saveProgression: "F(HD/2×1d2)" },
  enchanted: { label: "Enchanted Creature", saveProgression: "F(HD/2×2d2)" },
  giant: { label: "Giant", saveProgression: "F(HD)" },
  humanoid: { label: "Humanoid", saveProgression: "F(HD)" },
  incarnation: { label: "Incarnation", saveProgression: "F(HD/2×2d2)" },
  monstrosity: { label: "Monstrosity", saveProgression: "F(HD/4×1d8)" },
  ooze: { label: "Ooze", saveProgression: "F(HD/2)" },
  plant: { label: "Plant", saveProgression: "F(HD/2)" },
  undead: { label: "Undead", saveProgression: "F(HD)" },
  vermin: { label: "Vermin", saveProgression: "F(HD/2)" },
};

/** Size categories (MM Overview p.11; Creation Mass & Size table p.390). */
export const SIZES = {
  small: { label: "Small", weightMax: 35, acMod: 1, maxHD: 9, frontage: "1 sq or less" },
  man: { label: "Man-Sized", weightMax: 400, acMod: 0, maxHD: 9, frontage: "2/3 sq" },
  large: { label: "Large", weightMax: 2000, acMod: -1, maxHD: 13, frontage: "2×1 sq" },
  huge: { label: "Huge", weightMax: 8000, acMod: -2, maxHD: 17, frontage: "2×2 sq" },
  gigantic: { label: "Gigantic", weightMax: 32000, acMod: -4, maxHD: 25, frontage: "4×3 sq" },
  colossal: { label: "Colossal", weightMax: null, acMod: -8, maxHD: 40, frontage: "8×6 sq" },
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

/** Spell-like ability usage factors (Creation p.392). */
export const USAGE = {
  atWill: { label: "At will", factor: 1 },
  perTurn: { label: "1/turn", factor: 0.8 },
  per3Turns: { label: "1/3 turns", factor: 0.7 },
  perHour: { label: "1/hour", factor: 0.6 },
  thricePerDay: { label: "3/day", factor: 0.5 },
  perDay: { label: "1/day", factor: 0.4 },
  perWeek: { label: "1/week", factor: 0.3 },
  perMonth: { label: "1/month", factor: 0.2 },
  perSeason: { label: "1/season", factor: 0.1 },
  perYear: { label: "1/year", factor: 0.05 },
};

/* -------------------------------------------- */
/*  Ability scores                              */
/* -------------------------------------------- */

/** Monster attribute keys (MM Rules p.349; default 9 if unspecified). */
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
 * Body-form reference table: body mass exponent (bme), carrying-capacity factor
 * (ccf), AC modifier (acMod), recommended natural attacks & movement, training
 * modifier (tm) & base training months, and % chance in lair. Ranges are stored
 * as min/max; a single published value sets min === max. Draconine AC follows a
 * special formula (acMod null; see acks-rules/acks-monsters/RULES.md).
 */
export const BODY_FORMS = {
  accipitrine: { label: "Accipitrine (raptor)", bmeMin: 1.2, bmeMax: 1.4, ccfMin: 0.025, ccfMax: 0.05, acMod: 0, attacks: "2 talons", move: "450'-480' (fly)", tm: 1, trainMonths: 2, lairPct: 20 },
  aquiline: { label: "Aquiline (roc)", bmeMin: 1.63, bmeMax: 1.67, ccfMin: 0.05, ccfMax: 0.05, acMod: 1, attacks: "2 talons, 1 bite", move: "450'-480' (fly)", tm: 1, trainMonths: 2, lairPct: 20 },
  apian: { label: "Apian (giant bee)", bmeMin: 0.68, bmeMax: 0.68, ccfMin: 0.05, ccfMax: 0.05, acMod: 1, attacks: "1 sting", move: "150' (fly)", tm: 0, trainMonths: 6, lairPct: 35 },
  arachnine: { label: "Arachnine (spider)", bmeMin: 1.55, bmeMax: 1.68, ccfMin: 0.125, ccfMax: 0.125, acMod: 1, attacks: "1 bite", move: "60'-120', 120' (web)", tm: 2, trainMonths: 12, lairPct: 70 },
  basilicine: { label: "Basilicine (basilisk)", bmeMin: 1.38, bmeMax: 1.38, ccfMin: 0.066, ccfMax: 0.066, acMod: 0, attacks: "1 bite", move: "60'", tm: 0, trainMonths: 6, lairPct: 40 },
  bovine: { label: "Bovine (herd animal)", bmeMin: 1.96, bmeMax: 2.0, ccfMin: 0.02, ccfMax: 0.02, acMod: 0, attacks: "1 horn", move: "240'", tm: -1, trainMonths: 6, lairPct: null },
  cameline: { label: "Cameline (camel)", bmeMin: 2.31, bmeMax: 2.31, ccfMin: 0.03, ccfMax: 0.03, acMod: 1, attacks: "1 bite, 1 hoof", move: "150'", tm: 1, trainMonths: 3, lairPct: null },
  cancrine: { label: "Cancrine (giant crab)", bmeMin: 1.83, bmeMax: 1.83, ccfMin: 0.345, ccfMax: 0.345, acMod: 5, attacks: "2 pincers (large claw)", move: "60'", tm: -2, trainMonths: 6, lairPct: 90 },
  canine: { label: "Canine (dog/wolf)", bmeMin: 1.61, bmeMax: 1.7, ccfMin: 0.033, ccfMax: 0.033, acMod: 0, attacks: "1 bite", move: "120'-180'", tm: 1, trainMonths: 1, lairPct: 10 },
  cetacean: { label: "Cetacean (whale)", bmeMin: 1.7, bmeMax: 2.19, ccfMin: 0.02, ccfMax: 0.02, acMod: 1, attacks: "1 bite or ram", move: "180'-240' (swim)", tm: 2, trainMonths: 3, lairPct: null },
  coleopteran: { label: "Coleopteran (beetle)", bmeMin: 1.59, bmeMax: 1.84, ccfMin: 0.426, ccfMax: 0.426, acMod: 3, attacks: "1 bite", move: "120'-150'", tm: -2, trainMonths: 4.75, lairPct: 40 },
  crocodilian: { label: "Crocodilian (crocodile)", bmeMin: 1.98, bmeMax: 1.98, ccfMin: 0.02, ccfMax: 0.02, acMod: 3, attacks: "1 bite", move: "90', 90' (swim)", tm: -2, trainMonths: 11, lairPct: null },
  dinosaurian: { label: "Dinosaurian (dinosaur)", bmeMin: 1.81, bmeMax: 2.02, ccfMin: 0.02, ccfMax: 0.02, acMod: 1, attacks: "1 bite; 1 tail; or 1 tusk", move: "60'-120'", tm: -1, trainMonths: 12, lairPct: null },
  dipterous: { label: "Dipterous (carnivorous fly)", bmeMin: 0.46, bmeMax: 0.46, ccfMin: 0.033, ccfMax: 0.033, acMod: 0, attacks: "1 bite", move: "90', 180' (fly)", tm: -2, trainMonths: 5, lairPct: 35 },
  draconine: { label: "Draconine (dragon)", bmeMin: 1.98, bmeMax: 1.98, ccfMin: 0.02, ccfMax: 0.02, acMod: null, attacks: "2 claws, 1 bite", move: "90', 240' (fly)", tm: 3, trainMonths: 3, lairPct: 55 },
  elephantine: { label: "Elephantine (elephant)", bmeMin: 1.96, bmeMax: 2.02, ccfMin: 0.02, ccfMax: 0.02, acMod: 1, attacks: "2 tusks", move: "120'", tm: 3, trainMonths: 3, lairPct: null },
  equine: { label: "Equine (horse)", bmeMin: 2.1, bmeMax: 2.31, ccfMin: 0.02, ccfMax: 0.02, acMod: 1, attacks: "1 or 2 hooves; or 1 bite, 1 hoof", move: "120'-240'", tm: 1, trainMonths: 2, lairPct: null },
  feline: { label: "Feline (large cat)", bmeMin: 1.5, bmeMax: 1.53, ccfMin: 0.06, ccfMax: 0.06, acMod: 0, attacks: "2 claws, 1 bite", move: "150'-360'", tm: 1, trainMonths: 4, lairPct: 10 },
  formic: { label: "Formic (giant ant)", bmeMin: 1.36, bmeMax: 1.36, ccfMin: 0.125, ccfMax: 0.125, acMod: 3, attacks: "1 bite", move: "180'", tm: 0, trainMonths: 6, lairPct: 10 },
  humanoid: { label: "Humanoid", bmeMin: 1.6, bmeMax: 2.5, ccfMin: 0.033, ccfMax: 0.06, acMod: 0, attacks: "1 weapon; or 2 claws, 1 bite", move: "120'", tm: null, trainMonths: null, lairPct: 35 },
  lacertine: { label: "Lacertine (giant lizard)", bmeMin: 1.35, bmeMax: 1.35, ccfMin: 0.02, ccfMax: 0.02, acMod: 1, attacks: "1 bite; 1 bite, 1 horn; or 2 claws, 1 bite", move: "120'", tm: -2, trainMonths: 10, lairPct: 25 },
  monadine: { label: "Monadine (ooze)", bmeMin: 2.08, bmeMax: 2.08, ccfMin: 0.0, ccfMax: 0.0, acMod: 0, attacks: "1 envelopment", move: "0'-30'", tm: -3, trainMonths: 12, lairPct: null },
  murine: { label: "Murine (giant rat)", bmeMin: 2.17, bmeMax: 2.17, ccfMin: 0.02, ccfMax: 0.02, acMod: 1, attacks: "1 bite", move: "120', 60' (swim)", tm: 0, trainMonths: 2.5, lairPct: 10 },
  musteline: { label: "Musteline (weasel/ferret)", bmeMin: 1.94, bmeMax: 1.94, ccfMin: 0.02, ccfMax: 0.02, acMod: 3, attacks: "1 bite", move: "150'", tm: 0, trainMonths: 3, lairPct: 25 },
  octopine: { label: "Octopine (octopus/squid)", bmeMin: 1.56, bmeMax: 1.68, ccfMin: 0.033, ccfMax: 0.033, acMod: -3, attacks: "1 bite, 8 tentacles", move: "90'-120' (swim)", tm: 1, trainMonths: 12, lairPct: null },
  piscine: { label: "Piscine (giant fish)", bmeMin: 1.8, bmeMax: 2.16, ccfMin: 0.02, ccfMax: 0.02, acMod: 1, attacks: "1 bite, 0-4 feelers, 0-4 spines", move: "90'-180' (swim)", tm: -3, trainMonths: 12, lairPct: null },
  porcine: { label: "Porcine (boar)", bmeMin: 1.75, bmeMax: 1.75, ccfMin: 0.033, ccfMax: 0.033, acMod: 0, attacks: "1 tusk", move: "120'-150'", tm: 2, trainMonths: 2, lairPct: null },
  pterosaurian: { label: "Pterosaurian (pterodactyl)", bmeMin: 1.35, bmeMax: 1.48, ccfMin: 0.031, ccfMax: 0.063, acMod: 0, attacks: "1 bite", move: "180'-240' (fly)", tm: -1, trainMonths: 5, lairPct: null },
  ranine: { label: "Ranine (giant frog/toad)", bmeMin: 1.72, bmeMax: 1.72, ccfMin: 0.033, ccfMax: 0.033, acMod: 0, attacks: "1 bite", move: "90'", tm: -2, trainMonths: 5, lairPct: null },
  rhinocerine: { label: "Rhinocerine (rhinoceros)", bmeMin: 2.02, bmeMax: 2.08, ccfMin: 0.02, ccfMax: 0.02, acMod: 1, attacks: "1 tusk", move: "120'", tm: 0, trainMonths: 6, lairPct: null },
  salamandrine: { label: "Salamandrine (salamander)", bmeMin: 1.64, bmeMax: 1.64, ccfMin: 0.02, ccfMax: 0.02, acMod: -1, attacks: "2-4 claws, 1 bite", move: "120'", tm: -2, trainMonths: 10, lairPct: 25 },
  scolopendrine: { label: "Scolopendrine (centipede)", bmeMin: 1.52, bmeMax: 1.52, ccfMin: 0.02, ccfMax: 0.02, acMod: 0, attacks: "1 bite, 0-8 tentacles", move: "120'", tm: -3, trainMonths: 4.5, lairPct: 10 },
  selachian: { label: "Selachian (shark)", bmeMin: 1.89, bmeMax: 1.89, ccfMin: 0.02, ccfMax: 0.02, acMod: 3, attacks: "1 bite", move: "180' (swim)", tm: -3, trainMonths: 6, lairPct: null },
  serpentine: { label: "Serpentine (snake)", bmeMin: 0.9, bmeMax: 1.6, ccfMin: 0.066, ccfMax: 0.066, acMod: 0, attacks: "1 bite; 0-1 constriction", move: "90'-120', 120' (swim)", tm: -3, trainMonths: 5, lairPct: null },
  simian: { label: "Simian (baboon/gorilla)", bmeMin: 1.6, bmeMax: 1.6, ccfMin: 0.06, ccfMax: 0.06, acMod: 0, attacks: "2 claws; or 1 bite, 1 weapon", move: "120'", tm: 3, trainMonths: 1, lairPct: 10 },
  soricine: { label: "Soricine (giant shrew)", bmeMin: 2.33, bmeMax: 2.33, ccfMin: 0.02, ccfMax: 0.02, acMod: 3, attacks: "2 bites", move: "180'", tm: 0, trainMonths: 3, lairPct: 40 },
  ursine: { label: "Ursine (bear)", bmeMin: 1.71, bmeMax: 1.71, ccfMin: 0.033, ccfMax: 0.033, acMod: 0, attacks: "2 claws, 1 bite", move: "120'", tm: 1, trainMonths: 3, lairPct: 25 },
  vermian: { label: "Vermian (giant worm)", bmeMin: 1.51, bmeMax: 1.93, ccfMin: 0.02, ccfMax: 0.02, acMod: -3, attacks: "1 bite; or 1 bite, 1 sting", move: "60'", tm: -3, trainMonths: 6, lairPct: 25 },
  vespertilionine: { label: "Vespertilionine (bat)", bmeMin: 1.43, bmeMax: 1.43, ccfMin: 0.025, ccfMax: 0.05, acMod: 1, attacks: "1 bite", move: "120'-180' (fly)", tm: 1, trainMonths: 5, lairPct: 35 },
  wyverine: { label: "Wyverine (wyvern)", bmeMin: 1.72, bmeMax: 1.72, ccfMin: 0.02, ccfMax: 0.02, acMod: 1, attacks: "2 talons and 1 bite, 1 sting", move: "90', 240' (fly)", tm: 3, trainMonths: 3, lairPct: 30 },
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
