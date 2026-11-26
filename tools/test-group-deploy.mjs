/**
 * Offline tests for the hit points a deployed body arrives with
 * (scripts/lib/group.mjs, `deploy`). The scene's create is driven the way
 * core's client runs it: the pending token is built from a clone of the
 * data, the system's `_preCreate` rolls every unlinked monster token, and only
 * then does the `preCreateToken` hook fire, with the data and the create's
 * options. Lib's hook (scripts/lib/hp.mjs) is the one installed.
 *
 * What a body is sent out with beyond its record (the caller's `extraDelta`, and the
 * items a stack's `gen.carry` names, through the registered carry resolver) is
 * checked on the token and on the record, across a recall and a second deploy.
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
        // A token document answers `toObject` with its stored delta, which a gather reads.
        const stored = delta._source;
        Object.defineProperty(stored, "toObject", { value: () => structuredClone(stored), enumerable: false });
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
const { deploy, recall, registerCarryResolver } = await import("../scripts/lib/group.mjs");
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

/* -------------------------------------------- */
/*  What a body goes out with                   */
/* -------------------------------------------- */

const itemsOf = (delta) => delta?.items ?? [];
const namesOf = (delta) => itemsOf(delta).map((i) => i.name);
const rosterOf = (group) => group.system.stacks[0].roster;
/** A carry resolver over `answers`, a row key to the item (or list) it answers; every call is logged. */
function resolver(answers) {
  const calls = [];
  registerCarryResolver((grp, stackKey, rowKey) => {
    calls.push([grp.uuid, stackKey, rowKey]);
    const answer = answers[rowKey];
    if (answer instanceof Error) throw answer;
    return answer ?? null;
  });
  return calls;
}
const lantern = { name: "Lantern", type: "item", system: { quantity: 1 } };
/** Recall every body on `where`. */
async function gather(group, where) {
  game.scenes = [where];
  await recall(group, { scene: where });
  game.scenes = [];
}

t("an extraDelta merges into a resting body and a new one alike, on the token and in the record", async () => {
  const where = scene();
  const group = groupActor(monster(), 3, [record("m1", { value: 4, max: 4 })]);
  bodyRolls.push(6);
  systemRolls.push(4, 6);
  const made = await deploy(group, where, { count: 2, extraDelta: { flags: { world: { marked: true } }, items: [{ _id: "gift1", name: "Whistle", type: "item" }] } });
  assert.equal(made.length, 2);
  for (const token of made) {
    assert.equal(token.delta.flags.world.marked, true);
    assert.deepEqual(namesOf(token.delta), ["Whistle"]);
  }
  assert.deepEqual(made.map((tk) => tk.delta.system.hp), [{ value: 4, max: 4 }, { value: 6, max: 6 }], "the record's hit points ride on");
  for (const rec of rosterOf(group)) {
    assert.equal(rec.delta.flags.world.marked, true);
    assert.deepEqual(namesOf(rec.delta), ["Whistle"]);
  }
});

t("an extraDelta function is asked once per body, in order, with the record", async () => {
  const group = groupActor(monster(), 2, [record("m1", { value: 4, max: 4 })]);
  bodyRolls.push(6);
  systemRolls.push(4, 6);
  const asked = [];
  const made = await deploy(group, scene(), {
    count: 2,
    extraDelta: (member, i) => {
      asked.push([i, member.key]);
      return i === 0 ? { flags: { world: { first: true } } } : null;
    },
  });
  assert.deepEqual(asked.map(([i]) => i), [0, 1]);
  assert.equal(asked[0][1], "m1");
  assert.equal(made[0].delta.flags.world.first, true);
  assert.equal(made[1].delta.flags, undefined, "a null answer adds nothing");
});

