/* global CONFIG, Hooks */
/**
 * Vehicles: carts, wagons, galleys and sailing ships as documents.
 *
 * This feature owns the `acks-extras.vehicle` Actor sub-type and registers its
 * model and sheet HERE and only here. The registration is unconditional — a
 * sub-type whose model fails to register leaves every vehicle in the world as
 * an unreadable actor, which is a worse failure than any capability check
 * could be guarding against.
 */
import { VEHICLE_TYPE } from "./constants.mjs";
import VehicleData from "./vehicle-data.mjs";
import { registerVehicleSheet } from "./vehicle-sheet.mjs";
import * as speed from "./vehicle-speed.mjs";
import * as boarding from "./boarding.mjs";
import * as damage from "./vessel-damage.mjs";
import * as navigation from "./navigation.mjs";
import * as voyage from "./voyage.mjs";
import * as berths from "./berths.mjs";
import * as occupants from "./occupants.mjs";
import * as stations from "./stations.mjs";
import { acksExtras } from "../namespace.mjs";
import { expectTables } from "../lib/tables.mjs";
import { TRAVEL_DOC, VOYAGES_DOC } from "./vehicle-speed.mjs";

Hooks.once("init", () => {
  CONFIG.Actor.dataModels[VEHICLE_TYPE] = VehicleData;
  registerVehicleSheet();
  // What this feature will READ from the registry, declared so the import UX
  // can name what a world is missing. The values themselves never ship.
  expectTables(TRAVEL_DOC, ["terrainMultipliers", "roads"]);
  expectTables(VOYAGES_DOC, [
    "windStrength",
    "tacking",
    "navigation",
    "hazardThrow",
    "hazards",
    "damageShares",
    "repair",
    "rounding",
    "berth",
  ]);
});

/**
 * The speed derivation is published because it is the interesting part, and the
 * part another module would otherwise re-derive: a domain module costing a
 * caravan, or a battle module asking how far a wagon train gets in a day, wants
 * `landSpeed`/`seaSpeeds` rather than its own reading of the tables.
 *
 * The sea rules ride with them for the same reason, and one of them is a trap
 * worth publishing loudly: `voyageDay` counts TWELVE hours where a marching
 * party counts eight, so a caller comparing a ship to a column must go through
 * `compareToMarch` rather than setting the two day-figures side by side.
 */
// apiVersion 1: the surface stops being an unversioned spread the release the
// stations land — additive changes bump it, removals are a new major of it.
acksExtras.vehicles = {
  apiVersion: 1,
  VEHICLE_TYPE,
  ...speed,
  ...boarding,
  ...damage,
  ...navigation,
  ...voyage,
  ...berths,
  ...occupants,
  ...stations,
};
