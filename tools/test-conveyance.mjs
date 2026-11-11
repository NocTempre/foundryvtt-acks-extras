/**
 * What carries each member of a party (`scripts/formation/conveyance.mjs`): the
 * carriers a member counts, the fastest of them, the holds that keep a member
 * where they are, the group's presses and their Undo, a member's own pin, and
 * the dawn and the join that apply the arrangement. Also the derived mode and
 * the Judge's word on the travel record, and the dawn crossing the watcher
 * reads. Documents are stand-ins; names and figures are this file's inventions
 * (QQ names), so these tests prove the machinery and never the book.
 *
 * Run: node tools/test-conveyance.mjs
 */
import assert from "node:assert/strict";

/* -------------------------------------------- */
/*  Foundry stand-ins                           */
/* -------------------------------------------- */

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

class ForcedDeletion {}
class ForcedReplacement {
  constructor(value) {
    this.value = value;
  }
  static create(value) {
    return new ForcedReplacement(value);
  }
}
class FieldStub {}

const listeners = new Map();
const fired = [];
globalThis.Hooks = {
  callAll: (name, ...args) => {
    fired.push(name);
    for (const fn of listeners.get(name) ?? []) fn(...args);
  },
  on: (name, fn) => {
    listeners.set(name, [...(listeners.get(name) ?? []), fn]);
    return 0;
  },
  once() {},
  off() {},
};

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
    operators: { ForcedDeletion, ForcedReplacement },
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
globalThis.CONFIG = { Actor: { dataModels: {} }, Item: { dataModels: {} }, RegionBehavior: { dataModels: {}, typeIcons: {} } };
globalThis.CONST = {
  GRID_TYPES: { GRIDLESS: 0, SQUARE: 1, HEXODDR: 2, HEXEVENR: 3, HEXODDQ: 4, HEXEVENQ: 5 },
  DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OWNER: 3 },
};

const toasts = [];
globalThis.ChatMessage = { create: async (data) => data };
globalThis.ui = { notifications: { info: (m) => toasts.push(m), warn() {}, error() {} } };
globalThis.fromUuid = async () => null;
globalThis.fromUuidSync = () => null;
globalThis.canvas = { scene: null, tokens: { controlled: [] } };

const settings = {
  formations: {}, travelEncounters: true, advanceWorldTime: true, dawnHour: 6, duskHour: 18, travelLogCap: 120,
};
const actors = new Map();
globalThis.game = {
  settings: {
    get: (_module, key) => settings[key],
    set: (_module, key, value) => { settings[key] = value; return value; },
  },
  i18n: {
    localize: (key) => key,
    format: (key, data = {}) => `${key} ${JSON.stringify(data)}`,
    has: () => false,
  },
  user: { id: "gm1", isGM: true },
  users: [{ id: "gm1", isGM: true }, { id: "p1", isGM: false }, { id: "p2", isGM: false }],
  actors: { get: (id) => actors.get(id) ?? null, get contents() { return [...actors.values()]; }, [Symbol.iterator]: () => actors.values() },
  scenes: { get: () => null, [Symbol.iterator]: () => [][Symbol.iterator]() },
  tables: { get: () => null, contents: [] },
  time: { worldTime: 1000, advance: async () => {} },
};

/* -------------------------------------------- */
/*  The modules under test                      */
/* -------------------------------------------- */

const { VEHICLE_TYPE } = await import("../scripts/vehicles/constants.mjs");
const { attach, attachmentOf, registerAttachmentIndex } = await import("../scripts/lib/attachment.mjs");
const { calendarDay, dawnWithin, secondsToNextDawn } = await import("../scripts/lib/world-time.mjs");
const {
  addMember, carriedLoad, derivedMovementMode, explorationSpeedOf, getFormation, memberPace, paceSetter,
} = await import("../scripts/formation/formation-model.mjs");
const { storedTravelOf, travelOf } = await import("../scripts/formation/travel.mjs");
const conveyance = await import("../scripts/formation/conveyance.mjs");
const {
  AUTOMATIC, ON_FOOT, arrangeAllAtDawn, arrangeFastest, arrangeJoined, bestConveyance, carrierPool, chooseConveyance,
  heldReason, offersFor, pinOf, seatChanged, setGroupMovement, undoArrangement,
} = conveyance;
const { buildMemberConveyance, buildMovementView } = await import("../scripts/formation/movement-view.mjs");
const { closeDay } = await import("../scripts/formation/day-close.mjs");