t("an item given at deploy survives a recall and a second deploy once", async () => {
  const where = scene();
  const group = groupActor(monster(), 1);
  bodyRolls.push(5);
  systemRolls.push(5, 5);
  const gift = { items: [{ _id: "gift1", name: "Whistle", type: "item" }] };
  await deploy(group, where, { count: 1, extraDelta: gift });
  await gather(group, where);
  assert.deepEqual(namesOf(rosterOf(group)[0].delta), ["Whistle"], "the gather folded the token's delta back, item included");
  const [made] = await deploy(group, scene(), { count: 1, extraDelta: gift });
  assert.deepEqual(namesOf(made.delta), ["Whistle"], "the same id replaces, it is not added twice");
});

t("a body keeps the items its delta already holds when an extraDelta brings another", async () => {
  const group = groupActor(monster(), 1, [{ ...record("m1", { value: 4, max: 4 }), delta: { system: { hp: { value: 4, max: 4 } }, items: [{ _id: "own1", name: "Sling", type: "item" }] } }]);
  systemRolls.push(4);
  const [made] = await deploy(group, scene(), { count: 1, extraDelta: { items: [{ _id: "gift1", name: "Whistle", type: "item" }] } });
  assert.deepEqual(namesOf(made.delta), ["Sling", "Whistle"]);
});

t("with no carry resolver registered a stack that names a carry sends its bodies out plain", async () => {
  registerCarryResolver(null);
  const group = groupActor(monster(), 2, [], { gen: { carry: { rowA: 2 } } });
  bodyRolls.push(5, 5);
  systemRolls.push(5, 5);
  const made = await deploy(group, scene(), { count: 2 });
  assert.deepEqual(made.map((tk) => itemsOf(tk.delta)), [[], []]);
  assert.deepEqual(rosterOf(group).map((m) => m.carries ?? []), [[], []]);
});

t("the resolver is asked once per carried row, and a null or a throw sends the body out without it", async () => {
  const warned = console.warn;
  console.warn = () => {};
  try {
    const calls = resolver({ rowA: lantern, rowB: null, rowC: new Error("no such row") });
    const group = groupActor(monster(), 3, [], { gen: { carry: { rowA: 2, rowB: 3, rowC: 1 } } });
    bodyRolls.push(5, 5, 5);
    systemRolls.push(5, 5, 5);
    const made = await deploy(group, scene(), { count: 3 });
    assert.deepEqual(calls.map((c) => c[2]).sort(), ["rowA", "rowB", "rowC"], "one call per row, not per body");
    assert.equal(calls[0][0], group.uuid);
    assert.equal(calls[0][1], "s1");
    assert.deepEqual(made.map((tk) => namesOf(tk.delta)), [["Lantern"], ["Lantern"], []]);
    assert.deepEqual(rosterOf(group).map((m) => m.carries), [["rowA"], ["rowA"], undefined], "a row nothing answered spends no slot");
    assert.notEqual(made[0].delta.items[0]._id, made[1].delta.items[0]._id, "each body holds a copy of its own");
  } finally {
    console.warn = warned;
    registerCarryResolver(null);
  }
});

t("a resolver answering a list gives each carrier every item of it", async () => {
  try {
    resolver({ rowA: [lantern, { name: "Flask", type: "item" }] });
    const group = groupActor(monster(), 2, [], { gen: { carry: { rowA: 1 } } });
    bodyRolls.push(5, 5);
    systemRolls.push(5, 5);
    const made = await deploy(group, scene(), { count: 2 });
    assert.deepEqual(made.map((tk) => namesOf(tk.delta)), [["Lantern", "Flask"], []]);
  } finally {
    registerCarryResolver(null);
  }
});

