/**
 * A book's numbered scenarios, each printed as one picture: the register
 * rules that hold between their rows, the shipped rows' structure, and an
 * invented scenario imported end to end against mocked Foundry, its picture
 * read seeded instead of made.
 *
 * The invented book is `zz`; every heading, sentence and creature in it is
 * made up. The shipped rows are checked by id, kind and shape alone: no
 * printed word or figure appears here. No PDF and no engine.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODULE_ID, LANG_PREFIX } from "../../scripts/importer/constants.mjs";
import { REGISTRY } from "../../scripts/importer/books.mjs";
import { printKey } from "../../scripts/importer/printed-name.mjs";
import { keySpacesOf, isKeyedPlace, keyedParentId, adventurePlaceId } from "../../scripts/importer/poi-binding.mjs";
import { libraryPackLabel } from "../../scripts/lib/library.mjs";
import { seedPictureRead, pictureReadFor, readBoxReads } from "../../scripts/importer/picture-text.mjs";
import { data, lineOf, initCookbook } from "../../scripts/importer/cookbook/state.mjs";
import { journalBound, cookbookImportPoiPlaces } from "../../scripts/importer/cookbook/adventure-places.mjs";
import { rosterLinkRows } from "../../scripts/importer/cookbook/roster-links.mjs";
import { cookbookSource } from "./cookbook-source.mjs";
import { scenarioProblems, rosterProblems } from "./scenario-rules.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

let n = 0;
const t = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok - ${name}`);
};

/* ------------------------------------------------- the rules, invented rows */

/** An invented scenario's rows: a space, three areas (one a part of another), an NPC and a plan. */
const inventedRows = () => {
  const loc = (id, meta) => ({ id, kind: "kind.location", book: "zz", meta: { group: "Scenario 1", ...meta } });
  return new Map([
    loc("zz.scenario1", {}),
    loc("zz.scenario1-1", { space: "zz.scenario1" }),
    loc("zz.scenario1-2", { space: "zz.scenario1", roster: ["zz.scenario1-npc1", "mm.wisp"] }),
    loc("zz.scenario1-2a", { space: "zz.scenario1", parent: "zz.scenario1-2" }),
    { id: "zz.scenario1-npc1", kind: "kind.npc", book: "zz", meta: { group: "Scenario 1" } },
    { id: "mm.wisp", kind: "kind.monster", book: "mm" },
    { id: "zz.table1", kind: "kind.rolltable", book: "zz" },
    {
      id: "zz.scenario1Map", kind: "kind.scene", book: "zz",
      scene: { place: "zz.scenario1", places: [{ id: "zz.scenario1-1", at: [1, 1] }, { id: "zz.scenario1-2", at: [2, 2] }] },
    },
  ].map((r) => [r.id, r]));
};
/** The invented rows with one row changed (`null` drops it). */
const changed = (id, change) => {
  const rows = inventedRows();
  if (change === null) rows.delete(id);
  else rows.set(id, change(structuredClone(rows.get(id))));
  return rows;
};
const one = (problems, pattern) => {
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0], pattern);
};

await t("a scenario with a plan, grouped rows and a part reached through its room has no problem", () => {
  assert.deepEqual(scenarioProblems(inventedRows()), []);
  assert.deepEqual(rosterProblems(inventedRows()), []);
});

await t("a scenario row without its group is refused, space or area or person", () => {
  for (const id of ["zz.scenario1", "zz.scenario1-1", "zz.scenario1-npc1"]) {
    one(scenarioProblems(changed(id, (r) => ({ ...r, meta: { ...r.meta, group: undefined } }))), /carries meta\.group "Scenario 1"/);
  }
  one(scenarioProblems(changed("zz.scenario1-1", (r) => ({ ...r, meta: { ...r.meta, group: "Scenario 2" } }))), /carries meta\.group "Scenario 1"/);
});

