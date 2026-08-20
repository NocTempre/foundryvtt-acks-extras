# Formation — Architecture

The exploration feature: marching order, the party token, dungeon turns, light
and fog. ApplicationV2 + HandlebarsApplicationMixin, Foundry v14, `acks` system.

## Libraries

Rather than recreate core infrastructure, the module leans on community libraries instead of hand-rolled equivalents.

**Required** (`relationships.requires` on the module as a whole) — this feature cannot run without them:

- **libWrapper** — wraps the ruler classes' `_getWaypointLabelContext` (`measure-fuzz.mjs`) so it composes with other ruler modules instead of clobbering the class.
- **socketlib** — all cross-client messaging, through the module-wide transport in `scripts/lib/sockets.mjs`: named handlers with GM routing for player action requests and fog reloads. There is one socketlib registration and one channel (`module.acks-extras`) for the whole module; the feature owns handler names, not a socket.

**Recommended** (`relationships.recommends`) — optional, degrades gracefully:

- **simple-timekeeping** — a front-end for the world clock, calendar, and scene-darkness sync. Dungeon turns feed it through the standard `game.time.advance` contract, so it needs no integration code: with it installed you get the calendar UI and time-of-day darkness; without it, turns still advance core world time and the module is unaffected. The module only *reads* scene darkness (`isPartyInDark`), never writes it, so the two never fight over darkness.

### Monster senses & movement

The Full Monster Sheet (the monsters feature) stores a creature's real vision modes, special senses, and multi-row Speed table, so a monster party member's dark sight and exploration pace come from its stat block rather than human defaults. `scripts/formation/monster-traits.mjs` reads that structured data raw from `flags["acks-extras"].extras` rather than through the monsters API, so it stays independent of feature load order.

For monsters carrying a stat block, `canSeeInDark` and `explorationSpeedOf` defer to `monster-traits.mjs` instead of the generic heuristics; without one, actors fall back to ability/effect name matching and the system encumbrance speed.

- **Dark operation** is authoritative from `extras.vision` + `extras.otherSenses`. Only modes that function in *total* darkness count: **Lightless Vision** and **Blind** navigation, plus **Echolocation** and the **Mechanoreception** senses (their "sight" reads as dim light). **Night Vision is excluded** — it upgrades dim light but fails in total dark, the exact human assumption this fixes. Acute hearing/olfaction/vision only aid surprise and never defeat darkness.
- **Exploration speed** is the *running* value of the creature's land Speed row (ACKS records speed as `[combat] / [exploration = running]`); a purely aquatic/aerial creature falls back to its primary row. Blinded creatures still take the 1/3-speed dark penalty unless one of the dark senses above applies.

## Files

All paths are under `scripts/formation/` unless noted.

| File | Responsibility |
|---|---|
| `constants.mjs` | Rules constants (turn length, rest interval, light sources, roles and their kits, speed tiers). |
| `judge-override.mjs` | What a GM giving a character something means: supply the gear, empty the hands. |
| `formation-model.mjs` | Formation records: storage (world setting `acks-extras.formations`), membership, party actor/token lifecycle, marching order, derived speeds. |
| `turn-engine.mjs` | Dungeon-turn tick: world time, lights, rest/winded, effect expiry, wandering-monster throws, rations, movement→turn conversion, chat cards. |
| `formation-view.mjs`, `formation-actions.mjs` | The formation window (GM controls, player read-only) and its action handlers. |
| `zones.mjs` | Point-in-region geometry shared by every zone behavior: core `testPoint` when available, manual shape math as a headless fallback, and `findZone(formation, type)` testing the party token's CENTRE. |
| `encounter-zone.mjs` | `acks-extras.encounterZone` RegionBehavior subtype (table UUID + cadence overrides). |
| `trap-rules.mjs` | Traps as arithmetic, Foundry-free: probe order, who is caught, the disarm plan, botch bands, the repeat lock, pit damage. |
| `trap-zone.mjs` | `acks-extras.trapZone` RegionBehavior subtype, the placement abstraction over regions and walls, the crossing sequence, firing, and the Trapbreaking throws. |
| `trap-walls.mjs` | The trap layer on a wall, the Walls-layer tools, chaining selected walls into a region outline, path-crossing geometry, and drag-to-assign. |
| `trap-markers.mjs` | Canvas markers showing each trap's state, staged: a Judge sees every trap, a player only what the party has found. |
| `trapbreak-app.mjs` | The Trapbreaking dialog — who, which trap, which column — open to Judges and to players whose character can make the throw. |
| `data/trap-data.mjs`, `trap-sheet.mjs` | The `acks-extras.trap` Item subtype holding a trap's definition, and its sheet. |
| `scene-sync.mjs` | Mapper-gated fog (`scene.fog.exploration`, original value stashed in a scene flag) and party-token light emission mirroring lit sources. Reconciled by the primary GM after every formation change (idempotent, compare-before-write). |
| `deployment.mjs` | Putting members on the map and gathering them back: the combat deploy, the deliberate detach, and the movement leash on a detached member. |
| `marching-templates.mjs` | Saved marching orders (world setting `acks-extras.marchingTemplates`): capturing an arrangement, reconciling it against the party as it now stands, and forming up. |
| `obstacles.mjs`, `swimming.mjs`, `jumping.mjs` | The chapter 6 obstacle derivations, published on `api.formation`. Deep water and chasms sit *beside* the Spelunking table rather than in it; each file's header says what it does not share with the others. |
| `announce.mjs` | One formation chat card (public, or whispered to the GMs). |
| `../lib/sockets.mjs` | Module-wide socketlib transport: one registration, one channel, a handler registry that throws on a duplicate name, and a pre-ready queue so handlers can register at import time. Not formation-owned. |
| `module.mjs` | Settings, hooks, scene-control button, `/formation` chat command, feature API. |

