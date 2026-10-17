# Formation — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server
and driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

The walks that drive this recipe are `tools/live/formation-hex.mjs`,
`tools/live/formation-day.mjs`, `tools/live/formation-steps.mjs` and the
country part of `tools/live/battlemap.mjs` (`node tools/live/run.mjs <name>`;
`tools/live/README.md` is the contract). Each walk's header names the sections
it covers; a section no walk names is walked by hand.

## Fixtures

- A disposable scene with walls (traps need a wall to arm against).
- A disposable `acks-extras.party` Actor — creating it auto-creates its
  formation (createActor hook); placing its token adopts the token.
- Two or three disposable character actors as members.
- A trap Item of the flavor under test.

## Core drive mechanics (non-obvious, learned live)

- **A member joins through the token HUD, not by being placed.** Dropping a
  character's token onto the scene the party stands on enrols nobody — the
  formation's `members` stays empty and every deployment check then silently
  tests nothing. Select the token, bind its HUD
  (`canvas.hud.token.bind(canvas.tokens.get(id))`) and click
  `#token-hud .acks-formation-hud`. Enrolling DELETES the member's own token:
  they ride inside the party token from then on, and a step that needs their
  own body on the map must create it afterwards.
- **Detach is the deploy gesture**, `[data-action="toggleDetach"]` on the party
  sheet, and it writes `deployedTokenId`. Clicking the same selector again does
  not reliably recall — re-read the member record and assert
  `deployedTokenId` rather than assuming the toggle returned them.

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
- **Create a fixture scene with `active: false`.** When no scene is active,
  core activates a newly created one (`Scene._preCreateOperation`), and every
  joined client, a peer session's included, starts drawing it. A party token
  placed before that draw finishes throws in `Token._onUpdate` (`reading
  'OBJECTS'`), which rejects the adoption hook's `setFlag`: the token carries
  `formationId`, the formation never records its `tokenId`, and no zone is
  ever found under the party. Zone lookups and throws need no canvas; a step
  that does (walls, above) views the scene and waits.
- **A formation that vanishes mid-walk was deleted from outside.** Deleting a
  party actor dissolves its formation, so a record that is gone between
  `setJourneyMode` and the next read was taken by another session sweeping
  outside its own ledger. Teardown is by the run's own ids
  (`.claude/rules/live-testing.md`, step 4); a walk that died before its
  sweep has its ids in its log — re-track them and `sweepTracked()`.
- **Hold the Gamemaster seat alone.** The seat's windows elect one to run the
  automation (docs/lib/MODEL.md, "Which window automates"). A second one,
  whether a peer's walk or an idle pane, may be the window that bills your
  moves, and one still running code from before the election bills them
  again: a move billed twice, a write lost. `game.users.filter(u =>
  u.active)` lists the seat once however many clients hold it. The server's
  debug log names each authentication (TEST_ENVIRONMENT).
- **Drag a token with trusted mouse input**, CDP `Input.dispatchMouseEvent`
  on the driver's page. `Token#_canDrag` refuses unless the token is
  controlled and `game.activeTool === "select"`
  (`ui.controls.activate({ control: "tokens", tool: "select" })`). Core starts
  the drag on the first move 10 px past the press and cancels it at a 500 ms
  long press. A press that stalls the page past that cancels the drag: the
  overdue timer runs before the queued moves, and the stalled frame's
  `ticker.elapsedMS` throttles the moves after it. The first press on a token
  can be such a stall (TEST_ENVIRONMENT), so click the token once and pause
  before the press that drags. Then step about 12 px, then 10 px every 20 ms, and
  release at the end.

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
   **The swap must also be a PIVOT** — width and height are Foundry movement
   fields, so this is the check that the turn stays put rather than lurching.
   Use a frontage wide enough that the axes differ visibly (6 gives 3.5 × 1),
   and compare the token's CENTRE (`x + width * grid.size / 2`, same for y),
   never its `x`/`y` — the corner is *supposed* to move. Across the rotation:
   the centre is unchanged (±1px, core rounds), `clock.turnsTotal`,
   `roundsPartial` and `carryFeet` are all unchanged, and `clock.lastPosition`
   has re-baselined to the token's new corner. Rotate a block sitting against a
   wall too: the pivot carries `ignoreWalls`, so a footprint that swings into
   the wall must still land on the centre rather than being shoved off it.
   Then walk an ordinary step and confirm the distance billed is the distance
   walked — a stale baseline shows up here and nowhere else.
   *Drive note:* the animated half needs a real animated move, not
   `animate: false`. Issue `token.move({x: <far>})` from a north/south facing so
   core's `tokenAutoRotate` fires, and sample the RENDERED position
   (`token.object.position.x`, which tweens) against `token.document.x` (the
   final value) every ~150ms. Partway through, the rendered position must lie
   between origin and destination; a resize that cancels the walk shows up as
   the two being equal almost immediately, and is invisible to any check that
   only reads the document.
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
11a. **A player leaves their own character behind.** Player seat owning one
    member (a second, GM-owned member beside them), the party token on the
    scene, the owned member brought to 0 hit points (the control renders for
    a casualty only): press **Leave behind**
    (`[data-action="toggleLeftBehind"]`) on the seat's own row on the Order tab.
    *Observable:* the member's record in `getFormations()` reads `left: true`
    and carries a `deployedTokenId` for a token standing where the party does
    (no `detached` flag); the GM seat's chat shows the public line "leaves
    {name} behind."; the control now reads **Go back for them**, and pressing
    it recalls the token. Pressing the GM-owned member's control is not
    offered to this seat. With the formation in combat the press posts nothing
    public and whispers the seat a refusal. Teardown by the run's own ids: the
    token the press made is tracked by reading `deployedTokenId` back, and the
    chat card ids the same way.
12. **An item dropped on the party sheet is refused.** As GM drop a piece of
    a member's gear on the party sheet, then a coin row with a count above
    zero. Give the Player seat ownership of the party actor and of that member,
    and drop both again from that seat.
    *Observable:* one warning per drop naming the party, in the wording every
    sheet that lists no goods uses; `party.items.size` is still 0 and the
    member holds what was dragged. The GM's drops prove the member drop
    (`bindMemberDrop`), the Player seat's prove the sheet's `_onDropItem` —
    that seat has no member drop bound, so it is the base class's route. Read
    the warnings by wrapping `ui.notifications.warn` on the seat that drops. A
    party fixture needed for this step alone can be made with
    `flags["acks-extras"].formationId` naming no formation: its sheet opens and
    no formation record is written.
13. **The door dialog writes the door, reports a botch, and spends a batter.**
    Fixtures: a disposable scene holding two door walls (`door: 1`); a disposable character with a token on the
    scene; a disposable formation holding that character (`api.create` the
    actor, add it with the formation's own add-member path); a second character
    in no formation. Select the door on the Walls layer, select the first
    character's token, and press the **ACKS door actions** tool.
    - *Construction.* Pick another construction in the select.
      *Observable:* re-read `wall.flags["acks-extras"].door.kind` from the
      document (not the DOM) and see the new value; the **Turns with an axe**
      figure follows it, and a construction an axe cannot beat shows the
      "will not do it" hint in place of the button.
    - *Marks.* Tick **Evil**, then **Lock jammed**, then untick **Evil**.
      *Observable:* the wall's `door.evil` and `door.jammed` flags read
      `false`/`true` after the last change, and `api.doors.doorState(wall)`
      returns the same; the spikes count is unchanged by each write.
    - *Botch.* Rig the d20 to show a 1 (the dice rig reads from the top; probe
      one roll after rigging) and press **Heave**.
      *Observable:* the card carries a "Damage to {name}" line and the
      "reported, not applied" note; the character's hit points are unchanged.
      An ordinary miss carries neither line.
    - *Batter.* On a construction an axe can beat, read
      `getFormations()[id].clock.turnsTotal`, press **Batter it down** with the
      formation's member selected.
      *Observable:* `turnsTotal` rose by exactly the turns the button showed,
      a turn card posted, the wall's `ds` reads 1, and
      the notification names the turns and the formation. Repeat with the
      unformed character selected on the second door.
      *Observable:* the door opens, no clock moved, and the notification says
      no formation holds the basher.
    Teardown by the run's own ids: the actors, the scene (its walls go with
    it) and the formation; track each chat card id as it lands.
