/* global game, globalThis */

/**
 * Capability-aware ability matching — the bridge to the abilities program
 * (lib vocabulary, abilities effect model, the importer). The capability
 * primitives themselves live in `lib/capabilities.mjs`; this file is how a
 * formation CONSUMES them, plus the GM's overrides. Candidates are the union
 * of capability matches and the existing name matches. lib's vocabulary is
 * imported statically, not read off `globalThis.acksExtras` at call time.
 * See docs/formation/DECISIONS.md, "Capability matching is a union, not a
 * fallback".
 */

import { MODULE_ID } from "./constants.mjs";
import { slug } from "../lib/vocab.mjs";
import { cookbookId } from "../lib/library.mjs";

/**
 * Capability matching itself lives in `lib/capabilities.mjs` — the sense model
 * asks the same question and lib may not import a feature. Re-exported here so
 * this bridge stays the one import site for everything ability-shaped.
 */
export { abilityRefs, hasCapability, itemHasCapability } from "../lib/capabilities.mjs";

/**
 * The skill ladders the world's imported skills carry now live with the
 * abilities, where a borrowed throw reads them (`abilities/skill-ladders.mjs`).
 * Re-exported so formation's windows keep one import site.
 */
export {
  skillDefId,
  invalidateLadders,
  refreshLadders,
  initLadders,
  importedLadderFor,
  importedLadderTarget,
  importedSkillKeys,
  ladderRows,
} from "../abilities/skill-ladders.mjs";

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
