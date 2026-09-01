/**
 * ACKS II — Abilities.
 *
 * Extends the core `ability` item (proficiencies / class powers / skills /
 * monster abilities) with a structured, level-aware EFFECT model stored at
 * `flags["acks-extras"].extras` (see ability-extras.mjs) and — later — an
 * alternate ability sheet to view/edit it. Nothing mutates the acks system;
 * the effect vocabulary comes from acks-lib.
 */
import { acksExtras, assertAcksSystem } from "../namespace.mjs";
import { MODULE_ID, FLAG_EXTRAS, ABILITY_TYPE } from "./constants.mjs";
import AbilityExtras, { selectionsOf } from "./ability-extras.mjs";
import { createAbilitySheet } from "./ability-sheet.mjs";
import { rankOf, scalesFor, targetOf, rollsOf, rollAbility, defaultKeyOf, setDefaultKey, throwModifiers, scoreTerm } from "./ability-rolls.mjs";
import { registerRollWrap } from "./roll-wrap.mjs";
import { registerSheetRolls } from "./sheet-rolls.mjs";

/** The dynamically-created sheet class (base is resolved at ready). */
let AcksAbilitySheet = null;

/** Resolve the system's default `ability` item sheet — our base to extend. */
function resolveAbilitySheetBase() {
  const registered = CONFIG.Item?.sheetClasses?.[ABILITY_TYPE] ?? {};
  const entries = Object.values(registered);
  const defaulted = entries.find((e) => e.default) ?? null;
  const chosen = defaulted ?? entries[0] ?? null;
  // Registry order is not a choice: when several entries compete and none is
  // flagged default, name the class adopted so a wrong base is diagnosable
  // from the console. A lone entry is unambiguous and stays quiet.
  if (!defaulted && entries.length > 1) {
    console.warn(`${MODULE_ID} | no ${ABILITY_TYPE} sheet is flagged default; extending ${chosen.cls?.name} by registry order.`);
  }
  return chosen?.cls ?? null;
}

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
    // Rank and target semantics, exposed because a consumer MUST NOT
    // re-derive them. What a count means is per-ability and changing (see
    // README, "qty is not the effective rank"), so a module that reads
    // extras.qty and treats it as rank will be wrong for every ability that
    // spends its count on a list rather than a rank. Ask here instead.
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
    // core's singleton folded in when it has not been edited here yet. THE read
    // path: never assemble an ability's rolls from `system.roll` yourself, or
    // you will see one throw where the book prints four.
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
    get AcksAbilitySheet() {
      return AcksAbilitySheet;
    },
  };
  acksExtras.abilities = api;

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
  const Base = resolveAbilitySheetBase();
  if (!Base) {
    console.error(`${MODULE_ID} | could not resolve the acks ability sheet; ACKS Ability sheet NOT registered.`);
    return;
  }
  // tab-mechanics.hbs folds the system's Active Effects block in via its
  // partial — but a Handlebars partial only resolves once REGISTERED, and the
  // system registers it lazily with its own sheets. Open an ability FIRST after
  // a reload and the partial does not exist yet, so the sheet dies ("The partial
  // ... could not be found"). Preload it ourselves; if a future system renames
  // the file, degrade to rendering the tab without the block rather than break.
  const AE_PARTIAL = "systems/acks/templates/items/v2/common/item-active-effects.hbs";
  try {
    await foundry.applications.handlebars.loadTemplates([AE_PARTIAL]);
  } catch (err) {
    globalThis.Handlebars?.registerPartial?.(AE_PARTIAL, "");
    console.warn(`${MODULE_ID} | the system no longer ships ${AE_PARTIAL}; the Mechanics tab renders without the Active Effects block.`, err);
  }
  // Core's ability roller reaches only the FIRST roll. Wrapping it is what
  // makes the character sheet, the chat card and `item.use()` agree with this
  // module's sheet instead of quietly rolling something else.
  registerRollWrap();
  // The wrap makes every route roll the right throw; this makes the sheet
  // offer more than one of them to press.
  registerSheetRolls();

  AcksAbilitySheet = createAbilitySheet(Base);
  // DEFAULT, because a sheet nobody selects shows nobody the mechanics — which
  // is the entire point of this module. Safe to default: it SUBCLASSES the
  // system's own ability sheet and keeps every tab it defines, so enabling this
  // module adds the Mechanics tab and takes nothing away. A GM who prefers the
  // plain sheet can still pick it per item in the sheet config.
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Item, MODULE_ID, AcksAbilitySheet, {
    types: [ABILITY_TYPE],
    makeDefault: true,
    label: game.i18n.localize("ACKS-ABILITIES.sheet.ability"),
  });
  console.log(`${MODULE_ID} | ACKS Ability sheet registered (default for ${ABILITY_TYPE} items).`);
});
