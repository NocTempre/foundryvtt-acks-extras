/**
 * Set down a pack: the planners, the Judge's handler, the hooks.
 *
 * The planners are pure and are driven with plain facts. The handler and the
 * hooks run against mocked documents, with the REAL lib storage transfer
 * underneath, so what a container looks like on the pile and after it comes
 * back is what `buildTransferPayload` delivers, not what a fixture assumes
 * (new ids on both legs, `equipped` reset, flags carried through).
 *
 * The seat the handler runs on is always a Judge's. Who ASKED is the
 * `requestUserId` the transport stamps, so a Player's request is a call with
 * that id on a Judge's seat, exactly as `lib/sockets.mjs` runs it.
 *
 * Every name, id and figure is invented; what is proved is the SHAPE: who may
 * set down, what is left behind when a half of the transfer fails, and what
 * arrival restores.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.acksExtras ??= {};

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

class Coll extends Map {
  get contents() { return [...this.values()]; }
  find(fn) { return this.contents.find(fn); }
  filter(fn) { return this.contents.filter(fn); }
  map(fn) { return this.contents.map(fn); }
  some(fn) { return this.contents.some(fn); }
  every(fn) { return this.contents.every(fn); }
  [Symbol.iterator]() { return this.values(); }
}

const PLAYER = "u1";
const STRANGER = "u2";
const JUDGE = "gm1";
const USERS = {
  [PLAYER]: { id: PLAYER, isGM: false },
  [STRANGER]: { id: STRANGER, isGM: false },
  [JUDGE]: { id: JUDGE, isGM: true },
};
const MOD = "acks-extras";

const scenes = new Coll();
const actors = new Coll();
const byUuid = new Map();
const users = new Coll(Object.entries(USERS));
const listeners = {};
const onceHooks = {};
const pendingHooks = [];
let notes = [];
let calls = {};
let failures = {};
let seq = 0;
const rid = (p) => `${p}${++seq}`;
/** What the code under test logged to the console: failures the cases below cause on purpose. */
let logged = [];
console.error = (...args) => logged.push(args.map(String).join(" "));

globalThis.Hooks = {
  on(name, fn) { (listeners[name] ??= []).push(fn); },
  once(name, fn) { (onceHooks[name] ??= []).push(fn); },
  call() {},
  callAll(name, ...args) {
    for (const fn of listeners[name] ?? []) {
      const out = fn(...args);
      if (out?.then) pendingHooks.push(out);
    }
  },
};
/** Let every async hook a write started finish, the way a real client would between frames. */
const settle = async () => {
  while (pendingHooks.length) await pendingHooks.shift();
};

globalThis.foundry = {
  utils: {
    deepClone: (v) => (v == null || typeof v !== "object" ? v : structuredClone(v)),
    randomID: () => rid("n"),
  },
};
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
globalThis.CONFIG = {};
globalThis.canvas = { scene: null };
globalThis.ui = {
  notifications: {
    info: (m) => notes.push(["info", m]),
    warn: (m) => notes.push(["warn", m]),
    error: (m) => notes.push(["error", m]),
  },
};
globalThis.fromUuidSync = (uuid) => byUuid.get(uuid) ?? null;
users.activeGM = { isSelf: true };
globalThis.game = {
  scenes,
  actors,
  users,
  user: USERS[JUDGE],
  system: { id: "acks" },
  settings: { get: (_m, key) => (key === "formations" ? {} : undefined) },
  i18n: { localize: (k) => k, format: (k) => k, has: () => false },
};

const setDotted = (obj, path, value) => {
  const keys = path.split(".");
  const last = keys.pop();
  let at = obj;
  for (const k of keys) at = at[k] ??= {};
  at[last] = value;
};

class MockItem {
  constructor(data, parent) {
    const d = structuredClone(data);
    this.id = d._id ?? rid("i");
    this.name = d.name;
    this.type = d.type;
    this.img = d.img;
    this.system = d.system ?? {};
    this.flags = d.flags ?? {};
    this.parent = parent;
    this.documentName = "Item";
  }
  get uuid() { return `${this.parent.uuid}.Item.${this.id}`; }
  toObject() {
    return structuredClone({ _id: this.id, name: this.name, type: this.type, img: this.img, system: this.system, flags: this.flags });
  }
  getFlag(ns, key) { return this.flags?.[ns]?.[key] ?? null; }
  async setFlag(ns, key, value) { (this.flags[ns] ??= {})[key] = structuredClone(value); }
  async unsetFlag(ns, key) { delete this.flags?.[ns]?.[key]; }
  async update(patch) { for (const [path, value] of Object.entries(patch)) setDotted(this, path, value); }
}

class MockActor {
  constructor(data) {
    const d = structuredClone(data);
    this.id = rid("a");
    this.name = d.name;
    this.type = d.type;
    this.img = d.img;
    this.system = d.system ?? {};
    this.flags = d.flags ?? {};
    this.ownership = d.ownership ?? {};
    this.items = new Coll();
    this.documentName = "Actor";
    this.isToken = false;
  }
  get uuid() { return `Actor.${this.id}`; }
  get isOwner() { return this.testUserPermission(game.user, "OWNER"); }
  testUserPermission(user, level) {
    const need = { OWNER: 3 }[level];
    return !!user?.isGM || (this.ownership?.[user?.id] ?? this.ownership?.default ?? 0) >= need;
  }
  getFlag(ns, key) { return this.flags?.[ns]?.[key] ?? null; }
  async setFlag(ns, key, value) { (this.flags[ns] ??= {})[key] = structuredClone(value); }
  async unsetFlag(ns, key) { delete this.flags?.[ns]?.[key]; }
  async update(patch) { for (const [path, value] of Object.entries(patch)) setDotted(this, path, value); }
  async createEmbeddedDocuments(_kind, datas, opts = {}) {
    if (failures.create?.(this)) throw new Error("create refused");
    const made = datas.map((d) => new MockItem(opts.keepId ? d : { ...d, _id: undefined }, this));
    for (const item of made) this.items.set(item.id, item);
    for (const item of made) Hooks.callAll("createItem", item, {}, game.user.id);
    return made;
  }
  async updateEmbeddedDocuments(_kind, updates) {
    for (const { _id, ...patch } of updates) await this.items.get(_id)?.update(patch);
    return [];
  }
  async deleteEmbeddedDocuments(_kind, ids) {
    if (failures.delete?.(this)) throw new Error("delete refused");
    const gone = ids.map((i) => this.items.get(i)).filter(Boolean);
    for (const item of gone) this.items.delete(item.id);
    for (const item of gone) Hooks.callAll("deleteItem", item, {}, game.user.id);
    return gone;
  }
  async delete() {
    calls.actorDelete.push(this.id);
    actors.delete(this.id);
    byUuid.delete(this.uuid);
    Hooks.callAll("deleteActor", this, {}, game.user.id);
  }
  async getTokenDocument(data) {
    const pile = this;
    return {
      x: 0, y: 0, width: 1, height: 1,
      toObject: () => ({ _id: "template", actorId: pile.id, name: pile.name, width: 1, height: 1, x: 0, y: 0, ...data }),
    };
  }
}

