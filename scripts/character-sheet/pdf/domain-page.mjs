/**
 * The official sheet's domain page, read into a domain record and written
 * back from one. Foundry-free: the import and the export hand it the domain's
 * record and what the world works out for it, and write what it returns.
 *
 * The page's boxes split three ways. Those a domain keeps a field for become
 * the record: the name, the ruler, the region, the structures, the hexes, the
 * revenue and expense lines, tribute out, morale, the lord's favors and
 * duties, and the vassals. Those the domain works out for itself (its
 * families and hexes, the stronghold's totals, tribute in and the month's
 * total) are checks, the sheet's figure beside the record's. The rest
 * (`UNMODELLED_KEYS`, and each hex's revenue) have no field, and ride the
 * import's record and a notes block on the domain.
 *
 * Every label goes through the caller's `label(key, data)`: keys under
 * `line.` and `classification.` are the domain's own vocabulary, the rest
 * name a box or a reason.
 */
import { slug } from "../../lib/vocab.mjs";
import {
  hexCountOf, labelsOf, lineAmount, normalizeBond, normalizeDomain, normalizeHolding, normalizeLine,
  normalizeOtherLine, normalizeStructure, normalizeTerritoryRow, normalizeVassalRow, peasantFamiliesOf,
  strongholdValueOf, urbanFamiliesOf,
} from "../../domains/domain-logic.mjs";
import { clean, countAndName, lastNumber, listEntries, signedText } from "./parse.mjs";

/** The region boxes, left to right, as the classification each one ticks. */
export const REGION_KEYS = Object.freeze(["outlands", "borderlands", "civilized"]);

/** The income rows the page prints a name for, as revenue lines, top to bottom. The fifth row is the reader's own. */
export const INCOME_ROWS = Object.freeze(["land", "service", "tax", "trade"]);

/** The expense rows, as expense lines, top to bottom. */
export const EXPENSE_ROWS = Object.freeze(["garrison", "liturgy", "tithe", "upkeep"]);

/** How many rows each of the page's tables prints. */
export const DOMAIN_ROWS = Object.freeze({ structure: 7, vassal: 7, hex: 16 });

/** The page's boxes no domain field holds: kept as written, and written back as kept. */
export const UNMODELLED_KEYS = Object.freeze([
  "location", "growth", "loss", "investments", "strongholdMin", "authority", "moraleEffects", "tribute.in", "tribute.out", "totalRevenue",
]);

const defaultLabel = (key, data) => (data ? `${key}${JSON.stringify(data)}` : key);
const finite = (n) => n !== null && n !== undefined && n !== "" && Number.isFinite(Number(n));
const numText = (n) => (finite(n) ? String(Number(n)) : "");
const whole = (n) => (finite(n) ? Math.max(0, Math.floor(Number(n))) : null);
const int = (n) => (finite(n) ? Math.trunc(Number(n)) : null);
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/* -------------------------------------------- */
/*  Reading the page                             */
/* -------------------------------------------- */

/**
 * What the page says, box by box, as the import reads it: figures as numbers
 * (null where a box holds none), names and lists as text, and each table only
 * the rows that hold something.
 * @param {Record<string, string|boolean>} domain the page's filled `domain.*` keys (`buildPlan(...).domain`)
 */