14. **A marcher's survival state bars the forced march; only the Judge
    overrides it.** Fixtures (each recorded with `api.create`): a disposable
    scene with a disposable `acks-extras.party` actor on it, and two disposable
    character actors enrolled through the token HUD (see the drive mechanics
    above). Put one member on a barring rung by writing that disposable
    actor's own flag through the API: `await actor.setFlag("acks-extras",
    "survival", { nourishment: "underfed" })` (`hydration: "dehydrated"` and
    `exposure: "hypothermic"` are the other two ladders' barring rungs; a flag
    with no keys, or `nourishment: "hungry"`, is a plain rung). Set the party's
    mode to journey and find the **Day** section of the party sheet's
    Wilderness tab on the GM seat.
    - *Refusal.* With the one member underfed, pick **Forced march** in the day
      board's select.
      *Observable:* a confirm dialog names that member (and only them); press
      **Leave the day as it is**. Re-read `getFormations()[id].travel.day.kind`
      from the document: still `march`; the select redraws on Dedicated march; no chat
      note posted.
    - *Override.* Pick **Forced march** again and press **Set it anyway**.
      *Observable:* `travel.day.kind` reads `forced`, all four `day.activities`
      read `travel`, and one Judge-whispered card names the member (its `whisper`
      holds the GM user ids only, so a Player seat's chat log lacks it). Pick
      **Dedicated march** and **Forced march** once more with the member still barred:
      the dialog returns, so the override is per change and never a standing
      permission.
    - *A plain rung.* Set the member's flag to `{ nourishment: "hungry" }` and
      pick **Forced march** from March: no dialog, the kind is `forced`.
    - *The API obeys the same bar.* With the member underfed again and the kind
      on March, `await acksExtras.formation.travel.setDayKind(id, "forced")`.
      *Observable:* it resolves `false`, a warning names the member, the kind
      stays `march`. From the Player seat, `setDayKind(id, "forced", { override:
      true })` also resolves `false`; from the GM seat the same call resolves
      the record, sets `forced` and posts one more whispered card.
    - *The dusk offer.* Spend the day (set `travel.day.hours` past the day's
      budget with `patchFormation`, then drag the party token one hex) so the
      question opens; answer **Push on (forced march)**.
      *Observable:* a warning naming the member; `travel.day.kind` still
      `march`; the travel log's length unchanged (the day was not closed).
    - *A Player seat.* Join the Player seat on the formation's scene.
      *Observable:* the Day section, its select and the override dialog are
      absent (the section is the Judge's alone).
    Teardown by the run's own ids: `api.sweepTracked()` removes the scene and
    the actors (the party actor dissolves its formation); track each chat card
    id as it lands. No world document outside that ledger is touched: the
    survival flag lives on the disposable actors and goes with them.

## A move the GM's client is drawing (added with the stored-position fix)

The clock, the journey and the trap check measure a move to where it put the
party, on the client that animates the token as well (DECISIONS 2026-10-17).
No walk in `tools/live/` names this section.

Fixtures: two disposable scenes A and B (`active: false`, `padding: 0`, a
100 px grid of 5 ft, wide enough for four 500 px steps east), a disposable
character, a party actor with the character joined by drop, and the party
token on A at (500, 500) with `actorLink: true`. Hold the Gamemaster seat
alone (Core drive mechanics). Arm an `updateToken` observer that records, per
move, `changes.x`, `tokenDoc.x`, `tokenDoc._source.x` and
`options._movement[id].destination.x`. It is an observer and never a delete
list.

Each step moves the token 500 px (25 ft) east and waits ~5 s. Compare the
record's `clock` before and after: rounds times a round's share of the
formation's `turnDistance`, plus the change in `carryFeet`, is the distance
billed.

1. View A and `await token.update({ x: token._source.x + 500 })`.
   *Observable:* the hook saw `tokenDoc.x` at the start and `_source.x` at the
   destination, so the GM's client is drawing the move (the condition under
   test). 25 ft is billed, and `clock.lastPosition` equals the token's
   `_source`.
2. Do it again, still viewing A.
   *Observable:* 25 ft again. The code before the fix billed each drawn move
   one move late: 0 at step 1, then step 1's 25 ft here.
3. View B, then move the token on A.
   *Observable:* 25 ft. This is the control: nothing draws the token, so the
   hook's `tokenDoc.x` already equals the destination.
4. View A and drag the token with a real gesture (Core drive mechanics).
   *Observable:* as step 1, and the hook's `_movement` method is `dragging`.
   Turned east by the drag, the party is resized a moment later: a second,
   unanimated write moves the corner and bills nothing, and `lastPosition`
   follows it to the token's new `_source`.
5. Pause from the party sheet's pause tool (`data-action="togglePause"`),
   move the token 500 px east, and press the same tool again while the move
   is still drawn. At core's default `CONFIG.Token.movement.defaultSpeed` (6
   spaces a second) a 500 px move draws for under a second, so read
   `token.x !== token._source.x` just before the press to prove it was.
   *Observable:* `clock.lastPosition` equals `_source`, and the next 500 px
   move bills 25 ft. A re-anchor on the prepared corner billed the rest of
   the paused move with it.
6. Arm an `updateSetting` observer on `acks-extras.formations` that records,
   per write, the record's `travel.mode`, `clock.lastPosition` and rounds.
   Move the token 1000 px east and switch the mode in the same tick, while
   the move is still drawn (checked the same way, before and after the call):
   `await token.update({ x: token._source.x + 1000 });`
   `await acksExtras.formation.travel.setJourneyMode(id, "journey")`. Wait
   ~5 s, then switch back to `"delve"`.
   *Observable:* the observer sees the switch's write (mode `journey`) before
   the move's own write, which lands about 0.2 s later from a copy the
   movement hook read before the switch. A write that bills nothing can land
   between them, so the move's write is the first whose rounds or carried
   feet change, not the second write seen. The move's write keeps `journey`,
   bills 50 ft, and leaves `clock.lastPosition` at `_source`. A whole write
   from that copy put `delve` back (DECISIONS 2026-10-17, "A whole write
   carries only what its copy changed").

The recall with no body on the party's scene, the hop to a place the party
already stands on and the step onto a shadow are pinned offline only
(DECISIONS 2026-10-17, "A re-anchor reads the party token's stored corner").

Steps 7–9 ask what ground the party stands on while its move is drawn
(DECISIONS 2026-10-17, "The ground under the party is read at the token's
stored corner"). Each wants a move that completes a turn, so they run on a
scene C of their own: as A, with room for one 500 px step south as well, but
its cell is the formation's `turnDistance` times 1.2, divided by 5 and
rounded up, read once the member has joined. The party token settles
smaller there, so take its centre from `_source` (the corner plus half its
`width`/`height` in pixels) after adoption. Each zone is a Region made
beside the move, a 400 px square whose near edge stands 250 px past that
centre, so only the move's far half is inside it. The
`updateToken` observer proves a move is drawn when it starts, not when the
ground is read a few hundred milliseconds into the chain: arm a
`preCreateChatMessage` observer, and an `updateSetting` one on
`acks-extras.formations`, that records at that moment whether the token is
still drawn and whether the zone holds its prepared centre and its stored
one. At core's default speed every read below landed inside the move's
~0.8 s draw.

7. Add an encounter zone (`acks-extras.encounterZone`, `encounterEvery: 1`)
   east of the token, view C, and move the token 500 px east.
   *Observable:* the turn's throw card says `in zone "<the region's name>"`,
   and when it was created the token was still drawn, with its prepared
   centre outside the zone and its stored centre inside. The prepared centre
   is the one the code before the fix asked about.
8. Create a trap Item (`acks-extras.trap`, `triggerOn: 0`, so it never
   springs) and a trap zone (`acks-extras.trapZone`, `trapUuid` the item's
   uuid, `state: "armed"`) south of the token, and move it 500 px south.
   *Observable:* the check's "The trap is not sprung" card is created while
   the token is drawn, its prepared centre outside the zone.
9. `await acksExtras.formation.travel.setJourneyMode(id, "journey")` and wait
   for it to land (`clock.lastPosition` equals `_source`). Add an encounter
   zone with `journeyCadence: "entry"` east of the token and move it 500 px
   east.
   *Observable:* the move's own record write, the first whose
   `clock.lastPosition` is the token's `_source`, lands while the token is
   drawn with its prepared centre outside the zone, and its `clock.zoneIds`
   names the zone. The day's first step posts a navigation card; track it.

Teardown by the run's own ids: `api.sweepTracked()` removes the scenes, the
trap Item and the actors (the party actor dissolves its formation). Track
each chat card id as it lands.

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

1. On the GM window, pick **Journey** in the band's mode select.
   *Observable:* the mode tab becomes Wilderness, its strip shows the journey
   cells and the declaration sections sit under it; `travel.mode === "journey"`
   on the record and `clock.paused`
   is NOT set — moving the party token ticks NO dungeon turns while journeying.
2. Pick hills and an earth road in the Judge's hand, raining in Sky, and day
   kind Forced march. Run it twice:
   once with NO `travel` tables registered, once after registering invented
   rows (`acksExtras.lib.tables.registerTable(…, {priority: 20})`).
   *Observable:* without tables the readout carries the `tablesMissing` line
   and scales by pace alone; with them the speed cell's tooltip carries the
   factors joined on one line with ` · ` (terrain, then a road worth nothing
   in the rain) and the miles reflect
   both the ground and the forced pace; the four ancillary slots read as
   consumed and refuse edits. Step back to Dedicated march: the slots return
   EMPTY, not the forced march's overwrite.
3. Fill two ancillary slots (hunt, search), name a hex, **Next hex** twice.
   *Observable:* `travel.day.activities` holds the picks; `hexesEntered`
   reads 2; the hex label shows beside the trace.
4. **End day** twice.
   *Observable:* two log rows, newest first, carrying exactly the miles the
   readout showed (day 2 on top); the day board is fresh each morning; with
   the world-clock setting on, `game.time.worldTime` stands at the next dawn
   after each (`untilNextDawn`) — and with it off, it did not move.
5. Mark **Lost** with a judge note, then join as the provisioned Player.
   *Observable:* the player sees the strip, the Country cards, the camp's
   forecast and the log on Sightings — no pickers, no day board, no lost mark,
   no note, no Judge tab.
   The GM sees the astray line in The episode section of the Judge's tab and
   the compass mark in the log rows.
6. Pick **Delve** in the band's mode select mid-journey.
   *Observable:* the baseline re-anchors to the token — the first turn card
   falls one exploration move from where the mode changed — and re-entering
   journey mode finds the day board where it stood.

## The weather (added with the generator)

Register an invented `weather` document first
(`acksExtras.lib.tables.registerTable({id:"weather", tables:{…}}, {priority:
20})` — copy `tools/test-weather.mjs`'s SAMPLE_WEATHER; its values are
invented, so nothing printed enters the world). The band selects need no
tables at all — that is step 1's point.

1. With NO weather tables: pick a temperature/precipitation/wind by hand
   (e.g. the rainy kind), and an earth road in the Judge's hand.
   *Observable:* the "import the weather tables" hint shows, **Roll the
   sky** is disabled, the condition chips render for the hand-picked bands,
   and the readout's road line reads washed out — the manual sky reaches
   the road vocabulary without any import.
2. Register the invented document, re-render, pick a climate in the Judge's
   hand and a season, **Roll the sky** several times.
   *Observable:* the button enables and the hint goes; each roll writes
   bands consistent with the invented rows; the night temperature line
   shows; conditions chip and the readout lists each active condition's
   factor on its own line.
3. Arm **Roll at day's end** and **Fronts**, then **End day** three times.
   *Observable:* each morning has a fresh generated sky; each log row
   carries the FINISHED day's weather (localized band line, no rolls or
   counters in the row); with fronts on, consecutive days' bands drift
   rather than jump (probe `travel.weather.rolls` between days).
4. Force the footing: set precipitation to the rainy kind on a mud-prone
   ground (grassland) and **End day**; then hand-set snow via the Snow lies
   toggle.
   *Observable:* after the rainy day the Mud select reads Muddy and the
   muddy chip shows; with a land vehicle in the train (harness one from the
   vehicles recipe) the wheels warning line names it — mud-bound off
   pavement, then snow-bound with snow on; switching the road to paved in the
   Judge's hand clears the MUD refusal (the snow one stays) and the readout shows the
   pavement holding.
5. Join as the provisioned Player.
   *Observable:* chips, night line and wheel warnings render; no selects,
   no generator row.

Teardown for the weather half: `acksExtras.lib.tables.unregisterTable` (or
relaunch) removes the invented document; confirm the hint returns.

## The encounters (added with the chain)

Register two invented documents first — copy `tools/test-encounters.mjs`'s
SAMPLE (the `encounters` doc: invented bands, QQ-prefixed names) and its
SAMPLE_FREQUENCY (the `travel` doc's cadence cells steps 4–5 read); nothing
printed enters the world. Fixtures: the journeying party from the weather
recipe, plus one world actor named to match an invented creature name
(e.g. "QQ Prowler") so resolution has something to find.

1. With NO encounters document: press **Encounter throw**.
   *Observable:* one Judge-whispered card saying the encounter tables are
   not imported — no rolls, no errors.
2. Register the invented document, pick a territory the sample covers in the
   Judge's hand, press **Encounter throw** several times.
   *Observable:* each card lists every d20 with its column and outcome
   (Column Shift results show two rolls); a monster outcome adds the
   rarity roll and the d100 draw; the drawn name matching the fixture
   actor renders as a document link, an unmatched one as plain text with
   no link; a draw whose table the sample lacks shows the
   "draw from your book" line naming the table.
3. The encounter terrain in the Judge's hand: leave it blank over a ground
   with a default (the Country section's *Encounters draw on* line names the
   derived sub-table); pick another and throw.
   *Observable:* the card's "Terrain sub-table" line follows the pick, and the
   Country section's line with it.
4. Turn ON "Journey encounter throws", enter a hex (button or token move
   on a painted hex scene), then **End day** with a hunt and a search slot
   filled.
   *Observable:* the hex entry posts one card by itself (the FIRST arrival
   on a painted scene names the hex without throwing); End Day posts one
   card per hunt/search slot. With the setting OFF, neither trigger posts.
5. Camp day with the setting on: **End day**.
   *Observable:* terrain-encounter outcomes on any card stand down ("no
   encounter" with the stood-down note); resting cells the sample defines
   post their cards.
6. Player seat: throws whisper the Judge only — the player's chat shows
   nothing.
7. What a terrain result leads to: register the document
   `tools/test-encounters.mjs` builds for its follow-up checks (SAMPLE plus
   invented `terrainEncounters` lists, `terrainSubTables` and the two
   lookups). No button lands a chosen result, so drive it in page context:
   import `scripts/formation/encounters.mjs` and
   `scripts/formation/encounter-card.mjs` from `/modules/acks-extras/`, call
   `runEncounter({ territory, terrain, rng })` with an `rng` whose faces land
   the territory d20 on a terrain-encounter band and the d12 on a result with
   follow-ups, and pass the chain to `postEncounterCard(formation, chain,
   { terrain })`. Faces are `(face - 0.5) / sides`.
   *Observable:* under the result line, one numbered line per sub-table
   roll, naming the table, its die and the roll. A power roll on its table's
   last band adds a third line from the next table. The lookup line gives the
   terrain's row, with a positive modifier signed. With the terrain select
   unset, the lookup shows nothing and no book line either. With a sub-table
   missing from the document, the card names `terrainSubTables` once.

Teardown: unregister the invented document, delete the QQ actor, setting
back off.

## The wrong-floor shift (added with the Monster level row)

Fixtures, all created and tracked: a scene created with `active: false` (Core
drive mechanics) and the party actor's token placed on it — the throw needs no
member; an **inner** RollTable with one text result; an
**outer** RollTable whose only result is a document result naming the inner
table (`type: "document"`, `documentUuid: inner.uuid`); a Region over the party
token with an `acks-extras.encounterZone` behavior, `encounterTarget: 1` so
every throw hits, `tableUuid` the outer table. Levels are invented.

1. **The row.** Open the inner table's sheet, switch it to edit, open its
   Summary tab.
   *Observable:* a labelled **Monster level** row with its hint sits under
   *Display roll*, its input exactly as wide as the Roll Formula input (compare
   `getBoundingClientRect().width` of `input[name="formula"]` and
   `input[name="flags.acks-extras.monsterLevel"]`). Type a level and press
   **Save**: `inner.getFlag("acks-extras", "monsterLevel")` is that number.
   Blank it and Save: the flag reads `null`. In view mode there is no row.
2. **The zone's field.** Open the behavior's config.
   *Observable:* the **Dungeon level** field carries its label and hint. Set a
   level different from the inner table's.
3. **The shift.** In the delve, press the party sheet's encounter tool on the
   quick-tools rail (`data-action="encounterNow"`, the wandering-monster throw;
   on a journey the same cell is `travelEncounterThrow`, the wilderness chain,
   which never shifts).
   *Observable:* after the table's own card, one card flavored *Wandering
   monster, off its floor*, spoken as the INNER table, whose line names the
   inner level and the zone's; its `whisper` is the GM ids and nothing else.
   A card named for the outer table is the regression: the level was read off
   the table the zone names.
4. **No shift.** Set the zone's level equal to the inner table's, throw; then 0,
   throw.
   *Observable:* the draw card each time, and no shift card either time.
5. **The fallback.** Blank the inner table's level, give the outer table one,
   throw.
   *Observable:* the shift card is still named for the inner table, at the
   outer table's level.
6. **The player seat.** Join the Player seat before the first throw, with its
   chat tab open, and post one public control message after the last.
   *Observable:* every card the throws posted shows the three facts of
   docs/lib/TESTING.md, "A Judge-only card leaves nothing on a player's seat",
   and the control renders. Reload the seat: the log it renders at join shows
   none of the cards either.

Teardown: `api.track` every card the throws posted, by the ids read back the
moment each throw resolves, then `api.sweepTracked()` — the scene, the party
actor (its formation dissolves with it), both tables, the control message and
the cards go together.

## The camp panel

`buildFormationView(record).travel.camp` over a formation-shaped record of REAL
actors is the way to check this. **Dropping tokens does not seat members** in a
scripted run: `addTokensToParty` works from `canvas.tokens.controlled`, so a
token created by script joins nobody and the panel correctly reports an empty
order. Build the record instead.

*Observable:* `mouths` counts the order; `forecast.foodDays` is the POOLED
supply divided by mouths (a week's rations across two is three whole days);
`suffering` lists only members off the top rung, localized, carrying any
Constitution lost. The rendered section carries no raw lang keys.

## Deal XP

Fixtures: the party actor with two characters enrolled, plus a disposable
monster actor carrying a henchman record (`flags.acks-extras.record` with
`terms.xpShare`) enrolled beside them.

1. As the GM, open the party sheet.
   *Observable:* the experience cell among the quick tools
   (`[data-action="dealXp"]`). It is gated on the GM seat alone — the sheet's
   context carries no `canControl`, so a gate on it hides the cell from
   everyone.
2. With the `ownXpDealing` setting on, open the system party sheet.
   *Observable:* its own Deal XP button is hidden and the moved-hint says where
   dealing lives; with the setting off, the system's button is back.
3. Import the tables (the `experience` document must hold `keyAttributeXp`;
   check `acksExtras.lib.tables.getDoc("experience")`). Give one character a
   class with a key attribute and a score in an adjusting band, and a second a
   non-zero Actor Tweaks `system.details.xp.bonus`.
   *Observable:* the Class tab's XP label reads the percentage and its source
   (the attribute, or "Tweaks"); before the import it reads "adjustment not
   imported".
4. Press **Deal XP**, enter a total, confirm.
   *Observable:* the dialog lists each share, its adjustment and the adjusted
   gain before anything is written; after confirming, each character's
   `system.details.xp.value` rises by exactly the listed Gains — the Tweaks
   character included, whose percentage core applies to the unadjusted base.
   Core posts a card per character. Those cards and the dialog's summary card
   are all created by the run: read them back and `api.track` each. The
   monster henchman is listed with a share and a "Not recorded" note, and its
   sheet is not written — the system keeps no experience for a monster.
5. Enrol hirelings by hand on the system sheet: a disposable employer
   `character`, plus three `character` actors whose `system.retainer` is
   written by an update after the create (`enabled: true`,
   `managerid: <employer id>`, `category` `mercenary`, `specialist` and
   `henchman`). Link each with `employer.addHenchman(id)`. Read
   `api.formation.xp.shareFor` (or import `formation/xp-shares.mjs`) for each,
   then run `enrollNewcomers(employer)` from `henchmen/engine/events.mjs` and
   read them again.
   *Observable:* both times, the mercenary and the specialist take 0 with the
   reason `mercenary` and the henchman takes 0.5, never a full share. A
   `divideXp` over all four lists the two in `excluded`.

## An unlinked member's own hit points (added with the hit-point tool)

Covers `memberOwnToken`, `memberHp`, the member-aware `isDown` / `isDead`,
`party-roster.mjs`, and the party sheet's **Hit points** figure. The tool itself
is lib's recipe "The hit-point tool" (docs/lib/TESTING.md).

**Fixtures (as GM, each id recorded with `api.create` or `api.track`):**
- A scene created with `active: false`, and a disposable party actor whose
  token is placed on it and adopted.
- "HP Hero", a `character` with `prototypeToken.actorLink: true`, and "HP
  Hireling", a `monster` with `prototypeToken.actorLink: false` and hit points
  6 of 6, written by an update after the create. Each has a token on the
  scene, enrolled through the token HUD. Enrolling deletes the token, and the
  hireling's stash keeps `actorLink: false`.
- Before enrolling, write the hireling token's own hit points to 6 of 6 with
  `token.actor.update(...)`. While the system's `autoRollMonsterHP` setting is
  on, an unlinked monster token rolls its own when placed, and the world
  actor's 6 never reaches it.

1. **The hit-point figure opens the tool on the party.** As GM, open the party
   sheet and press the **Hit points** cell on the figures rail
   (`[data-action="adjustHp"]`).
   **Observable:** rows HP Hero and HP Hireling, each noting the party's name.
2. **A member inside the party token is written into the stash.** Damage `4`.
   **Observable:** in `getFormations()`, the hireling member's
   `tokenData.delta.system.hp.value` is 2. The HP Hireling world actor still
   reads 6 of 6. The card's subtitle is the party's name. The Hit points cell
   reads "1 hurt", on the GM seat and on a player seat that has the sheet open.
3. **Down by their own hit points.** Damage `2` more.
   **Observable:** the stash reads 0. On the Order tab, the hireling's row
   `li.member[data-actor-id=<HP Hireling id>]` has the `casualty` class and the
   skull badge, and offers **Leave behind**. HP Hero's row has neither. The
   world actor still reads 6.
4. **On the map, the live token.** Heal `5`, then detach the hireling
   (`[data-action="toggleDetach"]`). A down member is carried rather than
   deployed, so healing comes first. Select the hireling's new token and damage
   it `6` with the Tokens-layer button.
   **Observable:** before the damage, the new token reads 5 of 6: the stash's
   hit points, kept over the system's roll, which would set the value and the
   maximum alike. The tool's row is the token's actor. After the damage, the
   Order tab marks the hireling a casualty while they stand on the map, and
   the world actor still reads 6. Their detach control is still enabled,
   offering the recall.
5. **Recalled, still down.** Recall the hireling with that control (re-read
   `deployedTokenId` rather than trusting the toggle).
   **Observable:** the stash's `delta.system.hp.value` is −1, and the Order
   tab still marks the hireling a casualty.
6. **Dead is the token's too.** Set the hireling's stash to 4 with the tool.
   Toggle the dead status on a fresh detached token of theirs, which reads 4
   of 6, then recall them.
   **Observable:** the Order tab shows the hireling with the dead skull while
   the world actor carries no dead status, and the stash still reads 4.
7. **Leaving the party puts the stash back on the map.** Press the hireling's
   remove control on the Order tab (`[data-action="removeMember"]`), and
   `api.track()` the token of theirs that appears on the scene.
   **Observable:** that token reads 4 of 6, the stash's figure over the
   system's roll, and the hireling is gone from the record.

**Teardown.** `api.sweepTracked()`. The party actor dissolves its formation.
The member tokens that enrolling deleted, and the one the recall deleted, sweep
as missing.

## A detached member moved between scenes (added with the member-token fix)

Covers the member `deleteToken` hook in `module.mjs`, `followMemberToken`,
`deployedSceneId`, the recall of a token on another scene, a combat that
leaves such a member out (`outOfTheFight`, `combat-bridge.mjs`), and the
member fields a whole write keeps (`DEPLOYMENT_FIELDS`). Driven by a script
over the capture driver, from the Gamemaster and from the Assistant
Gamemaster, each on its own port; no walk in `tools/live` covers it. The
automation runs on the Gamemaster's client on both routes; the route names
the seat that moves the tokens. A group body moved on its own is
docs/lib/TESTING.md, "A group body moved between scenes".

**Fixtures**, each `api.create()`d or `api.track()`ed:
- Scenes A and B, the arrival and the departure: "A teleport between scenes"
  below.
- Two `character` actors, the scout and the guard; a monster with hit
  points, and an `acks-extras.group` actor given a stack of two of it with
  `acksExtras.lib.groups.addStack(group, monster, {count: 2})`. `api.track()`
  the stack's base actor when it is not the monster.
- A hand-created party actor, and the party token on A away from the
  departure, `actorLink: true`.

**Drive mechanics.**
- Poll the party actor's `flags.acks-extras.formationId` until it is set. The
  window that automates adopts a hand-created party actor, and no other
  (docs/lib/MODEL.md, "Which window automates").
- Drop the scout, the guard and the group on the party sheet, then click the
  scout's `[data-action="toggleDetach"]`. Read `deployedTokenId` back from
  the record and `api.track()` that token.
- A combat: `api.create("Combat", {scene: <A>})`, then
  `combat.createEmbeddedDocuments("Combatant", [{tokenId, sceneId, actorId}])`
  with the party token's. Deleting the combat is the combat's end.

1. **The party's step keeps the scout's re-anchor.** Move the scout one
   square on A, then the party token one square.
   **Observable:** `detach.anchor` is where the scout now stands.
2. **The record follows the scout.** From the seat under test, move the
   scout's token into the departure with `tokenDoc.update({x, y})`. Poll B
   for a token of the member's actor and `api.track()` it.
   **Observable:** in `getFormations()[id].members`, the scout's
   `deployedTokenId` is the arrival's id, `deployedSceneId` is B, `detached`
   is true, and `detach.anchor` is the arrival's `x`/`y`. The record's own
   `sceneId` still names A.
3. **The party's step does not pull the anchor back.** Move the party token
   one square on A.
   **Observable:** the anchor is still the scout's position on B.
4. **A combat on A leaves the scout out.** Add the party token to a combat on
   A. `api.track()` the guard's token (its `deployedTokenId`) and the stack's
   bodies (the tokens on A whose `flags.acks-extras.group` is the group's
   uuid).
   **Observable:** the record's `combat.active` is true; the scout keeps
   `detached` and the anchor; the combat holds a combatant for the guard and
   for each body, and none for the scout.
5. **The combat's end leaves the scout out.** Delete the combat.
   **Observable:** the record's `combat` is null, the guard has no
   `deployedTokenId`, no body of the group stands on A or B, and the scout
   still stands on B, detached.
6. **Another combat's end leaves the scout out.** Create a combat on B and
   delete it.
   **Observable:** the scout is unchanged, and the gesture posted no card.
7. **A stack with a body on B is gathered from there.** Press the group's
   detach control and track its two bodies. Move one into the departure,
   poll B for the token with that body's `member` flag, and track it. Press
   the control again.
   **Observable:** no body of the group stands on A or B, every roster record
   is `materialized` with an empty `tokenUuid`, and the cell has no
   `deployedStack`.
8. **The recall reaches the other scene.** Press the scout's detach control
   again.
   **Observable:** `deployedTokenId`, `deployedSceneId` and `detach` are gone,
   the member holds `tokenData`, and neither scene holds a token of the
   member's actor.
- Unfixed, step 2 kept the id with no scene and the anchor on A, and step 8
  cleared the record and left the token standing on B with nothing stashed.
  Steps 1, 4, 5 and 7 were measured unfixed offline only (the flows
  scenarios named in DECISIONS 2026-10-17, "A member on another scene: the
  recall, a combat, and whole writes").

**Teardown.** `api.sweepTracked()`. The detaches, recalls and the combat
post chat cards. Read each gesture's cards back right after it: the
`game.messages` ids that were not there before the gesture and that this
seat authored, read while the world holds no other seat. `api.track(id,
"ChatMessage")` each. The tokens the teleports, recalls and the reform
deleted, and both combats, sweep as missing.

## A combat's takeover (added with the takeover record)

Covers `deployedCombatId` (written by `deployMembers` and the takeover in
`onPartyCombatantCreated`, cleared by the recall), what a combat's end
gathers (`gatheredBy`, `combat-bridge.mjs`), the party token re-added to its
own combat, and a member left behind kept out of the fight
(`outOfTheFight`). Driven by a script over the capture driver on the
Gamemaster seat alone; no walk in `tools/live` covers it.

**Fixtures**, each `api.create()`d or `api.track()`ed:
- Scene A, viewed by the seat.
- Two `character` actors, the scout and the guard, and a `monster` at 0 hit
  points, the fallen.
- A hand-created party actor, and the party token on A, `actorLink: true`.

**Drive mechanics.**
- The adoption poll, the drop onto the party sheet and the party's combat are
  as in "A detached member moved between scenes".
- Press a row's control on the party sheet:
  `[data-actor-id="<id>"] [data-action="toggleDetach"]` for the scout,
  `[data-action="toggleLeftBehind"]` for the fallen (a casualty's row carries
  it). Read `deployedTokenId` back from the record and `api.track()` that
  token.
- A combat the party never joins: `api.create("Combat", {scene: <A>})`, then
  delete it.

1. **Another combat's end leaves a scout out.** Detach the scout, then create
   and delete a combat the party never joins.
   **Observable:** the scout keeps `detached` and the same `deployedTokenId`,
   the token still stands, and the gesture posted no card.
2. **A member left behind.** Press the fallen's leave-behind control.
   **Observable:** `left` is true and `deployedTokenId` names a token on A.
3. **The party joins a combat with a member left behind.** Add the party
   token to a combat on A. `api.track()` the guard's token.
   **Observable:** the record's `combat.active` is true. The combat holds a
   combatant for the guard and for the scout, none for the fallen and none
   for the party token. The scout's and the guard's `deployedCombatId` is the
   combat's id, and the scout has no `detached`. The fallen has no
   `deployedCombatId` and keeps `left` and the same token.
4. **The party token re-added is dropped.** Add the party token to the same
   combat again.
   **Observable:** the combatants are those of step 3.
5. **Another combat's end leaves the fight alone.** Create and delete another
   combat on A.
   **Observable:** `combat.active` is still true, the scout and the guard
   keep their tokens, and the gesture posted no card.
6. **The combat's end gathers what it took over.** Delete the party's combat.
   **Observable:** the record's `combat` is null. The scout and the guard
   have no `deployedTokenId` or `deployedCombatId`, hold `tokenData`, and no
   token of theirs stands. The party token is visible. The fallen keeps
   `left` and their token on A.
7. **Going back for the fallen.** Press the fallen's control again.
   **Observable:** `left` is false, `deployedTokenId` is gone, and no token of
   theirs stands.
- Unfixed, step 1 recalled the scout and posted the re-formed card, step 3
  dropped the party's combatant and deployed no one, and step 5 re-formed the
  party mid-fight. Measured offline only (the flows scenarios named in
  DECISIONS 2026-10-17, "A combat records whom it took over").

**Teardown.** `api.sweepTracked()`. The detach and the party's combat post
chat cards: track them as in "A detached member moved between scenes". The
three combats, and the tokens the reform and the recall deleted, sweep as
missing.

## End day, the whole tick (added with survival and the throw)

End day does two things here, and each can fail independently.

1. Journey a formation on `forest`, road `none`, with invented `gettingLost`
   and `navigationBonus` rows registered. `endDay(id, {miles, hexes})`.
   *Observable:* the day count advances, the log grows, and NO
   `.acks-extras-nav-card` appears: the navigation throw is made at the day's
   first step off a road, and End day makes none (*The hex the party is
   shown*, below, walks the throw).
2. Seat characters carrying rations and call `runProvisionDay`.
   *Observable:* the pool is the SUM across the order, so two days of food
   carried by one character feeds three mouths at half each, and all three
   actors carry a `flags.acks-extras.survival` with `nourishment: "hungry"` —
   including the two carrying nothing. That is the sharing rule.

**Two traps this recipe exists for.** A `ChatMessage` created with a numeric
`type` never appears and never throws — in v12+ `type` is a document SUBTYPE,
so the old style constant silently fails validation. And `addMember` is not
published on the API; members are seated by dropping tokens, so a scripted
check builds a formation-shaped record over real actors instead.

## Lost (added with the episode)

Fixtures: TWO disposable hex scenes, A and B, both with `tokenVision` and
`fogExploration` on. One or two disposable party actors, each with its party
token on A, in journey mode. Record every scene, actor and token id with
`api.track`.

**A player's fog from an earlier session** is the fixture that matters. Join
the Player seat in the capture driver's second browser, view A, and create a
FogExploration for that seat on A and on B holding a known bitmap (a lit
top-left quarter reads cleanly under a pixel probe). Track the ids from the
player's own ledger, then reload BOTH seats so that neither client holds a
document it made. The Judge's client never holds a player's fog documents —
`game.collections.get("FogExploration")` on the GM seat shows none of them — so
an episode that reads that collection misses the player entirely (T-0192).
Read fog from the server instead: `FogExploration.database.get(cls, {query:
{scene, user}})` works from the GM seat, and core loads each seat's NEWEST
document by timestamp.

1. Viewing A, press **They strayed…** in The episode section of the party
   sheet's Judge tab and pick a face.
   *Observable:* `lost.phase` is `astray`, `lost.sceneId` is A's id,
   `lost.level` is A's viewed level, `lost.fogSnapshotComplete` is true, and
   the snapshot's entry for the player hashes equal to the player's server
   document. A hidden shadow token stands at the true hex. **No "duplicate
   party token" warning** appears: the adoption hook skips shadows.
2. `walkAstray(f, {believedOffset, trueOffset})` twice, diverging.
   *Observable:* the shadow follows the TRUE offsets. The ledger holds two
   faked hexes and two observation pairs. The player still has exactly ONE
   document on A, the earlier-session one, and it now carries the believed
   hexes beside the earlier ground. On the player's seat,
   `canvas.fog.exploration.id` is that document and its bitmap shows the
   believed hexes lit. The Judge's own fog is unchanged.
3. **View scene B**, record B's FogExploration documents (`_id`, `timestamp`,
   and `explored` length for each), then press **They realise**.
   *Observable:* B's documents are byte-for-byte unchanged and none is deleted,
   which is the T-0165 regression. A's player document is back to the
   snapshot's bitmap, on the same `_id`, and the player's seat shows the
   believed hexes dark again. `phase` is `aware`, `believed` is null, the
   shadow REMAINS on A, and the dialog reaches the players without blocking
   the Judge. The episode section now shows **They find the landmark** and
   **They turn back**, and no Discover button.
4. Still viewing B, press **They find the landmark**, leave "Move the party
   token onto its true position" ticked, and confirm.
   *Observable:* the party token on A now centres on where the shadow stood,
   no `shadowFor` token remains on any scene, and `phase` is null. The journey
   hex (`travel.hex`) is the hex the token now stands in (T-0193). The move
   costs no dungeon turn and raises no day-end offer, because the movement
   hook skips `TRUTH_MOVE_OPTION`.
5. On a second party, begin from A, walk once with a true offset, then view B
   and press **They find the landmark** while astray.
   *Observable:* a "open the party's scene" warning and NO write: the ledger
   still reads `astray`, and the shadow still stands. Then view A and repeat,
   polling until `phase` is null — the commit path writes fog before it
   writes the ledger. Fog is restored and re-painted at the TRUE hexes onto
   the player's earlier-session document: the earlier ground and the true hex
   lit, the believed hex dark, no second document. Every shadow is cleared
   and the journey hex follows the token.
6. Begin again, then press **They turn back**.
   *Observable:* the player's document is back to this episode's snapshot,
   nothing is committed, the party token has not moved, and no shadow remains.
7. Begin again, then disband the formation (or delete its party actor).
   *Observable:* zero `shadowFor` tokens remain on any scene.
8. **Leftover.** With no episode open, place a shadow for the formation by hand
   (`shadow.placeShadow(sceneA, f, offset)`) and re-render the sheet.
   *Observable:* The episode section says a marker from an earlier episode is on the
   map. **Remove the marker** deletes it and leaves the party token where it
   is. Placing it again and re-rendering the sheet (placing a token does not
   re-render it), **Move the party onto it** moves the party there, deletes
   it, and moves the journey hex with it.
9. **Orphan sweep.** Create a shadow flagged to a formation id that does not
   exist (`scene.createEmbeddedDocuments("Token", [{actorId, hidden: true,
   flags: {"acks-extras": {shadowFor: "nope"}}}])`) and reload the GM seat.
   *Observable:* it is gone after `ready`, and every other token on the scene
   is untouched.
10. **The player's next session.** Reload the player seat and view A.
    *Observable:* `canvas.fog.exploration.id` is the earlier-session document,
    showing the earlier ground and step 5's credited hex.
11. **Recovery.** With both seats viewing B, create a NEWER FogExploration
    for the player on B from the GM seat (`{loadFog: false}`), holding a
    different corner: the shape an earlier build left behind. Run the
    compendium macro **Merge Fog Copies on This Scene (GM)**.
    *Observable:* an info toast counts one merged record; the player has one
    document on B, the newer `_id`, holding both corners; the player's seat
    re-points at it without a reload. A second run reports nothing to merge,
    `mergeFogCopies()` from the player seat returns null, and with a party
    astray on the viewed scene it refuses with a warning and writes nothing.

**Teardown.** `api.sweepTracked()` for the scenes, actors and any token still
standing, with the player's fog documents tracked from the player's ledger.
Deleting scene A takes every fog document on it with it.

**A ledger write takes a moment to be readable.** `patchFormation` resolves
before `getFormations()` reflects it — a scripted check that reads the record
straight after an await can see the old value while the sheet already renders
the new one. Settle ~1.5s before asserting on a fresh read. And note that a
captured `R.x = record.travel.lost` holds a LIVE reference: it serializes at the
end of the run, so it can disagree with a boolean captured beside it.

**The trap this recipe exists for:** `lostOf` takes the TRAVEL object and reads
`.lost` from it. Handing it the lost object directly answers a confident "not
lost", which is what `isAstray` did on its first outing — every offline caller
happened to wrap correctly, so only the live run caught it.

Markers left outside an episode, and members whose actor is gone, are walked
as the repair tool's formation checks in docs/lib/TESTING.md, "The repair
tool".

## The day's end (added with the movement-raised offer)

Fixture: a hex scene (`grid.type: 2`, a mile distance per hex), a party actor
with one member, its token placed, `setJourneyMode(id, "journey")`.

1. Read the allowance: `await party.sheet._prepareContext({})` →
   `travel.readout.hexesPerDay`. **Probe the context rather than scraping the
   panel** — it is what the template would render, and it carries the derived
   figures the offer compares against.
2. Walk the token hex centre to hex centre
   (`scene.grid.getCenterPoint({i, j})`, minus half a grid box for the token's
   top-left; `{animate: false}`).
   *Observable:* the first arrival NAMES the hex without counting it; each
   crossing after that raises `travel.day.hexesEntered` by one, and no dialog
   appears until the count REACHES the allowance.
3. At the allowance: one dialog titled after `travel.dayEnd.title`, and
   `travel.day.offered` is already true.
   *Observable:* walking further raises no second dialog.
4. Answer **Push on**.
   *Observable:* `day.kind` is `forced`, all four ancillary slots read
   `travel`, `hexesEntered` is UNCHANGED (pushing on must not un-walk the
   ground), the readout's allowance rises, and `offered` is back to false —
   the question is re-armed for the distance just bought.
5. Walk to the new allowance and answer **Call it a day**.
   *Observable:* a log entry with the figures the panel showed, `dayCount` up
   one, `hexesEntered` back to 0, no navigation card (the throw is the day's
   first step's), and world time at the next dawn with *Advance the world
   clock* on, not a flat day.
6. Reach the offer again and answer **Not yet**.
   *Observable:* the day continues, `hexesEntered` counts PAST the allowance,
   and no further dialog appears. The Wilderness tab's **End day** pill still ends it
   — click it and confirm it goes through the same closer (a log entry, the
   reset, and the clock).

## The city (added with settlement mode)

Fixture: a disposable `acks-extras.party` Actor (creating it auto-creates the
formation) and a disposable square scene the party token stands on. Reach the
formation by its ACTOR, not by `getFormationForActor` — that searches MEMBERS,
and a party actor is not a member of its own formation, so it answers null
every time:

```js
const f = Object.values(acksExtras.formation.getFormations())
  .find((r) => r.actorId === actor.id);
