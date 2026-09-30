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
(`bringAcross`, `worldCopySource`). It then writes one Adventure per map to the
line's Adventure shelf (`ensureSettlementAdventure`): library sources, world
ids, world-form references (`adventure-binding.mjs`). A made map rewrites it;
a held map writes it only when absent. The scene's creation data is built by
one function for both (`mapCreateData`), over the world's documents for the
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

Core's `Adventure#import` is steered, not replaced. For an Adventure whose
`flags.acks-extras.cookbook.kind` is `kind.settlementAdventure`, a
`preImportAdventure` hook (`settlement-adventure.mjs`) empties `toUpdate` and
narrows `toCreate` to the fill (`fillPlan`), synchronously; `importAdventure`
then mirrors the created scene's links and draws its thumbnail. The patch
lives here and not in `lib/` because only this feature builds these
Adventures; every other Adventure passes through untouched. One owner:
nothing else in the family hooks either.

The shelf is an importer shelf (`importedPacks` files it, Remove All Imports
deletes it) but not a library type (`library.mjs` `LIBRARY_TYPES`): nothing
warms or reads it.

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
