/* global game, fromUuid, fromUuidSync, Hooks */
/**
 * The classes registry: world class documents → the layered tables registry.
 *
 * Publishes two things at WORLD priority whenever the world's class items
 * change: `acks.classProgressions` (the four chassis attack/save progressions
 * every human class borrows) and one `acks.class.<key>` document per class
 * that prints its own bands or ladders. It is the resolution source for a roll
 * target of kind `progression` ("as fighter at half level").
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
import { libraryItems, libraryPacks, cookbookId, whenReady } from "../lib/library.mjs";
import { skillLadderRungs } from "../abilities/skill-ladders.mjs";

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
 * A class may state its own place in `system.sortOrder`; zero means work it out
 * from `source`. A class naming no book sorts after every printed one.
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
 * The class Item a name or a class key names, name first, or null. For a caller
 * holding only a class's name (an actor's free-text class, a henchman roll's
 * class column).
 */
export function classNamed(nameOrKey) {
  const k = String(nameOrKey ?? "").trim().toLowerCase();
  if (!k) return null;
  return classItems().find((i) => i.name.toLowerCase() === k) ?? classByKey(k);
}

/**
 * Whether a `fromUuidSync` answer is a compendium index row rather than a
 * document. Foundry drops an idle pack's documents and keeps its index; a row
 * passes a type test and fails on the first `.system` read, so no lookup below
 * hands one on.
 */
const isIndexRow = (doc) => !!doc && typeof doc.documentName !== "string";

/** Loads in flight, by uuid: repeated misses start one fetch. */
const warming = new Map();

/**
 * Load an evicted compendium document back into its pack, once per uuid at a
 * time. With `actor` given, its open windows re-render when the document
 * lands. Resolves to the document, or null when the pack no longer has it.
 */
function warmDocument(uuid, actor = null) {
  if (warming.has(uuid)) return warming.get(uuid);
  if (typeof fromUuid !== "function") return Promise.resolve(null);
  const load = fromUuid(uuid)
    .then((doc) => {
      if (doc && actor) for (const app of Object.values(actor.apps ?? {})) app.render();
      return doc ?? null;
    })
    .catch(() => null)
    .finally(() => warming.delete(uuid));
  warming.set(uuid, load);
  return load;
}

/**
 * The class Item a character is bound to: the flag's uuid first, then a
 * name/key match on the free-text `details.class` the system stores. A bound
 * class whose pack has gone cold answers as unbound while it reloads;
 * `classForActorAsync` is the read for a caller that can wait for it.
 */
export function classForActor(actor) {
  const flag = actor?.getFlag?.(MODULE_ID, FLAG_CLASSES);
  if (flag?.uuid) {
    const doc = fromUuidSync(flag.uuid);
    if (doc?.type === CLASS_TYPE) {
      if (!isIndexRow(doc)) return doc;
      warmDocument(flag.uuid, actor);
      return null;
    }
  }
  const name = String(actor?.system?.details?.class ?? "").trim().toLowerCase();
  if (!name) return null;
  return (
    classItems().find((i) => i.name.toLowerCase() === name) ??
    classByKey(name)
  );
}

/**
 * The uuids of the library's class rows called `name` (already lower-cased),
 * read off the packs' indexes so finding one loads no shelf.
 */
function classRowsNamed(name) {
  const out = [];
  for (const pack of libraryPacks("Item")) {
    for (const row of pack.index ?? []) {
      if (row.type === CLASS_TYPE && String(row.name ?? "").toLowerCase() === name) {
        out.push(row.uuid ?? `Compendium.${pack.collection}.Item.${row._id}`);
      }
    }
  }
  return out;
}

/**
 * The bound class as a document, for a caller that can await: a class evicted
 * from its pack is loaded back first, and so is a class a character names
 * without being bound to it (the rows of that name only). A name no row carries
 * is answered from what is loaded while the shelves warm behind the read. The
 * character sheet awaits this on every render, so it waits on one document,
 * never the library.
 */
