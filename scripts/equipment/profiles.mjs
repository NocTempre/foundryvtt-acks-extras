/* global foundry */
/**
 * Weapon classifier. Resolves a core `weapon` item into a normalised profile
 * used by the Loadout model and roll wrapper.
 *
 * Source order (reuse → override → lookup → default):
 *   1. core weapon data (`system.melee/missile`, `system.special.*`, `system.customTags`)
 *   2. per-item overrides `flags.acks-extras.{size,hands,style,handy,thrown,damageType}`
 *   3. the RAW table row the item is identified as (`weaponIdentity`)
 *   4. default: melee, one-handed; a size, class or damage die nothing above
 *      states is null (the die ""), never invented
 *
 * The annotate macro stamps (2) onto existing core `acks-all-equipment` items so
 * classification is exact; without it, (1)+(3) still classify the RAW weapons.
 *
 * Step (3) is the whole of what makes a sword a sword here: WHICH weapon a
 * document is decides its proficiency category, size, hand cost, damage type
 * and Weapon Focus group. `weaponIdentity` is where that is decided and where
 * the answer's provenance is reported.
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";
import { SIZE, STYLE, WEAPON_CATEGORY, IMPROVISED_THROWN, gearProfileFor, clothingSlotsFor } from "./config.mjs";
import { slotsOf, declaresSlots, isClothing } from "../lib/item-model.mjs";
import { SLOT, slug, nameKeys, ITEM_TYPE } from "../lib/vocab.mjs";
import { weaponRow, weaponKeys, keyForName, weaponFocusGroup, weaponThrowsAsAnyone } from "../lib/weapons.mjs";
import { splitDamage, joinDamage, damageFormulaOf } from "./properties.mjs";

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
  if (item?.type !== ITEM_TYPE.armor) return false;
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
 * @returns {{slots: string[], access: string, holds: boolean, relief: number|null, loaded6: number|null}}
 *   `access` is blank unless the item holds something; `holds` says only that
 *   it takes gear, never how much (the capacity is the item's own, read from
 *   the page by the importer); `relief` is null unless the item is a harness
 *   whose own text states the weight it secures, and `loaded6` unless it is a
 *   bowquiver whose own text states what the loaded assembly counts as.
 */
export function inferGear(item) {
  const none = { slots: [], access: "", holds: false, relief: null, loaded6: null };
  if (!item) return none;

  const profile = gearProfileFor(item.name ?? "");
  if (profile) {
    return {
      slots: [...(profile.slots ?? [])],
      access: profile.access ?? "",
      holds: profile.holds === true,
      // What a harness secures is the book's figure, and it arrives with the
      // item — read off its own name or description — never from a profile.
      relief: profile.harness ? reliefStated(item) : null,
      // The same for a bowquiver's loaded count: the item's own text, or none.
      loaded6: profile.bowquiver ? loadedStated(item) : null,
    };
  }

  if (item.type === ITEM_TYPE.armor) {
    // A shield is the one piece of gear with a real choice of place: in the
    // hand, or slung (JJ variants). Both are declared; the wearer picks.
    if (isShield(item)) return { ...none, slots: [SLOT.offHand, SLOT.strapped] };
    return { ...none, slots: [isHelmet(item) ? SLOT.head : SLOT.body] };
  }

  if (item.type === ITEM_TYPE.weapon) return { ...none, slots: [SLOT.mainHand, SLOT.offHand, SLOT.bothHands] };

  const garment = clothingSlotsFor(item.name);
  if (garment) return { ...none, slots: [...garment] };

  // Clothing the patterns did not name is still worn — a chiton, a cassock, a
  // loincloth. `worn` is uncapped, so guessing it costs nothing.
  //
  // NO CAPACITY IS INVENTED for a garment. Whether a coat has pockets deep
  // enough to matter is a Judge's call about that coat, not something a name
  // can be read for, so it is set on the item rather than guessed here.
  if (isClothing(item)) return { ...none, slots: [SLOT.worn] };

  return none;
}

