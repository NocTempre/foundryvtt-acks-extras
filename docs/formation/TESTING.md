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
- **Instrument `console.debug` as well as `console.error` when checking the
  environment sweep.** A sweep step whose target was deleted mid-run reports
  at DEBUG by design (DECISIONS 2026-08-20); watching only `error` reads that
  as "nothing happened" and cannot tell it apart from the step never running.
- **Capture `err.stack`, not `err.message`.** The delete races in this feature
  surface as a bare `TypeError: Cannot read properties of undefined (reading
  'id')` whose message names nothing — the stack is what identifies it as
  Foundry's server-side `Scene.getMany` rather than module code.
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
- **Driving a real canvas gesture: prime the renderer first.** Dispatching
  `PointerEvent`s at `canvas.app.renderer.events.domElement` drives the genuine
  PIXI path — hit test, `MouseInteractionManager`, drag workflow — but PIXI reads
  its hit-test root from `renderer.lastObjectRendered`, and a browser pane that
  is not compositing never renders one. Call `canvas.app.render()` immediately
  before each dispatch and the events land; without it every event is silently
  dropped and the layer looks dead. Convert scene to client coordinates with
  `canvas.stage.toGlobal(new PIXI.Point(x, y))` plus the element's
  `getBoundingClientRect()`.
- **Drag a wall** with `pointerdown` at the start, TWO `pointermove`s (one short
  to pass the drag threshold, one to the end), then `pointerup` — all with
  `pointerId: 1, pointerType: "mouse", isPrimary: true`, `buttons: 1` while held
  and `0` on release. Right-click is the same with `button: 2, buttons: 2`.
- The pane must be **sized before the world loads**: a hidden or 0x0 pane fails
  canvas init outright ("Framebuffer width or height is zero") and `canvas.ready`
  never comes. Resize, then reload.
- **A player lands on the ACTIVE scene**, which may be another session's leftover.
  Give your own fixture scene `ownership.default = OBSERVER` and `scene.view()`
  it from the player seat rather than activating it — the scene is deleted at
  teardown, so nothing needs restoring.

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
6. Trap tool with NOTHING selected: `ui.controls.activate({control:"walls",
   tool:"wall"})`, then press `acksTrapLine`.
   *Observable:* **no wall is created**; `game.settings.get("core","wallPalette")`
   carries `flags["acks-extras"].trap` with all four restrictions 0;
   `ui.controls.tool.name === "wall"`; the button's `li .notification-pip` has
   class `active`. Then drag a wall out (see the drag recipe above): it lands on
   the dragged coordinates, blocks nothing, and carries an armed trap layer.
6a. Trap marker gestures, as a GM on the Walls control: hover, left-click,
   left-click, right-click, right-click the marker at the wall's midpoint.
   *Observable:* the hover readout names the trap, its state and who can see it;
   left flips `armed` ⇄ `disarmed` and never touches `known`; right flips `known`
   and never touches the state; a notification names each. Set the trap
   `discharged` with both ledgers populated and left-click it: `armed`,
   `known: false`, and **both ledgers empty** — a merge write leaves them full,
   which is the bug this asserts against.
6b. The gate: `ui.controls.activate({control:"tokens"})` and click the same
   point.
   *Observable:* the marker is still drawn, `hitTest` at its centre no longer
   returns a `cursor: "pointer"` target, and nothing about the trap changes.
   Repeat all of 6a on a trap ZONE from the Regions control — same answers.
