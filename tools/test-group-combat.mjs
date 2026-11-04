/**
 * Offline tests for a group token in a fight (scripts/lib/group-combat.mjs):
 * adding the token to a combat sends out every body, one combatant each, and
 * ends the group's own; ending the combat recalls them; adding the token again
 * gathers them. The hooks are installed through `registerGroupCleanup`, as the
 * module does, and driven the way core fires them: creating a combatant fires
 * `createCombatant` for each one made, the bodies' own included, and deleting a
 * token takes its combatants out of every combat.
 *
 * Run: node tools/test-group-combat.mjs
 */
import assert from "node:assert/strict";

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

const sleep = (ms = 1) => new Promise((r) => setTimeout(r, ms));
/** Let every queued hook finish: the mock's work is all microtasks. */
const settle = async () => {
  for (let i = 0; i < 6; i++) await sleep(1);
};
let nextId = 0;
const uid = (p) => `${p}${(++nextId).toString().padStart(4, "0")}`;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function merge(target, other) {
  for (const [k, v] of Object.entries(other ?? {})) {
    if (isObject(v) && isObject(target[k])) merge(target[k], v);
    else target[k] = structuredClone(v);
  }
  return target;
}

/** A document collection: iterates its documents, as core's does. */
class Coll extends Map {
  [Symbol.iterator]() {
    return this.values();
  }
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
const getProperty = (o, p) => p.split(".").reduce((a, k) => a?.[k], o);
/** Core's deletion operator: a value of this class removes its key. */
class ForcedDeletion {}
globalThis.foundry = {
  abstract: { TypeDataModel: class {} },
  data: { fields: new Proxy({}, { get: () => class {} }), operators: { ForcedDeletion } },
  utils: {
    deepClone: (v) => structuredClone(v),
    getProperty,
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

const MODULE_ID = "acks-extras";
const actors = new Map();
const docs = new Map();
const formations = {};
const registeredSettings = new Set();
const cards = [];
globalThis.game = {
  actors,
  scenes: [],
  combats: new Coll(),
  users: Object.assign([{ id: "gm1", isGM: true }, { id: "pl1", isGM: false }], { activeGM: { isSelf: true } }),
  i18n: { localize: (k) => k, format: (k, d = {}) => `${k} ${JSON.stringify(d)}` },
  settings: {
    settings: { has: (key) => registeredSettings.has(key) },
    get: (ns, key) => (ns === MODULE_ID && key === "formations" ? formations : undefined),
  },
};
globalThis.ChatMessage = {
  create: async (data) => {
    cards.push(data);
    return data;
  },
};
globalThis.fromUuid = async (uuid) => docs.get(uuid) ?? null;
globalThis.fromUuidSync = (uuid) => docs.get(uuid) ?? null;

const bodyRolls = [];
const systemRolls = [];
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
  }
  async evaluate() {
    this.total = bodyRolls.shift() ?? 6;
    return this;
  }
};

/** A world monster actor: the base every body's delta is laid over. */
function monster(name) {
  const id = uid("act");
  const actor = {
    id,
    uuid: `Actor.${id}`,
    documentName: "Actor",
    pack: null,
    type: "monster",
    name,
    system: { hp: { value: 9, max: 9, hd: "2d8" } },
    async getTokenDocument(position) {
      return { toObject: () => ({ _id: null, name, actorId: id, actorLink: false, delta: null, flags: {}, ...position }) };
    },
  };
  actors.set(id, actor);
  docs.set(actor.uuid, actor);
  return actor;
}

/** Remove tokens the way core does: their combatants leave every combat with them. */
function dropCombatants(tokenIds) {
  for (const combat of game.combats) {
    for (const c of [...combat.combatants]) if (tokenIds.has(c.tokenId)) combat.combatants.delete(c.id);
  }
}

/** A scene whose token create runs the system's roll and lib's keep-hit-points hook. */
function scene() {
  const where = {
    id: uid("scn"),
    grid: { size: 100 },
    tokens: new Coll(),
    async createEmbeddedDocuments(type, data, options = {}) {
      const made = [];
      for (const createData of data) {
        const delta = {
          _source: structuredClone(createData.delta ?? {}),
          updateSource(patch) {
            merge(this._source, patch);
          },
        };
        const total = systemRolls.shift() ?? 5;
        delta.updateSource({ system: { hp: { max: total, value: total } } });
        const allowed = Hooks.call("preCreateToken", { delta }, createData, { ...options, action: "create", documentName: "Token" }, "u1");
        if (!allowed) continue;
        const token = tokenDoc(where, { ...structuredClone(createData), delta: delta._source });
        where.tokens.set(token.id, token);
        docs.set(token.uuid, token);
        made.push(token);
      }
      return made;
    },
    async deleteEmbeddedDocuments(type, ids) {
      const gone = new Set(ids);
      dropCombatants(gone);
      for (const id of ids) {
        const token = where.tokens.get(id);
        where.tokens.delete(id);
        if (token) Hooks.callAll("deleteToken", token, {}, "u1");
      }
    },
  };
  game.scenes.push(where);
  return where;
}

/** A token document: flags, an update that reads core's dotted paths and deletion operator, a uuid. */
function tokenDoc(where, data) {
  const token = {
    id: uid("tok"),
    documentName: "Token",
    parent: where,
    hidden: false,
    flags: {},
    ...data,
    get uuid() {
      return `Scene.${where.id}.Token.${this.id}`;
    },
    getFlag(ns, key) {
      return this.flags?.[ns]?.[key];
    },
    async update(changes) {
      this.updates.push(structuredClone(changes));
      for (const [k, v] of Object.entries(changes)) {
        if (k === "flags") merge(this.flags, v);
        else if (v instanceof ForcedDeletion) {
          const at = k.lastIndexOf(".");
          delete getProperty(this, k.slice(0, at))?.[k.slice(at + 1)];
        } else this[k] = v;
      }
    },
    updates: [],
  };
  return token;
}

/** A combat: creating a combatant fires the hook, as core does, for every one made. */
function combatIn() {
  const combat = {
    id: uid("cbt"),
    combatants: new Coll(),
    async createEmbeddedDocuments(type, rows) {
      const made = rows.map((row) => {
        const c = {
          id: uid("cmb"),
          parent: combat,
          ...row,
          get token() {
            return game.scenes.find((s) => s.id === this.sceneId)?.tokens.get(this.tokenId) ?? null;
          },
          async delete() {
            combat.combatants.delete(this.id);
          },
        };
        combat.combatants.set(c.id, c);
        return c;
      });
      for (const c of made) Hooks.callAll("createCombatant", c, {}, "u1");
      return made;
    },
    async deleteEmbeddedDocuments(type, ids) {
      for (const id of ids) combat.combatants.delete(id);
    },
  };
  game.combats.set(combat.id, combat);
  return combat;
}

/** Core's end of a combat: the document goes, and `deleteCombat` fires. */
async function endCombat(combat) {
  game.combats.delete(combat.id);
  Hooks.callAll("deleteCombat", combat, {}, "u1");
  await settle();
}

const { default: GroupData } = await import("../scripts/lib/data/group-data.mjs");
const { registerGroupCleanup } = await import("../scripts/lib/group.mjs");
const { installRecreatedHitPoints } = await import("../scripts/lib/hp.mjs");
const { COMBAT_FLAG } = await import("../scripts/lib/group-combat.mjs");
installRecreatedHitPoints();
registerGroupCleanup();

/** A linked group actor holding one stack per `[base, size]`. */
function groupActor(name, rows) {
  const id = uid("act");
  const stacks = rows.map(([base, size], i) => ({
    key: `s${i + 1}`,
    size: { current: size, initial: size },
    roster: [],
    template: { uuid: base.uuid, label: base.name },
  }));
  const system = Object.assign(Object.create(GroupData.prototype), {
    stacks,
    toObject() {
      return { stacks: structuredClone(this.stacks) };
    },
  });
  const actor = {
    id,
    name,
    uuid: `Actor.${id}`,
    type: `${MODULE_ID}.group`,
    system,
    async update(changes) {
      if ("system.stacks" in changes) system.stacks = structuredClone(changes["system.stacks"]);
    },
  };
  actors.set(id, actor);
  docs.set(actor.uuid, actor);
  return actor;
}

/** The group's own token on a scene, linked to it. */
function groupToken(where, group, data = {}) {
  const token = tokenDoc(where, { actorId: group.id, actorLink: true, x: 300, y: 200, ...data });
  Object.defineProperty(token, "actor", { get: () => group, configurable: true });
  where.tokens.set(token.id, token);
  docs.set(token.uuid, token);
  return token;
}

/** Add a token to a combat the way the HUD does, then let the hooks finish. */
async function addToCombat(combat, token, { hidden = false } = {}) {
  const [combatant] = await combat.createEmbeddedDocuments("Combatant", [{ tokenId: token.id, actorId: token.actorId, sceneId: token.parent.id, hidden }]);
  await settle();
  return combatant;
}

const bodiesOf = (where, group) => [...where.tokens].filter((t) => t.getFlag(MODULE_ID, "group") === group.uuid);
const rosterStates = (group) => group.system.stacks.flatMap((s) => s.roster.map((m) => m.state));

/** A scene, a group of seven in two stacks, its token, and a combat. */
function field() {
  const where = scene();
  const group = groupActor("Raiders", [[monster("Axeman"), 3], [monster("Archer"), 4]]);
  const token = groupToken(where, group);
  return { where, group, token, combat: combatIn() };
}

/* -------------------------------------------- */
/*  Scenarios                                   */
/* -------------------------------------------- */

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t("adding the group token sends out every body of every stack, one combatant each, and hides the token", async () => {
  const { where, group, token, combat } = field();
  const own = await addToCombat(combat, token);
  const bodies = bodiesOf(where, group);
  assert.equal(bodies.length, 7);
  assert.deepEqual(
    new Set([...combat.combatants].map((c) => c.tokenId)),
    new Set(bodies.map((b) => b.id)),
    "a combatant per body, and none for the group",
  );
  assert.equal(combat.combatants.size, 7);
  assert.equal(combat.combatants.has(own.id), false, "the group's own combatant is gone");
  assert.equal(token.hidden, true);
  assert.deepEqual(token.getFlag(MODULE_ID, COMBAT_FLAG), { combatId: combat.id, wasHidden: false });
  assert.equal(cards.length, 0);
});

t("the bodies stand five abreast from the group's square, one stack after another", async () => {
  const { where, group, token, combat } = field();
  await addToCombat(combat, token);
  const at = bodiesOf(where, group).map((b) => `${b.x},${b.y}`).sort();
  const want = Array.from({ length: 7 }, (_, i) => `${300 + (i % 5) * 100},${200 + Math.floor(i / 5) * 100}`).sort();
  assert.deepEqual(at, want);
  const stacks = new Map();
  for (const b of bodiesOf(where, group)) stacks.set(b.getFlag(MODULE_ID, "stack"), (stacks.get(b.getFlag(MODULE_ID, "stack")) ?? 0) + 1);
  assert.deepEqual([...stacks].sort(), [["s1", 3], ["s2", 4]]);
});

t("a hidden combatant sends the bodies' combatants out hidden, and a token hidden before is hidden after", async () => {
  const { where, group, token, combat } = field();
  token.hidden = true;
  await addToCombat(combat, token, { hidden: true });
  assert.ok([...combat.combatants].every((c) => c.hidden === true));
  assert.equal(token.getFlag(MODULE_ID, COMBAT_FLAG).wasHidden, true);
  await endCombat(combat);
  assert.equal(token.hidden, true, "back to what the Judge had set");
  assert.equal(bodiesOf(where, group).length, 0);
});

t("a group with nothing to place writes nothing and whispers the Judges", async () => {
  const where = scene();
  const group = groupActor("Ghosts", [[monster("Wisp"), 0]]);
  const token = groupToken(where, group);
  const combat = combatIn();
  cards.length = 0;
  const own = await addToCombat(combat, token);
  assert.equal(where.tokens.size, 1, "no body placed");
  assert.equal(combat.combatants.size, 1);
  assert.equal(combat.combatants.has(own.id), true, "its own combatant stays");
  assert.equal(token.hidden, false);
  assert.equal(token.getFlag(MODULE_ID, COMBAT_FLAG), undefined);
  assert.equal(token.updates.length, 0);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].whisper, ["gm1"]);
  assert.match(cards[0].content, /combat\.nothing/);
});

