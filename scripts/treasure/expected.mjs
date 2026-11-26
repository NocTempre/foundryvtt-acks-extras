/**
 * What the treasure deal reads from the registry, declared so the Ruledata
 * Browser lists each table (as "not supplied" while nothing is imported)
 * instead of showing no treasure group at all. The names are the engine
 * tables `hoard-map.mjs` reads; the values never ship.
 */
import { expectTables } from "../lib/tables.mjs";
import { TREASURE_DOC_ID } from "../importer/treasure-binding.mjs";

/** The tables of the `treasure` document the hoard deal reads (`importer/treasure-binding.mjs` `PRODUCES` assembles each). */
export const EXPECTED_TABLES = Object.freeze([
  "typeClassic",
  "typeHeroic",
  "typeGritty",
  "typeUnits",
  "gemValue",
  "jewelryValue",
  "gemDice",
  "jewelryDice",
  "special",
  "specialPer",
]);

/** Declare the tables the treasure deal reads. */
export function declareTreasureTables() {
  expectTables(TREASURE_DOC_ID, EXPECTED_TABLES);
}
