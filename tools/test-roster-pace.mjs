/**
 * The `party-roster` contract's `pace` member (`scripts/formation/party-roster.mjs`):
 * a member's pace if it bore more weight, answered by formation's own pace code
 * and core's movement calculation, so no encumbrance step is stated in treasure.
 * Documents are stand-ins; every step, tier and weight here is this file's own
 * invention (QQ names), so the tests prove the machinery and never the book.
 *
 * Run: node tools/test-roster-pace.mjs
 */
import assert from "node:assert/strict";

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
class FieldStub {}

globalThis.Hooks = { callAll() {}, on: () => 0, once() {}, off() {} };
globalThis.foundry = {
  utils: {
    randomID: () => "rnd",
    deepClone: clone,
    escapeHTML: (s) => String(s),
    hasProperty: () => false,
    getProperty: (o, p) => p.split(".").reduce((a, k) => a?.[k], o),
    isEmpty: (v) => v == null || (typeof v === "object" && !Object.keys(v).length),
    mergeObject: (a, b) => Object.assign(a, b),
  },
  abstract: { TypeDataModel: class {}, DataModel: class {} },
  data: {
    operators: { ForcedDeletion: class {}, ForcedReplacement: class {} },
    fields: new Proxy({}, { get: () => FieldStub }),
    regionBehaviors: { RegionBehaviorType: class {} },
  },
  applications: {
    api: {
      ApplicationV2: class {},
      HandlebarsApplicationMixin: (Base) => class extends Base {},
      DialogV2: { wait: async () => null, confirm: async () => false, prompt: async () => null },
    },
    sheets: { ActorSheetV2: class {}, ItemSheetV2: class {} },
    apps: { DocumentSheetConfig: { registerSheet() {} }, FilePicker: { implementation: class {} } },
    handlebars: { loadTemplates: () => [], renderTemplate: async () => "" },
    ux: { DragDrop: { implementation: class {} }, TextEditor: { implementation: {} } },
    instances: new Map(),
  },
  documents: { collections: { Items: { registerSheet() {} } } },
};

/** Core's movement calculation as a stand-in: invented steps, read off the stub the way core reads its actor. */
const stoneSeen = [];
function calculateMovement() {
  const { value, max } = this.system.encumbrance;
  stoneSeen.push(value);
  let base = value > max ? 0 : value > 12 ? 29 : value > 6 ? 71 : 113;
  base = Math.max(base + this.system.movement.mod, 0);
  this.system.movementacks.exploration = base;
  this.system.movement.base = base;
}
globalThis.CONFIG = {
  Actor: { dataModels: {}, documentClass: { prototype: { _calculateMovement: calculateMovement } } },
  Item: { dataModels: {} },
  RegionBehavior: { dataModels: {}, typeIcons: {} },
};
globalThis.CONST = {
  GRID_TYPES: { GRIDLESS: 0, SQUARE: 1, HEXODDR: 2, HEXEVENR: 3, HEXODDQ: 4, HEXEVENQ: 5 },
  DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OWNER: 3 },
};
globalThis.ChatMessage = { create: async (data) => data };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.fromUuid = async () => null;
globalThis.fromUuidSync = () => null;
globalThis.canvas = { scene: null, tokens: { controlled: [] } };

const settings = { formations: {}, travelEncounters: true, advanceWorldTime: true, dawnHour: 6, duskHour: 18, travelLogCap: 120 };
const actors = new Map();
globalThis.game = {
  settings: {
    get: (_module, key) => settings[key],
    set: (_module, key, value) => { settings[key] = value; return value; },
  },
  i18n: { localize: (key) => key, format: (key, data = {}) => `${key} ${JSON.stringify(data)}`, has: () => false },
  user: { id: "gm1", isGM: true },
  users: [{ id: "gm1", isGM: true }, { id: "p1", isGM: false }],
  actors: { get: (id) => actors.get(id) ?? null, get contents() { return [...actors.values()]; }, [Symbol.iterator]: () => actors.values() },
  scenes: { get: () => null, [Symbol.iterator]: () => [][Symbol.iterator]() },
  tables: { get: () => null, contents: [] },
  time: { worldTime: 1000, advance: async () => {} },
};

