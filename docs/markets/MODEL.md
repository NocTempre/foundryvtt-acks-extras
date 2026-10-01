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

Every printed figure the rules apply arrives the same way, from an imported
`proseValues` table, and the pure rules under `scripts/markets/rules/` take
it as an argument: the shopping crowd, the all-parties multiple and the hub
shifts and loss result (`availability.marketRulesProse`, RR 124), the
Bargaining swing (`availability.bargainingProse`), the magic-item price
multiples (`magicItems.priceProse`, JJ 131), the identification thresholds
(`magicItems.identifyProse`), the market-impact limits, assessment bands,
class price shifts and negotiation profile (`mercantile.impactProse`,
`assessmentProse`, `priceShiftProse`, `negotiationProse`, JJ 202). The
demand step fraction is derived per category from the merchandise row's own
step and price. `engine/printed.mjs` is the one reader: it returns `null` for
a value the world lacks, and the action that needs it refuses with a notice
naming the missing table (`ACKS-MARKETS.ventures.table.*`,
`trade.error.printedMissing`). No rule falls back to a stand-in number: a
demand step with no derivable fraction quotes unadjusted, a magic price with
no multiple is `unpriced`, an identification method whose threshold is
missing is not offered, and a till with no stated families has target 0 and
writes nothing.

**Coin is the lib's.** The till is the place's house-owned coin
(`lib.money.ownCoin(location)`), valued by `coinTotalCp`, and a monthly
refresh tops it up with `mintCoin`. The changer lists the coin the trader
carries that no lock shuts away and exchanges through
`lib.money.exchangeCoins`. Nothing in this feature counts or writes a coin
row (docs/lib/MODEL.md, "Currency").

**A market is paid at the market.** Every payment this feature makes states
the location as its reach (`within: location`): a purchase, an import order,
a commission, and a venture's toll, bribe and load draw on the payer's coin
on hand and on the coin this market keeps for them, whatever the world's
`coinScope` says. A sale's proceeds and a load's price land where the seller
keeps arriving coin when that is on hand or at this market, and loose on the
seller otherwise. Coin kept anywhere else has to be carried in.

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
  demand steps, Bargaining swing by opposed winner); purchases arrive through
  lib's `deliverItems` (one stack of the quantity, folded into an identical
  stack the buyer carries, or one copy per unit; docs/lib/MODEL.md, "Goods
  handed to an actor, and bundles"); sales destroy the sold document. Magic
  items trade by identification on the JJ transaction grid: the catalog row
  carries `magic` and `magicBaseGp`, and availability, the purchase preview,
  purchases, import orders and directed searches all band and price a magic
  row the same way. When the magic grid is not imported the equipment grid
  stands in; the result carries `gridFallback`, the GM gets a whisper note on
  the receipt and one console and screen warning per session. A magic item a
  sale leaves embedded on the location is a catalog row of its own (`held`,
  `heldItemId`); buying it moves that item to the buyer, priced as magic
  stock and outside the monthly grid. Receipts whisper to the buyer's owners
  carry prices only; the scarce-goods roll record is a separate GM whisper.
  The monthly cap is honoured by every path (`capVerdict`, gated by
  `marketsEnforceCaps`). The masterwork gate reads the markets flag, then the
  equipment sheet's masterwork tier, then the name (`rules/goods.mjs`). The
  catalog skips class-template copies (`isTemplateCopy`: a starting-kit skin
  or any template part), so a shop item is listed once as its base, never
  once per printed descriptor.
- **Imports, commissions, searches** (`engine/imports.mjs`): all deliver
  through one due-work sweep the GM time watcher runs (`onTimeAdvanced`,
  watermarked) with an owner-facing process button. Import fates are rolled
  at placement; commissions price as construction projects (imported wage
  and construction rates); a directed search re-examines each fresh market
  month through the same shared rolls the buy flow honors.
