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
    escapeHTML: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"),
  },
};

const actors = new Map();
const docs = new Map();
globalThis.game = {
  actors,
  scenes: [],
  users: Object.assign([{ id: "gm1", isGM: true }], { activeGM: { isSelf: true } }),
  i18n: { localize: (k) => k, format: (k, d = {}) => `${k} ${JSON.stringify(d)}` },
};
const cards = [];
globalThis.ChatMessage = {
  create: async (data) => {
    cards.push(data);
    return data;
  },
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
      // The prototype's own size and texture ride in the token data, as core's do.
      return { toObject: () => ({ _id: null, name: "Soldier", actorId: id, actorLink: false, delta: null, flags: {}, width: 1, height: 1, texture: { src: "soldier.webp", scaleX: 1, scaleY: 1 }, ...position }) };
    },
    prototypeToken: { width: 1, height: 1, texture: { scaleX: 1, scaleY: 1 } },
  };
  actors.set(id, actor);
  docs.set(actor.uuid, actor);
  return actor;
}

/**
 * A scene whose token create runs core's client pre-create and the system's roll.
 * `shuffled` hands the tokens back in reverse, which core does some of the time.
 */
function scene({ shuffled = false } = {}) {
  const where = {
    id: uid("scn"),
    grid: { size: 100 },
    // A scene's token collection iterates its documents, not its entries.
    tokens: new (class extends Map {
      [Symbol.iterator]() {
        return this.values();
      }
    })(),
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
          // What a token stores, and the world actor it stands for, as core's token documents answer them.
          get _source() {
            return this;
          },
          get baseActor() {
            return actors.get(this.actorId) ?? null;
          },
        };
        where.tokens.set(token.id, token);
        docs.set(token.uuid, token);
        made.push(token);
      }
      return shuffled ? made.reverse() : made;
    },
    async deleteEmbeddedDocuments(type, ids) {
      for (const id of ids) where.tokens.delete(id);
    },
  };
  return where;
}

const { default: GroupData } = await import("../scripts/lib/data/group-data.mjs");
const { deploy, recall } = await import("../scripts/lib/group.mjs");
const { installRecreatedHitPoints } = await import("../scripts/lib/hp.mjs");
const { KEEP_HIT_POINTS_OPTION } = await import("../scripts/lib/constants.mjs");
installRecreatedHitPoints();

