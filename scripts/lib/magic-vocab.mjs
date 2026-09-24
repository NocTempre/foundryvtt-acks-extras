/**
 * The magic vocabulary — the enums the spell primitive, the cast engine and
 * the spell builder branch on. FOUNDRY-FREE and Node-importable, like
 * `vocab.mjs`, which re-exports everything here so consumers keep one import
 * path.
 *
 * Every family here names a MECHANISM this module implements: a stat-line
 * shape the importer parses a printed line onto, an axis of the builder's
 * tables, a branch of the cast engine. A list a reader picks from — schools,
 * elements, shades, components — is not here: it ships empty as an open
 * vocabulary family (`SELECTION_VOCAB_DOC` in `vocab.mjs`) and is filled from
 * the Judge's own book. The line between the two is
 * `docs/magic/DECISIONS.md`.
 *
 * Each family is a descriptor map `{ key: { label } }`. The inline label is
 * the fallback; the label a window shows comes from
 * `lang/en.json` under `ACKS-LIB.enum.<family>.<key>`, where `<family>` is the
 * family's key in `MAGIC_VOCAB`. `tools/test-magic.mjs` walks every family
 * against the lang file in both directions, so a member without a key, or a
 * key without a member, fails offline. Adding a family means: declare it,
 * register it in `MAGIC_VOCAB`, add its keys to `lang/en.json`.
 */

/** The thirteen spell types (RR ch. 5 §V.6; JJ ch. 14) — the builder's table axis. */
export const SPELL_TYPES = Object.freeze({
  blast: { label: "Blast" },
  death: { label: "Death" },
  detection: { label: "Detection" },
  elemental: { label: "Elemental" },
  enchantment: { label: "Enchantment" },
  esoteric: { label: "Esoteric" },
  healing: { label: "Healing" },
  illusion: { label: "Illusion" },
  movement: { label: "Movement" },
  protection: { label: "Protection" },
  summoning: { label: "Summoning" },
  transmogrification: { label: "Transmogrification" },
  wall: { label: "Wall" },
});

/**
 * The shapes a printed range line takes (RR ch. 5 §V.8). The number on the
 * line is content and rides the spell's `value`; the shape says how to read it.
 */
export const RANGE_SHAPES = Object.freeze({
  self: { label: "Self" },
  touch: { label: "Touch" },
  touchOrDistance: { label: "Touch, or a distance" },
  distance: { label: "A distance" },
  distancePerLevel: { label: "A distance per caster level" },
  special: { label: "Special" },
});

/** The unit a range value is printed in. */
export const DISTANCE_UNITS = Object.freeze({
  feet: { label: "Feet" },
  miles: { label: "Miles" },
});

/**
 * The shapes a printed duration line takes (RR ch. 5 §V.8; JJ ch. 14 duration
 * rows). `fixed`, `perLevel`, `basePlusPerLevel` and `dice` read a value and a
 * `TIME_UNITS` unit; the concentration shapes read `CONCENTRATION_KINDS` for
 * whether the caster may move.
 */
export const DURATION_SHAPES = Object.freeze({
  instantaneous: { label: "Instantaneous" },
  fixed: { label: "A fixed time" },
  perLevel: { label: "A time per caster level" },
  basePlusPerLevel: { label: "A base time plus a time per caster level" },
  dice: { label: "A rolled time" },
  concentration: { label: "Concentration" },
  concentrationMax: { label: "Concentration, up to a maximum" },
  concentrationPlus: { label: "Concentration, plus a time after" },
  perpetual: { label: "Perpetual" },
  indefinite: { label: "Indefinite" },
  permanent: { label: "Permanent" },
  special: { label: "Special" },
});

/**
 * ACKS time units. An ACKS `turns` is ten minutes of game time, never a
 * Foundry combat turn; the mapping onto Foundry's effect durations is the
 * cast engine's, not this table's.
 */
export const TIME_UNITS = Object.freeze({
  rounds: { label: "Rounds" },
  turns: { label: "Turns" },
  minutes: { label: "Minutes" },
  hours: { label: "Hours" },
  days: { label: "Days" },
  weeks: { label: "Weeks" },
  months: { label: "Months" },
  years: { label: "Years" },
});

/**
 * What concentrating costs the caster (RR ch. 5 §V.8 defined terms): mobile
 * concentration ends on an attack, a cast or a long move; stationary
 * concentration ends on any action but sustaining the spell.
 */
export const CONCENTRATION_KINDS = Object.freeze({
  mobile: { label: "Concentration" },
  stationary: { label: "Stationary concentration" },
});

/**
 * How long a casting takes (RR ch. 6). `round` is a spell cast from the
 * repertoire or a scroll; `action` is a spell-like ability or an implement;
 * `timed` reads a value and a `TIME_UNITS` unit (rituals, ceremonies, long
 * summonings).
 */
export const CASTING_TIME_SHAPES = Object.freeze({
  action: { label: "A combat action" },
  round: { label: "One round" },
  timed: { label: "A stated time" },
  special: { label: "Special" },
});

/**
 * What a spell is aimed at (RR ch. 5 §V.8 defined terms; JJ ch. 14 targeting
 * rows). `creature` and `object` read a count; `recipient` is a willing
 * target, which skips the attack throw and the save; `hdPool` reads a pool of
 * Hit Dice; `area` reads an `AREA_SHAPES` shape and its size.
 */