export function domainPagePlan(domain = {}) {
  const v = domain ?? {};
  const t = (key) => clean(v[`domain.${key}`] === true ? "" : v[`domain.${key}`]);
  const n = (key) => lastNumber(t(key));
  const lineRow = (table, row, perKey) => {
    const cells = [perKey, "families", "total"].map((c) => t(`${table}.${row}.${c}`));
    return { row, per: n(`${table}.${row}.${perKey}`), families: n(`${table}.${row}.families`), total: n(`${table}.${row}.total`), cells };
  };
  const filled = (row) => row.cells.some(Boolean);

  const structures = Array.from({ length: DOMAIN_ROWS.structure }, (_, row) => {
    const cells = [0, 1, 2, 3, 4].map((c) => t(`structure.${row}.${c}`));
    // A count is the reader's only where the name was written with one.
    const named = cells[0] ? countAndName(cells[0]) : null;
    return {
      row,
      name: named?.name ?? "",
      count: named && named.name !== cells[0] ? named.qty : null,
      ac: n(`structure.${row}.1`),
      shp: n(`structure.${row}.2`),
      capacity: n(`structure.${row}.3`),
      cost: n(`structure.${row}.4`),
      cells,
    };
  }).filter(filled);

  const other = { label: t("income.4.label"), ...lineRow("income", 4, "land") };
  return {
    name: t("name"),
    ruler: t("ruler"),
    regions: REGION_KEYS.filter((_, i) => v[`domain.region.${i}`] === true),
    structures,
    structureTotals: { capacity: n("structure.total.3"), cost: n("structure.total.4") },
    families: { peasant: n("peasantFamilies"), urban: n("urbanFamilies") },
    hexCount: n("hexCount"),
    revenue: INCOME_ROWS.map((key, row) => ({ key, ...lineRow("income", row, "land") })).filter(filled),
    otherRevenue: other.label || filled(other) ? other : null,
    expenses: EXPENSE_ROWS.map((key, row) => ({ key, ...lineRow("expense", row, "perFamily") })).filter(filled),
    tributeIn: n("tribute.inTotal"),
    tributeOut: n("tribute.outTotal"),
    totalIncome: n("totalIncome"),
    morale: { current: int(n("morale")), base: int(n("baseMorale")) },
    favors: listEntries(t("favors")),
    duties: listEntries(t("duties")),
    vassals: Array.from({ length: DOMAIN_ROWS.vassal }, (_, row) => {
      const k = (c) => t(`vassal.${row}.${c}`);
      return { row, name: k("name"), domain: k("domain"), favors: k("favors"), duties: k("duties"), tax: n(`vassal.${row}.tax`), filled: ["name", "domain", "favors", "duties", "tax"].some(k) };
    }).filter((r) => r.filled),
    hexes: Array.from({ length: DOMAIN_ROWS.hex }, (_, row) => {
      const k = (c) => t(`hex.${row}.${c}`);
      return { row, number: k("number"), land: n(`hex.${row}.land`), families: n(`hex.${row}.families`), revenue: k("revenue"), filled: ["number", "land", "families", "revenue"].some(k) };
    }).filter((r) => r.filled),
    unmodelled: Object.fromEntries(UNMODELLED_KEYS.map((k) => [k, t(k)]).filter(([, text]) => text)),
  };
}

/* -------------------------------------------- */
/*  The record a page makes                      */
/* -------------------------------------------- */

/**
 * A hex row's number as the record keeps it: hex labels where every word of
 * it carries a digit ("0412, 0413"), a label otherwise.
 */
function hexKey(number) {
  const labels = labelsOf(number);
  return labels.length && labels.every((l) => /\d/.test(l)) ? { label: "", hexLabels: labels } : { label: number, hexLabels: [] };
}

/**
 * The domain record a page makes of `current`: what the page states written
 * over it, what it leaves blank kept. Rows are matched before any is added,
 * so a second import of the same page adds nothing.
 *
 * A revenue or expense row is written to the side its families column
 * matches — the peasant count, the urban count, or both together — and a
 * row whose families match none is not written at all: a rate laid on the
 * wrong families is a wrong month, where an unwritten one is only an unset
 * line. A blank families column is the peasants' where the domain has no
 * urban families.
 * @param {object} page `domainPagePlan`
 * @param {object} current the domain's record now; `{}` for a new domain
 * @param {object} [opts]
 * @param {string} [opts.rulerUuid] the character the page came from
 * @param {string} [opts.rulerName] that character's name, for a page and a record that name no ruler
 * @param {string[]} [opts.vassalNames] the vassal domain actors' names; a page row naming one is that actor's, not a row
 * @param {(uuid: string) => number|null} [opts.placeFamilies] a placed settlement's urban families
 * @param {() => string} [opts.makeId] the id a new row is given
 * @param {(key: string, data?: object) => string} [opts.label]
 * @returns {{system: object, notes: Array<{label: string, text: string}>, unplaced: string[]}}
 *   `unplaced` names the line rows (`income.2`, `expense.0`) that were not written
 */
