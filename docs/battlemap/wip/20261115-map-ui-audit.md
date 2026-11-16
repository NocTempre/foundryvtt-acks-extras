# Map tools — UI audit and the not-to-scale mark

**NOT IN EFFECT.** Inputs to Phase 3 of
[20261115-map-setup-revision.md](20261115-map-setup-revision.md), written in
`main`'s tree while that plan's branch is open. When Phase 3's work lands,
what this file holds moves into `MODEL.md`, `DECISIONS.md`, `TESTING.md` and
the bug-intake ledger, and the file is deleted in the same session.

## 1. Owner rulings made after the plan's branch opened

- **The square family's spans** (the plan's §5 Q2), 2026-11-15. Asked whether
  the one count becomes two, the owner chose: "Two numbers (recommended): “3
  across, 1 down”. Any box shape works." Slice G is in: a box on a square
  grid carries a count across and a count down, and a strip of three by one
  fits exactly.

## 2. The not-to-scale mark (slice I)

**Ruled** (owner, 2026-11-15, answering whether a mile-scale apply leaves
token auto-sizing off): "Yes, and Anything that is outside scale should get a
border (maybe a looking glass effect?) to clarify that it is not to scale."

Restated with one example: a token whose size on the map is not its footprint
at the scene's scale carries a visible frame that says so. A six-mile hex
apply leaves auto-sizing off, so a plain character stays one cell wide: a man
drawn six miles across, and he gets the frame.

What follows is an `architect`'s design from that sentence, read from the
code and not walked.

### The predicate

`footprint.mjs` gains a pure `scaleMismatch({feet, feetPerCell, width,
height, step = SPAN_STEP})`, `width` and `height` being the token's stored
size in cells. It answers null with no footprint or no usable cell. Otherwise
the exact size is `feet / feetPerCell` on each axis, unrounded, and an axis is
off when the drawn size differs from it by more than half the step the sizer
rounds to. The answer is null or `{dir: "larger" | "smaller" | "mixed",
exact}`. It never compares against `tokenSpan` or `sizeForToken`: their floor
would call the floored man right.

`token-scale.mjs` exports `footprintOf(tokenDoc, scene)`, answering
`{judged, feet, feetPerCell, source}` with `source` one of token, actor, size
or square. `resolveSize` is rebuilt on it and keeps the lock check, so
`sizeForToken` and `unsizedTokenCount` answer as they do now.

| Token | Marked | Why |
|---|---|---|
| The party token | never judged | it has no body, so no footprint |
| A marker actor's token | never judged | it is as big as the Judge drew it |
| A scene with no usable distance | never judged | no scale to compare against |
| A `footprintLock` token | judged | the lock stops writes, and the mark writes nothing |
| A gridless scene with a distance | judged | its distance still sets a scale |
| Nothing imported | no mark | the mark needs a figure, and a missing import stays blank |

### How it is drawn

A new `scripts/battlemap/scale-mark.mjs` is the mark's one owner, on hooks
alone, with no wrap of core. The precedent is the `refreshToken` listeners in
`formation/column-view.mjs` and `lib/group-encounter.mjs`. Each marked token
gets one `PIXI.Graphics` child of the token's own container (named
`acks-extras-scale-mark`, deaf to pointer events, behind the token's own
drawing), rebuilt when found destroyed, since core clears a token's children
on a redraw. Being a child, it moves with the token and hides with fog and
with a hidden token.

The look is a magnifying glass drawn as a border, which is both of the
owner's suggestions at the cost of one: a rim along the token's own shape,
clear of core's border, and a short handle from its lower right. Solid, since
core dashes a hidden token's border, and in none of the disposition colours.

