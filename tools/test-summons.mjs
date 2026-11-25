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
const calls = { actorCreate: [], folderCreate: [], tokenCreate: [], tokenDelete: [], actorUpdate: [], tokenUpdate: [], rollHP: [] };
/** The totals the next hit-point rolls answer, in order; a roll with none left answers 7. */
const hpRolls = [];
/** The system settings the mock answers, by key. */
const systemSettings = { autoRollMonsterHP: false };
const registry = new Map();

const user = (id, isGM = false, viewedScene = null) => ({ id, isGM, viewedScene });
const gm = user("gm", true);
const p1 = user("p1");
const p2 = user("p2");
const stranger = user("p3");

const world = {
  users: new Map([gm, p1, p2, stranger].map((u) => [u.id, u])),
  scenes: new Coll(),
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
  settings: { get: (scope, key) => (scope === "acks" ? systemSettings[key] : undefined) },
  i18n: { localize: (k) => k, format: (k) => k },
};
class ForcedDeletion {}
globalThis.foundry = { utils: { mergeObject: (a, b) => merge(a, b), randomID: () => `rid${++serial}`, escapeHTML: (s) => String(s) }, data: { operators: { ForcedDeletion } } };
const hookCalls = [];
globalThis.Hooks = { on() {}, once() {}, call() {}, callAll: (name, payload) => hookCalls.push({ name, payload }) };
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
      type: data.type,
      data,
      getFlag: flagOf(data),
      rollHP: async (autoUpdate) => {
        calls.rollHP.push({ id, autoUpdate });
        return { total: hpRolls.shift() ?? 7 };
      },
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
  return {
    documentName: "Token",
    id,
    uuid: `Scene.${scene.id}.Token.${id}`,
    parent: scene,
    delta: { _source: { ownership: data?.delta?.ownership ?? {} } },
    update: async (patch) => void calls.tokenUpdate.push({ id, patch }),
    actor: { getFlag: (s, k) => flags[s]?.[k], update: async (patch) => void calls.actorUpdate.push({ id, patch }) },
  };
}

const reset = () => {
  for (const k of Object.keys(calls)) calls[k].length = 0;
  world.actors.clear();
  world.folders.clear();
  registry.clear();
  world.scenes.clear();
  hpRolls.length = 0;
  systemSettings.autoRollMonsterHP = false;
  services.resetServices();
};

const services = await import("../scripts/lib/services.mjs");
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