globalThis.Actor = {
  create: async (data) => {
    calls.actorCreate.push(data);
    if (failures.actorCreate) return null;
    const actor = new MockActor(data);
    actors.set(actor.id, actor);
    byUuid.set(actor.uuid, actor);
    return actor;
  },
};

const { registerGround, setDown, setDownRelay, sweepPile, flushSweeps, onDeleteItem, onCreateItem, pileData, groundOwnership, SET_DOWN_FLAG } =
  await import("../scripts/location/ground.mjs");
const logic = await import("../scripts/location/ground-logic.mjs");
const { isGroundPile } = await import("../scripts/lib/place.mjs");
const { isProvider, retrieve, stash, registerStorageRelay } = await import("../scripts/lib/storage.mjs");
const { standsAsPlace } = await import("../scripts/location/here.mjs");
const { LOCATION_TYPE } = await import("../scripts/location/constants.mjs");

registerGround();
await registerStorageRelay();
/** The module's socket: a Player's call reaches the Judge's seat with the sender attested, as socketlib does. */
const handlers = new Map();
globalThis.socketlib = {
  registerModule: () => ({
    register: (name, fn) => handlers.set(name, fn),
    executeAsGM: async (name, payload) => {
      const seat = game.user;
      game.user = USERS[JUDGE];
      try {
        return await handlers.get(name).call({ socketdata: { userId: seat.id } }, structuredClone(payload));
      } finally {
        game.user = seat;
      }
    },
  }),
};
for (const fn of onceHooks["socketlib.ready"] ?? []) fn();

/* -------------------------------------------- */
/*  Fixtures                                    */
/* -------------------------------------------- */

const GRID = 100;

function reset() {
  scenes.clear();
  actors.clear();
  byUuid.clear();
  notes = [];
  logged = [];
  failures = {};
  calls = { actorDelete: [], tokenDelete: [], actorCreate: [] };
  pendingHooks.length = 0;
  users.activeGM = { isSelf: true };
  game.user = USERS[JUDGE];
  canvas.scene = null;
}

function makeScene(name = "Square") {
  const id = rid("scene");
  const scene = {
    id, name, documentName: "Scene", uuid: `Scene.${id}`,
    grid: { size: GRID, distance: 5 },
    tokens: new Coll(),
    flags: {},
    getFlag(ns, key) { return this.flags?.[ns]?.[key] ?? null; },
    async createEmbeddedDocuments(_kind, datas) {
      return datas.map((d) => {
        const tid = rid("token");
        const token = { ...d, id: tid, uuid: `${this.uuid}.Token.${tid}`, parent: this, hidden: !!d.hidden };
        this.tokens.set(tid, token);
        return token;
      });
    },
    async deleteEmbeddedDocuments(_kind, ids) {
      calls.tokenDelete.push(...ids);
      for (const i of ids) this.tokens.delete(i);
    },
  };
  scenes.set(id, scene);
  byUuid.set(scene.uuid, scene);
  return scene;
}

/** A character the Player owns, with a token on `scene` at (500, 500) unless `scene` is null. */
async function makeHero({ scene = null } = {}) {
  const hero = await Actor.create({ name: "Hero", type: "character", ownership: { [PLAYER]: 3 } });
  if (scene) {
    const tid = rid("token");
    scene.tokens.set(tid, { id: tid, uuid: `${scene.uuid}.Token.${tid}`, actorId: hero.id, x: 500, y: 500, width: 1, height: 1, elevation: 0, hidden: false, parent: scene });
  }
  return hero;
}

const gear = (extra = {}) => ({ container: { capacity: 0 }, gear: { slots: ["back"], wornAt: "back" }, ...extra });

/**
 * A pack carrying torches, coin and a dagger, plus one loose item. `equippable`
 * gives the pack core's `equipped` field, which a transfer resets.
 */
async function kit(hero, { worn = true, equippable = false, slot = true } = {}) {
  const system = { subtype: "item", cost: 0, weight6: 0, quantity: 1, ...(equippable ? { equipped: worn } : {}) };
  const flags = gear();
  if (!slot) delete flags.gear;
  else flags.gear.wornAt = worn ? "back" : "";
  const inside = { [MOD]: { containedIn: "pack1" } };
  await hero.createEmbeddedDocuments("Item", [
    { _id: "pack1", name: "Backpack", type: "item", img: "icons/pack.svg", system, flags: { [MOD]: flags } },
    { _id: "torch1", name: "Torch", type: "item", system: { subtype: "item", cost: 0, weight6: 0, quantity: 3 }, flags: inside },
    { _id: "gold1", name: "Gold", type: "money", system: { coppervalue: 100, quantity: 40, quantitybank: 0 }, flags: inside },
    { _id: "dagger1", name: "Dagger", type: "item", system: { subtype: "item", cost: 0, weight6: 0, equipped: false }, flags: inside },
    { _id: "rope1", name: "Rope", type: "item", system: { subtype: "item", cost: 0, weight6: 0, quantity: 1 }, flags: {} },
  ], { keepId: true });
  return hero.items.get("pack1");
}

