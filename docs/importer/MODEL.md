# Importer — Design Model

> Merged from the separate acks-importer repo on 2026-09-01. Text written before then names paths as they were there: `scripts/x.mjs` is now `scripts/importer/x.mjs`, `tools/x.mjs` is `tools/importer/x.mjs`, `flags["acks-importer"]` is `flags["acks-extras"]` (the importer's `generated` key is now `minted`), and `acksImporter.fn()` is `acksExtras.importer.fn()`.

How this module applies the family doctrine **reuse → extend → enhance →
invent**:

- **Reuse**: which core `acks` documents, fields, and methods it builds on.
- **Extend**: genuinely new data, stored in `flags["acks-extras"]` (typed by
  an in-memory DataModel where practical; blank numerics are `null`, never 0).
- **Enhance**: alternate sheets, libWrapper wraps, socketlib GM routing.
- **Invent**: kept to nothing the system already provides.

## What an import reads

Every importer that builds a document from one cookbook entry reads the entry
off the seat's own copy of its book first (`cookbook.mjs` `readForImport`).
An entry whose book is not open on the seat, or whose page no longer matches
the cookbook, is passed over and counted into the run's notice (`passedOver`);
nothing is created from the entry's shape alone, and a book opened later
imports what was passed over, since every import steps over what the world
holds and builds the rest. The equipment sweeps that delete what the import is
trusted to rebuild keep what it would pass over. The one bookless build left
is a monster's embedded copy of a proficiency whose book is closed, on an
actor whose own book is open (`bindMonster`, step 2). The ruling is DECISIONS
2026-10-29, "Nothing is imported without the book".

## The import manager

One window (`apps/import-manager.mjs`, `openImportManager({tab})`) holds a
Judge's import controls, reached from the *Manage Imports (GM)* macro, the
settings menu (`importManager`, `ImportManagerMenu`) and the Books window's
walkthrough band. It keeps no state: `installImportManager(host)` is given
the importer api, the chain and the runs at ready, every tab reads them at
render, and every press hands off to a run that already exists and asks its
own questions. Five tabs:

- **Books** — every book this build reads (`BOOKS`), whether it is open on
  this seat and what it brings (`cookbookCount`, the recipes naming it), and
  the button that opens the Books window. Connecting, staging and status stay
  in that window; the tab is the status line and the way there.
- **Import** — the chain (`GM_STEPS`, exported from `getting-started.mjs`) in
  its order, numbered, run whole (`runImportEverything`) or one step at a
  time (`runImportStep(key)`, `api.importStep`).
- **Rebuild** — the shelf, book and rules-table options of
  `rebuildOptions()` under a mode, run by `runRebuildPick(value, mode)`. The
  Reimport One Shelf dialog draws from the same two functions, so the two
  surfaces can never offer different things.
- **Adventures** — each adventure book open on this seat (`adventureBooks()`,
  each with its `bookCensus`): Rebuild and Repair run
  `cookbookReimportAdventure` in its two modes (below), Write Adventure runs
  the adventures step for that book alone.
- **Tools** — the entry picker, the audit, the repair window on the
  importer's checks (every check where it registers none), the merchandise
  build, Remove All Imports.

One run at a time: the window names what runs in a status line and disables
its buttons until the run resolves, then re-renders.

## An adventure book, rebuilt or repaired

`cookbookReimportAdventure(bookId, {mode})` treats one Judge's book as a
unit, as `cookbookReimportBook` treats a book's shelf items.

**Rebuild** (`mode: "drop"`) deletes every Actor, RollTable, JournalEntry and
Item the book's stamp names (`bookDocuments`, both the library's copy and
the world twin it is filed under, `adventureDropRows`) and the book's
Adventure off its shelf, forgets the import index, then runs the book's
steps again. Not deleted: the book's maps, which the scenes step refreshes in
place (`repairHeldMap`) and which carry the Judge's regions, fog and tokens;
a copy dragged out of the library (`isWorldCopy`); a character a player owns
(`playersCharacter`); a document another book owns that merged one of this
book's ids. What comes back stands under the ids it had: `deleteImported`
records every removed document's id by type and cookbook id, and
`createDoc`/`createDocs` settle every type's id through `itemIds` (the
record, else `stableDocId`, else core's), so a map's pins and an
organisation's seats resolve again.

**Repair** (`mode: "repair"`) deletes nothing: the same steps run, each
passing over what the world holds, and the adventures step runs with
`force`, which `bookAdventureState` reads as stale whatever the stamp says,
so the Adventure is written anew, a Judge's edit to it included.

The steps (`runAdventureBookSteps`) are the chain's that read an adventure
book, narrowed to it in the chain's order: its monsters and people the world
lacks (`importMany`), journals, places (only where the book has place rows),
factions, market profiles, roll tables, the items it introduces, its maps and
their links (only where it has scene rows), and its Adventure. The narrowed
runs (`cookbookImportJournals`, `cookbookImportPoiPlaces`,
`cookbookImportFactions`, `cookbookImportMarketProfiles`,
`cookbookImportRollTables`, `cookbookImportAdventureItems`,
`cookbookImportScenes`, `cookbookImportAdventures`) each take `{books}` and
return their empty counts quietly when the books named hold nothing for them.
One failed step is logged and reported; the rest run. The result is
`{book, mode, removed, steps, errors}`.

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
quarter's special list likewise, a quarter's after-dark figure is filled
where it was never stated (null), and the declared travel system is brought
to the recipe's `travel` where the map still carries the default the step
minted before recipes declared one (`journey` on a gridded plan, `settlement`
on an ungridded one). A rebuilt roll-table shelf mints new ids, which is
what leaves a map naming lists that no longer exist. What the Judge drew,
moved, typed or declared is not read; the step's summary counts the writes.

