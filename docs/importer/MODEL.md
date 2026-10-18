# Importer — Design Model

> Merged from the separate acks-importer repo on 2026-09-01. Text written before then names paths as they were there: `scripts/x.mjs` is now `scripts/importer/x.mjs`, `tools/x.mjs` is `tools/importer/x.mjs`, `flags["acks-importer"]` is `flags["acks-extras"]` (the importer's `generated` key is now `minted`), and `acksImporter.fn()` is `acksExtras.importer.fn()`.

How this module applies the family doctrine **reuse → extend → enhance →
invent**:

- **Reuse**: which core `acks` documents, fields, and methods it builds on.
- **Extend**: genuinely new data, stored in `flags["acks-extras"]` (typed by
  an in-memory DataModel where practical; blank numerics are `null`, never 0).
- **Enhance**: alternate sheets, libWrapper wraps, socketlib GM routing.
- **Invent**: kept to nothing the system already provides.

## A settlement's map

The map step (`cookbookImportScenes`) makes a WORLD scene from a scene recipe
and brings the places and organisations it stands on into the world
(`bringAcross`, `worldCopySource`). It writes no Adventure; the adventures
step does (see "A book as one Adventure"). The scene's creation data is built
by one function for both (`mapCreateData`), over the world's documents for the
map and over temporary stand-ins for the Adventure. What the city's list and
each quarter's special list add after dark is read from the imported list's
own rows and die (`listAfterDark`) and written where the settlement layer
reads it: the battlemap flag and the District behaviour's `specialAfterDark`.

A held map is repaired by its LINKS and nothing else (`repairHeldMap`): the
city list is named again where the map names none or one that is gone, each
quarter's special list likewise, and a quarter's after-dark figure is filled
where it was never stated (null). A rebuilt roll-table shelf mints new ids,
which is what leaves a map naming lists that no longer exist. What the Judge
drew, moved or typed is not read; the step's summary counts the writes.

## A book as one Adventure

The adventures step (`cookbookImportAdventures`, last in the import chain)
writes one Adventure per open Judge's book to its line's Adventure shelf
(`ensureBookAdventure`), under `bookAdventureId(book)` and the kind
`kind.bookAdventure`. `bookAdventureSource` assembles it:

- every Actor, RollTable, JournalEntry and Item whose stamp names the book
  (`bookDocuments`): the library's copy under the id of its world twin where
  the world holds one, else the world's own, the only source there is;
- every map of the book, by page, rebuilt from its recipe over stand-ins for
  those documents (`mapCreateData`, a grid recipe through `gridScenePlan` as
  the map step builds it), under the world scene's ids (`withWorldIds`), with
  each zone another book laid over the held world scene carried as the world
  holds it;
- the lists a map or zone rolls on that the book does not print;
- the folders the world files each document in now, a library document under
  its twin's when it has one (`adventureFolderSources`), under the world
  folder's id where the world has that type, name and parent.

An actor's and a map's references to carried documents are rewritten to world
form (`adventureRefs`); a list's, a journal's and an item's are carried as they
stand. The maps' links are laid one map after another (`linkFields`), and an
organisation keeps the regions it controls on the other maps.

The stamp counts what it carries (`contents`), and records `sourcesHash`
(`sourcesHashOf`, the source without any `_stats`) and `writtenAt`, the stored
document's modified time read back after the write. Each run decides by
`bookAdventureState`: a shelf without it writes it; a modified time more than
`WRITE_SLACK_MS` past `writtenAt` is a Judge's edit and is kept; a changed
hash rebuilds it; anything else is held. Once the book's Adventure stands, the
retired per-map Adventures of the same book on the same shelf
(`kind.settlementAdventure`, `legacyAdventuresOf`) are deleted and named in
the step's summary. A run that fails writes nothing and retires nothing. The
Books window reads each open Judge's book's census off the shelf's index
(`bookCensus`).

Core's `Adventure#import` is steered, not replaced. For an Adventure whose
`flags.acks-extras.cookbook.kind` is one of `ADVENTURE_KINDS` (a book's, and
the retired per-map one, which a backup or an unrun shelf can still hold), a
`preImportAdventure` hook (`book-adventure.mjs`) refuses while any library
shelf is cold (`libraryCold`), since a cold shelf reads every library document
as missing; otherwise it empties `toUpdate` and narrows `toCreate` to the fill
(`fillPlan`), synchronously. In a book's Adventure every document is a root,
and a person, a list, a journal, an item, or a place no carried map shows
stays in the library when the library holds it. `importAdventure` then
mirrors the links of every created or held map and draws its thumbnail. The
patch lives here and not in `lib/` because only this feature builds these
Adventures; every other Adventure passes through untouched. One owner:
nothing else in the family hooks either.

The shelf is an importer shelf (`importedPacks` files it, Remove All Imports
deletes it) but not a library type (`library.mjs` `LIBRARY_TYPES`): nothing
warms or reads it.

### A map on a grid of drawn cells

A scene recipe (`kind.scene`, `scene-binding.mjs`) may carry a `grid` block,
measured off the page like the rest of the recipe:

- `family` — the drawn lattice as the map stands upright: `hexCols`
  (flat-topped), `hexRows` (pointy-topped) or `square`.
- `even` — the even-offset variant of that family; odd when absent.
- `box` — one drawn cell's bounding box in points, upright.
- `centre` — a page point, before the turn like a place's `at`, at one drawn
  cell's centre; the lattice shift is solved from it.
- `distance` and `units` — what one cell spans; `units` is a
  `DISTANCE_UNITS` key.
- `pixels` — the Foundry cell size, 100 when absent.

With a grid, `feetPerPoint` may be left out (`recipeFeetPerPoint` derives it
from the cell). The picture is scaled so one drawn cell is one Foundry cell:
`gridScale` is Foundry's cell extent over the drawn cell's, measured on a
clone by `hexProbe` when one is at hand and taken across the flats otherwise
(the two agree by construction; a probe whose axes disagree by more than 2%
refuses the fit). `sceneData` then writes Foundry's lattice of that family at
the cell's size, distance and units, the shift it is handed, and a battlemap
flag set up for journey travel; `placeTokenAt` sizes a pin by the recipe's
cell. A recipe without a grid is built exactly as before: gridless, a
hundred feet to the cell, settlement travel, the same picture key. A map
with no quarters checks no place against one. `offsetsInside` keeps the cells
whose centres an outline holds; the shift itself is the battlemap's
`hexAlignment` ([../battlemap/MODEL.md](../battlemap/MODEL.md)).

The map step builds a grid recipe through `gridScenePlan`, asked of an
UNSAVED `Scene` with the padding the scene is created with: `hexProbe`
measures Foundry's cell for the recipe's family (a square lattice needs no
probe), `gridScale` turns it into pixels per point, and `hexAlignment` solves
the shift for the recipe's `centre` carried through `sceneFrame` and set on
the clone's padded origin. A probe that cannot answer, or whose axes
disagree, refuses the map (`gridRefused`, reported in the step's summary)
before anything is written. The picture is cut at the plan's scale
(`uploadSceneMap`'s `pixelsPerPoint`); `mapCreateData` sets every token and
quarter down from the picture's corner on the canvas (the padded origin less
the shift, `placedFrame`), hands the
lattice and shift to `sceneData`, and keeps the scale in the scene's cookbook
flag (`pixelsPerPoint`) for the zones laid later. A recipe with a grid and no
quarters is a REGION's map (`mapIds`): the map is the region's place
(`regionPlaceId`), each placed site stands on the place its text was written to
(`regionSiteClaim`), and there are no quarters to hand to organisations; the
picture's thumbnail and the places' scene links are written as for a
settlement, and the book's Adventure carries the map like any other. A region map whose book prints region rows waits
(`unready`) until the region's place has been imported. Without a grid,
`mapCreateData` builds a settlement map's data and no part of the grid path
reaches it; `test-region-import` pins that data byte for byte.

### A map's walls, traced from the page

A recipe with a square `grid` may carry a `walls` block, read by
`wall-trace.mjs` (its header says how each mode reads a plan):

- `mode` — `grid`, `contour` or `stroke` (`WALL_MODES`).
- `threshold` — the gray level, 1 to 254, the trace cuts the plan at.
- `corrections` — assertions on the recipe's lattice (`wallLattice`: cell
  `[0, 0]` is the first whole drawn cell at the crop's top-left):
  `{cell: [c, r], is}`, `{edge: [c, r, "n"|"w"], is}`, or
  `{at: [x, y], drop: "island"}` in page points. Which states a cell may take
  depends on the mode (`CELL_STATES`). `stroke` takes only `open`.
- `note` — the compiler strips it.

`wallsProblems` checks the block wherever `recipeProblems` runs, in the
register lint and in the compiler. It refuses corrections past
`correctionCap`, which is `CORRECTION_SHARE` of the lattice's cells, so a
recipe that needs more never compiles.

The map step traces after the picture is uploaded and before the one create.
`traceSceneWalls` (`module.mjs`) renders the crop of the seat's page to gray
at `TRACE_PITCH` pixels per drawn cell (`extractPageGray`, print intent on
white). That render is separate from the picture, so the trace reads the same
plan at any picture size. `traceWalls` returns segments in page points with
core's door type, and a digest the console logs. `wallSources` carries the
segments through the placed frame the tokens use, rounds them to whole pixels,
and drops zero-length ones. They ride the scene's create (`sceneData`), and a
walled scene turns on token vision under global light. A trace that cannot run
leaves the map without walls and counts it (`wallsFailed`). A held map is
never re-traced.

The book's Adventure traces each walled map again over its stand-ins.
`withWorldIds` gives each wall the id of the held world wall with the same
coordinates and door type, else a stable id from the seed.

### A zone over a map

A `kind.sceneZone` row (`register/_kinds/sceneZone.json`) lays one book's
encounter rule over a scene recipe that may be another book's. It is named
`Zone <n>` with the id `<book>.zone<n>`, has no text anchor (its scene
locates it), and carries a `zone` block:

- `scene` — the recipe's id, in any book.
- `table` — optionally, a roll table of the zone's own book.
- `outline` — at least three page points of the TARGET recipe's page, before
  the turn.
- `cadence` — the encounter zone's journey cadence: blank (inherit), `entry`
  or `periods`.
- `targetAt`, `dayAt`, `nightAt` — optional boxes (`page`, `x0`–`x1`,
  `y0`–`y1`) over the zone's own printed encounter target and day and night
  throws.

`compileSceneZone` checks it (`zoneProblems`) and files it under the
cookbook's `scenes` beside the recipes (`isZoneRow` tells the two apart), each
box as a value instruction: the target with the `int` pattern, the throws with
`countWord`, which reads a digit or an English count word from
`register/_refs/countWord.json` and yields 0 (inherit) for a box that reads
nothing. What no single compile can see — that the scene is a compiled recipe
in some cookbook, that the table is the zone's own book's, and that the
outline lies inside the recipe's crop — is asserted by
`test-cookbook-coherence`. `zoneRegionData` shapes the Region: visible to the
GM only, locked, one polygon per snapped cell (else the outline carried
through the frame), the `acks-extras.encounterZone` behaviour with the list,
target, cadence and throws, and flags naming the zone and the cells it covers.

The map step lays the zones after the maps (`ensureZone`), for every zone row
of an open book. A zone whose map is not in the world waits (`zonesWaiting`);
the map is found by the recipe's id, an import before any copy of one, made
this run or held from an earlier one, and its book need not be open. A map
that already carries a Region flagged with the zone's id holds it
(`zonesHeld`) and only has its list relinked. Otherwise the figures are read
through the executor from the ZONE's book, its `zone.fields` run as the one
entry of a view of that book's cookbook; the list is the imported table by
cookbook id, or blank until a later run relinks it (`repairHeldMap` relinks a
zone Region's list the way it relinks a quarter's). The outline is carried
through the target recipe's frame at the scale the map was made at (the
cookbook flag's `pixelsPerPoint`, else probed again on the live scene) and
moved to the picture's corner (`dimensions.sceneX/Y`). On a hex map the cells
are the live grid's (`getOffsetRange` over the picture, `getCenterPoint` per
offset, `getVertices` per kept cell), snapped by `offsetsInside`, and a zone
holding no cell is refused; on a square or gridless map the outline is the
shape. The Region is named `Zone <n> (<book short>)` from a lang key.

### A region's places

A region's gazetteer is not a settlement. Its rows sit under two whole group
names (`REGION_GROUPS` in `poi-binding.mjs`): `Region — Sites` for keyed sites,
which anchor by key number and are named `Site <n>` with the id
`<book>.site<n>`, and `Region — Overview` for the region's own text, which
anchors by hash. The quarter parse (`poiGroupOf`) never takes either, so
nothing that reads quarters sees a region. `regionPlaceId` and
`regionPlaceData` build the region's own place under the book's label, and a
scene recipe may place a region site as it places a point of interest.

The points-of-interest step takes a region's rows too (`importRegionRow`). The
region's place is claimed once per book; the overview is its notes, written
only while they are empty. A site lands where `regionSiteClaim` says: a row
naming a market (`meta.market: "mkt<n>"`) on that market's place
(`<book>.mkt<n>`, the id the market-profile step claims, made here with
`marketActorData` when it is not there yet), or on the book's settlement when
that market's record says `place: "adventure"`; a row with
`meta.place: "adventure"` on the settlement (`oseAdventureId`); any other site
on a place of its own under the region. A bound site writes its notes, its
parent (the region) and its role onto the place it lands on, each only where
that place holds none (`siteBindPatch`), and never makes a second place. The
journal step leaves region rows alone (`journalBound`).

## A body's unnamed people

A settlement book prints a body's membership as a grid: a column per class or
order, a row per level, a count in each cell, a total row, and beside a single
body's grid its revenue by level. That grid reaches the faction the
organisation row built as its `strength` block (`docs/factions/MODEL.md`,
"Strength") through a second register row, `kind.strengthGrid`
(`register/_kinds/strengthGrid.json`).

The row ships geometry and ids and nothing else: the heading's `printKey`
hash and its box, the grid's box, label span, header band and column spans,
and a `strength.columns` block mapping each neutral column key (`c1`, `c2`…)
to the id of the organisation whose column it is, with `strength.revenue`
naming the revenue column where the grid has one. The compiler
(`compileStrengthGrid`) proves the heading, emits the grid op through
`emitGrids`, checks every named column is authored and every named
organisation is a compiled `kind.organisation`, and requires the label span
to hold at least one ordinal level and a `Total`. The header words and every
count arrive at import from the Judge's page: the executor's grid op joins the
header band by line (a heading may wrap), and the `dashZero` cell pattern
reads a printed dash as zero so a row of dashes is still a row.

`cookbookImportFactions` runs the grids after the relations: for each grid,
`strengthPlan` groups its columns by organisation, `strengthFromGrid` builds
one block per organisation from its columns alone (a header set in small
capitals is set as a name, like a heading), the page reference lands in
`note`, and the block is written only to a faction whose `strength` is still
empty, so a Judge's edits survive a second run. The page's total row is a
check: a column whose sum disagrees is reported on the console and the block
is written anyway. Revenue is planned only for a grid whose every column is
one body's. The report line counts factions "given their strength" and
"kept their figures".

Lint (`checkStrengthGrid`) holds the row to the shape: a numbered label,
column keys `c<n>`, ids of this book's organisations, a revenue column that is
not a counted one and only on a single-owner grid. `verify-cookbook` passes a
strength grid on its heading and its level rows plus the total.

## City travel and trade

The city-travel recipe (`cityTravel` tables, AX3 p. 56) includes two optional
prose windows. `businessProse` reads two windows (`tolls` and `smuggling`) that
materialize as `gateTolls` (what a gate pass costs a load of merchandise) and
`smuggling` (what the syndicate's smuggling service charges and risks). Both are
printed, so both arrive by import from the Judge's copy and are registered
through the settlement feature's table expectations (`docs/formation/MODEL.md`,
"The gate action" ROADMAP).

## A point of interest

The points-of-interest step (`cookbookImportPoiPlaces`) brings location actors
and their tokens into the world, and stamps a role on any place whose
`kind.location` row carries a `meta.role`. When a held place (one the world
already carries) has a blank `system.role`, the step writes the role from the
import without reading the page — the figure is a designation, not a
measurement — and counts "given a role" in its report. (`docs/location/DECISIONS.md`,
"A place has a role").

## An organisation's services

The organisation row (`kind.organisation`) carries a `services` block key:
a list of the services this body provides. The registry's lint and the faction
feature's bindings read it; today it is the `"smuggling"` tag that marks a body
offering that trade route.

## An entry's heading line

An AX book's entry is anchored on, and its flow stopped by, heading LINES
(`axHeadingLines`): runs of heading height (11.5pt and up) clustered by
baseline, below the band of running heads (y 55) and above the folio (y 750),
inside the margins (x 30 to the page's width less 30, which drops AX3's
margin banners), split into segments at a gap wider than a word space or at
any gap that crosses the page's midline, where two keyed headings meet across
a 20pt gutter. A row whose book sets its headings outside that shape says so
in `assists.headingLines`: `minH` for a smaller heading face (AX1's 11pt
table titles), `caps` for headings set in body-size small capitals, which
extract as a scatter of case and are told from body lines by their lowercase
being fragments rather than words (AX5's monsters), `topY` for a section
heading printed in the running-head band (AX1 p.37), `x0` for a page whose
column starts inside the default margin (AX1's even pages, at x 28). The
override reaches the anchor, the hash candidates and the flow's stop alike.

## A roll table's rows

`kind.rolltable` compiles to `fields.rows`, one text paragraph per row under
an `r<lo>` / `r<lo>-<hi>` section the binding turns into result ranges. A
GRID row (`assists.grid`, or `assists.grids` merged in order) is found by its
die run, one of three ways per band (`gridBandParas`): die line downward (the
default), by a die printed vertically centred in its cell (`centerDies`), or
by one authored `[y0, y1]` band per row (`bands`). A centred die's baseline
mirrors the cell's top line onto its bottom line, so rows are cut in order,
each row's top the first line under the row before it; cells of uneven height
cut right where a midpoint between dies would not, and a line left under the
last row is a compile error naming it, since the band's y1 then reaches into
something else. Bands are for a cell whose leading is too uneven for the
mirror to find its bottom line. Each row of either mode holds exactly one
die, or the compile errs naming the band or the die. Lint allows one of the
two per band. A die the printer fused with the first run of its cell ("15 The
members…") is read off the run's head and stripped from the text by character
count, in every mode. A row whose cell column holds no run is a compile error
naming its die, unless the band says `keepEmpty`: the row then ships
`empty: true` and reads as an empty result text.

`assists.details = {by, regions}` (`rollTableDetails`) appends the text that
explains each row, printed beside the table or on later pages. `regions`
(`{page, x0, x1, y0, y1}`) are read in order into paragraphs as any flow is,
and kept out of the entry's own flow. A line that opens with a row's key
opens that row's block, and starts a paragraph of its own even where the
column sets no gap between entries — `by: "number"` a die key ("(2)",
"(3-4):", or one closing a run of capitalised heading words), `by: "name"` a
run-in label ending in ":" whose fold equals or begins with a row's cell
fold, the longest cell winning — and the block runs to the next opener,
across regions. A key or label that opens nothing — no row has it, its row
already has a block, or (by number) its row comes no later than the open one
— stays in the open block as text: a sub-table's own numbering and a stat
line's run-in label are that shape. Paragraphs before the first opener are
left unread. The compile summary gives each entry's count of both (a key
inside a paragraph that opens nothing is not counted) and of rows
left without details, which is where a mis-measured region shows; only a
region with no text or one overlapping the rows is a compile error. A pure
key that opens a block is dropped; heading words and labels stay. Detail
paragraphs ship after their row's own with the row's section and
`detail: true`; the executor keeps each a paragraph of its own (joining one
that turns a column or page mid-sentence to the one before) and passes the
mark on to the roll-table import, which joins a row's paragraphs into its
result text in order. Lint checks the assist shapes; the cookbook coherence
test checks that every detail follows its own row.

A value instruction's `throw` pattern reads a throw target, the first
`<n>+`, where `int` would read a die expression's count first; it is null
when the text prints no target.
