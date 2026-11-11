/**
 * Whether a party is mapping (scripts/formation/mapper-logic.mjs, mapping.mjs,
 * lib/light.mjs `brightestLightAt`).
 *
 * The verdicts are pure and run over facts: light and proficiency as two
 * separate checks, several mappers, a mapper who cannot work, a fight and a
 * hurry. The world-reading half runs over invented parties on a 100-px square
 * grid, 5 ft a cell, with an invented light table, so it proves the
 * machinery: a torchbearer's place in the column against the mapper's, a
 * flame whose reach is not imported, a shuttered magic light, the day outside,
 * the switch that has the module assume light, a mapper who is dead, down, left
 * behind or standing on another scene, and one standing out on their own
 * token. Every figure is invented; none is read off a page. That the fog, the
 * measurement flag and the strip follow it live is the recipe's
 * (docs/formation/TESTING.md, "The mapper").
 */
import assert from "node:assert/strict";

globalThis.game = {
  actors: new Map(),
  scenes: new Map(),
  settings: { get: () => undefined },
  i18n: { localize: (k) => k, format: (k) => k, has: () => false },
};

const { LIT_BY, MAP_BLOCK, formationMapping, mapperLit, measureModeFor } = await import("../scripts/formation/mapper-logic.mjs");
const { MEASURE_MODES } = await import("../scripts/formation/measure-fuzz.mjs");
const { mappersOf, mappingOf } = await import("../scripts/formation/mapping.mjs");
const model = await import("../scripts/formation/formation-model.mjs");
const light = await import("../scripts/lib/light.mjs");
const tables = await import("../scripts/lib/tables.mjs");

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
  passed++;
  console.log("ok   " + name);
};

/* ------------------------------------------------------------------ */
/*  The verdicts                                                        */
/* ------------------------------------------------------------------ */

const lit = (extra = {}) => ({ working: true, lit: true, litBy: LIT_BY.LIGHT, proficient: false, ...extra });

await test("with the light requirement off the module assumes light and reads nothing else", () => {
  assert.deepEqual(mapperLit({ needsLight: false }), { lit: true, litBy: LIT_BY.ASSUMED });
  assert.deepEqual(mapperLit({ needsLight: false, ambient: false, reach: 0, unimportedFlame: false }), { lit: true, litBy: LIT_BY.ASSUMED });
});

await test("with it on, the day, a reaching light or a flame of unimported reach light a mapper, in that order; nothing leaves them dark", () => {
  assert.deepEqual(mapperLit({ needsLight: true, ambient: true, reach: 20 }), { lit: true, litBy: LIT_BY.AMBIENT });
  assert.deepEqual(mapperLit({ needsLight: true, reach: 20, unimportedFlame: true }), { lit: true, litBy: LIT_BY.LIGHT });
  assert.deepEqual(mapperLit({ needsLight: true, unimportedFlame: true }), { lit: true, litBy: LIT_BY.UNIMPORTED });
  assert.deepEqual(mapperLit({ needsLight: true }), { lit: false, litBy: null });
});

await test("a party with a working, lit mapper is mapping, and proficient only when that mapper is", () => {
  const plain = formationMapping([lit()]);
  assert.equal(plain.mapping, true);
  assert.equal(plain.proficient, false);
  assert.equal(plain.block, null);
  assert.equal(formationMapping([lit({ proficient: true })]).proficient, true);
});

await test("light and proficiency are two checks: no light is no mapping however skilled, no skill is vague mapping", () => {
  const dark = formationMapping([{ working: true, lit: false, litBy: null, proficient: true }]);
  assert.equal(dark.mapping, false);
  assert.equal(dark.proficient, false);
  assert.equal(dark.block, MAP_BLOCK.DARK);
  const vague = formationMapping([lit({ proficient: false })]);
  assert.equal(vague.mapping, true);
  assert.equal(vague.proficient, false);
});

