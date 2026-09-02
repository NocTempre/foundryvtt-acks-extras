/* global game */
/**
 * The Loadout model — a derived, per-actor snapshot of what is equipped and
 * whether it is RAW-legal. Normalised from EITHER core `system.equipped` flags
 * OR the paper-doll `slots` flag (Phase 4). Consumed by enforcement, the
 * loadout Active Effect, the roll wrapper, and the public API.
 */
import { MODULE_ID, ITEM_FLAGS, ACTOR_FLAGS, SETTINGS } from "./constants.mjs";
import { STYLE } from "./config.mjs";
import { classifyWeapon, handCost, inferStyle, canOneHand, isTwoHandedOnly, isHelmet, isShield } from "./profiles.mjs";
import { collectStringFlags, sumEffectModifiers, hasEffectFlag } from "./effects.mjs";
import { EFFECT_DOMAINS } from "./constants.mjs";
import { weaponProficiency, isWeaponProficient, armorMax, isArmorProficient, thiefSkillsGated, swashbucklingAC, lightInit, enforcementActive } from "./proficiency.mjs";
import { occupiesHand } from "./overlays/shield-variants.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";

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

/**
 * Hands the party sheet says are already full (acks-formation, optional): the
 * light sources this actor bears, and the mapper's kit if they are the one
 * drawing the map. Degrades to zero of each when nothing is tracking the actor.
 * @returns {{lights: number, mapping: number, total: number}}
 */
export function formationHands(actor) {
  const busy = globalThis.acksExtras?.formation?.handsOccupied?.(actor?.id);
  const lights = Number.isFinite(busy?.lights) ? busy.lights : 0;
  const mapping = Number.isFinite(busy?.mapping) ? busy.mapping : 0;
  return { lights, mapping, total: lights + mapping };
}

/** Hands occupied by lit light sources this actor bears (acks-formation, optional). */
export function heldLightHands(actor) {
  return formationHands(actor).lights;
}

/**
 * Name the hands that hold nothing this sheet lists — a torch the party sheet
 * is tracking, the mapper's quill and parchment — as a short display clause,
 * or "" when every occupied hand is accounted for by gear.
 *
 * A hand count the visible gear cannot explain reads as a miscount, and the
 * player's only remedy is to unequip things that were never the problem. Every
 * surface quoting a hand total states this alongside it.
 *
 * @param {{heldLights?: number, mappingHands?: number}} source a Loadout, or a
 *   hand-overflow violation's `detail` — both carry the two counts.
 */
export function heldHandsClause(source) {
  const say = (key, n) => {
    const full = `ACKS-EQUIPMENT.wear.${key}`;
    return game.i18n?.has?.(full) ? game.i18n.format(full, { n }) : `${n} ${key}`;
  };
  const parts = [];
  if (source?.heldLights > 0) parts.push(say("handsLights", source.heldLights));
  if (source?.mappingHands > 0) parts.push(say("handsMapping", source.mappingHands));
  return parts.join(", ");
}

/**
 * The order in which held gear gives up a hand: shields first, then weapons
 * newest-first. Shields lead because a shield's only cost IS the hand — putting
 * one on the back loses an AC point, while sheathing a weapon disarms.
 *
 * Deliberately NOT the hand-overflow violation's candidate list, which names
 * every equipped shield including a strapped one. That list answers "what is
 * implicated in this overflow"; this one answers "what can actually free a
 * hand", and a strapped shield occupies none.
 */
export function releaseOrder(loadout) {
  return [...loadout.handShields, ...loadout.weapons.slice().reverse().map((w) => w.item)];
}

/** Base hand budget for an actor (2 + Four-Arms/anatomy effects + setting). */
export function handBudget(actor) {
  const base = Number(game.settings.get(MODULE_ID, SETTINGS.DEFAULT_HAND_BUDGET)) || 2;
  return base + sumEffectModifiers(actor, EFFECT_DOMAINS.HAND_BUDGET);
}

/**
 * Fold a style token to its comparison key: lowercase, letters only. Canonical
 * keys are already letters-only, so this is a no-op for them and only bites
 * hand-written values — a `styles` flag typed "Weapon & Shield" has to land on
 * the same key `STYLE.WEAPON_SHIELD` folds to, or the Training pill lights while
 * the enforcement gate stays shut. Every style comparison here folds both sides;
 * the Training strip folds identically, and the two must not drift apart.
 */
const styleKey = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");

