/**
 * Player summons: the pure checks (what a request must hold, how casts group,
 * what a preview carries) and the GM's relay run against documents that behave
 * like Foundry's, so the authorization is held to the cases that matter — a
 * seat that does not own the summoner, a creature it cannot read, a count or a
 * place the relay will not act on, a dismissal of a token the module did not
 * make. The seat's click-to-place and the sockets are live-only.
 *
 * Usage: node tools/test-summons.mjs
 */
import assert from "node:assert/strict";

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

const M = "acks-extras";
const OWNER = 3;

class Coll extends Map {
  get contents() { return [...this.values()]; }
  find(fn) { return this.contents.find(fn); }
  filter(fn) { return this.contents.filter(fn); }
  [Symbol.iterator]() { return this.values(); }
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const merge = (a, b) => {
  const out = clone(a);
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" ? merge(out[k], v) : clone(v);
  }
  return out;
};
const flagOf = (data) => (scope, key) => data.flags?.[scope]?.[key];

let serial = 0;
const calls = { actorCreate: [], folderCreate: [], tokenCreate: [], tokenDelete: [] };
const registry = new Map();

const user = (id, isGM = false, viewedScene = null) => ({ id, isGM, viewedScene });
const gm = user("gm", true);
const p1 = user("p1");
const p2 = user("p2");
const stranger = user("p3");

const world = {
  users: new Map([gm, p1, p2, stranger].map((u) => [u.id, u])),
  scenes: new Map(),
  actors: new Coll(),
  folders: new Coll(),
};

globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER } };
globalThis.game = {
  user: gm,
  users: world.users,
  scenes: world.scenes,
  actors: world.actors,
  folders: world.folders,
  packs: [],
  time: { worldTime: 42 },
  i18n: { localize: (k) => k, format: (k) => k },
};
globalThis.foundry = { utils: { mergeObject: (a, b) => merge(a, b), randomID: () => `rid${++serial}`, escapeHTML: (s) => String(s) } };
globalThis.Hooks = { on() {}, once() {}, call() {}, callAll() {} };
globalThis.fromUuid = async (uuid) => registry.get(uuid) ?? null;
globalThis.fromUuidSync = (uuid) => registry.get(uuid) ?? null;

const level = (ownership, u) => (u.isGM ? OWNER : (ownership[u.id] ?? ownership.default ?? 0));

globalThis.Folder = {
  create: async (data) => {
    calls.folderCreate.push(data);
    const folder = { id: `fol${++serial}`, ...data, getFlag: flagOf(data) };
    world.folders.set(folder.id, folder);
    return folder;
  },
};

globalThis.Actor = {
  create: async (data) => {
    calls.actorCreate.push(data);
    const id = `copy${++serial}`;
    const actor = {
      id,
      uuid: `Actor.${id}`,
      data,
      getFlag: flagOf(data),
      getTokenDocument: async (place) => ({ toObject: () => ({ _id: `tmp${++serial}`, name: data.name, actorId: id, ...clone(place) }) }),
    };
    world.actors.set(id, actor);
    registry.set(actor.uuid, actor);
    return actor;
  },
};

/** A summoner character: `owners` hold OWNER, `items` is a list of {id, type}. */
function makeSummoner(id, owners, items = []) {
  const ownership = { default: 0 };
  for (const o of owners) ownership[o] = OWNER;
  const doc = {
    id,
    uuid: `Actor.${id}`,
    type: "character",
    name: `Char ${id}`,
    ownership,
    items: new Coll(items.map((i) => [i.id, i])),
    testUserPermission: (u, lvl) => level(ownership, u) >= (typeof lvl === "string" ? { OWNER, OBSERVER: 2, LIMITED: 1 }[lvl] : lvl),
  };
  registry.set(doc.uuid, doc);
  return doc;
}

/** A library creature in a compendium that `readers` may open. */
function makeSource(id, { type = "monster", readers = [p1.id, p2.id, stranger.id] } = {}) {
  const doc = {
    id,
    uuid: `Compendium.test.Actor.${id}`,
    type,
    name: `Creature ${id}`,
    compendium: { testUserPermission: (u) => u.isGM || readers.includes(u.id) },
    toObject: () => ({
      _id: id,
      name: `Creature ${id}`,
      type,
      folder: "packFolder",
      ownership: { default: 2 },
      flags: { [M]: { cookbook: { id: "x" }, keep: 1 } },
      prototypeToken: { actorLink: true },
    }),
  };
  registry.set(doc.uuid, doc);
  return doc;
}

