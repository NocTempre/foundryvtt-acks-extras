/**
 * Which tabs a seat gets on a place's sheet, and what the Storage body draws
 * for it. The sheet class needs Foundry's application classes, so
 * `#prepareVisibleTabs` is cut out of the source and run over a mock sheet:
 * what is proved is the decision itself (the sheet's own text), not a copy.
 *
 * Storage shows to a seat that observes the place (`canSeeStorage`, Foundry's
 * own test) and Settings to a seat that can edit it (`isEditable`); Things and
 * GM View stay the Judge's. The bodies are rendered with plain Handlebars over
 * the template's own text for an observer, an owner and a Judge, so the controls
 * that write to the place are proved absent from the first and present on the
 * others, and the Judge's slander from every seat but the Judge's.
 *
 * Every place and seat is invented.
 *
 * Run: node tools/test-location-seat.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import Handlebars from "handlebars";

let passed = 0;
// Cases run in order, an async one awaited before the next, and a failure
// rejects the final `await chain` below.
let chain = Promise.resolve();
const ok = (label, fn) => {
  chain = chain.then(async () => {
    await fn();
    passed++;
    console.log(`  ok  ${label}`);
  });
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
    // Core's `isEditable`: the seat owns the place.
    isEditable: actor.testUserPermission(user, "OWNER"),
    actor: { isOwner: actor.testUserPermission(user, "OWNER") },
    tabGroups: { primary: "contents" },
    _prepareTabs: () => Object.fromEntries(ALL_TABS.map((id) => [id, { id, active: id === "contents", cssClass: id === "contents" ? "active" : "" }])),
  };
  // What `_prepareContext` puts in the context before it asks.
  const context = { hasMarket, canSeeStorage: actor.testUserPermission(user, "OBSERVER") };
  return Object.keys(decide({ user }, MARKET_TABS).call(sheet, context));
}

const JUDGE_TABS = ["things", "gmView"];
const playerTabs = ALL_TABS.filter((id) => !["storage", "gmSettings"].includes(id) && !JUDGE_TABS.includes(id));

ok("a Judge's seat has every tab, in the sheet's order", () => {
  assert.deepEqual(tabsFor({ isGM: true, level: "NONE" }), ALL_TABS);
  assert.deepEqual(tabsFor({ isGM: true, level: "OWNER", hasMarket: false }), ALL_TABS.filter((id) => !MARKET_TABS.includes(id)));
});

ok("a Judge's seat gets the sheet's own tab map back whole", () => {
  const user = { isGM: true };
  const mine = { isEditable: true, actor: { isOwner: true }, tabGroups: { primary: "contents" }, _prepareTabs: () => Object.fromEntries(ALL_TABS.map((id) => [id, { id, active: id === "contents", cssClass: id === "contents" ? "active" : "", label: id }])) };
  const expected = mine._prepareTabs();
  assert.deepEqual(decide({ user }, MARKET_TABS).call(mine, { hasMarket: true, canSeeStorage: true }), expected);
  for (const id of MARKET_TABS) delete expected[id];
  assert.deepEqual(decide({ user }, MARKET_TABS).call(mine, { hasMarket: false, canSeeStorage: true }), expected);
  // A locked pack's place is not editable even for a Judge, who still owns it: Settings shows, its fields disabled by core.
  const locked = { ...mine, isEditable: false };
  assert.ok("gmSettings" in decide({ user }, MARKET_TABS).call(locked, { hasMarket: true, canSeeStorage: true }), "a Judge keeps Settings on a locked pack's place");
});

ok("an owner has Storage and Settings, and keeps Things and GM View out", () => {
  assert.deepEqual(tabsFor({ level: "OWNER" }), ALL_TABS.filter((id) => !JUDGE_TABS.includes(id)));
});

ok("an observer has Storage and neither Settings nor a Judge tab", () => {
  const tabs = tabsFor({ level: "OBSERVER" });
  assert.ok(tabs.includes("storage"));
  for (const id of [...JUDGE_TABS, "gmSettings"]) assert.ok(!tabs.includes(id), id);
});

ok("a seat with LIMITED sees no Storage, no Settings and no Judge tab", () => {
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
  assert.match(body, /if \(!this\.actor\.isOwner\) delete tabs\.gmSettings;/, "Settings follows ownership");
  assert.equal(body.match(/delete tabs\.gmSettings/g).length, 1, "no role test deletes it as well");
  assert.match(body, /if \(!game\.user\.isGM\) \{\s*delete tabs\.things;\s*delete tabs\.gmView;\s*\}/, "Things and GM View stay the Judge's");
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
  for (const id of ["storage", "gmSettings", ...JUDGE_TABS]) assert.ok(sections.includes(id), id);
  const html = judge();
  assert.match(html, /data-action="openManager"/);
  assert.match(html, /data-action="houseRetrievable"/);
  assert.match(html, /data-action="depositHere"/);
  assert.match(judge({ holdsGoods: false }), /data-action="holdGoods"/, "Hold goods stays on a Judge's seat");
});

/* -------------------------------------------- */
/*  The Settings body and the controls that write per seat */
/* -------------------------------------------- */

