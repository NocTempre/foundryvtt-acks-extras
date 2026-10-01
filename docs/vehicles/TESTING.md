# Vehicles — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

## Fixtures

- A disposable `acks-extras.vehicle` actor.
- Two or three disposable actors to serve as draft animals, crew and
  passengers.
- For the deploy walk (steps 13–16), all through `api.create`: a scene
  (`active: false`, square grid, default ownership OBSERVER); an
  `acks-extras.location` with a linked token on it (default OBSERVER); an
  `acks-extras.party` with a token beside the location's; a character owned
  by the Player seat, enrolled by an Actor drop on the party sheet; a land
  vehicle owned by the Player seat, with that character attached as a
  passenger; and a vessel the Player does NOT own, with a `rowers` crew role
  and an unproficient character to seat on it.

## Core drive mechanics (non-obvious, learned live)

- **An actor drop ASKS.** Dropping an actor anywhere general on the sheet
  opens the routing dialog (passenger / each crew station / team / cargo,
  costs stated); the old hold and team targets survive as the dialog's
  PRESELECTION. A drop on a specific station group (`[data-station]`)
  attaches directly with no dialog. Whatever the route, the result is an
  ATTACHMENT on the dropped actor (`attachedTo {uuid, role, station, kind}`)
  — never a `system.team.animals` row; the typed rows are only the abstract
  complement.
- **Old team rows convert themselves.** A row carrying a uuid (the pre-4.28
  drop scheme) becomes an attachment the first time an owner opens the sheet
  — except rows marked not-pulling, which stay rows on purpose. To test the
  conversion, write a uuid row by hand, re-open the sheet, and assert the row
  is gone and the flag exists.
- **Typed counts are the UNNAMED complement.** `crew.roles[].aboard`,
  `cargo.passengers` and the team rows all count people/animals nobody has
  put an actor to; named attachments ADD. The stations panel's stepper is the
  ONLY input for `aboard` (the crew table lost its Aboard column — asserting
  on that column is asserting on a removed control).
- **A land vehicle with no team has a speed of zero, and says why.**
  `landSpeed()` returns `{feetPerTurn: 0, reasons: [{key: "noTeam"}]}`. A zero
  speed is the correct answer to an unhitched wagon, not a failure — read the
  reasons.
- The vehicle's kind (`system.kind`) selects which half of the model applies:
  `land` uses the team and `draftPull`, `sea` uses `seaSpeeds`, the wind
  table and the voyage clock. Testing sea behaviour on a `land` fixture
  silently exercises nothing.
- The pure half — `landSpeed`, `seaSpeeds`, `voyageDay`, `hazardThrow`,
  `navigationThrow`, `damageToVessel`, `repairPlan`, the bucket packer — takes
  plain objects and is covered by `tools/test-vehicles.mjs`. Live testing is
  for the SHEET and the drops; do not re-assert the arithmetic here.
