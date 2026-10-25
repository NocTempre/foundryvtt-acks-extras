/**
 * A Judge's book as one Adventure: the half that is arithmetic over plain
 * sources.
 *
 * The adventures step writes one Adventure per book to its line's Adventure
 * shelf (`cookbook.mjs` `ensureBookAdventure`), and core's import of it is
 * steered (`book-adventure.mjs`). What both need without Foundry is here: ids
 * derived from a seed, the reference slots a carried document has, those
 * references rewritten, the world scene's ids laid over a map rebuilt from its
 * recipe, the link fields a map implies, the folders the documents are filed
 * in, whether a stored Adventure is current, and which of an Adventure's
 * documents an import creates. See docs/importer/DECISIONS.md, "A book is in
 * the library as one Adventure".
 */
import { MODULE_ID } from "./constants.mjs";
import { hash36 } from "./printed-name.mjs";
import { SCENE_LINK_FLAG, LOCATION_TYPE } from "../location/constants.mjs";
import { FACTION_TYPE } from "../factions/constants.mjs";
import { controlledRegions } from "./faction-binding.mjs";
import { claimIds } from "./place-pair.mjs";

/** The document type the shelf holds. */
export const ADVENTURE_TYPE = "Adventure";

/** The cookbook kind a book's Adventure carries. */
export const BOOK_ADVENTURE_KIND = "kind.bookAdventure";

/**
 * The cookbook kind the retired per-map Adventure carried. Still steered: a
 * copy can outlive its retirement in a shelf no one re-ran, a moved pack or a
 * backup, and its import must fill like any other.
 */
export const SETTLEMENT_ADVENTURE_KIND = "kind.settlementAdventure";

/** Every kind the import hooks steer; any other Adventure imports as core imports it. */
export const ADVENTURE_KINDS = Object.freeze([BOOK_ADVENTURE_KIND, SETTLEMENT_ADVENTURE_KIND]);

/**
 * The seed a map's parts take their ids from where the world lacks them, and
 * the cookbook id the retired per-map Adventure was stamped with. The map's
 * own id stays the first segment, so the book stays first.
 */
export const adventureCookbookId = (recipeId) => `${recipeId}.adventure`;

/**
 * A document id derived from a seed: the same seed gives the same id in every
 * world, so a book's Adventure keeps one id across rebuilds, and a region the
 * world scene lacks takes the same id each time it is built.
 */
export function stableDocId(seed) {
  const part = (salt) => hash36(`${salt}|${seed}`).padStart(7, "0");
  return (part("a") + part("b") + part("c")).slice(0, 16);
}

/** The retired per-map Adventure's id for one map. */
export const settlementAdventureId = (recipeId) => stableDocId(adventureCookbookId(recipeId));

/** A book's Adventure's cookbook id: the book is the unit, so no register row names it. */
export const bookAdventureCookbookId = (book) => `${book}.book`;

/** A book's Adventure's id. */
export const bookAdventureId = (book) => stableDocId(bookAdventureCookbookId(book));

/**
 * A book journal's cookbook id. One journal holds a group's pages, and no
 * register row names it. A group can be a printed heading, so the id carries
 * a hash of it, never the words.
 */
export const journalCookbookId = (book, group) => `${book}.journal-${hash36(String(group))}`;

/** Actor fields holding one uuid. */
const ACTOR_UUIDS = ["parentUuid", "seatUuid", "leaderUuid", "sceneUuid", "regionUuid"];
/** Actor row lists, and the uuid fields of each row. */
const ACTOR_ROWS = [
  ["holdings", ["uuid"]],
  ["relations", ["uuid"]],
  ["members", ["uuid", "ownerUuid"]],
  ["roster", ["uuid", "ownerUuid"]],
];
/** A District behaviour's list fields. */
const BEHAVIOR_TABLES = ["tableUuid", "wantedTableUuid", "specialTableUuid"];

