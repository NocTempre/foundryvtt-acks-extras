/* global foundry */
/**
 * Weapon classifier. Resolves a core `weapon` item into a normalised profile
 * used by the Loadout model and roll wrapper.
 *
 * Source order (reuse → override → lookup → default):
 *   1. core weapon data (`system.melee/missile`, `system.tags`)
 *   2. per-item overrides `flags.acks-extras.{size,hands,style,handy,thrown,damageType}`
 *   3. built-in RAW name lookup (config.WEAPONS + aliases)
 *   4. default: medium melee, one-handed
 *
 * The annotate macro stamps (2) onto existing core `acks-all-equipment` items so
 * classification is exact; without it, (1)+(3) still classify the RAW weapons.
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";
import {
  SIZE, STYLE, WEAPONS, WEAPON_ALIASES, WEAPON_CATEGORY, WEAPON_FOCUS_GROUPS,
  gearProfileFor, CLOTHING_SLOT_PATTERNS,
} from "./config.mjs";
import { slotsOf, declaresSlots, isClothing } from "../lib/item-model.mjs";
import { SLOT, slug } from "../lib/vocab.mjs";

/* -------------------------------------------- */
/*  Armour classification                        */
/* -------------------------------------------- */

/**
 * Is this armour item a shield?
 *
 * Core's own field, not a heuristic — `system.type` carries the armour ladder
 * plus `shield`, so there is nothing to infer and nothing to declare.
 */
export function isShield(item) {
  return item?.system?.type === "shield";
}

/**
 * Is this armour item a helmet?
 *
 * A DECLARATION, ONCE PRESENT, REPLACES THE HEURISTIC ENTIRELY. Gear that
 * declares where it sits has already answered this, and consulting the name
 * afterwards would let "Great Helm" override a Judge who deliberately set the
 * slot to the body. The name test survives only for gear nobody has annotated,
 * which is every world until the annotate pass runs over it.
 *
 * Core keys its own Mortal Wounds bonus off the same name shape, so the
 * fallback deliberately matches what core would say.
 */
export function isHelmet(item) {
  if (item?.type !== "armor") return false;
  if (item.getFlag?.(MODULE_ID, ITEM_FLAGS.HELMET)) return true;
  if (declaresSlots(item)) return slotsOf(item).includes(SLOT.head);
  return /helm/i.test(item.name ?? "");
}

/**
 * Infer where a piece of gear sits and what it costs to reach into.
 *
 * A BEST GUESS, and treated as one: the annotate step stamps it as the item's
 * declaration and the item sheet offers a slot control to correct it. RAW gives
 * a slot only one job — you cannot wear two of the same thing (Treasure Tome,
 * Miscellaneous Magic Item Form) — so a wrong guess mis-scopes exclusivity and
 * nothing worse. That is what makes inferring acceptable at all.
 *
 * Order: the named gear profiles (RAW carrying devices), then armour's own
 * shape, then the clothing patterns, then nothing. Returning no slots is the
 * common and correct answer — rations, loot, tools and coin are goods you carry,
 * not gear you wear, and they get the wear features switched off by declaring
 * nowhere to go.
 *
 * @returns {{slots: string[], access: string, capacity: number|null}} `access` is
 *   blank and `capacity` null unless the item holds something.
 */
export function inferGear(item) {
  const none = { slots: [], access: "", capacity: null };
  if (!item) return none;

  const profile = gearProfileFor(item.name ?? "");
  if (profile) {
    return {
      slots: [...(profile.slots ?? [])],
      access: profile.access ?? "",
      capacity: profile.capacity ?? null,
    };
  }

  if (item.type === "armor") {
    // A shield is the one piece of gear with a real choice of place: in the
    // hand, or slung (JJ variants). Both are declared; the wearer picks.
    if (isShield(item)) return { ...none, slots: [SLOT.offHand, SLOT.strapped] };
    return { ...none, slots: [isHelmet(item) ? SLOT.head : SLOT.body] };
  }

  if (item.type === "weapon") return { ...none, slots: [SLOT.mainHand, SLOT.offHand, SLOT.bothHands] };

  for (const { re, slots } of CLOTHING_SLOT_PATTERNS) {
    if (re.test(item.name ?? "")) return { ...none, slots: [...slots] };
  }

  // Clothing the patterns did not name is still worn — a chiton, a cassock, a
  // loincloth. `worn` is uncapped, so guessing it costs nothing.
  //
  // NO CAPACITY IS INVENTED for a garment. Whether a coat has pockets deep
  // enough to matter is a Judge's call about that coat, not something a name
  // can be read for, so it is set on the item rather than guessed here.
  if (isClothing(item)) return { ...none, slots: [SLOT.worn] };

  return none;
}