registerAttachmentIndex();

/* -------------------------------------------- */
/*  Fixtures                                    */
/* -------------------------------------------- */

const SCOPE = "acks-extras";

function makeActor(id, type, system, { owners = [] } = {}) {
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
    testUserPermission: (user) => owners.includes(user.id),
    getFlag: (scope, key) => doc.flags[scope]?.[key],
    async setFlag(scope, key, value) {
      doc.flags[scope][key] = value;
      Hooks.callAll("updateActor", doc, { flags: { [scope]: { [key]: value } } });
      return doc;
    },
    async unsetFlag(scope, key) {
      delete doc.flags[scope][key];
      Hooks.callAll("updateActor", doc, { flags: { [scope]: { [`-=${key}`]: null } } });
      return doc;
    },
    async update() { return doc; },
  };
  actors.set(id, doc);
  Hooks.callAll("createActor", doc);
  return doc;
}

const person = (id, speed, owners = ["p1"]) =>
  makeActor(id, "character", { movementacks: { exploration: speed }, hp: { value: 5 }, encumbrance: { value: 1, max: 40 } }, { owners });
const horse = (id, speed, owners = ["p1"]) =>
  makeActor(id, `${SCOPE}.animal`, { animal: { mountable: true }, movementacks: { exploration: speed } }, { owners });
const wagon = (id, { owners = ["p1"], capacity = 600, speed = 150, kind = "land", extra = {} } = {}) =>
  makeActor(id, VEHICLE_TYPE, {
    kind,
    cargo: { capacityStone: capacity },
    speeds: { tiers: [{ team: 0, maxLoadStone: capacity, feetPerTurn: speed }] },
    team: { animals: [{ kind: "heavyHorse", count: 1 }] },
    ...extra,
  }, { owners });

let nextFormation = 0;
function party(members, travel = {}) {
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
      travel: { mode: "journey", ...travel },
    },
  };
  return id;
}

const on = (actor) => attachmentOf(actor)?.uuid ?? null;

const checks = [];
const t = async (name, fn) => {
  actors.clear();
  settings.formations = {};
  await fn();
  checks.push(name);
  console.log(`ok   ${name}`);
};

/* -------------------------------------------- */
/*  The dawn the watcher reads                  */
/* -------------------------------------------- */

const reading = (hour, minute = 0) => ({ hour, minute, second: 0, hoursPerDay: 24, secondsPerHour: 3600, dawn: 6 });

await t("a step that lands on the dawn crossed it, and a step that stops short did not", () => {
  assert.equal(secondsToNextDawn(reading(6)), 86400);
  assert.equal(dawnWithin(reading(6), 60), true);
  assert.equal(dawnWithin(reading(5, 59), 60), false);
});

await t("a small tick past the dawn crossed it, and the next one did not", () => {
  assert.equal(dawnWithin(reading(6, 1), 120), true);
  assert.equal(dawnWithin(reading(6, 3), 120), false);
  assert.equal(dawnWithin(reading(6, 2), 120), false, "a step that starts on the dawn does not cross it again");
});

await t("a step of a day or more always crossed one, and a clock with no calendar never does", () => {
  assert.equal(dawnWithin(reading(12), 86400), true);
  assert.equal(dawnWithin(null, 86400), false);
});

/* -------------------------------------------- */
/*  How the party moves, read off what carries it */
/* -------------------------------------------- */

await t("the mode reads off the attachments: foot, mounted, wagon, all afloat", async () => {
  const a = person("a", 90);
  const b = person("b", 120);
  const mount = horse("mount", 240);
  const cart = wagon("cart");
  const boat = wagon("boat", { kind: "water" });
  const id = party([a, b]);
  assert.equal(derivedMovementMode(getFormation(id)), "foot");
  await conveyance.chooseConveyance(id, "a", mount.uuid);
  assert.equal(derivedMovementMode(getFormation(id)), "mounted");
  await conveyance.chooseConveyance(id, "b", cart.uuid);
  assert.equal(derivedMovementMode(getFormation(id)), "vehicle", "a wagon's gates win over a rider");
  await conveyance.chooseConveyance(id, "a", boat.uuid);
  await conveyance.chooseConveyance(id, "b", boat.uuid);
  assert.equal(derivedMovementMode(getFormation(id)), "vessel");
});

