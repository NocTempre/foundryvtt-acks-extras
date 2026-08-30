# Battlemap — how it works

A GM assistant that says what a scene IS — its grid family, its distance
units, what its distances are worth, and which travel system a party uses on
it — by fitting the scene to a map image from samples drawn on the canvas, and
that sizes tokens to their footprints.

Everything user-facing hangs off a **Battlemap scene-control group** — the capture modes are its
tools — and a **Battlemap window** (`assistant-app.mjs`) carrying the numbers
and the apply actions, opened by entering the group, by its panel tool, or
from the scene-config row, and dismissed by its own close control.

## Terrain painting

The group's **Paint terrain** tool arms a brush over hex-gridded scenes
(`terrain-paint.mjs`): clicks and drags paint hex cells into scene REGIONS —
one region per terrain kind per scene, tinted from the fixed palette,
visible to everyone (a hex map's terrain is the map), flagged
`terrain: <key>` with the painted cells stored beside the shapes as OFFSET
KEYS (`terrainHexes`, aligned index-for-index). The keys are what make
erasing exact and the journey's lookup geometry-free: "what terrain is this
hex?" is a flag read that answers identically on a client with no canvas.
One terrain per hex — painting a cell removes it from every other terrain
region first; the eraser unpaints, and a region whose last cell goes is
deleted. A small palette window picks the brush; the terrain vocabulary and
its labels are the vehicles feature's `TERRAIN` (structure — what a terrain
is WORTH stays in the registered travel tables). Square-grid scenes refuse
with a warning rather than approximating. The formation's journey reads the
painted map: the party token's hex names the trace and its painted terrain
sets the ground (`travel.mjs onJourneyTokenMoved`, via the same
token-movement seam that ticks dungeon turns when not journeying).

## Files

