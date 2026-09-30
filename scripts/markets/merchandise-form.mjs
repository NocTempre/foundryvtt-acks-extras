/**
 * How the merchandise sheet turns what a form submits back into stored data.
 * Foundry-free, so the harness can assert it.
 */

/** A race key as typed, made safe to be an object key: no dots, no spaces, lower case. */
export const raceKeyOf = (text) =>
  String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, "");

/**
 * The racial object a submitted set of rows stands for. A row with no usable
 * race name or no number is left out; a race named twice keeps its last row.
 * @param {Object<string, {race?: string, value?: *}>|Array<{race?: string, value?: *}>} rows
 * @returns {Object<string, number>}
 */
export function racialFromRows(rows) {
  const out = {};
  for (const row of Object.values(rows ?? {})) {
    const race = raceKeyOf(row?.race);
    const value = row?.value === "" || row?.value === null || row?.value === undefined ? NaN : Number(row.value);
    if (race && Number.isFinite(value)) out[race] = value;
  }
  return out;
}

/** A comma-separated line as a list: trimmed, empties dropped. */
export const listFromLine = (line) =>
  String(line ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
