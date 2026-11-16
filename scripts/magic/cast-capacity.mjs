/**
 * Whether a caster has a spell left to cast: the class tradition that cast the
 * spell, a slot of the spell's level on it, and what the actor has spent.
 * FOUNDRY-FREE: the class's `casting` list, the pools (`classes/casting.mjs`
 * `poolState`) and core's counts are read by the caller and passed in.
 *
 * Three sources answer, in order. A vancian tradition's slot at the spell's
 * level, spent from the actor's own pool; a points tradition, shown and never
 * spent here; else core's own count, the level's `system.spells.<n>.max`
 * against the `cast` counts of the actor's spells at that level. With none of
 * them the capacity is unknown and no verdict is given.
 */
import { foldKey, spellTraditions } from "./spell-logic.mjs";
import { levelUnder } from "./spell-names.mjs";

/** The verdicts a capacity gives. */
export const CAPACITY = Object.freeze({ ok: "ok", none: "none", unknown: "unknown" });

/**
 * The tradition of a class that cast this spell, and the spell's level under
 * it. A tradition matches by its key or its label, folded, against the lists
 * the spell prints on (core's `class` string where it prints none).
 *
 * @param {object[]} casting  the class's `system.casting`
 * @param {object} spell  `{extras, lvl, class}`: the spell flag, core's level and core's class string
 * @returns {{tradition: object, spellLevel: number|null}|null}
 */
export function traditionFor(casting, { extras, lvl, class: systemClass } = {}) {
  const sources = new Set(spellTraditions(extras, systemClass));
  for (const tradition of casting ?? []) {
    const keys = new Set([foldKey(tradition?.key), foldKey(tradition?.label)].filter(Boolean));
    if (![...keys].some((k) => sources.has(k))) continue;
    return { tradition, spellLevel: levelUnder(extras, lvl, keys) };
  }
  return null;
}

/**
 * What the caster has left of the spell's level.
 *
 * @param {object} from
 * @param {Array<{key: string, kind: string, slots?: Array<{n: number, max: number, used: number}>, pool?: object}>} [from.pools]  `poolState`'s answer
 * @param {Record<string, {max?: number}>} [from.coreSpells]  core's `system.spells`
 * @param {number} [from.castsAtLevel]  the sum of `system.cast` over the actor's spells of this level
 * @param {string|null} [from.tradition]  the matched tradition's key
 * @param {number|null} [from.spellLevel]
 * @returns {{verdict: string, tradition: string|null, spellLevel: number|null, max: number|null, used: number|null,
 *   source: "tradition"|"pool"|"core"|null, slotKey: string|null}}
 */
export function castCapacity({ pools = [], coreSpells = null, castsAtLevel = 0, tradition = null, spellLevel = null } = {}) {
  const base = { tradition, spellLevel, max: null, used: null, source: null, slotKey: null };
  const entry = tradition ? pools.find((p) => p.key === tradition) : null;
  if (entry?.slots && Number.isFinite(spellLevel)) {
    const slot = entry.slots.find((s) => s.n === spellLevel);
    const max = slot?.max ?? 0;
    const used = slot?.used ?? 0;
    return { ...base, verdict: used < max ? CAPACITY.ok : CAPACITY.none, max, used, source: "tradition", slotKey: `s${spellLevel}` };
  }
  if (entry?.pool) return { ...base, verdict: CAPACITY.unknown, max: entry.pool.max, used: entry.pool.used, source: "pool", slotKey: "points" };
  const max = Number(coreSpells?.[spellLevel]?.max);
  if (Number.isFinite(spellLevel) && Number.isFinite(max) && max > 0) {
    const used = Math.max(0, Number(castsAtLevel) || 0);
    return { ...base, verdict: used < max ? CAPACITY.ok : CAPACITY.none, max, used, source: "core" };
  }
  return { ...base, verdict: CAPACITY.unknown };
}

/** Does this capacity spend from the tradition's own pool (a vancian slot)? */
export const spendsFromPool = (capacity) => capacity?.source === "tradition" && Boolean(capacity.tradition) && Boolean(capacity.slotKey);
