/**
 * Market reports and the trade house: which beliefs a party holds, how two
 * markets compare, what a non-GM is shown of an outcome, who may hand a report
 * over, who counts as a trader, and the move of the legacy per-party beliefs
 * onto report Items (idempotence, permissions) on mocked documents.
 *
 * Every modifier, name and time below is invented; the tests prove the rules
 * read the data they are handed, never that the book says anything in particular.
 *
 * Run: npm test
 */
import assert from "node:assert";
import fs from "node:fs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};
const same = (label, actual, expected) => {
  assert.deepStrictEqual(actual, expected, label);
  pass++;
};

const {
  REPORT_OUTCOMES,
  shownOutcome,
  heldByParty,
  beliefsFor,
  compareBeliefs,
  groupByMarket,
  handVerdict,
  isTraderProfile,
  notesToHtml,
  htmlToNotes,
} = await import(new URL("../scripts/markets/rules/reports.mjs", import.meta.url));

/* ------------------------- outcomes ------------------------- */

check("the outcome vocabulary is the six", REPORT_OUTCOMES.join() === "success,partial,expertise,false,rumor,migrated");
check("a non-GM never reads a false outcome", shownOutcome("false", false) === "partial");
check("the GM reads it as it fell", shownOutcome("false", true) === "false");
check("every other outcome shows as it is", REPORT_OUTCOMES.filter((o) => o !== "false").every((o) => shownOutcome(o, false) === o));

/* ------------------------- beliefsFor ------------------------- */

const M1 = "Actor.market1";
const M2 = "Actor.market2";
const report = (id, o) => ({ id, marketUuid: M1, partyId: "", assessorUuid: "", time: 0, outcome: "success", beliefs: [], ...o });
const reports = [
  report("r1", { partyId: "p1", time: 100, beliefs: [{ category: "aa", dm: 2 }, { category: "bb", dm: -1 }] }),
  report("r2", { partyId: "p1", time: 300, beliefs: [{ category: "aa", dm: 4 }] }),
  report("r3", { partyId: "p2", time: 900, beliefs: [{ category: "aa", dm: -3 }, { category: "cc", dm: 1 }] }),
  report("r4", { assessorUuid: "Actor.a1", partyId: "p9", time: 200, beliefs: [{ category: "cc", dm: 5 }] }),
  report("r5", { marketUuid: M2, partyId: "p1", time: 400, beliefs: [{ category: "aa", dm: 7 }] }),
];

same("the newest belief per good wins", beliefsFor(reports, { partyId: "p1", marketUuid: M1 }).map((b) => [b.category, b.dm]), [["aa", 4], ["bb", -1]]);
same("another party's report never counts", beliefsFor(reports, { partyId: "p1", marketUuid: M1 }).some((b) => b.reportId === "r3"), false);
same(
  "a member's own assessment counts for the party whatever its stamp",
  beliefsFor(reports, { partyId: "p1", memberUuids: ["Actor.a1"], marketUuid: M1 }).map((b) => [b.category, b.dm]),
  [["aa", 4], ["bb", -1], ["cc", 5]],
);
same("the market filter keeps the markets apart", beliefsFor(reports, { partyId: "p1", marketUuid: M2 }).map((b) => [b.category, b.dm]), [["aa", 7]]);
same("with no market named every market is read, newest first", beliefsFor(reports, { partyId: "p1" }).find((b) => b.category === "aa").dm, 7);
same("a party with no report holds no belief", beliefsFor(reports, { partyId: "nobody", marketUuid: M1 }), []);
same("no party and no members holds nothing", beliefsFor(reports, {}), []);
same(
  "a tie on time goes to the later report",
  beliefsFor([report("t1", { partyId: "p1", time: 5, beliefs: [{ category: "aa", dm: 1 }] }), report("t2", { partyId: "p1", time: 5, beliefs: [{ category: "aa", dm: 9 }] })], { partyId: "p1" })[0].dm,
  9,
);
same("the row names its source report and outcome", (({ reportId, outcome }) => [reportId, outcome])(beliefsFor(reports, { partyId: "p2", marketUuid: M1 })[0]), ["r3", "success"]);
same("a false report's belief is read like any other", beliefsFor([report("f", { partyId: "p1", outcome: "false", beliefs: [{ category: "aa", dm: -6 }] })], { partyId: "p1" })[0].dm, -6);
check("heldByParty: by party id", heldByParty({ partyId: "p1" }, { partyId: "p1" }));
check("heldByParty: by member", heldByParty({ partyId: "px", assessorUuid: "Actor.a1" }, { partyId: "p1", memberUuids: ["Actor.a1"] }));
check("heldByParty: a blank assessor is nobody's", !heldByParty({ partyId: "px", assessorUuid: "" }, { partyId: "p1", memberUuids: [""] }));

