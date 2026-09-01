/**
 * A keyed area becomes a PLACE, not a page of prose.
 *
 * The obvious binding for "1. Abandoned Storefront" is a journal page, and it
 * is the wrong one. In this family a place is an actor — `LOCATION_TYPE`, the
 * location feature's own sub-type — with a parent it sits inside, a roster of
 * what lives there, contents, and optionally a market. An area imported as
 * prose can never grow any of that;
 * the Judge who later wants the storefront to hold the goods it sells, or to
 * nest under the dungeon it is part of, would have to build a second document
 * and keep the two in step by hand.
 *
 * So the room arrives as the thing a room is, and its TEXT arrives the way all
 * imported text does: read once from the Judge's own copy at import and written
 * into the room, page reference last.
 *
 * The adventure itself becomes a place too, and the rooms nest inside it. That
 * is what makes a keyed dungeon navigable as a dungeon rather than as
 * seventeen unrelated actors sharing a numbering convention.
 */

import { bookText } from "./prose.mjs";
import { MODULE_ID } from "./constants.mjs";
import { LOCATION_TYPE } from "../location/constants.mjs";
export { LOCATION_TYPE };

/**
 * Actor data for one keyed area. Pure — no Foundry calls.
 *
 * @param opts.entryId    cookbook id, stamped on the text this import writes
 * @param opts.paragraphs the room's printed text, one string per paragraph
 * @param opts.parentUuid the adventure's own location actor, when it exists
 * @returns Actor creation data of type `acks-extras.location`
 */
export function oseLocationData({
  name,
  entryId,
  paragraphs = [],
  cite = "",
  page = null,
  book = null,
  bookLabel = "",
  areaKey = "",
  parentUuid = "",
  folderId = null,
}) {
  return {
    name,
    type: LOCATION_TYPE,
    folder: folderId,
    system: {
      region: bookLabel,
      notes: bookText(paragraphs, cite || `${book ?? ""} p.${page ?? "?"}`.trim(), { id: entryId }),
      parentUuid,
    },
    flags: {
      [MODULE_ID]: {
        ose: {
          entryId,
          kind: "area",
          areaKey,
          sourceId: book,
          sourceLabel: bookLabel,
          page,
          origin: "page",
          unaudited: true,
        },
        // The same identity every other import writes, and what a second run
        // of the import asks before it builds a room again.
        cookbook: { id: entryId, book, kind: "kind.oseLocation", unaudited: true },
      },
    },
  };
}

/** The adventure's own id — one per book, so its rooms nest under one place. */
export const oseAdventureId = (book) => `${book}.adventure`;

/**
 * Actor data for the adventure the areas belong to.
 *
 * Created so the rooms have something to nest under. It carries no prose of its
 * own — the book's introduction is not a place — only the identity that makes
 * the nesting mean something on the sheet.
 */
export function oseAdventureData({ book, bookLabel, folderId = null }) {
  return {
    name: bookLabel || book,
    type: LOCATION_TYPE,
    folder: folderId,
    system: { region: bookLabel, notes: "", parentUuid: "" },
    flags: {
      [MODULE_ID]: {
        ose: { kind: "adventure", sourceId: book, sourceLabel: bookLabel, origin: "page" },
        cookbook: { id: oseAdventureId(book), book, kind: "kind.oseAdventure", unaudited: true },
      },
    },
  };
}