```

Give the token to the formation the way a Judge does — drag the party actor
onto the scene, or create its prototype token there. The `createToken` hook
adopts a manually placed party token, sets `tokenId`, and seeds
`clock.lastPosition`; nothing else links the two, and without the link the
tracker measures nothing.

**The party's prototype token is a QUARTER of a cell**, so its centre is
`x + grid.size / 8`, not `x + grid.size / 2`. Every road read is taken from the
centre, so a token placed at a road's own endpoint sits ~53px off the line on a
100px grid — inside `roadDistance`'s one-cell reach but outside `roadUnder`'s
half-cell, which reads as the board losing its road snapshot for no reason.
Place the token at `centre - grid.size / 8` when a step needs it ON a street.

**One party, one token: a second placement is NOT adopted.** `tokenId` is only
seeded while it is null, so moving the fixture to another scene means deleting
the old token first (which releases it) and then placing the new one. A token
created on a second scene while the first still stands is inert — the tracker
goes on measuring the old one, and the move under test registers nothing.

**Declare the block size in scene units you can count.** A square grid at
100px/50ft makes one 600ft city turn exactly 1200px of path, which is what
lets steps 6 and 11 be read off the coordinates rather than believed.

1. `travel.setJourneyMode(id, "settlement")`.
   *Observable:* `travel.mode === "settlement"` and `clock.paused === false` —
   a city runs the clock; only a journey stops it. The sheet grows
   `.acks-extras-formation-settlement` with controls named
   `travel.settlement.{pace,where,route,hour,intent,conveyance}` and **no
   button that advances anything**.
2. Run it once with NO city document registered. **The document's id is
   `acksExtras.formation.settlement.SETTLEMENT_DOC`, which reads `cityTravel`
   and not `settlement`** — a `settlement` document exists too, belongs to the
   market classes, and accepts a registration without complaint, so figures
   filed under it are simply never read and every throw reports itself
   unpriced.
   *Observable:* `blocksPerTurn` answers `{blocks: null, missing: "paces"}` and
   the panel says the rate is not imported — never a distance of zero.
3. Register invented rows and re-render: `acksExtras.lib.tables.registerTable(
   {id, tables}, {priority})`. **On a world that already holds imported city
   figures, register at 30, not 20**: a layer replaces whatever sat at its own
   priority, so 20 wipes the world's imported tables from memory until the next
   reload, where 30 lies over them per table and `unregisterTable(id,
   {priority: 30})` puts everything back.
   *Observable:* the block count appears, and the no-throw line states its
   REASON (a meandering pace, or a known route) rather than going blank.
4. Change the pace select and dispatch `change`; read `travel.settlement.pace`
   back. **This is the check that matters for the pickers**: they deliberately
   do NOT use `data-action`, because an ApplicationV2 action fires on click and
   a select bound to one silently never writes. The first version of this panel
   shipped that bug and the live check is what caught it.
5. **The tracker, with no block size declared.** Park the token with an
   ordinary move first (the clock reads `clock.lastPosition` from the world
   setting, so a halt leaves it stale and the next move measures zero), then
   drag it a few exploration moves' worth.
   *Observable:* `clock.turnsTotal` rises, a turn card is whispered, and the
   panel's tracker line says the party is being timed by its walking speed.
6. Declare the block size: `scene.setFlag("acks-extras", "battlemap", {...flag,
   mapSystem: "settlement", blockFeet: 120})`, then move the token again.
   *Observable:* turns now arrive at the pace's blocks × 120 feet, the tracker
   line states the block size, and `travel.settlement.blocks` accrues the
   pace's rate per turn. The Scene Configuration row shows the field only once
   the map is declared a settlement.
7. **The turn costs what a delve turn costs.** Light a torch and note
   `formation.lights[0].remaining`; walk enough turns to burn one off.
   *Observable:* it decrements — this is the whole point of the mode change,
   and it is what a paused clock silently skipped.
8. **The street throws on its own cadence, and the dungeon's does not fire.**
   With the invented `encounters` rows registered, walk past the cadence.
   *Observable:* a city card whispers the throw against the street's target,
   and no wandering-monster card appears alongside it.

   **Read the die off the card, not the fact that a card appeared.** It says
   `Threw <n> on 1d6 against <t>+`, and `n` is a d6 result. A throw made on the
   navigation die answers roughly four times too often and is indistinguishable
   from a busy street on every other surface — this line is the only place the
   scale is visible. The `Roll` objects are NOT on the message: `postToJudges`
   shows them through Dice So Nice and posts the card with `rolls: []`, so
   every die is read from the card's text.

8b. **A zone drawn over the street wins, per field.** Add a Region covering the
   token with an `acks-extras.encounterZone` behaviour: `encounterEvery: 1`,
   `encounterTarget: 2`, `tableUuid` pointing at a disposable two-row RollTable.
   Walk three turns.
   *Observable:* every turn owes a throw; each card opens
   `Inside <region>, the street answers every 1 turn(s), on 2+`; a hit draws
   from the zone's table by name (`Rolled <n> on <table>: <row>`) and NOT
   through the city's d100 procedure — the zone's own formula is what rolled.
   Now set `encounterEvery` back to 0 and leave the target: the interval
   returns to the street's while the target stays the zone's. A zero is
   *inherit*, never *never*.

8c. **A stay longer than one credit catches up rather than losing the
   difference.** Holed up with the stamp fresh, `game.time.advance(86400 * 45)`.
   *Observable:* `days` rises by 30 (the per-credit cap), `holeUpSince` moves
   forward by exactly 30 days — **not** 45 — and the stay card says how many
   are still to catch up. Advance the clock again by any amount: the remaining
   15 are credited and `days` reaches 45. Moving the stamp by the days that
   PASSED instead of the days CHARGED loses the difference silently; the board
   and the calendar simply disagree afterwards and no card says so.

8d. **A day boundary crossed inside a tick survives the tick's own save.** Set
   `holeUpSince` to `game.time.worldTime - (86400 - 300)`, then
   `advanceTurns(f, 1)` — its 600s world-time bump crosses the boundary.
   *Observable:* `days` rises by 1 and stays risen. `advanceRounds` saves its
   own copy of the record whole at the end, so a credit landing mid-call is
   written back over unless the credit is settled before the tick.
9. **Holing up rides the calendar.** Set `where` to `holedUp`, advance world
   time an hour first (the stay is stamped, nothing is charged), then
   `game.time.advance(86400 * 2)`.
   *Observable:* one stay card covering two days; `travel.settlement.days`
   rises by 2 and `holeUpSince` has moved forward by exactly two days.
   Advance a further 12 hours: nothing is credited. Walking the token while
   holed up marks off turns but credits no blocks, owes no street throw, and
   makes no navigation throw.

   **Watch the console on this step.** The watcher sweeps every formation, and
   the sweep is registered inside a `.catch()` — an exception there is logged
   and nothing else happens, which reads exactly like a clock that was never
   watched. `getFormations()` returns an OBJECT keyed by id, not an array; the
   first version of the sweep iterated it directly and failed silently that way.

9b. **A stay draws what found it, day by day, and leaves no marker.** Rides
   the city scene, a city list named in Scene Configuration (the `1d10` list
   with rows `1`–`13` and `3` after dark from "The city's own list"), and
   the stay of step 9. Register an invented `cityTravel` document at priority
   30 whose `encounters.holedUp.any` is `{everyTurns: 1, throw: 1}` and whose
   `encounterAfterDark` is `3`. **No die needs rigging**: a `1d6` meets a
   target of 1 every day, and a target of 7 on the same row meets none. Arm
   the marker setting (`transientIncidentTurns`) to a nonzero value so that a
   marker the stay should not leave would be left. Track the list by id.
   With `where` on `holedUp` and `hour` on `By day`
   (`patchSettlement(id, {hour})`), stamp the stay with an hour's advance,
   then `game.time.advance(86400 * 3)`.
   *Observable:* one stay card; under its "did not pass quietly" line, a
   "Day N" row for each of the three days, N continuing from `days` as the
   board held it, each carrying "Rolled R on <city list>: text" with R from 1
   to 10 and the text the row R names, and no "after the dark" clause. The
   scene's note count is unchanged, and the card carries no "Make it a place"
   button (compare step 28, where a turn's card does). Set `hour` to
   `After dark` and advance three days again: each row reads "Rolled R on
   <city list> (R+3 after the dark): text", and over several days a total of
   11–13 appears with the row only the shift reaches. The days are labelled by
   their own number, so the second stay's rows follow the first's.
   *Quiet and gaps:* set the registered target to 7 and advance a day:
   "Nothing found them, over 1 day(s)" with no "Day" row and no draw.
   Re-register the layer with an empty `encounters.holedUp` row (`{}`): the
   registry merges layers per table, so the empty row hides any imported
   holed-up cell beneath it, where unregistering the override on a world that
   imported the settlement document only uncovers that cell and the stay stays
   priced. Advance a day: "Not imported: encounters." and no "Day" row. The
   stay card is the client's that credited it, so read the cards by author and
   by the `acks-extras-settlement-card` class, never by time alone, and track
   none for the sweep while another formation is holed up. Restore the target of
   1, clear the city list from Scene Configuration and advance two days: on a
   world holding no imported incident list each "Day" row says "No incident
   table yet" in the turn's words and no incident is claimed; on one that
   holds it, the rows read from the world's own list instead, and the
   missing-list line is left to the offline suite.
   *Teardown:* unregister the layer, clear the scene's incident record, sweep
   the tracked list, restore `transientIncidentTurns`. The advances moved the
   shared clock, as step 9's do.
10. Leave with `setJourneyMode(id, "delve")`.
    *Observable:* mode is `delve`, the clock still runs, and the wandering
    monster throw returns. Go straight back in with
    `setJourneyMode(id, "settlement")`: the pickers the Judge set — pace,
    streets, the way, the hour, intent, conveyance — are all still there, and
    `blocks`, `turns`, `days` and `holeUpSince` are back to zero. Another
    city's mileage is not this one's, and a route walked before is still
    walked before.
11. **The panel and the tick agree about the same party.** Push a dozen blank
    cells into `members` beside one real member (the marching order keeps them
    for ranks a Judge left open), set the pace to commuting, and read the
    panel's `headcount`/`rateBlocks` against a single `advanceTurns`.
    *Observable:* the panel counts the REAL member only, shows no straggling
    tier, and its `rateBlocks` equals the blocks the turn actually credited.
    Then set `where` to `holedUp` and re-read: `rateBlocks` is 0, `throws` is
    false, and the no-throw line names staying put rather than the pace or the
    route. A panel that derives independently of the tick agrees until one
    side changes, and then disagrees in a way only a live read can catch.
12. **A bend costs its legs, not its chord.** Draw two road walls meeting at a
    right angle across the city scene — 12 squares along, then 12 up, on a
    100px/50ft scene with a 1200px block — and drag the party token from one
    far end to the other in ONE drag.
    *Observable:* the turns credited match the road's length (24 squares =
    1200 ft = one block at a commuting pace) and NOT the diagonal between the
    ends (~17 squares). The tracker says the move was measured along the
    streets. Then drag the party across open ground, more than one grid cell
    from any road: the turn is credited from the chord, and the tracker says
    NOTHING about how the move was measured — the straight-line line renders
    only for a party standing on a street, which is the one case where "not
    along the streets" is worth saying. **This is the defect the road layer was
    built for** — before it, both drags cost the same and the bend was free.

    **Draw a JUNCTION as well, not only this chained bend.** Both legs here
    share an endpoint, which is the one shape that is certain to join. The
    shapes a city is actually drawn in are an avenue dragged in one sweep with
    a side street begun on the MIDDLE of it (a T), and two streets simply
    crossed (an X). Walk the party round each.
    *Observable:* measured along the streets, same as the bend. A chord-priced
    turn with no measurement line means the two roads never joined into one
    network — the graph nodes segments at their ENDPOINTS, so a contact partway
    along a span makes no shared node and the streets are separate islands.
    Neither this recipe nor `docs/battlemap/TESTING.md` walked that shape
    before 7.6.0 shipped, and the network does not survive it.
13. **The street underfoot beats the picker.** Mark one of the two walls as an
    `alley` (its own wall sheet), leave the panel's `where` on avenues, stand
    the party token on the alley, and take a turn.
    *Observable:* the panel shows the alley's cadence with a line naming the
    map as the source while the picker still reads avenues; the turn card says
    which street it resolved on; the throw comes at the alley's interval and
    target. Move onto the avenue leg and re-read: it follows. Set `where` to
    `holedUp` while still standing on the alley: holed up wins, the day tick
    owns the throw, and the road line is gone — the room is the answer and the
    street outside it is not.
14. **No roads changes nothing.** On a city scene with no road walls at all,
    walk steps 3–8 again.
    *Observable:* identical results to before the road layer — the picker
    answers `where`, drags are straight-line, and the tracker carries no
    measurement line at all. An undrawn map is one where the question has not
    been asked, so the panel does not answer it either.
14b. **A city that is not drawn in feet costs the same walk.** The whole recipe
    above is a feet scene, which is the one unit where a wrong conversion
    cannot show. Set the city scene's grid units to `m` with a distance of 5,
    declare a block of 30 in Scene Configuration, and drag the party exactly
    one block.
    *Observable:* ONE city turn is marked off, not three. The tracker reads
    "a block here is 30 m, so a turn is 180 m walked" — both figures in metres,
    beside the unit they are printed with. Then set the scene to `mi` and read
    the tracker with no block declared: the walking-speed line names a figure
    with decimals, never `0 mi`. A party told it has moved nothing is the
    failure this step exists to catch, and neither half is visible on a ft map.
14c. **A board does not follow the party into the next city.** With blocks and
    turns on the board and `Hunted here` ticked, place the party token on a
    SECOND scene that also declares `mapSystem: "settlement"` — directly, with
    no wilderness or delve in between, which is the hop that used to keep
    everything.
    *Observable:* the panel opens on 0 blocks over 0 turns, `Hunted here` is
    clear, and a party that left while holed up is not charged the journey as a
    stay on the next clock advance. Then walk back to the first city and
    confirm it too resets rather than restoring what it held. **Also walk the
    upgrade shape**: `patchSettlement` a board with tallies and no `sceneId`,
    reload the world so the ready pass claims it, and hop again — a board that
    was never stamped must reset on arrival, not be adopted by the city it
    arrives in.

## The districts (added with the district behaviour)

A district is a third layer over the same streets, so every step here is read
against what steps 3–14 already established: the same party, the same city
scene, the same roads. **What it adds that nothing above it needs is a world
relaunch** — see the sub-type gate below, and walk it FIRST or every create
silently does nothing.

Fixtures: the city scene and party from "The city", plus disposable Regions
created by the run and two disposable RollTables to point the district at.
Create the tables through the driver so the sweep owns them; a district whose
table is a world table somebody else made is a district whose test cannot be
torn down.

**The sub-type gate, before anything else:**

```js
game.documentTypes.RegionBehavior.includes("acks-extras.district")
```

`module.json`'s `documentTypes` is read by the SERVER at world launch. After a
browser reload the data model is registered and the sheet renders, while
`createEmbeddedDocuments("RegionBehavior", [{type: "acks-extras.district"}])`
**returns an empty array and logs "not a valid type"** — nothing persists and
nothing throws. If the check above is false, shut the world down and relaunch
it; do not spend an hour on a tool that is working.

Two spellings, one sub-type, and confusing them is the other silent failure:
`"district"` appears ONLY in `module.json`'s `documentTypes`. Everywhere else —
`CONFIG.RegionBehavior.dataModels`, `typeIcons`, `TYPES.RegionBehavior`, every
`behavior.type` comparison, every `create` — it is `"acks-extras.district"`.

**Drive mechanics this section needs, learned live:**

- **A placeable cannot be CONTROLLED while its layer is not active.**
  `region.object.control()` silently no-ops and `canvas.regions.controlled`
  stays empty, so the Regions tool reports `marked: 0` and reads as the tool
  being broken rather than as nothing being selected. Call
  `canvas.regions.activate()` (or `canvas.walls.activate()`) first and give it
  a beat. Both district tools take their selection from the layer, so both
  need it.
- **A RollTable's rows are not creatable inline.** `RollTable.create({results:
  [...]})` returns undefined here; make the table, then
  `createEmbeddedDocuments("TableResult", [{type: "text", text, range: [a, b]}])`
  with the type as a STRING. A table with no rows draws nothing, which reads
  as the district's table never being consulted.
- **A GM owns every document they create, and `depositReach` asks the users who
  own the CHARACTER (`ownersShare`), so a place the Judge made is reached from
  the Gamemaster seat by ownership before the ground branch ever runs.** Step
  25 cannot be walked from that seat at all — it answers `can: true, scene:
  null` for a place that is nowhere, which looks like a pass. Give the member
  actor to the Player seat, drop the places to default ownership, and join as
  that player.
- **Do not `close()` every open application before driving the token HUD.**
  Sweeping `foundry.applications.instances` to compose a clean frame takes the
  core UI with it, and the HUD then renders without the module's **Add to
  party** button — which reads as the button having been lost. Compose before
  the HUD step, not inside it, and bind with the Tokens layer active.

15. **Mark a drawn region as a district.** Draw a Region over part of the city
    scene with core's own Regions tools, select it, and press the district tool
    on the Regions control.
    *Observable:* the region gains exactly one `acks-extras.district` behavior,
    its config opens showing eight fields with the localized labels (no raw
    `ACKS-FORMATION.DISTRICT.*` keys on screen, which is what a missing lang
    entry looks like), and the notification names how many regions were marked.
    Press the tool a SECOND time with the same region selected: still exactly
    one behavior, and the existing one opens. Then press it with nothing
    selected: a notification asking for a selection, and no region created.
16. **Enclose walls as a district.** Select a closed loop of walls on the city
    scene and press the district tool on the Walls control.
    *Observable:* one Region appears over the loop with a district behavior on
    it, and its `visibility` is core's own default — `LAYER_UNLOCKED` (4), not
    `GAMEMASTER` (1). The contrast with the trap-area tool beside it is
    deliberate: a trap is a surprise and a quarter is not, so a district drawn
    GM-pinned is the defect. Press again: the same region is reused, not a
    second one stacked on it.
17. **A district overrides the street, per field.** On the district from step
    15, state only the day INTERVAL and leave every target at 0. Stand the
    party inside it and take turns until a throw is owed.
    *Observable:* the throw comes at the district's interval and at the
    STREET's target. The card's override line names the district by its region
    name. Now state only the day target and clear the interval: the interval
    comes back from the street and the target is the district's. A district
    with all four fields at 0 changes nothing at all — which is what makes 0
    safe to leave alone.
18. **Day and night are two figures, not a figure and a shift.** Give the
    district a different night pair, then set `The hour` to `After dark` on
    the panel.
    *Observable:* the cadence changes to the night pair on the panel and in the
    tick together. A district that prices only the night pair inherits by day —
    walk that too, because it is the realistic gazetteer case and the one where
    an inherit bug hides.
19. **A district outranks a zone, and the card says which answered.** Draw an
    Encounter Zone over a few blocks INSIDE the district, give it an interval
    only, and stand the party in the overlap.
    *Observable:* where the district states that figure, the district's is what
    answers and the card names the DISTRICT; where it leaves that figure at 0,
    the zone's answers and the card names the ZONE. Precedence is street →
    zone → district with the district last and winning, the same order
    `pickIncidentSource` picks a table in — it is NOT spatial nesting, and a
    zone drawn inside a district does not outrank it. A card naming the wrong
    layer while printing the right number is the failure this line exists for.
20. **The panel shows what the tick will use.** With the party in the overlap,
    read the panel WITHOUT taking a turn.
    *Observable:* the panel prints the same interval and target the next turn
    will throw at, and names the layer. **Before this phase the panel could
    never show a zone override at all** — it called the street's reader
    directly — so a panel still reading the bare street here is a regression,
    not a cosmetic gap.
21. **The district's list answers, and being hunted changes which list.** Put
    one RollTable on the district's `tableUuid` and the other on
    `wantedTableUuid`. Force a met throw.
    *Observable:* the incident is drawn from the district's table and the card
    names it. Tick `Hunted here` on the panel and force another: the hunted
    table answers and the card says why. Now clear `wantedTableUuid` and force
    a third with `Hunted here` still ticked: it falls back to the district's
    ORDINARY table, never to the city's — a quarter that has said who is on its
    streets has answered the question.
22. **Untick `Hunted here` and confirm it clears.** An unticked checkbox is
    absent from the submit, so a box that can be set and not cleared is the
    expected bug here.
    *Observable:* `travel.settlement.wanted` reads `false` on the record after
    the untick, and the next incident comes from the ordinary table. Then leave
    the city and re-enter it: `wanted` is **false again** without being touched.
    That drop is deliberate — being hunted belongs to one settlement — and is
    exactly the kind of ruling a later change silently "fixes".
23. **The reaction figure reaches the roller AND the screen.** Give the
    district a negative `reactionModifier` with `reactionWhere` on `Anywhere`.
    Stand a party member in the district and open the influence roller for
    them.
    *Observable:* the dialog shows a read-only row naming the district and the
    SIGNED figure, the subtotal includes it, and the posted card lists it. All
    three, and the row is the one that regresses: before this phase an external
    modifier moved the total and the card with **nothing on screen to explain
    it**, which is how acks-henchmen's slander penalty has been arriving.
    Verify the henchmen route still works at the same time if that module is
    installed — two sources must add, not replace.
24. **`Where it applies` is honoured.** Set `reactionWhere` to `Alleys`.
    *Observable:* the figure is owed while the party stands on a drawn alley
    inside the district and NOT while it stands on the avenue, following the
    same map-beats-picker reading step 13 established. Set `where` to
    `Holed up`: the figure is owed indoors and not on either street. Set the
    modifier to 0 with any scope: nothing appears anywhere — 0 here means
    "unremarkable", not "inherit".
25. **The place under the party.** Put a location actor's token on the city
    scene — dropped the ordinary way, NOT linked — and stand the party token
    one square from it.
    *Observable:* a member's Storage tab offers that place as somewhere they
    can deposit, where the same place with its token removed and no scene
    linked and no ownership is refused with a reason the player can read.
    Move the party off and the offer goes away. The full recipe for this
    surface, including the two refusals and the floor band, is
    [../location/TESTING.md](../location/TESTING.md) steps 12-16.

    The settlement panel names it too — "At <place>" with an open button —
    and that readout is walked in "Points of interest" below.
26. **No district changes nothing.** Delete the district regions and walk steps
    3–14 again.
    *Observable:* identical to before this phase. An unmarked city is one where
    the question has not been asked.

## Points of interest (added with the POI phase)

The token, the roster, the quarter's place and the prune are the location
feature's surfaces and are walked first —
[../location/TESTING.md](../location/TESTING.md) steps 17–20 — on the city
scene from "The city" with the districts from steps 15–16. Everything below
rides those fixtures: the point's token from location step 17, the quarter's
place from step 19, plus invented `districtTravel` figures registered beside
step 3's city document (`tables.districtTravel: {same: {commuting: 1,
meandering: 2}, adjacent: {commuting: 3, meandering: 4}}` reads back
unmistakably). The importer's own pass is
[../importer/TESTING.md](../importer/TESTING.md) "Points of interest land as
places".

**Drive mechanics this section needs, learned live:**

- **The marker is a Note, and the Player seat is the only test of its
  visibility.** From the Judge's seat every Note is visible. Join as the
  Player with the party's scene active and read
  `canvas.notes.placeables.map((n) => n.isVisible)` — or look.
- **Advancing the world clock is `game.time.advance(seconds)`** on the Judge's
  seat; the watcher runs on the primary Judge only, so a second Judge seat sees
  the marker go a beat later.
- **The walk without the picker** is `acksExtras.formation.poi.travelToPlace
  (formationId, tokenId)`; it returns `{moved, reason, relation, turns,
  place}`, and `acksExtras.formation.poi.TRAVEL_OPTION` is the bypass the
  movement hook honours.
- **`createEmbeddedDocuments("Region", […])` does not hand the documents back
  in the input's order.** Map the returned regions by name before attaching
  behaviours, or the cadence lands on a different quarter from the one the
  script believes it priced — which reads as the incident throw never firing.
- **A Note stores integer coordinates**, so a marker dropped at the party's
  point (`x + gridSize / 8` for the quarter-cell party token, 162.5 on a
  100px grid) reads back rounded (163). Compare within a pixel.

27. **The panel names where the party stands.** Stand the party token one
    square from the point's token, inside the district that has a place.
    *Observable:* The city section of the City tab shows "At <point>." and "The quarter's own
    place: <quarter>."; each line's button opens that sheet. Move the party off
    the point but not out of the district: the first line goes, the second
    stays. Unlink the quarter's place (location step 19): the second goes.
28. **An incident leaves a Judge-only marker.** Point the district's incident
    table at a one-row table and set its cadence to throw every turn on 1+;
    walk the party a block.
    *Observable:* the whispered card carries the incident, "A marker was left
    where it happened." and a **Make it a place** button; a Note stands at the
    party's point with `entryId` null and the row's text under
    `flags["acks-extras"].transient`; from the Player seat there is no Note at
    all. Set **Incident markers last** to 0 and walk again: a card, no marker.
    Track each Note by id from `canvas.scene.notes` the moment the card lands.
29. **The clock takes it away.** Advance world time by the lifetime in city
    turns (the setting × 600 s).
    *Observable:* the Note is gone; one dropped after the advance stays. The
    stay credit of step 9 is unaffected.
30. **Promotion.** Press **Make it a place** on a card whose marker stands and
    accept the name it offers.
    *Observable:* a location actor named after the incident's opening words
    exists inside the quarter's place, carrying the row's text as its notes;
    its token stands where the Note stood; the Note is gone; the card's button
    is disabled; the actor's sheet opened. Press the button on an older card
    whose marker expired: a warning, nothing made. Track the actor and its
    token by id.
31. **The walk is priced by quarter.** With a second district touching the
    first along one street and a point's token inside each, the party in the
    first: **Go to a point of interest**, pick the point in the same quarter,
    then the one across the street.
    *Observable:* the first hop spends the `same` figure for the panel's pace
    (the torch's burn and the turn count both move by it), the second the
    `adjacent` figure, each whispered as "Went to <place>: N turn(s), within
    the quarter / into the next quarter."; the party token stands beside the
    point each time; the turn count moves by exactly the figure — the token's
    move is not measured a second time — while the board's blocks line credits
    the pace's rate per turn spent, as any turn does; and the formation's
    `clock.lastPosition` is the new spot. Change the pace: the other column of
    figures.
32. **The walk refuses what the figures do not price.** Draw a third district
    nowhere near the first with a point in it; then move the party outside
    every district; then unregister the `districtTravel` figures.
    *Observable:* three different warnings — the quarters do not touch; one
    end is outside every district; no figures imported — and the token does
    not move for any of them. Register figures for one pace only and pick the
    other: a fourth warning, no move.

## The city's own list, and the quarter's (added with the map list; the special read walked 2026-09-30)

Rides the city scene from "The city" and one district from steps 15–16.
Everything the lists say is invented, and their shapes are what matters:

- **The city list**: a RollTable, formula `1d10`, rows `1`–`13` (three rows
  past the die), QQ-prefixed text. In **Scene Configuration** name it as the
  map's city table with `3` after dark and the band `8`–`9`.
- **The special list**: a RollTable, formula `1d6`, rows `1`–`8`, QQ-prefixed
  text, named on the district's `Special encounters table`, with `2` in
  `Special table: added after dark`. Leave the district's own table blank.
- The district's cadence throws every turn on 1+, so every turn is met.

**Drive mechanics, learned live:**

- The dice cannot be forced from a script, so a band that must be hit is
  widened to the whole die (`1`–`13`) for the step that needs it, and a row
  that only a shift reaches is proved by taking enough turns for the shifted
  total to appear on the card. Read the cards' text rather than the dice.
- `acksExtras.formation.settlement.incidentRouting(pick, nameOf)` with
  `pick = pickIncidentSource({district, zone, wanted, city})` answers what the
  panel prints without opening it; the panel is still read once for real.
- Track both tables by id from creation; the district region and the scene's
  incident record are step 15's and step 3's fixtures.
- **A world whose "Advance world time" setting is on moves the SHARED clock
  600 s for every `advanceTurns`.** Read the setting first; where it is on,
  tick the card without the clock: import
  `scripts/formation/settlement-turn.mjs` in page context and call
  `cityTurnCompleted(f, [])` with a fresh `getFormations()` record — it is the
  tick the movement path calls, it rolls and posts the card, and it leaves the
  board unsaved (the turn count stays at what it was, which nothing here
  reads). The district's cadence at `1` on `1+` meets every turn either way.
- **The dice stay off the message** (`postToJudges` shows them through Dice So
  Nice and posts the card with `rolls: []`), so a die is read from the card's
  own text: the "Rolled N" of each line, and the "(total T)" the hand-over
  line prints. `message.rolls` is empty on every city card.
- Neither the district lookup nor the throw needs the canvas: the walk runs
  with `canvas.ready` false in the capture driver's browser.
- The district behaviour's sheet round-trips the figure through its own form:
  set `[name="system.specialAfterDark"]`, dispatch `change`, `app.submit()`,
  then read `behavior.system.specialAfterDark` — `""` stores `null`, `"0"`
  stores `0`.
- *By day* and *after dark* below mean **The hour** set to `By day` or
  `After dark` (`patchSettlement(id, {hour})`), never left on the clock: the
  shared clock reads whatever hour a peer's walk left it at.

33. **The map's list is read on its own die, by band.** With the band at
    `8`–`9`, walk the party until a turn is met, by day.
    *Observable:* the card's line is "Rolled N on <city list>: text" with no
    "after the dark" clause, N is 1–10, and the text is the row N names. Set
    **The hour** to **After dark** and walk again: "Rolled N on <city list> (N+3 after the
    dark): text", and over several turns a total of 11–13 appears with the row
    only the shift reaches. The panel prints "Incidents here: <city list>, +3
    after dark." and "A total of 8 to 9 is handed to <special list>, +2 after
    dark." before any turn is taken.
34. **The quarter's special list is thrown on its own die, with its own
    figure.** Widen the band to `1`–`13` so every total hands over; walk by
    day, then after dark.
    *Observable:* every card carries the hand-over line ("Rolled N on <city
    list> (total N): the district's special table answers.") followed by
    "Rolled M on <special list>: text" by day with M 1–6, and "Rolled M on
    <special list> (M+2 after the dark): text" after dark, where over several
    turns a total of 7 or 8 appears with the row only the figure reaches. Two
    throws show on the card, each on its list's own die: the city's "Rolled N"
    never exceeds 10 and the special's "Rolled M" never exceeds 6, where a
    `1d100` would print totals past both. A special list DRAWN instead would
    show no shifted total at all.
35. **A blank figure is none, a typed zero is zero.** Clear `Special table:
    added after dark` and walk after dark.
    *Observable:* the special's line carries no "after the dark" clause and
    its total never exceeds 6; the panel's hand-over line drops its shift.
    Type `0`: the same. Type `2` again: the shift is back.
36. **A list that is gone is said, on the panel and on the card.** Delete the
    special list (by its tracked id) and read the panel; then walk one turn.
    *Observable:* the panel's warning line says the quarter's special table
    cannot be read; the card says the same and the city row's own words
    stand under its own line. Now give the district an ordinary table of its
    own: the panel says the quarter's table replaces the city's, the card
    draws from it, and no hand-over line appears whatever the band. Clear it.
    Delete the CITY list: the panel warns that the city table named here no
    longer exists, and the next turn's card carries that warning above a line
    drawn from the world's own list (the Judges Journal import) or the "No
    incident table yet" line when the world holds none.
37. **The map step repairs a held map's links.** On the imported AX3 map
    (the importer's "Maps" step, a held scene), rebuild the roll-table shelf
    so every list is minted under a new id; read the panel with the party in
    any quarter; type `9` into one OTHER quarter's `Special table: added
    after dark`; run the Maps step again.
    *Observable:* before the step the panel warns that the city table and the
    quarter's special table no longer exist; the step's summary counts the
    held map's repaired links; afterwards the panel names both lists again
    with the figures the lists' own rows give, and the quarter typed `9` still
    reads `9`. Nothing else about the scene changed: token count, region
    count, and the scene's picture path are what they were.

    **On a shared world whose held map is another session's**, the Maps step
    cannot be run — it would write that session's map and mint the line's
    Adventure shelf. Walk the repair on a map of the run's own instead:
    `repairHeldMap(recipe, scene)` is exported from
    `scripts/importer/cookbook.mjs` for it (import the module in page context;
    `cookbookBookFile("ax3")` non-null proves it is the loaded instance). The
    scene's district regions carry `flags.acks-extras.cookbook.place`, and
    the recipe names those places beside the shelf's own cookbook ids
    (`ax3.cityEncounters`, `ax3.<quarter>SpecialEncounters`, band section
    `r89-100`). One quarter with a dead uuid, one typed `9` on a live uuid,
    one blank on a live uuid: the call returns `3`, a second call `0`. What
    that route leaves unwalked is the count on the Maps step's summary.

## The hour (added with the clock; walked 2026-09-30)

Rides the city scene from "The city", the district from steps 15–16 with a
different night pair (step 18), and the shifted city list from step 33. The
board's `hour` is `clock`, `day` or `night`; `lib.worldTime.clockReading()`
is what the panel and the tick read.

**Drive mechanics, learned live:**

- **Never move the shared clock to cross dusk.** The two bounds are world
  settings of this module's own, blank until this walk sets them, and moving
  one across the hour the clock already reads flips `dark` without touching
  the clock: with the clock at hour H by day, `game.settings.set("acks-extras",
  "duskHour", H)` makes it dark (dusk itself is dark); `set(…, null)` restores
  the blank. Leave both blank at the end — blank is the only value they have
  ever held on this world.
- The hour picker is `travel.settlement.hour` on the panel's form, so it
  submits with the other pickers; `patchSettlement(id, {hour})` is the same
  write from the api.
- The re-render on `updateWorldTime` needs the REAL hook: `game.time.advance(60)`
  then `game.time.advance(-60)`, with `game.time.worldTime` read before and
  after to prove the clock came back. Sixty seconds crosses no day boundary,
  so no stay is credited and no sky re-rolled. Read the line off the OPEN
  sheet's DOM (`.acks-extras-formation-settlement-clock`) without calling
  `render` yourself, or the check proves your render and not the hook's.
- The settings window is `game.settings.sheet`; the two fields are
  `[name="acks-extras.dawnHour"]` and `[name="acks-extras.duskHour"]`, number
  inputs whose blank value reads back as `""`.
- A legacy board is written with `patchFormation` from
  `scripts/formation/formation-model.mjs` imported in page context: delete
  `hour` from the record's `travel.settlement` and set `night` on it.

38. **The clock is the default, and the panel prints what it reads.** Enter
    settlement mode on a fresh board.
    *Observable:* `travel.settlement.hour === "clock"` and the record has no
    `night` key; the panel's `The hour` select shows `As the clock says`
    selected, with `By day` and `After dark` as its other options; under the
    pickers a line reads "The clock reads HH:MM: day, light from 6 to 18." (or
    "after dark") where HH:MM is `game.time.components` and the two bounds are
    the quarter points of `game.time.calendar.days.hoursPerDay`; the same
    figures come back from `clockReading()`.
39. **The clock decides the cadence and the shift.** With the party in the
    district and the clock reading day, read the panel; set `duskHour` to the
    hour the clock reads; read it again; take one turn.
    *Observable:* the cadence figures move from the district's day pair to its
    night pair without the picker changing; the clock line now says "after
    dark, light from 6 to H"; the turn's card carries the "(N+3 after the
    dark)" clause on the city list's line. Set `duskHour` back to blank: the
    day pair and the day line return, and the next card carries no clause.
40. **The Judge's word outranks the clock.** With the clock reading day, pick
    `After dark`; then, with `duskHour` set so the clock reads dark, pick
    `By day`.
    *Observable:* each pick puts the pair the picker names on the panel and
    the card, whatever the clock says, and the clock line changes to "Set by
    hand; the clock reads HH:MM." Picking `As the clock says` again follows
    the clock. Restore `duskHour` to blank.
41. **A clock change reaches an open sheet.** With the sheet open on a `clock`
    board, advance the world clock a minute and read the clock line without
    touching the sheet; then take the minute back.
    *Observable:* the line's HH:MM has moved by one minute on its own — a
    re-render, not a reopen — and moves back with the clock. The board's
    record is unchanged by either.
42. **A board from before the hour had a source.** Write `night: true` with no
    `hour` onto the run's own formation record (`patchFormation`, or the
    setting directly) and open the sheet; save the form once.
    *Observable:* the picker shows `After dark`; `settlementOf` gives
    `hour: "night"`; after the save the stored record has `hour: "night"` and
    no `night` key.
43. **The two settings appear, and gate something.** Open the module's
    settings.
    *Observable:* `The hour it gets light` and `The hour it gets dark` are
    present as number fields, blank; step 39 is what they gate. A value typed
    outside the day is kept inside it on the panel's clock line.

What this section does not walk: a world whose clock keeps no calendar (the
"treated as day" line) — core v14 always has one, and stubbing `game.time`
would be a synthetic trigger; the offline `clockReading` null case stands for
it.

## Swimming (added with the registry migration)

Swimming's printed figures arrive registered, so the surface has **two** states
and both have to be walked: nothing registered, and a document registered. The
first is the one that regresses silently — a missing figure that becomes `0`
hands the Judge a number that looks calculated.

**Fixtures**: one disposable character Actor. No scene, no token, no canvas —
every call is API-level.

**Steps and observables**

1. Confirm the empty state first: `acksExtras.lib.tables.hasDoc("formation")`
   is `false`; a layer left registered makes the whole check below read green
   for the wrong reason. A world that imported its rules tables holds the
   document, and that is the Judge's import (with any override of it), not a
   leftover: take it off this client alone with
   `acksExtras.lib.tables.unregisterTable("formation")`, which drops every
   layer when given no priority. The world's store keeps them, and teardown
   mirrors them back.
2. With nothing registered, call `swimmingBonus()`, `swimSpeedShare()`,
   `sinkFeetPerStone()` and `breathRounds()`. **Every one returns `null`.** A
   `0` here is the bug this recipe exists to catch.

   Every accessor named in this recipe hangs off
   `acksExtras.formation.swimming` — not `acksExtras.formation`, where the
   feature's other surfaces sit. `const s = acksExtras.formation.swimming`
   first and the rest of the recipe reads as written.
3. `waterModifier("calm")` returns `0`; `waterModifier("rough")` and
   `waterModifier("cold")` return `null`. Calm is the absence of a modifier and
   is structural; the other two are printed and are not.
4. `swimmingThrow({encumbrance: 0, proficient: false, water: "rough"})` returns `target: null`,
   `needed: null`, and `unknown: ["swimWaterModifiers"]` — it **names** the
   figure it lacks. The same call with `water: "calm"` returns `target: 0`,
   `needed: false`, `unknown: []`, because nothing is missing.
5. `drowning({actor})` returns `rounds`, `feetPerRound` and `depthAtDeath` all
   `null`.
6. Now register a document and re-run. Use figures that are obviously **not**
   from a book — the point is to prove the wiring, and a real value in a test
   script is a leak:

   ```js
   const t = acksExtras.lib.tables;
   t.registerTable({ id: "formation", tables: {
     swimmingBonus: 77, swimSpeedShare: 0.42, sinkFeetPerStone: 88,
     breathRounds: 99, swimWaterModifiers: { calm: 0, rough: -55, cold: -66 },
   }}, { priority: t.PRIORITY.OVERRIDE, source: "live-check" });
   ```

   Each accessor now returns its fabricated figure, and
   `swimmingThrow({encumbrance: 0, proficient: false, water: "rough"})` returns `unknown: []` with a
   `parts` entry `{key: "water.rough", value: -55}` and the target built from
   it. A `parts` array that still lacks the water row means the throw is
   reading the constant it used to hold rather than the document.
7. **Exercise the removal**, not only the registration:
   `t.unregisterTable("formation", { priority: t.PRIORITY.OVERRIDE })`, then
   re-read one accessor. It returns `null` again and `hasDoc("formation")` is
   `false`. A value that survives here is a cache with no invalidation story.
   The priority goes in the option bag: a bare number is read as no priority
   and drops every layer of the document.

**Teardown**: delete the actor; unregister the document if step 7 did not.
Leaving a fabricated `formation` document registered poisons every later check
in the same world session. Then
`acksExtras.lib.services.get("ruledata-import").reload()` mirrors the world's
store back into this client, which restores an import step 1 took off.

## The march in miles (added with movement-driven travel)

Fixtures, all through `api.create` and swept with `api.sweepTracked()`: a
hex scene whose cell is a mile-scale hex (`grid.type` hexagonal,
`grid.distance` a whole number of miles, `grid.units` "mi"), a square scene
at the same scale, a gridless scene in miles, a hex scene of a wider cell
(four times the first), a feet-scale scene holding one district Region, a
party actor with two members (each with an exploration speed, which a bare
character actor also gets from the system's defaults) and its token on the
first scene, an invented `travel` document registered at priority 30 carrying
`encounterFrequency.traveling.<territory>.mileHex` equal to the first scene's
cell (`cadenceMilesFor` reads that document), and the formation's territory
set to that key in the Judge's hand (`applyTravelForm(id, {override:
{territory}})`), since an unpainted hex scene answers none. Record `game.time.worldTime` before the walk and report the
delta at the end. The dawn and dusk hours default to nothing and the per-hex
throw setting may be off in the world: read all three, set them for the walk
(a dawn, a dusk, the throw on) and restore them at teardown, and say so in
the report.

1. Drop the party token on the undeclared mile-scale hex scene.
   *Observable:* `travel.mode` reads `journey` with a scale notice in chat;
   the token is one cell wide; the strip shows the journey cells.
2. Nudge the token a few pixels.
   *Observable:* no turn card; `clock.turnsTotal` unchanged; `travel.day
   .miles` and `.hours` rose by a fraction and `worldTime` by the matching
   seconds.
3. Set the clock to a morning hour and drag the token four hexes, centre to
   centre (`{animate: false}`).
   *Observable:* four encounter cards (or four `acksExtras.hexEntered`
   payloads under `Hooks.once`), `day.miles` four cells' worth, the clock
   advanced by miles ÷ miles-per-hour, and the offer dialog once the hours
   reach the budget — `day.offered` true before it is answered.
4. Set the clock past dusk and drag one hex.
   *Observable:* the card reads the night column; the speed is the day's.
5. **Call it a day.**
   *Observable:* `worldTime` is the next dawn, the log's newest row carries
   the miles and hours walked, the strip's budget is fresh.
6. Move to the square scene and drag one cell; then the gridless scene and
   drag two cells' worth of miles.
   *Observable:* one throw and the cell's hours; two throws on the gridless
   drag.
7. Move to the wide-cell hex scene and cross one hex.
   *Observable:* four throws (the cell is four cadence units); unregister the
   table and cross again → one throw and the unpriced line on the strip.
8. Declare the first scene a delve (battlemap setup) and drag.
   *Observable:* nothing billed, one whisper naming the scale; drag again on
   the same scene → no second whisper.
9. **Search an hour** with Something here set to No.
   *Observable:* `day.secondsAdvanced` up one hour and `day.hours` UNCHANGED
   (a search hour is not march budget), the first search slot `done`, the
   `acksExtras.searchHourSpent` payload under `Hooks.once`, `worldTime` up
   one hour.
10. Join as the provisioned Player.
    *Observable:* the strip, the Country cards (values only) and the Camp
    section's forecast; no pickers, no day board, no Judge tab (the Sky section
    shows only when it has chips).
11. Pick **Delve** in the band's mode select, then drag on a feet-scale scene
    (the mile-scale journey scene bills nothing in any mode).
    *Observable:* billed from the new anchor — the first turn card falls
    after one exploration move from where the mode changed, not from the
    journey's last position.
12. Drop the token on the district scene.
    *Observable:* `travel.mode` reads `settlement`.
13. On the journey scene, **Pause**, then drag a hex.
    *Observable:* nothing billed, no card; `clock.pausedBy` is `judge`;
    un-pause and drag → billed from the paused position.

Read the strip's context with `await party.sheet._prepareContext({})` →
`strip`; finish with one real drag.

Drive mechanics (walked 2026-10-09 through the capture driver). The day-end
offer is a DialogV2: answer it from page context by clicking
`dialog button[data-action="end"|"push"|"later"]`, and know that a drag after
dusk raises it too, so an unanswered offer from an earlier step is the one
the next click lands on. The journey's controls are on the rendered party
sheet: End day at the Wilderness tab's head (`[data-action="travelEndDay"]`),
the search and the pause on the quick-tools rail
(`[data-action="searchHour"|"togglePause"]`), the mode select in the band
(`select[name="travel.mode"]`, dispatch `change`), and the search's
`select[name="travel.camp.present"]` / `travel.camp.target` at the foot of Points of
interest. Every tab part renders whether or not it is the active tab, so a
query finds a control on an inactive tab. A scene move is a token delete
on the old scene, then on the new one
`scene.createEmbeddedDocuments("Token", [(await actor.getTokenDocument({x, y})).toObject()])`
with the `_id` stripped: the createToken hook adopts a party-actor token that
carries no formation flag, and the scene's system with it; poll the record
for the new `tokenId` before dragging. A declaration is
`scene.setFlag("acks-extras", "battlemap", {...current, mapSystem})`, and
`null` un-declares. A ten-pixel nudge inside a hex still bills a fraction of
a mile (the grid measures from the token's corner) and crosses nothing. Two
GM clients both run the automation: keep the browser pane off the Gamemaster
seat while the driver holds it. The Player seat is a second `connect()` on
another port; render the party sheet there and read the mode tab's
`[data-section]` keys, and that no `[data-application-part="judge"]` exists.


## The hex stock (added with lairs per hex)

Fixtures: the mile-scale hex scene above, a character actor with an
invented Land Surveying ability item (an Item whose name matches
`/land\s*surveying/i`), a party actor holding it, invented `encounters` and
`searching` documents at priority 30 (`lairsPerHex` with one terrain row,
`lairSubstitution` bands, `settledLairShare`, the monster and terrain
tables the draw reads, `surveyTarget`, `surveyPerSearch`), a lost episode
opened and closed in step 7. Teardown: `api.sweepTracked()`,
`unregisterTable(..., {priority: 30})`, close the episode, restore
`CONFIG.Dice.randomUniform` if it was rigged.

1. Open the Wilderness tab's Points of interest section with no `lairsPerHex`
   registered and press **Stock this hex**. *Observable:* the dialog marks the count required; submitting
   without one warns and re-asks.
2. Register the tables and stock the hex. *Observable:* the scene's flag
   holds one key for the hex, the block reads "up to N" with the row and
   dice, the points list each draw.
3. Stock again with a typed count. *Observable:* the confirm asks first; the
   record's `judgeCount` is set and its `dice` kept.
4. Search an hour with Something here on From the stock and one unfound
   point, a rigged hit. *Observable:* the point reads Found; `searches` for
   this formation is 1.
5. Two unfound points, a rigged hit. *Observable:* the card lists both with a
   Found button each; nothing is marked until one is pressed.
6. Looking for a point, then Elsewhere. *Observable:* the first targets that
   point only; the second never finds.
7. Open a lost episode, walk the shadow to a neighbouring hex. *Observable:*
   Points of interest reads the true hex's label and the astray note; Make it a place
   is refused.
8. **Survey the hex** with a surveyor, rigged to a natural 1, then to a hit.
   *Observable:* a false count differing from the truth, told on the card
   with the truth beside it; then the truth; Tell the party posts one public
   line of the same shape both times.
9. After a search hour with the surveyor in the order and no assessment:
   *Observable:* the survey throws by itself, once; a second hour throws
   none.
10. Make a found point a place. *Observable:* a location actor and a token at
    the hex centre, visible; an unfound point's token is hidden.
11. The hand-off card: register a terrain encounter table with a double and
    throw. *Observable:* the card indents the draw's lines.
12. Join as the Player. *Observable:* no Points of interest section; the
    search selects are absent; the camp's forecast shows.
13. Break a record by hand (`scene.setFlag` a point without an id) and run
    the repair macro. *Observable:* the finding names the scene; the fix
    mints the id. Then **Clear** → the key is gone from the flag.

Drive mechanics (walked 2026-10-09 through the capture driver). Rig the d20
through `CONFIG.Dice.randomUniform`, never `Math.random` (ids are minted from
it), and read one `new Roll("1d20")` back after rigging: on core 14.367
`() => 0.025` threw a 20 and `() => 0.975` a 1 — the face is read from the
top of the die, and a walk that trusted the arithmetic instead of the probe
ran every "rigged hit" as a miss. The encounter chain rolls from its own `rng`
(`Math.random`), so the hour's encounter throw stays unrigged; the survey adds
`surveyPerSearch` per credited throw, so a rigged 1 totals above the target
late in a walk — read the card's "Threw N". The stock dialog answers to
`button[data-action="stock"|"cancel"]`, the restock and Clear confirms to
`yes`/`no`; the re-ask is reached by switching the terrain select to a row the
register gives no dice and submitting with the count empty. Core's dialog
resolves a nullish callback result to the button's action string, so a
dismissing button's callback returns `false` and a driver reads `false`, never
null, as the cancel; open a dialog in one evaluate and press it in the next. The search card
renders once per chat pane, so `button.acks-extras-hex-found` counts double;
click by `data-point-id`. A lost episode needs the scene VIEWED
(`scene.view()`, then wait for `canvas.scene.id`) before
`beginEpisode(f, { day, anchor, trueOffset, judgeNote })` — no walking is
needed, the offset is the true hex. Points of interest and Make it a place both read the
TRUE hex while astray, so step 7 stocks it first: `writeStock(scene, "i:j",
record)` a copy of the shadow hex's record with a fresh point; a point of the
shadow hex is never found there and the refusal never fires. Step 11 is
`terrainEncounterDraw({ kind, terrain, territory, rng })` with a sequenced rng
(`0` lands the list's first entry) and `postEncounterCard(formation, chain,
{ terrain, activity, night, hex, travel })` on a hand-built chain
`{ territory: { ok, outcome, rolls }, outcome, terrainEncounter: draw }`; the
lines carry `acks-extras-enc-depth-<n>`. The repair check is
`getRepairCheck("formation.hexStock")`, `scanCheck(check)` → `{ findings }`,
`fixCheck(check, findings)` — the macro wraps the same three. The Player seat
is a second `connect({ user, port })` on another port.

## A zone on a journey (added with journey zones)

Fixtures, all created and tracked: the mile-scale hex scene and journeying
party of *The march in miles* (its invented `travel` document registered, the
per-hex throw setting on — read it first, restore it at teardown); a
RollTable with two results, one a document result linking a world actor named
with an invented `QQ` name and one text result left blank; two Regions with
an `acks-extras.encounterZone` behavior — a WIDE one over most of the map
stating only `tableUuid` (the table), and a SMALL one inside it, a few hexes
across and clear of the party's start, stating only `encounterTarget: 1` so
every zone throw hits. A Region and its behaviour are one
`scene.createEmbeddedDocuments("Region", [{ name, shapes: [{ type:
"rectangle", x, y, width, height }], behaviors: [{ type:
"acks-extras.encounterZone", system }] }])`; track the region by the uuid it
returns. Read every card's message id back the moment its throw resolves and
`api.track` it.

1. **The zone line and the local throw.** Drag the party into the small zone.
   *Observable:* each card opens with *Encounter zone:* naming both regions,
   shows *Zone throw d6 — N → 1+* where the column rolls would be, and no
   column rolls.
2. **The drawn row.** On the same cards.
   *Observable:* *Drawn from* the table's name with the draw's total, the
   linked row as a document link and the blank row as the Judge-fills line —
   and ONE chat message per throw: no core table card beside it.
3. **A table that is gone.** Delete the table (keep its id in the ledger),
   press **Encounter throw**.
   *Observable:* the missing-table line naming the wide zone, no drawn rows.
4. **Entry fires once.** Set the small zone's `journeyCadence` to `entry`;
   drag the party out of it, then back in across two hexes, then one hex
   further inside.
   *Observable:* the drag out throws per hex; the drag in posts ONE card whose
   cadence reads *entering a zone*, and `acksExtras.hexEntered` (under
   `Hooks.on` for the drag, removed after) fires per hex with `throwOwed:
   false`; the drag inside posts nothing. `formation.clock.zoneIds` holds the
   regions under the party.
5. **Periods throw at End Day.** Set the small zone's cadence to `periods`,
   `dayThrows: 2`, `nightThrows: 1`; drag inside, then **Call it a day** with a
   hunt slot on the board.
   *Observable:* the drag posts nothing; End Day posts two day cards and one
   night card and no hunting card. Set `nightThrows` back to 0 and end
   another day: the imported resting night throws again, if the registered
   `travel` document has a resting-night cell.
6. **The delve is unchanged.** Pick **Delve** and press **Check**.
   *Observable:* the wandering-monster throw reads the first zone under the
   token, as before (§The wrong-floor shift).
7. **Astray.** Open a lost episode with the true hex inside the small zone
   and the believed hex outside it (§The hex stock, step 7's mechanics), press
   **Encounter throw**.
   *Observable:* the card names the small zone: the throw reads the shadow.

Teardown: `api.sweepTracked()` — the regions, the table, the actor, the cards
and the scene's own fixtures go together; close the episode; unregister the
invented documents; restore the throw setting.

## The sky's effects and the night (added with the insert-page rules)

Fixtures: a journey formation over two disposable member actors
(`api.create`), one wearing an equipped armour item of a few stone, one
carrying a cloak so `sheltered` answers yes; the `weather` and `survival`
documents imported from the Judge's own pages (the importer's weather and
survival steps), or invented `conditionEffects`, `fatigue` and `sleep` tables
registered at WORLD priority for the check and unregistered after.

1. Declare the sky by hand: a rainy precipitation band. *Observable:* the list
   under the sky's chips (`.acks-extras-sky-effects`) shows one line per
   stated effect — the throws, the firewood forage line, the visibility factor,
   the disease line. A sky with conditions but nothing imported shows the Judge
   the unpriced hint instead, and nothing else changes.
2. Search an hour. *Observable:* the search card carries the weather line and,
   with a tracker seated, the per-hour tracking line, its figure scaled by the
   hours already searched today. Survey the hex, and post the navigation
   throw as *The delve's figures, imported* does (its drive mechanics): the
   survey card and the navigation card each carry their own weather line.
3. In the Wilderness tab's Camp section tick *Willing to steal* in civilized
   country.
   *Observable:* the forage targets on the panel lose their territory part.
   Tick *Water at hand*. *Observable:* Work the country takes water with no
   throw, and the panel's water hint says it is at hand. Work the country
   twice. *Observable:* the second run says the hours are spent; the hunt and
   forage slots are `done` and the clock ran by their hours.
4. Declare a count of traps in the Day section and End day with an imported
   `managingTraps` cell. *Observable:* one managing-traps encounter card per
   batch, `travel.trapsCarry` holding the remainder; the next End day with no
   traps declared spends the carry.
5. End day under a cold sky with exposure hours set and the uncloaked member.
   *Observable:* the weather's toll card, whispered, with the frostbite save
   for the hypothermic body; a failed save puts `frostbitten` in
   `actor.statuses`. Repeat End day under rainy skies for the imported run of
   days. *Observable:* the disease throw per body on the day the run comes
   due, and `travel.weatherRuns` back at zero for that sky. Then declare a
   sweltering, sunbaked sky. *Observable:* *Hours in the weather* is enabled
   (it is greyed only on a day whose hours cost nothing); with hours set, End
   day's toll card carries the sunburn on the uncloaked body, its hit points
   down by the imported damage, and the heat's armour save by the hour for
   the body in armour at or over the imported stone, a failure adding one
   `fatigued` stack.
6. Tick *Sleeping in armour* and End day. *Observable:* the night's rest card
   with the armoured sleeper's throw against its stone and its rounds to don;
   `flags.acks-extras.fatigue` on each actor advanced by one day. Tick *No
   sleep tonight* for the imported count of nights. *Observable:* `fatigued`
   on the actor with `conditionStacks` 1, rising by one a day; a camp day with
   a restful night lifts it and the card says so.
7. Roll an encounter that is not none on a hex scene. *Observable:* the
   card's when line(s), the sky's chips, the visibility figure under the
   ceiling, and a new Note at the party's point carrying
   `flags.acks-extras.wilds`; track its id.

Drive mechanics: set the declarations through the sheet's own controls (set
the value, dispatch a bubbling `change`) and re-render the sheet after any
`patchTravel` first, because every change submits the whole form and a stale
field writes its old value back; a disabled field submits nothing and reads
as zero. Make the throws certain with the fixtures: a death save target above
20 always fails and one of 1 always saves, and armour heavier than 20 stone
never sleeps well. An invented layer is registered per client, so a second
seat sees the sky unpriced unless it registers the same layer. `disband`
deletes the party actor, so the sweep reports it as not found.

Teardown: `api.sweepTracked()` — the actors, the scene, the note and every
card posted (track each by id as it lands); unregister any invented document.

## The delve's figures, imported (added with the formation binding)

The `formation` document and the travel document's `navigationBonus` row are
read from the Judge's own book (RR p. 271, RR p. 275); their readers did not
change. The walk proves that the import writes each key in the shape its
reader takes, and that every surface that showed the figure as unknown now
prices it. No number from the page enters the walk or its report: from step 3
on, each observable compares a reader's answer with the figures read back from
the world, `w = t.getDoc("formation").tables` and
`nav = t.getDoc("travel").tables.navigationBonus`, where
`t = acksExtras.lib.tables`.

Fixtures, all through `api.create` and swept with `api.sweepTracked()`: a party
actor (its formation comes with it) and four character actors seated as
members (*Core drive mechanics*, above). Wayfinder carries an `ability` item
named Navigation; Scout carries nothing yet; Porter holds the Carrier role
(`[data-action="toggleRole"][data-role="carrier"]` on its row of the Order
tab); Fallen stands at 0 hit points and carries nothing. The Revised Rulebook
is connected on the GM seat, which runs every step.
`f = () => acksExtras.formation.getFormations()[formationId]`.

1. **The world before the import.** *Observable:* `t.getLayer("formation",
   20)` is null and the travel layer holds no `navigationBonus` (note the keys
   it does hold). `acksExtras.location.openRuledataBrowser()` lists the eight
   `formation` rows (`tr[data-entry-key="formation.restInterval"]` and its
   siblings) with the `absent` class and the *not supplied* badge. The party
   sheet's Rest stat ends in a bare slash; Porter's carrier line gives the same
   encumbrance on both sides of its arrow;
   `acksExtras.formation.swimming.swimmingThrow({encumbrance: 5, proficient:
   true, water: "cold"}).unknown` names `swimmingBonus` and
   `swimWaterModifiers`; `acksExtras.formation.travel.navigationCompetence(f())`
   answers `bonus: 0, unpriced: true`. A world that already ran this import
   starts at step 2, and the report says so.
2. **The import, by the Judge's gesture.**
   `acksExtras.importer.cookbookReimportEntries()`, tick
   `input[value="Tables|formation"]` and `input[value="Tables|travel"]`,
   **Reimport**, and answer the confirmation (`button[data-action="yes"]`).
   *Observable:* the console logs `acks-extras | formation tables assembled`
   naming all eight keys, and `travel tables assembled` naming
   `navigationBonus` among its own. Each key has its reader's shape:
   `restInterval` a positive whole count of turns; `carriedBodyStone`,
   `swimmingBonus`, `sinkFeetPerStone` and `breathRounds` positive numbers;
   `carriedGearShare` and `swimSpeedShare` above 0 and at most 1;
   `swimWaterModifiers` `{cold, rough}`, both negative; `navigationBonus`
   `{either, both}`, both positive and `both` the larger. `t.citeOf` answers
   `RR p.271` for each `formation` key and `RR p.275` for `navigationBonus`,
   and every travel key step 1 noted is still there, with the raw
   `navigationProse` window beside the new row. The browser's eight rows lose
   the badge and carry the page line, and the two raw windows (`restProse`,
   `swimmingProse`) stand beside them as rows of their own; the *ACKS Ruledata
   (Imported)* journal in the *ACKS Cookbook — JournalEntry* compendium (never
   the sidebar) holds a `formation.<key>` page for each of the ten, and the
   picker, reopened, marks both rows present. `t.docInfo()` shows whether a Judge's OVERRIDE
   layer sits above either document: the readers answer the override, which
   is why `w` and `nav` read through `getDoc`.
3. **The clock winds the party one turn past the interval.** Rest a turn
   (`acksExtras.formation.advanceTurns(f(), 1, {resting: true})`) so the count
   starts at zero, then `advanceTurns(f(), w.restInterval)`.
   *Observable:* `f().clock.winded` is false, no member carries an effect
   flagged `acks-extras.winded`, the Rest stat reads the interval over itself,
   and the sheet warns that a rest is due. `advanceTurns(f(), 1)`.
   *Observable:* `winded` is true, every member carries the winded effect (none
   holds Endurance), the Rest stat turns `bad` under the winded badge, and the
   turn card carries the winded line; a Player seat given the party actor shows
   the same stat without a reload. `advanceTurns(f(), 1, {resting: true})`.
   *Observable:* the flag, the effects and the warning are gone, and the card
   says the party has recovered.
4. **The swimming throw is priced.** `s = acksExtras.formation.swimming`.
   *Observable:* `s.swimmingThrow({encumbrance: 5, proficient: true, water:
   "cold"})` has an empty `unknown`, a `water.cold` part, and the target
   `5 - w.swimmingBonus - w.swimWaterModifiers.cold`; `water: "rough"` reads
   its own entry the same way. `s.swimSpeed(120)` is `120 * w.swimSpeedShare`.
   `s.drowning({conMod: 1, encumbrance: 3})` gives `rounds`
   `w.breathRounds + 1`, `feetPerRound` `3 * w.sinkFeetPerStone`, and
   `depthAtDeath` their product. `s.rescueStone(4)` is
   `w.carriedBodyStone + 4 * w.carriedGearShare`.
5. **A carried casualty weighs on its carrier.** The party sheet re-renders on
   a formation write and never on the store's, so read it after step 3's
   advances or re-render it. *Observable:* Porter's carrier line gives
   Porter's own encumbrance left of the arrow and that plus
   `w.carriedBodyStone`, to a tenth, on the right. Fallen carries nothing, so
   the body is the whole of the share.
6. **The navigation bonus is priced.** Journey the formation on `forest`, road
   `none` (*End day, the whole tick*, step 1). *Observable:*
   `navigationCompetence(f())` answers `navigation: true, bonus: nav.either,
   unpriced: false`. Give Scout an `ability` item named Pathfinding
   (`createEmbeddedDocuments`). *Observable:* `pathfinding: true` and
   `bonus: nav.both`. Post the throw (drive mechanics). *Observable:* the
   whispered `.acks-extras-nav-card` carries the `nav.both` line and no
   `nav.bonusUnpriced` line, and `travel.navigation.history` gained the row.

Drive mechanics: read `game.settings.get("acks-extras", "advanceWorldTime")`
before step 3. Where it is on, every turn moves the SHARED world clock ten
minutes and End day jumps it to the next dawn, so on a shared world ask before
stepping. Step 6's card is posted without a step: import
`scripts/formation/navigation-card.mjs` in page context and call
`postNavigationThrow(f(), {by: "judge", begin: async () => null})`, the throw
**Throw now** makes, with an opener that opens nothing, so a failed throw
starts no lost episode on a viewed scene. Each advance posts one whispered
turn card, and an encounter card whenever the world's wandering-monster
cadence comes round. Track every
message this seat created during a call (`author` is this user) the moment
the call resolves, the navigation card's too, with
`api.track(id, "ChatMessage")`.

Teardown: `api.sweepTracked()` — the party actor (its formation goes with it),
the four characters (their items and effects with them) and every tracked
card; quote what it returns. The import's product is no fixture: the
`formation` and `travel` layers in the world's store, and the pages
materialized from them, are what the Judge's own import leaves, and no sweep
undoes a re-read. On a shared world step 2 is therefore the owner's call, as
the importer's *Rules tables from Reimport One Shelf* recipe says.

## The day change (added with the calendar key)

Fixtures: two party actors (`api.create`), each with a formation in journey
mode and the generator on (*Roll each new day*), one invented climate
for both; the `weather` document imported from the Judge's own pages, or an
invented one registered at priority 20 (`climateModifiers` for the climate in
two seasons, the four band tables and `accumulation`) and unregistered after.
A third formation left in delve mode is the control. Note each formation's
`travel.weather.settledDay`, `travel.weather.footing.runs` and
`travel.weather.rolls`, and the sky cache (`game.settings.get("acks-extras",
"skyCache")`) key count.

The world clock is shared. Advance it only forward, report the total moved, and
never set it back.

1. Advance a minute from the GM seat so each formation is stamped.
   *Observable:* `settledDay` equals the calendar day on every formation,
   the footing's `runs` and the cache have not moved. Read the footing
   through `travelOf`: a formation with none stored reads the fresh footing,
   and its first stamp writes it.
2. `game.time.advance(<one calendar day in seconds>)`. *Observable:* both
   journeying formations hold an identical `travel.weather.rolls`, each
   footing's `runs` moved by one for the finished day's bands, `settledDay` is
   the new calendar day, and the cache gained exactly one key (its day part
   the calendar day). The delve formation is stamped and its footing and sky
   untouched.
3. Advance a minute again. *Observable:* nothing changed. Then advance three
   days in one call. *Observable:* `runs` moved by three, three new keys in
   the cache, the cache setting written once for the step.
4. End day with *Advance the world clock* on. *Observable:* a new log row, the
   clock at the next dawn, and one new sky settled by the day change, not by
   End day. `travel.dayCount` went up by one and is not in the new cache key.
5. End day with *Advance the world clock* off. *Observable:* a log row, the clock
   not moved, and the same sky, footing and cache.
6. The season: set the *Calendar seasons* setting to a map for your calendar,
   or move the clock across a season boundary (`game.time.advance`). *Observable:*
   the Sky section's season select reads the calendar's season, is
   disabled, and the hint names the calendar's season; the next cache key
   carries that season. Blank the setting on a calendar whose seasons carry
   no recognised name and no count of four. *Observable:* the select is live
   again and the declared season stands.
7. Open the party sheet from the player seat. *Observable:* the sky shows,
   with no controls.
8. Post an encounter throw on a hex scene with a terrain picked. *Observable:*
   the card's two sight lines (who saw whom) and, on the created message,
   `flags["acks-extras"].encounter` carrying the card's facts; track the
   message by id the moment the call resolves.

Drive mechanics: the watcher runs on the active GM's client and acts only on
a forward step, so advance from that seat. A formation that was not stamped
before the step is stamped by it and pays nothing, so step 1 comes first. The
season select is `select[name="travel.weather.season"]` in the Sky section of
the Wilderness tab. For
step 8, set a clear sky by hand first: under a snowy or foggy one the imported
`conditionEffects` ceiling pulls the start in, and the card's opening line
reads the ceiling rather than the thrown distance. Whether a whispered card
sits in the player seat's `game.messages` collection varies from run to run
(one walk found it held there, the next did not), so what proves the whisper
is the message's `visible` getter on that seat and its absence from that
seat's chat log, never its presence or absence in the collection.

Teardown: `api.sweepTracked()` over the ledger: the party actors (their
formations go with them) and every tracked message. Unregister the invented
`weather` document. The cache keys the run created age out of the window on
their own; the world clock is not set back.

## The frame (added with the redesign's phase 1)

Fixtures (each recorded with `api.create`, or `api.track` for what a gesture
makes): a mile-scale hex scene created with `active: false` and viewed; a
disposable `acks-extras.party` actor with its token placed there and adopted;
two disposable character actors enrolled through the token HUD, one owned by
the provisioned Player user so that seat holds a member; a disposable
RollTable for Tweaks to pick. Read each seat's
`flags["acks-extras"].partyPanel` before the walk.

1. **The band is the header.** Open the party sheet on the GM seat.
   *Observable:* `[data-application-part="band"]` matches one element, inside
   `:scope > .window-header` and before the header's controls. A drag that
   starts on the bar (`.acks-extras-party-sheet__bar`, no `data-action`) moves
   the window: `sheet.position.left` changes. The crest opens the Order tab.
   A new name typed in the band's field lands in the formation record's `name`
   and in the party actor's.
2. **One set of rails.** For each mode
   (`acksExtras.formation.travel.setJourneyMode(id, mode)`: `delve`,
   `journey`, `settlement`) and on each tab (press each pill), list the rails:
   `[...el.querySelectorAll(".acks-extras-party-sheet__rail")].map((r) => [...r.children].map((c) => c.dataset.action ?? "reading"))`.
   *Observable:* on the GM seat four rails of 6, 5, 5 and 5 cells in every
   mode and on every tab, the same list on every tab of one mode. Across the
   modes three presses change and nothing else: the pace figure (`goTab` on a
   journey, `togglePace` in the delve and the city), the encounter tool
   (`travelEncounterThrow` on a journey, `encounterNow` elsewhere) and the
   search tool (`searchHour` on a journey, `partyCheck` with
   `data-check="searchMethodical"` elsewhere). The readings change with the
   mode: pace in feet, or in blocks in a city; light as the hours to dusk or
   dawn, the turns left of the lit lights, or the hour.
   Then press each cell once on a journey. *Observable:* a save posts its
   card, and with Magical turned off the next card says so; hit points opens
   the hit-point tool; supplies rations; mouths, pace and light open Order,
   Wilderness and Kit; party checks lists the party's checks and rolls the
   one pressed; pause flips `clock.pausedBy`; experience opens the XP dialog;
   the description tool opens an editor in the reading column and what is
   saved lands in the actor's `system.description`; the image tool opens the
   picker; ownership opens core's ownership window; Tweaks lists the world's
   tables and the pick lands in the record's `tableId`; the Key opens the
   legend under the art row, every rail glyph named.
3. **Every fold's control has one home.** On a journey, on the GM seat, find
   each control and read its part
   (`closest("[data-application-part]").dataset.applicationPart`) and section
   (`closest("[data-section]")?.dataset.section`):

   | Where | Controls (`data-action` or `name`) |
   |---|---|
   | band | `travel.mode`, `name` |
   | Wilderness head | `travel.hexLabel`, `travelEnterHex`, `forageDay`, `travelEndDay` |
   | Country | no field (the cards are readings); `clearOverride` on a card whose chip reads override; `paintThisHex` on a card whose layer the party's hex has not painted (since phase 2a, below) |
   | Points of interest | `hexStock`; once stocked `hexAddPoint`, `hexClear` and, while the hex can be surveyed, `hexSurvey`; per point `hexFound`, `hexPlace` (or `openPlace` once placed) and `hexRemovePoint`; `travel.camp.present`, `travel.camp.target` |
   | Movement | `travel.movement.mode`; while flying `travel.movement.hoursAloft`, `travel.movement.dayHours`, `travel.movement.load` |
   | Sky | `travel.weather.season`, `.auto`, `.fronts`, `.temperature`, `.precipitation`, `.wind`, `.footingMud`, `.footingSnow`; `travelWeatherRoll`; on the climate card, `clearOverride` while climate is overridden and `paintThisHex` where the climate layer is unpainted |
   | Day | `travel.day.kind`, `travel.day.slot.<n>` (one per slot), `travel.hour`, `travel.day.traps`, `travel.day.noSleep` |
   | Camp | `travel.exposure.hours`, `.atHeatSource`, `.wet`; `travel.camp.steal`, `.water`, `.sleepInArmour` |
   | Judge tab, The episode | `lostBegin` (by state `lostDiscover`, `lostReanchor`, `lostEnd`), `travel.lostNote` |
   | Judge tab, The Judge's hand | `travel.override.ground`, `.encounterTerrain`, `.territory`, `.climate`, `.road`, `.following`; `clearOverride` beside each one set |
   | Order head | `autoArrange`, `frontage`, `saveMarchingOrder`, `loadMarchingOrder`, `addBlank`, `openTrapbreak`, `openSkillAudit`, `disband` |

   In the delve, the Dungeon head holds `advanceTurn`, `advanceRound`,
   `restTurn`, `undoTurn` and `togglePace`. On a district scene, the City
   head holds `travel.settlement.wanted` (and `settlementTravelTo` while a
   point of interest is in reach) and the four turn pills, and The city holds
   `travel.settlement.pace`, `.where`, `.route`, `.hour`, `.intent` and
   `.conveyance`.
   *Observable:* each is found exactly once (a point's own controls once per
   point), where the table says. Change one field per section and re-read the
   record: `travel.override.territory`, `travel.camp.present`, `travel.movement.mode`,
   `travel.weather.temperature`, `travel.hour`, `travel.camp.steal`,
   `travel.lost.judgeNote` and, in a district, `travel.settlement.wanted` each
   take the new value. The Camp section renders after Day, its forecast first;
   End day pressed once adds one row to `travel.log`, and Sightings lists it.
4. **The Judge's tab is the Judge's.** Join the provisioned Player seat and
   open the party sheet.
   *Observable:* no `[data-application-part="judge"]` and no
   `[data-tab="judge"]` anywhere in the window; no saves rail and no quick
   tools; the sheet tools are the Key alone; the hit-point and supplies cells
   are readings (`span.is-reading`, no `data-action`) while mouths and light
   still open their tabs; the band's mode word and name are text; the mode tab
   ends with the requests section (`section.player-actions`, there because
   the seat owns a member). On the GM seat the Judge pill is dashed and its
   part is present.
5. **The chevron.** On the GM seat press `[data-action="togglePanel"]`.
   *Observable:* the window carries `is-panel-hidden`, no tab panel is
   displayed, `sheet.element.offsetHeight` drops, and the seat's
   `partyPanel[<actor id>]` reads `true`. After `sheet.render()` the panel is
   still hidden; close the sheet and reopen it: still hidden. The Player
   seat's sheet keeps its panel. Press a pill: the panel shows that tab and
   the flag reads `false`.
6. **Two type sizes.** Close the sheet, set `fontScale` to 14, and open it
   FRESH (`party._sheet = null`, then render: an open window keeps its old
   sizes). Read the window's width, one rail cell's
   `getBoundingClientRect().height`, the bar's height and `--acks-extras-k`.
   Repeat at 18.
   *Observable:* the width is `920 × base/14` (920, then 1183 unless the
   viewport is narrower), the cell `32 × base/14` (32, then 41.1), the bar
   `26 × base/14` (26, then 33.4), k 1 and 1.2857. At 18 the band sits inside
   its header (its bottom above the header's), every tab scrolls at its own
   part root while it is the active one (an inactive panel is not a
   scroller, so make each active to read it) and no other element gains an
   overflow it lacked at 14, and a
   tab keeps its scroll across a field change (ROADMAP, "The Wilderness
   tab's scroll across a field change", for where it does not; shorten the window first,
   `sheet.setPosition({height: 520})`: at a tall viewport the frame grows to
   fit its content and no part scrolls; then scroll the Wilderness tab down,
   change a select, read `scrollTop` again). In that short window the window
   content's `clientHeight` stays under the frame's and only the part's
   `scrollHeight` exceeds its box: content taller than the frame is cut off
   with no scrollbar to say so. The re-render re-fits the height to auto
   (core does that to every auto-height window on every render), so the
   scroll is kept only while the part still overflows at the re-fitted
   height; close the Key legend first, or its rows crowd the part to a few
   pixels and the content's backstop scroll takes over. Narrow the window toward
   its 640px floor: every control still reachable, nothing cut off without a
   scrollbar.
7. **Keyboard and names.** From the crest, press Tab through the window.
   *Observable:* focus reaches every control of the band, the rails, the tab
   row, the active tab's head and its sections, in reading order; the Hunted
   here pill shows a focus ring while its checkbox has focus; the reading
   cells are passed over. Every control of the frame is named by its text, an
   `aria-label` or a tooltip. Known exceptions, unchanged from before the
   frame (ROADMAP): the Order tab's member arrows and blank-row remove, the
   Kit tab's light and spell pickers and removes, and the requests section's
   pickers.

Teardown: `api.sweepTracked()` (the scene, the party actor and with it the
formation, the members, the table, every tracked card); remove the fixture
actor's key from each seat's `partyPanel` flag and read the flag back; set
`fontScale` back to 14 on every seat that changed it, since a client setting
follows you into the next session.

Drive mechanics: every tab part renders whether its tab is active or not, so a
selector finds a control on an inactive tab; when the check is about what is
SHOWN, read `offsetParent` (null while hidden). The band is moved after each
render, so read it once `await sheet.render()` resolves. For the decision
rather than the DOM, `(await sheet._prepareContext({})).frame` holds the
rails, the heads and the band as the templates render them; finish each step
with a real press.

## The country (added with the redesign's phase 2a)

Fixtures, each recorded with `api.create`, or `api.track` for what a call or
a gesture makes, read back by the id it returns:

- a mile-scale HEX scene created with `active: false` and viewed (the march in
  miles recipe's first scene), and a second disposable scene of any grid, also
  `active: false`, for the seat to be looking at in step 6;
- a disposable `acks-extras.party` actor with two disposable members enrolled
  through the token HUD, one owned by the provisioned Player user, and the
  party token placed on the hex scene and adopted (poll the record for
  `tokenId`);
- the march in miles recipe's invented `travel` document, registered at
  priority 30 with `encounterFrequency.traveling.<territory>.mileHex` for TWO
  territories: X at the scene's cell, Y at twice it;
- hex C, the one the party token stands in, and three of its neighbours A, B
  and D, picked by offset and read as points with
  `scene.grid.getCenterPoint({i, j})`, so every drag below crosses one hex;
- through `acksExtras.battlemap.terrain.paintHexAt(scene, point, value,
  layer)`: hex A painted a forest table on `terrain`, Y on `territory` and a
  climate on `climate`; hex B a hill table on `terrain` alone; C and D left
  unpainted. Each call creates or updates a region: list
  `layerRegionsOf(scene, layer)` after the painting and track every region
  id;
- one water line across hex D, clear of C:
  `scene.createEmbeddedDocuments("Wall", [{c, ...acksExtras.battlemap.water.waterWallData({kind: "river"})}])`,
  its id tracked;
- the scene's default country, written with
  `acksExtras.battlemap.country.writeSceneSetup(scene, {country: {ground: "grassland", territory: X, climate: <a second climate>}})`.

Drive mechanics. The record is `acksExtras.formation.getFormation(id)`; its
reading `.travel.map`; the resolution
`acksExtras.formation.travel.travelOf(f)` (`.provenance`) and `countryOf(f)`
(`.mapValues`). The sheet's decision is `(await
party.sheet._prepareContext({})).travel.country` (`cards`, `climate`,
`encountersDrawOn`) and `.countryOverrides` (the hand). A drag is the march
in miles recipe's, centre to centre with `{animate: false}`; a throw it owes
posts a whispered card, whose id is read back at once (the newest
`game.messages` entry) and tracked. Count `acksExtras.hexEntered` with a
`Hooks.on` removed after the step. The Judge's refresh is debounced and runs
on the active GM's client alone (`game.users.activeGM`): poll the record for
up to two seconds rather than reading it at once, and keep a second GM client
off the world while the walk runs. A hand select is
`select[name="travel.override.<key>"]`: set `.value` and dispatch a bubbling
`change`.

1. **Entering the journey reads the map.** With the token in hex C, call
   `acksExtras.formation.travel.setJourneyMode(id, "journey")` (the
   mile-scale arrival may already have).
   *Observable:* `travel.map` exists before any drag, its `i`/`j` hex C's,
   its `ground`, `territory` and `climate` the scene default's with
   `source.<key>` "scene"; `provenance` reads "scene" for the three; the
   Country cards show those values, each sourced "The scene's default", with
   no chip.
2. **A drag caches the hex and writes no country key.** Record
   `Object.keys(f.travel)`, then drag into hex A.
   *Observable:* `travel.map` names hex A with its painted ground and table,
   Y and the painted climate, each `source` "map"; `following` "none" (the
   scene has a water line, none under A) and `road` null; `Object.keys(f.travel)`
   gained none of `ground`, `encounterTerrain`, `territory`, `road` or
   `following`. No `hexEntered` fired and `travel.day.cadenceCarry` holds one
   cell's miles: the step was counted in Y, the territory it arrived in. The
   cards read the painted values, sourced "Read off the map"; the band's
   territory chip reads Y; the Encounters line names hex A's table.
3. **The cadence on the way back.** Drag back into hex C.
   *Observable:* one `hexEntered` with `cadence` "grid" and `territory` X.
4. **A river.** Drag into hex D, then set **Moving by** to vessel.
   *Observable:* `travel.map.following` "river" and `water` `{kind: "river",
   navigable: true}`; the Following card reads the river, sourced from the
   map; the Camp section says water is already at hand, with its declaration
   unticked. On the vessel, `travelOf(f).encounterTerrain` is the land river
   table with `provenance` "map" and the Encounters line names it, while
   `travel.map.at` is unchanged (no re-read). Back on foot, the ground's own
   table returns. Pause the journey (`clock.paused` with `pausedBy` "judge")
   and drag into hex C and back: `travel.hex` and `travel.map` follow each
   drag, the world clock and `day.miles` do not move, no card is thrown;
   unpause.
5. **The Judge's word.** On the Judge tab, set the hand's ground to a ground
   other than the map's under hex D, and its road to paved.
   *Observable:* `travel.override` holds both and `travel.ground` stays
   absent. The Ground card shows the override, sourced "The Judge's word", with
   the burgundy **Override** chip, whose tooltip names the map's ground; the
   Encounters line names the overridden ground's own table, not hex D's
   (`travelOf(f).encounterTerrain` is the default with `provenance` "default",
   while `countryOf(f).mapValues.encounterTerrain` is still the map's); the
   Road card shows paved with the pen mark (the scene has no road to read) and
   no Override chip. The hand's rows say what the map reads, or that it says
   nothing, and the two set carry a clear. Press the Ground chip's clear: the
   card reads the map again, with no chip. Set the hand's ground to the map's
   own: provenance "override" and no chip. Clear both rows from the hand:
   `travel.override` is gone from the record. Write a declaration an older
   record holds (`patchFormation(f.id, (r) => { r.travel.road = "earth"; })`
   from `formation-model.mjs`): the Road card reads it, sourced "Declared on
   the sheet", with the pen mark and its clear (`clearDeclared`). Press the
   clear: `travel.road` is the default, the card reads the default with no
   chip.
6. **Paint this hex.** Drag back into hex C and view the second scene. On the
   GM seat the Ground and Territory cards and the Sky's climate card offer
   **Paint this hex**; Road and Following do not. Press the Territory card's.
   *Observable:* the party's scene comes into view; the Country brush palette
   opens with its Territory pill pressed (`aria-pressed="true"`) and X, the
   card's value, the armed swatch; no region changed (`layerRegionsOf(scene,
   "territory")` as before). Click hex C on the canvas (the battlemap
   recipe's pointer mechanics): a territory region for X now holds hex C.
   Close the palette and click hex B: nothing is painted.
7. **The Judge's refresh.** Count the `updateSetting` events after which this
   formation's `travel.map` differs from before (an observer: a peer's
   formations ride the same setting). Watch the record after step 6's click,
   with the token still in hex C.
   *Observable:* within two seconds `travel.map.territory` reads X with
   `source.territory` "map" where it read "scene" — written by the refresh,
   not a drag — and the Territory card lost its paint chip. Paint hex C's
   terrain and climate in quick succession from the console: ONE counted
   write, after which `travel.map` carries both. Paint hex B (the token is not
   on it): no write. Change the scene default's ground
   (`writeSceneSetup(scene, {country: {...sceneCountry(scene), ground:
   <another>}})`): no write, since hex C's own paint answers the ground. Erase
   hex C's terrain (`paintHexAt(scene, point, null, "terrain")`): the reading
   falls to the new default, sourced "scene".
8. **No token, no map.** Delete the party token.
   *Observable:* the record's `tokenId` and `sceneId` are null, `travel.map`
   is still stored, and `provenance` reads "default" for every key (the
   fixture never declared one). Place the token again in hex A (the march in
   miles recipe's re-creation) and poll: the arrival re-reads, `travel.map`
   names hex A, and the provenance returns to "map".
9. **A player's seat.** Join the provisioned Player seat and open the party
   sheet.
   *Observable:* `[data-section="country"]` holds the four cards with their
   values, and no `.acks-extras-country-source`, no
   `.acks-extras-country-chip` and no `[data-action]` inside it; no climate
   card wherever the Sky section shows; no Judge tab.

Teardown: `api.sweepTracked()` — the two scenes with their regions and walls,
the party actor and with it the formation, the members, every tracked card —
and quote its result; unregister the invented `travel` document
(`acksExtras.lib.tables.unregisterTable`). The country brush is client state:
close the palette, and if the run left the toolbar's brush armed, press any
other control.

## The hex the party is shown (added with the redesign's phase 2b)

The plate's drawing, the day's navigation throw at its first step off a road,
the lost episode it opens, the Judge tab's Where they are, What the party is
shown and Navigation, quietly, and the stock's day. Every throw, every opening
and every move of the shadow runs on the ACTIVE GM's client: drive from that
seat, keep a second GM client off the world, and rig the dice and register the
invented table there.

Fixtures, each recorded with `api.create`, or `api.track` for what a call, a
gesture or the feature makes, read back by the id it returns:

- a mile-scale hex scene (*The march in miles*'s first scene; `grid.type` 2,
  hex rows, at least ten hexes across and six down) created with `active: false` and
  `ownership.default` OBSERVER, and viewed. Its background is Foundry's own
  `ui/parchment.jpg`, never book art: confirm it is served
  (`(await fetch(foundry.utils.getRoute("ui/parchment.jpg"), {method: "HEAD"})).ok`),
  then set it through the scene's level after creation
  (`scene.levels.contents[0].update({"background.src": "ui/parchment.jpg"})`,
  the battlemap recipe's mechanic). A second disposable scene of any grid,
  also `active: false`, for the Judge to be looking at in step 11;
- the scene's default country, ground `grassland`:
  `acksExtras.battlemap.country.writeSceneSetup(scene, {country: {ground: "grassland", territory: X}})`;
- six hexes picked by offset and read as points with
  `scene.grid.getCenterPoint({i, j})`: C, where the party starts, two hexes
  inside the scene's rectangle (`scene.dimensions.sceneRect`, which the
  padding surrounds) from its left and top; A, B, D and E along C's row, each
  the east neighbour of the one before; and T, D's south-east neighbour
  (`(await import("/modules/acks-extras/scripts/formation/plate.mjs")).neighbourToward(scene, D, "se")`);
- through `acksExtras.battlemap.terrain.paintHexAt(scene, point, value,
  "terrain")`: hex C painted `grassland` and hex T a second ground (any value
  `paintableValues("terrain")` lists other than grassland). List
  `layerRegionsOf(scene, "terrain")` after the painting and track every
  region id;
- a paved road from C's centre to A's centre,
  `scene.createEmbeddedDocuments("Wall", [{c: [Cx, Cy, Ax, Ay], ...acksExtras.battlemap.roads.roadWallData({surface: "paved"})}])`,
  its id tracked. *Probe:* `acksExtras.battlemap.roads.stepBetweenHexes(scene,
  C, A).on` is true and `stepBetweenHexes(scene, A, B).on` false;
- a river no boat can follow, across hex C a quarter of the cell's height
  above its centre, edge to edge:
  `{c: [Cx - sizeX / 2, Cy - sizeY / 4, Cx + sizeX / 2, Cy - sizeY / 4], ...acksExtras.battlemap.water.waterWallData({kind: "river", navigable: false})}`
  (`sizeX`/`sizeY` the grid's), its id tracked. A navigable one would spare
  the throw on its own;
- a disposable `acks-extras.party` actor with two disposable members enrolled
  through the token HUD, one owned by the provisioned Player user, its token
  placed in hex C and adopted (poll the record for `tokenId`), then
  `acksExtras.formation.travel.setJourneyMode(id, "journey")`;
- hex C stocked by hand with two invented points, P found by this formation
  and Q not:
  `acksExtras.formation.hexStock.writeStock(scene, hexStockKey({offset: C}), record)`
  (`hexStockKey` is under `hexStock.pure`), where `record` is `{label: <C's
  label>, stocked: true, stockedAt: game.time.worldTime, terrain: "grassland",
  territory: X, count: 2, judgeCount: 2, substitute: false, points: [P, Q],
  searches: {}, assessments: {}}` and each point is `{id:
  foundry.utils.randomID(), kind: "placed", name: "Point P", sub: null,
  rarity: null, creature: null, draw: null, found, placeUuid: null, note:
  ""}`, P's `found` `{[formationId]: game.time.worldTime}` and Q's `{}`. The
  stock is a flag on the scene and goes with it;
- an invented `travel` document registered at priority 30 on the active GM's
  client: the country recipe's `encounterFrequency` and `gettingLost:
  {grassland: <a target of your own that a 20 makes>}`, through
  `acksExtras.lib.tables.registerTable({id: "travel", tables}, {priority: 30})`;
- *Journey encounter throws* (`travelEncounters`) read and set off for the
  walk, so no drag posts an encounter card, and restored at teardown.

Drive mechanics. `f = () => acksExtras.formation.getFormation(id)`;
`T = acksExtras.formation.travel` (`travelOf`, `trueTravelOf`,
`navigationOwed`, `journeyDayKey`, `tokenCentre`); `shadow =
acksExtras.formation.shadow`. The sheet's decision is `ctx = await
party.sheet._prepareContext({})`: `ctx.travel.plate`, `ctx.travel.judge.where`,
`.shown`, `.preview` and `.navigation`, `ctx.travel.hexStock.stockedLine`,
`ctx.strip.hex` and `ctx.frame.reading`; finish each step with the real press.
A drag is `tokenDoc.update({x, y}, {animate: false})` to
`scene.grid.getTopLeftPoint(offset)`. The movement hook posts the card after
the update resolves, so poll `game.messages` for up to two seconds for a
message authored by this seat and newer than the drag, and `api.track(msg.id,
"ChatMessage")` it the moment it appears; track the cards a press posts the
same way. A ledger write takes a moment to read back (*Lost*): settle ~1.5 s
before asserting on `f()`. Rig the d20 through `CONFIG.Dice.randomUniform`,
saving the original first, and read one `new Roll("1d20")` back after each
rig (*The hex stock*: `() => 0.975` throws a 1 and `() => 0.025` a 20 on core
14). An episode opens only on a viewed scene (`scene.view()`, then wait for
`canvas.scene.id`). The confirm dialogs answer to `button[data-action="yes"|"no"]`;
open in one evaluate and press in the next. A card renders in every chat pane, so click one of its
buttons, by `data-formation-id`. A drag after dusk or past the day's hours
raises the day-end offer (*The march in miles*): answer *later*. A plate
canvas is painted again as each image arrives, so read its pixels after
`await party.sheet.render()` and a short settle; `getImageData` works because
the background and the token art are the world's own origin.

1. **The plate draws hex C.** Open the party sheet on the GM seat.
   *Observable:* the frame holds `canvas.acks-extras-plate__canvas[data-plate-kind="frame"]`,
   404 pixels square, the plate holds no `[data-action="editPartyImage"]`, and
   its `.acks-extras-party-sheet__plate-hex` reads C's label. With `g =
   plate.plateGeometry(scene, ctx.travel.plate.center, 404, {points:
   ctx.travel.plate.points})`: `g.kind` "hex" with six vertices, one road
   (`surface` "paved"), one water line (`kind` "river", `navigable` false), two
   points; `ctx.travel.plate.tint` is grassland's `TERRAIN_COLORS` entry.
   Pixels (`getContext("2d").getImageData(x, y, 1, 1).data`): (2, 2), outside
   the cell, is transparent; most of the non-transparent pixels are opaque,
   where a plate painted with no background
   (`plate.paintPlate(document.createElement("canvas"), g, {tint})`) holds the
   tint alone at alpha 204; P's pixel is the point colour (the canvas's
   computed `--acks-extras-plate-point`), and on a circle of radius 404 × 0.028
   round Q some samples are that colour too (the Judge's dashed ring). Where
   they are shows both plates labelled C, "The truth and the belief are the
   same hex", and no pad. Points of interest reads *Stocked today*
   (`.acks-extras-hex-stock-day`), the stock stamped at the clock's own time,
   and `ctx.travel.hexStock.stockedAgo` is 0. On the Player seat, viewing the
   scene: the frame
   plate draws, `ctx.travel.plate.points` lists P alone, P's pixel is the
   point colour, and no sample round Q is.
2. **A drag on the road owes nothing.** Drag from C to A.
   *Observable:* `f().travel.map.road` "paved"; no navigation card;
   `T.travelOf(f()).navigation` `{thrownOn: null, lastResult: null, history:
   []}`; `T.navigationOwed(f())` has `state` "following", `route` "road" and
   `road` "paved", and Navigation, quietly's `.acks-extras-navigation__line`
   (`data-state="following"`) names the paved road. Press **Throw now**
   (`[data-action="navigationThrowNow"]`): an info toast that nothing is
   owed, no card, no history row.
3. **The day's first step off the road throws, once.** Rig a 1 and drag from
   A to B.
   *Observable:* ONE new `.acks-extras-nav-card` (track it), whispered to the
   GMs alone, its natural 1 failing whatever the bonus, the strayed verdict.
   `f().travel.navigation.thrownOn` equals `T.journeyDayKey(T.travelOf(f()))`,
   a string `"<calendar day>:<dayCount>"`, and `history[0]` is `{day:
   thrownOn, count: f().travel.dayCount, hexLabel: <B's label>, target,
   total, natural: 1, success: false, by: "step"}` with the card's target and
   total. Navigation, quietly reads *Thrown today.*; its row reads Day
   `count + 1`, B, the throw against its target, *Strayed* (`is-strayed`)
   and *First step*.
4. **The episode opens.** Same gesture.
   *Observable:* `lost.phase` "astray", `lost.sceneId` the scene's id,
   `lost.anchor` B's offset; the card's note says the episode is open, and it
   carries no button. A hidden token flagged `shadowFor` the formation stands
   in hex B: `s = shadow.shadowFor(scene, id)`, and `api.track(s.uuid)` at
   once. The GM seat's band wears the astray chip; the Player seat's does
   not, and the Player's canvas shows no new token.
5. **A further drag moves the shadow with the token.** Drag from B to D.
   *Observable:* no new navigation card (the day's throw is made); the shadow
   stands in hex D, the token's hex
   (`scene.grid.getOffset(T.tokenCentre(shadow.shadowFor(scene, id), scene))`);
   `lost.faked` holds D's key and `lost.observations` the pair `{at: <D's
   key>, shown: <D's key>}`; Where they are still says one hex, and the pad
   shows six direction cells round a dice cell.
6. **Shift the truth.** Press
   `[data-action="shiftTruth"][data-direction="se"]` on Where they are.
   *Observable:* the shadow stands in hex T; the party token has not moved;
   `lost.observations` gained `{at: <T's key>, shown: <D's key>}`; nothing
   changed on the Player seat.
7. **The two plates differ, and the encounters follow the truth.**
   *Observable:* the True plate (`data-plate-kind="true"`) is labelled T's
   hex, the Believed plate D's, and the believed plate and its caption carry
   `is-differ` (dashed, gold); the badge (`.acks-extras-where__compass`) reads
   "The truth lies South-east", and `ctx.travel.judge.where` has `differ`
   true and `compass.dir` "se". `T.trueTravelOf(f()).ground` is T's painted
   ground and `T.travelOf(f()).ground` grassland: on the GM seat the
   Wilderness tab's encounters line (`.acks-extras-country-draw`) names T's
   table, while the Judge tab's preview of a player's seat names
   grassland's. Points of interest reads T's label with the astray note.
   Drag from D to E. *Observable:* the shadow moves one hex east of T and the
   badge still reads South-east. Press the pad's dice cell
   (`data-direction="roll"`). *Observable:* a toast names the face the truth
   moved toward, and the shadow stands one hex from where it was.
8. **Unknown country, from the Player seat.** On What the party is shown,
   click the Unknown country tile (`input[name="travel.shown"][value="unknown"]`).
   *Observable:* `f().travel.shown` "unknown". On the Player seat the frame
   plate is `.is-blank`, with no canvas and no hex label; `ctx.strip.hex.label`
   is "" (the strip reads a dash); `ctx.frame.reading.overline` names no hex
   and its chips carry no territory or following; the Country section holds
   exactly one `.acks-extras-country-unknown` and no
   `.acks-extras-country-cards`. On the GM seat the Wilderness tab shows the
   same beneath `.acks-extras-shown-overline`, the frame plate is blank, the
   hex field (`input[name="travel.hexLabel"]`) still holds E's label, and the
   Judge tab's preview (`.acks-extras-shown__preview`) shows the blank plate
   and the one line. `T.trueTravelOf(f())` is what it was. Click the believed
   hex tile: every seat draws again.
9. **They realise they are lost.** Rig a 20 and press **Throw now**.
   *Observable:* one card (track it), "Thrown true while they are astray", with
   the **They realise they are lost** button (`.acks-extras-nav-realise`);
   `history[0]` is by "judge" with step 3's day, `thrownOn` unchanged, and
   `lost.phase` still astray. Press the card's button (no dialog follows).
   *Observable:* `lost.phase` "aware", `lost.faked` and `lost.observations`
   empty, the shadow where it stood, the players told on the Player seat, and
   Where they are still shows two plates that differ. A second press does
   nothing.
10. **The next day, aware.** Press End day (track every card it posts). With
    *Advance the world clock* off the calendar day stays where it is, and the
    key still moves with the count.
    *Observable:* End day posts no navigation card and `thrownOn` is
    unchanged; Navigation, quietly reads *Owed at the day's first step off the
    road.* Rig a 1 and press **Next hex** (`[data-action="travelEnterHex"]`)
    with the hex field as it stands.
    *Observable:* one card (track it), "They already know they are lost", no
    button; one shadow, no second; `thrownOn` the new day's key, its count
    half one up, and `history[0]` by "step". Drag from E to D. *Observable:*
    no card, and the shadow moved one hex west. With the day open, advance
    the clock past midnight by hand (`game.time.advance(<seconds to the next
    calendar day>)`, forward only, the total reported) and drag from D to E.
    *Observable:* one card (track it): the calendar half of `thrownOn` is the
    new day's and the count half unchanged, and the shadow stands one hex
    east.
11. **The refused opening, and the card's Begin.** Press **They turn back**
    (`[data-action="lostEnd"]`) and answer yes.
    *Observable:* `lost.phase` null, no `shadowFor` token on any scene, both
    plates read the party token's hex, no pad. View the second scene, rig a 1
    and press **Throw now**.
    *Observable:* a warning to open the party's scene, and one card (track
    it) with the strayed verdict, the note that the episode could not be
    opened and a **Begin the lost episode** button (`.acks-extras-nav-begin`);
    `lost.phase` still null and no shadow. Press the button there.
    *Observable:* the same warning, nothing opens, the button stays. View the
    hex scene again and press it.
    *Observable:* no dialog; `lost.phase` "astray", a shadow (track it) in the
    party token's own hex, both plates the same hex and no badge, and the pad
    shown. Press **They turn back** and answer yes.