/** A scene that records the tokens made on it and the ones deleted. */
function makeScene(id, { active = true, rect = { x: 0, y: 0, width: 1000, height: 1000 }, viewers = [] } = {}) {
  const scene = {
    id,
    active,
    dimensions: { rect },
    tokens: new Coll(),
    testUserPermission: (u) => viewers.includes(u.id),
    createEmbeddedDocuments: async (_type, datas) => {
      const made = datas.map((d) => {
        const tokenId = `tok${++serial}`;
        const doc = { ...tokenCtx(scene, tokenId, d), data: d };
        scene.tokens.set(tokenId, doc);
        registry.set(doc.uuid, doc);
        calls.tokenCreate.push(d);
        return doc;
      });
      return made;
    },
    deleteEmbeddedDocuments: async (_type, ids) => {
      for (const tid of ids) {
        scene.tokens.delete(tid);
        calls.tokenDelete.push(tid);
      }
      return ids.map((i) => ({ id: i }));
    },
  };
  world.scenes.set(id, scene);
  return scene;
}

/** A scene token whose synthetic actor carries `flags`. */
function tokenCtx(scene, id, data) {
  const flags = data?.delta?.flags ?? {};
  return { documentName: "Token", id, uuid: `Scene.${scene.id}.Token.${id}`, parent: scene, actor: { getFlag: (s, k) => flags[s]?.[k] } };
}

const reset = () => {
  for (const k of Object.keys(calls)) calls[k].length = 0;
  world.actors.clear();
  world.folders.clear();
  registry.clear();
  world.scenes.clear();
};

const { summonRelay } = await import("../scripts/lib/summons.mjs");
const logic = await import("../scripts/lib/summons-logic.mjs");

let n = 0;
const t = async (name, fn) => {
  reset();
  await fn();
  n++;
  console.log(`ok - ${name}`);
};

const place = (over = {}) => ({
  op: "place",
  summonerUuid: "Actor.sum",
  sourceUuid: "Compendium.test.Actor.m1",
  sceneId: "s1",
  positions: [{ x: 100, y: 100 }, { x: 200, y: 200, rotation: 90 }],
  count: 2,
  requestUserId: p1.id,
  ...over,
});

const setup = (extra = {}) => {
  const summoner = makeSummoner("sum", [p1.id, p2.id], extra.items ?? []);
  const source = makeSource("m1", extra.source);
  const scene = makeScene("s1", extra.scene);
  return { summoner, source, scene };
};

/* -------------------------------------------- */
/*  The relay: placing                          */
/* -------------------------------------------- */

await t("a seat that does not own the summoner is refused before anything is made", async () => {
  setup();
  const out = await summonRelay(place({ requestUserId: stranger.id }));
  assert.deepEqual(out, { ok: false, reason: "notOwner" });
  assert.equal(calls.actorCreate.length + calls.tokenCreate.length + calls.folderCreate.length, 0);
});

await t("a request from no known user is refused", async () => {
  setup();
  assert.deepEqual(await summonRelay(place({ requestUserId: "ghost" })), { ok: false, reason: "noUser" });
});