const pileOf = () => actors.find((a) => isGroundPile(a));
const asPlayer = (actor, item, userId = PLAYER, sceneId = null) => ({ actorUuid: actor.uuid, itemId: item.id, sceneId, requestUserId: userId });

let passed = 0;
const ok = async (name, fn) => {
  reset();
  await fn();
  await settle();
  passed++;
  console.log("ok   " + name);
};

/* -------------------------------------------- */
/*  The planners                                */
/* -------------------------------------------- */

await ok("pickSpot: the asked scene, else the only spot, else none", () => {
  const a = { scene: { id: "s1" } };
  const b = { scene: { id: "s2" } };
  assert.equal(logic.pickSpot([a, b], "s2"), b);
  assert.equal(logic.pickSpot([a], "s2"), a, "one spot answers whatever scene is asked");
  assert.equal(logic.pickSpot([a], null), a);
  assert.equal(logic.pickSpot([a, b], "s9"), null, "two spots and no match: no guess");
  assert.equal(logic.pickSpot([a, b], null), null);
  assert.equal(logic.pickSpot([], "s1"), null);
});

const FACTS = () => ({
  seat: { judge: false, ownsCharacter: true },
  actor: { uuid: "Actor.h1", name: "Hero", isToken: false },
  item: { id: "pack1", name: "Backpack", isContainer: true, nested: false, worn: true, slot: "back" },
  hasSpot: true,
});

await ok("planSetDown: refusals in order, then the record and the flag", () => {
  const plan = (patch) => logic.planSetDown({ ...FACTS(), ...patch });
  assert.equal(plan({ seat: { judge: false, ownsCharacter: false } }).reason, "permission");
  assert.equal(plan({ seat: { judge: true, ownsCharacter: false } }).ok, true, "a Judge needs no ownership");
  assert.equal(plan({ actor: { uuid: "x", name: "", isToken: true } }).reason, "token");
  assert.equal(plan({ actor: { uuid: "x", name: "", isToken: true }, seat: { judge: true } }).reason, "token", "refused for every seat");
  assert.equal(plan({ item: null }).reason, "notContainer");
  assert.equal(plan({ item: { ...FACTS().item, isContainer: false } }).reason, "notContainer");
  assert.equal(plan({ item: { ...FACTS().item, nested: true } }).reason, "notContainer");
  assert.equal(plan({ hasSpot: false }).reason, "notOnMap", "a Player with no token is blocked");

  const judge = plan({ seat: { judge: true, ownsCharacter: false }, hasSpot: false });
  assert.equal(judge.ok, true);
  assert.equal(judge.tokenless, true, "a Judge with no token goes ahead, and is told");

  const good = plan({});
  assert.deepEqual(good.record, { ownerUuid: "Actor.h1", worn: true, slot: "back", fromId: "pack1" });
  assert.deepEqual(good.flag, { ownerUuid: "Actor.h1", ownerName: "Hero", containerName: "Backpack", building: true });
  assert.equal(good.tokenless, false);
});

const RECORD = { ownerUuid: "Actor.h1", worn: true, slot: "back", fromId: "pack1" };

await ok("planArrival: owner restores the slot, an equippable with no slot equips, the coin order follows the id", () => {
  const owner = { uuid: "Actor.h1", isProvider: false };
  const arrive = (patch) => logic.planArrival({ record: RECORD, parent: owner, itemId: "pack9", equippable: false, coinOrder: {}, ...patch });

  assert.deepEqual(arrive({}), { clear: true, wear: { slot: "back" }, unwear: false, coinOrder: null });
  assert.deepEqual(arrive({ record: { ...RECORD, slot: null }, equippable: true }).wear, { equip: true });
  assert.equal(arrive({ record: { ...RECORD, slot: null } }).wear, null, "plain item, no slot: nothing to restore");
  assert.equal(arrive({ record: { ...RECORD, worn: false } }).wear, null, "carried, not worn: stays carried");

  const order = arrive({ coinOrder: { payFrom: "item:pack1", receiveInto: "item:other" } }).coinOrder;
  assert.deepEqual(order, { payFrom: "item:pack9" }, "only the half that named the old id");
  assert.equal(arrive({ coinOrder: { payFrom: "", receiveInto: "place:Actor.x" } }).coinOrder, null);
  assert.deepEqual(arrive({ nested: true, coinOrder: { payFrom: "item:pack1" } }), { clear: true, wear: null, unwear: true, coinOrder: null }, "stowed in a wrapper: taken off, order left, record spent");
});

await ok("planArrival: another character clears the record and takes the container off, a place does nothing", () => {
  const none = { clear: false, wear: null, unwear: false, coinOrder: null };
  assert.deepEqual(logic.planArrival({ record: RECORD, parent: { uuid: "Actor.h2", isProvider: false }, itemId: "p", equippable: true }), { clear: true, wear: null, unwear: true, coinOrder: null });
  assert.deepEqual(logic.planArrival({ record: RECORD, parent: { uuid: "Actor.pile", isProvider: true }, itemId: "p", equippable: true }), none);
  assert.deepEqual(logic.planArrival({ record: null, parent: { uuid: "Actor.h1", isProvider: false }, itemId: "p", equippable: true }), none);
  assert.deepEqual(logic.planArrival({ record: RECORD, parent: null, itemId: "p", equippable: true }), none);
});

