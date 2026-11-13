/* global game, globalThis */
/**
 * Public API — exposed as `acksExtras.equipment` on `globalThis`, the same
 * object `game.modules.get("acks-extras").api.equipment` reaches. Lets sibling features read the
 * loadout (formation reads equipped weapons; henchmen reads gear), and lets
 * macros drive equip/annotate/purchase.
 */
import { acksExtras } from "../namespace.mjs";
import { MODULE_ID, HOOKS, EFFECT_DOMAINS, ITEM_FLAGS } from "./constants.mjs";
import { getLoadout, VIOLATION, trainedStyles, specializedStyles, handBudget, heldLightHands, heldHandsClause, releaseOrder, bestAttackBonus, roomForLight, unlitInHand } from "./loadout.mjs";
import { grantGear, clearHands, findGearSource } from "./grant.mjs";
import {
  mountedCombatCard,
  whoMayAct,
  vehicleTransportersMayAct,
  heightAdvantage,
  riderWaivers,
  hasMilitarySaddle,
} from "./overlays/mounted.mjs";
import { classifyWeapon, handCost, focusGroup, weaponKey, weaponIdentity, isUnidentifiedWeapon, inferredGrips, equipmentClass, inferGear, inferredGearFlag, wearableSlots, isHelmet, isShield, perStoneStated } from "./profiles.mjs";
import { FLAG_GEAR } from "../lib/constants.mjs";
import { capacityOf, bundleSizeOf, gearOf, isCurrency, declaresSlots, reliefOf } from "../lib/item-model.mjs";
import { weaponProficiency, isWeaponProficient, armorMax, isArmorProficient, armourCeiling, grantMatches, normalizeGrantToken, classifyGrantToken } from "./proficiency.mjs";
import { armourLimitedAbilities } from "./armour-limits.mjs";
import { refreshLoadout } from "./enforce.mjs";
import { planItemLoss, stonesAtRisk, isVulnerable, materialOf, setMaterial, materialVocabulary, itemLossFigures, itemLossMaterials } from "./overlays/item-loss.mjs";
import { openItemLoss, applyItemLoss } from "./item-loss-flow.mjs";
import { isSilvered, canBeSilvered, setSilvered, dealsExtraordinaryDamage } from "./silver.mjs";
import { maneuverMods, MANEUVERS } from "./overlays/maneuvers.mjs";
import * as named from "./overlays/named.mjs";
import { consumeForAttack, recoverThrown, isThrownAway, consumeItem, nockAmmo } from "./ammo.mjs";
import * as variationRules from "./variations.mjs";
import * as variationItems from "./variation-items.mjs";
import { BASE_TYPE, BASE_TYPE_FLAG, CLOTHING_SUBTYPE, baseTypesFor, clothingDeclarationPatch } from "./base-types.mjs";
import { baseTypeFields, hasBaseTypeFields } from "./variation-defs.mjs";
import { prepareTorch, rollUnarmed, unarmedStrikeData, setMasterwork, masterworkTiersFor, drawItem, sheatheItem, scavengeItem, clearScavenged, setShieldVariant, SHIELD_VARIANT_KEYS, disguiseItem, revealItem, isDisguised, setWeaponProfile, setWeaponSize, setWeaponGrips, setWeaponCategory, setGearSlotList } from "./actions.mjs";
import { cycleStrap, strapOf, canStrap } from "./overlays/shield-variants.mjs";
import { helmetType, isEnclosingHelm, enclosingHelmActive, helmFigures } from "./overlays/enclosing-helm.mjs";
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
import { weaponRow } from "../lib/weapons.mjs";
import { heldGrip } from "./attack-mods.mjs";
import { heldDieTip } from "./weapon-figures.mjs";

