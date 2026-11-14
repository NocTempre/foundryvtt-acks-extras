/**
 * Market reports and the trade house: which beliefs a party holds, how two
 * markets compare, what a non-GM is shown of an outcome, who may hand a report
 * over, and who counts as a trader, on mocked documents.
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
  chooseVerdict,
  isTraderProfile,
  notesToHtml,
  htmlToNotes,
  isAwaiting,
  dmLabel,
  storedDm,
  beliefTip,
} = await import(new URL("../scripts/markets/rules/reports.mjs", import.meta.url));

/* ------------------------- outcomes ------------------------- */

check("the outcome vocabulary is the five", REPORT_OUTCOMES.join() === "success,partial,expertise,false,rumor");
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
same(
  "a newer belief still awaiting the Judge leaves an older answered figure standing",
  beliefsFor([...reports, report("r6", { partyId: "p1", time: 999, beliefs: [{ category: "aa", dm: null }] })], { partyId: "p1", marketUuid: M1 }).map((b) => [b.category, b.dm]),
  [["aa", 4], ["bb", -1]],
);
same("a good with only an awaiting belief is not believed at all", beliefsFor([report("w", { partyId: "p1", beliefs: [{ category: "aa", dm: null }] })], { partyId: "p1" }), []);
same("a zero is a belief, not a waiting good", beliefsFor([report("z", { partyId: "p1", beliefs: [{ category: "aa", dm: 0 }] })], { partyId: "p1" }).map((b) => [b.category, b.dm]), [["aa", 0]]);
check("isAwaiting: null, missing and blank wait; zero does not", isAwaiting({ dm: null }) && isAwaiting({}) && isAwaiting({ dm: "" }) && !isAwaiting({ dm: 0 }) && !isAwaiting({ dm: -2 }));
same("dmLabel: null is no label, zero is \"0\", a rise is signed", [dmLabel(null), dmLabel(undefined), dmLabel(0), dmLabel(3), dmLabel(-2)], [null, null, "0", "+3", "-2"]);
same("storedDm: rounds a figure, keeps null for nothing", [storedDm("2.6"), storedDm(null), storedDm(""), storedDm(0), storedDm("x")], [3, null, null, 0, null]);
const tipBase = { outcome: "partial", truth: "+9", day: "Day 4", assessor: "Ann" };
same("tip: a player's answered figure names its report", beliefTip({ ...tipBase, awaiting: false, isGM: false }), { key: "tip.learned", data: { day: "Day 4", assessor: "Ann" } });
same("tip: a player reads a false report's figure the same way", beliefTip({ ...tipBase, outcome: "false", awaiting: false, isGM: false }), beliefTip({ ...tipBase, awaiting: false, isGM: false }));
same("tip: a player's waiting good", beliefTip({ ...tipBase, awaiting: true, isGM: false }), { key: "tip.awaiting", data: {} });
same("tip: the Judge's waiting good names the market's demand", beliefTip({ ...tipBase, awaiting: true, isGM: true }), { key: "tip.awaitingGM", data: { truth: "+9" } });
same("tip: the Judge's answered false figure is the Judge's own", beliefTip({ ...tipBase, outcome: "false", awaiting: false, isGM: true }).key, "tip.judgeSet");
same("tip: the Judge's answered other figure is read from the market", beliefTip({ ...tipBase, awaiting: false, isGM: true }).key, "tip.marketNow");
check("heldByParty: by party id",heldByParty({ partyId: "p1" }, { partyId: "p1" }));
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
same(
  "a belief still awaiting the Judge reads as absent on its side",
  compareBeliefs([{ category: "aa", dm: null }, { category: "bb", dm: 0 }], [{ category: "aa", dm: 4 }, { category: "bb", dm: null }]),
  [
    { category: "aa", a: null, b: 4, diff: null },
    { category: "bb", a: 0, b: null, diff: null },
  ],
);

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

