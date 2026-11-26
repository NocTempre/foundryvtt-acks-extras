/**
 * Which tabs a seat gets on a place's sheet, and what the Storage body draws
 * for it. The sheet class needs Foundry's application classes, so
 * `#prepareVisibleTabs` is cut out of the source and run over a mock sheet:
 * what is proved is the decision itself (the sheet's own text), not a copy.
 *
 * Storage shows to a seat that observes the place (`canSeeStorage`, Foundry's
 * own test); Things, Settings and GM View stay the Judge's. The Storage body is
 * rendered with plain Handlebars over the template's own text for an observer
 * and for a Judge, so the controls that write to the place are proved absent
 * from the first and present on the second.
 *
 * Every place and seat is invented.
 *
 * Run: node tools/test-location-seat.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import Handlebars from "handlebars";

let passed = 0;
const ok = (label, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${label}`);
};

const source = fs.readFileSync("scripts/location/apps/location-sheet.mjs", "utf8");
const template = fs.readFileSync("templates/location/location-sheet.hbs", "utf8");

/* -------------------------------------------- */
/*  The tab decision, cut out of the source      */
/* -------------------------------------------- */

const ALL_TABS = ["contents", "notes", "recruitment", "henchmen", "mercenaries", "specialists", "trade", "ventures", "storage", "research", "things", "gmSettings", "gmView"];
const MARKET_TABS = JSON.parse(source.match(/const MARKET_TABS = (\[[^\]]*\]);/)[1]);
const head = source.indexOf("#prepareVisibleTabs(context) {");
assert.ok(head > 0, "the tab decision was found");
const body = source.slice(head + "#prepareVisibleTabs(context) {".length, source.indexOf("\n  }\n", head));
const decide = new Function("game", "MARKET_TABS", `return function (context) {${body}\n}`);

/** A seat's tab ids for a place: `level` is the seat's permission level on it, `isGM` its role. */
function tabsFor({ isGM = false, level = "NONE", hasMarket = true } = {}) {
  const need = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };
  const actor = { testUserPermission: (user, want) => !!user.isGM || need[level] >= need[want] };
  const user = { isGM };
  const sheet = {
    tabGroups: { primary: "contents" },
    _prepareTabs: () => Object.fromEntries(ALL_TABS.map((id) => [id, { id, active: id === "contents", cssClass: id === "contents" ? "active" : "" }])),
  };
  // What `_prepareContext` puts in the context before it asks.
  const context = { hasMarket, canSeeStorage: actor.testUserPermission(user, "OBSERVER") };
  return Object.keys(decide({ user }, MARKET_TABS).call(sheet, context));
}

const JUDGE_TABS = ["things", "gmSettings", "gmView"];
const playerTabs = ALL_TABS.filter((id) => id !== "storage" && !JUDGE_TABS.includes(id));

ok("a Judge's seat has every tab, in the sheet's order", () => {
  assert.deepEqual(tabsFor({ isGM: true, level: "NONE" }), ALL_TABS);
  assert.deepEqual(tabsFor({ isGM: true, level: "OWNER", hasMarket: false }), ALL_TABS.filter((id) => !MARKET_TABS.includes(id)));
});

ok("a Judge's seat gets the sheet's own tab map back whole", () => {
  const user = { isGM: true };
  const mine = { tabGroups: { primary: "contents" }, _prepareTabs: () => Object.fromEntries(ALL_TABS.map((id) => [id, { id, active: id === "contents", cssClass: id === "contents" ? "active" : "", label: id }])) };
  const expected = mine._prepareTabs();
  assert.deepEqual(decide({ user }, MARKET_TABS).call(mine, { hasMarket: true, canSeeStorage: true }), expected);
  for (const id of MARKET_TABS) delete expected[id];
  assert.deepEqual(decide({ user }, MARKET_TABS).call(mine, { hasMarket: false, canSeeStorage: true }), expected);
});

ok("an owner keeps Things, Settings and GM View out, and has Storage", () => {
  assert.deepEqual(tabsFor({ level: "OWNER" }), ALL_TABS.filter((id) => !JUDGE_TABS.includes(id)));
});

ok("an observer has Storage and no Judge tab", () => {
  const tabs = tabsFor({ level: "OBSERVER" });
  assert.ok(tabs.includes("storage"));
  for (const id of JUDGE_TABS) assert.ok(!tabs.includes(id), id);
});

ok("a seat with LIMITED sees no Storage and no Judge tab", () => {
  assert.deepEqual(tabsFor({ level: "LIMITED" }), playerTabs);
  assert.deepEqual(tabsFor({ level: "NONE" }), playerTabs);
});

ok("a place with no market drops the market tabs and keeps Storage for an observer", () => {
  const tabs = tabsFor({ level: "OBSERVER", hasMarket: false });
  assert.deepEqual(tabs, ["contents", "notes", "storage", "research"]);
});

ok("the context field is Foundry's own test, and the decision reads it", () => {
  assert.match(source, /context\.canSeeStorage = actor\.testUserPermission\(game\.user, "OBSERVER"\);/);
  assert.match(body, /if \(!context\.canSeeStorage\) delete tabs\.storage;/);
  assert.equal(body.match(/delete tabs\.storage/g).length, 1, "no role test deletes it as well");
});

