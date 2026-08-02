/* global game */
/**
 * Shared Active-Effect scanning core for the data-driven modifier features
 * (equipment and henchmen carry near-identical collectors; the identical
 * parts live here, their divergent tails stay in the features).
 *
 * DELIBERATELY NOT SHARED — the divergences are semantic, not accidental:
 *  - `hasEffectFlag`: equipment = raw key scan + bridge domains; henchmen =
 *    "would the collector find anything", INCLUDING name fallbacks.
 *  - `effectMeta` label chains differ by one legacy link (`effect.label`),
 *    parameterized below rather than silently unioned.
 *  - henchmen's seenItems dedupe, influence-reaction pass and NAME_FALLBACKS
 *    passes; equipment's abilities-bridge pass.
 */

/** All active effects on the actor, tolerant of Foundry version differences. */
export function appliedEffects(actor) {
  if (!actor) return [];
  if (Array.isArray(actor.appliedEffects)) return actor.appliedEffects;
  return Array.from(actor.effects ?? []);
}

/** Localize when the key exists; otherwise pass the text through unchanged. */
export function localizeKey(key) {
  try {
    return key && game?.i18n?.has?.(key) ? game.i18n.localize(key) : (key ?? "");
  } catch {
    return key ?? "";
  }
}

/**
 * Build a feature's effect-metadata reader.
 * @param {string} moduleId flag scope the metadata lives under
 * @param {{legacyLabel?: boolean}} [opts] include the pre-v11 `effect.label`
 *   link in the label chain (henchmen's historical behavior).
 */
export function makeEffectMeta(moduleId, { legacyLabel = false } = {}) {
  return (effect) => {
    const flags = effect.flags?.[moduleId] ?? {};
    return {
      label: flags.label ?? effect.name ?? (legacyLabel ? (effect.label ?? "") : ""),
      condition: flags.condition ? localizeKey(flags.condition) : null,
      target: flags.target ? localizeKey(flags.target) : null,
    };
  };
}

/**
 * Every enabled effect change on `key` carrying a finite non-zero numeric
 * value: `[{ effect, value }]` in document order.
 */
export function activeNumericChanges(actor, key) {
  const out = [];
  for (const effect of appliedEffects(actor)) {
    if (effect.disabled) continue;
    for (const change of effect.changes ?? []) {
      if (change.key !== key) continue;
      const value = Number(change.value);
      if (!Number.isFinite(value) || value === 0) continue;
      out.push({ effect, value });
    }
  }
  return out;
}

/** Union of the CSV tokens (lowercased) of every enabled change on `key`. */
export function csvFlagSet(actor, key) {
  const out = new Set();
  for (const effect of appliedEffects(actor)) {
    if (effect.disabled) continue;
    for (const change of effect.changes ?? []) {
      if (change.key !== key) continue;
      String(change.value ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .forEach((s) => out.add(s));
    }
  }
  return out;
}

/** Sum of the always-on (non-situational) modifier values. */
export function sumModifiers(mods) {
  return mods.filter((m) => !m.situational).reduce((sum, m) => sum + m.value, 0);
}