The listener returns at once unless the refresh carries a size, shape, state
or visibility flag, and redraws only when its key (the token's size, the
cell's worth, the footprint, the interface scale) changes. It re-judges on a
token's or actor's footprint flags changing, on the monsters tables changing,
and on its own setting. Nothing is written to any document; each client works
it out for itself.

### Who sees it, and what it says

Every seat, always, and the handout view leaves it alone: a player judging
distance by eye is the reader a six-mile man misleads most. A client setting
turns the drawing off for that seat (Settings tab → Game Settings → ACKS II —
Extras). It has no second home in the Map modes window.

On hover, canvas text under the nameplate (the trap markers' hover text is
the precedent; the canvas has no tooltip manager) says which way the token is
off, the size it is drawn at in the scene's units, its footprint in feet, and
where the footprint comes from (set on the token, set on the actor, its size
category with the imported frontage and square and their page reference, or
the imported square alone). A seat that is neither the GM nor the token's
owner sees the first two lines only. Every figure is read from the world at
render; no rule sentence and no printed value ships.

### What it touches

`footprint.mjs`, `token-scale.mjs`, the new `scale-mark.mjs`, `module.mjs`
(installed beside `installTokenAutoScale`), `lang/en.json` under
`ACKS-BATTLEMAP.scaleMark`, and `tools/test-battlemap.mjs`, which pins the
predicate at both sides of its tolerance, the floor, an exact fit, each
direction, each axis, null inputs and a half-cell step, and `footprintOf`'s
exclusions and four sources over a made-up square. `MODEL.md` gains a
paragraph under "Token sizing — ownership", `TESTING.md` a step, `DECISIONS.md`
an entry opening with the owner's sentence, and the slice ships a changelog
fragment. Slice E's mile-scale line names the ring.

### Acceptance, from the Judge's seat

- A mile-scale hex scene, a one-cell character: the mark is drawn, its hover
  reads larger with the drawn size, the footprint and its source, and it is
  still there after a move, a resize and a change of scene and back.
- A square scene whose cell is the imported square, the same character: no
  mark. A large monster resized there: no mark; set to one cell it reads
  smaller.
- The party token on both scenes, and a marker's token: no mark.
- A player seat: marks only on tokens it can see, the two-line hover on a
  token it does not own, and a watcher on token updates records no write from
  either seat.

Fixtures, by marker: scenes `battlemap/scale-mark-hex` and
`battlemap/scale-mark-square`; tokens `battlemap/scale-mark-man` and
`battlemap/scale-mark-large`.

### Owner questions on the mark

**Ruled** (owner, 2026-11-15, asked "Build the not-to-scale mark with its
three defaults?"): "Keep defaults". Slice I builds the first answer of each.

1. Do players see the mark? **Yes** / Judge only (the handout view then hides
   it).
2. Does the party token, one cell at every scale, get the mark? **No** / Yes.
3. Can each seat turn it off? **Yes** / No switch.

### Rejected

Core's dynamic token ring (turning it on writes to the token document); a
true magnifying filter (a filter pass per token per frame); recolouring core's
border (it shows only on hover or selection); an icon-font glyph (the canvas
draws none); comparing against the sizer's own answer (its floor hides the
owner's example); a stand-in footprint where nothing is imported (a figure in
source); a field in the Map modes view (only a Judge reaches it).

### Not verified, and what to expect

Nothing was walked. Whether core holds a token's width to half cells is still
open (the schema shows no step; the plan's Phase 2 walk reads it), and the
tolerance follows `SPAN_STEP` if that changes. On a map whose cell is twice
the imported square, every one-square token nobody sized gets the ring until
it is resized. Canvas text does not follow the type-size knob, as the trap
markers' text does not.

## 3. The UI audit (slice J)

The owner, 2026-11-15, asked what else is wrong with the map tools: "I
noticed a lot of bugs and duplication in the UI". No bug was named, so an
`architect` read the map tools' surfaces in `main`'s tree at `98cf65cf`, with
core 14's client source beside it. **Nothing here was walked.** Phase 3's
surface walk comes first and adds what is on screen; where the walk and this
list disagree, the walk wins.

Each finding is new: none repeats the plan's §3 or §8. The tags: **C** is
read in the code, **I** is inferred and names the probe that settles it;
**D** is a defect, **Cf** confuses, **Co** is cosmetic. The planning session
re-read 1 to 5 and 17 in the source, and 1 in core's `Scene#_preUpdate`, and
they stand as written, but for two sentences it did not open: the guide's in
1 and the DECISIONS entry's in 4. The rest are the architect's reading alone.

The list was read before slices C and F rewrote `assistant-app.mjs`,
`apply.mjs` and `capture.mjs`. Phase 3 finds each again by its symbol on the
landed tree and drops what Phase 2 already changed; 6 to 10, 13 and 14 are
the likely ones.

### The setup window and the ways into it

1. **An apply moves nothing but the map.** The confirmation
   (`apply.confirmShift`) and the guide's "Applying" section say placed
   tokens, tiles and walls move in proportion. No apply in `apply.mjs` passes
   `autoReposition`, and core's `Scene#_preUpdate` moves placed things only
   under that option. Walls, roads, tokens and painted regions stay at their
   old pixels over a map that was rescaled. C, D.
2. **The window jumps to its top.** The `body` part scrolls and declares no
   `scrollable`, and a chip press, a new sample or a deleted one re-renders
   it. C, Cf.
3. **Bake can do nothing.** `canBake` offers the button for unequal X and Y
   on an upright fit; `#onBake` returns unless the fit is a skewed one
   (`fit.u`), though `bakeCorrectedBackground` handles both. The press does
   nothing and says nothing. C, D.
4. **Rescale never says what it left alone.** `#onRescaleTokens` reports the
   count rescaled and nothing else, and `unsizedTokenCount` has no caller.
   DECISIONS 2026-11-13 promises a warning when the square and the frontage
   are not both imported; in a world without them every press reads 0. C, D.
5. **"Calibrate…" opens the wrong scene.** The Scene configuration button
   (`installSceneConfigRow`) calls `openAssistant()`, which takes no scene;
   the window reads `canvas.scene` and never names its scene. Opened from the
   configuration of a scene that is not on the canvas, it shows and applies
   to the one that is. C, D.
6. **A unit edited in core is written back.** `session.units` and `hexEven`
   are adopted only when the scene id changes, and `sessionFollowsScene`
   mirrors `mapSystem` alone. After a unit edit in Scene configuration the
   select shows the old unit and Apply restores it. C, D.
7. On a hex family the label reads "Hex size (px)" and the hint under it
   (`gridPxHint`) speaks of a Foundry square. C, Co.
8. `apply.confirmTitle` ("Apply grid calibration?") heads the scale-only
   confirmation, whose body says the grid is unchanged. C, Co.
9. On the scale-only family with boxes drawn, `pxPerUnit` divides by
   `mapCellFeet`, a field that family hides. The ruler written comes from a
   value typed under another family, or from the scene's old distance. C, Cf.
10. One "px" names two pixel spaces. The card's cell, the box rows and the
    scale bar are in image pixels; "Square size (px)" and "Measured: N px per
    …" are in canvas pixels. They differ whenever the texture is scaled,
    which is after every apply. C, Cf.
11. Three glyph buttons have a `data-tooltip` and no `aria-label`: a
    sample's ×, the reset ↺ and the custom size's ✓. C, Co.
12. No tooltip on the card's cell size, residual, skew and rotation, px per
    unit, "From scale bar", or the sample rows' sizes
    (`.claude/rules/ui-tooltips.md`). C, Cf.
13. The size chips act on the selected tokens. With none selected the notice
    reads "0 token(s) set to …", and only ↺'s tooltip says "selected". C, Cf.
14. `#submit` renders twice plus once per box on every change (`setBoxCells`
    notifies per box, `setSetup` notifies, then `render`). On a hex family
    each render clones the scene in `hexProbe`. C, Co.
15. The custom size's ✓ is disabled until the field's `change` fires, so a
    value typed and then clicked is probably lost. I: type a value, click ✓
    once with a token selected, look for the notice. Cf.
16. The stylesheet re-takes `--acks-fs-base` on the body's inputs and
    buttons and not on its `select`s or the header. I: raise the type size
    and compare the computed size of `select[name=gridFamily]` and
    `.window-title`. Co.

### The capture tools and their group

17. **Ctrl+Z is taken from every text field.** `CaptureOverlay.onKeyDown`
    listens on `document` while a mode is armed and skips no input. Typed
    into the window, chat or a journal, it deletes a sample and swallows the
    text undo. C, D.
18. `removeLast` removes the scale bar first, then goes by count. MODEL says
    "the newest sample". C, Cf.
19. Leaving the group disarms and does not select `off`. Core remembers a
    control's last tool, so coming back re-arms that capture mode or the
    brush, which can open three windows. `installSceneControls` says entering
    the group arms nothing. C, Cf.
20. The corners hint says three or more corners "let the fit see rotation and
    skew". The skewed fit runs only with Allow skew ticked, a checkbox near
    the window's foot. C, Cf.
21. Three names. "Wipe", a trash glyph beside the water presets, removes
    every sample unasked, and its hint (`samples.wipeHint`) is never read.
    "Eraser" removes samples where the palette's "Erase" unpaints hexes. And
    "Stop sampling" is the brush's only stop: `terrain-paint.mjs` handles no
    Escape. C, Cf.

### One window, seven names

31. "Map Setup — Scale, Grid & Tokens" (its title), "Map setup panel" (the
    toolbar tool), "Map setup" (its first heading), "Calibrate…" (the Scene
    configuration button), "map alignment assistant" (that row's hint),
    "Battlemap window" (MODEL) and "Map alignment & token scale" (the guide).
    C, Cf.

### Seen on screen (Phase 3's surface walk)

Walked 2026-11-15 on `main` at 001316c2, GM seat, 1366×768, on
`battlemap/hex-setup-feedback` as Phase 2 left it (hex rows, 6 mi), with the
Battlemap group, the setup window in all four families, the brush palette,
Map modes, the Scene configuration row and the navigation card's icon. Each is
new unless it says which finding it confirms. **W** is walked.

32. **A scene applied as hex cannot be set up again as square.** The square
    family's needs line refuses it ("This scene uses a hex grid…") and offers
    a hex family or scale only. The way out, the grid set back to gridless in
    Scene configuration, is named nowhere, so a map applied as the wrong
    family is stuck as far as the window is concerned (`apply.mjs`
    `solveGridCalibration`, `CALIBRATABLE_GRIDS`). W, D. Slice D: the line
    names the way out.
33. **Three windows on one spot.** The setup window opens 760 px tall in a
    768 px viewport. The brush palette (from the toolbar) and Map modes open
    at fixed points over its right edge and over each other. W, Co.
34. **The country block splits the setup.** Ground, territory and climate
    (21, 4 and 31 options) sit between the units select and the needs line,
    so the cell's worth and the needs line are a screen below the units. The
    ground and territory lists repeat the brush palette's swatches word for
    word, and both windows show them at once. W, Cf. Slice D: the block moves
    under its "saved as you choose" heading, below the scale.
35. **Reopened on a scene already applied**, the window reads as a fresh map:
    "Draw a box…", a blank hex size, and nothing that says the scene is
    already a 6 mi hex grid. W, Cf. Slice D's already-matches row.
36. One box, two roundings: the box row reads "31×47 px" where the card reads
    "30.7 × 47.3". W, Co. J1.
37. On a 6 mi scene the scale-only and square families offer 6, 12, 60 and
    120 mi chips, and the ruler-cell chips are multiples of the scene's own
    distance whatever it is. W, Cf. Slice E, with the token chips.

Confirmed on screen: 7 (the hex size's hint speaks of a Foundry square), 11
(the ×, ↺ and ✓ have no spoken name; read from the DOM), 12 (the card's
30.7 × 47.3, "fair" and "1 box" carry no tooltip), 24 (the palette says
"Domain" where Map modes says "Domains"), 26 (three road tools share one
glyph), 29 and 31 (the Scene configuration button's glyph is a ruler where
the toolbar's is sliders). The familyAmbiguous line reads on one honest box,
as Phase 1 predicted.

**A name for 31**, proposed by the phase session from what the toolbar
already says: **Map setup**. The window's title, the toolbar tool, the Scene
configuration button ("Map setup…") and its hint all say it, and the window's
own first heading moves to what it heads. MODEL and the guide take it in
Phase 4.

### For a later batch

Not built by this plan. Registered 2026-11-15 as T-0599 to T-0607 (22 to
30, in order), source `audit:2026-11-15`. Phase 3 registers each on the bug-intake ledger
(`acks-bug-triage`, rows matched by title) before it opens its branch.

22. Closing the palette leaves a toolbar-armed brush armed (`_onClose`), and
    core ignores a press on the tool already active, so the toolbar cannot
    reopen the palette. C, D.
23. Territory painted while the map mode is Terrain, or with the handout view
    on, shows nowhere; `followBrush` follows the brush only on a layer
    change. C, Cf.
24. The palette's layer pills and the Map modes window's mode pills share a
    style and the words Terrain and Territory, and do different things.
    C, Cf.
25. "Mark the selected walls as roads" and its water twin always mark the
    first kind (`roadFromSelection`, `waterFromSelection`), whatever preset
    is in hand. C, D.
26. The alley preset's notice names only the surface; the preset's name for
    a shore differs from the wall row's and the notice's; three road presets
    and the mark tool share one glyph. C, Co.
27. The road row has no `aria-label`s where the water row does. In both, the
    street, boat and name fields stay editable under "Not a road" and "Not
    water", and what is typed there is dropped. C, Co.
28. Swatches put world labels (domain names) in `data-tooltip`, which renders
    them as HTML; `data-tooltip-text` is the attribute. C, Co.
29. The opacity slider shows no figure, has no tooltip, and does nothing in
    Terrain mode. C, Co.
30. The navigation picker's clearing entry names a state where the icon's
    face says "not declared", and the map tools say Dungeon and Wilderness
    where the party sheet says Delve and Journey. C, Co.

### Duplication

Deliberate, each with its ruling in `DECISIONS.md`, and left alone:

- Three ways into the window and three ways to disarm (2026-08-26). Only
  their labels differ, which is 31.
- The map's system, in the window's select and on the navigation card
  (2026-10-28).
- The climate, set in the window and shown in Map modes (2026-10-24). Its
  unset value is two lang keys that differ by a capital.
- Road and water presets in the group, the mark tools on Walls (2026-10-15).

Accidental: the two rows of pills (24) and the two erasers (21). Already in
the plan: auto-sizing is set by Apply and toggled in Scene configuration, and
the window never shows it (the plan's §4, point 9).

No lang key is unread beyond the three the plan's §6 lists.

### Slice J's groups

In scope: 1 to 21 and 31. Each group goes to one `implementer`, defects
first within a group. No two groups share a file, but the groups share files
with the slices before them: D, E and G write the window's files, and slice I
writes `lang/en.json` and `module.mjs`. So slice J starts once D, E, G and I
have committed.

**Slice J is a session of its own.** D, E, G and I are already a session's
batch, and J adds twenty-two findings. Phase 3 builds its four slices on
`topic/map-setup-panel`, leaves the branch open, and writes into the plan's
results the start prompt of a session that runs J in that worktree, lands the
branch and walks it. The six defects (1, 3, 4, 5, 6, 17) are built first, so
a session that runs short leaves cosmetics behind and not bugs.

| Group | Files | Findings | The Judge sees |
|---|---|---|---|
| J1 | `assistant-app.mjs`, `assistant-body.hbs`, `assistant-foot.hbs`, `styles/battlemap.css`, `lang/en.json`, `tools/test-battlemap.mjs` | 2, 3, 4, 7, 9 to 16, 20, the wording of 21, 31, and the window naming its scene (5) | The window keeps its place when a chip is pressed. Every figure and glyph button has a tooltip and a spoken name. Bake works wherever it is offered. Rescale says how many tokens it left unsized. One name for the window on every surface. |
| J2 | `apply.mjs` | 1, 8 | After an apply on a scene holding a wall and a token, both sit on the map features they sat on before. The confirmation's title names what is being applied. |
| J3 | `capture.mjs`, `module.mjs` | 5 (the button), 17, 18, 19, and the toolbar half of 21 | Ctrl+Z while typing undoes the typing. Entering the group arms nothing. "Calibrate…" from another scene's configuration never opens the viewed scene's window. Wipe shows its hint. |
| J4 | `scene-nav.mjs` | 6 | With the window open, a unit changed in Scene configuration shows in the select, and Apply keeps it. |

Three cautions for the phase session:

- **1 is the largest and the least known.** Read in core 14's
  `Scene##repositionObjects`: under `autoReposition` every token, light,
  sound, tile, note, drawing, wall and region shape has its points multiplied
  by the change in the scene's width and height and offset by the change in
  the scene's origin. It leaves `grid.size` alone when the update carries
  one, as every apply does, and throws only when it has to work out a grid
  size itself. Not read: where the module keeps painted hexes and whether
  they move. Inferred: a token is moved by its top-left corner, so one whose
  pixel size changes with the cell may land off its cell. Whether a wall
  lands on its map feature is a walked answer, on a scene built with a wall,
  a token and a painted hex, read before and after. If core's option does not
  land them, the group stops and the question goes to an `architect`.
- **5 crosses two groups.** The button is in `module.mjs` and
  `openAssistant` in `assistant-app.mjs`. J1 gives the window its scene and
  its name; J3 changes only the call.
- **31 needs a name.** The implementer does not choose it. The phase session
  proposes one from what a Judge reads on the toolbar, and MODEL and the
  guide take it in Phase 4.

### Not read

`scene-setup.mjs`, `footprint.mjs`, `road-markers.mjs`, `country.mjs`, the
`hex-*.mjs` files, most of `calibrate-logic.mjs`, the head of
`terrain-paint.mjs`, the plan and border code in `map-modes.mjs`, the middle
of `roads.mjs` and `water.mjs`, `lib/window-resize.mjs`, `TESTING.md`, the
guide beyond its headings, the domains feature's layer and mode, the vendored
design-system stylesheets, and whether the `topology.*` strings reach a
surface.