/**
 * Stamp module profile flags onto a core item from its RAW profile.
 *
 * Four layers, applied in ONE write:
 *  - weapons: the profile key, and the two attack booleans of a thrown melee
 *    row;
 *  - carrying devices: holds, harness, bowquiver;
 *  - EVERY physical item: where it sits (`gear.slots`) and what it costs to
 *    reach into (`gear.access`), inferred by `inferGear`;
 *  - coin: how many make a stone (`gear.perStone`), where its own text says.
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
    const base = key ? weaponRow(key) : null;
    if (base) {
      // The identity itself, written down (DECISIONS.md, "What a weapon
      // IS is declared, not read off its name (2026-09-07)").
      updates[`flags.${MODULE_ID}.${ITEM_FLAGS.PROFILE_KEY}`] = key;
      // The row stays the row: a size, a damage type or a quality it states
      // is read from it at every use, so a later import is what the item
      // follows. Only the item's own two attack booleans are reconciled, and
      // only for a row that states a use at all (neither melee, missile nor
      // thrown is an empty shell). A thrown melee weapon is a MISSILE too (RR
      // p296), and core only offers its melee-vs-thrown range selector when
      // BOTH booleans are set.
      if (base.melee || base.missile || base.thrown) {
        Object.assign(updates, {
          "system.melee": base.melee ?? item.system?.melee ?? false,
          "system.missile": !!(base.missile || base.thrown),
        });
      }
    }
  }

  const profile = CONFIG_DATA.gearProfileFor(item.name ?? "");
  if (profile) {
    if (profile.harness) updates[`flags.${MODULE_ID}.${ITEM_FLAGS.HARNESS}`] = true;
    if (profile.bowquiver) updates[`flags.${MODULE_ID}.${ITEM_FLAGS.BOWQUIVER}`] = true;
    if (profile.holds) key ??= "container";
  }

  // Where it sits, what it costs to reach into, and whether it takes gear —
  // only stamped when there is something to say, and key by key only where the
  // item declares nothing: a Judge's slots, access, holds or relief stand,
  // since a later pass cannot tell its own earlier answer from theirs.
  // How much it holds is never stamped here: the page states it and the
  // importer writes it to the gear flag's `capacity` (the container record
  // keeps only the lock's state).
  const G = `flags.${MODULE_ID}.${FLAG_GEAR}`;
  const gear = inferGear(item);
  const inferred = inferredGearFlag(item);
  if (inferred) {
    const held = gearOf(item);
    if (!declaresSlots(item)) updates[`${G}.slots`] = inferred.slots;
    if (!held.access) updates[`${G}.access`] = inferred.access;
    if (inferred.holds && held.holds == null) updates[`${G}.holds`] = true;
    if ("relief" in inferred && reliefOf(item) == null) updates[`${G}.relief`] = inferred.relief;
    if ("loaded6" in inferred && !Number.isFinite(held.loaded6)) updates[`${G}.loaded6`] = inferred.loaded6;
    key ??= gear.holds ? "container" : "gear";
  }

  // A device sold with its load — a quiver priced with its arrows (RR p. 126) — is the ammunition;
  // re-running annotate clears a capacity or holds declaration an earlier
  // pass mistakenly stamped, the two keys this pass takes back.
  //
  // The count is never written here (DECISIONS.md, "Annotate declares the
  // bundle and never the count (2026-09-05)").
  const rounds = CONFIG_DATA.bundledAmmoCount(item.name ?? "");
  if (rounds != null) {
    if (capacityOf(item) != null || gearOf(item).holds === true) {
      updates[`${G}.capacity`] = null;
      updates[`${G}.holds`] = false;
      key = "ammunition";
    }
    // The name states a bundle, so the printed weight beside it is the
    // bundle's (DECISIONS.md, "A stated weight may cover a bundle
    // (2026-08-31)"). Never overwrite a bundle size a Judge has already set.
    if (bundleSizeOf(item) <= 1) {
      updates[`${G}.per`] = rounds;
      key ??= "ammunition";
    }
  }

  // A coin's weight is how many of it make a stone. The figure is the item's
  // own — read off its text, never supplied here — and one already on the
  // item, a Judge's or an earlier pass's, is left alone.
  if (isCurrency(item) && gearOf(item).perStone == null) {
    const perStone = perStoneStated(item);
    if (perStone != null) {
      updates[`${G}.perStone`] = perStone;
      key ??= "coin";
    }
  }

  // The flag's half of a clothing declaration, written through, so a garment
  // the rail declared leaves the weight. A subtype of clothing under another
  // flag is a disagreement only a Judge can settle, so it is left alone.
  const through = clothingDeclarationPatch(
    { type: item.type, baseType: null, subtype: item.system?.subtype },
    { baseType: item.flags?.[MODULE_ID]?.[BASE_TYPE_FLAG] ?? null },
  );
  if (through?.subtype === CLOTHING_SUBTYPE) {
    updates["system.subtype"] = CLOTHING_SUBTYPE;
    key ??= "clothing";
  }

  if (!Object.keys(updates).length) return null;
  await item.update(updates);
  return key;
}

export function buildApi() {
  const api = {
    // Mounted combat (overlays/mounted.mjs): the action-economy card and the
    // pure rules shapes a companion module reads instead of re-deriving.
    mounted: {
      mountedCombatCard,
      whoMayAct,
      vehicleTransportersMayAct,
      heightAdvantage,
      riderWaivers,
      hasMilitarySaddle,
    },
    // Model
    getLoadout,
    handBudget,
    // Free hands right now — read by the formation feature before it lights a source
    // (a light needs a hand to hold). The write half of the two-way hook.
    freeHands: (actor) => getLoadout(actor).handsFree,
    // Room for one more thing (see docs/equipment/MODEL.md, "Hands: free,
    // committed, spare"); the formation feature asks this before lighting a torch.
    spareHands: (actor) => getLoadout(actor).handsSpare,
    // Whether a light of this type can be struck without a further hand: one
    // already drawn and unlit is lit where it is. lib's `prepareToLight` asks
    // this before it asks for a spare hand.
    roomForLight,
    // The drawn, unlit source of this type, or null: lit where it is, with no
    // hand freed and no fuel off a stack. lib and the Judge's override ask it.
    unlitInHand,
    // The hands the party sheet holds, as the clause every hand total carries;
    // "" when the gear accounts for every hand. lib names it in a light refusal.
    heldHandsClause: (actor) => heldHandsClause(getLoadout(actor)),
    heldLightHands,
    releaseOrder,
    // The Judge's override mutations (see docs/equipment/MODEL.md, "Giving
    // gear, and making room for it — `grant.mjs`").
    grantGear,
    clearHands,
    findGearSource,
    trainedStyles,
    bestAttackBonus, // the character alone: attribute + training, no gear

    specializedStyles,
    VIOLATION,
    // Profiles
    classifyWeapon,
    equipmentClass, // the equipment "root": name → core type + stats (the importer consumes it)
    handCost,
    heldGrip, // the grip a weapon is held in now and the die it deals there
    heldDieTip, // where that die came from, as a tooltip
    focusGroup,
    weaponKey,
    weaponIdentity, // which RAW weapon a document is, and on whose authority
    isUnidentifiedWeapon,
    inferredGrips,
    setWeaponProfile, // the declarations the item sheet's Construction panel writes
    setWeaponSize,
    setWeaponGrips,
    setWeaponCategory,
    setGearSlotList,
    isHelmet, // armour classification: the one owner for the whole feature
    isShield,
    inferGear, // name/type → where it sits + what it costs to reach into
    wearableSlots, // declared places, else the inferred ones
    annotateItem,
    refreshLoadout,
    // Proficiency
    weaponProficiency,
    isWeaponProficient,
    armorMax,
    isArmorProficient,
    armourCeiling, // does a loadout break an armourCeiling gate's limit
    armourLimitedAbilities, // an actor's abilities held by an armour limit under a loadout
    // The class-training grant grammar, inspectable: what a token means, and
    // whether it means anything at all. The Configure Proficiencies macro builds
    // its picker from these rather than re-stating the grammar in a second place.
    grantMatches,
    normalizeGrantToken,
    classifyGrantToken,
    // Overlays
    planItemLoss,
    applyItemLoss,
    openItemLoss, // the Judge's item-loss flow; the "Item Loss from Damage" macro launches it
    stonesAtRisk,
    isVulnerable,
    // Read at every access: the import's and the Judge's, each null until imported.
    get ITEM_LOSS_FIGURES() {
      return itemLossFigures();
    },
    get ITEM_LOSS_MATERIALS() {
      return itemLossMaterials();
    },
    materialOf,
    maneuverMods,
    MANEUVERS,
    named, // JJ p.399 named arms & armour: true name, guessing, unlock ladder
    // Ammunition & thrown-weapon state (RAW: consume on use; manual recovery).
    consumeForAttack,
    recoverThrown,
    isThrownAway,
    consumeItem, // shared decrement primitive (the formation feature burns torches/oil through this)
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
    // VARIATIONS — the open-ended half of "how does this one differ" (see
    // docs/equipment/DECISIONS.md, "A variation is a document, and applying
    // it is putting it inside (2026-08-15)"). `setMasterwork`, `scavengeItem`
    // and `setShieldVariant` are the Construction tab's own controls, which
    // write the masterwork, scavenged and shield-variant flags; the variation
    // document is the other way an item differs, and the two coexist.
    variations: {
      ...variationRules,
      ...variationItems,
      BASE_TYPE,
      baseTypesFor,
      baseTypeFields,
      hasBaseTypeFields,
    },
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
    // Read at every access: the figures are the import's and the Judge's,
    // each null until imported.
    get HELM_MODIFIERS() {
      return helmFigures();
    },
    setMaterial,
    // The material words the imported item-loss table names; empty until imported.
    get MATERIALS() {
      return materialVocabulary();
    },
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
    // Locks and concealment (see docs/equipment/DECISIONS.md, "The Container
    // Manager popout is retired").
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
    bridgeContributions, // proficiency facts read from the abilities model
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
