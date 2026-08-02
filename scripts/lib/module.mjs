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
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import * as vocab from "./vocab.mjs";
import * as fields from "./fields.mjs";
import * as tables from "./tables.mjs";
import * as services from "./services.mjs";
import * as itemModel from "./item-model.mjs";
import * as mount from "./mount.mjs";
import * as storage from "./storage.mjs";
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
import { FollowerCardSheet } from "./apps/follower-card-sheet.mjs";
import { followerCardContext, renderFollowerCard, FOLLOWER_CARD_TEMPLATE } from "./follower-card.mjs";
import * as attackLogic from "./attack-logic.mjs";
import * as damageType from "./damage-type.mjs";
import { installAttackRollPatch, PRE_ATTACK_HOOK } from "./patches/attack-roll.mjs";
import { installAttackDisplayPatch } from "./patches/attack-display.mjs";

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
  apiVersion: 11,
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
   * Storage at a place (storage.mjs): goods that belong to a character but are
   * not on them. Any actor flagged a PROVIDER holds real embedded items stamped
   * with whose they are — settlements today, base camps and wagons later.
   * stash / retrieve / moveStored, plus the deletion fallback.
   */
  storage,
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

globalThis.acksLib = resolveApi();

Hooks.once("init", () => {
  const api = resolveApi();
  globalThis.acksLib = api;
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = api;

  registerMountCleanup();
  registerStorageCleanup();

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

  // Printed-character-sheet theme (styles/sheet-theme.css): the stylesheet is
  // inert until this class lands on <body>, so the setting is a pure toggle.
  game.settings.register(MODULE_ID, "sheetTheme", {
    name: `${LANG_PREFIX}.settings.sheetTheme.name`,
    hint: `${LANG_PREFIX}.settings.sheetTheme.hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: (on) => document.body.classList.toggle("acks-lib-sheet-theme", on),
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
 * At READY, not init: Foundry defers every registerSheet call made before
 * `game.ready` into a pending queue, so `CONFIG.Actor.sheetClasses` is empty
 * during init and the system's sheet cannot be resolved yet. Same reason
 * acks-abilities resolves its base class here.
 *
 * If it cannot be found, the animal type simply has no sheet rather than the
 * world failing to load — and the console says which.
 */
Hooks.once("ready", () => {
  // Theme class lands once settings are readable; onChange handles the rest.
  document.body.classList.toggle("acks-lib-sheet-theme", game.settings.get(MODULE_ID, "sheetTheme"));
  applyFontScale(game.settings.get(MODULE_ID, "fontScale"));

  if (game.system?.id !== "acks") return;

  // Own the attack roll (throw = target, bonuses = auditable stack) unless the
  // world opted out. At ready: the system's Actor class is final here. The
  // display patch supersedes the core sheet's folded Melee/Ranged boxes so the
  // wrong number is unreachable — same setting, one model everywhere.
  if (game.settings.get(MODULE_ID, "attackRollPatch")) {
    installAttackRollPatch();
    installAttackDisplayPatch();
  }
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

  // The Follower Card: an ALTERNATIVE sheet for characters and monsters (never
  // makeDefault — PCs and wild monsters keep their full system sheet). It becomes
  // the per-instance default for retainers via flags.core.sheetClass (below).
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, FollowerCardSheet, {
    types: ["character", "monster"],
    makeDefault: false,
    label: "ACKS-LIB.sheet.follower",
  });
  console.log(`${MODULE_ID} | FollowerCardSheet registered (character, monster).`);

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
