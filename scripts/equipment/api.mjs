/* global game, globalThis */
/**
 * Public API — exposed on `game.modules.get("acks-equipment").api` and mirrored
 * on `globalThis.acksExtras?.equipment`. Lets sibling modules read the loadout the way
 * they read each other's data today (formation reads equipped weapons; henchmen
 * reads gear), and lets macros drive equip/annotate/purchase.
 */
import { acksExtras } from "../namespace.mjs";
import { MODULE_ID, HOOKS, EFFECT_DOMAINS, ITEM_FLAGS } from "./constants.mjs";
import { getLoadout, VIOLATION, trainedStyles, specializedStyles, handBudget, heldLightHands, releaseOrder } from "./loadout.mjs";
import { grantGear, clearHands, findGearSource } from "./grant.mjs";
import { classifyWeapon, handCost, focusGroup, weaponKey, equipmentClass, inferGear, isHelmet, isShield } from "./profiles.mjs";
import { FLAG_GEAR } from "../lib/constants.mjs";
import { capacityOf } from "../lib/item-model.mjs";
import { weaponProficiency, isWeaponProficient, armorMax, isArmorProficient, thiefSkillsGated, isArmorGatedSkill, grantMatches, normalizeGrantToken, classifyGrantToken } from "./proficiency.mjs";
import { refreshLoadout } from "./enforce.mjs";
import { planItemLoss, stonesAtRisk, isVulnerable, materialOf, setMaterial, MATERIALS } from "./overlays/item-loss.mjs";
import { isSilvered, canBeSilvered, setSilvered, dealsExtraordinaryDamage } from "./silver.mjs";
import { maneuverMods, MANEUVERS } from "./overlays/maneuvers.mjs";
import * as named from "./overlays/named.mjs";
import { consumeForAttack, recoverThrown, isThrownAway, consumeItem, nockAmmo } from "./ammo.mjs";
import { prepareTorch, rollUnarmed, unarmedStrikeData, setMasterwork, masterworkTiersFor, drawItem, sheatheItem, scavengeItem, clearScavenged, setShieldVariant, SHIELD_VARIANT_KEYS, disguiseItem, revealItem, isDisguised } from "./actions.mjs";
import { cycleStrap, strapOf, canStrap } from "./overlays/shield-variants.mjs";
import { helmetType, isEnclosingHelm, enclosingHelmActive, HELM_MODIFIERS } from "./overlays/enclosing-helm.mjs";
import { isSpellbook, spellbookValue, pagesUsed, pagesCapacity, spellbookSpells, setSpellbookSpells } from "./spellbook.mjs";
import {
  containerReport,
  contentsOf,
  contentsWeight6,
  overCapacity,
  isContainer,
  encumbranceDelta6,
  looseItems,
  containerChain,
  canStore,
  storeIn,
  takeOut,
  emptyContainer,
} from "./containers.mjs";
import { isLocked, isConcealed, isFragile, canSeeInside, setLocked, setOpened, setConcealed } from "./containers.mjs";
import { pickLock, bashOpen, destroyContainer, canPick, canBash } from "./locks.mjs";
import { stripModuleData } from "./uninstall.mjs";
import { collectEffectModifiers, sumEffectModifiers, collectStringFlags, hasEffectFlag } from "./effects.mjs";
import { bridgeContributions } from "./abilities-bridge.mjs";
import * as CONFIG_DATA from "./config.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";

/**
 * Stamp module profile flags onto a core item from its RAW profile.
 *
 * Three layers, applied in ONE write:
 *  - weapons: size and qualities from the RAW weapon table;
 *  - carrying devices: capacity, harness, bowquiver;
 *  - EVERY physical item: where it sits (`gear.slots`) and what it costs to
 *    reach into (`gear.access`), inferred by `inferGear`.
 *
 * The gear layer is what makes clothing and rigging wearable at all — core
 * declares `system.equipped` on weapon and armor alone — and it is a correctable
 * guess, not a fact: the item sheet offers the slot control that overrides it.
 * Gear that belongs nowhere (rations, loot, tools) declares no slot, which is
 * how it keeps the wear features switched off.
 *
 * Core already ships all of these items, so we annotate in place rather than
 * duplicate them into our own packs.
 *
 * @returns {string|null} the profile key applied, or null if nothing was stamped
 */
