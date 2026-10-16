/**
 * The market ledger's one length. Every feature that writes a location's
 * `system.market.marketLog` appends through `appendMarketLog`, so no writer's
 * shorter cap cuts what another kept: the ledger is the GM's rollback record
 * and the evidence a known market is read from (markets `rules/known.mjs`).
 * Foundry-free.
 */

/** How many rows a market's ledger keeps: the most recent. */
export const MARKET_LOG_CAP = 300;

/** The ledger rows with `entries` appended, cut to the cap from the oldest end. */
export function appendMarketLog(rows, ...entries) {
  const out = [...(rows ?? []), ...entries];
  return out.length > MARKET_LOG_CAP ? out.slice(-MARKET_LOG_CAP) : out;
}