export const TARGET_MODELS = Object.freeze({
  self: { label: "The caster" },
  creature: { label: "Creatures" },
  recipient: { label: "Willing recipients" },
  hdPool: { label: "Creatures, by a pool of Hit Dice" },
  area: { label: "An area" },
  object: { label: "Objects" },
  structure: { label: "A structure" },
  special: { label: "Special" },
});

/** The geometries an area spell fills (JJ ch. 14 area rows; RR wall spells). */
export const AREA_SHAPES = Object.freeze({
  sphere: { label: "Sphere" },
  cone: { label: "Cone" },
  line: { label: "Line" },
  cube: { label: "Cube" },
  cylinder: { label: "Cylinder" },
  cloud: { label: "Cloud" },
  wall: { label: "Wall" },
  special: { label: "Special" },
});

/**
 * Which creatures a spell can affect — the RR ch. 5 §V.8 defined terms the
 * cast engine filters targets by. A spell lists the filters it applies; an
 * empty list affects any target.
 */
export const TARGET_FILTERS = Object.freeze({
  living: { label: "Living" },
  dead: { label: "Dead" },
  undead: { label: "Undead" },
  enchanted: { label: "Enchanted creatures" },
  humanoid: { label: "Humanoids" },
  animal: { label: "Animals" },
  plant: { label: "Plants" },
  object: { label: "Objects" },
  structure: { label: "Structures" },
  sapient: { label: "Sapient creatures" },
  ally: { label: "Allies" },
  enemy: { label: "Enemies" },
});

/** The saving-throw categories, in the acks system's own keys, plus none. */
export const SAVE_CATEGORIES = Object.freeze({
  none: { label: "No saving throw" },
  paralysis: { label: "Paralysis" },
  death: { label: "Death" },
  blast: { label: "Blast" },
  implements: { label: "Implements" },
  spell: { label: "Spells" },
});

/** What a successful save does to the spell's effect. */
export const SAVE_EFFECTS = Object.freeze({
  negates: { label: "Negates the effect" },
  half: { label: "Halves the effect" },
  partial: { label: "Reduces the effect" },
  special: { label: "Special" },
});

/** What a `heal` effect restores — the heal executor's branch. */
export const HEAL_KINDS = Object.freeze({
  hitPoints: { label: "Hit points" },
  trauma: { label: "Trauma and lost limbs" },
  condition: { label: "A condition" },
  level: { label: "Drained levels" },
  life: { label: "Life" },
});

/** A summoned or commanded creature's disposition toward the caster. */
export const CONTROL_KINDS = Object.freeze({
  obedient: { label: "Obedient" },
  cooperative: { label: "Cooperative" },
  indifferent: { label: "Indifferent" },
  hostile: { label: "Hostile" },
  uncontrolled: { label: "Uncontrolled" },
});

/** The three summoning formats (RR ch. 5 §V.6) — how a summons resolves its creature. */
export const SUMMON_FORMATS = Object.freeze({
  calling: { label: "Calling" },
  conjuration: { label: "Conjuration" },
  summoning: { label: "Summoning" },
});

/**
 * How often a spell-like ability or an item power may be used. One
 * vocabulary for abilities, monster powers and item activation: the monsters
 * feature's `USAGE` is this table, and the importer's frequency scan emits
 * these keys.
 */
export const SPELL_LIKE_FREQ = Object.freeze({
  atWill: { label: "At will" },
  perRound: { label: "Once per round" },
  perTurn: { label: "Once per turn" },
  per3Turns: { label: "Once per three turns" },
  perHour: { label: "Once per hour" },
  per8Hours: { label: "Once per eight hours" },
  thricePerDay: { label: "Three times per day" },
  perDay: { label: "Once per day" },
  perWeek: { label: "Once per week" },
  perMonth: { label: "Once per month" },
  perSeason: { label: "Once per season" },
  perYear: { label: "Once per year" },
  byLevel: { label: "By caster level (scheduled)" },
});

/**
 * Every magic family by the id its lang keys use: `ACKS-LIB.enum.<id>.<key>`.
 * `tools/test-magic.mjs` reads this to prove the lang file complete.
 */
export const MAGIC_VOCAB = Object.freeze({
  spellType: SPELL_TYPES,
  rangeShape: RANGE_SHAPES,
  distanceUnit: DISTANCE_UNITS,
  durationShape: DURATION_SHAPES,
  timeUnit: TIME_UNITS,
  concentrationKind: CONCENTRATION_KINDS,
  castingTimeShape: CASTING_TIME_SHAPES,
  targetModel: TARGET_MODELS,
  areaShape: AREA_SHAPES,
  targetFilter: TARGET_FILTERS,
  saveCategory: SAVE_CATEGORIES,
  saveEffect: SAVE_EFFECTS,
  healKind: HEAL_KINDS,
  controlKind: CONTROL_KINDS,
  summonFormat: SUMMON_FORMATS,
  spellLikeFreq: SPELL_LIKE_FREQ,
});

/**
 * The label a window shows for one member of a magic family: the lang string
 * when the running client has it, else the member's inline label, else the
 * key itself. Empty for a blank key. Safe under Node, where there is no
 * `game`.
 */
export function vocabLabel(family, key) {
  if (key == null || key === "") return "";
  const full = `ACKS-LIB.enum.${family}.${key}`;
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(full)) return i18n.localize(full);
  return MAGIC_VOCAB[family]?.[key]?.label ?? String(key);
}

/** `{ key: label }` for one magic family, labelled through `vocabLabel` — what a `<select>` renders. */
export function vocabChoices(family) {
  return Object.fromEntries(Object.keys(MAGIC_VOCAB[family] ?? {}).map((k) => [k, vocabLabel(family, k)]));
}