t("a carry's share holds across two deploys, a recall and a deploy of everyone, with no second copy", async () => {
  try {
    const calls = resolver({ rowA: lantern });
    const group = groupActor(monster(), 4, [], { gen: { carry: { rowA: 2 } } });
    bodyRolls.push(5, 5, 5, 5);
    systemRolls.push(5, 5, 5, 5);
    const first = scene();
    const [one] = await deploy(group, first, { count: 1 });
    const [two] = await deploy(group, first, { count: 1 });
    const rest = await deploy(group, first, { count: 2 });
    assert.deepEqual([one, two].map((tk) => namesOf(tk.delta)), [["Lantern"], ["Lantern"]]);
    assert.deepEqual(rest.map((tk) => namesOf(tk.delta)), [[], []], "the share was spent on the first two");
    assert.equal(calls.length, 2, "a spent share asks nothing");
    assert.equal(rosterOf(group).filter((m) => m.carries?.includes("rowA")).length, 2);

    await gather(group, first);
    const second = scene();
    systemRolls.push(5, 5, 5, 5);
    const all = await deploy(group, second, { count: Infinity });
    assert.equal(all.length, 4);
    assert.equal(all.filter((tk) => namesOf(tk.delta).length).length, 2, "the same two carry, and no one else is given one");
    assert.ok(all.every((tk) => itemsOf(tk.delta).length <= 1), "no body holds two");
    assert.equal(calls.length, 2);
  } finally {
    registerCarryResolver(null);
  }
});

t("a stamped body goes out with the item it holds and is given none, whether or not the item is still there", async () => {
  try {
    const calls = resolver({ rowA: lantern });
    const used = { ...record("m1", { value: 4, max: 4 }), carries: ["rowA"] };
    const spare = record("m2", { value: 4, max: 4 });
    const group = groupActor(monster(), 2, [used, spare], { gen: { carry: { rowA: 1 } } });
    systemRolls.push(4, 4);
    const made = await deploy(group, scene(), { count: 2 });
    assert.deepEqual(made.map((tk) => namesOf(tk.delta)), [[], []], "the stamp is the authority: an item used in the field does not come back");
    assert.deepEqual(calls, []);
  } finally {
    registerCarryResolver(null);
  }
});

t("a slot spent by a fallen body stays spent", async () => {
  try {
    const calls = resolver({ rowA: lantern });
    const fallen = { ...record("m1", { value: 0, max: 4 }), state: "dead", carries: ["rowA"] };
    const group = groupActor(monster(), 2, [fallen], { gen: { carry: { rowA: 1 } } });
    bodyRolls.push(5, 5);
    systemRolls.push(5, 5);
    const made = await deploy(group, scene(), { count: 2 });
    assert.deepEqual(made.map((tk) => namesOf(tk.delta)), [[], []]);
    assert.deepEqual(calls, []);
  } finally {
    registerCarryResolver(null);
  }
});

t("a body whose token vanished is given its item once: record and stamp were written together", async () => {
  try {
    const calls = resolver({ rowA: lantern });
    const where = scene();
    const group = groupActor(monster(), 1, [], { gen: { carry: { rowA: 1 } } });
    bodyRolls.push(5);
    systemRolls.push(5, 5);
    const [made] = await deploy(group, where, { count: 1 });
    // The token is gone with no fold: the record is freed in place, as a hand-cleared board leaves it.
    where.tokens.delete(made.id);
    docs.delete(made.uuid);
    const [again] = await deploy(group, scene(), { count: 1 });
    assert.deepEqual(namesOf(again.delta), ["Lantern"]);
    assert.equal(calls.length, 1);
  } finally {
    registerCarryResolver(null);
  }
});

/* -------------------------------------------- */
/*  A press on a stack row                      */
/* -------------------------------------------- */