/* ------------------------- compareBeliefs ------------------------- */

same(
  "the compare lists every good either side believes, with the difference where both do",
  compareBeliefs([{ category: "aa", dm: 2 }, { category: "bb", dm: 1 }], [{ category: "aa", dm: -1 }, { category: "cc", dm: 3 }]),
  [
    { category: "aa", a: 2, b: -1, diff: -3 },
    { category: "bb", a: 1, b: null, diff: null },
    { category: "cc", a: null, b: 3, diff: null },
  ],
);
same("a compare of nothing is nothing", compareBeliefs([], []), []);

/* ------------------------- groupByMarket ------------------------- */

const groups = groupByMarket([
  { marketUuid: M2, marketName: "Zed", time: 1 },
  { marketUuid: M1, marketName: "Alpha", time: 10 },
  { marketUuid: M1, marketName: "Alpha", time: 30 },
]);
same("markets sort by name", groups.map((g) => g.marketName), ["Alpha", "Zed"]);
same("reports in a market run newest first", groups[0].reports.map((r) => r.time), [30, 10]);

/* ------------------------- the hand-over check ------------------------- */

same("the owner of the stamp may discard", handVerdict({ isGM: false, ownsStamp: true }), { ok: true });
same("anyone else may not", handVerdict({ isGM: false, ownsStamp: false }), { error: "notYours" });
same("the GM may", handVerdict({ isGM: true, ownsStamp: false }), { ok: true });
same("the owner may give to another character", handVerdict({ isGM: false, ownsStamp: true, stampUuid: "Actor.a", targetUuid: "Actor.b", targetIsCharacter: true }), { ok: true });
same("a give needs a target", handVerdict({ isGM: false, ownsStamp: true, stampUuid: "Actor.a", targetUuid: null }), { error: "noTarget" });
same("a give needs a character", handVerdict({ isGM: true, ownsStamp: true, stampUuid: "Actor.a", targetUuid: "Actor.b", targetIsCharacter: false }), { error: "noTarget" });
same("a give to the holder is refused", handVerdict({ isGM: false, ownsStamp: true, stampUuid: "Actor.a", targetUuid: "Actor.a" }), { error: "sameOwner" });
same("a non-owner is refused before the target is looked at", handVerdict({ isGM: false, ownsStamp: false, stampUuid: "Actor.a", targetUuid: "Actor.b" }), { error: "notYours" });

/* ------------------------- notes ------------------------- */

same("notes are escaped, never markup", notesToHtml('<b>"x" & y</b>'), "&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;");
same("line breaks survive", notesToHtml("one\r\ntwo\nthree"), "one<br>two<br>three");
same("the editor text is the inverse", htmlToNotes(notesToHtml("a <i>b</i>\nc & 'd'")), "a <i>b</i>\nc & 'd'");

/* ------------------------- who is a trader ------------------------- */