/** A group of `size` with one stack of `base`, holding the records given. */
function groupActor(base, size, roster = [], more = {}) {
  const id = uid("act");
  const system = Object.assign(Object.create(GroupData.prototype), {
    stacks: [{ key: "s1", size: { current: size, initial: size }, roster, template: { uuid: base.uuid, label: "Soldier" }, ...more }],
    toObject() {
      return { stacks: structuredClone(this.stacks) };
    },
  });
  const actor = {
    id,
    name: "Band",
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

t("a whole stack sends its resting records and its pristine bodies, and no one else", async () => {
  const out = { ...record("m2", { value: 2, max: 2 }), state: "deployed", tokenUuid: "Scene.s.Token.out" };
  docs.set(out.tokenUuid, { documentName: "Token" });
  const fallen = { ...record("m3", { value: 0, max: 4 }), state: "dead" };
  const left = { ...record("m4", { value: 6, max: 6 }), state: "detached" };
  const group = groupActor(monster(), 4, [record("m1", { value: 1, max: 12 }), out, fallen, left]);
  bodyRolls.push(7, 11);
  systemRolls.push(15, 3, 9);
  const made = await deploy(group, scene(), { count: Infinity });
  assert.deepEqual(arrivedHp(made), [
    { value: 1, max: 12 },
    { value: 7, max: 7 },
    { value: 11, max: 11 },
  ]);
  const byKey = Object.fromEntries(group.system.stacks[0].roster.map((m) => [m.key, m.state]));
  assert.equal(byKey.m3, "dead");
  assert.equal(byKey.m4, "detached");
  assert.equal(group.system.stacks[0].roster.filter((m) => m.state === "deployed").length, 4, "the three sent and the one already out");
});

t("every record names the token carrying its own key, whatever order core hands them back in", async () => {
  const group = groupActor(monster(), 3, [record("m1", { value: 1, max: 12 }), record("m2", { value: 5, max: 5 })]);
  bodyRolls.push(7);
  systemRolls.push(15, 3, 9);
  await deploy(group, scene({ shuffled: true }), { count: Infinity });
  const { roster } = group.system.stacks[0];
  assert.equal(roster.length, 3);
  for (const member of roster) {
    assert.equal(member.state, "deployed");
    assert.equal(docs.get(member.tokenUuid)?.getFlag(MODULE_ID, "member"), member.key);
  }
});

t("a stack that prints its hit points sends every body out with that figure and rolls none", async () => {
  const group = groupActor(monster(), 3, [], { fixedHp: 5 });
  bodyRolls.length = 0;
  systemRolls.push(15, 3, 9);
  const made = await deploy(group, scene(), { count: 3 });
  assert.deepEqual(recordHp(group), [{ value: 5, max: 5 }, { value: 5, max: 5 }, { value: 5, max: 5 }]);
  assert.deepEqual(arrivedHp(made), [{ value: 5, max: 5 }, { value: 5, max: 5 }, { value: 5, max: 5 }]);
});

t("a stack with no printed figure still rolls its hit dice, and a figure below one is no figure", async () => {
  for (const fixedHp of [null, 0]) {
    const group = groupActor(monster(), 1, [], { fixedHp });
    bodyRolls.push(8);
    systemRolls.push(2);
    await deploy(group, scene(), { count: 1 });
    assert.deepEqual(recordHp(group), [{ value: 8, max: 8 }], `fixedHp ${fixedHp}`);
  }
});

t("a stack with no creature behind it places nothing and whispers the Judges in place of silence", async () => {
  const group = groupActor(monster(), 0);
  group.system.stacks[0] = { key: "s1", size: { current: 4, initial: 4 }, roster: [], template: { uuid: null, type: "", label: "Frobnik", snapshot: {} } };
  cards.length = 0;
  const where = scene();
  const made = await deploy(group, where, { count: 4 });
  assert.deepEqual(made, []);
  assert.equal(where.tokens.size, 0);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].whisper, ["gm1"]);
  assert.match(cards[0].content, /warn.noCreature/);
  assert.match(cards[0].content, /Frobnik/);
  assert.equal(cards[0].speaker.alias, "Band");
});

const flagsOf = (tokenData) => tokenData.flags?.[MODULE_ID] ?? {};

t("a body whose token was resized by hand redeploys at that size, held by the footprint lock", async () => {
  const where = scene();
  const group = groupActor(monster(), 1, [{ ...record("m1", { value: 4, max: 4 }), tokenSize: { width: 3, height: 3, scaleX: null, scaleY: null } }]);
  systemRolls.push(4);
  await deploy(group, where, { count: 1 });
  const [data] = where.creates[0].data;
  assert.equal(data.width, 3);
  assert.equal(data.height, 3);
  assert.equal(flagsOf(data).footprintLock, true, "the lock is what keeps auto-size off a remembered size");
  assert.equal(data.texture.scaleX, 1, "no scale was remembered, so the prototype's stands");
});

t("a body with no remembered size arrives at the prototype's and stamps it as the module's", async () => {
  const where = scene();
  const group = groupActor(monster(), 1, [record("m1", { value: 4, max: 4 })]);
  systemRolls.push(4);
  await deploy(group, where, { count: 1 });
  const [data] = where.creates[0].data;
  assert.deepEqual([data.width, data.height], [1, 1]);
  assert.equal(flagsOf(data).footprintLock, undefined, "nothing remembered, so nothing locked");
  assert.deepEqual(flagsOf(data).sizeStamp, { width: 1, height: 1 });
});

t("a remembered scale lays on the texture and takes no lock", async () => {
  const where = scene();
  const group = groupActor(monster(), 1, [{ ...record("m1", { value: 4, max: 4 }), tokenSize: { width: null, height: null, scaleX: -1.5, scaleY: 1.5 } }]);
  systemRolls.push(4);
  await deploy(group, where, { count: 1 });
  const [data] = where.creates[0].data;
  assert.deepEqual([data.texture.scaleX, data.texture.scaleY], [-1.5, 1.5]);
  assert.equal(data.texture.src, "soldier.webp", "the rest of the texture is the prototype's");
  assert.equal(flagsOf(data).footprintLock, undefined);
  assert.deepEqual([data.width, data.height], [1, 1]);
});

