/**
 * RAW equipment data (ACKS II Revised Rulebook, Equipment pp. 126–127; Combat
 * pp. 296–299). All values are Rules-As-Written; no homebrew.
 *
 * This is the built-in weapon profile lookup used as the LAST resort by
 * profiles.mjs (after core tags and per-item flags). Keys are normalised weapon
 * names (lowercase, non-alphanumerics stripped).
 */

/** Weapon size classes → base one-handed hand cost. RR p. 127. */
export const SIZE = Object.freeze({ TINY: "tiny", SMALL: "small", MEDIUM: "medium", LARGE: "large" });

/** Fighting styles. JJ Custom Classes p. 291. */
export const STYLE = Object.freeze({
  SINGLE: "single", // one tiny/small/medium melee weapon
  DUAL: "dual", // a tiny/small/medium melee weapon in each hand
  TWO_HANDED: "twoHanded", // a medium or large melee weapon in both hands
  WEAPON_SHIELD: "weaponShield", // tiny/small/medium or missile weapon + shield
  MISSILE: "missile", // a missile weapon
});

/** Fighting Style Specialization bonuses. RR p. 108 (Proficiencies). */
export const STYLE_SPEC_BONUS = Object.freeze({
  [STYLE.MISSILE]: { attackMissile: 1 },
  [STYLE.SINGLE]: { init: 1 },
  [STYLE.DUAL]: { attackMelee: 1 },
  [STYLE.TWO_HANDED]: { damageMelee: 1 },
  [STYLE.WEAPON_SHIELD]: { ac: 1 },
});

/** Base (unspecialized) dual-weapon bonus. RR p. 296. */
export const DUAL_WIELD_ATTACK_BONUS = 1;

/**
 * Weapon proficiency categories (JJ p. 290 narrow/broad groupings) — used for
 * proficiency enforcement, Weapon Focus, and Martial Training.
 */
export const WEAPON_CATEGORY = Object.freeze({
  AXE: "axe",
  BOW: "bow",
  CROSSBOW: "crossbow",
  FLAIL_HAMMER_MACE: "flailHammerMace",
  SWORD_DAGGER: "swordDagger",
  SPEAR_POLEARM: "spearPolearm",
  OTHER: "other", // bolas, cestus, nets, saps, slings, staffs, staff-slings, whips
});

/** Weapon Focus categories (RR p. 121). Maps to a set of weapon keys. */
export const WEAPON_FOCUS_GROUPS = Object.freeze({
  axes: ["battleaxe", "greataxe", "handaxe"],
  macesflailshammers: ["flail", "mace", "morningstar", "warhammer"],
  swordsdaggers: ["knife", "dagger", "silverdagger", "shortsword", "sword", "twohandedsword"],
  bowscrossbows: ["compositebow", "longbow", "shortbow", "crossbow", "arbalest"],
  slingsthrown: ["sling", "staffsling", "bola", "dart", "rock", "militaryoil", "holywater"],
  spearspolearms: ["javelin", "lance", "polearm", "spear"],
});

/**
 * Built-in weapon profiles. size drives hand cost; melee/missile/thrown/handy
 * drive wield rules; damage/damage2h from RR p. 126; special = RAW quality tags
 * (RR p. 127). twoHandedForced marks weapons that always need two hands.
 */
