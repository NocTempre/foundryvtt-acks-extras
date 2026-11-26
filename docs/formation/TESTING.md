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
- A walk's fixtures are kept and found again by marker
  (`flags.world.fixture`, `formation/<name>`), or built carrying one
  (`api.fixture`); each walked section below names its markers, and brings
  them to the shape its steps need at its start. A party a walk keeps is left
  in delve: a journeying or settled record is billed and rolled for on every
  clock advance any walk makes. Each chat card a walk reads is marked in the
  order posted (`formation/<walk>-card-<n>`), and the next run retires them
  before its first section, counting up from 1 and stopping after five
  markers in a row that nothing carries.

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
- **`attemptDisarm` opens a DialogV2 on success and does not wait for it**: the
  card posts and "Work on it" returns at once, while the disarm/discharge
  question stays open on the thrower's own client (a player's request opens it
  in that player's seat, not the Judge's). The trap is already written
  disarmed; a discharge answer later writes it discharged and whispers one
  line. Click
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
  it from the player seat rather than activating it: a view moves that client
  alone, so nothing needs restoring.
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
  outside its own ledger. A delete is by the run's own ids, and only in a
  setup section (`.claude/rules/live-testing.md`, step 4); a setup section
  that died before its sweep has its ids in its log — re-track them and
  `sweepTracked()`.
- **Hold the Gamemaster seat alone.** The seat's windows elect one to run the
  automation (docs/lib/MODEL.md, "Which window automates"). A second one,
  whether a peer's walk or an idle pane, may be the window that bills your
  moves, and one still running code from before the election bills them
  again: a move billed twice, a write lost. `game.users.filter(u =>
  u.active)` lists the seat once however many clients hold it. The server's
  debug log names each authentication (TEST_ENVIRONMENT). A window's own view
  of the election is `automationCensus()` and `isLeadClient()` in
  `scripts/lib/automation-client.mjs`: `formation-steps`, `formation-hex`
  and `battlemap` read both at their start and stop when another window
  leads, and `formation-steps` logs every write of the formations setting it
  hears, a write without its own mark being another window's. A walk that
  goes on under another window's lead reads that window's work: a throw it
  rigged comes out on unrigged dice, and a hook it waits on fires elsewhere.
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
8. **Trapbreaking dialog (U1t).** `traps.openTrapbreakApp(formationId, actorId)`
   (the sheet's Dungeon tab → Trapbreaking opens it for the seat's first
   character). Fixtures: a party on a scene with a trapped wall and a Region
   linked to a place that holds a trap thing; a thief (Trapbreaking skill and
   thieves' tools) and a fighter with no tools, both members; the Player seat
   owning the fighter. Markers (`flags.world.fixture`, built with
   `api.fixture` when nothing carries one): `formation/trapbreak-scene`,
   `formation/trapbreak-party`, `formation/trapbreak-wall`,
   `formation/trapbreak-place`, `formation/trapbreak-thief`,
   `formation/trapbreak-fighter`, the trap Item `formation/trapbreak-trap`,
   the Region `formation/trapbreak-region`, the thief's
   `formation/trapbreak-thief-skill` and `formation/trapbreak-thief-tools`,
   and the fighter's `formation/trapbreak-fighter-tools`, given for step 11
   and retired at the walk's start; the trap thing is found through its
   place. Each card a press posts is marked `formation/trapbreak-card-<n>`
   and retired by the next run. Walked by `tools/live/formation-trapbreak.mjs`
   on two seats, this step's bullets and step 11 together; it rigs the GM
   page's dice, so each press also spends a turn on the walk's party. It does
   not drive deleting the trap thing, the floor and blank-figure variants of
   *The figures*, Re-arm or the type size, the canvas markers, closing the
   question, or the turn plan clause of step 11. A player's press relays to
   whichever GM client Foundry makes active, so the rigged half of step 11
   runs only while the walk's GM seat is that client, and the walk notes it
   NOT WALKED otherwise; a GM client that has just joined can take a relay
   before its handlers are registered, and that press then writes nothing.
   Drive the window as the capture driver's seats do; read
   what the window shows, then press. Work on it is already disabled on an
   unfound trap, so a redraw to another refusal is told by the refusal's
   text, never by the button.
   - *Judge seat, warned.* Open for the fighter, a trap found. *Observable:* a
     warning chip names the missing tools and ends "As Judge you may proceed.";
     Work on it is enabled; pressing it throws and the card posts. Mark the
     trap disarmed first: the chip becomes a refusal and Work on it is disabled.
     An unfound trap is listed dashed with "not found" and disables Work on it.
   - *Player seat, blocked.* Open as the Player for the fighter. *Observable:*
     the same refusal reads on the window beside a disabled Work on it, with no
     toast needed; the target list holds only found traps and no Judge modifier
     field is drawn. Give the fighter tools through the sheet while the window
     is open: it redraws and Work on it enables with nothing pressed.
   - *Two windows.* Open for the thief, then for the fighter, then the thief
     again. *Observable:* two windows, the second opening of the thief fronts
     the first; each title bar reads "Trapbreaking · <party> · <character>".
     Pick the fighter in the thief's Character select: that window closes and
     the fighter's is fronted.
   - *The redraw.* With a window open, Rebuild it, then Mark spotted, then
     delete the trap thing from the place. *Observable:* the list and the state
     follow each write with no press.
   - *The figures.* Hover Needs, a part, and the Reach. *Observable:* Needs
     names the character's throw, each part and the page it cites, the Judge
     modifier, and the die's floor and its page when the throws table is
     imported; the Reach names its page. Unregister the throws document: the
     floor term is gone. Delete the character's Adventuring figure and skill:
     Needs reads "—" and its tooltip is the page alone; with no reach imported
     the Reach reads "—" with the page.
   - *The footer.* Shrink the window to about 300 px high. *Observable:* the
     body scrolls and Re-arm and Work on it stay in view; Re-arm is enabled
     only on a disarmed trap. Raise the type size: the width follows it.
   - *Throw and question.* Work on it beats the trap; the question reads "The
     trap is beaten" with Leave disarmed and Discharge on the thrower's own
     seat, and closing it leaves the trap disarmed.
9. The party token's size is walked in "The column and its lights" (steps 1
   and 8), which replaces the face-width check this step held.
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
   sheet's Dungeon tab head shows the Trapbreaking button; pressing "Work on
   it" with a made throw (dice rigged) announces "… works on the trap."
   publicly, the card posts at once, and "The trap is beaten" opens on the
   PLAYER's seat, never the Judge's (on the player seat,
   `automationCensus()` from `lib/automation-client.mjs`, imported in page
   context, reads lead and settled). The trap reads
   `disarmed` while the question is open; Discharge writes `discharged` and
   whispers one line; Leave disarmed or closing it writes nothing more. With
   the question open, the Judge presses Rebuild it: a later Discharge leaves
   the rebuilt trap armed. With the question open on a turn plan entry, the
   plan's next entry resolves without waiting.
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
    public and whispers the seat a refusal. Fixtures (`formation-steps`), kept:
    the party `formation/steps-rearguard` with its token
    `formation/steps-rearguard-token`, the members
    `formation/steps-fallen-owned` (Player-owned) and
    `formation/steps-fallen-judge`. At the step's start the party's record is
    brought to a new record's shape (no `travel`, a fresh clock, no table,
    lights, spells or fight; members, name and linkage kept), the owned
    member's hit points are set to 0, and a member already left is gone back
    for. The token the press makes is a create path's product: the step
    retires `formation/steps-left-token` at its start and marks the one read
    back from `deployedTokenId` where Go back does not recall it.
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
    Fixtures, kept: a scene `formation/steps-doors` holding two door walls
    (`door: 1`), `formation/steps-door-1` and `-door-2`; a character
    `formation/steps-basher` with its token `formation/steps-basher-token`
    on the scene; a formation, the party `formation/steps-door-party` with
    its token `formation/steps-door-party-token`, holding that character (a
    drop on the party sheet, the formation's own add-member path, enrols it
    where the kept party lacks it); a second character
    `formation/steps-stranger` (token `formation/steps-stranger-token`) in no
    formation. For the window's own checks, three more, built with
    `api.fixture` when no document carries the marker: a character
    `formation/steps-door-mate` with its token `formation/steps-door-mate-token`
    on the scene, enrolled in `formation/steps-door-party` the way the basher is
    (the party then holds two); a monster actor `formation/steps-door-beast`
    with its token `formation/steps-door-beast-token`; and a token
    `formation/steps-door-ghost-token` built with no `actorId`, which core
    allows. At the step's start both doors are written closed (`ds: 0`)
    with the `door` flag unset, both characters' hit points set to 6, and the
    party's record brought to a new record's shape. The step seeds INVENTED
    door figures, never a page's: the `formation` document registered at world
    priority (`H.m.tables.registerTable`, source `formation-steps`) with
    `doors` rows (one counted in turns with an invented tool word, one counted
    in rounds, one with no time, two sharing a label) and the nine bash figures
    (Strength factor, pair, crowbar, size up and down, spike penalty and limit,
    botch band, rebound), each different from every printed figure, and the
    first character's Adventuring Dungeonbashing figure set to an invented
    target; it unregisters them at the end. Select the door on the Walls layer,
    select the first character's token, and press the **ACKS door actions**
    tool (Scene controls → Walls).
    - *One window per door, following the selection.* After the tool opens the
      window, read `foundry.applications.instances`: the window's id is
      `acks-extras-door-<scene id>-<wall id>`. Select the second door and press
      the tool again without closing the first: two windows stand, each with its
      own id, and pressing the tool on the first door again fronts the first and
      opens no third. Without asking for a draw, select `formation/steps-door-mate-token`: within a second the **Basher** line names that character (no window
      refresh, no reopening), and with nothing selected it reads "nobody
      selected" and **Bash it** is disabled. Select `formation/steps-door-beast-token`, then
      `formation/steps-door-ghost-token`: the window shows the refusal line in
      the Bash section and **Bash it** stays disabled.
    - *Partners.* With the first character's token selected the **Partner**
      select lists `formation/steps-door-mate` and not
      `formation/steps-stranger` (in no party); with that party's token
      moved to another scene the list is empty. A world actor in no party never
      appears. Pick a partner, then select another token: the partner is not
      applied to the new basher.
    - *Pinned footer, short display.* Resize the browser window (or the
      window) to a height of about 400 px at the default type size: the body
      scrolls and **Batter** and **Bash it** stay in view; raise the type size
      setting and open a fresh window: the same.
    - *Hover each part.* Hover the needs figure and each term in the list. The
      needs figure lists the basher's own throw, its terms and their pages; the
      throw's tooltip names the character's own Dungeonbashing throw (RR ch. 3);
      each term shows its count times the seeded figure with a page; the spike
      count reads the most a door holds with RR p. 267; **Batter** names the row
      and RR p. 266. The seed registers no page of its own, so each page is the
      module's reference (RR p. 267 or RR p. 266). The picture frame beside the
      door's fields shows the door glyph when the game-icons-net module is
      active, and no frame when it is not.
    - *Construction.* Read the select with the grid imported: its first option
      is the unset choice, selected, and the **Batter it down** section shows
      its figure as a dash, **Batter** is disabled, and no hint shows. Pick a
      row in the select.
      *Observable:* re-read `wall.flags["acks-extras"].door.kind` from the
      document (not the DOM): it is the row's key, `<ordinal>:<label>`. The
      **Time to batter down** line shows the row's count, unit and tool word as
      imported and **Batter** is live, and the row with no time shows the "no
      battering time" hint and **Batter** disabled. Write an older kind name (`ironBanded`) into the
      flag by hand: the select reads unset and `doorState(wall).kind` is null.
    - *Blanked.* Unregister the `formation` figures. Re-open the window.
      *Observable:* the **Needs a roll of** figure is a dash, **Bash it** is
      disabled and not styled as hopeless, no part list shows, the Construction
      select lists only the unset choice, and the tooltips on the needs figure,
      on the spike count and on the Batter figure are the page reference alone
      (RR p. 267, RR p. 267 and RR p. 266) with no sentence about what is
      missing. Register only the botch band and the rebound: with no Strength
      modifier, no partner, no crowbar and no size step the figure and the
      button return; ticking **Crowbar** blanks them again.
    - *Marks.* Tick **Evil**, then **Jammed**, then untick **Evil**.
      *Observable:* the wall's `door.evil` and `door.jammed` flags read
      `false`/`true` after the last change, and `api.doors.doorState(wall)`
      returns the same; the spikes count is unchanged by each write.
    - *Botch.* Rig the d20 to show a 1 (the dice rig reads from the top; probe
      one roll after rigging) and press **Bash it**.
      *Observable:* the card carries a "Damage to {name}" line with the
      imported rebound and the "reported, not applied" note; the character's
      hit points are unchanged. An ordinary miss carries neither line. The card
      shows the character's own target (the invented figure) and the total as
      the die plus the imported Strength term.
    - *Batter.* On the row counted in turns, read
      `getFormations()[id].clock.turnsTotal`, press **Batter** in the footer with the
      formation's member selected.
      *Observable:* `turnsTotal` rose by exactly the count the line showed,
      a turn card posted, the wall's `ds` reads 1, and
      the notification names the time and the formation. On the row counted in
      rounds the clock rises by those rounds. Repeat with the
      unformed character selected on the second door.
      *Observable:* the door opens, no clock moved, and the notification says
      no formation holds the basher.
    Mark each chat card as it lands, `formation/steps-card-<n>` in the order
    posted; the next run retires them before its first step, counting up from
    1 and stopping after five markers in a row that nothing carries.
    - *One reveal, both seats.* Fixture, kept: a scene wall carrying the marker
      `formation/secret-door`, built with `api.fixture(marker, "Wall", data)` on
      the scene `formation/steps-doors` (a wall is an embedded document, so
      build it as `scene.createEmbeddedDocuments("Wall", [...])` and mark it
      with `api.mark`), with `door: 2`, `ds: 2` and a `door` flag of
      `{evil: true}`. At the step's start write `door: 2` again, so a kept
      wall that an earlier run revealed is a secret door once more. On the GM
      seat call `await game.modules.get("acks-extras").api.formation.doors
      .revealSecretDoor(wall)`; seat a Player on the scene.
      *Observable:* the call returns `{ok: true, revealed: true}`; the
      document reads `door` 1 with `ds` 2 and the `door` flag unchanged; the
      Player seat's Walls layer shows a door control on that wall, which it did
      not before. Call it a second time: it returns `{ok: true, revealed:
      false}` and the document's `_stats.modifiedTime` does not move. The same
      call on the Player seat returns `{ok: false, reason: "notGM"}` and
      writes nothing.
14. **A marcher's survival state bars the forced march; only the Judge
    overrides it.** Fixtures, kept: a scene `formation/steps-march` with an
    `acks-extras.party` actor `formation/steps-march-party` on it (token
    `formation/steps-march-party-token`), and two character actors
    `formation/steps-hungry` and `formation/steps-fed` enrolled through the
    token HUD (see the drive mechanics above). At the step's start the party's
    record is brought to a new record's shape and the members' hit points set.
    The party's drag steps one cell toward the scene's middle column, so a
    kept token never walks off its scene. Put one member on a barring rung by
    writing that actor's own flag through the API, the whole flag REPLACED and
    never merged into what a run left, and clear the other's:
    `await actor.setFlag("acks-extras",
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
    Mark each chat card as it lands, as in step 13. No world document outside
    the walk's markers is touched: the survival flag lives on the kept
    `formation/steps-hungry` and is written again at the step's start.

## A move the GM's client is drawing (added with the stored-position fix)

The clock, the journey and the trap check measure a move to where it put the
party, on the client that animates the token as well (DECISIONS 2026-10-17).
Steps 7–10 and the Region reads after them are walked by
`tools/live/formation-regions.mjs`; steps 1–6 have no walk.

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
   A moment later the trail is written: a second, flag-only write
   (`flags.acks-extras.trail`) that moves nothing and bills nothing, and the
   token's size stays one cell.
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
stored corner"; the zone is core's footprint since 2026-11-16, "A zone holds
the party by core's footprint"). Each wants a move that completes a turn, so they run on a
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
one, and whether `token.regions` holds the zone: core works it out from the
destination before the write, so a hook on the drawing client reads the
destination's Regions. The party token is one cell or less there, so its
footprint is its centre and the geometry below stands. At core's default speed
every read below landed inside the move's ~0.8 s draw, but the delve's throw card can post after it. The walk sets `CONFIG.Token.movement.defaultSpeed = 1` for each move (a five-second draw) and restores it.

7. Add an encounter zone (`acks-extras.encounterZone`, `encounterEvery: 1`,
   `encounterTarget: 2`, so the throw stands whether or not the world has
   imported its cadence) east of the token, view C, and move the token 500 px
   east.
   *Observable:* the turn's throw card says `in zone "<the region's name>"`,
   and when it was created the token was still drawn, with its prepared
   centre outside the zone and its stored centre inside, and `token.regions`
   held the zone. The prepared centre is the one the code before the fix
   asked about.
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
10. On scene C make a disposable token three cells wide (not the party's), at
    the scene's origin, and an encounter zone one cell wide over its last cell
    only, so the token's centre is outside the zone and its last cell inside.
    *Observable:* `token.regions` holds the zone, `zonesUnder(token, type)`
    names it, and `regionsAt` at the token's centre does not. A 20 px sliver
    zone at the token's far edge, which holds no cell's middle, is not held.

The Region reads follow, on scene C with the party token one cell wide and
each zone made for its step and swept at its end:

11. A zone drawn as a core `grid` shape (two cells) under the party token.
    *Observable:* `findZone` finds it.
12. An encounter zone 1000 px square with an 800 px hole, and a second 700 px
    square zone over its corner, the party in the corner both hold. The outer
    states a target of 2, the inner 3.
    *Observable:* `journeyZones` names both, the outer's `area` is its ring's
    360000 square pixels (core's `region.area`, hole out) against the inner's
    490000, and the composed target is the outer's 2. The hole left in would
    rank the inner smaller and give 3.
13. The trap sweep's distance, `placementsNear` with an unbounded reach, to a
    rectangle zone and to a circle zone at a known distance east of the party.
    *Observable:* each `distanceFeet` is the hand figure (the nearest edge
    less the token's half-size, in pixels, times the scene's feet per pixel),
    the circle's within six pixels' worth of feet, since core tessellates it.
14. `poi.mjs` `regionsTouch` of two rectangle Regions that share an edge and
    of two apart.
    *Observable:* true, then false.

Teardown by the run's own ids: `api.sweepTracked()` removes the scenes, the
trap Item and the actors (the party actor dissolves its formation). Track
each chat card id as it lands.

## Mounts and the train

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
   *Observable:* without tables the readout carries the `tablesMissing` part
   (the strip's tooltip leaves it out) and scales by pace alone; with them the speed cell's tooltip carries the
   factors joined on one line with ` · ` (terrain, then a road worth nothing
   in the rain) and the miles reflect
   both the ground and the forced pace; every ancillary slot (as many as
   `ancillarySlots()` gives) reads as consumed and refuses edits. Step back to Dedicated march: the slots return
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
   *Observable:* a card with no encounter lines (the chain has nothing to
   read) — no rolls, no errors.
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

Fixtures, by marker (`flags.world.fixture`): the party `formation/xp-party`
(type `acks-extras.party`) with the characters `formation/xp-member-1` and
`formation/xp-member-2` enrolled, plus two `monster` actors enrolled beside
them: `formation/xp-hired-monster`, hired by member 1 through
`acksExtras.henchmen.hireMonster(monster, employer)` so it carries a henchman
record, and `formation/xp-handmade-monster`, whose `system.retainer` is
written by an update after the create (`enabled: true`, `managerid`,
`category` `henchman`) with no hire behind it. Give each character an owner
seat that is a player's (`ownership: {[playerId]: 3}`): a character no player
owns and nobody hired is an NPC, and takes no share. Seat the members by
dropping each actor's uuid on the party sheet (a `drop` event carrying
`{type: "Actor", uuid}`, as `tools/live/formation-audit.mjs` `seat` does) and
poll `getFormation(fid).members` until it holds them; the formation is found
by `getFormations()` entry whose `actorId` is the party's. The dialog is a
`DialogV2` whose `total` input takes an `input` event before **Deal XP**
(`data-action="ok"`) reads it. A monster opens on the Follower Card by
default, which has no tabs: the Service tab is the ACKS Full Monster sheet's
(construct `CONFIG.Actor.sheetClasses.monster["acks-extras.FullMonsterSheet"].cls`
with `{document}` and render it; the actor's own sheet setting is left alone).

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
   are all created by the run: read them back and `api.track` each. Each
   monster henchman is listed with a share (the imported one, or the record's
   own; step 5 covers a missing one) and the note that it is credited to
   its own record, because the system keeps no experience for a monster. Read
   `flags["acks-extras"].experience` on each: `bySource.deal` equals the
   listed Gains, and its `system.details.xp` (what it is worth defeated) is
   unchanged. Open the monster's sheet, **Service** tab: the **Terms**
   group's **Experience** row reads that figure, and hovering it lists
   "Deal XP" with the same figure and a page. Deal again and the figure is
   the sum; a monster with nothing credited reads 0 and its tooltip says so.
   Open a hireling `character`'s Service tab: no Experience row. The row shows
   no advancement or readiness line, and nothing about the monster's Hit Dice
   changed.
5. Enrol hirelings by hand on the system sheet: a disposable employer
   `character`, plus three `character` actors whose `system.retainer` is
   written by an update after the create (`enabled: true`,
   `managerid: <employer id>`, `category` `mercenary`, `specialist` and
   `henchman`). Link each with `employer.addHenchman(id)`. Read
   `api.formation.xp.shareFor` (or import `formation/xp-shares.mjs`) for each,
   then run `enrollNewcomers(employer)` from `henchmen/engine/events.mjs` and
   read them again.
   *Observable:* both times, the mercenary and the specialist take 0 with the
   reason `mercenary` and the henchman takes the imported xp share
   (`henchmen/rules/wages.mjs > importedShare("xp")`, `from: "imported"`),
   never a full share. A `divideXp` over all four lists the two in `excluded`.
   Three states of the figure, the layers this client's at priority 30 and
   lifted at teardown: with the `wages.xpShare` table imported the henchman
   takes it and the dialog's Share cell tooltip names "the imported share" and
   the page `importedShareCite("xp")` returns; with `wages.xpShare` registered
   empty and the henchman's record holding no `terms.xpShare` (a hire's record
   holds `null`), `shareFor` gives 0 with the reason `notImported`, the dialog
   lists the henchman among those taking no share as "a henchman's share, not
   imported", and the total divides over the others; with an invented
   `terms.xpShare` written on the record the henchman takes it whatever the
   table holds and the Share cell's tooltip says it is set on the record. A
   record whose `terms.xpShare` is `0` takes none, reason `noShare`.
6. Enrol a third `character` with no player owner and no retainer.
   *Observable:* `shareFor` gives it 0 with the reason `npc`, and Deal XP lists
   it among those left out; giving a player seat ownership of it restores a
   full share.

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
   **Observable:** the combatants are those of step 3, and one card,
   whispered to the GMs, names the encounter.
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

## A fight that is over (added with the heal)

Covers `fightingIn`, `reformIfOver` and the refusal's whisper
(`combat-bridge.mjs`), the heal at the head of a move (`journey.mjs`
`dispatchPartyTokenMoved`), the heal at the head of Form Up
(`marching-templates.mjs` `formUp`), and a deploy laid at the party token's
stored corner (`deployMembers`). The Gamemaster seat is the primary GM, viewing
the scene.

**Fixtures**, each `api.create()`d or `api.track()`ed:
- A delve scene on a feet grid, viewed by the seat.
- Two `character` actors as members, and a `monster` with a token on the
  scene as the enemy.
- A party actor holding the two, its token on the scene.

**Drive mechanics.**
- Deploy: `TokenDocument.createCombatants([partyToken])`, the HUD's own call,
  creates a combat when none is active. Read the combat back as the one
  holding a member's actor, and `api.track()` it.
- The HUD's toggle on a fighter:
  `TokenDocument.deleteCombatants(memberTokens, {combat})`. It removes the
  combatants and keeps the encounter.
- A combat deleted where no automation window hears it: replace
  `Hooks.callAll` with a wrapper that drops the first `deleteCombat`, delete
  the combat, and restore `Hooks.callAll` in a `finally`.
- A move: `partyToken.update({x}, {animate: false})`; the hidden pane does
  not animate, and core's own move would never land. Keep the move inside the
  scene's bounds: core drops an update past the edge with no error, and no
  move hook fires.
- Each step posts cards: read the run's new messages by id and `api.track()`
  them.

1. **Every fighter toggled out.** Deploy with the enemy in the combat, toggle
   both fighters out, then move the party token one exploration move.
   **Observable:** the record's `combat` is null, the members hold `tokenData`
   and no `deployedTokenId` or `deployedCombatId`, and no member token stands.
   The party token is visible at the move's end (`_source`). A re-formed card
   posted, one move's turns are billed, and `clock.lastPosition` is the
   move's end. The combat still stands with the enemy.
2. **The party added again to that encounter.** Deploy into a new combat,
   advance it to round 3, toggle both fighters out, and add the party token to
   the same combat.
   **Observable:** a re-formed card, then a deploy card. The record's `combat`
   names that combat with `roundsCounted` 3. The combat holds one combatant
   per member and none for the party token. The next round advances the clock
   by one round.
3. **One fighter still in.** Toggle one fighter out and move the party token.
   **Observable:** no re-form and nothing billed. Then add the party token to
   the combat: its combatant goes, and one card whispered to the GMs names
   the encounter. From the Player seat no card shows.
4. **A combat deleted unheard.** Deploy, then delete the combat with
   `deleteCombat` dropped.
   **Observable:** the record's `combat` still names it and
   `game.combats.has(id)` is false. A move then re-forms the party as in step
   1. Repeat with a deploy into a new combat in place of the move: the party
   re-forms, then deploys into the new combat.
5. **Form Up.** Save a marching order on the party sheet first. Deploy, toggle
   one fighter out, and press the party token HUD's Form Up.
   **Observable:** a "cannot form up during a combat" warning, and nothing
   gathered. Toggle the other fighter out and press it again: a re-formed
   card, the record's `combat` null, no member token on the map, and the
   members in the saved order.
6. **Regression.** "A combat's takeover", steps 1 to 7.

Never Begin a combat whose tracker holds the party's own combatant: when no
member deploys, that combatant stays, and the system's surprise throw fails
on it (T-0335).

**Teardown.** `api.sweepTracked()`. The combats a step deleted, and the
tokens the reform and the recall deleted, sweep as missing.

## Saved marching orders, from a macro (added with the macro calls)

Covers `marchingOrders` in `marching-templates.mjs` (`publicApi`), reached as
`acksExtras.formation.marchingOrders`. The Gamemaster seat is the primary GM.
The Player seat is a provisioned player of the same world.

**Fixtures**, each `api.create()`d or `api.track()`ed, and each carrying its
marker (`flags.world.fixture`):
- `formation/marching-orders-party`: an `acks-extras.party` actor holding two
  `character` actors as members, with its formation auto-created (the party
  actor's creation is the one in "A party actor made from the sidebar").

**Drive mechanics.** Each step is evaluated in the GM seat's page and reads the
formation with `acksExtras.formation.getFormationForActor(actor)`. The order
name is per run, so a second run never meets the first run's order: name it
`formation-macro-<run>`.

1. **Listing.** `acksExtras.formation.marchingOrders.list()`.
   **Observable:** an array sorted by name; it holds no order under this run's name.
2. **Saving.** `acksExtras.formation.marchingOrders.save(formation, name)`.
   **Observable:** `{template, replaced: false}` with `template.id` set, and
   `list()` now holds the order.
3. **Reading back.** `acksExtras.formation.marchingOrders.get(id)` with the id
   from step 2.
   **Observable:** the same order, and `acksExtras.formation.marchingOrders.list()`
   now holds it.
4. **Applying.** `acksExtras.formation.marchingOrders.apply(formation, id)`.
   **Observable:** a reconcile report, and the members stand as the saved order
   records them.
5. **Reversed pair.** `acksExtras.formation.marchingOrders.save(name, formation)`.
   **Observable:** a throw with the message
   `acks-extras | marchingOrders.save: arguments are reversed — the formation comes first`.
   Nothing is written: `list()` is unchanged.
6. **Deleting.** `acksExtras.formation.marchingOrders.delete(id)`, then the same
   call again.
   **Observable:** the first call removes the order (`get(id)` is null, `list()`
   lacks it); the second returns false.
7. **Player seat, save.** From the Player seat,
   `acksExtras.formation.marchingOrders.save(formation, name)` on a formation the
   player owns.
   **Observable:** to observe at P8. Record whatever the call does (a refusal, a
   throw, or a write). The world setting is a Gamemaster write, so a write here
   would be a finding; the result is not stated in advance.

**Teardown.** Step 6 deletes the order by the id step 2 returned. A run that
stops before step 6 leaves its order in the world setting under its run name;
the next run finds it through `list()` by that name and deletes it by its id.

## Saved marching orders, from the picker

Covers the picker (`marching-templates.mjs` `pickMarchingOrder`) and what each
of its answers does (`carryOutPick`), from both of its openers: the party
token's HUD button (`module.mjs` `formUpFromHud`) and the party sheet's
**Load order** pill (`formation-actions.mjs` `loadMarchingOrder`).
`tools/live/formation-marching-picker.mjs` walks it
(`node tools/live/run.mjs formation-marching-picker`), on the GM seat alone.

**Fixtures**, each found by its marker (`flags.world.fixture`) or built
carrying it, and kept:
- `formation/picker-scene`: a Scene.
- `formation/picker-party`: an `acks-extras.party` actor, its formation
  auto-created.
- `formation/picker-van`, `formation/picker-rear`: two `character` actors. The
  walk's start shape enrolls each that is not a member with
  `addMember(formation, actor, token)` from a token it places on the scene,
  which also puts the party token there, clears the record's `combat`, and
  views the scene.

**Drive mechanics.**
- The saved orders are one world setting shared by every session, and the
  picker's select opens on the first name in the alphabet. Save the run's
  orders under per-run names (`picker-<run>-<kept|held|spare|extra>`), set the
  select to the id a save returned, and press nothing where the select did not
  take it. An order of another run is never deleted.
- The HUD skips the picker when exactly one order is saved, so two of the
  run's orders stand through steps 1 to 5.
- The picker is a `DialogV2`: find its `select[name="id"]` under
  `.acks-extras-scroll`, and its buttons as `button[data-action="apply"]` and
  `button[data-action="delete"]` inside the same window. Dismiss it through its
  instance in `foundry.applications.instances`, with `close({animate: false})`.
- Before each step the walk reverses the members when they stand in the saved
  order, so a form-up shows in who stands where and its absence does too.
- Notices are read from a wrapper on `ui.notifications.info` and matched on
  the run's order name.

1. **HUD, Delete.** Bind the party token's HUD, press
   `#token-hud .acks-formation-hud`, set the select to the run's spare order
   and press Delete.
   **Observable:** the picker lists every saved order; afterwards the spare
   order is gone, every other order stands, the members stand as they stood,
   and one notice names the deleted order.
2. **HUD, Form up.** The same, with the kept order and Form up.
   **Observable:** the members stand in the saved order, the order is kept,
   one notice.
3. **HUD, dismissed.** Open the picker and close it.
   **Observable:** nobody moved, the order is kept, no notice.
4. **Sheet, Delete.** Save one more order, open the party sheet's Order tab,
   press `[data-action="loadMarchingOrder"]`, pick that order, press Delete.
   **Observable:** as step 1.
5. **Sheet, Form up.** The same pill, the kept order, Form up.
   **Observable:** as step 2.
6. **One saved order.** Only where the world holds no order of another run:
   forget the run's second order by its id, then press the HUD button.
   **Observable:** no picker opens and the members stand in the saved order.
   Where another run's order stands the walk prints "not walked" and the step
   is reported so.

**Teardown.** The run's orders are forgotten by the ids their saves returned.
The fixtures are kept.

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
   `lost.level` is A's viewed level, and the snapshot's entry for the player hashes equal to the player's server
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
lost" — offline callers wrap correctly, so only the live run shows it.

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
   *Observable:* `day.kind` is `forced`, every ancillary slot reads
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
   the panel shows no rate — never a distance of zero.
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
   a select bound to one silently never writes, and only the live check shows it.
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
   watched. `getFormations()` returns an OBJECT keyed by id, not an array; a
   sweep that iterates it directly fails silently.

