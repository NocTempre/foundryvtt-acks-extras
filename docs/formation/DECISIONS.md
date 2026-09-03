# Exploration formations — decision record

Why this feature is shaped the way it is: what was ruled, what was rejected, and
what it cost. How it behaves *now* is [MODEL.md](MODEL.md); unbuilt work is
[ROADMAP.md](ROADMAP.md).

Entries are dated and append-only. A superseded entry stays, marked.

---

### Three printed figures leave the module; the rest are inventoried (2026-09-02)

**Ruled.** The exploration speed grid, the carried-body weight with its gear
share, and the rest cadence are content. They are read from the `formation`
ruledata document through the shape `flight.mjs` and `foraging.mjs` already use,
or — in the grid's case — deleted.

**The grid was deleted rather than registered** because it had NO reader
anywhere in the repo: a printed table transcribed whole and then never consulted,
while the authoritative per-actor speed is the one the acks system computes. A
value with no consumer has no argument for being kept in any form.

**One printed figure had two owners.** The carried-body weight sat in
`constants.mjs` and again in `swimming.mjs`, which is precisely how a value
survives being registered in one place and not the other. Both now read
`carriedBody()`.

**Degradation says less; it never invents.** With nothing registered the clock
counts turns and calls for no rest, and a rescue load reads as unknown rather
than as zero — an unknown weight reported as nothing would say a body is
weightless. **Rejected: keeping the figures as fallbacks.** `lib/tables.mjs` has
forbidden fallback samples since the extraction program, and a fallback is how a
printed table survives registration.

**What is NOT content, recorded so a later pass does not strip it.** The
module's own unit system (`TURN_SECONDS`, `TURNS_PER_HOUR`, `TURNS_PER_DAY`,
`ROUNDS_PER_TURN`) is what everything else derives from, and `party-rolls`'
`consumesRound`/`consumesTurn` are booleans naming which unit an action spends —
the rule being performed, which the doctrine puts on the shipping side. Removing
either would leave the code unable to state its own procedure.

**The doctrine's prose cannot be applied literally, and this is the joint.**
Read literally — "every number read off a page is content, however small" — it
condemns `jumping.mjs`, the file the doctrine names as its own model, which
keeps eight printed constants deliberately. The narrower test this repo actually
runs, reconstructed from the doors, jumping and march-width rulings: a number
ships only if nothing else owns it, it is not a magnitude the book attaches to a
named option a reader picks, and it is a unit the module defines or derives, or
a Judge-editable parameter whose default is derived rather than transcribed.

**Cost, stated plainly: this pass is incomplete and known to be.** `swimming.mjs`
is almost entirely printed magnitudes, and the `party-rolls` resolver holds
proficiency bonuses that already have an owner in the character's own imported
ability. Both are inventoried in ROADMAP §6a rather than rushed, because each
needs a ruling no gate can make. Stopping with the inventory written is the
honest half-measure; stopping with it unwritten would have been the dishonest
one.

---

### The day's end is raised by movement and answered by the Judge (2026-08-31)

**Asked.** With the city moved onto its own tracker, the journey was the last
mode with a board that drives a clock: **End day** is a button, and the day it
ends is one the party has already finished walking. Should the day end itself
when the march is spent?

**Ruled: the tracker raises it, the Judge answers it.** `dayIsSpent` is checked
on every hex entered and puts one dialog — call it a day, push on into a forced
march, or not yet. A day that ended itself mid-drag would spend the provisions,
settle the ground, roll tomorrow's sky and advance the calendar for a decision
nobody made, and pushing on is a real choice the rules price (a forced march
buys its distance with every ancillary hour). So the trigger is movement and
the answer is not.

**Rejected: ending silently**, for the reason above. **Rejected: leaving the
button alone**, because a day whose march is spent is a thing the map already
knows and the Judge should not have to notice.

**Two defects this uncovered.** `withDayKind` did not carry `hexesEntered`
across a change to a *forced* march, so pushing on would have un-walked the
day's ground — invisible while the only way to change kind was a picker nobody
touched mid-day, and immediate once the prompt offered it. And the offer flag
must be written before the dialog is awaited: a drag across three hexes reaches
the check three times, and an unanswered dialog would otherwise stack.

**Cost.** `travelEndDay` no longer holds the closing sequence; `closeDay` does,
and the action delegates. One closer was the point — two would have drifted the
moment either grew a step.

### A city is explored, not administered (2026-08-31)

**Asked.** Settlement mode shipped as a panel: pickers, a derived rate, and a
**Take a turn** button that walked the party one turn at a time. Every other
adventuring mode reads the party's own motion — a delve counts the feet it
walks, a journey counts the hexes it enters — and only the city asked the Judge
to press something. Should the city keep its board?

**Ruled: no board drives a clock.** A settlement is timed in the same
ten-minute turns a dungeon is (JJ ch. 2 says so outright: a pace is stated in
blocks per turn), so it gets the same tracker. `setJourneyMode` now pauses the
clock for a JOURNEY alone, `turnDistance` supplies the distance one turn buys
in whichever mode is running, and the Take-a-turn and Hole-up buttons are gone.
The pickers stay: they declare state the tick reads, which is not the same
thing as a control that advances it.

**What it bought, and why it is more than tidiness.** The buttons were never
the real defect — the paused clock was. With it stopped, a city was a place
where torches did not burn down, spells did not run out, the rest interval did
not accrue and the world clock stood still; the delve's whole action surface
(listening, hasty and methodical searching, doors, spikes, traps) was reachable
and paid for nothing, because all of it is gated on the clock rather than on the
mode. Un-pausing it was one line, and it is what makes a heist in a guildhouse
cost what a corridor costs. The tracker is the visible half of the same ruling.

**The block is the map's, not the book's.** How far a turn carries the party is
printed (blocks per pace, imported); how wide a block is drawn is the Judge's
map, so `blockFeet` is a scene-setup field and is passed in rather than read
from the registry — the same seam `jumping.mjs` keeps. **Rejected: refusing to
tick until a block size is declared.** It is the family's habit to report a
missing figure rather than invent one, but here the honest fallback exists — the
party's own walking speed — and a city map that ticks nothing when the party
walks across it is indistinguishable from a broken module. It falls back and
says which rate it used.

**Holing up rides the world clock.** A party deliberately staying put has no
movement to read, and its cadence is per day, so `creditHoledUpDays` credits
whole days off the calendar instead. **Rejected: a queued "spend N days"
control**, which is the board again under another name, and which cannot price
a stay that some other feature's downtime advanced. The stay carries the world
time it is counted from so a dragged calendar pays exactly once, and the turn
tick owes a stationary party nothing at all — counted by both clocks, one stay
would be thrown for twice.

**Cost.** The `updateWorldTime` guard was henchmen's; a second copy in
formation would have been two answers to "am I the GM responsible for acting on
this", so it moved to `lib/world-time.mjs` and `onTimeAdvanced` now delegates.
`holeUpDays` left the board and existing records keep a dead field, which
`settlementOf` ignores.

---

### The door numbers are content, and move behind the registry (2026-08-30)

**Asked.** `doors.mjs` ships `BASH_TARGET`, `MAX_SPIKES`, `BASH_STR_FACTOR`,
`DOOR_KINDS`, the inline pair / crowbar / size / spike modifiers, and the
bludgeoning point a botch costs. `ip-scan.mjs` catches none of them — the value
rule needs a reviewer. Are they structural, or are they content?

**Ruled: content, all of them.** Two clauses of the doctrine decide it, and
neither is a close call.

- `DOOR_KINDS` is **a table of options a reader picks from**, which "is content
  whatever it is made of, and is registered rather than shipped". RR Ch.6 prints
  a grid of doors and portals with an armour-class and a structural-hit-point
  column; `DOOR_KINDS` is a subset of those rows retyped, with the batter-down
  turns from the paragraph above it folded in.
- The scalars are **a modifier's size** — the doctrine's first named example of
  what does not ship, "however small and however alone". The doctrine's *own*
  worked example is this very file: "that a crowbar helps force a door and that
  its help is additive is the rule being performed". What the crowbar is WORTH
  is the half that was never meant to be here.

**The transcription had already drifted, and that is the argument.**
`DOOR_KINDS.portcullis` carries, verbatim, the armour class and structural hit
points the printed grid gives its largest iron-banded *stone* door. The three
core books print no portcullis row at all; a portcullis appears there as a
trap, a gatehouse fitting and a spell target, never as a construction with
stats. So a hand-copied table grew a row the page does not have, under a name
the page does not use, and nothing could have caught it — there is no page to
diff a retyped table against. That is the whole reason values are imported
rather than typed, stated as a bug instead of as a principle.

