/* global Hooks, CONFIG, foundry, console */
/**
 * Classes subsystem entry: registers the `acks-extras.class` Item sub-type
 * and its constructor sheet, publishes the class-derived rules tables, wires
 * the character-sheet class picker, and exposes the subsystem API.
 *
 * The document model stores what an RR class spread PRINTS (tables, bands,
 * awards, templates); the Judges Journal's custom-class builder explains how
 * those spreads are arranged under the hood (category progressions — the
 * chassis) but is deliberately not automated (docs/classes/DECISIONS.md).
 */
import { acksExtras } from "../namespace.mjs";
import { MODULE_ID, LANG_PREFIX, CLASS_TYPE, FLAG_CLASSES, PROGRESSIONS_DOC_ID, CLASS_DOC_PREFIX, CASTING_KINDS, REPERTOIRE_KINDS } from "./constants.mjs";
import ClassData, { AWARD_KINDS } from "./class-data.mjs";
import ClassSheet from "./class-sheet.mjs";
import * as registry from "./registry.mjs";
import { applyClass, classUpdateData, normalizeHd } from "./apply.mjs";
import { openClassPicker, registerAssignUi } from "./assign.mjs";
import * as casting from "./casting.mjs";
import { openLevelUp, registerLevelUp, parseHd, HP_MODE_SETTING } from "./levelup.mjs";
import { openChargen, applyTemplate, legalTemplates, intBonusPicks, resolveBase, registerChargen } from "./chargen.mjs";
import { registerSheetTabs } from "./sheet-tabs.mjs";
import { savesUpdateData, repairSaveReferences, BOOK_TO_RELEASED_SAVES } from "../lib/actor-compat.mjs";
import { choiceOptions, CHOICE_SOURCES, CHOICE_FILTERS } from "../lib/choice-spec.mjs";

Hooks.once("init", () => {
  CONFIG.Item.dataModels ??= {};
  CONFIG.Item.dataModels[CLASS_TYPE] = ClassData;

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
  try {
    foundry.documents.collections.Items.registerSheet(MODULE_ID, ClassSheet, {
      types: [CLASS_TYPE],
      makeDefault: true,
      label: "ACKS-CLASSES.sheet.sheetName",
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | class sheet registration failed`, err);
  }

  foundry.applications.handlebars
    .loadTemplates([`modules/${MODULE_ID}/templates/classes/class-sheet.hbs`])
    .catch(() => {});

  acksExtras.classes = {
    CLASS_TYPE,
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
    classUpdateData,
    normalizeHd,
    parseHd,
    openClassPicker,
    openLevelUp,
    openChargen,
    applyTemplate,
    legalTemplates,
    intBonusPicks,
    resolveBase,
    casting,
    choiceOptions,
    savesUpdateData,
    repairSaveReferences,
    BOOK_TO_RELEASED_SAVES,
    resolveLevelValue: registry.resolveLevelValue,
  };
  console.log(`${MODULE_ID} | classes subsystem ready (${CLASS_TYPE}).`);
});

registerAssignUi();
casting.registerCastingUi();
registerLevelUp();
registerChargen();
registerSheetTabs();
registry.registerRegistryHooks();
