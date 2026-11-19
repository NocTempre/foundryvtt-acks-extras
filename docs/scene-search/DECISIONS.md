# Scene search — decisions

Dated: what was ruled, what was rejected, what it cost. The owner's words that
govern the feature are in `wip/20261118-scene-search-plan.md`.

## 2026-11-18 — A session keeps what a place's list must not: lot keys, bodies' state

Every dealt lot's key is kept in the session's `lots` (`{key, thing, layer,
cardId}`, `thing` being the entry's KEY: `thing:<id>`, `body:<id>`), and
`overlayLots` adds the keys to each entry's layer when the entries are read.
Rejected: writing the keys into the place's `yields.lots` (`attachLots`), which
makes a runtime fact of one search part of what the Judge authored and leaves
a body's keys with no thing to land on (`missing`). A body has no thing either,
so its `state` rides in the session's `bodies`; the cost is that a Reset of the
place does not clear a body, and ending the session discards both.
Doors and old-style traps have no home for state at all and are not entries
yet (`session.mjs` `derivedInputs`).

## 2026-11-18 — Assignment is a plan entry, and the party's `plan` relay carries a player's

`assign` is `lockPlan` for a Judge and the party's existing `plan` request for a
player, checked first on the player's own client with `planRefusal`. The
registry's activity key says which layer rolls and the option id is the entry's
key. `open` and `end` have no relay that fits (the `plan` relay carries a plan
entry and nothing else), so a player's call is refused with `scene:notAllowed`;
the Dungeon tab's Search here (S5) brings its own declaration.
A player's `ok: true` means declared, since the relay answers a plan request
nothing; a character the seat does not own is refused on the seat itself.
Known edge: the relay's registrant calls carry no user, so a hand-made `plan`
request from a player could name an entry the Judge has not shown. The
projection hides hidden entries from every screen and from `options`, but the
relay does not re-check; closing it means passing the requesting user in the
lock's `ctx`.

## 2026-11-18 — The Round press is one seam, `resolveSceneRound` — SUPERSEDED IN PART 2026-11-19

Close-out's `resolvePlanRound` owns the press once `turn-plan.mjs` exports it,
and `resolveSceneRound` calls it and nothing else. Until then it takes this
session's unresolved round-length entries out of the stored plan, then resolves
them through the activities' own `resolve`. Taking them out first is the point:
left in, the next Turn counts them down and rolls them a second time.
Rejected: importing `resolvePlanRound` by name, which is a load-time error
until it exists.

## 2026-11-18 — Writes come from the pressing Judge's client

The brief asked for a frequent `state` write to come from the active GM's
client. `executeAsGM` runs locally on any GM seat and turn-plan's own writes
are the pressing GM's, so a gate on the active GM would drop a second Judge's
Round press without a word. Rejected; the write is `updateThingOn`'s, from
whichever GM client pressed.

## 2026-11-18 — Which Region a drop makes a place of

A drop on the map goes to the place whose area holds the point, closest area
first (Region, then token footprint, then map), and otherwise to the smallest
Region over it that has no behaviors, which is made a place first. A Region
with a behavior is a zone, a terrain or a district, another feature's area, and
is not made a place by a drop. A trap is the wall assignment's first (`installTrapDrop`)
and falls to the place only where no wall is near; the Region row's own map
hook takes obstacles and conditions and never a trap.

## 2026-11-18 — An unimported reach never refuses

Built to the model (`scene-logic.mjs`): a thing with a point is out of reach
only when the reach is imported and the scene has a scale and the party token
is on the scene; otherwise reach is the Judge's call. The brief's "with nothing
imported, nothing is in reach by distance" reads the other way, as a refusal
that would block every point-bearing thing in a world with no import. Open for
the owner. The gate would go in `activities.mjs` `blockedOf` and
`resolveSceneCheck`.

## 2026-11-19 — The screen: what S4 built to the boards, and where it stopped

Built to the approved boards (SceneJudge, ScenePlayer, SceneCards): the header,
the bar, the cards with their two rails, the party, the log and the haul tray,
for both seats. Left to later slices: the Judge's keying aside (S6), harvest
rows (S7b), fight bodies' pictures (S5), and doors and traps read off the map
(R-DC1). Four readings the boards do not settle:

- **A player's Round and Spend a turn ask the Judge.** The board says a player's
  press "asks the Judge (the turn plan's relay)", and the party's relay had no
  kind for it; a kind that moved the clock would let any player advance it. The
  owner chose "Notify the Judge": the relay's new `askPress` request announces
  the ask and moves no clock and resolves no plan; only the Judge's own press
  does either. Rejected: drawing both buttons disabled on a player's seat.
- **`shown` gates the screen, not the read.** A player's screen has nothing to
  show until the Judge shows the scene; `read` and the Dungeon tab's plan select
  still answer a player at an open session, so a seat that calls the api reads
  what the projection lets through. Gating `read` would also empty the Dungeon
  tab's options for a seat. Open for the owner.
- **The "something more" line shows once a check was made at the entry**, as the
  boards draw it (a Seen card carries no mark, a checked one does), though the
  projection holds the mark from the start. The line is the Judge's own hint
  where one was written, else the generic words, else the vague words where the
  latest answer there was the vague one.
- **The bar's cap reads "After the battle" for a search a fight's record opened,
  and "Searching here" otherwise.** The boards draw only the first. The second is
  the one word needed for a search with no fight.

A lock a player's hand-made `plan` request makes at a hidden entry is held back
at resolution, not at the lock: the relay runs `lockPlan` on a Judge's client with
no word of who asked, and `turn-plan.mjs` is the dungeon close-out's. The check
reads the plan entry's `by` (`planBy` seam, `activities.mjs`
`namedBeyondSight`; both presses keep the entry in the plan while it resolves)
and refuses an entry that
user cannot see. The lock itself
still lands in the plan, so a hidden key a player guesses is stored until the
Judge's next press; closing that needs the registrant calls to carry the asking
user (R-DC3). Likewise the Dungeon tab's select labels each entry by the
activity alone (`optionLabel` ignores an option's `label`), so while a session is
open it lists identical lines; the scene's options carry `label`, which that
function can read once R-DC3 lands.

## 2026-11-19 — The Round press spends a round, and the scene's own resolution goes

New evidence since the 2026-11-18 seam entry: close-out's `resolvePlanRound`
landed (R-DC6), and it spends no clock time by design: the Dungeon tab's Round
press spends one round (`advanceRounds`) and then calls it. The scene's Round
press is now that same pair, so a Round on the scene screen costs the clock what
a Round on the Dungeon tab costs. `resolvePlanRound` stamps each due entry and
keeps it in the plan rather than taking it out, so the next Turn rolls nothing
twice and the plan entry's `by` is still there for the locker check; the
scene's fallback (unlock, then resolve) and the `lockedBy` it carried are
removed. The import stays lazy, as the seam entry ruled.