check("a Bargaining ability makes a trader", isTraderProfile({ abilityNames: ["Bargaining"] }));
check("a merchant profession makes a trader", isTraderProfile({ abilityNames: ["Profession (merchant)"] }));
check("a Profession of anything else does not", !isTraderProfile({ abilityNames: ["Profession (sailor)", "Art/Craft (weaving)"] }));
check("the Mercantile Network effect makes a trader", isTraderProfile({ hasNetwork: true }));
check("owning a report makes a trader", isTraderProfile({ ownsReport: true }));
check("the Judge's flag makes a trader", isTraderProfile({ flagged: true }));
check("a character with none of them is not", !isTraderProfile({ abilityNames: ["Alertness"], hasNetwork: false, ownsReport: false, flagged: false }));
check("no facts, no trader", !isTraderProfile());

/* ------------------------- mocked documents ------------------------- */

let counter = 0;
const rid = () => `id${++counter}`;
const clone = (v) => JSON.parse(JSON.stringify(v));
const setDotted = (obj, path, value) => {
  const keys = path.split(".");
  let at = obj;
  for (const k of keys.slice(0, -1)) at = at[k] ??= {};
  at[keys.at(-1)] = value;
};

const world = { actors: [], setting: "", settingWrites: 0, notes: [] };
const allActors = () => Object.assign([...world.actors], { get: (id) => world.actors.find((a) => a.id === id) });

function makeItem(parent, data) {
  const id = rid();
  const item = {
    ...clone(data),
    id,
    parent,
    uuid: `${parent.uuid}.Item.${id}`,
    async update(patch) {
      for (const [k, v] of Object.entries(patch)) setDotted(item, k, v);
    },
    async delete() {
      parent.items.splice(parent.items.indexOf(item), 1);
    },
  };
  return item;
}

function makeActor(data) {
  const id = rid();
  const actor = {
    id,
    uuid: `Actor.${id}`,
    documentName: "Actor",
    isOwner: true,
    flags: {},
    items: [],
    ...data,
    getFlag: (scope, key) => actor.flags?.[scope]?.[key],
    async setFlag(scope, key, value) {
      (actor.flags[scope] ??= {})[key] = value;
    },
    testUserPermission: (user) => !!user?.isGM || !!user?.owns?.includes(actor.id),
    async createEmbeddedDocuments(_type, rows) {
      return rows.map((row) => {
        const item = makeItem(actor, row);
        actor.items.push(item);
        return item;
      });
    },
    async update(patch) {
      for (const [k, v] of Object.entries(patch)) setDotted(actor, k, v);
    },
  };
  world.actors.push(actor);
  return actor;
}

const gm = { id: "gm", isGM: true };
const alice = { id: "alice", isGM: false, owns: [] };
const bob = { id: "bob", isGM: false, owns: [] };
globalThis.foundry = { utils: { deepClone: clone, randomID: rid } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };
globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.ui = { notifications: { info: (m) => world.notes.push(m), warn: () => {} } };
globalThis.Actor = {
  create: async (data) => makeActor(data),
};
globalThis.game = {
  user: gm,
  users: { get: (id) => [gm, alice, bob].find((u) => u.id === id) },
  get actors() {
    return allActors();
  },
  i18n: { localize: (k) => k, format: (k) => k, has: () => false },
  settings: {
    get: () => world.setting,
    set: async (_scope, _key, value) => {
      world.setting = value;
      world.settingWrites++;
    },
  },
};
globalThis.fromUuidSync = (uuid) => world.actors.find((a) => a.uuid === uuid) ?? null;
globalThis.fromUuid = async (uuid) => {
  const [, actorId, , itemId] = String(uuid).split(".");
  const actor = world.actors.find((a) => a.id === actorId);
  return itemId ? (actor?.items.find((i) => i.id === itemId) ?? null) : (actor ?? null);
};

const objects = await import(new URL("../scripts/markets/engine/trade-objects.mjs", import.meta.url));
const { HOUSE_OWNER } = await import(new URL("../scripts/lib/money.mjs", import.meta.url));
const LOCATION = "acks-extras.location";
const location = (name, rows) => makeActor({ name, type: LOCATION, system: { market: { goods: { dmKnowledge: rows } } } });

check("no house is designated until something needs one", objects.tradeHouseSync() === null);
same("with no rows there is nothing to migrate and no house is made", await objects.migrateDmKnowledge(), { markets: 0, reports: 0 });
check("the house was not made for nothing", objects.tradeHouseSync() === null && world.settingWrites === 0);

