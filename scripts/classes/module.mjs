/* global Hooks, CONFIG, foundry, console */
/**
 * Classes subsystem entry: registers the `acks-extras.class` and
 * `acks-extras.race` Item sub-types and their constructor sheets, publishes
 * the class-derived rules tables, wires the character-sheet class picker,
 * and exposes the subsystem API.
 *
 * The document model stores what an RR class spread PRINTS (tables, bands,
 * awards, templates). Advanced mode holds the Judges Journal's builder
 * workflow as INPUT state and derives those same printed fields from the
 * world's imported builder tables (builder-logic.mjs) — simple mode types
 * them, advanced mode computes them, and everything downstream reads one
 * shape.
 */
import * as languages from "./languages.mjs";
import { installLanguageMigration } from "./language-migration.mjs";
import { acksExtras } from "../namespace.mjs";
import { MODULE_ID, LANG_PREFIX, CLASS_TYPE, RACE_TYPE, FLAG_CLASSES, PROGRESSIONS_DOC_ID, CLASS_DOC_PREFIX, CASTING_KINDS, REPERTOIRE_KINDS, FLAG_FROM_CLASS } from "./constants.mjs";
import ClassData, { AWARD_KINDS } from "./class-data.mjs";
import ClassSheet from "./class-sheet.mjs";
import RaceData from "./race-data.mjs";
import RaceSheet from "./race-sheet.mjs";
import * as builder from "./builder.mjs";
import { BUILDER_DOC_ID, derivePlan, xpSchedule } from "./builder-logic.mjs";
import * as registry from "./registry.mjs";
import { applyClass, classUpdateData, normalizeHd, syncClassTraining } from "./apply.mjs";
import { pathGroups, pathOptions, chosenOption, pathTrainingChanges, unansweredGroups, actorPaths, setActorPath, templateSelection } from "./paths.mjs";
import { openClassPicker, registerAssignUi } from "./assign.mjs";
import * as casting from "./casting.mjs";
import { openLevelUp, registerLevelUp, parseHd, HP_MODE_SETTING } from "./levelup.mjs";
import { registerHitPointExpectations, firstLevelDieMinimum, HITPOINTS_DOC } from "./hitpoints.mjs";
import { registerPendingChoices, pendingChoices, isOffer, mintPendingChoices, redeemChoice, openChoiceDialog } from "./pending-choices.mjs";
import { reopenChargen, registerReopenChargen } from "./reopen-chargen.mjs";
import {
  applyChargen,
  applyTemplate,
  grantCoin,
  coinLine,
  legalTemplates,
  intBonusPicks,
  netBonusPicks,
  templateShortfall,
  resolveBase,
  registerChargen,
} from "./chargen.mjs";
import { registerChargenPage, METHODS, METHOD_SETTING } from "./stat-page.mjs";
import {
  materializeTemplates,
  detachTemplatePackages,
  templateContents,
  expandTemplate,
  buildGearData,
  buildProfData,
  applyShortfall,
  bestBaseMatch,
  findSource,
  resolveBaseDoc,
  TEMPLATE_PART,
} from "./template-packages.mjs";
import { registerSheetTabs } from "./sheet-tabs.mjs";
import { registerManagedEffect } from "../lib/managed-effects.mjs";
import { registerClassModifiers } from "./class-modifiers.mjs";
import { savesUpdateData, repairSaveReferences, BOOK_TO_RELEASED_SAVES } from "../lib/actor-compat.mjs";
import { choiceOptions, CHOICE_SOURCES, CHOICE_FILTERS } from "../lib/choice-spec.mjs";

