/**
 * VARIATIONS — an inventory of the ways one item differs from its plain self.
 *
 * An item is a pristine base (`properties.mjs`) plus the variations applied to
 * it. Not one slot per kind: masterwork, a dent, silver plating, a crest and a
 * name can all be true of the same blade at once, and they are added and
 * removed the way its contents are — because they ARE its contents. Each is an
 * `acks-extras.variation` Item flagged `containedIn` at the base
 * (`variation-items.mjs`).
 *
 * This file is Foundry-free. It answers questions about ENTRIES — plain
 * `{id, key, hidden, read, data}` objects — and DEFINITIONS, which say what a
 * key means. `entryOf` and `definitionFrom` read both out of a variation
 * document, so the rules are stated once and a test can exercise them without
 * a document at all.
 *
 * Three rules carry most of the design:
 *
 *  - **Conflict is derived, not authored.** The only exclusivity the books
 *    state is one value for one field, and the key is already namespaced, so
 *    two entries clash when their keys share a prefix. Nothing is declared and
 *    nothing can be declared wrong. A printed cross-family rule (magic
 *    supersedes masterwork) is a definition's `supersedes`, which stays empty
 *    unless a page fills it.
 *  - **`hidden` and `read` are different questions.** `hidden` is "do they know
 *    it is there"; `read` is "do they know what it means". A concealed maker's
 *    mark is the first, an inscription in an unknown script the second, and
 *    collapsing them would make unreadable writing invisible.
 *  - **Hidden governs presentation, never mechanics.** A disguised magic sword
 *    still hits as a magic sword. Deltas always apply in full; hiding decides
 *    what the apparent name, image and price are computed from.
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
 * The family an entry belongs to: its key up to the first dot.
 *
 * `masterwork.weaponToHit` → `masterwork`. This IS the exclusivity group, and
 * deriving it is the whole point — an authored `slot` field would have to be
 * filled in correctly on every imported definition, forever, to reproduce what
 * the namespace already says.
 */
export const familyOf = (key) => String(key ?? "").split(".")[0];

/* -------------------------------------------- */
/*  Reading a variation document                */
/* -------------------------------------------- */

/**
 * The ENTRY a variation document is: which variation, and what is true of this
 * one. Its `id` is the document's, so removing by identity removes the right
 * copy when a blade carries two of the same family in different states.
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
 *
 * Definition and instance travel in one document on purpose — the copy applied
 * to a sword holds its own numbers, so re-importing the register cannot revalue
 * a blade a Judge already priced, and an item exported to a world that imported
 * nothing still reads correctly.
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
 * Why this key may not be added, or null if it may.
 *
 * Every refusal names the entry it collides with, because "cannot add that" is
 * useless when a blade already carries four variations and the Judge cannot see
 * which one objected.
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

  // What it may go ON. `appliesTo` empty means "anything" — most variations do
  // not care, and requiring every definition to enumerate would be noise.
  const appliesTo = definition.appliesTo ?? [];
  if (appliesTo.length && baseType && !appliesTo.includes(baseType)) {
    return { reason: "wrongBaseType", key: definition.key };
  }

  const family = familyOf(definition.key);
  const clash = (entries ?? []).find((e) => familyOf(e.key) === family);
  if (clash) return { reason: "familyClash", key: clash.key };

  // A printed cross-family rule, in either direction. Empty unless a page
  // filled it — magic superseding masterwork is the one known example.
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
 * The cost slots are the ones `properties.mjs` already established, and the
 * ORDER they resolve in is that file's ruling, kept: `costBaseMul` scales the
 * item's own listed price, `costAdd` is then added, and `costMul` scales the
 * whole. Silver multiplies a weapon's price and so must not multiply a flat
 * masterwork surcharge; a scavenged item is worth a fraction of whatever it
 * would otherwise fetch.
 *
 * A definition contributes EITHER flat `deltas` or, when its contribution is
 * not a constant, whatever `contribute(entry, ctx)` computes — a named weapon's
 * bonuses come from its own stored ladder against the wielder's level, and
 * there is no constant for a definition to hold.
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
 * `true` counts every entry; `apparent` counts only the ones on show. That one
 * split does both jobs the design asks of it — an unidentified magic sword
 * reads as a plain one AND is priced as a plain one, because the price falls
 * out of the same resolution rather than being stored a second time.
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
 * NEVER applied. Who the buyer is, what they owe, and whether a dead lord's
 * crest is an asset or evidence in this city are facts the world holds and this
 * schema does not. The module says a claim exists and what it would be worth;
 * a human decides it applies — the same line the trap riders sit on.
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
 * An appearance entry may be in a language. Seeing the inscription is
 * `!hidden`; understanding it needs the language, which is a fact about the
 * reader and so is passed in rather than looked up.
 */
export function isLegible(entry, definition, { languages = [] } = {}) {
  if (entry?.read === false) return false;
  const needed = definition?.language ?? entry?.data?.language ?? null;
  if (!needed) return true;
  return languages.some((l) => String(l).toLowerCase() === String(needed).toLowerCase());
}
