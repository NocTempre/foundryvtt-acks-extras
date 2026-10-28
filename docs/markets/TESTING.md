# Markets — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

The walk that drives this recipe is `tools/live/markets.mjs`
(`node tools/live/run.mjs markets`; `tools/live/README.md` is the contract).
Its header names the walks and steps it covers; a step it does not name is
walked by hand.

## Fixtures

- A disposable `acks-extras.location` actor **with a market added** — see
  [../location/TESTING.md](../location/TESTING.md); without it the market
  subtree does not exist.
- A disposable `character` as the buyer, holding coin minted through
  `lib.money.creditCoin`.
- `tools/live/markets.mjs` keeps its fixtures: each walk's towns,
  characters, vehicles, domains and goods are found again by marker
  (`flags.world.fixture`) — the gate walk's `markets/gate-*`, the parties
  walk's `markets/parties-*`, the moorage walk's `markets/moorage-*`, the
  rest's `markets/<name>` (`QA Report Town` is `markets/report-town`) — and
  built carrying it where none stands. **Bring each to its creation shape
  where its walk starts:** delete its embedded items and effects and make
  the data's again, write its `flags.acks-extras` as the data's, its system
  as the creation data over the type's defaults
  (`new Actor.implementation(data).toObject()`), and its name and ownership
  as the data's (`{diff: false, recursive: false}` for the ownership); then
  add each market again over its town. A town also takes what a place's
  create hook gives a new one, which the data alone does not hold: the
  storage flag, and the table as OWNER where the data names no default;
  without it the player seat's Trade tab never renders. Merchandise keys and party ids are
  fixed strings, not a run's nonce. A run's chat cards are a create path,
  marked `markets/card-<n>` at teardown, and the next run retires the series
  before it builds anything.

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
   Then buy a unit item (a weapon, a flask) at `qty: 3`.
   *Observable:* three documents of that name and type on the buyer, each
   listed on the character sheet, and no `bundle` item among
   `buyer.items` — a bundle is listed by no sheet, so its presence is the
   purchase that vanished.
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

## Trade tab controls walk (acting trader, GM switches, relays)

**Fixtures:** a market location M (default ownership OBSERVER, a class
override), a character A owned by the Player seat with coin minted by
`creditCoin` (`cv: 100`), a second character B on the same seat. For the held
row, a `type: "item"` on A with `system.cost` and
`flags["acks-extras"].markets = {magic: true, baseCostGp, identified: "full"}`
— an unidentified item with no apparent value sells for nothing and answers
`untradeable`, which is the rule, not a fault.