Hooks.once("init", () => {
  // A class's combat training is machinery, not a note: a hand must not delete it.
  registerManagedEffect(FLAG_FROM_CLASS, "ACKS-LIB.managedEffect.ownerClass");
  // …and show it as toggles of its own, out of the ordinary effect list.
  registerClassModifiers();

  CONFIG.Item.dataModels ??= {};
  CONFIG.Item.dataModels[CLASS_TYPE] = ClassData;
  CONFIG.Item.dataModels[RACE_TYPE] = RaceData;
  builder.registerBuilderExpectations();
  registerHitPointExpectations();
  // Picks a character owes, drawn on the sheet and answerable from it.
  registerPendingChoices();

  // How a gained level rolls HP. RAW (user-confirmed ruling): reroll the full
  // Hit Dice, minimum one over the old maximum; additive is the house rule.
  game.settings.register(MODULE_ID, HP_MODE_SETTING, {
    name: `${LANG_PREFIX}.settings.levelUpHpMode.name`,
    hint: `${LANG_PREFIX}.settings.levelUpHpMode.hint`,
    scope: "world",
    config: true,
    type: String,
    choices: {
      raw: `${LANG_PREFIX}.settings.levelUpHpMode.raw`,
      additive: `${LANG_PREFIX}.settings.levelUpHpMode.additive`,
    },
    default: "raw",
  });
  // How a campaign rolls attributes: the printed method (RR Ch. 1 §I.2), or
  // one of the Judges Journal's options (JJ Ch. 16). A campaign rule, so the
  // world holds it and every player's generator obeys it.
  game.settings.register(MODULE_ID, METHOD_SETTING, {
    name: `${LANG_PREFIX}.settings.chargenAttributeMethod.name`,
    hint: `${LANG_PREFIX}.settings.chargenAttributeMethod.hint`,
    scope: "world",
    config: true,
    type: String,
    choices: Object.fromEntries(Object.keys(METHODS).map((k) => [k, `${LANG_PREFIX}.chargen.methods.${k}`])),
    default: "standard",
  });
  try {
    foundry.documents.collections.Items.registerSheet(MODULE_ID, ClassSheet, {
      types: [CLASS_TYPE],
      makeDefault: true,
      label: "ACKS-CLASSES.sheet.sheetName",
    });
    foundry.documents.collections.Items.registerSheet(MODULE_ID, RaceSheet, {
      types: [RACE_TYPE],
      makeDefault: true,
      label: "ACKS-CLASSES.race.sheetName",
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | class sheet registration failed`, err);
  }

  foundry.applications.handlebars
    .loadTemplates([
      `modules/${MODULE_ID}/templates/classes/class-sheet.hbs`,
      `modules/${MODULE_ID}/templates/classes/race-sheet.hbs`,
      `modules/${MODULE_ID}/templates/classes/assign.hbs`,
      `modules/${MODULE_ID}/templates/classes/assign-footer.hbs`,
    ])
    .catch((err) => console.warn(`${MODULE_ID} | template preload skipped`, err));

  acksExtras.classes = {
    /**
     * Who speaks what (languages.mjs): the RR §I.10 grant — what a class and
     * race know outright, what Intellect buys, and the slot carriers that
     * hold them.
     */
    languages,
    // Sending a character back through the Scores Generator: the page works,
    // but the system clears the flag that offers it on the first score edit.
    reopenChargen,
    CLASS_TYPE,
    RACE_TYPE,
    BUILDER_DOC_ID,
    FLAG_CLASSES,
    PROGRESSIONS_DOC_ID,
    CLASS_DOC_PREFIX,
    AWARD_KINDS,
    CASTING_KINDS,
    REPERTOIRE_KINDS,
    CHOICE_SOURCES,
    CHOICE_FILTERS,
    registry,
    applyClass,
    syncClassTraining,
    /** Paths — a class's groups of mutually exclusive options (DECISIONS
     *  2026-08-22). `pathGroups(system)` resolves every group with its options,
     *  a `templates` group included; `setActorPath` records one choice. */
    paths: {
      pathGroups,
      pathOptions,
      chosenOption,
      pathTrainingChanges,
      unansweredGroups,
      actorPaths,
      setActorPath,
      templateSelection,
    },
    classUpdateData,
    normalizeHd,
    parseHd,
    // The imported 1st-level hit-die floor, and the ruledata document it is
    // read from — exposed so a live check can see what the world imported.
    HITPOINTS_DOC,
    firstLevelDieMinimum,
    /** Open picks: a printed offer a character has not answered yet, minted as
     *  an owned marker and redeemed into the document the player chooses. */
    pending: { pendingChoices, isOffer, mintPendingChoices, redeemChoice, openChoiceDialog },
    openClassPicker,
    openLevelUp,
    applyChargen,
    applyTemplate,
    // The starting coin, in the denominations a package prints it in, and the
    // one way this family writes it down.
    grantCoin,
    coinLine,
    legalTemplates,
    intBonusPicks,
    // Bonus picks NET of what a template already spends, and what a template
    // hands out that its character may not hold (RR Ch.2 §II.1).
    netBonusPicks,
    templateShortfall,
    resolveBase,
    /**
     * Template packages: a class's printed templates materialized as
     * repairable bundle documents plus the generated 3d6 RollTable.
     * `materializeTemplates(classItem, {stamp, folder, tableFolder})` is the
     * seam acks-importer calls after creating or updating a class document.
     */
    templates: {
      materializeTemplates,
      // The way back: clears every row's package link (and optionally deletes
      // the documents), so the class applies from its printed entries exactly
      // as it did before packages existed.
      detachTemplatePackages,
      templateContents,
      expandTemplate,
      buildGearData,
      buildProfData,
      applyShortfall,
      bestBaseMatch,
      // Resolution reaches the COMPENDIA as well as the world, because the
      // importer can be configured to import into a pack — and a locked pack
      // document is exactly what a Judge cannot repair, so it is copied in.
      findSource,
      resolveBaseDoc,
      TEMPLATE_PART,
    },
    casting,
    choiceOptions,
    savesUpdateData,
    repairSaveReferences,
    BOOK_TO_RELEASED_SAVES,
    resolveLevelValue: registry.resolveLevelValue,
    // Advanced mode: the builder derivation and the race documents it spends.
    builder,
    derivePlan,
    xpSchedule,
  };
  console.log(`${MODULE_ID} | classes subsystem ready (${CLASS_TYPE}).`);
});

registerAssignUi();
casting.registerCastingUi();
registerLevelUp();
registerReopenChargen();
registerChargen();
registerChargenPage();
registerSheetTabs();
registry.registerRegistryHooks();
installLanguageMigration();