Teardown: restore `CONFIG.Dice.randomUniform` to the function saved before
the first rig; `api.sweepTracked()` — the two scenes with their regions,
walls, stock and shadows, the party actor and with it the formation, the
members, every tracked card — and quote its result: the shadows They turn back
retired, and anything the scenes took with them, are its "could not find".
Unregister the invented `travel` document
(`acksExtras.lib.tables.unregisterTable("travel", {priority: 30})`) and
restore *Journey encounter throws*. The world clock is not set back; report
how far step 10 moved it.

## A teleport between scenes (added with the teleport fix)

The party follows its token through a `teleportToken` Region to another scene,
whoever steps in. No walk in `tools/live` covers this section. It is driven
by a script over the capture driver, one `connect()` per seat on its own port.

**Fixtures**, each `api.create()`d so that the ledger holds it:

- Scenes A and B: `padding: 0`, `grid: {size: 100, distance: 5}`, and
  `ownership: {default: 2}` so the Player seat can view them.
- The arrival: a Region on B with one `rectangle` shape and no behavior.
  Create it first, because the departure names its uuid.
- The departure: a Region on A whose `behaviors` hold
  `{type: "teleportToken", system: {destinations: [<arrival uuid>], choice: false, placement: "center"}}`.
- A character actor as the member. For the player run, grant the Player
  OWNER on the MEMBER. The party actor's ownership is derived from its
  members' (`syncPartyActorOwnership`), so a grant made on the party actor
  itself is rewritten and the player's move is refused.