export async function classForActorAsync(actor) {
  const flag = actor?.getFlag?.(MODULE_ID, FLAG_CLASSES);
  if (flag?.uuid) {
    if (isIndexRow(fromUuidSync(flag.uuid))) await warmDocument(flag.uuid);
    return classForActor(actor);
  }
  const name = String(actor?.system?.details?.class ?? "").trim().toLowerCase();
  if (!name) return null;
  const found = classForActor(actor);
  if (found) return found;
  const named = classRowsNamed(name);
  if (named.length) await Promise.all(named.map((uuid) => warmDocument(uuid)));
  return classForActor(actor);
}

/**
 * Resolve an ability/equipment ref to a world Item: a cookbook id matches the
 * importer's stamp (`flags[MODULE_ID].cookbook.id`), a `uuid:` ref resolves
 * directly. Null when nothing in this world carries the ref.
 *
 * A class's own copy never answers for the definition it copied: a template
 * package's skinned gear and specialized proficiencies carry the original's
 * stamp, so a part is identified by its own flag (`templatePartOf`), never by
 * name. A `uuid:` ref names one document on purpose and is left alone. See
 * docs/classes/DECISIONS.md, "a ref answers with the definition, never a
 * class's own copy of it".
 */
export function findByRef(ref) {
  if (!ref) return null;
  if (ref.startsWith("uuid:")) {
    const uuid = ref.slice(5);
    const doc = fromUuidSync(uuid);
    if (isIndexRow(doc)) {
      warmDocument(uuid);
      return null;
    }
    return doc ?? null;
  }
  return libraryItems().find((i) => cookbookId(i) === ref && !templatePartOf(i)) ?? null;
}

/**
 * The stamp naming what a document is a part of (a class's skinned gear,
 * specialized proficiency or copied spell), or null for anything else. It
 * separates the library's definitions from the copies minted from them; every
 * read that wants definitions, a pick list included, makes that separation.
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
 * chassis class's (one hop; chassis never chain).
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

/**
 * What `publish` registers whatever the world holds, for
 * `tools/validate-producers.mjs`: the chassis progressions, one table per
 * chassis. A class's own document is keyed by the world's classes
 * (`CLASS_DOC_PREFIX` + key), so no static list can name it.
 */
export const PRODUCES = Object.freeze({
  [PROGRESSIONS_DOC_ID]: Object.fromEntries(CHASSIS_KEYS.map((key) => [key, null])),
});

/** Doc ids this registry currently has registered at WORLD priority. */
const _published = new Set();

/**
 * Rebuild and publish every class-derived registry document. Idempotent:
 * ids that vanished are unregistered, the rest replace their WORLD layer.
 * Each table cites the page its class item names (`source.cite`); a class
 * naming none, as a homebrew one does, cites nothing.
 */
