/* global game, CONFIG, Hooks, Actor, foundry */
/**
 * acks-lib — shared primitives for the ACKS II module family, and the family's
 * PATCH LAYER on the acks system.
 *
 * The system is an unmodifiable reference (every module's CLAUDE.md). Anything
 * the family needs that the system does not provide — a new actor sub-type, a
 * compatibility stub the system's own code demands, a baseline the system spells
 * out per type instead of sharing — lands here, once, rather than in each module
 * that happens to need it first. A module patches core directly only for
 * behaviour unique to its own domain.
 *
 * Scope now:
 *   - the effect/ability vocabulary and field-builders (abilities program)
 *   - the scoping primitives the social rolls need
 *   - the layered tables registry, service registry, ruledata loader
 *   - **actor compatibility stubs** — one definition of the fields the system
 *     touches on every actor, replacing four drifting copies across the family
 *   - **the `acks-lib.animal` actor sub-type** — an animal is a monster you can
 *     also buy, load and ride, so its combat block uses the monster's own field
 *     paths and everything that reads a monster reads it unchanged
 *   - **mount binding** — the "who is riding what" fact acks-equipment's
 *     mounted-combat overlay has been blocked on
 *   - **the shared item baseline** — one answer to "is this physical / can it
 *     be equipped / what does it weigh", which the system spells out per type
 */
import { acksExtras } from "../namespace.mjs";
import * as movementScales from "./movement-scales.mjs";
import { MODULE_ID, LANG_PREFIX, ANIMAL_TYPE, GROUP_TYPE, TEMPLATE_TYPE } from "./constants.mjs";
import { isPrimaryGM } from "./util.mjs";
import { registerUiPresetSettings, promptUiPreset, effectiveLook, refreshSheetDefaults } from "./ui-preset.mjs";
import * as vocab from "./vocab.mjs";
import * as wallGeometry from "./wall-geometry.mjs";
import * as wallLayers from "./wall-layers.mjs";
import * as fields from "./fields.mjs";
import * as library from "./library.mjs";
import { registerLibraryWarm } from "./library.mjs";
import * as tables from "./tables.mjs";
import * as services from "./services.mjs";
import * as itemModel from "./item-model.mjs";
import * as mount from "./mount.mjs";
import * as attachment from "./attachment.mjs";
import * as capacity from "./capacity.mjs";
import * as money from "./money.mjs";
import {
  organizeCompendiumFolders,
  restoreCompendiumLibrary,
  fileImportedPack,
} from "./compendium-folders.mjs";
import { installPolyglotBridge, publishWorldLanguages } from "./polyglot.mjs";
import { registerManagedEffectGuard, lockManagedEffectRows } from "./managed-effects.mjs";
import { associateLabels } from "./a11y.mjs";
import * as moneyLogic from "./money-logic.mjs";
import * as storage from "./storage.mjs";
import * as places from "./place.mjs";
import * as actorRead from "./actor-read.mjs";
import { loadRuledata } from "./ruledata.mjs";
import { resolveLevelValue } from "./vocab.mjs";
import { acksCompatStubs, savingThrowFields } from "./actor-compat.mjs";
import AnimalData from "./data/animal-data.mjs";
import GroupData from "./data/group-data.mjs";
import TemplateData from "./data/template-data.mjs";
import * as groups from "./group.mjs";
import * as templateLogic from "./template-logic.mjs";
import { GroupSheet } from "./apps/group-sheet.mjs";
import { TemplateSheet } from "./apps/template-sheet.mjs";
import { registerMountCleanup } from "./mount.mjs";
import { registerStorageCleanup, DELETE_POLICY_SETTING } from "./storage.mjs";
import { registerGroupCleanup } from "./group.mjs";
import { FollowerCardSheet } from "./apps/follower-card-sheet.mjs";
import { followerCardContext, renderFollowerCard, FOLLOWER_CARD_TEMPLATE } from "./follower-card.mjs";
import * as attackLogic from "./attack-logic.mjs";
import * as damageType from "./damage-type.mjs";
import { installAttackRollPatch, wrapRollAttack, PRE_ATTACK_HOOK, POST_ATTACK_HOOK } from "./patches/attack-roll.mjs";
import { installMathReveal, ROLL_MATH, ROLL_MATH_SETTING } from "./roll-audience.mjs";
import { installAttackDisplayPatch } from "./patches/attack-display.mjs";
import { installGoodsDrag } from "./patches/goods-drag.mjs";
import { installSurpriseCardPatch, SETTING_SURPRISE_CARD } from "./patches/surprise-card.mjs";
import { installInitiativeCardPatch, SETTING_INITIATIVE_CARD } from "./patches/initiative-card.mjs";
import { installCombatRoundPatch } from "./patches/combat-round.mjs";
import * as senses from "./senses.mjs";
import * as light from "./light.mjs";
import * as perception from "./perception.mjs";
import { registerPerceptionModes } from "./perception.mjs";
import {
  SETTING_MANAGE_VISION,
  migrateWorldVision,
  syncActorTokens,
  syncNightVisionTokens,
  syncSceneTokens,
  syncTokenFromActor,
} from "./token-sync.mjs";
import { SETTING_ADVANCE_WORLD_TIME } from "./world-time.mjs";
import * as movementModes from "./movement-modes.mjs";
import * as survival from "./survival.mjs";
import { danglingRefCheck, fixEach, fixRepairs, registerRepairCheck, repairChecks, scanRepairs } from "./repair.mjs";
import { registerLibRepairChecks } from "./repair-checks.mjs";
import { RepairMenu, openRepairTool } from "./apps/repair-app.mjs";
import { adjustTargets } from "./hp.mjs";
import { hpEligibility, planHpChange } from "./hp-logic.mjs";
import { installHpControl, openHpTool } from "./apps/hp-app.mjs";

