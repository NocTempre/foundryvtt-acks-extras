/**
 * VARIATIONS: the pure rules for the ways one item differs from its plain self
 * (docs/equipment/MODEL.md, "Base types and variations").
 *
 * Foundry-free. It answers questions about ENTRIES (plain
 * `{id, key, hidden, read, data}` objects) and DEFINITIONS (what a key means);
 * `entryOf` and `definitionFrom` read both out of a variation document, which
 * `variation-items.mjs` applies. Three rules: conflict is derived from the key's
 * family, `hidden` and `read` are separate questions, and hidden governs
 * presentation, never mechanics.
 */

/** How a variation is described. Kind is prose about it, never the conflict rule. */
export const VARIATION_KIND = Object.freeze({
  quality: "quality",
  material: "material",
  form: "form",
  named: "named",
  appearance: "appearance",
  magical: "magical",
});

/**
 * The family an entry belongs to: its key up to the first dot
 * (`masterwork.weaponToHit` → `masterwork`). It is the exclusivity group.
 */
export const familyOf = (key) => String(key ?? "").split(".")[0];

/* -------------------------------------------- */
/*  Reading a variation document                */
/* -------------------------------------------- */

/**
 * The ENTRY a variation document is: which variation, and what is true of this
 * one. Its `id` is the document's.
 */
export const entryOf = (variation) => ({
  id: variation?.id ?? null,
  key: variation?.system?.key ?? "",
  data: variation?.system?.data ?? {},
  hidden: !!variation?.system?.hidden,
  read: variation?.system?.read !== false,
});

/**
 * The DEFINITION a variation document carries: what this variation means.
 * Definition and instance travel in one document. See docs/equipment/DECISIONS.md,
 * "A variation is a document, and applying it is putting it inside".
 */
export function definitionFrom(variation) {
  const s = variation?.system;
  if (!s?.key) return null;
  return {
    key: s.key,
    kind: s.kind || undefined,
    appliesTo: s.appliesTo ?? [],
    supersedes: s.supersedes ?? [],
    deltas: s.deltas ?? null,
    cost: s.cost ?? null,
    language: s.language || undefined,
    value: s.conditional?.length ? { conditional: s.conditional } : undefined,
  };
}

/* -------------------------------------------- */
/*  Adding and removing                         */
/* -------------------------------------------- */

/**
 * Why this key may not be added, or null if it may. A refusal names the entry
 * it collides with in `key`.
 *
 * @param {object[]} entries what the item carries now
 * @param {object} definition the definition being added
 * @param {object} [opts]
 * @param {string} [opts.baseType] what the item IS — checked against `appliesTo`
 * @param {(key: string) => object|null} [opts.define] look up another definition,
 *   for reading the `supersedes` of what is already there
 * @returns {{reason: string, key?: string}|null}
 */
export function addRefusal(entries, definition, { baseType = null, define = () => null } = {}) {
  if (!definition?.key) return { reason: "unknownVariation" };

  // An empty `appliesTo` means any base type.
  const appliesTo = definition.appliesTo ?? [];
  if (appliesTo.length && baseType && !appliesTo.includes(baseType)) {
    return { reason: "wrongBaseType", key: definition.key };
  }

  const family = familyOf(definition.key);
  const clash = (entries ?? []).find((e) => familyOf(e.key) === family);
  if (clash) return { reason: "familyClash", key: clash.key };

  // A cross-family `supersedes`, checked in either direction.
  for (const existing of entries ?? []) {
    if ((definition.supersedes ?? []).some((k) => matches(k, existing.key))) {
      return { reason: "supersedes", key: existing.key };
    }
    const theirs = define(existing.key);
    if ((theirs?.supersedes ?? []).some((k) => matches(k, definition.key))) {
      return { reason: "superseded", key: existing.key };
    }
  }
  return null;
}

/** `magical.*` matches any magical key; an exact key matches only itself. */
function matches(pattern, key) {
  const p = String(pattern ?? "");
  if (p.endsWith(".*")) return familyOf(key) === p.slice(0, -2);
  return p === key;
}

/* -------------------------------------------- */
/*  What they add up to                         */
/* -------------------------------------------- */

/**
 * Sum the deltas of a set of entries.
 *
 * The cost slots and their order are `properties.mjs`'s: `costBaseMul` scales
 * the item's own listed price, `costAdd` is then added, and `costMul` scales
 * the whole. A definition contributes EITHER flat `deltas` or, where its
 * contribution is not a constant, whatever `contribute(entry, ctx)` computes.
 *
 * @param {object[]} entries
 * @param {(key: string) => object|null} define
 * @param {object} [ctx] passed to a definition's `contribute`
 */
export function sumDeltas(entries, define, ctx = {}) {
  const total = { bonus: 0, damage: 0, ac: 0, weight6: 0, costAdd: 0, costMul: 1, costBaseMul: 1 };
  for (const entry of entries ?? []) {
    const def = define(entry.key);
    if (!def) continue;
    const d = typeof def.contribute === "function" ? def.contribute(entry, ctx) : def.deltas;
    if (d) {
      total.bonus += d.bonus ?? 0;
      total.damage += d.damage ?? 0;
      total.ac += d.ac ?? 0;
      total.weight6 += d.weight6 ?? 0;
    }
    const cost = typeof def.contribute === "function" ? (d?.cost ?? null) : def.cost;
    if (cost) {
      total.costAdd += cost.add ?? 0;
      total.costMul *= cost.mul ?? 1;
      total.costBaseMul *= cost.baseMul ?? 1;
    }
  }
  return total;
}

/** The item's own price, scaled, with flat surcharges added — but not yet halved. */
export const priceFrom = (base, d) => (Number(base) || 0) * (d.costBaseMul ?? 1) + (d.costAdd ?? 0);

/** The whole price: base scaled, surcharges added, then the whole scaled. */
export const totalPrice = (base, d) => priceFrom(base, d) * (d.costMul ?? 1);

/* -------------------------------------------- */
/*  What is true, and what merely appears true  */
/* -------------------------------------------- */

/** The entries a player is shown: everything not hidden. */
export const visibleVariations = (entries) => (entries ?? []).filter((e) => !e.hidden);

/**
 * What the item is worth, twice over.
 *
 * `true` counts every entry; `apparent` counts only the ones not hidden, both
 * from the same resolution.
 */
export function values(base, entries, define, ctx = {}) {
  return {
    true: totalPrice(base, sumDeltas(entries, define, ctx)),
    apparent: totalPrice(base, sumDeltas(visibleVariations(entries), define, ctx)),
  };
}

/**
 * Conditional value claims that might bear on a sale, gathered for the Judge.
 *
 * Never applied: the claim is offered, and a person decides it applies.
 */
export function conditionalClaims(entries, define) {
  const out = [];
  for (const entry of visibleVariations(entries)) {
    for (const claim of define(entry.key)?.value?.conditional ?? []) {
      out.push({ key: entry.key, ...claim });
    }
  }
  return out;
}

/**
 * Can this entry's legend be read here?
 *
 * Seeing an inscription is `!hidden`; reading it needs the language, which the
 * caller passes in as `languages`.
 */
export function isLegible(entry, definition, { languages = [] } = {}) {
  if (entry?.read === false) return false;
  const needed = definition?.language ?? entry?.data?.language ?? null;
  if (!needed) return true;
  return languages.some((l) => String(l).toLowerCase() === String(needed).toLowerCase());
}
