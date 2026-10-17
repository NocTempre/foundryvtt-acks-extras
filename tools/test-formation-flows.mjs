/**
 * Offline flow tests: execute the module's real transfer / deploy / reform /
 * cleanup code against mocked Foundry globals (the family's live-test
 * substitute — TOOLCHAIN.md §4a). These exist because every regression the
 * users hit was in a flow no static check exercises: hook interleaving,
 * whole-record setting writes, and document lifecycle.
 *
 * Run: node tools/test-flows.mjs   (also wired into `npm run validate`).
 */
import assert from "node:assert/strict";

// One namespace now, not eight globals; stubs below hang off it.
globalThis.acksExtras ??= {};

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

const sleep = (ms = 1) => new Promise((r) => setTimeout(r, ms));
let nextId = 0;
const uid = (p = "id") => `${p}${(++nextId).toString().padStart(4, "0")}`;

const hooks = new Map();
globalThis.Hooks = {
  on(name, fn) {
    if (!hooks.has(name)) hooks.set(name, []);
    hooks.get(name).push(fn);
  },
  once(name, fn) {
    const wrapper = (...args) => {
      hooks.get(name)?.splice(hooks.get(name).indexOf(wrapper), 1);
      return fn(...args);
    };
    this.on(name, wrapper);
  },
  off(name, fn) {
    const list = hooks.get(name) ?? [];
    if (list.includes(fn)) list.splice(list.indexOf(fn), 1);
  },
  call(name, ...args) {
    for (const fn of [...(hooks.get(name) ?? [])]) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`hook ${name} threw`, err);
      }
    }
  },
  callAll(name, ...args) {
    return this.call(name, ...args);
  },
};

class Coll extends Map {
  get contents() {
    return [...this.values()];
  }
  find(fn) {
    return this.contents.find(fn);
  }
  filter(fn) {
    return this.contents.filter(fn);
  }
  some(fn) {
    return this.contents.some(fn);
  }
  [Symbol.iterator]() {
    return this.values();
  }
}

const setProp = (obj, path, value) => {
  const parts = path.split(".");
  let at = obj;
  for (const p of parts.slice(0, -1)) at = at[p] ??= {};
  at[parts.at(-1)] = value;
};
// Foundry's own `setProperty` builds an intermediate only where it is
// undefined, so a null on the path throws, as it does live. The mocks' writes
// keep the lenient `setProp` above.
const foundrySetProperty = (obj, path, value) => {
  const parts = path.split(".");
  const key = parts.pop();
  const target = parts.reduce((at, p) => {
    if (at[p] === undefined) at[p] = {};
    return at[p];
  }, obj);
  if (target[key] === value) return false;
  target[key] = value;
  return true;
};
// A document's `updateSource`, as far as a delta patch needs: objects merge,
// anything else replaces.
const mergeInto = (target, patch) => {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object") mergeInto(target[k], v);
    else target[k] = JSON.parse(JSON.stringify(v));
  }
  return target;
};
const hasProp = (obj, path) => {
  let at = obj;
  for (const p of path.split(".")) {
    if (at == null || !(p in at)) return false;
    at = at[p];
  }
  return true;
};

class FieldStub {
  constructor(...args) {
    this.args = args;
  }
}

globalThis.foundry = {
  utils: {
    deepClone: (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v))),
    randomID: () => uid("rnd"),
    setProperty: foundrySetProperty,
    hasProperty: hasProp,
    getProperty: (o, p) => p.split(".").reduce((a, k) => a?.[k], o),
    escapeHTML: (s) => String(s),
    isEmpty: (v) => v == null || (typeof v === "object" && !Object.keys(v).length),
    mergeObject: (a, b) => Object.assign(a, b),
  },
  abstract: { TypeDataModel: class {}, DataModel: class {} },
  data: {
    fields: new Proxy({}, { get: () => FieldStub }),
    regionBehaviors: { RegionBehaviorType: class {} },
  },
  applications: {
    api: {
      ApplicationV2: class {
        constructor(options = {}) {
          this.options = options;
        }
        render() {
          return this;
        }
      },
      HandlebarsApplicationMixin: (Base) => class extends Base {},
      DialogV2: { confirm: async () => true },
    },
    sheets: {
      ActorSheetV2: class {
        constructor(options = {}) {
          this.options = options;
        }
        get actor() {
          return this.options.document ?? null;
        }
        render() {
          return this;
        }
      },
      // The trap item's sheet is reached through formation/module.mjs, and a
      // sheet class whose base is undefined throws at IMPORT time — before any
      // test runs — so the base has to exist even though nothing renders one.
      ItemSheetV2: class {
        constructor(options = {}) {
          this.options = options;
        }
        get item() {
          return this.options.document ?? null;
        }
        render() {
          return this;
        }
      },
    },
    apps: {
      DocumentSheetConfig: { registerSheet() {} },
      FilePicker: { implementation: class {} },
    },
    handlebars: { loadTemplates: () => [] },
    ux: {
      DragDrop: { implementation: class {
        bind() {}
      } },
      TextEditor: { implementation: { getDragEventData: () => ({}) } },
    },
    instances: new Map(),
  },
  documents: { collections: { Items: { registerSheet() {} } } },
};

globalThis.CONFIG = {
  Actor: { dataModels: {} },
  Item: { dataModels: {} },
  RegionBehavior: { dataModels: {}, typeIcons: {} },
};
globalThis.CONST = {
  DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OWNER: 3 },
  TOKEN_DISPLAY_MODES: { HOVER: 1 },
  TOKEN_DISPOSITIONS: { FRIENDLY: 1 },
  FOG_EXPLORATION_MODES: { DISABLED: 0, INDIVIDUAL: 1, SHARED: 2 }, // matches core v14
  GRID_TYPES: { GRIDLESS: 0, SQUARE: 1, HEXODDR: 2, HEXEVENR: 3, HEXODDQ: 4, HEXEVENQ: 5 }, // matches core v14
};

const chat = [];
globalThis.ChatMessage = {
  async create(d) {
    chat.push(d);
    return d;
  },
};
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
  }
  async evaluate() {
    this.total = 10;
    return this;
  }
  async render() {
    return `<div class="dice-roll">${this.total}</div>`;
  }
};
const notices = [];
globalThis.ui = {
  notifications: {
    info: (m) => notices.push(["info", m]),
    warn: (m) => notices.push(["warn", m]),
    error: (m) => notices.push(["error", m]),
  },
};
globalThis.canvas = { scene: null, tokens: { controlled: [] } };

const uuidMap = new Map();
globalThis.fromUuid = async (u) => uuidMap.get(u) ?? null;
globalThis.fromUuidSync = (u) => uuidMap.get(u) ?? null;

/* --- documents --- */

class ItemMock {
  constructor(parent, data) {
    this.parent = parent;
    this.id = uid("itm");
    this.uuid = `Actor.${parent.id}.Item.${this.id}`;
    Object.assign(this, foundry.utils.deepClone(data));
    // The system's ItemPhysicalTemplate gives EVERY item/weapon/armor a cost and
    // a weight6, and the family's "is this a physical thing?" probe reads those
    // fields rather than a type list — so a fixture without them is not a
    // realistic item, and gear lookups would silently skip it.
    if (["item", "weapon", "armor"].includes(this.type)) {
      this.system ??= {};
      this.system.cost ??= 0;
      this.system.weight6 ??= 0;
    }
    this.flags ??= {};
    uuidMap.set(this.uuid, this);
  }
  getFlag(ns, key) {
    return this.flags?.[ns]?.[key];
  }
  async setFlag(ns, key, value) {
    (this.flags[ns] ??= {})[key] = foundry.utils.deepClone(value);
    return this;
  }
  async update(changes) {
    for (const [k, v] of Object.entries(changes)) setProp(this, k, v);
    await sleep();
    Hooks.call("updateItem", this, changes, {}, "GM1");
    return this;
  }
}

class ActorMock {
  constructor(data) {
    this.id = uid("act");
    this.uuid = `Actor.${this.id}`;
    this.name = data.name ?? "Actor";
    this.type = data.type ?? "character";
    this.img = data.img ?? "";
    this.system = foundry.utils.deepClone(data.system ?? {});
    this.flags = foundry.utils.deepClone(data.flags ?? {});
    this.ownership = foundry.utils.deepClone(data.ownership ?? { default: 0 });
    this.prototypeToken = foundry.utils.deepClone(data.prototypeToken ?? { width: 1, height: 1 });
    this.items = new Coll();
    this.effects = [];
    this.sheet = { render() {}, close() {} };
    uuidMap.set(this.uuid, this);
  }
  static get implementation() {
    return ActorMock;
  }
  static async create(data) {
    const actor = new ActorMock(data);
    game.actors.set(actor.id, actor);
    await sleep();
    Hooks.call("createActor", actor);
    return actor;
  }
  getFlag(ns, key) {
    return this.flags?.[ns]?.[key];
  }
  async setFlag(ns, key, value) {
    (this.flags[ns] ??= {})[key] = foundry.utils.deepClone(value);
    return this;
  }
  async update(changes) {
    for (const [k, v] of Object.entries(changes)) setProp(this, k, v);
    await sleep(2);
    Hooks.call("updateActor", this, changes);
    return this;
  }
  async delete() {
    game.actors.delete(this.id);
    await sleep();
    Hooks.call("deleteActor", this);
  }
  async getTokenDocument(data = {}) {
    const src = {
      name: this.name,
      actorId: this.id,
      x: 0,
      y: 0,
      width: this.prototypeToken.width ?? 1,
      height: this.prototypeToken.height ?? 1,
      hidden: false,
      flags: {},
      light: { bright: 0, dim: 0 },
      texture: { src: this.img },
      ...foundry.utils.deepClone(data),
    };
    return { toObject: () => foundry.utils.deepClone(src) };
  }
  async createEmbeddedDocuments(type, arr) {
    if (type === "ActiveEffect") {
      const made = arr.map((d) => {
        const parent = this;
        const eff = {
          ...foundry.utils.deepClone(d),
          id: uid("eff"),
          getFlag: (ns, key) => eff.flags?.[ns]?.[key],
          async delete() {
            parent.effects.splice(parent.effects.indexOf(eff), 1);
            await sleep();
            Hooks.call("deleteActiveEffect", eff);
          },
        };
        this.effects.push(eff);
        return eff;
      });
      await sleep();
      for (const eff of made) Hooks.call("createActiveEffect", eff);
      return made;
    }
    assert.equal(type, "Item");
    return arr.map((d) => {
      const item = new ItemMock(this, d);
      this.items.set(item.id, item);
      return item;
    });
  }
  getUserLevel(user) {
    const o = this.ownership ?? {};
    return o[user?.id] ?? o.default ?? 0;
  }
  testUserPermission(user) {
    if (user?.isGM) return true;
    return this.getUserLevel(user) >= 3;
  }
}
globalThis.Actor = ActorMock;

