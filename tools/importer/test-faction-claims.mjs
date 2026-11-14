/**
 * An organisation is handed its quarters whichever of the two steps runs first.
 *
 * The map step claims for a map it has just made; the organisations step
 * claims from a map the world already holds. Both go through one writer
 * (`claimControlledQuarters`), so maps-then-organisations and
 * organisations-then-maps end in the same `controls`, and a step run again
 * writes nothing. The suite drives the claim code with invented books,
 * quarters and Regions on mocked world collections, then pins the source
 * shape that keeps the claim in one place.
 */
import { cookbookSource } from "./cookbook-source.mjs";
import { districtPlaceId } from "../../scripts/importer/poi-binding.mjs";
import { FACTION_TYPE } from "../../scripts/factions/constants.mjs";
import { MODULE_ID } from "../../scripts/importer/constants.mjs";
import { data } from "../../scripts/importer/cookbook/state.mjs";
import {
  claimControlledQuarters, claimHeldMaps, quarterPlaceIds,
} from "../../scripts/importer/cookbook/adventure-places.mjs";

let failed = 0;
let passed = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
    failed++;
  } else passed++;
};
const ok = (name, cond, detail = "") => {
  if (!cond) {
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  } else passed++;
};

/* ---------------- invented book ---------------- */

const BOOK = "zz";
const OTHER = "yy";
const reed = districtPlaceId(BOOK, "Reed Quarter");
const stone = districtPlaceId(BOOK, "Stone Quarter");
const recipe = {
  crop: [0, 0, 10, 10],
  districts: [{ place: "zz.reedPlace" }, { place: "zz.stonePlace" }],
};
const regionRecipe = { crop: [0, 0, 10, 10], grid: { family: "hex" } };
data.books.set(BOOK, {
  entries: {
    "zz.reedPlace": { kind: "kind.location", meta: { group: "Reed Quarter — Points of Interest" } },
    "zz.stonePlace": { kind: "kind.location", meta: { group: "Stone Quarter — Points of Interest" } },
  },
  scenes: {
    "zz.scene.town": { kind: "kind.scene", scene: recipe },
    "zz.scene.coast": { kind: "kind.scene", scene: regionRecipe },
    "zz.scene.unmade": { kind: "kind.scene", scene: recipe },
  },
});

check("the quarter ids follow the recipe's districts in order", quarterPlaceIds(BOOK, recipe), [reed, stone]);

/* ---------------- mocked world ---------------- */

const live = new Set();
const flagged = (flags) => (scope, key) => flags?.[scope]?.[key];
const makeRegion = (uuid, place) => {
  live.add(uuid);
  return { uuid, getFlag: flagged({ [MODULE_ID]: { cookbook: { place } } }) };
};
const makeScene = (id, regions) => ({
  uuid: `Scene.${id}`,
  _stats: {},
  getFlag: flagged({ [MODULE_ID]: { cookbook: { id } } }),
  regions: { find: (fn) => regions.find(fn) },
});
const writes = [];
const makeFaction = (name, book, controls, held = []) => ({
  type: FACTION_TYPE,
  name,
  system: { controls: held },
  getFlag: flagged({ [MODULE_ID]: { cookbook: { book, controls } } }),
  async update(patch) {
    this.system.controls = patch["system.controls"];
    writes.push(name);
  },
});

const world = { scenes: [], actors: [] };
globalThis.game = {
  scenes: { filter: (fn) => world.scenes.filter(fn) },
  actors: { filter: (fn) => world.actors.filter(fn) },
};
globalThis.fromUuidSync = (uuid) => (live.has(uuid) ? { uuid } : null);

const reset = () => {
  world.scenes.length = 0;
  world.actors.length = 0;
  writes.length = 0;
  live.clear();
};
const townScene = () => makeScene("zz.scene.town", [makeRegion("Scene.town.Region.a", "zz.reedPlace"), makeRegion("Scene.town.Region.b", "zz.stonePlace")]);
const orgs = () => [
  makeFaction("guild", BOOK, [reed, stone]),
  makeFaction("watch", BOOK, [stone]),
  makeFaction("idle", BOOK, []),
  makeFaction("stranger", OTHER, [reed]),
];
const controlsOf = (faction) => faction.system.controls;

