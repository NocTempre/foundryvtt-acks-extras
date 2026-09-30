# Vehicles — how it works now

The `acks-extras.vehicle` Actor sub-type: carts, wagons, chariots, palanquins,
galleys and sailing ships as documents. Rulings are [DECISIONS.md](DECISIONS.md);
what is not built is [ROADMAP.md](ROADMAP.md).

## The document

One sub-type covers land and sea, distinguished by `system.kind`. The model
([vehicle-data.mjs](../../scripts/vehicles/vehicle-data.mjs)) holds what the
books print per vessel — capacity in stone, crew requirements, draft
requirement, the load/speed tiers, sea speeds, AC and structural hit points —
and nothing it can derive. What is ABOARD is never a number typed here: it is
the actor's own inventory and its attachments, weighed by the capacity
primitive, because a typed total and a real one disagree the moment anyone
loads anything.

Registration is unconditional at `init`. A sub-type whose model fails to
register leaves every vehicle in the world unreadable, which is worse than any
capability check could be guarding against.

A land vehicle also states HOW it is carried (`carriage`: pulled,
hand-carried, borne on a back — blank reads as pulled), because the
vehicle-combat rule discriminates on exactly that; the equipment feature's
mounted overlay reads it for the transporters' action-economy card.

## Who is aboard

One relationship, five roles, owned by [lib/attachment.mjs](../../scripts/lib/attachment.mjs):
a flag on the CARRIED actor naming its carrier, the STATION it works (a job
the carrier defines), and — for an animal in harness — the KIND it pulls as.
A rider on a horse, a passenger in a wagon, an ox in the traces, a rower at
the bench and a canoe lashed on as cargo are the same binding. Each role
states whether its weight counts against the hold (a passenger and lashed
cargo yes, a draft animal and a crew member no, per RR ch. 7) and whether the
carrier's speed replaces its own. Mounting is the same flag through the
`lib/mount.mjs` facade, so a mounted rider is aboard in every sense the
party's pace can ask — and chains resolve to their ROOT, so a rider whose
horse is harnessed to a wagon moves at the wagon's pace.

[occupants.mjs](../../scripts/vehicles/occupants.mjs) assembles the ONE
occupant list every consumer reads — the sheet, the buckets, boarding — and
answers the team's real pull (`draftPullOf`): the abstract team rows ("2
heavy horses", no documents) plus every attached animal. Rows that still
carry a uuid from the old drop scheme convert to attachments the next time an
owner opens the sheet.

## Stations

[stations.mjs](../../scripts/vehicles/stations.mjs) derives the seat-by-seat
view the sheet renders: which groups exist is a property of the vehicle (a
wagon is pulled and driven, a vessel is crewed), and every group states what
it requires, who fills it, and what a shortfall costs. One counting rule
everywhere: a typed count is the UNNAMED complement — "30 rowers", "2 heavy
horses", "4 passengers" — and named occupants ADD to it, so the abstract
statement and the real people coexist. Officer seats (captain, navigator) are
always offered on a vessel, and an empty one states its rules consequence
where the emptiness shows. Named crew reach the speed derivations through
`effectiveCrewRoles` — officers counting as sailors toward the complement,
per RR ch. 7. An unqualified body (no Seafaring at a motive bench, no
Driving at the reins) wears an unqualified badge; at a motive bench it is
also WEIGHED, at the rate the imported `voyages` document's `crew` table
carries (stations.mjs `unproficientHand`, read once per derivation by the
group's stated effective strength and by the speed alike). Unimported, every
body counts whole and the group says the hands are unweighed.
`effectiveCrewRoles` hands on both figures: `aboard`, what the benches are
worth to the speed, and `heads`, the bodies a repair gang or a berth counts.
Occupants render as compact CHIPS
(`templates/lib/station-chip.hbs`, shared with the formation window), never
as full follower cards: a bench of named rowers must stay one glance.

Weights are TRUE: a specific actor charges its specific mass — body, or
every body a stack stands for, plus what it actually carries — and the
vehicle's printed per-head rate prices only the UNNAMED complement. Crew
bodies never charge the hold; a non-motive role's gear does (the marines
rule, RR p. 316), and the hold names that share. Stacks (`acks-extras.group`)
count all their living bodies at every counter, weight, and bench.

Dropping an actor on the sheet ASKS what they are
([drop-dialog.mjs](../../scripts/vehicles/drop-dialog.mjs)): the options are
the same derived groups, each with its cost stated before anything is
written, and a drop on a specific seat skips the question. Qualification is
read from the seated actor's real abilities; the typed
`seafaringRank`/`driverProficient` remain the ABSTRACT crew's statement,
authoritative for the derivations, with what the named crew would justify
shown beside them with provenance.

## Buckets