## Data flow

- **State** lives in one world setting (`formations`, keyed by id — see the shape documented at the top of `formation-model.mjs`). Only GM clients write it; the `updateSetting` hook re-renders the window on every client.
- **Marching order** = order of `members[]`. Roles are per-member string arrays.
- **Member tokens** are stashed as raw `toObject()` snapshots in `members[].tokenData` when the actor joins, and re-created around the party token on removal/disband.
- The **party token** belongs to a dedicated `monster`-type actor (one per formation) whose `system.movement.base` mirrors the party's exploration speed (min over members' `system.movementacks.exploration`, which the acks system derives from encumbrance). `updateActor`/`create|update|deleteItem` hooks keep it in sync.
- The **party token's size** is the formation's real shape at the scene's scale: `faceWidthFeet` (frontage × the `marchFeetPerBody` world setting) across the line of march, `partyDepth × 5'` deep, converted through `scene.grid.distance` and quantized to quarter squares (`syncPartyTokenSize` in `scene-sync.mjs`). Token width/height are axis-aligned, so an east/west heading swaps the two; a rotation-watching `updateToken` hook resyncs on every turn. Every face-width consumer reads `effectiveFrontage()`, the seam where the squeeze mechanic (ROADMAP) will narrow a squeezed column. Generic tokens are sized by the battlemap feature (`docs/battlemap/MODEL.md`), which exempts party tokens — one owner per token, each side skipping the other's.

## Movement → turns

`updateToken` (x/y change on a token flagged with `acks-extras.formationId`) is processed **only on the active GM client** (`game.users.activeGM.isSelf`), no matter who dragged the token. Distance = straight-line pixels → feet via the scene grid; accumulated in `clock.carryFeet`; each full exploration-speed's worth pops one call to `advanceTurns`. `clock.lastPosition` anchors measurement (re-anchored when tracking is un-paused, seeded at party-token creation).

## Turn tick (`advanceTurns`)

Per turn, in order (mirrors JJ sequence of play step 5):

1. `game.time.advance(600)` (setting-gated) — snapshot member effects with `duration.remaining > 0` beforehand, report the ones that hit ≤ 0 after.
2. Rest counter (or reset when `resting`); winded at `> 5` turns; marker Active Effect applied/removed on members (Endurance-proficient members skipped, matched by item name).
3. Lit lights `remaining--`, guttering warning at 1, burnout at 0.
4. Encounter counter; every N turns roll 1d6 vs target, whispered to GMs; on encounter, pre-roll 2d6×10 distance and 1d10 minute-of-turn, then draw privately from the resolved RollTable. Parameters resolve zone → formation → world settings: an `encounterZone` region behavior under the party token overrides frequency/target (0 = inherit) and supplies a table UUID; else the formation's `tableId`; else announce-only.
5. Day boundary (144 turns) → ration reminder.
6. Persist + chat summary card (public or GM-only per setting).

## The player surface (v0.22)

One sheet, two capability tiers — never two UIs. Formation state lives in a
world setting only GMs can write, so every player mutation is a **declaration**:
relayed over socketlib to the active GM client, which validates ownership
against the *passed user id* (never the requesting client's say-so) and
executes. Players act on what is THEIRS:

| Surface | Player capability | Route |
|---|---|---|
| Marching order | Move their own character (up/down/left/right; target recomputed GM-side from the actor id, not the click's stale cell) | `reorder` |
| Roles | Take up / set down roles on their own character (10'-pole item gate enforced GM-side) | `role` |
| Lights | Douse/relight and shutter lights their character carries; add via the declaration panel | `lightToggle` / `lightShield` / `light` |
| Character sheet lights | Light, douse and shutter a lamp on their own character's inventory tab (the equipment feature's row controls, `declareLightAction`) | `light` / `lightToggle` / `lightShield` |
| Spells | See all tracked spells; add their own via the declaration panel | `spell` |
| Maps | See the party's maps and session status; consult (anchor) a map their character holds | `anchorMap` |
| Checks & rest | Declare listen/search/bash/track and rest turns | `check` / `rest` |

Judge secrets never reach a player's DOM: map `quality`/`distorted` and the
mapper's proficiency exist only in the GM render context — a warped map must
be indistinguishable from an accurate one to its holders. Removals, blanks,
frontage, the clock, saves, tables, and session lifecycle stay GM-only.
Role and light declarations are announced publicly, so the table sees who
changed the party's posture.

## The Judge's override

The party sheet's gear rules exist to stop a *player* claiming a torch they never
bought or a free hand they do not have. Applied to the Judge they are only in the
way: a GM who assigns the light has already decided the character has one. So a
GM action does not ask — `judge-override.mjs` puts the gear in the pack and
empties a hand to hold it, then the action proceeds.

| Action | GM | Player |
|---|---|---|
| Light a torch / lantern / candle | gear supplied, a hand emptied | refused without the gear and a spare hand |
| Take up a role with a kit (mapper, 10' pole) | kit supplied, hands emptied | refused without the kit |

The override **never blocks**. Where it cannot finish — no such item exists in
the world to copy, or the hands are full of lit torches that sheathing cannot
empty — it warns and lets the action through anyway. A Judge overriding the rules
is not looking for a smaller refusal.

Authority comes from the **declaring** user, not the executing client:
`player-requests.mjs` passes `user.isGM`, because a player's declaration is
relayed to and executed on a GM client, where `game.user.isGM` would hand the
override to everyone.

The two mutations themselves belong to the equipment feature (`grantGear`,
`clearHands` — see [its model](../equipment/MODEL.md)); this feature owns only
the rule about *what* is needed. Missing the equipment feature degrades to
supplying nothing, never to an error.

## Roles that need a kit

`ROLE_GEAR` states what a role's holder must be carrying, in the shape the grant
API reads — so ONE list both refuses the role and, under override, supplies it.

- **10' pole** — a pole or polearm. Carried, not held: probed with and set down.
- **Mapper** — a quill and parchment. RR p. 266 gives the requirement as "both
  hands occupied", and this is what occupies them: **one hand per piece of kit**
  (`ROLE_HAND_COST`), for as long as the role is held. That is what makes mapping
  and a drawn sword mutually exclusive.

`handsOccupied(actorId)` is the single call the equipment feature's loadout makes for
hands the party sheet has filled — lights borne plus role kits — and taking up or
setting down a role fires `acksExtras.roleChanged` so the loadout recomputes,
exactly as `acksExtras.lightChanged` does for a struck light.

## Which way the block points

A deploy lays the marching order out as a block: files spread across the line of
march at the current `frontage`, ranks stack up behind the front one. Which way
that block *faces* is the party token's own `rotation`, snapped to the nearest
cardinal (`snapHeading` / `formationHeading` in `formation-model.mjs`). Nothing
stores a heading — Foundry writes `rotation` itself whenever a token is dragged
or walked (core's `tokenAutoRotate`, on by default), so the party token is
already a record of which way the party last marched, and turning it by hand is
how a Judge aims the block.

`HEADINGS` carries each cardinal as a `forward`/`right` pair of unit vectors in
scene space (y grows downward, so south is `+y`). `formationOffset` lays file
along `right` and rank against `forward`, which keeps every offset an exact whole
number of squares — no angles, no rounding. Foundry's rotation is zero at
**south** and runs through west at 90.

`blockOrigin` fits the whole block onto the scene before anyone is placed, and
does it over the block's real reach in each direction rather than assuming span
is horizontal and depth vertical: those two exchange axes the moment the party
turns east or west, and a block that reaches up and to the left has to be held
off the *top* and *left* edges. Origin and cells are computed against one heading
read, passed down from the caller — re-reading it per cell would let a token that
turned mid-deploy place a body outside the room the clamp had made for it.

## Saved marching orders

`marching-templates.mjs` remembers an arrangement — who stands where, what each
of them is doing, and the frontage — under a name, in the world setting
`acks-extras.marchingTemplates`. It records the SHAPE and nothing else: no token
snapshots, no hit points, no lights, no clock, so restoring one can lose an
arrangement and never a character.

The word *template* already means the Monster Manual's stat-by-rank pages in
this family (`lib/template-logic.mjs`), so this surface says **marching order**
throughout.

`reconcile` is pure and returns new member records rather than editing the ones
it was given, because the party an order is applied to is never quite the party
it was saved from:

- a saved cell naming someone no longer in the party is **dropped and the line
  closes up**, counted in `missing` so the absence is reported rather than
  implied;
- a member the order never knew about is **appended** with their current roles —
  an arrangement is not a roster, and may not discharge the henchman hired since;
- a role whose gear the character no longer holds is **refused**, on the same
  rule `toggleRole` applies, and counted in `skipped`.

Blank cells come from the saved order alone: the arrangement owns the shape.

**Forming up** (`formUp`) applies the order and gathers anyone standing on the
map back inside the party token. It is refused during a combat on the same
ground `toggleDetachMember` is — the fight owns who is on the field — and it
re-anchors `clock.lastPosition` *before* the party token moves to the reform
point, or the jump would read as the party having walked there and spend dungeon
turns nobody took. Role changes are announced one at a time exactly as
`toggleRole` announces them, since a role can fill hands and acks-equipment
recomputes a loadout off that hook.

The party sheet saves and loads orders; the party token's HUD carries a **form
up** button, which appears only once at least one order is saved and skips the
picker when there is only one to pick.

## Traps

A trap is **a document, a placement, and a sequence**, and the three are
deliberately separate.

The **document** is an `acks-extras.trap` Item: what springs it, how it is built,
who it catches, and — as six rows on `levels` — how it resolves and what it deals
at each of the six levels the books print it at. `level` is not a fact about the
trap but the row in force, and `tier` is how everything reads it; a scything
blade is one trap whether it is laid at 1st or 4th. It is shared — one blade, laid
in four corridors — and `acks-importer` materializes the Judge's own book into
it, one document per printed trap with all six rows filled. Nothing here holds a
printed trap.

The **placement** is either a `acks-extras.trapZone` region behavior or a trap
layer flagged onto a wall. Both carry a reference to a trap, the state of that
burial (`armed` → `found` / `disarmed` / `discharged`), two per-character ledgers
— who has spent their hasty Trapbreaking attempt on it and who has spent their
automatic hasty search, each against the level they spent it at — and `known`.
`trap-zone.mjs` reaches both through one `Placement` shape, so the rules are
written once.

`known` is **what the party has learned**, and it is not derivable from the
state: a trap found, disarmed and then re-armed by the party's own thief reads
`armed` again and is still perfectly well known, while one the Judge rebuilt
reads `armed` and is a fresh secret. It is the stage the markers and the
Trapbreaking target list are gated on — a Judge sees every trap, everyone else
sees only what the party has found.

A trap wall **restricts nothing**. The party walks through it as though it were
not there; what stops them is detection, applied by moving the party token back
to the crossing point. That is also what makes a trap layer safe to put on a
door, which is where the book's most famous trap lives. A trap AREA is created
`visibility: GAMEMASTER` for the same reason: players are given the Regions
control, and Foundry's default renders a region to anyone who opens it.

The **sequence** is the sequence of play's, not §7's own order:

1. **Searchers throw first**, and not only against the trap in the way. A thief
   at exploration speed automatically hasty-searches everything he passes within
   5' of, 10' with a pole — measured against the ground the party WALKED, not
   where it stopped, so a pit beside the corridor gets its throw. The reach is
   the character's and the distance is the party token's, so a searcher's own
   rank is subtracted from it. Each searcher gets ONE throw per trap per level,
   because the automatic throw is a hasty search and carries the hasty search's
   price; without that ledger a party finds every trap in the dungeon by
   shuffling back and forth over it. The sweep is silent — it posts nothing
   unless something is spotted.
2. **The pole probes**, one rank ahead of its bearer, with its own secret 1d6.
3. **The party walks in**, rank by rank, each with its own secret 1d6.

The first throw inside the trigger band ends the sequence. At combat speed the
party loses both the pole and the hasty search, which is exactly what RR p. 263
says it loses. A pole-sprung trap catches nobody within its own square — that is
the point of the pole — but an area effect still reaches back for the bearer.

Everything is whispered to the Judge, including a trap the party crossed
untouched: knowing the corridor was clear is how a Judge tracks a trap that is
still armed, and saying it aloud would give away that there was anything there.

Damage is **computed against the throw and then reported, not applied**. What a
made save is worth is a field on the trap, because the book's traps disagree: a
collapsing ceiling halves, a deadfall is dodged outright, a portcullis grants a
choice of side and no mitigation at all. An attack that missed deals nothing
regardless. The card carries the number the victim actually took — reporting a
damage line beside a missed attack, which 4.9.0 and 4.9.1 did, is worse than
saying nothing.

Applying it is still the Judge's, on the precedent the door helper set: a botched
bash returns its point of damage and leaves the writing to a human.

**Trapbreaking is a dialog, and its target is chosen.** `trapbreak-app.mjs` asks
three questions — who is working on it, which trap, and by which column of the
table — and shows the throw before anyone spends a round or a turn on it. The
target list holds only traps within 5' that the party has FOUND, because
offering an unfound one announces it; a Judge additionally sees the unfound ones
in reach, with a control to mark one spotted for a discovery made some other way
than a throw. Players open the same dialog from the party sheet whenever one of
their characters could actually make the throw, and their attempt is declared to
the Judge's client the way every other player action is.

## Detaching a member

A formation travels as one token. Two things take a member out of it, and both
run through `deployment.mjs`: a **combat**, which deploys everyone who can
fight, and a **detach**, which sends one member out deliberately — the scout
easing down the corridor while the party waits.

A detached member never leaves the formation. Marching order, roles, lights,
rest and the turn clock all keep counting them. What changes is which token
carries their vision and their torch: their own token is synced from the actor
like any standalone creature (`lib/token-sync.mjs`), and `bearerLights`
finds their light in the formation's record. The party token meanwhile drops
that bearer's light and stops borrowing their eyes — `syncPartyTokenVision`
gives the party token its best *remaining* member's sight.

### The leash

A detached member may not get further than **one round's movement**
(`system.movementacks.combat`, which the system derives as exploration ÷ 3) from
where they stood the last time the party token moved. At that limit they wait;
the party has to catch up or pass them before they can push on again.

This is what lets a scout exist without breaking the clock. Dungeon turns are
driven by the party token's movement, so a scout free to range the whole level
would spend hours of game time that nothing counted. Tethered to a round, the
point man is where the rules put them — just ahead, within earshot — and the
party token remains the only thing that spends time.

The limit is a **distance from the anchor**, not a spent budget: pacing back and
forth inside the circle is free, because it gets you no further ahead. That also
means any client can evaluate it from state it already has, with no running
total only a GM could write. `preUpdateToken` cancels a breaching move outright
rather than snapping the token back afterwards. The GM is warned but not
stopped — they decide where things end up, and hard-blocking them would make
repositioning a scout impossible without recalling them first.

Combat takes over a detached member rather than fighting with them: joining a
combat clears `detached`, so the leash does not constrain a fight. A detached
scout is also explicitly *not* treated as "already deployed" when the party
enters combat — they are exactly who walks into one, and the rest of the party
must still deploy around them.

## Deliberate non-features (v0.1)

- Combat rounds are not auto-counted toward rest (10 rounds = 1 turn); the GM uses the manual Turn button after fights.
- ~~No socket layer: players never mutate formation state directly~~ — superseded: socketlib relays player declarations (see *The player surface*); token drags are still processed by the GM client's hook.
- Waypointed drags are measured start→end as a straight line.
- The wandering-monster *tables* (which monster appears) are not rolled — dungeon-specific tables belong to the Judge; we roll the throw, distance, and minute only.

## Ideas for later

Superseded by [ROADMAP.md](ROADMAP.md), which tracks the full rules gap analysis and
the phased mapping plan ([FOG.md](FOG.md)). Combat-round counting
shipped in v0.4.0 (on combat end, 10 rounds = 1 turn with carry).