/* ---------------- maps, then organisations ---------------- */

reset();
{
  world.scenes.push(townScene());
  world.actors.push(...orgs());
  const n = await claimHeldMaps(BOOK);
  check("a held map hands two organisations their quarters", n, 2);
  check("the guild controls both quarters", controlsOf(world.actors[0]), ["Scene.town.Region.a", "Scene.town.Region.b"]);
  check("the watch controls the one it names", controlsOf(world.actors[1]), ["Scene.town.Region.b"]);
  check("a body with no quarters is left alone", controlsOf(world.actors[2]), []);
  check("another book's body is left alone", controlsOf(world.actors[3]), []);
  writes.length = 0;
  check("the step run again writes nothing", await claimHeldMaps(BOOK), 0);
  check("and no faction is updated", writes, []);
}
const afterMapsThenOrgs = world.actors.map(controlsOf);

/* ---------------- organisations, then maps ---------------- */

reset();
{
  world.actors.push(...orgs());
  check("with no map held the organisations step claims nothing", await claimHeldMaps(BOOK), 0);
  const scene = townScene();
  world.scenes.push(scene);
  // What the map step runs for a map it has just made.
  check("the map step hands the quarters out", await claimControlledQuarters(BOOK, scene, recipe, quarterPlaceIds(BOOK, recipe)), 2);
  check("the map step run twice writes once", await claimControlledQuarters(BOOK, scene, recipe, quarterPlaceIds(BOOK, recipe)), 0);
  check("the organisations step after the map writes nothing", await claimHeldMaps(BOOK), 0);
}
check("either order ends in the same claims", world.actors.map(controlsOf), afterMapsThenOrgs);

/* ---------------- what a held map does not claim ---------------- */

reset();
{
  world.scenes.push(makeScene("zz.scene.coast", [makeRegion("Scene.coast.Region.a", "zz.reedPlace")]));
  world.actors.push(...orgs());
  check("a region's map and a recipe with no map in the world claim nothing", await claimHeldMaps(BOOK), 0);
}

reset();
{
  const copy = makeScene("zz.scene.town", [makeRegion("Scene.copy.Region.a", "zz.reedPlace")]);
  copy._stats = { duplicateSource: "Scene.elsewhere" };
  const real = townScene();
  world.scenes.push(copy, real);
  world.actors.push(makeFaction("guild", BOOK, [reed]));
  await claimHeldMaps(BOOK);
  check("the import is preferred to a copy of it", controlsOf(world.actors[0]), ["Scene.town.Region.a"]);
}

reset();
{
  world.scenes.push(townScene());
  live.add("Scene.elsewhere.Region.k");
  world.actors.push(makeFaction("guild", BOOK, [reed], ["Scene.elsewhere.Region.k", "Scene.gone.Region.x"]));
  await claimHeldMaps(BOOK);
  check("a held Region that is gone is dropped and one on another scene is kept",
    controlsOf(world.actors[0]), ["Scene.elsewhere.Region.k", "Scene.town.Region.a"]);
}

/* ---------------- the claim stays in one place ---------------- */

{
  const src = cookbookSource();
  const count = (re) => (src.match(re) ?? []).length;
  check("one declaration of the claim", count(/function claimControlledQuarters\(/g), 1);
  check("the map step is its caller there", count(/await claimControlledQuarters\(bookId, scene, recipe, ids\.districtIds\)/g), 1);
  check("the map's quarter ids are the ones the organisations step reads", count(/districtIds = quarterPlaceIds\(bookId, recipe\)/g), 1);
  const start = src.indexOf("async function cookbookImportFactions(");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  ok("the organisations step claims from the held maps", /claimHeldMaps\(bookId\)/.test(body));
  ok("and does it after the organisations exist", body.indexOf("claimHeldMaps") > body.indexOf("organisationData("));
}

if (failed) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log(`faction claims: ${passed} checks passed`);
