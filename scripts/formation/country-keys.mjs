/**
 * The country's own vocabularies, keys only: the territory a hex is classed
 * as, and the route a party is following. A leaf with no imports, so the
 * battlemap's brush and reader and the travel engine name the same keys
 * without importing one another.
 */

/**
 * A route the party is following, which spares it the navigation throw.
 *
 * RAW exempts navigable rivers, roads and other established routes (RR p. 275).
 * A road is reported through the record's `road`, so this carries the other
 * two. A map with water lines drawn answers `river` itself; `knownRoute` is
 * deliberately vague because the book is, and stays the Judge's call.
 */
export const FOLLOWING_KINDS = Object.freeze(["none", "river", "knownRoute"]);

/** The wilderness territory classifications (JJ ch. 2) — keys only. */
export const TERRITORY_KEYS = Object.freeze(["civilized", "borderlands", "outlands", "unsettled"]);
