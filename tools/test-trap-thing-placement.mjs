/**
 * Trap things as formation's third placement source. Foundry's globals are
 * stand-ins; the places, regions and the party token are invented, and no
 * figure here is a printed one.
 *
 * What this pins: `patchThing` changes one thing by id, replaces a ledger whole
 * and keeps every key it does not name; `thingPlacement` reads state (armed
 * when absent or unknown), known (the opposite of hidden) and both ledgers off
 * the thing, and writes them back through the list as the place holds it at the
 * write, so a stale snapshot overwrites only what it names and a thing added in
 * between survives; a write from a player seat or for a removed thing writes
 * nothing; `livePlacements` adds the armed trap things of the places under the
 * party after the zones, each place once, and none of them halts; `allPlacements`
 * lists every trap thing of each place linked to a Region of the scene, each place
 * once; a thing's distance is measured through its Region; the hasty-search
 * ledger reads locked at a level failed at and below it, writes through a
 * placement's own `write` and keeps the highest level, writes nothing for no
 * placement or actor, and `sweepForTraps` skips a locked searcher and records
 * its own failures in the same ledger.
 *
 * Run: node tools/test-trap-thing-placement.mjs
 */
import assert from "node:assert/strict";
import { mockRegion, rect, standOnRegions } from "./region-fixture.mjs";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

