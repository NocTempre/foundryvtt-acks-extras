/**
 * Offline tests for the hit points a deployed body arrives with
 * (scripts/lib/group.mjs, `deploy`). The scene's create is driven the way
 * core's client runs it: the pending token is built from a clone of the
 * data, the system's `_preCreate` rolls every unlinked monster token, and only
 * then does the `preCreateToken` hook fire, with the data and the create's
 * options. Lib's hook (scripts/lib/hp.mjs) is the one installed.
 *
 * Run: node tools/test-group-deploy.mjs
 */
import assert from "node:assert/strict";

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

let nextId = 0;
const uid = (p) => `${p}${(++nextId).toString().padStart(4, "0")}`;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Merge `other` into `target` key by key, objects recursively. */
function merge(target, other) {
  for (const [k, v] of Object.entries(other ?? {})) {
    if (isObject(v) && isObject(target[k])) merge(target[k], v);
    else target[k] = structuredClone(v);
  }
  return target;
}

const hooks = new Map();
globalThis.Hooks = {
  on(name, fn) {
    if (!hooks.has(name)) hooks.set(name, []);
    hooks.get(name).push(fn);
  },
  call(name, ...args) {
    for (const fn of hooks.get(name) ?? []) if (fn(...args) === false) return false;
    return true;
  },
  callAll(name, ...args) {
    for (const fn of hooks.get(name) ?? []) fn(...args);
  },
};
globalThis.foundry = {
  abstract: { TypeDataModel: class {} },
  data: { fields: new Proxy({}, { get: () => class {} }) },
  utils: {
    deepClone: (v) => structuredClone(v),
    getProperty: (o, p) => p.split(".").reduce((a, k) => a?.[k], o),
    setProperty(o, p, v) {
      const keys = p.split(".");
      const last = keys.pop();
      let at = o;
      for (const k of keys) at = at[k] ??= {};
      at[last] = v;
      return true;
    },
    mergeObject: (original, other, { inplace = true } = {}) => merge(inplace ? original : structuredClone(original), other),
    randomID: () => uid("rnd"),
  },
};

const actors = new Map();
const docs = new Map();
globalThis.game = {
  actors,
  scenes: [],
  users: { activeGM: { isSelf: true } },
  i18n: { localize: (k) => k },
};
globalThis.fromUuid = async (uuid) => docs.get(uuid) ?? null;
globalThis.fromUuidSync = (uuid) => docs.get(uuid) ?? null;

/** The rolls a record's hit points are given when `materializeMembers` makes it, in order. */
const bodyRolls = [];
/** The rolls the system's `_preCreate` gives each unlinked monster token, in order. */
const systemRolls = [];
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
  }
  async evaluate() {
    this.total = bodyRolls.shift();
    return this;
  }
};

const MODULE_ID = "acks-extras";

/** A world monster actor: the base every body's delta is laid over. */
function monster() {
  const id = uid("act");
  const actor = {
    id,
    uuid: `Actor.${id}`,
    documentName: "Actor",
    pack: null,
    type: "monster",
    name: "Soldier",
    system: { hp: { value: 9, max: 9, hd: "2d8" } },
    async getTokenDocument(position) {
      return { toObject: () => ({ _id: null, name: "Soldier", actorId: id, actorLink: false, delta: null, flags: {}, ...position }) };
    },
  };
  actors.set(id, actor);
  docs.set(actor.uuid, actor);
  return actor;
}

/** A scene whose token create runs core's client pre-create and the system's roll. */
function scene() {
  const where = {
    id: uid("scn"),
    grid: { size: 100 },
    tokens: new Map(),
    creates: [],
    async createEmbeddedDocuments(type, data, options = {}) {
      where.creates.push({ type, data: structuredClone(data), options: { ...options } });
      const made = [];
      for (const createData of data) {
        const delta = {
          _source: structuredClone(createData.delta ?? {}),
          updateSource(patch) {
            merge(this._source, patch);
          },
        };
        if (!createData.actorLink && actors.get(createData.actorId)?.type === "monster") {
          const total = systemRolls.shift();
          delta.updateSource({ system: { hp: { max: total, value: total } } });
        }
        const allowed = Hooks.call("preCreateToken", { delta }, createData, { ...options, action: "create", documentName: "Token" }, "u1");
        if (!allowed) continue;
        const token = {
          ...structuredClone(createData),
          id: uid("tok"),
          documentName: "Token",
          parent: where,
          delta: delta._source,
          get uuid() {
            return `Scene.${where.id}.Token.${this.id}`;
          },
          getFlag(ns, key) {
            return this.flags?.[ns]?.[key];
          },
        };
        where.tokens.set(token.id, token);
        docs.set(token.uuid, token);
        made.push(token);
      }
      return made;
    },
  };
  return where;
}