/** Collect the lowercased tag tokens on a core weapon (title or value). */
function tagTokens(item) {
  const out = new Set();
  for (const tag of item.system?.tags ?? []) {
    for (const field of [tag?.title, tag?.value]) {
      const t = slug(field);
      if (t) out.add(t);
    }
  }
  return out;
}

/** Resolve the canonical WEAPONS key for an item, or null. */
export function weaponKey(item) {
  const key = slug(item?.name);
  if (WEAPONS[key]) return key;
  if (WEAPON_ALIASES[key] && WEAPONS[WEAPON_ALIASES[key]]) return WEAPON_ALIASES[key];
  // partial contains match (e.g. "long bow, masterwork" → "longbow")
  for (const k of Object.keys(WEAPONS)) {
    if (key.includes(k)) return k;
  }
  return null;
}

/** Exact-or-alias key resolution — no fuzzy substring match (see equipmentClass). */
function strictWeaponKey(name) {
  const key = slug(name);
  if (WEAPONS[key]) return key;
  if (WEAPON_ALIASES[key] && WEAPONS[WEAPON_ALIASES[key]]) return WEAPON_ALIASES[key];
  return null;
}

/**
 * The family's EQUIPMENT ROOT — gear is a special class of item, and shares its
 * root. Given only a NAME, say which core item type a piece of gear should
 * become and the stats that type needs — so a
 * torch (a 1d4 light-weapon) and a flask of military oil / holy water (thrown
 * splash flasks) import as WEAPONS, while a lantern/candle stay plain
 * light-bearing items. acks-content CONSUMES this rather than re-hardcoding the
 * rules; the WEAPONS config here stays the single source of truth. Uses strict
 * (exact/alias) matching so ordinary gear is never reclassified by a loose
 * substring hit.
 * @returns {{type:string, damage?:string, melee?:boolean, missile?:boolean,
 *   thrown?:boolean, handy?:boolean, light?:boolean, splash?:boolean,
 *   consumable?:boolean, damageType?:string}|null} null if unrecognised.
 */
export function equipmentClass(name) {
  const key = strictWeaponKey(name);
  if (key) {
    const w = WEAPONS[key];
    const special = w.special ?? [];
    // A THROWN melee weapon is usable as a missile too (RR p296: "weapon
    // proficiency includes the ability to use it as a missile weapon"), so it
    // imports with BOTH melee and missile set — which is exactly what makes core
    // present its melee-vs-thrown range selector (item.mjs rollWeapon gates on
    // `system.missile && system.melee`). A pure-thrown missile (dart, oil) is
    // already missile-only.
    const missile = !!(w.missile || w.thrown);
    const base = {
      damage: w.damage || "",
      melee: !!w.melee,
      missile,
      thrown: !!w.thrown,
      handy: !!w.handy,
      damageType: w.type || "",
      light: special.includes("light"),
      splash: special.includes("splash"),
      consumable: special.includes("consumable"),
    };
    // A TORCH is carried as a STACK — a bundle you keep in a pack — and only
    // becomes a 1d4 light-WEAPON when one is READIED for use (see prepareTorch in
    // actions.mjs). So the root imports it as a light ITEM (quantity-bearing),
    // recording the weapon stats the prepare step needs under `prepareAs`. Torch
    // is the only weapon-table entry tagged `light`.
    if (base.light) return { type: "item", prepareAs: "weapon", ...base };
    return { type: "weapon", ...base };
  }
  // A lantern (device) or candle stays a plain item but is flagged a light
  // source so the content/sheet layers can treat it as equippable/holdable.
  if (/\b(lantern|candle)\b/i.test(name)) return { type: "item", light: true };
  return null;
}

/**
 * Build the resolved profile for a weapon item.
 * @returns {{key,size,melee,missile,thrown,handy,twoHandedForced,damage,damage2h,type,cat,special,reqStr}}
 */
