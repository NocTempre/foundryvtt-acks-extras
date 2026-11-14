/** Follower rules (RR 334-337): what the follower roll reads from the import; null where not imported. */
import { optTable, optCite } from "./tables.mjs";

/** The class level at which followers begin to arrive (RR 334); null where not imported. */
export function arrivalLevel() {
  const level = optTable("followers", "arrivalLevel")?.level;
  return Number.isInteger(level) && level > 0 ? level : null;
}

/** The page the arrival level was read from; null where none is recorded. */
export function arrivalLevelCite() {
  return optCite("followers", "arrivalLevel");
}

/** The number of troops that make one platoon (RR 335); null where not imported. */
export function platoonSize() {
  const troops = optTable("followers", "platoonSize")?.troops;
  return Number.isInteger(troops) && troops > 0 ? troops : null;
}

/** The page the platoon size was read from; null where none is recorded. */
export function platoonSizeCite() {
  return optCite("followers", "platoonSize");
}

/** How many troop type rolls `troops` call for, one per platoon or fraction; null while the platoon size is unread. */
export function platoonCount(troops) {
  const size = platoonSize();
  if (size == null) return null;
  return Number.isFinite(troops) && troops > 0 ? Math.ceil(troops / size) : 0;
}

/** True where the four tables the follower roll reads beside the arrival level are imported. */
export function followerTablesImported() {
  return !!(
    optTable("followers", "followersByClass")
    && optTable("followers", "troopTypeTables")
    && optTable("followers", "companionLevel")
    && optTable("followers", "followerLoyalty")
  );
}

/** A level a table printed: a whole number of zero or more, else null. */
export function knownLevel(level) {
  return Number.isInteger(level) && level >= 0 ? level : null;
}
