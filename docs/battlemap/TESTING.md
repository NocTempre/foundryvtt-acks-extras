# Battlemap — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server
and driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

The walk that drives this recipe is `tools/live/battlemap.mjs`
(`node tools/live/run.mjs battlemap`; `tools/live/README.md` is the contract).
Its header names the sections it covers; a section it does not name is walked
by hand. Its part `hex` walks steps 14, 14a and 14b through the Map setup
window on two scenes it rebuilds every run (`battlemap/hex-walk-rows`,
`battlemap/hex-walk-cols`); their images and box geometry are machine facts,
read from `BATTLEMAP_HEX_MAPS` (the walk's header gives its shape), and the
part is blocked without it. Step 14d runs in the same part on two more scenes
rebuilt every run (`battlemap/hex-rows-wide`, `battlemap/hex-cols-wide`), from
the optional `rowsWide` and `colsWide` entries of that variable; an absent entry
prints SKIP and its steps do not run. The walk does not assert 14d's red
outlines (a shot).

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
- One plain character actor with a default 1×1 prototype token, marker
  `battlemap/plain-character`.
- A scene for the scale-only path, `battlemap/scale-bar-map`: a gridless
  area map with a printed scale bar, units `ft`. Any background works for the
  arithmetic, a flat texture (`ui/parchment.jpg`) included, because that path
  measures what you tell it rather than what is drawn; a release plate wants
  a map a user could hold, with a bar to drag (this machine's copy is under
  "Staged files" in `TEST_ENVIRONMENT.md`). Set the background through the
  Level (below), not in `Scene.create`.
- The scene the guide's hex plates are shot from, `battlemap/plate-hex`: the
  hex-rows map of `battlemap/hex-setup-feedback`'s kind on a gridless scene,
  set up through the window (five one-hex boxes, miles, 6 a hex), applied
  through its button, and holding one token of `battlemap/plain-character`
  for the not-to-scale mark. A plate run rebuilds it, since setup is what the
  first plate frames; `battlemap/scale-bar-map` serves the scale-only plate
  the same way.
- Two kept scenes for the hex path, each carrying a map with DRAWN hexes: the
  fit scores boxes against the hexes they surround, so a flat texture proves
  nothing there. `battlemap/hex-setup-feedback` holds a pointy-topped map, a
  square image stretched over a 4:3 scene; `battlemap/hex-cols-setup` holds a
  flat-topped one. Build each from a hex image of your own, gridless, units
  `ft`; the machine's copies and their geometry are listed under "Staged files"
  in `TEST_ENVIRONMENT.md`.
- A kept scene for the apply that moves placed things,
  `battlemap/reposition-probe`: a copy of `battlemap/hex-setup-feedback`'s
  scene data with nothing embedded, then one wall across the middle, one token
  of `battlemap/plain-character` on a hex centre, and one terrain hex painted
  with the Country brush. A step asserts its grid at its start; it is left at
  whatever grid the last walk applied. A copy painted before paint became a
  core grid shape holds a polygon Region no read finds: delete that Region
  (the marker lookup returns the scene, and its Region is its own) and paint
  the hex again.
- Two kept scenes whose hexes are NOT regular on canvas, for step 14d, each a
  copy of a hex scene's data with nothing embedded and only its width changed
  (Scene configuration → Background → Width; height unchanged):
  `battlemap/hex-cols-wide` from `battlemap/hex-cols-setup`, a third wider, so
  its hexes are regular in the image and stretched on the scene; and
  `battlemap/hex-rows-wide` from `battlemap/hex-setup-feedback`, a quarter
  wider, so its pointy hexes are stretched on the scene as well. A step resets
  each to gridless at its start.

## Drive mechanics (non-obvious)

- Calibration is its own scene-control group, `acksBattlemap`, whose resting
  tool is `off`. Drive it with `ui.controls.activate({control, tool})`.
  Entering the group must arm NOTHING: assert `ui.controls.tool.name === "off"`
  and the session's mode is null. The Map setup tool (`assistant`) is a `button: true` tool — press
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
- **A token's prepared `width`/`height` is core's animated value, and
  `_source` is the stored one.** Core's token animation merges its frames into
  the document and runs frame 0 synchronously, so right after an update the
  prepared width is the tween's start; it stays there while the ticker is
  frozen (a backgrounded pane) and settles once frames run. A read of
  `token.width` straight after a scripted update is therefore not evidence of
  a rejected write. Read `token._source.width`/`height`. On a hex grid
  `tok.w / grid.size` is not the stored size either.
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
  `session.samples.squares` (image px, `{x, y, w, h, cells}`; the bar is
  `session.samples.scale = {x1, y1, x2, y2}`) and calling
  `session.onSamplesChanged()`, with `session` imported from
  `scripts/battlemap/session.mjs` (the panel has no such method) — but finish
  with at least one REAL drag, since the samples list proves the solver, not
  the pointer plumbing.
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
   scrolls under it. Press the Map setup tool a second time: still exactly one
   window. Leave the group (select any other control): the session's mode goes
   null and **the window stays open** — core drops a layerless control group
   back to the token control on every canvas redraw, so closing it there takes
   the panel away the moment the apply lands. Press the frame's close control:
   it goes, and re-entering brings it back with the samples intact. The
   scene-config Basics tab separately shows the "Battlemap" row with its
   "Map setup…" button and "Auto-size tokens" checkbox. The window's title reads "Map
   setup: <scene name>", and the toolbar tool's tooltip reads "Map setup".
1a. **The door from another scene's configuration.** View scene A; open
   Scene configuration for scene B (Scenes sidebar → right-click B →
   Configure) and press "Map setup…".
   *Observable:* the canvas views B, and the window opens titled with B's
   name; pressed from A's own configuration it opens on A without a scene
   change.
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
   newest sample**, but typed into a text field (the window's own inputs, the
   chat box) Ctrl+Z undoes the typing and removes no sample and Escape leaves
   the mode armed; a RIGHT-button press changes nothing — drag with it and the
   canvas pans with every sample intact. (Scripted: `overlay.onPointerDown({
   button: 2, getLocalPosition: () => ({x: 0, y: 0}) })` must leave
   `samples.squares.length` unchanged.)
5. Re-sample (two boxes + two corners), confirm the box value, leave the
   output square at 1:1, press "Apply grid to scene", confirm the dialog.
   *Observable:* one Scene update — `grid.size`, `shiftX/shiftY`,
   `grid.distance` change and Foundry's grid sits on the drawn one; the
   scene flag `acks-extras.battlemap` reads `{calibrated: true, autoScale:
   true, distance: <D>}`.
6. With the Monstrous Manual connected and the `monsters` tables imported
   (`sizeFrontage` among them), drop the Large monster onto
   the calibrated scene.
   *Observable:* its token lands at the squares the imported Large cell gives
   times the square's feet (`sizeSquareFeet()`), over the scene's `grid.distance` (the
   `squares` row of `sizeFrontage`, read from `acksExtras.lib.tables`
   `getDoc("monsters")`; `footprintFeet({})` returns the square on each
   side), preCreateToken having sized it. Toggle autoScale off in scene
   config and drop again: the token keeps its prototype size.
6a. **Frontage not imported.** Take the world layer of the
   `monsters` document off the registry (`unregisterTable("monsters",
   {priority: 20})` from `acksExtras.lib.tables`), then drop the Large monster
   again and press "Rescale tokens on scene" with the Large monster's token and
   the character token present.
   *Observable:* the Large monster's token is not written (`width`/`height`
   unchanged), the character token, which has no size category, is one square
   and is sized, and the one notification is a warning that names what is not
   imported: a size category's frontage. The Token sizes section shows no size chips, and the
   "Size categories" caption's tooltip is the page reference alone. Restore by importing the rules
   tables again (Settings tab → Game Settings → ACKS II — Extras → Manage
   imports → Rules tables).
