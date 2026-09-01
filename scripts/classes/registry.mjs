/* global game, fromUuidSync, Hooks */
/**
 * The classes registry: world class documents → the layered tables registry.
 *
 * Publishes two things at WORLD priority whenever the world's class items
 * change: `acks.classProgressions` (the four chassis attack/save progressions
 * every human class borrows) and one `acks.class.<key>` document per class
 * that prints its own bands or ladders. This is the resolution source the
 * abilities ROADMAP's `progression` seam was waiting on — a roll target of
 * kind `progression` ("as fighter at half level") resolves here instead of
 * returning null.
 *
 * Reads are pure lookups over what was published; a world with no class
 * documents publishes nothing and every resolver degrades to null.
 */
import { registerTable, unregisterTable, PRIORITY, bracketRow, getDoc as getTableDoc, hasDoc as hasTableDoc } from "../lib/tables.mjs";
import {
  resolveLevelValue as libResolveLevelValue,
  resolveLevelOutcome as libResolveLevelOutcome,
  outcomeOfRung,
  levelFactor,
} from "../lib/vocab.mjs";
import { CLASS_TYPE, CHASSIS_KEYS, PROGRESSIONS_DOC_ID, CLASS_DOC_PREFIX, FLAG_CLASSES, FLAG_TEMPLATE_PART, MODULE_ID } from "./constants.mjs";
import { libraryItems, cookbookId } from "../lib/library.mjs";

/** Every class Item the library holds — the sidebar's and the imported pack's. */
export function classItems() {
  return libraryItems().filter((i) => i.type === CLASS_TYPE);
}

/* ------------------------------------------------------------------ */
/*  Book order                                                         */
/* ------------------------------------------------------------------ */

/** Which book a class comes from decides which block it sorts into. */
export const BOOK_ORDER = ["rr", "bta"];

/**
 * Where a class sits when classes are listed as the books print them: the
 * book's rank times a thousand, plus the page its spread starts on.
 *
 * A class may state its own place in `system.sortOrder` — what an import
 * assigns and what a homebrew class is given by hand. Zero means "work it
 * out from `source`", so a world that re-imports nothing still lists its
 * classes in book order. A class naming no book sorts after every printed
 * one and can never displace it.
 */
export function classSortKey(item) {
  const sys = item?.system ?? {};
  if (sys.sortOrder) return sys.sortOrder;
  const rank = BOOK_ORDER.indexOf(String(sys.source?.book ?? "").toLowerCase());
  const page = Number(/\bp\.\s*(\d+)/i.exec(sys.source?.cite ?? "")?.[1]);
  return ((rank < 0 ? BOOK_ORDER.length : rank) + 1) * 1000 + (Number.isFinite(page) ? Math.min(page, 999) : 999);
}

/** Sort classes as the books print them, ties broken by name. */
export const byBookOrder = (a, b) => classSortKey(a) - classSortKey(b) || a.name.localeCompare(b.name);

/** The class Item whose slug is `key` (case-insensitive), or null. */
export function classByKey(key) {
  const k = String(key ?? "").toLowerCase();
  if (!k) return null;
  return classItems().find((i) => (i.system.key || "").toLowerCase() === k) ?? null;
}

/**
 * The class Item a character is bound to: the flag's uuid first, then a
 * name/key match on the free-text `details.class` the system stores.
 */
export function classForActor(actor) {
  const flag = actor?.getFlag?.(MODULE_ID, FLAG_CLASSES);
  if (flag?.uuid) {
    const doc = fromUuidSync(flag.uuid);
    if (doc?.type === CLASS_TYPE) return doc;
  }
  const name = String(actor?.system?.details?.class ?? "").trim().toLowerCase();
  if (!name) return null;
  return (
    classItems().find((i) => i.name.toLowerCase() === name) ??
    classByKey(name)
  );
}