9b. **A stay draws what found it, day by day, and leaves no marker.** Rides
   the city scene, a city list named in Scene Configuration (the `1d10` list
   with rows `1`–`13` and `3` after dark from "The city's own list"), and
   the stay of step 9. Register an invented `cityTravel` document at priority
   30 whose `encounters.holedUp.any` is `{everyTurns: 1, throw: 1}` and whose
   `encounterAfterDark` is `3`. **No die needs rigging**: a `1d6` meets a
   target of 1 every day, and a target of 7 on the same row meets none. Arm
   the marker setting (`transientIncidentTurns`) to a nonzero value so that a
   marker the stay should not leave would be left. The walk
   (`formation-steps`) keeps the scene `formation/steps-city`, the party
   `formation/steps-city-party` with its token
   `formation/steps-city-party-token`, and the list
   `formation/steps-city-list`, and at the step's start brings the party's
   record to a new record's shape (no `travel`, a fresh clock, no table,
   lights, spells or fight; members, name and linkage kept) before it enters
   settlement mode, so `days` starts at 0.
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
   priced. Advance a day: no "Day" row and no line for the missing cadence. The
   stay card is the client's that credited it, so read the cards by author and
   by the `acks-extras-settlement-card` class, never by time alone, and mark
   none while another formation is holed up. Restore the target of
   1, clear the city list from Scene Configuration and advance two days: on a
   world holding no imported incident list each "Day" row says "No incident
   table yet" in the turn's words and no incident is claimed; on one that
   holds it, the rows read from the world's own list instead, and the
   missing-list line is left to the offline suite.
   *Teardown:* unregister the layer, clear the scene's incident record,
   restore `transientIncidentTurns`, and leave the party in delve: a party
   holed up in settlement mode is credited a stay on every clock advance any
   walk makes. The advances moved the shared clock, as step 9's do.
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
    The network does not survive that shape, so a fixture builds it on purpose.
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
    no wilderness or delve in between, which is the hop a carried board
    would survive.
    *Observable:* the panel opens on 0 blocks over 0 turns, `Hunted here` is
    clear, and a party that left while holed up is not charged the journey as a
    stay on the next clock advance. Then walk back to the first city and
    confirm it too resets rather than restoring what it held. **Also walk the
    unstamped shape**: `patchSettlement` a board with tallies and no `sceneId`,
    then arrive in a city — a board that was never stamped must reset on
    arrival, not be adopted by the city it arrives in.

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
- A Judge's creator stamp no longer reaches a place: `depositReach` asks the
  character's owners and skips a Judge
  ([../location/TESTING.md](../location/TESTING.md), Core drive mechanics).
  Give the member actor to the Player seat and join as that player for step 25.
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
    will throw at, and names the layer. **The panel must show a zone
    override** — a panel calling the street's reader directly never does — so
    a panel still reading the bare street here is a regression, not a cosmetic
    gap.
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
    three, and the row is the one that regresses: an external modifier that
    moves the total and the card with **nothing on screen to explain it** is
    the failure, and the henchmen feature's slander penalty arrives that way.
    Verify the henchmen route still works at the same time — two sources must
    add, not replace.
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
    *Observable:* identical to steps 3–14 with the districts present, minus their
    figures. An unmarked city is one where the question has not been asked.

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
30a. **A dragged marker is filed under the quarter it stands in.** Drop a
    marker in a quarter that has a place, then, on the Notes scene control
    layer, drag its Note into another quarter that has its own place. Press
    **Make it a place** on its card.
    *Observable:* the new place's parent is the second quarter's place, not
    the quarter the marker was dropped in, and its token stands where the Note
    was left. Repeat with the Note dragged off every quarter: the parent is
    the scene's place, not the quarter it was dropped in. Drag the new place's token into a third
    quarter afterwards: the parent does not change (the filing is read once).
    `tools/live/formation-regions.mjs` step 15 walks this through
    `note.update` and `promoteIncident`, with the hop priced from a party
    token three cells wide; the card button and the Notes-layer drag are not
    driven there.
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
- A board with no `hour` is written with `patchFormation` from
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

**Fixtures**: one character Actor, kept as `formation/day-swimmer`. No scene,
no token, no canvas — every call is API-level.

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
3. `waterPenaltySteps()` returns `null`, not an empty list. `Object.keys(s.WATER)`
   is `["cold", "rough", "fast"]`; calm is no key, since nothing ticked is no
   penalty.
4. `swimmingThrow({encumbrance: 0, proficient: false, penalty: 8, conditions: ["rough"]})`
   returns `target: 8`, `needed: true`, `unknown: []`, `conditions: ["rough"]`:
   the penalty is the Judge's figure and needs no import. The same call with
   no `penalty` returns `target: 0`, `needed: true`, `unknown: []`: nothing is
   missing, and a zero target skips
   the throw only for a holder of the Swimming proficiency. With
   `proficient: true` the target reads the unimported bonus, so the call
   returns `target: null` and `unknown: ["swimmingBonus"]`; the holder's skip
   is proved at step 6.
5. `drowning({actor})` returns `rounds`, `feetPerRound` and `depthAtDeath` all
   `null`.
6. Now register a document and re-run. Use figures that are obviously **not**
   from a book — the point is to prove the wiring, and a real value in a test
   script is a leak:

   ```js
   const t = acksExtras.lib.tables;
   t.registerTable({ id: "formation", tables: {
     swimmingBonus: 77, swimSpeedShare: 0.42, sinkFeetPerStone: 88,
     breathRounds: 99, swimWaterPenaltySteps: [66, 55],
   }}, { priority: t.PRIORITY.OVERRIDE, source: "live-check" });
   ```

   Each accessor now returns its fabricated figure, `waterPenaltySteps()`
   returns `[66, 55]` in that order, and
   `swimmingThrow({encumbrance: 0, proficient: false, penalty: s.waterPenaltySteps()[1], conditions: ["rough"]})`
   returns `unknown: []` with a `parts` entry
   `{key: "water", value: -55, conditions: ["rough"]}` and the target built from
   it. A `parts` array that still lacks the water row means the throw is
   dropping the Judge's figure.
   `swimmingThrow({encumbrance: 0, proficient: true})` returns a
   target at or under zero and `needed: false`: the holder skips the throw. The
   same call with `proficient: false` returns `target: 0` and `needed: true`.
7. **Exercise the removal**, not only the registration:
   `t.unregisterTable("formation", { priority: t.PRIORITY.OVERRIDE })`, then
   re-read one accessor. It returns `null` again and `hasDoc("formation")` is
   `false`. A value that survives here is a cache with no invalidation story.
   The priority goes in the option bag: a bare number is read as no priority
   and drops every layer of the document.

**Teardown**: unregister the document if step 7 did not.
Leaving a fabricated `formation` document registered poisons every later check
in the same world session. Then
`acksExtras.lib.services.get("ruledata-import").reload()` mirrors the world's
store back into this client, which restores an import step 1 took off.

## The march in miles (added with movement-driven travel)

Fixtures, each kept and found again by its marker or built carrying one: a
hex scene whose cell is a mile-scale hex (`grid.type` hexagonal,
`grid.distance` a whole number of miles, `grid.units` "mi"), a square scene
at the same scale, a gridless scene in miles, a hex scene of a wider cell
(four times the first), a feet-scale scene holding one district Region, a
party actor with two members (each with an exploration speed, which a bare
character actor also gets from the system's defaults) and its token on the
first scene, an invented `travel` document registered at priority 30 carrying
`encounterFrequency.traveling.<territory>.mileHex` equal to the first scene's
cell (`cadenceMilesFor` reads that document) and an invented `expedition`
table beside it (a positive `feetPerMilePerDay`, the three `…Hours` and a
`wildernessFactor`; with none the journey prices no hours, see "The
expedition figures, imported"), and the formation's territory
set to that key in the Judge's hand (`applyTravelForm(id, {override:
{territory}})`), since an unpainted hex scene answers none. Record `game.time.worldTime` before the walk and report the
delta at the end. The dawn and dusk hours default to nothing and the per-hex
throw setting may be off in the world: read all three, set them for the walk
(a dawn, a dusk, the throw on) and restore them at teardown, and say so in
the report.

The walk's changed steps (`formation-day`, with "The journey") keep the feet
and hex scenes `formation/day-journey-feet` and `formation/day-journey-hex`,
the party `formation/day-journey-party` and its members
`formation/day-journey-ranger` (Player-owned) and
`formation/day-journey-smith`. At the section's start an open lost episode is
ended (`lostEpisode.endEpisode`) and the record brought to a new record's
shape; the move's product on the hex scene, the token
`formation/day-journey-hex-token`, and the true-position marker Chosen places,
`formation/day-journey-shadow`, are retired, and each is marked again once
made. The party's token on the feet scene, `formation/day-journey-feet-token`,
is consumed by the move and placed again every run.

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
   table and cross again → one throw and the strip's next-throw cell blank.
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
14. Create a further hex scene at core's default scale (feet), place a second
    party's token on it, then set its grid to the first scene's mile cell
    (`scene.update({"grid.distance": …, "grid.units": "mi"})`).
    *Observable:* the party's `travel.mode` turns from `delve` to `journey`
    with the scale notice, and one hex drag bills miles and posts an encounter
    card and the day's navigation card. Set the grid back to feet → no switch;
    pick Delve in the band, then change only `grid.size` → still `delve`.

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


## The expedition figures, imported (added with T-0175)

The feet-per-mile ratio, each travel day's hours and the wilderness factor are
the `travel` document's `expedition` table, read from the Judge's own Revised
Rulebook (RR 272). No figure from the page enters the walk or its report:
every observable compares a surface with `e = t.getDoc("travel").tables.expedition`
(`t = acksExtras.lib.tables`), or with a quantity derived from it.

Fixtures, kept and found again by marker: the party
`formation/day-journey-party` with its members and scenes (*The march in
miles*), and the vehicle `formation/expedition-wagon` (a land vehicle actor
with a pulled draft, marked once made, on the Vehicle sheet's Travel tab).
Step 4's invented layer is a product of the walk, `acks-extras` registry layer
30, put back at the step's end by `t.unregisterTable("travel", {priority: 30})`.

1. **Not imported.** With the travel layers holding no `expedition`
   (`t.getDoc("travel")?.tables?.expedition` undefined; note the layers that
   hold the document's other keys), open the party sheet's journey strip.
   *Observable:* the speed reads a dash (never
   0, never a number), the budget line is absent, and dragging the token across
   hexes tallies the miles and advances `game.time.worldTime` by nothing.
   The Vehicle sheet's Travel tab leaves the miles-per-day
   cell blank. A camp **Search** rolls no die and posts no card.
2. **The import, by the Judge's gesture.**
   `acksExtras.importer.cookbookReimportEntries()`, tick
   `input[value="Tables|travel"]`, **Reimport**, answer the confirmation
   (`button[data-action="yes"]`). *Observable:* the console logs `travel
   tables assembled` naming `expedition`; `e` carries all five keys
   (`EXPEDITION_KEYS`), each a positive number; `t.citeOf("travel",
   "expedition")` answers `RR p.272`; the Ruledata Browser lists the raw
   `expeditionRows` and `expeditionProse` beside it. Scripted:
   `tools/live/formation-day.mjs` and `tools/live/formation-steps.mjs` open the
   staged Revised Rulebook and Judges Journal for the session and run
   `acksExtras.importer.cookbookImportTables(["travel"])` where the world holds
   no `expedition`, and each check that `e` arrived (all five keys positive, a
   page cited), since the walks' ancillary-slot, forced-march, search-hour,
   dusk-offer and Call-it-a-day checks read it.
3. **The surfaces price.** *Observable:* the strip's speed is a number and its
   sub-line the miles a day; the ratio `milesPerDay / milesPerHour` on the
   readout equals the dedicated hours `e.dedicatedHours`; a forced day kind
   raises `milesPerDay` by `e.forcedHours / e.dedicatedHours` and leaves
   `milesPerHour` alone; the budget line shows the pace's hours. The speed's
   tooltip (hover the strip's first `.stat`, the speed) lists the ratio, the pace's
   hours and `RR p.272`. The wagon's Travel tab cell shows the same miles a day
   as the strip for the same speed, with the same tooltip. A camp Search now
   rolls, its target the bracket for the march's miles a day.
4. **A Judge's override wins, then reverts.** Register an invented
   `expedition` table at layer 30 (any positive figures differing from `e`)
   with `t.registerTable({id: "travel", tables: {expedition: {...}}},
   {priority: 30, source: "live-check"})`. *Observable:* the strip reads the
   invented figures at once, the tooltip carries no page (override), and
   unregistering the layer returns the imported figures.
5. **Teardown.** Unregister the layer; the import stays (it is the world's own
   data). The report says which of steps 1 and 2 ran, since a world that
   already holds the table starts at step 3.

## The ancillary slots, imported (added with T-0515)

The day board's slot count is `acksExtras.formation.travel.ancillarySlots()`:
the `expedition` table's `ancillaryHours` (RR p. 272) cut into one-hour slots.
Every observable compares with `n = acksExtras.formation.travel.ancillarySlots()`
read on the same seat, never with a number from the page.

Fixtures: the party `formation/day-journey-party` (above), in journey mode on
the GM seat. The overrides are the walk's own, set and cleared in the Ruledata
Browser (`Settings tab → Game Settings → ACKS II — Extras → Open Ruledata
Browser`, `travel` document, `expedition` table).

1. **Imported.** With the import in place, open the party sheet's Wilderness
   tab → The day. Pick Dedicated march, then **End day** so the board is fresh.
   *Observable:* `n` is a positive whole number; the board draws exactly `n`
   slot selects (`select[name^="travel.day.slot."]`) and
   `travel.day.activities.length` is `n`; hovering a select shows the slot hint
   then `Imported (<cite>)`, `<cite>` being what `t.citeOf("travel",
   "expedition")` returns. Forced march fills all `n` with travel and disables
   them.
2. **Not imported.** In the Ruledata Browser, override `expedition` with
   `ancillaryHours` blanked, and re-render the sheet.
   *Observable:* `n` is null; the board draws no slot select though the stored
   day still holds its slots, and shows a blank marker whose tooltip is the
   slot hint alone; `acksExtras.formation.travel.freshDay().activities`
   is empty. Scripted: `tools/live/formation-day.mjs` step 2 (no tables)
   unregisters the whole `travel` document on the player seat's registry and
   asserts the same, plus that no pace prices a mile there: every expedition
   figure is null, the forced and dedicated paces' miles are null, the forced
   ratio is null, the dedicated one is one, and the strip states no miles.
3. **An override wins, and reverts.** Set the override's `ancillaryHours` to a
   figure of the Judge's own, other than the imported one, then **End day**.
   *Observable:* `n` follows the override, the fresh board draws that many
   slots, and the slot tooltip says `Set by a Judge's override`. Clear the
   override and **End day** again: the board returns to the imported count
   with the cite in the tooltip.
4. **Teardown.** Clear the override; the fixture stays.

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
14. **The cadence is read, never assumed.** Register the invented `searching`
    layer without `turnsPerThrow`. *Observable:* the camp's search line shows
    a blank hint, and **Search an hour** on foot posts no card
    and rolls no die. Put `turnsPerThrow` back
    with a figure of the walk's own, other than the page's, and search again:
    the card rolls six turns' worth of throws at that cadence, rounded, never
    fewer than one. With the layer gone, the Ruledata Browser shows the
    imported cadence citing RR p. 274.
15. **A Found button after the party has moved.** Stock a hex with two
    unfound points, search an hour there (rigged hit) so the card lists both,
    then move the party to a hex with no stock and press one point's Found.
    *Observable:* the searched hex's record holds that point found by this
    formation, the other hex has no record, and the button is disabled. Then
    delete the point (Wilderness tab → Points of interest) and press the
    other's Found: nothing is written and the button stays live. A card posted
    before the upgrade (no `data-scene-id` on its buttons) still marks the
    hex the party stands in.

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
every zone throw hits. The throw's die is the delve's imported one: register
a `delveEncounters` document (`registerTable({ id: "delveEncounters", cites: {
die: "<page>" }, tables: { die: "1d8" } }, { priority: PRIORITY.WORLD })`,
an invented die) before step 1 and unregister it at teardown. A Region and its behaviour are one
`scene.createEmbeddedDocuments("Region", [{ name, shapes: [{ type:
"rectangle", x, y, width, height }], behaviors: [{ type:
"acks-extras.encounterZone", system }] }])`; track the region by the uuid it
returns. Read every card's message id back the moment its throw resolves and
`api.track` it.

1. **The zone line and the local throw.** Drag the party into the small zone.
   *Observable:* each card opens with *Encounter zone:* naming both regions,
   shows *Zone throw <die> — N → 1+* where the column rolls would be, with
   the registered die and N within its faces, and no column rolls. Hovering
   the die names the page it was registered with; hovering the target names
   the small zone.
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
8. **No die imported** (unwalked). Unregister the `delveEncounters` document
   (and any override of its `die`), press **Encounter throw** with the party
   in the small zone.
   *Observable:* the one card posts with *Encounter zone:* and the zone-throw
   line, its die and roll blank and its target shown, hovering the blank die
   gives the page reference alone, and nothing sits below the line: no
   rarity, creature, drawn rows or distance. The message's
   `flags["acks-extras"].encounter.outcome` is null.
9. **An override** (unwalked). Set a `die` override in the Ruledata Browser
   (`Settings tab → Game Settings → ACKS II — Extras → Imported Rules Tables →
   Open Ruledata Browser`) and press **Encounter throw**.
   *Observable:* the card's die is the override's, its tooltip says a Judge
   set it, and a face above a d6's turns up over enough throws.

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
   the disease line. A sky with conditions but nothing imported shows an empty
   list, and nothing else changes.
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
record write first, because every change submits the whole form and a stale
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

Fixtures, kept and found again by marker: a party actor
`formation/day-delve-party` (its formation comes with it) and four character
actors seated as members (*Core drive mechanics*, above),
`formation/day-delve-wayfinder`, `-delve-scout`, `-delve-porter` and
`-delve-fallen`. Wayfinder carries an `ability` item named Navigation; Scout
carries nothing yet; Porter holds the Carrier role
(`[data-action="toggleRole"][data-role="carrier"]` on its row of the Order
tab); Fallen stands at 0 hit points and carries nothing. At the section's
start the party's record is brought to a new record's shape (no `travel`, a
fresh clock, no table, lights or spells; the members stay), a drop enrols any
member the kept party lacks, and Porter's Carrier chip is pressed off first
when the kept Porter already holds it. Scout's Pathfinding is step 6's
create-path product, `formation/day-scout-pathfinding`: retired at the step's
start and marked once made. The Revised Rulebook is connected on the GM seat,
which runs every step.
`f = () => acksExtras.formation.getFormations()[formationId]`.

1. **The world before the import.** *Observable:* `t.getLayer("formation",
   20)` is null and the travel layer holds no `navigationBonus` (note the keys
   it does hold). `acksExtras.location.openRuledataBrowser()` lists the eight
   `formation` rows (`tr[data-entry-key="formation.restInterval"]` and its
   siblings) with the `absent` class and the *not supplied* badge. The party
   sheet's Rest stat ends in a bare slash; Porter's carrier line gives the same
   encumbrance on both sides of its arrow;
   `acksExtras.formation.swimming.swimmingThrow({encumbrance: 5, proficient:
   true, penalty: 3, conditions: ["cold"]}).unknown` names `swimmingBonus` alone
   and `waterPenaltySteps()` is `null`; `acksExtras.formation.travel.navigationCompetence(f())`
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
   `swimWaterPenaltySteps` a non-empty list of positive sizes in printed order; `navigationBonus`
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
   *Observable:* `s.swimmingThrow({encumbrance: 5, proficient: true, penalty:
   w.swimWaterPenaltySteps[0], conditions: ["cold"]})` has an empty `unknown`,
   a `water` part, `conditions: ["cold"]` and the target
   `5 - w.swimmingBonus + w.swimWaterPenaltySteps[0]`; a `penalty` one above the
   largest step with `conditions: ["rough", "fast"]` prices the same way.
   `s.swimSpeed(120)` is `120 * w.swimSpeedShare`.
   `s.drowning({conMod: 1, encumbrance: 3})` gives `rounds`
   `w.breathRounds + 1`, `feetPerRound` `3 * w.sinkFeetPerStone`, and
   `depthAtDeath` their product. `s.rescueStone(4)` is
   `w.carriedBodyStone + 4 * w.carriedGearShare`.
5. **A carried casualty weighs on its carrier.** The party sheet re-renders on
   a formation write and never on the store's, so read it after step 3's
   advances or re-render it. *Observable:* Porter's carrier line gives
   Porter's own encumbrance left of the arrow and that plus
   `w.carriedBodyStone`, to a tenth, on the right. Fallen carries nothing, so
   the body is the whole of the share. Then open the sheet on the Player seat
   with Porter not owned by it: the line's capacity and pace read a dash, and
   it never reads "CANNOT MOVE", since core derived no maximum on that seat
   and the module states none of its own. On Porter's owner's seat and on the
   Judge's, the capacity is core's figure.
6. **The navigation bonus is priced.** Journey the formation on `forest`, road
   `none` (*End day, the whole tick*, step 1). *Observable:*
   `navigationCompetence(f())` answers `navigation: true, bonus: nav.either,
   unpriced: false`. Give Scout an `ability` item named Pathfinding
   (`createEmbeddedDocuments`). *Observable:* `pathfinding: true` and
   `bonus: nav.both`. Post the throw (drive mechanics). *Observable:* the
   whispered `.acks-extras-nav-card` carries the `nav.both` line and no
   missing-import line (the card has no unpriced-bonus line), and
   `travel.navigation.history` gained the row.

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

Teardown: the party is left in delve, and its cards stand marked for the next
run to retire. The import's product is no fixture: the
`formation` and `travel` layers in the world's store, and the pages
materialized from them, are what the Judge's own import leaves, and no sweep
undoes a re-read. On a shared world step 2 is therefore the owner's call, as
the importer's *Rules tables from Reimport One Shelf* recipe says.

## The day change (added with the calendar key)

Fixtures: two party actors, kept as `formation/day-sky-a` and
`formation/day-sky-b`, each with a formation put in journey mode and the
generator on (*Roll each new day*) at the section's start, one invented
climate for both; the Player-owned member `formation/day-sky-walker` and the
finding probe's `formation/day-sky-porter`, taken off A at the start so that
every member of A is the player seat's until the probe enrols it again; the `weather` document imported from the Judge's own pages, or an
invented one registered at priority 20 (`climateModifiers` for the climate in
two seasons, the four band tables and `accumulation`) and unregistered after.
A third formation left in delve mode, `formation/day-sky-c`, is the control;
each of the three is brought to a new record's shape first. Note each formation's
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
8. Post an encounter throw on a hex scene with a terrain picked, until one
   meets a creature: only a creature throw rolls the distance the sight lines
   are read from, and a terrain find prints neither. *Observable:* the card's
   two sight lines (who saw whom) and, on the created message,
   `flags["acks-extras"].encounter` carrying the card's facts; track every
   message by id the moment its call resolves.

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

Teardown: the three are left in delve with the generator off, since a
journeying record with the generator on is settled, and its sky rolled into
the shared cache, on every day change any walk makes; a delve record is only
stamped (`settledDay`). Unregister the invented `weather` document. The cache
keys the run created age out of the window on their own; the world clock is
not set back.

## The frame (added with the redesign's phase 1)

Fixtures, kept and found again by marker: a mile-scale hex scene
`formation/day-frame-scene`, created with `active: false` and viewed; an
`acks-extras.party` actor `formation/day-frame-party` with its token
`formation/day-frame-party-token` placed there and adopted when none stands;
two character actors, `formation/day-frame-ranger` (owned by the provisioned
Player user, so that seat holds a member) and `formation/day-frame-smith`,
enrolled through the token HUD when the kept party lacks them (the HUD's input
tokens are tracked, and the HUD removes them); a RollTable
`formation/day-frame-table` for Tweaks to pick. At the section's start the
record is brought to a new record's shape, so Tweaks' `tableId` lands from
null, and the party actor's `system.description` is emptied; step 1's rename
types the name the kept party does not carry. Read each seat's
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
   | Movement | `movementTile` (five, one per mode); by state `movementFastest`, `movementUndo`; while flying `travel.movement.hoursAloft`, `travel.movement.dayHours`, `travel.movement.load` |
   | Sky | `travel.weather.season`, `.auto`, `.fronts`, `.temperature`, `.precipitation`, `.wind`, `.footingMud`, `.footingSnow`; `travelWeatherRoll`; on the climate card, `clearOverride` while climate is overridden |
   | Day | `travel.day.kind`, `travel.day.slot.<n>` (one per slot), `travel.hour`, `travel.day.traps`, `travel.day.noSleep` |
   | Camp | `travel.exposure.hours`, `.atHeatSource`, `.wet`; `travel.camp.steal`, `.water`, `.sleepInArmour` |
   | Judge tab, The episode | `lostBegin` (by state `lostDiscover`, `lostReanchor`, `lostEnd`), `travel.lostNote` |
   | Judge tab, The Judge's hand | `travel.override.ground`, `.encounterTerrain`, `.territory`, `.climate`, `.road`, `.following`; `clearOverride` beside each one set |
   | Order head | `autoArrange`, `frontage`, `saveMarchingOrder`, `loadMarchingOrder`, `addBlank`, `openSkillAudit`, `disband` |

   In the delve, the Dungeon head holds `advanceTurn`, `advanceRound`,
   `restTurn`, `undoTurn`, `togglePace` and `openTrapbreak` (step 12). On a district scene, the City
   head holds `travel.settlement.wanted` (and `settlementTravelTo` while a
   point of interest is in reach) and the four turn pills, and The city holds
   `travel.settlement.pace`, `.where`, `.route`, `.hour`, `.intent` and
   `.conveyance`.
   *Observable:* each is found exactly once (a point's own controls once per
   point, a tile once per mode), where the table says. Change one field per
   section and re-read the record: `travel.override.territory`,
   `travel.camp.present`, `travel.weather.temperature`, `travel.hour`, `travel.camp.steal`,
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
   tab keeps its scroll across a field change (shorten the window first,
   `sheet.setPosition({height: 520})`: at a tall viewport the frame grows to
   fit its content and no part scrolls; then scroll the Wilderness tab down,
   change a select, read `scrollTop` and the first block in view's offset
   again: both within 2 px). Walk it on the party step 3 filled: a party
   whose text above the view does not re-wrap when the panel narrows holds
   its scroll whether the band takes layout in the content box or not
   (DECISIONS 2026-10-17, "A band in the content box takes no layout"). In that short window the window
   content's `clientHeight` stays under the frame's and only the part's
   `scrollHeight` exceeds its box: content taller than the frame is cut off
   with no scrollbar to say so. The re-render re-fits the height to auto
   (core does that to every auto-height window on every render), so the
   scroll is kept only while the part still overflows at the re-fitted
   height; close the Key legend first, or its rows crowd the part to a few
   pixels and the content's backstop scroll takes over. Any render after
   `setPosition` puts the window back to auto, a peer seat's write included, so
   the walk lets renders settle before shrinking, checks the frame at 520 and
   reads the part fresh, never from an element captured before a render.
   Narrow the window toward its 640px floor: every control still reachable, nothing cut off without a
   scrollbar. At 18 and the floor, the header band wraps: the bar takes a
   second line at the band's end and no rect of the bar or of a header
   control meets the name field's, and the title keeps at least its computed
   `min-width`; a long name may still end in an ellipsis at the floor. At 14
   nothing wraps. The magic-light walk
   (below) measures this on both seats at the sheet's width and at the floor.
7. **Keyboard and names.** From the crest, press Tab through the window.
   *Observable:* focus reaches every control of the band, the rails, the tab
   row, the active tab's head and its sections, in reading order; the Hunted
   here pill shows a focus ring while its checkbox has focus; the reading
   cells are passed over. Every control of the frame is named by its text, an
   `aria-label` or a tooltip. Known exceptions, unchanged from before the
   frame (ROADMAP): the Order tab's member arrows and blank-row remove, the
   Kit tab's light and spell pickers and removes, and the requests section's
   pickers.
8. **A pick holds until its button reads it.** On a party of three, Kit tab:
   pick the second member and the torch, arm `updateSetting` and
   `renderPartySheet` counters, and dispatch a `change` on each select.
   *Observable:* no write and no render, and the second member still shows;
   `await sheet.render()` and it still shows; type a spell name and turns and
   pick a caster — the same holds; rename the party in the band — the name
   lands and every pick survives that redraw. **Light it**: the light's
   `bearerId` is the second member's. On the Player seat, owning two members,
   the requests section's bearer pick survives `sheet.render()` too (do not
   press its button while a peer holds the Gamemaster seat — the request runs
   on their client).

Teardown: the party is left in delve; remove the fixture actor's key from
each seat's `partyPanel` flag and read the flag back; set
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

Fixtures, each found again by its marker or built carrying one, or recorded
with `api.track` for what a call or a gesture makes, read back by the id it
returns:

