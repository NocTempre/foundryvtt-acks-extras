/* global game */
/**
 * Shared Active-Effect scanning core for the data-driven modifier features
 * (equipment, henchmen and the character sheet read their modifiers through
 * it; the identical parts live here, the divergent tails stay in the
 * features).
 *
 * A change is read the way Foundry 14 applies it. Each carries a string
 * `type` — a key of `CONST.ACTIVE_EFFECT_CHANGE_TYPES`, whose value is that
 * type's default priority — and an optional `priority`. Every enabled change
 * on a key applies in priority order, ties in document order, onto the
 * field's base: `add` and `subtract` shift it, `multiply` scales it,
 * `override` sets it, `upgrade` and `downgrade` bound it, and any other type
 * (`custom`, or one a package registered) is that package's to apply and
 * contributes nothing here. The numeric `mode` the retired enum named
 * survives on a change only as a shim that logs a deprecation on every read,
 * so nothing here touches it.
 *
 * DELIBERATELY NOT SHARED — the divergences are semantic, not accidental:
 *  - `hasEffectFlag`: equipment = raw key scan + bridge domains; henchmen =
 *    "would the collector find anything", INCLUDING name fallbacks.
 *  - `effectMeta` label chains differ by one legacy link (`effect.label`),
 *    parameterized below rather than silently unioned.
 *  - henchmen's seenItems dedupe, influence-reaction pass and NAME_FALLBACKS
 *    passes; equipment's abilities-bridge pass.
 */

/** The change types Foundry applies itself, by the string each carries. */
export const CHANGE = Object.freeze({
  ADD: "add",
  SUBTRACT: "subtract",
  MULTIPLY: "multiply",
  OVERRIDE: "override",
  UPGRADE: "upgrade",
  DOWNGRADE: "downgrade",
  CUSTOM: "custom",
});

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

/** A change's type; one that names none is an `add`, the field's own initial. */
export const changeType = (change) => (typeof change?.type === "string" && change.type ? change.type : CHANGE.ADD);

/**
 * The priority a change applies at: its own where it states one, else its
 * type's default from core's enum or from a registered type's config, else
 * zero.
 */
export function changePriority(change) {
  const own = change?.priority;
  if (typeof own === "number" && Number.isFinite(own)) return own;
  const type = changeType(change);
  const core = globalThis.CONST?.ACTIVE_EFFECT_CHANGE_TYPES?.[type];
  if (typeof core === "number" && Number.isFinite(core)) return core;
  const registered = globalThis.CONFIG?.ActiveEffect?.changeTypes?.[type]?.defaultPriority;
  return typeof registered === "number" && Number.isFinite(registered) ? registered : 0;
}

/**
 * Every enabled change on `key` with its effect, in the order Foundry
 * applies them: by priority, ties in document order.
 * @returns {{effect: object, change: object}[]}
 */
export function orderedChanges(actor, key) {
  const out = [];
  for (const effect of appliedEffects(actor)) {
    if (effect.disabled) continue;
    for (const change of effect.changes ?? []) if (change.key === key) out.push({ effect, change });
  }
  // The sort is stable, so equal priorities keep document order.
  return out.sort((a, b) => changePriority(a.change) - changePriority(b.change));
}

/**
 * The value a numeric field holds after one change: `current` unchanged when
 * the change's value is not a number or its type is not one Foundry applies
 * to numbers itself.
 */
export function applyNumericChange(current, change) {
  const raw = change?.value;
  if (raw === null || raw === undefined || String(raw).trim() === "") return current;
  const delta = Number(raw);
  if (!Number.isFinite(delta)) return current;
  switch (changeType(change)) {
    case CHANGE.ADD:
      return current + delta;
    case CHANGE.SUBTRACT:
      return current - delta;
    case CHANGE.MULTIPLY:
      return current * delta;
    case CHANGE.OVERRIDE:
      return delta;
    case CHANGE.UPGRADE:
      return Math.max(current, delta);
    case CHANGE.DOWNGRADE:
      return Math.min(current, delta);
    default:
      return current;
  }
}

/**
 * What each enabled change on `key` does to the field, replayed in Foundry's
 * order from `base`: `[{ effect, change, type, value }]`, where `value` is
 * the signed step that change made. The steps sum to the field's net change,
 * so an `override` or a `multiply` reads as the shift it actually caused and
 * a `subtract` reads negative. A change that moves nothing is left out.
 * @param {object} actor
 * @param {string} key
 * @param {{base?: number}} [options] the field's value before any effect; a
 *   modifier domain no field backs starts from zero.
 */
export function activeNumericChanges(actor, key, { base = 0 } = {}) {
  const out = [];
  let current = typeof base === "number" && Number.isFinite(base) ? base : 0;
  for (const { effect, change } of orderedChanges(actor, key)) {
    const next = applyNumericChange(current, change);
    const value = next - current;
    if (!Number.isFinite(value) || value === 0) continue;
    out.push({ effect, change, type: changeType(change), value });
    current = next;
  }
  return out;
}

/** The net shift every enabled change on `key` makes to the field, from `base`. */
export function netNumericChange(actor, key, base = 0) {
  return activeNumericChanges(actor, key, { base }).reduce((sum, step) => sum + step.value, 0);
}

/** The tokens of a CSV value: trimmed, lowercased, empties dropped. */
export const csvTokens = (value) =>
  String(value ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/**
 * The CSV tokens (lowercased) in force on `key`, read the way Foundry applies
 * changes to a set: in priority order, `add` puts tokens in, `subtract`
 * takes them out and `override` replaces the lot; any other type leaves the
 * set alone.
 */
export function csvFlagSet(actor, key) {
  let out = new Set();
  for (const { change } of orderedChanges(actor, key)) {
    const tokens = csvTokens(change.value);
    switch (changeType(change)) {
      case CHANGE.ADD:
        for (const token of tokens) out.add(token);
        break;
      case CHANGE.SUBTRACT:
        for (const token of tokens) out.delete(token);
        break;
      case CHANGE.OVERRIDE:
        out = new Set(tokens);
        break;
      default:
        break;
    }
  }
  return out;
}

/** Sum of the always-on (non-situational) modifier values. */
export function sumModifiers(mods) {
  return mods.filter((m) => !m.situational).reduce((sum, m) => sum + m.value, 0);
}
