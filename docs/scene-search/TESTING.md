# Scene search — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`. Offline coverage
of the haul is `tools/test-scene-haul.mjs`; of the model, `tools/test-scene-search.mjs`.
Neither proves a window opens or a Card writes; only this walk does. The session
API and the activities (S2) are below, walked by
`tools/live/scene-search-session.mjs`; the screen (S4) by
`tools/live/scene-search-screen.mjs`; the ways in (S5) by
`tools/live/treasure-search.mjs`; keying (S6) by
`tools/live/scene-search-keying.mjs`. The haul's steps reach the Foundry side by
a dynamic import in page context.

The walk needs a real Judge seat and a real Player seat joined at once
(`live-testing.md`): the found-only rule is a projection on the player's client,
and a Judge-seat render proves nothing about it.

The scripted walk is `tools/live/scene-search.mjs` (`node tools/live/run.mjs
scene-search`). What it learned driving this:

- **The Judge seat must be the active GM.** The relay step is answered by the
  active GM's client, so a walk on a lane whose GM is not the active one is
  blocked before its first step. After a world launch the first GM seated
  holds it.
- **The pot's flag is `flags.acks-extras.treasure`** (`POT_FLAG`), not `pot`.
  Read phase, origin and cards through `viewOf(pile)` from
  `scripts/treasure/pot.mjs`, and count pots with `isPot`: reading a guessed
  key makes every pot look unopened and every pile count zero.
- **Hold the die around the deal** (`CONFIG.Dice.randomUniform = () => 0.025`,
  restored after), so both sources deal a lot and `chest/1` exists for step 4.
  An unrigged deal can leave the chest empty.
- **Find a lot's card by its key, never by staging order.** The deal's
  `lots[].cardId` is read back from the opened pot by `truth.lot`; a live
  create does not answer in the order it was asked.
- **Read the player's tiles by card id.** The grid holds an element with no
  card id even when no lot is shown, so a count of grid items is never zero.
- **The place fixture may be gone by the next run** and is then rebuilt by
  its marker lookup: a GM seat's ready can prune a location that has nothing
  linked (seen here, cause not traced).

## Fixtures

Found again by `flags.world.fixture`, built through `api.fixture(marker, kind,
data)`; a run's own documents are tracked with `api.create` / `api.track` and
swept with `api.sweepTracked()`.

- `scene-search/place` — a location actor, the carrier the haul's things live
  on. Its `flags.acks-extras.things` holds two things written whole:
  `{id: "den", kind: "floor"}` and `{id: "chest", kind: "container"}`.
- `scene-search/player-character` — a `character` actor owned by the Player
  seat (OWNER for that user, nobody else), the party member the pot's window
  opens for.
- A pot is **not** a kept fixture: the deal makes it. The run marks it
  `flags.world.fixture = "scene-search/pot"` straight after the deal (the deal
  sets none) and `api.track`s the pile's uuid, from the deal's answer. A
  standing pot with the marker is retired first (`api.retire`), since a marker
  names one document.
- The treasure tables must be imported in the test world (a letter `dealHoard`
  can deal). With none imported the deal answers a refusal and no pot exists;
  that is step 6, not a fixture failure.

## Judge seat (Gamemaster)

Deal from the page context:

```js
const { dealSceneHaul } = await import("/modules/acks-extras/scripts/scene-search/haul.mjs");
const r = await dealSceneHaul({
  sources: [{ thing: "den", letters: [LETTER] }, { thing: "chest", layer: "methodical", letters: [LETTER] }],
  metInLair: true,
  scene: { sceneId: canvas.scene.id, placeUuid: PLACE_UUID },
});
```

`LETTER` is a treasure letter the world's imported table holds.

1. **Deal.** Observables: `r.ok` is true; `r.lots` has an entry per card in the
   pile, keyed `den/1…` and `chest/1…`; the pile's flag reads `phase: "open"`,
   `origin.kind: "scene"`, `messageId: null`; the chat log has no doorway card;
   every Card's `flags.acks-extras.card.found` is `false` and carries its `lot`
   key; each Card's `value` (its band) is set. Record the bands.
2. **Open the pot's window as the Judge** (`pile.sheet.render(true)`).
   Observables: every lot's tile is shown, each dashed and saying "Not found
   yet. Judge only."; the header reads "You found 0 items", and its tooltip
   adds "N not found yet"; the Turn button is absent on every tile.
3. **Mark one lot found** with `markSceneFound(pile, {code: "scene:found",
   lots: ["den/1"]})`. Observables: `r.ids` has one id; that Card's flag reads
   `found: true`; its tile loses the dashed border and the Judge-only line; the
   header reads "You found 1 item"; no Card's `value` changed from step 1.
4. **A found-nothing answer marks nothing:** `markSceneFound(pile, {code:
   "scene:foundNothing", lots: ["chest/1"]})` answers `ids: []`, and the lot
   stays dashed.
5. **Refusals at the relay** (from the Player seat, step Player 3).
6. **No tables imported:** with the treasure tables absent, a deal answers
   `ok: false`, and the Cards directory holds no new pile afterwards (the deal
   deletes the pot it made).
7. **A declined lair warning:** the same call with `metInLair: false` and
   `confirmLair: async () => false` answers `reason: "lairDeclined"` and leaves
   no pile.

## Player seat

1. **Before any lot is found** (after Judge step 1), open the pot's window
   (`game.cards.get(potId).sheet.render(true)`). Observables: the grid shows no
   tile; the header reads "You found 0 items"; no tile or text names a lot.
2. **After Judge step 3**, the window refreshes to one tile, `den/1`'s card,
   face down with its band colour (the band recorded in Judge step 1) and a
   Turn button; the header reads "You found 1 item".