- a mile-scale HEX scene created with `active: false` and viewed (the march in
  miles recipe's first scene), `formation/country-hex-scene`, built again every
  run: the steps paint, erase and draw on it and a run's paint has no
  write-back, so the part's start retires it with its regions, walls and
  tokens. A second scene of any grid, also `active: false`, for the seat to be
  looking at in step 6, kept as `formation/country-other-scene` and written
  back to its grid and frame with its battlemap record unset (built again
  where it holds a region, a wall or a token);
- an `acks-extras.party` actor, `formation/country-party`, built again every
  run and retired before its map (its delete dissolves the formation and puts
  the member tokens back), with two members enrolled through the token HUD,
  kept as `formation/country-walker-a`, owned by the provisioned Player user,
  and `formation/country-walker-b`, their names, ownership and
  `prototypeToken.actorLink` written back at the start; the party token placed
  on the hex scene and adopted (poll the record for `tokenId`) rides the
  rebuilt map and is not marked. The members' names are no other walk's
  (*QA Country Walker A* and *B*, the party *QA Country Company*), since a
  card is claimed by an actor's or a scene's name in its text;
- each card the walk claims, marked `formation/country-message-<n>` in
  arrival order and retired at the part's start;
- the march in miles recipe's invented `travel` document, registered at
  priority 30 with `encounterFrequency.traveling.<territory>.mileHex` for TWO
  territories: X at the scene's cell, Y at twice it;
- hex C, the one the party token stands in, and three of its neighbours A, B
  and D, picked by offset and read as points with
  `scene.grid.getCenterPoint({i, j})`, so every drag below crosses one hex;
- through `acksExtras.battlemap.terrain.paintHexAt(scene, point, value,
  layer)`: hex A painted a forest table on `terrain` and Y on `territory`;
  hex B a hill table on `terrain` alone; C and D left
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
in miles recipe's, centre to centre with `{animate: false}`. A hex's centre
puts the corner on a fractional pixel and core stores the corner whole, so
the move is heard when `clock.lastPosition` equals the token's `_source`
after the update, never the corner asked for; a throw it owes
posts a whispered card, whose id is read back at once (the newest
`game.messages` entry) and marked. Count `acksExtras.hexEntered` with a
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
   *Observable:* `travel.map` names hex A with its painted ground and table
   and Y, each `source` "map", and the scene default's climate with `source`
   "scene"; `following` "none" (the
   scene has a water line, none under A) and `road` null; `Object.keys(f.travel)`
   gained none of `ground`, `encounterTerrain`, `territory`, `road` or
   `following`. No `hexEntered` fired and `travel.day.cadenceCarry` holds one
   cell's miles: the step was counted in Y, the territory it arrived in. The
   Ground and Territory cards read the painted values, sourced "Read off the
   map", and the Sky's climate card the scene default's; the band's
   territory chip reads Y; the Encounters line names hex A's table.
3. **The cadence on the way back.** Drag back into hex C.
   *Observable:* one `hexEntered` with `cadence` "grid" and `territory` X.
4. **A river.** Drag into hex D, then press the **By vessel** tile.
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
   `travel.override` is gone from the record. Write a declaration the
   record holds (`patchFormation(f.id, (r) => { r.travel.road = "earth"; })`
   from `formation-model.mjs`): the Road card reads it, sourced "Declared on
   the sheet", with the pen mark and its clear (`clearDeclared`). Press the
   clear: `travel.road` is the default, the card reads the default with no
   chip.
6. **Paint this hex.** Drag back into hex C and view the second scene. On the
   GM seat the Ground and Territory cards offer **Paint this hex**; the Sky's
   climate card, Road and Following do not. Press the Territory card's.
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
   terrain and territory in quick succession from the console: ONE counted
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

Teardown: unregister the invented `travel` document
(`acksExtras.lib.tables.unregisterTable`). The scenes, the party, its members
and the marked cards stand for the next run's start. The country brush is
client state:
close the palette, and if the run left the toolbar's brush armed, press any
other control.

## A territory a domain derives (added with the derived provenance)

Fixtures, each recorded as made: a mile-scale HEX scene created with
`active: false` (it need not be viewed: every read here is canvas-free), its
default territory borderlands through `writeSceneSetup`; a disposable
`acks-extras.party` actor, whose formation the `createActor` hook adopts (no
members: the reading needs none); its token created at hex C's centre from
`party.getTokenDocument()` with `scene.createEmbeddedDocuments("Token", …)`,
which the `createToken` hook adopts (poll the record's `tokenId`); then
`setJourneyMode(id, "journey")`, which reads the scene default under it. One
disposable `acks-extras.domain` actor classified civilized, and hex C painted
into it with `acksExtras.battlemap.terrain.paintHexAt(scene, point,
domain.uuid, "domain")`, its region's id read back from `scene.regions`.
`countryAt` reads a domain's class as [domains TESTING](../domains/TESTING.md)
steps 3 and 5 walk it; this recipe walks what the party makes of it. The
refresh runs on the active GM's client, so that client must have loaded the
working tree since the change: read `acksExtras.formation.apiVersion` and
`game.users.activeGM` there first. The party sheet is `party.sheet`, rendered
with `{force: true}`; the Territory card is
`[data-section="country"] .acks-extras-country-card[data-key="territory"]`.

1. **The class reads as the domain's.** Poll the record after the paint.
   *Observable:* within two seconds `travel.map.territory` reads civilized with
   `source.territory` "domain", and `travelOf(f).provenance.territory`
   "domain"; the Territory card shows civilized, sourced "The hex's domain",
   with no chip and still the **Paint this hex** chip (the territory layer
   holds nothing there).
2. **A reclassified domain re-reads the party.** Count, as the country
   recipe's step 7 does, the `updateSetting` events after which this
   formation's `travel.map` differs. Set the domain's classification to
   outlands (`domain.update({"system.classification": "outlands"})`, what the
   domain sheet's select writes).
   *Observable:* within two seconds one counted write: `travel.map.territory`
   outlands, still sourced "domain", with no drag and no region written
   (`layerRegionsOf(scene, "domain")` and its hexes as before), and the open
   sheet's Territory card reads outlands. Rename the domain: no counted write.
3. **The Judge's word over it.** Set the hand's territory to borderlands.
   *Observable:* the Territory card wears the **Override** chip, whose tooltip
   names outlands as the map's reading. Clear it from the chip: the card reads
   outlands, sourced "The hex's domain" again.
4. **A class cleared.** Set the classification to none (`""`).
   *Observable:* one counted write; the reading falls to the scene default,
   sourced "scene", and the card to "The scene's default".

Teardown: delete the region, the token, the two actors and the scene by the
ids recorded; the formation record goes with its party actor. Quote the
sweep result.

## The hex the party is shown (added with the redesign's phase 2b)

The plate's drawing, the day's navigation throw at its first step off a road,
the lost episode it opens, the Judge tab's Where they are, What the party is
shown and Navigation, quietly, and the stock's day. Every throw, every opening
and every move of the shadow runs on the ACTIVE GM's client: drive from that
seat, keep a second GM client off the world, and rig the dice and register the
invented table there.

Fixtures, each found again by its marker or built carrying one, or recorded
with `api.track` for what a call, a gesture or the feature makes, read back by
the id it returns:

- a mile-scale hex scene (*The march in miles*'s first scene; `grid.type` 2,
  hex rows, at least ten hexes across and six down) created with `active: false` and
  `ownership.default` OBSERVER, and viewed, kept as `formation/hex-scene` and
  written back to its grid and frame (the create fields but its name and
  `active`) at the start. Its background is Foundry's own
  `ui/parchment.jpg`, never book art: confirm it is served
  (`(await fetch(foundry.utils.getRoute("ui/parchment.jpg"), {method: "HEAD"})).ok`),
  then set it through the scene's level after creation
  (`scene.levels.contents[0].update({"background.src": "ui/parchment.jpg"})`,
  the battlemap recipe's mechanic). A second scene of any grid, also
  `active: false`, for the Judge to be looking at in step 11, kept as
  `formation/hex-other-scene` and written back the same way;
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
  `paintableValues("terrain")` lists other than grassland), painted again
  every run, since the brush merges into the region standing. List
  `layerRegionsOf(scene, "terrain")` after the painting and track any region
  the painting made;
- a paved road from C's centre to A's centre,
  `scene.createEmbeddedDocuments("Wall", [{c: [Cx, Cy, Ax, Ay], ...acksExtras.battlemap.roads.roadWallData({surface: "paved"})}])`,
  kept as `formation/hex-road` and written back to that data at the start.
  *Probe:* `acksExtras.battlemap.roads.stepBetweenHexes(scene,
  C, A).on` is true and `stepBetweenHexes(scene, A, B).on` false;
- a river no boat can follow, across hex C a quarter of the cell's height
  above its centre, edge to edge:
  `{c: [Cx - sizeX / 2, Cy - sizeY / 4, Cx + sizeX / 2, Cy - sizeY / 4], ...acksExtras.battlemap.water.waterWallData({kind: "river", navigable: false})}`
  (`sizeX`/`sizeY` the grid's), kept as `formation/hex-river` and written
  back the same way. A navigable one would spare the throw on its own;
- the world clock moved on to the next 07:00 before the party is built: steps
  3 to 9 are one calendar day, and the shared clock stands wherever the last
  walk left it;
- an `acks-extras.party` actor, `formation/hex-party`, built again every run:
  its journey record (the navigation, the episode, the day) has no shape a
  step can write back, so the start retires its token and then the actor (its
  delete dissolves the formation; wait for `getFormations()` to drop it). Two
  members enrolled through the token HUD are kept, `formation/hex-walker-a`,
  owned by the provisioned Player user, and `formation/hex-walker-b`, their
  ownership and `prototypeToken.actorLink` written back. Its token is placed
  in hex C and adopted (a hand-made party's record lands a moment after
  `Actor.create` resolves, so poll `getFormations()` for its `actorId` before
  placing it, and the record for `tokenId` after) and marked
  `formation/hex-party-token`, then
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
  stock is a flag on the scene, written again every run;
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
the update resolves, so wait up to two seconds after the drag for it. A card
is the walk's only when this client made it during the run (a
`preCreateChatMessage` hook tags each with the run's nonce and the action in
flight) and it speaks as one of the walk's fixtures, carries or names its
formation, names one of its actors or scenes, or is a navigation card thrown
during one of its own drags or presses (`tools/live/README.md`, "A walk",
says why). Mark each claimed card
`formation/hex-message-<n>`, in arrival order; the next run retires them
before its fixtures, stopping after five markers in a row that nothing
carries, and the walk ends by checking that no marked card speaks as another
walk's actor. A ledger write takes a moment to read back (*Lost*): settle ~1.5 s
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
   in hex B: `s = shadow.shadowFor(scene, id)`. A shadow is the feature's to
   remove, and the party's dissolve clears one a dead run left. The GM seat's band wears the astray chip; the Player seat's does
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
   *Observable:* one card (mark it), "Thrown true while they are astray", with
   the **They realise they are lost** button (`.acks-extras-nav-realise`);
   `history[0]` is by "judge" with step 3's day, `thrownOn` unchanged, and
   `lost.phase` still astray. Press the card's button (no dialog follows).
   *Observable:* `lost.phase` "aware", `lost.faked` and `lost.observations`
   empty, the shadow where it stood, the players told on the Player seat, and
   Where they are still shows two plates that differ. A second press does
   nothing.
10. **The next day, aware.** Press End day (mark every card it posts). With
    *Advance the world clock* off the calendar day stays where it is, and the
    key still moves with the count.
    *Observable:* End day posts no navigation card and `thrownOn` is
    unchanged; Navigation, quietly reads *Owed at the day's first step off the
    road.* Rig a 1 and press **Next hex** (`[data-action="travelEnterHex"]`)
    with the hex field as it stands.
    *Observable:* one card (mark it), "They already know they are lost", no
    button; one shadow, no second; `thrownOn` the new day's key, its count
    half one up, and `history[0]` by "step". Drag from E to D. *Observable:*
    no card, and the shadow moved one hex west. With the day open, advance
    the clock past midnight by hand (`game.time.advance(<seconds to the next
    calendar day>)`, forward only, the total reported) and drag from D to E.
    *Observable:* one card (mark it): the calendar half of `thrownOn` is the
    new day's and the count half unchanged, and the shadow stands one hex
    east.
11. **The refused opening, and the card's Begin.** Press **They turn back**
    (`[data-action="lostEnd"]`) and answer yes.
    *Observable:* `lost.phase` null, no `shadowFor` token on any scene, both
    plates read the party token's hex, no pad. View the second scene, rig a 1
    and press **Throw now**.
    *Observable:* a warning to open the party's scene, and one card (mark
    it) with the strayed verdict, the note that the episode could not be
    opened and a **Begin the lost episode** button (`.acks-extras-nav-begin`);
    `lost.phase` still null and no shadow. Press the button there.
    *Observable:* the same warning, nothing opens, the button stays. View the
    hex scene again and press it.
    *Observable:* no dialog; `lost.phase` "astray", a shadow in the
    party token's own hex, both plates the same hex and no badge, and the pad
    shown. Press **They turn back** and answer yes.

Teardown: restore `CONFIG.Dice.randomUniform` to the function saved before
the first rig. The scenes, the members, the party and the marked cards stand
for the next run's start. Unregister the invented `travel` document
(`acksExtras.lib.tables.unregisterTable("travel", {priority: 30})`) and
restore *Journey encounter throws*. The world clock is not set back; report
how far step 10 moved it.

## Conveyance (added with the redesign's phase 3)

The pace line, the five tiles, Fastest for all and Undo, a member's own pick
through the relay, the join and the dawn. The walk is
`tools/live/formation-conveyance.mjs` (`node tools/live/run.mjs
formation-conveyance`), on the GM and Player seats, under a recorder added
before reload. An arrangement runs on the primary GM's client,
so the GM seat must be it.

Fixtures, each found again by its marker or built carrying one:

- the scene `conveyance/scene`, and the party `conveyance/party` on a journey;
- the characters `conveyance/rider`, `conveyance/mate` and `conveyance/late`, the
  Player seat's, and `conveyance/hand`, nobody's;
- the animals `conveyance/pony` and `conveyance/mule`, which differ in pace, and
  the wagon `conveyance/cart`, slower than either, with a team.

Each step asserts its own start: nobody on anything, no pin, no word, nothing to
undo, `conveyance/late` out of the party. **The carriers are the Player seat's
for the run alone.** Every party a player owns a member of counts that player's
free carriers, so a carrier left in their hands is taken by a peer walk's kept
party at its next dawn; the walk gives them to the seat at its start and takes
them back in its `finally`. The same holds the other way: a carrier another walk
keeps in the seat's hands is on offer to this party (a kept vessel is what By
vessel boards, and a member of a peer's party aboard `conveyance/pony` takes it
off the list), so `P.quietForeign` takes every other carrier the seat owns out
of its reach for the run, puts each back in the `finally`, and takes a peer's
member off this walk's carriers.

A dawn arranges every party on a journey, a peer walk's kept one among them, in
the record's order. So `P.toDawn` puts any other party back by its own Undo in
the same step and reports which. A party that must stay on foot through a dawn
presses the On foot tile first. Check `putBack` in the log.

Drive mechanics: a hand that takes a passenger down uses `detach`; `dismount` is
a rider's alone, and a walk that calls it on a passenger starts its dawn with
the member still aboard, which reads as a dawn that seated them. Read the sheet
on a tall window, since `gm.shot` clips to what is on screen.

1. **Every seat reads the pace.** Open the sheet on the Wilderness tab on both
   seats.
   *Observable:* five tiles on each, none live on the Player's; the pace line's
   setter, figure and tooltip are the same on both, the Player owning only some
   of the party; the chip names the faster ride.
2. **A player pins foot.** On the Player's Order tab press On foot for
   `conveyance/rider`.
   *Observable:* the pin lands on the actor through the relay, nobody moves, a
   card says so, the row redraws pressed. `conveyance/hand`'s row shows no picks.
3. **A member joins and is mounted.** Drop `conveyance/late` on the sheet.
   *Observable:* they take the fastest they have, nobody else moves, a toast
   names them.
4. **Fastest for all, then Undo.** Press it on the Order head.
   *Observable:* the pin holds, the next member takes the faster animal over the
   wagon, `conveyance/hand` stays afoot with nothing to count, both seats read
   the same seats, the party actor's speed agrees. Undo takes back what the pass
   moved and spends itself, and the speed returns.
5. **A wagon in the train.** Press the cart for `conveyance/mate`.
   *Observable:* they board with a pin; `conveyance/hand` now has it to pick; the
   mode reads `vehicle` and the record stores no `mode`.
6. **The tiles.** Press On foot.
   *Observable:* everyone off, over a pin that survives; the word shows, with
   Back to automatic and Undo. Cross a dawn: nobody moves. Press By vessel with
   nothing to board: it stands as the word and lights. Press Flying: the hours
   appear on the Judge's seat. Back to automatic clears it, the pin going to its
   carrier.
7. **The dawn.** Take a member off by hand, then cross a dawn.
   *Observable:* they are on foot before it and seated after, and the toast names
   them.
8. **The relay refuses.** From the Player's seat, send a pick for
   `conveyance/hand`, and a pick naming a character as the carrier.
   *Observable:* nothing changes.
9. **The plates.** Size the sheet wide and at its minimum; the walk writes
    `conveyance-movement*.png` and `conveyance-order*.png` to the log directory.
    *Observable:* the section does not overflow, no tile or figure clips, a
    member's picks wrap. Read the PNGs.

Teardown: the clock is put back, the carriers leave the Player seat, the cards
the relay posted are swept by id. The nine fixtures stay.

## A player's own actors, in and out (added with the membership floor)

A player's way into a party and out of it, from a seat that begins with no member
and so cannot open the sheet at all. The walk is
`tools/live/formation-membership.mjs` (`node tools/live/run.mjs
formation-membership`), on the GM and Player seats, under a recorder added
before reload. A declaration runs on the primary GM's client, so
the GM seat must be it.

Fixtures, each found again by its marker or built carrying one:
`membership/scene`, viewable by a player; `membership/party` with
`membership/anchor`, the Judge's, whose token seeds the party token;
`membership/rival`, a second party, holding `membership/taken`; the Player seat's
`membership/lead`, on the map, `membership/follower`, with no token, and
`membership/pony`; and `membership/stranger`, nobody's. The walk brings them to its
start: only the anchor in the party, the lead's token on the map, nobody mounted.
The party stays in delve, where a player's choice of who comes along matters.

1. **No member, no sheet.** Read the party's permission on the Player seat.
   *Observable:* it neither sees nor owns the party.
2. **The way in.** View the scene as the player, control the lead's token, bind
   its HUD and press the party button: `canvas.hud.token.bind(placeable)`, then
   `#token-hud .acks-formation-hud`. *Observable:* the button reads for a player;
   the lead is a member with a stash and no token on the map; the seat owns the
   party within a beat, which is `syncPartyActorOwnership` on the GM client.
3. **The list.** Open the sheet on the Order tab. *Observable:* the follower is
   listed; the stranger, the taken and the pony are not; the lead's row has a
   leave control with a name, the anchor's has none. Press the follower.
   *Observable:* they join with no stash and off the list, on a row of their own.
4. **Out, and in by a drop.** Press the follower's leave control. *Observable:*
   they are gone and back on the list. A `drop` event with a `DataTransfer` naming
   the actor on the sheet's root, the event a sidebar drag ends in, brings them in.
5. **Refusals.** Drop the stranger, then the taken. *Observable:* a warning with the
   reason, the second naming the other party, and no write. Then send `bringIn` for
   the stranger and for the party itself, and `takeOut` for the anchor, through
   `requestPartyAction`, past the sheet's check. *Observable:* no write, and no card.
6. **A fight.** Write `combat` on the record, `{active: true, combatId}`, with no
   Combat behind it: only the flag is read here, and a real one is step 10's
   subject. *Observable:* the list and the leave control are live and the hint is
   the ordinary one; a relayed `bringIn` and `takeOut` each write.
7. **The plates.** The walk writes `membership-order*.png` wide and at the sheet's
   minimum. *Observable:* the list wraps and nothing passes the edge. Read the PNGs.
8. **Leaving mounted.** Mount the lead on the pony, press their own leave control,
   then the HUD again. *Observable:* their token returns beside the party token, the
   seat loses the party with its last member, the mount stays through both moves.
9. **The table.** *Observable:* a card for every move and none for a refusal.
10. **A real fight** (`tools/live/formation-fight-line-up.mjs`, `node
    tools/live/run.mjs formation-fight-line-up`). The fixtures of "A party in a
    combat" (`formation/combat-scene`, `formation/combat-party`,
    `formation/combat-party-token`, `formation/combat-member-2` and `-3`), with
    the walk's own `formation/fight-member-player` (the Player seat's, the one
    taken out), `formation/fight-joiner` and the creature copy
    `formation/fight-summon-copy`; a shared member's ownership is
    never changed. Start the combat so the party deploys. On the
    Player seat, take the owned member out. *Observable:* they leave the record;
    their deployed token stays where it stood and its combatant still resolves
    it; no token appears beside the party token; an initiative roll completes.
    Bring in an owned actor whose token is on the scene. *Observable:* in the
    record, marked deployed in this fight, its token still on the map. Leave an
    owned member behind and go back for them. *Observable:* `left` flips both
    ways, a public line each time, no whisper. Send `formUp` with a saved order.
    *Observable:* `{ ok: false, refused: "inCombat" }`, and the order unchanged.
    Make an unlinked token of the copy stamped with `summonFlags` for
    `formation/combat-member-2`, and drop it on the Judge's open party sheet
    (a `drop` DragEvent on the sheet root carrying `{type: "Token", uuid}`).
    *Observable:* the `warn.summonInCombat` warning; the token stands; the
    roster is unchanged. End the combat. *Observable:* `reform` gathers the members, the one brought
    in included; the one taken out stays on the map outside the party; nothing
    throws under a recorder added before reload.

Teardown: the combat flag is cleared and the cards are swept by id; step 10
forgets its saved order by id and deletes its combat and the creature's token by
their tracked ids. The fixtures stay. The lead ends in the party, and the next run's start takes them out.

## A seat's presses follow what it owns (added with T-0792 slice 1)

The party sheet's presses driven from a real Player seat, before the frame
draws that seat's cells: each handler is called as its cell calls it, on the
seat's own open sheet. The walk is `tools/live/formation-seat-presses.mjs`
(`node tools/live/run.mjs formation-seat-presses`), on the GM and Player
seats, under a recorder added before reload. The relay runs on the primary
GM's client, so the GM seat must be it.

Fixtures, each found again by its marker or built carrying one:
`formation/seat-party` holding the Player seat's `formation/seat-member` and
the Judge's `formation/seat-other`; `formation/seat-solo-party` holding only
the Judge's `formation/seat-stranger`; the abilities
`formation/seat-member-ability` and `formation/seat-other-ability` on the two
members. Members join through `addMember` with no token. At its start the walk
brings them to shape: member first, the stranger alone, an empty description,
neither ability bound.

1. **Form up through the relay.** The GM seat saves the party's order, then
   reverses it. The Player seat sends `requestPartyAction(fid, "formUp",
   { templateId })`. *Observable:* the answer is no refusal; the record's
   order is the saved one again; one public line names the order. A forged
   `templateId`, and the solo party's id, each leave its order as it was
   and post nothing. A fight still on answers `{ ok: false, refused:
   "inCombat" }`; a flag-only fight is reformed as over, so that answer is
   walked with a real combat (the fight walk) or offline.
2. **Saves and Supplies.** `SHARED_ACTIONS.partySave` with a save key the
   member carries, then `consumeRations`. *Observable:* the save card names
   the member and not the Judge's; the ration card names only the member.
3. **A party check.** `partyCheck` with `data-check="listen"`.
   *Observable:* the Judge's client posts the declaration line and rolls.
4. **The description.** `onChangeForm` with `system.description` and a
   `name`. *Observable:* the party actor's description is written; the
   record's name is not.
5. **The skill audit.** `new SkillAuditApp({ formationId })` rendered on the
   seat. *Observable:* the member's ability select is enabled, the other's
   disabled; a change on the enabled one sets the ability's `checkKey`
   flag, and the other stays unbound.

Teardown: the saved order is forgotten by its id; the cards whose text names a
`QA Seat` fixture are tracked and swept. The fixtures are kept.

## The frame on a Player and a Trusted seat (added with T-0792 slice 2)

The party sheet draws the presses a seat owns and leaves the rest off. The walk
is `tools/live/formation-seat-frame.mjs` (`node tools/live/run.mjs
formation-seat-frame`), run twice on lane A: once with `SEAT_PLAYER` naming the
world's Player user and once naming its Trusted user, both from
`TEST_ENVIRONMENT.md`. The walk reads the role from the seat (1 Player, 2
Trusted) and expects that role's cells; the Trusted seat alone has the image
cell and the plate press, since core gives Trusted the file browser. A recorder
is added before reload, and the GM seat must be the primary GM.

Fixtures, each found again by its marker or built carrying one:
`formation/seat-frame-scene`; the party `formation/seat-frame-party` with its
token `formation/seat-frame-token`, the seat's `formation/seat-frame-ranger`
(its ownership rewritten to the walking seat's user at the start) and the
Judge's `formation/seat-frame-smith`; the ability
`formation/seat-ranger-ability` on the ranger; `formation/seat-whole-party`
whose only member is the seat's `formation/seat-whole-member`; and, where the
world has a Trusted user, `formation/seat-trusted-party` whose only member
`formation/seat-trusted-member` that user owns. The day walk's
`formation/day-frame-*` are not reused: a Trusted run would rewrite their
ownership. At its start the walk brings each to shape: members in order, an
empty description, the delve, the ability unflagged.

1. **The rails.** Read each rail's cells on the seat
   (`[...el.querySelectorAll(".acks-extras-party-sheet__rail")]`) beside the GM
   seat's. *Observable:* the saves rail and its Magical toggle, Supplies as a
   press, Party checks and the methodical search, the description tool and the
   Key; no encounter throw, Pause, experience, Ownership or Tweaks; the image
   cell and plate press on the Trusted seat only. Every drawn cell has a
   tooltip and an `aria-label`; a save's and Supplies' tooltip says the press
   covers the members the seat owns; the Key lists exactly the drawn cells.
2. **One click per new press.** *Observable:* a save card naming the ranger and
   not the smith; one ration card naming only the ranger; a check's public
   declaration naming the seat, from the Judge's client; the description editor
   opens and its save lands on the party actor; on the Trusted seat the image
   picker opens.
3. **A journey.** Switch the party to journey. *Observable:* the quick tools
   hold Party checks alone; the hour's search is not drawn.
4. **Every member owned.** On `formation/seat-whole-party`. *Observable:* the
   experience cell is drawn; its press deals, and the card reaches the Judges
   and the seat.
5. **The HUD.** Two orders saved. *Observable:* the party token's HUD shows
   Form up to the seat; its picker has no Delete for a seat without
   SETTINGS_MODIFY; the press relays and the order lands.
6. **The ability.** Open `formation/seat-ranger-ability`'s sheet on the seat.
   *Observable:* the Skill checkbox shows; the Skill tab's fields are enabled.

Teardown: both saved orders are forgotten by id; the cards that name, or speak
as, a `QA Seat` fixture are tracked and swept. The fixtures are kept.

## The heads, the Place row and the Kit on a Player seat (added with T-0792 B3)

A seat that owns a party member presses the mode's own head (Turn, Round, Rest,
Hurried, Hop, Next hex, Work the country, End day) and the Kit tab's controls on
the lights and spells it owns, and a seat that owns a Region sees and drops onto
its Place row. The walk is `tools/live/formation-seat-heads.mjs` (`node
tools/live/run.mjs formation-seat-heads`, with `SHOTS=1` for the plates). It
reports each step below under its own id, and a step it cannot walk as
`NOT WALKED` with the reason, neither passed nor failed. **The walk is written
from the code and the design board and has not been run.** A mock
cannot prove that a press reaches the Judge's client under the attested
sender, that a head draws no pill the seat cannot press, that a Region window a
Player opens carries the row, or that a drop a Player makes lands only on a place
that Player owns. Seats: the primary GM and the world's Player user
(`TEST_ENVIRONMENT.md`); the Judge's client runs every relay, so the GM seat must
be the primary GM. A recorder is added before reload.

Fixtures, each found again by its marker or built carrying one, and each step
asserts the shape it needs at its start:
- Delve head: the B2 fixtures `formation/seat-frame-scene`,
  `formation/seat-frame-party`, `formation/seat-frame-token`,
  `formation/seat-frame-ranger` (the seat owns it) and `formation/seat-frame-smith`
  (the Judge's), as "The frame on a Player and a Trusted seat" defines them.
  The party is put in delve with the pace careful.
- `formation/heads-observed-party`: a party whose only member,
  `formation/heads-observed-member`, is the Judge's, with the seat at OBSERVER on
  the party actor and on no member.
- `formation/heads-city-scene` (a grid, a block set), `formation/heads-city-party`
  in city mode with `formation/heads-city-member` owned by the seat, and two
  place actors with tokens on the scene, `formation/heads-city-shown` and
  `formation/heads-city-hidden` (the token hidden by the Judge). Names are
  neutral ("QA Place 1"); `formation/heads-city-shown` takes a name carrying
  an HTML tag, to prove the public line escapes it.
- `formation/heads-journey-scene` (hex), `formation/heads-journey-party` in
  journey mode with `formation/heads-journey-member` owned by the seat.
- `formation/place-row-player-scene`: a grid scene holding the Regions below, a
  wall, and the party-free ground the map drops land on.
  `formation/place-row-player-region` is a Region the seat owns, with no
  behaviours; `formation/place-row-player-observed-region` is a Judge-drawn
  Region the seat has at OBSERVER and no more;
  `formation/place-row-player-wall` is a wall beside the Region's place.
- Three places for the row's states: `formation/place-row-player-place-owned`
  (the seat at OWNER), `formation/place-row-player-place-seen` (OBSERVER) and
  `formation/place-row-player-place-closed` (NONE for the seat), and a fourth,
  `formation/place-row-player-place-stamped`, a closed place carrying a
  hand-written importer stamp: a stand-in for an imported place that the walk
  links to the one Region instead of linking a world's real import. Reuse
  `formation/hazard-sample` and a trap Item `formation/place-row-player-trap`.
  One Region carries every state: the Judge relinks it from place to place, so
  each place's ground is that Region's.
- The tokens and the behaviour the walk adds, each found by marker:
  `formation/heads-city-token` (the city party's), `formation/heads-city-shown-token`
  and `formation/heads-city-hidden-token`, `formation/heads-journey-token`, and
  `formation/place-row-player-observed-district` (the District behaviour on the
  observed Region).
- The Kit: `formation/kit-seat-party` in delve with two members,
  `formation/kit-seat-a` (the seat owns it) and `formation/kit-seat-b` (the
  Judge's), each a character carrying a light on the record and one tracked spell,
  and each holding one known spell Item, `formation/kit-seat-a-spell` and
  `formation/kit-seat-b-spell`, so the add-spell row's picker has something to
  offer. The start shape writes the party's ownership and members, one lit light
  and one spell per member, nothing else.

Setup the walker owns. **Create New Actors** is held by the Player role for the
no-place-with-create step (PR3) and PR2's create half, and the walk grants it: it
reads and prints the Player role's starting value (Settings tab → Game Settings →
Configure Permissions is the same entry), walks PR2's no-create half first, writes the grant
from the Judge's seat, asserts `game.user.can("ACTOR_CREATE")` reads true on the
Player seat, and in a `finally` puts the starting value back and reads it on both
seats (GM and Player), whether PR3 passes, fails or throws. The grant reaches every seated peer while
it stands, so find out who is seated first. A Region the Judge drew needs OBSERVER for the Player to open its
window. The relay needs a primary GM client; with none, lib warns and no press or
drop writes. Core 14 offers the Regions control to any seat holding Create Regions
(a Player by default) and makes the drawing seat the Region's owner; where the
world has revoked it, the control is absent, PR1 is reported not walked, and the
Judge builds the Region with the seat at OWNER for the rest. The walk makes the
Region as the seat by creating it in the scene from the Player's page, the write
a drawing ends in; it does not drive the pointer's draw. Where the seat already holds
Create New Actors at the start, PR2's no-create half is reported `NOT WALKED` (the
walk grants and never revokes); PR2's create half and PR3 still run.

**The heads** (Actors sidebar tab → a party actor → its sheet → the mode's tab; the
head is the row at the top of that tab). Press by the real click on the Player's
page; read the record and the cards on the Judge's.

1. **Delve.** Open `formation/seat-frame-party` on the Player seat, Dungeon tab.
   *Observable:* the head holds Turn, Round, Rest a turn and Hurried, with no
   Undo; an asks line under the pills says Turn and Round ask the Judge; the
   title's tooltip carries the turn count and the elapsed time.
   Press **Hurried**: the record's `stance.pace` reads hurried and one public
   line, spoken as the party, says it hurries the party. Press it again: careful
   and one line. With the record already hurried, send the same hurried press from
   the Player's page (`requestPartyPress(formation, "pace", {hurried: true})`):
   the answer is ok, the record is unchanged and **no** line is posted. The
   figures rail's pace cell makes the same press. Press **Turn**, then
   **Round**: one public line each says the seat asks, and the clock's turn
   count and the Judge's plan are unchanged until the Judge's own press. Press
   **Rest a turn**: the Judge's client takes the rest. The Judge's own Hurried
   press posts no line.
2. **A seat that owns no member.** Open `formation/heads-observed-party`.
   *Observable:* no pill on any head and the pace cell is a reading. From the
   Player's page send `requestPartyPress(formation, "pace", {hurried: true})`:
   the answer is `{ok: false, refused: "notOwner"}`, the seat is warned with the
   generic refusal, the record is unchanged and nothing is posted.
3. **City.** Open `formation/heads-city-party`, City tab. *Observable:* Hop,
   Turn, Round and Rest a turn; no Hunted here and no Undo. The hop picker lists
   `formation/heads-city-shown` and not the hidden one, and the strip's count of
   places in reach counts one. Pick the shown place: the party token moves, the
   clock spends the imported price, one public line says the party walks to the
   place with its name shown as text, and the Judges get the whispered hop line.
   A crafted hop from the Player's page naming the hidden token's id
   (`requestPartyPress(formation, "hop", {tokenId})`) answers
   `{ok: false, refused: "noTarget"}`, warns, and moves nothing. Where the hop's
   price is not imported the press answers `quiet` and moves nothing: report the
   walk of the hop not walked.
4. **Journey.** Open `formation/heads-journey-party`, Wilderness tab.
   *Observable:* the head's hex field reads the hex the party believes it stands
   in (blank while the party is shown unknown country), not the record's label.
   Press **Next hex** with `D3` typed: the record's hex label is `D3` and one
   public line names it; with the field blank, one line without a hex. A 65
   character label answers `{ok: false, refused: "badPress"}` and changes nothing.
   Press **Work the country** with no hours set aside on the day board: an
   information line and no card; with hours set aside, the foraging cards and the
   hours marked done; again, the "already worked" line. Press **End day**:
   `dayCount` rises by one and one public line says the day ended. Switch the
   party to delve and send an `enterHex` press from the Player's page: `stale`,
   nothing written; switch it back to journey.
5. **The day's end, answered once.** On `formation/heads-journey-party` walk the
   token until the day is spent, as "The day's end" does, so the Judge's seat
   shows its offer dialog. While it stands open, press **End day** from the
   Player seat. *Observable:* `dayCount` rose by one and the log holds one row for
   the day. Now answer the Judge's dialog **Call it a day** (and, in a second run,
   **Push on**): `dayCount` and the log are unchanged, the day kind is not
   forced, and `offerDayEnd` answered `"answered"` (read it by running the offer
   from the Judge's page where the dialog's return is the thing to quote).

**The Place row on a Player seat** (Scene controls → Regions → double-click the
Region → its window → Appearance tab). Reported separately from the heads: five
checks of the row and three of the map drop.

| Step | Do | Observable |
|---|---|---|
| PR1 | As the Player, draw a Region on `formation/place-row-player-scene` (Scene controls → Regions) and open its window | The Region is the seat's own; the window opens |
| PR2 | Open the Appearance tab, first with Create New Actors not held, then again once the walk has granted it | A Place row under the Name field: a caption that is a `<span>`, the none stand-in, no picker, no make-a-place button; with Create New Actors not held, no drop zone and no hint; with it held, the drop zone and the hidden-trap hint |
| PR3 | Grant Create New Actors to the Player role and assert the Player seat reads it true (the walk puts the starting value back after the step), then drop an obstacle Hazard on the zone | The zone's words end "With no place yet, one is made."; a place exists for the Region and its sheet did not open; the place opens to the table (its default ownership is OWNER); the Judge's seat reads one obstacle on it. `api.track` the place's uuid read back at once |
| PR4 | The Judge links `formation/place-row-player-place-owned` to the Region and the Player's window is reopened; then the same with `-place-seen`, then `-place-closed` | Owned: the place's name as text, a counts line of what is not hidden, a zone reading "Drop a trap, obstacle or condition here." and the line saying a dropped trap is hidden. Seen: the name alone, no counts, no zone. Closed: "A place you cannot open", nothing else |
| PR5 | The Player opens the District behaviour window of `formation/place-row-player-observed-region` (Judge-drawn, the seat at OBSERVER) | The window is read-only and carries no place row; an owner-editable behaviour window is not asserted here |

PR4's owned state also takes a drop: drop an obstacle on the zone, then a trap.
*Observable:* the obstacle raises the counts line by one obstacle; the trap
does not change it, and the Judge reads a trap thing on the place with
`hidden: true`. This is the known consequence: the Player who dropped the trap
cannot see or remove it afterward; the Judge can.

Map drops (`Hooks.call("dropCanvasData", canvas, data)` on the Player's page; the
mechanics are `docs/scene-search/TESTING.md`, "S2 — session, activities and
drops"). A relayed drop answers after the Judge's client has written, so wait
before reading, and read from the Judge's seat.

| Step | Do | Observable |
|---|---|---|
| PM1 | Drop the trap Item on bare ground over `-place-owned`'s Region | A trap thing on that place, `hidden: true`; the counts line leaves it out |
| PM2 | Drop a Hazard, then the trap, where no place holds the point; then over `-place-seen`'s ground, `-place-closed`'s ground and an imported place's ground (a place carrying the importer's stamp; where none is imported, report that leg not walked) | The Hazard warns the "inside a region that has no zone or terrain of its own" line and the trap warns the "onto a wall … or inside a region" line, the same words each time; no place gains a thing |
| PM3 | Drop the trap within a grid square of `formation/place-row-player-wall`, over the owned place | The trap lands on the place, hidden; the wall's `flags["acks-extras"]` read before and after are equal |

**The Kit tab on a Player seat** (Actors sidebar tab → `formation/kit-seat-party` →
its sheet → Kit tab). Each step asserts the start shape: the two members in order,
the seat owning A and not B, and a lit light and a tracked spell on each.

