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

## 2026-11-18 — The Round press is one seam, `resolveSceneRound`

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
