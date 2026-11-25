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
  await sleep(60);
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
const actors = new Coll();
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
    flags: {},
    /** How late the system's write lands, in ms: its call does not return it. */
    lateMs: 0,
    /** Each call's token ids and the stored list it read, as the system's call reads it. */
    manageCalls: [],
    /** Writes of the system's call that have not landed. */
    pending: 0,
    /** Whether the call returns a promise for its write, as it does with patches/group-initiative.mjs installed. */
    returnsWrite: false,
    /**
     * The system's tracker call: it refuses a token that is no combatant, reads the stored
     * list now, takes the tokens out of every other group, drops a group under two, and
     * writes the whole list later, returning the write only when `returnsWrite` is set.
     */
    manageGroup(groupTokens) {
      const ids = groupTokens.map((t) => t.id);
      const present = new Set([...combat.combatants].map((c) => c.tokenId));
      const read = structuredClone(combat.flags.acks?.groups ?? []);
      combat.manageCalls.push({ ids, read: structuredClone(read) });
      if (ids.some((id) => !present.has(id))) return;
      const groups = read;
      groups.push({ initiative: -1, initiativeBonus: 1000, tokens: ids });
      groups.forEach((g, i) => {
        if (i !== groups.length - 1) g.tokens = g.tokens.filter((id) => !ids.includes(id));
      });
      const kept = groups.filter((g) => g.tokens.length > 1);
      combat.pending++;
      const landed = new Promise((resolve) => {
        setTimeout(() => {
          combat.flags.acks = { groups: kept };
          combat.pending--;
          resolve();
        }, combat.lateMs);
      });
      return combat.returnsWrite ? landed : undefined;
    },
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
const { registerGroupCleanup, setParentGroup, addLabelledStack } = await import("../scripts/lib/group.mjs");
const { installRecreatedHitPoints } = await import("../scripts/lib/hp.mjs");
const { COMBAT_FLAG, groupGangs } = await import("../scripts/lib/group-combat.mjs");
const { gangPartition } = await import("../scripts/lib/group-logic.mjs");
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
    isOwner: true,
    system,
    async update(changes) {
      if ("system.stacks" in changes) system.stacks = structuredClone(changes["system.stacks"]);
      if ("system.unit.parentGroupUuid" in changes) system.unit = { ...system.unit, parentGroupUuid: changes["system.unit.parentGroupUuid"] };
    },
  };
  actors.set(id, actor);
  docs.set(actor.uuid, actor);
  return actor;
}

/** Stand `inner` inside `outer`, as `setParentGroup` records it. */
function nest(inner, outer) {
  inner.system.unit = { parentGroupUuid: outer.uuid };
  return inner;
}

/** A stack with no creature behind it: a label and a count, as the labelled stack stores one. */
const labelledRow = (label, size) => ({
  key: `lab-${label}`,
  size: { current: size, initial: size },
  roster: [],
  template: { uuid: null, type: "", label, snapshot: {} },
});

/** The group's own token on a scene, linked to it. */
function groupToken(where, group, data = {}) {
  const token = tokenDoc(where, { actorId: group.id, actorLink: true, x: 300, y: 200, ...data });
  Object.defineProperty(token, "actor", { get: () => group, configurable: true });
  where.tokens.set(token.id, token);
  docs.set(token.uuid, token);
  return token;
}

/** Wait until the system's writes have landed and lib has stopped calling it, whatever the timers do. */
async function idle(combat) {
  let seen = -1;
  while (combat.pending > 0 || combat.manageCalls.length !== seen) {
    seen = combat.manageCalls.length;
    await sleep(25);
  }
}

