# Markets — Design Model

Item markets on settlements: buying and selling equipment under the ACKS II
monthly availability rules, demand- and bargaining-adjusted prices, merchant
importing from larger hubs, and the magic-item market with identification.

- **Reuse**: the location actor's `system.market` subtree (presence IS the
  market flag), henchmen's market-class derivation and coin adapter
  (`spendGold`/`grantGold`), equipment's gear-grant lookup, the lib table
  registry / sockets / roll idioms.
- **Extend**: `system.market.goods` on the location (schema fragment authored
  here, composed in by location — see Ownership below), and
  `flags["acks-extras"].markets` on Item documents (magic/identification
  state, merchandise-category override).
- **Enhance**: a Trade tab on the location sheet.
- **Invent**: nothing core provides.

## Ownership

Location owns the schema *file* (`scripts/location/data/location-data.mjs`
composes `goodsSchema()` into `marketSchema()` as it composes henchmen's
recruitment state); markets owns the `goods` field's semantics and every
writer. One writer path: the GM-routed socket handlers in
`scripts/markets/engine/`.

## Data pipeline

No availability value, price step, or transaction count ships in this repo.
Tables arrive per world through acks-importer (`availability.
equipmentAvailability`, `mercantile.merchandiseTypes`,
`magicItems.transactionsByMarketClass`) and are read at runtime through the
lib tables registry; `expectTables` declarations generate fillable
placeholders for GMs without the books.

## The engine

One writer path: every mutation of `system.market.goods` runs through the
GM-routable handlers in `scripts/markets/engine/` (local-first — a seat
that can write both documents acts directly). All flows share
`resolveMonthlyAvailability`: band from price (ceiling into the book's
integer bounds), the party's cell at its EFFECTIVE market class against the
market total at the town's TRUE class, monthly rows pruned on write, and
the cached %-rolls — the party's own find first, the town's tenfold stock
(whole units plus at most one remainder d100) second, floored by any
party's find.

- **Buy/sell** (`engine/trade.mjs`): staged copper pricing (condition,
  demand steps, Bargaining swing by opposed winner); purchases stack
  (quantity merge or one bundle); sales destroy the sold document. Magic
  items trade by identification on the JJ transaction grid.
- **Imports, commissions, searches** (`engine/imports.mjs`): all deliver
  through one due-work sweep the GM time watcher runs (`onTimeAdvanced`,
  watermarked) with an owner-facing process button. Import fates are rolled
  at placement; commissions price as construction projects (imported wage
  and construction rates); a directed search re-examines each fresh market
  month through the same shared rolls the buy flow honors.
- **Ventures** (`engine/ventures.mjs`): dedicated-day actions post now and
  resolve when their day passes — market entry (toll from the imported
  Market Characteristics; impact from declared cargo over the baseline),
  assessment (2d6+CHA writes per-party demand-modifier BELIEFS, wrong on a
  false assessment and indistinguishable from truth), soliciting (opens
  base stones × impact at the month's rolled price: 4d4−10 steps + demand
  + class shift), and merchandise trades with the optional spot-price
  negotiation. Merchandise loads are `item` documents, one unit per stone.
- **Identification** (`engine/identify.mjs`): the JJ method ladder,
  qualified through the identifier's own ability items or level; failures
  lock per method and identifier until a level is gained.
