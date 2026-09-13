/**
 * Deposit reach: who is standing where, and which place that puts them at.
 *
 * This surface had no suite, and the defects it shipped were all of one kind —
 * the code asked the right question of the wrong subject. A place's identity
 * was tested through `token.actor`, which on an UNLINKED token (Foundry's
 * default) is a synthetic document with a different uuid, so the whole ground
 * branch was dead on any ordinary map. A formation member was asked for their
 * own token, which joining a formation deletes. A refusal said "you are not
 * there" about places that were nowhere at all.
 *
 * Every token below is unlinked unless a case says otherwise, because that is
 * the shape a Judge actually drops on a map.
 *
 * Nothing here is a printed value: the coordinates, the grid and the elevations
 * are invented, and what they prove is the SHAPE — that reach follows a
 * footprint, that a floor is the scene's own square distance, and that a
 * refusal names a map only when there is one to name.
 */
import assert from "node:assert/strict";

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

globalThis.acksExtras ??= {};

class Coll extends Map {
  get contents() { return [...this.values()]; }
  find(fn) { return this.contents.find(fn); }
  filter(fn) { return this.contents.filter(fn); }
  some(fn) { return this.contents.some(fn); }
  [Symbol.iterator]() { return this.values(); }
}

const scenes = new Coll();
const actors = new Coll();
const byUuid = new Map();
let formations = {};
let providers = [];

