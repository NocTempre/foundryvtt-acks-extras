/**
 * Follower rules (RR 334-337): what the follower roll reads from the import.
 * Pure module. Every read answers null (or false) where its table is not
 * imported, so the roll that stands on it does nothing instead of guessing.
 */
import { optTable, optCite } from "./tables.mjs";

/**
 * The class level at which followers begin to arrive (RR 334), as the world
 * imported it; null where the table is absent or its figure is not a whole
 * number above zero.
 */
export function arrivalLevel() {
  const level = optTable("followers", "arrivalLevel")?.level;
  return Number.isInteger(level) && level > 0 ? level : null;
}

/** The page the arrival level was read from; null where none is recorded or a Judge's override holds it. */
export function arrivalLevelCite() {
  return optCite("followers", "arrivalLevel");
}

/**
 * True where every table the follower roll reads beside the arrival level is
 * imported: the grants by class, the troop type tables, the companion level
 * roll and the follower loyalty table.
 */
export function followerTablesImported() {
  return !!(
    optTable("followers", "followersByClass")
    && optTable("followers", "troopTypeTables")
    && optTable("followers", "companionLevel")
    && optTable("followers", "followerLoyalty")
  );
}

/** A level a table printed: a whole number of zero or more, else null. Null is unknown, never a first or zeroth level. */
export function knownLevel(level) {
  return Number.isInteger(level) && level >= 0 ? level : null;
}
