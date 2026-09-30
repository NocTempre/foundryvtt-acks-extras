/**
 * A settlement's Adventure: ids, references, and what an import creates.
 *
 * What this guards is a city a Judge would otherwise meet broken: an import
 * that overwrites a played place with the book's, a library person copied
 * into the world beside the one every organisation already names, a quarter
 * handed to a region that is not there, a map restored under a new id so that
 * nothing pointing at it resolves. None of it shows in a green compile.
 *
 * The Adventure here is invented: one map, two quarters, three places, two
 * organisations, three people and two lists, under made-up ids. No book text,
 * no printed name, no printed figure. The foot of the file pins the shapes the
 * Foundry half depends on and cannot be exercised offline: the import hook
 * stays synchronous, and both map paths reach the Adventure.
 */
import { readFileSync } from "node:fs";
import { MODULE_ID } from "../../scripts/importer/constants.mjs";
import { LOCATION_TYPE } from "../../scripts/location/constants.mjs";
import { FACTION_TYPE } from "../../scripts/factions/constants.mjs";
import {
  ADVENTURE_KIND, adventureCookbookId, stableDocId, settlementAdventureId, refsOf, peopleNamed, adventureRefs,
  withWorldIds, linkFields, seatsLeft, isRoot, isShelvedKind, fillPlan, includedKeys, applyFill,
} from "../../scripts/importer/adventure-binding.mjs";