export const WEAPONS = Object.freeze({
  // Bows / crossbows (missile; 2H unless Handy)
  arbalest: { size: SIZE.MEDIUM, missile: true, damage: "1d8", type: "piercing", cat: WEAPON_CATEGORY.CROSSBOW, handy: true, special: ["cleave2", "handy", "slow"] },
  crossbow: { size: SIZE.SMALL, missile: true, damage: "1d6", type: "piercing", cat: WEAPON_CATEGORY.CROSSBOW, handy: true, special: ["cleave2", "handy", "slow"] },
  compositebow: { size: SIZE.MEDIUM, missile: true, damage: "1d6", type: "piercing", cat: WEAPON_CATEGORY.BOW, special: ["cleave3str"] },
  longbow: { size: SIZE.LARGE, missile: true, damage: "1d6", type: "piercing", cat: WEAPON_CATEGORY.BOW, special: ["cleave3str"], reqStr: 9 },
  shortbow: { size: SIZE.SMALL, missile: true, damage: "1d6", type: "piercing", cat: WEAPON_CATEGORY.BOW },
  // Axes
  battleaxe: { size: SIZE.MEDIUM, melee: true, damage: "1d6", damage2h: "1d8", type: "slashing", cat: WEAPON_CATEGORY.AXE },
  greataxe: { size: SIZE.LARGE, melee: true, damage: "1d10", type: "slashing", cat: WEAPON_CATEGORY.AXE },
  handaxe: { size: SIZE.SMALL, melee: true, thrown: true, damage: "1d6", type: "slashing", cat: WEAPON_CATEGORY.AXE, special: ["thrown"] },
  // Bludgeons
  club: { size: SIZE.TINY, melee: true, damage: "1d4", type: "bludgeoning", cat: WEAPON_CATEGORY.OTHER },
  flail: { size: SIZE.MEDIUM, melee: true, damage: "1d6", damage2h: "1d8", type: "bludgeoning", cat: WEAPON_CATEGORY.FLAIL_HAMMER_MACE },
  mace: { size: SIZE.MEDIUM, melee: true, damage: "1d6", damage2h: "1d8", type: "bludgeoning", cat: WEAPON_CATEGORY.FLAIL_HAMMER_MACE },
  morningstar: { size: SIZE.LARGE, melee: true, damage: "1d10", type: "bludgeoning", cat: WEAPON_CATEGORY.FLAIL_HAMMER_MACE },
  warhammer: { size: SIZE.SMALL, melee: true, thrown: true, damage: "1d6", type: "bludgeoning", cat: WEAPON_CATEGORY.FLAIL_HAMMER_MACE, special: ["thrown"] },
  // Swords / daggers
  knife: { size: SIZE.TINY, melee: true, thrown: true, damage: "1d3", type: "piercing", cat: WEAPON_CATEGORY.SWORD_DAGGER, special: ["thrown"] },
  dagger: { size: SIZE.TINY, melee: true, thrown: true, damage: "1d4", type: "piercing", cat: WEAPON_CATEGORY.SWORD_DAGGER, special: ["thrown"] },
  silverdagger: { size: SIZE.TINY, melee: true, thrown: true, damage: "1d4", type: "piercing", cat: WEAPON_CATEGORY.SWORD_DAGGER, special: ["thrown", "silver"] },
  shortsword: { size: SIZE.SMALL, melee: true, damage: "1d6", type: "slashing", cat: WEAPON_CATEGORY.SWORD_DAGGER },
  sword: { size: SIZE.MEDIUM, melee: true, damage: "1d6", damage2h: "1d8", type: "slashing", cat: WEAPON_CATEGORY.SWORD_DAGGER },
  twohandedsword: { size: SIZE.LARGE, melee: true, damage: "1d10", type: "slashing", cat: WEAPON_CATEGORY.SWORD_DAGGER },
  // Spears / polearms
  dart: { size: SIZE.TINY, missile: true, thrown: true, damage: "1d4", type: "piercing", cat: WEAPON_CATEGORY.SPEAR_POLEARM, handy: true, special: ["thrown"] },
  javelin: { size: SIZE.SMALL, melee: true, thrown: true, damage: "1d6", type: "piercing", cat: WEAPON_CATEGORY.SPEAR_POLEARM, special: ["thrown"] },
  lance: { size: SIZE.LARGE, melee: true, damage: "1d10", type: "piercing", cat: WEAPON_CATEGORY.SPEAR_POLEARM, special: ["impact", "long", "mounted"] },
  polearm: { size: SIZE.LARGE, melee: true, damage: "1d10", type: "slashing", cat: WEAPON_CATEGORY.SPEAR_POLEARM, special: ["impact", "long"] },
  spear: { size: SIZE.MEDIUM, melee: true, thrown: true, damage: "1d6", damage2h: "1d8", type: "piercing", cat: WEAPON_CATEGORY.SPEAR_POLEARM, special: ["impact", "long", "thrown"] },
  // Other weapons
  bola: { size: SIZE.SMALL, missile: true, thrown: true, damage: "1d2", type: "bludgeoning", cat: WEAPON_CATEGORY.OTHER, handy: true, special: ["entangling", "thrown"] },
  // Military (burning) oil: 1d8 direct + 1d8 next round, 1d3 splash (RR p297).
  // RR p298: oil/holy water/torches "do not gain a bonus to damage from high
  // STR, class, Backstabbing, or any similar effect" → noDamageBonus.
  militaryoil: { size: SIZE.SMALL, missile: true, thrown: true, damage: "1d8", type: "fire", cat: WEAPON_CATEGORY.OTHER, handy: true, special: ["thrown", "splash", "noDamageBonus"] },
  // Holy water: a thrown one-shot flask that SHATTERS on use. RR p268/p297: a
  // chaotic enchanted creature directly struck "suffers 1d8 damage for 2 rounds"
  // (same rules as burning oil), harmless to other creatures; 1d3 splash; no
  // STR/class damage bonus (RR p298). type "holy" (only vs chaotic enchanted).
  holywater: { size: SIZE.SMALL, missile: true, thrown: true, damage: "1d8", type: "holy", cat: WEAPON_CATEGORY.OTHER, handy: true, special: ["thrown", "splash", "consumable", "noDamageBonus"] },
  cestus: { size: SIZE.SMALL, melee: true, damage: "1d3", type: "bludgeoning", cat: WEAPON_CATEGORY.OTHER, special: ["worn"] },
  net: { size: SIZE.MEDIUM, melee: true, thrown: true, damage: "", type: "", cat: WEAPON_CATEGORY.OTHER, twoHandedForced: true, special: ["entangling", "thrown"] },
  rock: { size: SIZE.MEDIUM, missile: true, thrown: true, damage: "1d3", type: "bludgeoning", cat: WEAPON_CATEGORY.OTHER, handy: true, special: ["thrown"] },
  sap: { size: SIZE.TINY, melee: true, damage: "1d4", type: "bludgeoning", cat: WEAPON_CATEGORY.OTHER, special: ["incapacitating"] },
  sling: { size: SIZE.SMALL, missile: true, damage: "1d4", type: "bludgeoning", cat: WEAPON_CATEGORY.OTHER, handy: true },
  staffsling: { size: SIZE.MEDIUM, missile: true, melee: true, damage: "1d4", damage2h: "1d6", type: "bludgeoning", cat: WEAPON_CATEGORY.OTHER, twoHandedForced: true },
  staff: { size: SIZE.MEDIUM, melee: true, damage: "1d4", damage2h: "1d6", type: "bludgeoning", cat: WEAPON_CATEGORY.OTHER },
  whip: { size: SIZE.SMALL, melee: true, damage: "1d2", type: "slashing", cat: WEAPON_CATEGORY.OTHER, special: ["flexible"] },
  // A lit torch used as a weapon deals 1d4 (RR p148) and — thrown or wielded —
  // gains NO damage bonus from STR, class, Backstabbing, or the like (RR p300,
  // stated for the thrown case; extended to melee per Judge ruling). `thrown`
  // so it can be hurled; `light` marks it a light source for the sheet controls.
  torch: { size: SIZE.SMALL, melee: true, thrown: true, damage: "1d4", type: "fire", cat: WEAPON_CATEGORY.OTHER, special: ["thrown", "noDamageBonus", "light"] },
});

