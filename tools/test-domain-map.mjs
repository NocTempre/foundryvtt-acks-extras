/**
 * Domains on the map: the country brush's domain layer and the Domains map
 * mode, as `scripts/domains/domain-map.mjs` registers them into battlemap's
 * registries, and the territory rows read off the map.
 *
 * What is pinned here. The layer offers the world's domains in realm order,
 * named and coloured as their realm places them, its regions on the Regions
 * control alone. A hex painted into a domain takes the domain's class as its
 * territory, and `source` names the layer, which the party sheet's Country
 * card has a label for; a domain with no class, or gone,
 * implies none. The mode draws each domain in its colour, a vassal under its
 * liege in the legend, a hex of a domain no longer in the world in one neutral
 * colour, and weighs each side by where the two realms part. A domain's
 * territory counts the hexes painted into it. A domain renamed, given another
 * liege or another class tells the map; any other change does not. Every
 * name and figure is invented.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* ------------------------- the world --------------------------------------- */
const hasProperty = (obj, path) => path.split(".").reduce((o, k) => (o !== null && typeof o === "object" && k in o ? o[k] : undefined), obj) !== undefined;
globalThis.foundry = { utils: { hasProperty } };
globalThis.CONST = {
  GRID_TYPES: { HEXODDR: 2, HEXEVENR: 3, HEXODDQ: 4, HEXEVENQ: 5 },
  REGION_VISIBILITY: { LAYER: 0, GAMEMASTER: 1, ALWAYS: 2 },
};
const hooks = new Map();
const told = [];
globalThis.Hooks = {
  on: (name, fn) => {
    if (!hooks.has(name)) hooks.set(name, []);
    hooks.get(name).push(fn);
    return hooks.get(name).length;
  },
  off: () => {},
  callAll: (...args) => told.push(args),
};

const DOMAIN_TYPE = "acks-extras.domain";
const domain = (id, name, { parentUuid = "", classification = "", territory = [] } = {}) => ({
  documentName: "Actor",
  type: DOMAIN_TYPE,
  id,
  uuid: `Actor.${id}`,
  name,
  system: { parentUuid, classification, territory, holdings: [] },
});
const d1 = domain("d1", "Domain 1", { classification: "civilized" });
const d2 = domain("d2", "Domain 2", { parentUuid: "Actor.d1", classification: "borderlands" });
const d3 = domain("d3", "Domain 3", { parentUuid: "Actor.d1" });
const d4 = domain("d4", "Domain 4", { parentUuid: "Actor.d3", classification: "outlands" });
const d5 = domain("d5", "Domain 5");
const place = { documentName: "Actor", type: "acks-extras.location", id: "p1", uuid: "Actor.p1", name: "Place 1", system: {} };
const actors = [d3, d1, d4, d2, d5, place];

let rid = 0;
const flags = {};
const scene = {
  id: "s1",
  uuid: "Scene.s1",
  name: "Scene 1",
  grid: {
    type: 2,
    size: 100,
    getOffset: (p) => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }),
    getVertices: ({ i, j }) => [
      { x: j * 100, y: i * 100 }, { x: j * 100 + 100, y: i * 100 },
      { x: j * 100 + 100, y: i * 100 + 100 }, { x: j * 100, y: i * 100 + 100 },
    ],
  },
  regions: [],
  walls: [],
  getFlag: (ns, key) => flags[ns]?.[key],
  async createEmbeddedDocuments(_name, data) {
    const made = data.map((d) => ({
      id: `r${++rid}`,
      name: d.name,
      color: d.color,
      visibility: d.visibility,
      shapes: [...d.shapes],
      flags: structuredClone(d.flags),
      getFlag(ns, key) { return this.flags[ns]?.[key]; },
      toObject() { return { shapes: [...this.shapes] }; },
      async update(patch) {
        for (const [path, value] of Object.entries(patch)) {
          if (path === "shapes") this.shapes = value;
          else this.flags[path.split(".")[1]][path.split(".")[2]] = value;
        }
      },
      async delete() { scene.regions.splice(scene.regions.indexOf(this), 1); },
    }));
    scene.regions.push(...made);
    return made;
  },
};
const square = { ...scene, id: "s2", uuid: "Scene.s2", grid: { ...scene.grid, type: 1 }, regions: [] };
globalThis.game = {
  actors,
  scenes: [scene, square],
  user: { isGM: true },
  i18n: {
    localize: (key) => key,
    format: (key, data = {}) => (Object.keys(data).length ? `${key}${JSON.stringify(data)}` : key),
  },
};
globalThis.fromUuidSync = (uuid) => actors.find((a) => a.uuid === uuid) ?? null;

