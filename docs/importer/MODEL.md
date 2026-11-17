# Importer — Design Model

> Merged from the separate acks-importer repo on 2026-09-01. Text written before then names paths as they were there: `scripts/x.mjs` is now `scripts/importer/x.mjs`, `tools/x.mjs` is `tools/importer/x.mjs`, `flags["acks-importer"]` is `flags["acks-extras"]` (the importer's `generated` key is now `minted`), and `acksImporter.fn()` is `acksExtras.importer.<fn>()`.

How this module applies the family doctrine **reuse → extend → enhance →
invent**:

- **Reuse**: which core `acks` documents, fields, and methods it builds on.
- **Extend**: genuinely new data, stored in `flags["acks-extras"]` (typed by
  an in-memory DataModel where practical; blank numerics are `null`, never 0).
- **Enhance**: alternate sheets, libWrapper wraps, socketlib GM routing.
- **Invent**: kept to nothing the system already provides.

## What an import reads

Every importer that builds a document from one cookbook entry reads the entry
off the seat's own copy of its book first (`cookbook/read.mjs` `readForImport`).
An entry whose book is not open on the seat, or whose page no longer matches
the cookbook, is passed over and counted into the run's notice (`passedOver`);
nothing is created from the entry's shape alone, and a book opened later
imports what was passed over, since every import steps over what the world
holds and builds the rest. The one bookless build left
is a monster's embedded copy of a proficiency whose book is closed, on an
actor whose own book is open (`bindMonster`, step 2). The ruling is DECISIONS
2026-10-29, "Nothing is imported without the book".

## A monster's printed modifiers

A monster entry may carry `effects` recipes in its register row, as a
definition does: `compileMonster` passes them through `citeSpecs`, the same
cited passthrough `compileDefinition` uses. `executeEntry` stamps the node with
`effectsFrom` (`effectsOriginOf`), and `bindMonster` binds the rows only when
they came from a recipe, onto ONE embedded `ability` item named
`ACKS-IMPORTER.monster.recipeAbility`, carrying the entry's `cookbook.cite`;
the scan's guesses on monster prose are never bound. The item has no
`cookbook.id`, and its name matches no definition, so Update Abilities neither
adopts nor prunes it. The first such rows are the light-gated attack throw
penalties (lib MODEL, "The light gate"; DECISIONS 2026-11-16).

## A stat block's proficiencies

`bindProficiency` (`cookbook/monster.mjs`) mints the ability item for each proficiency
a stat block names, for a direct import, a family member, a refill and *Apply
Stats* (`applyStatsToActor` hands `mapPairs` the resolver
`proficiencyResolver()` builds). Three tiers, first hit wins: the item the
library already holds, copied whole with its extras; the cookbook's
definition, built as `bindAbility` builds it; else the namesake
(`stats-map.mjs` `namesakeAbility`). A name is matched as printed, then as a
power's printed name (`refForPrintedName`); an authored `ref` wins outright.

The first two carry the definition's own `extras`, category included. The
namesake has no definition behind it and writes `extras.category: ""`, and a
blank category reads as unknown everywhere (`docs/abilities/MODEL.md`). A
re-import or refill (`REPAIR.monster`, `minted: ["items"]`) and *Apply Stats*
replace the actor's minted items with this build; a namesake minted before it
has no extras at all and reads the same, so none is migrated.

## A stat block's natural attacks

`mapPairs` (`stats-map.mjs`) recognises a natural weapon by name stem and sets
`flags.acks-extras.naturalWeapon`. Two figures it needs are the Judge's import
and are passed in, never held in source: the damage type each natural weapon
is listed against (registry document `monsters`, table `naturalWeaponDamage`,
a `gridRows` read of the Damage table, MM Overview p. 12) and the edges of
the extraordinary-damage rule (table `extraordinaryRule`, a `proseValues`
read of the same page, through the `hitDice` and `sizeWord` takes). The
callers read them with `monsters/natural-weapons.mjs`
(`naturalWeaponDamageMap`, `extraordinaryEdges`). A weapon's type is the
stat block's own damage icon where the block prints one, else the imported
table's, else none is written. Which monster types each rule covers stays in
`extraordinaryNatural`; where its answer needs an edge that was not imported,
or a size that was not read, the `extraordinary` flag is left unwritten.
`docs/monsters/MODEL.md`, "Natural weapons and extraordinary damage", has the
reader's side.

## The import manager

One window (`apps/import-manager.mjs`, `openImportManager({tab})`) holds the
importer's controls, reached from the *Manage Imports (GM)* macro, the
settings menu (`importManager`, `ImportManagerMenu`) and every entry point
that reaches the Books tab (below). It keeps no state:
`installImportManager(host)` is given the importer api, the chain, the runs
and the Books panel builder at ready, every tab reads them at render, and
every press hands off to a run that already exists and asks its own
questions. Five tabs:

- **Books** — every book this build reads: the first-run
  walkthrough, the server shelf, the controls that answer for several books,
  one row per book, the refresh-bridge line and Forget. `booksPanel` in
  `module.mjs`, where the seat's books, shelf and file handles live, builds
  it as `{html, wire}`; the template prints `html` in the tab's section and
  the manager calls `wire(element, {rerender})` after each render of the
  body, scoped to `[data-books-panel]`. A listener that changes what the
  bands show (staging, unstaging, a scan) calls `rerender(report)`: the
  manager queues the report (`queueBooks`) and renders, so the next build
  carries it in the shelf band. `openBooksDialog(opts)` is
  `openImportManager({tab: "books", ...opts})`, and `bookStatus`,
  `connectBook`, `reconnectBooks`, `gettingStarted` and the join-time offer
  go through it; the first three keep their names for macros already
  imported into worlds.
  **Who sees it.** Any seat may open the manager. A seat that is not a GM has
  the Books tab alone: `_prepareContext` drops the other four tabs, reads
  neither `rebuildOptions` nor `adventureBooks`, and every action that writes
  the world refuses. The settings-menu entry stays restricted.
- **Import** — the chain (`GM_STEPS`, exported from `getting-started.mjs`, 21
  steps) in its order, numbered, run whole (`runImportEverything`) or one step
  at a time (`runImportStep(key)`, `api.importStep`). Run whole, the chain
  shares one run object, and each step is handed `{quiet: true, run}`. The
  rules tables are split over two steps. `stepTables` runs first and reads
  them (the page read, then the store's assembly of the builder and travel
  tables), keeping its report in `run.tables`. `stepTablesApply` runs after
  `stepClasses` and before template packages, and applies only the documents
  that report names: races, class builds, skill armour-limit rows and
  languages, then the race-tongue sync. Class pricing reads the assembled
  tables during `stepClasses`. Either step run alone reads and applies in its own call. The
  split and its reasons are DECISIONS 2026-11-13, "The rules tables are read
  first and applied after the classes". The journals, keyed-places and maps
  steps, finding nothing in the open books to write, resolve null without a
  notice, as they do when a book's rebuild scopes them to that book; run
  alone, they say what is missing. Beside **Import everything**, which runs the chain,
  **Repair everything** runs the merged repair (below) over every open book
  and every open adventure book (`host.runEverything("repair")`, which calls
  `api.reimportEverything()`), asked once. `everything.mjs` runs each part first with an `ask` that records the
  confirm it would show and answers No, which writes nothing because every
  part asks before its first write (`confirmRepair`'s `ask`). That pass runs
  inside `holdingLibrary`, so the library is read once per document type for
  every part rather than once per part. Every open book asks, because its
  repair imports the entries the world lacks. The lines go into one confirm
  under each part's label, and a Yes runs each part that asked with its
  confirm answered, every part under one tally per pass, so the edits all of
  them held are put to the Judge together. The rules tables are read once,
  after the Yes and before the first part runs (`before`), and applied once in
  `finish`, after the last pass and before each adventure book's Adventure is
  written. A class repair rewrites the class whole, so an apply run in pass one
  would be undone by pass two; a No reads and writes nothing.
- **Rebuild** — the shelf, book and rules-table options of
  `rebuildOptions()`, run by `runRebuildPick(value)`: a shelf or a book runs
  the merged repair, the rules tables are re-read in place. The Reimport One Shelf dialog draws
  from the same two functions, so the two surfaces can never offer different
  things.
- **Adventures** — each adventure book open on this seat (`adventureBooks()`,
  each with its `bookCensus`): Repair runs
  `cookbookReimportAdventure` (below), Write Adventure runs the adventures
  step for that book alone.
- **Tools** — the entry picker, the audit, the repair window on the
  importer's checks (every check where it registers none), the merchandise
  build, overhead token art (below) and Remove All Imports.

**The rules tables' phases.** `scripts/importer/tables-phases.mjs` holds what
runs after the page read: the assembly of the store's tables (`assembleReadTables`),
the apply to races, builds, skills and languages with the race-tongue sync
(`applyReadTables`), and the simple table bindings. Each takes the ids of the
documents a read produced and touches only those. `module.mjs` keeps the guards, the page read and its
notices, and calls these. `cookbookImportTables` takes a `phase` of `"read"`,
`"apply"` or `"both"`; the chain's two steps and the repairs' read and finish
use the first two, and every other caller uses `"both"`.

One run at a time: the window names what runs in a status line and disables
its buttons until the run resolves, then re-renders.

## The merged repair

Every rebuild control runs one repair: a shelf (`cookbookReimportShelf`), a
book (`cookbookReimportBook`), the entry picker's ticked entries, an adventure
book (`cookbookReimportAdventure`) and everything
(`cookbookReimportEverything`). Each writes a fresh read over what the world
holds of its scope in place (`refreshImported`), under the id each document
holds, imports what the world lacks, and deletes nothing first. A `mode` an
API caller passes is ignored and named on the console (`ignoredMode`).

**Two passes** (`mergedRepair`, `merged-repair.mjs`, Foundry-free; `runMerged`
in `cookbook/rebuild.mjs` drives it and reports it once). The scope asks its confirm
(`confirmRepair`, titled `ui.repairMergedTitle`, `DialogV2.confirm` with
`rejectClose: false`: No and closing write nothing), then pass one runs under
the decision "keep" (`mergedTally`): every writer writes what the page gives
and holds each Judge's edit it meets in `tally.edits` (`heldEdit`: document,
field, stored and page values, page reference, `unstamped` where the value
predates its read stamp), and `repairPregens` lists each pregenerated
character in `tally.pregens`. Where either list holds anything, the Judge
answers in the choice dialog (`chooseHeldEditsDialog`). A decision that takes
no edit and leaves every character ends the repair there. Otherwise pass two
runs under it on a fresh tally, and only the steps pass one named
(`mergedStep`, `tally.edited`), so a delete-and-reimport or a rules-table
re-read is never run twice. The notice (`reportMerged`) counts what was
written, the edits taken and kept, what was made again as another type
(`recreateUnderId`) and what was left, and the characters restored, rewritten
and left; the edits still standing go to the console.

An API caller may answer in the Judge's place. `decision` (a word, `"keep"` or
`"take"`, or `{take, keep, all}` by edit key, read by `decides`) answers
before anything is held, so one pass runs, which acts on no character.
`choose(edits, {pregens})` answers as the dialog does, characters included.

**The choice dialog** (`apps/held-edits-dialog.mjs`). One frame per document,
a row per edit: the value the document holds beside the page's (a list or a
strength table by its row count, prose without its markup, cut to a cell with
the longer form in the tooltip), the unstamped mark, and a take box keyed by
the edit. Each value's tooltip says where it came from: the document, or the
page reference it was read from. A frame of pregenerated characters follows,
each with its note and a select of `PREGEN_ANSWERS`. Apply takes the ticked
edits; Take all and Keep all take every edit or none, and are offered only
where edits are listed; every button reads the character selects. Closing
answers `"keep"` and leaves every character.

