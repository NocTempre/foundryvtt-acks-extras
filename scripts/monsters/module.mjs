/* global game, foundry, Hooks, CONFIG, Actor */
/**
 * ACKS II — Full Monster Sheet.
 *
 * At init we resolve the system's own registered monster sheet and register an
 * alternate (non-default) SUBCLASS of it that adds tabs for the extended stat
 * block. No new document sub-type; nothing mutates the acks system. Extended
 * data lives in `flags["acks-monsters"].extras`. Toggle the sheet per-actor from
 * the actor's Sheet Configuration.
 */
import { acksExtras } from "../namespace.mjs";
import { MODULE_ID, FLAG_EXTRAS, MONSTER_TYPE } from "./constants.mjs";
import { createFullMonsterSheet } from "./monster-sheet.mjs";
import MonsterExtras from "./monster-extras.mjs";
import { registerItemAnnotations } from "./item-annotations.mjs";
import * as config from "./config.mjs";

/** The dynamically-created sheet class (base is resolved at init). */
let FullMonsterSheet = null;

/** Register the module's Handlebars helpers. */
function registerHelpers() {
  const Handlebars = globalThis.Handlebars;
  if (!Handlebars) return;
  // Value-or-dash that treats a real 0 as a value (only null/""/undefined dash).
  Handlebars.registerHelper("acksExtrasVal", (value, dash) => {
    const fallback = typeof dash === "string" ? dash : "—";
    return value === null || value === undefined || value === "" ? fallback : value;
  });
  // Membership test for <multi-checkbox> option `selected` state.
  Handlebars.registerHelper("acksExtrasHas", (list, key) => Array.isArray(list) && list.includes(key));
}

/** Resolve the system's default monster sheet class (our base to extend). */
function resolveMonsterSheetBase() {
  const registered = CONFIG.Actor?.sheetClasses?.monster ?? {};
  const entries = Object.values(registered);
  return entries.find((e) => e.default)?.cls ?? entries[0]?.cls ?? null;
}

Hooks.once("init", () => {
  registerHelpers();
  registerItemAnnotations();

  // Public API for consumer modules (which add behavior on this stored data).
  const api = {
    MODULE_ID,
    FLAG_EXTRAS,
    get FullMonsterSheet() {
      return FullMonsterSheet;
    },
    MonsterExtras,
    config,
    /** Read the extended stat block for an actor (a MonsterExtras instance). */
    getExtras: (actor) => MonsterExtras.fromActor(actor),
  };
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = acksExtras;
  acksExtras.monsters = api;

  // Best-effort template preload (added tabs; base tabs preload with the system).
  try {
    const T = `modules/${MODULE_ID}/templates/monsters`;
    foundry.applications.handlebars.loadTemplates([
      `${T}/tab-classification.hbs`,
      `${T}/tab-attacks.hbs`,
      `${T}/tab-abilities.hbs`,
      `${T}/tab-inventory.hbs`,
      `${T}/tab-spoils.hbs`,
      `${T}/tab-defenses.hbs`,
      `${T}/tab-ecology.hbs`,
      `${T}/tab-henchman.hbs`,
      `${T}/tab-description.hbs`,
    ]);
  } catch (err) {
    console.warn(`${MODULE_ID} | template preload skipped`, err);
  }
});

/*
 * Sheet registration happens at READY, not init: Foundry v14 defers every
 * DocumentSheetConfig.registerSheet call made before `game.ready` into a
 * pending queue that is only flushed by DocumentSheetConfig.initializeSheets()
 * (late in setupGame). CONFIG.Actor.sheetClasses is therefore EMPTY during
 * init/setup and the system's monster sheet — our base class — can only be
 * resolved here. Registering at ready takes the immediate (non-queued) path.
 */
Hooks.once("ready", () => {
  if (game.system?.id !== "acks") {
    console.warn(`${MODULE_ID} | Active system is not "acks"; the Full Monster sheet expects acks monster actors.`);
    return;
  }
  const Base = resolveMonsterSheetBase();
  if (!Base) {
    console.error(`${MODULE_ID} | could not resolve the acks monster sheet; Full Monster sheet NOT registered.`);
    return;
  }
  FullMonsterSheet = createFullMonsterSheet(Base);
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, FullMonsterSheet, {
    types: [MONSTER_TYPE],
    makeDefault: false,
    label: game.i18n.localize("ACKS-MONSTERS.sheet.full"),
  });
});

/* Actor-directory convenience: open the Full Monster sheet directly. */
Hooks.on("getActorContextOptions", (_directory, options) => {
  const findActor = (li) => {
    const el = li instanceof HTMLElement ? li : li?.[0];
    const id = el?.dataset?.entryId ?? el?.dataset?.documentId;
    return id ? game.actors.get(id) : null;
  };
  options.push({
    label: "ACKS-MONSTERS.context.openFull",
    icon: '<i class="fa-solid fa-dragon"></i>',
    visible: (li) => findActor(li)?.type === MONSTER_TYPE && !!FullMonsterSheet,
    callback: (li) => {
      const actor = findActor(li);
      if (actor && FullMonsterSheet) new FullMonsterSheet({ document: actor }).render(true);
    },
  });
});
