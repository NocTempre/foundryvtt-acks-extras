/**
 * `carriedLoad`'s carriers: a character carrier's base is core's own encumbrance
 * figure, and a monster carrier's is the load lib reads off it (its items and
 * coin), since core derives no encumbrance for a monster. Documents are
 * stand-ins; every figure here is this file's own invention, so the tests prove
 * the machinery and never the book.
 *
 * Run: node tools/test-carrier-load.mjs
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

/** Core's movement calculation as a stand-in: an invented step read off the stub the way core reads its actor. */
function calculateMovement() {
  const { value, max } = this.system.encumbrance;
  const base = value > max ? 0 : value > 6 ? 71 : 113;
  this.system.movementacks.exploration = base;
  this.system.movement.base = base;
}
globalThis.CONFIG = {
  Actor: { dataModels: {}, documentClass: { prototype: { _calculateMovement: calculateMovement } } },
  Item: { dataModels: {} },
  RegionBehavior: { dataModels: {}, typeIcons: {} },
};
globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0, SQUARE: 1 }, DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OWNER: 3 } };
globalThis.ChatMessage = { create: async (data) => data };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.fromUuid = async () => null;
globalThis.fromUuidSync = () => null;
globalThis.canvas = { scene: null, tokens: { controlled: [] } };

const settings = { formations: {} };
const actors = new Map();
globalThis.game = {
  settings: { get: (_module, key) => settings[key], set: (_module, key, value) => { settings[key] = value; return value; } },
  i18n: { localize: (key) => key, format: (key, data = {}) => `${key} ${JSON.stringify(data)}`, has: () => false },
  user: { id: "gm1", isGM: true },
  users: [{ id: "gm1", isGM: true }],
  actors: { get: (id) => actors.get(id) ?? null, get contents() { return [...actors.values()]; }, [Symbol.iterator]: () => actors.values() },
  scenes: { get: () => null, [Symbol.iterator]: () => [][Symbol.iterator]() },
  tables: { get: () => null, contents: [] },
  time: { worldTime: 1000, advance: async () => {} },
};

const T = await import("../scripts/lib/tables.mjs");
const { registerAttachmentIndex } = await import("../scripts/lib/attachment.mjs");
const { carriedLoad, encumbranceOf, getFormation } = await import("../scripts/formation/formation-model.mjs");
const { ROLES } = await import("../scripts/formation/constants.mjs");

registerAttachmentIndex();

const SCOPE = "acks-extras";
let serial = 0;
/** One physical item weighing `weight6` sixths of a stone. */
const pack = (weight6) => ({ id: `i${++serial}`, type: "item", name: "Pack", system: { cost: {}, weight6 }, getFlag: () => undefined });

function makeActor(id, type, system, { items = [], flags = {} } = {}) {
  const doc = {
    id, uuid: `Actor.${id}`, name: id, type, system, documentName: "Actor", isOwner: true, items,
    flags: { [SCOPE]: flags },
    testUserPermission: () => true,
    getFlag: (scope, key) => doc.flags[scope]?.[key],
  };
  actors.set(id, doc);
  return doc;
}

/** A character, `value` stone of encumbrance against a maximum of 20, standing or (hp 0) down. */
const person = (id, value, hp = 5) =>
  makeActor(id, "character", {
    config: { movementAuto: true }, encumbrance: { value, value6: value * 6, max: 20 },
    movement: { mod: 0, base: 113 }, movementacks: { exploration: 113 }, hp: { value: hp, max: 5 },
  });
/** A monster holding `weight6` sixths in a pack, its stated capacity `capacity` stone. */
const beast = (id, weight6, capacity = 12) =>
  makeActor(id, "monster", { movement: { base: 90, encounter: 30 }, hp: { value: 5, max: 5 } }, { items: weight6 ? [pack(weight6)] : [], flags: { extras: { load: { capacity } } } });

function party(members) {
  const id = `f${++serial}`;
  settings.formations = { [id]: { id, name: id, members: members.map(([actor, roles]) => ({ actorId: actor.id, roles })), lights: [], spells: [], clock: {}, travel: { mode: "journey" } } };
  return getFormation(id);
}

const checks = [];
const t = async (name, fn) => {
  actors.clear();
  settings.formations = {};
  T.registerTable({ id: "formation", tables: { carriedBodyStone: 9, carriedGearShare: 0.5 } });
  await fn();
  checks.push(name);
  console.log(`ok   ${name}`);
};

await t("a monster carrier's base is the load it carries, and its share rides on top", async () => {
  const ox = beast("ox", 18);
  const record = party([[ox, [ROLES.CARRIER]], [person("fallen", 4, 0), []]]);
  const load = carriedLoad(record);
  assert.ok(load.sharePerCarrier > 0, "a casualty is carried, so the share is a figure");
  const [carrier] = load.carriers;
  assert.equal(carrier.baseEnc, 3, "its three stone of pack");
  assert.equal(carrier.effEnc, Math.round((3 + load.sharePerCarrier) * 10) / 10, "the pack plus the share");
  assert.equal(carrier.capacity, 12, "its stated capacity");
  assert.equal(carrier.over, false);
});

await t("a monster carrier with nothing on it is exactly its share", async () => {
  const record = party([[beast("ox", 0), [ROLES.CARRIER]], [person("fallen", 4, 0), []]]);
  const load = carriedLoad(record);
  assert.equal(load.carriers[0].baseEnc, 0);
  assert.equal(load.carriers[0].effEnc, load.sharePerCarrier);
});

await t("a monster carrier past its maximum with pack and share is over", async () => {
  const record = party([[beast("ox", 6 * 12), [ROLES.CARRIER]], [person("fallen", 4, 0), []]]);
  const [carrier] = carriedLoad(record).carriers;
  assert.equal(carrier.baseEnc, 12);
  assert.equal(carrier.over, true, "twelve stone alone fills it, and the share is more");
});

await t("a pack of one sixth stays a sixth, shown at one decimal", async () => {
  const record = party([[beast("ox", 1), [ROLES.CARRIER]], [person("fallen", 4, 0), []]]);
  const load = carriedLoad(record);
  assert.equal(load.carriers[0].baseEnc, 0.2);
  assert.equal(load.carriers[0].effEnc, Math.round((1 / 6 + load.sharePerCarrier) * 10) / 10, "the sum is of the exact weight, rounded once");
});

await t("a character carrier's base is core's encumbrance figure, as before", async () => {
  const porter = person("porter", 5);
  const record = party([[porter, [ROLES.CARRIER]], [person("fallen", 4, 0), []]]);
  const load = carriedLoad(record);
  assert.equal(load.carriers[0].baseEnc, 5);
  assert.equal(load.carriers[0].baseEnc, encumbranceOf(porter));
  assert.equal(load.carriers[0].effEnc, Math.round((5 + load.sharePerCarrier) * 10) / 10);
});

console.log(`\n${checks.length} checks passed`);