[berths.mjs](../../scripts/vehicles/berths.mjs) derives which groups a given
vehicle has — a wagon is pulled and driven, a vessel is crewed — and who is in
each. Passengers and cargo share one pool on every vehicle: a wagon carries its
riders on its bed (RR ch. 4) and a vessel carries hers as cargo at the berth
rate (RR ch. 7). The rate is the vehicle's own `cargo.passengerStone` where one
is typed, else the imported berth; it prices only the UNNAMED heads (above). A
vehicle whose printed passenger/load pairs are not linear states them as speed
tiers like any other load, so a second passenger can cost speed as well as
room. A vessel's crew is not cargo, but hands short of her complement free
their berths for it (The sea, below).

**What "crew" means varies by vehicle** (RR ch. 4): a driver, a driver and
warriors, the passengers themselves, or a crew. `complementMeans()` answers
which, so a sheet does not label a howdah's passengers "Crew".

## The hold

[hold.mjs](../../scripts/vehicles/hold.mjs) is the ONE answer to "how full is
it": `holdFrom` over plain data, `holdOf` over the document. `capacity` is the
printed capacity plus the crew-trade credit; `used` is the vehicle's own
inventory (weighed by the capacity primitive), actor-shaped cargo, a
non-motive crew's gear and the passengers; `free` and `over` follow. The
sheet's bar, boarding's room check, the land speed tiers (the load a wagon
is priced on, which is also the pace a party in its train moves at — the
formation's `carrierSpeedFor`) and a market loading a purchase into the hold
all read it, so a load is refused at the same line the bar turns red.

## Deployed as a place

A vehicle set down — a wagon circled for camp, a ship moored at a quay — is a
PLACE ([deploy.mjs](../../scripts/vehicles/deploy.mjs)), built from what the
place layer already has rather than a new document:

- it becomes a **storage provider** (`lib/storage.mjs`), so characters keep and
  take back goods there from their Storage tabs, under whose they are;
- it is **filed under a parent place** (`lib/place.mjs` `setParent`) — by
  default where the party carrying it stands (the location under the party
  token, else the location the scene is linked to), or one chosen on the
  Place tab, or none;
- its **own linked token** stands beside the party token as its marker: a
  point of interest on the map (`location/here.mjs` `standsAsPlace`), walked
  to like any place's (`formation/poi.mjs` `travelToPlace`). A location under
  the party outranks a deployed vehicle beside it as where the party is.

`deployVehicle` writes one record, `flags.acks-extras.place.deployed =
{at, tokenUuid, madeProvider, priorParent}`, naming exactly what deploying
did; `strikeVehicle` reverses that and nothing else — it deletes the marker
only if deploying created it, restores the prior parent, and turns the
provider off only if deploying turned it on and nothing is stored aboard.
`lib/place.mjs` `isDeployed` reads the record. Creating or deleting a token
takes an Assistant seat, so a player's deploy goes through the GM relay
(`vehicleMarker`), which acts only for the vehicle's owner, as attested by
the socket, and strikes only the token the record names.

**Aboard is reach**, deployed or not: a character carried by a place —
directly, or through a chain such as a rider on a horse in the traces — is at
it wherever it is, map or none (`location/reach.mjs` `aboard`).

The Place tab deploys and strikes, chooses the parent, and lists the goods
kept aboard by owner; the formation's train row carries the same toggle
beside each vehicle the party brings.

## Freight in and out

Freight dragged OUT of a vehicle onto another actor's sheet is moved, not
copied (`dropActorSheetData` in [module.mjs](../../scripts/vehicles/module.mjs),
through `lib/storage.mjs` `handOver`, which requires the seat to own both
ends). A location target is left to its own drop, which stores the goods
under whose they are. The vehicle sheet's drop moves an item from another
actor the same way; one from the sidebar or a compendium is copied in.

## Market trade

A party enters a market with its vehicles, whose hold capacity counts toward
the cargo the toll and the market impact are figured on, and buys loads into
and sells them from a chosen hold. The venture side is
`docs/markets/MODEL.md` (Ventures); the vehicle side is only that the hold is
read through `holdOf`, and the Hold tab tags merchandise rows.

## The sheet

[vehicle-sheet.mjs](../../scripts/vehicles/vehicle-sheet.mjs): a pinned header
(portrait, editable name, status tags for deployed, sinking, over capacity and
short-handed, and a glance line of pace and hold) over five tabs — **Travel**
(speed, conditions, hull, seamanship), **Aboard** (stations, crew complement,
team), **Hold** (the bar and its parts, the passenger rate, riders, freight),
**Place** (deploy/strike, parent, goods kept aboard) and **Details** (kind,
carriage, SHP, AC, source, a vessel's printed speeds or a land vehicle's load
tiers, description). Each tab's part root is
its own scroller (`scrollable: [""]`), because fields submit on change and
the re-render must keep the reader's place. Every icon-only control, and the
station chip's name and unseat control, is a `<button>`, so the keyboard
reaches it and a screen reader names it.

## Speed

[vehicle-speed.mjs](../../scripts/vehicles/vehicle-speed.mjs) derives what a
vehicle actually makes: the printed load/speed tiers for land, wind and oar and
sail for sea, times the crew fraction (the WORST-manned motive role governs — a
galley with every sailor and half its rowers is a half-speed galley), times the
crew's condition, less a stowed mast, times terrain, road and sky. What the
ground, the wind and the weather are WORTH comes from the `travel`, `voyages`
and `weather` registered tables (declared via `expectTables`, imported from
the reader's own book); with nothing imported every such factor is ×1 and one
`tablesMissing` reason line says why the weather and the ground are not
counting. A land vehicle's tier is chosen by the hold's `used` (above).
Active weather conditions (the formation feature derives them —
`docs/formation/MODEL.md` §The weather) each multiply by their imported
factor, a road row's `ineffectiveIf` may name any of them (the legacy
raining/snowing flags feed the same vocabulary), and mud alone yields to
pavement. `canEnter` asks the footing too: wheels stop in snow anywhere and
in mud off pavement, and a carried vehicle (`carriage` hand- or back-borne)
is never asked — it goes where its bearers walk. The wind ladder carries the
land flags beside the sea ones: still air makes fog of rain, and the top two
bands impose the windy and stormy conditions. Driving and
Seafaring are read from the vehicle, and Seafaring at master-mariner rank
(RR ch. 3) alone can tack in a strong wind — at the imported tacking rate,
when there is one to show.

## The sea

Every printed sea figure reads from the imported `voyages` document — the
wind rows and tacking rate, the navigation targets and art bonuses, the
hazard throw and each hazard's dice and rates, the hull damage shares and
the sinking die, the repair gang and sea fraction, the rounding grains, and
the general berth. Unimported, each surface says what it cannot price
instead of guessing.

The sheet's **Seamanship** block ([sea-throws.mjs](../../scripts/vehicles/sea-throws.mjs))
rolls the day's two questions in the door-helper shape — the throw
decomposed into its parts and shown before anything is rolled, then one d20
whispered to the Judge. The navigation dialog prefills the arts from the
people actually aboard and the hazard dialog prefills the master mariner
from the best Seafaring at the helm; both stay overridable, because the
dialog is a helper and the Judge is the authority. A failed hazard throw
states the hazard's own imported effects on the card. A holed hull offers
**the sinking clock**: one roll of the imported die onto a flag, a
round-by-round tick, and the water closing over her at zero.

The hold trades with the crew ON ITS OWN: hands short of the complement
(named crew standing in for typed hands) leave their berths, and the hold
grows by the imported berth apiece — no switch to flip, because the room
physically exists whenever the hands do not; unpriced, the freed hands are
named and nothing grows. The UNNAMED non-motive complement charges its
gear too, at each role's typed per-head rate (`gearStone`, filled from the
Judge's own book), so an abstract contingent of marines is no longer
weightless freight beside the named ones' weighed inventories.

- **Damage** ([vessel-damage.mjs](../../scripts/vehicles/vessel-damage.mjs)):
  most attacks cannot hurt a hull at all — a man-sized or large creature does
  NOTHING, and the biggest things deal everything; those two ends are the
  rule's own shape and stay structural. The classes between (light and heavy
  artillery, spells with their footprint multiplier) are worth what the
  imported shares say.