await t("a placement announces its tokens once they stand, and a refused one announces nothing", async () => {
  const { summoner, scene } = setup();
  hookCalls.length = 0;
  await summonRelay(place({ requestUserId: stranger.id }));
  assert.deepEqual(hookCalls, [], "a refusal is silent");
  const out = await summonRelay(place({ castId: "castH1" }));
  assert.equal(hookCalls.length, 1);
  assert.equal(hookCalls[0].name, "acksExtras.summonsPlaced");
  assert.deepEqual(hookCalls[0].payload, { summonerUuid: summoner.uuid, sceneId: scene.id, tokenIds: out.tokenUuids.map((u) => u.split(".").pop()) });
  assert.ok(hookCalls[0].payload.tokenIds.every((id) => scene.tokens.get(id)), "each named token stands on the scene");
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
/*  Summons riding in a party token             */
/* -------------------------------------------- */

const { registerSummons, heldSummonsOf, castSummons, dismissSummons } = await import("../scripts/lib/summons.mjs");

/**
 * A party-roster provider with the v2 methods, over `parties` (id → members).
 * A member is `{actorId, name, summonedBy, summon, token}`: `token` is its
 * live deployed token, absent while it is stashed. `events` logs what lib
 * asked of it; `recall()` is the provider's own restore, which brings back
 * only the members that still have a record.
 */
function fakeProvider(parties, { release = true, memberOfToken = true } = {}) {
  const events = [];
  const restored = [];
  const rowOf = (m) => ({ actorId: m.actorId, actor: { img: `img/${m.actorId}` }, name: m.name, document: null, stashed: !m.token, unlinked: true, hp: null, summonedBy: m.summonedBy ?? null, summon: m.summon ?? null });
  const impl = {
    list: () => [...parties.keys()].map((id) => ({ id, name: id })),
    members: (id) => (parties.get(id) ?? []).map(rowOf),
  };
  if (memberOfToken) {
    impl.memberOfToken = (tok) => {
      for (const [partyId, members] of parties) {
        const m = members.find((x) => x.token === tok);
        if (m) return { partyId, actorId: m.actorId };
      }
      return null;
    };
  }
  if (release) {
    impl.release = async (partyId, ids) => {
      events.push(["release", partyId, [...ids]]);
      const members = parties.get(partyId) ?? [];
      let released = 0;
      for (const id of ids) {
        const i = members.findIndex((m) => m.actorId === id);
        if (i < 0) continue;
        const [m] = members.splice(i, 1);
        released++;
        if (m.token) await m.token.parent.deleteEmbeddedDocuments("Token", [m.token.id]);
      }
      return { released };
    };
  }
  const recall = () => {
    for (const members of parties.values()) for (const m of members) restored.push(m.actorId);
  };
  return { impl, events, restored, recall };
}

/** A summon of `summonerUuid` stashed in a party token, or deployed as a token on `scene`. */
const member = (actorId, summonerUuid, castId, scene = null) => {
  const m = { actorId, name: `Wolf ${actorId}`, summonedBy: summonerUuid, summon: { castId, sourceUuid: "x", at: 1 } };
  if (scene) m.token = summoned(scene, summonerUuid, m.summon);
  return m;
};

const dismissAs = (summoner, over = {}) => summonRelay({ op: "dismiss", summonerUuid: summoner.uuid, requestUserId: p1.id, ...over });

await t("summonOfData reads the summoner and the record off a stash's delta and nothing else", () => {
  const delta = { flags: { [M]: { [logic.SUMMON_FLAG]: "Actor.s", [logic.SUMMON_RECORD_FLAG]: { castId: "c1", sourceUuid: "u", at: 3 } } } };
  assert.deepEqual(logic.summonOfData({ delta }), { summonedBy: "Actor.s", summon: { castId: "c1", sourceUuid: "u", at: 3 } });
  assert.deepEqual(logic.summonOfData({ delta, actorLink: true }), { summonedBy: null, summon: null }, "a linked token's flags are its actor's");
  assert.deepEqual(logic.summonOfData({ delta: null }), { summonedBy: null, summon: null }, "a token that matches its actor has no delta");
  assert.deepEqual(logic.summonOfData(null), { summonedBy: null, summon: null });
  assert.deepEqual(logic.summonOfData({ delta: { flags: { [M]: { [logic.SUMMON_FLAG]: "Actor.s", [logic.SUMMON_RECORD_FLAG]: { nope: 1 } } } } }), { summonedBy: "Actor.s", summon: null }, "a record with no cast id is none");
  assert.deepEqual(logic.summonOfData({ delta: { flags: { other: { [logic.SUMMON_FLAG]: "Actor.s" } } } }), { summonedBy: null, summon: null }, "only this module's scope");
});

await t("heldSummonsOf lists a summoner's stashed summons and neither a deployed one nor another caster's", () => {
  const { summoner, scene } = setup();
  const parties = new Map([["pty", [member("m1", summoner.uuid, "c1"), member("m2", summoner.uuid, "c1", scene), member("m3", "Actor.other", "c1"), { actorId: "m4", name: "Plain" }]]]);
  services.register("party-roster", fakeProvider(parties).impl);
  const held = heldSummonsOf(summoner);
  assert.deepEqual(held.map((h) => [h.partyId, h.actorId, h.name, h.img, h.record.castId]), [["pty", "m1", "Wolf m1", "img/m1", "c1"]]);
});

await t("with no provider, or a provider with no summon fields, nothing is held", () => {
  const { summoner } = setup();
  assert.deepEqual(heldSummonsOf(summoner), []);
  services.register("party-roster", { list: () => [{ id: "pty" }], members: () => [{ actorId: "m1", stashed: true, name: "v1 row" }] });
  assert.deepEqual(heldSummonsOf(summoner), []);
  services.register("party-roster", {});
  assert.deepEqual(heldSummonsOf(summoner), []);
});

await t("castSummons splits one cast's scene tokens from its held summons and takes no other cast", () => {
  const { summoner, scene } = setup();
  const other = makeScene("s2", { active: false });
  const a1 = summoned(scene, summoner.uuid, { castId: "cA", sourceUuid: "x", at: 1 });
  const a2 = summoned(other, summoner.uuid, { castId: "cA", sourceUuid: "x", at: 1 });
  summoned(scene, summoner.uuid, { castId: "cB", sourceUuid: "x", at: 1 });
  summoned(scene, "Actor.other", { castId: "cA", sourceUuid: "x", at: 1 });
  const parties = new Map([["pty", [member("h1", summoner.uuid, "cA"), member("h2", summoner.uuid, "cB"), member("h3", "Actor.other", "cA")]]]);
  services.register("party-roster", fakeProvider(parties).impl);
  const out = castSummons(summoner, "cA", { scenes: [scene, other] });
  assert.deepEqual(out.tokens.map((x) => x.id).sort(), [a1.id, a2.id].sort());
  assert.deepEqual(out.held.map((h) => h.actorId), ["h1"]);
  const none = castSummons(summoner, "cZ", { scenes: [scene, other] });
  assert.deepEqual([none.tokens.length, none.held.length], [0, 0]);
});

await t("castSummons with no provider is the scene tokens alone", () => {
  const { summoner, scene } = setup();
  const a1 = summoned(scene, summoner.uuid, { castId: "cA", sourceUuid: "x", at: 1 });
  const out = castSummons(summoner, "cA", { scenes: [scene] });
  assert.deepEqual([out.tokens.map((x) => x.id), out.held], [[a1.id], []]);
});

await t("one dismissal takes a held summon, a deployed member and a plain token, each by its own road", async () => {
  const { summoner, scene } = setup();
  const plain = summoned(scene, summoner.uuid, { castId: "c1", sourceUuid: "x", at: 1 });
  const parties = new Map([["pty", [member("h1", summoner.uuid, "c1"), member("d1", summoner.uuid, "c1", scene)]]]);
  const fake = fakeProvider(parties);
  services.register("party-roster", fake.impl);
  const dep = parties.get("pty")[1].token;
  const out = await dismissAs(summoner, { tokenUuids: [plain.uuid, dep.uuid], held: [{ partyId: "pty", actorId: "h1" }] });
  assert.deepEqual(out, { ok: true, deleted: 3, refused: 0 });
  assert.deepEqual(calls.tokenDelete, [plain.id, dep.id], "the plain token by the scene, the deployed one by release");
  assert.deepEqual(fake.events, [["release", "pty", ["d1", "h1"]]]);
  assert.equal(parties.get("pty").length, 0, "both records are gone");
  fake.recall();
  assert.deepEqual(fake.restored, [], "a recall has nothing left to restore");
});

await t("a deployed member's token is never deleted by lib itself, so its record cannot outlive it", async () => {
  const { summoner, scene } = setup();
  const parties = new Map([["pty", [member("d1", summoner.uuid, "c1", scene)]]]);
  const fake = fakeProvider(parties);
  services.register("party-roster", fake.impl);
  const dep = parties.get("pty")[0].token;
  const direct = [];
  const real = scene.deleteEmbeddedDocuments;
  scene.deleteEmbeddedDocuments = async (type, ids) => (direct.push([...ids]), real(type, ids));
  await dismissAs(summoner, { tokenUuids: [dep.uuid] });
  assert.deepEqual(fake.events.map((e) => e[0]), ["release"]);
  assert.deepEqual(direct, [[dep.id]], "the one delete is the provider's, made after it dropped the record");
  assert.equal(parties.get("pty").length, 0);
});

await t("one caster's dismissal leaves another's held and deployed summons of the same creature", async () => {
  const { summoner: a, scene } = setup();
  const b = makeSummoner("sumB", [p2.id], [SPELL]);
  const parties = new Map([
    ["pty", [member("aHeld", a.uuid, "cA"), member("aDep", a.uuid, "cA", scene), member("bHeld", b.uuid, "cB"), member("bDep", b.uuid, "cB", scene)]],
  ]);
  const fake = fakeProvider(parties);
  services.register("party-roster", fake.impl);
  const [, aDep, , bDep] = parties.get("pty").map((m) => m.token);
  // A names B's held and deployed ones beside its own: only A's go.
  const out = await dismissAs(a, {
    tokenUuids: [aDep.uuid, bDep.uuid],
    held: [{ partyId: "pty", actorId: "aHeld" }, { partyId: "pty", actorId: "bHeld" }, { partyId: "pty", actorId: "bDep" }],
  });
  assert.deepEqual(out, { ok: true, deleted: 2, refused: 3 });
  assert.deepEqual(fake.events, [["release", "pty", ["aDep", "aHeld"]]]);
  assert.deepEqual(parties.get("pty").map((m) => m.actorId), ["bHeld", "bDep"]);
  assert.equal(bDep.parent.tokens.has(bDep.id), true, "B's deployed token stands");
});

await t("a held summon named by a seat that does not own the summoner, or the provider does not know, is not released", async () => {
  const { summoner } = setup();
  const parties = new Map([["pty", [member("h1", summoner.uuid, "c1")]]]);
  const fake = fakeProvider(parties);
  services.register("party-roster", fake.impl);
  assert.deepEqual(await dismissAs(summoner, { requestUserId: stranger.id, held: [{ partyId: "pty", actorId: "h1" }] }), { ok: false, reason: "notOwner" });
  const out = await dismissAs(summoner, { held: [{ partyId: "nope", actorId: "h1" }, { partyId: "pty", actorId: "ghost" }, { partyId: "pty" }, null] });
  assert.deepEqual(out, { ok: true, deleted: 0, refused: 2 });
  assert.deepEqual(fake.events, []);
  assert.equal(parties.get("pty").length, 1);
});

await t("with no provider a dismissal is today's: tokens deleted, a held name refused", async () => {
  const { summoner, scene } = setup();
  const mine = summoned(scene, summoner.uuid, { castId: "c1", sourceUuid: "x", at: 1 });
  const out = await dismissAs(summoner, { tokenUuids: [mine.uuid], held: [{ partyId: "pty", actorId: "h1" }] });
  assert.deepEqual(out, { ok: true, deleted: 1, refused: 1 });
  assert.deepEqual(calls.tokenDelete, [mine.id]);
});

await t("a provider with no release or memberOfToken leaves a deployed token to the scene and refuses the held", async () => {
  const { summoner, scene } = setup();
  const parties = new Map([["pty", [member("h1", summoner.uuid, "c1"), member("d1", summoner.uuid, "c1", scene)]]]);
  const fake = fakeProvider(parties, { release: false, memberOfToken: false });
  services.register("party-roster", fake.impl);
  const dep = parties.get("pty")[1].token;
  const out = await dismissAs(summoner, { tokenUuids: [dep.uuid], held: [{ partyId: "pty", actorId: "h1" }] });
  assert.deepEqual(out, { ok: true, deleted: 1, refused: 1 });
  assert.deepEqual(calls.tokenDelete, [dep.id]);
  const noRelease = fakeProvider(parties, { release: false });
  services.register("party-roster", noRelease.impl);
  const again = await dismissAs(summoner, { held: [{ partyId: "pty", actorId: "h1" }] });
  assert.deepEqual(again, { ok: true, deleted: 0, refused: 1 });
});

await t("the seat's dismissSummons takes entries of tokens and held summons, and its castId filter spans both", async () => {
  const { summoner, scene } = setup();
  globalThis.canvas = { scene };
  game.user = gm;
  await registerSummons();
  const plain = summoned(scene, summoner.uuid, { castId: "c1", sourceUuid: "x", at: 1 });
  const otherCast = summoned(scene, summoner.uuid, { castId: "c2", sourceUuid: "x", at: 1 });
  const parties = new Map([["pty", [member("h1", summoner.uuid, "c1"), member("h2", summoner.uuid, "c2"), member("d1", summoner.uuid, "c1", scene)]]]);
  const fake = fakeProvider(parties);
  services.register("party-roster", fake.impl);
  const dep = parties.get("pty")[2].token;
  const entries = [
    { tokenId: plain.id, held: null },
    { tokenId: otherCast.id, held: null },
    { tokenId: dep.id, held: null },
    { tokenId: null, held: { partyId: "pty", actorId: "h1" } },
    { tokenId: null, held: { partyId: "pty", actorId: "h2" } },
  ];
  const out = await dismissSummons(summoner, { entries, castId: "c1", confirm: false });
  assert.deepEqual(out, { ok: true, deleted: 3, refused: 0 });
  assert.deepEqual(parties.get("pty").map((m) => m.actorId), ["h2"]);
  assert.equal(scene.tokens.has(otherCast.id), true, "another cast stays");
  assert.deepEqual(await dismissSummons(summoner, { entries: [], confirm: false }), { ok: false, reason: "none" });
  const rest = await dismissSummons(summoner, { confirm: false });
  assert.deepEqual(rest, { ok: true, deleted: 2, refused: 0 }, "with nothing named: the scene's tokens and every held one");
  delete globalThis.canvas;
});

/* -------------------------------------------- */
/*  The seat: the bare prompt and the placement */
/* -------------------------------------------- */

const { promptSummon, placeSummons, pickPlacement, summonVerdict } = await import("../scripts/lib/summons.mjs");

const notes = { warn: [], info: [] };
globalThis.ui = { notifications: { warn: (m) => notes.warn.push(m), info: (m) => notes.info.push(m) } };
const dialogAnswers = [];
globalThis.foundry.applications = { api: { DialogV2: { prompt: async () => dialogAnswers.shift() ?? null, confirm: async () => true } } };

/** One system creature shelf holding creature `m1`, so the bare prompt has something to offer. */
const shelf = () => [{ documentName: "Actor", metadata: { packageType: "system", label: "Shelf" }, collection: "shelf.mons", visible: true, index: new Map([["m1", { uuid: "Compendium.test.Actor.m1", type: "monster", name: "Creature m1" }]]) }];

/** A canvas whose `placeTokens` answers `placed` (documents), or throws, and records what it was asked. */
function seatCanvas(scene, { placed = [], fail = false, ready = true } = {}) {
  const asked = [];
  globalThis.canvas = {
    scene,
    ready,
    tokens: {
      placeTokens: async (previews, opts) => {
        asked.push({ previews, opts });
        if (fail) throw new Error("placement down");
        return placed;
      },
    },
  };
  return asked;
}

const endSeat = () => {
  delete globalThis.canvas;
  game.paused = false;
  game.packs = [];
  game.user = gm;
  notes.warn.length = 0;
  notes.info.length = 0;
  dialogAnswers.length = 0;
};

await t("the bare prompt asks the shelves, has the seat click, and relays the places to the GM", async () => {
  const { scene } = setup();
  game.packs = shelf();
  const asked = seatCanvas(scene, { placed: [{ _source: { x: 40, y: 50 } }, { _source: { x: 60, y: 70, rotation: 10 } }] });
  dialogAnswers.push({ sourceUuid: "Compendium.test.Actor.m1", count: 2, spellId: "" });
  const out = await promptSummon(world.actors.get("sum") ?? registry.get("Actor.sum"));
  assert.equal(out.ok, true);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].previews.length, 2, "one preview per creature");
  assert.equal(asked[0].opts.create, false, "nothing is made by the click");
  assert.deepEqual(calls.tokenCreate.map((d) => [d.x, d.y, d.rotation]), [[40, 50, undefined], [60, 70, 10]], "the GM made a token at each place clicked");
  const rec = calls.tokenCreate[0].delta.flags[M][logic.SUMMON_RECORD_FLAG];
  assert.equal(rec.spellId, undefined);
  assert.match(rec.castId, /^rid\d+$/, "the seat mints the cast id");
  assert.equal(calls.tokenCreate[1].delta.flags[M][logic.SUMMON_RECORD_FLAG].castId, rec.castId, "one cast");
  assert.equal(notes.info.length, 1, "the seat is told how many stand");
  endSeat();
});

