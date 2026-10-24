/**
 * Moorage and stabling (RR ch. 8, Engaging in Mercantile Ventures): the daily
 * fee a party pays while its ships are berthed and its wagons, carts and
 * animals stabled at a market, or anchored and pastured outside at the
 * table's other rate. Pure module: the rates are the imported table's
 * (`printed.stayRates`) and are passed in.
 */

/** Where a party's ships and animals wait: berthed and stabled within, or anchored and pastured outside. */
export const STAY_AT = Object.freeze(["berth", "anchor"]);

/** How a land vehicle is stabled: as a wagon, as a cart, or not at all. */
export const STABLED_AS = Object.freeze(["wagon", "cart", "none"]);

/** The animals a party counts at the gate, each keyed to the table row its fee is read from. */
export const STAY_ANIMALS = Object.freeze({ elephant: "cartElephant", horse: "horse", camelDonkeyOx: "camelDonkeyOx" });

/** The table row a stabled land vehicle's fee is read from. */
const VEHICLE_ROW = Object.freeze({ wagon: "wagon", cart: "cartElephant" });

/**
 * How a land vehicle is stabled until someone says otherwise: a vehicle
 * drawn by a team (`pulled`, or no carriage stated) as a wagon, one carried
 * by hand or on a back not at all.
 */
export const defaultStabledAs = (carriage) => (!carriage || carriage === "pulled" ? "wagon" : "none");

/**
 * A party's daily moorage and stabling where it waits (`at`): one line per
 * ship and per stabled land vehicle, and one per kind of animal counted.
 * A ship's rate priced per a number of shp is taken pro rata on its size. A
 * wagon's or cart's team is in its fee and is not counted again. Each line
 * rounds up to a whole copper.
 *
 * Refuses `noRate` with the table row a unit needs where the rates lack it,
 * and `noShp` with the ship's name where its rate is by size and it has none.
 * @param {object} o
 * @param {Record<string, {berth: {cp: number, perShp: number|null}, anchor: {cp: number, perShp: number|null}}>|null} o.rates - `printed.stayRates()`
 * @param {"berth"|"anchor"} [o.at]
 * @param {{name: string, shp: number}[]} [o.ships]
 * @param {{name: string, as: string}[]} [o.vehicles] - land vehicles, each stabled `as` one of `STABLED_AS`
 * @param {Record<string, number>} [o.animals] - head counted, by `STAY_ANIMALS` key
 * @returns {{error: "noRate", row: string}|{error: "noShp", name: string}|{at: string, cpPerDay: number, lines: {unit: string, name: string, count: number, cp: number}[]}}
 */
export function stayPerDay({ rates, at = "berth", ships = [], vehicles = [], animals = {} }) {
  const where = STAY_AT.includes(at) ? at : "berth";
  const units = [
    ...ships.map((s) => ({ unit: "ship", row: "ship", name: s.name, count: 1, shp: Math.max(0, Number(s.shp) || 0) })),
    ...vehicles.filter((v) => VEHICLE_ROW[v.as]).map((v) => ({ unit: v.as, row: VEHICLE_ROW[v.as], name: v.name, count: 1 })),
    ...Object.entries(STAY_ANIMALS)
      .map(([unit, row]) => ({ unit, row, name: "", count: Math.max(0, Math.floor(Number(animals?.[unit]) || 0)) }))
      .filter((u) => u.count > 0),
  ];
  const lines = [];
  for (const u of units) {
    const rate = rates?.[u.row]?.[where];
    if (!rate) return { error: "noRate", row: u.row };
    if (rate.perShp && !(u.shp > 0)) return { error: "noShp", name: u.name };
    const each = rate.perShp ? (rate.cp * u.shp) / rate.perShp : rate.cp;
    lines.push({ unit: u.unit, name: u.name, count: u.count, cp: Math.ceil(each * u.count) });
  }
  return { at: where, cpPerDay: lines.reduce((n, l) => n + l.cp, 0), lines };
}

/**
 * The days a stay is charged for, from the calendar day of arrival to the
 * day of departure. Both are charged, so a visit begun and ended on one day
 * is one day, and so is a stay whose days cannot be read.
 */
export function stayDays(arrivalDay, departureDay) {
  const days = Math.floor(Number(departureDay) - Number(arrivalDay)) + 1;
  return Number.isFinite(days) ? Math.max(1, days) : 1;
}

/**
 * What a stay comes to: its days (`stayDays`) and their coppers at a daily
 * fee figured at the gate.
 * @returns {{days: number, cp: number}}
 */
export function stayOwed({ cpPerDay, arrivalDay, departureDay }) {
  const days = stayDays(arrivalDay, departureDay);
  return { days, cp: Math.max(0, Math.round(Number(cpPerDay) || 0)) * days };
}
