/* global game, Hooks */
/**
 * The level ladders the world's imported skills carry, by skill key.
 *
 * A skill imported from the Judge's book (`def.skill.<key>`) stores its throw as
 * a level ladder on its roll target. A borrowed throw names that skill's ladder
 * as its `table`, and the classes registry reads it here when no class document
 * publishes the ladder itself (`ladderRungAt`). Nothing in this file holds a
 * figure: every rung is what the importer wrote onto an item.
 *
 * Imported definitions may live in `game.items` or in a world compendium. Pack
 * documents load asynchronously and a roll reads synchronously, so the pack
 * half is cached and the world half is read live. The file imports lib only, so
 * the registry and the roller may both import it.
 */
import { ITEM_TYPE, resolveLevelValue } from "../lib/vocab.mjs";
import { cookbookId, openPacks, packDocsWhere, redrawOpen } from "../lib/library.mjs";

const ABILITIES_ID = "acks-extras";

/** The cookbook id prefix a skill definition carries. */
const SKILL_PREFIX = "def.skill.";

/** A cookbook skill definition id, e.g. "def.skill.listening". */
export const skillDefId = (key) => `${SKILL_PREFIX}${key}`;

/** The level ladder an imported ability carries on its roll targets, or null. */
function ladderOf(item) {
  for (const roll of item?.getFlag?.(ABILITIES_ID, "extras")?.rolls ?? []) {
    if (roll?.target?.breakpoints?.length) return roll.target;
  }
  return null;
}

let ladderCache = null;

/** How long the item hooks wait for quiet before the packs are read again. */
export const LADDER_REFRESH_QUIET_MS = 1000;
let pending = null;
let generation = 0;

/**
 * Schedule a rebuild once item changes stop arriving. A burst of writes (an
 * import, an update pass) reads the packs once, after its last change; a change
 * that lands during a read schedules the next one. Never empties the current
 * map: a roll reads it synchronously while the rebuild runs.
 */
export function invalidateLadders() {
  clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    refreshLadders().catch((err) => console.warn("acks-extras | skill ladder refresh failed", err));
  }, LADDER_REFRESH_QUIET_MS);
}

/** An item hook: an actor's own copy is read live by importedLadderFor and never cached, so it schedules nothing. */
const onItemChange = (item) => {
  if (!item?.parent) invalidateLadders();
};

/** The imported skill item behind each cached ladder, by skill key, kept in step with `ladderCache`. */
let itemCache = null;

/** Take the item's ladder into `map` and, when given, the item itself into `items`; the first item of a key wins. */
function takeLadder(map, item, items = null) {
  const id = item?.type === ITEM_TYPE.ability ? cookbookId(item) : "";
  if (!id.startsWith(SKILL_PREFIX)) return;
  const ladder = ladderOf(item);
  const key = id.slice(SKILL_PREFIX.length);
  if (!ladder || map.has(key)) return;
  map.set(key, ladder);
  items?.set(key, item);
}

/** A map's ladders as one comparable string, so a rebuild that changed nothing redraws nothing. */
const ladderSignature = (map) => JSON.stringify([...map].sort(([a], [b]) => a.localeCompare(b)));

/**
 * Redraw every open actor sheet. A sheet drawn before the packs' first read
 * finished, or before an import changed a ladder, shows a throw borrowed from a
 * skill's ladder as blank, and nothing else draws it again.
 */
const redrawActorSheets = redrawOpen((document) => document.documentName === "Actor");

/** Whether an index row of a world pack is an imported skill definition. */
const isSkillRow = (row) => row.type === ITEM_TYPE.ability && cookbookId(row).startsWith(SKILL_PREFIX);

/**
 * Rebuild the skill-to-ladder map from the item directory AND the world packs;
 * open actor sheets redraw when a ladder changed. A pack is read through its
 * index, and only the skill definitions it names are loaded (`packDocsWhere`),
 * never the whole shelf. A read that could not read a pack publishes nothing: the
 * map and the item cache stand as last published, and stay unset when no read has
 * succeeded yet, so the next reader asks again.
 */