await test("a mapper who cannot work maps nothing, lit or not", () => {
  const down = formationMapping([{ working: false, lit: true, litBy: LIT_BY.AMBIENT, proficient: true }]);
  assert.equal(down.mapping, false);
  assert.equal(down.block, MAP_BLOCK.DOWN);
  assert.equal(down.mappers[0].maps, false);
});

await test("with several mappers one who works and is lit carries it; a proficient mapper in the dark does not make the record", () => {
  const rows = [
    { working: true, lit: false, litBy: null, proficient: true },
    lit({ proficient: false }),
  ];
  const v = formationMapping(rows);
  assert.equal(v.mapping, true);
  assert.equal(v.proficient, false, "the lit mapper is the one drawing, and is not proficient");
  assert.equal(formationMapping([...rows, lit({ proficient: true })]).proficient, true);
  assert.deepEqual([v.working, v.lit], [2, 1]);
  assert.deepEqual(v.mappers.map((m) => m.maps), [false, true]);
});

await test("a party with no mapper is not mapping; a fight and a hurry each pause it", () => {
  assert.equal(formationMapping([]).block, MAP_BLOCK.NONE);
  assert.equal(formationMapping([lit()], { combat: true }).block, MAP_BLOCK.COMBAT);
  assert.equal(formationMapping([lit()], { hurried: true }).block, MAP_BLOCK.HURRIED);
  assert.equal(formationMapping([lit()], { combat: true }).mapping, false);
});

await test("the scene reads exact with a proficient mapping mapper, vague with another, unknown with none, exact in a fight", () => {
  const exact = formationMapping([lit({ proficient: true })]);
  const vague = formationMapping([lit()]);
  const none = formationMapping([]);
  assert.equal(measureModeFor([exact]), MEASURE_MODES.OFF);
  assert.equal(measureModeFor([vague]), MEASURE_MODES.FUZZY);
  assert.equal(measureModeFor([none]), MEASURE_MODES.UNKNOWN);
  assert.equal(measureModeFor([]), MEASURE_MODES.UNKNOWN);
  assert.equal(measureModeFor([none], { combat: true }), MEASURE_MODES.OFF);
  assert.equal(measureModeFor([vague, exact]), MEASURE_MODES.OFF, "one proficient party on the scene reads it exact");
  assert.equal(measureModeFor([none, vague]), MEASURE_MODES.FUZZY);
});

/* ------------------------------------------------------------------ */
/*  The light reader                                                    */
/* ------------------------------------------------------------------ */

/** A map's tokens: a Map that iterates its documents, as core's collection does. */
class Tokens extends Map {
  [Symbol.iterator]() {
    return this.values();
  }
}

const GS = 100;
const sceneOf = (id, { darkness = 1, lights = [], units = "ft", distance = 5 } = {}) => {
  const scene = {
    id,
    grid: { type: 1, size: GS, distance, units },
    environment: { darknessLevel: darkness },
    lights,
    tokens: new Tokens(),
    walls: [],
    getFlag: () => undefined,
  };
  game.scenes.set(id, scene);
  return scene;
};
const at = (cx, cy) => ({ x: cx * GS + GS / 2, y: cy * GS + GS / 2 });

await test("a light reaches a point inside its bright radius and not beyond it, in the scene's units", () => {
  const scene = sceneOf("s.reader", { lights: [{ x: 50, y: 50, hidden: false, config: { bright: 20 } }] });
  assert.equal(light.brightestLightAt(scene, { x: 50, y: 50 }), 20);
  assert.equal(light.brightestLightAt(scene, at(0, 5)), 0, "five cells on is twenty-five feet, past twenty");
  assert.equal(light.brightestLightAt(scene, { x: 50 + 4 * GS, y: 50 }), 20, "four cells of five feet is on the edge");
});

await test("a darkness source and a hidden light shed nothing; a light outside its activation range does not shine", () => {
  const scene = sceneOf("s.dark", {
    darkness: 0.9,
    lights: [
      { x: 50, y: 50, config: { bright: 20, negative: true } },
      { x: 50, y: 50, hidden: true, config: { bright: 20 } },
      { x: 50, y: 50, config: { bright: 20, darkness: { min: 0, max: 0.5 } } },
    ],
  });
  assert.equal(light.brightestLightAt(scene, { x: 50, y: 50 }), 0);
  scene.environment.darknessLevel = 0.3;
  assert.equal(light.brightestLightAt(scene, { x: 50, y: 50 }), 20, "inside the range it shines");
});

