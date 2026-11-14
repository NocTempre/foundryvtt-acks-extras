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
 * The number of troops that make one platoon (RR 335), as the world imported
 * it; null where the table is absent or its figure is not a whole number above
 * zero.
 */
export function platoonSize() {
  const troops = optTable("followers", "platoonSize")?.troops;
  return Number.isInteger(troops) && troops > 0 ? troops : null;
}

/** The page the platoon size was read from; null where none is recorded or a Judge's override holds it. */
export function platoonSizeCite() {
  return optCite("followers", "platoonSize");
}

/**
 * How many troop type rolls `troops` call for: one per platoon or fraction of
 * one, so the count rounds up and no troops call for none. Null while the
 * platoon size is unread, never a count made without it.
 */
export function platoonCount(troops) {
  const size = platoonSize();
  if (size == null) return null;
  return Number.isFinite(troops) && troops > 0 ? Math.ceil(troops / size) : 0;
}

/**
 * True where the four tables the follower roll reads beside the arrival level
 * are imported: the grants by class, the troop type tables, the companion level
 * roll and the follower loyalty table. The platoon size is not among them: the
 * roll runs without it and lists no platoon types.
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
