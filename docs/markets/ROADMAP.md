# Markets — Roadmap

Re-issued 2026-11-14.

## Not built

The trade layer's design is `wip/trade-layer.md`. Built: merchandise Items,
the demand layers and Generator, market reports, the character Trade tab, AX3
market profiles, the gate (RR tariff, and the city's own toll), and a party's
vehicles setting its market impact. What is not built:

- **Trade routes and demand equalisation (P3)**: route Items (network and
  steady), the suggest-from-map helper, JJ Ch6 Step 7E over the base layer,
  timed class events, and the steady route's impact and price step (a
  mercantile network itself is built: MODEL, Known markets and Ventures; so
  is the Range of Trade table's import and reader: MODEL, Range of Trade).
  `goods.demandDerived` is reserved for it and unread until then.
- **A disreputable venturer loses the network** (RR ch. 2, Venturer, Access
  to Capital): nothing records a missed interest payment, so the network
  counts wherever the market is known.
- **The network on carriage and passengers**, which waits on passenger and
  cargo transport below.
- **Venture logistics**: cargo handling times (at an anchorage or a pasture
  outside too), warehousing, exhaustion-of-arbitrage and price-reset
  options, passenger and cargo transport, passive investment. Also not built
  from the same plan: loot as merchandise, mercantile XP and venturer powers,
  and JJ Ch7 venues. (Built: the tariff at the gate, smuggled goods, sneaking
  in, and moorage and stabling; MODEL, Ventures.)
- **The smuggling throw**: the gate records what is smuggled in and tells
  the Judge; the Smuggling hijink itself (RR §VIII.5) and confiscation are
  the domains feature's hijinks, not built.
- **A Judge's `gateToll` is overwritten only by repair's force.** The
  merged-repair path has no per-field force for `goods.gateToll`: only
  `repair.force` overwrites a value a Judge set, and a re-import does not.
  A per-field force would let Repair reset the one field.
- **The gate toll has no step in the markets walk.** `tools/live/markets.mjs`
  has no step for the city gate (TESTING G8, marker `markets/city-gate`), so
  G8 is walked by hand.
- **A trader's seen prices.** `pricesSeen` on a market report
  (`markets/data/report-data.mjs`) is reserved and nothing writes it.
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
- **Detection results mark `detected`.** The spell work's detection results
  (a detect-magic effect, a creature's sense) write nothing to an item's
  `flags["acks-extras"].markets.detected` today: only a treasure deal writes it
  (`false`), and an identification or the Judge's panel sets it true. Linking a
  detection result to the item it names is unbuilt.
- **A trader's markets, from the trader's owner's seat.** Actors sidebar → a place's sheet → Trade or Ventures
  tab → Known to this trader, and Actors sidebar → a character's sheet → Trade tab with its Trader chip, are the
  Judge's: the trader's owner can neither list a market nor see the tab before one is listed. Proposed: the
  trader's owner lists, and `setMarketKnown` asks the trader's ownership in place of the role (its refusal
  today names a market's demand, a different act). Open: what the Trader chip governs once the tab follows
  ownership. 2 surfaces, 8 role reads. Built, it qualifies three archived entries' In force rows (2026-09-29,
  2026-09-30, 2026-10-15).
- **A hand-made market's switches, from the place's owner's seat.** Actors sidebar → a place's sheet → Trade
  tab → Masterwork contact, and Ventures tab → Gate toll, are the Judge's while the same sheet's Settings tab is
  the owner's. A hand-made place is every player's to own, so ownership would open both to every player there.
  Open: whether the page gives the contact to the Judge by name, which keeps it the Judge's press as printed
  procedure. 2 surfaces, 4 role reads.
- **An item's Apparent value and Self-made, from its holder's seat.** An item's sheet → Details tab → the magic
  panel draws both for the Judge only. The truth fields beside them are the Judge's secret and stay so; the
  panel's mount on a fully identified item is equipment's. 1 surface, 1 role read.