**What stays, and it is most of the file.** `bashPlan` is the rule being
performed and does not change shape: that a bash is a Dungeonbashing throw; that
Strength scales it; that a pair heaves on the stronger adjustment and gains for
cooperating; that a crowbar helps and its help is additive; that size steps it
both ways; that the first spike is free and each one after costs; that a natural
1 hurts and that failure is never final; that battering asks time rather than a
throw, and that some constructions do not yield to an axe at all. Every one of
those is structure. Only the magnitudes leave.

**Rejected: ruling them structural because they are small.** Size is not the
test — the doctrine says so in as many words — and accepting it here would
accept it everywhere, since no shipped constant is ever large. Also rejected:
leaving them because they have shipped for several releases. A leak's age is not
a licence; it is the reason to stop adding to it, which is why
`BASH_STR_FACTOR` was named rather than copied a third time earlier today.

**The migration is two steps, and the importer goes first.** Extras cannot
switch to the registry before a world can fill it: `lib/tables.mjs` ships no
SAMPLE layer by extraction-program ruling, so an extras-first change would take
door bashing away from every existing world until a recipe existed AND the GM
re-imported. Dependency half first (TOOLCHAIN §10e):

1. **acks-importer** gains an RR Ch.6 recipe. This is a trodden path, not new
   machinery: `def.vehicle.landTable` (p.136) and `def.vehicle.seaTable` (p.319)
   already extract labelled grids with `ac` and `shp` columns through the same
   `assists.grids` op, and the prose modifiers are the ordinary
   `from: {pattern}` shape the skills and powers registers use throughout. RR
   Ch.6 has no register file yet, so the page range is new; the extraction is
   not.
2. **extras** then reads a `doors` document through `getDoc` / `expectTables`,
   the way `classes/hitpoints.mjs` reads `hitPoints.firstLevel.dieMinimum` and
   every other formation table already arrives. `doors.mjs` is the outlier in
   its own feature — travel, weather, encounters, settlement, flight and
   foraging are all registered already.

**What a bookless world gets, stated now so step 2 does not have to decide it
under pressure.** There is no arithmetic identity for a missing bash target the
way `1` is the identity for a missing hit-die floor, so the honest degradation
is a refusal, not a default: the door tools keep working for everything that is
structure — open, close, lock, spike, unspike, and the evil-door behaviour —
and bash and batter report that no door table has been imported. Falling back on
the target the module remembers would be reinstating the very value this ruling
removes.

Recorded as unbuilt work in [ROADMAP.md](ROADMAP.md). The same magnitudes appear
in that file's own prose; they go in the same pass, since `docs/` is tracked even
though it is not shipped.

### Strength on a Dungeonbashing throw has one owner (2026-08-30)

**Asked.** A throw can now declare an ability score it is written against
(abilities' `score` field). Should the importer put Strength ×4 on the
Adventuring proficiency's Dungeonbashing roll, and is the ×4 a general rule for
score-keyed throws?

**Resolved against the page.** RR Ch.1 states the factor exactly once, in the
Strength attribute entry, scoped to *all* Dungeonbashing throws; the
character-creation walkthrough repeats it. Every other attribute application in
that chapter is a plain modifier — attack, damage, saves, AC, initiative, hit
dice, reaction. So the multiplier is **not** a general rule for score-keyed
throws, and it is **not** a rule about the Adventuring proficiency: Appendix B
makes four more Dungeonbashing throws that entry never mentions (escaping a
grab, shoving forward while stuck, tearing free of webbing, and a condition
that penalises them).

**Ruled: the factor belongs to the THROW, and `doors.mjs` owns it.**
`BASH_STR_FACTOR` and `bashStrBonus()` are the definition; `bashPlan` and the
party sheet's bash column both read it. They did not — the column carried its
own `strTimes4: true` and multiplied by a second literal 4, reading
`system.scores.str.mod` inline against the standing rule that score reads go
through `lib/actor-read.mjs`. Two copies of one rule is a rule that drifts, and
nothing would have caught the drift.

**Rejected: a `times: 4` in the importer's Adventuring recipe.** It would state
a character-wide rule in one of the five places it applies and leave the other
four, and it would put a third copy of the number in the family — in the repo
whose whole purpose is that printed values arrive from the reader's own book.
The importer therefore emits no score term for this entry; what it would carry
is not the entry's rule. See [abilities/DECISIONS.md](../abilities/DECISIONS.md).

### 2026-08-24 — A trap is a wall PRESET, its marker is its control, and it gets no bucket

Three complaints about the same surface, and one shape answers all of them.

**The button dropped a wall.** The evidence is a field report six days after the
entry below shipped: pressing the tool still "drops a trap wall on the map".
That fix was real — the drag no longer lays a solid wall over the tripwire — and
it left the placement it was defending intact, which is the half the Judge was
complaining about. With nothing selected the trap tool created a
tripwire across the middle of the view and told the Judge to drag its ends into
place — a guess at where the trap goes, and almost never right. The 2026-08-18
entry below fixed a symptom of this (a wall-drawing tool left armed turned that
drag into a solid wall) without questioning the placement itself. Foundry's own
wall types are **presets** over the drawing tool, so a trap line is one too: the
tool stores the tripwire as `wallPalette` and hands over the wall tool, and the
Judge drags the line where it belongs. The pip core lights off `createData` says
it is still armed. Nothing is placed. `drawTrapWall` survives on the api, where a
macro has no cursor to draw with. **Rejected:** a one-shot `preCreateWall` hook
stamping the next wall — invisible state, and it forgets after one line, when
laying a row of tripwires is the actual job.

**Left and right click did nothing.** The marker was decoration —
`eventMode: "none"` — so the only way to arm, disarm or reveal a trap was the
api. It now takes core's door gestures, because a trap sits on a wall and the
door is the gesture already learned there: **left** toggles armed against safe,
**right** toggles `known`. They are kept independent on purpose — left never
touches `known` (a re-armed trap is still one the party knows about) and right
never touches the state (an armed trap the party can see is a combination
`attemptRearm` has always written). `markTrapFound` stays the other act: the
party DISCOVERED it, which moves the state as well. Left-clicking a SPENT trap
routes to `resetTrap` rather than a bare re-arm — re-arming a discharged
mechanism means rebuilding it, and the throws anybody failed against the old one
must not carry over.

**Interactivity is gated on the control, and that gate is why the gestures are
safe.** Markers answer the mouse only for a GM on the Walls or Regions control —
where every other placeable in Foundry answers only on its own layer. Door
controls are the exception because players use them mid-play; a trap is a Judge's
editing surface, and one that answered a click on the Token layer would disarm
itself under a mis-aimed drag.

**Traps get no scene-control bucket, though they bridge walls and regions.**
Leaving a placeables layer calls `releaseAll()`, so a Traps control would empty
the wall selection at the instant it opened — and a selected wall is what both
trap tools act on. Battlemap took its own group in 4.22.0 and was right to:
nothing it does reads a selection. **Rejected:** a Traps `InteractionLayer`
hosting the markers; it would have had to re-implement wall selection to get back
what opening it destroyed.

**Found while verifying the rebuild gesture:** `resetTrap` never cleared either
ledger. A flag write is a merge, so `{repeatLock: {}}` merged into the full
ledger and left every entry standing — a thief who had failed hastily against a
trap still could not try again after the Judge rebuilt it, and the same held for
the region behavior's `system.repeatLock`. Both writes now merge in code and
write a `ForcedReplacement`. The cost: a key no reader knows about is dropped on
the next write, which is why `wallTrap()` reads the legacy `restore` key rather
than only tolerating it.

---

### 2026-08-18 — The trap tool hands back the SELECT tool after it draws

**Superseded in part, 2026-08-24:** the tool no longer draws anything, so there
is no select-tool handover on that path. The double-fire fix and the rejection
below both stand, and `drawTrapWall` still hands back the select tool for the
api's callers.

A `button: true` scene-control tool does not change which tool is active, so a
Judge who has been drawing walls presses the trap button with the wall-drawing
tool still armed. The tool draws its non-blocking tripwire and tells them to
"drag its ends into place" — and the drag draws **a new, fully blocking wall**
over it, which is what "the trap tool drops a solid wall" turns out to mean.
Reproduced live before the fix: `activate({tool:"wall"})`, press the button, and
the active tool is still `wall`.

The instruction was true of nothing, so the tool now makes it true. **Rejected:**
changing the wall's own restrictions when a trap is laid on it — the ruling that
a trap never alters the wall it rides on is what lets a trap go on a door, and
the wall the party saw was one the Judge drew themselves.

Also fixed in the same press: v13+ calls **both** `onChange` and `onClick` on a
button tool, so every press ran twice and the line tool laid two tripwires on
identical coordinates. One handler per tool now, here and on the door tool.

---

### 2026-08-18 — A trap has a hidden stage, and `known` is what carries it

Markers were gated on `game.user.isGM`, which is a gate on WHO IS LOOKING and
not on what the party has learned. That is right while a trap is a secret and
wrong the moment it stops being one: a party that spotted a tripwire, or set it
off, or disarmed it, can see where it is, and a target they cannot see is a
target they cannot choose in the Trapbreaking dialog.

So a placement carries `known`, and the marker is drawn for a Judge always and
for everybody else only when `known`. **`known` is stored, not derived from the
state** — a trap the party found, disarmed and then re-armed reads `armed` again
and is still known, while one the Judge rebuilt reads `armed` and is a fresh
secret. Deriving it would make the party forget a trap by re-arming it.

Trap AREAS are now created `visibility: GAMEMASTER`. Foundry gives players the
Regions scene control, and the default `LAYER_UNLOCKED` renders a region to
anyone who opens that layer.

---

### 2026-08-18 — The automatic search sweeps everything in reach, at RAW's reach

The automatic hasty search only ever ran against the trap the party was walking
into. RAW is wider and narrower at once: **wider**, because a thief moving at
exploration speed throws against any hidden feature he passes within 5' of (10'
with a pole), which includes the pit beside the corridor; **narrower**, because
that is a reach in feet and not "whatever the party can see".

