/**
 * The hoard generator's Foundry side: deal a treasure letter from the imported
 * `treasure` registry document as the pot's truths. The tables, their cites
 * and the mapping between them and the engine are `hoard-map.mjs`; the dice
 * and the procedure are `hoard-logic.mjs`. This file reads the registry, rolls
 * on core's dice, and names the world's coin for each denomination dealt.
 *
 * With nothing imported it deals nothing and says so: no figure stands in for
 * a table (`ip-doctrine.md`). It wires to no control: the pot window's deal
 * (`deal.mjs`) and the scene search's haul (`scene-search/haul.mjs`) call it.
 */

import { citeOf, getDoc, hasDoc } from "../lib/tables.mjs";
import { coinTemplate } from "../lib/money.mjs";
import { weight6Of } from "../lib/item-model.mjs";
import { TREASURE_DOC_ID } from "../importer/treasure-binding.mjs";
import { rollerFrom, dealHoard as dealEngine } from "./hoard-logic.mjs";
import { STYLE_TABLE, mapHoardArgs, truthsFromCards, typeKeysOf } from "./hoard-map.mjs";

/** The lang key of the world's name for each coin column's denomination. */
const COIN_NAME_KEY = Object.freeze({
  cp: "ACKS-TREASURE.hoard.coin.cp",
  sp: "ACKS-TREASURE.hoard.coin.sp",
  ep: "ACKS-TREASURE.hoard.coin.ep",
  gp: "ACKS-TREASURE.hoard.coin.gp",
  pp: "ACKS-TREASURE.hoard.coin.pp",
});

/**
 * The world's coin for each denomination a deal produced, as the pure mapping
 * wants it: `{name, cv, weight6(count)}` read from the world's own coin item
 * of that name, or absent where the world has none.
 */
async function worldCoins(keys) {
  const coins = {};
  for (const key of keys) {
    const name = COIN_NAME_KEY[key] && game.i18n.localize(COIN_NAME_KEY[key]);
    const data = name ? await coinTemplate({ name }) : null;
    const cv = Number(data?.system?.coppervalue);
    if (!data || !(cv > 0)) continue;
    coins[key] = { name: data.name, cv, weight6: (count) => weight6Of({ ...data, system: { ...data.system, quantity: count } }) };
  }
  return coins;
}

/**
 * The page the imported table of one style was read from, or null while that table is not imported.
 * @param {"classic"|"heroic"|"gritty"} style
 * @returns {string|null}
 */
export const styleCite = (style) => citeOf(TREASURE_DOC_ID, STYLE_TABLE[style]);

/**
 * The treasure types the world's imported table of one style holds, in the table's order; empty while that table is not imported.
 * @param {"classic"|"heroic"|"gritty"} style
 * @returns {string[]}
 */
export const hoardTypes = (style) => (hasDoc(TREASURE_DOC_ID) ? typeKeysOf(getDoc(TREASURE_DOC_ID).tables, style) : []);

/**
 * Deal one treasure type, in one style, from the imported tables.
 *
 * `toggles.noMagic` leaves the type's magic terms out of the deal;
 * `toggles.forceCursed` is not read here (the pot applies it when it opens)
 * and is returned as it came. A magic truth is a placeholder carrying the
 * `tableRef` the magic-item roll resolves. `special` throws each lot of coin,
 * each gem and each piece of jewelry on its special list; it is off unless a
 * caller asks.
 *
 * @param {object} args
 * @param {string} args.letter the treasure type
 * @param {"classic"|"heroic"|"gritty"} [args.style]
 * @param {{noMagic?: boolean, forceCursed?: boolean}} [args.toggles]
 * @param {boolean} [args.special]
 * @param {(expr: string) => {total: number, sides: number}} [args.roll] a roller; core's dice by default
 * @returns {Promise<{truths: object[], errors: object[], cite: string|null, toggles: object, audit: object[]}>}
 *   `errors` are typed `{code, ...}`; the rest of a hoard is dealt around one
 */
export async function dealHoard({ letter, style = "classic", toggles = {}, special = false, roll = rollerFrom(() => CONFIG.Dice.randomUniform()) } = {}) {
  const idle = (error) => ({ truths: [], errors: [error], cite: null, toggles, audit: [] });
  if (!hasDoc(TREASURE_DOC_ID)) return idle({ code: "not-imported", table: TREASURE_DOC_ID });
  const coinNames = Object.fromEntries(Object.entries(COIN_NAME_KEY).map(([key, lang]) => [key, game.i18n.localize(lang)]));
  const mapped = mapHoardArgs({ tables: getDoc(TREASURE_DOC_ID).tables, letter, style, toggles, special, coinNames, cite: (id) => citeOf(TREASURE_DOC_ID, id) });
  if (mapped.error) return idle(mapped.error);

  const dealt = dealEngine({ ...mapped.args, roll });
  const keys = new Set(dealt.cards.filter((c) => c.pool === "coins").map((c) => c.coin.key));
  const coins = await worldCoins(keys);
  const made = truthsFromCards(dealt.cards, { coinOf: (key) => coins[key] ?? null, format: (n) => n.toLocaleString(game.i18n.lang) });
  return { truths: made.truths, errors: [...mapped.errors, ...dealt.errors, ...made.errors], cite: mapped.cite, toggles, audit: dealt.audit };
}