3. **The relay refuses an unfound lot.** From this client send a flip for the
   card id of a lot that is not found (the id is read from the pile's cards,
   which every seat can read): the answer is `notInPot` and the Card stays face
   down, `face: null`. Then Turn the found lot with its button: it turns, and
   Take onto `scene-search/player-character` lands the goods on the actor (the
   treasure recipe's Take step). Observable: the unfound Card is still
   unclaimed and face down.

## S2 — session, activities and drops

Offline coverage is `tools/test-scene-session.mjs` (the world, the refusals,
resolution, the Round seam, the api) and `tools/test-scene-drop.mjs`
(`placesAround` and the map drop); they run over a fake world and prove
neither a Region's `testPoint` nor a real plan relay. The walk is
`tools/live/scene-search-session.mjs` (`node tools/live/run.mjs
scene-search-session`). It keeps its own party, `scene-search/session-party`,
and two Items, `scene-search/drop-trap` and `scene-search/drop-hazard`, beside
the fixtures below; the place a bare-Region drop makes and the wall it places
are the run's own, retired by marker at its start and swept by id at its end.

What driving it taught:

- **`partyId` is the formation's id**, not the party actor's
  (`getFormation(partyId)`), and the Round press takes the formation object.
- **Advance turn keeps an entry resolved this turn, stamped, until the next
  advance.** Check that nothing is left unresolved, not that the plan is empty;
  `unassign` empties it.
- **Hold the die until the throw lands, not until the clock moves.** The turn
  is spent before the entry rolls, so release the rig once the thing's
  `state.layers.methodical.done` is true.
- **The searchers' throws are the fixtures' own invented figures** (a hand-made
  ability bound to Search, as the turn-plan walk gives its thief), so
  `scene:notImported` does not occur; the imported reach is the world's own,
  and the walk is blocked without it.
- **The map drop is `Hooks.call("dropCanvasData", canvas, data)`** on the
  walk's scene, viewed on the GM seat; the Region window's drop is a `drop`
  event dispatched on its Place row's zone, and the check passes only on that
  event.
- **The Player 1 read runs before the Turn press**, since the Turn reveals the
  hidden container, and End runs before the drops.

Fixtures, found by `flags.world.fixture`:

- `scene-search/session-scene`: a scene with a grid and a scale, holding the
  party token and one Region with no behaviors.
- `scene-search/session-place`: a location actor linked to that Region
  (`createLocationForRegion`), its things written whole: a floor, a container, a
  fixture whose hasty check is an inspection yielding a clue and whose
  methodical check reveals a hidden container, and a container with a
  `point` farther from the party token than the imported reach.
- `scene-search/searcher-skilled`: a character who holds the Searching
  proficiency, level 2; `scene-search/searcher-plain`: one who does not. Both
  are members of the formation recipe's party fixture, and the plain one is the
  Player seat's character.
- A session is **not** a kept fixture: `open` writes it on the party actor and
  `end` unsets it. A walk calls `end` at its start (a standing session blocks
  `open`) and at its end.

Drive mechanics known without the world:

- The Judge seat must be the active GM (see above); a plan lock and the Round
  press both write from the pressing GM's client.
- Hold the die with `CONFIG.Dice.randomUniform`: 0.025 throws a 20 on a d20,
  0.975 a 1. Restore it after.
- The Round press is `acksExtras.sceneSearch.resolveRound(formation)`. Its
  answer's `via` is `"scene"` while `turn-plan.mjs` exports no
  `resolvePlanRound`, and `"plan"` once it does.
- A hasty check at the floor needs the searching throw and the imported search
  throws; with none imported the option is refused `scene:notImported`.
- `acksExtras.sceneSearch.read(partyId)` is what a screen reads. Call it from
  each seat: a player's answer has no `lots` and no `bodies`, and no unfound
  layer's yields.

Judge seat:

1. **Open.** `open({partyId, placeUuid, sceneId, sources, metInLair: true})`
   with a source per entry that hides goods, keyed `thing:<id>`. Observables:
   `ok` is true; the party actor's `flags.acks-extras.sceneSearch` holds the
   place, the pot's uuid and a `lots` row per dealt lot; the place's own
   `things` list holds no lot key; the pot's flag carries the party's id.
2. **Assign** the skilled searcher to the first floor's hasty check and the plain
   one to a second floor's (`assign({partyId, actorId, layer, entryKey})`). A
   member has one plan entry, so the next assign replaces it. Observables: the
   party's `turnPlan` holds each entry, `key` `sceneHasty`, option the entry key;
   assigning either to the thing past the reach is refused `scene:outOfReach`.
3. **Round press** (die held at a 20 for the skilled searcher). Observables: the
   first floor's lot card reads `found: true`; the thing's `state.layers.hasty.found`
   is true; the plain searcher's entry gave no roll and the log row is
   `scene:vague` (a second searcher at the floor already found would be refused
   `scene:alreadyFound` and log nothing); the Judges received one whispered card
   for the throw, the table none; each hasty entry stays in the plan stamped
   resolved (`resolvedTurn` set, `assignments` lists it `resolved`), and the
   next turn's count drops it.
   Then assign the plain searcher to the container's methodical check.
4. **The lock.** Repeat with the die at a 1 on a second floor thing: the thing's
   `state.layers.hasty.failed` holds the character's id and level, and assigning
   them to that check again is refused `scene:hastyLocked`. Raise the character's
   level and it is offered again.
5. **Turn press** (the Dungeon tab's Advance turn). Observables: the methodical
   entry resolves; the hidden container's `state.shown` is true; the plan is empty.
6. **Drops.** Drag a trap Item and a hazard Item onto the place's Region on the
   map, and onto the bare Region. Observables: each adds a thing whose `point` is
   where it landed; the bare Region gains a place with its sheet closed; the same
   Item dropped in the Region window's Place row has `point: null`; a trap
   dropped next to a wall assigns the wall, not the place.
7. **End.** `end(partyId)` unsets the flag; the pot stays.

Player seat:

1. `read(partyId)` hides the hidden container and every unfound yield, and
   shows the "something more" mark on the fixture.
2. `assign` for the player's own character goes through the party's plan relay
   and the Judge sees the declaration (the answer `ok: true` means declared: the
   Judge's client may still refuse it); for another member it is refused
   `scene:notAllowed` on the player's own client.
3. `open` and `end` answer `scene:notAllowed`.

Teardown: `end`, then `api.sweepTracked({ only: [potUuid] })`; the kept
fixtures stay.

## S4 — the screen

The walk is `tools/live/scene-search-screen.mjs`. Offline coverage is
`tools/test-scene-screen.mjs` (the view model: who sees what, the counts, the
rails, the tray, the log, the drag payload) and the S4 block of
`tools/test-scene-session.mjs` (the plan entry's locker, `show`, the player's
log and assignments). Neither draws a window, so the observables below need a
live Judge seat and a live Player seat at once.

What driving it taught:

- **A stylesheet `module.json` gains is read when the world launches.** A world
  launched before the screen's `styles/scene-search.css` was added draws the
  window unstyled (no column scrolls, the type knob reaches nothing, the tray
  falls off the frame). After a relaunch the world loads it natively (checked
  2026-11-19, both seats). A top-level `document.styleSheets` href test cannot
  see it: core 14 pulls module sheets in through an `@import` inside a layered
  sheet, so walk the nested rules (the lore walk's `sheetProbe`). The S4, S5
  and S6 walks still use the top-level test and so add a cache-busted copy,
  which duplicates the loaded rules harmlessly.
- **The type knob is set on the document root**, where the client pin sets it
  and the ramp steps are computed (`lib/client-pins.mjs`); set on the window it
  moves nothing. Draw the window again after setting it.
- **The Round and Turn presses keep a resolved entry in the plan**, stamped
  `resolvedTurn`; "resolved" is that stamp, not the entry's absence. A refused
  check (the locker check at a hidden entry) is stamped like any other and posts
  no unresolved card.
- **A player's relayed request is answered by the active GM**, which on a
  shared world may be another lane's seat. When that client does not answer, a
  player's assign, unassign and ask from this seat change nothing and post
  nothing (Player 3 and Player 6 failed so on lane C while lane A's Gamemaster
  was the active GM). Walk the player's relays where the walk's GM is the active
  GM.
- **Order:** the player's hidden-entry checks (Player 2 and 4) run before Judge 6
  reveals the hidden container, and Player 1 before Judge 7.

It reuses S2's fixtures, found by marker: `scene-search/session-scene`,
`scene-search/session-place` (a floor, a container, a fixture whose hasty check
yields a clue and whose methodical check reveals a hidden container, and a
container past the reach), `scene-search/session-party` with the two searchers
(`scene-search/searcher-skilled`, and `scene-search/searcher-plain`, which is the
Player seat's character). Open a session with a source on the floor and on the
fixture's hidden container (`open`, as S2 Judge 1), then open the screen from
each seat with `acksExtras.sceneSearch.openScreen(partyId)` (`partyId` is the
formation's id). The screen's own ways in are S5 below.

Held-die drive: `CONFIG.Dice.randomUniform = () => 0.025` throws a 20 on a d20,
`0.975` a 1. Restore it after.

Judge seat:

1. **Open the screen.** Observables: the header reads the place's name, "Judge
   seat" and "not yet shown to the table", with a Show the scene button; the bar
   reads "After the battle" only where a fight's record opened the session, else
   "Searching here"; a card is drawn for every entry, the hidden container
   included, dashed and tagged Hidden with the note "Behind <the fixture>, found
   by checking it methodically"; each card has two rails, hastily and
   methodically, each with `+ Assign`; the floor's card shows a Judge note of the
   lots waiting under its hasty check. The tray holds one dashed tile per dealt
   lot (no tile is solid), and its tooltip says "not found yet (Judge only)".
2. **Assign by picker.** Press `+ Assign` on the floor's hasty rail. Observables:
   a picker lists every member; a member who may not attempt the check carries
   the refusal under their button and does nothing when pressed; pressing the
   skilled searcher puts a chip on the rail, the member tile reads "<floor> ·
   hastily", the bar's press line reads "Round: 1 hasty check resolves at once.",
   and the party's `turnPlan` holds the entry.
3. **Assign by drag.** Drag the plain searcher's tile onto the fixture's
   methodical rail, then onto the second floor's card (not a rail). Observables:
   a chip on the rail; the second drop lands on the first check that member may
   attempt; a drag onto a rail whose check is refused (the container past the
   reach) posts the refusal as a notification and adds no chip.
4. **Round.** With the die at a 20 press Round. Observables: the floor's hasty
   chip clears and its pip fills; the floor's card reads "Checked hastily" with
   its lots counted ("Found: N items"); the tray's tiles for those lots turn
   solid; the bar's "You found N items." is the count of solid tiles; the log
   gains one row, newest first, and, on this seat only, a throw figure
   "(Judge: throw N against M.)" whose tooltip names the Judges' card; the bar's
   clock spent one round (`clock.roundsPartial` up by one, as the Dungeon tab's
   Round press spends it).
5. **A hasty miss locks.** With the die at a 1, assign the skilled searcher to
   the second floor and press Round. Observables: a struck chip for them on that
   rail, whose tooltip names the lock; the picker lists them with the
   `hastyLocked` refusal.
6. **Spend a turn** with the plain searcher on the fixture's methodical rail.
   Observables: the Turn count in the bar rises by one; the hidden container's
   Hidden tag goes and its state reads Seen; the fixture's "something more" line
   shows the Judge's own hint, or the generic words, only while something
   remains unfound there.
7. **Show the scene.** Press Show the scene. Observables: the header reads "shown
   to the table"; the Player seat's screen opens by itself (Player 2).
8. **Layout.** At 900 by 640 with the knob raised: the header, bar and tray stay
   inside the window, the entries column scrolls on its own and the content box
   does not, and the banner's size grew. At 520 by 420 with the knob higher: the
   content box scrolls and the tray is within its scroll, never cut off. Then
   the entries' scroll position is kept across a re-render (assign a member
   while scrolled down).
9. **End** (`end(partyId)`) with the window open. Observables: the window reads
   "No scene search is open" and nothing throws.

Player seat (the Player seat's character is `searcher-plain`):

1. **Before the scene is shown**, open the screen. Observables: the header reads
   "Player seat · <the character>"; the body says the Judge has not shown the
   scene; there is no bar, no card, no tray; the Round and Spend a turn buttons
   are not drawn.
2. **After the Judge shows it** (Judge 7). Observables: the screen is open with
   no further action; no card is drawn for the hidden container and no text
   anywhere on the screen names it; the tray has no tile for an unfound lot (the
   count of tiles is the count the bar reads); no Judge note and no throw figure
   is anywhere on the screen.
3. **Assign by picker and by drag.** Observables: the picker lists the player's
   own character only; the member tiles of the other characters are not
   draggable; a drop of the own character onto a rail declares the assignment
   (the Judge's seat shows the chip once the Judge's client has accepted it); a
   rail's chip for the own character removes on press, another's is plain text.
4. **A hand-made request.** From the console send the party's `plan` request
   naming the hidden container's key for a methodical check, then have the Judge
   press Spend a turn; repeat for a hasty check and press Round. Observables: the
   check at the hidden entry never resolves on either press (no log row, no
   state change, the container stays hidden).
5. **After the Judge's Round and Turn** the player's log shows who searched
   what; a found row shows the clue and "Something more is here." where
   something remains; a missed check shows only who and what, with no result; no
   throw figure.
6. **Round and Spend a turn** press on the player's seat. Observables: each posts
   one "<user> declares: asks the Judge …" card; the party's Turn count and the
   Judge's assigned checks are unchanged (nothing resolves until the Judge
   presses).
7. **Open the pot** opens the pot's window. Observables: it lists found lots
   only.

Teardown: `end`, then `api.sweepTracked({ only: [potUuid] })`; the kept fixtures
stay.

## S5 — the ways in

The walk is `tools/live/treasure-search.mjs` (`node tools/live/run.mjs
treasure-search`), which also walks the treasure side of the card (the
[treasure recipe](../treasure/TESTING.md), "Search the fallen"). Offline coverage
is `tools/test-scene-ways.mjs` (which party a record names, what a press does,
the call over a fake world), the S5 blocks of `tools/test-scene-haul.mjs` (the
origin's carried map), `tools/test-scene-session.mjs` (a body's table drawn at the
deal, the source's owners) and `tools/test-formation-flows.mjs` (the
Search here party press), and `tools/test-treasure-search.mjs`. None draws a card or
a button, deletes an item or opens a window, so every observable below needs a
live Judge seat and, for the Player's press, a live Player seat.

What driving it taught:

- **Create the combat on the walk's scene.** The record names the party from the
  fight's scene (`partyOfRecord`): one party whose token is on it, else the only
  party the world has. A combat made with no scene names no party in a world
  that holds several, and the press answers "No party could be named for this
  search".
- **The formation joins its other members to the combat itself.** A combat made
  with the party token alone holds four combatants once the second member joins:
  two friendly, and the two bodies. Friends are never fallen, so the card lists
  the bodies only.
- **A chat card's stored content loses a `hidden` attribute.** The card's table
  block is hidden by its render hook, not by the template; check the attribute,
  the computed display and the block's height before any draw, not the list's
  text.
- **The pot is read from the party's session flag.** `flags.acks-extras.sceneSearch`
  carries `potUuid` (null for a session opened from the Dungeon tab, which deals
  nothing), `recordMessageId` and the bodies' ids; the card's button returns
  nothing. Track the pot's uuid the moment the flag shows it. `end` does not
  delete the pot.
- **Count pots by uuid before and after a press.** A world holds other sessions'
  pots, so a count alone is not a measure; compare the set against the uuids
  known before the press.
- **Hold the die from the press until the session flag appears**, and restore it
  after (`CONFIG.Dice.randomUniform`, 0.025). The letter then deals at least one
  lot, and a linked table with the formula `1d1` and two results sharing the
  range 1 yields both an item result and a text result from one draw.
- **A refusal is a notification; compare it to the module's own words**
  (`acksExtras.sceneSearch.reasonText(code)`, with the code from `WAYS_REFUSAL`)
  through the kit's `takeNotes`, which records the seat's warnings and infos. The
  lair notice is among them.
- **The Dungeon tab is the sheet's `mode` tab.** Open it with the tab control's
  click, then press `[data-action="searchHere"]` with the real pointer. The
  button is on the Judge's sheet and on a Player seat that owns the party
  actor; the walk gives the Player seat OWNER on the party actor and on one
  member.
- **The declaration card is made by whichever GM client answers the relay.**
  Read `game.users.activeGM` on the Player seat in the same call as the
  press; the walk's GM seat's nonce hook finds the card only when that seat
  answered.
- **Begin Combat and End Combat are sometimes covered by another window.** A
  control that is not the element under its centre is pressed with `click()`
  and printed; a scripted Begin Combat did not start the combat once, so the
  walk writes the round instead and End Combat still fires the real hook.
- **The screen's Round is clicked within the window's own root.** A pointer
  press at its centre landed on another window and a scripted click on the
  wrong match resolved nothing; `[data-action="round"]` under the window root,
  with the die held, resolves the assigned hasty checks.
- **A walk on a lane is blocked while another GM client is the active GM.**
  Another lane's seat connecting mid-run reads as `WALK BLOCKED`; it is the
  environment, so rerun once that seat has left.
- **The stylesheet probe is blind**, as S4 says: the walk injects a
  cache-busted copy on both seats before opening a window, over a sheet the
  world already loads.

### Fixtures

Found by `flags.world.fixture`, built through `api.fixture`.

- `scene-search/ways-scene` — a scene (3000 by 1500, grid 100 / 5 ft) holding the
  Region `scene-search/ways-region`, one rectangle around the party's token, no
  behavior.
- `scene-search/ways-place` — a location actor linked to that Region, with one
  floor (`floor-1`), so the screen has an entry to assign to. The place whose
  area holds the party token is the walk's place.
- `scene-search/ways-party` — a party actor the Player seat owns, holding
  `scene-search/ways-owner` (a character the Player seat owns) and
  `scene-search/ways-mate` (owned by nobody else), its token on `ways-scene` inside
  the Region.
- `scene-search/ways-hostile` — an unlinked `monster` with two goods (an item
  and a coin row), a natural-weapon row and a treasure letter the imported
  classic table deals a card for; `scene-search/ways-hostile-2` — an unlinked
  monster with no goods and a linked table. Each run places its own HOSTILE
  tokens, so the take-off writes through a token's own copy.
- `scene-search/ways-table` — a RollTable (formula `1d1`, replacement on) with an
  item result pointing at `scene-search/ways-table-item` and a text result, both
  on the range 1, linked on the second hostile through
  `system.details.treasure.table` as `@UUID[...]`.
- A combat is not kept: the run makes it, and `api.track`s the card's id and the
  scene's pot (from the session's `potUuid`) as they appear.

### Steps

Judge seat:

1. **A real fight ends.** Begin a combat on `ways-scene` with the party's token
   and both hostile tokens, knock both bodies to 0 hit points (the tracker's
   defeat toggle for one, a hit-point write for the other), End Combat (Combat
   tracker → End Combat, and its confirm). Observables: the Chat sidebar shows a
   "The fight is over" card (Judges only) with both bodies (the first with "2
   carried" and its letter, the second with "0 carried" and a table mark) and a
   **Search the scene** button; the party's members are not listed; the card has
   no Stage a pot control and shows no table text; the Player seat holds the
   message but neither sees nor renders it.
2. **Search the scene.** Press it. Observables: the scene screen opens at
   `ways-place`'s name with the bar reading "After the battle"; each body is an
   entry; the pot the scene dealt is open, with `origin.kind` `scene`,
   `origin.takeOff` true and `origin.carried` naming each goods item's card (the
   natural weapon none); **the goods are still on their body** (`origin.taken`
   is empty; changed 2026-11-19, walked 2026-11-19, treasure-search 130212); the lots the letter dealt and the one the
   table drew are unfound tiles; no chat message
   was posted by the draw, and the table's text result is listed on the card;
   a lair warning notice appeared for the letter's hoard; the card's button now reads "Open the scene".
3. **Press it again.** Observables: the same screen comes forward and no second
   pot exists. End the session (`acksExtras.sceneSearch.end(partyId)`) and press
   the card once more (changed 2026-11-19, walked 2026-11-19, treasure-search 130212): the scene reopens at
   the place the first opening used, with the same bodies as entries, the same
   pot reattached (`session.potUuid` is the first pot's uuid, the lots' tiles
   and found marks are the pot's), no second pot, no chat message from a table
   draw (the table was drawn once: the card's `drawnBy` is unchanged), no lair
   notice, and the card's flag is not rewritten (`potUuid`, `placeUuid` and `lots`
   stay as the first opening stamped them). From the Player seat's console,
   `acksExtras.sceneSearch.searchHere({recordMessageId})` answers
   `scene:notAllowed` and opens nothing.
3a. **Goods leave when found** (new 2026-11-19, walked 2026-11-19,
   treasure-search 130212). With the scene
   open, assign a member to the first body's hasty check and resolve it with the
   die held to pass. Observables: the lot the check found is a found tile and
   its good has left the body (the actor's item is gone; `origin.taken` lists
   its card); the body's natural weapon is still on it. The table's lot sits on
   the second body, which carries no goods: its own check finds that lot first
   and takes nothing, with `taken` still empty and the first body untouched.
   The first body's one check found all four of its lots, both goods among them.
   A second find takes nothing: treasure's `takeOffBodies` asked again for the
   cards already taken deletes no item, and a second check at the found body
   is refused as already found. Then end the session and press the card again:
   the first body reads as found and no item is deleted a second time.
3b. **The pot is gone** (new 2026-11-19, walked 2026-11-19, treasure-search
   130212, on the second fight's card). End the session, close
   the pot from its window (Close the pot, then the dialog's confirm; closing
   deletes it), press the card: the scene
   reopens with its bodies and no lots, the Judge is told "That treasure pot is
   gone.", the screen's Open the pot control is disabled with the tooltip "No
   pot was dealt for this search." (the tray holds no tiles), and
   nothing is dealt. The goods of every lot not yet found are still on their
   bodies. The sweep lists that pot as missing, since closing deleted it.
4. **No place.** Move the party's token outside the Region and every other
   area (`placesAround` for the token answers no place), make a fresh fight,
   press **Search the scene**. Observables: a notification says the party stands
   in no place; no session or pot is made, the table is not drawn and the card is
   not marked opened; with the token back in the Region the same card opens the
   scene.
5. **Search here.** On `ways-party`'s sheet open the Dungeon tab (party sheet →
   Dungeon tab → Turn plan) and press **Search here** with the token back in the
   Region. Observables: a session opens at the place with no fight (the bar reads
   "Searching here"), no pot is dealt, and the screen opens; pressing it again
   brings the same screen forward. A member assigned on the screen shows as that
   member's turn-plan entry in the Dungeon tab's Turn plan.

Player seat:

6. **The Player's press.** With no session open, open the party's sheet on the
   Player seat (the character from `ways-owner`). Observables: **Search here** is
   shown with the Judge's tooltip; pressing it opens the same session the Judge's
   press opens, read on the Judge's seat (the plan and the clock as for the
   Judge's press, the scene unshown, every lot unfound), one public line, spoken
   as the party and naming the player, announces it, and no screen opens on the
   Player seat until the Judge shows the scene. With the token outside every
   place the press opens nothing and the seat reads "The search did not open.".
   A seat that owns no member sees no button, and a crafted press from it is
   refused (the formation walk `formation-seat-crossing`, C14, walks both).
7. **The Judge's own press** still opens the session and shows the screen
   as step 5 has it; the Player seat's screen follows once the Judge shows the
   scene.

Teardown: `acksExtras.sceneSearch.end(partyId)`, then `api.sweepTracked()` over
the run's own ids (the combat, the card, the pots, the sessions' pots); the kept
fixtures stay.

What this walk could teach and has not: the card's whisper reaching a second
Judge seat; the button's label after a world reload; the take-off when a body's
token was deleted between the fight and the find; a Player seat that owns no
member.

## S6 — keying

The walk is `tools/live/scene-search-keying.mjs`. Offline coverage is
`tools/test-scene-keying.mjs`: lib's `reviseThings` (what an authored write keeps
and never writes, and its `params` merge), each rail field's edit, the dealt-lot guard, Behind and its
loop guard, the rail's model and the tab's lists. It draws no window, reads no
drop and writes no actor, so every observable below needs a live Judge seat; the
Player seat's part is that it has no tab and no rail.

What driving it taught:

- **A field is committed by setting its value and dispatching a bubbling
  `change`.** The rail writes on `change` through `writeOnChange`, and every
  write draws the rail again, so a node found before a write is gone after it.
  Re-find the control each time and poll `flags["acks-extras"].things` for the
  write instead of sleeping.
- **Seed a sentinel in a thing's `state` and `params`** (an invented key in
  each). `{}` equal to `{}` after a write proves nothing; the sentinel surviving
  every write is what shows a field edits its own keys alone. A Reset clears the
  `state` sentinel by design, so a step that resets writes the list again.
- **A drop is a synthetic `drop` event** carrying `{type: "Item", uuid}` as
  text/plain, dispatched on a node inside the Things here section (the tab
  handler reads `closest(".tab")`) or on the Tools field (which stops the event,
  so nothing reaches the sheet's goods path). A goods drop stocks an embedded
  Item on the kept place and, on a later run, may fold into a stack: assert by
  delta, and track what the run made.
- **The Hidden tick on a fixture does write `hidden`.** The loop guard is that
  the Behind select then does not offer the thing the fixture reveals, and that
  a value forced into it by hand is refused with the cycle notice and writes
  nothing. The tick is undone afterwards.
- **The Behind select is disabled until the thing is Hidden**, so a lot is made
  hidden before it can be put behind a layer.
- **A card's "something more" line is drawn only for a touched entry** (a check
  has been resolved there), so a hint written in the aside shows on the card
  after a Round or a Turn, not before. The card's Hidden mark changes at once,
  and a write through the aside is read against that.
- **Two lots dealt on one layer read "2 lots are dealt here"**; the singular
  wording is for one. The note sits under the layer's own legend, and the stored
  list holds no `lots` key and no lot key after any write through the aside.
- **Measure the aside's parts before scrolling to its last control.**
  `scrollIntoView` on the rail's Remove button moves the window's frame, which
  carries the header out of view and reads as a header outside the window.
- **A session needs no Region link to open**: `open` takes the place's uuid and
  the scene's id, so the walk's party is a formation of one member on a scene.
  A body on the screen is written by hand into the session's `bodies`, since no
  fight's record is reachable here.
- **The stylesheet probe is blind**, as S4 says: the walk adds a cache-busted
  `styles/scene-search.css` over the sheet the world already loads.

### Fixtures

Found by `flags.world.fixture`, built through `api.fixture`. Reuse S2's place
and party where the walk is not about keying.

- `scene-search/key-place` — a location actor with no market and three things
  written whole: a fixture (hasty check: no throw, yielding a clue; methodical
  check: the party's search, revealing the second), a container with
  `hidden: true`, and a lot. It is not the S2 place: the walk edits it.
- `scene-search/key-place` has `ownership.default` Observer, so the Player seat
  may open its sheet (step 10 reads a sheet that opened). Its list is written
  whole at every start: the fixture and the hidden container, each carrying a
  sentinel `state` and `params` key, and the lot, whose `ref` is `key-goods`.
- `scene-search/key-scene`, `scene-search/key-party` and
  `scene-search/key-char` — a formation of one character (owned by the Player
  seat) on a scene. The screen opens at the place through the session's own
  place uuid, so no Region link is needed.
- `scene-search/key-trap` and `scene-search/key-hazard` — a trap Item and a
  Hazard item whose key is an obstacle's, kept in the world's Items.
- `scene-search/key-tool` — an Item the tools field takes.
- `scene-search/key-goods` — a plain Item, for the goods drop.
- A scene search session is not kept: step 9 opens it with
  `acksExtras.sceneSearch.open` and the walk ends it.

### Steps

Judge seat:

1. **The tab.** Open `key-place`'s sheet. Observables: a **Things here** tab
   after Research, labelled with its count; opening it lists the three things,
   each row with its kind, summary and flag (the clue's row says it is in front
   of a secret, the container's that it is hidden, the lot's that it is dealt
   at open), and no "From the map" section while nothing derives the map's
   doors.
2. **Open a thing.** Press the fixture's row. Observables: its rail opens under
   it with the fields in the board's order; pressing the row again closes it;
   the rail's controls carry names (tab through them) and the type knob reaches
   them (draw the sheet again after setting it, at 18 px and at 22 px).
3. **Write each field**, reading `flags.acks-extras.things` after each:
   Hidden → the thing's `hidden`; the Something more line → `hint`, and blank
   removes it; the hasty Check set to Proficiency adds `layers.hasty.check:
   "skill"`, the proficiency select appears and, once one is picked,
   `capability` is its token, and setting the check back to the party's search
   removes `capability`; Others may look hastily → `layers.hasty.anyone`; Yields
   → `yields.clue`; Tools, by dropping `key-tool` on the field → `tools` holds
   its uuid once (drop it twice: still once) and its × removes it; Turns, left
   blank → no `turns` key, and a typed 0 or 1.5 is refused with a notice and
   the field returns to its stored value. Observables beside each: the thing's
   `state` and `params` are as they were.
4. **Behind.** Open the container (hidden). Choose the fixture's methodical
   layer in Behind. Observables: the fixture's `layers.methodical.yields.reveal`
   names `thing:<container id>` and no other thing changed; choosing the
   fixture's hasty layer moves the key (the methodical layer no longer names
   it); choosing Nothing removes it. With the container behind the fixture's
   layer, open the fixture and tick Hidden: its Behind select does not offer
   the container (the fixture reveals it); a value forced into the select by
   hand is refused with the cycle notice and changes nothing.
5. **Show to the table.** On the container press **Show to the table**.
   Observables: `state.shown` is true on that thing alone and `hidden` is still
   true; the button is disabled afterwards; a Reset of the place
   (`resetThingIn`) clears it.
6. **Remove.** Remove the lot. Observables: it is gone from the list, the
   document it pointed at is not touched, and no other thing's `reveal` names its
   key.
7. **Drops.** Drag `key-trap` and then `key-hazard` onto the tab. Observables:
   each becomes a thing with `point: null`, the trap hidden; drag `key-goods`
   onto the tab: it is stored as the place's goods (the Storage tab lists it)
   and no thing is made.
8. **A derived thing.** Where a door or an old-style trap zone is read off the
   map (not built yet; skip while `derivedInputs` answers none), its row lists
   under "From the map" and opens no fields.
9. **The screen's aside.** `open` a session at `key-place`, open the screen.
   Observables: with no entry selected the aside says to open one; pressing a
   card's name (or the card) selects it, outlines it and fills the aside with
   the same fields the tab showed; a field written there changes the place's
   list and the card; the dealt lot's key appears read-only under its layer and
   does not land in `things` after any write (read the list: no lot key).
   Select a door or a body: the aside says it is read from elsewhere and holds
   no field. End the session.

Player seat:

10. Open the place's sheet and the scene screen on a Player seat. Observables:
    the sheet has no Things here tab; the screen has no aside and no keying
    control, and its cards' names are text, not buttons.

Teardown: end the session; `api.sweepTracked()` over the run's own ids. The kept
fixtures stay, and the walk writes the place's list back to its recipe shape
at its start, since step 4 to 6 change it.

What this walk could not teach offline, and now reads live: that the partial is
registered before the first render (the tab and the aside both draw it), that the
Tools field takes a drop, the type knob on the sheet's rail (14, 18 and 22 px,
the sheet drawn fresh each time) and the aside at 900 by 640 and at 520 by 420.
Not reached: a real pointer drag, a tab-key traversal (names and tabbability are
read), a drop from a compendium or another actor's sheet, and step 8 (no door or
old-style trap zone is derived yet).

