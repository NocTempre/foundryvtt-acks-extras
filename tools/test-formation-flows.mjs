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
    setProperty: setProp,
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
};

globalThis.CONFIG = { Actor: { dataModels: {} }, RegionBehavior: { dataModels: {}, typeIcons: {} } };
globalThis.CONST = {
  DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OWNER: 3 },
  TOKEN_DISPLAY_MODES: { HOVER: 1 },
  TOKEN_DISPOSITIONS: { FRIENDLY: 1 },
  FOG_EXPLORATION_MODES: { DISABLED: 0, INDIVIDUAL: 1, SHARED: 2 }, // matches core v14
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
  async update(changes) {
    for (const [k, v] of Object.entries(changes)) setProp(this, k, v);
    await sleep();
    Hooks.call("updateToken", this, changes, {}, "GM1");
    return this;
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
  async createEmbeddedDocuments(type, arr) {
    assert.equal(type, "Token");
    const out = [];
    for (const data of arr) {
      const token = new TokenMock(this, data);
      this.tokens.set(token.id, token);
      out.push(token);
      await sleep();
      Hooks.call("createToken", token);
    }
    return out;
  }
  async deleteEmbeddedDocuments(type, ids) {
    assert.equal(type, "Token");
    for (const id of ids) {
      const token = this.tokens.get(id);
      if (!token) continue;
      this.tokens.delete(id);
      await sleep();
      Hooks.call("deleteToken", token);
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
globalThis.game = {
  settings: {
    register(ns, key, cfg) {
      settingsDefaults.set(`${ns}.${key}`, cfg?.default);
    },
    get(ns, key) {
      const k = `${ns}.${key}`;
      if (settingsStore.has(k)) return settingsStore.get(k);
      return foundry.utils.deepClone(settingsDefaults.get(k));
    },
    async set(ns, key, value) {
      const k = `${ns}.${key}`;
      const existed = settingsStore.has(k);
      settingsStore.set(k, foundry.utils.deepClone(value));
      Hooks.call(existed ? "updateSetting" : "createSetting", { key: k, value });
      await sleep();
      return value;
    },
  },
  i18n: { localize: (k) => k, format: (k, d) => `${k}${d ? " " + JSON.stringify(d) : ""}`, has: () => true },
  user: { id: "GM1", isGM: true },
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
  time: { advance: async () => sleep() },
  paused: false,
  socket: { emit() {} },
};

/* -------------------------------------------- */
/*  Load the module (registers all hooks)        */
/* -------------------------------------------- */

await import("../scripts/formation/module.mjs");
const model = await import("../scripts/formation/formation-model.mjs");
const engine = await import("../scripts/formation/turn-engine.mjs");
const requests = await import("../scripts/formation/player-requests.mjs");
const sceneSync = await import("../scripts/formation/scene-sync.mjs");
const deployment = await import("../scripts/formation/deployment.mjs");
Hooks.call("init");
Hooks.call("ready");
// socketlib: in-process loopback — executeAsGM invokes the registered handler
// directly, which is exactly what happens when the GM client IS the executor.
const socketHandlers = {};
globalThis.socketlib = {
  registerModule: () => ({
    register: (name, fn) => (socketHandlers[name] = fn),
    executeAsGM: async (name, ...args) => socketHandlers[name]?.(...args),
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
    // Own member: role toggle and reorder land.
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
  const template = Handlebars.compile(fs.readFileSync("templates/formation/formation-body.hbs", "utf8"));
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

await scenario("winded markers apply and clear across the rest cycle", async () => {
  const walker = await member("Walker");
  await drain();
  await game.settings.set(MODULE_ID, "formations", {}); // isolate
  let formation = await model.createFormation("Winded Party");
  formation = await model.addMember(formation, walker, null);
  await drain();
  const id = onlyFormation().id;

  // Six turns without rest crosses REST_INTERVAL (5) and sets winded.
  await engine.advanceTurns(model.getFormation(id), 6, { reason: "manual" });
  await drain();
  assert.ok(onlyFormation().clock.winded, "party is winded after 6 turns without rest");
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
  await partyToken.update({ x: partyToken.x + squares * gs });
  await drain();

  const after = onlyFormation().clock;
  const roundsAfter = (after.turnsTotal * 10) + (after.roundsPartial ?? 0);
  console.log(`      [probe] rounds ${roundsBefore} -> ${roundsAfter}`);
  assert.ok(roundsAfter > roundsBefore, "movement advanced the dungeon clock");

  await model.disband(model.getFormation(id));
  await drain();
});

await scenario("a lit torch survives every hook chain and reaches the token", async () => {
  // The reported symptom: correct lighting, then no visibility — the party
  // token ends up with no light, and even a manual light is stomped. That
  // happens if formation.lights is reverted by a stale write after the light
  // was added, or if syncEnvironments dies before syncPartyTokenLight.
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

if (failures) {
  console.error(`test-flows: ${failures} scenario(s) FAILED`);
  process.exit(1);
}
console.log("test-flows: all scenarios passed");