await t("an owner's request makes one world copy and unlinked tokens owned through their delta", async () => {
  const { summoner, scene } = setup();
  const out = await summonRelay(place({ castId: "castA1" }));
  assert.equal(out.ok, true);
  assert.equal(out.castId, "castA1");
  assert.equal(out.tokenUuids.length, 2);
  assert.equal(calls.actorCreate.length, 1);
  const copy = calls.actorCreate[0];
  assert.deepEqual(copy.ownership, { default: 0 }, "the copy is owned by nobody but the GM");
  assert.equal(copy.prototypeToken.actorLink, false);
  assert.equal(copy.flags[M].cookbook, undefined, "the library's mark is shed");
  assert.equal(copy.flags[M].keep, 1);
  assert.equal(copy.flags[M][logic.SUMMON_COPY_FLAG].sourceUuid, "Compendium.test.Actor.m1");
  assert.equal(copy.folder, calls.folderCreate.length ? [...world.folders.values()][0].id : null);
  assert.equal(calls.folderCreate.length, 1);
  assert.equal(calls.tokenCreate.length, 2);
  for (const d of calls.tokenCreate) {
    assert.equal(d.actorLink, false);
    assert.deepEqual(d.delta.ownership, { p1: OWNER, p2: OWNER }, "every owner of the character, never a GM");
    assert.equal(d.delta.flags[M][logic.SUMMON_FLAG], summoner.uuid);
    const rec = d.delta.flags[M][logic.SUMMON_RECORD_FLAG];
    assert.equal(rec.castId, "castA1");
    assert.equal(rec.at, 42, "the GM's clock");
    assert.equal(rec.sourceUuid, "Compendium.test.Actor.m1");
    assert.equal(rec.spellId, undefined);
    assert.equal(d._id, undefined);
  }
  assert.equal(calls.tokenCreate[1].rotation, 90);
  assert.equal(scene.tokens.size, 2);
});

await t("a second summoning of the same creature reuses the copy and the folder", async () => {
  setup();
  await summonRelay(place());
  await summonRelay(place({ positions: [{ x: 5, y: 5 }], count: 1 }));
  assert.equal(calls.actorCreate.length, 1);
  assert.equal(calls.folderCreate.length, 1);
  assert.equal(calls.tokenCreate.length, 3);
});

await t("two requests for one creature at once make one copy", async () => {
  setup();
  const [a, b] = await Promise.all([summonRelay(place()), summonRelay(place({ requestUserId: p2.id }))]);
  assert.equal(a.ok && b.ok, true);
  assert.equal(calls.actorCreate.length, 1);
});

await t("a malformed cast id is replaced by the GM's own", async () => {
  setup();
  const out = await summonRelay(place({ castId: "<script>" }));
  assert.match(out.castId, /^rid\d+$/);
});

await t("a spell is recorded only when it is a spell on the summoner", async () => {
  setup({ items: [{ id: "sp1", type: "spell" }, { id: "wp1", type: "weapon" }] });
  const ok = await summonRelay(place({ spellId: "sp1" }));
  assert.equal(calls.tokenCreate[0].delta.flags[M][logic.SUMMON_RECORD_FLAG].spellId, "sp1");
  assert.equal(ok.ok, true);
  assert.deepEqual(await summonRelay(place({ spellId: "wp1" })), { ok: false, reason: "badSpell" });
  assert.deepEqual(await summonRelay(place({ spellId: "nope" })), { ok: false, reason: "badSpell" });
});

await t("a count or a set of places the relay will not act on is refused", async () => {
  setup();
  assert.equal((await summonRelay(place({ count: 0, positions: [] }))).reason, "badCount");
  assert.equal((await summonRelay(place({ count: 1.5, positions: [{ x: 1, y: 1 }] }))).reason, "badCount");
  assert.equal((await summonRelay(place({ count: logic.MAX_SUMMONS + 1, positions: [] }))).reason, "badCount");
  assert.equal((await summonRelay(place({ count: 3 }))).reason, "badPositions", "positions must match the count");
  assert.equal((await summonRelay(place({ positions: [{ x: 1, y: 1 }, { x: NaN, y: 3 }] }))).reason, "badPositions");
  assert.equal((await summonRelay(place({ positions: [{ x: 1, y: 1 }, { x: 5000, y: 3 }] }))).reason, "badPositions", "off the map");
  assert.equal(calls.tokenCreate.length, 0);
});

await t("a creature the seat cannot read, or that is not a creature, is refused", async () => {
  makeSummoner("sum", [p1.id]);
  makeScene("s1");
  makeSource("m1", { readers: [] });
  makeSource("c1", { type: "character" });
  assert.equal((await summonRelay(place())).reason, "unreadable");
  assert.equal((await summonRelay(place({ sourceUuid: "Compendium.test.Actor.c1" }))).reason, "badSource");
  assert.equal((await summonRelay(place({ sourceUuid: "Compendium.test.Actor.none" }))).reason, "badSource");
  assert.equal(calls.actorCreate.length, 0);
});

