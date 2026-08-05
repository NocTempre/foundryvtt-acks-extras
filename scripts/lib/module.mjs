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
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { isPrimaryGM } from "./util.mjs";
import * as vocab from "./vocab.mjs";
import * as fields from "./fields.mjs";
import * as tables from "./tables.mjs";
import * as services from "./services.mjs";
import * as itemModel from "./item-model.mjs";
import * as mount from "./mount.mjs";
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
import { installAttackRollPatch, wrapRollAttack, PRE_ATTACK_HOOK } from "./patches/attack-roll.mjs";
import { installAttackDisplayPatch } from "./patches/attack-display.mjs";
import { installGoodsDrag } from "./patches/goods-drag.mjs";
import * as senses from "./senses.mjs";
import * as light from "./light.mjs";
import * as perception from "./perception.mjs";
import { registerPerceptionModes } from "./perception.mjs";
import {
  SETTING_MANAGE_VISION,
  syncActorTokens,
  syncSceneTokens,
  syncTokenFromActor,
} from "./token-sync.mjs";
import { SETTING_ADVANCE_WORLD_TIME } from "./world-time.mjs";

/** The actor sub-types this library adds to the system. */
export const ANIMAL_TYPE = `${MODULE_ID}.animal`;
export const GROUP_TYPE = `${MODULE_ID}.group`;
export const TEMPLATE_TYPE = `${MODULE_ID}.template`;

/**
 * The Follower Card is the per-instance default sheet for RETAINERS (hirelings) of
 * these types — keyed on the core `system.retainer.enabled` flag, so one rule
 * covers character AND monster hirelings without depending on acks-henchmen.
 */
const FOLLOWER_TYPES = new Set(["character", "monster"]);
const FOLLOWER_SHEET_KEY = `${MODULE_ID}.FollowerCardSheet`;

