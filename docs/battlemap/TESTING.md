# Battlemap — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server
and driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

## Fixtures

- A disposable scene with any gridded battlemap image as background,
  deliberately misaligned: set `grid.size` wrong and `shiftX/shiftY` nonzero
  so the Foundry grid visibly disagrees with the drawn one.
- A second disposable scene whose background is a stretched (and, for the
  bake path, skewed) copy of the same image — build it once with an image
  editor or a canvas render and upload it to the world's data directory.
- A disposable monster actor with extras size = Large (Classification tab).
- A disposable 3-member formation with its party token on the first scene
  (see `docs/formation/TESTING.md` fixtures for the drop mechanics).
- One disposable plain character actor with a default 1×1 prototype token.
- A disposable scene for the scale-only and hex paths — any background will do,
  including a flat texture (`ui/parchment.jpg`), because those paths measure
  what you tell them rather than what is drawn. Set the background through the
  Level (below), not in `Scene.create`.

## Drive mechanics (non-obvious)

- Calibration is its own scene-control group, `acksBattlemap`, whose resting
  tool is `off`. Drive it with `ui.controls.activate({control, tool})`.
  Entering the group must arm NOTHING: assert `ui.controls.tool.name === "off"`
  and the session's mode is null. `assistant` is a `button: true` tool — press
  it through the DOM, which is also the double-fire check: exactly ONE app
  must open.
