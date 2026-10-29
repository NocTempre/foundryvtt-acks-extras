/**
 * What an item a book introduces says about itself beside its prose
 * (`kind.adventureItem`): where on the body it is worn, what it costs, and
 * whether it is a made magic item. Foundry-free. The items step reads the
 * materialized paragraph through `adventureItemShape` and writes the answers
 * as the item's slot declaration, its cost and its magic mark; the grants a
 * paragraph states (a bonus, a daily power) stay in its prose. The words
 * looked for are the body's places, a wearing verb and a price's units — the
 * module's own vocabulary; the figures beside them arrive from the Judge's
 * copy at import and are never written here.
 */
import { WEAR_SLOTS } from "../lib/vocab.mjs";

/** A clause that says the item is worn, wrapped, tied or fastened on a body. */
const WEARING = /\b(?:worn|wears?|wearer|wearing|wrapped|tied|strapped|fastened|attached|buckled|slipped|hung|draped)\b/i;

/**
 * Body places and the garments that stand for them, each to the lib's slot.
 * Earliest mention in the paragraph wins, so an item "worn around the wrists"
 * whose prose later mentions the wearer's hands reads as handwear once, not
 * twice. A tail, a torso or a place no pattern names is the uncapped `worn`.
 */
const PLACES = [
  // A tail, a torso, a chest: places no slot names, read as `worn` here so
  // that a later mention of a hand does not move the item there.
  { slot: "worn", re: /\b(?:tails?|torsos?|chests?|skin)\b/i },
  { slot: "hands", re: /\b(?:hands?|palms?|wrists?|forearms?|gloves?|gauntlets?|bracers?|mittens?|hand\s?wraps?)\b/i },
  // "finger", never "ring": the verb rings a bell in the same sentences.
  { slot: "ring", re: /\b(?:fingers?)\b/i },
  { slot: "belt", re: /\b(?:belts?|waists?|bandoliers?|sash(?:es)?|girdles?|baldrics?)\b/i },
  { slot: "feet", re: /\b(?:feet|foot|boots?|ankles?|sandals?)\b/i },
  { slot: "head", re: /\b(?:heads?|brows?|helms?|hats?|circlets?|crowns?|hoods?|headbands?)\b/i },
  { slot: "neck", re: /\b(?:necks?|throats?|collars?|amulets?|necklaces?|pendants?|torcs?)\b/i },
  { slot: "shoulders", re: /\b(?:shoulders?|cloaks?|capes?|mantles?)\b/i },
];

/** A price the paragraph states as a run-in, in gp. `null` where none is. */
export function priceStatedIn(text) {
  const m = /Cost:?\s{0,8}([\d,]+(?:\.\d+)?)\s*(gp|sp|cp)\b/i.exec(String(text ?? ""));
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const unit = m[2].toLowerCase();
  return unit === "gp" ? n : unit === "sp" ? n / 10 : n / 100;
}

/**
 * Where the paragraph says the item is worn: a `WEAR_SLOTS` key, or `null`
 * for a thing nobody wears (a dose, a tool). A wearing clause with no named
 * place is the uncapped `worn`.
 */
export function wornPlaceIn(text) {
  const s = String(text ?? "");
  if (!WEARING.test(s)) return null;
  let best = null;
  for (const { slot, re } of PLACES) {
    const m = re.exec(s);
    if (m && (best === null || m.index < best.index)) best = { slot, index: m.index };
  }
  const slot = best?.slot ?? "worn";
  return slot in WEAR_SLOTS ? slot : "worn";
}

/** Does the paragraph state a crafting time — the mark of a made magic item? */
export function isCraftedIn(text) {
  return /\bto\s+craft\b|\bcraft(?:ing)?\s+time\b/i.test(String(text ?? ""));
}

/**
 * The item's shape beside its prose.
 * @returns {{slot: string|null, cost: number|null, magic: boolean}} the slot
 *   it may occupy, its stated price in gp, and whether it is magic.
 */
export function adventureItemShape(text) {
  return { slot: wornPlaceIn(text), cost: priceStatedIn(text), magic: isCraftedIn(text) };
}
