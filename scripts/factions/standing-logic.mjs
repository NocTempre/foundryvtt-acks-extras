/**
 * Standing: the pure derivations. Foundry-free, so the tests and a macro can
 * ask them without a world.
 *
 * A faction's ledger is rows of `{subject: {scope, uuid}, value, source}`. A
 * SUBJECT SET is what a reader holds about one side of a dealing — the party
 * actor's uuid, every member's, and every organisation that side answers for —
 * and a row counts for that set when its scope names everyone, the party, one
 * of the characters, or one of those organisations. One row matches at most
 * one branch, so a party-wide favour and a member's own offence are two rows
 * and never one counted twice — the same shape the location feature's slander
 * registry keeps.
 *
 * RELATIONS are the other half and carry no arithmetic: one organisation's
 * stance toward another is a label and a note, read here and never summed.
 */
import { ancestorUuids } from "../lib/place-logic.mjs";

/**
 * The subject set for one side of a dealing. `factionUuids` are the
 * organisations this side answers for — the ones it belongs to, and itself
 * when it IS one — so a row written about an organisation reaches every
 * person of it.
 * @param {{partyUuid?: string, memberUuids?: string[], factionUuids?: string[]}} parts
 * @returns {{partyUuid: string, characterUuids: string[], factionUuids: string[]}}
 */
export function subjectsOf({ partyUuid = "", memberUuids = [], factionUuids = [] } = {}) {
  const uuids = (list) => [...new Set((list ?? []).filter((u) => typeof u === "string" && u))];
  return {
    partyUuid: partyUuid || "",
    characterUuids: uuids(memberUuids),
    factionUuids: uuids(factionUuids),
  };
}

/** Does a row's subject name anyone in this subject set? */
export function matchesSubject(subject, subjects) {
  const scope = subject?.scope ?? "all";
  const uuid = subject?.uuid ?? "";
  if (scope === "all") return true;
  if (scope === "party") return !!uuid && uuid === (subjects?.partyUuid ?? "");
  if (scope === "character") return !!uuid && (subjects?.characterUuids ?? []).includes(uuid);
  if (scope === "faction") return !!uuid && (subjects?.factionUuids ?? []).includes(uuid);
  return false;
}

/**
 * The standing a ledger holds toward a subject set: the sum of every matching
 * row's value, optionally of one source only.
 */
export function sumStanding(rows, subjects, { source = null } = {}) {
  let total = 0;
  for (const row of rows ?? []) {
    if (source && row?.source !== source) continue;
    if (!matchesSubject(row?.subject, subjects)) continue;
    total += Number(row?.value) || 0;
  }
  return total;
}

/** The rows of a ledger that name this subject set, in ledger order. */
export function rowsFor(rows, subjects, { source = null } = {}) {
  return (rows ?? []).filter((row) => (!source || row?.source === source) && matchesSubject(row?.subject, subjects));
}

/** Does a ledger hold a `wanted` row for anyone in this subject set? */
export function isWanted(rows, subjects) {
  return (rows ?? []).some((row) => row?.source === "wanted" && matchesSubject(row?.subject, subjects));
}

/**
 * Among plain faction records `{uuid, controls, standing}`, the ones that
 * control a region AND want someone in the subject set — the hunters of a
 * quarter.
 */
export function huntersAmong(factions, regionUuid, subjects) {
  if (!regionUuid) return [];
  return (factions ?? []).filter((f) => (f?.controls ?? []).includes(regionUuid) && isWanted(f?.standing, subjects));
}

/**
 * How many market-class steps a standing sum is worth at a given step size.
 * Toward the LARGER market for good standing, the smaller for bad; a step of
 * zero (the default) prices nothing. Whole steps only — a standing short of
 * the step moves nothing rather than rounding up to a market it has not
 * earned.
 */
export function classStepsFor(sum, step) {
  const size = Number(step) || 0;
  if (size <= 0) return 0;
  return Math.trunc((Number(sum) || 0) / size);
}

/**
 * Would making `parentUuid` the parent of the faction `uuid` close a loop?
 * The place layer's walk, over an index of `{uuid, parentUuid}` records.
 */
export function wouldCycleFaction(uuid, parentUuid, index) {
  if (!uuid || !parentUuid) return false;
  if (uuid === parentUuid) return true;
  return ancestorUuids(parentUuid, index).includes(uuid);
}

/** A plain faction record, the shape the pure derivations read. */
export function factionRecord(doc) {
  const rows = (list) => (list ?? []).map((r) => r?.toObject?.() ?? r);
  return {
    uuid: doc?.uuid ?? "",
    name: doc?.name ?? "",
    kind: doc?.system?.kind ?? "other",
    parentUuid: doc?.system?.parentUuid ?? "",
    seatUuid: doc?.system?.seatUuid ?? "",
    controls: [...(doc?.system?.controls ?? [])],
    standing: rows(doc?.system?.standing),
    members: rows(doc?.system?.members),
    holdings: rows(doc?.system?.holdings),
    relations: rows(doc?.system?.relations),
  };
}

/** A record's own row about another organisation, or null when it holds none. */
export function relationOf(record, otherUuid) {
  if (!otherUuid) return null;
  return (record?.relations ?? []).find((r) => r?.uuid === otherUuid) ?? null;
}

