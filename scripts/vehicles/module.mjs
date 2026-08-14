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
import { acksExtras } from "../namespace.mjs";

Hooks.once("init", () => {
  CONFIG.Actor.dataModels[VEHICLE_TYPE] = VehicleData;
  registerVehicleSheet();
});

/**
 * The speed derivation is published because it is the interesting part, and the
 * part another module would otherwise re-derive: a domain module costing a
 * caravan, or a battle module asking how far a wagon train gets in a day, wants
 * `landSpeed`/`seaSpeeds` rather than its own reading of the tables.
 */
acksExtras.vehicles = { VEHICLE_TYPE, ...speed };
