/**
 * Where an imported table was read: the citation a recipe yields, the one an
 * assembled table inherits from the raw tables under it, and every binding's
 * `PRODUCES` map naming raw tables a recipe really reads.
 *
 * Book codes and page numbers below are INVENTED ("ZZ", "QQ") except where the
 * test reads the shipped recipes themselves, which carry citations by design.
 */
import assert from "node:assert";
import { joinCites, recipeCite, assembledDoc } from "../../scripts/importer/produces.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import { PRODUCES as FLIGHT } from "../../scripts/importer/flight-binding.mjs";
import { PRODUCES as SURVIVAL } from "../../scripts/importer/survival-binding.mjs";
import { PRODUCES as SEARCHING } from "../../scripts/importer/searching-binding.mjs";
import { PRODUCES as CITY } from "../../scripts/importer/city-travel-binding.mjs";
import { PRODUCES as FORAGING } from "../../scripts/importer/foraging-binding.mjs";
import { PRODUCES as TRAVEL } from "../../scripts/importer/travel-binding.mjs";
import { PRODUCES as ENCOUNTERS } from "../../scripts/importer/encounters-binding.mjs";
import { PRODUCES as WEATHER } from "../../scripts/importer/weather-binding.mjs";
import { PRODUCES as VOYAGES } from "../../scripts/importer/voyages-binding.mjs";
import { PRODUCES as BUILDER } from "../../scripts/importer/builder-binding.mjs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};
const eq = (label, got, want) => {
  assert.deepStrictEqual(got, want, label);
  pass++;
};

/* ------------------------------ joinCites ------------------------------ */

eq("one page stays one page", joinCites(["ZZ p.12"]), "ZZ p.12");
eq("adjacent pages fold into a run", joinCites(["ZZ p.12", "ZZ p.13", "ZZ p.14", "ZZ p.20"]), "ZZ p.12-14, 20");
eq("a page cited twice is cited once", joinCites(["ZZ p.12", "ZZ p.12"]), "ZZ p.12");
eq("books keep first-seen order", joinCites(["QQ p.5", "ZZ p.12", "QQ p.4"]), "QQ p.4-5; ZZ p.12");
eq("joined citations re-join", joinCites(["ZZ p.12-13; QQ p.5", "ZZ p.14"]), "ZZ p.12-14; QQ p.5");
eq("nothing cites null", joinCites([null, undefined, ""]), null);
eq("a part in another form is kept once", joinCites(["see the appendix", "ZZ p.3", "see the appendix"]), "ZZ p.3; see the appendix");
eq("a reversed or runaway range is dropped, not expanded", joinCites(["ZZ p.9-3", "ZZ p.1-900", "ZZ p.4"]), "ZZ p.4");

/* ------------------------------ recipeCite ------------------------------ */

eq("a plain recipe cites its page", recipeCite({ book: "rr", printedPage: 40 }), "RR p.40");
eq("a spanning recipe cites the span", recipeCite({ book: "jj", printedPage: 40, pageSpan: 3 }), "JJ p.40-42");
eq("an unknown book is cited by its code", recipeCite({ book: "zz", printedPage: 7 }), "ZZ p.7");
eq("a recipe with no page cites nothing", recipeCite({ book: "rr" }), null);
eq("a null or zero page is no page", [recipeCite({ book: "rr", printedPage: null }), recipeCite({ book: "rr", printedPage: 0 })], [null, null]);

const blocks = {
  book: "jj",
  blocks: [
    { cultureId: "a", printedPage: 10 },
    { cultureId: "b", printedPage: 11 },
    { cultureId: "c", book: "zz", printedPage: 3, optional: true },
  ],
};
eq("a gathered table cites every block's page", recipeCite(blocks), "JJ p.10-11; ZZ p.3");
eq("a block never read cites nothing", recipeCite(blocks, new Set(["a", "b"])), "JJ p.10-11");
eq(
  "sub-tables cite their own pages",
  recipeCite({ book: "rr", subTables: [{ id: "x", printedPage: 8 }, { id: "y", printedPage: 6 }] }, new Set(["x"])),
  "RR p.8",
);
eq(
  "value blocks cite their own pages",
  recipeCite({ book: "rr", valueBlocks: [{ id: "x", printedPage: 8 }, { id: "y", printedPage: 9 }] }),
  "RR p.8-9",
);

/* ----------------------------- assembledDoc ----------------------------- */

const layer = {
  id: "yards",
  source: { book: "Invented", pages: "ZZ 10-14" },
  cites: { ropeRaw: "ZZ p.10", knotRaw: "ZZ p.11", sailRaw: "QQ p.2", staleEngine: "ZZ p.99" },
  tables: { ropeRaw: { a: 1 }, knotRaw: { b: 2 }, sailRaw: { c: 3 }, staleEngine: { old: true } },
  _registeredBy: "someone",
};
const written = assembledDoc(layer, { ropes: [1], rigging: [2], staleEngine: { fresh: true }, loose: 0 }, {
  ropes: "ropeRaw",
  rigging: ["ropeRaw", "knotRaw", "sailRaw"],
  staleEngine: "missingRaw",
});
eq("the write keeps the doc's id and source", [written.id, written.source], [layer.id, layer.source]);
check("the store's own bookkeeping is not written back", !("_registeredBy" in written));
eq("raw tables stay beside the engine tables", Object.keys(written.tables).sort(), ["knotRaw", "loose", "rigging", "ropeRaw", "ropes", "sailRaw", "staleEngine"]);
eq("an engine table cites its raw table", written.cites.ropes, "ZZ p.10");
eq("an engine table read from several cites them all", written.cites.rigging, "ZZ p.10-11; QQ p.2");
check("an engine table whose raw pages are unknown drops a stale cite", !("staleEngine" in written.cites));
check("an engine table with no map entry cites nothing", !("loose" in written.cites));
eq("raw tables keep their own cites", [written.cites.ropeRaw, written.cites.sailRaw], ["ZZ p.10", "QQ p.2"]);
eq("a layer with no cites yields an empty map, not a throw", assembledDoc({ id: "x", tables: {} }, { t: 1 }, { t: "r" }).cites, {});

/* ------------------------- the bindings' maps ------------------------- */

// Every raw table a binding names is one some recipe of that document reads,
// so a renamed recipe cannot leave an engine table citing nothing in silence.
const maps = { ...FLIGHT, ...SURVIVAL, ...SEARCHING, ...CITY, ...FORAGING, ...TRAVEL, ...ENCOUNTERS, ...WEATHER, ...VOYAGES, ...BUILDER };
check("ten documents declare what they assemble", Object.keys(maps).length === 10);
for (const [docId, map] of Object.entries(maps)) {
  const recipes = TABLE_RECIPES[docId]?.tables;
  check(`${docId}: a recipe document exists`, !!recipes);
  const unknown = Object.values(map).flat().filter((raw) => !(raw in recipes));
  eq(`${docId}: every raw table named is a recipe`, unknown, []);
  const shadowed = Object.keys(map).filter((key) => key in recipes);
  eq(`${docId}: no engine table shares a raw table's key`, shadowed, []);
}

// Every shipped recipe yields a citation: a table the browser lists with no
// page would be one the Judge cannot check against the book.
const uncited = Object.entries(TABLE_RECIPES).flatMap(([docId, doc]) =>
  Object.entries(doc.tables).filter(([, recipe]) => !recipeCite(recipe)).map(([tableId]) => `${docId}.${tableId}`),
);
eq("every recipe cites a page", uncited, []);

console.log(`test-produces: ${pass} checks passed.`);
