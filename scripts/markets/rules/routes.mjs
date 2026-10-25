/**
 * Trade routes (JJ ch. 6, Step 7E). Pure module: the imported Range of Trade
 * cells arrive as printed strings and are read here; the distances
 * themselves are the Judge's, never this module's.
 */

/**
 * A Range of Trade cell as miles: the figure that opens it, written bare or
 * followed by "mi"/"miles" ("N miles (M hexes)" reads N). A cell that opens
 * with anything else, or measures in another unit, is null: a range the
 * market cannot read, never a guessed one.
 * @param {string|number} text
 * @returns {number|null}
 */
export function parseMiles(text) {
  if (typeof text === "number") return Number.isFinite(text) && text >= 0 ? text : null;
  const m = String(text ?? "").replace(/,/g, "").match(/^\s*(\d+(?:\.\d+)?)\s*(?:mi(?:les?)?\b|$)/i);
  return m ? Number(m[1]) : null;
}