const OWNER_TABS = ["contents", "notes", "recruitment", "storage", "research", "gmSettings"];
const slanderRows = [{ index: 0, subject: { scope: "all", uuid: "" }, npcName: "Rumour", note: "n" }];
const occupantRows = [{ uuid: "Actor.npc1", name: "Guard", kind: "npc", kindLabel: "NPC", derived: false, hidden: false }];
const placeRows = [
  { uuid: "Actor.mine", name: "Annex", isPlace: true, icon: "fa-map", canDetach: true },
  { uuid: "Actor.theirs", name: "Keep", isPlace: true, icon: "fa-map", canDetach: false },
];
const owner = (over = {}) =>
  sheet({
    isGM: false,
    editable: true,
    hasMarket: true,
    tabs: tabMap(OWNER_TABS),
    holdsGoods: false,
    canDeposit: true,
    groups,
    slander: slanderRows,
    occupants: occupantRows,
    contentRows: placeRows,
    isStacked: true,
    stackCount: 3,
    canSplit: true,
    canExportTable: true,
    system: { market: { urbanFamilies: 1 } },
    ...over,
  });
const judgeFull = (over = {}) => judge({ slander: slanderRows, occupants: occupantRows, contentRows: placeRows, isStacked: true, canSplit: true, canExportTable: true, system: { market: { urbanFamilies: 1 } }, ...over });
const has = (html, action) => html.includes(`data-action="${action}"`);

ok("an owner's render has the Settings body, and neither Things nor GM View", () => {
  const sections = sectionsOf(owner());
  assert.ok(sections.includes("gmSettings") && sections.includes("storage"));
  for (const id of JUDGE_TABS) assert.ok(!sections.includes(id), id);
  assert.ok(!sectionsOf(observer()).includes("gmSettings"), "an observer's tabs carry no Settings, so the body is not drawn");
  assert.ok(!sectionsOf(owner({ tabs: tabMap(["contents", "notes", "storage"]) })).includes("gmSettings"), "the body follows the tab and nothing else");
});

ok("the Judge's slander is drawn whole on a Judge's seat and not at all on an owner's", () => {
  const mine = owner();
  assert.ok(!has(mine, "addSlander") && !has(mine, "removeSlander"), "no slander control");
  assert.doesNotMatch(mine, /system\.market\.slander/, "the form carries no slander path, so the Judge's rows are left as stored");
  assert.doesNotMatch(mine, /slander-row|Rumour/, "no row, and no row's text");
  const theirs = judgeFull();
  assert.ok(has(theirs, "addSlander") && has(theirs, "removeSlander"));
  assert.match(theirs, /system\.market\.slander\.0\.npcName/);
});

ok("an owner's Settings keeps Remove market, and its Add market where there is none", () => {
  assert.ok(has(owner(), "removeMarket"));
  const none = owner({ hasMarket: false });
  assert.ok(has(none, "addMarket"), "Add market on a place with none");
  assert.ok(!has(owner({ editable: false, hasMarket: false, tabs: tabMap(["contents", "notes", "storage"]) }), "addMarket"), "an observer is offered none");
});

ok("Hold goods, the role select and the note edit follow the editor; the hidden toggle stays the Judge's", () => {
  const roleSelect = /<select name="system\.role">/;
  assert.ok(has(owner(), "holdGoods") && roleSelect.test(owner()) && has(owner(), "editOccupantNote"), "an owner has all three");
  assert.ok(!has(owner(), "toggleOccupantHidden"), "no hidden toggle for an owner");
  assert.ok(has(judgeFull(), "toggleOccupantHidden") && has(judgeFull(), "editOccupantNote"), "a Judge has both");
  const watcher = observer({ holdsGoods: false, occupants: occupantRows, roleTag: { icon: "fa-door", label: "Gate" } });
  assert.ok(!has(watcher, "holdGoods") && !roleSelect.test(watcher) && !has(watcher, "editOccupantNote"), "an observer has none");
  assert.match(watcher, /Gate/, "the observer still reads the role as a tag");
});

