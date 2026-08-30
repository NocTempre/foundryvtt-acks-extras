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
- **Every write goes through one private `commit(mutate)`**, which reads the ledger inside the save lock — the lock and the read are a single act, so no writer can hold a copy from before its turn in the queue. Three writers sit on it: `createFormation` **inserts** (the only insert, and it mints the id); `updateFormation` writes a record WHOLE and **refuses one the ledger no longer holds**, since a caller arriving with a record that was dissolved while it worked has a moot write, not an urgent one; `patchFormation` re-reads one record and applies a targeted mutation, which is what a hook or any background writer uses so a concurrent field change is not overwritten and its own guards are decided against current reality.
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

Because a flag write is a merge, a trap patch is merged in code and written as a
`ForcedReplacement`. A merge cannot empty anything, and emptying a ledger —
`{repeatLock: {}}` — is precisely what rebuilding a trap has to do.

**Laying one is a wall preset, not a placement.** With walls selected the tool
lays a trap layer on each; with nothing selected it stores the tripwire as the
data new walls are created with and hands over the drawing tool, so the Judge
drags the line where it goes. The pip on its button — core's own, lit off
`createData` — is what says the next wall drawn will be trapped. Both trap tools
sit on the **Walls** control and traps have no control of their own: leaving a
placeables layer releases its selection, and a selected wall is what both tools
act on.

**The marker is also the control.** For a Judge in trap-editing mode — the Walls
or Regions control — the marker takes core's door gestures: **left** sets the
mechanism or makes it safe, **right** decides whether the party can see it, and
hovering names the trap, its state and who is looking at it. A ring round the
glyph is the Judge's reminder that the party can see that one. Both gestures are
the Judge's hand moving directly; a throw is Trapbreaking and has its own dialog.
Everywhere else — every other control, and every non-GM seat — the markers are
drawn and inert, so nothing answers a mis-aimed token drag.

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

## The journey

A formation is in one of two MODES (three with the city, below), and **a SCENE
may name which one applies on it**: the battlemap setup tool writes
`mapSystem` into the scene's own record, and `adoptSceneSystem`
([travel.mjs](../../scripts/formation/travel.mjs)) switches a formation to it
when its party token lands there and when the declaration changes underneath
it. A scene that declares nothing changes nothing — a party mid-march crossing
an unlabelled map keeps its march. The vocabulary is shared, not copied
(`lib/vocab.mjs` `TRAVEL_MODES`); what the declaration means to a map is
`docs/battlemap/MODEL.md`.

Delve is everything above; **journey**
pauses movement-driven turn ticking (`clock.paused`) and puts the day on the
table instead: a `travel` subtree on the record
([travel.mjs](../../scripts/formation/travel.mjs)) holding the ground, road
and territory the party is crossing, the day's weather, the hex it believes
it is in, the DAY BOARD — one day-kind (dedicated march, forced march, camp)
plus the four ancillary hour slots the wilderness rules budget, a forced
march consuming all four — and an append-only, capped log of finished days.

The GM window's journey panel edits all of it through one targeted ledger
patch per form change; players see the derived march, the hex and the log,
never the pickers and never the LOST state, which is the Judge's alone. On a
hex-gridded scene the party token IS the trace: crossing a hex boundary
names the hex from its grid offset and, where the battlemap feature's
terrain painting has claimed the cell, sets the ground too (the same
token-movement seam that ticks dungeon turns hands journeying formations to
`onJourneyTokenMoved` instead). The
readout derives in the rules' order — the party's slowest UNSCALED base,
times terrain, road and weather (one factor per line), times the day-kind's
pace — and **End day** writes exactly the figures shown into the log, resets
the board, and advances the world clock a day through `lib/world-time.mjs`'s
switch. `acksExtras.formation.travel` (apiVersion 4) publishes the mode
switch, the day board writers, the hex trace and the pure pieces.

## Searching the wild

