/**
 * The Reaction to Hiring Offer's printed figures (RR 162), read from the
 * Judge's imported `influence.hiringOffer` table: the result column and the
 * two per-count penalties. It is the table the influence-hosted hiring page
 * reads, so the hosted page, this feature's own throw and a bulk offer's
 * further heads all answer from one column. Nothing here ships a figure; an
 * unread figure is null, and a caller that needs it refuses to roll.
 */
import { optTable } from "./tables.mjs";
import { HIRING_OUTCOMES } from "./bulk-offer.mjs";

/** The imported document the hiring figures arrive in. */
export const HIRING_OFFER_DOC = "influence";
/** The table of `HIRING_OFFER_DOC` holding them. */
export const HIRING_OFFER_TABLE = "hiringOffer";

const edge = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * The outcome table (`outcomeFromTable`'s shape) the imported result column
 * makes: band i, worst first, gives `HIRING_OUTCOMES[i]`. Null unless the
 * column holds one band per outcome and every band has an edge.
 * @param {Array<{min?: number|null, max?: number|null}>} bands
 * @returns {{outcomes: {min?: number, max?: number, effect: string}[]}|null}
 */
export function hiringOutcomeTable(bands) {
  if (!Array.isArray(bands) || bands.length !== HIRING_OUTCOMES.length) return null;
  const outcomes = bands.map((band, i) => {
    const min = edge(band?.min);
    const max = edge(band?.max);
    return { ...(min === null ? {} : { min }), ...(max === null ? {} : { max }), effect: HIRING_OUTCOMES[i] };
  });
  return outcomes.every((o) => o.min !== undefined || o.max !== undefined) ? { outcomes } : null;
}

/**
 * What the imported table gives: the outcome table, and the figure each
 * earlier refusal and each slander adds. Any part not read is null.
 * @param {object|null} table - the imported `hiringOffer` table
 * @returns {{outcomes: object|null, refusalPenalty: number|null, slanderPenalty: number|null}}
 */
export function hiringOfferFrom(table) {
  return {
    outcomes: hiringOutcomeTable(table?.bands),
    refusalPenalty: edge(table?.refusalPenalty),
    slanderPenalty: edge(table?.slanderPenalty),
  };
}

/** `hiringOfferFrom` over the world's registry. */
export function hiringOffer() {
  return hiringOfferFrom(optTable(HIRING_OFFER_DOC, HIRING_OFFER_TABLE));
}

/** True when the throw can be rolled and priced: every figure read. */
export function hiringOfferComplete(offer) {
  return Boolean(offer?.outcomes) && offer.refusalPenalty !== null && offer.slanderPenalty !== null;
}
