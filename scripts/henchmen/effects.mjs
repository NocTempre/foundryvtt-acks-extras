/* global game, foundry */
/**
 * Modifier discovery: collects Active Effect changes keyed
 * `flags.acks-extras.<domain>` on an actor's proficiency/power items into
 * that domain's modifiers, then the typed effects the importer located on an
 * ability's page (for the domains in `TYPED_TARGETS`). An item that only
 * NAMES a domain's power (`config.NAME_PRESENCE`) contributes no value: it
 * makes `hasEffectFlag` true and `unvaluedPowers` names it. Full contract
 * (change keys, effect-level metadata flags) is docs/henchmen/MODEL.md §4.
 *
 * Hiring rolls also honor the influence feature's own `flags.acks-extras.
 * reaction` effect convention, so reaction-granting effects feed hiring here.
 */
import { EFFECT_PREFIX, EFFECT_DOMAINS, INFLUENCE_REACTION_KEY, MODULE_ID } from "./constants.mjs";
import { NAME_PRESENCE } from "./config.mjs";
import { localizeKey as localize, makeEffectMeta, activeNumericChanges, csvFlagSet, sumModifiers, abilityModifiers } from "../lib/effect-scan.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";

/**
 * The domains whose value the importer locates on the page, each to the
 * `MODIFIER_TARGETS` key the typed effect on the ability carries. A hiring
 * offer is a reaction roll, so it reads the abilities' reaction modifiers.
 */
const TYPED_TARGETS = Object.freeze({
  [EFFECT_DOMAINS.HIRING]: "reaction",
  [EFFECT_DOMAINS.RETAIN_BONUS]: "retainBonus",
  [EFFECT_DOMAINS.BASE_LOYALTY]: "baseLoyalty",
  [EFFECT_DOMAINS.HENCHMAN_MORALE]: "henchmanMorale",
  [EFFECT_DOMAINS.MARKET_CLASS]: "marketClass",
});

/**
 * The typed domains read into a roll's dialog, where a value can be offered
 * unticked. The others are sums (a limit, a base loyalty, a class shift) with
 * no row to offer, so they take the located value whether or not its entry is
 * audited.
 */
const ROLLED_DOMAINS = new Set([EFFECT_DOMAINS.HIRING, EFFECT_DOMAINS.HENCHMAN_MORALE]);

/**
 * @typedef {object} FoundModifier
 * @property {string} id - stable id for dialog inputs
 * @property {string} label - resolved display label
 * @property {number} value
 * @property {boolean} situational - true → dialog toggle, false → auto-applied
 * @property {string} [condition] - localized condition text (why it's situational)
 * @property {string} source - "effect" | "influence-effect" | "ability"
 * @property {string|null} itemId - the item the value rides, null for an effect on the actor itself
 */

const effectMeta = makeEffectMeta(MODULE_ID, { legacyLabel: true });

/** The id of the Item an effect rides, or null for one on the actor itself. */
function parentItemId(effect) {
  return effect.parent?.documentName === "Item" ? effect.parent.id : null;
}

/** Add the owning Item (if any) of an effect to `items`. */
function markParentItem(effect, items) {
  const id = parentItemId(effect);
  if (id) items.add(id);
}

/** An ability or item whose name proves the domain's power (`NAME_PRESENCE`). */
function namesPower(item, domain) {
  const pattern = NAME_PRESENCE[domain];
  if (!pattern || (item.type !== ITEM_TYPE.ability && item.type !== ITEM_TYPE.item)) return false;
  return new RegExp(pattern, "i").test((item.name ?? "").trim());
}

/**
 * Collect every modifier an actor's effects contribute to one domain.
 * @param {Actor} actor
 * @param {string} domain - one of EFFECT_DOMAINS values, e.g. "hiring"
 * @returns {FoundModifier[]}
 */