/**
 * Every reference slot of one source, as `[holder, key, form, slot]`:
 * `holder[key]` holds a uuid ("uuid"), a token's bare Actor id ("actorId"), or
 * a list of uuids ("list"). One table, so the reader (`refsOf`) and the
 * rewriter (`adventureRefs`) cannot disagree about what a slot is.
 */
function slotsOf(type, data) {
  const out = [];
  const str = (v) => typeof v === "string" && v !== "";
  if (type === "Actor") {
    const sys = data?.system ?? {};
    for (const key of ACTOR_UUIDS) if (str(sys[key])) out.push([sys, key, "uuid", key]);
    for (const [list, keys] of ACTOR_ROWS) {
      for (const row of Array.isArray(sys[list]) ? sys[list] : []) {
        for (const key of keys) if (row && str(row[key])) out.push([row, key, "uuid", `${list}.${key}`]);
      }
    }
    if (Array.isArray(sys.controls)) out.push([sys, "controls", "list", "controls"]);
  } else if (type === "Scene") {
    const flags = data?.flags?.[MODULE_ID];
    if (str(flags?.[SCENE_LINK_FLAG])) out.push([flags, SCENE_LINK_FLAG, "uuid", "scene"]);
    const incidents = flags?.battlemap?.incidents;
    if (str(incidents?.tableUuid)) out.push([incidents, "tableUuid", "uuid", "incidents"]);
    for (const token of Array.isArray(data?.tokens) ? data.tokens : []) {
      if (str(token?.actorId)) out.push([token, "actorId", "actorId", "token"]);
    }
    for (const region of Array.isArray(data?.regions) ? data.regions : []) {
      const own = region?.flags?.[MODULE_ID];
      if (str(own?.[SCENE_LINK_FLAG])) out.push([own, SCENE_LINK_FLAG, "uuid", "region"]);
      for (const behavior of Array.isArray(region?.behaviors) ? region.behaviors : []) {
        for (const key of BEHAVIOR_TABLES) if (str(behavior?.system?.[key])) out.push([behavior.system, key, "uuid", "behavior"]);
      }
    }
  }
  return out;
}

/** A world-form reference to an Actor, a Scene (or a Region of one) or a RollTable. */
const WORLD_REF = /^(Actor|Scene|RollTable)\.([A-Za-z0-9]{16})(?:\.Region\.[A-Za-z0-9]{16})?$/;

/**
 * The documents a source names in world form, as `Type.<id>` keys; a Region
 * names its Scene. A compendium uuid is not reported: it names the library,
 * which an import never creates. A folder is not a reference here.
 */
export function refsOf(type, data) {
  const out = new Set();
  const add = (uuid) => {
    const m = WORLD_REF.exec(String(uuid ?? ""));
    if (m) out.add(`${m[1]}.${m[2]}`);
  };
  for (const [holder, key, form] of slotsOf(type, data)) {
    if (form === "list") holder[key].forEach(add);
    else if (form === "actorId") add(`Actor.${holder[key]}`);
    else add(holder[key]);
  }
  return out;
}

/**
 * A copy of `data` with every reference slot, and its folder, rewritten
 * through `map` (uuid to uuid; a folder is looked up as `Folder.<id>`). A slot
 * mapped to "" is dropped: a uuid field is emptied, a list loses the entry, a
 * folder becomes none. A token's actor id changes only to another world Actor,
 * the one thing a token can name. `data` is not changed.
 */
export function adventureRefs(type, data, map) {
  const copy = JSON.parse(JSON.stringify(data ?? {}));
  const to = (uuid) => (map.has(uuid) ? map.get(uuid) : uuid);
  for (const [holder, key, form] of slotsOf(type, copy)) {
    if (form === "list") holder[key] = holder[key].map(to).filter(Boolean);
    else if (form === "actorId") {
      const next = /^Actor\.([A-Za-z0-9]{16})$/.exec(to(`Actor.${holder[key]}`) ?? "");
      if (next) holder[key] = next[1];
    } else holder[key] = to(holder[key]) ?? "";
  }
  if (typeof copy.folder === "string" && copy.folder) {
    copy.folder = /^Folder\.([A-Za-z0-9]{16})$/.exec(to(`Folder.${copy.folder}`) ?? "")?.[1] ?? null;
  }
  return copy;
}

