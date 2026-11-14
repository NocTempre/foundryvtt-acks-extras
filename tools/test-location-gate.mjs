/**
 * The gate: a place carrying the gate role is the point of entry to the nearest
 * market above it.
 *
 * Fixtures are location actors in a parent chain, each reduced to an index node
 * by the lib's own `placeIndex`, and `fromUuidSync` answers for the documents.
 * Names and shapes are invented; what is proved is the walk: the nearest market
 * wins, the gate itself never counts, no market above is null, and a parent loop
 * ends.
 */
import assert from "node:assert/strict";

globalThis.acksExtras ??= {};

class Coll extends Map {
  get contents() { return [...this.values()]; }
  find(fn) { return this.contents.find(fn); }
  filter(fn) { return this.contents.filter(fn); }
  some(fn) { return this.contents.some(fn); }
  [Symbol.iterator]() { return this.values(); }
}

const actors = new Coll();
const byUuid = new Map();

globalThis.foundry = { utils: { deepClone: (v) => (v == null || typeof v !== "object" ? v : structuredClone(v)) } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
globalThis.CONFIG = {};
globalThis.Hooks = { on() {}, once() {}, call() {}, callAll() {} };
globalThis.ui = { notifications: {} };
globalThis.canvas = {};
globalThis.fromUuidSync = (uuid) => byUuid.get(uuid) ?? null;
globalThis.game = { actors, scenes: new Coll(), user: { isGM: false, id: "u1" }, users: new Coll(), i18n: { localize: (k) => k, format: (k) => k } };

const { gateMarketOf, gatesByMarket, isGate, GATE_ROLE } = await import("../scripts/location/gate.mjs");
const { placeIndex } = await import("../scripts/lib/place.mjs");
const { LOCATION_TYPE } = await import("../scripts/location/constants.mjs");

let seq = 0;

/** A location actor. `parent` is another fixture; `market` and `role` set the fields the gate reads. */
function place(name, { parent = null, market = false, role = "" } = {}) {
  const aid = `p${++seq}`;
  const actor = {
    id: aid,
    uuid: `Actor.${aid}`,
    documentName: "Actor",
    type: LOCATION_TYPE,
    name,
    system: { parentUuid: parent?.uuid ?? "", hasMarket: market, role },
    getFlag: () => null,
  };
  actors.set(aid, actor);
  byUuid.set(actor.uuid, actor);
  return actor;
}

let passed = 0;
const ok = (name, fn) => {
  actors.clear();
  byUuid.clear();
  fn();
  passed++;
  console.log("ok   " + name);
};

ok("the nearest market above a gate is its point of entry", () => {
  const region = place("Region", { market: true });
  const city = place("City", { parent: region, market: true });
  const ward = place("Ward", { parent: city });
  const gate = place("Gate", { parent: ward, role: GATE_ROLE });

  assert.equal(gateMarketOf(gate, placeIndex()), city, "the city, not the farther region");
});

ok("a gate does not count as its own market", () => {
  const city = place("City", { market: true });
  const gate = place("Gate", { parent: city, role: GATE_ROLE, market: true });
  assert.equal(gateMarketOf(gate, placeIndex()), city, "the gate's own market is not the one it opens onto");

  const lone = place("Lone Gate", { role: GATE_ROLE, market: true });
  assert.equal(gateMarketOf(lone, placeIndex()), null, "its own market and nothing above it");
});

ok("a gate with no market above it opens onto none", () => {
  const field = place("Field");
  const gate = place("Gate", { parent: field, role: GATE_ROLE });
  assert.equal(gateMarketOf(gate, placeIndex()), null);
  assert.equal(gateMarketOf(place("Rootless", { role: GATE_ROLE }), placeIndex()), null);
  assert.equal(gateMarketOf(null, placeIndex()), null);
});

ok("a parent loop ends the walk", () => {
  const a = place("A");
  const b = place("B", { parent: a });
  a.system.parentUuid = b.uuid;
  const gate = place("Gate", { parent: a, role: GATE_ROLE });

  assert.equal(gateMarketOf(gate, placeIndex()), null, "terminates with no market in the loop");
  b.system.hasMarket = true;
  assert.equal(gateMarketOf(gate, placeIndex()), b, "and still finds one inside it");
});

ok("gatesByMarket files each gate under its own nearest market", () => {
  const city = place("City", { market: true });
  const town = place("Town", { parent: city, market: true });
  const g1 = place("North Gate", { parent: city, role: GATE_ROLE });
  const g2 = place("South Gate", { parent: city, role: GATE_ROLE });
  const g3 = place("Town Gate", { parent: town, role: GATE_ROLE });
  place("Orphan Gate", { role: GATE_ROLE });
  place("Gatehouse", { parent: city });

  const byMarket = gatesByMarket();
  assert.deepEqual(byMarket.get(city.uuid), [g1, g2]);
  assert.deepEqual(byMarket.get(town.uuid), [g3], "a gate in the town opens onto the town, not the city");
  assert.equal(byMarket.size, 2, "the orphan and the unmarked place file nowhere");
  assert.equal(gatesByMarket(placeIndex()).get(city.uuid).length, 2, "a caller's index gives the same answer");
});

ok("isGate reads the role on a location and nothing else", () => {
  const gate = place("Gate", { role: GATE_ROLE });
  assert.equal(isGate(gate), true);
  assert.equal(isGate(place("Plain")), false);
  assert.equal(isGate({ ...gate, type: "character" }), false);
  assert.equal(isGate(null), false);
});

console.log(`\ntest-location-gate: OK (${passed} checks — nearest market, self excluded, none, loop, the world map)`);
