/* global foundry */
/**
 * The location actor — a PLACE goods and people can be at.
 *
 * docs/MODEL.md has ruled since 2026-07-19 that the settlement sub-type belongs
 * to this module. This is the first slice of that move, and it is deliberately
 * LEAN: identity plus storage, nothing else. acks-henchmen's own
 * `acks-henchmen.location` keeps its market schema (postings, candidates,
 * market rolls, slander) and keeps working untouched — moving that data is its
 * own program, and doing it as a side effect of the storage work would put a
 * migration between a player and their belongings.
 *
 * Storage itself is NOT modelled here. Goods stored at a location are real
 * embedded items on this actor stamped by acks-lib's storage primitives, so the
 * schema needs no inventory field and a place created by any other means (a
 * henchmen market actor, a future cart) holds goods the same way.
 */
import { LOCATION_TYPE } from "../constants.mjs";

export { LOCATION_TYPE };

export class LocationData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const lib = globalThis.acksLib;
    const { str, html } = lib.fields;
    return {
      // AcksActor.prepareDerivedData runs for EVERY actor type and touches
      // isNew / thac0 / initiative / movement / saves unguarded; without these
      // stubs every update to this actor logs a failed-data-preparation error.
      // The one definition of that set lives in acks-lib. The values are
      // meaningless for a place.
      ...lib.acksCompatStubs(),
      region: str(),
      notes: html(),
    };
  }
}

export default LocationData;