- **A page-side `Actor.create` of a fixture carrying `system` needs
  `items: []`**: the system's create override replaces `system` otherwise
  ([../monsters/TESTING.md](../monsters/TESTING.md), "`Actor.create` from a
  `toObject()` needs `items`"). The capture driver's `api.create` adds it on
  its own. Without it a vessel arrives `kind: "land"` with no capacity, and
  every sea step exercises nothing.
- **The sheet is five tabs**: `[data-action="tab"][data-group="primary"]`
  with `data-tab` travel, aboard, hold, place, details. Click the tab before
  querying its controls, so what you assert is what a user sees.
- **A sea crew group is `[data-station="role:<key>"]`**, not
  `[data-station="<key>"]`; the officers are `captain` and `navigator`. When
  a drop finds no target, list the `[data-station]` values first.
- **Party fixtures:** creating an `acks-extras.party` actor makes its
  formation, and a token of it on a scene is adopted — then SHRUNK and
  centred, so its edge falls between grid lines. Compute any expected marker
  position from the party token read back at deploy time, never from where
  you created it. A character joins by an Actor drop on the party sheet;
  `acksExtras.lib.attachment.attach(character, wagon, "passenger")` then puts
  the wagon in the party's train (`acksExtras.formation.formationCarrying`).
- **A player seat has no token rights** (`TOKEN_CREATE`/`TOKEN_DELETE` are
  Assistant by default), so its deploy and strike go through the
  `vehicleMarker` GM relay and need a live GM client. Join the Player seat
  first and confirm `game.users.activeGM` is null before seating the GM, so
  no stale GM client answers the relay. Track the marker from the record
  (`flags.acks-extras.place.deployed.tokenUuid`); a struck marker then
  sweeps as missing, which is expected.
- **Relay refusals** are driven from the Player seat's console:
  `socketlib.modules.get("acks-extras").executeAsGM("vehicleMarker", {op:
  "stand", vehicleUuid, sceneId, x, y})` for a vehicle the seat does not own
  answers `null` and stands nothing; `{op: "strike", vehicleUuid,
  tokenUuid}` naming a token the vehicle's record does not answers `false`.
- **A drag-out is a drop on the RECEIVING sheet**: `{type: "Item", uuid}`
  dispatched on its `.window-content`. The source row leaves about a second
  later, so poll until it is gone before asserting, and arm a `createItem`
  observer on the receiver to prove exactly one create (an observer, never a
  delete list — `.claude/rules/live-testing.md`).

## Steps

1. Create the vehicle and open it, then shrink the window to ~500px tall.
   *Observable:* `VehicleSheet`: a pinned header (the portrait,
   `[data-action="editImage"]`; the name field; the tags) over five tabs with
   localized labels. Travel shows Speed Now, the terrain row (grassland …
   snow, road, heavy rain) and the day's pace options. Each tab `section`
   scrolls on its own (`overflow-y: auto`) and the window carries
   `acks-extras-scroll`, so every fieldset is reachable at any height.
2. Drop an animal on the sheet at large, take the dialog's Team option, and
   type an abstract row beside it.
   *Observable:* the animal appears as a CHIP in the stations panel's team
   group with its guessed kind and pull; the abstract row keeps its count
   select in the team fieldset; the team's pull is the SUM of both halves and
   the Speed Now line stops reading zero. The dropped animal carries
   `flags.acks-extras.attachedTo` with `role: "draft"`;
   `system.team.animals` gains NO row for it.
3. Drop a character on the sheet at large.
   *Observable:* the dialog opens with Passenger recommended; choosing a crew
   station instead attaches with that `station`; cancelling attaches nothing.
   Unhitch/relieve via the chip's × control clears the flag and the numbers
   recompute.
4. Crew and passengers through the stations panel: add a crew role row (label
   + required), step its unnamed count, drop a named character on the row's
   group, and drop another on an officer seat.
   *Observable:* the group counter reads `unnamed + named / required`; the
   effective crew reaches `crewFraction` (a named rower speeds a short bench
   UP); an unqualified named hand shows the unqualified badge, named by its
   `aria-label`. With the `voyages` document's `crew` table present (imported,
   or the invented doc of step 11 registered) the group head states its
   effective strength ("Rowers 1 / 4 … effective"); without it the head
   carries the unweighed note and no lesser figure. An empty navigator seat
   states its consequence, a filled one stops. The chip's name and × are `<button>`s, and so is every
   icon-only control on the sheet (`.acks-extras-vehicle-icon`), each named
   and drawn as a bare glyph.
5. Cargo: load past capacity.
   *Observable:* `cargoRemaining` goes negative-bound / the overload flag
   sets, and `landSpeed` reports `overloaded` rather than silently slowing.
6. Terrain and pace: pick each terrain and switch between dedicated travel and
   a forced march — FIRST with no `travel`/`voyages` tables registered, THEN
   after registering one (console:
   `acksExtras.lib.tables.registerTable({id:"travel", tables:{…}}, {priority: 20})`
   with a couple of invented rows).
   *Observable:* without tables every ground and wind factor is ×1 and the
   reasons list carries the one `tablesMissing` line; with them the day's
   miles scale per the registered rows. An impassable terrain refuses through
   `canEnter` (structural — no table needed) rather than returning a number.
7. Sea vehicle: change `system.kind` to `sea`, set a wind, and run a voyage
   day.
   *Observable:* the sea speeds and the wind factor drive the result;
   `canSailRoundTheClock` gates the longer day; `compareToMarch` states the
   vessel against a marching party.
8. Damage and repair: `damageToVessel` past the sinking threshold, then
   `repairPlan`.
   *Observable:* `isSinking` turns true at the stated share, and the repair
   plan names the time and cost before anything is spent.

8b. True weights and stacks: board a light character (their real mass under
   the printed rate) and a group actor (`acks-extras.group`) of several
   bodies; put a second group at a non-motive crew row.
   *Observable:* the named passenger charges their true stone, not the rate;
   unnamed heads still charge the rate; the stack's chip reads ×N, its heads
   reach the station counter and `crewFraction`, and its mass is bodies ×
   body weight + carried; the non-motive stack's GEAR stone appears in the
   hold bar's marines'-gear share while its bodies charge nothing.
9. Mount and chain: `acksExtras.lib.mount.mountActor(rider, horse)`, then
   attach the horse to the wagon as draft.
   *Observable:* the rider's flag is a `rider` ATTACHMENT (no legacy
   mount/rider pair left behind); `acksExtras.lib.attachment.rootCarrierOf`
   on the rider answers the WAGON; a formation containing the rider moves at
   the wagon's pace. Attaching the wagon to its own canoe refuses with the
   circular warning.
10. Re-board after a ford (`reboardLast`).
    *Observable:* passengers are restored; the TEAM is untouched — putting an
    arrangement back never unharnesses the horses.