/** Fighting styles the actor is TRAINED in (RAW: single + missile mandatory). */
export function trainedStyles(actor) {
  const set = new Set(["single", "missile"]);
  const flag = actor.getFlag?.(MODULE_ID, ACTOR_FLAGS.STYLES);
  if (typeof flag === "string") flag.split(",").map(styleKey).filter(Boolean).forEach((s) => set.add(s));
  else if (Array.isArray(flag)) flag.forEach((s) => set.add(styleKey(s)));
  for (const s of collectStringFlags(actor, EFFECT_DOMAINS.STYLE_PROFICIENT)) {
    const [style, kind] = s.split(":");
    if (!kind) set.add(styleKey(style)); // base training marker
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

/**
 * The attack throw bonus the sheet's Melee and Ranged buttons state: the
 * character's attribute modifier, and nothing else.
 *
 * Those buttons are a quick roll for play that has not modelled its equipment
 * in Foundry — base attack throw plus the stat, the two numbers a table needs
 * off the cuff. Deliberately NOT `system.thac0.mod` (where the current loadout
 * and any magic item deposit their results), NOT a weapon's own bonus, and NOT
 * a style bonus: every one of those is a situational term the weapon's own roll
 * applies exactly, and folding them into a summary makes the summary disagree
 * with the dice.
 *
 * Melee and Ranged stay separate, as they are on the sheet. Missile keys on
 * Dexterity. Melee keys on Strength unless Weapon Finesse lets the character
 * take Dexterity instead and Dexterity is the better of the two — an election,
 * so the better one REPLACES the other and never adds to it.
 *
 * @param {"melee"|"missile"} type which throw to measure
 * @returns {{abilityKey: string, abilityMod: number, total: number}}
 */
export function bestAttackBonus(actor, type) {
  const missile = type === "missile";
  const scores = actor?.system?.scores ?? {};
  const str = Number(scores.str?.mod ?? 0);
  const dex = Number(scores.dex?.mod ?? 0);
  const finesse = !missile && dex > str && hasEffectFlag(actor, EFFECT_DOMAINS.FINESSE);
  const abilityKey = missile || finesse ? "dex" : "str";
  const abilityMod = missile || finesse ? dex : str;
  return { abilityKey, abilityMod, total: abilityMod };
}

/**
 * Compute the full loadout for an actor from its equipped items.
 * @param {Actor} actor
 * @param {object} [opts]
 * @param {Map<string, boolean>} [opts.overrides] itemId → equipped, letting a
 *   caller resolve the loadout a pending equip/unequip *would* produce before
 *   committing it. Enforcement uses this to judge a toggle before it lands.
 * @returns {Loadout}
 */
export function getLoadout(actor, opts = {}) {
  const budget = handBudget(actor);
  const isEq = (i) => (opts.overrides?.has(i.id) ? opts.overrides.get(i.id) : !!i.system?.equipped);
  const equippedWeapons = actor.items.filter((i) => i.type === ITEM_TYPE.weapon && isEq(i));
  const equippedArmor = actor.items.filter((i) => i.type === ITEM_TYPE.armor && isEq(i));

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
  // The party sheet fills hands too (degrades to 0 when nothing is tracking this
  // actor): a lit light source is held, and a mapper works with a quill in one
  // hand and parchment in the other. This is the read half of the two-way hook —
  // formation owns both states; we count them as used hands so hands-available
  // matches what the character is actually holding.
  const { lights: heldLights, mapping: mappingHands, total: formationBusy } = formationHands(actor);
  let handsUsed = weapons.reduce((n, w) => n + w.handsMin, 0) + handShields.length + formationBusy;
  // What is COMMITTED — every hand that something would have to be put down to
  // free. Captured before the two-handed grip below, which is elective: a
  // versatile weapon takes the spare hand for the better damage die and gives it
  // straight back the moment a torch or a map wants it. Anything asking "is
  // there room for one more thing?" must read this, not handsFree, or a
  // swordsman with a free hand reads as having none.
  const handsCommitted = handsUsed;

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
  const styleProficient = !enforcementActive() || trained.has(styleKey(activeStyle));

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
      // The party-sheet hands travel with the violation. They are the only
      // occupied hands holding nothing this sheet lists, so a message built
      // from `items` alone can never account for the count it quotes.
      detail: { handsUsed, budget, heldLights, mappingHands },
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
    handsCommitted,
    handsSpare: Math.max(0, budget - handsCommitted),
    heldLights, // hands occupied by lit light sources (acks-formation)
    mappingHands, // hands occupied by the mapper's kit (acks-formation)
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
    condInit: lightInit(actor, { armor }),
    violations,
    legal: violations.every((v) => v.advisory),
  };
}

/** Does the actor have the Weapon & Shield style (so shields grant AC)? */
function canUseShieldStyle(actor, trained = trainedStyles(actor)) {
  return trained.has(styleKey(STYLE.WEAPON_SHIELD));
}

/**
 * @typedef {object} Loadout
 * @property {number} handBudget
 * @property {number} handsUsed
 * @property {number} handsFree hands not in use right now
 * @property {number} handsCommitted hands something would have to be put down to free
 * @property {number} handsSpare room for one more thing (elective grips yield)
 * @property {object[]} weapons
 * @property {object|null} armor
 * @property {object[]} shields
 * @property {object|null} shield
 * @property {object|null} helmet
 * @property {string} activeStyle
 * @property {Set<string>} trainedStyles
 * @property {Set<string>} specStyles
 * @property {boolean} styleProficient
 * @property {number} condAC AC that applies only while lightly equipped
 * @property {number} condInit initiative that applies only while lightly equipped
 * @property {{type,items,advisory?,detail?}[]} violations
 * @property {boolean} legal
 */