- **A closed `SceneControls` makes `activate()` throw inside core.** After a
  driver has closed every app (the capture driver's `compose()` does), render
  it back first — `await ui.controls.render({force: true})` — because
  `activate()` re-renders only its tools part, which no-ops on a closed app,
  and then reads a null `element`; the throw lands before either window opens,
  and an unawaited call fails silently.
- **A backgrounded pane never renders, and stale transforms fail EVERY hit
  test.** The pane does not composite, so PIXI's ticker does not run, the
  overlay's screen-space `updateTransform` never applies, and the catcher is
  still 16×16 at its build transform. Dispatched pointer events then reach the
  DOM element and resolve to nothing. Call `canvas.app.render()` immediately
  before each dispatched pointer step. The control that tells this apart from
  a real defect is `canvas.stage`: if core's own root receives no hit either,
  it is the harness; if only the module's catcher misses, it is not.
- **A CDP key press does not reach the page** — `document.hasFocus()` is false
  for a pane that cannot be fronted, so the keypress lands nowhere and reads
  as an ignored binding. Dispatch the keydown on `document`, which is the same
  listener path the handler registers on.
- **Another connected seat paints its USER NAME onto the canvas** as a PIXI
  `Cursor` in `canvas.controls.cursors`, wherever that person's pointer sits —
  including over the panel. It is not DOM, so no stylesheet reaches it and a
  §4b identity leak survives every CSS hide (three identical captures before
  anyone looked at the display list). Set `canvas.controls.cursors.visible =
  false` before a release shot, and check `game.users.filter(u => u.active)`.
- **Sample the map's real cells for a release shot, not arbitrary drags.**
  Read the drawn lattice out of the background image — dark-run centres per
  axis, median gap — and drag on those boundaries; the plate then reads 0.0%
  tight instead of advertising the feature with a red "samples disagree"
  warning.
- **A document's prepared field can read stale after a scripted update while
  `_source` is already correct.** `token.width` returning the old value with
  `token._source.width` holding the new one is the client not having
  re-initialized, not a rejected write — call `reset()`, re-fetch with
  `fromUuid`, or read the placeable (`tok.w / grid.size`). Do not diagnose a
  blocked write from the prepared value alone.
- **A scripted `pointerdown` on the canvas needs a hover-in first.** PIXI's
  federated event system drops a bare synthetic `pointerdown` unless a
  `pointerover` + `pointermove` at the same point preceded it — real input
  always carries that, scripted input does not. Without it the overlay's
  handler never fires and no sample is captured, which reads exactly like a
  broken capture layer and is not one.
- **But do not blame the harness for a SECOND drag that fails.** A first drag
  landing and later ones not is the signature of something visible sitting
  over the pointer catcher, and it is a real defect — it was written off as a
  synthetic-input limit in three separate runs before anyone read the
  overlay's layering. Any child added above the catcher needs
  `eventMode = "none"`. Test it against a prediction: three drags must give
  sample counts 1, 2, 3.
- **DOM buttons need a full pointer sequence too.** A bare
  `MouseEvent("click")` does not drive Foundry's handlers for scene-control
  tools — dispatch `pointerdown/mousedown/pointerup/mouseup/click` at the
  element's real screen coordinates.
- The panel is the window at `#acks-extras-battlemap`; one instance is reused,
  so `ui.windows`/`foundry.applications.instances` must never hold two.
- **The apply raises a `DialogV2.confirm` — a scripted press that never answers
  it writes nothing**, and the scene reads back unchanged, which looks exactly
  like a rejected update. Click the dialog element's `button[data-action="yes"]`.
- **An apply resizes the scene, which redraws the canvas, which drops the
  Battlemap control group** back to `tokens`/`select` — core does that to any
  group carrying no layer. Expect `ui.controls.control` to have changed after
  an apply; the panel is unaffected and stays open.
- **`Scene.create({background: {src}})` does not take on this build** — the
  scene is created with a null background. Set it after creation through the
  feature's own `setBackgroundSrc()` (`scene-image.mjs`), or directly:
  `scene.levels.contents[0].update({"background.src": "ui/parchment.jpg"})`.
- **Drive the panel's SELECTS as a user does**: set `.value` and dispatch
  `new Event("change", {bubbles: true})`. That runs the real submit handler, so
  it also proves the form contract — a field the current family does not render
  posts nothing, and the handler must leave that slot alone rather than read
  the absence as an emptied field.
- **A scene CLONE rebuilds its grid class from a changed `grid.type`** — this
  is what the hex path depends on. Confirm it directly:
  `scene.clone({"grid.type": 2, "grid.size": 100}).grid` is a `HexagonalGrid`
  with `sizeX` 100 and `sizeY` ~115.47, and `getCenterPoint` answers. Equal
  edges mean the clone did NOT rebuild, and `hexProbe` returns null for that.
- **`CONST.GRID_MIN_SIZE` is 20 on this build**, not 50 — the scale-only clamp
  band is real but wider than a guess would put it.
- The capture overlay swallows canvas pointer events only while a mode is
  armed; scripted sampling can bypass the pointer path by pushing into
  `app.samples.{squares,corners}` (image px) and calling
  `app.onSamplesChanged()` — but finish with at least one REAL drag, since
  the samples list proves the solver, not the pointer plumbing.
- Sample coordinates are IMAGE pixels: convert an intended canvas point via
  the exported `acksExtras.battlemap` helpers or by reading
  `scene.dimensions.sceneX/sceneWidth` against the texture size.
- `app._prepareContext({})` returns the fit panel without rendering — use it
  to assert sizes/residuals, then confirm one value in the real DOM.
- **Verify grid↔image alignment with `round(x / gridSize) * gridSize`**
  against pixel-measured line positions, never with
  `canvas.grid.getTopLeftPoint` — that returns the CONTAINING cell (floor
  semantics), so a perfectly aligned line just past a boundary reads as a
  full-cell residual.

## Steps

1. Enter the Battlemap control group.
   *Observable:* the panel opens as a framed window (`#acks-extras-battlemap`,
   `rendered === true`) with a title bar and a close control, and NOTHING is
   added to the sidebar — `#sidebar` shows only core's tabs, on a Player seat
   as well as the GM's. The footer is visible without scrolling while the body
   scrolls under it. Press the panel tool a second time: still exactly one
   window. Leave the group (select any other control): the session's mode goes
   null and **the window stays open** — core drops a layerless control group
   back to the token control on every canvas redraw, so closing it there takes
   the panel away the moment the apply lands. Press the frame's close control:
   it goes, and re-entering brings it back with the samples intact. The
   scene-config Basics tab separately shows the "Battlemap" row with its
   Calibrate button and autoScale checkbox.
2. Arm "Draw box", drag two boxes over two different drawn cells; arm "Pick
   corners", click three grid intersections several cells apart.
   *Observable:* red rects and blue numbered dots on the canvas; the fit
   panel shows a cell size and a tight/fair residual; the red preview grid
   visibly locks onto the map's drawn lines.
3. Arm "Scale bar", drag along the map's scale bar, type its end-to-end value
   in the app.
   *Observable:* "From scale bar" shows the derived feet-per-box; a chip
   rounds it (e.g. 4.9 → 5).
4. Eraser: arm it and click one sample; then press Wipe.
   *Observable:* the clicked sample vanishes (list and canvas); Wipe empties
   both. While a mode is armed, **Escape disarms** and **Ctrl+Z removes the
   newest sample**; a RIGHT-button press changes nothing — drag with it and the
   canvas pans with every sample intact. (Scripted: `overlay.onPointerDown({
   button: 2, getLocalPosition: () => ({x: 0, y: 0}) })` must leave
   `samples.squares.length` unchanged.)
5. Re-sample (two boxes + two corners), confirm the box value, leave the
   output square at 1:1, press "Apply grid to scene", confirm the dialog.
   *Observable:* one Scene update — `grid.size`, `shiftX/shiftY`,
   `grid.distance` change and Foundry's grid sits on the drawn one; the
   scene flag `acks-extras.battlemap` reads `{calibrated: true, autoScale:
   true, distance: <D>}`.
6. Drop the Large monster onto the calibrated scene.
   *Observable:* its token lands 2×1 (preCreateToken sized it). Toggle
   autoScale off in scene config and drop again: the token keeps its
   prototype size.
7. Press "Rescale tokens on scene" with the character token and the party
   token present.
   *Observable:* the character token resizes to man-size at the scene's
   scale; the party token is UNTOUCHED by this path.
8. Select two tokens, click the 10' hotbar chip; then "Reset selected".
   *Observable:* both resize and carry `flags.acks-extras.footprint =
   {w:10,h:10}`; reset clears the flag and re-derives (monster back to its
   category, character to man-size).
9. Coarse-map output: confirm the box value as 100, set output square 5.
   *Observable:* the grid-px field re-derives to box/20; after apply, each
   drawn box carries 20 Foundry squares whose lines coincide with the box
   edges, and `grid.distance` is 5. An output of 7.5 shows the
   will-not-coincide warning.
10. On the stretched scene: enable "Independent X / Y", sample boxes and
    corners.
    *Observable:* the fit panel shows two cell sizes; after apply, cells land
    square (the background scales anisotropically).
11. On the skewed scene: enable "Allow skew", click ≥5 corners.
    *Observable:* the fit reports skew/rotation degrees and the preview
    lattice lies on the skewed lines; "Bake corrected image" appears. Press
    it: a `<name>-aligned.webp` appears beside the original, the scene
    background swaps to it, and the retained fit locks onto the new image;
    apply then behaves as step 5. The original image file is unchanged.
12. **A box that spans several cells.** Draw one box over a single drawn cell
    and a second across three, and type 3 in the second row's "spans" box.
    *Observable:* the fit's cell size is the single cell's, not a third of the
    long box; residual stays tight. Both rows carry their own value box.
13. **Scale only, on the gridless scene.** Choose "Scale only — no grid", drag
    along the scale bar, and type what it reads on the bar's own row.
    *Observable:* the card reads "Measured: N px per <unit>" and NOT "no scale
    yet"; the ruler-cell field defaults to a round number at a comfortable px
    size (no clamp warning); the footer says the scene keeps no grid. Apply and
    confirm: `grid.size`/`grid.distance`/`grid.units` change, **`grid.type`
    stays 0** and `width`/`height`/`shiftX`/`shiftY` are untouched. Measure the
    bar with Foundry's own ruler: it reads its printed length (within the
    rounding of an integer grid size). Pin the px field instead and the
    distance re-solves to match it.