**Pregenerated characters** (`repairPregens`). Pass one never writes a
character the library holds; it lists it. A copy dragged out of the library, a
player's character and a template part are never listed. Pass two acts on each
as answered: `restore` keeps the character under a new id (`keepUnderNewId`:
same pack and folder, its cookbook claim and play stamp taken off, `keptFrom`
recording the claim and uuid it came from, named "(kept)"), removes it, and
imports the book's again under the cookbook id; `rewrite` writes the book over
it in place under the decision (the rewrite scope, below); `leave` does
nothing. The default offered comes from the **play stamp** (`playStamp`,
`held-edits.mjs`): a checksum the character importer records in
`flags.acks-extras.playStamp` after its last write, over the actor's name and
`system` (the biography included) and each embedded item's name, type and
`system`, the items sorted. Ids, `_stats`, ownership, sort, folder, flags and
effects are outside it. A stamp that differs, or none, marks the character
`changed` and offers restore; an equal one offers leave, with the note that it
matches what was imported (`pregenDefault`, `pregenNoteKey`). A rewrite
re-stamps, since the importer runs again over it. A refused copy leaves the
character whole; a re-import that makes nothing, or a rewrite that throws, is
counted in `pregenRefused`, the copy standing. The result carries `pregens`,
`restored`, `rewritten`, `pregenRefused` and `kept`, the copies' uuids.

**Out of scope.** A document of a book the module no longer offers
(`offeredHere`) is passed over: nothing is asked or written for it, and it is
counted in `notOffered`. A claim no loaded cookbook holds names its book by its
id's first segment when `REGISTRY` knows it (`registryBookOf`), so a document
of a withdrawn book reads as not offered with its cookbook unloaded. The
cookbook loader skips each index-listed book file that `REGISTRY` knows and
`BOOKS` lacks (`offeredBookFiles`), so a withdrawn book's file is never
requested. A
document whose book is not open on this seat is left and counted.

**Organisations' relations.** Under the rewrite, a body's relations that no
longer hold the page's are an unstamped edit (`keepsJudgeFigure`), kept unless
taken; the organisations notice counts the bodies that kept theirs.

`repairTally({force: true})` and `policyFor` remain the runs' internal flag for
lifting the hand-written prose guard (`refreshPlan` skips its `prose` and
`proseFlags` loops; `cookbookUpdateAbilities` and `refillMonster` read it too).
No control sets it.

**What the repair does not write**, each kept because the import does not own
it or has nothing to write from:

- a document the import did not make: an unflagged item or actor, a
  name-adopted ability, an embedded effect or attack without `minted`, a
  `templatePart` or a copy dragged out of the library (`isWorldCopy`);
- the `keep` fields of each policy (a trap's level, a vehicle's crew and
  damage, a stack's quantity and equipped state, a spell's cast count): play
  state, or settled by `annotateItem` after creation;
- a field the build does not produce: an array row's unbuilt fields
  (`keepUnrenderedFields`), the spell effect rows a Judge made, edited or
  deleted and the `values` leaves a Judge changed (`mergeByOrigin`,
  `readStamped`; "Spell recipes" below), a class level's experience or title
  the build could not read (`fillUnread`);
- a document with nothing to be written from: its book is not open on this
  seat, its page no longer matches, a monster entry that claims no stats, a
  build of another document type, a write Foundry rejects;
- an item a Judge gave a pregenerated character: a rewrite of the character
  (below) lands what its sheet import grants that it lacks and keeps what it
  holds;
- a document whose row the page no longer yields (a vehicle or merchandise
  row, a creature the page dropped): there is nothing to write from, so it is
  counted as refused or left.

**Every other kind has an in-place write**, under the same guards, in the two
shapes below.

**The rewrite scope.** A monster template or family, an NPC and a legacy block
are built by importers whose build is also what they create.
`withRewrite({held, tally}, run)` (`cookbook/target.mjs`) sets a scope that maps the
cookbook id of each held document to it; while it stands, `createDoc` for a held
id writes the build over the held document (`refreshImported` under
`actorPolicy(build)`), `claimed()` and the importers' "already imported" reads
skip a held id so the build runs, and an art import is skipped for it. One
importer body therefore serves both the first import and the repair, and no
importer has a second copy of its build. `actorPolicy` (refresh.mjs) derives the
policy from the build: the flags the build stamps, its token, its embedded
items as `minted`, and a biography. A held document nothing wrote is counted
as left when the scope ends. `repairActors` is the one entry that classifies
monster-shelf entries (`monsterRepair`: stat-block monsters refill, the rest
rewrite, a pregenerated character is left to `repairPregens`) and runs
the scope, once per document a claim has (`claimerPasses`), so two documents
claiming one id are both written; a row beneath the id that another kind owns
is left and counted, and an entry is built only in a pass that holds its own
claim.

**A pregenerated character** is built by the sheet import, not returned as a
build. `importCharacter` stamps every item the import granted `minted` (an item
present beforehand, or given later, is not stamped), and under the scope its
`createDoc` returns the held character, so the sheet import runs onto it again
and the biography, morale and printed-differences flag are written, a
biography a Judge wrote in held under a decision (`keepsJudgeProse`). The sheet
import answers a line by what the character already carries (an ability by
copies held, gear and spells by name, the class by key and level), so nothing is
granted twice and an item a Judge gave stays. An item the import granted that
the character lost is landed again; one a Judge edited is not replaced.

**Table rows.** Weapons, armour, the priced-gear rows, languages and races are
built from a connected table, not from an entry. `importWeapons`,
`importArmor`, `importPricedGear`, `applyLanguageImport` and
`applyBuilderImport` take `{repair}`: a row this world already holds is written
over under `REPAIR.weapon`, `armor`, `ammunition`, `priced` or `language` and
counted, where an import passes it over. `applyBuilderImport` writes races and
class builds only; its table assembly, `assembleBuilderImport`, writes no
document (the split is under "Import" in the manager, above). `TABLE_REPAIRS` and `TABLE_BOOKS` tie
a shelf and a book to the importers that rebuild its rows, and `isTableRow`
tells a shelf's repair which documents are rows. A row of a table whose book is
not open on this seat is left.

**What a repair deletes.** The entry picker deletes and imports again an entry
no run writes in place (`repairEntries`), and only where `rebuildable` allows
it (`rebuild-guard.mjs`): a loaded owner re-creates the claim (an entry of a
loaded cookbook, or the
recipe of the table a row is read from, `TABLE_BOOKS`), that claim's book is
open on this seat, and the book is in `BOOKS`; an entry refused is left
standing and counted. A character's restore removes it only once its copy
stands, inside a scope whose book is open here.

**The kind declaration.** `IMPORT_KINDS` (`cookbook/rebuild.mjs`) declares every family
of document the importer makes: the entry picker's sources (`ENTRY_SOURCES`),
the table shelves (`TABLE_BOOKS`) and the steps of an adventure book's run
(`runAdventureBookSteps`). A kind states which cookbook claims it owns (`owns`,
counted per claim: at most one kind owns a claim), the book a claim is read from
(`book`) and the run that re-creates it (`make`), with the shelves it files on,
its step of the import chain and the steps an adventure book's run reports it
under. A claim no kind owns is one nothing here can re-create. `runSetFor`
(`import-kinds.mjs`, `cookbookRunSet` over the live table) derives the runs a
scope needs: a shelf, a book, a list of entries or everything. A book scope
names the kinds a book repair names (`viaBook`, the vehicles among them), in
`SHELF_REFILL`'s order, and the book's own rows, on every book that has a
cookbook, as one `runAdventureBookSteps`, so no document is counted by two
runs. No command calls it yet; `test-import-kinds.mjs` holds each
scope's answer to what the shelf, book, adventure and entry rebuilds call.

## An adventure book, repaired

**A book repair reaches a book's own rows.** `cookbookReimportBook` (`repairBook`)
writes the shelf runs, the vehicles (`importVehicles`: an Actor filed beneath its
entry as `<entry>.<row>`, counted by `ancestorsOf` and read from the entry's book
by `bookOfFlag`) and the printed tables a book prints. Where the book has a
cookbook of its own and is no Judge's book (the bestiary, the rules, the Judge's
book), it then runs the book's own steps (`runAdventureBookSteps` with
`items: false`, since the shelf run wrote the items, and `adventure: false`)
under the same tally, so its creatures, templates and families, journal pages and
roll tables are written over in place like an adventure book's, and its confirm
names them (`ui.repairMergedBookOwn`, counted by `adventureForceCensus`). A
Judge's book takes them from `cookbookReimportAdventure` alone, so no row is
written twice. `cookbookRunSet({book})` names the same: the book's own rows are one
`ADVENTURE_BOOK_RUN` on every book with a cookbook.

