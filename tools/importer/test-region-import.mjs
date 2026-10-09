/**
 * A region's map and its zones, imported end to end against mocked Foundry.
 *
 * What this guards is a region a Judge would otherwise meet broken: a hex map
 * whose drawn cells sit between Foundry's, a site token on a second copy of a
 * market instead of the market, a zone laid twice over one map, a zone that
 * waits forever for a map from a book that was never opened, and a city map
 * whose creation data quietly changed because a region learned to be built.
 *
 * Every book, id, outline and figure here is invented (books `zz`, `yy`,
 * `xx`); no printed word or number appears. The mocks are Collection-SHAPED
 * (values iterate, `find`/`filter`/`some` over a Map) and the hex lattice is a
 * real offset-column lattice, so the code under test asks the questions it
 * asks live: `clone`, `getDimensions`, `getCenterPoint`, `getOffsetRange`,
 * `getVertices`. The PDF is two pages built in memory: an image placement for
 * the anchor and three text runs for a zone's figures.
 */
import { readFileSync } from "node:fs";
import { OPS } from "../../vendor/pdfjs/pdf.mjs";
import { MODULE_ID } from "../../scripts/importer/constants.mjs";
import { LOCATION_TYPE } from "../../scripts/location/constants.mjs";
import { DISTRICT_TYPE } from "../../scripts/formation/district-find.mjs";
import { libraryPackLabel } from "../../scripts/lib/library.mjs";
import {
  sceneFrame, sceneData, districtRegionData, placeTokenAt, ringToScene, pointInRing, afterDarkShift, bandOfSection,
} from "../../scripts/importer/scene-binding.mjs";
import {
  initCookbook, loadCookbook, cookbookImportPoiPlaces, cookbookImportScenes, cookbookImportJournals, gridScenePlan, mapCreateData,
  regionSiteClaim, siteBindPatch, forgetImportedIndex, repairHeldMap,
} from "../../scripts/importer/cookbook.mjs";

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
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

/* --- Collection-shaped mocks ------------------------------------------------------------- */

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
  some(fn) {
    return [...this.values()].some(fn);
  }
  map(fn) {
    return [...this.values()].map(fn);
  }
}

let serial = 0;
/** A 16-character invented id. */
const id16 = (tag) => `${tag}${String(++serial)}`.padEnd(16, "0").slice(0, 16);

const getFlag = function (scope, key) {
  return this.flags?.[scope]?.[key];
};
const setPath = (obj, path, value) => {
  const keys = path.split(".");
  let at = obj;
  for (const k of keys.slice(0, -1)) at = at[k] ??= {};
  at[keys.at(-1)] = value;
};
const applyPatch = (doc, patch) => {
  for (const [k, v] of Object.entries(patch)) setPath(doc, k, v);
};

/* --- a hex lattice that answers the way core's does ------------------------------------- */

/**
 * Core's grid types: 0 gridless, 1 square, 2/3 pointy rows (odd/even), 4/5 flat
 * columns (odd/even). A column hex's `size` is its across-flats height and its
 * width is `size · 2/√3`; a row hex is the transpose.
 */
function makeGrid(type = 1, size = 100) {
  const columns = type === 4 || type === 5;
  const rows = type === 2 || type === 3;
  const even = type === 3 || type === 5;
  const hex = columns || rows;
  const sizeX = columns ? (size * 2) / Math.sqrt(3) : size;
  const sizeY = rows ? (size * 2) / Math.sqrt(3) : size;
  const odd = (n) => ((n % 2) + 2) % 2 === 1;
  const centre = ({ i, j }) => {
    if (columns) return { x: j * 0.75 * sizeX + sizeX / 2, y: i * sizeY + sizeY / 2 + (odd(j) !== even ? sizeY / 2 : 0) };
    if (rows) return { x: j * sizeX + sizeX / 2 + (odd(i) !== even ? sizeX / 2 : 0), y: i * 0.75 * sizeY + sizeY / 2 };
    return { x: j * sizeX + sizeX / 2, y: i * sizeY + sizeY / 2 };
  };
  const getOffset = (p) => {
    if (!hex) return { i: Math.floor(p.y / sizeY), j: Math.floor(p.x / sizeX) };
    const i0 = Math.round(p.y / (rows ? 0.75 * sizeY : sizeY));
    const j0 = Math.round(p.x / (columns ? 0.75 * sizeX : sizeX));
    let best = null;
    for (let i = i0 - 2; i <= i0 + 2; i++) {
      for (let j = j0 - 2; j <= j0 + 2; j++) {
        const c = centre({ i, j });
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (!best || d < best.d) best = { i, j, d };
      }
    }
    return { i: best.i, j: best.j };
  };
  return {
    type, size, sizeX, sizeY, isHexagonal: hex,
    getOffset,
    getCenterPoint: (c) => (type === 0 ? { x: c.x, y: c.y } : centre("i" in c ? c : getOffset(c))),
    getOffsetRange: ({ x, y, width, height }) => {
      const corners = [[x, y], [x + width, y], [x, y + height], [x + width, y + height]].map(([px, py]) => getOffset({ x: px, y: py }));
      const is = corners.map((o) => o.i);
      const js = corners.map((o) => o.j);
      return [Math.min(...is) - 1, Math.min(...js) - 1, Math.max(...is) + 2, Math.max(...js) + 2];
    },
    getVertices: ({ i, j }) => {
      const c = centre({ i, j });
      return Array.from({ length: 6 }, (_, k) => {
        const a = (Math.PI / 3) * k + (columns ? 0 : Math.PI / 6);
        return { x: c.x + (sizeX / 2) * Math.cos(a), y: c.y + (sizeY / 2) * Math.sin(a) };
      });
    },
  };
}

