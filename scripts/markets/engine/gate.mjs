/* global game, Roll, Hooks */
/**
 * The gate a party passes to enter a market (RR ch. 8, Entering the Market,
 * step 3). It assesses what the book assesses and nothing more: the toll on
 * the capacity the party brings, the tariff on the merchandise it brings in
 * to sell, and the Ruler's Privilege that waives both. A good the party
 * smuggles is not assessed, and a party that sneaks in pays neither. The
 * attempt is the Judge's to resolve. One quote serves the Enter dialog's
 * preview and the entry that pays it. The entry quotes again on the seat
 * that writes, which can see every load the previewing seat may not. A
 * Judge's own rules join through the `acksExtras.marketGateQuote` hook
 * (`entryQuote`), never through this file.
 */
import { parseTollCpPerSt, parseTariffPct, tariffOn, diceRange } from "../rules/arbitrage.mjs";
import { marketsFlagOf } from "../rules/goods.mjs";
import { merchandiseTierOf } from "../merchandise-keys.mjs";
import { HOOKS } from "../constants.mjs";
import { getSetting } from "../settings.mjs";
import { optTable } from "../../henchmen/rules/tables.mjs";
import { findRow } from "../../lib/tables.mjs";
import { coinReach } from "../../lib/money.mjs";
import { isMagical, stackCountOf } from "../../lib/item-model.mjs";
import { ITEM_TYPE } from "../../lib/vocab.mjs";
import { holdOf } from "../../vehicles/hold.mjs";
import { merchandiseFor } from "./merchandise.mjs";
import { manifestOf } from "./manifest.mjs";
import { partyOf, partyMembers } from "./parties.mjs";
import { categoryOf } from "./trade.mjs";
import { tariffDice, printedError } from "./printed.mjs";

const TIERS = Object.freeze(["precious", "common"]);
const tierOf = (load) => (load.tier === "precious" ? "precious" : "common");
const SALE_TYPES = new Set([ITEM_TYPE.item, ITEM_TYPE.weapon, ITEM_TYPE.armor]);

/** The imported Market Characteristics row for a class (null when absent). */
export function characteristicsFor(marketClass) {
  const rows = optTable("mercantile", "marketCharacteristics")?.rows ?? [];
  return findRow(rows, (r) => Number(r.marketClass) === Number(marketClass)) ?? null;
}

/**
 * The trader's party at the gate: the trader first, then every other member
 * (`partyMembers`) the user can see. The Judge sees the whole party.
 */
export function gateParty(trader, user = game.user) {
  const party = [trader];
  for (const actor of partyMembers(partyOf(trader).id)) {
    if (!actor?.uuid || party.some((a) => a.uuid === actor.uuid)) continue;
    if (user?.isGM || actor.testUserPermission(user, "LIMITED")) party.push(actor);
  }
  return party;
}

/**
 * Whose packs come through the gate with the party: the trader, and every
 * other member of the party (`gateParty`) who stands at the market
 * (`coinReach`). A member elsewhere is not arriving with it.
 */
export function enteringMembers(location, trader, user = game.user) {
  return gateParty(trader, user).filter((a) => a.uuid === trader.uuid || coinReach(a, location).can);
}

/** The key a good at the gate goes by in `forSale` and `smuggled`: its holder's uuid and its item id. */
export const goodKey = (holderUuid, itemId) => `${holderUuid}|${itemId}`;

/**
 * The items a member may declare for sale at the gate. Each is something
 * they carry that is not a load and not magic, has a merchandise type
 * (`categoryOf`: the item's own override, else the type its kind belongs
 * to), has a cost, and is in hand.
 * @returns {{itemId: string, name: string, category: string, quantity: number, costGp: number}[]}
 */
export function saleCandidates(member) {
  const out = [];
  for (const item of member?.items ?? []) {
    if (!SALE_TYPES.has(item.type)) continue;
    const data = item.toObject();
    if (marketsFlagOf(data).merchandise || isMagical(item)) continue;
    const category = categoryOf(data);
    if (!category || !merchandiseFor(category)) continue;
    const quantity = stackCountOf(item) ?? 1;
    const costGp = Number(data.system?.cost) || 0;
    if (quantity > 0 && costGp > 0) out.push({ itemId: item.id, name: item.name, category, quantity, costGp });
  }
  return out;
}

