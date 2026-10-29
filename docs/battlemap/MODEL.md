# Battlemap — how it works

A GM assistant that says what a scene IS — its grid family, its distance
units, what its distances are worth, and which travel system a party uses on
it — by fitting the scene to a map image from samples drawn on the canvas, and
that sizes tokens to their footprints.

Everything user-facing hangs off a **Battlemap scene-control group** — the capture modes are its
tools — and a **Battlemap window** (`assistant-app.mjs`) carrying the numbers
and the apply actions, opened by entering the group, by its panel tool, or
from the scene-config row, and dismissed by its own close control.

## Country layers

The group's **Country brush** tool arms a brush over hex-gridded scenes
(`terrain-paint.mjs`) on one of its registered LAYERS — the module's two,
terrain and territory, and any a feature registers (§The layer registry) —
chosen by the pills at the head of its palette window.
Clicks and drags paint hex cells into scene REGIONS (a drag paints only
inside a stroke that began on the board, and only while the pointer is over
it, never through a window in front): one region per value per
layer per scene, tinted from the module's own palette and flagged with the
layer's pair — the value (`terrain`, `territory`) and the painted cells as
OFFSET KEYS beside the shapes (`terrainHexes`, `territoryHexes`, aligned
index-for-index). The keys are what make erasing
exact and every read geometry-free: "what territory is this hex?" is a flag
read that answers identically on a client with no canvas. A hex holds one
value per layer: painting a cell removes it from every other region of that
layer first, the eraser unpaints the armed layer alone, and a region whose
last cell goes is deleted. A terrain and a territory answer different
questions about the same hex, so a write on one layer never touches the
other's regions. Terrain regions are visible to everyone (a hex map's terrain
is the map); territory regions are drawn on the Regions control alone, since
the Territory map mode (§Map modes) is how the Judge sees them. Square-grid
scenes refuse with a warning rather than approximating.

Each layer's vocabulary is structural:

- **Terrain** is the formation's encounter terrain register
  (`formation/encounter-terrains.mjs`, the book's own grain), each kind
  standing on a travel ground, plus any imported `terrainMultipliers` key no
  kind covers. Mud and snow are the weather's, and the two river tables stand
  on no ground — water is a line (§Rivers and coasts) — so none of the four is
  a brush; a hex painted with a river before then still reads as it did. What
  a terrain is WORTH stays in the registered travel tables.
- **Territory** is `TERRITORY_KEYS` (`formation/country-keys.mjs`), named by
  the party sheet's territory strings and coloured from `TERRITORY_COLORS`.
- **Climate** is no layer: it is the map's alone, the scene default below.
  `climateLabelFor` names a climate of `CLIMATES` (`formation/weather.mjs`) by
  code and name, and `climateColorFor` colours it with its group's colour
  (`CLIMATE_GROUP_COLORS`) a step lighter for each kin listed before it, for
  the Battlemap window's select and the party sheet's climate card.

**The layer registry.** No code in the painter names a layer: each is
registered, and the two above register through the same call at the foot of
`terrain-paint.mjs`. `registerPaintLayer({key, flag, hexesFlag, values, label,
color, visible, regionsOnly, title, groups, derives})` takes the layer's two region flags;
`values()`, asked on every read so a vocabulary may come from the world;
`label(value)` and `color(value)`; `visible`, true where the layer's regions
are drawn for everyone and otherwise the Judge's alone; `regionsOnly`, true
where a map mode draws the layer and its regions show on the Regions control
alone (never with `visible`); an optional `title`,
the i18n key of the palette pill (`ACKS-BATTLEMAP.terrain.layer.<key>` by
default); optional `groups` (`of(value)` and `label(group)`), which fold the
swatches under group headings in order of first appearance; and an optional
`derives` (`{key, of(value)}`), the country key a hex painted on the layer
answers — `DERIVED_KEYS`, the territory alone — and that key's value for one of
the layer's, or null where it implies none (§One reader). Paint, erase, the reads (`layerValueAt`, `layerRegionsOf`), `paintableValues`,
`layerLabelFor`, `layerColorFor`, `openCountryBrush` and the palette all read the
registry; a key it does not hold paints nothing, reads null and arms on terrain.
`derivedValueAt(scene, point, key)` reads a derived key at a point, `{value,
layer}` or null, and `derivedHexes(scene, key)` every hex of a scene it is
derived for. The palette leaves out the pill of a layer whose `values()` is empty. A feature
registers its layer from its own module, so battlemap imports no feature.

Registration throws, naming the layer, on a key already taken, a flag another
layer holds (or one flag standing for both of a layer's), a missing function,
a half-given `groups`, or a `derives` naming a key outside `DERIVED_KEYS` or
one another layer already derives. It returns a handle that takes the layer out again; a
brush on it returns to terrain, and a handle already spent removes nothing.
A feature whose values change MEANING with no region written — a value
renamed, recoloured, or deriving another key — calls `paintLayerChanged(key)`,
which calls `acksExtrasPaintLayerChanged`; the map modes and an open palette
redraw on it.
`PAINT_LAYERS` is a live read-only view of the registered pairs, `{flag,
hexesFlag}` by key: it answers `Object.keys`, `Object.hasOwn` and a key read,
and refuses every write.

`paintedTerrainAt` reads the terrain layer alone in both of its
vocabularies — the key as painted, the ground it stands on and the encounter
table it names — for the readers that ask the terrain and nothing else (a
hex's stock, and a search at the hex a lost party really stands in).

**The scene default.** A map that is one country throughout, or is not a hex
map, says so once: `flags["acks-extras"].battlemap.country = {ground,
territory, climate}`, each a key or null, chosen in the Battlemap window's
three selects and written through `writeSceneSetup` (a read-modify-write of
the whole setup record). `sceneCountry` reads it and drops a key the module
does not know. `ground` takes a terrain brush value, read the way a painted
hex reads it.

**A map painted with climates.** A map painted before the climate was the
map's holds GM-only regions flagged `climate` and `climateHexes`. The first
time a GM's client draws such a map (`canvasReady`), `foldPaintedClimate`
([scene-setup.mjs](../../scripts/battlemap/scene-setup.mjs)) writes the
climate most of its hexes hold (`paintedClimateOf`; a tie goes to the code
`CLIMATES` lists first, and a code the module does not know never wins) into
the scene default where the map says none, marks the setup record
`climateFolded` either way, and says which climate it took in a notification.
The viewing GM writes it, since `canvasReady` fires only on the client that
draws the map. A map is folded once, so a climate cleared afterwards stays
cleared. Nothing reads the regions after the fold; they stay until the Judge
deletes them from the Regions tab.

**One reader.** `countryAt(scene, point)`
([country.mjs](../../scripts/battlemap/country.mjs)) answers the six keys the
journey asks — `ground`, `encounterTerrain`, `territory`, `climate`, `road`,
`following` — and `source` names, per key, which answered: `"map"` (a painted
hex, a drawn line), `"scene"` (the default), or null. A painted layer answers
on a hex scene, and the default answers where the layer does not; `climate`
is the default's alone. The territory has a source between the two: a hex
with no territory painted takes the one a layer derives for it (the domains
feature's, from the domain the hex is painted into), and `source` names that
layer by its key, `"domain"`; a territory painted on the hex is the Judge's
override and answers `"map"`, the same where it agrees with the derived one.
A drawn
layer speaks only on a scene that has one: `road` is the surface of the road
wall under the point, or `"none"`, where the scene has road walls; `following`
is `"river"` where a navigable water line is under the point, or `"none"`,
where the scene has water lines. Each is null on a scene with none — silence
the next source answers, not a "none" the map never said. A painted hex that
names no encounter table leaves the table null rather than borrowing the
default's, which describes other country. With `waterBorne` (the party moving
on the water) and any water line under the point, the encounter table is the
river's for the ground (`riverTableFor`); the formation does not pass it, and
applies the same rule at resolution from the cached `water`. The reader needs
no canvas: it reads the scene document and what a deriving layer reads from the
world (a domain actor), so any client holding both can ask; the formation
caches its answer on the party's record (`docs/formation/MODEL.md`, "The
country").

**The brush from a sheet.** `openCountryBrush({layer, brush, by})` arms the
brush on a registered layer and opens its palette: the toolbar's tool calls it, and so
does a party sheet's paint chip. Closing the palette disarms a brush the
toolbar did not arm, because nothing else on screen says the canvas is
captured.

## Map modes

A GM's map shows one MODE at a time over its terrain
([map-modes.mjs](../../scripts/battlemap/map-modes.mjs)). Terrain is the rest
state: core's terrain regions are the whole drawing. Every other mode is
registered — `registerMapMode({key, label, layer, plan, legend, weights})`, the
module's own being Territory, the domains feature's Domains
(`docs/domains/MODEL.md`, "Territory on the map") — and draws an overlay, a `PIXI.Container` added
to the board's regions layer after core's region fills. `plan(scene)` lists
the hexes the mode draws, `[{key, value, color, stripe}]` by offset key,
`stripe` a colour or null (`layerPlan(scene, layer)` makes a plan from a paint
layer's regions, with no stripes);
`legend(scene)` returns `{rows: [{color, label}], unpainted, stripes}`, `unpainted`
the label a hex the mode has not painted reads as (Territory's: the scene
default's territory) and `stripes` what a striped hex means, each or null.
`weights(scene)`, where given, returns `(value, across) => number`, the
weight of a side between a hex of `value` and a neighbour of `across` (null
for an unpainted one), asked once per drawing. `layer` names the paint layer whose palette pill shows
the mode (`modeForLayer`). Registration throws on a key already taken,
Terrain's included, a missing function or `weights` that is no function, and returns a handle that takes
the mode out; a view on a removed mode reads as Terrain.

**Territory's plan** (`territoryPlan`) is every hex with a territory: a hex
painted one is drawn in it, and one a layer derives a class for and nobody
painted is drawn in the derived class. A painted hex whose derived class
differs carries that class as its `stripe`, and the legend then says what a
stripe means.

**The borders.** `borderSegments(scene, plan)` draws, for every planned hex,
each side whose neighbour holds another value or none, in the hex's own
colour, its two corners pulled a fraction of the way toward the hex's centre.
Two values meeting therefore show as two lines side by side, one inside each
hex, and the terrain fill between the borders stays readable. The neighbour
across a side is the cell under the hex's centre mirrored across the side's
midpoint, which holds on any grid whose cells are symmetric about their
centre. A side weighs 1, or what the mode's `weights` says, held between 0.4
and 2; its width and its inset are both scaled by the weight, so a heavier
line moves inward and keeps its outer edge on the side, never over the
neighbour's. Segments are drawn grouped by colour and width, at a width and
an inset scaled by the grid size.

**The stripes.** `stripeSegments(scene, plan)` draws, for every planned hex
with a `stripe`, parallel lines a fixed fraction of the grid size apart,
running up to the right, each cut to the hex as the border inset pulls it in,
so a stripe ends at the border's inner edge. They are drawn thinner than a
border and before the borders, on the same Graphics.

**The view.** The mode, the overlay's opacity and a handout switch are this
client's (`mapView`, the client setting `mapView`, `config: false`).
`mapView()` resolves every field: a mode nobody registered reads as Terrain,
the opacity is held between a floor and 1, and anything but `true` is no
handout. A change redraws the overlay and calls `acksExtrasMapView`, on which
the road markers redraw. The overlay is drawn only for a GM, on a hex scene,
with a mode other than Terrain and the handout switch off; the handout switch
hides the road markers too. The mode outlives the brush and every control:
it changes when the Judge picks another in the Map modes window, or when the
brush is armed on a layer or switched to one (the mode that layer's pill
shows, which opens the window for any mode but Terrain). A swatch picked or a
disarm leaves the mode as it is.

**The Map modes window** (`MapModesApp`, the group's Map modes tool) shows a
pill per mode with the view's pressed, the mode's legend and what an
unpainted hex reads as, the map's climate, the opacity slider and the
handout switch; every control writes the view at once. The overlay redraws
on `canvasReady`, and 50 ms after a change to the viewed scene's regions or
its module flags, or a `paintLayerChanged`.

**Regions on the Regions control.** A territory region is made with
`REGION_VISIBILITY.LAYER`, since the mode draws it and core's fill would cover
the terrain under it. A map painted before then holds territory regions drawn
for a GM; the first time a GM's client draws it, `settleRegionsOnly` moves
every such region of a `regionsOnly` layer onto the Regions control in one
write and marks the setup record `regionsSettled`. A scene is settled once,
so a visibility the Judge sets by hand afterwards stands; a scene holding no
such region is never written.

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
| `scene-setup.mjs` | What a scene has been set up AS: the flag record (`sceneSetup` / `writeSceneSetup`), its declared travel system, its default country (`sceneCountry`), the family it already uses, and `hexProbe` — a hex's bounding box, measured off a clone rather than restated. |
| `terrain-paint.mjs` | The country brush: the paint-layer registry (`registerPaintLayer`, with the two built-in layers registered through it) as one region per value keyed by cell, each layer's vocabulary, colours and labels, the reads (`layerValueAt`, `paintedTerrainAt`, and the derived `derivedValueAt` / `derivedHexes`), `paintLayerChanged`, the writer `paintHexAt`, and the palette window with its layer pills. |
| `country.mjs` | `countryAt`, the one reader of the country under a point: the painted layers, a derived territory, the drawn lines and the scene default, and which of them answered each key. |
| `map-modes.mjs` | The map modes: the mode registry with Territory registered through it, this client's view (mode, opacity, handout), the plan with its border segments, side weights and stripes, the overlay in the regions layer, following the brush, and the Map modes window. |
| `hex-fit.mjs` | `hexAlignment` — the shift that lays Foundry's lattice over a drawn cell centre, asked of a zero-shift clone. The one owner of lattice alignment. Document methods only. |
| `../lib/distance-units.mjs` | What one `grid.units` is worth in FEET. Every feet→squares conversion divides by `sceneFeetPerCell`. |
| `roads.mjs` | Roads as a WALL LAYER on any grid: the flag, the non-blocking wall shape, the memoised road network, `roadUnder` (which street is the party on) and `roadDistance` (how far along the streets), the drawing presets, and the road row on a wall's own sheet. |
| `water.mjs` | Rivers and coasts as a WALL LAYER on any grid: the flag, the open wall shape, `waterUnder` (which water line is under the party), the two drawing presets, the from-selection tool, and the water row on a wall's own sheet. |
| `road-markers.mjs` | The GM-side overlay that makes a street and a water line visible: a street tinted by surface and dashed where it is an alley, a river or a coast in its own blue and dashed where a boat cannot follow it, drawn only while a map-drawing control is open and the handout view is off. Presentation only. |
| `scene-nav.mjs` | The navigation card's system icon: one per scene card in core's Scene Navigation, showing the system the setup record declares (`sceneSystemFace`) or the undeclared face. For a GM it is the control: a click opens the picker (core's ContextMenu, bound once to the navigation root, `pickerEntries`), a right click clears, both through `writeSceneSystem`; a player's navigation gets none. `sessionFollowsScene` keeps the setup panel's session on what the viewed scene's card wrote. |
| `hex-topology.mjs` | Pure hex nodes and links, and `linksFromRoadSegments` — the links a set of drawn roads implies. No Foundry. |
| `hex-routes.mjs` | The scene half of the topology: links DERIVED from road walls, the legacy declared flag still read beside them, `convertRoutesToWalls`, `nodeAtPoint` / `nodePoint`. |
| `../lib/wall-geometry.mjs` | Segments and the graph they draw — the crossing, distance and along-the-lines measurement every wall layer shares. No Foundry. |
| `../lib/wall-layers.mjs` | What a drawn line MEANS to this module: the flag read and write, the all-NONE shape, core's one drawing-preset slot, a region from an enclosed loop. |
| `module.mjs` | Registrar: the scene-control group (the capture modes, the country brush, the road and water presets, the Map modes window), the Walls-layer tools, the scene-config row, the navigation card's icon, preCreateToken install, `acksExtras.battlemap` API. |

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
- **Lattice alignment has one owner, `hex-fit.mjs`.** `hexAlignment` builds a
  zero-shift clone of the scene at the target size and grid, asks its grid
  for the cell centre nearest a drawn centre given in scene pixels (padded
  origin included, or as a function of the clone's dimensions so one clone
  answers both), and returns the rounded `shiftX`/`shiftY`, or null when the
  grid cannot answer. The hex apply calls it; it needs nothing of the scene
  but `clone`, so it answers an unsaved Scene — a gridded scene recipe's
  (`docs/importer/MODEL.md`, "A map on a grid of drawn cells") — the same
  way, and no second copy of the lattice question exists.
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

Three of the flag's fields are read by surfaces that never open this panel.

- `autoScale` gates `preCreateToken` sizing on this scene.
- `country` is the map's default country, which `countryAt` reads wherever
  the brush has not painted (§Country layers). Like the system select, its
  three selects write the moment they are chosen.
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

The declaration is also on every scene's card in core's Scene Navigation
(`scene-nav.mjs`): an icon for the declared system — dungeon, wilderness,
settlement — and a distinct face for a map that declares nothing. For a GM
the icon is the control: a click opens a picker over the three systems, with
the declared one marked and a clearing entry where one is declared, and a
right click on the icon clears outright; a player's navigation shows no icon.
Both write through `writeSceneSystem`, the writer the select uses, so there
is one flag shape and one "unchanged, no write" rule. Core re-renders the
navigation from the scenes collection on every scene update, which is what
makes the icon follow the flag, whichever surface wrote it; and the setup
panel's session takes the viewed scene's new value from the same update, so
an open panel's select does not show what the card just replaced. The icon
carries a `data-action` core has no handler for, which is what keeps a press
on it from viewing the scene; the right click is taken on the icon alone, so
the rest of the card keeps core's scene menu.

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

**The links are DERIVED from the roads the Judge drew.** `derivedRoutesOf`
samples every road wall along its length and emits a link for each move to a
different, ADJACENT hex — so a street dragged into a new shape brings its links
with it, and nothing is declared twice. A wall that merely clips a corner emits
nothing, because the hex before the clip and the hex after it are not
neighbours. The derivation is cached against the road network object itself,
which the road layer replaces on any wall change, so it needs no invalidation
of its own.

`winding` is therefore MEASURED: the road lying inside the two hexes a link
joins, half of each, over the distance between their centres. The road inside a
hex is summed over every segment there, which is what makes a snaking street
drawn as six short lines cost what its shape says. Two roads crossing one hex
without meeting are counted together there, so such a hex reports more bend
than either road has; `makeLink` floors the figure at 1, so the measure can
never make a road cheaper than crossing straight.

`declaredRoutesOf` still reads the legacy `hexRoutes` scene flag beside the
derived set, so a world part-way through a hand-declared network keeps working;
a drawn road wins a boundary both describe. `convertRoutesToWalls` retires the
flag into walls on one press — a Judge's act, not a migration on load, because
converting writes walls to a scene. The winding a Judge TYPED is not carried
across: winding is now read off the shape of the line, and writing the old
figure onto a straight wall would make the two disagree the moment it is
dragged.

A converted link is drawn **hex middle to hex middle**, not between the link's
own two ends: those ends are the two halves of one shared boundary and resolve
to the same point, so a wall between them would have no length. A line through
both hexes is also the only shape the derivation can re-read, which is what
makes the press idempotent — what it writes comes straight back as a derived
link. A declaration it cannot place stays on the flag; the press never destroys
what it failed to carry.

The journey consults the union: `onJourneyTokenMoved` asks `stepBetweenHexes`,
and the road the step followed — or `"none"` for a step that left the network
— is the map's reading of the road for the hex arrived in, laid over what
`countryAt` read there. A scene with no roads asks nothing, and its reading of
the road is silence — an undrawn map is one where the question has not been
asked, not one where every march is off-road.

Not yet built: a path's own encounter profile, and feeding `routeCost`'s
winding tax into the day's distance.

## Roads

A road is a **Wall that restricts nothing**, flagged
`flags["acks-extras"].road` with a surface, a street kind and a name
([roads.mjs](../../scripts/battlemap/roads.mjs)). Three things follow from
being a wall:

- **It is drawn with core's own wall tool**, so snapping is core's: a hex grid
  offers the vertices, side midpoints and centres the topology already
  addresses, a square grid its vertices and midpoints, a gridless map the free
  hand. Nothing here reimplements any of it, and a road can be drawn on every
  grid — which the node tool it replaced could not.
- **A bend is measured along its legs.** `roadDistance` measures over the road
  GRAPH, so a party that follows a curving street pays for the street and not
  for the chord across the block it went round. It answers null when EITHER end
  is more than a grid cell off the roads, when the two ends are on networks that
  do not meet, or when the scene states no scale — every one of which means the
  caller falls back to the straight line and says so. Both ends, where the
  underlying geometry asks for either: a move that starts on a street and ends
  across open ground would otherwise be charged the street plus the trek off it,
  which comes to MORE than the straight line the party could have walked — the
  defect this measurement exists to fix, pointing the other way.
- **The street underfoot is a fact, not a picker.** `roadUnder` reads the
  surface and street kind off the wall nearest the party's centre.

The restrictions are all NONE and the door type is stated, because the preset
persists between presses: a road armed after a secret door would otherwise
inherit the doorway. Marking an EXISTING wall as a road never alters that
wall's own properties — a layer never does — so a wall that still restricts
movement is a street the party cannot walk down, and the wall's sheet says so
rather than silently correcting it. Such a wall is **not in the network**: it is
drawn by the overlay so the warning can be acted on, but no route is measured
along a line the party's token cannot cross.

**The trap line and the road share core's ONE preset slot.** Arming a street
disarms a tripwire and the other way round; nothing in the module can change
that, so the notification names what is now armed.

The road tools sit in two places for one reason. The **presets** (one per
surface, plus an alley modifier and the conversion) are in the Battlemap group
with the rest of map preparation. **Marking a selection** is on the Walls
control, because leaving a placeables layer releases everything selected on it:
a Roads control of its own would empty the wall selection at the moment it
opened, and a selected wall is what that tool acts on.

The **alley tool is a modifier on the armed preset** rather than a road kind of
its own — pressing paved and then alley means a paved alley, which is what a
Judge who pressed them in that order meant.

What a surface is WORTH is imported (the `travel` document's `roads` table); a
wall carries the key. A world whose book names a surface this build never heard
of can still carry it: `roadSurfaceKeys` widens the wall sheet's choices by
whatever the registry holds, while the toolbar offers the structural few.

## Rivers and coasts

Water is drawn the way a road is: a **Wall that restricts nothing**, flagged
`flags["acks-extras"].water = {kind, navigable, name}`
([water.mjs](../../scripts/battlemap/water.mjs)). `kind` is `river` or `coast`
(`WATER_KINDS`); `navigable` says whether a boat can follow the line, and a
line that does not say reads as its kind's default — a river is followed, a
coast is a shore. A river runs along and between cells, which no hex-painted
kind could say, and a party is on one by how near its token stands to the
line: `waterUnder` answers the nearest water line within half a grid cell, and
asked for a navigable line it passes over a shore, so a coast nearer the party
does not hide the river beside it.

The road layer's mechanics carry over unchanged. The wall shape states every
restriction as NONE and the door type as none (`waterWallData`), because the
preset persists. Marking a selected wall as water (the Walls control's tool)
never alters the wall itself, keeps a name already on the line, and counts a
line that still restricts movement so the notification can say the party
cannot cross it. The water row on a wall's own sheet edits the kind, whether a
boat can follow it, and the name, and "not water" takes the layer off. The two
presets (`water-river`, `water-coast`) sit in the Battlemap group beside the
road presets, and all of them share core's ONE preset slot with the trap line.

What a water line answers lives in `countryAt` (§Country layers): `following`
is `"river"` over a navigable line, and a party moving on the water over any
line reads the river's encounter table for the ground. A water line is never a
road: the hex topology takes its links from road segments alone, so drawing a
river declares no path through a hex.