await t("a scene the seat is not looking at is refused; the active one and the viewed one are not", async () => {
  setup({ scene: { active: false } });
  assert.equal((await summonRelay(place())).reason, "badScene");
  p1.viewedScene = "s1";
  assert.equal((await summonRelay(place())).ok, true);
  p1.viewedScene = null;
  world.scenes.get("s1").active = true;
  assert.equal((await summonRelay(place())).ok, true);
});

await t("a GM's own request needs no ownership and grants the character's owners", async () => {
  setup();
  const out = await summonRelay(place({ requestUserId: null }));
  assert.equal(out.ok, true);
  assert.deepEqual(calls.tokenCreate[0].delta.ownership, { p1: OWNER, p2: OWNER });
});

await t("an unknown operation is refused", async () => {
  setup();
  assert.deepEqual(await summonRelay({ op: "wipe", requestUserId: p1.id }), { ok: false, reason: "badOp" });
});

/* -------------------------------------------- */
/*  The relay: dismissing                       */
/* -------------------------------------------- */

const summoned = (scene, summonerUuid, record) => {
  const id = `tok${++serial}`;
  const delta = { flags: { [M]: { [logic.SUMMON_FLAG]: summonerUuid, ...(record ? { [logic.SUMMON_RECORD_FLAG]: record } : {}) } } };
  const doc = tokenCtx(scene, id, { delta });
  scene.tokens.set(id, doc);
  registry.set(doc.uuid, doc);
  return doc;
};

await t("a dismissal removes the tokens the module made for this summoner and no others", async () => {
  const { summoner, scene } = setup();
  const mine = summoned(scene, summoner.uuid, { castId: "c1", sourceUuid: "x", at: 1 });
  const byHand = summoned(scene, summoner.uuid, null);
  const theirs = summoned(scene, "Actor.other", { castId: "c2", sourceUuid: "x", at: 1 });
  const plain = { documentName: "Token", id: "plain", uuid: "Scene.s1.Token.plain", parent: scene, actor: { getFlag: () => undefined } };
  registry.set(plain.uuid, plain);
  scene.tokens.set("plain", plain);
  const out = await summonRelay({ op: "dismiss", summonerUuid: summoner.uuid, tokenUuids: [mine, byHand, theirs, plain].map((x) => x.uuid), requestUserId: p1.id });
  assert.deepEqual(out, { ok: true, deleted: 1, refused: 3 });
  assert.deepEqual(calls.tokenDelete, [mine.id]);
  assert.equal(scene.tokens.has(byHand.id), true, "a creature bound by hand stays");
});

await t("a dismissal from a seat that does not own the summoner deletes nothing", async () => {
  const { summoner, scene } = setup();
  const mine = summoned(scene, summoner.uuid, { castId: "c1", sourceUuid: "x", at: 1 });
  const out = await summonRelay({ op: "dismiss", summonerUuid: summoner.uuid, tokenUuids: [mine.uuid], requestUserId: stranger.id });
  assert.deepEqual(out, { ok: false, reason: "notOwner" });
  assert.equal(calls.tokenDelete.length, 0);
});

await t("a dismissal names stale or foreign uuids without throwing", async () => {
  const { summoner } = setup();
  const out = await summonRelay({ op: "dismiss", summonerUuid: summoner.uuid, tokenUuids: ["Scene.s1.Token.gone", "Actor.sum", null], requestUserId: p1.id });
  assert.deepEqual(out, { ok: true, deleted: 0, refused: 0 });
});

/* -------------------------------------------- */
/*  The pure half                               */
/* -------------------------------------------- */

await t("the same checks serve the seat before it asks the GM", () => {
  const summoner = makeSummoner("sum", [p1.id]);
  const source = makeSource("m1");
  assert.deepEqual(logic.checkPlaceRequest({ user: p1, summoner, source, count: 2 }), { ok: true });
  assert.equal(logic.checkPlaceRequest({ user: stranger, summoner, source, count: 2 }).reason, "notOwner");
  assert.equal(logic.checkPlaceRequest({ user: p1, summoner: source, source, count: 2 }).reason, "notSummoner");
  assert.equal(logic.checkPlaceRequest({ user: p1, summoner, source, count: 0 }).reason, "badCount");
  assert.equal(logic.checkPlaceRequest({ summoner, source, count: 1 }).reason, "noUser");
});