- **Ventures** (`engine/ventures.mjs`): dedicated-day actions post now and
  resolve when their day passes — market entry (toll from the imported
  Market Characteristics; impact from the cargo capacity the party brings
  over the baseline: the hold capacity of each vehicle it enters with, read
  through `vehicles/hold.mjs`, plus any other capacity it states),
  assessment (writes one market REPORT Item holding the assessor's
  demand-modifier beliefs, wrong on a false assessment and indistinguishable
  from truth; see "Market reports and the trade house"), soliciting (opens
  base stones × impact at the month's rolled price: 4d4−10 steps + demand
  + class shift), and merchandise trades with the optional spot-price
  negotiation. Merchandise loads are `item` documents, one unit per stone,
  bought into and sold from the hold a trade names — the trader's own packs,
  or one of the vehicles on the venture row (`vehicleUuids`). A purchase
  into a vehicle is refused past its free room before anything is rolled; a
  sale draws across the hold's stacks (`rules/arbitrage.mjs` `planLoadDraw`,
  all or nothing); a load kept aboard for another character is never counted
  or drawn. The seat must own the hold as well as the trader.
  A day that cannot resolve because its imported table is missing posts a
  card to the actor's owners and the GM naming the table.
  - **The assessment's roll is made on the influence page**, not by the
    sweep: the tab opens the influence feature's `marketAssessment` mode
    against the market as target (Charisma, one tone proficiency, Mystic
    Aura, a bribe, reaction-family effects; the bands are the imported
    assessment column handed over as `ctx.bands`), and
    `engine/assessment.mjs` listens for `acksExtras.influenceRollComplete`
    and posts the day with the roll stored on the action (`natural`,
    `total`) and the bribe debited to the market as the day is posted. The
    sweep reads the stored total; a day posted without one (the influence
    feature below api 9) is rolled bare, 2d6 + Charisma. The bribe's fee
    is priced against `assessmentBribeBasisHd()` (one hit die: a market's
    merchants are ordinary people), and the Judge changes it on the page.
  - **The queue refuses a duplicate and allows a withdrawal**
    (`rules/arbitrage.mjs` `pendingDuplicate`, `cancelVerdict`): the same
    trader's same kind of day (same merchandise, for a solicitation) cannot
    wait twice; a pending day may be withdrawn by the Judge or the trader's
    owner, its row kept as `cancelled`, nothing refunded.
  - **A party may leave the market** (`leaveMarket`, `leaveVentureMarket`):
    the month's row stays with `entered` false and the toll on record, the
    party's solicitations for the month are dropped, and its waiting
    enter/assess/solicit days are withdrawn. Entering again overwrites the
    row with a fresh declaration and pays a fresh toll.
- **Known markets** (`rules/known.mjs`, `engine/known-market.mjs`): a
  mercantile network's class shift is situational — it counts in a market the
  trader has been in before — and henchmen's `effectiveMarketClass` asks
  `marketKnownTo(location, actor)` through the api at call time to decide
  whether to count it. Known means any of: a ledger row stamped to the trader,
  a venture row for the trader's party in any month, or the Judge's list on
  the trader (`flags["acks-extras"].markets.knownMarkets`, set from the Trade
  tab's Known to this trader switch). The tab states the town's class and
  the acting trader's effective class beside it.
- **The ledger stamps its actor** (`location-data.mjs` `marketLog`): every
  row the markets engine writes about a trader carries `actorUuid` and that
  actor's signed coin movement `gp` (paid negative). `rules/ledger.mjs`
  reads a trader's history back out of every market's log (`HISTORY_TYPES`,
  `historyRows`, `historyNetGp`), newest first, own rows only; the location
  Trade tab shows it for the viewer's own traders (the GM: every stamped
  trader) and the character Trade tab for that character across every
  market. The assessment row masks a false outcome as partial, since the
  trader reads it.
- **The Trade tab** (`apps/trade-tab.mjs`): the location sheet mounts it
  with one prepare call, one spread of `TRADE_TAB_ACTIONS` into its actions
  and one bind call; markets owns everything behind the buttons. Every action
  is taken by one ACTING TRADER, picked in the tab (a GM among the player
  characters, a player among their own) and remembered per client in
  `marketsActingTrader`. A player sees only their own party's imports,
  commissions, searches and queued actions; the GM sees every party's,
  labeled, plus a per-party block of demand beliefs (read from reports) and
  this month's venture, and a list of the reports held at this market.
  A relayed action toasts success only on `{ok: true}`. The GM's demand
  chips mark a pinned category; Set demand offers Set and Clear (base), Pin
  and Unpin (override), and a button opens the Demand Generator.