/* --- documents -------------------------------------------------------------------------- */

class MockBehavior {
  constructor(data) {
    Object.assign(this, structuredClone(data));
    this.updates = [];
  }
  async update(patch) {
    this.updates.push(patch);
    applyPatch(this, patch);
    return this;
  }
}

class MockRegion {
  constructor(data, scene) {
    Object.assign(this, structuredClone({ ...data, behaviors: undefined }));
    this.id = data._id ?? id16("rg");
    this.uuid = `${scene.uuid}.Region.${this.id}`;
    this.behaviors = new Coll((data.behaviors ?? []).map((b) => [id16("bh"), new MockBehavior(b)]));
  }
  getFlag(scope, key) {
    return getFlag.call(this, scope, key);
  }
}

/** A Scene: saved when it came through `create`, unsaved when `new` or a clone. */
class MockScene {
  static metadata = { defaultLevelId: "defaultLevel0000" };
  static documentName = "Scene";
  static async create(data) {
    const scene = new MockScene(data);
    game.scenes.set(scene.id, scene);
    return scene;
  }
  constructor(data = {}) {
    this.source = structuredClone(data);
    this.id = data._id ?? id16("sc");
    this.uuid = `Scene.${this.id}`;
    this.name = data.name;
    this.flags = this.source.flags ?? {};
    this._stats = this.source._stats ?? {};
    this.width = data.width ?? 4000;
    this.height = data.height ?? 3000;
    this.padding = data.padding ?? 0.25;
    this.shiftX = data.shiftX ?? 0;
    this.shiftY = data.shiftY ?? 0;
    this.grid = makeGrid(data.grid?.type ?? 1, data.grid?.size ?? 100);
    this.thumb = null;
    this.regions = new Coll();
    for (const r of data.regions ?? []) {
      const region = new MockRegion(r, this);
      this.regions.set(region.id, region);
    }
    this.tokens = new Coll((data.tokens ?? []).map((t) => [id16("tk"), t]));
  }
  getFlag(scope, key) {
    return getFlag.call(this, scope, key);
  }
  clone(changes = {}) {
    const data = structuredClone(this.source);
    data._id = this.id;
    for (const [k, v] of Object.entries(changes)) setPath(data, k, v);
    return new MockScene(data);
  }
  getDimensions() {
    const x = Math.round(this.padding * this.width);
    const y = Math.round(this.padding * this.height);
    return {
      sceneX: x - this.shiftX, sceneY: y - this.shiftY, sceneWidth: this.width, sceneHeight: this.height,
      rows: Math.ceil(this.height / this.grid.sizeY), columns: Math.ceil(this.width / this.grid.sizeX),
    };
  }
  get dimensions() {
    return this.getDimensions();
  }
  async createEmbeddedDocuments(type, list) {
    if (type !== "Region") throw new Error(`unexpected ${type}`);
    return list.map((data) => {
      const region = new MockRegion(data, this);
      this.regions.set(region.id, region);
      return region;
    });
  }
  async createThumbnail() {
    return { thumb: null };
  }
}

