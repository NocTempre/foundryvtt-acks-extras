/**
 * Organisations in a settlement book — the Foundry-free half of binding them
 * to FACTIONS.
 *
 * A gazetteer names its organisations two ways, and both become faction actors.
 *
 * An AUTHORED organisation (`kind.organisation`) is one the book introduces by
 * name in its own prose. Its row ships no word of that name: the faction is
 * named, and its notes filled, from the Judge's page when it is built. The row's
 * block says the rest by id — the keyed place it is seated at, the places it
 * holds, who leads it and who belongs to it, the quarters it controls and how
 * it stands to the others — with this module's own words for what sort of body
 * it is (`FACTION_KINDS`) and for a stance (`RELATION_STANCES`).
 *
 * A GROUP organisation is one the register only knows as a heading its people
 * are keyed under: "<Quarter> — <Organisation>" for one seated in a quarter,
 * "NPC Party — <Name>" for a company on the move. The people under the group
 * are its members and it is seated in the quarter's own place (the city's, for
 * a party with no quarter). Nothing on the page says what such a group is to
 * the law, so it lands as `other`, for the Judge. Where an authored
 * organisation says it IS such a group (`replaces`, naming one of the group's
 * people), the group makes no faction of its own: a group heading gathers
 * everyone printed under it, the body's quarry beside its members, and only a
 * row that was read can tell them apart.
 *
 * The two group shapes a quarter prints for its places and residents are the
 * place binding's (`poi-binding.mjs`) and are never organisations.
 */
import { MODULE_ID } from "./constants.mjs";
import { FACTION_KINDS, FACTION_TYPE, RELATION_STANCES } from "../factions/constants.mjs";
import { districtPlaceId, poiGroupOf } from "./poi-binding.mjs";

/** The group head a settlement book prints for a company with no quarter. */
const PARTY_HEAD = "NPC Party";

const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");

/**
 * Which organisation a group names and the quarter it is seated in — "" for
 * a company on the move — or null for a group of any other shape, the
 * quarter's own places and residents included.
 * @returns {{district: string, name: string, roaming: boolean}|null}
 */
export function organisationGroupOf(group) {
  const text = String(group ?? "").trim();
  if (poiGroupOf(text)) return null;
  const m = /^(.+?)\s+—\s+(.+?)$/u.exec(text);
  if (!m) return null;
  const head = m[1].trim();
  const name = m[2].trim();
  if (!head || !name) return null;
  return head === PARTY_HEAD ? { district: "", name, roaming: true } : { district: head, name, roaming: false };
}

/** Whether a cookbook entry is a PERSON keyed under an organisation: a member. */
export const isOrganisationEntry = (entry) => entry?.kind === "kind.npc" && !!organisationGroupOf(entry?.meta?.group);

/** Whether a cookbook entry is an authored organisation. */
export const isOrganisationRow = (entry) => entry?.kind === "kind.organisation" && !!entry?.organisation && typeof entry.organisation === "object";

/** The cookbook id a GROUP organisation is claimed under: one per book, quarter and name. */
export const factionId = (book, { district = "", name }) => `${book}.faction.${slug([district, name].filter(Boolean).join(" "))}`;

/**
 * The group organisations a book's authored ones stand in for, as the ids they
 * would have been claimed under.
 * @param {string} book
 * @param {Record<string, object>} entries the book's cookbook entries
 * @returns {Set<string>}
 */
export function replacedFactionIds(book, entries) {
  const out = new Set();
  for (const entry of Object.values(entries ?? {})) {
    if (!isOrganisationRow(entry)) continue;
    for (const personId of entry.organisation.replaces ?? []) {
      const org = organisationGroupOf(entries[personId]?.meta?.group);
      if (org) out.add(factionId(book, org));
    }
  }
  return out;
}

/**
 * An authored organisation's block, read defensively: the kind and every
 * stance held to this module's vocabulary, every list an array of ids, and
 * each quarter it controls turned into the id of that quarter's own place.
 * @param {string} book
 * @param {object} entry the organisation's cookbook entry
 * @param {Record<string, object>} entries the book's cookbook entries
 * @returns {{kind: string, namedAfterSeat: boolean, seat: string, seatQuarter: string, holdings: string[], leader: string,
 *   members: string[], controls: string[], relations: {to: string, stance: string, hidden: boolean}[]}}
 */
