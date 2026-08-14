/* global game */
/**
 * World settings for the markets feature. All under the module namespace,
 * `markets`-prefixed to keep clear of the other features' keys; registered
 * at init.
 */
import { MODULE_ID, LANG } from "./constants.mjs";

export function registerSettings() {
  const reg = (key, data) => game.settings.register(MODULE_ID, key, data);

  reg("marketsExtendedSearch", {
    name: `${LANG}.setting.extendedSearch`,
    hint: `${LANG}.setting.extendedSearchHint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  reg("marketsFamilyIncomeGp", {
    name: `${LANG}.setting.familyIncome`,
    hint: `${LANG}.setting.familyIncomeHint`,
    scope: "world",
    config: true,
    type: Number,
    default: 10,
  });
  reg("marketsEnforceCaps", {
    name: `${LANG}.setting.enforceCaps`,
    hint: `${LANG}.setting.enforceCapsHint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  // Party registry: [{id, name, memberUuids: []}]. Empty = one implicit
  // party of all player-owned characters and their henchmen. Edited from the
  // party-config app, not the settings sheet.
  reg("marketParties", {
    scope: "world",
    config: false,
    type: Array,
    default: [],
  });
}

export const getSetting = (key) => game.settings.get(MODULE_ID, key);