14. **Hex.** Choose "Hex grid — rows (pointy top)", draw a box around ONE hex,
    and type what a hex is worth with the units set to miles.
    *Observable:* the label reads "One drawn hex is", the card reads "px hex
    box" with two different edges, and there is no output-square field. Apply
    and confirm: `grid.type` is 2, the scene's `grid.sizeX`/`sizeY` equal the
    drawn hex's box mapped onto canvas, and the drawn hex's centre is within a
    pixel of `scene.grid.getCenterPoint()` of itself. Draw only a multi-cell
    box and the panel refuses with "draw a box around ONE hex". Flip "Even
    offset" and re-apply: `grid.type` is 3.
15. **Units and what they are worth.** With the scene at 10 miles per hex, drop
    the plain character.
    *Observable:* the token lands at the quarter-square floor (0.25), not 0.5 —
    `tokenSpan(5, 10)` is the unconverted answer and must not be what ships.
16. **The scene's party system.** Set "Party system here" to Settlement.
    *Observable:* the scene flag carries `mapSystem: "settlement"` at once,
    with no apply. Place a party token on the scene by hand (drag from the
    sidebar — a token created carrying a formation flag is a module placement
    and takes a different branch): the formation's `travel.mode` becomes
    `settlement`, its clock pauses, and a notification names the switch. Change
    the select to Wilderness with the party still there: it follows. Set it
    back to "Leave to the party": a formation already in a mode keeps it.
