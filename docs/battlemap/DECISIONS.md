# Battlemap — decisions

Rulings through v11.14.5: [DECISIONS-through-v11.14.5.md](DECISIONS-through-v11.14.5.md).

## In force

- 2026-09-15 — [The road graph is planar, because a city is not a chain](DECISIONS-through-v11.14.5.md#2026-09-15--the-road-graph-is-planar-because-a-city-is-not-a-chain)
- 2026-09-12 — [What the live walk of the road layer found](DECISIONS-through-v11.14.5.md#2026-09-12--what-the-live-walk-of-the-road-layer-found) — superseded in part by "2026-11-13 — Only what the module and the current system write is served"
- 2026-09-12 — [A road is a wall, on every grid](DECISIONS-through-v11.14.5.md#2026-09-12--a-road-is-a-wall-on-every-grid) — superseded in part by "2026-11-13 — Only what the module and the current system write is served"
- 2026-08-30 — [The tool says what a scene IS: family, units, system](DECISIONS-through-v11.14.5.md#2026-08-30--the-tool-says-what-a-scene-is-family-units-system) — superseded in part by "2026-10-09 — An undeclared map's system is inferred from its scale"; "2026-11-15 — A hex map is set up from its boxes, and Apply says what it rewrites"
- 2026-08-30 — [The right button pans; a sample says what it represents](DECISIONS-through-v11.14.5.md#2026-08-30--the-right-button-pans-a-sample-says-what-it-represents) — superseded in part by "2026-11-15 — A hex map is set up from its boxes, and Apply says what it rewrites"; "2026-11-15 — A box counts across and down"
- 2026-08-26 — [The panel is a window again, dismissed by the toolbar](DECISIONS-through-v11.14.5.md#2026-08-26--the-panel-is-a-window-again-dismissed-by-the-toolbar)
- 2026-08-26 — [The tool group has a resting state, and Escape leaves](DECISIONS-through-v11.14.5.md#2026-08-26--the-tool-group-has-a-resting-state-and-escape-leaves)
- 2026-08-26 — [One entered value, one slot](DECISIONS-through-v11.14.5.md#2026-08-26--one-entered-value-one-slot)
- 2026-08-19 — [Scene fields are written directly, no flag mirror](DECISIONS-through-v11.14.5.md#2026-08-19--scene-fields-are-written-directly-no-flag-mirror)
- 2026-08-19 — [Quarter-square quantization with a quarter-square floor](DECISIONS-through-v11.14.5.md#2026-08-19--quarter-square-quantization-with-a-quarter-square-floor)
- 2026-08-19 — [preCreateToken auto-sizing is opt-in per scene](DECISIONS-through-v11.14.5.md#2026-08-19--precreatetoken-auto-sizing-is-opt-in-per-scene) — superseded in part by "2026-11-15 — A hex map is set up from its boxes, and Apply says what it rewrites"
- 2026-08-19 — [Skew is baked into a corrected image, never simulated](DECISIONS-through-v11.14.5.md#2026-08-19--skew-is-baked-into-a-corrected-image-never-simulated)
- 2026-08-24 — [Gridless is an INPUT, and the correction squares the cells](DECISIONS-through-v11.14.5.md#2026-08-24--gridless-is-an-input-and-the-correction-squares-the-cells)
- 2026-08-19 — [The grid-mode seam: hex and gridless are ruled now, built later](DECISIONS-through-v11.14.5.md#2026-08-19--the-grid-mode-seam-hex-and-gridless-are-ruled-now-built-later) — superseded in part by "2026-08-24 — Gridless is an INPUT, and the correction squares the cells"
- 2026-08-19 — [Related rulings owned elsewhere](DECISIONS-through-v11.14.5.md#2026-08-19--related-rulings-owned-elsewhere)
- 2026-08-20 — [Verify scene writes by reading back; never emit NaN](DECISIONS-through-v11.14.5.md#2026-08-20--verify-scene-writes-by-reading-back-never-emit-nan)
- 2026-08-20 — [Calibration gets a control group; the session owns the state](DECISIONS-through-v11.14.5.md#2026-08-20--calibration-gets-a-control-group-the-session-owns-the-state)
- 2026-08-25 — [The panel is a sidebar tab, and the preview mesh is deaf](DECISIONS-through-v11.14.5.md#2026-08-25--the-panel-is-a-sidebar-tab-and-the-preview-mesh-is-deaf) — superseded in part by "2026-08-26 — The panel is a window again, dismissed by the toolbar"
- 2026-08-28 — [Terrain paints as regions, and the cell key is the identity](DECISIONS-through-v11.14.5.md#2026-08-28--terrain-paints-as-regions-and-the-cell-key-is-the-identity) — superseded in part by "2026-10-24 — The map shows one mode at a time"; "2026-11-16 — Paint is a core grid shape per value"
- 2026-08-29 — [The terrain vocabulary opens to imported keys](DECISIONS-through-v11.14.5.md#2026-08-29--the-terrain-vocabulary-opens-to-imported-keys)
- 2026-08-29 — [Mud and snow leave the brush](DECISIONS-through-v11.14.5.md#2026-08-29--mud-and-snow-leave-the-brush)
- 2026-08-29 — [A hex has sides, corners and centres, and a road is a declared path](DECISIONS-through-v11.14.5.md#2026-08-29--a-hex-has-sides-corners-and-centres-and-a-road-is-a-declared-path) — superseded in part by "2026-09-12 — A road is a wall, on every grid"; "2026-11-13 — Only what the module and the current system write is served"
- 2026-10-09 — [An undeclared map's system is inferred from its scale](DECISIONS-through-v11.14.5.md#2026-10-09--an-undeclared-maps-system-is-inferred-from-its-scale)
- 2026-10-09 — [The brush paints at the book's grain](DECISIONS-through-v11.14.5.md#2026-10-09--the-brush-paints-at-the-books-grain) — superseded in part by "2026-10-15 — A river or a coast is a line"; "2026-10-15 — The country is read from the map, and the Judge's word stands over it"
- 2026-10-09 — [A recipe's grid is aligned the way the calibration aligns one](DECISIONS-through-v11.14.5.md#2026-10-09--a-recipes-grid-is-aligned-the-way-the-calibration-aligns-one)
- 2026-10-15 — [A river or a coast is a line](DECISIONS-through-v11.14.5.md#2026-10-15--a-river-or-a-coast-is-a-line)
- 2026-10-15 — [The country brush paints three layers](DECISIONS-through-v11.14.5.md#2026-10-15--the-country-brush-paints-three-layers) — superseded in part by "2026-10-24 — The climate is the map's"; "2026-10-24 — The map shows one mode at a time"; "2026-11-25 — Closing the palette disarms every brush, and a stroke shows its layer"
- 2026-10-17 — [The country brush's layers are a registry](DECISIONS-through-v11.14.5.md#2026-10-17--the-country-brushs-layers-are-a-registry) — superseded in part by "2026-11-16 — Paint is a core grid shape per value"
- 2026-10-24 — [The brush paints the board alone](DECISIONS-through-v11.14.5.md#2026-10-24--the-brush-paints-the-board-alone)
- 2026-10-24 — [The climate is the map's](DECISIONS-through-v11.14.5.md#2026-10-24--the-climate-is-the-maps) — superseded in part by "2026-11-14 — 32. Four one-time conversions go, one slice per feature" (docs/DECISIONS.md)
- 2026-10-24 — [The map shows one mode at a time](DECISIONS-through-v11.14.5.md#2026-10-24--the-map-shows-one-mode-at-a-time) — superseded in part by "2026-11-14 — 32. Four one-time conversions go, one slice per feature" (docs/DECISIONS.md); "2026-11-25 — Closing the palette disarms every brush, and a stroke shows its layer"
- 2026-10-25 — [A layer can derive the territory](DECISIONS-through-v11.14.5.md#2026-10-25--a-layer-can-derive-the-territory)
- 2026-10-28 — [The map's declaration is on its navigation card](DECISIONS-through-v11.14.5.md#2026-10-28--the-maps-declaration-is-on-its-navigation-card)

## 2026-11-13 — The footprint's square is the book's; the assistant's ladders are the scene's — SUPERSEDED IN PART 2026-11-15, 2026-11-16

**Ruled** (owner): "Fix backed values to imports and also expose somewhere as
editable (this is a global rule applying here, fix whenever caught)"; and, on
the trap figures' open question, "Values: import or drop".

**Decision.**
- A footprint's square is read, not stated. `footprintFeet`'s `feetPerSquare`
  has no default and the battlemap imports nothing from the formation: the
  square is the unit the Monster Size table's squares row names in its own
  label (MM ch. 1), imported into `monsters` / `sizeSquare` beside
  `sizeFrontage` and read by `monsters/sizes.mjs` `sizeSquareFeet()`. The Judge
  edits it in the Ruledata Browser (Settings tab → Game Settings → ACKS II —
  Extras → Imported Rules Tables → Open Ruledata Browser) like the frontage.
- With no square, `footprintFeet` answers the override or null, as it already
  does for a category with no frontage; the token keeps its size and the
  rescale warning says the square and frontage are not both imported. A token
  with no category needs the square too, so it keeps its size as well.
- The assistant's chip ladders are the scene's, computed per scene at render:
  the size hotbar is steps of `sceneFeetPerCell(scene)`, the square-size
  ladder steps of `scene.grid.distance`, and an unentered map cell is worth
  the scene's `grid.distance`. A scene with no usable distance offers none.
  Nothing in either ladder is a figure from a page.

**Rejected.**
- *Chips from the imported size categories.* A category's frontage is a count
  of squares, not a distance a Judge picks for a token or a map, and a world
  with no import would show no chips at all.
- *A rules window in the formation module for the square.* The figure is the
  monster book's, beside the frontage it multiplies; a second home would be a
  second thing to import and to edit.

**Cost.**
- A world that has not imported the Monstrous Manual's tables sizes no token
  from a category and no category-less token; it keeps what each token has
  until Manage imports → Rules tables runs. No migration is built (owner
  ruling on earlier data).
- The two ladders are in different units (feet and the scene's own), as the
  fields they sit under already were.

## 2026-11-15 — A hex map is set up from its boxes, and Apply says what it rewrites — SUPERSEDED IN PART 2026-11-16

**Ruled** (owner, forwarding a field report "an example of some of the
feedback I've received and agree with"): "Battlemap setup for hex maps is very
unintuitive. I tried to do this with scale bar, but it dont work. I tried with
corners, abut still dont work. And in teh final i tried the Box, but everytime
it says that it needs another samples, and with another hexes with it still
sayas 20% offset or something like this, very stressful experience. And "Apply
hex grid scene" looks like "save changes" button by functionality." On
auto-sizing at map scale: "Yes, and Anything that is outside scale should get a
border (maybe a looking glass effect?) to clarify that it is not to scale", and
asked whether that holds where the scene had it on, "Yes, write it off". On a
loose fit, the standing rule: "players get blocks, judges get warnings".

**Decision.**
- A hex family is fitted to every box drawn around a single hex
  (`fitHexLattice`), on the lattice core's own grid reports for the family
  (`hexProbe`), with each axis scaled by itself, so boxes on different rows
  agree. A box that is not one hex, or too far from the rest to place, is left
  out and counted on the panel; a box drawn between brings a far one in. The
  family the boxes read as is a warning and the Judge's choice stands.
  Confidence is the boxes' edge residual in image pixels against a hand
  accuracy, and a loose fit names its worst box and never disables Apply.
- Corners are refused on a hex family, at the press, naming the box tool. A
  hex box carries no cell count. A scale bar on a hex family suggests the cell's
  worth through the centre spacing and places nothing.
- What Apply still needs is said, one line per gap, each naming the control
  that closes it (`planSetup`). The cell's worth is the Judge's entry, then a
  bar's, then the scene's own distance only while the unit written is the
  scene's; otherwise it is blank and asked for.
- Each apply solves without side effects and one writer writes that solve, so
  the panel's lines and the write read one answer. The done notice names the
  grid and the unit.
- An apply at a mile or more a cell writes token auto-sizing off, whatever the
  scene had; below that it writes it on.

**New evidence** for superseding in part the 2026-11-13 entry, under seven
days old: its sentence that an unentered map cell is worth the scene's
`grid.distance` let a gridless scene, its unit changed to miles, be written at
five miles a hex unasked. A live walk of the report the same day showed it,
with the size chips at 15840' to 190080' after a six-mile apply.

**Supersedes in part.** 2026-08-30 "The tool says what a scene IS": a hex
apply is fitted to every box, not pitched to one (three exact boxes over two
rows read 19.7% loose under the old fit). 2026-08-30 "The right button pans; a
sample says what it represents": a hex box says no count (a three-hex box was
divided on both axes). 2026-08-19 "preCreateToken auto-sizing is opt-in per
scene": the apply turns it on only below a mile a cell (a one-cell token was
created at half a cell after a six-mile apply). 2026-11-13, as above.

**Rejected.**
- *Taking only the first box.* It discards the Judge's best data.
- *Averaging box sizes with no lattice.* It cannot use distant boxes and still
  needs a lattice to score them.
- *Hiding the corners tool on a hex family.* The family is session state, and
  the toolbar would re-render on every change; the refusal at the press says why.
- *Blocking Apply on a loose fit.* A Judge gets warnings.
- *Writing the unit when it is chosen.* A unit without its distance flips the
  scale test.

**Cost.**
- One box alone reads fair at best and often cannot tell the two hex families
  apart; one box around a block of hexes is taken as one large hex with only a
  shape warning. Both are on the panel, not prevented.
- At the reporter's hex size a box far out is unreachable until boxes step out
  to it.
- Placed tokens, tiles and walls do not move with an apply; the confirmation
  says so.

## 2026-11-15 — A box counts across and down

**Ruled** (owner, asked whether a square-grid box's one "spans" count becomes
two): "Two numbers (recommended): “3 across, 1 down”. Any box shape works."

**Decision.** A box on the square and scale-only families carries a count
across and a count down, each 1 unless the Judge says otherwise, and the fit
divides the box's width by the one and its height by the other. A hex box
carries neither.

**Supersedes in part** 2026-08-30 "The right button pans; a sample says what it
represents": its one count divided both axes, so a strip of three squares read
a third as tall as it is wide.

**Rejected.** *One count, labelled as a square block.* It keeps the arithmetic
right only for square blocks, and a strip is the shape a Judge drags along a
row.

**Cost.** Two inputs per box row instead of one.

## 2026-11-15 — The panel says what it writes, and the token section answers to the scale

**Ruled** (owner, forwarding the field report of the entry above): "Token Size
refit functionality is still puzzling to me what is this does, because it says
it is feets", with the rulings already quoted there ("players get blocks,
judges get warnings"; "Yes, write it off").

**Decision.**
- The footer lists what Apply would rewrite, one row per change with units
  (grid, cell worth, image, token sizing, a formation's system), and the
  confirmation lists the same lines as given, so it never re-derives a figure.
  Its placeables sentence shows only where something is placed.
- The cell's worth sits beside the units select. The party system and the
  country selects, which save as they change, sit under their own heading
  below the scale; the units select stays with what Apply writes.
- A single box whose shape reads as the other hex family is told apart from a
  wrong family only by a second box, and the panel says both causes
  (`planSetup`'s `lone`). It stays a warning.
- At a mile or more a cell the token section is one line, since tokens there
  are not sized to footprints. Below it the chips say their unit and their
  parts, the whole-scene rescale sits with them, and a line says whether
  placed tokens are auto-sized and where that is changed.
- A token's size is read from `_source`. The prepared `width` and `height` are
  core's animated values: a size change's first animation frame runs at once
  and the rest only as the canvas ticks.

**Evidence.** On 2026-11-15 the rescale reported "1 token rescaled" on every
press with nothing to see. Read live on core 14 with the pane's ticker frozen,
three presses counted 1, 1, 1 while `_source.width` already held 0.5 and the
prepared width still held 1; with 90 frames driven the prepared width
caught up and the count was 0. The half-cell cause first proposed (core holding
widths to half cells) was refuted: core stores 0.25 as 0.25.

**Rejected.**
- *Re-rendering the token section on token selection.* A `controlToken` hook
  would re-render the form under a field being typed into; the controls say
  instead that they act on the selected tokens, and a press with none selected
  says so.
- *A confirmation that words its own figures.* Two wordings of one answer can
  disagree; the panel's lines are the one wording.

**Cost.** The footer grows with the rows; it scrolls within its own bound so
the button stays on screen.

## 2026-11-15 — A token not drawn to the scene's scale is marked

**Ruled** (owner, answering whether a mile-scale apply leaves token
auto-sizing off): "Yes, and Anything that is outside scale should get a border
(maybe a looking glass effect?) to clarify that it is not to scale." Asked to
build it with three defaults (players see it; the party token never gets it;
each seat can turn it off): "Keep defaults".

**Decision.** A token whose stored size differs from its footprint at the
scene's cell, by more than half the quantum the sizer rounds to on either axis,
carries a magnifying-glass rim drawn as a child of its own container, solid and
in none of the disposition colours. It is judged against the unrounded
footprint, never the sizer's answer, so the floor that keeps a man grabbable
does not call him right. The party token, a marker's token and a scene with no
usable distance are never judged; with nothing imported there is no footprint
and no mark. Every seat sees it, a client setting turns it off per seat, and
nothing is written to any document. Hovering reads the direction and the drawn
size; the Judge and the token's owner also read the footprint in feet and where
it comes from.

**Rejected.**
- *Core's dynamic token ring.* Turning it on writes to the token.
- *A true magnifying filter.* A filter pass per token per frame.
- *Recolouring core's border.* It shows only on hover or selection.
- *Comparing against the sizer's answer.* Its floor hides the owner's example.
- *A stand-in footprint where nothing is imported.* A figure in source.

**Cost.** On a map whose cell is several times the imported square, every
auto-sized small token carries the mark, since the floor draws it larger than
it is. Canvas text does not follow the type-size setting.

## 2026-11-16 — Apply moves what is placed with the map — SUPERSEDED IN PART 2026-11-16

**Ruled** (owner, asked whether Apply should move placed walls, tiles, notes,
drawings, regions and tokens with the map, after a live probe, or keep them in
place): "Move them, build now (Recommended)".

**Decision.** A square or hex apply, and a scale-only apply that changes the
grid size, is written with core's `autoReposition`, so everything placed keeps
its place on the image while the image is rescaled and shifted under the new
grid. A painted cell's polygon moves with it; its cell key, and its shape, are
then taken again from the hex the cell's centre now lies in, since a key names
a cell of the grid and the grid moved against the image.

**New evidence** for superseding in part the 2026-11-15 entry, under seven
days old (its Cost bullet that placed things do not move): the release before
it said they do ("Changing scene dimensions repositions placed tokens, tiles,
and walls proportionally", `apply.confirmShift` in v2026.11.14), and a live
probe on core 14 the same day the owner ruled read what core's option does. On
a hex scene sent an apply-shaped update with it, a wall's ends stayed within
0.0003 of their fraction of the scene's rectangle, a painted cell's polygon not
at all, the grid size written was kept, and no per-document update hook fired.
With the grid changed against the image, the painted cell's polygon stayed on
its feature while its key named a different hex, and the map read no terrain
there; nobody had read how a painted cell is stored when the earlier entry was
written.

**Rejected.**
- *Keeping placed things in place.* Walls, roads and water drift off the
  features they trace, and every painted cell answers for another hex.
- *Moving the module's own placeables by hand.* Core's option already moves
  every embedded kind in the same update.

**Cost.** One apply rewrites every placed thing on the scene, and the re-key
is a second write after it. A token moves by its corner and keeps its size in
cells, so where the cell's pixel size does not change in the image's own
proportion its centre lands a fraction of a pixel off.

## 2026-11-16 — The size chips are the imported size categories

**Ruled** (owner, 2026-11-14, standing): a value nothing imported stays blank,
with the page reference as its tooltip, and no figure in source stands in.

**Decision.** The token section's chips are one per size category whose
frontage and the square are both imported; a chip stamps that category's
footprint and its tooltip says where the figure comes from and how many cells
it draws at here. With nothing imported there are no chips, and the caption's
tooltip is the page reference.

**New evidence** for superseding in part the 2026-11-13 entry (its sentence
that the size hotbar is steps of the scene's cell, and its rejection of chips
from the size categories): at a cell of a hundred feet the steps offered 50 to
600 ft, so the 50 ft chip gave a man a 50 ft footprint; at six miles they read
15840' to 190080'. Frontage times the imported square is a distance in feet,
which `footprintFeet` already computes, so the rejection's ground is gone, and
showing nothing without an import is what the 2026-11-14 ruling requires.

**Rejected.** *Steps of the scene's cell.* They are sizes no creature has.

**Cost.** At a large cell every chip draws at the quarter-cell floor, so the
chips stamp different footprints that look alike on the map; the not-to-scale
mark says which.

## 2026-11-16 — The window is called Map setup

**Ruled** (owner, asked whether to rename the window "Map setup" everywhere:
the title, the toolbar tool and the Scene configuration button as "Map
setup…"): "Map setup (Recommended)".

**Decision.** The window's title (with the scene it sets up), the Battlemap
group's tool and the Scene configuration button say Map setup; the window's
own first heading names the section it heads.

**Rejected.** *Keeping seven names.* A Judge told to open one cannot find it
under another.

**Cost.** The guide, MODEL and the plates named the old words until Phase 4 of
the map setup revision rewrites them.

## 2026-11-16 — The travel-system row says what a party will take

**Decision.** Apply no longer writes the declared travel system: the select
writes it as it changes, and the apply's flag record is written key by key so
it never overwrites one. The footer's travel-system row shows the system the
scene's scale will call for once applied, where none is declared, which is what
a party placed there adopts.

**Evidence.** The row compared the declared system before and after an apply,
and the select had already written it, so the two differed for one render at
most (ledger T-0611).

**Rejected.** *Removing the row.* A foot-scale scene applied at six miles
switches its party to journey without a word on the panel.

**Cost.** None found.

## 2026-11-16 — Paint is a core grid shape per value

**Ruled** (owner, 2026-11-16, on the maps' regions): "Both should be fixed to
using the foundry native regions instead of polygons with unreachable
ack-extra code"; "The new actor types like districts are a UI for the more
complex needs, not a replacement for a fundamental object type"; "Design
principles, composition (extend) better than bespoke"; "Non grid regions for
gridless maps like city districts", and imported Regions "Keep locked". The
owner's "no legacy support" stands for worlds painted before this.

**Decision.** A paint layer's value is still one Region flag and still one
Region per value per layer, but the Region's cells are core's own `grid` shape
(`GridShapeData`): forest on hexes 3:4 and 3:5 is one Region,
`terrain = "forestDeciduous"`, with one shape holding both offsets and no
polygon. `terrainHexes`, `territoryHexes` and `domainHexes` (the paint flag,
not the vassal row's field of the same name) are gone, and a `PAINT_LAYERS`
entry is `{flag}`.
- **Point reads** are core's `testPoint` on each non-hole grid shape of the
  layer, the Regions in the scene's order, the first to claim the hex winning.
  **Enumerations** (`layerPlan`, `derivedHexes`, a domain's `paintedHexesOf`)
  read the same shapes' offsets through `layerCellsOf`, each hex once under its
  first claim, so the two agree where a hand edit left a hex doubly claimed.
  `lib/regions.mjs` `gridCellsOf(region)` is the offsets read.
- **Writes** are one Region update per cell: the cell leaves every grid shape
  of the layer and enters the value's Region's first grid shape, a Region
  emptied is deleted and a missing one created, and the writes of a scene run
  one after another. A brush Region is created unlocked, so core's grid tool
  reaches it; "Keep locked" is for the Regions an import draws.
- **Apply** reads every grid shape's cell centres as fractions of the scene
  rectangle before `scene.update` and looks each up on the new grid after it,
  the nearest centre keeping a collision. It covers every grid shape on the
  scene, the paint layers' and the zones an import drew alike, which closes a
  drift the zone Regions of the native-regions slices had under Apply.
- **Old worlds** keep their polygon Regions, which core still draws; they hold
  no grid shape, so no read or brush write finds them and the brush paints a
  new Region beside them. No notice, check or lang string says so.

**Supersedes in part** three entries. *2026-08-28 Terrain paints as regions*:
the cell key as aligned flag and the claim that a point test "needs a rendered
placeable". *2026-10-17 The country brush's layers are a registry*: a layer's
pair of flags, `hexesFlag`, and `PAINT_LAYERS` as pairs. *2026-11-16 Apply
moves what is placed with the map* (under seven days old): the re-key's
mechanism, a polygon's centroid naming the cell. Kept from all three: one
Region per value, one value per hex per layer, the layers' visibility, hex
grids only.

**New evidence** for the 2026-11-16 entry: a grid shape carries no pixels, so
there is no polygon to move with the image and nothing to read a centroid off,
and core's reposition leaves a grid shape's offsets as they were
(`Scene#repositionObjects`, `case "grid"` moves only `origin`). What drifts is
which cell lies under each offset, which a read of the cell's place taken
before the write and looked up after it answers exactly. The earlier entry
rebuilt a polygon per hex because the cell had to be stored beside its shape;
the shape now is the cell.

**Rejected.**
- *A RegionBehavior sub-type for the value.* Its value would be a per-client
  registry's (a raw uuid in core's form for a domain), it changes
  `documentTypes` and so needs a world relaunch, and the palette is already
  the UI that sets a value. Counter-argument (medium): a behavior would let
  core's Region config set the value and reuse the zone reads of the
  native-regions slices; it loses on a vocabulary that is dynamic (imported
  terrains, the world's domains) and on the relaunch.
- *`region.testPoint` for paint reads.* It rebuilds the Region's clipper
  polygons on each ask, so a drag pays for it per stroke; it cannot match the
  enumeration, which reads offsets; and it answers false where the elevation is
  undefined.
- *A stored cell index* (a set kept beside the shapes). Core caches the offset
  set in each grid shape already; a second copy is the aligned-flags problem
  this entry removes.

**Cost.** A map drawn before this reads empty until it is painted again. A hole
or a non-grid shape a Judge adds to a paint Region paints nothing, and is
carried through the next write untouched. Every write replaces the Region's
whole `shapes` array (about 16 bytes a cell; the offsets field has no maximum),
and an Apply takes a read of every grid cell before it writes.

## 2026-11-25 — Closing the palette disarms every brush, and a stroke shows its layer

**Ruled** (owner, 2026-11-25, on the B02 design board for ledger rows T-0599,
T-0600 and T-0602): "A on all three".

**Decision.**
- **Closing the palette disarms the brush, whoever armed it.** A brush the
  toolbar armed also rests the Battlemap group on its resting tool when the
  group and the Country brush are still the active pair, so the tool is no
  longer lit and the next press on it arms the brush and opens the palette
  again. A brush a sheet armed is disarmed as before.
- **A stroke shows the layer it paints.** The first stroke on a layer the
  map view does not show (another mode, or the handout view on) switches the
  view to that layer's mode with the handout off and opens the Map modes
  window, the switch arming already makes. The press that opens a stroke
  decides it, an erase included; a Terrain stroke changes nothing, since
  core's own regions draw the terrain under every mode and the handout. A
  mode or the handout picked with no stroke after it stays as picked.

**Supersedes in part** *2026-10-15 The country brush paints three layers*:
"Closing the palette disarms a brush the toolbar did not arm", and so the
toolbar's exemption it implied. Kept: a sheet can arm the brush, and the
rejection of a sheet-armed brush left armed, whose reason now covers both.
Also *2026-10-24 The map shows one mode at a time*, its Q4a: a mode no longer
stays off until the Judge picks it again once the brush paints its layer, and
the handout switch is turned off by a stroke on a layer it hides. Kept: the
mode is the client's and outlives the brush and every control; a pick with no
stroke after it stands.

**New evidence.** A toolbar-armed brush left armed on close kept catching the
canvas with nothing on screen to say so, which is the 2026-10-15 reason
applied to the toolbar's own case; and the lit tool swallowed the next press
(core's `SceneControls` ignores a press on the active tool), so the palette
could not be reopened from the toolbar until another tool was picked. Under
the 2026-10-24 rule that arming shows a layer, a hand pick of Terrain or the
handout after arming left later territory strokes writing where nothing drew
them.

**Rejected.**
- *Keep the toolbar's brush armed and reopen the palette on the next press*:
  the canvas stays caught while nothing says so, the case the 2026-10-15
  rejection already named.
- *Refuse a stroke on a hidden layer*: it puts a gate on the Judge's own
  surface where a switch the brush already makes on arming says the same.
- *Switch the view on every pick while armed*: it overrides a choice the
  Judge just made; the stroke is the moment the Judge asks to see the layer.

**Cost.** A Judge who picks Terrain to look under a territory brush and then
paints sees the view switch back on the first stroke.