/** The actor sub-types this library adds to the system (named in constants.mjs). */
export { ANIMAL_TYPE, GROUP_TYPE, TEMPLATE_TYPE };

/**
 * The Follower Card is the per-instance default sheet for RETAINERS (hirelings) of
 * these types — keyed on the core `system.retainer.enabled` flag, so one rule
 * covers character AND monster hirelings without depending on acks-henchmen.
 */
const FOLLOWER_TYPES = new Set([vocab.ACTOR_TYPE.character, vocab.ACTOR_TYPE.monster]);
const FOLLOWER_SHEET_KEY = `${MODULE_ID}.FollowerCardSheet`;

/** The library's own implementation of its API surface. */
const localImpl = Object.freeze({
  // 19: hp — the group hit-point tool.
  apiVersion: 20,
  vocab,
  fields,
  /**
   * Segments and the graph a set of them draws (wall-geometry.mjs): crossings,
   * distances, an endpoint-tolerant graph, and how far it is ALONG the lines.
   * Foundry-free, so a macro can measure a route without a canvas.
   */
  wallGeometry,
  /**
   * A LAYER over a wall (wall-layers.mjs) — what a drawn line MEANS to this
   * module. The flag read and write, the non-blocking shape, core's one
   * drawing-preset slot, and the region a selection's loop encloses.
   */
  wallLayers,
  /**
   * The imported library, wherever it lives (library.mjs): `libraryItems` /
   * `libraryActors` / `libraryDocs(type)` read the sidebar AND the importer's
   * world packs, `whenReady()` awaits the warm. Every "what has this world
   * imported?" question goes through it — a bare `game.items` finds an empty
   * shelf, because imports are written to a pack.
   */
  library,
  resolveLevelValue,
  tables,
  /**
   * Which modifiers a thing meets, and in what order. The middle the three
   * speed derivations were missing: a vehicle adjusts the march, a vessel is
   * an independent layer, and a flier is neither.
   */
  movementModes,
  /** Hunger and thirst, a day at a time. Formation automates it for a group. */
  survival,
  /**
   * The standing repair tool (repair.mjs, repair-logic.mjs): `register` a
   * check, `checks` lists them, `scan` and `fix` run them as the window does
   * (fix rescans, and judges by what it finds), `open` shows the window,
   * `danglingRefCheck` builds the commonest check, and `fixEach` shapes a
   * per-finding fix's results. GM only.
   */
  repair: {
    register: registerRepairCheck,
    checks: repairChecks,
    scan: scanRepairs,
    fix: fixRepairs,
    open: openRepairTool,
    danglingRefCheck,
    fixEach,
  },
  /**
   * The group hit-point tool (hp.mjs, hp-logic.mjs): `open` shows the window
   * on tokens, actors or party ids (the selection when given none), `adjust`
   * makes one change without it, `plan` computes a change as core's
   * `applyDamage` would, and `eligibility` says why an actor is left out.
   * `open` and `adjust` are GM only.
   */
  hp: {
    open: openHpTool,
    adjust: adjustTargets,
    plan: planHpChange,
    eligibility: hpEligibility,
  },
  services,
  loadRuledata,
  // --- patch layer ---
  acksCompatStubs,
  savingThrowFields,
  AnimalData,
  ANIMAL_TYPE,
  /** The `acks-lib.group` stackable actor: model + lifecycle ops. */
  GroupData,
  GROUP_TYPE,
  groups,
  /** The `acks-lib.template` generator actor: model + pure roll/resolve. */
  TemplateData,
  TEMPLATE_TYPE,
  templateLogic,
  /**
   * One actor attached to another in a role (attachment.mjs): the single
   * carry model — attach / detach / attachedTo / attachmentOf / carrierOf /
   * carrierChain / rootCarrierOf / ATTACH_ROLES. Mounting, boarding,
   * harnessing and lashed-on cargo are all this one flag.
   */
  attachment,
  /** Mount binding: mountOf / riderOf / isMounted / mountActor / dismount /
   *  unseat — the rider-role FACADE over `attachment`, kept for the
   *  mounted-combat vocabulary. */
  mount,
  /**
   * Capacity over any document (capacity.mjs): capacity6/load6/overCapacity
   * in sixths of a stone, capacityStone/loadStone for display. One answer for
   * a character, a monster or mount (rider included), and a container item.
   */
  capacity,
  /**
   * Money as a physical thing (money.mjs + money-logic.mjs): transferCoin —
   * the location-gated payment that lands coin on the payee's stacks and
   * makes change by the same arithmetic — with the smallest-first planner,
   * exchange terms by place, the HOUSE_OWNER sentinel and creditCoin.
   */
  money: { ...moneyLogic, ...money },
  /**
   * The compendium sidebar: where every ACKS pack sits
   * (compendium-folders.mjs). `restoreCompendiumLibrary` is the macro's call
   * and OVERRULES a Judge's arrangement; `organizeCompendiumFolders` is the
   * gentle pass that only fills an empty or dangling slot. Nothing here hides
   * a pack — every compendium a world has stays in the sidebar.
   */
  packs: {
    organizeCompendiumFolders,
    restoreCompendiumLibrary,
    fileImportedPack,
  },
  /**
   * Handing Polyglot the world's own imported languages (polyglot.mjs). The
   * system's provider already answers what a character speaks; exposed so a
   * world that imports through its own automation can refresh the selector
   * without waiting for a reload.
   */
  polyglot: { publishWorldLanguages },
  /**
   * What a creature perceives (senses.mjs): canSeeInDark for the movement
   * rules, senseProfile for the Foundry sight a token should carry.
   */
  senses,
  /** The ACKS light table and who is bearing one (light.mjs). */
  light,
  /** The ACKS senses as Foundry vision/detection modes (perception.mjs). */
  perception,
  /**
   * Writing those senses onto tokens (token-sync.mjs). `migrateWorld` is the
   * world-wide sweep the Migrate Token Vision macro drives — the only one of
   * these a Judge reaches directly; the rest are the per-scene and per-actor
   * passes the hooks run, exposed so a world with its own automation can drive
   * them at a moment this module has no hook for.
   */
  vision: {
    SETTING: SETTING_MANAGE_VISION,
    migrateWorld: migrateWorldVision,
    syncScene: syncSceneTokens,
    syncActor: syncActorTokens,
    syncNightVision: syncNightVisionTokens,
  },
  /**
   * Storage at a place (storage.mjs): goods that belong to a character but are
   * not on them. Any actor flagged a PROVIDER holds real embedded items stamped
   * with whose they are — settlements today, base camps and wagons later.
   * stash / retrieve / moveStored, plus the deletion fallback.
   */
  storage,
  /**
   * PLACES (place.mjs) — the layer above storage: what a place is inside of,
   * what living thing is in it, and how many of it there are. A location actor,
   * a provider actor and an acks-equipment container item all reduce to one
   * node shape, so a chest is the trivial case of a duchy rather than a
   * separate mechanism. Nesting (cycle-guarded), rosters, stack splitting.
   */
  places,
  /** Shared item baseline: isPhysical / isEquippable / weight6Of / … */
  itemModel,
  /** System actor reads: abilityMod / classLevel / monsterHd / hitDiceOrLevel. */
  actorRead,
  /** The printed "Follower Card": build context, render to HTML, the sheet, the
   *  template, and setSheet(actor, useCard) — the one sanctioned card↔full
   *  switch (consumed by acks-henchmen's roster bulk buttons). */
  followerCard: {
    context: followerCardContext,
    render: renderFollowerCard,
    Sheet: FollowerCardSheet,
    TEMPLATE: FOLLOWER_CARD_TEMPLATE,
    setSheet: setFollowerSheet,
    SHEET_KEY: FOLLOWER_SHEET_KEY,
  },
  /**
   * The corrected attack model (patches/attack-roll.mjs): throw as a MOVING TARGET,
   * bonuses as an AUDITABLE term stack. `PRE_ATTACK_HOOK` fires with the mutable
   * ctx (terms / throwTarget / targetAc) — the seam for effect replacer/dedup logic.
   */
  attack: { ...attackLogic, PRE_ATTACK_HOOK, POST_ATTACK_HOOK },
  // Compose a wrapper around the patched rollAttack: libWrapper lets many
  // packages wrap one method but forbids one package registering twice, and
  // every feature here is the same package.
  wrapRollAttack,
  /**
   * Weapon damage typing (damage-type.mjs): resolves a type LIVE through
   * acks-equipment's classifier — no annotate step, no second copy of the weapon
   * table — plus per-type icons and the equipped-weapon attack option list.
   */
  damageType,
});