17. Formation face width on the calibrated scene: see
    `docs/formation/TESTING.md` step 9 (frontage, heading swap, coarse-scale
    floor). On a scene whose units are miles the party token sizes through the
    conversion too — the face is feet and the square is not.

## Teardown

Delete every scene you made (the misaligned one, the stretched one, and the
scale/hex one), the monster, the character, the party actor (its formation goes
with it), and the baked `-aligned.webp` file. Confirm the scenes directory and
`getFormations()` are clean, and that the world's own scenes are as they were —
the setup tool WRITES to whichever scene is being viewed.


## Terrain painting (added with the hex journey)

Fixtures: a disposable HEX-gridded scene (any hex type) and a disposable
square-gridded scene; a disposable party with one member (for the journey
read).

1. Enter the Battlemap group, arm **Paint terrain**.
   *Observable:* the palette window opens with one swatch per terrain and
   the eraser; the toolbar shows the brush armed; calibration modes disarm.
2. Click and drag across the hex scene with two different brushes.
   *Observable:* one Region per painted terrain kind appears (name = the
   terrain's label, its colour the swatch's), `flags.acks-extras.terrain`
   set and `terrainHexes` holding one `i:j` key per painted cell, aligned
   with `shapes`; a drag writes each cell once; repainting a cell with the
   OTHER brush moves it between regions (never two claims).
3. Erase a painted cell; erase a region's last cell.
   *Observable:* the key and its shape leave together; the emptied region is
   deleted.
4. Click the square-grid scene with the brush armed.
   *Observable:* the hex-only warning, once per stroke; no region appears.
5. Journey read: begin a journey on the painted hex scene and move the party
   token across a painted boundary.
   *Observable:* `travel.hex` picks up the offset and its letter-number
   label, `hexesEntered` counts the crossing (arriving in the FIRST hex
   names it without counting), and the ground picker follows the painted
   terrain; an unpainted hex leaves the Judge's pick standing. The panel's
   ×-factor lines follow the painted terrain when travel tables are
   registered.

Teardown: delete both scenes (their regions go with them) and the party
fixtures.

## Roads (added with the settlement layer)

Fixtures: three disposable scenes — gridless, square, and hex (the hex one
given a `hexRoutes` flag by hand, so the legacy path and the conversion are
both exercised); a disposable party with one member.

**Drive mechanics.** Drawing a wall is a real drag on the wall layer: call
`canvas.app.render()` before each PointerEvent or the hit test runs against a
stale frame. Creating the wall through `scene.createEmbeddedDocuments("Wall",
[{c, ...roadWallData({surface})}])` exercises everything downstream of the
drawing and is the right shortcut for the graph and measurement steps — but at
least one road must be DRAWN with the tool, because the preset is what the
drawing step proves. `acksExtras.battlemap.roads` is the api surface; read the
network with `roadGraph(scene)` and the derived links with
`derivedRoutesOf(scene)`.

