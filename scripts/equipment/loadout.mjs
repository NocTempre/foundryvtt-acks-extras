/* global game */
/**
 * The Loadout model — a derived, per-actor snapshot of what is equipped and
 * whether it is RAW-legal. Normalised from EITHER core `system.equipped` flags
 * OR the paper-doll `slots` flag (Phase 4). Consumed by enforcement, the
 * loadout Active Effect, the roll wrapper, and the public API.
 */
import { MODULE_ID, ITEM_FLAGS, ACTOR_FLAGS, SETTINGS } from "./constants.mjs";
import { STYLE } from "./config.mjs";
import { classifyWeapon, handCost, inferStyle, canOneHand, isTwoHandedOnly } from "./profiles.mjs";
import { collectStringFlags, sumEffectModifiers } from "./effects.mjs";
import { EFFECT_DOMAINS } from "./constants.mjs";
import { weaponProficiency, isWeaponProficient, armorMax, isArmorProficient, thiefSkillsGated, swashbucklingAC, enforcementActive } from "./proficiency.mjs";
import { occupiesHand } from "./overlays/shield-variants.mjs";

/** Violation type keys (for i18n + auto-resolve). */
export const VIOLATION = Object.freeze({
  HAND_OVERFLOW: "handOverflow",
  MULTIPLE_ARMOR: "multipleArmor",
  TOO_MANY_SHIELDS: "tooManyShields",
  SHIELD_NO_STYLE: "shieldNoStyle", // class lacks Weapon & Shield style → no benefit (advisory)
  WEAPON_NOT_PROFICIENT: "weaponNotProficient", // weapon unusable by class (advisory; triggers nonProficientUse)
  ARMOR_NOT_PROFICIENT: "armorNotProficient", // worn armour above class proficiency (advisory; triggers nonProficientUse)
  STYLE_NOT_PROFICIENT: "styleNotProficient", // using an untrained fighting style (advisory; triggers nonProficientUse)
  NON_PROFICIENT_USE: "nonProficientUse", // the full RR p. 106 package: attacks as 0th-level fighter, no attribute bonus to attack/AC, no class powers, no XP
  THIEF_SKILL_GATED: "thiefSkillGated", // Backstab/Hide/Pickpocket/Sneak blocked by armour/shield (advisory)
});

/** The player's chosen grip for a weapon: "auto" (default), "1h", or "2h". */
export function weaponGrip(item) {
  const g = item?.getFlag?.(MODULE_ID, ITEM_FLAGS.GRIP);
  return g === "1h" || g === "2h" ? g : "auto";
}

/** Cycle a weapon's grip: auto → 1h → 2h → auto. Returns the new grip. */
export async function cycleGrip(item) {
  const next = { auto: "1h", "1h": "2h", "2h": "auto" }[weaponGrip(item)];
  if (next === "auto") await item.unsetFlag?.(MODULE_ID, ITEM_FLAGS.GRIP);
  else await item.setFlag?.(MODULE_ID, ITEM_FLAGS.GRIP, next);
  return next;
}

/** Hands occupied by lit light sources this actor bears (acks-formation, optional). */
export function heldLightHands(actor) {
  const n = globalThis.acksFormation?.heldLightCount?.(actor?.id);
  return Number.isFinite(n) ? n : 0;
}

/** Base hand budget for an actor (2 + Four-Arms/anatomy effects + setting). */
export function handBudget(actor) {
  const base = Number(game.settings.get(MODULE_ID, SETTINGS.DEFAULT_HAND_BUDGET)) || 2;
  return base + sumEffectModifiers(actor, EFFECT_DOMAINS.HAND_BUDGET);
}