await ok("pileIsEmpty and pileRowFacts", () => {
  assert.equal(logic.pileIsEmpty({ count: 0 }), true);
  assert.equal(logic.pileIsEmpty({ count: 0, building: true }), false, "a pile under construction is never empty");
  assert.equal(logic.pileIsEmpty({ count: 2 }), false);

  const flag = { ownerUuid: "Actor.h1", containerName: "Backpack" };
  const items = [
    { name: "Satchel", ownerUuid: "Actor.h1", setDown: { slot: "back", worn: true } },
    { name: "Torch", quantity: 3, ownerUuid: "Actor.h1" },
    { name: "Stranger's coin", ownerUuid: "Actor.h2" },
  ];
  const facts = logic.pileRowFacts({ flag, items, viewerUuid: "Actor.h1" });
  assert.equal(facts.container, "Satchel", "the name the container carries now");
  assert.equal(facts.slot, "back");
  assert.equal(facts.worn, true);
  assert.deepEqual(facts.lines, [{ name: "Satchel", quantity: 1 }, { name: "Torch", quantity: 3 }], "only the viewer's goods");
  assert.equal(facts.atRisk, true);
  const bare = logic.pileRowFacts({ flag, items: [{ name: "X", ownerUuid: "Actor.h2" }], viewerUuid: "Actor.h1" });
  assert.equal(bare.container, "Backpack", "falls back to the name it had when set down");
  assert.equal(bare.atRisk, false);
  assert.equal(bare.slot, null);
});

/* -------------------------------------------- */
/*  The handler                                 */
/* -------------------------------------------- */

await ok("a Player who owns the character sets the pack down: pile, token, goods moved", async () => {
  const scene = makeScene();
  const hero = await makeHero({ scene });
  const pack = await kit(hero);
  const answer = await setDownRelay(asPlayer(hero, pack, PLAYER, scene.id));
  assert.equal(answer.ok, true);

  const pile = pileOf();
  assert.ok(pile, "one pile exists");
  assert.equal(actors.filter((a) => a.type === LOCATION_TYPE).length, 1);
  assert.equal(pile.uuid, answer.pileUuid);
  assert.equal(pile.type, LOCATION_TYPE);
  assert.equal(pile.ownership.default, 2, "observed by every seat, owned by none");
  assert.equal(Object.keys(pile.ownership).length, 1, "and no seat is named an owner");
  assert.equal(isProvider(pile), true);
  const ground = pile.getFlag(MOD, "ground");
  assert.deepEqual(ground, { ownerUuid: hero.uuid, ownerName: "Hero", containerName: "Backpack", building: false });
  assert.equal(pile.img, "icons/pack.svg");

  assert.deepEqual(hero.items.map((i) => i.name), ["Rope"], "the pack and all that is in it left the character");
  assert.equal(pile.items.size, 4);
  assert.ok(pile.items.every((i) => i.getFlag(MOD, "storage")?.ownerUuid === hero.uuid), "kept at the pile as the character's");
  const carried = pile.items.find((i) => i.name === "Backpack");
  assert.deepEqual(carried.getFlag(MOD, SET_DOWN_FLAG), { ownerUuid: hero.uuid, worn: true, slot: "back", fromId: "pack1" });
  assert.notEqual(carried.id, "pack1", "the transfer mints a new id; the record keeps the old one");
  assert.equal(pile.items.find((i) => i.name === "Torch").getFlag(MOD, "containedIn"), carried.id, "contents point at the pack's new id");

  assert.equal(scene.tokens.size, 2, "the hero's token and the pile's");
  const token = scene.tokens.find((t) => t.actorId === pile.id);
  assert.equal(token.actorLink, true);
  assert.equal(token.hidden, false);
  assert.deepEqual([token.x, token.y], [500, 500], "centred on the character's spot");
  assert.equal(token.elevation, 0);
  assert.equal(answer.warn, undefined);
  assert.deepEqual(notes.filter(([k]) => k === "error"), []);
});

await ok("a Player who does not own the character creates nothing", async () => {
  const scene = makeScene();
  const hero = await makeHero({ scene });
  const pack = await kit(hero);
  const before = hero.items.size;
  const answer = await setDownRelay(asPlayer(hero, pack, STRANGER, scene.id));
  assert.deepEqual(answer, { ok: false, reason: "permission" });
  assert.equal(calls.actorCreate.length, 1, "only the hero was ever created");
  assert.equal(pileOf(), undefined);
  assert.equal(scene.tokens.size, 1);
  assert.equal(hero.items.size, before);
  assert.equal(pack.getFlag(MOD, SET_DOWN_FLAG), null, "no record left on the container");

  const unknown = await setDownRelay(asPlayer(hero, pack, "nobody", scene.id));
  assert.equal(unknown.reason, "permission", "a sender no user answers to owns nothing");
});

await ok("a Player with no token is blocked and creates nothing", async () => {
  const hero = await makeHero();
  const pack = await kit(hero);
  const answer = await setDownRelay(asPlayer(hero, pack));
  assert.deepEqual(answer, { ok: false, reason: "notOnMap" });
  assert.equal(calls.actorCreate.length, 1);
  assert.equal(hero.items.size, 5);
});

await ok("a Judge with no token gets a tokenless pile and a warning, and it still picks up", async () => {
  const hero = await makeHero();
  const pack = await kit(hero);
  const answer = await setDown(hero, pack);
  assert.equal(answer.ok, true);
  assert.equal(answer.warn, "noTokenJudge");
  const pile = pileOf();
  assert.ok(pile);
  assert.equal(pile.items.size, 4);
  assert.deepEqual(notes.map(([k, m]) => `${k}:${m}`), ["info:ACKS-LOCATION.ground.setDown", "warn:ACKS-LOCATION.ground.noTokenJudge"], "said once, by the seat that asked, with no reach warning from the storage layer");

  const back = await retrieve(pile, hero, pile.items.map((i) => i.id));
  assert.equal(back.ok, true);
  assert.equal(hero.items.size, 5);
});

await ok("a token's own actor is refused for every seat", async () => {
  const scene = makeScene();
  const hero = await makeHero({ scene });
  const pack = await kit(hero);
  hero.isToken = true;
  assert.equal((await setDownRelay(asPlayer(hero, pack, PLAYER, scene.id))).reason, "token");
  assert.equal((await setDownRelay({ ...asPlayer(hero, pack, null, scene.id) })).reason, "token");
  assert.equal(pileOf(), undefined);
});