class MockActor {
  static documentName = "Actor";
  static created = [];
  static async create(data, { pack } = {}) {
    const actor = new MockActor({ ...data, _id: data._id ?? id16("ac") }, pack ?? null);
    if (pack) game.packs.get(pack).put(actor);
    else game.actors.set(actor.id, actor);
    MockActor.created.push(actor);
    return actor;
  }
  static async createDocuments(list) {
    return list.map((data) => {
      const actor = new MockActor(data, null);
      game.actors.set(actor.id, actor);
      return actor;
    });
  }
  static async updateDocuments(list) {
    for (const { _id, ...patch } of list) applyPatch(game.actors.get(_id), patch);
  }
  constructor(data, pack) {
    Object.assign(this, structuredClone(data));
    this.id = data._id;
    this.pack = pack;
    this.uuid = pack ? `Compendium.${pack}.Actor.${this.id}` : `Actor.${this.id}`;
    this.system ??= {};
  }
  getFlag(scope, key) {
    return getFlag.call(this, scope, key);
  }
  async update(patch) {
    applyPatch(this, patch);
    return this;
  }
  toObject() {
    const { pack: _p, uuid: _u, id: _i, ...rest } = this;
    return structuredClone({ ...rest, _id: this.id });
  }
  async getTokenDocument(data) {
    const actorId = this.id;
    return { toObject: () => ({ ...data, actorId }) };
  }
}

