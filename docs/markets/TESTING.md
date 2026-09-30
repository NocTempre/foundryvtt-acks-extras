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
    through the relay.

**Not reachable on a shared world with the GM seat online:** the "not sent"
relay warning (it needs no GM connected), a venture day refused for a missing
table (it needs the table un-imported), and the import cap under
`marketsEnforceCaps` off (a world setting other sessions read). Say so in the
report rather than toggling shared state.

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
2. Edit the price, clear a nullable number, add and delete a racial row, and
   close.
   *Observable:* the stored `system` holds the price, `null` for the cleared
   field, and only the racial rows left on screen (a deleted row is gone, not
   zeroed).
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

**Fixtures** (all through `api.create`, tracked): two `character` actors,
A owned by the Player seat and given a Bargaining ability item, B owned by the
same or another seat with no trader fact; two `acks-extras.location` actors
with a market (see [../location/TESTING.md](../location/TESTING.md)) with a base
demand written by `writeDemand`; a world merchandise Item for each good the
demand names (Merchandise walk). **The trade house is not a fixture you
create:** the engine makes it on the first report. Read the setting before the
run; if it was empty, the run made the house, so track it (`api.track(uuid,
"Actor")`) and clear the setting at teardown; if it named an actor, the house
belongs to another session and only the reports are yours. Track every report
the run writes as it lands (`api.track(item.uuid, "Item")`) — read the id from
the result of `writeReport`, or from `objectsOf(A.uuid)` immediately after
the step that wrote it, never by scanning the house.

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
   the roll was a false one. *Expertise* with no matching Art/Craft/Profession
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

**Fixtures**: character V (Player seat) with an ability item named
Mercantile Network and coin; market M2 of class III with the availability
tables imported, holding no row of V's.

1. Player seat, M2's Trade tab acting as V. *Observable:* the class line
   reads Class 3 with no shifted class, and says the network is not yet
   counted here; `acksExtras.markets.marketKnownTo(M2, V)` is false;
   `acksExtras.henchmen.effectiveMarketClass(M2, V)` is 3, and a catalog
   row's availability is banded at class 3 (compare `availabilityFor(M2,
   {itemName, costGp, trader: V})` with `trader: null`: same cell).
2. GM seat: Known to this trader → On. *Observable:* V's flag lists M2;
   the Player seat's tab now reads Class 3 · for V: Class 2;
   `effectiveMarketClass(M2, V)` is 2 and the same row's cell is the class-2
   one (a rare item pending at class 3 is available at class 2, or its cap
   is larger). Off again reverts.
3. Player seat: buy one common item (`purchase`). *Observable:* the ledger
   row is stamped V, and with the Judge's switch Off the market is still
   known — the stamp is the visit — so the class stays 2 for V and reads 3
   for a trader with no network.
4. Class I stays Class I: set M2's override to 1 and read
   `effectiveMarketClass(M2, V)` — 1.

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

## Teardown

Delete the location, the buyer and the merchandise fixtures by their tracked
ids (`api.sweepTracked()`), and any items the purchases created. Sweep the
reports and, when this run made it, the trade house, by their tracked ids;
after deleting a house this run made, set `marketsTradeHouse` back to `""`. Confirm the
market log goes with the location. The fleet walk also tracks the stacks its
trades made, read back from W's and A's items, and its chat cards (above).