One throw, three quarries
([searching.mjs](../../scripts/formation/searching.mjs)). A party sweeping a
hex for a lair, a LOST party hunting the last landmark it knew, and a party out
looking for that lost party all make the same Wilderness Searching throw — the
second and third are the first with a different quarry, and the book says so
outright. That is why the landmark search is what ends a lost episode: it feeds
`reanchorEpisode`.

The rule that surprises people, and the reason the target is not a constant:
**a party that covers ground finds more.** A faster expedition sweeps a wider
path, so its target improves as its daily distance rises. The relationship is
the rule; the ladder of distances is printed and bracketed.

Two things bite. A search costs an hour and buys ONE throw, so a day holds only
as many searches as the board has spare slots — a forced march has none.
And **searching draws attention**: every search owes an encounter throw, which
is what makes a lost party's hunt for its landmark a genuinely dangerous act
rather than a formality.

**From the air is two corrections, not one**, which is why it is a mode.
Over open country a flier gets MORE throws in the same time; over forest,
jungle or swamp it gets the same throws at a worse target, because the canopy
is in the way. Only one of the two ever applies. Hunting one NAMED place is
harder again than noticing whatever happens to be there, and the penalties
compound.

**Splitting the party** buys throws and costs safety in exactly equal
measure: each sub-party sweeps AND draws its own encounters, with nobody to
help. Groups near enough to come to each other's aid have not really split, and
the structure refuses to pretend they have.

**Land Surveying has three outcomes, not two.** A success reveals the true
count of places worth finding in the hex. An unmodified 1 reveals a FALSE one —
the surveyor is confidently wrong and the party is handed a number they have no
reason to doubt, which is the same doctrine as the lost mechanic. Anything else
reveals nothing at all, which is "not yet enough to go on" rather than failure.
Only the natural die lies: a heavily penalised miss is silence.

[search-run.mjs](../../scripts/formation/search-run.mjs) is the impure half.
It makes the party PAY for looking: RAW gives a searching party one
wandering-monster throw per hour, which is what turns "search until you find
it" from a free action into a decision. The encounter goes through the
journey's own chain rather than a second one of ours, so a monster met while
searching is drawn from exactly the tables a monster met while marching would
be.

Whether the hex actually holds anything is the JUDGE's own answer, ticked on
the panel — the module never invents one, because that is the Judge's map. From
the air over open country the hour buys more than one attempt.

`searchOutcome` keeps a miss and an empty hex apart for the Judge while giving
the party the same silence for both, because a party that searches barren
ground all week never learns that it was barren.

## Living off the country

The day board has carried `forage` and `hunt` as pickable slots since the
journey shipped and nothing ever resolved them.
[foraging.mjs](../../scripts/formation/foraging.mjs) resolves them, and what it
produces goes into the same pool the order eats from — which is the only reason
the slots were ever worth picking.

The three kinds are NOT one shape, and that is why this needs structure rather
than one function. **Firewood** is per forager and may be tried as often as
wanted. **Water** is a PARTY throw once a day — one roll for the whole order,
not one each — and a hex with standing water skips the throw entirely rather
than easing it; past a group's worth of mouths the order throws again for each
further group, and a success feeds only that group. **Food** is per forager,
once a day, against one target wherever you are.

Hunting is its own activity. Game is scarce where people are, so how settled
the country is moves the target — the SIGN of that is the rule, its size is
printed. A pack of dogs each throw and each help the others to a cap, which is
what makes a pack worth keeping and what stops a kennel being an autowin.

Grazing carries three facts: it normally costs an animal its whole day, some
kinds graze on their spare hours alone and so can still travel, and barren
country feeds only what already lives there.

## Working the country

[forage-run.mjs](../../scripts/formation/forage-run.mjs) is the impure half of
foraging: it rolls what the day board set aside and DEPOSITS what is found.
Water is thrown for the party once; food and firewood are each forager's own
attempt; hunting is its own throw again. Standing water — a river the party is
following — is taken freely with no throw at all.

What is found goes into the FORAGER's own pack, flagged, never into a separate
party store: the pool is already the sum of what the members carry, and a
second store would be a second answer to the same question.

