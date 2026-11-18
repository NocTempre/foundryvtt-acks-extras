/* global Hooks, foundry, Item */
/**
 * ACKS II — Magic.
 *
 * Extends the core `spell` item with the spell primitive stored at
 * `flags["acks-extras"].spell` (`spell-extras.mjs`): the structured stat
 * line, the lists a spell prints on, its reversal pair and its effect rows
 * in the shared vocabulary — and an alternate spell sheet that views and
 * edits it. Nothing mutates the acks system; the vocabulary comes from the
 * lib subsystem, and core's own display strings follow the flag.
 */
import { acksExtras, assertAcksSystem } from "../namespace.mjs";
import { MODULE_ID, FLAG_SPELL, SPELL_TYPE, LANG_PREFIX } from "./constants.mjs";
import SpellExtras from "./spell-extras.mjs";
import { createSpellSheet, spellEffectStore, LEVEL_VALUE_PARTIAL } from "./spell-sheet.mjs";
import { parseRangeLine, parseDurationLine, displayRange, displayDuration, coreFieldsFrom, spellTraditions, spellDedupeKey } from "./spell-logic.mjs";
import { describeSpellEffect } from "./describe.mjs";
import { stripModuleData } from "./uninstall.mjs";
import { splitSpellNames, titleIndex, scanMonsterSpells, castsAsClass, castSourceOf } from "./spell-names.mjs";
import {
  repertoireFor,
  drawRepertoire,
  slotsOfClass,
  slotsFromCells,
  coreSlotsPatch,
  spellsByName,
  fillGeneratedRepertoire,
  makeRepertoireSource,
} from "./repertoire.mjs";
import { registerCastSummon, castSummon } from "./cast-summon.mjs";
import { registerCastSpell, castReading } from "./cast-spell.mjs";
import { registerCastProcedure, procedureOfKind } from "./cast-procedure.mjs";
import { selfReach, twinLookups } from "./cast-reach.mjs";
import { classForActor } from "../classes/registry.mjs";
import * as casting from "../classes/casting.mjs";
import { registerSpellSource, registerSpellReach } from "../lib/spell-sources.mjs";
import { registerCastRecur } from "./cast-recur.mjs";
import { registerCastExpiry } from "./cast-expiry.mjs";
import { registerCastHeld } from "./cast-held.mjs";
import { registerCastDeclare } from "./cast-declare.mjs";
import { coreItemSheetFor } from "../lib/util.mjs";
import { TEMPLATE_HOOKS } from "../lib/constants.mjs";

/** The dynamically-created sheet class (base is resolved at ready). */
let AcksSpellSheet = null;