const world = { actors: [], setting: "", settingWrites: 0, notes: [], chat: [] };
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
globalThis.foundry = { utils: { deepClone: clone, randomID: rid, escapeHTML: (s) => String(s) } };
globalThis.ChatMessage = { create: async (message) => world.chat.push(message) };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };
globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.ui = { notifications: { info: (m) => world.notes.push(m), warn: () => {} } };
globalThis.Actor = {
  create: async (data) => makeActor(data),
};
globalThis.game = {
  user: gm,
  users: Object.assign([gm, alice, bob], { get: (id) => [gm, alice, bob].find((u) => u.id === id) }),
  get actors() {
    return allActors();
  },
  i18n: { localize: (k) => k, format: (k, data) => (data ? `${k} ${JSON.stringify(data)}` : k), has: () => false },
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
const location = (name) => makeActor({ name, type: LOCATION });

check("no house is designated until something needs one", objects.tradeHouseSync() === null);
check("the house is not made for nothing", objects.tradeHouseSync() === null && world.settingWrites === 0);

const townA = location("Town A");
const townB = location("Town B");

const houseOwn = (market, partyId, time, beliefs) => objects.writeReport({ ownerUuid: HOUSE_OWNER, marketUuid: market.uuid, marketName: market.name, assessorUuid: "", partyId, time, outcome: "success", beliefs });
same("the first report on a market is written", (await houseOwn(townA, "p1", 400, [{ category: "aa", dm: 3 }, { category: "bb", dm: -2 }])).ok, true);
const house = objects.tradeHouseSync();
check("the house is a location actor holding storage", house?.type === LOCATION && house.getFlag("acks-extras", "storage")?.provider === true);
check("its default ownership is observer", house.ownership?.default === 2);
check("its uuid is the world setting, written once", world.setting === house.uuid && world.settingWrites === 1);
await houseOwn(townA, "p2", 250, [{ category: "aa", dm: 1 }]);
await houseOwn(townB, "p1", 50, [{ category: "cc", dm: 5 }]);
check("a second report does not make a second house", world.settingWrites === 1);
const written = objects.allReports().map(objects.plainReport);
check("three reports exist, all the house's own", written.length === 3 && written.every((r) => r.ownerUuid === HOUSE_OWNER));
const p1a = objects.objectsAt(townA.uuid).map(objects.plainReport).find((r) => r.partyId === "p1");
same("a party's report carries its beliefs and its time", [p1a.beliefs, p1a.time, p1a.marketName], [[{ category: "aa", dm: 3 }, { category: "bb", dm: -2 }], 400, "Town A"]);
same("objectsOf finds nothing for a character with no report", objects.objectsOf("Actor.nobody"), []);
same("the party reads its belief back through the pure rule", beliefsFor(objects.objectsAt(townA.uuid).map(objects.plainReport), { partyId: "p1", marketUuid: townA.uuid }).map((b) => [b.category, b.dm]), [["aa", 3], ["bb", -2]]);

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

/* ------------------------- choosing the goods a partial assessment left ------------------------- */

const CATALOG = ["aa", "bb", "cc"];
same("chooseVerdict: no picks left", chooseVerdict({ picks: 0, chosen: ["aa"], catalog: CATALOG }), { error: "noPicks" });
same("chooseVerdict: nothing ticked", chooseVerdict({ picks: 2, chosen: [], catalog: CATALOG }), { error: "noneChosen" });
same("chooseVerdict: only goods already believed", chooseVerdict({ picks: 2, chosen: ["aa"], believed: ["aa"], catalog: CATALOG }), { error: "noneChosen" });
same("chooseVerdict: a good the catalogue lacks", chooseVerdict({ picks: 2, chosen: ["zz"], catalog: CATALOG }), { error: "unknownGood" });
same("chooseVerdict: more goods than picks", chooseVerdict({ picks: 1, chosen: ["aa", "bb"], catalog: CATALOG }), { error: "tooMany", left: 1 });
same(
  "chooseVerdict: a good named twice or already believed costs nothing",
  chooseVerdict({ picks: 1, chosen: ["bb", "bb", "aa"], believed: ["aa"], catalog: CATALOG }),
  { ok: true, categories: ["bb"] }
);

const merchItem = (key) => ({ id: rid(), type: "acks-extras.merchandise", name: `Good ${key}`, uuid: `Item.${key}`, system: { key } });
game.items = CATALOG.map(merchItem);
const market = makeActor({
  name: "Town D",
  type: LOCATION,
  system: { market: { goods: { demand: [{ category: "aa", modifier: 2 }, { category: "bb", modifier: -1 }, { category: "cc", modifier: 0 }] } } },
});
const partial = (await objects.writeReport({ ownerUuid: hero.uuid, marketUuid: market.uuid, marketName: market.name, assessorUuid: hero.uuid, partyId: "p1", time: 5, outcome: "partial", beliefs: [], picks: 3 })).item;
same("a partial report is written holding its picks", objects.plainReport(partial).picks, 3);
same("a stranger cannot choose on it", await objects.chooseGoods(partial, ["aa"], { requestUserId: "bob" }), { error: "notYours" });
same("no card has been posted by the refusals", world.chat.length, 0);
same("its owner chooses the goods", await objects.chooseGoods(partial, ["aa", "bb"], { requestUserId: "alice" }), { ok: true, chosen: 2, left: 1 });
same("every chosen good waits for the Judge, the market's figure unread", objects.plainReport(partial).beliefs, [{ category: "aa", dm: null }, { category: "bb", dm: null }]);
check("the relayed choice whispered one card to the Judges alone", world.chat.length === 1 && world.chat[0].whisper.join() === "gm");
check("the card links the report and lists each chosen good", world.chat[0].content.includes(partial.uuid) && world.chat[0].content.split("<li>").length === 3);
same("a good already chosen cannot be chosen again", await objects.chooseGoods(partial, ["aa"], { requestUserId: "alice" }), { error: "noneChosen" });
same("nor more goods than the picks left", await objects.chooseGoods(partial, ["cc", "aa", "bb"], { requestUserId: "alice" }), { ok: true, chosen: 1, left: 0 });
same("with no picks left nothing more is chosen", await objects.chooseGoods(partial, ["cc"], { requestUserId: "alice" }), { error: "noPicks" });
check("each accepted relayed choice posted one card", world.chat.length === 2);

/* The Judge answers: no die is rolled for anything a choice writes. */
globalThis.Roll = class {
  constructor() {
    throw new Error("a chosen good rolls nothing");
  }
};
game.user = alice;
same("a player seat cannot answer from the market", await objects.answerFromMarket(partial), { error: "gmOnly" });
game.user = gm;
same("an item that is not on the house cannot be answered", await objects.answerFromMarket(elsewhere), { error: "notFound" });
same("the Judge's answer fills every awaiting good from the market", await objects.answerFromMarket(partial), { ok: true, answered: 3 });
same("the figures are the market's modifiers now", objects.plainReport(partial).beliefs, [{ category: "aa", dm: 2 }, { category: "bb", dm: -1 }, { category: "cc", dm: 0 }]);
same("a report with nothing awaiting refuses a second answer", await objects.answerFromMarket(partial), { error: "nonePending" });

const lie = (await objects.writeReport({ ownerUuid: hero.uuid, marketUuid: market.uuid, marketName: market.name, assessorUuid: hero.uuid, partyId: "p1", time: 6, outcome: "false", beliefs: [], picks: 1 })).item;
const twin = (await objects.writeReport({ ownerUuid: hero.uuid, marketUuid: market.uuid, marketName: market.name, assessorUuid: hero.uuid, partyId: "p1", time: 6, outcome: "partial", beliefs: [], picks: 1 })).item;
const cardsBefore = world.chat.length;
same("a false report's choice is accepted", await objects.chooseGoods(lie, ["aa"], { requestUserId: "alice" }), { ok: true, chosen: 1, left: 0 });
same("and writes the good awaiting, rolling nothing", objects.plainReport(lie).beliefs, [{ category: "aa", dm: null }]);
await objects.chooseGoods(twin, ["aa"], { requestUserId: "alice" });
same("a chosen partial report and a chosen false one store the same beliefs", objects.plainReport(twin).beliefs, objects.plainReport(lie).beliefs);
same("a false and a partial choice each posted one card", world.chat.length - cardsBefore, 2);
same("the Judge cannot answer a false report from the market", await objects.answerFromMarket(lie), { error: "falseReport" });
same("the false report still awaits", objects.plainReport(lie).beliefs, [{ category: "aa", dm: null }]);
await lie.update({ "system.beliefs": [{ category: "aa", dm: 5 }] });
same("a figure the Judge types is stored as typed", objects.plainReport(lie).beliefs, [{ category: "aa", dm: 5 }]);
const own = (await objects.writeReport({ ownerUuid: hero.uuid, marketUuid: market.uuid, marketName: market.name, assessorUuid: hero.uuid, partyId: "p1", time: 8, outcome: "partial", beliefs: [], picks: 1 })).item;
const cardsThen = world.chat.length;
same("the Judge's own choice is accepted", await objects.chooseGoods(own, ["bb"]), { ok: true, chosen: 1, left: 0 });
same("and posts no card", world.chat.length, cardsThen);
const orphan = (await objects.writeReport({ ownerUuid: hero.uuid, marketUuid: "Actor.gone", marketName: "Gone", assessorUuid: hero.uuid, partyId: "p1", time: 7, outcome: "partial", beliefs: [], picks: 1 })).item;
same("a report whose market is gone learns nothing", await objects.chooseGoods(orphan, ["aa"], { requestUserId: "alice" }), { error: "noMarket" });
const orphanWaiting = (await objects.writeReport({ ownerUuid: hero.uuid, marketUuid: "Actor.gone", marketName: "Gone", assessorUuid: hero.uuid, partyId: "p1", time: 9, outcome: "partial", beliefs: [{ category: "aa", dm: null }] })).item;
same("nor can a gone market answer a waiting good", await objects.answerFromMarket(orphanWaiting), { error: "noMarket" });
same("a waiting belief written through writeReport reads back null", objects.plainReport(orphanWaiting).beliefs, [{ category: "aa", dm: null }]);
same("a zero is a figure, not a waiting good", objects.plainReport((await objects.writeReport({ ownerUuid: hero.uuid, marketUuid: market.uuid, marketName: "x", assessorUuid: "", partyId: "p1", time: 1, outcome: "success", beliefs: [{ category: "aa", dm: 0 }] })).item).beliefs, [{ category: "aa", dm: 0 }]);

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
for (const key of ["awaiting", "awaitingCount", "awaitingCard", "awaitingCardLine", "choose.hint", "answer.button", "error.falseReport", "error.nonePending"]) check(`report.${key} has a string`, typeof lang[`ACKS-MARKETS.report.${key}`] === "string");
for (const state of ["learned", "awaiting", "judgeSet", "marketNow", "awaitingGM", "noMarket"]) check(`report.tip.${state} has a string`, typeof lang[`ACKS-MARKETS.report.tip.${state}`] === "string");
check("the sheet's Trade tab has a label", lang["ACKS-CHARACTER.tab.trade"] === "Trade");

console.log(`test-reports: OK (${pass} checks)`);
