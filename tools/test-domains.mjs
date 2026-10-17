/**
 * Domains: the record a printed domain sheet keeps, its normaliser, and the
 * sums read off it.
 *
 * What is pinned here. The model and the normaliser agree on every key, so
 * what an importer hands `system` is what the model stores. A line nobody set
 * stays out of every total and is counted as unset, never read as zero; a
 * rate over families nobody counted is unknown, not a smaller figure. A
 * flat figure wins over its rate. Tribute in is the vassals' and is never
 * stored. A place is held by one domain at most, a liege cannot close a
 * loop, and a place belongs to the domain holding it or the nearest place
 * around it. Every figure below is invented; every name is a neutral label.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";

/* ------------------------- the model's shape ------------------------------- */
// A recording stand-in for Foundry's fields: each builder keeps what it was
// given, so the schema can be walked as a tree of keys.
class Field {
  constructor(options = {}) {
    this.options = options;
  }
}
class SchemaField extends Field {
  constructor(fields, options) {
    super(options);
    this.fields = fields;
  }
}
class ArrayField extends Field {
  constructor(element, options) {
    super(options);
    this.element = element;
  }
}
globalThis.foundry = {
  abstract: { TypeDataModel: class {} },
  data: {
    fields: {
      StringField: Field, NumberField: Field, BooleanField: Field, HTMLField: Field, ObjectField: Field, SetField: Field,
      SchemaField, ArrayField,
    },
  },
};
const { DomainData } = await import("../scripts/domains/data/domain-data.mjs");
const logic = await import("../scripts/domains/domain-logic.mjs");
const {
  normalizeDomain, blankDomain, normalizeTerritoryRow, normalizeHolding, normalizeStructure, normalizeVassalRow,
  normalizeBond, normalizeOtherLine, rowsOf, labelsOf, classesOf, peasantFamiliesOf, hexCountOf, urbanFamiliesOf,
  strongholdValueOf, lineAmount, tributeInOf, ledgerOf, wouldCycleDomain, holdsIn, domainHolding, holdConflict,
  domainRecord, ROW_LISTS,
} = logic;
const { REVENUE_LINES, EXPENSE_LINES, DOMAIN_TYPE } = await import("../scripts/domains/constants.mjs");
const { indexPlaces } = await import("../scripts/lib/place-logic.mjs");

const schema = DomainData.defineSchema();
const shapeOfField = (f) => {
  if (f instanceof SchemaField) return Object.fromEntries(Object.entries(f.fields).map(([k, v]) => [k, shapeOfField(v)]));
  if (f instanceof ArrayField) return [shapeOfField(f.element)];
  return "leaf";
};
const shapeOfValue = (v) => {
  if (Array.isArray(v)) return v.length ? [shapeOfValue(v[0])] : [];
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shapeOfValue(x)]));
  return "leaf";
};

const COMPAT = ["isNew", "thac0", "initiative", "movement", "saves", "schemaVersion"];
const modelKeys = Object.keys(schema).filter((k) => !COMPAT.includes(k)).sort();
assert.deepEqual(modelKeys, Object.keys(blankDomain()).sort(), "the model and the normaliser hold the same top-level keys");
for (const side of ["revenue", "expenses"]) {
  assert.deepEqual(shapeOfField(schema[side]), shapeOfValue(blankDomain()[side]), `every ${side} line has the same five fields in both`);
}
assert.deepEqual(shapeOfField(schema.morale), shapeOfValue(blankDomain().morale));

// One full row of each list, normalised, against the element the model declares.
const fullRows = {
  territory: normalizeTerritoryRow({ id: "t", hexLabels: ["0101"], map: { sceneUuid: "Scene.s", key: "1,1" } }),
  holdings: normalizeHolding({ uuid: "Actor.p" }),
  structures: normalizeStructure({ id: "s" }),
  vassalRows: normalizeVassalRow({ id: "v", domainHexes: { labels: ["0202"], classes: ["civilized"] }, realmHexes: { labels: ["0303"], classes: ["outlands"] } }),
  favors: normalizeBond({ id: "f" }),
  duties: normalizeBond({ id: "d" }),
  otherRevenue: normalizeOtherLine({ id: "o" }),
  otherExpenses: normalizeOtherLine({ id: "o" }),
};
assert.deepEqual(Object.keys(fullRows).sort(), Object.keys(ROW_LISTS).sort(), "every list has a row normaliser");
for (const [key, row] of Object.entries(fullRows)) {
  assert.deepEqual(shapeOfField(schema[key]), [shapeOfValue(row)], `a ${key} row has the model's fields, no more and no fewer`);
}

