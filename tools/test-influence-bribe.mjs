/**
 * The influence roller's bribe, checked before the roll counts it, and the
 * target the roller opens with.
 *
 * What is pinned. A bribe whose payer cannot cover the fee is left off the
 * roll: its modifier is not in the total or the card's list, the seat that
 * resolves the roll is warned, the card carries a note saying so, and no coin
 * moves. A covered bribe counts and is paid. The opening target is the one the
 * caller names, else the first targeted token's actor, never the influencer.
 *
 * Runs the real `InfluenceApp` against a small application mock and the real
 * coin lib against documents that answer what an EmbeddedCollection answers.
 * Every name and figure here is this file's own invention.
 *
 * Run: node tools/test-influence-bribe.mjs
 */
import assert from "node:assert/strict";

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

class Coll extends Map {
  get contents() { return [...this.values()]; }
  find(fn) { return this.contents.find(fn); }
  filter(fn) { return this.contents.filter(fn); }
  map(fn) { return this.contents.map(fn); }
  some(fn) { return this.contents.some(fn); }
  [Symbol.iterator]() { return this.values(); }
}

const setProperty = (obj, path, value) => {
  const parts = path.split(".");
  let node = obj;
  for (const key of parts.slice(0, -1)) node = node[key] ??= {};
  node[parts.at(-1)] = value;
  return true;
};

const warnings = [];
const cards = [];
const hookCalls = [];
let serial = 0;
let targets = [];

class MockApplication {
  constructor(options = {}) {
    this.options = { ...this.constructor.DEFAULT_OPTIONS, ...options };
  }
  render() { return Promise.resolve(this); }
  async _prepareContext() { return {}; }
  get rendered() { return false; }
}
class MockRoll {
  constructor(formula) {
    this.formula = formula;
    this.modifier = Number(/\(([-\d.]+)\)/.exec(formula)?.[1] ?? 0);
  }
  async evaluate() {
    this.dice = [{ total: 7 }];
    this.total = 7 + this.modifier;
    return this;
  }
}

globalThis.acksExtras ??= {};
globalThis.Hooks = { on() {}, once() {}, call() {}, callAll: (name, payload) => hookCalls.push([name, payload]) };
globalThis.ui = { notifications: { warn: (text) => warnings.push(text), info() {}, error() {} } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 }, CHAT_MESSAGE_STYLES: { OTHER: 0 } };
globalThis.Roll = MockRoll;
globalThis.ChatMessage = { create: (message) => cards.push(message), getSpeaker: () => ({}) };
globalThis.foundry = {
  utils: {
    setProperty,
    randomID: () => `r${++serial}`,
    deepClone: (v) => structuredClone(v),
    expandObject: (o) => {
      const out = {};
      for (const [key, value] of Object.entries(o)) setProperty(out, key, value);
      return out;
    },
    mergeObject: (a, b) => ({ ...a, ...b }),
  },
  data: { regionBehaviors: { RegionBehaviorType: class {} }, fields: new Proxy({}, { get: () => class {} }) },
  applications: {
    api: { ApplicationV2: MockApplication, HandlebarsApplicationMixin: (Base) => Base },
    ux: { DragDrop: { implementation: class { bind() {} } } },
    handlebars: { renderTemplate: async (_path, data) => { cards.push({ data }); return ""; } },
  },
};
const worldActors = new Coll();
globalThis.game = {
  items: new Coll(),
  actors: worldActors,
  scenes: [],
  packs: [],
  user: { isGM: true, id: "gm", get targets() { return targets; } },
  users: { get: () => null, filter: () => [], find: () => null, activeGM: null },
  i18n: { localize: (k) => k, format: (k) => k },
  settings: { get: () => true },
};
globalThis.acksExtras.lib = { resolveLevelValue: () => 0 };

function makeItem(data, parent) {
  const src = structuredClone(data);
  src._id ??= `i${++serial}`;
  src.flags ??= {};
  const doc = {
    get id() { return src._id; },
    get _id() { return src._id; },
    get name() { return src.name; },
    get type() { return src.type; },
    get img() { return src.img; },
    get system() { return src.system; },
    get flags() { return src.flags; },
    parent,
    getFlag: (scope, key) => src.flags?.[scope]?.[key],
    toObject: () => structuredClone(src),
    update: async (changes) => {
      parent.writes++;
      for (const [key, value] of Object.entries(changes)) setProperty(src, key, value);
      return doc;
    },
    delete: async () => {
      parent.writes++;
      parent.items.delete(src._id);
      return doc;
    },
  };
  return doc;
}