// Core-deferral shim (acks-module-template docs/DECISIONS.md): if/when a surface
// is upstreamed into the system, `game.acks.lib` provides it and consumers
// transparently defer. Merged key-by-key, not replaced wholesale — core's
// version of a name wins; everything core does not define stays local. At
// module-evaluation time `game` is undefined, so this resolves to localImpl.
function resolveApi() {
  const fromCore = globalThis.game?.acks?.lib;
  // Movement scales are this module's own vocabulary; re-merged on every
  // resolution rather than once at init, so a later core merge cannot drop them.
  const withScales = (api) => Object.freeze({ ...api, movementScales });
  return fromCore ? withScales({ ...localImpl, ...fromCore }) : withScales(localImpl);
}

acksExtras.lib = resolveApi();

Hooks.once("init", () => {
  const api = resolveApi();
  acksExtras.lib = api;

  // The sub-type data models register HERE, never at `setup` — see
  // docs/lib/DECISIONS.md, "2026-08-05 — Sub-type data models register at
  // `init`, never at `setup`." A model missing when `initializeDocuments()`
  // runs leaves the actor's `system` a plain Object for the session.
  CONFIG.Actor.dataModels[ANIMAL_TYPE] = AnimalData;
  CONFIG.Actor.dataModels[GROUP_TYPE] = GroupData;
  CONFIG.Actor.dataModels[TEMPLATE_TYPE] = TemplateData;

  registerMountCleanup();
  attachment.registerAttachmentIndex();
  registerStorageCleanup();
  registerGroupCleanup();

  // Refuse hand-deletion of the effects this module maintains (managed-effects.mjs).
  registerManagedEffectGuard();

  // Coin is goods the system forgets to make draggable, so it cannot be dropped
  // into a container or a place at all until the row is bound.
  installGoodsDrag();

  // Vision/detection modes and the two status effects the ACKS senses need.
  // At init, not ready: a token drawn against an unregistered vision mode
  // silently falls back to basic.
  registerPerceptionModes();

  // Warm the Follower Card template so the hirelings-tab grid (rendered by
  // acks-henchmen, cross-module) has no fetch miss on first paint — and the
  // station chip, which the vehicle sheet and the formation window both
  // include as a partial by path.
  foundry.applications.handlebars
    .loadTemplates([FOLLOWER_CARD_TEMPLATE, `modules/${MODULE_ID}/templates/lib/station-chip.hbs`])
    .catch((err) => console.warn(`${MODULE_ID} | lib template preload skipped`, err));

  // The attack-roll core patch (patches/attack-roll.mjs; docs/lib/DECISIONS.md,
  // "2026-08-18 — One owner for the attack roll, and one seam for future
  // modifiers"). requiresReload: the method is patched once at ready.
  game.settings.register(MODULE_ID, "attackRollPatch", {
    name: `${LANG_PREFIX}.settings.attackRollPatch.name`,
    hint: `${LANG_PREFIX}.settings.attackRollPatch.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  // Who reads that attack card's math (roll-audience.mjs; docs/lib/DECISIONS.md,
  // "Public results, private math"). Read as each card is posted, so a change
  // takes effect on the next attack with no reload. The Reveal filter is a
  // render hook: installed here, before the chat log first draws.
  game.settings.register(MODULE_ID, ROLL_MATH_SETTING, {
    name: `${LANG_PREFIX}.settings.rollMath.name`,
    hint: `${LANG_PREFIX}.settings.rollMath.hint`,
    scope: "world",
    config: true,
    type: String,
    choices: {
      [ROLL_MATH.owners]: `${LANG_PREFIX}.settings.rollMath.owners`,
      [ROLL_MATH.everyone]: `${LANG_PREFIX}.settings.rollMath.everyone`,
    },
    default: ROLL_MATH.owners,
  });
  installMathReveal();

  // The Surprise Matrix's results on one card (patches/surprise-card.mjs; docs/lib/DECISIONS.md,
  // "2026-08-11 — Surprise results consolidate onto one card"). Read at click
  // time, so toggling takes effect on the next encounter with no reload.
  game.settings.register(MODULE_ID, SETTING_SURPRISE_CARD, {
    name: `${LANG_PREFIX}.settings.surpriseCard.name`,
    hint: `${LANG_PREFIX}.settings.surpriseCard.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // A round's initiative on one card (patches/initiative-card.mjs; docs/lib/DECISIONS.md,
  // "2026-08-24 — Initiative reuses the roll CARD, not an invented grouping").
  // Read per roll, so the toggle takes effect on the next roll.
  game.settings.register(MODULE_ID, SETTING_INITIATIVE_CARD, {
    name: `${LANG_PREFIX}.settings.initiativeCard.name`,
    hint: `${LANG_PREFIX}.settings.initiativeCard.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // Token vision and light derived from the sheet (senses.mjs / light.mjs;
  // docs/lib/MODEL.md's senses section). Off restores nothing — tokens keep
  // whatever they were last set to.
  game.settings.register(MODULE_ID, SETTING_MANAGE_VISION, {
    name: `${LANG_PREFIX}.settings.manageVision.name`,
    hint: `${LANG_PREFIX}.settings.manageVision.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () =>
      syncSceneTokens(game.scenes?.current).catch((err) => console.warn(`${MODULE_ID} | scene sense sync failed`, err)),
  });

  // Whether this module may write to game.time (world-time.mjs). Registered
  // here, not in either feature that advances the clock — see docs/lib/DECISIONS.md,
  // "The world clock has one owner, and it is lib (2026-08-04)".
  game.settings.register(MODULE_ID, SETTING_ADVANCE_WORLD_TIME, {
    name: `${LANG_PREFIX}.settings.advanceWorldTime.name`,
    hint: `${LANG_PREFIX}.settings.advanceWorldTime.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // Polyglot reads what a character speaks off the system's own language items
  // and needs nothing from us; this only tells it about the tongues a world
  // imported from its own books (polyglot.mjs).
  installPolyglotBridge();

  // What happens to goods stored at a place when that place is deleted
  // (docs/lib/API.md's storage section): a fallback default, not a rule.
  game.settings.register(MODULE_ID, DELETE_POLICY_SETTING, {
    name: `${LANG_PREFIX}.settings.storageDeletePolicy.name`,
    hint: `${LANG_PREFIX}.settings.storageDeletePolicy.hint`,
    scope: "world",
    config: true,
    type: String,
    choices: {
      return: `${LANG_PREFIX}.settings.storageDeletePolicy.return`,
      lose: `${LANG_PREFIX}.settings.storageDeletePolicy.lose`,
    },
    default: "return",
  });

  // The repair tool: lib's own checks, and the GM's way in from settings.
  // Every other feature registers its checks in its own init.
  registerLibRepairChecks();
  game.settings.registerMenu(MODULE_ID, "repairTool", {
    name: `${LANG_PREFIX}.repair.menuName`,
    label: `${LANG_PREFIX}.repair.menuLabel`,
    hint: `${LANG_PREFIX}.repair.menuHint`,
    icon: "fa-solid fa-screwdriver-wrench",
    type: RepairMenu,
    restricted: true,
  });

  // The hit-point tool's button on the Tokens layer, for the GM.
  installHpControl();

  // WHOSE DEFAULTS the world opens on — Foundry's, the system's or this
  // module's — for every seat (ui-preset.mjs; docs/lib/MODEL.md's UI preset
  // section). Registered here, during init, so the ladder's ready hook lands
  // after every other feature's own ready-time sheet registration.
  registerUiPresetSettings({ onLookChange: applyLook });
  Hooks.once("ready", () => {
    refreshSheetDefaults();
    promptUiPreset().catch((err) => console.error(`${MODULE_ID} | the UI preset prompt failed`, err));
  });

  // Which palette the ACKS surfaces draw in; stands down under `look: core`.
  // See docs/lib/MODEL.md's client-settings section.
  game.settings.register(MODULE_ID, "theme", {
    name: `${LANG_PREFIX}.settings.theme.name`,
    hint: `${LANG_PREFIX}.settings.theme.hint`,
    scope: "client",
    config: true,
    type: String,
    choices: {
      follow: `${LANG_PREFIX}.settings.theme.follow`,
      light: `${LANG_PREFIX}.settings.theme.light`,
      dark: `${LANG_PREFIX}.settings.theme.dark`,
    },
    default: "follow",
    onChange: (mode) => applyTheme(mode),
  });

  // Whose look the family draws in at all — the outer of the two look
  // settings, governing `sheetStyle` and `theme` below it. `world` (default)
  // defers to the world's UI preset via `effectiveLook()`. See docs/lib/MODEL.md's
  // client-settings section.
  game.settings.register(MODULE_ID, "look", {
    name: `${LANG_PREFIX}.settings.look.name`,
    hint: `${LANG_PREFIX}.settings.look.hint`,
    scope: "client",
    config: true,
    type: String,
    choices: {
      world: `${LANG_PREFIX}.settings.look.world`,
      book: `${LANG_PREFIX}.settings.look.book`,
      core: `${LANG_PREFIX}.settings.look.core`,
    },
    default: "world",
    onChange: () => applyLook(),
  });

  // How much of the ACKS look the SYSTEM's own windows take (both carry the
  // same palette). See docs/lib/MODEL.md's client-settings section.
  game.settings.register(MODULE_ID, "sheetStyle", {
    name: `${LANG_PREFIX}.settings.sheetStyle.name`,
    hint: `${LANG_PREFIX}.settings.sheetStyle.hint`,
    scope: "client",
    config: true,
    type: String,
    choices: {
      full: `${LANG_PREFIX}.settings.sheetStyle.full`,
      palette: `${LANG_PREFIX}.settings.sheetStyle.palette`,
    },
    default: "full",
    onChange: () => applyLook(),
  });

  // The font knob, driving --acks-fs-base (docs/lib/MODEL.md's client-settings
  // section). At 14 (the token default) the inline property is removed rather
  // than written, so a fresh client is byte-identical to no-setting.
  game.settings.register(MODULE_ID, "fontScale", {
    name: `${LANG_PREFIX}.settings.fontScale.name`,
    hint: `${LANG_PREFIX}.settings.fontScale.hint`,
    scope: "client",
    config: true,
    type: new foundry.data.fields.NumberField({ min: 12, max: 18, step: 0.5, initial: 14, nullable: false }),
    default: 14,
    onChange: (px) => applyFontScale(px),
  });

  console.log(`${MODULE_ID} | primitives ready (apiVersion ${api.apiVersion}).`);
});

/**
 * Which classes an application root should be wearing right now.
 *
 * One answer for both the render hook and the re-dress sweep, so a window
 * already open when a setting changes cannot end up dressed differently from
 * one opened a moment later. Under the `core` look, nothing is worn — see
 * docs/lib/MODEL.md's look section for why `core` and the dress classes must
 * never both hold.
 *
 * @param {boolean} owned whether the application DECLARED itself an ACKS surface.
 * @returns {{ui: boolean, palette: boolean}} which of the two dress classes belong on the root.
 */
function dressFor(owned) {
  if (effectiveLook() === "core") return { ui: false, palette: false };
  // A DECLARED surface always wears the full dress: several of this module's
  // own sheets extend a core sheet and inherit `acks`/`acks2` into their class
  // list, so `options.classes` (set once at construction) is the only signal
  // the class list itself cannot fake.
  if (owned) return { ui: true, palette: false };
  const style = game.settings.get(MODULE_ID, "sheetStyle");
  return { ui: style === "full", palette: style === "palette" };
}

/**
 * Apply the `look` / `sheetStyle` pair to the whole client, including windows
 * already open — otherwise a setting change appears to do nothing until each
 * window is closed and reopened. The `core` look also withholds
 * `body.acks-lib-sheet-theme`, the only vehicle for surfaces that are not
 * application roots (core's chat cards, every window header).
 */
function applyLook() {
  const core = effectiveLook() === "core";
  const html = document.documentElement;
  if (core) html.setAttribute("data-acks-look", "core");
  else html.removeAttribute("data-acks-look");
  document.body?.classList.toggle("acks-lib-sheet-theme", !core);
  applyRootPin(game.settings.get(MODULE_ID, "theme"));
  for (const app of foundry.applications.instances.values()) {
    const root = app.element;
    if (!root?.classList) continue;
    const owned = app.options?.classes?.includes("acks-ui");
    if (!owned && !root.classList.contains("acks") && !root.classList.contains("acks2")) continue;
    const { ui, palette } = dressFor(owned);
    root.classList.toggle("acks-ui", ui);
    root.classList.toggle("acks-palette", palette);
  }
}

/** Pin the ACKS palette from the `theme` setting, or release it to Foundry. */
function applyTheme(mode) {
  applyRootPin(mode);
}

/**
 * Write (or clear) the `data-acks-theme` pin on <html>, never <body> — see
 * docs/lib/MODEL.md's client-settings section for why the element matters.
 * Split out from applyTheme so applyLook can re-run it without the two
 * calling each other. Stands down under the `core` look, which resolves the
 * ACKS tokens to Foundry's own theme-aware variables.
 */
function applyRootPin(mode) {
  const root = document.documentElement;
  const core = effectiveLook() === "core";
  if (!core && (mode === "light" || mode === "dark")) root.setAttribute("data-acks-theme", mode);
  else root.removeAttribute("data-acks-theme");
}

/**
 * Mark every ACKS surface the SYSTEM renders as an ACKS surface, so the
 * system's own sheets and dialogs take the same colour remap as this
 * module's windows (docs/lib/MODEL.md's theming section). `acks2` is included
 * because the system's dialogs carry it without `acks`.
 */
Hooks.on("renderApplicationV2", (app, element) => {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root?.classList) return;
  const owned = app?.options?.classes?.includes("acks-ui");
  if (!owned && !root.classList.contains("acks") && !root.classList.contains("acks2")) return;
  const { ui, palette } = dressFor(owned);
  root.classList.toggle("acks-ui", ui);
  root.classList.toggle("acks-palette", palette);
});

/**
 * Lock the trash control on module-managed effect rows, wherever core lists
 * them — an actor's Effects tab and an item's own share one partial, so this
 * gates on "the sheet's document has effects" rather than on a document type.
 * The REFUSAL is the preDelete guard in managed-effects.mjs; this is only the
 * sheet declining to offer a gesture that is refused.
 */
Hooks.on("renderApplicationV2", (app, element) => {
  const root = element instanceof HTMLElement ? element : element?.[0];
  const doc = app?.document;
  if (!root?.querySelectorAll || !doc?.effects?.get) return;
  try {
    lockManagedEffectRows(doc, root);
  } catch (err) {
    console.error(`${MODULE_ID} | locking managed effect rows failed; core's controls stand`, err);
  }
});

/**
 * Drive --acks-fs-base (the family-wide type knob) from the fontScale
 * setting. At the token default (14) the inline property is removed so the
 * stylesheet value governs. The pin lands on <html>, never <body> — see
 * docs/lib/MODEL.md's client-settings section for why the element matters.
 */
function applyFontScale(px) {
  const n = Number(px);
  if (!Number.isFinite(n) || n === 14) document.documentElement.style.removeProperty("--acks-fs-base");
  else document.documentElement.style.setProperty("--acks-fs-base", `${n}px`);
}

/**
 * Give animals the system's own monster sheet — this library ships no sheet
 * of its own, since the animal schema mirrors the monster's field paths. A
 * floor, not the final answer: monsters/module.mjs registers the Full
 * Monster sheet for `animal` too, later in the same hook, and takes the
 * default over. Registered at ready, not init, because `CONFIG.Actor.sheetClasses`
 * is empty until then. A lookup that fails leaves the type with no sheet
 * rather than failing the world, and the console says which.
 */
Hooks.once("ready", () => {
  // Load the importer's packs, so the synchronous library reads every sheet
  // makes are complete from the first render.
  registerLibraryWarm();

  // File any compendium that has no folder, or names one that is gone — the
  // system's into the system's own declared tree, this module's into this
  // module's. A slot that resolves is a Judge's arrangement and is left; the
  // macro is what overrules (compendium-folders.mjs).
  organizeCompendiumFolders().catch((err) =>
    console.error(`${MODULE_ID} | filing the ACKS compendiums failed`, err),
  );

  // `body.acks-lib-sheet-theme` is the marker that ACKS surfaces are themed
  // (docs/lib/MODEL.md's theming section); it stays a class so these rules
  // out-specify the system's own unscoped window-header selectors.
  applyLook();
  applyFontScale(game.settings.get(MODULE_ID, "fontScale"));

  // Bind every caption in every rendered window to the control it fronts —
  // this module's windows, the system's sheets, and Foundry's own config
  // windows alike (docs/lib/MODEL.md's label-association section covers the
  // ready-vs-import registration order this relies on).
  Hooks.on("renderApplicationV2", (app, element) => associateLabels(element, { seed: app.id }));

  if (game.system?.id !== "acks") return;

  // Own the attack roll (throw = target, bonuses = auditable stack); see
  // docs/lib/DECISIONS.md, "2026-08-18 — One owner for the attack roll, and
  // one seam for future modifiers". At ready: the system's Actor class is
  // final here.
  const useAttackModel = game.settings.get(MODULE_ID, "attackRollPatch");
  installAttackRollPatch(useAttackModel);
  if (useAttackModel) installAttackDisplayPatch();

  // The consolidated surprise card; see docs/lib/DECISIONS.md, "2026-08-11 —
  // Surprise results consolidate onto one card".
  installSurpriseCardPatch();

  // The consolidated initiative card; see docs/lib/DECISIONS.md, "2026-08-24
  // — Initiative reuses the roll CARD, not an invented grouping".
  installInitiativeCardPatch();

  // The round counter's guard against a combatant whose actor was deleted;
  // see docs/lib/DECISIONS.md, "2026-09-07 — extras guards the system's
  // round counter, and the guard is scoped to core's synchronous prefix".
  installCombatRoundPatch();
  const registered = CONFIG.Actor?.sheetClasses?.monster ?? {};
  const entries = Object.values(registered);
  const defaulted = entries.find((e) => e.default) ?? null;
  const MonsterSheet = defaulted?.cls ?? entries[0]?.cls ?? null;
  // A failed lookup costs only the ANIMAL_TYPE alias its sheet; the rest of
  // this hook's registrations and sweeps still run.
  if (!MonsterSheet) {
    console.warn(`${MODULE_ID} | could not resolve the acks monster sheet; ${ANIMAL_TYPE} has no sheet.`);
  } else {
    // Named so an ambiguous pick (no entry flagged default) is diagnosable.
    if (!defaulted && entries.length > 1) {
      console.warn(`${MODULE_ID} | no monster sheet is flagged default; ${ANIMAL_TYPE} adopts ${MonsterSheet.name} by registry order.`);
    }
    foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, MonsterSheet, {
      types: [ANIMAL_TYPE],
      makeDefault: true,
      label: "ACKS-LIB.sheet.animal",
    });
    console.log(`${MODULE_ID} | ${ANIMAL_TYPE} uses the system's monster sheet.`);
  }

  // The group ships its OWN sheet: a stack is a headcount and a roster, not a
  // stat block, so unlike the animal it does not borrow the monster sheet.
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, GroupSheet, {
    types: [GROUP_TYPE],
    makeDefault: true,
    label: "ACKS-LIB.sheet.group",
  });
  console.log(`${MODULE_ID} | ${GROUP_TYPE} sheet registered.`);

  // The template is a BUILDER, not a stat block: axis pins, an optional base
  // actor, and Generate (see apps/template-sheet.mjs).
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, TemplateSheet, {
    types: [TEMPLATE_TYPE],
    makeDefault: true,
    label: "ACKS-LIB.sheet.template",
  });
  console.log(`${MODULE_ID} | ${TEMPLATE_TYPE} sheet registered.`);

  // The Follower Card for a CHARACTER is an alternative, never the type
  // default — a PC keeps their own sheet. It becomes the per-instance default
  // for retainers via flags.core.sheetClass (see the hooks below).
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, FollowerCardSheet, {
    types: ["character"],
    makeDefault: false,
    label: "ACKS-LIB.sheet.follower",
  });

  // For a MONSTER it is the type default, and the extended block opens behind
  // it. `makeDefault` decides only where an actor with no recorded choice
  // lands, so this changes no stored document.
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, FollowerCardSheet, {
    types: ["monster"],
    makeDefault: true,
    label: "ACKS-LIB.sheet.follower",
  });
  console.log(`${MODULE_ID} | FollowerCardSheet registered (character; default for monster).`);

  // One-time GM sweep, migrating a world's OWN former default (see
  // docs/lib/DECISIONS.md, "The monster type default migrates its own former
  // pin, once (2026-09-22)"). Rewrites only the one exact string this
  // module's own past registration wrote.
  if (game.user.isGM) {
    const stored = game.settings.get("core", "sheetClasses") ?? {};
    if (stored?.Actor?.monster === `${MODULE_ID}.FullMonsterSheet`) {
      const next = foundry.utils.deepClone(stored);
      next.Actor.monster = FOLLOWER_SHEET_KEY;
      game.settings
        .set("core", "sheetClasses", next)
        .then(() => console.log(`${MODULE_ID} | monsters now open on the Follower Card; expand for the full block.`))
        .catch((err) => console.error(`${MODULE_ID} | monster landing-sheet migration failed`, err));
    }
  }

  // One-time GM sweep: existing retainers with no explicit sheet choice adopt
  // the card (docs/lib/FOLLOWER-CARD.md's "Default-for-retainers" section).
  if (game.user.isGM) {
    const updates = game.actors
      .filter((a) => FOLLOWER_TYPES.has(a.type) && a.system?.retainer?.enabled && !a.getFlag("core", "sheetClass"))
      .map((a) => ({ _id: a.id, "flags.core.sheetClass": FOLLOWER_SHEET_KEY }));
    if (updates.length) {
      Actor.updateDocuments(updates).catch((err) => console.error(`${MODULE_ID} | follower-card sweep failed`, err));
    }
  }
});

