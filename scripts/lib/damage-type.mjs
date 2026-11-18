/* global game, CONFIG */
/**
 * Damage typing for weapons, and the attack options an actor actually has.
 *
 * A core weapon Item types its base damage itself (`system.damage.base.types`,
 * a set the sheet edits, and `system.damage.base.extraordinary`), and core's
 * attack roll reads those fields. An older or hand-made weapon leaves the set
 * empty, so a read falls through to `flags.acks-extras.damageType`, which the
 * readied torch and a pre-existing import write, and then to the equipment
 * feature's own classifier — every profiled weapon is typed with no annotation
 * step and no second copy of the data. A write goes to core's fields only.
 *
 * Resolution order, most explicit first:
 *   1. `flags.acks-extras.damageTypeOverride` — a hand-set override (ad-hoc weapons)
 *   2. `system.damage.base.types`             — the weapon's own first type
 *   3. `flags.acks-extras.damageType`         — the flag's value, where one was written
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
 * The system's key for a module damage-type key, or null when the system does
 * not accept it. Read from the weapon schema's own choices, so an unknown key
 * never refuses a whole item; with no schema to ask (offline), the module's
 * vocabulary answers. `varies` is the system's `variesByWeapon`.
 */
export function coreDamageKey(key) {
  if (typeof key !== "string" || !key) return null;
  const core = key === "varies" ? CORE_VARIES : key;
  let choices = null;
  try {
    choices = CONFIG?.Item?.dataModels?.weapon?.schema?.getField?.("damage.base.types")?.element?.choices ?? null;
    if (typeof choices === "function") choices = choices();
  } catch {
    choices = null;
  }
  if (!choices) return core === CORE_VARIES || Object.hasOwn(DAMAGE_TYPES, core) ? core : null;
  return (Array.isArray(choices) ? choices.includes(core) : core in choices) ? core : null;
}

/**
 * A weapon's `system.damage` in the system's shape: the printed die as the
 * base formula, the damage-type key as the base type where the system knows
 * the key, and the extraordinary mark where it is true. An unset mark writes
 * nothing, which the system reads as mundane.
 */
export function weaponBaseDamage(formula, typeKey = null, extraordinary = false) {
  const base = { formula: formula ?? "" };
  const key = coreDamageKey(typeKey);
  if (key) base.types = [key];
  if (extraordinary) base.extraordinary = true;
  return { base };
}

/** Does the weapon's own base damage carry the extraordinary mark? Only the system's field answers. */
export const extraordinaryOf = (item) => item?.system?.damage?.base?.extraordinary === true;

/**
 * The item update that types a weapon's base damage: a pick replaces the whole
 * set with the system's key for it, and a blank pick clears the set.
 */
export const damageTypeUpdate = (key) => ({ "system.damage.base.types": key ? [coreDamageKey(key)].filter(Boolean) : [] });

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

/** Localised label for a damage type key. */
export function damageTypeLabel(key) {
  if (!key) return "";
  const lang = `ACKS-LIB.damageType.${key}`;
  return game.i18n?.has?.(lang) ? game.i18n.localize(lang) : (DAMAGE_TYPES[key]?.label ?? key);
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
 * A melee option of a weapon the equipment feature can place also carries
 * `heldDamage` (the die of the grip the weapon is held in), `damageMode` (the
 * mode that die is rolled in) and `dmgTip` (where the die came from).
 *
 * @returns {Array<{key,label,type,itemId,damageType,icon,damage,at,heldDamage?,damageMode?,dmgTip?}>}
 */
export function attackOptionsFor(actor) {
  const items = actor?.items?.contents ?? [];
  const weapons = items.filter((i) => i.type === ITEM_TYPE.weapon && i.system?.equipped);
  const options = [];
  for (const w of weapons) {
    const damageType = damageTypeOf(w);
    const icon = DAMAGE_TYPE_ICONS[damageType] ?? UNTYPED_ICON;
    const base = { label: w.name, itemId: w.id, damageType, icon, damage: w.system?.damage?.base?.formula || "", at: 1 };
    // The die a melee swing deals is the one in the grip the weapon is held
    // in; `damage` stays the item's own base die, the field an edit writes.
    const held = equipmentApi()?.heldGrip?.(actor, w, "melee") ?? null;
    const melee = held ? { heldDamage: held.formula, damageMode: held.mode, dmgTip: equipmentApi().heldDieTip?.(held) ?? "" } : {};
    if (w.system?.melee) options.push({ ...base, ...melee, key: `${w.id}:melee`, type: "melee" });
    if (w.system?.missile || w.system?.special?.thrown) options.push({ ...base, key: `${w.id}:missile`, type: "missile" });
    // A weapon flagged neither (data gap) still rolls as its sheet type.
    if (!w.system?.melee && !w.system?.missile) options.push({ ...base, ...melee, key: `${w.id}:melee`, type: "melee" });
  }
  if (options.length) return options;

  const L = (k, d) => (game.i18n?.has?.(`ACKS-LIB.attack.${k}`) ? game.i18n.localize(`ACKS-LIB.attack.${k}`) : d);
  return [
    { key: "unarmed", label: L("unarmed", "Unarmed"), type: "melee", itemId: null, damageType: "bludgeoning", icon: DAMAGE_TYPE_ICONS.bludgeoning, damage: "", at: 1 },
    { key: "improvised", label: L("improvised", "Improvised"), type: "melee", itemId: null, damageType: null, icon: UNTYPED_ICON, damage: "", at: 1 },
    { key: "improvisedThrown", label: L("improvisedThrown", "Improvised (thrown)"), type: "missile", itemId: null, damageType: null, icon: UNTYPED_ICON, damage: "", at: 1 },
  ];
}