/** The quarter a region is drawn for, by its place's cookbook id. */
const placeOfRegion = (region) => region?.flags?.[MODULE_ID]?.cookbook?.place ?? null;

/**
 * A map rebuilt from its recipe, given the ids the world's own copy of it
 * carries: the scene's, each region's (matched by the quarter it is drawn
 * for), each behaviour's (by type, inside its region), each token's (by the
 * actor it stands for) and each wall's (by its coordinates and door type).
 * What the world copy lacks takes an id derived from the seed, the same on
 * every rebuild. Neither input is changed.
 * @param {object} scene the rebuilt scene's source, without ids
 * @param {object|null} held the world scene's `toObject()`
 * @param {string} seed the Adventure's cookbook id
 */
export function withWorldIds(scene, held, seed) {
  const out = JSON.parse(JSON.stringify(scene ?? {}));
  out._id = held?._id ?? stableDocId(`${seed}|scene`);
  const seen = new Map();
  const nth = (key) => {
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return n;
  };
  const takenRegions = new Set();
  for (const region of Array.isArray(out.regions) ? out.regions : []) {
    const place = placeOfRegion(region);
    const twin = place ? (held?.regions ?? []).find((r) => !takenRegions.has(r._id) && placeOfRegion(r) === place) : null;
    if (twin) takenRegions.add(twin._id);
    const regionSeed = `${seed}|region|${place}|${nth(`region|${place}`)}`;
    region._id = twin?._id ?? stableDocId(regionSeed);
    const takenBehaviors = new Set();
    for (const [i, behavior] of (Array.isArray(region.behaviors) ? region.behaviors : []).entries()) {
      const same = (twin?.behaviors ?? []).find((b) => !takenBehaviors.has(b._id) && b.type === behavior.type);
      if (same) takenBehaviors.add(same._id);
      behavior._id = same?._id ?? stableDocId(`${regionSeed}|behavior|${i}`);
    }
  }
  const takenTokens = new Set();
  for (const token of Array.isArray(out.tokens) ? out.tokens : []) {
    const twin = (held?.tokens ?? []).find((t) => !takenTokens.has(t._id) && t.actorId === token.actorId);
    if (twin) takenTokens.add(twin._id);
    token._id = twin?._id ?? stableDocId(`${seed}|token|${token.actorId}|${nth(`token|${token.actorId}`)}`);
  }
  const wallKey = (wall) => `${(wall?.c ?? []).join(",")}|${Number(wall?.door) || 0}`;
  const takenWalls = new Set();
  for (const wall of Array.isArray(out.walls) ? out.walls : []) {
    const key = wallKey(wall);
    const twin = (held?.walls ?? []).find((w) => !takenWalls.has(w._id) && wallKey(w) === key);
    if (twin) takenWalls.add(twin._id);
    wall._id = twin?._id ?? stableDocId(`${seed}|wall|${key}|${nth(`wall|${key}`)}`);
  }
  return out;
}

/** The id a world-form Actor uuid names, or null. */
const actorIdOf = (uuid) => /^Actor\.([A-Za-z0-9]{16})$/.exec(String(uuid ?? ""))?.[1] ?? null;

/**
 * The link fields a map implies, set on copies of the actors it carries: the
 * city's `sceneUuid`, each quarter's `regionUuid` (the region whose link flag
 * names it), and each of the book's organisations' `controls`, from its flag's
 * quarter ids through `controlledRegions`, as the map step computes them. A
 * quarter with no region gives no control; a control on another map is kept,
 * so a book's maps are linked one after another. `actors` are not changed.
 * @param {object} scene the Adventure's scene, with its ids
 * @param {object[]} actors the carried actor sources
 * @param {string} book the book id whose organisations are given quarters
 */