await t("the mode is an answer: the record never stores one, and a legacy word reads", async () => {
  person("a", 90);
  const id = party([actors.get("a")], { movement: { mode: "vessel" } });
  const record = getFormation(id);
  assert.equal(travelOf(record).movement.set, "vessel", "a declared mode on an old record reads as the word");
  assert.equal(travelOf(record).movement.mode, "vessel");
  assert.equal(Object.hasOwn(storedTravelOf(record).movement, "mode"), false);
  const walked = party([actors.get("a")], { movement: { mode: "mounted" } });
  assert.equal(travelOf(getFormation(walked)).movement.set, null, "a derived word on an old record says nothing");
  assert.equal(travelOf(getFormation(walked)).movement.mode, "foot");
});

await t("the pace answers to the rider's carrier, and the setter is the slowest of them", async () => {
  const a = person("a", 90);
  const b = person("b", 120);
  const mount = horse("mount", 240);
  const id = party([a, b]);
  await chooseConveyance(id, "a", mount.uuid);
  const record = getFormation(id);
  assert.equal(memberPace(record, record.members[0]), 240);
  assert.equal(paceSetter(record).actor.id, "b");
  assert.equal(paceSetter(record).speed, 120);
});

/* -------------------------------------------- */
/*  Which carriers count, and the fastest        */
/* -------------------------------------------- */

await t("a member counts what their player owns, in the train or not", () => {
  const a = person("a", 90, ["p1"]);
  horse("hers", 240, ["p1"]);
  horse("others", 300, ["p2"]);
  const id = party([a]);
  const uuids = offersFor(a, getFormation(id)).map((o) => o.carrier.uuid);
  assert.deepEqual(uuids, ["Actor.hers"]);
});

await t("a member no player owns has only what is already in the train", async () => {
  const a = person("a", 90, ["p1"]);
  const npc = person("npc", 90, []);
  const cart = wagon("cart");
  horse("spare", 240, ["p1"]);
  const id = party([a, npc]);
  assert.equal(offersFor(npc, getFormation(id)).length, 0);
  await chooseConveyance(id, "a", cart.uuid);
  assert.deepEqual(offersFor(npc, getFormation(id)).map((o) => o.carrier.id), ["cart"]);
});

await t("a tie never moves anyone, and a faster ride strictly must be faster", async () => {
  const a = person("a", 150);
  horse("same", 150);
  const id = party([a]);
  assert.equal(bestConveyance(a, getFormation(id)).carrier, null);
  horse("faster", 151);
  assert.equal(bestConveyance(a, getFormation(id)).carrier.id, "faster");
});

await t("between a beast and a wagon at one pace, the beast", () => {
  const a = person("a", 90);
  wagon("cart", { speed: 180 });
  horse("mount", 180);
  const id = party([a]);
  assert.equal(bestConveyance(a, getFormation(id)).carrier.id, "mount");
});

await t("a wagon with no pace to give offers nothing to rank", () => {
  const a = person("a", 90);
  wagon("stuck", { extra: { team: { animals: [] } }, speed: 300 });
  const id = party([a]);
  assert.equal(bestConveyance(a, getFormation(id)).carrier, null);
});

await t("a vessel's passenger stays: leaving it is a word, not a ranking", async () => {
  const a = person("a", 90);
  const boat = wagon("boat", { kind: "water" });
  horse("mount", 240);
  const id = party([a]);
  await chooseConveyance(id, "a", boat.uuid);
  assert.equal(bestConveyance(a, getFormation(id)).carrier.id, "boat");
  await arrangeFastest(id);
  assert.equal(on(a), boat.uuid);
});

await t("a ride refused: itself, ridden, harnessed, past its capacity", async () => {
  const a = person("a", 90);
  const b = person("b", 90);
  const ridden = horse("ridden", 240);
  const harnessed = horse("harnessed", 240);
  horse("slight", 240);
  actors.get("slight").flags[SCOPE].extras = { load: { capacity: 1 } };
  const cart = wagon("cart");
  await harnessed.setFlag(SCOPE, "attachedTo", { uuid: cart.uuid, role: "draft" });
  await b.setFlag(SCOPE, "attachedTo", { uuid: ridden.uuid, role: "rider" });
  const id = party([a, b]);
  const offers = offersFor(a, getFormation(id)).map((o) => o.carrier.id);
  assert.deepEqual(offers, ["cart"]);
});