export async function annotateItem(item) {
  if (!item) return null;
  const updates = {};
  let key = null;

  if (item.type === ITEM_TYPE.weapon) {
    key = weaponKey(item);
    if (key) {
      const base = CONFIG_DATA.WEAPONS[key];
      Object.assign(updates, {
        [`flags.${MODULE_ID}.${ITEM_FLAGS.SIZE}`]: base.size,
        [`flags.${MODULE_ID}.${ITEM_FLAGS.DAMAGE_TYPE}`]: base.type || "",
        [`flags.${MODULE_ID}.${ITEM_FLAGS.HANDY}`]: !!base.handy,
        [`flags.${MODULE_ID}.${ITEM_FLAGS.THROWN}`]: !!base.thrown,
        // A thrown melee weapon is a MISSILE too (RR p296), and core only offers
        // its melee-vs-thrown range selector when BOTH booleans are set — so
        // reconcile the core item to the RAW profile. melee/missile are left as-is
        // for a purely melee or purely missile weapon (base.thrown false).
        "system.melee": base.melee ?? item.system?.melee ?? false,
        "system.missile": !!(base.missile || base.thrown),
      });
    }
  }

  const profile = CONFIG_DATA.gearProfileFor(item.name ?? "");
  if (profile) {
    if (profile.harness) updates[`flags.${MODULE_ID}.${ITEM_FLAGS.HARNESS}`] = true;
    if (profile.bowquiver) updates[`flags.${MODULE_ID}.${ITEM_FLAGS.BOWQUIVER}`] = true;
    if (profile.capacity != null) key ??= "container";
  }

  // Where it sits, what it costs to reach into, and how much it holds. Only
  // stamped when there is something to say, so annotating a sack of rations
  // does not litter it with an empty model.
  //
  // Capacity is written HERE, not into the container record: it is a property
  // of gear rather than of a category, which is what lets a Judge give a coat
  // hidden pockets. The container record keeps only the lock's state.
  const gear = inferGear(item);
  if (gear.slots.length || gear.access || gear.capacity != null) {
    updates[`flags.${MODULE_ID}.${FLAG_GEAR}`] = {
      slots: gear.slots,
      access: gear.access,
      capacity: gear.capacity,
    };
    key ??= gear.capacity != null ? "container" : "gear";
  }

  // A device sold with its load — "Quiver, 20 Arrows" — is the ammunition, and
  // an earlier pass that read it as an empty quiver left a capacity on it. This
  // is the one place the annotate step UNDOES its own earlier answer rather
  // than merely refining it, because the stale flag is what shows a full quiver
  // as empty and nothing else will clear it. Re-running the annotate button is
  // how a world already carrying the wrong answer gets the right one.
  const rounds = CONFIG_DATA.bundledAmmoCount(item.name ?? "");
  if (rounds != null) {
    if (capacityOf(item) != null) {
      updates[`flags.${MODULE_ID}.${FLAG_GEAR}`] = { slots: gear.slots, access: gear.access, capacity: null };
      key = "ammunition";
    }
    // Put the count where the ammunition tracker can spend it. Only when the
    // item has none of its own: a half-spent quiver must not refill itself
    // every time somebody re-annotates their gear.
    if (item.system?.quantity?.value == null) {
      updates["system.quantity.value"] = rounds;
      key ??= "ammunition";
    }
  }

  if (!Object.keys(updates).length) return null;
  await item.update(updates);
  return key;
}