## A book as one Adventure

The adventures step (`cookbookImportAdventures`, last in the import chain)
writes one Adventure per open Judge's book to its line's Adventure shelf
(`ensureBookAdventure`), under `bookAdventureId(book)` and the kind
`kind.bookAdventure`. `bookAdventureSource` assembles it:

- every Actor, RollTable, JournalEntry and Item whose stamp names the book
  and an id (`bookDocuments`): the library's copy under the id of its world
  twin where the world holds one, else the world's own, the only source there
  is. A journal holds a group's pages, and no row names it, so the journals
  step stamps it `journalCookbookId(book, group)`, a hash of the group and
  never its words. A journal from before the stamp takes it on the step's
  next run;
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
`preImportAdventure` hook (`book-adventure.mjs`) empties `toUpdate` and
narrows `toCreate` to the fill (`fillPlan`), synchronously. The fill reads the
library, and a cold shelf (`libraryCold`) reads every library document as
missing, so `Adventure#prepareImport` is wrapped (libWrapper, `WRAPPER`):
before core lists what such an import would create, it says it is loading the
library and awaits `warmLibrary`, at most `WARM_TRIES` times. The hook still
refuses an import that meets a cold shelf, which by then is one that would
not load. In a book's Adventure every document is a root,
and a person, a list, a journal, an item, or a place no carried map shows
stays in the library when the library holds it, unless a place the import
creates sits in that place. `importAdventure` then
mirrors the links of every created or held map and draws its thumbnail, then
runs the link pass ("A way between maps"). The
patch lives here and not in `lib/` because only this feature builds these
Adventures; every other Adventure passes through untouched. One owner:
nothing else in the family hooks either or wraps `prepareImport`.

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