const row = (partyId, category, believed, time) => ({ partyId, category, believed, time });
const townA = location("Town A", [row("p1", "aa", 3, 100), row("p1", "bb", -2, 400), row("p2", "aa", 1, 250)]);
const townB = location("Town B", [row("p1", "cc", 5, 50)]);
location("Town C", []);

game.user = alice;
same("a player's seat migrates nothing", await objects.migrateDmKnowledge(), { markets: 0, reports: 0 });
check("and leaves the rows where they were", townA.system.market.goods.dmKnowledge.length === 3);
game.user = gm;

same("the migration writes one report per market and party", await objects.migrateDmKnowledge(), { markets: 2, reports: 3 });
const house = objects.tradeHouseSync();
check("the house is a location actor holding storage", house?.type === LOCATION && house.getFlag("acks-extras", "storage")?.provider === true);
check("its default ownership is observer", house.ownership?.default === 2);
check("its uuid is the world setting, written once", world.setting === house.uuid && world.settingWrites === 1);
check("the rows are cleared", townA.system.market.goods.dmKnowledge.length === 0 && townB.system.market.goods.dmKnowledge.length === 0);
const written = objects.allReports().map(objects.plainReport);
check("three reports exist, all migrated, all the house's own", written.length === 3 && written.every((r) => r.outcome === "migrated" && r.ownerUuid === HOUSE_OWNER));
const p1a = objects.objectsAt(townA.uuid).map(objects.plainReport).find((r) => r.partyId === "p1");
same("a party's report carries its beliefs and its newest time", [p1a.beliefs, p1a.time, p1a.marketName], [[{ category: "aa", dm: 3 }, { category: "bb", dm: -2 }], 400, "Town A"]);
same("objectsOf finds nothing for a character with no report", objects.objectsOf("Actor.nobody"), []);
same("the party reads its belief back through the pure rule", beliefsFor(objects.objectsAt(townA.uuid).map(objects.plainReport), { partyId: "p1", marketUuid: townA.uuid }).map((b) => [b.category, b.dm]), [["aa", 3], ["bb", -2]]);

same("a second run finds nothing to move", await objects.migrateDmKnowledge(), { markets: 0, reports: 0 });
townA.system.market.goods.dmKnowledge = [row("p1", "aa", 3, 100)];
same("rows left behind by an interrupted run are cleared without a second report", await objects.migrateDmKnowledge(), { markets: 1, reports: 0 });
check("still three reports", objects.allReports().length === 3);
check("and the leftover rows are gone", townA.system.market.goods.dmKnowledge.length === 0);

/* ------------------------- give and discard on the house ------------------------- */

const hero = makeActor({ name: "Hero", type: "character" });
const friend = makeActor({ name: "Friend", type: "character" });
const stranger = makeActor({ name: "Stranger", type: "character" });
const monster = makeActor({ name: "Beast", type: "monster" });
alice.owns = [hero.id];
bob.owns = [stranger.id];

const made = await objects.writeReport({
  ownerUuid: hero.uuid,
  marketUuid: townA.uuid,
  marketName: townA.name,
  assessorUuid: hero.uuid,
  partyId: "p1",
  time: 777,
  outcome: "false",
  beliefs: [{ category: "aa", dm: -4 }],
});
check("a report is written on the house, stamped to its assessor", made.ok && objects.objectsOf(hero.uuid).length === 1);
same("the stamp names the actor", objects.plainReport(made.item).ownerName, "Hero");
same("the false outcome is stored as it fell", objects.plainReport(made.item).outcome, "false");
game.user = alice;
same("a player cannot write a report", (await objects.writeReport({ ownerUuid: hero.uuid })).error, "gmOnly");
game.user = gm;