| File | Responsibility |
|---|---|
| `calibrate-logic.mjs` | Pure solver: 1D-per-axis grid fit (square/rect modes), 2D lattice fit with basis reduction (affine mode), scale-bar conversion, nice-number suggestions, output-square conversion, the scale-only (size, distance) pair, and hex size from a measured reference box. No Foundry. |
| `footprint.mjs` | Pure footprint resolution (override → size category → man default) and feet→squares quantization. No Foundry. |
| `token-scale.mjs` | The ONE writer of width/height for generic tokens: scene-wide rescale, the selection hotbar's stamp/reset, and `preCreateToken` auto-sizing gated on the scene's `autoScale` flag. |
| `scene-image.mjs` | The one place that knows where a scene's background lives: reads it off the active Level, writes it through that Level's own update. Every background read and write in the feature goes through here. |
| `capture.mjs` | Canvas overlay: screen-space pointer catcher (core GridConfig's preview pattern), sample glyphs, live fitted-grid preview (GridMesh for square fits, drawn lattice lines otherwise), eraser and undo. |
| `session.mjs` | The calibration session: samples (each with what it represents), the armed mode, the setup choices (family, hex parity, units, party system), the fit toggles and the GM's entered values, plus the overlay. Owns the state both surfaces read; notifies subscribers on every change. |
| `assistant-app.mjs` | The window, a VIEW over the session: the setup section, the fit card, scale decisions, the token-size hotbar, and a pinned footer carrying the two apply actions. One module-level instance, so a second press focuses rather than stacks and a dragged position survives a close; it subscribes to the session while open and unsubscribes on close. Two PARTS — a part renders one root element, and the footer must be the body's sibling to stay pinned, which is why `.window-content` is the flex column. |
| `apply.mjs` | Scene writes, one per family: `applyGridCalibration` (square), `applyHexCalibration` (hex), `applyScaleOnly` (no geometry), each one `scene.update`; plus `bakeCorrectedBackground` (render-to-texture de-skew, upload, repoint). |
| `scene-setup.mjs` | What a scene has been set up AS: the flag record (`sceneSetup` / `writeSceneSetup`), its declared travel system, the family it already uses, and `hexProbe` — a hex's bounding box, measured off a clone rather than restated. |
| `../lib/distance-units.mjs` | What one `grid.units` is worth in FEET. Every feet→squares conversion divides by `sceneFeetPerCell`. |
| `module.mjs` | Registrar: scene-control tool, scene-config row, preCreateToken install, `acksExtras.battlemap` API. |

## Data flow

- **Samples live in background-image pixel space.** The capture layer converts
  pointer positions through `scene.dimensions` and the background texture's
  size, so a fit survives the scene being rescaled between captures — and an
  apply does not invalidate the samples that produced it.
- **The family is the first question, and everything else answers under it.**
  `square`, `hexRows`, `hexCols` and `scale` decide which fields the panel
  shows, what a drawn box measures, and which apply runs. It defaults to the
  family the scene already uses (`familyOfScene`), so the panel opens
  describing the map in front of the Judge.
- **Two scale decisions, not one.** *One drawn square is* says what the map's
  own box is worth; the **output square** says what one *Foundry* square should
  be, defaulting to 1:1 with the drawn box. A different output re-pitches the
  grid (`G px = fittedCellPx × outputFeet / mapCellFeet`); a non-integer ratio
  draws a "lines will not coincide" warning. A hex family has only the first of
  the two: one drawn hex is one Foundry hex, because re-pitching to a fraction
  of a cell is a square-grid idea and hexes do not tile hexes.
- **Every field states what it means and in which unit**, and every SAMPLE
  carries the box that says what it represents — how many drawn cells a box
  spans (`cells`, divided out by the solver), what a scale bar reads. A
  measurement and its meaning sit on the same row.
- **Units are chosen, not assumed.** The picker writes `grid.units` with the
  scale, and `lib/distance-units.mjs` converts it to feet for every consumer
  that owns a length — token footprints and the formation's party token both
  size through `sceneFeetPerCell`, so a six-mile hex sizes a man as a man.
- **Each of those has one slot and one input**, with its chips banded directly
  beneath it. A chip writes the same slot the input does, so the displayed
  number and the number the arithmetic uses cannot diverge. An entered value
  wins; a dragged scale bar answers only when nothing is entered, and is
  offered as chips rather than applied over the top (DECISIONS).
- **Arming is a mode, and the group has a resting state.** Each capture mode
  is a tool in the `acksBattlemap` control group; `off` is ordered first and is
  the group's `activeTool`, so opening the toolbar arms nothing. Escape
  disarms, the panel shows an armed banner carrying the same exit, and Ctrl+Z
  undoes the newest sample. The right button never edits samples: it is how a
  GM pans. Leaving the group disarms and does
  nothing else — the window outlives it, because core drops a layerless group
  on every canvas redraw and the apply redraws (DECISIONS). Since disarming
  selects `off`, core's per-control tool memory brings the GM back to a
  resting toolbar rather than a re-armed one.
- **Applying writes core fields directly** — `width`, `height`, `shiftX`,
  `shiftY`, `grid.size`, `grid.type`, `grid.distance`, `grid.units` — in one
  `scene.update`, plus the module's scene flag
  `battlemap = { calibrated, distance, autoScale, mapSystem }`. The
  shift comes from `solveShift` (pure, in `calibrate-logic.mjs`) fed the
  `sceneX`/`sceneY` of a preview clone whose shift is zeroed, so core's
  padding rounding is honoured rather than assumed (see DECISIONS).
- **Nothing is reported applied without reading it back.** `solveShift`
  returns null rather than NaN, the apply refuses a non-finite solution, and
  after the write the scene's own `grid.size`/`grid.distance` decide whether
  the GM sees success or an error — a rejected field is dropped by schema
  validation without throwing (DECISIONS).
- **A scan that is crooked or out of square cannot be expressed by Scene
  fields** (the background TextureData has only scaleX/scaleY, and a scene has
  one grid size). The fit reports the angles and the two cell edges; the
  optional bake renders the image through the inverse of the fitted basis into
  `<name>-aligned.webp` beside the original, points the scene at it, and hands
  back the corrected image's exact SQUARE fit. Skew, rotation and unequal X/Y
  are corrected together because they are one transform: `A = s·M⁻¹` sends the
  fitted basis to `(s,0)` and `(0,s)`. `s` is the LARGER edge, so the short
  axis is stretched rather than the long one squeezed — resampling up discards
  less. The original file is never modified.
- **A gridless scene is the ordinary state of a freshly imported map.** The
  square apply accepts `GRIDLESS` and writes `grid.type: SQUARE` along with the
  size and shift; the panel says so before the button is pressed.
  `CALIBRATABLE_GRIDS` is the one list both the square apply and the panel
  read — a hex scene is refused a square fit and told which families it may
  have instead.
- **A hex apply pitches ONE hex and lets Foundry pack the rest.** The box drawn
  around a hex gives its bounding box; `hexProbe` asks a scene CLONE carrying
  the target grid what that box measures at a reference size, `hexSizeFromBox`
  scales the answer (both axes voting), and the shift comes from asking that
  same clone for the hex centre nearest the drawn hex's centre — a phase cannot
  express packing where every other row starts half a cell over. A clone whose
  hex box comes back square has not rebuilt its grid, and `hexProbe` returns
  null rather than scaling a map by a ratio of one.
- **Scale only writes no geometry at all.** `grid.size` and `grid.distance` are
  one ratio — so many px are worth so much distance — and a map with no drawn
  grid offers exactly one measurement, its scale bar. `applyScaleOnly` writes
  that ratio and the units, leaves the type, the dimensions and the shift
  untouched, and so leaves a gridless map gridless. Foundry bounds `grid.size`
  to whole pixels within a range: inside it the asked-for distance is kept and
  the px solve; outside it the size clamps and the DISTANCE solves back, which
  keeps what the ruler reads exact at the cost of a round number.

## Token sizing — ownership

`token-scale.mjs` is the only writer of `width`/`height` for generic tokens.
The formation **party token is its one exemption** — identified by the
`formationId` flag and sized by `formation/scene-sync.mjs` to the formation's
face (`docs/formation/MODEL.md`, "Data flow"). Each side skips the other's
tokens, so no token ever has two size owners.

Footprint precedence, resolved by `footprint.mjs`: token flag `footprint
{w,h}` (feet) → actor flag → the monster size category's `footprint` (squares
at the 5-ft combat square, `scripts/monsters/config.mjs` SIZES) → man-sized
one square. `footprintLock` on a token opts it out of every automatic resize.
Spans quantize to quarter squares with a quarter-square floor (DECISIONS).

