/* global game, foundry */
/**
 * Modifier discovery — the heart of the module's data-driven design.
 *
 * Mechanics live as Active Effect changes on proficiency/power Items
 * (`ability` type in acks), NOT as hardcoded proficiency lists. Any effect
 * change whose key is `flags.acks-henchmen.<domain>` contributes its value to
 * that modifier domain. Per-effect metadata is read from the effect's own
 * flags:
 *   flags["acks-henchmen"].label      — display label (defaults to effect/item name)
 *   flags["acks-henchmen"].condition  — i18n key or text; marks the bonus as
 *                                       situational → rendered as a toggle in
 *                                       roll dialogs (GM/player decides if it
 *                                       applies), like acks-influence's
 *                                       `situational` convention.
 *   flags["acks-henchmen"].target     — free-text scope note (e.g. "animal",
 *                                       "sameReligion") appended to the label.
 *
 * For hiring rolls we also honor acks-influence's Active Effect convention
 * (`flags.acks-influence.reaction` + its `situational`/`tone`/`label` flags),
 * so reaction-granting effects written for that module feed hiring here.
 *
 * Fallback (decision K / graceful degradation): items named like the classic
 * book proficiencies with NO acks-henchmen effect changes are recovered via
 * config.NAME_FALLBACKS name regexes.
 */
import { EFFECT_PREFIX, INFLUENCE_REACTION_KEY, MODULE_ID } from "./constants.mjs";
import { NAME_FALLBACKS } from "./config.mjs";

/**
 * @typedef {object} FoundModifier
 * @property {string} id - stable id for dialog inputs
 * @property {string} label - resolved display label
 * @property {number} value
 * @property {boolean} situational - true → dialog toggle, false → auto-applied
 * @property {string} [condition] - localized condition text (why it's situational)
 * @property {string} source - "effect" | "influence-effect" | "item-name"
 */

/** All active effects on the actor, tolerant of Foundry version differences. */
function appliedEffects(actor) {
  if (!actor) return [];
  if (Array.isArray(actor.appliedEffects)) return actor.appliedEffects;
  return Array.from(actor.effects ?? []);
}

function localize(key) {
  try {
    return key && game?.i18n?.has?.(key) ? game.i18n.localize(key) : key ?? "";
  } catch {
    return key ?? "";
  }
}

function effectMeta(effect) {
  const flags = effect.flags?.[MODULE_ID] ?? {};
  return {
    label: flags.label ?? effect.name ?? effect.label ?? "",
    condition: flags.condition ? localize(flags.condition) : null,
    target: flags.target ? localize(flags.target) : null,
  };
}

/**
 * Collect every modifier an actor's effects contribute to one domain.
 * @param {Actor} actor
 * @param {string} domain - one of EFFECT_DOMAINS values, e.g. "hiring"
 * @returns {FoundModifier[]}
 */