export function organisationPlan(book, entry, entries = {}) {
  const o = entry?.organisation ?? {};
  const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : []);
  const quarterOf = (id) => poiGroupOf(entries[id]?.meta?.group)?.district ?? "";
  const members = ids(o.members);
  const leader = typeof o.leader === "string" ? o.leader : "";
  return {
    kind: FACTION_KINDS.includes(o.kind) ? o.kind : "other",
    // Named after the place it keeps: the entry's name is that place's keyed
    // heading, and the key number is the place's, not the body's.
    namedAfterSeat: o.nameFrom === "seat",
    seat: typeof o.seat === "string" ? o.seat : "",
    // The quarter the seat stands in: where the organisation is seated until
    // its own keyed place has been imported.
    seatQuarter: quarterOf(o.seat),
    holdings: ids(o.holdings),
    leader,
    // Whoever leads it belongs to it, said once.
    members: leader && !members.includes(leader) ? [leader, ...members] : members,
    controls: [...new Set(ids(o.controls).map(quarterOf).filter(Boolean).map((q) => districtPlaceId(book, q)))],
    relations: (Array.isArray(o.relations) ? o.relations : [])
      .filter((r) => typeof r?.to === "string" && r.to && RELATION_STANCES.includes(r?.stance))
      .map((r) => ({ to: r.to, stance: r.stance, hidden: r.hidden === true })),
  };
}

/**
 * Actor data for one GROUP organisation. No prose of its own — its people
 * carry the book's text — and no holdings: the Judge draws the quarter it
 * controls, if it controls one, on the sheet.
 */
export function factionData({ book, bookLabel = "", name, district = "", seatUuid = "", folderId = null }) {
  return {
    name,
    type: FACTION_TYPE,
    img: "icons/svg/hanging-sign.svg",
    folder: folderId,
    system: { kind: "other", seatUuid, notes: "", members: [] },
    flags: {
      [MODULE_ID]: {
        cookbook: { id: factionId(book, { district, name }), book, kind: "kind.faction", unaudited: true, bookLabel },
      },
    },
  };
}

/**
 * Actor data for one AUTHORED organisation, claimed under its entry's own id.
 * The quarters it controls ride on the flag as the ids of those quarters'
 * places: a Region only exists once a map does, so the map step turns them
 * into the regions it draws (`controlledRegions`).
 * @param {object} p
 * @param {string} p.entryId the organisation's cookbook id
 * @param {string} p.name as read off the page, or the entry's label
 * @param {string} [p.notes] materialized book text
 * @param {{uuid: string, name: string}[]} [p.holdings]
 * @param {string[]} [p.controls] ids of the quarters' places
 */
export function organisationData({
  entryId, book, bookLabel = "", name, kind = "other", notes = "", seatUuid = "", leaderUuid = "", holdings = [], controls = [], folderId = null,
}) {
  return {
    name,
    type: FACTION_TYPE,
    img: "icons/svg/hanging-sign.svg",
    folder: folderId,
    system: {
      kind: FACTION_KINDS.includes(kind) ? kind : "other",
      seatUuid,
      leaderUuid,
      notes,
      holdings: holdings.filter((h) => h?.uuid).map((h) => ({ uuid: h.uuid, name: h.name ?? "", note: "", hidden: false })),
      members: [],
    },
    flags: {
      [MODULE_ID]: {
        cookbook: { id: entryId, book, kind: "kind.faction", unaudited: true, bookLabel, ...(controls.length ? { controls } : {}) },
      },
    },
  };
}

/**
 * The relation rows an organisation is still owed: one per planned relation
 * whose other end exists and which the sheet does not already carry. A row the
 * Judge has rewritten is the Judge's, so a held uuid is never touched.
 * @param {{uuid: string}[]} held the faction's current relation rows
 * @param {{to: string, stance: string, hidden: boolean}[]} planned
 * @param {Map<string, {uuid: string, name: string}>} factions built organisations by cookbook id
 * @param {string} [note] a page reference for the row
 */
export function owedRelations(held, planned, factions, note = "") {
  const have = new Set((held ?? []).map((r) => r?.uuid).filter(Boolean));
  const rows = [];
  for (const r of planned ?? []) {
    const other = factions.get(r.to);
    if (!other?.uuid || have.has(other.uuid)) continue;
    have.add(other.uuid);
    rows.push({ uuid: other.uuid, name: other.name ?? "", stance: r.stance, note, hidden: r.hidden });
  }
  return rows;
}

/**
 * The Regions a faction controls once a map is drawn: what it already held
 * that still exists, and the region of every quarter its flag names.
 * @param {string[]} held the faction's current `controls`
 * @param {string[]} quarterIds the quarters' place ids off the faction's flag
 * @param {Map<string, string>} regionOf quarter place id to the new map's Region uuid
 * @param {(uuid: string) => boolean} exists whether a held Region is still a document
 * @returns {string[]|null} the list to write, or null when it would not change
 */
export function controlledRegions(held, quarterIds, regionOf, exists) {
  const kept = (held ?? []).filter((uuid) => exists(uuid));
  const next = [...new Set([...kept, ...(quarterIds ?? []).map((q) => regionOf.get(q)).filter(Boolean)])];
  const same = next.length === (held ?? []).length && next.every((uuid, i) => uuid === held[i]);
  return same ? null : next;
}