await t("a scenario with no plan, or two, is refused", () => {
  one(scenarioProblems(changed("zz.scenario1Map", null)), /has one plan.*found 0/);
  const two = inventedRows();
  two.set("zz.other", { ...structuredClone(two.get("zz.scenario1Map")), id: "zz.other" });
  one(scenarioProblems(two), /has one plan.*found 2/);
});

await t("a part stands beside the plan: it is no second plan, its pins count, and parts alone are no plan", () => {
  const parted = changed("zz.scenario1Map", (r) => ({ ...r, scene: { ...r.scene, places: [r.scene.places[0]] } }));
  const rest = inventedRows().get("zz.scenario1Map").scene.places.slice(1);
  parted.set("zz.scenario1MapB", { id: "zz.scenario1MapB", kind: "kind.scene", scene: { place: "zz.scenario1", part: 2, places: rest } });
  assert.deepEqual(scenarioProblems(parted), []);
  const stray = structuredClone(parted);
  stray.get("zz.scenario1MapB").scene.places.push({ id: "zz.elsewhere", at: [1, 1] });
  one(scenarioProblems(stray), /^zz\.scenario1MapB: pins zz\.elsewhere, which is no area of zz\.scenario1$/);
  const partsOnly = changed("zz.scenario1Map", (r) => ({ ...r, scene: { ...r.scene, part: 1 } }));
  one(scenarioProblems(partsOnly), /has one plan.*found 0/);
});

await t("a scenario no area names is no key space, and an area outside its scenario's space is refused", () => {
  const bare = new Map([["zz.scenario1", inventedRows().get("zz.scenario1")], ["zz.scenario1Map", { id: "zz.scenario1Map", kind: "kind.scene", scene: { place: "zz.scenario1", places: [] } }]]);
  one(scenarioProblems(bare), /no area names it/);
  const strayed = scenarioProblems(changed("zz.scenario1-1", (r) => ({ ...r, meta: { ...r.meta, space: undefined } })));
  assert.ok(strayed.some((p) => /sits in its key space/.test(p)), strayed.join("\n"));
});

await t("an area off its plan is refused unless the room it is part of is pinned", () => {
  const unpinned = changed("zz.scenario1Map", (r) => ({ ...r, scene: { ...r.scene, places: [r.scene.places[0]] } }));
  const problems = scenarioProblems(unpinned);
  assert.deepEqual(problems.map((p) => p.split(":")[0]).sort(), ["zz.scenario1-2", "zz.scenario1-2a"]);
  assert.ok(problems.every((p) => /is not on its plan zz\.scenario1Map/.test(p)));
});

await t("a pin on a row outside the scenario is refused", () => {
  one(scenarioProblems(changed("zz.scenario1Map", (r) => ({ ...r, scene: { ...r.scene, places: [...r.scene.places, { id: "zz.table1", at: [3, 3] }] } }))),
    /pins zz\.table1, which is no area of zz\.scenario1/);
});

await t("a roster link names a row that is a creature or a person, once, from a keyed place", () => {
  const roster = (list) => changed("zz.scenario1-2", (r) => ({ ...r, meta: { ...r.meta, roster: list } }));
  one(rosterProblems(roster(["zz.nobody"])), /names "zz\.nobody", which no row defines/);
  one(rosterProblems(roster(["zz.table1"])), /zz\.table1, which is not a creature or a person/);
  one(rosterProblems(roster(["mm.wisp", "mm.wisp"])), /names mm\.wisp twice/);
  one(rosterProblems(roster([])), /a list of cookbook ids, at least one/);
  one(rosterProblems(roster("mm.wisp")), /a list of cookbook ids/);
  one(rosterProblems(changed("zz.scenario1-npc1", (r) => ({ ...r, meta: { ...r.meta, roster: ["mm.wisp"] } }))), /belongs on a keyed place/);
  // A row with no kind is a monster of the first books' shape.
  assert.deepEqual(rosterProblems(changed("mm.wisp", (r) => ({ id: r.id, book: r.book }))), []);
});

/* ------------------------------------------------ the shipped rows' structure */

