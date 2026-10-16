# Markets — Roadmap

## In flight

- The trade layer's remaining phases (`wip/trade-layer.md`): trade routes and
  demand equalisation (P3) next; then venture logistics, loot as merchandise,
  carriage, passive investment, mercantile XP and venturer powers, and JJ Ch7
  venues. The first phases (merchandise Items, the demand layers and
  Generator, market reports, the character Trade tab, AX3 market profiles)
  shipped in 9.2.0.

## Not built, deliberately deferred

- **Trade routes and demand equalisation (P3)**: route Items (network and
  steady), the suggest-from-map helper, JJ Ch6 Step 7E over the base layer,
  timed class events, and the steady route's impact and price step (a
  mercantile network itself is built: MODEL, Known markets and Ventures).
  `goods.demandDerived` is reserved for it and unread until then.
- **A disreputable venturer loses the network** (RR ch. 2, Venturer, Access
  to Capital): nothing records a missed interest payment, so the network
  counts wherever the market is known.
- **The network on carriage and passengers**, which waits on passenger and
  cargo transport below.
- **Venture logistics**: tariffs on incoming sale cargo, moorage and
  stabling fees, cargo handling times, warehousing, exhaustion-of-arbitrage
  and price-reset options, passenger and cargo transport, passive
  investment. (The party's own vehicles setting its market impact, and
  loads bought into their holds, landed 2026-09-30 — MODEL, Ventures.)
- **Calendar seasons for grain pricing** — the spring/autumn step waits on
  a season source; the engine takes a `season` argument already.
- **Spell-casting purchases** (RR spell availability by market class).
- **Magic-item commissioning** (JJ 131).
- **Source-market ledgers for import hubs** — hubs are abstract markets
  with fresh availability per order.
- **Economy ruledata has no producer.** `familyIncomeGp` (`engine/till.mjs`)
  reads `economy.familyIncome`, which no recipe writes, so the till always
  takes the Judge's setting — ruled in DECISIONS, "Family income stays a Judge
  setting". `tools/validate-producers.mjs` waives the document against this
  entry.
- **Other setting books' market data.** AX1's demand grid (not yet in the
  register), By This Axe's dwarven families-to-class bracket and its Charter
  of Monopoly duty, AX3's printed trade routes, business page and venues, and
  the Treasure Tome's gem, jewelry and special-treasure tables. Each rides the
  trade-layer phase that first consumes it (`wip/trade-layer.md`).
- **Despoilment's demand shift** (AXIOMS) and dwarven ore tables: not trade
  data under the RR; left unless a Judge asks.