/* --- stand-ins -------------------------------------------------------------- */
class Stub {}
globalThis.foundry = {
  abstract: { DataModel: class {}, TypeDataModel: class { static defineSchema() { return {}; } } },
  data: {
    regionBehaviors: { RegionBehaviorType: class { static defineSchema() { return {}; } } },
    fields: new Proxy({}, { get: () => class { constructor(options = {}) { this.options = options; } } }),
    operators: { ForcedReplacement: { create: (value) => value }, ForcedDeletion: class {} },
  },
  utils: { deepClone: (v) => JSON.parse(JSON.stringify(v)), randomID: () => "id" },
  applications: { api: { ApplicationV2: Stub, HandlebarsApplicationMixin: (B) => B, DialogV2: Stub }, sheets: { ItemSheetV2: Stub }, handlebars: {} },
};
globalThis.game = { i18n: { localize: (key) => key, format: (key) => key, has: () => true }, user: { isGM: true }, scenes: new Map() };
globalThis.CONFIG = { RegionBehavior: { dataModels: {}, typeIcons: {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };

const { patchThing } = await import("../scripts/lib/place-things-logic.mjs");
const { thingsOf, updateThingOn } = await import("../scripts/lib/place-things.mjs");
const { thingPlacement, livePlacements, allPlacements, placementsNear, placementNearByUuid, hastySearchLocked, recordHastySearchFailure, sweepForTraps } = await import("../scripts/formation/trap-zone.mjs");
const { STATES, stackStops, walkTrapStack } = await import("../scripts/formation/trap-rules.mjs");

/* --- fixtures --------------------------------------------------------------- */
/** A trap thing in the stored shape. */
const trapThing = (id, over = {}) => ({ id, kind: "trap", ref: "Item.trap", hidden: false, params: {}, state: {}, ...over });

/** A place that holds its things flag in memory and records each update it is handed. */
function makePlace(uuid, things = []) {
  const flags = { things };
  const place = {
    uuid,
    name: uuid,
    updates: [],
    getFlag: (scope, key) => (scope === "acks-extras" ? flags[key] : undefined),
    async update(data) {
      place.updates.push(data);
      for (const [path, value] of Object.entries(data)) flags[/^flags\.acks-extras\.(.+)$/.exec(path)[1]] = value;
    },
  };
  return place;
}

/** A scene with a party token on it, and the location feature's region lookup over `links`. */
function makeWorld({ regions, links, token = { x: 0, y: 0, width: 1, height: 1 } }) {
  const scene = {
    id: "S1",
    grid: { size: 100, distance: 5, units: "ft" },
    regions,
    walls: [],
    tokens: { get: (id) => (id === "T1" ? scene.token : undefined) },
  };
  scene.token = standOnRegions({ id: "T1", parent: scene, ...token });
  game.scenes.set("S1", scene);
  globalThis.acksExtras = { location: { scenes: { locationOfRegion: (region) => links.get(region) ?? null } } };
  return { scene, formation: { id: "F", sceneId: "S1", tokenId: "T1" } };
}

const trapZoneBehavior = (uuid) => ({ type: "acks-extras.trapZone", disabled: false, uuid, system: { state: "armed", known: false, trapUuid: "Item.zone", repeatLock: {}, searchLock: {} } });

/* --- the pure patch --------------------------------------------------------- */
await ok("patchThing changes one thing by id and leaves the rest", () => {
  const list = [trapThing("thing-1", { hidden: true }), trapThing("thing-2", { state: { state: "armed", repeatLock: { a: 1 } } })];
  const next = patchThing(list, "thing-2", { hidden: false, state: { state: "found" } });
  assert.equal(next[0].hidden, true);
  assert.equal(next[1].hidden, false);
  assert.deepEqual(next[1].state, { state: "found", repeatLock: { a: 1 } }, "a key the patch does not name stays");
  assert.deepEqual(list[1].state, { state: "armed", repeatLock: { a: 1 } }, "the input is untouched");
});

await ok("patchThing replaces a named ledger whole, so {} empties it", () => {
  const next = patchThing([trapThing("thing-1", { state: { repeatLock: { a: 1, b: 2 } } })], "thing-1", { state: { repeatLock: {} } });
  assert.deepEqual(next[0].state.repeatLock, {});
});

await ok("patchThing writes only hidden and state, skips undefined and a non-boolean hidden, and ignores an absent id", () => {
  const list = [trapThing("thing-1", { hidden: true, params: { p: 1 } })];
  const next = patchThing(list, "thing-1", { hidden: "no", params: { p: 9 }, ref: "x", state: { state: undefined, searchLock: { a: 2 } } });
  assert.equal(next[0].hidden, true);
  assert.deepEqual(next[0].params, { p: 1 });
  assert.equal(next[0].ref, "Item.trap");
  assert.deepEqual(next[0].state, { searchLock: { a: 2 } });
  assert.deepEqual(patchThing(list, "thing-9", { hidden: false }).map((t) => t.hidden), [true]);
});

/* --- the placement's read mapping ------------------------------------------- */
await ok("thingPlacement reads state, known and both ledgers off the thing", () => {
  const place = makePlace("Actor.P1");
  const region = { id: "r" };
  const thing = trapThing("thing-3", { hidden: true, ref: "Item.abc", state: { state: "disarmed", repeatLock: { a: 1 }, searchLock: { b: 2 } } });
  const p = thingPlacement(place, thing, region);
  assert.equal(p.kind, "thing");
  assert.equal(p.doc, place);
  assert.equal(p.region, region);
  assert.equal(p.uuid, "Actor.P1::thing-3", "the place's uuid, then the thing's id, in a form fromUuid cannot walk");
  assert.equal(p.trapUuid, "Item.abc");
  assert.equal(p.state, "disarmed");
  assert.equal(p.known, false, "hidden is not known");
  assert.deepEqual(p.repeatLock, { a: 1 });
  assert.deepEqual(p.searchLock, { b: 2 });
  assert.equal(thingPlacement(place, trapThing("thing-3"), region).known, true, "not hidden is known");
});

await ok("a thing with no state, an unknown state or no ref reads armed and blank", () => {
  const place = makePlace("Actor.P1");
  for (const state of [{}, { state: "bogus" }, { state: 4 }]) {
    const p = thingPlacement(place, trapThing("thing-1", { ref: null, state }), null);
    assert.equal(p.state, STATES.armed);
    assert.equal(p.trapUuid, "");
    assert.deepEqual([p.repeatLock, p.searchLock], [{}, {}]);
  }
});

/* --- the placement's write mapping ------------------------------------------ */
await ok("write maps state and both ledgers into thing.state and known to the opposite of hidden", async () => {
  const place = makePlace("Actor.P1", [trapThing("thing-1", { hidden: true }), trapThing("thing-2")]);
  const p = thingPlacement(place, thingsOf(place)[0], null);
  await p.write({ state: STATES.found, known: true, searchLock: { a: 3 }, repeatLock: { b: 4 } });
  const [one, two] = thingsOf(place);
  assert.equal(one.hidden, false, "known: true shows it");
  assert.deepEqual(one.state, { state: "found", searchLock: { a: 3 }, repeatLock: { b: 4 } });
  assert.equal(two.hidden, false);
  assert.deepEqual(two.state, {}, "another thing is untouched");
  await p.write({ known: false });
  assert.equal(thingsOf(place)[0].hidden, true, "known: false hides it again");
  assert.equal(thingsOf(place)[0].state.state, "found", "a write naming only known leaves the state");
  await p.write({ repeatLock: {}, searchLock: {} });
  assert.deepEqual([thingsOf(place)[0].state.repeatLock, thingsOf(place)[0].state.searchLock], [{}, {}]);
});

await ok("write ignores a key the placement does not carry", async () => {
  const place = makePlace("Actor.P1", [trapThing("thing-1")]);
  await thingPlacement(place, thingsOf(place)[0], null).write({ trapUuid: "Item.other", doc: 1 });
  assert.deepEqual(thingsOf(place)[0].state, {});
  assert.equal(thingsOf(place)[0].ref, "Item.trap");
});

await ok("two writes from one older snapshot each change only what they name, and a thing added between survives", async () => {
  const place = makePlace("Actor.P1", [trapThing("thing-1")]);
  const snapshot = thingPlacement(place, thingsOf(place)[0], null);
  await snapshot.write({ state: STATES.found, known: true, searchLock: { a: 1 } });
  await place.update({ "flags.acks-extras.things": [...thingsOf(place), trapThing("thing-2")] });
  await snapshot.write({ state: STATES.discharged, known: true });
  const [one, two] = thingsOf(place);
  assert.deepEqual(one.state, { state: "discharged", searchLock: { a: 1 } }, "the earlier searchLock was not rolled back");
  assert.equal(two.id, "thing-2", "the thing added in between is still there");
});

await ok("a write for a removed thing, from a player seat or for a missing place writes nothing", async () => {
  const place = makePlace("Actor.P1", [trapThing("thing-1")]);
  const p = thingPlacement(place, thingsOf(place)[0], null);
  await place.update({ "flags.acks-extras.things": [] });
  place.updates.length = 0;
  assert.equal(await p.write({ state: STATES.found }), null);
  assert.equal(place.updates.length, 0);

  const held = makePlace("Actor.P2", [trapThing("thing-1")]);
  game.user.isGM = false;
  try {
    assert.equal(await updateThingOn(held, "thing-1", { hidden: false }), null);
  } finally {
    game.user.isGM = true;
  }
  assert.equal(held.updates.length, 0);
  assert.equal(await updateThingOn(null, "thing-1", {}), null);
});

/* --- live placements -------------------------------------------------------- */
await ok("livePlacements adds the armed trap things of the places under the party after the zones, each place once", async () => {
  const p1 = makePlace("Actor.P1", [
    trapThing("thing-1"),
    trapThing("thing-2", { state: { state: "discharged" } }),
    trapThing("thing-3", { hidden: true }),
    { id: "thing-4", kind: "obstacle", ref: "Item.hazard", hidden: false, params: {}, state: {} },
  ]);
  const p2 = makePlace("Actor.P2", [trapThing("thing-1")]);
  const regionA = mockRegion({ id: "a", rings: [rect(0, 0, 100, 100)], behaviors: [trapZoneBehavior("zone.a")] });
  const regionA2 = mockRegion({ id: "a2", rings: [rect(0, 0, 100, 100)] });
  const regionB = mockRegion({ id: "b", rings: [rect(0, 0, 100, 100)] });
  const regionFar = mockRegion({ id: "far", rings: [rect(900, 0, 100, 100)] });
  const p3 = makePlace("Actor.P3", [trapThing("thing-1")]);
  const links = new Map([[regionA, p1], [regionA2, p1], [regionB, p2], [regionFar, p3]]);
  const { formation } = makeWorld({ regions: [regionA, regionA2, regionB, regionFar], links });

  const stack = await livePlacements(formation);
  assert.deepEqual(
    stack.map((entry) => entry.placement.uuid),
    ["zone.a", "Actor.P1::thing-1", "Actor.P1::thing-3", "Actor.P2::thing-1"],
    "zones first; a place counts once; a discharged thing, a non-trap thing and a place the party is not in are left out; a hidden armed thing fires",
  );
  assert.deepEqual(stack.map((entry) => entry.placement.kind), ["zone", "thing", "thing", "thing"]);
  assert.deepEqual(stack.map((entry) => [entry.haltAt, entry.approach]), Array(4).fill([null, null]), "nothing here halts");
  assert.equal(stack[1].placement.region, regionA, "a place is reached through the first Region the party stands in");
});

await ok("a party in no place with things yields no thing placements, and a missing location feature no error", async () => {
  const region = mockRegion({ id: "far", rings: [rect(900, 0, 100, 100)] });
  const { formation } = makeWorld({ regions: [region], links: new Map([[region, makePlace("Actor.P1", [trapThing("thing-1")])]]) });
  assert.deepEqual(await livePlacements(formation), []);
  const inside = mockRegion({ id: "in", rings: [rect(0, 0, 100, 100)] });
  makeWorld({ regions: [inside], links: new Map() });
  assert.deepEqual(await livePlacements(formation), [], "an unlinked region holds no things");
  globalThis.acksExtras = {};
  assert.deepEqual(await livePlacements(formation), []);
});

await ok("a thing never halts: a found or sprung thing lets the stack walk on, where a wall stops it", async () => {
  const place = makePlace("Actor.P1", [trapThing("thing-1"), trapThing("thing-2")]);
  const region = mockRegion({ id: "a", rings: [rect(0, 0, 100, 100)] });
  const { formation } = makeWorld({ regions: [region], links: new Map([[region, place]]) });
  const stack = await livePlacements(formation);
  const met = [];
  const results = await walkTrapStack(stack, async ({ placement }) => {
    met.push(placement.uuid);
    return { outcome: placement.uuid.endsWith("thing-1") ? "sprung" : "found", placement: { kind: placement.kind } };
  });
  assert.deepEqual(met, ["Actor.P1::thing-1", "Actor.P1::thing-2"]);
  assert.equal(results.length, 2);
  assert.equal(stackStops({ outcome: "sprung" }, stack[0].placement), false);
  assert.equal(stackStops({ outcome: "found" }, stack[1].placement), false);
  assert.equal(stackStops({ outcome: "sprung" }, { kind: "wall" }), true, "a wall still stops");
});

/* --- everything on the scene, and reach ------------------------------------- */
await ok("allPlacements lists every trap thing of each linked place once, whatever its state", async () => {
  const p1 = makePlace("Actor.P1", [trapThing("thing-1"), trapThing("thing-2", { state: { state: "discharged" }, hidden: true })]);
  const p2 = makePlace("Actor.P2", [trapThing("thing-1")]);
  const regionA = mockRegion({ id: "a", rings: [rect(0, 0, 100, 100)], behaviors: [trapZoneBehavior("zone.a")] });
  const regionA2 = mockRegion({ id: "a2", rings: [rect(0, 0, 100, 100)] });
  const regionB = mockRegion({ id: "b", rings: [rect(500, 0, 100, 100)] });
  const bare = mockRegion({ id: "bare", rings: [rect(0, 0, 10, 10)] });
  const { scene } = makeWorld({ regions: [regionA, regionA2, regionB, bare], links: new Map([[regionA, p1], [regionA2, p1], [regionB, p2]]) });
  const all = allPlacements(scene);
  assert.deepEqual(all.map((p) => p.uuid), ["zone.a", "Actor.P1::thing-1", "Actor.P1::thing-2", "Actor.P2::thing-1"]);
  assert.deepEqual(all.filter((p) => p.kind === "thing").map((p) => [p.state, p.known]), [["armed", true], ["discharged", false], ["armed", true]]);
  assert.equal(allPlacements(null).length, 0);
});

await ok("a thing's distance is measured through its Region, and placementNearByUuid finds it", async () => {
  const near = makePlace("Actor.P1", [trapThing("thing-1")]);
  const far = makePlace("Actor.P2", [trapThing("thing-1")]);
  const regionA = mockRegion({ id: "a", rings: [rect(0, 0, 100, 100)] });
  const regionB = mockRegion({ id: "b", rings: [rect(500, 0, 100, 100)] });
  const { formation } = makeWorld({ regions: [regionA, regionB], links: new Map([[regionA, near], [regionB, far]]) });
  const within = placementsNear(formation, { feet: 25 });
  assert.deepEqual(within.map((p) => [p.uuid, Math.round(p.distanceFeet)]), [["Actor.P1::thing-1", 0], ["Actor.P2::thing-1", 20]], "400 px at 5 ft per 100 px, nearest first");
  assert.deepEqual(placementsNear(formation, { feet: 10 }).map((p) => p.uuid), ["Actor.P1::thing-1"]);
  assert.equal(placementNearByUuid(formation, "Actor.P2::thing-1", 25)?.region, regionB);
  assert.equal(placementNearByUuid(formation, "Actor.P2::thing-1", 10), null);
  assert.equal(typeof within[1].write, "function", "the spread keeps the write closure");
});

/* --- the hasty-search ledger ------------------------------------------------ */
await ok("hastySearchLocked is false until a failure is recorded, then true at that level and below, false above", async () => {
  const place = makePlace("Actor.P1", [trapThing("thing-1", { hidden: true })]);
  const before = thingPlacement(place, thingsOf(place)[0], null);
  assert.equal(hastySearchLocked(before, "a", 3), false, "nothing recorded");
  const ledger = await recordHastySearchFailure(before, "a", 3);
  assert.deepEqual(ledger, { a: 3 });
  const after = thingPlacement(place, thingsOf(place)[0], null);
  assert.equal(hastySearchLocked(after, "a", 3), true, "the same level");
  assert.equal(hastySearchLocked(after, "a", 2), true, "a lower level");
  assert.equal(hastySearchLocked(after, "a", 4), false, "a higher level reopens it");
  assert.equal(hastySearchLocked(after, "b", 3), false, "another character is not locked");
});

await ok("recordHastySearchFailure on a thing writes through to its state.searchLock, keeps the highest level and the other ledger", async () => {
  const place = makePlace("Actor.P1", [trapThing("thing-1", { state: { repeatLock: { r: 1 }, searchLock: { b: 2 } } })]);
  await recordHastySearchFailure(thingPlacement(place, thingsOf(place)[0], null), "a", 5);
  assert.deepEqual(thingsOf(place)[0].state.searchLock, { a: 5, b: 2 });
  assert.deepEqual(thingsOf(place)[0].state.repeatLock, { r: 1 });
  const again = await recordHastySearchFailure(thingPlacement(place, thingsOf(place)[0], null), "a", 2);
  assert.deepEqual(again, { a: 5, b: 2 }, "a lower level recorded later does not lower the ledger");
  assert.deepEqual(thingsOf(place)[0].state.searchLock, { a: 5, b: 2 });
});

await ok("recordHastySearchFailure writes through whichever write a placement carries, and never mutates the ledger it read", async () => {
  const writes = [];
  const placement = { searchLock: { a: 1 }, write: async (patch) => { writes.push(patch); } };
  const ledger = await recordHastySearchFailure(placement, "b", 2);
  assert.deepEqual(writes, [{ searchLock: { a: 1, b: 2 } }]);
  assert.deepEqual(ledger, { a: 1, b: 2 });
  assert.deepEqual(placement.searchLock, { a: 1 }, "the input ledger is not mutated");
});

await ok("a null placement or a missing actor id writes nothing: locked reads false, record returns null", async () => {
  const writes = [];
  const placement = { searchLock: { a: 3 }, write: async (patch) => { writes.push(patch); } };
  assert.equal(await recordHastySearchFailure(null, "a", 1), null);
  assert.equal(await recordHastySearchFailure(placement, undefined, 1), null);
  assert.equal(await recordHastySearchFailure(placement, "", 1), null);
  assert.deepEqual(writes, []);
  assert.equal(hastySearchLocked(null, "a", 1), false);
  assert.equal(hastySearchLocked(placement, undefined, 1), false);
});

/* --- the sweep over the ledger ---------------------------------------------- */
await ok("sweepForTraps skips a searcher the ledger locks, rolls again after a level, and writes a failure into the ledger the export reads", async () => {
  const dice = [];
  globalThis.Roll = class {
    constructor(formula) { this.formula = formula; }
    async evaluate() { this.total = dice.shift(); return this; }
  };
  globalThis.fromUuid = async () => null;
  game.actors = new Map();
  const skill = { id: "s1", type: "ability", name: "Probe Search", system: {}, flags: { "acks-extras": { extras: { provides: ["kw:searching"], effects: [], rolls: [{ key: "hasty", label: "hasty", formula: "1d20", rollType: "above", target: { kind: "flat", flat: 15 }, scale: "level" }] } } } };
  skill.getFlag = (scope, key) => skill.flags[scope]?.[key];
  const actor = { id: "Alder", name: "Alder", type: "character", statuses: new Set(), appliedEffects: [], system: { details: { level: 3 }, adventuring: {}, hp: { value: 8 }, saves: {} }, getFlag: () => undefined };
  skill.actor = actor;
  actor.items = Object.assign([skill], { get: (id) => (id === "s1" ? skill : undefined) });
  game.actors.set("Alder", actor);

  const place = makePlace("Actor.P1", [trapThing("thing-1", { hidden: true })]);
  const regionA = mockRegion({ id: "a", rings: [rect(0, 0, 100, 100)] });
  const { formation } = makeWorld({ regions: [regionA], links: new Map([[regionA, place]]) });
  formation.members = [{ actorId: "Alder", roles: [] }];
  const fresh = () => thingPlacement(place, thingsOf(place)[0], regionA);

  dice.push(1);
  const failed = await sweepForTraps(formation, { include: fresh() });
  assert.deepEqual([failed.rows.length, failed.found.size], [1, 0], "the searcher threw once and found nothing");
  assert.deepEqual(thingsOf(place)[0].state.searchLock, { Alder: 3 }, "the sweep wrote its failure to the ledger");
  assert.equal(hastySearchLocked(fresh(), "Alder", 3), true, "and the export reads it");

  dice.push(20);
  const skipped = await sweepForTraps(formation, { include: fresh() });
  assert.equal(skipped.rows.length, 0, "a locked searcher throws nothing");
  assert.equal(dice.length, 1, "no die was spent");
  assert.equal(skipped.found.size, 0);

  actor.system.details.level = 4;
  const reopened = await sweepForTraps(formation, { include: fresh() });
  assert.equal(reopened.rows.length, 1, "a level gained reopens the search");
  assert.equal(reopened.found.size, 1, "and a good throw spots it");
  assert.equal(thingsOf(place)[0].hidden, false, "the trap is known");
  assert.deepEqual(thingsOf(place)[0].state.searchLock, { Alder: 3 }, "a success records no failure");
});

console.log(`\n${passed} passed`);
