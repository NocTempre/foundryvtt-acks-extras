/* global game, Hooks, ui */
/**
 * ACKS II — Item Markets. Entry point.
 *
 *  init:  settings. (The `location` sub-type, its sheet, and the market
 *         subtree belong to the location feature; this feature is a consumer
 *         that owns the `system.market.goods` semantics and every writer.)
 *  setup: table expectations, public API.
 *  ready: system check, missing-tables notice.
 */
import { acksExtras, assertAcksSystem } from "../namespace.mjs";
import { MODULE_ID, LANG, RULEDATA, HOOKS } from "./constants.mjs";
import * as config from "./config.mjs";
import { registerSettings, getSetting } from "./settings.mjs";

Hooks.once("init", () => {
  registerSettings();
});

Hooks.once("setup", () => {
  // Tables arrive per world through the ruledata-import contract (see the
  // henchmen entry point for the layering); declaring them here lets the
  // materialize flow generate fillable placeholders for missing ones.
  try {
    acksExtras.lib?.tables?.expectTables?.("availability", ["equipmentAvailability"]);
    acksExtras.lib?.tables?.expectTables?.("mercantile", ["merchandiseTypes"]);
    acksExtras.lib?.tables?.expectTables?.("magicItems", ["transactionsByMarketClass"]);
  } catch (err) {
    console.warn(`${MODULE_ID} | markets expectTables failed`, err);
  }

  const api = {
    HOOKS,
    config,
    getSetting,
  };
  acksExtras.markets = api;
});

Hooks.once("ready", () => {
  if (!assertAcksSystem("item markets expect the ACKS II system.")) return;

  // Book tables are imported per-world, not shipped. Name the missing
  // documents once to the GM. The shared `availability` doc is announced by
  // henchmen; only this feature's own docs are checked here.
  if (game.user.isGM) {
    const hasDoc = (id) => acksExtras.lib?.tables?.hasDoc?.(id);
    const missing = RULEDATA.filter((id) => !hasDoc(id));
    if (missing.length) {
      ui.notifications.warn(game.i18n.format(`${LANG}.tablesMissing`, { list: missing.join(", ") }));
    }
  }
});