The request that prompted this asked for vision range. RAW is what shipped, and
the difference is not cosmetic — a lit corridor is 30' of vision, which would
find six times as much ground per step as the book allows. The reaches are
expressed as `FEET_PER_RANK` and twice it rather than as printed distances,
because that is what they are: the square a rank occupies, and the pole's extra
one.

Two consequences that had to come with it. The sweep measures against the
SEGMENT the party walked, not its destination — a corridor crossed at speed
passes within 5' of things it never stops beside. And each searcher gets **one
throw per trap per level**, on the book's own note that the automatic throw
counts as a failure to hastily search: without the ledger a party finds every
trap in the dungeon by walking back and forth over it.

The sweep is **silent**. It whispers only when something is spotted; a failed
throw against a trap the party never touched posts nothing, which is what makes
it usable on every step. Failed throws against a trap the party DID walk into
still appear, in that trap's own card.

---

### 2026-08-18 — Trapbreaking picks its target, and refuses an unfound trap

`attemptDisarm` used to work on whatever was nearest. A party halted in a
corridor can be standing at more than one trap, and the thief who found the
tripwire has no business having their hands moved onto the pressure plate beside
it. The dialog asks.

It also refuses a trap nobody has found (`refuse.notFound`), which the old code
allowed. Two reasons and the second is the load-bearing one: RAW has adventurers
find traps by searching or by setting them off, and only then disable them; and a
target list that offered an unfound trap would ANNOUNCE it, which is the one
thing a hidden feature exists to prevent. A Judge who narrated a discovery some
other way marks it spotted from the same dialog.

**Open to players**, on the party sheet, whenever one of their characters could
make the throw at all — which per RAW includes a non-thief going at it
methodically through Adventuring, so the button is not gated on the skill. The
throw itself runs on the Judge's client like every other player declaration.

**Known wrinkle, not yet solved:** the book gives the disarm-or-discharge choice
to whoever made the throw, and because the throw runs GM-side the dialog asks the
JUDGE even when a player declared it. Recorded in ROADMAP.md rather than papered
over with a second socket round-trip.

---

### Save keys track the RELEASED system, never the dev branch

`breath` is correct for acks 14.0.1: a fresh character's schema is
`[paralysis, death, breath, implements, spell, wand]`, and `ACKS.saves.blast.long`
does not exist. The system's dev branch renames `breath` → `blast`.

**Flip the key when that lands in a system RELEASE, not before.** The modules
target the released system and the test world runs it, so tracking the dev branch
would break every world that is not running it.

---

### A party actor holds almost no data

The formation record holds the state; the party actor exists so the party can
have a token. Its schema is the compatibility stub every non-character sub-type
needs, so the acks system's unguarded per-actor compute (`isNew`, `thac0`,
initiative, movement, `saves.implements|wand`) does not error on it. That stub has
one home: the lib subsystem's `acksCompatStubs()`.

**A party does not save; its members do.** The six saves the party actor used to
carry were never read — `rollPartySave` reads each member's own — so folding to
the canonical stub drops them.

Movement is re-declared for two party-specific reasons the shared stub cannot
carry: `base` defaults to a human's 120 (synced from members on the first
formation sync), where the stub's 0 is right for a settlement; and `value` holds
the "N'/turn (exploration)" label. `mod` is deliberately absent — the system only
reads it in `_calculateMovement`, which bails on `type !== "character"`.

---

### Every sync step is fault-isolated

The scene sync steps run in sequence, and one used to be able to abort the whole
sweep: a throw in the FIRST step (token light) meant ownership, token size, fog,
measurement and map sessions never synced at all. The caller only logs, so the
table just saw the map go dark with no error surfaced.

A failing step must cost only itself.

---

### Phantom records are pruned before anything else

A formation whose party actor has been deleted from the sidebar used to leave a
record behind, which the next "Add to party" silently re-adopted — resurrecting
the deleted actor with its stale members. Dead records are now dropped first, at
ready on the primary GM, before environments are synced.

A fresh formation (a hand-created Party Formation actor with no token placed yet)
is still adopted rather than spawning a duplicate — but only while its actor
exists.

---

### Party rolls post one GM card, not per-member public cards

A party check resolves every member, which as public per-member cards is a wall
of chat nobody reads. One compact GM-whispered card carries the whole result.
The GM can overturn what the automation decided, so the card has to be theirs.

---

### The ladders come from the GM's own book (2026-07-19)

This feature ships no skill ladder. Every number resolves from the world's
imported copy of a skill, by way of acks-importer:

1. an explicit `thiefSkill` flag names the skill to scale as — the GM's binding,
   so it is consulted first;
2. otherwise the ladder the item itself carries, resolved at the owner's factored
   level, which covers every imported skill with no setup;
3. otherwise the item's cookbook identity names its skill, so a copy tagged by
   hand still borrows the real one.

Anything else returns null and the caller falls back to the sheet's roll target.

**Attunement to Nature is +4 with Listening, not +2** — verified against JJ p.311
and authored into the acks-importer register on 2026-07-19. It is deliberately not
an alias of Alertness precisely because the value differs.

A binding the world can no longer resolve still lists itself, so the GM sees
their own choice rather than a silently blank select.

- **2026-08-03 — A detached member is leashed to one round, not given its own
  clock.** Sending a scout out raises "whose movement spends dungeon turns?".
  Rejected: measuring the furthest mover each tick, and summing every
  detachment's movement — both rework the turn engine, and both let a scout
  range far enough that the party's position becomes a fiction. Ruled instead
  that a detached member may not get more than one round's movement from where
  they stood when the party token last moved. The party token stays the sole
  clock driver (`onPartyTokenMoved` is untouched), because a scout can never
  get more than a tenth of a turn ahead.
  - Implemented as a DISTANCE from an anchor rather than a spent budget:
    stateless per move, evaluable on any client, and pacing inside the circle
    costs nothing because it gains nothing. Party movement re-anchors everyone
    detached — that reset *is* "caught up or passed".
  - Enforced for players, warn-only for GMs, matching the module's existing
    trust model. Combat clears `detached` outright so a fight is never leashed.
  - Deploy/recall were extracted from `combat-bridge.mjs` into
    `deployment.mjs` so the combat path and the detach path cannot drift; the
    two identical `announce` copies (combat-bridge, map-items) collapsed into
    `announce.mjs` at the same time rather than becoming three.

- **2026-08-03 — Judge actions supply gear instead of refusing it.** The gear and
  free-hand gates on lighting a source were written against a player claiming a
  torch they never bought. Applied to a GM they inverted: assigning the light was
  the Judge *changing* the fact the gate was quoting back at them. Ruled that a
  GM action carries an **override** — the gear appears, a hand is emptied, and
  the action proceeds — while a player declaration stays gated exactly as before.
  - Authority is the **declaring** user's, never the executing client's. Player
    declarations are relayed to and run on a GM client, so `game.user.isGM` there
    would have handed the override to the whole table.
  - The override never blocks. Where it cannot finish (no such item in the world,
    or hands full of lit torches that sheathing cannot free) it warns and lets
    the action through. Rejected: falling back to the old refusal, which is a
    Judge being told "no" in a smaller voice.
  - The two mutations live in the equipment feature (`grantGear`, `clearHands`) because
    both are equipment facts; this feature keeps only the rule about what a
    light or a role *needs*. Missing the equipment feature supplies nothing
    rather than throwing.