await t("the bare prompt answers cancelled when the seat places nothing, and warns of nothing", async () => {
  const { scene } = setup();
  game.packs = shelf();
  seatCanvas(scene, { placed: [] });
  dialogAnswers.push({ sourceUuid: "Compendium.test.Actor.m1", count: 1, spellId: "" });
  const out = await promptSummon(registry.get("Actor.sum"));
  assert.deepEqual(out, { ok: false, reason: "cancelled" });
  assert.equal(calls.tokenCreate.length, 0);
  assert.deepEqual(notes.warn, []);
  endSeat();
});

await t("a placement that throws is refused 'placement', a paused game or a missing canvas before any click", async () => {
  const { scene } = setup();
  game.packs = shelf();
  const asked = seatCanvas(scene, { fail: true });
  const summoner = registry.get("Actor.sum");
  dialogAnswers.push({ sourceUuid: "Compendium.test.Actor.m1", count: 1, spellId: "" });
  assert.deepEqual(await promptSummon(summoner), { ok: false, reason: "placement" });
  assert.equal(asked.length, 1);
  seatCanvas(scene, { ready: false });
  dialogAnswers.push({ sourceUuid: "Compendium.test.Actor.m1", count: 1, spellId: "" });
  assert.deepEqual(await promptSummon(summoner), { ok: false, reason: "noCanvas" });
  game.user = p1;
  game.paused = true;
  const clicks = seatCanvas(scene);
  assert.deepEqual(await promptSummon(summoner), { ok: false, reason: "spellRequired" }, "a Player seat is held to a spell before anything else");
  assert.equal(clicks.length + calls.tokenCreate.length, 0);
  endSeat();
});

await t("the bare prompt closed, or with no shelf to offer, answers null", async () => {
  const { scene } = setup();
  seatCanvas(scene);
  assert.equal(await promptSummon(registry.get("Actor.sum")), null, "no shelf: the seat is told and nothing is offered");
  game.packs = shelf();
  assert.equal(await promptSummon(registry.get("Actor.sum")), null, "a closed prompt");
  endSeat();
});

/* -------------------------------------------- */
/*  Placement from picked places, and the range */
/* -------------------------------------------- */

/** A grid of 100-pixel cells of 5 units, in feet, that measures a straight line. */
const gridOf = (scene) => {
  scene.grid = { size: 100, distance: 5, units: "ft", measurePath: ([a, b]) => ({ distance: (Math.hypot(b.x - a.x, b.y - a.y) / 100) * 5 }) };
  return scene;
};

/** The summoner's own token on a scene, 100 pixels square, its centre 50 pixels in from its corner. */
const casterOn = (scene, x, y, over = {}) => {
  const doc = { documentName: "Token", id: "caster", uuid: `Scene.${scene.id}.Token.caster`, parent: scene, actorId: "sum", x, y, width: 1, height: 1, getCenterPoint: (p) => ({ x: p.x + 50, y: p.y + 50 }), ...over };
  scene.tokens.set(doc.id, doc);
  return doc;
};

const FAR = { x: 950, y: 150 };
const NEAR = { x: 450, y: 150 };

await t("the relay hands every policy the cast, the places and the scene, and the GM's own cast id stands", async () => {
  const { scene } = setup();
  const seen = [];
  const off = logic.registerSummonPolicy((req) => {
    seen.push(req);
    return null;
  });
  const out = await summonRelay(place({ cast: { castId: "castP1", casterLevel: 7, invocationLevel: "9", extra: 1 }, castId: "ignored1" }));
  off();
  assert.equal(out.ok, true);
  assert.equal(out.castId, "castP1");
  assert.deepEqual(seen[0].cast, { castId: "castP1", casterLevel: 7, invocationLevel: null }, "a level that is no finite number reads null");
  assert.deepEqual(seen[0].positions, place().positions);
  assert.equal(seen[0].scene, scene);
  assert.equal(calls.tokenCreate[0].delta.flags[M][logic.SUMMON_RECORD_FLAG].castId, "castP1");
});

await t("a policy sees the cast of a request that names none, with the id the GM mints and null levels", async () => {
  setup();
  const seen = [];
  const off = logic.registerSummonPolicy((req) => {
    seen.push(req.cast);
    return null;
  });
  const out = await summonRelay(place());
  off();
  assert.deepEqual(seen[0], { castId: out.castId, casterLevel: null, invocationLevel: null });
});

await t("the places are validated before any policy runs", async () => {
  setup();
  let ran = 0;
  const off = logic.registerSummonPolicy(() => {
    ran++;
    return "policyNo";
  });
  assert.equal((await summonRelay(place({ count: 3 }))).reason, "badPositions");
  assert.equal(ran, 0);
  assert.equal((await summonRelay(place())).reason, "policyNo");
  off();
});

await t("the GM measures the places again: one beyond the range is refused a Player and nothing is made", async () => {
  const { scene } = setup();
  gridOf(scene);
  casterOn(scene, 100, 100);
  const both = place({ positions: [NEAR, FAR], rangeFeet: 30, casterTokenId: "caster" });
  assert.deepEqual(await summonRelay(both), { ok: false, reason: "outOfRange" });
  assert.equal(calls.tokenCreate.length + calls.actorCreate.length, 0);
  const ok = await summonRelay(place({ positions: [NEAR, { x: 450, y: 550 }], rangeFeet: 30, casterTokenId: "caster" }));
  assert.equal(ok.ok, true, "both inside: 15 and about 25 feet from the token's centre");
  assert.equal(calls.tokenCreate.length, 2);
});

await t("the range is measured from the token's centre with no creature size added, at the edge and a hair beyond", async () => {
  const { scene } = setup();
  gridOf(scene);
  casterOn(scene, 100, 100);
  const at = (x) => place({ positions: [{ x, y: 150 }], count: 1, rangeFeet: 30, casterTokenId: "caster" });
  assert.equal((await summonRelay(at(750))).ok, true, "exactly 30 feet from (150, 150) is inside");
  assert.equal((await summonRelay(at(751))).reason, "outOfRange");
});

await t("a calling, a range that states none and a place the grid cannot measure are exempt", async () => {
  const { scene } = setup();
  gridOf(scene);
  casterOn(scene, 100, 100);
  const far = (over) => place({ positions: [FAR, FAR], casterTokenId: "caster", ...over });
  assert.equal((await summonRelay(far({ rangeFeet: 30, calling: true }))).ok, true, "a calling");
  for (const rangeFeet of [null, undefined, "", "30", NaN, Infinity, -5]) {
    assert.equal((await summonRelay(far({ rangeFeet }))).ok, true, `a range of ${String(rangeFeet)} is not measured`);
  }
  scene.grid.measurePath = () => ({ distance: NaN });
  assert.equal((await summonRelay(far({ rangeFeet: 30 }))).ok, true, "an unmeasurable grid is not a refusal");
});

await t("a measured range with no caster token of the summoner's on the scene is refused noCaster", async () => {
  const { scene } = setup();
  gridOf(scene);
  const base = { rangeFeet: 30, positions: [NEAR, NEAR] };
  assert.equal((await summonRelay(place({ ...base }))).reason, "noCaster", "no token named");
  assert.equal((await summonRelay(place({ ...base, casterTokenId: "ghost" }))).reason, "noCaster", "a token that is not on the scene");
  casterOn(scene, 100, 100, { actorId: "other" });
  assert.equal((await summonRelay(place({ ...base, casterTokenId: "caster" }))).reason, "noCaster", "another creature's token");
  assert.equal(calls.tokenCreate.length, 0);
});

await t("a Judge's request is not held to the range", async () => {
  const { scene } = setup();
  gridOf(scene);
  casterOn(scene, 100, 100);
  const out = await summonRelay(place({ positions: [FAR, FAR], rangeFeet: 30, casterTokenId: "caster", requestUserId: null }));
  assert.equal(out.ok, true);
});

await t("placeSummons given places makes no click, relays them with the cast, and mints no id of its own over the cast's", async () => {
  const { scene } = setup();
  const asked = seatCanvas(scene);
  const out = await placeSummons(registry.get("Actor.sum"), {
    sourceUuid: "Compendium.test.Actor.m1",
    count: 3,
    spellId: SPELL.id,
    positions: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
    cast: { castId: "castQ1", casterLevel: 5, invocationLevel: 2 },
  });
  assert.equal(out.ok, true);
  assert.equal(out.castId, "castQ1");
  assert.equal(asked.length, 0, "nothing was clicked");
  assert.deepEqual(calls.tokenCreate.map((d) => [d.x, d.y]), [[10, 20], [30, 40]], "the creature count is the places given");
  endSeat();
});