const T = await import("../scripts/lib/tables.mjs");
T.registerTable({ id: "capacity", tables: { riderBody: { stone: 11 } } });
const services = await import("../scripts/lib/services.mjs");
const { registerAttachmentIndex } = await import("../scripts/lib/attachment.mjs");
const { VEHICLE_TYPE } = await import("../scripts/vehicles/constants.mjs");
const { carriedLoad, getFormation, memberPace } =await import("../scripts/formation/formation-model.mjs");
const { chooseConveyance } = await import("../scripts/formation/conveyance.mjs");
const { ROLES } = await import("../scripts/formation/constants.mjs");
const { registerPartyRoster } = await import("../scripts/formation/party-roster.mjs");
const { STONE } = await import("../scripts/lib/item-model.mjs");
const { holdOf } = await import("../scripts/vehicles/hold.mjs");

registerAttachmentIndex();
registerPartyRoster();
const roster = services.get("party-roster");

const SCOPE = "acks-extras";
function makeActor(id, type, system) {
  const doc = {
    id,
    uuid: `Actor.${id}`,
    name: id,
    type,
    system,
    documentName: "Actor",
    isOwner: true,
    items: [],
    flags: { [SCOPE]: {} },
    testUserPermission: () => true,
    getFlag: (scope, key) => doc.flags[scope]?.[key],
    async setFlag(scope, key, value) { doc.flags[scope][key] = value; return doc; },
    async unsetFlag(scope, key) { delete doc.flags[scope][key]; return doc; },
    async update() { return doc; },
  };
  actors.set(id, doc);
  return doc;
}

/** A character on automatic movement, bearing `value6` sixths with a maximum of 20 stone. */
const walker = (id, value6, { auto = true, mod = 0, exploration = 113, hp = 5 } = {}) =>
  makeActor(id, "character", {
    config: { movementAuto: auto },
    encumbrance: { value: Math.round(value6 / STONE), value6, max: 20 },
    movement: { mod, base: exploration },
    movementacks: { exploration },
    hp: { value: hp, max: 5 },
  });
const horse = (id, speed) => makeActor(id, `${SCOPE}.animal`, { animal: { mountable: true }, movementacks: { exploration: speed } });
const wagon = (id) =>
  makeActor(id, VEHICLE_TYPE, {
    kind: "land",
    cargo: { capacityStone: 600 },
    speeds: { tiers: [{ team: 0, maxLoadStone: 100, feetPerTurn: 150 }, { team: 0, maxLoadStone: 200, feetPerTurn: 90 }] },
    team: { animals: [{ kind: "heavyHorse", count: 1 }] },
  });

let nextFormation = 0;
function party(members) {
  const id = `f${++nextFormation}`;
  settings.formations = {
    ...settings.formations,
    [id]: {
      id,
      name: id,
      members: members.map((a) => (a.actorId ? a : { actorId: a.id, roles: [] })),
      lights: [],
      spells: [],
      clock: {},
      travel: { mode: "journey" },
    },
  };
  return id;
}

const checks = [];
const t = async (name, fn) => {
  actors.clear();
  settings.formations = {};
  stoneSeen.length = 0;
  await fn();
  checks.push(name);
  console.log(`ok   ${name}`);
};

await t("pace is an optional member the roster provides", () => {
  assert.equal(typeof roster.pace, "function");
});

await t("the v4 members, summonerParty and admitSummons, are registered", () => {
  assert.equal(typeof roster.summonerParty, "function");
  assert.equal(typeof roster.admitSummons, "function");
});

await t("a character on automatic movement is priced by core's calculation at the stone it will hold", () => {
  const a = walker("a", 36);
  const id = party([a]);
  assert.deepEqual(roster.pace(id, "a", { adding6: 0 }), { rank: -113, speed: 113 });
  stoneSeen.length = 0;
  assert.deepEqual(roster.pace(id, "a", { adding6: 6 }), { rank: -71, speed: 71 });
  assert.deepEqual(stoneSeen, [7], "36 sixths and 6 more is seven stone, handed to core's own function");
  assert.equal(roster.pace(id, "a", { adding6: 6 * 7 }).speed, 29);
  assert.equal(roster.pace(id, "a", { adding6: 6 * 20 }).speed, 0, "past the maximum nothing moves");
});

await t("the stone is rounded the way core rounds what the sheet will show", () => {
  const a = walker("a", 38);
  const id = party([a]);
  assert.equal(a.system.encumbrance.value, 6, "the sheet's stone is the rounded figure");
  assert.equal(roster.pace(id, "a", { adding6: 2 }).speed, 71, "38 and 2 sixths is 40, which rounds to 7 stone, and a bare 6 plus 2 sixths would not");
});

