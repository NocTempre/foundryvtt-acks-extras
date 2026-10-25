/**
 * A book's Adventure: ids, references, folders, staleness, and what an import
 * creates.
 *
 * What this guards is a book a Judge would otherwise meet broken: an import
 * that overwrites a played place with the book's, a library person copied
 * into the world beside the one every organisation already names, a quarter
 * handed to a region that is not there, a map restored under a new id so that
 * nothing pointing at it resolves, a Judge's edit to the Adventure written
 * over by the next run. None of it shows in a green compile.
 *
 * The Adventure here is invented: one map, two quarters, four places, two
 * organisations, three people, two lists, a journal and an item, under
 * made-up ids. No book text, no printed name, no printed figure. The foot of
 * the file pins the shapes the Foundry half depends on and cannot be
 * exercised offline: the import waits for a cold library before core lists
 * its documents, the hook stays synchronous and refuses a shelf that never
 * loaded, the map step writes no Adventure, and the adventures step closes
 * the import chain.
 */
import { readFileSync } from "node:fs";
import { MODULE_ID } from "../../scripts/importer/constants.mjs";
import { LOCATION_TYPE } from "../../scripts/location/constants.mjs";
import { FACTION_TYPE } from "../../scripts/factions/constants.mjs";
import {
  ADVENTURE_KINDS, BOOK_ADVENTURE_KIND, SETTLEMENT_ADVENTURE_KIND, adventureCookbookId, stableDocId,
  settlementAdventureId, bookAdventureCookbookId, bookAdventureId, refsOf, adventureRefs, withWorldIds, linkFields,
  seatsLeft, isRoot, isShelvedKind, fillPlan, includedKeys, applyFill, adventureFolderSources, withoutStats,
  sourcesHashOf, WRITE_SLACK_MS, bookAdventureState, legacyAdventuresOf, journalCookbookId, standInsByClaim, withAdventureLinks,
} from "../../scripts/importer/adventure-binding.mjs";
import { linkRegionData, linkQuestion, LINK_ASK } from "../../scripts/importer/scene-binding.mjs";

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
const LIBJ = "Compendium.world.zz-journals.JournalEntry";
const LIBI = "Compendium.world.zz-items.Item";
const PERSON_KIND = "kind.npc";
const stamp = (id, kind, extra = {}) => ({ [MODULE_ID]: { cookbook: { id, book: "zz", kind, ...extra } } });

