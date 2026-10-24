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
`assessmentProse`, `priceShiftProse`, `negotiationProse`, JJ 202), and the
randomized tariff's dice (`mercantile.tariffProse`, RR 372). The
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

**A trader is at the market, or the Judge says so.** Each of those calls asks
`awayFromMarket` (`engine/trade.mjs`) first, before a bargaining roll, an
availability roll or any write: a player's trader who does not stand at the
market is refused with `notAtMarket` (the market is on a map) or
`noMarketAccess` (it is on none), and the refusal names the map. The Judge's
own act is not refused; it is paid with `judge` (docs/lib/MODEL.md, "The
Judge's own payment"). A sale and a load sold are paid before the goods
leave, and a payment the till refuses answers `payoutRefused` with the goods
where they were.

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
  resolve when their day passes — market entry (toll and tariff paid at the
  gate, below; impact from the cargo capacity the party brings
  over the baseline: the hold capacity of each vehicle it enters with, read
  through `vehicles/hold.mjs`, plus any other capacity it states),
  assessment (writes one market REPORT Item holding the assessor's
  demand-modifier beliefs; a partial or false outcome writes a report holding
  1d6 PICKS, capped at the catalogue, and no beliefs, and the trader chooses
  the goods; see "Market reports and the trade house"), soliciting (opens
  base stones × impact at the month's rolled price: 4d4−10 steps + demand
  + class shift; a mercantile network reads it larger, below), and
  merchandise trades with the optional spot-price
  negotiation. Merchandise loads are `item` documents, one unit per stone,
  bought into and sold from the hold a trade names — the trader's own packs,
  or one of the vehicles on the venture row (`vehicleUuids`). A purchase
  into a vehicle is refused past its free room before anything is rolled; a
  sale draws across the hold's stacks (`rules/arbitrage.mjs` `planLoadDraw`,
  all or nothing); a load kept aboard for another character is never counted
  or drawn. The seat must own the hold as well as the trader.
  A day that cannot resolve because its imported table is missing posts a
  card to the actor's owners and the GM naming the table.
  - **The gate** (`engine/gate.mjs` `entryQuote`, `settleTariff`; RR 372)
    assesses the book's fees and no others. They fall on what the party
    brings, never on its people, and the trader pays them, the stay at
    the visit's end (below).
    - **What is assessed** (`enteringLoads`). This covers every merchandise
      load in the packs of the members entering and in the entering
      vehicles' holds. The members entering (`enteringMembers`) are the
      trader and every other member of the party (`gateParty`: those the
      declaring user can see; the Judge sees all) who stands at the market
      (`coinReach`). A member elsewhere is not arriving with the party.
      `manifestOf` runs over the members entering: a load unstamped or
      stamped for one of them counts, and one kept for anybody else is
      passed over. It also covers every item those members bring to sell
      (`saleCandidates`: not a load, not magic, a merchandise type by
      `categoryOf`, a cost), at that type's tier on its cost × quantity.
      An item of no merchandise type is never offered or assessed. Each
      good goes by a key (`goodKey`: its holder's uuid and item id), which
      `forSale` and `smuggled` name.
    - **The charges.** The toll is the class's per-stone toll on the
      declared capacity. The tariff is each good's base cost (a load's
      catalogue price per stone, else its own cost, × stones; an item's
      cost × quantity) at its tier's rate (`tariffOn`), with a good marked
      `tariffExempt` charged nothing. The rates are the class's tariff cell
      (`parseTariffPct`: two percentages, precious first, or none); a cell
      that is neither refuses the entry naming the table. With
      `marketsRandomTariff` on and a taxable good assessed, each tier the
      class tariffs is thrown once at the gate on the imported dice
      instead, and an entry with no dice imported is refused naming that
      table. Where a member entering rules the domain the market lies in
      (`acksExtras.domains.domainOf`, read at call time), neither is
      charged, nor the stay below (the Ruler's Privilege).
    - **Moorage and stabling** (`rules/stay.mjs` `stayPerDay`; RR ch. 8,
      Engaging in Mercantile Ventures) is a daily fee on what the party
      keeps at the market: each sea vehicle as a ship of its size (maximum
      shp, else current), pro rata where its imported cell prices by shp;
      each land vehicle as a wagon, a cart or not stabled (`STABLED_AS`),
      its team inside its fee; and a head count per kind of animal brought
      besides the teams (`STAY_ANIMALS`, each keyed to the imported row its
      fee reads). One choice per entry says whether all of it waits
      berthed and stabled within or anchored and pastured outside
      (`STAY_AT`), and each line takes that column of `printed.stayRates()`,
      rounded up to a whole copper. A land vehicle starts at what its owner
      last chose at a gate (`flags.acks-extras.markets.stabledAs`, written
      after the entry is paid where the choice changed), else by its
      carriage (`defaultStabledAs`: drawn, a wagon; carried, not stabled).
      An entry bringing something the imported table cannot price is
      refused naming the table, and a ship priced by size with no shp
      `stayNoShp`; a party with nothing to stable never reads the table.
      The quote figures the day's fee (`quote.stay`) and the entry records
      it (`stayCpPerDay`, `stayAt`); nothing of it is paid at the gate.
      Sneaking in leaves it charged; the privilege waives it
      (`stayCpPerDayOf`).
    - **Settling a stay.** A visit is charged its days (`stayOwed`: the
      calendar day of arrival, the row's `enteredTime` taken from the
      entry's `postedTime`, through the day of
      departure, both counted) at the fee recorded. Leaving pays it from
      the leaving character's purse, refused whole on a short one
      (`stayShort`). At a month's end the primary GM's sweep
      (`settleEndedStays`, in `processVentureActions`) charges each visit
      of an earlier month still standing through that month's last day,
      from the character who entered (`payerUuid`). A payer away from the
      market (`coinReach`), short of coin or gone is not charged: a card
      tells the Judge and the payer's owners what is owed and why, and the
      row is settled either way, once. The row keeps `stayDays`,
      `stayPaidCp` and `staySettled`; entering again the same month starts
      a fresh stay on it. A row written before the stay was stored reads a
      fee of 0 and is never charged.
    - **Smuggling** is marked on goods, and resolving it is the Judge's.
      A good in `smuggled` is listed apart and never assessed. A party
      that sneaks in (`sneak`) pays neither toll nor tariff, and everything
      it brings is smuggled. Marking every good smuggled without sneaking
      in still pays the toll on the capacity. Either way a card tells the
      Judge and the trader's owners what came in (RR §VIII.5, Smuggling).
      Nothing is thrown and nothing is confiscated.
    - **The Judge's own rules.** `entryQuote` then calls
      `acksExtras.marketGateQuote` (`HOOKS.GATE_QUOTE`) with
      `(quote, {location, trader, separately})` on every seat that quotes. A handler
      may push `{label, cp}` onto `quote.extra`. The trader pays these with
      the book's, whatever the privilege or the sneaking. What a handler
      leaves in `quote.stay.cpPerDay` is the day's fee the entry records,
      unless the privilege waives it; the lines and the waiver stay the
      gate's. A handler answers the same on every seat, or preview and
      payment disagree. The gate's parts are on `acksExtras.markets.gate`,
      and the stay's rules on `acksExtras.markets.stay`.
    - **The payment** is ONE spend from the trader's purse as the day is
      posted (toll + tariff + `extraCpOf`), refused whole when the purse
      falls short. Which member funds it is the players' bookkeeping.
    - **What is shown and kept.** The Enter dialog lists the goods at the
      gate: each load (a hold's only while its vehicle is ticked) with a
      smuggled tick, each item that can be sold with a brought-to-sell and
      a smuggled tick, and one tick that sneaks the party in. Its moorage
      block asks where the party waits, how each ticked land vehicle is
      stabled, and a head count per kind of animal. Beneath it is the same
      quote, recomputed as the declaration changes: the toll, a line per
      good with its holder, rate and charge, the span a thrown tariff can
      come to, the privilege or the sneaking, the stay's day fee with a
      line per ship, vehicle and kind of animal, any hook charge, and what
      is smuggled. The quote is figured again on the seat that posts,
      which can read goods the previewing seat may not. The action stores
      `tollCp`, `tariffCp`, `privilegeUuid`, `sneaked`, `stayAt` and
      `stayCpPerDay`, and the venture row the totals. The ledger row
      itemizes the charges, lists what was smuggled and gives the stay's
      lines; the detail names any throws; the entered card says what was
      paid and the day's fee; and the Trade tab's status line gives the
      fee while the visit stands.
  - **Entering as the party or separately** (RR ch. 8, Entering the Market,
    step 2, Parties; `rules/arbitrage.mjs` `entryConflict`, `ventureKey`,
    `inVenture`). An entry's `mode` (`VENTURE_MODES`) is `party` or
    `separately`.
    - **A venture is keyed by `partyId` and `entrantUuid`**, `""` for the
      party entered as one. Venture rows, solicitation pools and venture days
      all carry both, and `inVenture` is the one test they are matched by. A
      character acts in a venture of their own while any of the party stands
      or waits entered separately this month, and in the party's otherwise
      (`ventureKey`; `ventureFor` reads the row). A character who has not
      entered beside them is in no venture.
    - **The count.** A separate entry counts the party's characters
      (`partyMembers`, with the trader). The month's first separate entry
      stores that count (`entrants`) on its action and its row, and every
      later entry reads it back, from a row standing or left, so a roster
      that changes mid-month changes nothing. Once that many stand or wait,
      another is refused (`separateFull`). A party of one enters as one.
    - **Refusals.** The party never stands entered both ways
      (`alreadyEntered`, `enteredAsParty`, `enteredSeparately`). A vehicle
      goes through a market's gate once a month, whoever declares it
      (`vehiclesEntered`, over standing rows and waiting entries;
      `vehicleEntered`).
    - **Impact.** A separate entrant's maximum is the imported maximum
      (`impactLimits().impactCap`) divided by the count, rounded down, in
      every class, the family-scaled Class I included (`marketImpact`
      `entrants`). The class drop holds that share, so a share of 0 trades
      down to Class VI at impact 1.
    - **The gate** (`gateHolders`). Entering separately, the packs and the
      items brought to sell are the entrant's own, and so is the Ruler's
      Privilege: the members entering are the entrant alone. The holds of the
      entrant's vehicles still bring in the loads stamped for any member
      arriving (`owners`), so nothing aboard passes unassessed.
    - **Every other day** posts in the trader's venture: soliciting fills
      that venture's pool, a trade draws on it into that venture's vehicles,
      and leaving ends that venture alone.
    - **The Enter dialog** offers a party of more than one the choice, with
      the maximum each separate entrant would get, and fixes it to Separately
      while any of the party stands or waits so. Each choice starts from its
      own vehicles: every one a member rides, drives or is harnessed to as
      the party, the trader's own separately. Separately, another member's
      packs leave the goods list and the network block is the trader's alone.
      A vehicle through the gate this month is marked and cannot be ticked.
      The Trade tab's status line marks a separate venture, and the Judge's
      party block has a line per venture naming its entrant.
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
    trader's same kind of day cannot wait twice, and a solicitation of one
    merchandise waits once per venture, whichever member posts it; a pending
    day may be withdrawn by the Judge or the trader's owner, its row kept as
    `cancelled`, nothing refunded.
  - **A mercantile network on a venture** (`engine/network.mjs`,
    `rules/arbitrage.mjs` `networkOptions` / `pickNetworkOption`): the entry
    stores the impact earned at the market's own class before any drop
    (`rawImpact`), the maximum (`impactCap`) and the mode the Enter dialog
    declared (`networkMode`: `auto`, `class`, `impact`). Each solicitation
    reads the SOLICITING trader's network, and only where that trader had
    been in the market before this visit (`marketKnownTo` at the day's
    posting time). The class option reads the good's daily stones
    `classStep` classes larger, never past Class I, at the impact the entry
    earned; the impact option trades at the market's own class with
    `impactStep` more impact from `rawImpact`, so a party with none trades at
    the step instead of dropping a class, and never past the maximum. Auto
    takes whichever opens more stones of that good, keeping the plain entry
    on a tie; a pinned mode takes its option where it exists. The toll and
    the month's price never move. The steps are the page's or the Judge's:
    `classStep` is henchmen's situational `marketClass` modifiers,
    `impactStep` this feature's `flags.acks-extras.marketImpact` (an Active
    Effect, or the typed effect the importer locates on the power), every one
    of which is the network's. A power held by name alone has neither, and
    the Enter dialog says its value is not imported. The ledger note and
    the card name the option used.
  - **A party may leave the market** (`leaveMarket`, `leaveVentureMarket`),
    in the venture the trader acts in: the month's row stays with `entered`
    false and the toll and tariff on record, the venture's solicitations for
    the month are dropped, its waiting enter/assess/solicit days are
    withdrawn, and its stay is settled (above). Entering again overwrites
    the row with a fresh declaration and pays the gate afresh.
- **Known markets** (`rules/known.mjs`, `engine/known-market.mjs`): a
  mercantile network's class shift is situational — it counts in a market the
  trader has been in before — and henchmen's `effectiveMarketClass` asks
  `marketKnownTo(location, actor)` through the api at call time to decide
  whether to count it. The current visit never counts itself: every sign is
  dated by the calendar day (`lib/world-time.mjs` `dayOfWorldTime`) and counts
  only when it falls before the day the visit began (`visitStartDay`). A party
  entered this month is on the visit its earliest standing entry opened (the
  venture row's `enteredTime`, the entry's `postedTime`): one row where it
  entered as one, a row per character where they entered separately. A party
  not entered is on a visit of one day. The signs: a ledger row stamped to the trader (a purchase, a
  sale, an import, a hiring search, a hire); a venture day the trader posted,
  or an entry their party posted; the party's venture row from an earlier
  month; or the Judge's list on the trader
  (`flags["acks-extras"].markets.knownMarkets`), which is undated and counts
  from the first day. The ledger keeps its latest rows only; venture days and
  rows are never pruned, so they are the durable half. `knownSource` says
  which answered (`judge`, `record`). The tab states the town's class, the
  acting trader's effective class beside it, "not counted on this visit"
  where the network does not count, and the Judge's Known to this trader
  switch, which flips the Judge's list and nothing else. A search day posted
  on a first visit (`postSearchDay`) and a henchmen posting are dealings in the
  market but are not gated by `awayFromMarket`, so they count as signs without
  proving the trader stood there.
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
  `marketsActingTrader`. With none remembered, the first candidate who is not
  a hireling acts; a hireling stays pickable but never becomes the default by
  sorting first. A player sees only their own party's imports,
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
(`{category, dm}`), `picks` (goods still to be chosen), `pricesSeen`
(reserved, nothing writes it) and `notes`.
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
- **Choosing the goods** (`chooseGoods`, GM-side; `performChoose` through the
  relay): the report's owner or the GM ticks up to `picks` goods on the sheet.
  `chooseVerdict` (pure) refuses none ticked, more than the picks left, or a
  good the catalogue lacks, and drops a good already believed at no cost. A
  partial report learns each chosen good's true modifier (`trueDemand`); a
  false one learns it moved 1d3 steps up or down (`wrongBelief`), so the two
  look alike on every surface. The picks left are written with the beliefs.
- **Assessment writes one report** when it learned anything or left picks,
  owner and assessor the acting character, `partyId` the party posted under,
  and the assess card links it when there are picks to spend. It stops
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
