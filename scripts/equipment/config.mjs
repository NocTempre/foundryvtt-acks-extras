/**
 * Built-in equipment vocabulary (ACKS II Revised Rulebook, Equipment pp.
 * 126–127; Combat pp. 296–299): the structural enums (weapon sizes, fighting
 * styles, proficiency categories), the gear profiles and the wear slots. No
 * weapon is listed here: the weapon rows are imported from the Judge's own
 * book (`weapon-rows.mjs`, `weapon-source.mjs`).
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

/**
 * Weapon proficiency categories (JJ p. 290 narrow/broad groupings) — used for
 * proficiency enforcement, Weapon Focus, and Martial Training.
 */
export const WEAPON_CATEGORY = Object.freeze({
  AXE: "axe",
  BOW_CROSSBOW: "bowCrossbow", // one category: the books list bows and crossbows together (RR ch. 1, Weapons)
  FLAIL_HAMMER_MACE: "flailHammerMace",
  SWORD_DAGGER: "swordDagger",
  SPEAR_POLEARM: "spearPolearm",
  OTHER: "other", // the catch-all: a weapon no other category names
});

/**
 * What a thrown thing is called when the book's name for it says every class
 * throws it: a flask, a bottle, a rock, a stick or a torch (RR ch. 1, Weapon
 * Proficiency), and a vial, the holy water's printed container (RR ch. 4,
 * Equipment Descriptions). Read against the printed name of a weapon row and
 * the name of a thrown item no row places.
 */
export const IMPROVISED_THROWN = /\b(flasks?|bottles?|vials?|rocks?|sticks?|torch(?:es)?)\b/i;

/** Armour weight categories (core `system.type`) ordered light→heavy. */
export const ARMOR_LADDER = Object.freeze(["unarmored", "veryLight", "light", "medium", "heavy"]);

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
 * The masterwork tiers (RR p.159), each mapped to the key of the variation
 * document the importer mints for it. A tier is a name an item's flag stores
 * (`flags.acks-extras.masterwork.tier`); what the tier is worth is the
 * document's `deltas` and `cost`, read by `printed-layers.mjs` and absent
 * until the Judge's book is imported. The tier `weaponToDamage` is the
 * document registered as `weaponDamage`.
 */
export const MASTERWORK = Object.freeze({
  weaponToHit: "masterwork.weaponToHit",
  weaponToDamage: "masterwork.weaponDamage",
  weaponBoth: "masterwork.weaponBoth",
  armorLight: "masterwork.armorLight",
  armorAC: "masterwork.armorAC",
});

/**
 * The Silver quality (RR ch.4 Weapon Qualities).
 *
 * Silver is the ONLY material in ACKS II that changes what a weapon can do —
 * there is no cold iron, mithril or adamantine. Its whole mechanical weight is
 * what the blade COUNTS AS, never a stat: a monster whose immunity or
 * resistance carries the silver flaw treats a silver weapon as magic, and the
 * spells that turn aside mundane damage do not turn silver aside.
 *
 * `quality` is the weapon-table tag the quality goes by. `variation` is the
 * key of the document the importer mints for the plating; its price scaling
 * (`cost.baseMul`) is read by `printed-layers.mjs` and applied ONLY to an item
 * a reader explicitly plated (properties.mjs): the weapon list already prices
 * its silvered rows at their silvered price, and scaling those again would
 * bill the same plating twice.
 */
export const SILVER = Object.freeze({ quality: "silver", variation: "material.silver" });

/**
 * RAW carrying devices (RR pp. 142–145, 293–294). Core's
 * acks-adventuring-equipment pack already ships these items, so we ANNOTATE
 * them in place (see the Annotate macro) rather than duplicating them.
 *
 * One table, because these are all the same fact about one piece of gear:
 * `holds` says it takes other gear, `slots` where it rides, and `access` what
 * it costs to get something out — free from rigging worn on the body
 * (harness, belt pouch, bowcase, quiver, sheath), an action in lieu of movement
 * from a pack (backpack, rucksack, sack). A container with no slots is not worn
 * at all: a barrel and an ironbound chest sit on the floor.
 *
 * How MUCH a container holds is never here: the price grid prints it in the
 * row's label and the importer writes it to the item's `gear.capacity`
 * (`importer/gear-prices.mjs` `labelCapacity`). A container the grid states no
 * capacity for holds without a limit and says it is not imported.
 */
// A pouch under the names a Judge types, without core's "(holds …)" suffix:
// where it rides and what reaching into it costs are the device's.
const POUCH = Object.freeze({ slots: [SLOT.belt], access: "free" });