await t("a wagon refused: pitched, past its wheels, past its hold", async () => {
  const a = person("a", 90);
  wagon("full", { capacity: 1 });
  const pitched = wagon("pitched");
  pitched.flags[SCOPE].storage = { provider: true };
  pitched.flags[SCOPE].place = { deployed: { at: 1 } };
  wagon("free");
  const id = party([a]);
  assert.deepEqual(offersFor(a, getFormation(id)).map((o) => o.carrier.id), ["free"]);
  const snow = party([a], { weather: { footing: { mud: "none", snow: true } } });
  assert.deepEqual(offersFor(a, getFormation(snow)).map((o) => o.carrier.id), []);
});

await t("a wagon quotes its pace with this member aboard, so a full tier is priced in", () => {
  const a = person("a", 90);
  makeActor("cart", VEHICLE_TYPE, {
    kind: "land",
    cargo: { capacityStone: 600 },
    speeds: { tiers: [{ team: 0, maxLoadStone: 10, feetPerTurn: 180 }, { team: 0, maxLoadStone: 600, feetPerTurn: 60 }] },
    team: { animals: [{ kind: "heavyHorse", count: 1 }] },
  }, { owners: ["p1"] });
  const id = party([a]);
  assert.equal(offersFor(a, getFormation(id))[0].speed, 60, "a body over the top tier reads the lower one");
  assert.equal(bestConveyance(a, getFormation(id)).carrier, null, "and it loses to the member's own legs");
});

await t("the holds: left, deployed, casualty, hauling, a station, and a body that is no person", async () => {
  const load = { down: [], carriers: [], sharePerCarrier: 0 };
  const a = person("a", 90);
  assert.equal(heldReason({ actorId: "a", roles: [] }, a, load), null);
  assert.equal(heldReason({ actorId: "a", left: true }, a, load), "left");
  assert.equal(heldReason({ actorId: "a", deployedTokenId: "t" }, a, load), "deployed");
  const down = person("down", 90);
  down.system.hp.value = 0;
  assert.equal(heldReason({ actorId: "down" }, down, load), "casualty");
  assert.equal(heldReason({ actorId: "a", roles: ["carrier"] }, a, { ...load, down: [{}] }), "hauling");
  const cart = wagon("cart");
  await a.setFlag(SCOPE, "attachedTo", { uuid: cart.uuid, role: "crew", station: "driver" });
  assert.equal(heldReason({ actorId: "a" }, a, load), "station");
  assert.equal(heldReason({ actorId: "cart" }, cart, load), "notPerson");
});

/* -------------------------------------------- */
/*  The group's presses and their Undo           */
/* -------------------------------------------- */

await t("Fastest for all seats everyone, slowest first onto the last of the room", async () => {
  const slow = person("slow", 60);
  const fast = person("fast", 120);
  const cart = wagon("cart", { capacity: 20 });
  const id = party([fast, slow]);
  const moved = await arrangeFastest(id);
  assert.deepEqual(moved, ["slow"]);
  assert.equal(on(slow), cart.uuid);
  assert.equal(on(fast), null, "the hold is full, and the faster legs walk");
});

await t("Fastest for all honours a pin, and Undo puts back what moved", async () => {
  const a = person("a", 90);
  const b = person("b", 90);
  const mount = horse("mount", 240);
  const spare = horse("spare", 300);
  const id = party([a, b]);
  await chooseConveyance(id, "a", ON_FOOT);
  await chooseConveyance(id, "b", mount.uuid);
  await chooseConveyance(id, "b", AUTOMATIC);
  assert.equal(on(b), spare.uuid, "automatic takes the fastest");
  await setGroupMovement(id, "foot");
  assert.equal(on(b), null);
  await arrangeFastest(id);
  assert.equal(on(a), null, "the pin holds");
  assert.equal(on(b), spare.uuid);
  assert.equal(await undoArrangement(id), 1);
  assert.equal(on(b), null, "Undo takes off what a snapshot says was on foot");
  assert.equal(pinOf(a), ON_FOOT, "and leaves the pin");
  assert.equal(travelOf(getFormation(id)).lastArrangement, null, "and spends itself");
  assert.equal(travelOf(getFormation(id)).movement.set, "foot", "and restores the word it cleared");
  assert.equal(await undoArrangement(id), null, "a second press has nothing to undo");
});