/**
 * The `gear` flag the Annotate pass writes for an item — where it sits, what
 * reaching into it costs, whether it takes gear — or null when inference has
 * nothing to say (rations, loot, coin), which keeps the item plain goods.
 */
export function inferredGearFlag(item) {
  const gear = inferGear(item);
  if (!gear.slots.length && !gear.access && !gear.holds && gear.relief == null && gear.loaded6 == null) return null;
  return {
    slots: gear.slots,
    access: gear.access,
    ...(gear.holds ? { holds: true } : {}),
    // Only when the item's own text states it: a silent harness keeps
    // whatever the Judge typed on its sheet.
    ...(gear.relief != null ? { relief: gear.relief } : {}),
    ...(gear.loaded6 != null ? { loaded6: gear.loaded6 } : {}),
  };
}

/**
 * The places an item may be worn: its declaration where it has one, else the
 * inferred guess. Gear that was never annotated — every price-list row an
 * import before the fix made, and every template copy cut from one — declares
 * nothing, and reading the declaration alone left a leather belt with no Wear
 * control at all. A declaration of nowhere (`[]`) stays nowhere.
 */
export function wearableSlots(item) {
  return declaresSlots(item) ? slotsOf(item) : inferGear(item).slots;
}

/** "1", "1/2" or "0.5" as a number of stone; null for anything else. */
function stoneNumber(text) {
  const m = /^(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?$/.exec(String(text ?? "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] ? n / Number(m[2]) : n;
}

/**
 * The weight of equipment a harness relieves its wearer of, as the item's own
 * name or description states it — the sentence that says what may be ignored,
 * in stone — or null when the item does not say, which leaves it to the Judge
 * on the item's sheet.
 */
function reliefStated(item) {
  const text = `${item?.name ?? ""} ${item?.system?.description ?? ""}`;
  const m = /\bignores?\s+(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)\s*stones?\b/i.exec(text);
  return m ? stoneNumber(m[1]) : null;
}

/**
 * What a loaded bowquiver counts as for encumbrance, in sixths of a stone (the
 * family's weight unit, which an "item" is), as the item's own description
 * states it — the clause that sets the assembly against a count of items — or
 * null when it does not say, which leaves the plain sum standing. An empty
 * one counts as its own weight and needs no figure.
 */
function loadedStated(item) {
  const text = String(item?.system?.description ?? "").replace(/<[^>]*>/g, " ");
  const m = /\bwith\b[^.]*?\bcounts?\s+as\s+(\d+)\s+items?\b/i.exec(text);
  return m ? Number(m[1]) : null;
}

/**
 * How many of a coin weigh one stone, as the item's own name or description
 * states it — the sentence that sets a count of coins against a weight in
 * stone — or null when the item does not say, which leaves the coin at the
 * system's rate until a Judge types one on its sheet.
 */
export function perStoneStated(item) {
  const text = `${item?.name ?? ""} ${item?.system?.description ?? ""}`;
  // The stone may stand bare ("per stone"), under an article, or under a number.
  const m = /(\d[\d,]*)\s+(?:\w+\s+)?(?:coins?|pieces?)\s+(?:equals?|weighs?|makes?|to|per)\s+(?:(?:(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)|an?|one|the)\s*)?stones?\b/i.exec(text);
  if (!m) return null;
  const count = Number(m[1].replace(/,/g, ""));
  const stones = m[2] ? stoneNumber(m[2]) : 1;
  return count > 0 && stones > 0 ? count / stones : null;
}

/**
 * Collect the lowercased tag tokens on a core weapon: its custom tags, the
 * special properties it declares, and the `{title, value}` tags an item made
 * before the system's weapon schema carried either.
 */
function tagTokens(item) {
  const out = new Set();
  const sys = item.system ?? {};
  for (const tag of sys.customTags ?? []) {
    const t = slug(tag);
    if (t) out.add(t);
  }
  for (const [key, on] of Object.entries(sys.special ?? {})) if (on) out.add(slug(key));
  for (const tag of Array.isArray(sys.tags) ? sys.tags : []) {
    for (const field of [tag?.title, tag?.value]) {
      const t = slug(field);
      if (t) out.add(t);
    }
  }
  return out;
}

/** The system's weapon sizes that name a size of the table's; `na` names none. */
export const CORE_SIZES = Object.freeze({ tiny: SIZE.TINY, small: SIZE.SMALL, medium: SIZE.MEDIUM, large: SIZE.LARGE });

/** A module flag read off a live document or a plain data object alike. */
function mflag(item, key) {
  return item?.getFlag?.(MODULE_ID, key) ?? item?.flags?.[MODULE_ID]?.[key];
}

/**
 * Exact-or-alias resolution of one written name, or null.
 *
 * Every form `nameKeys` reads a name in is tried, the name as written first: a
 * catalogue name printed head-first ("Sword, Two-Handed") is the same weapon
 * as the one printed the other way round, and missing it drops the item to the
 * loose rung, where the one-handed sword its name contains answers for it.
 */
function namedKey(name) {
  if (!name) return null;
  for (const form of nameKeys(name)) {
    const key = keyForName(form);
    if (key) return key;
  }
  return null;
}

/**
 * The longest catalogue name a written name CONTAINS, or null.
 *
 * Longest first, because table order would otherwise let a shorter key that is
 * contained in a longer one win on the strength of being declared earlier:
 * "Silver Dagger, masterwork" contains both `dagger` and `silverdagger`, and
 * `dagger` is declared first — so the answer was a plain dagger and the Silver
 * quality went with it.
 */
function containedKey(name) {
  const key = slug(name);
  if (!key) return null;
  const byLength = weaponKeys().sort((a, b) => b.length - a.length);
  return byLength.find((k) => key.includes(k)) ?? null;
}

/** Cookbook id prefix the importer mints a weapon row under. */
const DEF_WEAPON_PREFIX = "def.weapon.";

/** The catalogue key a `def.weapon.<name>` cookbook id names, or null. */
function refKey(ref) {
  const s = String(ref ?? "");
  return s.startsWith(DEF_WEAPON_PREFIX) ? namedKey(s.slice(DEF_WEAPON_PREFIX.length)) : null;
}

/**
 * Which RAW weapon a document IS, and on whose authority.
 *
 * A DECLARATION OUTRANKS AN INFERENCE, and the name is an inference. It is the
 * only source that can be wrong about an item everything else describes
 * correctly: a starting template renames the gear it grants to the words its
 * own page printed, so a hand axe arrives called "Francisca" and a two-handed
 * sword called "Two-handed iron sword". Reading those gives no axe at all and
 * the wrong sword — and the answer is not a longer alias list, because the
 * descriptor is a Judge's or a book's prose and there is no end to it.
 *
 * The ladder, most authoritative first:
 *
 * - `flag` — `flags.acks-extras.profileKey`, an explicit answer. The annotate
 *   pass writes what it resolved, and the Repair window writes what a Judge
 *   decided; either way nothing below is consulted again.
 * - `mint` — `flags.acks-extras.cookbook.id`, on a document the importer built
 *   from the reader's own weapon grid. The document *is* the catalogue row.
 * - `name` — the document's own name, exactly or by alias. Precise by
 *   construction, so it outranks the base a skin was copied from: "Silver
 *   Dagger" says more than the Dagger row it was cut from.
 * - `skin` — `flags.acks-extras.skin`, what a printed descriptor was skinned
 *   over. Its `base` cookbook id is asked before its `baseName`: the id is the
 *   catalogue row, the name only a reading of it.
 * - `loose` — the longest catalogue name the document's name contains.
 *
 * `ignoreDeclared` asks what the ladder would say WITHOUT the flag — the reading
 * the sheet's control shows beside "Auto", so a Judge can see what they are
 * overriding before they override it.
 *
 * @returns {{key: string|null, source: "flag"|"mint"|"skin"|"name"|"loose"|""}}
 */
export function weaponIdentity(item, { ignoreDeclared = false } = {}) {
  if (!item) return { key: null, source: "" };

  const declared = ignoreDeclared ? null : namedKey(mflag(item, ITEM_FLAGS.PROFILE_KEY));
  if (declared) return { key: declared, source: "flag" };

  const minted = refKey(mflag(item, "cookbook")?.id);
  if (minted) return { key: minted, source: "mint" };

  const named = namedKey(item.name);
  if (named) return { key: named, source: "name" };

  const skin = mflag(item, "skin");
  if (skin) {
    const base = refKey(skin.base) ?? namedKey(skin.baseName) ?? containedKey(skin.baseName);
    if (base) return { key: base, source: "skin" };
  }

  const loose = containedKey(item.name);
  return loose ? { key: loose, source: "loose" } : { key: null, source: "" };
}

/** Resolve the canonical weapon-table key for an item, or null. */
export function weaponKey(item) {
  return weaponIdentity(item).key;
}

/**
 * A weapon document the module cannot place among the imported weapon rows.
 *
 * Nothing throws, which is what makes it worth naming. Its size, damage type,
 * Weapon Focus group and proficiency CATEGORY are whatever the item itself
 * declares and otherwise unstated ("not imported"), so no grant can decide the
 * weapon and it is never refused; a Judge names its Weapon type on the sheet's
 * Construction panel.
 */
export function isUnidentifiedWeapon(item) {
  return item?.type === ITEM_TYPE.weapon && !weaponIdentity(item).key;
}

/**
 * Exact-or-alias key resolution of the name exactly as written — no reordered
 * form, no substring match (see equipmentClass). Narrower than `namedKey` on
 * purpose: this decides which core type the importer mints a gear row as, and
 * reading a reordered form here re-types price-list rows the importer mints as
 * plain inventory.
 */
function strictWeaponKey(name) {
  return keyForName(name);
}

/**
 * The family's EQUIPMENT ROOT — gear is a special class of item, and shares its
 * root. Given only a NAME, say which core item type a piece of gear should
 * become and the stats that type needs — so a
 * torch (a light-weapon) and a flask of military oil / holy water (thrown
 * splash flasks) import as WEAPONS, while a lantern/candle stay plain
 * light-bearing items. The importer CONSUMES this rather than re-hardcoding the
 * rules; the weapon table (`lib/weapons.mjs`) stays the single source of truth. Uses strict
 * (exact/alias) matching so ordinary gear is never reclassified by a loose
 * substring hit.
 * @returns {{type:string, damage?:string, melee?:boolean, missile?:boolean,
 *   thrown?:boolean, handy?:boolean, light?:boolean, splash?:boolean,
 *   consumable?:boolean, damageType?:string}|null} null if unrecognised.
 */
export function equipmentClass(name) {
  const key = strictWeaponKey(name);
  if (key) {
    const w = weaponRow(key);
    const special = w.special ?? [];
    // A THROWN melee weapon is usable as a missile too (RR p. 296), so it
    // imports with BOTH melee and missile set, and the system offers each as
    // its own kind of attack. A pure-thrown missile (dart, oil) is already
    // missile-only.
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
    // becomes a light-WEAPON when one is READIED for use (see prepareTorch in
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
 * The grips a weapon may be held in, as a Judge declares them.
 *
 * RR p. 127 derives these from SIZE — tiny and small take one hand, large takes
 * two, medium takes either — which is right for the printed table and silent
 * about everything else. A weapon whose size nobody could resolve defaults to
 * medium and so silently reads as versatile; one a Judge built has no printed
 * row to derive anything from. Declaring the grips answers both.
 */
export const GRIPS = Object.freeze(new Set(["1h", "versatile", "2h"]));

/** The proficiency classes a weapon may be declared to belong to. */
export const WEAPON_CATEGORY_VALUES = Object.freeze(new Set(Object.values(WEAPON_CATEGORY)));

/**
 * The damage a weapon deals in a two-handed grip, given the damage it deals in
 * one. The row prints both for its own die; a flat modifier the item carries on
 * that die (a masterwork tier, a dent, a Judge's +1) carries onto the larger
 * one. An item whose die is not the row's is a weapon the row no longer
 * describes, and has no two-handed figure: its grip deals its own damage.
 */
export function twoHandedDamage(damage, row) {
  if (!row?.damage2h) return null;
  const die = (s) => String(s).replace(/\s+/g, "").toLowerCase();
  const own = splitDamage(damage);
  const printed = splitDamage(row.damage);
  if (die(own.die) !== die(printed.die)) return null;
  const larger = splitDamage(row.damage2h);
  return joinDamage(larger.die, larger.flat + own.flat - printed.flat);
}

/**
 * Build the resolved profile for a weapon item. `size`, `cat` and `damage` are
 * null, null and "" where nothing imported states them (the item itself, or a
 * row that carries the field): such a weapon is undecided to proficiency
 * (`isWeaponProficient`) and costs one hand.
 * @returns {{key,size,melee,missile,thrown,handy,twoHandedForced,damage,damage2h,type,cat,special,grips}}
 */
export function classifyWeapon(item) {
  // `mflag`, not `getFlag`: the classifier is asked about payload OBJECTS as
  // well as documents — a template's build data is checked before it is created
  // — and a `getFlag`-only read answers undefined for every one of them, which
  // reads as "no overrides declared" rather than as "cannot see them".
  const flag = (k) => mflag(item, k);
  const key = weaponKey(item);
  const base = key ? weaponRow(key) : null;
  const tags = tagTokens(item);

  // (1) core booleans/tags, (3) lookup, (4) default
  const melee = item.system?.melee ?? base?.melee ?? !item.system?.missile ?? true;
  const missile = item.system?.missile ?? base?.missile ?? false;
  const twoHandedTag = tags.has("twohanded") || tags.has("twohand") || tags.has("twohands");
  const handyTag = tags.has("handy");
  const thrownTag = tags.has("thrown") || tags.has("throw");

  // (2) overrides win; the item's own declared size and special properties
  // come before the table's row, and a property the item leaves off is no
  // declaration — the row still answers it.
  const sizeOverride = flag(ITEM_FLAGS.SIZE);
  const coreSize = CORE_SIZES[item.system?.size] ?? null;
  const size = sizeOverride ?? coreSize ?? base?.size ?? null;
  // The item's own die, else the row's: a weapon neither states has none.
  const damage = damageFormulaOf(item) || base?.damage || "";
  const alternate = item.system?.damage?.alternate?.formula?.trim?.() || null;

  const profile = {
    key,
    size,
    melee,
    missile,
    thrown: flag(ITEM_FLAGS.THROWN) ?? (item.system?.special?.thrown || undefined) ?? base?.thrown ?? thrownTag ?? false,
    handy: flag(ITEM_FLAGS.HANDY) ?? (item.system?.special?.handy || undefined) ?? base?.handy ?? handyTag ?? false,
    // The row's statement that the weapon needs both hands, or the core tag
    // the item carries: either forces them, whatever the size.
    twoHandedForced: base?.twoHandedForced === true || twoHandedTag,
    damage,
    damage2h: alternate ?? twoHandedDamage(damage, base),
    type: flag(ITEM_FLAGS.DAMAGE_TYPE) ?? base?.type ?? "",
    // The declared class outranks the row's, and an unknown value is no
    // declaration at all — a hand-edited flag degrades to the row, never to a
    // class no grant can name.
    cat: WEAPON_CATEGORY_VALUES.has(flag(ITEM_FLAGS.CATEGORY)) ? flag(ITEM_FLAGS.CATEGORY) : base?.cat ?? null,
    special: base?.special ?? [],
    anyoneThrows: false,
    grips: GRIPS.has(flag(ITEM_FLAGS.GRIPS)) ? flag(ITEM_FLAGS.GRIPS) : null,
    handsOverride: flag(ITEM_FLAGS.HANDS) ?? null,
    styleHint: flag(ITEM_FLAGS.STYLE) ?? null,
  };
  profile.anyoneThrows = throwsAsAnyone(item, profile, tags);
  return profile;
}

/**
 * Does every character throw this proficiently, whatever their class (RR ch.
 * 1, Weapon Proficiency: bottles, flasks, rocks, sticks and torches)?
 *
 * A weapon row says so (`weaponThrowsAsAnyone`): a throwables kind, or a
 * thrown row whose printed name is one of the improvised throwables. Beyond the
 * rows, two readings make it every grenade and not only the rows marked:
 * anything that bursts where it lands (`splash`, the row's or a custom tag the
 * item carries, or a `grenade` tag) is a flask or a bottle whatever it holds,
 * and a thrown weapon the table cannot place is read by its name, so a Judge's
 * "Flask of acid" counts where nothing else could say so. A table-placed
 * weapon is never read by name — a "Stick-handled mace" is the mace.
 */
function throwsAsAnyone(item, profile, tags) {
  const special = profile.special ?? [];
  if (weaponThrowsAsAnyone(profile.key) || special.includes("splash")) return true;
  if (tags.has("splash") || tags.has("grenade")) return true;
  if (profile.key) return false;
  return !!(profile.thrown || profile.missile) && IMPROVISED_THROWN.test(item?.name ?? "");
}

/**
 * Hand cost of a weapon given whether it is being wielded two-handed.
 *
 * RR p. 127: tiny/small = 1; medium = 1 or 2; large = 2; missile = 2 unless
 * Handy or Thrown; net/staff-sling forced 2H. A declared grip set answers ahead
 * of all of it.
 */
export function handCost(profile, { twoHanded = false } = {}) {
  if (profile.grips === "1h") return 1;
  if (profile.grips === "2h") return 2;
  if (profile.grips === "versatile") return twoHanded ? 2 : 1;
  if (profile.handsOverride != null) return profile.handsOverride;
  if (profile.twoHandedForced) return 2;
  if (profile.missile && !profile.melee) return profile.handy || profile.thrown ? 1 : 2;
  // A size nothing states leaves the hands unknown, and unknown is one hand.
  if (profile.size == null) return 1;
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
  if (profile.grips) return profile.grips === "2h";
  return profile.twoHandedForced || profile.size === SIZE.LARGE || (profile.missile && !profile.melee && !profile.handy && !profile.thrown);
}

/** True if a melee weapon may be wielded in one hand (for dual/shield styles). */
export function canOneHand(profile) {
  if (profile.grips) return profile.grips !== "2h";
  if (profile.handsOverride === 1) return true;
  if (profile.twoHandedForced) return false;
  if (profile.size == null) return true;
  return [SIZE.TINY, SIZE.SMALL, SIZE.MEDIUM].includes(profile.size);
}

/**
 * The grip set a weapon offers with nothing declared — what the control shows
 * as its "Auto" reading, and the starting point when a Judge overrides it.
 */
export function inferredGrips(profile) {
  if (isTwoHandedOnly({ ...profile, grips: null })) return "2h";
  return handCost({ ...profile, grips: null }, { twoHanded: true }) === 2 ? "versatile" : "1h";
}

/** The Weapon Focus group key covering this weapon, or null. */
export function focusGroup(profile) {
  if (!profile.key) return null;
  return weaponFocusGroup(profile.key);
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