ok("Open manager stays the Judge's until its own slice", () => {
  assert.ok(!has(owner(), "openManager") && has(judgeFull(), "openManager"));
});

ok("Detach is drawn on the rows the context marks, one place and not the other", () => {
  assert.equal([...owner().matchAll(/data-action="detachPlace"/g)].length, 1);
  assert.equal([...judgeFull().matchAll(/data-action="detachPlace"/g)].length, 1, "a Judge's context marks the rows it owns, which is every one it lists");
  assert.equal([...observer({ contentRows: placeRows }).matchAll(/data-action="detachPlace"/g)].length, 1, "the template reads the row's own mark");
});

ok("Split and the demographics export are drawn on their own tests", () => {
  assert.ok(has(owner(), "splitStack") && has(owner(), "exportDemographics"));
  const without = owner({ canSplit: false, canExportTable: false });
  assert.ok(!has(without, "splitStack") && !has(without, "exportDemographics"), "no create right, no control");
  assert.ok(!has(owner({ isStacked: false }), "splitStack"), "a place that is not stacked has none to split");
});

ok("the candidate and special-hire removals are drawn for the editor and not the role", () => {
  const rows = template.match(/\{\{#if @root\.(editable|isGM)\}\}\s*<a data-action="(removeCandidate|editSpecialNote)"/g) ?? [];
  assert.equal(rows.length, 4 + 1, "four candidate removals and the special-hire group");
  for (const row of rows) assert.match(row, /@root\.editable/);
  assert.match(template, /\{\{#if @root\.isGM\}\}\s*<a data-action="togglePlayerDetails"/, "the details mask stays the Judge's");
});

/* ---- the seat fields and the handlers, cut out of the source ---- */

/** A method's declared parameters and body, cut out of the sheet's source. */
function bodyOf(name) {
  const open = new RegExp(`${name.replace(/[#$]/g, "\\$&")}\\(([^)]*)\\) \\{\\n`).exec(source);
  assert.ok(open, `${name} was found`);
  const start = open.index + open[0].length;
  return { params: open[1], body: source.slice(start, source.indexOf("\n  }\n", start)) };
}
/**
 * A handler rebuilt over mocks: its own parameters, the globals it reads, and
 * `this`. A private member cannot be named outside its class, so
 * `this.#promptNote` is read as `this.promptNote`, which a mock sheet may supply.
 */
const rebuild = (name, globals) => {
  const { params, body } = bodyOf(name);
  return new Function(...Object.keys(globals), `return async function (${params}) {${body.replaceAll("this.#", "this.")}\n}`)(...Object.values(globals));
};

/** The calls a handler made against its spies. */
function spies() {
  const calls = [];
  const spy = (label, value) => (...args) => (calls.push(label), value);
  return { calls, spy };
}

ok("canSplit and canExportTable are the seat's own create rights", () => {
  // The statement that sets the field, cut out of `_prepareContext` and run over mocks.
  const read = (name, opts) => {
    const statement = source.match(new RegExp(`context\\.${name} = [^;]*;`))[0];
    const fn = new Function("Actor", "RollTable", "game", "context", statement);
    const context = {};
    fn.call({ isEditable: opts.isEditable }, { canUserCreate: () => opts.actorCreate }, { canUserCreate: () => opts.tableCreate }, { user: {} }, context);
    return context[name];
  };
  assert.equal(read("canSplit", { isEditable: true, actorCreate: true }), true);
  assert.equal(read("canSplit", { isEditable: true, actorCreate: false }), false, "no create right");
  assert.equal(read("canSplit", { isEditable: false, actorCreate: true }), false, "no ownership");
  assert.equal(read("canExportTable", { tableCreate: true }), true);
  assert.equal(read("canExportTable", { tableCreate: false }), false);
});

ok("Split, Export, Detach, the notes, Add market, Hold goods and the lock do nothing for a seat that may not", async () => {
  const { calls, spy } = spies();
  const places = { splitPlace: spy("splitPlace"), setParent: spy("setParent") };
  const actor = { update: spy("actor.update"), system: { hasMarket: false }, items: { get: () => ({ getFlag: () => ({}), setFlag: spy("setFlag") }) } };
  const storage = () => ({ setProvider: spy("setProvider") });
  const base = { places, emptyMarket: () => ({}), LANG_PREFIX: "L", game: { user: { isGM: false }, i18n: { format: (k) => k } }, ui: { notifications: { info: () => {} } }, Actor: { canUserCreate: () => false }, RollTable: { canUserCreate: () => false, create: spy("RollTable.create") }, fromUuid: async () => ({}), storage, optTable: () => ({}), loc: (k) => k };
  const noOwner = { isEditable: false, actor: { ...actor, isOwner: false }, render: spy("render") };
  const target = { closest: () => ({ dataset: { placeUuid: "Actor.x", occupantUuid: "Actor.npc1", specialId: "s1", itemId: "r1" } }) };
  for (const name of ["#onDetachPlace", "#onEditOccupantNote", "#onEditSpecialNote", "#onSplitStack", "#onAddMarket", "#onHouseRetrievable", "#onHoldGoods"]) {
    await rebuild(name, base).call(noOwner, null, target);
  }
  await rebuild("#onExportDemographics", base).call({ ...noOwner, isEditable: true });
  await rebuild("#onSplitStack", base).call({ ...noOwner, isEditable: true, actor: { ...actor, isOwner: true } }, null, target);
  assert.deepEqual(calls, [], "no write, no create");
  const owned = { isEditable: true, actor: { ...actor, isOwner: true }, render: spy("render") };
  await rebuild("#onDetachPlace", base).call(owned, null, target);
  await rebuild("#onHoldGoods", base).call(owned, null, target);
  await rebuild("#onSplitStack", { ...base, Actor: { canUserCreate: () => true } }).call(owned, null, target);
  await rebuild("#onAddMarket", base).call({ ...owned, tabGroups: {} }, null, target);
  assert.ok(["setParent", "setProvider", "splitPlace", "actor.update"].every((c) => calls.includes(c)), "an owner's presses reach their writes");
});

ok("Remove market on a seat that is not a Judge's counts no slander and still removes the market whole", async () => {
  const run = async (isGM, isEditable = true) => {
    let content = null;
    let update = null;
    const system = { hasMarket: true, postings: [1], candidates: [1, 2], specialHires: [], slander: [1, 2, 3] };
    const globals = {
      game: { user: { isGM }, i18n: { localize: (k) => k, format: (k) => k } },
      foundry: { applications: { api: { DialogV2: { confirm: async (o) => ((content = o.content), true) } } } },
      LANG_PREFIX: "L",
    };
    const sheetMock = { isEditable, actor: { name: "Market", system, update: async (u) => (update = u) }, tabGroups: {}, render() {} };
    await rebuild("#onRemoveMarket", globals).call(sheetMock);
    return { content, update };
  };
  const mine = await run(false);
  assert.match(mine.content, /L\.place\.discard\.postings/);
  assert.doesNotMatch(mine.content, /discard\.slander|3 ×/, "no slander line on an owner's confirm");
  assert.deepEqual(mine.update, { "system.market": null }, "the market goes whole, the slander with it");
  const judges = await run(true);
  assert.match(judges.content, /3 × L\.place\.discard\.slander/, "a Judge's confirm keeps its slander line");
  assert.deepEqual(judges.update, { "system.market": null });
  const watcher = await run(false, false);
  assert.deepEqual(watcher, { content: null, update: null }, "a seat that cannot edit gets no confirm and no write");
});

ok("a dropped place or hire needs the place's owner and the dropped actor's owner", async () => {
  const { calls, spy } = spies();
  const places = { isLocation: (a) => a.isLocation, setParent: spy("setParent") };
  const addSpecialHire = spy("addSpecialHire");
  const globals = {
    acksExtras: {},
    ui: { notifications: { info: () => {}, warn: () => {} } },
    game: { user: { isGM: false }, i18n: { format: (k) => k } },
    LANG_PREFIX: "L",
    places,
    addSpecialHire,
  };
  const drop = rebuild("_onDropActor", globals);
  const place = (isOwner) => ({ uuid: "Actor.p", isLocation: true, isOwner });
  const npc = (isOwner) => ({ uuid: "Actor.n", name: "Scribe", isLocation: false, isOwner });
  const onSheet = (isOwner, tab) => ({ actor: { uuid: "Actor.here", isOwner, system: { hasMarket: true, specialHires: [] } }, tabGroups: { primary: tab }, render() {} });
  const dropOn = (sheetMock, actor) => drop.call(sheetMock, { target: null }, actor);

  await dropOn(onSheet(true, "contents"), place(true));
  assert.deepEqual(calls.splice(0), ["setParent"], "an owner nests a place it owns under a place it owns");
  await dropOn(onSheet(true, "contents"), place(false));
  await dropOn(onSheet(false, "contents"), place(true));
  assert.deepEqual(calls.splice(0), [], "a place the seat only observes is not nested, and nothing nests under one it does not own");

  await dropOn(onSheet(true, "recruitment"), npc(true));
  assert.deepEqual(calls.splice(0), ["addSpecialHire"], "an owner lists its own NPC for hire");
  await dropOn(onSheet(true, "recruitment"), npc(false));
  await dropOn(onSheet(false, "recruitment"), npc(true));
  assert.deepEqual(calls.splice(0), [], "an NPC the seat only observes is not offered, and a place the seat does not own lists none");
});

ok("an item dropped from a compendium files under the house for the place's owner and is warned off for anyone else", async () => {
  const { calls, spy } = spies();
  const lib = { setProvider: spy("setProvider"), stockProvider: spy("stockProvider"), isProvider: () => false, stash: spy("stash") };
  const warnings = [];
  const globals = {
    takeThingDrop: async () => false,
    storage: () => lib,
    droppedGoods: (i) => [i],
    acksExtras: { lib: { money: { HOUSE_OWNER: "house" } } },
    game: { user: { isGM: false } },
    ui: { notifications: { warn: (m) => warnings.push(m) } },
    loc: (k) => k,
  };
  const drop = rebuild("_onDropItem", globals);
  const pack = { uuid: "Item.pack", parent: null };
  const ownerSheet = { actor: { uuid: "Actor.here", isOwner: true }, render() {} };
  await drop.call(ownerSheet, null, pack);
  assert.deepEqual(calls.splice(0), ["setProvider", "stockProvider"], "storage is switched on, then the item is stocked");
  await drop.call({ ...ownerSheet, actor: { uuid: "Actor.here", isOwner: false } }, null, pack);
  assert.deepEqual(calls.splice(0), [], "a seat that does not own the place changes nothing");
  assert.equal(warnings.length, 1);
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

/* -------------------------------------------- */
/*  lib's splitPlace                             */
/* -------------------------------------------- */

globalThis.acksExtras ??= {};
globalThis.foundry = { utils: { deepClone: (v) => (v == null || typeof v !== "object" ? v : structuredClone(v)) } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
globalThis.CONFIG = {};
globalThis.canvas = {};
globalThis.fromUuidSync = () => null;
globalThis.Hooks = { on() {}, once() {}, call() {}, callAll() {} };
globalThis.ui = { notifications: { warn() {} } };
globalThis.game = { user: { isGM: false, id: "u1" }, actors: [], i18n: { localize: (k) => k, format: (k) => k, has: () => false } };
const { splitPlace } = await import("../scripts/lib/place.mjs");

/** A stacked place of three, with spies on the writes `splitPlace` makes. */
function stackOf({ isOwner = true } = {}) {
  const writes = [];
  const doc = {
    uuid: "Actor.stack",
    name: "Bay",
    type: "acks-extras.location",
    img: "x.png",
    isOwner,
    system: { stack: { count: 3 }, region: "", parentUuid: "" },
    toObject: () => ({ ownership: { default: 3 }, flags: {} }),
    update: async (data) => writes.push(["update", data]),
  };
  return { doc, writes };
}

/** Run `splitPlace` with the seat's create right and the world's answer to the create. */
async function split({ canCreate, creates, isOwner }) {
  const { doc, writes } = stackOf({ isOwner });
  globalThis.Actor = {
    canUserCreate: () => canCreate,
    create: async (data) => {
      writes.push(["create", data]);
      return creates ? { uuid: "Actor.made", name: data.name } : undefined;
    },
  };
  const made = await splitPlace(doc, 1);
  return { made, writes };
}

ok("splitPlace creates the member and then lowers the count, for an owner who may create", async () => {
  const { made, writes } = await split({ canCreate: true, creates: true, isOwner: true });
  assert.equal(made?.uuid, "Actor.made");
  assert.deepEqual(writes.map((w) => w[0]), ["create", "update"], "the member first, then the count");
  assert.deepEqual(writes[1][1], { "system.stack.count": 2 });
});

ok("splitPlace changes no count when the seat may not create an actor", async () => {
  const { made, writes } = await split({ canCreate: false, creates: true, isOwner: true });
  assert.equal(made, null);
  assert.deepEqual(writes, [], "no create and no count write");
});

ok("splitPlace changes no count when the create is refused", async () => {
  const { made, writes } = await split({ canCreate: true, creates: false, isOwner: true });
  assert.equal(made, null);
  assert.deepEqual(writes.map((w) => w[0]), ["create"], "the create was tried and no count was lowered after it");
});

ok("splitPlace refuses a seat that does not own the place", async () => {
  const { made, writes } = await split({ canCreate: true, creates: true, isOwner: false });
  assert.equal(made, null);
  assert.deepEqual(writes, []);
});

await chain;
console.log(`test-location-seat: ${passed} passed`);
