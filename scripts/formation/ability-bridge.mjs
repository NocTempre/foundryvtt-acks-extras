/* global game, globalThis, Hooks */

/**
 * Capability-aware ability matching — the bridge to the abilities program
 * (lib vocabulary, abilities effect model, the importer). The capability
 * primitives themselves live in `lib/capabilities.mjs`; this file is how a
 * formation CONSUMES them, plus the skill ladders. Candidates are the union
 * of capability matches and the existing name matches. lib's vocabulary is
 * imported statically, not read off `globalThis.acksExtras` at call time.
 * See docs/formation/DECISIONS.md, "Capability matching is a union, not a
 * fallback".
 */

import { MODULE_ID } from "./constants.mjs";
import { slug, resolveLevelValue, ITEM_TYPE } from "../lib/vocab.mjs";
import { cookbookId } from "../lib/library.mjs";

const ABILITIES_ID = "acks-extras";

/**
 * Capability matching itself lives in `lib/capabilities.mjs` — the sense model
 * asks the same question and lib may not import a feature. Re-exported here so
 * this bridge stays the one import site for everything ability-shaped.
 */
export { abilityRefs, hasCapability, itemHasCapability } from "../lib/capabilities.mjs";

/**
 * The throw target an imported ability carries, resolved at `level` — or null.
 * Reads the abilities extras (`extras.rolls[].target`, a lib LevelValue), which
 * is where the importer materializes a classified throw; `system.rollTarget`
 * is never written. Returns null for the importer's flat-0 "no target
 * extracted" sentinel so the caller can fall through to its own answer.
 */
export function importedThrowTarget(item, level) {
  const rolls = item?.getFlag?.(ABILITIES_ID, "extras")?.rolls ?? [];
  for (const roll of rolls) {
    const target = roll?.target;
    const value = resolveLevelValue(target, level);
    if (!Number.isFinite(value)) continue;
    // Ladders may legitimately reach 0/negative at high level; a FLAT zero is
    // the importer saying "the book page carried no number here".
    const flat = typeof target === "number" || (target?.kind ?? "flat") === "flat";
    if (value <= 0 && flat) continue;
    return value;
  }
  return null;
}

/* -------------------------------------------- */
/*  Skill ladders, sourced from the importer     */
/* -------------------------------------------- */

/** A cookbook skill definition id, e.g. "def.skill.listening". */
export const skillDefId = (key) => `${SKILL_PREFIX}${key}`;
const SKILL_PREFIX = "def.skill.";

/** The level ladder an imported ability carries, or null. */
function ladderOf(item) {
  for (const roll of item?.getFlag?.(ABILITIES_ID, "extras")?.rolls ?? []) {
    if (roll?.target?.breakpoints?.length) return roll.target;
  }
  return null;
}

/*
 * Imported definitions may live in `game.items` or in a world compendium,
 * so a reader must walk both. Pack documents load asynchronously and
 * `scaledSkillTarget` runs inside a roll loop, so the ladders are cached;
 * nothing here is on a hot path except the read.
 */
let ladderCache = null;
let refreshQueued = false;

/**
 * Schedule a rebuild without dropping the current map. The read is
 * synchronous, so an emptied cache would silently downgrade every borrowed
 * skill to its sheet target until the rebuild finished; a stale map costs
 * nothing by comparison.
 */
export function invalidateLadders() {
  if (refreshQueued) return;
  refreshQueued = true;
  Promise.resolve()
    .then(() => refreshLadders())
    .catch((err) => console.warn("acks-extras | skill ladder refresh failed", err))
    .finally(() => {
      refreshQueued = false;
    });
}

function takeLadder(map, item) {
  const id = item?.type === ITEM_TYPE.ability ? cookbookId(item) : "";
  if (!id.startsWith(SKILL_PREFIX)) return;
  const ladder = ladderOf(item);
  if (ladder && !map.has(id.slice(SKILL_PREFIX.length))) map.set(id.slice(SKILL_PREFIX.length), ladder);
}

/** Rebuild the skill→ladder map from the item directory AND the world packs. */
export async function refreshLadders() {
  const map = new Map();
  for (const item of game.items ?? []) takeLadder(map, item);
  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Item" || pack.metadata?.packageType !== "world") continue;
    try {
      for (const doc of await pack.getDocuments()) takeLadder(map, doc);
    } catch (err) {
      console.warn(`acks-extras | could not read compendium ${pack.collection}`, err);
    }
  }
  ladderCache = map;
  return map;
}

/** Register the hooks that keep the ladder cache honest. Called once at ready. */
export function initLadders() {
  refreshLadders();
  for (const hook of ["createItem", "updateItem", "deleteItem"]) Hooks.on(hook, invalidateLadders);
  Hooks.on("ready", invalidateLadders);
}

/**
 * The ladder for a named thief skill, read from this world's imported copy of
 * that skill. `thiefSkill` names the skill to scale as, not an index into a
 * table this module ships; an item with no ladder of its own borrows the real
 * one. The owning actor is searched synchronously first, then the cached
 * index of world items and packs. Returns null when the skill has not been
 * imported — the caller falls back to the item's own sheet target. See
 * docs/formation/DECISIONS.md, "The ladders come from the GM's own book".
 */
export function importedLadderFor(key, actor = null) {
  if (!key) return null;
  const id = skillDefId(key);
  const carries = (item) =>
    item?.type === ITEM_TYPE.ability && cookbookId(item) === id ? ladderOf(item) : null;
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
 * The borrowed ladder's value at `level`, or null. The one call a caller needs;
 * acks-lib's resolver stays behind this module's seam like every other use.
 */
export function importedLadderTarget(key, actor, level) {
  const value = resolveLevelValue(importedLadderFor(key, actor), level);
  return Number.isFinite(value) ? value : null;
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

/* -------------------------------------------- */
/*  GM overrides — the audit layer over the union */
/* -------------------------------------------- */

/**
 * The GM's overrides for the ability-matching union, world-scoped and keyed
 * by ability identity (not by item), so one ruling governs every copy in
 * every party. Tri-state by absence: no entry means automated, `true`/`false`
 * force it in or out. Resetting deletes entries rather than writing `true`.
 */
export const SETTING_ABILITY_OVERRIDES = "abilityOverrides";

/**
 * Identity of an ability for override purposes: its register definition id when
 * it has one (stable across renames — the whole point), else its folded name.
 */
export function abilityKey(item) {
  const id = cookbookId(item);
  if (id) return id;
  return `name:${slug(item?.name)}`;
}

function overrides() {
  try {
    return game.settings.get(MODULE_ID, SETTING_ABILITY_OVERRIDES) ?? {};
  } catch {
    return {}; // setting not registered yet (early call during init)
  }
}

/** The GM's explicit ruling for this ability, or null when on automatic. */
export function overrideFor(item) {
  const v = overrides()[abilityKey(item)];
  return typeof v === "boolean" ? v : null;
}

/** Record a ruling. `null` clears it, returning the ability to automation. */
export async function setOverride(item, value) {
  const all = { ...overrides() };
  const key = abilityKey(item);
  if (value === null) delete all[key];
  else all[key] = !!value;
  return game.settings.set(MODULE_ID, SETTING_ABILITY_OVERRIDES, all);
}

/** Clear every ruling — the reset the audit window offers. */
export async function resetOverrides() {
  return game.settings.set(MODULE_ID, SETTING_ABILITY_OVERRIDES, {});
}

// lib's `scopeApplies` and `nonStackingGroups` are not wrapped here. See
// docs/formation/ROADMAP.md, "Scoped effects for ability matching".