/* -------------------------------------------- */
/*  Token senses & light                        */
/* -------------------------------------------- */

// A creature's sight follows its sheet, so every route that can change what
// it perceives re-derives the token. `syncActorTokens` enforces the primary
// GM alone, since token updates are GM writes.
Hooks.on("createToken", (tokenDoc) => {
  if (game.system?.id !== "acks" || !isPrimaryGM()) return;
  syncTokenFromActor(tokenDoc).catch((err) => console.error(`${MODULE_ID} | token sense sync failed`, err));
});

for (const hook of ["createItem", "updateItem", "deleteItem"]) {
  Hooks.on(hook, (item) => {
    if (game.system?.id !== "acks" || !item?.parent?.id) return;
    syncActorTokens(item.parent).catch((err) => console.warn(`${MODULE_ID} | actor sense sync failed`, err));
  });
}

for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
  Hooks.on(hook, (effect) => {
    const actor = effect?.parent instanceof Actor ? effect.parent : effect?.parent?.parent;
    if (game.system?.id !== "acks" || !actor?.id) return;
    syncActorTokens(actor).catch((err) => console.warn(`${MODULE_ID} | actor sense sync failed`, err));
  });
}

// A stat block edited on the Full Monster Sheet changes the creature's vision
// modes too. Matches on `flags.${MODULE_ID}` only, never `system` — see
// docs/lib/DECISIONS.md, "A sense-and-light re-derive matches on its own flag,
// never on `system` (2026-09-22)".
Hooks.on("updateActor", (actor, changes) => {
  if (game.system?.id !== "acks") return;
  if (!foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) return;
  syncActorTokens(actor).catch((err) => console.warn(`${MODULE_ID} | actor sense sync failed`, err));
});

