/* global game, globalThis, Hooks */

/**
 * Capability-aware ability matching — the bridge to the abilities program
 * (acks-lib vocabulary, acks-abilities effect model, acks-content import).
 * The capability primitives themselves live in `lib/capabilities.mjs`; what
 * this file adds is how a formation CONSUMES them, plus the skill ladders.
 *
 * **Union, not fallback.** Capability matching is precise but only as complete
 * as the register: Eavesdropping is a real listening proficiency that does not
 * yet declare `kw:listening`, and a strict capability check would silently drop
 * it. So candidates are the UNION of capability matches and the existing name
 * matches — never fewer members than before, plus the ones a rename would have
 * hidden.
 *
 * acks-lib is a hard `requires` of this module and its vocabulary is imported
 * STATICALLY, exactly like `slug` below. The first cut looked the functions up
 * on `globalThis.acksExtras?.lib` at call time instead — and when the public object
 * grew a `vocab` namespace, `acksLib.satisfies` stopped existing and both
 * capability checks silently returned false forever: every dragged cookbook
 * skill fell back to Adventuring, mislabelled and unbonused. A static import
 * cannot drift from the API surface like that; if the function moves, the
 * module fails loudly at load instead of guessing quietly at runtime.
 */

import { MODULE_ID } from "./constants.mjs";
import { slug, resolveLevelValue } from "../lib/vocab.mjs";

// Declared here as well as in lib/capabilities.mjs: the flag-scope validator
// resolves a scope to its literal value within the calling file. Read via the
// raw flag path, never getFlag — the importer need not be active (getFlag
// throws for an inactive scope) while the data it wrote persists on the item.
const DEFINITION_SCOPE = "acks-importer";
const ABILITIES_ID = "acks-extras";

/**
 * Capability matching itself lives in `lib/capabilities.mjs` — the sense model
 * asks the same question and lib may not import a feature. Re-exported here so
 * this bridge stays the one import site for everything ability-shaped.
 */
export { abilityRefs, hasCapability, itemHasCapability } from "../lib/capabilities.mjs";

/**
 * The throw target an imported ability carries, resolved at `level` — or null.
 *
 * acks-content materializes each classified throw into the acks-abilities
 * extras (`extras.rolls[].target`, an acks-lib LevelValue carried WHOLE), and
 * deliberately never writes `system.rollTarget`. So the number a party roll
 * needs lives here for exactly the items the program produces.
 *
 * **A thief skill's whole level ladder arrives this way.** The cookbook's
 * `progression` op reads the grid column out of the seat's own book and emits
 * `{kind:"breakpoints"}`, which `resolveLevelValue` answers at any level — this
 * module does not need, and no longer keeps, a table of its own. (An earlier
 * note here claimed these ladders resolved to nothing because they were
 * `kind:"progression"`, the LevelValue kind that defers to an external class
 * table. They are not: the executor emits breakpoints, and it was only this
 * module preferring its own copy that hid the fact.)
 *
 * Returns null for the importer's flat-0 "no target extracted" sentinel so the
 * caller can fall through to its own answer.
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
/*  Skill ladders, sourced from acks-content     */
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
 * Where the imported definitions actually live.
 *
 * acks-content's `importToCompendium` setting sends every import to a WORLD
 * compendium ("ACKS Cookbook — Item") instead of the item directory, so a read
 * that only walks `game.items` finds nothing in exactly the worlds that have
 * imported the most. acks-content learned this the hard way — the setting moved
 * the WRITES and not the READS, and its dedup silently duplicated everything —
 * and the same trap caught this module's first cut, live, on a test world with
 * 467 imported items and an empty `game.items`.
 *
 * Pack documents load asynchronously and `scaledSkillTarget` is called inside a
 * roll loop, so the ladders are cached. The cache is built once and dropped
 * whenever an item changes; nothing here is on a hot path except the read.
 */
let ladderCache = null;
let refreshQueued = false;

/**
 * Schedule a rebuild — deliberately WITHOUT dropping the current map.
 *
 * A ladder is a page out of the GM's book: it does not change between one roll
 * and the next, so serving a slightly stale one costs nothing. Serving `null`
 * costs a great deal — the read is synchronous, so an emptied cache silently
 * downgrades every borrowed skill to its sheet target. Live-caught exactly
 * that way: creating an actor fires `createItem`, which emptied the cache
 * microseconds before the party roll that needed it, and three members
 * quietly rolled against the wrong numbers.
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
  const id = item?.type === "ability" ? item.flags?.[DEFINITION_SCOPE]?.cookbook?.id : null;
  if (!id?.startsWith(SKILL_PREFIX)) return;
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
 * that skill — the definition acks-content materialized from the GM's own book.
 *
 * This is what the `thiefSkill` flag means now: not an index into a table this
 * module ships, but a POINTER at a cookbook definition ("scale as Listening
 * does"). An item that carries its own ladder never needs this; a hand-bound or
 * pre-0.28.0 item has no ladder of its own and borrows the real one.
 *
 * The owning actor is searched first and synchronously — a character holding
 * the skill answers without touching the cache at all — then the cached index
 * of world items and packs. Returns null when the skill has not been imported,
 * which is a real state and not an error: the caller falls back to the item's
 * own sheet target and the Skill Audit says so in as many words.
 */
export function importedLadderFor(key, actor = null) {
  if (!key) return null;
  const id = skillDefId(key);
  const carries = (item) =>
    item?.type === "ability" && item.flags?.[DEFINITION_SCOPE]?.cookbook?.id === id ? ladderOf(item) : null;
  // Everything readable synchronously is read synchronously, so a world that
  // imports into the item directory never depends on the cache at all.
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
 * The union is deliberately generous, so the GM needs somewhere to see what it
 * caught and overrule it. Overrides are stored world-scoped and keyed by
 * ABILITY IDENTITY, not by item: "does Eavesdropping count as listening" is a
 * ruling about the rules, not about one character's copy of the item, so one
 * decision governs every copy in every party.
 *
 * Tri-state by absence: no entry means automation decides (the default), `true`
 * forces the ability in, `false` forces it out. Resetting deletes entries
 * rather than writing `true`, so "back to automated defaults" really is the
 * automated default and not a snapshot of it.
 */
export const SETTING_ABILITY_OVERRIDES = "abilityOverrides";

/**
 * Identity of an ability for override purposes: its register definition id when
 * it has one (stable across renames — the whole point), else its folded name.
 */
export function abilityKey(item) {
  const id = item?.flags?.[DEFINITION_SCOPE]?.cookbook?.id;
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

/*
 * Deliberately NOT wrapped here yet: acks-lib's `scopeApplies` (the 0.6.0
 * scoping primitive) and `nonStackingGroups`.
 *
 * `scopeApplies` answers WHEN a modifier applies — `vsKinds`, `vsAlignment`,
 * `tones`, `optionalRule`, `kickerAt`. This module cannot use it until it
 * consumes cookbook `effects` instead of its own hardcoded bonuses (retirement
 * Phase 4), because today there is no scoped effect in the pipeline for it to
 * gate. Wrapping it now would be an untested indirection with no caller.
 * When Phase 4 lands, the rule to honour is that **`undetermined` is not
 * `false`**: an unsettled scope must surface as a manual toggle, not silently
 * drop the bonus.
 *
 * `nonStackingGroups` is likewise unnecessary so far: every capability this
 * module reads is consumed as a boolean (`hasCapability`), so holding the same
 * capability twice already cannot double-apply.
 */