export function domainUpdate(page, current, { rulerUuid = "", rulerName = "", vassalNames = [], placeFamilies = () => null, makeId, label = defaultLabel } = {}) {
  const ids = makeId ? { makeId } : {};
  const rec = normalizeDomain(current, ids);
  const notes = [];
  const unplaced = [];
  const note = (key, text) => {
    if (text) notes.push({ label: label(key), text });
  };

  if (rulerUuid) rec.rulerUuid = rulerUuid;
  if (page.ruler) rec.rulerName = page.ruler;
  else if (!rec.rulerName && rulerName) rec.rulerName = rulerName;
  if (page.regions.length === 1) rec.classification = page.regions[0];

  const claimed = new Set();
  for (const s of page.structures) {
    if (!s.name) {
      note("table.structure", s.cells.filter(Boolean).join(" · "));
      continue;
    }
    let row = rec.structures.find((r) => !claimed.has(r) && slug(r.name) === slug(s.name));
    if (!row) {
      row = normalizeStructure({ name: s.name, count: s.count ?? 1 }, makeId);
      rec.structures.push(row);
    }
    claimed.add(row);
    if (s.count !== null) row.count = s.count;
    if (s.ac !== null) row.ac = s.ac;
    if (s.shp !== null) row.shp = s.shp;
    // The page's capacity is the row's; the record keeps one unit's.
    if (s.capacity !== null) row.unitCapacity = row.count ? s.capacity / row.count : s.capacity;
    if (s.cost !== null) row.costGp = s.cost;
  }

  const placedHex = new Set();
  for (const h of page.hexes) {
    const want = h.number ? hexKey(h.number) : null;
    const matches = (r) => {
      if (placedHex.has(r)) return false;
      // A row with no number is matched only by a row that is the same in every figure.
      if (!want) return !r.label && !r.hexLabels.length && r.landValue === h.land && r.families === (whole(h.families) ?? 0);
      if (r.label && slug(r.label) === slug(h.number)) return true;
      return want.hexLabels.length > 0 && sameSet(r.hexLabels, want.hexLabels);
    };
    let row = rec.territory.find(matches);
    if (!row) {
      row = normalizeTerritoryRow({ ...(want ?? { label: "" }), count: 1, revealed: true }, makeId);
      rec.territory.push(row);
    }
    placedHex.add(row);
    if (h.land !== null) row.landValue = h.land;
    if (h.families !== null) row.families = whole(h.families);
  }
  // A page that lists no hex gives the land as one tract, which is written
  // only where the territory is empty or is already that one tract.
  if (!page.hexes.length && (page.hexCount !== null || page.families.peasant !== null)) {
    const tract = (r) => !r.label && !r.hexLabels.length && !r.map;
    if (!rec.territory.length || (rec.territory.length === 1 && tract(rec.territory[0]))) {
      if (!rec.territory.length) rec.territory.push(normalizeTerritoryRow({ label: "", count: whole(page.hexCount), revealed: true }, makeId));
      const row = rec.territory[0];
      if (page.hexCount !== null) row.count = whole(page.hexCount);
      if (page.families.peasant !== null) row.families = whole(page.families.peasant);
    }
  }

  // Urban families land on the one settlement no map holds and nobody named,
  // or on a new one where the domain holds no settlement yet.
  if (page.families.urban !== null) {
    const settlements = rec.holdings.filter((h) => h.role === "settlement");
    const loose = settlements.filter((h) => !h.uuid && !h.name);
    if (loose.length === 1) loose[0].families = whole(page.families.urban);
    else if (!settlements.length) rec.holdings.push(normalizeHolding({ role: "settlement", families: whole(page.families.urban) }));
  }

  const peasant = page.families.peasant ?? peasantFamiliesOf(rec.territory);
  const urbanSum = urbanFamiliesOf(rec.holdings, placeFamilies);
  const urban = page.families.urban ?? (urbanSum.unknown ? null : urbanSum.total);
  const sideOf = (f) => {
    if (f === null) return urban ? null : "peasant";
    if (f === peasant) return "peasant";
    if (f === urban) return "urban";
    if (urban !== null && f === peasant + urban) return "both";
    return null;
  };
  const writeLine = (line, entry, table) => {
    const side = sideOf(entry.families);
    const sides = side === "both" ? ["peasant", "urban"] : side ? [side] : [];
    if (sides.length && entry.per !== null) {
      for (const s of sides) Object.assign(line, { [`${s}Per`]: entry.per, [`${s}Gp`]: null });
    } else if (sides.length === 1 && entry.total !== null) {
      Object.assign(line, { [`${sides[0]}Gp`]: entry.total, [`${sides[0]}Per`]: null });
    } else {
      unplaced.push(`${table}.${entry.row}`);
      const cols = table === "income" ? ["land", "families", "total"] : ["perFamily", "families", "total"];
      const name = label(`line.${entry.key}`);
      note(`table.${table}`, `${name}: ${entry.cells.map((c, i) => (c ? `${label(`col.${table}.${cols[i]}`)} ${c}` : "")).filter(Boolean).join(", ")}`);
    }
  };
  for (const e of page.revenue) writeLine(rec.revenue[e.key], e, "income");
  for (const e of page.expenses) writeLine(rec.expenses[e.key], e, "expense");

  const o = page.otherRevenue;
  if (o) {
    const gp = o.total ?? (o.per !== null && o.families !== null ? o.per * o.families : null);
    let row = rec.otherRevenue.find((r) => slug(r.label) === slug(o.label));
    if (!row) {
      row = normalizeOtherLine({ label: o.label }, makeId);
      rec.otherRevenue.push(row);
    }
    if (gp !== null) row.gp = gp;
  }

  if (page.tributeOut !== null) rec.tributeGp = page.tributeOut;
  if (page.morale.current !== null) rec.morale.current = page.morale.current;
  if (page.morale.base !== null) rec.morale.base = page.morale.base;
  for (const kind of ["favors", "duties"]) {
    for (const text of page[kind]) if (!rec[kind].some((b) => slug(b.label) === slug(text))) rec[kind].push(normalizeBond({ label: text }, makeId));
  }

  const actorVassals = new Set(vassalNames.map(slug));
  for (const v of page.vassals) {
    const name = v.domain || v.name;
    if (!name) {
      note("table.vassal", [v.favors, v.duties, v.tax === null ? "" : numText(v.tax)].filter(Boolean).join(" · "));
      continue;
    }
    if (actorVassals.has(slug(name))) continue;
    let row = rec.vassalRows.find((r) => slug(r.name) === slug(name));
    if (!row) {
      row = normalizeVassalRow({ name }, makeId);
      rec.vassalRows.push(row);
    }
    if (v.domain && v.name) row.rulerName = v.name;
    if (v.favors) row.favors = v.favors;
    if (v.duties) row.duties = v.duties;
    // The page's tax is all the vassal pays; the row keeps the extra tax apart.
    if (v.tax !== null) row.tributeGp = v.tax - (row.extraTaxGp ?? 0);
  }

  for (const [key, text] of Object.entries(page.unmodelled)) note(key, text);
  note("hexRevenue", page.hexes.filter((h) => h.revenue).map((h) => (h.number ? `${h.number}: ${h.revenue}` : h.revenue)).join(", "));
  return { system: normalizeDomain(rec, ids), notes, unplaced };
}