const JJ = JSON.parse(fs.readFileSync(path.join(ROOT, "cookbook", "jj.json"), "utf8"));
const jjSpaces = keySpacesOf(JJ.entries);
const scenarioIds = Object.keys(JJ.entries).filter((id) => /^jj\.scenario\d/.test(id) && JJ.entries[id].kind === "kind.location");
const spaceIds = scenarioIds.filter((id) => /^jj\.scenario\d+$/.test(id));
const npcIds = Object.keys(JJ.entries).filter((id) => /^jj\.scenario\d/.test(id) && JJ.entries[id].kind === "kind.npc");

await t("the book is the Judge's, so its own rows file on the Judge's line and it has an Adventure", () => {
  assert.equal(REGISTRY.jj.judge, true);
  assert.notEqual(lineOf("jj"), lineOf("rr"));
});

await t("the shipped scenarios pass the rules: nine key spaces, each with its plan and every area on it", () => {
  const rows = new Map();
  for (const [id, e] of Object.entries(JJ.entries)) rows.set(id, { id, ...e });
  for (const [id, e] of Object.entries(JJ.scenes ?? {})) rows.set(id, { id, ...e });
  assert.deepEqual(scenarioProblems(rows), []);
  assert.deepEqual(spaceIds, [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `jj.scenario${i}`));
  assert.deepEqual([...jjSpaces].sort(), spaceIds);
  assert.equal(scenarioIds.length - spaceIds.length, 68);
});

await t("every shipped roster link resolves to a creature or a person, and every scenario's people are linked from a place", () => {
  const MM = JSON.parse(fs.readFileSync(path.join(ROOT, "cookbook", "mm.json"), "utf8"));
  const rows = new Map();
  for (const book of [MM, JJ]) for (const [id, e] of Object.entries(book.entries)) rows.set(id, { id, ...e });
  for (const [id, e] of Object.entries(JJ.scenes ?? {})) rows.set(id, { id, ...e });
  assert.deepEqual(rosterProblems(rows), []);
  const linked = scenarioIds.flatMap((id) => JJ.entries[id].meta?.roster ?? []);
  assert.ok(linked.length > 0, "the scenarios carry roster links");
  for (const id of linked) assert.ok(rows.has(id), `${id} resolves`);
  for (const id of npcIds) assert.ok(linked.includes(id), `${id} is on some place's roster`);
});

await t("each scenario stat block is an NPC row in its scenario's group, read through its page's picture by hash and stat line", () => {
  assert.ok(npcIds.length > 0);
  for (const id of npcIds) {
    const { fields, pages, meta } = JJ.entries[id];
    const n = /^jj\.scenario(\d+)-npc\d+$/.exec(id);
    assert.ok(n, id);
    assert.equal(meta.group, `Scenario ${n[1]}`, id);
    assert.deepEqual(Object.keys(fields).sort(), ["name", "statline"], id);
    for (const f of Object.values(fields)) {
      assert.equal(f.op, "ocr", id);
      assert.equal(f.page, pages[0], id);
    }
    assert.equal(fields.name.then.op, "heading", id);
    assert.equal(typeof fields.name.then.hash, "string", id);
    assert.equal(fields.name.then.text, undefined, id);
    assert.equal(fields.statline.then.op, "value", id);
    assert.equal(fields.statline.then.pattern, "statline", id);
  }
});

await t("every scenario row binds as a keyed place and none as a journal page", () => {
  for (const id of scenarioIds) {
    const e = JJ.entries[id];
    assert.ok(isKeyedPlace(e, id, jjSpaces), `${id} is a keyed place`);
    assert.equal(journalBound(e, id, jjSpaces), false, `${id} is no journal page`);
    const parent = keyedParentId(e, "jj");
    assert.ok(parent === adventurePlaceId("jj") ? spaceIds.includes(id) : !!JJ.entries[parent], `${id} sits in a place that exists`);
  }
});