await t("a missing adding6 is zero, and a negative or odd one is never less than zero", () => {
  const id = party([walker("a", 36)]);
  assert.equal(roster.pace(id, "a").speed, 113);
  assert.equal(roster.pace(id, "a", { adding6: -50 }).speed, 113);
  assert.equal(roster.pace(id, "a", { adding6: "x" }).speed, 113);
});

await t("a larger rank is slower", () => {
  const id = party([walker("a", 36)]);
  assert.ok(roster.pace(id, "a", { adding6: 6 }).rank > roster.pace(id, "a").rank);
});

await t("a member with no movement to price answers as they stand", () => {
  const fixed = walker("fixed", 36, { auto: false, exploration: 90 });
  const beast = makeActor("beast", "monster", { movementacks: { exploration: 70 }, encumbrance: { value: 0, max: 5 } });
  const id = party([fixed, beast]);
  assert.equal(roster.pace(id, "fixed", { adding6: 600 }).speed, 90);
  assert.equal(roster.pace(id, "beast", { adding6: 600 }).speed, 70);
});

await t("a rider's added weight loads the wagon that sets the pace, the stone converted from sixths", async () => {
  const a = walker("a", 36);
  const cart = wagon("cart");
  const id = party([a]);
  await chooseConveyance(id, "a", cart.uuid);
  const record = getFormation(id);
  assert.equal(memberPace(record, record.members[0]), 150);
  assert.equal(roster.pace(id, "a", { adding6: 0 }).speed, 150);
  // The first tier ends at 100 stone: what is aboard now, plus what is added, in stone.
  const room = 100 - holdOf(cart).used;
  assert.ok(room > 0, "the first tier has room");
  assert.equal(roster.pace(id, "a", { adding6: room * STONE }).speed, 150, "up to the tier's limit it holds");
  assert.equal(roster.pace(id, "a", { adding6: room * STONE + 1 }).speed, 90, "a sixth past it drops a tier, which six times the stone in sixths would not show");
  assert.equal(roster.pace(id, "a", { adding6: 6 * 400 }).speed, 0);
});

await t("a rider on a beast moves at the beast's pace, whatever they take on", async () => {
  const a = walker("a", 36);
  const mount = horse("mount", 240);
  const id = party([a]);
  await chooseConveyance(id, "a", mount.uuid);
  assert.equal(roster.pace(id, "a", { adding6: 6 * 15 }).speed, 240);
});

await t("with nothing added, pace is exactly what memberPace says, branch by branch", async () => {
  const foot = walker("foot", 40, { exploration: 71 });
  const fixed = walker("fixed", 36, { auto: false, exploration: 90 });
  const beast = makeActor("beast", "monster", { movementacks: { exploration: 70 }, encumbrance: { value: 0, max: 5 } });
  const rider = walker("rider", 36);
  const cart = wagon("cart");
  // Invented body figures, so a casualty's share is a number and the Carrier's own steps cross.
  T.registerTable({ id: "formation", tables: { carriedBodyStone: 9, carriedGearShare: 0.5 } });
  walker("porter", 12, { exploration: 113 });
  const fallen = walker("fallen", 30, { hp: 0 });
  const id = party([foot, fixed, beast, rider, { actorId: "porter", roles: [ROLES.CARRIER] }, fallen]);
  await chooseConveyance(id, "rider", cart.uuid);
  const record = getFormation(id);
  const load = carriedLoad(record);
  assert.equal(load.down.length, 1, "the Carrier branch is live: a casualty is being carried");
  assert.ok(load.sharePerCarrier > 0, "and the share is a figure, which is what the pin below is about");
  for (const member of record.members) {
    assert.equal(roster.pace(id, member.actorId, { adding6: 0 })?.speed, memberPace(record, member), member.actorId);
  }
  const porter = record.members.find((m) => m.actorId === "porter");
  assert.equal(memberPace(record, porter), 71, "two stone and the share is past the first step; two stone alone would not be");
  assert.equal(roster.pace(id, "porter", { adding6: 6 * 10 }).speed, 0, "added weight prices on top of the share, to the maximum");
});

await t("a member the party does not hold has no pace", () => {
  const id = party([walker("a", 36)]);
  assert.equal(roster.pace(id, "nobody"), null);
  assert.equal(roster.pace("no-such-party", "a"), null);
});

console.log(`\n${checks.length} checks passed`);
