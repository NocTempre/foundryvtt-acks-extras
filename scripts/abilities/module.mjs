/**
 * ACKS II — Abilities.
 *
 * Extends the core `ability` item (proficiencies / class powers / skills /
 * monster abilities) with a structured, level-aware EFFECT model stored at
 * `flags["acks-extras"].extras` (see ability-extras.mjs) and an alternate
 * ability sheet that views and edits it. Nothing mutates the acks system; the
 * effect vocabulary comes from the lib subsystem.
 */
import { acksExtras, assertAcksSystem } from "../namespace.mjs";
import { MODULE_ID, FLAG_EXTRAS, ABILITY_TYPE } from "./constants.mjs";
import AbilityExtras, { selectionsOf } from "./ability-extras.mjs";
import { createAbilitySheet } from "./ability-sheet.mjs";
import { rankOf, scalesFor, targetOf, rollsOf, rollAbility, defaultKeyOf, setDefaultKey, throwModifiers, scoreTerm } from "./ability-rolls.mjs";
import { registerRollWrap } from "./roll-wrap.mjs";
import { registerSheetRolls } from "./sheet-rolls.mjs";
import { companionSlots, openCompanionPicker, bindCompanion, releaseCompanion, registerCompanions } from "./companions.mjs";
import { coreItemSheetFor } from "../lib/util.mjs";

/** The dynamically-created sheet class (base is resolved at ready). */
let AcksAbilitySheet = null;

Hooks.once("init", () => {
  // Public API for consumer modules (the importer writes this flag on import;
  // other modules read the effect model to drive automation).
  const api = {
    MODULE_ID,
    FLAG_EXTRAS,
    ABILITY_TYPE,
    AbilityExtras,
    /** Read the extended effect model for an ability item (an AbilityExtras instance). */
    getExtras: (item) => AbilityExtras.fromItem(item),
    // Rank and target semantics. Consumers call these rather than re-deriving
    // them — `extras.qty` is a count, not a rank.
    rankOf,
    scalesFor,
    targetOf,
    // What the character's OTHER abilities do to this one's throws. `targetOf`
    // already folds the unconditional ones in; this is how a consumer sees the
    // parts, including the conditioned ones that are stated rather than
    // applied.
    throwModifiers,
    // The ability score a throw is written against, resolved for the character
    // holding it. `targetOf` has already folded it in; this is how a consumer
    // shows the term rather than only the number it produced.
    scoreTerm,
    // Every roll an ability offers, in one shape — this module's store, with
    // core's singleton folded in when it has not been edited here yet. The only
    // read path: never assemble an ability's rolls from `system.roll`.
    rollsOf,
    /** Roll one of them by key (omit the key for the ability's default throw). */
    rollAbility,
    // WHICH throw a bare roll reaches. An ability offering several has one of
    // them chosen — by the sheet's cycle control, or by a consumer here — and
    // every route that cannot name a key honours it.
    defaultKeyOf,
    setDefaultKey,
    // The picks a character's copy records (Martial Training's weapon group,
    // Fighting Style Specialization's style, …). Reads the stored `selections`
    // array and absorbs the legacy "(X)" name-suffix convention — consumers
    // must never parse item names themselves.
    selectionsOf,
    // The companion SLOTS a character's abilities confer, and the gestures on
    // them: choose (the picker), bind (a chosen creature), release. The slot's
    // pointer is the effect's `actorUuid`; these are its only writers from the
    // table side — the importer's fill pass is the other.
    companionSlots,
    openCompanionPicker,
    bindCompanion,
    releaseCompanion,
    get AcksAbilitySheet() {
      return AcksAbilitySheet;
    },
  };
  acksExtras.abilities = api;
  registerCompanions();

  // Best-effort template preload (the base sheet's own parts preload with the system).
  try {
    foundry.applications.handlebars.loadTemplates([
      `modules/${MODULE_ID}/templates/abilities/tab-mechanics.hbs`,
      `modules/${MODULE_ID}/templates/abilities/roll-editor.hbs`,
      // Resolved dynamically by core's description.hbs, so it must be
      // pre-registered — a partial reached through a context function is not
      // discovered by the part loader.
      `modules/${MODULE_ID}/templates/abilities/details-ability.hbs`,
    ]);
  } catch (err) {
    console.warn(`${MODULE_ID} | template preload skipped`, err);
  }
  console.log(`${MODULE_ID} | initialised (ability effect model ready)`);
});

/*
 * Sheet registration happens at READY, not init: Foundry defers every
 * DocumentSheetConfig.registerSheet call made before `game.ready` into a pending
 * queue, so CONFIG.Item.sheetClasses is EMPTY during init and the system's
 * ability sheet — our base class — can only be resolved here.
 */
Hooks.once("ready", async () => {
  if (!assertAcksSystem("the ACKS Ability sheet expects acks ability items.")) return;
  const Base = coreItemSheetFor(ABILITY_TYPE);
  if (!Base) {
    console.error(`${MODULE_ID} | could not resolve the acks ability sheet; ACKS Ability sheet NOT registered.`);
    return;
  }
  // tab-mechanics.hbs folds in the system's Active Effects partial, which
  // resolves only once the system registers it — lazily, with its own sheets
  // — so opening an ability sheet first after a reload throws. Preloaded
  // here; degrades to rendering without the block if the system renames it.
  const AE_PARTIAL = "systems/acks/templates/items/v2/common/item-active-effects.hbs";
  try {
    await foundry.applications.handlebars.loadTemplates([AE_PARTIAL]);
  } catch (err) {
    globalThis.Handlebars?.registerPartial?.(AE_PARTIAL, "");
    console.warn(`${MODULE_ID} | the system no longer ships ${AE_PARTIAL}; the Mechanics tab renders without the Active Effects block.`, err);
  }
  // Routes every core entry to an ability roll through rollAbility().
  registerRollWrap();
  // Puts a control for each throw on the character sheet.
  registerSheetRolls();

  AcksAbilitySheet = createAbilitySheet(Base);
  // The default for every ability item; the system's plain sheet stays
  // selectable per item. See docs/abilities/DECISIONS.md, "The extended sheet
  // is the default".
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Item, MODULE_ID, AcksAbilitySheet, {
    types: [ABILITY_TYPE],
    makeDefault: true,
    label: game.i18n.localize("ACKS-ABILITIES.sheet.ability"),
  });
  console.log(`${MODULE_ID} | ACKS Ability sheet registered (default for ${ABILITY_TYPE} items).`);
});