let failed = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
    failed++;
  }
};
const ok = (name, cond, detail = "") => {
  if (!cond) {
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
};

/** A 16-character invented id. */
const id16 = (tag) => tag.padEnd(16, "0");
const LIB = "Compendium.world.zz-lib.Actor";
const LIBT = "Compendium.world.zz-tables.RollTable";
const PERSON_KIND = "kind.npc";
const stamp = (id, kind, extra = {}) => ({ [MODULE_ID]: { cookbook: { id, book: "zz", kind, ...extra } } });

const I = Object.fromEntries(
  ["city", "q1", "q2", "p1", "p2", "p3", "f1", "f2", "n1", "n2", "n3", "t1", "t2", "s", "r1", "r2", "b1", "b2",
    "tk1", "tk2", "tk3", "fs", "fa", "fp", "ff", "fn", "fu", "ft"].map((k) => [k, id16(k)]),
);
const place = (k, extra = {}) => ({
  _id: I[k], type: LOCATION_TYPE, name: `Place ${k}`, folder: I.fp, flags: stamp(`zz.${k}`, "kind.poi"),
  system: { parentUuid: "", sceneUuid: "", regionUuid: "", roster: [], ...extra },
});
const person = (k, type = "monster") => ({
  _id: I[k], type, name: `Person ${k}`, folder: I.fn, flags: stamp(`zz.${k}`, PERSON_KIND),
  _stats: { compendiumSource: `${LIB}.${I[k]}` }, system: {},
});
const faction = (k, sys) => ({
  _id: I[k], type: FACTION_TYPE, name: `Body ${k}`, folder: I.ff, flags: stamp(`zz.${k}`, "kind.faction", sys.flag ?? {}),
  system: { seatUuid: "", leaderUuid: "", holdings: [], relations: [], members: [], controls: [], ...sys.system },
});
const table = (k) => ({ _id: I[k], name: `List ${k}`, folder: I.ft, flags: stamp(`zz.${k}`, "kind.rolltable"), results: [] });
const folder = (k, type, name, parent = null) => ({ _id: I[k], type, name, folder: parent, flags: {} });

/** The invented Adventure, in core's content order (actors, scenes, tables, folders). */
function adventure() {
  return {
    Actor: [
      place("city", { sceneUuid: `Scene.${I.s}` }),
      place("q1", { parentUuid: `Actor.${I.city}`, regionUuid: `Scene.${I.s}.Region.${I.r1}` }),
      place("q2", { parentUuid: `Actor.${I.city}`, regionUuid: `Scene.${I.s}.Region.${I.r2}` }),
      place("p1", { parentUuid: `Actor.${I.q1}`, roster: [{ uuid: `Actor.${I.n1}`, ownerUuid: "" }] }),
      place("p2", { parentUuid: `Actor.${I.q2}` }),
      place("p3", { parentUuid: `Actor.${I.q2}` }),
      faction("f1", {
        flag: { controls: ["zz.q1"] },
        system: {
          seatUuid: `Actor.${I.p1}`, leaderUuid: `Actor.${I.n1}`, members: [{ uuid: `Actor.${I.n2}`, ownerUuid: "" }],
          relations: [{ uuid: `Actor.${I.f2}` }], controls: [`Scene.${I.s}.Region.${I.r1}`],
        },
      }),
      faction("f2", {
        system: { seatUuid: `Actor.${I.p2}`, leaderUuid: `Actor.${I.n2}`, relations: [{ uuid: `Actor.${I.f1}` }] },
      }),
      person("n1"),
      person("n2"),
      person("n3"),
    ],
    Scene: [{
      _id: I.s, name: "Map", folder: I.fs,
      flags: {
        [MODULE_ID]: {
          cookbook: { id: "zz.map", book: "zz", kind: "kind.scene" }, location: `Actor.${I.city}`,
          battlemap: { incidents: { tableUuid: `RollTable.${I.t1}` } },
        },
      },
      regions: [
        {
          _id: I.r1, flags: { [MODULE_ID]: { cookbook: { place: "zz.q1" }, location: `Actor.${I.q1}` } },
          behaviors: [{ _id: I.b1, type: "district", system: { specialTableUuid: `RollTable.${I.t2}` } }],
        },
        {
          _id: I.r2, flags: { [MODULE_ID]: { cookbook: { place: "zz.q2" }, location: `Actor.${I.q2}` } },
          behaviors: [{ _id: I.b2, type: "district", system: {} }],
        },
      ],
      tokens: [{ _id: I.tk1, actorId: I.p1 }, { _id: I.tk2, actorId: I.p2 }, { _id: I.tk3, actorId: I.p3 }],
    }],
    RollTable: [table("t1"), table("t2")],
    Folder: [
      folder("fs", "Scene", "ZZ"), folder("fa", "Actor", "ZZ"), folder("fp", "Actor", "Places", I.fa),
      folder("ff", "Actor", "Factions", I.fa), folder("fn", "Actor", "People", I.fa),
      folder("fu", "Actor", "Unused", I.fa), folder("ft", "RollTable", "ZZ"),
    ],
  };
}
const keysOf = (content) => new Set(Object.entries(content).flatMap(([t, docs]) => docs.map((d) => `${t}.${d._id}`)));
const created = (plan) => Object.entries(plan.create).flatMap(([t, docs]) => docs.map((d) => `${t}.${d._id}`)).sort();
const k = (type, tag) => `${type}.${I[tag]}`;

/**
 * A world, as the fill asks about it. `held` are keys the world has by id;
 * `twins` maps a key to the world id of its twin; `shelved` are keys the
 * library holds; `worldDocs` are the world's own versions of held documents,
 * where they differ from the Adventure's.
 */
function world({ held = [], twins = {}, shelved = [], worldDocs = {}, regions = {} } = {}) {
  const has = new Set(held);
  const lib = new Set(shelved);
  return {
    has: (type, id) => has.has(`${type}.${id}`),
    twinOf: (type, data) => twins[`${type}.${data._id}`] ?? null,
    shelfOf: (type, data) => (lib.has(`${type}.${data._id}`) ? `${type === "RollTable" ? LIBT : LIB}.${data._id}` : null),
    worldRefs: (type, id) => {
      const doc = worldDocs[`${type}.${id}`] ?? Object.values(adventure()).flat().find((d) => d._id === id);
      return doc ? refsOf(type, doc) : [];
    },
    regionsOf: () => new Map(Object.entries(regions)),
  };
}
const ALL_ACTORS = ["city", "q1", "q2", "p1", "p2", "p3", "f1", "f2"].map((t) => k("Actor", t));
/** The world the map step leaves behind: map, places, organisations and their folders held; people and lists in the library. */
const sourceWorld = (drop = []) => ({
  held: [k("Scene", "s"), ...ALL_ACTORS, k("Folder", "fs"), k("Folder", "fa"), k("Folder", "fp"), k("Folder", "ff")]
    .filter((key) => !drop.includes(key)),
  shelved: [k("Actor", "n1"), k("Actor", "n2"), k("Actor", "n3"), k("RollTable", "t1"), k("RollTable", "t2")],
});

// --- ids ----------------------------------------------------------------------------
{
  const a = stableDocId("zz.map.adventure");
  ok("a derived id is a document id", /^[a-z0-9]{16}$/.test(a), a);
  check("a derived id is the same every time", stableDocId("zz.map.adventure"), a);
  const many = new Set(Array.from({ length: 10000 }, (_, i) => stableDocId(`seed-${i}`)));
  check("ten thousand seeds, ten thousand ids", many.size, 10000);
  check("the Adventure's cookbook id keeps the book first", adventureCookbookId("zz.map"), "zz.map.adventure");
  check("the Adventure's id is its cookbook id's", settlementAdventureId("zz.map"), a);
  check("the kind is a cookbook kind", ADVENTURE_KIND.startsWith("kind."), true);
}

// --- references ----------------------------------------------------------------------
{
  const [, q1, , p1, , , f1] = adventure().Actor;
  check("a faction names its seat, leader, member, relation and region", [...refsOf("Actor", f1)].sort(),
    [k("Actor", "f2"), k("Actor", "n1"), k("Actor", "n2"), k("Actor", "p1"), k("Scene", "s")].sort());
  check("a region reference names its scene", [...refsOf("Actor", q1)].sort(), [k("Actor", "city"), k("Scene", "s")].sort());
  const scene = adventure().Scene[0];
  check("a scene names its city, lists, quarters and every token's actor", [...refsOf("Scene", scene)].sort(),
    [k("Actor", "city"), k("Actor", "q1"), k("Actor", "q2"), k("Actor", "p1"), k("Actor", "p2"), k("Actor", "p3"),
      k("RollTable", "t1"), k("RollTable", "t2")].sort());
  const libOnly = { ...f1, system: { ...f1.system, leaderUuid: `${LIB}.${I.n1}`, members: [{ uuid: `${LIB}.${I.n2}` }] } };
  ok("a library person is not a reference an import creates", !refsOf("Actor", libOnly).has(k("Actor", "n1")));
  const placed = { ...p1, system: { ...p1.system, roster: [{ uuid: `Actor.${I.n1}`, ownerUuid: `Actor.${id16("pc")}` }] } };
  check("people are leaders, members and occupants, never who placed a row", peopleNamed(placed), [`Actor.${I.n1}`]);
  check("a faction's people", peopleNamed(f1), [`Actor.${I.n1}`, `Actor.${I.n2}`]);

  const before = JSON.stringify(f1);
  const moved = adventureRefs("Actor", f1, new Map([
    [`Actor.${I.n1}`, `${LIB}.${I.n1}`], [`Actor.${I.f2}`, `Actor.${id16("f2w")}`],
    [`Scene.${I.s}.Region.${I.r1}`, ""], [`Folder.${I.ff}`, `Folder.${id16("ffw")}`],
  ]));
  check("the leader points at the library", moved.system.leaderUuid, `${LIB}.${I.n1}`);
  check("a relation follows its twin", moved.system.relations[0].uuid, `Actor.${id16("f2w")}`);
  check("a region the world lacks is dropped from a list", moved.system.controls, []);
  check("an unmapped reference stands", moved.system.seatUuid, `Actor.${I.p1}`);
  check("the folder follows its twin", moved.folder, id16("ffw"));
  check("the input is not changed", JSON.stringify(f1), before);
  const noFolder = adventureRefs("Actor", f1, new Map([[`Folder.${I.ff}`, ""]]));
  check("a folder that is not there becomes none", noFolder.folder, null);
  const tokens = adventureRefs("Scene", scene, new Map([[`Actor.${I.p1}`, `Actor.${id16("p1w")}`], [`Actor.${I.p2}`, `${LIB}.${I.p2}`]]));
  check("a token follows a world twin and ignores a library one", tokens.tokens.map((t) => t.actorId), [id16("p1w"), I.p2, I.p3]);
  const regionMoved = adventureRefs("Scene", scene, new Map([[`RollTable.${I.t2}`, `${LIBT}.${I.t2}`]]));
  check("a quarter's list points at the library", regionMoved.regions[0].behaviors[0].system.specialTableUuid, `${LIBT}.${I.t2}`);
}

// --- the world's ids over a rebuilt map ----------------------------------------------------
{
  const built = adventure().Scene[0];
  for (const r of built.regions) {
    delete r._id;
    for (const b of r.behaviors) delete b._id;
  }
  for (const t of built.tokens) delete t._id;
  delete built._id;
  const held = {
    _id: id16("sw"),
    regions: [{ _id: id16("rw1"), flags: { [MODULE_ID]: { cookbook: { place: "zz.q1" } } }, behaviors: [{ _id: id16("bw1"), type: "district" }] }],
    tokens: [{ _id: id16("tw1"), actorId: I.p1 }],
  };
  const heldBefore = JSON.stringify(held);
  const out = withWorldIds(built, held, "zz.map.adventure");
  check("the scene keeps the world's id", out._id, id16("sw"));
  check("a quarter drawn in the world keeps its region's id", out.regions[0]._id, id16("rw1"));
  check("and its behaviour's", out.regions[0].behaviors[0]._id, id16("bw1"));
  check("a token keeps the world's id for its actor", out.tokens[0]._id, id16("tw1"));
  const again = withWorldIds(built, held, "zz.map.adventure");
  check("what the world lacks takes the same id on every rebuild", [again.regions[1]._id, again.tokens[1]._id], [out.regions[1]._id, out.tokens[1]._id]);
  const ids = [out._id, ...out.regions.flatMap((r) => [r._id, ...r.behaviors.map((b) => b._id)]), ...out.tokens.map((t) => t._id)];
  check("no id twice", new Set(ids).size, ids.length);
  check("the world's scene is not changed", JSON.stringify(held), heldBefore);
  const fresh = withWorldIds(built, null, "zz.map.adventure");
  check("with no world scene, the scene's id comes from the seed", fresh._id, stableDocId("zz.map.adventure|scene"));
  const twice = withWorldIds({ ...built, tokens: [{ actorId: I.p1 }, { actorId: I.p1 }] }, null, "s");
  ok("two tokens of one actor take two ids", twice.tokens[0]._id !== twice.tokens[1]._id);
}

// --- link fields ----------------------------------------------------------------------------
{
  const a = adventure();
  const bare = a.Actor.map((x) => ({ ...x, system: { ...x.system, sceneUuid: "", regionUuid: "", controls: [] } }));
  const other = faction("f2", { flag: { controls: ["zz.q2"] }, system: {} });
  other.flags[MODULE_ID].cookbook.book = "yy";
  bare[7] = other;
  const before = JSON.stringify(bare);
  const linked = linkFields(a.Scene[0], bare, "zz");
  const by = (tag) => linked.find((x) => x._id === I[tag]);
  check("the city is linked to its map", by("city").system.sceneUuid, `Scene.${I.s}`);
  check("each quarter is linked to its region", [by("q1").system.regionUuid, by("q2").system.regionUuid],
    [`Scene.${I.s}.Region.${I.r1}`, `Scene.${I.s}.Region.${I.r2}`]);
  check("an organisation of the book controls its quarter's region", by("f1").system.controls, [`Scene.${I.s}.Region.${I.r1}`]);
  check("an organisation of another book is left alone", by("f2").system.controls, []);
  const noRegion = { ...a.Scene[0], regions: [a.Scene[0].regions[1]] };
  check("a quarter with no region gives no control", linkFields(noRegion, bare, "zz").find((x) => x._id === I.f1).system.controls, []);
  check("the actors are not changed", JSON.stringify(bare), before);
  const left = [faction("f1", { system: { seatUuid: `${LIB}.${id16("far")}`, holdings: [{ uuid: `${LIB}.${id16("h1")}` }, { uuid: `Actor.${I.p1}` }] } })];
  check("seats and holdings off the map are counted", seatsLeft(left), 2);
}

// --- what an import creates -------------------------------------------------------------------
{
  const content = adventure();
  const all = keysOf(content);

  const fresh = fillPlan({ content, included: all, ...world() });
  check("a fresh world: everything the map and its organisations name", created(fresh), [...all].filter((x) =>
    x !== k("Actor", "n3") && x !== k("Folder", "fu")).sort());
  check("a person nobody names, and an empty folder, are not needed", fresh.skipped, 2);
  check("the created types keep core's order", Object.keys(fresh.create), ["Actor", "Scene", "RollTable", "Folder"]);
  check("a fresh world holds nothing", [fresh.held, fresh.shelved], [0, 0]);

  const s1 = fillPlan({ content, included: all, ...world(sourceWorld()) });
  check("the world that built it: nothing to add", [s1.added, created(s1)], [0, []]);
  check("held and shelved are counted", [s1.held, s1.shelved], [13, 5]);

  const oneBody = fillPlan({ content, included: all, ...world(sourceWorld([k("Actor", "f1")])) });
  check("one organisation deleted: it alone comes back", created(oneBody), [k("Actor", "f1")]);
  const f1 = oneBody.create.Actor[0];
  check("its leader and member stay the library's", [f1.system.leaderUuid, f1.system.members[0].uuid], [`${LIB}.${I.n1}`, `${LIB}.${I.n2}`]);
  check("its seat, relation and region are the world's", [f1.system.seatUuid, f1.system.relations[0].uuid, f1.system.controls],
    [`Actor.${I.p1}`, `Actor.${I.f2}`, [`Scene.${I.s}.Region.${I.r1}`]]);

  const noMap = fillPlan({ content, included: all, ...world(sourceWorld([k("Scene", "s")])) });
  check("the map deleted: it alone comes back", created(noMap), [k("Scene", "s")]);
  const map = noMap.create.Scene[0];
  check("its lists are the library's", [map.flags[MODULE_ID].battlemap.incidents.tableUuid, map.regions[0].behaviors[0].system.specialTableUuid],
    [`${LIBT}.${I.t1}`, `${LIBT}.${I.t2}`]);

  const worldMap = { ...content.Scene[0] };
  const onePlace = fillPlan({ content, included: all, ...world({ ...sourceWorld([k("Actor", "p3")]), worldDocs: { [k("Scene", "s")]: worldMap } }) });
  check("a place deleted whose token stands: that place alone", created(onePlace), [k("Actor", "p3")]);

  const twins = fillPlan({
    content, included: all,
    ...world({ ...sourceWorld([k("Actor", "f1"), k("Actor", "f2")]), twins: { [k("Actor", "f1")]: id16("f1w") } }),
  });
  check("a twin is held, and what is created points at it", [created(twins), twins.create.Actor[0].system.relations[0].uuid],
    [[k("Actor", "f2")], `Actor.${id16("f1w")}`]);

  const sw = id16("sw");
  const worldScene = { _id: sw, flags: { [MODULE_ID]: { location: `Actor.${I.city}` } },
    regions: [{ _id: id16("rw1"), flags: { [MODULE_ID]: { location: `Actor.${I.q1}` } } }, { _id: id16("rw2"), flags: { [MODULE_ID]: { location: `Actor.${I.q2}` } } }] };
  const sceneTwin = fillPlan({
    content, included: all,
    ...world({
      ...sourceWorld([k("Scene", "s"), k("Actor", "q1"), k("Actor", "q2")]),
      twins: { [k("Scene", "s")]: sw }, worldDocs: { [`Scene.${sw}`]: worldScene },
      regions: { [`Scene.${I.s}.Region.${I.r1}`]: `Scene.${sw}.Region.${id16("rw1")}`, [`Scene.${I.s}.Region.${I.r2}`]: "" },
    }),
  });
  check("the map held under another id: the quarters it names come back", created(sceneTwin), [k("Actor", "q1"), k("Actor", "q2")]);
  check("each on the world's region, or none", sceneTwin.create.Actor.map((x) => x.system.regionUuid), [`Scene.${sw}.Region.${id16("rw1")}`, ""]);
  check("the held map is reported for its links", sceneTwin.heldScenes, [sw]);

  const noActors = new Set([...all].filter((x) => !x.startsWith("Actor.") && ![I.fa, I.fp, I.ff, I.fn, I.fu].some((f) => x === `Folder.${f}`)));
  const mapOnly = fillPlan({ content, included: noActors, ...world() });
  check("actors unticked: the map, its lists and their folders, no actor", created(mapOnly),
    [k("Scene", "s"), k("RollTable", "t1"), k("RollTable", "t2"), k("Folder", "fs"), k("Folder", "ft")].sort());

  const noFolders = new Set([...all].filter((x) => !x.startsWith("Folder.")));
  const loose = fillPlan({ content, included: noFolders, ...world() });
  check("a folder that is not created is not pointed at", loose.create.Actor[0].folder, null);

  check("roots: the map, an organisation, a Judge's own addition", [
    isRoot("Scene", content.Scene[0]), isRoot("Actor", content.Actor[6]), isRoot("Actor", { type: "monster" }),
    isRoot("Actor", content.Actor[0]), isRoot("RollTable", content.RollTable[0]), isRoot("Folder", content.Folder[0]),
  ], [true, true, true, false, false, false]);
  check("shelved kinds: a person and a list, never a place or an organisation", [
    isShelvedKind("Actor", content.Actor[8]), isShelvedKind("RollTable", content.RollTable[0]),
    isShelvedKind("Actor", content.Actor[0]), isShelvedKind("Actor", content.Actor[6]),
  ], [true, true, false, false]);
}

// --- core's lists, narrowed in place ----------------------------------------------------------
{
  const toCreate = { Actor: [{ _id: "a" }, { _id: "b" }], Scene: [{ _id: "s" }], Folder: [{ _id: "f" }] };
  const toUpdate = { Actor: [{ _id: "c" }] };
  const createRef = toCreate;
  const updateRef = toUpdate;
  check("what core scoped in", [...includedKeys(toCreate, toUpdate)], ["Actor.a", "Actor.b", "Scene.s", "Folder.f", "Actor.c"]);
  applyFill(toCreate, toUpdate, { Actor: [{ _id: "b" }], Folder: [{ _id: "f" }] });
  ok("core's own objects are the ones changed", createRef === toCreate && updateRef === toUpdate);
  check("nothing is left to overwrite", Object.keys(toUpdate), []);
  check("created types keep core's order", Object.keys(toCreate), ["Actor", "Folder"]);
  check("each type holds only the fill", toCreate.Actor, [{ _id: "b" }]);
}

// --- shapes the Foundry half depends on -----------------------------------------------------
{
  const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
  /** A top-level function's text, from its declaration to the first closing brace at column 0. */
  const body = (src, decl) => {
    const at = src.indexOf(decl);
    if (at < 0) return "";
    const end = src.indexOf("\n}\n", at);
    return src.slice(at, end < 0 ? undefined : end + 2);
  };
  const steer = read("scripts/importer/settlement-adventure.mjs");
  for (const decl of ["function steerImport(", "function fillImport(", "function worldLookups("]) {
    const text = body(steer, decl);
    ok(`${decl} is still the name of what this pins`, text.length > 0);
    // Core does not await a hook: a promise here leaves core's lists whole
    // and sends the import into its overwrite.
    ok(`${decl} never awaits`, !/\basync\b|\bawait\b|\.then\(/.test(text), decl);
  }
  ok("the import hook cancels on failure", /catch \(err\) \{[\s\S]*?return false;/.test(body(steer, "function steerImport(")));
  ok("both hooks are registered", steer.includes('Hooks.on("preImportAdventure", steerImport)') && steer.includes('Hooks.on("importAdventure", afterImport)'));

  const cookbook = read("scripts/importer/cookbook.mjs");
  const scene = body(cookbook, "async function importScene(");
  check("both a held and a made map reach their Adventure", scene.split("ensureSettlementAdventure(").length - 1, 2);
  ok("the made map is built by the same code as the Adventure's", scene.includes("mapCreateData(") && !scene.includes("districtRegionData("));
  ok("a failed Adventure is counted, never thrown at the map", /catch \(err\) \{\s*counts\.adventuresFailed\+\+/.test(body(cookbook, "async function ensureSettlementAdventure(")));

  const binding = read("scripts/importer/adventure-binding.mjs");
  ok("the binding stays Foundry-free", !/\bgame\.|\bfoundry\.|\bHooks\./.test(binding));

  const boot = read("scripts/importer/module.mjs");
  const guard = boot.indexOf("legacyImporterActive()) {");
  const hooks = boot.indexOf("registerSettlementAdventureHooks();");
  ok("the import hooks register after the legacy guard", guard > 0 && hooks > guard);

  const lang = JSON.parse(read("lang/en.json"));
  for (const key of ["caption", "intro", "contents", "fillRule", "resetRule", "seatsLeft", "filled", "nothingToAdd", "fillFailed"]) {
    ok(`lang has ACKS-IMPORTER.adventure.${key}`, typeof lang[`ACKS-IMPORTER.adventure.${key}`] === "string");
  }
  for (const key of ["Made", "Rebuilt", "Held", "Failed"]) {
    ok(`lang has ACKS-IMPORTER.ui.scenesAdventure${key}`, typeof lang[`ACKS-IMPORTER.ui.scenesAdventure${key}`] === "string");
  }
}

if (failed) {
  console.error(`\nsettlement-adventure: ${failed} failure(s)`);
  process.exit(1);
}
console.error("settlement-adventure: OK");