// The starting values a blank record and a fresh row take.
const lineOpts = schema.revenue.fields.land.fields;
assert.ok(["peasantPer", "urbanPer", "peasantGp", "urbanGp"].every((k) => lineOpts[k].options.nullable === true && lineOpts[k].options.initial === null), "a line starts unset, never zero");
assert.equal(schema.tributeGp.options.initial, null, "tribute out starts unset");
assert.equal(schema.morale.fields.current.options.initial, null);
assert.equal(schema.morale.fields.base.options.initial, null);
assert.equal(schema.territory.element.fields.count.options.initial, 1, "a new tract is one hex");
assert.equal(schema.territory.element.fields.landValue.options.initial, null, "an unsurveyed hex has no land value");
assert.equal(schema.territory.element.fields.map.options.initial, null, "a row nobody painted sits on no map");
assert.equal(schema.holdings.element.fields.role.options.initial, "other");
assert.equal(schema.holdings.element.fields.families.options.initial, null, "an unplaced town's families start unknown");
assert.equal(schema.structures.element.fields.costGp.options.initial, null);
delete globalThis.foundry;

/* ------------------------- the normaliser ---------------------------------- */
const blank = blankDomain();
assert.equal(blank.classification, "");
assert.equal(blank.tributeGp, null);
assert.deepEqual(blank.morale, { current: null, base: null });
assert.ok(REVENUE_LINES.every((k) => Object.values(blank.revenue[k]).every((v) => v === null || v === "")), "every revenue line starts unset");
assert.ok(EXPENSE_LINES.every((k) => blank.expenses[k].peasantPer === null && blank.expenses[k].note === ""));
assert.ok(Object.keys(ROW_LISTS).every((k) => Array.isArray(blank[k]) && blank[k].length === 0));

let n = 0;
const makeId = () => `id${++n}`;
const formShaped = normalizeDomain({
  classification: "unsettled",
  alignment: "law",
  territory: { 1: { label: "Tract B", families: "-3" }, 0: { label: "Tract A", hexLabels: "0101, 0102;0103", count: "", families: "40" } },
  holdings: { 0: { name: "Town 1", role: "settlement", families: "12", marketClass: "7" }, 1: { uuid: "Actor.p", role: "bogus" } },
  vassalRows: { 0: { name: "Domain 2", domainHexes: { count: "2", labels: "0201 0202", classes: { civilized: true, borderlands: false, unsettled: true } } } },
  structures: [{ name: "Wall 1", count: "", costGp: "" }],
}, { makeId });
assert.equal(formShaped.classification, "", "a key off the domain list is not a classification");
assert.equal(formShaped.alignment, "", "an alignment is a key, not a word that starts like one");
assert.deepEqual(formShaped.territory.map((r) => r.label), ["Tract A", "Tract B"], "index-keyed rows come back in index order");
assert.deepEqual(formShaped.territory[0].hexLabels, ["0101", "0102", "0103"], "hex numbers split on commas, semicolons and spaces");
assert.equal(formShaped.territory[0].count, null, "a blank count is unknown, not zero");
assert.equal(formShaped.territory[0].families, 40);
assert.equal(formShaped.territory[1].families, 0, "families never go below zero");
assert.equal(formShaped.territory[1].count, 1, "a row that never said how many hexes is one");
assert.equal(formShaped.territory[0].id, "id1", "a row without an id is given one");
assert.equal(formShaped.holdings[0].marketClass, null, "a market class off the ladder is none");
assert.equal(formShaped.holdings[0].families, 12);
assert.equal(formShaped.holdings[1].role, "other", "an unknown role is other");
assert.deepEqual(formShaped.vassalRows[0].domainHexes, { count: 2, labels: ["0201", "0202"], classes: ["civilized"] }, "ticked boxes become keys, and only domain keys");
assert.equal(formShaped.structures[0].count, 0, "a blank unit count is none");
assert.equal(formShaped.structures[0].costGp, null, "a blank cost is unset");
assert.deepEqual(normalizeDomain(formShaped), formShaped, "normalising a normalised record changes nothing");