`cookbookReimportAdventure(bookId)` repairs one Judge's book as a unit, as
`cookbookReimportBook` repairs a book's shelf items, through the merged
repair above. It deletes nothing: the book's steps run under each pass's tally
(`runAdventureBookSteps` with `force`), importing what the world lacks and
writing over, in place, what the world holds of the book's own: its creatures
and people (`repairActors`, through the rewrite scope above; the stat-block
monsters by `refillMonster`), the items it introduces and its roll tables
(`rewriteTable`: formula, description, results), each under the pass's
decision, so a description a Judge wrote in is held. Its pregenerated
characters are put to the Judge (`repairPregens`). Journals are refreshed by
their step, run inside a `withRewrite` that holds no document and carries the
pass's decision: a page whose stored text holds a Judge's prose beyond the
import's own block and creature line, or an edit inside the block, is an edit
(`writeJournalPage`, path `text.content`), listed in the choice dialog and
written only where the decision takes it, on the second pass as the first;
every other page is written whole. Outside a repair (Import Everything, the
entry picker's import) such a page is kept, its sort alone written, and the run
counts it `preserved`. An edit inside the block is found by a digest the
document records in its stamp each time the import writes the block:
`blockDigest` of the stamped block, a checksum over the block's readable text
(`readableText`: tags dropped, entities decoded, whitespace collapsed, an image
kept by its source). A stored block that no longer digests to the stamp was
edited by hand, and the page is held as above. A journal page records one,
`flags.acks-extras.cookbook.sum`. Every other writer of a stamped block records
one per block in `flags.acks-extras.cookbook.sums`, keyed by the field's path
and the block's entry id (`sumKey`, which writes every dot out so an update
path never nests it): `system.description`, `system.details.biography` (the
page's text and its "as printed" block are two blocks of one id, each read), a
monster's prose flags, a roll table's `description`, a place's
`system.notes` (one key per row's block). What the write carries is what is
recorded: `createDoc`/`createDocs` stamp a new document (`withBlockSums`), a
repair stamps from its payload (`refreshPlan`), so a field a decision took is
stamped and a field a guard kept keeps the sum of what the import last wrote;
the abilities pass, `rewriteTable`, a character's biography and `rowBlockPatch`
record theirs the same way. An edit found is kept as hand-written prose is:
`refreshPlan` and the abilities pass count it `keptProse` / `preserved`,
`keepsJudgeProse` and `rewriteTable` list it under a decision, `rowBlockPatch`
holds it, and the held-edits dialog offers it as above. The digest is
taken over text so that what the editor re-serializes without changing a word
(attribute order, a table cell's text wrapped in a paragraph, a reflowed line,
`&nbsp;`) never reads as an edit; a change that leaves the readable text as it
was (bold on a word, a moved paragraph break) is not seen and the field is
refreshed. A field with no digest, written before it was recorded, is read as
unedited. The stamp, not the markup, holds the digest, so nothing the editor
does to the block can strip it. Maps
are refreshed by their own step (`repairHeldMap`, which keeps the Judge's
regions, fog and tokens). The adventures step runs once, after the last pass,
with `force`, which `bookAdventureState` reads as stale whatever the stamp
says, so the Adventure is written anew, a Judge's edit to it included. Not
touched: a copy dragged out of the library (`isWorldCopy`), a character a
player owns (`playersCharacter`), and a document another book owns that merged
one of this book's ids. Where a document is removed and made again (a
character's restore), it stands under the id it had: `deleteImported` records
every removed document's id by type and cookbook id, and
`createDoc`/`createDocs` settle every type's id through `itemIds` (the record,
else `stableDocId`, else core's), so a map's pins and an organisation's seats
resolve again. **Places and
organisations** are written over through the same scope: `bodyRowIds` lists the
book's keyed places, points of interest, region sites that stand as their own
place, and organisations; the places and organisations step each run inside a
`withRewrite` holding those the world has, so their "already held" branches
step aside (`isRewriting`) and the importer's build runs. The scope's `retract`
returns a place's roster, and an organisation's relations and strength, to empty
first, since the import fills them after the create (`keyedOccupantRows`, the
relations pass, the strength grid; `wasRewritten` lets the grid pass write over
a body it just rewrote). An edited parent link or roster is replaced. The
places scope (`forcedPlaceHold`) holds each place under its own claim only, so
a place another book took over is never built over by the row merged into it,
and also holds the creatures made from a held place's stat lines
(`<place>-o<i>`), which `statLineCreature` then builds again. **Shared
places** are written by their rows' text, never rebuilt: `placeBlockRows`
lists the rows that write onto a place they do not build (either side of a
place two books print, a region site bound onto a market or the book's own
settlement, a quarter's or a region's overview), and the scope's `blocks` maps
each to the place, once it answers for the row. Its step reads the row and
`writeRowBlock` replaces that row's stamped block alone (`rowBlockPatch`),
every other byte of the notes kept; the place's own row also writes its read
name while the name is still the printed one. The containers themselves (the
book's own place, a quarter, a region) carry no page text but their
overviews, and are not rebuilt. **A Judge's edit** in this scope and in the
creatures step is held, not written: `rowBlockPatch` compares a block with
the digest its last write recorded (`cookbook.sums`, above) and a
name with `printed`; a block that digests as the page's reads as unedited
whatever markup the editor gave it. A block with no digest yet reads as
unedited, is written and stamped. A missing block is held where a stamp was
recorded, or where the notes hold anything but the place's
erratum notes (the Judge's text, another row's block), which keeps a repair
to the one row an import writes onto such a place. A whole-build write
(`decidedPolicy`) treats prose the unforced plan would keep as hand-written as
the edit, a place's notes included, and a pregenerated character's biography,
written after its create under a rewrite, asks the same decision
(`keepsJudgeProse`). Each is returned in the result's `edits` and written only
where the decision takes it. **Market profiles** are written under the
decision (`marketTakes`): a class, a family count or a base demand the place
holds differently from the page is an unstamped edit, held unless taken. The
confirm (`ui.repairMergedAdventureConfirm`) counts the documents by kind
(`adventureForceCensus`, places and organisations apart, a place one of the
book's rows writes text onto (`placeBlockRows`) counted among the places
whichever book holds it), says the market profiles are written onto the
places, names what is left, and closes on what is kept; No writes nothing.

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
`mergedRepair`'s, with the first pass's `book`, `steps` and `errors`.

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
form (`adventureRefs`), and so are a list result's document, a journal page's
links and an item's description links (the text slots read `@UUID[…]` and
`data-uuid`); a link to a page follows its entry. The maps' links are laid one
map after another (`linkFields`), and an organisation keeps the regions it
controls on the other maps. A recipe the world holds as more than one import
is joined once per import (`heldMapsOf`), so a twin's ends lead to its own
Regions.

The stamp counts what it carries (`contents`), and records `sourcesHash`
(`sourcesHashOf`, the source without any `_stats`) and `writtenAt`, the stored
document's modified time read back after the write. Each run decides by
`bookAdventureState`: a shelf without it writes it; a modified time more than
`WRITE_SLACK_MS` past `writtenAt` is a Judge's edit and is kept; a changed
hash rebuilds it; anything else is held. A run that fails writes nothing. The
Books tab reads each open Judge's book's census off the shelf's index
(`bookCensus`).

Core's `Adventure#import` is steered, not replaced. For an Adventure whose
`flags.acks-extras.cookbook.kind` is one of `ADVENTURE_KINDS` (a book's), a
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

A gridless recipe may declare its `cell`, `{distance, units}` (`units` a
`DISTANCE_UNITS` key), for a plate drawn at a scale the foot-to-the-pixel
picture would overrun. `cellScale` is the picture's scale, `GRID_PIXELS` times
`feetPerPoint` over the cell's feet, and `sceneFrame` takes it whenever no
scale is handed in, so every caller agrees; `sceneData` writes
`{type: 0, size: 100, distance, units}` and the battlemap flag's `distance`, and
`pictureKey` includes the cell only when there is one. `recipeProblems` refuses
a cell beside a `grid`, a non-positive distance and a unit outside the table.

Several scenes of one place are told apart by `part: n` (a whole number from 1;
`recipeProblems` requires a `place`). The part is named for the place by
`ui.scenePart` and keeps the place's scene link, so a party standing on it is at
the place. It carries `SCENE_PART_FLAG` (location's, `flags.acks-extras
.scenePart`), and location's own mirror code skips such a scene, so the place
still opens its full map: `mirrorCreatedLinks`, `linkScene`, `unlinkScene`, the
`updateScene` sync, the place sheet's Scene drop and the Adventure's `linkFields` neither write nor clear the
place's `sceneUuid` for it. The register lint holds a place that has parts to
exactly one scene without `part` (`scenePartProblems`).

A settlement map hands its quarters' Regions to the organisations that
control them (`claimControlledQuarters`, in `cookbook/adventure-places.mjs`).
The organisations step makes the same claim from every settlement map of the
book the world already holds (`claimHeldMaps`), so the two steps end in the
same claims in either order, and a repeat writes nothing.

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
  bar. A box under `BOX_AREA` of a cell, down to `LEAF_AREA`, is read only
  as one half of such a pair, so a leaf drawn as a sliver of paper is a door
  beside its other leaf and nothing alone. The digest counts both kinds (`boxes`), the stroke paths kept
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
- **A circled label is masked before the throats are read** (`labelRings`,
  `grid`), so a label in a one-cell room is no door. A ring whose band just
  inside it holds more than `RING_CLEAR` of ink is no label (a door's box,
  hatching, a flight of steps) and is left as drawn.
- **A door or secret asserted on a rock cell in `contour`** cuts the outline
  over the cell's width on both its mouths, and the cell's flanks stand as
  walls where rock lies beyond them. The outline elsewhere stays as traced.
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
GM only, locked, core's own `grid` shape over the snapped cells (else the
outline carried through the frame), the `acks-extras.encounterZone` behaviour
with the list, target, interval, dungeon level, cadence and throws, and a flag
naming the zone. The cells are the Region's, so a Judge unlocks it and adds or
removes one with the Regions layer's grid tool, and formation reads the zone
through core's `testPoint` and polygon tree like any drawn Region. An adventure's dungeon level is one zone over the
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
moved to the picture's corner (`dimensions.sceneX/Y`). On a hex or square map
the cells are the live grid's (`getOffsetRange` over the picture,
`getCenterPoint` per offset), snapped by `offsetsInside` (a zone over the whole
picture takes every cell on it) and laid as one grid shape of their offsets,
and a zone holding no cell is refused; on a gridless map the outline is the
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

The points-of-interest step takes a region's rows too (`importRegionRow`). A
book's region place is made once, on the first need among its rows: its
overview's notes, a site made under it, or a bound or paired place that holds
no parent (a takeover always counts). A book that carries a region's map
recipe always makes it, since the map stands on it (`carriesRegionMap`); a book
whose every site joins a place that already has its parent, and that prints no
overview or region map, makes none. The overview is its notes, written only
while they are empty. A site lands where `regionSiteClaim` says: a row
naming a market (`meta.market: "mkt<n>"`) on that market's place
(`<book>.mkt<n>`, the id the market-profile step claims, made here with
`marketActorData` when it is not there yet), or on the book's settlement when
that market's record says `place: "adventure"`; a row with
`meta.place: "adventure"` on the settlement (`adventurePlaceId`); any other site
on a place of its own under the region. A bound site writes its notes, its
parent (the region) and its role onto the place it lands on, each only where
that place holds none (`siteBindPatch`), and never makes a second place. The
market's name is the market step's (docs/markets/MODEL.md). The
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
claimed by its cookbook id like every item. One the world holds is passed as
already present, and written over in place where the run carries a repair
tally (`REPAIR.adventureItem`: slot, mark and cost rewritten, a Judge's
description and the quantity kept); the entry picker lists the items under
"A book's items", and a book repair takes them with the book's shelves
(a source that names no `shelves`, since the items stand in the book's folder
and on no cookbook shelf). Beside the prose, three things
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

## An ability's modifiers: recipe or scan

An entry's register `effects` recipe replaces the vocabulary scan for that
entry whole, so it carries every row the entry should have (modifiers, throws,
limitations), each with locators for its figures. A recipe ships the row's
structure — target, `forWhat`, `condition: "situational"`, a `gate`'s kind —
and locators read everything printed: the value, a ladder's rungs, a per-level
rate (`perGroup`, signed by `perSign`), and a gate's load
(`{into: "gate.loadMax"}`, one level of nesting) and armour rung
(`{into: "gate.armourMax"}`: the capture is the clause naming what may be
worn, and `ceilingOf` in `equipment/armour-limits.mjs`, the word table the
thief-skill limit binding also uses, maps its heaviest ladder word to the
rung key; a clause naming none reads no rung). A locator that misses drops
its whole row. A world imported before the rung was read keeps the literal its
stamped rows carry until Update Abilities (top of the Items sidebar, which
rewrites an ability's mechanics from the seat's own book) or a re-import
rewrites them; nothing migrates it (DECISIONS, 2026-11-11, "The armour rung on
an ability's gate is imported"). `bindAbility` stamps `extras.effectsFrom` — `"recipe"` or
`"scan"` (`effects-origin.mjs` `effectsOriginOf`) — which the sheet reads to
mark a scan's applied rows unverified (`docs/abilities/MODEL.md`). The scan
splits a phrase naming two fields at its conjunctions ("surprise and
initiative" is two rows), one target per conjunct.

**Conditions.** A recipe row's `condition` is one of the neutral labels in
`condition-labels.mjs` (what kind of condition: "while leading", "by method"),
or a scope's own word or two; the compiler appends the entry's page reference
to a label (`citeLabel`), and `lint-register.mjs` refuses any longer string.
Beside it, a `conditionFrom` locator (`{pattern, group | groups, flags}`) reads
the clause off the seat's page at import (`executor.mjs` `locateCondition`):
the captures, joined by ", ", trimmed to a clause, at most 200 characters. It
replaces the label; a miss leaves the label and keeps the row, unlike a
figure's locator, because the row's mechanics are complete without the words.
Effects specs and roll specs both take one.

The same holds for a limitation's `restriction` and an outcome's
`consequence`: each ships one of its own field's labels ("a retry limit",
"a mishap"), cited by the compiler, or a word or two, and a `restrictionFrom`
or `consequenceFrom` locator reads the page's clause over it
(`executor.mjs` `CLAUSE_FIELDS`). A `noteFrom` locator reads the clause a
capability or companion row shows as its face over the shipped `note`; with
no note shipped, a miss leaves the row reading "see description". A row's
`note` is otherwise the module's own remark on the row (which field holds
what, what the module does not track); the lint refuses a figure in it
outside a page reference, and a TODO (`noteProblem`). Both prose fields also
refuse an amount followed by a unit of game time ("three rounds", "a turn",
"10-minute"), at any length (`TIME_PHRASE`). Whether a remark
paraphrases the rule is left to review: no pattern tells the two apart.

**A heading beside its stat run.** A sub-heading entry whose book sets the title
on the line that carries the stat run's first label states that label in
`assists.statBeside` (`"Range:"`). Its headings are then the lines with exactly
one run left of the label (`besideHeads`), not the solo lines; the sibling
stop, the column flow and the page turn use the same test, since a title also
recurs in the section's intro prose and only the labelled line is the entry's.
The `stat` value op reads two boxes, `boxes: [tagBox, statBox]`: the level
tag set left of the duration label first, then the stat run's line and the
duration's, so the stat parser finds the tag first. `calloutRuns` leaves an
inset callout (an `EXAMPLE:` block set in from the column edge) out of the
paragraphs, which split around it. A turn onto the next page continues through
every column of that page, up to the next heading, for such a row; the first
paragraph of each carried chunk is marked `continues` when the text before it
ends on no stop, so the executor joins it whatever its first word is.

**A class's printed spell lists.** A casting row's `spellList` is never authored:
`bindClass` rebuilds it from what the book prints for the class, as `[{tradition,
level, names}]`, and resolves each name through the spell-title index into the
entry ids of the register's spells (a name no title answers is warned and left
out). Two `kind.classMeta` rows feed it. `def.classmeta.spellRepertoires`
(`repertoires`) reads the per-class repertoire grids. `def.classmeta.invocationLists`
(`invocations`) declares `[{class, heading}]` for the pages that print one
section per class with the invocation titles under it: the compiler orders the
section headings (matched by folded equality, not by prefix) and the title
lines (`besideHeads`) by page, column and height, carries the current section
over a page that opens with none of its own, and ships boxes only, keyed
`<class>.title<n>` and `<class>.tag<n>`. `classInvocationsFor` groups the
executed titles by the tradition word and level their tag prints, and the call
sites concatenate it with `classRepertoireFor`. A spell entry located by a hash
answers to the `printKey` of its printed title (`keyedTitleIndex`), so a list
can name an entry whose title the register does not hold.

**Spell recipes.** A spell register row (`kind.spell`) may carry the same
`effects` and `values` recipes, and `bindSpell` reads them only when the
entry has them: `executeEntry` runs `effectScan` over every spell's prose,
and its guesses never reach a spell. `effects` specs become the spell's effect
rows (`flags["acks-extras"].spell.effects`), each stamped `origin:
"register"`. `values` specs are fragments of the spell's SpellExtras
(`save`, `target`), each `{save?, target?, from, onMiss?}`: the structure it
states (`target.model`, `target.area.shape`, `target.area.measure`,
`target.area.unit`, `save.effect`, `save.kind`,
`save.perTarget`) and the fields its locators fill are deep-merged, in order,
over what the stat block gave (objects merge, any other value replaces).
`LOCATABLE_FIELDS` lists every `into`: besides the figure shapes, `roll`
(a dice expression, spaces removed, held to a dice formula), `damage` (a word
mapped to a `DAMAGE_TYPES` key by key or label, kept as a one-member set;
`varies` never maps), `extraordinary` (true where the pattern matches),
`save.category` (a word onto a `SAVE_CATEGORIES` key) and `target.filters`
(the words that name a `TARGET_FILTERS` key). An area's `target.area.size` and
`target.area.width` are located level values. A word no member answers to is a
miss. The damage mark's colour is not in the text layer (`glyphWords` writes
its word), so the extraordinary mark of a printed damage cannot be read from
text.

Four more row fields are located. `rounds` (a row's dice formula, read like
`roll`, for a `lasts: "rounds"` row) and `exemptSizeFrom` (`sizeKey`: a size
word onto a monsters `SIZES` key, by key or label, so a word no size answers to
is a miss) are in `LOCATABLE_FIELDS`; a row that locates `rounds` states `lasts:
"rounds"` and the other way round, and the lint holds it to that. A count the
page grows by increments is read by a `value` locator with `on: "level"` and
`accumulate`: with `pairs` the groups alternate rung and increment, a leading odd
group being the count at level one; without it the first group is the count at
level one, the last the one increment every later rung adds, and the groups
between are the later rungs (`ladderFrom`). Each rung's value is the running
total, rungs that do not climb read as a miss, and a group that reads no number
misses the whole ladder. A locator whose page counts with "a" or "an" sets
`articles: true`, which reads an article as one in a value group of that locator
only (never in a rung, never in another locator, never in `WORD_NUMERALS`). A
literal count in a locator (`per`, `steps`, `flat`, `base`, `count`,
`increment`, `rungs`) fails the lint, and `accumulate` and `articles` take only
`true`. The structure a row states beside them is `pickOption` (the option of
its `pick` group it belongs to), `recurAt` (`EFFECT_RECUR_MOMENTS`), `recurSave`
(`EFFECT_RECUR_SAVES`) and `recurTarget` (`EFFECT_RECUR_TARGETS`), each needing a
`recur` of `eachRound` or `laterRounds`; `lasts` takes `nextTurn` and `rounds`.

A spec with `"onMiss": "blank"` keeps its row when a locator misses: the field
is left unset, its path is listed in the row's `unread`, and the later
locators still read. Without `onMiss` a miss drops the row, as above. A
fragment's `unread` stays out of the primitive. A spell recipe ships structure
and locators only: `lint-register.mjs` (`spell-recipe-rules.mjs`) refuses a
number outside a locator, a located field written as a literal, a locator that
carries a figure of its own (`per`, `steps`), an unknown row kind, subject,
delivery, condition key or gate kind (`SPELL_GATE_KINDS`; the evaluators are lib's),
and an `onMiss` other than `"blank"`. A row's scope is structure:
`vsKinds`, `vsAlignment`, `vsAlignmentOf`, `vsAlignmentMode`, `vsEnemy` and an
`anyOf` list, whose branches hold those keys, declare at least one clause and
never take a `sign` mode. An area states its `measure` (`AREA_MEASURES`: the
word the page prints the size in) and `unit`, and the lint holds the size to
it: a located `target.area.size` needs a `measure`, its pattern names the
measure's word so the locator proves the page prints that measure, a `length`
needs a located `target.area.width`, and a width belongs to a `length`.
Every `effects` spec carries a `key` the lint requires (`/^[a-z][A-Za-z0-9]*$/`,
a module word naming the row's role, unique within the entry, a reversed twin's
distinct), and the written row keeps it. A row a Judge adds is keyed `_` plus a
random id, which no spec's key can equal.

*The repair of a spell's rows* (`REPAIR.spell`; `mergeRowsByOrigin`, which
takes the stored rows, the build's, the spell's `retired` keys, the keys a
decision takes and `force`). A stored row is one of four things. A **stamped**
row (`origin: "register"`) gives way to the build's row of its key in its own
place; one with no key, or a key the build no longer has, is dropped. A
**stand-in** (no `origin`, a key the build has: a register row a Judge edited,
since the row editor clears `origin`) stays and the build's row is not added;
where it no longer covers the build's row (`coversFigure`, with `origin`,
`unread` and `key` left out) the repair holds it as an edit, and a decision
that takes it puts the build's row in its place. **Any other** row (a Judge's
own `_` row, a keyless one) stays untouched. A **retired** key
(`SpellExtras.retired`, which the row editor's delete adds a register key to)
is skipped, held as an edit, and written back with its key cleared when a
decision takes it. Build rows no stored row answers for go in at the first
stamped row's place, or first. `force` makes the page win everywhere but on a
`_` row.

*The leaves `values` wrote.* `bindSpell` records every leaf the `values`
fragments wrote (a dotted path, `.` written `%2E` so the key never nests; an
array is one leaf) in `cookbook.read.spell`. A repair compares each stored leaf
with the stamp and the page: equal to the page or to the stamp, it takes the
page and stamps it; differing from both, it is held as an edit, left as it
stands with the stamp unchanged; no stamp (a spell imported before it existed),
it takes the page. A decision that takes the edit writes it. `refreshPlan`
returns the held rows and leaves (`keptRows`, `keptLeaves`) and `decidedPolicy`
lists each as an edit for the merged repair's choice dialog: a row reads as its
one-line description (`describeSpellEffect`) on both sides, a retired row has
no current side, a leaf shows the figures. Stat-block fields outside `values`
(range, duration) carry no stamp and are overwritten
([DECISIONS.md](DECISIONS.md), 2026-11-16, "A repair holds a spell's edited
and deleted rows, and its edited `values`").

**A borrowed throw.** A roll spec whose `target` has a locator proving the page
prints the borrowing and a `progression` object (`{as, table, fraction?,
round?}`) materializes a `progression` target: `{kind: "progression", as,
table}` plus, when the page prints a fraction of the level, `atLevelNum` /
`atLevelDen` (`levelFraction`, `lib/vocab.mjs`), and `round` when it prints a
rounding direction. The class key `as` and the ladder `table` ship as
structure; the fraction and rounding are read from the seat's page through the
`fraction` and `round` locators, and a fraction the page does not yield drops
the roll. `materializeRolls` writes `scale: "level"`. The ladder itself is the
class registry's (`ladderRungAt`), or the imported skill's own
(`abilities/skill-ladders.mjs`) where no class publishes one.

**A borrowed skill in the effect scan.** `effectScan` reads a sentence that takes
a skill "as a <class> of <fraction> his level" (RR pp. 108, 115; JJ p. 308) into
a `progressionAs` row: the class key, and the words between "of" and the pronoun
read through the same word table and `levelFraction` into `atLevelNum` /
`atLevelDen`. A whole level stores no fraction; words the table does not read
drop the row. The row never carries the `atLevel` shorthand. The scan runs at
import, so no compiled cookbook holds one.

**An effects frame.** `assists.effectsFrames` names boxes on the anchor's page
whose text the effects locators read beside the description: a bonus table
printed under the entry, outside its prose. The compiler emits them as an
`effectsText` text field; `executeEntry` reads them with the description and
drops the field from the result, so the frame never becomes description.

## A class stated in sentences

A `kind.class` row whose spread prints no text table for its levels carries,
beside its `chassis`, patterns the binder reads the reader's own body text
with (`bindClass`; the compiler passes `proseLevels` and `damageBonus`
through, and reads each page's body from the book's declared body top):

- `proseLevels.hitDice` captures the die, the level the dice stop at and the
  flat hit points per level past it; `proseHitDiceLevels` writes one level
  row per level to the class's maximum, each with its hit dice, its
  experience `null` and its title empty.
- `damageBonus` names the ladder's key, whose prefix says who the bonus
  applies to (`melee…`, `missile…`, or none for both; `apply.mjs`
  `damageBonusLadder`), and captures the first bonus, its level, the step and
  the levels it is added at; `proseDamageLadder` builds the rungs.
- `cleaves.pattern` is the core rows' own, its phrase widened to a bare "per
  level".
- The proficiency gains come from `proseGainSchedule`, which reads a "starts
  with … one general proficiency, and one class proficiency" sentence and a
  gain stated as "a" or "an additional" one.

Attack throws and saves stay the chassis's, lent at read time
(`classes/registry.mjs` `effectiveSaves`/`effectiveAttack`) from the
chassis class the world imported from the Judge's own core book; a class
row never copies them. A printed grid, where one is read, wins over the
sentence.

A row may also declare `build`, the class's allocation under the JJ
class-creation procedure, with `build.race` naming the race's pages and the
pattern that reads its racial value's cost there. `buildXp` prices every
level whose experience is unread against the world's `acks.classBuilder`
tables (`baseXpCost`, then `xpSchedule` with the tables' smoothing and the
saves chassis's post-8 step) and records what priced it in
`flags.acks-extras.xpBuild`, which the sheet's experience cells name. No
tables, no readable cost, or an unpriced category leaves every level unread.

The class sheet says, above its tabs, which levels have no experience figure
and which page to copy it from, or, where every level lacks a title, that the
titles are the Judge's to type. A repair (`REPAIR.class`,
`fillUnread`) keeps a level's experience and title where the build read
none and a Judge typed one, and replaces it where the build reads one. The
rulings are DECISIONS 2026-10-30, "A class stated in sentences" and "A
community class's experience is priced from its build".

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
neither. A sidebar with no head of its own (AX1's notice board, p.15) anchors
by hash on its first aside-size line, as a run-in (`as: "runin"` with
`assists.aside`). `axAsideLines` offers the aside-size lines inside the box as
its anchor candidates, and the flow starts on the anchor line.

A place's or a person's text that turns a page or column mid-sentence is
joined only where its row asks (`assists.joinTurns`, read by `compileLocation`
and by `compileNpc`). In that case the
opening box of a later segment is marked `continues` when it has no section,
opens upper-case, and follows a box that closed without terminal punctuation.
The executor joins the two.

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
- **Its spellbook and its awards.** A book in the equipment written
  `<book> (with …)` or `<book> with …` (`liftBookSpells`: the head names a
  spell or prayer book, the contents open with "with", and a figure after
  "with" is a load) fills the repertoire: each spell goes through the names
  below, is skipped when the repertoire already placed it, and takes the next
  free row of the level the library gives it, or is reported as missing; the
  piece stays whole in the gear. After the line's own grants, the sheet import
  (`fixedAwards`, passed only from here) hands over the class's Adventuring and
  fixed awards through the printed level (`grantFixedAwards`,
  docs/classes/MODEL.md), so a power the line names is held once; a choice
  award is left open.
- **Its names.** Every class, proficiency and spell name passes through
  `libraryNameFor` first: a class or spell the library answers keeps its
  name, else the conversion table's rename of that category
  (`registers.tables.conversion`); a spell renamed to two alternatives takes
  the one the library answers, and keeps the rename when none or both do. A class neither answers is then read
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
- **A write-up set run-in.** A book that sets its write-ups side by side
  under a run-in name opts in per row: a run-in anchor ends the write-up at a
  sibling's name line (`pregenStops`), `writeup.classBracket: "drop"` drops
  the class line's bracket and keeps what follows it, and
  `writeup.ordinals: true` keeps a superscript ordinal suffix. Its head reads
  `<n>th level <class>` over a labelled `Stat Line:`, which `parseWriteup`
  reads clause by clause at bracket depth 0 (armour class without its
  bracket, hit points, the attack's routine and first throw, damage, morale,
  alignment), with `Attributes` the scores, `Spellcasting` the spells and
  `Spell Repertoire` the repertoire; a label with no field keeps its text in
  `extra`. Members carry `meta.group` `Party <n>`, which files them in that
  folder (`actorGroupOf`), and each group has a `kind.prose` row titled the
  same (lint, `partyProblems`).
- **A pregen's portrait.** A row whose page prints one names it
  (`assists.artName`, with `artPage` where the picture stands on another
  page), and `compilePregen` ships it as an `art` op with its placement box,
  which `adventureActorArt` crops and uploads as the character's image. A row
  whose page prints none names nothing and keeps the default image.
- **What the page printed.** The biography holds the entry's prose
  (`entryText`), then the "as printed" block (`asPrintedBlock`): the stat line
  as printed, a line per check, a line per name the library could not answer,
  and the sheet import's notes rows. The block is stamped `data-acks-entry`
  like book text, so `stripBookText` takes it with the rest of the import's
  writing. `flags["acks-extras"].printed` counts `{differences, missing}`.
- **Who owns it.** The Judges alone (`ownership.default` NONE), and the import
  posts no chat card. The import opens no dialog: a class with an elected
  damage bonus is applied with the election left open, to be made on the
  character's Class tab (classes MODEL, "An import does not ask").
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

## The expedition figures

The `travel` document's `expedition` table is assembled by `travel-binding.mjs`
(`assembleExpedition`) from two reads of the Expedition Speed page (RR 272):
`expeditionRows` (a `gridRows` of its twelve unlabelled rows, claimed by
position, the feet and miles cells kept raw) and `expeditionProse` (a
`proseValues` that takes each travel day's hours from a window after an anchor
and the wilderness scale from a `take: "times"` count). No printed number is in
the recipe: every anchor is a phrase, and the rows are found by position.

- `feetPerMilePerDay` is the ratio every row holds between its two columns
  (`feetPerMilePerDay(rows)`). It needs at least two rows that read, and a
  grid that disagrees with itself yields nothing, never an average.
- `dedicatedHours`, `forcedHours` and `ancillaryHours` come from `parseHours`,
  the first count before "hours" in the window, written as a digit or a word.
  A window that drifted drops its own figure and no other. A pace multiplier is
  never stored: the lib derives it from the hours.
- `wildernessFactor` is the printed multiple, kept only when positive.
- Page, placement and drift are the usual ones: `PRODUCES.travel.expedition`
  names both raw reads, so the registry's `citeOf` answers the page; with the
  book not imported the table is absent and every consumer says "not imported"
  (`docs/lib/MODEL.md`, "Expedition figures").

## The treasure tables

The `treasure` registry document reads the Judges Journal's treasure tables
(JJ ch. 4, folios 125 to 129) from the Judge's own copy at import: the two
treasure-type grids, the gem and jewelry value lists, and the eleven
special-treasure lists. Every band edge, dice string, name and figure is read;
the recipes (`table-recipes-treasure.mjs`) carry geometry and anchors only.

**Raw reads.** `typeClassicRaw` and `typeHeroicRaw` are `gridRows` keyed by the
type letters A to R, the one structural list the file holds. A row is two to
five lines tall with its letter centred on it, and rows differ in height, so
`wrapRows.centered` splits the lines between two letters so that the upper
row's lines centre on its letter; nearest-letter joining gives a tall row's
first lines to the short row above it. The first cell stacks the category over
the average value; the other cells are the page's text, a chance and its
dice. `gemValueRaw` and `jewelryValueRaw` are band, value, type; the three rows
over the bands that name the dice each kind is rolled on are not bands and are
not read. Each special-treasure list is a `<kind>Raw` table of `b<n>` rows
(`min`, `max`, `text`) read by the `rollBand` label pattern, and copper, gold
and gem lists run across two print columns or two pages, so each is two raw
tables (`...MoreRaw`) the binding joins. A page is found by a caption's words,
never a figure: the special lists' captions differ only after a figure, so one
common phrase locates the page and a region of it is bounded by print column
and y.

**Assembly.** `treasure-binding.mjs` writes `typeClassic` and `typeHeroic`
(`{<letter>: {category, avgValue, cp, sp, ep, gp, pp, gems, jewelry, magic}}`,
cells the page's text), `gemValue` and `jewelryValue` (`{bands: [{min, max,
value, type}]}`) and `special` (`{<kind>: [{min, max, result}]}`) beside the raw
tables. A band list that does not tile from 1 with no gap or overlap is not
assembled, so a lost row never reads as a smaller die; the raw table stays.
`check-treasure-tables.mjs` reads the real page and fails on a missing letter,
a cell that is not shaped as the page sets it, an untiled list, or a list that
ends on no die's face; it skips without the local Journal.

**Projection.** The value lists project as one RollTable each, a result reading
"value — type" (`fields` in the `COLUMN_GRIDS` row of
`location/table-docs.mjs`), rolled on `1d<top band>`. The page rolls each kind
of stone or piece on dice of its own over the one list, which one formula
cannot express, so the RollTable's description carries the legend the page
prints (`legend` in the row; the Judge's own imported text) and the doc keeps
it as `gemDice` and `jewelryDice` (`{legend: [{dice, avg, kind}]}`), read by
`gemDiceRaw` and `jewelryDiceRaw`, for a generator. The special lists are one
RollTable each on a die of its own length (`ownDie`). The type grids are
lookups by letter and project as JSON pages.

**Units beside the shapes above.** `typeUnits` (`{classic|heroic|gritty: {cp,
sp, ep, gp, pp}}`) is the unit line printed under the grids' coin columns, as
printed; `specialPer` (`{<kind>: text}`) is what follows "per" in each special
list's caption. Both are read (`typeClassicUnitsRaw`, `typeHeroicUnitsRaw`,
`typeGrittyUnitsRaw`, a `caption` row on each list's first segment), never a
constant, and sit beside `typeClassic`, `typeHeroic`, `typeGritty` and `special`
without reshaping them.

**The Treasure Tome layer.** The unit of layering is the whole table. A raw
recipe of a table both books print in the same shape carries `over`, a complete
recipe for the Treasure Tome's own page (`book: "tt"`, its folio, its anchor
phrase and its geometry); `readPlainTable` (`tables-binding.mjs`) reads `over`
into the same raw key where the Tome is open and the page locates, and the
recipe's own Journal page otherwise, and the table's citation names the book it
was read from. `recipeLocates` lists both pages (`id: "over"`) and
`tableRecipeBooks` both books, so `test-recipe-pages` checks each page where
each book is local. Two guards keep a Judge's table from being downgraded: a
table already stored under the Tome's citation is left as it is where the Tome
is not open (and where its page does not locate), and the Tome is then reported
as an optional book that is not open. Applied to the type grids, their unit
lines, the gem and jewelry value lists and their legends (Tome folios 19, 20
and 22), the eleven special lists (folios 24 and 25) and the Creature Type list
and the eight arms grids (folios 51 to 53). A list the Tome prints whole in one
column where the Journal sets it in two segments (copper, gold, gem) has the
Journal's tail segment overlaid by `over: {empty: true}`, which stores an empty
table under the Tome's citation; the head segment's whole-list read and the
Journal's tail would otherwise overlap and `assembleBands` would refuse the
list. `typeGrittyRaw` and `typeGrittyUnitsRaw` are the Tome's own: book `tt`,
`optional`, no overlay, assembled to `typeGritty` and `typeUnits.gritty` in the
shape of Classic and Heroic. The Tome sets a type's average value in brackets
and a small-capital category in lower case; the binding reads both as the
Journal's form. Not layered: the classic category lists and the heroic rarity
lists (the Tome prints them in another shape), and the market tables.

## The magic-item and arms tables

The `magicItemTables` registry document (not markets' `magicItems`) reads the
Judges Journal's item-generation tables (JJ ch. 4, folios 132 to 141) and its
arms-and-armour tables (folios 146 to 148 and 164 to 165) from the Judge's own
copy. `table-recipes-magic-items.mjs` carries geometry and anchors only.

**Raw reads.** Every band list is a `list(...)` of `gridRows`: a label that
parses to a band by `rollBandNested`, windowed cells (`item`, and `cues` on
potions), and optionally a first `caption` row read as `label`
(`labelText`). Small-capital initials arrive as a lone lower-case run set flush
against the next, which `smallCaps` raises; `labelGap` reads the label
gap-aware, so an outer face and its inner band stay two numbers;
`wrapRows.floorKey` keeps a header above the first row from joining it. A list
the page sets across two columns or pages is two raw tables (`...MoreRaw`).
The scroll sub-tables are Languages, the six side-by-side spell-level lists
(each headed by its own remaining-levels figure, read as the caption row's
`level`), Treasure Map Contents, Clue Specifics, Clue Concealment and Clue
Code. The arms grids are `settingGrid`s: two header lines name seven settings, a
row is a type name and seven band cells placed by run centre, and the creature
types are two halves.

**Tails.** Five lists end in a tail of the d100 printed as inner bands under an
outer face (a face of 98, 99 or 100). The face stands beside the middle inner
band, alone on a row between them, or repeated beside every one, so
`assembleNested` classifies rows by order: main bands tile from 1, then each
group of inner bands that restarts at 1 hangs from the next face, and a printed
face that is not the face the order gives refuses the table.

**Assembly.** `magic-item-binding.mjs` writes, beside the raw tables:
`classicType`, `classic`, `heroic`, `scrollLanguages`, `scrollSpellLevels`,
`treasureMaps`, `creatureType` (each `{<column>: [band]}`, a band `{min, max,
item, ...cells}`, a tail band `{min, max, sub: [inner bands]}`),
`armsArmor`, `armsAmmo`, `armsAxe`, `armsBludgeon`, `armsBow`, `armsSpear`,
`armsSword`, `armsOther` (`{s1..s7: [{min, max, type}]}`, one column per
setting), `armsSettings` (`{s1..s7: name}`) and `captions` (`{<table>.<column>:
caption as printed}`, a spell-level list named by its header figure) and
`listCites` (`{<table>.<column>: cite}`: the pages of the raw segments each list
is joined from, `joinCites` of their cites, so a list the Tome's version replaced
cites the Tome; the document's `cites` name only a whole table's pages, and the
magic-items roll's tooltip reads this one). Each
Random Type row carries `hop`: the id `<table>.<column>` of the one list whose
folded caption (`printKey`) is the folded words of the row, else null.
`check-magic-item-tables.mjs` reads the real pages and fails on a refused or
untiled list, a list ending on no die's face, a cell that is empty, opens on a
lower-case letter, or ends on a stranded letter, a list with no caption, a hop
that does not resolve to one list, and an arms grid that does not read seven
tiling columns with the same setting names as the others; it skips without the
local Journal.

**Projection.** Each list is a RollTable on a die of its own (`ownDie`) from
`COLUMN_GRIDS`: a result reads its fields joined by " — "; a tail band is one
result on its face reading "a-b: fields · a-b: fields", and a drop splits it
back. A row's `hop` is kept across a drop where the same range stood. The arms
grids are one RollTable per setting column. The captions and settings are
plain JSON pages.

## The weapon lists

The weapons grid prints each row's figures and the sub-header it sits under,
and states nothing of which proficiency category, Weapon Focus or damage type
a weapon belongs to, or which weapons need both hands. The book states those
as lists of kinds in prose, so the importer reads them as **noun lists** and a
resolver places each grid row against them (`lib/weapons.mjs`); nothing is
resolved at import time and no noun, die or type ships.

- **Two documents.** The `weaponProse` raw document holds one `proseValues`
  recipe per folio, each a `take: "window"` read: the Martial Training options
  (RR ch. 3), the narrow-selection options and the whole selection-level
  passage (JJ ch. 12, `selectionProse`), the Weapon Focus
  sentence (RR ch. 3), each physical damage type's entry and the thrown flask
  and torch entries (RR ch. 6), and the weapon descriptions (RR ch. 4, two
  folios: the first opens on the section heading, the second runs from the
  top of its page so every entry keeps its head). `weapon-binding.mjs`, a
  `SIMPLE_BINDINGS` entry gated on the raw document, assembles the
  `weaponLists` document from them (`PRODUCES` names each list's raw tables)
  and registers it beside the raw one, each list citing the folios it was read
  from.
- **What a list holds.** `category`, `focus` and `damageType` are
  `{ key: nouns }`; `throwables` is `{ oil | holyWater | torch: { damage,
  types } }`; `twoHands` is a noun list. A noun is placed on a module
  category token only by the words of that token's own name; an option naming
  no token is the catch-all category. A damage-type icon is a private-use
  glyph in the text layer, decoded by `damageTypeOf`. The "extraordinary" mark
  on a flask is an icon colour the text layer does not carry, so the flag is
  absent unless the printing spells the word.
- **The printed option lists, whole.** `options` keeps the JJ ch. 12
  restricted, narrow and broad lists and the Martial Training options as the
  book numbers them. It sits beside `category` permanently, as the provenance
  of what each category holds. `parseSelection` splits the passage at each
  level's head (a word boundary keeps `restricted:` out of `unrestricted:`) and
  cuts each level at its example paragraph, whose markers are not options. A
  level is kept only where it prints a pick count out of a total and the total
  equals the options parsed. A list whose markers have a gap, or that holds an
  option no shape reads, is dropped. Each option keeps its marker and one of
  five shapes:
  - a noun list;
  - one weapon (the restricted level);
  - a melee predicate with sizes, or a missile predicate (every word a
    `config.SIZE` value, "melee" or "missile");
  - a combination with its prerequisites (the sentences saying a weapon needs
    another first, in each wording the page uses).

  Each list cites its own window. `acksExtras.weaponListsImported` fires with
  `{ assembled }` once the document is registered.
- **A window that did not read costs its list only.** The list is absent, the
  resolver places nothing from it, and nothing is defaulted.
- **A grid row's sub-header.** `extractValueRows` records the labelled row that
  opens each block of the grid, `bindWeaponRow` writes it to
  `flags["acks-extras"].weapon.block` (null when the row sits under none, so a
  repair clears a stale one) and stamps the figures it read into
  `cookbook.read`. A repair rewrites both with the figures. Items minted before
  the block was recorded carry none until a repair runs.

## The gnostic tables

The `gnosis` ruledata document (optional, By This Axe) holds five raw
`gridRows` tables from the gnostic chapter: `performanceGrid` (invocation level
by invoker level, its header row kept as the column scale), `paceTable`,
`ceremonyDegree` (a band to a degree word), `mishapTable` (a row per d10 face,
three degree columns) and `implementCosts`. Rows are ordinals (`r1`...), the
face and level read through `labelInt`, cells are `c1`... in print order and
kept as printed; the derivation printed beside the performance grid is not
read. Nothing assembles or reads the document yet (the gnosis engine, magic
ROADMAP 3c, is its reader), so the Ruledata Browser listing is the whole
surface. The mishap table's label sits at the centre of a row of any height,
which nearest-label joining mis-assigns, so its recipe sets `wrapRows.boxed`
(`boxWrapLines`): the first line no earlier row took fixes the box's last line
as its reflection about the label.

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

## A figure a price row's label states

Some rows of the RR price grid state what the item holds inside their own
label, in stone. `gear-prices.mjs` `labelCapacity` reads it off the label as the
row is extracted, so a price row carries `capacity` beside its cost and
encumbrance, and `capacityFor` hands it to an entry only where the row IS the
entry (the same `priceKey`), never to a variant the prefix lookup fell back to.
The cookbook binds it onto the item's `gear.capacity` (`withCapacity`, for a
minted entry and for a price row no entry claims) and records the figure in the
`cookbook.read.capacity` stamp, which is how a surface later tells the page's
figure from one a Judge typed. `REPAIR` carries the `gear` flag for the
equipment and priced shelves, so a rebuild writes the page's capacity back
under the id the item holds. A label that states none reads none; nothing here
supplies a capacity by name (`docs/equipment/MODEL.md`, "Figures the book
prints").

Two sentences of RR read as `proseValues` windows of the `equipment` document:
the sizes Weapon Finesse takes (`weaponFinesse`, the `sizeList` take) and the
unarmed strike's die (`unarmedStrike`, the `dice` take).

The retrieval rule on RR 294 reads as a `gearAccess` document of its own
(`retrieval`, the `nounList` take): two lists of carrier words, each anchored on
its verb phrase and cut at the clause that ends the list (`until`), so the
recipe holds no carrier's name. `lib/vocab.mjs` `retrievalAccess` answers a
carrier's side from them, and blank with nothing imported (`docs/lib/MODEL.md`,
"Slots").

Item loss reads JJ 398 into two more `equipment` tables: `itemLoss` (six
`proseValues` figures) and `itemLossMaterials`, a `gridRows` whose row keys are
`lib/vocab.mjs` `DAMAGE_TYPES` keys and whose one cell, `materials`, is read by
the `wordList` cell pattern: a sentence-shaped list of kinds, with its commas,
closing "and", quotes, bracket of examples and the word "items" dropped, and a
cell reading "none" as an empty list.

A `gridRows` recipe with `keyByLabel` names no row in source. Its specs are a
generic run of optional label patterns, each claiming the next row, and the
row's key is `slugLabel` of the label it claimed (the rule the executor's grids
use) with the row's `label` set to the tidied print; a label that folds to no
key or repeats one is dropped. The monsters document's `bodyForms` (MM p. 389)
is read this way, its sample column through the `tidyNames` cell pattern, which
restores each comma part's small-capped opening letter.

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

## A name read by its key

A row that withholds a printed name locates it by `anchor.hash`, the
`printKey` of the name's folded letters (`printed-name.mjs`), and the words
arrive from the Judge's page. Seven mechanisms carry that past the keyed
places of an adventure.

- **Display headings.** `compileClass` (a `kind.class` row with `anchor.hash`
  in place of `anchor.display`) and `compileDefinition` (a row with
  `anchor: {hash, as: "display"}`, or a kind whose default locate is
  `display`) find the display head whose box reads back to the key
  (`displayHeadByHash`, trying a box tight to the heading's own runs, over a
  heading that wraps, and out to the column edge, in that order; a hash wants
  an exact read-back, where `expect` tolerated trailing text) and ship `fields.name` as a `heading` instruction, `caps` set where the
  printed case carries nothing. No head answering the key throws. A class
  table's `title` and `profList.label` may be the common-word tail of the
  printed one: the proficiency-list label is found inside the run it ends by
  the row-level fallback (`findLabelRun`, a substring match), the lowest such
  row winning. The first-pass test stays `startsWith`: widening it to a
  substring moved the list boxes of shipped classes.
- **The binder takes the read name.** `bindClass` and `bindAbility` name the
  document `printedNameOf(node, entry.name)`: the heading's read name, set as
  a title when the page prints capitals, else the entry's neutral label. A
  `system.key` still comes from `entry.meta.key` or the label.
- **The printed-name index.** A `powerSource` row may carry `nameKey`, the
  `printKey` of a name it does not spell, in place of `name`.
  `refForPrintedName` tries the folded name first and then the `printKey` of
  what it was handed; two rows under one key resolve to nothing, as two
  under one fold do.
- **Run-in paragraphs.** A `proseValues` entry with `take: "runins"` splits
  its window, cut from the page as printed, into `[{label, text}]`: each
  Title-Case phrase closed by a colon at a sentence start (the window's first
  character, or after a closing stop), with the text up to the next such
  phrase. A capitalised phrase and colon mid-sentence is no label, and text
  before the first label belongs to none. A page whose lowercase form is
  longer than its text (the fallback `extractProseValues` documents) is read
  from the lowercased text, which has no capitals to find.
- **Table recipes.** The `people` document's cultures
  (`table-recipes.mjs` `CULTURES`, one table feeding the name lists and the
  appearance palettes) ship ordinal ids and neutral labels and name no
  printed word. A block locates its name list by `anchorKey`, the
  `printKey` of the list's first given name (`locatePageNumber`'s
  `locateKey`, `holdsKey`, and `startAfterKey` for the list's start row),
  and its heading by `heading.key`, the `printKey` of the heading as
  `headingGroups` joins it (consecutive display runs, every contiguous
  sub-join, up to eight runs, since a heading wraps). The two are searched
  apart because a heading and its list can stand on different pages and
  columns. `runBlocks` reads the heading group's text into `list[id].label`
  (set as a title where the page's case carries nothing) and keeps the
  block's neutral label where the book that prints the heading is not open.
  An appearance block carries `section: {key, headH}`: `extractProseValues`
  searches only the runs from that heading to the next display run, so a
  phrase shared by several cultures' paragraphs is read from the right one,
  and a phrase that holds a word the page sets is a `findRe`. Structural
  meta (`race`, `alsoRaces` for the culture another race draws its names
  from) rides in the block. The ordinal-to-people pairing is
  kept LOCAL-ONLY with the decoder rings.
- **A culture's patronym, read from its section.** A culture whose section
  teaches a name template by example lists the value `{key: "patronym", take:
  "patronym", runOn: true}` among its appearance values, and
  `takePatronym` (`table-extract.mjs`) reads the section's text on the page's
  own case, with no phrase to find. An example is a given name glossed with
  its parent (`G, … of P`) beside a quoted full name that opens with the same
  given name; the template is the full name after the given name, `P` in it
  replaced by `{parent}` and every token after the one holding `P` dropped.
  The relation word in the gloss names the sex (a "son" gloss is the male
  template, a "daughter" gloss the female); a pair with another relation is
  both sexes' template only where the section teaches no son or daughter
  example. A pair whose quoted name does not hold the parent is no example
  and is skipped. With a male template and no female example, the female one
  is the male's with the word glossed "son of" swapped for the word glossed
  "daughter of", else with its affix swapped for the second of an `-X or -Y`
  pair the male template holds as its own, else the male's; with neither sex
  taught, the section stores none. The result is `cultureAppearance.cultures
  [id].patronym = {male, female}`, strings holding `{parent}`. A paragraph the
  print breaks across a page is read whole: a value with `runOn` is handed the
  next page's items (`recipe.runOn`, which `runValueBlocks` fetches with a
  two-page span), and a section still open at its page's foot also reads that
  page up to its first heading (`sectionRunsOn`). `generateName` reads the
  template from that table, or inline on the culture entry, and the name is
  the given name alone where none is imported; a Judge edits it in the Tables
  browser like any imported table.
- **Prose by key.** A `proseValues` entry with `findKey` in place of `find`
  anchors on a word named by its `printKey` (`keyTokenAt`, `printed-name.mjs`,
  walking the tokens `holdsKey` tests; `findIn` in `table-extract.mjs`, which
  honours `occurrence`), and `take: "anchor"` stores that word as the page
  prints it, with the punctuation either side dropped. The recipe holds a key
  and the page supplies the word. `people.dwarvenCastes` is read this way: its
  castes are ordinal ids (`caste1` to `caste4`, in `emit.merge.order`), each
  with a share (`<id>Pct`) and a word (`<id>Label`) read off the page, and the
  last caste's share, printed nowhere, is the remainder its consumers compute.
  A word the page does not print is not stored, and the consumers show it
  blank (`rollDwarvenCaste`, the table's RollTable).

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

A monster's Spoils block ends at the first section label below it (a prepared
lair or encounter, a notes block; `SECTION_LABELS` in the compiler). The spoils
box closes above that label, and the paragraphs from the label down are
description under their sections. This holds in the anchor column, in a spill
column and on the spoils page. A continuation column stops at a Spoils run and
resumes at the next label. A continuation column marked `afterSpoils` opens
with the tail of a Spoils block begun on the page before, so it is read from
its first label. A continuation column's boxes carry the section that was
running when the column opened. The one exception is an opening box whose
predecessor ended without terminal punctuation: that box is marked `continues`
and joined. Paragraph boxes stop 30 pt short of the page's right edge, where
the side tab prints. The executor's mechanics scans (defenses, effects, rolls,
derived values) skip the encounter, lair and notes sections, because those
describe a lair and its occupants rather than the creature.

## Defenses: the creature's own clause and resistance's two figures

Two readers feed `lib/defenses.mjs` (the procedure is `docs/lib/MODEL.md`,
"Damage against defenses").

- **The creature's clause.** `defenseScan` reads a monster's own description
  into immunity, resistance and susceptibility bands of damage types, effects
  and the two quality flags. Beyond the sets it reads two more things from the
  same text, each only beside a cue and each left absent when unread:
  - `silverFlaw`, from a sentence that names silver beside a weapon or its
    damage and calls it extraordinary or magical. It is set on an immunity or
    resistance that turns on the damage's quality, never on a susceptibility.
  - a susceptibility's `factor` and `save`, from the sentence that names the
    susceptibility and the one after it. `factor` is read (`times`) from a
    sentence about the damage the creature suffers, takes or receives; `save`
    (`signed`) from a sentence about its saves. The takes are the recipes'
    own (`takeProse`), so a typographic minus reads as a hyphen. A multiple
    beside no such cue, or a sign-less figure, is left unread.
  - `mergeDefenses` unions the creature's bands with its type's: sets and
    flags union, a note joins, and the creature's own figure wins over the
    type's.
  - `bindMonster` stores each band through `packDefenseBand`: `damage`,
    `effects` and `conditions` as sets, `silverFlaw`, `note`, and for a
    susceptibility `factor` and `save`.
- **Resistance's figures** are the `defenses` document's `resistanceProse`
  table, a `proseValues` recipe in `table-recipes.mjs` like the `senses`
  document's: `fraction` (take `fractionWord`) and `saveBonus` (take `signed`),
  each located by the words of the clause before it, never by the figure (RR
  ch. 6, "Damage Type Immunity and Resistance"). It is a table recipe, so it
  has no register row and no cookbook entry; the Tables step of an import
  writes the document to the world, and the Judge's override layer wins over
  it. Immunity prints no figure and has no recipe.

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
or in the folder its row's `meta.group` names,
named by the heading its page prints, and given its page's text, stat lines
included, as its notes. It sits inside the place its row names
(`keyedParentId`): its parent row, else its space, else the book's own place
(`adventurePlaceId`), which every space sits in. A run asks for each place once
and its parent first (`keyedRun`), so the rows may be listed in any order. A
held place, the library's own document, is not read again; a world copy is
the Judge's and holds nothing for the step, as it answers no claim
(`claimActorImport`). It is given its parent where it names none, or
where the uuid it names resolves to nothing (a parent deleted and made
again); a parent that still resolves is left as the Judge set it.

A new place's roster is its occupants (`occupantsOf`), one hidden row each
(`occupantRow`), linked to the first of these that answers
(`keyedOccupantRows`):

0. the ACKS II monster the label is registered to for this book
   ("A lair is a place with its monster"), which answers alone: a label so
   registered never meets the same-name creature the replacement stands in for;
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

## A lair is a place with its monster

A keyed place whose row carries `meta.of`, the cookbook id of an ACKS II monster
row of the Monstrous Manual (`lairOfProblems`), is that monster's lair. The place
carries the id as its lair flag, and its stat lines bind through a registered
replacement; no book is named in either.

**A stat line binds through a registered replacement.** `register/_refs/creatureReplacement.json`
pairs a label with the monster row ACKS II prints for it: the creature under
another name, another spelling, another word order or an irregular plural. A
row is keyed by `hash36` of one folded form of the label (`creatureKeys`, so the
plural and the singular meet one key), names the row (`ref`, a `kind.monster`
row of the Monstrous Manual) and the books it was reviewed for (`books`), and
carries no name (`replacementProblems`). `replacementOf` reads it. A label whose
every stat line equals the row's figures (`tools/importer/compare-lines.mjs`)
is paired too. Any other label qualified by a role, an age or a size, a named
person and a generic crowd are not paired: they are made as the AX books' are. A registered label whose monster is
not yet in the library is made and not bound to its same-name row; a repair
binds it once the monster is there.

**The place carries its monster, and rolls the monster's lair when entered.**
`poiLocationData` writes `flags["acks-extras"].lair = {of}` from `meta.of`
(`lib/lair-logic.mjs` `lairData`); the monster is no roster row and no body of
the place. `lib/lair.mjs` is the only other writer of the flag. `lairMonster`
resolves `of` to the library's own actor whenever the Monstrous Manual is
imported, so no Repair is needed: it skips a world copy and a group's base actor,
which carry the monster's stamp (`byCookbookId` with `original`).

`rollLair` rolls once and leaves no row of the monster. Only a world place
rolls: it refuses a place in a compendium (`isShelved`) and writes nothing,
since the shelf place is the template a world copy is made from and a group is
a world document; `worldCopySource` hands a copy the monster (`lairForCopy`)
and none of the group, note or group row the shelf place held. It refuses while
`lair.group` resolves, plans from the monster's imported in-lair side
(`planLair`: a side counted in bodies rolls; units, no count, a template and a
monster not imported make nothing), makes the group with `makeEncounter`, throws
its lair side with `rollEncounter`, and writes `lair.group` and one hidden roster
row naming the group, whose quantity is the bodies rolled. It rolls beside any
stat-line rows, and a lair whose printed line binds to its monster rolls too.
Where it makes nothing it whispers the Judges the reason once and keeps it in
`lair.noted`. Calls for one place run one at a time. The line is the
wilderness line; a Judge re-rolls the other from the group's sheet. A group the
Judge deletes is rolled again at the next entry, and its stale row leaves the
roster with the new one.

Two things call it. A party token created on the Scene a place is
(`formation/module.mjs`' `createToken` path, which a teleport also fires, through
the location api's `locationOfScene`) rolls the lair on the primary GM's window.
The location sheet's Lair section (Contents tab, GM seats) shows the monster or
"not imported", the group or why there is none, and a Roll button, which is the
way to roll a lair that has no Scene once its place is a world document; on a
shelf place the button is disabled and the section says a lair rolls from its
world copy.

A repair of the book writes the flag back with the rest of a held place's build,
and a flag key the build does not carry (`group`, `noted`) is left as the place
holds it. A stat line that bound to a monster before it was imported is bound by
the repair. The rulings are DECISIONS 2026-11-13, "A lair links to its monster, and
a stat line binds through a registered replacement", and 2026-11-14, "A lair rolls
its monster's lair encounter on entry".

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

## A picture's text

A page that prints its text inside a picture has no text layer, and its fields
are read from the picture instead. A field whose instruction is `{op: "ocr",
page, then}` (a register row writes `ocr: {<field>: <then>}`) is dispatched by
`executeEntry` to `readPictureText` (`importer/picture-text.mjs`) with the
page's recipe, `bookCookbook.pictures[page]`; COOKBOOK, "`pictures`", is the
recipe's shape, the runs a box's lines become and the corrections applied to
them. `readPictureText` takes the page's runs from `pictureReadFor` and runs
`then`, a heading, text, value or grid instruction, over them through
`execInstruction` with `claims` off and `getPage` answering the runs, so key
checks, paragraph assembly, stat-line parsing and creature lookups are the
existing ops'. A page with no recipe, or an `ocr` with no `then`, throws inside
`executeEntry`'s own try and is a miss of the field. A `value` that lists
`unread` paths has each deleted from the parse, recorded as a miss `{field,
unread}` and echoed as `result.unread`, which the binder reads
(`bindNpc`, "The Judges Journal's scenarios").

**What is kept, and where.** State is per session document (`stateOf`, a
`WeakMap`): the pages read, a promise queue, the engine and its idle timer. A
page's corrected lines are kept as long as the document is. `pictureReadFor`
answers a held page only when it holds the same recipe object it is asked
with; a read that fails is not kept, so the next ask reads again. A real read
runs through `withEngine`: one task at a time per document, the engine opened
on demand (a pinned copy of the PDF from `doc.getData()` through `openPinned`,
and a reader from `createReader`) and closed by `teardown` once `IDLE_MS` has
passed since the last task, the timer never holding a Node process open. An
engine that failed to start is dropped, so the next read starts one. No
runtime script calls `closePictureReads`; the idle timer is what closes the
engine in the client. `seedPictureRead` stores box reads as if the page had
been read, so no engine starts: the compiler seeds the author's read and the
suites an invented one.

**What runs where.** `pictureScaled` picks the page's one painted picture of
the recipe's size (`pictureBySize`) and scales it once (`SCALE`); `readBoxReads`
cuts each box from that image, padded by `BOX_PAD`, and reads it; `pictureRuns`
applies the corrections and makes the runs. `importer/ocr.mjs` is the pixel
path. `openPinned` opens pdf.js with its canvas and image-decoder paths off, so
a picture's samples arrive raw, and grey, the scale and the PGM handed to the
engine (`toGrey`, `scaleUp`, `toPgm`) are integer arithmetic over module-owned
data: every seat gives the engine the same bytes. The engine is the vendored
Tesseract in `vendor/tesseract/` (`vendor/tesseract/README.md`). In the client
it is tesseract.js's worker (`browserEngine`) with every path pointed at the
vendored files and no network or cache; in Node `nodeEngine` loads the same
core and data and makes the calls the worker script makes on it.

**The reading bar.** `readBar` opens a `progressBar` labelled
`ui.progressPictureText` with the page's number in the file, takes one step a
box and finishes when the read ends, failed or not. It opens at the ask, for a
real read only: a held or seeded page shows none, and neither does a run with
no notifications or no strings to label it from.

## The Judges Journal's scenarios

The nine scenarios of Appendix A (PDF pp. 417–425, one page each) are rows of
the Judges Journal's register, `register/jj/p<page>-scenario.json` and
`p<page>-plan.json`, whose text and names are read by the `ocr` op above. A
scenario is a key space `jj.scenario<N>` with its keyed areas under it
(`jj.scenario<N>-<key>`, `meta.space`), the creature rows
`jj.scenario<N>-npc<I>` (21 in all) and one plan, a `kind.scene` row
`jj.scenario<N>Map`. The p. 421 picture draws three plans, so its scenario has
two parts beside its plan (`jj.scenario5Map1`, `jj.scenario5Map2`, `scene.part`
as under "Several scenes of one place"), each with its own crop, pins and grid
block; a key two of the plans print is pinned on each. A row's label is neutral ("Scenario N", "Scenario N NPC
I"); a heading op proves its box by the key number it opens with or by
`printKey` of the words (`hash`), and the place or actor is named by the
words the Judge's page prints (`printedNameOf`). The keyed places, their
roster order, pins and `travel` are "An adventure's keyed places"; this
section is what the scenarios add to it.

**Groups and folders.** Every row carries `meta.group: "Scenario N"`.
`importKeyedPlace` files a place under `[book label, meta.group || "Places"]`,
and the creature rows file under the same name through `actorGroupOf`
(`targetFolder`), so one `Scenario N` folder holds a scenario's places and
creatures. `scenarioProblems` (`tools/importer/scenario-rules.mjs`, run by
`lint-register.mjs`) holds the shape: the group on every row, a key space with
areas and one plan (a scene row with no `scene.part`, beside any parts), a plan
that pins its own areas only, and every area pinned itself or through the area
it is part of (`meta.parent`). The plans are `kind.scene` rows with `places`
pins and no walls.

**Creatures.** A `kind.npc` row reads its name as a heading and its stat line
through `ocr` into a `value` with `pattern: "statline"`;
`importAdventureActor` (`cookbook/actor-import.mjs`) binds it with `bindNpc`
(`cookbook/monster.mjs`). `parseStatline` reads a line that prints each
routine's throw and damage inside its attack parenthesis routine by routine
(`scenarioRoutines`, `statline-attacks.mjs`) into `atks[]`; `atk` stays the
first routine, and a line that keeps its damage under its own key reads no
`atks`. Each routine is one weapon (`weaponPayload`) typed by its own damage
word in `flags["acks-extras"].damageType`. A routine whose throw differs from
the first's carries the difference as the weapon's `bonus.attack`, since the
actor holds one attack throw. A line that prints hit dice and no hit points
takes hit points from its dice by `bindStatsScalars`' rule, for every adventure
and Lairs & Encounters creature bound by `bindNpc`, not the scenarios' alone.

**Roster links.** `meta.roster` on a place row lists cookbook ids of creatures
the place holds that no stat line in its own text gives. `keyedOccupantRows`
ends with `rosterLinkRows` (`cookbook/roster-links.mjs`): one hidden row
(`occupantRow`) for each id the library holds, as its own document and never a
world copy, with the default quantity and empty notes, none for an actor the
roster already holds. An id nothing answers adds `tally.rosterWaiting`;
`cookbookImportPoiPlaces` says how many in its notice
(`ui.poiRosterWaiting`) and returns the count. `rosterProblems` holds each id
to a creature or person row, named once, on a keyed place.

**Unread figures.** A `value`'s `unread` paths leave a parse figure out of
`bindNpc`: no save row worked out from a class level, no hit dice from a level,
no throw and no attack text. `unreadOfStatline` adds the hit points where the
hit dice are unread and none are printed. `importAdventureActor` then writes
`flags["acks-extras"].extras.derived.unread`, `[{path, held, cite}]`
(`unreadRecord`, `UNREAD_FIGURES` in `importer/unread-figures.mjs`): each actor
path the figures stand for, the value the created actor holds there and the
entry's page reference. The list is written only where it is non-empty or
clears an earlier one, and a repair keeps the `held` an earlier import listed.
The sheet side is docs/monsters/MODEL.md, "A figure the import left unread".
No shipped row lists an unread path.

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
`empty: true` and reads as an empty result text. A die cell printed
"<n> or less" or "<n> or more" ships under `r<n>` with `open: "below"` or
`open: "above"` on its paragraph; the executor does not carry the mark, so
`cookbookImportRollTables` reads it off the compiled entry and, after the
formula is read off the printed ranges, widens that result's range on the
open side (`openRange`), so a roll modified past the bound lands on it.

A table's description ends at `assists.descStopY`, a y, or a list of them
for a description that turns a column: the first bounds the anchor's column
and each later one the column after it, read from that column's top.

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

## Overhead token art from an installed compendium

The Tools tab offers a monster's token from a third-party Actor compendium the
world has active (`token-art.mjs`; the plan is `token-art-logic.mjs`, Foundry-free).

**The source is found at runtime** (`tokenArtSources`): an active module other
than this one whose Actor packs hold monster rows with token art under
`modules/<id>/` (`indexSource` drops a row whose token is a core icon or
another package's placeholder, and remembers its name as "no art"). Nothing
names a package or a pack; the title is `game.modules.get(id).title`. When more
than one package qualifies the Tools tab shows one Apply button each, so the
Judge picks. A package that is not active serves no packs and is not offered.

**The match** is exact: `foldName` (diacritics stripped, then lib `slug`) of the
imported monster's name against the source's. A name the source answers with
more than one distinct image is ambiguous, one with no art row is "no art",
one with no row is "no match"; all are counted and none guessed.

**The write rule.** Apply writes a monster only where its prototype token
still shows its own portrait (the import's default), is empty, or shows the
image this feature last wrote (`flags["acks-extras"].tokenArt.src`, so a rerun
is idempotent and a Rebuild's fresh actor can be written again). A token a
Judge set is counted as kept and left. Subjects are `libraryActors()` monsters
with a cookbook id: the shelf's and the world copies made from them.

**What is written:** `prototypeToken.texture.src`, `prototypeToken.randomImg`
when the path is a wildcard, and `prototypeToken.texture.fit` set to contain.
The token's size and scale stay the module's and the compendium's scale is never
copied; `img` is never written, so the book's image stays the portrait. The
flag records `{from, src, was}`, `was` being the token that stood before the
first write. **Restore** reads only the flag, needs no compendium, and puts
`was` back where the token still shows `src`, then unsets the flag; a token a
Judge changed since is counted and left.

**Placed tokens**, when the confirm's tick is set: for a world actor, each
unlinked token on a scene whose image is the old prototype path moves to the
new one (`planPlaced`). A wildcard path is not moved to, and a linked token
follows its actor. **Wildcards** reach the encounter group through lib
`artOf`, which falls back to the portrait when the token is a wildcard.

The GM alone sees the controls; a write a locked library pack refuses is counted
as refused. The art is referenced by path from the other package, never copied
into this repository or shipped in this module.

## The cookbook's files

`scripts/importer/cookbook.mjs` is a facade: it holds no code, only
`export { … } from "./cookbook/<file>.mjs"` lines that name every public
symbol the rest of the module imports (never `export *`, so adding a public
name is one visible edit). The code lives under `scripts/importer/cookbook/`,
cut by kind and layer:

- `state.mjs`: the loaded cookbook data and context, the entry listers and
  predicates, small parsers, the debugging `api`.
- `read.mjs`: reading one entry off the seat's own book for an import or a
  repair (`readForImport`, `repairFromEntry`), the passed-over tally, the
  per-run page cache, and the per-repair read memo (`holdingReads`). The memo
  is opened by `runMerged` and lasts for one merged repair, both passes and
  the finish, including the wait on the Judge's choice dialog, then is gone.
  Inside it an entry's executed node is kept per open book and entry id, and
  each read hands back a copy of that node. Nodes only, never pages. A read
  that passes any option but the page cache bypasses the memo, and no import
  run opens one.
- `target.mjs`: import targets, the world or a compendium, the item shelves,
  the library name index, the document writers.
- `abilities.mjs`: binding an executor ability to its document, the ability
  name index, same-name reconciliation.
- `monster.mjs`: the full monster sheet and template binding, monster prose
  channels, legacy monsters and NPCs.
- `classes.mjs`: binding a class entry: prose parsers, ladders, training,
  paths, provenance, class updates.
- `equipment.mjs`: equipment, vehicles, and the weapon and armour tables.
- `variations.mjs`: variations, traps, spells and merchandise.
- `adventure-places.mjs`: adventure journals, points of interest, keyed
  places, region rows, markets and factions.
- `adventure-maps.mjs`: roll tables, adventure items, scenes, zones and links,
  the Adventure document.
- `actor-import.mjs`: importing one actor or a batch, with the abilities and
  companions it resolves.
- `abilities-import.mjs`: bulk ability import, update and prune dialogs.
- `rebuild.mjs`: the import-kind tables, repair in place, reimport one shelf,
  the adventure book steps.
- `import-dialog.mjs`: the debug window and the audit of raw executor output.

**Layering.** The files above are in import order: a file imports only files
listed before it, `state.mjs` imports no sibling, and nothing under
`cookbook/` imports the facade, so there is no cycle. `read.mjs` holds the read
helpers and the repair's memo, shared by the binders and the repair: one place
where an entry is read off the book.

**Cross-book seams.** No file is per book, and none is cross-book: the join of
a place two books print lives in the file where its kind lives
(`adventure-places.mjs`, `adventure-maps.mjs`), not in a file of its own. The
rule for that join is "A place two books print", above.

A suite that pins what the cookbook's source says reads it through
`cookbookSource()` (`tools/importer/cookbook-source.mjs`), the facade and every
file under `cookbook/` joined, and a symbol is named by its file, not by
`cookbook.mjs`, wherever a doc says where it lives.

## Silos

A **silo** is the code written for one set of books, kept where nothing else
reaches it. It owns book ids: the `REGISTRY` entries that declare its `stats`,
their id prefix, their entry kinds and the member files that exist only for
them. One silo is declared, `ose` (`stats: "ose"`; prefix `ose.`; kinds
`kind.oseMonster` and `kind.oseLocation`; `OSE_SILO` in
`tools/importer/check-silos.mjs`); its books and members left `main` for the
`parked/ose` branch, so it owns none today and the gate keeps those ids and
kinds out of `scripts/`. The ACKS books are the engine's own library
and own no silo: a row keyed to one of them is data in a shared recipe. Two
helpers that only look like silo code are shared: the place an adventure's rooms
nest under (`adventurePlaceId`, `adventurePlaceData`, in `poi-binding.mjs`),
built for every adventure book, and the generator-id grammar
`<book>.group.<key>` (`groupId`, `groupBookOf`, in `import-kinds.mjs`), which
repair and rebuild read. The `ose` flag and `kind.oseAdventure` on that place
are the stamp worlds already hold, so both names stay.

`tools/importer/check-silos.mjs` holds every file outside a silo to four rules,
each a pure function over facts parsed from source (Node's bundled acorn, so it
runs behind `--expose-internals`, re-exec'd from `tools/validate-extra.mjs`):

- **imports** (`scripts/` and `tools/`): no static import, `export from` or
  literal `import()` of a member. Under `scripts/` no file, a member included,
  calls `import()` with an argument that is not a literal. The silo's manifest
  importing its entry, and `tools/importer/silos.mjs`, are exempt.
- **literals** (`scripts/`): no string or template text equal to a silo book id,
  the silo id, a silo kind or a member path (a quasi ending in a member
  template's name counts), nor starting with `<id>.`. A `// silo-ok: <reason>`
  comment excuses the literals on its own line, or, standing alone, on the line
  below; one with no reason is itself a violation and excuses nothing.
  `books.mjs` and the seam file are exempt. The book ids are read from
  `REGISTRY`.
- **closure**: no member is reachable from `module.json`'s `esmodules` and
  `styles` except through the manifest edge.
- **agreement**: the manifest imports the silo's entry exactly when
  `module.json` declares its stylesheet. It applies once the manifest exists;
  until then the gate prints it as not yet applicable.

`tools/importer/silo-baseline.json` is every violation that exists today
(`{rule, file, target}`, no line numbers) and the member list. The gate fails on
a violation the baseline lacks and on a baseline entry that no longer occurs, so
the file only shrinks; `--write-baseline` rewrites it. A baseline entry is
identified by rule, file and target, so a second use of the same literal in a
file that already has it is not seen. The suite is
`tools/importer/test-check-silos.mjs`.
