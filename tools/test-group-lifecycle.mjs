/**
 * Offline tests for the group roster's reconciliation with the canvas
 * (scripts/lib/group.mjs, `registerGroupCleanup`): what a deleted body's
 * token does to its record. The hook is driven the way core fires it, with
 * the delete operation's options, so a body core moved to another scene
 * (`replacements`) is told apart from a body taken off the board.
 *
 * Run: node tools/test-group-lifecycle.mjs
 */
import assert from "node:assert/strict";

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

const sleep = (ms = 1) => new Promise((r) => setTimeout(r, ms));
let nextId = 0;
const uid = (p) => `${p}${(++nextId).toString().padStart(4, "0")}`;

const hooks = new Map();
globalThis.Hooks = {
  on(name, fn) {
    if (!hooks.has(name)) hooks.set(name, []);
    hooks.get(name).push(fn);
  },
  call(name, ...args) {
    for (const fn of hooks.get(name) ?? []) fn(...args);
  },
  callAll(name, ...args) {
    this.call(name, ...args);
  },
};
globalThis.foundry = {
  abstract: { TypeDataModel: class {} },
  data: { fields: new Proxy({}, { get: () => class {} }) },
  utils: {
    deepClone: (v) => structuredClone(v),
    getProperty: (o, p) => p.split(".").reduce((a, k) => a?.[k], o),
  },
};
globalThis.game = {
  users: { activeGM: { isSelf: true } },
  i18n: { localize: (k) => k },
};

const docs = new Map();
globalThis.fromUuid = async (uuid) => docs.get(uuid) ?? null;
globalThis.fromUuidSync = (uuid) => docs.get(uuid) ?? null;

const MODULE_ID = "acks-extras";

/** A scene: tokens keyed by id, as a scene's collection is. */
const scene = (name) => ({ id: uid("scn"), name, tokens: new Map() });

/** A deployed body: an unlinked token carrying its group, stack and member flags. */
function body(where, group, stackKey, memberKey, { id = uid("tok"), hp = 4 } = {}) {
  const token = {
    id,
    parent: where,
    get uuid() {
      return `Scene.${this.parent.id}.Token.${this.id}`;
    },
    flags: { [MODULE_ID]: { group: group.uuid, stack: stackKey, member: memberKey } },
    getFlag(ns, key) {
      return this.flags[ns]?.[key];
    },
    delta: { toObject: () => ({ system: { hp: { value: token.hp } } }) },
    hp,
    get actor() {
      return { system: { hp: { value: this.hp } } };
    },
  };
  where.tokens.set(token.id, token);
  docs.set(token.uuid, token);
  return token;
}

/** Remove a token as core does, firing the hook with the operation's options. */
function remove(token, options = {}) {
  token.parent.tokens.delete(token.id);
  docs.delete(token.uuid);
  Hooks.call("deleteToken", token, { action: "delete", documentName: "Token", parent: token.parent, render: true, ...options }, "GM1");
}

/**
 * Core's cross-scene move (`RegionDocument#teleportTokens`, a cut and paste
 * between scenes): the token is created on the other scene under its own id
 * where that is free, then the original is deleted with `replacements`.
 */
function teleport(token, to) {
  const arrived = body(to, groupOf(token), token.getFlag(MODULE_ID, "stack"), token.getFlag(MODULE_ID, "member"), {
    id: to.tokens.has(token.id) ? uid("tok") : token.id,
    hp: token.hp,
  });
  remove(token, { replacements: { [token.id]: arrived.uuid } });
  return arrived;
}

const groups = new Map();
const groupOf = (token) => groups.get(token.getFlag(MODULE_ID, "group"));

/** A group actor as group.mjs reads it: a type, stacks, and an update that lands after a round trip. */
function groupActor(stacks) {
  const id = uid("act");
  const actor = {
    id,
    uuid: `Actor.${id}`,
    type: `${MODULE_ID}.group`,
    writes: 0,
    system: {
      stacks,
      toObject() {
        return { stacks: structuredClone(this.stacks) };
      },
      stackOf(key) {
        return this.stacks.find((s) => s.key === key) ?? null;
      },
      get primaryStack() {
        return this.stacks[0] ?? null;
      },
    },
    async update(changes) {
      await sleep(3);
      if ("system.stacks" in changes) this.system.stacks = structuredClone(changes["system.stacks"]);
      actor.writes++;
    },
  };
  docs.set(actor.uuid, actor);
  groups.set(actor.uuid, actor);
  return actor;
}