/**
 * The REVERSE view: what the other organisations in a set say about this one.
 * One entry per other record that names the uuid, carrying that record's own
 * identity rather than the row's — the row's `name` is a copy of this side's,
 * and what a reader of the reverse list wants to know is who holds the
 * opinion.
 * @returns {{uuid: string, name: string, stance: string, note: string, hidden: boolean}[]}
 */
export function regardedBy(records, uuid) {
  if (!uuid) return [];
  const out = [];
  for (const record of records ?? []) {
    if (!record || record.uuid === uuid) continue;
    const row = relationOf(record, uuid);
    if (!row) continue;
    out.push({
      uuid: record.uuid ?? "",
      name: record.name ?? "",
      stance: row.stance ?? "neutral",
      note: row.note ?? "",
      hidden: !!row.hidden,
    });
  }
  return out;
}

/** Every place a record is behind the door of: its seat first, then its holdings, deduped. */
export function placesHeld(record) {
  const held = [record?.seatUuid ?? "", ...(record?.holdings ?? []).map((h) => h?.uuid ?? "")];
  return [...new Set(held.filter((u) => !!u))];
}

/**
 * The rows of a list a reader is allowed to read. Concealment is a DISPLAY
 * rule and never an access one: the Judge holds every row, and a row the city
 * is not supposed to know is simply left out of everyone else's copy.
 * @param {object[]} rows stored rows, model-backed or plain
 * @returns {object[]} plain copies, safe to decorate
 */
export function readableRows(rows, isGM) {
  return (rows ?? []).map((r) => r?.toObject?.() ?? r).filter((row) => isGM || !row?.hidden);
}

/**
 * The head a reader is allowed to be told. A secret head is a concealed member
 * row like any other, so a reader who cannot see the row is not told the office
 * either — naming the leader beside a roster the leader is missing from
 * publishes exactly the tie the row conceals.
 * @param {{leaderUuid?: string, members?: object[]}} sys
 * @returns {string} the uuid to show, or "" when the office is not this reader's
 */
export function readableLeaderUuid(sys, isGM) {
  const leaderUuid = sys?.leaderUuid ?? "";
  if (isGM || !leaderUuid) return leaderUuid;
  const row = (sys.members ?? []).map((r) => r?.toObject?.() ?? r).find((m) => m?.uuid === leaderUuid);
  return row?.hidden ? "" : leaderUuid;
}

/** Headcount over a set of roster rows: each row is worth its quantity, or one. */
export function headcountOf(rows) {
  return (rows ?? []).reduce((sum, row) => sum + (Number(row?.quantity) > 0 ? Number(row.quantity) : 1), 0);
}

/* -------------------------------------------- */
/*  Strength — the unnamed people, counted        */
/* -------------------------------------------- */

const count = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);

/**
 * A strength block as the model stores it, from anything shaped like one: a
 * column per entry of `columns`, every row's `counts` cut or padded to that
 * width, a level that is a whole number or null, a revenue that is a number or
 * null. The shape a sheet rewrites and the importer writes are the same one.
 * @param {object} [raw] `{columns: ({label}|string)[], rows: {level, label, counts, revenue}[], note, hidden}`
 * @returns {{columns: {label: string}[], rows: {level: number|null, label: string, counts: number[], revenue: number|null}[], note: string, hidden: boolean}}
 */
export function normalizeStrength(raw) {
  const columns = (Array.isArray(raw?.columns) ? raw.columns : [])
    .map((c) => ({ label: String((typeof c === "string" ? c : c?.label) ?? "").trim() }));
  const width = columns.length;
  const rows = (Array.isArray(raw?.rows) ? raw.rows : [])
    .filter((r) => r && typeof r === "object")
    .map((r) => {
      const level = Number(r.level);
      const revenue = Number(r.revenue);
      const counts = Array.from({ length: width }, (_, i) => count((Array.isArray(r.counts) ? r.counts : [])[i]));
      return {
        level: r.level === null || r.level === undefined || r.level === "" || !Number.isFinite(level) || level < 0 ? null : Math.floor(level),
        label: String(r.label ?? "").trim(),
        counts,
        revenue: r.revenue === null || r.revenue === undefined || r.revenue === "" || !Number.isFinite(revenue) ? null : revenue,
      };
    });
  return { columns, rows, note: String(raw?.note ?? "").trim(), hidden: raw?.hidden === true };
}

/** Everyone the strength block counts, over every column and row. */
export function strengthTotal(strength) {
  return (strength?.rows ?? []).reduce((sum, r) => sum + (r?.counts ?? []).reduce((s, n) => s + count(n), 0), 0);
}

/** The total under each column, in column order. */
export function strengthColumnTotals(strength) {
  const width = (strength?.columns ?? []).length;
  const totals = Array.from({ length: width }, () => 0);
  for (const r of strength?.rows ?? []) for (let i = 0; i < width; i++) totals[i] += count(r?.counts?.[i]);
  return totals;
}

/** The revenue the rows state, summed; null when no row states one. */
export function strengthRevenue(strength) {
  let any = false;
  let sum = 0;
  for (const r of strength?.rows ?? []) {
    const v = Number(r?.revenue);
    if (r?.revenue === null || r?.revenue === undefined || !Number.isFinite(v)) continue;
    any = true;
    sum += v;
  }
  return any ? sum : null;
}