t("a stack whose bodies are all out already places none and still fights with them", async () => {
  const { where, group, token, combat } = field();
  // Seven out already, as a row drag leaves them.
  const { deploy } = await import("../scripts/lib/group.mjs");
  for (const s of group.system.stacks) await deploy(group, where, { stackKey: s.key, count: Infinity, x: 0, y: 0 });
  const before = bodiesOf(where, group).map((b) => b.id).sort();
  await addToCombat(combat, token);
  assert.deepEqual(bodiesOf(where, group).map((b) => b.id).sort(), before, "no body added");
  assert.equal(combat.combatants.size, 7, "each of them fights");
});

t("ending the combat recalls the bodies, brings the token back and clears the flag", async () => {
  const { where, group, token, combat } = field();
  await addToCombat(combat, token);
  const [wounded] = bodiesOf(where, group);
  wounded.delta.system.hp = { value: 0, max: wounded.delta.system.hp.max };
  await endCombat(combat);
  assert.equal(bodiesOf(where, group).length, 0);
  assert.equal(token.hidden, false);
  assert.equal(token.getFlag(MODULE_ID, COMBAT_FLAG), undefined);
  assert.equal(group.system.stacks.reduce((n, s) => n + s.size.current, 0), 6, "the body that came back at 0 hp is a casualty");
  assert.equal(rosterStates(group).filter((s) => s === "dead").length, 1);
  assert.equal(rosterStates(group).filter((s) => s === "materialized").length, 6);
});