/* -------------------------------------------- */
/*  Checks                                       */
/* -------------------------------------------- */

/** What the structures' capacity comes to: each row's unit capacity times its count. */
function capacityOf(structures) {
  let total = 0;
  let unknown = 0;
  for (const s of structures ?? []) {
    if (s.unitCapacity === null || s.unitCapacity === undefined) unknown += 1;
    else total += Number(s.unitCapacity) * (Number(s.count) || 0);
  }
  return { total, unknown };
}

/**
 * The page's figures beside what the written domain works out: its families,
 * hexes, the stronghold's totals, each line's total, tribute in and out, and
 * the month's total. A figure that agrees is left out. A sum over rows some
 * of which give no figure is shown as "at least"; a month over lines some of
 * which are unset, as the total of the lines set.
 * @param {object} page `domainPagePlan`
 * @param {object} sums
 * @param {object} sums.record the domain's record after the write
 * @param {{peasant: number, urban: number, urbanUnknown: number}} sums.families `familiesOf`
 * @param {object} sums.ledger `ledgerFor`
 * @param {string[]} [sums.unplaced] the line rows `domainUpdate` did not write
 * @param {{label?: (key: string, data?: object) => string}} [opts]
 * @returns {Array<{label: string, sheet: string, inForce: string}>}
 */