Auto-sizing triggers: the assistant's "Rescale tokens" button (whole scene),
the hotbar (selected tokens, stamps the override flag), and `preCreateToken`
on scenes whose `autoScale` flag is on — which the apply action sets and the
scene-config row toggles. Formation redeploys create tokens and therefore
flow through the same hook.

## What the scene declares to the rest of the module

Two of the flag's fields are read by surfaces that never open this panel.

- `autoScale` gates `preCreateToken` sizing on this scene.
- `mapSystem` is the travel mode a formation adopts on ARRIVAL — a dungeon map
  runs the turn clock, a wilderness map runs the day board, a settlement
  crosses in blocks. The vocabulary is `TRAVEL_MODES` (`lib/vocab.mjs`), shared
  so the declaration and the mode cannot drift apart; the formation half is
  `adoptSceneSystem` (`docs/formation/MODEL.md`). Unset means silence, not
  "dungeon": a party crossing an unlabelled scene is left alone.

The select writes the flag the moment it is chosen rather than waiting for an
apply — it is a statement about the map, not part of the calibration
arithmetic, and an already-aligned scene should not need re-aligning to be
labelled.

## Grid-type seam

Three output families ship: square, hex (rows or columns), and none at all.
Token sizing still assumes square-ish cells — a span in cells, quantized —
which is right for a square grid and approximate on a hex one; the hex-specific
half of the ROADMAP ruling (tokens that auto-arrange to fill a hex as its
occupancy changes, a slots-per-cell override) is not built. The solver itself
stays grid-type-agnostic: the affine lattice fit carries any two basis vectors,
and no hex geometry is written down anywhere in this feature.

## Hex topology

A hex is not a cell. Painting a road as a property of one answers the wrong
question: a road is not something a hex HAS, it is something a party FOLLOWS,
and following it means entering by one edge and leaving by another. A hex a
road merely clips the corner of is not a hex you can drive across.

So a hex carries thirteen addressable nodes — six sides, six corners and a
middle ([hex-topology.mjs](../../scripts/battlemap/hex-topology.mjs)) — and
connections are DECLARED between them. Node ids are `i:j:<letter><n>`, sharing
the terrain layer's own cell key so a node always knows which painted hex it
belongs to. The middle is written `m`, not `c`: "corner" and "centre" share a
first letter, and a shared prefix would make a hex's middle and its first
corner the same node.

A link is undirected, so its ends are stored sorted and identity is a string
compare. A hex may hold several UNCONNECTED hubs — a bridge over a gorge and a
ford beneath it are two ways through one cell that do not meet — and `hubs`
returns them apart, which is what stops a route teleporting between them.

Two facts the travel rules lean on:

- **`onRoad` asks whether this STEP follows a link**, not whether the hex has
  one. That is what makes "the party is on a road" a fact rather than a guess,
  and the navigation rule already depends on it.
- **`routeCost` reports the winding tax separately** from what the road saves
  in speed. They are different currencies — distance against multiplier — and
  a readout that netted them would hide exactly the trade the Judge is meant to
  weigh.

[hex-routes.mjs](../../scripts/battlemap/hex-routes.mjs) is the scene half:
the link set is a single scene FLAG rather than a document each, because a
network is read on every step of every march and is only ever consulted whole.
Terrain earns its regions because terrain is DRAWN; a link is a fact about the
map, not a shape on it.

`nodeAtPoint` turns a click into a node — the middle wins only near the centre,
so a click around the rim declares an edge or a corner rather than silently
anchoring everything to the middle. `facingNodes` finds the two nodes a step
between neighbours touches, which are two distinct ids at the same physical
place because each belongs to its own cell. **Adjacency is checked first and
against the grid's own neighbours**: any two hexes have a midpoint, so nudging
toward it from far apart yields two perfectly valid nodes and a crossing that
does not exist.

The **Routes tools** sit in the Battlemap group, one per road kind, so Foundry's
one-active-tool rule is the kind selection — the same shape the terrain brush
uses. Click a node to anchor, click another to link; the far end becomes the
next anchor so a road is drawn in one sweep. The anchor is drawn, because a
tool that remembered a click without showing it would leave a Judge guessing
whether their last press registered.

The journey consults it: `onJourneyTokenMoved` asks `stepBetweenHexes` and a
drawn network **overrides the day's road picker**, exactly as painted terrain
overrides the ground picker. A scene with no routes leaves the picker alone —
an undrawn map is one where the question has not been asked, not one where
every march is off-road.

Not yet built: a path's own encounter profile, and feeding `routeCost`'s
winding tax into the day's distance.