- **2026-08-03 — The mapper's kit is quill and parchment, one hand each.** RR
  p. 266 requires the mapper to have "both hands occupied" without naming what
  occupies them. Ruled the kit is a quill and parchment, and that the hand cost
  DERIVES from the kit list (`ROLE_HAND_COST` = number of pieces) rather than
  being a second constant that can disagree with it.
  - The RAW equipment list prices the quill and no writing surface, so
    **parchment is a stand-in at 1 gp / 0 stone**, matching the quill's price
    point. It is used only when the world has no item of that name to copy — a
    Judge who adds a real one gets theirs. This is the one invented figure in the
    feature and it is deliberately trivial; nothing mechanical reads it.
  - Rejected: shipping parchment in a module pack. The system already ships the
    quill, and a stand-in that only materialises when nothing better exists costs
    no pack, no `module.json` entry, and no rebuild.
  - The 10' pole's implement moved into the same `ROLE_GEAR` table, so the pole
    gate, the mapper gate, the standing warnings and the override all read one
    list. `hasPoleItem` and the two pole-specific messages went with it.

- **2026-08-03 — "Room for one more thing" is not "hands free".** `clearHands`
  first appeared to strip a fighter bare: sheathing the shield freed a hand, the
  lone sword immediately widened to a two-handed grip to fill it, and the loop
  saw no progress. A two-handed grip is ELECTIVE — it yields the moment a torch
  or a map needs the hand — so it commits nothing. Added `handsCommitted` /
  `handsSpare` alongside `handsFree`, and every "can they take up one more
  object?" test now reads `handsSpare` (`spareHands`).
  - This also fixed a standing false refusal: a swordsman with an empty off hand
    read as having no free hand and could not light a torch at all.

- **2026-08-03 — Two shipped matcher bugs, found while extending them.**
  Recorded because both had passed a green offline suite:
  - `POLE_ITEM_PATTERN` held literal **backspace bytes** where `\b` word
    boundaries were meant (`/\x08pole\x08|polearm|…/`), committed that way, so
    the 10' Pole role never recognised an item named "Pole" — only a polearm,
    spear, pike, halberd, glaive or lance.
  - A lantern's fuel pattern excluded military oil with a lookbehind
    (`(?<!military\s)\boil\b`), which cannot work: the RAW item is named "Oil,
    Military (1 pint)", with `oil` FIRST. A party's thrown-weapon oil read as
    lamp fuel and would have been burnt. Now the whole name is rejected when it
    mentions military.

---

**2026-08-11 — a missing i18n key ships as the identifier, shielded by its own
`Hint`.**

`ACKS-FORMATION.app.frontage` was absent from `lang/en.json`, so the marching
order's Frontage field was labelled `ACKS-FORMATION.APP.FRONTAGE` on screen. Its
`frontageHint` sat directly beside it in the file and was present, which is what
made the gap survive at the table: the tooltip worked, so the field behaved
correctly in every way except the one a reader sees first. Found while shooting
the v3.7.0 release snapshot — the frame is what surfaced it, not the code.

**CORRECTED 2026-08-11, same day.** This entry first said `validate` does not
check that a referenced key exists. That is wrong, and the correction matters
because the sibling `Hint` is not incidental — it is the mechanism.

`tools/validate.mjs:350` **does** fail on `missing key referenced in code`. Line
349 tolerates dynamic families, where code builds `PREFIX.${value}` and only the
prefix can be captured:

```js
if (langKeys.some((k) => k.startsWith(key))) continue;
```

It cannot tell that prefix from an exact literal reference, so a literal
`localize("…app.frontage")` passes as long as *any* defined key starts with it —
and `…app.frontageHint` did. Confirmed by experiment: delete `…app.frontage`
alone and `validate` passes clean; delete `…app.frontageHint` too and it fails on
**both**. The reference was scanned correctly all along; only the tolerance was
wrong.

**217 of 2279 keys (9.5%) are strict prefixes of a longer sibling**, so this is
not a one-off. The `foo` / `fooHint` pairing this family writes labels in makes it
systematic, and `foo` — the visible label — is always the shielded one.