export function linkFields(scene, actors, book) {
  const out = (actors ?? []).map((a) => JSON.parse(JSON.stringify(a)));
  const byId = new Map(out.map((a) => [a._id, a]));
  const sceneUuid = `Scene.${scene._id}`;
  const city = byId.get(actorIdOf(scene.flags?.[MODULE_ID]?.[SCENE_LINK_FLAG]));
  if (city?.type === LOCATION_TYPE) city.system = { ...city.system, sceneUuid };
  const regionOf = new Map();
  for (const region of scene.regions ?? []) {
    const quarter = byId.get(actorIdOf(region.flags?.[MODULE_ID]?.[SCENE_LINK_FLAG]));
    if (quarter?.type !== LOCATION_TYPE) continue;
    const uuid = `${sceneUuid}.Region.${region._id}`;
    quarter.system = { ...quarter.system, regionUuid: uuid };
    const id = quarter.flags?.[MODULE_ID]?.cookbook?.id;
    if (id) regionOf.set(id, uuid);
  }
  for (const actor of out) {
    const flag = actor.flags?.[MODULE_ID]?.cookbook;
    if (actor.type !== FACTION_TYPE || flag?.book !== book || !flag?.controls?.length) continue;
    const elsewhere = (actor.system?.controls ?? []).filter((uuid) => !String(uuid).startsWith(`${sceneUuid}.`));
    actor.system = { ...actor.system, controls: controlledRegions(elsewhere, flag.controls, regionOf, () => true) ?? elsewhere };
  }
  return out;
}

/**
 * One stand-in per carried actor (`make` builds it from the source), under
 * every id its place claims (`claimIds`), so a pin of the earlier book's row
 * finds the place a later book took it over into. The first actor to claim an
 * id keeps it, as in the world (`cookbook.mjs` `planCrossing`).
 * @param {object[]} actors carried actor sources
 * @param {(source: object) => object} make
 * @returns {Map<string, object>} cookbook id to stand-in
 */
export function standInsByClaim(actors, make) {
  const out = new Map();
  for (const source of actors ?? []) {
    const standIn = make(source);
    for (const id of claimIds(source?.flags?.[MODULE_ID]?.cookbook)) if (!out.has(id)) out.set(id, standIn);
  }
  return out;
}

/** How many seats and holdings of the carried organisations still name the library: those the map does not set down. */
export function seatsLeft(actors) {
  let n = 0;
  for (const actor of actors ?? []) {
    if (actor?.type !== FACTION_TYPE) continue;
    if (String(actor.system?.seatUuid ?? "").startsWith("Compendium.")) n++;
    for (const row of actor.system?.holdings ?? []) if (String(row?.uuid ?? "").startsWith("Compendium.")) n++;
  }
  return n;
}

/**
 * A document an import creates whenever this world lacks it: the map, the
 * book's organisations, anything of a type the importer does not carry, and
 * anything the importer did not stamp (a Judge's own addition), all of which
 * core would have created too. Nothing else in the Adventure names an
 * organisation, so one a Judge deleted could not be put back any other way.
 * In a book's Adventure (`every`) every document but a folder is a root.
 */
export function isRoot(type, data, every = false) {
  if (type === "Folder") return false;
  if (every) return true;
  if (type !== "Actor" && type !== "RollTable") return true;
  if (!data?.flags?.[MODULE_ID]?.cookbook) return true;
  return type === "Actor" && data.type === FACTION_TYPE;
}

/**
 * A kind of document the world may keep in its library rather than hold:
 * a list, a journal, an item, or an actor that is neither a place nor an
 * organisation (a person, a creature). A place and an organisation must be
 * world documents, because a map's links and tokens need them to be.
 */
export const isShelvedKind = (type, data) =>
  type === "RollTable" || type === "JournalEntry" || type === "Item" ||
  (type === "Actor" && data?.type !== LOCATION_TYPE && data?.type !== FACTION_TYPE);