export function buildApi() {
  const api = {
    // Model
    getLoadout,
    handBudget,
    // Free hands right now — read by acks-formation before it lights a source
    // (a light needs a hand to hold). The write half of the two-way hook.
    freeHands: (actor) => getLoadout(actor).handsFree,
    // Room for one more thing, which is a different question from what is free:
    // a lone versatile weapon holds the spare hand only until something needs
    // it. acks-formation asks THIS before lighting a torch, so a swordsman with
    // an empty off hand is not told he has none.
    spareHands: (actor) => getLoadout(actor).handsSpare,
    heldLightHands,
    releaseOrder,
    // The Judge's override, in two mutations: hand over gear the character does
    // not have, and put held gear away to make room for it. acks-formation calls
    // both when a GM gives a member a light or sets them to mapping.
    grantGear,
    clearHands,
    findGearSource,
    trainedStyles,
    specializedStyles,
    VIOLATION,
    // Profiles
    classifyWeapon,
    equipmentClass, // the equipment "root": name → core type + stats (acks-content consumes it)
    handCost,
    focusGroup,
    weaponKey,
    isHelmet, // armour classification: the one owner for the whole feature
    isShield,
    inferGear, // name/type → where it sits + what it costs to reach into
    annotateItem,
    refreshLoadout,
    // Proficiency
    weaponProficiency,
    isWeaponProficient,
    armorMax,
    isArmorProficient,
    thiefSkillsGated,
    isArmorGatedSkill,
    // The class-training grant grammar, inspectable: what a token means, and
    // whether it means anything at all. The Configure Proficiencies macro builds
    // its picker from these rather than re-stating the grammar in a second place.
    grantMatches,
    normalizeGrantToken,
    classifyGrantToken,
    // Overlays
    planItemLoss,
    stonesAtRisk,
    isVulnerable,
    materialOf,
    maneuverMods,
    MANEUVERS,
    named, // JJ p.399 named arms & armour: true name, guessing, unlock ladder
    // Ammunition & thrown-weapon state (RAW: consume on use; manual recovery).
    consumeForAttack,
    recoverThrown,
    isThrownAway,
    consumeItem, // shared decrement primitive (acks-formation burns torches/oil through this)
    // "The silver ones, now": declare which ammunition stack the next shot
    // comes from, ahead of the plain-first default. Exclusive per actor.
    nockAmmo,
    // Sheet actions (also usable from macros): ready a torch from a stack, roll
    // an unarmed strike, draw/sheathe a weapon, apply masterwork, sling a shield.
    prepareTorch,
    rollUnarmed,
    unarmedStrikeData,
    drawItem,
    sheatheItem,
    setMasterwork,
    masterworkTiersFor,
    scavengeItem,
    clearScavenged,
    setShieldVariant,
    SHIELD_VARIANT_KEYS,
    cycleStrap,
    strapOf,
    canStrap,
    // Enclosing helm (RR p140), material, spellbook, and the GM apparent-value mask
    helmetType,
    isEnclosingHelm,
    enclosingHelmActive,
    HELM_MODIFIERS,
    setMaterial,
    MATERIALS,
    // Silver (RR ch.4) — the one material that changes what a weapon counts as
    isSilvered,
    canBeSilvered,
    setSilvered,
    dealsExtraordinaryDamage,
    isSpellbook,
    spellbookValue,
    pagesUsed,
    pagesCapacity,
    spellbookSpells,
    setSpellbookSpells,
    disguiseItem,
    revealItem,
    isDisguised,
    // Containers
    containerReport,
    contentsOf,
    contentsWeight6,
    overCapacity,
    isContainer,
    encumbranceDelta6,
    looseItems,
    containerChain,
    canStore,
    storeIn,
    takeOut,
    emptyContainer,
    // Locks and concealment. `openContainerManager` is GONE — the popout it
    // opened is retired; its controls live on the character sheet's equipment
    // tab, next to the gear they act on.
    isLocked,
    isConcealed,
    isFragile,
    canSeeInside,
    setLocked,
    setOpened,
    setConcealed,
    pickLock,
    bashOpen,
    destroyContainer,
    canPick,
    canBash,
    // Effect contract
    collectEffectModifiers,
    sumEffectModifiers,
    collectStringFlags,
    hasEffectFlag,
    bridgeContributions, // proficiency facts read from the acks-abilities model
    EFFECT_DOMAINS,
    // Uninstall: strip every flag/effect this module wrote, so disabling it
    // leaves no orphaned loadout effects or masked item identities behind.
    stripModuleData,
    // Data + constants
    config: CONFIG_DATA,
    HOOKS,
  };
  acksExtras.equipment = api;
  return api;
}
