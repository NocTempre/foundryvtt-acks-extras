/* global game, foundry, Hooks, CONFIG, Actor */
/**
 * ACKS II — Full Monster Sheet.
 *
 * At ready we resolve the system's own registered monster sheet and register a
 * SUBCLASS of it — adding tabs for the extended stat block — as the DEFAULT
 * sheet for `monster` and for the library's `animal` sub-type. No new document
 * sub-type; nothing mutates the acks system. Extended data lives in
 * `flags["acks-extras"].extras`.
 *
 * Safe to default: the subclass keeps every tab the system's sheet defines, so
 * enabling this module adds the extended stat block and takes nothing away. The
 * system's plain sheet stays selectable per-actor from Sheet Configuration.
 *
 * The animal borrows this sheet for the same reason it borrows the system's:
 * its combat block mirrors the monster's field paths exactly (lib/data/
 * animal-data.mjs), so a monster sheet reads an animal unchanged. lib registers
 * the system's plain sheet for `animal` first; this registration runs later
 * (monsters is imported last) and takes the default over from it.
 */
import { acksExtras, assertAcksSystem } from "../namespace.mjs";
import { MODULE_ID, FLAG_EXTRAS, MONSTER_TYPE } from "./constants.mjs";
import { createFullMonsterSheet } from "./monster-sheet.mjs";
import MonsterExtras from "./monster-extras.mjs";
import { registerItemAnnotations } from "./item-annotations.mjs";
import * as config from "./config.mjs";

/** The dynamically-created sheet class (base is resolved at init). */
let FullMonsterSheet = null;

/** The actor types the sheet was actually registered for (resolved at ready). */
let sheetTypes = [MONSTER_TYPE];

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

/**
 * Resolve the system's default monster sheet class (our base to extend).
 *
 * Only the SYSTEM's sheets are candidates: this module registers into the same
 * map — this sheet, and lib's Follower Card — and a resolution that accepted one
 * of ours would subclass this module's own output, growing a fresh layer on
 * every reload. Never widen this to the whole registry.
 */
function resolveMonsterSheetBase() {
  const registered = CONFIG.Actor?.sheetClasses?.monster ?? {};
  const entries = Object.entries(registered)
    .filter(([key]) => !key.startsWith(`${MODULE_ID}.`))
    .map(([, entry]) => entry);
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
  if (!assertAcksSystem("the Full Monster sheet expects acks monster actors.")) return;
  const Base = resolveMonsterSheetBase();
  if (!Base) {
    console.error(`${MODULE_ID} | could not resolve the acks monster sheet; Full Monster sheet NOT registered.`);
    return;
  }
  FullMonsterSheet = createFullMonsterSheet(Base);
  // The `animal` sub-type belongs to lib; read it off the published API rather
  // than importing lib here, so an absent library degrades to monsters alone
  // instead of throwing.
  const animalType = acksExtras.lib?.ANIMAL_TYPE;
  sheetTypes = animalType ? [MONSTER_TYPE, animalType] : [MONSTER_TYPE];
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, FullMonsterSheet, {
    types: sheetTypes,
    makeDefault: true,
    label: game.i18n.localize("ACKS-MONSTERS.sheet.full"),
  });
  console.log(`${MODULE_ID} | Full Monster sheet registered (default for ${sheetTypes.join("/")}).`);
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
    visible: (li) => !!FullMonsterSheet && sheetTypes.includes(findActor(li)?.type),
    callback: (li) => {
      const actor = findActor(li);
      if (actor && FullMonsterSheet) new FullMonsterSheet({ document: actor }).render(true);
    },
  });
});
