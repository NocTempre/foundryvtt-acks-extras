# Locations & Settlements — Design Model

How this module applies the family doctrine **reuse → extend → enhance →
invent**. It is the location-domain **binding target** of the table
extraction program: the
home of the settlement actor and of the per-world imported rules tables that
sibling features (henchmen today; domains later) read through lib.

- **Reuse**: the core `acks` system's actor framework and money/inventory
  documents; the lib subsystem's tables registry and service contracts (`requires
  the lib subsystem` — the module's only family edge).
- **Extend**:
  - Actor sub-type `acks-extras.location` (TypeDataModel), registered here and
    only here: identity and nesting (name, region, notes, `parentUuid`), a
    reference roster, a stack count, and — on the places that have one — a
    nullable `market` subtree carrying demographics, market class, the
    Judge's rarity overrides, postings, candidates and slander.
  - **The market ledger** (`system.market.marketLog`) is shared by every
    feature that writes about a market, and each appends through
    `data/market-log.mjs` `appendMarketLog`, which keeps the latest
    `MARKET_LOG_CAP` rows. A row about one actor's own dealing carries their
    `actorUuid`.
  - **Storage at a place**: the lib subsystem owns the primitives (providers, stored
    goods, transfers, the deletion fallback); this module owns the experience
    — the location sheet, the character sheet's Storage tab, the retirement of
    the system's banked-coin column, the vault sweep, and the GM manager.
    A location holds goods only once a GM turns storage on: the create hook
    sets no storage flag, and an importer's world copy of a library place
    leaves the library's behind unless goods are stored on it. A GM turns it
    on with the Storage tab's **Hold goods here**, the manager's **Add a
    place**, or a drop on the location's sheet; the manager's new-place
    target and a vault are made holding goods. The manager lists every
    provider, and its Move to targets are the same list. `pruneEmptyLocations`
    spares a provider.
  - **Table schemas**: typed shapes for the people/economy documents
    (cultures & names, occupations, age tables, class registry +
    distribution grids, wages, availability, followers, slavery, monstrous
    recruitment, settlement scale). The schemas ship; the **values never
    do**.
  - World-imported table documents, registered into the lib tables registry at
    priority 20 (world) via the lib's `ruledata-import` contract; the
    importer's binding writes through that contract, never through this
    feature's name. Materialization mirrors rollable tables into RollTables on
    the ACKS library's RollTable shelf — reader-facing names, filed per
    ruledata doc under "ACKS Imported Tables", identity in a `tableKey` flag —
    and everything else into JSON journal pages named by raw key (the
    drop-override match) on its JournalEntry shelf; a shelf is opened by the
    first pass that needs it (`lib/library-target.mjs`), and a sidebar tree
    (the fallback when no shelf can be opened) is retired then and rebuilt on
    the shelf. The
    contract's `countMaterializedDocs`/`removeMaterializedDocs` remove the
    documents without touching the imported data.
  - Two generic projections, keyed by a descriptor table in
    `table-docs.mjs`, carry the `encounters` doc: a **column grid** (every
    column an ascending band list read with one die) is one RollTable per
    column, rolling the table's own die, read off its furthest band (a
    descriptor naming `fields` reads each band's fields as one result joined
    by " — ", and a drop splits it back at the first separators; the
    `treasure` value lists use it); a
    **list set** is one RollTable per non-empty list, a die of the list's
    length. A column or list dropped back (as a RollTable, or as JSON by
    drop or Edit) is merged into the table as it reads now, and the
    override stores that whole table, the other columns frozen as they
    read at the save. A **keyed** column (outcomes, rarities: words the
    engine branches on) reads back only a key the table already holds, in
    any casing, and refuses anything else. The override is what the engine
    reads, so an edited monster column changes what formation's encounter
    chain rolls.
  - Each browser row names the book and page its table was read from, under
    its label (`entryCite` → lib `citeOf`); a class's tables name the page
    their class item cites. A row an override or a sample supplies names none,
    and an absent row has none to name.
  - The browser's Edit shows a slice only where a saved slice merges back
    (an occupation category, a grid column, a list); any other sub-entry
    shows its whole table, because a saved slice would stand in for all
    of it.
  - A dropped RollTable's result reads as the words its sheet shows: the
    description with its markup stripped (Foundry's result form saves every
    edit as a paragraph), else the name of the document the result links.
- **Enhance**: the location sheet — contents, roster and nesting on every place,
  plus the market tabs (pools, demographics, postings, candidates, slander) on
  the places that have a market; a "which tables are present / missing, and from
  which book" panel with import pointers.
- **Invent**: nothing the system provides. No book values, no fallback
  sample tables (ruling 1): absent tables render as stubs + citations.

## A market's class

`system.marketClass` (1 to 6, 1 the largest) is the Judge's
`market.marketClassOverride`, else the imported settlement table's class for
`market.urbanFamilies` (RR 352, `settlement.marketClassByFamilies`, read by
`scripts/importer/table-recipes.mjs`). With neither, or with a count the table
holds no bracket for, it is `null`: the class is unknown and no figure stands
in for it. The 1 to 6 range is the count of the grid's class columns
(`clampMarketClass`, the override field's bounds), not a printed figure.
`hasMarket` is the market subtree's presence and is true for a market whose
class is unknown; the coin exchange (`exchangeTermsAt`) and the till read it,
not the class.

The location sheet's class badge is blank for an unknown class, its tooltip the
page reference (RR 352) alone, and the search fee beside it is not shown. What
each feature does without a class is in `docs/henchmen/MODEL.md` ("A market
whose class is not known") and `docs/markets/MODEL.md` ("A market whose class
is not known").

## Reaching a place

Depositing is gated on being able to reach the place; **retrieving is not** —
a player who cannot get their own goods back is a worse failure than one who
withdraws from a distance. A refusal returns its reason, because a control that
has quietly vanished reads as a broken module. The gate binds a player: a
Judge's deposit control stays on an out-of-reach place (its tooltip the
reason), and the deposit goes through with a warning that says what the
automation would have refused (`lib/storage.mjs` `stash`). A deposit a player
asked for and the Judge's seat replays is still the player's and is refused.

Being **carried by** a place comes before both halves: a character aboard a
vehicle — directly, or through a chain of carriers, such as a rider on a horse
in a wagon's traces — is at it wherever it is, on a map or on none
(`reach.mjs` `aboard`, reading `lib/attachment.mjs`'s carrier chain).

A place with a market is also reached from any of its **gates** (`atAGate`):
a character at a gate, by the same presence test the gate itself would pass,
is at the market the gate opens onto, whether or not that market has a map of
its own. It comes after being carried and before both halves, so a deposit,
a coin act and a market entry all answer to it (see "A place's role").

Places come in two shapes and the rule has two halves to match. A place with a
**linked scene** IS a map, and being on that map — not the *active* map — is
what reaches it. A place with **no linked scene** answers to a claim (your own
vault, a place one of your character's players owns, a place pinned to your
sheet, a place someone you march with has a player owning) or to standing at its
own token, because a market cart or a shrine can stand on a map without being
one. A Judge named as an owner is no one's player: Foundry stamps the creating
user on everything they make, so `ownersShare` skips an owner whose user is a
Judge (assistants included), reading the role of the user the map names and not
the seat. A pair a Judge made reaches by pin, by standing there, or by a
player's ownership (see [DECISIONS.md](DECISIONS.md), 2026-11-13).

Both halves ask the same question first — **where is this character actually
standing** — and `standingSpots` (`reach.mjs`) is the only reader of it. A
character riding inside a formation has no token of their own, because joining
deletes it, so the thing on the ground is the party token and it answers for
everyone it carries — and answers for them alone, so a token left behind on
some other map grants nothing. A deploy gives a body back: a member sent out as
an INDIVIDUAL stands at the token the deploy made for them, which is what tells
a live detachment from a leftover, while a cell deployed as a STACK keeps
answering through the party token because its bodies are built from the stack's
template actor and name that, not the cell. A formation with no party token
placed anywhere has no body to answer with, and its members fall back to their
own tokens rather than standing nowhere. A character no formation claims stands
wherever their own tokens do, on every map at once — and one token is one body,
so an unlinked copy reaches what it is beside and never what another copy of the
same sheet is. The geometry is `here.mjs`: a token's footprint padded by one grid
square, and a floor being the scene's own square distance.

`reachScan` is one pass over the world's tokens, built once per render by the
surfaces that ask about every place at once and handed to each call. The rulings
these follow, and what each cost, are in [DECISIONS.md](DECISIONS.md)
(2026-09-12).

## Which places a sheet LISTS

Reach decides whether a place will accept a deposit; it does not decide what a
sheet shows. Every place holding goods of this character's is listed, always. A
place holding nothing of theirs is listed on three narrow grounds, each about
this character alone (`listsWhenEmpty`): their own **vault**, which has to be
reachable before it holds anything; a place they **pinned**, which is what
pinning is for and is the list's manual control; and a place they are
**standing at** right now (`standingAt` — the presence half of reach without
the claim half). Ownership and a companion's ownership are deliberately not
grounds: they are world-wide, so a world that leaves its places open puts every
one of them on every sheet (see [DECISIONS.md](DECISIONS.md), 2026-09-20).

## The coin list on the system's sheet

`installStorageTab` writes two lines under the header of the coin list on the
system's inventory tab, on any actor's sheet that draws one: the lib's
coin-order block (`.acks-extras-coin-order-line`; docs/lib/MODEL.md,
"Currency"), offered every place the Storage tab lists, and for a character
with goods kept somewhere a summary of what is in storage and at how many
places, which opens the Storage tab.

The header is found by the count cell it carries (`coinHeader`): the list
header that holds a `.money__count`. A coin row listed inside a container
carries the same cell, in a section that comes first and has no header, so a
search for the first count cell on the tab finds that row and no header at
all. Both lines are injected after the sheet's render hooks have run, so the
block's controls are bound here (`bindCoinOrder`).

## Banked coin

The system's coin rows carry a second count, `system.quantitybank`. Nothing in
this module reads it as coin: the count a row has is its carried one
(docs/lib/MODEL.md, "Currency"), and coin that is kept safe is kept at a
place. So the field has no surface and no standing balance:

- **No sheet shows it.** `installStorageTab` removes the bank cells from every
  sheet the system draws, for any actor, and the banked field from the
  system's coin sheet. The module's own sheets never drew either.
- **A balance found in it is moved** by `runVaultSweep`
  ([vault-sweep.mjs](../../scripts/location/vault-sweep.mjs)), which a GM's
  client runs at every `ready`, the repair tool runs for chosen actors, and
  the shipped macro runs on demand. A character's balance goes into their
  vault (`vaultFor`, the one definition of a vault), stamped as theirs; the
  ledger of what is owed is written in the same update that zeroes the field
  and cleared once the coin has landed, so a client that dies between the two
  loses nothing and the next pass resumes from the ledger. Any other actor's
  balance, and an unlinked token's own, joins the carried count on the same
  row in one write. `planVaultSweep` answers what a run would move without
  moving it.
- **`payIntoVault(character, gp)`** lands coin from nowhere in a character's
  vault as theirs, making the vault if they keep none. The classes feature's
  will pays an estate through it.

## A place's role

A place may carry a **role** (`system.role`, one of `PLACE_ROLES`); the one
role is `gate`. A gate is a **point of entry** to the market it stands inside
(RR ch. 8, Entering the Market, step 3, RR 372): the nearest place above it,
by `parentUuid`, that has a market (`gate.mjs` `gateMarketOf`; the gate's own
market never counts). Three things follow:

- **The gate's sheet names its market.** On the Contents tab's identity line,
  beside the role, it links the market and offers **Enter the market**, which
  opens the market's sheet on its Ventures tab, where the markets feature
  charges the entry (`docs/markets/MODEL.md`, "The gate"). A viewer who cannot
  see the market's sheet reads its name alone; a gate with no market above it
  says so to the Judge.
- **Standing at a gate is standing at its market** ("Reaching a place"), so
  the entry the gate offers is never refused for the party standing there.
- **Nothing else changes.** A market with no gate is entered as before; a gate
  charges nothing of its own and has no hours.

`reachScan` files the world's gates by market once per sweep
(`gatesByMarket`); a single reach call without a scan files them itself.

## A place on the map

A place's own token is a **point of interest**: the shrine in the square, the
gate, the tavern the party is looking for. Nothing new is stored for one — it
is the location actor dropped on a scene the ordinary way — and three things
follow from its being an actor's token rather than a marker's.

**It is made to be a marker.** A location actor created without saying
otherwise gets a prototype token whose name shows on hover to anyone, with no
bars, a neutral disposition, no sight, and core's own house for a picture on
both the actor and the token (`preCreateActor`, `module.mjs`), each default
applied only where the creation data was silent. The same hook opens a new
place to the table, an ownership default of Owner, where the creation data
names no default and carries no importer stamp (`placeOpensToTable`, lib
`place.mjs`): a place made by hand is the table's, and one the importer
writes to the Actors tab keeps core's None ([DECISIONS](DECISIONS.md),
2026-11-25). `actorLink` is left alone on
purpose: `here.mjs` matches a place by the token's base actor id, which an
unlinked token carries too, so a Judge who drops one shrine on three maps has
one place on three maps.

**It is not a body.** Every reader that takes a token for somebody standing
there steps over a place's: the roster a linked scene derives
(`sceneOccupants`, lib `place.mjs`), token sync's vision and light writes
(`tokenSyncDelta`), the battlemap's size-by-creature scaling, and a
formation's **Add to party**. A shrine standing in the market square is not
the square's tenant and cannot join a marching order.

**It does not file its place.** A place's parent (`system.parentUuid`) is
where the Judge or the importer filed it, and moving its token never
re-parents it. The quarter a token stands in is asked of the Region under the
token, as `poi.mjs` `travelToPlace` prices a hop by `districtAt`.

**A deployed vehicle's token is one too.** `here.mjs` `standsAsPlace` takes a
location's token or a vehicle deployed as a place (`lib/place.mjs`
`isDeployed`; the deploy itself is `docs/vehicles/MODEL.md`, "Deployed as a
place"), so its marker is found, walked to and stood beside like a
location's, and `sceneOccupants` steps over it as it does a location's. When
the party stands at both, `placeUnderParty` names the location: the wagon
circled beside a town is where the goods are, the town is where the party is.
A ground pile's token is the exception: `standsAsPlace` leaves it out (see
"On the ground").

**It keeps its place alive.** `pruneEmptyLocations` spares an empty place that
has a token on any scene, hidden or not — a marker the Judge hid is a point of
interest not yet found. The world's tokens are walked once per sweep, not once
per place. So does a place staying behind keep the place it sits in, and that
place the one above it (`emptyOfPlaces`, lib `place-logic.mjs`): the level a
map's rooms sit in stays with them, and an empty place inside an empty one
goes with it in the same sweep. A dry run (`dryRun`) deletes nothing, whatever
the setting, and answers with the uuids a sweep would remove.

**A quarter's own place.** A scene Region can carry the same
`flags["acks-extras"].location` the scene carries, at the Region's grain, and
the place mirrors it in `system.regionUuid`. `locationOfRegion` /
`regionOfLocation` read the pair with the flag-wins repair the scene link has,
`linkRegion` / `unlinkRegion` / `createLocationForRegion` write it, and the
`updateRegion` / `deleteRegion` / `deleteScene` hooks keep the mirror true (all
`scene-link.mjs`). The surface is the District behaviour's sheet,
into which the formation feature injects a **Place** row that calls this
feature's api: pick a place, or make one named after the Region and nested
inside the scene's own place. A quarter's place is what answers "where is the
market" when the party stands on no point of interest at all; the ruling is
[DECISIONS.md](DECISIONS.md) 2026-09-16.

**A link needs every end it writes.** `linkScene`, `unlinkScene`, `linkRegion` and
`unlinkRegion` refuse unless the seat owns every document the call writes: the scene or
Region, the place, the place it named before (whose mirror a re-link clears) and the scene or
Region the place held before (whose flag a re-link lets go). A scene that is a part of its
place writes its flag alone and needs the scene alone. A refusal raises the warning
`ACKS-LOCATION.place.linkNotOwner`, writes nothing and answers `false`; a success answers
`true`. A Judge owns every document, so the test reads no role. The sheet's **Unlink map**
control is drawn when the place is editable and the scene it names is owned
(`canUnlinkScene`), a drop of a scene on the sheet calls `linkScene` and lets it decide, and
the Scene configuration's Place row is drawn for a scene's owner, lists the places the seat
owns plus the one already linked, and keeps its new-place button for a Judge. The ruling is
[DECISIONS.md](DECISIONS.md) 2026-11-25, "A link needs every end it writes".

## On the ground

A character can set a container they carry, and everything inside it, down on
the ground at the spot they stand
(`acksExtras.location.ground.setDown(actor, item)`, `ground.mjs`). What may be
set down is any container carried directly, a sack included (RR ch. 4, Sack,
Large); one inside another container goes with that container and is not set
down alone. The ruling is [DECISIONS.md](DECISIONS.md) 2026-11-18: the goods
are on the ground and at risk, which means only that the pile is reachable and
stays where it is; the module runs no loss or theft check.

**A pile is a location.** An `acks-extras.location` actor that is a storage
provider and carries `flags["acks-extras"].ground = {ownerUuid, ownerName,
containerName, building}`. `lib/place.mjs` `isGroundPile` reads the flag, on the
`isDeployed` precedent, and `ground.mjs` is its one writer (`pileData` is the
one definition of its shape). The goods move whole through lib storage's
`stash`, so they are kept at the pile as the character's and weigh nothing on
them: their Load drops, and the carried-weight readers, the loadout and item
loss read the character's own items and follow without being told. Coin inside
the pack becomes coin kept at a place, and a payment draws on it under the
coin-scope setting like any other place's; the pile's coin store takes no
arriving coin (`takesCoin: false` in `lib/money.mjs` `placeStores`), so a coin
order never lands it on the ground.

**Who makes it.** The Judge's seat. A Player lacks the rights to create an
actor or a token and to delete an actor, so `setDown` hands the request to the
Judge's seat (socket handler `locationGroundSetDown`; on a Judge's own seat it
runs where it stands). The handler authorizes on `requestUserId`, the user the
transport attests, never on the seat it runs on, which is always a Judge's. It
answers `{ok, reason?, pileUuid?, warn?}` and the seat that asked says it.
Refusals: `permission` (a Player who does not own the character), `token` (a
token's own actor, for every seat: the owner stamp on the goods would die with
the token), `notContainer`, `notOnMap` (a Player with no token on a map),
`noGm` (the transport's). A Judge with no token is warned and goes ahead with a
pile that has no token of its own; it is still listed and still picks up.

**Where it lies.** `standingSpots` (`reach.mjs`) is the one reader of where a
character stands; `pickSpot` takes the spot on the asking seat's scene, else the
only one. The pile gets a linked token centred on that spot at its elevation,
and `system.parentUuid` is the place linked to that scene, or empty.

**Reached by its token, never by ownership.** The pile's ownership is explicit
`{default: OBSERVER}`, overriding the location default of OWNER: every seat can
open and read it and nobody owns it. Owned, it would take deposits from anywhere
and from companions (`ownersShare`, `depositReach`); observed, it is reached by
its own token only. Picking up is not reach-gated: a retrieval takes rows
stamped to the claimant from wherever they stand (`docs/lib/API.md`, storage).

**Who may take.** Anyone standing at the pile (2026-11-19). A relayed
retrieval into a character the sender owns takes any row on a pile, whoever it
is stamped to, when `depositReach(character, pile)` says the character reaches
it, which with the pile observed and owned by none means its own token; a pin
never reaches a pile (`depositReach` skips it, and the Storage tab's
drop-to-pin refuses one with a warning), since a pin would let a character take
from it anywhere. A character away from the pile takes only rows stamped to
them. A row taken by
someone else leaves the stamp behind with the rest of the attribution, so a
container that lands on another character has its record cleared and is taken
off, since the worn mark rides the transfer (below), and the pile goes once it
holds nothing. The rule is in lib storage's relay
(`moveForSeat`), keyed on `isGroundPile`; no other provider's rule changes.
A character's own sheet lists a pile they stand at and takes through that
relay ([character-sheet MODEL](../character-sheet/MODEL.md), "A bystander's
row").

**Not a point of interest.** `standsAsPlace` leaves a pile out, so
`placesOnScene` does not offer it as a destination, `placeUnderParty` does not
name it, and a deployed wagon beside it is not filed under it. Reach to the pile
itself matches on the token's base actor id and is unaffected. Prune keeps a
pile (it is a provider); only the hook below removes one.

**Restoring the slot.** Before the move, the container is flagged
`flags["acks-extras"].setDown = {ownerUuid, worn, slot, fromId}`; the flag rides
through the transfer on the copy. A transfer mints new ids on both legs and
resets only `system.equipped`, so a worn mark in the gear flag arrives as it
left. When a container carrying the record is created on an actor (`createItem`,
`planArrival`): on its owner, the worn slot is restored (`wearAt`, or
`system.equipped` for an equippable item that names no slot), a coin order that
named `fromId` is pointed at the new id, and the record is cleared; on another
character the record is cleared and the container is taken off (`wearAt` with
no slot), so the worn mark that rode the transfer does not put it on them; at a
place nothing happens and the record stays. This covers Pick up, the system sheet's Storage tab and the location
sheet alike. A pack that lands nested in another container (a Judge deleting a
pile that still holds goods: `returnGoodsTo` nests it in a wrapper) reads as
stowed: it is taken off, the coin order is left, and the record is cleared.

**Removal.** A `deleteItem` hook deletes a pile once it holds no item and is not
`building`: tokens first, then the actor. `building` is set while the pile is
made and cleared once the transfer lands, so the transfer's own compensation
(which deletes what it created on the pile) never takes the pile, and a failed
set-down deletes the token and the pile exactly once itself. The sweep is delayed
per pile and reads the pile again before deleting, so a batch delete that fires
the hook once per item deletes once. A set-down whose two halves both fail
(`duplicated`) keeps the pile, since deleting it would hand its goods back a
third time. A `deleteActor` hook removes the tokens of a pile a Judge deletes.
All three hooks run on one window: the active Judge's lead window, as the
storage cleanup hook does; no Player seat ever writes or deletes a pile.

## Organisations here

A place's Contents tab lists the organisations at it — seated here, holding
this place, or controlling the quarter it is — for a GM or an owner, each an
open link with a small label. It is read through `acksExtras.factions` at
render time rather than by import, so a world without that feature renders no
section at all and this module keeps its one family edge; a holding its owner
marked hidden reaches a Judge only. What an organisation is, what seating and
holding mean and where the api comes from are the factions feature's
(`docs/factions/MODEL.md`, "Where a faction stands").

`placesOnScene(scene)` lists every visible place token on a map and is what the
settlement panel offers as destinations; the panel, the incident markers and
the walk between points are the formation feature's
(`docs/formation/MODEL.md` "Points of interest").