await test("a token's own light counts, and so does a point the caller holds that no document stores", () => {
  const scene = sceneOf("s.token");
  scene.tokens.set("t", { id: "t", x: 0, y: 0, width: 1, height: 1, hidden: false, light: { bright: 15 } });
  assert.equal(light.brightestLightAt(scene, at(0, 0)), 15);
  assert.equal(light.brightestLightAt(scene, at(5, 5)), 0);
  assert.equal(light.brightestLightAt(scene, at(5, 5), { extra: [{ ...at(5, 4), bright: 10 }] }), 10);
});

await test("no scene or no point reads as dark", () => {
  assert.equal(light.brightestLightAt(null, { x: 0, y: 0 }), 0);
  assert.equal(light.brightestLightAt(sceneOf("s.none"), {}), 0);
});

/* ------------------------------------------------------------------ */
/*  The world-reading half                                              */
/* ------------------------------------------------------------------ */

// An invented light table: a torch that reaches 25 ft. The mapper's cell is
// the head of the column; a torchbearer five cells back is 25 ft away.
tables.registerTable({ id: light.LIGHT_DOC, tables: { [light.LIGHT_TABLE]: { torch: { bright: 25, dim: 55, turns: 6 } } } }, { priority: tables.PRIORITY.WORLD, source: "test" });

const actorOf = (id, { name = id, hp = 8, dead = false, proficient = false, effects = [] } = {}) => {
  const actor = {
    id,
    name,
    type: "character",
    system: { hp: { value: hp, max: 8 } },
    items: proficient ? [{ type: "ability", name: "Mapping" }] : [],
    effects,
    appliedEffects: effects,
    statuses: new Set(dead ? ["dead"] : []),
    getFlag: () => undefined,
  };
  game.actors.set(id, actor);
  return actor;
};

/** A formation of `members` in a single file, the first at the party token's cell. */
const partyOn = (scene, members, { lights = [], combat = null, stance = null, travel = null } = {}) => {
  const token = { id: "pt", x: 5 * GS, y: 5 * GS, width: 1, height: 1, rotation: 0, parent: scene, getFlag: () => undefined };
  token._source = token;
  scene.tokens.set("pt", token);
  return { id: "f1", sceneId: scene.id, tokenId: "pt", frontage: 1, members, lights, combat, stance, travel, clock: {} };
};
const rank = (n) => Array.from({ length: n }, (_, i) => ({ actorId: `filler${i}`, roles: [] }));
for (let i = 0; i < 8; i++) actorOf(`filler${i}`);
const torch = (bearerId, over = {}) => ({ id: `l.${bearerId}`, type: "torch", bearerId, lit: true, shielded: false, ...over });

/** Mapper first, `gap` fillers, then the torchbearer; so the torch stands `gap + 1` cells behind. */
const withTorchAt = (gap, scene, mapperOver = {}, lightOver = {}, formationOver = {}) => {
  const mapper = actorOf("mapper", { name: "Scribe", ...mapperOver });
  const bearer = actorOf("bearer", { name: "Lamplighter" });
  const members = [{ actorId: mapper.id, roles: ["mapper"] }, ...rank(gap), { actorId: bearer.id, roles: [] }];
  return partyOn(scene, members, { lights: [torch(bearer.id, lightOver)], ...formationOver });
};
const verdictOf = (formation, opts) => mappersOf(formation, { needsLight: true, ...opts })[0];

await test("a torchbearer within the torch's bright reach lights the mapper; one beyond it does not", () => {
  const scene = sceneOf("s.col");
  assert.deepEqual(
    (({ working, lit: l, litBy }) => ({ working, lit: l, litBy }))(verdictOf(withTorchAt(3, scene))),
    { working: true, lit: true, litBy: LIT_BY.LIGHT },
    "four cells is twenty feet",
  );
  const far = verdictOf(withTorchAt(5, scene));
  assert.equal(far.lit, false, "six cells is thirty feet, past twenty-five");
  assert.equal(far.litBy, null);
});

