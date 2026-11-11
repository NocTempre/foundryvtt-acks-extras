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

/** The spell every request names unless a test says otherwise: a Player seat may only summon through one. */
const SPELL = { id: "sp1", type: "spell", name: "Thornwake Call" };

const place = (over = {}) => ({
  op: "place",
  summonerUuid: "Actor.sum",
  sourceUuid: "Compendium.test.Actor.m1",
  sceneId: "s1",
  positions: [{ x: 100, y: 100 }, { x: 200, y: 200, rotation: 90 }],
  count: 2,
  spellId: SPELL.id,
  requestUserId: p1.id,
  ...over,
});

const setup = (extra = {}) => {
  const summoner = makeSummoner("sum", [p1.id, p2.id], extra.items ?? [SPELL]);
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
    assert.equal(rec.spellId, SPELL.id);
    assert.equal(rec.spellName, SPELL.name, "the record carries the spell's name, read by the GM's client");
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
  setup({ items: [SPELL, { id: "wp1", type: "weapon", name: "Blade" }] });
  const ok = await summonRelay(place({ spellId: "sp1" }));
  assert.equal(calls.tokenCreate[0].delta.flags[M][logic.SUMMON_RECORD_FLAG].spellId, "sp1");
  assert.equal(ok.ok, true);
  assert.deepEqual(await summonRelay(place({ spellId: "wp1" })), { ok: false, reason: "badSpell" });
  assert.deepEqual(await summonRelay(place({ spellId: "nope" })), { ok: false, reason: "badSpell" });
});

await t("the spell's name is the item's, never the payload's", async () => {
  setup();
  await summonRelay(place({ spellId: SPELL.id, spellName: "Forged Name" }));
  assert.equal(calls.tokenCreate[0].delta.flags[M][logic.SUMMON_RECORD_FLAG].spellName, SPELL.name);
});

await t("a Player seat with no spell is refused spellRequired and nothing is made; a GM seat is not", async () => {
  setup();
  assert.equal(logic.bareSummonAllowed(p1), false);
  assert.equal(logic.bareSummonAllowed(gm), true);
  assert.deepEqual(await summonRelay(place({ spellId: "" })), { ok: false, reason: "spellRequired" });
  assert.equal(calls.actorCreate.length + calls.tokenCreate.length, 0);
  const bare = await summonRelay(place({ spellId: "", requestUserId: null }));
  assert.equal(bare.ok, true, "a GM's bare summoning stands");
  const rec = calls.tokenCreate[0].delta.flags[M][logic.SUMMON_RECORD_FLAG];
  assert.equal(rec.spellId, undefined);
  assert.equal(rec.spellName, undefined);
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
  const summoner = makeSummoner("sum", [p1.id], [SPELL]);
  const source = makeSource("m1");
  const spellId = SPELL.id;
  assert.deepEqual(logic.checkPlaceRequest({ user: p1, summoner, source, count: 2, spellId }), { ok: true });
  assert.equal(logic.checkPlaceRequest({ user: stranger, summoner, source, count: 2, spellId }).reason, "notOwner");
  assert.equal(logic.checkPlaceRequest({ user: p1, summoner: source, source, count: 2, spellId }).reason, "notSummoner");
  assert.equal(logic.checkPlaceRequest({ user: p1, summoner, source, count: 0, spellId }).reason, "badCount");
  assert.equal(logic.checkPlaceRequest({ summoner, source, count: 1, spellId }).reason, "noUser");
});