export const GEAR_PROFILES = Object.freeze({
  // Rigging — worn, and RAW-free to draw from.
  adventurersharness: { slots: [SLOT.belt], access: "free", harness: true },
  bowquiver: { slots: [SLOT.back], access: "free", holds: true, bowquiver: true },
  quiver: { slots: [SLOT.belt], access: "free", holds: true },
  // "Case, 20 Bolts". Generic enough to want the comment: the only `case` in
  // the RAW equipment list is the bolt case.
  case: { slots: [SLOT.belt], access: "free", holds: true },
  scabbard: { slots: [SLOT.belt], access: "free" },
  pouchpurse: { ...POUCH, holds: true },
  // Without keys of their own, "Belt Pouch" falls through to the garment
  // patterns, which claim the word "belt" and annotate it as a belt that
  // holds nothing.
  beltpouch: POUCH,
  purse: POUCH,
  // Packs — worn, but an action to open.
  backpack: { slots: [SLOT.back], access: "action", holds: true },
  rucksack: { slots: [SLOT.back], access: "action", holds: true },
  sacklarge: { slots: [SLOT.back], access: "action", holds: true },
  sacksmall: { slots: [SLOT.back], access: "action", holds: true },
  // Rides the mount, not the rider — so no slot on a character.
  saddlebag: { access: "action", holds: true },
  // Fixed containers: never worn.
  chestironbound: { holds: true },
  barrel: { holds: true },
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
  // "(holds N stone)" is a CAPACITY, not a load — core names every pack, sack
  // and pouch that way, and `stone` is both the unit they are measured in and
  // the shot a sling throws. The word `holds` is what tells the two apart.
  if (/\bholds\b/i.test(text)) return null;
  const m = /\b(\d+)\s+(?:sling\s+)?(arrows?|bolts?|quarrels?|bullets?|darts?|stones?)\b/i.exec(text);
  return m ? Number(m[1]) : null;
}

/**
 * Resolve a gear profile from an item name, or null.
 *
 * A loaded device keeps its place and stops holding gear: it arrives full of
 * its own arrows, so it is not also somewhere to put things (see
 * docs/equipment/DECISIONS.md, "2026-08-11 — a device sold with its load is
 * the ammunition, not a container").
 */
export function gearProfileFor(name) {
  const key = slug(name);
  const profile = GEAR_PROFILES[key] ?? Object.entries(GEAR_PROFILES).find(([k]) => key.startsWith(k) || key.includes(k))?.[1];
  if (!profile) return null;
  if (profile.holds && bundledAmmoCount(name) != null) {
    const { holds, ...rest } = profile;
    void holds;
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
  { re: /\b(belts?|sash(?:es)?|girdles?|corsets?)\b/i, slots: [SLOT.belt] },
  { re: /\b(boots?|sandals?|shoes?|slippers?)\b/i, slots: [SLOT.feet] },
  { re: /\b(gloves?|gauntlets?|bracers?|mittens?)\b/i, slots: [SLOT.hands] },
  { re: /\b(cloaks?|capes?|mantles?|shawls?)\b/i, slots: [SLOT.shoulders] },
  { re: /\b(hats?|caps?|skullcaps?|turbans?|veils?|crowns?|circlets?|tiaras?|coifs?|hoods?|head\s*dress(?:es)?)\b/i, slots: [SLOT.head] },
  { re: /\b(necklaces?|amulets?|torcs?|pendants?|collars?)\b/i, slots: [SLOT.neck] },
  { re: /\b(rings?)\b/i, slots: [SLOT.ring] },
  // Garments worn ON THE BODY: lands in `worn` (uncapped), not `body` (the one
  // suit of armour). LAST, so every named slot above wins its own word first —
  // a leather BELT is belt-worn though it is also clothing. See
  // docs/equipment/DECISIONS.md, "2026-08-11 — clothing the named slots do
  // not claim is still worn."
  {
    re: /\b(robes?|gowns?|dress(?:es)?|tunics?|shirts?|blouses?|chitons?|togas?|cassocks?|habits?|vestments?|surcoats?|tabards?|doublets?|jerkins?|jackets?|coats?|vests?|smocks?|frocks?|breeches|trousers|pants|leggings|hose|kilts?|skirts?|loincloths?|aprons?)\b/i,
    slots: [SLOT.worn],
  },
]);

/**
 * The slots the clothing patterns give a name, or null when no pattern claims
 * it. An empty list is a real answer: cloth sold by weight is goods.
 *
 * Only the name's head is read — what comes before "with". A garment that
 * names what it carries is still that garment: "Grey cassock with hood" is a
 * cassock, worn on the body, where reading the whole name let the hood claim
 * the head ahead of the garment row.
 */
export function clothingSlotsFor(name) {
  const head = String(name ?? "").split(/\s+with\s+/i)[0];
  for (const { re, slots } of CLOTHING_SLOT_PATTERNS) {
    if (re.test(head)) return slots;
  }
  return null;
}

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
  companion: "companion", // a creature an ability confers, kept as a slot
});

/** Display order for the worn buckets (carried/stowed are handled separately). */
export const WEAR_ORDER = Object.freeze([...WEAR_SLOT_ORDER]);

/**
 * Font Awesome icon per wear location, for sheet + app headers. The slots carry
 * their own; only the non-slot buckets are named here.
 */
export const WEAR_ICONS = Object.freeze({
  ...Object.fromEntries(Object.entries(WEAR_SLOTS).map(([k, v]) => [k, v.icon])),
  [WEAR.carried]: "fa-sack-xmark",
  [WEAR.stowed]: "fa-box",
  [WEAR.companion]: "fa-paw",
});