await test("a doused or shuttered flame lights no one", () => {
  const scene = sceneOf("s.out");
  assert.equal(verdictOf(withTorchAt(1, scene, {}, { lit: false })).lit, false);
  assert.equal(verdictOf(withTorchAt(1, scene, {}, { shielded: true })).lit, false);
});

await test("the day outside lights a mapper with no flame at all, and a dark scene does not", () => {
  const dayScene = sceneOf("s.day", { darkness: 0.2 });
  const day = verdictOf(withTorchAt(5, dayScene));
  assert.deepEqual([day.lit, day.litBy], [true, LIT_BY.AMBIENT]);
  const night = verdictOf(withTorchAt(5, sceneOf("s.night", { darkness: 0.9 })));
  assert.equal(night.lit, false);
});

await test("a journey reads the day from its clock, not the scene's darkness", () => {
  const scene = sceneOf("s.journey", { darkness: 0.9 });
  const night = withTorchAt(5, scene, {}, {}, { travel: { mode: "journey", hour: "night" } });
  assert.equal(verdictOf(night).lit, false, "a journey at night with the torch out of reach");
  const day = withTorchAt(5, scene, {}, {}, { travel: { mode: "journey", hour: "day" } });
  assert.equal(verdictOf(day).litBy, LIT_BY.AMBIENT, "a journey by day on a dark scene");
});

await test("with no light figures imported, a lit open flame counts as lighting the mapper and says it is unimported", () => {
  const scene = sceneOf("s.unimported");
  tables.unregisterTable(light.LIGHT_DOC);
  try {
    const row = verdictOf(withTorchAt(7, scene));
    assert.deepEqual([row.lit, row.litBy], [true, LIT_BY.UNIMPORTED]);
    assert.equal(verdictOf(withTorchAt(1, scene, {}, { shielded: true })).lit, false, "a shuttered flame is still dark");
  } finally {
    tables.registerTable({ id: light.LIGHT_DOC, tables: { [light.LIGHT_TABLE]: { torch: { bright: 25, dim: 55, turns: 6 } } } }, { priority: tables.PRIORITY.WORLD, source: "test" });
  }
});

await test("with the light requirement off the module assumes light and never reads one", () => {
  const scene = sceneOf("s.assumed");
  const row = mappersOf(withTorchAt(7, scene), { needsLight: false })[0];
  assert.deepEqual([row.lit, row.litBy], [true, LIT_BY.ASSUMED]);
});

/** A magic light on the bearer: an effect writing the radius key, shuttered by a flag. */
const magicOn = (shuttered = false) => ({
  id: "fx",
  name: "Glow",
  disabled: false,
  isSuppressed: false,
  changes: [{ key: light.MAGIC_LIGHT_CHANGE_KEYS.bright, value: "20" }],
  parent: { documentName: "Actor" },
  getFlag: (_module, key) => (key === light.LIGHT_SHUTTER_FLAG && shuttered ? true : undefined),
});

await test("a bearer's magic light lights the mapper within its reach; shuttered, it does not", () => {
  const scene = sceneOf("s.magic");
  const make = (shuttered) => {
    actorOf("bearer2", { name: "Glowbearer", effects: [magicOn(shuttered)] });
    const mapper = actorOf("mapper", { name: "Scribe" });
    return partyOn(scene, [{ actorId: mapper.id, roles: ["mapper"] }, ...rank(2), { actorId: "bearer2", roles: [] }]);
  };
  assert.equal(verdictOf(make(false)).litBy, LIT_BY.LIGHT);
  assert.equal(verdictOf(make(true)).lit, false);
});