await t("every scenario row reads its heading and its text through its page's picture", () => {
  for (const id of scenarioIds) {
    const { fields, pages } = JJ.entries[id];
    assert.deepEqual(Object.keys(fields), ["name", "description"], id);
    for (const f of Object.values(fields)) {
      assert.equal(f.op, "ocr", id);
      assert.equal(f.page, pages[0], id);
      assert.ok(JJ.pictures[f.page], `${id}: p.${f.page} has a picture recipe`);
    }
    assert.equal(fields.name.then.op, "heading", id);
    assert.equal(fields.description.then.op, "text", id);
    const by = fields.name.then;
    // A space is found by the hash of its heading, an area by its key number or a hash: never by printed words.
    if (spaceIds.includes(id)) assert.equal(typeof by.hash, "string", id);
    else assert.ok(by.number !== undefined || by.hash !== undefined, id);
    assert.equal(by.text, undefined, id);
  }
});

/* ------------------------------------------ the read's progress, box by box */

await t("readBoxReads reports each box as it is read", async () => {
  const reader = { readBox: async () => ({ origin: [0, 0], lines: [] }) };
  const seen = [];
  const box = { x0: 0, x1: 10, y0: 0, y1: 10 };
  await readBoxReads(reader, { k: 2 }, { read: [{ box, psm: 3 }, { box, psm: 6 }, { box, psm: 3 }] }, (done) => seen.push(done));
  assert.deepEqual(seen, [1, 2, 3]);
});

await t("a real read shows no bar where there are no notifications, and a failed one clears the bar it opened", async () => {
  const picture = { size: { w: 10, h: 10 }, read: [{ box: { x0: 0, x1: 10, y0: 0, y1: 10 }, psm: 3 }, { box: { x0: 0, x1: 10, y0: 0, y1: 10 }, psm: 3 }], corrections: [] };
  const noBytes = () => ({ getData: async () => { throw new Error("no bytes"); } });
  assert.equal(globalThis.ui, undefined);
  await assert.rejects(pictureReadFor(noBytes(), 7, picture), /no bytes/);

  const painted = [];
  const opened = [];
  // Notifications with no strings to label a bar from: none opens, and the read fails as itself.
  globalThis.ui = { notifications: { info: (label) => (opened.push(label), { update: () => {} }) } };
  try {
    await assert.rejects(pictureReadFor(noBytes(), 7, picture), /no bytes/);
    assert.deepEqual(opened, []);
  } finally {
    delete globalThis.ui;
  }
  globalThis.ui = { notifications: { info: (label, opts) => (opened.push([label, opts.progress]), { update: (u) => painted.push(u) }) } };
  globalThis.game = { i18n: { format: (k, d) => `${k}|${JSON.stringify(d)}` } };
  try {
    await assert.rejects(pictureReadFor(noBytes(), 7, picture), /no bytes/);
    assert.deepEqual(opened, [[`${LANG_PREFIX}.ui.progressPictureText|{"page":7}`, true]]);
    assert.equal(painted.at(-1).pct, 1);
    // A seeded page is no real read: nothing opens.
    const doc = {};
    seedPictureRead(doc, 7, picture, [{ box: picture.read[0].box, psm: 3, origin: [0, 0], k: 2, lines: [] }, { box: picture.read[1].box, psm: 3, origin: [0, 0], k: 2, lines: [] }]);
    await pictureReadFor(doc, 7, picture);
    assert.equal(opened.length, 1);
  } finally {
    delete globalThis.ui;
    delete globalThis.game;
  }
});

await t("the label names the page and the key exists", () => {
  const lang = JSON.parse(fs.readFileSync(path.join(ROOT, "lang", "en.json"), "utf8"));
  assert.match(lang[`${LANG_PREFIX}.ui.progressPictureText`], /\{page\}/);
  assert.match(lang[`${LANG_PREFIX}.ui.poiRosterWaiting`], /\{n\}/);
});

/* ---------------------------------- an invented scenario, imported end to end */

/** Foundry's Collection: a Map whose iteration yields values. */
class Coll extends Map {
  *[Symbol.iterator]() {
    yield* this.values();
  }
  find(fn) {
    for (const v of this.values()) if (fn(v)) return v;
    return undefined;
  }
  filter(fn) {
    return [...this.values()].filter(fn);
  }
  map(fn) {
    return [...this.values()].map(fn);
  }
}

