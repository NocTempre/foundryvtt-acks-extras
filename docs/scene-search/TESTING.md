# Scene search — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`. Offline coverage
of the haul is `tools/test-scene-haul.mjs`; of the model, `tools/test-scene-search.mjs`.
Neither proves a window opens or a Card writes; only this walk does. The screen
(S4) and the session API (S2) have no walk here yet: the haul's steps reach the
Foundry side by a dynamic import in page context, until the API exists.

The walk needs a real Judge seat and a real Player seat joined at once
(`live-testing.md`): the found-only rule is a projection on the player's client,
and a Judge-seat render proves nothing about it.

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

## What this walk does not reach

The doorway card, the haul total and Quick grab with a mixed pot are covered by
offline checks only (`progressOf`, `grabLots`, `planClose`); the doorway's chat
render needs a pot opened with `doorway: true`, and a pot closed with an unfound
lot shows a record of the found lots only. Walk both once the scene screen can
open and close the pot.

## Teardown

`api.sweepTracked()` deletes the run's pot and anything else it tracked. The
two kept fixtures stay.
