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
import * as seaThrows from "./sea-throws.mjs";
import { acksExtras } from "../namespace.mjs";
import { expectTables } from "../lib/tables.mjs";
import { TRAVEL_DOC, VOYAGES_DOC } from "./vehicle-speed.mjs";

Hooks.once("init", () => {
  CONFIG.Actor.dataModels[VEHICLE_TYPE] = VehicleData;
  registerVehicleSheet();
  // What this feature will READ from the registry, declared so the import UX
  // can name what a world is missing. The values themselves never ship.
  expectTables(TRAVEL_DOC, ["terrainMultipliers", "roads", "draftEquivalents"]);
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
 * Published because `landSpeed`/`seaSpeeds` are what another module (a
 * caravan cost, a wagon train's day) wants rather than its own reading of
 * the tables. Trap to note: `voyageDay` counts TWELVE hours where a
 * marching party counts eight — compare through `compareToMarch`, never by
 * setting the two day-figures side by side.
 */
// apiVersion: bumped on additive changes; a removal is a new major. See
// docs/vehicles/DECISIONS.md, "The sea's numbers come off the page too
// (Path B completes)."
acksExtras.vehicles = {
  apiVersion: 2,
  VEHICLE_TYPE,
  ...speed,
  ...boarding,
  ...damage,
  ...navigation,
  ...voyage,
  ...berths,
  ...occupants,
  ...stations,
  ...seaThrows,
};