/** Fighting styles the actor is TRAINED in (RAW: single + missile mandatory). */
export function trainedStyles(actor) {
  // All style keys are stored lowercased for case-insensitive comparison
  // against `activeStyle.toLowerCase()`.
  const set = new Set(["single", "missile"]);
  const flag = actor.getFlag?.(MODULE_ID, ACTOR_FLAGS.STYLES);
  if (typeof flag === "string") flag.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).forEach((s) => set.add(s));
  else if (Array.isArray(flag)) flag.forEach((s) => set.add(String(s).toLowerCase()));
  for (const s of collectStringFlags(actor, EFFECT_DOMAINS.STYLE_PROFICIENT)) {
    const [style, kind] = s.split(":");
    if (!kind) set.add(style); // base training marker (already lowercased)
  }
  return set;
}

/** Fighting styles the actor is SPECIALIZED in (Fighting Style Specialization). */
export function specializedStyles(actor) {
  const set = new Set();
  for (const s of collectStringFlags(actor, EFFECT_DOMAINS.STYLE_PROFICIENT)) {
    const [style, kind] = s.split(":");
    if (kind === "spec") set.add(style);
  }
  return set;
}

/** Is an armour item a helmet? (flag, else name heuristic matching core). */
function isHelmet(item) {
  if (item.getFlag?.(MODULE_ID, ITEM_FLAGS.HELMET)) return true;
  return /helm/i.test(item.name ?? "");
}

/** Is an armour item a shield? */
function isShield(item) {
  return item.system?.type === "shield";
}

/**
 * Compute the full loadout for an actor from its equipped items.
 * @param {Actor} actor
 * @returns {Loadout}
 */