await test("a mapper who is dead, down, left behind, or standing on another scene does not work", () => {
  const scene = sceneOf("s.work");
  assert.equal(verdictOf(withTorchAt(1, scene, { dead: true })).working, false, "dead");
  assert.equal(verdictOf(withTorchAt(1, scene, { hp: 0 })).working, false, "down");
  const left = withTorchAt(1, scene);
  left.members[0].left = true;
  assert.equal(verdictOf(left).working, false, "left behind");
  const away = withTorchAt(1, scene);
  const other = sceneOf("s.elsewhere");
  const token = { id: "own", x: 0, y: 0, width: 1, height: 1, parent: other, actorLink: true, light: { bright: 0 } };
  other.tokens.set("own", token);
  Object.assign(away.members[0], { deployedTokenId: "own", deployedSceneId: other.id });
  assert.equal(verdictOf(away).working, false, "standing on another scene");
  assert.equal(verdictOf(withTorchAt(1, scene)).working, true, "and the same party with the mapper well works");
});

await test("a mapper standing out on their own token is lit by what reaches that token", () => {
  const scene = sceneOf("s.out-token");
  const formation = withTorchAt(9, scene);
  const token = { id: "own2", x: 20 * GS, y: 20 * GS, width: 1, height: 1, parent: scene, actorLink: true, light: { bright: 0 }, hidden: false };
  scene.tokens.set("own2", token);
  Object.assign(formation.members[0], { deployedTokenId: "own2", deployedSceneId: scene.id });
  assert.equal(verdictOf(formation).lit, false, "far from the column's torch and carrying none");
  scene.lights.push({ x: 20 * GS + 50, y: 20 * GS + 50, hidden: false, config: { bright: 10 } });
  assert.equal(verdictOf(formation).litBy, LIT_BY.LIGHT, "a scene light beside them");
});

await test("a proficient mapper is read off the actor, and several mappers give one verdict", () => {
  const scene = sceneOf("s.two", { darkness: 0.1 });
  actorOf("m1", { name: "First" });
  actorOf("m2", { name: "Second", proficient: true });
  const formation = partyOn(scene, [{ actorId: "m1", roles: ["mapper"] }, { actorId: "m2", roles: ["mapper"] }]);
  const rows = mappersOf(formation, { needsLight: true });
  assert.deepEqual(rows.map((r) => [r.name, r.proficient]), [["First", false], ["Second", true]]);
  const verdict = mappingOf(formation, { needsLight: true });
  assert.equal(verdict.mapping, true);
  assert.equal(verdict.proficient, true);
  assert.equal(model.mapperIsProficient(formation), true);
  assert.equal(model.getMapperActor(formation).id, "m1", "the first who can work holds a new map");
});

await test("the actor a new map goes to is a mapper who can work, never a dead first one", () => {
  const scene = sceneOf("s.hold", { darkness: 0.1 });
  actorOf("m3", { name: "Fallen", dead: true });
  actorOf("m4", { name: "Standing" });
  const formation = partyOn(scene, [{ actorId: "m3", roles: ["mapper"] }, { actorId: "m4", roles: ["mapper"] }]);
  assert.equal(model.getMapperActor(formation).id, "m4");
  assert.equal(model.mapperIsProficient({ ...formation, members: [formation.members[0]] }), false);
});

await test("a fight or a hurried pace pauses the party's mapping whatever the light", () => {
  const scene = sceneOf("s.pause", { darkness: 0.1 });
  const calm = withTorchAt(1, scene);
  assert.equal(mappingOf(calm, { needsLight: true }).mapping, true);
  assert.equal(mappingOf({ ...calm, combat: { active: true } }, { needsLight: true }).block, MAP_BLOCK.COMBAT);
  assert.equal(mappingOf({ ...calm, stance: { pace: "hurried" } }, { needsLight: true }).block, MAP_BLOCK.HURRIED);
});

await test("the scene's darkness read is shared: a scene is dark at half and above, and no scene is not dark", () => {
  assert.equal(model.sceneIsDark(sceneOf("s.half", { darkness: 0.5 })), true);
  assert.equal(model.sceneIsDark(sceneOf("s.quarter", { darkness: 0.49 })), false);
  assert.equal(model.sceneIsDark(null), false);
});

console.log(`\n${passed} passed`);
