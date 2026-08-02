/* global game, globalThis */
/**
 * Public API — exposed on `game.modules.get("acks-equipment").api` and mirrored
 * on `globalThis.acksEquipment`. Lets sibling modules read the loadout the way
 * they read each other's data today (formation reads equipped weapons; henchmen
 * reads gear), and lets macros drive equip/annotate/purchase.
 */
import { MODULE_ID, HOOKS, EFFECT_DOMAINS, ITEM_FLAGS } from "./constants.mjs";
import { getLoadout, VIOLATION, trainedStyles, specializedStyles, handBudget, heldLightHands } from "./loadout.mjs";
import { classifyWeapon, handCost, focusGroup, weaponKey, equipmentClass } from "./profiles.mjs";
import { weaponProficiency, isWeaponProficient, armorMax, isArmorProficient, thiefSkillsGated, isArmorGatedSkill, grantMatches, normalizeGrantToken, classifyGrantToken } from "./proficiency.mjs";
import { refreshLoadout } from "./enforce.mjs";
import { planItemLoss, stonesAtRisk, isVulnerable, materialOf, setMaterial, MATERIALS } from "./overlays/item-loss.mjs";
import { maneuverMods, MANEUVERS } from "./overlays/maneuvers.mjs";
import * as named from "./overlays/named.mjs";
import { clearFromPaperDoll } from "./paperdoll.mjs";
import { consumeForAttack, recoverThrown, isThrownAway, consumeItem } from "./ammo.mjs";
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

/**
 * Stamp module profile flags onto a core item from its RAW profile.
 * Handles weapons (size/qualities) and carrying devices (container capacity,
 * harness, bowquiver) — core already ships both, so we annotate in place rather
 * than duplicate them into our own packs.
 * @returns {string|null} the profile key applied, or null if unrecognised
 */
export async function annotateItem(item) {
  if (item?.type === "weapon") {
    const key = weaponKey(item);
    if (!key) return null;
    const base = CONFIG_DATA.WEAPONS[key];
    await item.update({
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
    return key;
  }
  if (item?.type === "item") {
    const profile = CONFIG_DATA.containerProfileFor(item.name);
    if (!profile) return null;
    const updates = {};
    if (profile.capacity) updates[`flags.${MODULE_ID}.${ITEM_FLAGS.CONTAINER}`] = { capacity: profile.capacity };
    if (profile.harness) updates[`flags.${MODULE_ID}.${ITEM_FLAGS.HARNESS}`] = true;
    if (profile.bowquiver) updates[`flags.${MODULE_ID}.${ITEM_FLAGS.BOWQUIVER}`] = true;
    if (!Object.keys(updates).length) return null;
    await item.update(updates);
    return "container";
  }
  return null;
}

export function buildApi() {
  const api = {
    // Model
    getLoadout,
    handBudget,
    // Free hands right now — read by acks-formation before it lights a source
    // (a light needs a hand to hold). The write half of the two-way hook.
    freeHands: (actor) => getLoadout(actor).handsFree,
    heldLightHands,
    trainedStyles,
    specializedStyles,
    VIOLATION,
    // Profiles
    classifyWeapon,
    equipmentClass, // the equipment "root": name → core type + stats (acks-content consumes it)
    handCost,
    focusGroup,
    weaponKey,
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
    clearFromPaperDoll,
    // Ammunition & thrown-weapon state (RAW: consume on use; manual recovery).
    consumeForAttack,
    recoverThrown,
    isThrownAway,
    consumeItem, // shared decrement primitive (acks-formation burns torches/oil through this)
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
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = api;
  globalThis.acksEquipment = api;
  return api;
}
