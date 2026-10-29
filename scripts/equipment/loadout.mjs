/* global game */
/**
 * The Loadout model — a derived, per-actor snapshot of what is equipped and
 * whether it is RAW-legal. Normalised from EITHER core `system.equipped` flags
 * OR the paper-doll `slots` flag (Phase 4). Consumed by enforcement, the
 * loadout Active Effect, the roll wrapper, and the public API.
 */
import { MODULE_ID, ITEM_FLAGS, ACTOR_FLAGS, SETTINGS } from "./constants.mjs";
import { STYLE } from "./config.mjs";
import { classifyWeapon, handCost, inferStyle, isHelmet, isShield } from "./profiles.mjs";
import { collectStringFlags, sumEffectModifiers, hasEffectFlag } from "./effects.mjs";
import { EFFECT_DOMAINS } from "./constants.mjs";
import { weaponProficiency, isWeaponProficient, armorMax, isArmorProficient, thiefSkillsGated, swashbucklingAC, lightInit, enforcementActive } from "./proficiency.mjs";
import { occupiesHand } from "./overlays/shield-variants.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";
import { bearerLights, lightTypeOf } from "../lib/light.mjs";
import { containedIn } from "../lib/item-model.mjs";

/** Violation type keys (for i18n + auto-resolve). */
export const VIOLATION = Object.freeze({
  HAND_OVERFLOW: "handOverflow",
  MULTIPLE_ARMOR: "multipleArmor",
  TOO_MANY_SHIELDS: "tooManyShields",
  SHIELD_NO_STYLE: "shieldNoStyle", // class lacks Weapon & Shield style → no benefit (advisory)
  WEAPON_NOT_PROFICIENT: "weaponNotProficient", // weapon unusable by class (advisory; triggers nonProficientUse)
  ARMOR_NOT_PROFICIENT: "armorNotProficient", // worn armour above class proficiency (advisory; triggers nonProficientUse)
  STYLE_NOT_PROFICIENT: "styleNotProficient", // using an untrained fighting style (advisory; triggers nonProficientUse)
  NON_PROFICIENT_USE: "nonProficientUse", // the full non-proficient use package (RR p. 15): attacks as a 0th-level fighter, no attribute bonus to attack/AC, no class powers, no XP
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
 * Hands held full by something other than a drawn weapon or a shield in hand:
 * the light sources this actor bears that are burning (lib's `bearerLights`,
 * which reads the party sheet's record for a member and the actor's own flag
 * for anyone else), and the mapper's kit when the party sheet has them
 * drawing the map (acks-formation, optional; zero when nothing tracks the
 * actor). `kit` is the kit the sheet can list: the quill and parchment the
 * mapper carries, in the order they take the hands, less any piece stowed in
 * a container.
 * @returns {{lights: object[], mapping: number, kit: Item[]}}
 */
export function formationHands(actor) {
  const lights = bearerLights(actor).filter((l) => l?.lit || l?.shielded);
  const busy = globalThis.acksExtras?.formation?.handsOccupied?.(actor?.id);
  const mapping = Number.isFinite(busy?.mapping) ? busy.mapping : 0;
  const ids = mapping > 0 ? globalThis.acksExtras?.formation?.kitInHand?.(actor?.id) ?? [] : [];
  const kit = ids.map((id) => actor?.items?.get?.(id)).filter((i) => i && !containedIn(i));
  return { lights, mapping, kit };
}

/** Hands occupied by lit light sources this actor bears that no drawn light accounts for. */
export function heldLightHands(actor) {
  return getLoadout(actor).heldLights;
}

/**
 * Whether a light of `type` can be struck without a further hand: a source of
 * that type already drawn and not yet burning is lit where it is, and
 * otherwise one spare hand holds the new flame. Lib's `prepareToLight` asks
 * this through the API before it asks for a spare hand.
 */
export function roomForLight(actor, type) {
  return !!unlitInHand(actor, type) || getLoadout(actor).handsSpare > 0;
}

/**
 * The drawn source of `type` not yet burning, or null: the item a flame of
 * that type is struck on. A light lit on it needs no hand freed and no fuel
 * off a stack — the source in hand is the gear, and burns on its own timer.
 */
export function unlitInHand(actor, type) {
  return getLoadout(actor).lightsInHand.find((l) => l.type === type && !l.lit)?.item ?? null;
}

/**
 * Name the hands that hold nothing this sheet lists — a light burning in no
 * drawn source, the mapper's kit the sheet cannot show — as a short display
 * clause, or "" when every occupied hand is accounted for by a listed row.
 *
 * A hand count the visible gear cannot explain reads as a miscount, and the
 * player's only remedy is to unequip things that were never the problem. Every
 * surface quoting a hand total states this alongside it. A readied torch in
 * hand explains the light burning in it, and the quill and parchment listed at
 * the hands explain the mapping hands, so neither is named here.
 *
 * @param {{heldLights?: number, mappingUnlisted?: number}} source a Loadout,
 *   or a hand-overflow violation's `detail` — both carry the two counts.
 */
export function heldHandsClause(source) {
  const say = (key, n) => {
    const full = `ACKS-EQUIPMENT.wear.${key}`;
    return game.i18n?.has?.(full) ? game.i18n.format(full, { n }) : `${n} ${key}`;
  };
  const parts = [];
  if (source?.heldLights > 0) parts.push(say("handsLights", source.heldLights));
  if (source?.mappingUnlisted > 0) parts.push(say("handsMapping", source.mappingUnlisted));
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
 * off the cuff. Deliberately NOT `system.attack.mod` (where the current loadout
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
      // Versatile: the GRIP changes the cost — one hand held, two in a two-
      // handed grip (a medium melee weapon). Only these offer a grip CHOICE; a
      // weapon that costs two hands however it is held has none.
      canTwoHand: profile.melee && handCost(profile, { twoHanded: false }) === 1 && handCost(profile, { twoHanded: true }) === 2,
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
  // A burning light is held, and a mapper works with a quill in one hand and
  // parchment in the other. A light record is the party sheet's (or the lone
  // actor's flag), a drawn light source is a weapon above: a readied torch
  // that is lit is ONE hand, so each drawn light source absorbs one burning
  // record of its type, and only the records left over cost a hand of their
  // own. The kit counts whether or not the sheet can list it.
  const { lights: burning, mapping: mappingHands, kit: mappingKit } = formationHands(actor);
  const unabsorbed = burning.slice();
  const lightsInHand = equippedWeapons
    .filter((i) => i.getFlag?.(MODULE_ID, "light") === true)
    .map((item) => {
      const type = lightTypeOf(item);
      const at = unabsorbed.findIndex((l) => l.type === type);
      const record = at >= 0 ? unabsorbed.splice(at, 1)[0] : null;
      return { item, type, lit: !!record, light: record };
    });
  const heldLights = unabsorbed.length;
  let handsUsed = weapons.reduce((n, w) => n + w.handsMin, 0) + handShields.length + heldLights + mappingHands;
  // What is COMMITTED — every hand that something would have to be put down to
  // free. Captured before the two-handed grip below, which is elective: a
  // versatile weapon takes the spare hand for the better damage die and gives it
  // straight back the moment a torch or a map wants it. Anything asking "is
  // there room for one more thing?" must read this, not handsFree, or a
  // swordsman with a free hand reads as having none.
  const handsCommitted = handsUsed;

  const trained = trainedStyles(actor);
  // The default grip is the character's best option under the rules: "auto"
  // widens to two hands for the better die when the two-handed style is
  // trained or nothing is enforced, and stays in one hand otherwise, where
  // the wider grip would buy the whole non-proficient package for holding a
  // single sword. An explicit "2h" is the player's call and is honoured.
  const autoTwoHands = !enforcementActive() || trained.has(styleKey(STYLE.TWO_HANDED));

  // HELD IN BOTH HANDS is a fact of the weapon before it is a choice of grip.
  // A bow, a crossbow, a great sword, a staff-sling: the minimum cost is two,
  // so both hands are on it whatever else is carried — a shield, a second
  // weapon or a torch beside it surfaces as a hand overflow below, never as a
  // one-handed bow. Marked for every such weapon, not only a lone melee one:
  // a drawn bow left in the main hand shows an empty off hand, an invitation
  // the hand count then refuses.
  for (const w of weapons) if (w.handsMin >= 2) w.wieldTwoHanded = true;

  // GRIP resolution. A two-handed grip needs BOTH hands, so only a lone melee
  // weapon with no in-hand shield can take it. The player's grip
  // choice governs: "1h" forces one hand; "2h" is honoured only when the hands
  // are actually free (else it is BLOCKED and surfaced); "auto" takes the two-
  // handed grip when hands are free and the style is trained, one-handed
  // otherwise.
  const loneMelee = weapons.length === 1 && !handShields.length && weapons[0].melee;
  if (loneMelee) {
    const w = weapons[0];
    if (w.canTwoHand) {
      // Versatile: the two-handed grip costs ONE hand beyond the one-handed
      // hold, so it needs a spare hand NOW — after weapons, shields, AND any
      // held light are counted. This is what makes a held torch block 2H.
      const twoHandDelta = 2 - w.handsMin; // 1 for a medium weapon
      const spare = budget - handsUsed;
      if (w.grip === "1h") {
        w.wieldTwoHanded = false;
      } else if (w.grip === "2h" || (w.grip === "auto" && autoTwoHands)) {
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

  const spec = specializedStyles(actor);
  // RR ch.3 (Fighting Styles): without the Weapon & Shield style a character
  // gains no benefit from a shield. False only while enforcement is live and
  // a shield is in hand without the style — the loadout effect then cancels
  // the shield's AC, and the advisory below says so.
  const shieldStyled = !hasShield || !enforcementActive() || canUseShieldStyle(actor, trained);
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
      // The unlisted hands travel with the violation. They are the only
      // occupied hands holding nothing this sheet lists, so a message built
      // from `items` alone can never account for the count it quotes.
      detail: { handsUsed, budget, heldLights, mappingHands, mappingUnlisted: mappingHands - mappingKit.length },
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
  if (!shieldStyled) {
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
  // Non-proficient use (RR p. 15): the condition is the equipped STATE — any
  // unusable weapon, unusable worn armour, or an untrained fighting style
  // (weapon and style proficiency are distinct; BOTH are required). Attack/AC
  // land in roll-wrap + the loadout effect; class powers and XP are
  // Judge-side, surfaced via the violation.
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
    heldLights, // hands occupied by burning lights no drawn source accounts for
    lightsInHand, // the drawn light sources, each with the burning record it absorbed
    mappingHands, // hands occupied by the mapper's kit (acks-formation)
    mappingKit, // the kit items listed at the hands, main hand first
    mappingUnlisted: mappingHands - mappingKit.length, // kit hands no listed row explains
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
    shieldStyled,
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
 * @property {number} heldLights burning lights held in no drawn source
 * @property {{item: Item, type: string, lit: boolean, light: object|null}[]} lightsInHand drawn light sources and the burning record each absorbed
 * @property {number} mappingHands hands the mapper's kit takes
 * @property {Item[]} mappingKit the kit listed at the hands, main hand first
 * @property {number} mappingUnlisted kit hands no listed row explains
 * @property {object[]} weapons
 * @property {object|null} armor
 * @property {object[]} shields
 * @property {object|null} shield
 * @property {object|null} helmet
 * @property {string} activeStyle
 * @property {Set<string>} trainedStyles
 * @property {Set<string>} specStyles
 * @property {boolean} styleProficient
 * @property {boolean} shieldStyled the in-hand shield is backed by the style, so its AC counts
 * @property {number} condAC AC that applies only while lightly equipped
 * @property {number} condInit initiative that applies only while lightly equipped
 * @property {{type,items,advisory?,detail?}[]} violations
 * @property {boolean} legal
 */