await t("a pin on foot brings a rider down, Fastest for all clears the word, and a held member stays", async () => {
  const pinned = person("pinned", 90);
  const away = person("away", 90);
  const mount = horse("mount", 240);
  horse("spare", 240);
  await pinned.setFlag(SCOPE, "conveyance", { pinned: ON_FOOT });
  const id = party([pinned, { actorId: "away", roles: [], left: true }], { movement: { set: "flying" } });
  await attach(pinned, mount, "rider");
  await arrangeFastest(id);
  assert.equal(on(pinned), null);
  assert.equal(on(away), null);
  assert.equal(travelOf(getFormation(id)).movement.set, null);
});

await t("a press that moves nobody keeps the snapshot a Judge may still want", async () => {
  const a = person("a", 90);
  const mount = horse("mount", 240);
  const id = party([a]);
  await arrangeFastest(id);
  const kept = travelOf(getFormation(id)).lastArrangement;
  assert.deepEqual(kept.members, [a.uuid]);
  await arrangeFastest(id);
  assert.deepEqual(travelOf(getFormation(id)).lastArrangement, kept);
  assert.equal(on(a), mount.uuid);
});

await t("the On foot tile takes everyone off, over a pin that survives, and the word stands", async () => {
  const a = person("a", 90);
  const mount = horse("mount", 240);
  const id = party([a]);
  await chooseConveyance(id, "a", mount.uuid);
  await setGroupMovement(id, "foot");
  assert.equal(on(a), null);
  assert.equal(pinOf(a), mount.uuid);
  assert.equal(travelOf(getFormation(id)).movement.set, "foot");
  await undoArrangement(id);
  assert.equal(on(a), mount.uuid, "Undo mounts the rider back");
});

await t("the Mounted and Wagon tiles board that kind or leave a member as they are", async () => {
  const a = person("a", 90);
  const b = person("b", 90, ["p2"]);
  const mount = horse("mount", 240);
  const cart = wagon("cart");
  const id = party([a, b]);
  await setGroupMovement(id, "mounted");
  assert.equal(on(a), mount.uuid);
  assert.equal(on(b), null, "with no beast of theirs, as they are");
  await setGroupMovement(id, "vehicle");
  assert.equal(on(a), cart.uuid);
  assert.equal(travelOf(getFormation(id)).movement.mode, "vehicle");
});

await t("a tile with no carrier to board stands as the word alone, and it lights", async () => {
  const a = person("a", 90);
  const id = party([a]);
  await setGroupMovement(id, "vessel");
  const t1 = travelOf(getFormation(id));
  assert.equal(t1.movement.set, "vessel");
  assert.equal(on(a), null);
  const tiles = buildMovementView(getFormation(id), t1).tiles;
  assert.deepEqual(tiles.filter((tile) => tile.pressed).map((tile) => tile.key), ["vessel"]);
  await setGroupMovement(id, "mounted");
  assert.equal(travelOf(getFormation(id)).movement.mode, "foot", "the mode stays what the party reads");
  assert.deepEqual(buildMovementView(getFormation(id), travelOf(getFormation(id))).tiles
    .filter((tile) => tile.pressed).map((tile) => tile.key), ["mounted"], "and the tile says what was pressed");
});

await t("Flying moves nobody and declares", async () => {
  const a = person("a", 90);
  horse("mount", 240);
  const id = party([a]);
  await setGroupMovement(id, "flying");
  assert.equal(on(a), null);
  assert.equal(travelOf(getFormation(id)).movement.mode, "flying");
});

/* -------------------------------------------- */
/*  A member's own say                           */
/* -------------------------------------------- */

await t("a member's press moves them and pins it; a press off their offers changes nothing", async () => {
  const a = person("a", 90);
  const mount = horse("mount", 240);
  const theirs = horse("theirs", 240, ["p2"]);
  const id = party([a]);
  const landed = await chooseConveyance(id, "a", mount.uuid);
  assert.equal(landed.pinned, mount.uuid);
  assert.equal(on(a), mount.uuid);
  assert.equal(await chooseConveyance(id, "a", theirs.uuid), null);
  assert.equal(on(a), mount.uuid);
});