| Step | Do | Observable |
|---|---|---|
| K1 | Read the lights section on the Player's seat | A's light draws Remove; B's draws none |
| K2 | Read the spells section | A's spell draws minus, plus and Remove; B's draws none |
| K3 | Read the add-spell row | The row is drawn; its caster list offers A and not B; its picker offers A's known spell and not B's |
| K4 | Read the maps section | No New map, Archive, Close or Save fog control |
| K5 | Press A's spell's minus, then plus, then Remove, and A's light's Remove, each with a real click | Each lands on the record as the Judge reads it (turns one fewer, back, the spell gone, the light gone); one public line each, spoken as the party, naming the spell or the light |
| K6 | Pick the manual entry, type a name and turns, choose A as caster, press Track | The record holds a spell with that name, those turns and A as caster; one public line |
| K7 | From the Player's page send `requestPartyPress` for `spellAdjust`, `spellRemove` and `lightRemove` naming B's spell and B's light | Each answers `{ok: false, refused: "notOwner"}`; the seat is warned "The Judge's client did not take that press."; the record is unchanged and nothing is posted |

Screenshots, from the real Player seat and clipped to the element, with no user
name in frame: the Dungeon, City and Wilderness heads (the Wilderness head both
with the party shown its hex and shown unknown country), the Region window's Place
row in its owned, seen and closed states, and the Kit tab. No whispered card and
no tooltip is shot.

Teardown: the place the drop in PR3 made is tracked by its uuid and swept with
`api.sweepTracked({only})` naming that uuid alone, since a bare sweep deletes every
fixture the same run built; the report quotes what it removed, could not find and
refused. The cards the run's presses posted are tracked by id as they are read
and swept the same way. Nothing else is deleted. The fixtures stay: the next run's
start puts the parties back in delve, careful, with the day count and hex label its
steps assert, re-links the places by the Judge's hand, and clears the things the
drops wrote by writing a place's list whole.

## The party's form, movement and Order on a Player seat (added with T-0792 B3)

A seat that owns a party member is drawn the band's mode and name, the city's
pickers, the journey's movement tiles, flight, Sky with Roll weather, the Day
section and Camp, the Order tab's head and a blank's controls, and the Skill audit
opener; it writes the form's fields through the `partyForm` relay and the
arrangement presses through `partyPress`. A seat that owns a RollTable is drawn its
Monster level row, and every seat reads the strip's city progress. The walk is
`tools/live/formation-seat-forms.mjs` (`node tools/live/run.mjs
formation-seat-forms`). It reports each step below under its id, and a step the
world cannot give as `NOT WALKED` with the reason, neither passed nor failed.
**The walk is written from the code and has not been run.** Seats: the primary GM
and the world's Player user (`TEST_ENVIRONMENT.md`); the Judge's client runs every
relay. The walk changes no world permission: a default Player lacks Configure
Settings, which is the case under test, and the steps that need that start shape
assert `game.user.can("SETTINGS_MODIFY")` is false on the Player seat and report
`NOT WALKED` where it is true.