/**
 * Resolve an ability/equipment ref to a world Item: a cookbook id matches the
 * importer's stamp (`flags[MODULE_ID].cookbook.id`), a `uuid:` ref resolves
 * directly. Null when nothing in this world carries the ref.
 *
 * A CLASS'S OWN COPY NEVER ANSWERS FOR THE DEFINITION IT COPIED. A template
 * package skins its gear and specializes its proficiencies by copying, and a
 * copy carries the original's flags — so a world holds many documents stamped
 * `def.weapon.staff`, only one of which is the Staff. Answered with the copy,
 * a lookup for the base returned one template's "aged and dusty staff", and
 * the next template skinned itself over that. A part is identified by its own
 * flag, never by name, so a Judge who renames one loses nothing.
 *
 * A `uuid:` ref is left alone: it names one document on purpose, and a bundle
 * row that points at a part is asking for that part.
 */
export function findByRef(ref) {
  if (!ref) return null;
  if (ref.startsWith("uuid:")) {
    const doc = fromUuidSync(ref.slice(5));
    return doc ?? null;
  }
  return libraryItems().find((i) => cookbookId(i) === ref && !templatePartOf(i)) ?? null;
}

/**
 * The stamp naming what a document is a PART of — a class's own skinned gear,
 * its specialized proficiency, its copied spell — or null for anything else.
 *
 * Stated here because it is what separates the library's DEFINITIONS from the
 * copies this feature mints from them, and every read that wants definitions
 * has to make that separation: a lookup by ref (above), and equally every list
 * a player picks from.
 */
export const templatePartOf = (doc) => doc?.flags?.[MODULE_ID]?.[FLAG_TEMPLATE_PART] ?? null;

/* ------------------------------------------------------------------ */
/*  Effective tables (chassis borrowing)                               */
/* ------------------------------------------------------------------ */

/** Map one class doc's printed bands to registry rows ({min,max,…}). */
const saveRows = (sys) =>
  (sys.saves ?? []).map((b) => ({
    min: b.minLevel,
    max: b.maxLevel,
    paralysis: b.paralysis,
    death: b.death,
    blast: b.blast,
    implements: b.implements,
    spells: b.spells,
  }));
const attackRows = (sys) => (sys.attack ?? []).map((b) => ({ min: b.minLevel, max: b.maxLevel, throw: b.throw }));

/**
 * The save bands a class actually uses: its own when printed, else the
 * chassis class's (one hop — the book never chains chassis).
 */
export function effectiveSaves(classItem) {
  const sys = classItem?.system;
  if (!sys) return [];
  const own = saveRows(sys);
  if (own.length) return own;
  const chassis = classByKey(sys.saveChassis);
  return chassis ? saveRows(chassis.system) : [];
}

/** The attack bands a class actually uses (own, else chassis). */
export function effectiveAttack(classItem) {
  const sys = classItem?.system;
  if (!sys) return [];
  const own = attackRows(sys);
  if (own.length) return own;
  const chassis = classByKey(sys.attackChassis);
  return chassis ? attackRows(chassis.system) : [];
}

/** The save band covering `level` (null when no table reaches it). */
export const saveBandAt = (classItem, level) => bracketRow(effectiveSaves(classItem), level) ?? null;

/** The attack band covering `level`. */
export const attackBandAt = (classItem, level) => bracketRow(effectiveAttack(classItem), level) ?? null;

/* ------------------------------------------------------------------ */
/*  Publication                                                        */
/* ------------------------------------------------------------------ */

/** Doc ids this registry currently has registered at WORLD priority. */
const _published = new Set();

/**
 * Rebuild and publish every class-derived ruledata document. Idempotent:
 * ids that vanished are unregistered, the rest replace their WORLD layer.
 */