## S7a — lore checks

Walked by `tools/live/scene-search-lore.mjs` (`node tools/live/run.mjs scene-search-lore`). Offline coverage is `tools/test-scene-lore.mjs` (the real
party check joined to the scene search's own `skillConfig`, over ability items
shaped like the importer's). It draws no window, posts no card and reads no
import, so every observable below needs a live seat.

Fixtures, found by marker (`api.fixture`):

- `scene-search/lore-place` — a location actor whose `flags.acks-extras.things`
  holds five fixtures written whole, each with BOTH checks keyed Proficiency, each
  to one capability: `{id: "theology"}` (the Theology token), `{id: "naturalism"}`,
  `{id: "loremastery"}`, `{id: "sensing"}` and a second `{id: "sensing-2"}`. Each yields a clue line on both
  layers. The tokens are the ones the rail's picker lists for the imported
  proficiencies.
- `scene-search/lore-holder` — a character owned by the Player seat holding the
  imported Theology, Naturalism, Loremastery and Sensing Power items, each added
  from the library (so each carries the import stamp). The imported figures are
  whatever the world's books gave; read them from the sheet's Rolls tab, never
  from this recipe.
- `scene-search/lore-outsider` — a character holding none of them, owned by the
  same seat.
- `scene-search/lore-party` — a party with both characters as members, standing
  on `scene-search/lore-scene` inside `scene-search/lore-region`, a Region linked to
  the place (Search here finds the place through it).

A step that needs a figure reads it first; a proficiency whose Rolls tab shows
no throw is the observable for that step's blank case, not a failed fixture.

1. **Open** a scene search at the place (Judge seat, party sheet → Dungeon tab →
   Search here). Open the Judge's screen. *Observable:* five entry cards.
2. **Assignable by the holder.** Pick Theology's card, Checked hastily, press
   `+ Assign`. *Observable:* the picker lists the holder with no refusal and the
   outsider with no refusal either (a missing skill is the vague hint at the
   hasty check, never a block); at Checked methodically the outsider is listed
   with "lacks the capability this check names".
3. **A thrown check.** Assign the holder to Theology hasty and press Round.
   *Observable:* one whispered Judges' card from the party, its row naming the
   ability, the total and the target (the sheet's figure, hover for the page),
   and the entry's log row reads found or found nothing to match the card; no
   card reaches the Player seat.
4. **The vague hint.** Assign the outsider to Naturalism hasty, Round.
   *Observable:* the log row reads "There might be something more here" on both
   seats (the Player's log keeps the code), no card is posted, the entry is not
   found.
5. **The first throw.** Assign the holder to Naturalism hasty, Round.
   *Observable:* the card's target equals the FIRST throw's figure on the Rolls
   tab. The imported item lists ONE throw, so this proves nothing about "first, not
   lowest": add a second throw with a lower figure through the roll writer, Round
   again, and the card's target is still the first's (put the library's throws
   back afterwards).
6. **Loremastery at two levels.** Read the target on the holder, change the
   holder's level by one, read the picker's card again. *Observable:* the
   figure moves with the level, as the sheet's does. *Unverified offline:* the
   import's lifted throw is not reproducible offline, so this step also
   confirms the lift produced a throw at all; with none, step 7's blank case
   applies to it.
7. **A blank figure.** Rebuild the holder's Theology item with its throw emptied
   (clear the roll on its Rolls tab), assign Theology hasty (the layer must not
   already be found: refusals for found and a hasty lock come before a blank
   figure). *Observable:* the
   holder is listed blocked with no words; the row's tooltip is the page the
   item cites, with no figure or other text.
8. **No throw printed.** Assign the holder to Sensing Power hasty, Round.
   *Observable:* no card, the log row reads found (the clue line), the holder is
   not locked at that spot; on a second Sensing Power fixture, assign the outsider: vague.
9. **Player seat.** On the Player seat, the screen lists each entry the Judge
   shows; assigning the owned holder follows the Judge's refusals above, and no
   Judges' card or figure appears there.

Teardown: end the session; `api.sweepTracked()` over the run's own ids. The
kept fixtures stay; the walk writes the place's list back to its recipe shape at
its start.

### What driving it taught

- The place's list is written whole before every step, which clears every thing's
  state; a found layer refuses `alreadyFound` and a hasty miss locks, and both
  refusals outrank a blank figure. The second Sensing Power thing exists for the
  same reason: the vague hint is only given where something is still unfound.
- Each proficiency reaches the holder through the sheet's add-proficiency route
  where the general list offers it, else `grantAbility`. The walk finds the library
  item by the capability token the rail's picker lists, never by name.
- The sheet's figure on a flat throw is the flat value less the standing bonus on
  the throw. A second throw written to differ from the first is written with that
  bonus added, read off a probe throw.
- The picker's option (`acksExtras.sceneSearch.options`) carries the `target`: the
  Loremastery figure is read there at each level and held against the sheet's,
  with no Round and no card.
- A blank figure is written through `writeRolls` and put back by replacing
  `flags.acks-extras.extras.rolls` with the library source's own; a `writeRolls`
  round trip alone leaves the roll normalised (its target, score and note differ
  from the import's) while the figure is unchanged.
- A Round at a held 1 is the proof that a throwless proficiency rolls nothing: it
  still reads found, posts no card, and the layer's `failed` is an empty object.
- A whispered card is delivered to every client: on the Player seat
  `game.messages.has` is true while `visible` is false and the chat DOM holds no
  node for it. Read `visible` and the DOM. Every Judge-level seat is a recipient.
- **Open finding:** the card's target tooltip reads the figure and the ability's
  name only; it names no page, though the item cites one and the picker's own
  tooltip carries it (`citedSource` in `party-rolls.mjs` lists only the modifier
  parts' pages). Registered as T-0683; the walk's check for the page stays red
  until that lands.
- `document.styleSheets` held against `styles/scene-search.css` is blind: core 14
  pulls module sheets in through an `@import` inside a layered sheet. Walk the
  nested rules (the walk's `sheetProbe`) and match a selector against the open
  screen (`ruleProbe`); both seats showed the sheet loaded natively, so no
  injection is needed.
- Not reached: a real pointer drag, the chooser between a proficiency's two throws
  (not built), and Magical Engineering (no fixture holds it).

## The open-sheet control

**Walked 2026-11-19** by `tools/live/scene-search-sheet-crossing.mjs` (`node tools/live/run.mjs scene-search-sheet-crossing`), log `aia-tmp/live/scene-search-sheet-crossing-20261119-141705.log`: steps 1 to 5 on both seats with no console error (step 1's "a container's card has none" and step 4's deleting the world actor were not driven; only the token was deleted). Offline coverage is the view model (`tools/test-scene-screen.mjs`)
and the actor resolution and the per-seat button rule (`tools/test-treasure-search.mjs`);
the removal of the card's buttons for a non-Judge stays offline only, since the Player seat never renders the card.

Fixtures: a fight whose defeated hostile combatants carry something, so the
fight-over card posts (the recipe of "S5 — the ways in"); one of the fallen is an
unlinked token. The party's scene search opened from that card. The walk keeps
`scene-search/sheet-*` (scene, Region, place, party, owner, mate and two unlinked
hostiles) and builds the fight, the card and the tokens it deletes as its own.

What driving it taught:

- The fight-over card is drawn twice, in the chat log (`#chat`) and as a transient
  popup in `#chat-notifications`. A pointer press lands on whichever is on top, and
  the popup copy moves and expires; press the `#chat` copy.
- A defeat by hit points writes only the unlinked token's own actor, so the world
  actor keeps its hit points. That difference is the proof the button never falls
  back to the world actor.
- `ui.chat.updateMessage` re-runs the card's render hook; it is how a walk redraws
  the card after a deletion.
- Delete a body's token through `api.sweepTracked({ only: [tokenUuid] })` so the
  deletion stays on the run's own ledger.
- A monster token's actor opens a sheet of class `FollowerCardSheet`; assert the
  document uuid, not the class.

1. **Judge, the screen.** Open the scene screen (party sheet → Dungeon tab → Search
   here, or the card's Search the scene). *Observable:* each body's card has a
   Sheet button right of its name, with the book icon, tooltip "Open this body's
   sheet" and the label "Open {name}'s sheet"; a container's card has none.
2. **Press it.** Press the unlinked body's Sheet. *Observable:* the token's own
   actor sheet opens (its HP matches the token, not the world actor), and the
   card is not selected (the keying aside does not change).
3. **Judge, the card.** On the fight-over chat card, each fallen row has the same
   button, icon only, after its name. Press one. *Observable:* that body's sheet
   opens.
4. **A body gone.** Delete one fallen body's token and the actor it stood for
   (made for this step, never a kept fixture), then redraw the screen and the
   card. *Observable:* that body's button is disabled on both; pressing it opens
   nothing and warns nothing; the console shows no error.
5. **Player seat.** Join as the Player seat and show the scene. *Observable:* the
   screen's body cards have no Sheet button. The fight-over card is whispered to
   the Judges, so this seat never sees it; the removal of its buttons for a
   non-Judge is covered offline only.

## The crossing fieldset

**Walked 2026-11-19** by `tools/live/scene-search-sheet-crossing.mjs` (`node tools/live/run.mjs scene-search-sheet-crossing`), log `aia-tmp/live/scene-search-sheet-crossing-20261119-141705.log`: steps 1 to 5 and 8, with 2 imported water-penalty steps and a stale pick; step 6 read tooltip text and captions only (keyboard order not asserted); step 7 (narrow window, raised type size) not walked; "Begin over this place starts the crossing" not driven, `crossingSeed` was called in the page instead. Offline coverage is `tools/test-scene-keying.mjs` (which keys each kind offers, the penalty select with and without imported steps, an unlisted pick shown as not set, the larger figure enabled only on larger, a blank removing its key, and every written value read back through `crossingSeed`); no window is drawn offline.

Fixtures: `scene-search/crossing-place`, a place holding one thing per obstacle kind (a climb obstacle, a jump, a squeeze and a swim) and a condition, each dropped on the place from the Hazards pack. For the penalty select the world imports the water-penalty steps once; a second pass walks with none imported.

1. **Offer by kind.** Location sheet → Things here → open each obstacle's row. *Observable:* the Crossing fieldset lists Length and Depth for the climb, Gap and Depth for the jump, Shape and Length for the squeeze, Penalty and Larger penalty for the swim; a condition or a trap row has none. The scene screen's aside, with the same thing selected, shows the same fieldset.
2. **Write a figure.** Type a length on the climb. *Observable:* the thing's `params.length` holds the number and nothing else of the thing changed; the party sheet's Begin over this place starts the crossing with it. Clear the field: the key is gone and the crossing's own default stands.
3. **The penalty select.** Open the swim. *Observable:* with steps imported the options are Not set, None, one Imported step per step, and Larger…; with none imported, Not set, None and Larger…. Pick a step: `params.penaltyPick` holds it and Larger penalty stays disabled. Pick Larger…: the field enables, type a figure, and Begin starts the swim with it. Pick None: the figure is removed from `params`.
4. **A stale pick.** Write a pick for a step the world does not import into `params` through the API, then reopen the row. *Observable:* the select shows Not set, and the crossing opens on its own default.
5. **Shape.** Pick Squeeze on the squeeze; Begin opens it in that shape. Pick Not set: the key is gone.
6. **Tooltips and keyboard.** Hover each field. *Observable:* its caption, what it sets, and the page the kind cites. Tab through the fieldset; each control is reached and named.
7. **The window.** Make the sheet narrow and raise the type size. *Observable:* the fieldset reflows and scrolls with the rest of the rail.
8. **Player seat.** Join as the Player seat. *Observable:* the Things here tab and the screen's rail are absent, as for the rest of the rail.

What driving it taught:

- The walk's place is `scene-search/crossing-place`, filled by dropping the Hazards
  pack's items through `dropOnPlace`. Read the pack with `pack.getDocuments()`: the
  index carries no `system.key`, so a key lookup on it finds nothing.
- A drop stores blank keys (`length`, `gap`, `depth` as null) on every obstacle. The
  editor's blank removes the key, so assert the owned keys as null-or-absent and
  compare the rest of `params` for change.
- A select the walk set already holds the value it wrote, so it cannot prove a
  redraw; wait on a dependent field (Larger penalty enabling) and sleep after each
  write.
- `crossingSeed` takes `penaltyPicks: penaltyPicksOf(waterPenaltySteps())`; without
  it a swim pick is dropped as stale.
- End a session and close its screen before `open` at another place, or the run
  throws `scene:sessionOpen`.

## The keyed place and the clean-up

**Walked 2026-11-19** by `tools/live/location-prune-keyed.mjs` (`node tools/live/run.mjs location-prune-keyed`), GM seat only, lane B, log `aia-tmp/live/location-prune-keyed-20261119-150852.log`: 7 pass, 0 fail, with the real trigger. An earlier run that day (`-150652`) found another lane's GM primary and ran the dry check alone. Offline: nothing, since the prune reads `game`.

Fixtures: `scene-search/prune-keyed`, a location holding one thing (kind fixture, no ref) and nothing else, its list brought to that one thing at the step's start. A bare location the run builds with `api.create` and sweeps by its uuid.

1. **Run dry.** Call `pruneEmptyLocations({ dryRun: true })` (import `scripts/location/module.mjs`; the prune is not on the api). *Observable:* the keyed place is not among `doomed`; the bare place is.
2. **The real trigger.** Only where this seat is the primary GM (`game.users.activeGM.isSelf`) and **Clean up empty locations** is on, reload the seat. *Observable:* after its `ready` the keyed place stands and the bare place is gone. Elsewhere the step is not walked, and the log says so.

What driving it taught:

- The primary GM is whichever lane's GM Foundry elects, and a seat on another lane outranks this one while it is connected. Check `activeGM` before the reload; never move another lane's seat to get the trigger.
- Never call the prune for real from a walk: it takes every empty place in the world. The reload is the trigger, and the dry count says beforehand what it will take (1 here: the bare place alone).
- The prune's delete has no fixed arrival after `ready`. It waits for the primary GM to settle and deletes one place at a time, and it has landed after a fixed five-second sleep. Poll for the bare place's absence, bounded, and log the seconds it took.

## What this walk does not reach

The doorway card, the haul total and Quick grab with a mixed pot are covered by
offline checks only (`progressOf`, `grabLots`, `planClose`); the doorway's chat
render needs a pot opened with `doorway: true`, and a pot closed with an unfound
lot shows a record of the found lots only. Walk both once the scene screen can
open and close the pot.

## Teardown

`api.sweepTracked({ only: [potUuid] })` deletes the run's pot alone. The two
kept fixtures stay: a bare `sweepTracked()` would also delete a fixture the run
built, since the lookup tracks what it builds.