let serial = 0;
const id16 = (tag) => `${tag}${String(++serial)}`.padEnd(16, "0").slice(0, 16);
const setPath = (obj, dotted, value) => {
  const keys = dotted.split(".");
  let at = obj;
  for (const k of keys.slice(0, -1)) at = at[k] ??= {};
  at[keys.at(-1)] = value;
};

class MockActor {
  static documentName = "Actor";
  static async create(source, { pack } = {}) {
    const actor = new MockActor({ ...source, _id: source._id ?? id16("ac") }, pack ?? null);
    if (pack) game.packs.get(pack).docs.set(actor.id, actor);
    else game.actors.set(actor.id, actor);
    return actor;
  }
  constructor(source, pack) {
    Object.assign(this, structuredClone(source));
    this.id = source._id;
    this.pack = pack;
    this.uuid = pack ? `Compendium.${pack}.Actor.${this.id}` : `Actor.${this.id}`;
    this.system ??= {};
  }
  getFlag(scope, key) {
    return this.flags?.[scope]?.[key];
  }
  async update(patch) {
    for (const [k, v] of Object.entries(patch)) setPath(this, k, v);
    return this;
  }
  toObject() {
    const { pack: _p, uuid: _u, id: _i, ...rest } = this;
    return structuredClone({ ...rest, _id: this.id });
  }
}

class MockPack {
  constructor(collection, label) {
    this.collection = collection;
    this.documentName = "Actor";
    this.metadata = { packageType: "world", label, type: "Actor" };
    this.docs = new Coll();
    this.folders = new Coll();
  }
  get index() {
    return new Coll(this.docs.map((d) => [d.id, { _id: d.id, type: d.type, flags: d.flags }]));
  }
  async getIndex() {
    return this.index;
  }
  async getDocument(id) {
    return this.docs.get(id) ?? null;
  }
  async getDocuments() {
    return [...this.docs.values()];
  }
}

const col = (x0, x1, y0, y1) => ({ x0, x1, y0, y1 });
const line = (text, x0, y0, x1, y1) => ({ bbox: { x0, y0, x1, y1 }, words: text.split(" ") });
const PICTURE = { size: { w: 400, h: 400 }, read: [{ box: col(0, 400, 0, 400), psm: 3 }], corrections: [{ box: 0, find: "teh", to: "the", hits: 1, pile: "a" }] };
const READS = [{
  box: PICTURE.read[0].box, psm: 3, origin: [0, 0], k: 2,
  lines: [
    line("Reed Hollow", 20, 20, 200, 40),
    line("A damp cave under teh hill.", 20, 60, 300, 80),
    line("1 Mossy Hall", 20, 120, 200, 140),
    line("A cold room with a low door.", 20, 160, 300, 180),
    line("2 Fern Stair", 20, 220, 200, 240),
    line("Steps going down.", 20, 260, 200, 280),
  ],
}];
const read = (heading, y) => ({
  name: { op: "ocr", page: 7, then: { op: "heading", box: col(0, 400, y, y + 25), ...heading } },
  description: { op: "ocr", page: 7, then: { op: "text", paras: [{ box: col(0, 400, y + 25, y + 50) }] } },
});
const place = (name, meta, fields) => ({ kind: "kind.location", name, cite: "ZZ p.1", pages: [7], meta: { group: "Scenario 1", ...meta }, fields });
const BOOK = {
  schema: "acks-cookbook/2",
  book: { id: "zz" },
  pictures: { 7: PICTURE },
  entries: {
    // The areas are listed ahead of their space: a place asks for the one it sits in first.
    "zz.scenario1-2": place("Scenario 1 2", { space: "zz.scenario1", roster: ["zz.scenario1-npc2"] }, read({ number: "2" }, 100)),
    "zz.scenario1-1": place("Scenario 1 1", { space: "zz.scenario1", roster: ["zz.scenario1-npc1", "zz.scenario1-npc2"] }, read({ number: "1" }, 50)),
    "zz.scenario1": place("Scenario 1", {}, read({ hash: printKey("Reed Hollow") }, 0)),
    "zz.scenario1-npc1": { kind: "kind.npc", name: "Scenario 1 NPC 1", cite: "ZZ p.1", pages: [7], meta: { group: "Scenario 1" }, fields: {} },
    "zz.scenario1-npc2": { kind: "kind.npc", name: "Scenario 1 NPC 2", cite: "ZZ p.1", pages: [7], meta: { group: "Scenario 1" }, fields: {} },
  },
};

