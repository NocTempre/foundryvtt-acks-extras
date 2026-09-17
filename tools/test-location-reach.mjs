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
 * `game.user` is a PLAYER, and ownership is stated as the document's own
 * `ownership` map — the thing Foundry derives every permission answer from.
 * `isOwner` is derived from it here the way core derives it, seat included, so
 * moving `game.user` moves the answer: a mock that pins the field to false while
 * claiming a GM seat models a client that cannot exist, and a reach gate proved
 * under one is proved under nothing.
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

/** The user the fixtures below belong to, and the seat the mock sits in. */
const PLAYER = "u1";
/** A second player, for a claim this character's owners do not share. */
const STRANGER = "u2";
/** Ownership map naming one user as OWNER. */
const owned = (userId = PLAYER) => ({ ownership: { [userId]: 3 } });

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
  user: { isGM: false, id: PLAYER },
  settings: { get: (_module, key) => (key === "formations" ? formations : undefined) },
  i18n: { localize: (k) => k, format: (k) => k },
};
globalThis.acksExtras.lib = {
  storage: {
    vaultOwnerUuid: (place) => place?.vaultOwner ?? null,
    providers: () => providers,
  },
};

const { depositReach, reachablePlaces, reachScan, ownersShare } = await import("../scripts/location/reach.mjs");
const { placeUnderParty, placeReachesSpot, placeStandsOn } = await import("../scripts/location/here.mjs");
const { LOCATION_TYPE, MODULE_ID, SCENE_LINK_FLAG } = await import("../scripts/location/constants.mjs");
// `coinReach`'s actor-to-actor branch asks the same question these fixtures are
// built to answer — which body is on which map — so it is proved here rather
// than in `test-money.mjs`, which is deliberately Foundry-free.
const { coinReach } = await import("../scripts/lib/money.mjs");

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
    system: {},
    getFlag: () => null,
    /**
     * Foundry's own derivation (`testUserPermission`), not a stored field: a GM
     * is OWNER of every document whatever the ownership map says. Pinning this
     * to false while claiming a GM seat models a client that cannot exist, and a
     * gate proved under one is proved under nothing — so the two seats are
     * switched between here by moving `game.user`, exactly as a real world does.
     */
    get isOwner() {
      return game.user.isGM || (this.ownership?.[game.user.id] ?? this.ownership?.default ?? 0) >= 3;
    },
    ...extra,
  };
  actors.set(aid, actor);
  byUuid.set(actor.uuid, actor);
  return actor;
}

const makePlace = (name, extra) => makeActor(name, LOCATION_TYPE, extra);
const makeHero = (name, extra) => makeActor(name, "character", extra);

/**
 * Drop a token. UNLINKED by default, so `token.actor` is a synthetic document
 * whose uuid is NOT the world actor's — the shape every identity test here has
 * to survive. The synthetic actor carries `isToken` and a handle on its own
 * token, because that pair is how Foundry tells one BODY from the sheet every
 * copy of it shares, and it keeps the base actor's `id`.
 */
function drop(scene, actor, { x, y, w = 1, h = 1, elevation = 0, hidden = false, linked = false } = {}) {
  const tid = id("token");
  const token = {
    id: tid,
    uuid: `${scene.uuid}.Token.${tid}`,
    actorId: actor.id,
    x, y, width: w, height: h, elevation, hidden,
    parent: scene,
  };
  token.actor = linked
    ? actor
    : { ...actor, uuid: `${token.uuid}.Actor.${actor.id}`, isToken: true, token };
  scene.tokens.set(tid, token);
  return token;
}

/**
 * A formation holding these members. Its party token is dropped at (x, y)
 * unless `placed` says otherwise — a formation with none is what
 * `createFormation` mints, what a hand-made party actor is adopted into, and
 * what the deleteToken hook deliberately leaves behind.
 */