On a PLAYER seat the road surface is absent rather than refused: there is no
`walls` control and no battlemap group at all, so the tools cannot be reached,
and the overlay draws nothing though the scene still holds its road walls.
`convertRoutesToWalls` answers null. Arming a preset, however, SUCCEEDS on a
player seat and is meant to — the slot is client-scoped, so a seat with no wall
tool arms something it can never draw with. Do not read a player-armed preset
as a permission leak.

1. Enter the Battlemap group and press **Paved road**.
   *Observable:* the wall control opens with the wall tool active, the
   notification names the paved road, and `game.settings.get("core", <the
   wall palette's SETTING_KEY>)` holds all-NONE restrictions, `door: 0`, and
   the road flag with `surface: "paved"`.
2. Press **Alley** without pressing a surface again.
   *Observable:* the armed preset keeps `surface: "paved"` and gains
   `street: "alley"` — the alley is a modifier, not a road kind.
3. Press the trap line tool on the Walls control, then a road preset again.
   *Observable:* each press replaces the other's preset. There is one slot;
   the notifications are the only way to tell which is live. **This is the
   risk to watch for in any later change** — a silent slot would mean a
   corridor the Judge believes is watched.
4. Drag a bent street on the SQUARE scene (two legs meeting at a right angle).
   *Observable:* two Wall documents with `move`/`sight`/`sound`/`light` all
   NONE, `door` NONE, and the road flag; the GM overlay tints them; a player
   seat sees nothing drawn.
5. Read the network: `roadGraph(scene).nodes.length`.
   *Observable:* three nodes for two legs — the shared corner is ONE node,
   because ends dragged by hand land within the join tolerance rather than
   identically. Edit one wall and read again: the network is rebuilt.
6. Select an ordinary blocking wall and press **Mark the selected walls as
   roads** on the Walls control.
   *Observable:* the flag is added, the wall's own restrictions are NOT
   changed, and a warning says it still restricts movement. Its own sheet
   carries the road row and the same warning.
7. Open a road wall's sheet and change its surface, street and name.
   *Observable:* each field writes immediately (the sheet's own submit knows
   nothing of the flag); choosing **Not a road** removes the flag; the row
   never appears twice however many times the sheet re-renders.
8. Repeat step 4 on the GRIDLESS scene and on the HEX scene.
   *Observable:* the same walls and the same network. On the hex scene,
   `derivedRoutesOf(scene)` returns one link per adjacent-hex crossing and
   `stepBetweenHexes(scene, from, to)` answers `{on: true}` for a crossing the
   road makes — with nothing declared in the flag.
9. Press **Convert declared routes to road walls** on the hex scene, with one
   declaration the conversion cannot place (both ends in the same hex).
   *Observable:* one wall per placeable link, drawn hex MIDDLE to hex middle —
   never between the link's own two ends, which are the two halves of one
   shared boundary and resolve to the SAME point, so a wall between them would
   have no length and nothing would be made. `derivedRoutesOf` re-finds each
   converted link with its declared surface and a MEASURED winding of 1 (the
   typed figure is not carried across), and `stepBetweenHexes` still answers
   `{on: true}`. The unplaceable declaration is still on the `hexRoutes` flag
   and the converted ones are gone — a press must never destroy what it could
   not carry. A second press is a no-op (`{made: 0, skipped: 1}`); with nothing
   declared it reports `{made: 0, skipped: 0}`.
10. Journey read on the hex scene: move the party across a crossing the drawn
    road makes.
    *Observable:* the day's road picker follows the drawn road, as it did for
    a declared link.

Teardown: delete the three scenes (their walls go with them) and the party
fixtures. Press a road preset once more if the run left the trap preset armed —
the preset is CLIENT state — one slot per seat, not per world — so it outlives
the run on the browser profile that drove it while disturbing no other seat, and
it is the one thing here a sweep cannot delete.