class MockPack {
  constructor(collection, type, label) {
    this.collection = collection;
    this.documentName = type;
    this.metadata = { packageType: "world", label, type };
    this.docs = new Coll();
    this.folders = new Coll();
  }
  put(doc) {
    this.docs.set(doc.id, doc);
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
  async getDocuments({ _id__in: ids } = {}) {
    return ids ? ids.map((id) => this.docs.get(id)).filter(Boolean) : [...this.docs.values()];
  }
  has(id) {
    return this.docs.has(id);
  }
  get(id) {
    return this.docs.get(id);
  }
}

const table = (cbId) => {
  const id = id16("tb");
  return { id, uuid: `RollTable.${id}`, flags: { [MODULE_ID]: { cookbook: { id: cbId } } }, results: [{ range: [1, 6] }], formula: "1d6", getFlag };
};

/* --- the books -------------------------------------------------------------------------- */

const SCHEMA = "acks-cookbook/2";
const loc = (group, meta = {}) => ({ kind: "kind.location", name: "Row", cite: "ZZ 1", pages: [2], meta: { group, ...meta }, fields: {} });
/** A zone's figures, boxed on page 2 of the zone's own book. */
const figureFields = {
  target: { op: "value", page: 2, box: { x0: 100, x1: 140, y0: 600, y1: 615 }, pattern: "int" },
  dayThrows: { op: "value", page: 2, box: { x0: 200, x1: 240, y0: 600, y1: 615 }, pattern: "countWord" },
  nightThrows: { op: "value", page: 2, box: { x0: 300, x1: 340, y0: 600, y1: 615 }, pattern: "countWord" },
};
const zoneRow = (zone, fields = figureFields) => ({ kind: "kind.sceneZone", name: "Zone", cite: "ZZ 2", pages: [2], zone: { cadence: "entry", ...zone, fields } });

const GRID = { family: "hexCols", box: { w: (20 * 2) / Math.sqrt(3), h: 20 }, centre: [160, 170], distance: 6, units: "mi", pixels: 100 };
const REGION_MAP = {
  kind: "kind.scene", name: "Map", cite: "ZZ 1", pages: [1],
  scene: {
    page: 1, placement: { x: 50, y: 50, w: 500, h: 400 }, crop: { x: 100, y: 100, w: 300, h: 240 }, turn: 0, grid: GRID,
    places: [{ id: "zz.site1", at: [200, 180] }, { id: "zz.site2", at: [260, 240] }, { id: "zz.site3", at: [320, 300] }],
  },
};
const CITY_RECIPE = {
  page: 1, placement: { x: 0, y: 0, w: 100, h: 100 }, crop: { x: 0, y: 0, w: 100, h: 100 }, turn: 0, feetPerPoint: 10,
  incidents: { table: "xx.t1", band: "r5-6" },
  districts: [{ place: "xx.q1", color: "#336699", special: "xx.t2", outline: [5, 5, 60, 5, 60, 60, 5, 60] }],
  places: [{ id: "xx.p1", at: [20, 20] }],
};
const ZZ_OUTLINE = [180, 160, 260, 160, 260, 240, 180, 240];
const YY_OUTLINE = [300, 250, 380, 250, 380, 330, 300, 330];
const XX_OUTLINE = [10, 10, 50, 10, 50, 50];

const BOOK_FILES = {
  zz: {
    schema: SCHEMA, book: { id: "zz" },
    entries: {
      "zz.region": loc("Region — Overview"),
      "zz.site1": loc("Region — Sites", { market: "mkt3" }),
      "zz.site2": loc("Region — Sites", { place: "adventure" }),
      "zz.site3": loc("Region — Sites"),
      "zz.mkt3": { kind: "kind.marketRecord", name: "Record", cite: "ZZ 3", pages: [3], meta: { market: "mkt3" }, fields: {} },
    },
    scenes: {
      "zz.map": REGION_MAP,
      "zz.zone1": zoneRow({ scene: "zz.map", table: "zz.list1", outline: ZZ_OUTLINE }),
      "zz.zone2": zoneRow({ scene: "xx.city", outline: XX_OUTLINE, cadence: "" }, {}),
    },
  },
  yy: {
    schema: SCHEMA, book: { id: "yy" },
    entries: { "yy.list9": { kind: "kind.rolltable", name: "List", cite: "YY 1", pages: [1], fields: {} } },
    scenes: {
      "yy.zone1": zoneRow({ scene: "zz.map", table: "yy.list9", outline: YY_OUTLINE, cadence: "periods" }),
      "yy.zone2": zoneRow({ scene: "zz.nowhere", outline: YY_OUTLINE }),
    },
  },
  xx: { schema: SCHEMA, book: { id: "xx" }, entries: {}, scenes: { "xx.city": { kind: "kind.scene", name: "City", cite: "XX 1", pages: [1], scene: CITY_RECIPE } } },
};

/** A two-page PDF: the map's image placement on page 1, a zone's three figures on page 2. */
function pdf(figures) {
  const H = 792;
  const run = (str, x, top) => ({ str, transform: [1, 0, 0, 1, x, H - top], width: 20, height: 10, fontName: "F1" });
  const pages = {
    1: { items: [], ops: { fnArray: [OPS.transform, OPS.paintImageXObject], argsArray: [[500, 0, 0, 400, 50, H - 50 - 400], ["img1"]] } },
    2: { items: figures.map(([s, x]) => run(s, x, 608)), ops: { fnArray: [], argsArray: [] } },
  };
  return {
    numPages: 2,
    async getPage(n) {
      const p = pages[n];
      return {
        getViewport: () => ({ width: 612, height: H }),
        getTextContent: async () => ({ items: p.items }),
        getOperatorList: async () => p.ops,
      };
    },
  };
}

/* --- the world -------------------------------------------------------------------------- */

const notices = [];
const ACTOR_PACK = "world.zz-actors";
globalThis.ui = {
  notifications: {
    info: (m) => notices.push(["info", m]),
    warn: (m) => notices.push(["warn", m]),
    error: (m) => notices.push(["error", m]),
  },
};
const packs = new Coll([[ACTOR_PACK, new MockPack(ACTOR_PACK, "Actor", libraryPackLabel("Actor"))]]);
const folders = new Coll();
globalThis.game = {
  user: { isGM: true },
  i18n: { localize: (k) => k, format: (k, d) => `${k}|${JSON.stringify(d)}` },
  settings: { get: () => undefined },
  scenes: new Coll(),
  actors: Object.assign(new Coll(), { fromCompendium: (source) => source }),
  tables: new Coll(),
  items: new Coll(),
  journal: new Coll(),
  folders,
  packs,
};
globalThis.Scene = MockScene;
globalThis.Actor = MockActor;
globalThis.Folder = {
  async create(data, { pack } = {}) {
    const folder = { ...data, id: id16("fo"), uuid: `Folder.${serial}`, folder: data.folder ? { id: data.folder } : null };
    (pack ? game.packs.get(pack).folders : game.folders).set(folder.id, folder);
    return folder;
  },
};
const resolve = (uuid) => {
  const [type, id] = String(uuid ?? "").split(".");
  return { RollTable: game.tables, Actor: game.actors, Scene: game.scenes }[type]?.get(id) ?? null;
};
globalThis.fromUuidSync = resolve;
globalThis.fromUuid = async (uuid) => resolve(uuid);
globalThis.foundry = {
  utils: { fetchJsonWithTimeout: async (url) => fetched(url) },
  documents: { Level: { metadata: { label: "Level" } } },
};
function fetched(url) {
  const name = String(url).split("/").pop().replace(/\.json$/, "");
  if (name === "registers") return { tables: { countWord: { three: 3, five: 5, seven: 7 } } };
  if (name === "index") return { books: Object.keys(BOOK_FILES), content: [] };
  if (BOOK_FILES[name]) return structuredClone(BOOK_FILES[name]);
  throw new Error(`404 ${url}`);
}

const uploads = [];
const sessions = new Map([
  ["zz", { doc: pdf([["11", 110], ["three", 210], ["five", 310]]) }],
  ["yy", { doc: pdf([["9", 110], ["seven", 210], ["3", 310]]) }],
]);
initCookbook({
  sessionDocs: sessions,
  uploadSceneMap: async (doc, id, recipe, opts) => {
    uploads.push({ id, opts });
    return { path: `maps/${id}.webp` };
  },
});
ok("the invented cookbooks load", await loadCookbook());

// --- the claim a region site lands under -----------------------------------------------------
{
  const entries = BOOK_FILES.zz.entries;
  check("a site naming a market lands on its record", regionSiteClaim("zz", entries["zz.site1"], "zz.site1", entries), { claimId: "zz.mkt3", onto: "market" });
  check("a site marked adventure lands on the settlement", regionSiteClaim("zz", entries["zz.site2"], "zz.site2", entries), { claimId: "zz.adventure", onto: "adventure" });
  check("any other site is its own place", regionSiteClaim("zz", entries["zz.site3"], "zz.site3", entries), { claimId: "zz.site3", onto: "site" });
  const toCity = { "zz.mkt4": { meta: { market: "mkt4", place: "adventure" } } };
  check("a market whose record is the settlement takes the site there", regionSiteClaim("zz", { meta: { market: "mkt4" } }, "zz.site9", toCity), { claimId: "zz.adventure", onto: "adventure" });
  check("a bind writes only what the place lacks",
    siteBindPatch({ uuid: "Actor.a", system: { notes: "kept", parentUuid: "", role: "" } }, { notes: "new", parentUuid: "Actor.r", role: "nope" }),
    { "system.parentUuid": "Actor.r" });
  check("a place is never made its own parent", siteBindPatch({ uuid: "Actor.a", system: {} }, { parentUuid: "Actor.a" }), {});
}

// --- the grid plan, on an unsaved scene ------------------------------------------------------
const recipe = REGION_MAP.scene;
{
  const padded = new MockScene({ name: "probe", padding: 0.2 });
  const plan = gridScenePlan(recipe, padded);
  ok("a hex recipe is planned", !!plan);
  const scale = (GRID.pixels / GRID.box.h);
  ok("the scale is the probed cell over the drawn one", near(plan.pixelsPerPoint, scale, 1e-9), `${plan.pixelsPerPoint} vs ${scale}`);
  check("the frame is cut at that scale", [plan.frame.width, plan.frame.height], [Math.round(300 * scale), Math.round(240 * scale)]);
  check("the grid type is the family's", plan.type, 4);
  // The drawn centre, carried to the canvas, is a Foundry cell centre.
  const [cx, cy] = plan.frame.toScene(...GRID.centre);
  const at = { x: plan.origin.x + cx, y: plan.origin.y + cy };
  const lattice = makeGrid(4, GRID.pixels).getCenterPoint(at);
  ok("a drawn centre lands on a Foundry centre", near(lattice.x, at.x, 1) && near(lattice.y, at.y, 1), JSON.stringify({ at, lattice }));
  ok("the padded origin is carried", plan.origin.x === Math.round(0.2 * plan.frame.width) - plan.shiftX);

  const skew = { ...recipe, grid: { ...GRID, box: { w: 20, h: 20 } } };
  check("a probe whose axes disagree refuses the fit", gridScenePlan(skew, new MockScene({ padding: 0 })), null);
  const deaf = new MockScene({ padding: 0 });
  deaf.clone = () => ({ grid: { sizeX: 100, sizeY: 100 } });
  check("a hex probe that cannot answer refuses", gridScenePlan(recipe, deaf), null);
}

// --- a city map's creation data is what it always was -----------------------------------------
{
  const actor = (cbId, name) => new MockActor({ _id: id16("ct"), name, type: LOCATION_TYPE, flags: { [MODULE_ID]: { cookbook: { id: cbId } } } }, null);
  const actors = new Map([["xx.adventure", actor("xx.adventure", "City")], ["xx.district.q", actor("xx.district.q", "Quarter")], ["xx.p1", actor("xx.p1", "Place")]]);
  const lists = { "xx.t1": table("xx.t1"), "xx.t2": table("xx.t2") };
  lists["xx.t1"].results = [{ range: [1, 4] }, { range: [5, 8] }];
  const tableOf = async (id) => lists[id] ?? null;
  const ids = { mapPlaceId: "xx.adventure", districtIds: ["xx.district.q"], placeIds: ["xx.p1"] };
  const level = { id: MockScene.metadata.defaultLevelId, name: "Level" };
  const built = await mapCreateData({ bookId: "xx", id: "xx.city", recipe: CITY_RECIPE, ids, actors, tableOf, src: "maps/x.webp", folderId: "F", fallbackName: "City" });

  // The settlement map exactly as it was built before a grid could be handed in.
  const frame = sceneFrame(CITY_RECIPE);
  const list = lists["xx.t1"];
  const before = sceneData({
    id: "xx.city", book: "xx", name: "City", recipe: CITY_RECIPE, src: "maps/x.webp", folderId: "F",
    incidents: { tableUuid: list.uuid, afterDark: afterDarkShift(list.results.map((r) => r.range), list.formula), band: bandOfSection("r5-6") },
    locationUuid: actors.get("xx.adventure").uuid, level,
    regions: [districtRegionData(CITY_RECIPE.districts[0], frame, {
      name: "Quarter", districtType: DISTRICT_TYPE, specialTableUuid: lists["xx.t2"].uuid, specialAfterDark: 0, locationUuid: actors.get("xx.district.q").uuid,
    })],
    tokens: [{ ...placeTokenAt([20, 20], frame), hidden: true, actorId: actors.get("xx.p1").id }],
  });
  check("a recipe without a grid builds byte-identical creation data", JSON.stringify(built), JSON.stringify(before));
  ok("and carries no lattice, shift or scale", !("shiftX" in built) && built.grid.type === 0 && !("pixelsPerPoint" in built.flags[MODULE_ID].cookbook));
}

// --- region places: the overview, a market, the settlement, a site of its own ----------------
const pack = game.packs.get(ACTOR_PACK);
const shelved = (cbId) => pack.docs.find((d) => d.flags?.[MODULE_ID]?.cookbook?.id === cbId);
// Two places an earlier step already made: the book's market record and its settlement.
await MockActor.create({ name: "Market 3", type: LOCATION_TYPE, system: { notes: "", parentUuid: "" }, flags: { [MODULE_ID]: { cookbook: { id: "zz.mkt3", book: "zz", kind: "kind.marketRecord" } } } }, { pack: ACTOR_PACK });
await MockActor.create({ name: "zz", type: LOCATION_TYPE, system: { notes: "", parentUuid: "" }, flags: { [MODULE_ID]: { cookbook: { id: "zz.adventure", book: "zz", kind: "kind.oseAdventure" } } } }, { pack: ACTOR_PACK });
{
  const early = await cookbookImportScenes();
  check("a region map waits for its places", [early.made, early.unready, game.scenes.size], [0, 1, 0]);
  let threw = null;
  await cookbookImportJournals().catch((err) => (threw = err));
  ok("region rows are no journal pages", !threw && notices.at(-1)?.[1]?.includes("no location entries"), String(threw ?? notices.at(-1)?.[1]));

  const before = pack.docs.size;
  const out = await cookbookImportPoiPlaces();
  const region = shelved("zz.region");
  ok("the region's place is made once", !!region && pack.docs.filter((d) => d.flags?.[MODULE_ID]?.cookbook?.id === "zz.region").length === 1);
  ok("its overview is its notes", !!region?.system?.notes);
  const market = shelved("zz.mkt3");
  ok("a market site writes onto the market's record", !!market.system.notes && market.system.parentUuid === region.uuid);
  const city = shelved("zz.adventure");
  ok("an adventure site writes onto the settlement", !!city.system.notes && city.system.parentUuid === region.uuid);
  const own = shelved("zz.site3");
  ok("any other site is a place under the region", own?.type === LOCATION_TYPE && own.system.parentUuid === region.uuid);
  ok("no second place is made for a bound site", !shelved("zz.site1") && !shelved("zz.site2"));
  check("two documents are new: the region and its own site", pack.docs.size - before, 2);
  check("the counts", [out.made, out.regions, out.bound, out.refused], [1, 1, 2, 0]);
  const again = await cookbookImportPoiPlaces();
  check("a second run writes nothing", [again.made, again.regions, again.bound, again.already], [0, 0, 0, 4]);
}

// --- the scene step: a region map made, zones laid over it and over a held city ------------
const listOne = table("zz.list1");
game.tables.set(listOne.id, listOne);
const city = new MockScene({ name: "City", padding: 0, grid: { type: 0, size: 100 }, flags: { [MODULE_ID]: { cookbook: { id: "xx.city", book: "xx", kind: "kind.scene" } } } });
game.scenes.set(city.id, city);
forgetImportedIndex();

const first = await cookbookImportScenes();
const map = game.scenes.find((s) => s.getFlag(MODULE_ID, "cookbook")?.id === "zz.map");
{
  check("one map made, none refused", [first.made, first.refused, first.gridRefused, first.unready], [1, 0, 0, 0]);
  ok("the map was made", !!map);
  const plan = gridScenePlan(recipe, new MockScene({ name: "again", padding: 0 }));
  ok("the picture was cut at the probed scale", near(uploads[0]?.opts?.pixelsPerPoint, plan.pixelsPerPoint, 1e-12));
  check("the scene is the grid's", [map.grid.type, map.source.grid.size, map.source.grid.distance, map.source.grid.units], [4, GRID.pixels, 6, "mi"]);
  check("the shift is the solved one", [map.shiftX, map.shiftY], [plan.shiftX, plan.shiftY]);
  check("set up for journey travel", map.flags[MODULE_ID].battlemap.mapSystem, "journey");
  ok("the scale is kept for the zones", near(map.flags[MODULE_ID].cookbook.pixelsPerPoint, plan.pixelsPerPoint, 1e-12));
  const dims = map.getDimensions();
  const [cx, cy] = plan.frame.toScene(...GRID.centre);
  const at = { x: dims.sceneX + cx, y: dims.sceneY + cy };
  const under = map.grid.getCenterPoint(at);
  ok("on the made scene a drawn centre sits under a Foundry centre", near(under.x, at.x, 1) && near(under.y, at.y, 1), JSON.stringify({ at, under }));
  const region = game.actors.find((a) => a.getFlag(MODULE_ID, "cookbook")?.id === "zz.region");
  ok("the region's place was brought into the world and is the map's place", !!region && map.flags[MODULE_ID].location === region.uuid);
  check("three sites set down", first.tokens, 3);
  const worldOf = (cbId) => game.actors.find((a) => a.getFlag(MODULE_ID, "cookbook")?.id === cbId)?.id;
  check("each token stands on the document its text went to", map.tokens.map((t) => t.actorId), [worldOf("zz.mkt3"), worldOf("zz.adventure"), worldOf("zz.site3")]);
  const token = map.tokens.map((t) => t)[0];
  const [px, py] = plan.frame.toScene(200, 180);
  ok("a site token stands on its point, picture corner included", near(token.x + (0.5 * GRID.pixels) / 2, dims.sceneX + px, 1) && near(token.y + (0.5 * GRID.pixels) / 2, dims.sceneY + py, 1));
  check("a region map writes no Adventure", [first.adventures, first.adventuresHeld, first.adventuresFailed], [0, 0, 0]);

  check("zones laid and waiting", [first.zones, first.zonesHeld, first.zonesWaiting, first.zonesRefused], [3, 0, 1, 0]);
  const zoneOf = (scene, zoneId) => scene.regions.find((r) => r.getFlag(MODULE_ID, "cookbook")?.zone === zoneId);
  const own = zoneOf(map, "zz.zone1");
  const behavior = own?.behaviors.find((b) => b.type === `${MODULE_ID}.encounterZone`);
  check("the zone's behaviour carries its list and the figures read off its page",
    behavior?.system, { tableUuid: listOne.uuid, encounterTarget: 11, journeyCadence: "entry", dayThrows: 3, nightThrows: 5 });
  ok("named from the lang key, never a printed word", own?.name.startsWith("ACKS-IMPORTER.ui.sceneZone|"));
  // The cells the test itself finds inside the outline on the live grid.
  const placed = (x, y) => {
    const [u, v] = plan.frame.toScene(x, y);
    return [Math.round(u) + dims.sceneX, Math.round(v) + dims.sceneY];
  };
  const ring = [];
  for (let k = 0; k < ZZ_OUTLINE.length; k += 2) ring.push(...placed(ZZ_OUTLINE[k], ZZ_OUTLINE[k + 1]));
  const want = [];
  const [i0, j0, i1, j1] = map.grid.getOffsetRange({ x: dims.sceneX, y: dims.sceneY, width: dims.sceneWidth, height: dims.sceneHeight });
  for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) {
    const c = map.grid.getCenterPoint({ i, j });
    if (pointInRing(c.x, c.y, ring)) want.push({ i, j });
  }
  ok("the outline holds cells", want.length > 0);
  check("the zone is snapped to the cells whose centres its outline holds", own?.flags[MODULE_ID].zoneHexes, want);
  check("one shape per cell", own?.shapes.length, want.length);
  check("visible to the Judge only", own?.visibility, 1);