const { MODULE_ID } = await import("../scripts/lib/constants.mjs");
const { hashedColor, lighten } = await import("../scripts/lib/color.mjs");
const {
  PAINT_LAYERS, PAINT_LAYER_CHANGED_HOOK, TERRITORY_COLORS, TerrainPaletteApp, layerColorFor, layerLabelFor, paintHexAt,
  paintableValues, terrainPaint,
} = await import("../scripts/battlemap/terrain-paint.mjs");
const { borderSegments, layerPlan, mapModes, modeForLayer, territoryPlan } = await import("../scripts/battlemap/map-modes.mjs");
const { countryAt } = await import("../scripts/battlemap/country.mjs");
const {
  DOMAIN_LAYER, ORPHAN_COLOR, domainLegend, domainWeights, hexCountFor, installDomainMap, paintedHexesOf, territoryOf,
} = await import("../scripts/domains/domain-map.mjs");

const centre = (i, j) => ({ x: j * 100 + 50, y: i * 100 + 50 });

/* ------------------------- the layer --------------------------------------- */
assert.equal(DOMAIN_LAYER, "domain");
assert.deepEqual({ ...PAINT_LAYERS.domain }, { flag: "domain", hexesFlag: "domainHexes" }, "the layer's two region flags");
assert.deepEqual(paintableValues("domain"), ["Actor.d1", "Actor.d2", "Actor.d3", "Actor.d4", "Actor.d5"],
  "every domain of the world in realm order, and no other actor");
assert.deepEqual([layerLabelFor("Actor.d2", "domain"), layerLabelFor("Actor.gone", "domain")], ["Domain 2", "ACKS-DOMAINS.map.unknownDomain"],
  "a value is named by its domain, or as a domain no longer in the world");
const d1Color = hashedColor("Actor.d1");
assert.equal(layerColorFor("Actor.d1", "domain"), d1Color, "a sovereign's colour is hashed from its uuid");
assert.equal(layerColorFor("Actor.d2", "domain"), lighten(d1Color, (1 / 3) * 0.5), "a vassal's is a shade of its liege's");
assert.equal(layerColorFor("Actor.gone", "domain"), ORPHAN_COLOR);

// The palette folds the swatches under each realm's sovereign, and titles the pill in this feature's words.
terrainPaint.setLayer("domain");
try {
  const ctx = await new TerrainPaletteApp()._prepareContext();
  assert.deepEqual(ctx.groups.map((g) => [g.label, g.swatches.map((s) => s.label)]), [
    ["Domain 1", ["Domain 1", "Domain 2", "Domain 3", "Domain 4"]], ["Domain 5", ["Domain 5"]],
  ]);
  assert.equal(ctx.layers.find((l) => l.key === "domain")?.label, "ACKS-DOMAINS.map.layer");
} finally {
  terrainPaint.setLayer("terrain");
}

// A hex painted into a domain: its own region, on the Regions control alone.
assert.equal(await paintHexAt(scene, centre(1, 1), "Actor.d1", "domain"), true);
assert.equal(await paintHexAt(scene, centre(1, 2), "Actor.gone", "domain"), false, "a uuid no domain answers to is no value to paint");
const [painted] = scene.regions;
assert.deepEqual([painted.visibility, painted.name, painted.color, painted.flags[MODULE_ID]],
  [CONST.REGION_VISIBILITY.LAYER, "Domain 1", d1Color, { domain: "Actor.d1", domainHexes: ["1:1"] }]);
await paintHexAt(scene, centre(1, 2), "Actor.d1", "domain");
await paintHexAt(scene, centre(1, 3), "Actor.d2", "domain");
await paintHexAt(scene, centre(1, 4), "Actor.d4", "domain");
await paintHexAt(scene, centre(1, 5), "Actor.d5", "domain");
await paintHexAt(scene, centre(1, 2), "outlands", "territory");
assert.equal(await paintHexAt(square, centre(1, 1), "Actor.d1", "domain"), false, "a square map is never painted");

/* ------------------------- the territory it derives ------------------------ */
const territoryAt = (i, j) => {
  const got = countryAt(scene, centre(i, j));
  return [got.territory, got.source.territory];
};
assert.deepEqual(territoryAt(1, 1), ["civilized", "domain"], "a hex's class is its domain's, and the source names the layer");
assert.deepEqual(territoryAt(1, 3), ["borderlands", "domain"], "a vassal's class is its own, not its liege's");
assert.deepEqual(territoryAt(1, 2), ["outlands", "map"], "a territory painted on the hex is the Judge's word over it");
assert.deepEqual(territoryAt(1, 5), [null, null], "a domain with no class implies none, and the scene says nothing either");
assert.deepEqual(territoryPlan(scene).map((h) => [h.key, h.value, h.stripe]).toSorted(), [
  ["1:1", "civilized", null], ["1:2", "outlands", TERRITORY_COLORS.civilized], ["1:3", "borderlands", null], ["1:4", "outlands", null],
], "the Territory mode draws each domain's class, and stripes the override where it differs");
// The party sheet's Country card labels a reading by its source, so the layer's
// key, which a derived territory reads as its source, has a label there.
const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
assert.equal(typeof lang["ACKS-FORMATION"]?.country?.provenance?.[DOMAIN_LAYER], "string",
  "the party sheet names a territory this layer derived");

