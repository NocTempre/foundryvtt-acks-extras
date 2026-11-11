/**
 * The Details tab's price ledger — each line of the build-up from the listed
 * price to what the item is worth now. Pure: it takes the layers as plain
 * data and returns labelled lines, so the arithmetic can be asserted offline.
 *
 * The order is the rules' own, and it is `properties.mjs`'s order: plating
 * scales the listed price first, flat surcharges are added second, and a
 * condition's resale fraction scales the whole last. This file restates none
 * of those values — every multiplier and surcharge arrives as an argument.
 */

/**
 * @param {object} p
 * @param {number} p.base              the listed (pristine) price
 * @param {number} [p.silverMul]       silvering's multiplier, when plated; omit when not
 * @param {string} [p.silverTip]       where that multiplier was read from
 * @param {{label:string, add:number, tip?:string}|null} [p.masterwork]   the tier's surcharge
 * @param {{name:string, baseMul?:number, add?:number, mul?:number}[]} [p.variations]
 * @param {{label:string, mul:number}|null} [p.condition]  the scavenged resale fraction
 * @param {{key:string, label:string, tip?:string}[]} [p.unstated]  layers set on the item whose
 *   figure is not imported: each is a line carrying no amount, and moves nothing
 * @returns {{lines:{key:string,label:string,op:string|null,amount:number,running:number,tip?:string,notImported?:boolean}[], final:number}}
 */
export function priceLedger({ base = 0, silverMul = null, silverTip = "", masterwork = null, variations = [], condition = null, unstated = [] } = {}) {
  const lines = [];
  let running = Number(base) || 0;
  lines.push({ key: "listed", label: null, op: null, amount: running, running });
  for (const u of unstated) {
    lines.push({ key: `unstated:${u.key}`, label: u.label, op: null, amount: 0, running, notImported: true, ...(u.tip ? { tip: u.tip } : {}) });
  }

  // Base multipliers first: silver, then any variation scaling the listed price.
  if (silverMul && silverMul !== 1) {
    running *= silverMul;
    lines.push({ key: "silver", label: null, op: "mul", amount: silverMul, running, ...(silverTip ? { tip: silverTip } : {}) });
  }
  for (const v of variations) {
    if (v.baseMul && v.baseMul !== 1) {
      running *= v.baseMul;
      lines.push({ key: `variation:${v.name}`, label: v.name, op: "mul", amount: v.baseMul, running });
    }
  }
  // Flat surcharges second.
  if (masterwork?.add) {
    running += masterwork.add;
    lines.push({ key: "masterwork", label: masterwork.label, op: "add", amount: masterwork.add, running, ...(masterwork.tip ? { tip: masterwork.tip } : {}) });
  }
  for (const v of variations) {
    if (v.add) {
      running += v.add;
      lines.push({ key: `variation:${v.name}:add`, label: v.name, op: "add", amount: v.add, running });
    }
  }
  // Whole-price multipliers last.
  for (const v of variations) {
    if (v.mul && v.mul !== 1) {
      running *= v.mul;
      lines.push({ key: `variation:${v.name}:mul`, label: v.name, op: "mul", amount: v.mul, running });
    }
  }
  if (condition?.mul && condition.mul !== 1) {
    running *= condition.mul;
    lines.push({ key: "condition", label: condition.label, op: "mul", amount: condition.mul, running });
  }
  const final = Math.round(running * 100) / 100;
  return { lines: lines.map((l) => ({ ...l, running: Math.round(l.running * 100) / 100 })), final };
}