const item = made.item;
same("a stranger's seat cannot give it", await objects.give(item, friend, { requestUserId: "bob" }), { error: "notYours" });
same("nor discard it", await objects.retire(item, { requestUserId: "bob" }), { error: "notYours" });
same("nor edit its notes", await objects.saveNotes(item, "x", { requestUserId: "bob" }), { error: "notYours" });
check("nothing moved", objects.objectsOf(hero.uuid).length === 1);
same("its owner cannot give it to a monster", await objects.give(item, monster, { requestUserId: "alice" }), { error: "noTarget" });
same("nor to themselves", await objects.give(item, hero, { requestUserId: "alice" }), { error: "sameOwner" });
same("its owner can write notes, which arrive escaped", await objects.saveNotes(item, "<i>&", { requestUserId: "alice" }), { ok: true });
same("the stored notes are inert", item.system.notes, "&lt;i&gt;&amp;");
same("its owner can give it to a character", await objects.give(item, friend, { requestUserId: "alice" }), { ok: true });
check("the stamp moved and nothing else did", objects.objectsOf(hero.uuid).length === 0 && objects.objectsOf(friend.uuid).length === 1 && item.system.time === 777);
same("the previous owner may no longer discard it", await objects.retire(item, { requestUserId: "alice" }), { error: "notYours" });
same("the GM may give any report anywhere", await objects.give(item, stranger, { requestUserId: null }), { ok: true });
same("the new owner may discard it", await objects.retire(item, { requestUserId: "bob" }), { ok: true });
check("it is gone from the house", objects.objectsOf(stranger.uuid).length === 0 && !objects.allReports().includes(item));
const elsewhere = makeItem(hero, { name: "Not a report", type: "acks-extras.marketReport", system: {} });
same("an item that is not on the house is never touched", await objects.retire(elsewhere, { requestUserId: null }), { error: "notFound" });

/* ------------------------- isTrader on mocked actors ------------------------- */

globalThis.foundry.applications = {
  api: { HandlebarsApplicationMixin: (Base) => class extends Base {} },
  sheets: { ItemSheetV2: class {} },
  ux: { TextEditor: { implementation: {} } },
};
globalThis.foundry.documents = { collections: { Items: { registerSheet() {} } } };
const { isTrader } = await import(new URL("../scripts/markets/apps/trader-tab.mjs", import.meta.url));
const person = (items, extra = {}) => ({ uuid: "Actor.zz", items, effects: [], getFlag: () => undefined, ...extra });
const ability = (name) => ({ id: rid(), type: "ability", name, effects: [] });
check("isTrader: a Bargaining ability", isTrader(person([ability("Bargaining")])));
check("isTrader: a merchant profession", isTrader(person([ability("Profession (merchant)")])));
check("isTrader: the Mercantile Network, by its own name", isTrader(person([ability("Mercantile Network")])));
check("isTrader: a report of their own on the house", isTrader(person([], { uuid: friend.uuid })) === false && (await objects.writeReport({ ownerUuid: friend.uuid, marketUuid: townB.uuid, marketName: "Town B", assessorUuid: friend.uuid, partyId: "p1", time: 1, outcome: "success", beliefs: [] })).ok && isTrader(person([], { uuid: friend.uuid })));
check("isTrader: the Judge's flag", isTrader(person([], { getFlag: (scope, key) => (scope === "acks-extras" && key === "markets" ? { trader: true } : undefined) })));
check("isTrader: none of them", !isTrader(person([ability("Alertness"), ability("Profession (sailor)")])));
check("isTrader: no actor", !isTrader(null));

/* ------------------------- the surfaces the tests cannot reach ------------------------- */

const lang = JSON.parse(fs.readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
for (const outcome of REPORT_OUTCOMES) check(`the outcome ${outcome} has a label`, typeof lang[`ACKS-MARKETS.report.outcome.${outcome}`] === "string");
for (const key of ["tradeHouse.name", "report.itemName", "report.noMarket", "trader.research", "trader.compare"]) check(`${key} has a string`, typeof lang[`ACKS-MARKETS.${key}`] === "string");
check("the sheet's Trade tab has a label", lang["ACKS-CHARACTER.tab.trade"] === "Trade");

console.log(`test-reports: OK (${pass} checks)`);
