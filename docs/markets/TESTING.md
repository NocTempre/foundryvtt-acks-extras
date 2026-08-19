# Markets — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

## Fixtures

- A disposable `acks-extras.location` actor **with a market added** — see
  [../location/TESTING.md](../location/TESTING.md); without it the market
  subtree does not exist.
- A disposable `character` as the buyer, holding coin minted through
  `lib.money.creditCoin`.

## Core drive mechanics (non-obvious, learned live)

- **`purchase(location, payload)` takes a `buyerUuid` and an `itemName`** —
  not a buyer document and not a catalogue row. A document returns
  `{error: "noBuyer"}`; the guard resolves the uuid itself.
- **Coin `cv` is the COPPER value: a gold piece is 100.** Minting 500 "Gold"
  at `cv: 1` shows 500 coins on the sheet worth 5 gp, and every purchase then
  answers `insufficientGold` — which reads as a broken spender rather than a
  broken fixture. This is the single most expensive mistake in this recipe.
- **`availabilityFor(location, row)` wants a CATALOGUE row**, one of the
  objects `buildCatalog(location)` returns. An ad-hoc `{name, cost}` answers
  `{status: "untradeable"}`, which looks like a rules verdict and is not.
- The catalogue is built from the shipped equipment packs, so its row count is
  a real assertion: an empty catalogue means `build:packs` was not run.
- Availability bands come from the market-class rarity table through
  `lib/tables.mjs`'s `bracketRow`; the verdict names the band as well as the
  caps, and the party cap and the market cap are different numbers.
- Every settings key is prefixed `acks-extras.markets*` except
  `playerMarketVisibility` and `importedTables` — reaching for a
  `defaultMarketClass` setting throws "is not a registered game setting".

## Steps

1. `buildCatalog(location)`.
   *Observable:* a non-empty row list drawn from the shipped packs, each row
   carrying `key`, `name`, `type`, `costGp` and the item data to create from.
2. `availabilityFor(location, row)` for a common row and a rare one.
   *Observable:* `{status, band, remaining, capParty, capMarket}`; the band is
   the rarity table's, and the two caps differ.
3. Mint 500 gp on the buyer (`cv: 100`), then
   `purchase(location, {buyerUuid, itemName, qty: 1})`.
   *Observable:* `{ok: true, qty, unitGp, totalGp}`; two chat cards (the
   payment and the sale); the item on the buyer's sheet; the buyer's coin
   reduced by the total; and one new entry in
   `location.system.market.marketLog`.
4. Buy past the party cap.
   *Observable:* refused by the cap with the cap named, not silently clamped
   — and turning `marketsEnforceCaps` off allows it, which is what proves the
   setting gates something.
5. Sell: `salePlan` then `sell`.
   *Observable:* the plan states the price before the sale; the coin arrives
   and the item leaves.
6. Search: `createItemSearch` for something not stocked, then
   `performSearchDay` across the search window.
   *Observable:* the search fee is charged per week per type as the sheet
   states; the ledger records each day; `cancelItemSearch` stops it and
   refunds nothing already spent.
7. Imports and commissions: `placeImportOrder` then `processImports`;
   `placeCommission` then `performCommission`.
   *Observable:* each books an order that survives a reload, and processing
   delivers exactly once — process twice and the second is refused as a
   duplicate rather than delivering again.
8. Player-relayed purchase: from a seat owning the buyer, buy through the
   sheet.
   *Observable:* the request is executed on the GM client against the real
   market state, and a seat that does not own the buyer is refused
   (`notYours`).

## Teardown

Delete the location and the buyer, and any items the purchases created.
Confirm the market log goes with the location.