`tools/live/formation-day.mjs` expects no Sky section controls, no day board and no
camp pickers on its player seat, and that seat owns a member, so those checks (the
"no pickers, no day board", "camp no pickers" and "sky ... holds no control"
steps, and step 7's withheld-Sky branch) read stale until the day walk is revised.

Fixtures, each found again by its marker or built carrying one; every step asserts
the shape it needs at its start:
- Journey: `formation/heads-journey-scene`, `-party`, `-member` (the seat owns
  it) and `-token`, as "The heads, the Place row and the Kit on a Player seat"
  defines them. The start shape is journey mode (the walk leaves it in the delve), shown `believed`, a fresh march
  day, no movement word, careful pace, the party's name as the walk found it.
- City: `formation/heads-city-scene`, `-party`, `-member` (the seat owns it) and
  `-token`. The scene draws no District behaviour and the party stands on no
  place; each run asserts both in the sheet's own context. The board is wanted-
  marked by the Judge at the start of S4.
- Order: `formation/kit-seat-party` with `formation/kit-seat-a` (the seat owns it)
  and `formation/kit-seat-b`, in delve, with no blank cell, and an ability Item on
  each so the audit has a row for each: `formation/forms-ability-a` and
  `formation/forms-ability-b`, found by marker under their actors.
- Tables: `formation/rolegate-table`, a RollTable with no results, whose
  ownership the walk writes whole each run with the seat at OWNER, and
  `formation/rolegate-table-seen`, the same with the seat at OBSERVER. RollTable
  create is a Judge's, so the Judge builds both.
- One saved marching order, made by the Judge's page for the run through the
  marching-orders API and forgotten at teardown by the id its save returned. It is
  a world-wide setting entry and no document, so it is outside the fixture ledger.

**Setup the walker owns.** A barred party: the journey member's survival flag is
written to a barring rung (`nourishment: "underfed"`) by the Judge's page and
removed at teardown, whole. The save-order world list and the Player's world
permissions are read, never written.

**The band and the form** (Actors sidebar tab → a party actor → its sheet → the band
and the mode's tab). Press and type on the Player's page; read the record on the
Judge's.

| Step | Do | Observable |
|---|---|---|
| S1a | Open the journey party's sheet on the Player seat; pick another mode in the band's select | The select is drawn; the record's `travel.mode` reads the pick on the Judge's read-back |
| S1b | Type a new name in the band's name field | The record's name and the party actor's name both read it |
| S4a | Open the city party's sheet, Mode tab | The City section is drawn although the scene holds no District and the party stands on no place (`travel.settlement.shown` true in the sheet's context, with `districtName`, `placeHere` and `districtPlace` empty) |
| S4b | Judge: mark the board wanted. Player: change the pace and the route pickers | Both read back on the record, and the board is **still wanted** (`keepWanted`) |
| S4c | Read the section's DOM on the Player's seat, and the Hunted box | No Hunted here box and no hunter line; the Judge's seat, shown the same board, draws the box |
| S4d | From the Player's page send a crafted `partyForm` carrying the Judge's keys (`travel.override`, `travel.shown`, `travel.lostNote`, `travel.camp.present`, `settlement.wanted: false`, `tableId`) beside an allowed one | The allowed field lands; none of the Judge's keys changed on the record |

**The journey** (the Wilderness tab, Mode tab of the sheet). The party starts with
no movement word.

| Step | Do | Observable |
|---|---|---|
| S6a | Press the Flying tile in the Movement section | `travel.movement.set` reads the word on the Judge's read-back |
| S7a | Type hours aloft into flight's field (drawn once the party flies) | `travel.movement.hoursAloft` reads it |
| S6b | Press **Back to automatic** | The word is cleared on the record |
| S6c | Press **Undo** where the Movement section or the Order head draws it | The word the last pass found (the tile's) is back on the record; `NOT WALKED` where no arrangement snapshot exists, since a tile that moves nobody takes none and no Undo is drawn |
| S7b | Pick another precipitation in the Sky section | `travel.weather.precipitation` reads it |
| S7c | Press **Roll weather** | The weather bands stand on the record and one public line, spoken as the party, announces the press; the Judge's own press, run next from the Judge's sheet, posts no line. `NOT WALKED` where the button is disabled (no imported sky tables). The roll itself posts no card at this base, so there is none to find beside the announcement |
| S7d | Pick another activity for a day slot | The record's `day.activities` holds it at that slot |
| S7e | Tick one camp declaration | `travel.camp` holds it (and the hidden `declared` marker is why an unticked box would read no) |
| S7f | Bar the member (underfed), then pick Forced march in the day kind select on the Player seat | The Player's seat is warned with the barred member's name (`warn.forcedMarchBarred`), the record's day kind is unchanged, and no confirm dialog opens on the Player's seat |
| S7g | The same pick on the Judge's seat | The Judge's dialog asks (`confirmBarOverride`); answer **Leave the day as it is**: the kind is unchanged. The dialog is answered by the walk; an unanswered dialog hangs the run |

**The Order tab** (Order tab of `formation/kit-seat-party`). Each step asserts
two members, A owned and B not, and no blank.

| Step | Do | Observable |
|---|---|---|
| S8a | Press **Auto-arrange** | No refusal is said on the seat; the record still holds both members (the cells are reported before and after, since the sort may leave them as they stood) |
| S8b | Press **Add a blank**; press an enabled move control on the blank; press its Remove | The record gains one blank cell, the blank's cell index changes, and the blank is gone again |
| S8c | Type a frontage different from the stored one; then type `0` | The first lands on the record; the second is refused with the invalid-frontage warning said on the **Player's** seat, and the record is unchanged |
| S8d | Pick another token shape | The record's `tokenShape` reads it |
| S8e | Judge: save the arrangement, then reverse the members. Player: press **Load order**, pick the saved order, press its button | The members stand as the saved order has them. The dialog draws no Forget button |
| S8f | Read the head | No **Save order** and no **Disband**; Fastest and Add a blank are drawn |
| S8g | Press **Skill audit** | The audit window for the party opens on the Player's seat; its Used-for select is live for A's ability and disabled for B's, each matching `item.isOwner` |

**The strip and the RollTable.**

| Step | Do | Observable |
|---|---|---|
| S19 | Judge: set the city board's blocks and turns and mark it turned around. Player: read the strip | The progress line shows both figures, and the turned-around warning shows |
| S17a | Player: open `formation/rolegate-table`'s sheet (RollTables sidebar tab → the table → its sheet, which opens in edit mode for an owner with no results; Summary tab); type a level; Save | The Monster level row is drawn; the table's `monsterLevel` flag reads the level |
| S17b | Open `formation/rolegate-table-seen` | The sheet opens in view mode and the row is absent |

Drive mechanics: the walk clicks the controls the seat is drawn, except where a
control is a form field, which it types into (`input` then `change`, the way a
person leaves a field). The blank's move
buttons are the `memberUp`, `memberDown`, `memberLeft` and `memberRight` buttons
inside the blank's list item; the walk presses the first one enabled. The load
dialog's select is set by the order's own id. A relayed press needs a primary GM
client; with none lib warns and nothing writes. Teardown is by the run's own
ledger: the cards its presses posted are tracked by id as they are read and swept
by `api.sweepTracked({only})`, the saved order is forgotten by its id, the member's
survival flag is removed, the parties are returned to the names they were found with (the Order party's
frontage and token shape too) and the journey and city parties to the delve, and
nothing else is deleted. The fixtures stay.

## The crossing, Search here and the Trapbreaking modifier on a Player seat

A seat that owns the party actor (a seat that owns a member does, by the
ownership sync) begins, sets up, throws for and ends the crossing; a seat that
owns a member presses that member's Haul, landing save and footing and the Dungeon
tab's Search here; any seat that opens the Trapbreaking window types its modifier.
The setup is written direct from the Player's own client. Begin, End and Throw
all go through the `crossingRun` relay, Haul, the landing save and the footing
through the `crossing` relay's `haul`, `land` and `footing` steps, and Search here
through `partyPress` (`searchHere`). The walk is
`tools/live/formation-seat-crossing.mjs` (`node tools/live/run.mjs
formation-seat-crossing`). It reports each step below under its id, and a step the
world cannot give as `NOT WALKED` with the reason, neither passed nor failed.
**The walk is written from the code and has not been run.** A mock cannot prove
that a relayed save opens no dialog on either screen, that a press by a Player
reaches the Judge's client under the attested sender, or that the setup a Player
writes lands on an actor flag from that client. Seats: the primary GM and the
world's Player user (`TEST_ENVIRONMENT.md`); the Judge's client runs every relay,
and the Judge's page rigs the die.

Fixtures, each found again by its marker or built carrying one; every step
asserts the shape it needs at its start:
- `formation/crossing-seat-scene` (a grid scene), `formation/crossing-seat-region`
  (a rectangle on it), `formation/crossing-seat-place` (a location actor linked
  to the Region by the Judge's page), `formation/crossing-seat-party` with its
  token `formation/crossing-seat-token` standing inside the Region, in the
  delve, with `formation/crossing-seat-a` (the seat owns it, and so the party
  actor) and `formation/crossing-seat-b` (the Judge's), and
  `formation/crossing-seat-wall` on the scene. Names are neutral ("QA Crossing Seat A").
- `formation/heads-observed-party` with `-member` (slice 1's): a party whose only
  member is the Judge's, the seat at OBSERVER on the party actor.
- For C18 only, the `formation/trapbreak-*` fixtures `formation-trapbreak` builds and shapes
  (party, fighter the Player owns, trap, wall). They are found by marker and never
  built here: where one is absent the step is `NOT WALKED`.
The start shape of `crossing-seat-party` is the delve, members A then B, the seat
owning A alone, no crossing flag and no scene search session; each part of the
walk brings it back with the Judge's page.

**The crossing as a whole** (Actors sidebar tab → a party actor → its sheet →
Dungeon tab → The crossing). Press and type on the Player's page; read the
flag on the Judge's.

| Step | Do | Observable |
|---|---|---|
| C1a | Open the party's sheet, Dungeon tab, with no crossing open | The sheet's seat reads `ownsParty` true and `isGM` false; the section is drawn with the kind pick and Begin |
| C1b | Pick Swim and press **Begin** | The Judge reads `flags.acks-extras.crossing.kind` as `swim`; one public line, spoken as the party, announces it |
| C1c | Read the setup; type **Judge modifier** 2 | The setup fields (`crossing.judgeMod`, `crossing.penaltyPick`) are in the Player's DOM; the flag reads `judgeMod` 2 and `judgeModBy` the Player's user id; the field's tooltip reads "Set by <the Player's name>" (compared in the page, never printed) |
| C1d | Judge: type 1 on the Judge's own sheet | `judgeMod` 1 and `judgeModBy` the Judge's id; the tooltip reads "Set by the Judge" |
| C1e | Judge: type 0 | `judgeMod` 0 and `judgeModBy` unset |
| C11a | Swim open, the die rigged to a 20: press **Throw all** | A's record gains a throw and B's record is unchanged. `NOT WALKED` where the swim figures are not imported (no row can be thrown) |
| C11b | A and B both drowning (the Judge writes each record): press **End** on the Player's seat; then send `requestPartyAction(<fid>, "crossingRun", { step: "end", crossingId })` from the Player's page | The crossing stays open both times; the seat is told, naming the held members; the crafted call answers `refused: "held"` |
| C11c | A and B afloat: press **End** | The flag is gone |
| C11d | A drowning again: the Judge's own **End** | The Judge is warned and the crossing closes |
| C11e | Begin a squeeze from the Player's seat; press the **Squeeze** Shape radio | The flag reads `kind` `squeeze` and `shape` `squeeze` |

**The water penalty** (the same section, a swim crossing).

| Step | Do | Observable |
|---|---|---|
| C12a | Pick an imported penalty step; then **Larger…** and type 7 | The flag reads the picked step, then `penaltyPick` `larger` and `penaltyLarger` 7. The first half is `NOT WALKED` where the pick offers no imported size |
| C12b | Read the section | No "Penalty in force" line while the pick is drawn |
| C12c | On `formation/heads-observed-party`, the Judge begins a swim; open it on the Player's seat | Only where the sheet's seat reads `ownsParty` false: the section shows the penalty in force and holds no setup field, no Begin, no End and no Throw all. Otherwise `NOT WALKED` |

**Haul, the landing save and the footing** (the same section).

| Step | Do | Observable |
|---|---|---|
| C13a | A and B drowning: read the rows; press **Haul** on A | Haul is on A's row and not B's; A's record reads afloat on the Judge's seat and B's still reads drowning. A crafted `crossing` request with step `haul` for B is refused and B stays drowning |
| C13b | A jump (gap 5, precarious): press the landing **Roll** on A | Roll is on A's row and not B's; the save rolls on the Judge's client and no dialog opens on either screen (every dialog standing on either is counted, then closed); a card to the Judges records it; the flag is unchanged. `NOT WALKED` where A has no Roll press (the jumping figures are not imported) |
| C13c | Seed A with an attempt (the Judge writes a `landing` record with a `jump`); pick a footing and press **Failed** | `jump.footing` reads the pick on A's record. A crafted footing for B, and one outside `FOOTINGS`, are refused |
| C13d | The gap set past every range so the Judge's reading of the row warns | The Player's row has no Roll press; the footing press is still drawn, and a crafted footing is refused with the row's reason and writes nothing |

**Search here** (Dungeon tab → Turn plan; the Region and place fixtures put the
party in a place).

| Step | Do | Observable |
|---|---|---|
| C14a | Press **Search here** with the token inside the Region | The button's tooltip is `plan.searchHereTip` (the Judge's wording); the Judge reads a scene search session on the party actor for the place, `shown` false, every lot unfound; one public line announces it; no scene search screen is open on the Player's seat. The pot dealt for fallen bodies is `NOT WALKED`: Search here carries no fight's record, so no bodies are named ([treasure recipe](../treasure/TESTING.md), "Search the fallen", has them) |
| C14b | The Judge moves the token outside every place; press **Search here** | No session; the Player's seat is shown "The search did not open."; the token is put back |
| C14c | From the Player's page send `partyPress` `searchHere` for `formation/heads-observed-party` | `refused: "notOwner"` and no session. `NOT WALKED` where `playersMoveParty` is on |

**The Trapbreaking modifier** (Actors sidebar tab → a party actor → its sheet →
Dungeon tab → Trapbreaking; the fixtures are `formation-trapbreak`'s).

| Step | Do | Observable |
|---|---|---|
| C18a | Open the window for the fighter the Player owns, on both seats | The modifier field is drawn on both; on the Player's seat its tooltip is `doors.judgeModTyped`, on the Judge's none; Mark found and Reset are absent on the Player's seat |
| C18b | Die rigged to one face: type 0 and press **Work on it**; type 3 and press it again | The two posted throws share the natural face and the second carries 3 more (read from the cards' rolls). `NOT WALKED` where Work on it is not enabled, or a first made throw disarms the trap so the second is refused |
| C18c | A refusal that warns the Judge still blocks the Player | `NOT WALKED` here: formation-trapbreak's Player steps hold it |

**The wall sheet's trap row** (Scene controls → Walls → double-click a wall → its
configuration sheet).

| Step | Do | Observable |
|---|---|---|
| W1 | Open the wall's sheet on each seat | The Judge's draws the ACKS trap row; a Player Foundry does not let write the wall draws none. A Player who gains the row is `NOT WALKED`: the world's default permissions give wall updates to Assistant and up, who are Judges here |

What cannot be walked, and why:
- The in-force line for a seat that views the party without owning it:
  `syncPartyActorOwnership` rewrites the party actor's ownership from its members, so
  C12c walks only where the OBSERVER grant survives, and otherwise the line is
  covered offline (`tools/test-crossing-surface.mjs`).
- A Player who owns the wall: no seat of the test world holds it (W1).
- The pot dealt for fallen bodies by a Player's Search here (C14a), and C18c.
- The not-owner legs while `playersMoveParty` is on: the walk reads the setting and
  never writes it.
- A world whose system skip-dialog setting names no key opens the save dialog on the
  Judge's screen for a relayed save; C13b counts it, closes it and fails.

Drive mechanics: the walk clicks the controls the seat is drawn and types into form
fields (`input` then `change`). The kind pick is `[data-pick="crossing-kind"]`, set
before `[data-action="crossingBegin"]` is pressed; Haul, the landing Roll and the
footing's Failed press carry the member's id (`crossingHaul`, `crossingLand`,
`crossingLandingFailed`); the footing pick is `[data-pick="crossing-footing"]`.
The Judge's page seeds a member's record (drowning, an attempted jump) by writing
the flag by its dotted path; the die is rigged with `CONFIG.Dice.randomUniform` on the
Judge's page, which reads from the top on core 14. A relayed press needs a primary
GM client; with none lib warns and nothing writes. No card's words and no user's
name is printed: tooltips and notifications are compared in the page.
Teardown is by the run's own ledger: the cards its presses posted are tracked by
id and swept with `api.sweepTracked({only})`; the crossing flag is ended, the scene
search session ended by party id, the token returned to the place, the die
restored and the windows closed. Nothing else is deleted; the fixtures stay.

Stale until the lines below are revised: `tools/live/treasure-search.mjs` steps 6 and 7
expect a Player's Search here to post a "declares" card and open nothing.

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

## A city over several maps (added with the city stamp)

A party crosses AX1's ways between maps, as the importer's maps step makes
them, and each map engages its own navigation. The fort's grounds and its
building are one city (MODEL, "A board is counted in one city, and a city may
span maps"). `tools/live/formation-city-maps.mjs` walks it from the GM seat.

**Fixtures.**

- AX1's maps in the world, with their ways between them: the region's map, the
  fort's grounds, one building's plan (`ax1.fort5-8Map`) and the dungeon's
  first level, found by their cookbook ids. The walk reads them and never
  writes them; where they are absent it stops and says so. The importer-ax1
  walk, or the Judge's own import, makes them.
- The party, `formation/city-maps-party`, kept. Its formation is core's create.
- The party token: made each run beside the region map's way into the fort,
  and tracked. Each token core makes for it on another map is read back and
  tracked as it appears.

**Drive mechanics.**

- The GM seat's window must lead its seat's election, or the formation's
  hooks run in another window, on whatever code it loaded.
- A crossing starts from the cell beside a way, reached by a move with
  `action: "displace"`. Core's teleport behaviour ignores a displacement, so
  the token can be brought beside any way without crossing the others on the
  map. Then an ordinary `move` onto the way's middle crosses.
- Core's teleport keeps the token's id, so a token back on a map it left has
  the uuid it had there before. Tell the arrival by its map and by not
  standing before the crossing; move the token the record names.
- The record follows the arrival in two writes on the primary GM, after
  core's create: the linkage (`sceneId`, `tokenId`) and the mode the map
  declares. One run read the old map a second after the token stood on the
  new one. Poll until the record names the new map, its token and the mode,
  then read it.
- A way on the region's map, and a building's way that several of the
  grounds' ways share, asks first. Press yes on the dialog; its default
  destination is fine.
- Before each crossing, pause the party's clock as the Judge's Pause does
  (`clock.paused`, `pausedBy: "judge"`), so the step bills no turn, block or
  mile and throws nothing. A mode change clears the pause, so pause after it.

**Steps and observables.**

1. Journey mode on the region's map; cross into the fort. The record names the
   grounds' map and the arrival's token, the mode is settlement and the board's
   `sceneId` is the grounds' map.
2. Stamp the board with the dungeon level's map and give it blocks and turns;
   cross into the building. The board re-enters (blocks and turns 0) and is
   stamped with the GROUNDS' map, not the building's. Before the city stamp it
   named the building.
3. Give the board 7 blocks, 3 turns and the hunted flag; cross back out. The
   board is untouched: the same stamp, 7, 3 and hunted.
4. Cross into the building again and out: 7 and 3 both ways.
5. Cross to the region's map: journey. Cross into the dungeon's first level:
   delve.

**Teardown.** The party is set back to delve, so it is not counted a stay
between runs. `api.sweepTracked({only})`, naming the run's tokens and cards,
deletes them and nothing else. A token a teleport replaced shows as missing.
The party stays.

## The rest switch (added with the Require rests setting)

`tools/live/formation-column.mjs` walks it.

**Fixtures.** One party actor, `formation/rest-party`, kept, with one character
member seated through the party sheet's drop (*Core drive mechanics*) and no
Endurance on it. At the section's start the party's record is brought to a new
delve's shape (mode delve, a fresh clock, a lit light so the card's light line
does not drown the rest line) and the setting is read back to its default.
`f = () => acksExtras.formation.getFormations()[formationId]`. The walk needs
the `formation` table's `restInterval` imported (*The delve's figures,
imported*, step 2); `n = t.getDoc("formation").tables.restInterval`, and every
count below is that figure read back, never a number typed in. Read
`advanceWorldTime` first (step 3 of that section) and ask before stepping a
shared world.

1. **On, today's behaviour.** `game.settings.set("acks-extras", "restRequired",
   true)`, rest a turn (`advanceTurns(f(), 1, {resting: true})`), then
   `advanceTurns(f(), n + 1)`. *Observable:* `f().clock.winded` is true, the
   member carries the effect flagged `acks-extras.winded`, the sheet's Rest stat
   and the title-bar bar show the count under the winded badge, the warnings
   strip warns of the winded party, and the turn card carries the winded line.
2. **Off, nothing is owed.** Set `restRequired` to false and re-render the
   sheet. *Observable:* the Rest stat is gone from the strip's tracker and the
   title bar carries no bar; the warnings strip no longer names winded. Then
   `advanceTurns(f(), 1)`. *Observable:* the clock's `turnsTotal` rose by one,
   `turnsSinceRest` is 0, `winded` is false, the winded effect is gone from the
   member, and the turn card has no winded line, no rest line and no recovery
   line.
3. **Off, past the interval.** `advanceTurns(f(), n + 3)`. *Observable:*
   `turnsTotal` rose by `n + 3`; `turnsSinceRest` stays 0; no member carries
   the winded effect; no card carries a rest or winded line; the sheet shows no
   rest-due warning at any point; the wandering-monster cadence still comes
   round (`encounterCounter` cycles, with the world's `encounterEvery`
   above 0). The Rest turn button still advances a turn and its card still says
   the party rested.
4. **Back on.** Set `restRequired` to true and re-render. *Observable:* the
   Rest stat and the bar return reading 0 over `n`; `advanceTurns(f(), n + 1)`
   winds the party as step 1 did.

Report the world's `restRequired` as found and put it back; the party stays
(the clock is reset at the next run's start).

## A party in a combat (added with the party-token switch)

The party token deploys the party into a combat and, added again, gathers it.
Driven on the GM seat through the real token HUD; `tools/live/formation-audit.mjs`
walks it.

**Fixtures** (kept; found by marker, built when none carries it):

- `formation/combat-scene`: a scene with `grid: {size: 100, distance: 5}` and
  room around the party token.
- `formation/combat-party`: a hand-created `acks-extras.party` actor, its
  formation seeded by the createActor hook, with two or three character actors
  seated through the party sheet's drop (*Core drive mechanics*). Each member
  carries its own marker, `formation/combat-member-<n>`.
- `formation/combat-party-token`: the party's token on `formation/combat-scene`,
  `actorLink: true`, adopted (poll the record until `tokenId` names it).

At the start: no combat in the world (`game.combats.size === 0`); if one exists
that carries no marker, it is somebody's, so build the check around it and leave
it. Assert the record is at rest: no member has `deployedTokenId`, `combat` is
null, the party token is visible.

1. **Deploy.** Select the party token, bind its HUD
   (`canvas.hud.token.bind(canvas.tokens.get(id))`) and press the HUD's combat
   toggle (the crossed-swords control; find its selector in the rendered HUD
   rather than assuming one). *Observable:* one combatant per body, each
   token a member's (`standsAs`), every member placed on the map, the party
   token hidden, `f().combat.active`, and one whispered card, "The formation
   breaks for battle". No combatant stands for the party token.
2. **Gather from the token.** Select the hidden party token (a GM can) and press
   the combat toggle on it again; do not reveal it first. *Observable:* the party token is
   visible, no member token stands, `f().combat` is null, the combat holds no
   combatant, the combat itself still exists, and the card "Combat over" posted.
   No "Already fighting" card. Press once more: the party deploys afresh.
3. **End Combat gathers too.** End the encounter from the tracker. *Observable:*
   as step 2, and the combat is gone.
4. **A second combat while fighting.** With the party deployed, create another
   combat and add the party token to it. *Observable:* the second combat holds
   no combatant for it, the first still holds the bodies, and the GM's card names
   the first encounter ("Already fighting in ...").
5. **A pasted copy.** With the party at rest, build the copy with
   `scene.createEmbeddedDocuments("Token", [{...partyToken.toObject(), _id:
   undefined, x: partyToken.x + 500}])` and `api.track` the copy at once.
   Add the copy to a combat. *Observable:* a whispered card, "This is not the
   party's own token"; no member token placed; the party token still visible;
   the copy keeps its combatant; the record is as it was. Move the copy.
   *Observable:* `clock` unchanged. Move the party token. *Observable:* the clock
   advances.
6. **A hand-placed second token.** Drag the party actor from the sidebar to the
   scene. *Observable:* no token is created, a warning says the formation
   already has a party token, and `tokenId` is unchanged.
7. **A stale marker.** With the party at rest, patch one member's record to
   `deployedTokenId: "gone"` and `deployedSceneId` the scene's id, then add the
   party token to a combat. *Observable:* as step 1, and that member stands under
   a token of its own, not "gone".

Teardown: end every combat the section created; delete the copy and any token
the run tracked through `api.sweepTracked()`. The kept fixtures stay.

## Extra party tokens (added with the party-token switch)

The repair tool's `formation.partyTokens` and `formation.partyActors` checks.
Fixtures are the three markers above; the run also tracks everything it builds.

1. **A same-scene copy.** Build the copy as in *A party in a combat* step 5.
   `scanRepairs({only: "formation.partyTokens"})` through the repair window or
   `acksExtras.lib.repair`. *Observable:* one finding for the copy, fixable, and none
   for the linked token. Fix it. *Observable:* the copy is gone, the linked token
   stands, `tokenId` and `clock` and the members are as they were, and the
   rescan is empty.
2. **A copy on another scene.** Create a second scene and the same copy on it.
   *Observable:* a finding that is not fixable, with the reason naming the
   deletion on its own scene. Fix selected leaves it.
3. **A token of a party that is gone.** Create a token of the party actor flagged
   with `formationId: "no-such-party"`. *Observable:* a fixable finding; fixing
   deletes it.
4. **A lost link.** With the flagged party token standing, patch the record's
   link away (`patchFormation(id, (r) => { r.tokenId = null })`); a token placed
   by hand is adopted at once by the `createToken` hook, so the shape cannot be
   built that way. The record's `sceneId` may be nulled with it, as a world
   that lost both has them. *Observable:* a fixable finding for adoption, never
   for deletion; fixing links it (`tokenId` and `sceneId` name it again, the flag
   and the token stand) and the rescan is empty.
   Then null the link again and add a second token carrying the same
   `formationId` flag on another scene (`api.track` it). *Observable:* both are
   listed, neither is fixable, each with a reason, and Fix selected deletes
   nothing. Delete the second: the first is offered for adoption again.
5. **A party actor with no record.** Create an `acks-extras.party` actor, then
   remove its record from the world setting. `scanRepairs({only:
   "formation.partyActors"})`. *Observable:* a fixable finding; fixing creates
   the record naming the actor.
Teardown as above; the repair report whisper is the module's, tracked by id.

## The audit roll (added with the skill audit's roll control)

The roll control on each row of the Skill audit's party roster. Driven on the GM
seat through the real window; offline, `tools/test-skill-audit-roll.mjs` pins the
card, the evaluator and the footnote. `tools/live/formation-audit.mjs` walks it.

**Fixtures** (kept; found by marker, built when none carries it):

- `formation/audit-party`: an `acks-extras.party` actor with three character members
  seated through the party sheet's drop (*Core drive mechanics*), each marked
  `formation/audit-member-<n>`.
- Members 1 and 2 each carry an ability item named `Audit Search`, with one throw
  (a flat target of any invented figure). Member 3 carries none. Build the items
  through the abilities API so the throw is stored where `rollsOf` reads it. The
  ability's name is invented; do not use a printed proficiency's.
- `formation/audit-skill-imported`: an ability item in the world's items carrying a
  cookbook id `def.skill.<invented key>`, a cookbook `cite` and a throw whose level
  ladder has a rung with no value (the shape the importer writes). For step 7's
  *Names and sources*; the importer makes one from a Judge's own copy.
- `formation/audit-item-zero`: an ability item on member 1 with `system.rollTarget`
  0 and no cookbook flag; `formation/audit-item-cited`: one with no stored target and
  a cookbook `cite`. Build both through the abilities API.

1. **The control.** Open the Skill audit from the Order tab. *Observable:* the
   `Audit Search` row has a dice button; it is a `<button>` with an `aria-label`
   naming the ability and a tooltip on hover; Tab reaches it.
2. **Several roll.** Press it. *Observable:* exactly one new chat message, whispered
   to the Judges (a Player seat sees none); its title is the ability, its subtitle
   the party; two rows, one per holder, each with a total, a target, and a
   Success or Failure; member 3 is named in the footnote as not having it. Hover a
   total (the dice) and a target (the throw, its base and each bonus). Read the
   world's message list: no second card per member.
3. **A bonus is itemized.** Give member 1 an ability whose stored effect is a
   proficiency-throw bonus naming `Audit Search`. Press again. *Observable:* member
   1's target is lower by that figure and its tooltip names the base and the
   bonus; member 2's has no bonus line.
3a. **A bound row rolls the table's target.** Bind `Audit Search` to a party check
   (its Skill tab's *Used for*: Search), give member 1 a Throw bonus on that tab and
   the library's Alertness, then open the audit. *Observable:* the card's note
   names the check ("Rolled as the party check: Hasty Search"); member 1's target
   equals the figure the same ability reads on its own skill sheet and on the
   Rolls tab for that member, and its tooltip lists the source and each bonus by
   ability name with the page its import cites; the total is a bare die against
   that target. Unbind it: the card returns to the
   ability's own throw and the note is gone. Switch the item off for member 2
   (Skill unchecked): member 2 is named in the footnote as unable to attempt the
   party check, and the table shows nothing for them in that column.
4. **A member who is down.** Set member 2's hit points to 0 and press again.
   *Observable:* member 2 has no row and is named in the footnote as down; restore
   the hit points.
5. **Nobody holds it.** Delete `Audit Search` from members 1 and 2 (`api.track`
   nothing: the items are the fixture's, rebuild them after) and press the row's
   button from a roster still showing the row, or open the window before deleting.
   *Observable:* one card reading that nobody rolled, with all three members in
   the footnote, and no dice shown. Rebuild the items.
6. **Nothing advanced.** Read the party's clock before and after step 2.
   *Observable:* identical.
7. **The window.** `tools/live/formation-audit.mjs` walks every part of this step
   in its section "the audit window"; the focus press is a `focus()` then a
   `click()` on the ruling button, which is what a keyboard Enter dispatches.
   - *Id.* Open the audit for `formation/audit-party`, then for the kept combat
     party's formation (`formation/combat-party`). *Observable:* two windows, ids
     `auditWindowId(<formation id>)` each, and the first one's roll button still
     posts a card (track it). Press the first party's Skill audit again: the same
     window comes forward and no second one opens.
   - *Redraw.* With a window open, create an ability item on a member through the
     API, edit its name, then delete it; seat a member through the party sheet's
     drop. *Observable:* each write shows in the open window with no reopen; an item
     created on an actor outside the party adds no row.
   - *Scroll and focus.* Narrow the window until the body scrolls, scroll it down,
     then press a row's ruling button with the keyboard (Tab, Enter). *Observable:*
     the body part's `scrollTop` is unchanged after the render and
     `document.activeElement` is that row's ruling button again. Change a Used-for
     select in the items table: focus is on that select afterwards. Set a ruling
     back to automatic before leaving.
   - *Columns and type.* Narrow the window below the Resolution table's width, and
     raise the Type size setting to its largest. *Observable:* the table's
     `.audit-scroll` box scrolls sideways to the last check column, no column is
     clipped, and the selects and inputs grow with the type; the Skill tab on an
     ability sheet shows its select and number input at the same type size.
   - *Names and sources.* With `Audit Search` bound to Search on member 1 and one
     imported skill in the world, read the open window and the ability's Skill tab.
     *Observable:* each Used-for select has an `aria-label` naming its item and
     options named for the check (the Skill tab's list equals the audit's); a
     Resolution cell's tooltip lists the source and each part with the page its
     import names while the cell's text carries none; an item with a zero stored
     target has an empty Sheet target cell whose tooltip names the sheet's stored
     target, an imported one's names its page; a progression row reads the skill
     item's name with its page in the tooltip; neither the window nor the Skill tab
     has a `title` attribute; the Throw bonus label and input show core's tooltip.

Teardown: the cards the run posted are the module's; read each id back right after
the press and `api.track(id, "ChatMessage")` it, then `api.sweepTracked()`. The kept
fixtures stay.

## The party check resolves through the abilities (added with T-0481)

The party card, the Rolls tab, the skill sheet and the disarm dialog read one
figure for a character's throw. `tools/test-party-skills.mjs` pins it offline
with invented ladders and abilities: a held skill, an ability that stands in
for the stored Adventuring figure, an item that only carries a printed
ability's name, a throw bound to a check by a flag, a throw naming a ladder
nothing registers, a condition counted once, the disarm dialog's two checks
and the card `rollPartyCheck` posts. `test-skill-audit-roll.mjs`,
`test-adventuring-throw.mjs`, `test-throw-modifiers.mjs` and
`test-skill-ladders.mjs` pin the figures beneath it. The Skill audit opened
from the party sheet's Order tab, and the card its row posts, are walked in
"The audit roll" above by
`tools/live/formation-audit.mjs`. Two things are read by eye on a live pass of
that window: the thief's skill sheet renders, and the audit's roster has no
Progression or Factor column.

## The turn plan (added with T-0487)

What each member does with a turn the party stands still, locked on the Party
sheet's Dungeon tab and resolved when the Judge presses Turn. Walked by
`tools/live/formation-turn-plan.mjs` on two seats, the GM and the Player;
offline, `tools/test-turn-plan.mjs` pins the plan's order of work and
`tools/test-formation-flows.mjs` ("turn plan: …") the relay, the card and the
cancellations.

**Fixtures** (kept; found by marker): the scene `formation/plan-scene`; the
party `formation/plan-party` holding `formation/plan-thief` (owned by the
Player seat; a hand-made ability bound to Search with an invented flat throw,
rebuilt at the walk's start), `formation/plan-fighter` and
`formation/plan-cleric`. The walk brings them to its start shape itself: the
three in the party, each with a token on the walk's scene, the party token
there, no plan, no fight, not paused, nobody moved this turn, every member at
full hit points.

0. **A first render that a member write overlaps settles on the write.** On
   the GM seat take the cleric out of the party (`removeMembers`,
   `restore: false`) and wait until the Player seat's copy holds two. On the
   Player seat open the party sheet with its first render held: replace the
   instance's `_preRender` with one that waits on a promise when
   `options.isFirstRender`, call `render(true)` without awaiting it, and wait
   until the wrapper is entered (the context is read, the HTML not yet drawn;
   the sheet is in no registry and its `state` is 0). Bring the cleric back
   from the GM seat, wait until the Player seat's copy holds three, then
   resolve the promise and delete the instance's `_preRender`. *Observable:*
   the render that finishes drew two Turn plan rows (`[data-plan-actor]`),
   and within three seconds the sheet shows three with no other call: the
   sheet's own catch-up render (`PartySheet._onRender`). Before the fix it
   stayed at two through an 8 s poll.
1. **The player locks for a member they own.** On the Player seat, read the
   party sheet's Dungeon tab. *Observable:* the
   Turn plan section has a row per member; only the thief's row has a choice
   list and Lock; its list offers the methodical search open and battering
   refused. Pick the methodical search and press Lock. *Observable:* the party
   actor's `flags.acks-extras.turnPlan`
   holds the thief's entry with `by` the Player's user id, and one public line
   tells the table.
2. **Refused for a member the player does not own.** Send the `plan` relay
   straight from the Player seat for the fighter (the column offers no control
   for it). *Observable:* the flag gains no fighter entry.
3. **The Judge locks for another.** On the GM seat every row has a choice
   list. Lock the cleric's listen. *Observable:* the flag holds it. Press Keep
   watch on the cleric's row. *Observable:* the cleric's entry is gone and the
   thief's stands. Lock the cleric's listen again.
4. **A move cancels.** Move the party token five cells (`animate: false`).
   *Observable:* `clock.movedThisTurn` is set, the flag is gone, one public
   line names both members, and the Player's thief row shows the reason in
   place of the choice list.
5. **Turn spends one turn and rolls once.** Press Turn to clear the move, lock
   the thief's search again from the Player seat, then press the Dungeon tab's
   Turn on the GM seat. *Observable:* `clock.turnsTotal` rose by exactly one
   and the partial rounds did not move; one card whispered to the Judges has
   one row, the thief, whose target is the thief's Rolls-tab figure for the
   throw (`rollInventory`: the `abl:<item>:primary` row, or `adv:searching`
   where that row stands behind it); the entry carries `resolvedTurn` equal to
   the new turn.
6. **Rest a turn resolves the plan too.** Lock Rest for the thief from the
   Player seat and press the Dungeon tab's Rest a turn on the GM seat.
   *Observable:* `clock.turnsTotal` rose by exactly one and the thief's rest
   entry carries `resolvedTurn` equal to it.
7. **A fight cancels on one card.** Lock the thief's search and the cleric's
   listen, then create a combat on the scene with the party token's combatant.
   *Observable:* the formation's combat is active, the flag is gone, and one
   public card has two rows, both members, each marked cancelled. Delete the
   combat; the formation's combat ends.
8. **Endurance is a capability.** Last, since it changes who owes rest: give
   the fighter a gear item named "QA Rope of Endurance", then a copy of the
   library ability whose definition id folds to `kw:endurance`
   (`capabilityForId`). *Observable:* `hasEndurance` (turn-engine) reads false
   before either, false with the rope alone, true with the ability. A
   hand-made ability counts only where its `provides` lists `kw:endurance`;
   the ability sheet shows `provides` and does not edit it.
9. **The Round press resolves a round-length entry and spends nothing more.**
   No activity the formation registers is round-length, so register one for
   the walk: on the GM seat import `/modules/acks-extras/scripts/lib/turn-activities.mjs`
   (the module instance the sheet uses, which an `import` by the same URL
   returns) and call `registerTurnActivity({ key: "qaRoundJob", pace: "hasty",
   length: "round", options: () => [{}], turns: () => 1, resolve: () => "done"
   })`, keeping the returned function to unregister it. Lock it for the cleric
   and the thief's search for the thief from the Judge's row, note
   `clock.turnsTotal` and `clock.roundsPartial`, then press the Dungeon tab's
   Round. *Observable:* `roundsPartial` rose by exactly one (the press's own
   round); the cleric's entry carries `resolvedTurn` equal to `turnsTotal`; the
   thief's search is unstamped with its `remaining` unchanged and no search card
   was posted. Press Round again: the cleric's stamp is unchanged. Press Turn:
   `turnsTotal` rose by one, the cleric's entry is gone and the thief's carries
   the new turn. Unregister the activity. The positive case for a real
   registrant, the hasty search, is walked through scene search's own recipe
   once it lands.
10. **The Judge locks past a refusal, with a warning (U2).** Move the party
    token five cells (`animate: false`) so `clock.movedThisTurn` is set. On the
    GM seat the thief's row shows its reason and still has its choice list.
    Pick the thief's methodical search and press Lock. *Observable:* the flag
    holds the thief's entry with `by` the GM's user id, and a line at the foot
    of the row (`.acks-extras-turn-plan-note.is-warned`) reads "A player would
    be refused: The party moved this turn. Locked for you anyway." Re-render
    the sheet (change the tab and back): the line is still there. Press Turn:
    the line is gone. Press Keep watch on the row after a fresh warned lock:
    the line goes with the entry. The one refusal that stays hard: pick a
    choice whose length is not imported (the batter row, while nothing reads
    the door figures). *Observable:* its option is greyed out for the Judge as
    for a player and the flag gains nothing. A player's *relayed* request for
    the moved party is refused by the Judge's client as before (step 4).
11. **A player's press-time refusal is visible beside the row (U2).** The
    player's list greys out a refused pick, so reach one the way a user does:
    on the Player seat lock the thief's hasty search, then have the GM
    seat toggle Hurried (no hasty searching at that pace), and on the Player seat
    press Lock again on the thief's still-selected pick. *Observable:* a toast
    and, at the foot of the row, `.acks-extras-turn-plan-note.is-refused`
    ("Not locked: …"); the flag keeps the earlier entry and gains no other. The
    note survives a re-render and is gone after Turn. Where the hasty search is not
    offered on this build, say so and use a once-per-turn activity
    the thief already used this turn.
12. **The Trapbreaking opener has one home (U2).** On the GM seat, with the
    party on a delve, the Dungeon tab's head holds a Trapbreaking pill beside
    Turn and Rest a turn; press it. *Observable:* the Trapbreaking window
    opens. The Order tab's head holds no `[data-action="openTrapbreak"]`. On
    the Player seat, with a member who may make the throw (the thief), the
    Dungeon tab's head holds the same pill and the tab's foot holds none;
    press it. *Observable:* the window opens. Give the Player a member with
    no Trapbreaking skill and no Adventuring: the head shows no pill. In the
    request section, the spell-duration box has a visible "Duration in turns"
    label bound to it (click the label: the box takes focus).
13. **The strip's four figures say where they came from (U2).** On each seat
    hover Exploration, Elapsed, Rest and Carry-over. *Observable:* each
    tooltip lists its parts with the party's own numbers and a page
    reference: Exploration the slowest member, their ride and pace (and the
    dark or hurried line when either holds); Elapsed the turns, the clock
    time and the rounds into the current turn out of the rounds to a turn;
    Rest the turns since the last rest and the limit; Carry-over the feet
    moved and the length of a round. Hurry the pace and darken the scene
    (a member with no sight in the dark) and hover Exploration again:
    *Observable:* it names each. Delete the registered `formation` table's
    `restInterval` (setup is the subject: read the one document, re-import
    after): *Observable:* the Rest figure shows its count with no limit and
    its tooltip is the page reference alone. Press Round until the partial
    rounds wrap: *Observable:* the figure after the slash under Elapsed is the
    count at which it wraps to the next turn.

Teardown: every card the GM seat posts carries the run's nonce, is tracked by
id the moment the walk reads it, and is swept with the combat and step 8's
two items; the fixtures stay.

## The column and its lights (added with the marching column)

The party token is the head of a column drawn behind it, each lit bearer
shines from their own cell, and a managed token's light is unpadded (MODEL
§The column; lib MODEL, Senses). `tools/live/formation-column.mjs` walks it; its header names the steps it leaves.
The books are mapped, but the light table arrives only with a Rules tables run
made since it existed: run Rules tables in Reimport One Shelf with the books
open if `acksExtras.lib.light?.lightFigures?.("torch")` reads nulls. Then read
it there or in the Ruledata Browser, and use those figures below, never a
number from memory.

The column is spaced by the three frontage figures the `formation` document
holds (MODEL §The column, Spacing), and a world that has imported them draws
and deploys a spaced column. Steps 1 to 16 describe the one-per-cell column, so
walk them with the figures read as not imported: on each seat, unregister the
document's layers client-side (`acksExtras.lib.tables.unregisterTable("formation",
{priority})` for the world and override priorities), after every reload of that
seat and every mirror of the store, which bring them back. Nothing persists.
Steps 17 to 20 set invented figures as a Judge's override in the Ruledata
Browser (`Settings tab → Game Settings → ACKS II — Extras → Imported Rules
Tables → Open Ruledata Browser`) and put them back.

Fixtures, each found by its marker or built carrying it:

- `formation/column-scene`: a scene with a square 100 px grid of 5 ft,
  `padding: 0`, global illumination off, and walls forming an L-shaped
  corridor two cells wide: east six cells, then south six.
- `formation/column-party`: a party actor whose party token stands at the L's
  west end facing east, shape unset (the world's default).
- `formation/column-lead`, `formation/column-torch`,
  `formation/column-lantern`: three characters joined to it in that order at
  frontage 1. The torch bearer holds a torch and the lantern bearer a lantern
  (Kit tab), both lit.
- `formation/column-mile`: a hex scene measured in miles, with nothing on it.
- A character with Night Vision on `formation/column-scene`, off the
  corridor's line but within the torch's reach of its corner
  (`formation/column-watcher`).
- `formation/column-trap-item` and `formation/column-trap` (step 20): an area
  trap Item and a Trap Zone over the corridor's cell one east of the head that names it, each
  re-shaped at the start of every use.

At the start, assert: the party's frontage is 1, both lights are lit and
unshuttered, nobody is deployed, the `partyTokenShape` world setting and the
record's `tokenShape` are `order` and unset, and the record's `columnColor` is
unset. A kept fixture carries what the last walk left.

1. Run one sweep (`(await import("/modules/acks-extras/scripts/formation/scene-sync.mjs")).syncEnvironments()` on the GM seat).
   *Observable:* the party token is 1×1 and its `flags.acks-extras.partySize`
   reads 1×1. Resize it by hand to 2×2; a moment later it is 1×1 again.
2. On a Player seat that owns a member, drag the party token through the L to
   its south end with a real gesture. Mid-move (every ~150 ms), sample the
   column container's cell positions and
   `canvas.effects.lightSources.get("acks-extras.column.<formationId>.<bearerId>").data`.
   *Observable:* rank 1 and rank 2 stand on cells the head walked (around the
   corner, never through the wall), and each light's `x`/`y` is the centre of
   its bearer's drawn cell. After the step, the token carries
   `flags.acks-extras.trail` with four cells (one more than the party's three
   bodies, `trailBound`), newest first, written once,
   and the move animated to its end (the trail write did not stop it).
3. Reload the Player seat.
   *Observable:* the drawn cells and the light positions are the same as
   before the reload (the trail is stored).
4. Shutter the lantern, then douse the torch (Kit tab).
   *Observable:* each bearer's light source is gone from
   `canvas.effects.lightSources` after its write, on the GM and the Player seat
   alike, and both come back when relit.
5. Read the torch source's `data.bright`.
   *Observable:* the imported bright figure, converted to the scene's units, ×
   `canvas.dimensions.distancePixels`, with no padding. Toggle a perception
   refresh (`canvas.perception.update({initializeLighting: true})`); the
   sources survive it.
6. Turn the party token by hand (rotation only).
   *Observable:* the trail is reset to the head, the column is laid again
   behind the new heading (turning where the corridor's end wall stands in its
   way, as `columnFor` lays it), no size or position is written, and the clock
   is unchanged.
7. With the frontage figures not imported, start a combat with the party
   token; the party deploys.
   *Observable:* each member's token stands on the cell their glyph stood on
   (the bend included) and carries that member's own actor in its `actorId`
   (a position check alone passes a swapped pair); each bearer's own token
   carries their light, and the column's sources for those bearers are gone.
   End the fight and gather.
8. On the Order tab, set the party's On the map control to Fixed size.
   *Observable:* nothing is drawn and the token stays 1×1; resize it to 2×2 by
   hand and walk a step: it stays 2×2, and both lights still shine from the
   bearers' cells (computed as the column, though undrawn). Set the control
   back to Marching order: it returns to 1×1.
9. Move the party token onto `formation/column-mile`, then paste a copy of it
   on `formation/column-scene`.
   *Observable:* nothing is drawn on the mile scene, both lights shine at the
   head there, and the pasted copy draws no column and carries no light.
10. With the party back on the corridor, read the watcher's token sight.
    *Observable:* the Night Vision watcher reads as lit by the column's torch
    (lib's Night Vision sync raises its sight), and dousing the torch takes it
    back.
11. **The fill.** On the GM seat, every drawn body's cell carries a
    translucent square in the token's disposition colour. Pick a Column tint
    on the Order tab: the squares change to it, and clearing the field returns
    the disposition colour. On the Player seat, walk the column around the
    corner out of the Player's line of sight.
    *Observable:* a cell the Player cannot see shows neither square nor
    portrait, and hiding the party token hides the whole column from the Player
    (the GM still sees it).
12. **The per-party switch.** With a second party on the scene, set one party's
    On the map control to Fixed size and leave the other's unset; change the
    world setting `partyTokenShape`.
    *Observable:* the party with a choice keeps it; the unset one follows the
    setting.
13. **The unpad check.** Deploy the lantern bearer (step 7). Read their token's
    `light.dim` and `object.light.data.dim`.
    *Observable:* `data.dim` equals `light.dim × distancePixels` exactly (no
    `externalRadius` added), and `flags.acks-extras.managedLight` is true. Set
    a light on an unmanaged token by hand (a fresh token, light dim 2): its
    `data.dim` is `2 × distancePixels + externalRadius`, core's padding.
14. **A hand edit releases the light.** On the deployed lantern bearer, read
    `flags.acks-extras.managedLightStamp`: it holds the stored `light.bright`
    and `light.dim`. Edit the token's dim light by hand in its Token Config.
    *Observable:* at once, `object.light.data.dim` is the new dim ×
    `distancePixels` + `externalRadius` (padded); after the next sync (shutter
    and unshutter the lantern) the stamp reads `{released: true}`,
    `managedLight` is false and the hand-set radius stands.
    `acksExtras.lib.vision.migrateWorld({reclaim: true})` takes it back: the
    lantern's radius returns, stamped.
15. **A column squeezed by its walls.** Put the head back at the L's west end
    facing east (turn it, so the trail resets) and set the frontage to 3. Read
    `columnFor` and `columnPlacement` on the GM seat
    (`/modules/acks-extras/scripts/formation/column.mjs`), and the drawn cells.
    *Observable:* the head, the cell south of it (east's right hand) and the
    cell west of the head, all three inside the corridor: a third file meets a
    wall on either hand and goes to the next rank. The drawing and a deploy
    from that spot, with no step walked, take the same three cells, not the
    straight block. Set the frontage back to 1.
16. **The wall test agrees with core.** For every step between neighbouring
    cells on the scene around the corridor, hold the column's `wallTest` over
    the scene's walls against the party token's
    `object.checkCollision(destCentre, {origin: originCentre, type: "move"})`.
    *Observable:* they agree on every step. A step off the scene is left out:
    core's scene edge is the column's bounds, not a wall.
17. **The column spaced.** Set the Judge's override of the three frontage keys
    to the invented figures 2, 4 and 1.5 (feet; the scene is 5 ft to 100 px, so
    40, 80 and 30 px),
    put the head at the corridor's west end facing east with a fresh trail, and
    read `columnFor` (`/modules/acks-extras/scripts/formation/column.mjs`) and
    the drawn squares at frontage 1, then 2.
    *Observable:* `points` are the glyph centres, each square 40 px wide, rank
    spacing 30 px along the way walked and not a cell, `cells` still the
    one-per-cell layout beside them, and each light on its bearer's point. At
    frontage 2 the second body stands 40 px south of the first (east's right
    hand) and the third starts the next rank. Give the lead an equipped large
    slashing weapon (`api.track` the item, sweep it after): its square is 80 px
    and the second body stands 60 px south. A hex scene and a mile-scale scene
    still lay no column.
18. **A spaced deploy.** Set the march figure to 2.8 (the third file of a rank
    of three then stands within a token's half-width of the corridor's south
    wall), put the head at the west end facing east, set the frontage to 3 and
    start a combat with the party token.
    *Observable:* the two bodies whose footprint (100 px, shrunk 1 px) clears
    every wall stand on their points, one between cells, and the third, whose
    footprint touches the wall, stands on its one-per-cell cell. The expectation
    is computed in the walk from the corridor's own walls. Each token carries its
    member's actor, and the combat tracker lists every deployed token. Overlap
    with another body is not a misfit.
19. **A dragged off-grid token snaps; the gather re-forms on the grid.** With
    step 18's tokens out, a real Player seat drags the off-grid one a cell.
    *Observable:* it comes to rest on the grid (`x` and `y` multiples of the
    grid size) and not where it started. End the fight: the party token shows
    and stands on a cell corner. Clear the overrides, set the frontage to 1.
    Off-grid readers: the leash and the mapper read token centres and distances
    and take an off-grid token as it stands; no module code reads a token's cell
    by `x / gridSize`.
20. **An area trap reads the column as it is laid.** With step 17's figures
    but a march frontage wide enough that three abreast do not all fit between
    the corridor's walls where the head ends the move (the walk reads the
    room on each hand off the walls and the figure's pixels, and asserts fewer
    than three fit), make an area Trap Zone on the corridor (marker
    `formation/column-trap`, a rectangle over the cell one east of the head and
    the cell beside it across the corridor; a kept zone's shape is set again at
    the step's start) naming a trap Item (`formation/column-trap-item`:
    `scope` area, `triggerOn` 6 so any throw springs it, resolution none so the
    card holds one row per victim, level-1 `radiusFeet` the case's radius). Put
    the head at the west end facing east, set the frontage to 3, and have a real
    Player seat drag the party token one cell east into the zone. Read the trap's
    card in the GM's chat after the drag and `laidOrder` (`formation-model.mjs`)
    with the head where the move ended: the zone is the corridor's only part where
    the squeeze holds, since the open ground at the corner seats all three abreast.
    Walk two radii in feet, 1 and 2, re-arming the zone and putting the head back
    between them.
    *Observable:* `laidOrder` ranks the three bodies as many to a rank as the
    walls leave room for (the walk derives it: 0, 0 and 1 where two fit) with
    `rankFeet` the interval, where `marchingOrder` ranks all three 0. The card's Caught
    section names the bodies whose laid rank is within `floor(radius / interval)`
    of the sprung rank (the walk computes it from the rows): at radius 1 the
    first two, which `marchingOrder` would have made all three; at radius 2 all
    three, which the default depth would have made two. Switch the zone off
    after each case and track each card by id; the kept zone and trap stay.

A plate shot from the Player seat composes that seat, and compose closes its
sidebar. Core's token pan reads the sidebar's width, so the next move of a
token that seat controls throws, and the walk's error check fails at the end
with nothing to say which step did it. After each such plate, render the
hotbar and then the sidebar again; the chat log's render reaches into the
hotbar, so the other order throws too.

Teardown: the kept fixtures stay. Gather anyone deployed, set the shape and
colour back to unset, the frontage to 1, and relight both sources, so the next
walk's assertions hold. Clear the frontage overrides steps 17 to 20 set, and
sweep the weapon step 17 gave the lead and the cards step 20's trap posted. A token pasted in step 9 and the hand-lit token in step 13 are this
run's: `api.track` each id as it is made and `api.sweepTracked()` them. The
lantern bearer's token edited in step 14 is the deployed token, which the
gather removes; if it stands, reclaim it as step 14 says.

## The delve's wandering cadence (added with the imported cadence)

The encounter throw's die, the turns between throws, the target and the
encounter distance's dice arrive with the `delveEncounters` import (MODEL,
"The delve's wandering throw"). `tools/live/formation-column.mjs`
walks it. A world where Rules tables has not been run holds no
such document until it is run in Reimport One Shelf with the books open; read what arrived in the Ruledata Browser and use those figures
below.

Fixtures: `formation/cadence-party`, a party of one member on any dungeon
scene, standing in no Encounter Zone. At the start, assert both world settings
`encounterEvery` and `encounterTarget` read null, and the party's
`clock.encounterCounter` is any value.

1. On a GM seat, reload.
   *Observable:* no warning is raised on the GM seat, whether the documents are
   present or absent.
2. Advance the party one turn at a time (the Turn tool) for as many turns as
   the imported interval.
   *Observable:* exactly one wandering-monster card, on the last of them,
   naming the imported die; hover its die and its target: each tooltip says
   Imported with the page. Its roll's formula is that die.
3. Set `encounterTarget` to 1 in the module settings and press the Encounter
   throw tool.
   *Observable:* an encounter card whose distance roll's formula is the
   imported distance dice, and the rolled distance's tooltip says Imported with
   the page. Set the target back to blank.
4. Set `encounterEvery` to 1 in the module settings and advance one turn.
   *Observable:* a card on that turn; set it back to blank and the interval is
   the import's again. Set it to 0 and advance past the interval: no card.
5. In the Ruledata Browser, give `delveEncounters` an override that blanks
   `distance` (or sets it to text that is not dice), set `encounterTarget` to 1,
   and press the Encounter throw tool.
   *Observable:* an encounter card carrying the minute alone, and
   only the minute rolled. Clear the override and the setting.
6. The die-less path needs a world without the document, which the mapped test
   world is not once step 1 passes; it is pinned offline
   (`tools/test-formation-flows.mjs`, "the delve's wandering throw takes its
   cadence…"): no card is scheduled, the counter stays at 0, and the Encounter
   throw tool throws nothing and raises no warning.
7. Open `Settings tab → Game Settings → ACKS II — Extras`.
   *Observable:* no setting named "Light & noise modify encounter throws"
   among the formation settings. A hurried party and a dark one press the
   Encounter throw tool: each card's roll formula is the bare imported die,
   with no modifier after it (pinned offline in `tools/test-formation-flows.mjs`).

Teardown: set both settings back to blank and clear any override step 5 left.
After step 7, set the party's pace back to careful and the scene's darkness back.
The party is a kept fixture; the cards the turns posted are this run's:
`api.track` each card's id as the turn resolves and `api.sweepTracked()` them.

## A party actor made from the sidebar (added with the party's sight)

The party token sees, however its actor was made (MODEL §Data flow, "The party
token sees"). Setup is the subject of step 1, so its party is built fresh and
tracked. `tools/live/formation-party-sight.mjs` walks it. Every step waits on
a hook only the primary GM's window runs, and a window still joining its
seat's election answers false: act once lib's `primaryGMSettled()` resolves
true, or the creation is never adopted and nothing errors.

Fixtures: `formation/column-scene` (above).

1. **The sidebar's creation.** Core's Create Actor sends only a name, a type
   and a folder: `Actor.create({name, type: "acks-extras.party"})` is the same
   write. `api.track` the actor; the formation its `createActor` hook adopts
   is dissolved by the deletion's own hook at teardown.
   *Observable:* `actor.prototypeToken.sight.enabled` is true, and a formation
   names the actor.
2. **Its token.** Place the actor's token on the scene (`api.track` it) and let
   the adoption settle. *Observable:* the token's `sight.enabled` is true and
   it carries `flags.acks-extras.partySight`.
3. **A token placed before the fix.** Turn that token's sight off and unset
   both `partySight` and `managedVision` in one update, then make any
   formation change (rename the party) so the primary GM syncs.
   *Observable:* sight is back on and the stamp is back.
4. **A Judge's choice.** Turn its sight off by hand in Token Config and make
   another formation change. *Observable:* sight stays off.

Teardown: `api.sweepTracked()`; quote what it removed.

## A magic light (added with the Add effect control's Magic Light choice)

Steps 8 to 11 are walked by `tools/live/formation-magic-light.mjs`, with the
item sheet's tag and toggle, and the Kit row's and the header band's fit at 14
and 18 px (the frame's step 6); it adds the
fixtures `formation/magic-light-member-worn` (a member the Player owns),
`formation/magic-light-worn` (an armor on it, for `canWear`/`isWorn`) and
`formation/magic-light-world` (a world item, which shows no state tag). The
walk's Observer is the Player user taken to ownership 2 of both members. A
Player who owns no member cannot open the party sheet once the GM's ownership
sync runs, so the Observer case is driven on a sheet already open when the
ownership falls, and a fresh open expects refusal (state stays closed). Steps
1 to 7 and 12 are walked by hand on the GM seat, with the Player and Observer
seats for steps 9 and 10. A magic light is an Active Effect on an item
that writes `flags.acks-extras.magicLight.daylight`, `.bright` and `.dim` (lib MODEL,
Senses); every reach typed here is invented.

**Fixtures** (kept; found by marker, built when none carries it):

- `formation/magic-light-scene`: a room of its own, built like
  `formation/column-scene` (above). The corridor holds other recipes' lit
  columns, so `carriedLightPoints` there is never empty.
- `formation/magic-light`: a party actor, its formation seeded by the
  createActor hook (only on the window that leads its seat: an actor made
  while the seat's election is still joining is passed by, so await
  `automationSettled()` from `lib/automation-client.mjs` before building it,
  or adopt it with `adoptPartyActor`, the repair tool's adoption), its token,
  marked `formation/magic-light-token`, on `formation/magic-light-scene`
  (`actorLink: true`),
  with one member seated through the party sheet's drop (*Core drive
  mechanics*). The member carries `formation/magic-light-member`, and holds
  one gear item carrying `formation/magic-light-item` and a container carrying
  `formation/magic-light-pack` (capacity set on its sheet, so it takes the item).
- The seats: the GM seat; the Player seat that owns the member (a real Player
  seat: the GM's `isOwner` is true for every effect, so only a Player proves
  the ownership gate); an Observer seat that does not own it.

At the start: the item has no effect writing either key (a leftover one is
the fixture's own: delete it with the item sheet's own control), and the
member is inside the party token, not deployed.

1. **Add a light.** First assert the kept item's shape, which an earlier walk
   may have left stowed or unworn: it is outside every container (no
   `containedIn`) and, if `canWear(item)` is true, worn (`isWorn(item)`).
   Bring it to that shape before going on, or every light below reads Stowed.
   Then open the item's sheet, press Add Effect and choose Magic
   Light. An item with no effect yet opens in the simple view, which has no
   tab strip: the control stands beside Details. Otherwise it is on the
   Effects tab. The control shows while the sheet is locked. `api.track` the effect the
   click made (read its id from `item.effects` at once). *Observable:* one
   effect on the item, transfer on, named "Magic light", three changes keyed as
   above (daylight, bright, dim), each of type `upgrade` with an empty value, and its config sheet
   open. No console error as the actor prepares with the empty values.
2. **Not set.** Open the Party sheet's Kit tab → Light Sources. *Observable:*
   one row, the item's name and the member's, reading "reach not set" with a
   tooltip saying so, a Shining badge and, on the GM seat, a Shutter button
   (no burn or douse control). The party token's
   column holds no point (`acksExtras.formation.carriedLightPoints(scene)` is
   empty) and the member's own token, if any, has no managed light.
3. **Type the feet.** In the effect's config sheet, Changes tab, type 11 and 23
   into the bright and dim values, the daylight left blank. *Observable:* the row reads "11 / 23 ft" and its
   tooltip names the effect, the item and both reaches. One column point
   stands at the member's cell (`carriedLightPoints` has one, `bright` the
   figure in scene units) and the client light source of that bearer is steady:
   `animation.type` null, no tint. With only the bright value typed the row
   reads "11 ft bright" and shows no figure for the dim.
4. **Disable and delete.** Disable the effect from its config sheet.
   *Observable:* the row and the point are gone. Enable it again and they
   return; delete the effect with the item sheet's trash (shown only once the
   header's edit toggle unlocks the sheet) and they go again.
   (Re-add through step 1 for the next step.)
5. **A flame beside it.** With the light table imported, light a torch for the
   member from the Kit tab. *Observable:* the column point takes the larger
   bright radius and, where the torch's is larger, its flame look; with the
   effect's reach the larger, the steady look. Douse the torch before moving on.
6. **Detached.** Deploy the member out of the party token. *Observable:* the
   member's own token reads `light.bright` and `light.dim` in the scene's
   units, `light.animation.type` null, `light.color` null, and carries
   `flags.acks-extras.managedLight`; the column point is gone. Gather the
   member back and the token's light clears. The member's stash keeps its
   token between deploys, flags included, so a kept member comes back
   released by an earlier walk's step 7. Bring that one token to shape by
   unsetting its `flags.acks-extras.managedLightStamp` (the reclaim's write;
   never `migrateWorldVision({reclaim: true})`, which reclaims every scene in
   the world) and changing a figure.
7. **A hand edit.** Set that token's bright radius by hand in Token Config while
   it is detached, then re-open the effect and change a figure.
   *Observable:* the token keeps the hand's radius, and its
   `managedLightStamp` reads `{released: true}`.
8. **Stowed and taken out.** Start from the shape step 1 asserts, with the
   effect typed 11 / 23 and the member inside the party token. Store the item
   in `formation/magic-light-pack` (the equipment recipe's stow gesture: drop
   it on the pack's contents). *Observable:* the Kit row reads Stowed and dims,
   its badge tooltip names the pack, `carriedLightPoints(scene)` is empty, and
   the item sheet's effect tag reads Stowed. Take it out with the pack's Take
   Out: the row reads Shining and the point returns, with no reload. For an item
   that can be worn, take it off instead and the row reads Stowed with the
   unworn tooltip; wear it and it returns.
9. **Shutter, as the Player.** Join as the Player seat that owns the member and
   press Shutter on the row (Kit tab → Light Sources). *Observable:* the
   effect's `flags.acks-extras.lightShutter` is true and `disabled` is false;
   the row reads Shuttered and its button reads Open; the column point is gone;
   no chat card posted. Deploy the member out as the Judge and the token's
   managed light is gone too, with the effect still applied (`appliedEffects`
   holds it). Press Open: the point and the token's light return and the flag is
   cleared, not written false.
10. **An Observer has no button.** Join as the Observer seat, which does not own
    the member. *Observable:* the row shows its state badge and tooltip and no
    Shutter or Open button; `setLightShutter(effect, true)` called from that
    seat returns false and writes nothing.
11. **The shutter outlasts the pack.** Shutter the light, store the item, then
    take it out. *Observable:* stowed, the row reads Stowed whatever the shutter
    says and the point is gone; taken out, it reads Shuttered, not Shining, and
    the point stays gone until Open. The item sheet's own toggle writes the same
    flag (docs/equipment/TESTING.md, "Effects").
12. **On the actor.** Delete the item's effect and place an effect of the same
    shape on the member's actor directly. *Observable:* the same row, now
    labelled with the effect's name, and the same point; an effect on the actor
    shines whatever the pack holds, and its shutter works the same.
13. **The dark and the pace.** With the light shining and a reach typed, set
    the scene's darkness to 1 and give the member the Mapper role; no flame is
    lit and no member sees in the dark. *Observable:* `isPartyInDark` false,
    `partySpeed` above `partySpeed(record, {dark: true})`, the party sheet shows no Darkness and no "No light" warning,
    and the mapping verdict reads `litBy` `light`. Shutter it: `isPartyInDark`
    true, the slowed pace and both warnings return. Put the darkness and the
    role back.
14. **Daylight alone.** Clear the bright and dim values and type 7 into the
    daylight value. *Observable:* the row reads "7 ft daylight" with no other
    figure; `effectLight(member)` is `{daylight: 7, bright: 7, dim: 0}`; the
    column point stands with `bright` 7 in scene units; with darkness 1 and
    the Mapper role, the mapping verdict reads `litBy` `light` for a mapper
    within 7 ft and `isPartyInDark` is false. An effect made before the band
    existed (two changes, no daylight key) reads exactly as it did.

Teardown: leave the effect open (Open, so the flag is cleared), the item out of
the pack, and `api.sweepTracked()`; quote what it removed. The effect each Add
light made is in the ledger from step 1; the kept fixtures are left with no
effect on them.

## Teardown

`api.sweepTracked()` over the ledger: the scene, the party actor (its
formation goes with it), the member actors and the trap item were all
`api.create()`d, so they are already in it. Confirm `getFormations()` no longer
lists the formation. The chat cards a trap probe posts are not — the module
creates them — so read each card's id back right after your own probe (the
newest `game.messages` entry, or the message the probe returns) and
`api.track(id, "ChatMessage")` it at once; the sweep then takes the cards with
the rest. Never find them by content or name.

## The mapper (added with the mapping verdict)

Whether a party is mapping: `docs/formation/MODEL.md`, "Mapping". Walked by
`tools/live/formation-mapper-mapping.mjs` from the GM seat and the Player seat.
Offline, `tools/test-mapper.mjs` pins the verdict and `tools/test-strip.mjs` the
warnings. The walk never calls the environment sync: each step is a real write
(an effect, an item, a status, a setting, the scene), and what the sync reads
afterward is the observable, so a write the hooks in `module.mjs` do not catch
shows as a verdict that never moves. Step 10 holds the mapper's Vulnerable
condition (`scripts/formation/mapper-kit.mjs`, `mapper-kit-logic.mjs`,
`lib/held-condition.mjs`, the `mapper kit` step of `runEnvironmentSync`)
against the real tracker; `tools/test-mapper-vulnerable.mjs` pins its verdicts
and the held-effect writes. The GM seat is the active GM and its window must
run the automation (read `primaryGMSettled()` first).

**Fixtures** (kept; found by marker): scene `formation/mapper-lit-scene` (5 ft
cells, dark, fog on its own mode), party `formation/mapper-lit-party` with its
adopted token, characters `formation/mapper-lit` (the mapper, first in the
column) and `formation/mapper-lit-bearer` (one cell behind, carries the light).
The walk's own ledger holds the magic-light effect, the Mapping ability, the
status effect, the Map item a session opens and the cards the sync posts; the
Map item and the cards are found afterward by the mapper and by the scene's name
inside the run's window, and swept by those ids. Built where absent: the party
token (`api.create`, tracked). Step 10 builds, per run, a linked token on the
scene for each character and one Combat, all `api.create`d and tracked. The
party's `mapSession` is set to null at the start and the end.

**Settings** the walk flips, each read first and put back in a `finally`:
`manageFog`, `fuzzMeasurement`, `mapperNeedsLight`. It also writes the scene's
darkness and fog mode and the mapper's role, and puts them back.

1. **No light.** Dark scene, fog management off, no light on either character.
   **Observable:** on the GM seat the verdict is not mapping with block `dark`,
   one working mapper and none lit; the scene's `measure` flag reads `unknown`
   on both seats although fog management is off; the strip names no light
   reaching the mapper on both seats; the proficiency warning shows on the GM
   seat and not on the Player seat.
2. **A magic light in reach.** An effect on the bearer writing the bright
   radius key, an invented reach covering one cell. **Observable:** mapping,
   `litBy` `light`, flag `fuzzy` on both seats (no proficiency), no light
   warning.
3. **Out of reach.** The same effect with a reach under one cell.
   **Observable:** `dark` again and `unknown`; back in reach, `fuzzy`.
4. **Shuttered.** `setLightShutter(effect, true)`. **Observable:** the flag
   returns to `unknown` with no other write, so the light-moving hooks carry it.
5. **The day.** Scene darkness 0 with the light still shuttered. **Observable:**
   `litBy` `ambient`, `fuzzy`; darkness 1 again returns `unknown`.
6. **The proficiency.** The light open, then an ability named for Mapping on
   the mapper. **Observable:** the flag `off` on both seats and the Judge's
   warning gone. With the light shuttered again the party still reads not
   mapping (light is its own check). Delete the ability: `fuzzy`.
7. **The Judge's switch.** Shutter the light, set `mapperNeedsLight` off.
   **Observable:** mapping, `litBy` `assumed`, `fuzzy`, no light warning; on
   again, `unknown`.
8. **A mapper who cannot work.** Toggle `dead` on the mapper. **Observable:**
   block `down`, zero working, `unknown`; the strip says the mapper cannot work
   the kit and does not say no light reaches them; lifting `dead` returns
   `fuzzy`.
9. **The fog.** Fog management on, scene dark, the light shuttered.
   **Observable:** the scene's fog mode is disabled, the management flag keeps
   the original mode, the cards naming the scene went to the GMs alone and none
   to the table; the light open again, the fog is back. Close the session the
   sync opened (`mapSession` null) and track the Map item.
10. **The role held through a fight.** With the mapper's role on, a linked token
    for the mapper and one for the bearer on the scene, and a Combat holding
    both (the bearer's initiative above the mapper's; `api.create` for the
    Combat and the two Combatants, initiatives written). The tracker moves with
    `combat.update({round, turn})`, where `turn` is the index of a combatant in
    `combat.turns`, which is what core's own turn update writes; `startCombat`
    opens dialogs and is not used. Statuses by hand are
    `toggleStatusEffect(id, {active})`, and the effects they leave are tracked.
    Surprise is lifted by hand while the bearer is up, since the system lifts it
    as a round turns over. The role is the model's `patchFormation` write
    beneath the party sheet's control, because the sheet's `toggleRole` equips
    a kit onto the actor.
    **Observable:** one effect on the mapper under the fixed id
    `heldMapperKit001`, marker `heldCondition = "mapperKit"`, carrying the
    `vulnerable` status, shown by the actor and its token. Mapper surprised:
    held on round 1 with the mapper up, with no stash mark on the Combat.
    Surprise lifted, round 2 on the bearer: still held, no stash mark. Round 2
    on the mapper: the effect is gone from the actor and the token and
    `flags["acks-extras"].kitStashed[<mapper id>]` is set; round 3 leaves it
    gone. Delete the Combat: the effect returns, one, under the fixed id.
    Toggle `dead`: the effect is gone; lifted, it returns. Role set down: gone
    from the actor and the token. A Vulnerable toggled by hand with the role
    down stands with no marker; taking the role adds the marked effect beside
    it; setting the role down removes only the marked one and the status stays
    on.
- Console: a recorder attached before the GM seat's reload reads `init`,
  `setup` and `ready` clean of any error naming mapping, the mapper or the
  environment sync, and the page's own error listener sees none across the walk
  (a message naming the held condition or the stash counts).

**Teardown.** `api.sweepTracked({only})` over the run's effect, ability, status
effects, Combat, step 10's tokens, Map items, cards and party token. The
fixtures stay. The settings, the scene's darkness and fog mode and its
management flag, and the mapper's role are put back.

## New Map resets the scene's fog

Fixtures: the mapper fixtures above (`formation/mapper-lit-*`) with a
Mapper working and fog on the scene's SHARED mode, and a second seat joined as
a Player who owns a party member. Teardown: `api.sweepTracked()` over the Map
items the walk's sessions opened; the party's `mapSession` is closed.

1. As the Judge, view the scene and walk the party so both seats have explored
   some of it. Note the Player seat's `FogExploration` count for the scene.
2. **Party sheet → Kit tab → New Map**, then confirm. *Observable:* every
   seat's fog redraws black but for what the party sees now; the scene's
   `FogExploration` documents were deleted (read them from the server, not the
   Judge's cache); the new Map item's first archive holds none of the old
   exploration; the old item keeps its own record, inactive. Core's reset runs
   from the Judge's client: if the Player seat keeps the old fog after the
   redraw, the reset did not reach the server (`canvas.fog.reset` on core 14 is
   unread offline).
3. Start a combat with the party. *Observable:* the New Map button is disabled;
   calling `startMapSession` from the console warns and leaves the working
   map, the fog and the item list as they were. Leaving combat re-enables it.

## Jumping, the fall, the Spelunking table and the street's dice (imported)

The figures arrive with the tables import: `jumping`, `fall` and `spelunking`
in the `formation` document from the Revised Rulebook (RR pp. 268, 270, 271),
and `dice` in the `cityTravel` document from the Judges Journal (JJ pp. 80,
81). MODEL, "The delve's printed figures" and "The city". A world where Rules
tables has not been run holds none of them until it is run in Reimport One
Shelf with both books open. Read what arrived in the Ruledata Browser
(`Settings tab → Game Settings → ACKS II — Extras → Open Ruledata Browser`) and
use those figures below, never a number from memory.

Fixtures: `formation/imported-climber`, a plain character actor with no
climbing proficiency, built with `api.fixture` when no document carries the
marker; `formation/imported-city-party`, a party of one member standing on a
scene declared a settlement, built as the city section above builds its party
and found by this marker (its pace and place re-asserted at the start of
step 6).

1. **The import reads them.** With the books open, run Rules tables.
   *Observable:* `acksExtras.lib.tables.getDoc("formation").tables.jumping`
   holds eleven keys, among them `acrobaticsDexCap`, a whole number, and
   `extendedDexBands`, ascending `{min, max, mod}` rows of whole numbers (the
   `acksExtras.formation.jumping` readers `acrobaticsDexCap()` and
   `extendedDexBands()` answer the same), `.fall` two, and `.spelunking` a
   stretch and six obstacle entries, each a number or `false`, beside `vulnerable`, a boolean per
   obstacle, and `botchBand`, a `{min, max}` of whole numbers per obstacle (the
   `acksExtras.formation.obstacles` readers `obstacleVulnerable(kind)` and
   `botchBand(kind)` answer the same); `getDoc("cityTravel").tables.dice`
   holds `street` and `incident` as `NdM` strings. Count the agreement against
   the pages named above with the book open and report it as a count of
   figures, never the figures.
2. **Jumping and the fall act on them.** In page context call
   `acksExtras.formation.jumping.jumpDistance({dex: 12})`, `leapHeight({mod: 2})`
   and `landingFailure("empty", 40)`.
   *Observable:* `jumpDistance` returns numeric `min`, `max` and `average` with
   `unknown` empty and `die` the imported die; the leap a number; the landing
   `shortBy` the imported die and `damage` an `NdM` string whose count follows
   the imported rate (the sum of dice for 40 feet against the imported feet
   per die).
   **The leap reads the raised score.** Call `leapHeight({dex: 12, mod: 1,
   acrobatics: true, level: 5})` and `leapHeight({dex: 12, mod: 1})`, then once
   more with a `level` high enough that the raise reaches the imported
   ceiling. *Observable:* the first reports `dex` as the raised score and
   `bonus` as the imported band's figure for that score (or, for a score under
   the lowest band, the system's own modifier for it), where the second keeps
   the sheet's `mod`; the third reports `dex` equal to the imported ceiling and
   the band's figure for it. `unknown` is empty in all three. The raised leap's
   `feet` follows its own `bonus`, not the sheet's.
3. **An obstacle attempt throws what the table says.** Run
   `acksExtras.formation.obstacles.attemptObstacle([{actor}], {kind: "easyClimb", feet})`
   with the climber, for a length of two stretches, then `kind: "sheerClimb"`.
   *Observable:* a Judge-whispered card, up to one throw per stretch against the
   imported target for the first (a miss that covers no ground stops it, step 2
   of the next section), and the climber listed as unable to attempt
   the second when the table says none may try. Nothing reaches a player seat.
4. **Absent stays blank.** In the Ruledata Browser, give `formation` an
   override that blanks `spelunking` (as step 5 of the delve's wandering
   throw does for its distance), and repeat step 3.
   *Observable:* the card lists the climber's name as unable, with no reason
   beside it, and the chat log gains no roll;
   `jumpDistance({dex: 12})` is unchanged while `fall` is untouched.
   `obstacleVulnerable(kind)` and `botchBand(kind)` answer null for all six
   kinds. Clear the override.
   **Blanked Acrobatics figures stay unknown.** Give `formation` an override
   that blanks `jumping`'s `extendedDexBands`, and repeat the raised leap.
   *Observable:* `feet` and `bonus` are null with `unknown` naming
   `extendedDexBands`, no card or toast says so, and the leap with no raise is
   unchanged. Blank `acrobaticsDexCap` as well and repeat it: `dex` is null
   and `unknown` names `acrobaticsDexCap`; `jumpDistance` for the same
   acrobat names it too, and passing a `dexCap` argument answers it. Clear
   the override.
5. **An override wins, and reverts.** Give `spelunking` an override whose
   stretch is one the Judge picks, and repeat step 3 for a length of that
   figure.
   *Observable:* one throw. Clear the override and the imported stretch is
   read again.
6. **The street's die.** On the city party, press the Turn tool until the
   turn owes a street throw (the card's "Threw … on <die> against … +" line).
   *Observable:* the line names the imported street die, and hovering it says
   Imported with the page it was read from (JJ p. 80). Blank `dice` in the
   Ruledata Browser (`cityTravel` document) and take another turn: no throw is
   made and the card says the die the street's encounter is thrown on is not
   imported. Set the party holed up and advance the world clock a few days with
   `dice` still blank: the stay card says the same, lists no day as undisturbed
   and draws no incident. Clear the override. Not walked offline: the turn
   card's tooltip (the stay and the not-imported cards are pinned in
   `tools/test-formation-flows.mjs`).
7. **The incident die.** Probe `acksExtras.formation.settlement.incidentDie()`.
   *Observable:* it equals the Ruledata Browser's `dice.incident` as an `NdM`
   string (JJ p. 81), and null with the table blanked. An incident drawn for a
   met day on a map list that names no formula of its own totals within that
   die's faces, plus the after-dark shift by night; a RollTable's own formula
   wins where it has one.
8. Console: a recorder attached before the GM seat's reload reads `init`,
   `setup` and `ready` clean of any error naming jumping, obstacles or the
   city dice, and the page's own error listener sees none across the walk.

Teardown: clear every override steps 4 to 6 set. `api.track` each card's id as
the turn resolves and `api.sweepTracked()` them; the fixtures stay.
Pinned offline: `tools/test-jumping.mjs`, `tools/test-obstacles.mjs`,
`tools/test-formation-binding.mjs`, `tools/importer/test-land-tables.mjs`,
`tools/test-settlement.mjs`.

## The Spelunking outcomes, imported (added with T-0516)

What a failed and a botched throw cost at each obstacle is the `formation`
document's `spelunkingOutcomes` table (RR p. 268), per obstacle `fail` and
`botch`, each `{text, falls}` and, where the cell decides it, `advances`.
Compare with
`o = acksExtras.lib.tables.getDoc("formation").tables.spelunkingOutcomes`;
no outcome's words enter the report, only counts.

Fixtures: `formation/imported-climber` (above). Proficient throws are driven
with `{proficient: true, classThrow}` so the target is the walk's, and the
dice rig (`CONFIG.Dice.randomUniform`, set and restored by the walk) picks a
miss and a natural 1.

1. **The import reads them.** Run Rules tables with the Revised Rulebook open.
   *Observable:* `o` holds six obstacles, each with `fail` and `botch` carrying
   non-empty `text` and a boolean `falls`, and `advances` a boolean or absent
   per cell, never any other type; the Ruledata Browser lists the raw
   `spelunkingOutcomeGrid` beside it; `t.citeOf("formation",
   "spelunkingOutcomes")` (`<cite>` below) names the page. Count the cells
   agreeing with the page, book open, and report the count.
2. **The card acts on them.** `attemptObstacle([{actor, proficient: true,
   classThrow: 20}], {kind: "easyClimb", feet})` for two stretches, rigged to
   miss: then rigged to a natural result inside `s.botchBand.easyClimb`, where
   `s = acksExtras.lib.tables.getDoc("formation").tables.spelunking`, and to
   one just outside it.
   *Observable:* the miss prints `o.easyClimb.fail.text` and throws the second
   stretch only when `o.easyClimb.fail.advances` is true and
   `o.easyClimb.fail.falls` is false; with `advances` false or absent it stops
   after one throw, the member's row has `across: false`, `covered: 0`, and the
   card says how many stretches were covered. Where it advances, the
   attempts' `step` reads `covered`, then `across`. The result inside the band
   prints `o.easyClimb.botch.text` whatever the total reaches and, `falls` true,
   throws no further stretch (`step` `fell`); the result just outside it, at a
   total under the target, prints `o.easyClimb.fail.text` and the read's
   `botch` is false. Every read's `vulnerable` is `s.vulnerable.easyClimb`.
   Hovering the outcome shows `Imported (<cite>)`.
3. **Not imported.** In the Ruledata Browser give `formation` an override that
   blanks `spelunkingOutcomes`, and repeat the rigged miss.
   *Observable:* one throw only; the card prints "missed", with no tooltip;
   nothing else is applied. Then blank `spelunking` instead (no stretch is
   known, so the attempt is not thrown) and read a throw directly:
   `acksExtras.formation.obstacles.readThrow({plan: obstaclePlan({kind:
   "easyClimb", proficient: true, classThrow: 5}), natural, total})` with the
   band's lowest result as `natural` and a total over the target. The read's
   `botch` is false and `success` true, since no band is known, and its
   `vulnerable` is null. Clear the override.
4. **An override wins, and reverts.** Override `spelunkingOutcomes.easyClimb.fail`
   with words of the Judge's own and `falls: true`, and repeat the rigged miss.
   *Observable:* the card prints the Judge's words, the tooltip says `Set by a
   Judge's override`, and the climb stops after the one throw. Clear the
   override: the imported words and page return.
5. **Teardown.** Clear every override; `api.track` each card's id as it posts
   and `api.sweepTracked()` them; the fixture stays.

## The grid's rates of progress, imported (dungeon close-out S17, first half)

The `formation` document's `spelunking.progress` table (RR p. 268) holds per
obstacle `{success, fail}`, each `{share, speed}`: a ratio of the member's
`combat` or `run` speed. `fail` is present for one obstacle only. The crossing
reads it only through "Rounds a crossing spends" below, so this section is a read of the
import and of the reader `acksExtras.formation.obstacles.progressRate`, and no
card or row changes. Compare with
`s = acksExtras.lib.tables.getDoc("formation").tables.spelunking`; no cell's
words or fraction enter the report, only counts.

Fixtures: none beyond the world's own import; an override is set and cleared
by the walk.

1. **The import reads them.** Run Rules tables with the Revised Rulebook open.
   *Observable:* `s.progress` holds six obstacles, each with a `success`
   carrying a `share` above zero and a `speed` of `combat` or `run`; exactly
   one obstacle carries a `fail`, of the same shape; the Ruledata Browser
   lists the raw `spelunkingGrid` (its success rows beside the others) and
   `spelunkingOutcomeGrid`; `citeOf("formation", "spelunking")` names the page.
   Count the cells agreeing with the page, book open, and report the count.
2. **The reader answers the table.** Call `progressRate(kind)` for each of the
   six kinds and `progressRate(kind, "fail")` for each.
   *Observable:* the first six equal `s.progress[kind].success`; the second six
   are null except the one obstacle that carries a `fail`, which equals it.
3. **Not imported.** In the Ruledata Browser give `formation` an override that
   blanks `spelunking`, and repeat step 2.
   *Observable:* all twelve answers are null. Clear the override.
4. **An override wins and must be valid.** Override one kind's
   `spelunking.progress.<kind>.success` with a share of the Judge's own and a
   named speed, then with a share of zero, then with a speed other than
   `combat` or `run`.
   *Observable:* the first answers the Judge's pair, the other two answer null.
   Clear the override: the imported pair returns.
5. **Teardown.** Clear every override.

Pinned offline: `tools/test-formation-binding.mjs`, `tools/test-obstacles.mjs`,
and `tools/importer/test-recipe-content.mjs` against the local book.

### The paces' speeds and a miss's duration, imported (dungeon close-out S17, the imports of its round-spending half)

The same Rules tables run also reads three more keys of the `formation`
document, `climbPaceRates`, `crawlPaceRates` and `balancePaceRates` (RR pp.
269-270), each `{normal, faster, fastest}` of `{share, speed}` with `speed` one
of `exploration`, `combat`, `run`; and a `rounds` count on the outcome cells of
`spelunkingOutcomes` that print one. The crossing reads both only through "Rounds a crossing spends" below, so
this section is a read of the import and of the readers `paceRates` (`climb-pace.mjs`) and
`acksExtras.formation.obstacles.obstacleOutcome(kind, which).rounds`. `paceRates`
is not on the api: reach it from the page with
`const { paceRates } = await import("/modules/acks-extras/scripts/formation/climb-pace.mjs")`,
which is the instance the module loaded. No cell's words or figure enter
the report, only counts.

Fixtures: none beyond the world's own import; an override is set and cleared by
the walk.

1. **The import reads them.** Run Rules tables with the Revised Rulebook open.
   *Observable:* each of the three keys holds `normal`, `faster` and `fastest`
   with a `share` above zero and a `speed` of the three names, `normal` always
   `exploration`; the Ruledata Browser lists a row for each key and
   `citeOf("formation", key)` names the page its paragraph prints on (269, 269,
   270). Count the keys whose three paces agree with the paragraph, book open,
   and report the count.
2. **The durations.** Read `obstacleOutcome(kind, "fail")` and `"botch"` for the
   six kinds. *Observable:* `rounds` is present only on the cells that print a
   count before a round noun, a positive integer; count them against the grid
   and report the count.
3. **Not imported.** Override the three keys with `null` in the Ruledata Browser
   and read `paceRates` for each of the six kinds. *Observable:* a rappel
   answers null; every other kind answers three null paces. Clear the override.
4. **An override wins and must be valid.** Override one pace with a share of the
   Judge's own and a named speed, then a share of zero, then a speed outside the
   three. *Observable:* the first is read, the other two answer null for that
   pace and leave the others. Override a cell's `rounds` with a non-integer: the
   outcome carries none.
5. **Teardown.** Clear every override.

Pinned offline: `tools/test-formation-binding.mjs` (both parsers, the three
recipes' windows on invented prose), `tools/test-obstacles.mjs`,
`tools/test-crossing.mjs` (`paceRates`) and `tools/importer/test-recipe-content.mjs`
against the local book.

## Billing at the dark rate

The clock bills a party token's wall-constrained displacement, and a party
that is in the dark with no light travels at the dark rate (`isPartyInDark`
into `effectiveSpeed` into `turnDistance`). No walk drives this section or the
next: both are by-hand passes, run when a change touches the dark-rate billing
or the light's reach to a second seat.

**Fixtures** (kept, by marker): `formation/t0361-delve@t0363`, an own-tag
copy of the delve replica (a second ledger connected with `own: "t0363"`
builds it; the plain marker is the importer recipe's, which is neither dark
nor walled): a square 70 px grid at 10 ft, `tokenVision: true`,
`environment: {darknessLevel: 1, darknessLock: true, globalLight: {enabled:
false}}`, one vertical wall across the party's row about four cells east of
where the party token stands, and the battlemap flag `mapSystem: "delve"`.
`formation/t0361-party` with `formation/t0361-a` and `-b` are the importer
recipe's ("A held plan's travel system"). The party token is a create path:
track it and sweep it.

1. **The imported level, read only.** Find every scene whose
   `flags["acks-extras"].cookbook.id` is the level's map id, by the id and
   never by the scene's name, and read `environment.darknessLevel`. Nothing is
   written. *Observable:* the figure per scene; at 0.5 or more the level is
   dark for `sceneIsDark`.
2. **The dark move.** Place the party token on the replica and wait for the
   record to adopt it (`tokenId`), then zero the clock with its baseline at
   the token's `_source`, no lights, mode `delve`. View the replica on the GM
   seat (`tok.object` exists only while the scene is drawn, and core
   constrains a move on the client that draws it). Update the token 12 cells
   east with `{animate: false}` and wait for `clock.lastPosition` to follow
   `_source`. *Observable:* the displacement is above 0 and under what was
   asked, `isPartyInDark` is true, and the rounds billed (`turnsTotal`
   times rounds-per-turn plus the change in `roundsPartial`) and `carryFeet`
   equal what the clock's own loop yields from the displacement at
   `turnDistance / rounds-per-turn`, both read off the module.
3. **The lit control.** Light a torch (`acksExtras.formation.addLight(record,
   "torch", memberId, {override: true})`, which spends a round, so read the
   snapshot after it) and move the token 4 cells back west. *Observable:* the
   party is not in the dark, its `effectiveSpeed` is above step 2's, and the
   billed rounds and carry equal the same computation at the lit round length.

Teardown: sweep the token and the party's cards by their ids; clear the
party's lights. The replica, the party and the walkers stay.

Walked 2026-11-13: the imported level read darkness 1, locked, so the original
reading (a lit level billed at the lit rate) did not hold: the party was in the
dark and the clock billed the constrained displacement at the dark rate, rounds
and carry equal to the clock's own loop; the torch control billed at the lit
rate the same way.

## A light change reaches both seats

A shutter, an open, a douse and a relight are one write and one
`updateSetting` handler on every seat (`column-view.mjs` `installColumnView`
into `column-light.mjs` `syncColumnLights`); each seat's canvas should drop or
make the column's source in the same task that handles the broadcast. The
earlier walk slept after the click and then polled the GM and the Player in
turn, so it measured neither seat's latency from the click.

**Fixtures:** the column's (above, "The column and its lights"):
`formation/column-scene`, `formation/column-party`, `formation/column-lead`,
`formation/column-torch`, `formation/column-lantern`. The party sheet is open
on the GM seat's Kit tab; the Player seat views the corridor.

**The recorder.** Armed on each seat after its page is ready, it wraps
`foundry.canvas.sources.PointLightSource.prototype` `add`, `remove` and
`destroy` for source ids that start `acks-extras.column.`, and logs the
formations setting's `updateSetting`, long tasks, timer gaps over 400 ms, and
the page's visibility, each stamped `performance.timeOrigin +
performance.now()`. Both seats run on one machine, so the stamps share a
clock; across machines swap in `game.time.serverTime`. The press on the GM
seat records its own stamp, and a seat's latency is the first matching event's
stamp minus the click's, so no seat's polling interval enters the figure.

1. **Cold, removal first** (three times). Press the lantern's Open and the
   torch's Relight until both are lit and open, reload the Player seat through
   its CDP target (the boot recorder goes in first), view the scene, wait 1.5 s
   and arm. *Observable:* the Player draws both sources. Then press, 1.5 s
   after each seat has shown the last: Shutter, Douse, Relight, Open.
2. **Cold, add first** (three times). With the lantern shuttered and the torch
   doused, reload and arm as above. *Observable:* the Player draws neither
   source. Then press Open, Relight, Shutter, Douse.
3. **Settled.** Both lit, reload, wait 30 s, arm, and press Shutter, Open,
   Douse, Relight, twice.

*Observable:* per press, the GM's and the Player's latency from the click to
the source's `add` or `remove`, and the Player's `updateSetting` latency. The
lag is the Player's landing minus the GM's, since the write's own round trip is
in both. Each press also records the Player page's age, the long tasks and
timer gaps around it, and the long animation frames' script sources. The
medians are tabled by cold (the first press after the reload), later and warm
(settled), each for removals and adds. Reading them: removals late wherever
they come and adds prompt is a direction effect (trace `refreshColumn` and
`syncColumnLights` for the trigger); the cold presses late in both directions
and the rest prompt is the first action after a reload; late presses in both
directions that carry long tasks and stop once the page has settled are a busy
Player main thread, which holds a queued broadcast until the task ends;
everything prompt means the module lands each change on time. A late Player
`updateSetting` with no long task or timer gap around it is delivery, outside
the module.

Walked 2026-11-13: the first press after the reload and every press from about
35 s of page age on landed within about 20 ms of the GM's; the presses between,
at 19 to 34 s of page age, trailed by 2.3 to 7.3 s, removals and adds alike,
each beside 1 to 6 long tasks of 1.4 to 10 s on the Player (their long
animation frames name only the socket library's event dispatch). So the walk
should press only once the Player page has gone a second without a long task.

Teardown: both lights lit and open, the sheet closed; the fixtures stay.

## Summons in the party (added with summons as members)

Built for a summoning cast's creatures marching in their summoner's party
(MODEL, "A summon is a member under an id of its own"; character-sheet MODEL, "Summons go through
spells"). A mock cannot prove that a real stash and restore keeps a creature's
`summonedBy` and cast record in its delta, that the Player seat's placement has
finished before the GM stashes, or that the party cell, the cast menu and the
cast's end card reach a creature that is no token on the scene.

`tools/live/formation-summons.mjs` walks it on the GM and Player seats.

**Fixtures** (kept; found by marker with `api.fixture`): the character-sheet
recipe's `summons/spike-source`, `summons/stranger` and `summons/scene`
("Summons from a Player seat"), and six of this section's own. The spike
source carries the Player seat's Observer level (a cast summons only what the
casting seat may observe); this walk writes `ownership.<Player's user id>` 2
on it from the Judge seat, reads it back on the Player seat and asserts it
before the summoners' spells are shaped, because a kept fixture is returned
unchanged. Its summoners
are not that recipe's `summons/summoner`: a summoner kept in a party has every
creature it places on the scene gathered, which would empty that walk's field.
- `summons/summoner-a` and `summons/summoner-b` — `character`s the Player
  seat owns, spells enabled, both members of `summons/party`.
- `summons/spell-named-a` and `summons/spell-named-b` — a summoning spell on
  each, naming `summons/spike-source`.
- `summons/party` — an `acks-extras.party` actor whose formation holds both
  summoners, delving.
- `summons/party-token` — that party's token on `summons/scene`, the
  summoners stashed inside it. Step 9's disband deletes both; the walk builds
  them again and marks the new ones.

At the start the party holds the two summoners and no summon members; a
summon member a past run left is dismissed through the cast menu before the
walk.

**Steps, from the Player seat** (a real Player user; the GM seat moves the
clock and starts the combat):
1. Summoner's sheet → cast column → *Cast* the named spell, count 2, place
   both. *Observable:* no creature token stands on the scene; the party
   record holds two members with distinct `actorId`s and `baseActorId` the
   creature's world copy, each `tokenData.delta` carrying `summonedBy` and the
   Player's ownership; the Magic tab reads "2 standing".
2. GM starts a combat with the party token. *Observable:* the deployed
   creature tokens carry the same delta flags, ownership and hit points.
3. Recall; Party sheet → the hit-point tool on one stashed creature.
   *Observable:* only that member's stash changes.
4. `summons/summoner-b` casts its spell for the same creature. *Observable:*
   the summoner's cast menu Dismiss removes its own two and leaves B's two.
5. Deploy, delete one of B's tokens by hand, recall. *Observable:* the
   deleted creature's member record is gone and nothing restores it.
6. Bring one of B's creatures to 0 hit points, stashed (the hit-point tool)
   and deployed. *Observable:* each is removed as a dismissal removes it: no
   member record, no token, never counted as a casualty or carried.
7. GM moves the clock past the named spell's duration. *Observable:* the end
   card counts the held creatures; its Dismiss, answered Yes, empties them.
8. B leaves the party (summons restored on the scene with their flags), then
   rejoins. *Observable:* its creatures are gathered back in.
9. Disband. *Observable:* every member restored, creatures with their flags.
10. Drop the creature's world copy on the party sheet. *Observable:* refused,
    with the warning; a creature token of a caster outside the party is
    refused too.

**Teardown.** The fixtures are kept, the party re-formed with the two
summoners and no summon members. Delete only what the run's ledger names: the
creature tokens it placed or restored, the cast and end cards it posted, and
a world copy where none stood before.

## The crossing (added with S7 of the dungeon close-out; the jump attempt with S19)

Built for the party sheet's Dungeon tab section "The crossing" (MODEL, "The
crossing"): the party's way over one obstacle or gap, a member at a time. A
mock cannot prove that the partial draws for each seat, that a press keeps the
tab's scroll and returns focus to the pressed row's button (or, once the press
takes the member across and the button is gone, to the row itself), that a throw's card
reaches the Judges alone, or that two seats see one crossing. Path: Actors
sidebar → party sheet → Dungeon tab → The crossing.

Before the first step the Rules tables must be imported in the test world: the
walk reads the stretch, the Adventuring column, the outcomes with `advances`,
the Spelunking grid's `vulnerable` and botch band, the fall dice and the
jumping figures, and a standing import from before those keys existed holds
none of them. Without them step 6 passes on the absent-figure path and proves
nothing.

**Fixtures** (kept; found by `flags.world.fixture` with `api.fixture`). Seats:
the GM; the Player seat that owns the adventurer; one seat that owns nobody.
The walk writes the party fixture, so with a peer on this surface it connects
with `own: <tag>` and every marker below becomes `<marker>@<tag>`.
- `formation/crossing-party` — a party actor in Dungeon mode with its token on
  a scene, holding the four members below.
- `formation/crossing-adventurer` — a character the Player seat owns, with no
  Climbing.
- `formation/crossing-climber` — a character holding the world's imported
  Climbing, added from the imported library as a user adds it.
  (`formation/imported-climber`, kept by "Jumping, the fall, the Spelunking
  table", is a plain character with no proficiency, whatever its name.)
- `formation/crossing-acrobat` — a character holding the imported Acrobatics.
- `formation/crossing-beast` — a monster actor, which carries no Adventuring
  field. It is a member of the party the way a hireling is.

**Drive mechanics.**
- Begin is the pick and the button, in that order: set the select
  `[data-pick="crossing-kind"]` and press `[data-action="crossingBegin"]`. The
  pick has no `name`, so it is no part of the form's submit.
- A setup field submits on change: set the input's value and dispatch a
  bubbling `change`, then wait for the render. Read the result from the flag,
  `game.actors.get(partyId).getFlag("acks-extras", "crossing")`, not from the
  field.
- A throw is the row's own button,
  `[data-action="crossingThrow"][data-actor-id="<id>"]`, clicked. The die is
  rigged with `CONFIG.Dice.randomUniform`, which reads from the top on core 14:
  0.025 throws a 20 and 0.975 a 1. Restore it in a `finally`.
- The jump's presses are `[data-action="crossingAttempt"]` and
  `[data-action="crossingClimbUp"]`, each carrying `data-actor-id`. The
  jump die rolls through `Roll` too, so the same rig reads it: the imported
  die's top face is 0.025 and its first 0.975. Setting the gap to the row's
  range top less the slip rigged puts a failed landing exactly on the edge.
- The press returns nothing to the page, so a card is found as the messages
  that appear across it (the set of `game.messages` ids before and after),
  each of which the run `api.track`s by uuid. A card is a whisper to the GMs
  from the party's name.
- A seat's DOM is read from that seat's own pane; a GM pane reads a Judge's
  section whatever it is told to impersonate.
- Focus is read from `document.activeElement` of the sheet's own document
  after the render settles, with the sheet's `element.ownerDocument` for a
  detached window.

| # | Step | Observable |
|---|---|---|
| 0 | Re-import the Rulebook's tables in the test world | `advances` on an outcome cell, `vulnerable` on the grid, the Acrobatics cap and bands, each read back through `formationValue` |
| 1 | Assert the start: no `crossing` flag, the four tables present | End the crossing if one stands |
| 2 | The GM begins a sheer climb with a length | Rows on both seats; the easy-climb and rappel kind labels bare, the two ledge labels keeping the word that tells them apart; each figure's tooltip in its shape (a target's source with its base figure, then its parts with their pages and the Judge modifier, ending on the Spelunking page where no part names one; a stretch count's page, the outcome's provenance); the beast's target blank, its tooltip the page reference |
| 3 | The player's seat | The setup fields are in the DOM, since the seat owns the party actor (a seat that owns neither the party nor a member has none; "The crossing, Search here and the Trapbreaking modifier on a Player seat"); the adventurer's Throw drawn where the grid allows it and, where it refuses, absent with the reason as text on the row; the Climbing holder's Permitted cell reads "May try" (never blank) with a tooltip naming the kind, the proficiency and the page |
| 4 | Rope fixed | The sheer face's rows flip to the easy climb's on both seats |
| 5 | The player presses Throw on the adventurer, the GM seat connected, the die rigged | The Player's own pane writes nothing and rolls nothing: the flag changes only after the GM client acts. A public declaration from the party's name reads "<Player's name> declares: <adventurer> throws to cross."; one card, a whisper to the Judges alone, follows it; the member's record is one stretch on; the Player is told "Declared — sent to the Judge." and sees no card. The row's button is gone once the member is across, and keyboard focus lands on that row (`[data-press-home]`), not on `<body>`, with the tab's scroll unmoved |
| 5a | A seat that owns nobody: from its pane, import `formation/player-requests.mjs` in page context and call `requestPartyAction(<formationId>, "crossing", { crossingId, actorId: <adventurer's id> })` | The row shows no button on that seat, so the call stands for a stale or hand-made press. A whisper to that seat reads that the member is not one of their characters; no declaration, no card, no die (the rig's counter is unmoved), the flag unchanged. The same call with no `actorId` is refused the same way |
| 5b | The Player's seat on a member the grid refuses (the adventurer on a face the table refuses), its pane's row | No button; the reason as text on the row. The same `requestPartyAction` call from that pane: a whisper to the Player with the reason, no declaration, no card, no die. The Judge's own press on that row still warns and throws (step 9) |
| 5c | A stale id: End then Begin, then the Player's pane calls `requestPartyAction` with the ended crossing's id; then with none open | A whisper that the crossing changed, and one that none is open; nothing rolled or written; no declaration, and no "Declared" toast on the Player's seat for either |
| 5d | The Player's pane presses Throw for two members it owns in quick succession, then twice for one | Two declarations and two cards, both members' records one stretch on; for the single member one declaration, one card, one record step and a whisper that the throw is still being made |
| 5e | A member across, from the Player's pane by the same call | A whisper that nothing is left to throw; no card |
| 6 | A miss that does not advance, then a make | The member is stalled, not across, and `covered` is 0; the row now warns the Judge. The make is the Judge's press over that warning, its card says so, and `covered` is 1 |
| 6a | On an obstacle whose imported grid row is vulnerable, a member with a stretch left throws a make that does not take them across (the Player's press for the adventurer, then the Judge's for a second member). Give one of them a Vulnerable from a hand (the token HUD) first. Then a make that takes one across, a fall for the other, and End. Read each member's `actor.effects` in page context: every effect carrying `flags["acks-extras"].heldCondition` that starts `crossing:` | After the first throw each member carries one such effect, its flag `crossing:<crossing id>:vulnerable`, its `statuses` `vulnerable`, and the hand-set one stands beside it unmarked. The row on the GM seat and the Player seat reads a chip "Vulnerable", its tooltip saying this crossing holds it and naming the imported page. A second throw makes no second effect. Across and fell each take the effect off and the chip with it; the hand-set Vulnerable stands. End takes off any that remains. On an obstacle whose row is false, or with `vulnerable` blank (clear the key in the Ruledata Browser first), no effect is made and no chip shows. A hand-delete of the held effect from the actor's effects list is refused. Also check, with the crossing still open, the member removed from the party: the effect stays until the next press or End |
| 7 | The Judge modifier set so the lowest face meets the target, the lowest face rigged | The botch row's words on the card |
| 8 | A fall | The card and the row report the distance and the dice; the member's hit points are unchanged |
| 9 | The GM throws for a refused member (the adventurer on a face the table refuses) | A warning, then the throw; the card says it was thrown over a refusal |
| 10 | A jump: gap and run-up, for several gaps (one inside every member's range, one inside some, one past all) with the run-up on, then off | Each row's range and verdict equal `acksExtras.formation.jumping.canClear` read in page context for that member's own Dexterity score, level, carried stone and Acrobatics, with `runningStart` the setup's run-up; turning the run-up off moves the range and the verdict for the same gap; the verdict tooltip lists the distance's parts and the faces that clear |
| 11 | Precarious off, then on; then charging with precarious off | Off and off: no landing line on any row. Either on: every row carries a Landing save label with its tooltip (the save's name, then the page); the roll button and the footing pick with its failed button are drawn on the pane of the member's owner, a Judge or a Player (a Player's roll button only where a Judge would not be warned), and absent on a seat that owns neither |
| 11a | The Judge presses the landing save on a member | The system's own save dialog opens for that member (or none with its skip key held); the rolled card is the system's own, and one more card follows, whispered to the Judges, with the total. The flag is unchanged |
| 11b | Cancel the system's dialog | Nothing is posted; the Judge is told the save was not rolled |
| 11c | The gap set past a member's range, precarious on | That member's row says it cannot reach, the roll button reads Roll anyway and the press warns the Judge and goes ahead; on the Player's pane the same row blocks with the reason as text and no roll press (the footing pick is still drawn and its press is refused with the row's reason). With the jumping table blanked, the verdict is blank and no seat can roll, with no words |
| 11d | After a save, pick each footing and press Failed, with the setup's depth set and then blank | One card to the Judges each: solid and edge name the outcome (prone, hanging) and what the imported die gives; empty names a fall with the depth's dice, or reads the distance as unknown with no depth. No hit point, status or flag value changes on the member or the party |
| 11e | A plain landing (precarious and charging off), a gap inside every range, the die rigged to its top face; the Judge presses Attempt on the adventurer | The verdict and the range stay on the row; beside them "Rolled N ft, clears" with N the range's top, the state Across, the Attempt button gone. One card, a whisper to the Judges alone, a row for the distance against the gap. The record holds `jump.face`, `jump.distance` (N), `jump.gap`, `jump.footing` null, and the hit points are unchanged. The distance's tooltip, on the row and on the card's total, lists the die's face, the distance's parts and the imported page; the card's gap cell says the Judge set it and names the page, and carries none of the distance's working |
| 11f | A new crossing, a gap inside the range, the die rigged to its first face, whose distance falls short of it | "Rolled N ft, short", "Short of the far side by M ft", the footing Empty space, Falls, the state Fell; with the depth set a fall of that distance with the imported dice, and with it blank "Fell, depth not set". No save is asked even with precarious on. A fall's tooltip names its parts and the imported page |
| 11g | Precarious on, a gap inside the range, the system's save dialog accepted with the total rigged to meet the member's save, then to miss it | A save made: the row shows the total against the target and "saved", the member is across, and the shortfall die is not rolled (the rig's counter). A save missed: "failed", and the shortfall die is rolled once. The system's own save card is posted and one more card goes to the Judges; the standalone Roll press on the row is gone once an attempt stands. The save's tooltip names the save and the page |
| 11h | A failed save with the shortfall die rigged three ways against a gap whose margin over the rolled distance is fixed: a slip under the margin, equal to it, over it | Under: "Landing short by S ft", Solid ground, Prone, the member across. Equal: An edge, Hanging, the member hanging, a Climb up button in place of Attempt, and the climb's target with its parts as a tooltip. Over: Empty space, Falls, Fell, with the depth's dice. Each is one card to the Judges and a record whose `jump.slip` is the die's result. Then the Judge picks another footing on the row (the footing list and its **Failed** button) for each: the record's `jump.footing` and `state` take the pick (Solid ground across, An edge hanging, Empty space fell), the row's result, state and Climb up button follow it ("Set by the Judge" in the footing's tooltip), and a card to the Judges is posted. A pick on a row with no attempt is reported on the card alone and writes nothing |
| 11i | The hanging member: the Judge presses Climb up (the adventurer, whom the grid refuses the sheer face: a warning first), then a second hanging member who holds Climbing | A card titled for the climb up, over a refusal where the grid refused, with the member's own figure as the target. A make: across, the row's Climb up gone, `jump.footing` still the edge, and the result line reads "An edge: Climbed up" (the landing's footing, the climb up's outcome; its tooltip adds the throw). A miss that holds on: stalled and still hanging, Climb up still offered to the Judge, the result line still "An edge: Hanging". A botch: fell, and the card's fall is the setup's depth, not a stretch's midpoint; the result line reads "An edge: Fell" with the same fall figure and the state column agrees. With Rope fixed ticked in the setup the same face is the easy climb. The climb up holds no condition even where the imported grid marks the sheer climb Vulnerable: no chip on the row and no effect on the member's body after a stall or a fall. That last check proves something only where the world's grid does mark it: assert `obstacleVulnerable("sheerClimb") === true` (`scripts/formation/obstacles.mjs`, imported on the GM's page) before the step, and where it answers `false` or `null` record the check as not walked rather than passed |
| 11j | The Player's pane presses Attempt on the adventurer it owns, the GM seat connected; then Climb up for a hanging member it owns; then, from a seat that owns nobody, `requestPartyAction(<formationId>, "crossing", { crossingId, actorId, step: "attempt" })` in page context | The Player's pane writes and rolls nothing: a public declaration from the party's name ("<Player's name> declares: <member> jumps." and "… climbs up."), the die and the save rolled on the GM client with the system's save dialog not opened on the Judge's seat, one card to the Judges, the record written. The owner-less seat is whispered that the member is not theirs and nothing is rolled or declared |
| 11k | The jumping table blanked (the die), then restored with the shortfall die blanked and precarious on; then the gap blank; then a monster with no saves | Each refuses every seat, the Judge too, with no words and no die rolled (the rig's counter unmoved) and no card, the Attempt button absent; a blank gap shows no button. A member with no save recorded is refused with its own words |
| 11l | The save dialog cancelled on a precarious attempt, then the Judge presses again | The state reads "Save to roll", the rolled distance stays on the row, no card is posted yet, and the button reads "Roll the save"; the second press opens the dialog without rolling the die again and finishes the attempt as 11g |
| 12 | A member removed mid-crossing, with the removed member's record already in the flag | The row is gone at the next render; the stale record is dropped at the next member's throw, which lands |
| 13 | End, then Begin | A fresh id; no member state carried |
| 14 | A second party sheet, a detached window, the type size on a fresh window | The tab's scroll kept after a press; focus back on the pressed row's button; the rows reflow and nothing clips |
| 15 | A hover pass | Each figure's parts against the page it names; a blank figure's tooltip is the reference alone |
| 16 | Teardown | End; the cards tracked by the ids the run saw appear, then `api.sweepTracked()`, its result quoted; fixtures kept |

Steps 11 to 11d use a member holding no Acrobatics unless the walk has imported the Acrobatics ceiling and bands, since a holder's jump reads unknown without them (`formation/crossing-acrobat` covers the holder). The landing save's bonus is read as nothing until the granted-modifier read lands, so a holder's tooltip names no bonus. A Player's landing save is rolled inside its relayed attempt (step 11j) and by the Roll press of a row it owns (the `land` step, "The crossing, Search here and the Trapbreaking modifier on a Player seat"), each with the system's skip-dialog key so no dialog opens on the Judge's seat. The cards of 11a and 11d are found by the set of `game.messages` ids before and after and tracked by uuid, and the system's own card of 11a is the run's too.

Steps 5 to 5e are the player seat: a Player's press is relayed and the GM
client throws, so a GM pane must be seated or the press has nothing to answer
it. A declaration is the public message from the party's name, a card a
whisper to the Judges, a refusal a whisper to the requesting seat; the run
finds each in the set of `game.messages` ids before and after and tracks it by
uuid. A step that needs a known shape asserts it at its start: step 2 needs no
`crossing` flag, step 5b needs the adventurer to have no Climbing and step 9
the same.

### Swim rows (added with S13 of the dungeon close-out)

Built for the Dungeon tab's crossing when the kind is **Swim · deep water**: the setup (water conditions, Penalty, Larger penalty, Movement, Judge modifier: the party actor's owner's), the "Penalty in force" line for a seat that cannot set up, the rows (No throw or the target, Afloat or Drowning, the pace, the breath and the sink rate, the Vulnerable chip, the last throw, the Rescuer select, Haul to the surface), and the driver that posts the prompt card at a member's turn. A mock cannot prove that the driver fires on a real `combatTurnChange`, that the prompt card reaches the owner's seat and not a bystander's, or that the Rescuer select's change reaches the code on a control with no `data-action`. Path: Actors sidebar → party sheet → Dungeon tab → The crossing.

Before the first step the Rules tables must be imported in the test world: the walk reads `swimmingBonus`, `swimWaterPenaltySteps`, `swimSpeedShare`, `breathRounds`, `sinkFeetPerStone`, `carriedBodyStone` and `carriedGearShare` through `formationValue`. Without them the penalty offers None and Larger alone and the pace, breath and sink cells are blank, which is step S2's second half and not the walk.

**Fixtures** (kept; found by `flags.world.fixture` with `api.fixture`; `own: <tag>` and `@<tag>` markers where a peer is on this surface).
- `formation/swim-party` — a party actor in Dungeon mode with its token deployed on a scene, holding the members below, each deployed as a token on the scene so a combatant stands as it.
- `formation/swim-owner` — a character the Player seat owns, carrying a stone figure the target reads (a character with gear), no Swimming.
- `formation/swim-friend` — a second character the same Player seat owns, to be the rescuer.
- `formation/swim-stranger` — a character the second player seat owns, to prove a seat cannot name a rescuer it does not own.
- `formation/swim-swimmer` — a character holding the imported Swimming, whose row reads No throw while the target is zero or less.
- `formation/swim-beast` — a monster actor with no swim speed, carrying one item of known weight (say 3 stone), so its throw has a stone to read. With the Pack removed it carries nothing and its target reads that nothing, not blank.
- `formation/swim-fight` — a combat on that scene with a combatant for each token, begun.

**Drive mechanics.**
- Begin is the pick `[data-pick="crossing-kind"]` set to `swim` and `[data-action="crossingBegin"]`. The setup fields submit on change like any setup field: set the value, dispatch a bubbling `change`, wait for the render, and read the result from the party actor's `crossing` flag. The Larger penalty input is disabled until the pick reads Larger…, so the pick is set, the render awaited, and then the figure typed.
- The Rescuer select is `select[data-rescue-for="<drowned actor id>"]`, a staging pick with no `name`: set its value and dispatch `change`. Its change is not a form submit, so the flag changes only after the handler's write (the Judge's seat) or the relay's (a player's).
- A throw is the row's `[data-action="crossingThrow"]`, or the prompt card's own Throw button. The die is rigged with `CONFIG.Dice.randomUniform`: 0.975 throws a 1 (a miss), 0.025 a 20. Restore it in a `finally`.
- The driver is driven by a real turn change: `combat.nextTurn()` on the fixture combat, from the primary GM's pane. Never post the card by calling the driver's function, which skips the hook.
- A card is found as the messages that appear across the press (the set of `game.messages` ids before and after), each `api.track`ed by uuid. The prompt card is a whisper to the member's owners and the Judges; read it from the owner's pane.

| # | Step | Observable |
|---|---|---|
| S0 | Re-import the Rulebook's tables; assert no `crossing` flag | The seven figures read back through `formationValue`; End a crossing if one stands |
| S1 | The GM begins a swim crossing | Rows for every member on the GM and Player seats; the Judge's pane has the three condition boxes, Penalty, Larger penalty (disabled), Movement and Judge modifier, and so has the Player's pane, which owns the party actor; the "Penalty in force" line is drawn only on a seat that cannot set up ("The crossing, Search here and the Trapbreaking modifier on a Player seat", C12c) |
| S2 | Penalty set to each imported step, then Larger… with a figure, then with no steps imported (clear `swimWaterPenaltySteps` in the Ruledata Browser) | Each pick's value is the imported size; the target of the owner's row moves by that size; the in-force line, drawn where the pick is not, reads the size and the conditions ticked; hovering the Penalty names the step, what was ticked and the page; with no steps the pick offers None and Larger… alone and the tooltip is the page alone |
| S3 | The hover pass over a row | The target's parts (carrying, Swimming, water, Judge modifier) against the page; the pace's parts (speed, share); a blank figure's tooltip is the page reference alone, hovered on its (empty) cell; No throw on the Swimming holder, with the working |
| S3b | On `formation/swim-beast`: read the row, then add 2 stone to its Pack, then give the beast the Carrier role with a casualty in the party | The target is the load it carries, to the stone; the tooltip's first part reads "Load it carries … MM ch. 1" with that figure, and never "Carrying"; the 2 stone move the target by 2; as a carrier the casualty's share is added; a character's row beside it still reads "Carrying"; the beast's press throws for the Judge |
| S4 | Movement set to Running, then a hand-set Prone on the owner's character | The pace for Running; "Cannot run" with the condition named in its tooltip on the Prone member; Combat still reads a pace |
| S5 | The fight's turn reaches the owner's character (`combat.nextTurn()`) | One prompt card, a whisper to the owner and the Judges, titled for that member's turn with "Swimming throw N+" and a Throw button; no die rolled; a second turn change in the same round posts no second card; a bystander seat sees none |
| S6 | The owner presses the card's Throw, the die rigged to miss | The card keeps the line "N vs T+ — starts drowning" and loses its button; the member's record is drowning with one round counted; the row reads Drowning, Breath {left} of {rounds} rounds, Sinks {feet} ft / round and a Vulnerable chip; the owner's pane reads "Cannot throw while drowning", the Judge's pane reads no such line; the member carries one held effect `crossing:<id>:drowning` |
| S7 | The owner's character's next turn | One round counted, once; the Judge stepping the tracker back and forward adds none; the round the breath reaches its last posts one card to the Judges and never again; no hit point is written |
| S8 | The Judge picks the rescuer on the drowning member's Rescuer select | The select lists the members who are not drowning, each "(load +n stone)"; the pick writes the rescuer's `hauling` and the member's `rescuer`; the rescuer's target rises by the body's stone |
| S9 | The Player's pane picks its own second character as the rescuer, then the stranger's by a hand-made request, then clears | A public declaration for the first; the select on that pane lists only the members that seat owns, so the stranger's is not offered; the hand-made request for it is refused with a whisper to that seat; clearing writes nothing but the links |
| S10 | The rescuer's throw rigged to miss | The rescuer drowns too and the body is let go: both links gone, the card's line saying the body is released |
| S11 | The Judge presses Haul to the surface on the drowning member | Afloat again, no rounds counted, links gone, the held drowning effect removed; the button is drawn on a row a Player owns and absent on one it does not |
| S12 | End, once with a member drowning and once with none | Every held effect off every member; the prompt cards stay; with a member drowning a warning names them "still drowning", with none no warning |
| S13 | A second party sheet, a detached window, the type size on a fresh window | Rows reflow and nothing clips; focus returns to the pressed row or its button; the rescuer select keeps what was stored across a render |
| S14 | Teardown | End; the tracked cards swept by the run's own ids, the result quoted; fixtures kept; the fight ended |

Steps S5 to S7 need a GM pane seated as the primary GM: the driver acts on that client alone. A Player's press on the prompt card is relayed like a row's throw, so S6 is walked from the owner's own pane.

### Squeeze rows (added with S15 of the dungeon close-out)

Built for the Dungeon tab's crossing when the kind is **Squeeze · chokepoint** (Actors sidebar → the party sheet → Dungeon tab → The crossing): the setup (Shape, Length, Judge modifier: the party actor's owner's), the rows (the stone as the target, covered of the length, a Contortionism badge, Stuck with its implied Vulnerable, the two escapes each with its own target, the last throw), the squeezing prompt and the stuck member's two-button prompt at a turn in a fight, and a player's relayed press. A mock cannot prove that core's own save dialog and card read the shifted figure, that the stored save is restored after it, or that a prompt posts from a real turn change.

Before the first step the Rules tables must be imported (re-run it after an upgrade that adds a figure): the walk reads `contortionismBonus`, `chokepointFeet`, `escapeFeet`, `escapePenaltyStep` and `squeezeBotchBand` through `formationValue`, and the Ruledata Browser lists a row for each. With the band blank no throw makes a member stuck: to walk Q6 to Q11 without a botch, drive a stuck member by writing the member's record (`state: "stuck"`) on the party actor's crossing flag.

**Fixtures** (kept; found by `flags.world.fixture` with `api.fixture`; `own: <tag>` and `@<tag>` markers where a peer is on this surface).
- `formation/squeeze-party` — a party actor in Dungeon mode with its token deployed on a scene, holding the members below, each deployed as a token on the scene.
- `formation/squeeze-owner` — a character the Player seat owns, carrying a stone figure the target reads and a Dungeonbashing figure, no Contortionism.
- `formation/squeeze-holder` — a character holding the imported Contortionism, the same stone as the owner, to read the bonus once on the squeeze and the push and not on the wiggle.
- `formation/squeeze-stranger` — a character the second player seat owns, to prove a seat cannot press for a member it does not own.
- `formation/squeeze-beast` — a monster carrying one item of known weight (say 3 stone), whose squeezing throw targets that stone.
- `formation/squeeze-fight` — a combat on that scene with a combatant for each token, begun.

**Drive mechanics.**
- Begin is the pick `[data-pick="crossing-kind"]` set to `squeeze` and `[data-action="crossingBegin"]`. The Shape radios and the Length and Judge modifier fields submit on change like any setup field: set the value, dispatch a bubbling `change`, wait for the render and read the party actor's flag.
- A squeezing throw is the row's `[data-action="crossingThrow"]`; an escape is `[data-action="crossingEscape"]` with `data-step="wiggle"` or `"push"`, on the row or the prompt card. Rig the die with `CONFIG.Dice.randomUniform` (0.975 a 1, 0.025 a 20) and restore it in a `finally`; a Wiggle back is core's save, so its dialog opens on the Judge's pane unless the skip key is held on the press, and a Player's relayed press skips it.
- The stored save figure is read from `actor.system.saves.paralysis.value` before and after a wiggle: equal after, and the card core posts shows the raised target.
- The driver is driven by a real turn change: `combat.nextTurn()` from the primary GM's pane. Never call the driver's function, which skips the hook. A card is found as the messages that appear across the press, each `api.track`ed by uuid.

| Step | Do | Observable |
|---|---|---|
| Q1 | Begin a squeeze on the party; set Shape to Chokepoint, the Judge modifier 0 | The section lists a row for each member: the target is the stone, "Contortionism" badges the holder, whose target is the owner's less the imported bonus once; hover each target for its parts and page |
| Q1b | On `formation/squeeze-beast`, read its row, hover the target, then mark it stuck and hover each escape | The target is the load it carries; the tooltip names "Load it carries … MM ch. 1" and no Encumbrance; the push's parts hold no Strength; the wiggle's parts name the same load |
| Q2 | Set Shape to Squeeze and leave Length blank | Every target is blank with the page alone; a press is refused with no card; set Length 30 and the targets return, with "covered 0 / 30′" |
| Q2b | On a squeeze of Length 100 and a member whose combat speed is 40, rig a pass and press Throw three times (a new round between presses in a fight) | Covered reads 40, 80, then the row reads Through at 100; hover the covered figure for "Combat speed 40 ft per round" and the page; a rigged miss in between leaves covered where it was; clear the member's combat speed on the actor and the target goes blank with the page alone and the press is refused with no card |
| Q3 | Set Shape to Chokepoint and Length to the imported figure or more | The Judge's press warns and goes ahead, "Thrown over a refusal" on the card; the Player's seat is stopped in words |
| Q4 | Rig a 20 and press Throw on the owner (chokepoint) | The row reads Through, no condition on the member, one card to the Judges |
| Q5 | Rig the lowest result and press Throw on the holder | Stuck and its implied Vulnerable on the row and the token; one held effect on the member; the escapes appear with their targets |
| Q6 | Hover each escape | The wiggle's parts are the save, the stone and no Contortionism; the push's are the Dungeonbashing figure, the stone and, for the holder, the bonus once |
| Q7 | Press Wiggle back with the dialog open on the Judge's pane | The dialog's target is the save raised by the stone; after it the stored figure is unchanged; a pass frees the member, retreating them, and releases Stuck |
| Q8 | Rig a miss on a Push forward, twice | Tries 2 and a penalty beside it; both targets rise by the imported step for each failed push; a failed wiggle in between adds none |
| Q9 | On the Player's pane press the owner's Push forward | A public declaration, the card to the Judges, the row updated on every seat; the stranger's member is refused in words |
| Q10 | `combat.nextTurn()` onto the owner's token, then a stuck member's | One prompt card per round, to the owner and the Judges, with the squeezing target; the stuck member's has two buttons and no target; a second turn change in the round posts none |
| Q11 | Press a button on the prompt card | The buttons go and the card keeps "total vs target — outcome"; a second press the same round is refused |
| Q12 | Remove the escape distance import | Neither escape is offered, labels blank with the page alone, nothing rolls |
| Q13 | Press End with a member still stuck | Every held Stuck off every member, and a warning to the Judge names those who were still stuck |
| Q14 | A second party sheet, a detached window, the type size on a fresh window | Rows reflow and nothing clips; focus returns to the pressed row |

Teardown: End; the tracked cards swept by the run's own ids, the result quoted; fixtures kept; the fight ended; restore any figure removed.

## The trap item sheet and the trap zone's config (added with U16 of the dungeon close-out)

Built for the trap Item's sheet (Items sidebar → a Trap item) and the trap
zone's behavior config (Scene controls → Regions → the region → Behaviors →
Trap Zone). A mock cannot prove that the form part keeps its scroll across the
re-render a changed field causes, that the strip's state reaches assistive
technology, or that the zone's State select shows labels. Both windows open on a
display no taller than the sheet.

**Fixtures** (kept; found by `flags.world.fixture` with `api.fixture`).
- `formation/trap-sheet-pit` — an `acks-extras.trap` Item at level 3, resolving
  as automatic damage, with a pit depth set on its level-3 row and a typed
  `triggerOn`.
- `formation/trap-sheet-zone` — a Region on a scene holding a Trap Zone
  behavior that names the item above.
- The `formation` registered document's `fall`, `pitSpikeCount`, `pitSpikeDie`
  and `trapTriggerOn` tables imported, and then removed, between the passes
  below: the Ruledata Browser's override layer edits them in place, and the
  import's own layer is the one that carries a page (`citeOf` answers null
  for an override).

1. With the figures imported, open the trap sheet. *Observable:* the strip's
   caption reads the level on screen and the count of filled levels; the third
   step carries `aria-current="step"`; each step's text for assistive
   technology and its tooltip name its level and whether it is filled.
2. Hover the Pit damage line with the pit spiked. *Observable:* the tooltip
   names the depth, the fall dice and the spike dice, each with the page the
   import cited, and the figure beside the label is the formula those make.
3. Clear the spike tables only. *Observable:* the line keeps the fall's dice,
   and the tooltip's spike part is the page reference alone, with no digit.
4. Clear the `fall` table. *Observable:* the line stays, its figure blank, and
   the tooltip names the depth and the page reference.
5. Blank the trap's Springs-on field. *Observable:* the In force line reads
   the imported band, its tooltip names the import and its page; typed again,
   the tooltip names the trap's own figure and the imported one it stands
   over; typed 0, the line reads 0.
6. Shrink the window below the sheet's height, scroll the form a little way
   down, change a field. *Observable:* the form part is the scroller (the
   window frame is not), and it is at the same offset after the render. Core
   puts an auto-height window back to `height: auto` on every render, so the
   frame regrows; an offset past its new reach clamps, and is no failure.
7. Open the zone's behavior config. *Observable:* the State select lists the
   lang labels (armed, spotted, disarmed, spent), and the Known checkbox
   carries its label and hint instead of a field path.
8. Raise the seat's type size and open the sheet on a client loaded after the
   change. *Observable:* the window opens wider by the same factor. An item
   keeps one sheet instance, whose width is decided when it is built, so a
   sheet already opened once keeps its width until reload; scripted, build a
   fresh instance (`new item.sheet.constructor({ document: item })`).

`tools/live/formation-trap-sheet.mjs` walks steps 1, 2, 5, 6, 7 and 8 against
the tables the world holds, checking each part for its page where the world
holds it and for the reference alone where it does not. Steps 3 and 4 clear
tables every lane of the shared world reads, so the walk leaves them;
`tools/test-trap-sheet-view.mjs` pins both offline.

Teardown: nothing is swept; the fixtures stay. Restore the imported tables the
passes removed.

### The climber's pace (added with S16 of the dungeon close-out)

Built for the crossing's rows when the kind is a climb, a crawl or a balancing ledge (Actors sidebar → the party sheet → Dungeon tab → The crossing). A mock cannot prove that core's update merges the pick into the record beside a throw's write, that a player's seat relays the pick, or that the select keeps the value the user chose across the render that follows.

Before the first step the Rules tables must be imported: the walk reads `climbPacePenalties`, `crawlPacePenalties` and `balancePacePenalties` through `formationValue`, and a standing import from before them holds none. Step P1 is the absent path on purpose.

**Fixtures** (kept; found by `flags.world.fixture` with `api.fixture`; `own: <tag>` and `@<tag>` markers where a peer is on this surface).
- `formation/crossing-party`, `formation/crossing-climber` and `formation/crossing-adventurer`, as "The crossing" builds them: the party, a holder and a member with no Climbing.
- `formation/pace-climber` — a character the Player seat owns, holding the imported Climbing, added from the imported library as a user adds it, a member of the party.
- `formation/pace-fallen` — a character the Player seat owns at 0 hit points, a member of the party, for the blocked-and-warned step.

**Drive mechanics.**
- The pick is the select `[data-pace-for="<actorId>"]`; set its value and dispatch a bubbling `change`, then wait for the render. Read the result from the flag, `game.actors.get(partyId).getFlag("acks-extras", "crossing").members[actorId].pace`, not from the select.
- A throw is the row's `[data-action="crossingThrow"]`; rig the die with `CONFIG.Dice.randomUniform` (0.025 a 20, 0.975 a 1).
- Run the walk on a climb; repeat the pick on a crawl and a balancing ledge to see each read its own pair.

| Step | Do | Observable |
|---|---|---|
| P1 | With the pace pairs not imported, begin a Sheer climb, length set | The holder's row has a Pace select reading Normal alone, disabled, its tooltip the page reference; no other row has a select; no throw is affected |
| P2 | Import the Rules tables; reopen the section | The holder's select lists Normal and each imported pace with its size; the tooltip lists the sizes and the page; the member with no Climbing has no select on any seat |
| P3 | Pick Faster on the Judge's pane | `members.<id>.pace` is `faster`; the row's target rises by the size and its tooltip lists the pace as a part with its page; the same on the Player's seat |
| P4 | Rig a throw that clears the base target and misses the new one | A miss, one card to the Judges whose target's tooltip lists the pace; the pick still stands and the next throw is penalised too |
| P5 | Pick Normal | The key is gone from the record and the target returns |
| P6 | On the Player's pane pick Fastest on the owned climber, then on a member the seat does not own | The owned pick is written and declared publicly; the other is refused in words with nothing written |
| P7 | On the Player's pane pick for the fallen member | Refused in words, nothing written; the same pick on the Judge's pane is written and a warning names the member |
| P8 | Begin a Rappel | No member has a select |
| P9 | Remove the pair from the registry with a stored pick standing | The row's throw is refused with no words and no card; the select lists the pick by name; picking Normal restores the throw |
| P10 | A second party sheet, a detached window, the type size on a fresh window | The select and its label reflow and nothing clips; the player's select stays live after a render |

Teardown: End; the tracked cards swept by the run's own ids, the result quoted; fixtures kept; restore the removed pair.

### Rounds a crossing spends (added with S17 of the dungeon close-out)

Built for the crossing's obstacle kinds (Actors sidebar → the party sheet → Dungeon tab → The crossing → Rounds spent). A mock cannot prove that the real clock advances by what is owed, that the turn counts as moved, that a fight's own billing is left alone, or that the figure and its tooltip reach every seat. The rate arithmetic and the billing order are pinned offline (`tools/test-crossing.mjs`, `tools/test-crossing-surface.mjs`); this walk is the clock.

Before the first step the Rules tables must be imported again: the walk reads `climbPaceRates`, `crawlPaceRates`, `balancePaceRates`, `spelunking.progress` and the `rounds` of an outcome cell, and a standing import from before them holds none. With them absent the section's header is blank and no throw spends anything, which is step R1.

**Fixtures** (kept; found by `flags.world.fixture` with `api.fixture`; `own: <tag>` and `@<tag>` markers where a peer is on this surface).
- `formation/crossing-party`, `formation/crossing-climber` and `formation/crossing-adventurer`, as "The crossing" builds them: the party, a holder and a member with no Climbing.
- `formation/pace-climber`, as "The climber's pace" builds it: a second holder, a member of the party, whose pick is moved to a faster pace by the walk.
- `formation/crossing-party` has a token on a scene at a dungeon scale; the clock is read from the party's formation record, not from a sheet.

**Drive mechanics.**
- The clock is read from the formation record, `game.settings.get("acks-extras", "formations")[<formation id>].clock`: `totalRounds` is `turnsTotal * 10 + roundsPartial`. Read it before and after each press and report both.
- A press is the row's `[data-action="crossingThrow"]` or the header's `[data-action="crossingThrowAll"]`; rig the die with `CONFIG.Dice.randomUniform` (0.025 a 20, 0.975 a 1). The pace raises a target, so a faster pace needs a rig that clears it.
- The party's `crossing.rounds` is the whole rounds paid and each member's `elapsed` the time kept; read both from the flag, `game.actors.get(partyId).getFlag("acks-extras", "crossing")`.
- A fight is a combat the party's members are deployed into; pause is the clock's pause control on the party sheet. Restore both in a `finally`.

| Step | Do | Observable |
|---|---|---|
| R1 | With the rate tables not imported, begin a Sheer climb, length set, and press a holder | The header reads "Rounds spent" with a blank figure whose tooltip is the Spelunking page alone; `totalRounds` is unchanged; no `elapsed` on the record |
| R2 | Import the Rules tables; reopen the section | The figure reads 0, its tooltip the longest-time line and the pages |
| R3 | Press the holder once, base pace, `totalRounds` read before and after | `crossing.rounds` equals the rounds the stretch owes, rounded up, and `totalRounds` moved by the same; `elapsed` is the stretch's feet over the rate; the Player's seat reads the same figure; the turn is marked moved |
| R4 | Press the same member again until across | Each press adds only what the whole total newly owes, so the sum on the clock is the total rounded up once, never each stretch's |
| R5 | Begin again; pick Faster for the second holder; press both | The clock moved by the slower member's time, once; the tooltip lists each member's feet, share, speed and rounds and ends with the longest, the rounded-up line and the pages |
| R6 | Throw for all | One bill: `totalRounds` moves once for the loop |
| R7 | Rig a miss that covers no ground, on a way of crossing whose miss has an imported duration | `elapsed` is that duration, the tooltip says "misses ×" the duration; a fall spends none |
| R8 | Start a fight with the party's members deployed, press, end the fight | No `elapsed` and no `totalRounds` change from the press made in the fight; the first press after it is timed alone |
| R9 | Pause the clock, press, unpause, press | As R8 for the pause |
| R10 | Begin a jump; attempt, and climb up from the edge | `totalRounds` and `crossing.rounds` do not move; a swim and a squeeze header have no "Rounds spent" line |
| R11 | A second party sheet, a detached window, the type size on a fresh window | The line wraps and keeps its tooltip; its size follows the knob |

Teardown: End; the tracked cards swept by the run's own ids, the result quoted; fixtures kept; restore the clock only by the walk's own readings (never roll it back by a write).

## Obstacle regions

Built for the Hazard item and its compendium (Items sidebar → a Hazard item; Compendium Packs → ACKS II — Extras → Hazards), the Place row on core's Region window (Scene controls → Regions → the Region → Appearance tab), the Judges' hazard card a move posts and its Begin button (Chat), and a trap thing on a place. A mock cannot prove that the sub-type registers on a real client, that a pack entry reaches both seats read-only, that a Region window keeps the Judge's unsaved edits across a drop, that a real token move walks the trap check before the card, that a card's button reaches only a GM's seat, or that a halted move writes nothing.

The sub-type is read by the SERVER at world launch: a world launched before `acks-extras.hazard` existed returns a falsy `Item.create` for it. Shut the world down before `npm run build:packs`, rebuild, then launch (`.claude/rules/live-testing.md`). Check `game.documentTypes.Item.includes("acks-extras.hazard")` first.

**Fixtures** (kept; found by `flags.world.fixture` with `api.fixture`; `own: <tag>` and `@<tag>` markers where a peer is on this surface). A kept fixture carries what the last walk left, so each step asserts or sets the shape it needs at its start.
- `formation/hazard-sample`: an `acks-extras.hazard` Item whose Kind is an obstacle, with a description.
- `formation/trap-stack-*`: a scene with a grid and a scale, holding the party token and a row of Regions, each region's place carrying the trap sources of the "Traps stack" paragraph (a trap wall, trap zones, a trap thing).
- `formation/place-row-*`: a scene with a Region that has a place linked, and a second Region with none, for the Place row's drops.
- `formation/hazard-entry-place-d`: a location actor linked to one of the stack scene's Regions, holding one rappel obstacle thing with its length typed.
- Two members of the party, one with the Trapbreaking skill and one without (the rearm refusal); a Hazard Item of each kind the entry steps use, taken from the pack.

A place is built as a user builds it: link a location actor to a Region (`acksExtras.location.scenes.linkRegion(region, place)`), then drop Items on the Place row, or write the place's `flags.acks-extras.things` whole as a ForcedReplacement where setup is not the subject (the thing's shape is docs/lib API's). The map-drop and Region-window drop mechanics (`Hooks.call("dropCanvasData", canvas, data)`, and a `drop` event dispatched on the row's zone) are `docs/scene-search/TESTING.md`, "S2 — session, activities and drops"; this recipe does not restate them.

**Drive mechanics.**
- **A sheet.** Find it with `item.sheet`, render with `render({force: true})`, poll `sheet.rendered`. For a true fresh open set `item._sheet = null` first, since the kept position and the type scale apply only at construction. Write a form field by setting `select.value` and dispatching a bubbling `change`; race `Hooks.on("updateItem")` against one 4 s timer.
- **The description editor.** Click `button.toggle`, focus `.ProseMirror`, `document.execCommand("insertText", false, text)`, click `button[data-action=save]`.
- **Removing one ownership key.** Write the whole map with `{diff: false, recursive: false}`; the `-=` null form does not apply.
- **A real compendium drag** goes through CDP on the seat's page: `Input.setInterceptDrags {enabled: true}`, `mouseMoved`, `mousePressed`, about eight `mouseMoved` steps with `buttons: 1`, wait for `Input.dragIntercepted` (it carries a `text/plain` item), replay it with `Input.dispatchDragEvent` (`dragEnter`, `dragOver`, `drop`), `mouseReleased`, then set intercept back to false. Coordinates: `ui.sidebar.toggleExpanded()`, `changeTab("items", "primary")`, `pack.render(true)` and `setPosition`, scroll the row into view, read its `getBoundingClientRect`. `pack.index` carries no `system.key` (core's default index fields), so read the key from the document.
- **The CDP drag cannot grow a window.** A drag of a window's corner shrinks it and moves its header, and fails to grow one, on a core sheet too: it is the driver's artifact, never the module's. Check a size by `setPosition`.
- **A move.** `tok.update({x, y}, {animate: false})`, then wait about 4.5 s (the trap check, the sweep and the card are async), then diff `game.messages` against the ids read before. Read the new ids at once and `api.track(id, "ChatMessage")` them.
- **`api.fixture()` tracks what it builds**, so `api.sweepTracked()` deletes a fixture built in the same run along with its cards. Build a fixture in a run that does not sweep, or build it again after.
- **A wall that halts.** A trap wall whose stored state is `found` is known and skipped, never a halt, and a wall that is not armed is not in the stack. To halt, point the wall at a trap that springs on the move.
- **Dice.** Rig `CONFIG.Dice.randomUniform` (0.025 throws a 20, 0.975 a 1) and restore it in a `finally`.
- **A Player seat's press.** Import `scripts/formation/hazard-entry.mjs` on the Player's page and call `pressBegin` with the card button's `data-*` values; read the answer.
- **The console.** Attach the recorder before the page loads: one attached after `ready` saw none of `init`, `setup` and `ready`.

**The Hazard item and its compendium (H1).**

| Step | Do | Observable |
|---|---|---|
| H1 | Relaunch the world; on both seats read `game.documentTypes.Item` | It lists `acks-extras.hazard`; the recorder shows no module error through `init`, `setup` and `ready` |
| H2 | Open the sample's sheet | The Kind select lists a blank option, then the nine obstacles, then the six conditions, in two captioned groups |
| H3 | As GM change Kind, the name and the description | Each persists on the item (read it back); the Kind's `system.key` is the picked key |
| H4 | Give the Player seat Observer on the sample and open it there | The fields are disabled and the description is plain enriched text, with no editor |
| H5 | Shrink the window to about 300 by 250; open two sheets side by side; raise the type size and open a fresh instance; click the image | The window scrolls; two sheets do not collide; the body follows the knob; the image opens core's file picker |
| H6 | Open the Hazards pack | 15 entries in the folder ACKS II — Extras → Hazards, each with its icon loading and its name readable; an entry opens read-only on both seats |
| H7 | Drag an entry onto the Items sidebar | The copy carries `system.key`, its picture and `compendiumSource`, and opens editable |
| H8 | Drag an entry onto a character sheet | It becomes an owned Item (core does this; the module does nothing more with it) |

Teardown for H7 and H8: arm a `createItem` hook as an OBSERVER only, `api.track` the uuid read back (an embedded copy is `Actor.<id>.Item.<id>`), then `sweepTracked`.

**The Region window's Place row (B3).**

| Step | Do | Observable |
|---|---|---|
| B1 | As GM open the Region window of the Region that has no place; open the Appearance tab | A Place row under the Name field: a picker reading none, a make-a-place button, a counts line reading none, a drop zone |
| B2 | Type a change into the window's Name field without saving, then drop an obstacle Hazard onto the zone | A place exists for the Region and its sheet did not open; the typed change is still in the field; the picker now selects the place; the counts line reads one obstacle; the thing is kind `obstacle`, its `ref` the Hazard's uuid, `params` blank, `point` null |
| B3 | Drop a trap Item, and a condition Hazard | A trap thing with `hidden` true; a condition thing; the counts line reads each count, its tooltip naming the things |
| B4 | Drop a Hazard whose Kind is blank, then an Item that is neither a trap nor a Hazard | Each warns in words and nothing is written to the place's list |
| B5 | Pick another place in the picker, then none | The Region's link flag moves to it, then is cleared |
| B6 | Drop a Hazard on the map over the Region, then over a bare Region, then where no Region is | The first lands on the place with `point` set; the bare Region is made a place with its sheet closed and the thing on it; the last warns and writes nothing. A trap dropped near a wall assigns the wall, not the place |

**The entry card and Begin (B2 and H3).** The party token stands outside a Region whose place holds the rappel thing (length typed), a second obstacle thing of another kind (a narrow ledge, whose `ref` is a world Hazard item), a hidden trap thing and a Rope fixed condition.

| Step | Do | Observable |
|---|---|---|
| E1 | Move the party token into the Region | One new card, to the Judges only. Its headings are Obstacle, Figures and Crossing; a row per obstacle with figures labelled ("Length 40 ft · Depth —"), the Hidden from players mark on a hidden obstacle, a Begin button each, a chip for the condition; the trap thing is not listed; figure and Begin tooltips are present |
| E2 | Move within the Region | No card; the party actor's `placesUnder` flag holds the place's uuid |
| E3 | Move out and back in | One new card |
| E4 | Press Begin on the rappel row | The open crossing is a rappel with the typed length and `ropeFixed` true (read it from the party's crossing flag and the panel's fields); the party sheet opens |
| E5 | Press Begin on another row with that crossing open | A confirm dialog (in the scroll contract, resizable by its corner; the header drag moves it). Cancel leaves the crossing unchanged |
| E6 | Press Begin again and answer End and begin | A new crossing id, of the second row's kind, its length blank and `ropeFixed` seeded from the place |
| E7 | Point a trap wall that lies between the party and the Region at a trap that springs, then move across it into the Region | The party is pulled back, no card is posted, and `placesUnder` is unchanged; the next move into the Region posts the card |
| E8 | As the Player seat: look for the card, then call `pressBegin` | The card is not visible; the answer is `{ok: false, refused: "seat"}`; an unbound button does nothing. A GM's press made after the party has left the place warns the party no longer stands in it, and nothing begins |
| E9 | With the party in journey or settlement mode move into the Region (not walked yet) | No card; `placesUnder` is kept current |

**A trap thing on a place (P3).** The Region's place holds a trap thing whose Trap Item springs.

| Step | Do | Observable |
|---|---|---|
| P1 | Move the party into the Region while the thing is armed and hidden | The trap goes off on its own card; the party is not pulled back (a thing halts nothing); the entry card still posts; the thing reads discharged and no longer hidden |
| P2 | Open Trapbreaking as GM | The thing is listed as "Trap · <the place's name>", spent, with its distance |
| P3 | Press Rebuild it on it | The thing is armed and hidden again |
| P4 | Press Mark found | It is found and no longer hidden |
| P5 | Give the working member Thieves' tools and rig the die to a made throw; press Work on it | A "The trap is beaten" dialog opens on the thrower's seat: answer it (Leave disarmed writes `disarmed`, Discharge writes `discharged`) |
| P6 | Press rearm with an unskilled member working it | Refused with the skill reason; a skilled member is needed for a rearm to succeed, and a successful rearm needs its own step |
| P7 | Open Trapbreaking as the Player seat | The known thing is listed |
| P8 | Call `linkRegion(region2, place)` on the place another Region already names | The first Region resolves to no place; the thing is measured through the second Region |

Walked so far: H1 to H8 (two passes), the Place row's steps on the plan's record of 14 of 14 checks (this table is written from the row's code and that record, since the walk's own step list was not kept), E1 to E8 and P1 to P8. E9 is written from the code.

Teardown: nothing the walks built is swept; the fixtures stay. `api.sweepTracked()` takes the run's own tracked ids, the cards of each move among them, and the report quotes what it removed, could not find and refused. A run that lost its ledger on a reload lists its own cards by author, minute and the party's alias, and sweeps that list by id. A walk leaves things changed: restore a wall to its armed trap, re-arm the thing, take back a member's Thieves' tools, restore the links P8 moved, and keep no unsaved Region-window edit.

## The turn's unit: rounds to a turn and turns to an hour (RR p. 263)

Fixtures: the turn plan's kept party, marker `formation/plan-party`, on its scene `formation/plan-scene` ("The turn plan", above, which brings both to their start shape). Nothing is imported for this surface: the unit is stated in `lib/time-unit.mjs`.

| Step | Do | Observable |
| --- | --- | --- |
| T1 | In the console, read `acksExtras.lib.timeUnit` | `roundsPerTurn()` and `turnsPerHour()` answer whole numbers, `turnSeconds()` and `roundSeconds()` answer numbers, and `timeUnitCite()` names RR p. 263; they answer the same in a world whose `formation` ruledata document carries other counts |
| T2 | Press the Dungeon tab's advance-turn and advance-round buttons | The turn count and its round count move; the card's elapsed line shows a time; the world clock moves by `turnSeconds()` for a turn |
| T3 | Hover the strip's elapsed figure and its carry-over figure | The elapsed tip names the turns, the rounds and the page; the carry tip names a round's feet |
| T4 | Drag the party token one turn's distance on the dungeon-scale scene | The turn count moves by one and the world clock by `turnSeconds()` |

Drive mechanics: the unit tests cover the arithmetic; the live pass proves the strip and the clock on a real scene.

## A magic light as the only light

Walked by `tools/live/formation-light-reading.mjs` on the GM seat.

**Fixtures** (kept, found by marker): the party actor `formation/light-reading`
holding the character `formation/light-reading-member`, which carries the plain
item `formation/light-reading-lamp`. The lamp's magic light effect is made with
the Add Effect control's own start data and is the run's own, swept by uuid with
the turn cards the party's turns post. Each step starts by asserting the shape:
no flame lit on the record, the delve, the lamp out of every container and
unshuttered, `formationHasLight` true.

| Step | Do | Observable |
| --- | --- | --- |
| 1 | Advance the party one turn with the magic light shining and no flame lit | The turn card posted for the party lists its status rows and carries none of the no-light line (matched by the lang string) |
| 2 | Open the party sheet, Kit tab | One magic light row reads Shining; the figures rail's light cell (the flame glyph) shows that row's badge as its reading and not the no-light reading |
| 3 | Press the row's Shutter button, wait for the effect to read Shuttered, advance one turn | The turn card carries the no-light line, which proves step 1's absence is not a card that never had one |
| 4 | Open the party sheet, Kit tab | The row reads Shuttered; the light cell reads the no-light reading and no longer the badge |

Drive mechanics: a turn advance moves world time, and the kept party's rest and
encounter counters accumulate across runs. The cell is found by its glyph inside
`.acks-extras-party-sheet__rail--figures`; its reading is the sub span, its name
the tooltip and aria-label.

## A place made from an unfound point

Walked by `tools/live/formation-hidden-place.mjs` on the GM seat and the Player
seat. The GM seat must be the window that runs the automation (the active GM,
leading its seat): the reveal is written there.

**Fixtures** (kept, found by marker): the hex scene `formation/hidden-place-scene`,
written back to its grid; the party `formation/hidden-place-party`, Observer to
the Player, and its token `formation/hidden-place-party-token`, brought back to
hex C and to journey mode. Hex C's stock is a flag on the scene, written again
every run: three invented points, each with a note, P found by this formation
and Q and R by nobody (`hexStock.writeStock`, the record shape under "The hex
the party is shown"). Setup is the subject: every place a step makes and its
token are tracked by uuid as they are read back, and swept at teardown.
Teardown also returns the party to delve.

| Step | Do | Observable |
| --- | --- | --- |
| 1 | GM: party sheet, Wilderness tab, Points of interest, press Q's **Make it a place** | The stock names Q's place. The place is a location with Q's note; its one token is hidden; its stored ownership default is None and it carries `flags.acks-extras.hiddenPlace` |
| 2 | Player: read the place | `getUserLevel` is None and `testUserPermission(user, "LIMITED")` false; `visible` is false and the Actors tab has no row for it; its sheet does not open. The document is still in `game.actors`: the stated limit |
| 3 | GM: press P's **Make it a place** (the control: a found point) | Its token is shown, its ownership default is Owner, no flag. The Player owns it and the same Actors tab lists it |
| 4 | GM: show Q's token | Q's place reads default Owner and no flag. The Player owns it, the Actors tab lists it, its sheet opens |
| 5 | GM: hide Q's token again | Nothing changes on the place: still the table's |
| 6 | GM: make R a place, set the Player to Observer on it by hand, then show its token | The flag is gone; the default is still None and the Player still an Observer |
| 7 | GM: create a location by hand with no ownership in its data; create one carrying an importer stamp and no ownership, the shape the importer writes to the Actors tab; where a compendium holds an imported place, import one into the world | The hand-made one reads default Owner; the stamped one reads None; the imported copy reads None, which is core's own import default and a control |

Drive mechanics: a token is shown and hidden as the token HUD's eye does it, one
`scene.updateEmbeddedDocuments("Token", [{_id, hidden}])`; the hook reads
`changes.hidden === false`. The reveal's two writes land after the token's, so
poll the place's flag, and the Player's level, before reading. Step 2's
directory check is only worth what step 3's is: the row that is absent for Q
is present for P on the same rendered directory (`ui.actors.element`,
`[data-entry-id]`). A GM seat cannot stand in for step 2, since a GM owns every
actor. Step 7's stamp is invented (`flags.acks-extras.cookbook.id`), and its
create is the hook's decision and not the importer's own write, which needs a
compendium that cannot open. The drag out of a shelf is
`game.actors.importFromCompendium`, which names the default None on core 14
with or without the stamp; it is skipped with a note where no compendium holds
an imported place.

## Casting a light spell from the Kit tab (added with T-0791)

Walked by `tools/live/formation-kit-cast-light.mjs`; its ids K-c1 to K-c12 are
this section's step numbers. The Kit tab's **Cast a light spell** row (Party
sheet → Kit tab → Light Sources) offers each light spell a seat can cast among
the party's members, and Cast opens the caster's own cast window
(`docs/magic/MODEL.md`). Every name and figure is invented; the page is
invented too.

**Fixtures** (kept; found by marker, built when none carries it; each step brings
them to the shape it needs at its start, `P.shape` in the walk):

- `formation/kit-cast-scene`: a room, as `formation/magic-light-scene` (above).
- `formation/kit-cast-party`: a party actor with its token, marked
  `formation/kit-cast-token`, on that scene, seating the two members below in
  order through the party sheet's drop.
- `formation/kit-cast-class`: a class with one list (its key equal to the
  folded label, no hyphen) and one first-level slot at level 1.
- `formation/kit-cast-caster`: a character the Player owns (3), bound to the
  class at level 1 with spells enabled and core's slot grid at 0, carrying
  `formation/kit-cast-spell`: a spell on that list at level 1 with a cite, a
  one-hour fixed duration, a `self` target, and two Light rows: its own form
  (`appliesTo: "self"`, `lasts: "duration"`, bright and dim typed, daylight
  blank) and a `reversed` row with a reach of its own, so a leak of the reverse
  shows. `appliesTo: "self"` is the caster in the spell vocabulary; the
  effect-subject list has no `"caster"`.
- `formation/kit-cast-other`: a character the Player only observes (default
  Observer, no entry for the Player), bound to the same class, carrying
  `formation/kit-cast-other-spell`, a copy of the spell under another name.

At the start no record of a cast stands on either member (a dead run's are
read, tracked by uuid and swept), no pool is spent, nobody is deployed, and the
world clock is read for the end.

1. **K-c1. The Player's offer.** Player seat, Kit tab. *Observable:* the cast
   row's select holds one option, the owned caster's spell under its list, and
   none for the other member (`data-light-cast`, `select[data-pick=lightCast]`);
   the line reads "{list} 1 · Slots 0 / 1" (`[data-light-cast-part=list]` and
   `slots`, the slots word from `ACKS.spells.Slots`); each part carries a
   `data-tooltip-text`; Cast is enabled and the refusal part is `hidden`; no
   magic-light row stands. The cast window claims the spell
   (`castSpellClaims`), or Cast would open nothing.
2. **K-c2. Cast, and the light it writes.** Player seat: press Cast and confirm
   the window in its normal mode. *Observable:* the window is titled with the
   spell and the caster and offers both forms; the caster's record of that cast
   id carries three changes on `flags.acks-extras.magicLight.daylight|bright|dim`
   reading "", "20", "40" in that order, each of the type `magicLightChanges`
   writes, the flag `flags.acks-extras.magicLightCite` equal to the spell's cite,
   the clock fields, and `effectLight(caster)` reads 20 / 40; exactly one record
   of the cast carries the band keys. The Kit tab lists one magic-light row,
   "{spell} — {caster}", Shining, its reach cell the tab's "{bright} / {dim} ft"
   and its tooltip `ACKS-FORMATION.app.magicLightCastTip` with the spell, the
   caster, the cite and the reach.
3. **K-c3. The Shutter.** The Judge deploys the caster out of the party token
   (the token's light reads 20 / 40), then the Player presses Shutter on the row.
   *Observable:* the row reads Shuttered on both seats; `effectLight(caster)` is
   zero while `magicLights` still lists the record; the deployed token's light is
   0 / 0. Where the Order tab's detach control cannot be reached the token lines
   print NOT WALKED and the actor lines stand.
4. **K-c4. The slot is spent.** Player seat, a fresh Kit tab. *Observable:* the
   line reads "Slots 1 / 1"; Cast is `disabled`; the refusal part is visible
   with the Magic tab's blocked sentence (`ACKS-MAGIC.cast.notice.blocked.noSlot`);
   the option is still offered; a press on the disabled Cast opens no window.
5. **K-c5. The Judge's row.** GM seat, the caster's pool set full by hand.
   *Observable:* both spells are options; picking the spent-out one reads
   "Slots 1 / 1", Cast enabled and the refusal part the warning sentence
   (`ACKS-MAGIC.cast.notice.verdict.noSlot`), which is not the Player's; picking
   the other member's reads "Slots 0 / 1", Cast enabled, no refusal. No cast
   goes past the slot.
6. **K-c6. A reversed cast.** The Judge picks the other member's spell, presses
   Cast and confirms in the reversed mode. *Observable:* the window offers the
   reverse; no record of that cast carries a band change or the cite flag (a
   timed record without light may stand, so the check reads the keys, not the
   count); the other member sheds nothing and the Kit tab's magic-light row
   keys are unchanged.
7. **K-c7. Blank radii.** The other member's spell is rewritten with all three
   radii null (the item flag, restored in the same step), pools reset, then the
   Judge casts it in the normal mode. *Observable:* the record carries the three
   band changes, each blank, and the cite flag; its Kit row's reach cell is empty
   and its tooltip equals the cite string exactly (no words, no figure).
8. **K-c8. The clock.** The Judge advances the world clock two hours past casts
   of a one-hour spell. *Observable:* both lights' records are gone, both seats'
   Kit tabs list no magic light and the caster sheds nothing. The walk advances a
   second time if the first left a record standing, and says so.
9. **K-c9. The editor.** The Judge opens the spell's sheet, Mechanics tab, and
   presses Edit on the Light row. *Observable:* the effect-row editor holds three
   number inputs named `lightBands.daylight`, `.bright` and `.dim`, holding "",
   "20" and "40"; the blank one's group carries `ACKS-LIB.effectEditor.tip.cite`
   ("Page: {cite}") as its tooltip, and the typed one's is the field hint, which
   does not name the page. The Kit row of step 7 is where the cite stands alone;
   the editor's wording adds "Page: ".
10. **K-c10. A blank cast light counts.** The fixture is step 7's record, a real
    cast of a spell whose bands are blank (never bands typed by API), left
    standing; the fixture scene's darkness is set to 0.8 for the step and put back,
    since `isPartyInDark` reads a dark scene. The GM seat's party is in the delve
    with no flame lit. *Observable:* `formationHasLight` is true and `isPartyInDark`
    false; the header's light cell (the flame glyph in the figures rail) reads the
    row's Shining badge and not the no-light reading; the next turn card carries
    no no-light line. Shutter the row: `formationHasLight` false, `isPartyInDark`
    true, the cell reads no light; Open it again and the badge returns. The row's
    **Set reach** button is drawn on the GM seat (it owns every record) and not on
    the Player seat, which only observes that bearer; pressing it opens the
    record's own effect sheet (`.application` with the record's name in its
    title). The blank cell's tooltip is still the cite alone. Step 2's record,
    shuttered by step 3, is asserted shuttered and counts for nothing here.
11. **K-c11. The imported reach.** The one step that reads the Judge's own copy:
    no invented page stands in for it, and a seat with no copy of RR skips it and
    says so. GM seat: re-import RR's spells in the test world (Settings tab → Game
    Settings → ACKS II — Extras → Manage imports → (Re)import individual entries,
    the two illumination spells), then bring both onto the kit caster, which
    carries them beside the fixture spell with the pool set full by hand.
    *Observable:* the cast row's select offers both (`hasLightRow`: the perpetual
    form carried no row before). Cast the timed form: the record's band changes
    read blank, the bright reach and the dim reach, and the cite flag reads RR
    p. 227; the Kit row's reach cell is "{bright} / {dim} ft", read against the
    page, with no daylight figure since that page prints none. Cast the perpetual
    form: the record carries all three bands (RR p. 228), daylight as printed,
    bright as the daylight reach plus the increment the page prints, and dim as the
    total the page prints; the record carries no `startTime` and no duration, so
    its Kit row shows no countdown and it is still listed after K-c8's clock
    advance. Open each spell's Light row in the effect-row editor: its radii hold
    the imported figures. Then type one band on the timed row, re-import again:
    the typed band stands and the row is listed as held (Settings tab → Game
    Settings → ACKS II — Extras → Manage imports), and a row left untouched takes
    the page's reach. A radius the page's wording does not yield stays blank and
    is listed as unread; the editor's tooltip on it is the page alone. Teardown:
    the casts' records and cards by the run's own ids; the imported spells stay.
