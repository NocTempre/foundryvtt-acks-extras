/* global game */
/**
 * Damage typing for weapons, and the attack options an actor actually has.
 *
 * THE GAP THIS CLOSES: core weapon Items carry no damage type at all, and
 * acks-equipment only STAMPS `flags.acks-equipment.damageType` when someone runs
 * its annotate macro — so ordinary gear on a henchman is untyped and nothing can
 * show a damage-type affordance. Rather than duplicate the weapon table (it is
 * acks-equipment's, read off the books) this resolves the type LIVE through that
 * module's own classifier, so every profiled weapon is typed with no annotation
 * step and no second copy of the data.
 *
 * Resolution order, most explicit first:
 *   1. `flags.acks-lib.damageType`        — a hand-set override (ad-hoc weapons)
 *   2. `flags.acks-equipment.damageType`  — the stamped classifier value
 *   3. acks-equipment's live `classifyWeapon(item).type`
 *   4. null — genuinely unknown; the UI shows a neutral icon rather than guessing
 *
 * Nothing here invents a type for a weapon the books do not type: with
 * acks-equipment absent, an unstamped item resolves null.
 */
import { MODULE_ID } from "./constants.mjs";
import { DAMAGE_TYPES } from "./vocab.mjs";

/**
 * Font Awesome 6 FREE icons per damage type (Foundry bundles the free set; the
 * Pro weapon glyphs are not available, and acks-design's own symbol font is
 * deliberately not vendored — it is not OFL).
 */
export const DAMAGE_TYPE_ICONS = Object.freeze({
  bludgeoning: "fas fa-hammer",
  slashing: "fas fa-khanda",
  piercing: "fas fa-location-arrow",
  acidic: "fas fa-droplet",
  arcane: "fas fa-wand-sparkles",
  cold: "fas fa-snowflake",
  electrical: "fas fa-bolt",
  fire: "fas fa-fire",
  luminous: "fas fa-sun",
  necrotic: "fas fa-skull",
  poisonous: "fas fa-skull-crossbones",
  seismic: "fas fa-mountain",
  varies: "fas fa-dice-d20",
});

/** Neutral icon when the type is genuinely unknown — never a guessed type. */
export const UNTYPED_ICON = "fas fa-circle-dot";

/** acks-equipment's API, when the module is active. */
const equipmentApi = () => globalThis.acksEquipment ?? game.modules?.get("acks-equipment")?.api ?? null;

/**
 * The damage type of a weapon item, or null when unknown.
 * @param {Item} item
 * @returns {string|null} a DAMAGE_TYPES key
 */
export function damageTypeOf(item) {
  if (!item) return null;
  const own = item.getFlag?.(MODULE_ID, "damageType");
  if (own && DAMAGE_TYPES[own]) return own;
  const stamped = item.getFlag?.("acks-equipment", "damageType");
  if (stamped && DAMAGE_TYPES[stamped]) return stamped;
  try {
    const t = equipmentApi()?.classifyWeapon?.(item)?.type;
    if (t && DAMAGE_TYPES[t]) return t;
  } catch {
    /* classifier unavailable or unrecognised item — fall through to unknown */
  }
  return null;
}

/** The icon for an item's damage type (neutral when untyped). */
export const damageIconOf = (item) => DAMAGE_TYPE_ICONS[damageTypeOf(item)] ?? UNTYPED_ICON;

/** Localised label for a damage type key. */
export function damageTypeLabel(key) {
  if (!key) return "";
  const lang = `ACKS-LIB.damageType.${key}`;
  return game.i18n?.has?.(lang) ? game.i18n.localize(lang) : (DAMAGE_TYPES[key]?.label ?? key);
}

/**
 * Set (or clear) an item's damage type as an acks-lib override — for ad-hoc and
 * improvised weapons the profile table does not know.
 */
export async function setDamageType(item, type) {
  if (!item) return false;
  if (!type) {
    await item.unsetFlag(MODULE_ID, "damageType");
    return true;
  }
  if (!DAMAGE_TYPES[type]) return false;
  await item.setFlag(MODULE_ID, "damageType", type);
  return true;
}

/**
 * The attack options an actor actually has right now.
 *
 * Built from EQUIPPED weapons: a melee weapon yields a melee option, a missile
 * weapon a ranged one, and a thrown melee weapon yields BOTH (it is a real
 * choice at the table). With nothing equipped, the only options are unarmed and
 * improvised — including an improvised throw — which is exactly what a body with
 * empty hands can do.
 *
 * @returns {Array<{key,label,type,itemId,damageType,icon,damage,at}>}
 */
export function attackOptionsFor(actor) {
  const items = actor?.items?.contents ?? [];
  const weapons = items.filter((i) => i.type === "weapon" && i.system?.equipped);
  const options = [];
  for (const w of weapons) {
    const damageType = damageTypeOf(w);
    const icon = DAMAGE_TYPE_ICONS[damageType] ?? UNTYPED_ICON;
    const base = { label: w.name, itemId: w.id, damageType, icon, damage: w.system?.damage || "", at: 1 };
    if (w.system?.melee) options.push({ ...base, key: `${w.id}:melee`, type: "melee" });
    if (w.system?.missile) options.push({ ...base, key: `${w.id}:missile`, type: "missile" });
    // A weapon flagged neither (data gap) still rolls as its sheet type.
    if (!w.system?.melee && !w.system?.missile) options.push({ ...base, key: `${w.id}:melee`, type: "melee" });
  }
  if (options.length) return options;

  const L = (k, d) => (game.i18n?.has?.(`ACKS-LIB.attack.${k}`) ? game.i18n.localize(`ACKS-LIB.attack.${k}`) : d);
  return [
    { key: "unarmed", label: L("unarmed", "Unarmed"), type: "melee", itemId: null, damageType: "bludgeoning", icon: DAMAGE_TYPE_ICONS.bludgeoning, damage: "", at: 1 },
    { key: "improvised", label: L("improvised", "Improvised"), type: "melee", itemId: null, damageType: null, icon: UNTYPED_ICON, damage: "", at: 1 },
    { key: "improvisedThrown", label: L("improvisedThrown", "Improvised (thrown)"), type: "missile", itemId: null, damageType: null, icon: UNTYPED_ICON, damage: "", at: 1 },
  ];
}