- **Sinking**: at 0 or less she cannot move under her own power and goes
  down on the imported clock.
- **Speed loss**: damage costs her speed in proportion to the hull lost, and
  crew losses cost her in proportion to the hands missing — **not
  cumulative**. Whichever is worse governs, alone. Voyage and combat speeds
  round to the imported grains.
- **Repair**: structural hit points are never healed, only repaired — a
  gang of hands, one turn, one point, doing nothing else; only an imported
  fraction of what she took at sea can be put back before a dock.
- **The clock** ([voyage.mjs](../../scripts/vehicles/voyage.mjs)): a voyage
  speed is miles over a longer working day than a party's march, because
  crewing is unstrenuous (RR ch. 7). The two are only comparable per hour,
  which is what `compareToMarch()` is for. Under sail in open sea with a
  navigator and a full crew she may work around the clock: twice the distance
  in a day, at the same speed.
- **Navigation** ([navigation.mjs](../../scripts/vehicles/navigation.mjs)): a
  throw each day AND each night, at the imported target for her waters; one
  navigational art aboard helps, both together help more, priced as the
  imported pair. Separately, entering a hex holding a hazard asks the
  CAPTAIN's Seafaring (a master mariner reads the water better), helped by
  making half speed and by a shallow draft over sandbar or shoal. Kelp holds
  her without harm until she is cut out; rock, reef or wreck tears and lets
  her sail on; sandbar or shoal harms and strands, and a stranded crew
  lightens her at the imported rates or waits for the tide — damage halved
  if she was making half speed, the rule rewarding caution twice for one
  decision.

## Boarding

`boardForBestPace` loads everyone the vehicle would carry faster than their own
legs, slowest first, stopping when the hold is full and never boarding someone
who walks faster than the wagon rolls. `reboardAsBefore` restores the last
arrangement, so unloading at a ford and reloading beyond it is two clicks.

## Published

`acksExtras.vehicles` carries the sub-type id and every derivation above. It is
published because a domain module costing a caravan, or a battle module asking
how far a wagon train gets in a day, should not re-read the tables.
