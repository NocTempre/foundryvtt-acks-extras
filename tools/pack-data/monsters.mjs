/**
 * Pack contract for the synced tools/build-packs.mjs harness (see
 * acks-module-template). Document content stays in bestiary-data.mjs;
 * this file just maps pack names to their builders.
 */
import { buildBestiary, buildSpoils, buildTreasure } from "./bestiary-data.mjs";

export const packs = {
  bestiary: buildBestiary,
  spoils: buildSpoils,
  treasure: buildTreasure,
};