## The camp panel

One section on the journey board rather than three, because a Judge weighs
these together: how long the packs last, who is going short, and whether
tonight's chosen hours are worth spending. Three panels would hide the trade
between them, and the trade is what the day board exists to make visible.

It shows the supply forecast in days for the whole order, then **only the
suffering** — a roster of well-fed names is noise that would bury the one
person who is starving — and, Judge-side, what each picked slot is actually
worth tonight: the forage targets for food, water and firewood, the hunting
target moved by territory, and the search target with how many hours the board
is holding for it. Anything unimported says so rather than showing a number.

## Provisions

The group half of survival: `lib/survival.mjs` knows what going without does to
one body, and [provisions.mjs](../../scripts/formation/provisions.mjs) knows
what it does to a party.

The rule the file exists for is that **a party shares.** Rations sit in
whichever packs happen to hold them, and a marching order does not let one
character starve beside another's full sack — so supply is pooled across the
order and dealt out, and only a pool that cannot cover everyone puts anybody
short. Food and water are dealt independently, because well fed and parched is
a real day and in a desert it is the usual one.

**One supply reader, `daysCarried`.** It counts items whose NAME says what they
are and items this module FLAGGED when it put them there, so foraged food and
hunted game feed the order exactly as rations do. A second reader is a second
answer to "how much food is there", and the two disagree the moment something
arrives by a path the other does not know about — which is not hypothetical:
foraging shipped depositing items the ration pattern did not match, and the
forecast read zero while the packs were full.

HOW a shortfall is spread is a Judge's call, not the book's — it prices what
hunger does to a body, never who a captain chooses to feed — so both honest
policies ship behind a setting. `even` puts the whole order on the same reduced
ration; `triage` feeds as many as can be fed properly and leaves the rest
empty. They spend the same supply and differ only in who suffers. The default
is `even`.

`even` is deliberately coarse: a pool that cannot manage even half a ration
each feeds nobody rather than pretending a sip is a meal, and does not spend
itself on the fiction. That coarseness is the ladder's — it knows three levels
and no more.

## Flight

The expedition above the ground rather than on it
([flight.mjs](../../scripts/formation/flight.mjs)), deliberately smaller than
either the march or a voyage: a factor on top of the land derivation, with none
of the navigation, footing or road machinery, because a flier meets none of it.

A full day aloft collapses to the imported factor; a partial day BLENDS, so the
grounded hours keep their own speed and only the airborne share is multiplied.
Wind is the one weather that bites flight specifically. A flying mount is
priced by a threshold rather than a slope — full to its normal load, slower
beyond it, and grounded past its maximum, which needs no table to be true.

The ground below still counts — RR prints the terrain multipliers under Flight
Speed — and which factors a flier meets is the `flying` mode's business
(`docs/lib/MODEL.md`, Movement modes), not this file's. Flight contributes only
what flight itself is worth, and marks its wind as superseding the ground's.

## Lost

A lost party is somewhere real and believes it is somewhere else, and the
feature keeps both. Four files, each ignorant of the others, and one that knows
the order they move in:

- **[lost.mjs](../../scripts/formation/lost.mjs)** — the ledger. The anchor
  (the last known landmark), the believed hex, the faked ground, and the
  OBSERVATIONS: pairs of where a thing was really seen and where the party
  thinks it saw it. Pure, so the transitions are testable.
- **[shadow.mjs](../../scripts/formation/shadow.mjs)** — the true position, as
  a hidden, sightless token flagged to its formation. A token rather than a
  coordinate because every question worth asking about a lost party is a
  distance, and `nearbyLost` answers "do two lost parties risk meeting" with
  the grid's own measurement.
- **[lost-fog.mjs](../../scripts/formation/lost-fog.mjs)** — the faked reveal
  and its undoing. Uncovers the GROUND for the players and nothing else; the
  Judge's own fog is never touched. The snapshot is taken once before the first
  fake and written back whole, because subtracting from a live bitmap drifts.