A plate that prints a building's storeys side by side on one squared grid is
one scene with a level per storey. The recipe's `crop` is the first storey,
and `levels` lists the storeys above it, bottom up, each as the corner
`{x, y}` the crop moves to (`storeyCrops`). One frame serves them all, so a
storey states no size. `recipeProblems` holds each corner to a whole number
of cells from the crop, so the grid lies on every storey's drawing, and
refuses `levels` off a square grid. The maps step and the
Adventure cut each storey's picture as they cut the first's. The first
storey keeps core's first level id and each one above takes
`storeyLevelId(n)`; each stands four cells' distance over the last, core's
own default level height, and is named `ui.sceneStorey`. A map of one storey
is written as before.

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
UNSAVED `Scene`: `hexProbe` measures Foundry's cell for the recipe's family
(a square lattice needs no probe), `gridScale` turns it into pixels per
point, and `hexAlignment` solves the shift for the recipe's `centre` carried
through `sceneFrame` and set on the origin of a clone at
`GRID_SCENE_PADDING`, the padding `sceneData` writes on every grid map. The
shift moves the picture up to half a cell off that origin, and core rounds
the padding up to a whole cell (a whole stride on a hex grid), so the picture
keeps a margin of canvas on every side. A settlement map keeps a padding of
0: it has no shift. A probe that cannot answer, an axis pair that disagrees,
or a picture that would not lie whole on the canvas core sizes round it
refuses the map (`gridRefused`, reported in the step's summary) before
anything is written; the Adventure step, which builds the same plan, throws.
The picture is cut at the plan's scale
(`uploadSceneMap`'s `pixelsPerPoint`); `mapCreateData` sets every token and
quarter down from the picture's corner on the canvas (the padded origin less
the shift, `placedFrame`), hands the
lattice and shift to `sceneData`, and keeps the scale in the scene's cookbook
flag (`pixelsPerPoint`) for the zones laid later. A recipe with a grid, no
quarters and no `place` of its own is a REGION's map (`mapIds`); a plan names
its place and is drawn on a grid too. A region's map is the region's place
(`regionPlaceId`), each placed site stands on the place its text was written to
(`regionSiteClaim`), a keyed place on it comes with every place it sits in, as
on a plan (`keyedAbove`), and there are no quarters to hand to organisations; the
picture's thumbnail and the places' scene links are written as for a
settlement, and the book's Adventure carries the map like any other. A zone
the world laid over a map rides into the Adventure moved by the change of
picture corner between the world map and the Adventure's (`zoneMovedBy`), its
cells read again off the lattice, so a world map made at another padding
still hands over its zones on the cells they cover. A region map whose book prints region rows waits
(`unready`) until the region's place has been imported. Without a grid,
`mapCreateData` builds a settlement map's data and no part of the grid path
reaches it; `test-region-import` pins that data byte for byte.

### A map's walls, traced from the page

A recipe with a square `grid` may carry a `walls` block, read by
`wall-trace.mjs` (its header says how each mode reads a plan):

- `mode` — `grid`, `contour`, `hatch` or `stroke` (`WALL_MODES`). `hatch`
  reads a plan as `contour` does once its hatched rock is closed, so what
  this section says of `contour` holds of `hatch`.
- `threshold` — the gray level, 1 to 254, the trace cuts the plan at.
- `opening` — in `stroke` only, the radius of the opening that clears specks
  off the ink before thinning, as a share of the cell, above 0 and at most
  `MAX_OPENING`; `STROKE_OPENING` when absent. A plan whose partitions are
  thinner than about twice the default states a smaller one.
- `corrections` — assertions on the recipe's lattice (`wallLattice`: cell
  `[0, 0]` is the first whole drawn cell at the crop's top-left):
  `{cell: [c, r], is}`, `{edge: [c, r, "n"|"w"], is}`,
  `{box: [c0, r0, c1, r1], is: "terrain"}` on lattice lines, or
  `{at: [x, y], drop: "island"|"door"|"window"}`, `{line: [x0, y0, x1, y1], is}` and
  `{rect: [x0, y0, x1, y1, turn], is: "terrain"}` in page points. A rect is a
  box off the lattice: the box between its two corners, turned `turn` degrees
  clockwise about its centre (`turn` may be left out), its four sides laid as
  terrain lines. Which states a cell may take depends on the mode
  (`CELL_STATES`). In `stroke`, `door` and `secret` name the kind of the
  drawn door whose box centre lies in the cell; a cell with none counts in
  `unplaced`. A line takes the same states
  in every mode (`LINE_STATES`): `wall`, `door`, `secret`, `terrain`, or
  `invisible`, a wall that blocks movement and no sense.
  `contour` and `stroke` drop a door by its point (`AT_DROPS`): the drawn
  door nearest the point, within half a cell. `stroke` drops a window the
  same way, by the throat nearest the point. An island point on the plan's
  floor or on the rock framing it, the largest component of its value, is
  refused (`islandsRefused` in the digest).
- `note` — the compiler strips it.

`wallsProblems` checks the block wherever `recipeProblems` runs, in the
register lint and in the compiler. It refuses corrections that weigh more
than `correctionCap`, which is `CORRECTION_CEILING` of the lattice's cells,
so a recipe that needs more never compiles. Past `correctionBudget`,
`CORRECTION_SHARE` of the cells, the lint and the compiler warn
(`wallsWarnings`) and the row still compiles. A correction weighs one, and a
box or a rect `BOX_WEIGHT`.

On a plan of storeys one `walls` block serves every storey, and the budget
and the cap are the lattice's cells times the storeys. Its corrections are
page points (`at`, `line`, `rect`), each lying inside one storey's crop, the
storey it corrects; a correction on the lattice (`cell`, `edge`, `box`)
names no storey and is refused, as are storeys whose crops overlap.

What every mode does with a plan:
- **The crop's own edge is no wall.** In `grid`, a floor cell on the
  lattice's border is walled there only where the crop's strip beyond the
  lattice is a quarter cell deep or more and mostly rock. In `contour`, an
  outline segment running along the render's border is dropped.
- **A secret door stands on both mouths of its cell**, so the wall reads
  whole from either side; `secret` in the digest counts both.
- **A terrain box's four sides** stand where no traced wall does (`grid`) or
  beside the outline (`contour`, `stroke`). An edge correction overrides a
  side, so an edge asserted `open` is a gap in it. `terrain` in the digest
  counts the sides' segments.
- **A door box split by a bar is a double door** (`grid`): two leaves on the
  box's centre line, one from each end of the opening to the bar
  (`splitBoxes` in the digest). An opening is a run of asserted door cells
  along one wall line, so a box over two cells, split on their shared line,
  is read once. Any other door stands across each cell's middle.
- **A door in `stroke` is the box the plan draws** across a wall
  (`drawnBoxes`): the wall through it is cut, and the door runs along its
  axis from wall end to wall end, at whatever angle the box is drawn. Two
  boxes end to end a bar apart are one split box, two leaves meeting at the
  bar. The digest counts both kinds (`boxes`), the stroke paths kept
  (`paths`), and the corner tines pruned (`spurs`). A short path that runs
  along a box's axis into its end is the wall the door hangs in and is never
  pruned, so the door meets a wall at both ends. A door dropped by its point
  leaves its box cut, so the opening stands open.
- **A window in `stroke` is the throat of a splayed gap** (`windowThroats`):
  the narrowest paper crossing between two facing jambs, where the gap
  widens away from it, as a splayed jamb or a notch cut down to a slit does.
  Each throat is drawn into the ink before thinning, so the wall runs on
  across it, and the stretch inside it is an invisible segment. Sight passes
  at the throat alone; the flanks are wall. `windows` in the digest counts
  them. A drawn door box covers the gap it hangs in and stays a door. A
  window dropped by its point leaves its gap as drawn.
- **A line is laid last.** A door or secret line replaces every traced door
  whose middle lies within half a cell of it (`doorsReplaced` in the
  digest), and in `contour` closes against the outline like a traced door.
  A line of any kind replaces a traced door or window lying along it, both
  its ends within 0.15 of a cell of the line, so a box that is no door (a
  window) is restated by one line. Every line then stands as the kind it
  asserts; `invisible` in the digest counts the invisible segments, the
  windows' among them.

The map step traces after the picture is uploaded and before the one create.
`traceSceneWalls` (`module.mjs`) renders the crop of the seat's page to gray
at `TRACE_PITCH` pixels per drawn cell (`extractPageGray`, print intent on
white), and on a plan of storeys every storey's crop; a storey that does not
render leaves the map without walls. That render is separate from the
picture, so the trace reads the same plan at any picture size. `traceWalls`
returns segments in page points with core's door type, and a digest the
console logs. `traceStoreys` traces each storey with the corrections lying in
its crop, moves its segments into the first storey's crop by the storeys'
offset, and tags each with its storey's ordinal; its digest sums the
storeys' counts and adds `storeys`. `wallSources` stands a tagged segment on
its storey's level alone (`levels`), the first storey's being core's first
level id and each above `storeyLevelId(n)`; a map of one storey states no
`levels`, which core reads as every level. In `contour` mode a door end
left on the floor side of the outline is carried to the nearest wall within a
quarter cell, and just past it (`closeDoor`). `wallSources` carries the
segments through the placed frame the tokens use, rounds them to whole pixels,
and drops zero-length ones. A terrain segment takes core's Terrain wall
senses (`TERRAIN_SENSES`): it blocks movement, and a sense stops at the
second terrain wall it crosses. An invisible segment takes core's Invisible
wall senses (`INVISIBLE_SENSES`): it blocks movement alone. The walls ride the scene's create
(`sceneData`), and a walled scene is indoors: token vision on, each user's own
explored fog, darkness 1 locked, no global light and no weather
(`WALLED_SIGHT`). After the recipe's own Regions it carries one more over the
whole canvas, padding included (`indoorRegionData`): locked, drawn on the
Regions layer only, standing on every storey's level, flagged
`cookbook.indoors`, with core's Suppress Weather behaviour. Core drops a
darkness change from any update that does not also name the lock, so a module
that sets darkness by the clock leaves the map dark, and the Region hides any
weather drawn over it. A map without walls is outdoors and states neither, so
the world's clock may light it and send weather over it. `withWorldIds` gives
a rebuilt roof the held one's id. A
trace that cannot run leaves the map without walls and counts it
(`wallsFailed`). A held map is never re-traced.

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
- `targetAt` or `chanceAt`, `everyAt`, `levelAt`, `dayAt`, `nightAt` —
  optional boxes (`page`, `x0`–`x1`, `y0`–`y1`) over the zone's own printed
  encounter target, the delve's throw interval in turns, the floor's dungeon
  level, and the day and night throws (`ZONE_FIGURES`). A row reads its
  target through one of the two.

`compileSceneZone` checks it (`zoneProblems`) and files it under the
cookbook's `scenes` beside the recipes (`isZoneRow` tells the two apart), each
box as a value instruction: `targetAt` with the `throw` pattern (a target
printed `<n>+`), `chanceAt` with `rollTarget` (one printed in words, or as the
low end of two faces), the dungeon level with `int`, the interval and the
throws with `countWord`, which reads a digit or an English count word from
`register/_refs/countWord.json` and yields 0 (inherit) for a box that reads
nothing. What no single compile can see — that the scene is a compiled recipe
in some cookbook, that the table is the zone's own book's, and that the
outline lies inside the recipe's crop — is asserted by
`test-cookbook-coherence`. `zoneRegionData` shapes the Region: visible to the
GM only, locked, one polygon per snapped cell (else the outline carried
through the frame), the `acks-extras.encounterZone` behaviour with the list,
target, interval, dungeon level, cadence and throws, and flags naming the zone
and the cells it covers. An adventure's dungeon level is one zone over the
whole of its plan, so a party anywhere on the level reads its rule. A zone
whose outline covers its recipe's crop (`coversCrop`) is drawn on the
Regions layer alone.

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

### A way between maps

A `kind.sceneLink` row (`register/_kinds/sceneLink.json`) joins boxes on scene
recipes, which may be two books'. It is named `Link <n>` with the id
`<book>.link<n>`, has no text anchor, and carries a `link` block:

- `mode` — `teleport` (from one map to another, or to another spot of one)
  or `level` (between the storeys of one plan of storeys).
- `ends` — two or more `{scene, box, level?, place?}`: the recipe's id, a box
  in page points on the storey `level` names (0, the recipe's crop, when
  absent), and optionally the `kind.location` row the end stands for.
- `both` — false when only the first end leads anywhere; else every end
  leads to every other.
- `confirm` — true when the end asks before it moves a token.

`sceneLinkProblems` (`tools/importer/register-rules.mjs`) holds the row to
that shape: a storey the scene has, a box on that storey's crop, a place that
is a location, and a `level` row's ends on one scene, each on a different
storey and on one spot once carried to the first storey. `compileSceneLink`
files it under the cookbook's `scenes` beside the recipes and zones
(`isLinkRow`), its notes dropped. `test-cookbook-coherence` asserts what one
compile cannot see: every end's scene is a compiled recipe in some cookbook,
and its box lies on that recipe's storey.

The map step joins the links after its last zone (`joinLinks`), an
Adventure's import after it has made its maps (notifying only where it made,
repaired or refused an end), and `cookbookImportLinks` runs that pass alone.
It reads every cookbook's link
rows, open or not, against the maps the world holds (`heldMapOf`). A row
naming a map no cookbook carries is refused (`linksRefused`); one naming a
map the world does not hold yet waits (`linksWaiting`), and the notification
names the books whose maps it waits for.