12. **K-c12. Daylight from a placed light.** Fixtures: the kit party and its
    scene, and the ambient light marked `formation/daylight-ambient` (lib's
    "Daylight from a placed light" recipe builds it, bright and dim radii typed and
    no daylight flag). Where that light stands on another scene than the kit
    party's, the step makes a second light there with `api.create`, which the
    teardown sweeps. GM seat: set the party scene's darkness to 0.8 (read first),
    which leaves the sky no daylight, put the party token beside the light, and
    open the party's sheet → Kit tab → Light Sources. *Observable before the
    radius:* the Light here line reads the stage the light's own bright and dim
    radii give, or Dark where none reaches. Set the light's Daylight radius so the
    party token stands inside it (Scene controls → Lighting Controls →
    double-click the light → Basic Configuration tab → Light Placement → Daylight
    radius). *Observable:* with no other action the open sheet's line reads
    Daylight and its tooltip names a placed light, with the light's name where it
    has one, and ends RR p. 228; the same line on a Player seat's open sheet. Move
    the party token out of the radius: the line falls to the next stage (bright or
    dim by the light's own radii, else Dark, and a Dark line carries no tooltip).
    Clear the radius with the token inside: the same. A lit token that decides the
    reading is named on a Player seat only where that seat holds Observer on its
    actor; a Player seat with less reads the kind alone and the page. Moving a lit
    token on the scene redraws the open sheet. No line is in the DOM for a party
    with no token on its scene, while the party's token is hidden (members
    deployed), or while the party's travel mode is journey. Teardown: the light's flag cleared, the
    token put back, the scene's darkness put back to what the run read.