export function domainChecks(page, { record, families, ledger, unplaced = [] }, { label = defaultLabel } = {}) {
  const out = [];
  const check = (key, sheet, inForce, { atLeast = false, known = false, reason = "" } = {}) => {
    if (sheet === null || sheet === undefined) return;
    if (reason) {
      out.push({ label: label(key), sheet: numText(sheet), inForce: label(reason) });
      return;
    }
    if (finite(inForce) && Number(inForce) === Number(sheet)) return;
    let shown = numText(inForce) || "—";
    if (finite(inForce) && atLeast) shown = label("check.atLeast", { n: numText(inForce) });
    else if (finite(inForce) && known) shown = label("check.known", { n: numText(inForce) });
    out.push({ label: label(key), sheet: numText(sheet), inForce: shown });
  };

  if (page.regions.length > 1) {
    out.push({
      label: label("region"),
      sheet: page.regions.map((k) => label(`classification.${k}`)).join(", "),
      inForce: record.classification ? label(`classification.${record.classification}`) : "—",
    });
  }
  check("peasantFamilies", page.families.peasant, families.peasant);
  check("urbanFamilies", page.families.urban, families.urban, { atLeast: families.urbanUnknown > 0 });
  const hexes = hexCountOf(record.territory);
  check("hexCount", page.hexCount, hexes.total, { atLeast: hexes.unknown > 0 });
  const capacity = capacityOf(record.structures);
  check("structureCapacity", page.structureTotals.capacity, capacity.total, { atLeast: capacity.unknown > 0 });
  const value = strongholdValueOf(record.structures);
  check("structureCost", page.structureTotals.cost, value.total, { atLeast: value.unknown > 0 });

  const lineCheck = (entries, table, amounts) => {
    for (const e of entries) {
      if (unplaced.includes(`${table}.${e.row}`)) {
        check(`line.${e.key}`, e.total ?? e.per, null, { reason: "check.noSide" });
        continue;
      }
      const amount = amounts.find((a) => a.key === e.key);
      check(`line.${e.key}`, e.total, amount?.total ?? null, { atLeast: !!amount?.unknown });
    }
  };
  lineCheck(page.revenue, "income", ledger.revenue);
  lineCheck(page.expenses, "expense", ledger.expenses);
  check("tribute.inTotal", page.tributeIn, ledger.tributeIn.total, { atLeast: ledger.tributeIn.unknown > 0 });
  if (!ledger.tributeOut.owed) check("tribute.outTotal", page.tributeOut, null, { reason: "check.noLiege" });
  check("totalIncome", page.totalIncome, ledger.totals.income, { known: ledger.partial });
  return out;
}

/* -------------------------------------------- */
/*  Writing the page back                        */
/* -------------------------------------------- */