/** Add a token to a combat the way the HUD does, then let the hooks finish. */
async function addToCombat(combat, token, { hidden = false } = {}) {
  const [combatant] = await combat.createEmbeddedDocuments("Combatant", [{ tokenId: token.id, actorId: token.actorId, sceneId: token.parent.id, hidden }]);
  await settle();
  await idle(combat);
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

/** An outer group of two, with a gang of three and a gang of two inside it, and a single inside that second gang. */
function warband() {
  const where = scene();
  const outer = groupActor("Outer", [[monster("Chief"), 2]]);
  const gangA = nest(groupActor("Gang A", [[monster("Warrior"), 3]]), outer);
  const gangB = nest(groupActor("Gang B", [[monster("Archer"), 2]]), outer);
  const scout = nest(groupActor("Scout", [[monster("Runner"), 1]]), gangB);
  return { where, outer, gangA, gangB, scout, token: groupToken(where, outer), combat: combatIn() };
}

t("an outer group's token sends out every body of every group inside it, each flagged with its own group", async () => {
  const { where, outer, gangA, gangB, scout, token, combat } = warband();
  await addToCombat(combat, token);
  assert.equal(bodiesOf(where, outer).length, 2);
  assert.equal(bodiesOf(where, gangA).length, 3);
  assert.equal(bodiesOf(where, gangB).length, 2);
  assert.equal(bodiesOf(where, scout).length, 1, "a group two deep is reached");
  assert.equal(combat.combatants.size, 8, "a combatant per body, none for any group");
  assert.equal(token.hidden, true);
  assert.equal(token.getFlag(MODULE_ID, COMBAT_FLAG).combatId, combat.id);
});

t("ending the combat recalls the bodies of every nested group into the group they came from", async () => {
  const { where, outer, gangA, gangB, scout, token, combat } = warband();
  await addToCombat(combat, token);
  const [wounded] = bodiesOf(where, gangA);
  wounded.delta.system.hp = { value: 0, max: wounded.delta.system.hp.max };
  await endCombat(combat);
  assert.equal([...where.tokens].filter((t) => t.getFlag(MODULE_ID, "member")).length, 0, "no body left on the map");
  assert.equal(token.hidden, false);
  assert.equal(token.getFlag(MODULE_ID, COMBAT_FLAG), undefined);
  assert.equal(gangA.system.stacks[0].size.current, 2, "the body that came back at 0 hp is a casualty of its own gang");
  assert.equal(rosterStates(gangA).filter((x) => x === "dead").length, 1);
  assert.equal(rosterStates(outer).every((x) => x === "materialized"), true);
  assert.equal(rosterStates(gangB).length + rosterStates(scout).length, 3);
});

t("adding the outer token again gathers every nested body early", async () => {
  const { where, outer, token, combat } = warband();
  await addToCombat(combat, token);
  const again = await addToCombat(combat, token);
  assert.equal([...where.tokens].filter((t) => t.getFlag(MODULE_ID, "member")).length, 0);
  assert.deepEqual([...combat.combatants].map((c) => c.id), [again.id]);
  assert.equal(token.getFlag(MODULE_ID, COMBAT_FLAG), undefined);
  assert.equal(outer.system.stacks[0].roster.length, 2);
});

t("a group nested in a loop of its own data still sends out each body once", async () => {
  const { where, outer, gangA, token, combat } = warband();
  outer.system.unit = { parentGroupUuid: gangA.uuid };
  await addToCombat(combat, token);
  assert.equal([...where.tokens].filter((t) => t.getFlag(MODULE_ID, "member")).length, 8);
});

t("a labelled stack places nothing and whispers the Judges, while the other stacks still go out", async () => {
  const where = scene();
  const group = groupActor("Mixed", [[monster("Axeman"), 3]]);
  group.system.stacks.push(labelledRow("Frobnik", 4));
  const token = groupToken(where, group);
  const combat = combatIn();
  cards.length = 0;
  await addToCombat(combat, token);
  assert.equal(bodiesOf(where, group).length, 3, "the stack with a creature deploys");
  assert.equal(combat.combatants.size, 3);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].whisper, ["gm1"]);
  assert.match(cards[0].content, /warn.noCreature/);
  assert.match(cards[0].content, /Frobnik/);
});

