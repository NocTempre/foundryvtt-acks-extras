/**
 * The pure half of "Pay the house", the picker mode that moves exact coins from
 * a character into a place's own coin (`lib/money.mjs` `giveCoin`): what a payer
 * offers, what a form's picks become, and what they add up to. Foundry-free.
 */
import { coinCount, coinKind, coinRate } from "../lib/money-logic.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";

/**
 * What a payer offers: the coin rows among `rows` that hold coin and are worth
 * something each, and nothing else. A row that is not coin is never offered,
 * whatever it is.
 * @param {Array<{id?: string, _id?: string, type: string, name: string, img?: string, system?: object}>} rows
 * @returns {Array<{id: string, name: string, img: string, held: number, cv: number}>}
 */
export function payOffer(rows) {
  return (rows ?? [])
    .filter((row) => row?.type === ITEM_TYPE.money)
    .map((row) => ({ id: row.id ?? row._id, name: row.name, img: row.img ?? "", held: coinCount(row), cv: coinRate(row) }))
    .filter((offer) => offer.id && offer.held > 0 && offer.cv > 0);
}

/**
 * The `{id, count}` list `giveCoin` takes, from a form's picks. A pick counts
 * only when it is checked and names a row of the offer. A blank count means the
 * whole stack, a typed count is capped at what the row holds, and a count under
 * one (or text that is not a number) drops the row, so a short purse cannot
 * be asked for more than it has.
 * @param {ReturnType<typeof payOffer>} offer
 * @param {Array<{id: string, checked: boolean, raw?: string|number|null}>} picks
 * @returns {Array<{id: string, count: number}>}
 */
export function paySpec(offer, picks) {
  const byId = new Map((offer ?? []).map((row) => [row.id, row]));
  const spec = [];
  for (const pick of picks ?? []) {
    const row = byId.get(pick?.id);
    if (!row || !pick.checked) continue;
    const raw = pick.raw == null ? "" : String(pick.raw).trim();
    const count = Math.min(row.held, raw === "" ? row.held : Math.floor(Number(raw)));
    if (count >= 1) spec.push({ id: row.id, count });
  }
  return spec;
}

/** What a spec is worth, in copper, at the rates the offer's rows state. */
export const payTotalCp = (offer, spec) => {
  const byId = new Map((offer ?? []).map((row) => [row.id, row]));
  return (spec ?? []).reduce((cp, one) => cp + (byId.get(one.id)?.cv ?? 0) * one.count, 0);
};

/** The coins a spec names as `{name, count}`, one entry per row, for a total's tooltip. */
export const payParts = (offer, spec) => {
  const byId = new Map((offer ?? []).map((row) => [row.id, row]));
  return (spec ?? []).filter((one) => byId.has(one.id)).map((one) => ({ name: byId.get(one.id).name, count: one.count }));
};

/**
 * The coin among `items` (plain item data) as `{name, count}`, one entry for
 * each kind (name and rate together), in the order the kinds first appear: what
 * a figure of gold pieces is made of.
 */
export function coinParts(items) {
  const byKind = new Map();
  for (const item of items ?? []) {
    if (item?.type !== ITEM_TYPE.money || coinCount(item) <= 0) continue;
    const key = coinKind(item);
    const entry = byKind.get(key) ?? { name: item.name, count: 0 };
    entry.count += coinCount(item);
    byKind.set(key, entry);
  }
  return [...byKind.values()];
}
