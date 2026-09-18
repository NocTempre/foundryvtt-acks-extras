/**
 * Organisations in a settlement book — the Foundry-free half of binding them
 * to FACTIONS.
 *
 * A body becomes a faction ONE way: an authored `kind.organisation` row. The
 * row ships no word of the body's printed name — the faction is named, and its
 * notes filled, from the Judge's page when it is built — and says everything
 * else by id: the keyed place it is seated at, the places it holds, who leads
 * it and who belongs to it, the quarters it controls and how it stands to the
 * others, with this module's own words for what sort of body it is
 * (`FACTION_KINDS`) and for a stance (`RELATION_STANCES`).
 *
 * A person's `meta.group` says where in the book they were printed and nothing
 * more. It is never read for membership: a heading gathers everyone printed
 * under it, a body's quarry beside its members and a guest beside both, and
 * only a row that was read can tell them apart.
 */
import { MODULE_ID } from "./constants.mjs";
import { FACTION_KINDS, FACTION_TYPE, RELATION_STANCES } from "../factions/constants.mjs";
import { districtPlaceId, poiGroupOf } from "./poi-binding.mjs";

/** Whether a cookbook entry is an authored organisation. */
export const isOrganisationRow = (entry) => entry?.kind === "kind.organisation" && !!entry?.organisation && typeof entry.organisation === "object";

/**
 * An authored organisation's block, read defensively: the kind and every
 * stance held to this module's vocabulary, every list an array of ids, and
 * each quarter it controls turned into the id of that quarter's own place.
 *
 * A member is an id, or `{id, hidden}` where the page says the tie is kept
 * secret — a body that hides its whole membership rosters every one of them
 * concealed, and a person may belong openly to one body and secretly to
 * another. `hidden` gates DISPLAY, never access (`occupantField`), which is
 * why the roster row and the relation row spell it the same way.
 * @param {string} book
 * @param {object} entry the organisation's cookbook entry
 * @param {Record<string, object>} entries the book's cookbook entries
 * @returns {{kind: string, namedAfterSeat: boolean, seat: string, seatQuarter: string, holdings: string[], leader: string,
 *   members: {id: string, hidden: boolean}[], controls: string[], relations: {to: string, stance: string, hidden: boolean}[]}}
 */
export function organisationPlan(book, entry, entries = {}) {
  const o = entry?.organisation ?? {};
  const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : []);
  const quarterOf = (id) => poiGroupOf(entries[id]?.meta?.group)?.district ?? "";
  const person = (v) => {
    const id = typeof v === "string" ? v : typeof v?.id === "string" ? v.id : "";
    return id ? { id, hidden: (typeof v === "object" && v?.hidden === true) } : null;
  };
  const head = person(o.leader);
  // One row per person, and a tie is concealed when ANY spelling of it says so:
  // a body that names its head twice, once secretly, keeps the secret.
  const members = [];
  for (const p of [head, ...(Array.isArray(o.members) ? o.members : []).map(person)]) {
    if (!p) continue;
    const held = members.find((m) => m.id === p.id);
    if (held) held.hidden ||= p.hidden;
    else members.push(p);
  }
  const leader = head?.id ?? "";
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
    // Whoever leads it belongs to it, said once and first — and a leader the
    // book keeps secret is rostered secret, which is the one case where the
    // head of a body does not appear on its public roster.
    members,
    controls: [...new Set(ids(o.controls).map(quarterOf).filter(Boolean).map((q) => districtPlaceId(book, q)))],
    relations: (Array.isArray(o.relations) ? o.relations : [])
      .filter((r) => typeof r?.to === "string" && r.to && RELATION_STANCES.includes(r?.stance))
      .map((r) => ({ to: r.to, stance: r.stance, hidden: r.hidden === true })),
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
 * @param {string} [p.gmNotes] materialized book text
 * @param {{uuid: string, name: string}[]} [p.holdings]
 * @param {string[]} [p.controls] ids of the quarters' places
 */
export function organisationData({
  entryId, book, bookLabel = "", name, kind = "other", gmNotes = "", seatUuid = "", leaderUuid = "", holdings = [], controls = [], folderId = null,
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
      // A body's overview is written for the Judge, so it lands on the Judge's
      // side of the sheet. The public field is left for what the city is told:
      // the page states which ties are secret, and the roster's own concealment
      // counts for nothing beside a description that names the head it hides.
      notes: "",
      gmNotes,
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
