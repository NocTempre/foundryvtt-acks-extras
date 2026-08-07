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
import { registerTable, unregisterTable, PRIORITY, bracketRow } from "../lib/tables.mjs";
import { resolveLevelValue as libResolveLevelValue, PROGRESSION_LEVELS } from "../lib/vocab.mjs";
import { CLASS_TYPE, CHASSIS_KEYS, PROGRESSIONS_DOC_ID, CLASS_DOC_PREFIX, FLAG_CLASSES, MODULE_ID } from "./constants.mjs";

/** Every class Item in the world directory. */
export function classItems() {
  return game.items?.filter((i) => i.type === CLASS_TYPE) ?? [];
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
 * importer's stamp (`flags["acks-importer"].cookbook.id`), a `uuid:` ref
 * resolves directly. Null when nothing in this world carries the ref.
 */
export function findByRef(ref) {
  if (!ref) return null;
  if (ref.startsWith("uuid:")) {
    const doc = fromUuidSync(ref.slice(5));
    return doc ?? null;
  }
  return game.items?.find((i) => i.flags?.["acks-importer"]?.cookbook?.id === ref) ?? null;
}

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
      if (ladder.key) tables[`ladder.${ladder.key}`] = (ladder.values ?? []).map((r) => ({ atLevel: r.atLevel, value: r.value, text: r.text }));
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
  const factor = PROGRESSION_LEVELS[atLevel]?.factor ?? 1;
  const raw = Math.max(1, level) * factor;
  const eff = Math.max(1, round === "down" ? Math.floor(raw) : Math.ceil(raw));
  return bracketRow(effectiveAttack(chassis), eff)?.throw ?? null;
}

/**
 * lib `resolveLevelValue`, completed: the `progression` kind (which lib
 * returns null for, by design) resolves through the published chassis tables.
 */
export function resolveLevelValue(lv, level = 1, scales = {}) {
  const resolved = libResolveLevelValue(lv, level, scales);
  if (resolved != null) return resolved;
  if (lv && typeof lv === "object" && (lv.kind === "progression" || (!lv.kind && lv.as))) {
    return progressionThrow(lv.as, lv.atLevel || "full", level, lv.round || "up");
  }
  return resolved;
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