class TokenMock {
  /** The corner a move this client is still drawing will land on; null when none is. */
  #tween = null;
  constructor(scene, data) {
    this.parent = scene;
    this.id = data._id ?? uid("tok");
    const { _id, ...rest } = foundry.utils.deepClone(data);
    Object.assign(this, rest);
    this.flags ??= {};
    this.width ??= 1;
    this.height ??= 1;
    this.light ??= { bright: 0, dim: 0 };
    this.x ??= 0;
    this.y ??= 0;
  }
  get actor() {
    return game.actors.get(this.actorId) ?? null;
  }
  /** Core's stored data. While a move is drawn, the prepared `x`/`y` lag it. */
  get _source() {
    return this.#tween ?? this;
  }
  getFlag(ns, key) {
    return this.flags?.[ns]?.[key];
  }
  async setFlag(ns, key, value) {
    (this.flags[ns] ??= {})[key] = foundry.utils.deepClone(value);
    const changes = { flags: { [ns]: { [key]: value } } };
    Hooks.call("updateToken", this, changes, {}, "GM1");
    return this;
  }
  toObject() {
    const { parent, ...rest } = this;
    return foundry.utils.deepClone({ ...rest, _id: this.id });
  }
  /**
   * Core's update, and on a client drawing the token (`rendered`) its draw of
   * a move: core runs the tween's first frame inside the update, so the hook
   * and every await it starts read the corner the token is leaving, until
   * `endTween` lands it. A write that changes nothing stored is dropped before
   * it is sent (`ClientDatabaseBackend`), so no hook fires and a drawn move
   * keeps drawing; an unanimated write ends one (`Token#stopAnimation`).
   */
  async update(changes, options = {}) {
    const stored = (k) => (this.#tween && k in this.#tween ? this.#tween[k] : this[k]);
    const unchanged = ([k, v]) => !k.includes(".") && (v === null || typeof v !== "object") && stored(k) === v;
    if (Object.entries(changes).every(unchanged)) return this;
    if (options.animate === false) this.endTween();
    const from = { x: this.x, y: this.y };
    for (const [k, v] of Object.entries(changes)) setProp(this, k, v);
    if (this.rendered && options.animate !== false && ("x" in changes || "y" in changes)) {
      this.#tween = { x: this.x, y: this.y };
      Object.assign(this, from);
    }
    await sleep();
    Hooks.call("updateToken", this, changes, options, "GM1");
    return this;
  }
  /** The drawn move lands: the prepared corner reaches the stored one. */
  endTween() {
    if (!this.#tween) return;
    Object.assign(this, this.#tween);
    this.#tween = null;
  }
  /**
   * Core's `TokenDocument#resize`, modelled rather than stubbed: it holds the
   * token's CENTRE still, so a size change MOVES x and y. See
   * docs/formation/DECISIONS.md, "A formation that turns has not gone
   * anywhere".
   */
  async resize(dimensions, options = {}) {
    const g = this.parent?.grid?.size ?? 100;
    const { width = this.width, height = this.height, ...rest } = dimensions;
    const changes = {
      ...rest,
      width,
      height,
      x: Math.round(this.x + ((this.width - width) * g) / 2),
      y: Math.round(this.y + ((this.height - height) * g) / 2),
    };
    return this.update(changes, options);
  }
}

class SceneMock {
  constructor(name) {
    this.id = uid("scn");
    this.name = name;
    this.grid = { size: 100, distance: 5 };
    this.tokens = new Coll();
    this.regions = new Coll();
    this.fog = { mode: CONST.FOG_EXPLORATION_MODES.EXPLORED };
    this.environment = { darknessLevel: 0 };
    this.flags = {};
  }
  getFlag(ns, key) {
    return this.flags?.[ns]?.[key];
  }
  async setFlag(ns, key, value) {
    (this.flags[ns] ??= {})[key] = foundry.utils.deepClone(value);
    return this;
  }
  async unsetFlag(ns, key) {
    delete this.flags?.[ns]?.[key];
    return this;
  }
  async update(changes) {
    for (const [k, v] of Object.entries(changes)) setProp(this, k, v);
    await sleep(2);
    return this;
  }
  async createEmbeddedDocuments(type, arr, options = {}) {
    assert.equal(type, "Token");
    this.lastCreateOptions = options;
    const out = [];
    for (const data of arr) {
      const token = new TokenMock(this, data);
      // Foundry's order: the document's own `_preCreate` first (here the
      // system's roll for a placed unlinked monster, when a scenario arms
      // `rollMonsterHp`), then the `preCreateToken` hook with the creation
      // data as given. A null delta stays null unless something writes it.
      const original = token.delta;
      const pending = original ?? {};
      let written = false;
      Object.defineProperty(pending, "updateSource", {
        value: (patch) => {
          written = true;
          return mergeInto(pending, patch);
        },
        configurable: true,
      });
      // An ActorDelta's source, as lib's hook reads it.
      Object.defineProperty(pending, "_source", { get: () => pending, configurable: true });
      token.delta = pending;
      if (this.rollMonsterHp && !token.actorLink && token.actor?.type === "monster") {
        pending.updateSource({ system: { hp: { value: 1, max: 1 } } });
      }
      Hooks.call("preCreateToken", token, data, options, "GM1");
      if (!written && original == null) token.delta = original;
      this.tokens.set(token.id, token);
      out.push(token);
      await sleep();
      Hooks.call("createToken", token);
    }
    return out;
  }
  async deleteEmbeddedDocuments(type, ids, options = {}) {
    assert.equal(type, "Token");
    for (const id of ids) {
      const token = this.tokens.get(id);
      if (!token) continue;
      this.tokens.delete(id);
      await sleep();
      Hooks.call("deleteToken", token, options, "GM1");
    }
  }
}

class CombatantMock {
  constructor(combat, data) {
    this.parent = combat;
    this.id = uid("cbt");
    Object.assign(this, foundry.utils.deepClone(data));
  }
  get token() {
    return game.scenes.get(this.sceneId)?.tokens.get(this.tokenId) ?? null;
  }
  async delete() {
    this.parent.combatants.delete(this.id);
    await sleep();
  }
}

class CombatMock {
  constructor() {
    this.id = uid("cmb");
    this.round = 0;
    this.combatants = new Coll();
  }
  async createEmbeddedDocuments(type, arr) {
    assert.equal(type, "Combatant");
    const out = [];
    for (const data of arr) {
      const combatant = new CombatantMock(this, data);
      this.combatants.set(combatant.id, combatant);
      out.push(combatant);
      await sleep();
      Hooks.call("createCombatant", combatant, {}, "GM1");
    }
    return out;
  }
  async setRound(round) {
    this.round = round;
    await sleep();
    Hooks.call("updateCombat", this, { round }, {}, "GM1");
  }
  async delete() {
    game.combats.delete(this.id);
    await sleep();
    Hooks.call("deleteCombat", this);
  }
}

/* --- game --- */

const settingsStore = new Map();
const settingsDefaults = new Map();
const settingsScopes = new Map();
globalThis.game = {
  settings: {
    register(ns, key, cfg) {
      settingsDefaults.set(`${ns}.${key}`, cfg?.default);
      settingsScopes.set(`${ns}.${key}`, cfg?.scope ?? "client");
    },
    get(ns, key) {
      const k = `${ns}.${key}`;
      if (settingsStore.has(k)) return settingsStore.get(k);
      return foundry.utils.deepClone(settingsDefaults.get(k));
    },
    async set(ns, key, value) {
      const k = `${ns}.${key}`;
      // A WORLD setting is GM-only in Foundry, and every formation lives in one.
      // Refusing the write here is what makes the player paths testable at all.
      // Modelled as Foundry does it — the write throws.
      if (settingsScopes.get(k) === "world" && !game.user?.isGM) {
        throw new Error(`User lacks permission to update world setting ${k}`);
      }
      const existed = settingsStore.has(k);
      settingsStore.set(k, foundry.utils.deepClone(value));
      Hooks.call(existed ? "updateSetting" : "createSetting", { key: k, value });
      await sleep();
      return value;
    },
  },
  i18n: { localize: (k) => k, format: (k, d) => `${k}${d ? " " + JSON.stringify(d) : ""}`, has: () => true },
  // No `user` here on purpose: it is assigned below, out of `users`, so the
  // seat is one of the table's own users, not a look-alike beside them.
  users: (() => {
    const users = [
      { id: "GM1", name: "GM", isGM: true, isSelf: true },
      { id: "PL1", name: "Player One", isGM: false, isSelf: false },
    ];
    // NOT Object.assign: that would evaluate the getter once at copy time.
    Object.defineProperty(users, "activeGM", { get: () => users[0] });
    users.get = (id) => users.find((u) => u.id === id) ?? null;
    return users;
  })(),
  actors: new Coll(),
  scenes: new Coll(),
  combats: new Coll(),
  tables: { contents: [], get: () => null },
  folders: new Coll(),
  modules: { get: () => ({ active: true }) },
  system: { id: "acks" },
  // `advanced` records what the module asked the world clock for, so the gated
  // write can be asserted rather than assumed. The clock also MOVES and fires
  // `updateWorldTime` the way core's does: the watchers on that hook are the
  // other half of what an advance sets going, and a mock that only recorded the
  // ask leaves every calendar-driven path untested and every race between the
  // two callers invisible.
  time: {
    worldTime: 0,
    advanced: [],
    advance: async (seconds) => {
      game.time.advanced.push(seconds);
      game.time.worldTime += seconds;
      await sleep();
      Hooks.callAll("updateWorldTime", game.time.worldTime, seconds);
    },
  },
  paused: false,
  socket: { emit() {} },
};

// `game.user` IS one of `game.users` at a table, and lib's world-clock watcher
// decides which client acts on an advance by testing that identity. A
// look-alike object of the same id fails the test, which leaves every
// calendar-driven feature registered and unreachable from this harness.
game.user = game.users.get("GM1");

/* -------------------------------------------- */
/*  Load the module (registers all hooks)        */
/* -------------------------------------------- */

await import("../scripts/formation/module.mjs");
// The formation keeps a placed member's hit points through lib's hook, which
// lib installs at init; this harness does not load lib, so install it here.
const formationPreCreateHooks = hooks.get("preCreateToken")?.length ?? 0;
const { installRecreatedHitPoints } = await import("../scripts/lib/hp.mjs");
const { KEEP_HIT_POINTS_OPTION } = await import("../scripts/lib/constants.mjs");
installRecreatedHitPoints();
const model = await import("../scripts/formation/formation-model.mjs");
const engine = await import("../scripts/formation/turn-engine.mjs");
const requests = await import("../scripts/formation/player-requests.mjs");
const { getSocket } = await import("../scripts/lib/sockets.mjs");
const sceneSync = await import("../scripts/formation/scene-sync.mjs");
const deployment = await import("../scripts/formation/deployment.mjs");
// The world-clock gate belongs to lib, which this harness does not load (it
// would drag in the sheets, data models and core patches). Register it here,
// with lib's own default, so a dungeon turn takes the same path it takes at a
// table — an unregistered key reads as "off" and would silently stop testing
// the write.
const { SETTING_ADVANCE_WORLD_TIME } = await import("../scripts/lib/world-time.mjs");
game.settings.register("acks-extras", SETTING_ADVANCE_WORLD_TIME, {
  scope: "world",
  config: true,
  type: Boolean,
  default: true,
});
Hooks.call("init");
Hooks.call("ready");
// socketlib: in-process loopback — executeAsGM invokes the registered handler
// directly, which is exactly what happens when the GM client IS the executor.
const socketHandlers = {};
globalThis.socketlib = {
  registerModule: () => ({
    register: (name, fn) => (socketHandlers[name] = fn),
    // executeAsGM runs the handler ON THE GM'S CLIENT, so `game.user` there is
    // the GM and not the player who declared. Modelling that is what lets the
    // world-setting guard above stand: the relay must be the one route by which
    // a player's declaration reaches a write. The declaring user reaches the
    // handler the way socketlib delivers it — as `this.socketdata.userId`, the
    // sender the server stamped — never as anything the payload says.
    executeAsGM: async (name, ...args) => {
      const declaring = game.user;
      game.user = game.users.activeGM;
      try {
        return await socketHandlers[name]?.call({ socketdata: { userId: declaring.id } }, ...args);
      } finally {
        game.user = declaring;
      }
    },
  }),
};
Hooks.call("socketlib.ready");
await sleep(10);

const MODULE_ID = "acks-extras";
const readFormations = () => game.settings.get(MODULE_ID, "formations") ?? {};
const onlyFormation = () => {
  const all = Object.values(readFormations());
  assert.equal(all.length, 1, `expected exactly one formation, found ${all.length}`);
  return all[0];
};
/** Settle every unawaited async hook chain. */
const drain = async () => {
  for (let i = 0; i < 12; i++) await sleep(3);
};

const member = (name) =>
  ActorMock.create({
    name,
    type: "character",
    system: {
      hp: { value: 10, max: 10 },
      details: { level: 3 },
      movementacks: { exploration: 120 },
      movement: { base: 120 },
      encumbrance: { value: 5, max: 20 },
      scores: { str: { mod: 1 } },
      adventuring: { listening: 18, searching: 18, dungeonbashing: 18 },
    },
  });

let failures = 0;
async function scenario(name, fn) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}`);
    console.error(`      ${err.message}`);
  }
}

/* -------------------------------------------- */
/*  Scenarios                                   */
/* -------------------------------------------- */

const scene = new SceneMock("Dungeon");
game.scenes.set(scene.id, scene);

const alice = await member("Alice");
const bob = await member("Bob");
await drain();

const [tokenA] = await scene.createEmbeddedDocuments("Token", [
  { name: "Alice", actorId: alice.id, x: 500, y: 500 },
]);
const [tokenB] = await scene.createEmbeddedDocuments("Token", [
  { name: "Bob", actorId: bob.id, x: 600, y: 500 },
]);

await scenario("transfer: adding members converts tokens into the formation", async () => {
  let formation = await model.createFormation("Test Party");
  formation = await model.addMember(formation, alice, tokenA);
  await drain();

  let stored = onlyFormation();
  assert.equal(stored.members.length, 1, "member persisted");
  assert.ok(stored.members[0].tokenData, "token stashed");
  assert.ok(!scene.tokens.get(tokenA.id), "canvas token removed");
  assert.ok(stored.tokenId && scene.tokens.get(stored.tokenId), "party token created");
  assert.ok(stored.actorId && game.actors.get(stored.actorId), "party actor exists");

  formation = model.getFormation(stored.id);
  await model.addMember(formation, bob, tokenB);
  await drain();

  stored = onlyFormation();
  assert.equal(stored.members.length, 2, "second member persisted (no clobber)");
  assert.ok(!scene.tokens.get(tokenB.id), "second canvas token removed");
  const partyActors = game.actors.filter((a) => a.type === `${MODULE_ID}.party`);
  assert.equal(partyActors.length, 1, `exactly one party actor (found ${partyActors.length})`);
});

await scenario("partySpeed: the dark slows by the scene unless the caller says the clock is the judge", async () => {
  const formation = model.getFormation(onlyFormation().id);
  const lit = model.partySpeed(formation);
  assert.ok(lit > 0, "a lit scene walks at the party's pace");
  const was = scene.environment.darknessLevel;
  try {
    scene.environment.darknessLevel = 0.9;
    assert.equal(model.partySpeed(formation), Math.floor(lit / 3), "a dark scene slows members who cannot see in it to a third");
    assert.equal(model.partySpeed(formation, { dark: false }), lit, "a journey that passes dark:false keeps the full pace");
    scene.environment.darknessLevel = 0;
    assert.equal(model.partySpeed(formation, { dark: true }), Math.floor(lit / 3), "a lit scene slows when the caller says it is dark");
    assert.equal(model.partySpeed(formation, { dark: false }), lit);
  } finally {
    scene.environment.darknessLevel = was;
  }
});

await scenario("deploy survives the environment-sync interleave (mapper active)", async () => {
  // Reproduce the historical race: a mapper with a lit torch makes the
  // settings-triggered environment sync take the ensureMapSession write path —
  // the one that erased deploy's combat flag. Fog management is switched off
  // while the mapper is assigned so no session opens EARLY; re-enabling it
  // just before combat means the only sync that can open one is the sync
  // launched by deploy's own first write, mid-deploy, holding a stale copy.
  await game.settings.set(MODULE_ID, "manageFog", false);
  await model.patchFormation(onlyFormation().id, (rec) => {
    rec.members[0].roles = ["mapper"];
    rec.lights = [{ id: "l1", type: "torch", bearerId: alice.id, remaining: 6, lit: true, shielded: false }];
  });
  await drain();
  assert.ok(!onlyFormation().mapSession, "no session before combat (fog management off)");
  await game.settings.set(MODULE_ID, "manageFog", true);

  const combat = new CombatMock();
  globalThis.__combat = combat;
  game.combats.set(combat.id, combat);
  const stored = onlyFormation();
  await combat.createEmbeddedDocuments("Combatant", [
    { tokenId: stored.tokenId, sceneId: scene.id, actorId: stored.actorId, hidden: false },
  ]);
  await drain();

  const after = onlyFormation();
  assert.ok(after.combat?.active, "combat flag survived the concurrent map-session write");
  assert.equal(after.combat.combatId, combat.id, "combat id recorded");
  const deployed = after.members.filter((m) => m.deployedTokenId);
  assert.equal(deployed.length, 2, "both members deployed");
  for (const m of deployed) assert.ok(scene.tokens.get(m.deployedTokenId), "deployed token on scene");
  assert.equal(combat.combatants.contents.length, 2, "party combatant swapped for member combatants");
  assert.ok(scene.tokens.get(after.tokenId)?.hidden, "party token hidden during combat");
  assert.ok(!after.mapSession, "map session NOT open mid-combat (stale write declined or clobber-safe)");
});

await scenario("combat rounds tick the clock live", async () => {
  const before = onlyFormation().clock.roundsPartial ?? 0;
  await globalThis.__combat.setRound(2);
  await drain();
  const stored = onlyFormation();
  assert.equal(stored.combat.roundsCounted, 2, "rounds counted");
  assert.equal((stored.clock.roundsPartial ?? 0) - before, 2, "clock advanced 2 rounds");
});

await scenario("reform on combat end restores the party", async () => {
  await globalThis.__combat.delete();
  await drain();

  const stored = onlyFormation();
  assert.equal(stored.combat, null, "combat cleared");
  for (const m of stored.members) {
    assert.ok(!m.deployedTokenId, "deployedTokenId cleared");
    assert.ok(m.tokenData, "member token re-stashed");
  }
  const partyToken = scene.tokens.get(stored.tokenId);
  assert.ok(partyToken && !partyToken.hidden, "party token visible again");
  const strays = scene.tokens.filter((t) => t.actorId === alice.id || t.actorId === bob.id);
  assert.equal(strays.length, 0, "no member tokens left on the field");
  // With combat over, the deferred auto map session may now open legally.
  assert.ok(onlyFormation().mapSession, "map session opens once combat is over");
});

await scenario("a second combat deploys again (regroup round-trip)", async () => {
  const combat = new CombatMock();
  game.combats.set(combat.id, combat);
  const stored = onlyFormation();
  await combat.createEmbeddedDocuments("Combatant", [
    { tokenId: stored.tokenId, sceneId: scene.id, actorId: stored.actorId, hidden: false },
  ]);
  await drain();
  assert.ok(onlyFormation().combat?.active, "second deploy succeeded");
  assert.equal(onlyFormation().members.filter((m) => m.deployedTokenId).length, 2, "both redeployed");
  await combat.delete();
  await drain();
  assert.equal(onlyFormation().combat, null, "second reform succeeded");
});

await scenario("reform still fires if the combat flag was lost (evidence path)", async () => {
  const combat = new CombatMock();
  game.combats.set(combat.id, combat);
  const stored = onlyFormation();
  await combat.createEmbeddedDocuments("Combatant", [
    { tokenId: stored.tokenId, sceneId: scene.id, actorId: stored.actorId, hidden: false },
  ]);
  await drain();
  // Simulate the historical clobber: something erased the combat flag.
  await model.patchFormation(stored.id, (rec) => {
    rec.combat = null;
  });
  await combat.delete();
  await drain();
  const after = onlyFormation();
  for (const m of after.members) assert.ok(!m.deployedTokenId, "reform gathered deployed members anyway");
  assert.equal(
    scene.tokens.filter((t) => t.actorId === alice.id || t.actorId === bob.id).length,
    0,
    "no member tokens stranded",
  );
});

await scenario("detach sends one member out and recall brings them home", async () => {
  const before = onlyFormation();
  const alicePos = before.members.findIndex((m) => m.actorId === alice.id);

  assert.equal(await deployment.toggleDetachMember(before, alice.id), "detached");
  await drain();
  let stored = onlyFormation();
  let scout = stored.members[alicePos];
  assert.ok(scout.deployedTokenId, "the scout has a token of their own");
  assert.ok(scout.detached, "marked a detach, not a combat deploy");
  assert.ok(scout.detach?.anchor, "the leash is anchored where they stepped out");
  assert.ok(scene.tokens.get(scout.deployedTokenId), "token really on the scene");
  // The rest of the party stays inside the party token.
  assert.ok(!stored.members[alicePos === 0 ? 1 : 0].deployedTokenId, "only the scout went out");
  assert.ok(!scene.tokens.get(stored.tokenId)?.hidden, "party token stays visible — the party is still there");

  // Damage taken while out must come home with them.
  const scoutToken = scene.tokens.get(scout.deployedTokenId);
  scoutToken.actor.system.hp.value = 3;

  assert.equal(await deployment.toggleDetachMember(onlyFormation(), alice.id), "recalled");
  await drain();
  stored = onlyFormation();
  scout = stored.members[alicePos];
  assert.ok(!scout.deployedTokenId, "back inside the party token");
  assert.ok(!scout.detached && !scout.detach, "detach state cleared");
  assert.equal(scout.tokenData?.actorId ?? alice.id, alice.id, "token re-stashed");
  assert.equal(scene.tokens.filter((t) => t.actorId === alice.id).length, 0, "no stray token left behind");
});

await scenario("a detached scout does not block the party deploying for combat", async () => {
  // The scout ahead of the party is exactly who walks into a fight. Treating
  // their token as "already deployed" would leave everyone else inside the
  // party token for the whole battle.
  await deployment.toggleDetachMember(onlyFormation(), alice.id);
  await drain();

  const combat = new CombatMock();
  game.combats.set(combat.id, combat);
  const stored = onlyFormation();
  await combat.createEmbeddedDocuments("Combatant", [
    { tokenId: stored.tokenId, sceneId: scene.id, actorId: stored.actorId, hidden: false },
  ]);
  await drain();

  const after = onlyFormation();
  assert.ok(after.combat?.active, "the party deployed for combat");
  assert.equal(after.members.filter((m) => m.deployedTokenId).length, 2, "both members on the field");
  assert.ok(
    after.members.every((m) => !m.detached),
    "the fight takes over the scout: no leash during combat",
  );

  await combat.delete();
  await drain();
  assert.equal(onlyFormation().members.filter((m) => m.deployedTokenId).length, 0, "everyone reformed");
});

/**
 * Core's cross-scene move (`RegionDocument#teleportTokens`, a cut and paste
 * between scenes): the token is created on `to` under its own id, then the
 * original is deleted with `replacements`, the options as measured live.
 */
async function moveAcrossScenes(token, to, x, y) {
  const from = token.parent;
  const uuidOf = (t) => `Scene.${t.parent.id}.Token.${t.id}`;
  const [arrived] = await to.createEmbeddedDocuments("Token", [{ ...token.toObject(), x, y }], { keepId: true });
  uuidMap.set(uuidOf(arrived), arrived);
  await from.deleteEmbeddedDocuments("Token", [token.id], {
    action: "delete",
    documentName: "Token",
    parent: from,
    render: true,
    replacements: { [token.id]: uuidOf(arrived) },
  });
  uuidMap.delete(uuidOf(token));
  return arrived;
}

await scenario("a detached scout moved to another scene keeps their record, leash and stash", async () => {
  // See docs/formation/DECISIONS.md, "A member's own token follows core's
  // cross-scene move".
  const alicePos = onlyFormation().members.findIndex((m) => m.actorId === alice.id);
  assert.equal(await deployment.toggleDetachMember(onlyFormation(), alice.id), "detached");
  await drain();
  const out = scene.tokens.get(onlyFormation().members[alicePos].deployedTokenId);
  assert.equal(onlyFormation().members[alicePos].deployedSceneId, scene.id, "the detach records the scene");

  const farSide = new SceneMock("Far Side");
  const copy = new SceneMock("Far Side (Copy)");
  game.scenes.set(farSide.id, farSide);
  game.scenes.set(copy.id, copy);
  try {
    const arrived = await moveAcrossScenes(out, farSide, 300, 400);
    await drain();
    let scout = onlyFormation().members[alicePos];
    assert.equal(arrived.id, out.id, "the token arrived under its own id");
    assert.equal(scout.deployedSceneId, farSide.id, "the record names the scene it arrived on");
    assert.equal(scout.deployedTokenId, arrived.id, "and the token it arrived as");
    assert.ok(scout.detached, "still out on a detach");
    assert.deepEqual(scout.detach?.anchor, { x: 300, y: 400 }, "the leash measures from where they arrived");
    assert.equal(deployment.findDeployedMember(arrived)?.member.actorId, alice.id, "the leash finds them there");

    // A scene duplicated from the far side holds a token of the same id.
    const [twin] = await copy.createEmbeddedDocuments("Token", [arrived.toObject()], { keepId: true });
    assert.equal(deployment.findDeployedMember(twin), null, "the twin is no one's scout");

    // The scout steps on, and the party catches up on its own scene.
    await arrived.update({ x: 500, y: 400 });
    await deployment.reanchorDetached(onlyFormation().id);
    await drain();
    assert.deepEqual(onlyFormation().members[alicePos].detach?.anchor, { x: 500, y: 400 }, "re-anchored where the scout stands");

    assert.equal(await deployment.toggleDetachMember(onlyFormation(), alice.id), "recalled");
    await drain();
    scout = onlyFormation().members[alicePos];
    assert.ok(!scout.deployedTokenId && !scout.deployedSceneId, "back inside the party token");
    assert.equal(farSide.tokens.filter((t) => t.actorId === alice.id).length, 0, "no token left standing on the far side");
    assert.equal(copy.tokens.size, 1, "the twin was not taken");
    assert.equal(scout.tokenData?.x, 500, "the stash was taken from the far-side token");
  } finally {
    game.scenes.delete(farSide.id);
    game.scenes.delete(copy.id);
  }
});

await scenario("a member deployed before scenes were recorded follows a move off the party's scene", async () => {
  const alicePos = onlyFormation().members.findIndex((m) => m.actorId === alice.id);
  await deployment.toggleDetachMember(onlyFormation(), alice.id);
  await drain();
  // The record as a deploy wrote it before this shipped: a token id, no scene.
  await model.patchFormation(onlyFormation().id, (rec) => void delete rec.members[alicePos].deployedSceneId);
  const out = scene.tokens.get(onlyFormation().members[alicePos].deployedTokenId);
  const farSide = new SceneMock("Far Side");
  game.scenes.set(farSide.id, farSide);
  try {
    const arrived = await moveAcrossScenes(out, farSide, 300, 400);
    await drain();
    const scout = onlyFormation().members[alicePos];
    assert.equal(scout.deployedSceneId, farSide.id, "taken as standing on the party's scene, and followed");
    assert.equal(scout.deployedTokenId, arrived.id);
    await deployment.toggleDetachMember(onlyFormation(), alice.id);
    await drain();
    assert.equal(farSide.tokens.size, 0, "recalled from the far side");
  } finally {
    game.scenes.delete(farSide.id);
  }
});

await scenario("an unlinked member is down by their own token's hit points, stashed or deployed", async () => {
  const services = await import("../scripts/lib/services.mjs");
  const hireling = await ActorMock.create({
    name: "Hireling",
    type: "monster",
    system: { hp: { value: 10, max: 10 }, movementacks: { exploration: 120 }, movement: { base: 120 } },
  });
  await drain();
  // An unlinked token that took its wounds on the map; the world actor is whole.
  const [wounded] = await scene.createEmbeddedDocuments("Token", [
    { name: "Hireling", actorId: hireling.id, actorLink: false, x: 700, y: 500, delta: { system: { hp: { value: 0 } } } },
  ]);
  await model.addMember(model.getFormation(onlyFormation().id), hireling, wounded);
  await drain();
  let stored = onlyFormation();
  let m = stored.members.find((x) => x.actorId === hireling.id);
  assert.equal(m.tokenData?.actorLink, false, "stashed as an unlinked token");
  assert.equal(model.isDown(hireling), false, "the world actor alone reads as standing");
  assert.equal(model.isDown(hireling, m), true, "the member's own token says down");
  assert.equal(model.isCasualty(hireling, m), true, "a casualty the party must carry or leave");
  assert.equal(model.partySpeed(stored), 0, "so the column stops for them");

  // The roster hands a stashed unlinked member over with no document, and
  // writes their hit points into the stash.
  const roster = services.get("party-roster");
  const row = roster.members(stored.id).find((x) => x.actorId === hireling.id);
  assert.deepEqual([row.document, row.unlinked, row.stashed, row.hp?.value], [null, true, true, 0]);
  const done = await roster.adjustStashedHp(stored.id, hireling.id, (hp) => hp.value + 6);
  await drain();
  assert.deepEqual([done.before, done.after], [0, 6]);
  stored = onlyFormation();
  m = stored.members.find((x) => x.actorId === hireling.id);
  assert.equal(m.tokenData.delta.system.hp.value, 6, "written into the stashed token");
  assert.equal(hireling.system.hp.value, 10, "the world actor is untouched");
  assert.equal(model.isDown(hireling, m), false, "and the member stands again");

  // Deployed, the live token is theirs.
  assert.equal(await deployment.toggleDetachMember(stored, hireling.id), "detached");
  await drain();
  m = onlyFormation().members.find((x) => x.actorId === hireling.id);
  const live = scene.tokens.get(m.deployedTokenId);
  // Stands in for Foundry's synthetic actor, which this mock's tokens do not build.
  Object.defineProperty(live, "actor", { value: { system: { hp: { value: -2, max: 10 } }, statuses: new Set(["dead"]) } });
  assert.equal(model.isDown(hireling, m), true, "down by the live token");
  assert.equal(model.isDead(hireling, m), true, "and dead by its status");
  const deployedRow = roster.members(onlyFormation().id).find((x) => x.actorId === hireling.id);
  assert.equal(deployedRow.document, live.actor, "written through the live token's actor");
  assert.equal(await roster.adjustStashedHp(stored.id, hireling.id, () => 1), null, "a deployed member's stash is not written");

  // Recall them, and leave the party as it was.
  assert.equal(await deployment.toggleDetachMember(onlyFormation(), hireling.id), "recalled");
  await drain();
  await hireling.delete();
  await drain();
  assert.equal(onlyFormation().members.length, 2, "back to the two");
});

await scenario("a member stashed at full health takes a hit point change, and keeps it when placed again", async () => {
  const services = await import("../scripts/lib/services.mjs");
  const roster = services.get("party-roster");
  const porter = await ActorMock.create({
    name: "Porter",
    type: "monster",
    system: { hp: { value: 5, max: 5 }, movementacks: { exploration: 120 }, movement: { base: 120 } },
  });
  await drain();
  // A token that matches its actor: Foundry stashes its delta as null.
  const [whole] = await scene.createEmbeddedDocuments("Token", [
    { name: "Porter", actorId: porter.id, actorLink: false, x: 800, y: 500, delta: null },
  ]);
  await model.addMember(model.getFormation(onlyFormation().id), porter, whole);
  await drain();
  let m = onlyFormation().members.find((x) => x.actorId === porter.id);
  assert.equal(m.tokenData.delta, null, "stashed with no delta");
  const done = await roster.adjustStashedHp(onlyFormation().id, porter.id, (hp) => hp.value - 3);
  await drain();
  assert.deepEqual([done?.before, done?.after], [5, 2], "written through the null delta");
  m = onlyFormation().members.find((x) => x.actorId === porter.id);
  assert.equal(m.tokenData.delta.system.hp.value, 2);

  // The system rolls every placed unlinked monster new hit points; the
  // formation's own placement puts the member's back, through lib's hook.
  assert.equal(formationPreCreateHooks, 0, "the formation keeps no preCreateToken hook of its own");
  scene.rollMonsterHp = true;
  try {
    assert.equal(await deployment.toggleDetachMember(onlyFormation(), porter.id), "detached");
    const detachOptions = scene.lastCreateOptions;
    await drain();
    m = onlyFormation().members.find((x) => x.actorId === porter.id);
    const live = scene.tokens.get(m.deployedTokenId);
    assert.deepEqual(live.delta.system.hp, { value: 2, max: 5 }, "placed with the stash's hit points, not the roll");
    assert.equal(detachOptions?.[KEEP_HIT_POINTS_OPTION], true, "placed with lib's option");
    const [placed] = await scene.createEmbeddedDocuments("Token", [
      { name: "Porter", actorId: porter.id, actorLink: false, x: 900, y: 500 },
    ]);
    assert.deepEqual(placed.delta.system.hp, { value: 1, max: 1 }, "a monster the Judge places keeps the system's roll");
    await scene.deleteEmbeddedDocuments("Token", [placed.id]);
    assert.equal(await deployment.toggleDetachMember(onlyFormation(), porter.id), "recalled");
    await drain();
  } finally {
    scene.rollMonsterHp = false;
  }
  m = onlyFormation().members.find((x) => x.actorId === porter.id);
  assert.equal(m.tokenData.delta.system.hp.value, 2, "and recalled with them");

  // Leaving the party puts the stashed token back on the map the same way.
  scene.rollMonsterHp = true;
  try {
    await model.removeMember(model.getFormation(onlyFormation().id), porter.id);
    const restoreOptions = scene.lastCreateOptions;
    await drain();
    const restored = scene.tokens.find((t) => t.actorId === porter.id);
    assert.deepEqual(restored?.delta?.system?.hp, { value: 2, max: 5 }, "restored with the stash's hit points, not the roll");
    assert.equal(restoreOptions?.[KEEP_HIT_POINTS_OPTION], true, "restored with lib's option");
    await scene.deleteEmbeddedDocuments("Token", [restored.id]);
  } finally {
    scene.rollMonsterHp = false;
  }
  await porter.delete();
  await drain();
  assert.equal(onlyFormation().members.length, 2, "back to the two");
});

await scenario("deleting a member actor removes it from the formation", async () => {
  const charlie = await member("Charlie");
  await drain();
  let formation = model.getFormation(onlyFormation().id);
  await model.addMember(formation, charlie, null);
  await drain();
  assert.equal(onlyFormation().members.length, 3, "third member added");
  await charlie.delete();
  await drain();
  const stored = onlyFormation();
  assert.equal(stored.members.length, 2, "deleted member dropped from the formation");
});

await scenario("deleting the party actor dissolves the formation (no phantoms)", async () => {
  const stored = onlyFormation();
  const partyActor = game.actors.get(stored.actorId);
  await partyActor.delete();
  await drain();

  assert.equal(Object.keys(readFormations()).length, 0, "formation record deleted with its actor");
  assert.ok(!scene.tokens.get(stored.tokenId), "party token removed");
  const restored = scene.tokens.filter((t) => t.actorId === alice.id || t.actorId === bob.id);
  assert.equal(restored.length, 2, "stashed member tokens restored to the scene");
  assert.equal(game.actors.filter((a) => a.type === `${MODULE_ID}.party`).length, 0, "no phantom party actor");
});

await scenario("prune clears dead records and rescues their stashes", async () => {
  const all = readFormations();
  const ghost = {
    id: "ghost01",
    name: "Ghost Party",
    actorId: "act-deleted",
    sceneId: scene.id,
    tokenId: null,
    members: [
      {
        actorId: alice.id,
        roles: [],
        tokenData: { name: "Alice", actorId: alice.id, x: 900, y: 900, width: 1, height: 1, flags: {} },
      },
    ],
    lights: [],
    spells: [],
    clock: { turnsTotal: 0, turnsSinceRest: 0, encounterCounter: 0, carryFeet: 0, winded: false, paused: false },
  };
  all[ghost.id] = ghost;
  await game.settings.set(MODULE_ID, "formations", all);
  const aliceTokensBefore = scene.tokens.filter((t) => t.actorId === alice.id).length;

  await model.pruneFormations();
  await drain();

  assert.ok(!readFormations().ghost01, "dead record pruned");
  assert.equal(
    scene.tokens.filter((t) => t.actorId === alice.id).length,
    aliceTokensBefore + 1,
    "stashed token rescued from the dead record",
  );
});

await scenario("disband tears everything down", async () => {
  // Build a fresh party from the restored tokens, then disband it.
  const aliceToken = scene.tokens.find((t) => t.actorId === alice.id);
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Second Party");
  formation = await model.addMember(formation, alice, aliceToken);
  await drain();
  const stored = onlyFormation();
  await model.disband(model.getFormation(stored.id));
  await drain();

  assert.equal(Object.keys(readFormations()).length, 0, "record deleted");
  assert.ok(!game.actors.get(stored.actorId), "party actor deleted");
  assert.ok(scene.tokens.some((t) => t.actorId === alice.id), "member token restored");
});

await scenario("players steer their own members via the GM relay", async () => {
  const dave = await ActorMock.create({
    name: "Dave",
    type: "character",
    ownership: { default: 0, PL1: 3 },
    system: {
      hp: { value: 8, max: 8 },
      details: { level: 2 },
      movementacks: { exploration: 120 },
      movement: { base: 120 },
      encumbrance: { value: 4, max: 20 },
      scores: { str: { mod: 0 } },
      adventuring: { listening: 18, searching: 18, dungeonbashing: 18 },
    },
  });
  const eve = await member("Eve"); // GM-owned only
  // Dave carries the gear to light a lantern (require-enforcement default).
  await dave.createEmbeddedDocuments("Item", [
    { name: "Lantern", type: "item", system: {} },
    { name: "Flask of Oil", type: "item", system: { quantity: { value: 3 } } },
  ]);
  await drain();

  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Relay Party");
  formation = await model.addMember(formation, dave, null);
  await model.addMember(model.getFormation(formation.id), eve, null);
  await engine.addLight(model.getFormation(formation.id), "lantern", dave.id);
  await drain();
  const id = onlyFormation().id;
  assert.deepEqual(
    onlyFormation().members.map((m) => m.actorId),
    [dave.id, eve.id],
    "initial order",
  );

  const gmUser = game.user;
  game.user = game.users.get("PL1");
  try {
    // A PLAYER carries no Judge override: mapping needs the kit in hand, and
    // declaring the role without one is refused rather than granted.
    await requests.requestPartyAction(id, "role", { actorId: dave.id, role: "mapper" });
    await drain();
    assert.ok(
      !onlyFormation().members.find((m) => m.actorId === dave.id)?.roles?.includes("mapper"),
      "a player cannot map without a quill and parchment",
    );

    // A payload naming the GM as its sender buys nothing: the handler acts for
    // the sender socketlib attests, so the kit gate still refuses.
    await getSocket().executeAsGM("partyRequest", {
      formationId: id,
      type: "role",
      payload: { actorId: dave.id, role: "mapper" },
      requestUserId: game.users.activeGM.id,
    });
    await drain();
    assert.ok(
      !onlyFormation().members.find((m) => m.actorId === dave.id)?.roles?.includes("mapper"),
      "a forged GM id in the payload does not lift the kit gate",
    );

    // Own member, kit in the pack: role toggle and reorder land.
    await dave.createEmbeddedDocuments("Item", [
      { name: "Quill, writing", type: "item", system: {} },
      { name: "Parchment", type: "item", system: {} },
    ]);
    await drain();
    await requests.requestPartyAction(id, "role", { actorId: dave.id, role: "mapper" });
    await drain();
    assert.ok(
      onlyFormation().members.find((m) => m.actorId === dave.id)?.roles?.includes("mapper"),
      "player set a role on their own member",
    );
    await requests.requestPartyAction(id, "reorder", { actorId: dave.id, dir: "down" });
    await drain();
    assert.deepEqual(
      onlyFormation().members.map((m) => m.actorId),
      [eve.id, dave.id],
      "player moved their own member back a rank",
    );

    // Someone else's member: rejected server-side.
    await requests.requestPartyAction(id, "role", { actorId: eve.id, role: "scout" });
    await drain();
    assert.ok(
      !onlyFormation().members.find((m) => m.actorId === eve.id)?.roles?.length,
      "role on an unowned member is rejected",
    );
    await requests.requestPartyAction(id, "reorder", { actorId: eve.id, dir: "down" });
    await drain();
    assert.deepEqual(
      onlyFormation().members.map((m) => m.actorId),
      [eve.id, dave.id],
      "reorder of an unowned member is rejected",
    );

    // Light discipline on their own lantern.
    const lightId = onlyFormation().lights[0].id;
    await requests.requestPartyAction(id, "lightShield", { lightId });
    await drain();
    assert.ok(onlyFormation().lights[0].shielded, "player shuttered their own lantern");
    await requests.requestPartyAction(id, "lightToggle", { lightId });
    await drain();
    assert.ok(!onlyFormation().lights[0].lit, "player doused their own lantern");
  } finally {
    game.user = gmUser;
  }

  await model.disband(model.getFormation(id));
  await drain();
});

await scenario("leaving a member behind is the owner's declaration, refused otherwise and in combat", async () => {
  const owned = await ActorMock.create({
    name: "Ferris",
    type: "character",
    ownership: { default: 0, PL1: 3 },
    system: { hp: { value: 5, max: 5 }, details: { level: 1 }, movementacks: { exploration: 120 } },
  });
  const other = await member("Gale"); // GM-owned only
  await drain();

  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Leave Party");
  formation = await model.addMember(formation, owned, null);
  await model.addMember(model.getFormation(formation.id), other, null);
  await drain();
  const id = onlyFormation().id;
  const leftOf = (actor) => onlyFormation().members.find((m) => m.actorId === actor.id)?.left ?? false;

  const gmUser = game.user;
  game.user = game.users.get("PL1");
  try {
    await requests.requestPartyAction(id, "leftBehind", { actorId: other.id });
    await drain();
    assert.ok(!leftOf(other), "a member the seat does not own is not left behind");
    assert.ok(!leftOf(owned), "a refused request writes nothing to the others");

    await requests.requestPartyAction(id, "leftBehind", { actorId: "no-such-actor" });
    await drain();
    assert.ok(!leftOf(owned) && !leftOf(other), "a request naming no member writes nothing");

    await requests.requestPartyAction(id, "leftBehind", { actorId: owned.id });
    await drain();
    assert.equal(leftOf(owned), true, "the owner leaves their own character behind");
    await requests.requestPartyAction(id, "leftBehind", { actorId: owned.id });
    await drain();
    assert.equal(leftOf(owned), false, "the owner goes back for them");

    game.user = gmUser; // the combat flag is the Judge's write
    const inCombat = onlyFormation();
    inCombat.combat = { active: true, combatId: "stub" };
    await model.updateFormation(inCombat);
    await drain();
    game.user = game.users.get("PL1");
    await requests.requestPartyAction(id, "leftBehind", { actorId: owned.id });
    await drain();
    assert.equal(leftOf(owned), false, "a declaration during combat is refused");
  } finally {
    game.user = gmUser;
  }

  await model.disband(model.getFormation(id));
  await drain();
});

await scenario("a relayed payload carries the sender the server attested", async () => {
  const { runRelayed } = await import("../scripts/lib/sockets.mjs");
  const seen = [];
  const probe = (...args) => {
    seen.push(args);
    return "ran";
  };
  const player = game.users.get("PL1");
  const gm = game.users.activeGM;
  assert.equal(runRelayed(probe, player.id, [{ a: 1 }]), "ran");
  assert.deepEqual(seen.at(-1), [{ a: 1, requestUserId: player.id }], "an omitted id becomes the sender's");
  runRelayed(probe, player.id, [{ requestUserId: gm.id }]);
  assert.equal(seen.at(-1)[0].requestUserId, player.id, "a forged id is overwritten with the sender's");
  runRelayed(probe, gm.id, [{ requestUserId: player.id }]);
  assert.equal(seen.at(-1)[0].requestUserId, null, "a GM sender reads as null, the shape a GM's own dispatch passes");
  runRelayed(probe, player.id, ["scene1", 2]);
  assert.deepEqual(seen.at(-1), ["scene1", 2], "a non-object payload passes through untouched");
  const before = seen.length;
  assert.equal(runRelayed(probe, "nobody", [{}]), undefined);
  assert.equal(seen.length, before, "a sender the world does not know never reaches the handler");
});

await scenario("a player lights their own lamp from the character sheet", async () => {
  // The equipment sheet's Light / Douse / Shutter buttons hand every click to
  // declareLightAction, and THAT is what has to reach the GM relay: the light
  // record lives in a world setting a player may not write, so calling the
  // mutators from a player's client refuses the write and the button dies
  // silently. Exercised through the same public api object the sheet reads.
  const { declareLightAction } = await import("../scripts/equipment/sheet.mjs");

  const pat = await ActorMock.create({
    name: "Pat",
    type: "character",
    ownership: { default: 0, PL1: 3 },
    system: {
      hp: { value: 8, max: 8 },
      details: { level: 2 },
      movementacks: { exploration: 120 },
      movement: { base: 120 },
      encumbrance: { value: 4, max: 20 },
      scores: { str: { mod: 0 } },
      adventuring: { listening: 18, searching: 18, dungeonbashing: 18 },
    },
  });
  const quinn = await member("Quinn"); // GM-owned only
  await drain();

  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  await game.settings.set(MODULE_ID, "lightItemEnforcement", "require");
  let formation = await model.createFormation("Sheet Party");
  formation = await model.addMember(formation, pat, null);
  await model.addMember(model.getFormation(formation.id), quinn, null);
  await drain();
  const id = onlyFormation().id;

  // The grant API stands in for acks-equipment, which is what makes "no
  // override" PROVABLE: with it installed a Judge's click conjures the kit, so
  // a player's click conjuring nothing is the authority gate holding rather
  // than the grant simply being absent.
  globalThis.acksExtras.equipment = {
    spareHands: () => 2,
    async grantGear(actor, specs) {
      const missing = specs.filter((s) => !actor.items.some((i) => s.pattern.test(i.name)));
      if (!missing.length) return [];
      return actor.createEmbeddedDocuments(
        "Item",
        missing.map((s) => ({ name: s.name, type: "item", system: { quantity: { value: 1 } } })),
      );
    },
    async clearHands() {
      return { handsSpare: 2, released: [] };
    },
  };

  const gmUser = game.user;
  try {
    game.user = game.users.get("PL1");

    // Empty-handed, the declaration is gated exactly as it is from the party
    // sheet. This is the assertion that pins the authority: the request EXECUTES
    // on a GM client, so reading `game.user.isGM` there would hand the Judge's
    // override to every player at the table.
    await declareLightAction(pat, "light", { lightType: "lantern", bearerId: pat.id });
    await drain();
    assert.equal(onlyFormation().lights.length, 0, "a player without the gear is still refused");
    assert.equal(pat.items.contents.length, 0, "and no kit is conjured for them");

    // Lantern and oil bought and carried: the same click now lands.
    await pat.createEmbeddedDocuments("Item", [
      { name: "Lantern", type: "item", system: {} },
      { name: "Flask of Oil", type: "item", system: { quantity: { value: 2 } } },
    ]);
    await drain();
    await declareLightAction(pat, "light", { lightType: "lantern", bearerId: pat.id });
    await drain();
    assert.equal(onlyFormation().lights.length, 1, "the player's own lamp is lit through the relay");
    assert.equal(onlyFormation().lights[0].bearerId, pat.id, "lit for the sheet's own character");

    // The other two buttons on that same row.
    const lightId = onlyFormation().lights[0].id;
    await declareLightAction(pat, "lightShield", { lightId });
    await drain();
    assert.ok(onlyFormation().lights[0].shielded, "the player shuttered their own lantern");
    await declareLightAction(pat, "lightToggle", { lightId });
    await drain();
    assert.ok(!onlyFormation().lights[0].lit, "the player doused their own lantern");

    // Someone else's character, whatever the sheet asked for.
    await declareLightAction(quinn, "light", { lightType: "candle", bearerId: quinn.id });
    await drain();
    assert.equal(onlyFormation().lights.length, 1, "a light on an unowned member is rejected");
  } finally {
    game.user = gmUser;
  }

  // The Judge clicking the SAME control keeps the Judge's authority: the kit
  // appears rather than the click being refused.
  await declareLightAction(quinn, "light", { lightType: "torch", bearerId: quinn.id });
  await drain();
  assert.ok(onlyFormation().lights.some((l) => l.bearerId === quinn.id), "the Judge's own click lights");
  assert.ok(quinn.items.find((i) => /torch/i.test(i.name)), "and supplies what it takes to burn");

  delete globalThis.acksExtras.equipment;
  await model.disband(model.getFormation(id));
  await drain();
});

await scenario("a character in no formation lights their own lamp", async () => {
  // The lights of someone marching with nobody are their own — a flag on
  // their own actor — so this needs no formation, no GM and no relay.
  const { declareLightAction } = await import("../scripts/equipment/sheet.mjs");
  // The sheet reaches lib through the shared namespace, exactly as it does live.
  const lightLib = await import("../scripts/lib/light.mjs");
  globalThis.acksExtras.lib = { ...(globalThis.acksExtras.lib ?? {}), light: lightLib };

  const solo = await ActorMock.create({
    name: "Solo",
    type: "character",
    ownership: { default: 0, PL1: 3 },
    system: { hp: { value: 6, max: 6 }, details: { level: 1 }, encumbrance: { value: 2, max: 20 } },
  });
  await game.settings.set(MODULE_ID, "formations", {}); // nobody is in a formation
  await game.settings.set(MODULE_ID, "lightItemEnforcement", "require");
  await drain();

  const gmUser = game.user;
  try {
    game.user = game.users.get("PL1");

    // The gear rule bites here exactly as it does in a formation: same check,
    // one implementation, whichever record ends up holding the flame.
    await declareLightAction(solo, "light", { lightType: "lantern", bearerId: solo.id });
    await drain();
    assert.equal(lightLib.bearerLights(solo).length, 0, "no gear, no light, formation or not");

    await solo.createEmbeddedDocuments("Item", [
      { name: "Lantern", type: "item", system: {} },
      { name: "Flask of Oil", type: "item", system: { quantity: { value: 2 } } },
    ]);
    await drain();
    await declareLightAction(solo, "light", { lightType: "lantern", bearerId: solo.id });
    await drain();

    const lights = lightLib.bearerLights(solo);
    assert.equal(lights.length, 1, "a lone character lights their own lantern");
    assert.ok(lights[0].lit, "and it is burning");
    assert.equal(
      solo.items.find((i) => /oil/i.test(i.name)).system.quantity.value,
      1,
      "striking it burns a flask of oil, the same as it would in a party",
    );
    assert.deepEqual(lightLib.emittedLight(lights), { bright: 15, dim: 30 }, "the token sheds a lantern's light");

    // The other two buttons on that same row, with nobody's permission needed.
    const lightId = lights[0].id;
    await declareLightAction(solo, "lightShield", { lightId });
    await drain();
    assert.ok(lightLib.bearerLights(solo)[0].shielded, "the shutter closes");
    assert.deepEqual(
      lightLib.emittedLight(lightLib.bearerLights(solo)),
      { bright: 0, dim: 0 },
      "a shuttered lantern sheds nothing though it keeps burning",
    );
    await declareLightAction(solo, "lightToggle", { lightId });
    await drain();
    assert.ok(!lightLib.bearerLights(solo)[0].lit, "and it can be doused");
  } finally {
    game.user = gmUser;
  }
});

await scenario("light-source equipment enforcement (require / warn / consume)", async () => {
  const noKit = await member("Nolan"); // carries nothing
  const withKit = await member("Wanda");
  // A torch carried as a WEAPON (a 1d4 light-weapon, no quantity field) still
  // satisfies the torch requirement but is NOT decremented — it is one wielded
  // torch that burns out on its timer. A lantern needs the device plus a flask
  // of oil, and the OIL (a real stack) is what gets consumed.
  await withKit.createEmbeddedDocuments("Item", [
    { name: "Torch", type: "weapon", system: {} },
    { name: "Lantern", type: "item", system: {} },
    { name: "Flask of Oil", type: "item", system: { quantity: { value: 1 } } },
  ]);
  await drain();

  let formation = await model.createFormation("Delvers");
  formation = await model.addMember(formation, noKit, null);
  await model.addMember(model.getFormation(formation.id), withKit, null);
  const id = onlyFormation().id;

  // require (default): no torch in inventory → lighting is blocked.
  await game.settings.set(MODULE_ID, "lightItemEnforcement", "require");
  await engine.addLight(model.getFormation(id), "torch", noKit.id);
  await drain();
  assert.equal(onlyFormation().lights.length, 0, "require blocks lighting without a torch");

  // require: a weapon-torch satisfies it (it lights) and is not consumed.
  await engine.addLight(model.getFormation(id), "torch", withKit.id);
  await drain();
  assert.equal(onlyFormation().lights.length, 1, "a weapon-torch satisfies the torch requirement");
  assert.ok(
    withKit.items.find((i) => /torch/i.test(i.name)),
    "a single wielded torch is not consumed on lighting",
  );

  // lantern: needs the lantern AND oil; the OIL is consumed, the lantern is not.
  await engine.addLight(model.getFormation(id), "lantern", withKit.id);
  await drain();
  assert.equal(
    withKit.items.find((i) => /oil/i.test(i.name)).system.quantity.value,
    0,
    "lighting a lantern consumes a flask of oil",
  );
  assert.ok(withKit.items.find((i) => /lantern/i.test(i.name)), "the lantern itself is not consumed");

  // warn: no gear → a warning is issued but the light is still lit.
  await game.settings.set(MODULE_ID, "lightItemEnforcement", "warn");
  await engine.addLight(model.getFormation(id), "candle", noKit.id);
  await drain();
  assert.ok(
    onlyFormation().lights.some((l) => l.type === "candle"),
    "warn lets a light be lit without the item",
  );

  await game.settings.set(MODULE_ID, "lightItemEnforcement", "require");
  await model.disband(model.getFormation(id));
  await drain();
});

await scenario("template renders live controls for a member-owner", async () => {
  const { default: Handlebars } = await import("handlebars");
  const fs = await import("node:fs");
  Handlebars.registerHelper("localize", (k) => String(k));
  // The sheet is one form split across tab parts, so a test that asks what the
  // WHOLE sheet renders has to compile the parts it asserts on and join them,
  // exactly as the sheet does. Order carries the marching order; Kit carries
  // the maps section.
  const part = (name) =>
    Handlebars.compile(fs.readFileSync(`templates/formation/formation-tab-${name}.hbs`, "utf8"));
  const parts = [part("order"), part("kit")];
  const template = (ctx) => parts.map((render) => render(ctx)).join("\n");
  const view = await import("../scripts/formation/formation-view.mjs");
  const partyActorModule = await import("../scripts/formation/party-actor.mjs");

  const dave = await ActorMock.create({
    name: "Dave2",
    type: "character",
    ownership: { default: 0, PL1: 3 },
    system: {
      hp: { value: 8, max: 8 },
      details: { level: 2 },
      movementacks: { exploration: 120 },
      movement: { base: 120 },
      encumbrance: { value: 4, max: 20 },
      scores: { str: { mod: 0 } },
      adventuring: { listening: 18, searching: 18, dungeonbashing: 18 },
    },
  });
  const eve = await member("Eve2"); // GM-owned only
  await drain();
  // A canvas token so addMember runs the full path (party actor + token).
  const [dave2Token] = await scene.createEmbeddedDocuments("Token", [
    { name: "Dave2", actorId: dave.id, x: 800, y: 800 },
  ]);
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Render Party");
  formation = await model.addMember(formation, dave, dave2Token);
  await model.addMember(model.getFormation(formation.id), eve, null);
  await drain();
  formation = model.getFormation(onlyFormation().id);
  assert.ok(formation.actorId, "party actor exists for the sheet");

  const gmUser = game.user;
  game.user = game.users.get("PL1");
  let html;
  try {
    const ctx = { isGM: false, formation, ...view.buildFormationView(formation), ...view.buildPlayerPanel(formation) };
    html = template(ctx);
  } finally {
    game.user = gmUser;
  }

  const chipStates = (segment) =>
    [...segment.matchAll(/<button[^>]*data-action="toggleRole"[^>]*>/g)].map((m) => / disabled/.test(m[0]));
  const seg = (actorId) => {
    const start = html.indexOf(`data-actor-id="${actorId}"`);
    assert.ok(start >= 0, `member ${actorId} rendered`);
    const end = html.indexOf("</li>", start);
    return html.slice(start, end);
  };

  const daveSeg = seg(dave.id);
  const daveChips = chipStates(daveSeg);
  assert.ok(daveChips.length > 0, "role chips rendered for owned member");
  assert.ok(daveChips.every((disabled) => !disabled), "owned member's role chips are ENABLED for the player");
  assert.ok(daveSeg.includes('data-action="memberUp"'), "owned member has reorder controls");
  assert.ok(!daveSeg.includes('data-action="removeMember"'), "remove stays GM-only");

  const eveChips = chipStates(seg(eve.id));
  assert.ok(eveChips.length > 0 && eveChips.every(Boolean), "unowned member's role chips are disabled");

  assert.ok(html.includes("ACKS-FORMATION.map.section"), "maps section renders for players");
  assert.ok(!html.includes("distorted"), "no distortion tell in a player render");
  assert.ok(!html.includes('data-action="advanceTurn"'), "GM clock buttons absent for players");

  // The sheet itself must be live for a member-owner despite Observer-only
  // party-actor ownership (Foundry disables ALL controls otherwise).
  const partyActor = game.actors.get(formation.actorId);
  const sheet = new partyActorModule.PartySheet({ document: partyActor });
  game.user = game.users.get("PL1");
  try {
    assert.ok(sheet.isEditable, "member-owner's sheet is editable");
  } finally {
    game.user = gmUser;
  }

  await model.disband(model.getFormation(formation.id));
  await drain();
});

await scenario("turn + light state survive the equipment feedback loop", async () => {
  // Reproduces the live break: acks-equipment listens to acksExtras.formation.
  // lightChanged and refreshes the bearer's loadout (an actor update). That
  // fires acks-formation's own updateActor hook, which calls
  // syncPartyActorSpeed with a formation copy read BEFORE the turn's writes.
  // If that path writes the whole stale record, it reverts the turn clock and
  // the light burn-down that just happened.
  const torchBearer = await member("Torchy");
  await drain();
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Loop Party");
  formation = await model.addMember(formation, torchBearer, null);
  await drain();
  const id = onlyFormation().id;

  await game.settings.set(MODULE_ID, "lightItemEnforcement", "off");
  await engine.addLight(model.getFormation(id), "torch", torchBearer.id);
  await drain();
  assert.equal(onlyFormation().lights.length, 1, "torch lit");

  // Stand in for acks-equipment's listener: a light change updates the actor.
  const equipmentListener = (actor) => {
    if (actor) actor.update({ "system.loadoutStamp": (actor.system.loadoutStamp ?? 0) + 1 });
  };
  Hooks.on("acksExtras.lightChanged", equipmentListener);
  try {
    const before = onlyFormation();
    const turnsBefore = before.clock.turnsTotal;
    const remainingBefore = before.lights[0].remaining;

    await engine.advanceTurns(model.getFormation(id), 1, { reason: "manual" });
    await drain(); // let every hook chain settle, including the late writers

    const after = onlyFormation();
    assert.equal(after.clock.turnsTotal, turnsBefore + 1, "turn clock advanced AND STAYED advanced");
    assert.equal(after.lights[0].remaining, remainingBefore - 1, "light burn-down persisted");
  } finally {
    const arr = hooks.get("acksExtras.lightChanged") ?? [];
    const i = arr.indexOf(equipmentListener);
    if (i >= 0) arr.splice(i, 1);
  }

  await model.disband(model.getFormation(id));
  await drain();
});

await scenario("lighting works with acks-equipment installed (hand accounting)", async () => {
  const hero = await member("Handy");
  await drain();
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Equip Party");
  formation = await model.addMember(formation, hero, null);
  await drain();
  const id = onlyFormation().id;
  await game.settings.set(MODULE_ID, "lightItemEnforcement", "require");
  await hero.createEmbeddedDocuments("Item", [
    { name: "Torch", type: "item", system: { quantity: { value: 10 } } },
  ]);

  // Stand in for acks-equipment 0.31: hands = 2 budget, minus equipped
  // weapons/shields, minus lights already held (its heldLightHands read half).
  globalThis.acksExtras.equipment = {
    freeHands: (actor) => {
      const held = globalThis.acksExtras.formation?.heldLightCount?.(actor?.id) ?? 0;
      const gear = actor?.system?.__handsUsed ?? 0;
      return Math.max(0, 2 - gear - held);
    },
  };
  try {
    // A hero with both hands full (sword + shield) — the common ACKS loadout.
    hero.system.__handsUsed = 2;
    await engine.addLight(model.getFormation(id), "torch", hero.id);
    await drain();
    const blocked = onlyFormation().lights.length;

    // Free a hand and try again.
    hero.system.__handsUsed = 1;
    await engine.addLight(model.getFormation(id), "torch", hero.id);
    await drain();
    const allowed = onlyFormation().lights.length;

    console.log(`      [probe] hands-full lit=${blocked}, one-hand-free lit=${allowed}`);
    // Blocking with no free hand is INTENDED: a light is held in hand, and
    // acks-equipment's own draw/sheathe controls are where a hand is freed.
    assert.equal(blocked, 0, "no free hand blocks lighting (by design)");
    assert.ok(
      notices.some(([lvl, m]) => lvl === "warn" && /noFreeHand/i.test(String(m))),
      "a no-free-hand warning was surfaced",
    );
    assert.equal(allowed, 1, "a free hand lights");

    // A companion module throwing must never break a core mutation: an
    // unreadable hand count means NO CHECK, not a refusal.
    globalThis.acksExtras.equipment.freeHands = () => {
      throw new Error("equipment exploded");
    };
    hero.system.__handsUsed = 2;
    await engine.addLight(model.getFormation(id), "torch", hero.id);
    await drain();
    assert.equal(onlyFormation().lights.length, 2, "lighting survives an equipment exception");
  } finally {
    delete globalThis.acksExtras.equipment;
  }
  await model.disband(model.getFormation(id));
  await drain();
});

await scenario("the Judge's override supplies gear and empties a hand", async () => {
  const pauper = await member("Pauper"); // owns nothing, both hands full
  await drain();
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Override Party");
  formation = await model.addMember(formation, pauper, null);
  await drain();
  const id = onlyFormation().id;
  await game.settings.set(MODULE_ID, "lightItemEnforcement", "require");
  pauper.system.__handsUsed = 2;

  // Stand in for acks-equipment's grant API: create what is missing, and put
  // held gear away until there is room. Faithful enough to prove the formation
  // side calls both, with the right specs, BEFORE it tests anything.
  const spare = (actor) =>
    Math.max(0, 2 - (actor.system.__handsUsed ?? 0) - (globalThis.acksExtras.formation?.handsOccupied?.(actor.id).total ?? 0));
  globalThis.acksExtras.equipment = {
    spareHands: spare,
    async grantGear(actor, specs) {
      const missing = specs.filter((s) => !actor.items.some((i) => s.pattern.test(i.name)));
      if (!missing.length) return [];
      return actor.createEmbeddedDocuments(
        "Item",
        missing.map((s) => ({ name: s.name, type: "item", system: { quantity: { value: 1 } } })),
      );
    },
    async clearHands(actor, needed) {
      const released = [];
      while (spare(actor) < needed && (actor.system.__handsUsed ?? 0) > 0) {
        actor.system.__handsUsed -= 1;
        released.push({ name: "Shield" });
      }
      return { handsSpare: spare(actor), released };
    },
  };

  try {
    // WITHOUT the override — the player path — nothing is conjured and the
    // refusal stands, gear and hands both.
    await engine.addLight(model.getFormation(id), "torch", pauper.id);
    await drain();
    assert.equal(onlyFormation().lights.length, 0, "a player declaration is still gated");
    assert.equal(pauper.items.contents.length, 0, "no gear appears without the Judge's authority");

    // WITH it, the same call lands: the torches arrive and a hand is emptied.
    await engine.addLight(model.getFormation(id), "torch", pauper.id, { override: true });
    await drain();
    assert.equal(onlyFormation().lights.length, 1, "the Judge's light is lit");
    assert.ok(pauper.items.find((i) => /torch/i.test(i.name)), "the torches were supplied");
    assert.equal(pauper.system.__handsUsed, 1, "a hand was emptied to hold it");

    // A lantern needs BOTH halves of its kit — the lamp and a flask of oil.
    await engine.addLight(model.getFormation(id), "lantern", pauper.id, { override: true });
    await drain();
    assert.ok(pauper.items.find((i) => /^lantern$/i.test(i.name)), "the lantern was supplied");
    assert.ok(pauper.items.find((i) => /oil/i.test(i.name)), "so was its oil");

    // The mapper's kit: supplied the same way, and it fills BOTH hands.
    await model.toggleRole(model.getFormation(id), pauper.id, "mapper", { override: true });
    await drain();
    assert.ok(
      onlyFormation().members.find((m) => m.actorId === pauper.id)?.roles?.includes("mapper"),
      "the Judge put them on the map",
    );
    assert.ok(pauper.items.find((i) => /quill/i.test(i.name)), "a quill was supplied");
    assert.ok(pauper.items.find((i) => /parchment/i.test(i.name)), "so was parchment");
    assert.equal(model.handsOccupied(pauper.id).mapping, 2, "mapping occupies both hands");

    // Setting the role down gives the hands back.
    await model.toggleRole(model.getFormation(id), pauper.id, "mapper");
    await drain();
    assert.equal(model.handsOccupied(pauper.id).mapping, 0, "hands come back when the role is set down");
  } finally {
    delete globalThis.acksExtras.equipment;
  }

  await model.disband(model.getFormation(id));
  await drain();
});

await scenario("winded markers apply and clear across the rest cycle", async () => {
  const walker = await member("Walker");
  await drain();
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Winded Party");
  formation = await model.addMember(formation, walker, null);
  await drain();
  const id = onlyFormation().id;

  // The rest cadence is a printed figure, so the module ships without one and
  // asks for no rest until a world imports it. The test supplies its own, which
  // is what a reader's book does — the number below is this scenario's premise,
  // not a claim about any page.
  const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
  registerTable({ id: "formation", tables: { restInterval: 3 } }, { priority: PRIORITY.WORLD });

  // Four turns without rest cross the registered interval and set winded.
  await engine.advanceTurns(model.getFormation(id), 4, { reason: "manual" });
  await drain();
  assert.ok(onlyFormation().clock.winded, "party is winded after 4 turns without rest");
  assert.ok(
    walker.effects.some((e) => e.getFlag(MODULE_ID, "winded")),
    "Winded active effect applied to the member",
  );

  // A rest turn clears it, on the record and on the actor.
  await engine.advanceTurns(model.getFormation(id), 1, { resting: true });
  await drain();
  assert.ok(!onlyFormation().clock.winded, "rest clears the winded flag");
  assert.ok(
    !walker.effects.some((e) => e.getFlag(MODULE_ID, "winded")),
    "Winded active effect removed on rest",
  );

  unregisterTable("formation", { priority: PRIORITY.WORLD });
  await model.disband(model.getFormation(id));
  await drain();
});

await scenario("moving the party token advances the clock", async () => {
  const runner = await member("Runner");
  await drain();
  const [rToken] = await scene.createEmbeddedDocuments("Token", [
    { name: "Runner", actorId: runner.id, x: 1000, y: 1000 },
  ]);
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Move Party");
  formation = await model.addMember(formation, runner, rToken);
  await drain();
  const id = onlyFormation().id;
  const partyToken = scene.tokens.get(onlyFormation().tokenId);
  assert.ok(partyToken, "party token placed");

  const speed = onlyFormation() && model.partySpeed(model.getFormation(id));
  console.log(`      [probe] party speed = ${speed}'/turn`);
  assert.ok(speed > 0, "party has a usable exploration speed");

  const before = onlyFormation().clock;
  const roundsBefore = (before.turnsTotal * 10) + (before.roundsPartial ?? 0);

  // Drag one full exploration move (speed feet) → should be a whole turn.
  const gs = scene.grid.size;
  const squares = Math.round(speed / scene.grid.distance);
  game.time.advanced.length = 0; // count only this drag's world-clock writes
  await partyToken.update({ x: partyToken.x + squares * gs });
  await drain();

  const after = onlyFormation().clock;
  const roundsAfter = (after.turnsTotal * 10) + (after.roundsPartial ?? 0);
  console.log(`      [probe] rounds ${roundsBefore} -> ${roundsAfter}`);
  assert.ok(roundsAfter > roundsBefore, "movement advanced the dungeon clock");

  // The dungeon clock is the module's own; the Foundry world clock is the
  // shared one, written only through lib's gate. A minute per round.
  const worldSeconds = game.time.advanced.reduce((a, b) => a + b, 0);
  console.log(`      [probe] world clock +${worldSeconds}s`);
  assert.equal(worldSeconds, (roundsAfter - roundsBefore) * 60, "world clock moved a minute per round");

  await model.disband(model.getFormation(id));
  await drain();
});

await scenario("a move the primary GM's client is drawing is billed, and trap-checked, where it put the party", async () => {
  // See docs/formation/DECISIONS.md, "A drawn party token is measured where
  // its move put it".
  const walker = await member("Drawn");
  await drain();
  const [wToken] = await scene.createEmbeddedDocuments("Token", [
    { name: "Drawn", actorId: walker.id, x: 1000, y: 1000 },
  ]);
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Drawn Party");
  formation = await model.addMember(formation, walker, wToken);
  await drain();
  const id = onlyFormation().id;
  const partyToken = scene.tokens.get(onlyFormation().tokenId);
  assert.ok(partyToken, "party token placed");

  const speed = model.partySpeed(model.getFormation(id));
  const gs = scene.grid.size;
  const squares = Math.round(speed / scene.grid.distance);
  const turnFeet = squares * scene.grid.distance;
  const roundsFor = (feet) => Math.floor((feet * 10) / speed);
  const start = { x: partyToken.x, y: partyToken.y };
  const end = { x: start.x + squares * gs, y: start.y };
  const roundsOf = (c) => c.turnsTotal * 10 + (c.roundsPartial ?? 0);
  const roundsBefore = roundsOf(onlyFormation().clock);

  // An armed trap wall across the middle of the move. The trap check meets a
  // wall by crossing it, so it asks for the wall's trap only when the path it
  // is handed spans the wall; the trap answers nothing, and the check ends.
  const trapUuid = "Item.drawnMoveTrap";
  const cx = start.x + (partyToken.width * gs) / 2 + (squares * gs) / 2;
  const cy = start.y + (partyToken.height * gs) / 2;
  const wall = {
    id: "drawnMoveWall",
    uuid: `Scene.${scene.id}.Wall.drawnMoveWall`,
    c: [cx, cy - 2 * gs, cx, cy + 2 * gs],
    flags: { [MODULE_ID]: { trap: { trapUuid, state: "armed" } } },
  };
  const asked = [];
  const lookUp = globalThis.fromUuid;
  globalThis.fromUuid = async (u) => {
    if (u === trapUuid) asked.push(u);
    return lookUp(u);
  };
  scene.walls = [wall];
  try {
    // The primary GM is viewing the scene, so its client draws the move.
    partyToken.rendered = true;
    await partyToken.update({ x: end.x });
    await drain();
    assert.deepEqual({ x: partyToken.x, y: partyToken.y }, start, "the drawing still stands where the move began");

    const clock = onlyFormation().clock;
    console.log(`      [probe] rounds ${roundsBefore} -> ${roundsOf(clock)} while the move is drawn`);
    assert.equal(roundsOf(clock) - roundsBefore, roundsFor(turnFeet), "the move is billed while it is drawn");
    assert.deepEqual(clock.lastPosition, end, "and the next move is measured from where this one put the party");
    assert.ok(asked.length > 0, "the trap check was handed the path the move walked, across the wall");

    // The tween lands, and the next move bills its own distance and no more.
    partyToken.endTween();
    scene.walls = [];
    await partyToken.update({ x: end.x + squares * gs });
    await drain();
    partyToken.endTween();
    assert.equal(roundsOf(onlyFormation().clock) - roundsBefore, roundsFor(2 * turnFeet), "two moves, each billed once");
  } finally {
    globalThis.fromUuid = lookUp;
    delete scene.walls;
    partyToken.endTween();
    partyToken.rendered = false;
  }

  await model.disband(model.getFormation(id));
  await drain();
});

/**
 * A formation of one walker on `on`, its party token drawn by this client
 * (`rendered`), as the primary GM's client draws it while viewing the scene.
 * @returns {Promise<{id: string, walker: object, partyToken: TokenMock,
 *   step: number, turnRounds: number}>} `step` is one exploration move in
 *   pixels, `turnRounds` what the clock bills for it.
 */
async function drawnParty(name, on = scene) {
  const walker = await member(name);
  await drain();
  const [own] = await on.createEmbeddedDocuments("Token", [{ name, actorId: walker.id, x: 1000, y: 1000 }]);
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation(`${name} Party`);
  formation = await model.addMember(formation, walker, own);
  await drain();
  const id = onlyFormation().id;
  const partyToken = on.tokens.get(onlyFormation().tokenId);
  assert.ok(partyToken, "party token placed");
  partyToken.rendered = true;
  const speed = model.partySpeed(model.getFormation(id));
  const squares = Math.round(speed / on.grid.distance);
  return { id, walker, partyToken, step: squares * on.grid.size, turnRounds: Math.floor((squares * on.grid.distance * 10) / speed) };
}

/** Land the drawn move, stop drawing, and disband. */
async function dismissDrawn({ id, partyToken }) {
  partyToken.endTween();
  partyToken.rendered = false;
  const formation = model.getFormation(id);
  if (formation) await model.disband(formation);
  await drain();
}

const clockRounds = (clock) => clock.turnsTotal * 10 + (clock.roundsPartial ?? 0);

await scenario("the Judge's un-pause re-anchors the clock where a drawn move put the party", async () => {
  // See docs/formation/DECISIONS.md, "A re-anchor reads the party token's
  // stored corner". The move made while paused is not billed after it.
  const { SHARED_ACTIONS } = await import("../scripts/formation/formation-actions.mjs");
  const party = await drawnParty("Paused");
  const { id, partyToken, step } = party;
  // The party sheet's own action, on the sheet's copy of the record.
  const togglePause = () => SHARED_ACTIONS.togglePause.call({ formation: model.getFormation(id), render() {} });
  try {
    await togglePause();
    await drain();
    assert.equal(onlyFormation().clock.paused, true, "the Judge paused the clock");
    const start = { x: partyToken.x, y: partyToken.y };
    const end = { x: start.x + step, y: start.y };
    const before = clockRounds(onlyFormation().clock);
    await partyToken.update({ x: end.x });
    await drain();
    assert.deepEqual({ x: partyToken.x, y: partyToken.y }, start, "the drawing still stands where the move began");

    await togglePause();
    await drain();
    const clock = onlyFormation().clock;
    assert.equal(clock.paused, false, "and un-paused it while the move was drawn");
    assert.deepEqual(clock.lastPosition, end, "the clock is re-anchored where the move put the party");

    partyToken.endTween();
    await partyToken.update({ x: end.x + step });
    await drain();
    assert.equal(clockRounds(onlyFormation().clock) - before, party.turnRounds, "only the move after the pause is billed");
  } finally {
    await dismissDrawn(party);
  }
});

await scenario("a form-up with no one to gather on the party's scene re-anchors where a drawn move put the party", async () => {
  // See docs/formation/DECISIONS.md, "A re-anchor reads the party token's
  // stored corner". With no body to re-form on, the party re-forms where its
  // token stands.
  const { captureOrder, formUp } = await import("../scripts/formation/marching-templates.mjs");
  const party = await drawnParty("Gathered");
  const { id, walker, partyToken, step } = party;
  try {
    assert.equal(await deployment.toggleDetachMember(model.getFormation(id), walker.id), "detached");
    await drain();
    const scout = onlyFormation().members.find((m) => m.actorId === walker.id);
    await scene.deleteEmbeddedDocuments("Token", [scout.deployedTokenId]);
    await drain();

    const end = { x: partyToken.x + step, y: partyToken.y };
    await partyToken.update({ x: end.x });
    await drain();
    const formation = model.getFormation(id);
    const result = await formUp(formation, captureOrder(formation));
    await drain();
    assert.equal(result?.recalled, 1, "the scout was gathered in");
    assert.deepEqual(onlyFormation().clock.lastPosition, end, "the clock is re-anchored where the move put the party");
  } finally {
    await dismissDrawn(party);
  }
});

await scenario("a combat that ends with no one to gather re-anchors where a drawn move put the party", async () => {
  // See docs/formation/DECISIONS.md, "A re-anchor reads the party token's
  // stored corner". A move of the party token during the fight is not billed,
  // and the party re-forms where the token stands.
  const party = await drawnParty("Fought");
  const { walker, partyToken, step } = party;
  const combat = new CombatMock();
  game.combats.set(combat.id, combat);
  try {
    await combat.createEmbeddedDocuments("Combatant", [
      { tokenId: partyToken.id, sceneId: scene.id, actorId: onlyFormation().actorId, hidden: false },
    ]);
    await drain();
    const fighter = onlyFormation().members.find((m) => m.actorId === walker.id);
    assert.ok(onlyFormation().combat?.active && fighter.deployedTokenId, "the party deployed for the fight");
    await scene.deleteEmbeddedDocuments("Token", [fighter.deployedTokenId]);
    await drain();

    const end = { x: partyToken.x + step, y: partyToken.y };
    await partyToken.update({ x: end.x });
    await drain();
    await combat.delete();
    await drain();
    assert.equal(onlyFormation().combat, null, "the party re-formed");
    assert.deepEqual(onlyFormation().clock.lastPosition, end, "the clock is re-anchored where the move put the party");
  } finally {
    game.combats.delete(combat.id);
    await dismissDrawn(party);
  }
});

await scenario("a hop to the place the party already stands on re-anchors where the drawn move put it", async () => {
  // See docs/formation/DECISIONS.md, "A re-anchor reads the party token's
  // stored corner". The hop's own write changes nothing, so core drops it and
  // the move that brought the party there is still being drawn.
  const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
  const { SETTLEMENT_DOC, SETTLEMENT_PACES } = await import("../scripts/formation/settlement.mjs");
  const { DISTRICT_TYPE } = await import("../scripts/formation/district-find.mjs");
  const { LOCATION_TYPE } = await import("../scripts/location/constants.mjs");
  const { travelToPlace } = await import("../scripts/formation/poi.mjs");
  // Invented figure: a hop inside one quarter costs nothing, at any pace.
  const free = Object.fromEntries(Object.keys(SETTLEMENT_PACES).map((pace) => [pace, 0]));
  registerTable(
    { id: SETTLEMENT_DOC, source: "invented", tables: { districtTravel: { same: free } } },
    { priority: PRIORITY.WORLD, source: "test" },
  );
  const quarter = new SceneMock("Quarter");
  game.scenes.set(quarter.id, quarter);
  const party = await drawnParty("Hopping", quarter);
  const { id, partyToken, step } = party;
  const inn = await ActorMock.create({ name: "Inn", type: LOCATION_TYPE });
  try {
    // One quarter under the whole map, drawn after the party arrived, so the
    // arrival adopted nothing from it.
    quarter.regions.set("quarter", { id: "quarter", behaviors: [{ type: DISTRICT_TYPE, disabled: false }], testPoint: () => true });
    const gs = quarter.grid.size;
    const [place] = await quarter.createEmbeddedDocuments("Token", [
      { name: "Inn", actorId: inn.id, x: partyToken.x + step, y: partyToken.y },
    ]);
    const hop = {
      x: Math.round(place.x + (place.width * gs) / 2 - (partyToken.width * gs) / 2),
      y: Math.round(place.y + (place.height * gs) / 2 - (partyToken.height * gs) / 2),
    };
    const start = { x: partyToken.x, y: partyToken.y };
    await partyToken.update({ x: hop.x, y: hop.y });
    await drain();
    assert.deepEqual({ x: partyToken.x, y: partyToken.y }, start, "the drawing still stands where the move began");

    const result = await travelToPlace(id, place.id);
    await drain();
    assert.equal(result.moved, true, `the hop was made (${result.reason ?? "no refusal"})`);
    assert.deepEqual(onlyFormation().clock.lastPosition, hop, "the clock is re-anchored where the party stands");
  } finally {
    unregisterTable(SETTLEMENT_DOC, { priority: PRIORITY.WORLD });
    await dismissDrawn(party);
    game.actors.delete(inn.id);
    game.scenes.delete(quarter.id);
  }
});

await scenario("turning the party pivots it on the spot and costs no movement", async () => {
  // See docs/formation/DECISIONS.md, "A formation that turns has not gone
  // anywhere". A turn moves the party nowhere and costs it nothing.
  const walker = await member("Wheeler");
  await drain();
  const [wToken] = await scene.createEmbeddedDocuments("Token", [
    { name: "Wheeler", actorId: walker.id, x: 1000, y: 1000 },
  ]);
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Wheel Party");
  formation = await model.addMember(formation, walker, wToken);
  await drain();
  const id = onlyFormation().id;
  const partyToken = scene.tokens.get(onlyFormation().tokenId);
  assert.ok(partyToken, "party token placed");

  // Six abreast: wide across the line of march and one rank deep, so the two
  // axes differ and a swap is visible.
  await model.updateFormation({ ...model.getFormation(id), frontage: 6 });
  await partyToken.update({ rotation: 0 }); // south: the default facing
  await drain();

  const centre = (t) => ({ x: t.x + (t.width * scene.grid.size) / 2, y: t.y + (t.height * scene.grid.size) / 2 });
  const wide = { width: partyToken.width, height: partyToken.height };
  const before = centre(partyToken);
  console.log(`      [probe] facing south: ${wide.width}x${wide.height} at centre (${before.x}, ${before.y})`);
  assert.ok(wide.width > wide.height, "a six-wide block is wider than it is deep");

  const clockBefore = onlyFormation().clock;
  const roundsBefore = (clockBefore.turnsTotal * 10) + (clockBefore.roundsPartial ?? 0);

  // Quarter turn to the west. Nothing but rotation is written: the resize is
  // the module's own answer to it.
  await partyToken.update({ rotation: 90 });
  await drain();

  const after = centre(partyToken);
  console.log(`      [probe] facing west:  ${partyToken.width}x${partyToken.height} at centre (${after.x}, ${after.y})`);
  assert.equal(partyToken.width, wide.height, "the turn swapped width for depth");
  assert.equal(partyToken.height, wide.width, "the turn swapped depth for width");
  assert.deepEqual(after, before, "the block pivoted about its own centre");
  assert.ok(partyToken.x !== 1000 || partyToken.y !== 1000, "which means the corner did move");

  const clockAfter = onlyFormation().clock;
  const roundsAfter = (clockAfter.turnsTotal * 10) + (clockAfter.roundsPartial ?? 0);
  console.log(`      [probe] rounds ${roundsBefore} -> ${roundsAfter}`);
  assert.equal(roundsAfter, roundsBefore, "turning in place spent no time");
  assert.equal(clockAfter.carryFeet ?? 0, clockBefore.carryFeet ?? 0, "and banked no distance toward the next round");

  // The clock's baseline is the corner, which the pivot moved. Left stale, the
  // party's next step would be billed for the width of the turn as well.
  assert.deepEqual(
    clockAfter.lastPosition,
    { x: partyToken.x, y: partyToken.y },
    "the clock re-baselined to where the corner now is",
  );

  await model.disband(model.getFormation(id));
  await drain();
});

await scenario("a party token teleported to another scene stays the party token", async () => {
  // See docs/formation/DECISIONS.md, "A teleported party token keeps its
  // party". Core's `RegionDocument#teleportTokens` through `modifyBatch`:
  // create on the destination under the same id, then delete the original
  // with `replacements`. The options are the delete hook's as measured live.
  const traveller = await member("Traveller");
  await drain();
  const [tToken] = await scene.createEmbeddedDocuments("Token", [
    { name: "Traveller", actorId: traveller.id, x: 1000, y: 1000 },
  ]);
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Teleport Party");
  formation = await model.addMember(formation, traveller, tToken);
  await drain();
  const id = onlyFormation().id;
  const origin = scene.tokens.get(onlyFormation().tokenId);
  assert.ok(origin, "party token placed");

  const upstairs = new SceneMock("Upstairs");
  game.scenes.set(upstairs.id, upstairs);
  const uuidOf = (token) => `Scene.${token.parent.id}.Token.${token.id}`;
  const teleport = async (token, to, x, y) => {
    const from = token.parent;
    const [arrived] = await to.createEmbeddedDocuments("Token", [{ ...token.toObject(), x, y }], { keepId: true });
    uuidMap.set(uuidOf(arrived), arrived);
    await from.deleteEmbeddedDocuments("Token", [token.id], {
      action: "delete",
      documentName: "Token",
      modifiedTime: Date.now(),
      parent: from,
      render: true,
      replacements: { [token.id]: uuidOf(arrived) },
    });
    uuidMap.delete(uuidOf(token));
    return arrived;
  };

  const arrived = await teleport(origin, upstairs, 300, 400);
  await drain();
  let stored = onlyFormation();
  assert.equal(arrived.id, origin.id, "the token arrived under its own id");
  assert.equal(stored.sceneId, upstairs.id, "the record names the scene the party arrived on");
  assert.equal(stored.tokenId, arrived.id, "and the token it arrived as");
  assert.equal(model.getPartyToken(model.getFormation(id)), arrived, "the party token resolves to the arrival");
  assert.deepEqual(stored.clock.lastPosition, { x: 300, y: 400 }, "the clock measures from where the party arrived");

  // Down and up again while the ledger is held, so both deletions are heard
  // before either write runs, and the first leg's arrival is gone by then.
  let release = null;
  const held = model.patchFormation(id, async () => {
    await new Promise((resolve) => (release = resolve));
    return false;
  });
  while (!release) await sleep();
  const returned = await teleport(await teleport(arrived, scene, 700, 700), upstairs, 500, 500);
  release();
  await held;
  await drain();
  stored = onlyFormation();
  assert.equal(stored.sceneId, upstairs.id, "a round trip and out again ends on the last scene");
  assert.equal(stored.tokenId, returned.id);
  assert.deepEqual(stored.clock.lastPosition, { x: 500, y: 500 });

  // A token of the same id on a scene the party is not on, as a duplicated
  // scene holds: deleting it is not deleting the party token.
  const copy = new SceneMock("Upstairs (Copy)");
  game.scenes.set(copy.id, copy);
  const [twin] = await copy.createEmbeddedDocuments("Token", [returned.toObject()], { keepId: true });
  await copy.deleteEmbeddedDocuments("Token", [twin.id]);
  await drain();
  stored = onlyFormation();
  assert.equal(stored.sceneId, upstairs.id, "the twin's deletion leaves the record on the party's scene");
  assert.equal(stored.tokenId, returned.id);

  // A deletion that names no replacement still releases the party.
  await upstairs.deleteEmbeddedDocuments("Token", [returned.id]);
  await drain();
  stored = onlyFormation();
  assert.equal(stored.sceneId, null, "a plain deletion unlinks the scene");
  assert.equal(stored.tokenId, null, "and the token");

  await model.disband(model.getFormation(id));
  await drain();
});

await scenario("a lit torch survives every hook chain and reaches the token", async () => {
  // Proves the light survives a stale `formation.lights` write and that
  // `syncEnvironments` reaches `syncPartyTokenLight`.
  const bearer = await member("Lampwright");
  await drain();
  const [bToken] = await scene.createEmbeddedDocuments("Token", [
    { name: "Lampwright", actorId: bearer.id, x: 1500, y: 1500 },
  ]);
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Light Party");
  formation = await model.addMember(formation, bearer, bToken);
  await drain();
  const id = onlyFormation().id;
  await game.settings.set(MODULE_ID, "lightItemEnforcement", "off");

  // acks-equipment present and reacting to lightChanged, as it does live.
  globalThis.acksExtras.equipment = { freeHands: () => 2 };
  const equipmentListener = (actor) => {
    if (actor) actor.update({ "system.loadoutStamp": (actor.system.loadoutStamp ?? 0) + 1 });
  };
  Hooks.on("acksExtras.lightChanged", equipmentListener);
  try {
    await engine.addLight(model.getFormation(id), "torch", bearer.id);
    await drain();

    const lights = onlyFormation().lights;
    console.log(`      [probe] lights after settle = ${lights.length}, lit=${lights.filter((l) => l.lit).length}`);
    assert.equal(lights.length, 1, "the torch is still on the record after every hook settled");
    assert.ok(lights[0].lit, "and it is still lit");

    // syncEnvironments must have reached syncPartyTokenLight.
    await sceneSync.syncEnvironments();
    await drain();
    const partyToken = scene.tokens.get(onlyFormation().tokenId);
    console.log(`      [probe] party token light = ${partyToken.light.bright}/${partyToken.light.dim}`);
    assert.ok(partyToken.light.bright > 0, "the party token actually emits light");
  } finally {
    const arr = hooks.get("acksExtras.lightChanged") ?? [];
    const i = arr.indexOf(equipmentListener);
    if (i >= 0) arr.splice(i, 1);
    delete globalThis.acksExtras.equipment;
  }

  await model.disband(model.getFormation(id));
  await drain();
});

await scenario("a queued write never resurrects a record deleted while it waited", async () => {
  // See docs/formation/DECISIONS.md, "The ledger is read inside the lock,
  // never before it".
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  await drain();
  const keep = await model.createFormation("Keeper");
  const doomed = await model.createFormation("Doomed");
  await drain();

  const edited = { ...model.getFormation(keep.id), frontage: 4 };
  await Promise.all([model.updateFormation(edited), model.deleteFormationRecord(doomed.id)]);
  await drain();

  const all = model.getFormations();
  assert.ok(!all[doomed.id], "the deleted record stays deleted");
  assert.equal(all[keep.id]?.frontage, 4, "and the edit made alongside it survived");

  // The same collision the other way round: delete first, update second.
  const second = await model.createFormation("Second");
  await drain();
  const edited2 = { ...model.getFormation(keep.id), frontage: 2 };
  await Promise.all([model.deleteFormationRecord(second.id), model.updateFormation(edited2)]);
  await drain();

  const after = model.getFormations();
  assert.ok(!after[second.id], "still deleted when the delete is queued first");
  assert.equal(after[keep.id]?.frontage, 2, "and the later edit still landed");

  await game.settings.set(MODULE_ID, "formations", {});
  await drain();
});

await scenario("a whole-record write never resurrects the record it was holding", async () => {
  // The orphan: a writer holding a record it fetched earlier — a hook, a turn
  // tick — finishing after the record was dissolved, and putting it back with
  // whatever it was carrying. A whole-record write is an UPDATE; only
  // createFormation inserts.
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  await drain();
  const doomed = await model.createFormation("Doomed");
  await drain();

  const held = model.getFormation(doomed.id); // the stale copy a hook would hold
  held.tokenId = null;
  held.sceneId = null;
  await model.deleteFormationRecord(doomed.id);
  await model.updateFormation(held);
  await drain();

  assert.ok(!model.getFormations()[doomed.id], "the dissolved record stays dissolved");

  // ...and the refusal must not break the ordinary case.
  const live = await model.createFormation("Live");
  await drain();
  assert.ok(model.getFormations()[live.id], "createFormation still inserts");
  await model.updateFormation({ ...model.getFormation(live.id), frontage: 3 });
  await drain();
  assert.equal(model.getFormations()[live.id]?.frontage, 3, "an update to a live record still lands");

  await game.settings.set(MODULE_ID, "formations", {});
  await drain();
});

await scenario("a move held on the world clock keeps the party token the teleport handed over", async () => {
  // See docs/formation/DECISIONS.md, "A clock write never moves the party
  // token". The step into a teleport region bills rounds, and `advanceRounds`
  // carries the record it read before the step across the world-clock
  // advance. Here the advance answers only when told to, so the teleport's
  // patch lands inside that wait — the order a slow advance produces live.
  const strider = await member("Strider");
  await drain();
  const [sToken] = await scene.createEmbeddedDocuments("Token", [
    { name: "Strider", actorId: strider.id, x: 1000, y: 1000 },
  ]);
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Held Party");
  formation = await model.addMember(formation, strider, sToken);
  await drain();
  const id = onlyFormation().id;
  const origin = scene.tokens.get(onlyFormation().tokenId);
  assert.ok(origin, "party token placed");
  const landing = new SceneMock("Landing");
  game.scenes.set(landing.id, landing);
  const roundsOf = (clock) => clock.turnsTotal * 10 + (clock.roundsPartial ?? 0);

  const advance = game.time.advance;
  let open = null;
  game.time.advance = async (seconds) => {
    await new Promise((resolve) => (open = resolve));
    return advance(seconds);
  };
  // Three squares is fifteen feet: one round at 120' a turn.
  const stepHeld = async (token) => {
    open = null;
    await token.update({ x: token.x + 3 * token.parent.grid.size });
    for (let i = 0; !open && i < 500; i++) await sleep();
    assert.ok(open, "the move reached the world clock");
  };
  const billed = async (from) => {
    for (let i = 0; roundsOf(onlyFormation().clock) <= from && i < 500; i++) await sleep();
    await drain();
    assert.ok(roundsOf(onlyFormation().clock) > from, "the move was billed");
    return onlyFormation();
  };
  try {
    const roundsBefore = roundsOf(onlyFormation().clock);
    await stepHeld(origin);
    const [arrived] = await landing.createEmbeddedDocuments("Token", [{ ...origin.toObject(), x: 300, y: 400 }], { keepId: true });
    const arrivalUuid = `Scene.${landing.id}.Token.${arrived.id}`;
    uuidMap.set(arrivalUuid, arrived);
    await scene.deleteEmbeddedDocuments("Token", [origin.id], {
      action: "delete",
      documentName: "Token",
      modifiedTime: Date.now(),
      parent: scene,
      render: true,
      replacements: { [origin.id]: arrivalUuid },
    });
    await drain();
    assert.equal(onlyFormation().sceneId, landing.id, "the teleport's patch landed while the move was held");

    open();
    let stored = await billed(roundsBefore);
    assert.equal(stored.sceneId, landing.id, "the record still names the scene the party arrived on");
    assert.equal(stored.tokenId, arrived.id, "and the token it arrived as");
    assert.deepEqual(stored.clock.lastPosition, { x: 300, y: 400 }, "and measures from where it arrived");
    assert.equal(model.getPartyToken(model.getFormation(id)), arrived, "the party token resolves to the arrival");

    // A plain deletion heard during the wait releases the party for good.
    const roundsThen = roundsOf(stored.clock);
    await stepHeld(arrived);
    await landing.deleteEmbeddedDocuments("Token", [arrived.id]);
    await drain();
    open();
    stored = await billed(roundsThen);
    assert.equal(stored.sceneId, null, "a party token deleted while the move waited stays unlinked");
    assert.equal(stored.tokenId, null);
    uuidMap.delete(arrivalUuid);
  } finally {
    game.time.advance = advance;
    open?.();
  }

  await model.disband(model.getFormation(id));
  await drain();
});

await scenario("a whole write held on an answer keeps the party token a teleport, a deletion or an adoption handed over", async () => {
  // See docs/formation/DECISIONS.md, "Every whole write keeps the party
  // token's linkage". The writer reads its copy, waits on an answer (a
  // dialog, a server round trip), and writes the copy whole; the linkage
  // moves by patch while it waits.
  const guide = await member("Guide");
  await drain();
  const [gToken] = await scene.createEmbeddedDocuments("Token", [
    { name: "Guide", actorId: guide.id, x: 1000, y: 1000 },
  ]);
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Waiting Party");
  formation = await model.addMember(formation, guide, gToken);
  await drain();
  const id = onlyFormation().id;
  const origin = scene.tokens.get(onlyFormation().tokenId);
  assert.ok(origin, "party token placed");
  const ridge = new SceneMock("Ridge");
  game.scenes.set(ridge.id, ridge);
  const arrivalUuid = `Scene.${ridge.id}.Token.${origin.id}`;

  // A teleport heard while the answer is awaited.
  let copy = model.getFormation(id);
  copy.clock.lastPosition = { x: origin.x, y: origin.y };
  const [arrived] = await ridge.createEmbeddedDocuments("Token", [{ ...origin.toObject(), x: 300, y: 400 }], { keepId: true });
  uuidMap.set(arrivalUuid, arrived);
  await scene.deleteEmbeddedDocuments("Token", [origin.id], {
    action: "delete",
    documentName: "Token",
    modifiedTime: Date.now(),
    parent: scene,
    render: true,
    replacements: { [origin.id]: arrivalUuid },
  });
  await drain();
  assert.equal(onlyFormation().sceneId, ridge.id, "the teleport's patch landed while the writer waited");
  copy.stance = { ...(copy.stance ?? {}), pace: "hurried" };
  await model.updateFormation(copy);
  await drain();
  let stored = onlyFormation();
  assert.equal(stored.stance?.pace, "hurried", "the writer's own change landed");
  assert.equal(stored.sceneId, ridge.id, "the record still names the scene the party arrived on");
  assert.equal(stored.tokenId, arrived.id, "and the token it arrived as");
  assert.deepEqual(stored.clock.lastPosition, { x: 300, y: 400 }, "and measures from where it arrived");
  assert.equal(copy.sceneId, ridge.id, "the writer's copy is brought into line");

  // A write that names the party token the ledger names sets its own baseline.
  copy = model.getFormation(id);
  copy.clock.lastPosition = { x: 320, y: 420 };
  await model.updateFormation(copy);
  await drain();
  assert.deepEqual(onlyFormation().clock.lastPosition, { x: 320, y: 420 }, "an ordinary re-anchor still lands");

  // A plain deletion heard while the answer is awaited.
  copy = model.getFormation(id);
  await ridge.deleteEmbeddedDocuments("Token", [arrived.id]);
  uuidMap.delete(arrivalUuid);
  await drain();
  copy.frontage = 2;
  await model.updateFormation(copy);
  await drain();
  stored = onlyFormation();
  assert.equal(stored.frontage, 2);
  assert.equal(stored.sceneId, null, "a party token deleted while the writer waited stays unlinked");
  assert.equal(stored.tokenId, null);

  // The Judge drags the party actor onto a scene by hand while the answer is
  // awaited: the createToken hook adopts the token, and the write keeps it.
  copy = model.getFormation(id);
  const partyActor = model.getPartyActor(copy);
  assert.ok(partyActor, "the party actor survived the unlink");
  const [placed] = await scene.createEmbeddedDocuments("Token", [
    { name: partyActor.name, actorId: partyActor.id, x: 800, y: 900 },
  ]);
  await drain();
  stored = onlyFormation();
  assert.equal(placed.getFlag(MODULE_ID, "formationId"), id, "the placed token is flagged for the formation");
  assert.equal(stored.sceneId, scene.id, "a party token placed by hand is adopted");
  assert.equal(stored.tokenId, placed.id);
  // The token takes the formation's footprint once adopted, and that resize
  // re-anchors the clock, so the baseline is where it stands now.
  assert.deepEqual(stored.clock.lastPosition, { x: placed.x, y: placed.y }, "and measured from where it stands");
  copy.frontage = 3;
  await model.updateFormation(copy);
  await drain();
  stored = onlyFormation();
  assert.equal(stored.frontage, 3);
  assert.equal(stored.tokenId, placed.id, "the adoption survives a write held across it");
  assert.equal(model.getPartyToken(model.getFormation(id)), placed, "the party token resolves to the placed token");

  await model.disband(model.getFormation(id));
  await drain();
});

await scenario("a mode change made while a move waits on the world clock keeps its mode", async () => {
  // See docs/formation/DECISIONS.md, "A whole write carries only what its copy
  // changed". The step bills a round, and `advanceRounds` carries the record
  // it read before the step across the world-clock advance. The Judge's switch
  // patches the record inside that wait: the order a switch made in the move's
  // own tick produces live.
  const { id } = await isolatedParty("Switching Party", "Pathfinder");
  const travel = await import("../scripts/formation/travel.mjs");
  const roundsOf = (clock) => clock.turnsTotal * 10 + (clock.roundsPartial ?? 0);
  assert.equal(travel.travelOf(onlyFormation()).mode, "delve", "the party starts in a delve");
  const party = scene.tokens.get(onlyFormation().tokenId);
  assert.ok(party, "party token placed");

  const advance = game.time.advance;
  let open = null;
  game.time.advance = async (seconds) => {
    await new Promise((resolve) => (open = resolve));
    return advance(seconds);
  };
  try {
    const roundsBefore = roundsOf(onlyFormation().clock);
    // Three squares is fifteen feet: one round at 120' a turn.
    await party.update({ x: party.x + 3 * scene.grid.size });
    for (let i = 0; !open && i < 500; i++) await sleep();
    assert.ok(open, "the move reached the world clock");
    await travel.setJourneyMode(id, "journey");
    assert.equal(travel.travelOf(onlyFormation()).mode, "journey", "the switch landed while the move was held");

    open();
    for (let i = 0; roundsOf(onlyFormation().clock) <= roundsBefore && i < 500; i++) await sleep();
    await drain();
    const stored = onlyFormation();
    assert.ok(roundsOf(stored.clock) > roundsBefore, "the move was billed");
    assert.equal(travel.travelOf(stored).mode, "journey", "the move's write keeps the mode the switch set");
    assert.deepEqual(stored.clock.lastPosition, { x: party.x, y: party.y }, "and measures from where the move put the party");
  } finally {
    game.time.advance = advance;
    open?.();
    await drain();
    await model.disband(model.getFormation(id));
    await drain();
  }
});

await scenario("a whole write carries only what its copy changed while patches land around it", async () => {
  // See docs/formation/DECISIONS.md, "A whole write carries only what its copy
  // changed". Each copy is read, a patch lands, and the copy is written. The
  // first is taken as the party sheet takes its own (`formationForActor`).
  const { id, actors } = await isolatedParty("Merging Party", "Lamplighter", "Packer");
  const [lamplighter, packer] = actors;
  const travel = await import("../scripts/formation/travel.mjs");
  const light = (lid, remaining) => ({ id: lid, type: "torch", bearerId: lamplighter.id, remaining, lit: true, shielded: false });
  const cellOf = (actor) => onlyFormation().members.find((m) => m.actorId === actor.id);
  try {
    // Lights: one burnt by the writer, one lit and one put out by a patch.
    await model.patchFormation(id, (rec) => {
      rec.lights = [light("burn", 6), light("doused", 4)];
    });
    let copy = Object.values(model.getFormations()).find((f) => f.id === id);
    await model.patchFormation(id, (rec) => {
      rec.lights = [...rec.lights.filter((l) => l.id !== "doused"), light("lit", 6)];
    });
    copy.lights.find((l) => l.id === "burn").remaining = 5;
    copy.frontage = 2;
    await model.updateFormation(copy);
    await drain();
    let stored = onlyFormation();
    assert.equal(stored.frontage, 2, "the writer's own change landed");
    assert.deepEqual(stored.lights.map((l) => [l.id, l.remaining]), [["burn", 5], ["lit", 6]], "the burn landed, the lit light stayed and the doused one stayed out");

    // A copy normalized with defaults gains keys it never set: the ledger's
    // stand, as the mode change's do here.
    copy = model.getFormation(id);
    assert.equal(copy.travel, undefined, "the party has no travel record yet");
    await travel.setJourneyMode(id, "journey");
    await model.patchFormation(id, (rec) => {
      rec.travel = { ...rec.travel, day: { ...(rec.travel.day ?? {}), offered: true } };
    });
    copy.travel = travel.storedTravelOf(copy);
    await model.updateFormation(copy);
    await drain();
    stored = onlyFormation();
    assert.equal(travel.travelOf(stored).mode, "journey", "the mode a patch set stands over the copy's default");
    assert.equal(stored.travel.day.offered, true, "and so does the day the patch marked");

    // A sub-record the ledger cleared while the copy edited inside it.
    await model.patchFormation(id, (rec) => {
      rec.combat = { combatId: "elsewhere", active: false, roundsCounted: 1 };
    });
    copy = model.getFormation(id);
    await model.patchFormation(id, (rec) => {
      rec.combat = null;
    });
    copy.combat.roundsCounted = 2;
    await model.updateFormation(copy);
    await drain();
    assert.equal(onlyFormation().combat, null, "a combat cleared while the writer waited stays cleared");

    // A second write from the same copy carries only what changed since the first.
    copy = model.getFormation(id);
    copy.frontage = 3;
    await model.updateFormation(copy);
    await model.patchFormation(id, (rec) => {
      rec.frontage = 1;
    });
    copy.name = "Merged Party";
    await model.updateFormation(copy);
    await drain();
    stored = onlyFormation();
    assert.equal(stored.name, "Merged Party");
    assert.equal(stored.frontage, 1, "the frontage the first write already carried is not written again");

    // Members: a patch's change to a cell the copy did not touch stands,
    // beside a detach the deployment patch wrote meanwhile.
    copy = model.getFormation(id);
    assert.equal(await deployment.toggleDetachMember(model.getFormation(id), packer.id), "detached");
    await drain();
    await model.patchFormation(id, (rec) => {
      rec.members.find((m) => m.actorId === lamplighter.id).roles = ["mapper"];
    });
    copy.frontage = 2;
    await model.updateFormation(copy);
    await drain();
    assert.deepEqual(cellOf(lamplighter).roles, ["mapper"], "a role a patch gave stands");
    assert.ok(cellOf(packer).detached && cellOf(packer).deployedTokenId, "and so does the detach");
    assert.equal(await deployment.toggleDetachMember(model.getFormation(id), packer.id), "recalled");
    await drain();

    // The copy's own new marching order is written.
    copy = model.getFormation(id);
    copy.members.reverse();
    await model.updateFormation(copy);
    await drain();
    assert.deepEqual(onlyFormation().members.map((m) => m.actorId), [packer.id, lamplighter.id], "the copy's marching order landed");
  } finally {
    await drain();
    await model.disband(model.getFormation(id));
    await drain();
  }
});

/**
 * A party of its own on the dungeon scene, for a scenario that must not leave
 * the shared one changed: the named members are placed and added, and the
 * party token is placed with them.
 */
async function isolatedParty(name, ...people) {
  const actors = [];
  for (const [i, who] of people.entries()) {
    const actor = typeof who === "string" ? await member(who) : await ActorMock.create(who);
    await drain();
    const [token] = await scene.createEmbeddedDocuments("Token", [
      { name: actor.name, actorId: actor.id, actorLink: false, x: 1000 + i * 100, y: 1000, delta: null },
    ]);
    actors.push({ actor, token });
  }
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation(name);
  for (const { actor, token } of actors) formation = await model.addMember(formation, actor, token);
  await drain();
  return { id: onlyFormation().id, actors: actors.map((a) => a.actor) };
}

/**
 * A stack out on the map as lib's `groups.deploy` leaves it: a group actor
 * whose roster holds one deployed record per body, each body a token carrying
 * the group, stack and member flags. Built by hand: the placement is lib's,
 * and tools/test-group-lifecycle.mjs tests it.
 */
async function stackStandingOn(name, spots) {
  const group = await ActorMock.create({
    name,
    type: `${MODULE_ID}.group`,
    system: { stacks: [{ key: "s1", size: { current: spots.length, initial: spots.length }, roster: [] }] },
  });
  Object.assign(group.system, {
    toObject() {
      return { stacks: foundry.utils.deepClone(this.stacks) };
    },
    stackOf(key) {
      return this.stacks.find((s) => s.key === key) ?? null;
    },
  });
  Object.defineProperty(group.system, "primaryStack", { get: () => group.system.stacks[0] ?? null });
  for (const [i, { on, x, y }] of spots.entries()) {
    const key = `m${i + 1}`;
    const [body] = await on.createEmbeddedDocuments("Token", [
      { name: `${name} #${i + 1}`, actorId: group.id, actorLink: false, x, y, flags: { [MODULE_ID]: { group: group.uuid, stack: "s1", member: key } } },
    ]);
    group.system.stacks[0].roster.push({ key, ordinal: i + 1, state: "deployed", tokenUuid: `Scene.${on.id}.Token.${body.id}`, delta: {}, note: "" });
  }
  await drain();
  return group;
}

await scenario("a stack recalled with a body on another scene gathers it from there", async () => {
  // See docs/formation/DECISIONS.md, "A member on another scene: the recall,
  // a combat, and whole writes".
  const { id, actors } = await isolatedParty("Stack Party", "Lead");
  const cellar = new SceneMock("Cellar");
  game.scenes.set(cellar.id, cellar);
  const group = await stackStandingOn("Kobolds", [
    { on: scene, x: 1200, y: 1000 },
    { on: cellar, x: 300, y: 400 },
  ]);
  const bodiesOn = (where) => where.tokens.filter((t) => t.getFlag(MODULE_ID, "group") === group.uuid).length;
  try {
    await model.patchFormation(id, (rec) => {
      rec.members.push({ actorId: group.id, roles: [], tokenData: null, deployedStack: true, detached: true });
    });
    await drain();
    assert.equal(await deployment.toggleDetachMember(model.getFormation(id), group.id), "recalled");
    await drain();
    const cell = onlyFormation().members.find((m) => m.actorId === group.id);
    assert.ok(!cell.deployedStack && !cell.detached, "the cell is back inside the party token");
    assert.equal(bodiesOn(scene), 0, "no body is left on the party's scene");
    assert.equal(bodiesOn(cellar), 0, "nor on the scene a body was moved to");
    assert.deepEqual(group.system.stacks[0].roster.map((m) => m.state), ["materialized", "materialized"], "both bodies folded home");
  } finally {
    game.scenes.delete(cellar.id);
  }
  await model.disband(model.getFormation(id));
  await drain();
  for (const actor of [...actors, group]) await actor.delete();
  await drain();
});

await scenario("a combat on the party's scene leaves a scout on another scene out", async () => {
  // See docs/formation/DECISIONS.md, "A member on another scene: the recall,
  // a combat, and whole writes".
  const { id, actors } = await isolatedParty("Split Party", "Ranger", "Guard");
  const [ranger, guard] = actors;
  const tower = new SceneMock("Tower");
  game.scenes.set(tower.id, tower);
  const scout = () => onlyFormation().members.find((m) => m.actorId === ranger.id);
  try {
    assert.equal(await deployment.toggleDetachMember(model.getFormation(id), ranger.id), "detached");
    await drain();
    const arrived = await moveAcrossScenes(scene.tokens.get(scout().deployedTokenId), tower, 300, 400);
    await drain();
    assert.equal(scout().deployedSceneId, tower.id, "the scout stands on the tower");

    const combat = new CombatMock();
    game.combats.set(combat.id, combat);
    await combat.createEmbeddedDocuments("Combatant", [
      { tokenId: onlyFormation().tokenId, sceneId: scene.id, actorId: onlyFormation().actorId, hidden: false },
    ]);
    await drain();
    assert.ok(onlyFormation().combat?.active, "the party deployed for combat");
    assert.ok(scout().detached, "the scout is still out on a detach");
    assert.deepEqual(scout().detach?.anchor, { x: 300, y: 400 }, "on the leash from where they arrived");
    assert.ok(!combat.combatants.some((c) => c.actorId === ranger.id), "and is no combatant");
    assert.ok(combat.combatants.some((c) => c.actorId === guard.id), "the guard fights");

    await combat.delete();
    await drain();
    const guardCell = onlyFormation().members.find((m) => m.actorId === guard.id);
    assert.equal(onlyFormation().combat, null, "the party re-formed");
    assert.ok(!guardCell.deployedTokenId, "the guard came home");
    assert.equal(scout().deployedSceneId, tower.id, "the scout is still out on the tower");
    assert.ok(tower.tokens.get(arrived.id), "their token still stands there");

    // Any combat's end reads a member on the map as an unfinished deploy; a
    // scout on another scene is none.
    const elsewhere = new CombatMock();
    game.combats.set(elsewhere.id, elsewhere);
    const cards = chat.length;
    await elsewhere.delete();
    await drain();
    assert.ok(scout().detached && tower.tokens.get(arrived.id), "another combat's end leaves them out too");
    assert.equal(chat.length, cards, "and announces no re-forming");

    assert.equal(await deployment.toggleDetachMember(model.getFormation(id), ranger.id), "recalled");
    await drain();
    assert.equal(tower.tokens.size, 0, "the recall still reaches the tower");
  } finally {
    game.scenes.delete(tower.id);
  }
  await model.disband(model.getFormation(id));
  await drain();
  for (const actor of actors) await actor.delete();
  await drain();
});

await scenario("a whole write keeps the member records a patch moved while it waited", async () => {
  // See docs/formation/DECISIONS.md, "A member on another scene: the recall,
  // a combat, and whole writes".
  const { id, actors } = await isolatedParty("Patient Party", {
    name: "Pathfinder",
    type: "monster",
    system: { hp: { value: 8, max: 8 }, movementacks: { exploration: 120 }, movement: { base: 120 } },
  });
  const [finder] = actors;
  const pass = new SceneMock("Pass");
  game.scenes.set(pass.id, pass);
  const scout = () => onlyFormation().members.find((m) => m.actorId === finder.id);
  try {
    assert.equal(await deployment.toggleDetachMember(model.getFormation(id), finder.id), "detached");
    await drain();

    // The party's own step: the re-anchor is a patch, and the clock's write
    // that follows it carries the record it read before the patch landed.
    const out = scene.tokens.get(scout().deployedTokenId);
    await out.update({ x: out.x + 200 });
    await drain();
    const party = scene.tokens.get(onlyFormation().tokenId);
    await party.update({ x: party.x + 300 });
    await drain();
    assert.deepEqual(scout().detach?.anchor, { x: out.x, y: out.y }, "the step re-anchors the scout where they stand");

    // A move across scenes heard while a writer waits on an answer.
    let copy = model.getFormation(id);
    const arrived = await moveAcrossScenes(out, pass, 300, 400);
    await drain();
    assert.equal(scout().deployedSceneId, pass.id, "the move's patch landed while the writer waited");
    copy.frontage = 2;
    await model.updateFormation(copy);
    await drain();
    assert.equal(onlyFormation().frontage, 2, "the writer's own change landed");
    assert.equal(scout().deployedSceneId, pass.id, "the record still names the scene the scout arrived on");
    assert.equal(scout().deployedTokenId, arrived.id, "and the token they arrived as");
    assert.deepEqual(scout().detach?.anchor, { x: 300, y: 400 }, "and the leash measures from the arrival");
    const copied = copy.members.find((m) => m.actorId === finder.id);
    assert.equal(copied.deployedSceneId, pass.id, "the writer's copy is brought into line");

    // A stash written while a writer waits.
    assert.equal(await deployment.toggleDetachMember(model.getFormation(id), finder.id), "recalled");
    await drain();
    copy = model.getFormation(id);
    const roster = (await import("../scripts/lib/services.mjs")).get("party-roster");
    const done = await roster.adjustStashedHp(id, finder.id, (hp) => hp.value - 3);
    assert.deepEqual([done?.before, done?.after], [8, 5], "the stash took the change");
    copy.frontage = 3;
    await model.updateFormation(copy);
    await drain();
    assert.equal(onlyFormation().frontage, 3);
    assert.equal(scout().tokenData?.delta?.system?.hp?.value, 5, "the stash keeps the change the writer never read");
  } finally {
    game.scenes.delete(pass.id);
  }
  await model.disband(model.getFormation(id));
  await drain();
  for (const actor of actors) await actor.delete();
  await drain();
});

/** The party joins `combat`: its token added as a combatant, as core adds it. */
async function partyJoins(combat) {
  game.combats.set(combat.id, combat);
  const stored = onlyFormation();
  await combat.createEmbeddedDocuments("Combatant", [
    { tokenId: stored.tokenId, sceneId: scene.id, actorId: stored.actorId, hidden: false },
  ]);
  await drain();
}

/** A combat the party never joined is deleted; returns how many chat cards its end posted. */
async function anotherCombatEnds() {
  const other = new CombatMock();
  game.combats.set(other.id, other);
  const cards = chat.length;
  await other.delete();
  await drain();
  return chat.length - cards;
}

await scenario("a combat the party never joined leaves a scout on the party's scene out", async () => {
  // See docs/formation/DECISIONS.md, "A combat records whom it took over".
  const { id, actors } = await isolatedParty("Watchful Party", "Lookout", "Warden");
  const [lookout, warden] = actors;
  const cell = (actor) => onlyFormation().members.find((m) => m.actorId === actor.id);
  assert.equal(await deployment.toggleDetachMember(model.getFormation(id), lookout.id), "detached");
  await drain();
  const out = cell(lookout).deployedTokenId;

  assert.equal(await anotherCombatEnds(), 0, "another combat's end announces no re-forming");
  assert.ok(cell(lookout).detached, "the scout is still out on a detach");
  assert.equal(cell(lookout).deployedTokenId, out, "under the token they went out as");
  assert.ok(scene.tokens.get(out), "which still stands");

  const combat = new CombatMock();
  await partyJoins(combat);
  assert.ok(onlyFormation().combat?.active, "the party deployed for combat");
  assert.ok(!cell(lookout).detached, "the fight takes the scout over");
  assert.equal(await anotherCombatEnds(), 0, "another combat's end leaves the party's fight alone");
  assert.ok(onlyFormation().combat?.active, "the party is still fighting");
  assert.ok(cell(lookout).deployedTokenId && cell(warden).deployedTokenId, "with everyone on the field");

  await combat.delete();
  await drain();
  assert.equal(onlyFormation().combat, null, "the party's own combat re-forms it");
  assert.ok(!cell(lookout).deployedTokenId && !cell(warden).deployedTokenId, "the scout it took over comes home with the rest");

  assert.equal(await deployment.toggleDetachMember(model.getFormation(id), lookout.id), "detached");
  await drain();
  assert.equal(await anotherCombatEnds(), 0, "sent out again, the scout is no combat's");
  assert.ok(cell(lookout).detached, "and stays out");
  await model.disband(model.getFormation(id));
  await drain();
  for (const actor of actors) await actor.delete();
  await drain();
});

await scenario("a member left behind stays where they were left, and the rest of the party fights", async () => {
  // See docs/formation/DECISIONS.md, "A combat records whom it took over".
  const { id, actors } = await isolatedParty(
    "Rearguard Party",
    { name: "Fallen", type: "monster", system: { hp: { value: 0, max: 8 }, movementacks: { exploration: 120 }, movement: { base: 120 } } },
    "Fighter",
  );
  const [fallen, fighter] = actors;
  const cell = (actor) => onlyFormation().members.find((m) => m.actorId === actor.id);
  assert.equal(await deployment.toggleMemberLeft(model.getFormation(id), fallen.id), true);
  await drain();
  const body = scene.tokens.get(cell(fallen).deployedTokenId);
  assert.ok(body, "the casualty lies where the party left them");

  const combat = new CombatMock();
  await partyJoins(combat);
  assert.ok(onlyFormation().combat?.active, "the party deployed for combat");
  assert.ok(combat.combatants.some((c) => c.actorId === fighter.id), "the fighter fights");
  assert.ok(!combat.combatants.some((c) => c.actorId === fallen.id), "the casualty is no combatant");
  assert.ok(!cell(fallen).deployedCombatId, "nor the combat's");

  await combat.delete();
  await drain();
  assert.equal(onlyFormation().combat, null, "the party re-formed");
  assert.ok(!cell(fighter).deployedTokenId, "the fighter came home");
  assert.equal(cell(fallen).deployedTokenId, body.id, "the casualty is still where they were left");
  assert.ok(scene.tokens.get(body.id) && cell(fallen).left, "their token still lies there, left behind");
  await model.disband(model.getFormation(id));
  await drain();
  for (const actor of actors) await actor.delete();
  await drain();
});

await scenario("a combat's takeover outlasts a whole write and the loss of the combat flag", async () => {
  // See docs/formation/DECISIONS.md, "A combat records whom it took over".
  const { id, actors } = await isolatedParty("Steadfast Party", "Shield", "Spear");
  const cell = (actor) => onlyFormation().members.find((m) => m.actorId === actor.id);
  const copy = model.getFormation(id); // read before the fight
  const combat = new CombatMock();
  await partyJoins(combat);
  assert.ok(onlyFormation().combat?.active, "the party deployed for combat");

  copy.frontage = 2;
  await model.updateFormation(copy);
  await drain();
  assert.equal(onlyFormation().frontage, 2, "the writer's own change landed");
  for (const actor of actors) assert.equal(cell(actor).deployedCombatId, combat.id, `${actor.name} is still the combat's`);
  // The flag lost, as a stale whole write has erased it.
  await model.patchFormation(id, (rec) => {
    rec.combat = null;
  });
  await drain();
  assert.equal(await anotherCombatEnds(), 0, "another combat's end leaves the fight alone");
  assert.ok(actors.every((a) => cell(a).deployedTokenId), "with everyone on the field");

  await combat.delete();
  await drain();
  assert.ok(actors.every((a) => !cell(a).deployedTokenId), "the combat's own end gathers them");
  assert.equal(scene.tokens.filter((t) => actors.some((a) => a.id === t.actorId)).length, 0, "no member token is left");
  await model.disband(model.getFormation(id));
  await drain();
  for (const actor of actors) await actor.delete();
  await drain();
});

await scenario("a combat deploy from before the takeover was recorded is read as before", async () => {
  // See docs/formation/DECISIONS.md, "A combat records whom it took over".
  const { id, actors } = await isolatedParty("Veteran Party", "Elder", "Squire");
  const cell = (actor) => onlyFormation().members.find((m) => m.actorId === actor.id);
  const forget = (flagToo) =>
    model.patchFormation(id, (rec) => {
      for (const m of rec.members) delete m.deployedCombatId;
      if (flagToo) rec.combat = null;
    });

  const combat = new CombatMock();
  await partyJoins(combat);
  await forget(false);
  await drain();
  assert.equal(await anotherCombatEnds(), 0, "another combat's end leaves the running combat's members alone");
  assert.ok(actors.every((a) => cell(a).deployedTokenId), "with everyone on the field");
  await combat.delete();
  await drain();
  assert.ok(actors.every((a) => !cell(a).deployedTokenId), "the running combat's end gathers them");

  const second = new CombatMock();
  await partyJoins(second);
  await forget(true);
  await drain();
  assert.ok((await anotherCombatEnds()) > 0, "with the combat flag lost too, any combat's end re-forms the party");
  assert.ok(actors.every((a) => !cell(a).deployedTokenId), "and gathers them");
  await second.delete();
  await drain();
  await model.disband(model.getFormation(id));
  await drain();
  for (const actor of actors) await actor.delete();
  await drain();
});

await scenario("overlapping environment sweeps coalesce instead of racing", async () => {
  // See docs/formation/DECISIONS.md, "Environment sweeps coalesce, and a
  // vanished target is not a fault".
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  await drain();

  let sweeps = 0;
  const realGet = game.settings.get.bind(game.settings);
  // The first setting a sweep reads, and it reads it exactly once per run.
  game.settings.get = (ns, key) => {
    if (ns === MODULE_ID && key === "syncTokenLight") sweeps++;
    return realGet(ns, key);
  };
  try {
    const requests = Array.from({ length: 5 }, () => sceneSync.syncEnvironments());
    await Promise.all(requests);
    console.log(`      [probe] 5 concurrent requests -> ${sweeps} sweep(s)`);
    assert.ok(sweeps >= 1, "a sweep actually ran");
    assert.ok(sweeps <= 2, `a burst collapses to the running sweep plus one replay, ran ${sweeps}`);
  } finally {
    game.settings.get = realGet;
  }

  // And a sweep still runs to completion for a caller that awaits it alone.
  await sceneSync.syncEnvironments();
  await drain();
});

await scenario("a city block walked on a metre map costs exactly one turn", async () => {
  // The two halves of a city turn are a distance and a rate, and they must be
  // in ONE currency. The drag is converted to feet through the scene's units;
  // the block the Judge typed is in those same units, so the rate has to be
  // converted too. Left raw, a metre map marks off a turn for every 3.28 the
  // party is owed.
  const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
  const { SETTLEMENT_DOC, freshSettlement } = await import("../scripts/formation/settlement.mjs");
  // Invented rate: one block a turn is what makes the currency visible — one
  // block dragged must buy one turn, whatever the map is drawn in.
  registerTable(
    { id: SETTLEMENT_DOC, source: "invented", tables: { paces: { commuting: { blocksPerTurn: 1 } } } },
    { priority: PRIORITY.WORLD, source: "test" },
  );

  const city = new SceneMock("Metropolis");
  city.grid = { size: 100, distance: 5, units: "m" }; // five metres to the cell
  await city.setFlag(MODULE_ID, "battlemap", { blockFeet: 30 }); // thirty METRES, as typed
  game.scenes.set(city.id, city);

  try {
    const walker = await member("Citizen");
    await drain();
    const [cToken] = await city.createEmbeddedDocuments("Token", [
      { name: "Citizen", actorId: walker.id, x: 1000, y: 1000 },
    ]);
    await game.settings.set(MODULE_ID, "formations", {}); // isolate
    let formation = await model.createFormation("City Party");
    formation = await model.addMember(formation, walker, cToken);
    await drain();
    const id = onlyFormation().id;
    await model.patchFormation(id, (rec) => {
      rec.travel = { mode: "settlement", settlement: { ...freshSettlement(), pace: "commuting" } };
    });
    await drain();

    const partyToken = city.tokens.get(onlyFormation().tokenId);
    assert.ok(partyToken, "party token placed on the city scene");
    const before = onlyFormation().clock;
    const roundsBefore = before.turnsTotal * 10 + (before.roundsPartial ?? 0);

    // One block: 30 m at 5 m to the cell is six cells.
    await partyToken.update({ x: partyToken.x + 6 * city.grid.size });
    await drain();

    const after = onlyFormation().clock;
    const rounds = after.turnsTotal * 10 + (after.roundsPartial ?? 0) - roundsBefore;
    console.log(`      [probe] one block dragged -> ${rounds} round(s), ${rounds / 10} turn(s)`);
    assert.equal(rounds, 10, "one block is one turn, not one per 3.28 metres");

    await model.disband(model.getFormation(id));
    await drain();
  } finally {
    // The layer this scenario added, and nothing else: `resetTables` would drop
    // every other registration and every consumer expectation in the process,
    // so a later scenario needing a load-time table would fail pointing here.
    unregisterTable(SETTLEMENT_DOC, { priority: PRIORITY.WORLD });
    game.scenes.delete(city.id);
  }
});

await scenario("a drawn move's turn is thrown for in the encounter zone the move put the party in", async () => {
  // See docs/formation/DECISIONS.md, "The ground under the party is read at
  // the token's stored corner". The turn the move completes is thrown for in
  // the move's own hook chain, while this client is still drawing it.
  const party = await drawnParty("Lairward");
  const { partyToken, step } = party;
  const gs = scene.grid.size;
  const start = { x: partyToken.x, y: partyToken.y };
  // The zone covers the far half of the move, so the corner the move began at
  // stands outside it. Its cadence throws every turn; the world's does not.
  const edge = start.x + (partyToken.width * gs) / 2 + step / 2;
  const lair = {
    id: uid("reg"),
    name: "Drawn Lair",
    elevation: {},
    testPoint: ({ x }) => x >= edge,
    behaviors: [{
      type: "acks-extras.encounterZone",
      disabled: false,
      system: { tableUuid: "", encounterEvery: 1, encounterTarget: 0, dungeonLevel: 0 },
    }],
  };
  scene.regions.set(lair.id, lair);
  const turnsBefore = onlyFormation().clock.turnsTotal;
  const from = chat.length;
  try {
    await partyToken.update({ x: start.x + step });
    await drain();
    assert.deepEqual({ x: partyToken.x, y: partyToken.y }, start, "the drawing still stands where the move began");
    assert.ok(onlyFormation().clock.turnsTotal > turnsBefore, "the move completed a turn");
    const thrown = chat.slice(from).filter((m) => String(m.flavor ?? "").includes("chat.inZone"));
    assert.equal(thrown.length, 1, "the turn was thrown for in the zone");
    assert.match(thrown[0].flavor, /Drawn Lair/, "and the card names it");
  } finally {
    scene.regions.delete(lair.id);
    await dismissDrawn(party);
  }
});

await scenario("a drawn move into an armed trap zone is trap-checked where it put the party", async () => {
  // See docs/formation/DECISIONS.md, "The ground under the party is read at
  // the token's stored corner". A zone has no line to cross: the check finds
  // it by where the party stands, and asks in the move's own hook chain.
  const { TRAP_ZONE_TYPE } = await import("../scripts/formation/constants.mjs");
  const party = await drawnParty("Snared");
  const { partyToken, step } = party;
  const gs = scene.grid.size;
  const start = { x: partyToken.x, y: partyToken.y };
  // Down the map, over the far half of the move. The trap answers nothing, so
  // the check asks for it and ends.
  const edge = start.y + (partyToken.height * gs) / 2 + step / 2;
  const trapUuid = "Item.drawnZoneTrap";
  const pitId = uid("reg");
  const pit = {
    id: pitId,
    name: "Drawn Pit",
    elevation: {},
    testPoint: ({ y }) => y >= edge,
    behaviors: [{
      type: TRAP_ZONE_TYPE,
      disabled: false,
      uuid: `Scene.${scene.id}.Region.${pitId}.RegionBehavior.trap`,
      system: { trapUuid, state: "armed" },
    }],
  };
  const asked = [];
  const lookUp = globalThis.fromUuid;
  globalThis.fromUuid = async (u) => {
    if (u === trapUuid) asked.push(u);
    return lookUp(u);
  };
  scene.regions.set(pit.id, pit);
  try {
    await partyToken.update({ y: start.y + step });
    await drain();
    assert.deepEqual({ x: partyToken.x, y: partyToken.y }, start, "the drawing still stands where the move began");
    assert.ok(asked.length > 0, "the trap check found the zone the move ended in");
  } finally {
    globalThis.fromUuid = lookUp;
    scene.regions.delete(pit.id);
    await dismissDrawn(party);
  }
});

await scenario("the settlement readout states a walking turn at every map unit", async () => {
  // The panel prints the turn's rate beside the scene's unit, so the SAME
  // distance is a big number on a foot map and a fraction of one on a mile map.
  // A single rounding rule for both is how a mile city ends up reading "a turn
  // is 0 mi" — a tracker claiming the party moves nothing. Every unit the
  // battlemap's picker offers is walked here, against one unchanging party.
  const view = await import("../scripts/formation/formation-view.mjs");
  const { freshSettlement } = await import("../scripts/formation/settlement.mjs");
  const { feetPerUnit } = await import("../scripts/lib/distance-units.mjs");

  const city = new SceneMock("Unit City");
  city.grid = { size: 100, distance: 5, units: "ft" };
  game.scenes.set(city.id, city);

  try {
    const walker = await member("Pedestrian");
    await drain();
    const [wToken] = await city.createEmbeddedDocuments("Token", [
      { name: "Pedestrian", actorId: walker.id, x: 1000, y: 1000 },
    ]);
    await game.settings.set(MODULE_ID, "formations", {}); // isolate
    let formation = await model.createFormation("Unit Party");
    formation = await model.addMember(formation, walker, wToken);
    await drain();
    const id = onlyFormation().id;
    await model.patchFormation(id, (rec) => {
      rec.travel = { mode: "settlement", settlement: { ...freshSettlement() } };
    });
    await drain();

    // No block size on this map, so the tracker falls back to walking speed —
    // the `trackWalk` branch, which is the one that printed the zero.
    const speed = view.buildFormationView(model.getFormation(id)).effSpeed;
    console.log(`      [probe] walking speed = ${speed}'/turn`);
    assert.ok(speed > 0, "the party has a walking speed to be timed by");

    // Two significant digits is the floor the formatter guarantees, so the
    // readback tolerance is one part in twenty — comfortably wider than any
    // rounding it does, and far tighter than the 3.28× and 5280× errors a
    // missing or mis-applied conversion produces.
    for (const units of ["ft", "yd", "m", "km", "mi"]) {
      await city.update({ "grid.units": units });
      const settlement = view.buildFormationView(model.getFormation(id)).travel.settlement;
      const turn = settlement.turnFeet;
      assert.equal(settlement.units, units, `the readout names ${units}`);
      assert.ok(!settlement.timedByBlocks, `${units}: timed by walking speed, not blocks`);
      console.log(`      [probe] a turn is ${turn} ${units}`);
      assert.ok(turn > 0, `a turn is not 0 ${units}`);
      const backToFeet = turn * feetPerUnit(units);
      assert.ok(
        Math.abs(backToFeet - speed) <= speed / 20,
        `${units}: ${turn} ${units} is ${backToFeet.toFixed(1)}', not the ${speed}' the party walks`,
      );
    }

    await model.disband(model.getFormation(id));
    await drain();
  } finally {
    game.scenes.delete(city.id);
  }
});

await scenario("one clock advance credits a holed-up stretch exactly once", async () => {
  // A world-time advance reaches the credit twice: the hook watcher answers it,
  // and the turn engine awaits it as well so its own re-read sees a settled
  // board. Both read the stamp before either moves it, so an unserialised
  // credit throws the stay's dice twice and pushes the stamp into the future.
  const { freshSettlement } = await import("../scripts/formation/settlement.mjs");
  const settlementTurn = await import("../scripts/formation/settlement-turn.mjs");
  const stayCards = () => chat.filter((m) => String(m.content).includes("settlement.card.stayTitle")).length;

  const guest = await member("Guest");
  await drain();
  const [gToken] = await scene.createEmbeddedDocuments("Token", [
    { name: "Guest", actorId: guest.id, x: 800, y: 800 },
  ]);
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Inn Party");
  formation = await model.addMember(formation, guest, gToken);
  await drain();
  const id = onlyFormation().id;

  const board = () => model.getFormation(id).travel.settlement;
  const holeUp = (since) => model.patchFormation(id, (rec) => {
    rec.travel = { mode: "settlement", settlement: { ...freshSettlement(), where: "holedUp", holeUpSince: since } };
  });

  // Two whole days on the clock, and one advance to notice them.
  const since = game.time.worldTime - 2 * 86400;
  await holeUp(since);
  await drain();
  let cards = stayCards();
  await engine.advanceRounds(model.getFormation(id), 1, { reason: "manual" });
  await drain();

  console.log(`      [probe] advance -> +${(board().holeUpSince - since) / 86400} day(s) stamped, `
    + `${board().days} day(s) on the board, ${stayCards() - cards} stay card(s)`);
  assert.equal(board().holeUpSince, since + 2 * 86400, "the stamp moved by the two days that were owed");
  assert.equal(board().days, 2, "and the stay was charged for two days, not four");
  assert.equal(stayCards() - cards, 1, "one stretch, one card");

  // The same guarantee asked of the credit directly, so it holds however the
  // two callers happen to interleave.
  await holeUp(game.time.worldTime - 3 * 86400);
  await drain();
  cards = stayCards();
  const mark = board().holeUpSince;
  await Promise.all([settlementTurn.creditHoledUpDays(), settlementTurn.creditHoledUpDays()]);
  await drain();
  console.log(`      [probe] two concurrent credits -> +${(board().holeUpSince - mark) / 86400} day(s), `
    + `${stayCards() - cards} stay card(s)`);
  assert.equal(board().holeUpSince, mark + 3 * 86400, "concurrent credits price the stretch once");
  assert.equal(stayCards() - cards, 1, "and throw for it once");

  await model.disband(model.getFormation(id));
  await drain();
});

await scenario("the day change settles every journeying party once, however the clock was moved", async () => {
  // Invented tables, registered the way an import registers them: the codes are
  // science, the grid and the thresholds are made up, so this proves the
  // machinery and never the book.
  const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
  const { WEATHER_DOC } = await import("../scripts/vehicles/vehicle-speed.mjs");
  const { dayOfKey } = await import("../scripts/formation/sky.mjs");
  const { calendarDay } = await import("../scripts/lib/world-time.mjs");
  const travelMod = await import("../scripts/formation/travel.mjs");
  registerTable({
    id: WEATHER_DOC,
    tables: {
      climateModifiers: {
        Af: {
          spring: { tDay: -1, tNight: -4, p: 0, w: 0 },
          summer: { tDay: 3, tNight: 1, p: -2, w: 1 },
        },
      },
      dailyTemperatureLow: [
        { min: null, max: 3, key: "frigid" },
        { min: 4, max: 6, key: "cold" },
        { min: 7, max: 9, key: "balmy" },
        { min: 10, max: null, key: "sweltering" },
      ],
      dailyTemperatureHigh: [
        { min: null, max: 4, key: "chilly" },
        { min: 5, max: 9, key: "warm" },
        { min: 10, max: null, key: "hot" },
      ],
      dailyPrecipitation: [
        { min: null, max: 4, key: "clear" },
        { min: 5, max: 7, key: "drizzly" },
        { min: 8, max: null, key: "rainy" },
      ],
      dailyWind: [
        { min: null, max: 4, key: "still" },
        { min: 5, max: 9, key: "moderate" },
        { min: 10, max: null, key: "gale" },
      ],
      accumulation: {
        snowFromSnowy: 1, snowFromFlurry: 3, snowMeltModerate: 4, snowMeltSweltering: 1,
        mudFromRainy: 1, mudFromDrizzly: 3, mudDryModerate: 5, mudDrySweltering: 1, mudFreeze: 1,
      },
    },
  }, { priority: PRIORITY.WORLD, source: "test" });

  const DAY = 86400;
  const cacheOf = () => game.settings.get(MODULE_ID, "skyCache") ?? {};
  const weatherOf = (id) => model.getFormation(id).travel.weather;
  const runsOf = (id) => ({ ...(weatherOf(id).footing?.runs ?? {}) });
  const setCalendar = (seasons = null) => {
    game.time.calendar = { days: { hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60 }, ...(seasons ? { seasons: { values: seasons } } : {}) };
    game.time.components = { hour: 12, minute: 0, second: 0, ...(seasons ? { season: 0 } : {}) };
  };
  const dropCalendar = () => {
    delete game.time.calendar;
    delete game.time.components;
  };
  const advance = async (seconds) => {
    await game.time.advance(seconds);
    await drain();
    await drain();
  };
  // Every die reads 8 (a 2d6 of 3 and 3 on top of 2), so each day's sky is the
  // same band and the footing's run counters climb by exactly one a day. The
  // counter is what shows how many skies were rolled.
  const realRandom = Math.random;
  let dice = 0;
  Math.random = () => { dice++; return 0.5; };
  const realSet = game.settings.set;
  let cacheWrites = 0;
  game.settings.set = async (ns, key, value) => {
    if (key === "skyCache") cacheWrites++;
    return realSet.call(game.settings, ns, key, value);
  };
  const advanceSetting = game.settings.get(MODULE_ID, "advanceWorldTime");
  const clock0 = game.time.worldTime;

  try {
    await game.settings.set(MODULE_ID, "formations", {}); // isolate
    await game.settings.set(MODULE_ID, "skyCache", {});
    const journeying = { mode: "journey", ground: "grassland", weather: {
      auto: true, climate: "Af", season: "spring", temperature: "balmy", precipitation: "rainy", wind: "moderate",
    } };
    const ids = {};
    for (const [key, travel] of Object.entries({ a: journeying, b: journeying, delve: { ...journeying, mode: "delve" } })) {
      const made = await model.createFormation(`Sky ${key}`);
      await model.patchFormation(made.id, (rec) => { rec.travel = JSON.parse(JSON.stringify(travel)); });
      ids[key] = made.id;
    }
    await drain();

    // Noon, so a minute is the same calendar day and a day is the next.
    game.time.worldTime = Math.ceil((game.time.worldTime + 1) / DAY) * DAY + DAY / 2;
    setCalendar();
    const day0 = calendarDay();
    assert.ok(Number.isInteger(day0), "the mock clock keeps a calendar");

    // No watermark yet: the first sighting is stamped and nothing is paid back.
    await advance(60);
    for (const key of ["a", "b", "delve"]) assert.equal(weatherOf(ids[key]).settledDay, day0, `${key} is stamped with today`);
    assert.deepEqual([runsOf(ids.a), runsOf(ids.b)], [{}, {}], "a first sighting settles no ground");
    assert.equal(Object.keys(cacheOf()).length, 0, "and rolls no sky");
    assert.equal(dice, 0);

    // One calendar day: ONE sky for both parties, each ground settled once.
    dice = 0;
    cacheWrites = 0;
    await advance(DAY);
    assert.equal(calendarDay(), day0 + 1);
    assert.equal(dice, 6, "three 2d6 throws: the second party read the first's sky instead of rolling");
    assert.equal(cacheWrites, 1, "and the cache was written once for the step");
    assert.deepEqual(Object.keys(cacheOf()).map(dayOfKey), [day0 + 1], "under the calendar day, not the End-day counter");
    const [wa, wb] = [weatherOf(ids.a), weatherOf(ids.b)];
    assert.deepEqual(wa.rolls, { t: 8, p: 8, w: 8 });
    assert.deepEqual([wa.rolls, wa.temperature, wa.precipitation], [wb.rolls, wb.temperature, wb.precipitation], "both parties hold one sky");
    assert.equal(runsOf(ids.a).rainy, 1, "the finished day settled onto the ground once");
    assert.equal(runsOf(ids.b).tempModerate, 1);
    assert.equal(wa.settledDay, day0 + 1);
    assert.equal(wb.settledDay, day0 + 1);
    assert.equal(model.getFormation(ids.a).travel.dayCount ?? 0, 0, "End day's counter did not move: it numbers the log, not the sky");

    // The same day again — a re-fired hook, a dragged clock, two callers at once.
    dice = 0;
    cacheWrites = 0;
    await advance(60);
    await Promise.all([travelMod.settleAllOnDayChange(day0 + 1), travelMod.settleAllOnDayChange(day0 + 1)]);
    await drain();
    assert.equal(runsOf(ids.a).rainy, 1, "a day already settled pays nothing more");
    assert.equal(runsOf(ids.b).rainy, 1);
    assert.equal(dice, 0);
    assert.equal(cacheWrites, 0);
    assert.equal(weatherOf(ids.a).settledDay, day0 + 1);

    // Three days in one step: three days of ground, three skies, one cache write.
    dice = 0;
    cacheWrites = 0;
    await advance(3 * DAY);
    assert.equal(calendarDay(), day0 + 4);
    assert.equal(runsOf(ids.a).rainy, 4, "each crossed day settled the ground, in order");
    assert.equal(runsOf(ids.b).tempModerate, 4);
    assert.deepEqual(Object.keys(cacheOf()).map(dayOfKey).sort((x, y) => x - y), [day0 + 1, day0 + 2, day0 + 3, day0 + 4], "one key per day");
    assert.equal(dice, 18, "three skies for the two parties");
    assert.equal(cacheWrites, 1, "the cache is written once for the whole step");
    assert.equal(weatherOf(ids.a).settledDay, day0 + 4);

    // A party that is not journeying keeps the mark and no weather.
    assert.equal(weatherOf(ids.delve).settledDay, day0 + 4, "a delving party is stamped each day");
    assert.deepEqual(runsOf(ids.delve), {}, "and its ground is not settled");
    assert.equal(weatherOf(ids.delve).rolls ?? null, null, "nor given a sky");

    // The calendar's season, not the declared one, keys the sky it settles.
    setCalendar([{ name: "Q0" }, { name: "Q1" }, { name: "Q2" }, { name: "Q3" }]);
    game.time.components.season = 1;
    const seen = travelMod.effectiveSeason(travelMod.travelOf(model.getFormation(ids.a)));
    assert.deepEqual(seen, { season: "summer", fromCalendar: true, calendarName: "Q1" }, "a four-season calendar maps by position");
    await advance(DAY);
    assert.ok(Object.keys(cacheOf()).includes(`${day0 + 5}|Af|summer`), "the new day's sky is keyed on the calendar's season");
    assert.equal(weatherOf(ids.a).season, "spring", "the declared season is left as the Judge set it");
    setCalendar();

    // End day with a calendar but the clock left alone: a log row, no weather.
    await game.settings.set(MODULE_ID, "advanceWorldTime", false);
    const before = JSON.stringify(weatherOf(ids.b));
    const keys = Object.keys(cacheOf()).length;
    const rows = model.getFormation(ids.b).travel.log?.length ?? 0;
    const advanced = game.time.advanced.length;
    await travelMod.endDay(ids.b);
    await drain();
    assert.equal(model.getFormation(ids.b).travel.log.length, rows + 1, "the day is logged");
    assert.equal(game.time.advanced.length, advanced, "the clock was not moved");
    assert.equal(JSON.stringify(weatherOf(ids.b)), before, "End day fakes no day: the sky and the ground stand");
    assert.equal(Object.keys(cacheOf()).length, keys);

    // With the clock moved to dawn, the day change settles the new day once.
    await game.settings.set(MODULE_ID, "advanceWorldTime", true);
    // The sky B holds is the summer day's, so its drizzle run is the one that climbs.
    assert.equal(weatherOf(ids.b).precipitation, "drizzly");
    const drizzleBefore = runsOf(ids.b).drizzly;
    const day = calendarDay();
    await travelMod.endDay(ids.b);
    await drain();
    await drain();
    assert.equal(calendarDay(), day + 1, "the jump to dawn crossed one day change");
    assert.equal(runsOf(ids.b).drizzly, drizzleBefore + 1, "End day itself settled nothing; the day change settled the ground once");
    assert.equal(weatherOf(ids.b).settledDay, day + 1);
    assert.ok(Object.keys(cacheOf()).includes(`${day + 1}|Af|spring`));

    // No calendar, no day change to watch: End day settles its own day, by its counter.
    dropCalendar();
    assert.equal(calendarDay(), null);
    const counted = model.getFormation(ids.a).travel.dayCount ?? 0;
    const rain = runsOf(ids.a).rainy;
    const mark = weatherOf(ids.a).settledDay;
    await travelMod.endDay(ids.a);
    await drain();
    assert.equal(model.getFormation(ids.a).travel.dayCount, counted + 1);
    assert.equal(runsOf(ids.a).rainy, rain + 1, "the finished day settled onto the ground");
    assert.ok(Object.keys(cacheOf()).includes(`${counted + 1}|Af|spring`), "the next sky is keyed on the End-day counter");
    assert.equal(weatherOf(ids.a).settledDay, mark, "the counter never touches the calendar's watermark");
  } finally {
    Math.random = realRandom;
    game.settings.set = realSet;
    dropCalendar();
    await game.settings.set(MODULE_ID, "advanceWorldTime", advanceSetting);
    await game.settings.set(MODULE_ID, "skyCache", {});
    unregisterTable(WEATHER_DOC, { priority: PRIORITY.WORLD });
    for (const f of Object.values(readFormations())) await model.disband(f);
    await drain();
    void clock0; // the shared clock only ever moves forward; it is never set back
  }
});

/**
 * Take a stay on a city map and hand back its card.
 *
 * An invented incident list is reachable two ways, as in a live world: named by
 * the map (`map`) or imported as the world's own table (`worldList`). The dice
 * come off `faces` in the order they are thrown — one a day for the stay, then
 * one per draw — and every formula thrown is recorded. The transient-marker
 * setting is armed, so a stay that left a Note would have tried to.
 */
async function takeStay({ faces, hour = "day", days = 3, start = 0, cadence = true, map = false, worldList = false }) {
  const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
  const { SETTLEMENT_DOC, freshSettlement } = await import("../scripts/formation/settlement.mjs");
  const { writeSceneIncidents } = await import("../scripts/battlemap/scene-setup.mjs");
  const settlementTurn = await import("../scripts/formation/settlement-turn.mjs");
  const list = {
    name: "Invented Stay List",
    formula: "1d100",
    results: [
      { range: [1, 40], text: "Invented low incident." },
      { range: [41, 80], text: "Invented middle incident." },
      { range: [81, 200], text: "Invented high incident." },
    ],
  };
  if (cadence) {
    registerTable(
      {
        id: SETTLEMENT_DOC,
        source: "invented",
        tables: { encounters: { holedUp: { any: { everyTurns: 1, throw: 4 } } }, encounterAfterDark: 30 },
      },
      { priority: PRIORITY.WORLD, source: "test" },
    );
  }

  const city = new SceneMock("Stay City");
  game.scenes.set(city.id, city);
  if (map) {
    uuidMap.set("RollTable.stayList", list);
    await writeSceneIncidents(city, { tableUuid: "RollTable.stayList", afterDark: 30 });
  }
  const priorRoll = globalThis.Roll;
  const priorTables = game.tables;
  const priorPacks = game.packs;
  const priorTurns = game.settings.get(MODULE_ID, "transientIncidentTurns");
  const thrown = [];
  const queue = [...faces];
  globalThis.Roll = class {
    constructor(formula) {
      this.formula = formula;
    }
    async evaluate() {
      thrown.push(this.formula);
      this.total = queue.length ? queue.shift() : 1;
      return this;
    }
    async render() {
      return `<div class="dice-roll">${this.total}</div>`;
    }
  };
  const world = { ...list, flags: { [MODULE_ID]: { cookbook: { id: "jj.settlementEncounters" } } } };
  game.tables = { contents: [], get: () => null, find: (fn) => (worldList && fn(world) ? world : null) };
  game.packs = [];
  await game.settings.set(MODULE_ID, "transientIncidentTurns", 5);

  try {
    const guest = await member("Lodger");
    await drain();
    const [token] = await city.createEmbeddedDocuments("Token", [
      { name: "Lodger", actorId: guest.id, x: 800, y: 800 },
    ]);
    await game.settings.set(MODULE_ID, "formations", {}); // isolate
    let formation = await model.createFormation("Stay Party");
    formation = await model.addMember(formation, guest, token);
    await drain();
    const id = onlyFormation().id;
    await model.patchFormation(id, (rec) => {
      rec.travel = { mode: "settlement", settlement: { ...freshSettlement(), where: "holedUp", hour, days: start } };
    });
    await drain();

    const created = [];
    const place = city.createEmbeddedDocuments.bind(city);
    city.createEmbeddedDocuments = (type, ...rest) => {
      created.push(type);
      return place(type, ...rest);
    };
    const from = chat.length;
    const result = await settlementTurn.runHoledUpDays(model.getFormation(id), days);
    await drain();
    const cards = chat.slice(from).filter((m) => String(m.content).includes("settlement.card.stayTitle"));
    await model.disband(model.getFormation(id));
    await drain();
    return { result, cards, content: String(cards.at(-1)?.content ?? ""), thrown, created };
  } finally {
    globalThis.Roll = priorRoll;
    game.tables = priorTables;
    game.packs = priorPacks;
    await game.settings.set(MODULE_ID, "transientIncidentTurns", priorTurns);
    uuidMap.delete("RollTable.stayList");
    unregisterTable(SETTLEMENT_DOC, { priority: PRIORITY.WORLD });
    game.scenes.delete(city.id);
  }
}

await scenario("a stay draws an incident for each day that was met, on the map's list", async () => {
  // Days 5, 6 and 7 are thrown for and the first and last are met; the day
  // between passes quietly and draws nothing. The draws come off the map's own
  // list, which the street turn also walks ahead of the world's.
  const stay = await takeStay({ faces: [5, 2, 6, 10, 60], start: 4, map: true });
  const c = stay.content;
  assert.equal(stay.result.credited, 3);
  assert.equal(stay.cards.length, 1, "one stretch, one card");
  assert.ok(c.includes('interrupted {"count":2,"days":"5, 7"}'), "the card still counts the interrupted days");
  const at = (s) => c.indexOf(s);
  assert.ok(at('stayDay {"day":5}') >= 0 && at('stayDay {"day":7}') > at('stayDay {"day":5}'), "a draw under each met day, in order");
  assert.ok(!c.includes('stayDay {"day":6}'), "the quiet day draws nothing");
  assert.ok(at("Invented low incident.") > at('stayDay {"day":5}') && at("Invented low incident.") < at('stayDay {"day":7}'),
    "day 5's face reads the low band, under day 5");
  assert.ok(at("Invented middle incident.") > at('stayDay {"day":7}'), "day 7's face reads the middle band, under day 7");
  assert.ok(c.includes('incidentDrawn {"roll":10,"total":10') && !c.includes("incidentBanded"), "by day no after-dark shift is claimed");
  assert.deepEqual(stay.thrown, ["1d6", "1d6", "1d6", "1d100", "1d100"], "a die a day, then the list's own die per met day");
  assert.ok(!stay.created.includes("Note"), "the party was indoors: no marker is left on the street");
  assert.ok(!c.includes("poi-promote") && !c.includes("settlement.card.marker"), "and the card offers none");
});

await scenario("a stay at night draws with the after-dark shift, for the map's list and the world's", async () => {
  // The stay's hour is the one its cadence was resolved at, and every draw is
  // made at it: the same faces that read the middle band by day reach the band
  // past the die once the shift is added.
  const mapped = await takeStay({ faces: [5, 2, 6, 20, 70], hour: "night", map: true });
  const m = mapped.content;
  assert.ok(m.includes('incidentBanded {"roll":20,"total":50') && m.includes("Invented middle incident."), "roll 20 + 30 reads the middle band");
  assert.ok(m.includes('incidentBanded {"roll":70,"total":100') && m.includes("Invented high incident."), "roll 70 + 30 reaches the band past the die");
  assert.ok(m.includes('stayDay {"day":1}') && m.includes('stayDay {"day":3}') && !m.includes('stayDay {"day":2}'));

  const imported = await takeStay({ faces: [6, 55], hour: "night", days: 1, worldList: true });
  assert.ok(imported.content.includes('incidentBanded {"roll":55,"total":85') && imported.content.includes("Invented high incident."),
    "the world's imported table reads the registry's shift the same way");
  const daylight = await takeStay({ faces: [6, 35], hour: "day", days: 1, worldList: true });
  assert.ok(daylight.content.includes('incidentDrawn {"roll":35,"total":35') && daylight.content.includes("Invented low incident."),
    "and by day it reads the bare roll");
});

await scenario("a stay with no met day draws nothing", async () => {
  const stay = await takeStay({ faces: [1, 2, 3], map: true });
  assert.ok(stay.content.includes('undisturbed {"throws":3}'), "the card says nothing found them");
  assert.ok(!stay.content.includes("stayDay") && !stay.content.includes("Invented"), "and carries no draw");
  assert.deepEqual(stay.thrown, ["1d6", "1d6", "1d6"], "no incident die was thrown");
});

await scenario("a stay that cannot be priced, or has no incident list, still says so", async () => {
  // No cadence imported: nothing is thrown, and the card says what is missing
  // in the turn's words.
  const unpriced = await takeStay({ faces: [], cadence: false, map: true });
  assert.ok(unpriced.content.includes('settlement.card.unpriced {"what":"encounters"}'));
  assert.ok(!unpriced.content.includes("stayDay"));
  assert.deepEqual(unpriced.thrown, [], "no die was thrown for a street nobody priced");

  // Priced, but no list anywhere in the order: each met day says there is no
  // incident table, in the turn's words, rather than inventing a draw.
  const bare = await takeStay({ faces: [5, 6], days: 2 });
  const said = bare.content.split("settlement.card.noIncidentTable").length - 1;
  assert.equal(said, 2, "one such line under each met day");
  assert.ok(bare.content.includes('stayDay {"day":1}') && bare.content.includes('stayDay {"day":2}'));
  assert.ok(!/incident(Drawn|Banded|Plain)|settlement\.card\.incident \{/.test(bare.content), "and no incident is claimed");
});

await scenario("a lost episode reads every seat's fog from the server", async () => {
  const lostFog = await import("../scripts/formation/lost-fog.mjs");
  const { exploredDocs, writeExplored, deleteExplored } = await import("../scripts/formation/map-items.mjs");
  // The server holds a player's fog that the Judge's client never loaded — the
  // shape every earlier session leaves — plus an older copy of it.
  const server = new Map();
  const put = (d) => server.set(d._id, { ...d });
  put({ _id: "older", scene: "S1", user: "PL1", level: "L0", explored: "seen-before", timestamp: 1 });
  put({ _id: "newest", scene: "S1", user: "PL1", level: "L0", explored: "seen", timestamp: 5 });
  put({ _id: "judge", scene: "S1", user: "GM1", level: "L0", explored: "judge-view", timestamp: 3 });
  put({ _id: "away", scene: "S2", user: "PL1", level: "L0", explored: "elsewhere", timestamp: 9 });
  const held = new (class extends Map {
    filter(fn) { return [...this.values()].filter(fn); }
    find(fn) { return [...this.values()].find(fn); }
  })();
  // Core resolves an update's response, and a delete's request, in the local
  // collection: a target this client never loaded throws, as it does live.
  class FogDoc {
    constructor(src) { Object.assign(this, src); this.id = src._id; }
    async update(changes) {
      assert.ok(held.has(this.id), "a write's response finds its target in the collection");
      Object.assign(server.get(this.id), changes);
    }
    async delete() { return FogDoc.deleteDocuments([this.id]); }
    static async deleteDocuments(ids) {
      for (const id of ids) if (!held.has(id)) throw new Error(`FogExploration id [${id}] does not exist in the FogExplorations collection.`);
      for (const id of ids) { server.delete(id); held.delete(id); }
    }
    static database = {
      get: async (_cls, { query }) => [...server.values()]
        .filter((d) => Object.entries(query).every(([k, v]) => d[k] === v)).map((d) => new FogDoc(d)),
    };
    static async create(data) { const d = { _id: `made${server.size}`, ...data }; put(d); held.set(d._id, new FogDoc(d)); }
  }
  const saved = { cls: foundry.utils.getDocumentClass, collections: game.collections };
  const socket = getSocket();
  const savedEveryone = socket?.executeForEveryone;
  foundry.utils.getDocumentClass = (name) => (name === "FogExploration" ? FogDoc : undefined);
  game.collections = { get: (name) => (name === "FogExploration" ? held : undefined) };
  if (socket) socket.executeForEveryone = async () => {};
  try {
    const docs = await exploredDocs("S1", "L0");
    assert.deepEqual(docs.map((d) => d.id).sort(), ["judge", "newest"], "each seat's newest copy, on this scene only");

    const snap = await lostFog.snapshotFog("S1", "L0");
    assert.equal(snap.PL1, "seen", "the snapshot holds the player's fog the Judge never loaded");
    server.get("newest").explored = "seen+faked";
    await lostFog.restoreFog("S1", snap, "L0", { complete: true });
    assert.equal(server.get("newest").explored, "seen", "the restore writes onto the player's own document");
    assert.ok(server.has("older"), "an older copy is not touched");
    assert.equal([...server.values()].filter((d) => d.user === "PL1" && d.scene === "S1").length, 2, "and nothing is created");
    assert.equal(held.size, 0, "the seat a write took in the collection is given back");

    // A snapshot taken from the Judge's client alone cannot tell a seat with no
    // fog from one it never saw: the player's document survives its restore.
    await lostFog.restoreFog("S1", { GM1: "judge-view", PL1: null }, "L0", { complete: false });
    assert.ok(server.has("newest"), "an incomplete snapshot deletes no document it never saw");

    await writeExplored(new FogDoc(server.get("judge")), "judge-view-2");
    assert.equal(server.get("judge").explored, "judge-view-2", "a direct write lands on the server copy");

    // A seat the complete snapshot recorded as empty loses the document the
    // episode made for it, though a reload since means this client never held it.
    put({ _id: "faked", scene: "S1", user: "PL2", level: "L0", explored: "faked-only", timestamp: 7 });
    await lostFog.restoreFog("S1", { GM1: "judge-view", PL1: "seen" }, "L0", { complete: true });
    assert.ok(!server.has("faked"), "a complete restore deletes a document this client never loaded");
    assert.equal(server.get("newest").explored, "seen", "and still writes the recorded seats");
    assert.equal(held.size, 0, "every seat taken for the delete is given back");

    await deleteExplored([new FogDoc(server.get("older"))]);
    assert.ok(!server.has("older"), "an older copy read from the server can be deleted");
  } finally {
    foundry.utils.getDocumentClass = saved.cls;
    game.collections = saved.collections;
    if (socket) socket.executeForEveryone = savedEveryone;
  }
});

await scenario("a wandering monster off its floor is compared at the level of the table that named it", async () => {
  // See docs/formation/DECISIONS.md, "A table's monster level is set on the table".
  const { shiftSources } = await import("../scripts/formation/encounter-scaling.mjs");
  const table = (uuid, level) => ({
    uuid,
    id: uuid,
    name: uuid,
    flags: level ? { [MODULE_ID]: { monsterLevel: level } } : {},
    getFlag(ns, key) {
      return this.flags?.[ns]?.[key];
    },
  });
  const drawnFrom = (...parents) => parents.map((parent) => ({ parent }));
  const pairs = (sources) => sources.map((s) => [s.table.uuid, s.level]);
  const matrix = table("RollTable.matrix", null);
  const low = table("RollTable.low", 2);
  const high = table("RollTable.high", 4);
  const bare = table("RollTable.bare", null);
  const wrapper = table("RollTable.wrapper", 3);

  assert.deepEqual(pairs(shiftSources(matrix, drawnFrom(low))), [["RollTable.low", 2]], "the inner table names the level");
  assert.deepEqual(pairs(shiftSources(wrapper, drawnFrom(wrapper))), [["RollTable.wrapper", 3]], "a plain draw reads the named table");
  assert.deepEqual(pairs(shiftSources(wrapper, drawnFrom(bare))), [["RollTable.bare", 3]], "an inner table stating none takes the named table's");
  assert.deepEqual(shiftSources(matrix, drawnFrom(bare)), [], "a level set nowhere scales nothing");
  assert.deepEqual(
    pairs(shiftSources(matrix, drawnFrom(low, high, low))),
    [["RollTable.low", 2], ["RollTable.high", 4]],
    "one source per producing table, each at its own level",
  );
  assert.deepEqual(shiftSources(matrix, undefined), [], "nothing drawn, nothing compared");

  // Wired end to end: the zone under the party token supplies the dungeon
  // level through its behavior's data, and the card names the inner table.
  const runner = await member("Delver");
  await drain();
  const [rToken] = await scene.createEmbeddedDocuments("Token", [{ name: "Delver", actorId: runner.id, x: 1000, y: 1000 }]);
  await game.settings.set(MODULE_ID, "formations", {});
  let formation = await model.createFormation("Deep Party");
  formation = await model.addMember(formation, runner, rToken);
  await drain();
  const outer = {
    ...table("RollTable.outer", null),
    draw: async () => ({ roll: { total: 1 }, results: drawnFrom(low) }),
    toMessage: async () => null,
  };
  uuidMap.set(outer.uuid, outer);
  const zone = {
    id: uid("reg"),
    name: "Deep Zone",
    elevation: {},
    testPoint: () => true,
    behaviors: [
      {
        type: "acks-extras.encounterZone",
        disabled: false,
        system: { tableUuid: outer.uuid, encounterEvery: 0, encounterTarget: 1, dungeonLevel: 5 },
      },
    ],
  };
  scene.regions.set(zone.id, zone);
  const shiftCards = (from) => chat.slice(from).filter((m) => m.flavor === "ACKS-FORMATION.scaling.flavor");
  try {
    let from = chat.length;
    assert.equal(await engine.encounterCheck(model.getFormation(onlyFormation().id), { manual: true }), true, "the throw hits");
    const [card, ...extra] = shiftCards(from);
    assert.ok(card, "a shift card is posted");
    assert.equal(extra.length, 0, "and only one");
    assert.equal(card.speaker?.alias, "RollTable.low", "named for the table that named the monster");
    assert.match(card.content, /"monster":2/, "at that table's level");
    assert.match(card.content, /"dungeon":5/, "against the zone's dungeon level");
    assert.deepEqual(card.whisper, ["GM1"], "to the Judge alone");

    zone.behaviors[0].system.dungeonLevel = 0;
    from = chat.length;
    await engine.encounterCheck(model.getFormation(onlyFormation().id), { manual: true });
    assert.equal(shiftCards(from).length, 0, "a zone with no dungeon level compares nothing");
  } finally {
    scene.regions.delete(zone.id);
    uuidMap.delete(outer.uuid);
    await model.disband(model.getFormation(onlyFormation().id));
    await drain();
  }
});

await scenario("a door's construction and marks persist, a botch reports its damage, a batter spends its turns", async () => {
  const doors = await import("../scripts/formation/doors.mjs");
  const { default: DoorApp } = await import("../scripts/formation/door-app.mjs");

  // A wall document as far as the door code touches one: Foundry merges an
  // object flag into what is stored, and a wall update writes its fields.
  const wall = {
    door: 1,
    ds: 0,
    flags: {},
    getFlag(ns, key) {
      return this.flags[ns]?.[key];
    },
    async setFlag(ns, key, value) {
      const at = (this.flags[ns] ??= {});
      at[key] = { ...(at[key] ?? {}), ...foundry.utils.deepClone(value) };
      return this;
    },
    async update(patch) {
      Object.assign(this, patch);
      return this;
    },
  };

  const basher = await member("Basher");
  await drain();
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  const priorRoll = globalThis.Roll;
  const priorControlled = canvas.tokens.controlled;
  const hadSpeaker = "getSpeaker" in ChatMessage;
  const hadExpand = "expandObject" in foundry.utils;
  ChatMessage.getSpeaker = () => ({});
  // Flat field names only, so a form's object is already its expansion.
  foundry.utils.expandObject = (o) => o;
  canvas.tokens.controlled = [{ actor: basher }];
  /** A d20 that shows `natural`, whatever the modifier asked of it. */
  const rigRoll = (natural) => {
    globalThis.Roll = class {
      constructor(formula) {
        this.formula = formula;
      }
      async evaluate() {
        const modifier = Number(this.formula.split("+")[1]) || 0;
        this.dice = [{ results: [{ result: natural }] }];
        this.total = natural + modifier;
        return this;
      }
      async render() {
        return `<div class="dice-roll">${this.total}</div>`;
      }
    };
  };
  const submit = (app, fields) =>
    DoorApp.DEFAULT_OPTIONS.form.handler.call(app, null, null, {
      object: { crowbar: false, sizeSteps: 0, extra: 0, partnerId: "", ...fields },
    });

  try {
    /* --- the construction, and the two marks, are written to the wall --- */
    const app = new DoorApp(wall);
    const defaults = doors.doorState(wall);
    assert.equal(defaults.evil, false);
    assert.equal(defaults.jammed, false);
    const other = Object.keys(doors.DOOR_KINDS).find((k) => k !== defaults.kind);
    await submit(app, { kind: other, evil: true, jammed: false });
    let state = doors.doorState(wall);
    assert.equal(state.kind, other, "the construction select writes the wall");
    assert.equal(state.evil, true, "the evil mark writes the wall");
    assert.equal(state.jammed, false);
    assert.equal(wall.flags[MODULE_ID].door.kind, other, "under the door flag, where doorState reads it");
    assert.equal(doors.batterPlan(wall).kind, doors.DOOR_KINDS[other], "and the plan follows the construction");

    await submit(app, { kind: other, evil: false, jammed: true });
    state = doors.doorState(wall);
    assert.deepEqual([state.kind, state.evil, state.jammed], [other, false, true], "an unticked mark is cleared, a ticked one set");

    const bad = await doors.setDoorTraits(wall, { kind: "notAConstruction" });
    assert.equal(bad.state.kind, other, "an unknown construction is not stored");
    await doors.setDoorTraits(wall, { kind: defaults.kind, evil: false, jammed: false });
    wall.flags[MODULE_ID].door.spikes = 2;
    await submit(app, { kind: other, evil: true, jammed: true });
    assert.equal(doors.doorState(wall).spikes, 2, "a write to the marks leaves the spikes alone");
    await doors.setDoorTraits(wall, { kind: defaults.kind, evil: false, jammed: false });

    /* --- a botch reports its damage on the card and writes nothing --- */
    const hpBefore = basher.system.hp.value;
    rigRoll(1);
    let from = chat.length;
    const botched = await doors.bashDoor(wall, { actor: basher });
    assert.equal(botched.botch, true);
    assert.ok(botched.damage > 0, "a botch deals damage");
    const [card] = chat.slice(from);
    assert.ok(card.content.includes("ACKS-FORMATION.doors.damageTo"), "the card carries the damage line");
    assert.ok(card.content.includes(`"damage":${botched.damage}`), "with the figure the roll returned");
    assert.ok(card.content.includes("ACKS-FORMATION.doors.damageIsReported"), "and says it is not applied");
    assert.equal(basher.system.hp.value, hpBefore, "the sheet is untouched");

    rigRoll(9);
    from = chat.length;
    const held = await doors.bashDoor(wall, { actor: basher });
    assert.equal(held.damage, 0);
    assert.ok(!chat.slice(from)[0].content.includes("damageTo"), "an ordinary miss carries no damage line");

    /* --- a batter charges the basher's formation, and only that one --- */
    const unheld = await doors.batterDoor(wall, basher);
    assert.equal(unheld.ok, true);
    assert.equal(unheld.spent, 0, "no formation holds the basher: nothing is spent");
    assert.equal(unheld.formation, null);
    assert.equal(wall.ds, 1, "the door still opens");
    notices.length = 0;
    wall.ds = 0;
    await DoorApp.DEFAULT_OPTIONS.actions.batter.call(app);
    assert.match(notices.at(-1)[1], /batteredNoClock/, "the notice says no clock ran");

    let formation = await model.createFormation("Door Party");
    formation = await model.addMember(formation, basher, null);
    await drain();
    const id = onlyFormation().id;
    const plan = doors.batterPlan(wall);
    assert.ok(plan.ok && plan.turns > 0, "the chosen construction can be battered");
    const turnsBefore = onlyFormation().clock.turnsTotal;
    wall.ds = 0;
    const r = await doors.batterDoor(wall, basher);
    await drain();
    assert.equal(r.spent, plan.turns);
    assert.equal(onlyFormation().clock.turnsTotal, turnsBefore + plan.turns, "the formation's clock advanced by the plan's turns");
    assert.equal(wall.ds, 1);

    notices.length = 0;
    wall.ds = 0;
    await DoorApp.DEFAULT_OPTIONS.actions.batter.call(app);
    await drain();
    assert.match(notices.at(-1)[1], new RegExp(`batteredDown.*"turns":${plan.turns}`), "the notice states the turns spent");
    assert.equal(onlyFormation().clock.turnsTotal, turnsBefore + 2 * plan.turns);

    await doors.setDoorTraits(wall, { kind: "portcullis" });
    const solid = await doors.batterDoor(wall, basher);
    assert.deepEqual([solid.ok, solid.reason], [false, "tooSolid"], "a construction an axe cannot beat spends nothing");
    assert.equal(onlyFormation().clock.turnsTotal, turnsBefore + 2 * plan.turns);

    await model.disband(model.getFormation(id));
    await drain();
  } finally {
    globalThis.Roll = priorRoll;
    canvas.tokens.controlled = priorControlled;
    if (!hadSpeaker) delete ChatMessage.getSpeaker;
    if (!hadExpand) delete foundry.utils.expandObject;
  }
});

await scenario("a forced march is barred by a marcher's survival state; only the Judge overrides it", async () => {
  const { freshSurvival } = await import("../scripts/lib/survival.mjs");
  const travelMod = await import("../scripts/formation/travel.mjs");
  const { offerDayEnd } = await import("../scripts/formation/day-close.mjs");
  const onRung = (actor, rungs) => actor.setFlag(MODULE_ID, "survival", { ...freshSurvival(), ...rungs });

  const wren = await member("Wren");
  const moss = await member("Moss");
  const pike = await member("Pike");
  await drain();
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Bar Party");
  for (const actor of [wren, moss, pike]) {
    formation = await model.addMember(model.getFormation(formation.id), actor, null);
  }
  await drain();
  const id = onlyFormation().id;
  const dayKind = () => travelMod.travelOf(model.getFormation(id)).day.kind;
  const lastWarn = () => notices.filter(([level]) => level === "warn").at(-1)?.[1] ?? "";
  const barNotes = () => chat.filter((m) => String(m.content).includes("travel.forcedBar.note"));
  const toMarch = () => travelMod.setDayKind(id, "march");

  // A plain rung bars nothing: hunger that only costs throws is not a barred march.
  await onRung(moss, { nourishment: "hungry" });
  assert.ok(await travelMod.setDayKind(id, "forced"), "a member on a rung that forbids no march does not block");
  assert.equal(dayKind(), "forced");
  await toMarch();

  // Each ladder's forbidding rung bars it, and the warning names exactly those.
  await onRung(moss, { nourishment: "underfed" });
  notices.length = 0;
  assert.equal(await travelMod.setDayKind(id, "forced"), false, "a barred member refuses the forced march");
  assert.equal(dayKind(), "march", "and the day stays what it was");
  assert.match(lastWarn(), /forcedMarchBarred.*Moss/, "the warning names the barred member");
  assert.ok(!/Wren|Pike/.test(lastWarn()), "and not the others");
  await onRung(pike, { hydration: "dehydrated" });
  await onRung(wren, { exposure: "hypothermic" });
  notices.length = 0;
  assert.equal(await travelMod.setDayKind(id, "forced"), false);
  assert.match(lastWarn(), /Wren, Moss, Pike/, "thirst and cold bar it as hunger does, named in roster order");
  assert.equal(barNotes().length, 0, "a refusal whispers nothing");

  // A member left behind is not marching.
  const leaveBehind = (...actors) => model.patchFormation(id, (rec) => {
    for (const m of rec.members) m.left = actors.some((a) => a.id === m.actorId);
  });
  await leaveBehind(moss, pike);
  notices.length = 0;
  assert.equal(await travelMod.setDayKind(id, "forced"), false, "the one still marching is barred");
  assert.ok(/Wren/.test(lastWarn()) && !/Moss|Pike/.test(lastWarn()), "and only the one marching is named");
  await onRung(pike, {});
  await leaveBehind(wren, moss);
  assert.ok(await travelMod.setDayKind(id, "forced"), "barred members left behind do not bar the march");
  await toMarch();
  await onRung(pike, { hydration: "dehydrated" });
  await leaveBehind();

  // A seat that is not the Judge's gets no override.
  const gmUser = game.user;
  game.user = game.users.get("PL1");
  try {
    assert.equal(await travelMod.setDayKind(id, "forced", { override: true }), false, "a player's override is not heard");
  } finally {
    game.user = gmUser;
  }
  assert.equal(dayKind(), "march");

  // The sheet's form obeys the same bar: the kind alone is dropped, the rest lands.
  notices.length = 0;
  await travelMod.applyTravelForm(id, { ground: "hills", day: { kind: "forced" } });
  assert.equal(dayKind(), "march", "the form cannot set a barred forced march");
  assert.equal(travelMod.travelOf(model.getFormation(id)).ground, "hills", "but the rest of the form still lands");
  assert.match(lastWarn(), /forcedMarchBarred.*Wren/, "and the seat is told who bars it");
  await travelMod.applyTravelForm(id, { day: { kind: "camp" } });
  assert.equal(dayKind(), "camp", "a day-kind the bar does not concern is untouched");
  await toMarch();

  // The dusk offer's push answer refuses the same way and does not close the day.
  const DialogV2 = foundry.applications.api.DialogV2;
  const priorWait = DialogV2.wait;
  DialogV2.wait = async () => "push";
  try {
    await model.patchFormation(id, (rec) => {
      const t = travelMod.travelOf(rec);
      rec.travel = { ...t, mode: "journey", day: { ...t.day, hours: 99, miles: 99 } };
    });
    const logged = () => travelMod.travelOf(model.getFormation(id)).log.length;
    const before = logged();
    notices.length = 0;
    assert.equal(await offerDayEnd(id), "barred", "the push is refused");
    assert.equal(dayKind(), "march", "the day is not forced");
    assert.equal(logged(), before, "and the day is not closed");
    assert.match(lastWarn(), /forcedMarchBarred/, "the Judge is told why");
  } finally {
    DialogV2.wait = priorWait;
  }

  // The Judge overrides: the kind is set and the Judges are whispered who was barred.
  assert.ok(await travelMod.setDayKind(id, "forced", { override: true }), "the Judge's override sets the kind");
  assert.equal(dayKind(), "forced");
  assert.equal(barNotes().length, 1, "and one note is posted");
  const note = barNotes()[0];
  assert.deepEqual(note.whisper, ["GM1"], "to the Judges alone");
  assert.ok(/Wren/.test(note.content) && /Moss/.test(note.content) && /Pike/.test(note.content), "naming the barred members");
  assert.ok(await travelMod.setDayKind(id, "forced"), "a day already forced is not asked again");
  assert.equal(barNotes().length, 1, "and posts nothing more");

  // The form path takes the same override.
  await toMarch();
  await travelMod.applyTravelForm(id, { day: { kind: "forced" } }, { override: true });
  assert.equal(dayKind(), "forced", "the form takes the Judge's override");
  assert.equal(barNotes().length, 2);

  // Fed again, the party marches without asking.
  await toMarch();
  for (const actor of [wren, moss, pike]) await onRung(actor, {});
  assert.ok(await travelMod.setDayKind(id, "forced"), "no barred member, no bar");
  assert.equal(barNotes().length, 2);

  await model.disband(model.getFormation(id));
  await drain();
});

if (failures) {
  console.error(`test-flows: ${failures} scenario(s) FAILED`);
  process.exit(1);
}
console.log("test-flows: all scenarios passed");