/** Name aliases → canonical weapon key (tolerant of core pack naming). */
export const WEAPON_ALIASES = Object.freeze({
  battleax: "battleaxe",
  greatax: "greataxe",
  handax: "handaxe",
  twohandsword: "twohandedsword",
  greatsword: "twohandedsword",
  bastardsword: "sword",
  polearm: "polearm",
  staffsling2: "staffsling",
  slingstaff: "staffsling",
  quarterstaff: "staff",
  morningstar2: "morningstar",
  compbow: "compositebow",
  holywaterflask: "holywater",
  vialofholywater: "holywater",
});

/** Armour weight categories (core `system.type`) ordered light→heavy. */
export const ARMOR_LADDER = Object.freeze(["unarmored", "veryLight", "light", "medium", "heavy"]);

/** Thief skills that require ≤ light (leather) armour and no shield. JJ p. 292. */
export const ARMOR_GATED_SKILLS = Object.freeze(["backstabbing", "backstab", "hiding", "hide", "pickpocketing", "pickpocket", "sneaking", "sneak"]);

/** Max armour category permitted for the armour-gated thief skills. */
export const ARMOR_GATE_MAX = "light";

/**
 * JJ shield-variant profiles (Judges Journal pp. 407–408). Only consulted when
 * the shield-variant overlay is enabled. enc in stone; ac is the granted bonus.
 * `spec` = whether Fighting Style Specialization (Weapon & Shield) applies.
 *
 * WIRED: handAC, frontAC, specOnly, spec, defendCounts, noBack, noMount,
 * enc, encItem, frontEnc, mountEnc (see overlays/shield-variants.mjs).
 *
 * DELIBERATELY NOT WIRED — recorded here so a sweep for dead config does not
 * keep rediscovering them as oversights:
 *  - `backAC` / `vulnerableProtects` — both describe whether the shield helps
 *    against a PARTICULAR attack (from behind; while vulnerable). The system
 *    models no per-attack context to hang that on, so automating it would mean
 *    guessing which attacks qualify. Surfaced in the item description instead.
 *  - `mountAlternates` / `mountShares` — mounted, these shields protect the
 *    rider OR the mount, or share cover between them. That is a player's choice
 *    each round, not a derivable fact; automating it would choose for them.
 */