/* -------------------------------------------- */
/*  The Storage body per seat                    */
/* -------------------------------------------- */

const hb = Handlebars.create();
hb.registerHelper("localize", (key) => String(key));
hb.registerHelper("helperMissing", () => "");
// The partials are other surfaces' bodies; the sections around them are what is read.
for (const name of template.matchAll(/\{\{>\s*"([^"]+)"/g)) hb.registerPartial(name[1], "");
const sheet = hb.compile(template);

const SECTION = /<section class="tab location-tab [^"]*" data-group="primary" data-tab="([^"]+)"/g;
const sectionsOf = (html) => [...html.matchAll(SECTION)].map((m) => m[1]);
const tabMap = (ids) => Object.fromEntries(ids.map((id) => [id, { id, cssClass: "" }]));

const groups = [
  { ownerUuid: "house", name: "House", isHouse: true, houseControls: false, canTake: false, coinGC: 12, rows: [{ id: "r1", name: "Rope", img: "x.png", type: "item", quantity: 1, retrievable: false, canTake: false }] },
  { ownerUuid: "Actor.hero", name: "Hero", canTake: true, coinGC: 0, rows: [{ id: "r2", name: "Lamp", img: "x.png", type: "item", quantity: 1, retrievable: false, canTake: true }] },
];

const observer = (over = {}) => sheet({ isGM: false, editable: false, hasMarket: true, tabs: tabMap(["contents", "notes", "storage", "research"]), holdsGoods: true, canDeposit: true, groups, ...over });
const judge = (over = {}) => sheet({ isGM: true, editable: true, hasMarket: true, tabs: tabMap(ALL_TABS), holdsGoods: true, canDeposit: true, keying: { count: 0 }, groups: groups.map((g) => ({ ...g, canTake: true, houseControls: !!g.isHouse })), ...over });

ok("an observer's render has the Storage body and no Judge body", () => {
  const sections = sectionsOf(observer());
  assert.ok(sections.includes("storage"));
  for (const id of JUDGE_TABS) assert.ok(!sections.includes(id), id);
});

ok("a seat without the tab draws no Storage body", () => {
  assert.ok(!sectionsOf(observer({ tabs: tabMap(["contents", "notes", "research"]) })).includes("storage"));
});

ok("an observer's Storage has no Open manager, no house lock and no Hold goods", () => {
  const html = observer();
  assert.doesNotMatch(html, /data-action="openManager"/);
  assert.doesNotMatch(html, /data-action="houseRetrievable"/);
  assert.match(html, /data-action="depositHere"/, "the deposit follows canDeposit");
  assert.doesNotMatch(observer({ holdsGoods: false }), /data-action="holdGoods"/, "storage off offers no switch to a non-Judge");
});

ok("Take shows on the rows the context lets through and on no other", () => {
  const html = observer();
  assert.equal([...html.matchAll(/data-action="retrieveRow"/g)].length, 1, "one row is takeable");
  assert.match(html, /data-item-id="r2"[\s\S]*?data-action="retrieveRow"/);
  assert.equal([...html.matchAll(/data-action="retrieveAll"/g)].length, 1, "one group is takeable");
});

ok("a Judge's render keeps every Judge tab and Storage control", () => {
  const sections = sectionsOf(judge());
  for (const id of ["storage", ...JUDGE_TABS]) assert.ok(sections.includes(id), id);
  const html = judge();
  assert.match(html, /data-action="openManager"/);
  assert.match(html, /data-action="houseRetrievable"/);
  assert.match(html, /data-action="depositHere"/);
  assert.match(judge({ holdsGoods: false }), /data-action="holdGoods"/, "Hold goods stays on a Judge's seat");
});

ok("the Judge's tab bodies keep their order: Things, Storage, Settings, GM View", () => {
  const sections = sectionsOf(judge());
  const order = ["things", "storage", "gmSettings", "gmView"].map((id) => sections.indexOf(id));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(order.every((i) => i >= 0));
});

/* -------------------------------------------- */
/*  A pile takes no deposit                      */
/* -------------------------------------------- */

ok("the sheet leaves a ground pile out of canDeposit", () => {
  assert.match(source, /!places\.isGroundPile\(actor\) &&/);
  assert.match(source, /context\.canDeposit =\s*context\.holdsGoods &&/);
});

ok("the Storage controls an observer may press stay live on a sheet it cannot edit", () => {
  const selector = source.match(/const VIEWER_CONTROLS = '([^']*)'/)[1];
  for (const action of ["depositHere", "retrieveAll", "retrieveRow"]) assert.ok(selector.includes(`[data-action="${action}"]`), action);
  assert.ok(selector.includes('[data-tab="storage"]') && selector.includes("input[data-pick]"));
  for (const kept of ['[data-tab="trade"]', "[data-research-control]", "[data-candidate-filter]"]) assert.ok(selector.includes(kept), kept);
  assert.ok(!selector.includes('"openManager"') && !selector.includes('"holdGoods"') && !selector.includes('"houseRetrievable"'), "no Judge control is re-enabled");
});

console.log(`test-location-seat: ${passed} passed`);