  const cross = zoneOf(map, "yy.zone1");
  const crossed = cross?.behaviors.find((b) => b.type === `${MODULE_ID}.encounterZone`);
  check("a zone from another book reads its own page", [crossed?.system.encounterTarget, crossed?.system.dayThrows, crossed?.system.nightThrows, crossed?.system.journeyCadence], [9, 7, 3, "periods"]);
  check("a list the world lacks is left blank", crossed?.system.tableUuid, null);

  const flat = zoneOf(city, "zz.zone2");
  check("on a gridless map no cell is snapped", flat?.flags[MODULE_ID].zoneHexes, []);
  check("the outline is carried through the frame", flat?.shapes, [{ type: "polygon", points: ringToScene(XX_OUTLINE, sceneFrame(CITY_RECIPE)), hole: false }]);
  check("a zone with no figures inherits", flat?.behaviors.find(() => true)?.system, { tableUuid: null, encounterTarget: 0, journeyCadence: "", dayThrows: 0, nightThrows: 0 });
  ok("the run names every region it made", first.created.regions.length === 3);
}

// --- a second run: the map is held, the zones are held, a late list is linked ---------------
{
  const late = table("yy.list9");
  game.tables.set(late.id, late);
  const regionsBefore = map.regions.size;
  const second = await cookbookImportScenes();
  check("the map is held, not made again", [second.made, second.already], [0, 1]);
  check("held zones are added once, not twice", [second.zones, second.zonesHeld, second.zonesWaiting], [0, 3, 1]);
  check("no Region is added", map.regions.size, regionsBefore);
  const crossed = map.regions.find((r) => r.getFlag(MODULE_ID, "cookbook")?.zone === "yy.zone1")?.behaviors.find(() => true);
  check("the late list is linked", crossed?.system.tableUuid, late.uuid);
  ok("and counted as a repair", second.repaired >= 1);
  ok("the summary names the held zones", notices.at(-1)?.[1]?.includes("scenesZonesHeld"));

  // Each of the two relinks on its own: the held map's repair, and the zone
  // pass when the map's own book is not open.
  const dead = "RollTable.gone000000000000";
  crossed.system.tableUuid = dead;
  check("a held map's repair relinks its zones", [await repairHeldMap(recipe, map), crossed.system.tableUuid], [1, late.uuid]);
  crossed.system.tableUuid = dead;
  const zzDoc = sessions.get("zz");
  sessions.delete("zz");
  const third = await cookbookImportScenes();
  sessions.set("zz", zzDoc);
  check("with the map's book closed the zone pass relinks", [third.made, third.already, third.zonesHeld, crossed.system.tableUuid], [0, 0, 1, late.uuid]);
}