/**
 * One revenue or expense line as the page's three boxes. A line set on one
 * side is that side's rate (or its flat figure) over that side's families; a
 * line set on both is one rate over all the families where both sides share
 * it, and its total alone otherwise. What `domainUpdate` reads back is the
 * line it was written from.
 * @returns {{per: number|null, families: number|null, total: number|null}|null} null for a line not set
 */
export function sheetLine(line, families) {
  const l = normalizeLine(line);
  const amount = lineAmount(l, families);
  if (!amount.set) return null;
  const total = amount.unknown ? null : amount.total;
  const sides = ["peasant", "urban"].filter((s) => l[`${s}Per`] !== null || l[`${s}Gp`] !== null);
  if (sides.length === 1) {
    const s = sides[0];
    return { per: l[`${s}Gp`] === null ? l[`${s}Per`] : null, families: families?.[s] ?? null, total };
  }
  const shared = l.peasantGp === null && l.urbanGp === null && l.peasantPer === l.urbanPer;
  const all = families?.peasant !== null && families?.peasant !== undefined && families?.urban !== null && families?.urban !== undefined
    ? families.peasant + families.urban
    : null;
  return { per: shared ? l.peasantPer : null, families: shared ? all : null, total };
}

/** Rows of a table, cut to what the page prints, with what was cut. */
function cut(rows, max, table, overflow, nameOf) {
  if (rows.length > max) overflow.push({ table, dropped: rows.slice(max).map(nameOf) });
  return rows.slice(0, max);
}

/**
 * The page's boxes for a domain: what its record holds, written the way
 * `domainPagePlan` reads it back, and the boxes it keeps no field for taken
 * from the last import's record. A table longer than the page is cut, and
 * `overflow` names what was left off.
 * @param {object} record the domain's record
 * @param {object} ctx
 * @param {string} ctx.name the domain's name
 * @param {string} [ctx.rulerName] the ruler's name, for a record that names none
 * @param {{peasant: number, urban: number, urbanUnknown: number}} ctx.families `familiesOf`
 * @param {object} ctx.ledger `ledgerFor`
 * @param {Array<{name: string, rulerName: string, tributeGp: number|null}>} [ctx.vassalDomains] the vassal domain actors
 * @param {Record<string, string|boolean>} [ctx.recorded] the last import's boxes, flat
 * @returns {{values: Record<string, string|boolean>, overflow: Array<{table: string, dropped: string[]}>}}
 */