- A hand-created `acks-extras.party` actor. Poll its
  `flags.acks-extras.formationId` for the formation it creates, then drop the
  member on its sheet (Core drive mechanics).
- The party token: a token of the party actor on A beside the departure, with
  `actorLink: true`. Poll the record until `tokenId` names it.

**Steps.** For the player run, wait until the party actor's ownership names
the Player. On the seat that moves, `await scene.view()` A and wait for
`canvas.ready`. Then move the party token to a point inside the departure
with `tokenDoc.update({x, y})`. Core stops the move where the token first
enters the region and teleports it from there. Poll B for a token flagged
with the formation's id, and `api.track()` its uuid at once. Walk it from
each of these seats:

1. The Gamemaster: the primary GM runs the batch itself.
2. The Assistant Gamemaster: it runs the batch, and the primary GM only hears
   the broadcast.
3. The Player: a GM runs the batch, since a player has no `TOKEN_CREATE` in
   v14. Read which GM from the `createToken` hook's user.
4. The Gamemaster again, viewing B and moving the party from across A. Nobody
   renders the token, so there is no animation to wait out, and the move
   bills rounds. The movement chain's whole-record write then races the
   teleport's patch (DECISIONS 2026-10-17).
5. Route 4 with the race forced the wrong way round. Before the move, replace
   `game.time.advance` on the primary GM's page with a wrapper that awaits a
   promise the script resolves, then calls the original; hold only the first
   call. Wait until the wrapper has been entered and the record names B, so
   the teleport's patch has landed while the chain holds its copy, then
   resolve it. Restore the method afterwards: it is the prototype's, so
   `delete game.time.advance`. The chain's write is the formations write after
   the release whose clock moved. Unfixed, it put scene A back.
