# Formation — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server
and driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

## Fixtures

- A disposable scene with walls (traps need a wall to arm against).
- A disposable `acks-extras.party` Actor — creating it auto-creates its
  formation (createActor hook); placing its token adopts the token.
- Two or three disposable character actors as members.
- A trap Item of the flavor under test.

## Core drive mechanics (non-obvious, learned live)

- **View the scene before touching its walls.** Core's `Wall#_onUpdate`
  reaches for render flags that do not exist off-canvas —
  `await scene.view()` then wait ~4s, or every wall update throws.
- **Find the formation with `getFormations()`**, not
  `getFormationForActor(party)` — that searches MEMBERS, and a party actor is
  not a member of its own formation.
- **Members are added by DROPPING an Actor on the party sheet** — `addMember`
  is not on the api. Dispatch a real `DragEvent("drop")` with
  `dataTransfer.setData("text/plain", JSON.stringify({type:"Actor", uuid}))`
  on `party.sheet.element`.
- **Movement checks read `formation.clock.lastPosition` from the world
  setting**, not the token's actual previous position. Park the token with an
  ORDINARY move so the hook updates it; a halt (or mutating the clock in
  memory) leaves it stale and the next move looks like zero distance and
  springs nothing.
- Selecting a wall headless: `canvas.walls.activate()`, wait ~600ms, then
  `canvas.walls.get(id).control({releaseOthers:true})`.
- Foundry parses **nested dice counts**: `(1d4)d6` rolls the d4 first, then
  that many d6 — the correct encoding of "1d4 spikes at 1d6 each"
  (`1d4 * 1d6` is a different distribution).

## Steps

1. Build the fixtures above; confirm the formation exists via
   `getFormations()` and lists the dropped members.
   *Observable:* formation roster shows every member; party token on canvas.
2. Marching order: open the formation view, reorder members.
   *Observable:* the order persists after closing and reopening the sheet
   (re-read the document, not the DOM).
3. Party rolls: trigger a party roll (surprise or reaction).
   *Observable:* one chat card with a row per member, each row's modifier
   matching that member's sheet.
4. Trap arm + spring: place the trap on a wall, move the party token past it
   with an ordinary move.
   *Observable:* the trap fires (chat card, damage roll of the declared
   dice); `formation.clock.lastPosition` advanced.
5. Trap non-fire: move a second time along a path that does not cross it.
   *Observable:* no card; position still advances.

## Teardown

Delete the scene, the party actor (its formation goes with it), the member
actors, and the trap item. Confirm `getFormations()` no longer lists the
formation.
