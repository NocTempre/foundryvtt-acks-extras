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

## Feature status

Scaffolded: settings, vocabulary (29 merchandise types, rarities, magic
kinds, identification states), table expectations, API namespace
(`acksExtras.markets`). Engine, flows, and UI land next — see ROADMAP.md.