function makeActor({ id, name = id, items = [] }) {
  const actor = { id, name, type: "character", documentName: "Actor", uuid: `Actor.${id}`, isToken: false, system: {}, flags: {}, items: new Coll(), writes: 0 };
  actor.testUserPermission = () => true;
  Object.defineProperty(actor, "isOwner", { get: () => !!game.user.isGM || actor.owned === true });
  const add = (data) => {
    const doc = makeItem(data, actor);
    actor.items.set(doc.id, doc);
    return doc;
  };
  actor.createEmbeddedDocuments = async (_kind, datas) => { actor.writes++; return datas.map(add); };
  actor.updateEmbeddedDocuments = async (_kind, updates) => {
    const before = actor.writes;
    for (const { _id, ...changes } of updates) await actor.items.get(_id).update(changes);
    actor.writes = before + 1;
    return updates;
  };
  actor.deleteEmbeddedDocuments = async (_kind, ids) => { actor.writes++; for (const itemId of ids) actor.items.delete(itemId); };
  actor.getFlag = (scope, key) => actor.flags?.[scope]?.[key];
  for (const data of items) add(data);
  worldActors.set(actor.id, actor);
  return actor;
}

const gold = (qty) => ({
  name: "Gold",
  type: "money",
  img: "icons/svg/coins.svg",
  system: { coppervalue: 100, quantity: qty, quantitybank: 0, description: "" },
  flags: {},
});
const goldHeld = (actor) => actor.items.filter((i) => i.type === "money").reduce((n, i) => n + i.system.quantity, 0);

