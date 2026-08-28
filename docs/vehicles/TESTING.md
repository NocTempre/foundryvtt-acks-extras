# Vehicles — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

## Fixtures

- A disposable `acks-extras.vehicle` actor.
- Two or three disposable actors to serve as draft animals, crew and
  passengers.

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

## Steps

1. Create the vehicle and open it, then shrink the window to ~500px tall.
   *Observable:* `VehicleSheet`, showing Speed Now, the terrain row
   (grassland … snow, road, heavy rain) and the day's pace options — and the
   body SCROLLS (the window carries `acks-extras-scroll`; every fieldset down
   to the vessel block is reachable at any height).
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
   UP); an unqualified named hand shows the ½ badge and the group states its
   effective strength; an empty navigator seat states its consequence, a
   filled one stops.
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

## Teardown

Delete the vehicle and every actor used as team, crew or passenger. Confirm
`system.team` goes with the vehicle, and that deleting the vehicle clears the
`attachedTo` flag from everyone who was aboard (the primary-GM cleanup).