6. Route 5 with the party token placed by hand and a waiting whole write
   after it. Create the party actor with `prototypeToken: {actorLink: true}`,
   view A, and dispatch a `DragEvent("drop")` carrying `{type: "Actor", uuid}`
   on `canvas.app.view` at the client point of a scene point (Core drive
   mechanics); `api.track()` the token it makes. Before the move, read a copy
   with `acksExtras.formation.getFormations()[id]` and give it a run-unique
   key. After the chain's write, pass it to
   `acksExtras.formation.removeLight(copy, "<an id no light has>")`: a whole
   write of the copy and nothing else. Start the card scan before the drop,
   since the fog notice for A posts at placement.

**Observable.**

- The record (`game.settings.get("acks-extras", "formations")[id]`) names B
  and the arrival's id, and its `clock.lastPosition` is the arrival's `x`/`y`.
- On the seat that moved, `acksExtras.formation.getPartyToken(record)`
  resolves to the arrival, and the party sheet renders and names the member.
- To see the mechanism: on the primary GM, an observer `deleteToken` hook's
  `options.replacements[oldId]` is the arrival's uuid, and `fromUuidSync` of
  it resolves there.
- Step 6: the record names the dropped token once it lands, and the token
  carries the formation's flag. After the copy's write, the record still
  names B, the arrival and its position, and carries the copy's key; the copy
  now names B too. The copy's clock puts back the rounds the chain billed:
  only the linkage is kept (DECISIONS 2026-10-17, "Every whole write keeps
  the party token's linkage").
- Each run posts one card: the fog notice ("no one mapping") for B, which the
  environment sync posts as the party arrives. While the record lost the
  party, there was none.

**Teardown.** Run `api.sweepTracked()`. The original token on A shows as
missing, because the teleport deleted it. The fog card is the module's: read
its id back from the newest `game.messages` entry right after the move, and
`api.track(id, "ChatMessage")` it. Then confirm `getFormations()` no longer
lists the formation.

## Teardown

`api.sweepTracked()` over the ledger: the scene, the party actor (its
formation goes with it), the member actors and the trap item were all
`api.create()`d, so they are already in it. Confirm `getFormations()` no longer
lists the formation. The chat cards a trap probe posts are not — the module
creates them — so read each card's id back right after your own probe (the
newest `game.messages` entry, or the message the probe returns) and
`api.track(id, "ChatMessage")` it at once; the sweep then takes the cards with
the rest. Never find them by content or name.
