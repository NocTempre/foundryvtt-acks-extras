/**
 * The Foundry-FREE half of the location schema migration, split out so it
 * imports under Node and is unit-tested offline (the same split as
 * storage-logic.mjs vs storage.mjs). `LocationData.migrateData` is a one-line
 * call into this.
 *
 * v1 → v2: the market fields were siblings of `region` on every location. They
 * are now the `market` subtree, and a place that never had a market gets `null`
 * — which is the whole point of the 2026-08-02 ruling that markets are opt-in:
 * a cave must not carry a recruitment schema, not even an empty one.
 */

/** Every field that moved under `market`. Order is documentation, not logic. */
export const MARKET_KEYS = Object.freeze([
  // derivation inputs
  "marketClassOverride", "urbanFamilies", "domainUuid", "classRarityTableId",
  "settlementAlignment", "desertRealm", "compositeVariant", "demographics",
  // running state
  "monthAnchorTime", "marketLog", "pendingHires", "marketRolls",
  "postings", "candidates", "specialHires", "slander", "searchLedger",
]);

/**
 * The three settings that every location ever created carried at these values.
 * Finding one of them at its default proves nothing about whether this place is
 * a market — only a DIFFERENT value does.
 */
const INERT_DEFAULTS = Object.freeze({
  classRarityTableId: "default",
  settlementAlignment: "lawful",
  compositeVariant: "composite",
});

/**
 * Did this location actually have a market, or merely the schema for one?
 *
 * The judgement that decides whether an existing world wakes up with markets
 * everywhere or nowhere. Anything with content — a posting, a candidate, a
 * slander entry, a non-default setting — kept its market. An empty, untouched
 * location becomes market-less, which is the new default and what its GM would
 * have wanted all along.
 */
export function looksLikeAMarket(source) {
  return MARKET_KEYS.some((key) => {
    const value = source?.[key];
    if (value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (key in INERT_DEFAULTS) return !!value && value !== INERT_DEFAULTS[key];
    return !!value;
  });
}

/**
 * Fold the loose market fields of a v1 location into `source.market`.
 *
 * MUTATES AND RETURNS `source`, because that is the contract Foundry's
 * `migrateData` has. Idempotent: a source that already carries `market` (in any
 * state, including null) is left alone, which is what makes it safe to run on
 * every clean rather than only on load.
 */
export function migrateLocationSource(source) {
  if (!source || source.market !== undefined) return source;
  const present = MARKET_KEYS.filter((key) => source[key] !== undefined);
  if (!present.length) return source;

  const meaningful = looksLikeAMarket(source);
  const market = {};
  for (const key of present) {
    market[key] = source[key];
    delete source[key];
  }
  source.market = meaningful ? market : null;
  return source;
}