export function publish() {
  const items = classItems();
  const next = new Map();

  const chassisTables = {};
  for (const key of CHASSIS_KEYS) {
    const item = classByKey(key);
    if (!item) continue;
    const saves = saveRows(item.system);
    const attack = attackRows(item.system);
    if (saves.length || attack.length) chassisTables[key] = { saves, attack };
  }
  if (Object.keys(chassisTables).length) {
    next.set(PROGRESSIONS_DOC_ID, {
      id: PROGRESSIONS_DOC_ID,
      source: { book: "rr" },
      tables: chassisTables,
    });
  }

  for (const item of items) {
    const sys = item.system;
    const key = (sys.key || "").toLowerCase();
    if (!key) continue;
    const tables = {};
    const saves = saveRows(sys);
    const attack = attackRows(sys);
    if (saves.length) tables.saves = saves;
    if (attack.length) tables.attack = attack;
    for (const ladder of sys.ladders ?? []) {
      if (ladder.key)
        tables[`ladder.${ladder.key}`] = (ladder.values ?? []).map((r) => ({
          atLevel: r.atLevel,
          value: r.value,
          text: r.text,
          outcome: r.outcome,
        }));
    }
    if (Object.keys(tables).length) {
      const id = `${CLASS_DOC_PREFIX}${key}`;
      next.set(id, { id, source: { book: sys.source?.book || "rr" }, tables });
    }
  }

  for (const id of _published) if (!next.has(id)) unregisterTable(id, { priority: PRIORITY.WORLD });
  for (const [id, doc] of next) registerTable(doc, { priority: PRIORITY.WORLD, source: `${MODULE_ID}.classes` });
  _published.clear();
  for (const id of next.keys()) _published.add(id);
  return next.size;
}

/* ------------------------------------------------------------------ */
/*  Progression resolution (the ROADMAP seam)                          */
/* ------------------------------------------------------------------ */

/**
 * The attack throw of chassis `as` at a fraction of `level` — the meaning of
 * a `progression`-kind LevelValue ("attacks as a fighter of half his level").
 * The fraction's rounding is the rule's own (`round`); the books print "round
 * up" beside these fractions, so up is the default.
 *
 * @returns {number|null} the throw, or null when the chassis is unpublished
 */
export function progressionThrow(as, atLevel = "full", level = 1, round = "up") {
  const chassis = classByKey(as);
  if (!chassis) return null;
  return bracketRow(effectiveAttack(chassis), effectiveLevel(atLevel, level, round))?.throw ?? null;
}

/**
 * The value a named LADDER gives at a level — "as a thief's Climb Walls at
 * half his level", where the table wanted is not the attack bands.
 *
 * A ladder is a list of rungs (`atLevel`, `value`), so the answer is the
 * LAST rung the level has reached rather than a bracket: a table stating 1, 4
 * and 7 gives the level-6 answer at rung 4. Reading it any other way makes a
 * character lose the rung they climbed at 4 the moment they hit 5.
 *
 * @param {string} as    a class key
 * @param {string} table the ladder's key, as the class document names it
 * @returns {number|null} null when the class, or that ladder, is unpublished
 */
export function ladderValue(as, table, atLevel = "full", level = 1, round = "up") {
  const value = Number(ladderRungAt(as, table, atLevel, level, round)?.value);
  return Number.isFinite(value) ? value : null;
}

/**
 * The LEVEL a character reads a borrowed table at — their own, scaled by the
 * fraction the rule prints and rounded the way it prints it.
 *
 * The floor is 1, not 0: a fraction of a 1st-level character is less than a
 * level, and a table has no rung below its first. Which way a fraction rounds
 * is printed beside it, so `round` is passed rather than assumed; `up` is only
 * the default for a caller that states nothing.
 */
export function effectiveLevel(atLevel = "full", level = 1, round = "up") {
  const raw = Math.max(1, level) * levelFactor(atLevel);
  return Math.max(1, round === "down" ? Math.floor(raw) : Math.ceil(raw));
}

/**
 * The published RUNG a character reaches on a borrowed ladder — the whole cell,
 * not the number in it.
 *
 * `ladderValue` answers for the numeric columns and is what every existing
 * caller wants. A throw needs more: a printed column may end in cells that are
 * not numbers at all, and a caller that only ever sees a null cannot tell
 * "automatic" from "unpublished". Both read the same rungs through the
 * same rule, so they cannot disagree about which one a level reaches.
 *
 * @returns {{atLevel: number, value: number|null, text: string, outcome: string}|null}
 */
