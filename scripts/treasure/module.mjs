/* global Hooks, foundry, game, ui */
/**
 * Treasure: a window a table turns treasure over in, built on one core `pile`
 * Cards document per pot. This file wires the feature: the pot's sheet (chosen
 * per pot, never the default for a pile), the one relay handler, the doorway
 * card, a Judge-only scene control, and `acksExtras.treasure`.
 */
import { acksExtras } from "../namespace.mjs";
import { registerHandler } from "../lib/sockets.mjs";
import { MODULE_ID, LANG, POT_HANDLER } from "./constants.mjs";
import { installDoorway } from "./doorway.mjs";
import PotSheet from "./pot-sheet.mjs";
import { createPotRelay, findPot, newPot } from "./pot.mjs";
import "./search.mjs";

registerHandler(POT_HANDLER, createPotRelay().handle);

Hooks.once("init", () => {
  foundry.applications.apps.DocumentSheetConfig.registerSheet(foundry.documents.Cards, MODULE_ID, PotSheet, {
    types: ["pile"],
    makeDefault: false,
    label: `${LANG}.sheet.name`,
  });
  acksExtras.treasure = { newPot, findPot };
});

installDoorway();

/**
 * The Judge's way in: a button on the token controls that starts a pot in
 * staging. A `button: true` tool's `onChange` is not awaited by core, so a
 * failure is logged and said where the Judge is looking.
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
      newPot().catch((err) => {
        console.error(`${MODULE_ID} | treasure pot failed`, err);
        ui.notifications?.error(game.i18n.localize(`${LANG}.control.failed`));
      }),
  };
  if (Array.isArray(tokens.tools)) tokens.tools.push(tool);
  else tokens.tools[tool.name] = tool;
});