await t("a press in a fight, or for a held member, changes nothing", async () => {
  const a = person("a", 90);
  const mount = horse("mount", 240);
  const id = party([a]);
  settings.formations[id].combat = { active: true };
  assert.equal(await chooseConveyance(id, "a", mount.uuid), null);
  settings.formations[id].combat = { active: false };
  settings.formations[id].members[0].left = true;
  assert.equal(await chooseConveyance(id, "a", mount.uuid), null);
  assert.equal(on(a), null);
  assert.equal(pinOf(a), null);
});

await t("a pin on a carrier that cannot take them leaves them where they are", async () => {
  const a = person("a", 90);
  const mount = horse("mount", 240);
  horse("spare", 300);
  const rival = person("rival", 90);
  const id = party([a, rival]);
  await chooseConveyance(id, "a", mount.uuid);
  await setGroupMovement(id, "foot");
  await chooseConveyance(id, "rival", mount.uuid);
  await arrangeFastest(id);
  assert.equal(on(a), null, "not the fastest they turned down");
  const record = getFormation(id);
  const row = buildMemberConveyance(record, record.members[0], a, {
    canControl: true, load: { down: [], carriers: [], sharePerCarrier: 0 }, pool: conveyance.carrierPool(), t: travelOf(record),
  });
  assert.equal(row.pinOut, true, "and the row says so");
});

await t("a reader with no say sees how a member travels and no picks", () => {
  const a = person("a", 90);
  horse("mount", 240);
  const id = party([a]);
  const record = getFormation(id);
  const o = { load: { down: [], carriers: [], sharePerCarrier: 0 }, pool: conveyance.carrierPool(), t: travelOf(record) };
  assert.equal(buildMemberConveyance(record, record.members[0], a, { ...o, canControl: false }).options, null);
  const picks = buildMemberConveyance(record, record.members[0], a, { ...o, canControl: true }).options.map((p) => p.pick);
  assert.deepEqual(picks, [AUTOMATIC, ON_FOOT, "Actor.mount"]);
});

/* -------------------------------------------- */
/*  The arrangement applying itself              */
/* -------------------------------------------- */

await t("the dawn arranges a journey, and says who moved", async () => {
  const a = person("a", 90);
  const mount = horse("mount", 240);
  party([a]);
  toasts.length = 0;
  await arrangeAllAtDawn();
  assert.equal(on(a), mount.uuid);
  assert.equal(toasts.length, 1);
});

await t("the dawn leaves a Judge's word, a fight, a city and a pin alone", async () => {
  const a = person("a", 90);
  horse("mount", 240);
  const word = party([a], { movement: { set: "foot" } });
  await arrangeAllAtDawn();
  assert.equal(on(a), null);
  delete settings.formations[word];
  const fight = party([a]);
  settings.formations[fight].combat = { active: true };
  await arrangeAllAtDawn();
  assert.equal(on(a), null);
  delete settings.formations[fight];
  party([a], { mode: "settlement" });
  await arrangeAllAtDawn();
  assert.equal(on(a), null);
  settings.formations = {};
  await a.setFlag(SCOPE, "conveyance", { pinned: ON_FOOT });
  party([a]);
  await arrangeAllAtDawn();
  assert.equal(on(a), null);
});

await t("a dawn with nothing to change says nothing and takes no snapshot", async () => {
  const a = person("a", 90);
  const id = party([a]);
  toasts.length = 0;
  await arrangeAllAtDawn();
  assert.equal(toasts.length, 0);
  assert.equal(travelOf(getFormation(id)).lastArrangement, null);
});

await t("one who joins takes their ride, and only they move", async () => {
  const a = person("a", 90);
  const late = person("late", 90);
  horse("mount", 240);
  horse("spare", 240);
  const id = party([a]);
  const moved = await arrangeJoined(id, "a");
  assert.deepEqual(moved, ["a"]);
  settings.formations[id].members.push({ actorId: "late", roles: [] });
  assert.deepEqual(await arrangeJoined(id, "late"), ["late"]);
  assert.equal(on(late), "Actor.spare");
});

await t("addMember raises the join, once the member is on the record", async () => {
  const a = person("a", 90);
  const late = person("late", 90);
  const id = party([a]);
  let seen = null;
  Hooks.on("acksExtras.memberJoined", ({ formationId, actorId }) => {
    seen = { actorId, on: getFormation(formationId).members.some((m) => m.actorId === actorId) };
  });
  await addMember(getFormation(id), late);
  assert.deepEqual(seen, { actorId: "late", on: true });
});