t("adding the token again while it fights gathers the bodies and leaves the group as one combatant", async () => {
  const { where, group, token, combat } = field();
  await addToCombat(combat, token);
  assert.equal(combat.combatants.size, 7);
  token.hidden = true;
  const again = await addToCombat(combat, token);
  assert.equal(bodiesOf(where, group).length, 0);
  assert.deepEqual([...combat.combatants].map((c) => c.id), [again.id]);
  assert.equal(token.hidden, false);
  assert.equal(token.getFlag(MODULE_ID, COMBAT_FLAG), undefined);
  assert.equal(rosterStates(group).filter((s) => s === "materialized").length, 7);
});

t("a gathered group goes out again when its token is added once more", async () => {
  const { where, group, token, combat } = field();
  await addToCombat(combat, token);
  await addToCombat(combat, token);
  await addToCombat(combat, token);
  assert.equal(bodiesOf(where, group).length, 7);
  assert.equal(token.hidden, true);
  assert.equal(token.getFlag(MODULE_ID, COMBAT_FLAG).combatId, combat.id);
});

t("a token fighting in one combat is not sent out by a second, and the Judges are told", async () => {
  const { where, group, token, combat } = field();
  await addToCombat(combat, token);
  const other = combatIn();
  cards.length = 0;
  const extra = await addToCombat(other, token);
  assert.equal(other.combatants.has(extra.id), false);
  assert.equal(other.combatants.size, 0);
  assert.equal(bodiesOf(where, group).length, 7);
  assert.equal(token.getFlag(MODULE_ID, COMBAT_FLAG).combatId, combat.id);
  assert.equal(cards.length, 1);
  assert.match(cards[0].content, /combat\.elsewhere/);
});

