/**
 * The two printed figures the monster sheet's load readings and attribute
 * fields lean on, read from the Judge's own Monstrous Manual (MM ch. 3,
 * Normal Load and Attributes for Monsters): how far past its normal load a
 * creature can carry and the share of its speed it keeps there, and the score
 * a monster's attributes start at. They are imported into the `monsters`
 * registry document's `loadRule` and `defaultScore` tables and read here;
 * nothing in source states one, and a figure that was not imported reads as
 * null. A Judge's override layer is read like any other. Foundry-free.
 */
import { citeOf, expectTables, getDoc, hasDoc, isMissingRow } from "../lib/tables.mjs";

/** The registry document the figures sit on. */
export const LOAD_DOC = "monsters";

// Declared where it is read, so the import names the tables as outstanding
// whichever feature loads first. The ids are the two tables below, written as
// literals because the producers gate reads this call from source.
expectTables(LOAD_DOC, ["loadRule", "defaultScore"]);

/** One stored table of the document, or null where it is absent or unread. */
function tableOf(id) {
  if (!hasDoc(LOAD_DOC)) return null;
  const table = getDoc(LOAD_DOC)?.tables?.[id];
  return table && typeof table === "object" && !isMissingRow(table) ? table : null;
}

/**
 * The load rule as `{maxMultiple, speedShare}`: the creature's maximum load
 * as a multiple of its normal load, and the share of its speed it keeps above
 * the normal load. Each is null where it was not imported or is no figure a
 * load can follow (a multiple at or below one, a share outside zero to one).
 */
export function loadRule() {
  const table = tableOf("loadRule");
  const multiple = Number(table?.maxMultiple);
  const share = Number(table?.speedShare);
  return {
    maxMultiple: Number.isFinite(multiple) && multiple > 1 ? multiple : null,
    speedShare: Number.isFinite(share) && share > 0 && share < 1 ? share : null,
  };
}

/** The score an attribute starts at, or null where it was not imported or is not a whole figure above zero. */
export function defaultScore() {
  const score = Number(tableOf("defaultScore")?.score);
  return Number.isInteger(score) && score > 0 ? score : null;
}

/** The page the load rule was read from, or null where it was not read from one. */
export function loadRuleCite() {
  return hasDoc(LOAD_DOC) ? citeOf(LOAD_DOC, "loadRule") : null;
}

/**
 * Where a load stands against its normal load and its ceiling: the bar's fill
 * and tick as percentages and the tone, and the state a sheet names. The
 * ceiling is the creature's own maximum, else the imported multiple of its
 * normal load; with neither, a load past normal is encumbered and never
 * overloaded, and the bar scales to whichever of the two is larger.
 *
 * @param {object} o
 * @param {number} o.stone the load carried
 * @param {number|null} o.normal the normal load, null where none is recorded
 * @param {number|null} [o.max] the creature's own maximum load
 * @param {number|null} [o.maxMultiple] `loadRule().maxMultiple`
 * @returns {{ceiling: number|null, denom: number, state: string}}
 */
export function loadStanding({ stone, normal, max = null, maxMultiple = null }) {
  const ceiling = max != null ? Number(max) : maxMultiple != null ? normal * maxMultiple : null;
  const denom = (ceiling != null && ceiling > 0 ? ceiling : Math.max(stone, normal)) || 1;
  let state = "unencumbered";
  if (stone > normal) state = ceiling != null && stone > ceiling ? "overloaded" : "encumbered";
  return { ceiling, denom, state };
}