/** Take the one body the scene holds, change its token as `change` says, and gather it: the record it left. */
async function roundTrip(group, where, change) {
  game.scenes = [where];
  const [token] = [...where.tokens.values()];
  change(token);
  await recall(group, { scene: where });
  game.scenes = [];
  return group.system.stacks[0].roster[0];
}
const lockOf = (token) => token.flags[MODULE_ID].footprintLock;
const noSize = { width: null, height: null, scaleX: null, scaleY: null };

t("a gather remembers a hand's size, and a reset forgets it", async () => {
  const where = scene();
  const group = groupActor(monster(), 1, [record("m1", { value: 4, max: 4 })]);
  systemRolls.push(4);
  await deploy(group, where, { count: 1 });
  // A hand resizes the placed token from the 1x1 the deploy stamped.
  const kept = await roundTrip(group, where, (token) => Object.assign(token, { width: 3, height: 3 }));
  assert.deepEqual(kept.tokenSize, { width: 3, height: 3, scaleX: null, scaleY: null });

  // It comes back unchanged: locked, off the prototype, still kept.
  const again = scene();
  systemRolls.push(4);
  const [made] = await deploy(group, again, { count: 1 });
  assert.deepEqual([made.width, made.height, lockOf(made)], [3, 3, true]);
  assert.deepEqual((await roundTrip(group, again, () => {})).tokenSize, { width: 3, height: 3, scaleX: null, scaleY: null }, "a remembered body stays remembered");

  // Reset while out: the lock goes and the size it ends at is stamped, so the size is forgotten.
  const reset = scene();
  systemRolls.push(4);
  await deploy(group, reset, { count: 1 });
  const forgotten = await roundTrip(group, reset, (token) => {
    delete token.flags[MODULE_ID].footprintLock;
    Object.assign(token, { width: 2, height: 2 });
    token.flags[MODULE_ID].sizeStamp = { width: 2, height: 2 };
  });
  assert.deepEqual(forgotten.tokenSize, noSize);
});

t("an auto-sized body nobody touched is remembered at no size, and goes out unlocked", async () => {
  const where = scene();
  const group = groupActor(monster(), 1, [record("m1", { value: 4, max: 4 })]);
  systemRolls.push(4);
  await deploy(group, where, { count: 1 });
  // The scene's auto-size wrote 2x2 and stamped it in the same write.
  const kept = await roundTrip(group, where, (token) => {
    Object.assign(token, { width: 2, height: 2 });
    token.flags[MODULE_ID].sizeStamp = { width: 2, height: 2 };
  });
  assert.deepEqual(kept.tokenSize, noSize);
  const again = scene();
  systemRolls.push(4);
  const [made] = await deploy(group, again, { count: 1 });
  assert.equal(lockOf(made), undefined);
  assert.deepEqual([made.width, made.height], [1, 1], "the prototype's size, left for the scene's auto-size to judge");
});

t("a body with no stamp and no lock, placed before sizes were stamped, remembers none of its size", async () => {
  const where = scene();
  const group = groupActor(monster(), 1, [record("m1", { value: 4, max: 4 })]);
  systemRolls.push(4);
  await deploy(group, where, { count: 1 });
  const kept = await roundTrip(group, where, (token) => {
    Object.assign(token, { width: 3, height: 3 });
    delete token.flags[MODULE_ID].sizeStamp;
  });
  assert.equal(kept.tokenSize.width, null);
});

t("a hand's scale is remembered alone, with no lock on the way out", async () => {
  const where = scene();
  const group = groupActor(monster(), 1, [record("m1", { value: 4, max: 4 })]);
  systemRolls.push(4);
  await deploy(group, where, { count: 1 });
  const kept = await roundTrip(group, where, (token) => Object.assign(token, { texture: { src: "soldier.webp", scaleX: 1.5, scaleY: 1.5 } }));
  assert.deepEqual(kept.tokenSize, { width: null, height: null, scaleX: 1.5, scaleY: 1.5 });
  const again = scene();
  systemRolls.push(4);
  const [made] = await deploy(group, again, { count: 1 });
  assert.deepEqual([made.texture.scaleX, made.texture.scaleY, lockOf(made)], [1.5, 1.5, undefined]);
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
