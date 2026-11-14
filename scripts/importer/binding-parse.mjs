/**
 * The throw and modifier readers the table bindings share: pure text → number
 * parsers over a table cell or a captured prose window. Each returns null where
 * the text carries no such figure, so a binding that finds nothing assembles
 * nothing. No value ships; the numbers are whatever the page's own text holds.
 */

/** The target number N of a "throw of N+" clause, anchored on the words that introduce it. */
export function parseThrowTarget(text) {
  const m = /throw\s+of\s+(\d+)\s*\+/i.exec(String(text ?? ""));
  return m ? Number(m[1]) : null;
}

/** The first "N+" in a cell or window → N. */
export function parseTargetPlus(text) {
  const m = /(\d+)\s*\+/.exec(String(text ?? ""));
  return m ? Number(m[1]) : null;
}

/** The first explicitly signed figure in a clause, sign kept and inner spaces dropped ("- N" → -N). */
export function parseSignedClause(text) {
  const m = /([+-]\s*\d+)/.exec(String(text ?? ""));
  return m ? Number(m[1].replace(/\s+/g, "")) : null;
}