t("a labelled stack alone leaves the group's own combatant and says why twice over", async () => {
  const where = scene();
  const group = groupActor("Unknown", []);
  group.system.stacks.push(labelledRow("Frobnik", 4));
  const token = groupToken(where, group);
  const combat = combatIn();
  cards.length = 0;
  const own = await addToCombat(combat, token);
  assert.equal(combat.combatants.has(own.id), true, "the group's own combatant stays");
  assert.equal(token.hidden, false);
  assert.equal(cards.length, 2, "the stack's warning, then the group's nothing-to-place");
});

t("setParentGroup stands a group inside another and refuses a loop, a missing parent and a seat that cannot write", async () => {
  const outer = groupActor("Outer", []);
  const inner = groupActor("Inner", []);
  const deep = groupActor("Deep", []);
  assert.deepEqual(await setParentGroup(inner, outer.uuid), { ok: true });
  assert.equal(inner.system.unit.parentGroupUuid, outer.uuid);
  assert.deepEqual(await setParentGroup(inner, outer.uuid), { ok: false, reason: "same" });
  assert.deepEqual(await setParentGroup(deep, inner.uuid), { ok: true });
  assert.deepEqual(await setParentGroup(outer, deep.uuid), { ok: false, reason: "cycle" }, "inside its own grandchild");
  assert.deepEqual(await setParentGroup(outer, outer.uuid), { ok: false, reason: "cycle" }, "inside itself");
  assert.equal(outer.system.unit?.parentGroupUuid ?? "", "", "a refused write leaves the group where it stood");
  assert.deepEqual(await setParentGroup(inner, "Actor.nowhere"), { ok: false, reason: "missing" });
  deep.isOwner = false;
  assert.deepEqual(await setParentGroup(deep, outer.uuid), { ok: false, reason: "notOwner" });
  assert.deepEqual(await setParentGroup(deep, ""), { ok: false, reason: "notOwner" });
  deep.isOwner = true;
  assert.deepEqual(await setParentGroup(deep, ""), { ok: true });
  assert.equal(deep.system.unit.parentGroupUuid, "");
  assert.deepEqual(await setParentGroup(monster("Lone"), outer.uuid), { ok: false, reason: "notGroup" });
});

t("a labelled stack is a label and a count with no prototype, and a blank label makes none", async () => {
  const group = groupActor("Pen", []);
  const key = await addLabelledStack(group, { label: "  Frobnik ", count: 3, gen: { part: "Q1", cite: "p. 5" } });
  const [stack] = group.system.stacks;
  assert.equal(stack.key, key);
  assert.deepEqual([stack.template.label, stack.template.uuid, stack.template.type, stack.size.current, stack.size.initial], ["Frobnik", null, "", 3, 3]);
  assert.deepEqual(stack.gen, { part: "Q1", cite: "p. 5" });
  assert.equal(await addLabelledStack(group, { label: " ", count: 2 }), null);
  assert.equal(group.system.stacks.length, 1);
});

/** The token ids of each group the system's tracker holds, sorted, as a comparable list. */
const storedSets = (combat) => (combat.flags.acks?.groups ?? []).map((g) => [...g.tokens].sort().join(",")).sort();
const idsOf = (tokens) => tokens.map((b) => b.id).sort().join(",");

t("gangPartition cuts the fight's bodies into one set per group, leaves out a lone body and a token no combatant holds", async () => {
  const { where, outer, gangA, gangB, scout, token, combat } = warband();
  await addToCombat(combat, token);
  const all = [...where.tokens].filter((x) => x.getFlag(MODULE_ID, "member"));
  const fighting = new Set([...combat.combatants].map((c) => c.tokenId));
  const parts = gangPartition(outer, all, fighting);
  assert.deepEqual(parts.map((p) => p.group.name), ["Outer", "Gang A", "Gang B"], "the group first, those inside nearest first, the scout alone left out");
  assert.deepEqual(parts.map((p) => idsOf(p.tokens)), [idsOf(bodiesOf(where, outer)), idsOf(bodiesOf(where, gangA)), idsOf(bodiesOf(where, gangB))]);
  assert.equal(bodiesOf(where, scout).length, 1);
  // One of Gang A's three is no combatant: two still make a group, and the missing one is not passed.
  const [out] = bodiesOf(where, gangA);
  fighting.delete(out.id);
  assert.equal(gangPartition(outer, all, fighting).find((p) => p.group === gangA).tokens.length, 2);
  fighting.delete(bodiesOf(where, gangA)[1].id);
  assert.equal(gangPartition(outer, all, fighting).some((p) => p.group === gangA), false, "one body fights alone");
});

