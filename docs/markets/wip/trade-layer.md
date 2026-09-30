# WIP — the trade layer (trade routes through venturer powers)

In-flight program. When a phase lands, its substance moves into MODEL /
DECISIONS / ROADMAP / TESTING and its section here is deleted; the file goes
when the last phase lands. Rulings live in `DECISIONS.md` (2026-09-29
entries), not here. P1 (the gap closure), P2 (merchandise Items, demand
layers and Generator, market reports, the Trade tab) and S1 (AX3 market
profiles) shipped in 9.2.0 and are described in MODEL.

## Phases

| Phase | Scope | State |
|---|---|---|
| P3 | Trade routes as Items; equalisation (JJ Ch6 Step 7E); timed class events | next |
| S2 | Printed routes (AX3, AX1) | with P3 |
| P4 | Venture logistics: tariff, moorage, handling, warehousing, optional price rules, seasons, the profit ledger (fleet impact landed 2026-09-30 — MODEL) | not started |
| S3 | Market-local business rules from setting books | with P4 |
| P5 | Selling loot through merchandise | not started |
| S4 | Treasure Tome treasure tables and a treasure generator | with P5 |
| P6 | Carriage (holding Items) | not started |
| P7 | Passive investment (holding Items) | not started |
| P8 | Mercantile XP and venturer powers | not started |
| P9 | JJ Ch7 venues | not started |
| S5 | Setting contracts tables and venues | with P6 / P9 |

## P3 — shape

- `acks-extras.tradeRoute` Item sub-type: `role: network|steady`, the two
  market uuids, mode, miles, status and `blockedUntil`, `source: manual|map`
  with the scene, priority, a steady route's two goods. Network routes are
  owned by the trade house; a steady route by the venturer. Whether a route
  qualifies is derived from Range of Trade and both markets' true class,
  never stored.
- The Trade Network window: routes, suggest-from-map (battlemap roads and hex
  routes with location tokens), the derived matrix with a trace, class
  events.
- Table recipes: `demand.rangeOfTrade` (JJ 203), `campaign.commerceEvents`
  (JJ 111).
- Recompute writes `goods.demandDerived` on the primary GM only, debounced,
  per component, on route create/update/delete, on a location update to
  class, families, events, base, overrides or profile (never to the derived
  layer itself), at the sweep boundary, and by hand. Printed bases equalise
  like generated ones; the Judge pins what must not move.
- Rulings to record when built: a pin is final and still pulls its
  neighbours; equalisation runs largest class first, neighbours by class
  then miles, each edge once against already-shifted values, equal-size
  pairs simultaneously from pre-shift values, ties by stable uuid then
  priority; the network uses true class (with events), never a viewer's
  `effectiveMarketClass`.