assert.deepEqual(rowsOf({ 2: "c", 0: "a", 10: "d", x: "skip", 1: "b" }), ["a", "b", "c", "d"]);
assert.deepEqual(rowsOf("nope"), []);
assert.deepEqual(labelsOf(["  0101 ", "", null]), ["0101"]);
assert.deepEqual(classesOf(["outlands", "civilized", "nonsense"]), ["civilized", "outlands"], "vocabulary order, vocabulary keys");
assert.deepEqual(classesOf({ outlands: "true", civilized: false }), ["outlands"]);

/* ------------------------- a printed record's shape ------------------------ */
// The shape a printed domain record fills — totals with no per-hex rows, lines
// in both forms, vassal rows with their own hexes — with invented figures.
const record = normalizeDomain({
  rulerName: "NPC 1",
  title: "Title 1",
  liegeName: "NPC 2",
  classification: "borderlands",
  alignment: "lawful",
  territory: [{ label: "Domain hexes", count: 3, landValue: 5, families: 100 }],
  holdings: [{ name: "Town 1", role: "settlement", families: 20, marketClass: 5, investmentGp: 1000 }],
  structures: [{ name: "Wall 1", count: 4, ac: 6, unitCapacity: 1, shp: 100, costGp: 4000 }, { name: "Keep 1", count: 1, costGp: 9000 }],
  revenue: {
    land: { peasantPer: 5 },
    service: { peasantPer: 2 },
    tax: { peasantPer: 1, urbanPer: 1 },
    trade: { urbanPer: 3 },
  },
  expenses: {
    garrison: { peasantGp: 250, urbanGp: 40 },
    liturgy: { peasantPer: 1, urbanPer: 1, note: "Next: Month 1" },
    upkeep: { peasantGp: 77 },
    tithe: { peasantGp: 0 },
  },
  otherRevenue: [{ label: "Other 1", gp: 10 }],
  tributeGp: 60,
  morale: { current: -1 },
  vassalRows: [
    { name: "Domain 2", rulerName: "NPC 3", families: { peasant: 50, urban: 5 }, tributeGp: 30, extraTaxGp: 5, domainHexes: { count: 2, classes: ["borderlands"] } },
    { name: "Domain 3", rulerName: "NPC 4", families: { peasant: 40 }, tributeGp: 20 },
  ],
  duties: [{ label: "Duty 1" }],
}, { makeId });

assert.equal(peasantFamiliesOf(record.territory), 100);
assert.deepEqual(hexCountOf(record.territory), { total: 3, unknown: 0 });
assert.deepEqual(urbanFamiliesOf(record.holdings), { total: 20, unknown: 0 }, "an unplaced town counts its own figure");
assert.deepEqual(strongholdValueOf(record.structures), { total: 13000, unknown: 0 }, "the stronghold is its rows' costs, each row whole");

const ledger = ledgerOf(record, { families: { peasant: 100, urban: 20 } });
const byKey = (rows) => Object.fromEntries(rows.map((r) => [r.key, r.total]));
assert.deepEqual(byKey(ledger.revenue), { land: 500, service: 200, tax: 120, trade: 60 });
assert.deepEqual(byKey(ledger.expenses), { garrison: 290, liturgy: 120, upkeep: 77, tithe: 0 }, "a flat figure stands as it is, a zero is set");
assert.deepEqual(ledger.tributeIn, { total: 55, unknown: 0, count: 2 }, "tribute in is the rows' tribute and extra tax");
assert.deepEqual(ledger.tributeOut, { owed: true, gp: 60 });
assert.equal(ledger.totals.revenue, 500 + 200 + 120 + 60 + 10 + 55);
assert.equal(ledger.totals.expenses, 290 + 120 + 77 + 0 + 60);
assert.equal(ledger.totals.income, ledger.totals.revenue - ledger.totals.expenses);
assert.equal(ledger.partial, false, "a record that states every line is whole");
assert.equal(ledger.expenses.find((r) => r.key === "liturgy").note, "Next: Month 1");

/* ------------------------- partial ledgers --------------------------------- */
assert.deepEqual(lineAmount({ peasantPer: 2, peasantGp: 7 }, { peasant: 100, urban: 0 }).peasant, 7, "a flat figure wins over its rate");
assert.deepEqual(lineAmount({}, { peasant: 100, urban: 0 }), { peasant: null, urban: null, total: null, set: false, unknown: false });
assert.deepEqual(lineAmount({ urbanPer: 3 }, { peasant: 100, urban: null }), { peasant: null, urban: null, total: null, set: true, unknown: true }, "a rate over uncounted families is set but unknown");