// The tier bonuses are the Judge's import; these are INVENTED.
const { registerTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
const TIER_BONUS = { 1: 5, 2: 7, 3: 9 };
registerTable({ id: "influence", tables: { bribeTiers: { tier1: TIER_BONUS[1], tier2: TIER_BONUS[2], tier3: TIER_BONUS[3] } } }, { priority: PRIORITY.WORLD });

const { default: InfluenceApp } = await import("../scripts/influence/influence-app.mjs");
const { openingTarget } = await import("../scripts/influence/actor-data.mjs");

let passed = 0;
const test = async (name, fn) => {
  serial = 0;
  warnings.length = 0;
  cards.length = 0;
  hookCalls.length = 0;
  targets = [];
  worldActors.clear();
  await fn();
  passed++;
  console.log(`  ok - ${name}`);
};

/** A Diplomacy roll with the bribe tier and fee set, rolled; returns the card's context. */
async function rollBribe({ payer, tier, fee }) {
  const app = new InfluenceApp({ actor: payer });
  const { form } = InfluenceApp.DEFAULT_OPTIONS;
  await form.handler.call(app, null, null, { object: { "mod.bribe": tier, "mod.bribeFee": fee } });
  await InfluenceApp.DEFAULT_OPTIONS.actions.roll.call(app);
  return cards.find((c) => c.data?.toneLabel)?.data;
}

/* -------------------------------------------- */
/*  The bribe                                   */
/* -------------------------------------------- */

console.log("influence: the bribe is checked before the roll");

await test("a bribe the payer can cover counts and is paid", async () => {
  const payer = makeActor({ id: "payer", items: [gold(10)] });
  const card = await rollBribe({ payer, tier: 2, fee: 4 });
  assert.equal(card.activeModifiers.some((m) => m.value === TIER_BONUS[2]), true, "the tier's modifier is in the card's list");
  assert.ok(card.bribePaid?.line, "the card states the payment");
  assert.equal(goldHeld(payer), 6, "the fee left the purse");
  assert.equal(card.rawNotes.includes("ACKS-INFLUENCE.note.bribeUnpaid"), false);
  assert.deepEqual(warnings, []);
});

await test("a bribe the payer cannot cover is left off the roll, and the card says why", async () => {
  const payer = makeActor({ id: "payer", items: [gold(3)] });
  const covered = makeActor({ id: "covered", items: [gold(10)] });
  const base = (await rollBribe({ payer: covered, tier: 2, fee: 4 })).modifier;
  cards.length = 0;
  warnings.length = 0;
  const card = await rollBribe({ payer, tier: 2, fee: 4 });
  assert.equal(card.modifier, base - TIER_BONUS[2], "the tier's figure is not in the total");
  assert.equal(card.activeModifiers.some((m) => m.value === TIER_BONUS[2]), false, "nor in the card's list");
  assert.equal(card.bribePaid, null, "no payment is stated");
  assert.equal(goldHeld(payer), 3, "no coin moved");
  assert.equal(card.rawNotes.includes("ACKS-INFLUENCE.note.bribeUnpaid"), true, "the card says the bribe was not paid");
  assert.equal(card.rawNotes.includes("ACKS-INFLUENCE.note.bribeRisk"), false, "an unarmed bribe carries no bribery risk note");
  assert.deepEqual(warnings, ["ACKS-INFLUENCE.bribe.unarmed"], "the resolving seat is told once");
});

await test("a fee exactly covered is paid", async () => {
  const payer = makeActor({ id: "payer", items: [gold(4)] });
  const card = await rollBribe({ payer, tier: 1, fee: 4 });
  assert.equal(goldHeld(payer), 0);
  assert.ok(card.bribePaid?.line);
});

await test("a tier with no fee has nothing to cover and counts", async () => {
  const payer = makeActor({ id: "payer", items: [gold(0)] });
  const card = await rollBribe({ payer, tier: 3, fee: 0 });
  assert.equal(card.activeModifiers.some((m) => m.value === TIER_BONUS[3]), true);
  assert.equal(card.rawNotes.includes("ACKS-INFLUENCE.note.bribeUnpaid"), false);
});

await test("a seat that may not write the payer cannot pay, so the bribe is left off", async () => {
  const payer = makeActor({ id: "payer", items: [gold(50)] });
  game.user.isGM = false;
  try {
    const card = await rollBribe({ payer, tier: 2, fee: 4 });
    assert.equal(card.activeModifiers.some((m) => m.value === TIER_BONUS[2]), false);
    assert.equal(card.rawNotes.includes("ACKS-INFLUENCE.note.bribeUnpaid"), true);
    assert.equal(goldHeld(payer), 50);
  } finally {
    game.user.isGM = true;
  }
});

/* -------------------------------------------- */
/*  The reaction table, through the roller      */
/* -------------------------------------------- */

console.log("influence: the result and the ladder are the page's");

const { INFLUENCE_ATTITUDE_LABELS } = await import("../scripts/influence/constants.mjs");
const { resetTables } = await import("../scripts/lib/tables.mjs");

/** A Diplomacy roll (the mock's dice total 7 plus the modifier) with the form fields given; returns the card's context and the hook payload. */
async function rollDiplomacy(object) {
  const app = new InfluenceApp({ actor: makeActor({ id: "roller" }) });
  await InfluenceApp.DEFAULT_OPTIONS.form.handler.call(app, null, null, { object });
  await InfluenceApp.DEFAULT_OPTIONS.actions.roll.call(app);
  return { card: cards.find((c) => c.data?.toneLabel)?.data, payload: hookCalls.find(([name]) => name === "acksExtras.influenceRollComplete")?.[1] };
}

// INVENTED edges and counts: a total of 7 is the third result.
const REACTION = {
  bands: [{ min: null, max: 5 }, { min: 6, max: 6 }, { min: 7, max: 8 }, { min: 9, max: 11 }, { min: 12, max: null }],
  shift1: 3, shift2: 2, shift3: 1, shift4: 2, shift5: 3,
};

await test("with no reaction table imported the roll names no result and moves no attitude", async () => {
  resetTables();
  const { card, payload } = await rollDiplomacy({ attempt: 0, currentAttitude: 3 });
  assert.equal(card.bandLabel, "");
  assert.equal("noResult" in card, false, "and the card carries no line about it");
  assert.equal(card.resultAttitude, INFLUENCE_ATTITUDE_LABELS.diplomacy[3], "the attitude stays where it was");
  assert.equal(payload.band, null);
  assert.equal(payload.newAttitude, 3);
  assert.equal(payload.attempt, 0);
});

await test("an initial roll sets the attitude by the page's edges, and the attempt advances", async () => {
  resetTables();
  registerTable({ id: "influence", tables: { diplomacyReaction: REACTION } }, { priority: PRIORITY.WORLD });
  const { card, payload } = await rollDiplomacy({ attempt: 0, currentAttitude: 0 });
  assert.equal(card.bandLabel, "ACKS-INFLUENCE.band.diplomacy.result3");
  assert.equal(card.resultAttitude, INFLUENCE_ATTITUDE_LABELS.diplomacy[2]);
  assert.deepEqual([payload.band, payload.newAttitude], ["result3", 2]);
});

await test("a continuing roll moves the ladder by the page's count, toward Neutral on the middle result", async () => {
  resetTables();
  registerTable({ id: "influence", tables: { diplomacyReaction: REACTION } }, { priority: PRIORITY.WORLD });
  const down = await rollDiplomacy({ attempt: 1, currentAttitude: 4 });
  assert.equal(down.payload.newAttitude, 3, "one step, the page's count, toward the middle");
  assert.equal(down.card.shiftDescription, "ACKS-INFLUENCE.shift.toward");
  cards.length = 0;
  hookCalls.length = 0;
  const settled = await rollDiplomacy({ attempt: 1, currentAttitude: 2 });
  assert.equal(settled.payload.newAttitude, 2, "Neutral stays");
  // A page whose count for this result is not imported leaves the roll with no result.
  resetTables();
  registerTable({ id: "influence", tables: { diplomacyReaction: { ...REACTION, shift3: undefined } } }, { priority: PRIORITY.WORLD });
  cards.length = 0;
  hookCalls.length = 0;
  const unread = await rollDiplomacy({ attempt: 1, currentAttitude: 4 });
  assert.deepEqual([unread.card.bandLabel, unread.payload.band, unread.payload.newAttitude], ["", null, 4]);
});

await test("the roll adds the modifier the page prints for the current attitude, and nothing for a rung it prints none for", async () => {
  resetTables();
  registerTable({ id: "influence", tables: { diplomacyReaction: REACTION, diplomacyAttitude: { attitude4: 6 } } }, { priority: PRIORITY.WORLD });
  const base = (await rollDiplomacy({ attempt: 0, currentAttitude: 2 })).card.modifier;
  cards.length = 0;
  hookCalls.length = 0;
  const top = (await rollDiplomacy({ attempt: 0, currentAttitude: 4 })).card;
  assert.equal(top.modifier, base + 6);
  assert.equal(top.activeModifiers.some((m) => m.value === 6), true, "named on the card");
  resetTables();
});

/* -------------------------------------------- */
/*  The opening target                          */
/* -------------------------------------------- */

console.log("influence: the target a roller opens with");

await test("the caller's target wins, else the targeted token's actor, never the influencer", async () => {
  const roller = makeActor({ id: "roller" });
  const named = makeActor({ id: "named" });
  const tokened = makeActor({ id: "tokened" });
  assert.equal(openingTarget(roller, named), named);
  assert.equal(openingTarget(roller, null), null, "no target named and no token targeted");
  targets = [{ actor: tokened }];
  assert.equal(openingTarget(roller, null), tokened, "a targeted token stands in");
  assert.equal(openingTarget(roller, named), named, "a named target is not overridden by a token");
  targets = [{ actor: roller }];
  assert.equal(openingTarget(roller, null), null, "a self-targeted token fills nothing");
  assert.equal(openingTarget(roller, roller), null, "nor does a named self");
});

/* -------------------------------------------- */
/*  A concealed membership, through the dialog  */
/* -------------------------------------------- */

console.log("influence: a concealed membership and the dialog's context");

await test("the dialog a player opens never carries a concealed organisation's name", async () => {
  const { pushFactionModifiers } = await import("../scripts/factions/influence-listener.mjs");
  const speaker = makeActor({ id: "speaker" });
  const target = makeActor({ id: "target" });
  const rosterOf = (hidden) => ({ members: [{ uuid: target.uuid, hidden }] });
  const openDoc = { uuid: "Actor.open", name: "Open Lodge", system: rosterOf(false) };
  const secretDoc = { uuid: "Actor.secret", name: "Secret Lodge", system: rosterOf(true) };
  const finders = (isGM) => ({
    subjectsOfActor: () => ({}),
    isFaction: () => false,
    factionsOfMember: (uuid) => (uuid === target.uuid ? [openDoc, secretDoc] : []),
    factionsControlling: () => [],
    authoritiesRostering: () => [],
    standingFor: () => 3,
    districtUnder: () => null,
    relationBetween: () => null,
    isGM: () => isGM,
  });
  const contextFor = async (isGM) => {
    game.i18n.format = (key, data = {}) => `${key} ${data.name ?? ""}`.trim();
    const modifiers = [];
    pushFactionModifiers({ actor: speaker, targetActor: target, mode: null, modifiers }, finders(isGM));
    const app = new InfluenceApp({ actor: speaker, targetActor: target, modifiers });
    return JSON.stringify(await app._prepareContext({}));
  };
  try {
    assert.match(await contextFor(true), /Secret Lodge/, "the Judge's dialog names it");
    const player = await contextFor(false);
    assert.doesNotMatch(player, /Secret Lodge/, "a player's dialog does not");
    assert.match(player, /Open Lodge/, "an open membership still speaks");
  } finally {
    game.i18n.format = (k) => k;
  }
});

console.log(`\n${passed} tests passed (influence bribe)`);
