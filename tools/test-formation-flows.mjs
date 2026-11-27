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
import { standOnRegions } from "./region-fixture.mjs";
import { TIME_COUNTS, ROUND_SECONDS } from "./time-unit-fixture.mjs";

// One namespace now, not eight globals; stubs below hang off it.
globalThis.acksExtras ??= {};

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

/**
 * The mock's clock: `ms` turns of the event loop's check phase. A write that
 * waits 2 resolves after one begun beside it that waits 1, as with timers.
 * Never a timer: one waits the platform's granularity (about 10 ms on
 * Windows), and the scenarios drain hundreds of times.
 */
const sleep = async (ms = 1) => {
  for (let i = 0; i < ms; i++) await new Promise((r) => setImmediate(r));
};
let nextId = 0;
const uid = (p = "id") => `${p}${(++nextId).toString().padStart(4, "0")}`;

const hooks = new Map();
globalThis.Hooks = {
  // Core hands back an id that `off` takes; the mock's id is the listener itself, which `off` also takes.
  on(name, fn) {
    if (!hooks.has(name)) hooks.set(name, []);
    hooks.get(name).push(fn);
    return fn;
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
  /** Core's `Hooks.call`: the first listener to return `false` stops the rest and the call answers `false`. */
  call(name, ...args) {
    for (const fn of [...(hooks.get(name) ?? [])]) {
      try {
        if (fn(...args) === false) return false;
      } catch (err) {
        console.error(`hook ${name} threw`, err);
      }
    }
    return true;
  },
  callAll(name, ...args) {
    for (const fn of [...(hooks.get(name) ?? [])]) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`hook ${name} threw`, err);
      }
    }
    return true;
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
    debounce: (fn) => fn,
  },
  abstract: { TypeDataModel: class {}, DataModel: class {} },
  data: {
    fields: new Proxy({}, { get: () => FieldStub }),
    regionBehaviors: { RegionBehaviorType: class {} },
    // The mocks' writes replace an object at its path, which is what a forced replacement asks of core.
    operators: { ForcedReplacement: { create: (value) => value }, ForcedDeletion: class ForcedDeletion {} },
  },
  applications: {
    api: {
      ApplicationV2: class {
        constructor(options = {}) {
          this.options = options;
        }
        async _onFirstRender() {}
        async _onClose() {}
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
        _configureRenderOptions() {}
        async _onFirstRender() {}
        async _onRender() {}
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
  WALL_DOOR_TYPES: { NONE: 0, DOOR: 1, SECRET: 2 }, // matches core v14
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
    for (const [k, v] of Object.entries(changes)) {
      // Core's forced deletion removes the key, as the actor's update does.
      const at = k.lastIndexOf(".");
      if (v instanceof foundry.data.operators.ForcedDeletion) delete foundry.utils.getProperty(this, k.slice(0, at))?.[k.slice(at + 1)];
      else setProp(this, k, v);
    }
    await sleep();
    Hooks.call("updateItem", this, changes, {}, "GM1");
    return this;
  }
  async delete() {
    this.parent.items.delete(this.id);
    uuidMap.delete(this.uuid);
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
    for (const [k, v] of Object.entries(changes)) {
      // Core's forced deletion: `{"a.b.c": ForcedDeletion}` removes `c` from `a.b`.
      const at = k.lastIndexOf(".");
      if (v instanceof foundry.data.operators.ForcedDeletion) delete foundry.utils.getProperty(this, k.slice(0, at))?.[k.slice(at + 1)];
      else setProp(this, k, v);
    }
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
  async deleteEmbeddedDocuments(type, ids) {
    assert.equal(type, "ActiveEffect");
    for (const id of ids) await this.effects.find((e) => e.id === id)?.delete();
  }
  async createEmbeddedDocuments(type, arr) {
    if (type === "ActiveEffect") {
      const made = arr.map((d) => {
        const parent = this;
        const eff = {
          ...foundry.utils.deepClone(d),
          id: uid("eff"),
          statuses: new Set(d.statuses ?? []),
          getFlag: (ns, key) => eff.flags?.[ns]?.[key],
          async update(patch) {
            Object.assign(eff, patch.statuses ? { ...patch, statuses: new Set(patch.statuses) } : patch);
          },
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
    // Core's `token.regions`: the zones the stored footprint stands in.
    standOnRegions(this);
  }
  get uuid() {
    return `Scene.${this.parent.id}.Token.${this.id}`;
  }
  get actor() {
    return game.actors.get(this.actorId) ?? null;
  }
  async delete() {
    return this.parent.deleteEmbeddedDocuments("Token", [this.id]);
  }
  /**
   * Core's stored data: the whole record. While a move is drawn, the prepared
   * `x`/`y` lag it, and every other field is the same.
   */
  get _source() {
    return this.#tween ? { ...this, ...this.#tween } : this;
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
    // Core's source carries `_id` and never `id`.
    const { parent, id, ...rest } = this;
    return foundry.utils.deepClone({ ...rest, _id: id });
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
      // Core keeps a given id only under `keepId`.
      // Core keeps a given id only under `keepId`.
      const token = new TokenMock(this, options.keepId ? data : { ...data, _id: undefined });
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
      // A listener answering false refuses the creation, as core's does.
      const refused = Hooks.call("preCreateToken", token, data, options, "GM1") === false;
      if (!written && original == null) token.delta = original;
      if (refused) continue;
      this.tokens.set(token.id, token);
      uuidMap.set(token.uuid, token);
      out.push(token);
      await sleep();
      Hooks.call("createToken", token);
    }
    // The server answers a batch in whatever order its id lookups settle; a
    // scenario arms `reverseCreates` to return it reversed.
    return this.reverseCreates ? out.reverse() : out;
  }
  async deleteEmbeddedDocuments(type, ids, options = {}) {
    assert.equal(type, "Token");
    for (const id of ids) {
      const token = this.tokens.get(id);
      if (!token) continue;
      this.tokens.delete(id);
      uuidMap.delete(token.uuid);
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
    this.flags = {};
    this.combatants = new Coll();
    this.creations = 0;
    /** `{call, until}`: the `call`-th creation waits for the `until` promise. */
    this.hold = null;
  }
  async createEmbeddedDocuments(type, arr) {
    assert.equal(type, "Combatant");
    this.creations++;
    if (this.hold?.call === this.creations) await this.hold.until;
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
  async deleteEmbeddedDocuments(type, ids) {
    assert.equal(type, "Combatant");
    for (const id of ids) {
      this.combatants.delete(id);
      await sleep();
    }
  }
  getFlag(ns, key) {
    return this.flags?.[ns]?.[key];
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

const paintLayerListeners = hooks.get("acksExtrasPaintLayerChanged")?.length ?? 0;
await import("../scripts/formation/module.mjs");
// A layer's change that writes no region re-reads the parties standing on its
// paint (test-journey drives the re-read itself).
assert.equal((hooks.get("acksExtrasPaintLayerChanged")?.length ?? 0) - paintLayerListeners, 1,
  "the formation listens for a paint layer's change");
// The formation keeps a placed member's hit points through lib's hook, which
// lib installs at init; this harness does not load lib, so install it here.
const formationPreCreateHooks = hooks.get("preCreateToken")?.length ?? 0;
const { installRecreatedHitPoints } = await import("../scripts/lib/hp.mjs");
const { KEEP_HIT_POINTS_OPTION } = await import("../scripts/lib/constants.mjs");
installRecreatedHitPoints();
const model = await import("../scripts/formation/formation-model.mjs");
const { heldByCombat } = await import("../scripts/formation/map-items.mjs");
const engine = await import("../scripts/formation/turn-engine.mjs");
const requests = await import("../scripts/formation/player-requests.mjs");
const membership = await import("../scripts/formation/membership.mjs");
const { getSocket } = await import("../scripts/lib/sockets.mjs");
const sceneSync = await import("../scripts/formation/scene-sync.mjs");
const deployment = await import("../scripts/formation/deployment.mjs");
// Light figures, invented and registered the way an import registers them: a
// source's reach and burn time are the book's, read from the Judge's copy.
const INVENTED_LIGHTS = { candle: { bright: 2, dim: 6, turns: 7 }, torch: { bright: 11, dim: 23, turns: 4 }, lantern: { bright: 13, dim: 29, turns: 9 } };
{
  const { registerTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
  const { LIGHT_DOC, LIGHT_TABLE } = await import("../scripts/lib/light.mjs");
  registerTable({ id: LIGHT_DOC, tables: { [LIGHT_TABLE]: INVENTED_LIGHTS } }, { priority: PRIORITY.WORLD });
  // Expedition figures, invented likewise: a day's hours and the speed a march is priced at.
  registerTable({ id: "travel", tables: { expedition: { feetPerMilePerDay: 7, dedicatedHours: 9, forcedHours: 14, ancillaryHours: 3, wildernessFactor: 4 } } },
    { priority: PRIORITY.WORLD });
}
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
      adventuring: { listening: 13, searching: 13, dungeonbashing: 13 },
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
  const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
  const { CONDITIONS_DOC, CONDITIONS_TABLE } = await import("../scripts/lib/conditions.mjs");
  const was = scene.environment.darknessLevel;
  try {
    // No blinded share imported: the dark names nobody slower, so the pace stands.
    scene.environment.darknessLevel = 0.9;
    assert.equal(model.blindedSpeedShare(), null, "no conditions table, no share");
    assert.equal(model.partySpeed(formation), lit, "a dark scene does not slow a pace the conditions table does not price");

    // An invented share, registered the way the import registers it.
    registerTable({ id: CONDITIONS_DOC, tables: { [CONDITIONS_TABLE]: { blinded: { speedFactor: 0.4 } } } }, { priority: PRIORITY.WORLD });
    assert.equal(model.blindedSpeedShare(), 0.4, "the imported share is what the model reads");
    assert.equal(model.partySpeed(formation), Math.floor((lit * 2) / 5), "a dark scene slows members who cannot see in it by the imported share");
    assert.equal(model.partySpeed(formation, { dark: false }), lit, "a journey that passes dark:false keeps the full pace");
    scene.environment.darknessLevel = 0;
    assert.equal(model.partySpeed(formation, { dark: true }), Math.floor((lit * 2) / 5), "a lit scene slows when the caller says it is dark");
    assert.equal(model.partySpeed(formation, { dark: false }), lit);
  } finally {
    unregisterTable(CONDITIONS_DOC, { priority: PRIORITY.WORLD });
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

await scenario("New Map resets the scene's fog, and is refused while a combat holds the party", async () => {
  const mapItems = await import("../scripts/formation/map-items.mjs");
  const mapperActor = model.getMapperActor(onlyFormation());
  assert.ok(mapperActor, "the party has a mapper");
  const resets = [];
  canvas.scene = scene;
  canvas.fog = { reset: async () => { resets.push(scene.id); } };
  const socket = getSocket();
  const savedEveryone = socket?.executeForEveryone;
  if (socket) socket.executeForEveryone = async () => {};
  const mapItemsOf = () => mapperActor.items.filter((i) => i.flags?.["acks-extras"]?.map?.active);
  try {
    notices.length = 0;
    const baseline = mapItemsOf().length;
    const oldItem = onlyFormation().mapSession?.itemUuid;
    await mapItems.startMapSession(onlyFormation());
    assert.deepEqual(resets, [scene.id], "core's fog reset runs once, before the new session opens");
    assert.notEqual(onlyFormation().mapSession?.itemUuid, oldItem, "a new working map");
    assert.equal(mapItemsOf().length, baseline, "the old map closed as the new one opened");

    // A copy older than the session: the patch declines and no stray active item is left.
    const stale = foundry.utils.deepClone(onlyFormation());
    stale.mapSession = null;
    const heldBefore = mapItemsOf().length;
    await mapItems.startMapSession(stale);
    assert.equal(mapItemsOf().length, heldBefore, "a declined session leaves no extra active Map item");

    // A combat holds the party: refused before anything closes or resets.
    const combat = new CombatMock();
    game.combats.set(combat.id, combat);
    const stored = onlyFormation();
    await combat.createEmbeddedDocuments("Combatant", [
      { tokenId: stored.tokenId, sceneId: scene.id, actorId: stored.actorId, hidden: false },
    ]);
    await drain();
    assert.ok(heldByCombat(onlyFormation()));
    const before = onlyFormation().mapSession;
    const resetsBefore = resets.length;
    notices.length = 0;
    await mapItems.startMapSession(onlyFormation());
    assert.equal(resets.length, resetsBefore, "no reset in combat");
    assert.equal(notices.filter(([k]) => k === "warn").length, 1, "the refusal is a warning");
    assert.deepEqual(onlyFormation().mapSession, before, "the old session is untouched");
    await combat.delete();
    await drain();
  } finally {
    canvas.scene = null;
    delete canvas.fog;
    if (socket) socket.executeForEveryone = savedEveryone;
  }
});

/** Deploy the party into a fresh combat and gather it, asserting each member goes out and comes back as their own actor. */
async function deployAndGatherAsThemselves(label) {
  const combat = new CombatMock();
  game.combats.set(combat.id, combat);
  const stored = onlyFormation();
  await combat.createEmbeddedDocuments("Combatant", [
    { tokenId: stored.tokenId, sceneId: scene.id, actorId: stored.actorId, hidden: false },
  ]);
  await drain();
  const out = onlyFormation().members;
  assert.equal(out.filter((m) => m.deployedTokenId).length, 2, `${label}: both deployed`);
  for (const m of out) assert.equal(scene.tokens.get(m.deployedTokenId)?.actorId, m.actorId, `${label}: a deployed token is its member's own`);
  await combat.delete();
  await drain();
  for (const m of onlyFormation().members) assert.equal(m.tokenData?.actorId, m.actorId, `${label}: a stash names its member's actor`);
}

await scenario("a batch answered out of order deploys and gathers each member as themselves", async () => {
  scene.reverseCreates = true;
  try {
    await deployAndGatherAsThemselves("first round");
    await deployAndGatherAsThemselves("second round");
  } finally {
    scene.reverseCreates = false;
  }
});

await scenario("a stash that names another actor is never placed for its member", async () => {
  const stored = onlyFormation();
  await model.patchFormation(stored.id, (rec) => {
    const [a, b] = rec.members;
    [a.tokenData, b.tokenData] = [b.tokenData, a.tokenData];
  });
  assert.notEqual(onlyFormation().members[0].tokenData?.actorId, onlyFormation().members[0].actorId, "the stashes are crossed");
  await deployAndGatherAsThemselves("crossed stashes");
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
  assert.equal(formationPreCreateHooks, 1, "the formation's one preCreateToken hook refuses a second party token and restores no hit points");
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

await scenario("a party-token delete that throws still deletes the record", async () => {
  // The party's Scene can be gone by the time its token is deleted; the record
  // must not be orphaned by that failure.
  const aliceToken = scene.tokens.find((t) => t.actorId === alice.id);
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Doomed Party");
  formation = await model.addMember(formation, alice, aliceToken);
  await drain();
  const stored = onlyFormation();
  assert.ok(scene.tokens.get(stored.tokenId), "the party token is on the scene");

  const realDelete = scene.deleteEmbeddedDocuments;
  const realError = console.error;
  const logged = [];
  scene.deleteEmbeddedDocuments = async () => {
    throw new Error("scene is gone");
  };
  console.error = (...args) => logged.push(args);
  try {
    await model.dissolveFormation(model.getFormation(stored.id));
    await drain();
  } finally {
    scene.deleteEmbeddedDocuments = realDelete;
    console.error = realError;
  }

  assert.equal(Object.keys(readFormations()).length, 0, "the record is deleted although the token delete threw");
  assert.ok(logged.some((args) => String(args[0]).includes("party token")), "and the failure was logged");

  // Leave the world as the next scenario expects: no party actor or token.
  await game.actors.get(stored.actorId)?.delete();
  await scene.deleteEmbeddedDocuments("Token", [stored.tokenId]);
  await drain();
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
      adventuring: { listening: 13, searching: 13, dungeonbashing: 13 },
    },
  });
  const eve = await member("Eve"); // GM-owned only
  // Dave carries the gear to light a lantern (require-enforcement default).
  await dave.createEmbeddedDocuments("Item", [
    { name: "Lantern", type: "item", system: {} },
    { name: "Flask of Oil", type: "item", system: { quantity: 3 } },
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

    // A scene screen's Round and Spend a turn from a player's seat: the Judge is
    // told, and the party's record, its clock and its turn plan stay as they were.
    const party = game.actors.get(onlyFormation().actorId);
    const before = structuredClone(onlyFormation());
    const planBefore = structuredClone(party?.getFlag?.(MODULE_ID, "turnPlan") ?? null);
    const said = chat.length;
    await requests.requestPartyAction(id, "askPress", { press: "round" });
    await requests.requestPartyAction(id, "askPress", { press: "turn" });
    await drain();
    assert.deepEqual(onlyFormation(), before, "an ask moves no clock and changes nothing on the party's record");
    assert.deepEqual(party?.getFlag?.(MODULE_ID, "turnPlan") ?? null, planBefore, "and resolves nothing on its turn plan");
    assert.equal(chat.length, said + 2, "each ask is declared to the table");
    await requests.requestPartyAction(id, "askPress", { press: "rest" });
    await drain();
    assert.equal(chat.length, said + 2, "a press outside the closed set is dropped unannounced");

    // Search here: a member-owner's press lands on the Judge's client as the Judge's own call to the
    // scene search, with the party id and nothing a sender adds; the search's own refusal comes back refused.
    const calls = [];
    let answer = { ok: true, opened: true };
    const realSceneSearch = globalThis.acksExtras.sceneSearch;
    const fakeSearch = { searchHere: async (args) => (calls.push(args), answer) };
    globalThis.acksExtras.sceneSearch = fakeSearch;
    const beforeSearch = structuredClone(onlyFormation());
    try {
      const hand = await requests.requestPartyAction(id, "partyPress", { press: "searchHere", args: { partyId: "other", placeUuid: "Actor.elsewhere", judge: true, override: true }, judge: true });
      await drain();
      assert.deepEqual(hand, { ok: true });
      assert.deepEqual(calls, [{ partyId: id }], "the Judge's call, with the party id and nothing the sender added");
      assert.equal(chat.length, said + 3, "a search that opened is announced to the table");
      assert.match(String(chat.at(-1).content), /request\.searchHere/);
      assert.deepEqual(onlyFormation(), beforeSearch, "the press changes nothing on the party's record");
      assert.deepEqual(party?.getFlag?.(MODULE_ID, "turnPlan") ?? null, planBefore, "nor its turn plan");
      // The search's own {ok: false} comes back as the seat's refusal, announced to no one.
      answer = { ok: false, reason: "noPlaceHere" };
      assert.deepEqual(await requests.requestPartyAction(id, "partyPress", { press: "searchHere", args: {} }), { ok: false, refused: "searchClosed" });
      await drain();
      assert.equal(calls.length, 2);
      assert.equal(chat.length, said + 3, "a search that did not open is not announced");
      // With no scene search installed there is nothing to open: refused, not thrown.
      delete globalThis.acksExtras.sceneSearch;
      assert.deepEqual(await requests.requestPartyAction(id, "partyPress", { press: "searchHere", args: {} }), { ok: false, refused: "searchClosed" });
      globalThis.acksExtras.sceneSearch = fakeSearch;
      // The sheet's press: a member-owner's seat sends it through the relay.
      const { SHARED_ACTIONS } = await import("../scripts/formation/formation-actions.mjs");
      answer = { ok: true, opened: true };
      const sheet = { formation: model.getFormation(id), render() {} };
      await SHARED_ACTIONS.searchHere.call(sheet);
      await drain();
      assert.equal(calls.length, 3);
      assert.equal(chat.length, said + 4, "the sheet's press is announced like the relay's");
      // A seat that owns no member presses nothing: refused on the relay, and the sheet sends nothing.
      game.users.push({ id: "PL9", name: "Stranger", isGM: false, isSelf: false });
      game.user = game.users.get("PL9");
      assert.deepEqual(await requests.requestPartyAction(id, "partyPress", { press: "searchHere", args: {} }), { ok: false, refused: "notOwner" });
      await SHARED_ACTIONS.searchHere.call(sheet);
      await drain();
      assert.equal(calls.length, 3, "a seat that owns no member of the party searches nothing");
      assert.equal(chat.length, said + 4, "and is not announced");
      game.user = game.users.get("PL1");
      game.users.pop();
    } finally {
      if (realSceneSearch === undefined) delete globalThis.acksExtras.sceneSearch;
      else globalThis.acksExtras.sceneSearch = realSceneSearch;
    }
  } finally {
    game.user = gmUser;
  }

  await model.disband(model.getFormation(id));
  await drain();
});

await scenario("a seat that owns a member presses the party's own pace, clock, hop, hex and day through the relay", async () => {
  // Relay rule: the GM client takes the attested sender, checks the closed press
  // and its closed arguments, the seat's ownership and the mode, then runs the
  // entry the Judge's own press runs. It never reads `judge` and never passes
  // `override`.
  const { PARTY_PRESSES, PRESS_REFUSALS } = await import("../scripts/formation/party-press.mjs");
  const { SHARED_ACTIONS } = await import("../scripts/formation/formation-actions.mjs");
  const travel = await import("../scripts/formation/travel.mjs");
  const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
  const { SETTLEMENT_DOC, SETTLEMENT_PACES } = await import("../scripts/formation/settlement.mjs");
  const { DISTRICT_TYPE } = await import("../scripts/formation/district-find.mjs");
  const { LOCATION_TYPE } = await import("../scripts/location/constants.mjs");
  const free = Object.fromEntries(Object.keys(SETTLEMENT_PACES).map((pace) => [pace, 0]));
  registerTable({ id: SETTLEMENT_DOC, source: "invented", tables: { districtTravel: { same: free } } }, { priority: PRIORITY.WORLD, source: "test" });
  const quarter = new SceneMock("Presses");
  game.scenes.set(quarter.id, quarter);
  const party = await drawnParty("Presser", quarter);
  const { id, walker, partyToken, step } = party;
  walker.ownership = { default: 0, PL1: 3 };
  const inn = await ActorMock.create({ name: "Inn", type: LOCATION_TYPE });
  game.users.push({ id: "PL9", name: "Stranger", isGM: false, isSelf: false });
  const realEscape = foundry.utils.escapeHTML;
  const gmUser = game.user;
  const asSeat = async (userId, fn) => {
    game.user = game.users.get(userId);
    try {
      return await fn();
    } finally {
      game.user = gmUser;
    }
  };
  const press = (userId, name, args, extra = {}) => asSeat(userId, () => requests.requestPartyAction(id, "partyPress", { press: name, args, ...extra }));
  const stored = () => onlyFormation();
  const chatStart = chat.length;
  const said = () => chat.length - chatStart;
  const lastCard = () => String(chat.at(-1)?.content ?? "");
  try {
    // --- A press that is not one, arguments that do not parse, a seat that owns no member.
    const before = structuredClone(stored());
    for (const bad of ["nope", "__proto__", "constructor", "hasOwnProperty", "", undefined, 7, null]) {
      assert.deepEqual(await press("PL1", bad, { hurried: true }), { ok: false, refused: "badPress" }, `press ${String(bad)} is no press`);
    }
    for (const args of [{ hurried: "yes" }, { hurried: 1 }, {}, "hurried", ["hurried"], null, undefined]) {
      assert.deepEqual(await press("PL1", "pace", args), { ok: false, refused: "badPress" }, `pace arguments ${JSON.stringify(args)} do not parse`);
    }
    assert.deepEqual(await press("PL9", "pace", { hurried: true }), { ok: false, refused: "notOwner" }, "a seat owning no member is refused");
    assert.deepEqual(stored(), before, "and nothing was written by any of them");
    assert.equal(said(), 0, "or announced");

    // --- A parse reads only the keys it names, so a Judge's flag buys a seat nothing.
    assert.deepEqual(PARTY_PRESSES.pace.parse({ hurried: true, judge: true, override: true }, stored()), { hurried: true });
    assert.deepEqual(PARTY_PRESSES.hop.parse({ tokenId: "abc", judge: true, override: true }, stored()), { tokenId: "abc" });
    assert.deepEqual(PARTY_PRESSES.enterHex.parse({ label: " Q9 ", override: true }, stored()), { label: "Q9" });
    assert.deepEqual(PARTY_PRESSES.forageDay.parse({ judge: true }, stored()), {});
    assert.deepEqual(PARTY_PRESSES.endDay.parse({ override: true }, stored()), {});
    assert.deepEqual(Object.keys(PRESS_REFUSALS).sort(), ["badPress", "far", "noHours", "noTarget", "notOwner", "outside", "quiet", "searchClosed", "stale", "worked"]);

    // --- Pace, in a delve: idempotent, announced once per change.
    assert.equal(travel.travelOf(stored()).mode, "delve");
    assert.deepEqual(await press("PL1", "pace", { hurried: true, judge: true, override: true }, { judge: true, override: true }), { ok: true });
    assert.equal(stored().stance.pace, "hurried", "a seat that owns a member hurried the party");
    assert.equal(said(), 1);
    assert.match(lastCard(), /request\.paceHurried/, "and the table is told");
    assert.deepEqual(await press("PL1", "pace", { hurried: true }), { ok: true });
    assert.equal(said(), 1, "the same press again changes nothing and says nothing");
    assert.deepEqual(await press("PL1", "pace", { hurried: false }), { ok: true });
    assert.equal(stored().stance.pace, "careful");
    assert.match(lastCard(), /request\.paceCareful/);
    // The sheet's own press names the pace it wants, on either seat.
    const sheet = () => ({ formation: model.getFormation(id), render() {} });
    await asSeat("PL1", () => SHARED_ACTIONS.togglePace.call(sheet()));
    assert.equal(stored().stance.pace, "hurried", "the player's Hurried press");
    const told = said();
    await SHARED_ACTIONS.togglePace.call(sheet());
    assert.equal(stored().stance.pace, "careful", "the Judge's press runs the same entry");
    assert.equal(said(), told, "and announces nothing");
    await asSeat("PL9", () => SHARED_ACTIONS.togglePace.call(sheet()));
    assert.equal(stored().stance.pace, "careful", "a seat owning no member presses nothing");

    // --- A press made against a mode the party has left is stale.
    for (const name of ["hop", "enterHex", "forageDay", "endDay"]) {
      const args = { hop: { tokenId: "t1" }, enterHex: { label: "Q9" }, forageDay: {}, endDay: {} }[name];
      assert.deepEqual(await press("PL1", name, args), { ok: false, refused: "stale" }, `${name} is not a delve press`);
    }

    // --- Turn, Round and Rest from a seat that owns a member.
    const clock = structuredClone(stored().clock);
    const beforeAsk = said();
    await asSeat("PL1", () => SHARED_ACTIONS.advanceTurn.call(sheet()));
    await asSeat("PL1", () => SHARED_ACTIONS.advanceRound.call(sheet()));
    await drain();
    assert.deepEqual(stored().clock, clock, "a player's Turn and Round move no clock");
    assert.equal(said(), beforeAsk + 2, "each is an ask, declared to the table");
    assert.match(String(chat.at(-2).content), /request\.askTurn/);
    assert.match(lastCard(), /request\.askRound/);
    await asSeat("PL9", () => SHARED_ACTIONS.advanceTurn.call(sheet()));
    assert.equal(said(), beforeAsk + 2, "a seat owning no member asks nothing");
    await asSeat("PL1", () => SHARED_ACTIONS.restTurn.call(sheet()));
    await drain();
    assert.ok(chat.slice(chatStart + beforeAsk + 2).some((m) => /request\.rest/.test(String(m.content))), "a player's Rest is declared, and the Judge's client takes the turn");

    // --- Hop, in a city. A hidden place is no place to a seat; the Judge's seat is not held to it.
    await travel.setJourneyMode(id, "settlement");
    quarter.regions.set("quarter", { id: "quarter", behaviors: [{ type: DISTRICT_TYPE, disabled: false }], testPoint: () => true });
    const [hall, secret] = await quarter.createEmbeddedDocuments("Token", [
      { name: "Hall <b>x</b>", actorId: inn.id, x: partyToken.x + step, y: partyToken.y },
      { name: "Vault", actorId: inn.id, x: partyToken.x + 2 * step, y: partyToken.y, hidden: true },
    ]);
    const heard = said();
    const start = { x: partyToken.x, y: partyToken.y };
    assert.deepEqual(await press("PL1", "hop", { tokenId: secret.id, judge: true }, { judge: true, override: true }), { ok: false, refused: "noTarget" }, "a hidden place is not there for a seat");
    assert.deepEqual(await press("PL1", "hop", { tokenId: "x".repeat(33) }), { ok: false, refused: "badPress" }, "a token id that long is no id");
    assert.deepEqual({ x: partyToken.x, y: partyToken.y }, start, "and the party did not walk");
    assert.equal(said(), heard, "or say so");
    foundry.utils.escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[c]);
    assert.deepEqual(await press("PL1", "hop", { tokenId: hall.id }), { ok: true });
    await drain();
    assert.equal(partyToken.x === start.x && partyToken.y === start.y, false, "a shown place is walked to");
    assert.equal(said(), heard + 2, "the Judges' whisper and the table's declaration");
    assert.ok(chat.slice(-2).every((m) => !/<b>/.test(String(m.content))), "the place's name is escaped in both");
    assert.ok(chat.slice(-2).every((m) => /&lt;b&gt;x&lt;\/b&gt;/.test(String(m.content))), "and still names it");
    assert.ok(chat.slice(-2).some((m) => (m.whisper ?? []).includes("GM1")), "one of them is the Judges' whisper");
    foundry.utils.escapeHTML = realEscape;
    // A walk between quarters that cannot be priced is the seat's refusal, said at the seat.
    quarter.regions.clear();
    notices.length = 0;
    const answer = await asSeat("PL1", () => requests.requestPartyPress(model.getFormation(id), "hop", { tokenId: hall.id }));
    assert.deepEqual(answer, { ok: false, refused: "outside" });
    assert.deepEqual(notices.filter(([level]) => level === "warn").map(([, key]) => key), ["ACKS-FORMATION.settlement.poi.refused.outside"], "said as the hop's own refusal");
    const beforeJudgeHop = said();
    assert.deepEqual(await requests.requestPartyPress(model.getFormation(id), "hop", { tokenId: secret.id }), { ok: false, refused: "outside" }, "the Judge's seat is offered the hidden place too");
    assert.equal(said(), beforeJudgeHop, "and a refused hop says nothing at the table");

    // --- The journey's own presses.
    await travel.setJourneyMode(id, "journey");
    assert.deepEqual(await press("PL1", "hop", { tokenId: hall.id }), { ok: false, refused: "stale" }, "a hop is not a journey press");
    assert.deepEqual(await press("PL1", "enterHex", { label: "x".repeat(65) }), { ok: false, refused: "badPress" }, "a 65-character hex label is refused");
    const hexed = said();
    assert.deepEqual(await press("PL1", "enterHex", { label: "  Q<9>  " }, { judge: true }), { ok: true });
    assert.equal(said(), hexed + 1);
    assert.match(lastCard(), /request\.enterHex/);
    assert.match(lastCard(), /Q<9>|Q&lt;9&gt;/, "the label is trimmed");
    assert.equal(lastCard().includes("  Q"), false);

    notices.length = 0;
    const foraged = said();
    assert.deepEqual(await asSeat("PL1", () => requests.requestPartyPress(model.getFormation(id), "forageDay")), { ok: false, refused: "noHours" });
    assert.deepEqual(notices.at(-1), ["info", "ACKS-FORMATION.forageRun.noHours"], "no hours set aside is said at the seat as an info");
    await model.patchFormation(id, (rec) => {
      const t = travel.storedTravelOf(rec);
      rec.travel = { ...t, day: { ...t.day, activities: ["forage"], done: [true] } };
    });
    assert.deepEqual(await press("PL1", "forageDay", {}), { ok: false, refused: "worked" });
    assert.equal(said(), foraged, "a day's work that did not happen is not announced");

    const day = travel.travelOf(stored()).dayCount;
    assert.deepEqual(await press("PL1", "endDay", {}, { override: true }), { ok: true });
    assert.equal(travel.travelOf(stored()).dayCount, day + 1, "End day from a seat closes the day once");
    assert.match(lastCard(), /request\.endDay/);
    assert.deepEqual(await press("PL9", "endDay", {}), { ok: false, refused: "notOwner" });
    assert.equal(travel.travelOf(stored()).dayCount, day + 1, "a seat owning no member closes nothing");

    // An answer no one coded for is said as the generic refusal.
    notices.length = 0;
    requests.sayPressAnswer({ ok: false, refused: "nothingLikeIt" });
    requests.sayPressAnswer({ ok: false, refused: "quiet" });
    requests.sayPressAnswer(undefined);
    assert.deepEqual(notices, [["warn", "ACKS-FORMATION.request.refused"]]);
  } finally {
    foundry.utils.escapeHTML = realEscape;
    game.user = gmUser;
    game.users.pop();
    unregisterTable(SETTLEMENT_DOC, { priority: PRIORITY.WORLD });
    await dismissDrawn(party);
    game.actors.delete(inn.id);
    game.scenes.delete(quarter.id);
  }
});

await scenario("a seat that owns a bearer or a caster puts out its light and sets its spells from the Kit tab, through the relay", async () => {
  // Owner rule: "Spell owner can setup the spell as needed". The seat test is
  // Foundry's ownership of the light's bearer or the spell's caster, never the
  // user's role; a Judge's own press runs the same entry, and a relayed press
  // never reads `judge` or passes `override`.
  const { default: Handlebars } = await import("handlebars");
  const fs = await import("node:fs");
  Handlebars.registerHelper("localize", (k) => String(k));
  const kit = Handlebars.compile(fs.readFileSync("templates/formation/formation-tab-kit.hbs", "utf8"));
  const view = await import("../scripts/formation/formation-view.mjs");
  const { PARTY_PRESSES } = await import("../scripts/formation/party-press.mjs");
  const { SHARED_ACTIONS } = await import("../scripts/formation/formation-actions.mjs");
  const { ITEM_TYPE } = await import("../scripts/lib/vocab.mjs");
  const party = await drawnParty("Kitter");
  const { id, walker: mine } = party;
  mine.ownership = { default: 0, PL1: 3 };
  const theirs = await member("Kitter B");
  await model.addMember(model.getFormation(id), theirs, null);
  mine.items.set("sp1", { id: "sp1", name: "Lamp Spell", type: ITEM_TYPE.spell, system: { duration: "6 turns" }, getFlag: () => undefined });
  theirs.items.set("sp2", { id: "sp2", name: "Hidden Spell", type: ITEM_TYPE.spell, system: { duration: "6 turns" }, getFlag: () => undefined });
  for (const actor of [mine, theirs]) Object.defineProperty(actor, "isOwner", { get: () => actor.testUserPermission(game.user) });
  game.users.push({ id: "PL9", name: "Stranger", isGM: false, isSelf: false });
  const gmUser = game.user;
  const asSeat = async (userId, fn) => {
    game.user = game.users.get(userId);
    try {
      return await fn();
    } finally {
      game.user = gmUser;
    }
  };
  const press = (userId, name, args, extra = {}) => asSeat(userId, () => requests.requestPartyAction(id, "partyPress", { press: name, args, ...extra }));
  const stored = () => onlyFormation();
  const lightOf = (actor) => stored().lights.find((l) => l.bearerId === actor.id);
  const spellOf = (name) => stored().spells.find((s) => s.name === name);
  let chatStart = chat.length;
  const said = () => chat.length - chatStart;
  const row = (html, attr, rowId) => {
    const start = html.indexOf(`${attr}="${rowId}"`);
    assert.ok(start >= 0, `${attr} ${rowId} rendered`);
    return html.slice(start, html.indexOf("</div>", start));
  };
  const render = (userId) => asSeat(userId, () => {
    const f = model.getFormation(id);
    const isGM = game.user.isGM;
    return kit({
      isGM,
      seat: { isGM, ownsMember: isGM || requests.userOwnsMember(f, game.user) },
      formation: f,
      ...view.buildFormationView(f),
      ...view.buildSpellTracker(f),
    });
  });
  const targetOf = (attr, value) => ({ closest: () => ({ dataset: { [attr]: value } }) });
  const sheet = (fields = {}) => ({ formation: model.getFormation(id), render() {}, ...fields });
  try {
    await engine.addLight(model.getFormation(id), "torch", mine.id, { override: true });
    await engine.addLight(model.getFormation(id), "torch", theirs.id, { override: true });
    await engine.addSpell(model.getFormation(id), { name: "Lamp Spell", casterId: mine.id, turns: 6 });
    await engine.addSpell(model.getFormation(id), { name: "Hidden Spell", casterId: theirs.id, turns: 6 });
    await engine.addSpell(model.getFormation(id), { name: "Loose Spell", casterId: null, turns: 6 });
    await drain();
    chatStart = chat.length;

    // --- The view: each control on the row whose bearer or caster the seat owns.
    const playerHtml = await render("PL1");
    assert.ok(row(playerHtml, "data-light-id", lightOf(mine).id).includes('data-action="removeLight"'), "A's light shows Remove to its owner");
    assert.ok(!row(playerHtml, "data-light-id", lightOf(theirs).id).includes('data-action="removeLight"'), "B's light shows none");
    const mineRow = row(playerHtml, "data-spell-id", spellOf("Lamp Spell").id);
    for (const action of ["spellMinus", "spellPlus", "removeSpell"]) assert.ok(mineRow.includes(`data-action="${action}"`), `A's spell shows ${action}`);
    for (const name of ["Hidden Spell", "Loose Spell"]) {
      const other = row(playerHtml, "data-spell-id", spellOf(name).id);
      for (const action of ["spellMinus", "spellPlus", "removeSpell"]) assert.ok(!other.includes(`data-action="${action}"`), `${name} shows no ${action}`);
    }
    // The add-spell row is drawn, offering A as a caster and A's spells, and not B.
    assert.ok(playerHtml.includes('data-action="addSpell"'), "the add-spell row is drawn for a seat that owns a member");
    const casters = playerHtml.slice(playerHtml.indexOf('data-pick="spellCaster"'), playerHtml.indexOf("</select>", playerHtml.indexOf('data-pick="spellCaster"')));
    assert.ok(casters.includes(`value="${mine.id}"`) && !casters.includes(`value="${theirs.id}"`), "the caster list offers A and not B");
    const picker = playerHtml.slice(playerHtml.indexOf('data-pick="spellPick"'), playerHtml.indexOf("</select>", playerHtml.indexOf('data-pick="spellPick"')));
    assert.ok(picker.includes(`value="${mine.id}|sp1"`) && !picker.includes("sp2"), "the spell picker holds A's known spells only");
    assert.ok(!playerHtml.includes('data-action="addLight"'), "the add-light row stays the Judge's");
    assert.ok(!playerHtml.includes('data-action="newMap"'), "and the Kit maps");
    const stranger = await render("PL9");
    assert.ok(!stranger.includes('data-action="addSpell"') && !stranger.includes('data-action="removeLight"') && !stranger.includes('data-action="spellPlus"'), "a seat owning no member is drawn none of it");
    const judgeHtml = await render(gmUser.id);
    assert.ok(row(judgeHtml, "data-light-id", lightOf(theirs).id).includes('data-action="removeLight"'), "the Judge's seat keeps Remove on every light");
    assert.ok(row(judgeHtml, "data-spell-id", spellOf("Loose Spell").id).includes('data-action="spellMinus"'), "and the controls on a spell with no caster");
    const judgeCasters = judgeHtml.slice(judgeHtml.indexOf('data-pick="spellCaster"'), judgeHtml.indexOf("</select>", judgeHtml.indexOf('data-pick="spellCaster"')));
    assert.ok(judgeCasters.includes(`value="${mine.id}"`) && judgeCasters.includes(`value="${theirs.id}"`), "the Judge's caster list is the whole party");
    assert.ok(judgeHtml.includes('data-action="addLight"') && judgeHtml.includes('data-action="newMap"'), "and the Judge's own rows stay");
    const context = view.buildSpellTracker(model.getFormation(id));
    assert.deepEqual(Object.keys(context).sort(), ["spellCasters", "spellOptions"], "the lists carry nothing of the Judge's hand");

    // --- A parse reads only the keys it names, so a Judge's flag buys a seat nothing.
    const f = stored();
    assert.deepEqual(PARTY_PRESSES.lightRemove.parse({ lightId: "L1", judge: true, override: true }, f), { lightId: "L1" });
    assert.deepEqual(PARTY_PRESSES.spellAdjust.parse({ spellId: "S1", delta: -1, judge: true, override: true }, f), { spellId: "S1", delta: -1 });
    assert.deepEqual(PARTY_PRESSES.spellRemove.parse({ spellId: "S1", override: true }, f), { spellId: "S1" });
    for (const entry of ["lightRemove", "spellAdjust", "spellRemove"]) {
      assert.deepEqual([...PARTY_PRESSES[entry].modes].sort(), ["delve", "journey", "settlement"], `${entry} is open in every mode`);
    }

    // --- Arguments that do not parse.
    const before = structuredClone(stored());
    for (const args of [{}, { lightId: 7 }, { lightId: "" }, null]) assert.deepEqual(await press("PL1", "lightRemove", args), { ok: false, refused: "badPress" }, `lightRemove ${JSON.stringify(args)}`);
    const mineSpell = spellOf("Lamp Spell");
    for (const args of [{ spellId: mineSpell.id }, { spellId: mineSpell.id, delta: 2 }, { spellId: mineSpell.id, delta: "1" }, { spellId: mineSpell.id, delta: 0 }, { delta: 1 }]) {
      assert.deepEqual(await press("PL1", "spellAdjust", args), { ok: false, refused: "badPress" }, `spellAdjust ${JSON.stringify(args)}`);
    }
    assert.deepEqual(await press("PL1", "spellRemove", {}), { ok: false, refused: "badPress" });
    assert.deepEqual(stored(), before, "none of them wrote");

    // --- Someone else's bearer or caster, a spell with no caster, a thing the record no longer holds.
    assert.deepEqual(await press("PL1", "lightRemove", { lightId: lightOf(theirs).id, judge: true }, { judge: true, override: true }), { ok: false, refused: "notOwner" });
    assert.deepEqual(await press("PL1", "lightRemove", { lightId: "gone" }), { ok: false, refused: "notOwner" });
    assert.deepEqual(await press("PL1", "spellAdjust", { spellId: spellOf("Hidden Spell").id, delta: 1, override: true }), { ok: false, refused: "notOwner" });
    assert.deepEqual(await press("PL1", "spellRemove", { spellId: spellOf("Hidden Spell").id }), { ok: false, refused: "notOwner" });
    for (const name of ["spellAdjust", "spellRemove"]) {
      assert.deepEqual(await press("PL1", name, { spellId: spellOf("Loose Spell").id, delta: 1 }), { ok: false, refused: "notOwner" }, `${name} on a spell with no caster is refused`);
    }
    assert.deepEqual(await press("PL1", "spellAdjust", { spellId: "gone", delta: 1 }), { ok: false, refused: "notOwner" });
    assert.deepEqual(await press("PL9", "lightRemove", { lightId: lightOf(mine).id }), { ok: false, refused: "notOwner" }, "a seat owning no member is refused");
    assert.deepEqual(stored(), before, "no refusal wrote");
    assert.equal(said(), 0, "or announced");

    // --- A's own: lands, and is announced once.
    assert.deepEqual(await press("PL1", "spellAdjust", { spellId: mineSpell.id, delta: 1, judge: true, override: true }), { ok: true });
    assert.equal(spellOf("Lamp Spell").remaining, 7, "plus");
    assert.match(String(chat.at(-1).content), /request\.spellAdjust/);
    assert.deepEqual(await press("PL1", "spellAdjust", { spellId: mineSpell.id, delta: -1 }), { ok: true });
    assert.equal(spellOf("Lamp Spell").remaining, 6, "minus");
    assert.equal(said(), 2);
    const lightId = lightOf(mine).id;
    assert.deepEqual(await press("PL1", "lightRemove", { lightId }), { ok: true });
    assert.equal(lightOf(mine), undefined, "A's light is out");
    assert.ok(lightOf(theirs), "B's stays");
    assert.match(String(chat.at(-1).content), /request\.lightRemove/);
    assert.deepEqual(await press("PL1", "lightRemove", { lightId }), { ok: false, refused: "notOwner" }, "a second press finds no light");
    assert.deepEqual(await press("PL1", "spellRemove", { spellId: mineSpell.id }), { ok: true });
    assert.equal(spellOf("Lamp Spell"), undefined, "A's spell is no longer tracked");
    assert.match(String(chat.at(-1).content), /request\.spellRemove/);
    assert.equal(said(), 4);

    // --- The sheet's own presses, from each seat.
    await engine.addLight(model.getFormation(id), "torch", mine.id, { override: true });
    await engine.addSpell(model.getFormation(id), { name: "Lamp Spell", casterId: mine.id, turns: 6 });
    await drain();
    const spellId = spellOf("Lamp Spell").id;
    await asSeat("PL1", () => SHARED_ACTIONS.spellPlus.call(sheet(), null, targetOf("spellId", spellId)));
    assert.equal(spellOf("Lamp Spell").remaining, 7, "the player's plus");
    await asSeat("PL1", () => SHARED_ACTIONS.spellMinus.call(sheet(), null, targetOf("spellId", spellId)));
    assert.equal(spellOf("Lamp Spell").remaining, 6, "the player's minus");
    const hiddenId = spellOf("Hidden Spell").id;
    await asSeat("PL1", () => SHARED_ACTIONS.spellPlus.call(sheet(), null, targetOf("spellId", hiddenId)));
    await asSeat("PL1", () => SHARED_ACTIONS.removeSpell.call(sheet(), null, targetOf("spellId", hiddenId)));
    await asSeat("PL1", () => SHARED_ACTIONS.removeSpell.call(sheet(), null, targetOf("spellId", spellOf("Loose Spell").id)));
    await asSeat("PL1", () => SHARED_ACTIONS.removeLight.call(sheet(), null, targetOf("lightId", lightOf(theirs).id)));
    assert.equal(spellOf("Hidden Spell").remaining, 6, "B's spell is not the player's to change");
    assert.ok(spellOf("Hidden Spell") && spellOf("Loose Spell") && lightOf(theirs), "or to remove, nor a light or a spell with no caster");
    await asSeat("PL9", () => SHARED_ACTIONS.removeSpell.call(sheet(), null, targetOf("spellId", spellId)));
    assert.ok(spellOf("Lamp Spell"), "a seat owning no member presses nothing");
    await asSeat("PL1", () => SHARED_ACTIONS.removeLight.call(sheet(), null, targetOf("lightId", lightOf(mine).id)));
    assert.equal(lightOf(mine), undefined, "the player's Remove light");
    await asSeat("PL1", () => SHARED_ACTIONS.removeSpell.call(sheet(), null, targetOf("spellId", spellId)));
    assert.equal(spellOf("Lamp Spell"), undefined, "the player's Remove spell");

    const announced = said();
    await SHARED_ACTIONS.spellPlus.call(sheet(), null, targetOf("spellId", hiddenId));
    assert.equal(spellOf("Hidden Spell").remaining, 7, "the Judge's seat sets any caster's spell");
    await SHARED_ACTIONS.spellMinus.call(sheet(), null, targetOf("spellId", spellOf("Loose Spell").id));
    await SHARED_ACTIONS.removeSpell.call(sheet(), null, targetOf("spellId", spellOf("Loose Spell").id));
    assert.equal(spellOf("Loose Spell"), undefined, "and a spell with no caster");
    await SHARED_ACTIONS.removeLight.call(sheet(), null, targetOf("lightId", lightOf(theirs).id));
    assert.equal(lightOf(theirs), undefined, "and any light");
    assert.equal(said(), announced, "the Judge's own presses announce nothing");

    // --- Add a spell: a typed name and its turns, under a caster the seat owns.
    const fields = (values) => ({ querySelector: (sel) => ({ value: values[/data-pick=(\w+)/.exec(sel)[1]] ?? "" }) });
    const add = (userId, values) => asSeat(userId, () => SHARED_ACTIONS.addSpell.call(sheet({ element: fields(values) })));
    await add("PL1", { spellName: "Typed Spell", spellTurns: "5", spellCaster: theirs.id });
    assert.equal(spellOf("Typed Spell"), undefined, "a typed spell under B's name is not tracked for a player");
    await add("PL9", { spellName: "Typed Spell", spellTurns: "5", spellCaster: mine.id });
    assert.equal(spellOf("Typed Spell"), undefined, "nor for a seat owning no member");
    await add("PL1", { spellName: "Typed Spell", spellTurns: "5", spellCaster: mine.id });
    await drain();
    assert.deepEqual([spellOf("Typed Spell")?.casterId, spellOf("Typed Spell")?.remaining], [mine.id, 5], "a typed name and turns are tracked under A");
    await add("PL1", { spellPick: `${mine.id}|sp1`, spellTurns: "3", spellCaster: theirs.id });
    await drain();
    assert.equal(spellOf("Lamp Spell")?.remaining, 3, "a picked spell goes under its own caster, with the turns typed");
    await add(gmUser.id, { spellName: "Judge Spell", spellTurns: "4", spellCaster: theirs.id });
    assert.equal(spellOf("Judge Spell")?.casterId, theirs.id, "the Judge writes it direct, under any member");
  } finally {
    game.user = gmUser;
    game.users.pop();
    await dismissDrawn(party);
    game.actors.delete(theirs.id);
  }
});

await scenario("a seat that owns a member writes the party's form fields through the relay, blocked where the Judge is warned", async () => {
  // Owner rule: "Tool permissions are hardcoded (e.g. summons) by server role
  // instead of object ownership, only judge secrets are supposed to be an
  // exception to this rule". The seat test is Foundry's ownership of a member;
  // the relay picks the allow-list, never reads `judge` and never passes
  // `override`, so a forced march the survival ladder bars is refused at the
  // seat where the Judge is asked.
  const travel = await import("../scripts/formation/travel.mjs");
  const { PARTY_FORM_PATHS, pickPartyForm, applyPartyForm } = await import("../scripts/formation/party-form.mjs");
  const { onChangeForm } = await import("../scripts/formation/formation-actions.mjs");
  const { PARTY_TOKEN_SHAPES } = await import("../scripts/formation/constants.mjs");
  const { freshSurvival } = await import("../scripts/lib/survival.mjs");
  const party = await drawnParty("Former");
  const { id, walker: mine } = party;
  mine.ownership = { default: 0, PL1: 3 };
  const theirs = await member("Former B");
  await model.addMember(model.getFormation(id), theirs, null);
  // The party's own actor, which disbanding takes with the record.
  const partyActor = model.getPartyActor(model.getFormation(id));
  assert.ok(partyActor, "the party has its actor");
  Object.defineProperty(partyActor, "isOwner", { get: () => partyActor.testUserPermission(game.user) });
  game.users.push({ id: "PL9", name: "Stranger", isGM: false, isSelf: false });
  const gmUser = game.user;
  const asSeat = async (userId, fn) => {
    game.user = game.users.get(userId);
    try {
      return await fn();
    } finally {
      game.user = gmUser;
    }
  };
  const nest = (path, value) => path.split(".").reduceRight((inner, key) => ({ [key]: inner }), value);
  // The sheet's submit as core hands it: flat dotted keys that `expandObject` nests.
  const priorExpand = foundry.utils.expandObject;
  foundry.utils.expandObject = (flat) => {
    const out = {};
    for (const [path, value] of Object.entries(flat)) {
      const parts = path.split(".");
      const last = parts.pop();
      parts.reduce((into, part) => (into[part] ??= {}), out)[last] = value;
    }
    return out;
  };
  const relay = (userId, form, extra = {}) => asSeat(userId, () => requests.requestPartyAction(id, "partyForm", { form, ...extra }, { sent: false }));
  const stored = () => onlyFormation();
  const tv = () => travel.storedTravelOf(stored());
  const reseed = async (before) => model.patchFormation(id, (rec) => { rec.travel = structuredClone(before.travel); rec.tableId = before.tableId; });
  const app = { renders: 0, get formation() { return model.getFormation(id); }, render() { this.renders++; } };
  const chatStart = chat.length;
  try {
    partyActor.ownership = { default: 0, PL1: 3 };
    // The Judge's own fields, each at a stored word the payloads below differ from.
    await travel.applyTravelForm(id, {
      lostNote: "secret", shown: "unknown", hexLabel: "K7",
      camp: { present: "yes", target: "x" }, settlement: { wanted: true },
    });
    await model.patchFormation(id, (rec) => {
      rec.tableId = "tbl1";
      const t = travel.storedTravelOf(rec);
      rec.travel = { ...t, day: { ...t.day, activities: [null, null, null], done: [false, false, false] } };
    });
    assert.deepEqual([tv().lost.judgeNote, tv().shown, tv().hex.label, tv().camp.present, tv().camp.target, tv().settlement.wanted, stored().tableId], ["secret", "unknown", "K7", "yes", "x", true, "tbl1"], "the seeds are in");

    // --- The allow-list: each path of it lands, and every other path is dropped.
    assert.ok(PARTY_FORM_PATHS.every((p) => /^(name|frontage|tokenShape|columnColor|travel\.)/.test(p)), "the list names form fields only");
    const keep = { name: "N", frontage: "2", travel: { mode: "journey", day: { slot: { 2: "forage" }, kind: "march" }, settlement: { pace: "commuting" } } };
    assert.deepEqual(pickPartyForm(keep), keep, "allowed paths pass whole, a day slot included");
    const mixed = pickPartyForm({ ...keep, tableId: "t", system: { description: "d" }, crossing: { kind: "k" }, travel: { ...keep.travel, ground: "hills", weather: { climate: "arid" }, camp: { present: "no", steal: true }, day: { ...keep.travel.day, slot: { 2: "forage", x: "forage", 123: "forage" } } } });
    assert.deepEqual(mixed, { name: "N", frontage: "2", travel: { mode: "journey", day: { slot: { 2: "forage" }, kind: "march" }, settlement: { pace: "commuting" }, camp: { steal: true } } }, "a country key, a climate, a slot that is no index and a Judge's field are all dropped");
    assert.deepEqual(pickPartyForm({ name: ["a"], frontage: { n: 1 }, tokenShape: "x".repeat(201), columnColor: NaN, __proto__: { name: "inherited" } }), {}, "a value that is no plain field, and an inherited key, are dropped");
    assert.deepEqual(pickPartyForm(null), {});

    // --- Every key the Judge keeps is dropped on the relay, and lands on the Judge's own path.
    const judgeKeys = [
      ["travel.override.ground", "hills"], ["travel.lostNote", "changed"], ["travel.shown", "believed"],
      ["travel.camp.present", "no"], ["travel.camp.target", "y"], ["travel.settlement.wanted", false],
      ["travel.hexLabel", "Z9"], ["tableId", "tbl2"], ["travel.ground", "hills"], ["system.description", "d"], ["crossing.kind", "k"],
    ];
    const ruled = structuredClone(stored());
    for (const [path, value] of judgeKeys) {
      const form = nest(path, value);
      assert.deepEqual(await relay("PL1", form, { judge: true, override: true }), { ok: true }, `${path} from a seat is heard and dropped`);
      assert.deepEqual(stored(), ruled, `${path} wrote nothing`);
      if (path === "system.description" || path === "crossing.kind") continue;
      await applyPartyForm(model.getFormation(id), form, { judge: true });
      assert.notDeepEqual(stored(), ruled, `${path} is a live key on the Judge's own path`);
      await reseed(ruled);
      assert.deepEqual(stored(), ruled);
    }
    assert.deepEqual(await relay("PL1", { ...nest("travel.override.ground", "hills"), ...nest("travel.shown", "believed"), travel: { override: { ground: "hills" }, shown: "believed", weather: { climate: "arid" }, hexLabel: "Z9" }, tableId: "tbl2" }), { ok: true });
    assert.deepEqual(stored(), ruled, "all of them together write nothing either");
    assert.equal(chat.length, chatStart, "and a field edit is announced to no one");

    // --- Fields that land.
    assert.deepEqual(await relay("PL1", { name: "  Renamed Party  " }), { ok: true });
    assert.equal(stored().name, "Renamed Party", "the record's name, trimmed");
    assert.equal(partyActor.name, "Renamed Party", "and the party actor's with it, in one op");
    assert.deepEqual(await relay("PL1", { travel: { mode: "journey" } }), { ok: true });
    assert.equal(tv().mode, "journey", "the mode runs the mode change");
    assert.deepEqual(await relay("PL1", { travel: { mode: "nowhere" } }), { ok: true });
    assert.equal(tv().mode, "journey", "a mode that is none is not taken");
    const pickers = { pace: "commuting", where: "alley", route: "route", hour: "night", intent: "trouble", conveyance: "wagon" };
    assert.deepEqual(await relay("PL1", { travel: { settlement: pickers } }), { ok: true });
    for (const [key, value] of Object.entries(pickers)) assert.equal(tv().settlement[key], value, `the city's ${key} picker`);
    assert.equal(tv().settlement.wanted, true, "and the Judge's Hunted box stands, absent from the player's submit");
    assert.deepEqual(await relay("PL1", { travel: { movement: { hoursAloft: "3", dayHours: "8", load: "heavy" } } }), { ok: true });
    assert.deepEqual([tv().movement.hoursAloft, tv().movement.dayHours, tv().movement.load], [3, 8, "heavy"], "the flight fields");
    assert.deepEqual(await relay("PL1", { travel: { weather: { season: "summer", auto: true, fronts: false, footingMud: "muddy", footingSnow: true } } }), { ok: true });
    assert.deepEqual([tv().weather.season, tv().weather.auto, tv().weather.footing.mud, tv().weather.footing.snow], ["summer", true, "muddy", true], "the Sky fields");
    assert.deepEqual(await relay("PL1", { travel: { exposure: { hours: "5", atHeatSource: true, wet: true } } }), { ok: true });
    assert.deepEqual(tv().exposure, { hours: 5, atHeatSource: true, wet: true }, "the cold's inputs");
    assert.deepEqual(await relay("PL1", { travel: { day: { slot: { 1: "forage", 9: "hunt" }, declared: "1", traps: "2", noSleep: true } } }), { ok: true });
    assert.deepEqual([tv().day.activities, tv().day.traps, tv().day.noSleep], [[null, "forage", null], 2, true], "a day slot and the day's declarations, a slot past the board ignored");
    assert.deepEqual(await relay("PL1", { travel: { camp: { declared: "1", steal: true, water: true, sleepInArmour: true } } }), { ok: true });
    assert.deepEqual([tv().camp.steal, tv().camp.water, tv().camp.sleepInArmour, tv().camp.present, tv().camp.target], [true, true, true, "yes", "x"], "a camp declaration, with the Judge's search words standing");
    assert.deepEqual(await relay("PL1", { travel: { day: { kind: "camp" } } }), { ok: true });
    assert.equal(tv().day.kind, "camp", "a day kind the bar does not concern");
    assert.deepEqual(await relay("PL1", { frontage: "2", tokenShape: PARTY_TOKEN_SHAPES[0], columnColor: "#AABBCC" }), { ok: true });
    assert.deepEqual([stored().frontage, stored().tokenShape, stored().columnColor], [2, PARTY_TOKEN_SHAPES[0], "#aabbcc"], "frontage, token shape and column colour");
    assert.equal(chat.length, chatStart, "none of it was announced");

    // --- A frontage the seat typed wrongly comes back as a warning, said at the seat.
    notices.length = 0;
    assert.deepEqual(await relay("PL1", { frontage: "0" }), { ok: true, warned: [{ code: "frontageInvalid" }] }, "the warning travels in the answer");
    assert.equal(stored().frontage, 2, "and nothing was written");
    assert.deepEqual(notices, [], "the Judge's client toasted nothing for a press the Judge did not make");
    const said = await asSeat("PL1", () => requests.requestPartyForm(model.getFormation(id), { frontage: "0" }));
    assert.deepEqual(said, { ok: true, warned: [{ code: "frontageInvalid" }] });
    assert.deepEqual(notices, [["warn", "ACKS-FORMATION.warn.frontageInvalid {\"code\":\"frontageInvalid\"}"]], "said on the player's seat");
    notices.length = 0;
    assert.deepEqual(await asSeat("PL1", () => requests.requestPartyForm(model.getFormation(id), { system: { description: "d" }, tableId: "t" })), { ok: true }, "a form with nothing to write sends nothing");
    assert.deepEqual(notices, [], "and says nothing");

    // --- A seat that owns no member is refused, and nothing is written.
    const before = structuredClone(stored());
    assert.deepEqual(await relay("PL9", { name: "Stolen", travel: { mode: "delve" } }), { ok: false, refused: "notOwner" });
    assert.deepEqual(stored(), before);
    assert.equal(partyActor.name, "Renamed Party");
    notices.length = 0;
    await asSeat("PL9", () => requests.requestPartyForm(model.getFormation(id), { name: "Stolen" }));
    assert.deepEqual(notices, [["warn", "ACKS-FORMATION.request.refused"]], "told so at the seat");

    // --- A forced march the ladder bars is blocked for a seat before anything is written.
    await mine.setFlag(MODULE_ID, "survival", { ...freshSurvival(), nourishment: "underfed" });
    await travel.applyTravelForm(id, { day: { kind: "march" } });
    const barred = structuredClone(stored());
    notices.length = 0;
    const answer = await relay("PL1", { name: "Past The Bar", frontage: "3", travel: { day: { kind: "forced" }, settlement: { pace: "meandering" } } }, { judge: true, override: true });
    assert.deepEqual(answer, { ok: false, refused: "forcedBarred", names: mine.name }, "refused, naming who bars it");
    assert.deepEqual(stored(), barred, "and the whole submit wrote nothing");
    assert.deepEqual(notices, [], "the Judge's client said nothing for it");
    assert.equal((await relay("PL1", { travel: { day: { kind: "forced" }, override: true } }, { override: true })).refused, "forcedBarred", "an override in the form or beside it is not read");
    assert.equal(tv().day.kind, "march");
    await asSeat("PL1", () => requests.requestPartyForm(model.getFormation(id), { travel: { day: { kind: "forced" } } }));
    assert.deepEqual(notices, [["warn", `ACKS-FORMATION.warn.forcedMarchBarred {"names":${JSON.stringify(mine.name)}}`]], "said on the player's seat, naming the barred member");
    assert.equal((await relay("PL1", { travel: { day: { kind: "march" } } })).ok, true, "a day that is already a march is no forced one");

    // --- The Judge's seat keeps its own path: the whole submit, the ask, the warning.
    const DialogV2 = foundry.applications.api.DialogV2;
    const priorConfirm = DialogV2.confirm;
    let asked = 0;
    DialogV2.confirm = async () => (asked++, false);
    notices.length = 0;
    await onChangeForm.call(app, null, null, { object: { "travel.day.kind": "forced", "travel.lostNote": "kept", tableId: "tbl9" } });
    assert.equal(asked, 1, "the Judge is asked");
    assert.equal(tv().day.kind, "march", "a Cancel drops the kind");
    assert.deepEqual([tv().lost.judgeNote, stored().tableId], ["kept", "tbl9"], "and the rest of the submit, the Judge's own fields included, lands");
    assert.deepEqual(notices, [], "a declined ask is no warning");
    DialogV2.confirm = async () => (asked++, true);
    await onChangeForm.call(app, null, null, { object: { "travel.day.kind": "forced" } });
    assert.equal(tv().day.kind, "forced", "a Confirm sets the barred march");
    assert.ok(chat.slice(chatStart).some((m) => String(m.content).includes("travel.forcedBar.note")), "and the Judges are whispered who was barred");
    DialogV2.confirm = priorConfirm;
    await travel.applyTravelForm(id, { day: { kind: "march" } });
    notices.length = 0;
    const judgeAnswer = await applyPartyForm(model.getFormation(id), { travel: { day: { kind: "forced" } }, frontage: "0" }, { judge: true });
    assert.equal(judgeAnswer.refused, "forcedBarred", "the Judge's own apply, with no confirm to ask, is refused too");
    assert.deepEqual(notices, [], "and says nothing itself");

    // --- The sheet's submit from each seat.
    await model.patchFormation(id, (rec) => { rec.travel = { ...travel.storedTravelOf(rec), day: { ...travel.storedTravelOf(rec).day, kind: "march" } }; });
    await mine.setFlag(MODULE_ID, "survival", freshSurvival());
    app.renders = 0;
    await asSeat("PL1", () => onChangeForm.call(app, null, null, { object: { name: "From The Sheet", "travel.settlement.pace": "meandering", "travel.lostNote": "no", "system.description": "A tale." } }));
    assert.deepEqual([stored().name, tv().settlement.pace, tv().lost.judgeNote, partyActor.system.description], ["From The Sheet", "meandering", "kept", "A tale."], "a player's submit lands what is theirs and leaves the Judge's note");
    assert.equal(app.renders, 1, "and the sheet draws once");
    app.renders = 0;
    await asSeat("PL9", () => onChangeForm.call(app, null, null, { object: { name: "Stranger Sheet" } }));
    assert.equal(stored().name, "From The Sheet", "a seat owning no member writes nothing");
    assert.equal(app.renders, 0);
    await onChangeForm.call(app, null, null, { object: { name: "Judge Sheet", frontage: "0", "travel.hexLabel": "Q1" } });
    assert.deepEqual([stored().name, tv().hex.label, partyActor.name], ["Judge Sheet", "Q1", "Judge Sheet"], "the Judge's seat writes the record, the hex label included");
    assert.ok(notices.some(([level, key]) => level === "warn" && key.startsWith("ACKS-FORMATION.warn.frontageInvalid")), "and is warned of a frontage it typed wrongly");
  } finally {
    foundry.utils.expandObject = priorExpand;
    if (priorExpand === undefined) delete foundry.utils.expandObject;
    game.user = gmUser;
    game.users.pop();
    await dismissDrawn(party);
    game.actors.delete(theirs.id);
  }
});

await scenario("a seat that owns a member makes the movement, grid and weather presses through the relay, and Save order, Load order, the audit and Disband follow their own tests", async () => {
  // Owner rule: "Tool permissions are hardcoded (e.g. summons) by server role
  // instead of object ownership, only judge secrets are supposed to be an
  // exception to this rule". The seat test is Foundry's ownership of a member.
  // A relayed press never reads `judge: true` and never passes `override: true`:
  // a Player's movementTile carrying both parses to its mode alone.
  const travel = await import("../scripts/formation/travel.mjs");
  const marching = await import("../scripts/formation/marching-templates.mjs");
  const { PARTY_PRESSES } = await import("../scripts/formation/party-press.mjs");
  const { SHARED_ACTIONS } = await import("../scripts/formation/formation-actions.mjs");
  const { auditWindowId } = await import("../scripts/formation/skill-audit.mjs");
  // Invented weather tables, registered the way an import registers them: they
  // prove the press, never the book.
  const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
  const { WEATHER_DOC } = await import("../scripts/vehicles/vehicle-speed.mjs");
  registerTable({
    id: WEATHER_DOC,
    tables: {
      climateModifiers: { Af: { spring: { tDay: -1, tNight: -4, p: 0, w: 0 } } },
      dailyTemperatureLow: [{ min: null, max: 6, key: "cold" }, { min: 7, max: null, key: "balmy" }],
      dailyTemperatureHigh: [{ min: null, max: 4, key: "chilly" }, { min: 5, max: null, key: "warm" }],
      dailyPrecipitation: [{ min: null, max: 7, key: "clear" }, { min: 8, max: null, key: "rainy" }],
      dailyWind: [{ min: null, max: 4, key: "still" }, { min: 5, max: null, key: "moderate" }],
      accumulation: {},
    },
  }, { priority: PRIORITY.WORLD, source: "test" });
  const party = await drawnParty("Presser");
  const { id, walker: mine } = party;
  mine.ownership = { default: 0, PL1: 3 };
  const theirs = await member("Presser B");
  await model.addMember(model.getFormation(id), theirs, null);
  for (const actor of [mine, theirs]) Object.defineProperty(actor, "isOwner", { get: () => actor.testUserPermission(game.user) });
  game.users.push({ id: "PL9", name: "Stranger", isGM: false, isSelf: false });
  const gmUser = game.user;
  // `can` as Foundry's User answers it: only the permission the scenario grants.
  let granted = false;
  for (const user of game.users) user.can = (permission) => user.isGM || (user.id === "PL1" && granted && permission === "SETTINGS_MODIFY");
  const asSeat = async (userId, fn) => {
    game.user = game.users.get(userId);
    try {
      return await fn();
    } finally {
      game.user = gmUser;
    }
  };
  const press = (userId, name, args, extra = {}) => asSeat(userId, () => requests.requestPartyAction(id, "partyPress", { press: name, args, ...extra }));
  const sheet = () => ({ get formation() { return model.getFormation(id); }, render() {} });
  const stored = () => onlyFormation();
  const movementSet = () => stored().travel?.movement?.set ?? null;
  const cellsOf = () => stored().members.map((m) => (m.blank ? "blank" : m.actorId));
  const chatStart = chat.length;
  const said = () => chat.length - chatStart;
  const DialogV2 = foundry.applications.api.DialogV2;
  const [priorConfirm, priorWait, priorPrompt] = [DialogV2.confirm, DialogV2.wait, DialogV2.prompt];
  const priorSet = game.settings.set;
  const priorInstances = foundry.applications.instances;
  const priorRandom = Math.random;
  const savedOrders = [];
  try {
    await model.patchFormation(id, (rec) => { rec.frontage = 2; });
    const [a, b] = [mine.id, theirs.id];

    // --- A parse reads only the keys it names, so a Judge's flag buys a seat nothing.
    const f = stored();
    assert.deepEqual(PARTY_PRESSES.movementTile.parse({ mode: "mounted", judge: true, override: true }, f), { mode: "mounted" });
    for (const args of [{}, { mode: 7 }, { mode: "hover" }, { mode: "__proto__" }, { mode: ["foot"] }, null]) assert.equal(PARTY_PRESSES.movementTile.parse(args, f), null, `movementTile ${JSON.stringify(args)}`);
    for (const entry of ["movementFastest", "movementUndo", "autoArrange", "addBlank", "weatherRoll"]) assert.deepEqual(PARTY_PRESSES[entry].parse({ judge: true, override: true }, f), {}, `${entry} carries nothing`);
    assert.deepEqual(PARTY_PRESSES.removeBlank.parse({ cell: 2, override: true }, f), { cell: 2 });
    for (const args of [{}, { cell: "2" }, { cell: -1 }, { cell: 1.5 }, { cell: NaN }, { cell: null }, null]) assert.equal(PARTY_PRESSES.removeBlank.parse(args, f), null, `removeBlank ${JSON.stringify(args)}`);
    assert.deepEqual(PARTY_PRESSES.moveBlank.parse({ cell: 1, dir: "up", judge: true }, f), { cell: 1, dir: "up" });
    for (const args of [{ cell: 1 }, { cell: 1, dir: "diagonal" }, { cell: 1, dir: "UP" }, { cell: 1, dir: 1 }, { cell: "x", dir: "up" }, { dir: "up" }]) assert.equal(PARTY_PRESSES.moveBlank.parse(args, f), null, `moveBlank ${JSON.stringify(args)}`);
    assert.deepEqual([...PARTY_PRESSES.movementTile.modes, ...PARTY_PRESSES.weatherRoll.modes], ["journey", "journey"], "a tile and Roll weather are the Wilderness tab's");
    for (const entry of ["movementFastest", "movementUndo", "autoArrange", "addBlank", "removeBlank", "moveBlank"]) assert.deepEqual([...PARTY_PRESSES[entry].modes].sort(), ["delve", "journey", "settlement"], `${entry} is open in every mode`);

    // --- A party that is not journeying: the Wilderness tab's presses are stale, the Order head's are not.
    assert.equal(travel.travelOf(stored()).mode, "delve");
    const before = structuredClone(stored());
    assert.deepEqual(await press("PL1", "movementTile", { mode: "foot" }), { ok: false, refused: "stale" });
    assert.deepEqual(await press("PL1", "weatherRoll", {}), { ok: false, refused: "stale" });
    assert.deepEqual(stored(), before, "a stale press wrote nothing");
    assert.equal(said(), 0);

    // --- The grid: each lands from a seat that owns a member, with a Judge's flag beside it ignored, and announces nothing.
    assert.deepEqual(await press("PL1", "addBlank", {}, { judge: true, override: true }), { ok: true });
    assert.deepEqual(cellsOf(), [a, b, "blank"], "a blank joined the grid");
    assert.deepEqual(await press("PL1", "moveBlank", { cell: 2, dir: "left", judge: true }), { ok: false, refused: "stale" }, "the left edge has nothing to swap with");
    assert.deepEqual(await press("PL1", "moveBlank", { cell: 2, dir: "down" }), { ok: false, refused: "stale" }, "nor the bottom");
    assert.deepEqual(await press("PL1", "moveBlank", { cell: 2, dir: "up" }), { ok: true });
    assert.deepEqual(cellsOf(), ["blank", b, a], "up swaps a rank");
    assert.deepEqual(await press("PL1", "moveBlank", { cell: 0, dir: "right" }), { ok: true });
    assert.deepEqual(cellsOf(), [b, "blank", a], "right swaps a file");
    assert.deepEqual(await press("PL1", "moveBlank", { cell: 0, dir: "right" }), { ok: false, refused: "stale" }, "a member's cell is no blank to move");
    assert.deepEqual(await press("PL1", "removeBlank", { cell: 0 }), { ok: false, refused: "stale" }, "a member's cell is no blank to remove");
    assert.deepEqual(await press("PL1", "removeBlank", { cell: 9 }), { ok: false, refused: "stale" }, "nor a cell the grid does not have");
    assert.deepEqual(cellsOf(), [b, "blank", a], "none of them wrote");
    assert.deepEqual(await press("PL1", "autoArrange", {}), { ok: true });
    assert.deepEqual(cellsOf().sort(), [a, b].sort(), "auto-arrange re-lays the party and drops the blank");
    assert.deepEqual(await press("PL1", "addBlank", {}), { ok: true });
    assert.deepEqual(await press("PL1", "removeBlank", { cell: 2, judge: true, override: true }), { ok: true });
    assert.equal(cellsOf().length, 2, "the blank is gone");
    assert.equal(said(), 0, "arrangement presses announce nothing");

    // --- Fastest and Undo, in the delve too.
    await model.patchFormation(id, (rec) => { rec.travel = { ...travel.storedTravelOf(rec), movement: { ...travel.storedTravelOf(rec).movement, set: "mounted" } }; });
    assert.deepEqual(await press("PL1", "movementUndo", {}), { ok: false, refused: "stale" }, "with nothing to put back, Undo is stale");
    assert.deepEqual(await press("PL1", "movementFastest", {}, { judge: true }), { ok: true });
    assert.equal(movementSet(), null, "Fastest clears the group word");

    // --- Journeying: a tile, Fastest and Undo each change the record.
    await model.patchFormation(id, (rec) => {
      const t = travel.storedTravelOf(rec);
      rec.travel = { ...t, mode: "journey", weather: { ...t.weather, climate: "Af", season: "spring", auto: true } };
    });
    assert.deepEqual(await press("PL1", "movementTile", { mode: "foot", judge: true, override: true }, { judge: true, override: true }), { ok: true });
    assert.equal(movementSet(), "foot", "the tile sets the group word");
    assert.deepEqual(await press("PL1", "movementTile", { mode: "hover" }), { ok: false, refused: "badPress" });
    assert.equal(movementSet(), "foot", "a mode outside the closed set wrote nothing");
    await model.patchFormation(id, (rec) => { rec.travel = { ...travel.storedTravelOf(rec), lastArrangement: { members: [], rows: [], set: "mounted" } }; });
    assert.deepEqual(await press("PL1", "movementUndo", {}), { ok: true });
    assert.equal(movementSet(), "mounted", "Undo puts back the word the last press found");
    assert.equal(stored().travel.lastArrangement, null, "and spends the snapshot");
    assert.deepEqual(await press("PL1", "movementFastest", {}), { ok: true });
    assert.equal(movementSet(), null);
    assert.equal(said(), 0, "movement presses announce nothing");

    // --- Roll weather: the Judge's own press, then a seat's, write the same sky; the seat's is announced once.
    // Every die reads 8, so one sky answers both.
    Math.random = () => 0.5;
    const sky = () => {
      const w = travel.storedTravelOf(stored()).weather;
      return { temperature: w.temperature, precipitation: w.precipitation, wind: w.wind, rolls: w.rolls };
    };
    const blankSky = async () => {
      await game.settings.set(MODULE_ID, "skyCache", {});
      await model.patchFormation(id, (rec) => {
        const t = travel.storedTravelOf(rec);
        rec.travel = { ...t, weather: { ...t.weather, temperature: "", precipitation: "", wind: "", rolls: null } };
      });
    };
    await blankSky();
    const judgeChat = chat.length;
    await SHARED_ACTIONS.travelWeatherRoll.call(sheet());
    const judgesCards = chat.length - judgeChat;
    const judgesSky = sky();
    assert.deepEqual(judgesSky.rolls, { t: 8, p: 8, w: 8 }, "the Judge's press rolled a sky");
    await blankSky();
    assert.equal(sky().rolls, null);
    const seatChat = chat.length;
    assert.deepEqual(await press("PL1", "weatherRoll", { judge: true, override: true }, { judge: true }), { ok: true });
    assert.deepEqual(sky(), judgesSky, "the seat's press writes the same sky");
    assert.equal(chat.length - seatChat, judgesCards + 1, "the Judge's cards, plus one announcement");
    assert.match(String(chat.at(-1).content), /request\.weatherRoll/);
    assert.equal(said(), 1);
    Math.random = priorRandom;

    // --- A seat that owns no member is refused every one of them, and nothing is written.
    const kept = structuredClone(stored());
    const keptChat = chat.length;
    const calls = [["movementTile", { mode: "foot" }], ["movementFastest", {}], ["movementUndo", {}], ["autoArrange", {}], ["addBlank", {}], ["removeBlank", { cell: 0 }], ["moveBlank", { cell: 0, dir: "up" }], ["weatherRoll", {}]];
    for (const [name, args] of calls) assert.deepEqual(await press("PL9", name, args, { judge: true, override: true }), { ok: false, refused: "notOwner" }, `${name} from a seat owning no member`);
    assert.deepEqual(stored(), kept, "no refusal wrote");
    assert.equal(chat.length, keptChat, "or announced");
    assert.deepEqual(await press("PL1", "disband", {}), { ok: false, refused: "badPress" }, "Disband is no press");
    assert.equal(await asSeat("PL1", () => requests.requestPartyAction(id, "disband", {})), undefined, "nor a request");
    assert.ok(model.getFormation(id), "the party stands");

    // --- The sheet's own controls, from each seat.
    const cellTarget = (cell) => ({ closest: (sel) => (sel === "[data-cell-index]" ? { dataset: { cellIndex: String(cell) } } : null) });
    await asSeat("PL1", () => SHARED_ACTIONS.addBlank.call(sheet()));
    assert.equal(cellsOf().length, 3, "the player's Add a blank");
    await asSeat("PL1", () => SHARED_ACTIONS.memberUp.call(sheet(), null, cellTarget(2)));
    assert.equal(cellsOf()[2] === "blank", false, "a blank's up arrow moves it, for the player");
    const blankAt = () => cellsOf().indexOf("blank");
    await asSeat("PL1", () => SHARED_ACTIONS.removeBlank.call(sheet(), null, cellTarget(blankAt())));
    assert.equal(cellsOf().length, 2, "the player's Remove on a blank");
    await asSeat("PL9", () => SHARED_ACTIONS.addBlank.call(sheet()));
    await asSeat("PL9", () => SHARED_ACTIONS.autoArrange.call(sheet()));
    assert.equal(cellsOf().length, 2, "a seat owning no member presses nothing");
    await SHARED_ACTIONS.addBlank.call(sheet());
    await SHARED_ACTIONS.memberUp.call(sheet(), null, cellTarget(2));
    assert.equal(cellsOf().length, 3, "the Judge's seat keeps its own grid presses");
    assert.notEqual(cellsOf()[2], "blank", "a blank's arrow moves for the Judge's seat too");
    await SHARED_ACTIONS.removeBlank.call(sheet(), null, cellTarget(blankAt()));
    assert.equal(cellsOf().length, 2);
    await asSeat("PL1", () => SHARED_ACTIONS.movementTile.call(sheet(), null, { dataset: { mode: "foot" } }));
    assert.equal(movementSet(), "foot", "the player's tile");
    await asSeat("PL1", () => SHARED_ACTIONS.movementFastest.call(sheet()));
    assert.equal(movementSet(), null, "the player's Fastest");
    await asSeat("PL9", () => SHARED_ACTIONS.movementTile.call(sheet(), null, { dataset: { mode: "foot" } }));
    assert.equal(movementSet(), null, "a seat owning no member sets no tile");
    await SHARED_ACTIONS.movementTile.call(sheet(), null, { dataset: { mode: "foot" } });
    assert.equal(movementSet(), "foot", "the Judge's tile");
    await asSeat("PL1", () => SHARED_ACTIONS.movementTile.call(sheet(), null, { dataset: { mode: "hover" } }));
    assert.equal(movementSet(), "foot", "a tile outside the closed set writes nothing");
    await blankSky();
    await asSeat("PL9", () => SHARED_ACTIONS.travelWeatherRoll.call(sheet()));
    assert.equal(sky().rolls, null, "a seat owning no member rolls no weather");
    Math.random = () => 0.5;
    await asSeat("PL1", () => SHARED_ACTIONS.travelWeatherRoll.call(sheet()));
    Math.random = priorRandom;
    assert.deepEqual(sky().rolls, { t: 8, p: 8, w: 8 }, "the player's Roll weather");

    // --- Save order: one world list, written direct by a seat that may change world settings.
    // A world setting is the Judge's to write unless the user may modify settings, as Foundry has it.
    game.settings.set = async (ns, key, value) => {
      const user = game.user;
      if (user.isGM || !user.can("SETTINGS_MODIFY")) return priorSet.call(game.settings, ns, key, value);
      game.user = gmUser;
      try {
        return await priorSet.call(game.settings, ns, key, value);
      } finally {
        game.user = user;
      }
    };
    let prompts = 0;
    DialogV2.prompt = async () => (prompts++, "Seat order");
    const orderNamed = (name) => marching.listTemplates().find((t) => t.name === name);
    await asSeat("PL1", () => SHARED_ACTIONS.saveMarchingOrder.call(sheet()));
    assert.equal(prompts, 0, "a seat without SETTINGS_MODIFY is not asked a name");
    assert.equal(orderNamed("Seat order"), undefined, "and saves nothing");
    granted = true;
    await asSeat("PL1", () => SHARED_ACTIONS.saveMarchingOrder.call(sheet()));
    assert.equal(prompts, 1);
    assert.ok(orderNamed("Seat order"), "a seat with SETTINGS_MODIFY saves direct");
    savedOrders.push(orderNamed("Seat order").id);
    granted = false;
    await asSeat("PL9", () => SHARED_ACTIONS.saveMarchingOrder.call(sheet()));
    assert.equal(prompts, 1, "a seat owning no member is not asked either");
    DialogV2.prompt = async () => (prompts++, "Judge order");
    await SHARED_ACTIONS.saveMarchingOrder.call(sheet());
    assert.ok(orderNamed("Judge order"), "the Judge saves as before");
    savedOrders.push(orderNamed("Judge order").id);

    // --- Load order: the pick runs on the seat and a player's apply is the `formUp` relay.
    const mark = orderNamed("Judge order");
    const standingOrder = () => cellsOf();
    await model.patchFormation(id, (rec) => { rec.members.reverse(); });
    assert.notDeepEqual(standingOrder(), mark.cells.map((c) => c.actorId), "the party stands out of the saved order");
    let picks = 0;
    DialogV2.wait = async () => (picks++, { id: mark.id, action: "apply" });
    await asSeat("PL9", () => SHARED_ACTIONS.loadMarchingOrder.call(sheet()));
    assert.equal(picks, 0, "a seat owning no member is offered no pick");
    const loadChat = chat.length;
    await asSeat("PL1", () => SHARED_ACTIONS.loadMarchingOrder.call(sheet()));
    assert.equal(picks, 1, "the pick runs on the seat");
    assert.deepEqual(standingOrder(), mark.cells.map((c) => c.actorId), "the party stands in the saved order");
    assert.equal(chat.length - loadChat, 1, "announced once");
    assert.match(String(chat.at(-1).content), /request\.formUp/);
    DialogV2.wait = async () => ({ id: "nowhere", action: "apply" });
    await asSeat("PL1", () => SHARED_ACTIONS.loadMarchingOrder.call(sheet()));
    assert.deepEqual(standingOrder(), mark.cells.map((c) => c.actorId), "an order that no longer exists changes nothing");

    // --- The skill audit opens on a seat that owns a member, and on no other.
    const standing = { renders: 0, render() { this.renders++; return Promise.resolve(); }, bringToFront() {} };
    foundry.applications.instances = new Map([[auditWindowId(id), standing]]);
    await asSeat("PL9", () => SHARED_ACTIONS.openSkillAudit.call(sheet()));
    assert.equal(standing.renders, 0, "a seat owning no member opens nothing");
    await asSeat("PL1", () => SHARED_ACTIONS.openSkillAudit.call(sheet()));
    assert.equal(standing.renders, 1, "a seat that owns a member opens the audit");
    await SHARED_ACTIONS.openSkillAudit.call(sheet());
    assert.equal(standing.renders, 2, "and so does the Judge's");
    foundry.applications.instances = priorInstances;

    // --- Disband stays the Judge's.
    let asked = 0;
    DialogV2.confirm = async () => (asked++, true);
    await asSeat("PL1", () => SHARED_ACTIONS.disband.call(sheet()));
    assert.equal(asked, 0, "a seat that owns a member is not asked to disband");
    assert.ok(model.getFormation(id), "the party stands");
  } finally {
    Math.random = priorRandom;
    game.settings.set = priorSet;
    DialogV2.confirm = priorConfirm;
    DialogV2.wait = priorWait;
    DialogV2.prompt = priorPrompt;
    foundry.applications.instances = priorInstances;
    for (const orderId of savedOrders) await marching.deleteTemplate(orderId);
    unregisterTable(WEATHER_DOC, { priority: PRIORITY.WORLD });
    for (const user of game.users) delete user.can;
    game.user = gmUser;
    game.users.pop();
    await dismissDrawn(party);
    game.actors.delete(theirs.id);
  }
});

await scenario("a player brings their own actors in and takes them out through the GM relay", async () => {
  const theirs = (name) => ActorMock.create({
    name,
    type: "character",
    ownership: { default: 0, PL1: 3 },
    system: { hp: { value: 5, max: 5 }, details: { level: 1 }, movementacks: { exploration: 120 } },
  });
  const seated = await theirs("Kell");
  const walker = await theirs("Hale");
  const follower = await theirs("Ives");
  const stranger = await member("Jory"); // GM-owned only
  const outsider = await member("Lark"); // GM-owned only, in no party
  await drain();

  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  const [seatedToken, walkerToken] = await scene.createEmbeddedDocuments("Token", [
    { name: "Kell", actorId: seated.id, x: 0, y: 0 },
    { name: "Hale", actorId: walker.id, x: 100, y: 100 },
  ]);
  let formation = await model.createFormation("Door Party");
  formation = await model.addMember(formation, seated, seatedToken);
  await model.addMember(model.getFormation(formation.id), stranger, null);
  await drain();
  const id = onlyFormation().id;
  const ids = () => onlyFormation().members.map((m) => m.actorId);
  const player = game.users.get("PL1");

  assert.deepEqual(
    membership.bringableActors(player).filter((a) => [walker.id, follower.id, seated.id, stranger.id].includes(a.id)).map((a) => a.name),
    ["Hale", "Ives"],
    "the list holds the seat's own people who stand in no party, by name",
  );
  assert.equal(membership.partyOnScene(scene, player)?.id, id, "the party on the scene is the one a token of theirs joins");
  assert.equal(membership.canMarch({ type: `${MODULE_ID}.party` }), false, "a party is no member");
  assert.equal(membership.canMarch({ type: `${MODULE_ID}.location`, documentName: "Actor" }), false, "a place is no member");

  const gmUser = game.user;
  game.user = player;
  const seen = chat.length;
  try {
    const noticed = notices.length;
    await requests.requestBringIn(onlyFormation(), outsider);
    await drain();
    assert.ok(notices.slice(noticed).some((n) => String(n.msg ?? n).includes("Lark") || String(n.msg ?? n).includes("notYours")), "the seat is told why it cannot bring another's actor");
    await getSocket().executeAsGM("partyRequest", { formationId: id, type: "bringIn", payload: { actorId: outsider.id } });
    await drain();
    assert.deepEqual(ids(), [seated.id, stranger.id], "a forged request for an actor the sender does not own writes nothing");

    await requests.requestBringIn(onlyFormation(), walker, walkerToken);
    await drain();
    assert.deepEqual(ids(), [seated.id, stranger.id, walker.id], "their token's actor joins");
    assert.ok(!scene.tokens.some((t) => t.actorId === walker.id), "stepping in takes the token off the map");
    assert.ok(onlyFormation().members.at(-1).tokenData, "and stashes it on the record");

    await requests.requestBringIn(onlyFormation(), follower);
    await drain();
    assert.deepEqual(ids(), [seated.id, stranger.id, walker.id, follower.id], "an actor with no token joins from the list");
    assert.equal(onlyFormation().members.at(-1).tokenData, null, "with nothing to stash");
    assert.equal(membership.bringInRefusal(onlyFormation(), follower, player)?.key, "inParty", "and cannot join twice");

    await getSocket().executeAsGM("partyRequest", { formationId: id, type: "takeOut", payload: { actorId: stranger.id } });
    await drain();
    assert.ok(ids().includes(stranger.id), "a forged request cannot take out a member the sender does not own");

    await requests.requestTakeOut(onlyFormation(), walker.id);
    await drain();
    assert.ok(!ids().includes(walker.id), "their own member leaves");
    assert.ok(scene.tokens.some((t) => t.actorId === walker.id), "and the token stashed for them returns to the map");
    assert.equal(chat.length - seen, 3, "the table is told each time, and of no refusal");

    game.user = gmUser; // the combat flag is the Judge's write
    const inCombat = onlyFormation();
    inCombat.combat = { active: true, combatId: "stub" };
    await model.updateFormation(inCombat);
    await drain();
    game.user = player;
    assert.equal(membership.takeOutRefusal(onlyFormation(), follower.id, player), null, "a fight does not refuse the leaving");
    assert.equal(membership.bringInRefusal(onlyFormation(), walker, player), null, "nor the joining");
    await requests.requestTakeOut(onlyFormation(), follower.id);
    await getSocket().executeAsGM("partyRequest", { formationId: id, type: "bringIn", payload: { actorId: walker.id } });
    await drain();
    assert.deepEqual(ids(), [seated.id, stranger.id, walker.id], "the relayed take-out and bring-in both write during a fight");
    const joined = onlyFormation().members.at(-1);
    assert.equal(joined.deployedCombatId, "stub", "the one brought in is recorded as the fight's");
    assert.ok(joined.deployedTokenId && scene.tokens.get(joined.deployedTokenId)?.actorId === walker.id, "with its token still on the map");
  } finally {
    game.user = gmUser;
  }

  await model.disband(model.getFormation(id));
  await drain();
});

await scenario("leaving a member behind is the owner's declaration, refused otherwise and recorded in combat", async () => {
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
    assert.equal(leftOf(owned), true, "a declaration during combat records the decision");
    await requests.requestPartyAction(id, "leftBehind", { actorId: owned.id });
    await drain();
    assert.equal(leftOf(owned), false, "and so does going back for them");
  } finally {
    game.user = gmUser;
  }

  await model.disband(model.getFormation(id));
  await drain();
});

await scenario("a line-up change during a fight keeps the fight's tokens whole", async () => {
  const theirs = (name) => ActorMock.create({
    name,
    type: "character",
    ownership: { default: 0, PL1: 3 },
    system: { hp: { value: 5, max: 5 }, details: { level: 1 }, movementacks: { exploration: 120 } },
  });
  const leaver = await theirs("Orla");
  const stayer = await theirs("Pike");
  const joiner = await theirs("Quin");
  await drain();

  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  const [leaverToken, stayerToken] = await scene.createEmbeddedDocuments("Token", [
    { name: "Orla", actorId: leaver.id, x: 300, y: 300 },
    { name: "Pike", actorId: stayer.id, x: 400, y: 300 },
  ]);
  let formation = await model.createFormation("Fight Party");
  formation = await model.addMember(formation, leaver, leaverToken);
  await model.addMember(model.getFormation(formation.id), stayer, stayerToken);
  await drain();
  const id = onlyFormation().id;

  const combat = new CombatMock();
  game.combats.set(combat.id, combat);
  await combat.createEmbeddedDocuments("Combatant", [
    { tokenId: onlyFormation().tokenId, sceneId: scene.id, actorId: onlyFormation().actorId, hidden: false },
  ]);
  await drain();
  const heldOf = (actor) => onlyFormation().members.find((m) => m.actorId === actor.id);
  const leaverBody = heldOf(leaver).deployedTokenId;
  assert.ok(leaverBody && scene.tokens.get(leaverBody), "the fight deployed the member");
  assert.equal(heldOf(leaver).deployedCombatId, combat.id, "and recorded the combat");
  const bodiesOf = (actor) => scene.tokens.filter((t) => t.actorId === actor.id).length;

  const gmUser = game.user;
  game.user = game.users.get("PL1");
  try {
    await requests.requestTakeOut(onlyFormation(), leaver.id);
    await drain();
    assert.ok(!heldOf(leaver), "the member leaves the record");
    assert.ok(scene.tokens.get(leaverBody), "their deployed token stays where it stood");
    assert.equal(bodiesOf(leaver), 1, "and no token is created beside the party token");
    assert.ok(combat.combatants.some((c) => c.tokenId === leaverBody), "the combatant keeps its token");

    const [joinerToken] = await scene.createEmbeddedDocuments("Token", [{ name: "Quin", actorId: joiner.id, x: 700, y: 300 }]);
    await requests.requestBringIn(onlyFormation(), joiner, joinerToken);
    await drain();
    const joined = heldOf(joiner);
    assert.equal(joined?.deployedTokenId, joinerToken.id, "a member brought in is recorded as standing as its token");
    assert.equal(joined.deployedSceneId, scene.id, "on its scene");
    assert.equal(joined.deployedCombatId, combat.id, "in this fight");
    assert.ok(scene.tokens.get(joinerToken.id), "and its token is kept");
    assert.ok(joined.tokenData, "its snapshot is stashed as a deployed member's is");
  } finally {
    game.user = gmUser;
  }

  await combat.delete();
  await drain();
  const after = onlyFormation();
  assert.equal(after.combat, null, "the fight's end reforms the party");
  assert.ok(!after.members.some((m) => m.deployedTokenId), "every member is gathered");
  assert.ok(after.members.find((m) => m.actorId === joiner.id)?.tokenData, "the one brought in is back inside, stashed");
  assert.equal(bodiesOf(joiner), 0, "its token is gathered with the rest");
  assert.equal(bodiesOf(stayer), 0, "so is the one who stayed");
  assert.ok(scene.tokens.get(leaverBody), "the token of the one taken out stays on the map, outside the party");

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
      adventuring: { listening: 13, searching: 13, dungeonbashing: 13 },
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

  // The grant API stands in for the equipment feature, which is what makes "no
  // override" PROVABLE: with it installed a Judge's click conjures the kit, so
  // a player's click conjuring nothing is the authority gate holding rather
  // than the grant simply being absent.
  globalThis.acksExtras.equipment = {
    spareHands: () => 2,
    async grantGear(actor, specs) {
      const missing = specs.filter((s) => !actor.items.some((i) => s.pattern.test(i.name)));
      if (!missing.length) return [];
      // A spec with no name is found by its pattern; with nothing to find, the
      // stand-in is named by its label, as grant.mjs names it.
      return actor.createEmbeddedDocuments(
        "Item",
        missing.map((s) => ({ name: s.name ?? game.i18n.localize(s.label), type: "item", system: { quantity: 1 } })),
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
      { name: "Flask of Oil", type: "item", system: { quantity: 2 } },
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
      { name: "Flask of Oil", type: "item", system: { quantity: 2 } },
    ]);
    await drain();
    await declareLightAction(solo, "light", { lightType: "lantern", bearerId: solo.id });
    await drain();

    const lights = lightLib.bearerLights(solo);
    assert.equal(lights.length, 1, "a lone character lights their own lantern");
    assert.ok(lights[0].lit, "and it is burning");
    assert.equal(
      solo.items.find((i) => /oil/i.test(i.name)).system.quantity,
      1,
      "striking it burns a flask of oil, the same as it would in a party",
    );
    assert.deepEqual(
      lightLib.emittedLight(lights),
      { bright: INVENTED_LIGHTS.lantern.bright, dim: INVENTED_LIGHTS.lantern.dim },
      "the token sheds a lantern's light",
    );

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
    { name: "Flask of Oil", type: "item", system: { quantity: 1 } },
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
    withKit.items.find((i) => /oil/i.test(i.name)).system.quantity,
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
      adventuring: { listening: 13, searching: 13, dungeonbashing: 13 },
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
  assert.ok(daveSeg.includes('data-action="removeMember"'), "a player can take out their own member");

  const eveSeg = seg(eve.id);
  const eveChips = chipStates(eveSeg);
  assert.ok(eveChips.length > 0 && eveChips.every(Boolean), "unowned member's role chips are disabled");
  assert.ok(!eveSeg.includes('data-action="removeMember"'), "and no player can take out another's");

  assert.ok(html.includes("ACKS-FORMATION.map.section"), "maps section renders for players");
  assert.ok(!html.includes("distorted"), "no distortion tell in a player render");
  assert.ok(!html.includes('data-action="advanceTurn"'), "GM clock buttons absent for players");
  assert.ok(!html.includes("data-magic-light"), "no effect light, no magic-light row");

  // A member's effect light is a row on the Kit tab, with its source in the
  // figure's tooltip, its state beside it and a shutter for the seat that owns
  // the effect; one with no reach says so.
  const { MAGIC_LIGHT_CHANGE_KEYS } = await import("../scripts/lib/light.mjs");
  const change = (key, value) => ({ key, type: "upgrade", value });
  // An effect's `isOwner` is read per seat, as core's is: the Judge and the named users own it.
  const ownedBy = (effect, ...ids) => Object.defineProperty(effect, "isOwner", { get: () => game.user.isGM || ids.includes(game.user.id), enumerable: true });
  dave.effects.push(
    ownedBy({
      id: "fxlit",
      name: "Glow",
      disabled: false,
      parent: { documentName: "Item", name: "Lamp of Testing" },
      changes: [change(MAGIC_LIGHT_CHANGE_KEYS.bright, "11"), change(MAGIC_LIGHT_CHANGE_KEYS.dim, "23")],
    }, "PL1"),
    ownedBy({ id: "fxblank", name: "Blank", disabled: false, parent: { documentName: "Actor" }, changes: [change(MAGIC_LIGHT_CHANGE_KEYS.bright, "")] }, "PL1"),
    ownedBy({
      id: "fxpart",
      name: "Half",
      disabled: false,
      parent: { documentName: "Actor" },
      changes: [change(MAGIC_LIGHT_CHANGE_KEYS.bright, "7"), change(MAGIC_LIGHT_CHANGE_KEYS.dim, "")],
    }, "PL1"),
  );
  // A light on a member the player does not own: the Judge's seat only.
  eve.effects.push(ownedBy({
    id: "fxeve",
    name: "Spark",
    disabled: false,
    parent: { documentName: "Item", name: "Eve Lamp" },
    changes: [change(MAGIC_LIGHT_CHANGE_KEYS.bright, "5")],
  }));
  // A cast's blank-reach light on a member the player does not own: Set reach is the Judge's seat only.
  eve.effects.push(ownedBy({ id: "fxeveblank", name: "Eve Blank", disabled: false, parent: { documentName: "Actor" }, changes: [change(MAGIC_LIGHT_CHANGE_KEYS.bright, "")] }));
  game.user = game.users.get("PL1");
  let magicHtml;
  let judgeHtml;
  let shutteredHtml;
  let stowedHtml;
  const fxlit = dave.effects.find((e) => e.id === "fxlit");
  try {
    magicHtml = template({ isGM: false, formation, ...view.buildFormationView(formation), ...view.buildPlayerPanel(formation) });
    game.user = gmUser;
    judgeHtml = template({ isGM: true, formation, ...view.buildFormationView(formation) });
    // The owner shutters it: the state reads shuttered and the button offers Open.
    game.user = game.users.get("PL1");
    fxlit.flags = { "acks-extras": { lightShutter: true } };
    shutteredHtml = template({ isGM: false, formation, ...view.buildFormationView(formation), ...view.buildPlayerPanel(formation) });
    // The same effect on a thing stowed in a container reads stowed, shutter or no.
    fxlit.parent = {
      documentName: "Item",
      name: "Lamp of Testing",
      type: "item",
      system: { cost: 1, weight6: 1 },
      flags: { "acks-extras": { containedIn: "bag1" } },
      parent: { items: new Map([["bag1", { id: "bag1", name: "Test Pack" }]]) },
    };
    stowedHtml = template({ isGM: false, formation, ...view.buildFormationView(formation), ...view.buildPlayerPanel(formation) });
  } finally {
    game.user = gmUser;
    dave.effects.length = 0;
    eve.effects.length = 0;
  }
  const rows = [...magicHtml.matchAll(/<div class="light magic-light"[\s\S]*?<\/div>/g)].map((m) => m[0]);
  assert.equal(rows.length, 5, "one row per magic light, the other member's included");
  assert.ok(rows[0].includes(`data-magic-light="${dave.id}.fxlit"`) && rows[0].includes("Lamp of Testing"), "the row names the item it rides on");
  assert.ok(rows[0].includes("magicLightReach") && rows[0].includes("&quot;bright&quot;:11") && rows[0].includes("&quot;dim&quot;:23"), "the row shows both radii");
  assert.ok(rows[0].includes("magicLightTip") && rows[0].includes("Lamp of Testing"), "the figure's tooltip names the item the light rides on");
  assert.ok(!rows[0].includes("Glow") && rows[0].includes("effects.lightEffect"), "a player is not told an item-borne effect's own name");
  const judgeRow = judgeHtml.match(/<div class="light magic-light" data-magic-light="[^"]*fxlit"[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.ok(judgeRow.includes("Glow") && judgeRow.includes("Lamp of Testing"), "the Judge's tooltip names the effect and its item");
  assert.ok(rows[1].includes("magicLightNotSet") && !rows[1].includes("magicLightReach") && !rows[1].includes("magicLightTip"), "a light with no reach says it is not set and shows no figure");
  assert.ok(rows[2].includes("magicLightBrightOnly") && !rows[2].includes("magicLightReach") && !rows[2].includes("&quot;dim&quot;"), "a light with one radius shows that radius and no zero for the other");

  // Set reach: a blank-reach row offers it to a seat that owns the record and to no other; a row with any reach offers none.
  const SET_REACH = 'data-action="setLightReach"';
  assert.ok(rows[1].includes(SET_REACH) && rows[1].includes(`data-light-actor="${dave.id}"`) && rows[1].includes('data-light-effect="fxblank"'), "the owner of a blank-reach record is offered Set reach, naming the record");
  assert.ok(!rows[0].includes(SET_REACH) && !rows[2].includes(SET_REACH), "a row with a reach, bright only included, offers none");
  const setReachButton = rows[1].match(/<button[^>]*setLightReach[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.ok(setReachButton.includes('type="button"') && setReachButton.includes("aria-label=") && setReachButton.includes("setReachAria") && !setReachButton.includes(" title="), "a real button named by its aria-label, with no title attribute");
  assert.ok(!rows[4].includes(SET_REACH), "a seat that does not own the record is offered none");
  const eveBlankJudge = judgeHtml.match(/<div class="light magic-light" data-magic-light="[^"]*fxeveblank"[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.ok(eveBlankJudge.includes(SET_REACH), "the Judge's seat owns every record and is offered it");
  assert.ok(!rows.some((row) => row.includes("removeMagicLight")), "no End control is added to a magic light row");

  // A daylight band leads the row, before the bright and dim pair; alone, it
  // is the whole row.
  dave.effects.push(
    ownedBy({ id: "fxday", name: "Noon", disabled: false, parent: { documentName: "Actor" }, changes: [change(MAGIC_LIGHT_CHANGE_KEYS.daylight, "9"), change(MAGIC_LIGHT_CHANGE_KEYS.bright, "13"), change(MAGIC_LIGHT_CHANGE_KEYS.dim, "17")] }, "PL1"),
    ownedBy({ id: "fxdayonly", name: "Glare", disabled: false, parent: { documentName: "Actor" }, changes: [change(MAGIC_LIGHT_CHANGE_KEYS.daylight, "9")] }, "PL1"),
  );
  try {
    const dayRows = view.magicLightRows(formation);
    const full = dayRows.find((r) => r.effectId === "fxday");
    const only = dayRows.find((r) => r.effectId === "fxdayonly");
    assert.ok(full.set && full.reachText.startsWith("ACKS-FORMATION.app.magicLightDaylight") && full.reachText.includes("magicLightReach"), "daylight first, then the pair");
    assert.ok(only.set && only.reachText.startsWith("ACKS-FORMATION.app.magicLightDaylight") && !only.reachText.includes("magicLightReach") && !only.reachText.includes("Only"), "a daylight-only light shows daylight alone");
  } finally {
    dave.effects.length = 0;
  }

  // A light a cast wrote carries the spell's page: with a reach its tip names the
  // spell, the bearer and the page; with none its cell is blank and the page alone
  // is the tip; an effect carrying no page reads as it always did.
  const castFlag = { "acks-extras": { magicLightCite: "RR 99" } };
  dave.effects.push(
    ownedBy({ id: "fxcast", name: "Spell Glow", disabled: false, parent: { documentName: "Actor" }, flags: castFlag, changes: [change(MAGIC_LIGHT_CHANGE_KEYS.bright, "30"), change(MAGIC_LIGHT_CHANGE_KEYS.dim, "")] }, "PL1"),
    ownedBy({ id: "fxcastblank", name: "Spell Blank", disabled: false, parent: { documentName: "Actor" }, flags: castFlag, changes: [change(MAGIC_LIGHT_CHANGE_KEYS.bright, "")] }, "PL1"),
    ownedBy({ id: "fxplain", name: "Plain", disabled: false, parent: { documentName: "Actor" }, changes: [change(MAGIC_LIGHT_CHANGE_KEYS.bright, "")] }, "PL1"),
  );
  try {
    const castRows = view.magicLightRows(formation);
    const cast = castRows.find((r) => r.effectId === "fxcast");
    const blank = castRows.find((r) => r.effectId === "fxcastblank");
    const plain = castRows.find((r) => r.effectId === "fxplain");
    assert.ok(cast.set && cast.tip.startsWith("ACKS-FORMATION.app.magicLightCastTip") && cast.tip.includes("Spell Glow") && cast.tip.includes("RR 99") && cast.tip.includes(dave.name) && cast.tip.includes("magicLightBrightOnly"), "a cast light's tip names the spell, its bearer, the page and the reach");
    assert.ok(!blank.set && blank.reachText === "" && blank.tip === "RR 99", "a cast light with no reach shows a blank cell and the page alone as its tip");
    assert.ok(!plain.set && plain.reachText === "ACKS-FORMATION.app.magicLightNotSet" && plain.tip.startsWith("ACKS-FORMATION.app.magicLightNotSetTip"), "a light with no page keeps the not-set words and tip");
  } finally {
    dave.effects.length = 0;
  }

  // Light here: one reading line at the party's own token, read through lib's
  // `lightLevelOf`, with the deciding source and its page as the tooltip. A
  // party with no token on its scene has no line.
  {
    const SCENE_ID = "scene-light-here";
    game.scenes.set(SCENE_ID, { id: SCENE_ID, tokens: new Coll([["tok-lh", { id: "tok-lh", name: "Party" }]]) });
    const placed = { sceneId: SCENE_ID, tokenId: "tok-lh" };
    const reading = (level, source) => () => ({ level, by: source ? "light" : "none", source });
    try {
      for (const level of ["daylight", "bright", "dim", "dark"]) {
        const line = view.lightHere(placed, reading(level, level === "dark" ? null : { kind: "ambient", name: "Brazier", cite: null }));
        assert.equal(line.level, level, `${level}: the line carries the stage`);
        assert.equal(line.label, `ACKS-LIB.light.level.${level}`, `${level}: the line names the stage by the module's own lang key`);
        assert.equal(line.caption, "ACKS-FORMATION.app.lightHereLabel", "the line is captioned Light here");
      }

      const placedLight = view.lightHere(placed, reading("daylight", { kind: "ambient", name: "Brazier", cite: "RR p. 228" }));
      assert.ok(placedLight.tip.includes("lightHereKindAmbient") && placedLight.tip.includes("Brazier") && placedLight.tip.includes("RR p. 228"), "the tooltip names the source's kind, its name and its page");
      const noPage = view.lightHere(placed, reading("bright", { kind: "token", name: "Torch", cite: null }));
      assert.ok(noPage.tip.includes("lightHereKindToken") && noPage.tip.includes("Torch") && !noPage.tip.includes("RR"), "with no page the tooltip carries the source alone and invents none");
      const unnamed = view.lightHere(placed, reading("dim", { kind: "column", name: null, cite: null }));
      assert.ok(unnamed.tip.includes("lightHereKindColumn") && !unnamed.tip.includes("lightHereNamed"), "a source with no name is named by its kind alone");
      const sky = view.lightHere(placed, reading("daylight", { kind: "sky", name: null, cite: "RR ch. 6" }));
      assert.ok(sky.tip.includes("lightHereKindSky") && sky.tip.includes("RR ch. 6"), "the sky is named, with its chapter");
      const extra = view.lightHere(placed, reading("bright", { kind: "extra", name: null, cite: null }));
      assert.ok(extra.tip.includes("lightHereKindExtra"), "a light a caller states is named by its kind");
      const dark = view.lightHere(placed, reading("dark", null));
      assert.equal(dark.tip, "", "a dark point has no deciding source, so no tooltip words stand in for one");

      let asked = 0;
      const counting = () => {
        asked += 1;
        return { level: "bright", by: "light", source: null };
      };
      assert.equal(view.lightHere({ sceneId: SCENE_ID, tokenId: null }, counting), null, "a party with no token has no line");
      assert.equal(view.lightHere({ sceneId: SCENE_ID, tokenId: "gone" }, counting), null, "a record whose token is gone has no line");
      assert.equal(view.lightHere({ sceneId: "elsewhere", tokenId: "tok-lh" }, counting), null, "a record whose scene is gone has no line");
      assert.equal(asked, 0, "no token is never read for a reading");
      assert.equal(view.lightHere(placed, () => null), null, "a token on a scene that reads nothing has no line");

      // A journey reads its own night, so the line is not drawn there; a hidden party token no longer says where the party stands.
      assert.equal(view.lightHere({ ...placed, travel: { mode: "journey" } }, counting), null, "a journeying party has no line");
      assert.ok(view.lightHere({ ...placed, travel: { mode: "delve" } }, counting), "a party in the delve has one");
      game.scenes.get(SCENE_ID).tokens.set("tok-hid", { id: "tok-hid", name: "Party", hidden: true });
      assert.equal(view.lightHere({ sceneId: SCENE_ID, tokenId: "tok-hid" }, counting), null, "a hidden party token has no line");
      assert.equal(asked, 1, "neither a journey nor a hidden token is read for a reading (the delve read once)");

      // A token's name reaches a seat only where Foundry lets it see the token's actor.
      const torch = { kind: "token", name: "Torch", cite: null, id: "tok-lit" };
      assert.ok(view.lightHere(placed, reading("bright", torch), () => true).tip.includes("Torch"), "named where the seat may be told");
      const unnamedTip = view.lightHere(placed, reading("daylight", { ...torch, cite: "RR p. 228" }), () => false).tip;
      assert.ok(unnamedTip.includes("lightHereKindToken") && !unnamedTip.includes("Torch") && unnamedTip.includes("RR p. 228"), "a seat refused the name is told the kind and the page");
      const seen = (permission) => ({ id: "tok-lit", actor: { testUserPermission: (user, level) => level === "OBSERVER" && user === game.user && permission } });
      game.scenes.get(SCENE_ID).tokens.set("tok-lit", seen(true));
      assert.equal(view.canNameLightSource(placed, torch), true, "an Observer is told the token's name");
      game.scenes.get(SCENE_ID).tokens.set("tok-lit", seen(false));
      assert.equal(view.canNameLightSource(placed, torch), false, "a seat with less than Observer is not");
      game.scenes.get(SCENE_ID).tokens.set("tok-lit", { id: "tok-lit" });
      assert.equal(view.canNameLightSource(placed, torch), false, "a token with no actor to ask is not named");
      assert.equal(view.canNameLightSource(placed, { ...torch, id: "nobody" }), false, "nor one that is not on the scene");
      assert.equal(view.canNameLightSource(placed, { kind: "ambient", name: "Brazier", id: "a1" }), true, "a placed light's label is not an actor's secret");
      assert.equal(view.canNameLightSource(placed, { kind: "sky", name: null }), true, "the sky is named freely");

      // The template draws the line for a seat that sees the tab, and no line at all without one.
      const drawn = parts[1]({ isGM: false, formation, lightHere: placedLight });
      const hereRow = drawn.match(/<div class="light light-here"[\s\S]*?<\/div>/)?.[0] ?? "";
      assert.ok(hereRow.includes("lightHereLabel") && hereRow.includes("ACKS-LIB.light.level.daylight"), "the Kit tab states the stage in words beside its caption");
      assert.ok(hereRow.includes("data-tooltip-text=") && hereRow.includes("Brazier") && !hereRow.includes(" title="), "its tooltip is core's text tooltip, never a title");
      assert.ok(!parts[1]({ isGM: false, formation, lightHere: null }).includes("light-here"), "no token, no line, and no words saying a reading is missing");
      const darkRow = parts[1]({ isGM: false, formation, lightHere: dark }).match(/<div class="light light-here"[\s\S]*?<\/div>/)?.[0] ?? "";
      assert.ok(darkRow.includes("ACKS-LIB.light.level.dark") && !darkRow.includes("data-tooltip-text"), "a dark reading draws its stage and no empty tooltip");
    } finally {
      game.scenes.delete(SCENE_ID);
    }
  }

  // The owner's seat is offered a shutter on each of their own lights; an
  // observer of another member's light sees its state and no button.
  assert.ok(rows.slice(0, 3).every((row) => row.includes('data-action="shutterMagicLight"')), "the owner sees a shutter on each of their lights");
  assert.ok(
    rows[0].includes(`data-light-actor="${dave.id}"`) && rows[0].includes('data-light-effect="fxlit"'),
    "the button names the member and the effect the action finds again",
  );
  const button = rows[0].match(/<button[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.ok(button.includes('type="button"') && button.includes("aria-label=") && button.includes("shutterAria") && button.includes("Lamp of Testing"), "a real button, named for the item");
  assert.ok(button.includes("data-tooltip-text=") && button.includes("shutterTip") && !button.includes("Glow"), "its tooltip speaks of the item, not the effect");
  assert.ok(rows[0].includes("state.label.shining") && rows[0].includes("sparkles lit"), "a shining light says shining and its glyph is lit");
  assert.ok(rows[0].includes("why.item"), "the badge's tooltip names why it shines");
  assert.ok(!rows[3].includes("<button") && rows[3].includes("state.label.shining"), "an observer sees the state and no shutter");
  const eveJudge = judgeHtml.match(/<div class="light magic-light" data-magic-light="[^"]*fxeve"[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.ok(eveJudge.includes('data-action="shutterMagicLight"'), "the Judge's seat owns every effect and is offered the shutter");
  const shutteredRow = shutteredHtml.match(/<div class="light magic-light unlit"[^>]*fxlit[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.ok(shutteredRow.includes("state.label.shuttered") && shutteredRow.includes("why.shuttered"), "a shuttered light reads shuttered, and says by hand");
  assert.ok(shutteredRow.includes("openAria") && shutteredRow.includes("state.open"), "and its button offers Open");
  assert.ok(!shutteredRow.includes("sparkles lit"), "the glyph is no longer lit");
  const stowedRow = stowedHtml.match(/<div class="light magic-light unlit"[^>]*fxlit[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.ok(stowedRow.includes("state.label.stowed") && stowedRow.includes("why.container") && stowedRow.includes("Test Pack"), "a stowed light reads stowed and names its container");

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

  // An open sheet redraws when a member's ownership changes: the shutter button
  // is drawn from `isOwner`, which a drop to Observer changes with no other write.
  const watched = new partyActorModule.PartySheet({ document: partyActor });
  let redraws = 0;
  watched.render = () => {
    redraws += 1;
    return watched;
  };
  watched.rendered = true;
  const before = new Map([...hooks].map(([name, list]) => [name, list.length]));
  await watched._onFirstRender({}, {});
  try {
    Hooks.call("updateActor", dave, { ownership: { PL1: 2 } });
    assert.equal(redraws, 1, "a member's ownership change redraws the open sheet");
    Hooks.call("updateActor", dave, { name: "Renamed" });
    assert.equal(redraws, 1, "an unrelated member change does not");
    Hooks.call("updateActor", { id: "stranger" }, { ownership: { PL1: 2 } });
    assert.equal(redraws, 1, "an ownership change on an actor outside the party does not");

    // The light-cast row reads a member's spell list, class record and spells: each redraws the open sheet, and what it does not read does not.
    const { ITEM_TYPE: TYPES } = await import("../scripts/lib/vocab.mjs");
    // Only this sheet's own listeners are fired: the module's other item and actor hooks would start syncs of their own, which a later scenario then reads.
    const fire = (name, ...args) => hooks.get(name).slice(before.get(name) ?? 0).forEach((fn) => fn(...args));
    const spell = (parent, over = {}) => ({ id: "spx", type: TYPES.spell, parent, effects: { size: 0 }, ...over });
    fire("updateActor", dave, { system: { spells: { enabled: true } } });
    assert.equal(redraws, 2, "a member's spell list setting redraws");
    fire("updateActor", dave, { flags: { "acks-extras": { classes: { applied: {} } } } });
    assert.equal(redraws, 3, "a member's class record redraws");
    fire("updateActor", dave, { flags: { "acks-extras": { somethingElse: 1 } } });
    assert.equal(redraws, 3, "another of the member's flags does not");
    fire("updateActor", { id: "stranger" }, { system: { spells: { enabled: true } } });
    assert.equal(redraws, 3, "a stranger's spell list does not");
    fire("updateItem", spell(dave), { system: { cast: 1 } }, {}, "PL1");
    assert.equal(redraws, 4, "a member's spell spending a slot redraws");
    fire("updateItem", spell(dave), { flags: { "acks-extras": { spell: { effects: [] } } } }, {}, "PL1");
    assert.equal(redraws, 5, "a member's spell changing its flags redraws");
    fire("updateItem", spell(dave), { sort: 5 }, {}, "PL1");
    assert.equal(redraws, 5, "a member's spell changing nothing the row reads does not");
    fire("createItem", spell(dave), {}, "PL1");
    assert.equal(redraws, 6, "a spell given to a member redraws");
    fire("deleteItem", spell(dave), {}, "PL1");
    assert.equal(redraws, 7, "a spell taken from a member redraws");
    fire("updateItem", spell({ id: "stranger" }), { system: { cast: 1 } }, {}, "PL1");
    assert.equal(redraws, 7, "a stranger's spell does not");
    fire("updateItem", spell(dave, { type: TYPES.weapon }), { system: { quantity: 2 } }, {}, "PL1");
    assert.equal(redraws, 7, "a member's weapon does not");

    // The Light here line reads the scene's darkness, its placed lights and the party token's place: each of those, on the party's scene, redraws the open sheet.
    const there = watched.formation;
    assert.ok(there.sceneId && there.tokenId, "the party stands on a scene with a token");
    const onScene = { id: there.sceneId };
    fire("updateScene", onScene, { environment: { darknessLevel: 0.8 } });
    assert.equal(redraws, 8, "the party scene's darkness changing redraws");
    fire("updateScene", onScene, { darkness: 0.8 });
    assert.equal(redraws, 9, "the party scene's legacy darkness field changing redraws");
    fire("updateScene", onScene, { name: "Renamed" });
    assert.equal(redraws, 9, "a scene change that is not its light does not");
    fire("updateScene", { id: "elsewhere" }, { environment: { darknessLevel: 0.8 } });
    assert.equal(redraws, 9, "another scene's darkness does not");
    for (const [n, hook] of ["createAmbientLight", "updateAmbientLight", "deleteAmbientLight"].entries()) {
      fire(hook, { parent: onScene }, {});
      assert.equal(redraws, 10 + n, `${hook} on the party's scene redraws`);
    }
    fire("updateAmbientLight", { parent: { id: "elsewhere" } }, {});
    assert.equal(redraws, 12, "a placed light on another scene does not");
    fire("updateToken", { id: there.tokenId, parent: onScene }, { x: 500 });
    assert.equal(redraws, 13, "the party token moving redraws");
    fire("updateToken", { id: there.tokenId, parent: onScene }, { elevation: 5 });
    assert.equal(redraws, 14, "the party token changing elevation redraws");
    fire("updateToken", { id: "other", parent: onScene }, { light: { bright: 20 } });
    assert.equal(redraws, 15, "a token on the party's scene changing its light redraws");
    fire("updateToken", { id: "other", parent: onScene }, { x: 500 });
    assert.equal(redraws, 15, "another token walking does not");
    fire("updateToken", { id: there.tokenId, parent: { id: "elsewhere" } }, { x: 500 });
    assert.equal(redraws, 15, "a token on another scene does not");

    // A token that emits light moving, hiding or rising redraws; one that emits none does not. Creating or deleting one stirs it on the same terms.
    const lit = { id: "lamp-bearer", parent: onScene, light: { bright: 20, dim: 40 } };
    const dim = { id: "dim-bearer", parent: onScene, light: { bright: 0, dim: 10 } };
    const unlit = { id: "walker", parent: onScene, light: { bright: 0, dim: 0 } };
    for (const [n, change] of [{ x: 1 }, { y: 1 }, { hidden: true }, { elevation: 5 }].entries()) {
      fire("updateToken", lit, change);
      assert.equal(redraws, 16 + n, `a lit token's ${Object.keys(change)[0]} change redraws`);
    }
    fire("updateToken", dim, { x: 1 });
    assert.equal(redraws, 20, "a token with only a dim radius counts as emitting");
    fire("updateToken", lit, { rotation: 90 });
    fire("updateToken", unlit, { x: 1 });
    fire("updateToken", unlit, { hidden: true });
    assert.equal(redraws, 20, "a lit token turning, or an unlit one walking or hiding, does not");
    fire("createToken", lit);
    fire("deleteToken", lit);
    assert.equal(redraws, 22, "a lit token created or deleted redraws");
    fire("createToken", unlit);
    fire("deleteToken", unlit);
    fire("createToken", { ...lit, parent: { id: "elsewhere" } });
    assert.equal(redraws, 22, "an unlit token, or a lit one on another scene, does not");
    fire("createToken", { id: there.tokenId, parent: onScene, light: {} });
    assert.equal(redraws, 23, "the party's own token created redraws");
    fire("updateToken", { id: there.tokenId, parent: onScene }, { hidden: true });
    assert.equal(redraws, 24, "the party token hiding redraws");

    const { tokenEmitsLight, tokenStirsLight } = partyActorModule;
    assert.deepEqual([{ light: { bright: 5 } }, { light: { dim: 5 } }, { light: { bright: 0, dim: 0 } }, { light: {} }, {}, null].map(tokenEmitsLight), [true, true, false, false, false, false], "core's bright or dim radius above zero is a light");
    assert.equal(tokenStirsLight({ id: "t", light: { bright: 5 } }, { x: 1 }, "p"), true);
    assert.equal(tokenStirsLight({ id: "t", light: {} }, { x: 1 }, "p"), false);
    assert.equal(tokenStirsLight({ id: "t", light: {} }, { light: { bright: 5 } }, "p"), true, "its own light changing always stirs");
    assert.equal(tokenStirsLight({ id: "p", light: {} }, { width: 2 }, "p"), true, "the party token changing size stirs");
    assert.equal(tokenStirsLight({ id: "t", light: { bright: 5 } }, { width: 2 }, "p"), false, "another token changing size does not");
  } finally {
    for (const [name, list] of hooks) list.length = before.get(name) ?? 0;
  }

  // A formation change reaches every party sheet once: one at rest is redrawn
  // by `refreshAll`; one whose render was under way when the change landed
  // (a first render, not yet in the registry, or a later one, not `rendered`
  // while it draws) redraws itself once that render finishes; a sheet
  // `refreshAll` already queued a render for draws no extra one.
  {
    const { PartySheet } = partyActorModule;
    const registry = foundry.applications.instances;
    const element = { classList: { toggle() {} }, querySelectorAll: () => [], querySelector: () => null };
    const sheetFor = (id) => {
      const s = new PartySheet({ document: partyActor });
      s.element = element;
      s.renders = 0;
      s.render = () => {
        s.renders += 1;
        return s;
      };
      s.cycle = async () => {
        s._configureRenderOptions({});
        await s._onRender({ panelHidden: false }, {});
      };
      s.key = id;
      return s;
    };
    const atRest = sheetFor("party-at-rest");
    atRest.rendered = true;
    registry.set(atRest.key, atRest);
    try {
      PartySheet.refreshAll();
      assert.equal(atRest.renders, 1, "a sheet at rest is redrawn by refreshAll");
      await atRest.cycle();
      assert.equal(atRest.renders, 1, "and the redraw it was asked for adds none of its own");

      const first = sheetFor("party-first-render");
      first.rendered = false;
      first._configureRenderOptions({});
      PartySheet.refreshAll();
      assert.equal(first.renders, 0, "a sheet still drawing its first render is not in the registry for refreshAll");
      await first._onRender({ panelHidden: false }, {});
      assert.equal(first.renders, 1, "so it redraws once its first render finishes");
      await first.cycle();
      assert.equal(first.renders, 1, "and that redraw, reading the change, asks for no other");

      atRest.renders = 0;
      atRest._configureRenderOptions({});
      atRest.rendered = false;
      PartySheet.refreshAll();
      atRest.rendered = true;
      await atRest._onRender({ panelHidden: false }, {});
      assert.equal(atRest.renders, 1, "a later render the change lands in redraws once when it finishes");

      atRest.renders = 0;
      PartySheet.refreshAll();
      atRest._configureRenderOptions({});
      PartySheet.refreshAll();
      await atRest._onRender({ panelHidden: false }, {});
      assert.equal(atRest.renders, 2, "two changes in a burst queue two renders and the first adds none");
      await atRest.cycle();
      assert.equal(atRest.renders, 2, "and the second, having read both, adds none either");

      const quiet = sheetFor("party-quiet");
      await quiet.cycle();
      assert.equal(quiet.renders, 0, "a render with no change behind it draws no second");
    } finally {
      registry.delete(atRest.key);
    }
  }

  await model.disband(model.getFormation(formation.id));
  await drain();
});

await scenario("turn + light state survive the equipment feedback loop", async () => {
  // Reproduces the live break: the equipment feature listens to
  // acksExtras.formation.lightChanged and refreshes the bearer's loadout (an
  // actor update). That fires the formation feature's own updateActor hook, which calls
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

  // Stand in for the equipment feature's listener: a light change updates the actor.
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

await scenario("a turn card says no light only where neither a flame nor a shining magic light is borne", async () => {
  const bearer = await member("Glow Bearer");
  await drain();
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Magic Light Party");
  formation = await model.addMember(formation, bearer, null);
  await drain();
  const id = onlyFormation().id;
  const { MAGIC_LIGHT_CHANGE_KEYS } = await import("../scripts/lib/light.mjs");
  const glow = { id: "fxcard", name: "Glow", disabled: false, parent: { documentName: "Actor" }, changes: [{ key: MAGIC_LIGHT_CHANGE_KEYS.bright, type: "upgrade", value: "11" }], getFlag(scope, key) { return this.flags?.[scope]?.[key]; } };
  const turnCard = async () => {
    const before = chat.length;
    await engine.advanceTurns(model.getFormation(id), 1, { reason: "manual" });
    await drain();
    return chat.slice(before).map((d) => d.content).find((c) => c.includes("acks-formation-card")) ?? "";
  };
  try {
    assert.ok((await turnCard()).includes("chat.noLight"), "no flame and no magic light: the card says so");
    bearer.effects.push(glow);
    assert.ok(!(await turnCard()).includes("chat.noLight"), "a shining magic light is a light, with no flame lit");
    glow.flags = { [MODULE_ID]: { lightShutter: true } };
    assert.ok((await turnCard()).includes("chat.noLight"), "a shuttered magic light is not");
    // A cast writes its bands blank: the light shines with no reach and still counts, as a flame with no imported reach does.
    delete glow.flags;
    glow.changes = [{ key: MAGIC_LIGHT_CHANGE_KEYS.bright, type: "upgrade", value: "" }];
    const stored = model.getFormation(id);
    assert.equal(model.formationHasLight(stored), true, "a shining blank-reach magic light is the party's light");
    assert.ok(!(await turnCard()).includes("chat.noLight"), "and the turn card does not say no light");
    glow.flags = { [MODULE_ID]: { lightShutter: true } };
    assert.equal(model.formationHasLight(model.getFormation(id)), false, "shuttered, a blank-reach light is not");
    assert.ok((await turnCard()).includes("chat.noLight"), "and the card says so again");
  } finally {
    bearer.effects.length = 0;
    await model.disband(model.getFormation(id));
    await drain();
  }
});

await scenario("lighting works with the equipment feature's hand accounting", async () => {
  const hero = await member("Handy");
  await drain();
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Equip Party");
  formation = await model.addMember(formation, hero, null);
  await drain();
  const id = onlyFormation().id;
  await game.settings.set(MODULE_ID, "lightItemEnforcement", "require");
  await hero.createEmbeddedDocuments("Item", [
    { name: "Torch", type: "item", system: { quantity: 10 } },
  ]);

  // Stand in for the equipment feature: hands = 2 budget, minus equipped
  // weapons/shields, minus lights already held.
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
    // the equipment feature's own draw/sheathe controls are where a hand is freed.
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

  // Stand in for the equipment feature's grant API: create what is missing, and put
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
        missing.map((s) => ({ name: s.name ?? game.i18n.localize(s.label), type: "item", system: { quantity: 1 } })),
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

await scenario("an Endurance holder is told by the kw:endurance capability, never by a name", async () => {
  const byId = await member("Imported Endurance");
  await byId.createEmbeddedDocuments("Item", [{ name: "Stamina", type: "ability", flags: { [MODULE_ID]: { cookbook: { id: "def.prof.endurance" } } } }]);
  const byProvides = await member("Provided Endurance");
  await byProvides.createEmbeddedDocuments("Item", [{ name: "Hardy", type: "ability", flags: { [MODULE_ID]: { extras: { provides: ["kw:endurance"] } } } }]);
  const byName = await member("Named Only");
  await byName.createEmbeddedDocuments("Item", [
    { name: "Endurance", type: "ability" },
    { name: "Rope of Endurance", type: "item" },
  ]);
  const otherAbility = await member("Other Ability");
  await otherAbility.createEmbeddedDocuments("Item", [{ name: "Labor", type: "ability", flags: { [MODULE_ID]: { cookbook: { id: "def.prof.labor" } } } }]);
  assert.equal(engine.hasEndurance(byId), true, "an ability whose definition id is Endurance's holds it");
  assert.equal(engine.hasEndurance(byProvides), true, "an ability that provides kw:endurance holds it");
  assert.equal(engine.hasEndurance(byName), false, "an ability or an item that is only called Endurance does not");
  assert.equal(engine.hasEndurance(otherAbility), false, "another capability is not Endurance");
  assert.equal(engine.hasEndurance(null), false, "no actor holds nothing");
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
  const roundsBefore = (before.turnsTotal * TIME_COUNTS.roundsPerTurn) + (before.roundsPartial ?? 0);

  // Drag one full exploration move (speed feet) → should be a whole turn.
  const gs = scene.grid.size;
  const squares = Math.round(speed / scene.grid.distance);
  game.time.advanced.length = 0; // count only this drag's world-clock writes
  await partyToken.update({ x: partyToken.x + squares * gs });
  await drain();

  const after = onlyFormation().clock;
  const roundsAfter = (after.turnsTotal * TIME_COUNTS.roundsPerTurn) + (after.roundsPartial ?? 0);
  console.log(`      [probe] rounds ${roundsBefore} -> ${roundsAfter}`);
  assert.ok(roundsAfter > roundsBefore, "movement advanced the dungeon clock");

  // The dungeon clock is the module's own; the Foundry world clock is the
  // shared one, written only through lib's gate. A minute per round.
  const worldSeconds = game.time.advanced.reduce((a, b) => a + b, 0);
  console.log(`      [probe] world clock +${worldSeconds}s`);
  assert.equal(worldSeconds, (roundsAfter - roundsBefore) * ROUND_SECONDS, "world clock moved a turn's seconds over its rounds per round");

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
  const roundsFor = (feet) => Math.floor((feet * TIME_COUNTS.roundsPerTurn) / speed);
  const start = { x: partyToken.x, y: partyToken.y };
  const end = { x: start.x + squares * gs, y: start.y };
  const roundsOf = (c) => c.turnsTotal * TIME_COUNTS.roundsPerTurn + (c.roundsPartial ?? 0);
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
  return { id, walker, partyToken, step: squares * on.grid.size, turnRounds: Math.floor((squares * on.grid.distance * TIME_COUNTS.roundsPerTurn) / speed) };
}

/** Land the drawn move, stop drawing, and disband. */
async function dismissDrawn({ id, partyToken }) {
  partyToken.endTween();
  partyToken.rendered = false;
  const formation = model.getFormation(id);
  if (formation) await model.disband(formation);
  await drain();
}

const clockRounds = (clock) => clock.turnsTotal * TIME_COUNTS.roundsPerTurn + (clock.roundsPartial ?? 0);

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

    const end = { x: partyToken.x + step, y: partyToken.y };
    await partyToken.update({ x: end.x });
    await drain();
    // Gone only now: a fight with no body left is over at the party's next move.
    await scene.deleteEmbeddedDocuments("Token", [fighter.deployedTokenId]);
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

await scenario("a hop is priced from the quarter the party's footprint stands in, as the party sheet names it", async () => {
  // The party's end of the hop is `findDistrict` (core's `token.regions`), not
  // the quarter under the token's centre. A two-cell party token has its first
  // cell in quarter A and its centre, with its second cell, in quarter B; the
  // place is in A. Read by footprint the hop is inside one quarter and is made
  // free; read by centre it would run between two and be refused.
  const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
  const { SETTLEMENT_DOC, SETTLEMENT_PACES } = await import("../scripts/formation/settlement.mjs");
  const { DISTRICT_TYPE, districtAt, findDistrict } = await import("../scripts/formation/district-find.mjs");
  const { LOCATION_TYPE } = await import("../scripts/location/constants.mjs");
  const { travelToPlace } = await import("../scripts/formation/poi.mjs");
  const { mockRegion, rect } = await import("./region-fixture.mjs");
  const free = Object.fromEntries(Object.keys(SETTLEMENT_PACES).map((pace) => [pace, 0]));
  registerTable(
    { id: SETTLEMENT_DOC, source: "invented", tables: { districtTravel: { same: free } } },
    { priority: PRIORITY.WORLD, source: "test" },
  );
  const quarter = new SceneMock("Footprint");
  game.scenes.set(quarter.id, quarter);
  const party = await drawnParty("Spanning", quarter);
  const { id, partyToken } = party;
  const inn = await ActorMock.create({ name: "Inn", type: LOCATION_TYPE });
  try {
    const gs = quarter.grid.size;
    partyToken.width = 2;
    const { x, y } = partyToken;
    const behaviors = [{ type: DISTRICT_TYPE, disabled: false }];
    const a = mockRegion({ id: "a", behaviors, rings: [rect(x - gs, y - gs, gs * 1.75, gs * 3)] });
    const b = mockRegion({ id: "b", behaviors, rings: [rect(x + gs * 0.75, y - gs, gs * 2.25, gs * 3)] });
    quarter.regions.set("a", a);
    quarter.regions.set("b", b);
    const [place] = await quarter.createEmbeddedDocuments("Token", [
      { name: "Inn", actorId: inn.id, x: x - gs, y },
    ]);
    const centre = { x: x + gs, y: y + gs / 2 };
    assert.equal(districtAt(quarter, centre)?.region, b, "the party's centre is in quarter B");
    assert.equal(findDistrict(model.getFormation(id))?.region, a, "its footprint reaches quarter A first");

    const result = await travelToPlace(id, place.id);
    await drain();
    assert.equal(result.moved, true, `the hop was made (${result.reason ?? "no refusal"})`);
    assert.equal(result.relation, "same", "the party and the place are in one quarter");
  } finally {
    unregisterTable(SETTLEMENT_DOC, { priority: PRIORITY.WORLD });
    await dismissDrawn(party);
    game.actors.delete(inn.id);
    game.scenes.delete(quarter.id);
  }
});

await scenario("a hand turn writes no size and bills nothing", async () => {
  // See docs/formation/DECISIONS.md, "The party token is the head of its
  // column". In the `order` shape the token is one cell whatever its frontage,
  // so a turn has nothing to resize: it aims the column and costs nothing.
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
  try {
    assert.ok(partyToken, "party token placed");
    // Six abreast: a block-sized token would be six cells wide.
    await model.updateFormation({ ...model.getFormation(id), frontage: 6 });
    await partyToken.update({ rotation: 0 });
    await drain();
    assert.deepEqual({ w: partyToken.width, h: partyToken.height }, { w: 1, h: 1 }, "the head is one cell at any frontage");
    const corner = { x: partyToken.x, y: partyToken.y };
    const clockBefore = onlyFormation().clock;
    const roundsBefore = clockRounds(clockBefore);

    const writes = [];
    const spy = (doc, changes) => doc.id === partyToken.id && writes.push(changes);
    Hooks.on("updateToken", spy);
    try {
      await partyToken.update({ rotation: 90 });
      await drain();
    } finally {
      Hooks.off("updateToken", spy);
    }
    assert.ok(!writes.some((c) => "width" in c || "height" in c || "x" in c || "y" in c), "nothing that moves or sizes the token was written");
    assert.deepEqual({ x: partyToken.x, y: partyToken.y }, corner, "the corner stayed where it was");
    const clockAfter = onlyFormation().clock;
    assert.equal(clockRounds(clockAfter), roundsBefore, "turning in place spent no time");
    assert.equal(clockAfter.carryFeet ?? 0, clockBefore.carryFeet ?? 0, "and banked no distance toward the next round");
  } finally {
    const live = model.getFormation(id);
    if (live) await model.disband(live);
    await drain();
  }
});

await scenario("the party token's size: the head in `order`, the Judge's in `fixed`, never under the lock", async () => {
  const { partySizeTarget } = sceneSync;
  const head = { width: 1, height: 1 };
  const big = { width: 3, height: 2 };
  assert.deepEqual(partySizeTarget(big, null, { shape: "order" }), head, "order: a hand resize goes back to one cell");
  assert.equal(partySizeTarget(head, head, { shape: "order" }), null, "order: one cell already, nothing to write");
  assert.equal(partySizeTarget(big, null, { shape: "order", locked: true }), null, "the footprint lock never resizes");
  assert.equal(partySizeTarget(big, head, { shape: "fixed" }), null, "fixed: a size changed since the stamp is the Judge's");
  assert.deepEqual(partySizeTarget(big, big, { shape: "fixed" }), head, "fixed: a size the module stamped goes to one cell once");
  assert.deepEqual(partySizeTarget(big, null, { shape: "fixed" }), head, "fixed: an unstamped size from before the switch counts as the module's");
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

  // The equipment feature present and reacting to lightChanged, as it does live.
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

    // The torch shines from its bearer's cell in the column, never from the
    // party token: the sweep keeps the token itself dark.
    await sceneSync.syncEnvironments();
    await drain();
    const partyToken = scene.tokens.get(onlyFormation().tokenId);
    console.log(`      [probe] party token light = ${partyToken.light.bright}/${partyToken.light.dim}`);
    assert.deepEqual({ bright: partyToken.light.bright, dim: partyToken.light.dim }, { bright: 0, dim: 0 }, "the party token sheds nothing itself");
    const { carriedLightPoints } = await import("../scripts/formation/column-light.mjs");
    const gs = scene.grid.size;
    // The bearer is the head: their cell is the one the token stands on.
    assert.deepEqual(
      carriedLightPoints(scene),
      [{ x: partyToken.x + gs / 2, y: partyToken.y + gs / 2, daylight: 0, bright: INVENTED_LIGHTS.torch.bright, dim: INVENTED_LIGHTS.torch.dim }],
      "one point, at the bearer's cell centre, with the imported reach",
    );
  } finally {
    const arr = hooks.get("acksExtras.lightChanged") ?? [];
    const i = arr.indexOf(equipmentListener);
    if (i >= 0) arr.splice(i, 1);
    delete globalThis.acksExtras.equipment;
  }

  await model.disband(model.getFormation(id));
  await drain();
});

await scenario("the sync gives a party token sight unless the vision pass has claimed it", async () => {
  const walker = await member("Sightless");
  await drain();
  const [wToken] = await scene.createEmbeddedDocuments("Token", [
    { name: "Sightless", actorId: walker.id, x: 1700, y: 1700 },
  ]);
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Blind Party");
  formation = await model.addMember(formation, walker, wToken);
  await drain();
  const id = onlyFormation().id;
  const token = () => scene.tokens.get(onlyFormation().tokenId);

  // A token from a prototype that never set sight, which no sync has read.
  const unread = async () => {
    await token().update({ "sight.enabled": false });
    delete token().flags[MODULE_ID]?.managedVision;
    delete token().flags[MODULE_ID]?.partySight;
  };
  await unread();
  await sceneSync.syncEnvironments();
  await drain();
  assert.equal(token().sight?.enabled, true, "an unread party token with sight off is switched on");
  assert.equal(token().getFlag(MODULE_ID, "partySight"), true, "the switch stamps the token");

  // Sight a hand turns off after the first sync stays off, with the vision
  // pass off (this suite registers no vision setting), so nothing else claims it.
  await token().update({ "sight.enabled": false });
  await sceneSync.syncEnvironments();
  await drain();
  assert.equal(token().sight?.enabled, false, "a stamped party token keeps the sight a hand set");

  // A token the vision pass claimed before the stamp existed keeps a hand's sight too.
  await unread();
  await token().setFlag(MODULE_ID, "managedVision", { range: 0, visionMode: "basic" });
  await sceneSync.syncEnvironments();
  await drain();
  assert.equal(token().sight?.enabled, false, "a claimed party token keeps the sight a hand set");

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
  const roundsOf = (clock) => clock.turnsTotal * TIME_COUNTS.roundsPerTurn + (clock.roundsPartial ?? 0);

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
  const roundsOf = (clock) => clock.turnsTotal * TIME_COUNTS.roundsPerTurn + (clock.roundsPartial ?? 0);
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

await scenario("a deployed member with no combat id recorded is read as the running combat's takeover", async () => {
  // The shape a member left behind and taken back mid-fight has.
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

/**
 * A party of its own for a fight that ends without its combat's end being
 * heard: the party token, one exploration move of it in pixels, and the
 * rounds the clock bills for that move. The party has moved once, so the
 * clock has a baseline.
 */
async function fightingParty(name, ...people) {
  const { id, actors } = await isolatedParty(name, ...people);
  const partyToken = scene.tokens.get(onlyFormation().tokenId);
  const speed = model.partySpeed(model.getFormation(id));
  const squares = Math.round(speed / scene.grid.distance);
  const step = squares * scene.grid.size;
  await partyToken.update({ x: partyToken.x + step });
  await drain();
  const cell = (actor) => onlyFormation().members.find((m) => m.actorId === actor.id);
  return { id, actors, partyToken, step, turnRounds: Math.floor((squares * scene.grid.distance * TIME_COUNTS.roundsPerTurn) / speed), cell };
}

/** End the combats a `fightingParty` used that are still in the world, then disband it and delete its people. */
async function dismissFighting({ id, actors }, ...combats) {
  for (const combat of combats) {
    if (!game.combats.has(combat.id)) continue;
    await combat.delete();
    await drain();
  }
  const formation = model.getFormation(id);
  if (formation) await model.disband(formation);
  await drain();
  for (const actor of actors) await actor.delete();
  await drain();
}

/**
 * Wait until `ready()` holds, for at most two seconds: a heal and a deploy
 * in one gesture outlast `drain` on a loaded machine. The assertion after it
 * reports a state that never arrived.
 */
async function until(ready) {
  for (let waited = 0; waited < 2000 && !ready(); waited += 5) await sleep(5);
  await drain();
}

/** What the party left on the map: tokens of its people. */
const peopleOn = (actors) => scene.tokens.filter((t) => actors.some((a) => a.id === t.actorId));

/** The GM's HUD toggle on each of the party's fighters: their combatants removed, the encounter kept. */
async function toggleOut(combat, actors) {
  for (const combatant of combat.combatants.filter((c) => actors.some((a) => a.id === c.actorId))) await combatant.delete();
  await drain();
}

await scenario("a fight emptied of the party's fighters is over at the party's next move", async () => {
  // See docs/formation/DECISIONS.md, "A fight no combat holds a body of is over".
  const party = await fightingParty("Emptied Party", "Toggler", "Stayer");
  const { actors, partyToken, step, turnRounds, cell } = party;
  const combat = new CombatMock();
  try {
    await partyJoins(combat);
    assert.ok(onlyFormation().combat?.active, "the party deployed for combat");
    await toggleOut(combat, actors);

    const before = clockRounds(onlyFormation().clock);
    const cards = chat.length;
    const drop = { x: partyToken.x + step, y: partyToken.y };
    await partyToken.update({ x: drop.x });
    await until(() => onlyFormation().combat === null && onlyFormation().clock.lastPosition?.x === drop.x);
    const after = onlyFormation();
    assert.equal(after.combat, null, "the party re-formed");
    for (const actor of actors) {
      assert.ok(!cell(actor).deployedTokenId && !cell(actor).deployedCombatId, `${actor.name} is back inside the party token`);
      assert.ok(cell(actor).tokenData, `${actor.name}'s token is stashed`);
    }
    assert.equal(peopleOn(actors).length, 0, "no member token is left on the map");
    assert.ok(!partyToken.hidden, "the party token shows again");
    assert.deepEqual({ x: partyToken.x, y: partyToken.y }, drop, "where the move put it, not where a fighter stood");
    assert.ok(chat.slice(cards).some((m) => m.content.includes("chat.combatReformed")), "the re-forming is announced");
    assert.equal(clockRounds(after.clock) - before, turnRounds, "the move is billed");
    assert.deepEqual(after.clock.lastPosition, drop, "and measured to where it ended");
    assert.ok(game.combats.has(combat.id), "the emptied encounter is left to the GM");
  } finally {
    await dismissFighting(party, combat);
  }
});

await scenario("a fight whose combat was deleted unheard is over at the party's next move", async () => {
  // See docs/formation/DECISIONS.md, "A fight no combat holds a body of is over".
  const party = await fightingParty("Orphaned Party", "Sword", "Bow");
  const { actors, partyToken, step, turnRounds, cell } = party;
  const combat = new CombatMock();
  try {
    await partyJoins(combat);
    assert.ok(onlyFormation().combat?.active, "the party deployed for combat");
    game.combats.delete(combat.id); // no window ran the end
    await drain();
    assert.equal(onlyFormation().combat?.combatId, combat.id, "the record still names the gone combat");

    const before = clockRounds(onlyFormation().clock);
    const drop = { x: partyToken.x + step, y: partyToken.y };
    await partyToken.update({ x: drop.x });
    await until(() => onlyFormation().combat === null && onlyFormation().clock.lastPosition?.x === drop.x);
    const after = onlyFormation();
    assert.equal(after.combat, null, "the party re-formed");
    assert.ok(actors.every((a) => !cell(a).deployedTokenId && cell(a).tokenData), "everyone is back inside the party token");
    assert.equal(peopleOn(actors).length, 0, "no member token is left on the map");
    assert.deepEqual({ x: partyToken.x, y: partyToken.y }, drop, "the party token stands where the move put it");
    assert.ok(!partyToken.hidden, "and shows");
    assert.equal(clockRounds(after.clock) - before, turnRounds, "the move is billed");
  } finally {
    await dismissFighting(party, combat);
  }
});

await scenario("the party added again to the encounter it was toggled out of re-forms and deploys", async () => {
  // See docs/formation/DECISIONS.md, "A fight no combat holds a body of is over".
  const party = await fightingParty("Rejoining Party", "Vanguard", "Archer");
  const { actors, partyToken, cell } = party;
  const combat = new CombatMock();
  try {
    await partyJoins(combat);
    await combat.setRound(3);
    await drain();
    await toggleOut(combat, actors);

    const cards = chat.length;
    await partyJoins(combat); // the party token added again, as core adds it
    await until(() => onlyFormation().combat?.active && chat.slice(cards).some((m) => m.content.includes("chat.combatDeployed")));
    const after = onlyFormation();
    assert.deepEqual(after.combat, { combatId: combat.id, active: true, roundsCounted: 3 }, "the party fights again, from round 3");
    assert.equal(combat.combatants.contents.length, actors.length, "one combatant per member");
    assert.ok(!combat.combatants.some((c) => c.tokenId === partyToken.id), "and none for the party token");
    assert.ok(actors.every((a) => cell(a).deployedCombatId === combat.id), "every member is this combat's");
    assert.equal(peopleOn(actors).length, actors.length, "one body each on the map, the old ones gathered");
    const posted = chat.slice(cards).map((m) => m.content);
    const reformed = posted.findIndex((c) => c.includes("chat.combatReformed"));
    const deployed = posted.findIndex((c) => c.includes("chat.combatDeployed"));
    assert.ok(reformed >= 0 && deployed > reformed, "the re-forming is announced, then the deploy");

    const before = clockRounds(after.clock);
    await combat.setRound(4);
    await drain();
    assert.equal(clockRounds(onlyFormation().clock) - before, 1, "the next round bills one round");
  } finally {
    await dismissFighting(party, combat);
  }
});

await scenario("a fight whose combat was deleted unheard is over when the party joins another", async () => {
  // See docs/formation/DECISIONS.md, "A fight no combat holds a body of is over".
  const party = await fightingParty("Regrouped Party", "Pike", "Mace");
  const { actors, cell } = party;
  const gone = new CombatMock();
  const next = new CombatMock();
  try {
    await partyJoins(gone);
    game.combats.delete(gone.id); // no window ran the end
    await drain();
    await partyJoins(next);
    await until(() => onlyFormation().combat?.combatId === next.id && next.combatants.contents.length === actors.length);
    const after = onlyFormation();
    assert.equal(after.combat?.combatId, next.id, "the party fights in the new combat");
    assert.ok(actors.every((a) => cell(a).deployedCombatId === next.id), "every member is the new combat's");
    assert.equal(next.combatants.contents.length, actors.length, "one combatant per member");
    assert.equal(peopleOn(actors).length, actors.length, "one body each on the map");
  } finally {
    await dismissFighting(party, gone, next);
  }
});

await scenario("a fight still holding a fighter is not over, and joining another combat says where it is", async () => {
  // See docs/formation/DECISIONS.md, "A fight no combat holds a body of is over".
  const party = await fightingParty("Stubborn Party", "Holdout", "Runner");
  const { actors, partyToken, step } = party;
  const [holdout, runner] = actors;
  const combat = new CombatMock();
  const other = new CombatMock();
  try {
    await partyJoins(combat);
    await toggleOut(combat, [runner]);
    const baseline = onlyFormation().clock.lastPosition;
    const before = clockRounds(onlyFormation().clock);
    await partyToken.update({ x: partyToken.x + step });
    await drain();
    assert.ok(onlyFormation().combat?.active, "one fighter still in the tracker keeps the fight");
    assert.equal(peopleOn(actors).length, 2, "nobody is gathered");
    assert.equal(clockRounds(onlyFormation().clock), before, "a move of the camp mid-fight is not billed");
    assert.deepEqual(onlyFormation().clock.lastPosition, baseline, "nor measured");

    combat.name = "Ambush";
    const cards = chat.length;
    await partyJoins(other);
    await until(() => chat.length > cards);
    assert.ok(!other.combatants.some((c) => c.tokenId === partyToken.id), "the party token is taken back out of the other tracker");
    assert.ok(combat.combatants.some((c) => c.actorId === holdout.id), "the fighter still fights");
    assert.ok(onlyFormation().combat?.active, "the party is still fighting where it was");
    const posted = chat.slice(cards);
    assert.equal(posted.length, 1, "one card");
    assert.ok(posted[0].content.includes("chat.combatAlreadyFighting") && posted[0].content.includes("Ambush"), "naming the encounter");
    assert.ok(posted[0].whisper.length > 0, "whispered to the GMs");
  } finally {
    await dismissFighting(party, combat, other);
  }
});

await scenario("the party token added again to its own fight gathers the party", async () => {
  const party = await fightingParty("Rallying Party", "Pikeman", "Slinger");
  const { actors, partyToken, cell } = party;
  const combat = new CombatMock();
  try {
    await partyJoins(combat);
    assert.ok(onlyFormation().combat?.active, "the party deployed for combat");
    assert.equal(peopleOn(actors).length, actors.length, "one body each on the map");
    assert.ok(partyToken.hidden, "the party token is hidden while they fight");

    const cards = chat.length;
    await partyJoins(combat);
    await until(() => onlyFormation().combat === null && peopleOn(actors).length === 0);
    assert.equal(onlyFormation().combat, null, "the party re-formed");
    for (const actor of actors) {
      assert.ok(!cell(actor).deployedTokenId && !cell(actor).deployedCombatId, `${actor.name} is back inside the party token`);
      assert.ok(cell(actor).tokenData, `${actor.name}'s token is stashed`);
    }
    assert.equal(combat.combatants.contents.length, 0, "no combatant is left: the bodies' and the party token's are gone");
    assert.ok(!partyToken.hidden, "the party token shows again");
    const posted = chat.slice(cards);
    assert.ok(posted.some((m) => m.content.includes("chat.combatReformed")), "the re-forming is announced");
    assert.ok(!posted.some((m) => m.content.includes("chat.combatAlreadyFighting")), "and is no refusal");
    assert.ok(game.combats.has(combat.id), "the encounter itself is left to the GM");

    await partyJoins(combat);
    await until(() => onlyFormation().combat?.active && combat.combatants.contents.length === actors.length);
    assert.equal(combat.combatants.contents.length, actors.length, "pressed once more, the party deploys again");
  } finally {
    await dismissFighting(party, combat);
  }
});

await scenario("a member whose body is gone is deployed afresh, and a party with nobody to field writes nothing", async () => {
  const party = await fightingParty("Hollow Party", "Ghost", "Shade");
  const { id, actors, partyToken, cell } = party;
  const [ghost, shade] = actors;
  const combat = new CombatMock();
  const later = new CombatMock();
  try {
    // A leftover marker: the record sends Ghost out under a token the scene no longer holds.
    await model.patchFormation(id, (rec) => {
      const m = rec.members.find((x) => x.actorId === ghost.id);
      m.deployedTokenId = "gone-token";
      m.deployedSceneId = scene.id;
    });
    await drain();
    await partyJoins(combat);
    await until(() => onlyFormation().combat?.active);
    assert.ok(onlyFormation().combat?.active, "the party deployed for combat");
    assert.notEqual(cell(ghost).deployedTokenId, "gone-token", "the stale marker was cleared");
    assert.ok(scene.tokens.get(cell(ghost).deployedTokenId), "and Ghost stands on the map under a token of their own");
    assert.equal(combat.combatants.contents.length, actors.length, "one combatant per body");
    assert.ok(partyToken.hidden, "the party token is hidden");
    await combat.delete();
    await drain();

    // Nobody to field: every member a non-combatant, so no body stands.
    await model.patchFormation(id, (rec) => {
      for (const m of rec.members) m.roles = [...(m.roles ?? []), "noncombatant"];
    });
    await drain();
    const before = JSON.stringify(onlyFormation());
    const cards = chat.length;
    await partyJoins(later);
    await until(() => chat.length > cards);
    assert.equal(JSON.stringify(onlyFormation()), before, "the record is untouched");
    assert.ok(!partyToken.hidden, "the party token is not hidden");
    assert.ok(later.combatants.some((c) => c.tokenId === partyToken.id), "its combatant is left in the tracker");
    assert.ok(chat.slice(cards).some((m) => m.content.includes("chat.combatNoCombatants")), "and the Judge is told");
    assert.equal(peopleOn([ghost, shade]).length, 0, "nobody was placed");
  } finally {
    await dismissFighting(party, combat, later);
  }
});

/** A flagged copy of the party's token on the same scene, as a paste leaves one. */
async function pastedTwin(on = scene, offset = 500) {
  const source = on.tokens.get(onlyFormation().tokenId) ?? scene.tokens.get(onlyFormation().tokenId);
  const data = source.toObject();
  delete data._id;
  delete data.id; // the mock's snapshot also carries the id as a plain field
  data.x += offset;
  const [twin] = await on.createEmbeddedDocuments("Token", [data]);
  await drain();
  return twin;
}

await scenario("a copy of the party token added to a combat deploys nobody and is told so", async () => {
  const party = await fightingParty("Echo Party", "Original", "Likeness");
  const { actors, partyToken } = party;
  const combat = new CombatMock();
  try {
    const twin = await pastedTwin();
    assert.equal(twin.getFlag(MODULE_ID, "formationId"), onlyFormation().id, "the copy carries the party's flag");
    const before = JSON.stringify(onlyFormation());
    const cards = chat.length;
    game.combats.set(combat.id, combat);
    await combat.createEmbeddedDocuments("Combatant", [{ tokenId: twin.id, sceneId: scene.id, actorId: twin.actorId, hidden: false }]);
    await until(() => chat.length > cards);
    assert.equal(JSON.stringify(onlyFormation()), before, "the record is untouched");
    assert.equal(peopleOn(actors).length, 0, "nobody was placed");
    assert.ok(!partyToken.hidden && !twin.hidden, "no token was hidden");
    assert.ok(combat.combatants.some((c) => c.tokenId === twin.id), "the copy's combatant is left alone");
    const posted = chat.slice(cards);
    assert.equal(posted.length, 1, "one card");
    assert.ok(posted[0].content.includes("chat.combatTwinToken") && posted[0].whisper.length > 0, "whispered to the GMs");
    await twin.delete();
  } finally {
    await dismissFighting(party, combat);
  }
});

await scenario("a copy of the party token moving bills nothing, and the linked token still does", async () => {
  const party = await fightingParty("Mirror Party", "Self", "Image");
  const { partyToken, step, turnRounds } = party;
  const twin = await pastedTwin();
  try {
    const before = clockRounds(onlyFormation().clock);
    const baseline = onlyFormation().clock.lastPosition;
    await twin.update({ x: twin.x + step });
    await twin.update({ rotation: 90 });
    await drain();
    assert.equal(clockRounds(onlyFormation().clock), before, "the copy's move is not billed");
    assert.deepEqual(onlyFormation().clock.lastPosition, baseline, "nor measured");
    assert.equal(partyToken.rotation ?? 0, 0, "and the party token did not turn");

    await partyToken.update({ x: partyToken.x + step });
    await until(() => clockRounds(onlyFormation().clock) > before);
    assert.equal(clockRounds(onlyFormation().clock) - before, turnRounds, "the linked token's move is billed");
  } finally {
    await twin.delete();
    await dismissFighting(party);
  }
});

await scenario("a second party token placed by hand is refused, and a flagged one is not", async () => {
  const party = await fightingParty("Crowded Party", "Squire", "Page");
  const { id, partyToken } = party;
  try {
    const actorId = onlyFormation().actorId;
    const warned = notices.length;
    const made = await scene.createEmbeddedDocuments("Token", [{ name: "Hand-placed", actorId, x: 2000, y: 2000 }]);
    await drain();
    assert.equal(made.length, 0, "the unflagged party token is refused");
    assert.equal(scene.tokens.filter((t) => t.actorId === actorId).length, 1, "only the linked token stands");
    assert.equal(onlyFormation().tokenId, partyToken.id, "the linkage did not move");
    assert.ok(notices.slice(warned).some(([kind, m]) => kind === "warn" && m.includes("duplicatePartyToken")), "the Judge is warned");

    const flagged = await scene.createEmbeddedDocuments("Token", [
      { name: "Teleported", actorId, x: 2000, y: 2000, flags: { [MODULE_ID]: { formationId: id } } },
    ]);
    await drain();
    assert.equal(flagged.length, 1, "a flagged creation, which a teleport makes before it hands the linkage over, stands");
    assert.equal(onlyFormation().tokenId, partyToken.id, "and takes no linkage");
    await flagged[0].delete();

    await partyToken.delete();
    await drain();
    assert.equal(onlyFormation().tokenId, null, "with the linked token gone the party links none");
    const [fresh] = await scene.createEmbeddedDocuments("Token", [{ name: "Replacement", actorId, x: 2000, y: 2000 }]);
    await until(() => onlyFormation().tokenId === fresh?.id);
    assert.equal(onlyFormation().tokenId, fresh?.id, "a hand-placed token is accepted and adopted then");
  } finally {
    await dismissFighting(party);
  }
});

/** The formations whose marching order holds `actor`. */
const onlyFormationHolding = (actor) => Object.values(readFormations()).filter((f) => f.members.some((m) => m?.actorId === actor.id));

await scenario("an actor in one party cannot be added to another", async () => {
  const party = await fightingParty("Holding Party One", "Sworn");
  const { actors } = party;
  try {
    const rival = await model.createFormation("Holding Party Two");
    const warned = notices.length;
    await model.addMember(model.getFormation(rival.id), actors[0], null);
    await drain();
    assert.equal(model.getFormation(rival.id).members.length, 0, "the rival party took nobody");
    assert.ok(notices.slice(warned).some(([kind, m]) => kind === "warn" && m.includes("refused.inParty")), "the Judge is told why");
    assert.equal(onlyFormationHolding(actors[0]).length, 1, "the actor is in exactly one party");
    await model.deleteFormationRecord(rival.id);
  } finally {
    await dismissFighting(party);
  }
});

await scenario("where a copy of the party token is read as the true position", async () => {
  const party = await fightingParty("Lookalike Party", "Real");
  const { id } = party;
  const annex = new SceneMock("Annex");
  game.scenes.set(annex.id, annex);
  try {
    const { truePositionToken } = await import("../scripts/formation/shadow.mjs");
    const twin = await pastedTwin(annex);
    const formation = model.getFormation(id);
    assert.equal(truePositionToken(scene, formation, { open: false })?.id, formation.tokenId, "the linked token, on its own scene");
    assert.equal(truePositionToken(annex, formation, { open: false }), null, "a copy on another scene is not where the party stands");
    await twin.delete();
  } finally {
    game.scenes.delete(annex.id);
    await dismissFighting(party);
  }
});

await scenario("the repair tool finds extra party tokens, mends what is safe, and leaves the linked one alone", async () => {
  const { getRepairCheck, scanCheck, fixCheck } = await import("../scripts/lib/repair-logic.mjs");
  const check = getRepairCheck("formation.partyTokens");
  assert.ok(check, "the check is registered");
  const party = await fightingParty("Doubled Party", "Anchor", "Tether");
  const { id, partyToken } = party;
  const annex = new SceneMock("Annex");
  game.scenes.set(annex.id, annex);
  try {
    const linked = partyToken.id;
    const record = JSON.stringify(onlyFormation());
    const twin = await pastedTwin();
    const away = await pastedTwin(annex);
    const [orphan] = await annex.createEmbeddedDocuments("Token", [
      { name: "Orphan", actorId: onlyFormation().actorId, x: 50, y: 50, flags: { [MODULE_ID]: { formationId: "no-such-party" } } },
    ]);
    await drain();

    const scan = await scanCheck(check);
    const by = (token) => scan.findings.find((f) => f.key === token.uuid);
    assert.equal(scan.findings.length, 3, "three tokens disagree with the record");
    assert.ok(by(twin)?.fixable && by(twin).action === "delete", "a copy on the party's scene is deletable");
    assert.ok(by(orphan)?.fixable && by(orphan).action === "delete", "a token of a party that is gone is deletable");
    assert.ok(by(away) && !by(away).fixable && by(away).reason, "a copy on another scene is only reported, with the other way to settle it");
    assert.ok(!scan.findings.some((f) => f.key === partyToken.uuid), "the linked token is not a finding");

    const done = await fixCheck(check, scan.findings);
    assert.equal(done.fixed.length, 2, "two are fixed");
    assert.equal(done.failed.length, 0, "none fails");
    assert.deepEqual(done.rescan.findings.map((f) => f.key), [away.uuid], "the rescan keeps only the report");
    assert.equal(scene.tokens.get(linked), partyToken, "the linked token still stands");
    assert.equal(JSON.stringify(onlyFormation()), record, "the record, its members and its clock are as they were");
    await away.delete();

    // A party token the record lost: no live link, one token of the party on its scene.
    await partyToken.delete();
    await drain();
    assert.equal(onlyFormation().tokenId, null, "the party links no token");
    const stray = new TokenMock(scene, { name: "Stray", actorId: onlyFormation().actorId, x: 700, y: 700 });
    scene.tokens.set(stray.id, stray);
    uuidMap.set(stray.uuid, stray);
    const lost = await scanCheck(check);
    assert.deepEqual(lost.findings.map((f) => [f.key, f.action, f.fixable]), [[stray.uuid, "adopt", true]], "the stray is offered for adoption");
    const mended = await fixCheck(check, lost.findings);
    assert.equal(mended.fixed.length, 1, "adopted");
    assert.equal(mended.rescan.findings.length, 0, "and nothing is left to find");
    assert.equal(onlyFormation().tokenId, stray.id, "the record links it");
    assert.equal(stray.getFlag(MODULE_ID, "formationId"), id, "and it carries the party's flag");
    void orphan;
  } finally {
    game.scenes.delete(annex.id);
    await dismissFighting(party);
  }
});

await scenario("the repair tool links a flagged party token the record lost, and only reports when several compete", async () => {
  const { getRepairCheck, scanCheck, fixCheck } = await import("../scripts/lib/repair-logic.mjs");
  const check = getRepairCheck("formation.partyTokens");
  const party = await fightingParty("Unlinked Party", "Keeper");
  const { id, partyToken } = party;
  const annex = new SceneMock("Annex");
  game.scenes.set(annex.id, annex);
  try {
    // The record forgets its token and scene while the flagged token stands.
    await model.patchFormation(id, (rec) => {
      rec.tokenId = null;
      rec.sceneId = null;
    });
    await drain();
    const lone = await scanCheck(check);
    assert.deepEqual(lone.findings.map((f) => [f.key, f.action, f.fixable]), [[partyToken.uuid, "adopt", true]], "the one flagged token is offered for adoption, never for deletion");
    const mended = await fixCheck(check, lone.findings);
    assert.equal(mended.fixed.length, 1, "adopted");
    assert.equal(mended.rescan.findings.length, 0, "nothing is left to find");
    assert.equal(onlyFormation().tokenId, partyToken.id, "the record links it again");
    assert.equal(onlyFormation().sceneId, scene.id, "on its scene");
    assert.ok(scene.tokens.get(partyToken.id), "and it still stands");

    // Two flagged candidates for one lost link: reported, nothing offered.
    await model.patchFormation(id, (rec) => {
      rec.tokenId = null;
      rec.sceneId = null;
    });
    const [rival] = await annex.createEmbeddedDocuments("Token", [
      { name: "Rival", actorId: onlyFormation().actorId, x: 10, y: 10, flags: { [MODULE_ID]: { formationId: id } } },
    ]);
    await drain();
    const two = await scanCheck(check);
    assert.equal(two.findings.length, 2, "both are listed");
    assert.ok(two.findings.every((f) => !f.fixable && f.reason), "neither is fixable, each with the other way to settle it");
    assert.deepEqual((await fixCheck(check, two.findings)).fixed, [], "nothing is fixed");
    assert.ok(scene.tokens.get(partyToken.id) && annex.tokens.get(rival.id), "and neither was deleted");

    // Delete one, and the other is the party's.
    await rival.delete();
    await drain();
    const one = await scanCheck(check);
    assert.deepEqual(one.findings.map((f) => [f.key, f.fixable]), [[partyToken.uuid, true]], "the one left is offered for adoption");
  } finally {
    game.scenes.delete(annex.id);
    await dismissFighting(party);
  }
});

await scenario("the repair tool gives a party actor a record", async () => {
  const { getRepairCheck, scanCheck, fixCheck } = await import("../scripts/lib/repair-logic.mjs");
  const check = getRepairCheck("formation.partyActors");
  assert.ok(check, "the check is registered");
  const party = await fightingParty("Roster Party", "Twice");
  try {
    const bare = await ActorMock.create({ name: "Bare Party", type: `${MODULE_ID}.party` });
    await drain();
    // Its record is lost: the world holds the actor and no party names it.
    await game.settings.set(MODULE_ID, "formations", Object.fromEntries(Object.entries(readFormations()).filter(([, f]) => f.actorId !== bare.id)));
    await drain();

    const scan = await scanCheck(check);
    const bareFinding = scan.findings.find((f) => f.uuid === bare.uuid);
    assert.ok(bareFinding?.fixable, "a party actor with no record is fixable");

    const done = await fixCheck(check, scan.findings);
    assert.equal(done.fixed.length, 1, "it is fixed");
    assert.ok(Object.values(readFormations()).some((f) => f.actorId === bare.id), "the party actor has a record");
    assert.deepEqual(done.rescan.findings, [], "the rescan finds nothing");
    assert.equal(model.getFormation(party.id).members.length, 1, "and the party keeps its members");
    await bare.delete();
  } finally {
    await dismissFighting(party);
  }
});

await scenario("a fight emptied of the party's fighters is over at Form Up", async () => {
  // See docs/formation/DECISIONS.md, "A fight no combat holds a body of is over".
  const { captureOrder, formUp } = await import("../scripts/formation/marching-templates.mjs");
  const party = await fightingParty("Formed Party", "Leader", "Follower");
  const { id, actors, cell } = party;
  const combat = new CombatMock();
  try {
    const order = captureOrder(model.getFormation(id));
    await partyJoins(combat);
    assert.ok(onlyFormation().combat?.active, "the party deployed for combat");
    await toggleOut(combat, actors);

    const cards = chat.length;
    const warned = notices.length;
    const result = await formUp(model.getFormation(id), order);
    await drain();
    assert.ok(result, "Form Up ran");
    assert.equal(onlyFormation().combat, null, "the party re-formed");
    for (const actor of actors) assert.ok(!cell(actor).deployedTokenId && !cell(actor).deployedCombatId, `${actor.name} is back inside the party token`);
    assert.equal(peopleOn(actors).length, 0, "no member token is left on the map");
    assert.ok(chat.slice(cards).some((m) => m.content.includes("chat.combatReformed")), "the re-forming is announced");
    assert.ok(!notices.slice(warned).some(([kind]) => kind === "warn"), "nothing is refused");
  } finally {
    await dismissFighting(party, combat);
  }
});

await scenario("Form Up is refused while a fight still holds a fighter", async () => {
  // See docs/formation/DECISIONS.md, "A fight no combat holds a body of is over".
  const { captureOrder, formUp } = await import("../scripts/formation/marching-templates.mjs");
  const party = await fightingParty("Holding Party", "Stander", "Leaver");
  const { id, actors } = party;
  const [, leaver] = actors;
  const combat = new CombatMock();
  try {
    const order = captureOrder(model.getFormation(id));
    await partyJoins(combat);
    await toggleOut(combat, [leaver]);
    const warned = notices.length;
    assert.equal(await formUp(model.getFormation(id), order), null, "Form Up declines");
    await drain();
    assert.ok(onlyFormation().combat?.active, "the fight stands");
    assert.equal(peopleOn(actors).length, 2, "nobody is gathered");
    assert.ok(notices.slice(warned).some(([kind, m]) => kind === "warn" && m.includes("marching.notInCombat")), "and says why");
  } finally {
    await dismissFighting(party, combat);
  }
});

/** A party whose order was saved and then reversed, so a form-up shows in who stands where. */
async function pickedParty(name) {
  const { saveTemplate } = await import("../scripts/formation/marching-templates.mjs");
  const party = await isolatedParty(name, "Vanguard", "Rearguard");
  const { template } = await saveTemplate(model.getFormation(party.id), `${name} order`);
  await model.patchFormation(party.id, (rec) => {
    rec.members.reverse();
  });
  const standing = () => model.getFormation(party.id).members.map((m) => m.actorId);
  return { ...party, template, standing };
}

async function dismissPicked({ id, actors, template }) {
  const { deleteTemplate } = await import("../scripts/formation/marching-templates.mjs");
  await deleteTemplate(template.id);
  await dismissFighting({ id, actors });
}

await scenario("a picker's Delete forgets the order and leaves the party as it stood", async () => {
  const { carryOutPick, getTemplate } = await import("../scripts/formation/marching-templates.mjs");
  const party = await pickedParty("Deleting Party");
  const { id, template, standing } = party;
  try {
    const stood = standing();
    const told = notices.length;
    const done = await carryOutPick(model.getFormation(id), { template, action: "delete" });
    await drain();
    assert.deepEqual(done, { deleted: true, result: null }, "the answer says an order was forgotten");
    assert.equal(getTemplate(template.id), null, "the order is gone");
    assert.deepEqual(standing(), stood, "nobody was marched anywhere");
    const said = notices.slice(told).map(([, m]) => m);
    assert.ok(said.some((m) => m.includes("marching.deleted")), "the seat is told the order was deleted");
    assert.ok(!said.some((m) => m.includes("marching.restored")), "and is not told of a form-up");
  } finally {
    await dismissPicked(party);
  }
});

await scenario("a picker's Form up marches the party into the order and keeps the order", async () => {
  const { carryOutPick, getTemplate } = await import("../scripts/formation/marching-templates.mjs");
  const party = await pickedParty("Forming Party");
  const { id, template, standing } = party;
  try {
    const saved = template.cells.map((c) => c.actorId);
    assert.notDeepEqual(standing(), saved, "the party stands out of its saved order");
    const told = notices.length;
    const done = await carryOutPick(model.getFormation(id), { template, action: "apply" });
    await drain();
    assert.equal(done?.deleted, false);
    assert.equal(done?.result?.restored, 2, "both members are laid back");
    assert.deepEqual(standing(), saved, "the party stands in the saved order");
    assert.ok(getTemplate(template.id), "the order is kept");
    assert.ok(notices.slice(told).some(([, m]) => m.includes("marching.restored")), "the seat is told of the form-up");
  } finally {
    await dismissPicked(party);
  }
});

await scenario("a dismissed picker, or an answer naming neither button, does nothing", async () => {
  const { carryOutPick, getTemplate } = await import("../scripts/formation/marching-templates.mjs");
  const party = await pickedParty("Undecided Party");
  const { id, template, standing } = party;
  try {
    const stood = standing();
    const told = notices.length;
    assert.equal(await carryOutPick(model.getFormation(id), null), null, "a dismissed picker");
    assert.equal(await carryOutPick(model.getFormation(id), { template, action: "rename" }), null, "an unknown button");
    await drain();
    assert.deepEqual(standing(), stood, "nobody moved");
    assert.ok(getTemplate(template.id), "the order is kept");
    assert.equal(notices.length, told, "and nothing is said");
  } finally {
    await dismissPicked(party);
  }
});

await scenario("a fight the GM moved into another encounter is not over", async () => {
  // See docs/formation/DECISIONS.md, "A fight no combat holds a body of is over".
  const party = await fightingParty("Moved Party", "Brawler", "Slinger");
  const { actors, partyToken, step } = party;
  const first = new CombatMock();
  const second = new CombatMock();
  game.combats.set(second.id, second);
  try {
    await partyJoins(first);
    const moved = first.combatants.filter((c) => actors.some((a) => a.id === c.actorId));
    await second.createEmbeddedDocuments("Combatant", moved.map(({ tokenId, sceneId, actorId }) => ({ tokenId, sceneId, actorId })));
    await toggleOut(first, actors);
    await partyToken.update({ x: partyToken.x + step });
    await drain();
    assert.equal(onlyFormation().combat?.combatId, first.id, "the record still names the first encounter");
    assert.equal(peopleOn(actors).length, 2, "the fighters still stand, fighting in the second");
  } finally {
    await dismissFighting(party, first, second);
  }
});

await scenario("a stack's bodies in the tracker keep the party's fight", async () => {
  // See docs/formation/DECISIONS.md, "A fight no combat holds a body of is over".
  const party = await fightingParty("Warband Party", "Chief");
  const { id, actors, partyToken, step } = party;
  const group = await stackStandingOn("Raiders", [{ on: scene, x: 1400, y: 1000 }]);
  const combat = new CombatMock();
  try {
    await partyJoins(combat);
    await toggleOut(combat, actors);
    await model.patchFormation(id, (rec) => {
      rec.members.push({ actorId: group.id, roles: [], tokenData: null, deployedStack: true, deployedCombatId: combat.id });
    });
    const [body] = scene.tokens.filter((t) => t.getFlag(MODULE_ID, "group") === group.uuid);
    await combat.createEmbeddedDocuments("Combatant", [{ tokenId: body.id, sceneId: scene.id, actorId: group.id }]);
    await drain();
    await partyToken.update({ x: partyToken.x + step });
    await drain();
    assert.ok(onlyFormation().combat?.active, "the stack's body in the tracker keeps the fight");
    assert.ok(onlyFormation().members.find((m) => m.actorId === group.id).deployedStack, "the stack is still out");
  } finally {
    await dismissFighting(party, combat);
    await group.delete();
    await drain();
  }
});

await scenario("a move made while the party deploys does not re-form the deploy", async () => {
  // See docs/formation/DECISIONS.md, "A fight no combat holds a body of is over".
  // The deploy records its takeover before its combatants exist.
  const party = await fightingParty("Hasty Party", "Quick", "Slow");
  const { actors, partyToken, step, cell } = party;
  const combat = new CombatMock();
  let open;
  combat.hold = { call: 2, until: new Promise((resolve) => (open = resolve)) };
  try {
    game.combats.set(combat.id, combat);
    const cards = chat.length;
    const joining = combat.createEmbeddedDocuments("Combatant", [
      { tokenId: partyToken.id, sceneId: scene.id, actorId: onlyFormation().actorId, hidden: false },
    ]);
    await drain();
    assert.ok(actors.every((a) => cell(a).deployedCombatId === combat.id), "the deploy recorded its takeover");
    assert.equal(combat.combatants.filter((c) => c.tokenId !== partyToken.id).length, 0, "before its combatants exist");
    await partyToken.update({ x: partyToken.x + step });
    await drain();
    open();
    await joining;
    await until(() => onlyFormation().combat?.active && combat.combatants.contents.length === actors.length);
    assert.ok(onlyFormation().combat?.active && onlyFormation().combat.combatId === combat.id, "the party fights");
    assert.equal(peopleOn(actors).length, actors.length, "every body stands");
    assert.equal(combat.combatants.contents.length, actors.length, "each one a combatant");
    assert.ok(!chat.slice(cards).some((m) => m.content.includes("chat.combatReformed")), "nothing re-formed");
  } finally {
    open?.();
    await dismissFighting(party, combat);
  }
});

await scenario("a deploy while a move is still drawn lays the block where the move ends", async () => {
  // The block is laid at the party token's stored corner.
  const party = await drawnParty("Hurried");
  const { walker, partyToken, step } = party;
  const combat = new CombatMock();
  try {
    const start = { x: partyToken.x, y: partyToken.y };
    const end = { x: start.x + step, y: start.y };
    await partyToken.update({ x: end.x });
    await drain();
    assert.deepEqual({ x: partyToken.x, y: partyToken.y }, start, "the drawing still stands where the move began");
    await partyJoins(combat);
    await until(() => onlyFormation().combat?.active);
    const fighter = scene.tokens.get(onlyFormation().members.find((m) => m.actorId === walker.id).deployedTokenId);
    assert.ok(fighter, "the fighter is on the map");
    assert.ok(Math.abs(fighter.x - end.x) < Math.abs(fighter.x - start.x), "laid around where the move ends");
  } finally {
    await combat.delete();
    await drain();
    game.combats.delete(combat.id);
    await dismissDrawn(party);
  }
});

await scenario("overlapping environment sweeps coalesce instead of racing", async () => {
  // See docs/formation/DECISIONS.md, "Environment sweeps coalesce, and a
  // vanished target is not a fault".
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  await drain();

  let sweeps = 0;
  const realGet = game.settings.get.bind(game.settings);
  // With no formations, the fog gate is the one setting a sweep reads, once
  // per run.
  game.settings.get = (ns, key) => {
    if (ns === MODULE_ID && key === "manageFog") sweeps++;
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
    const perTurn = TIME_COUNTS.roundsPerTurn;
    const roundsBefore = before.turnsTotal * perTurn + (before.roundsPartial ?? 0);

    // One block: 30 m at 5 m to the cell is six cells.
    await partyToken.update({ x: partyToken.x + 6 * city.grid.size });
    await drain();

    const after = onlyFormation().clock;
    const rounds = after.turnsTotal * perTurn + (after.roundsPartial ?? 0) - roundsBefore;
    console.log(`      [probe] one block dragged -> ${rounds} round(s), ${rounds / perTurn} turn(s)`);
    assert.equal(rounds, perTurn, "one block is one turn, not one per 3.28 metres");

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
  // The zone states no target, so the throw takes the imported one, and its
  // die: invented here, as a Judge's book would supply them.
  const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
  const { DELVE_ENCOUNTER_DOC } = await import("../scripts/formation/constants.mjs");
  registerTable({ id: DELVE_ENCOUNTER_DOC, tables: { die: "1d8", every: 9, target: 4 } }, { priority: PRIORITY.WORLD });
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
    unregisterTable(DELVE_ENCOUNTER_DOC, { priority: PRIORITY.WORLD });
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
async function takeStay({ faces, hour = "day", days = 3, start = 0, cadence = true, dice = true, map = false, worldList = false }) {
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
        tables: {
          encounters: { holedUp: { any: { everyTurns: 1, throw: 4 } } }, encounterAfterDark: 30,
          ...(dice && { dice: { street: "1d8", incident: "1d90" } }),
        },
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
  assert.deepEqual(stay.thrown, ["1d8", "1d8", "1d8", "1d100", "1d100"], "a die a day, then the list's own die per met day");
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
  assert.deepEqual(stay.thrown, ["1d8", "1d8", "1d8"], "no incident die was thrown");
});

await scenario("a stay that cannot be priced throws nothing and says nothing of it; one with no incident list still says so", async () => {
  // No cadence imported: nothing is thrown, and the card carries no line for it.
  const unpriced = await takeStay({ faces: [], cadence: false, map: true });
  assert.ok(!unpriced.content.includes("settlement.card.unpriced"));
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

await scenario("a stay priced but with the street's die not imported throws nothing and names no die", async () => {
  const noDie = await takeStay({ faces: [], dice: false, map: true });
  assert.ok(!noDie.content.includes("settlement.card.unpriced"), "the card carries no line for the missing die");
  assert.deepEqual(noDie.thrown, [], "nothing was thrown on a die nobody printed");
  assert.ok(!noDie.content.includes("stayDay"));
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
    await lostFog.restoreFog("S1", snap, "L0");
    assert.equal(server.get("newest").explored, "seen", "the restore writes onto the player's own document");
    assert.ok(server.has("older"), "an older copy is not touched");
    assert.equal([...server.values()].filter((d) => d.user === "PL1" && d.scene === "S1").length, 2, "and nothing is created");
    assert.equal(held.size, 0, "the seat a write took in the collection is given back");

    await writeExplored(new FogDoc(server.get("judge")), "judge-view-2");
    assert.equal(server.get("judge").explored, "judge-view-2", "a direct write lands on the server copy");

    // A seat the snapshot recorded as empty loses the document the episode made
    // for it, though a reload since means this client never held it.
    put({ _id: "faked", scene: "S1", user: "PL2", level: "L0", explored: "faked-only", timestamp: 7 });
    await lostFog.restoreFog("S1", { GM1: "judge-view", PL1: "seen" }, "L0");
    assert.ok(!server.has("faked"), "a restore deletes a document this client never loaded");
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
  // The throw's die is imported or nothing; an invented one stands in here.
  const { registerTable: addTable, unregisterTable: dropTable, PRIORITY: LAYER } = await import("../scripts/lib/tables.mjs");
  const { DELVE_ENCOUNTER_DOC: DELVE_DOC } = await import("../scripts/formation/constants.mjs");
  addTable({ id: DELVE_DOC, tables: { die: "1d8" } }, { priority: LAYER.WORLD });
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
    dropTable(DELVE_DOC, { priority: LAYER.WORLD });
    scene.regions.delete(zone.id);
    uuidMap.delete(outer.uuid);
    await model.disband(model.getFormation(onlyFormation().id));
    await drain();
  }
});

await scenario("the delve's wandering throw takes its cadence from the setting over the import, and with neither schedules nothing", async () => {
  // See docs/formation/DECISIONS.md, "The delve's wandering cadence is imported".
  // Every figure here is invented, as a Judge's book would supply its own.
  const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
  const { DELVE_ENCOUNTER_DOC } = await import("../scripts/formation/constants.mjs");
  const runner = await member("Cadence");
  await drain();
  const [cToken] = await scene.createEmbeddedDocuments("Token", [{ name: "Cadence", actorId: runner.id, x: 1400, y: 1400 }]);
  await game.settings.set(MODULE_ID, "formations", {});
  let formation = await model.createFormation("Cadence Party");
  formation = await model.addMember(formation, runner, cToken);
  await drain();
  const id = onlyFormation().id;
  const throwCards = (from) => chat.slice(from).filter((m) => String(m.flavor ?? "").includes("chat.encounterCheck"));
  const cadence = () => {
    const p = engine.getEncounterParams(model.getFormation(id));
    return [p.every, p.target, p.from.every, p.from.target];
  };
  try {
    assert.deepEqual(cadence(), [null, null, null, null], "nothing set or imported: no figure");
    let from = chat.length;
    await engine.advanceTurns(model.getFormation(id), 5, { reason: "manual" });
    await drain();
    assert.equal(throwCards(from).length, 0, "and no throw is scheduled");
    assert.equal(onlyFormation().clock.encounterCounter, 0, "nor any turn counted toward one");
    const warned = notices.length;
    assert.equal(await engine.encounterCheck(model.getFormation(id), { manual: true }), false, "a manual throw with no target refuses");
    assert.equal(notices.slice(warned).filter(([kind]) => kind === "warn").length, 0, "and raises no warning");
    assert.equal(throwCards(from).length, 0, "throwing nothing");

    // An interval and a target with no die to throw them on is still no throw.
    registerTable({ id: DELVE_ENCOUNTER_DOC, tables: { every: 3, target: 5 } }, { priority: PRIORITY.WORLD });
    from = chat.length;
    await engine.advanceTurns(model.getFormation(id), 4, { reason: "manual" });
    await drain();
    assert.equal(throwCards(from).length, 0, "no imported die, no throw scheduled");
    const warnedAgain = notices.length;
    assert.equal(await engine.encounterCheck(model.getFormation(id), { manual: true }), false, "and a manual throw refuses");
    assert.equal(notices.slice(warnedAgain).filter(([kind]) => kind === "warn").length, 0, "with no warning");

    const cites = { die: "JJ p. 1", every: "JJ p. 1", target: "JJ p. 1", distance: "JJ p. 1" };
    registerTable(
      { id: DELVE_ENCOUNTER_DOC, cites, tables: { die: "1d8", every: 3, target: 5, distance: "3d4*20" } },
      { priority: PRIORITY.WORLD },
    );
    assert.deepEqual(cadence(), [3, 5, "import", "import"], "the import supplies the interval and the target");
    from = chat.length;
    await engine.advanceTurns(model.getFormation(id), 6, { reason: "manual" });
    await drain();
    const imported = throwCards(from);
    assert.equal(imported.length, 2, "the imported interval throws every third turn");
    assert.match(imported[0].flavor, /data-tooltip-text=\\?"ACKS-FORMATION\.chat\.cadenceFrom\.import.*JJ p\. 1/, "the target names the page it was read from");
    assert.match(imported[0].flavor, /1d8/, "the card names the imported die");
    const hits = (start) => chat.slice(start).filter((m) => String(m.flavor ?? "").includes("chat.encounterTriggered"));
    assert.ok(hits(from).length > 0, "a throw that meets its target is an encounter");
    assert.match(hits(from)[0].flavor, /chat\.encounterDetail\b.*cadenceFrom\.import/, "whose rolled distance names where its dice came from");

    // With no distance dice the encounter stands, and no distance is invented.
    registerTable(
      { id: DELVE_ENCOUNTER_DOC, cites, tables: { die: "1d8", every: 3, target: 5 } },
      { priority: PRIORITY.WORLD },
    );
    from = chat.length;
    assert.equal(await engine.encounterCheck(model.getFormation(id), { manual: true }), true, "the throw still hits");
    assert.match(hits(from)[0]?.flavor ?? "", /chat\.encounterDetailNoDistance/, "and the card carries the minute alone");
    registerTable(
      { id: DELVE_ENCOUNTER_DOC, cites, tables: { die: "1d8", every: 3, target: 5, distance: "3d4*20" } },
      { priority: PRIORITY.WORLD },
    );

    await game.settings.set(MODULE_ID, "encounterEvery", 2);
    assert.deepEqual(cadence(), [2, 5, "setting", "import"], "a stated interval wins over the import; the target stays imported");
    await game.settings.set(MODULE_ID, "encounterEvery", 0);
    from = chat.length;
    await engine.advanceTurns(model.getFormation(id), 4, { reason: "manual" });
    await drain();
    assert.equal(throwCards(from).length, 0, "an interval of 0 turns the automatic throw off");
    await game.settings.set(MODULE_ID, "encounterEvery", null);
    assert.deepEqual(cadence(), [3, 5, "import", "import"], "a blank setting defers to the import again");

    registerTable({ id: DELVE_ENCOUNTER_DOC, tables: { target: 2 } }, { priority: PRIORITY.OVERRIDE });
    const params = engine.getEncounterParams(model.getFormation(id));
    assert.deepEqual([params.every, params.target], [3, 2], "an override of one table leaves the other imported");
    assert.match(engine.cadenceProvenance(params, "target"), /cadenceFrom\.override/, "the overridden figure names no page");
    assert.match(engine.cadenceProvenance(params, "every"), /cadenceFrom\.import/, "the imported one still does");

    // The throw is the stated die for a hurried party and for a dark one: no
    // light or pace adds a figure to it. See docs/formation/DECISIONS.md,
    // "The encounter throw ships no house modifier".
    registerTable({ id: DELVE_ENCOUNTER_DOC, tables: { die: "1d8", every: 3, target: 5 } }, { priority: PRIORITY.WORLD });
    unregisterTable(DELVE_ENCOUNTER_DOC, { priority: PRIORITY.OVERRIDE });
    const thrown = [];
    const RollBeforeSpy = globalThis.Roll;
    globalThis.Roll = class extends RollBeforeSpy {
      constructor(formula) {
        super(formula);
        thrown.push(formula);
      }
    };
    const darknessBefore = scene.environment.darknessLevel;
    try {
      scene.environment.darknessLevel = 0.9;
      const careful = model.getFormation(id);
      assert.ok(model.isPartyInDark(careful), "the party stands in the dark");
      await engine.encounterCheck(careful, { manual: true });
      const hurry = model.getFormation(id);
      hurry.stance = { ...(hurry.stance ?? {}), pace: "hurried" };
      await model.updateFormation(hurry);
      await drain();
      await engine.encounterCheck(model.getFormation(id), { manual: true });
    } finally {
      globalThis.Roll = RollBeforeSpy;
      scene.environment.darknessLevel = darknessBefore;
    }
    assert.deepEqual(thrown.filter((formula) => String(formula).startsWith("1d8")), ["1d8", "1d8"], "a dark party and a hurried one both throw the bare die");
    assert.ok(thrown.every((formula) => !String(formula).includes("+")), "no modifier joins any throw");
  } finally {
    unregisterTable(DELVE_ENCOUNTER_DOC, { priority: PRIORITY.OVERRIDE });
    unregisterTable(DELVE_ENCOUNTER_DOC, { priority: PRIORITY.WORLD });
    await game.settings.set(MODULE_ID, "encounterEvery", null);
    await model.disband(model.getFormation(id));
    await drain();
  }
});

await scenario("a door's construction and marks persist, a botch reports its damage, a batter spends its turns", async () => {
  const doors = await import("../scripts/formation/doors.mjs");
  const { default: DoorApp } = await import("../scripts/formation/door-app.mjs");
  const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
  const { THROWS_DOC, THROW_TABLE } = await import("../scripts/lib/throws.mjs");
  const ROUNDS_PER_TURN = TIME_COUNTS.roundsPerTurn;

  // Every figure below is INVENTED and registered the way an import registers
  // it, each different from the others and from any page's, so a figure left in
  // source or two figures swapped fails a check.
  const GRID = [
    { ordinal: 1, label: "Door A", batter: { count: 2, unit: "turn", tool: "mattock" } },
    { ordinal: 2, label: "Door B", batter: null },
    { ordinal: 3, label: "Door B", batter: { count: 5, unit: "round", tool: "adze" } },
  ];
  const BASH = {
    bashStrengthFactor: 3, bashPairBonus: 5, bashCrowbarBonus: 7, bashSizeBonus: 6, bashSizePenalty: 9,
    bashSpikePenalty: 11, doorSpikeMax: 6, bashBotchBand: 2, bashReboundDamage: 3,
  };
  const TARGET = 15; // the basher's own Dungeonbashing figure
  const importDoors = (tables = { doors: GRID, ...BASH }) => {
    unregisterTable("formation", { priority: PRIORITY.WORLD });
    if (tables) registerTable({ id: "formation", tables }, { priority: PRIORITY.WORLD, source: "test" });
  };
  const importThrows = (cells) => {
    unregisterTable(THROWS_DOC, { priority: PRIORITY.WORLD });
    if (cells) registerTable({ id: THROWS_DOC, tables: { [THROW_TABLE]: cells } }, { priority: PRIORITY.WORLD, source: "test" });
  };

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
  basher.system.adventuring.dungeonbashing = TARGET; // Strength +1 on the sheet, no skill held
  await drain();
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  importDoors();
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
    assert.equal(defaults.kind, null, "no construction is picked until one is: none is assumed");
    assert.deepEqual(doors.doorRows().map((r) => r.key), ["1:Door A", "2:Door B", "3:Door B"], "a row is keyed by its place and its label, since two share a name");
    assert.deepEqual(doors.batterPlan(wall), { ok: false, reason: "noRow" }, "a door with no row picked has no batter");
    const ctx0 = await app._prepareContext();
    assert.deepEqual(ctx0.kinds.map((k) => [k.value, k.selected]), [["", true], ["1:Door A", false], ["2:Door B", false], ["3:Door B", false]], "the unset choice leads and is the one selected");
    assert.deepEqual(ctx0.batter, { ok: false, tooSolid: false }, "the window shows no batter for it, and no refusal");
    const other = "1:Door A";
    await submit(app, { kind: other, evil: true, jammed: false });
    let state = doors.doorState(wall);
    assert.equal(state.kind, other, "the construction select writes the wall");
    assert.equal(state.evil, true, "the evil mark writes the wall");
    assert.equal(state.jammed, false);
    assert.equal(wall.flags[MODULE_ID].door.kind, other, "under the door flag, where doorState reads it");
    assert.equal(doors.batterPlan(wall).row.key, other, "and the plan follows the construction");
    assert.equal((await app._prepareContext()).batter.line.includes("mattock"), true, "the tool word is the import's");

    await submit(app, { kind: other, evil: false, jammed: true });
    state = doors.doorState(wall);
    assert.deepEqual([state.kind, state.evil, state.jammed], [other, false, true], "an unticked mark is cleared, a ticked one set");

    const bad = await doors.setDoorTraits(wall, { kind: "notAConstruction" });
    assert.equal(bad.state.kind, other, "an unknown construction is not stored");
    await doors.setDoorTraits(wall, { kind: "", evil: false, jammed: false });
    assert.equal(doors.doorState(wall).kind, null, "the empty choice clears the construction");
    wall.flags[MODULE_ID].door.spikes = 2;
    await submit(app, { kind: other, evil: true, jammed: true });
    assert.equal(doors.doorState(wall).spikes, 2, "a write to the marks leaves the spikes alone");
    await doors.setDoorTraits(wall, { kind: "", evil: false, jammed: false });

    /* --- a stored name from before the grid was imported reads as unset, and a write beside it leaves it --- */
    wall.flags[MODULE_ID].door.kind = "ironBanded";
    assert.equal(doors.doorState(wall).kind, null, "an older stored kind reads unset");
    assert.equal(doors.batterPlan(wall).reason, "noRow");
    await doors.spikeDoor(wall, basher);
    assert.equal(wall.flags[MODULE_ID].door.kind, "ironBanded", "a spike writes its own key and nothing it read");
    assert.equal(wall.flags[MODULE_ID].door.spikes, 3);
    await doors.setDoorTraits(wall, { kind: "", evil: false, jammed: false });
    wall.flags[MODULE_ID].door.spikes = 0;

    /* --- a botch reports its damage on the card and writes nothing --- */
    const hpBefore = basher.system.hp.value;
    rigRoll(1);
    let from = chat.length;
    const botched = await doors.bashDoor(wall, { actor: basher });
    assert.equal(botched.botch, true);
    assert.equal(botched.damage, BASH.bashReboundDamage, "a botch deals the imported rebound");
    assert.equal(botched.plan.target, TARGET, "the target is the basher's own Dungeonbashing figure");
    assert.equal(botched.total, 1 + BASH.bashStrengthFactor, "and Strength adds at the imported factor");
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

    /* --- the terms a bash applies, each from its own import --- */
    const bplan = (o) => doors.bashPlan({ target: TARGET, strMod: 0, ...o });
    assert.deepEqual(bplan({ strMod: 2, pair: true, crowbar: true, sizeSteps: 2, spikes: 3, extra: 1 }).parts.map((p) => [p.key, p.value]),
      [["str", 6], ["pair", 5], ["crowbar", 7], ["size", 12], ["spikes", -22], ["judge", 1]], "each term reads its own magnitude, the sign being the procedure's");
    assert.deepEqual(bplan({ sizeSteps: -2 }).parts.map((p) => [p.key, p.value]), [["size", -18]], "a smaller basher reads the penalty figure");
    assert.equal(bplan({ spikes: 1 }).parts.length, 0, "the first spike costs nothing");
    assert.equal(bplan({ strMod: 2, pair: true }).needs, TARGET - 6 - 5);
    assert.equal(doors.maxSpikes(), BASH.doorSpikeMax, "the spike limit is the import's");

    /* --- the four names a companion may still read stay exported and hold no figure --- */
    assert.deepEqual(["BASH_TARGET", "BASH_STR_FACTOR", "MAX_SPIKES", "DOOR_KINDS"].map((name) => name in doors), [true, true, true, true], "each old name is still exported");
    assert.deepEqual([doors.BASH_TARGET, doors.BASH_STR_FACTOR, doors.MAX_SPIKES], [null, null, null], "the figures arrive from the import, so the constants hold none");
    assert.deepEqual([[...doors.DOOR_KINDS], Object.isFrozen(doors.DOOR_KINDS)], [[], true], "the door kinds are the import's rows, so the table is empty");

    /* --- a solo basher's own Strength adjustment stands, negative included; a pair takes the stronger --- */
    const frail = await member("Frail");
    frail.system.scores.str.mod = -2;
    const mate = await member("Mate");
    mate.system.scores.str.mod = -1;
    assert.deepEqual([doors.bashStrength(frail), doors.bashStrength(frail, mate), doors.bashStrength(null)], [-2, -1, 0], "alone the basher's own, paired the stronger of the two, nobody none");
    rigRoll(9);
    const frailBash = await doors.bashDoor(wall, { actor: frail });
    assert.deepEqual(frailBash.plan.parts.map((p) => [p.key, p.value]), [["str", -2 * BASH.bashStrengthFactor]], "a negative Strength is a negative term, not nothing");
    assert.equal(frailBash.total, 9 - 2 * BASH.bashStrengthFactor);
    frail.system.scores.str.mod = -1;
    mate.system.scores.str.mod = -3;
    wall.ds = 0;
    const pairBash = await doors.bashDoor(wall, { actor: frail, partner: mate });
    assert.deepEqual(pairBash.plan.parts.map((p) => [p.key, p.value]), [["str", -BASH.bashStrengthFactor], ["pair", BASH.bashPairBonus]], "a pair takes the stronger's adjustment, and the pair term");

    /* --- the natural die is read first, then the door's own band, then the target --- */
    rigRoll(2);
    const bandOverTotal = await doors.bashDoor(wall, { actor: basher, extra: 20 });
    assert.deepEqual([bandOverTotal.success, bandOverTotal.botch, bandOverTotal.damage], [true, false, 0], "with no throws imported the total decides, and a botch is a failure");
    importThrows({ autoFailMax: 3, autoSucceedMin: 17 });
    rigRoll(3);
    const autoFailed = await doors.bashDoor(wall, { actor: basher, extra: 20 });
    assert.deepEqual([autoFailed.total >= TARGET, autoFailed.success, autoFailed.botch], [true, false, false], "an automatic failure fails a total over the target, outside the band");
    rigRoll(2);
    const autoFailedBotch = await doors.bashDoor(wall, { actor: basher, extra: 20 });
    assert.deepEqual([autoFailedBotch.success, autoFailedBotch.botch, autoFailedBotch.damage], [false, true, BASH.bashReboundDamage], "a natural in the band that fails is a botch");
    rigRoll(17);
    const noSkill = await doors.bashDoor(wall, { actor: basher, extra: -10 });
    assert.deepEqual([noSkill.total < TARGET, noSkill.success], [true, false], "an automatic success is for a basher holding the skill: this one throws the Adventuring figure");
    const skilled = await member("Skilled");
    skilled.system.adventuring.dungeonbashing = TARGET + 5;
    await skilled.createEmbeddedDocuments("Item", [{
      name: "Dungeonbashing", type: "ability", system: { rollTarget: TARGET },
      flags: { [MODULE_ID]: { extras: { rolls: [{ key: "primary", formula: "1d20", rollType: "above", target: { kind: "flat", flat: TARGET }, scale: "level" }] } } },
    }]);
    assert.deepEqual(await doors.bashThrow(skilled), { target: TARGET, proficient: true }, "a holder of the skill is proficient, as resolveCheck reports it");
    rigRoll(17);
    const skillAuto = await doors.bashDoor(wall, { actor: skilled, extra: -10 });
    assert.deepEqual([skillAuto.total < TARGET, skillAuto.success], [true, true], "a proficient automatic success opens it with the total under the target");
    importThrows(null);
    rigRoll(17);
    assert.equal((await doors.bashDoor(wall, { actor: skilled, extra: -10 })).success, false, "with nothing imported the target alone decides");

    /* --- the plan's hopelessness counts an automatic success --- */
    const weak = { strMod: -5 };
    assert.equal(bplan(weak).hopeless, true, "no roll reaches it and nothing is automatic");
    importThrows({ autoFailMax: 3, autoSucceedMin: 17 });
    assert.equal(bplan({ ...weak, proficient: true }).hopeless, false, "a proficient basher's automatic success can");
    assert.equal(bplan({ ...weak, proficient: true }).needs, 17, "and the die must show its edge");
    assert.equal(bplan({ ...weak, proficient: false }).hopeless, true, "a basher without the skill has none");
    importThrows(null);

    /* --- an unimported figure the bash applies leaves it blank, and one it does not apply costs nothing --- */
    const thrownDice = [];
    const spyRoll = globalThis.Roll;
    globalThis.Roll = class extends spyRoll { constructor(f) { super(f); thrownDice.push(f); } };
    importDoors(null);
    const bare = await doors.bashDoor(wall, { actor: basher });
    assert.deepEqual([bare.ok, bare.reason], [false, "missing"], "a bookless world bashes no door");
    assert.deepEqual(bare.missing, ["bashStrengthFactor", "bashBotchBand", "bashReboundDamage"], "the figures it applies are named");
    assert.equal(thrownDice.length, 0, "no die is thrown");
    const blank = await (async () => { const c = await app._prepareContext(); return [c.needs, c.canBash, c.plan.hopeless]; })();
    assert.deepEqual(blank, [null, false, null], "the window leaves needs blank and the button disabled, not hopeless");
    assert.deepEqual(doors.bashPlan({ target: TARGET, spikes: 3 }).missing, ["bashSpikePenalty", "bashBotchBand", "bashReboundDamage"]);
    importDoors({ bashBotchBand: BASH.bashBotchBand, bashReboundDamage: BASH.bashReboundDamage });
    basher.system.scores.str.mod = 0;
    assert.equal(doors.bashPlan({ target: TARGET }).ready, true, "a term not in play needs no import: no Strength, no partner, no crowbar, no size, no spike");
    assert.equal(doors.bashPlan({ target: TARGET, spikes: 1 }).ready, true, "the first spike is free of a penalty");
    for (const [o, key] of [[{ pair: true }, "bashPairBonus"], [{ crowbar: true }, "bashCrowbarBonus"], [{ sizeSteps: 1 }, "bashSizeBonus"], [{ sizeSteps: -1 }, "bashSizePenalty"], [{ spikes: 2 }, "bashSpikePenalty"], [{ strMod: 1 }, "bashStrengthFactor"]]) {
      assert.deepEqual(doors.bashPlan({ target: TARGET, ...o }).missing, [key], `${key} applies once its input is in play`);
    }
    rigRoll(9);
    assert.equal((await doors.bashDoor(wall, { actor: basher })).ok, true, "with only the band and the rebound imported a plain bash is thrown");
    assert.equal((await doors.bashDoor(wall, { actor: basher, crowbar: true })).reason, "missing");
    assert.deepEqual(await doors.spikeDoor(wall, basher), { ok: false, reason: "missing", missing: ["doorSpikeMax"] }, "no limit imported: no spike is hammered");
    globalThis.Roll = spyRoll;
    basher.system.scores.str.mod = 1;
    importDoors();

    /* --- a creature with no Dungeonbashing throw has no bash, and a null actor none --- */
    const beast = await ActorMock.create({ name: "Beast", type: "monster", system: { hp: { value: 5, max: 5 }, scores: { str: { mod: 1 } } } });
    assert.deepEqual([(await doors.bashDoor(wall, { actor: beast })).reason, (await doors.bashDoor(wall, { actor: null })).reason], ["noThrow", "noThrow"]);
    assert.equal(await doors.bashThrow(null), null);

    /* --- a batter charges the basher's formation, and only that one --- */
    wall.ds = 0; // an earlier bash that succeeded opened it
    const unpicked = await doors.batterDoor(wall, basher);
    assert.deepEqual([unpicked.ok, unpicked.reason, wall.ds], [false, "noRow", 0], "a door with no row picked is not battered");
    await doors.setDoorTraits(wall, { kind: "1:Door A" });
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
    assert.deepEqual([plan.ok, plan.count, plan.unit, plan.tool, plan.rounds], [true, 2, "turn", "mattock", 2 * ROUNDS_PER_TURN], "the row's time and tool, as imported");
    const turnsBefore = onlyFormation().clock.turnsTotal;
    wall.ds = 0;
    const r = await doors.batterDoor(wall, basher);
    await drain();
    assert.equal(r.spent, plan.rounds);
    assert.equal(onlyFormation().clock.turnsTotal, turnsBefore + plan.count, "the formation's clock advanced by the row's turns");
    assert.equal(wall.ds, 1);

    notices.length = 0;
    wall.ds = 0;
    await DoorApp.DEFAULT_OPTIONS.actions.batter.call(app);
    await drain();
    assert.match(notices.at(-1)[1], /batteredDown.*count.*2/, "the notice states the time spent");
    assert.equal(onlyFormation().clock.turnsTotal, turnsBefore + 2 * plan.count);

    // A row counted in rounds spends rounds, not turns.
    await doors.setDoorTraits(wall, { kind: "3:Door B" });
    const roundsPlan = doors.batterPlan(wall);
    assert.deepEqual([roundsPlan.count, roundsPlan.unit, roundsPlan.tool, roundsPlan.rounds], [5, "round", "adze", 5]);
    const absRounds = (c) => c.turnsTotal * ROUNDS_PER_TURN + (c.roundsPartial ?? 0);
    const roundsBefore = absRounds(onlyFormation().clock);
    wall.ds = 0;
    const byRounds = await doors.batterDoor(wall, basher);
    await drain();
    assert.equal(byRounds.spent, 5, "five rounds are spent");
    const clock = onlyFormation().clock;
    assert.equal(absRounds(clock), roundsBefore + 5);
    assert.equal(clock.turnsTotal, turnsBefore + 2 * plan.count + Math.floor(5 / ROUNDS_PER_TURN), "the round count converts at the turn's length");

    await doors.setDoorTraits(wall, { kind: "2:Door B" });
    const solid = await doors.batterDoor(wall, basher);
    assert.deepEqual([solid.ok, solid.reason], [false, "tooSolid"], "a row whose notes give no time spends nothing");
    assert.equal(onlyFormation().clock.turnsTotal, turnsBefore + 2 * plan.count + Math.floor(5 / ROUNDS_PER_TURN));
    assert.equal((await app._prepareContext()).batter.tooSolid, true, "the window refuses it, naming nothing missing");

    await model.disband(model.getFormation(id));
    await drain();

    /* --- a secret door is shown by one write of `door`, on a GM client only --- */
    const makeWall = (door, extra = {}) => {
      const updates = [];
      return {
        door,
        ds: 2,
        flags: { [MODULE_ID]: { door: { kind: "iron", spikes: 3 } } },
        updates,
        async update(patch) {
          updates.push(patch);
          Object.assign(this, patch);
          return this;
        },
        ...extra,
      };
    };
    const secret = makeWall(2);
    assert.deepEqual(await doors.revealSecretDoor(secret), { ok: true, revealed: true }, "a secret door is revealed");
    assert.deepEqual(secret.updates, [{ door: 1 }], "the one write is the door type and nothing else");
    assert.equal(secret.ds, 2, "the locked state stays");
    assert.deepEqual(secret.flags[MODULE_ID].door, { kind: "iron", spikes: 3 }, "the module's door flag stays");
    assert.deepEqual(await doors.revealSecretDoor(secret), { ok: true, revealed: false }, "a second call finds an ordinary door");
    assert.equal(secret.updates.length, 1, "and writes nothing");

    const ordinary = makeWall(1);
    assert.deepEqual(await doors.revealSecretDoor(ordinary), { ok: true, revealed: false });
    assert.equal(ordinary.updates.length, 0, "an ordinary door is not written");

    const plain = makeWall(0);
    assert.deepEqual(await doors.revealSecretDoor(plain), { ok: false, reason: "notADoor" });
    assert.equal(plain.updates.length, 0, "a plain wall is not written");
    assert.deepEqual(await doors.revealSecretDoor(null), { ok: false, reason: "noWall" });

    const gmSeat = game.user;
    game.user = game.users.get("PL1");
    try {
      const hidden = makeWall(2);
      assert.deepEqual(await doors.revealSecretDoor(hidden), { ok: false, reason: "notGM" }, "a player's client refuses");
      assert.equal(hidden.updates.length, 0, "and writes nothing");
      assert.equal(hidden.door, 2);
    } finally {
      game.user = gmSeat;
    }
  } finally {
    globalThis.Roll = priorRoll;
    canvas.tokens.controlled = priorControlled;
    if (!hadSpeaker) delete ChatMessage.getSpeaker;
    if (!hadExpand) delete foundry.utils.expandObject;
  }
});

await scenario("the door window: one per door, the basher is the selected token, partners are the party's, tooltips carry their pages", async () => {
  const doors = await import("../scripts/formation/doors.mjs");
  const { default: DoorApp, doorWindowId, openDoorApp, partnerActors } = await import("../scripts/formation/door-app.mjs");
  const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
  const { default: Handlebars } = await import("handlebars");
  const fs = await import("node:fs");
  const lang = JSON.parse(fs.readFileSync("lang/en.json", "utf8"));

  // INVENTED figures, registered the way an import registers them; one carries an invented page.
  const BASH = {
    bashStrengthFactor: 3, bashPairBonus: 5, bashCrowbarBonus: 7, bashSizeBonus: 6, bashSizePenalty: 9,
    bashSpikePenalty: 11, doorSpikeMax: 6, bashBotchBand: 2, bashReboundDamage: 3,
  };
  const GRID = [{ ordinal: 1, label: "Door A", batter: { count: 2, unit: "turn", tool: "mattock" } }];
  const STR_PAGE = "TEST p. 9";
  const importDoors = (doc = { tables: { doors: GRID, ...BASH }, cites: { bashStrengthFactor: STR_PAGE } }) => {
    unregisterTable("formation", { priority: PRIORITY.WORLD });
    if (doc) registerTable({ id: "formation", ...doc }, { priority: PRIORITY.WORLD, source: "test" });
  };
  const wallOf = (id, sceneId) => ({
    id, parent: { id: sceneId }, door: 1, ds: 0, flags: {},
    getFlag(ns, key) { return this.flags[ns]?.[key]; },
    async setFlag(ns, key, value) { (this.flags[ns] ??= {})[key] = { ...(this.flags[ns][key] ?? {}), ...foundry.utils.deepClone(value) }; return this; },
    async update(patch) { Object.assign(this, patch); return this; },
  });
  const tokenOf = (id, actor, name = actor?.name) => ({ id, name, actor });
  const render = (file, ctx) => Handlebars.compile(fs.readFileSync(`templates/formation/${file}`, "utf8"))({ partId: "p", ...ctx });

  Handlebars.registerHelper("localize", (k) => String(k));
  Handlebars.registerHelper("checked", (v) => (v ? "checked" : ""));
  const priorControlled = canvas.tokens.controlled;
  const priorModules = game.modules.get;
  const priorInstances = foundry.applications.instances;
  const priorDebounce = foundry.utils.debounce;
  try {
    await game.settings.set(MODULE_ID, "formations", {}); // isolate
    importDoors();
    const basher = await member("Win Basher");
    const mate = await member("Win Mate");
    const stranger = await member("Win Stranger"); // on the scene, in no party
    const elsewhere = await member("Win Elsewhere"); // in another party
    const other = await member("Win Other");
    const beast = await ActorMock.create({ name: "Win Beast", type: "monster", system: { hp: { value: 5, max: 5 }, scores: { str: { mod: 1 } } } });
    basher.system.adventuring.dungeonbashing = 15;
    await drain();
    let party = await model.createFormation("Win Party");
    party = await model.addMember(model.getFormation(party.id), basher, null);
    party = await model.addMember(model.getFormation(party.id), mate, null);
    let party2 = await model.createFormation("Win Party Two");
    party2 = await model.addMember(model.getFormation(party2.id), elsewhere, null);
    party2 = await model.addMember(model.getFormation(party2.id), other, null);
    await drain();
    const setScene = async (id, sceneId) => {
      const all = foundry.utils.deepClone(game.settings.get(MODULE_ID, "formations"));
      all[id].sceneId = sceneId;
      await game.settings.set(MODULE_ID, "formations", all);
      await drain();
    };
    const wallA = wallOf("wallA1", "sceneS1");
    const wallB = wallOf("wallB1", "sceneS1");

    /* --- one window per door --- */
    assert.notEqual(doorWindowId(wallA), doorWindowId(wallB), "two doors take two ids");
    assert.ok(doorWindowId(wallA).includes("wallA1") && doorWindowId(wallA).includes("sceneS1"), "the id is built from the scene and the wall");
    assert.equal(doorWindowId(wallA), doorWindowId(wallOf("wallA1", "sceneS1")), "one door always takes the same id");
    assert.equal(new DoorApp(wallA).options.id, doorWindowId(wallA), "the window carries it");
    assert.equal(DoorApp.DEFAULT_OPTIONS.id, undefined, "no fixed id remains on the class");
    const fronted = [];
    const standing = { render: (o) => { fronted.push(["render", o]); return Promise.resolve(); }, bringToFront: () => fronted.push(["front"]) };
    foundry.applications.instances = new Map([[doorWindowId(wallA), standing]]);
    await openDoorApp(wallA);
    assert.deepEqual(fronted, [["render", { force: true }], ["front"]], "reopening a door fronts its window and makes no second");

    /* --- the basher is the selected token, captured at render --- */
    canvas.tokens.controlled = [tokenOf("tokB", basher)];
    const app = new DoorApp(wallA);
    let ctx = await app._prepareContext();
    assert.deepEqual([ctx.actorName, app.basher === basher, ctx.refusal], ["Win Basher", true, null], "the window names the selected token's actor");
    canvas.tokens.controlled = [tokenOf("tokM", mate)];
    assert.equal(app.basher, basher, "a new selection changes nothing until the window draws again");
    chat.length = 0;
    await DoorApp.DEFAULT_OPTIONS.actions.spike.call(app);
    assert.match(String(chat.at(-1)?.content), /Win Basher/, "a press acts for the basher the window showed");
    ctx = await app._prepareContext();
    assert.deepEqual([ctx.actorName, app.basher === mate], ["Win Mate", true], "and a draw follows the selection");

    /* --- the window draws again when the selection changes --- */
    foundry.utils.debounce = (fn) => fn;
    const drawn = [];
    const watched = new DoorApp(wallA);
    watched.render = () => { drawn.push(canvas.tokens.controlled[0]?.id ?? null); return watched; };
    watched.rendered = true;
    canvas.tokens.controlled = [tokenOf("tokB", basher)];
    await watched._prepareContext();
    await watched._onFirstRender({}, {});
    Hooks.callAll("controlToken", null, true);
    assert.deepEqual(drawn, [], "the same token controlled again draws nothing");
    canvas.tokens.controlled = [tokenOf("tokM", mate)];
    Hooks.callAll("controlToken", null, true);
    assert.deepEqual(drawn, ["tokM"], "a different token draws the window once");
    await watched._onClose({});
    canvas.tokens.controlled = [tokenOf("tokB", basher)];
    Hooks.callAll("controlToken", null, true);
    assert.deepEqual(drawn, ["tokM"], "a closed window no longer follows the selection");
    foundry.utils.debounce = priorDebounce;

    /* --- partners: the party's other members who are on this scene --- */
    const partyId = onlyFormationHolding(basher)[0].id;
    canvas.tokens.controlled = [tokenOf("tokB", basher)];
    assert.deepEqual(partnerActors(wallA, basher).map((a) => a.name), ["Win Mate"], "the party's other member, and nobody else: not the stranger, not the other party's");
    ctx = await app._prepareContext();
    assert.deepEqual(ctx.partners.map((p) => p.name), ["Win Mate"], "the window lists the same");
    await setScene(partyId, "sceneS1");
    assert.deepEqual(partnerActors(wallA, basher).map((a) => a.name), ["Win Mate"], "a party on the door's scene lends its members");
    await setScene(partyId, "sceneOther");
    assert.deepEqual(partnerActors(wallA, basher), [], "a party on another scene lends none");
    await setScene(partyId, "sceneS1");
    assert.deepEqual(partnerActors(wallA, stranger), [], "a basher no party holds has no partner");
    assert.deepEqual(partnerActors(wallA, null), [], "and neither has nobody");
    // A partner the form named who is no longer one of the basher's is not applied.
    app.opts.partnerId = mate.id;
    ctx = await app._prepareContext();
    assert.equal(ctx.plan.parts.some((p) => p.key === "pair"), true, "the named partner adds the partner term");
    canvas.tokens.controlled = [tokenOf("tokE", elsewhere)];
    ctx = await app._prepareContext();
    assert.deepEqual([ctx.partners.map((p) => p.name), ctx.plan.parts.some((p) => p.key === "pair")], [["Win Other"], false], "a new basher keeps no partner of the old party");
    app.opts.partnerId = "";

    /* --- a selected token that cannot bash is refused on the window --- */
    canvas.tokens.controlled = [tokenOf("tokX", null, "Win Ghost")];
    ctx = await app._prepareContext();
    assert.deepEqual([ctx.actorName, ctx.refusal, ctx.canBash], ["Win Ghost", "ACKS-FORMATION.doors.refuse.noThrow", false], "a token with no actor is refused, by name");
    assert.match(render("door.hbs", ctx), /refuse\.noThrow/, "and the refusal is on the window");
    canvas.tokens.controlled = [tokenOf("tokY", beast)];
    ctx = await app._prepareContext();
    assert.deepEqual([ctx.refusal, ctx.canBash, ctx.needs], ["ACKS-FORMATION.doors.refuse.noThrow", false, null], "a monster's token is refused");
    canvas.tokens.controlled = [];
    ctx = await app._prepareContext();
    assert.deepEqual([ctx.actorName, ctx.refusal, ctx.canBash], ["ACKS-FORMATION.doors.noToken", null, false], "nothing selected says so and refuses nothing");

    /* --- figures imported: each part names where its figure came from --- */
    canvas.tokens.controlled = [tokenOf("tokB", basher)];
    app.opts = { crowbar: true, sizeSteps: 2, extra: 0, partnerId: mate.id };
    ctx = await app._prepareContext();
    assert.equal(ctx.plan.ready, true);
    const byLabel = Object.fromEntries(ctx.parts.map((p) => [p.label, p]));
    assert.deepEqual(Object.keys(byLabel), ["ACKS-FORMATION.doors.throw", "ACKS-FORMATION.doors.mod.str", "ACKS-FORMATION.doors.mod.pair", "ACKS-FORMATION.doors.mod.crowbar", "ACKS-FORMATION.doors.mod.size"], "the throw, then each term in play");
    assert.match(byLabel["ACKS-FORMATION.doors.throw"].tip, /tip\.throw.*Win Basher.*page\.throw/, "the throw is the character's own, with its chapter");
    assert.match(byLabel["ACKS-FORMATION.doors.mod.str"].tip, new RegExp(`"count":1,"unit":3,"page":"${STR_PAGE}"`), "a term shows its count, its imported figure and the page the import recorded");
    assert.match(byLabel["ACKS-FORMATION.doors.mod.crowbar"].tip, /"unit":7,"page":"ACKS-FORMATION.doors.page.bash"/, "a term with no recorded page carries the module's own reference");
    assert.ok(ctx.needsTip.includes(STR_PAGE) && ctx.needsTip.includes("Win Basher"), "the needs figure lists its parts with the page and the actor");
    assert.equal(ctx.needsTip.split(" · ").length, ctx.parts.length, "one segment for each part");
    const plain = await (async () => { const keep = app.opts; app.opts = { crowbar: false, sizeSteps: 0, extra: 0, partnerId: "" }; try { return await app._prepareContext(); } finally { app.opts = keep; } })();
    assert.equal(plain.parts.length, 2, "the throw and the one term in play");
    assert.equal(plain.parts.reduce((sum, p) => sum + Number.parseInt(p.display, 10), 0), plain.needs, "the throw and the terms as shown, each as what it does to the number needed, add down to the needs figure");
    const shown = render("door.hbs", ctx);
    assert.equal((shown.match(/data-tooltip-text/g) ?? []).length >= ctx.parts.length + 4, true, "each part has its own tooltip beside the figures");
    assert.equal(/\btitle=/.test(shown), false, "no title attribute");
    assert.equal(/\bid="p-kind"/.test(shown) && /\bid="p-partner"/.test(shown), true, "ids are seeded by the part, so two windows share none");
    assert.equal(ctx.spikeTip.includes(`"page":"ACKS-FORMATION.doors.page.bash"`), true, "the spike count reads the most a door holds, with the page");
    const foot = render("door-footer.hbs", ctx);
    assert.equal(/data-action="bash"[^>]*>/.exec(foot)[0].includes("disabled"), false, "Bash it is live on a ready plan");
    assert.equal(/data-action="batter"[^>]*>/.exec(foot)[0].includes("disabled"), true, "Batter is not live with no construction picked");
    await doors.setDoorTraits(wallA, { kind: "1:Door A" });
    ctx = await app._prepareContext();
    assert.equal(ctx.batterTip.includes("tip.row") && ctx.batterTip.includes(`"ordinal":1`), true, "Batter cites its row");
    assert.equal(/data-action="batter"[^>]*>/.exec(render("door-footer.hbs", ctx))[0].includes("disabled"), false, "and is live once a row with a time is picked");

    /* --- nothing imported: blank, disabled, the page alone --- */
    importDoors(null);
    app.opts = { crowbar: false, sizeSteps: 0, extra: 0, partnerId: "" };
    ctx = await app._prepareContext();
    assert.deepEqual([ctx.needs, ctx.canBash, ctx.parts.length, ctx.needsTip, ctx.maxSpikes, ctx.spikeTip], [null, false, 0, "ACKS-FORMATION.doors.page.bash", "—", "ACKS-FORMATION.doors.page.bash"], "needs blank, Bash disabled, the tooltip the page reference alone");
    assert.equal(ctx.kinds.length, 1, "no door rows to pick");
    assert.equal(ctx.kindTip, "ACKS-FORMATION.doors.page.grid", "the construction's tooltip is its page alone");
    assert.equal(ctx.refusal, null, "no message says anything is missing");
    const blankFoot = render("door-footer.hbs", ctx);
    assert.equal([...blankFoot.matchAll(/<button[^>]*>/g)].every((m) => m[0].includes("disabled")), true, "both footer buttons are disabled");
    assert.match(render("door.hbs", ctx), /acks-extras-door-needs-figure">—</, "the needs figure is blank");
    assert.equal(lang["ACKS-FORMATION.doors.page.bash"], "RR p. 267", "the bash reference is the page's");
    assert.equal(lang["ACKS-FORMATION.doors.page.grid"], "RR p. 266", "the door grid reference is the page's");
    assert.equal(lang["ACKS-FORMATION.doors.spikeHint"].includes("most a door holds"), true, "the spike count's tooltip");

    /* --- the picture frame is the icon module's glyph, and absent without it --- */
    assert.equal(ctx.glyph, "modules/game-icons-net/blacktransparent/wooden-door.svg", "the glyph is referenced by path from the icon module");
    assert.match(render("door.hbs", ctx), /acks-extras-door-art/, "the frame is drawn with the glyph");
    game.modules.get = () => null;
    ctx = await app._prepareContext();
    assert.equal(ctx.glyph, null, "without the module there is no glyph");
    assert.equal(/acks-extras-door-art/.test(render("door.hbs", ctx)), false, "and no frame");

    await model.disband(model.getFormation(partyId));
    await model.disband(model.getFormation(party2.id));
    await drain();
  } finally {
    unregisterTable("formation", { priority: PRIORITY.WORLD });
    canvas.tokens.controlled = priorControlled;
    game.modules.get = priorModules;
    foundry.applications.instances = priorInstances;
    foundry.utils.debounce = priorDebounce;
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

// The hand counts the two scenarios below read stand in for the equipment feature's;
// the loadout's own reading of lights and the kit is tools/test-equipment.mjs.
await scenario("taking the mapper role needs the hands, and the kit is listed at them", async () => {
  const scribe = await member("Scribe");
  await drain();
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Kit Party");
  formation = await model.addMember(formation, scribe, null);
  await drain();
  const id = onlyFormation().id;
  await scribe.createEmbeddedDocuments("Item", [
    { name: "Quill, writing", type: "item", system: { quantity: 1 } },
    { name: "Parchment", type: "item", system: { quantity: 1 } },
  ]);
  const roles = () => onlyFormation().members.find((m) => m.actorId === scribe.id)?.roles ?? [];
  const nameOf = (itemId) => scribe.items.find((i) => i.id === itemId)?.name ?? null;

  // Stand in for the equipment feature's room count: two hands less what is drawn.
  globalThis.acksExtras.equipment = {
    spareHands: (actor) => Math.max(0, 2 - (actor.system.__handsUsed ?? 0)),
    heldHandsClause: () => "",
  };
  try {
    // A hand short — a sword drawn — the kit cannot be taken up: refused, as a
    // light is, and nothing is in hand for the role.
    scribe.system.__handsUsed = 1;
    notices.length = 0;
    await model.toggleRole(model.getFormation(id), scribe.id, "mapper");
    await drain();
    assert.ok(!roles().includes("mapper"), "a hand short, the role is refused");
    assert.ok(notices.some(([lvl, m]) => lvl === "warn" && /noRoleHands/.test(String(m))), "and the refusal names the hands");
    assert.deepEqual(model.kitInHand(scribe.id), [], "no role, no kit in hand");

    // Hands empty, the role goes on, and the kit is in hand quill first.
    scribe.system.__handsUsed = 0;
    await model.toggleRole(model.getFormation(id), scribe.id, "mapper");
    await drain();
    assert.ok(roles().includes("mapper"), "with the hands free the role is taken");
    const ids = model.kitInHand(scribe.id);
    assert.equal(ids.length, 2, "both pieces of the kit are in hand");
    assert.match(nameOf(ids[0]), /quill/i, "the quill takes the first hand");
    assert.match(nameOf(ids[1]), /parchment/i, "the parchment the second");

    // Setting the role down is never gated, and empties the hands of the kit.
    scribe.system.__handsUsed = 2;
    await model.toggleRole(model.getFormation(id), scribe.id, "mapper");
    await drain();
    assert.ok(!roles().includes("mapper"), "the role is set down whatever the hands hold");
    assert.deepEqual(model.kitInHand(scribe.id), [], "and the kit leaves the hands");

    // An unreadable count skips the check rather than refusing.
    globalThis.acksExtras.equipment.spareHands = () => { throw new Error("equipment exploded"); };
    await model.toggleRole(model.getFormation(id), scribe.id, "mapper");
    await drain();
    assert.ok(roles().includes("mapper"), "a hand count that throws does not refuse the role");
  } finally {
    delete globalThis.acksExtras.equipment;
  }
  await model.disband(model.getFormation(id));
  await drain();
});

await scenario("a torch already in hand is lit where it is: no hand emptied, nothing off the stack", async () => {
  const bearer = await member("Bearer");
  await drain();
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Held Torch Party");
  formation = await model.addMember(formation, bearer, null);
  await drain();
  const id = onlyFormation().id;
  await game.settings.set(MODULE_ID, "lightItemEnforcement", "require");
  // A readied torch (a weapon, no stock to count) drawn beside a dagger, and
  // the stack it was readied from: both hands full, and the torch is one of them.
  const [torch] = await bearer.createEmbeddedDocuments("Item", [
    { name: "Torch", type: "weapon", system: { equipped: true } },
    { name: "Torches (6)", type: "item", system: { quantity: 5 } },
  ]);
  bearer.system.__handsUsed = 2;
  const stack = () => bearer.items.find((i) => /torches/i.test(i.name)).system.quantity;
  const calls = { clearHands: 0, grantGear: 0, consume: 0 };
  globalThis.acksExtras.equipment = {
    spareHands: (actor) => Math.max(0, 2 - (actor.system.__handsUsed ?? 0)),
    roomForLight: (actor, type) => type === "torch" || Math.max(0, 2 - (actor.system.__handsUsed ?? 0)) > 0,
    unlitInHand: (actor, type) => (type === "torch" ? torch : null),
    async grantGear() { calls.grantGear++; return []; },
    async clearHands(actor) { calls.clearHands++; actor.system.__handsUsed -= 1; return { handsSpare: 1, released: [{ name: "Dagger" }] }; },
    async consumeItem(item, n) { calls.consume++; await item.update({ "system.quantity": item.system.quantity - n }); },
  };
  try {
    // The player path: lit on the torch in hand, through the hands check that
    // a spare-hand count alone would refuse.
    await engine.addLight(model.getFormation(id), "torch", bearer.id);
    await drain();
    assert.equal(onlyFormation().lights.length, 1, "the held torch lights with no spare hand");
    assert.equal(stack(), 5, "the stack is not spent for a torch already in hand");
    assert.equal(calls.consume, 0, "and nothing was consumed");

    // The Judge's path, with the same torch drawn and unlit again: nothing
    // supplied, no hand emptied — emptying one sheathed the torch itself.
    await engine.removeLight(model.getFormation(id), onlyFormation().lights[0].id);
    await drain();
    await engine.addLight(model.getFormation(id), "torch", bearer.id, { override: true });
    await drain();
    assert.equal(onlyFormation().lights.length, 1, "the Judge's light is lit on the held torch");
    assert.equal(calls.clearHands, 0, "no hand was emptied");
    assert.equal(calls.grantGear, 0, "no gear was supplied");
    assert.equal(stack(), 5, "the stack is still whole");
    assert.equal(bearer.system.__handsUsed, 2, "the torch and the dagger are both still in hand");

    // With no readied torch at all the stack pays as before.
    await engine.removeLight(model.getFormation(id), onlyFormation().lights[0].id);
    await drain();
    bearer.items.delete(torch.id);
    globalThis.acksExtras.equipment.unlitInHand = () => null;
    globalThis.acksExtras.equipment.roomForLight = () => true;
    await engine.addLight(model.getFormation(id), "torch", bearer.id);
    await drain();
    assert.equal(onlyFormation().lights.length, 1, "a torch from the stack lights");
    assert.equal(stack(), 4, "and the stack pays for it");
  } finally {
    delete globalThis.acksExtras.equipment;
  }
  await model.disband(model.getFormation(id));
  await drain();
}); // held torch

// Last on purpose: the seat election is module-global, and joining it ends the
// harness's headless lead for every scenario after this one.
await scenario("a party actor made while the GM window is still joining its seat is adopted once the election settles", async () => {
  const { joinSeatElection, automationSettled, isLeadClient } = await import("../scripts/lib/automation-client.mjs");
  const listeners = {};
  // The server echoes a seat message to every socket of the user, this one's included.
  game.socket = {
    connected: true,
    on: (event, fn) => (listeners[event] ??= []).push(fn),
    emit: (channel, message) => void sleep().then(() => (listeners[channel] ?? []).forEach((fn) => fn(message, game.user.id))),
  };
  game.view = "game";
  globalThis.window ??= { addEventListener() {} };
  joinSeatElection({ channel: `module.${MODULE_ID}` });
  assert.equal(isLeadClient(), false, "a window still joining does not lead yet");
  const partyActor = await ActorMock.create({ name: "Joining Party", type: `${MODULE_ID}.party` });
  await drain();
  const adopted = () => Object.values(readFormations()).find((f) => f.actorId === partyActor.id);
  assert.equal(adopted(), undefined, "nothing adopts it while the seat is joining");
  await automationSettled();
  await drain();
  assert.equal(isLeadClient(), true, "the lone window leads once settled");
  const record = adopted();
  assert.ok(record, "the create hook adopts it once the election settles");
  await model.deleteFormationRecord(record.id);
  await partyActor.delete();
  await drain();
});

await scenario("turn plan: one spend a turn, one card for the searchers, a player locks only their own, a fight cancels on one card", async () => {
  const plan = await import("../scripts/formation/turn-plan.mjs");
  const searcher = await member("Plan Searcher");
  const owned = await member("Plan Owned");
  const watcher = await member("Plan Watcher");
  owned.ownership = { default: 0, PL1: 3 };
  await drain();
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Plan Party");
  for (const [n, actor] of [searcher, owned, watcher].entries()) {
    const [token] = await scene.createEmbeddedDocuments("Token", [{ name: actor.name, actorId: actor.id, x: 900 + n * 100, y: 900 }]);
    formation = await model.addMember(model.getFormation(formation.id), actor, token);
  }
  await drain();
  const id = onlyFormation().id;
  const party = game.actors.get(onlyFormation().actorId);
  assert.ok(party, "the party has its actor, which holds the plan");
  const stored = () => party.getFlag(MODULE_ID, "turnPlan") ?? {};

  // The Judge locks for any member; a player for their own, and only that.
  assert.equal((await plan.lockPlan(model.getFormation(id), { actorId: searcher.id, key: "searchMethodical", by: "GM1" })).ok, true);
  const gmUser = game.user;
  game.user = game.users.get("PL1");
  try {
    await requests.requestPartyAction(id, "plan", { actorId: owned.id, key: "searchMethodical" });
    await requests.requestPartyAction(id, "plan", { actorId: watcher.id, key: "searchMethodical" });
  } finally {
    game.user = gmUser;
  }
  await drain();
  assert.deepEqual(Object.keys(stored()).sort(), [searcher.id, owned.id].sort(), "the player's own member locked; the one they do not own did not");
  assert.equal(stored()[owned.id].by, "PL1", "the entry names the attested sender");

  // A moved party locks nothing.
  {
    const f = model.getFormation(id);
    f.clock.movedThisTurn = true;
    await model.updateFormation(f);
    assert.equal(plan.planRefusal(model.getFormation(id), { actorId: watcher.id, key: "listen" })?.reason, "moved");
    const g = model.getFormation(id);
    g.clock.movedThisTurn = false;
    await model.updateFormation(g);
  }

  // The turn: the clock spends once, the two searchers roll on one card, and the plan is stamped.
  const turns0 = onlyFormation().clock.turnsTotal;
  const chat0 = chat.length;
  await plan.resolvePlanTurn(model.getFormation(id));
  await drain();
  assert.equal(onlyFormation().clock.turnsTotal, turns0 + 1, "one turn spent, not two");
  const posted = chat.slice(chat0).map((m) => String(m.content ?? ""));
  const searchCards = posted.filter((c) => c.includes("ACKS-FORMATION.rolls.searchMethodical"));
  assert.equal(searchCards.length, 1, "one card for the searchers");
  assert.ok(searchCards[0].includes("Plan Searcher") && searchCards[0].includes("Plan Owned"), "both searchers roll on it");
  assert.ok(!searchCards[0].includes("Plan Watcher"), "the member keeping watch does not");
  assert.equal(posted.filter((c) => c.includes("chat.turnAdvanced")).length, 1, "one turn card");
  assert.ok(Object.values(stored()).every((e) => e.resolvedTurn === turns0 + 1), "every resolved entry is stamped with the turn");

  // The next turn re-rolls nothing and drops what was done.
  const chat1 = chat.length;
  await plan.resolvePlanTurn(model.getFormation(id));
  await drain();
  assert.equal(chat.slice(chat1).filter((m) => String(m.content ?? "").includes("ACKS-FORMATION.rolls.searchMethodical")).length, 0, "no search re-rolled");
  assert.deepEqual(stored(), {}, "the done entries leave the plan, and the flag goes with them");

  // A fight: the single-turn entry is cancelled, the multi-turn one keeps its progress, on one card.
  await plan.lockPlan(model.getFormation(id), { actorId: watcher.id, key: "listen", by: "GM1" });
  await party.update({ [`flags.${MODULE_ID}.turnPlan`]: { ...stored(), [searcher.id]: { key: "searchMethodical", option: null, remaining: 2, turns: 3, by: "GM1" } } });
  const chat2 = chat.length;
  const cut = await plan.cancelPlanForCombat(model.getFormation(id));
  assert.deepEqual(cut.cancelled.map((c) => c.actorId), [watcher.id]);
  assert.deepEqual(cut.kept.map((c) => c.actorId), [searcher.id]);
  assert.equal(chat.length - chat2, 1, "one card for the interruption");
  assert.ok(String(chat.at(-1).content).includes("plan.combat.title") && !chat.at(-1).whisper?.length, "a public group note");
  assert.deepEqual(Object.keys(stored()), [searcher.id], "the kept entry stays");
  assert.equal(stored()[searcher.id].remaining, 2, "with its progress");

  // A move ends it; clearing a row empties the flag.
  const chat3 = chat.length;
  await plan.cancelPlanForMove(model.getFormation(id));
  assert.deepEqual(stored(), {}, "a move cancels the multi-turn entry too");
  assert.equal(chat.length - chat3, 1, "and says so once");
  await plan.cancelPlanForCombat(model.getFormation(id));
  assert.equal(chat.length - chat3, 1, "a fight over an empty plan posts nothing");
  await plan.lockPlan(model.getFormation(id), { actorId: watcher.id, key: "listen", by: "GM1" });
  await plan.unlockPlan(model.getFormation(id), watcher.id);
  assert.equal(party.getFlag(MODULE_ID, "turnPlan"), undefined, "an emptied plan removes the flag");

  await model.disband(model.getFormation(id));
  await drain();
});
await scenario("turn plan: a round-length entry resolves on the Round press or once on the next Turn, spends no time, and a turn never rolls it twice", async () => {
  const plan = await import("../scripts/formation/turn-plan.mjs");
  const lib = await import("../scripts/lib/turn-activities.mjs");
  const seen = [];
  const off = lib.registerTurnActivity({
    key: "qaRoundJob",
    pace: "hasty",
    length: "round",
    label: "QA round job",
    options: () => [{}],
    turns: () => 1,
    resolve: (actor) => { seen.push(actor.id); return "done"; },
  });
  try {
    const hasty = await member("Round Hasty");
    const slow = await member("Round Slow");
    await drain();
    await game.settings.set(MODULE_ID, "formations", {}); // isolate
    let formation = await model.createFormation("Round Party");
    for (const [n, actor] of [hasty, slow].entries()) {
      const [token] = await scene.createEmbeddedDocuments("Token", [{ name: actor.name, actorId: actor.id, x: 900 + n * 100, y: 900 }]);
      formation = await model.addMember(model.getFormation(formation.id), actor, token);
    }
    await drain();
    const id = onlyFormation().id;
    const party = game.actors.get(onlyFormation().actorId);
    const stored = () => party.getFlag(MODULE_ID, "turnPlan") ?? {};
    const lockBoth = async () => {
      assert.equal((await plan.lockPlan(model.getFormation(id), { actorId: hasty.id, key: "qaRoundJob", by: "GM1" })).ok, true);
      assert.equal((await plan.lockPlan(model.getFormation(id), { actorId: slow.id, key: "searchMethodical", by: "GM1" })).ok, true);
    };

    // The Round press: the round-length entry resolves at once and is stamped; the turn-length one is untouched; no clock is spent.
    await lockBoth();
    const t0 = onlyFormation().clock.turnsTotal;
    const rounds0 = onlyFormation().clock.roundsPartial;
    const chat0 = chat.length;
    const out = await plan.resolvePlanRound(model.getFormation(id));
    await drain();
    assert.deepEqual(seen, [hasty.id], "the round-length entry resolved");
    assert.deepEqual(out.results.map((r) => [r.actorId, r.key, r.status]), [[hasty.id, "qaRoundJob", "resolved"]]);
    assert.equal(onlyFormation().clock.turnsTotal, t0, "no turn spent");
    assert.equal(onlyFormation().clock.roundsPartial, rounds0, "no round spent by the resolver itself");
    assert.equal(stored()[hasty.id].resolvedTurn, t0, "stamped at the clock's current turn");
    assert.equal(stored()[slow.id].resolvedTurn, undefined, "the turn-length entry is untouched");
    assert.equal(stored()[slow.id].remaining, 1);
    assert.equal(chat.slice(chat0).filter((m) => String(m.content ?? "").includes("ACKS-FORMATION.rolls.searchMethodical")).length, 0, "no search rolled by a Round press");
    await plan.resolvePlanRound(model.getFormation(id));
    assert.equal(seen.length, 1, "a second Round press resolves nothing");

    // The Turn after it: the search rolls, the round entry is not resolved again and is dropped.
    await plan.resolvePlanTurn(model.getFormation(id));
    await drain();
    assert.equal(seen.length, 1, "the Turn does not resolve the round entry a second time");
    assert.equal(onlyFormation().clock.turnsTotal, t0 + 1);
    assert.ok(!(hasty.id in stored()), "the stamped entry leaves at the next turn");
    assert.equal(stored()[slow.id].resolvedTurn, t0 + 1, "the turn-length entry resolved with the turn");

    // No Round press: the Turn resolves it once, and a further Turn finds nothing.
    await plan.unlockPlan(model.getFormation(id), slow.id);
    await plan.lockPlan(model.getFormation(id), { actorId: hasty.id, key: "qaRoundJob", by: "GM1" });
    const t1 = onlyFormation().clock.turnsTotal;
    const turned = await plan.resolvePlanTurn(model.getFormation(id));
    await drain();
    assert.equal(seen.length, 2, "resolved once, by the Turn");
    assert.equal(turned.round.results.length, 1, "the Turn reports the round resolution beside its own");
    assert.equal(onlyFormation().clock.turnsTotal, t1 + 1, "one turn spent, not two");
    assert.deepEqual(stored(), {}, "the entry was stamped before the turn's count and dropped by it");
    await plan.resolvePlanTurn(model.getFormation(id));
    await drain();
    assert.equal(seen.length, 2, "a further Turn rolls nothing");

    await model.disband(model.getFormation(id));
    await drain();
  } finally {
    off();
  }
});
await scenario("a party save rolls each member's own formula against the stored target, through the shared save throw, with the conditions left out", async () => {
  const save = (target) => ({ blast: { value: target } });
  const roster = {
    hero: { type: "character", name: "Hero", save: { mod: 2 }, wis: 1, saves: save(14), total: 14, statuses: ["hungry"] },
    brute: { type: "character", name: "Brute", save: { mod: -1 }, wis: -2, saves: save(12), total: 10 },
    plain: { type: "character", name: "Plain", save: { mod: 0 }, wis: 0, saves: save(10), total: 10 },
    beast: { type: "monster", name: "Beast", saves: save(15), total: 13 },
    downed: { type: "character", name: "Downed", save: { mod: 4 }, wis: 4, saves: save(9), total: 20, hp: 0 },
    blank: { type: "character", name: "Blank", save: { mod: 4 }, wis: 4, saves: {}, total: 20 },
  };
  const formation = { name: "Test Company", members: [] };
  for (const [id, r] of Object.entries(roster)) {
    const actor = {
      id: `save-${id}`,
      name: r.name,
      type: r.type,
      statuses: new Set(r.statuses ?? []),
      system: { hp: { value: r.hp ?? 5, max: 10 }, saves: r.saves, ...(r.type === "character" ? { save: r.save, scores: { wis: { mod: r.wis } } } : {}) },
    };
    game.actors.set(actor.id, actor);
    formation.members.push({ actorId: actor.id });
  }
  const totals = Object.values(roster).filter((r) => r.hp === undefined && Object.keys(r.saves).length).map((r) => r.total);
  const formulas = [];
  const priorRoll = globalThis.Roll;
  globalThis.Roll = class {
    constructor(formula) {
      this.formula = formula;
    }
    async evaluate() {
      this.total = totals[formulas.length];
      formulas.push(this.formula);
      return this;
    }
  };
  const before = chat.length;
  try {
    await engine.rollPartySave(formation, "blast", { magical: true });
    assert.deepEqual(formulas, ["1d20 + 3", "1d20 - 3", "1d20", "1d20"], "a character's modifier and Wisdom against magic, a monster's none; the down and the targetless do not roll");
    const card = String(chat.at(before).content);
    for (const target of ["14+", "12+", "10+", "15+"]) assert.ok(card.includes(`>${target}<`), `the stored target ${target} is the card's, the conditions' figure left out`);
    assert.equal((card.match(/class="is-success"/g) ?? []).length, 2, "a total at or above its target succeeds");
    assert.equal((card.match(/class="is-failure"/g) ?? []).length, 2);
    assert.equal(chat.at(before).rolls.length, 4, "the card carries every roll");
    assert.ok(card.includes("ACKS-FORMATION.chat.saveMagical"));

    formulas.length = 0;
    await engine.rollPartySave(formation, "blast", { magical: false });
    assert.deepEqual(formulas, ["1d20", "1d20", "1d20", "1d20"], "against the mundane, no modifier is added");
    assert.ok(String(chat.at(-1).content).includes("ACKS-FORMATION.chat.saveMundane"));

    const quiet = chat.length;
    await engine.rollPartySave({ name: "Empty", members: [formation.members.at(-1)] }, "blast");
    assert.equal(chat.length, quiet, "a party with nobody to roll posts nothing");
  } finally {
    globalThis.Roll = priorRoll;
    for (const id of Object.keys(roster)) game.actors.delete(`save-${id}`);
  }
});

/* -------------------------------------------- */
/*  Party presses follow ownership              */
/* -------------------------------------------- */

/** A character carrying the figures a party save reads, owned by the table's player seat or by nobody. */
const pressData = (name, { owned = false } = {}) => ({
  name,
  type: "character",
  ownership: owned ? { default: 0, PL1: 3 } : { default: 0 },
  system: {
    hp: { value: 8, max: 8 },
    details: { level: 2 },
    movementacks: { exploration: 120 },
    movement: { base: 120 },
    encumbrance: { value: 4, max: 20 },
    scores: { str: { mod: 0 }, wis: { mod: 0 } },
    saves: { blast: { value: 12 } },
    save: { mod: 0 },
    adventuring: { listening: 13, searching: 13, dungeonbashing: 13 },
  },
});
const pressMember = async (name, options) => {
  const actor = await ActorMock.create(pressData(name, options));
  actor.statuses = new Set();
  // Core's own test, which a GM passes on every document.
  Object.defineProperty(actor, "isOwner", { get: () => actor.testUserPermission(game.user) });
  await actor.createEmbeddedDocuments("Item", [{ name: "Day Rations", type: "item", system: { quantity: 3 } }]);
  return actor;
};
const rationsOf = (actor) => actor.items.filter((i) => /ration/i.test(i.name))[0].system.quantity;

await scenario("a party save and the rations take an `only` predicate: an actor it refuses is skipped, and without one every member is served", async () => {
  const mine = await pressMember("Only Mine", { owned: true });
  const theirs = await pressMember("Only Theirs");
  const party = { name: "Only Party", members: [mine, theirs].map((a) => ({ actorId: a.id })) };
  const own = (actor) => actor.id === mine.id;
  try {
    let before = chat.length;
    await engine.rollPartySave(party, "blast", { only: own });
    assert.equal(chat.length, before + 1, "one card");
    let card = String(chat.at(-1).content);
    assert.ok(card.includes("Only Mine") && !card.includes("Only Theirs"), "the refused actor has no row");
    assert.equal(chat.at(-1).rolls.length, 1, "and rolls nothing");

    before = chat.length;
    await engine.rollPartySave(party, "blast");
    card = String(chat.at(before).content);
    assert.ok(card.includes("Only Mine") && card.includes("Only Theirs"), "with no predicate every member rolls");

    await engine.consumeRations(party, { only: own });
    assert.deepEqual([rationsOf(mine), rationsOf(theirs)], [2, 3], "only the accepted member's ration is spent");
    card = String(chat.at(-1).content);
    assert.ok(card.includes("Only Mine") && !card.includes("Only Theirs"), "the refused member is neither fed nor reported");

    await engine.consumeRations(party);
    assert.deepEqual([rationsOf(mine), rationsOf(theirs)], [1, 2], "with no predicate every member is fed");
  } finally {
    await mine.delete();
    await theirs.delete();
  }
});

await scenario("the Supplies press spends only what the supply reader calls food: items named for a ration's letters are never decremented, and a member holding nothing else goes hungry", async () => {
  const actor = await ActorMock.create(pressData("Press Lookalike", { owned: true }));
  actor.statuses = new Set();
  const [ring, potion, flask, hunted] = await actor.createEmbeddedDocuments("Item", [
    { name: "Ring of Regeneration", type: "item", system: { quantity: 1 } },
    { name: "Potion of Brilliant Restoration", type: "item", system: { quantity: 2 } },
    { name: "1 flask of holy water", type: "item", system: { quantity: 3 } },
    { name: "Fresh Game", type: "item", system: { quantity: 4 }, flags: { "acks-extras": { foraged: "hunt" } } },
  ]);
  const quantities = () => [ring, potion, flask, hunted].map((i) => i.system.quantity);
  const party = { name: "Lookalike Party", members: [{ actorId: actor.id }] };
  try {
    const before = chat.length;
    await engine.consumeRations(party);
    assert.deepEqual(quantities(), [1, 2, 3, 4], "no lookalike and no hunted game is decremented");
    const card = String(chat.at(before).content);
    assert.ok(card.includes("Press Lookalike") && card.includes("chat.rationsMissing"), "the member is reported hungry");

    const [stamped] = await actor.createEmbeddedDocuments("Item", [{
      name: "Rations, Iron", type: "item", system: { quantity: 2 },
      flags: { "acks-extras": { cookbook: { id: "def.equip.rationsIron", read: { days: 1 } } } },
    }]);
    await engine.consumeRations(party);
    assert.equal(stamped.system.quantity, 1, "an imported ration is the item the press spends");
    assert.deepEqual(quantities(), [1, 2, 3, 4], "and still nothing else");

    // Nothing the page gave: the item names its kind and no size, so it is not spent.
    const [unsized] = await actor.createEmbeddedDocuments("Item", [{
      name: "Rations, Standard", type: "item", system: { quantity: 2 },
      flags: { "acks-extras": { cookbook: { id: "def.equip.rationsStandard" } } },
    }]);
    await stamped.update({ "system.quantity": 0 });
    const heard = chat.length;
    await engine.consumeRations(party);
    assert.equal(unsized.system.quantity, 2, "an unsized ration is left alone");
    assert.ok(String(chat.at(heard).content).includes("chat.rationsMissing"), "and the member is reported without one");
  } finally {
    await actor.delete();
  }
});

/* -------------------------------------------- */
/*  End day spends what it deals                */
/* -------------------------------------------- */

const { runProvisionDay, refillVessels, SURVIVAL_FLAG } = await import("../scripts/formation/provision-day.mjs");

/** An invented unit of food, sized by hand on the item. */
const loafItem = (qty, perUnit = 1) => ({
  name: "Trail Loaf", type: "item", system: { quantity: qty },
  flags: { "acks-extras": { provision: { kind: "food", perUnit } } },
});
/** An invented water vessel, sized by hand: `perUnit` days a vessel. */
const flaskItem = (qty, perUnit) => ({
  name: "Trail Flask", type: "item", system: { quantity: qty },
  flags: { "acks-extras": { provision: { kind: "water", perUnit } } },
});
/** An item that reads as food and has no size. */
const unsizedLoaf = (qty) => ({
  name: "Trail Loaf", type: "item", system: { quantity: qty },
  flags: { "acks-extras": { provision: { kind: "food" } } },
});

/** A party of members carrying the item data given, one list per member; the Judge's seat is taken for the run. */
async function provisionParty(name, packs) {
  const { id, actors } = await isolatedParty(name, ...packs.map((_, i) => `${name} ${i}`));
  const items = [];
  for (const [i, specs] of packs.entries()) items.push(await actors[i].createEmbeddedDocuments("Item", specs));
  return { id, actors, items };
}
const disbandProvisioned = async ({ id, actors }) => {
  const formation = model.getFormation(id);
  if (formation) await model.disband(formation);
  await drain();
  for (const actor of actors) await actor.delete();
  await drain();
};
const heldCards = () => chat.filter((m) => String(m.content).includes("toll.held.title"));

await scenario("the Supplies press spends through the shared consumer: a part-day unit is kept, a member fed is marked for the day, and one with an unsized ration is reported hungry", async () => {
  const party = await provisionParty("Spend Press", [[loafItem(1, 3)], [unsizedLoaf(2)]]);
  const prior = game.user;
  game.user = game.users.get("GM1");
  try {
    const [[loaf], [bare]] = party.items;
    const formation = () => model.getFormation(party.id);
    await engine.consumeRations(formation());
    assert.deepEqual([loaf.system.quantity, loaf.flags["acks-extras"].uses], [1, 1], "a day eaten of a three-day unit");
    const card = String(chat.at(-1).content);
    assert.ok(card.includes("Trail Loaf (1/3)"), "the card says how far into the unit");
    assert.ok(card.includes("chat.rationsMissing") && card.includes("Spend Press 1"), "the member with an unsized ration is hungry");
    assert.equal(bare.system.quantity, 2, "and the unsized ration is untouched");
    const dayKey = formation().travel?.dayCount ?? 0;
    assert.equal(party.actors[0].getFlag(MODULE_ID, "fedOn"), dayKey, "the member fed is marked with the formation's End-day counter");
    assert.equal(party.actors[1].getFlag(MODULE_ID, "fedOn"), undefined, "the hungry one is not");
    await engine.consumeRations(formation());
    await engine.consumeRations(formation());
    assert.deepEqual([loaf.system.quantity, loaf.flags["acks-extras"].uses], [0, 0], "the third day finishes the unit; the stack stays");
    assert.ok(String(chat.at(-1).content).includes("Trail Loaf (3/3)"));
    await engine.consumeRations(formation());
    assert.equal(party.actors[0].getFlag(MODULE_ID, "fedOn"), dayKey, "an empty pack leaves the earlier mark as it was");
  } finally {
    game.user = prior;
    await disbandProvisioned(party);
  }
});

await scenario("End day spends exactly what it dealt: even half portions draw each share from the member's own pack, then the order's, and vessels go down to what is left and stay", async () => {
  const party = await provisionParty("Spend Even", [
    [loafItem(2), flaskItem(4, 0.25)], [flaskItem(2, 0.5)], [], [],
  ]);
  const prior = game.user;
  game.user = game.users.get("GM1");
  try {
    await game.settings.set(MODULE_ID, "provisionSharing", "even");
    const [[loaves, skins], [flasks]] = party.items;
    const day = await runProvisionDay(model.getFormation(party.id));
    assert.deepEqual(day.pooled, { food: 2, water: 2 });
    assert.equal(day.food.short && day.water.short, true);
    assert.deepEqual(day.report.map((r) => r.meal), Array(4).fill({ food: "half", water: "half" }), "four mouths on two days of each: half portions");
    assert.deepEqual(day.spent, { food: 2, water: 2 }, "what was dealt is what was drawn");
    assert.equal(day.pooled.food - day.food.remaining, day.spent.food);
    assert.equal(day.pooled.water - day.water.remaining, day.spent.water);
    assert.equal(loaves.system.quantity, 0, "the loaves are gone, the stack still in the pack");
    assert.deepEqual([skins.system.quantity, flasks.system.quantity], [4, 2], "no vessel is removed");
    assert.deepEqual([skins.flags["acks-extras"].provision.left, flasks.flags["acks-extras"].provision.left], [0, 0], "both are empty");
    assert.deepEqual([skins.flags["acks-extras"].provision.kind, flasks.flags["acks-extras"].provision.perUnit], ["water", 0.5], "and keep what was declared");
    const [first, second, third] = day.report;
    assert.deepEqual(first.spent.food.from.map((f) => [f.owner, f.days]), [["Spend Even 0", 0.5]], "the first member ate from their own pack");
    assert.deepEqual(second.spent.food.from.map((f) => [f.owner, f.days]), [["Spend Even 0", 0.5]], "the second had none, and ate from the first's");
    assert.deepEqual(first.spent.water.from.map((f) => [f.owner, f.days]), [["Spend Even 0", 0.5]]);
    assert.deepEqual(third.spent.water.from.map((f) => [f.owner, f.days]), [["Spend Even 0", 0.5]], "the third drank from the first's vessels, which still had it");
    assert.equal(day.report[3].spent.water.from[0].owner, "Spend Even 1", "and the fourth from the second's, the first being empty");
    assert.equal(second.spent.water.days, 0.5, "the second's own vessels gave their own share");
    assert.equal(party.actors[2].getFlag(MODULE_ID, SURVIVAL_FLAG).shortFoodRun, 1, "half a day's food starts the short clock");

    // A second day with nothing left is dealt nothing and draws nothing.
    const bare = await runProvisionDay(model.getFormation(party.id));
    assert.deepEqual(bare.spent, { food: 0, water: 0 });
    assert.deepEqual([skins.flags["acks-extras"].provision.left, loaves.system.quantity], [0, 0], "never below empty");
    assert.equal(party.actors[2].getFlag(MODULE_ID, SURVIVAL_FLAG).noFoodRun, 1, "and the ladder takes its step");
  } finally {
    game.user = prior;
    await disbandProvisioned(party);
  }
});

await scenario("End day under triage feeds whole days to as many as the pool allows and draws just those", async () => {
  const party = await provisionParty("Spend Triage", [[loafItem(2)], [], [], []]);
  const prior = game.user;
  game.user = game.users.get("GM1");
  try {
    await game.settings.set(MODULE_ID, "provisionSharing", "triage");
    const day = await runProvisionDay(model.getFormation(party.id));
    assert.deepEqual(day.report.map((r) => r.meal.food), ["full", "full", "none", "none"]);
    assert.equal(day.spent.food, 2);
    assert.equal(party.items[0][0].system.quantity, 0);
    assert.equal(party.actors[2].getFlag(MODULE_ID, SURVIVAL_FLAG).noFoodRun, 1);
  } finally {
    await game.settings.set(MODULE_ID, "provisionSharing", "even");
    game.user = prior;
    await disbandProvisioned(party);
  }
});

await scenario("a member the press fed for the day is neither dealt food nor spent for by End day, and is spent for again on the next day", async () => {
  const party = await provisionParty("Spend Marked", [[loafItem(3)], [loafItem(3)]]);
  const prior = game.user;
  game.user = game.users.get("GM1");
  try {
    const [[a], [b]] = party.items;
    await engine.consumeRations(model.getFormation(party.id), { only: (actor) => actor.id === party.actors[0].id });
    assert.equal(a.system.quantity, 2, "the press fed the first member");
    const day = await runProvisionDay(model.getFormation(party.id));
    assert.deepEqual(day.report.map((r) => r.meal.food), ["full", "full"], "the fed member counts full");
    assert.deepEqual([a.system.quantity, b.system.quantity], [2, 2], "End day took one day, from the member the press had not fed");
    assert.equal(day.spent.food, 1);
    assert.equal(day.report[0].spent.food.days, 0, "nothing was spent for the fed member");
    assert.equal(party.actors[0].getFlag(MODULE_ID, SURVIVAL_FLAG).shortFoodRun, 0);

    // The mark is the counter alone: a clock that crosses midnight before End day does not make it stale.
    const clock = game.time.worldTime;
    game.time.worldTime = (clock ?? 0) + 86400;
    const late = await runProvisionDay(model.getFormation(party.id));
    game.time.worldTime = clock;
    assert.equal(late.report[0].spent.food.days, 0, "still fed for the day being ended");
    assert.equal(b.system.quantity, 1, "and End day drew the day from the other member again, as it would on any run");

    // The day ended: the counter moved, so the mark no longer names the day.
    await model.patchFormation(party.id, (rec) => { rec.travel = { ...(rec.travel ?? {}), dayCount: 1 }; });
    const next = await runProvisionDay(model.getFormation(party.id));
    assert.equal(next.spent.food, 2, "both are spent for on the next day");
    assert.deepEqual([a.system.quantity, b.system.quantity], [1, 0]);
  } finally {
    game.user = prior;
    await disbandProvisioned(party);
  }
});

await scenario("a member short of a day who carries only an item with no size keeps the ladder as it was, and the toll card names them and the item; setting a size brings them back", async () => {
  const party = await provisionParty("Spend Held", [[unsizedLoaf(2)], []]);
  const prior = game.user;
  game.user = game.users.get("GM1");
  try {
    const before = heldCards().length;
    const day = await runProvisionDay(model.getFormation(party.id));
    assert.deepEqual(day.report.map((r) => r.meal.food), ["none", "none"], "nothing sized was dealt");
    const [holder, empty] = party.actors;
    assert.equal(holder.getFlag(MODULE_ID, SURVIVAL_FLAG).noFoodRun, 0, "the ladder was left as it was");
    assert.equal(empty.getFlag(MODULE_ID, SURVIVAL_FLAG).noFoodRun, 1, "while a member with no food at all takes the step");
    assert.deepEqual(day.report[0].held, { food: ["Trail Loaf ×2"] });
    assert.equal(day.report[1].held, undefined);
    assert.equal(heldCards().length, before + 1, "one card");
    const card = String(heldCards().at(-1).content);
    assert.ok(card.includes("Spend Held 0") && card.includes("Trail Loaf ×2"), "it names the member and the item");
    assert.ok(card.includes("ACKS-EQUIPMENT.itemSheet.provision.cite.food"), "and carries the page reference");
    assert.ok(!card.includes("Spend Held 1"), "and not the member who simply has none");
    assert.equal(party.items[0][0].system.quantity, 2, "the unsized item was not spent");

    // A size set by hand brings them back into the count.
    await party.items[0][0].update({ "flags.acks-extras.provision.perUnit": 1 });
    const again = await runProvisionDay(model.getFormation(party.id));
    assert.equal(again.report[0].held, undefined, "sized, nothing is held");
    assert.equal(again.pooled.food, 2);
    assert.deepEqual(again.report.map((r) => r.meal.food), ["full", "full"], "two days between two mouths, a day each");
    assert.equal(again.spent.food, 2);
    assert.equal(party.items[0][0].system.quantity, 0, "and the item is spent from now on");
  } finally {
    game.user = prior;
    await disbandProvisioned(party);
  }
});

await scenario("a refill fills the vessels of the members `only` accepts, leaves an unsized one and is no Judge-only press", async () => {
  const party = await provisionParty("Spend Refill", [[flaskItem(2, 0.5), { name: "Trail Skin", type: "item", system: { quantity: 1 }, flags: { "acks-extras": { provision: { kind: "water" } } } }], [flaskItem(1, 0.5)]]);
  const prior = game.user;
  game.user = game.users.get("PL1");
  try {
    const [[mine, unsized], [theirs]] = party.items;
    await mine.update({ "flags.acks-extras.provision.left": 0.25 });
    await theirs.update({ "flags.acks-extras.provision.left": 0.25 });
    const own = (actor) => actor.id === party.actors[0].id;
    const result = await refillVessels(model.getFormation(party.id), { only: own });
    assert.deepEqual(result.filled.map((f) => [f.actor.name, f.item.id]), [["Spend Refill 0", mine.id]]);
    assert.deepEqual(result.skipped.map((f) => [f.actor.name, f.item.id]), [["Spend Refill 0", unsized.id]], "an unsized vessel is reported, not filled");
    assert.equal(mine.flags["acks-extras"].provision.left, undefined, "full, by unsetting");
    assert.equal(theirs.flags["acks-extras"].provision.left, 0.25, "a member `only` refused is not touched");
    const all = await refillVessels(model.getFormation(party.id));
    assert.equal(all.filled.length, 2, "with no predicate every member's vessels fill, whoever is seated");
    assert.equal(theirs.flags["acks-extras"].provision.left, undefined);
  } finally {
    game.user = prior;
    await disbandProvisioned(party);
  }
});

await scenario("the Refill press follows ownership of the actor holding the vessel: a seat owning no member is refused, an owner fills its own and no more, and a Judge fills every member's", async () => {
  const { SHARED_ACTIONS } = await import("../scripts/formation/formation-actions.mjs");
  const party = await provisionParty("Press Refill", [[flaskItem(2, 0.5), unsizedLoaf(1)], [flaskItem(1, 0.5)]]);
  const [mine, theirs] = party.actors;
  mine.ownership = { default: 0, PL1: 3 };
  for (const actor of party.actors) Object.defineProperty(actor, "isOwner", { get: () => actor.testUserPermission(game.user) });
  const [[mineFlask], [theirFlask]] = party.items;
  const sheet = () => ({ formation: model.getFormation(party.id), render() {} });
  const prior = game.user;
  game.users.push({ id: "PL9", name: "Stranger", isGM: false, isSelf: false });
  try {
    await mineFlask.update({ "flags.acks-extras.provision.left": 0.25 });
    await theirFlask.update({ "flags.acks-extras.provision.left": 0.25 });
    const noticed = notices.length;

    game.user = game.users.get("PL9");
    await SHARED_ACTIONS.refillVessels.call(sheet());
    assert.equal(mineFlask.flags["acks-extras"].provision.left, 0.25, "a seat owning no member fills nothing");
    assert.equal(notices.length, noticed, "and says nothing");

    game.user = game.users.get("PL1");
    await SHARED_ACTIONS.refillVessels.call(sheet());
    assert.equal(mineFlask.flags["acks-extras"].provision.left, undefined, "an owner's vessel is full");
    assert.equal(theirFlask.flags["acks-extras"].provision.left, 0.25, "another member's is left");
    assert.deepEqual(notices.at(-1), ["info", 'ACKS-FORMATION.camp.vessels.refilled {"count":1}'], "one notice counts what was filled");

    game.user = game.users.get("GM1");
    await SHARED_ACTIONS.refillVessels.call(sheet());
    assert.equal(theirFlask.flags["acks-extras"].provision.left, undefined, "a Judge owns every actor, so no gate stands between");
  } finally {
    game.user = prior;
    await disbandProvisioned(party);
  }
});

await scenario("a rung menu writes the member's own flag as the seat: the rung, that ladder's clocks reset, a mark for that ladder; a seat that does not own the member writes nothing; End day takes the mark off the ladder it steps and not off one it holds", async () => {
  const { bindCampRungs } = await import("../scripts/formation/formation-actions.mjs");
  const { setRung } = await import("../scripts/lib/survival.mjs");
  const party = await provisionParty("Rung Menu", [[loafItem(1)], [unsizedLoaf(1)]]);
  const [mine, theirs] = party.actors;
  mine.ownership = { default: 0, PL1: 3 };
  for (const actor of party.actors) Object.defineProperty(actor, "isOwner", { get: () => actor.testUserPermission(game.user) });
  const prior = game.user;
  const selects = [];
  const app = {
    formation: model.getFormation(party.id),
    render() {},
    element: { querySelectorAll: (sel) => (sel === "select[data-rung-for]" ? selects : []) },
  };
  /** A rung select as the template draws it, with the listener the binder attaches. */
  const menu = (actor, ladder) => {
    const select = {
      dataset: { rungFor: actor.id, ladder, pick: `rung-${actor.id}-${ladder}` }, value: "",
      addEventListener(_type, fn) { this.change = fn; },
    };
    selects.push(select);
    return select;
  };
  const flag = (actor) => actor.getFlag(MODULE_ID, SURVIVAL_FLAG);
  try {
    const hunger = menu(mine, "nourishment");
    const thirst = menu(mine, "hydration");
    const other = menu(theirs, "nourishment");
    bindCampRungs(app);
    bindCampRungs(app);
    assert.ok(hunger.change && thirst.change && other.change, "each select is bound");

    await mine.setFlag(MODULE_ID, SURVIVAL_FLAG, { nourishment: "fed", hydration: "watered", noFoodRun: 2, shortFoodRun: 4, noWaterRun: 1, conLost: 2 });
    game.user = game.users.get("PL1");
    hunger.value = "underfed";
    await hunger.change();
    assert.equal(flag(mine).nourishment, "underfed", "the rung is written to the member");
    assert.deepEqual([flag(mine).noFoodRun, flag(mine).shortFoodRun], [0, 0], "that ladder's runs restart");
    assert.equal(flag(mine).noWaterRun, 1, "the other ladder's do not");
    assert.deepEqual(flag(mine).handSet, { nourishment: true, hydration: false });
    assert.equal(flag(mine).conLost, 2, "what is not a rung is kept");

    other.value = "starving";
    await other.change();
    assert.equal(flag(theirs), undefined, "a seat that does not own the member writes nothing");
    assert.equal(notices.at(-1)[0], "warn", "and says so");

    hunger.value = "peckish";
    await hunger.change();
    assert.equal(flag(mine).nourishment, "underfed", "a value that is no rung writes nothing");

    // End day: the ladder it steps loses the mark; the ladder it holds keeps its own.
    thirst.value = "dehydrated";
    await thirst.change();
    assert.deepEqual(flag(mine).handSet, { nourishment: true, hydration: true });
    game.user = game.users.get("GM1");
    await runProvisionDay(model.getFormation(party.id));
    assert.deepEqual(flag(mine).handSet, { nourishment: false, hydration: false }, "both ladders were stepped, so neither mark stays");

    await theirs.setFlag(MODULE_ID, SURVIVAL_FLAG, setRung(undefined, "nourishment", "underfed"));
    await runProvisionDay(model.getFormation(party.id));
    assert.deepEqual(flag(theirs).handSet, { nourishment: true, hydration: false }, "a member with an unsized ration has food held: that ladder keeps its mark");
    assert.equal(flag(theirs).nourishment, "underfed");
    assert.equal(flag(theirs).handSet.hydration, false, "and every key is written, so a merge cannot keep a stale one");
  } finally {
    game.user = prior;
    await disbandProvisioned(party);
  }
});

await scenario("a member's owner forms the party up through the relay: applied and announced once, and a forged or refused request writes nothing", async () => {
  const { saveTemplate, deleteTemplate } = await import("../scripts/formation/marching-templates.mjs");
  const party = await fightingParty("Relay Form Party", pressData("Form Owner", { owned: true }), "Form Other");
  const { id } = party;
  const order = await saveTemplate(model.getFormation(id), "Relay order");
  const template = order.template;
  const standing = () => model.getFormation(id).members.map((m) => m.actorId);
  const declared = (from) => chat.slice(from).filter((m) => String(m.content).includes("request.formUp"));
  const gmUser = game.user;
  game.users.push({ id: "PL9", name: "Stranger", isGM: false, isSelf: false });
  try {
    await model.patchFormation(id, (rec) => { rec.members.reverse(); });
    const saved = template.cells.map((c) => c.actorId);
    const stood = standing();
    assert.notDeepEqual(stood, saved, "the party stands out of its saved order");

    const quiet = async (who, payload, why) => {
      const cards = chat.length;
      game.user = game.users.get(who);
      const answer = await requests.requestPartyAction(id, "formUp", payload);
      game.user = gmUser;
      await drain();
      assert.deepEqual(standing(), stood, `${why}: nobody moved`);
      assert.equal(chat.length, cards, `${why}: nothing is announced`);
      return answer;
    };
    await quiet("PL9", { templateId: template.id }, "a sender owning no member");
    await quiet("PL1", {}, "a missing templateId");
    await quiet("PL1", { templateId: "no-such-order" }, "an unknown templateId");
    await quiet("PL1", { templateId: 42 }, "a non-string templateId");
    await quiet("PL1", { templateId: { id: template.id } }, "an object for the templateId");

    const cards = chat.length;
    game.user = game.users.get("PL1");
    await requests.requestPartyAction(id, "formUp", { templateId: template.id, formationId: "other", actorId: "elsewhere", templateIds: ["x"] });
    game.user = gmUser;
    await drain();
    assert.deepEqual(standing(), saved, "the owner's request marches the party into the order; extra keys are ignored");
    assert.equal(declared(cards).length, 1, "and announces it once");
    assert.ok(declared(cards)[0].content.includes("Relay order"), "naming the order");
  } finally {
    game.user = gmUser;
    game.users.pop();
    await deleteTemplate(template.id);
    await dismissFighting(party);
  }
});

await scenario("a fight still on answers a player's Form up request as a refusal and writes nothing", async () => {
  const { saveTemplate, deleteTemplate } = await import("../scripts/formation/marching-templates.mjs");
  const party = await fightingParty("Relay Holding Party", pressData("Hold Owner", { owned: true }), "Hold Leaver");
  const { id, actors } = party;
  const [, leaver] = actors;
  const combat = new CombatMock();
  const { template } = await saveTemplate(model.getFormation(id), "Held order");
  const gmUser = game.user;
  try {
    await partyJoins(combat);
    await toggleOut(combat, [leaver]);
    const cards = chat.length;
    const told = notices.length;
    game.user = game.users.get("PL1");
    const answer = await requests.requestPartyAction(id, "formUp", { templateId: template.id });
    game.user = gmUser;
    await drain();
    assert.deepEqual(answer, { ok: false, refused: "inCombat" }, "the refusal reaches the seat");
    assert.ok(onlyFormation().combat?.active, "the fight stands");
    assert.equal(peopleOn(actors).length, 2, "nobody is gathered");
    assert.ok(!chat.slice(cards).some((m) => String(m.content).includes("request.formUp")), "nothing is announced");
    assert.ok(!notices.slice(told).some(([, m]) => m.includes("request.sent")), "and the seat is not told it was sent");
  } finally {
    game.user = gmUser;
    await deleteTemplate(template.id);
    await dismissFighting(party, combat);
  }
});

await scenario("the picker draws its Forget button by default and leaves it out when the seat may not forget", async () => {
  const { pickMarchingOrder, saveTemplate, deleteTemplate } = await import("../scripts/formation/marching-templates.mjs");
  const party = await isolatedParty("Picker Party", "Picker One", "Picker Two");
  const { template } = await saveTemplate(model.getFormation(party.id), "Picker order");
  const DialogV2 = foundry.applications.api.DialogV2;
  const prior = DialogV2.wait;
  const drawn = [];
  DialogV2.wait = async ({ buttons }) => { drawn.push(buttons.map((b) => b.action)); return null; };
  try {
    await pickMarchingOrder();
    await pickMarchingOrder({ forget: true });
    await pickMarchingOrder({ forget: false });
    assert.deepEqual(drawn, [["apply", "delete"], ["apply", "delete"], ["apply"]], "Forget is drawn unless the caller leaves it out");
  } finally {
    DialogV2.wait = prior;
    await deleteTemplate(template.id);
    await dismissFighting(party);
  }
});

await scenario("the party token's HUD offers Form up to the Judge and to a seat owning the token's actor and a member, relays a player's pick, and offers Forget only to a seat that may write settings", async () => {
  const { saveTemplate, deleteTemplate } = await import("../scripts/formation/marching-templates.mjs");
  const party = await isolatedParty("Hud Party", pressData("Hud Mine", { owned: true }), "Hud Other");
  const { id } = party;
  const { PARTY_TYPE } = await import("../scripts/formation/constants.mjs");
  const partyActor = { id: "HUDPARTY", type: PARTY_TYPE, isOwner: true };
  await model.patchFormation(id, (rec) => { rec.actorId = partyActor.id; });
  const tokenDoc = { actor: partyActor, getFlag: () => null };
  const gmUser = game.user;
  game.users.push({ id: "PL9", name: "Stranger", isGM: false, isSelf: false });
  const priorDocument = globalThis.document;
  const buttons = [];
  globalThis.document = {
    createElement: () => {
      const el = { nodeType: 1, dataset: {}, attrs: {}, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, setAttribute(name, value) { this.attrs[name] = value; } };
      buttons.push(el);
      return el;
    },
  };
  // What the hook draws on the HUD for a seat: the buttons it appended.
  const hudFor = (who) => {
    game.user = game.users.get(who);
    const root = { nodeType: 1, appended: [], querySelector: () => null, appendChild(el) { this.appended.push(el); } };
    try {
      Hooks.callAll("renderTokenHUD", { object: { document: tokenDoc } }, root);
    } finally {
      game.user = gmUser;
    }
    return root.appended;
  };
  const DialogV2 = foundry.applications.api.DialogV2;
  const priorWait = DialogV2.wait;
  const offered = [];
  const made = [];
  const standing = () => model.getFormation(id).members.map((m) => m.actorId);
  const declared = (from) => chat.slice(from).filter((m) => String(m.content).includes("request.formUp"));
  const mayWrite = { GM1: true, PL1: false, PL9: false };
  for (const user of game.users) user.can = (permission) => permission === "SETTINGS_MODIFY" && !!mayWrite[user.id];
  try {
    assert.deepEqual([hudFor("GM1"), hudFor("PL1")].map((b) => b.length), [0, 0], "with no saved order the party token has no button, on any seat");

    made.push((await saveTemplate(model.getFormation(id), "Hud order")).template);
    assert.equal(hudFor("GM1").length, 1, "the Judge has Form up");
    assert.equal(hudFor("PL1").length, 1, "a member's owner, whose seat owns the token's actor, has it");
    assert.equal(hudFor("PL9").length, 0, "a seat owning no member has none");
    partyActor.isOwner = false;
    assert.equal(hudFor("PL1").length, 0, "nor has a seat that does not own the token's actor");
    assert.equal(hudFor("GM1").length, 1, "the Judge needs no ownership");
    partyActor.isOwner = true;

    // With one saved order the press opens no picker: the player's seat relays the order itself.
    let pickers = 0;
    DialogV2.wait = async () => { pickers++; return null; };
    const saved = made[0].cells.map((c) => c.actorId);
    await model.patchFormation(id, (rec) => { rec.members.reverse(); });
    const stood = standing();
    assert.notDeepEqual(stood, saved, "the party stands out of its saved order");
    const [button] = hudFor("PL1");
    let cards = chat.length;
    game.user = game.users.get("PL1");
    try {
      button.listeners.click({ preventDefault() {} });
      await drain();
    } finally {
      game.user = gmUser;
    }
    await drain();
    assert.equal(pickers, 0, "one saved order opens no picker");
    assert.equal(button.attrs["aria-label"], button.dataset.tooltip, "the button is named for a screen reader as its tooltip names it");
    assert.deepEqual(standing(), saved, "the player's press marches the party into the order, through the relay");
    assert.equal(declared(cards).length, 1, "and one public line announces it");

    // With two or more, the picker opens, and Forget is drawn for the seat that may write settings alone.
    made.push((await saveTemplate(model.getFormation(id), "Hud second order")).template);
    DialogV2.wait = async ({ buttons: drawn }) => { offered.push(drawn.map((b) => b.action)); return null; };
    for (const who of ["PL1", "GM1"]) {
      const [press] = hudFor(who);
      game.user = game.users.get(who);
      try {
        press.listeners.click({ preventDefault() {} });
        await drain();
      } finally {
        game.user = gmUser;
      }
    }
    mayWrite.PL1 = true;
    {
      const [press] = hudFor("PL1");
      game.user = game.users.get("PL1");
      try {
        press.listeners.click({ preventDefault() {} });
        await drain();
      } finally {
        game.user = gmUser;
      }
    }
    assert.deepEqual(offered, [["apply"], ["apply", "delete"], ["apply", "delete"]],
      "the picker draws Forget for a seat that may write settings, a granted player included, and for no other");
    cards = chat.length;
  } finally {
    game.user = gmUser;
    game.users.pop();
    DialogV2.wait = priorWait;
    globalThis.document = priorDocument;
    for (const user of game.users) delete user.can;
    for (const template of made) await deleteTemplate(template.id);
    await dismissFighting(party);
  }
});

await scenario("the party sheet's presses follow what a seat owns: a player's checks relay, saves and supplies reach owned members, XP needs every participant, the image needs the party and the file browser", async () => {
  const { SHARED_ACTIONS, onChangeForm } = await import("../scripts/formation/formation-actions.mjs");
  const { PARTY_CHECKS } = await import("../scripts/formation/party-rolls.mjs");
  const mine = await pressMember("Press Mine", { owned: true });
  const theirs = await pressMember("Press Theirs");
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Press Party");
  formation = await model.addMember(formation, mine, null);
  await model.addMember(model.getFormation(formation.id), theirs, null);
  await drain();
  const id = onlyFormation().id;
  const partyActor = await ActorMock.create({ name: "Press Party", type: "party", ownership: { default: 0 }, system: { description: "" } });
  await model.patchFormation(id, (rec) => { rec.actorId = partyActor.id; });
  Object.defineProperty(partyActor, "isOwner", { get: () => partyActor.testUserPermission(game.user) });
  const app = { renders: 0, get formation() { return model.getFormation(id); }, render() { this.renders++; } };
  const gmUser = game.user;
  const apps = foundry.applications;
  const priors = { wait: apps.api.DialogV2.wait, prompt: apps.api.DialogV2.prompt, picker: apps.apps.FilePicker.implementation };
  game.users.push({ id: "PL9", name: "Stranger", isGM: false, isSelf: false });
  const browse = { PL1: true, PL9: false, GM1: true };
  for (const user of game.users) user.can = (permission) => permission === "FILES_BROWSE" && browse[user.id];
  const seat = (who) => { game.user = game.users.get(who); };
  const declared = (from) => chat.slice(from).filter((m) => String(m.content).includes("request.check"));
  const key = Object.entries(PARTY_CHECKS).find(([, cfg]) => !cfg.solo)[0];
  try {
    // A check: the player's seat declares it to the Judge's client; the Judge's rolls it directly.
    let from = chat.length;
    seat("PL1");
    await SHARED_ACTIONS.partyCheck.call(app, null, { dataset: { check: "searchMethodical" } });
    assert.equal(declared(from).length, 1, "a member's owner declares the check through the `check` op");
    assert.equal(app.renders, 0, "and the player's seat draws nothing of its own");
    from = chat.length;
    apps.api.DialogV2.wait = async () => key;
    await SHARED_ACTIONS.partyChecks.call(app);
    assert.equal(declared(from).length, 1, "the picker's check is declared the same way");
    apps.api.DialogV2.wait = async () => "not-a-check";
    from = chat.length;
    await SHARED_ACTIONS.partyChecks.call(app);
    assert.equal(chat.length, from, "a pick outside the closed set relays nothing");
    seat("PL9");
    apps.api.DialogV2.wait = async () => key;
    from = chat.length;
    await SHARED_ACTIONS.partyCheck.call(app, null, { dataset: { check: "searchMethodical" } });
    await SHARED_ACTIONS.partyChecks.call(app);
    assert.equal(chat.length, from, "a seat owning no member declares nothing");
    seat("GM1");
    from = chat.length;
    await SHARED_ACTIONS.partyCheck.call(app, null, { dataset: { check: "searchMethodical" } });
    assert.equal(declared(from).length, 0, "the Judge rolls with no declaration");
    assert.equal(app.renders, 1, "and the sheet draws the result");

    // A save and the supplies: a player's seat serves the members it owns.
    seat("PL1");
    from = chat.length;
    await SHARED_ACTIONS.partySave.call(app, null, { dataset: { save: "blast" } });
    assert.ok(String(chat.at(from).content).includes("Press Mine") && !String(chat.at(from).content).includes("Press Theirs"), "a save is rolled for the owned member alone");
    await SHARED_ACTIONS.consumeRations.call(app);
    assert.deepEqual([rationsOf(mine), rationsOf(theirs)], [2, 3], "and a ration is spent for the owned member alone");
    seat("PL9");
    from = chat.length;
    await SHARED_ACTIONS.partySave.call(app, null, { dataset: { save: "blast" } });
    await SHARED_ACTIONS.consumeRations.call(app);
    assert.equal(chat.length, from, "a seat owning no member rolls and spends nothing");
    assert.deepEqual([rationsOf(mine), rationsOf(theirs)], [2, 3]);
    seat("GM1");
    await SHARED_ACTIONS.consumeRations.call(app);
    assert.deepEqual([rationsOf(mine), rationsOf(theirs)], [1, 2], "the Judge feeds every member");

    // Deal XP: opened only to a seat owning every participant.
    let prompted = 0;
    apps.api.DialogV2.prompt = async () => { prompted++; return null; };
    seat("PL1");
    await SHARED_ACTIONS.dealXp.call(app);
    assert.equal(prompted, 0, "a seat owning one of two participants does not deal");
    seat("GM1");
    await SHARED_ACTIONS.dealXp.call(app);
    assert.equal(prompted, 1, "the Judge deals");
    await model.patchFormation(id, (rec) => { rec.members = rec.members.filter((m) => m.actorId === mine.id); });
    seat("PL1");
    await SHARED_ACTIONS.dealXp.call(app);
    assert.equal(prompted, 2, "a seat owning every participant deals");
    seat("PL9");
    await SHARED_ACTIONS.dealXp.call(app);
    assert.equal(prompted, 2, "a seat owning none does not");

    // The image: the party's owner with the file browser.
    const opened = [];
    apps.apps.FilePicker.implementation = class { constructor(options) { opened.push(options); } browse() {} };
    // The sync of the party actor's ownership from its members has run by now, so the level is set by hand just before each press.
    browse.PL9 = true;
    partyActor.ownership = { default: 0, PL1: 3 };
    seat("PL9");
    await SHARED_ACTIONS.editPartyImage.call(app);
    assert.equal(opened.length, 0, "a seat that does not own the party actor opens no picker, file browser or not");
    seat("PL1");
    await SHARED_ACTIONS.editPartyImage.call(app);
    assert.equal(opened.length, 1, "its owner with the file browser opens the picker");
    browse.PL1 = false;
    await SHARED_ACTIONS.editPartyImage.call(app);
    assert.equal(opened.length, 1, "an owner without the file browser opens none");

    // The description is the party actor's owner's write; the record's fields stay the Judge's.
    partyActor.ownership = { default: 0, PL1: 3 };
    foundry.utils.expandObject = (flat) => {
      const out = {};
      for (const [path, value] of Object.entries(flat)) {
        const parts = path.split(".");
        const last = parts.pop();
        const at = parts.reduce((into, part) => (into[part] ??= {}), out);
        at[last] = value;
      }
      return out;
    };
    const name = onlyFormation().name;
    app.renders = 0;
    seat("PL1");
    await onChangeForm.call(app, null, null, { object: { "system.description": "A tale.", name: "Renamed" } });
    assert.equal(partyActor.system.description, "A tale.", "the owner writes the description");
    assert.equal(onlyFormation().name, "Renamed", "and a seat that owns a member renames the party through the relay");
    assert.equal(partyActor.name, "Renamed", "the party actor with it");
    assert.notEqual(onlyFormation().name, name);
    assert.equal(app.renders, 1, "the sheet draws what was written");
    app.renders = 0;
    seat("PL9");
    await onChangeForm.call(app, null, null, { object: { "system.description": "Other." } });
    assert.equal(partyActor.system.description, "A tale.", "a seat that does not own the party writes nothing");
    assert.equal(app.renders, 0);
    seat("GM1");
    await onChangeForm.call(app, null, null, { object: { name: "Press Renamed" } });
    assert.equal(onlyFormation().name, "Press Renamed", "the Judge's seat still writes the record");
  } finally {
    game.user = gmUser;
    game.users.pop();
    for (const user of game.users) delete user.can;
    Object.assign(apps.api.DialogV2, { wait: priors.wait, prompt: priors.prompt });
    apps.apps.FilePicker.implementation = priors.picker;
    delete foundry.utils.expandObject;
    await model.disband(model.getFormation(id));
    await drain();
    await mine.delete();
    await theirs.delete();
    await partyActor.delete();
  }
});

/* -------------------------------------------- */
/*  Summons as members                         */
/* -------------------------------------------- */

const servicesApi = await import("../scripts/lib/services.mjs");
/** A summoner in a party, a world copy of its creature and a way to stand a summoned token of that copy on the scene. */
async function summonRig(label) {
  const caster = await member(`${label} Caster`);
  const copy = await ActorMock.create({ name: `${label} Wolf`, type: "monster", system: { hp: { value: 5, max: 5 } }, flags: { [MODULE_ID]: { summonCopy: { sourceUuid: "Compendium.test.Actor.wolf" } } } });
  const flagsFor = (by, castId) => ({ [MODULE_ID]: { summonedBy: by.uuid, summon: { sourceUuid: "Compendium.test.Actor.wolf", name: "Wolf", castId, at: 1 } } });
  const wolf = async (by, castId, x, hp = 5) => {
    const [token] = await scene.createEmbeddedDocuments("Token", [{ name: "Wolf", actorId: copy.id, actorLink: false, x, y: 1300, delta: { flags: flagsFor(by, castId), system: { hp: { value: hp, max: 5 } } } }]);
    return token;
  };
  const [casterToken] = await scene.createEmbeddedDocuments("Token", [{ name: caster.name, actorId: caster.id, x: 1100, y: 1100 }]);
  await game.settings.set(MODULE_ID, "formations", {});
  const formation = await model.addMember(await model.createFormation(`${label} Party`), caster, casterToken);
  await drain();
  return { caster, copy, wolf, formation: () => model.getFormation(formation.id), id: formation.id };
}
const wolvesOn = (copy) => scene.tokens.filter((t) => t.actorId === copy.id);

await scenario("summon members: two creatures of one copy are two members with ids of their own, deployed and restored apart", async () => {
  const rig = await summonRig("Ident");
  const [w1, w2] = [await rig.wolf(rig.caster, "c1", 1200), await rig.wolf(rig.caster, "c1", 1300)];
  const copy = rig.copy;
  const warned = notices.length;
  // The bare copy never joins, and says why.
  await model.addMember(rig.formation(), copy, null);
  assert.equal(rig.formation().members.length, 1, "the copy is not added");
  assert.ok(notices.slice(warned).some(([, m]) => m.startsWith("ACKS-FORMATION.warn.summonCopy")), "and the refusal is said");
  assert.equal(wolvesOn(copy).length, 2, "refusing it touched no creature");

  // A summon token routes through addMember to its own member.
  const held = await model.addMember(rig.formation(), copy, w1);
  await model.addSummonMembers(rig.id, [w2]);
  await drain();
  const stored = onlyFormation();
  const wolves = stored.members.filter((m) => m.baseActorId);
  assert.equal(wolves.length, 2, "both wolves are members");
  assert.notEqual(wolves[0].actorId, wolves[1].actorId, "under distinct ids");
  assert.ok(wolves.every((m) => m.baseActorId === copy.id && m.actorId !== copy.id), "each names the copy and is not it");
  assert.equal(wolvesOn(copy).length, 0, "both tokens left the scene");
  assert.ok(wolves.every((m) => m.tokenData?.delta?.flags?.[MODULE_ID]?.summonedBy === rig.caster.uuid), "the stash keeps the summoner's flags");
  assert.equal(model.getMemberActor(wolves[0]), copy, "a member's actor is its copy");
  assert.equal(held.members.length, 2, "the caller's copy holds the summon too, so a write of it keeps it");
  await model.updateFormation(held);
  assert.equal(onlyFormation().members.filter((m) => m.baseActorId).length, 2, "a write of the caller's copy does not drop them");

  // Out and back apart: each keeps its own hit points.
  const [a, b] = wolves;
  assert.equal(await deployment.toggleDetachMember(onlyFormation(), a.actorId), "detached");
  assert.equal(await deployment.toggleDetachMember(onlyFormation(), b.actorId), "detached");
  const out = onlyFormation().members.filter((m) => m.baseActorId);
  assert.notEqual(out[0].deployedTokenId, out[1].deployedTokenId, "two bodies, not one overwritten");
  const live = out.map((m) => scene.tokens.get(m.deployedTokenId));
  assert.ok(live.every((t) => t?.actorId === copy.id && t.delta?.flags?.[MODULE_ID]?.summonedBy === rig.caster.uuid), "they carry the copy and the flags");
  live[0].delta.system.hp.value = 1;
  assert.equal(await deployment.toggleDetachMember(onlyFormation(), a.actorId), "recalled");
  assert.equal(await deployment.toggleDetachMember(onlyFormation(), b.actorId), "recalled");
  const home = onlyFormation().members.filter((m) => m.baseActorId);
  assert.deepEqual(home.map((m) => m.tokenData.delta.system.hp.value), [1, 5], "each came back with its own hit points");
  assert.equal(wolvesOn(copy).length, 0, "and went back in");
});

await scenario("summon members: a creature whose summoner is not in the party is refused", async () => {
  const rig = await summonRig("Absent");
  const outsider = await member("Absent Outsider");
  const stray = await rig.wolf(outsider, "c9", 1250);
  const warned = notices.length;
  await model.addMember(rig.formation(), rig.copy, stray);
  await drain();
  assert.equal(rig.formation().members.filter((m) => m.baseActorId).length, 0, "it does not join");
  assert.ok(scene.tokens.get(stray.id), "its token stands");
  assert.ok(notices.slice(warned).some(([, m]) => m.startsWith("ACKS-FORMATION.warn.summonerAbsent")), "and the refusal is said");
});

await scenario("summon members: a creature dropped on a party in a fight is refused, its token and the roster as they were", async () => {
  const rig = await summonRig("Fight");
  const wolf = await rig.wolf(rig.caster, "c1", 1200);
  const fighting = rig.formation();
  fighting.combat = { active: true, combatId: "stub" };
  await model.updateFormation(fighting);
  await drain();
  const before = JSON.stringify(rig.formation().members);
  const warned = notices.length;
  await model.addMember(rig.formation(), rig.copy, wolf);
  await drain();
  assert.equal(JSON.stringify(rig.formation().members), before, "the roster is as it was");
  assert.ok(scene.tokens.get(wolf.id), "its token stands in the fight");
  assert.ok(notices.slice(warned).some(([, m]) => m.startsWith("ACKS-FORMATION.warn.summonInCombat")), "and the refusal is said");
});

await scenario("summon members: the fallback never stashes another caster's creature", async () => {
  const rig = await summonRig("Fall");
  const stranger = await member("Fall Stranger");
  const plain = await ActorMock.create({ name: "Fall Hound", type: "monster", system: { hp: { value: 3, max: 3 } } });
  const [bound] = await scene.createEmbeddedDocuments("Token", [{ name: "Hound", actorId: plain.id, actorLink: false, x: 1500, y: 1500, delta: { flags: { [MODULE_ID]: { summonedBy: stranger.uuid } } } }]);
  const [free] = await scene.createEmbeddedDocuments("Token", [{ name: "Hound", actorId: plain.id, actorLink: false, x: 1600, y: 1500 }]);
  await model.addMember(rig.formation(), plain, null, { scene });
  await drain();
  assert.ok(scene.tokens.get(bound.id), "the other caster's creature stands where it was");
  assert.ok(!scene.tokens.get(free.id), "the free token is the one stashed");
});

await scenario("summon members: a summoner takes its summons with it, restored with their flags", async () => {
  const rig = await summonRig("Leave");
  const other = await member("Leave Other");
  const w1 = await rig.wolf(rig.caster, "c1", 1200);
  const w2 = await rig.wolf(other, "c2", 1300);
  const w3 = await rig.wolf(rig.caster, "c1", 1400);
  await model.addSummonMembers(rig.id, [w1, w2, w3]);
  await drain();
  assert.equal(onlyFormation().members.filter((m) => m.baseActorId).length, 3);
  await model.removeMembers(rig.formation(), [rig.caster.id]);
  await drain();
  const left = onlyFormation().members;
  assert.deepEqual(left.map((m) => m.tokenData?.delta?.flags?.[MODULE_ID]?.summonedBy), [other.uuid], "only the other caster's creature stays");
  const back = wolvesOn(rig.copy);
  assert.equal(back.length, 2, "the summoner's two stand on the map again");
  assert.ok(back.every((t) => t.delta?.flags?.[MODULE_ID]?.summonedBy === rig.caster.uuid && t.actorLink === false), "with their flags");
});

await scenario("summon members: the roster reads them, finds a deployed one, and releases records before tokens", async () => {
  const rig = await summonRig("Roster");
  const roster = servicesApi.get("party-roster");
  const w1 = await rig.wolf(rig.caster, "c1", 1200);
  const w2 = await rig.wolf(rig.caster, "c1", 1300);
  await model.addSummonMembers(rig.id, [w1, w2]);
  await drain();
  const [a, b] = onlyFormation().members.filter((m) => m.baseActorId);
  await deployment.toggleDetachMember(onlyFormation(), b.actorId);
  const rows = roster.members(rig.id).filter((r) => r.summonedBy);
  assert.deepEqual(rows.map((r) => [r.summonedBy, r.summon.castId, r.stashed]), [[rig.caster.uuid, "c1", true], [rig.caster.uuid, "c1", false]], "a stashed and a deployed summon read alike");
  assert.equal(roster.members(rig.id)[0].summonedBy, null, "a person is no summon");
  const token = scene.tokens.get(onlyFormation().members.find((m) => m.actorId === b.actorId).deployedTokenId);
  assert.deepEqual(roster.memberOfToken(token), { partyId: rig.id, actorId: b.actorId });
  assert.equal(roster.memberOfToken(scene.tokens.get(onlyFormation().tokenId)), null, "the party token is no member's");

  // Records go first: when the token is deleted, the member is already gone.
  const seen = [];
  const original = scene.deleteEmbeddedDocuments.bind(scene);
  scene.deleteEmbeddedDocuments = async (type, ids, options) => {
    seen.push(onlyFormation().members.some((m) => m.actorId === b.actorId));
    return original(type, ids, options);
  };
  let result;
  try {
    result = await roster.release(rig.id, [a.actorId, b.actorId, "nobody"]);
  } finally {
    delete scene.deleteEmbeddedDocuments;
  }
  assert.deepEqual(result, { released: 2 }, "two members released; an unknown id is skipped");
  assert.deepEqual(seen, [false], "the record was already gone when the token went");
  assert.equal(onlyFormation().members.filter((m) => m.baseActorId).length, 0);
  await deployment.recallMembers(onlyFormation(), {});
  await drain();
  assert.equal(wolvesOn(rig.copy).length, 0, "a recall afterwards restores nothing");
  game.user = game.users.get("PL1");
  try {
    assert.deepEqual(await roster.release(rig.id, [rig.caster.id]), { released: 0 }, "a player releases nothing");
  } finally {
    game.user = game.users.get("GM1");
  }
});

await scenario("summon members: a deployed creature's token deleted by hand ends its membership", async () => {
  const rig = await summonRig("Hand");
  const w1 = await rig.wolf(rig.caster, "c1", 1200);
  const w2 = await rig.wolf(rig.caster, "c1", 1300);
  await model.addSummonMembers(rig.id, [w1, w2]);
  await drain();
  const [a, b] = onlyFormation().members.filter((m) => m.baseActorId);
  await deployment.toggleDetachMember(onlyFormation(), a.actorId);
  await deployment.toggleDetachMember(onlyFormation(), b.actorId);
  const aToken = scene.tokens.get(onlyFormation().members.find((m) => m.actorId === a.actorId).deployedTokenId);
  await scene.deleteEmbeddedDocuments("Token", [aToken.id]);
  await drain();
  assert.deepEqual(onlyFormation().members.filter((m) => m.baseActorId).map((m) => m.actorId), [b.actorId], "the deleted one's record went");
  await deployment.toggleDetachMember(onlyFormation(), b.actorId);
  await drain();
  assert.equal(wolvesOn(rig.copy).length, 0, "nothing resurrects the deleted one, and the other is back in the party");
  await model.dissolveFormation(rig.formation());
  await drain();
  assert.equal(wolvesOn(rig.copy).length, 1, "disbanding restores the survivor");
});

/* -------------------------------------------- */
/*  Summons join their summoner's party          */
/* -------------------------------------------- */

const { SUMMONS_PLACED_HOOK } = await import("../scripts/lib/constants.mjs");
const placed = (by, on = scene) => Hooks.callAll(SUMMONS_PLACED_HOOK, { summonerUuid: by.uuid, sceneId: on.id, tokenIds: [] });
const summonMembers = () => onlyFormation().members.filter((m) => m.baseActorId);

await scenario("summon joining: a cast while the summoner is formed up brings both creatures in; a hand-bound one never joins", async () => {
  const rig = await summonRig("JoinUp");
  await rig.wolf(rig.caster, "c1", 1200);
  await rig.wolf(rig.caster, "c1", 1300);
  const [bound] = await scene.createEmbeddedDocuments("Token", [{ name: "Bound", actorId: rig.copy.id, actorLink: false, x: 1400, y: 1300, delta: { flags: { [MODULE_ID]: { summonedBy: rig.caster.uuid } } } }]);
  placed(rig.caster);
  await drain();
  assert.equal(summonMembers().length, 2, "both cast creatures are members");
  assert.deepEqual(wolvesOn(rig.copy).map((t) => t.id), [bound.id], "only the hand-bound creature still stands on the map");
  assert.ok(summonMembers().every((m) => m.tokenData?.delta?.flags?.[MODULE_ID]?.summon?.castId === "c1"), "each keeps its cast record");
  placed(rig.caster);
  await drain();
  assert.equal(summonMembers().length, 2, "a second announcement finds nothing more");
  await model.dissolveFormation(rig.formation());
  await drain();
  const back = wolvesOn(rig.copy);
  assert.equal(back.length, 3, "disbanding restores both beside the bound one");
  assert.equal(back.filter((t) => t.delta?.flags?.[MODULE_ID]?.summon?.castId === "c1").length, 2, "with their cast records");
});

await scenario("summon joining: a summoner out on the map keeps its creatures out until it is recalled", async () => {
  const rig = await summonRig("JoinOut");
  assert.equal(await deployment.toggleDetachMember(rig.formation(), rig.caster.id), "detached");
  await drain();
  await rig.wolf(rig.caster, "c1", 1200);
  await rig.wolf(rig.caster, "c1", 1300);
  placed(rig.caster);
  await drain();
  assert.equal(summonMembers().length, 0, "nothing joins while the summoner is deployed");
  assert.equal(wolvesOn(rig.copy).length, 2, "the creatures stand");
  assert.equal(await deployment.toggleDetachMember(rig.formation(), rig.caster.id), "recalled");
  await drain();
  assert.equal(summonMembers().length, 2, "the recall gathers them");
  assert.equal(wolvesOn(rig.copy).length, 0);
});

await scenario("summon joining: a fight's end gathers what the deployed summoner cast on the map", async () => {
  const rig = await summonRig("JoinFight");
  const combat = new CombatMock();
  game.combats.set(combat.id, combat);
  const stored = rig.formation();
  await combat.createEmbeddedDocuments("Combatant", [{ tokenId: stored.tokenId, sceneId: scene.id, actorId: stored.actorId, hidden: false }]);
  await drain();
  assert.ok(rig.formation().combat?.active, "the party is deployed");
  await rig.wolf(rig.caster, "c1", 1200);
  placed(rig.caster);
  await drain();
  assert.equal(summonMembers().length, 0, "no join mid-fight");
  await combat.delete();
  await drain();
  assert.equal(rig.formation().combat, null, "the fight is over");
  assert.equal(summonMembers().length, 1, "the reform gathers the creature");
  assert.equal(wolvesOn(rig.copy).length, 0);
});

await scenario("summon joining: a summoner who joins later brings its standing creatures in", async () => {
  const rig = await summonRig("JoinLate");
  const late = await member("JoinLate Late");
  const [lateToken] = await scene.createEmbeddedDocuments("Token", [{ name: late.name, actorId: late.id, x: 1000, y: 1000 }]);
  await rig.wolf(late, "c7", 1250);
  placed(late);
  await drain();
  assert.equal(summonMembers().length, 0, "its summoner is no member yet, so nothing joins");
  await model.addMember(rig.formation(), late, lateToken);
  await drain();
  assert.equal(summonMembers().length, 1, "joining gathers its creature");
  assert.equal(summonMembers()[0].tokenData.delta.flags[MODULE_ID].summonedBy, late.uuid);
  assert.equal(wolvesOn(rig.copy).length, 0);
});

await scenario("summon joining: a creature of another party's summoner, or on another scene, does not join", async () => {
  const rig = await summonRig("JoinOther");
  const stranger = await member("JoinOther Stranger");
  const [strangerToken] = await scene.createEmbeddedDocuments("Token", [{ name: stranger.name, actorId: stranger.id, x: 900, y: 900 }]);
  const other = await model.addMember(await model.createFormation("JoinOther Second"), stranger, strangerToken);
  await drain();
  const strangers = await rig.wolf(stranger, "c3", 1250);
  placed(rig.caster);
  placed(stranger);
  await drain();
  const ledger = Object.values(readFormations());
  assert.equal(ledger.find((f) => f.id === rig.id).members.filter((m) => m.baseActorId).length, 0, "the stranger's creature is not this party's");
  assert.equal(ledger.find((f) => f.id === other.id).members.filter((m) => m.baseActorId).length, 1, "it is its own party's");
  assert.ok(!scene.tokens.get(strangers.id), "and left the scene for it");

  const elsewhere = new SceneMock("Elsewhere");
  game.scenes.set(elsewhere.id, elsewhere);
  try {
    const record = { sourceUuid: "Compendium.test.Actor.wolf", name: "Wolf", castId: "c4", at: 1 };
    const [far] = await elsewhere.createEmbeddedDocuments("Token", [{ name: "Wolf", actorId: rig.copy.id, actorLink: false, x: 100, y: 100, delta: { flags: { [MODULE_ID]: { summonedBy: rig.caster.uuid, summon: record } } } }]);
    placed(rig.caster, elsewhere);
    await drain();
    assert.ok(elsewhere.tokens.get(far.id), "a creature on a scene the party token is not on stays");
    assert.equal(model.getFormation(rig.id).members.filter((m) => m.baseActorId).length, 0);
  } finally {
    game.scenes.delete(elsewhere.id);
  }
});

await scenario("summon joining: a doubled trigger stores one member per creature, and a player's client stores none", async () => {
  const rig = await summonRig("JoinTwice");
  await rig.wolf(rig.caster, "c1", 1200);
  await rig.wolf(rig.caster, "c1", 1300);
  game.user = game.users.get("PL1");
  try {
    assert.equal(await membership.gatherSummons(rig.formation(), [rig.caster.id]), 0, "a player's client takes none");
  } finally {
    game.user = game.users.get("GM1");
  }
  const joined = await Promise.all([membership.gatherSummons(rig.formation(), [rig.caster.id]), membership.gatherSummons(rig.formation(), [rig.caster.id])]);
  await drain();
  assert.deepEqual(joined, [2, 0], "the second call finds both taken");
  assert.equal(summonMembers().length, 2, "two members, not four");
  assert.equal(new Set(summonMembers().map((m) => m.actorId)).size, 2);
});

await scenario("summon joining: a creature whose control ended hostile is left on the scene; one that stays is gathered", async () => {
  const rig = await summonRig("JoinLost");
  const hostile = await rig.wolf(rig.caster, "c1", 1200);
  const stays = await rig.wolf(rig.caster, "c1", 1300);
  const stamp = (token, lost) => token.update({ [`delta.flags.${MODULE_ID}.summon.lost`]: lost });
  // Core hands an unlinked token a synthetic actor whose flags are its delta's; the mock hands the copy, so these two read their own.
  for (const token of [hostile, stays]) Object.defineProperty(token, "actor", { get: () => ({ id: token.actorId, getFlag: (ns, key) => token.delta?.flags?.[ns]?.[key] }) });
  await stamp(hostile, "hostile");
  await stamp(stays, "stays");
  assert.equal(hostile.toObject().delta.flags[MODULE_ID].summon.lost, "hostile", "the stamp is where lib writes it");
  const joined = await membership.gatherSummons(rig.formation(), [rig.caster.id]);
  await drain();
  assert.equal(joined, 1, "one creature is gathered");
  assert.ok(scene.tokens.get(hostile.id), "the hostile one stands on the scene");
  assert.ok(!scene.tokens.get(stays.id), "the one that stays went into the party token");
  assert.equal(summonMembers().length, 1, "one member");
  assert.equal(summonMembers()[0].tokenData.delta.flags[MODULE_ID].summon.lost, "stays", "and it is the one that stays");
});

/** A fake token actor, as core's `updateActor` hands one for an unlinked token's delta. */
const syntheticOf = (token, value) => ({ isToken: true, token, id: token.actorId, system: { hp: { value } } });

await scenario("summon members: reaching zero hit points ends one, stashed or deployed, and never a person", async () => {
  const rig = await summonRig("Zero");
  const roster = servicesApi.get("party-roster");
  await rig.wolf(rig.caster, "c1", 1200);
  await rig.wolf(rig.caster, "c1", 1300);
  await rig.wolf(rig.caster, "c1", 1400);
  placed(rig.caster);
  await drain();
  const [a, b, c] = summonMembers();
  assert.equal((await roster.adjustStashedHp(rig.id, a.actorId, (hp) => hp.value - 2))?.after, 3, "a wound above zero leaves it");
  assert.equal(summonMembers().length, 3);

  // Stashed: the hit-point write that leaves it at zero ends it.
  assert.equal((await roster.adjustStashedHp(rig.id, a.actorId, () => 0))?.after, 0);
  assert.deepEqual(summonMembers().map((m) => m.actorId), [b.actorId, c.actorId], "its record is gone");

  // Deployed: its token's creature falling ends it, record and token.
  await deployment.toggleDetachMember(rig.formation(), b.actorId);
  await deployment.toggleDetachMember(rig.formation(), c.actorId);
  const bToken = scene.tokens.get(summonMembers().find((m) => m.actorId === b.actorId).deployedTokenId);
  Hooks.call("updateActor", syntheticOf(bToken, 2), { system: { hp: { value: 2 } } }, {}, "GM1");
  await drain();
  assert.equal(summonMembers().length, 2, "a wounded token at hit points above zero stays");
  Hooks.call("updateActor", syntheticOf(bToken, 0), { system: { hp: { value: 0 } } }, {}, "GM1");
  await drain();
  assert.deepEqual(summonMembers().map((m) => m.actorId), [c.actorId], "the fallen one's record is gone");
  assert.ok(!scene.tokens.get(bToken.id), "and its token");
  assert.equal(wolvesOn(rig.copy).length, 1, "the other still stands");

  // A person at zero is untouched on both paths.
  assert.equal(await deployment.toggleDetachMember(rig.formation(), rig.caster.id), "detached");
  const casterToken = scene.tokens.get(rig.formation().members.find((m) => m.actorId === rig.caster.id).deployedTokenId);
  Hooks.call("updateActor", syntheticOf(casterToken, 0), { system: { hp: { value: 0 } } }, {}, "GM1");
  await drain();
  assert.ok(rig.formation().members.some((m) => m.actorId === rig.caster.id && m.deployedTokenId), "a deployed person at zero stays a member");
  assert.ok(scene.tokens.get(casterToken.id), "and keeps their token");
  await deployment.toggleDetachMember(rig.formation(), rig.caster.id);
  await drain();
  assert.equal((await roster.adjustStashedHp(rig.id, rig.caster.id, () => 0))?.after, 0, "a stashed person's write lands");
  assert.ok(rig.formation().members.some((m) => m.actorId === rig.caster.id), "and they stay a member");
});

await scenario("summon members: a summon is no person, so one never counts as a casualty or stops the column", async () => {
  const rig = await summonRig("NoPerson");
  await rig.wolf(rig.caster, "c1", 1200);
  placed(rig.caster);
  await drain();
  const wolf = summonMembers()[0];
  rig.copy.system.movementacks = { exploration: 90 };
  await model.patchFormation(rig.id, (rec) => {
    const held = rec.members.find((m) => m.actorId === wolf.actorId);
    held.tokenData.delta.system.hp.value = 0;
  });
  const formation = rig.formation();
  const held = formation.members.find((m) => m.actorId === wolf.actorId);
  assert.equal(model.memberHp(held)?.value, 0, "its own hit points read zero");
  assert.equal(model.isCasualty(rig.copy, held), false, "yet it is no casualty");
  assert.equal(model.carriedLoad(formation).down.length, 0, "nobody carries it");
  assert.equal(model.paceSetter(formation)?.speed, 90, "and the column is not stopped: the creature's own pace stands");
  const personal = formation.members.find((m) => m.actorId === rig.caster.id);
  assert.equal(model.isCasualty(rig.caster, { ...personal, dead: true }), true, "a person down is a casualty still");
  await model.patchFormation(rig.id, (rec) => {
    rec.members.find((m) => m.actorId === rig.caster.id).dead = true;
  });
  assert.equal(model.paceSetter(rig.formation())?.speed, 0, "while a casualty nobody carries stops it");
});

await scenario("summon joining: a joined summon survives the joiner's own later write, and a deployed one is no arrival", async () => {
  const rig = await summonRig("JoinKeep");
  const late = await member("JoinKeep Late");
  const [lateToken] = await scene.createEmbeddedDocuments("Token", [{ name: late.name, actorId: late.id, x: 1000, y: 1000 }]);
  await rig.wolf(late, "c7", 1250);
  const copy = await model.addMember(rig.formation(), late, lateToken);
  await drain();
  assert.equal(summonMembers().length, 1, "the late summoner's creature joined");
  copy.name = "Renamed";
  await model.updateFormation(copy);
  assert.equal(summonMembers().length, 1, "the joiner's own write of its copy keeps the summon");

  // A summon member standing on the map is no new arrival.
  const [held] = summonMembers();
  assert.equal(await deployment.toggleDetachMember(onlyFormation(), held.actorId), "detached");
  await drain();
  const standing = scene.tokens.get(summonMembers()[0].deployedTokenId);
  assert.ok(standing, "its token stands");
  placed(late);
  await drain();
  assert.equal(summonMembers().length, 1, "still one member");
  assert.ok(scene.tokens.get(standing.id), "its token was not taken in as a second creature");
});

await scenario("summon members: the party sheet and the experience share read a summon as no person", async () => {
  const rig = await summonRig("Sheet");
  await rig.wolf(rig.caster, "c1", 1200);
  placed(rig.caster);
  await drain();
  const formation = rig.formation();
  const wolf = formation.members.find((m) => m.baseActorId);
  const built = (await import("../scripts/formation/formation-view.mjs")).buildFormationView(formation);
  const row = built.members.find((r) => r.actorId === wolf.actorId);
  assert.ok(row, "the party sheet lists it");
  assert.equal(row.casualty, false);
  game.user = game.users.get("PL1");
  try {
    const seat = (await import("../scripts/formation/formation-view.mjs")).buildFormationView(formation).members.find((r) => r.actorId === wolf.actorId);
    assert.equal(seat.owned, false, "a player's seat owns nothing of the creature's copy");
    assert.equal(seat.canControl, false, "so its row offers a player no control");
  } finally {
    game.user = game.users.get("GM1");
  }
  assert.deepEqual(row.roles.filter((r) => r.active), [], "it holds no role");
  const xp = await import("../scripts/formation/xp-shares.mjs");
  assert.equal(xp.shareFor(model.getMemberActor(wolf)).reason, xp.SHARE_REASON.notAPerson, "it takes no experience share");
  assert.ok(xp.divideXp(xp.participantsOf(formation)).excluded.some((r) => r.actor === rig.copy), "and is left out of the division");
});

await scenario("summon members: a control-end stamp reads off the stash or the placed token's actor", async () => {
  const { summonLostOf } = await import("../scripts/formation/formation-view.mjs");
  const record = (lost) => ({ castId: "c1", ...(lost ? { lost } : {}) });
  const stash = (lost) => ({ actorLink: false, delta: { flags: { "acks-extras": { summonedBy: "Actor.x", summon: record(lost) } } } });
  const placed = (lost) => ({ getFlag: (scope, key) => (scope === "acks-extras" && key === "summon" ? record(lost) : undefined) });
  assert.equal(summonLostOf({ tokenData: stash(null) }), null, "no stamp: no badge");
  assert.equal(summonLostOf({ tokenData: stash("stays") }), "stays");
  assert.equal(summonLostOf({ tokenData: stash("hostile") }), "hostile");
  assert.equal(summonLostOf({ tokenData: stash("unapplied") }), null, "a word that is no control end draws nothing");
  assert.equal(summonLostOf({ deployedTokenId: "t1" }, placed("hostile")), "hostile", "out on the map, the placed token's actor holds it");
  assert.equal(summonLostOf({ deployedTokenId: "t1" }, placed(null)), null);
  assert.equal(summonLostOf({ deployedTokenId: "t1" }, null), null, "a token gone from its scene reads as no stamp");
  assert.equal(summonLostOf({ deployedTokenId: "t1", tokenData: stash("stays") }, placed("hostile")), "hostile", "the placed actor wins over a stash kept from before the deploy");
});

/* -------------------------------------------- */
/*  Creatures made straight into the party       */
/* -------------------------------------------- */

/** The stash of one creature a summoning makes inside the party token: plain token data, no id, the summoner and cast record in its delta. */
const stashFor = (rig, by, castId, extra = {}) => ({
  name: "Wolf",
  actorId: rig.copy.id,
  actorLink: false,
  x: 1100,
  y: 1100,
  delta: { flags: { [MODULE_ID]: { summonedBy: by.uuid, summon: { sourceUuid: "Compendium.test.Actor.wolf", name: "Wolf", castId, at: 1 } } } },
  ...extra,
});
const asPlayer = async (fn) => {
  game.user = game.users.get("PL1");
  try {
    return await fn();
  } finally {
    game.user = game.users.get("GM1");
  }
};

await scenario("summon party: a caster who marches inside a party token has its party, and nobody else has one", async () => {
  const rig = await summonRig("PartyOf");
  const stored = rig.formation();
  assert.deepEqual(membership.summonerParty(rig.caster.id), { id: rig.id, name: stored.name, sceneId: scene.id, tokenId: stored.tokenId });
  assert.equal(membership.summonerParty("nobody"), null, "an actor no party holds");
  assert.equal(membership.summonerParty(""), null);
  await rig.wolf(rig.caster, "c1", 1200);
  placed(rig.caster);
  await drain();
  const [wolf] = summonMembers();
  assert.equal(membership.summonerParty(wolf.actorId), null, "a summon is no caster");
  assert.equal(membership.marchesInside(wolf), false);
  assert.equal(membership.marchesInside(stored.members.find((m) => m.actorId === rig.caster.id)), true);
});

await scenario("summon party: a deployed caster, a party in a fight and a party with no token on its scene have none", async () => {
  const rig = await summonRig("PartyNone");
  assert.equal(await deployment.toggleDetachMember(rig.formation(), rig.caster.id), "detached");
  await drain();
  assert.equal(membership.summonerParty(rig.caster.id), null, "out on the map, the caster marches inside nothing");
  assert.equal(await deployment.toggleDetachMember(rig.formation(), rig.caster.id), "recalled");
  await drain();
  assert.ok(membership.summonerParty(rig.caster.id), "recalled, it is back");

  const combat = new CombatMock();
  game.combats.set(combat.id, combat);
  const stored = rig.formation();
  await combat.createEmbeddedDocuments("Combatant", [{ tokenId: stored.tokenId, sceneId: scene.id, actorId: stored.actorId, hidden: false }]);
  await drain();
  assert.ok(rig.formation().combat?.active, "the party is in a fight");
  assert.equal(membership.summonerParty(rig.caster.id), null, "a party in a fight answers none, so a click places as it always did");
  await combat.delete();
  await drain();
  assert.ok(membership.summonerParty(rig.caster.id), "the fight over, it answers again");

  await model.patchFormation(rig.id, (rec) => {
    rec.tokenId = null;
  });
  assert.equal(membership.summonerParty(rig.caster.id), null, "no party token standing on a scene");
});

await scenario("summon party: admitting stashes stores members with no token made, keeping only what names this summoner with a cast record", async () => {
  const rig = await summonRig("Admit");
  const other = await member("Admit Other");
  const good = [stashFor(rig, rig.caster, "c1"), stashFor(rig, rig.caster, "c1")];
  const foreign = stashFor(rig, other, "c9");
  const bare = stashFor(rig, rig.caster, "c1");
  delete bare.delta.flags[MODULE_ID].summon;
  const tokensBefore = scene.tokens.size;
  const out = await membership.admitSummons(rig.id, rig.caster.uuid, [good[0], foreign, bare, good[1], null]);
  await drain();
  assert.equal(out.reason, undefined);
  assert.equal(out.actorIds.length, 2, "the two of this summoner's cast, no other");
  assert.deepEqual(summonMembers().map((m) => m.actorId), out.actorIds, "the minted ids are the members' own");
  assert.equal(new Set(out.actorIds).size, 2);
  assert.ok(summonMembers().every((m) => m.baseActorId === rig.copy.id && m.actorId !== rig.copy.id), "each names the copy and is not it");
  assert.ok(summonMembers().every((m) => m.tokenData?.delta?.flags?.[MODULE_ID]?.summonedBy === rig.caster.uuid && m.tokenData.delta.flags[MODULE_ID].summon.castId === "c1"), "the stash keeps the flags");
  assert.equal(scene.tokens.size, tokensBefore, "no token was made on any scene");
  assert.equal(model.getMemberActor(summonMembers()[0]), rig.copy, "a member's actor is its copy");
  const rows = servicesApi.get("party-roster").members(rig.id).filter((r) => r.stashed && r.summonedBy === rig.caster.uuid);
  assert.equal(rows.length, 2, "the roster reads them as held summons of the caster");

  assert.equal(await deployment.toggleDetachMember(onlyFormation(), summonMembers()[0].actorId), "detached", "a stashed one deploys like any other");
  await drain();
  assert.equal(wolvesOn(rig.copy).length, 1);
});

await scenario("summon party: admission is refused for a player's client, a summoner gone out, a fight, an unknown party and a stash that is none", async () => {
  const rig = await summonRig("AdmitNo");
  const stash = () => stashFor(rig, rig.caster, "c1");
  assert.deepEqual(await asPlayer(() => membership.admitSummons(rig.id, rig.caster.uuid, [stash()])), { actorIds: [], reason: "notGm" });
  assert.deepEqual((await membership.admitSummons("no-party", rig.caster.uuid, [stash()])).reason, "noParty");
  assert.equal((await membership.admitSummons(rig.id, rig.caster.uuid, [])).reason, "noStash");
  assert.equal((await membership.admitSummons(rig.id, "Actor.nobody", [stash()])).reason, "notInside", "a summoner no member of the party");

  assert.equal(await deployment.toggleDetachMember(rig.formation(), rig.caster.id), "detached");
  await drain();
  assert.deepEqual(await membership.admitSummons(rig.id, rig.caster.uuid, [stash()]), { actorIds: [], reason: "notInside" }, "the summoner has gone out since the seat asked");
  assert.equal(await deployment.toggleDetachMember(rig.formation(), rig.caster.id), "recalled");
  await drain();

  const combat = new CombatMock();
  game.combats.set(combat.id, combat);
  const stored = rig.formation();
  await combat.createEmbeddedDocuments("Combatant", [{ tokenId: stored.tokenId, sceneId: scene.id, actorId: stored.actorId, hidden: false }]);
  await drain();
  assert.equal((await membership.admitSummons(rig.id, rig.caster.uuid, [stash()])).reason, "inCombat");
  await combat.delete();
  await drain();
  assert.equal(summonMembers().length, 0, "nothing was stored by any refusal");
});

await scenario("summon party: two admissions for one party queue, and both stand", async () => {
  const rig = await summonRig("AdmitQueue");
  const [a, b] = await Promise.all([
    membership.admitSummons(rig.id, rig.caster.uuid, [stashFor(rig, rig.caster, "c1")]),
    membership.admitSummons(rig.id, rig.caster.uuid, [stashFor(rig, rig.caster, "c2"), stashFor(rig, rig.caster, "c2")]),
  ]);
  await drain();
  assert.deepEqual([a.actorIds.length, b.actorIds.length], [1, 2]);
  assert.equal(summonMembers().length, 3, "no write replaced the other's");
});

await scenario("the Kit tab's light-cast row: the pick is kept, its line follows the select, and Cast calls the Magic tab's cast", async () => {
  const { bindLightCast, lightCastContext, pressLightCast } = await import("../scripts/formation/light-cast.mjs");
  const party = await drawnParty("LightCast");
  const { id, walker: mine } = party;
  const other = await member("LightCast B");
  await model.addMember(model.getFormation(id), other, null);
  const uses = [];
  const spell = (isOwner, use) => ({ id: "s1", isOwner, use: use ?? ((options) => (uses.push(options), Promise.resolve())) });
  mine.items.set("s1", spell(true));
  other.items.set("s2", { ...spell(false), id: "s2" });
  const offer = (over) => ({ key: "", actorId: mine.id, itemId: "s1", tradition: "", label: "L", listText: "", listTip: "", slotsText: "", slotsTip: "", refusal: "", blocked: false, ...over });
  const offers = [
    offer({ key: `${mine.id}|s1|` }),
    offer({ key: `${mine.id}|s1|arc`, tradition: "arc" }),
    offer({ key: `${mine.id}|s1|bar`, tradition: "bar", blocked: true, refusal: "Barred" }),
    offer({ key: `${other.id}|s2|`, actorId: other.id, itemId: "s2" }),
  ];
  const reads = [];
  const read = async (actors) => (reads.push(actors.map((a) => a.id)), offers);
  const formation = () => model.getFormation(id);
  const press = (value, app = {}) => pressLightCast({ formation: formation(), lightCastPick: "", ...app }, {}, { closest: () => ({ querySelector: () => ({ value }) }) }, read);
  const noticed = () => notices.length;

  // The context: the remembered pick while its offer stands, the first otherwise; no offers, no pick.
  const ctx = await lightCastContext(formation(), `${mine.id}|s1|arc`, read);
  assert.deepEqual(ctx.lightCasts.map((o) => o.picked), [false, true, false, false], "the remembered offer is the picked one");
  assert.equal(ctx.lightCastPicked.key, `${mine.id}|s1|arc`);
  assert.equal((await lightCastContext(formation(), "gone", read)).lightCastPicked.key, offers[0].key, "a pick whose offer is gone falls back to the first");
  assert.deepEqual(await lightCastContext(formation(), "", async () => []), { lightCasts: [], lightCastPicked: null }, "no offers, nothing drawn");
  assert.deepEqual(await lightCastContext(formation(), "", async () => { throw new Error("boom"); }).catch(() => "threw"), { lightCasts: [], lightCastPicked: null }, "a read that fails is an empty row");
  assert.deepEqual(reads[0].sort(), [mine.id, other.id].sort(), "the offers are read for each member once");

  // A good press casts as the Magic tab's row does: the system's use, the list's key only where there is one.
  await press(`${mine.id}|s1|`);
  assert.deepEqual(uses, [{ skipDialog: false }], "no list, no tradition");
  await press(`${mine.id}|s1|arc`);
  assert.deepEqual(uses[1], { skipDialog: false, tradition: "arc" }, "the offer's list is passed");
  // The pick falls back to the sheet's remembered key when the select is not found.
  await pressLightCast({ formation: formation(), lightCastPick: `${mine.id}|s1|arc` }, {}, { closest: () => null }, read);
  assert.equal(uses.length, 3, "the remembered pick casts when the row cannot be found");
  assert.equal(uses[2].tradition, "arc");

  // Refusals: a blocked offer says its sentence; a spell the seat does not own, a gone offer and a blank pick do nothing, quietly.
  const before = noticed();
  await press(`${mine.id}|s1|bar`);
  assert.equal(uses.length, 3, "a blocked offer casts nothing");
  assert.deepEqual(notices.at(-1), ["warn", "Barred"], "and says why");
  const said = noticed();
  assert.equal(said, before + 1);
  await press(`${other.id}|s2|`);
  await press(`${mine.id}|nothing|`);
  await press("");
  assert.equal(uses.length, 3, "a spell the seat does not own, a gone offer and no pick cast nothing");
  assert.equal(noticed(), said, "and say nothing");
  await pressLightCast({ formation: null }, {}, {}, read);
  assert.equal(uses.length, 3, "no formation, no cast");

  // A cast that throws, or whose promise rejects, never reaches the sheet.
  const errors = [];
  const log = console.error;
  console.error = (...args) => errors.push(args);
  try {
    mine.items.set("s1", spell(true, () => { throw new Error("sync"); }));
    await press(`${mine.id}|s1|`);
    mine.items.set("s1", spell(true, () => Promise.reject(new Error("async"))));
    await press(`${mine.id}|s1|`);
    await sleep(5);
  } finally {
    console.error = log;
    mine.items.set("s1", spell(true));
  }
  assert.equal(errors.length, 2, "both are logged and neither throws out of the press");

  // The select: the line is drawn from the picked option on every render and on a change, with no redraw, and the pick is remembered.
  const piece = () => ({ textContent: "", hidden: false, attrs: {}, setAttribute(key, value) { this.attrs[key] = value; }, removeAttribute(key) { delete this.attrs[key]; } });
  const parts = Object.fromEntries(["list", "slots", "slots-wrap", "refusal", "refusal-text"].map((name) => [name, piece()]));
  const button = { disabled: false };
  const box = { querySelector: (selector) => (selector === "[data-action=castLightSpell]" ? button : parts[/"(.+)"/.exec(selector)?.[1]]) };
  const option = (value, dataset) => ({ value, dataset });
  let bound = 0;
  const select = {
    value: "k2",
    options: [
      option("k1", { listText: "List 1", listTip: "Tip 1", slotsText: "1 of 2", slotsTip: "Slots 1", refusal: "", blocked: undefined }),
      option("k2", { listText: "List 2", listTip: "", slotsText: "", slotsTip: "", refusal: "Gate 2", blocked: "1" }),
    ],
    closest: () => box,
    listeners: {},
    addEventListener(type, fn) { bound += 1; this.listeners[type] = fn; },
  };
  const app = { element: { querySelector: () => select }, lightCastPick: "" };
  bindLightCast(app);
  assert.deepEqual([parts.list.textContent, parts.slots.textContent, parts["refusal-text"].textContent], ["List 2", "", "Gate 2"], "a render draws the select's own pick");
  assert.deepEqual([parts["slots-wrap"].hidden, parts.refusal.hidden, button.disabled], [true, false, true], "a blank slots part is hidden, the refusal shown, Cast off");
  assert.ok(!("data-tooltip-text" in parts.list.attrs) && !("data-tooltip-text" in parts.slots.attrs), "a blank tip leaves no tooltip");
  select.value = "k1";
  select.listeners.change();
  assert.deepEqual([parts.list.textContent, parts.slots.textContent, parts["refusal-text"].textContent], ["List 1", "1 of 2", ""], "a change draws the new pick");
  assert.deepEqual([parts.list.attrs["data-tooltip-text"], parts.slots.attrs["data-tooltip-text"]], ["Tip 1", "Slots 1"], "with its two tooltips as text");
  assert.deepEqual([parts["slots-wrap"].hidden, parts.refusal.hidden, button.disabled], [false, true, false], "the slots part shown, the refusal hidden, Cast on");
  assert.equal(app.lightCastPick, "k1", "the pick is remembered on the sheet");
  bindLightCast(app);
  assert.equal(bound, 1, "a second render of the same select binds no second listener");
  assert.doesNotThrow(() => bindLightCast({ element: { querySelector: () => null } }), "a sheet with no row binds nothing");
});

if (failures) {
  console.error(`test-flows: ${failures} scenario(s) FAILED`);
  process.exit(1);
}
console.log("test-flows: all scenarios passed");
