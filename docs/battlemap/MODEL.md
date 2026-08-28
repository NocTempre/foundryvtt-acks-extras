# Battlemap — how it works

A GM assistant that fits the scene grid to a battlemap image from samples
drawn on the canvas, converts the confirmed real-world scale into
`grid.distance`, and sizes tokens to their footprints. Everything user-facing
hangs off a **Battlemap scene-control group** — the capture modes are its
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
| `calibrate-logic.mjs` | Pure solver: 1D-per-axis grid fit (square/rect modes), 2D lattice fit with basis reduction (affine mode), scale-bar conversion, nice-number suggestions, output-square conversion. No Foundry. |
| `footprint.mjs` | Pure footprint resolution (override → size category → man default) and feet→squares quantization. No Foundry. |
| `token-scale.mjs` | The ONE writer of width/height for generic tokens: scene-wide rescale, the selection hotbar's stamp/reset, and `preCreateToken` auto-sizing gated on the scene's `autoScale` flag. |
| `scene-image.mjs` | The one place that knows where a scene's background lives: reads it off the active Level, writes it through that Level's own update. Every background read and write in the feature goes through here. |
| `capture.mjs` | Canvas overlay: screen-space pointer catcher (core GridConfig's preview pattern), sample glyphs, live fitted-grid preview (GridMesh for square fits, drawn lattice lines otherwise), eraser and undo. |
| `session.mjs` | The calibration session: samples, the armed mode, the fit toggles and the GM's entered values, plus the overlay. Owns the state both surfaces read; notifies subscribers on every change. |
| `assistant-app.mjs` | The window, a VIEW over the session: the fit card, scale decisions, the token-size hotbar, and a pinned footer carrying the two apply actions. One module-level instance, so a second press focuses rather than stacks and a dragged position survives a close; it subscribes to the session while open and unsubscribes on close. Two PARTS — a part renders one root element, and the footer must be the body's sibling to stay pinned, which is why `.window-content` is the flex column. |
| `apply.mjs` | Scene writes: `applyGridCalibration` (one `scene.update`) and `bakeCorrectedBackground` (render-to-texture de-skew, upload, repoint). |
| `module.mjs` | Registrar: scene-control tool, scene-config row, preCreateToken install, `acksExtras.battlemap` API. |

## Data flow

- **Samples live in background-image pixel space.** The capture layer converts
  pointer positions through `scene.dimensions` and the background texture's
  size, so a fit survives the scene being rescaled between captures — and an
  apply does not invalidate the samples that produced it.
- **Two scale decisions, not one.** *Map square is* says what the map's drawn
  box is worth; the **output square** selector says what one *Foundry* square
  should be, defaulting to 1:1 with the drawn box. A different output
  re-pitches the grid (`G px = fittedCellPx × outputFeet / mapCellFeet`); a
  non-integer ratio draws a "lines will not coincide" warning.
- **Each of those has one slot and one input**, with its chips banded directly
  beneath it. A chip writes the same slot the input does, so the displayed
  number and the number the arithmetic uses cannot diverge. An entered value
  wins; a dragged scale bar answers only when nothing is entered, and is
  offered as chips rather than applied over the top (DECISIONS).
- **Arming is a mode, and the group has a resting state.** Each capture mode
  is a tool in the `acksBattlemap` control group; `off` is ordered first and is
  the group's `activeTool`, so opening the toolbar arms nothing. Escape
  disarms, the panel shows an armed banner carrying the same exit, and
  right-click removes the newest sample. Leaving the group disarms and does
  nothing else — the window outlives it, because core drops a layerless group
  on every canvas redraw and the apply redraws (DECISIONS). Since disarming
  selects `off`, core's per-control tool memory brings the GM back to a
  resting toolbar rather than a re-armed one.
- **Applying writes core fields directly** — `width`, `height`, `shiftX`,
  `shiftY`, `grid.size`, `grid.distance` — in one `scene.update`, plus the
  module's scene flag `battlemap = { calibrated, distance, autoScale }`. The
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
- **A gridless scene is calibratable and a hex one is not.** No grid at all is
  the ordinary state of a freshly imported map, so the apply accepts
  `GRIDLESS` and writes `grid.type: SQUARE` along with the size and shift; the
  panel says so before the button is pressed. Hex is refused, the solver
  fitting a rectangular lattice that a hex scene is not. `CALIBRATABLE_GRIDS`
  is the one list both the apply and the panel read.

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

## Grid-type seam

Square is the only OUTPUT mode: calibrating produces a square grid, and token
sizing assumes square cells. A gridless scene is an accepted input and is given
that square grid; hex is refused. The solver itself is grid-type-agnostic (the
affine lattice fit carries any two basis vectors), so hex OUTPUT — its own
scale set, cell-fill arrangement — remains ruled in DECISIONS and staged in
ROADMAP.