const notices = [];
const PACK = "world.zz-actors";
const pack = new MockPack(PACK, libraryPackLabel("Actor", lineOf("zz")));
globalThis.ui = { notifications: { info: (m) => void notices.push(["info", m]), warn: (m) => void notices.push(["warn", m]), error: (m) => void notices.push(["error", m]) } };
globalThis.game = {
  user: { isGM: true },
  i18n: { localize: (k) => k, format: (k, d) => `${k}|${JSON.stringify(d)}` },
  settings: { get: () => undefined },
  actors: new Coll(),
  items: new Coll(),
  journal: new Coll(),
  tables: new Coll(),
  scenes: new Coll(),
  folders: new Coll(),
  packs: new Coll([[PACK, pack]]),
};
globalThis.Actor = MockActor;
globalThis.Folder = {
  async create(source, { pack: into } = {}) {
    const folder = { ...source, id: id16("fo"), folder: source.folder ? { id: source.folder } : null };
    (into ? game.packs.get(into).folders : game.folders).set(folder.id, folder);
    return folder;
  },
};
globalThis.fromUuid = async () => null;
globalThis.foundry = { utils: {} };

const doc = {};
seedPictureRead(doc, 7, PICTURE, READS);
data.books.clear();
data.books.set("zz", BOOK);
data.registers = { tables: {}, nodes: {} };
initCookbook({ sessionDocs: new Map([["zz", { doc }]]) });

const held = (id) => pack.docs.find((a) => a.flags?.[MODULE_ID]?.cookbook?.id === id);
/** A document's folder path inside the pack, root first. */
const folderPath = (actor) => {
  const names = [];
  for (let f = pack.folders.get(actor.folder); f; f = f.folder ? pack.folders.get(f.folder.id) : null) names.unshift(f.name);
  return names;
};
const warden = await MockActor.create({
  name: "Warden", type: "monster", flags: { [MODULE_ID]: { cookbook: { id: "zz.scenario1-npc1", book: "zz", kind: "kind.npc" } } },
}, { pack: PACK });

const first = await cookbookImportPoiPlaces({ books: ["zz"] });

await t("the invented scenario's rules hold, so the import below runs rows the lint would pass", () => {
  const rows = new Map(Object.entries(BOOK.entries).map(([id, e]) => [id, { id, ...e }]));
  rows.set("zz.scenario1Map", { id: "zz.scenario1Map", kind: "kind.scene", scene: { place: "zz.scenario1", places: [{ id: "zz.scenario1-1", at: [1, 1] }, { id: "zz.scenario1-2", at: [2, 2] }] } });
  assert.deepEqual([...scenarioProblems(rows), ...rosterProblems(rows)], []);
});

await t("the space and its areas are places, named by the headings the picture's text prints", () => {
  assert.equal(first.made, 3, JSON.stringify({ first, notices }));
  assert.equal(first.refused, 0);
  assert.equal(held("zz.scenario1").name, "Reed Hollow");
  assert.equal(held("zz.scenario1-1").name, "1 Mossy Hall");
  assert.equal(held("zz.scenario1-2").name, "2 Fern Stair");
  assert.match(held("zz.scenario1").system.notes, /A damp cave under the hill\./);
  assert.match(held("zz.scenario1-1").system.notes, /A cold room with a low door\./);
  assert.doesNotMatch(held("zz.scenario1-1").system.notes, /Steps going down/);
});

