/* global game */
/**
 * Damage typing for weapons, and the attack options an actor actually has.
 *
 * A core weapon Item types its base damage itself (`system.damage.base.types`,
 * a set the sheet edits), but an older or hand-made weapon leaves the set
 * empty, and the equipment feature only stamps `flags.acks-extras.damageType`
 * when its annotate macro has run, so this falls through to that feature's own
 * classifier — every profiled weapon is typed with no annotation step and no
 * second copy of the data.
 *
 * Resolution order, most explicit first:
 *   1. `flags.acks-extras.damageTypeOverride` — a hand-set override (ad-hoc weapons)
 *   2. `system.damage.base.types`             — the weapon's own first type
 *   3. `flags.acks-extras.damageType`         — the stamped classifier value
 *   4. equipment's live `classifyWeapon(item).type`
 *   5. null — genuinely unknown; the UI shows a neutral icon rather than guessing
 *
 * The override key stays spelled `damageTypeOverride`, distinct from
 * `damageType`, so it can never collapse into the value it overrides. See
 * docs/lib/DECISIONS.md, "The damage-type override keeps a name distinct
 * from the stamped value".
 */
import { MODULE_ID } from "./constants.mjs";
import { DAMAGE_TYPES, ITEM_TYPE } from "./vocab.mjs";

/**
 * Font Awesome 6 FREE icons per damage type, for surfaces that render inside
 * core's own markup (Foundry bundles the free set). An `.acks-ui` surface draws
 * the real Acks Symbols glyph instead — see `DAMAGE_GLYPHS` below.
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

/**
 * The vocabulary's damage keys as the design system's glyph font names them
 * (`vendor/acks-design/glyphs.css`, `data-acks-dmg`). The font's letters are
 * case-sensitive selectors, so the mapping is explicit — never a lowercased
 * key passed through, which renders a different valid icon rather than
 * failing.
 */
export const DAMAGE_GLYPHS = Object.freeze({
  acidic: "acid",
  arcane: "magic",
  bludgeoning: "bludgeoning",
  cold: "cold",
  electrical: "electricity",
  fire: "fire",
  luminous: "life",
  necrotic: "necrotic",
  piercing: "piercing",
  poisonous: "poison",
  seismic: "sonic",
  slashing: "slashing",
  varies: "weapon",
});

/** The glyph name for an item's damage type, or null when untyped. */
export const damageGlyphOf = (item) => DAMAGE_GLYPHS[damageTypeOf(item)] ?? null;

/** The equipment feature's API, once it has attached itself. */
const equipmentApi = () => globalThis.acksExtras?.equipment ?? game.modules?.get(MODULE_ID)?.api?.equipment ?? null;

/** The system's key for a weapon whose damage type is the weapon's own; the vocabulary spells it `varies`. */
const CORE_VARIES = "variesByWeapon";

/**
 * The type a weapon's own base damage states, or null. A weapon typed with
 * several keeps its first named one; a weapon typed only as varying is
 * `varies`.
 */
export function ownDamageType(item) {
  const types = item?.system?.damage?.base?.types;
  const list = types ? Array.from(types) : [];
  const first = list.find((t) => t !== CORE_VARIES) ?? list[0] ?? null;
  const key = first === CORE_VARIES ? "varies" : first;
  return key && DAMAGE_TYPES[key] ? key : null;
}

/**
 * The damage type of a weapon item, or null when unknown.
 * @param {Item} item
 * @returns {string|null} a DAMAGE_TYPES key
 */
export function damageTypeOf(item) {
  if (!item) return null;
  const own = item.getFlag?.(MODULE_ID, "damageTypeOverride");
  if (own && DAMAGE_TYPES[own]) return own;
  const stated = ownDamageType(item);
  if (stated) return stated;
  const stamped = item.getFlag?.(MODULE_ID, "damageType");
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
    await item.unsetFlag(MODULE_ID, "damageTypeOverride");
    return true;
  }
  if (!DAMAGE_TYPES[type]) return false;
  await item.setFlag(MODULE_ID, "damageTypeOverride", type);
  return true;
}

/**
 * The attack options an actor actually has right now.
 *
 * Built from EQUIPPED weapons: a melee weapon yields a melee option, a missile
 * weapon a ranged one, and a weapon that can be thrown yields BOTH (it is a
 * real choice at the table). With nothing equipped, the only options are
 * unarmed and improvised — including an improvised throw — which is exactly
 * what a body with empty hands can do.
 *
 * @returns {Array<{key,label,type,itemId,damageType,icon,damage,at}>}
 */
export function attackOptionsFor(actor) {
  const items = actor?.items?.contents ?? [];
  const weapons = items.filter((i) => i.type === ITEM_TYPE.weapon && i.system?.equipped);
  const options = [];
  for (const w of weapons) {
    const damageType = damageTypeOf(w);
    const icon = DAMAGE_TYPE_ICONS[damageType] ?? UNTYPED_ICON;
    const base = { label: w.name, itemId: w.id, damageType, icon, damage: w.system?.damage?.base?.formula || "", at: 1 };
    if (w.system?.melee) options.push({ ...base, key: `${w.id}:melee`, type: "melee" });
    if (w.system?.missile || w.system?.special?.thrown) options.push({ ...base, key: `${w.id}:missile`, type: "missile" });
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