export function domainPageValues(record, { name = "", rulerName = "", families, ledger, vassalDomains = [], recorded = {} } = {}) {
  const rec = normalizeDomain(record, { makeId: () => "" });
  const values = {};
  const overflow = [];
  const set = (key, value) => {
    if (value === undefined || value === null || value === "") return;
    values[`domain.${key}`] = value;
  };

  set("name", name);
  set("ruler", rec.rulerName || rulerName);
  if (REGION_KEYS.includes(rec.classification)) set(`region.${REGION_KEYS.indexOf(rec.classification)}`, true);

  cut(rec.structures, DOMAIN_ROWS.structure, "structure", overflow, (s) => s.name).forEach((s, i) => {
    set(`structure.${i}.0`, s.count > 1 ? `${s.name} ×${s.count}` : s.name);
    set(`structure.${i}.1`, numText(s.ac));
    set(`structure.${i}.2`, numText(s.shp));
    set(`structure.${i}.3`, s.unitCapacity === null ? "" : numText(s.unitCapacity * s.count));
    set(`structure.${i}.4`, numText(s.costGp));
  });
  if (rec.structures.length) {
    const capacity = capacityOf(rec.structures);
    const value = strongholdValueOf(rec.structures);
    if (!capacity.unknown) set("structure.total.3", numText(capacity.total));
    if (!value.unknown) set("structure.total.4", numText(value.total));
  }

  if (rec.territory.length) {
    set("peasantFamilies", numText(families.peasant));
    const hexes = hexCountOf(rec.territory);
    if (!hexes.unknown) set("hexCount", numText(hexes.total));
  }
  if (rec.holdings.some((h) => h.role === "settlement") && !families.urbanUnknown) set("urbanFamilies", numText(families.urban));

  const fam = ledger.families;
  INCOME_ROWS.forEach((key, row) => {
    const s = sheetLine(rec.revenue[key], fam);
    if (!s) return;
    set(`income.${row}.land`, numText(s.per));
    set(`income.${row}.families`, numText(s.families));
    set(`income.${row}.total`, numText(s.total));
  });
  cut(rec.otherRevenue, 1, "income", overflow, (r) => r.label).forEach((r) => {
    set("income.4.label", r.label);
    set("income.4.total", numText(r.gp));
  });
  EXPENSE_ROWS.forEach((key, row) => {
    const s = sheetLine(rec.expenses[key], fam);
    if (!s) return;
    set(`expense.${row}.perFamily`, numText(s.per));
    set(`expense.${row}.families`, numText(s.families));
    set(`expense.${row}.total`, numText(s.total));
  });
  // The page prints no row for an expense the named lines do not cover.
  cut(rec.otherExpenses, 0, "otherExpense", overflow, (r) => r.label);

  if (ledger.tributeIn.count && !ledger.tributeIn.unknown) set("tribute.inTotal", numText(ledger.tributeIn.total));
  if (ledger.tributeOut.owed) set("tribute.outTotal", numText(ledger.tributeOut.gp));
  if (!ledger.partial) set("totalIncome", numText(ledger.totals.income));
  if (rec.morale.current !== null) set("morale", signedText(rec.morale.current));
  if (rec.morale.base !== null) set("baseMorale", signedText(rec.morale.base));
  set("favors", rec.favors.map((b) => b.label).filter(Boolean).join(", "));
  set("duties", rec.duties.map((b) => b.label).filter(Boolean).join(", "));

  // A row naming its ruler is ruler and domain; one naming no ruler writes
  // its one name where the import reads a lone name back.
  const vassals = [
    ...vassalDomains.map((d) => ({ name: d.rulerName ?? "", domain: d.name ?? "", favors: "", duties: "", tax: d.tributeGp })),
    ...rec.vassalRows.map((r) => ({
      ...(r.rulerName ? { name: r.rulerName, domain: r.name } : { name: r.name, domain: "" }),
      favors: r.favors,
      duties: r.duties,
      tax: r.tributeGp === null ? null : r.tributeGp + (r.extraTaxGp ?? 0),
    })),
  ];
  cut(vassals, DOMAIN_ROWS.vassal, "vassal", overflow, (v) => v.domain || v.name).forEach((v, i) => {
    for (const f of ["name", "domain", "favors", "duties"]) set(`vassal.${i}.${f}`, v[f]);
    set(`vassal.${i}.tax`, numText(v.tax));
  });

  // A tract with neither a label nor a hex is not a hex; the families and
  // hex boxes carry it.
  const recordedRevenue = new Map();
  for (let i = 0; i < DOMAIN_ROWS.hex; i++) {
    const number = slug(recorded[`domain.hex.${i}.number`]);
    if (number && recorded[`domain.hex.${i}.revenue`]) recordedRevenue.set(number, recorded[`domain.hex.${i}.revenue`]);
  }
  const hexRows = rec.territory.filter((r) => r.label || r.hexLabels.length).map((r) => ({ ...r, number: r.hexLabels.join(", ") || r.label }));
  cut(hexRows, DOMAIN_ROWS.hex, "hex", overflow, (r) => r.number).forEach((r, i) => {
    set(`hex.${i}.number`, r.number);
    set(`hex.${i}.land`, numText(r.landValue));
    set(`hex.${i}.families`, numText(r.families));
    set(`hex.${i}.revenue`, recordedRevenue.get(slug(r.number)));
  });

  for (const key of UNMODELLED_KEYS) set(key, recorded[`domain.${key}`]);
  return { values, overflow };
}