- **[lost-episode.mjs](../../scripts/formation/lost-episode.mjs)** — the only
  caller that knows the ORDER: snapshot before the first fake, and faked ground
  closed before anything is credited.

Three endings, and only one of them gives anything back. **Discovery** (the
daily throw succeeds) tells the party it is lost and nothing more — the faked
ground closes, the observations go with it, and the shadow stays exactly where
it is, because the party is still standing there and still does not know where
that is. **Re-anchor** (it finds its last known landmark) is the only
transition that credits: the false ground closes first, then every observation
is re-placed at the hex it was really made in, and the shadow retires. A party
that simply retreats keeps neither.

**Following spares the throw.** RAW exempts navigable rivers, roads and "other
well-established routes" from getting lost. Roads are the road picker's
business; `following` carries the other two, and `knownRoute` is deliberately
vague because the book is — what counts as well-established is the Judge's
call. The branch existed before the field did, so the exemption was
unreachable: a check that reads a value nothing writes is dead code wearing a
rule's clothes.

The throw itself is `rollLandNavigation` — a d20 against the terrain's imported
target plus the marching order's competence, with an unmodified 1 failing
whatever the bonus.

## The city

A third mode beside delve and journey. A settlement is crossed in **blocks and
turns** — too short for the expedition scale, too long for the dungeon turn —
and the shape is the journey in miniature
([settlement.mjs](../../scripts/formation/settlement.mjs)): a **pace** decides
how far a turn carries you, a **navigation throw** decides whether you arrive
where you meant to, and **where you are standing** decides how often the street
answers.

Three structural facts carry it. Only a commuting pace can lose its way — a
meandering one is already reading the street signs. A route walked before needs
no throw at all, while a destination reached before by another way is easier
but not free. And a large party straggles through a crowd in tiers, which bite
the commuting pace alone. That those tiers EXIST is the rule; where each starts
and what it costs is printed, so the ladder is registered
(`settlement` doc: `paces`, `navigation`, `straggling`, `encounters`). Nothing
here ships a distance: an unimported city reports which table is missing rather
than moving the party an invented number of blocks.

**A turn is taken, not simulated.** `advanceSettlementTurn` is pure and owns
no dice; `settlement-turn.mjs` rolls them, writes the board and whispers the
Judge. Order matters inside the tick: the party MOVES, then the street gets its
chance — a turn spent walking into an alley is a turn the alley can answer for.
Being turned around in a city is known **at once**, unlike the wilderness,
which is why it reads as a warning on the panel rather than a secret.

The tick is what makes the board's `blocks`, `turns`, `lost` and `lastThrow`
mean anything. Without it they were fields nothing read — the same defect as a
schema a Judge cannot populate.

The board rides the journey panel's own submit — `travel.settlement.*` field
names, applied by `applyTravelForm` — because an ApplicationV2 action fires on
click and a select bound to one never reports a change at all.

## The weather

The day's sky is part of the travel record
([weather.mjs](../../scripts/formation/weather.mjs)): a temperature band
(day and night), a precipitation kind, a wind band — the same six-step wind
ladder the vessels sail by — and the FOOTING the weather has left on the
ground (mud that forms, freezes, thaws and dries; snow that lies and melts
to mud). The panel's three band selects work bare-handed: the band keys are
structural, so a Judge with nothing imported still declares the sky. With
the `weather` document imported, **Roll the sky** (and, when armed, every
End day) generates it instead — three 2d6 throws under the hex's Köppen
climate and the season, the day's temperature roll re-read at night under
its own modifier, freezing air turning drizzle to flurries and rain to
snow, still air turning them to mist and fog, and an optional fronts drift
sliding each day one step toward yesterday. What the sky is WORTH is
imported the same way: the thirteen mechanical conditions derive from the
bands and the footing, each multiplies the march by its `conditionSpeed`
factor (cumulative, one readout line apiece), a road drowns when its
imported row names an active condition, pavement alone lifts mud, and the
footing's thresholds (days to mud, to snow, to dry) are the `accumulation`
table. Every land vehicle in the train is asked against the footing —
wheels stop in snow anywhere and in mud off pavement — and the refusals
render on the panel for the whole table. The finished day's weather goes
into its log row, display fields only.