t("`carrying` sends the resting body stamped with the row before an earlier unstamped one", async () => {
  try {
    const calls = resolver({ rowA: lantern });
    const plain = record("m1", { value: 4, max: 4 });
    const bearer = { ...record("m2", { value: 4, max: 4 }), carries: ["rowA"], delta: { system: { hp: { value: 4, max: 4 } }, items: [{ _id: "own", name: "Lantern", type: "item" }] } };
    const group = groupActor(monster(), 2, [plain, bearer], { gen: { carry: { rowA: 1 } } });
    systemRolls.push(4);
    const [made] = await deploy(group, scene(), { count: 1, carrying: "rowA" });
    assert.equal(made.getFlag(MODULE_ID, "member"), "m2", "the carrier, not the lower ordinal");
    assert.deepEqual(namesOf(made.delta), ["Lantern"]);
    assert.deepEqual(calls, [], "its slot was spent, nothing is asked again");
    assert.deepEqual(rosterOf(group).map((m) => m.state), ["materialized", "deployed"]);
  } finally {
    registerCarryResolver(null);
  }
});

t("without `carrying`, the lower ordinal goes first, as before", async () => {
  const group = groupActor(monster(), 2, [record("m1", { value: 4, max: 4 }), { ...record("m2", { value: 4, max: 4 }), carries: ["rowA"] }]);
  systemRolls.push(4);
  const [made] = await deploy(group, scene(), { count: 1 });
  assert.equal(made.getFlag(MODULE_ID, "member"), "m1");
});

t("deployAnchor is the group's own token on the scene, else the playable area's centre", async () => {
  const { deployAnchor } = await import("../scripts/lib/group.mjs");
  const group = groupActor(monster(), 1);
  const bare = { tokens: [], width: 4000, height: 3000, dimensions: { sceneRect: { x: 100, y: 200, width: 1000, height: 600 } } };
  assert.deepEqual(deployAnchor(group, bare), { x: 600, y: 500 });
  assert.deepEqual(deployAnchor(group, { ...bare, dimensions: undefined }), { x: 2000, y: 1500 });
  bare.tokens.push({ actorId: group.id, x: 340, y: 270 });
  assert.deepEqual(deployAnchor(group, bare), { x: 340, y: 270 });
});

t("the stack-row control seam: one registration, replaced or cleared, read safely, pressed only by a seat that can deploy", async () => {
  const { registerStackRowControl, stackRowControls, pressStackRowControl } = await import("../scripts/lib/group.mjs");
  const group = groupActor(monster(), 1, [], { gen: { carry: { rowA: 1 } } });
  const stack = group.system.stacks[0];
  assert.deepEqual(stackRowControls(group, stack), [], "nothing registered");
  const pressed = [];
  const undo = registerStackRowControl((grp, stk) => [{ key: "a", label: "Raise", press: async () => pressed.push(["a", grp.uuid, stk.key]) }, { label: "no key" }, null, { key: "off", disabled: true, press: async () => pressed.push("off") }]);
  assert.deepEqual(stackRowControls(group, stack).map((c) => c.key), ["a", "off"], "an entry with no key is dropped");
  globalThis.game.user = { can: () => true };
  group.isOwner = false;
  assert.equal(await pressStackRowControl(group, "s1", "a"), undefined, "a seat that owns nothing presses nothing");
  group.isOwner = true;
  assert.equal(await pressStackRowControl(group, "s1", "off"), undefined, "a held-off control does not run");
  assert.equal(await pressStackRowControl(group, "s1", "gone"), undefined);
  await pressStackRowControl(group, "s1", "a");
  assert.deepEqual(pressed, [["a", group.uuid, "s1"]]);
  globalThis.game.user = { can: () => false };
  assert.equal(await pressStackRowControl(group, "s1", "a"), undefined, "no right to create tokens");
  const warned = console.warn;
  console.warn = () => {};
  try {
    registerStackRowControl(() => {
      throw new Error("broken");
    });
    assert.deepEqual(stackRowControls(group, stack), [], "a throw gives none");
    undo();
    assert.deepEqual(stackRowControls(group, stack), [], "the first registration's undo leaves the one that replaced it");
    registerStackRowControl(null);
  } finally {
    console.warn = warned;
  }
  registerStackRowControl(() => [{ key: "z" }])();
  assert.deepEqual(stackRowControls(group, stack), [], "an undone registration leaves none");
  delete globalThis.game.user;
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