function march(scene, members, { x = 600, y = 600, elevation = 0, placed = true } = {}) {
  const party = makeActor("The Company", `${MODULE_ID}.party`);
  const token = placed ? drop(scene, party, { x, y, elevation, linked: true }) : null;
  const record = {
    id: id("formation"),
    name: "The Company",
    members: members.map((m) => ({ actorId: m.id })),
    sceneId: token ? scene.id : null,
    tokenId: token?.id ?? null,
    clock: {},
  };
  formations[record.id] = record;
  return record;
}

/** Mark a member as standing on the map under the token the deploy made. */
function deploy(formation, actor, token) {
  const member = formation.members.find((m) => m.actorId === actor.id);
  member.deployedTokenId = token.id;
  return member;
}

/**
 * Send a cell out AS A STACK, the way `deployMembers` does: the bodies are built
 * from the stack's TEMPLATE actor, so they are dropped here under a separate
 * actor and the cell records only THAT it is out. No token on any map carries
 * the cell's own actor id, which is the whole reason a stack is not an
 * individual for reach.
 */
function deployStack(formation, actor, scene, { x = 3000, y = 3000, bodies = 2 } = {}) {
  const template = makeActor(`${actor.name} (template)`, "character");
  for (let i = 0; i < bodies; i++) drop(scene, template, { x: x + i * GRID, y });
  const member = formation.members.find((m) => m.actorId === actor.id);
  member.deployedStack = true;
  return member;
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

ok("a formation with no party token falls back to its members' own tokens", () => {
  const town = makeScene("Town Square");
  const hero = makeHero("Balas");
  const cart = makePlace("The Cart");
  drop(town, cart, { x: 500, y: 500 });
  drop(town, hero, { x: 600, y: 600 });
  march(town, [hero], { placed: false });

  const reach = depositReach(hero, cart);
  assert.equal(reach.can, true, "a company with no body on any map cannot be the thing standing there");
  assert.equal(reach.scene, town);
});

ok("a token-less formation does not strand its members at a linked scene either", () => {
  const taproom = makeScene("The Wayfarer's Taproom");
  const hero = makeHero("Balas");
  const inn = makePlace("The Wayfarer");
  linkScene(taproom, inn);
  drop(taproom, hero, { x: 100, y: 100 });
  march(taproom, [hero], { placed: false });

  assert.equal(depositReach(hero, inn).can, true, "the refusal would have named the very scene they stand on");
});

ok("a deployed member is at their deployed token, not at the party token", () => {
  const town = makeScene("Town Square");
  const hero = makeHero("Balas");
  const cart = makePlace("The Cart");
  drop(town, cart, { x: 500, y: 500 });
  const scout = drop(town, hero, { x: 600, y: 600 });
  const formation = march(town, [hero], { x: 3000, y: 3000 });
  deploy(formation, hero, scout);

  const reach = depositReach(hero, cart);
  assert.equal(reach.can, true, "a detached scout beside the cart is beside the cart");
  assert.equal(reach.scene, town);
});

ok("a deployed member reaches from THAT token and no other of their own", () => {
  const town = makeScene("Town Square");
  const cart = makePlace("The Cart");
  const hero = makeHero("Balas");
  drop(town, cart, { x: 500, y: 500 });
  const stale = drop(town, hero, { x: 600, y: 600 });
  const scout = drop(town, hero, { x: 3000, y: 3000 });
  const formation = march(town, [hero], { x: 3000, y: 3000 });
  deploy(formation, hero, scout);

  const reach = depositReach(hero, cart);
  assert.equal(reach.can, false, "the leftover beside the cart is not the body the deploy sent out");
  assert.equal(reach.reason, "notHere");
  assert.ok(stale.id !== scout.id);
});

ok("a cell deployed as a stack still stands at the party token", () => {
  const town = makeScene("Town Square");
  const troop = makeActor("Kalynn's Spears", `${MODULE_ID}.group`);
  const cart = makePlace("The Cart");
  drop(town, cart, { x: 500, y: 500 });
  const formation = march(town, [troop], { x: 600, y: 600 });
  deployStack(formation, troop, town);

  const reach = depositReach(troop, cart);
  assert.equal(reach.can, true, "the bodies are the template's tokens, so the cell is still found at the party");
  assert.equal(reach.scene, town);
});

ok("a deployed stack does not reach from a leftover token of its own", () => {
  const town = makeScene("Town Square");
  const troop = makeActor("Kalynn's Spears", `${MODULE_ID}.group`);
  const cart = makePlace("The Cart");
  drop(town, cart, { x: 500, y: 500 });
  drop(town, troop, { x: 600, y: 600 });
  const formation = march(town, [troop], { x: 3000, y: 3000 });
  deployStack(formation, troop, town);

  const reach = depositReach(troop, cart);
  assert.equal(reach.can, false, "a stack sends out template bodies; a token wearing the cell's own name is a leftover");
  assert.equal(reach.reason, "notHere");
});

ok("an unlinked copy does not reach what its duplicate is standing beside", () => {
  const town = makeScene("Town Square");
  const cellar = makeScene("The Cellar");
  const hireling = makeHero("Dolf");
  const cart = makePlace("The Cart");
  drop(town, cart, { x: 500, y: 500 });
  const above = drop(town, hireling, { x: 600, y: 600 });
  const below = drop(cellar, hireling, { x: 600, y: 600 });

  assert.equal(depositReach(above.actor, cart).can, true, "this copy is the one beside the cart");
  assert.equal(depositReach(below.actor, cart).can, false, "one sheet, two bodies — and only one of them is there");
  assert.equal(depositReach(below.actor, cart).reason, "notHere");
});

ok("a formation holding the base actor does not answer for an unlinked copy", () => {
  const town = makeScene("Town Square");
  const hireling = makeHero("Dolf");
  const cart = makePlace("The Cart");
  drop(town, cart, { x: 500, y: 500 });
  const copy = drop(town, hireling, { x: 600, y: 600 });
  march(town, [hireling], { x: 3000, y: 3000 });

  assert.equal(depositReach(copy.actor, cart).can, true, "the copy stands on its own feet, not inside the party token");
  assert.equal(depositReach(hireling, cart).can, false, "the member riding inside still answers through the party token");
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
  const hero = makeHero("Balas", owned());
  const inn = makePlace("The Wayfarer", owned());
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

ok("an unlinked place your OWNER owns answers without standing anywhere", () => {
  const road = makeScene("The North Road");
  const hero = makeHero("Balas", owned());
  const warehouse = makePlace("The Warehouse", owned());
  march(road, [hero]);

  assert.equal(depositReach(hero, warehouse).can, true);
});

ok("a place owned by somebody else is notYours, on the Judge's seat too", () => {
  const road = makeScene("The North Road");
  const hero = makeHero("Balas", owned());
  const stash = makePlace("A Stranger's Stash", owned(STRANGER));
  march(road, [hero]);

  const asPlayer = depositReach(hero, stash);
  const seat = game.user;
  try {
    // The Judge's client: `isOwner` is true of every document on it, so a gate
    // that asks the document says yes here and no on the player's screen.
    game.user = { isGM: true, id: "gm" };
    const asJudge = depositReach(hero, stash);
    assert.equal(asJudge.can, false, "the answer belongs to the actor, not to the client reading it");
    assert.equal(asJudge.reason, "notYours");
    assert.deepEqual({ can: asJudge.can, reason: asJudge.reason }, { can: asPlayer.can, reason: asPlayer.reason });
  } finally {
    game.user = seat;
  }
});

ok("a place open to everyone answers for a character with an owner", () => {
  const road = makeScene("The North Road");
  const hero = makeHero("Balas", owned());
  const commons = makePlace("The Common Granary", { ownership: { default: 3 } });
  march(road, [hero]);

  assert.equal(depositReach(hero, commons).can, true, "the place's default level reaches the character's owners");
});

ok("ownersShare asks the users who own the CHARACTER, and only the place's default counts", () => {
  const hero = makeHero("Balas", owned());
  assert.equal(ownersShare(hero, makePlace("Mine", owned())), true, "an owner in common");
  assert.equal(ownersShare(hero, makePlace("Commons", { ownership: { default: 3 } })), true,
    "a place open to everyone is open to the character's owners");
  assert.equal(ownersShare(hero, makePlace("Theirs", owned(STRANGER))), false, "somebody else's is not");
  assert.equal(ownersShare(hero, makePlace("Watched", { ownership: { [PLAYER]: 2 } })), false,
    "an observer of the place is not its owner");
  // The subject's default names no user, so reading it as "everyone" would let
  // any character the world left open reach every place anyone owns.
  assert.equal(ownersShare(makeHero("Nobody", { ownership: { default: 3 } }), makePlace("Mine", owned())), false,
    "the subject's default never counts");
  assert.equal(ownersShare(makeHero("Seen", { ownership: { [PLAYER]: 2 } }), makePlace("Mine", owned())), false,
    "nor does a user who merely observes the character");
  assert.equal(ownersShare(null, makePlace("Mine", owned())), false);
  assert.equal(ownersShare(hero, null), false);
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
/*  Hand to hand: the coin gate                 */
/* -------------------------------------------- */

ok("coin passes between two actors standing on one map", () => {
  const town = makeScene("Town Square");
  const payer = makeHero("Balas");
  const payee = makeHero("Dolf");
  drop(town, payer, { x: 100, y: 100 });
  drop(town, payee, { x: 900, y: 900 });

  assert.equal(coinReach(payer, payee).can, true, "a world actor answers for the tokens naming it");
});

ok("coin does not pass between actors on different maps", () => {
  const town = makeScene("Town Square");
  const cellar = makeScene("The Cellar");
  const payer = makeHero("Balas");
  const payee = makeHero("Dolf");
  drop(town, payer, { x: 100, y: 100 });
  drop(cellar, payee, { x: 100, y: 100 });

  const reach = coinReach(payer, payee);
  assert.equal(reach.can, false);
  assert.equal(reach.reason, "notTogether");
});

ok("an unlinked copy cannot hand coin across the map from its duplicate", () => {
  const town = makeScene("Town Square");
  const cellar = makeScene("The Cellar");
  const hireling = makeHero("Dolf");
  const payer = makeHero("Balas");
  drop(town, payer, { x: 100, y: 100 });
  drop(town, hireling, { x: 200, y: 200 });
  const below = drop(cellar, hireling, { x: 100, y: 100 });

  assert.equal(coinReach(payer, below.actor).can, false, "the copy in the cellar is not the one in the square");
  assert.equal(coinReach(payer, below.actor).reason, "notTogether");
  assert.equal(coinReach(below.actor, payer).can, false, "and the gate is the same read from either side");
});

ok("a copy standing beside the payer still takes the coin", () => {
  const town = makeScene("Town Square");
  const cellar = makeScene("The Cellar");
  const hireling = makeHero("Dolf");
  const payer = makeHero("Balas");
  drop(town, payer, { x: 100, y: 100 });
  const above = drop(town, hireling, { x: 200, y: 200 });
  drop(cellar, hireling, { x: 100, y: 100 });

  assert.equal(coinReach(payer, above.actor).can, true, "matching one body is not refusing every body");
});

ok("a linked token's actor is the world actor, and pays as one", () => {
  const town = makeScene("Town Square");
  const payer = makeHero("Balas");
  const payee = makeHero("Dolf");
  const linked = drop(town, payee, { x: 900, y: 900, linked: true });
  drop(town, payer, { x: 100, y: 100 });

  assert.equal(linked.actor, payee, "a linked token hands back the sheet itself");
  assert.equal(coinReach(payer, linked.actor).can, true);
});

ok("an employer reaches their hireling without sharing a map", () => {
  makeScene("Town Square");
  const employer = makeHero("Balas");
  const hireling = makeHero("Dolf");
  employer.system.henchmenList = [hireling.id];

  assert.equal(coinReach(employer, hireling).can, true, "the roster is the reach, tokens or none");
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

console.log(`\ntest-location-reach: OK (${passed} checks — identity, floors, whose token, the linked half, the coin gate, the scan)`);