await t("casts group by their record, oldest first, with hand-bound creatures apart", () => {
  const e = (name, record) => ({ name, record });
  const { casts, loose } = logic.groupByCast([
    e("a", { castId: "late", name: "Wolf", at: 9 }),
    e("b", { castId: "early", name: "Bear", at: 2 }),
    e("c", { castId: "late", name: "Wolf", at: 9 }),
    e("d", null),
    null,
  ]);
  assert.deepEqual(casts.map((c) => [c.castId, c.name, c.entries.length]), [["early", "Bear", 1], ["late", "Wolf", 2]]);
  assert.equal(loose.length, 2);
  assert.deepEqual(logic.groupByCast(undefined), { casts: [], loose: [] });
});

await t("a pack index offers creatures by name and nothing else", () => {
  const index = [
    { uuid: "u2", name: "Zebra", type: "monster" },
    { uuid: "u1", name: "Ant", type: `${M}.animal` },
    { uuid: "u3", name: "Hero", type: "character" },
    { name: "No uuid", type: "monster" },
  ];
  assert.deepEqual(logic.summonEntries(index), [{ uuid: "u1", name: "Ant" }, { uuid: "u2", name: "Zebra" }]);
  assert.deepEqual(logic.summonEntries(null), []);
});

await t("a preview carries the creature's look and nothing that acts", () => {
  const proto = { name: "Wolf", texture: { src: "w.webp" }, width: 2, height: 2, disposition: -1, light: { dim: 30 }, sight: { enabled: true }, flags: { x: 1 }, displayBars: 50, actorLink: true, randomImg: true };
  const p = logic.previewTokenData(proto, "sum");
  assert.deepEqual(p, { name: "Wolf", actorId: "sum", actorLink: false, hidden: false, displayName: 0, displayBars: 0, x: 0, y: 0, texture: { src: "w.webp" }, width: 2, height: 2, disposition: -1 });
  assert.equal(proto.actorLink, true, "the prototype is not touched");
  assert.equal(logic.previewTokenData(null, "s").actorId, "s");
});

await t("placed positions are plain records, and a placement cut short yields fewer", () => {
  const docs = [{ _source: { x: 10, y: 20, elevation: 5, rotation: 90, level: "lv" } }, { _source: { x: 1, y: 2, elevation: "a" } }];
  assert.deepEqual(logic.placedPositions(docs), [{ x: 10, y: 20, elevation: 5, rotation: 90, level: "lv" }, { x: 1, y: 2 }]);
  assert.deepEqual(logic.placedPositions([]), []);
  assert.deepEqual(logic.placedPositions(undefined), []);
});

await t("summon ownership is every non-GM owner plus the requester", () => {
  const isGM = (id) => id === "gm";
  assert.deepEqual(logic.summonOwnership({ default: 3, a: 3, b: 2, gm: 3 }, ["c", "gm"], isGM), { a: OWNER, c: OWNER });
  assert.deepEqual(logic.summonOwnership(undefined), {});
});

await t("flags name the summoner and carry the record", () => {
  const f = logic.summonFlags("Actor.s", { sourceUuid: "u", name: "Wolf", castId: "c", at: 7 });
  assert.deepEqual(f, { [M]: { [logic.SUMMON_FLAG]: "Actor.s", [logic.SUMMON_RECORD_FLAG]: { sourceUuid: "u", name: "Wolf", castId: "c", at: 7 } } });
  const actor = { getFlag: (s, k) => f[s]?.[k] };
  assert.equal(logic.summonerOf(actor), "Actor.s");
  assert.equal(logic.summonRecordOf(actor).castId, "c");
  assert.equal(logic.summonRecordOf({ getFlag: () => ({ nope: 1 }) }), null);
  assert.equal(logic.summonerOf(null), null);
});

console.log(`\ntest-summons: ${n} tests passed`);
