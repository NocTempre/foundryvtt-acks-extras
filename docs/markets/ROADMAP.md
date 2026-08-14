# Markets — Roadmap

## In flight (current milestone order)

1. `system.market.goods` schema on the location actor.
2. Pure rules engine (availability caps, pricing, imports) + offline tests.
3. Buy flow: Trade tab, purchase dialog, GM-routed atomic handler.
4. Sell flow: same caps, scavenged reduction, item destruction.
5. Import orders: +1/+2 hub sourcing, 2d6 arrival, loss on 12.
6. Magic-item market: apparent value, identified pricing, JJ transaction
   table, automated identification ladder.
7. Party-config app, guides, live verification.

## Not built, deliberately deferred

- **Full arbitrage / trade routes**: market impact from real cargo fleets,
  tolls and tariffs, moorage/stabling, loading times, warehousing,
  merchandise exchange logistics, passenger and cargo transport, passive
  investment. The `mercantile.merchandiseTypes` table already imports the
  daily-stones grid these need.
- **Demand-modifier generation** (Judges Journal table) and the assessment
  knowledge game (successful/partial/expertise/false results); v1 stores
  GM-set modifiers per merchandise type.
- **Spell-casting purchases** (RR spell availability by market class).
- **Magic-item commissioning** (3× base cost, Class I/II only).
- **Source-market ledgers for import hubs** — v1 treats hubs as abstract
  markets with fresh availability per order.