globalThis.foundry = { utils: { deepClone: (v) => (v == null || typeof v !== "object" ? v : structuredClone(v)) } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
globalThis.CONFIG = {};
globalThis.Hooks = { on() {}, once() {}, call() {}, callAll() {} };
globalThis.ui = { notifications: {} };
globalThis.canvas = {};
globalThis.fromUuidSync = (uuid) => byUuid.get(uuid) ?? null;
globalThis.game = {
  scenes,
  actors,
  user: { isGM: true, id: "gm" },
  settings: { get: (_module, key) => (key === "formations" ? formations : undefined) },
  i18n: { localize: (k) => k, format: (k) => k },
};
globalThis.acksExtras.lib = {
  storage: {
    vaultOwnerUuid: (place) => place?.vaultOwner ?? null,
    providers: () => providers,
  },
};

const { depositReach, reachablePlaces, reachScan } = await import("../scripts/location/reach.mjs");
const { placeUnderParty, placeReachesSpot, placeStandsOn } = await import("../scripts/location/here.mjs");
const { LOCATION_TYPE, MODULE_ID, SCENE_LINK_FLAG } = await import("../scripts/location/constants.mjs");

/* -------------------------------------------- */
/*  Fixtures                                    */
/* -------------------------------------------- */

let seq = 0;
const id = (p) => `${p}${++seq}`;

/** 100px squares worth 5 feet each: the padding is one square either way. */
const GRID = 100;
const FOOT = 5;

function reset() {
  scenes.clear();
  actors.clear();
  byUuid.clear();
  formations = {};
  providers = [];
}

function makeScene(name, { distance = FOOT } = {}) {
  const sid = id("scene");
  const scene = {
    id: sid,
    name,
    documentName: "Scene",
    grid: { size: GRID, distance },
    tokens: new Coll(),
    flags: {},
    getFlag(ns, key) { return this.flags?.[ns]?.[key] ?? null; },
  };
  scene.uuid = `Scene.${sid}`;
  scenes.set(sid, scene);
  byUuid.set(scene.uuid, scene);
  return scene;
}

function makeActor(name, type, extra = {}) {
  const aid = id("actor");
  const actor = {
    id: aid,
    uuid: `Actor.${aid}`,
    name,
    type,
    ownership: {},
    isOwner: false,
    system: {},
    getFlag: () => null,
    ...extra,
  };
  actors.set(aid, actor);
  byUuid.set(actor.uuid, actor);
  return actor;
}

const makePlace = (name, extra) => makeActor(name, LOCATION_TYPE, extra);
const makeHero = (name) => makeActor(name, "character");

/**
 * Drop a token. UNLINKED by default, so `token.actor` is a synthetic document
 * whose uuid is NOT the world actor's — the shape every identity test here has
 * to survive.
 */
function drop(scene, actor, { x, y, w = 1, h = 1, elevation = 0, hidden = false, linked = false } = {}) {
  const tid = id("token");
  const token = {
    id: tid,
    actorId: actor.id,
    x, y, width: w, height: h, elevation, hidden,
    parent: scene,
    actor: linked ? actor : { ...actor, uuid: `${scene.uuid}.Token.${tid}.Actor.${actor.id}` },
  };
  scene.tokens.set(tid, token);
  return token;
}

/** A formation holding these members, its party token dropped at (x, y). */
function march(scene, members, { x = 600, y = 600, elevation = 0 } = {}) {
  const party = makeActor("The Company", `${MODULE_ID}.party`);
  const token = drop(scene, party, { x, y, elevation, linked: true });
  const record = {
    id: id("formation"),
    name: "The Company",
    members: members.map((m) => ({ actorId: m.id })),
    sceneId: scene.id,
    tokenId: token.id,
    clock: {},
  };
  formations[record.id] = record;
  return record;
}

const linkScene = (scene, place) => {
  scene.flags[MODULE_ID] = { [SCENE_LINK_FLAG]: place.uuid };
  place.system.sceneUuid = scene.uuid;
};

let passed = 0;
const ok = (name, fn) => { reset(); fn(); passed++; console.log("ok   " + name); };

/* -------------------------------------------- */
/*  The ground branch                           */
/* -------------------------------------------- */

ok("an unlinked place token underfoot is reachable", () => {
  const town = makeScene("Town Square");
  const hero = makeHero("Balas");
  const cart = makePlace("The Cart");
  drop(town, cart, { x: 500, y: 500 });
  march(town, [hero], { x: 600, y: 600 });

  const reach = depositReach(hero, cart);
  assert.equal(reach.can, true, "the party token stands one square from the cart");
  assert.equal(reach.scene, town);
});

ok("placeUnderParty names the WORLD actor, not the token's synthetic one", () => {
  const town = makeScene("Town Square");
  const hero = makeHero("Balas");
  const shrine = makePlace("The Shrine");
  drop(town, shrine, { x: 500, y: 500 });
  const formation = march(town, [hero], { x: 600, y: 600 });

  const under = placeUnderParty(formation);
  assert.equal(under?.uuid, shrine.uuid, "a caller compares this uuid against a place's");
  assert.equal(under, shrine);
});

ok("neighbouring places are each reachable, though only one is 'under'", () => {
  const town = makeScene("Town Square");
  const hero = makeHero("Balas");
  const cart = makePlace("The Cart");
  const stall = makePlace("The Stall");
  drop(town, cart, { x: 500, y: 500 });
  drop(town, stall, { x: 700, y: 500 });
  const formation = march(town, [hero], { x: 600, y: 600 });

  assert.equal(depositReach(hero, cart).can, true);
  assert.equal(depositReach(hero, stall).can, true, "the second marker is not shadowed by the first");
  assert.ok([cart, stall].includes(placeUnderParty(formation)), "the display reader still names one of them");
});

ok("out of reach on the same map is notHere, and the map is named", () => {
  const town = makeScene("Town Square");
  const hero = makeHero("Balas");
  const cart = makePlace("The Cart");
  drop(town, cart, { x: 500, y: 500 });
  march(town, [hero], { x: 3000, y: 3000 });

  const reach = depositReach(hero, cart);
  assert.equal(reach.can, false);
  assert.equal(reach.reason, "notHere");
  assert.equal(reach.scene?.name, "Town Square", "the message has somewhere to send them");
});

ok("a place on another map is notHere and names THAT map", () => {
  const town = makeScene("Town Square");
  const docks = makeScene("The Docks");
  const hero = makeHero("Balas");
  const cart = makePlace("The Cart");
  drop(docks, cart, { x: 500, y: 500 });
  march(town, [hero]);

  const reach = depositReach(hero, cart);
  assert.equal(reach.reason, "notHere");
  assert.equal(reach.scene?.name, "The Docks");
});

ok("a place on no map at all is notYours, never notHere", () => {
  const town = makeScene("Town Square");
  const hero = makeHero("Balas");
  const vault = makePlace("A Stranger's Vault");
  march(town, [hero]);

  const reach = depositReach(hero, vault);
  assert.equal(reach.reason, "notYours", "there is nowhere to send them, so do not pretend there is");
  assert.equal(reach.scene, null);
});

ok("a hidden place token is not there for anyone standing on it", () => {
  const town = makeScene("Town Square");
  const hero = makeHero("Balas");
  const cache = makePlace("The Buried Cache");
  drop(town, cache, { x: 500, y: 500, hidden: true });
  march(town, [hero], { x: 600, y: 600 });

  const reach = depositReach(hero, cache);
  assert.equal(reach.can, false);
  assert.equal(reach.reason, "notYours", "a hidden marker does not even make the place 'somewhere'");
  assert.equal(placeStandsOn(town, cache), false);
});

/* -------------------------------------------- */
/*  Floors                                      */
/* -------------------------------------------- */

ok("a step of elevation is the same floor; a storey is not", () => {
  const tower = makeScene("The Tower");
  const hero = makeHero("Balas");
  const altar = makePlace("The Altar");
  const chest = makePlace("The Roof Chest");
  drop(tower, altar, { x: 500, y: 500, elevation: FOOT });
  drop(tower, chest, { x: 500, y: 500, elevation: FOOT * 4 });
  march(tower, [hero], { x: 600, y: 600, elevation: 0 });

  assert.equal(depositReach(hero, altar).can, true, "within one square's distance vertically");
  assert.equal(depositReach(hero, chest).can, false, "a floor above is not underfoot");
});

ok("a scene declaring no square distance falls back to exact elevation", () => {
  const tower = makeScene("The Tower", { distance: 0 });
  const hero = makeHero("Balas");
  const altar = makePlace("The Altar");
  drop(tower, altar, { x: 500, y: 500, elevation: 1 });
  march(tower, [hero], { x: 600, y: 600, elevation: 0 });

  assert.equal(depositReach(hero, altar).can, false, "no band declared, so no band invented");
});

/* -------------------------------------------- */
/*  Whose token is on the ground                */
/* -------------------------------------------- */

ok("a character no formation claims reaches through their own token", () => {
  const town = makeScene("Town Square");
  const hero = makeHero("Balas");
  const cart = makePlace("The Cart");
  drop(town, cart, { x: 500, y: 500 });
  drop(town, hero, { x: 600, y: 600 });

  assert.equal(depositReach(hero, cart).can, true);
});

ok("a formation answers alone — a member's stale token does not reach", () => {
  const town = makeScene("Town Square");
  const hero = makeHero("Balas");
  const cart = makePlace("The Cart");
  drop(town, cart, { x: 500, y: 500 });
  drop(town, hero, { x: 600, y: 600 });
  march(town, [hero], { x: 3000, y: 3000 });

  const reach = depositReach(hero, cart);
  assert.equal(reach.can, false, "the company marched off without leaving them behind");
  assert.equal(reach.reason, "notHere");
});

ok("a character standing on two maps reaches a place on either", () => {
  const town = makeScene("Town Square");
  const docks = makeScene("The Docks");
  const hero = makeHero("Balas");
  const cart = makePlace("The Cart");
  drop(docks, cart, { x: 500, y: 500 });
  drop(town, hero, { x: 600, y: 600 });
  drop(docks, hero, { x: 600, y: 600 });

  assert.equal(depositReach(hero, cart).scene, docks);
});

/* -------------------------------------------- */
/*  The linked-scene half                       */
/* -------------------------------------------- */

ok("a formation member is AT a linked scene their party token stands on", () => {
  const taproom = makeScene("The Wayfarer's Taproom");
  const hero = makeHero("Balas");
  const inn = makePlace("The Wayfarer");
  linkScene(taproom, inn);
  march(taproom, [hero]);

  const reach = depositReach(hero, inn);
  assert.equal(reach.can, true, "joining a formation deletes your own token; the party's is the one standing there");
  assert.equal(reach.scene, taproom);
});

ok("a formation elsewhere is notHere about the linked scene", () => {
  const taproom = makeScene("The Wayfarer's Taproom");
  const road = makeScene("The North Road");
  const hero = makeHero("Balas");
  const inn = makePlace("The Wayfarer");
  linkScene(taproom, inn);
  march(road, [hero]);

  const reach = depositReach(hero, inn);
  assert.equal(reach.can, false);
  assert.equal(reach.reason, "notHere");
  assert.equal(reach.scene, taproom);
});

ok("a lone character is AT a linked scene their own token stands on", () => {
  const taproom = makeScene("The Wayfarer's Taproom");
  const hero = makeHero("Balas");
  const inn = makePlace("The Wayfarer");
  linkScene(taproom, inn);
  drop(taproom, hero, { x: 100, y: 100 });

  assert.equal(depositReach(hero, inn).can, true);
});

ok("a linked place is gated on presence even for its owner", () => {
  const taproom = makeScene("The Wayfarer's Taproom");
  const road = makeScene("The North Road");
  const hero = makeHero("Balas");
  const inn = makePlace("The Wayfarer", { isOwner: true });
  linkScene(taproom, inn);
  march(road, [hero]);

  assert.equal(depositReach(hero, inn).can, false, "a map is a place you have to be at");
});

/* -------------------------------------------- */
/*  The claims that answer without a map         */
/* -------------------------------------------- */

ok("your own vault answers wherever you are", () => {
  const road = makeScene("The North Road");
  const hero = makeHero("Balas");
  const vault = makePlace("Balas's Vault");
  vault.vaultOwner = hero.uuid;
  march(road, [hero]);

  assert.equal(depositReach(hero, vault).can, true);
});

ok("an unlinked place you own answers without standing anywhere", () => {
  const road = makeScene("The North Road");
  const hero = makeHero("Balas");
  const warehouse = makePlace("The Warehouse", { isOwner: true });
  march(road, [hero]);

  assert.equal(depositReach(hero, warehouse).can, true);
});

ok("a missing actor or place is gone", () => {
  const place = makePlace("The Cart");
  assert.equal(depositReach(null, place).reason, "gone");
  assert.equal(depositReach(makeHero("Balas"), null).reason, "gone");
});

/* -------------------------------------------- */
/*  The shared scan                             */
/* -------------------------------------------- */

ok("a shared scan gives the same answers as a fresh one", () => {
  const town = makeScene("Town Square");
  const docks = makeScene("The Docks");
  const hero = makeHero("Balas");
  const cart = makePlace("The Cart");
  const stall = makePlace("The Stall");
  const nowhere = makePlace("A Rumoured Bank");
  drop(town, cart, { x: 500, y: 500 });
  drop(docks, stall, { x: 500, y: 500 });
  march(town, [hero], { x: 600, y: 600 });

  const scan = reachScan(hero);
  for (const place of [cart, stall, nowhere]) {
    const fresh = depositReach(hero, place);
    const shared = depositReach(hero, place, { scan });
    assert.deepEqual(
      { can: shared.can, reason: shared.reason, scene: shared.scene?.id ?? null },
      { can: fresh.can, reason: fresh.reason, scene: fresh.scene?.id ?? null },
      place.name,
    );
  }
});

ok("reachScan indexes a scene once however many tokens an actor has on it", () => {
  const town = makeScene("Town Square");
  const hero = makeHero("Balas");
  const cart = makePlace("The Cart");
  drop(town, cart, { x: 500, y: 500 });
  drop(town, cart, { x: 900, y: 900 });

  assert.deepEqual(reachScan(hero).placedOn.get(cart.id), [town]);
});

ok("reachablePlaces offers exactly what depositReach allows", () => {
  const town = makeScene("Town Square");
  const hero = makeHero("Balas");
  const cart = makePlace("The Cart");
  const far = makePlace("The Far Stall");
  providers = [cart, far];
  drop(town, cart, { x: 500, y: 500 });
  drop(town, far, { x: 3000, y: 3000 });
  march(town, [hero], { x: 600, y: 600 });

  assert.deepEqual(reachablePlaces(hero), [cart]);
});

/* -------------------------------------------- */
/*  The predicate itself                        */
/* -------------------------------------------- */

ok("placeReachesSpot answers about the place it was asked about", () => {
  const town = makeScene("Town Square");
  const cart = makePlace("The Cart");
  const stall = makePlace("The Stall");
  drop(town, cart, { x: 500, y: 500 });
  const spot = { scene: town, point: { x: 650, y: 650 }, elevation: 0 };

  assert.equal(placeReachesSpot(cart, spot), true);
  assert.equal(placeReachesSpot(stall, spot), false, "a place with no token here reaches nothing");
  assert.equal(placeReachesSpot(cart, null), false);
  assert.equal(placeReachesSpot(null, spot), false);
});

console.log(`\ntest-location-reach: OK (${passed} checks — identity, floors, whose token, the linked half, the scan)`);