export function getLoadout(actor, opts = {}) {
  const budget = handBudget(actor);
  // `opts.overrides` (Map itemId→bool) lets enforcement simulate a pending
  // equip/unequip before it is committed.
  const isEq = (i) => (opts.overrides?.has(i.id) ? opts.overrides.get(i.id) : !!i.system?.equipped);
  const equippedWeapons = actor.items.filter((i) => i.type === "weapon" && isEq(i));
  const equippedArmor = actor.items.filter((i) => i.type === "armor" && isEq(i));

  const shields = equippedArmor.filter(isShield);
  const helmets = equippedArmor.filter((a) => !isShield(a) && isHelmet(a));
  const suits = equippedArmor.filter((a) => !isShield(a) && !isHelmet(a));

  // Classify weapons and assign hand costs (minimum, i.e. medium counts as 1).
  const wprof = weaponProficiency(actor);
  const weapons = equippedWeapons.map((item) => {
    const profile = classifyWeapon(item);
    const wornHand = item.getFlag?.(MODULE_ID, ITEM_FLAGS.WORN_HAND) ?? null;
    return {
      item,
      profile,
      wornHand,
      handsMin: handCost(profile, { twoHanded: false }),
      wieldTwoHanded: false,
      // Versatile: usable one-handed AND costing two hands in a two-handed grip
      // (a medium melee weapon). Only these offer a grip CHOICE.
      canTwoHand: profile.melee && canOneHand(profile) && handCost(profile, { twoHanded: true }) === 2,
      grip: weaponGrip(item), // "auto" | "1h" | "2h"
      gripBlocked: false, // wants 2H but the hands are not free
      thrownAway: !!item.getFlag?.(MODULE_ID, ITEM_FLAGS.THROWN_STATE),
      melee: profile.melee,
      missile: profile.missile,
      proficient: isWeaponProficient(actor, profile, wprof),
    };
  });

  // Only a shield carried IN HAND costs a hand; a strapped one (JJ variant
  // overlay) rides the back or front and leaves both hands free.
  const handShields = shields.filter(occupiesHand);
  // A lit light source held by this actor occupies a hand too (acks-formation,
  // optional — degrade-gracefully to 0 when it is absent). This is the read
  // half of the two-way hook: formation owns the light state; we count it as a
  // used hand so hands-available matches who is holding a light.
  const heldLights = heldLightHands(actor);
  let handsUsed = weapons.reduce((n, w) => n + w.handsMin, 0) + handShields.length + heldLights;

  // GRIP resolution. A two-handed grip needs BOTH hands, so only a lone melee
  // weapon with no in-hand shield can take it (RAW 1d8/1d10). The player's grip
  // choice governs: "1h" forces one hand; "2h" is honoured only when the hands
  // are actually free (else it is BLOCKED and surfaced); "auto" takes the two-
  // handed grip when hands are free (best damage), one-handed otherwise.
  const loneMelee = weapons.length === 1 && !handShields.length && weapons[0].melee;
  if (loneMelee) {
    const w = weapons[0];
    if (isTwoHandedOnly(w.profile)) {
      // No grip CHOICE — a great sword / staff-sling is inherently two-handed;
      // its handsMin is already 2. Any hand overflow (e.g. also holding a torch)
      // surfaces as a violation below, but the grip itself is fixed.
      w.wieldTwoHanded = true;
    } else if (w.canTwoHand) {
      // Versatile: the two-handed grip costs ONE hand beyond the one-handed
      // hold, so it needs a spare hand NOW — after weapons, shields, AND any
      // held light are counted. This is what makes a held torch block 2H.
      const twoHandDelta = 2 - w.handsMin; // 1 for a medium weapon
      const spare = budget - handsUsed;
      if (w.grip === "1h") {
        w.wieldTwoHanded = false;
      } else if (w.grip === "2h" || w.grip === "auto") {
        if (spare >= twoHandDelta) { w.wieldTwoHanded = true; handsUsed += twoHandDelta; }
      }
    }
  }

  // The "check against free hands": any versatile weapon whose player asked for
  // a two-handed grip but did NOT get it — a shield or second weapon occupies
  // the off hand, or it is not the lone weapon — is BLOCKED, surfaced so the UI
  // can show why (rather than silently ignoring the request).
  for (const w of weapons) {
    if (w.canTwoHand && w.grip === "2h" && !w.wieldTwoHanded) w.gripBlocked = true;
  }

  const hasShield = handShields.length > 0; // only a shield in hand forms Weapon & Shield
  const overrideStyle = actor.getFlag?.(MODULE_ID, ACTOR_FLAGS.ACTIVE_STYLE) ?? null;
  const activeStyle = overrideStyle ?? inferStyle(weapons, hasShield);

  const trained = trainedStyles(actor);
  const spec = specializedStyles(actor);
  // Style training reads the same module-owned flags as weapon/armour
  // proficiency, so it falls under the same kill switch: with acks-abilities
  // installed those flags are absent on a correctly built character and every
  // style would read as untrained, triggering Non-Proficient Use.
  const styleProficient = !enforcementActive() || trained.has(activeStyle?.toLowerCase());

  // --- Violations -------------------------------------------------------
  const violations = [];
  if (handsUsed > budget) {
    // Auto-resolve candidates: shields first, then off-hand/extra weapons.
    const candidates = [
      ...shields.map((s) => ({ item: s, kind: "shield" })),
      ...weapons.slice().reverse().map((w) => ({ item: w.item, kind: "weapon" })),
    ];
    violations.push({
      type: VIOLATION.HAND_OVERFLOW,
      items: candidates.map((c) => c.item),
      detail: { handsUsed, budget },
    });
  }
  if (suits.length > 1) {
    violations.push({ type: VIOLATION.MULTIPLE_ARMOR, items: suits.slice(0, -1) }); // keep the last-equipped
  }
  // RAW (RR p141): a character benefits from only ONE shield at a time. This
  // holds however a shield is carried — an in-hand shield PLUS a back-strapped
  // one is still two shields — so count every equipped shield, strapped or not,
  // and flag all but the last-equipped (which keeps the benefit).
  if (shields.length > 1) {
    violations.push({ type: VIOLATION.TOO_MANY_SHIELDS, items: shields.slice(0, -1) });
  }
  if (hasShield && !canUseShieldStyle(actor, trained)) {
    violations.push({ type: VIOLATION.SHIELD_NO_STYLE, items: shields, advisory: true });
  }

  // --- Proficiency advisories (never blocking; roll penalties land in Phase 3) ---
  const armor = suits[suits.length - 1] ?? null;
  const amax = armorMax(actor);
  const armorProficient = armor ? isArmorProficient(actor, armor, amax) : true;
  const nonProfWeapons = weapons.filter((w) => !w.proficient);
  if (nonProfWeapons.length) {
    violations.push({ type: VIOLATION.WEAPON_NOT_PROFICIENT, items: nonProfWeapons.map((w) => w.item), advisory: true });
  }
  if (armor && !armorProficient) {
    violations.push({ type: VIOLATION.ARMOR_NOT_PROFICIENT, items: [armor], advisory: true, detail: { max: amax } });
  }
  if (weapons.length && !styleProficient) {
    violations.push({ type: VIOLATION.STYLE_NOT_PROFICIENT, items: weapons.map((w) => w.item), advisory: true, detail: { style: activeStyle } });
  }
  // RAW "Non-Proficient Use of Weapons and Armor" (RR p. 106 sidebar): the
  // condition is the equipped STATE — any unusable weapon, unusable worn
  // armour, or an untrained fighting style (weapon and style proficiency are
  // distinct; BOTH are required) — and while it holds, a 1st+ level character
  // attacks as a 0th-level fighter (a 0th-level one takes an additional −1),
  // gains no attribute bonus to attack or AC, cannot use class powers, and
  // earns no XP from the adventure. Attack/AC land in roll-wrap + the loadout
  // effect; class powers and XP are Judge-side, surfaced via the violation.
  const nonProficientUse =
    !!(nonProfWeapons.length > 0 || (armor && !armorProficient) || (weapons.length > 0 && !styleProficient));
  if (nonProficientUse) {
    // Offending items; when the only failure is an untrained STYLE the weapons
    // being used in that style are the offenders.
    const offenders = [...nonProfWeapons.map((w) => w.item), ...(armor && !armorProficient ? [armor] : [])];
    violations.push({
      type: VIOLATION.NON_PROFICIENT_USE,
      items: offenders.length ? offenders : weapons.map((w) => w.item),
      advisory: true,
      detail: { style: activeStyle },
    });
  }

  const thiefGated = thiefSkillsGated({ armor, shield: shields[0] ?? null });
  if (thiefGated) {
    violations.push({ type: VIOLATION.THIEF_SKILL_GATED, items: [armor, shields[0]].filter(Boolean), advisory: true });
  }

  return {
    actorId: actor.id,
    handBudget: budget,
    handsUsed,
    handsFree: Math.max(0, budget - handsUsed),
    heldLights, // hands occupied by lit light sources (acks-formation)
    weapons,
    armor,
    armorProficient,
    armorMax: amax,
    extraArmor: suits.slice(0, -1),
    shields,
    handShields,
    shield: handShields[0] ?? shields[0] ?? null,
    helmet: helmets[0] ?? null,
    hasHelmet: helmets.length > 0,
    activeStyle,
    trainedStyles: trained,
    specStyles: spec,
    styleProficient,
    nonProficientUse,
    thiefSkillsGated: thiefGated,
    condAC: swashbucklingAC(actor, { armor }),
    violations,
    legal: violations.every((v) => v.advisory),
  };
}

/** Does the actor have the Weapon & Shield style (so shields grant AC)? */
function canUseShieldStyle(actor, trained = trainedStyles(actor)) {
  return trained.has(STYLE.WEAPON_SHIELD.toLowerCase());
}

/**
 * @typedef {object} Loadout
 * @property {number} handBudget
 * @property {number} handsUsed
 * @property {number} handsFree
 * @property {object[]} weapons
 * @property {object|null} armor
 * @property {object[]} shields
 * @property {object|null} shield
 * @property {object|null} helmet
 * @property {string} activeStyle
 * @property {Set<string>} trainedStyles
 * @property {Set<string>} specStyles
 * @property {boolean} styleProficient
 * @property {{type,items,advisory?,detail?}[]} violations
 * @property {boolean} legal
 */