await ok("what is not a carried container is refused", async () => {
  const scene = makeScene();
  const hero = await makeHero({ scene });
  const pack = await kit(hero);
  const rope = hero.items.get("rope1");
  assert.equal((await setDownRelay(asPlayer(hero, rope, PLAYER, scene.id))).reason, "notContainer");
  const nested = hero.items.get("torch1");
  await nested.setFlag(MOD, "container", { capacity: 0 });
  assert.equal((await setDownRelay(asPlayer(hero, nested, PLAYER, scene.id))).reason, "notContainer", "a container inside another goes with it, not alone");
  assert.equal((await setDownRelay({ ...asPlayer(hero, pack, PLAYER, scene.id), itemId: "gone" })).reason, "notContainer");
  assert.equal(pileOf(), undefined);
  assert.equal(scene.tokens.size, 1);
});

await ok("a failure in the first half of the transfer rolls back with exactly one delete", async () => {
  const scene = makeScene();
  const hero = await makeHero({ scene });
  const pack = await kit(hero);
  failures.create = (actor) => isGroundPile(actor);
  const answer = await setDownRelay(asPlayer(hero, pack, PLAYER, scene.id));
  await flushSweeps();
  assert.deepEqual(answer, { ok: false, reason: "failed" });
  assert.equal(calls.actorDelete.length, 1, "the pile is deleted once");
  assert.equal(pileOf(), undefined);
  assert.equal(scene.tokens.size, 1, "and its token with it");
  assert.equal(hero.items.size, 5, "the character lost nothing");
  assert.equal(pack.getFlag(MOD, SET_DOWN_FLAG), null, "the record is taken off the container");
  assert.ok(logged.some((m) => m.includes("storage transfer failed before anything moved")), "the failure was logged");
});

await ok("a failure in the second half rolls back with exactly one delete, and the compensation does not take the pile twice", async () => {
  const scene = makeScene();
  const hero = await makeHero({ scene });
  const pack = await kit(hero);
  failures.delete = (actor) => actor.id === hero.id;
  // The compensation has emptied the pile by the time the rollback removes its
  // token: let any sweep the emptying scheduled run first, as a timer would
  // between the two writes.
  const strike = scene.deleteEmbeddedDocuments.bind(scene);
  scene.deleteEmbeddedDocuments = async (...args) => {
    await flushSweeps();
    return strike(...args);
  };
  const answer = await setDownRelay(asPlayer(hero, pack, PLAYER, scene.id));
  await settle();
  await flushSweeps();
  await settle();
  assert.deepEqual(answer, { ok: false, reason: "failed" });
  assert.equal(calls.actorDelete.length, 1, "one delete: the rollback's, not also the hook's");
  assert.equal(pileOf(), undefined);
  assert.equal(scene.tokens.size, 1);
  assert.equal(hero.items.size, 5);
  assert.equal(hero.items.get("pack1").getFlag(MOD, SET_DOWN_FLAG), null);
});

await ok("both halves failing leaves the pile, so its goods are not handed back a third time", async () => {
  const scene = makeScene();
  const hero = await makeHero({ scene });
  const pack = await kit(hero);
  failures.delete = () => true;
  const answer = await setDownRelay(asPlayer(hero, pack, PLAYER, scene.id));
  await flushSweeps();
  assert.equal(answer.reason, "duplicated");
  assert.equal(calls.actorDelete.length, 0);
  const pile = pileOf();
  assert.ok(pile);
  assert.equal(pile.getFlag(MOD, "ground").building, false, "an ordinary pile from here on");
  assert.equal(hero.items.size, 5);
  assert.ok(notes.some(([k]) => k === "error"), "the storage layer said the goods exist twice");
});

await ok("a pile whose last write fails after the goods landed is kept, not deleted", async () => {
  const scene = makeScene();
  const hero = await makeHero({ scene });
  const pack = await kit(hero);
  const real = MockActor.prototype.update;
  MockActor.prototype.update = async function update(patch) {
    if (isGroundPile(this) && Object.keys(patch).some((k) => k.endsWith(".building"))) throw new Error("update refused");
    return real.call(this, patch);
  };
  try {
    const answer = await setDownRelay(asPlayer(hero, pack, PLAYER, scene.id));
    assert.equal(answer.ok, true, "the goods are on the ground, whatever the last write did");
  } finally {
    MockActor.prototype.update = real;
  }
  assert.equal(calls.actorDelete.length, 0);
  assert.equal(pileOf().items.size, 4);
  assert.equal(hero.items.size, 1);
});

await ok("a failed pile creation or token creation leaves nothing behind", async () => {
  const scene = makeScene();
  const hero = await makeHero({ scene });
  const pack = await kit(hero);
  failures.actorCreate = true;
  assert.equal((await setDownRelay(asPlayer(hero, pack, PLAYER, scene.id))).reason, "failed");
  failures.actorCreate = false;
  const make = scene.createEmbeddedDocuments.bind(scene);
  scene.createEmbeddedDocuments = async () => [];
  assert.equal((await setDownRelay(asPlayer(hero, pack, PLAYER, scene.id))).reason, "failed");
  scene.createEmbeddedDocuments = make;
  assert.equal(pileOf(), undefined, "the pile made before its token failed is deleted");
  assert.equal(hero.items.size, 5);
});

/* -------------------------------------------- */
/*  The hooks                                   */
/* -------------------------------------------- */