const I = Object.fromEntries(
  ["city", "q1", "q2", "p1", "p2", "p3", "p4", "f1", "f2", "n1", "n2", "n3", "t1", "t2", "j1", "i1", "s", "s2", "r1", "r2",
    "b1", "b2", "rx", "tk1", "tk2", "tk3", "fs", "fa", "fp", "ff", "fn", "fu", "ft"].map((k) => [k, id16(k)]),
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

/**
 * The invented Adventure, in core's content order. `book` adds what a book's
 * Adventure carries beside the map: a place no map shows, a journal, an item.
 */
function adventure({ book = false } = {}) {
  return {
    Actor: [
      place("city", { sceneUuid: `Scene.${I.s}` }),
      place("q1", { parentUuid: `Actor.${I.city}`, regionUuid: `Scene.${I.s}.Region.${I.r1}` }),
      place("q2", { parentUuid: `Actor.${I.city}`, regionUuid: `Scene.${I.s}.Region.${I.r2}` }),
      place("p1", { parentUuid: `Actor.${I.q1}`, roster: [{ uuid: `Actor.${I.n1}`, ownerUuid: "" }] }),
      place("p2", { parentUuid: `Actor.${I.q2}` }),
      place("p3", { parentUuid: `Actor.${I.q2}` }),
      ...(book ? [place("p4")] : []),
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
    ...(book ? {
      JournalEntry: [{ _id: I.j1, name: "Journal j1", folder: null, flags: stamp("zz.j1", "kind.journal"), pages: [] }],
      Item: [{ _id: I.i1, name: "Item i1", type: "item", folder: null, flags: stamp("zz.i1", "kind.item"), system: {} }],
    } : {}),
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
const LIB_OF = { RollTable: LIBT, JournalEntry: LIBJ, Item: LIBI };

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
    shelfOf: (type, data) => (lib.has(`${type}.${data._id}`) ? `${LIB_OF[type] ?? LIB}.${data._id}` : null),
    worldRefs: (type, id) => {
      const doc = worldDocs[`${type}.${id}`] ?? Object.values(adventure({ book: true })).flat().find((d) => d._id === id);
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
  check("a map's seed keeps the book first", adventureCookbookId("zz.map"), "zz.map.adventure");
  check("the retired per-map id is still its seed's", settlementAdventureId("zz.map"), a);
  check("a book's Adventure keeps the book first", bookAdventureCookbookId("zz"), "zz.book");
  check("a book's Adventure's id is its cookbook id's", bookAdventureId("zz"), stableDocId("zz.book"));
  ok("two books, two Adventures", bookAdventureId("zz") !== bookAdventureId("yy"));
  const journal = journalCookbookId("zz", "B. Lower Vaults");
  ok("a journal's id keeps the book first and carries none of the group's words",
    journal.startsWith("zz.journal-") && !/Lower|Vaults/.test(journal), journal);
  check("a journal's id is the same every time", journalCookbookId("zz", "B. Lower Vaults"), journal);
  ok("two groups, two journals", journalCookbookId("zz", "C. Upper Vaults") !== journal);
  check("both kinds are steered, the retired one included", ADVENTURE_KINDS, [BOOK_ADVENTURE_KIND, SETTLEMENT_ADVENTURE_KIND]);
  ok("the kinds are cookbook kinds", ADVENTURE_KINDS.every((x) => x.startsWith("kind.")));
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
  check("a place's occupant is a reference", [...refsOf("Actor", p1)].includes(k("Actor", "n1")), true);

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
  // A zone's list is a behaviour's `tableUuid`, carried in world form like the rest.
  const zoned = { ...scene, regions: [{ _id: id16("rz"), flags: {}, behaviors: [{ type: "zone", system: { tableUuid: `${LIBT}.${I.t1}` } }] }] };
  const zoneMoved = adventureRefs("Scene", zoned, new Map([[`${LIBT}.${I.t1}`, `RollTable.${I.t1}`]]));
  check("a zone's list is carried in world form", zoneMoved.regions[0].behaviors[0].system.tableUuid, `RollTable.${I.t1}`);
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

// --- the ways between a book's maps, however few the world holds ----------------------------------
{
  // Map A is held with one end of a way; map B is not, and holds the way's
  // other end and a stair over its storeys. A also carries a way whose row is
  // gone. A destination is written as `rel:<target> from <origin>`.
  const A = id16("sa");
  const B = stableDocId("zz.mapB.adventure|scene");
  const keyA = "zz.mapA|0|1,1,2,2";
  const keyB = "zz.mapB|0|3,3,4,4";
  const keyS = "zz.mapB|levels|5,5,6,6";
  const keyGone = "zz.mapA|0|7,7,8,8";
  const dead = `...${id16("gone")}.Region.${id16("dead")}`;
  const extra = `...${id16("else")}.Region.${id16("extra")}`;
  const heldWay = (tag, key, destinations) => ({
    _id: id16(`r${tag}`), name: `Held ${tag}`, flags: { [MODULE_ID]: { cookbook: { link: key } } },
    behaviors: [{ _id: id16(`b${tag}`), type: "teleportToken", system: { destinations, choice: false, dialog: { revealed: null, unrevealed: null } } }],
  });
  const scenes = new Map([
    ["zz.mapA", { _id: A, regions: [heldWay("a", keyA, [dead, extra]), heldWay("g", keyGone, [dead])] }],
    ["zz.mapB", { _id: B, regions: [] }],
  ]);
  const ends = new Map([
    [keyA, { key: keyA, sceneId: "zz.mapA", mode: "teleport", dests: new Set([keyB]) }],
    [keyB, { key: keyB, sceneId: "zz.mapB", mode: "teleport", dests: new Set([keyA]) }],
    [keyS, { key: keyS, sceneId: "zz.mapB", mode: "level", dests: new Set() }],
  ]);
  const world = { [extra]: `Scene.${id16("else")}.Region.${id16("extra")}` };
  const pass = () => withAdventureLinks({
    scenes, ends,
    lay: (end) => linkRegionData({ name: end.key, rect: { x: 0, y: 0, width: 1, height: 1 }, mode: end.mode, end: end.key, links: ["zz.link1"], book: "zz" }),
    keep: (uuid) => world[uuid] ?? (uuid.startsWith("rel:") ? uuid.slice(4).split(" from ")[0] : null),
    relative: (to, from) => `rel:${to} from ${from}`,
    question: linkQuestion,
  });
  const result = pass();
  const [held, gone] = scenes.get("zz.mapA").regions;
  const regionsB = scenes.get("zz.mapB").regions;
  const door = regionsB.find((r) => r.flags[MODULE_ID].cookbook.link === keyB);
  const seed = `zz.mapB.adventure|link|${keyB}`;
  check("the ends the world lacks are laid, and a held end is not laid again", [result.laid, regionsB.length, scenes.get("zz.mapA").regions.length], [2, 2, 2]);
  check("a laid end takes its ids from its map's seed", [door._id, door.behaviors[0]._id], [stableDocId(seed), stableDocId(`${seed}|behavior|0`)]);
  check("a held end keeps its ids", [held._id, held.behaviors[0]._id], [id16("ra"), id16("ba")]);
  const origin = (scene, region) => `Scene.${scene}.Region.${region._id}.RegionBehavior.${region.behaviors[0]._id}`;
  check("a held end drops a dead destination, keeps the Judge's, and leads to the laid end", held.behaviors[0].system.destinations,
    [extra, `rel:Scene.${B}.Region.${door._id} from ${origin(A, held)}`]);
  check("and, leading to several, asks which", [held.behaviors[0].system.choice, held.behaviors[0].system.dialog.revealed], [true, LINK_ASK.several]);
  check("a laid end leads back to the held one, asking nothing", [door.behaviors[0].system.destinations, door.behaviors[0].system.choice, door.behaviors[0].system.dialog.revealed],
    [[`rel:Scene.${A}.Region.${held._id} from ${origin(B, door)}`], false, null]);
  check("a stair is laid over its storeys with no destinations", regionsB.find((r) => r.flags[MODULE_ID].cookbook.link === keyS).behaviors[0].type, "changeLevel");
  check("a way whose row is gone keeps only what still resolves", gone.behaviors[0].system.destinations, []);
  check("the held ends whose destinations changed are counted", result.repaired, 2);
  const before = JSON.stringify([...scenes]);
  const again = pass();
  check("a second pass lays nothing and changes nothing", [again.laid, again.repaired, JSON.stringify([...scenes]) === before], [0, 0, true]);
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

  // A book has several maps, linked one after another over the same actors.
  const onOther = `Scene.${I.s2}.Region.${I.rx}`;
  const stale = `Scene.${I.s}.Region.${id16("rold")}`;
  const held = bare.map((x) => (x._id === I.f1 ? { ...x, system: { ...x.system, controls: [onOther, stale] } } : x));
  const chained = linkFields(a.Scene[0], held, "zz").find((x) => x._id === I.f1).system.controls;
  check("a region of another map stays controlled; one of this map is drawn again", chained, [onOther, `Scene.${I.s}.Region.${I.r1}`]);

  const left = [faction("f1", { system: { seatUuid: `${LIB}.${id16("far")}`, holdings: [{ uuid: `${LIB}.${id16("h1")}` }, { uuid: `Actor.${I.p1}` }] } })];
  check("seats and holdings off the maps are counted", seatsLeft(left), 2);
}

// --- stand-ins a map is rebuilt over ----------------------------------------------------------
{
  // yy's place took zz's row over: it answers for zz.p2 as well as its own id.
  const own = { _id: I.p1, flags: stamp("zz.p1", "kind.location") };
  const later = { _id: I.p2, flags: { [MODULE_ID]: { cookbook: { id: "yy.p9", book: "yy", kind: "kind.location", merged: ["zz.p2"] } } } };
  const rival = { _id: I.p3, flags: stamp("zz.p2", "kind.location") };
  const made = [];
  const standIns = standInsByClaim([own, later, rival], (a) => (made.push(a._id), { id: a._id }));
  check("a stand-in per carried actor", made, [I.p1, I.p2, I.p3]);
  check("a place stands in under its own id", standIns.get("zz.p1")?.id, I.p1);
  check("a place another book took over stands in under the earlier book's id too",
    [standIns.get("yy.p9")?.id, standIns.get("zz.p2")?.id], [I.p2, I.p2]);
  ok("both ids name the one stand-in", standIns.get("yy.p9") === standIns.get("zz.p2"));
  check("the first to claim an id keeps it, and the rival claims none", [standIns.size, [...standIns.values()].some((s) => s.id === I.p3)], [3, false]);
  check("an actor with no stamp stands under no id", standInsByClaim([{ _id: I.n1 }], (a) => a).size, 0);
}

// --- what an import creates: the retired per-map Adventure ------------------------------------
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
  check("in a book's Adventure every document but a folder is a root", [
    isRoot("Actor", content.Actor[0], true), isRoot("RollTable", content.RollTable[0], true),
    isRoot("Actor", content.Actor[8], true), isRoot("Folder", content.Folder[0], true),
  ], [true, true, true, false]);
  check("shelved kinds: a person, a list, a journal, an item; never a place or an organisation", [
    isShelvedKind("Actor", content.Actor[8]), isShelvedKind("RollTable", content.RollTable[0]),
    isShelvedKind("JournalEntry", {}), isShelvedKind("Item", { type: "item" }),
    isShelvedKind("Actor", content.Actor[0]), isShelvedKind("Actor", content.Actor[6]),
  ], [true, true, true, true, false, false]);
}

// --- what an import creates: a book's Adventure ------------------------------------------------
{
  const content = adventure({ book: true });
  const all = keysOf(content);
  const plan = (w, included = all) => fillPlan({ content, book: true, included, ...world(w) });
  const libraryHolds = ["n1", "n2", "n3"].map((t) => k("Actor", t))
    .concat([k("RollTable", "t1"), k("RollTable", "t2"), k("JournalEntry", "j1"), k("Item", "i1"), k("Actor", "p4")]);

  const empty = plan({});
  check("a world and a library with nothing: every document, and every folder something sits in", created(empty),
    [...all].filter((x) => x !== k("Folder", "fu")).sort());

  const fresh = plan({ shelved: libraryHolds });
  check("a fresh world: the maps, the places on them and the organisations; the library keeps the rest", created(fresh), [
    k("Scene", "s"), ...ALL_ACTORS, k("Folder", "fs"), k("Folder", "fa"), k("Folder", "fp"), k("Folder", "ff"),
  ].sort());
  check("what stays in the library is counted", fresh.shelved, libraryHolds.length);
  const occupied = fresh.create.Actor.find((x) => x._id === I.p1);
  check("an occupant the library keeps is pointed at there", occupied.system.roster[0].uuid, `${LIB}.${I.n1}`);

  const noLibraryPlace = plan({ shelved: libraryHolds.filter((x) => x !== k("Actor", "p4")) });
  ok("a place no map shows is created when the library lacks it", created(noLibraryPlace).includes(k("Actor", "p4")));

  const onMap = adventure({ book: true });
  onMap.Scene[0].tokens.push({ _id: id16("tk4"), actorId: I.p4 });
  const placed = fillPlan({ content: onMap, book: true, included: keysOf(onMap), ...world({ shelved: libraryHolds }) });
  ok("a place a carried map shows is created, though the library holds it", created(placed).includes(k("Actor", "p4")));

  // p1 sits in p4, which no map shows; p4 sits in the city.
  const nested = adventure({ book: true });
  nested.Actor.find((x) => x._id === I.p1).system.parentUuid = `Actor.${I.p4}`;
  nested.Actor.find((x) => x._id === I.p4).system.parentUuid = `Actor.${I.city}`;
  const inside = fillPlan({ content: nested, book: true, included: keysOf(nested), ...world({ shelved: libraryHolds }) });
  ok("a place a created place sits in is created, though no map shows it and the library holds it", created(inside).includes(k("Actor", "p4")));
  check("and the place inside it names the copy, not the library's", inside.create.Actor.find((x) => x._id === I.p1).system.parentUuid, `Actor.${I.p4}`);
  check("and it is no longer counted as kept in the library", inside.shelved, libraryHolds.length - 1);
  const outOfScope = fillPlan({ content: nested, book: true, included: new Set([...keysOf(nested)].filter((x) => x !== k("Actor", "p4"))), ...world({ shelved: libraryHolds }) });
  check("a place core left out of the import stays pointed at the library", outOfScope.create.Actor.find((x) => x._id === I.p1).system.parentUuid, `${LIB}.${I.p4}`);
  const heldRoom = fillPlan({
    content: nested, book: true, included: keysOf(nested),
    ...world({ ...sourceWorld(), shelved: libraryHolds, worldDocs: { [k("Actor", "p1")]: nested.Actor.find((x) => x._id === I.p1) } }),
  });
  ok("a place a held place's world version names is created when the world lacks it", created(heldRoom).includes(k("Actor", "p4")));

  const built = plan({ ...sourceWorld(), shelved: libraryHolds });
  check("the world that built it: nothing to add", [built.added, created(built)], [0, []]);

  const journalGone = plan({ ...sourceWorld(), shelved: libraryHolds.filter((x) => x !== k("JournalEntry", "j1")) });
  check("a journal the library lacks comes back on its own", created(journalGone), [k("JournalEntry", "j1")]);
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

// --- folders --------------------------------------------------------------------------------
{
  const worldId = id16("wzz");
  const worldFolderOf = (type, name, parent) => (type === "Actor" && name === "ZZ" && parent === null ? worldId : null);
  const paths = [["Actor", ["ZZ", "Places"]], ["Actor", ["ZZ", "Factions"]], ["Scene", ["ZZ"]], ["Actor", ["ZZ", "Places"]]];
  const f = adventureFolderSources(paths, worldFolderOf, "zz.book");
  check("one folder per type and path", f.sources.map((x) => `${x.type}:${x.name}`), ["Actor:ZZ", "Actor:Places", "Actor:Factions", "Scene:ZZ"]);
  check("a folder the world has keeps its id", f.idOf("Actor", ["ZZ"]), worldId);
  check("its children sit in it", f.sources.filter((x) => x.folder === worldId).map((x) => x.name), ["Places", "Factions"]);
  ok("one name under two types is two folders", f.idOf("Scene", ["ZZ"]) !== f.idOf("Actor", ["ZZ"]));
  check("no path, no folder", f.idOf("Actor", []), null);
  const again = adventureFolderSources(paths, () => null, "zz.book");
  check("a folder the world lacks takes the same id every time", again.idOf("Actor", ["ZZ", "Places"]),
    adventureFolderSources(paths, () => null, "zz.book").idOf("Actor", ["ZZ", "Places"]));
  ok("and a different one for another book", again.idOf("Actor", ["ZZ", "Places"]) !== adventureFolderSources(paths, () => null, "yy.book").idOf("Actor", ["ZZ", "Places"]));
}

// --- staleness and the Judge's edits --------------------------------------------------------------
{
  const a = { _id: "x", actors: [{ _id: "a", name: "A", _stats: { modifiedTime: 1 } }], _stats: { createdTime: 2 } };
  const b = { _id: "x", actors: [{ _id: "a", name: "A", _stats: { modifiedTime: 9 } }], _stats: { createdTime: 7 } };
  check("what a write stamps is not content", withoutStats(a), { _id: "x", actors: [{ _id: "a", name: "A" }] });
  check("so it does not move the hash", sourcesHashOf(a), sourcesHashOf(b));
  ok("content does", sourcesHashOf(a) !== sourcesHashOf({ ...a, actors: [{ _id: "a", name: "B" }] }));

  const at = 1_000_000;
  check("no stored Adventure: written", bookAdventureState({ stamp: null, sourcesHash: "h" }), "absent");
  check("as written, same sources: held", bookAdventureState({ stamp: { sourcesHash: "h", writtenAt: at }, modifiedTime: at, sourcesHash: "h" }), "held");
  check("as written, new sources: rebuilt", bookAdventureState({ stamp: { sourcesHash: "h", writtenAt: at }, modifiedTime: at, sourcesHash: "g" }), "stale");
  check("the stamp's own write is inside the slack", bookAdventureState({ stamp: { sourcesHash: "h", writtenAt: at }, modifiedTime: at + WRITE_SLACK_MS, sourcesHash: "g" }), "stale");
  check("modified after the write: the Judge's, whatever the sources", bookAdventureState({ stamp: { sourcesHash: "h", writtenAt: at }, modifiedTime: at + WRITE_SLACK_MS + 1, sourcesHash: "g" }), "edited");
  check("a stamp with no write time reads as unedited", bookAdventureState({ stamp: { sourcesHash: "h" }, modifiedTime: at * 9, sourcesHash: "h" }), "held");

  const rows = [
    { _id: "1", flags: stamp("zz.map.adventure", SETTLEMENT_ADVENTURE_KIND) },
    { _id: "2", flags: stamp("zz.book", BOOK_ADVENTURE_KIND) },
    { _id: "3", flags: { [MODULE_ID]: { cookbook: { id: "yy.map.adventure", book: "yy", kind: SETTLEMENT_ADVENTURE_KIND } } } },
    { _id: "4", flags: {} },
  ];
  check("a book's retired per-map Adventures, and nothing else", legacyAdventuresOf(rows, "zz").map((r) => r._id), ["1"]);
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
  const steer = read("scripts/importer/book-adventure.mjs");
  for (const decl of ["function steerImport(", "function fillImport(", "function worldLookups("]) {
    const text = body(steer, decl);
    ok(`${decl} is still the name of what this pins`, text.length > 0);
    // Core does not await a hook: a promise here leaves core's lists whole
    // and sends the import into its overwrite.
    ok(`${decl} never awaits`, !/\basync\b|\bawait\b|\.then\(/.test(text), decl);
  }
  const steerBody = body(steer, "function steerImport(");
  ok("the import hook cancels on failure", /catch \(err\) \{[\s\S]*?return false;/.test(steerBody));
  // A cold shelf answers every library lookup with nothing.
  ok("a cold library cancels the import before the fill", /if \(libraryCold\(\)\) \{[\s\S]*?return false;/.test(steerBody) &&
    steerBody.indexOf("libraryCold()") < steerBody.indexOf("fillImport("));
  ok("both hooks are registered", steer.includes('Hooks.on("preImportAdventure", steerImport)') && steer.includes('Hooks.on("importAdventure", afterImport)'));
  // Core awaits prepareImport and calls the hook straight after it, so the
  // wait goes there; the hook's own refusal stays for a shelf that never loads.
  const wait = body(steer, "async function warmBeforePrepare(");
  ok("the import waits for a cold library before core lists its documents, a cookbook Adventure's alone",
    /isCookbookAdventure\(this\) && libraryCold\(\)/.test(wait) && wait.indexOf("await warmLibrary()") > 0 && wait.indexOf("await warmLibrary()") < wait.indexOf("return wrapped("));
  ok("the wait is bounded", /for \(let n = 0; n < WARM_TRIES && libraryCold\(\); n\+\+\)/.test(wait) && /const WARM_TRIES = \d+;/.test(steer));
  ok("the wait always calls through, once, last", /\n {2}return wrapped\(\.\.\.args\);\n\}\n?$/.test(wait) && wait.split("wrapped(").length === 2);
  const wrap = body(steer, "function wrapPrepareImport(");
  ok("prepareImport is wrapped through libWrapper, with a fallback", wrap.includes('"CONFIG.Adventure.documentClass.prototype.prepareImport", warmBeforePrepare, "WRAPPER"') && wrap.includes("proto.prepareImport = function"));
  ok("the wrap registers with the hooks", body(steer, "export function registerBookAdventureHooks(").includes("wrapPrepareImport();"));
  const after = body(steer, "function afterImport(");
  ok("an import runs the link pass once its maps are mirrored", after.indexOf("cookbookImportLinks(") > after.indexOf("mirrorCreatedLinks(") && after.includes("mirrorCreatedLinks("));
  ok("a book's Adventure fills as one", /book = kindOf\(adventure\) === BOOK_ADVENTURE_KIND/.test(body(steer, "function fillImport(")));

  const cookbook = read("scripts/importer/cookbook.mjs");
  const scene = body(cookbook, "async function importScene(");
  ok("the map step writes no Adventure", scene.length > 0 && !/Adventure/.test(scene));
  ok("the made map is built by mapCreateData", scene.includes("mapCreateData(") && !scene.includes("districtRegionData("));
  const source = body(cookbook, "async function bookAdventureSource(");
  ok("the Adventure's maps are built by the same code, on the same plan", ["mapCreateData(", "gridScenePlan(", "withWorldIds("].every((s) => source.includes(s)));
  ok("the Adventure lays its ways on its own scenes before their references are rewritten",
    source.includes("withAdventureLinks(") && source.indexOf("withAdventureLinks(") < source.indexOf('adventureRefs("Scene"'));
  const ensure = body(cookbook, "async function ensureBookAdventure(");
  ok("a failed Adventure is counted, never thrown at the run", /catch \(err\) \{\s*counts\.failed\+\+/.test(ensure));
  const tryPart = ensure.slice(0, ensure.indexOf("} catch"));
  ok("the retired Adventures go only once the book's stands", tryPart.indexOf("retireMapAdventures(") > tryPart.indexOf("writeAdventure("));
  ok("a write records its own time", /writtenAt/.test(tryPart));

  const binding = read("scripts/importer/adventure-binding.mjs");
  ok("the binding stays Foundry-free", !/\bgame\.|\bfoundry\.|\bHooks\./.test(binding));

  const boot = read("scripts/importer/module.mjs");
  const guard = boot.indexOf("legacyImporterActive()) {");
  const hooks = boot.indexOf("registerBookAdventureHooks();");
  ok("the import hooks register after the legacy guard", guard > 0 && hooks > guard);

  const steps = read("scripts/importer/getting-started.mjs");
  const chain = steps.slice(steps.indexOf("const GM_STEPS = ["), steps.indexOf("\n];", steps.indexOf("const GM_STEPS = [")));
  check("the import chain closes on the adventures step", [...chain.matchAll(/\["(step\w+)"/g)].at(-1)?.[1], "stepAdventures");

  const lang = JSON.parse(read("lang/en.json"));
  const keys = [
    ...["caption", "intro", "contents", "fillRule", "resetRule", "seatsLeft", "filled", "nothingToAdd", "fillFailed", "libraryLoading", "libraryWarming"]
      .map((x) => `adventure.${x}`),
    ...["Written", "Rebuilt", "Kept", "Held", "Empty", "Retired", "Failed"].map((x) => `ui.adventures${x}`),
    "ui.progressAdventures", "gs.stepAdventures", "ui.booksAdventure", "ui.booksAdventureHeld", "ui.booksAdventureNone", "ui.booksAdventureLegacy",
  ];
  for (const key of keys) ok(`lang has ACKS-IMPORTER.${key}`, typeof lang[`ACKS-IMPORTER.${key}`] === "string");
}

if (failed) {
  console.error(`\nbook-adventure: ${failed} failure(s)`);
  process.exit(1);
}
console.error("book-adventure: OK");