export function publish() {
  const items = classItems();
  const next = new Map();

  const chassisTables = {};
  const chassisCites = {};
  for (const key of CHASSIS_KEYS) {
    const item = classByKey(key);
    if (!item) continue;
    const saves = saveRows(item.system);
    const attack = attackRows(item.system);
    if (!saves.length && !attack.length) continue;
    chassisTables[key] = { saves, attack };
    if (item.system.source?.cite) chassisCites[key] = item.system.source.cite;
  }
  if (Object.keys(chassisTables).length) {
    next.set(PROGRESSIONS_DOC_ID, {
      id: PROGRESSIONS_DOC_ID,
      source: { book: "rr" },
      cites: chassisCites,
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
      const cite = sys.source?.cite || "";
      const cites = cite ? Object.fromEntries(Object.keys(tables).map((k) => [k, cite])) : {};
      next.set(id, { id, source: { book: sys.source?.book || "rr" }, cites, tables });
    }
  }

  for (const id of _published) if (!next.has(id)) unregisterTable(id, { priority: PRIORITY.WORLD });
  for (const [id, doc] of next) registerTable(doc, { priority: PRIORITY.WORLD, source: `${MODULE_ID}.classes` });
  _published.clear();
  for (const id of next.keys()) _published.add(id);
  return next.size;
}

/* ------------------------------------------------------------------ */
/*  Progression resolution                                             */
/* ------------------------------------------------------------------ */

/**
 * The attack throw of chassis `as` at a fraction of `level` — the meaning of
 * a `progression`-kind LevelValue ("attacks as a fighter of half his level").
 * `round` is the rule's own rounding; up is the default.
 *
 * @returns {number|null} the throw, or null when the chassis is unpublished
 */
export function progressionThrow(as, atLevel = "full", level = 1, round = "up") {
  const chassis = classByKey(as);
  if (!chassis) return null;
  return bracketRow(effectiveAttack(chassis), effectiveLevel(atLevel, level, round))?.throw ?? null;
}

/**
 * The value a named ladder gives at a level, where the table wanted is not the
 * attack bands. The answer is the last rung (`atLevel`, `value`) the level has
 * reached, not a bracket.
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
 * The level a character reads a borrowed table at: their own, scaled by the
 * fraction and rounded as `round` says (`up` where a caller states nothing).
 * The floor is 1, since a table has no rung below its first.
 */
export function effectiveLevel(atLevel = "full", level = 1, round = "up") {
  const raw = Math.max(1, level) * levelFactor(atLevel);
  return Math.max(1, round === "down" ? Math.floor(raw) : Math.ceil(raw));
}

/**
 * The published rung a character reaches on a borrowed ladder: the whole cell,
 * not the number in it. A cell may be non-numeric, which `ladderValue` reports
 * as null and so cannot tell from "unpublished"; both read rungs through this
 * rule.
 *
 * A ladder the class document does not publish is read from the world's
 * imported skill of that key (`abilities/skill-ladders.mjs`), whatever `as`
 * names.
 *
 * @returns {{atLevel: number, value: number|null, text: string, outcome: string}|null}
 */
export function ladderRungAt(as, table, atLevel = "full", level = 1, round = "up") {
  const key = String(as ?? "").toLowerCase();
  const docId = key ? `${CLASS_DOC_PREFIX}${key}` : null;
  // getDoc throws on an unregistered id.
  const doc = docId && hasTableDoc(docId) ? getTableDoc(docId) : null;
  const published = doc?.tables?.[`ladder.${table}`];
  // A class publishing no such ladder borrows the imported skill's own.
  const rungs = Array.isArray(published) && published.length ? published : skillLadderRungs(table);
  if (!rungs.length) return null;
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
  // getDoc throws on an unregistered id.
  const doc = docId && hasTableDoc(docId) ? getTableDoc(docId) : null;
  return Object.keys(doc?.tables ?? {})
    .filter((t) => t.startsWith("ladder."))
    .map((t) => t.slice("ladder.".length));
}

/**
 * lib `resolveLevelValue`, completed: the `progression` kind (which lib
 * returns null for) resolves through the published tables. A progression that
 * names a table reads that ladder; one naming none reads the attack bands.
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
 * A `progression` reads the named ladder's rung whole, so a borrowed table's
 * non-numeric cells reach a throw as an inline ladder's do; the attack-band form
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

/** Settles `firstPublication` when the ready hook's publication ends; null while none is pending. */
let settleFirstPublication = null;
/** The first publication the ready hook makes; already resolved while none is pending. */
let firstPublication = Promise.resolve();

/**
 * Resolves once the registry's first publication (`registerRegistryHooks`'s
 * ready hook, after the library has warmed) has run, or failed. A pass that
 * retires documents for docs no longer registered (`materializeAll`) awaits it,
 * since before it the `acks.class.*` docs are absent rather than gone. Already
 * resolved where nothing is pending: the hooks were never registered, were
 * registered after `ready`, or the publication has run.
 * @returns {Promise<void>}
 */
export const whenPublished = () => firstPublication;

/** Wire publication to the world lifecycle: ready + class-item CRUD. */
export function registerRegistryHooks() {
  // A ready hook registered after `ready` never fires, so nothing is pending then.
  if (!settleFirstPublication && !globalThis.game?.ready) {
    firstPublication = new Promise((resolve) => {
      settleFirstPublication = resolve;
    });
  }
  // The library warms in the background and this publication is not repeated,
  // so the shelves are awaited before they are read.
  Hooks.once("ready", async () => {
    try {
      await whenReady();
      const count = publish();
      if (count) console.log(`${MODULE_ID} | classes registry published ${count} ruledata doc(s).`);
    } finally {
      settleFirstPublication?.();
      settleFirstPublication = null;
    }
  });
  for (const hook of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(hook, (item) => {
      if (item?.type !== CLASS_TYPE || item.parent) return;
      if (!game.ready) return;
      publish();
    });
  }
}