await t("spellRequired follows the one switch: GM-only as shipped, everyone when it is flipped", async () => {
  const summoner = makeSummoner("sum", [p1.id], [SPELL]);
  const source = makeSource("m1");
  const bare = { summoner, source, count: 1 };
  assert.equal(logic.checkPlaceRequest({ user: p1, ...bare }).reason, "spellRequired", "shipped: a Player seat needs a spell");
  assert.equal(logic.checkPlaceRequest({ user: gm, ...bare }).ok, true, "shipped: a GM seat may summon bare");
  assert.equal(logic.checkPlaceRequest({ user: p1, ...bare, spellId: SPELL.id }).ok, true, "a spell is never held to the switch");

  // The other position: the same module with its one switch line rewritten, in a scratch copy.
  const { mkdtemp, readFile, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const dir = await mkdtemp(join(tmpdir(), "acks-summons-switch-"));
  try {
    const line = "export const bareSummonAllowed = (user) => !!user?.isGM;";
    const src = await readFile(new URL("../scripts/lib/summons-logic.mjs", import.meta.url), "utf8");
    assert.ok(src.includes(line), "the switch is one line the test can flip");
    await writeFile(join(dir, "summons-logic.mjs"), src.replace(line, "export const bareSummonAllowed = (user) => !!user;"));
    await writeFile(join(dir, "constants.mjs"), await readFile(new URL("../scripts/lib/constants.mjs", import.meta.url), "utf8"));
    const flipped = await import(pathToFileURL(join(dir, "summons-logic.mjs")).href);
    assert.equal(flipped.checkPlaceRequest({ user: p1, ...bare }).ok, true, "flipped: a Player seat may summon bare");
    assert.equal(flipped.checkPlaceRequest({ user: stranger, ...bare }).reason, "notOwner", "ownership is still checked first");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await t("a registered policy refuses with its own reason, on the seat and on the relay", async () => {
  const { summoner } = setup();
  const source = makeSource("m1");
  const seen = [];
  const off = logic.registerSummonPolicy((req) => {
    seen.push(req);
    return req.source.name === "Creature m1" ? "notNamed" : null;
  });
  try {
    assert.equal(logic.checkPlaceRequest({ user: p1, summoner, source, count: 1, spellId: SPELL.id }).reason, "notNamed");
    assert.equal(seen[0].spell, summoner.items.get(SPELL.id), "the policy is handed the spell item");
    assert.deepEqual(await summonRelay(place()), { ok: false, reason: "notNamed" });
    assert.equal(calls.actorCreate.length + calls.tokenCreate.length, 0, "a refused request makes nothing");
  } finally {
    assert.equal(off(), true);
  }
  assert.equal(off(), false, "unregistering twice says so");
  assert.equal(logic.checkPlaceRequest({ user: p1, summoner, source, count: 1, spellId: SPELL.id }).ok, true, "once removed it no longer refuses");
  assert.throws(() => logic.registerSummonPolicy("nope"), TypeError);
});

await t("a policy that answers null allows; a throwing policy is logged and treated as an allow", () => {
  const summoner = makeSummoner("sum", [p1.id], [SPELL]);
  const source = makeSource("m1");
  const req = { user: p1, summoner, source, count: 1, spellId: SPELL.id };
  const logged = [];
  const realError = console.error;
  console.error = (...args) => logged.push(args);
  const offs = [logic.registerSummonPolicy(() => null), logic.registerSummonPolicy(() => { throw new Error("broken policy"); })];
  try {
    assert.deepEqual(logic.checkPlaceRequest(req), { ok: true }, "a throwing policy lets the request through");
    assert.equal(logged.length, 1, "and is logged once");
    assert.match(String(logged[0][0]), /summon policy threw/);
    offs.push(logic.registerSummonPolicy(() => "badCount"));
    assert.equal(logic.checkPlaceRequest(req).reason, "badCount", "a later policy still refuses after a throwing one");
  } finally {
    console.error = realError;
    for (const off of offs) off();
  }
});

/* -------------------------------------------- */
/*  A spell-named creature, resolved by the GM   */
/* -------------------------------------------- */

const COOKBOOK = "def.invented.glimmerkin";

/** A library creature on a shelf nobody but the GM can open, found by its cookbook id in the world. */
function makeShelfSource(id = "shelf1", cookbook = COOKBOOK) {
  const data = { flags: { [M]: { cookbook: { id: cookbook } } } };
  const doc = {
    id,
    uuid: `Compendium.test.Actor.${id}`,
    type: "monster",
    name: `Creature ${id}`,
    flags: data.flags,
    getFlag: flagOf(data),
    compendium: { testUserPermission: (u) => u.isGM },
    toObject: () => ({ _id: id, name: `Creature ${id}`, type: "monster", flags: { [M]: { cookbook: { id: cookbook } } }, prototypeToken: {} }),
  };
  world.actors.set(`lib-${id}`, doc);
  registry.set(doc.uuid, doc);
  return doc;
}

/** Register a naming that says the spell names the creature carrying the cookbook id. */
const nameByCookbook = (id = COOKBOOK) =>
  logic.registerSummonNaming((req) => (req.source ? req.source.flags?.[M]?.cookbook?.id === id : req.sourceRef === id));

await t("a spell-named creature is resolved on the GM's client by its cookbook id, and the seat never opens its shelf", async () => {
  setup();
  const shelf = makeShelfSource();
  const off = nameByCookbook();
  try {
    const out = await summonRelay(place({ sourceUuid: COOKBOOK, castId: "castS1" }));
    assert.equal(out.ok, true, "a Player seat summons a creature on a shelf it cannot read");
    assert.equal(calls.tokenCreate.length, 2);
    const rec = calls.tokenCreate[0].delta.flags[M][logic.SUMMON_RECORD_FLAG];
    assert.equal(rec.sourceUuid, shelf.uuid, "the record names the resolved document, not the ref the seat sent");
    assert.equal(rec.castId, "castS1");
    assert.equal(calls.actorCreate[0].flags[M][logic.SUMMON_COPY_FLAG].sourceUuid, shelf.uuid, "the one world copy is keyed by the resolved uuid");
    assert.equal((await summonRelay(place({ sourceUuid: `uuid:${shelf.uuid}`, positions: [{ x: 5, y: 5 }], count: 1 }))).ok, true, "a uuid: prefix and a plain uuid resolve too");
    assert.equal(calls.actorCreate.length, 1, "both reach the one copy");
  } finally {
    off();
  }
});

await t("a ref no lookup answers is badSource, and a bare request never reaches the library by an id", async () => {
  setup();
  makeShelfSource();
  const off = nameByCookbook();
  try {
    assert.equal((await summonRelay(place({ sourceUuid: "def.invented.nobody" }))).reason, "badSource");
    assert.equal((await summonRelay(place({ sourceUuid: "" }))).reason, "badSource");
    const bare = await summonRelay(place({ sourceUuid: COOKBOOK, spellId: "", requestUserId: null }));
    assert.equal(bare.reason, "badSource", "a GM's bare request names a document, not a cookbook id");
    assert.equal(calls.tokenCreate.length, 0);
  } finally {
    off();
  }
});

await t("the unreadable exemption is the naming's: a creature the spell does not name stays unreadable, and nothing is made", async () => {
  setup();
  makeShelfSource();
  makeShelfSource("shelf2", "def.invented.other");
  const off = nameByCookbook();
  try {
    assert.equal((await summonRelay(place({ sourceUuid: COOKBOOK }))).ok, true);
    const forged = await summonRelay(place({ sourceUuid: "def.invented.other" }));
    assert.deepEqual(forged, { ok: false, reason: "unreadable" }, "a forged request for another shelf creature");
    assert.equal(calls.actorCreate.length, 1, "only the named creature was copied");
  } finally {
    off();
  }
  assert.equal((await summonRelay(place({ sourceUuid: COOKBOOK }))).reason, "unreadable", "with the naming removed the exemption is gone");
});

await t("a bare request naming a source the seat chose is unreadable, whatever a naming says", async () => {
  setup();
  makeShelfSource();
  const off = logic.registerSummonNaming(() => true);
  try {
    assert.equal((await summonRelay(place({ sourceUuid: "Compendium.test.Actor.shelf1", spellId: "" }))).reason, "unreadable", "no spell, no exemption, whatever the naming answers");
    const bareForGm = await summonRelay(place({ sourceUuid: "Compendium.test.Actor.shelf1", spellId: "", requestUserId: null }));
    assert.equal(bareForGm.ok, true, "a GM reads every shelf");
  } finally {
    off();
  }
});

await t("a naming that throws is logged and does not exempt; a naming must answer exactly true", async () => {
  setup();
  makeShelfSource();
  const logged = [];
  const realError = console.error;
  console.error = (...args) => logged.push(String(args[0]));
  const offs = [logic.registerSummonNaming(() => { throw new Error("broken naming"); }), logic.registerSummonNaming(() => "yes")];
  try {
    assert.equal((await summonRelay(place({ sourceUuid: COOKBOOK }))).reason, "unreadable", "a throwing naming does not exempt");
    assert.equal((await summonRelay(place({ sourceUuid: "Compendium.test.Actor.shelf1" }))).reason, "unreadable");
    assert.match(logged[0], /summon naming threw/);
  } finally {
    console.error = realError;
    for (const off of offs) off();
  }
  assert.throws(() => logic.registerSummonNaming(null), TypeError);
});

await t("the seat's own pre-check leaves a spell-named, unresolvable ref to the GM, and the relay never does", () => {
  const summoner = makeSummoner("sum", [p1.id], [SPELL]);
  const off = nameByCookbook();
  try {
    const ask = (extra) => logic.checkPlaceRequest({ user: p1, summoner, source: null, count: 1, spellId: SPELL.id, ...extra });
    assert.deepEqual(ask({ sourceRef: COOKBOOK }), { ok: true });
    assert.equal(ask({ sourceRef: "def.invented.nobody" }).reason, "badSource");
    assert.equal(ask({ sourceRef: "" }).reason, "badSource");
    assert.equal(ask({ sourceRef: COOKBOOK, positions: [{ x: 1, y: 1 }] }).reason, "badSource", "with positions it is the relay's check, which needs a creature");
    assert.equal(ask({ sourceRef: COOKBOOK, spellId: "" }).reason, "badSource", "a bare request has no naming to lean on");
  } finally {
    off();
  }
});

await t("offerRows: a resolved row by its creature, an unresolved id passed through untouched, a plain name dropped", () => {
  const rows = [
    { ref: "def.invented.glimmerkin", name: "Glimmerkin", amount: 2 },
    { ref: "Compendium.test.Actor.zzz", name: "", amount: 0 },
    { ref: "a plain printed name", name: "", amount: 4 },
    { ref: "", name: "open", amount: 1 },
    { ref: "def.invented.glimmerkin", name: "Glimmerkin", amount: 2 },
    { ref: "Actor.known", name: "ignored: the seat resolved it", amount: 3 },
  ];
  const resolved = [null, null, null, null, null, { uuid: "Actor.known", name: "Known Creature" }];
  assert.deepEqual(logic.offerRows(rows, resolved), [
    { value: "def.invented.glimmerkin", name: "Glimmerkin", amount: 2, passed: true },
    { value: "Compendium.test.Actor.zzz", name: "", amount: 0, passed: true },
    { value: "Actor.known", name: "Known Creature", amount: 3, passed: false },
  ]);
  assert.deepEqual(logic.offerRows(rows, undefined).map((o) => o.value), ["def.invented.glimmerkin", "Compendium.test.Actor.zzz", "Actor.known"], "with no resolver every id-like ref passes through");
  assert.deepEqual(logic.offerRows(undefined, undefined), []);
  assert.deepEqual(logic.offerRows([{ ref: "Actor.same" }, { ref: "other.ref" }], [{ uuid: "Actor.same", name: "N" }, { uuid: "Actor.same", name: "N" }]).map((o) => o.value), ["Actor.same"], "a creature offered twice is offered once");
});

await t("a ref reads as an id when it is dotted with no space, a uuid: prefix aside", () => {
  for (const id of ["def.invented.glimmerkin", "Compendium.test.Actor.abc", "uuid:Actor.abc", "Actor.abc"]) assert.equal(logic.refLooksLikeId(id), true, id);
  for (const name of ["glimmerkin", "a plain name", "St. Invented", "", " ", "end."]) assert.equal(logic.refLooksLikeId(name), false, name);
  assert.equal(logic.normalizeRef("  uuid:Actor.abc "), "Actor.abc");
});

await t("summons group by the spell that called them, with a dangling spell loose and a hand-bound token apart", () => {
  const e = (name, record) => ({ name, record });
  const hound = (castId, spellId, at, extra = {}) => ({ castId, name: "Ashmantle Hound", spellId, at, ...extra });
  const entries = [
    e("a", hound("late", "sp1", 9)),
    e("b", hound("early", "sp1", 2, { spellName: "Old Name" })),
    e("c", hound("late", "sp1", 9)),
    e("d", hound("orphan", "gone", 4, { spellName: "Vanished Rite" })),
    e("e", hound("bare", "", 5)),
    e("f", null),
    null,
  ];
  const spellsById = new Map([["sp1", { name: "Thornwake Call" }]]);
  const { casts, loose, bound } = logic.groupBySpell(entries, spellsById);
  assert.deepEqual(casts.map((c) => [c.spellId, c.spellName, c.castId, c.tokens.map((x) => x.name)]), [
    ["sp1", "Thornwake Call", "early", ["b"]],
    ["sp1", "Thornwake Call", "late", ["a", "c"]],
  ]);
  assert.deepEqual(loose.map((x) => x.name), ["d", "e"], "a dangling spellId and a bare cast are loose");
  assert.equal(bound.length, 1, "a token with no record is bound; a null entry is dropped");
  assert.equal(bound[0].name, "f");
  assert.deepEqual(logic.groupBySpell(entries, { sp1: { name: "Plain Object" } }).casts[0].spellName, "Plain Object", "a plain object serves as the lookup");
  assert.deepEqual(logic.groupBySpell(undefined, undefined), { casts: [], loose: [], bound: [] });
  assert.equal(logic.groupBySpell([e("x", hound("c1", "sp1", 1))], undefined).loose.length, 1, "no spells to resolve against: everything is loose");
});

await t("a cast reads its spell's name from the record, and groupByCast carries it", () => {
  const f = logic.summonFlags("Actor.s", { sourceUuid: "u", name: "Wolf", spellId: "sp1", spellName: "Thornwake Call", castId: "c", at: 7 });
  assert.deepEqual(f[M][logic.SUMMON_RECORD_FLAG], { sourceUuid: "u", name: "Wolf", castId: "c", at: 7, spellId: "sp1", spellName: "Thornwake Call" });
  assert.equal(logic.summonFlags("Actor.s", { sourceUuid: "u", spellName: "Orphan", castId: "c", at: 1 })[M][logic.SUMMON_RECORD_FLAG].spellName, undefined, "a name with no spell id is not kept");
  const { casts } = logic.groupByCast([{ record: f[M][logic.SUMMON_RECORD_FLAG] }]);
  assert.equal(casts[0].spellName, "Thornwake Call");
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
