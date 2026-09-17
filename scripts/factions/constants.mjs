/**
 * The factions feature's vocabulary: the actor sub-type, the kinds an
 * organisation can be, the sources a standing row can come from, and the hook
 * a standing change fires. Every number a faction carries is the Judge's own
 * — the books print no reputation score, so nothing here is a page value.
 */
import { MODULE_ID } from "../lib/constants.mjs";
export { MODULE_ID };

/** Lang root for this feature's own keys. */
export const LANG_PREFIX = "ACKS-FACTIONS";

/** The faction actor sub-type this feature adds to the system. */
export const FACTION_TYPE = `${MODULE_ID}.faction`;

/**
 * What sort of organisation a faction is. A classification for the Judge's
 * eye and for the one rule that reads it (`AUTHORITY_KINDS`); nothing else
 * branches on it.
 */
export const FACTION_KINDS = Object.freeze(["guild", "temple", "syndicate", "noble", "watch", "merchant", "other"]);

/**
 * The kinds whose control of a quarter is LEGAL authority there: a member of
 * the watch or of the ruling house acts under the law's own weight when the
 * party stands in a quarter that faction holds. The reaction dialog is told
 * so by a label row; the authority modifier itself stays the Judge's tick.
 */
export const AUTHORITY_KINDS = new Set(["watch", "noble"]);

/**
 * Where a standing row came from. `wanted` is the one with a consequence of
 * its own: a faction holding a wanted row for the party marks the settlement
 * board hunted in every quarter that faction controls. `crime` rows are the
 * party's prior record, listed as such; the rest are the Judge's ledger.
 */
export const STANDING_SOURCES = Object.freeze(["favour", "offence", "crime", "wanted", "manual"]);

/**
 * Who a standing row is about: everyone, one party, one character, or one
 * other organisation. A `faction` row counts for every member of the
 * organisation it names, the way a `party` row counts for every member of the
 * party — a syndicate that hates the guild receives the guild's people coldly.
 */
export const SUBJECT_SCOPES = Object.freeze(["all", "party", "character", "faction"]);

/**
 * How one organisation regards another. A LABEL the Judge picks, like `kind`:
 * nothing derives a number from it and nothing reads it as a modifier. The
 * numeric side of a rivalry is a ledger row of `faction` scope, which is the
 * Judge's own figure like every other row.
 */
export const RELATION_STANCES = Object.freeze(["allied", "friendly", "neutral", "rival", "hostile"]);

/**
 * World setting: how much standing moves a market class one step. Zero, the
 * default, turns the availability shift off — the books price no reputation,
 * so a Judge who wants standing to open or close a market chooses the step.
 */
export const SETTING_STANDING_STEP = "standingPerClassStep";

/** Custom hooks fired by this feature (camelCase module namespace). */
export const HOOKS = Object.freeze({
  /** `{faction: uuid, row}` after a standing row is added, or `{faction, removed}` after one is taken off. */
  STANDING_CHANGED: "acksExtras.factionStandingChanged",
  /** `{faction: uuid}` after a relation row is written or removed. */
  RELATIONS_CHANGED: "acksExtras.factionRelationsChanged",
});