/** The library's own implementation of its API surface. */
const localImpl = Object.freeze({
  apiVersion: 12,
  vocab,
  fields,
  resolveLevelValue,
  tables,
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
  /** Mount binding: mountOf / riderOf / isMounted / mountActor / dismount / unseat. */
  mount,
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
  attack: { ...attackLogic, PRE_ATTACK_HOOK },
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

// Core-deferral shim (FAMILY.md §3d): if/when a surface is upstreamed into the
// system, `game.acks.lib` provides it and consumers transparently defer. At
// module-evaluation time `game` is undefined, so this resolves to localImpl.
//
// MERGED, not replaced: the system may upstream ONE surface (it currently has
// none) long before it has all of them, and swapping wholesale would take the
// rest of this library away with it. Core's version of a name wins; everything
// core does not define stays local.
function resolveApi() {
  const fromCore = globalThis.game?.acks?.lib;
  return fromCore ? Object.freeze({ ...localImpl, ...fromCore }) : localImpl;
}

acksExtras.lib = resolveApi();

Hooks.once("init", () => {
  const api = resolveApi();
  acksExtras.lib = api;

  registerMountCleanup();
  registerStorageCleanup();
  registerGroupCleanup();

  // Coin is goods the system forgets to make draggable, so it cannot be dropped
  // into a container or a place at all until the row is bound.
  installGoodsDrag();

  // Vision/detection modes and the two status effects the ACKS senses need.
  // At init, not ready: a token drawn against an unregistered vision mode
  // silently falls back to basic.
  registerPerceptionModes();

  // Warm the Follower Card template so the hirelings-tab grid (rendered by
  // acks-henchmen, cross-module) has no fetch miss on first paint.
  foundry.applications.handlebars.loadTemplates([FOLLOWER_CARD_TEMPLATE]).catch(() => {});

  // The attack-roll core patch (patches/attack-roll.mjs). World-scoped so the
  // whole table rolls one model; requiresReload because the method is patched
  // once at ready.
  game.settings.register(MODULE_ID, "attackRollPatch", {
    name: `${LANG_PREFIX}.settings.attackRollPatch.name`,
    hint: `${LANG_PREFIX}.settings.attackRollPatch.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  // Token vision and light derived from the sheet (senses.mjs / light.mjs).
  // World-scoped: what a creature can see is a table-wide fact, and half a
  // table running with the system's stock 60' monster sight would see different
  // things in the same corridor. Off restores nothing — tokens keep whatever
  // they were last set to, which is the honest no-op.
  game.settings.register(MODULE_ID, SETTING_MANAGE_VISION, {
    name: `${LANG_PREFIX}.settings.manageVision.name`,
    hint: `${LANG_PREFIX}.settings.manageVision.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => syncSceneTokens(game.scenes?.current).catch(() => {}),
  });

  // Whether this module may write to game.time (world-time.mjs). Registered
  // here rather than in either feature that advances the clock: dungeon turns
  // and the location sheet's week button spend the same shared resource, so one
  // key answers for both and neither can drift a default the other reads.
  game.settings.register(MODULE_ID, SETTING_ADVANCE_WORLD_TIME, {
    name: `${LANG_PREFIX}.settings.advanceWorldTime.name`,
    hint: `${LANG_PREFIX}.settings.advanceWorldTime.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // What happens to goods stored at a place when that place is deleted. A
  // FALLBACK, not a rule: returning them keeps a GM tidying the actor directory
  // from wiping the party's belongings, but a campaign where a sacked city
  // really does take your warehouse with it sets "lose".
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

  // WHICH PALETTE the ACKS surfaces draw in. Foundry's own colour scheme is the
  // default source of truth; this only exists so a player can hold the ACKS look
  // steady while the rest of their client goes the other way.
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

  // HOW MUCH of the ACKS look the SYSTEM's own windows take. Not whether they
  // follow your colour scheme — both settings carry the same palette, so a dark
  // seat is dark either way. Full dress restyles the furniture too and needs a
  // wider sheet for it; palette keeps core's own layout and width.
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
    onChange: () => redressOpenSheets(),
  });

  // THE font knob. Every ACKS surface (follower card, module apps, and — with
  // the theme on — the system sheets) derives its sizes from --acks-fs-base via
  // the token scale, so one inline declaration on the root element resizes the
  // family. Inline style outranks the :root rule; 14 matches the token default,
  // so at 14 the property is REMOVED and the stylesheet value rules (a fresh
  // client is byte-identical to no-setting). Foundry's UI scale compounds on top.
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
 * Register the animal data model in `setup`, NOT `init`.
 *
 * The system is not modified: this ADDS a type alongside its own, declared in
 * module.json `documentTypes` and given its model here.
 *
 * WHY setup and not init: acks-lib is `library: true`, so Foundry loads it
 * before dependent modules and runs its `init` hook FIRST — before Foundry
 * finalizes `CONFIG.Actor.dataModels` from the manifests' `documentTypes`. An
 * assignment made in acks-lib's init is therefore overwritten by that
 * finalization (verified live: the init assignment logged success but the entry
 * was gone by `ready`, and the actor's system data fell back to a plain
 * Object). A non-library module's init runs after the finalization, which is
 * why the sibling sub-types survive. `setup` runs strictly after init for every
 * module, so the assignment lands after the overwrite and before any actor of
 * this type is constructed (world actors load at ready; imports are later
 * still).
 */
Hooks.once("setup", () => {
  CONFIG.Actor.dataModels[ANIMAL_TYPE] = AnimalData;
  CONFIG.Actor.dataModels[GROUP_TYPE] = GroupData;
  CONFIG.Actor.dataModels[TEMPLATE_TYPE] = TemplateData;
  console.log(`${MODULE_ID} | ${ANIMAL_TYPE}, ${GROUP_TYPE}, ${TEMPLATE_TYPE} data models registered.`);
});

/**
 * Re-dress the system windows that are already open when `sheetStyle` changes.
 *
 * The class is applied on render, so without this the setting appears to do
 * nothing until each sheet is closed and reopened. Swapping the classes in
 * place is enough — both are pure CSS hooks, and the min-width that the full
 * dress needs is a stylesheet rule, not a stored position.
 */
function redressOpenSheets() {
  const full = game.settings.get(MODULE_ID, "sheetStyle") !== "palette";
  for (const app of foundry.applications.instances.values()) {
    const root = app.element;
    if (!root?.classList) continue;
    if (!root.classList.contains("acks") && !root.classList.contains("acks2")) continue;
    root.classList.toggle("acks-ui", full);
    root.classList.toggle("acks-palette", !full);
  }
}

/**
 * Pin the ACKS palette from the `theme` setting, or release it to Foundry.
 *
 * `follow` REMOVES the attribute rather than writing a value: with nothing
 * pinned, the token file's dark block tracks Foundry's own `.theme-dark`
 * wherever it lands — on <body>, or on an individual application root when the
 * client's `colorScheme.applications` differs from `colorScheme.interface`.
 *
 * The pin lands on <html>, NOT <body>, for the reason applyFontScale documents
 * below and for one more: forcing LIGHT works by *withholding* the dark block
 * from the pinned element and its whole subtree (see the `:not()` guards in
 * tokens.css), so the pin has to sit above every element Foundry might mark
 * dark. A pin on <body> would not cover a per-application `.theme-dark`, which
 * sits deeper.
 */
function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === "light" || mode === "dark") root.setAttribute("data-acks-theme", mode);
  else root.removeAttribute("data-acks-theme");
}

/**
 * Mark every ACKS surface the SYSTEM renders as an ACKS surface.
 *
 * The design system is scoped to `.acks-ui` on an application root, and the
 * module's own windows declare it in their `classes`. Core's windows cannot —
 * so without this the family renders two ways: module windows in the ACKS
 * frame, the system's character sheet, item sheet, Mortal Wounds, Stat
 * Generator, Surprise Matrix and Party Overview in Foundry's default chrome.
 *
 * The class carries the design system's REMAP of Foundry's own custom
 * properties, which is the load-bearing part. The `acks` system publishes no
 * dark palette at all — its stylesheet has zero `.theme-dark` rules and its
 * sheet ground is a fixed light parchment image — so on a dark seat its widgets
 * would otherwise draw light-theme values under themed module regions injected
 * into the same sheet. Remapping at the root is what makes one window one
 * colour scheme.
 *
 * WHICH class is the `sheetStyle` setting. `acks-ui` is the full dress —
 * banners, tabs, ACKS controls; the roomier fields mean core's own sheets need
 * ~90px more than core's default width asks for, which the min-width in
 * styles/lib-sheet-theme.css supplies. `acks-palette` is the colours alone, so
 * core keeps its own field metrics and its own width.
 *
 * The setting is how much ACKS, never whether the seat works: both classes
 * carry the same light/dark remap, so a palette-only sheet follows a dark seat
 * exactly as a fully-dressed one does.
 *
 * `renderApplicationV2` reaches every ApplicationV2: core fires render hooks for
 * each class in the inheritance chain, not just the concrete one.
 *
 * `acks2` is included because the system's dialogs carry it without `acks`.
 */
Hooks.on("renderApplicationV2", (_app, element) => {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root?.classList) return;
  if (!root.classList.contains("acks") && !root.classList.contains("acks2")) return;
  const full = game.settings.get(MODULE_ID, "sheetStyle") !== "palette";
  root.classList.toggle("acks-ui", full);
  root.classList.toggle("acks-palette", !full);
});

/**
 * Drive --acks-fs-base (the family-wide type knob) from the fontScale setting.
 * At the token default (14) the inline property is REMOVED so the stylesheet
 * value governs. The pin lands on <html>, NOT <body>, and that is load-bearing:
 * the --acks-fs-* scale steps are declared at :root and custom properties
 * inherit as ALREADY-SUBSTITUTED values, so a base set on <body> would never
 * reach steps whose substitution ran at <html> (verified live — the token
 * file's dark block documents the same physics for the colour tokens).
 */
function applyFontScale(px) {
  const n = Number(px);
  if (!Number.isFinite(n) || n === 14) document.documentElement.style.removeProperty("--acks-fs-base");
  else document.documentElement.style.setProperty("--acks-fs-base", `${n}px`);
}

/**
 * Give animals the SYSTEM'S OWN monster sheet.
 *
 * This library ships no sheet, and should not: an animal is a monster you can
 * also buy, its schema mirrors the monster's field paths for exactly that
 * reason, and a second sheet rendering the same fields would be a second thing
 * to keep in step. So the system's monster sheet is registered for the animal
 * type as well.
 *
 * This is the FLOOR, not the final answer: monsters/module.mjs registers the
 * Full Monster sheet for `animal` too, later in the same hook, and takes the
 * default over. Registering here regardless is what guarantees an animal always
 * has a working sheet even when that sheet cannot be built.
 *
 * At READY, not init: Foundry defers every registerSheet call made before
 * `game.ready` into a pending queue, so `CONFIG.Actor.sheetClasses` is empty
 * during init and the system's sheet cannot be resolved yet. Same reason
 * acks-abilities resolves its base class here.
 *
 * If it cannot be found, the animal type simply has no sheet rather than the
 * world failing to load — and the console says which.
 */
Hooks.once("ready", () => {
  // UNCONDITIONAL. The class is no longer a toggle — it is the marker that says
  // "ACKS surfaces are themed", which is now always true. It stays a class
  // rather than becoming a bare selector because it is also what lets these
  // rules out-specify the system's own: core ships `.acks.sheet.actor` pairings
  // at (0,4,0), and the body class is how the override clears them.
  document.body.classList.add("acks-lib-sheet-theme");
  applyTheme(game.settings.get(MODULE_ID, "theme"));
  applyFontScale(game.settings.get(MODULE_ID, "fontScale"));

  if (game.system?.id !== "acks") return;

  // Own the attack roll (throw = target, bonuses = auditable stack) unless the
  // world opted out. At ready: the system's Actor class is final here.
  //
  // The install itself is UNCONDITIONAL: it also hosts the composition chain
  // other features register into (`wrapRollAttack`), and that chain has no other
  // reader — skipping the install would silently kill acks-equipment's
  // per-weapon RAW modifiers and ammunition spend along with the model. Never
  // gate it on this setting; the setting only chooses whose roll runs innermost.
  //
  // The display patch DOES follow the setting: it supersedes the core sheet's
  // folded Melee/Ranged boxes so the wrong number is unreachable, which only
  // holds while the model is the one rolling.
  const useAttackModel = game.settings.get(MODULE_ID, "attackRollPatch");
  installAttackRollPatch(useAttackModel);
  if (useAttackModel) installAttackDisplayPatch();
  const registered = CONFIG.Actor?.sheetClasses?.monster ?? {};
  const entries = Object.values(registered);
  const MonsterSheet = entries.find((e) => e.default)?.cls ?? entries[0]?.cls ?? null;
  if (!MonsterSheet) {
    console.warn(`${MODULE_ID} | could not resolve the acks monster sheet; ${ANIMAL_TYPE} has no sheet.`);
    return;
  }
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, MonsterSheet, {
    types: [ANIMAL_TYPE],
    makeDefault: true,
    label: "ACKS-LIB.sheet.animal",
  });
  console.log(`${MODULE_ID} | ${ANIMAL_TYPE} uses the system's monster sheet.`);

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

  // The Follower Card for a CHARACTER is an alternative, never the default — a PC
  // keeps their own sheet. It becomes the per-instance default for retainers via
  // flags.core.sheetClass (below).
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, FollowerCardSheet, {
    types: ["character"],
    makeDefault: false,
    label: "ACKS-LIB.sheet.follower",
  });

  // For a MONSTER it is the default, and the extended block is what opens behind
  // it. A monster is met before it is read up on: what a table needs on the first
  // click is the half-page you fight from, not the whole entry. `makeDefault`
  // decides only where an actor with NO recorded choice lands, so this changes no
  // stored document and leaves every hand-picked sheet alone.
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, FollowerCardSheet, {
    types: ["monster"],
    makeDefault: true,
    label: "ACKS-LIB.sheet.follower",
  });
  console.log(`${MODULE_ID} | FollowerCardSheet registered (character; default for monster).`);

  // One-time GM sweep: a world that already ran this module carries THIS MODULE'S
  // OWN former default pinned in `core.sheetClasses`, and a stored choice outranks
  // any later registration — so `makeDefault` above moves a NEW world to the card
  // and leaves every existing one opening the full sheet forever.
  //
  // Rewrite only that one exact string, the value our past registration wrote. A
  // GM who has since picked the system's sheet, or the card, holds a different
  // value and is left alone; and the rewritten value no longer matches, so this
  // cannot fire twice. Reversible from the sheet's own configuration in one click.
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

  // One-time GM sweep: existing retainers with no explicit sheet choice adopt the
  // card. Idempotent (only actors missing flags.core.sheetClass); never clobbers a
  // hand-picked sheet.
  if (game.user.isGM) {
    const updates = game.actors
      .filter((a) => FOLLOWER_TYPES.has(a.type) && a.system?.retainer?.enabled && !a.getFlag("core", "sheetClass"))
      .map((a) => ({ _id: a.id, "flags.core.sheetClass": FOLLOWER_SHEET_KEY }));
    if (updates.length) {
      Actor.updateDocuments(updates).catch((err) => console.error(`${MODULE_ID} | follower-card sweep failed`, err));
    }
  }
});

/* Retainers default to the Follower Card. Keyed on the core retainer flag so it
 * covers character AND monster hirelings without depending on acks-henchmen; only
 * ever SET (never clobbers a manual sheet choice), and never auto-reverts on
 * dismiss. preCreate catches actors born as retainers; updateActor catches a plain
 * actor flipped into service (drop-as-henchman, hires that set the flag). */
/* -------------------------------------------- */
/*  Token senses & light                        */
/* -------------------------------------------- */

/*
 * A creature's sight follows its sheet, so every route that can change what it
 * perceives re-derives the token: placing it, gaining or losing the ability or
 * effect that grants dark sight, and lighting or dousing what it carries.
 *
 * All of these run on the primary GM alone (`syncActorTokens` enforces it) —
 * token updates are GM writes, and five clients racing to make the same one is
 * how duplicate-write bugs start.
 */
Hooks.on("createToken", (tokenDoc) => {
  if (game.system?.id !== "acks" || !isPrimaryGM()) return;
  syncTokenFromActor(tokenDoc).catch((err) => console.error(`${MODULE_ID} | token sense sync failed`, err));
});

for (const hook of ["createItem", "updateItem", "deleteItem"]) {
  Hooks.on(hook, (item) => {
    if (game.system?.id !== "acks" || !item?.parent?.id) return;
    syncActorTokens(item.parent).catch(() => {});
  });
}

for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
  Hooks.on(hook, (effect) => {
    const actor = effect?.parent instanceof Actor ? effect.parent : effect?.parent?.parent;
    if (game.system?.id !== "acks" || !actor?.id) return;
    syncActorTokens(actor).catch(() => {});
  });
}

/*
 * A stat block edited on the Full Monster Sheet changes the creature's vision
 * modes, so the flag write has to re-derive too.
 *
 * Flags ONLY, deliberately: nothing in the sense or light derivation reads
 * `system`, and matching on it would rescan every scene's tokens on every hit
 * point lost — a full sweep per damage roll, for an answer that cannot have
 * changed.
 */
Hooks.on("updateActor", (actor, changes) => {
  if (game.system?.id !== "acks") return;
  if (!foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) return;
  syncActorTokens(actor).catch(() => {});
});

/* Catch up a scene the GM was not on when any of the above happened. */
Hooks.on("canvasReady", (canvas) => {
  if (game.system?.id !== "acks") return;
  syncSceneTokens(canvas?.scene).catch((err) => console.error(`${MODULE_ID} | scene sense sync failed`, err));
});

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
  else await actor.update({ "flags.core.-=sheetClass": null });
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
      name: "ACKS-LIB.sheet.useCard",
      icon: '<i class="fa-solid fa-address-card"></i>',
      condition: (li) => {
        const actor = actorFor(li);
        return !!actor && actor.isOwner && FOLLOWER_TYPES.has(actor.type) && actor.getFlag("core", "sheetClass") !== FOLLOWER_SHEET_KEY;
      },
      callback: (li) => setFollowerSheet(actorFor(li), true),
    },
    {
      name: "ACKS-LIB.sheet.useFull",
      icon: '<i class="fa-solid fa-file-lines"></i>',
      condition: (li) => {
        const actor = actorFor(li);
        return !!actor && actor.isOwner && actor.getFlag("core", "sheetClass") === FOLLOWER_SHEET_KEY;
      },
      callback: (li) => setFollowerSheet(actorFor(li), false),
    },
  );
});
