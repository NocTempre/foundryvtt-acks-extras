/* global Hooks, game, CONFIG */
/**
 * Registers the market report Item sub-type and its sheet, and runs the one
 * migration that feeds it at `ready`. Imported once from the markets entry
 * point.
 */
import { MODULE_ID, REPORT_TYPE } from "./constants.mjs";
import { isPrimaryGM } from "../lib/util.mjs";
import MarketReportData from "./data/report-data.mjs";
import { registerReportSheet } from "./apps/report-sheet.mjs";
import { migrateDmKnowledge } from "./engine/trade-objects.mjs";

Hooks.once("init", () => {
  // Wrapped because a throw in `init` leaves the rest of the hook dead, and
  // the markets' own registrations must survive a sub-type failing.
  try {
    CONFIG.Item ??= {};
    CONFIG.Item.dataModels ??= {};
    CONFIG.Item.dataModels[REPORT_TYPE] = MarketReportData;
    registerReportSheet();
  } catch (err) {
    console.error(`${MODULE_ID} | market report item sub-type failed to register`, err);
  }
});

Hooks.once("ready", () => {
  if (!isPrimaryGM()) return;
  // The server reads `documentTypes` at world launch: a world that has not been
  // relaunched since the sub-type arrived cannot create one, so the move waits.
  if (!game.documentTypes?.Item?.includes(REPORT_TYPE)) {
    console.warn(`${MODULE_ID} | market reports need a world relaunch before the demand beliefs can move`);
    return;
  }
  migrateDmKnowledge().catch((err) => console.error(`${MODULE_ID} | the demand beliefs could not move to reports`, err));
});