6c. A player seat (join as `Player`, `scene.view()` a scene they observe, open
   the **Regions** control, which players have).
   *Observable:* a hidden trap has NO marker at all; a `known` one has a marker
   whose `eventMode` is `"none"` and whose container's `interactiveChildren` is
   `false`. A player on a listed control still cannot work a trap.
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
10. Environment sweep under a burst delete: build a party actor, 3 members and
    a scene carrying `fogOriginal` and `measure` (give a member the Mapper role
    and a lit unshielded torch, then run one sweep so the flags land). Delete
    party actor → each member → scene, fully awaited and back-to-back. Repeat
    at least three times — the race does not fire every run.
    *Observable:* no `environment sync step "…" failed` in the console. Lines
    reading `skipped: its target was deleted mid-sweep` at DEBUG are the
    designed outcome, not a failure. Then prove the guard still reports real
    faults: with the party token and scene both alive, monkey-patch
    `scene.update` in page context to throw and toggle the Mapper role off —
    that MUST log as `failed` with a stack, never as skipped.
    *Also observe the LEDGER, in the same session:* `getFormations()` holds no
    record whose `actorId` no longer resolves. Check it before any relaunch —
    `pruneFormations` sweeps orphans at `ready` on a NEW GM client, so a
    reconnect hides exactly what this step is looking for. Run the bulk variant
    too (`Actor.deleteDocuments([party, m1, m2, m3])` in one call, what a
    sidebar multi-select issues); it is the fastest path and the likeliest to
    orphan. Repeat at least three times — the window is one settings
    round-trip, so a single clean run proves nothing.
11. Player seat (second browser — the capture driver's, not another pane tab):
   join as a seat owning one member.
   *Observable:* markers are drawn ONLY for `known` placements; the dialog
   offers only that seat's own characters and only found traps; the party
   sheet shows the Trapbreaking button; pressing "Work on it" announces
   "… works on the trap." publicly and the disarm question opens on the
   JUDGE's client.

## Mounts and the train (added with the stations release)

1. Mount a member on a disposable animal
   (`acksExtras.lib.mount.mountActor(rider, horse)`), open the party sheet.
   *Observable:* the member's row grows a riding chip naming the mount; the
   chip's × dismounts (GM, or the member's own player — verify from the
   player seat that another player's chip refuses); the **Train** section
   lists the horse with its pace.
2. Harness that mount to a disposable vehicle (`attach(horse, vehicle,
   "draft", …)`).
   *Observable:* the Train lists the VEHICLE too, with its stations summary
   (`Team x/y · …`), and the pace-setter mark sits on whichever carrier's
   pace equals the party's speed; `partySpeed` equals the vehicle's pace
   (chain root), not the horse's.
3. Delete the vehicle.
   *Observable:* the train row vanishes on the next render and the member's
   pace falls back to the horse (then to their own legs after dismount).

## The journey (added with the travel mode)

1. On the GM window, **Begin journey**.
   *Observable:* the panel opens (pickers, day board, readout, hex row);
   `travel.mode === "journey"` and `clock.paused === true` on the record —
   moving the party token ticks NO dungeon turns while journeying.
2. Pick hills + earth road + raining, day kind Forced march. Run it twice:
   once with NO `travel` tables registered, once after registering invented
   rows (`acksExtras.lib.tables.registerTable(…, {priority: 20})`).
   *Observable:* without tables the readout carries the `tablesMissing` line
   and scales by pace alone; with them it lists each factor on its own line
   (terrain, then a road worth nothing in the rain) and the miles reflect
   both the ground and the forced pace; the four ancillary slots read as
   consumed and refuse edits. Step back to Dedicated march: the slots return
   EMPTY, not the forced march's overwrite.
3. Fill two ancillary slots (hunt, search), name a hex, **Next hex** twice.
   *Observable:* `travel.day.activities` holds the picks; `hexesEntered`
   reads 2; the hex label shows beside the trace.
4. **End day** twice.
   *Observable:* two log rows, newest first, carrying exactly the miles the
   readout showed (day 2 on top); the day board is fresh each morning; with
   the world-clock setting on, `game.time.worldTime` advanced 86,400 per
   day — and with it off, it did not.
5. Mark **Lost** with a judge note, then join as the provisioned Player.
   *Observable:* the player sees the readout, the hex label and the log —
   no pickers, no day board, no lost mark, no note. The GM sees the compass
   mark on the hex row and in the log rows.
6. **Return to delve** mid-journey.
   *Observable:* `clock.paused` false — token movement ticks turns again —
   and re-entering journey mode finds the day board where it stood.

## Teardown

Delete the scene, the party actor (its formation goes with it), the member
actors, and the trap item. Confirm `getFormations()` no longer lists the
formation. Sweep the chat too — a trap probe fills it with whispered cards, and
`game.messages.filter(m => m.content.includes("<your fixture prefix>"))` is what
finds them.
