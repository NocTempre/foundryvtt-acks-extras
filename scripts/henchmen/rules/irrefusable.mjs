/**
 * The Irrefusable Offer's printed figures (MM 351), read from the Judge's
 * imported `influence.irrefusableOffer` table, the one the influence-hosted
 * page reads: the result column, the opposite-alignment figure and the
 * starting loyalty of each result that enters service. Nothing here ships a
 * figure; an unread figure is null, and a caller that needs it applies
 * nothing and says so.
 */
import { optTable } from "./tables.mjs";
import { outcomeTableFromBands } from "./bulk-offer.mjs";
import { LOYALTY_CHANGES, loyaltyChange } from "./loyalty.mjs";

/** The imported document and table holding the Irrefusable Offer, and the page it cites. */
export const IRREFUSABLE = Object.freeze({ docId: "influence", tableId: "irrefusableOffer", cite: "MM 351" });

/** The results worst first, in the throw's outcome vocabulary. */
export const IRREFUSABLE_OUTCOMES = Object.freeze(["betrayal", "escape", "hesitate", "accept", "acceptElan"]);

/** The results in which the monster only feigns acceptance. */
export const FEIGNED_OUTCOMES = Object.freeze(["betrayal", "escape"]);

/** The table key of each entering result's starting loyalty. */
const START_KEY = Object.freeze({ hesitate: "hesitateLoyalty", accept: "acceptLoyalty", acceptElan: "elanLoyalty" });

const table = () => optTable(IRREFUSABLE.docId, IRREFUSABLE.tableId);
const intOrNull = (v) => (Number.isInteger(v) ? v : null);

/** The outcome table the imported result column makes (`outcomeFromTable`'s shape), or null. */
export function irrefusableOutcomes() {
  return outcomeTableFromBands(table()?.bands, IRREFUSABLE_OUTCOMES);
}

/** The opposite-alignment figure, or null. */
export function oppositeAlignmentFigure() {
  return intOrNull(table()?.oppositeAlignment);
}

/**
 * The loyalty a monster hired on `outcome` starts at, and where that figure
 * is read. An entering result takes its own start from MM 351; a feigned
 * acceptance takes the start RR 166 gives a creature forced into servitude.
 * `figure` is null where the figure is not imported, or `outcome` is no
 * result of this roll.
 * @returns {{figure: number|null, docId: string, tableId: string, cite: string}|null} null for an unknown outcome
 */
export function irrefusableStart(outcome) {
  if (FEIGNED_OUTCOMES.includes(outcome)) {
    return { figure: loyaltyChange("forcedServitude"), ...LOYALTY_CHANGES };
  }
  const key = START_KEY[outcome];
  if (!key) return null;
  return { figure: intOrNull(table()?.[key]), ...IRREFUSABLE };
}
