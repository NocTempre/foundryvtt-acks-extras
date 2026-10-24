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
 *
 * A region's gazetteer is not a settlement: its keyed sites and its overview
 * sit under the two whole group names in `REGION_GROUPS`, which the quarter
 * parse never takes, so nothing that reads quarters sees a region.
 *
 * An adventure's keyed areas belong to KEY SPACES (a fort, a dungeon level),
 * since its numbering starts again in each: a row names its space and the
 * place it sits inside (`meta.space`, `meta.parent`), and a space is the row
 * the others name. Each is a place under its parent, the spaces under the
 * book's own place, and what a room's stat lines name are its occupants.
 */
import { MODULE_ID } from "./constants.mjs";
import { LOCATION_TYPE, isPlaceRole } from "../location/constants.mjs";
import { oseAdventureId } from "./ose-location.mjs";

/** The group suffixes a settlement book prints per quarter, and what each holds. */
const POI_GROUPS = Object.freeze({ "Points of Interest": "poi", "Notable Residents": "residents", Overview: "overview" });

/** The whole group names a region's gazetteer is filed under, and what each holds. */
export const REGION_GROUPS = Object.freeze({ "Region — Sites": "site", "Region — Overview": "overview" });

/**
 * Which part of a region a group names, or null for any other group.
 * @returns {{kind: "site"|"overview"}|null}
 */
export function regionGroupOf(group) {
  const key = String(group ?? "").trim();
  return Object.hasOwn(REGION_GROUPS, key) ? { kind: REGION_GROUPS[key] } : null;
}

/**
 * Which quarter a group names, and which part of it — or null for a group of
 * any other shape, a region's included.
 * @returns {{district: string, kind: "poi"|"residents"|"overview"}|null}
 */
export function poiGroupOf(group) {
  if (regionGroupOf(group)) return null;
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

/** Whether a cookbook entry is one of a region's keyed sites. */
export const isRegionSite = (entry) => entry?.kind === "kind.location" && regionGroupOf(entry?.meta?.group)?.kind === "site";

/** Whether a cookbook entry is a region's own overview — the region place's notes, not a site. */
export const isRegionOverview = (entry) => entry?.kind === "kind.location" && regionGroupOf(entry?.meta?.group)?.kind === "overview";

/** The cookbook id a region's own place is claimed under: one per book. */
export const regionPlaceId = (book) => `${book}.region`;

/**
 * Actor data for a region's own place, shaped like a quarter's: built empty
 * under the book's label (the id when there is none), never a name read off
 * the page, and given its prose by the region's overview entry when the book
 * prints one.
 */
export function regionPlaceData({ book, bookLabel = "", folderId = null }) {
  return {
    name: bookLabel || book,
    type: LOCATION_TYPE,
    img: "icons/svg/mountain.svg",
    folder: folderId,
    system: { region: bookLabel, notes: "", parentUuid: "" },
    flags: {
      [MODULE_ID]: {
        cookbook: { id: regionPlaceId(book), book, kind: "kind.location", unaudited: true },
      },
    },
  };
}

/**
 * Actor data for one keyed point of interest. `notes` is the page's own text,
 * already materialized (`entryText`), reference last — the same text the
 * journal page carried, on the thing a place is. `roster` is its occupant rows
 * (`lib/place.mjs:occupantRow`), where it has any.
 */
export function poiLocationData({
  name, entryId, notes = "", book, bookLabel = "", district = "", parentUuid = "", folderId = null, role = "", roster = [],
}) {
  return {
    name,
    type: LOCATION_TYPE,
    img: "icons/svg/house.svg",
    folder: folderId,
    // `role` is written only when it names a registered place role.
    system: {
      region: district || bookLabel, notes, parentUuid, ...(isPlaceRole(role) ? { role } : {}), ...(roster.length ? { roster } : {}),
    },
    flags: {
      [MODULE_ID]: {
        cookbook: { id: entryId, book, kind: "kind.location", unaudited: true },
      },
    },
  };
}

/** The key spaces a book's rows name (`meta.space`), by cookbook id. */
export const keySpacesOf = (entries) => new Set(Object.values(entries ?? {}).map((e) => e?.meta?.space).filter(Boolean));

/**
 * Whether a cookbook entry is a keyed area of a key space, or a space itself:
 * a place, never a journal page.
 * @param {object} entry
 * @param {string} id the entry's cookbook id
 * @param {Set<string>} spaces the book's `keySpacesOf`
 */
export const isKeyedPlace = (entry, id, spaces) => entry?.kind === "kind.location" && (!!entry?.meta?.space || spaces.has(id));

/**
 * The cookbook id of the place a keyed place sits inside: its parent, else its
 * space, else the book's own place. A space sits in the book's place.
 */
export const keyedParentId = (entry, book) => entry?.meta?.parent ?? entry?.meta?.space ?? oseAdventureId(book);

/**
 * A keyed place's occupants in printed order. The executor returns the
 * `occupants.<i>.<part>` fields as one object keyed `"<i>.<part>"`; this
 * regroups them, and drops one whose label read no name.
 * @param {object} fields an executed node's fields
 * @returns {Array<{index: number, name: {text: string, ref?: string}, count: number|string|null, stats: object|null}>}
 */
export function occupantsOf(fields) {
  const byIndex = new Map();
  for (const [key, value] of Object.entries(fields?.occupants ?? {})) {
    const m = /^(\d+)\.(name|count|stats)$/.exec(key);
    if (!m) continue;
    const index = Number(m[1]);
    if (!byIndex.has(index)) byIndex.set(index, { index, name: null, count: null, stats: null });
    byIndex.get(index)[m[2]] = value ?? null;
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index).filter((o) => String(o.name?.text ?? "").trim());
}

/**
 * An occupant's roster figures. A whole count is the row's quantity; a count
 * printed any other way (dice, "1 or 2") stays text for the notes, since a
 * roster row holds a number. The hit points are the per-creature list where
 * the line prints one, else its single figure.
 * @returns {{quantity: number|null, countText: string, hp: number[]}}
 */
export function occupantFigures({ count = null, stats = null } = {}) {
  const quantity = Number.isInteger(count) && count > 0 ? count : null;
  const countText = quantity == null && count != null && String(count).trim() ? String(count).trim() : "";
  const hp = Array.isArray(stats?.hpList) && stats.hpList.length ? stats.hpList.filter(Number.isInteger)
    : Number.isInteger(stats?.hp) ? [stats.hp] : [];
  return { quantity, countText, hp };
}