- **Identification** (`engine/identify.mjs`): the JJ method ladder,
  qualified through the identifier's own ability items or level; failures
  lock per method and identifier until a level is gained.

## What a party carries

A party's merchandise loads — the items they have bought for resale or trade —
are read and priced through four API functions on `acksExtras.markets`. Each
load is a stack of identical merchandise in a character's packs or a vehicle's
hold, tracked with a `markets` flag marking it as merchandise for a category,
and priced at the market's rolled price for this month where one exists, else at
its own base cost.

- `manifestRows(plainItems, {holderUuid, holderName, traderUuid, prices, monthStart, merchFor})` —
  the loads among plain item data, one row per stack, priced. Pure.
- `manifestTotals(rows)` — the sum of stones and gp value across a rows array.
- `manifestOf(holders, {market, traderUuid})` — the loads across holders
  (character and vehicle actors), returning `{rows: […], stones, valueGp}`.
- `removeLoads(holder, category, stones, {traderUuid})` — remove exactly
  `stones` units from the holder's loads of a category, returning
  `{ok: true, removed: [snapshots]}` or
  `{ok: false, reason: "noLoads", held: <stones stacked>}`.

## The merchandise catalogue

One good is one Item of sub-type `acks-extras.merchandise`
(`data/merchandise-data.mjs`, sheet `apps/merchandise-sheet.mjs`, registered by
`merchandise-module.mjs`). The fields are the good's `key` and `tier`, its
`container`, `pricePerStoneGp` and optional `priceStepGp`, six `dailyStones`
(one per market class), the `environment` modifiers (the age and terrain
columns of `merchandise-keys.mjs`), a `racial` map, the `random` band (`table`,
`min`, `max`, `special`), the `tariffExempt` and `seasonalPrice` flags, loot
kinds, item categories, aliases, prose and a `source` citation. Nothing in
those fields ships as a value; the importer writes them.

- **The vocabulary** (`merchandise-keys.mjs`) is module configuration: the
  keys, their English label patterns and the demand column keys. The importer
  binding and the `mercantile.merchandiseTypes` table recipe both read it, so
  one label maps to one key on every path.
- **Import** (`importer/merchandise-binding.mjs`, `importMerchandise` in
  `importer/cookbook.mjs`): the entries of kind `kind.merchandise` yield one
  item per printed row (claim id `<entry>.<key>`, repaired by
  `refreshImported`); the entries of kind `kind.merchandiseDemand` are then
  appended onto those items by key (`environment`, `racial`), and the age-band
  header text lands in the world setting `marketsDemandAgeHeaders`. A label,
  cell or racial phrase the binding cannot read is reported to the GM and
  written nowhere. The Getting Started chain runs the step, and the Books
  dialog offers it as a re-import.
- **The reader** (`engine/merchandise.mjs`): `merchandiseCatalog()` merges per
  key, world item over compendium item over legacy table row.
  `merchandiseFor(key)` reads one. The compendium is read from the pack index
  at `ready` (`primeMerchandiseCatalog`). A world merchandise item created,
  edited or deleted drops the cached snapshot; a compendium one re-reads the
  packs, once per burst of writes.