**The sky is cached, not stored.** It keys on `(day, climate, season)`
([sky.mjs](../../scripts/formation/sky.mjs)), so two parties standing in the
same weather read one roll, re-rolling a settled day is a cache hit rather than
new weather, and yesterday stays addressable for the fronts drift. The book's
fast-travel allowance — several hexes in a day keeps the roll unless the
climate changed — is the key changing, or not, and needed no rule of its own.
Both callers settle the sky BEFORE their ledger patch, because a patch callback
is synchronous and the cache is not.

**The road is drawn, not picked.** On a scene carrying a route network
(`docs/battlemap/MODEL.md`), each step asks `stepBetweenHexes` and the answer
overrides the day's road picker the way painted terrain overrides the ground
picker. The day also banks the BENDS — only the excess over a straight
crossing, so a road with no bends never shows a tax — and the readout carries
it beside the march rather than inside it, because the road's cost and its
benefit are different currencies and must read as two numbers.

## The encounters

The wilderness asks its own questions
([encounters.mjs](../../scripts/formation/encounters.mjs) the chain,
[encounter-card.mjs](../../scripts/formation/encounter-card.mjs) the table
side). One throw runs the whole chain in the rules' order: the territory
d20 on the column the party's territory, road and the night pick (a Column
Shift result walks one column right and rolls again), then a civilized
d100 on the terrain's column group, or a rarity d20 and the
terrain-and-rarity monster d100, or a terrain-encounter d12 — stood down
when the party is resting or retracing its own route. Every band, name,
die and figure reads from the `encounters` registered document through
the terrain PICKS — a union vocabulary, because the book keys its tables
at three grains (eighteen biome-split monster sub-tables, seventeen
cover-split distance/evasion rows, eight civilized column groups); each
pick maps itself into all three, the travel ground derives a default, a
panel select overrides it, and a missing table — or a step the book
prints no row for, like a river's distance — resolves to a "draw from
your book" line, never a guess. A drawn creature resolves against the
world's actors and the imported library through the name-form fold, and
the whole chain lands as ONE Judge-whispered card: every roll shown, the
encounter distance (each side's own terrain when they differ, the longer
roll detecting, capped by how far a formation of that many heads can be
seen), the party's evasion target with the modifier lines that apply, and
the hand-off — detection and surprise resolve on the SYSTEM's own Surprise
Matrix at combat start (core owns the matrix, the rolls and the evade
permission; nothing here re-derives them), and reactions with the
influence tools. Cadence: the panel's Encounter throw button always; under
the `travelEncounters` world setting every hex genuinely entered throws as
it is entered, and End Day rolls the finished day's owed throws from the
imported frequency table — one per hunt or search hour, the camp's resting
cells, a night cell counted in nights gated on a die of that many sides.

Still ahead of this mode — supply consumption at End Day — is
[ROADMAP.md](ROADMAP.md) item 7.

## Deliberate non-features (v0.1)

- Combat rounds are not auto-counted toward rest (10 rounds = 1 turn); the GM uses the manual Turn button after fights.
- ~~No socket layer: players never mutate formation state directly~~ — superseded: socketlib relays player declarations (see *The player surface*); token drags are still processed by the GM client's hook.
- Waypointed drags are measured start→end as a straight line.
- The wandering-monster *tables* (which monster appears) are not rolled — dungeon-specific tables belong to the Judge; we roll the throw, distance, and minute only.

## Ideas for later

Superseded by [ROADMAP.md](ROADMAP.md), which tracks the full rules gap analysis and
the phased mapping plan ([FOG.md](FOG.md)). Combat-round counting
shipped in v0.4.0 (on combat end, 10 rounds = 1 turn with carry).