const fresh = ledgerOf(blankDomain(), { families: { peasant: 0, urban: 0 } });
assert.equal(fresh.unset, REVENUE_LINES.length + EXPENSE_LINES.length, "a blank domain has every line unset");
assert.deepEqual(fresh.tributeOut, { owed: false, gp: 0 }, "no lord, nothing owed — and not counted unset");
assert.equal(fresh.partial, true);
assert.equal(fresh.totals.income, 0);

const owing = ledgerOf(normalizeDomain({ parentUuid: "Actor.liege" }), { families: { peasant: 0, urban: 0 } });
assert.equal(owing.unset, REVENUE_LINES.length + EXPENSE_LINES.length + 1, "a domain with a lord and no tribute figure has one more unset line");

assert.deepEqual(tributeInOf([{ tributeGp: null, extraTaxGp: 9 }], [{ tributeGp: 15 }, { tributeGp: null }]), { total: 15, unknown: 2, count: 3 }, "an unset tribute is unknown, its extra tax with it");
assert.deepEqual(urbanFamiliesOf(
  [{ uuid: "Actor.a", role: "settlement" }, { uuid: "Actor.b", role: "settlement" }, { uuid: "Actor.c", role: "stronghold" }, { role: "settlement", families: null }],
  (uuid) => ({ "Actor.a": 30, "Actor.c": 99 })[uuid] ?? null,
), { total: 30, unknown: 2 }, "a placed town reads its place; a stronghold is not a settlement; a town with no figure is unknown");
assert.deepEqual(hexCountOf([{ hexLabels: ["0101", "0102"], count: 9 }, { count: null }, { count: 4 }]), { total: 6, unknown: 1 }, "labels win over a count");
assert.deepEqual(strongholdValueOf([{ costGp: 10 }, { costGp: null }]), { total: 10, unknown: 1 });

/* ------------------------- the realm --------------------------------------- */
const recs = [
  { uuid: "Actor.top", parentUuid: "", holdings: [{ uuid: "Actor.city" }] },
  { uuid: "Actor.mid", parentUuid: "Actor.top", holdings: [{ uuid: "Actor.town" }] },
  { uuid: "Actor.low", parentUuid: "Actor.mid", holdings: [] },
];
const index = indexPlaces(recs);
assert.equal(wouldCycleDomain("Actor.top", "Actor.low", index), true, "a liege cannot answer to its own vassal's vassal");
assert.equal(wouldCycleDomain("Actor.low", "Actor.top", index), false);
assert.equal(wouldCycleDomain("Actor.top", "Actor.top", index), true, "a domain cannot be its own liege");
assert.equal(wouldCycleDomain("Actor.top", "", index), false, "no liege closes no loop");
assert.equal(holdsIn(recs[0], "Actor.city"), true);
assert.equal(holdsIn(recs[0], ""), false);
assert.equal(domainHolding(recs, ["Actor.inn", "Actor.town", "Actor.city"])?.uuid, "Actor.mid", "the nearest held place answers, not the widest");
assert.equal(domainHolding(recs, ["Actor.elsewhere"]), null);
assert.equal(holdConflict(recs, "Actor.low", "Actor.town")?.uuid, "Actor.mid", "a place held by another domain is a collision");
assert.equal(holdConflict(recs, "Actor.mid", "Actor.town"), null, "a domain does not collide with itself");
assert.deepEqual(domainRecord({ uuid: "Actor.x", name: "Domain 9", system: { parentUuid: "Actor.y", tributeGp: "12", holdings: [{ uuid: "Actor.z" }] } }),
  { uuid: "Actor.x", name: "Domain 9", parentUuid: "Actor.y", rulerUuid: "", tributeGp: 12, holdings: [{ uuid: "Actor.z" }] });