/** An Adventure's folders, each after its parent. */
function parentFirst(folders) {
  const ours = new Set(folders.map((f) => f._id));
  const ordered = [];
  const placed = new Set();
  while (ordered.length < folders.length) {
    const before = ordered.length;
    for (const f of folders) {
      if (placed.has(f._id)) continue;
      const parent = f.folder ?? null;
      if (parent && ours.has(parent) && !placed.has(parent)) continue;
      ordered.push(f);
      placed.add(f._id);
    }
    // A cycle cannot be ordered; what is left is taken as it stands.
    if (ordered.length === before) {
      for (const f of folders) {
        if (placed.has(f._id)) continue;
        ordered.push(f);
        placed.add(f._id);
      }
    }
  }
  return ordered;
}

/**
 * Which of an Adventure's documents an import creates, and where every
 * reference in what it creates points: the fill.
 *
 * Every document the Adventure carries is sorted first. HELD: the world has
 * it by id, or has its twin (the same cookbook id under another id; for a
 * folder the same type, name and parent). SHELVED: a shelved kind
 * (`isShelvedKind`) this world's library holds; in a book's Adventure, a place
 * no carried map names is one too, since nothing needs it in the world.
 * Otherwise ABSENT. A twin and a shelved document are pointed at where they
 * are. Of the absent ones, an import creates the roots (`isRoot`), whatever a
 * held document's WORLD version names, and whatever a created one names, until
 * nothing new is named; and a folder only when something created sits in it or
 * below it. A place shelved for standing on no map is absent again once a
 * held or created document names it, as a room names the place it sits in. Only what core scoped into the import (`included`) is created, and
 * a folder that is neither held nor created is dropped from what is. Nothing
 * held is written to.
 *
 * @param {object} p
 * @param {Record<string, object[]>} p.content the whole Adventure's sources by document name, in content order
 * @param {boolean} [p.book] a book's Adventure: every document is a root, and a place off every map may stay shelved
 * @param {Set<string>} p.included `Type.<id>` keys core scoped into this import
 * @param {(type: string, id: string) => boolean} p.has the world holds this id
 * @param {(type: string, data: object, parentId?: string|null) => string|null} p.twinOf the world's id for the same
 *   document under another id; a folder is asked with its parent's world id
 * @param {(type: string, data: object) => string|null} p.shelfOf the library uuid of the document, or null; asked
 *   only of a document that may stay shelved
 * @param {(type: string, id: string) => Iterable<string>} p.worldRefs `refsOf` the world's own version of a held document
 * @param {(scene: object, worldId: string) => Map<string, string>} p.regionsOf each of the Adventure scene's region
 *   uuids that differs in the world scene, mapped to the world's, or to "" where the world scene has none
 * @returns {{create: Record<string, object[]>, redirect: Map<string, string>, added: number, held: number,
 *   shelved: number, skipped: number, heldScenes: string[]}}
 */