await t("an update reads as a seat or pin moved, a deletion's key included", () => {
  assert.equal(seatChanged({ flags: { [SCOPE]: { attachedTo: {} } } }), true);
  assert.equal(seatChanged({ flags: { [SCOPE]: { "-=attachedTo": null } } }), true);
  assert.equal(seatChanged({ flags: { [SCOPE]: { conveyance: {} } } }), true);
  assert.equal(seatChanged({ flags: { [SCOPE]: { extras: {} } } }), false);
  assert.equal(seatChanged({ system: {} }), false);
});

await t("a seat core gave no figure reads a member off their weight, and the pace agrees", () => {
  const gmSeat = game.user;
  const mine = person("mine", 40);
  const theirs = person("theirs", 0, ["p2"]);
  Object.assign(theirs.system, { config: { movementAuto: true }, movement: { mod: 0 }, scores: { str: { mod: 0 } } });
  const id = party([mine, theirs]);
  theirs.isOwner = false;
  game.user = { id: "p1", isGM: false };
  // The system's own movement calculation, stood in for with bands of this
  // file's own invention: the module states none of them.
  const hadClass = CONFIG.Actor.documentClass;
  CONFIG.Actor.documentClass = class {
    _calculateMovement() {
      const { value, max } = this.system.encumbrance;
      const base = value > max ? 0 : value > 9 ? 25 : value > 4 ? 50 : 100;
      this.system.movementacks.exploration = Math.max(base + this.system.movement.mod, 0);
    }
  };
  try {
    const light = explorationSpeedOf(theirs);
    assert.ok(light > 40);
    assert.equal(paceSetter(getFormation(id)).actor, mine);
    theirs.system.movement.mod = -10;
    assert.equal(explorationSpeedOf(theirs), light - 10);
    theirs.items = [{ system: { weight6: 6000, cost: 0 } }];
    assert.equal(explorationSpeedOf(theirs), 0);
    theirs.system.config.movementAuto = false;
    assert.equal(explorationSpeedOf(theirs), 0);
    theirs.system.movementacks.exploration = 55;
    assert.equal(explorationSpeedOf(theirs), 55, "a hand-set speed is on the document for every seat");
    // A carrier under a casualty's share is paced by the same calculation.
    const hauling = { down: [{}], carriers: [], sharePerCarrier: 4 };
    assert.equal(memberPace(getFormation(id), { actorId: "mine", roles: ["carrier"] }, mine, hauling), 50, "the share lifts the bearing into a slower band");
    assert.equal(memberPace(getFormation(id), { actorId: "mine", roles: ["carrier"] }, mine, { ...hauling, sharePerCarrier: 0 }), 100, "and no share leaves it where it was");
  } finally {
    game.user = gmSeat;
    CONFIG.Actor.documentClass = hadClass;
  }
  theirs.system.config.movementAuto = true;
  assert.equal(explorationSpeedOf(theirs), 55, "a GM's seat reads core's own figure");
});

await t("a wagon that cannot roll is no pick, while a vessel on another clock stays one", () => {
  const a = person("a", 90);
  const stuck = wagon("stuck", { speed: 0 });
  const boat = wagon("boat", { kind: "water" });
  const id = party([a]);
  const f = getFormation(id);
  assert.ok(offersFor(a, f).some((pick) => pick.carrier === stuck));
  const o = { canControl: true, load: carriedLoad(f), pool: carrierPool(), t: travelOf(f) };
  const picks = buildMemberConveyance(f, f.members[0], a, o).options.map((row) => row.pick);
  assert.ok(!picks.includes(stuck.uuid));
  assert.ok(picks.includes(boat.uuid));
});

await t("closing the day is the dawn of a world with no calendar", async () => {
  const a = person("a", 90);
  const mount = horse("mount", 240);
  const id = party([a]);
  assert.equal(calendarDay(), null);
  await closeDay(getFormation(id));
  assert.equal(on(a), mount.uuid);
});

await t("a world with a calendar leaves closing the day alone: its dawn is the clock's", async () => {
  const a = person("a", 90);
  horse("mount", 240);
  const id = party([a]);
  const time = game.time;
  game.time = { ...time, components: { hour: 12 }, calendar: { days: { hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60 } } };
  try {
    assert.notEqual(calendarDay(), null);
    await closeDay(getFormation(id));
    assert.equal(on(a), null);
  } finally {
    game.time = time;
  }
});

console.log(`\ntest-conveyance: all ${checks.length} checks passed`);