Teardown: the run puts back the spells' radii, counts and pools (`P.shape`), the
deployed member, the fixture scene's darkness (K-c10 sets it to 0.8 and writes
back what it read), the world clock (`game.time.set` to the value read at the
start), and closes the cast window and the sheets; then the capture driver's
`sweepTracked({only})` over the run's ledger removes each cast's chat card and
record and the token a deploy made, by the ids the run read back. The fixtures
stay.

Drive mechanics: Cast is pressed with a plain `click()`, so no skip-dialog key
is held and the window opens; the sheet does not await the cast (its window
waits on the seat), so the walk polls for `.application.acks-extras-cast`, then
sets the `mode` radio (present only where the spell has a reversed row) and
presses the window's `button[data-action=cast]` as `_magic-cast-kit.mjs` `P.cast`
does, and finds the card by `flags.acks-extras.castCard` among the messages made
since the press. A pick is the select's `value` set and a bubbling `change`
fired: the line follows with no redraw. A record is told from a peer's by its
cast id and then by `${actorId}.${effectId}` in `data-magic-light`; never
"the only row". The Player seat proves the ownership gate; the GM seat's
`isOwner` is true for every actor, so its option list says nothing about it.
Offline, `tools/test-light-offers.mjs` pins the offers and
`tools/test-cast-kinds.mjs` the light a cast writes.
