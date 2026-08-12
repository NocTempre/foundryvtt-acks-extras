/**
 * RAW equipment data (ACKS II Revised Rulebook, Equipment pp. 126–127; Combat
 * pp. 296–299). All values are Rules-As-Written; no homebrew.
 *
 * This is the built-in weapon profile lookup used as the LAST resort by
 * profiles.mjs (after core tags and per-item flags). Keys are normalised weapon
 * names (lowercase, non-alphanumerics stripped).
 */
import { SLOT, WEAR_SLOTS, WEAR_SLOT_ORDER, slug } from "../lib/vocab.mjs";

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
 * The Silver quality (RR ch.4 Weapon Qualities).
 *
 * Silver is the ONLY material in ACKS II that changes what a weapon can do —
 * there is no cold iron, mithril or adamantine. Its whole mechanical weight is
 * what the blade COUNTS AS, never a stat: a monster whose immunity or
 * resistance carries the silver flaw treats a silver weapon as magic, and the
 * spells that turn aside mundane damage do not turn silver aside. So this table
 * holds a price and nothing else.
 *
 * `priceMultiplier` scales the weapon's own listed price and is applied ONLY to
 * an item a reader explicitly plated (properties.mjs) — the RAW price list
 * already charges "Silver Dagger" and "Silver Arrow" at their silvered price,
 * and multiplying those again would bill the same plating twice.
 */
export const SILVER = Object.freeze({ priceMultiplier: 10, quality: "silver" });

/**
 * RAW carrying devices (RR pp. 142–145, 293–294). Core's
 * acks-adventuring-equipment pack already ships these items, so we ANNOTATE
 * them in place (see the Annotate macro) rather than duplicating them.
 *
 * One table, because these are all the same fact about one piece of gear:
 * `capacity` (stone) is how much it holds, `slots` where it rides, and `access`
 * what it costs to get something out — free from rigging worn on the body
 * (harness, belt pouch, bowcase, quiver, sheath), an action in lieu of movement
 * from a pack (backpack, rucksack, sack). A container with no slots is not worn
 * at all: a barrel and an ironbound chest sit on the floor.
 */
export const GEAR_PROFILES = Object.freeze({
  // Rigging — worn, and RAW-free to draw from.
  adventurersharness: { slots: [SLOT.belt], access: "free", harness: true },
  bowquiver: { slots: [SLOT.back], access: "free", capacity: 1, bowquiver: true },
  quiver: { slots: [SLOT.belt], access: "free", capacity: 1 },
  // "Case, 20 Bolts". Generic enough to want the comment: the only `case` in
  // the RAW equipment list is the bolt case.
  case: { slots: [SLOT.belt], access: "free", capacity: 1 },
  scabbard: { slots: [SLOT.belt], access: "free" },
  pouchpurse: { slots: [SLOT.belt], access: "free", capacity: 0.5 },
  // Packs — worn, but an action to open.
  backpack: { slots: [SLOT.back], access: "action", capacity: 4 },
  rucksack: { slots: [SLOT.back], access: "action", capacity: 2 },
  sacklarge: { slots: [SLOT.back], access: "action", capacity: 6 },
  sacksmall: { slots: [SLOT.back], access: "action", capacity: 2 },
  // Rides the mount, not the rider — so no slot on a character.
  saddlebag: { access: "action", capacity: 3 },
  // Fixed containers: never worn.
  chestironbound: { capacity: 20 },
  barrel: { capacity: 15 },
});

/**
 * A carrying device sold WITH its load, and how much of it: "Quiver, 20
 * Arrows", "Case, 20 Bolts". RAW prices and packs these as one line, and core's
 * own equipment pack ships each as a single `item` carrying `quantity: 20` —
 * the bundle IS the ammunition.
 *
 * @returns {number|null} how many it carries, or null if it is not one of these.
 */
export function bundledAmmoCount(name) {
  const text = String(name ?? "");
  // "(holds 4 stone)" is a CAPACITY, not a load — core names every pack, sack
  // and pouch that way, and `stone` is both the unit they are measured in and
  // the shot a sling throws. The word `holds` is what tells the two apart.
  if (/\bholds\b/i.test(text)) return null;
  const m = /\b(\d+)\s+(?:sling\s+)?(arrows?|bolts?|quarrels?|bullets?|darts?|stones?)\b/i.exec(text);
  return m ? Number(m[1]) : null;
}

/**
 * Resolve a gear profile from an item name, or null.
 *
 * A LOADED DEVICE KEEPS ITS PLACE AND LOSES ITS CAPACITY. Where it rides and
 * what it costs to draw from are facts about the quiver and stay true — RR
 * pp293-294 make a quiver free to reach into, which is the whole reason an
 * archer wears one. What it is not is somewhere to put things: it arrives full
 * of its own arrows. Stamping a capacity on it showed a full quiver as
 * "0 / 1 st — empty", with the twenty arrows readable only in its name and no
 * way to put anything in it, while the count sat where nothing could spend it.
 */