export function fillPlan({ content, book = false, included, has, twinOf, shelfOf, worldRefs, regionsOf }) {
  const redirect = new Map();
  const state = new Map();
  const source = new Map();
  const heldScenes = [];
  let held = 0;
  let shelved = 0;
  const onMap = new Set(book ? (content.Scene ?? []).flatMap((s) => [...refsOf("Scene", s)]) : []);
  const shelvable = (type, data) =>
    isShelvedKind(type, data) || (book && type === "Actor" && data?.type === LOCATION_TYPE && !onMap.has(`Actor.${data._id}`));
  // The places shelved only because no carried map shows them.
  const offMap = new Set();

  const folders = content.Folder ?? [];
  const ours = new Set(folders.map((f) => f._id));
  const worldFolder = new Map();
  for (const f of parentFirst(folders)) {
    const key = `Folder.${f._id}`;
    source.set(key, { type: "Folder", data: f });
    const parent = f.folder ?? null;
    // A parent this import would create has no world id yet, so nothing in the world is its child.
    const parentWorld = !parent ? null : ours.has(parent) ? worldFolder.get(parent) : parent;
    const twin = has("Folder", f._id) ? f._id : parentWorld === undefined ? null : twinOf("Folder", f, parentWorld);
    if (!twin) {
      state.set(key, "absent");
      continue;
    }
    state.set(key, "held");
    worldFolder.set(f._id, twin);
    if (twin !== f._id) redirect.set(key, `Folder.${twin}`);
    held++;
  }

  for (const [type, docs] of Object.entries(content)) {
    if (type === "Folder") continue;
    for (const data of docs ?? []) {
      const key = `${type}.${data._id}`;
      source.set(key, { type, data });
      const twin = has(type, data._id) ? data._id : twinOf(type, data);
      if (twin) {
        state.set(key, "held");
        held++;
        if (twin !== data._id) redirect.set(key, `${type}.${twin}`);
        if (type === "Scene") {
          heldScenes.push(twin);
          for (const [from, to] of regionsOf(data, twin)) redirect.set(from, to);
        }
        continue;
      }
      const lib = shelvable(type, data) ? shelfOf(type, data) : null;
      if (lib) {
        state.set(key, "shelved");
        redirect.set(key, lib);
        if (!isShelvedKind(type, data)) offMap.add(key);
        shelved++;
        continue;
      }
      state.set(key, "absent");
    }
  }

  const wanted = new Set();
  const queue = [];
  const want = (key) => {
    if (state.get(key) !== "absent" || wanted.has(key) || !included.has(key)) return;
    wanted.add(key);
    queue.push(key);
  };
  // A named place off every map loses its library pointer as well, so what
  // names it is written to name the copy this import creates.
  const named = (key) => {
    if (offMap.delete(key) && included.has(key)) {
      state.set(key, "absent");
      redirect.delete(key);
      shelved--;
    }
    want(key);
  };
  for (const [key, { type, data }] of source) if (isRoot(type, data, book)) want(key);
  for (const [key, { type }] of source) {
    if (type === "Folder" || state.get(key) !== "held") continue;
    const worldId = (redirect.get(key) ?? key).slice(type.length + 1);
    for (const ref of worldRefs(type, worldId)) named(ref);
  }
  while (queue.length) {
    const { type, data } = source.get(queue.shift());
    for (const ref of refsOf(type, data)) named(ref);
  }
  for (const key of [...wanted]) {
    let parent = source.get(key).data.folder ?? null;
    while (parent && source.has(`Folder.${parent}`)) {
      const fk = `Folder.${parent}`;
      if (state.get(fk) === "absent" && included.has(fk)) wanted.add(fk);
      parent = source.get(fk).data.folder ?? null;
    }
  }
  for (const [key, s] of state) if (key.startsWith("Folder.") && s === "absent" && !wanted.has(key)) redirect.set(key, "");

  const create = {};
  let added = 0;
  for (const [type, docs] of Object.entries(content)) {
    const list = (docs ?? []).filter((d) => wanted.has(`${type}.${d._id}`)).map((d) => adventureRefs(type, d, redirect));
    if (!list.length) continue;
    create[type] = list;
    added += list.length;
  }
  const absent = [...state.values()].filter((s) => s === "absent").length;
  return { create, redirect, added, held, shelved, skipped: absent - added, heldScenes };
}

/** The `Type.<id>` keys core scoped into an import: every document it would create or update. */
export function includedKeys(toCreate, toUpdate) {
  const out = new Set();
  for (const lists of [toCreate, toUpdate]) {
    for (const [type, docs] of Object.entries(lists ?? {})) for (const d of docs ?? []) out.add(`${type}.${d._id}`);
  }
  return out;
}

/**
 * Narrow core's own lists to a fill, in place: every `toUpdate` key goes, so
 * core has nothing to overwrite and asks nothing; each `toCreate` key is
 * replaced by what the fill creates of that type, or deleted, which keeps
 * core's order for the rest. Everything a fill creates is of a type core
 * already listed, because it is only ever what core would have created.
 */