export function collectEffectModifiers(actor, domain) {
  const found = [];
  const seenItems = new Set();
  const key = `${EFFECT_PREFIX}${domain}`;

  for (const effect of appliedEffects(actor)) {
    if (effect.disabled) continue;
    for (const change of effect.changes ?? []) {
      if (change.key !== key) continue;
      const value = Number(change.value);
      if (!Number.isFinite(value) || value === 0) continue;
      const meta = effectMeta(effect);
      const label = meta.target ? `${meta.label} (${meta.target})` : meta.label;
      found.push({
        id: `fx-${effect.id ?? foundry.utils.randomID()}-${domain}`,
        label,
        value,
        situational: !!meta.condition,
        condition: meta.condition,
        source: "effect",
      });
      const parentItem = effect.parent?.documentName === "Item" ? effect.parent : null;
      if (parentItem) seenItems.add(parentItem.id);
    }
    // Track items that carry ANY acks-henchmen change so name-fallback skips them.
    if ((effect.changes ?? []).some((c) => c.key?.startsWith(EFFECT_PREFIX))) {
      const parentItem = effect.parent?.documentName === "Item" ? effect.parent : null;
      if (parentItem) seenItems.add(parentItem.id);
    }
  }

  // acks-influence reaction effects apply to hiring negotiations.
  if (domain === "hiring") {
    for (const effect of appliedEffects(actor)) {
      if (effect.disabled) continue;
      for (const change of effect.changes ?? []) {
        if (change.key !== INFLUENCE_REACTION_KEY) continue;
        const value = Number(change.value);
        if (!Number.isFinite(value) || value === 0) continue;
        const inf = effect.flags?.["acks-influence"] ?? {};
        found.push({
          id: `inf-${effect.id ?? foundry.utils.randomID()}`,
          label: inf.label ? localize(inf.label) : (effect.name ?? "acks-influence"),
          value,
          situational: inf.situational !== false,
          condition: inf.tone && inf.tone !== "all" ? String(inf.tone) : null,
          source: "influence-effect",
        });
        const parentItem = effect.parent?.documentName === "Item" ? effect.parent : null;
        if (parentItem) seenItems.add(parentItem.id);
      }
    }
  }

  // Name-regex fallback for classic proficiency/power items without effects.
  const fallbacks = NAME_FALLBACKS[domain] ?? [];
  if (fallbacks.length && actor?.items) {
    for (const item of actor.items) {
      if (item.type !== "ability" && item.type !== "item") continue;
      if (seenItems.has(item.id)) continue;
      const hasOwnChanges = Array.from(item.effects ?? []).some((e) =>
        (e.changes ?? []).some((c) => c.key?.startsWith(EFFECT_PREFIX))
      );
      if (hasOwnChanges) continue;
      const name = (item.name ?? "").toLowerCase().trim();
      for (const fb of fallbacks) {
        if (!new RegExp(fb.pattern, "i").test(name)) continue;
        found.push({
          id: `nm-${item.id}-${domain}`,
          label: item.name,
          value: fb.value,
          situational: !!fb.condition,
          condition: fb.condition ? localize(fb.condition) : null,
          source: "item-name",
        });
        break;
      }
    }
  }
  return found;
}

/**
 * Sum the always-on (non-situational) modifiers of a domain.
 * @returns {number}
 */
export function sumEffectModifiers(actor, domain) {
  return collectEffectModifiers(actor, domain)
    .filter((m) => !m.situational)
    .reduce((sum, m) => sum + m.value, 0);
}

/**
 * True when any active effect sets the boolean-ish domain (e.g.
 * skipCalamityLoyalty). Name fallback included.
 */
export function hasEffectFlag(actor, domain) {
  return collectEffectModifiers(actor, domain).length > 0;
}

/**
 * Collect string-valued effect flags of a domain (e.g. recruitKinds — CSV
 * strings like "animal,fungal" from Beast Friendship / Fungal Friendship).
 * @returns {Set<string>}
 */
export function collectStringFlags(actor, domain) {
  const out = new Set();
  const key = `${EFFECT_PREFIX}${domain}`;
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
  // Name fallback: Beast Friendship / Friend(s) of Birds and Beasts unlock animals.
  if (domain === "recruitKinds" && actor?.items) {
    for (const item of actor.items) {
      if (item.type !== "ability" && item.type !== "item") continue;
      if (/^beast friendship|^close friend of birds|^friends? of birds? and beasts?/i.test(item.name ?? "")) out.add("animal");
      if (/^fungal friendship/i.test(item.name ?? "")) out.add("fungal");
    }
  }
  return out;
}

/**
 * Convert found modifiers into ThrowDialog dynamic-modifier rows:
 * always-on ones arrive checked+locked, situational ones as toggles.
 */
export function toDialogModifiers(mods) {
  return mods.map((m) => ({
    id: m.id,
    kind: m.situational ? "situational" : "auto",
    control: "checkbox",
    value: m.value,
    label: m.label,
    hint: m.condition ?? "",
    dynamicInitial: !m.situational,
    dynamicLocked: !m.situational,
  }));
}
