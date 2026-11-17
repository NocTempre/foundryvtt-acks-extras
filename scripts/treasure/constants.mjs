/**
 * The treasure feature's names: the flag keys a pot and its cards carry, the
 * phases and modes a pot moves through, the pools a card belongs to, the one
 * relay handler, and the reasons a request is refused. Foundry-free.
 */
import { MODULE_ID } from "../lib/constants.mjs";

export { MODULE_ID };

/** The lang root every treasure string lives under. */
export const LANG = "ACKS-TREASURE";

/** Flag key, under the module's scope, of the pile that is a pot (`pot-logic.mjs` `normalizePot`). */
export const POT_FLAG = "treasure";

/** Flag key, under the module's scope, of a Card's truth (`pot-logic.mjs` `normalizeTruth`). */
export const CARD_FLAG = "card";

/** The id a pot's sheet is registered and chosen under (`flags.core.sheetClass`). */
export const POT_SHEET_KEY = `${MODULE_ID}.PotSheet`;

/** The one socket handler every player act on a pot reaches the Judge's client through. */
export const POT_HANDLER = "treasurePot";

/** Where a pot is in its life: built by the Judge, turned by the table, then closed. */
export const PHASE = Object.freeze({ staging: "staging", open: "open", closed: "closed" });

/** Who rolls: the Judge deals and the table turns the cards, or the table rolls too. Stored only; R1 deals by hand. */
export const MODE = Object.freeze({ judge: "judge", table: "table" });

/** The pools a card belongs to. A seat is shown `shownPool`, which hides `magic` behind `item`. */
export const POOL = Object.freeze({
  coins: "coins",
  gems: "gems",
  jewelry: "jewelry",
  special: "special",
  item: "item",
  magic: "magic",
});

/** The two seed buckets beneath the pot. */
export const BUCKET = Object.freeze({ add: "add", replace: "replace" });

/** The number of value bands a card's face-down colour can take. A design constant. */
export const BAND_COUNT = 4;

/**
 * The icon on a card's back, from Foundry's own image library, by the pool a
 * seat is shown. A magic card is never listed: its back is its displayed
 * pool's, which is what keeps a seed from being told apart.
 */
export const POOL_BACK_ICON = Object.freeze({
  coins: "icons/svg/coins.svg",
  gems: "icons/commodities/gems/gem-faceted-asscher-blue.webp",
  jewelry: "icons/commodities/treasure/crown-gold-laurel-wreath.webp",
  special: "icons/svg/statue.svg",
  item: "icons/svg/item-bag.svg",
});

/** Why a request was refused. Each is a lang key under the `refuse` group of the feature's root. */
export const REFUSAL = Object.freeze({
  noUser: "noUser",
  bad: "bad",
  busy: "busy",
  failed: "failed",
  noPot: "noPot",
  phase: "phase",
  notAllowed: "notAllowed",
  notInPot: "notInPot",
  faceDown: "faceDown",
  alreadyUp: "alreadyUp",
  claimed: "claimed",
  noTarget: "noTarget",
  notOwner: "notOwner",
  keepsNoGoods: "keepsNoGoods",
  noCoin: "noCoin",
  empty: "empty",
  dealEmpty: "dealEmpty",
  noParty: "noParty",
  nothingToGrab: "nothingToGrab",
});