/* ------------------------- the world's api ---------------------------------- */
const updates = [];
const docs = new Map();
const domainDoc = (uuid, name, sys) => {
  const system = normalizeDomain(sys, { makeId });
  system.holdsPlace = (u) => holdsIn(system, u);
  const doc = {
    documentName: "Actor", type: DOMAIN_TYPE, uuid, id: uuid.split(".")[1], name, system,
    async update(changes) {
      updates.push({ uuid, changes });
      for (const [path, value] of Object.entries(changes)) system[path.replace(/^system\./, "")] = value;
      return doc;
    },
  };
  docs.set(uuid, doc);
  return doc;
};
const placeDoc = (uuid, name, parentUuid = "", market = null) => {
  const doc = { documentName: "Actor", type: "acks-extras.location", uuid, name, system: { parentUuid, market }, getFlag: () => undefined };
  docs.set(uuid, doc);
  return doc;
};
const city = placeDoc("Actor.city", "Place 1", "", { urbanFamilies: 70 });
placeDoc("Actor.inn", "Place 2", "Actor.city");
const keep = placeDoc("Actor.keep", "Place 3");
const top = domainDoc("Actor.top", "Domain 1", { rulerUuid: "Actor.npc", holdings: [{ uuid: "Actor.city", role: "settlement" }] });
const vassal = domainDoc("Actor.vas", "Domain 2", { parentUuid: "Actor.top", tributeGp: 25 });
const actors = [...docs.values()];
actors.contents = actors;
let isGM = true;
globalThis.game = { actors, user: { get isGM() { return isGM; } }, packs: { get: () => undefined } };
globalThis.fromUuidSync = (uuid) => docs.get(uuid) ?? null;
globalThis.acksExtras ??= {};

const api = await import("../scripts/domains/domains.mjs");
assert.deepEqual(api.allDomains().map((d) => d.uuid), ["Actor.top", "Actor.vas"]);
assert.equal(api.holdsPlace("Actor.city"), true);
assert.equal(api.holdsPlace(city), true, "a document answers as its uuid does");
assert.equal(api.holdsPlace("Actor.inn"), false, "a place inside a held one is not itself held — the prune keeps only what is listed");
assert.equal(api.domainOf("Actor.inn")?.uuid, "Actor.top", "an inn in a held city belongs to the city's domain");
assert.equal(api.domainOf(keep), null);
assert.deepEqual(api.domainsRuledBy("Actor.npc").map((d) => d.uuid), ["Actor.top"]);
assert.deepEqual(api.vassalsOf(top).map((d) => d.uuid), ["Actor.vas"]);
assert.equal(api.liegeOf(vassal)?.uuid, "Actor.top");
assert.deepEqual(api.familiesOf(top), { peasant: 0, urban: 70, urbanUnknown: 0 }, "a placed settlement's families are its place's");
const topLedger = api.ledgerFor(top);
assert.deepEqual(topLedger.tributeIn, { total: 25, unknown: 0, count: 1 }, "a vassal domain's tribute out is its liege's tribute in");

assert.deepEqual(await api.setLiege(top, vassal), { ok: false, reason: "cycle" }, "the reverse of a vassalage is refused");
assert.deepEqual(await api.hold(vassal, city), { ok: false, reason: "heldElsewhere", other: top }, "a second domain cannot hold a held place, and is told whose it is");
assert.deepEqual(await api.hold(top, city), { ok: false, reason: "held" });
updates.length = 0;
assert.deepEqual(await api.hold(vassal, keep), { ok: true });
assert.equal(updates[0].changes["system.holdings"].at(-1).role, "other", "a place with no market is held as other");
assert.equal(updates[0].changes["system.holdings"].at(-1).name, "Place 3", "the place's name is kept beside its uuid");
assert.equal(api.holdsPlace(keep), true);
assert.equal(await api.release(vassal, "Actor.keep"), true);
assert.equal(api.holdsPlace(keep), false);
assert.equal(await api.release(vassal, "Actor.keep"), false, "releasing what is not held writes nothing");

isGM = false;
assert.deepEqual(await api.setLiege(vassal, null), { ok: false, reason: "judgeOnly" }, "a player's client is refused, not left to fail at the document");
assert.deepEqual(await api.hold(vassal, keep), { ok: false, reason: "judgeOnly" });
isGM = true;
assert.deepEqual(await api.setLiege(vassal, null), { ok: true });
assert.equal(vassal.system.parentUuid, "", "clearing the liege writes the field empty");
assert.deepEqual(await api.setLiege(vassal, keep), { ok: false, reason: "notDomain" }, "a place is not a liege");

console.log("test-domains: all checks passed");