await ok("the pile is deleted once its last item is gone, with its token, and the container goes back worn", async () => {
  const scene = makeScene();
  const hero = await makeHero({ scene });
  const pack = await kit(hero, { equippable: true });
  hero.flags[MOD] = { coinOrder: { payFrom: "item:pack1", receiveInto: "item:pack1" } };
  assert.equal((await setDownRelay(asPlayer(hero, pack, PLAYER, scene.id))).ok, true);
  const pile = pileOf();
  assert.equal(hero.flags[MOD].coinOrder.payFrom, "item:pack1", "the order is left as it was while the pack lies there");
  assert.ok(pile.items.find((i) => i.name === "Backpack").getFlag(MOD, SET_DOWN_FLAG), "landing at a place keeps the record");

  const back = await retrieve(pile, hero, pile.items.map((i) => i.id));
  assert.equal(back.ok, true);
  await settle();
  const landed = hero.items.find((i) => i.name === "Backpack");
  assert.notEqual(landed.id, "pack1");
  assert.equal(landed.system.equipped, true, "equipped is reset by the transfer and restored on arrival");
  assert.equal(landed.getFlag(MOD, SET_DOWN_FLAG), null, "the record is spent");
  assert.equal(hero.flags[MOD].coinOrder.payFrom, `item:${landed.id}`, "the coin order names the pack by its new id");
  assert.equal(hero.flags[MOD].coinOrder.receiveInto, `item:${landed.id}`);

  assert.equal(pile.items.size, 0);
  assert.ok(pileOf(), "not deleted before its delay has run");
  await flushSweeps();
  assert.equal(pileOf(), undefined);
  assert.equal(calls.actorDelete.length, 1, "once, however many items a batch delete fired the hook for");
  assert.equal(scene.tokens.size, 1, "the pile's token went before the pile");
});

await ok("a pack with a slot and no equipped field keeps its slot, and an equippable with no slot is equipped", async () => {
  const scene = makeScene();
  const hero = await makeHero({ scene });
  const pack = await kit(hero);
  await setDownRelay(asPlayer(hero, pack, PLAYER, scene.id));
  const pile = pileOf();
  await retrieve(pile, hero, pile.items.map((i) => i.id));
  await settle();
  assert.equal(hero.items.find((i) => i.name === "Backpack").getFlag(MOD, "gear").wornAt, "back", "the worn mark rides the transfer, and arrival leaves it");

  const second = (await makeHero({ scene }));
  const sack = await kit(second, { equippable: true, slot: false });
  await setDownRelay(asPlayer(second, sack, PLAYER, scene.id));
  const sackPile = actors.find((a) => isGroundPile(a) && a.getFlag(MOD, "ground").ownerUuid === second.uuid);
  assert.equal(sackPile.items.find((i) => i.name === "Backpack").getFlag(MOD, SET_DOWN_FLAG).slot, null);
  await retrieve(sackPile, second, sackPile.items.map((i) => i.id));
  await settle();
  assert.equal(second.items.find((i) => i.name === "Backpack").system.equipped, true);
});

await ok("a pack carried, not worn, comes back carried", async () => {
  const scene = makeScene();
  const hero = await makeHero({ scene });
  const pack = await kit(hero, { worn: false, equippable: true });
  await setDownRelay(asPlayer(hero, pack, PLAYER, scene.id));
  const pile = pileOf();
  assert.equal(pile.items.find((i) => i.name === "Backpack").getFlag(MOD, SET_DOWN_FLAG).worn, false);
  await retrieve(pile, hero, pile.items.map((i) => i.id));
  await settle();
  assert.equal(hero.items.find((i) => i.name === "Backpack").system.equipped, false);
});

await ok("landing on another character clears the record and restores nothing", async () => {
  const scene = makeScene();
  const hero = await makeHero({ scene });
  const pack = await kit(hero, { equippable: true });
  await setDownRelay(asPlayer(hero, pack, PLAYER, scene.id));
  const pile = pileOf();
  const other = await Actor.create({ name: "Other", type: "character", ownership: { [PLAYER]: 3 } });
  other.flags[MOD] = { coinOrder: { payFrom: "item:pack1", receiveInto: "" } };
  await retrieve(pile, other, pile.items.map((i) => i.id));
  await settle();
  const landed = other.items.find((i) => i.name === "Backpack");
  assert.equal(landed.getFlag(MOD, SET_DOWN_FLAG), null);
  assert.equal(landed.system.equipped, false, "worn by nobody");
  assert.equal(other.flags[MOD].coinOrder.payFrom, "item:pack1", "their coin order is not rewritten");
});

await ok("a pile a Judge deletes takes its token with it", async () => {
  const scene = makeScene();
  const hero = await makeHero({ scene });
  const pack = await kit(hero);
  await setDownRelay(asPlayer(hero, pack, PLAYER, scene.id));
  const pile = pileOf();
  assert.equal(scene.tokens.size, 2);
  await pile.delete();
  await settle();
  assert.equal(scene.tokens.size, 1);
});

await ok("a pile still being built is never swept, and a pile with goods is not either", async () => {
  const scene = makeScene();
  const hero = await makeHero({ scene });
  const pack = await kit(hero);
  await setDownRelay(asPlayer(hero, pack, PLAYER, scene.id));
  const pile = pileOf();
  assert.equal(await sweepPile(pile), false, "goods in it");
  await pile.update({ "flags.acks-extras.ground.building": true });
  for (const item of [...pile.items]) pile.items.delete(item.id);
  assert.equal(await sweepPile(pile), false, "empty but building");
  await pile.update({ "flags.acks-extras.ground.building": false });
  assert.equal(await sweepPile(pile), true);
  assert.equal(await sweepPile(pile), false, "a pile already gone is no error");
});

await ok("only the active Judge's lead window writes a pile", async () => {
  const scene = makeScene();
  const hero = await makeHero({ scene });
  const pack = await kit(hero, { equippable: true });
  await setDownRelay(asPlayer(hero, pack, PLAYER, scene.id));
  const pile = pileOf();
  const item = pile.items.find((i) => i.name === "Backpack");

  users.activeGM = { isSelf: false };
  onDeleteItem(item, {}, JUDGE);
  await onCreateItem(item);
  await flushSweeps();
  assert.equal(calls.actorDelete.length, 0, "another Judge window answers");

  users.activeGM = { isSelf: true };
  game.user = USERS[PLAYER];
  onDeleteItem(item, {}, PLAYER);
  await flushSweeps();
  assert.equal(calls.actorDelete.length, 0, "a Player seat never deletes a pile");
  assert.ok(item.getFlag(MOD, SET_DOWN_FLAG), "and writes nothing on arrival");
});

