/**
 * Points of interest in a settlement book — the Foundry-free half of binding
 * them to PLACES.
 *
 * A city gazetteer prints its quarters as groups: "<Quarter> — Points of
 * Interest" for the places, "<Quarter> — Notable Residents" for the people
 * who live there, and "<Quarter> — Overview" for what the book says of the
 * quarter itself. A keyed place in the first two becomes a location actor —
 * the binding `ose-location.mjs` gives a dungeon's rooms — inside the
 * quarter's own place, which sits inside the city's; the overview is that
 * quarter place's own notes, so it makes no actor of its own. A group of any
 * other shape (a hideout, a cult, a party) keeps the page path it always had.
 * The group words are the register's own vocabulary for the book's structure,
 * not the book's prose.
 */
import { MODULE_ID } from "./constants.mjs";
import { LOCATION_TYPE } from "../location/constants.mjs";

/** The group suffixes a settlement book prints per quarter, and what each holds. */
const POI_GROUPS = Object.freeze({ "Points of Interest": "poi", "Notable Residents": "residents", Overview: "overview" });

/**
 * Which quarter a group names, and which part of it — or null for a group of
 * any other shape.
 * @returns {{district: string, kind: "poi"|"residents"|"overview"}|null}
 */
export function poiGroupOf(group) {
  const m = /^(.+?)\s+—\s+(Points of Interest|Notable Residents|Overview)\s*$/u.exec(String(group ?? "").trim());
  return m ? { district: m[1].trim(), kind: POI_GROUPS[m[2]] } : null;
}

/**
 * Whether a cookbook entry belongs to a quarter's places: a keyed place bound
 * as an actor, or the quarter's overview bound as its place's notes. Either
 * way it is not a journal page.
 */
export const isPoiEntry = (entry) => entry?.kind === "kind.location" && !!poiGroupOf(entry?.meta?.group);

/** Whether a cookbook entry is a quarter's own overview — the quarter place's notes, not a place. */
export const isDistrictOverview = (entry) => isPoiEntry(entry) && poiGroupOf(entry.meta.group).kind === "overview";

const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");

/** The cookbook id a quarter's own place is claimed under: one per book and quarter. */
export const districtPlaceId = (book, district) => `${book}.district.${slug(district)}`;

/**
 * Actor data for a quarter's own place. Built empty by whichever step meets
 * the quarter first — its identity is what makes the nesting mean something,
 * and what a second run finds instead of building it twice — and given its
 * prose by the quarter's overview entry when the book prints one.
 */
export function districtPlaceData({ book, bookLabel = "", district, parentUuid = "", folderId = null }) {
  return {
    name: district,
    type: LOCATION_TYPE,
    img: "icons/svg/city.svg",
    folder: folderId,
    system: { region: bookLabel, notes: "", parentUuid },
    flags: {
      [MODULE_ID]: {
        cookbook: { id: districtPlaceId(book, district), book, kind: "kind.location", unaudited: true },
      },
    },
  };
}

/**
 * Actor data for one keyed point of interest. `notes` is the page's own text,
 * already materialized (`entryText`), reference last — the same text the
 * journal page carried, on the thing a place is.
 */
export function poiLocationData({
  name, entryId, notes = "", book, bookLabel = "", district = "", parentUuid = "", folderId = null,
}) {
  return {
    name,
    type: LOCATION_TYPE,
    img: "icons/svg/house.svg",
    folder: folderId,
    system: { region: district || bookLabel, notes, parentUuid },
    flags: {
      [MODULE_ID]: {
        cookbook: { id: entryId, book, kind: "kind.location", unaudited: true },
      },
    },
  };
}