/**
 * What the gate looks at, sorted into what it assesses (`loads`) and what is
 * smuggled past it (`smuggled`):
 * - every merchandise load in the packs of the members entering and in the
 *   holds of the vehicles entering, unstamped or stamped for one of those
 *   members. A load kept for anybody else is left out;
 * - every item those members bring to sell (`saleCandidates`): declared in
 *   `forSale`, or named in `smuggled`.
 * A good named in `smuggled` (`goodKey`) is smuggled, and so is everything
 * where the party sneaks in. Each row carries its key, its good's base price
 * per unit (the catalogue's per stone for a load, else the load's own cost;
 * an item's cost), its tier and its exemption.
 * @param {object} o
 * @param {Actor[]} o.members - `enteringMembers`
 * @param {Actor[]} [o.vehicles]
 * @param {string[]} [o.forSale] - `goodKey`s of items declared for sale
 * @param {string[]} [o.smuggled] - `goodKey`s of goods smuggled
 * @param {boolean} [o.sneak] - the party sneaks in
 * @returns {{loads: object[], smuggled: object[]}}
 */
export function enteringLoads({ members, vehicles = [], forSale = [], smuggled = [], sneak = false }) {
  const hidden = new Set(smuggled ?? []);
  const out = { loads: [], smuggled: [] };
  const place = (row) => (sneak || hidden.has(row.key) ? out.smuggled : out.loads).push(row);
  const goodOf = (category) => {
    const good = merchandiseFor(category);
    return { good, tier: good?.tier ?? merchandiseTierOf(category) ?? "common", exempt: !!good?.tariffExempt };
  };
  for (const row of manifestOf([...members, ...vehicles], { traderUuid: members.map((a) => a.uuid) }).rows) {
    const { good, tier, exempt } = goodOf(row.category);
    const basePriceGp = Number(good?.pricePerStoneGp) || row.unitGp;
    place({ key: goodKey(row.holderUuid, row.itemId), category: row.category, label: row.label, holderName: row.holderName, stones: row.stones, basePriceGp, tier, exempt, kind: "load" });
  }
  const brought = new Set([...(forSale ?? []), ...hidden]);
  for (const member of members) {
    for (const c of saleCandidates(member)) {
      const key = goodKey(member.uuid, c.itemId);
      if (!brought.has(key)) continue;
      const { tier, exempt } = goodOf(c.category);
      place({ key, category: c.category, label: c.name, holderName: member.name, stones: c.quantity, basePriceGp: c.costGp, tier, exempt, kind: "item" });
    }
  }
  return out;
}

/**
 * The domain the market lies in, where one of the members entering rules
 * it. Read through the domains feature's api at call time. Null without
 * that feature, where no domain holds the market or anything it stands in,
 * or where its ruler is none of them.
 * @param {Actor} location
 * @param {Actor|string|Array<Actor|string>} entering - the members entering, or their uuids
 */
export function privilegeDomain(location, entering) {
  let domain = null;
  try {
    domain = globalThis.acksExtras?.domains?.domainOf?.(location) ?? null;
  } catch {
    domain = null;
  }
  const ruler = domain?.system?.rulerUuid;
  if (!ruler) return null;
  const uuids = new Set((Array.isArray(entering) ? entering : [entering]).map((a) => (typeof a === "string" ? a : a?.uuid)).filter(Boolean));
  return uuids.has(ruler) ? domain : null;
}

/** The charges a Judge's script added through the hook: each kept where it has a label and a whole number of coppers above none. */
function judgeCharges(extra) {
  return (Array.isArray(extra) ? extra : [])
    .map((c) => ({ label: String(c?.label ?? "").trim(), cp: Math.round(Number(c?.cp)) }))
    .filter((c) => c.label && Number.isFinite(c.cp) && c.cp > 0);
}

/** The coppers a quote's added charges come to. */
export const extraCpOf = (quote) => (quote?.extra ?? []).reduce((n, c) => n + c.cp, 0);

