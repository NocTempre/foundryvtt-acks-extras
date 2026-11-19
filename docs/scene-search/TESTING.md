# Scene search — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`. Offline coverage
of the haul is `tools/test-scene-haul.mjs`; of the model, `tools/test-scene-search.mjs`.
Neither proves a window opens or a Card writes; only this walk does. The screen
(S4) has no walk here yet. The session API and the activities (S2) are written
up below and not yet walked; the haul's steps above reach the Foundry side by a
dynamic import in page context.

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

## S2 — session, activities and drops (NOT YET WALKED)

Offline coverage is `tools/test-scene-session.mjs` (the world, the refusals,
resolution, the Round seam, the api) and `tools/test-scene-drop.mjs`
(`placesAround` and the map drop). Nothing below has been driven live; the
offline suites run over a fake world and prove neither a Region's `testPoint`
nor a real plan relay.

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
2. **Assign** the skilled searcher to the floor's hasty check, the plain one to
   the same check, and the plain one to the container's methodical check
   (`assign({partyId, actorId, layer, entryKey})`). Observables: the party's
   `turnPlan` holds each entry, `key` `sceneHasty` or `sceneMethodical`, option
   the entry key; the thing past the reach is refused `scene:outOfReach`.
3. **Round press** (die held at a 20 for the skilled searcher). Observables: the
   floor's lot card reads `found: true`; the thing's `state.layers.hasty.found`
   is true; the plain searcher's hasty entry gave no roll and the log row is
   `scene:vague`; the Judges received one whispered card for the throw, the
   table none; the hasty entries are gone from the plan.
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
   and the Judge sees the declaration; for another member it is refused.
3. `open` and `end` answer `scene:notAllowed`.

Teardown: `end`, then `api.sweepTracked({ only: [potUuid] })`; the kept
fixtures stay.

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
