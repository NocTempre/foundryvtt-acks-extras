/**
 * Names this feature owns.
 *
 * The sub-type is NAMESPACED (`acks-extras.vehicle`) rather than bare: core
 * has an open request for vehicle sheets, and a bare `vehicle` would collide
 * with whatever it ships. This one can coexist with core's and migrate later.
 */
/**
 * Declared literally, as every feature in this family declares it: a re-export
 * cannot be followed by the namespacing check that proves each flag write
 * lands in this module's own scope.
 */
export const MODULE_ID = "acks-extras";

/** The Actor sub-type this feature registers. */
export const VEHICLE_TYPE = `${MODULE_ID}.vehicle`;

/** Lang root for everything in this feature. */
export const LANG_PREFIX = "ACKS-VEHICLES";
