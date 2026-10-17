/**
 * The domain record, Foundry-free: the shape a domain's `system` holds, the
 * normaliser every writer passes it through, and the sums a sheet reads off
 * it. Nothing here knows a printed rate — a line the record does not state is
 * UNSET and stays out of every total, so a partial ledger is reported as
 * partial, never as a smaller number.
 */
import { ancestorUuids } from "../lib/place-logic.mjs";
import { ALIGNMENTS } from "../lib/vocab.mjs";
import { CLASSIFICATIONS, EXPENSE_LINES, HOLDING_ROLES, LINE_FIELDS, REVENUE_LINES } from "./constants.mjs";

const ALIGNMENT_KEYS = Object.freeze(Object.keys(ALIGNMENTS));

const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isIndex = (key) => /^\d+$/.test(key);

/** A finite number, or null for a blank, a non-number or nothing at all. */
export function figure(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A whole count of at least zero, or null where `figure` gives none. */
function countOrNull(v) {
  const n = figure(v);
  return n === null ? null : Math.max(0, Math.floor(n));
}

/** A whole count of at least zero; a blank is zero. */
const count = (v) => countOrNull(v) ?? 0;

const text = (v) => (v === null || v === undefined ? "" : String(v));
const pick = (v, list) => (list.includes(v) ? v : "");

/**
 * The rows of a list as an array, from an array or from the index-keyed object
 * a form submits for one (`{0: {...}, 1: {...}}`), in index order.
 */
export function rowsOf(value) {
  if (Array.isArray(value)) return [...value];
  if (!isRecord(value)) return [];
  return Object.keys(value).filter(isIndex).sort((a, b) => Number(a) - Number(b)).map((k) => value[k]);
}

/** Hex labels as a list of non-blank strings, from a list or from text split on commas, semicolons and spaces. */
export function labelsOf(value) {
  const raw = Array.isArray(value) || isRecord(value) ? rowsOf(value) : String(value ?? "").split(/[,;\s]+/);
  return raw.map((s) => String(s ?? "").trim()).filter(Boolean);
}

const defaultId = () => Math.random().toString(36).slice(2, 12);

/* -------------------------------------------- */
/*  Normalisers — one per row, one for the whole */
/* -------------------------------------------- */

/** One revenue or expense line: a rate per family and a flat figure for each side, and a note. */
export function normalizeLine(raw) {
  const line = isRecord(raw) ? raw : {};
  const out = Object.fromEntries(LINE_FIELDS.map((k) => [k, figure(line[k])]));
  out.note = text(line.note);
  return out;
}

/**
 * One tract of territory: a hex, or a run of hexes a record gives only in
 * total. `hexLabels` names the hexes where they are known; `count` is how many
 * there are where they are not, null when even that is unknown. `map` is
 * where a painted hex sits, null for a row nobody painted.
 */
export function normalizeTerritoryRow(raw, makeId = defaultId) {
  const r = isRecord(raw) ? raw : {};
  const map = isRecord(r.map) && (r.map.sceneUuid || r.map.key)
    ? { sceneUuid: text(r.map.sceneUuid), key: text(r.map.key) }
    : null;
  return {
    id: text(r.id) || makeId(),
    label: text(r.label),
    hexLabels: labelsOf(r.hexLabels),
    count: "count" in r ? countOrNull(r.count) : 1,
    map,
    landValue: figure(r.landValue),
    improvement: figure(r.improvement) ?? 0,
    families: count(r.families),
    revealed: !!r.revealed,
    note: text(r.note),
  };
}

/**
 * One held place, by reference. `families` and `marketClass` are a record's
 * figures for a place not yet on the map — a placed row reads both off its
 * place, and its own are ignored.
 */
export function normalizeHolding(raw) {
  const r = isRecord(raw) ? raw : {};
  const marketClass = countOrNull(r.marketClass);
  return {
    uuid: text(r.uuid),
    name: text(r.name),
    role: pick(r.role, HOLDING_ROLES) || "other",
    families: countOrNull(r.families),
    marketClass: marketClass !== null && marketClass >= 1 && marketClass <= 6 ? marketClass : null,
    investmentGp: figure(r.investmentGp) ?? 0,
    note: text(r.note),
    hidden: !!r.hidden,
  };
}

/** One structure of the stronghold. `costGp` is the row's whole cost, `count` units of it. */
export function normalizeStructure(raw, makeId = defaultId) {
  const r = isRecord(raw) ? raw : {};
  return {
    id: text(r.id) || makeId(),
    name: text(r.name),
    count: "count" in r ? count(r.count) : 1,
    ac: figure(r.ac),
    unitCapacity: figure(r.unitCapacity),
    shp: figure(r.shp),
    costGp: figure(r.costGp),
    note: text(r.note),
  };
}

/**
 * Classification keys, in vocabulary order, from a list of keys or from the
 * `{key: checked}` object a form's checkboxes submit.
 */
export function classesOf(value) {
  const keys = isRecord(value) && !Object.keys(value).some(isIndex)
    ? Object.keys(value).filter((k) => value[k] === true || value[k] === "true")
    : rowsOf(value);
  return CLASSIFICATIONS.filter((c) => keys.includes(c));
}

/** Hexes a vassal row names: a count, the labels where known, and the classifications they carry. */
function normalizeHexes(raw) {
  const r = isRecord(raw) ? raw : {};
  return { count: countOrNull(r.count), labels: labelsOf(r.labels), classes: classesOf(r.classes) };
}

/**
 * One vassal kept as a summary row — a vassal with no domain actor. A vassal
 * is an actor or a row, never both: the realm's sums read each once.
 */
export function normalizeVassalRow(raw, makeId = defaultId) {
  const r = isRecord(raw) ? raw : {};
  const fam = isRecord(r.families) ? r.families : {};
  return {
    id: text(r.id) || makeId(),
    name: text(r.name),
    rulerName: text(r.rulerName),
    families: { peasant: countOrNull(fam.peasant), urban: countOrNull(fam.urban) },
    realmFamilies: countOrNull(r.realmFamilies),
    revenueGp: figure(r.revenueGp),
    tributeGp: figure(r.tributeGp),
    extraTaxGp: figure(r.extraTaxGp) ?? 0,
    domainHexes: normalizeHexes(r.domainHexes),
    realmHexes: normalizeHexes(r.realmHexes),
    realmGarrisonGp: figure(r.realmGarrisonGp),
    favors: text(r.favors),
    duties: text(r.duties),
    note: text(r.note),
  };
}

/** One favor or duty the domain owes or is owed. */
export function normalizeBond(raw, makeId = defaultId) {
  const r = isRecord(raw) ? raw : {};
  return { id: text(r.id) || makeId(), label: text(r.label), note: text(r.note) };
}

/** One revenue or expense the named lines do not cover. A blank figure is unset. */
export function normalizeOtherLine(raw, makeId = defaultId) {
  const r = isRecord(raw) ? raw : {};
  return { id: text(r.id) || makeId(), label: text(r.label), gp: figure(r.gp) };
}

/** The lists of a domain record, each with the normaliser its rows go through. */
export const ROW_LISTS = Object.freeze({
  territory: normalizeTerritoryRow,
  holdings: normalizeHolding,
  structures: normalizeStructure,
  vassalRows: normalizeVassalRow,
  favors: normalizeBond,
  duties: normalizeBond,
  otherRevenue: normalizeOtherLine,
  otherExpenses: normalizeOtherLine,
});

/** The lines of one side of the ledger, every key present. */
function normalizeLines(raw, keys) {
  const src = isRecord(raw) ? raw : {};
  return Object.fromEntries(keys.map((k) => [k, normalizeLine(src[k])]));
}

/**
 * A domain record as the model stores it, from anything shaped like one: every
 * key present, every figure a number or null, every list an array of whole
 * rows with ids. The shape an importer hands `system` and the shape a sheet
 * writes are the same one.
 * @param {object} [raw]
 * @param {{makeId?: () => string}} [opts] the id a row without one is given
 */
export function normalizeDomain(raw, { makeId = defaultId } = {}) {
  const r = isRecord(raw) ? raw : {};
  const morale = isRecord(r.morale) ? r.morale : {};
  const intOrNull = (v) => {
    const n = figure(v);
    return n === null ? null : Math.trunc(n);
  };
  const out = {
    rulerUuid: text(r.rulerUuid),
    rulerName: text(r.rulerName),
    title: text(r.title),
    parentUuid: text(r.parentUuid),
    liegeName: text(r.liegeName),
    classification: pick(r.classification, CLASSIFICATIONS),
    alignment: pick(r.alignment, ALIGNMENT_KEYS),
    notes: text(r.notes),
    gmNotes: text(r.gmNotes),
    revenue: normalizeLines(r.revenue, REVENUE_LINES),
    expenses: normalizeLines(r.expenses, EXPENSE_LINES),
    tributeGp: figure(r.tributeGp),
    morale: { current: intOrNull(morale.current), base: intOrNull(morale.base) },
  };
  for (const [key, normalize] of Object.entries(ROW_LISTS)) out[key] = rowsOf(r[key]).map((row) => normalize(row, makeId));
  return out;
}

/** The record of a domain with nothing in it — every field at its starting value. */
export const blankDomain = () => normalizeDomain({}, { makeId: () => "" });

/* -------------------------------------------- */
/*  Sums                                         */
/* -------------------------------------------- */

/** Peasant families: the sum of the territory rows. */
export function peasantFamiliesOf(territory) {
  return rowsOf(territory).reduce((sum, row) => sum + count(row?.families), 0);
}

/**
 * How many hexes the territory covers: a row's labels where it names them,
 * its count where it does not. `unknown` counts the rows that give neither.
 * @returns {{total: number, unknown: number}}
 */
export function hexCountOf(territory) {
  let total = 0;
  let unknown = 0;
  for (const row of rowsOf(territory)) {
    const labels = labelsOf(row?.hexLabels);
    const n = labels.length || countOrNull(row?.count);
    if (n === null) unknown += 1;
    else total += n;
  }
  return { total, unknown };
}

/**
 * Urban families: the sum over the settlements held. A placed settlement's
 * figure is its place's, read through `placeFamilies(uuid)`; an unplaced one's
 * is the row's own. `unknown` counts the settlements with no figure, so a
 * town whose families nobody has entered is not counted as empty.
 * @param {(uuid: string) => number|null|undefined} [placeFamilies]
 * @returns {{total: number, unknown: number}}
 */
export function urbanFamiliesOf(holdings, placeFamilies = () => null) {
  let total = 0;
  let unknown = 0;
  for (const row of rowsOf(holdings)) {
    if (row?.role !== "settlement") continue;
    const n = countOrNull(row.uuid ? placeFamilies(row.uuid) : row.families);
    if (n === null) unknown += 1;
    else total += n;
  }
  return { total, unknown };
}

/** The stronghold's value: the sum of the structures' costs. `unknown` counts the rows with no cost. */
export function strongholdValueOf(structures) {
  let total = 0;
  let unknown = 0;
  for (const row of rowsOf(structures)) {
    const gp = figure(row?.costGp);
    if (gp === null) unknown += 1;
    else total += gp;
  }
  return { total, unknown };
}

/**
 * What one line comes to. Each side is its flat figure where one is set, its
 * rate times its families where a rate is, and null where neither is. A rate
 * over an unknown count of families is `unknown`: set, but not summable.
 * @param {object} line
 * @param {{peasant: number|null, urban: number|null}} families
 * @returns {{peasant: number|null, urban: number|null, total: number|null, set: boolean, unknown: boolean}}
 */
export function lineAmount(line, families) {
  const l = normalizeLine(line);
  let unknown = false;
  const side = (gp, per, fam) => {
    if (gp !== null) return gp;
    if (per === null) return null;
    if (fam === null || fam === undefined) {
      unknown = true;
      return null;
    }
    return per * fam;
  };
  const peasant = side(l.peasantGp, l.peasantPer, families?.peasant);
  const urban = side(l.urbanGp, l.urbanPer, families?.urban);
  const set = LINE_FIELDS.some((k) => l[k] !== null);
  const total = peasant === null && urban === null ? null : (peasant ?? 0) + (urban ?? 0);
  return { peasant, urban, total, set, unknown };
}

/**
 * Tribute in: what the vassals pay, from their summary rows and from the
 * vassal domains' own tribute out. A row's payment is its tribute and its
 * extra tax; a vassal whose tribute is unset is `unknown`.
 * @param {object[]} vassalRows
 * @param {{tributeGp: number|null}[]} vassalDomains plain records of the vassal actors
 * @returns {{total: number, unknown: number, count: number}}
 */
export function tributeInOf(vassalRows, vassalDomains = []) {
  let total = 0;
  let unknown = 0;
  const rows = rowsOf(vassalRows);
  for (const row of rows) {
    const gp = figure(row?.tributeGp);
    if (gp === null) unknown += 1;
    else total += gp + (figure(row?.extraTaxGp) ?? 0);
  }
  for (const vassal of vassalDomains ?? []) {
    const gp = figure(vassal?.tributeGp);
    if (gp === null) unknown += 1;
    else total += gp;
  }
  return { total, unknown, count: rows.length + (vassalDomains?.length ?? 0) };
}

/**
 * The domain's month as the record states it: each line's amount, tribute in
 * and out, the other lines, and the totals over what is known. `unset` counts
 * the lines with no figure at all and `unknown` the lines whose rate meets an
 * unknown count of families; either one makes the ledger `partial`, and the
 * totals then say "at least", never "exactly".
 * @param {object} record a normalised domain record
 * @param {{families: {peasant: number|null, urban: number|null}, vassalDomains?: object[]}} ctx
 */
export function ledgerOf(record, { families, vassalDomains = [] } = {}) {
  const rec = normalizeDomain(record, { makeId: () => "" });
  const fam = families ?? { peasant: peasantFamiliesOf(rec.territory), urban: null };
  let unset = 0;
  let unknown = 0;
  const side = (lines, keys) => keys.map((key) => {
    const amount = lineAmount(lines[key], fam);
    if (!amount.set) unset += 1;
    if (amount.unknown) unknown += 1;
    return { key, ...amount, note: lines[key].note };
  });
  const others = (rows) => rows.map((row) => {
    if (row.gp === null) unset += 1;
    return row;
  });
  const revenue = side(rec.revenue, REVENUE_LINES);
  const expenses = side(rec.expenses, EXPENSE_LINES);
  const otherRevenue = others(rec.otherRevenue);
  const otherExpenses = others(rec.otherExpenses);

  const tributeIn = tributeInOf(rec.vassalRows, vassalDomains);
  unknown += tributeIn.unknown;
  // Tribute is owed only where there is a lord to owe it to.
  const owed = !!(rec.parentUuid || rec.liegeName);
  const tributeOut = { owed, gp: owed ? rec.tributeGp : 0 };
  if (owed && rec.tributeGp === null) unset += 1;

  const sum = (rows, key) => rows.reduce((s, r) => s + (r[key] ?? 0), 0);
  const revenueTotal = sum(revenue, "total") + sum(otherRevenue, "gp") + tributeIn.total;
  const expenseTotal = sum(expenses, "total") + sum(otherExpenses, "gp") + (tributeOut.gp ?? 0);
  return {
    families: fam,
    revenue,
    expenses,
    otherRevenue,
    otherExpenses,
    tributeIn,
    tributeOut,
    totals: { revenue: revenueTotal, expenses: expenseTotal, income: revenueTotal - expenseTotal },
    unset,
    unknown,
    partial: unset + unknown > 0,
  };
}

/* -------------------------------------------- */
/*  The realm and what it holds                  */
/* -------------------------------------------- */

/** A plain domain record, the shape the realm walks read. */
export function domainRecord(doc) {
  const sys = doc?.system ?? {};
  return {
    uuid: doc?.uuid ?? "",
    name: doc?.name ?? "",
    parentUuid: sys.parentUuid ?? "",
    rulerUuid: sys.rulerUuid ?? "",
    tributeGp: figure(sys.tributeGp),
    holdings: rowsOf(sys.holdings).map((r) => r?.toObject?.() ?? r),
  };
}

/**
 * Would making `liegeUuid` this domain's liege close a loop? A domain cannot
 * be its own liege, nor its own vassal's vassal.
 * @param {Map<string, {parentUuid: string}>} index domain records by uuid (`indexPlaces`)
 */
export function wouldCycleDomain(uuid, liegeUuid, index) {
  if (!uuid || !liegeUuid) return false;
  if (uuid === liegeUuid) return true;
  return ancestorUuids(liegeUuid, index).includes(uuid);
}

/** Does this record hold exactly this place? */
export const holdsIn = (record, placeUuid) => !!placeUuid && rowsOf(record?.holdings).some((h) => h?.uuid === placeUuid);

/**
 * The domain a place belongs to: the one holding the place itself, else the
 * one holding the nearest place it is inside of. `chain` is the place's uuid
 * followed by its ancestors, nearest first.
 */
export function domainHolding(records, chain) {
  for (const uuid of chain ?? []) {
    const found = (records ?? []).find((r) => holdsIn(r, uuid));
    if (found) return found;
  }
  return null;
}

/** The record already holding a place, other than `domainUuid` — the one a second hold would collide with. */
export function holdConflict(records, domainUuid, placeUuid) {
  return (records ?? []).find((r) => r.uuid !== domainUuid && holdsIn(r, placeUuid)) ?? null;
}