const { default: GroupData } = await import("../scripts/lib/data/group-data.mjs");
const { deploy } = await import("../scripts/lib/group.mjs");
const { installRecreatedHitPoints } = await import("../scripts/lib/hp.mjs");
const { KEEP_HIT_POINTS_OPTION } = await import("../scripts/lib/constants.mjs");
installRecreatedHitPoints();

/** A group of `size` with one stack of `base`, holding the records given. */
function groupActor(base, size, roster = []) {
  const id = uid("act");
  const system = Object.assign(Object.create(GroupData.prototype), {
    stacks: [{ key: "s1", size: { current: size, initial: size }, roster, template: { uuid: base.uuid, label: "Soldier" } }],
    toObject() {
      return { stacks: structuredClone(this.stacks) };
    },
  });
  const actor = {
    id,
    uuid: `Actor.${id}`,
    type: `${MODULE_ID}.group`,
    system,
    async update(changes) {
      if ("system.stacks" in changes) system.stacks = structuredClone(changes["system.stacks"]);
    },
  };
  docs.set(actor.uuid, actor);
  return actor;
}

const record = (key, hp) => ({ key, ordinal: Number(key.slice(1)), name: "", delta: { system: { hp } }, state: "materialized", tokenUuid: "", actorUuid: "", note: "" });
const arrivedHp = (tokens) => tokens.map((t) => t.delta?.system?.hp);
const recordHp = (group) => group.system.stacks[0].roster.map((m) => m.delta.system.hp);

/* -------------------------------------------- */
/*  Scenarios                                   */
/* -------------------------------------------- */

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t("a fresh deploy's bodies arrive with the hit points their new records were given", async () => {
  const group = groupActor(monster(), 3);
  bodyRolls.push(7, 11);
  systemRolls.push(15, 3);
  const made = await deploy(group, scene(), { count: 2 });
  assert.deepEqual(recordHp(group), [
    { value: 7, max: 7 },
    { value: 11, max: 11 },
  ]);
  assert.deepEqual(arrivedHp(made), [
    { value: 7, max: 7 },
    { value: 11, max: 11 },
  ]);
});

t("a body recalled wounded and deployed again arrives wounded", async () => {
  const group = groupActor(monster(), 3, [record("m1", { value: 1, max: 12 }), record("m2", { value: 5, max: 5 })]);
  systemRolls.push(16, 2);
  const made = await deploy(group, scene(), { count: 2 });
  assert.deepEqual(arrivedHp(made), [
    { value: 1, max: 12 },
    { value: 5, max: 5 },
  ]);
  assert.deepEqual(
    group.system.stacks[0].roster.map((m) => m.state),
    ["deployed", "deployed"],
  );
});

t("deploy asks for its bodies' own hit points, and is not a move", async () => {
  const where = scene();
  const group = groupActor(monster(), 2, [record("m1", { value: 3, max: 8 })]);
  bodyRolls.push(6);
  systemRolls.push(4, 4);
  await deploy(group, where, { count: 2 });
  const [create] = where.creates;
  assert.equal(create.options[KEEP_HIT_POINTS_OPTION], true);
  assert.equal(create.options.keepId, undefined, "core's keepId means a token that already stands somewhere");
  assert.deepEqual(
    create.data.map((d) => d.delta),
    [{ system: { hp: { value: 3, max: 8 } } }, { system: { hp: { value: 6, max: 6 } } }],
  );
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}\n      ${err.message}`);
  }
}
console.log(`\ntest-group-deploy: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