1. GM seat, M's Trade tab: the **Acting as** picker lists the characters that
   have a player owner (and the GM's own). Choosing A stores the uuid in the
   client setting `marketsActingTrader` and re-renders; no actor update fires.
   *Observable:* the picker reads A; Sell rows list A's goods.
2. GM seat: **Masterwork contact** and **Players see demand** flip
   `goods.masterworkContact` / `goods.playersSeeDemand`. Player seat: the two
   buttons are absent; with demand shown the tab carries one chip per true
   modifier, with it hidden only the party's belief chips remain.
3. GM seat, the sheet's GM Settings tab: the exchange select and the till
   target input land on `system.market.exchangeOverride` / `tillTargetGp`.
   With the exchange set to none, a player's Change coin answers `noChanger`
   and debits nothing.
4. GM View tab, Market log: every row carries a label ("Entered the market",
   "Supply and demand assessed"), never a camel-case key.
5. Player seat, Change coin (`lib.money.exchangeCoins` with the exchange on
   market): the seat cannot write M, so the exchange relays to the GM.
   *Observable:* `{ok: true, paidOutCp}`; A's gold down, the change minted on
   A, the till's gold up by the same count.
6. GM seat, Parties (`PartyConfigApp`): Add a row, type a name, Add again, then
   Remove the new row. *Observable:* the typed name survives both; closing
   without Save leaves `marketParties` unchanged.
7. Player seat: a directed search (`performItemSearch`, `qty: 3`) records
   `qty: 3` and the party; an import order with `hub: "local"` records
   `hub: "local"` and an ETA. A Search button shows only on a row that cannot
   be bought this month — in a mid-class market with the month's rolls
   pending, none may show, so post through the engine.
8. Player seat, sell A's magic item (`performSell`). *Observable:* the coin
   arrives at the magic sale price; the item appears on M as a **held** row
   ("held by this market") with a Buy control; the player has no Storage tab.
   Buying it back (`performPurchase` with `heldItemId`) charges the price the
   Purchase dialog previews (`new PurchaseDialog({location, item})
   ._prepareContext({})`, `previewGp`) and moves the item to A. A second sale
   the same month may answer `capExceeded` — the market's monthly cap, not a
   fault.
9. GM seat: Clear on a demand row (`writeDemand(M, {layer: "base", category,
   modifier: null})`) removes the row.
10. Player seat, M's sheet opened and switched to Trade: every button, select
    and input in the tab reads `disabled === false`, while the name field
    outside it stays disabled. Core disables every form control on a sheet
    the viewer does not own, and the engine calls in steps 5–8 bypass the
    button, so only a real `element.click()` on **Enter the market** proves
    the control is reachable. *Observable:* the entry dialog opens (the
    seat's own vehicles, and an other-cargo number), and confirming with no
    vehicle ticked and other cargo 0 posts a pending `enter` action on M
    through the relay. Before entry the player's toolbar carries no
    merchandise picker; once entered, the picker sits captioned before
    Solicit (the network walk checks both).

**Not reachable on a shared world with the GM seat online:** the "not sent"
relay warning (it needs no GM connected), a venture day refused for a missing
table (it needs the table un-imported), and the import cap under
`marketsEnforceCaps` off (a world setting other sessions read). Say so in the
report rather than toggling shared state.

## Coin at the market walk (reach, proceeds, the changer)

A purchase, a sale, an import, a commission and a venture's tolls, bribes,
buys and proceeds each state the market as their reach (`within: location`).
The purchase, the sale and the changer are walked here; the rest pass the
same argument to the same call and are not walked separately. The reach
arithmetic itself is asserted offline in `tools/test-coin-flows.mjs`.

**Fixtures (each id recorded with `api.track`):** the market M of the walk
above; character A, owned by the Player seat, carrying a container and coin,
with a row M keeps for A (`lib.storage.depositCoin(M, {ownerUuid, ownerName,
coppervalue: 100, quantity, name: "Gold"})`); a second place B keeping coin
for A; and A's vault (`acksExtras.location.payIntoVault(A, gp)`, which
resolves to the vault's actor).

**Drive notes (learned live):**
- The Purchase dialog opens from `[data-action="openPurchase"]
  [data-key="<catalogue key>"]` on the Trade tab; its buyer is
  `select[name="buyerUuid"]` and its count `input[name="qty"]`. The Sell
  dialog opens from `[data-action="openSell"][data-item-id]` once the
  **Acting as** picker (`[data-trade-trader]`) reads A.
- The changer opens from `[data-action="marketsExchange"]`: `select[name=
  "itemId"]`, `input[name="count"]`, `select[name="toCv"]`. It offers the coin
  A has on hand.
- **The month's availability refuses before the purse does.** A refusal for
  want of coin needs ONE of a row whose `costGp` is above what A can pay
  with at M; a larger count of a cheap row answers with the monthly cap.
- The picker writes the client setting `marketsActingTrader`. Read it first
  and put it back.

1. Player seat, A's order paying from M first: buy one of a cheap row.
   *Observable:* the price leaves the row M keeps for A and joins M's own
   coin. Coin at B and in the vault is as it was, and the item is on A.
2. With what A carries and what M keeps both below a row's price, and more
   than the price at B and in the vault, buy one of that row.
   *Observable:* refused with **Not enough coin on hand or kept at this
   market.** No row changed anywhere. `spendableGp(A, {within: M})` is below
   the price and `spendableGp(A, {within: "all"})` above it.
3. As GM set **Paying with coin kept elsewhere** to its on-hand value and
   read `spendableGp(A)` beside `spendableGp(A, {within: M})`.
   *Observable:* the first counts what A carries and nothing else; the second
   still counts the coin M keeps. A purchase still draws on it. Restore the
   setting.
4. Sell one item with A's order receiving into the carried container, then
   one with it receiving into M.
   *Observable:* the proceeds join the container's row, then a row M keeps
   for A. M's own coin is down by the price each time.
5. Change coin three times: with the order receiving into the container, into
   M, and into B.
   *Observable:* the new coin lands in the container, then at M. With B
   named, which a market's reach leaves out, it is carried loose.

**A trader who is not there (the Judge's override).** Add to the fixtures a
scene S, created inactive and linked to M (`acksExtras.location.scenes
.linkScene(S, M)`), with no token of A's on it: `location.reach
.depositReach(A, M).reason` reads `notHere`. The Player seat needs a GM
client connected to answer its relay, so it is driven from the capture
driver's own browser (`connect({user: "Player"})`) while the pane holds the
GM seat. Wrap `ui.notifications.info` and `.warn` to read what each seat is
told.

6. Player seat: `performPurchase`, `performSell` of an item A carries, and
   `lib.money.exchangeCoins`.
   *Observable:* `{error: "notAtMarket", scene: S.name}` for the purchase and
   the sale, `{ok: false, reason: "notHere"}` for the changer, and one
   warning naming A, S and M. A's coin and the item are as they were, and no
   bargaining card was posted.
7. GM seat: buy through the Purchase dialog with A as the buyer, then
   `performSell`, then the changer with `judge: true` (what the Trade tab's
   button passes on a GM seat).
   *Observable:* each succeeds; an info line opens **Judge's override:** and
   states the refusal that was waived; the price is in M's own coin.
8. GM seat: give A a token on S (`A.getTokenDocument({x, y})`, then
   `S.createEmbeddedDocuments("Token", …)`), and repeat step 6.
   *Observable:* all three succeed and no override line is raised on either
   seat.

## Demand layers and the Demand Generator walk

**Fixtures** (all created with `api.create`, so `api.sweepTracked()` removes
exactly them):

- a location with a market (as above), opened on its Trade tab as the GM;
- three world `acks-extras.merchandise` Items with invented keys, each with
  `environment` values (a half in one column, a negative in another), one
  `racial` entry, and `random` bands (two on the common table, one on the
  precious table), plus one Judge-made good that no book prints;
- a world setting is not needed: `marketsDemandAgeHeaders` may be unset (the
  labels then read "Age band N"). Where a book is imported the labels read the
  book's own headers.

**Steps**

1. Open the Trade tab as GM and press Generate demand. Then repeat as a player
   seat owning a character.
   *Observable:* the GM sees the window titled with the location's name and one
   preview row per catalogue good, the Judge-made good included; the player
   sees no such button, and
   `acksExtras.markets.applyGenerated(location, {profile: {}, results: [{category, base: 1}]})`
   called from the player seat answers `{error: "gmOnly"}` with the location's
   `goods.demand` unchanged. (A GM seat cannot prove the refusal: run the call
   from the player seat.)
2. Tick an age band, two water columns, a biome and an elevation, then a race.
   *Observable:* each preview row's B and D change; a good with no environment
   data shows a dash under B; Base is A + B (fraction dropped toward zero,
   check a row whose B ends in a half) + C + D.
3. Press Roll Step A, then edit one cell by hand.
   *Observable:* every A cell holds an integer from -2 to 2; the edited cell
   survives the next re-render (tick another box).
4. Enter a land revenue that a row of the imported land-revenue table carries.
   *Observable:* the counts line names how many goods are raised and lowered.
   With `demand.landRevenueProse` not imported, the notice says so and Roll
   picks is disabled; add a pick by hand instead.
5. Press Roll picks.
   *Observable:* the listed picks equal the counts, each good once; a good
   rolled from the precious bands appears when a common roll misses.
6. Press Apply on a market with no base.
   *Observable:* no confirmation; `goods.demand` holds one row per good;
   `goods.dmProfile.rolls` and `landPicks` match the window; the window closes
   and the tab's chips show the values.
7. Reopen the window, change one A cell, press Apply.
   *Observable:* the window opens with the stored inputs, rolls and picks
   restored; Apply asks for confirmation naming the pinned overrides as
   untouched.
8. Set demand on a good: Pin a value that differs from its base.
   *Observable:* the chip reads pinned and shows the base it hides; a purchase
   preview of an item in that category prices at the pinned value; Unpin
   removes only the pin and the base value prices again; Clear removes the
   base row.
9. Pin a good, then Apply the generator again.
   *Observable:* the pin is still present and still wins.
10. A pick holds until its button reads it. In the generator, pick a good
    other than the first under the add-a-pick select, then tick a biome.
    *Observable:* the pick renders nothing; the tick redraws once and the
    good still shows; typing the change renders nothing; Add pick adds the
    picked good with the typed change and empties the change box. On the
    location's Trade tab, pick a category other than the first and Set demand
    a value. *Observable:* the pick writes and renders nothing; the value
    lands on the picked category, the sheet redraws, the pick still shows,
    and a second Set demand opens prefilled with that value. Solicit reads
    the same select.

**Drive mechanics**

- `acksExtras.markets.openDemandGenerator(location)` opens the window without
  the button.
- The window submits on change, so a cell edit re-renders; read the DOM after
  the render, and click a button only after a change has settled (a click that
  lands mid-render is lost).
- Read what was written with `location.system.market.goods.demand`,
  `.demandOverrides` and `.dmProfile`; `acksExtras.markets.rules.demand.trueDemand(goods, key)`
  is the reader every price goes through.

## Merchandise catalogue walk

The sub-type is declared in `module.json`, which the server reads at world
launch: **relaunch the world**, then confirm
`game.documentTypes.Item.includes("acks-extras.merchandise")` before anything
else; an unrelaunched world makes `Item.create` return falsy.

**Fixtures:** two world merchandise Items made with `api.create` (invented
key, `pricePerStoneGp`, six `dailyStones`, one `environment` column, one
`racial` entry). A book import writes to the compendium and the library
folder, so track what it made through the run's claim ids, never by name.

**Steps**

1. Open a created item.
   *Observable:* the merchandise sheet renders (not the system's detail
   partial error), scrolls when the window is short, and every field shows.
2. Edit the price, clear a nullable number, add and delete a racial row,
   rename a row and clear another row's race box. Add one more row, type
   `Prototype` into its race box and delete that row as well. Close.
   *Observable:* the stored `system` holds the price, `null` for the cleared
   field, and only the racial rows left on screen: a deleted row is gone, not
   zeroed, a renamed row's old key is gone, and a row with no race is
   dropped. The typed row is stored under the key `prototype` and its delete
   removes it, which a delete written as a dotted path does not
   (docs/lib/DECISIONS.md, "A key that is data is written nested"). No edit,
   add or delete logs a compatibility warning.
3. Run the Books dialog's merchandise re-import (or Getting Started's step).
   *Observable:* one item per printed good in the compendium's Merchandise
   shelf, each with prices, six stones, a random band and (after the demand
   append) environment values; the age-band headers appear in
   `game.settings.get("acks-extras", "marketsDemandAgeHeaders")`; an unreadable
   label raises one GM notification, never a silent skip.
4. `acksExtras.markets.merchandiseCatalog()` before and after creating a world
   item with the key of an imported good.
   *Observable:* the world item's values win for that key; deleting the world
   item returns the compendium's values on the next read (the cache is
   invalidated by the delete).
5. With the legacy `mercantile.merchandiseTypes` table imported, press
   Build merchandise items from imported tables in the Books dialog, twice.
   *Observable:* the first run creates world items only for keys no item
   answers; the second creates none. From a player seat the call answers the
   GM-only refusal (a GM seat cannot prove it).
6. Delete an imported item and re-run the import.
   *Observable:* it is rebuilt once, and a second run adds no duplicate.

## Setting-book market profiles walk (AX3)

Fixtures: the AX3 PDF open in the Books dialog, merchandise imported first
(step 1 above). Track every actor the step creates: its result lists no ids, so
read them back afterwards with `game.actors.filter((a) =>
/^ax3\.mkt\d+$/.test(a.getFlag("acks-extras", "cookbook")?.id ?? ""))` and
compendium equivalents, and `api.track` each one.

1. Run `acksExtras.importer.cookbookImportMarketProfiles()`.
   *Observable:* the summary counts 24 markets created; the class-conflict
   warning names two markets; the unmapped warning lists the goods with no
   ACKS II match. The book's city actor gains `system.market` and is not
   duplicated. **This city branch has not been walked live**: the test
   world's city actor belongs to another session, so the 9.2.0 walk removed
   `meta.place` from the entry in memory
   (`cookbookEntry("ax3.mkt5").entry.meta`) and let that row land as a
   `Market N` actor instead. Walk it on a world whose city is yours.
2. Open one record-backed market and one grid-only market.
   *Observable:* the first carries its printed heading as its name, printed
   class and families; the second is `Market N`. Both Trade tabs show base
   demand chips, and `goods.dmProfile.source` names the grid page.
3. On one market change the class by hand and pin one demand; on another Set
   one base demand by hand. Re-run the step.
   *Observable:* the hand-set class, the pin and the hand-edited base are all
   unchanged (a hand Set clears `dmProfile.source`, which makes that base the
   Judge's).
4. Add an unmapped good's printed header to a merchandise item's Aliases, clear
   one grid-only market's base demand, re-run.
   *Observable:* that market's base now includes the aliased good, and the
   unmapped list no longer names it.

## Setting-book market profiles walk (AX1: a sideways grid)

Walked by `tools/live/importer-ax1-markets.mjs`
(`node tools/live/run.mjs importer-ax1-markets`); its header lists the writes.

Fixtures: the AX1 PDF connected on the GM seat and no other book with a market
grid open (the step imports every open one), merchandise imported first, and
nothing standing under `ax1.mkt<n>`. A paired column joins its later book's
market where the library holds it, and a column that names a place lands on
the owner's place, so the walk steers both in memory, as the AX3 walk did its
city: the pair is dropped while the later market stands (unless
`MARKET_BIND_OK=1`), and the placed column is pointed at an id of the walk's
own. That column's place is kept, marked `markets/ax1-place-<column>`; steps 2
and 3 are its absence and its arrival, so the walk retires the last run's
before step 2 and builds it again in step 3.

1. Read the grid in the page.
   *Observable:* one row per column key, one cell per banded good, every cell
   a modifier, every column headed; the world's merchandise answers each
   market's goods.
2. Run `cookbookImportMarketProfiles()`.
   *Observable:* a market made for each column with no place, a pair the
   library holds joined, each placed column waiting and no actor made for it.
   Each made market is a library place stamped `kind.marketRecord`, named for
   its column's header with `printed` equal to that name, its base the
   column's and `dmProfile.source` the grid's page.
3. Build a world place carrying the placed column's id, run again.
   *Observable:* the column lands on it (base and source as in step 2), nothing
   is made under the column's own id, and the made markets count `updated` (a
   base from the same page is written again).
4. Move one good of a made market's base through `writeDemand` (the Trade
   tab's Set), run again.
   *Observable:* the source is cleared, the run counts that market `kept`, and
   its base is unchanged.
5. Open a made market's sheet on its Trade tab.
   *Observable:* one demand chip per stored good, each showing its modifier.

Not walkable without the later book: a later printing's base replacing an
earlier one's, and a later book's market taking an earlier column's over.
Both are pinned offline in `tools/importer/test-region-import.mjs`.

**Teardown:** the made markets are a library's, which carry no marker, and a
market standing under the book's id stops the next run's step 2, so the sweep
takes every market the run made and any folder or shelf the step opened, by
tracked id; the place stays. The in-memory steering is restored.

## Market reports and the Trader tab walk

The sub-type is declared in `module.json`, which the server reads at world
launch: **relaunch the world**, then confirm
`game.documentTypes.Item.includes("acks-extras.marketReport")`. Without it the
`ready` migration waits with a console warning and a report cannot be created.

**Check this first (undecided offline): can a PLAYER open an embedded item
sheet on the OBSERVER-owned house?** Make one report on the house (step 2), join
as the Player seat that owns the trader, and run
`await fromUuidSync(reportUuid).sheet.render(true)`. *Observable:* the report
sheet opens, the notes box is enabled, and Save notes lands the text on the
item through the GM relay (the GM seat must be online). If the sheet is refused
or the Open control does nothing, stop: the house's default ownership or the
Open control needs a decision before anything below means anything. The sheet is
a plain window (`tag: "div"`), so no submit path is involved; a refusal would
come from `isVisible` (LIMITED) or from a missing sheet registration.

**Fixtures** (kept by marker, Fixtures above): two `character` actors,
A owned by the Player seat and given a Bargaining ability item, B owned by the
same or another seat with no trader fact; two `acks-extras.location` actors
with a market (see [../location/TESTING.md](../location/TESTING.md)) with a base
demand written by `writeDemand`; a world merchandise Item for each good the
demand names (Merchandise walk). **The trade house is not a fixture you
create:** the engine makes it on the first report. Read the setting before the
run; if it was empty, the run made the house, so track it (`api.track(uuid,
"Actor")`) and clear the setting at teardown; if it named an actor, the house
belongs to another session and only the reports are yours. Mark every report
the run writes in such a house as it lands (`api.mark(item.uuid,
"markets/report-<n>")`), and retire the series at the next run's start — read
the id from the result of `writeReport`, or from `objectsOf(A.uuid)`
immediately after the step that wrote it, never by scanning the house. In a
house the run made, the reports go with it.

**Steps**

1. Player seat, character A: open the sheet.
   *Observable:* a Trade tab is present (Bargaining), with the empty-state hint.
   Character B's sheet, opened by the same seat, has none; the GM seat sees the
   tab on B, and its Trader chip toggles `flags["acks-extras"].markets.trader`,
   after which the player seat sees it on B too.
2. GM seat: `acksExtras.markets.tradeObjects.writeReport({ownerUuid: A.uuid,
   marketUuid: M1.uuid, marketName: M1.name, assessorUuid: A.uuid, partyId:
   "default", time: game.time.worldTime, outcome: "false", beliefs: [...]})`.
   *Observable:* the house exists (setting written, a location actor with
   `flags.acks-extras.storage.provider`, default ownership OBSERVER); the item
   is on it, stamped to A (`objectsOf(A.uuid).length === 1`); A's equipment tab
   does **not** list the house as a place.
3. Player seat, A's Trade tab.
   *Observable:* the report is listed under M1 with its date, the assessor and
   the outcome **Partial** (the stored outcome is `false`); the GM seat's
   copy of the same row says False. The believed modifiers match what was
   written, not the market's true demand. M1's location Trade tab, Reports held
   here, lists it for the player (party) and for the GM, and the belief chips
   read the report.
4. Assessment through the flow. As the Player seat post `performVentureAction(M1,
   {kind: "enter", actorUuid: A.uuid, cargoSt: 0})`, then advance world time a
   day on the GM seat; post `{kind: "assess", ...}` and advance another day.
   Needs the imported `assessmentProse` (and `impactProse`) tables; without them
   the day posts a "table not imported" card and this step is not reachable.
   *Observable:* a whispered assessment card, and (unless the result was
   *failed*, which writes none — repeat) exactly one new report stamped to A with
   `partyId` from `partyOf(A)`, `marketUuid` M1, the rolled outcome and the
   learned beliefs; `goods.dmKnowledge` stays empty. The card reads Partial when
   the roll was a false one. A partial or false roll writes no beliefs and
   `system.picks` between 1 and 6, and its card links the report (step 10). *Expertise* with no matching Art/Craft/Profession
   ranks also writes none. Drive mechanics: advancing the clock on the GM seat
   resolves the day by itself (the markets world-time watcher runs
   `processAllImports`), so a player's Process never sees a due assessment and
   the player-side hold is not observable while a GM is online; a day that
   crosses a month boundary ends the venture, and the next post answers
   `notEntered` until the party enters again. Retries advance the shared world
   clock a day each — say so in the report. A hand-written report's `outcome`
   must be one of `REPORT_OUTCOMES` (`rules/reports.mjs`); anything else is
   refused as `notWritten`.
5. Player seat, Research → Give to… on the step-2 report, choose B.
   *Observable:* the dialog lists only B (the party's other characters); on
   accept the report leaves A's list and B's tab gains it; `ownerOf(item).uuid`
   is B's; `system` is unchanged. A's tab still lists it, as a party report.
   Give and Discard follow the SEAT: when the same seat owns B they stay (it
   may manage B's reports); when B belongs to another seat they are gone and
   `performGive` from A's seat answers `notYours`. With one player seat, the
   `notYours` observable is reached through step 8's house-stamped reports.
6. Second market and Compare: write a report for M2 stamped to A, open the tab.
   *Observable:* Compare lists M1 and M2; picking both shows one row per good
   either believes with the difference where both do, a dash where one does not;
   a pick survives a re-render; changing the pick does not save the actor
   (no actor update fires).
7. Player seat, Discard on a report A owns; confirm.
   *Observable:* it is deleted from the house (`objectsAt(M1.uuid)` shrinks). A
   seat that does not own the stamp calling `performRetire` gets `notYours` and
   nothing is deleted.
8. Migration: on the GM seat set `M1.system.market.goods.dmKnowledge` to two rows
   for two parties, run `acksExtras.markets.tradeObjects.migrateDmKnowledge()`
   twice.
   *Observable:* the first run answers `{markets: 1, reports: 2}`, two
   `migrated` reports stamped `acks-extras:house` (a party's Research lists
   them, without Give/Discard for a player), the rows are cleared; the second
   answers zeros. A world reload runs it again at `ready` and changes nothing.
9. Delete the market M2 actor.
   *Observable:* its reports remain and are listed under the snapshot name
   they carry; nothing throws when the tab opens.
10. Choosing the goods. GM seat: `writeReport` a `partial` report for M1
    stamped to A with `beliefs: []` and `picks: 2`, and a `false` one with
    `picks: 1` (track both). Player seat: open the partial one from the Trade
    tab.
    *Observable:* a "Choose 2 good(s)" box lists every catalogue good. Tick
    three and press Learn these: a warning, nothing written. Tick two: the
    beliefs table shows them at M1's true modifiers, `system.picks` is 0 and
    the box is gone. On the false report, the chosen good's modifier differs
    from M1's by 1 to 3, and the player seat reads its outcome as Partial
    throughout. A seat that does not own A calling `performChoose` gets
    `notYours`, and nothing is written.

## The venture queue walk (assess on the influence page, withdraw, leave, history)

**Fixtures**: as the reports walk — character A (Player seat, Bargaining,
coin minted, a Diplomacy proficiency item helps), market M1 with the
`assessmentProse`, `impactProse` and `marketCharacteristics` tables imported
and a base demand written. Read `M1.system.market.marketLog.length` and
`goods.actions.length` before the run; every row this run adds is what the
observables below count. Reports the assessment writes are tracked as in the
reports walk.

**Steps**

1. Player seat, M1's Trade tab, acting as A: **Enter the market** with no
   vehicle ticked and other cargo 0.
   Advance a day on the GM seat. *Observable:* the status line reads In the
   market; the ledger row `ventureEntered` carries `actorUuid` A and `gp: 0`;
   the toll row (`ventureAction`) carries the toll negative.
2. Player seat: **Assess supply & demand**. *Observable:* the influence page
   opens against M1 (its name and image as the target), in the assessment
   mode: Charisma filled, the tone proficiency rows, the bribe select with a
   fee priced from one hit die. Pick a bribe tier and roll. Then, in order:
   the page posts nothing itself; a toast reports the day posted; the queue
   lists Assessing supply & demand with a withdraw button; the action row
   carries `natural`, `total` (the page's figures) and `bribeGp`; A's coin
   dropped by the fee; the ledger `ventureAction` row carries `-bribe`.
   Drive mechanics: the page's roll is scripted through its own controls —
   `select[name="mod.bribe"]` and `[name="mod.bribeFee"]` changed with a
   bubbling `change` event, then `[data-action="roll"]` clicked — never by
   firing the hook by hand, which proves the listener and not the page. The
   auto fee is 0 in a world without the imported wage ladder; type a figure
   over it (the Judge's own override path) so the debit is exercised. The
   page stays open after the roll, as every external page does; close it
   before the next step or the next click finds two.
3. Player seat: **Assess** again while the first waits. *Observable:* the
   page opens and rolls, and the day is refused with `duplicatePending`; no
   second row, no second fee.
4. Player seat: the queue's withdraw button on the assessment; confirm.
   *Observable:* the row's `status` is `cancelled`, A's coin is unchanged (the
   bribe stayed), the ledger has a `ventureCancelled` row stamped A, and the
   queue no longer lists the day. Repeat step 2 and let it resolve (advance a
   day): the report carries the page's outcome, the ledger `ventureAssessed`
   note reads Partial where the outcome was `false`.
5. Player seat: **Solicit** one good, then **Leave the market**; confirm.
   *Observable:* the status line reads Not in the market and Enter is back;
   `goods.ventures` still holds A's party row with `entered: false` and its
   `tollCp`; the queued solicit row is `cancelled`; `goods.solicitations` has
   no row for the party this month; the ledger `ventureLeft` row names the
   withdrawn action id. Enter again with a different other cargo: the row is
   overwritten, a second toll row lands.
6. Player seat: the Trade tab's **Trade history** on M1, then A's character
   sheet Trade tab. *Observable:* both list only rows stamped A, newest
   first, with the net in the summary equal to the sum of the gp column
   (negative); B's sheet, opened by the same seat, lists none of A's rows.
   The GM seat's copy of M1's history lists every stamped trader with a
   trader column.
7. Player seat that does not own A: M1's Trade tab shows no withdraw button
   on A's queued day, and `performVentureCancel(M1, {actionId})` from the
   console answers `notYours`; `performVentureLeave(M1, {actorUuid: A.uuid})`
   answers `notYours` too.

## The known-market walk (a mercantile network's class)

**Fixtures** (kept by marker, Fixtures above): character V (Player seat)
with the Mercantile Network power carrying its class step (the re-imported
power, or an Active Effect on the item with the change `flags.acks-extras.marketClass` and a
`condition` flag) and coin; character W in another party with no network;
market M2 of class III and M3 of class III with the availability tables and
the venture tables imported, neither holding a row of V's. Read the day
(`Math.floor(game.time.worldTime / 86400)` on a 24-hour calendar) at every
step and quote it.

1. Day D, Player seat, M2's Trade tab acting as V: buy one common item.
   *Observable:* the ledger row is stamped V;
   `acksExtras.markets.marketKnownTo(M2, V)` is false;
   `acksExtras.henchmen.effectiveMarketClass(M2, V)` is 3; the class line
   reads Class 3 and "mercantile network: not counted on this visit".
2. Same day: buy a second item. *Observable:* still class 3 — the visit's
   own rows never count.
3. GM seat: advance the clock past the next day boundary. *Observable:*
   known is true, `knownSource(M2, V)` is `"record"`; the class reads 2 for V
   and 3 for W; a rare row's `availabilityFor(M2, {itemName, costGp,
   trader: V})` is the class-2 cell.
4. Day D+1 at M3: **Enter the market**; advance a day. *Observable:* the
   party's venture row has `enteredTime` equal to the entry action's
   `postedTime`; equipment bought at M3 while entered reads class 3.
5. Leave, then Enter again; advance a day. *Observable:* the second toll
   equals the first; with the party entered again, `marketKnownTo(M3, V)` is
   true (the first entry was on an earlier day), and M3 purchases read class 2.
6. GM seat, a fresh trader with the network on day D: Known to this trader →
   On. *Observable:* known at once, `knownSource` `"judge"`. Off → back to the
   record's answer. On M2 for V (known by record) the switch reads Off and the
   verdict stays known; On then Off leaves it known.
7. Class I stays Class I: set M2's override to 1 and read
   `effectiveMarketClass(M2, V)` — 1.

**Teardown**: none of the fixtures; quote the driver's closing `kept` and
`reused` lines. The clock advances are the shared world's; say how many.

## The network walk (a known market on a venture)

**Fixtures** (kept by marker, Fixtures above): character V (Player seat, coin)
holding the re-imported Mercantile Network power (its `extras.effects` carry
the `marketClass` and `marketImpact` modifiers), or an ability item with an
Active Effect carrying both keys and a `condition` flag; market M3 of
class III and M4 overridden to class 1, both with `marketCharacteristics`,
`impactProse`, `priceShiftProse` and the merchandise imported. Pick two goods
from the merchandise items' `dailyStones`: X, whose next-larger-class column
beats one more impact, and Y the other way round. Quote the day at every step.

**Steps**

1. Day D, M3: **Enter the market**. *Observable:* the dialog's network block
   reads "Not counted on this visit for V"; after a day, the venture row holds
   `rawImpact`, `impactCap` and `networkMode` `auto`. Solicit X; after a day the
   ledger note names no network and the stones are the class-III column ×
   impact.
2. **Leave the market**, then Enter again on a later day with Auto. *Observable:*
   the dialog reads "Counted on this visit"; the toll equals step 1's.
   Solicit X, then Y, a day each: X's note ends `network: class`, Y's
   `network: impact`, and each card names the class and impact used.
3. Leave, and Enter on the next day with the mode **More market impact**.
   *Observable:* X's note ends `network: impact`, at the class-III column ×
   (impact + step), never past `impactCap`; the GM's party line names the mode.
4. M4 (class 1), known by the Judge's switch: solicit X with Auto. *Observable:*
   `network: impact` — the class option opens nothing in Class I.
5. A first entry with nothing but a number of stone too small for impact 1, in a
   known market, with the impact mode. *Observable:* the venture row's
   `effectiveClass` is the dropped class, and the solicitation trades at the
   market's own class with impact equal to the step.
6. Remove the `marketImpact` value (delete the AE's change, or use a power
   named Mercantile Network that carries no effects) and open Enter.
   *Observable:* the select offers no impact mode, and an item with no value
   at all is named as having none imported.

**Teardown**: none of the fixtures; quote the driver's closing `kept` and
`reused` lines. Count the clock advances.

## The fleet walk (a venture's vehicles, and the hold a load goes in)

**Fixtures** (all through `api.create`, tracked): a location L with a market
(its sheet's **Add market**, `[data-action="addMarket"]`, then a class
override); a character A owned by the Player seat, with coin as above and
`flags["acks-extras"].markets.trader: true`; a land vehicle W owned by the
Player seat with a cargo capacity, A attached to it as a passenger; a vehicle
V the Player seat does not own; a world merchandise Item with an invented
`system.key`, a `pricePerStoneGp` and six `dailyStones` (the Merchandise walk).
An actor fixture made by a page-side `Actor.create` that carries `system`
needs `items: []` ([../vehicles/TESTING.md](../vehicles/TESTING.md)).

**Drive mechanics**

- `marketsActingTrader` is a CLIENT setting: set it on the acting seat
  (`game.settings.set("acks-extras", "marketsActingTrader", A.uuid)`) before
  opening the Trade tab.
- The entry dialog is a `DialogV2` found among
  `foundry.applications.instances` by its `input[name="other"]`; each vehicle
  is an `input[name="vehicle"]` checkbox whose value is the vehicle's uuid;
  confirm with `button[data-action="ok"]`.
- Resolve a pending entry without moving the shared clock: on the GM seat,
  set that action's `resolveTime` to `game.time.worldTime` (write the whole
  `system.market.goods.actions` array back) and call
  `acksExtras.markets.processImports(L)`.
- Trading needs the month's price and solicitation rows. Write
  `goods.merchPrices` `[{category, monthStartTime, priceCp, detail: ""}]` and
  `goods.solicitations` `[{partyId, category, monthStartTime, stones}]`,
  taking `monthStartTime` and `partyId` from the resolved venture row
  (`partyId` is `"default"` unless A is in a markets party).
- The trade dialog is `acksExtras.markets.openVentureTradeDialog(L, A)`
  (`VentureTradeDialog`): `select[name="category"]`, `input[name="stones"]`,
  `select[name="direction"]`, and `select[name="hold"]`, whose `""` is the
  trader's own packs and any other value a vehicle's uuid.
- The actions post chat cards that speak as the run's own actors; track them
  by `speaker.actor` against the actor ids the run minted.

**Steps**

1. Player seat: `performVentureAction(L, {kind: "enter", actorUuid: A.uuid,
   cargoSt: 5, vehicleUuids: [W.uuid, V.uuid], resolutionId})`.
   *Observable:* `{error: "notYourVehicle"}`; nothing posts.
2. Player seat, L's Trade tab acting as A: **Enter the market**
   (`[data-action="ventureEnter"]`).
   *Observable:* the dialog lists W with its capacity, ticked because A rides
   it, and does not list V. Type other cargo 5 and confirm: the pending
   `enter` action carries `cargoSt` equal to W's capacity plus 5,
   `vehicleUuids` `[W]`, and a detail naming W and the toll.
3. GM seat: resolve the entry.
   *Observable:* a `goods.ventures` row with `entered: true` and
   `vehicleUuids` `[W]`; the Trade tab's venture line names W.
4. Player seat: open the trade dialog and buy 2 stone of the good into W.
   *Observable:* the hold select offers A's own packs and W with its free
   stone, W preselected; a merchandise stack of 2 lands in W's hold.
5. Player seat, through `performVentureTrade(L, {actorUuid, category, stones,
   direction, holdUuid, resolutionId})`: buy one stone more than W's free
   room; buy into V; sell 3 from W.
   *Observable:* `noRoom` with `remaining` equal to W's free room;
   `notInVenture`; `noLoads` with `remaining: 2`. Nothing is written by any
   of the three.
6. Sell the 2 from W, then buy 1 with `holdUuid: ""`.
   *Observable:* the sale answers `{ok: true}` and W's stack is gone; the
   packs purchase lands on A.

## The gate walk (toll, tariff, smuggled goods, sneaking in, the Ruler's Privilege)

Steps G0–G7 and P0–P5 of `tools/live/markets.mjs`, in the order below;
`STAGE=gate` stops the run after them.

**Fixtures** (kept by marker, Fixtures above): market G of class III with
`marketCharacteristics` imported (and `tariffProse` for G6–G7); three world
merchandise Items with invented keys and prices — one `tier: "precious"`, one
common, one common with `tariffExempt: true`; a land vehicle VH owned by the
Player seat with an invented cargo capacity, holding a common load, an exempt
load, and a common load stamped `flags["acks-extras"].storage.ownerUuid =
NP.uuid`; an `acks-extras.domain` actor D; and these characters:

- T, owned by the Player seat, a trader with coin: a precious load in its
  packs, a cup (an `item`, not a load, with
  `flags["acks-extras"].markets.category` set to the precious key, an
  invented cost and a quantity of 2), and a charm like it also flagged
  `markets.magic: true`;
- Q, owned by the Player seat, with coin and a load of a tier the class
  taxes;
- A, a member who is elsewhere, with a common load: its ownership set after
  creation to exactly `{default: 0, [second player]: 3, [Player]: 2}`;
- NP, created with `ownership: {default: 0}`.

T, Q and A are the party: a roster of the run's own appended to the world's
`marketParties`, and removed by its id at the end. G's ownership is set after
creation to exactly `{default: 0, [Player]: 3}`.

A load is an `item` with `system.quantity.value` stones, `system.cost`,
`weight6: 6` and
`flags["acks-extras"].markets = {merchandise: true, category: <key>}`.

**Drive mechanics**

- Work the expected figures out in the driver from the invented prices and
  the rates the page parses from the imported cell (`parseTariffPct`), never
  from a remembered page: the tariff in copper is stones × gp per stone ×
  percent, summed and rounded up once.
- Give the party a roster. Without one the implicit party is every player
  character in the world, and each one at G brings its packs' loads through
  the gate with the run's.
- Presence: G is on no map, so a member is at G where one of its explicit
  owners at OWNER owns G as well, G's `default` counting
  (`location/reach.mjs` `ownersShare`). A new actor can carry the world's
  default and its creator as an explicit owner: G read `default: 3`, and NP,
  created with `default: 0`, read as at G. Set G's and A's ownership exactly
  (`update({ownership}, {diff: false, recursive: false})`), then read every
  member's `coinReach(member, G)` on the Player seat before relying on it.
- A's owner is a second player where the world has one: role PLAYER or above
  and not a Judge, since core gives a banned (role NONE) user no permission
  on anything. The roster makes A a member either way.
- The Player seat owns G, T and VH, so its entries run on its own client
  (local-first dispatch): its cards are created there, and a handler on the
  gate's hook must be registered on that seat as well as the GM's. Find the
  smuggling card by its text with a time floor, and track only the ids the
  Player seat did not already capture.
- The goods block also lists the hold of every other vehicle the Player seat
  owns, hidden until ticked: read only the packs' rows and VH's. Mark a good
  through its own tick, taking the key (`holderUuid|itemId`,
  `gate.goodKey`) off the row: two loads in one hold can share a name.
- D holds G through `acksExtras.domains.hold(D, G)` on the GM seat; the ruler
  is `system.rulerUuid`.
- Wait until the Player seat holds T and its items before opening the Trade
  tab, and read the acting trader back. The picker lists only actors the
  client already holds; set to a uuid it lacks, it falls back to another
  character, and the walk then drives that one.
- Throw every die at its top face by setting `CONFIG.Dice.randomUniform` to a
  value near 0 around a GM-seat `performVentureAction`, and put it back.
- Resolve an entry without moving the clock as in the fleet walk.

**Steps**

- **G0.** Read every class's tariff cell. *Observable:* each parses as a
  precious and a common rate.
- **P0.** Player seat: read where each member stands. *Observable:* T and Q
  are members at G and owned; A is a member the seat sees, not at G; NP is
  no member.
- **P1.** Player seat, G's Trade tab acting as T: **Enter the market**.
  *Observable:* "Goods at the gate" has, among the packs' rows and VH's, five
  rows: T's load and Q's, shown; VH's common and exempt loads, hidden until
  VH is ticked; and the cup, which alone offers "Brought to sell". Every row
  offers "Smuggled", every tick carries an accessible name, and the sneak
  tick is there. Nothing of A's, NP's stamped load, or the charm.
- **G1.** In the same dialog: tick VH, untick it and type 5, then tick VH
  again. *Observable:* the "At the gate" block shows, in turn: no capacity
  and the two packs loads; VH's capacity and four load lines — the exempt
  one marked exempt, the stamped one and A's absent; 5 st and the two packs
  loads; then VH's figures again.
- **G2.** Confirm. *Observable:* the pending action's `tollCp` and `tariffCp`
  equal the driver's figures, `privilegeUuid` is empty and `sneaked` false;
  T's coin fell by their sum once and Q's did not move; the ledger row's note
  reads `toll …gp, tariff …gp paid`.
- **G3.** GM seat: resolve. *Observable:* the venture row holds both
  figures; the entered card reads "Paid at the gate: toll …gp, tariff …gp."
  Leave G.
- **P2.** Both seats: a handler on `acksExtras.marketGateQuote` that pushes
  `{label: "QA watch", cp: 500}` at G unless the party sneaks in. Player
  seat: Enter with VH, the cup brought to sell, Q's load and VH's 30 st
  marked smuggled. *Observable:* the block quotes VH's toll; tariff lines
  for T's load and the cup ("QA Cup … ×2 at …%") under T's name and VH's
  exempt load; "QA watch: 5gp"; and "Smuggled past the gate:" with Q's load
  and VH's 30 st and no rate; six lines in all, nothing of A's or NP's.
- **P3.** Confirm; remove the handlers; GM seat: resolve. *Observable:* the
  action charges the driver's toll and tariff, its detail names "QA watch
  5gp" and no throw; T paid all three and Q nothing; the ledger note reads
  `toll …gp, tariff …gp, QA watch 5gp paid)` and names each smuggled good
  with its holder ("… (1 st, Q)", "… (30 st, VH)"); one card reads "T
  smuggles into G: …. Resolving the attempt is the Judge's call (RR §VIII.5,
  Smuggling)." Leave G.
- **P4.** Player seat: Enter with VH and the sneak ticked. *Observable:* the
  block reads "No toll or tariff: the party sneaks in" over four smuggled
  load lines with no rate; the action charges 0 and 0 with `sneaked` true and
  T's coin is unchanged; the ledger note reads "(sneaked in, nothing paid)
  Smuggled: …"; one card reads "T's party sneaks into G, bringing …" with
  T's and Q's packs loads and VH's two, not NP's or A's; resolved, the
  entered card reads "Sneaked in: no toll or tariff paid." Leave G.
- **G4.** Set D's ruler to T, then Q, then A, then NP. *Observable:*
  `domainOf(G)` is D each time; the members entering are T and Q; the
  gate's privilege is D for T and Q and none for A and NP.
- **G5.** Ruler T; Player seat: Enter with VH. *Observable:* the block
  reads "No toll or tariff: Ruler's Privilege in D"; the action pays 0 and 0
  and records D's uuid; T's coin is unchanged; the ledger note reads
  "ruler's privilege, nothing paid"; the card reads "Ruler's Privilege: no
  toll or tariff paid." Leave G.
- **P5.** Ruler Q, then A; Player seat each time: open Enter with VH, read
  only. *Observable:* "Ruler's Privilege in D" with Q ruling, VH's toll with
  A ruling. Close the dialog; clear the ruler.
- **G6.** World setting `marketsRandomTariff` on (read it first). Where the
  world's Mercantile document predates `tariffProse`: the Enter block names
  the Randomized Tariff table, and a GM-seat entry refuses `printedMissing`
  naming it with nothing paid. Then read the table off the connected book
  through the shipped recipe (`locatePageNumber`, `pageItems`,
  `extractTable`) and register it as a priority-30 `mercantile` layer on
  BOTH seats — the player's dialog quotes on its own client — writing
  nothing to the world. Player seat: open Enter with VH. *Observable:* the
  block reads "thrown at the gate, …gp to …gp" at the span the dice give,
  and the four load lines carry no rate.
- **G7.** GM seat, every die at its top face: enter T with VH.
  *Observable:* the tariff is the top of the span, the toll is G2's, the
  detail records each throw (`… → N%`), and T paid their sum. Unregister the
  layers and put the setting back.

**Teardown**: D, VH, the characters, the goods and G stay for the next run,
and the cards are marked; the setting is restored, the roster removed by its
id and the hook handlers removed in the walk's `finally`.

## The parties walk (characters of one party entering separately)

Steps S0–S9 of `tools/live/markets.mjs`, in the order below; `STAGE=parties`
runs them alone.

**Fixtures** (kept by marker, Fixtures above): market M of class III with
`marketCharacteristics` and `impactProse` imported, its ownership set after
creation to exactly `{default: 0, [Player]: 3, [second player]: 3}`; two
world merchandise Items with invented keys, prices and daily stones, one
precious and one common; wagons WA and WB owned by the Player seat with
invented capacities, WB holding a common load and a common load stamped for
A (`storage.ownerUuid = A.uuid`); an `acks-extras.domain` actor D holding M
under A; and these characters:

- A and B, owned by the Player seat, with coin and a precious load each in
  their packs, A driving WA and B driving WB;
- C, owned by the second player alone (no permission for the Player seat);
- E, owned by the Player seat, joining the roster mid-walk.

A, B and C are the party: a roster of the run's own in `marketParties`,
re-written with E for S6b and back, removed by its id at the end. The world's
`marketsRandomTariff` is read, set off for the walk and put back.

**Drive mechanics**

- A character is aboard a vehicle by `flags["acks-extras"].attachedTo =
  {uuid, role, station}` on the character. Role `crew` (station `driver`)
  puts them aboard without weighing on the hold, so a purchase into it is not
  refused for room.
- Both players own M, so C stands at M by `ownersShare` though the Player
  seat cannot see C. The GM seat posts C's days: a Judge's act is carried past
  presence.
- Work the share out in the driver from the imported maximum
  (`impactLimits().impactCap`): rounded down, a third of it. Make the
  division bite by typing other capacity of the class's baseline × (share +
  2) into B's dialog: an undivided maximum would give B more impact than the
  share. A world whose share is 0 trades at Class VI, impact 1.
- Resolve entries and solicitations without moving the clock: set the named
  actions' `resolveTime` to now and run `processImports(M)` on the GM seat.
  First wait until the GM seat reads every named action. A day the Player
  seat posted reaches it over the socket, measured at over a second;
  the write replaces the whole list, so one read before the day arrived
  erases it, and the day then never resolves.
- Read the venture trade dialog through `new VentureTradeDialog({location,
  trader})._prepareContext({})`.
- The Enter dialog's mode radios fire `change`; a mode re-ticks the
  vehicles, so tick vehicles after choosing it.

**Steps**

- **S0.** Both seats: the roster's characters (`partyMembers`). *Observable:*
  three on each, the Player seat's including C.
- **S1.** Player seat, M's Trade tab acting as A: **Enter the market**, choose
  **Separately**, confirm. *Observable:* the dialog opens on "Entering", As
  the party chosen, a line "Entering separately: maximum market impact …
  each, for 3 characters." at the driver's share, WA and WB ticked and B's
  packs listed; Separately leaves WA alone ticked, hides B's packs and WB's
  hold, and the gate names A's privilege in D; the action has `entrantUuid`
  A, `entrants` 3, WA alone, D's privilege, nothing charged, and its detail
  begins "separately, one of 3".
- **S2.** As B: open Enter, read only. *Observable:* both radios disabled
  with Separately chosen, "Your party's characters are entering separately
  this month." with the same share line; WA disabled and marked "(already
  through the gate this month)", WB ticked. Then through the api: B as the
  party is refused `enteredSeparately`; B separately with WA is refused
  `vehicleEntered` naming WA.
- **S3.** As B: Enter with the other capacity typed, confirm; GM seat:
  resolve A's and B's entries. *Observable:* B's quote charges the toll on
  WB and the other capacity and the tariff on B's packs and both of WB's
  loads, the one stored for A included, with A's packs hidden and no
  privilege; B paid exactly that; two rows stand, each one of 3 with
  `impactCap` the share, B's at the share in class III; each entered card
  reads "… entered the market at M separately, one of 3"; the Judge's party
  block has a line naming each; A's status line reads "separately, one of 3".
- **S4.** Through the api, A, then B, then A again solicit the common good.
  *Observable:* A's and B's post, each with its entrant; A's second is
  refused `duplicatePending`. Resolved: one pool each, daily stones at its
  own row's class × its impact, and no party pool.
- **S5.** *Observable:* A's trade dialog offers A's pool alone with A's packs
  and WA, B's B's with WB; B buying into WA is refused `notInVenture`, into
  WB it lands from B's pool, and A's pool is untouched.
- **S6.** GM seat, as C: solicit, enter as the party, enter separately.
  *Observable:* `notEntered`, `enteredSeparately`, then an entry one of 3.
  Resolve it. Add E to the roster; as E, open Enter, read only, then enter
  separately through the api. *Observable:* the share line still says 3,
  and the entry is refused `separateFull`. Put the roster back.
- **S7.** *Observable:* `marketKnownTo(M, B)` is false.
- **S8.** As A: leave. *Observable:* A's row stands with `entered` false and
  A's pool is gone; B's row and pool stand; A entering as the party is
  refused `enteredSeparately`. B leaves, then C (GM seat); A enters as the
  party through the api and it is resolved. *Observable:* the entry has
  `entrantUuid` "" and `entrants` 0 under D's privilege; its row's
  `impactCap` is the full imported maximum; B's status line reads "This
  month: In the market" with no "separately".
- **S9.** GM seat: write the party's row back with `entrantUuid` and
  `entrants` deleted. *Observable:* it reads back `""` and 0, and B's trade
  dialog acts in it. The write goes through the client, which fills the
  schema's defaults on the way in: this proves the read, not a row a
  released version stored.

**Teardown**: D, the wagons, the characters, the goods and M stay for the
next run, and the cards are marked; the setting is restored and the roster
removed by its id, in the walk and again in its `finally`.

## The moorage walk (the stay's daily fee, settled on leaving and at the month's end)

Steps M0–M11 of `tools/live/markets.mjs`, in the order below;
`STAGE=moorage` runs them alone, and `STAGE=entries` runs the gate, parties
and moorage walks in order and stops, the full run's sequence through M11.

**The table.** Every entry that brings a vehicle reads `moorageRates`. A
world whose Mercantile document was imported before the table's recipe holds
none, and the walk does not re-import over the world's document. The rules
step reads the table off the connected book through the shipped recipe
(`TABLE_RECIPES.mercantile.tables.moorageRates`, `locatePageNumber`,
`pageItems`, `extractTable`). It registers the table as an in-memory layer
at priority 31 on both seats (`registerTable({id: "mercantile", tables:
{moorageRates}}, {priority: 31})`), and `restore` unregisters it. The
report says when the layer stood in for the import.

**Fixtures** (kept by marker, Fixtures above; every size, capacity, count
and daily figure invented, every rate the table's): market M of class III,
owned by the Player seat; vehicles owned by the Player seat:

- a wain (land, drawn by default);
- a litter (land, `carriage: "handCarried"`);
- a cog (sea, `shp {value: 40, max: 60}`);
- a hulk (sea, `shp` 0).

Characters:

- T, owned by the Player seat, driving the wain (`attachedTo` role `crew`,
  station `driver`) and flagged a trader, with coin;
- R, owned by the Player seat, drained of coin;
- Z, owned by the Judge alone, with coin.

A roster of the run's own holds T alone, removed by its id at the end.

**Drive mechanics**

- The Enter dialog's moorage block is `fieldset.acks-extras-markets-stay`:
  `select[name=stayAt]`, one `select[name=stabled][data-vehicle]` per land
  vehicle (its row `[data-stay-vehicle]` hidden while the vehicle is
  unticked), and `input[name=animal][data-unit]`. The selects fire `change`,
  the counts `input`; the quote is `[data-gate-quote]`, its lines the `li`s.
- Resolve an entry without moving the clock, as the parties walk does, then
  wait on the Player seat until it reads the action done before leaving
  from that seat. A seat that reads straight after another seat's write
  can read the old row or the old purse: after the Player seat leaves, the
  GM seat waits for T's purse to move. After **Leave the market** is
  pressed, wait for its notice, never a fixed time.
- Make a visit span days by moving the row's `enteredTime` back whole
  calendar days (seconds a day from `game.time.calendar.days`); the clock
  stays put.
- Reach the month's end by writing rows into the previous market month
  (`marketMonthStart(marketMonthStart() - 1)`), each with a payer and a daily
  fee, then run `processImports(M)` on the GM seat. Only the primary GM's
  seat settles them (`lib/util.mjs` `isPrimaryGM`); the step checks it is
  that seat. A clock still in its first market month has no earlier month,
  and M11 says so and is skipped.
- A Judge's handler is `Hooks.on("acksExtras.marketGateQuote", …)` on the
  seat that posts the entry, setting `quote.stay.cpPerDay` at M alone;
  remove it by its id.
- An entry that brings no vehicle and no animal reads no moorage rate, so
  it needs no table: that handler alone gives it a daily fee, and leaving
  pays it. It is the cheapest way to make one stay payment, such as one
  whose receipt (`spendGold`'s whisper to the Judge) is the thing checked.

**Steps**

- **M0.** *Observable:* `printed.stayRates()` gives ship, wagon,
  cartElephant, horse and camelDonkeyOx a rate both within and outside.
- **M1.** Player seat, M's Trade tab acting as T: **Enter the market**.
  *Observable:* the block opens at "berth" with both options and a caption;
  the wain reads wagon and shows, the litter reads not stabled and is
  hidden, no ship has a row; three animal counts at 0, each captioned; the
  quote charges the wain's day. Tick the wain, the litter and the cog, set
  the wain to cart, two horses and one camel, confirm. *Observable:* the
  quote's lines charge the cog pro rata on its maximum shp (or flat where
  the berth cell is flat), the wain at the cart row and each kind per head,
  with no line for the litter; the action records that day's fee, `stayAt`
  berth, and its detail "stay …gp a day"; the wain's flag reads cart, and
  neither the litter nor the cog carry one.
- **M2.** Resolve. *Observable:* the row is entered with the fee, T its
  payer, unsettled; the entered card's stay line and the Trade tab's status
  line give the fee.
- **M3.** Press **Leave the market** and confirm. *Observable:* the
  confirmation names T as the payer, the fee and "days charged: 1"; T's
  purse drops by one day's fee; the row is settled with one day; the ledger's
  `ventureLeft` row reads "stay of 1 day …gp paid" with that gp negative;
  the notice says the same.
- **M4.** Open Enter again. *Observable:* the wain reads cart.
- **M5.** Through the api: enter at anchor with the wain, the cog and one
  horse; resolve; move the arrival two days back; leave. *Observable:* the
  fee is every line's outside column; three days are charged and paid.
- **M6.** Enter with the wain; resolve; drain T; leave. *Observable:*
  `stayShort` with the sum and one day, the row still entered and
  unsettled. Give T coin and leave again. *Observable:* it pays.
- **M7.** Open Enter with the hulk alone, at berth and at anchor, without
  submitting. *Observable:* where the cell prices by size the quote names
  the hulk as having no structural hit points; where it is flat, the flat
  fee.
- **M8.** Sneak in with the wain. *Observable:* no toll or tariff, the stay
  quoted and recorded, and leaving pays one day.
- **M9.** Hook on the Player seat at 777cp; enter with the wain; hook off;
  resolve; leave. *Observable:* the quote's fee is 7.77gp a day while the
  wain's own line stands; the action records 777; leaving charges 7.77gp.
- **M10.** A second market under domain D ruled by T: enter with the wain.
  *Observable:* the quote reads "No moorage or stabling: Ruler's Privilege
  in …" with no daily fee; the action records 0; leaving takes nothing and
  the ledger row has no stay.
- **M11.** Write four previous-month rows on M: T paying (at the market),
  Z paying (away from it), R paying (no coin), and one with no stay keys.
  Sweep. *Observable:* each fee is charged from its arrival through the
  previous month's last day, both counted; T pays, Z's and R's rows are
  settled unpaid with cards naming what is owed and why ("is away from the
  market", "'s coin falls short"); the keyless row reads a fee of 0 and
  stays unsettled; three `ventureStay` ledger rows. Sweep again.
  *Observable:* nothing more is charged, logged or posted. The rows go
  through the client, which fills the schema's defaults: the keyless row
  proves the read, not a row a released version stored.

**Teardown**: the vehicles, the characters, D and both markets stay for the
next run, and the cards are marked; the roster is removed by its id, and
`restore` removes the hook and the table layer on each seat.

## The Range of Trade reader

Walked by hand. Nothing is written to the world: a world whose `demand`
document was imported before the table's recipe holds no `rangeOfTrade`, and
this walk reads the table off the connected book instead of re-importing over
the world's document, as the moorage walk does.

**Fixtures:** none. A GM or Assistant GM seat with the Judges Journal
connected (`acksExtras.importer.connectBookUrl("jj", <staged path>, {remember:
false, bridge: false})`). `acksExtras.importer` attaches a few seconds after
`ready`, so poll for it rather than reading it once.

1. Read the table through the shipped recipe
   (`TABLE_RECIPES.demand.tables.rangeOfTrade`, `locatePageNumber`,
   `pageItems`, `extractTable`, each imported from
   `/modules/acks-extras/scripts/importer/`).
   *Observable:* six rows, `marketClass` 6 down to 1, none `__missing`, each
   holding `road` and `water` text.
2. Register it as an in-memory layer on this seat:
   `acksExtras.lib.tables.registerTable({id: "demand", tables: {rangeOfTrade}},
   {priority: 31, source: "qa-range"})`.
   *Observable:* `acksExtras.markets.rangeOfTradeFor(c)` answers
   `{road, water}`, two positive numbers, for each class 1–6, and the figures
   match your own copy's page (compare there; never into a report).
   `rangeOfTradeFor(0)` and `rangeOfTradeFor(7)` answer `null`.
3. Unregister the layer (`unregisterTable("demand", {priority: 31})`).
   *Observable:* the reader answers what the world holds again: `null` for
   every class in a world imported before the recipe.

**Teardown:** the layer, if step 3 did not run; it never persists past a
reload.

## The manifest and load-removal API

**Fixtures:** a character holding a merchandise load stack (invented category
name and figures, tracked by id). Create by hand with `system.cost` and
`flags["acks-extras"].markets = {merchandise: true, category: "sampleGoods"}`.

1. Call `acksExtras.markets.manifestOf([actor])`.
   *Observable:* `{rows: [{holderUuid, holderName, itemId, category, label, stones, unitGp, valueGp, priced: "base"}], stones, valueGp}`.
   The row names the category and prices the load at `priced: "base"` (the
   item's own cost, since no market price exists for an invented category).
   `label` reads "Sample Goods" or the merchandise item's name if one exists.
2. Call `acksExtras.markets.removeLoads(actor, "sampleGoods", 3)`.
   *Observable:* `{ok: true, removed: [{name, type, quantity: 3, …}]}`.
   The returned snapshot carries the removed quantity and none of the load's
   `_id` — a snapshot for the ledger, never a document. Reload.
   *Observable:* the actor's load is gone or reduced by the exact quantity
   removed. Call remove again on the same quantity: `{ok: false, reason:
   "noLoads", held: <the remaining stones>}`.

**Teardown:** delete the character by id.

## Teardown

By hand, delete the location, the buyer and the merchandise fixtures by their
tracked ids (`api.sweepTracked()`), and any items the purchases created.
`tools/live/markets.mjs` sweeps none of its kept fixtures: it marks its cards
(Fixtures above), and quotes the driver's closing `kept` and `reused` lines;
a run after the first builds only its cards and reports. Sweep the
reports and, when this run made it, the trade house, by their tracked ids;
after deleting a house this run made, set `marketsTradeHouse` back to `""`. Confirm the
market log goes with the location. The fleet walk also tracks the stacks its
trades made, read back from W's and A's items, and its chat cards (above).
A market whose till took coin posts a card as it is deleted
([../henchmen/TESTING.md](../henchmen/TESTING.md), Teardown): track that card
from the delete and sweep again.