t("a flag naming a combat no longer in the world does not hold the token back", async () => {
  const { where, group, token, combat } = field();
  token.flags[MODULE_ID] = { [COMBAT_FLAG]: { combatId: "gone", wasHidden: false } };
  await addToCombat(combat, token);
  assert.equal(bodiesOf(where, group).length, 7);
  assert.equal(token.getFlag(MODULE_ID, COMBAT_FLAG).combatId, combat.id);
});

t("a body's own combatant is left alone, and so is a token that is no group", async () => {
  const { where, group, token, combat } = field();
  await addToCombat(combat, token);
  const before = bodiesOf(where, group).length;
  const [body] = bodiesOf(where, group);
  const [again] = await combat.createEmbeddedDocuments("Combatant", [{ tokenId: body.id, actorId: body.actorId, sceneId: where.id, hidden: false }]);
  await settle();
  assert.equal(combat.combatants.has(again.id), true);
  assert.equal(bodiesOf(where, group).length, before);
  // A body carrying the member flag with a group actor in front of it is a body all the same.
  const mimic = groupToken(where, groupActor("Mimic", [[monster("Rat"), 2]]), { flags: { [MODULE_ID]: { member: "m1" } } });
  const c = await addToCombat(combat, mimic);
  assert.equal(combat.combatants.has(c.id), true);
  assert.equal(mimic.updates.length, 0);
  const plain = tokenDoc(where, { actorId: "x", x: 0, y: 0 });
  Object.defineProperty(plain, "actor", { get: () => monster("Lone") });
  where.tokens.set(plain.id, plain);
  const d = await addToCombat(combat, plain);
  assert.equal(combat.combatants.has(d.id), true);
});