await t("an area sits in its space, and the space in the book's own place", () => {
  const bookPlace = held(adventurePlaceId("zz"));
  assert.ok(bookPlace);
  assert.equal(held("zz.scenario1").system.parentUuid, bookPlace.uuid);
  assert.equal(held("zz.scenario1-1").system.parentUuid, held("zz.scenario1").uuid);
  assert.equal(held("zz.scenario1-2").system.parentUuid, held("zz.scenario1").uuid);
});

await t("a scenario's places file under its group, beside the book's places", () => {
  for (const id of ["zz.scenario1", "zz.scenario1-1", "zz.scenario1-2"]) assert.deepEqual(folderPath(held(id)), ["zz", "Scenario 1"], id);
  assert.deepEqual(folderPath(held(adventurePlaceId("zz"))), ["zz", "Places"]);
});

await t("a roster link the library answers is one hidden row with no count and no notes; one it does not waits", () => {
  assert.deepEqual(held("zz.scenario1-1").system.roster, [
    { uuid: warden.uuid, name: "Warden", img: "", kind: held("zz.scenario1-1").system.roster[0]?.kind, quantity: 1, ownerUuid: "", notes: "", hidden: true },
  ]);
  assert.deepEqual(held("zz.scenario1-2").system.roster ?? [], []);
  assert.deepEqual(held("zz.scenario1").system.roster ?? [], []);
  assert.equal(first.rostered, 1);
  assert.equal(first.rosterWaiting, 2);
  const said = notices.filter(([level]) => level === "info").at(-1)[1];
  assert.match(said, new RegExp(`${LANG_PREFIX}\\.ui\\.poiRosterWaiting\\|\\{"n":2\\}`));
});

await t("a second run finds every place held and makes nothing", async () => {
  const before = pack.docs.size;
  const again = await cookbookImportPoiPlaces({ books: ["zz"] });
  assert.equal(again.made, 0);
  assert.equal(again.already, 3);
  assert.equal(again.rosterWaiting, 0);
  assert.equal(pack.docs.size, before);
});

await t("roster links add no actor twice, whether a stat line or an earlier link gave it", async () => {
  const tally = { rostered: 0 };
  const entry = { meta: { roster: ["zz.scenario1-npc1", "zz.scenario1-npc1"] } };
  assert.equal((await rosterLinkRows(entry, [], tally)).length, 1);
  assert.deepEqual(await rosterLinkRows(entry, [{ uuid: warden.uuid }], tally), []);
  assert.deepEqual(tally, { rostered: 1 });
  assert.deepEqual(await rosterLinkRows({ meta: {} }, [], tally), []);
  assert.deepEqual(await rosterLinkRows(undefined, [], tally), []);
});

await t("a world copy answers no roster link: the row names the library's own creature", async () => {
  const copy = await MockActor.create({
    name: "Copy", type: "monster", flags: { [MODULE_ID]: { worldCopy: true, cookbook: { id: "zz.scenario1-npc2", book: "zz", kind: "kind.npc" } } },
  });
  const tally = {};
  assert.deepEqual(await rosterLinkRows({ meta: { roster: ["zz.scenario1-npc2"] } }, [], tally), []);
  assert.deepEqual(tally, { rosterWaiting: 1 });
  game.actors.delete(copy.id);
});

await t("the keyed roster takes its links after its stat lines, and the place files by its row's group", () => {
  const src = cookbookSource();
  const at = src.indexOf("async function keyedOccupantRows");
  const body = src.slice(at, src.indexOf("async function statLineCreature", at));
  assert.ok(at > 0 && body.indexOf("occupantsOf(node.fields)") < body.indexOf("rosterLinkRows(") && body.indexOf("rosterLinkRows(") < body.lastIndexOf("return rows;"));
  const keyed = src.slice(src.indexOf("async function importKeyedPlace"));
  assert.match(keyed.slice(0, 1200), /\[label, e\.meta\?\.group \|\| "Places"\]/);
});

console.log(`\n${n} checks passed`);
