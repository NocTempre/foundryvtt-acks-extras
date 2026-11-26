/* global Hooks, foundry, fromUuidSync, game, ui */
/**
 * Treasure: a window a table turns treasure over in, built on one core `pile`
 * Cards document per pot. This file wires the feature: the pot's sheet (chosen
 * per pot, never the default for a pile), the one relay handler, a card dragged
 * onto an actor's sheet, the doorway card, a Judge-only scene control, and
 * `acksExtras.treasure`.
 */
import { acksExtras } from "../namespace.mjs";
import { executeAsGM, registerHandler } from "../lib/sockets.mjs";
import { DEAL_BLOCK_TEMPLATE, DEAL_OPTIONS_TEMPLATE, LANG, MODULE_ID, POT_HANDLER } from "./constants.mjs";
import { dealOfferedPot, newDealPot } from "./deal.mjs";
import { declareTreasureTables } from "./expected.mjs";
import { installDoorway } from "./doorway.mjs";
import PotSheet, { report } from "./pot-sheet.mjs";
import { createPotRelay, findPot, isPot, newPot, potOf } from "./pot.mjs";
import { createCardDrop } from "./sheet-drop.mjs";
import "./search.mjs";
import "./search-deal.mjs";

registerHandler(POT_HANDLER, createPotRelay({ dealOffered: dealOfferedPot }).handle);

Hooks.on(
  "dropActorSheetData",
  createCardDrop({
    resolveCard: (uuid) => {
      try {
        return fromUuidSync(uuid);
      } catch {
        return null;
      }
    },
    potOf: (pile) => (isPot(pile) ? potOf(pile) : null),
    send: (request) => executeAsGM(POT_HANDLER, request),
    report,
  }),
);

Hooks.once("init", () => {
  foundry.applications.apps.DocumentSheetConfig.registerSheet(foundry.documents.Cards, MODULE_ID, PotSheet, {
    types: ["pile"],
    makeDefault: false,
    label: `${LANG}.sheet.name`,
  });
  acksExtras.treasure = { newPot, newDealPot, findPot };
  declareTreasureTables();
  // The shared deal-options partial, which the pot's rail and the fight-over card's Deal block name as `{{> …}}`, and the block that names it.
  foundry.applications.handlebars.loadTemplates([DEAL_OPTIONS_TEMPLATE, DEAL_BLOCK_TEMPLATE]);
});

installDoorway();

/**
 * The Judge's way in: a button on the token controls that starts a pot in
 * staging, with one monster row per kind among the selected tokens (By hand
 * when none are selected). A `button: true` tool's `onChange` is not awaited by
 * core, so a failure is logged and said where the Judge is looking.
 */
Hooks.on("getSceneControlButtons", (controls) => {
  const tokens = controls.tokens ?? controls.find?.((c) => c.name === "tokens");
  if (!tokens) return;
  const tool = {
    name: "acksTreasure",
    title: game.i18n.localize(`${LANG}.control.title`),
    icon: "fa-solid fa-gem",
    order: 30,
    button: true,
    visible: game.user.isGM,
    onChange: () =>
      newDealPot().catch((err) => {
        console.error(`${MODULE_ID} | treasure pot failed`, err);
        ui.notifications?.error(game.i18n.localize(`${LANG}.control.failed`));
      }),
  };
  if (Array.isArray(tokens.tools)) tokens.tools.push(tool);
  else tokens.tools[tool.name] = tool;
});