/** A stack of `size` with one deployed record per token given. */
function deployedGroup(size, where, n) {
  const group = groupActor([{ key: "s1", size: { current: size, initial: size }, roster: [] }]);
  const tokens = [];
  for (let i = 0; i < n; i++) {
    const key = `m${i + 1}`;
    const token = body(where, group, "s1", key);
    group.system.stacks[0].roster.push({ key, ordinal: i + 1, state: "deployed", tokenUuid: token.uuid, delta: {}, note: "" });
    tokens.push(token);
  }
  return { group, tokens };
}

const record = (group, key) => group.system.stacks[0].roster.find((m) => m.key === key);
const settle = async () => {
  for (let i = 0; i < 20; i++) await sleep(2);
};

const { registerGroupCleanup } = await import("../scripts/lib/group.mjs");
registerGroupCleanup();

/* -------------------------------------------- */
/*  Scenarios                                   */
/* -------------------------------------------- */

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t("a body core moved to another scene stays deployed, under the token it arrived as", async () => {
  const keep = scene("Keep");
  const cellar = scene("Cellar");
  const { group, tokens } = deployedGroup(3, keep, 1);
  const arrived = teleport(tokens[0], cellar);
  await settle();
  const m = record(group, "m1");
  assert.equal(arrived.id, tokens[0].id, "the token arrived under its own id");
  assert.equal(m.state, "deployed", "not folded back into the stack");
  assert.equal(m.tokenUuid, arrived.uuid, "the record names the arrival, on its scene");
  assert.equal(group.system.stacks[0].size.current, 3, "no headcount change");
});

t("a fallen body moved to another scene is not a casualty", async () => {
  const keep = scene("Keep");
  const cellar = scene("Cellar");
  const { group, tokens } = deployedGroup(3, keep, 1);
  tokens[0].hp = 0;
  let casualties = 0;
  Hooks.on("acksLibGroupCasualty", (g) => g === group && casualties++);
  const arrived = teleport(tokens[0], cellar);
  await settle();
  const m = record(group, "m1");
  assert.equal(m.state, "deployed", "still standing on the cellar, not dead");
  assert.equal(m.tokenUuid, arrived.uuid);
  assert.equal(group.system.stacks[0].size.current, 3, "the headcount did not drop");
  assert.equal(casualties, 0, "no casualty announced");
});

t("there and back before either write lands ends on the last arrival", async () => {
  const keep = scene("Keep");
  const cellar = scene("Cellar");
  const { group, tokens } = deployedGroup(3, keep, 1);
  // Both deletions are heard before the first write's round trip ends, and the
  // first leg's arrival is gone by the time any write runs.
  const down = teleport(tokens[0], cellar);
  const up = teleport(down, keep);
  await settle();
  const m = record(group, "m1");
  assert.equal(m.state, "deployed");
  assert.equal(m.tokenUuid, up.uuid, "the record names the token standing now");
  assert.ok(docs.get(m.tokenUuid), "and that token exists");
});

t("a token taken off the board is still folded back in, and a fallen one is a casualty", async () => {
  const keep = scene("Keep");
  const { group, tokens } = deployedGroup(3, keep, 2);
  tokens[1].hp = 0;
  remove(tokens[0]);
  remove(tokens[1]);
  await settle();
  assert.equal(record(group, "m1").state, "materialized", "a plain deletion folds the body home");
  assert.equal(record(group, "m1").tokenUuid, "");
  assert.equal(record(group, "m2").state, "dead", "a body cleared at 0 hp fell");
  assert.equal(group.system.stacks[0].size.current, 2, "one casualty off the headcount");
});

t("a replacement that is not the same body does not carry the record", async () => {
  const keep = scene("Keep");
  const cellar = scene("Cellar");
  const { group, tokens } = deployedGroup(3, keep, 1);
  // Something else stands where the body went: no member flag of its own.
  const stranger = body(cellar, group, "s1", "someone-else");
  remove(tokens[0], { replacements: { [tokens[0].id]: stranger.uuid } });
  await settle();
  assert.equal(record(group, "m1").state, "materialized", "folded as an ordinary deletion");
});

t("a token of the same id on a scene the body is not on is not the body", async () => {
  const keep = scene("Keep");
  const copy = scene("Keep (Copy)");
  const { group, tokens } = deployedGroup(3, keep, 1);
  // A duplicated scene holds the same ids and the same flags.
  const twin = body(copy, group, "s1", "m1", { id: tokens[0].id });
  remove(twin);
  await settle();
  const m = record(group, "m1");
  assert.equal(m.state, "deployed", "the twin's deletion leaves the record alone");
  assert.equal(m.tokenUuid, tokens[0].uuid);
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
console.log(`\ntest-group-lifecycle: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
