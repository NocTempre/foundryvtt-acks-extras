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
registerChargenPage();
registerSheetTabs();
registry.registerRegistryHooks();