await t("placeSummons given no places answers cancelled for an empty list, and still refuses what it refused before the clicks", async () => {
  const { scene } = setup();
  const asked = seatCanvas(scene);
  const summoner = registry.get("Actor.sum");
  assert.deepEqual(await placeSummons(summoner, { sourceUuid: "Compendium.test.Actor.m1", count: 1, spellId: SPELL.id, positions: [] }), { ok: false, reason: "cancelled" });
  assert.equal((await placeSummons(summoner, { sourceUuid: "Compendium.test.Actor.m1", count: 0, spellId: SPELL.id, positions: [{ x: 1, y: 1 }] })).reason, "badCount");
  assert.equal(asked.length + calls.tokenCreate.length, 0);
  endSeat();
});

await t("a request through placeSummons carries its range to the GM, who measures it again", async () => {
  const { scene } = setup();
  gridOf(scene);
  const token = casterOn(scene, 100, 100);
  seatCanvas(scene);
  const summoner = registry.get("Actor.sum");
  // A Player's seat: its request leaves on the socket, which is the live half, so what it sends is
  // captured and handed to the relay the way the GM's client hands it, stamped with the sender.
  const sent = [];
  game.user = p1;
  game.users.activeGM = gm;
  game.socket = { emit: (_channel, message) => sent.push(message.payload) };
  const ask = (positions) => placeSummons(summoner, { sourceUuid: "Compendium.test.Actor.m1", count: positions.length, spellId: SPELL.id, positions, rangeFeet: 30, casterToken: token, cast: { castId: "castR1", casterLevel: 6 } });
  await ask([NEAR]);
  await ask([FAR]);
  delete game.socket;
  delete game.users.activeGM;
  assert.equal(sent.length, 2);
  assert.deepEqual([sent[0].rangeFeet, sent[0].calling, sent[0].casterTokenId], [30, false, "caster"]);
  assert.deepEqual(sent[0].cast, { castId: "castR1", casterLevel: 6, invocationLevel: null });
  assert.equal((await summonRelay({ ...sent[0], requestUserId: p1.id })).ok, true);
  assert.deepEqual(await summonRelay({ ...sent[1], requestUserId: p1.id }), { ok: false, reason: "outOfRange" });
  assert.equal(calls.tokenCreate.length, 1, "only the place in range was made");
  endSeat();
});

await t("pickPlacement returns the places the seat clicked and makes nothing", async () => {
  const { scene } = setup();
  const asked = seatCanvas(scene, { placed: [{ _source: { x: 5, y: 6 } }, { _source: { x: 7, y: 8, rotation: 45 } }] });
  const out = await pickPlacement(registry.get("Actor.sum"), { sourceUuid: "Compendium.test.Actor.m1", count: 2, spellId: SPELL.id });
  assert.deepEqual(out, { positions: [{ x: 5, y: 6 }, { x: 7, y: 8, rotation: 45 }] });
  assert.equal(asked[0].opts.create, false);
  assert.equal(asked[0].previews.length, 2);
  assert.equal(calls.tokenCreate.length + calls.actorCreate.length + calls.folderCreate.length, 0, "no token, copy or folder is made");
  endSeat();
});

await t("pickPlacement answers null for a cancel and makes nothing, and warns of nothing", async () => {
  const { scene } = setup();
  seatCanvas(scene, { placed: [] });
  assert.equal(await pickPlacement(registry.get("Actor.sum"), { sourceUuid: "Compendium.test.Actor.m1", count: 1, spellId: SPELL.id }), null);
  assert.deepEqual(notes.warn, []);
  assert.equal(calls.tokenCreate.length, 0);
  endSeat();
});

await t("pickPlacement answers null and warns where the request cannot start", async () => {
  const { scene } = setup();
  const summoner = registry.get("Actor.sum");
  const asked = seatCanvas(scene, { fail: true });
  assert.equal(await pickPlacement(summoner, { sourceUuid: "Compendium.test.Actor.m1", count: 1, spellId: SPELL.id }), null);
  assert.equal(notes.warn.length, 1, "a placement that threw is told to the seat");
  seatCanvas(scene, { ready: false });
  assert.equal(await pickPlacement(summoner, { sourceUuid: "Compendium.test.Actor.m1", count: 1, spellId: SPELL.id }), null);
  assert.equal(notes.warn.length, 2);
  assert.equal(asked.length, 1);
  endSeat();
});

await t("summonVerdict is the refusals before the clicks, silent and with nothing placed", async () => {
  const { scene } = setup();
  const summoner = registry.get("Actor.sum");
  const asked = seatCanvas(scene);
  const ok = await summonVerdict(summoner, { sourceUuid: "Compendium.test.Actor.m1", count: 1, spellId: SPELL.id });
  assert.equal(ok.ok, true);
  assert.equal(ok.scene, scene);
  assert.equal((await summonVerdict(summoner, { sourceUuid: "Compendium.test.Actor.m1", count: 0, spellId: SPELL.id })).reason, "badCount");
  const seat = game.user;
  game.user = p1;
  assert.equal((await summonVerdict(summoner, { sourceUuid: "def.invented.closedShelf", count: 1, spellId: SPELL.id })).reason, "unreadable", "a Player seat reads a spell's ref nothing here answers as a creature it cannot open");
  game.user = gm;
  assert.equal((await summonVerdict(summoner, { sourceUuid: "def.invented.closedShelf", count: 1, spellId: SPELL.id })).reason, "badSource", "a Judge's seat reads every shelf, so the same ref names nothing");
  game.user = seat;
  seatCanvas(scene, { ready: false });
  assert.equal((await summonVerdict(summoner, { sourceUuid: "Compendium.test.Actor.m1", count: 1, spellId: SPELL.id })).reason, "noCanvas");
  assert.equal(asked.length + notes.warn.length, 0);
  endSeat();
});

await t("the seat's click is refused a Player beyond the range, warned to a Judge, and exempt for a calling", async () => {
  const { scene } = setup();
  gridOf(scene);
  const token = casterOn(scene, 100, 100);
  const summoner = registry.get("Actor.sum");
  const candidates = [{ x: NEAR.x, y: NEAR.y }, { x: FAR.x, y: FAR.y }];
  /** A placement that offers each candidate to the hook and keeps the ones it does not refuse. */
  const offering = () => {
    globalThis.canvas = {
      scene,
      ready: true,
      tokens: { placeTokens: async (previews, { preConfirm }) => candidates.filter((c, index) => preConfirm?.({ document: { _source: c }, index, count: 2 }) !== false).map((c) => ({ _source: c })) },
    };
  };
  const pick = (over = {}) => pickPlacement(summoner, { sourceUuid: "Compendium.test.Actor.m1", count: 2, spellId: SPELL.id, rangeFeet: 30, casterToken: token, ...over });
  offering();
  game.user = gm;
  assert.equal((await pick()).positions.length, 2, "a Judge keeps both clicks");
  assert.equal(notes.warn.length, 1, "and is warned of the far one");
  notes.warn.length = 0;
  game.user = p1;
  assert.deepEqual((await pick()).positions, [{ x: NEAR.x, y: NEAR.y }], "a Player's far click is refused");
  assert.equal(notes.warn.length, 1);
  notes.warn.length = 0;
  assert.equal((await pick({ calling: true })).positions.length, 2, "a calling is not bounded");
  assert.equal((await pick({ rangeFeet: null })).positions.length, 2, "no range states no bound");
  assert.equal((await pick({ casterToken: "caster" })).positions.length, 1, "the token may be named by its id on the scene");
  notes.warn.length = 0;
  assert.equal(await pick({ casterToken: null }), null, "no token to measure from refuses a Player every click, and nothing is placed");
  assert.equal(notes.warn.length, 2);
  endSeat();
});

await t("a preConfirm the caller passes still refuses a click first, range or none", async () => {
  const { scene } = setup();
  gridOf(scene);
  const token = casterOn(scene, 100, 100);
  const seen = [];
  globalThis.canvas = {
    scene,
    ready: true,
    tokens: { placeTokens: async (previews, { preConfirm }) => [{ _source: NEAR }].filter((c) => preConfirm?.({ document: { _source: c } }) !== false).map((c) => ({ _source: c })) },
  };
  const summoner = registry.get("Actor.sum");
  const base = { sourceUuid: "Compendium.test.Actor.m1", count: 1, spellId: SPELL.id, preConfirm: (ctx) => (seen.push(ctx), false) };
  assert.equal(await pickPlacement(summoner, { ...base, rangeFeet: 30, casterToken: token }), null);
  assert.equal(await pickPlacement(summoner, base), null);
  assert.equal(seen.length, 2);
  endSeat();
});

await t("the range limit reads a finite non-negative number and nothing else", () => {
  assert.equal(logic.rangeLimitOf(0), 0);
  assert.equal(logic.rangeLimitOf(12.5), 12.5);
  for (const bad of [null, undefined, "", "5", NaN, -1, Infinity, true, {}]) assert.equal(logic.rangeLimitOf(bad), null, String(bad));
});

await t("checkPlacementRange measures each place and names what stopped it", () => {
  const measure = (a, b) => Math.abs(a.x - b.x);
  const from = { x: 0, y: 0 };
  assert.deepEqual(logic.checkPlacementRange({ positions: [{ x: 5, y: 0 }, { x: 10, y: 0 }], from, rangeFeet: 10, measure }), { ok: true });
  assert.deepEqual(logic.checkPlacementRange({ positions: [{ x: 5, y: 0 }, { x: 11, y: 0 }], from, rangeFeet: 10, measure }), { ok: false, reason: "outOfRange" });
  assert.deepEqual(logic.checkPlacementRange({ positions: [{ x: 99, y: 0 }], from: null, rangeFeet: 10, measure }), { ok: false, reason: "noCaster" });
  assert.deepEqual(logic.checkPlacementRange({ positions: [{ x: 99, y: 0 }], from: null, rangeFeet: 10, calling: true, measure }), { ok: true });
  assert.deepEqual(logic.checkPlacementRange({ positions: [{ x: 99, y: 0 }], from, rangeFeet: null, measure }), { ok: true });
  assert.deepEqual(logic.checkPlacementRange({ positions: [{ x: 99, y: 0 }], from, rangeFeet: 10, measure: () => null }), { ok: true });
});

