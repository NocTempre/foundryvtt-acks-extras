# Scene search — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`. Offline coverage
of the haul is `tools/test-scene-haul.mjs`; of the model, `tools/test-scene-search.mjs`.
Neither proves a window opens or a Card writes; only this walk does. The session
API and the activities (S2) are below, walked by
`tools/live/scene-search-session.mjs`; the screen (S4) is the last section, not
yet walked; the haul's steps reach the Foundry side by a dynamic import in page
context.

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
   for the throw, the table none; the hasty entries are gone from the plan.
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

**Not walked.** Offline coverage is `tools/test-scene-screen.mjs` (the view
model: who sees what, the counts, the rails, the tray, the log, the drag
payload) and the S4 block of `tools/test-scene-session.mjs` (the plan entry's
locker, `show`, the player's log and assignments). Neither draws a window, so
the observables below need a live Judge seat and a live Player seat at once.

It reuses S2's fixtures, found by marker: `scene-search/session-scene`,
`scene-search/session-place` (a floor, a container, a fixture whose hasty check
yields a clue and whose methodical check reveals a hidden container, and a
container past the reach), `scene-search/session-party` with the two searchers
(`scene-search/searcher-skilled`, and `scene-search/searcher-plain`, which is the
Player seat's character). Open a session with a source on the floor and on the
fixture's hidden container (`open`, as S2 Judge 1), then open the screen from
each seat with `acksExtras.sceneSearch.openScreen(partyId)` (`partyId` is the
formation's id). The screen's own ways in come with S5.

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
   methodical rail, then onto the container's card (not a rail). Observables:
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
8. **Layout.** Resize narrower and raise the type size: the header, bar and tray
   stay on screen and the entries and party columns scroll on their own; reopen
   the window and the entries' scroll position is kept across a re-render (assign
   a member while scrolled down).
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
   state change, the container stays hidden); the Judge's client's unresolved
   notes card names the member.
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