/**
 * What the gate charges `trader`'s party entering `location`.
 *
 * The book's assessment:
 * - the toll is the class's per-stone toll on the whole capacity: the
 *   vehicles, plus `otherSt` stone of other capacity (porters, pack
 *   animals);
 * - the tariff is `tariffOn` the goods assessed (`enteringLoads`) at the
 *   class's printed rates. Where the Judge randomizes it
 *   (`marketsRandomTariff`) and a good is taxable, the rates are thrown per
 *   tier at the gate instead: `dice` names each tier's throw (null for a
 *   tier the class does not tariff), `range` gives the totals they can come
 *   to, and `tariff` stays null until `settleTariff` throws them;
 * - a member entering who rules the market's domain waives both
 *   (`privilege`);
 * - a party that sneaks in (`sneak`) is charged neither, and everything it
 *   brings is smuggled.
 *
 * Then the `acksExtras.marketGateQuote` hook is called with
 * `(quote, {location, trader})` on every seat that quotes, the preview's
 * and the paying one's alike. A handler may push charges of its own onto
 * `quote.extra` as `{label, cp}` in whole coppers. The trader pays them with
 * the book's, whatever the privilege. A handler must answer the same on
 * every seat, or the preview and the payment disagree.
 *
 * Refuses `noCharacteristics` where the class's row is unread, and the
 * printed error where its tariff cell, or the dice a randomized tariff
 * needs, cannot be read.
 * @param {Actor} location
 * @param {Actor} trader - the member the entry is posted under, who pays
 * @param {object} [o]
 * @param {Actor[]} [o.vehicles]
 * @param {number} [o.otherSt]
 * @param {string[]} [o.forSale] - `goodKey`s of items declared for sale (`saleCandidates`)
 * @param {string[]} [o.smuggled] - `goodKey`s of goods smuggled
 * @param {boolean} [o.sneak]
 * @param {string|null} [o.requestUserId] - the seat declaring, whose sight bounds the party (`gateParty`)
 * @returns {{error: string, table?: string}|{capacitySt: number, sneaked: boolean, privilege: {uuid: string, name: string}|null, tollCp: number, loads: object[], smuggled: object[], rates: {precious: number, common: number}|null, dice: {precious: string|null, common: string|null}|null, range: {minCp: number, maxCp: number}|null, tariff: {totalCp: number, lines: object[]}|null, extra: {label: string, cp: number}[]}}
 */
export function entryQuote(location, trader, { vehicles = [], otherSt = 0, forSale = [], smuggled = [], sneak = false, requestUserId = null } = {}) {
  const capacitySt = Math.round(Math.round(Math.max(0, Number(otherSt) || 0)) + vehicles.reduce((n, v) => n + Math.max(0, holdOf(v)?.capacity ?? 0), 0));
  const ch = characteristicsFor(location.system.marketClass);
  if (!ch) return { error: "noCharacteristics" };
  const members = enteringMembers(location, trader, requestUserId ? game.users.get(requestUserId) : game.user);
  const sneaked = !!sneak;
  const sorted = enteringLoads({ members, vehicles, forSale, smuggled, sneak: sneaked });
  const quote = { capacitySt, sneaked, privilege: null, tollCp: 0, loads: sorted.loads, smuggled: sorted.smuggled, rates: null, dice: null, range: null, tariff: null, extra: [] };
  const domain = sneaked ? null : privilegeDomain(location, members);
  if (sneaked || domain) {
    const free = { precious: 0, common: 0 };
    Object.assign(quote, { privilege: domain ? { uuid: domain.uuid, name: domain.name } : null, rates: free, tariff: tariffOn(quote.loads, free) });
  } else {
    quote.tollCp = Math.ceil(parseTollCpPerSt(ch.toll) * capacitySt);
    const printed = parseTariffPct(ch.tariff);
    if (!printed) return printedError("marketCharacteristics");
    const taxable = quote.loads.some((l) => !l.exempt && l.stones > 0 && l.basePriceGp > 0 && printed[tierOf(l)] > 0);
    if (!taxable || !getSetting("marketsRandomTariff")) {
      Object.assign(quote, { rates: printed, tariff: tariffOn(quote.loads, printed) });
    } else {
      const thrown = tariffDice();
      if (!thrown) return printedError("tariffProse");
      const dice = Object.fromEntries(TIERS.map((tier) => [tier, printed[tier] > 0 ? thrown[tier] : null]));
      const at = (end) => Object.fromEntries(TIERS.map((tier) => [tier, dice[tier] ? diceRange(dice[tier])[end] : 0]));
      Object.assign(quote, { dice, range: { minCp: tariffOn(quote.loads, at("min")).totalCp, maxCp: tariffOn(quote.loads, at("max")).totalCp } });
    }
  }
  Hooks.callAll(HOOKS.GATE_QUOTE, quote, { location, trader });
  quote.extra = judgeCharges(quote.extra);
  return quote;
}

/**
 * The tariff the gate takes on a quote: its own where the rates are printed,
 * or thrown now — once per tier the quote has dice for and a good to tax —
 * where the Judge randomizes it. `rolls` records each throw.
 * @returns {Promise<{totalCp: number, lines: object[], rates: {precious: number, common: number}, rolls: {tier: string, formula: string, total: number}[]}>}
 */
export async function settleTariff(quote) {
  if (!quote.dice) return { ...quote.tariff, rates: quote.rates, rolls: [] };
  const rates = { precious: 0, common: 0 };
  const rolls = [];
  for (const tier of TIERS) {
    const formula = quote.dice[tier];
    if (!formula || !quote.loads.some((l) => tierOf(l) === tier && !l.exempt && l.stones > 0)) continue;
    const total = (await new Roll(formula).evaluate()).total;
    rates[tier] = total;
    rolls.push({ tier, formula, total });
  }
  return { ...tariffOn(quote.loads, rates), rates, rolls };
}