6b. **A Judge's override.** In the Ruledata Browser, override the `sizeFrontage`
   row's Large cell with a pair of your own, then press "Rescale tokens on scene".
   *Observable:* the Large monster's token takes the override's squares at the
   square's feet; clear the override and it returns to the imported cells.
   Where the Ruledata Browser lists a `sizeSquare` table, from an import made
   while the square was imported, its `squares` row's `feet` is the square: an
   override of it moves every token the next rescale writes (a token with no
   size category is that many feet on a side), and a blank, zero or negative
   figure leaves the stated constant. Clear the override and the tokens
   return.
7. Press "Rescale tokens on scene" with the
   character token and the party token present.
   *Observable:* the character token resizes to one square at the
   scene's scale, with or without the monsters tables imported; the party
   token is UNTOUCHED by this path.
7a. **An override needs no frontage.** With the world layer off the registry as
   in 6a, select the character token, stamp a footprint through the custom size field and its ✓, then press
   "Rescale tokens on scene".
   *Observable:* the stamped token carries `flags.acks-extras.footprint` and
   keeps the stamped size and is not counted among the tokens that kept theirs.
8. Open Map setup on two scenes of different `grid.distance` (Scene config
   → Grid), no scale bar measured.
   *Observable:* `app._prepareContext({})` returns `sizeChips`, one per size
   category whose frontage is imported, each labelled with the
   category and stamping its footprint (frontage times the square, in feet);
   its tooltip names the source, the page and the cells it draws at here, the
   same on both scenes. The two square-size chip rows read 1, 2, 10 and 20
   times its `grid.distance`, and an empty map-cell field's
   placeholder is the `grid.distance`; each scene shows its own. Select two
   tokens and click the Large chip in Token sizes, then the reset arrow beside the chips: both resize and
   carry `flags.acks-extras.footprint = {w, h}` at that category's feet; reset
   clears the flag and re-derives (monster back to its category, character to
   one square).
9. Coarse-map output: confirm the box value as 100, set output square 5.
   *Observable:* the grid-px field re-derives to box/20; after apply, each
   drawn box carries 20 Foundry squares whose lines coincide with the box
   edges, and `grid.distance` is 5. An output of 7.5 shows the
   will-not-coincide warning.
10. On the stretched scene: enable "Independent X / Y", sample boxes and
    corners.
    *Observable:* the fit panel shows two cell sizes; after apply, cells land
    square (the background scales anisotropically). Before applying, "Bake
    corrected image" is offered for this upright fit; pressing it bakes as in
    step 11, and a press that cannot (no background, no upload permission)
    raises a warning saying why.
11. On the skewed scene: enable "Allow skew", click ≥5 corners.
    *Observable:* the fit reports skew/rotation degrees and the preview
    lattice lies on the skewed lines; "Bake corrected image" appears. Press
    it: a `<name>-aligned.webp` appears beside the original, the scene
    background swaps to it, and the retained fit locks onto the new image;
    apply then behaves as step 5. The original image file is unchanged.