/* Catch up a scene the GM was not on when any of the above happened. */
Hooks.on("canvasReady", (canvas) => {
  if (game.system?.id !== "acks") return;
  syncSceneTokens(canvas?.scene).catch((err) => console.error(`${MODULE_ID} | scene sense sync failed`, err));
});

// Night Vision's reach depends on a light nobody's sheet tracks, so these
// hooks watch the light instead (docs/lib/MODEL.md's senses section covers
// why this is debounced and narrowed to the night-vision cast).
const relightNightVision = foundry.utils.debounce((scene) => {
  syncNightVisionTokens(scene).catch((err) => console.error(`${MODULE_ID} | night vision sync failed`, err));
}, 250);

for (const hook of ["createAmbientLight", "updateAmbientLight", "deleteAmbientLight", "deleteToken"]) {
  Hooks.on(hook, (doc) => {
    if (game.system?.id !== "acks") return;
    relightNightVision(doc?.parent);
  });
}

Hooks.on("updateToken", (tokenDoc, changes) => {
  if (game.system?.id !== "acks") return;
  // Only a move, a light change, or hidden toggling can change who stands in
  // light. The sync's own light writes land here too and should — but they
  // settle rather than loop, since the next pass finds every delta already
  // satisfied.
  if (!("x" in changes || "y" in changes || "light" in changes || "hidden" in changes)) return;
  relightNightVision(tokenDoc?.parent);
});

