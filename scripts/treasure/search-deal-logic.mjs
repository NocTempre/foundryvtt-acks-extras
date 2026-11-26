/**
 * The fight-over card's Deal block on plain data, Foundry-free: which choices
 * a card offers a seat, what the card has recorded for the deal its Search the
 * scene press will make, and how one choice is written back.
 *
 * The choices are a pot's own four (`pot-logic.mjs` `seedDeal`: table style,
 * special treasure, met in their lair, arms column), kept on the card's record
 * as `deal` until the scene opens, when the pot that opens takes them as its
 * own. A card that records none is read as a new pot would start. The block
 * is drawn from the shared options partial (`deal-logic.mjs` `dealOptionsView`).
 */
import { dealOptionsView } from "./deal-logic.mjs";
import { DEAL_STYLE, normalizePot, seedDeal, setDealChoice, setMetInLair } from "./pot-logic.mjs";
import { letterOf, normalizeRecord } from "./search-logic.mjs";

/** Whether any fallen creature on the record carries a treasure type, which is what the deal's table choices act on. */
export const hasTreasureType = (record) => normalizeRecord(record).fallen.some((e) => letterOf(e?.letter));

/**
 * The deal choices a card stands on: the ones it recorded, or `seed` where it
 * recorded none, each in the shape a pot stores.
 * @param {object|null} record the card's flag
 * @param {object} [seed] what a new pot starts with (`seedDeal`'s argument), for a card with no choices
 * @returns {{style: string, special: boolean, metInLair: boolean, armsSetting: string}}
 */
export const dealOfRecord = (record, seed = {}) => seedDeal(normalizeRecord(record).deal ?? seed);

/**
 * The deal choices a card holds once one is changed, or null for a change the
 * card refuses: a card whose scene is open, a key that is not a choice, a
 * style the pot does not list or an arms column that is not a setting key. The
 * whole set is answered, ready to write as the card's `deal`.
 * @param {object|null} record the card's flag
 * @param {"style"|"special"|"metInLair"|"armsSetting"} key
 * @param {*} value
 * @param {object} [seed] what a new pot starts with, for a card that recorded no choices
 */
export function cardDealChoice(record, key, value, seed = {}) {
  if (normalizeRecord(record).opened) return null;
  const pot = normalizePot({ deal: dealOfRecord(record, seed) });
  const next = key === "metInLair" ? setMetInLair(pot, value === true) : setDealChoice(pot, key, value);
  return next ? seedDeal(next.deal) : null;
}

/**
 * What the card draws in its Deal slot for a seat. `canUpdate` is Foundry's own
 * answer for the seat (`message.canUserModify(user, "update")`): a seat that
 * cannot write the card is drawn nothing, since it could change nothing. For a
 * seat that can, a card whose scene is open answers its reason alone, and an
 * open card with no treasure type answers every control disabled under the
 * reason, so a Judge who cannot change a choice is told why.
 * @param {object} args
 * @param {object|null} args.record the card's flag
 * @param {boolean} args.canUpdate
 * @param {object} [args.seed] what a new pot starts with, for a card that recorded no choices
 * @param {(style: string) => string|null} args.styleCite `hoard.mjs` `styleCite`
 * @param {{columns: Array<{key: string, label: string}>, cite: string|null}} args.arms `deal.mjs` `armsSource()`
 * @param {(key: string, data?: object) => string} args.loc the treasure lang formatter
 * @param {boolean} [args.canBrowse] `canBrowseTables` for the seat
 * @param {string[]} [args.styleKeys]
 * @returns {null|{kind: "open", reason: {text: string, tip: string}}|{kind: "choices", options: object}} `options` is `dealOptionsView`'s answer
 */
export function dealBlockOf({ record, canUpdate, seed = {}, styleCite, arms, loc, canBrowse = false, styleKeys = DEAL_STYLE }) {
  if (!canUpdate) return null;
  const read = normalizeRecord(record);
  if (read.opened) return { kind: "open", reason: { text: loc("search.deal.open"), tip: loc("search.deal.openTip") } };
  const typed = hasTreasureType(read);
  const reason = typed ? null : { text: loc("search.deal.noType"), tip: loc("cite.deal") };
  return { kind: "choices", options: dealOptionsView({ deal: dealOfRecord(read, seed), styleKeys, styleCite, arms, loc, canBrowse, locked: !typed, reason }) };
}