export function classifyWeapon(item) {
  const flag = (k) => item.getFlag?.(MODULE_ID, k);
  const key = weaponKey(item);
  const base = key ? WEAPONS[key] : null;
  const tags = tagTokens(item);

  // (1) core booleans/tags, (3) lookup, (4) default
  const melee = item.system?.melee ?? base?.melee ?? !item.system?.missile ?? true;
  const missile = item.system?.missile ?? base?.missile ?? false;
  const twoHandedTag = tags.has("twohanded") || tags.has("twohand") || tags.has("twohands");
  const handyTag = tags.has("handy");
  const thrownTag = tags.has("thrown") || tags.has("throw");

  // (2) overrides win
  const sizeOverride = flag(ITEM_FLAGS.SIZE);
  const size = sizeOverride ?? base?.size ?? (twoHandedTag ? SIZE.LARGE : SIZE.MEDIUM);

  const profile = {
    key,
    size,
    melee,
    missile,
    thrown: flag(ITEM_FLAGS.THROWN) ?? base?.thrown ?? thrownTag ?? false,
    handy: flag(ITEM_FLAGS.HANDY) ?? base?.handy ?? handyTag ?? false,
    twoHandedForced: base?.twoHandedForced ?? (twoHandedTag && !base) ?? false,
    damage: item.system?.damage || base?.damage || "1d6",
    damage2h: base?.damage2h ?? null,
    type: flag(ITEM_FLAGS.DAMAGE_TYPE) ?? base?.type ?? "",
    cat: base?.cat ?? WEAPON_CATEGORY.OTHER,
    special: base?.special ?? [],
    reqStr: base?.reqStr ?? 0,
    handsOverride: flag(ITEM_FLAGS.HANDS) ?? null,
    styleHint: flag(ITEM_FLAGS.STYLE) ?? null,
  };
  return profile;
}

/**
 * Hand cost of a weapon given whether it is being wielded two-handed.
 * RR p. 127: tiny/small = 1; medium = 1 or 2; large = 2; missile = 2 unless
 * Handy or Thrown; net/staff-sling forced 2H.
 */
export function handCost(profile, { twoHanded = false } = {}) {
  if (profile.handsOverride != null) return profile.handsOverride;
  if (profile.twoHandedForced) return 2;
  if (profile.missile && !profile.melee) return profile.handy || profile.thrown ? 1 : 2;
  switch (profile.size) {
    case SIZE.TINY:
    case SIZE.SMALL:
      return 1;
    case SIZE.LARGE:
      return 2;
    case SIZE.MEDIUM:
    default:
      return twoHanded ? 2 : 1;
  }
}

/** True if this weapon can only ever be used two-handed. */
export function isTwoHandedOnly(profile) {
  return profile.twoHandedForced || profile.size === SIZE.LARGE || (profile.missile && !profile.melee && !profile.handy && !profile.thrown);
}

/** True if a melee weapon may be wielded in one hand (for dual/shield styles). */
export function canOneHand(profile) {
  if (profile.handsOverride === 1) return true;
  if (profile.twoHandedForced) return false;
  return [SIZE.TINY, SIZE.SMALL, SIZE.MEDIUM].includes(profile.size);
}

/** The Weapon Focus group key covering this weapon, or null. */
export function focusGroup(profile) {
  if (!profile.key) return null;
  for (const [group, keys] of Object.entries(WEAPON_FOCUS_GROUPS)) {
    if (keys.includes(profile.key)) return group;
  }
  return null;
}

/**
 * Infer the fighting style in use from the equipped weapons and shield.
 * @param {object[]} weapons resolved profiles with `{handsUsed, wieldTwoHanded}`
 * @param {boolean} hasShield
 * @returns {string} STYLE.*
 */
export function inferStyle(weapons, hasShield) {
  const melee = weapons.filter((w) => w.melee);
  const missileOnly = weapons.filter((w) => w.missile && !w.melee);
  if (hasShield && (weapons.length === 1 || (weapons.length === 0 && hasShield))) return STYLE.WEAPON_SHIELD;
  if (hasShield && weapons.length >= 1) return STYLE.WEAPON_SHIELD;
  if (melee.length >= 2) return STYLE.DUAL;
  if (melee.length === 1 && melee[0].wieldTwoHanded) return STYLE.TWO_HANDED;
  if (melee.length === 1) return STYLE.SINGLE;
  if (missileOnly.length >= 1) return STYLE.MISSILE;
  return STYLE.SINGLE;
}

/** Deep-clone-safe helper for foundry environments. */
export function cloneProfile(p) {
  return foundry.utils.deepClone(p);
}