- **Migration:** `buildMerchandiseFromTables()` (GM only; a button in the
  Books dialog's GM band) creates a world item for every key the imported
  legacy tables answer and no item does yet. It is idempotent.

Pricing's demand-step fraction (`stepFractionFor`), the ventures (assessment,
solicitation, the month's price, merchandise trades), the Trade tab's goods
list and the Demand Generator read the catalogue, so a Judge's own good takes
part in all of them. The legacy table is only the catalogue's lowest layer;
its rows take their label from the module's own `ACKS-MARKETS.merch.*` keys.

## Demand

A market's demand is kept in layers, one row per merchandise key, and is
read through one function.

- **Layers** (`goods` fields): `demand` is the BASE (what the generator or a
  book wrote), `demandDerived` (with `demandDerivedTime` and
  `demandInputsKey`) is reserved for trade-route equalisation and has no
  writer, `demandOverrides` are the Judge's pins.
- **`trueDemand(goods, category)`** (`rules/demand.mjs`) is the one reader: the
  override if a row exists, else the derived row, else the base, else 0.
  Pricing (`demandStepsFor`), ventures (`trueDm`, assessments, the rolled
  month price) and the Trade tab's chips all read through it.
- **`engine/demand.mjs`** is the sole writer. `writeDemand(location, {layer,
  category, modifier})` writes or, with `null`, deletes one row of the base or
  override layer; `applyGenerated(location, {profile, results})` replaces the
  base layer and stores `dmProfile` (the inputs, the per-good Step A `rolls`,
  the Step C `landPicks`, `source` cleared to null, `time`). Both refuse
  `{error: "gmOnly"}` from a player seat, and neither touches the layer the
  other owns.
- **`dmProfile.source`** is `{book, page}` when a book supplied the base and
  null otherwise. Any hand write to the base (`writeDemand` on the base layer,
  a delete included) and `applyGenerated` set it to null, so a later book
  import leaves the Judge's base alone; an override write never touches it.
  Apply asks for confirmation before replacing a book-supplied base or any
  existing base.

### The Demand Generator

`apps/demand-generator.mjs` (opened by a GM button on the Trade tab) runs
JJ 199-202, Step 7 A-D, for every good in `merchandiseCatalog()`, Judge-made
goods included.

- **A:** `1d3-1d3` per good (`STEP_A_ROLL`), stored per good and editable.
- **B:** `baseDemand` adds each applicable environment column of the good's
  merchandise item (the age column `age<band>`, every water and biome ticked,
  the elevation), then drops the fraction toward zero.
- **C:** `landRevenueCounts` reads the imported `demand.landRevenueProse`
  window for the row whose figure is the land revenue; picks are drawn by
  `drawLandPicks` (d100 on the merchandise items' common bands, a roll in no
  common band re-rolled on the precious bands) or added by hand.
- **D:** each race ticked adds the good's `racial` modifier for it.

Every figure the arithmetic uses is a merchandise item's or the imported
table's; `rules/demand.mjs` carries the shape only. The age-band labels are
the world setting `marketsDemandAgeHeaders`, written by the merchandise import
(JJ 202), falling back to "Age band N". A good with no environment data shows
B as a dash and takes A, C and D alone. Nothing is written until Apply.

## Setting-book market profiles

A gazetteer that prints a regional demand grid (AX3 p.222–223) and domain
records (AX3 p.27–33) imports through two register kinds:
`kind.marketGrid` (one grid page; each row keyed `mkt<n>` by row position,
never by name) and `kind.marketRecord` (one domain record; the heading proved
by its `printKey` hash, plus the families and class cells).
`cookbookImportMarketProfiles` (the Import Everything step after factions)
executes both and hands the reads to `market-profile-binding.mjs`:

- `goodsResolver` translates each ACKS I column to a merchandise key: a
  catalogue row whose `aliases` name the column key or its printed header
  first, then `ACKS1_GOODS`. A column that resolves nowhere is reported.
- `marketProfiles` builds, per row, the class (record over grid, a mismatch
  flagged), the families and the base demand rows.
- `marketProfileUpdate` writes only what the place does not already hold
  (`baseIsImportable`: an empty base, or one whose `dmProfile.source` is the
  same page).

A market is claimed as `<book>.mkt<n>`, or, for a record whose `meta.place`
is `"adventure"`, as the book's city actor. It is named by the record's
printed heading when there is one, else `Market N`.

## Market reports and the trade house

What a character believes about a market's demand is an Item, not a row on the
market: `acks-extras.marketReport` (`data/report-data.mjs`, sheet
`apps/report-sheet.mjs`, registered by `report-module.mjs`). The fields are
`marketUuid` and `marketName` (a snapshot, shown when the market is gone),
`assessorUuid`, `partyId`, `time`, `outcome`
(`success|partial|expertise|false|rumor|migrated`), `beliefs`
(`{category, dm}`), `pricesSeen` (reserved, nothing writes it) and `notes`.
A report holds only what its owner believes: a false assessment is stored as a
report whose beliefs are wrong, and the market's true demand never enters it.

- **The house** (`engine/trade-objects.mjs`): trade Items are embedded on one
  location actor, the world setting `marketsTradeHouse` (a uuid, not in the
  config UI). `tradeHouse({create})` makes it for a GM: a location actor named
  from `ACKS-MARKETS.tradeHouse.name`, a `lib/storage` provider, default
  ownership OBSERVER. Each item is stamped to its owner through the storage
  flag, so `objectsOf(ownerUuid)` and `objectsAt(marketUuid)` are filters of
  the house's items. `providersFor` counts goods only, so the house never
  appears as a place a character can retrieve from.
- **Writes are the GM's.** A player holds OBSERVER on the house and cannot
  write it. `writeReport`, `give` (moves the stamp), `retire` (deletes) and
  `saveNotes` run GM-side; a player's `performGive`, `performRetire` and
  `performNotes` reach them through the GM socket relay, which passes the seat
  the server attested. `give`, `retire` and `saveNotes` refuse unless that
  seat is a GM or owns the actor the report is stamped to
  (`handVerdict`, pure), and refuse any item not on the house. The stamp is a
  UI convention, not a security boundary (the storage ruling): a player can
  read every report, and the stored outcome, from the console.
- **The outcome is masked.** `shownOutcome` reads `false` as `partial` for
  anyone but the GM, on the assess card, the sheet, the tab and the location
  list alike.
- **Beliefs** (`rules/reports.mjs`, pure): `beliefsFor(reports, {partyId,
  memberUuids, marketUuid})` is the union of the reports whose `partyId` is the
  party's or whose assessor is a member (`heldByParty`), the newest belief per
  good, ties to the later report. `partyMembers` (`engine/parties.mjs`) gives
  a party's characters: its roster, or for the implicit party the player
  characters no roster claims. The Trade tab's belief chips and the GM's
  per-party block read through it.
- **Assessment writes one report** when it learned anything, owner and
  assessor the acting character, `partyId` the party posted under. It stops
  writing `system.market.goods.dmKnowledge`; the schema field stays, marked
  legacy, so an unmigrated world loses nothing. The house is created by the
  sweep if it is missing. The resolution runs on a GM seat only: a player's
  "Process now" leaves an assessment pending, since a player cannot write the
  house. A write that fails leaves the day pending for the next sweep.
- **Migration** (`migrateDmKnowledge`, GM, run at `ready` on the primary GM once
  the sub-type exists in the world): one `migrated` report per market and
  party, stamped to the house itself (`HOUSE_OWNER`), then the rows cleared.
  Idempotent: a market and party that already hold a migrated report are
  cleared without a second one, and a market with no rows is not touched.

### The Trade tab on the character sheet

`apps/trader-tab.mjs` (`isTrader`, `buildTraderTab`, `bindTraderTab`,
`TRADER_TAB_ACTIONS`) is mounted by the character sheet the way the Magic tab
is: `tabList` gates a `trade` tab on a `trader` fact, the sheet sets it from
`traderTabShown`, builds the panel and spreads the actions.

- **Who is a trader** (`isTraderProfile`, pure): an ability named Bargaining, a
  Profession naming a merchant, the Mercantile Network effect (read by
  henchmen's `hasEffectFlag(actor, "marketClass")`), a report of their own on
  the house, or the GM flag `flags["acks-extras"].markets.trader`. A player
  sees the tab on a trader they own and never on anyone else's; the GM sees it
  on every character, which is where the flag is set.
- **Research** lists the character's reports and every other report their
  party holds, grouped by market, with the believed modifiers, date, assessor
  and masked outcome. Open is always offered; Give to (the party's other
  characters) and Discard only where `ownsReport`: the GM, or a report stamped
  to an actor the user owns.
- **Compare** picks two of the markets the character has reports for and sets
  their believed demand side by side with the difference per good. It reads
  beliefs only, never the market's demand. The two picks are kept on the sheet.
- Routes and holdings are not built.