Each distinct end is one Region, however many rows name it
(`linkEndKey`: the scene, the storey, and the box carried to the first
storey by `linkBoxOnFirstStorey`). `linkRect` carries the box through the
map's live frame, at least one cell each way, and `linkRegionData` shapes
the Region: visible to the GM only, locked, one rectangle, flagged with the
end's key, the rows naming it and the book.

- A `teleport` end's Region holds core's `teleportToken`, on its storey's
  level alone (`storeyLevelOf`), since core refuses a destination standing
  on several levels of a scene. Its destinations are the Regions of the ends
  it leads to, set once every Region exists. It asks first (`choice`) where
  it leads to several, where a row says `confirm`, and on a region's map
  (`isRegionRecipe`), so a journey crossing the hex is not diverted; the
  question is a lang key (`LINK_ASK`) core formats with the token, region
  and scene.
- A `level` row is one Region over every storey it names, holding core's
  `changeLevel`, which asks a token entering it which storey to take and
  keeps its position.

A Region is named for the place its end stands for, as this world names that
place, else `Link <n>`, and a compass word (`compassOf`), so that the options
a choice offers are told apart. Ends on one map under one name are placed by
thirds of the rectangle they span together (`spanOf`); an end alone under its
name, by thirds of the picture.

A map already carrying a Region flagged with an end's key holds it
(`linksHeld`). Its teleport's destinations are read as core reads them,
relative to the behaviour, and those that no longer resolve are dropped,
those missing are added, and a teleport that comes to lead to several is
made to ask (`linksRepaired`). A destination the Judge added stays, and a
behaviour the Judge removed is not put back.

