# Vehicles — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

## Fixtures

- A disposable `acks-extras.vehicle` actor.
- Two or three disposable actors to serve as draft animals, crew and
  passengers.

## Core drive mechanics (non-obvious, learned live)

- **A drop on the vehicle sheet joins the TEAM, not the crew** — on a land
  vehicle every actor dropped anywhere on the sheet lands in
  `system.team.animals`, defaulted to `heavyHorse` and `pulling: true`. So
  dropping a character to "board" them quietly makes them a draft horse.
  Assert `system.team` and `system.crew.roles` separately after any drop, and
  correct the kind on the row rather than assuming the drop chose it.
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

1. Create the vehicle and open it.
   *Observable:* `VehicleSheet`, showing Speed Now, the terrain row
   (grassland … snow, road, heavy rain) and the day's pace options.
2. Drop an animal on the sheet.
   *Observable:* it appears under `system.team.animals` with a kind, a count
   and `pulling: true` — and the Speed Now line stops reading zero.
3. Correct a mis-typed team row (a character dropped in as `heavyHorse`).
   *Observable:* the row's kind can be changed on the sheet, and the pull and
   speed recompute from the corrected kind.
4. Crew and passengers: assign a crew role and board a passenger.
   *Observable:* `system.crew.roles` gains the role; `crewFraction` reflects
   how far short of complement the vehicle is, and the speed penalty follows
   it.
5. Cargo: load past capacity.
   *Observable:* `cargoRemaining` goes negative-bound / the overload flag
   sets, and `landSpeed` reports `overloaded` rather than silently slowing.
6. Terrain and pace: pick each terrain and switch between dedicated travel and
   a forced march.
   *Observable:* the day's miles change per the movement-scales table, and an
   impassable terrain refuses through `canEnter` rather than returning a
   number.
7. Sea vehicle: change `system.kind` to `sea`, set a wind, and run a voyage
   day.
   *Observable:* the sea speeds and the wind factor drive the result;
   `canSailRoundTheClock` gates the longer day; `compareToMarch` states the
   vessel against a marching party.
8. Damage and repair: `damageToVessel` past the sinking threshold, then
   `repairPlan`.
   *Observable:* `isSinking` turns true at the stated share, and the repair
   plan names the time and cost before anything is spent.

## Teardown

Delete the vehicle and every actor used as team, crew or passenger. Confirm
`system.team` goes with the vehicle.