export async function refreshLadders() {
  const mine = ++generation;
  const map = new Map();
  const items = new Map();
  for (const item of game.items ?? []) takeLadder(map, item, items);
  const worldPacks = openPacks("Item").filter((pack) => pack.metadata?.packageType === "world");
  const found = await packDocsWhere(worldPacks, isSkillRow);
  for (const doc of found) takeLadder(map, doc, items);
  if (found.failed.length) {
    console.warn(`acks-extras | the skill ladders were kept as published: ${found.failed.join(", ")} could not be read.`);
    return ladderCache ?? new Map();
  }
  // A read that started earlier never overwrites a later one's map.
  if (mine === generation) {
    const changed = ladderSignature(map) !== ladderSignature(ladderCache ?? new Map());
    ladderCache = map;
    itemCache = items;
    if (changed) redrawActorSheets();
  }
  return map;
}

let installed = false;

/**
 * Register the hooks that keep the ladder cache honest. Called at ready by each
 * feature that reads a ladder; only the first call registers.
 */
export function initLadders() {
  if (installed) return;
  installed = true;
  refreshLadders();
  for (const hook of ["createItem", "updateItem", "deleteItem"]) Hooks.on(hook, onItemChange);
  Hooks.on("ready", invalidateLadders);
}

/**
 * The ladder for a named skill, read from this world's imported copy of it. The
 * owning actor is searched synchronously first, then the world's items, then
 * the cached index of the world packs. Null when the skill has not been
 * imported.
 */
export function importedLadderFor(key, actor = null) {
  if (!key) return null;
  const id = skillDefId(key);
  const carries = (item) => (item?.type === ITEM_TYPE.ability && cookbookId(item) === id ? ladderOf(item) : null);
  for (const item of actor?.items ?? []) {
    const ladder = carries(item);
    if (ladder) return ladder;
  }
  for (const item of game.items ?? []) {
    const ladder = carries(item);
    if (ladder) return ladder;
  }
  if (!ladderCache) invalidateLadders();
  return ladderCache?.get(key) ?? null;
}

/**
 * The imported skill for a key: its item's name, its ladder and the item itself
 * (whose page `citeOf` reads; this file stays below `ability-rolls.mjs`). The
 * world's items are read live, then the cached index of the world packs; null
 * when the skill has not been imported.
 *
 * @returns {{key: string, name: string, ladder: object, item: Item}|null}
 */
export function importedSkillFor(key) {
  if (!key) return null;
  const id = skillDefId(key);
  let item = null;
  for (const candidate of game.items ?? []) {
    if (candidate?.type === ITEM_TYPE.ability && cookbookId(candidate) === id && ladderOf(candidate)) {
      item = candidate;
      break;
    }
  }
  if (!item) {
    if (!itemCache) invalidateLadders();
    item = itemCache?.get(key) ?? null;
  }
  const ladder = ladderOf(item);
  return ladder ? { key, name: String(item.name ?? ""), ladder, item } : null;
}

/** The borrowed ladder's value at `level`, or null. */
export function importedLadderTarget(key, actor, level) {
  const value = resolveLevelValue(importedLadderFor(key, actor), level);
  return Number.isFinite(value) ? value : null;
}

/**
 * The imported skill's ladder as published rungs, in printed order, the shape
 * the classes registry reads a class ladder in; `[]` when the skill is not
 * imported. A rung keeps its own text and outcome.
 *
 * @returns {Array<{atLevel: number, value: number|null, text: string, outcome?: string}>}
 */
export function skillLadderRungs(key, actor = null) {
  const target = importedLadderFor(key, actor);
  return [...(target?.breakpoints ?? [])]
    .sort((a, b) => Number(a.atLevel) - Number(b.atLevel))
    .map((bp) => ({ atLevel: Number(bp.atLevel), value: bp.value ?? null, text: String(bp.text ?? ""), ...(bp.outcome ? { outcome: bp.outcome } : {}) }));
}

/** Every skill key this world has imported a ladder for, sorted. */
export function importedSkillKeys() {
  const keys = new Set(ladderCache?.keys() ?? []);
  const sync = new Map();
  for (const item of game.items ?? []) takeLadder(sync, item);
  for (const key of sync.keys()) keys.add(key);
  if (!ladderCache) invalidateLadders();
  return [...keys].sort();
}

/** A ladder as `[{level, value}]` for display, in printed level order. */
export function ladderRows(target) {
  const bps = [...(target?.breakpoints ?? [])].sort((a, b) => a.atLevel - b.atLevel);
  return bps.map((bp) => ({ level: bp.atLevel, value: bp.value }));
}