Closing it belongs in `tools/validate.mjs`, which is **synced from
acks-module-template and never hand-edited here** — so the fix is recorded in
[ROADMAP.md](ROADMAP.md) rather than made in this repo. Two hits in a one-off
scan were genuine non-problems and should stay excluded: prefix roots Foundry
expands itself (`LOCALIZATION_PREFIXES` on the encounter-zone data model, the
henchmen location sheet's `labelPrefix`).

---

### 2026-08-15 — A marching block's heading is the token's rotation, and south is zero

`formationOffset` laid every block out to the right and down, so the column
trailed south-east whichever way the party was walking. The fix rotates the
offsets, and the heading comes from the party token's `rotation` rather than a
new field on the formation record: core writes that field itself on every drag
and keyboard step (`tokenAutoRotate`, default on), so it already answers the
question, and a stored copy would immediately disagree with it.

Rejected: storing a `heading` on the formation and offering a compass control.
It buys a party that faces one way while its token faces another, and a second
thing to keep in sync for no rule that asks for one.

**What it cost.** Foundry's rotation is zero at *south*, so the default heading
is south — not the north the old right-and-down layout implicitly assumed. A
party whose token has never been turned now deploys its column upward rather
than downward. Taking north as the default instead was rejected: it would mean a
token reading `rotation: 0` and a formation with no token on a scene at all
disagreeing about where the block goes, and zero is the only value both can be
read from. Marching north is otherwise unchanged — it reproduces the historic
offsets exactly, which `tools/test-formation-heading.mjs` pins.

Diagonal rotations snap to the nearest cardinal. The grid has four directions to
lay a rank against, and a half-square diagonal block would need the offsets to
stop being whole numbers to buy nothing.

---

### 2026-08-15 — A saved marching order restores an arrangement, not a roster

Saved orders record order, roles and frontage and nothing else. Rejected:
capturing member records wholesale (token snapshots, lights, the clock). That
would make "load the standing order" a way to resurrect a dead man's hit points
from a week-old save, and the failure would be silent.

Three reconciliation rulings, all forced by the fact that the party an order is
applied to is never the party it was saved from:

- **A named member who has left is dropped and the line closes up**, rather than
  leaving a blank in their square. Preserving the geometry was the alternative
  and it is defensible — the fighter really was front-left — but it marches the
  party with phantom gaps nobody asked for and which the Judge then has to clear
  by hand. The count is reported instead, so the absence is stated rather than
  implied.
- **A member the order never knew about is appended, keeping their current
  roles.** An arrangement that silently discharged the henchman hired since it
  was saved would be a roster edit disguised as a layout.
- **A role is refused when its gear is gone**, on `toggleRole`'s own rule.
  Restoring a mapper who has lost their quill would write a state the feature's
  own rules call impossible, and it would be written by a path that never asked.

Named **marching order**, not template: `lib/template-logic.mjs` already owns
"template" for the Monster Manual's stat-by-rank pages, and one vocabulary per
concept is cheaper than telling two apart forever.

**What it cost.** Forming up is refused during a combat, so a Judge who wants
the party gathered mid-fight must end the combat first — the same refusal
`toggleDetachMember` already makes, and for the same reason: recalling a fighter
would take them out of the initiative they are in.

---

### 2026-08-15 — Jumping is a distance, not a throw, so it is not an obstacle

Checked against the wiki snapshot (ch. 6, *Jumping and Leaping*) before deciding
where it belonged. Every row of `OBSTACLES` carries an Adventuring target, a
per-100' cadence, a failure cost, a botch row and a vulnerable-in-combat flag.
Jumping has none of the five. Crossing a chasm is not rolled for at all: the
jumper has a distance (DEX + 1d6, less a foot per stone, halved without a 20'
run-up), the gap has a width, and if the number reaches, an ordinary jump onto
solid ground is simply made.

Adding it to the table would have meant six null columns and a primary output —
a distance rather than a target number — that no other row produces. So it is
its own derivation beside `swimming.mjs`, on that file's precedent.

Rejected: rolling the 1d6 and reporting one distance. The die is inside the
distance, so a single roll answers "could he have made it" for one attempt and
tells a Judge nothing about whether to allow the attempt. `canClear` reports the
range and how many of the six faces clear the gap, which is the question actually
being asked at the table.

Rejected: prompting for a saving throw on every jump. RAW the landing save is
owed only for a precarious destination or a jump made charging into melee, and
asking for one otherwise would invent a check the rules do not have.

**What it cost.** Two readings had to be fixed where the text is silent, and
both are marked in the code. The printed 1' minimum attaches to the leap's base
formula, so encumbrance can take a character below it — but the result is
clamped at zero, because a negative maximum jump is arithmetic left over rather
than a measurement. And the creature multiplier (running speed / 120) is applied
last, after encumbrance and the standing-jump halving; the book's only worked
example, the medium horse, carries nothing and so does not disambiguate the
order. That example is pinned in `tools/test-jumping.mjs`.

---

### 2026-08-15 — Jumping holds no printed value that already has an owner

Amends the entry above, which shipped with two tables it had no business
holding: the attribute bonus bands (including the jumping rule's own extension
to 19–24) and the Acrobatics numbers (a cap of 24, +2 on the landing save).

Both are book content, and both already have an owner. The attribute modifier is
the SYSTEM's — every sheet carries it as `system.scores.dex.mod` — so
`dexModifier` reads it and a caller holding a seat's imported extended rows
passes what they say. What Acrobatics is worth is the PROFICIENCY's, arriving
with the character's own imported ability, so `effectiveDex` takes a `dexCap`
and `landingSave` takes a `saveBonus`. `NO_ACROBATICS` is what an unimported
proficiency contributes: nothing, rather than a guess.

This is the same ruling the thief skill ladders got when they left
`constants.mjs` for the GM's own book. Jumping knows the SHAPE of the rules —
that a proficiency raises the score, that a cap exists, that the landing is a
Paralysis save — because that shape is the jumping rule itself. It does not know
the numbers.

**What it cost.** A world whose Acrobatics was never imported now applies no cap
and no save bonus, so an acrobat's score can exceed what the book allows. That is
the right failure: a ceiling invented here would be a printed number with no book
behind it, and it would silently shorten every acrobat's jump in worlds that
never asked for it.

One bug fell out of the change and is worth naming, because the shape recurs
across this repo's option bags: `Number(null)` is **zero, not NaN**, so a plain
`Number.isFinite` test reads every absent option as a supplied zero — capping an
uncapped score at 0 and answering every modifier with 0. `given()` distinguishes
"not supplied" from "supplied as zero"; both are meaningful here and they are
not the same.

### 2026-08-15 — The marching-order API is guarded at the boundary, not renamed

The 4.8.0 release session reached this API from macros and got it wrong four
times: `saveTemplate`'s arguments reversed, an id handed to `applyTemplate`
where it wanted the order object, and its persistence assumed to be a dry run.
Every one of those looked like a module bug from the outside and none of them
was. An API misused four times by someone who had just written it is not a
documentation problem.

**Ruled:** the boundary guards itself. The applying calls take an order or its
id interchangeably, because both are things a caller legitimately holds and
converting between them was pure ceremony. A reversed pair is detected on the
SECOND argument looking like a formation — one rule that catches
`saveTemplate(name, formation)` and `applyTemplate(order, formation)` alike —
and says so in those words. Everything that writes says it writes, in its own
docstring, next to the signature the caller is reading.

**Rejected: the options bag.** `{formation, template}` would have made every
mistake impossible instead of merely loud, but it breaks every macro written
against 4.8.0 to fix a problem that only the module's own author has hit. A
fix-driven release is the wrong place to spend a world's macros.

**Rejected for now: the rename.** The deeper cause is the word. This file's own
header already concedes that *template* belongs to the Monster Manual generator
and says the feature is called a marching order — but the exported symbols were
never moved, and `applyTemplate` is ALSO a chargen export
(`scripts/classes/chargen.mjs`) taking `(actor, classItem, template)`. Two
same-named exports with different signatures in one module family is most of
why the second misuse happened at all. `saveMarchingOrder` / `applyMarchingOrder`
is the real repair, and it is a deprecation cycle, not a guard: it belongs to a
release that is allowed to move names, not to one whose bump was earned by a
trap behaviour. Left open on the roadmap rather than half-done here.

**What it cost.** The guards throw where the old code silently half-worked, so a
macro that was quietly saving empty orders now fails loudly on the next run.
That is the intent — but it is a behaviour change for anyone whose broken macro
had gone unnoticed, which is exactly the population that cannot know to look.

### 2026-08-15 — A trap is a document; the region and the wall only place it

Trap Zones needed somewhere to keep what a trap IS. The obvious place was the
region behavior, and that was wrong twice over: the Judge's book prints eleven
worked traps at six levels each, and those numbers are book content with an
owner — they reach a world through `acks-importer`, from the GM's own copy,
exactly as the thief ladders and the Spelunking table do. A behavior schema is
not something an importer can materialize into, and a trap typed into a region
cannot be used in a second corridor without being typed again.

**Ruled:** a trap is an Item sub-type (`acks-extras.trap`) carrying the
definition, and a placement — a region behavior or a wall's trap layer — carries
a reference to one plus the state of that particular burial. The definition is
shared; being armed, spotted or spent belongs to the place, not to the idea of a
scything blade. Hand creation is a first-class path and not a fallback: nothing
requires the importer to have run.

**What the module knows and does not.** It knows the SHAPE of §7 — that a trap
resolves as a saving throw, an attack throw or damage with no throw; that a
crude one is +4 to find and remove, attacks at -2 and is saved against at +2;
that a pit deals a die per ten feet and its spikes 1d4 at 1d6 each; that the
trigger is 1d6 and the band is adjustable. It holds none of the eleven traps,
none of their damage by level, and no fighter attack progression — `attackThrow`
stores the number the Judge read in their own book rather than deriving it from
a level. Same ruling the ladders got.

**A RAW correction this turned up.** The row this closes called for "Trapfinding
/ Trapbreaking throws". Trapfinding is not a throw: it is a proficiency worth +2
on Searching *and* Trapbreaking (RR p. 121), and `party-rolls.mjs` already
applied it. The finding throw is the hasty Search the party already had. Nothing
new was needed on the finding side at all — only wiring it in ahead of the
trigger, which is the order the sequence of play gives (§9.3: searchers first,
then the pole, then the party).

**What it cost.** A world upgrading gains an Item sub-type, which Foundry will
not create until the world is relaunched after the manifest changes. A Judge who
adds the module mid-session and immediately tries to make a trap gets a failure
that looks like a bug and is not.

### 2026-08-15 — A trap wall blocks nothing and stops the party anyway

A trap laid along a wall could have been made a barrier — set the wall's
movement restriction and let core stop the token. Rejected: a tripwire is not a
wall, and a party that has already dealt with the trap would still be walking
into an invisible obstruction. Worse, it would change what the wall does for
every other purpose, and the most useful place to put a trap is a door that has
to go on working as a door.

**Ruled:** the trap layer restricts nothing — movement, sight and sound pass as
before — and the halt is applied on DETECTION instead. The crossing point is
computed from the party's path, and the party is placed there when the trap
springs or is spotted. That also fixes the thing a barrier could never do:
without it, the party is told about a tripwire three squares after stepping over
it, because the movement hook fires on arrival.

**A consequence worth naming:** a trap wall is invisible to the party in every
sense, so the Judge needs to see it. The markers follow the secret door — the
player's client draws nothing at all, and the Judge's shows the state.

### 2026-08-15 — A trap reports its damage; the Judge writes it

Once the firing model learned what beating the throw was worth, the reason for
not applying damage had to be re-examined: the module now knows exactly what
each victim took, so "we cannot tell" had stopped being true. It was never the
real reason anyway — the honest one was that `firingPlan` had no field for the
success effect, which is now fixed.

**Ruled: still reported, not applied.** Two reasons, and the second is the one
that decides it.

The precedent. Nothing in this family writes damage to a sheet. `bashDoor`
returns `damage: 1` on a botch and leaves the point to a human; the party's
saves and the obstacle helper's falls do the same. A card that sometimes writes
hit points and sometimes does not is worse than one that never does, because a
Judge then has to remember which surfaces are which before deciding whether to
undo anything.

**The riders.** A trap's damage is frequently not the whole of what it does —
knocked prone, restrained and hoisted, stuck in a portcullis, burning, or a roll
on a Mortal Wounds table. Those are prose the module deliberately does not
model, and it prints them for the Judge. Applying the number while leaving the
rider unapplied produces a half-resolved trap that LOOKS finished: the hit
points moved, so the eye reads it as handled, and the condition the trap was
really about is the part that gets forgotten. Reporting both together keeps one
reader responsible for the whole outcome.

**What it costs.** Every trap that goes off is a small piece of manual work, and
in a corridor full of them that adds up. The alternative was worse in a way that
is hard to notice, which is the kind of worse this family avoids.

**Rejected: applying damage and printing the rider as a reminder.** That is the
half-resolved state above with a note attached, and a note beside a completed
action is read as flavour.

---

### 2026-08-16 — A trap is one document at six levels, not six documents

**Problem.** `TrapData` described a trap at ONE level: a single `level` beside a
single `damageFormula`, `saveKey`, `attackThrow`. The Judge's book prints each
of its thirteen traps at all six, so a Judge who used a scything blade at 1st
level and wanted it at 4th kept two documents of the same trap, in step by hand.
It also left the importer with no shape to materialize into — thirteen documents
or seventy-eight, and nothing in the model said which.

**Ruled: one document, six rows.** A scything blade is one trap. What changes
with its level is what it *does*, not what it *is* — the trigger, the build and
the name are identical at 1st and 6th — so the per-level fields moved onto a
`levels` array and `level` stopped being a fact about the trap and became the
row in force. `tier` reads it, never an index, so a short or hand-built array
answers with a whole row instead of throwing halfway through resolving a trap
that has already gone off.

**What stayed on the trap.** `trigger` and `triggerOn`, `crude` (it describes
the BUILD, not the level), `scope`, and the description. `radiusFeet` went to the
row, because the books do vary it — the same trap prints a 30' path at one level
and 45' at another.

**Rejected: seventy-eight documents**, one per trap per level. It is the same
content filed so that thirteen edits become seventy-eight, and it makes "the
scything blade" un-nameable — a Judge would pick from a list of six near-identical
entries every time they placed one.

**Cost: the sheet shows one level at a time.** Six full forms stacked would bury
the four fields that describe the trap itself, so the level selector chooses
which row is edited AND which one fires. Those are the same question — the Judge
is looking at the trap as it stands in this dungeon — but it does mean a level's
values are only visible when selected. A strip of the six numerals marks which
rows have anything in them, so an imported trap does not read as empty when the
row on screen is one the book left blank.

## 2026-08-18 — Unit Morale is RR 468, and the commander modifier belongs only to it

The morale table this feature would own at mass-combat scale is Unit Morale
(RR 468 — Rout/Flee/Waver/Stand Firm/Rally), and the RR 436 commander
modifier applies to that table alone. The three-subsystem split and the
conflation trap are ruled once in `docs/influence/DECISIONS.md` ("Three
morale subsystems, never conflated"); mass-combat resolution itself is out of
scope entirely (root `docs/DECISIONS.md`, Battles VTT ruling).

## 2026-08-19 — The party token wears the formation's face

**Ruled:** `syncPartyTokenSize` sizes the party token to the formation's real
shape — `faceWidthFeet` across the line of march, ranks × 5' deep, through
`scene.grid.distance`, axes swapped on an east/west heading. This supersedes
the code-level "always 1×1" rule (it was a docstring on `scene-sync.mjs`,
never an entry here). What changed: the battlemap feature makes
`grid.distance` truthful on calibrated scenes, so the token's width becomes
information — the party's actual face — instead of navigation fuss. The fuss
the 1×1 rule guarded against (a wide token wedged in a tight corridor) is now
the squeeze mechanic's job, ROADMAP §3 until built; until then a Judge who
wants the old behaviour sets frontage 1 or widens the corridor.

**Ruled:** the per-body march width is a world setting (`marchFeetPerBody`,
default 3) rather than a constant. Unlike `FEET_PER_RANK` (the combat square
itself), it is *derived from* RR Ch.6's corridor thresholds — ≤5' single
file, ≥6' two abreast — and a Judge legitimately varies it (shield wall vs
loose order). **Reviewer flag (ip-doctrine value rule):** the default is
page-derived; a human ruled that a Judge-editable parameter whose default
falls out of two printed thresholds is structure, not content. The hint text
states only what the field does.

**Rejected:** scaling only on coarse maps (a face is a face at every scale,
and two behaviours for one token is a support burden), and keeping 1×1 until
the squeeze ships (the token would lie about the party's reach on every
wilderness map in the meantime).

## 2026-08-20 — Environment sweeps coalesce, and a vanished target is not a fault

**Ruled:** `syncEnvironments()` never runs concurrently with itself. Every
write to the formations setting fires one unawaited (`onFormationsChanged`),
so a burst — dissolving a party and its members, or a bulk delete in the
sidebar — put several sweeps in flight at once, each holding documents the
others were invalidating. A request arriving mid-sweep now sets a repeat flag
and returns the sweep already running, which replays once at the end; a
caller still awaits a sweep that saw its own change.

**Ruled:** a sweep re-resolves its scene before every step rather than holding
one document across the awaits. The cleanup tail was the reported case, but
the `byScene` loop had the same defect one loop up — it resolved once and
awaited twice — which is why fixing only the tail moved the error to a
different step instead of removing it. Re-resolution is the rule for every
loop here, not a patch on the one that was reported.

**Ruled:** `step()` asks whether a failed step's TARGET still exists. Gone,
and it is logged at debug as skipped; alive, and it is an error with its
stack, as before. A write can be built against a document the client still
holds and refused by a server that has already deleted it — that race cannot
be closed from the client, and what the write was reconciling is moot anyway.
This does not weaken the fault-isolation rule above: a step whose target
survived still shouts.

**Rejected:** matching the error's wording. The client-side variant names the
collection ("Scene id … does not exist"), but the server-side one is a bare
`TypeError: Cannot read properties of undefined (reading 'id')` thrown inside
Foundry's own `Scene.getMany`, and a pattern broad enough to catch that would
eventually swallow a real defect. Asking about the target is exact where
reading the message can only approximate.

**Cost:** a deleted document's release is now skipped silently at debug rather
than reported. That is the intended trade — the alternative was a console full
of errors for a race that harms nothing — but it means a genuine failure that
also deletes its own target would go unseen. No such path exists today.

## 2026-08-20 — The ledger is read inside the lock, never before it

**Ruled:** `updateFormation` and `deleteFormationRecord` re-read the formations
setting INSIDE `enqueueSave`, as `patchFormation` already did. Reading before
the queue and writing after it means carrying a copy of every OTHER record as
it looked before waiting — so a record deleted while the write sat in the
queue was written back alive. Dissolving a party and its members back-to-back
left an orphan behind it that way, with dead members still on its roster.

The save chain was never the whole guarantee. It serializes the WRITES; it
cannot serialize a read that happened before the caller joined the queue. The
same discipline `.claude/rules/live-testing.md` states for shared ledgers —
re-read immediately before every write — applies to this module's own writers,
not only to sessions sharing the test world.

**Scope, stated plainly:** `updateFormation` still writes its record WHOLE, so
a concurrent change to THAT record is still overwritten. Re-reading fixes the
damage to everyone else's rows — **not** the orphaned record, which was this
record's own row being re-inserted after its delete (ruled separately below).
A background writer that must not lose a concurrent field change still uses
`patchFormation`, and the note on that function saying so stands.

**Rejected:** routing every writer through `patchFormation`. Its contract is a
mutate-in-place callback, and the foreground flows that own a whole record
(create, transfer, disband) would have to be rewritten to express themselves
as patches for a hazard they do not have — they hold the record because they
just built it.

## 2026-08-20 — A whole-record write is an update, never an insert

**New evidence**, amending the entry above the same day: re-reading inside the
lock did not stop the orphan. The live run measured it at 6 of 9 sequential
delete sequences and 2 of 2 bulk multi-select deletes, and the orphan's shape
named its author — `sceneId` and `tokenId` both null, roster intact, which is
written in exactly one place. It was never another row carried stale; it was
the record's OWN row re-inserted after its delete.

**Ruled:** `updateFormation` refuses a record the ledger no longer holds.
Every caller but one reaches it holding a record fetched earlier, and "it was
dissolved while I worked" makes that write moot rather than urgent — the same
judgement the sweep ruling made for a vanished scene. `createFormation` is the
only insert and mints the id it inserts under, so it writes directly.

**Ruled:** one private `commit(mutate)` is the only path to the setting, so
the lock and the read are a single act. The invariant recurred because two of
three writers omitted it; making it unforgettable is cheaper than writing it
down a third time.

**Ruled:** the `deleteToken` hook unlinks through `patchFormation`. It fires
from an incoming deletion, so its guard — is this still the record's token? —
has to be decided at write time; against a stale copy it would also revert a
token adopted meanwhile, along with the clock, lights and roster.

**Ruled:** `restoreMemberTokens` restores only members whose actor still
exists. Foundry creates the batch in one call and the system's own
`TokenDocument._preCreate` reads the token's actor, so one deleted member
aborted the restoration of every living one and lost their positions.

**Rejected — a tombstone of recently-deleted ids.** Ids come from `randomID()`
and are never reused, and the existence check runs in the same lock as the
delete, so there is no ABA to defend against. It would add an expiry policy
and a second source of truth about existence for no additional coverage.

**Rejected — reordering `dissolveFormation`, or another try/catch around the
restore.** The hook fires from an incoming socket message, not from dissolve's
call stack, so there is no ordering to impose; and the try/catch is already
there — dissolve deletes the record whether or not restoration threw. Fix the
input, not the blast radius.

**Rejected — `updateFormation` throwing or warning on a refusal.** Every
ordinary dissolve would print an error.

**Not fixed, so it is not mistaken for coverage:** two GM clients writing
concurrently. `commit` is a single-client lock reading that client's settings
cache, so two Judges on one world remain last-write-wins. Pre-existing and
unreported; `pruneFormations` remains the backstop for a record orphaned by a
crash mid-flow.


## 2026-08-28 — Travel state lives on the formation record, as a mode

**Ruled:** the overland MODE (`docs/formation/ROADMAP.md` item 7) is a
`travel` subtree on the formation record, mutated only through the ledger's
own `commit` lock — the same discipline as the roster, so GM writes and any
future player relays serialize identically. **Rejected:** scene flags (travel
is party-scoped and crosses scenes; a wilderness "scene" may not exist at
all); a second world setting (a parallel store re-invents the lock and the
socket relay, and can drift from the roster it describes); vehicle-sheet
state (per-sheet, unshared, and a party is not a vehicle). The subtree is
additive — `travelOf` answers for a record that never journeyed, no
migration.

**Ruled: two clocks, one running at a time.** Journey mode sets
`clock.paused` (the flag the turn engine already honours) so token movement
stops ticking dungeon turns, and the DAY becomes the unit: one day-kind
(dedicated march / forced march / camp) plus the four ancillary slots the
wilderness rules budget. A forced march CONSUMES the budget — every slot
becomes the road — and stepping back down returns a fresh budget rather than
resurrecting what the march overwrote. Returning to delve mode un-pauses
turns and holds the day board where it stood: a dungeon on the route does not
reset the march.

**Ruled: the party's speeds are compared on a common UNSCALED base.** The
travel panel applies the day's terrain/road/weather multiplier ONCE, to the
slowest base, at expedition time — `carrierSpeedFor` deliberately does not
feed the travel ground into a carrier's feet-per-turn, because scaling only
the carriers would bias the slowest-member comparison and double-count the
ground. The multiplier chain renders one factor per line (the door-helper
idiom), through the rules' own order: terrain, then road, then weather, then
pace.

**Ruled: the log is append-only, newest-first, capped.** Ending a day writes
the entry the panel was SHOWING (miles and hexes are passed in, never
re-derived by the engine, so the record cannot disagree with what the Judge
saw), then advances the world clock one day through the module's single
world-time switch. The cap (`travelLogCap`, a world setting) trims the
OLDEST days; it bounds the settings blob, never the journey. **Lost is
GM-only state**: the flag and the Judge's note live on the record and render
only on GM clients — the world-settings blob is technically client-readable,
which is the standing exposure every GM-ish fact in the formations setting
already accepts.

## 2026-08-28 — Weather: the sky's structure ships, its numbers do not

The daily generator extends the Path-B ruling to a fourth registered
document, `weather`. WHAT SHIPS: the three-throw procedure (temperature /
precipitation / wind at 2d6 each, one climate-and-season modifier apiece,
the day's temperature roll re-read at night under its own modifier, the
temperature COLUMN picked by the day modifier's sign), the combination
rules (freezing turns drizzle→flurry and rain→snow BEFORE still air is
consulted for mist and fog — the book orders them by listing freezing
first, so snow is never re-read as fog), the fronts drift (one step toward
yesterday, natural 2s and 12s standing), the band and condition KEY LISTS,
the Köppen climate codes (public science, not the book's expression), and
the footing state machine's transitions. WHAT IMPORTS: every band edge, the
climate×season modifier grid, every condition's speed factor
(`conditionSpeed`, cumulative per JJ ch. 2), and every accumulation
threshold (`accumulation`). The structural booleans that carry printed
lists (`mudProne` on grassland/scrubland; `freezing` on the two cold bands;
the rewrite mappings themselves) follow the `wheelsNeedRoad` precedent
(2026-08-27) — REVIEWER-FLAGGED: a gate cannot tell these from values, so a
reviewer holds the line.

**Two readings where the book is silent, both ours:** frozen mud THAWS back
to mud on the first non-freezing day (the book freezes mud and says no
more; leaving it frozen forever was the alternative and reads worse), and
snow-melt mud forms on ANY terrain (the melt paragraph says "creating mud
(as above)" without restating the grassland/scrubland gate; a swamp of
melt-water muds regardless of what rain would do). A day that CREATES mud
does not also count as its first drying day.

**The manual raining/snowing checkboxes retired** in favour of the three
band selects — the band keys are structural, so hand-picking needs no
import, and the old booleans still read from existing records (travelOf
keeps them; the rainy/snowy BANDS now feed the same road-washout
vocabulary). Rejected: a second "weather on/off" setting (the `auto` flag
on the record already gates generation per formation); weather state
anywhere but the travel subtree (same alternatives, same rejection as
2026-08-27's travel ruling).

## 2026-08-28 — Encounters: the chain ships, the tables import, surprise stays core's

The wilderness chain extends Path B to a fifth document, `encounters`.
WHAT SHIPS: the chain's order (territory throw, then the civilized draw or
the rarity-then-monster draws or a terrain-encounter d12), the
column-selection mapping (each printed column serves a roaded territory
and the next-wilder unroaded one; night in settled country shifts right;
Column Shift walks right and re-rolls, clamped at the wall), the
resting/known-route stand-down, the terrain-pick vocabulary with its
structural flags and mappings (`closed` country sheltering evasion from
flyers, `civilized` column groups, per-pick monster/distance/evasion keys,
coarse-ground defaults — the wheelsNeedRoad precedent again,
REVIEWER-FLAGGED like its siblings), the
distance-vs-visibility detection procedure (own terrain per side, longer
roll detects, caps hide), the evasion MODIFIER vocabulary, and the
aftermath shape. WHAT IMPORTS: every d20/d100 band, every creature name,
every distance die and multiplier, the visibility figures and the
head-count ladder, every evasion target and modifier size, and the
terrain-encounter lists.

**Surprise is not re-derived.** Core ships the whole Surprise Matrix — the
LUT (evade permission included), the rolls, the surprised status — inside
its combat start, and the lib already patches its PRESENTATION
(surprise-card). The card therefore hands off: it states the detection
facts the chain produced and names the system's matrix as where they
resolve. Duplicating the matrix here would invent what the system
provides and drift the first time core corrected a cell.

**The terrain picks are a UNION, not one printed list.** The book keys its
encounter tables at three different grains — eighteen monster sub-tables
split by weather biome (tundra barrens, three mountain skies, two rivers,
one swamp), seventeen distance/evasion rows split by cover (three swamps,
no rivers), eight civilized column groups — so no single printed list can
key the engine. The pick vocabulary is their union (twenty-three), each
pick carrying its key into every grain, null where the book prints no row
(a river's distance and evasion hand back to the Judge). Rejected: keying
on the monster grain alone (loses the three swamp evasion rows) and on
the distance grain alone (loses savanna, tundra, the mountain biomes and
both rivers entirely).

**Two judgments, both ours:** a resting-night frequency counted in nights
("once per N nights") gates its single throw on a die of N sides rather
than tracking a nights counter across days — the book itself randomizes
WHEN within a period an encounter falls, and a counter would be state the
record does not otherwise need; and the desert-and-jungle river pick maps
its civilized draws to the savanna/jungle-river column group (one pick
cannot serve two groups; a desert river's civilized nuance is reachable by
overriding to a desert pick).

## 2026-08-29 — Lost: the players hold the reckoning, and strict RAW governs the return

Ruled after the land-travel audit found the navigation throw entirely absent
(`gettingLost` imported, declared, read by nothing).

**The players' token is what the party BELIEVES.** While lost it stands at the
hex the party thinks it holds, and the true position is a Judge-only marker.
The party token never stops being the truth internally, so terrain lookup,
encounter frequency and the weather's climate keep reading exactly what they
read today; the deception is a visibility swap plus a second, player-facing
marker. The alternative — one token, Judge narrates — was rejected because the
players read their real position off the screen every morning and the rule
becomes an annotation.

**A successful throw does not restore position.** Strict RAW: it tells the
party it is lost and lets it resume the heading it meant, from wherever it
actually stands. It does not reveal where it strayed, and there is no kind
house-rule setting — the strict reading ships alone until someone asks.

**Fog is faked, then frozen back.** While astray, exploration reveals around
the BELIEVED position — the players are drawing a wrong map, and that is the
experience. On the throw that reveals the party is lost, the faked reveal is
rolled back to the last position known to be true and the party is told, in a
dialog, that the ground they thought they had mapped is not where they were.
The Judge sees the true position throughout; the players see the fake, and the
truth is hidden from them entirely.

The cost is a fog model that can be rolled back, which means the reveal made
while lost has to be recorded as a distinct, revocable layer rather than
merged into the scene's exploration.

## 2026-08-29 — Weather is derived from date and climate, not stored on the formation

The audit found weather parked on the formation record and refreshed only when
a Judge presses End day. Three defects follow: advancing the calendar any other
way leaves yesterday's sky standing, two parties in the same weather roll
independently, and there is no per-hex-per-day identity at all.

Ruling: the sky is a FUNCTION of the world date and the current hex's climate,
cached per `(date, climate)` pair. The book's fast-travel allowance — crossing
several hexes in a day keeps the roll unless the climate changed — then falls
out of the cache key rather than needing a rule of its own. The stored value
becomes a cache, not a record.

## 2026-08-29 — Straggling ships on

RAW marks the straggling rules optional. They are the only thing that makes
party SIZE matter to city movement, and a crowd rule that defaults off is a
crowd rule nobody meets. Ships as a setting, default ON.

## 2026-08-29 — Survival is its own subsystem

Starvation, dehydration, and the food and water an animal needs daily are a
coherent block that reaches well past travel — a besieged stronghold starves
too. Ruling: survival becomes its own feature, and the formation surface
AUTOMATES it for a group: tracking per member, and sharing supply across the
marching order. Formation consumes the subsystem; it does not own it.

## 2026-08-29 — Flight is a third travel model

Ruled worth building, and sized between the land and sea implementations: a
parallel speed table with its own terrain multipliers, but none of the
navigation, footing or road machinery that makes land travel large.

## 2026-08-29 — The faked reveal uncovers the GROUND, never the contents

Refines the fog half of the lost ruling above, which said only "faked, then
frozen back". What the fake may show was the open question.

**It uncovers the base map image, and nothing else.** The players get the
IMPRESSION of ground they have walked — the art under the fog — because that
is what makes a wrong map feel like a map. It must reveal no authored content:
no tokens, no roads or declared paths, no location pins, no notes. Those are
the actual intelligence, and the party has not been there to gather any of it.

The distinction is what keeps the lie honest. Uncovering terrain art costs the
Judge nothing; uncovering the road network, or the pin marking a temple, hands
the players facts about a hex they never entered.

**A revert must read as a revert.** When the party learns it was lost, the
faked ground closes back over. It is not merged into the exploration record and
it is not quietly left behind: the map visibly loses it, which is the moment
the players understand the last few days were not where they thought.

Consequences for anything built later: every content object — pins, paths,
notes — is filtered by the TRULY explored set, never by whether fog happens to
be lifted. Fog is a presentation layer here, not the source of truth about what
the party knows. A feature that reads fog to decide what a player may see will
leak through the fake, and that is a defect in the feature, not in the fake.

The restore is exact, not reconstructed: each user's fog is snapshotted once at
the moment the party becomes lost, and that snapshot is written back on
discovery. Subtracting the faked area from a live bitmap would drift.

## 2026-08-29 — SUPERSEDES the reveal ruling above: observations are remapped, not withheld

The entry above ruled that the faked reveal shows the ground and no content at
all. **New evidence, same day:** a party that is lost still *travels*. It
genuinely sees the country it crosses and whatever stands in it — it is wrong
about WHERE, not about WHAT. Withholding content models a party that walked
three days with its eyes shut, which is a worse lie than the one the rule
describes.

And RR ch. 6 supplies the mechanism the earlier ruling lacked. Two throws, two
different outcomes: the DAILY navigation throw's success means only that the
party realises it is lost and may resume its intended heading, while a party
halted after evasion throws at a penalty and, on success, "is aware of its
location relative to its last known location". Separately, a lost party may
**search for its last known landmark** with a Wilderness Searching throw, as if
the landmark were a point of interest — and that search triggers an encounter
throw of its own.

Ruling, in three states:

- **Astray.** What the party observes at its TRUE hex is drawn at its BELIEVED
  hex. Terrain, and the things standing in it, are remapped rather than
  suppressed: the map is wrong, not blank. Nothing about the believed hex's own
  contents is revealed, because the party is not there.
- **Discovery** (the daily throw succeeds). The map is known to be wrong and
  the remapped observations are discarded with the faked ground. Nothing is
  credited: strict RAW, the party does not learn where it went. The anchor —
  the last known landmark — is what it still has.
- **Re-anchor** (the party finds its last known landmark, or the Judge rules it
  recognises the ground). NOW the true track is committed: every observation is
  re-keyed from its believed hex to the hex it was really made in, and the real
  exploration joins the map. This is the "stumble upon it for real" case, and
  it is the same gesture `map-items.mjs` already calls anchoring.

So an observation is stored as a PAIR — where it was really made, and where the
party thought it was — and which of the two is used depends entirely on whether
the party ever re-establishes itself. Retreat without re-anchoring and the
observations vanish; re-anchor and they land where they truly belong.

Cost: content objects can no longer be filtered by a single explored set. They
need the pair, and a query that asks "what does this player know is here?"
must answer through the ledger rather than through fog.

## 2026-08-29 — The true position is a SHADOW TOKEN, not a coordinate

The ledger stored the true position as a hex offset. That is a coordinate, and
coordinates make every spatial question arithmetic we would have to write:
how far apart are two lost parties, can one see the other, is either near the
landmark, does a search find anything.

Foundry already answers all of those about TOKENS, and RR ch. 6 says a lost
group IS one — a searching group finds it "as if it were a point of interest",
and the last known landmark is shared by every lost group so they can
rendezvous. The book models lost parties as objects in space. So do we.

Ruling: while a formation is astray, the module maintains a **shadow token** at
its true position — hidden, vision-less, flagged to the formation, deleted when
the episode ends. The players' token stands at the BELIEVED hex and is the one
they drag. Two consequences:

- **The authoritative position is the shadow when one exists**, and the party
  token otherwise. Every derivation that asks "where is the party" goes through
  one accessor, so terrain, encounters and the weather's climate keep reading
  the truth without knowing an episode is running.
- **"Do they risk finding each other" becomes a distance measurement** between
  two shadows, which is a call Foundry already has. With coordinates it would
  have been triangulation we maintained ourselves, and it would have been wrong
  the first time two parties were lost at once.

The shadow is disposable by construction: it holds no state the ledger does not
already own, so deleting it can never lose anything.


---

### A deployed member is recalled before their stash is read (2026-08-31)

**Ruled.** `removeMembers` and `dissolveFormation` recall every deployed member
before restoring anyone, and `restoreMemberTokens` refuses a member still
holding a deployment marker. One fact — where this member's body is — now has
one reader.

`tokenData` (the snapshot taken when they joined) and `deployedTokenId` (the
token they are standing under right now) are two records of that one fact, and
only `recallMembers` knew they are mutually exclusive. `restoreMemberTokens`
was written when a member was either inside the party token or nowhere, so it
read a non-null `tokenData` as proof they were off-canvas. Deployment added a
third state — on the canvas *and* holding a stale stash — and never taught the
restore path about it.

**What it did.** Detach a scout, then remove them or disband: the live token
stayed and a second one was created from the pre-detach snapshot. Disband
mid-combat with the party deployed and *every* member duplicated, the copies
indistinguishable at a glance, with the stale one carrying the HP and effects
they had before the fight. Every teardown path funnelled through the one
unqualified filter, so removal, disband, actor deletion and the startup prune
all duplicated the same way. Recalling first is also what preserves the fight:
`recallMembers` refreshes the stash from the **live** token before deleting it.

**Not repairable in place.** A duplicate produced by this is an ordinary token
with no marker distinguishing it from the real one, so no sweep can find them.
Worlds that already hold duplicates clean them up by hand, and the changelog
says so.

**Detach also stopped failing silently.** `canDetach` now requires a party
token: a detach places the member beside one, so with no party token on the
canvas the deploy returned empty while the control rendered enabled and said
nothing when pressed. A player fared worse — they were told the declaration was
sent and never learned it was dropped. The GM gets a notice, the declaring seat
gets a whisper.

## 2026-09-02 — Swimming's printed magnitudes move to the register

Ruled after 6.2.0 shipped. `swimming.mjs` was the largest single pocket of
printed values left in the feature (ROADMAP §6a), and it is now clear of them:
the Swimming proficiency's bonus, what cold and rough water cost, the share of
speed a swimmer makes, how fast a body sinks per stone, and the base breath in
rounds are all read through `formationValue()` from the reader's own book.

**What stayed, and why it is not a printed value.** `WATER`'s three keys stay
frozen in source: something must name the options a select offers, and the
names are this module's vocabulary rather than a page's. `calm` contributes
zero *structurally* — that is what calm means, not a figure anyone printed —
which is why the commonest case in the file still computes with nothing
registered at all. The one-round floor under a drowning character's breath
likewise stays: a breath cannot last no rounds however bad the Constitution,
which is arithmetic, not a rule read off a page.

**The line this file drew.** The rule this module owns is that *the target IS
the swimmer's encumbrance* — a figure belonging to the character, not to a
book. So an unencumbered swimmer in calm water, and any non-proficient swimmer
in calm water, is fully computed with nothing imported. Only a throw that
actually needs a printed magnitude reports one missing.

**Unknown is reported, not defaulted.** `swimmingThrow` returns a null target
with an `unknown` array naming the figures it wanted, rather than a number
built on a zero. Rejected: defaulting an unimported modifier to 0, which reads
as "calm water" and would silently tell a Judge that a mailed swimmer in rough
water needs the same throw as a naked one in a millpond. `swimSpeed`,
`drowning` and `rescueStone` return null on the same grounds — a swimmer of
unknown pace is not a still one.

**What it cost.** The return shapes of `swimmingThrow` and `drowning` are now
nullable, and `SWIMMING_BONUS`, `SPEED_SHARE`, `SINK_FEET_PER_STONE` and
`WATER[x].modifier` are gone from the public API. Nothing in the module read
them — `swimming` is reached only through `acksExtras.formation.swimming`, and
no template or sheet consumes it — so the change is confined to the API surface
and to the local rules test, which now registers the figures itself.