export function gearProfileFor(name) {
  const key = slug(name);
  const profile = GEAR_PROFILES[key] ?? Object.entries(GEAR_PROFILES).find(([k]) => key.startsWith(k) || key.includes(k))?.[1];
  if (!profile) return null;
  if (profile.capacity != null && bundledAmmoCount(name) != null) {
    const { capacity, ...rest } = profile;
    void capacity;
    return Object.freeze(rest);
  }
  return profile;
}

/**
 * Where a garment sits, by name — the fallback for everything the gear profiles
 * do not name, and the reason a hand-made "Cloak of Elvenkind" lands on the
 * shoulders without anyone listing it.
 *
 * ORDERED: the first hit wins. The bulk-material rule comes first because the
 * clothing pack prices cloth by the pound ("Linen, Cheap (1 lb)") alongside the
 * garments made from it, and a bolt of linen is goods rather than something you
 * put on.
 *
 * Vocabulary follows the Treasure Tome's Miscellaneous Magic Item Form table,
 * which is ACKS II's own list of the shapes a worn item comes in.
 */
export const CLOTHING_SLOT_PATTERNS = Object.freeze([
  { re: /\(\s*\d+\s*lb\s*\)/i, slots: [] }, // cloth/metal sold by weight: not a garment
  { re: /\b(belt|sash|girdle|corset)\b/i, slots: [SLOT.belt] },
  { re: /\b(boots?|sandals?|shoes?|slippers?)\b/i, slots: [SLOT.feet] },
  { re: /\b(gloves?|gauntlets?|bracers?|mittens?)\b/i, slots: [SLOT.hands] },
  { re: /\b(cloak|cape|mantle|shawl)\b/i, slots: [SLOT.shoulders] },
  { re: /\b(hat|skullcap|veil|crown|circlet|tiara|coif|hood|headdress)\b/i, slots: [SLOT.head] },
  { re: /\b(necklace|amulet|torc|pendant|collar)\b/i, slots: [SLOT.neck] },
  { re: /\b(ring)\b/i, slots: [SLOT.ring] },
  // Garments worn ON THE BODY, and the reason the list ends with a broad one:
  // the slots above are all the places a single named thing goes, and anything
  // that clothes the torso or legs simply goes ON. It lands in `worn`, which is
  // uncapped, rather than `body`, which is the one suit of armour — a robe and
  // a mail hauberk are not competing for the same place.
  //
  // LAST, so every named slot above wins its own word first: a leather BELT is
  // belt-worn though it is also clothing, and low BOOTS are feet.
  //
  // A NAME TEST IS THE ONLY TEST THERE IS for gear that arrived from outside
  // the clothing pack. The structural answer (`isClothing`) reads
  // `system.subtype`, which core sets on its own clothing items and nothing
  // sets on an item built from a book's starting-equipment list — so a robe
  // imported with a character was unwearable while boots from the same line
  // were fine, purely because "boots" had a pattern and "robe" did not.
  {
    re: /\b(robes?|gowns?|dress(?:es)?|tunics?|shirts?|blouses?|chitons?|togas?|cassocks?|habits?|vestments?|surcoats?|tabards?|doublets?|jerkins?|jackets?|coats?|vests?|smocks?|frocks?|breeches|trousers|pants|leggings|hose|kilts?|skirts?|loincloths?|aprons?)\b/i,
    slots: [SLOT.worn],
  },
]);

/**
 * WEAR LOCATIONS — the single canonical taxonomy of "where is this gear?".
 *
 * Everything that groups gear by position resolves through wear.mjs against
 * these keys — the ACKS character sheet and the loadout summary — so the two
 * cannot disagree.
 *
 * The SLOTS come from acks-lib (`vocab.mjs` WEAR_SLOTS), which is where the
 * declaration on an item points, and which carries each slot's capacity. This
 * feature adds the two buckets that are states rather than places: gear on the
 * character but not worn, and gear inside a container. Nothing here re-declares
 * a slot.
 *
 * Order is display order, head to foot then off-body.
 */
export const WEAR = Object.freeze({
  ...SLOT,
  carried: "carried", // on the character, not worn or wielded
  stowed: "stowed", // inside a container
});

/** Display order for the worn buckets (carried/stowed are handled separately). */
export const WEAR_ORDER = Object.freeze([...WEAR_SLOT_ORDER]);

/**
 * Font Awesome icon per wear location, for sheet + app headers. The slots carry
 * their own; only the two non-slot buckets are named here.
 */
export const WEAR_ICONS = Object.freeze({
  ...Object.fromEntries(Object.entries(WEAR_SLOTS).map(([k, v]) => [k, v.icon])),
  [WEAR.carried]: "fa-sack-xmark",
  [WEAR.stowed]: "fa-box",
});