export function collectEffectModifiers(actor, domain) {
  const found = [];
  // The items whose own Active Effect speaks for THIS domain: the page's typed value stands aside for them.
  const domainItems = new Set();

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
      itemId: parentItemId(effect),
    });
    markParentItem(effect, domainItems);
  }

  // The influence feature's reaction effects apply to hiring negotiations, and
  // an item whose reaction effect speaks stands aside for its page value too.
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
        itemId: parentItemId(effect),
      });
      markParentItem(effect, domainItems);
    }
  }

  // The page's own value, as the importer located it on the ability: read where
  // the item's own Active Effect does not already speak for this domain. These
  // reads know nothing of the roll's tone or its target, so a modifier scoped to
  // either is offered, never applied; on a roll, so is a draft entry's.
  const target = TYPED_TARGETS[domain];
  if (target) {
    for (const mod of abilityModifiers(actor, target, { skipItemIds: domainItems })) {
      const draft = mod.unaudited && ROLLED_DOMAINS.has(domain);
      const scopeNote = [...mod.tones.map((tone) => localize(`ACKS-INFLUENCE.tone.${tone}`)), ...mod.vsKinds].join(", ");
      found.push({
        id: `ab-${mod.itemId}-${mod.index}-${domain}`,
        label: mod.label,
        value: mod.value,
        situational: mod.situational || draft,
        condition: mod.condition ?? (scopeNote || (draft ? localize("ACKS-ABILITIES.warn.unaudited") : null)),
        source: "ability",
        itemId: mod.itemId ?? null,
      });
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
 * skipCalamityLoyalty), or the actor holds the domain's power by name alone.
 */
export function hasEffectFlag(actor, domain) {
  return collectEffectModifiers(actor, domain).length > 0 || Array.from(actor?.items ?? []).some((item) => namesPower(item, domain));
}

/**
 * The actor's items that name a domain's power (`NAME_PRESENCE`) but carry no
 * value for it: no Active Effect change on a key the domain reads (its own,
 * and for hiring the influence feature's reaction key) and no typed modifier
 * from the page. For a surface that says the value has not been imported.
 * Empty for a domain with no value to import, where the name is the whole of
 * the power.
 * @returns {{id: string, name: string}[]}
 */
export function unvaluedPowerItems(actor, domain) {
  const target = TYPED_TARGETS[domain];
  if (!target || !NAME_PRESENCE[domain] || !actor?.items) return [];
  const keys = new Set([`${EFFECT_PREFIX}${domain}`, ...(domain === EFFECT_DOMAINS.HIRING ? [INFLUENCE_REACTION_KEY] : [])]);
  const typed = new Set(abilityModifiers(actor, target).map((m) => m.itemId));
  const out = [];
  for (const item of actor.items) {
    if (!namesPower(item, domain) || typed.has(item.id)) continue;
    if (Array.from(item.effects ?? []).some((e) => !e.disabled && (e.changes ?? []).some((c) => keys.has(c.key)))) continue;
    out.push({ id: item.id, name: item.name });
  }
  return out;
}

/** The names of `unvaluedPowerItems`. */
export function unvaluedPowers(actor, domain) {
  return unvaluedPowerItems(actor, domain).map((item) => item.name);
}

/**
 * A domain's modifiers in the shape an influence-hosted page takes as
 * `ctx.offeredModifiers`, optionally only those from some sources (a page
 * that reads the influence reaction key and the abilities' reaction values
 * itself is offered only the rest).
 * @param {Actor} actor
 * @param {string} domain
 * @param {{sources?: string[]}} [opts]
 * @returns {{id: string, label: string, value: number, situational: boolean, itemId?: string}[]}
 */
export function offeredRows(actor, domain, { sources = null } = {}) {
  if (!actor) return [];
  return collectEffectModifiers(actor, domain)
    .filter((m) => !sources || sources.includes(m.source))
    .map(({ id, label, value, situational, itemId }) => ({ id, label, value, situational, ...(itemId ? { itemId } : {}) }));
}

/**
 * Note rows for an influence-hosted page, one per power `unvaluedPowerItems`
 * names, each carrying its item's id so a page that draws that item as a row
 * of its own can leave the note out.
 * @returns {{label: string, note: true, itemId: string}[]}
 */
export function unvaluedNoteRows(actor, domain) {
  if (!actor) return [];
  return unvaluedPowerItems(actor, domain).map((item) => ({
    label: globalThis.game?.i18n?.format?.("ACKS-HENCHMEN.influence.unvaluedNote", { name: item.name }) ?? item.name,
    note: true,
    itemId: item.id,
  }));
}

/**
 * ThrowDialog rows for the powers `unvaluedPowers` names: shown where the
 * bonus would apply, unticked and locked at no value, so the roll says what
 * is missing rather than leaving it out without a word.
 */
export function unvaluedDialogModifiers(actor, domain) {
  return unvaluedPowers(actor, domain).map((name, index) => ({
    id: `unvalued-${domain}-${index}`,
    kind: "situational",
    control: "checkbox",
    value: 0,
    label: name,
    hint: "ACKS-HENCHMEN.effects.unvalued",
    dynamicInitial: false,
    dynamicLocked: true,
  }));
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