export function ladderRungAt(as, table, atLevel = "full", level = 1, round = "up") {
  const key = String(as ?? "").toLowerCase();
  const docId = key ? `${CLASS_DOC_PREFIX}${key}` : null;
  // getDoc THROWS on an id nobody registered, so a class with no published
  // tables must be caught here rather than at roll time.
  const doc = docId && hasTableDoc(docId) ? getTableDoc(docId) : null;
  const rungs = doc?.tables?.[`ladder.${table}`];
  if (!Array.isArray(rungs) || !rungs.length) return null;
  const eff = effectiveLevel(atLevel, level, round);
  let best = null;
  for (const rung of rungs) {
    const at = Number(rung?.atLevel);
    if (!Number.isFinite(at) || at > eff) continue;
    if (best === null || at >= Number(best.atLevel)) best = rung;
  }
  return best;
}

/** Every rung of a published ladder, in printed order — what a sheet shows. */
export function ladderRungs(as, table) {
  const key = String(as ?? "").toLowerCase();
  const docId = key ? `${CLASS_DOC_PREFIX}${key}` : null;
  const doc = docId && hasTableDoc(docId) ? getTableDoc(docId) : null;
  const rungs = doc?.tables?.[`ladder.${table}`];
  return Array.isArray(rungs) ? [...rungs].sort((a, b) => Number(a.atLevel) - Number(b.atLevel)) : [];
}

/** Every ladder key a class document publishes, for a picker to offer. */
export function laddersOf(classKey) {
  const key = String(classKey ?? "").toLowerCase();
  const docId = key ? `${CLASS_DOC_PREFIX}${key}` : null;
  // getDoc THROWS on an id nobody registered, so a class with no published
  // tables must be caught here rather than at roll time.
  const doc = docId && hasTableDoc(docId) ? getTableDoc(docId) : null;
  return Object.keys(doc?.tables ?? {})
    .filter((t) => t.startsWith("ladder."))
    .map((t) => t.slice("ladder.".length));
}

/**
 * lib `resolveLevelValue`, completed: the `progression` kind (which lib
 * returns null for, by design) resolves through the published tables.
 *
 * A progression target that NAMES a table reads that ladder; one that names
 * none reads the attack bands, which is what the kind meant before ladders
 * were reachable and what every throw already stored keeps meaning.
 */
export function resolveLevelValue(lv, level = 1, scales = {}) {
  const resolved = libResolveLevelValue(lv, level, scales);
  if (resolved != null) return resolved;
  if (isProgression(lv)) {
    if (lv.table) return ladderValue(lv.as, lv.table, lv, level, lv.round || "up");
    return progressionThrow(lv.as, lv, level, lv.round || "up");
  }
  return resolved;
}

/** A LevelValue that names an external table rather than carrying its own. */
const isProgression = (lv) => !!lv && typeof lv === "object" && (lv.kind === "progression" || (!lv.kind && lv.as));

/**
 * lib `resolveLevelOutcome`, completed the same way `resolveLevelValue` is.
 *
 * A `progression` reads the NAMED ladder's rung whole, so a borrowed table's
 * non-numeric cells reach a throw exactly as an inline ladder's do. The attack-band form has no such cells and
 * answers as a plain target.
 *
 * @returns {{outcome: string, target: number|null, text: string}}
 */
export function resolveLevelOutcome(lv, level = 1, scales = {}) {
  if (isProgression(lv)) {
    if (!lv.table) return { outcome: "throw", target: progressionThrow(lv.as, lv, level, lv.round || "up"), text: "" };
    const rung = ladderRungAt(lv.as, lv.table, lv, level, lv.round || "up");
    return rung ? outcomeOfRung(rung) : { outcome: "throw", target: null, text: "" };
  }
  return libResolveLevelOutcome(lv, level, scales);
}

/** Wire publication to the world lifecycle: ready + class-item CRUD. */
export function registerRegistryHooks() {
  Hooks.once("ready", () => {
    const count = publish();
    if (count) console.log(`${MODULE_ID} | classes registry published ${count} ruledata doc(s).`);
  });
  for (const hook of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(hook, (item) => {
      if (item?.type !== CLASS_TYPE || item.parent) return;
      if (!game.ready) return;
      publish();
    });
  }
}