Hooks.once("init", () => {
  const api = {
    MODULE_ID,
    FLAG_SPELL,
    SPELL_TYPE,
    SpellExtras,
    /** Read the spell primitive for a spell item (a SpellExtras instance). */
    getExtras: (item) => SpellExtras.fromItem(item),
    /** Whether an item carries the primitive at all. */
    hasExtras: (item) => SpellExtras.has(item),
    // The stat-line readers and writers the importer's binder and the sheet
    // share: a printed range or duration line to its shape, and back.
    parseRangeLine,
    parseDurationLine,
    displayRange,
    displayDuration,
    coreFieldsFrom,
    // The traditions a spell is offered under, and the key two copies of one
    // spell share in a picker — what the class spell picker dedupes by.
    spellTraditions,
    spellDedupeKey,
    describeSpellEffect,
    /** The effect-row store the shared editor edits for one spell. */
    effectStore: spellEffectStore,
    // Printed names: a list split without cutting a title on its own "and",
    // a title resolved from its printing, a creature's spells read off its
    // prose and what it casts as.
    splitSpellNames,
    titleIndex,
    scanMonsterSpells,
    castsAsClass,
    castSourceOf,
    // Repertoires drawn to a slot count from the imported spells.
    repertoireFor,
    drawRepertoire,
    slotsOfClass,
    slotsFromCells,
    coreSlotsPatch,
    spellsByName,
    fillGeneratedRepertoire,
    stripModuleData,
    /** Cast a summoning spell and wait for its placement (cast-summon.mjs). */
    castSummon,
    /** Register a casting tradition kind's cast procedure; returns the handle that removes it (cast-procedure.mjs). */
    registerCastProcedure,
    /** The procedure registered for a tradition kind, or null. */
    procedureOfKind,
    get AcksSpellSheet() {
      return AcksSpellSheet;
    },
  };
  acksExtras.magic = api;

  // A generated creature whose template enabled a slot block and named what
  // it casts as draws its repertoire here, before the actor is written.
  Hooks.on(TEMPLATE_HOOKS.RESOLVED, ({ resolved }) => {
    try {
      fillGeneratedRepertoire(resolved);
    } catch (err) {
      console.warn(`${MODULE_ID} | repertoire draw skipped`, err);
    }
  });

  try {
    foundry.applications.handlebars.loadTemplates([
      `modules/${MODULE_ID}/templates/magic/tab-overview.hbs`,
      `modules/${MODULE_ID}/templates/magic/tab-mechanics.hbs`,
      `modules/${MODULE_ID}/templates/magic/cast-dialog.hbs`,
      `modules/${MODULE_ID}/templates/magic/cast-dialog-footer.hbs`,
      LEVEL_VALUE_PARTIAL,
      `modules/${MODULE_ID}/templates/lib/effect-row-editor.hbs`,
    ]);
  } catch (err) {
    console.warn(`${MODULE_ID} | magic template preload skipped`, err);
  }
  // A summoning spell's cast places its creatures: a claimant on lib's cast
  // seam, with the rules over what the spell may call riding lib's summons.
  try {
    // The class reader is the classes feature's, so a claimant tells synchronously which tradition cast a spell.
    registerCastSummon({ classFor: classForActor });
  } catch (err) {
    console.error(`${MODULE_ID} | the summoning cast could not register`, err);
  }
  // A spell with effect rows is cast through a dialog, a card and an applier;
  // its claimant is registered after the summoning's, so a summoning stays there.
  try {
    registerCastSpell({ classFor: classForActor });
  } catch (err) {
    console.error(`${MODULE_ID} | the spell cast could not register`, err);
  }
  // What a character can cast is one register in lib: the repertoire is a source, and magic decides what a cast would write on its caster.
  try {
    // A namespace, so the tradition's cap is read where the classes feature has `traditionCapAt` and is none where it has not.
    registerSpellSource("repertoire", makeRepertoireSource({ castReading, classFor: classForActor, poolsOf: casting.poolState, lookups: twinLookups, capAt: casting.traditionCapAt }));
    registerSpellReach(selfReach);
  } catch (err) {
    console.error(`${MODULE_ID} | the castable-spell register could not be filled`, err);
  }
  // A recurring row's prompt is posted at its turn by lib's turn hooks, and its Save, Roll and Next round
  // presses are relayed to the GM's client.
  try {
    registerCastRecur();
  } catch (err) {
    console.error(`${MODULE_ID} | the recurring prompts could not register`, err);
  }
  // A cast held by concentration ends in one funnel on the client that deleted the caster's
  // record; a spell declared in a fight lapses, is lost or resolves through its own hooks.
  try {
    registerCastHeld();
    registerCastDeclare();
  } catch (err) {
    console.error(`${MODULE_ID} | the concentration and declaration hooks could not register`, err);
  }
  // A summoning's cast that runs out on the world clock tells its caster's
  // owners and the GMs, with a Dismiss for what it left standing.
  try {
    registerCastExpiry();
  } catch (err) {
    console.error(`${MODULE_ID} | the cast-end watch could not register`, err);
  }
  console.log(`${MODULE_ID} | initialised (spell primitive ready)`);
});

/*
 * Sheet registration happens at READY, not init: Foundry defers every
 * DocumentSheetConfig.registerSheet call made before `game.ready`, so the
 * system's spell sheet — the base class — can only be resolved here.
 */
Hooks.once("ready", async () => {
  if (!assertAcksSystem("the ACKS Spell sheet expects acks spell items.")) return;
  const Base = coreItemSheetFor(SPELL_TYPE);
  if (!Base) {
    console.error(`${MODULE_ID} | could not resolve the acks spell sheet; ACKS Spell sheet NOT registered.`);
    return;
  }
  // The Mechanics tab folds in the system's Active Effects partial, which the
  // system registers lazily with its own sheets. Preloaded here; degrades to
  // rendering without the block if the system renames it.
  const AE_PARTIAL = "systems/acks/templates/items/v2/common/item-active-effects.hbs";
  try {
    await foundry.applications.handlebars.loadTemplates([AE_PARTIAL]);
  } catch (err) {
    globalThis.Handlebars?.registerPartial?.(AE_PARTIAL, "");
    console.warn(`${MODULE_ID} | the system no longer ships ${AE_PARTIAL}; the Mechanics tab renders without the Active Effects block.`, err);
  }

  AcksSpellSheet = createSpellSheet(Base);
  // The default for every spell item; the system's plain sheet stays
  // selectable per item.
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Item, MODULE_ID, AcksSpellSheet, {
    types: [SPELL_TYPE],
    makeDefault: true,
    label: `${LANG_PREFIX}.sheet.spell`,
  });
  console.log(`${MODULE_ID} | ACKS Spell sheet registered`);
});
