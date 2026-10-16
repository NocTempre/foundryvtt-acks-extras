/**
 * An offer made to some of a bulk market row — the mercenaries and specialists
 * a market counts by the score, kept as one row with a quantity — answered by
 * each head offered for itself (RR 162: the reaction is each potential
 * hireling's). Foundry-free: the dice are rolled by the caller and passed in.
 *
 * The row splits by the answers. The heads not offered stay on the row under
 * its own id; every group that answered alike becomes a row of its own, a copy
 * of the original (segment, arrival time, wage, earlier refusals) with its own
 * quantity, so the weekly churn and the next offer read it as the same people.
 */

/** Outcome effects in table order, worst first; the split writes them in this order. */
export const HIRING_OUTCOMES = ["refuseSlander", "refuse", "tryAgain", "accept", "acceptElan"];

/** The answers that refuse and are recorded on the row as a refusal. */
const REFUSALS = new Set(["refuseSlander", "refuse", "tryAgain"]);

/**
 * The outcome effect an outcome table gives a roll. Rows run worst → best and
 * bracket the ADJUSTED total; a total past either end takes that end's row.
 * `naturalClamps.natural2.noBetterThan` / `natural12.noWorseThan` cap a
 * natural 2 or 12 at a named effect.
 * @param {{outcomes: {min?: number, max?: number, effect: string}[], naturalClamps?: object}} table
 * @param {number} natural - the dice alone
 * @param {number} adjusted - the dice with every modifier
 * @returns {string|null}
 */
export function outcomeFromTable(table, natural, adjusted) {
  const rows = table?.outcomes ?? [];
  if (!rows.length) return null;
  const rowIndex = (lookup) => rows.findIndex((o) => (o.min === undefined || lookup >= o.min) && (o.max === undefined || lookup <= o.max));
  let idx = rowIndex(adjusted);
  if (idx < 0) idx = adjusted < (rows[0].min ?? -Infinity) ? 0 : rows.length - 1;
  const clamps = table.naturalClamps;
  if (clamps) {
    if (natural === 2 && clamps.natural2?.noBetterThan) {
      const cap = rows.findIndex((o) => o.effect === clamps.natural2.noBetterThan);
      if (cap >= 0 && idx > cap) idx = cap;
    }
    if (natural === 12 && clamps.natural12?.noWorseThan) {
      const floor = rows.findIndex((o) => o.effect === clamps.natural12.noWorseThan);
      if (floor >= 0 && idx < floor) idx = floor;
    }
  }
  return rows[idx]?.effect ?? null;
}

/** How many heads an offer reaches: a whole number from 1 to the row's quantity; anything unreadable is the whole row. */
export function headsOffered(requested, quantity) {
  const max = Math.max(1, Math.floor(Number(quantity) || 1));
  const n = Math.floor(Number(requested));
  if (!Number.isFinite(n)) return max;
  return Math.min(max, Math.max(1, n));
}

/**
 * The answers of every head offered. The first head's roll is the one already
 * made on the hiring page; each further head throws the same dice with the same
 * modifiers, so only its natural differs.
 * @param {{natural: number, total: number, outcome: string}} first
 * @param {number[]} moreNaturals - one natural per further head
 * @param {object} table - the hiring outcome table (`outcomeFromTable`)
 * @returns {{natural: number, total: number, outcome: string}[]}
 */
export function headAnswers(first, moreNaturals, table) {
  const modifier = (Number(first.total) || 0) - (Number(first.natural) || 0);
  const answers = [{ natural: first.natural, total: first.total, outcome: first.outcome }];
  for (const natural of moreNaturals) {
    const total = natural + modifier;
    answers.push({ natural, total, outcome: outcomeFromTable(table, natural, total) });
  }
  return answers;
}

/** Count each outcome among the answers. Unknown outcomes are dropped. */
export function tallyOutcomes(answers) {
  const tally = {};
  for (const a of answers ?? []) {
    const outcome = typeof a === "string" ? a : a?.outcome;
    if (!HIRING_OUTCOMES.includes(outcome)) continue;
    tally[outcome] = (tally[outcome] ?? 0) + 1;
  }
  return tally;
}

/**
 * Split a bulk row by a tally of answers.
 * @param {object} row - the plain candidate record
 * @param {Record<string, number>} tally - outcome → heads that gave it
 * @param {{employerUuid: string, time: number, newId: () => string}} who
 * @returns {{rows: object[], hires: {id: string, elan: boolean, quantity: number}[], slandered: number, offered: number}}
 *   `rows` replaces the original in the candidate list (the remainder first,
 *   under the original id, when any head was not offered); `hires` names the
 *   rows to hire, accepted before élan; `slandered` counts the heads that
 *   refused and slandered.
 */
export function splitBulkRow(row, tally, { employerUuid, time, newId }) {
  const quantity = Math.max(1, Math.floor(Number(row.quantity) || 1));
  const counts = HIRING_OUTCOMES.map((outcome) => [outcome, Math.max(0, Math.floor(Number(tally?.[outcome]) || 0))]);
  const offered = counts.reduce((sum, [, n]) => sum + n, 0);
  if (offered > quantity) throw new RangeError(`an offer to ${offered} heads exceeds a row of ${quantity}`);
  const refusals = (row.refusals ?? []).map((r) => ({ ...r }));
  const rows = [];
  const hires = [];
  if (quantity - offered > 0) rows.push({ ...row, refusals, quantity: quantity - offered });
  let slandered = 0;
  for (const [outcome, n] of counts) {
    if (!n) continue;
    const part = { ...row, id: newId(), quantity: n, refusals: refusals.map((r) => ({ ...r })) };
    if (REFUSALS.has(outcome)) part.refusals.push({ employerUuid, time, result: outcome });
    if (outcome === "refuseSlander") {
      part.status = "slandered";
      slandered += n;
    }
    rows.push(part);
    if (outcome === "accept" || outcome === "acceptElan") hires.push({ id: part.id, elan: outcome === "acceptElan", quantity: n });
  }
  return { rows, hires, slandered, offered };
}

/**
 * Take part of a bulk row without an answer to record — a unit assembled from
 * the market. The taken heads become a row of their own, marked hired; the
 * rest stay available under the original id.
 * @returns {{rows: object[], takenId: string|null}}
 */
export function takeFromRow(row, count, newId) {
  const quantity = Math.max(1, Math.floor(Number(row.quantity) || 1));
  const n = Math.min(quantity, Math.max(0, Math.floor(Number(count) || 0)));
  if (!n) return { rows: [row], takenId: null };
  if (n === quantity) return { rows: [{ ...row, status: "hired" }], takenId: row.id };
  const taken = { ...row, id: newId(), quantity: n, status: "hired" };
  return { rows: [{ ...row, quantity: quantity - n }, taken], takenId: taken.id };
}
