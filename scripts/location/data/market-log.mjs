/**
 * The market ledger's one length. Every writer of a location's
 * `system.market.marketLog` appends through `appendMarketLog`. Foundry-free.
 * See docs/location/DECISIONS.md, "One length for the market ledger, and a hire is stamped to its employer (2026-10-15)".
 */

/** How many rows a market's ledger keeps: the most recent. */
export const MARKET_LOG_CAP = 300;

/** The ledger rows with `entries` appended, cut to the cap from the oldest end. */
export function appendMarketLog(rows, ...entries) {
  const out = [...(rows ?? []), ...entries];
  return out.length > MARKET_LOG_CAP ? out.slice(-MARKET_LOG_CAP) : out;
}