12. **A box that spans several cells.** On the square family, draw one box
    over a single drawn cell and a second over a strip of three cells in a
    row, and type 3 in the second row's "across" box, leaving "down" at 1.
    *Observable:* the fit's cell size is the single cell's on both axes, not a
    third of the strip's height; residual stays tight. Both rows carry an
    across and a down box. A box over a 2 × 3 block set to 2 across and 3 down
    reads the same cell. Scale-only offers the same two counts; a hex family
    offers none.
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
14. **Hex.** On `battlemap/hex-setup-feedback` reset to gridless, choose "Hex
    grid — rows (pointy top)" and set the units to miles. Walk the three
    routes in this order: a scale bar alone, then "Pick corners", then real
    drags of five boxes, each tight around one hex, over four rows.
    *Observable:* with the bar alone Apply stays disabled and a line under it
    says a bar does not place hexes and names "Draw box". "Pick corners" is
    refused with a notice naming "Draw box", and nothing is armed. The five
    boxes read tight in px off (0.70 on the reporter's hex). Red outlines of
    the fitted grid lie on the map's drawn hexes, and no across or down box
    is offered. The label reads "One drawn hex is"; with the unit changed and no
    bar it is blank and Apply waits for it. Before the apply, note one token's
    and one wall's position. Type the hex's worth (6) and apply.
    *Observable:* the confirmation says placed things move with the map, and
    the token and the wall keep their fraction of the scene's rectangle
    (step 14b reads it). The notice reads "Hex grid applied: grid size 51 px,
    6 mi per hex.", and `grid.type` is 2. With the scale changed from feet and
    no system declared, the footer's rows include the travel system, none →
    journey. Every
    drawn hex centre maps into its own Foundry hex: map each through the
    background sprite and compare with `canvas.grid.getCenterPoint(
    canvas.grid.getOffset(p))`. The farthest is within a few px (4.5 over
    1254 hexes), the residue of the scene's integer size. The flag reads
    `autoScale: false` at a mile a hex.
    Then keep ONE box and apply with "Even offset" unticked, then ticked.
    *Observable:* `grid.type` goes 2 → 3, and the drawn box's hex lands on a
    grid centre both times (1.65 and 1.49 px). Only the background's offset
    moves, by half a hex, and with it the hex numbering.
    Draw one lone box around a 2×2 block instead. *Observable today:* it is
    taken as one hex and reads fair, with only the other-family warning
    (ledger T-0592, open). Then draw a box tight around one hex AFTER it.
    *Observable:* the hex size is the one-hex box's, the block is the box
    left out ("larger than one hex"), and the same holds in the other order.
    Reopen the window on the applied scene with every sample erased.
    *Observable:* a line above the needs list says what the scene already is
    (hex rows, its grid size in px, its worth with the unit), its tooltip
    naming Scene configuration → Grid; it goes once a box is drawn. Hover the
    card's cell figure, the box count and a box row: each tooltip names its
    parts, and a box row's size has the card's one decimal.
14b. **Placed things move with the map.** On `battlemap/reposition-probe`
    (assert its grid first; it holds a wall, a token of
    `battlemap/plain-character` and one painted hex), read each one's place as
    a fraction of the scene's rectangle (`canvas.dimensions.sceneX/Y/Width/
    Height`), the painted region's grid-shape offsets and each offset's centre
    (`canvas.grid.getCenterPoint`) as a fraction of that rectangle. Draw boxes
    and apply the hex grid at a different hex size.
    *Observable:* the wall's ends keep their fraction (within a pixel), and so
    does the centre of the cell each offset now names, so does the token's
    top-left corner, and its centre
    stays inside the hex it was over, off that hex's centre by about half the
    change in its pixel size (2.5 px for 45 → 51 px hexes, 12 px for a 100 px
    gridless cell → 41 px hexes), the region's offset
    is the hex now under the place it had (core left the offset as it was; the
    apply re-keyed it, through the read taken before the write), and the map
    reads that terrain there (`layerValueAt`). `grid.size` reads back as
    applied. Change the scene's width as well (an apply that draws on a map of
    another size, not only another hex size) and read again: the offset follows
    the place as a fraction of the rectangle, not the pixel. A zone an import
    drew on the same scene (a `grid` shape on a Region with a behavior) is
    re-keyed the same way, on a square scene as on a hex one.
14c. **A unit edited in Scene configuration.** With the window open on a
    scene, change Scene configuration → Grid → Distance Units, then the grid
    type between the two hex parities.
    *Observable:* the window's units select and family follow each edit, and
    the footer's rows do not list a unit change back.
14a. **Hex columns.** On `battlemap/hex-cols-setup`, choose "Hex grid —
    columns (flat top)", miles, and drag five boxes across five columns.
    *Observable:* tight (1.0 px on a 40 px side). After the apply, `grid.type`
    is 4 and every drawn hex centre is within a few px of its grid centre.
14d. **Hexes the scene stretches.** On `battlemap/hex-rows-wide`, choose
    "Hex grid — rows (pointy top)" and drag two boxes, each tight around one
    hex, side by side in one row; then two more further along that row.
    *Observable:* no other-family line at two boxes or at four, and the fit
    reads the boxes' hexes. Choose "Hex grid — columns (flat top)" with the
    same two boxes: the other-family line names the family select. Then on
    `battlemap/hex-cols-wide`, choose columns and drag one box tight around
    one hex, then a second a few hexes away.
    *Observable:* one box already fits (the box row shows no "not one hex"),
    two read without a family line, and the red outlines lie on the drawn
    hexes. Apply at any worth: the scene's width and height come out in the
    image's own proportions, and every drawn hex centre is within a few px of
    its grid centre. Where the boxes cannot tell the families apart, the line
    reads "Draw another box around one single hex, a few hexes from the
    others" and no longer asks for three boxes across and down.
15. **Units and what they are worth.** After step 14's apply at 6 mi a hex,
    drop the plain character.
    *Observable:* the token keeps its prototype 1×1, because a mile-scale
    apply writes auto-sizing off. Turn it on (Scene configuration → Basics →
    Battlemap → Auto-size tokens) and drop again: the token lands at the
    quarter-square floor (0.25), not 0.5. `tokenSpan(5, 10)` gives the
    unconverted answer, which must not ship. Then drop a party actor. It takes Journey
    with a notice naming the scale as the reason, and the formation's
    `travel.mode` is `journey`. Set the scene's units to `ft` with the party
    there, return its mode to delve, then set `mi` again. It switches back,
    with the same notice.
15a. **The not-to-scale mark.** On a scene applied at 6 mi a hex
    (`battlemap/reposition-probe` or the step 14 scene), with the monsters
    tables imported, place a token of `battlemap/plain-character` at 1 × 1.
    *Observable:* the token carries one child named `acks-extras-scale-mark`,
    a pink rim with a handle at its lower right, on screen in a page that is
    not hidden. Hovering it reads, for the GM, four lines: drawn larger than
    its footprint, the size drawn at in mi, its footprint in ft, and its
    source with the page it came from. A move and a resize keep it; leave the
    scene and come back and it is there. On `formation/combat-scene` (square,
    5 ft) the same actor's token at one square carries none, and no party
    token carries one on either scene. Settings tab → Game Settings → ACKS II
    — Extras → Not-to-scale mark on tokens turns it off for this seat and on
    again. A Player seat sees it only on a token it can see, and its hover
    reads the first two lines alone. No `updateToken` is written by either
    seat while the mark draws.
16. **The scene's party system.** Set "Party system here" to In the city.
    *Observable:* the scene flag carries `mapSystem: "settlement"` at once,
    with no apply. Place a party token on the scene by hand (drag from the
    sidebar — a token created carrying a formation flag is a module placement
    and takes a different branch): the formation's `travel.mode` becomes
    `settlement`, its clock pauses, and a notification names the switch. Change
    the select to Journey with the party still there: it follows. Set it
    back to "Not declared": a formation already in a mode keeps it.
    Apply the grid with In the city declared: the declared system is not
    rewritten, and no travel-system row is listed.
17. The party token on the calibrated scene: see `docs/formation/TESTING.md`,
    "The column and its lights" (steps 1, 8 and 9). It is one cell at every
    scale in the `order` shape, and "Rescale tokens" leaves it alone.
18. A marker's token — a place's, an organisation's, a domain's — keeps the
    size it was drawn: walked in `docs/domains/TESTING.md`, step 18.
19. **Coming back to the group arms nothing.** On a hex fixture, arm the
    Country brush from the group, then Draw box, each followed by a press on
    another control and a press on the group's own button. Press both through
    the DOM (`#scene-controls [data-control="…"]`): a scripted
    `activate({control})` carries no press, so it does not exercise this.
    *Observable:* a tick after the return, `ui.controls.tool.name` is `off`,
    the session's mode and the brush are null, and `renderTerrainPaletteApp`
    fires no time. `ui.controls.activate({control: "acksBattlemap", tool:
    "square"})` still arms Draw box.
20. **Ctrl+Z takes the newest sample.** On the square family, draw a box,
    drag a scale bar, click a corner and draw a second box, then press Ctrl+Z
    four times with no field focused. *Observable:* the second box goes
    first, then the corner, then the bar, then the first box; a fifth press
    changes nothing.
21. **One render per edit.** With the Map setup window open on a square
    scene and three boxes drawn (their across/down fields posted), wrap the
    window's `render` to count, then change a number field once. *Observable:*
    exactly one render, and the same on a hex family.
22. **A unit the scene already spells its own way is kept.** On a
    scale-only scene whose grid units read `Miles` (`battlemap/unit-spelling`:
    gridless, built by the step when no scene carries the marker, and set back
    to `Miles` at the step's start), drag a scale bar, choose mi and Apply. *Observable:*
    `grid.units` still reads `Miles`, and the done notice shows `Miles`. A
    scene in `ft` with mi chosen is written `mi`.
23. **A loose square fit names its worst sample.** On `battlemap/scale-bar-map`
    with the square family, draw four boxes over four drawn cells (cell by
    cell, one drawn a third of a cell off its grid lines). *Observable:* the
    fit panel's warning reads "box 4 sits furthest off" with that box's row
    number (the same shape as the hex family's "box N"); erase the box and
    pick one corner a third of a cell off with Pick corners: the warning names
    "corner 1", counted among the corners alone. Erase down to two samples
    while the fit is still loose: the warning names none. `session.fit.worst`
    is the box index, or the box count plus the corner index.

## Teardown

The kept fixtures stay, each left at whatever grid its last walk applied; a
step that needs a starting shape asserts it. Sweep only what the run built and
tracked (`api.sweepTracked()`, `.claude/rules/live-testing.md` step 4): extra
tokens, a party actor dropped for step 15 (its formation goes with it). A
baked `-aligned.webp` cannot be deleted through Foundry, so a walk that is not
about Bake's upload replaces `FilePicker.upload` in the page for the press.
Map setup WRITES to whichever scene is viewed: confirm no scene outside the
run's fixtures changed.


## Terrain painting

Fixtures: a disposable HEX-gridded scene (any hex type) and a disposable
square-gridded scene; a disposable party with one member (for the journey
read).

1. Enter the Battlemap group, arm **Country brush**.
   *Observable:* the palette window opens on the Terrain pill with one swatch
   per encounter terrain that stands on a ground (twenty-one: no bare-ground
   swatch and no river, plus one per imported kind no encounter terrain
   covers) and the eraser; the toolbar shows the brush armed; calibration
   modes disarm.
2. Click and drag across the hex scene with two different brushes.
   *Observable:* one Region per painted terrain kind appears (name = the
   terrain's label, its colour the swatch's), `flags.acks-extras.terrain`
   set, **unlocked**, and its `shapes` ONE `grid` shape whose `offsets` are
   the painted cells as `{i, j}`: no polygon, and no cell flag; a drag
   writes each cell once; repainting a cell with the OTHER brush moves it
   between regions in one update (never two claims). Open the Region's own
   configuration: it is core's grid shape and its cells are core's to edit.
   Then move the palette window over an unpainted hex, pick a swatch with a
   few pixels of drag, drag the palette by its header, and drag one stroke
   from the board across the palette and back onto the board.
   *Observable:* no hex under the palette is painted by the pick, the header
   drag or the stroke's crossing; the stroke paints again once it is back on
   the board. A scripted drive fires `pointermove` at the palette element and
   reads `layerCellsOf(scene)` back, since PIXI hears that event on the document.
   Then fire a stroke at pointer speed: a press and nine `pointermove`s over
   ten adjacent hexes in one tick, with no pause between them.
   *Observable:* all ten hexes read the brush's value afterwards and sit in
   one Region (the scene's writes run one after another, so none is lost).
3. Erase a painted cell; erase a region's last cell. Then, with core's grid
   tool on the Regions layer, remove a painted cell from a Region that holds
   several and put it back.
   *Observable:* the offset leaves the grid shape; the emptied region is
   deleted. With the cell removed by the grid tool, the map reads it as
   unpainted (`layerValueAt`), the Territory or Domains mode stops drawing it
   and a domain's territory row for it reads as unpainted, with no repaint;
   put back, all three read it again.
4. View the square-grid scene and open Scene controls → Battlemap.
   *Observable:* the Country brush button (`button.tool[data-tool="terrain"]`
   in `#scene-controls-tools`) is `disabled` with `aria-disabled="true"` and
   the class `acks-extras-brush-off`, drawn dimmed and struck through, and its
   list item carries `data-tooltip-text` reading the hex-only line;
   `document.elementFromPoint` at the button's centre returns that list item
   (so hovering it shows the line through the tooltip manager), and a press
   on it arms nothing. View the hex scene: the button is enabled with no
   class and no tooltip text. Set the square scene's grid type to a hex type
   through its Scene configuration and back: the button follows at once,
   without a reload. Then arm the brush by script (`acksExtras.battlemap.terrain.
   openCountryBrush()`) on the square scene and click the board.
   *Observable:* the hex-only warning, once per stroke; no region appears.
5. Journey read: begin a journey on the painted hex scene and move the party
   token across a painted boundary.
   *Observable:* `travel.hex` picks up the offset and its letter-number
   label, `hexesEntered` counts the crossing (arriving in the FIRST hex
   names it without counting), and `travel.map` holds the hex's reading:
   the ground and the encounter table of a hex painted at the book's grain,
   `source` "map" for each. A region flagged with a bare ground key
   (`terrain: forest`, written by hand for the check — the brush does not
   lay one) reads that ground and the ground's default table; a hex region
   flagged as river reads the river's table and leaves the
   ground to the next source; an unpainted hex reads nothing from the
   terrain layer. The record's own `travel.ground` and
   `travel.encounterTerrain` are never written. The panel's ×-factor lines
   follow the painted terrain when travel tables are registered.
6. With the party on a hex painted at the book's grain and no word of the
   Judge's on the encounter table, press **Stock this hex**.
   *Observable:* the dialog's terrain select opens on the hex's painted kind.
7. Set the party down on a painted hex without walking it (the lost
   episode's step onto the true position is the user's path there).
   *Observable:* the hex is named, `travel.map` reads the new hex, and
   `hexesEntered` does not move.

Teardown: delete both scenes (their regions go with them) and the party
fixtures. The walk takes steps 1 and 5-7 on the fixtures of "The country's
layers and water" and the formation recipe's "The country", which it keeps,
and deletes none of these.

Drive mechanics (walked 2026-10-09 through the capture driver). View the hex
scene first (`scene.view()`, then wait for `canvas.ready` with
`canvas.scene.id`); a view requested while the last one is still loading is
refused with a warning and nothing switches. The palette is
`openTerrainPalette()`, and its `_prepareContext()` lists the swatches the
window renders; a swatch press is `button[data-brush="<key>"]` `.click()` in
the window's DOM, read back from `terrainPaint.brush`. The pointer path is the
session's catcher, `canvas.stage.children.find((c) => c.zIndex ===
10000).children[0]`, fed `emit("pointerdown", { getLocalPosition: () => point,
buttons: 1, nativeEvent: { target: canvas.app.view } })` with `point` from
`grid.getCenterPoint(offset)` (a stroke opens only on a press over the board,
`onBoard`); `"pointermove"`
with the same shape is the drag. `paintHexAt(scene, point, key)` (`null` to
erase) is the brush's own write and resolves `false` when nothing changes;
`terrainRegionsOf(scene)` lists the regions with their flags. The hex-only
warning is read through a wrapped `ui.notifications.warn`; one stroke on the
square scene fires it once, and a `"pointermove"` after it fires nothing. The
journey read is `tokenDoc.update({ x, y }, { animate: false })` to
`grid.getTopLeftPoint(offset)`, then `getFormation(id).travel.map` for the
cache and `travelOf(formation)` with its `provenance` for the resolution. The
Judge's word on the table is cleared with `applyTravelForm(id, { override: {
encounterTerrain: "" } })`. A token SET DOWN rather than
walked is `update(..., { ["acks-extras.lostTruth"]: true })` followed by
`seatJourneyHex(tokenDoc, formationId)`. A dialog is opened in one evaluate,
unawaited, and read or pressed in the next — an evaluate that awaits a
dialog's promise waits for a hand that never comes and times the driver out.

## Roads

Fixtures: three disposable scenes — gridless, square, and hex; a disposable
party with one member.

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
Arming a preset, however, SUCCEEDS on a
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
4. Drag THREE shapes on the SQUARE scene, well apart from each other. A bent
   street: two legs meeting at a right angle. A **T**: one long avenue dragged
   in a single sweep, then a side street begun on the MIDDLE of it — nowhere
   near either of the avenue's own ends. An **X**: two streets simply crossed,
   neither of them ending at the crossing.

   **Drag the X's two streets OBLIQUE — at an angle to the grid, neither of
   them level or upright, and crossing at something well off a right angle.**
   This is not a garnish. The pairing index a crossing is found through covers
   whole rows for a level line and whole columns for an upright one, so an
   axis-aligned pair shares a cell of it whatever shape that index is in: it is
   the one orientation that cannot fail, and an X drawn along the squares
   passes this step on a build where every oblique crossing in the world is
   unnoded. Drag the T oblique too, for the same reason.

   *Observable:* one Wall document per leg, each with `move`/`sight`/`sound`/
   `light` all NONE, `door` NONE, and the road flag; the GM overlay tints them;
   a player seat sees nothing drawn.
5. Read the network: `roadGraph(scene)`, and count the edges each wall became
   with `graph.edges.filter((e) => e.meta.wallId === <id>)`.
   *Observable:* the bend gives three nodes for two legs — the shared corner is
   ONE node, because ends dragged by hand land within the join tolerance rather
   than identically, and each leg is one edge.

   **The two shapes the bend cannot prove.** At the T, a node sits where the
   side street lands and the AVENUE is two edges either side of it, though the
   avenue has no endpoint there. At the X, a node sits at the crossing that
   NEITHER wall has an endpoint at, and both streets are two edges each. A wall
   cut into pieces keeps one `meta` across them — `new Set(pieces.map((e) =>
   e.meta)).size` is 1 — which is why a consumer naming the roads a route used
   dedupes on `meta` and never on the edge index.

   `shortestPath(graph, a, b)` answers between the T's two arms and between the
   X's two streets. A null there is the failure this step exists to catch: it
   means the roads were noded at their ends only and each shape is two islands.
   Edit one wall and read again: the network is rebuilt.
6. Measure across each junction: `acksExtras.battlemap.roads.roadDistance(
   scene, from, to)` with `from` part-way down the side street and `to`
   part-way along the avenue on the far side of the T.
   *Observable:* a result rather than null, whose `along` is the walk down the
   stem PLUS the walk along the avenue — longer than the chord between the two
   points, and `offRoad` ~0 because both ends stand on a street. The same
   across the X. Null here is the same failure as a null path above, and it is
   what a turn falls back to the chord on.
7. Select an ordinary blocking wall and press **Mark the selected walls as
   roads** on the Walls control.
   *Observable:* the flag is added, the wall's own restrictions are NOT
   changed, and a warning says it still restricts movement. Its own sheet
   carries the road row and the same warning.
8. Open the **wall palette** — the Walls control's own wall tool, with no wall
   selected — and look for the module's rows on it.
   *Observable:* the road row is ABSENT, and so is the trap drop row, while a
   PLACED wall's own sheet (step 9) still carries both. That absence is the one
   observable separating the fix from the bug: the palette edits an unsaved
   preview document with no id, so a flag write aimed at it has nothing to land
   on — the row would offer a control whose every press is discarded. Rows
   present here is the failure, however well they render.
9. Open a road wall's sheet and change its surface, street and name.
   *Observable:* each field writes immediately (the sheet's own submit knows
   nothing of the flag); choosing **Not a road** removes the flag; the row
   never appears twice however many times the sheet re-renders.

   **Then type a street name carrying a double quote and an ampersand** —
   `The "Bell" & Anchor` — into the name field, click another control so the
   write fires, close the sheet and reopen it. *Observable:* the name comes
   back WHOLE, both characters included, and the row renders it as text rather
   than as markup. A name truncated at the quote, or an `&amp;` shown to the
   Judge, is the flag round-tripping through markup somewhere it should not.
10. Repeat step 4 on the GRIDLESS scene and on the HEX scene.
    *Observable:* the same walls and the same network, junction nodes included
    — and on a GRIDLESS scene there is no "along the squares" to fall back on,
    so drag the X there at a third angle again. On the hex scene,
    `derivedRoutesOf(scene)` returns one link per adjacent-hex crossing and
    `stepBetweenHexes(scene, from, to)` answers `{on: true}` for a crossing the
    road makes.
11. Journey read on the hex scene: move the party across a crossing the drawn
    road makes.
    *Observable:* `travel.map.road` is the drawn road's surface, and the
    Country section's road card reads it with no chip.

Teardown: delete the three scenes (their walls go with them) and the party
fixtures. Press a road preset once more if the run left the trap preset armed —
the preset is CLIENT state — one slot per seat, not per world — so it outlives
the run on the browser profile that drove it while disturbing no other seat, and
it is the one thing here a sweep cannot delete. The walk takes step 11 on the
formation recipe's "The country" fixtures, which it keeps.

## The country's layers and water

Fixtures, found by marker (`flags.world.fixture`) or built carrying it: a
square-gridded scene `battlemap/layers-square` with a scale in miles, kept and
written back to its grid with its battlemap record unset (one holding a
region, a wall or a token is rebuilt); and a HEX-gridded scene
`battlemap/layers-hex` for steps 1-8, rebuilt every run, since what it is
walked for is a brush or a line tool on an empty map. It is retired before it
is built, and takes the regions and walls drawn on it with it. Nothing else: every read here is `countryAt` over the scene
document, and the party's half is `docs/formation/TESTING.md`, "The country".

**Drive mechanics.** View the hex scene first, as for terrain painting. The
API is `acksExtras.battlemap.terrain` (`paintHexAt(scene, point, value,
layer)`, `layerValueAt`, `layerRegionsOf`, `openCountryBrush`),
`acksExtras.battlemap.water` (`waterWallData`, `waterUnder`, the preset and the
from-selection tool) and `acksExtras.battlemap.country` (`countryAt`,
`sceneCountry`, `writeSceneSetup`). A palette pill is
`button[data-action="pickLayer"][data-layer="<layer>"]` `.click()`, a swatch
`button[data-brush="<value>"]`; the window's `_prepareContext()` lists both. A
point is `scene.grid.getCenterPoint(offset)`. A water line for the reading
steps can be `scene.createEmbeddedDocuments("Wall", [{c, ...waterWallData({kind})}])`,
tracked by the id it returns — but one line must be DRAWN with the preset,
because the preset is what step 4 proves. The Map setup window's three country
selects are driven as its other selects are: set `.value` and dispatch a
bubbling `change`.

1. Arm **Country brush** and press the **Territory** pill.
   *Observable:* the swatches become the four territories, each in its own
   colour, with the eraser; `paintHexAt` and a real click both paint. Paint two
   hexes one territory and a third, already painted with a terrain, another.
   One region per territory value appears, flagged `territory`, its cells one
   core grid shape and the region unlocked, with `visibility` 0 (LAYER, the Regions control alone): a
   player seat sees no territory drawn, and the GM sees it as the Territory
   map mode (§Map modes). The terrain region of the third hex still lists that hex.
2. Look for a **Climate** pill, and paint the third hex with a climate from
   the console (`paintHexAt(scene, point, <a climate code>, "climate")`).
   *Observable:* the pills are Terrain and Territory alone, the Territory pill
   still pressed; the call returns false and no region flagged `climate`
   appears.
3. On the Territory pill, erase the third hex; then paint the first hex with
   the second territory.
   *Observable:* the erase removes the territory alone — the terrain stays;
   the repaint moves the hex between territory regions, and a region left with
   no hex is deleted.
4. Press the **River** preset in the Battlemap group and drag a line across two
   hexes; press **Coastline** and drag another.
   *Observable:* the notification names what is armed; core's wall preset holds
   all-NONE restrictions, `door: 0` and `flags["acks-extras"].water` (`kind`
   river and `navigable` true, then coast and false); one Wall per line carries
   the flag; while the Walls or Battlemap controls are active the GM overlay
   draws the river solid and the coast dashed, and a player seat sees neither
   drawn.
5. Open the river's wall sheet.
   *Observable:* the water row shows its kind, the boat tick and the name; each
   change writes at once; **Not water** removes the flag and leaves the wall's
   own restrictions alone. Select an ordinary blocking wall and press **Mark
   the selected walls as water** on the Walls control: the flag lands, the
   restrictions do not change, and a warning says the party cannot cross it.
   Untick the river line's boat tick, select that line and press the tool
   again: `updated` 1 and `navigable` still false.
   Press the **Coastline** preset, select a second ordinary wall and press
   the tool: that wall's flag reads `kind` coast, the armed kind; with core's
   ordinary wall armed instead, the tool marks a river. Press **Paved road**,
   then **Alley (of the armed road)**, select a third ordinary wall and press
   **Mark the selected walls as roads** on the Walls control: its road flag
   reads surface paved and street alley, the preset's pair; with core's
   ordinary wall armed, the tool marks the first surface and no street.
6. In the Map setup window, set the scene's Ground here, Territory and Climate.
   *Observable:* `flags["acks-extras"].battlemap.country` holds the three keys
   at once, with no apply, and the record's other fields are unchanged;
   `sceneCountry(scene)` returns them; setting a select back to "Not said"
   clears its key.
7. Read the country back from the console with `countryAt(scene, point)` at the
   centres of: the hex painted on both layers; an unpainted hex well off
   both lines; a hex the river crosses; a hex the coast crosses.
   *Observable:* the painted hex answers its painted terrain's ground and
   table and its territory, each with `source.<key>` "map", and the scene
   default's climate with "scene"; the unpainted hex answers the scene default's three with "scene", `following`
   "none" with "map" (the scene has water lines), and `road` null with
   `source.road` null (no road is drawn here — a road's reading is the Roads
   recipe above); the river hex answers `following` "river" and `water`
   `{kind: "river", navigable: true}`; the coast hex answers `following`
   "none" and `water` with `navigable` false. With `{waterBorne: true}` the
   river hex's `encounterTerrain` is a river table, the desert-and-jungle one
   when its ground is a desert or a jungle.
8. On the square scene, set Ground here in the Map setup window, arm the brush
   and click; then call `countryAt` there.
   *Observable:* the hex-only warning, once per stroke, and no region; the
   ground reads the default with `source.ground` "scene", and the unset
   territory and climate read null with a null source.
9. Register a third layer from the console. `registerPaintLayer` is not on
   the API; take it from the loaded module with `const tp = await
   import("/modules/acks-extras/scripts/battlemap/terrain-paint.mjs")` (the
   same instance the module runs), then register a throwaway layer with its
   own two flags, a `values()` over a variable you hold and a `title`.
   Keep its returned handle. With the variable empty, open the Country brush.
   *Observable:* only the two pills show. Fill the variable and re-render
   the palette (`foundry.applications.instances.get("acks-extras-terrain-palette").render()`):
   a third pill appears under its own title; pressing it lists the values as
   swatches, grouped where `groups` was given, and a swatch arms the brush on
   the layer. Click a hex of the hex scene by a real pointer event: one region,
   flagged with the layer's two flags, `visibility` 1 (2 where `visible` was
   set), and the other two layers read nothing at that hex; the eraser takes
   it out again. A second registration of a key already held throws. Call the
   handle: the pill goes, the brush returns to terrain, and the region stays in
   the scene, read by nothing (`layerRegionsOf` answers empty for the key; count
   the scene's regions by the flag to see it). The registration lives in the
   page alone and goes with a reload.
Teardown: none of the scenes; the next run retires the hex maps. The wall
preset is client state: arm core's ordinary wall once more if the run left a
water preset armed, so this seat's next wall is not a river.

## Map modes

Fixtures, found by marker (`flags.world.fixture`) or built carrying it: a
HEX-gridded scene `battlemap/modes-hex` whose scene default names a territory
and a climate, with one water line for step 3's markers; and a square-gridded scene
`battlemap/modes-square`. The hex scene is rebuilt every run — retired with
what was drawn on it, then built — since the steps paint and draw on it; the
square one is kept and written back to its grid with its battlemap record
unset (one holding a region, a wall or a token is rebuilt).

**Drive mechanics.** The API is `acksExtras.battlemap.mapModes` (`mapModes`,
`mapView`, `setMapView`, `openMapModes`, `registerMapMode`). The window is
`foundry.applications.instances.get("acks-extras-map-modes")`; a mode pill is
`button[data-action="pickMode"][data-mode="<key>"]`, the opacity
`input[name="opacity"]` and the handout `input[name="handout"]`, driven by
setting the value or `checked` and dispatching a bubbling `change`. The
overlay is `canvas.regions.getChildByName("acks-extras-map-modes")`; its one
`PIXI.Graphics` child is the drawing, and `borderSegments(scene,
territoryPlan(scene))` and `stripeSegments(scene, territoryPlan(scene))` from
the loaded module (`await
import("/modules/acks-extras/scripts/battlemap/map-modes.mjs")`) say what it
should draw; `finishPoly()` on it closes the last path before its
`geometry.graphicsData` is counted. The road and water markers are
`canvas.controls.getChildByName("acks-extras-road-markers")`. The view is
each seat's client setting, so the walk reads both at the start and sets them
back at the end.

1. Arm the Country brush, press the **Territory** pill and paint a cluster of
   three hexes one territory and a fourth, beside them, another.
   *Observable:* `mapView().mode` is "territory" and the Map modes window
   opens with Territory pressed, the four territories listed in their colours,
   the unpainted line naming the scene default's territory and the climate
   line naming its climate. The overlay draws one Graphics child; each hex's
   border runs inside the hex, only on its sides facing another class or
   unpainted land, so the two classes meeting show two lines; the terrain fill
   reads between them. No hatch is drawn for the territory regions.
2. Disarm the brush and switch to the Tokens control.
   *Observable:* the borders stay drawn.
3. Drag the opacity to its floor, then tick **Handout view**.
   *Observable:* the overlay's alpha is 0.2 at the floor; with the handout
   ticked the overlay holds no child, and on the Walls control the road and
   water markers are not drawn. Untick it: both come back.
4. Join a player seat on the scene.
   *Observable:* the player's overlay holds no child and no territory region
   is drawn.
5. As the GM, press **Terrain** in the window; re-arm the brush from the
   toolbar; press the palette's Terrain pill, then its Territory pill.
   *Observable:* Terrain empties the overlay and the window lists no legend;
   the brush arms on its last layer, territory, and shows that mode; the
   Terrain pill empties the overlay again; the Territory pill brings the
   borders back.
6. Repaint one hex of the cluster the other territory.
   *Observable:* the overlay redraws within a moment, the hex's borders moved.
7. Press **Terrain** in the window, then paint one more hex of the cluster
   with the brush still on the Territory pill; then tick **Handout view** and
   paint another.
   *Observable:* the Terrain pick stands until the stroke; at the stroke's
   first hex `mapView()` reads mode "territory" and handout false, the
   window shows Territory pressed and the new hex is drawn. The handout tick
   likewise stands until the next stroke, which unticks it. A pick with no
   stroke after it is still the pick a second later.
8. Close the palette from its header with the brush armed from the toolbar.
   *Observable:* `terrainPaint.brush` is null, the group's active tool is
   its resting tool (`ui.controls.tool.name` "off") and the Country brush is
   no longer lit; a click on the canvas paints nothing; a press on **Country
   brush** arms it again and the palette renders. Arm it from a party sheet's
   paint chip instead and close the palette: the brush is null and the
   toolbar's tool is whatever it was.
9. View the square scene with the window open.
   *Observable:* the window says the modes are drawn on a hex map, and the
   overlay holds no child.

Teardown: none of the scenes; the next run retires the hex one. Set this
seat's view back with `setMapView({mode: "terrain", opacity: 0.85, handout:
false})`.

A territory derived from a deriving layer, the stripes over an overridden hex,
a weighted side and a redraw on `paintLayerChanged` need a registrant's data,
and are walked with the Domains mode (`docs/domains/TESTING.md`, "Territory
on the map").

## The navigation card's system icon

The walk is `tools/live/battlemap-nav.mjs` (`node tools/live/run.mjs
battlemap-nav`), steps 1-7 below.

Fixtures, found by marker (`flags.world.fixture`) or built carrying it, all
kept: a square-gridded scene `battlemap/scene-nav-map` with a dungeon-scale
grid in feet, no district and nothing declared, in the navigation and
readable by a player (ownership default observer), so an undeclared map has
no fallback and the player seat lists its card; a second such scene
`battlemap/scene-nav-other` the GM views while picking on the map's card; a
party actor `battlemap/scene-nav-party`; and its token on the map,
`battlemap/scene-nav-party-token`, found on the map's tokens by its marker or
placed carrying it, which the formation adopts as the party token. Each step
starts from the map declaring nothing, the party on a journey
(`setJourneyMode`), the GM viewing the other scene with the navigation
expanded (`ui.nav.expand()`), and no picker open.

**Drive mechanics.** The icon is `#scene-navigation .scene[data-scene-id="<id>"]
.acks-extras-scene-system`, a `<button>` with `data-system` (`delve`,
`journey`, `settlement` or `none`), `data-tooltip` (the lang key) and an
`aria-label`. A click is dispatched as a `MouseEvent("click", {bubbles: true,
clientX, clientY})` with the icon's own box coordinates: core's ContextMenu
positions the picker at the icon and refuses to open on a card that is not
visible, so the navigation must be expanded first. The picker is
`#context-menu`; an entry is `.context-item` whose `span` holds the localized
label, pressed with a bubbling click. The right click is a bubbling
`MouseEvent("contextmenu")` on the icon. The flag is read with
`acksExtras.battlemap.sceneTravelSystem(scene)`, the party's mode with
`acksExtras.formation.travel.travelOf(record).mode`, and an adoption is
announced as a toast (`ui.notifications.info`, patched to record), never as
a chat card. The setup panel's select is `select[name="mapSystem"]` in
`foundry.applications.instances.get("acks-extras-battlemap")`.

1. Shape the fixtures, GM on the other scene.
   *Observable:* every scene card in the navigation carries exactly one icon,
   no card two, no level row one; the map's icon is a button with
   `data-action="acksExtrasSceneSystem"`, `data-system="none"`, the
   `fa-circle-question` glyph, `data-tooltip` `ACKS-BATTLEMAP.nav.tip.none`,
   an `aria-label` equal to the formatted `ACKS-BATTLEMAP.nav.face` with the
   "not declared" label, `aria-haspopup="menu"`, no `title`, visible.
2. Click the map's icon; press **Dungeon**.
   *Observable:* the picker opens (`ui.context` is the click-opened menu)
   listing Dungeon, Wilderness, Settlement and no clearing entry, none
   marked; the GM still views the other scene (the click viewed nothing).
   After the press the flag reads `delve`, the card's icon reads
   `data-system="delve"` with the `fa-dungeon` glyph, its tooltip key and
   label (core re-rendered the navigation on the flag write), the picker is
   closed, and the standing party's mode is `delve` within a few seconds,
   announced as a toast naming the party.
3. Right-click the map's icon.
   *Observable:* the flag is null and the icon reads `none`; no
   `#context-menu` is open and `ui.context` is null (neither the picker nor
   core's scene menu); the party's mode is still `delve` and no toast names
   the party (other toasts, the importer's book openings among them, arrive
   on their own schedule): a map that declares nothing leaves the party
   where it was.
4. Click the icon and press **Wilderness**; click it again; press **Leave to
   the party**.
   *Observable:* the party's mode is `journey`; the second picker lists four
   entries with Wilderness marked (`acks-extras-scene-system-current`) and
   the clearing entry last; the clearing entry clears the flag and the face,
   and the party stays on its journey with no toast naming it.
5. View the map and open the setup panel; click the viewed card's icon and
   press **Settlement**; then right-click the icon.
   *Observable:* the panel opens with its select on *Leave to the party* and
   the session's `mapSystem` null; after the press the select reads
   `settlement` and so does the session; the party crosses in blocks
   (`settlement`); after the right click the select and the session are
   empty again.
6. On the player seat, expand the navigation.
   *Observable:* the map's card is listed; it carries no
   `.acks-extras-scene-system`, and no card of the player's does.
7. Read both seats' console recorders.
   *Observable:* no console error since the recorder was installed (after
   `ready`).

Teardown: none of the fixtures; the map is left declaring nothing and the
party on whatever mode the last step left. Each seat's notification patch
is undone, the panel and any picker closed, and the navigation collapsed.