await t("normalizeCast keeps a well-formed id and finite levels, and drops the rest", () => {
  assert.deepEqual(logic.normalizeCast({ castId: "abc9", casterLevel: 4, invocationLevel: 0 }, "fb"), { castId: "abc9", casterLevel: 4, invocationLevel: 0 });
  assert.deepEqual(logic.normalizeCast({ castId: "a b", casterLevel: "4", invocationLevel: NaN }, "fb"), { castId: "fb", casterLevel: null, invocationLevel: null });
  assert.deepEqual(logic.normalizeCast(undefined, "fb"), { castId: "fb", casterLevel: null, invocationLevel: null });
});

await t("pointGapFeet measures two points as given through the grid's own units, and is null where it cannot", async () => {
  const { pointGapFeet, centreOfToken } = await import("../scripts/lib/distance-units.mjs");
  const scene = gridOf({ id: "g" });
  assert.equal(pointGapFeet(scene, { x: 0, y: 0 }, { x: 300, y: 0 }), 15);
  scene.grid.units = "yd";
  assert.equal(pointGapFeet(scene, { x: 0, y: 0 }, { x: 300, y: 0 }), 45, "units read through feet per unit");
  assert.equal(pointGapFeet(scene, { x: 0, y: 0 }, null), null);
  assert.equal(pointGapFeet(scene, { x: 0, y: NaN }, { x: 1, y: 1 }), null);
  assert.equal(pointGapFeet({ grid: {} }, { x: 0, y: 0 }, { x: 1, y: 1 }), null);
  assert.deepEqual(centreOfToken({ x: 100, y: 100, getCenterPoint: (p) => ({ x: p.x + 50, y: p.y + 50 }) }), { x: 150, y: 150 });
  assert.equal(centreOfToken(null), null);
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
    await writeFile(join(dir, "magic-vocab.mjs"), await readFile(new URL("../scripts/lib/magic-vocab.mjs", import.meta.url), "utf8"));
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
/*  The creature's level is the requester's own  */
/* -------------------------------------------- */

const COOKBOOK = "def.invented.glimmerkin";

/** A library creature on a shelf only the GM and `readers` can open, found by its cookbook id in the world. */
function makeShelfSource(id = "shelf1", cookbook = COOKBOOK, readers = []) {
  const data = { flags: { [M]: { cookbook: { id: cookbook } } } };
  const doc = {
    id,
    uuid: `Compendium.test.Actor.${id}`,
    type: "monster",
    name: `Creature ${id}`,
    flags: data.flags,
    getFlag: flagOf(data),
    compendium: { testUserPermission: (u) => u.isGM || readers.includes(u.id) },
    toObject: () => ({ _id: id, name: `Creature ${id}`, type: "monster", flags: { [M]: { cookbook: { id: cookbook } } }, prototypeToken: {} }),
  };
  world.actors.set(`lib-${id}`, doc);
  registry.set(doc.uuid, doc);
  return doc;
}

/** A world actor with the ownership table `levels` ({userId: level}, default NONE), read through `testUserPermission` as Foundry does. */
function makeWorldCreature(id, levels = {}) {
  const ownership = { default: 0, ...levels };
  const doc = {
    id,
    uuid: `Actor.${id}`,
    type: "monster",
    name: `Creature ${id}`,
    ownership,
    testUserPermission: (u, lvl) => level(ownership, u) >= { LIMITED: 1, OBSERVER: 2, OWNER }[lvl],
    toObject: () => ({ _id: id, name: `Creature ${id}`, type: "monster", flags: { [M]: { keep: 1 } }, prototypeToken: {} }),
  };
  registry.set(doc.uuid, doc);
  return doc;
}

await t("a creature on a shelf the Player can open is resolved by its cookbook id and summoned; a uuid: prefix and a plain uuid reach the same copy", async () => {
  setup();
  const shelf = makeShelfSource("shelf1", COOKBOOK, [p1.id]);
  const out = await summonRelay(place({ sourceUuid: COOKBOOK, castId: "castS1" }));
  assert.equal(out.ok, true, "a Player seat summons a creature on a shelf it can observe");
  assert.equal(calls.tokenCreate.length, 2);
  const rec = calls.tokenCreate[0].delta.flags[M][logic.SUMMON_RECORD_FLAG];
  assert.equal(rec.sourceUuid, shelf.uuid, "the record names the resolved document, not the ref the seat sent");
  assert.equal(rec.castId, "castS1");
  assert.equal(calls.actorCreate[0].flags[M][logic.SUMMON_COPY_FLAG].sourceUuid, shelf.uuid, "the one world copy is keyed by the resolved uuid");
  assert.equal((await summonRelay(place({ sourceUuid: `uuid:${shelf.uuid}`, positions: [{ x: 5, y: 5 }], count: 1 }))).ok, true);
  assert.equal(calls.actorCreate.length, 1, "both reach the one copy");
});

await t("a world actor carrying the same cookbook id at NONE does not stand in front of the shelf's own for a Player; a Judge takes the world's", async () => {
  setup();
  // The world's actors are read before the shelves', so the dragged-out actor is the first to carry the id.
  const dragged = makeWorldCreature("dragged");
  dragged.flags = { [M]: { cookbook: { id: COOKBOOK } } };
  dragged.getFlag = flagOf(dragged);
  world.actors.set("dragged", dragged);
  const shelf = makeShelfSource("shelf1", COOKBOOK, [p1.id]);
  const out = await summonRelay(place({ sourceUuid: COOKBOOK, castId: "castD1" }));
  assert.equal(out.ok, true, "the Player is not refused for a document they were not offered");
  assert.equal(calls.tokenCreate[0].delta.flags[M][logic.SUMMON_RECORD_FLAG].sourceUuid, shelf.uuid, "the copy is of the document the Player observes");
  const forGm = await summonRelay(place({ sourceUuid: COOKBOOK, requestUserId: null, positions: [{ x: 5, y: 5 }], count: 1, castId: "castD2" }));
  assert.equal(forGm.ok, true);
  assert.equal(calls.tokenCreate.at(-1).delta.flags[M][logic.SUMMON_RECORD_FLAG].sourceUuid, dragged.uuid, "a Judge observes both and takes the first, the world's");
  // With no shelf the Player observes, the first is still answered, and refused as itself.
  reset();
  setup();
  const lone = makeWorldCreature("lone");
  lone.flags = { [M]: { cookbook: { id: COOKBOOK } } };
  lone.getFlag = flagOf(lone);
  world.actors.set("lone", lone);
  makeShelfSource("shelf9", COOKBOOK, []);
  assert.deepEqual(await summonRelay(place({ sourceUuid: COOKBOOK })), { ok: false, reason: "unreadable" });
});

await t("a closed shelf is unreadable to a Player however the request names it, and nothing is made or spent; the GM is never refused", async () => {
  setup();
  const shelf = makeShelfSource();
  makeShelfSource("shelf2", "def.invented.other", [p1.id]);
  for (const ref of [COOKBOOK, shelf.uuid, `uuid:${shelf.uuid}`]) {
    assert.deepEqual(await summonRelay(place({ sourceUuid: ref })), { ok: false, reason: "unreadable" }, ref);
  }
  assert.equal(calls.actorCreate.length + calls.tokenCreate.length + calls.folderCreate.length, 0, "a refused request makes nothing");
  assert.equal((await summonRelay(place({ sourceUuid: "def.invented.other" }))).ok, true, "an open shelf by cookbook id is allowed");
  const forGm = await summonRelay(place({ sourceUuid: COOKBOOK, requestUserId: null, positions: [{ x: 5, y: 5 }], count: 1 }));
  assert.equal(forGm.ok, true, "a Judge reads every shelf");
});

await t("the relay tests the user who asked, not the GM client it runs on", async () => {
  setup();
  const shelf = makeShelfSource();
  assert.equal(game.user.isGM, true, "the relay runs on a GM client");
  assert.equal((await summonRelay(place({ sourceUuid: shelf.uuid, requestUserId: p2.id }))).reason, "unreadable", "a second Player who cannot observe it is refused too");
  assert.equal((await summonRelay(place({ sourceUuid: shelf.uuid, requestUserId: p1.id }))).reason, "unreadable");
  assert.equal(calls.actorCreate.length, 0);
});

await t("a world actor is summoned at OBSERVER and refused at LIMITED or NONE, the Player's own level deciding", async () => {
  setup();
  const summoner = makeSummoner("sum", [p1.id], [SPELL]);
  const ask = (source, user = p1) => logic.checkPlaceRequest({ user, summoner, source, count: 1, spellId: SPELL.id });
  assert.equal(ask(makeWorldCreature("w0")).reason, "unreadable", "default ownership NONE");
  assert.equal(ask(makeWorldCreature("w1", { [p1.id]: 1 })).reason, "unreadable", "LIMITED");
  assert.equal(ask(makeWorldCreature("w2", { [p1.id]: 2 })).ok, true, "OBSERVER");
  assert.equal(ask(makeWorldCreature("w3", { [p2.id]: 2 })).reason, "unreadable", "another user's level is not the asker's");
  assert.equal(ask(makeWorldCreature("w4"), gm).ok, true, "a Judge is never refused");
  const closed = makeWorldCreature("w5", { [p1.id]: 1 });
  assert.deepEqual(await summonRelay(place({ sourceUuid: closed.uuid })), { ok: false, reason: "unreadable" });
  closed.ownership[p1.id] = 2;
  assert.equal((await summonRelay(place({ sourceUuid: closed.uuid }))).ok, true, "raising the Player to OBSERVER lets the same request through");
});

await t("a ref no lookup answers is badSource, and a bare request never reaches the library by an id", async () => {
  setup();
  makeShelfSource();
  assert.equal((await summonRelay(place({ sourceUuid: "def.invented.nobody" }))).reason, "badSource");
  assert.equal((await summonRelay(place({ sourceUuid: "" }))).reason, "badSource");
  const bare = await summonRelay(place({ sourceUuid: COOKBOOK, spellId: "", requestUserId: null }));
  assert.equal(bare.reason, "badSource", "a GM's bare request names a document, not a cookbook id");
  assert.equal(calls.tokenCreate.length, 0);
});

await t("a bare request for a closed shelf is unreadable to a Player; a Judge's is allowed", async () => {
  setup();
  makeShelfSource();
  assert.equal((await summonRelay(place({ sourceUuid: "Compendium.test.Actor.shelf1", spellId: "" }))).reason, "unreadable");
  const bareForGm = await summonRelay(place({ sourceUuid: "Compendium.test.Actor.shelf1", spellId: "", requestUserId: null }));
  assert.equal(bareForGm.ok, true, "a GM reads every shelf");
});

await t("no creature is badSource on the seat's own check and on the relay's, with or without positions", () => {
  const summoner = makeSummoner("sum", [p1.id], [SPELL]);
  const ask = (extra) => logic.checkPlaceRequest({ user: p1, summoner, source: null, count: 1, spellId: SPELL.id, ...extra });
  assert.equal(ask({}).reason, "badSource");
  assert.equal(ask({ positions: [{ x: 1, y: 1 }] }).reason, "badSource");
  assert.equal(ask({ spellId: "" }).reason, "badSource");
  assert.equal(logic.checkPlaceRequest({ user: gm, summoner, source: null, count: 1, spellId: SPELL.id }).reason, "badSource", "a Judge needs a creature too");
  assert.equal(logic.checkPlaceRequest({ user: p1, summoner, source: makeSource("m1", { type: "character" }), count: 1, spellId: SPELL.id }).reason, "badSource", "a document of another type");
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

await t("a summon row's ref is named by its uuid, else by its importer id, and never by something that is no Actor", () => {
  const docs = { "Actor.inv1": { documentName: "Actor", name: "Glimmerkin" }, "Item.inv2": { documentName: "Item", name: "Not A Creature" }, "Compendium.x.y.Actor.inv3": { name: "Indexed Beast" } };
  const lookups = {
    fromUuidSync: (uuid) => {
      if (!uuid.includes(".")) throw new Error("invented: not a uuid");
      return docs[uuid] ?? null;
    },
    byCookbookId: (type, id) => (type === "Actor" && id === "def.invented.mote" ? { name: "Mote" } : null),
  };
  assert.equal(logic.summonRefName("uuid:Actor.inv1", lookups), "Glimmerkin", "a leading uuid: is dropped");
  assert.equal(logic.summonRefName("Compendium.x.y.Actor.inv3", lookups), "Indexed Beast", "a compendium index entry answers by its name");
  assert.equal(logic.summonRefName("def.invented.mote", lookups), "Mote", "an importer id answers through the library");
  assert.equal(logic.summonRefName("Item.inv2", lookups), null, "an Item is no creature");
  assert.equal(logic.summonRefName("nodots", lookups), null, "a throwing lookup counts as no answer");
  assert.equal(logic.summonRefName("", lookups), null);
});

/* -------------------------------------------- */
/*  The end of a cast's control                 */
/* -------------------------------------------- */

const { applyControlEnd } = await import("../scripts/lib/summons.mjs");

await t("the plan names a step for every creature, whatever the outcome, and reads an unknown outcome as stays", () => {
  const tokens = [{ uuid: "T.plain", ownership: { default: 0, p1: 3, p2: 3 } }, { uuid: "T.deployed", ownership: {}, member: { partyId: "pty", actorId: "m1" } }];
  const held = [{ partyId: "pty", actorId: "h1" }];
  const stays = logic.controlEndPlan({ outcome: "stays", tokens, held });
  assert.deepEqual(stays.steps.map((s) => [s.kind, s.op, s.lost]), [["token", "stamp", "stays"], ["token", "stamp", "stays"], ["held", "unapplied", "stays"]]);
  const gone = logic.controlEndPlan({ outcome: "gone", tokens, held });
  assert.deepEqual(gone.steps.map((s) => [s.op, s.lost]), [["delete", "gone"], ["release", "gone"], ["release", "gone"]]);
  assert.deepEqual([gone.steps[1].partyId, gone.steps[1].actorId], ["pty", "m1"], "a deployed member goes through the roster");
  assert.deepEqual(logic.controlEndPlan({ outcome: "gone", tokens, held, canRelease: false }).steps.map((s) => s.op), ["delete", "release", "unapplied"], "a stash with no release to call is left unapplied");
  const hostile = logic.controlEndPlan({ outcome: "hostile", tokens, held });
  assert.deepEqual(hostile.steps.map((s) => s.op), ["hostile", "hostile", "unapplied"]);
  assert.deepEqual(hostile.steps[0].drop, ["p1", "p2"], "every owner but the map's default is dropped");
  assert.equal(hostile.steps[0].disposition, logic.HOSTILE_DISPOSITION);
  assert.deepEqual(hostile.steps[1].drop, []);
  for (const word of ["vanish", "", undefined, null]) assert.equal(logic.controlEndPlan({ outcome: word, tokens }).outcome, "stays", String(word));
  assert.deepEqual(logic.controlEndPlan({ outcome: "gone" }), { outcome: "gone", steps: [] });
  assert.deepEqual(logic.ownershipDrop({ default: 2 }), []);
  assert.deepEqual(logic.ownershipDrop(undefined), []);
});

await t("a creature whose control ended is a Judge's to dismiss: a seat that names only such creatures is refused controlLost", async () => {
  const { summoner, scene } = setup();
  const lost = summoned(scene, summoner.uuid, { castId: "c1", sourceUuid: "x", at: 1, lost: "stays" });
  const live = summoned(scene, summoner.uuid, { castId: "c2", sourceUuid: "x", at: 1 });
  assert.deepEqual(logic.checkDismissRequest({ user: p1, summoner, tokens: [lost] }), { ok: false, reason: "controlLost" });
  const mixed = logic.checkDismissRequest({ user: p1, summoner, tokens: [lost, live] });
  assert.deepEqual([mixed.ok, mixed.tokens.map((x) => x.id), mixed.refused], [true, [live.id], 1], "the others go, the lost one is counted refused");
  const stranded = logic.checkDismissRequest({ user: p1, summoner, tokens: [], held: [{ partyId: "pty", actorId: "h1", summonedBy: summoner.uuid, summon: { castId: "c1", lost: "gone" } }] });
  assert.deepEqual(stranded, { ok: false, reason: "controlLost" }, "a stashed creature's record is held to the same test");
  assert.deepEqual(logic.checkDismissRequest({ user: gm, summoner, tokens: [lost] }).tokens.map((x) => x.id), [lost.id], "a GM seat dismisses it");
  assert.deepEqual(await dismissAs(summoner, { tokenUuids: [lost.uuid] }), { ok: false, reason: "controlLost" }, "the relay refuses it for an owner's request, and deletes nothing");
  assert.equal(calls.tokenDelete.length, 0);
  assert.deepEqual(await dismissAs(summoner, { tokenUuids: [lost.uuid], requestUserId: undefined }), { ok: true, deleted: 1, refused: 0 }, "a request from the GM seat removes it");
});

/** A summons of `summonerUuid` on `scene` whose delta names these owners. */
const summonedBy = (scene, summonerUuid, record, ownership) => {
  const id = `tok${++serial}`;
  const delta = { ownership, flags: { [M]: { [logic.SUMMON_FLAG]: summonerUuid, [logic.SUMMON_RECORD_FLAG]: record } } };
  const doc = tokenCtx(scene, id, { delta });
  scene.tokens.set(id, doc);
  registry.set(doc.uuid, doc);
  return doc;
};

await t("applyControlEnd is the GM client's alone: any other seat is refused and changes nothing", async () => {
  const { summoner, scene } = setup();
  summoned(scene, summoner.uuid, { castId: "cA", sourceUuid: "x", at: 1 });
  game.user = p1;
  try {
    assert.deepEqual(await applyControlEnd(summoner, { castId: "cA", outcome: "gone" }), { ok: false, reason: "notGm" });
  } finally {
    game.user = gm;
  }
  assert.deepEqual([calls.tokenDelete.length, calls.actorUpdate.length, calls.tokenUpdate.length], [0, 0, 0]);
  assert.deepEqual(await applyControlEnd(summoner, { castId: "", outcome: "gone" }), { ok: false, reason: "noCast" });
});

await t("a creature that goes is deleted by the cast's own recorded tokens: a decoy of the same name and creature, of another cast or bound by hand, is untouched", async () => {
  const { summoner, scene } = setup();
  const other = makeScene("s2", { active: false });
  const record = (castId) => ({ castId, sourceUuid: "Compendium.test.Actor.m1", name: "Creature m1", at: 1 });
  const a1 = summoned(scene, summoner.uuid, record("cA"));
  const a2 = summoned(other, summoner.uuid, record("cA"));
  const decoyCast = summoned(scene, summoner.uuid, record("cB"));
  const decoyHand = summoned(scene, summoner.uuid, null);
  const decoyOther = summoned(scene, "Actor.other", record("cA"));
  const dep = member("m1", summoner.uuid, "cA", scene);
  const stash = member("h1", summoner.uuid, "cA");
  const stashOther = member("h2", summoner.uuid, "cB");
  const provider = fakeProvider(new Map([["pty", [dep, stash, stashOther]]]));
  services.register("party-roster", provider.impl);
  const out = await applyControlEnd(summoner, { castId: "cA", outcome: "gone" });
  assert.deepEqual(out, { ok: true, outcome: "gone", stamped: 0, deleted: 2, released: 2, hostile: 0, unapplied: 0 }, "two plain tokens deleted, and the deployed member and the stash released, each counted by the road that removed it");
  assert.deepEqual([...calls.tokenDelete].sort(), [a1.id, a2.id, dep.token.id].sort(), "exactly the cast's recorded tokens");
  for (const survivor of [decoyCast, decoyHand, decoyOther]) assert.equal(survivor.parent.tokens.has(survivor.id), true, "the decoy stands");
  assert.deepEqual(provider.events.map((e) => [e[0], e[1], e[2]]), [["release", "pty", ["m1", "h1"]]], "the deployed member and the stash by roster ids, and the other cast's stash is not named");
});

await t("a creature that stays is stamped lost and nothing else is written", async () => {
  const { summoner, scene } = setup();
  const a1 = summoned(scene, summoner.uuid, { castId: "cA", sourceUuid: "x", at: 1 });
  const decoy = summoned(scene, summoner.uuid, { castId: "cB", sourceUuid: "x", at: 1 });
  services.register("party-roster", fakeProvider(new Map([["pty", [member("h1", summoner.uuid, "cA")]]])).impl);
  const out = await applyControlEnd(summoner, { castId: "cA", outcome: "stays" });
  assert.deepEqual(out, { ok: true, outcome: "stays", stamped: 1, deleted: 0, released: 0, hostile: 0, unapplied: 1 }, "a stash has no token to stamp and is counted");
  assert.deepEqual(calls.actorUpdate, [{ id: a1.id, patch: { [`flags.${M}.${logic.SUMMON_RECORD_FLAG}.lost`]: "stays" } }]);
  assert.equal(calls.tokenUpdate.length + calls.tokenDelete.length, 0);
  assert.equal(calls.actorUpdate.some((u) => u.id === decoy.id), false);
});

await t("a creature that turns hostile sets every owner to NONE, turns hostile and is stamped lost", async () => {
  const { summoner, scene } = setup();
  const a1 = summonedBy(scene, summoner.uuid, { castId: "cA", sourceUuid: "x", at: 1 }, { p1: 3, p2: 3 });
  const decoy = summonedBy(scene, summoner.uuid, { castId: "cB", sourceUuid: "x", at: 1 }, { p1: 3 });
  const out = await applyControlEnd(summoner, { castId: "cA", outcome: "hostile" });
  assert.deepEqual(out, { ok: true, outcome: "hostile", stamped: 1, deleted: 0, released: 0, hostile: 1, unapplied: 0 });
  assert.equal(calls.actorUpdate.length, 1);
  const patch = calls.actorUpdate[0].patch;
  assert.equal(patch[`flags.${M}.${logic.SUMMON_RECORD_FLAG}.lost`], "hostile");
  assert.deepEqual(Object.keys(patch.ownership).sort(), ["p1", "p2"]);
  assert.ok(Object.values(patch.ownership).every((v) => v === CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE), "a synthetic actor's ownership is a delta over the world copy's, so each owner is set to NONE: a forced deletion writes nothing there");
  assert.deepEqual(calls.tokenUpdate, [{ id: a1.id, patch: { disposition: logic.HOSTILE_DISPOSITION } }]);
  assert.equal(calls.actorUpdate.concat(calls.tokenUpdate).some((u) => u.id === decoy.id), false, "another cast's creature is untouched");
});

await t("with no roster release a stashed creature that should go is left, counted unapplied, and a cast with nothing standing is a no-op", async () => {
  const { summoner, scene } = setup();
  services.register("party-roster", fakeProvider(new Map([["pty", [member("h1", summoner.uuid, "cA")]]]), { release: false }).impl);
  assert.deepEqual(await applyControlEnd(summoner, { castId: "cA", outcome: "gone" }), { ok: true, outcome: "gone", stamped: 0, deleted: 0, released: 0, hostile: 0, unapplied: 1 });
  assert.deepEqual(await applyControlEnd(summoner, { castId: "cZ", outcome: "gone" }), { ok: true, outcome: "gone", stamped: 0, deleted: 0, released: 0, hostile: 0, unapplied: 0 });
  assert.equal(scene.tokens.size, 0);
});

await t("creatureOpens: a Judge always opens; a seat needs OBSERVER on the document, or on its pack for a pack document or an index entry; a missing document opens for a Judge alone; it agrees with sourceReadable where that answers", () => {
  const RANK = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };
  const level = (name) => ({ id: "u", isGM: false, rank: RANK[name] });
  const doc = { uuid: "Actor.w1", testUserPermission: (u, need) => RANK[need] <= u.rank };
  assert.equal(logic.creatureOpens(doc, { id: "gm", isGM: true }), true, "a GM");
  assert.equal(logic.creatureOpens(doc, level("OWNER")), true, "an owner");
  assert.equal(logic.creatureOpens(doc, level("OBSERVER")), true, "an observer");
  assert.equal(logic.creatureOpens(doc, level("LIMITED")), false, "below observer");
  assert.equal(logic.creatureOpens(doc, level("NONE")), false);
  const packDoc = { uuid: "Compendium.test.pack.Actor.a1", compendium: { testUserPermission: (u, need) => RANK[need] <= u.rank }, testUserPermission: () => true };
  assert.equal(logic.creatureOpens(packDoc, level("OBSERVER")), true, "a pack document is read through its pack, never its own answer");
  assert.equal(logic.creatureOpens(packDoc, level("LIMITED")), false);
  const entry = { uuid: "Compendium.test.pack.Actor.a1", name: "Entry" };
  const packs = { "test.pack": { testUserPermission: (u, need) => RANK[need] <= u.rank } };
  const packOf = (uuid) => packs[/^Compendium\.([^.]+\.[^.]+)\./u.exec(uuid)?.[1]] ?? null;
  assert.equal(logic.creatureOpens(entry, level("OBSERVER"), { packOf }), true, "an index entry reads its pack from the uuid");
  assert.equal(logic.creatureOpens(entry, level("LIMITED"), { packOf }), false);
  assert.equal(logic.creatureOpens(entry, { id: "gm", isGM: true }, { packOf }), true);
  assert.equal(logic.creatureOpens(entry, level("OWNER"), { packOf: () => null }), false, "an entry whose pack is not found opens for no seat");
  assert.equal(logic.creatureOpens({ uuid: "Actor.w2" }, level("OWNER"), { packOf }), false, "a world uuid names no pack");
  assert.equal(logic.creatureOpens(null, level("OWNER")), false, "a missing document");
  assert.equal(logic.creatureOpens(null, { id: "gm", isGM: true }), true);
  assert.equal(logic.creatureOpens(doc, null), false, "no user");
  for (const who of [level("NONE"), level("LIMITED"), level("OBSERVER"), level("OWNER"), { id: "gm", isGM: true }]) {
    for (const d of [doc, packDoc]) assert.equal(logic.creatureOpens(d, who), logic.sourceReadable(d, who), "the cast's own test, answered the same");
  }
});

await t("seatLabel: the name where the seat opens the creature, the neutral label where it does not", () => {
  assert.equal(logic.seatLabel({ name: "Hound", opens: true, neutral: "A creature" }), "Hound");
  assert.equal(logic.seatLabel({ name: "Hound", opens: false, neutral: "A creature" }), "A creature");
});

/* -------------------------------------------- */
/*  Joining the caster's party                   */
/* -------------------------------------------- */

const { joinSummons, announceJoin, joiningParty } = await import("../scripts/lib/summons.mjs");

const join = (over = {}) => ({
  op: "join",
  summonerUuid: "Actor.sum",
  sourceUuid: "Compendium.test.Actor.m1",
  count: 2,
  spellId: SPELL.id,
  requestUserId: p1.id,
  ...over,
});

/**
 * A party-roster provider with the v4 members: the caster `sum` marches inside
 * party `pty`, whose token `ptok` stands on `scene` at (300, 400). `admitSummons`
 * records what it was handed and answers one member id per stash.
 */
function joinProvider(scene, { party = true, admit = true, token = true } = {}) {
  const seen = [];
  if (token) scene.tokens.set("ptok", { id: "ptok", x: 300, y: 400, elevation: 5, level: "lvlA" });
  const impl = {
    list: () => [{ id: "pty", name: "Test Company" }],
    members: () => [],
    summonerParty: (actorId) => (party && actorId === "sum" ? { id: "pty", name: "Test Company", sceneId: scene.id, tokenId: "ptok" } : null),
  };
  if (admit) {
    impl.admitSummons = async (partyId, summonerUuid, stashes) => {
      seen.push({ partyId, summonerUuid, stashes });
      return { actorIds: stashes.map((_, i) => `mem${seen.length}.${i}`) };
    };
  }
  services.register("party-roster", impl);
  return seen;
}

const nothingMade = () => assert.equal(calls.actorCreate.length + calls.tokenCreate.length + calls.folderCreate.length, 0, "no copy, folder or token was made");

await t("a join is refused for what a placement is refused for, and makes nothing", async () => {
  const { scene } = setup();
  joinProvider(scene);
  assert.deepEqual(await summonRelay(join({ requestUserId: stranger.id })), { ok: false, reason: "notOwner" });
  assert.deepEqual(await summonRelay(join({ requestUserId: "ghost" })), { ok: false, reason: "noUser" });
  assert.equal((await summonRelay(join({ spellId: "" }))).reason, "spellRequired");
  assert.equal((await summonRelay(join({ spellId: "nope" }))).reason, "badSpell");
  assert.equal((await summonRelay(join({ count: 0 }))).reason, "badCount");
  assert.equal((await summonRelay(join({ count: logic.MAX_SUMMONS + 1 }))).reason, "badCount");
  assert.equal((await summonRelay(join({ sourceUuid: "Compendium.test.Actor.none" }))).reason, "badSource");
  nothingMade();
});

await t("a join is refused noParty where the caster marches inside no party token, and makes nothing", async () => {
  const { scene } = setup();
  assert.deepEqual(await summonRelay(join()), { ok: false, reason: "noParty" }, "no provider");
  services.register("party-roster", { list: () => [], members: () => [] });
  assert.equal((await summonRelay(join())).reason, "noParty", "a provider with no summonerParty");
  joinProvider(scene, { party: false });
  assert.equal((await summonRelay(join())).reason, "noParty", "no party for this caster");
  scene.tokens.clear();
  joinProvider(scene, { token: false });
  assert.equal((await summonRelay(join())).reason, "noParty", "the party token is not on the scene");
  joinProvider(scene, { admit: false });
  assert.equal((await summonRelay(join())).reason, "noParty", "a provider that cannot admit");
  nothingMade();
});

await t("a join hands the roster stashes stamped as a placement stamps its tokens, in the party token's place, and creates no token", async () => {
  const { summoner, scene } = setup();
  const seen = joinProvider(scene);
  hookCalls.length = 0;
  const out = await summonRelay(join({ castId: "castJ1", cast: { castId: "castJ1", casterLevel: 5 } }));
  assert.equal(out.ok, true);
  assert.equal(out.castId, "castJ1");
  assert.deepEqual(out.joined, ["mem1.0", "mem1.1"]);
  assert.deepEqual(out.party, { id: "pty", name: "Test Company" });
  assert.equal(out.tokenUuids, undefined);
  assert.equal(calls.tokenCreate.length, 0, "no token was made");
  assert.equal(scene.tokens.size, 1, "only the party token stands");
  assert.deepEqual(hookCalls, [], "a stash is no arrival to gather");
  assert.equal(calls.actorCreate.length, 1, "one world copy, as a placement makes it");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].partyId, "pty");
  assert.equal(seen[0].summonerUuid, summoner.uuid);
  const copyId = [...world.actors.keys()][0];
  assert.equal(seen[0].stashes.length, 2);
  for (const d of seen[0].stashes) {
    assert.equal(d._id, undefined);
    assert.equal(d.actorId, copyId, "each stash names the world copy");
    assert.equal(d.actorLink, false);
    assert.equal(d.hidden, false);
    assert.deepEqual([d.x, d.y, d.elevation, d.level], [300, 400, 5, "lvlA"], "the party token's place");
    assert.deepEqual(d.delta.ownership, { p1: OWNER, p2: OWNER }, "every owner of the character, never a GM");
    const rec = d.delta.flags[M][logic.SUMMON_RECORD_FLAG];
    assert.equal(d.delta.flags[M][logic.SUMMON_FLAG], summoner.uuid);
    assert.deepEqual([rec.castId, rec.at, rec.sourceUuid, rec.spellId, rec.spellName], ["castJ1", 42, "Compendium.test.Actor.m1", SPELL.id, SPELL.name]);
  }
  // The same request placed on the map stamps the same flags and the same owners.
  await summonRelay(place({ castId: "castJ1", positions: [{ x: 5, y: 5 }], count: 1 }));
  assert.deepEqual(calls.tokenCreate[0].delta, seen[0].stashes[0].delta, "one stamp, whichever way the creature is made");
});

await t("a join from a Judge stamps no GM as an owner, and a Player's co-owner is kept", async () => {
  const { scene } = setup();
  const seen = joinProvider(scene);
  const out = await summonRelay(join({ requestUserId: null, spellId: "" }));
  assert.equal(out.ok, true, "a Judge may summon bare");
  assert.deepEqual(seen[0].stashes[0].delta.ownership, { p1: OWNER, p2: OWNER });
  assert.equal(seen[0].stashes[0].delta.flags[M][logic.SUMMON_RECORD_FLAG].spellId, undefined);
});

await t("a join gives a monster its own hit-point roll where the world rolls summoned monsters', and none where it does not", async () => {
  const { scene } = setup();
  const seen = joinProvider(scene);
  await summonRelay(join());
  assert.equal(calls.rollHP.length, 0, "the setting is off");
  assert.equal(seen[0].stashes[0].delta.system, undefined);

  systemSettings.autoRollMonsterHP = true;
  hpRolls.push(11, 13);
  await summonRelay(join());
  assert.deepEqual(calls.rollHP.map((c) => c.autoUpdate), [false, false], "rolled for the stash alone, never written to the copy");
  assert.deepEqual(seen[1].stashes.map((d) => d.delta.system.hp), [{ max: 11, value: 11 }, { max: 13, value: 13 }], "each creature its own roll");
  assert.equal(calls.actorUpdate.length, 0);
});

await t("a join of a creature that is no monster rolls no hit points even with the setting on", async () => {
  const { scene } = setup({ source: { type: `${M}.animal` } });
  const seen = joinProvider(scene);
  systemSettings.autoRollMonsterHP = true;
  const out = await summonRelay(join());
  assert.equal(out.ok, true);
  assert.equal(calls.rollHP.length, 0);
  assert.equal(seen[0].stashes[0].delta.system, undefined);
});

await t("a join reaches the policies with no places and no scene, as the seat's pre-check does", async () => {
  const { scene } = setup();
  const seen = joinProvider(scene);
  const asked = [];
  const off = logic.registerSummonPolicy((req) => {
    asked.push([req.positions, req.scene, req.count]);
    return null;
  });
  try {
    await summonRelay(join());
    assert.deepEqual(asked, [[null, null, 2]]);
  } finally {
    off();
  }
  const refuse = logic.registerSummonPolicy(() => "policyNo");
  try {
    assert.equal((await summonRelay(join())).reason, "policyNo");
    assert.equal(seen.length, 1, "the refused join admitted nothing");
  } finally {
    refuse();
  }
});

await t("a roster that refuses the admission refuses the join noParty", async () => {
  const { scene } = setup();
  joinProvider(scene);
  services.register("party-roster", { ...services.get("party-roster"), admitSummons: async () => ({ actorIds: [], reason: "notInside" }) });
  assert.deepEqual(await summonRelay(join()), { ok: false, reason: "noParty" });
});

await t("joiningParty answers the roster's party for the caster, and null with no such method", async () => {
  const { summoner, scene } = setup();
  assert.equal(joiningParty(summoner), null, "no provider");
  joinProvider(scene);
  assert.deepEqual(joiningParty(summoner), { id: "pty", name: "Test Company", sceneId: scene.id, tokenId: "ptok" });
  assert.equal(joiningParty({ id: "other" }), null);
  assert.equal(joiningParty(null), null);
  services.register("party-roster", { list: () => [], members: () => [] });
  assert.equal(joiningParty(summoner), null, "a provider of an older contract");
});

await t("the seat's joinSummons refuses noParty before any request, and otherwise relays the join and tells the seat", async () => {
  const { scene } = setup();
  game.user = gm;
  const summoner = registry.get("Actor.sum");
  assert.deepEqual(await joinSummons(summoner, { sourceUuid: "Compendium.test.Actor.m1", count: 1, spellId: SPELL.id }), { ok: false, reason: "noParty" });
  nothingMade();
  const seen = joinProvider(scene);
  const out = await joinSummons(summoner, { sourceUuid: "Compendium.test.Actor.m1", count: 2, spellId: SPELL.id, cast: { castId: "castJ2", casterLevel: 4 } });
  assert.deepEqual(out, { ok: true, castId: "castJ2", joined: ["mem1.0", "mem1.1"], party: { id: "pty", name: "Test Company" } });
  assert.equal(seen[0].stashes[0].delta.flags[M][logic.SUMMON_RECORD_FLAG].castId, "castJ2");
  const minted = await joinSummons(summoner, { sourceUuid: "Compendium.test.Actor.m1", spellId: SPELL.id });
  assert.match(minted.castId, /^rid\d+$/, "the seat mints a cast id when none is named");
  assert.equal(minted.joined.length, 1, "a count of one by default");
  announceJoin(out);
  announceJoin({ ok: false, reason: "noParty" });
  assert.deepEqual(notes.info, [`ACKS-LIB.summons.joined`], "the localized key is what the mock returns");
  assert.deepEqual(notes.warn, ["ACKS-LIB.summons.refused.noParty"]);
  endSeat();
});

await t("heldSummonsOf names the party each held summon rides in", () => {
  const { summoner } = setup();
  services.register("party-roster", {
    list: () => [{ id: "pty", name: "Test Company" }, { id: "nameless" }],
    members: (id) => (id === "pty" ? [member("m1", summoner.uuid, "c1")].map((m) => ({ actorId: m.actorId, name: m.name, stashed: true, summonedBy: m.summonedBy, summon: m.summon })) : [{ actorId: "m2", name: "Wolf m2", stashed: true, summonedBy: summoner.uuid, summon: { castId: "c2" } }]),
  });
  assert.deepEqual(heldSummonsOf(summoner).map((h) => [h.partyId, h.partyName, h.actorId]), [["pty", "Test Company", "m1"], ["nameless", "", "m2"]]);
});

console.log(`\ntest-summons: ${n} tests passed`);