// Retainers default to the Follower Card, keyed on the core retainer flag
// (docs/lib/FOLLOWER-CARD.md's "Default-for-retainers" section). preCreate
// catches actors born as retainers; updateActor below catches a plain actor
// flipped into service.
Hooks.on("preCreateActor", (doc, data) => {
  if (game.system?.id !== "acks") return;
  if (!FOLLOWER_TYPES.has(doc.type)) return;
  if (!foundry.utils.getProperty(data ?? {}, "system.retainer.enabled")) return;
  if (foundry.utils.getProperty(data ?? {}, "flags.core.sheetClass")) return;
  doc.updateSource({ "flags.core.sheetClass": FOLLOWER_SHEET_KEY });
});

Hooks.on("updateActor", (actor, changes, options, userId) => {
  if (userId !== game.userId) return; // only the originating client writes, once
  if (game.system?.id !== "acks") return;
  if (!FOLLOWER_TYPES.has(actor.type)) return;
  if (foundry.utils.getProperty(changes, "system.retainer.enabled") !== true) return;
  if (actor.getFlag("core", "sheetClass")) return;
  actor.update({ "flags.core.sheetClass": FOLLOWER_SHEET_KEY });
});

/**
 * Switch one actor between the Follower Card and its full system sheet.
 *
 * The per-instance choice is `flags.core.sheetClass` — the same flag core's
 * own Sheet Configuration dialog writes, so the two surfaces can never
 * disagree. "Full sheet" DELETES the flag rather than writing the system
 * sheet's id: absence means "the type's default", which keeps following the
 * default if it ever changes. An open sheet is closed, the resolver cache
 * dropped (ClientDocument#sheet memoizes), and re-opened as the new face.
 *
 * @param {Actor} actor
 * @param {boolean} useCard
 * @returns {Promise<boolean>} whether anything changed
 */