t("the party's token and a group a party holds are left to the party", async () => {
  const { where, group, token, combat } = field();
  const party = groupToken(where, group, { flags: { [MODULE_ID]: { formationId: "f1" } } });
  const first = await addToCombat(combat, party);
  assert.equal(combat.combatants.has(first.id), true);
  assert.equal(bodiesOf(where, group).length, 0);

  registeredSettings.add(`${MODULE_ID}.formations`);
  formations.f1 = { id: "f1", members: [{ actorId: group.id }] };
  try {
    const second = await addToCombat(combat, token);
    assert.equal(combat.combatants.has(second.id), true);
    assert.equal(bodiesOf(where, group).length, 0);
    assert.equal(token.updates.length, 0);
  } finally {
    delete formations.f1;
    registeredSettings.clear();
  }
});

t("only the primary GM acts", async () => {
  const { where, group, token, combat } = field();
  game.users.activeGM.isSelf = false;
  try {
    const own = await addToCombat(combat, token);
    assert.equal(bodiesOf(where, group).length, 0);
    assert.equal(combat.combatants.has(own.id), true);
    await endCombat(combat);
  } finally {
    game.users.activeGM.isSelf = true;
  }
  assert.equal(token.updates.length, 0);
});

t("two groups in one combat each recall their own bodies when it ends", async () => {
  const { where, group, token, combat } = field();
  const group2 = groupActor("Wolves", [[monster("Wolf"), 2]]);
  const token2 = groupToken(where, group2, { x: 900, y: 900 });
  await addToCombat(combat, token);
  await addToCombat(combat, token2);
  assert.equal(combat.combatants.size, 9);
  await endCombat(combat);
  assert.equal(bodiesOf(where, group).length + bodiesOf(where, group2).length, 0);
  assert.equal(token.hidden || token2.hidden, false);
});

t("a token whose group is gone loses the flag when the combat ends", async () => {
  const { where, token, combat } = field();
  await addToCombat(combat, token);
  Object.defineProperty(token, "actor", { get: () => null, configurable: true });
  await endCombat(combat);
  assert.equal(token.hidden, false);
  assert.equal(token.getFlag(MODULE_ID, COMBAT_FLAG), undefined);
  assert.ok(where.tokens.size >= 1);
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}\n      ${err.stack ?? err.message}`);
  }
}
console.log(`\ntest-group-combat: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