The book's Adventure carries every link end its rows lay on its own maps,
whichever of those maps the world holds (`withAdventureLinks`). An end the
world's map holds is carried as that map holds it, under its ids. An end the
world lacks is laid as the map step lays one, on a scene built like the
Adventure's, under ids derived from its map's seed. Then every teleport is
repaired as a held one is. Its stored destinations are read against the
world's behaviour, the ones that resolve are kept, and the Regions of the
ends its rows name are added in the form core stores
(`foundry.utils.buildRelativeUuid`). A row with an end on another book's map
is not laid. The Adventure keeps the world's scene and Region ids, which are
the ids it imports under. Its import brings the laid ends with their scenes
and writes to no map the world holds, so a held map's ends still name the
Regions they named when the Adventure was built until the pass re-points
them.

### A region's places

A region's gazetteer is not a settlement. Its rows sit under two whole group
names (`REGION_GROUPS` in `poi-binding.mjs`): `Region — Sites` for keyed sites,
which anchor by key number, or by hash where the site's title runs in (see "A
run-in keyed area"), and are named `Site <n>` with the id
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
step lists the region's place and each place it makes for a site in its
`created.places`. The journal step leaves region rows alone (`journalBound`).

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

## An item a book introduces

A `kind.adventureItem` row (`register/_kinds/adventureItem.json`) is a
name line and the prose under it, to the next item's name line
(`compileAdventureItem`; the book's item lines are the compiler's
`itemStops`). The name line is a body-size run-in, or a display heading where
the book sets one (`anchor.as`); a sidebar set beside the prose stays out of
it, as it does of every flow. The items step (`cookbookImportAdventureItems`) makes each a
core `item` named from the page, its description the prose with the page
reference last, filed under the book's folder in its line's Item pack, and
claimed by its cookbook id like every item. Beside the prose, three things
are read from the paragraph (`adventure-item-binding.mjs`): the place it
says the item is worn, declared as the item's one slot
(`flags.acks-extras.gear.slots`, the earliest body place the paragraph
names, a tail or an unnamed place being the uncapped `worn`), which is what
makes a plain item wearable on every sheet; its cost line, as `system.cost`
in gp; and a stated crafting time, which marks it magic
(`flags.acks-extras.markets.magic`) so the one-of-a-form rule counts it. A
thing nobody wears, a dose, declares no slot. What the paragraph grants — a
bonus, a daily power — stays in the description. The rulings are DECISIONS
2026-10-19, "An item a book introduces is a core item read whole", and
2026-10-28, "An item a book introduces is worn where its page says".

## A passage read whole