11. The sea's registry reads (added with the voyages migration). On a
    disposable VESSEL with `shp.max` set: damage her below zero with NO
    `voyages` tables registered, open the sheet.
    *Observable:* the hull block renders the UNPRICED sinking line (no
    formula, no "null"); part-damage her instead and the repair line reads
    the unpriced variant. Then register the invented `voyages` doc from
    `tools/test-vehicles.mjs`'s SAMPLE_VOYAGES and re-render: the sinking
    line carries the invented die, the repair line the invented gang and
    fraction. In page context, `navigationThrow`/`hazardThrow` return null
    targets with a `tablesMissing` part before registration and the
    invented figures after; `damageToVessel(20, "personal").dealt` is 0
    either way and `("lightArtillery").dealt` is null before, priced after.
12. Seamanship (added with the surfaces). On the sea fixture with the
    invented `voyages` doc registered:
    - a crew role short of its complement shows the trade line under the
      hold bar ("N hand(s) short — … free M st") and the hold's capacity
      grows by M; fill the role (or attach named crew) and the line goes.
    - type a `gearStone` on a NON-MOTIVE role with hands aboard: the hold's
      marine-gear share grows by aboard × rate; motive rows offer no input.
    - **Navigation throw** opens the dialog with the arts prefilled from an
      aboard actor holding a "Navigation" ability item; rolling whispers
      ONE Judge card listing each part, the effective target and the d20.
    - **Hazard throw** with an aboard master mariner (three "Seafaring"
      items) prefills the helm; force a failure (roll until) and the card
      states the chosen hazard's invented dice/holding line.
    - damage her to 0: the hull block offers **Start the clock**; starting
      posts the rolled rounds and shows the counter; **Round passes** ticks
      it down and the zero round posts the sinking line. Unregister the doc
      first instead and the button is absent (no die to roll).
    - player seat: the whispers reach the Judge only.
13. Details: open a vessel's Details tab, then a land vehicle's.
    *Observable:* the vessel shows the six printed speed inputs
    (`system.speeds.oarSprint` … `voyageSail`) and a typed one is stored; the
    land vehicle shows none.
14. Deploy and strike, GM seat. On the wagon's Place tab the site select
    (`select[data-place-parent]`) offers the location under the party first;
    press **Deploy** (`[data-action="deploy"]`).
    *Observable:* `flags.acks-extras.place.deployed` reads `{at, tokenUuid,
    madeProvider: true, priorParent: ""}`; the wagon is a storage provider,
    filed under the location; a LINKED token of it stands beside the party
    on a grid line, clear of the party token — on its left, rounded down,
    when the right would leave the scene; the header shows the deployed tag;
    `acksExtras.location.here.placeUnderParty(formation)` still answers the
    location (a location outranks a deployed vehicle); the party sheet's
    Train row shows the tag and a `<button data-action="trainDeploy">`.
    **Strike** (`[data-action="strike"]`): the marker is gone, storage is
    off, the parent is what it was.
15. The Player seat, through the relay: deploy from the Place tab.
    *Observable:* the GM client stands the marker and the wagon is filed
    under the location. `acksExtras.location.reach.depositReach(passenger,
    wagon).can` is true and the passenger's sheet lists the wagon;
    `acksExtras.lib.storage.stash(passenger, wagon, [{id}])` moves the item
    aboard, stamped to the passenger (`storageFlagOf(item).ownerUuid`), and
    the Place tab lists it under the passenger's name. Both relay refusals
    hold. **Strike**: the marker is removed, storage STAYS on (goods are
    aboard), the parent is restored. Deploy and strike again from the party
    sheet's Train row.
16. Drag-out: drag a freight row from the wagon onto the passenger's sheet.
    *Observable:* one row on the receiver with the whole count, none left on
    the wagon. Coin in and out of a hold is walked in docs/lib/TESTING.md,
    "Coin: one stack, moved and never copied", step 9.
    Then drag a freight row onto a disposable `acks-extras.faction`'s sheet
    and onto a disposable `acks-extras.group`'s.
    *Observable:* one warning each, naming the target and saying it carries
    no goods; the row is still on the wagon with its whole count and neither
    target holds an item. A drop is a real `DragEvent("drop")` on the target
    sheet's `.window-content`, carrying `{type: "Item", uuid}` as
    `text/plain`.
17. Taking the wagon to market — an entry that declares it and loads bought
    into its hold — is walked in [../markets/TESTING.md](../markets/TESTING.md),
    "The fleet walk".

## Teardown

Delete the vehicle and every actor used as team, crew or passenger. Confirm
`system.team` goes with the vehicle, and that deleting the vehicle clears the
`attachedTo` flag from everyone who was aboard (the primary-GM cleanup).

For the deploy walk, sweep by the run's ledger: the fixtures, every marker
read back from a deploy record, and every item a stash or drag-out made (read
from the action's result, or from the fixture's own items). Deleting the
party actor dissolves its formation on the primary GM client. Struck markers
and moved rows sweep as missing, which is expected; quote the sweep.