t("a warband's token groups each gang by one call of the system's tracker, and the lone scout makes none", async () => {
  const { where, outer, gangA, gangB, scout, token, combat } = warband();
  await addToCombat(combat, token);
  assert.equal(combat.manageCalls.length, 3, "one call per group of two or more");
  assert.deepEqual(
    combat.manageCalls.map((c) => c.ids.slice().sort().join(",")).sort(),
    [idsOf(bodiesOf(where, outer)), idsOf(bodiesOf(where, gangA)), idsOf(bodiesOf(where, gangB))].sort(),
  );
  assert.deepEqual(storedSets(combat), [idsOf(bodiesOf(where, outer)), idsOf(bodiesOf(where, gangA)), idsOf(bodiesOf(where, gangB))].sort());
  const grouped = new Set(combat.flags.acks.groups.flatMap((g) => g.tokens));
  assert.equal(grouped.has(bodiesOf(where, scout)[0].id), false);
  assert.equal(combat.combatants.size, 8, "every body fights, and no group has an entry");
});

t("a group of one body makes no call, since the system refuses a single token", async () => {
  const where = scene();
  const lone = groupActor("Leader", [[monster("Chief"), 1]]);
  const token = groupToken(where, lone);
  const combat = combatIn();
  await addToCombat(combat, token);
  assert.equal(bodiesOf(where, lone).length, 1);
  assert.equal(combat.manageCalls.length, 0);
  assert.equal(combat.flags.acks, undefined);
});

t("a gang already in the fight is one of the warband's groups and keeps the roll it carries", async () => {
  const { where, outer, gangA, gangB, token, combat } = warband();
  const gangToken = groupToken(where, gangA, { x: 900, y: 900 });
  await addToCombat(combat, gangToken);
  assert.equal(combat.manageCalls.length, 1, "the gang alone is grouped when it joins");
  combat.flags.acks.groups[0].initiative = 4;
  await addToCombat(combat, token);
  assert.equal(combat.manageCalls.length, 3, "the gang's group is held as it stands, and the warband's other two are made");
  assert.deepEqual(storedSets(combat), [idsOf(bodiesOf(where, outer)), idsOf(bodiesOf(where, gangA)), idsOf(bodiesOf(where, gangB))].sort());
  assert.equal(combat.flags.acks.groups.find((g) => g.tokens.length === 3).initiative, 4, "its rolled initiative is not cleared");
  assert.equal([...combat.combatants].filter((c) => c.tokenId === gangToken.id).length, 0, "no entry of its own");
  assert.equal(combat.combatants.size, 8);
});

t("a gang fighting as one token row is sent out with the warband's bodies and has no entry of its own", async () => {
  const { where, gangA, token, combat } = warband();
  const gangToken = groupToken(where, gangA, { x: 900, y: 900 });
  await addToCombat(combat, gangToken);
  await addToCombat(combat, gangToken);
  assert.equal([...combat.combatants].filter((c) => c.tokenId === gangToken.id).length, 1, "gathered early: one row");
  assert.equal(bodiesOf(where, gangA).length, 0);
  await addToCombat(combat, token);
  assert.equal([...combat.combatants].filter((c) => c.tokenId === gangToken.id).length, 0, "its row is gone");
  assert.equal(bodiesOf(where, gangA).length, 3);
  assert.equal(gangToken.hidden, true);
  assert.equal(gangToken.getFlag(MODULE_ID, COMBAT_FLAG).combatId, combat.id);
  assert.ok(storedSets(combat).includes(idsOf(bodiesOf(where, gangA))), "its bodies are one group");
  assert.equal(combat.combatants.size, 8);
});