export const SHIELD_VARIANTS = Object.freeze({
  standard: { label: "Shield", handAC: 1, backAC: 0, enc: 1, spec: true, vulnerableProtects: true },
  auxiliary: { label: "Auxiliary Shield", handAC: 1, backAC: 1, enc: 1, spec: true, vulnerableProtects: false, mountAlternates: true },
  buckler: { label: "Buckler", handAC: 1, backAC: 0, enc: 1, encItem: true, spec: true, specOnly: true, vulnerableProtects: false },
  crescent: { label: "Crescent Shield", handAC: 1, backAC: 1, frontAC: 1, enc: 1, frontEnc: 2, spec: true, vulnerableProtects: false },
  heater: { label: "Heater Shield", handAC: 1, backAC: 1, enc: 1, spec: true, vulnerableProtects: false, mountAlternates: true },
  kite: { label: "Kite Shield", handAC: 1, enc: 2, mountEnc: 1, spec: true, vulnerableProtects: false, noBack: true, mountShares: true },
  phalanx: { label: "Phalanx Shield", handAC: 1, enc: 1, spec: true, vulnerableProtects: false, noBack: true, noMount: true, defendCounts: true },
});

/**
 * Masterwork tiers (RR p. 159).
 *
 * REFERENCE DATA, not automation — deliberately (see constants.mjs, the note by
 * the overlay settings). Masterwork is fully expressible in fields core already
 * has: +1 hit is `system.bonus`, +1 damage is a "1d6+1" damage string, +1 AC is
 * `aac.value`, and −1 stone is `weight6`. So a masterwork item is DATA, and the
 * equipment-samples pack ships examples of each tier. Nothing reads this table
 * at runtime and nothing should; it is here so the numbers behind those samples
 * are written down in one place.
 */
export const MASTERWORK = Object.freeze({
  weaponToHit: { cost: 80, toHit: 1 },
  weaponToDamage: { cost: 80, toDamage: 1 },
  weaponBoth: { cost: 650, toHit: 1, toDamage: 1 },
  armorLight: { cost: 80, weightMinusStone: 1 },
  armorAC: { cost: 650, ac: 1 },
});

/**
 * RAW carrying devices (RR pp. 142–145). Core's acks-adventuring-equipment pack
 * already ships these items, so we ANNOTATE them in place (see the Annotate
 * macro) rather than duplicating them. capacity is in stone.
 */
export const CONTAINER_PROFILES = Object.freeze({
  backpack: { capacity: 4 },
  rucksack: { capacity: 2 },
  sacklarge: { capacity: 6 },
  sacksmall: { capacity: 2 },
  saddlebag: { capacity: 3 },
  pouchpurse: { capacity: 0.5 },
  chestironbound: { capacity: 20 },
  barrel: { capacity: 15 },
  bowquiver: { capacity: 1, bowquiver: true },
  adventurersharness: { harness: true },
});

/** Resolve a container profile from an item name, or null. */
export function containerProfileFor(name) {
  const key = normalizeName(name);
  if (CONTAINER_PROFILES[key]) return CONTAINER_PROFILES[key];
  for (const [k, v] of Object.entries(CONTAINER_PROFILES)) {
    if (key.startsWith(k) || key.includes(k)) return v;
  }
  return null;
}

/** Normalise an item name to a lookup key. */
export function normalizeName(name) {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * WEAR LOCATIONS — the single canonical taxonomy of "where is this gear?".
 *
 * This used to be implied in three unrelated places (the Paper Doll slot
 * layout, the per-item flags, and the derived buckets in getLoadout), which
 * could disagree without anything noticing. Everything that groups gear by
 * position now resolves through wear.mjs against these keys: the ACKS
 * character sheet, the Paper Doll layout, and the loadout summary.
 *
 * Order is display order, head to foot then off-body.
 */
export const WEAR = Object.freeze({
  HEAD: "head", // helmet
  BODY: "body", // worn suit of armour
  WORN: "worn", // clothing and other worn-but-not-armour gear
  MAIN_HAND: "mainHand",
  OFF_HAND: "offHand",
  BOTH_HANDS: "bothHands", // a single weapon wielded two-handed
  STRAPPED: "strapped", // shield slung to back or front (JJ variant overlay)
  CARRIED: "carried", // on the character, not worn or wielded
  STOWED: "stowed", // inside a container
});

/** Display order for the worn buckets (CARRIED/STOWED are handled separately). */
export const WEAR_ORDER = Object.freeze([
  WEAR.HEAD,
  WEAR.BODY,
  WEAR.WORN,
  WEAR.MAIN_HAND,
  WEAR.OFF_HAND,
  WEAR.BOTH_HANDS,
  WEAR.STRAPPED,
]);

/** Font Awesome icon per wear location, for sheet + app headers. */
export const WEAR_ICONS = Object.freeze({
  [WEAR.HEAD]: "fa-hat-wizard",
  [WEAR.BODY]: "fa-shirt",
  [WEAR.WORN]: "fa-mitten",
  [WEAR.MAIN_HAND]: "fa-hand-fist",
  [WEAR.OFF_HAND]: "fa-hand",
  [WEAR.BOTH_HANDS]: "fa-hands",
  [WEAR.STRAPPED]: "fa-shield-halved",
  [WEAR.CARRIED]: "fa-sack-xmark",
  [WEAR.STOWED]: "fa-box",
});
