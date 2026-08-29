/**
 * Movement modes: which modifiers a thing meets, and in what order.
 *
 * Pure composition — no values here at all, printed or invented. What it pins
 * is the architecture: a vehicle is a march with gates, a vessel is its own
 * layer with no ground beneath it, and a flier meets the country below while
 * replacing exactly one weather.
 */
import assert from "node:assert/strict";
import { MOVEMENT_MODES, isMode, layerOf, composeMovement } from "../scripts/lib/movement-modes.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

const P = (key, factor, extra = {}) => ({ key, factor, ...extra });

ok("a part's layer is the head of its key", () => {
  assert.equal(layerOf("terrain.forest"), "terrain");
  assert.equal(layerOf("condition.muddy"), "condition");
  assert.equal(layerOf("aloft"), "aloft", "a bare key is its own layer");
  assert.equal(layerOf(undefined), "");
});

ok("the modes are structural and carry no factors", () => {
  assert.deepEqual(Object.keys(MOVEMENT_MODES), ["foot", "mounted", "vehicle", "flying", "vessel"]);
  for (const [name, spec] of Object.entries(MOVEMENT_MODES)) {
    assert.ok(Array.isArray(spec.layers) && spec.layers.length, name + " declares its layers");
    assert.equal("factor" in spec, false, name + " must not ship a factor");
  }
  assert.equal(isMode("vessel"), true);
  assert.equal(isMode("teleport"), false);
});

ok("an unknown mode composes nothing rather than guessing", () => {
  const r = composeMovement({ mode: "teleport", parts: [P("terrain.forest", 0.5)] });
  assert.equal(r.multiplier, null);
  assert.equal(r.unknownMode, true);
});

/* --- the march, and the vehicle as an ADJUSTMENT of it -------------------- */
ok("a foot march multiplies its layers in the rules' own order", () => {
  const r = composeMovement({
    mode: "foot",
    // Contributed out of order on purpose: the mode decides the order.
    parts: [P("pace.forced", 1.5), P("road.paved", 1.5), P("terrain.forest", 0.5)],
  });
  assert.deepEqual(r.parts.map((p) => p.key), ["terrain.forest", "road.paved", "pace.forced"],
    "road lands AFTER the terrain it passes through");
  assert.equal(r.multiplier, 0.5 * 1.5 * 1.5);
});

ok("a vehicle meets everything a walker meets, and adds gates", () => {
  const walker = composeMovement({ mode: "foot", parts: [P("terrain.forest", 0.5)] });
  const wagon = composeMovement({ mode: "vehicle", parts: [P("terrain.forest", 0.5)] });
  assert.equal(wagon.multiplier, walker.multiplier, "an adjustment, not a different stack");
  assert.deepEqual(MOVEMENT_MODES.vehicle.gates, ["wheels", "footing"]);
});

/* --- the vessel as an INDEPENDENT layer ----------------------------------- */
ok("a vessel refuses the ground entirely, and says which parts it dropped", () => {
  const r = composeMovement({
    mode: "vessel",
    parts: [P("wind.brisk", 1.5), P("terrain.forest", 0.5), P("road.paved", 1.5)],
  });
  assert.equal(r.multiplier, 1.5, "only the wind counted");
  assert.deepEqual(r.dropped.map((p) => p.key).sort(), ["road.paved", "terrain.forest"]);
  assert.ok(r.dropped.every((p) => p.why === "refused"), "dropped LOUDLY — handing a vessel terrain is a bug");
  assert.equal(MOVEMENT_MODES.vessel.independent, true);
});

/* --- the flier, which is neither ------------------------------------------ */
ok("a flier meets the country below it — RR prints terrain under Flight Speed", () => {
  const r = composeMovement({
    mode: "flying",
    parts: [P("terrain.forest", 0.5), P("aloft.share", 3)],
  });
  assert.equal(r.multiplier, 0.5 * 3, "the ground still counts");
  assert.deepEqual(r.parts.map((p) => p.key), ["terrain.forest", "aloft.share"]);
});

ok("a flier refuses roads — there is no road at altitude", () => {
  const r = composeMovement({ mode: "flying", parts: [P("road.paved", 1.5), P("aloft.share", 3)] });
  assert.equal(r.multiplier, 3);
  assert.equal(r.dropped[0].why, "refused");
});

ok("flight's wind REPLACES the generic one rather than doubling it", () => {
  const r = composeMovement({
    mode: "flying",
    parts: [
      P("condition.windy", 0.75),                        // what the ground feels
      P("aloft.windy", 0.25, { supplants: "condition.windy" }),     // what a flier feels
      P("aloft.share", 3),
    ],
  });
  // The generic wind is dropped, not multiplied in: wind treats a flier
  // differently, not twice.
  assert.equal(r.multiplier, 3 * 0.25);
  assert.equal(r.dropped.length, 1);
  assert.equal(r.dropped[0].why, "replaced");
});

ok("without a flight wind of its own, the ground's wind still applies", () => {
  const r = composeMovement({
    mode: "flying",
    parts: [P("condition.windy", 0.75), P("aloft.share", 3)],
  });
  assert.equal(r.multiplier, 0.75 * 3, "a replaced layer nobody supplied is not a hole");
  assert.equal(r.dropped.length, 0);
});

/* --- notes and gaps -------------------------------------------------------- */
ok("a note is carried for the readout but never multiplied", () => {
  const r = composeMovement({ mode: "foot", parts: [P("terrain.forest", 0.5), P("mudPaved", 1, { note: true })] });
  assert.equal(r.multiplier, 0.5);
  assert.ok(r.parts.some((p) => p.note), "the note survives into the readout");
});

ok("a missing-table marker propagates so the readout can say so", () => {
  const r = composeMovement({ mode: "foot", parts: [P("tablesMissing", 1, { missing: true })] });
  assert.equal(r.missing, true);
});

console.log("\ntest-movement-modes: all " + passed + " checks passed");