t("a gang token fighting in another combat, or a party's, keeps its row when the warband joins", async () => {
  const { where, gangA, gangB, token, combat } = warband();
  const away = groupToken(where, gangA, { x: 900, y: 900 });
  const party = groupToken(where, gangB, { x: 800, y: 800, flags: { [MODULE_ID]: { formationId: "f1" } } });
  const other = combatIn();
  await addToCombat(other, away);
  const [row] = await combat.createEmbeddedDocuments("Combatant", [{ tokenId: party.id, actorId: party.actorId, sceneId: where.id, hidden: false }]);
  await settle();
  assert.equal(combat.combatants.has(row.id), true, "a party's token is left to the party");
  await addToCombat(combat, token);
  assert.equal(combat.combatants.has(row.id), true);
  assert.equal(away.getFlag(MODULE_ID, COMBAT_FLAG).combatId, other.id, "the other combat keeps it");
});

t("each call waits for the stored list to hold the group before the next reads it, however late the system writes", async () => {
  const { where, outer, gangA, gangB, token, combat } = warband();
  combat.lateMs = 25;
  await addToCombat(combat, token);
  assert.deepEqual(
    combat.manageCalls.map((c) => c.read.length),
    [0, 1, 2],
    "every call read the groups the calls before it had made",
  );
  assert.deepEqual(storedSets(combat), [idsOf(bodiesOf(where, outer)), idsOf(bodiesOf(where, gangA)), idsOf(bodiesOf(where, gangB))].sort(), "no group lost to a stale read");
});

t("a system that never stores the group is waited on to the limit, warned about on the console, and the next gang goes on", async () => {
  const { where, outer, gangA, combat } = warband();
  const bodies = [];
  for (const g of [outer, gangA]) {
    for (let i = 0; i < 2; i++) {
      const b = tokenDoc(where, { actorId: g.id, flags: { [MODULE_ID]: { group: g.uuid, member: `m${i}` } } });
      where.tokens.set(b.id, b);
      bodies.push(b);
    }
  }
  await combat.createEmbeddedDocuments("Combatant", bodies.map((b) => ({ tokenId: b.id, actorId: b.actorId, sceneId: where.id })));
  const calls = [];
  combat.manageGroup = (tokens) => calls.push(tokens.map((x) => x.id));
  const warned = [];
  const was = console.warn;
  console.warn = (m) => warned.push(m);
  try {
    await groupGangs(combat, outer, bodies, { interval: 2, timeout: 20 });
  } finally {
    console.warn = was;
  }
  assert.equal(calls.length, 2, "the second gang is still grouped");
  assert.equal(warned.length, 2);
  await groupGangs({ combatants: combat.combatants }, outer, bodies);
});

t("a call that returns its write is waited on by the call itself, so the next gang reads a list that has the one before", async () => {
  const { where, outer, gangA, gangB, combat } = warband();
  const bodies = [];
  for (const g of [outer, gangA, gangB]) {
    for (let i = 0; i < 2; i++) {
      const b = tokenDoc(where, { actorId: g.id, flags: { [MODULE_ID]: { group: g.uuid, member: `m${i}` } } });
      where.tokens.set(b.id, b);
      bodies.push(b);
    }
  }
  await combat.createEmbeddedDocuments("Combatant", bodies.map((b) => ({ tokenId: b.id, actorId: b.actorId, sceneId: where.id })));
  combat.lateMs = 30;
  combat.returnsWrite = true;
  const warned = [];
  const was = console.warn;
  console.warn = (m) => warned.push(m);
  const began = Date.now();
  try {
    // A poll step far above the write's delay: only the awaited call can have ordered them.
    await groupGangs(combat, outer, bodies, { interval: 1000, timeout: 3000 });
  } finally {
    console.warn = was;
  }
  assert.ok(Date.now() - began < 500, "the poll never had to run");
  assert.deepEqual(combat.manageCalls.map((c) => c.read.length), [0, 1, 2], "every call read the groups the calls before it had made");
  assert.deepEqual(warned, []);
  assert.equal(storedSets(combat).length, 3, "no group lost to a stale read");
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