await ok("a pile is the one shape: observed, a provider, flagged, not a point of interest", () => {
  const data = pileData({ flag: { ownerUuid: "Actor.h1", ownerName: "H", containerName: "Backpack" }, img: "i.svg", parentUuid: "Actor.town" });
  assert.equal(data.type, LOCATION_TYPE);
  assert.deepEqual(data.ownership, { default: 2 });
  assert.deepEqual(groundOwnership(), { default: 2 });
  assert.equal(data.system.parentUuid, "Actor.town");
  assert.equal(data.flags[MOD].storage.provider, true);
  assert.equal(data.flags[MOD].ground.containerName, "Backpack");
  const actor = { documentName: "Actor", type: LOCATION_TYPE, getFlag: (ns, k) => data.flags[ns]?.[k] };
  assert.equal(standsAsPlace(actor), false);
  assert.equal(standsAsPlace({ ...actor, getFlag: () => null }), true, "any other location still is one");
});

/* -------------------------------------------- */
/*  Anyone standing at a pile may take from it  */
/* -------------------------------------------- */

/** Answers the location feature's deposit reach with `can`, recording who was asked about what. */
function reachAnswers(can) {
  const asked = [];
  globalThis.acksExtras.location = { reach: { depositReach: (who, where) => (asked.push([who.name, where.name]), { can, reason: "far" }) } };
  return asked;
}
const noReach = () => { delete globalThis.acksExtras.location; };
const seatOf = (id) => { game.user = USERS[id]; };

/** A pile Hero's pack was set down at, and Alys, a second Player's character with a pack of her own. */
async function pileWithBystander({ equippable = false } = {}) {
  const scene = makeScene();
  const hero = await makeHero({ scene });
  const pack = await kit(hero, { equippable });
  assert.equal((await setDownRelay(asPlayer(hero, pack, PLAYER, scene.id))).ok, true);
  const alys = await Actor.create({ name: "Alys", type: "character", ownership: { [STRANGER]: 3 } });
  await alys.createEmbeddedDocuments("Item", [{ _id: "own1", name: "Satchel", type: "item", system: { subtype: "item", cost: 0, weight6: 0 }, flags: { [MOD]: gear() } }], { keepId: true });
  return { hero, alys, pile: pileOf() };
}
const idOf = (actor, name) => actor.items.find((i) => i.name === name).id;

await ok("a character standing at a pile takes another's row from it, with no Judge asked", async () => {
  const { hero, alys, pile } = await pileWithBystander();
  const asked = reachAnswers(true);
  try {
    seatOf(STRANGER);
    const answer = await retrieve(pile, alys, [{ id: idOf(pile, "Torch") }]);
    seatOf(JUDGE);
    assert.equal(answer.ok, true);
    assert.deepEqual(asked, [["Alys", pile.name]], "the location feature was asked whether Alys reaches the pile");
    const torch = alys.items.find((i) => i.name === "Torch");
    assert.ok(torch, "it landed on her");
    assert.equal(torch.getFlag(MOD, "storage"), null, "carried, no longer kept for anyone");
    assert.equal(pile.items.find((i) => i.name === "Torch"), undefined);
    assert.equal(pile.items.size, 3, "the rest still lies there, Hero's");
    assert.ok(pile.items.every((i) => i.getFlag(MOD, "storage")?.ownerUuid === hero.uuid));
    assert.deepEqual(notes.filter(([k]) => k === "warn" || k === "error"), []);
  } finally {
    noReach();
  }
});

await ok("a character away from the pile is refused, and nothing moves", async () => {
  const { alys, pile } = await pileWithBystander();
  reachAnswers(false);
  try {
    seatOf(STRANGER);
    const answer = await retrieve(pile, alys, [{ id: idOf(pile, "Torch") }]);
    seatOf(JUDGE);
    assert.deepEqual(answer, { ok: false, reason: "permission" });
    assert.equal(pile.items.size, 4);
    assert.equal(alys.items.find((i) => i.name === "Torch"), undefined);

    noReach();
    seatOf(STRANGER);
    assert.equal((await retrieve(pile, alys, [{ id: idOf(pile, "Torch") }])).reason, "permission", "with no location feature there is no reach to stand in");
    seatOf(JUDGE);
  } finally {
    noReach();
  }
});

for (const equippable of [false, true]) await ok(`the bystander who takes the set-down pack gets it loose: record cleared, not worn (${equippable ? "equippable, slot declared" : "plain, slot declared"})`, async () => {
  const { hero, alys, pile } = await pileWithBystander({ equippable });
  reachAnswers(true);
  try {
    seatOf(STRANGER);
    const answer = await retrieve(pile, alys, pile.items.map((i) => ({ id: i.id })));
    seatOf(JUDGE);
    assert.equal(answer.ok, true);
    await settle();
    const taken = alys.items.find((i) => i.name === "Backpack");
    assert.ok(taken);
    assert.equal(taken.getFlag(MOD, SET_DOWN_FLAG), null, "the record is cleared on another character");
    assert.equal(taken.getFlag(MOD, "gear").wornAt || "", "", "the worn mark that rode the transfer is taken off");
    assert.equal(!!taken.system.equipped, false, "and it is not equipped");
    assert.equal(alys.items.get("own1").flags[MOD].gear.wornAt, "back", "her own pack keeps the slot; nothing was put back on Back");
    assert.equal(hero.items.find((i) => i.name === "Backpack"), undefined, "and Hero does not have it");
    await flushSweeps();
    assert.equal(pileOf(), undefined, "the empty pile is removed");
  } finally {
    noReach();
  }
});

