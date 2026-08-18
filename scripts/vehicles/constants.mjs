/**
 * Names this feature owns.
 *
 * The sub-type is NAMESPACED (`acks-extras.vehicle`) rather than bare: core
 * has an open request for vehicle sheets, and a bare `vehicle` would collide
 * with whatever it ships. This one can coexist with core's and migrate later.
 */
import { MODULE_ID } from "../lib/constants.mjs";
export { MODULE_ID };

/** The Actor sub-type this feature registers. */
export const VEHICLE_TYPE = `${MODULE_ID}.vehicle`;

/** Lang root for everything in this feature. */
export const LANG_PREFIX = "ACKS-VEHICLES";
