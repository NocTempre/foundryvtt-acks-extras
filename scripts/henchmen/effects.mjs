/* global game, foundry */
/**
 * Modifier discovery: collects Active Effect changes keyed
 * `flags.acks-extras.<domain>` on an actor's proficiency/power items into
 * that domain's modifiers, plus name-regex fallbacks (`config.NAME_FALLBACKS`)
 * for classic-proficiency items that carry no such effect. Full contract
 * (change keys, effect-level metadata flags) is docs/henchmen/MODEL.md §4.
 *
 * Hiring rolls also honor the influence feature's own `flags.acks-extras.
 * reaction` effect convention, so reaction-granting effects feed hiring here.
 */
import { EFFECT_PREFIX, EFFECT_DOMAINS, INFLUENCE_REACTION_KEY, MODULE_ID } from "./constants.mjs";
import { NAME_FALLBACKS } from "./config.mjs";
import { appliedEffects, localizeKey as localize, makeEffectMeta, activeNumericChanges, csvFlagSet, sumModifiers } from "../lib/effect-scan.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";

/**
 * The exact set of change keys this feature speaks. Membership, not a prefix
 * test — a prefix test would also match sibling features' domains and plain
 * item flags like `flags.acks-extras.record`. See docs/DECISIONS.md,
 * "`EFFECT_PREFIX` collapse".
 */
const OWN_CHANGE_KEYS = new Set(Object.values(EFFECT_DOMAINS).map((d) => `${EFFECT_PREFIX}${d}`));

/**
 * @typedef {object} FoundModifier
 * @property {string} id - stable id for dialog inputs
 * @property {string} label - resolved display label
 * @property {number} value
 * @property {boolean} situational - true → dialog toggle, false → auto-applied
 * @property {string} [condition] - localized condition text (why it's situational)
 * @property {string} source - "effect" | "influence-effect" | "item-name"
 */

const effectMeta = makeEffectMeta(MODULE_ID, { legacyLabel: true });

/** Mark the owning Item (if any) of an effect as seen by the collector. */
function markParentItem(effect, seenItems) {
  const parentItem = effect.parent?.documentName === "Item" ? effect.parent : null;
  if (parentItem) seenItems.add(parentItem.id);
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

  for (const { effect, value } of activeNumericChanges(actor, `${EFFECT_PREFIX}${domain}`)) {
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
    markParentItem(effect, seenItems);
  }
  // Track items that carry ANY henchmen-domain change so name-fallback skips them.
  for (const effect of appliedEffects(actor)) {
    if (effect.disabled) continue;
    if ((effect.changes ?? []).some((c) => OWN_CHANGE_KEYS.has(String(c.key ?? "")))) {
      markParentItem(effect, seenItems);
    }
  }

  // The influence feature's reaction effects apply to hiring negotiations.
  if (domain === "hiring") {
    for (const { effect, value } of activeNumericChanges(actor, INFLUENCE_REACTION_KEY)) {
      const inf = effect.flags?.["acks-extras"] ?? {};
      found.push({
        id: `inf-${effect.id ?? foundry.utils.randomID()}`,
        label: inf.label ? localize(inf.label) : (effect.name ?? "acks-extras"),
        value,
        situational: inf.situational !== false,
        condition: inf.tone && inf.tone !== "all" ? String(inf.tone) : null,
        source: "influence-effect",
      });
      markParentItem(effect, seenItems);
    }
  }

  // Name-regex fallback for classic proficiency/power items without effects.
  const fallbacks = NAME_FALLBACKS[domain] ?? [];
  if (fallbacks.length && actor?.items) {
    for (const item of actor.items) {
      if (item.type !== ITEM_TYPE.ability && item.type !== ITEM_TYPE.item) continue;
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
  return sumModifiers(collectEffectModifiers(actor, domain));
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
  const out = csvFlagSet(actor, `${EFFECT_PREFIX}${domain}`);
  // Name fallback: Beast Friendship / Friend(s) of Birds and Beasts unlock animals.
  if (domain === "recruitKinds" && actor?.items) {
    for (const item of actor.items) {
      if (item.type !== ITEM_TYPE.ability && item.type !== ITEM_TYPE.item) continue;
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