export function applyFill(toCreate, toUpdate, create) {
  for (const type of Object.keys(toUpdate)) delete toUpdate[type];
  for (const type of Object.keys(toCreate)) {
    if (create[type]?.length) toCreate[type] = create[type];
    else delete toCreate[type];
  }
}

/**
 * The folders a book's Adventure files its documents in: one per type and
 * path, each the world's own where the world has a folder of that type, name
 * and parent, else an id derived from the seed, so an import files every
 * document where the step that made it did. Answers with the sources, each
 * after its parent, and the id of a path's last folder (null for no path).
 * @param {[string, string[]][]} paths each document type and its folder names, outermost first
 * @param {(type: string, name: string, parentId: string|null) => string|null} worldFolderOf the world folder's id, or null
 * @param {string} seed the Adventure's cookbook id
 * @returns {{sources: object[], idOf: (type: string, names?: string[]) => string|null}}
 */
export function adventureFolderSources(paths, worldFolderOf, seed) {
  const sources = [];
  const byPath = new Map();
  const keyOf = (type, names) => `${type}:${JSON.stringify(names)}`;
  for (const [type, names] of paths) {
    let parent = null;
    for (let i = 0; i < names.length; i++) {
      const key = keyOf(type, names.slice(0, i + 1));
      if (!byPath.has(key)) {
        const parentId = parent?._id ?? null;
        const source = {
          _id: worldFolderOf(type, names[i], parentId) ?? stableDocId(`${seed}|folder|${key}`),
          name: names[i], type, folder: parentId, sorting: "a",
          flags: { [MODULE_ID]: { cookbook: { id: `folder.${type}.${names[i]}` } } },
        };
        byPath.set(key, source);
        sources.push(source);
      }
      parent = byPath.get(key);
    }
  }
  return { sources, idOf: (type, names = []) => (names.length ? (byPath.get(keyOf(type, names))?._id ?? null) : null) };
}

/** A copy with every `_stats` removed, at any depth: what a write stamps says nothing about content. */
export function withoutStats(value) {
  if (Array.isArray(value)) return value.map(withoutStats);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, v] of Object.entries(value)) if (key !== "_stats") out[key] = withoutStats(v);
  return out;
}

/** The hash a book's Adventure records of what it was assembled from. */
export const sourcesHashOf = (source) => hash36(JSON.stringify(withoutStats(source)));

/**
 * How long after its write a book's Adventure may still be moved by the write
 * itself: the stamp records the write's time in a second write, which moves
 * the document's own modified time once more.
 */
export const WRITE_SLACK_MS = 60_000;

/**
 * What a run does with a book's Adventure. ABSENT: the shelf lacks it, so it
 * is written. EDITED: its own modified time is past the write the stamp
 * records (`writtenAt`), so it is the Judge's and kept. STALE: the stamp's
 * `sourcesHash` differs from the one just assembled, so it is rebuilt. HELD
 * otherwise. A stamp without `writtenAt` reads as unedited.
 * @param {{stamp?: object|null, modifiedTime?: number|null, sourcesHash: string}} p
 *   `stamp` null when the shelf lacks the Adventure
 * @returns {"absent"|"edited"|"stale"|"held"}
 */
export function bookAdventureState({ stamp = null, modifiedTime = null, sourcesHash }) {
  if (!stamp) return "absent";
  const at = Number(stamp.writtenAt);
  if (Number.isFinite(at) && at > 0 && Number(modifiedTime) - at > WRITE_SLACK_MS) return "edited";
  return stamp.sourcesHash === sourcesHash ? "held" : "stale";
}

/** One book's retired per-map Adventures among a shelf's index rows, read with the cookbook flag. */
export const legacyAdventuresOf = (rows, book) =>
  [...(rows ?? [])].filter((r) => {
    const flag = r?.flags?.[MODULE_ID]?.cookbook;
    return flag?.kind === SETTLEMENT_ADVENTURE_KIND && flag.book === book;
  });