export async function setFollowerSheet(actor, useCard) {
  if (!actor || !FOLLOWER_TYPES.has(actor.type) || !actor.isOwner) return false;
  const isCard = actor.getFlag("core", "sheetClass") === FOLLOWER_SHEET_KEY;
  if (isCard === !!useCard) return false;
  const wasOpen = actor.sheet?.rendered ?? false;
  if (wasOpen) await actor.sheet.close();
  actor._sheet = null;
  if (useCard) await actor.setFlag("core", "sheetClass", FOLLOWER_SHEET_KEY);
  else await actor.unsetFlag("core", "sheetClass");
  actor._sheet = null;
  if (wasOpen) actor.sheet?.render(true);
  return true;
}

/* Right-click a directory entry to flip its face — the discoverable version
 * of core's buried Sheet Configuration dialog, for exactly one decision. */
Hooks.on("getActorContextOptions", (application, options) => {
  if (game.system?.id !== "acks") return;
  const actorFor = (li) => game.actors.get(li?.dataset?.entryId);
  options.push(
    {
      label: "ACKS-LIB.sheet.useCard",
      icon: '<i class="fa-solid fa-address-card"></i>',
      visible: (li) => {
        const actor = actorFor(li);
        return !!actor && actor.isOwner && FOLLOWER_TYPES.has(actor.type) && actor.getFlag("core", "sheetClass") !== FOLLOWER_SHEET_KEY;
      },
      onClick: (_event, li) => setFollowerSheet(actorFor(li), true),
    },
    {
      label: "ACKS-LIB.sheet.useFull",
      icon: '<i class="fa-solid fa-file-lines"></i>',
      visible: (li) => {
        const actor = actorFor(li);
        return !!actor && actor.isOwner && actor.getFlag("core", "sheetClass") === FOLLOWER_SHEET_KEY;
      },
      onClick: (_event, li) => setFollowerSheet(actorFor(li), false),
    },
  );
});