/* ------------------------- the mode ---------------------------------------- */
assert.equal(modeForLayer("domain"), "domain", "the layer's pill shows the Domains mode");
assert.deepEqual(mapModes().find((m) => m.key === "domain"), { key: "domain", label: "ACKS-DOMAINS.map.mode", layer: "domain" });
assert.deepEqual(layerPlan(scene, "domain").map((h) => [h.key, h.value, h.color]).toSorted(), [
  ["1:1", "Actor.d1", d1Color], ["1:2", "Actor.d1", d1Color], ["1:3", "Actor.d2", layerColorFor("Actor.d2", "domain")],
  ["1:4", "Actor.d4", layerColorFor("Actor.d4", "domain")], ["1:5", "Actor.d5", layerColorFor("Actor.d5", "domain")],
]);
assert.deepEqual(domainLegend(scene), {
  rows: [
    { color: d1Color, label: "Domain 1" },
    { color: layerColorFor("Actor.d2", "domain"), label: 'ACKS-DOMAINS.map.under{"name":"Domain 2","liege":"Domain 1"}' },
    { color: layerColorFor("Actor.d4", "domain"), label: 'ACKS-DOMAINS.map.under{"name":"Domain 4","liege":"Domain 3"}' },
    { color: layerColorFor("Actor.d5", "domain"), label: "Domain 5" },
  ],
  unpainted: null,
  stripes: null,
}, "each domain painted here, in realm order, a vassal under its liege; one not painted here is left out");

const weigh = domainWeights();
assert.deepEqual([weigh("Actor.d1", null), weigh("Actor.d4", "Actor.d5"), weigh("Actor.d1", "Actor.d2"), weigh("Actor.d3", "Actor.d4")],
  [1.75, 1.75, 1, 0.6], "a realm's edge heaviest, then the line between a sovereign's vassals, then deeper");
const sides = borderSegments(scene, layerPlan(scene, "domain"), undefined, weigh);
const between = (x) => sides.filter((s) => s.from.x === s.to.x && Math.abs(s.from.x - x) < 10 && s.from.y > 100 && s.to.y < 200);
assert.deepEqual(between(300).map((s) => s.weight), [1, 1], "a sovereign meeting its vassal: one line each side, of one weight");
assert.deepEqual(between(500).map((s) => s.weight), [1.75, 1.75], "two realms meeting: the heaviest");

// A domain deleted: its hexes read as unpainted, and the mode draws them in one neutral colour.
actors.splice(actors.indexOf(d5), 1);
assert.deepEqual(territoryAt(1, 5), [null, null]);
assert.deepEqual(domainLegend(scene).rows.at(-1), { color: ORPHAN_COLOR, label: "ACKS-DOMAINS.map.unknownDomain" });
assert.equal(layerPlan(scene, "domain").find((h) => h.key === "1:5").color, ORPHAN_COLOR);
actors.push(d5);

/* ------------------------- the rows read from the map ---------------------- */
d1.system.territory = [
  { id: "t1", label: "Tract 1", hexLabels: ["0101"], count: 1, map: null, families: 40 },
  { id: "t2", label: "", hexLabels: [], count: 1, map: { sceneUuid: "Scene.s1", key: "1:2" }, families: 12 },
];
assert.deepEqual(paintedHexesOf(d1).map((h) => [h.sceneUuid, h.sceneName, h.key, h.label]),
  [["Scene.s1", "Scene 1", "1:1", "B2"], ["Scene.s1", "Scene 1", "1:2", "C2"]], "the hexes painted into this domain, on every hex scene");
assert.deepEqual(territoryOf(d1).map((r) => [r.id, r.mapState]), [["t1", "unmapped"], ["t2", "painted"], ["map.Scene.s1.1:1", "read"]],
  "the stored rows, then the painted hex no stored row names");
assert.deepEqual(hexCountFor(d1), { total: 3, unknown: 0 });
assert.deepEqual(paintedHexesOf(d3), [], "a domain with nothing painted reads only its record");
assert.deepEqual(paintedHexesOf(null), []);

/* ------------------------- telling the map --------------------------------- */
installDomainMap();
const fire = (name, ...args) => (hooks.get(name) ?? []).forEach((fn) => fn(...args));
told.length = 0;
fire("updateActor", d1, { system: { notes: "<p>x</p>" } });
fire("updateActor", place, { name: "Place 2" });
assert.deepEqual(told, [], "a change the map does not draw from, or to another actor, tells nothing");
fire("updateActor", d1, { name: "Domain 1b" });
fire("updateActor", d2, { system: { parentUuid: "" } });
fire("updateActor", d3, { system: { classification: "outlands" } });
fire("createActor", d5);
fire("deleteActor", d5);
fire("createActor", place);
assert.deepEqual(told, Array(5).fill([PAINT_LAYER_CHANGED_HOOK, "domain"]),
  "a rename, a new liege, a new class, a domain made or deleted each tell the map and the palette");

console.log("test-domain-map: all checks passed");
