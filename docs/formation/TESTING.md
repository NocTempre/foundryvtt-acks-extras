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
- **Press a scene-control tool through the DOM**, not through its handler:
  `document.querySelector('[data-tool="acksTrapLine"]').click()`. Calling
  `onChange` directly cannot show a double-fire, and double-firing is a real
  failure mode of `button: true` tools.
- **A card whose text is raw i18n keys is a STALE CLIENT, not a missing key.**
  Check `message.author` — the automation runs on `game.users.activeGM`, which
  may be another session's browser holding a cached `lang/en.json`. Confirm
  with `game.i18n.has(key)` in your own tab before touching the lang file.
- **`attemptDisarm` awaits a DialogV2 on success**, so a scripted click on
  "Work on it" hangs until the disarm/discharge question is answered. Click
  the button, then find the dialog by its own buttons
  (`[data-action="disarm"]`) — the class-name check most snippets use does not
  match v14's minified DialogV2.
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
6. Trap tool, from a wall-drawing tool: `ui.controls.activate({control:"walls",
   tool:"wall"})`, then press `acksTrapLine`.
   *Observable:* exactly ONE wall created, all four restrictions 0, and
   `ui.controls.tool.name === "select"` afterwards.
7. Automatic search sweep: give a member a `Searching` ability with a low
   `rollTarget`, lay a trap one square OFF the line of march and another four
   squares off, and make an ordinary move past them.
   *Observable:* the near trap goes `state: "found", known: true` and one
   GM-whispered "Something is spotted" card appears; the far one is untouched.
   Raise `rollTarget` above 20 and repeat on a rebuilt trap: **no card at all**
   (the sweep is silent on failure), `searchLock` records the actor at their
   level, and a second pass rolls nothing.
8. Trapbreaking dialog: `traps.openTrapbreakApp(formationId)`, then click
   `[data-action="attempt"]` and answer the disarm/discharge dialog.
   *Observable:* the target list holds only traps within 5' with `known: true`;
   the whispered card itemises the throw; the placement takes the chosen state.
9. Party face width: with a 3-member formation on a 5'-per-square scene, set
   frontage 3 in the formation view.
   *Observable:* the party token's width becomes `3 × marchFeetPerBody / 5`
   squares (1.75 at the default 3'), height one rank (1). Rotate the token to
   face east (`token.update({rotation: 270, animate: false})`, then re-read):
   width and height swap. Set frontage 1: the token narrows and deepens to
   3 ranks. On a scene with `grid.distance` 50, the same token floors at
   0.25 squares.
10. Player seat (second browser — the capture driver's, not another pane tab):
   join as a seat owning one member.
   *Observable:* markers are drawn ONLY for `known` placements; the dialog
   offers only that seat's own characters and only found traps; the party
   sheet shows the Trapbreaking button; pressing "Work on it" announces
   "… works on the trap." publicly and the disarm question opens on the
   JUDGE's client.

## Teardown

Delete the scene, the party actor (its formation goes with it), the member
actors, and the trap item. Confirm `getFormations()` no longer lists the
formation. Sweep the chat too — a trap probe fills it with whispered cards, and
`game.messages.filter(m => m.content.includes("<your fixture prefix>"))` is what
finds them.
