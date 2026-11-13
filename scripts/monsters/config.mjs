/**
 * The monster sheet's enumerations: type, size, intelligence, save-as class,
 * treasure type, age category, trained role, young type, interval unit,
 * ability score, special-ability category and body form (MM ch. 1 Monster
 * Overview, Monster Creation and Monster Rules).
 *
 * PURE DATA, with no `foundry` references, so the runtime (data model and
 * sheet) and the Node tooling import it alike.
 *
 * Each enumeration is a plain object keyed by the stored value; the value
 * carries an English `label`. A row holds no printed figure: sizes, rates and
 * modifiers arrive through the importer from the Judge's own copy. Labels are
 * plain strings (single source of truth); the sheet's
 * `{{selectOptions ... localize=true}}` passes unknown strings through
 * unchanged. `choicesOf()` derives the `{ key: label }` map that Foundry
 * DataModel `choices` and `<select>` builders use.
 */

// Enums shared across the features (damage, natural-weapon, vision, sense
// and movement types, alignment) and the `{ key: label }` choices-map helper
// are defined once in lib and re-exported here, so this feature's consumers
// import them from ./config.mjs. `USAGE` is lib's `SPELL_LIKE_FREQ`: one
// frequency vocabulary for monster powers, abilities and item powers.
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
  baby: { label: "Baby" },
  juvenile: { label: "Juvenile" },
  adolescent: { label: "Adolescent" },
  adult: { label: "Adult" },
  middleAged: { label: "Middle-Aged" },
  old: { label: "Old" },
  ancient: { label: "Ancient" },
  maximum: { label: "Maximum" },
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

/** Special-ability categories used to tag `ability` items. */
export const SPECIAL_ABILITIES = {
  acid: { label: "Acid" },
  aura: { label: "Aura" },
  berserk: { label: "Berserk" },
  bonusAttack: { label: "Bonus Attack" },
  breathWeapon: { label: "Breath Weapon" },
  charge: { label: "Charge" },
  classPowers: { label: "Class Powers / Proficiencies" },
  damageImmunity: { label: "Damage Immunity" },
  damageResistance: { label: "Damage Resistance" },
  disease: { label: "Disease" },
  diveAttack: { label: "Dive Attack" },
  dreadful: { label: "Dreadful" },
  effectImmunity: { label: "Effect Immunity" },
  effectResistance: { label: "Effect Resistance" },
  enervation: { label: "Enervation" },
  enslave: { label: "Enslave" },
  flying: { label: "Flying" },
  gazeAttack: { label: "Gaze Attack" },
  grabRestrain: { label: "Grab / Restrain" },
  horrific: { label: "Horrific" },
  hug: { label: "Hug" },
  immunity: { label: "Immunity" },
  incorporeal: { label: "Incorporeal" },
  infectious: { label: "Infectious" },
  invisibility: { label: "Invisibility" },
  lightningReflexes: { label: "Lightning Reflexes" },
  magicResistance: { label: "Magic Resistance" },
  ongoingDamage: { label: "Ongoing Damage" },
  paralysis: { label: "Paralysis" },
  petrification: { label: "Petrification" },
  poison: { label: "Poison" },
  regeneration: { label: "Regeneration" },
  resistance: { label: "Resistance" },
  specialSenses: { label: "Special Senses" },
  spellcasting: { label: "Spellcasting" },
  spellLike: { label: "Spell-like Abilities" },
  stealth: { label: "Stealth" },
  susceptibility: { label: "Susceptibility" },
  swallowAttack: { label: "Swallow Attack" },
  swift: { label: "Swift" },
  terrifying: { label: "Terrifying" },
  toppleAndFling: { label: "Topple and Fling" },
  tough: { label: "Tough" },
  trample: { label: "Trample" },
  triggeredAttack: { label: "Triggered Attack" },
  viciousAttack: { label: "Vicious Attack" },
  unusual: { label: "Unusual" },
};

/* -------------------------------------------- */
/*  Body forms (Creation pp.389, 397; Org p.395)*/
/* -------------------------------------------- */

/** Body-form vocabulary a monster's `bodyForm` is chosen from; the sheet reads only the label. */
export const BODY_FORMS = {
  accipitrine: { label: "Accipitrine (raptor)" },
  aquiline: { label: "Aquiline (roc)" },
  apian: { label: "Apian (giant bee)" },
  arachnine: { label: "Arachnine (spider)" },
  basilicine: { label: "Basilicine (basilisk)" },
  bovine: { label: "Bovine (herd animal)" },
  cameline: { label: "Cameline (camel)" },
  cancrine: { label: "Cancrine (giant crab)" },
  canine: { label: "Canine (dog/wolf)" },
  cetacean: { label: "Cetacean (whale)" },
  coleopteran: { label: "Coleopteran (beetle)" },
  crocodilian: { label: "Crocodilian (crocodile)" },
  dinosaurian: { label: "Dinosaurian (dinosaur)" },
  dipterous: { label: "Dipterous (carnivorous fly)" },
  draconine: { label: "Draconine (dragon)" },
  elephantine: { label: "Elephantine (elephant)" },
  equine: { label: "Equine (horse)" },
  feline: { label: "Feline (large cat)" },
  formic: { label: "Formic (giant ant)" },
  humanoid: { label: "Humanoid" },
  lacertine: { label: "Lacertine (giant lizard)" },
  monadine: { label: "Monadine (ooze)" },
  murine: { label: "Murine (giant rat)" },
  musteline: { label: "Musteline (weasel/ferret)" },
  octopine: { label: "Octopine (octopus/squid)" },
  piscine: { label: "Piscine (giant fish)" },
  porcine: { label: "Porcine (boar)" },
  pterosaurian: { label: "Pterosaurian (pterodactyl)" },
  ranine: { label: "Ranine (giant frog/toad)" },
  rhinocerine: { label: "Rhinocerine (rhinoceros)" },
  salamandrine: { label: "Salamandrine (salamander)" },
  scolopendrine: { label: "Scolopendrine (centipede)" },
  selachian: { label: "Selachian (shark)" },
  serpentine: { label: "Serpentine (snake)" },
  simian: { label: "Simian (baboon/gorilla)" },
  soricine: { label: "Soricine (giant shrew)" },
  ursine: { label: "Ursine (bear)" },
  vermian: { label: "Vermian (giant worm)" },
  vespertilionine: { label: "Vespertilionine (bat)" },
  wyverine: { label: "Wyverine (wyvern)" },
};