// --- shapes the Foundry half depends on -------------------------------------------------------
{
  const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
  const boot = read("scripts/importer/module.mjs");
  ok("the picture is cut at the scale it is handed", /async function uploadSceneMap\(doc, id, recipe, \{ pixelsPerPoint \} = \{\}\)[\s\S]*?sceneFrame\(recipe, \{ pixelsPerPoint \}\)/.test(boot));
  const frameOf = (f) => JSON.stringify({ ...f, toScene: f.toScene(123, 45) });
  check("a recipe without a grid frames the same picture", frameOf(sceneFrame(CITY_RECIPE, { pixelsPerPoint: undefined })), frameOf(sceneFrame(CITY_RECIPE)));
  const lang = JSON.parse(read("lang/en.json"));
  for (const key of ["sceneZone", "scenesGridRefused", "scenesZonesMade", "scenesZonesHeld", "scenesZonesWaiting", "scenesZonesRefused", "poiRegionsDescribed", "poiSitesBound"]) {
    ok(`lang has ACKS-IMPORTER.ui.${key}`, typeof lang[`ACKS-IMPORTER.ui.${key}`] === "string");
  }
}

if (failed) {
  console.error(`\nregion-import: ${failed} failure(s)`);
  process.exit(1);
}
console.error("region-import: OK");