await ok("an ordinary place still refuses another character's row, whoever stands at it", async () => {
  const hero = await makeHero();
  await kit(hero);
  const alys = await Actor.create({ name: "Alys", type: "character", ownership: { [STRANGER]: 3 } });
  const place = await Actor.create({ name: "Cellar", type: LOCATION_TYPE, flags: { [MOD]: { storage: { provider: true } } }, ownership: { default: 2 } });
  assert.equal((await stash(hero, place, [{ id: "rope1" }])).ok, true);
  assert.equal(isGroundPile(place), false);
  const asked = reachAnswers(true);
  try {
    seatOf(STRANGER);
    const answer = await retrieve(place, alys, [{ id: idOf(place, "Rope") }]);
    seatOf(JUDGE);
    assert.deepEqual(answer, { ok: false, reason: "permission" });
    assert.deepEqual(asked, [], "reach is not asked about a place that is no pile");
    assert.equal(place.items.size, 1);
  } finally {
    noReach();
  }
});

await ok("a stash counts off plain-number gear, a weapon and armour alike", async () => {
  const hero = await makeHero();
  await hero.createEmbeddedDocuments("Item", [
    { _id: "spears", name: "Spears", type: "weapon", system: { cost: 0, weight6: 6, quantity: 3, equipped: false } },
    { _id: "mail", name: "Mail", type: "armor", system: { cost: 0, weight6: 10, quantity: 2, equipped: false } },
    { _id: "torches", name: "Torches", type: "item", system: { subtype: "item", cost: 0, weight6: 1, quantity: 5 } },
  ], { keepId: true });
  const place = await Actor.create({ name: "Cellar", type: LOCATION_TYPE, flags: { [MOD]: { storage: { provider: true } } }, ownership: { default: 2 } });
  const answer = await stash(hero, place, [{ id: "spears", quantity: 1 }, { id: "mail", quantity: 1 }, { id: "torches", quantity: 2 }]);
  assert.equal(answer.ok, true);
  const there = (name) => place.items.find((i) => i.name === name);
  assert.equal(there("Spears").system.quantity, 1, "a weapon is counted off: the one asked for moved");
  assert.equal(there("Mail").system.quantity, 1, "and armour");
  assert.equal(there("Torches").system.quantity, 2, "gear moves the count asked for");
  assert.equal(hero.items.find((i) => i.name === "Spears").system.quantity, 2, "two stay");
  assert.equal(hero.items.find((i) => i.name === "Mail").system.quantity, 1);
  assert.equal(hero.items.find((i) => i.name === "Torches").system.quantity, 3);
});

await ok("a stash folds a counted-off weapon into the stack the place already holds, and keeps a drawn one out of it", async () => {
  const hero = await makeHero();
  await hero.createEmbeddedDocuments("Item", [
    { _id: "spears", name: "Spears", type: "weapon", system: { cost: 0, weight6: 6, quantity: 4, equipped: false } },
    { _id: "drawn", name: "Spears", type: "weapon", system: { cost: 0, weight6: 6, quantity: 1, equipped: true } },
  ], { keepId: true });
  const place = await Actor.create({ name: "Cellar", type: LOCATION_TYPE, flags: { [MOD]: { storage: { provider: true } } }, ownership: { default: 2 } });
  assert.equal((await stash(hero, place, [{ id: "spears", quantity: 1 }])).ok, true);
  assert.equal((await stash(hero, place, [{ id: "spears", quantity: 2 }])).ok, true);
  const rows = place.items.filter((i) => i.name === "Spears");
  assert.deepEqual(rows.map((i) => i.system.quantity), [3], "two stashes of the one stack are one row there");
  assert.equal(hero.items.find((i) => i.id === "spears").system.quantity, 1);
  assert.equal(hero.items.find((i) => i.id === "drawn").system.equipped, true, "the spear in hand was not asked for");
});

await ok("the owner takes their own rows from a pile from anywhere, reach not asked", async () => {
  const scene = makeScene();
  const hero = await makeHero({ scene });
  const pack = await kit(hero);
  assert.equal((await setDownRelay(asPlayer(hero, pack, PLAYER, scene.id))).ok, true);
  const pile = pileOf();
  const asked = reachAnswers(false);
  try {
    seatOf(PLAYER);
    const answer = await retrieve(pile, hero, pile.items.map((i) => ({ id: i.id })));
    seatOf(JUDGE);
    assert.equal(answer.ok, true);
    assert.deepEqual(asked, [], "the owner's own rows are not reach-gated");
    await settle();
    assert.ok(hero.items.find((i) => i.name === "Backpack"));
  } finally {
    noReach();
  }
});

await ok("the system sheet's Storage tab treats a pile as the Equipment tab does", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const tab = read("../scripts/location/apps/storage-tab.mjs");
  const tpl = read("../templates/location/storage-tab.hbs");
  assert.match(tab, /canDeposit: !ground && /, "a pile takes no deposit, a Judge's included");
  assert.match(tab, /canOpen: !ground \|\| provider\.testUserPermission\(game\.user, "OBSERVER"\)/, "and opens for a seat that observes it");
  assert.match(tab, /if \(isGroundPile\(place\) && !place\.testUserPermission\(game\.user, "OBSERVER"\)\) break;/, "the open handler refuses a seat that does not");
  assert.match(tab, /\.filter\(\(p\) => !isGroundPile\(p\) && /, "a pile with none of the character's goods is not listed");
  assert.match(tab, /if \(isGroundPile\(dropped\)\) return void ui\.notifications\.warn/, "a pile dropped on a sheet is not pinned");
  assert.match(tpl, /\{\{#if place\.canOpen\}\}/, "the template reads canOpen");
  assert.match(tpl, /\{\{else if place\.reachReason\}\}/, "and shows no out-of-reach hint where there is no reason");
});

console.log(`\ntest-location-ground: OK (${passed} checks — the planners, the Judge's handler and its refusals, rollback, arrival, the three hooks, a bystander's take)`);
