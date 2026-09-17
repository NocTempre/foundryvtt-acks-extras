/**
 * Points of interest — the half that needs no world.
 *
 * A STATIC point of interest is a place actor's own token, and the location
 * feature already answers which one the party is standing at. A TRANSIENT one
 * is a marker dropped where an incident landed, which the world clock takes
 * away again. What is decided here is decidable from data alone: whether two
 * quarters touch, what a hop between two points costs in turns, when a marker
 * has expired, and how a marker is labelled and what it is promoted into.
 * [poi.mjs](./poi.mjs) is the half that needs a scene.
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { pointSegmentDistance } from "../lib/wall-geometry.mjs";
import { LOCATION_TYPE } from "../location/constants.mjs";

/** The flag a transient marker carries, under the module's scope on the Note. */
export const TRANSIENT_FLAG = "transient";

/** How a hop between two points relates to the quarters drawn over them. */
export const DISTRICT_RELATION = Object.freeze({
  SAME: "same",
  ADJACENT: "adjacent",
  /** Two quarters that do not touch: the printed figures give no price for it. */
  FAR: "far",
  /** One end stands in no quarter at all. */
  OUTSIDE: "outside",
});

/**
 * Do two outlines meet along a boundary?
 *
 * A corner of either within `tolerance` of an edge of the other is a shared
 * boundary: two quarters drawn by hand along one street meet on a line that is
 * never quite the same line twice, and two straight edges that overlap always
 * put one of their ends on the other. Two quarters that meet at a single
 * corner count too — a corner is on an edge.
 *
 * @param {number[][]} ringsA outlines as flat `[x0, y0, x1, y1, …]` rings
 * @param {number[][]} ringsB
 */
export function ringsTouch(ringsA, ringsB, tolerance = 8) {
  const edgesOf = (rings) => {
    const out = [];
    for (const ring of rings ?? []) {
      const n = Math.floor((ring?.length ?? 0) / 2);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        out.push([ring[i * 2], ring[i * 2 + 1], ring[j * 2], ring[j * 2 + 1]]);
      }
    }
    return out;
  };
  const cornersOf = (rings) => {
    const out = [];
    for (const ring of rings ?? []) for (let i = 0; i + 1 < ring.length; i += 2) out.push([ring[i], ring[i + 1]]);
    return out;
  };
  const edgesA = edgesOf(ringsA);
  const edgesB = edgesOf(ringsB);
  if (!edgesA.length || !edgesB.length) return false;
  const meets = (corners, edges) =>
    corners.some(([x, y]) => edges.some((seg) => pointSegmentDistance(x, y, seg) <= tolerance));
  return meets(cornersOf(ringsA), edgesB) || meets(cornersOf(ringsB), edgesA);
}

/**
 * How two district lookups relate: the same quarter, two that touch, two that
 * do not, or no quarter at one end. `touch` is asked only for two different
 * quarters.
 */
export function districtRelation(a, b, { touch = () => false } = {}) {
  if (!a || !b) return DISTRICT_RELATION.OUTSIDE;
  if (a === b || (a.id != null && a.id === b.id)) return DISTRICT_RELATION.SAME;
  return touch(a, b) ? DISTRICT_RELATION.ADJACENT : DISTRICT_RELATION.FAR;
}

/**
 * What a hop costs in turns, from the imported district-travel figures.
 *
 * The figures are `{same: {<pace>: turns}, adjacent: {<pace>: turns}}` as the
 * importer assembles them. A hop the table does not price answers null and
 * says why, so the panel can name the missing figure rather than a distance
 * of nothing.
 * @returns {{turns: number|null, missing: ""|"relation"|"table"|"pace"}}
 */
export function poiTravelTurns(districtTravel, relation, pace) {
  if (relation !== DISTRICT_RELATION.SAME && relation !== DISTRICT_RELATION.ADJACENT) {
    return { turns: null, missing: "relation" };
  }
  if (!districtTravel) return { turns: null, missing: "table" };
  const figure = Number(districtTravel?.[relation]?.[pace]);
  if (!Number.isFinite(figure) || figure < 0) return { turns: null, missing: "pace" };
  return { turns: Math.floor(figure), missing: "" };
}

/**
 * A marker's label: the incident's opening words, cut to what fits under an
 * icon. A cap on the LABEL only — the whole text rides in the flag.
 */
export function noteLabel(text, cap = 60) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= cap) return s;
  const cut = s.slice(0, cap);
  const at = cut.lastIndexOf(" ");
  return `${at > cap / 2 ? cut.slice(0, at) : cut}…`;
}

/**
 * The Note a transient incident is dropped as.
 *
 * No journal entry: a Note that has none and was authored by a Judge is one
 * core shows to nobody else, so the marker is Judge-only by construction and
 * needs no document of its own to hide behind. `expiresAt` is in world
 * seconds, which is what the clock watcher compares.
 */
export function transientNoteData({
  x, y, text, now, turns, turnSeconds, icon,
  source = "city", table = "", formationId = null, regionUuid = null,
}) {
  return {
    x,
    y,
    text: noteLabel(text),
    entryId: null,
    pageId: null,
    global: false,
    texture: { src: icon },
    flags: {
      [MODULE_ID]: {
        [TRANSIENT_FLAG]: {
          text: String(text ?? ""),
          rolledAt: now,
          expiresAt: now + Math.max(0, turns) * turnSeconds,
          source,
          table,
          formationId,
          regionUuid,
        },
      },
    },
  };
}

/** The transient record on a note, or null for a note that is not one. */
export const transientOf = (note) => note?.flags?.[MODULE_ID]?.[TRANSIENT_FLAG] ?? null;

/** The ids of the notes whose time is up at `now`. */
export function expiredNoteIds(notes, now) {
  const out = [];
  for (const note of notes ?? []) {
    const t = transientOf(note);
    if (!t) continue;
    const at = Number(t.expiresAt);
    if (Number.isFinite(at) && at <= now) out.push(note.id);
  }
  return out;
}

const escapeText = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * The place a marker is promoted into: a location actor named by the Judge,
 * carrying the incident's text as its notes, inside the quarter's place when
 * the quarter has one and the city's otherwise. The name falls back to the
 * marker's own label, so a Judge who accepts the dialog as it opens gets the
 * words they were looking at.
 */
export function promotedPlaceData({ name = "", text = "", parentUuid = "", img = "" }) {
  const body = escapeText(text);
  return {
    name: String(name ?? "").trim() || noteLabel(text),
    type: LOCATION_TYPE,
    ...(img ? { img } : {}),
    system: { notes: body ? `<p>${body}</p>` : "", parentUuid: parentUuid ?? "" },
  };
}