A `kind.prose` row is an essay, a tavern's text, a page of notes: prose the
book prints under a title set as a picture, which the heading detector cannot
read. The row anchors by hash on the passage's first body line (`anchor: {hash,
as: "runin"}`), the one line it can prove it found, and `compileProse` flows
from that line — on it, not under it — down the column, across the page and
over the leaf to the last page the row names. A passage is the text no row of
its page reads, so it ends where a sibling passage opens (`proseStops`) or any
other row of its pages does (`rowStops`). Nothing in the body is parsed; the
paragraphs ship as the page sets them, opened by the book's declared
`paraGap`, from its declared `bodyTop` down. The journals step binds each as a
page of the JournalEntry
its `meta.group` names, titled by what the passage IS (`meta.title`: an
introduction, a tavern, conversion notes), its body the paragraphs with the
page reference last. A key the passage prints inline — a tavern's room
numbers — stays in the text; the keyed-room shape is `kind.location`. The
ruling is DECISIONS 2026-10-23, "A passage is a journal page under a
functional title". AX1's chapter openings, its backgrounds and the sections no
keyed row reads are its `Adventure` journal.

A sidebar is a passage too, set in the book's aside band (`asideH`), which no
flow reads. Its row anchors by hash on the sidebar's head as a display
heading and names the sidebar's box (`assists.aside`: `x0`, `x1`, and `y1`
its foot); `compileProse` reads the aside-size runs in that box below the
head, and nothing around it. AX1's thirteen are the `Notes` journal, one page
each. A paragraph the sidebar is set into is boxed line by line around it
(`axAsideBoxes`), around its head as well as its type, so the prose reads
neither.

## A person the page prints in full

A `kind.npc` row carrying `meta.actor: "character"`, and every `kind.pregen`
row, imports as a core `character` (`importCharacter`, through
`characterEntry`); every other `kind.npc` row is a monster actor (`bindNpc`).
Both ride the monsters step, which runs after the classes and their template
packages. A pregen files under the book's `Pregenerated` folder, a person under
`NPCs`. The ruling is DECISIONS 2026-10-17, "A person the page prints in full
becomes a character, and the derivation wins".

- **Its id.** The character is made on the library shelf under
  `stableDocId(<cookbook id>)`, with `keepId`, so a rebuild (a delete, then a
  create) keeps every roster, link and Adventure reference to it. Where a
  document already stands under that id the import skips the row and says so
  on the console.
- **The sheet's boxes.** `sheetValuesFromStatline` (`character-binding.mjs`)
  reads the parsed line into the official sheet's form keys, and the sheet
  import (`character-sheet/pdf/apply.mjs:importSheet`, with `record: false`)
  does the rest: it binds the class at the printed level, writes the scores,
  hit points and alignment, grants the proficiencies and the repertoire, and
  lands the gear and the coin. The sheet import grants what the library
  holds, so the proficiency tokens go through `resolveAbilities` first, which
  imports from the cookbook any definition the library lacks. With a class bound, a figure the class works
  out (saves, throws, spell slots) is compared rather than written, and each
  disagreement is a check. The armour the AC bracket names and the equipment
  are worn, each piece in the slot its item asks for; the weapons the attack
  and damage brackets name go to the weapons table without dice, since the
  printed damage carries the bonuses. The line's XP is the defeat award and
  is not written, and the save code is left to the class. Morale is written
  here, clamped to the system's own bounds.
- **Its names.** Every class, proficiency and spell name passes through
  `libraryNameFor` first: a class or spell the library answers keeps its
  name, else the conversion table's rename of that category
  (`registers.tables.conversion`). A class neither answers is then read
  behind its qualifier (`classBehindQualifier`: the longest run of trailing
  words the library answers, as a tradition set before the class), and the
  block notes the class it was read as. A proficiency resolves through the
  ability index, whose aliases carry older printings' names. A name nothing
  answers is reported, and the character is still made.
- **Its shape on the page.** A quick-stat line is one `statline` op
  (`parseStatline`). A person the book spends a page on is written out as
  labelled lines under a display name — the class line and the scores, then
  "HP:", "AC:", the saves, the attack, the proficiencies by kind, the
  abilities, the inventory — and ships as one `writeup` op
  (`compileWriteup`, on a `kind.npc` row carrying `assists.writeup`):
  `parseWriteup` reads it by its labels into the same shape, so the binding
  above serves both. The block runs to the label that opens prose about the
  person (`writeup.proseLabelKey`, the label's print key), and that prose is
  the description. A write-up names its proficiencies by kind, so each kind
  fills its own rows and a token's throw bracket is the row's throw; a
  quick-stat line's one list fills the general rows and runs on into the
  class rows. The attack's routine stays text, never a weapon's name. The
  ruling is DECISIONS 2026-10-23, "A person written out is read by her
  labels".
- **A pregen's write-up.** An adventure's pre-generated characters are set as
  write-ups that run on past their column, and over the page, before their
  prose. `compilePregen` reads the block the way prose flows (`axFlow`: body
  type only, column to column, to the next display heading) and ships it as
  one `writeup` op read in `parts`, one per column it spans, each with its own
  page and fixes. The head opens level first ("Level <n> <alignment> <class>
  (<title>)") over an unlabelled "AC, Move, HP, ATK" line, and the scores sit
  under their own label; `parseWriteup` reads both shapes. The class line's
  paragraph is read to its title's closing bracket and no further
  (`fixes.keepPrefix` and `drop`).
- **What the page printed.** The biography holds the entry's prose
  (`entryText`), then the "as printed" block (`asPrintedBlock`): the stat line
  as printed, a line per check, a line per name the library could not answer,
  and the sheet import's notes rows. The block is stamped `data-acks-entry`
  like book text, so `stripBookText` takes it with the rest of the import's
  writing. `flags["acks-extras"].printed` counts `{differences, missing}`.
- **Who owns it.** The Judges alone (`ownership.default` NONE), and the import
  posts no chat card. A class with an elected damage bonus asks the Judge
  during the import, as a class apply does anywhere.
- **What a rebuild and Remove Imports leave.** A `character` a player owns —
  a non-GM user, or the default level, at OWNER — is never deleted by the
  entry picker's rebuild or by Remove Imports (`playersCharacter`); Remove
  Imports' confirm says how many stay.

## City travel and trade

The city-travel recipe (`cityTravel` tables, AX3 p. 56) includes two optional
prose windows. `businessProse` reads two windows (`tolls` and `smuggling`) that
materialize as `gateTolls` (what a gate pass costs a load of merchandise) and
`smuggling` (what the syndicate's smuggling service charges and risks). Both are
printed, so both arrive by import from the Judge's copy and are registered
through the settlement feature's table expectations (`docs/formation/MODEL.md`,
"The gate action" ROADMAP).

The `demand` rules-table document carries `rangeOfTrade` beside the
land-revenue window: a `gridRows` recipe over the Range of Trade table (JJ ch.
6 Step 7E, JJ 203), one row per market class keyed `marketClass`, its road and
water cells kept raw. The rows are declared in print order, smallest market
first, because each spec claims the first matching row below the one before
it. It registers at the world layer with every rules table, and markets reads
it (`docs/markets/MODEL.md`, "Range of Trade").

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

## A book's page bands

A book whose every page the AX defaults misplace is listed in the compiler's
`AX_BOOK_BANDS`, and each page read for it carries the book's bands
(`useAxBands`), in place of the defaults above: the running-head and folio
bands, the left margin a heading may hang to, the smallest heading that stops
a flow, the type size of its asides, the last column's right margin, the
column starts of its even and odd pages, and the line gap that opens a
paragraph and ends a stat block. On a book with a column grid a page's
columns are the grid's for its side of the spread, never detected, and a
column reaches to where the next one starts. A run set in the aside size is
read by no keyed area's prose, key line or stat block, and a paragraph whose
lines an aside shares is read through `boxes`, one per line beside it, so the
aside's runs fall outside every box. AX1 is the book listed; its measured
bands are the table's docstring.

## A book's typography

A book set off the family's ladder declares how its text layer prints beside
its fingerprint in `BOOKS` (`typography`): the body size its heights are
scaled from (`bodyPt`, onto the family's 9.5), the code points its ligatures
and bullets print as (`glyphs`), whether each ligature is a run of its own
(`ligatureRuns`) and whether a label's colon is set with the value
(`labelColon`), and the page measures its readers take in place of their
defaults — `leading`, `paraGap`, `bodyTop`, and `wrapAlign` ("top" where a
stat label sits on its value's first line). `useTypography` tags a document
opened by its id, in the compiler and at the seat alike, and `pageItems`
applies the declaration to every page read from it: heights scaled, glyphs
put back, touching ligature runs rejoined to their word, a leading colon moved
onto the label before it; the declaration rides with the page as
`typography`. An untagged document is read as before. A book set on the
ladder declares nothing.

A spread whose title is art has no display heading: `anchor.label` names the
body-size run-in it anchors on instead; the executor's expect reads that
label and the document takes the register row's name. A passage that runs
past its first column is authored as `assists.continuation` — columns in
reading order, each read from the body top to its first display heading, a
stop label or its own `y1` — with `assists.pageColumns` where a page's columns
must be stated and `assists.proseColumn` where a monster's prose sits beside
its block; a proficiency list that turns a column names it
(`profList.continues`).

## A run-in keyed area

A keyed area whose key opens its first paragraph (`anchor: {number, as:
"runin"}`) is found among its page's key lines (`axKeyLines`): body-size
lines that open with a key token ("9.", "9a.", "2-3.", "11c-l.", spaced or
not, closed by a full stop or a colon) in a face other than the page's body
face. The heading is the line's leading runs in the key's face, through a
short run of another face the key's face resumes after (a ligature has a font
of its own), and it closes with a colon, on that line or the next. The row's
name is a `heading` op boxed from the first run's origin to the last's and
checked by its key, and the flow starts on the key's own line with the
heading's runs dropped. A row in a key space stops where a sibling's key line
stands in its column: the compiler opens every row of the space first and
hands each flow its siblings' lines. Each quick-stat label in the area's
prose becomes an occupant — `occupants.<i>.name` (a creature lookup, also
written as `creatures.<i>`), `.count` (`countParen`) and `.stats`
(`statline`) — the first two read through a box around the label run's
origin, the stats through the label's block, which ends at the book's
paragraph gap.

A row anchored by hash on a run-in (`{hash, as: "runin"}`) is found among
the same page's run-in lines by the whole line's hash. Where no whole line
answers, a title closed by a colon with prose set on after it is boxed by its
head alone, from the line's start to the colon's run (`axRuninHeads`,
`axHeadBox`): the head is the row's name and the flow starts on its line. A
place row so anchored stops where the next titled row of its group opens
(`titleStops`). `harvest-runin-keys.mjs --titles <page>` prints each head's
hash.

A space's rows are written by `tools/importer/harvest-runin-keys.mjs`, which
walks the space's pages in reading order, writes one row per key under the
id and label the space derives, gives each its pages through the next key's,
and nests a lettered key under its number, else under the section heading
before it, else under the space. It prints the gaps in the key sequence, a
key found twice and a key line with no colon, which it writes no row for; a
gap is settled by an author against the page.

## An adventure's keyed places

A key space's rows are places. A row names its space and the place it sits
inside (`meta.space`, `meta.parent`), and a space is a row the others name
(`keySpacesOf`). The points-of-interest step takes every such row
(`isKeyedPlace`) as a location actor (`importKeyedPlace`); the journal step
takes none (`journalBound`). A place is filed in the book's `Places` folder,
named by the heading its page prints, and given its page's text, stat lines
included, as its notes. It sits inside the place its row names
(`keyedParentId`): its parent row, else its space, else the book's own place
(`oseAdventureId`), which every space sits in. A run asks for each place once
and its parent first (`keyedRun`), so the rows may be listed in any order. A
held place, the library's own document, is not read again; a world copy is
the Judge's and holds nothing for the step, as it answers no claim
(`claimActorImport`). It is given its parent where it names none, or
where the uuid it names resolves to nothing (a parent deleted and made
again); a parent that still resolves is left as the Judge set it.

A new place's roster is its occupants (`occupantsOf`), one hidden row each
(`occupantRow`), linked to the first of these that answers
(`keyedOccupantRows`):

1. the creature the register's lookup names (`occupants.<i>.name.ref`);
2. the library's creature of another book under one of the label's name keys
   (`creatureKeys`: the label's words, its last word in each singular form);
   a name two books print is answered by the later-published (`laterBook`);
3. a person or creature this book's own rows were imported as;
4. a creature made from the line itself (`statLineCreature`): a monster named
   as the label reads, its figures bound as a person's line is (`bindNpc`), the
   line its biography, filed in the book's `Creatures` folder and claimed under
   `<place id>-o<i>`, so a later run and a rebuilt room find it.

World copies answer none of these. A row's quantity is the label's count where
that is a whole number (`occupantFigures`); a count printed any other way, and
the line's hit points (each creature's where the line lists them), are its
notes. A person of the book stands once, with no notes. The step returns
`created.places`, the book's own place among them, and `created.creatures`,
and reports what it rostered and made.

A plan is the place it draws when its recipe says which (`place`): the map is
named for that place and linked to it, where a recipe that names none is the
book's own place's (`mapIds`). A plan of a place holds pins only for areas
inside it, however deep (`recipeProblems`); a key space stands as a pin only
on a map that names no place, as a region's map draws it among its sites.
Each pin is a hidden token of
the area at the point its page prints the key (`places`). A row that keys a
range of rooms stands once, on its first key. Two blocks built to one plan
are two recipes of one crop, each naming its own place; only the block whose
sub-areas the page keys stands pins. A recipe's `travel` is the
travel system its map declares (`mapCreateData`); a plan explored a turn at a
time says `delve`, and each map of a settlement, its streets' and each
building's, says `settlement`. A pinned room comes into the world inside the places it
sits in. The maps step brings every place a pinned room or the plan's own place
sits in, up to the book's own (`mapIds` `all`). In a book's Adventure a place
is created when a carried map shows it, and the places above it because a
created place sits in each (`fillPlan`). A map made before its recipe carried
pins keeps its shape (`repairHeldMap`); deleting it and running the maps step
again lays them.

## A place two books print

A pair is declared on the earlier book's row: `meta.sameAs` names the later
book's row, and `meta.unique` lists the ordinals of the earlier block's
paragraphs the place keeps (`pairProblems` lints both, and refuses a row bound
onto a market or an adventure, which builds no place). A run reads every
cookbook's pairs once (`placePairs`). A keyed place or region site whose pair
already stands in the library as a place of its own (`pairedPlace`) joins it
(`joinPaired`) and makes no second one:

- **The later row takes the place over** (`takeoverPatch`). The place takes
  the later id and book, and the earlier id joins `merged`. Its name becomes
  the later read only while it still equals `printed`, the name the place was
  built with, which every place the step makes stamps. The earlier block is
  replaced by the later one, followed by the earlier block cut to its kept
  paragraphs (`keepParagraphs`). The parent and the region follow the later
  build only while they still hold what the earlier build wrote, and a role is
  written only where there is none. Folder, image, roster and ownership stay.
- **The earlier row binds onto it** (`bindPatch`). Its id joins `merged`, its
  block, cut to the kept paragraphs, follows the later block, and a parent, a
  role or a roster is written only where the place holds none.

Both orders end in the same place but for its folder and document id. A place
answers for every id in `merged` (`claimIds`, `answersFor`) wherever a place
is looked up: the presence checks, the importer index (`importedIdsOfType`),
the maps step's crossing (`planCrossing`) and a book's Adventure
(`bookDocuments`). So the earlier book's rooms sit in it, its plans stand on
it, and both books' Adventures carry it. In the earlier book's Adventure the
place's parent is its own book's place, which that Adventure does not carry,
so the reference stays as the library wrote it. A world copy made before the
place joined keeps its library document's id; the maps step finds it by that
id and restamps it (`restamp`) rather than copy the place a second time, and
leaves its notes as they were copied.

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

`assists.nameExpect` proves a table's header box. With `text` it compiles to
an `expect` op that matches those words. With `hash` it compiles to a
`heading` op with `names: false`, which proves the box by the key of its
letters and returns no title. The hash form is for a header that prints an
instruction instead of a caption: the RollTable keeps its row's name, and the
header's words stay out of the cookbook. A `heading` op without the flag
returns the printed title, and `printedNameOf` names the table with it.

A value instruction's `throw` pattern reads a throw target, the first
`<n>+`, where `int` would read a die expression's count first; it is null
when the text prints no target.
