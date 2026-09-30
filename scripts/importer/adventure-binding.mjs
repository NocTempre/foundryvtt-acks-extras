/**
 * A settlement's map as one Adventure: the half that is arithmetic over plain
 * sources.
 *
 * The map step writes one Adventure per map to its line's Adventure shelf,
 * beside the world's own map (`cookbook.mjs` `ensureSettlementAdventure`), and
 * core's import of it is steered (`settlement-adventure.mjs`). What both need
 * without Foundry is here: ids derived from a seed, the reference slots a
 * carried document has, those references rewritten, the world scene's ids laid
 * over a map rebuilt from its recipe, the link fields a map implies, and which
 * of an Adventure's documents an import creates. See
 * docs/importer/DECISIONS.md, "A settlement's map is in the library too, as
 * one Adventure".
 */
import { MODULE_ID } from "./constants.mjs";
import { hash36 } from "./printed-name.mjs";
import { SCENE_LINK_FLAG, LOCATION_TYPE } from "../location/constants.mjs";
import { FACTION_TYPE } from "../factions/constants.mjs";
import { controlledRegions } from "./faction-binding.mjs";

/** The document type the shelf holds. */
export const ADVENTURE_TYPE = "Adventure";

/** The cookbook kind a settlement Adventure carries: the one thing the import hooks key on. */
export const ADVENTURE_KIND = "kind.settlementAdventure";

/** A settlement Adventure's cookbook id: its map's, so the book stays the first segment. */
export const adventureCookbookId = (recipeId) => `${recipeId}.adventure`;

/**
 * A document id derived from a seed: the same seed gives the same id in every
 * world, so a map's Adventure keeps one id across rebuilds, and a region the
 * world scene lacks takes the same id each time it is built.
 */
export function stableDocId(seed) {
  const part = (salt) => hash36(`${salt}|${seed}`).padStart(7, "0");
  return (part("a") + part("b") + part("c")).slice(0, 16);
}

/** The Adventure id for one map. */
export const settlementAdventureId = (recipeId) => stableDocId(adventureCookbookId(recipeId));

/** Actor fields holding one uuid. */
const ACTOR_UUIDS = ["parentUuid", "seatUuid", "leaderUuid", "sceneUuid", "regionUuid"];
/** Actor row lists, and the uuid fields of each row. */
const ACTOR_ROWS = [
  ["holdings", ["uuid"]],
  ["relations", ["uuid"]],
  ["members", ["uuid", "ownerUuid"]],
  ["roster", ["uuid", "ownerUuid"]],
];
/** The slots that name a person: a leader, a member, an occupant. Never who placed a row. */
const PERSON_SLOTS = new Set(["leaderUuid", "members.uuid", "roster.uuid"]);
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

/** The uuids an actor source names in the slots that hold people. */
export const peopleNamed = (data) =>
  slotsOf("Actor", data).filter(([, , , slot]) => PERSON_SLOTS.has(slot)).map(([holder, key]) => holder[key]);

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
 * for), each behaviour's (by type, inside its region) and each token's (by the
 * actor it stands for). What the world copy lacks takes an id derived from the
 * seed, the same on every rebuild. Neither input is changed.
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
  return out;
}

/** The id a world-form Actor uuid names, or null. */
const actorIdOf = (uuid) => /^Actor\.([A-Za-z0-9]{16})$/.exec(String(uuid ?? ""))?.[1] ?? null;

/**
 * The link fields a map implies, set on copies of the actors it carries: the
 * city's `sceneUuid`, each quarter's `regionUuid` (the region whose link flag
 * names it), and each of the book's organisations' `controls`, from its flag's
 * quarter ids through `controlledRegions`, as the map step computes them. A
 * quarter with no region gives no control. `actors` are not changed.
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
    actor.system = { ...actor.system, controls: controlledRegions([], flag.controls, regionOf, () => true) ?? [] };
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
 */
export function isRoot(type, data) {
  if (type === "Folder") return false;
  if (type !== "Actor" && type !== "RollTable") return true;
  if (!data?.flags?.[MODULE_ID]?.cookbook) return true;
  return type === "Actor" && data.type === FACTION_TYPE;
}

/**
 * A kind of document the world may keep in its library rather than hold:
 * a list, or an actor that is neither a place nor an organisation (a person).
 * A place and an organisation must be world documents, because a map's links
 * and tokens need them to be.
 */
export const isShelvedKind = (type, data) =>
  type === "RollTable" || (type === "Actor" && data?.type !== LOCATION_TYPE && data?.type !== FACTION_TYPE);

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
 * (`isShelvedKind`) this world's library holds. Otherwise ABSENT. A twin and a
 * shelved document are pointed at where they are. Of the absent ones, an
 * import creates the roots (`isRoot`), whatever a held document's WORLD
 * version names, and whatever a created one names, until nothing new is named;
 * and a folder only when something created sits in it or below it. Only what
 * core scoped into the import (`included`) is created, and a folder that is
 * neither held nor created is dropped from what is. Nothing held is written to.
 *
 * @param {object} p
 * @param {Record<string, object[]>} p.content the whole Adventure's sources by document name, in content order
 * @param {Set<string>} p.included `Type.<id>` keys core scoped into this import
 * @param {(type: string, id: string) => boolean} p.has the world holds this id
 * @param {(type: string, data: object, parentId?: string|null) => string|null} p.twinOf the world's id for the same
 *   document under another id; a folder is asked with its parent's world id
 * @param {(type: string, data: object) => string|null} p.shelfOf the library uuid of a shelved-kind document, or null
 * @param {(type: string, id: string) => Iterable<string>} p.worldRefs `refsOf` the world's own version of a held document
 * @param {(scene: object, worldId: string) => Map<string, string>} p.regionsOf each of the Adventure scene's region
 *   uuids that differs in the world scene, mapped to the world's, or to "" where the world scene has none
 * @returns {{create: Record<string, object[]>, redirect: Map<string, string>, added: number, held: number,
 *   shelved: number, skipped: number, heldScenes: string[]}}
 */
export function fillPlan({ content, included, has, twinOf, shelfOf, worldRefs, regionsOf }) {
  const redirect = new Map();
  const state = new Map();
  const source = new Map();
  const heldScenes = [];
  let held = 0;
  let shelved = 0;

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
      const lib = isShelvedKind(type, data) ? shelfOf(type, data) : null;
      if (lib) {
        state.set(key, "shelved");
        redirect.set(key, lib);
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
  for (const [key, { type, data }] of source) if (isRoot(type, data)) want(key);
  for (const [key, { type }] of source) {
    if (type === "Folder" || state.get(key) !== "held") continue;
    const worldId = (redirect.get(key) ?? key).slice(type.length + 1);
    for (const ref of worldRefs(type, worldId)) want(ref);
  }
  while (queue.length) {
    const { type, data } = source.get(queue.shift());
    for (const ref of refsOf(type, data)) want(ref);
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
