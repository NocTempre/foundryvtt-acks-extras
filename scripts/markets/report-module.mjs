/* global Hooks, CONFIG */
/**
 * Registers the market report Item sub-type and its sheet. Imported once from
 * the markets entry point.
 */
import { MODULE_ID, REPORT_TYPE } from "./constants.mjs";
import MarketReportData from "./data/report-data.mjs";
import { registerReportSheet } from "./apps/report-sheet.mjs";

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
