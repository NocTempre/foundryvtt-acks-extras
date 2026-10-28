# Live-test recipes

> Merged from the separate acks-importer repo on 2026-09-01. Text written before then names paths as they were there: `scripts/x.mjs` is now `scripts/importer/x.mjs`, `tools/x.mjs` is `tools/importer/x.mjs`, `flags["acks-importer"]` is `flags["acks-extras"]` (the importer's `generated` key is now `minted`), and `acksImporter.fn()` is `acksExtras.importer.fn()`.

The canonical procedure is `.claude/rules/live-testing.md` — read it first.
This file records only what is specific to this repo: the fixtures each surface
needs, the steps that exercise it, and the observable that proves each one.

`validate` and `npm test` here run against mocked globals and against page
geometry with no Foundry at all. They gate the arithmetic; only a live run
gates that anything reaches a document.

Of these recipes, `tools/live/formation-day.mjs` drives Reimport One Shelf's
rules tables (`node tools/live/run.mjs formation-day`) and
`tools/live/importer-adventure.mjs` drives "A book lands in the library as one
Adventure", `tools/live/importer-characters.mjs` drives "A person the page
prints in full becomes a character" and `tools/live/importer-typography.mjs`
drives "A community book, read through its declared typography"
(`tools/live/README.md` is the contract); the rest is walked by hand.

## The Books window

### Fixtures

- Two or more ACKS II PDFs **the tester owns**, placed together in one folder
  along with at least one unrelated PDF (the unrelated file is part of the
  check — it must be left alone).
- A seat whose remembered locations can be emptied: use the window's own
  "Forget books on this computer…" first, so the walk starts blank.
- For the shelf: an empty `acks-extras-books/` under the Foundry data
  directory. Create it, use it, delete it — it is a fixture like any other.

### Steps

1. Open "Your ACKS Books (this seat)" with nothing connected.
   *Observable:* ONE window, four bands. The walkthrough band is open (this
   seat has nothing), the server band says nothing is staged, and every book
   renders a row under "Not connected" with its would-unlock scope. There is no
   `<select>` anywhere in it — `root.querySelector("select")` is null. The
   refresh-bridge line renders in the footer, the per-book detail in the
   console.
2. "Connect a folder…" → the fixture folder.
   *Observable:* every ACKS book in the folder connects in one trip; the
   unrelated PDF is named on the console only, never warned about; sheet prose
   renders. Rows move to the "Open this session" group.
3. **Add to server** on an open book's row.
   *Observable:* the row says it is uploading, then the book appears in the
   server band; `Data/acks-extras-books/` holds the PDF as `<bookId>.pdf`;
   a journal named for the book appears in the Journal sidebar under *Your
   Books*, its one page a PDF page whose `src` is that path —
   `game.journal.find(j => j.getFlag("acks-extras","shelf")?.book === "<id>")`
   — and the world setting `game.settings.get("acks-extras","shelf")` stays
   `{}`: the journal is the record.
   Press it a second time for the same book (re-open the window): the name is
   already taken on the server, and the copy up there is read and staged
   instead of a second upload being attempted — Foundry refuses to overwrite a
   non-media file, so an upload here fails the whole request. The journal is
   brought up to date in place: still one journal for the book, still one page.
3a. **Open** on a shelf row.
   *Observable:* the book's journal sheet renders with core's *Load PDF*
   button; pressing it replaces the button with an `iframe` whose `src` is
   `scripts/pdfjs/web/viewer.html?file=<the staged path>`, and the book
   renders. Delete the journal from the sidebar: on reopening the window the
   row is gone from the band and the file is still on disk — deleting the
   journal IS removing the book from the server list.
3b. **Add to server** on a book that is NOT open and NOT staged, and the shelf
   band's own picker with several files at once.
   *Observable:* the row carries the control at all — this is the case that had
   none. The file is read and identified BEFORE anything is uploaded, so
   handing a row the wrong book's PDF is refused with nothing on the server;
   the bulk picker stages everything it can name and lists the files that named
   no book. Both leave the row reading "Open from the server on every launch".
4. **Shut the world down and relaunch it.** This is the check the whole shelf
   exists for and a page reload does not substitute for it.
   *Observable:* the staged book is open at `ready` with NO gesture, no picker
   and no window prompting for it; its row reads "Open from the server"; the
   console says `opened N book(s) from the shelf` with the setting still `{}`,
   which proves the restore read the journals.
5. Copy a second PDF into `acks-extras-books/` by hand, then "Scan the
   folder".
   *Observable:* it is identified by name, opened to confirm it is that book,
   and staged. A PDF that is no book this module reads is counted, not staged.
   Rename a book's file to another book's name and re-scan to prove the
   verification: it must refuse rather than stage the wrong book.
6. Reload past the bridge window (or set the bridge to 0), then **Reconnect
   all**.
   *Observable:* one permission click on the remembered folder reopens every
   book in it; anything the folder cannot answer for is NAMED in the status
   line as still needing its own button. Shelved books never appear in that
   list at all.
7. `acksExtras.importer.connectBook()` and `acksExtras.importer.bookStatus()` from the
   console.
   *Observable:* both front the SAME window (singleton — a second call fronts
   it, never stacks a twin). This is what keeps macros already imported into
   worlds working after four macros became one.
8. Non-FSA fallback: repeat step 2 on an insecure origin or Firefox seat.
   *Observable:* the folder control is a directory input, per-book rows are
   file inputs rather than pick buttons, and books are remembered by NAME.
9. Join as the **Player** seat.
   *Observable:* the window does not auto-open; opening it by macro shows the
   server band read-only, with no Add/Remove/Scan controls. The shelf
   journals are not in the player's Journal sidebar (Foundry's default
   ownership — the GM alone) and the rows carry no **Open** button; give the
   seat Observer on one journal and that row's button appears.
10. The migration. Delete one book's journal, then put the old record back by
   hand — `game.settings.set("acks-extras","shelf",{wld1:{path:"acks-extras-books/wld1.pdf",name:"wld1.pdf",size:0}})`
   — and reload as the GM.
   *Observable:* the console reports `shelf: 1 book(s) carried from the world
   setting into journals under "Your Books"`, the journal is back with its PDF
   page on that path, and the setting reads `{}` again.

### Driving the pickers

No automation opens a native file dialog, so the two picking routes are driven
differently. An `<input type="file">` accepts a FileList built in page context —
`const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;`
then dispatch a bubbling `change` — which drives the shelf band's own picker
end to end, real handler and all. The FSA branch (a row's **Add to server**
button, which calls `showOpenFilePicker`) cannot be driven at all; exercise
`acksExtras.importer.stageBook(bookId, file)` instead, which is the function the
handler calls, and say so in the report. Files themselves come from the data
directory over HTTP: `new File([await (await fetch(path)).blob()], name)`.
Either route ends in the book's journal; a book whose file is already on the
server stages in well under a second, because nothing is uploaded.

To test a FRESH upload where the shelf already holds every book, move one file
aside on disk (`mv wld1.pdf wld1.pdf.aside`), stage it, then delete what the
upload wrote and move the original back — the uploaded copy must be
byte-identical, so `md5sum` is the check.

### Teardown

"Forget books on this computer…" and confirm; the rows return to absent. Then
remove each shelved book from the server band (its journal goes with it — the
*Your Books* folder stays, empty, and can be deleted by hand), delete
`Data/acks-extras-books/` and its contents, and confirm no journal carries the
shelf flag — `game.journal.filter(j => j.getFlag("acks-extras","shelf")).length`
is `0` — and that the window shows nothing staged.

## Remove ALL Imports sweeps materialized rules tables

Import rules tables (Reimport One Shelf → Rules tables; the import creates the
Foundry documents itself), confirm "ACKS Cookbook — RollTable" holds "ACKS
Imported Tables" with per-doc subfolders and readable names and "ACKS Cookbook
— JournalEntry" holds "ACKS Ruledata (Imported)" — the sidebar gains neither —
then run "Remove ALL Imports (GM)". *Observable:* the confirm counts the
packs' contents (the rules-table documents among them) plus whatever
materialized rules-table documents an earlier release left in the sidebar;
afterwards the packs are gone with the folder tree, its RollTables and the
journal, the sidebar holds none of them, while the imported table DATA still
answers (the ruledata browser still lists tables, and
`acksExtras.lib.services.get("ruledata-import").materializeDocs()` rebuilds the
documents on fresh shelves without re-importing).

## The library: compendium target and the two-level tree

The go-live gate for 3.0.0. Nothing offline can see a pack, so every claim here
needs a real one.

### Fixtures

A world that has imported nothing (or one reset with "Remove ALL Imports (GM)"
first), one connected book, and the **Player** seat for the ownership half.

### Steps

1. Import anything — one monster is enough.
   *Observable:* no new folder appears in the Actors sidebar. `game.packs` gains
   "ACKS Cookbook — Actor"; the actor is inside it, filed `<book> / <group>`.
   `game.actors.size` is unchanged.
2. Import abilities, equipment, weapons, armour, the price list and classes.
   *Observable:* every document is in "ACKS Cookbook — Item". Nothing sits loose
   at the pack's top level —
   `pack.folders.filter(f => !f.folder).flatMap(f => f.contents).length` accounts
   for none of them and `pack.index.filter(r => !r.folder).length` is 0. No
   folder is more than two deep:
   `[...pack.folders].every(f => (f.ancestors?.length ?? 0) < 2)`.
3. Check the namespaces that used to fall through: priced rows are under
   `Equipment / Price List`, races under `Races`, vehicles under
   `<book> / Vehicles` in the Actor pack, and **no** item has a
   `def.constant.*` cookbook id anywhere.
4. Run the vehicle import a second time.
   *Observable:* it reports every row as already present and
   `pack.index.size` does not change. (This is the check that was failing: the
   dedup asked the Item library about Actors.)
5. Right-click "ACKS Cookbook — Item" → **Configure Ownership**, set Player to
   Observer. Join as the Player seat.
   *Observable:* the pack opens and its documents are readable, from ONE
   setting. No per-folder dialog was involved.
6. Build class template packages, then open a class.
   *Observable:* bundles and gear are on the line's Item shelf ("ACKS
   Cookbook — Item") under `Class Templates / <Class>`, the class's 3d6 table
   on its RollTable shelf under `Class Templates`, the sidebar gains nothing,
   and the class sheet lists them. This is the acks-extras library reader
   working: a blank list here means it is reading `game.items` somewhere.
7. Open an imported template actor and press Generate.
   *Observable:* the new creature is in a top-level **Generated** folder in the
   Actors sidebar, not in the pack and not beside the template.

### Teardown

"Remove ALL Imports (GM)". *Observable:* the confirm counts the packs' contents
(class-template documents among them) and whatever an earlier release left in
the sidebar; afterwards `game.packs` holds no "ACKS Cookbook — …" pack, and no
orphan is left in the sidebar —
`game.items.filter(i => i.flags?.["acks-extras"]?.templatePart).length` is 0.

## A geometry change, checked against the GM's own book

Anything that moves a box — a detector, a compiled cookbook, a re-harvested
register — is verified by executing the entry rather than by reading the
geometry back. `cookbookDebug(id)` is the scriptable route: it runs the same
`executeEntry` the importer runs and renders `ok`, the miss list and the
description paragraphs into a dialog, and it writes nothing.

Fire it without awaiting — `DialogV2.prompt` resolves on DISMISSAL, so an
`await` hangs until the pane's timeout — then read the dialog's own instance:

```js
acksExtras.importer.cookbookDebug("dmb.level5Friar");
await new Promise(r => setTimeout(r, 5000));
const dlg = [...foundry.applications.instances.values()]
  .filter(a => /Dialog/.test(a.constructor.name)).pop();
dlg.element.querySelectorAll("details").forEach(d => (d.open = true));
```

*Observable:* `ok=true`, `misses (0)`, and a description paragraph count and
length per paragraph. Compare the lengths against the same ids run offline
through `executeEntry` with the PREVIOUS cookbook (`git show HEAD:cookbook/…`)
against the same PDF — that pair is what separates "the box moved" from "the
text changed", and the two are routinely different: a box can split into two
columns and materialize byte-identical prose.

`stats (0)` is normal for an OSE row, not a regression — check a row the change
did not touch before reading it as one.

A definition id (`def.class.thief` and every other content-cookbook entry) opens
the window like any other; the header names the book the entry itself declares,
since those cookbooks span books. Only ids the picker offers — the per-book
ones — are reachable from `cookbookDebug()` with no argument, so a definition id
is typed in by hand. A FAMILY id (`mm.familyAttercop`) is not executable at all
and says so: the family is synthesized from `cb.families`, and nothing there
runs against a page.

The closed-book branch is exercised from a **throwaway browser profile**, not by
disconnecting the shelf: book locations live in IndexedDB, so the capture
driver's own profile starts with every book closed and the message can be read
without touching the seat's shelf.

### An NPC's statline, granted without writing

For a changed statline box or grant when the world already holds the NPC: a
re-import would rewrite a document this session did not create. Run the
import's read half in page context instead. Open the staged copy
(`TEST_ENVIRONMENT.md`) with `openBook` from `scripts/importer/extract.mjs` on
its fetched bytes. Fetch `cookbook/<book>.json` and `cookbook/registers.json`
from the module, run `executeEntry(doc, cb, registers, id, {skipOps: ["art"]})`
from `scripts/importer/executor.mjs`, and hand `node.fields.statline
.proficiencies` to `acksExtras.lib.services.get("ability-provider").resolve`.
Arm create hooks first, as an OBSERVER only.

*Observable:* `missing` is empty, or holds only the gaps the ROADMAP names; no
granted item's name carries two bracketed specialties; the observer recorded
nothing. A grant that has to import a definition the shelves lack shows up in
the observer as that one item. Read the world's copy of the NPC to see what a
re-import would change.

### Where the importer actually writes

Not the sidebar. Classes, abilities and the rest land in the world compendium
`world.acks-cookbook--item`, and OSE creatures in
`world.acks-cookbook--<book>--actor` — so a presence check written against
`game.items` or `game.actors` reports "nothing imported" for a world that holds
the whole corpus, and invites a fixture run that duplicates it. Ask
`game.packs.get(<pack>).getDocuments()`. A map is the exception: its scene,
and the places and organisations it stands on, are WORLD documents. Its
book's Adventure is on the line's Adventure shelf.

### Teardown, when the feature chooses its own ids

A bulk importer returns counts, not documents, so the ledger comes from what
the run REPORTS: `api.track` every uuid a `created` object names the moment
the call resolves (the map step's `created.scenes`, `.actors`, `.folders` and
`.regions`, the adventures step's `created.adventures`), and for a pass that
reports counts only, read its shelf's
index by the cookbook ids it was asked for. A create hook is an observer,
never a delete list — `.claude/rules/live-testing.md`, Concurrency, has the
rule and step 4 the mechanism.

*Observable:* every pack is back to the document count it held before the run,
and `fromUuid` answers null for every uuid in the ledger. Deleting a hundred
pack documents one at a time takes about a minute — poll for the result rather
than awaiting it inside one page evaluation.

## Recipes, audited without importing

`acksExtras.importer.cookbookAudit()` answers "does this recipe still match the
printing?" with no documents written, so it is the cheapest check in the repo
and the first one to run when an import looks wrong.

*Observable:* with the core books connected,
`acksExtras.importer.cookbookAudit({ books: ["rr","jj"] })` returns `ok: 720, noMatch: 0, threw: 0`
in about five seconds, and `{ books: ["mm"] }` returns `ok: 291` in about ten.
A `noMatch` names a recipe whose page moved; `misses` names a register token a
recipe read but could not place. Art is skipped unless you pass `{art: true}` —
with it, a single Monstrous Manual creature can take fifteen seconds.

An adventure audits the same way. With AX1 connected,
`{ books: ["ax1"] }` returns `ok: 233, noMatch: 0, threw: 0` in about two
seconds: its keyed areas, its ten inhabitants and its tables. Its
`withMisses: 77` are rooms whose quick-stat creature is no token of the
shipped `creature` register (`register creature: unknown token`). A miss
still yields the name the page prints, which the room's journal page sets
on its creature line, so the count is no failure. AX3 reads `ok: 265` with
one such miss.
The audit's runs go through the live executor, so a reading-order or
stat-line change in `executor.mjs` shows here before any document is
written.

`acksExtras.importer.lastAudit()` reads a running pass, which is how a long one is
watched rather than waited on blindly.

## Import cost, and the shapes that used to be slow

Worth re-measuring whenever the import feels slow again, because every one of
these was misdiagnosed once.

1. Time a bulk step on a cold library: `acksExtras.importer.cookbookImportAbilities()`.
   *Observable:* seconds, not minutes. It writes in batches; a regression to
   one-write-per-document shows up as a step that gets slower the longer it runs.
2. Compare a create into a small pack against a large one.
   *Observable:* a write costs what the target ALREADY HOLDS — ~35ms into a
   19-document pack, ~950ms into a 1,039-document one — and twenty-five in one
   `createDocuments` call cost about what one costs. That is the whole reason
   for batching, and it is why a slow import gets slower.
3. Import a creature whose art is already in `acks-extras-art/`.
   *Observable:* a few hundred milliseconds, WITH its illustration applied. The
   page walk that chooses an image is skipped when the image already exists;
   if the art stops appearing, the gate moved back onto the op's result instead
   of the recipe's own art field.

## Nothing is imported twice

The dedup rules, each with a case that used to break it.

- **A library the sidebar still holds.** Every id in a fully imported world has
  a pack copy, so the sidebar-era shape has to be built: create a world Item
  stamped `flags["acks-extras"].cookbook.id` with a cookbook id, then ask
  `importedItemFor(id)` for it — import the module in page context
  (`await import("/modules/acks-extras/scripts/importer/cookbook.mjs?probe=1")`) to
  get a fresh index rather than the session's cached one.
  *Observable:* the gate answers with the sidebar document; before 5.2.1 it
  answered null and the next run wrote a twin into the pack. Stamp a real class
  id on an `acks-extras.class` item and `acksExtras`' `classItems()` grows by
  one — that is the doubled chargen list, reproduced. Delete the fixtures after.
- **Repeat any step.** Run `acksExtras.importer.cookbookImportAbilities()` twice.
  *Observable:* the second run reports everything already present and takes
  a fraction of the first — ~190ms against ~9s — and the pack's document count
  is unchanged.
- **Out of order, and repeated.** Run templates before abilities, then abilities,
  then templates again.
  *Observable:* the end state matches the canonical order. Fingerprint the pack
  (document count, unique cookbook ids, duplicate count) before and after; the
  duplicate count is 0 either way. This is the check that caught two
  `def.race.dwarf` and two `def.race.elf`.
- **A shelf that has gone cold.** A compendium drops the documents it holds 300
  seconds after the last access and keeps its index, so "run it twice" only
  covers the warm case — the interesting one is a second run after a pause.
  Force it rather than waiting: `game.packs.get("world.acks-cookbook--item").clear()`
  is exactly what the debounce calls and writes nothing. Then ask
  `importedItemFor(id)` for every class id and run
  `acksExtras.importer.importClasses()` with a `createItem` hook ledger armed.
  *Observable:* after the clear `pack.size` is 0 and `pack.index.size` is
  unchanged; every id still answers with a document, and with a NEW instance —
  one shelf re-read, `pack.size` back to full; `importClasses()` returns `[]`
  and the ledger is empty. Before the 2026-09-09 fix every id answered null and
  the run wrote 31 twins into a world that already held them.
- **The delete half of the same guard.** Create an Item in the pack carrying
  `flags["acks-extras"].cookbook.id`, `forgetImportedIndex()`, and ask for it;
  `clear()` the pack and ask again; delete it and ask again. Repeat with the
  delete happening while the pack is cold.
  *Observable:* found, found, null — and null again for the cold delete. Both
  states have to stay distinguishable: a cold shelf that reads as deleted mints
  twins, and a deleted document that reads as present breaks the Judge's one
  refresh. Delete the fixtures by the uuids the run recorded.
- **One thing printed two ways.** After a full equipment import, search the
  library for "oil".
  *Observable:* `Military Oil` (Weapons) and `Common Oil` (Adventuring Gear)
  exist; `Oil, Military (1 pint)` and `Oil, Common (1 pint)` do NOT — the price
  list recognised them. `Oil, Olive (1 pint)` DOES, because nothing else in the
  library is olive oil. Both halves matter: the check must dedup what is
  duplicated and keep what is not.
- **Completeness.** Fold every library document's name through
  `acksExtras.lib.vocab.nameKeys` and look for two documents sharing a key.
  *Observable:* the only collisions are entries the shipped cookbook itself
  duplicates (see ROADMAP) and paren-variants that are genuinely different
  products — "Candle (tallow, 1 lb)" and "Candle (wax, 1 lb)" are two things and
  must both survive.

## Three controls, and one shelf at a time

*Observable:* the "ACKS Extras Macros" compendium's two importer folders hold
FIVE macros — your books, import everything, reimport one shelf, reimport
individual entries, delete everything. A sixth is a regression. The four are
the controls; the entry picker is the debug tool beside them.

Reimport one shelf, e.g. Weapons:
*Observable:* the confirm names the count; afterwards the shelf holds exactly
what it held before and the pack's total is unchanged (38 removed, 38 written,
1,008 either side). Nothing on another shelf is touched, and a class template's
documents are never among the deleted — they carry acks-extras' stamp.

Reimport one book. Fixtures: a second book open on this seat that is not yet
imported (By This Axe, read one-off so nothing is remembered), then import
equipment — its own items appear; note their ids. Steps: the same picker, the
"Books open on this seat" group, that book, confirm.
*Observable:* the confirm names the count AND the shelves it spans; afterwards
every noted id answers again with the same name and a later
`_stats.createdTime` — written again under the id it had; every
other book's item count is unchanged; a Rulebook item carrying one of the
book's ids in `cookbook.merged` is still there. The group lists only books
open on this seat, and `cookbookReimportBook` for a book that is not open
warns and deletes nothing. Teardown: delete the re-created items by id;
reload the seat so the one-off book is closed.
Right after a reload the group can list only part of the shelf while books
reconnect; wait until `bookStatus()` shows the book before opening the picker.
A book read one-off is closed by that reload and needs reading again first.

Content after a reimport. Presence is not content: after a By This Axe
reimport, scan the rebuilt descriptions as well as counting them.
*Observable:* no token of 16 or more letters the vocabulary does not know (a
welded clause), no lowercase run straight into uppercase, and the Earthshooter
description is one paragraph that ends above the table following it on its
page. Portable Battering Ram and Personal Automaton read as separate words.

## One entry at a time

**(Re)import Individual Entries (GM)** —
`acksExtras.importer.cookbookReimportEntries()`. The finest rebuild: it lists
every entry the build can import, grouped by the run that rebuilds one, each
row carrying its id.

### Fixtures

An imported world. Note the document id, `img` and `_stats.createdTime` of ONE
imported trap and ONE imported proficiency, and the `_stats.createdTime` of
every other trap and proficiency, before starting. A rebuild writes an Item
again under the id it had and a monster under a new one (DECISIONS,
2026-10-23, "A rebuilt Item keeps its id"), so the creation time is what tells
a rebuilt Item from an untouched one. Either way the documents are the
library's, not the run's: never track or
sweep them, or the shelf is left short of the very entries the step rebuilt.
Only what the run adds to the world is tracked, as it is made — the copies in
step 10, the entry step 7 creates.

### Steps

1. Open the picker on a world with nothing imported yet.
   *Observable:* every group with compiled entries appears (monsters only when
   a book is open on this seat), the count in each heading matches the group,
   and no row carries a present tick.
2. Type a name into the filter, then an id fragment (`def.trap`).
   *Observable:* both narrow the list; the count beside the buttons reads
   "n of shown". *Select shown* ticks only what is visible, and clearing the
   filter afterwards leaves those ticks and no others — a row hidden while
   ticked is cleared, so what the list shows is what the button will do.
3. On the imported world, tick the one trap and the one proficiency and press
   *Reimport*.
   *Observable:* the confirm names the ticked count and the number of
   documents they claim (2 and 2). Afterwards both answer under the ids they
   had, each with a later `_stats.createdTime`, and every OTHER trap and
   proficiency keeps its noted creation time — the run rebuilt two rows, not
   two shelves. A class template's documents are never among the deleted.
4. Tick a vehicle entry, whose one entry covers a whole table.
   *Observable:* the confirm's removed count is the number of ROWS that entry
   made, not 1, and every one of them comes back.
5. Join as a non-GM seat and run the macro.
   *Observable:* it warns and creates nothing — the GM check is the API's, not
   the template's.
6. Tick ONE rules-table document — `weather`, say — and time the run.
   *Observable:* the progress bar's denominator is that document's recipe count,
   not 138; the confirm's removed count is 0, because rules tables merge into
   the store rather than being deleted and rebuilt; afterwards
   `acksLib.tables.getDoc("weather")` answers and every other document already
   in the store still answers, and `getLayer("weather", 20).cites` names a page
   for every table the run read or assembled (the browser rows are
   `docs/location/TESTING.md` step 5). A tick on a table row reflects the store's
   world layer (`getLayer(docId, PRIORITY.WORLD)`), not a document flag, so a
   world that has the store but no imported items shows ticks here and none
   above. `rarity` carries no tick in a world that never read it, although
   henchmen registers a sample under that id.
7. Tick ONE entry the world does not hold (no present tick), from a run whose
   shelf the world holds only part of, and press *Reimport*.
   *Observable:* exactly one document is created — `api.track` it from the
   run's result — and the shelf's count rises by one. Every other entry of that
   run the world lacked is still absent: the run was narrowed to the tick
   (`{ only }`), where a whole run imports every entry the world lacks.
   **On a world whose shelves are whole** there is no such entry without
   deleting shared documents first, and the equipment rows the picker marks
   absent are the second book's duplicates, which merge into or rename a held
   document. Prove the narrowing without a write instead:
   `importTraps({ only: new Set([id]) })` on one held trap reports "0
   imported, 1 already present" where the whole run reports 13, and the Item
   pack's index count is unchanged. Traps, because `importClasses` runs a
   ladder-key repair before its loop and can write to held classes.
8. Tick an entry whose book is NOT open on this seat.
   *Observable:* a notice says it was left as it is; no removal confirm opens,
   its document keeps its id and its `_stats.createdTime`, and nothing is
   created. On the shelf rebuild, the confirm's second paragraph names how
   many documents on the shelf come from a book that is not open and are kept;
   the count it offers to delete excludes them. Answer No — confirming
   rebuilds the whole shelf, which a shared test world does not want.
9. Run `acksExtras.importer.cookbookUpdateClasses()` with a class imported from
   a book that is not open on this seat.
   *Observable:* the confirm counts only the classes it can read and names the
   others as left as they are. Cancel it: Update rewrites every readable class
   in the world, which a shared test world does not want, and the partition is
   what the confirm shows.
10. **A copy the Judge made survives a rebuild.** Drag one imported trap out
    of its compendium into the Items sidebar, and one imported monster into the
    Actors sidebar, and `api.track` both copies. Give the trap copy a
    description of your own. Tick both entries and press *Reimport*.
    *Observable:* the confirm's removed count is 2 (the library's two
    documents, not the copies). Afterwards both copies keep their ids and the
    trap keeps your description. The compendiums hold both again, written
    anew — the trap under the id it had with a later `_stats.createdTime`, the
    monster under a new id — because the refill did not take a copy for the
    library's own document. Then *Reimport one shelf* for the trap's shelf.
    *Observable:* the copy is still there, unchanged, and the shelf's count
    matches the count before the step.
11. **OSE creatures.** With an authored OSE book open on this seat, open the
    picker.
    *Observable:* an "OSE creatures" group lists that book's creatures, and a
    creature the book prints one block per step for is ONE row, whose id ends
    `.group.<key>`. Tick one plain creature and one such generator, both
    imported, and press *Reimport*.
    *Observable:* the confirm's removed count is 2. Afterwards both exist again
    under new ids, and the generator still offers every step. With the book
    closed on this seat (the masking below), the same two ticks are refused and
    nothing is deleted: the closed-book warning, no confirm. The picker's
    promise then resolves `"ok"`, the button's action, since the refusal
    returns nothing for DialogV2 to hand back.
12. **A Judge's override is never read into the import.** On a world holding
    the imported `weather` document, with `t = acksExtras.lib.tables`, pick a
    table of it with no override yet (`t.getLayer("weather", t.PRIORITY
    .OVERRIDE)?.tables` lacks it; `conditionSpeed`, say) and keep a copy of
    its world-layer value. Open `acksExtras.location.openRuledataBrowser()`,
    press Edit on that row and save an invented value no book prints
    (`{"frigid": 0.123}`).
    *Observable:* the row reads overridden, and `t.getDoc("weather")` answers
    the invented value while `t.getLayer("weather", t.PRIORITY.WORLD)` still
    answers the copy. Now tick `weather` here and press *Reimport*.
    *Observable:* the world layer answers the book's value again, not the
    invented one, and `t.getDoc` still answers the invented one, because the
    override still stands on top. Press Revert on the row.
    *Observable:* `t.getDoc("weather")` answers the copy. The revert removed the
    override this step created; nothing else needs sweeping, and the override
    layer is absent again if it held nothing before.

**Closing a book on one seat.** A world whose books are SHELVED reopens every
one of them on every seat at join (`restoreShelf`), so a GM seat never holds a
closed book unless the book is unshelved for the whole world, and
`forgetBooks()` drops this computer's remembered locations for good. Steps 8
and 9 are reached by masking one book on this client for the length of one
evaluation: wrap `Map.prototype.has` to answer false for that book id on the
map whose values carry `{doc, title}` (the importer's open-book map), and
restore it in a `finally`. The rules-table read asks that map with `get`, not
`has`, so a mask for it wraps `get` too, answering `undefined`, and holds from
the click until the run resolves. It is a synthetic trigger — it proves the
partition against the world's real documents, not a seat that never opened the
book — and the report says so.

**Teardown.** `api.sweepTracked()`; quote what it removed, what it could not
find and what refused.

## Repair in place

Both rebuild dialogs carry a **Mode** select: *Rebuild (delete and import
again)*, chosen when the dialog opens, and *Repair in place*. The API takes it
as `cookbookReimportShelf(shelf, { mode: "repair" })` and
`cookbookReimportBook(bookId, { mode: "repair" })`; the entry picker passes the
select's value to `runEntryReimport`. Each goes to a confirm that counts what
it will write over, then to a notice counting what was written over, what kept
a description the Judge wrote, and what was left.

### Fixtures

A repair writes over whatever document answers for an entry, so the fixtures
are documents that answer for one: **sidebar copies of library documents** —
the shape a sidebar-era library has, which the importer still reads
(`sidebarImports`). Copy with `toObject()` and drop `_id`, `_stats`, `folder`,
`sort` and `ownership`; a `_stats.compendiumSource` would make the copy a
Judge's, which no run touches (`isWorldCopy`). Name each `Fixture · <name>`,
which is also the rename a repair must keep. Create them in page context and
`api.track` each uuid as it comes back.

- all thirteen **traps** — step 2 repairs the shelf whole;
- one **equipment stack**: an `item` with no `merged` and no `gear` flag;
- one **proficiency** no world actor carries, by cookbook id or by folded
  name — an ability repair rewrites every world actor's copy of it;
- one **class** whose template parts carry no `unresolved` flag (a class
  repair retries those on the library's bundles), with `system.templateTable`
  set to `""`;
- one **stat-block monster** from `world.acks-cookbook--actor`;
- a **character** holding a copy of the proficiency fixture;
- every row of one **land-vehicle** table, a **variation**, and one trap copy
  made with `game.items.fromCompendium(<library trap>)` — the Judge's dragged
  copy, which carries `compendiumSource`.

The system's actor create drops `system` from data without items: update a
vehicle row's `system` from the library row after creating it, and compare.

Then hide each library original from THIS client for the length of the steps,
so every lookup lands on a fixture. The item lookups ask the packs first
(`importedIndex`), so give each pack an own `getDocuments` that filters out the
library ids, delete it afterwards, and call `forgetImportedIndex()` on both
sides. The actor lookups ask the world first (`importedActor`), so a vehicle
row fixture answers without a mask; mask the rows anyway, or the confirm counts
twice. A class repair rebuilds the class's 3d6 template table, found by class
key: hide the library table from the rolltable pack's `contents` (an own getter
on the instance), and the run builds the fixture its own table, read back from
its `system.templateTable` and tracked. `importedItemFor(<trap id>)` answering
the fixture's uuid is the proof the mask took.

Edit the fixtures as a Judge would, each edit paired with a field the binder
writes so the re-read is visible:

- the first trap: another level, `<p>Judge note.</p>` appended to its
  description, and in its first level row a scrambled `damageFormula` (the
  binder writes it) and an `attackThrow` of 7 (the binder does not);
- the dragged trap copy: another level and the note;
- the stack: quantity 7, the note, a scrambled `cost`;
- the proficiency and the character's copy: the note, a scrambled
  `extras.category`;
- the class: the note, one scrambled leaf of its second level row;
- the monster: a hand-made weapon (no `minted`), the note in one prose field,
  a scrambled `system.hp.max`;
- the variation: the note, a scrambled `system.key`;
- the first vehicle row with crew roles, speed tiers and a hull of 2 or more:
  `shp.value` one below the library's, `shp.max` raised, its first crew
  role's `aboard` and first speed tier's `team` raised, a scrambled
  `feetPerTurn` and `ac`. On a row without roles or tiers, or with a one-point
  hull, a kept value cannot be told from a re-read one.

Record every library original's `modifiedTime`, the class's effect ids, the
monster's item ids and the class table's result ids, and arm a
create/update/delete hook observer — it shows where the writes went, and is
never a delete list.

### Steps

1. **The control.** Open Reimport One Shelf.
   *Observable:* the Mode select reads Rebuild; the Weapons, Armor, Languages
   and Races options end in *(rebuild only)*. Choose Weapons with Repair.
   *Observable:* a warning that the shelf has no in-place write; no confirm
   opens and nothing is written.
2. **A shelf.** Choose Traps with Repair.
   *Observable:* the confirm counts 13 to write over and says what a repair
   keeps. Confirm. The notice reads 13 written over, 1 keeping a description
   the Judge wrote; every fixture keeps its id and its `Fixture · ` name, and
   the edited one its level and its note. A document already equal to its
   build is not written at all — Foundry drops an empty diff — so its
   `modifiedTime` does not move although the notice counts it.
3. **Picked entries.** Open the entry picker.
   *Observable:* the Mode select reads Rebuild; a monster family's row and
   every OSE creature's row carry the hammer mark, whose tooltip and
   accessible name say *Rebuild only*; a stat-block monster's row does not.
   Tick the stack, the proficiency, the class and the monster, choose Repair,
   press *Reimport*.
   *Observable:* the confirm counts the four documents and carries the
   monster, ability and class lines. Confirm. The notice counts five written
   over — the character's copy is the fifth — all five keeping the note.
   - the stack keeps its id, quantity 7 and note; its cost is the library's;
   - the proficiency and the character's copy keep their notes; both
     categories are the library's;
   - the class carries the library's name and image, keeps its note, its level
     rows match the library's, exactly one effect carries the training's
     change keys, and `system.templateTable` names a new table (track it);
   - the monster keeps its id, name, hand-made weapon and prose note; every
     other prose field and `hp.max` match the library's; none of its old
     `minted` items remain and as many new ones stand, with the library's
     names; its image and token art are unchanged.
4. **Rows, a variation, a vehicle table, a copy.** Tick the first trap, the
   variation and the vehicle table's entry, Repair.
   *Observable:* the trap's first row has the library's `damageFormula` back
   and still an `attackThrow` of 7 — a row field the binder does not write is
   the Judge's — and its other rows match the library's; the variation keeps
   its note and has the library's key; the vehicle row keeps its `shp.value`,
   its crew and the tier's `team` while its `feetPerTurn`, `ac` and
   `shp.max` are the library's, and every other row matches its library row
   (the observer holds one actor update: the untouched rows equal their
   builds); the dragged copy's `modifiedTime` has not moved.
5. **A training a Judge took over.** Unset `minted` on the class fixture's
   training effect and rename it (what the training editor does), then repair
   the class again.
   *Observable:* exactly one effect carries the training's keys: the edited
   one, by id and name. The class keeps the table step 3 made.
6. **A closed book.** Mask the class's book (*Closing a book on one seat*,
   above) and repair the class from the picker.
   *Observable:* the closed-book notice; no confirm; the class's
   `modifiedTime` is unchanged. Unmask; mask the traps' book, `has` and `get`
   both, and repair the Traps shelf.
   *Observable:* the confirm counts 0 to write over and 13 kept; the notice
   reads 0 written over and 13 left, then the hint to open the book; no trap
   fixture's `modifiedTime` moved.
7. **The shared documents.** Remove the masks.
   *Observable:* every library original's `modifiedTime`, the class's effect
   ids, the monster's item ids and the class table's result ids are as
   recorded, and the observer holds nothing outside the run's own documents.
8. **A book.** Reimport One Shelf, the books group, a book, Repair.
   *Observable:* the confirm names the count and the shelves it spans (and the
   documents it leaves on rebuild-only shelves, where the book has any).
   Answer No: a book repair writes over every document of that book, through
   the runs steps 2–4 already walked.

### Driving it

- The entry picker loads the whole library before it renders — about ten
  seconds on a full world. Poll for `.acks-extras-importer-mon-list`.
- Typing in its filter unticks every row the filter hides; tick after clearing
  the filter.
- `bookStatus()` opens the Books window and resolves only when it closes, so a
  script that awaits it hangs. Count the books open on the seat with
  `reimportableBooks()`.
- The dialog's promise resolves with the run's result — `{replaced,
  keptProse, refused, refill}` — once the confirm is answered and the run
  ends; wrapping `ui.notifications.notify` records the notices word for word.

### Teardown

Remove the masks if a failed run left them; they live in that client only, and
closing it removes them too. `api.sweepTracked()` — the fixtures, the character
and the class's new table; quote what it removed, what it could not find and
what refused.

## Rules tables from Reimport One Shelf

**Reimport One Shelf (GM)** — `acksExtras.importer.cookbookReimportShelf()`.

1. Open it. *Observable:* a **Rules tables** group below the shelves and books,
   holding an **Every rules table** option and then one **`<key>` only**
   option per rules table, each saying it re-reads in place and deletes
   nothing.
2. Choose **Every rules table**, with the rulebook open on this seat. *Observable:* no removal
   confirm; the progress bar reads the rules tables from the books; afterwards
   `acksLib.tables.getDoc("weather")` answers and no shelf lost a document.
   On a shared world the re-read rewrites a store every session reads; the
   dialog's wiring is proved by replacing `acksExtras.importer
   .cookbookImportTables` with a recorder for the one submit (the option calls
   it through the api object, once, and opens no confirm), and the re-read
   itself by step 6 of *One entry at a time*, one document at a time.
3. The notices that send a Judge to import something — a missing table in the
   class builder, henchmen and markets, the location browser's empty list, an
   empty class picker, a stub class — are read through `game.i18n.localize`,
   since a shared world has its tables and emptying it to see one is a
   mutation. *Observable:* each names Import Everything, Reimport One Shelf or
   the macro folder that holds them, and none names the "ACKS Importer", a
   module that no longer exists to be found.

## Console budget

What an import run writes to the console, and at which level. DevTools with
every level shown, filtered on `acks-extras |`.

1. **Rules tables with a supplement closed.** Mask one supplement on this client
   (the technique under *One entry at a time*, "Closing a book on one seat"),
   and read one table document that uses it (`people`) from the entry picker.
   *Observable:* an info toast names the supplement and says every other table
   was read; no warning toast. With nothing masked, neither appears.
2. **No per-step echo.** Rebuild five monsters from the picker.
   *Observable:* no info line per step; one debug line when the run starts and
   one when it finishes. The art directory is asked for at most once in the
   session, and "art reused" lines appear only at Verbose.
3. **No stat-block guess for the six shared names.** The same run imports a
   monster whose proficiencies include climbing or swimming.
   *Observable:* no "matches several definitions" warning for them; the
   embedded proficiency is the proficiency, not the class power.
4. **Update Abilities reports a name once.** Give a tracked character two
   unflagged abilities named after one proficiency that is also a power
   (Acrobatics), and run Update Abilities.
   *Observable:* one debug line naming it with "(2 copies)"; no warning, since
   the ranking settled it. Both copies carry the proficiency's id afterwards.
   Update Abilities rewrites every ability in the world, the library's and
   every actor's, so on a shared world scope it to the fixture for the length
   of the call: on this client, own-property overrides make `game.packs.filter`
   leave out the cookbook's Item packs and make `game.actors` and `game.items`
   iterate the fixture alone, deleted again in a `finally`. An `updateItem`
   and `createItem` observer for this user proves every write landed on the
   fixture. The mask does not change the pick: with neither definition
   present the category ranking chooses, as it does when both are.
5. **A book nothing reads.** Open a book no entry or recipe cites.
   *Observable:* its toast says nothing imports from it yet, not "0 entries".

**Teardown.** Restore the masked book in the `finally` that masked it;
`api.sweepTracked()` for the character, and quote what it removed, what it
could not find and what refused. The monsters step 2 rebuilt are the library's
and stay (see *One entry at a time*, Fixtures).

## Two books, one item

With BOTH the Revised Rulebook and By This Axe connected, import equipment.

*Observable:* ONE "Boots", one "Cloak", one "Journal", one "Manacles", one
"Whistle", one "Laborer's Tools" — the Rulebook's copy, carrying the By This Axe
id in `flags["acks-extras"].cookbook.merged`. A regional version with the same
stats is a variant, not a second base item.

Where two entries genuinely differ, both are kept and BOTH are tagged —
`Boots (RR)` / `Boots (BTA)` — each keeping its printed name in
`cookbook.printed`. That last part is what makes it stable: tagging rewrites the
name, and a rewritten name would never collide again, so a pair tagged by an
older build could never be reconsidered.

*Observable, and the reason the register was fixed:* dwarven belts, boots, caps,
cloaks, coats, turbans and tunics file under `Equipment / Clothing`, not
Adventuring Gear, and the war and guard bears are `acks-extras.animal` ACTORS.
They were all authored `group: "gear"`, which is what stopped Boots merging. The
cookbook id and `cookbook.merged` flags are in `flags["acks-extras"]`.

## A priced row is the kind of thing its section says

### Fixtures

The Revised Rulebook connected, and the equipment import run. To exercise the
repair as well as the create, first make the pre-fix shape on purpose: import
equipment, then set one materialized clothing row back by hand —
`game.items.getName("Belt/Sash, Leather").update({"system.subtype":"item"})` —
and run the import again.

### Steps

1. Import equipment with the Rulebook connected.
   *Observable:* every row of the grid's first section is `subtype: "clothing"`
   and every row of the two below it is `subtype: "item"`. The one-liner that
   proves it without opening 92 sheets:

   ```
   game.items.filter(i => i.getFlag("acks-extras","cookbook")?.id?.startsWith("def.priced.")).reduce((m,i)=>{(m[i.system.subtype ?? i.type] ??= []).push(i.name); return m}, {})
   ```

   Clothing holds the belts, boots, cloaks, chitons and gowns; `item` holds the
   livestock and the foodstuffs. A run where EVERYTHING is `item` means the
   section headings were not found and the rows fell back — the failure mode
   this is here to catch, and it is silent on a sheet.
2. Open one of them on a character.
   *Observable:* it sits in the sheet's clothing band, not among the gear, and
   the character's encumbrance does not move when it is added — core exempts a
   clothing item, which is the whole reason the subtype matters.
3. Re-run the import after hand-setting one row back (fixture above).
   *Observable:* the console warns that it corrected N priced item(s), the
   document's subtype is `clothing` again, and NOTHING was created — the
   `created` count is 0. A repair that re-creates instead of correcting shows
   up here as a duplicate.
4. Apply a class template package that names a belt (any vaultguard or explorer
   template).
   *Observable:* the skinned "leather belt" on the character carries the base's
   subtype. A skin copied BEFORE this fix keeps the old one — re-apply the
   package to refresh it; the importer does not reach onto characters.

### Teardown

Delete the fixtures you created; the imported library is the world's.

## Ammunition is inventory, not a weapon

### Fixtures

The Revised Rulebook connected. To exercise the repair as well as the create,
build the pre-upgrade shape on purpose — recover the old binder and mint the
four rows the way they used to arrive:

```
git show v5.4.1:scripts/weapon-tables.mjs > /tmp/old-weapon-tables.mjs
```

then, in the world, re-create one by hand with the old shape and our own stamp,
so the repair has something to find:

```
await Item.create({name:"Case, 20 Bolts", type:"weapon", system:{damage:"1d6", weight6:1, cost:2}, flags:{"acks-extras":{cookbook:{id:"def.weapon.case20Bolts", cite:"RR p. 128"}, minted:true}}})
```

### Steps

1. Import weapons with the Rulebook connected.
   *Observable:* the four rows the page types Ammunition are `item`, and every
   other row is still `weapon`. The one-liner:

   ```
   game.items.filter(i => i.getFlag("acks-extras","ammunition")).map(i => `${i.name} [${i.type}] ×${i.system.quantity?.value} enc6=${i.system.weight6} per=${i.getFlag("acks-extras","gear")?.per ?? "-"}`)
   ```

   Four rows, all `[item]`. The case and the quiver read `×20` with `per=20`,
   the sling stones `×30`, the silver arrow `×1`. A run where any of them is
   `[weapon]` means the type column was not read and the rows fell back —
   which is silent on a sheet except for a damage die nobody can explain.
2. Check the arithmetic the page states, not the one the sheet renders.
   *Observable:* for the bare stacks `quantity × weight6` equals the printed
   encumbrance — 1 for the stones, 0 for the silver arrow; the case and the
   quiver carry the printed 1 whole as `weight6`, and `per` is what makes the
   bundle weigh once on a character. A stack whose per-unit weight was rounded
   to an integer shows here as 0, and as a character who can carry thirty
   stones for free.
2b. The weapons are the system's own shape. *Observable:* the one-liner

   ```
   game.items.filter(i => i.type === "weapon" && i.getFlag("acks-extras","cookbook")?.id?.startsWith("def.weapon.")).map(i => `${i.name} ${i.system.size} ${Object.entries(i.system.special).filter(([,v]) => v).map(([k]) => k).join("+") || "-"} ${i.system.damage.base.formula || "-"}/${i.system.damage.alternate.formula || "-"} tags=${[...i.system.customTags].join("|") || "-"}`)
   ```

   reads the table as the page prints it: Sword `medium - 1d6/1d8`, Dagger
   `tiny thrown 1d4/-`, Crossbow `na cleave+handy+slow 1d6/-` with
   `cleaveLimit.numeric` 2, Long Bow's `cleaveLimit.addStrMod` true, Lance
   `large impact+long+mounted`, Net `medium entangling+thrown -/-`, and no
   custom tag on any of them. Then put the Sword, the Dagger and the Net on a
   character with the **Roll automation** setting *off* and press the
   system's own attack button on each: the Sword's dialog offers One-Handed
   and Two-Handed and its preview reads 1d8 on the second; the Dagger's
   offers Thrown with range bands; the Net's rolls no damage. Put a Long Bow
   and the quiver on the same character and shoot once: the quiver reads
   `×19`.
3. Put the case on a character and open the sheet.
   *Observable:* it is filed as gear, not under Weapons; it carries no damage
   die and offers no attack; and it rides on the belt, free to draw from — the
   annotation acks-extras stamps at import. It is NOT a 1d6 line.
4. Re-run the import over the hand-made pre-upgrade document (fixture above).
   *Observable:* the console warns that it removed N ammunition row(s) imported
   as weapons, and the world afterwards holds exactly ONE "Case, 20 Bolts",
   typed `item`. Two documents means the repair ran after the claim rather than
   before it; zero means the delete found nothing to re-create from.
5. Make a Judge's own weapon with the same name and no importer stamp, then
   re-import.
   *Observable:* it is untouched. The repair only ever deletes documents
   carrying our `generated` flag.

The device actually holding its bolts, and choosing between stacks at the roll,
are acks-extras' surfaces — its `docs/equipment/TESTING.md` owns those steps.

### Teardown

Delete the fixtures you created; the imported library is the world's.

## A shield form is a shield

### Fixtures

The Judges Journal connected — the six forms are the only thing that reads
pp.409–410. ACKS Extras active, for the overlay and for the variation type the
repair looks for. To exercise the repair as well as the create, build the
pre-upgrade shape: mint one form the way it used to arrive, under the id it
used to carry.

```
await Item.create({name:"Kite Shield", type:"acks-extras.variation", system:{key:"shield.kite", kind:"form", appliesTo:["shield"]}, flags:{"acks-extras":{cookbook:{id:"def.variation.shieldKite", cite:"JJ p.408"}}}})
```

### Steps

1. Import equipment with the Journal connected.
   *Observable:* six armour items on ACKS Cookbook / Equipment / Shields, each
   one a shield carrying the numbers its own passage states.

   ```
   game.items.filter(i => String(i.getFlag("acks-extras","cookbook")?.id ?? "").startsWith("def.equip.shield")).map(i => `${i.name} [${i.type}/${i.system.type}] AC=${i.system.aac?.value} enc6=${i.system.weight6} form=${i.getFlag("acks-extras","shieldVariant")}`)
   ```

   Six rows, all `[armor/shield]`, each with an AC and a form. The
   encumbrances differ and that is the check: the buckler is printed in ITEMS
   and must read 1, the kite is printed at two stone and must read 12, and the
   other four read 6. A buckler reading 6 means the item unit was scaled like a
   stone; a form reading 0 means its locator missed and the shield weighs
   nothing.
2. Disconnect the Journal and import into a world that has none of them.
   *Observable:* the six still arrive, named and typed, with no description, no
   AC and no encumbrance. That is the bookless tier working: structure ships,
   the numbers are the reader's. A "+1" appearing here means a value was baked.
3. Put one on a character and equip it.
   *Observable:* AC rises by the number the sheet shows, not by a number this
   module chose. With the overlay on, cycle the strap to the back: the ordinary
   bonus goes away (the overlay corrects downward from the item's own value),
   and cycling back to hand restores it. A form that never moves the AC either
   way means the flag did not reach the overlay.
4. Re-run the import over the hand-made pre-upgrade document (fixture above).
   *Observable:* the console warns that it removed N shield form(s) imported as
   variations, and the world afterwards holds exactly ONE "Kite Shield", typed
   `armor`. Two documents means the repair ran after the claim rather than
   before it.
5. Apply a masterwork variation to a shield, then re-import.
   *Observable:* the applied variation is untouched. The repair reads the
   sidebar and our own packs; a variation living on an item is an embedded copy
   it never sees.
6. Make a Judge's own "Kite Shield" with no importer stamp, then re-import.
   *Observable:* it is untouched, and a second, generated Kite Shield stands
   beside it. The repair matches on the cookbook id it imported under, which a
   hand-made document does not carry.

What a form does once it is on a character — the carry states, the mounted
rules, the specialization gate — is acks-extras' surface; its
`docs/equipment/TESTING.md` owns those steps.

### Teardown

Delete the fixtures you created; the imported library is the world's.

## Class template packages

The recipe lives with the surface's owner: acks-extras
`docs/classes/TESTING.md` § Template packages. This repo's own observables
inside that recipe: `acksExtras.importer.importTemplatePackages()` (macro "Build Class Template
Packages (GM)", Getting Started step after classes) materializes with NO book
connected; bundles and gear land on the class's line's Item shelf under
`Class Templates / <Class>` and tables on its RollTable shelf under `Class
Templates` (a package lands beside its class; only a Judge's own sidebar class
keeps its parts in the sidebar); and after
`acksExtras.importer.cookbookUpdateClasses()` the rows' bundle links are re-derived and a
Judge-edited document shows up in the skipped count rather than being
rewritten.

### Auditing what a cell actually became

`tools/importer/dev-template-cells.mjs` reads every class's Starting Equipment cell
through the SHIPPING executor and runs the shipping splitter over it, against a
menu built the way a real import builds one — the equipment cookbook plus the
weapon, armour and priced grids materialized from the same book. It needs the
local reference library and never runs in CI.

```
node tools/importer/dev-template-cells.mjs               # every cell, item by item
node tools/importer/dev-template-cells.mjs --unresolved  # only cells with a descriptor that matched nothing
node tools/importer/dev-template-cells.mjs --pairs       # every distinct descriptor, grouped by what it matched
node tools/importer/dev-template-cells.mjs --menu sack   # what does the book actually CALL this?
```

**`--pairs` is the one that finds real bugs, and the unresolved list is not.**
A descriptor that matches nothing is visible on the character sheet as an item
with no mechanics; a descriptor that matches the WRONG row looks perfectly
fine and is what ships a carpentry hammer as a warhammer. Read the groups: a
mismatch shows up as one catalogue row quietly collecting descriptors that have
nothing to do with it. Auditing 623 of them by eye is how the wax candle filed
under tallow, the two-handed sword filed as a sword, and the silver dagger filed
as a dagger were each found.

Before ruling anything unresolvable, ask `--menu` what the book calls it: most
of what looks unmatchable is a name the price list writes head-first
("Rations, Iron"), and that is a rule, not an exception. What genuinely cannot
be reached by rule goes in `tools/importer/register/_refs/equipmentPhrase.json`.

## Imported text is in the document, not resolved at render

The change that retired the `@PdfText` enricher. Everything here is about what a
document CONTAINS after import, so every check is worth more from a seat that
cannot read the book than from the one that imported it. Flags are stored in
`flags["acks-extras"]`.

### Fixtures

1. A folder to import into, and one connected book (`mm` reaches the most
   shapes). Both go at the end.

### Steps

2. Import one monster. On the Description tab, confirm the block's own
   paragraphs are there, routed to their fields (appearance, combat, ecology…),
   and that the book and page appear ONCE, at the end of the last field that got
   text — not on every field, and not missing.
3. `api.forgetBooks()`, reload, and open the same actor. The text must be
   unchanged and complete. This is the whole feature: a seat with no book open
   reads everything.
4. **Join as a player** (a real seat, per the shared rule) and open the actor.
   The player owns no book and has connected nothing; they must read the same
   text. A stub, a tag, or an empty field here is the bug.
5. Search the actor's HTML for `@PdfText`. Zero hits — including the journal
   pages, roll tables, traps, equipment and class items an "Import Everything"
   run produces.
6. Confirm the text is ESCAPED, not parsed: import an entry whose page prints a
   `<` or `&` (a formula or a "&" in a name) and confirm the character shows as
   itself rather than vanishing into markup.
7. **A Judge's own writing survives.** Edit an imported ability's description by
   hand, then run *Update abilities*. The edited one keeps its prose and takes
   the mechanics; an untouched one is rewritten. Reversing that pair is the
   failure this stamp exists to prevent.
8. **The accepted cost, verified deliberately.** Hand-set a document's
   description to `<p>@PdfText[mm.ghoul]{MM p.112}</p>` — the pre-upgrade shape —
   and confirm it renders as that literal string, with no enricher left to hide
   it, and that *Remove ALL Imports* + a fresh import replaces it with real text.
   A world upgraded from an older build looks like this until it is re-imported,
   and the report should say so rather than implying otherwise.
9. **The same shape ON AN ACTOR — the case step 8 cannot see.** Put the
   placeholder on an ability item owned by a character, not in a world
   collection. *Remove ALL Imports* walks world collections and the library
   packs and never descends into an actor, so this copy survives the gesture
   step 8 proves; only the update pass reaches it. Confirm *Import Everything*
   clears it, and that deleting the imports and importing again does not.
10. **A book left disconnected must cost nothing.** Import an entry and confirm
    its prose. Corrupt two of its flags by hand — one that comes from the
    register (`extras.category`) and one that comes from the extracted text
    (`extras.effects`) — then disconnect that book on this seat and run the
    abilities update. *Observable:* the description keeps its paragraphs AND
    both flags keep their corrupted values, because the entry is passed over
    whole; the notification counts it as left untouched and says the book is not
    open. Check `effects` specifically: an earlier guard held back only the
    description, and `effects` came back empty while `category` repaired
    correctly — which is how we learned that a nodeless rebuild is impoverished
    everywhere, not just in its prose. Reconnect the book, run it again, and
    confirm both flags now repair. This is invisible on a seat that happens to
    have every book open.
11. **A placeholder on a copy no repair walks.** Build the pre-upgrade shapes
    on purpose — the test world holds none. A character carrying: a template
    skin (`flags["acks-extras"].skin.base` set, no `cookbook` flag) whose
    description is exactly `<p>@PdfText[def.equip.herbComfrey]{RR p.145}</p>`;
    an item with a paragraph of your own before an RR tag; an item tagged with
    an MM entry; an item tagged with an id the cookbook lacks; and an uncited
    tag (`@PdfText[<id>]`, no braces) in its own biography. Beside it, a loose
    world item holding a tag in its description and in a module flag that is
    an ARRAY, and a journal page holding one. A seat opens every shelved book
    on load, so close MM by `api.forgetBooks()` then
    `api.connectBookUrl("rr", …, { remember: false })`. Open Repair This World
    (`acksExtras.lib.repair.open({ only: ["importer.legacyText"] })`) and press
    its Scan, then select every fixable finding and Fix selected. In a
    backgrounded pane a coordinate click times out; `element.click()` on the
    button runs the same action handler. *Observable:* exactly the fixtures are
    listed, the MM one says to connect the Monstrous Manual and the unknown id
    says the library has no entry, and neither offers a checkbox; after the fix
    the panel reports each fixed and those two still listed. Read back: each
    fixed field holds a block stamped with its entry and no `@PdfText`; the
    cite is the entry's CURRENT reference, not the tag's p.145; your own
    paragraph is still first; the uncited tag got no cite line; the array kept
    its other element. Then reconnect MM and call
    `api.resolveLegacyText()` — Import Everything's closing step — and confirm
    the MM item is fixed and the unknown id is counted as left. The fix posts a
    whispered report naming the fixtures: delete it by the fixture ids it
    contains, with them.

### Teardown

12. Delete the folder and everything created, and the hand-made fixtures from
    steps 8, 9 and 11.

## A citation opens the shelved page

Every page reference an import writes is a link to the book it was read from,
at that page, and the reference an OLDER import wrote still opens — so the
check is one click on each shape, from two seats.

### Fixtures

1. One book staged on the server (Your Books), so it has a shelf journal, and
   one entry imported from it — an ability from `rr` reaches the link; the
   setting-table recipe below reaches the table's.
2. The **Player** seat, with the shelf journal at its default permission.

### Steps

3. Open the imported document's description. *Observable:* the reference at
   the foot of the text is a link carrying `data-book` and `data-page`, and
   the page is the PDF page, not the printed folio (RR p.111 carries
   `data-page="113"`).
4. Press it. *Observable:* the book's journal opens on its PDF page and the
   viewer lands on that page — the iframe's hash reads `page=113`. Press a
   reference to a DIFFERENT page while the viewer is open: the same viewer
   turns to it — the same iframe, no re-render — and no browser tab opens
   (stub `window.open` and count its calls: zero).
5. Hand-set a description to the pre-upgrade shape — a plain
   `<p class="acks-extras-importer-cite">RR p.111</p>`, no link — and press
   it. *Observable:* the same page opens: the text is parsed at click time, so
   a world imported before the link never needs re-importing to get it.
6. Press a reference to a book that is NOT on the shelf. *Observable:* a
   warning naming the book, and nothing opens.
7. **Join as the Player** and press the link. *Observable:* the permission
   warning, and nothing opens — the player cannot reach a PDF the Judge has
   not shared. Grant the player Observer on the shelf journal and press
   again: it opens.

### Teardown

8. Delete the imported document and the hand-set one; leave the shelf as it
   was.

## Location journals refuse a page they cannot anchor

The AX books' rooms. Every location entry carries a heading anchor, and the
whole point of this surface is that a page is written from the room it names or
not at all — so the check that matters is the REFUSAL, and it needs a book in
the wrong slot to provoke.

### Fixtures

1. `ax2` and `ax3` connected, and a third PDF that is **not** in the registry —
   AX1 does the job. A file the registry knows is refused at connect
   (`identifyBook`), so only an unknown one can reach the import; that is also
   the field case this guard exists for.
2. Serve the PDFs to the page: copy them under Foundry's `Data/` and connect by
   URL, which needs no file picker —
   `acksExtras.importer.connectBookUrl("ax2", "/<staged>/ax1.pdf", {remember: false, bridge: false})`.
   `remember: false` keeps the seat's location records clean; `bridge: false`
   keeps the wrong file out of the refresh cache.
3. Confirm the JournalEntry pack is empty first — everything counted below has
   to be yours to delete.

### Steps

4. With AX1 in the `ax2` slot and the real AX3 in its own, run
   `acksExtras.importer.cookbookImportJournals()`. It returns `{made, updated, refused}`:
   expect `refused: 4` (every AX2 room) and `made: 17` (every AX3 one). Open the
   pack — the AX2 journal exists with **zero pages**. A page there, under the
   right room name and citation, is the defect.
5. Connect the real AX2 and run again: `{made: 4, updated: 17, refused: 0}`.
   The guard must not over-refuse, and the second pass must UPDATE the AX3 pages
   rather than duplicate them.
6. Put AX1 in both slots and run a third time. Every entry refuses, nothing is
   written, and the notification says so — "did not match the cookbook
   (different printing?) — none written", not the empty-book message asking for
   a connection the reader already made. **The 21 good pages from step 5 are
   still there**: a bad re-run never destroys a good import.
7. The connect itself warns too (`page count 80 (expected 186)`). That warning
   is the reader's first signal; the refusal is what makes ignoring it safe.

### Teardown

8. Delete the journals AND the folders from the pack (`Folder.deleteDocuments`
   with `{pack}` — deleting the entries leaves the folders behind), remove the
   staged PDFs, and reload so the refresh bridge restores the seat's real books.

## A setting table is a journal page

A sidebar list the book prints without a die — the gambling games of RR
p. 113 — lands as a two-column table on a Setting Details journal, under the
register's header words, with no odds column.

### Fixtures

1. `rr` connected; the line's JournalEntry shelf empty first.

### Steps

2. Run `acksExtras.importer.cookbookImportJournals()`. *Observable:* the
   JournalEntry shelf holds **Setting Details** with a page named **Gambling
   Games**; the page body is one `<table class="acks-extras-importer-table">`
   headed *Game* / *Description*, one row per printed game with the game's
   name in the first cell and its whole description in the second — no die
   column, no odds, no cell from the neighbouring tables — and the RR p.111
   reference closes the block as a link.
3. Run it again. *Observable:* the result counts it as `updated`, not `made`,
   and the journal still holds one page.

### Teardown

4. Delete the journal and its folder from the pack.

## OSE import

### Fixtures

- An OSE or B-X adventure PDF **the tester owns**. Nothing in this repo ships
  one, and no path to one belongs in a commit.
- The ACKS II System Compatibility Guide, for the second half of the run.
- Actors created by the test are deleted at the end. Nothing existing is
  edited — a converted actor is disposable by construction, which is why the
  recipe creates rather than mutates.

### Offline first

```bash
npm run validate
```

Must report `ose-statline: OK`, `ose-convert: OK`, `ose-blocks: OK`, and
`cookbook drift: none`. The drift line is what proves the committed
`cookbook/constants.json` still matches what `register/scg/` compiles to.

### The constants, before anything else

This is the highest-risk step, because box geometry is per-printing and cannot
be checked without the book.

1. Connect the Compatibility Guide. It should fingerprint as 12 pages; its
   metadata title carries the publisher's own spelling ("Compatability"), which
   is why the registry matches on the stem.
2. Confirm all four constants resolve. In the console:
   `await readScgConstants(doc, cookbook, registers)` returns four integers, and
   returns **null** against any other book — the anchors refusing, which is the
   behaviour that matters.
3. If any constant returns null against the guide itself, the printing has
   moved and `tools/importer/harvest-scg-constants.mjs` must be re-run against it. Do not
   widen the boxes to make it pass.

### Stage A — import without the guide

4. Disconnect the guide. Register the adventure with `api.oseRegister()`:
   give it a name of your own (the file's metadata title is not trusted), and a
   lineage. Register the same file twice and confirm it is recognised and
   reopened rather than duplicated.
5. Pick a page with stat blocks. Confirm the candidates the locator offers
   match the blocks you can see — **count them against the page**. A page whose
   blocks sit beside prose in the facing column is the case worth checking.
6. Import one. Then open it and verify:
   - hit points, saving throws, movement, alignment and morale are filled;
   - **armour class and attack throw are NOT**, and both appear as gaps reading
     "needs the System Compatibility Guide";
   - the Source tab exists, shows the block as printed, and carries the
     unconverted warning.
7. Open a hand-built monster and confirm it has **no** Source tab.

### Morale, specifically

8. Import blocks with three different morale scores and read the actor's
   `system.details.morale`. A book's ML 7 must read −1 and its ML 12 must read
   +4 — and a middling ML 9 must read +1. If everything above the midpoint
   reads +4, a clamp is firing and the mapping is not being applied.

### Stage B — connect the guide

9. Reconnect the guide and run `api.oseConvertAll()`. It must report the
   number of actors updated.
10. Re-open the actor from step 6: armour class and attack throw are now filled,
    the unconverted warning is gone, and the Source tab's route column cites the
    guide for exactly those two axes.
11. Run `api.oseConvertAll()` a second time. It must report **0**. The
    no-op is asserted offline too (`test-ose-convert.mjs`), because the bulk
    pass's own filter used to be the only thing making it true.

### What must be refused

12. Point `api.oseImport()` at a page of blocks from a different game (one
    sample book prints two systems' stat blocks in one volume). Their
    checkboxes must be **disabled**, with the reason shown. Confirm the import
    button cannot reach them — a foreign ascending armour class read as
    descending inverts, which is the failure this check exists for.
13. Find a page where a narrow block sits inside a prose column. Its candidate
    must be marked as possibly two blocks, and also be untickable.

### Calibration

14. Find a page whose labels the canonical grammar does not know (one sample
    book heads its hit dice differently). The review dialog must say so. Run
    `api.oseCalibrate(sourceId, page)`, map the word, and confirm the blocks
    now read. Then open a DIFFERENT registered adventure and confirm it did
    **not** learn that spelling — the whole point of a per-source profile.

### Converting by hand

16. Run `api.oseManual()`. Paste a stat block into the box and press **Read
    it** — the fields must fill with the clauses as written (`SV` holding the
    whole five-letter row, not a parsed shape). Correct one clause, press
    **Convert**, and confirm the CORRECTED value is what the preview shows and
    what the created actor carries. An edit that survives the preview but not
    the document is the exact fault this surface was split to prevent.
17. Clear the paste box, fill two or three fields in by hand, and convert. The
    creature must be created with no source, no page, and `origin: "hand"` in
    its provenance; its Source tab must read "Entered by hand".
18. Calibrate an adventure to a wording the canonical grammar lacks (step 14),
    then paste a block using that wording into `oseManual()`. It must be
    understood, and the editor must say which spelling was used and which book
    taught it. This is the accumulating half — a book calibrated once makes
    every later paste better.
19. Paste something that is not a stat block. It must say so and change nothing.

### Teardown

20. Delete every actor created, and remove the registered source. Report which
    of the steps above were reached and which were not — a surface that could
    not be exercised is named, not omitted.

## Authored OSE books

Eleven third-party books ship a cookbook of creature boxes. The path is
`importOseBook(bookId)` — no registration, no calibration, no block picking.
Requires the book's own PDF connected this session; the fingerprints are page
count plus metadata title, and two Quick Delves share a page count, so a title
is what separates them.

### Fixtures

1. A folder to import into, created for the test and deleted after. Never import
   an authored book into the world root — 340 actors are hard to find again.

   **Pass `folderId` only where the step says to.** It OVERRIDES the shelving
   rule, so a run that always passes one never exercises the default — which is
   the thing that was broken: these importers defaulted to no folder at all and
   nothing passed one, so every authored book piled loose at the top of its
   pack. At least one book must be imported with no `folderId` at all.

### Steps

2. `game.modules.get("acks-extras").api.importer.authoredOseBooks()` lists the shipped
   books with their creature counts and whether each is open this session. A
   book whose PDF is not connected must report `open: false` and must not be
   importable — check the refusal, not just the list.
3. Import a SMALL book first (`qd1`, six creatures). Confirm: actors created
   with the cookbook's names, a Source tab on each, and a biography holding the
   block's own text with the book and page as its closing line.
4. **Check a name against the page.** The harvester's names are gated but not
   proofread; an actor named after a room or a sentence is the failure that gate
   exists to prevent, and it is visible only here.
5. **Check an illustration against the page.** Each picture goes to the block
   nearest it, so a creature the page never illustrated correctly has none. What
   must NOT appear is one picture on several unrelated creatures.
6. Import `dmb` and verify the DIALECT end to end. A Dolmenwood block prints
   its armour class ascending and alone, so the sheet must show an armour class
   that IMPROVES with the printed number — the same figure read as OSE lands
   several points the other way and looks entirely plausible. Confirm against
   the page for at least one creature, and confirm `flags["acks-extras"].ose`
   records `lineage: "dolmenwood"`.
7. **Run the same import a second time.** Nothing may be created, and it must
   be FAST: the presence check is taken before the page is read, so a book
   already imported costs an index lookup per entry, not a re-read. Measured on
   the full library, 643 documents in 41s becomes 0 in 1s. A second run that
   takes as long as the first means the check moved behind the read.
8. **Delete what was imported and import it again.** The claim is keyed by
   identity, and a claim that answers for deleted documents is the failure this
   step exists to catch — everything must come back.
9. `acksExtras.importer.oseImportAuthored()` — the step "import everything" runs. It walks every
   authored book the seat has OPEN and is silent about the rest: a Judge who
   owns three of the eleven must not be told about the other eight. Confirm the
   documents carry one id each — no two share
   `flags["acks-extras"].cookbook.id` — and that a book printing several
   creatures on one page (`dmb`) produced one document per creature.

   Driving it: fire it without awaiting and poll a global, because reading a
   library of PDFs pins the renderer's main thread and an awaited eval times
   out. `art: false` keeps a test run from writing hundreds of extracted
   illustrations into the data directory, which nothing deletes afterwards. The
   import uses the API path `acksExtras.importer.oseImportAuthored()`.

### Teardown

10. Delete the folders and every actor in them. Report which books were
   exercised and which were not reached.

## Apply Stats re-reads a stat block, or refuses

`applyStats()` UPDATES system data on documents that already exist, so this is
the recipe where a wrong target costs someone else's work. Two things decide the
targets and both are easy to get wrong from a script:
`applyStatsTargets` takes the selected tokens PLUS every open actor sheet, and a
COMPENDIUM actor's sheet counts — which is the only way to point at an imported
creature in a world with no canvas and no token. So **close every application
first** (`app.close({ animate: false })` over `foundry.applications.instances`,
then `ui.windows`), open exactly the fixture's sheet, and assert what the surface
sees before pressing it.

### Fixtures

1. One creature from an authored OSE book and one ACKS monster, both imported by
   this run. In a shared world the importers dedup by identity, so a book whose
   creatures are all present creates nothing and leaves you with no fixture you
   may write to. Find the free ids first: index every world Actor pack on
   `flags["acks-extras"].cookbook.id`, fetch
   `modules/acks-extras/cookbook/<book>.json`, and diff. `dmb` held two
   (`dmb.fireBeetleGiant`, `dmb.flyGiant`) against a fully imported library;
   `mm` held over a hundred.
2. For the retraction half, an ACKS monster whose block leaves a
   `REFILL_STAT_PATHS` entry unset — `mm.golemBone` prints no morale and no
   encounter numbers, so `details.morale` and `details.appearing.d` arrive at
   their schema initials and are free to tamper with.

### Steps

3. Import the OSE creature (`oseImportBook(<book>, { art: false })`), read the 18
   `REFILL_STAT_PATHS` off it, open its sheet, run `applyStats()`, read them
   again. *Observable:* every value unchanged, `_stats.modifiedTime` unchanged,
   and a warning naming the creature as left unchanged — no stat block for this
   surface to re-read. A creature whose fields all sit at
   `actor.system.schema.getField(path).getInitialValue()` afterwards is the
   blanking bug; a success notification for it is the same bug reporting green.
4. Import the ACKS monster, open its sheet, run `applyStats()`. *Observable:*
   "refilled 1 monster from your book" and a stat block that still holds the
   printed values.
5. Tamper with the two unset paths on the second ACKS fixture by hand
   (`details.morale`, `details.appearing.d`), then run `applyStats()`.
   *Observable:* both back at their schema initial values. This is the retraction
   itself — the thing the OSE refusal must not have disabled.

### Teardown

6. `oseImportBook` and `cookbookImportIds` return counts, not ids, so read the
   uuids back out of the pack index by the free cookbook ids from step 1 — the
   moment the import resolves, before anything else runs — and delete by that
   list, re-resolving each and skipping what has gone. Two runs can be told to
   import the same free id — the claim in `claimActorImport` is per client, so
   both miss presence and both build — which makes a uuid read back late a
   document that may be a peer's, freshly made and identical by id. Read early,
   and harden it: note the run's start once with `Date.now()` and delete only
   what carries a `_stats.createdTime` at or after it — both are epoch
   milliseconds and the server stamps `createdTime` within a few ms of the
   client's clock. **Not `game.time.serverTime`**: the server computes it as
   `Date.now() - <world launch>` and the client adds its own latency delta, so
   it is a DURATION since the world launched, not a timestamp. Against an epoch
   `createdTime` every document in the world compares as newer, and a filter
   built on it deletes the library. The server names the same quantity honestly
   one layer up — `/api/status` serves it as `uptime`, and both read the one
   `Activity#serverTime` getter — so if the endpoint's word for a number is
   `uptime`, that is what the client's `serverTime` is too. Where a run
   genuinely needs a server-stamped epoch, mint one: create a throwaway
   document, read its `_stats.createdTime`, delete it by its own uuid. The
   filter is a safety net under the early read-back, never the key — a clock
   skew that excludes leaves a fixture behind, which is the direction to fail
   in.
   `_stats.lastModifiedBy` is not a second opinion either: it is a static stamp
   of the USER who last wrote, so it is exact about users and blind to sessions,
   and sessions are what a teardown must tell apart. Quote what was removed,
   missing and refused.

## Shelves: one line, one set of compendia

Imports are shelved by SERIES, so another game's books never share a compendium
with the ACKS ones. What proves it is where documents actually LAND and whether
a second run still finds them — a check that only reads `lineOf` proves the
lookup table, not the routing.

### Fixtures

1. Nothing to create up front. This recipe imports, inspects and deletes; the
   packs it creates are part of what is being checked.

### Steps

2. Import a small ACKS book's monsters and a small OSE one (`qd1`) with **no
   `folderId`**. Confirm in the sidebar: `ACKS Cookbook — Actor` holds the ACKS
   creatures, `ACKS Cookbook — Quick Delve — Actor` holds the Quick Delve ones,
   and neither holds the other's. Both packs must be UNLOCKED — a locked pack is
   a library a Judge cannot edit or drag from.
3. Open the OSE pack and confirm the tree: `Quick Delve #1: Milk / Creatures`,
   with the generators under `Templates` if the book has any. Nothing loose at
   the top of the pack — that is the bug this recipe exists for, and it is
   visible at a glance.
4. `api.oseImportAreas("qd1")` with no `folderId`. The adventure sits at the top
   of the book's own folder and its rooms under `Quick Delve #1: Milk / Areas`.
   Two levels, never three.
5. **Import the same book again.** Nothing may be created. This is the check
   that matters most: the presence read and the write have to agree about which
   pack to look in, and a disagreement presents as a full second copy of the
   book rather than as an error.
6. Import `dmb` as well, then run the ACKS "import everything" control. Confirm
   the completion notice names EVERY pack it filled, not just the ACKS one — a
   report naming one shelf sends a Judge to a compendium their Dolmenwood
   creatures are not on.
7. Register a source (`oseRegister`) and type a series into **Series or
   publisher**. Confirm the field offers what the world already shelves, then
   import a block from it: it must land in `ACKS Cookbook — <that series> —
   Actor`, in a folder named after the source. Register a second source with the
   field left BLANK and confirm it lands in `ACKS Cookbook — Your Books — Actor`
   instead — the blank case is the common one and it is the one that used to
   create documents with no folder at all.
8. `api.oseManual()` — type a block with no source and create it. It goes to
   `Your Books`, under `Entered by Hand`. Then send a blocked candidate to the
   hand editor from a registered source's review dialog and confirm THAT one is
   filed with its source's book instead.
9. **Run Remove Imports.** It must count and delete documents in every pack it
   created, not only the ACKS one, and remove the packs themselves. A pack left
   behind holding documents is the failure — the prefix match is what finds
   them, so a pack whose label lost the prefix would survive with its contents.

### Upgrading a world that imported before this

10. Build the pre-upgrade shape on purpose: `git show v4.2.1:scripts/importer/books.mjs`
   has no `line`, so an import from that build put the OSE creatures in `ACKS
   Cookbook — Actor`. Recreate that by creating a few actors in the ACKS Actor
   pack carrying `flags["acks-extras"].cookbook.id` values from `dmb`, then
   import `dmb`. Those entries must be reported as ALREADY PRESENT and no second
   copy created — the reads span every pack, which is what makes "your existing
   world keeps working" true rather than assumed.

### Teardown

11. Remove Imports clears the packs. Confirm the sidebar has no `ACKS Cookbook —
   *` compendium left, and delete any fixture actors made by hand in step 10.
   Filter by `flags["acks-extras"]` — a parallel session's fixtures live in
   the same world.

## Cross-line safety: merging, and batched writes

Two paths treat the library as one game's. Both are unreachable through any
shipped control today — no world Item carries an OSE id, because OSE gear is
embedded on the actor — so both are checked by **building the future shape on
purpose**, the same discipline as a pre-upgrade shape.

### Fixtures

1. An Item on a line's own shelf. Import one ACKS equipment entry, clone its
   full data into a `ACKS Cookbook — <line> — Item` pack under a
   `<line-book>.<something>` cookbook id, keeping the NAME identical. Cloning
   real data rather than inventing it is what makes `sameMaterial` true, which
   is the branch that does the damage.

### Steps

2. Delete the ACKS copy, reload (the name index and the dedup index are session
   caches), and import that same ACKS entry again.
   *Observable:* the line's item keeps its name, its own cookbook id and its
   own book, gains no `merged` array, and the ACKS item is created separately
   in the ACKS pack. A rename or an id rewrite is the failure.
3. **Prove it was a candidate**, or step 2 passes for the wrong reason — an
   item the loop never saw is not an item the guard rejected. In page context,
   `const m = await import("/modules/acks-extras/scripts/importer/cookbook.mjs")`
   gives the pure exports against live `game.packs`: `m.importedDocs("Item")`
   must contain the line's item, `acksExtras.lib.vocab.nameKeys` must return
   the same keys for both names, and `m.lineOf(m.bookOfCookbookId(...))` must
   differ between them.
4. **Batched writes, mixed lines, with a failure in the middle.** Call
   `m.createDocs(Item, [...])` with five documents: ACKS, line, one whose
   `type` is invalid, then ACKS and line again.
   *Observable:* five slots; each holds the document built from ITS input; the
   invalid one is `null` in its own slot; each document is in its line's pack.

   **`createDocuments` does not throw on a document that fails validation — it
   drops it and answers with FEWER documents, in order.** So a result array
   rebuilt by position shifts at the first bad document and every later one
   lands a slot early. This is why the pairing is by cookbook id, and why a
   probe with the bad document in the MIDDLE is the only arrangement that
   catches it: put it last and the misalignment has nothing left to shift.

### Teardown

5. Delete the probes and the line's pack. **Re-import the ACKS entry the
   fixture borrowed** — step 2 deleted the copy the world already held, so the
   library is one document short until it is imported again. Confirm the pack
   is back at its starting count; this is the one place this recipe touches a
   document it did not create, and the reason it must put it back.

## Keyed areas as places

117 numbered rooms across Quick Delves 1-3 and Planar Compass 1-3 import as
`acks-extras.location` actors. Requires the adventure's own PDF connected.

### Fixtures

1. A folder to import into, created for the test and deleted after.

### Steps

2. `api.oseImportAreas("qd1", { folderId })`. Expect **17 rooms plus one
   location for the adventure** — the count matters, because the failure this
   path had was silent: an entry that compiled cleanly and refused at import,
   leaving a book that looked authored and produced nothing.
3. Confirm every room's `system.parentUuid` is the adventure's uuid. Nesting is
   the reason this binds to an actor rather than a journal page; unparented
   rooms are the feature not working, not a cosmetic difference.
4. Open a room and confirm its notes hold the printed text — description AND
   the roster line beneath it ("5 skeletons: Stats on p7, hp 3, 6, 7, 7, 8"),
   closing on the book and page. The words must arrive from the reader's copy,
   never from the cookbook.
5. Check one room's name against the page. The number leads ("2. Statue Hall")
   so the rooms sort as the map is keyed; a title that wrapped onto a second
   line must be whole, not cut at the wrap.
6. Import a book that ships none (`wld1`) and confirm it says so rather than
   inventing rooms.
7. Import the areas twice. The second run must create nothing — neither rooms
   NOR a second adventure beside the first, which is what a book-level id
   (`<book>.adventure`) is for.

### Teardown

7. Delete the folder and every actor in it. Filter what you delete by
   `flags["acks-importer"].ose` — a parallel session's fixtures live in the same
   world, and deleting theirs is the mistake this line exists to prevent.

## The land-travel tables reach a party

Five documents — `survival`, `foraging`, `searching`, `cityTravel`, `flight` —
are read from RR ch. 6 and JJ's settlement chapter, assembled by their binders,
and consumed by acks-extras' travel surfaces. The chain has three joints and
each can fail silently, so walk all three.

**Fixtures:** none in the world; the books on the shelf are the input. The
authoring tools below read the PDFs directly and print book prose — diagnostic
only, never pasted into a repo.

1. **Does the window land where it was meant to?**
   `node tools/importer/dev-try-recipe.mjs <docId> [tableKey]` runs one recipe against
   the real book. Every table should report values and none should read
   `__missing`. When a column box is wrong, measure it rather than guessing:
   `node tools/importer/dev-page-runs.mjs <book> <page> [substring]` prints each run's
   x/y so a `cellColumns` box can be read off the page. A new or moved recipe
   also passes `node tools/importer/test-recipe-pages.mjs`: its `printedPage`
   is the folio its search lands on, and its document's `source.pages` names
   that folio.
2. **Does the binder read what the window caught?**
   `node tools/importer/dev-try-binding.mjs <docId>` runs the recipe and its assembler
   together and prints the engine tables. Check the SHAPES as well as the
   values: a toll that should be a die is a string, a reduction is stored as
   the factor it leaves, and the search ladder's top row has `max: null`.
3. **Does a party actually feel it?** In the world, run
   `game.modules.get("acks-extras").api.importer.cookbookImportTables()` and then, for
   each document, confirm `acksExtras.lib.tables.getDoc(id).tables` holds the
   ENGINE keys and not only the raw `*Prose` ones. Then exercise a derivation:
   `acksExtras.formation.foraging.forageSpec({kind: "water", terrain: "grassland"})`
   should price rather than answer `missing`, and
   `acksExtras.lib.survival.thirstDie()` should return a die.

**What each joint fails like.** A recipe that misses reports `MISS` or empty
values. A binder that misses assembles fewer tables than the document has —
the count printed by `dev-try-binding` is the check. A consumption failure
shows as a derivation answering `{ok: false, missing: "<table>"}` while the
document is present, which almost always means the engine reads a key
`expectTables` does not declare — `validate-extra.mjs` in acks-extras gates
exactly that.

The `conditions` document (RR Appendix B) walks the same first two joints. Its
third is step 10 of docs/lib/TESTING.md, "Conditions on the palette and on a
roll".

**Teardown:** none. Importing tables registers world ruledata; re-running is
idempotent and no documents are created.

## The hit-point floor and the post-9th rates import

**Fixtures.** None beyond a connected Revised Rulebook and Judges Journal.

**Steps.**
1. Re-read the rules tables (Reimport One Shelf → Rules tables) with both
   books connected.
2. In the console, read the registered `hitPoints` ruledata document and the
   `acks.classBuilder` budget.

**Observable.** `hitPoints.tables.firstLevel.dieMinimum` is a whole number, and
`budget.hpAfterNine` carries both chassis rates. Both come from the seat's own
books; neither is in the module.

**Note for the tester.** The rules-table documents are deleted by the *Remove
ALL Imports* sweep — do not run that between step 1 and step 2.

**Teardown.** None; the documents are the deliverable.

## Printed short forms resolve (Art/Craft, Fighting Style Spec.)

**Fixtures.** Classes imported with their templates.

**Steps — delete and re-import, not Update Classes.** Update rewrites a class
from the same binder, so it exercises the same code; but only a CREATE runs the
whole path a Judge's first import runs, and derives run on create only. Delete
every imported class document, then run Import Classes.

1. Count the classes in the importer's Item pack, then delete them all.
2. Run Import Classes. It re-creates them and re-materializes their template
   packages — allow a few minutes; the packages are the slow half.
3. Sum `system.unresolvedProfs` across every class, and count which resolve
   `def.prof.artCraft`, `def.prof.fightingStyleSpecialization`,
   `def.prof.dungeonbashingExpertise`, and which still bind
   `def.skill.climbing`.

**Observable.** `unresolvedProfs` is EMPTY on every class — the total across all
thirty-one is zero. No class binds `def.skill.climbing`; seven carry
`def.prof.climbing`. Nineteen resolve `def.prof.fightingStyleSpecialization`,
eleven `def.prof.dungeonbashingExpertise`, five `def.prof.artCraft` — the last
three through authored aliases for the short forms the books also print.

A non-zero total means a list's box has drifted onto the prose printed beside
it: run `node tools/importer/dev-proflists.mjs` offline, which names the class and shows
the welded strings, and `node tools/importer/dev-proflist-names.mjs <id>` for the whole
parsed list of one. The box is bounded per class in the register
(`class.profList` `x0`/`x1`/`y1`).

**The non-obvious drive mechanic.** A class already in the world does NOT change
when you re-run Import Classes — that path skips a class the world holds. Use
*Update Classes*, or delete the class and re-import it. Derives run on CREATE
only; this is the fact a tester otherwise reports as "the fix did not land".

**Teardown.** None.

## A class awards every power its spread prints

**Offline first — this is the gate.** `node tools/importer/dev-award-scan.mjs` reads
every class's own pages through the shipping extractor and reports each printed
run-in label that no award ref accounts for. **A clean run is zero across all
thirty-one classes**; anything else is a power the class will import without,
silently. Run it after authoring or editing any class, not only when a report
arrives — a missing award is invisible on the sheet, which is why eight classes
carried the same defect for a whole line.

A label that names something the reader PICKS or ROLLS is not an award and is
listed per class in the tool's `OPTIONS`. Adding to that list is a ruling: read
the paragraph before deciding, and record it in DECISIONS.

**Fixtures.** The affected classes, imported. Books connected: the class's own
book plus RR and JJ, since a dwarven class awards powers all three print. Use
`acksExtras.importer.importClasses()` to import them.

**Steps — delete and re-import.** Derives run on CREATE only, so *Update
Classes* does not re-run the binder; the awards of a class already in the world
never change.

1. Record each target class's level-1 award refs, then delete those class
   documents from the importer's Item pack.
2. `acksExtras.importer.importClasses()` — it re-creates only what is missing.
3. Diff the level-1 refs against what you recorded.

**Observable.** Every expected ref is ADDED and none is LOST; `unresolvedProfs`
stays empty; the class still carries its description, its levels, its ladders
and its templates, which is what proves the book was read rather than a
name-only class written. On the class sheet's **Awards** tab each new row shows
by the definition's own name — the Excavator reads "Caving", "Loadbearing",
"Labor" — with the printed class-power name in the award's note.

**A power new to the register needs its own check.** `acksExtras.importer` has no
by-id ability import on the public API (`cookbookImportIds` is the ACTOR path
and silently imports nothing for a `def.power.*`), so import it through the
module directly:

```js
const mod = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
await mod.importAbility("def.power.linguistics");
```

*Observable:* the item's description is the whole printed paragraph and stops
where the paragraph stops. A description carrying the class's progression or
saving-throw table means the run-in reached the foot of its last column and
continued overleaf — bound it with `assists.descStopY` in the register, a few
points below the last printed line.

**Teardown.** Delete the ability items the check created. The re-imported
classes are restored world state and stay.

## Every imported item wears its own icon

The register carries one `icon` per entry and each kind draws from its own
visual family; the compiled cookbook is what the runtime reads, so a register
edit that was never compiled shows as the old picture and nothing else.

### Fixtures

Items you import and then delete. Do not run this against a world's existing
library: those documents were created before the icons changed and are supposed
to look old.

### Steps

1. Offline first, in the repo: `npm run icons` must report every kind fully
   placed, and `node tools/importer/check-cookbook-drift.mjs` must report none — drift
   means the register was edited without recompiling, and the seat cannot see a
   register edit at all.
2. In the world, import three families whose registers differ most. There is no
   by-shelf import for proficiencies on the public API (`cookbookImportAbilities`
   opens a dialog and blocks a scripted run), so take one ability by id:

   ```js
   await acksExtras.importer.importAbility("def.prof.alchemy");   // ACKS pictogram
   await acksExtras.importer.importClasses();                     // banners
   await acksExtras.importer.importAllEquipment();                // painted objects
   ```

3. Read the three shelves in the importer's Item compendium together, or count
   from the index:

   ```js
   const p = game.packs.filter(x => x.metadata.label === "ACKS Cookbook — Item")[0];
   const rows = [...p.index].filter(e => e.img?.startsWith("icons/svg/"));
   ({ grey: rows.length, sample: rows.slice(0, 5).map(e => e.name) });
   ```

   `acksExtras.importer.importEquipment()` covers a narrower set than `acksExtras.importer.importAllEquipment()` — a
   structure or a BTA good deleted before the run comes back only from the
   latter, which is the call to use when checking coverage.

**Observable.** A proficiency is a flat white-on-black pictogram, a class is a
coloured banner, equipment is painted objects — three families a reader
separates without reading a name. Nothing this run created carries an
`icons/svg/` path. Rows that DO are older documents; that is correct, see below.

4. Import one monster and open it. Its embedded attacks, and any spoils, carry
   painted defaults rather than grey ones — those are minted from the page and
   have no entry to take an icon from, so they read `DEFAULT_IMG` in
   `scripts/constants.mjs`.

**An item's picture is written once, at creation.** Nothing rewrites it
afterwards — `acksExtras.importer.cookbookUpdateAbilities` rewrites the descriptor, the extras and
the cookbook id, and deliberately does not touch `img`. So the repaint path for
an already-imported world is **Reimport One Shelf (GM)**
(`acksExtras.importer.cookbookReimportShelf`), which deletes that shelf and builds it again. Verify
that rather than assuming it: note one old item's `img`, reimport its shelf,
read the `img` back.

**Teardown.** Delete the items and the actor the check imported.

## Points of interest land as places

The chain's `stepPoi` — `acksExtras.importer.cookbookImportPoiPlaces()`, after
the journals. Needs a seat with AX3 connected.

### Fixtures

None of its own. The pass claims under cookbook ids, so the ledger is what the
run REPORTS MADE, read back by those ids the moment it resolves: for each of
the book's `kind.location` entries in a quarter group, plus `ax3.adventure` and
each `ax3.district.<slug>`, the actor whose
`flags["acks-extras"].cookbook.id` is that id, tracked with `api.track`. An
actor the run reports as already held is the world's and stays. The actors
land on the library's Actor shelf — a WORLD compendium (for AX3 the Judge's
Actor shelf, `ACKS Cookbook — Judge — Actor`; find it by label, since the
collection id differs between worlds), so
a read-back that scans only `acks-extras`-packaged packs finds nothing and
leaves the run's documents behind; scan `game.packs` by `documentName`. The
pass also makes the pack folders `<Book> / Places`: delete `Places` once it
holds nothing, and leave the book folder, which other imports share.

### Steps

1. Run the pass on a world holding neither the pages nor the actors.
   *Observable:* under `<Book> / Places`, the city place, one place per quarter
   inside it (`system.parentUuid` is the city's), and one place per keyed point
   inside its quarter, each carrying the page's text as notes with the citation
   last and `cookbook.kind === "kind.location"`. The notification counts what
   was made.
2. Run `cookbookImportJournals()` afterwards.
   *Observable:* no page is written for any of them; every other location page
   the book prints (the organisations' rooms) still lands.
3. Run the pass again.
   *Observable:* "already held", nothing created — presence is asked by id
   before the page is read.
4. On a world that imported the book under an earlier release (pages present),
   run the pass.
   *Observable:* the actors land beside the pages; the pages are untouched.
5. Delete one point's actor and run again.
   *Observable:* that one is rebuilt and nothing else is — the claim cache
   answers for a deleted document only if invalidation is broken.

### Teardown

`api.sweepTracked()` over the ids read back; the pages, where the world had
them, are the world's.

## An adventure's keyed areas land as places

The same step, `cookbookImportPoiPlaces({ books: ["ax1"] })`, on AX1: every
keyed area and key space is a place inside the place its row names, and a
room's stat lines are its roster. Sections 2 and 2b of
`tools/live/importer-ax1.mjs` walk it. The cookbook's own rows (`cookbook/ax1.json`) say what each
place should be: the keyed rows are the `kind.location` rows with a
`meta.space`, and the rows a `meta.space` names; a room's printed occupants
are its `occupants.<i>.name` fields. Nothing of the page is read to check it.
AX1's region sites (`meta.group` "Region — Sites") ride the same step: each
is a place inside `ax1.region`, or binds onto the AX3 site its pair names.

### Fixtures

- AX1 connected on the GM seat, and the library's creatures of the other books
  imported (MM's), so a room has another book's creature to link to.
- AX1's people and creatures (its `kind.npc` and `kind.monsterLegacy` rows),
  imported by id with `cookbookImportIds` where the library lacks them, as
  Import Everything does before the places step. Read each back under its id
  and track it, with the ability definitions the import supplied on demand.
- Nothing under an AX1 place id: no actor claimed under a keyed row's or a
  site's id, `ax1.adventure` or `ax1.region`, and no creature under
  `ax1.<place>-o<i>`. Where one stands,
  it is its owner's, and the walk stops unless the owner says to rebuild
  (`HELD_OK=1`): the held ones are deleted and the step makes them again as
  the owner's.
- The step's own result is the ledger: track `created.places` (the book's own
  place and the region's are among them) and `created.creatures`.

### Steps

1. Run the step.
   *Observable:*
   - `made` is the number of keyed rows and sites less those whose pair's
     place the library holds ("A place two books print", below),
     `created.places` two more, `paired` the pairs it bound, and nothing
     refused;
   - each keyed row and site is one place, and its `system.parentUuid` is the
     uuid of the place under the row's `meta.parent`, else its `meta.space`,
     else `ax1.adventure`; a site's is `ax1.region`'s, which sits in nothing.
     A pair's place stays inside the place its own book put it in;
   - a room has a roster exactly when its row prints an occupant, never more
     rows than it prints, every row hidden, and `rostered` counts them;
   - each row's link resolves and is no world copy. Among the rows are a
     creature of another book, a creature of AX1's own rows, and a creature
     made from its room's line, claimed under `<room>-o<i>` and linked from
     that room; `creatures` counts what was made;
   - a creature's row has a whole-number quantity, and some carry their hit
     points in the notes;
   - a row linking a person of the book stands at quantity 1 with no notes.
     AX1's rooms print no person's stat line (its people are mentioned in the
     prose, which makes no row), so on AX1 the walk notes this as not reached.
2. Delete two rooms, one that holds others and one that links a creature made
   from its line, then run the step again.
   *Observable:* `made` is 2, `already` is every other keyed row and site,
   and no creature is made. Each room stands again under its id, a new document,
   inside the place its row names. The rooms inside the first name its new
   uuid. The second's roster links the same line creatures as before. Track
   the new rooms from `created.places`; the deleted ones read as missing in
   the sweep.
3. Run `cookbookImportJournals({ books: ["ax1"] })`.
   *Observable:* no page is made or refreshed. A journal an earlier release
   wrote for these rooms is still there.

The Adventure that carries these places is step 3 of the AX1 walk ("A book
lands in the library as one Adventure").

### Teardown

`api.sweepTracked()`. Under `HELD_OK` the rebuilt places are the owner's and
are not tracked. Where the walk rebuilt the owner's AX1 Adventure over the
swept documents, run the Adventure step once more after the sweep, so it
carries only what the library still holds. Delete a shelf the run opened only
when it is empty.

## A place two books print

One place in either order: AX1's first level (`ax1.l1`, `meta.sameAs`) and
the AX3 region site it is, and five of AX1's region sites and the AX3 sites
they are. `tools/live/importer-ax1.mjs` walks the bind in
section 2, the world copy in 2c and 3b, and the takeover in 2d. A check
compares ids, block order and paragraph counts; a name and a region are
compared page-side and only the boolean leaves the page.

### Fixtures

- AX3's region places in the library, imported by the owner. The pair's later
  place and its world copy are the owner's: no delete list may name them,
  which is why each list keys on a document's own id, never a merged one.
- AX3 connected on the GM seat (`remember: false`) for the takeover, where the
  walk connects it from `ACKS_TEST_BOOKS`.
- The takeover deletes the owner's AX3 place, so it runs only on the owner's
  go-ahead (`HELD_OK=1` with `TAKEOVER_OK=1`), and only for the pairs
  `TAKEOVER` names (AX1 row ids, comma-separated; `ax1.l1` by default). The
  go-ahead covers the places it was given for and no other.

### Steps

1. Run AX1's places step with the AX3 places held.
   *Observable:* `paired` counts the pairs whose AX3 place stands, and no
   AX1 row of theirs is made. Each AX3 place keeps its own id and parent,
   `merged` holds the AX1 id, its blocks read `[<AX3 id>, <AX1 id>]`, and
   AX1's block holds as many paragraphs as the pair's `unique` lists. Level
   1's rooms sit in its place. A second run counts each `already`.
2. Run the maps step with an AX3 world copy of the place standing.
   *Observable:* the copy, under the library document's id, is restamped to
   answer `ax1.l1` and is not in `created.actors`; level 1's plan links it, and
   its pins sit in it.
3. Write AX1's Adventure and press its sheet's Import with the copy standing.
   *Observable:* the Adventure carries the place, its parent the library's AX3
   region place; the import creates every other place it brings and leaves the
   copy held.
4. Delete each AX3 place `TAKEOVER` covers, run AX1's places step, then
   `cookbookImportPoiPlaces({ books: ["ax3"], ids: [<their AX3 ids>] })`; on
   the default, `ax3.site27`.
   *Observable:* the first run makes `ax1.l1` as its own place, nothing else,
   and moves its rooms onto it. The second's `paired` is 1 and `made` 0: the
   same document now stands as `ax3.site27` with the id, book, merged ids,
   blocks and paragraph counts, parent, name and region step 1 left. The rooms
   still sit in it, a third run makes nothing, and the world copy under the
   deleted id still answers for both rows.
5. Rebuild AX1's Adventure.
   *Observable:* it carries every AX1 place again. AX3's own Adventure still
   carries the deleted document's id until it is rebuilt; report it as stale.

### Teardown

Nothing the pair touches is swept: the place left standing and its copy are
the owner's. Report each write to them.

## A plan is the place it draws

A scene recipe that names a place (`scene.place`) is that place's plan, and
its `places` pin the areas inside it. On AX1 every map is one but the
region's, which names no place: it is `ax1.region`'s map, and stands the
fort, the first level and the sites on their hexes. The fort's overview
(`ax1.fortMap`) is a hex plan too, its pins on the circled keys and not on
cell centres; `ax1.fort10Map` and `ax1.fort15-17Map` are the pictures of
`ax1.fort9Map` and `ax1.fort14Map` standing no pins. Sections 2c and 3b of
`tools/live/importer-ax1.mjs` walk it, once section 2 has put AX1's places in
the library. The recipes in `cookbook/ax1.json` say which plan is whose and
what each pins; nothing of the page is read to check it.

What a scripted walk meets:

- A map is never reshaped once made, so a plan made before the library held
  its places, or before its recipe carried pins, has none. Delete it and run
  the maps step again.
- The places a plan brings into the world are world copies: the maps step
  lists them in `created.actors`, beside `created.scenes` and
  `created.folders`.
- Run the empty-location prune dry (location TESTING step 20). A real sweep
  deletes every empty place in the shared world, a peer's included.
- A shot of the canvas holds the book's art. Hide `#interface` before taking
  it, which also keeps the players list and its user names out of frame, and
  `#pause`, whose banner sits over the token the frame is centred on. Keep
  the PNG in the local log directory.
- A pin cannot be read on a plan as it stands: a hidden place token is a
  half-alpha white icon on a white floor, lost at the plan's darkness and in
  daylight seen only where it greys a printed glyph. The walk's `frameToken`
  relights the GM's canvas alone and tints every pin red for the shot, with no
  document written; `showInterface` restores both from the scene's stored
  darkness.
- Sweep a ledger the places step has filled a chunk at a time. One page-side
  call over a few hundred library documents outlives the driver's evaluate
  timeout, and the call it gives up on goes on deleting with nobody reading
  its result.

### Fixtures

- AX1's places in the library ("An adventure's keyed areas land as places").
- No AX1 map in the world and no world copy of an AX1 place. Where the walk
  made them earlier, it deletes them; under `HELD_OK` they are the owner's,
  and what the steps make in their place is the owner's too.
- Two empty places, the second inside the first, made with `api.create`.

### Steps

1. Run the maps step, `cookbookImportScenes({ books: ["ax1"] })`.
   *Observable:*
   - every AX1 map is made, and `missing` is 0;
   - each plan's scene is linked to its place's world copy
     (`flags.acks-extras.location`) and named as that place is;
   - its battlemap flag's `mapSystem` is `delve`, and the region map's is
     `journey`;
   - it stands one hidden token per pin, in the recipe's order, each the world
     copy of the area it pins;
   - each token on the region map is within 2 px of a cell centre of the
     scene's own grid (the walk's `pinsOnCells`, which measures from the
     token's centre with `scene.grid.getCenterPoint`). The pins are set at
     the drawn hexes' centres, so a larger miss is a grid that does not lie
     on the drawn cells;
   - the world's AX1 places are exactly the plans' places, their pins and
     every place those sit in, up to `ax1.adventure`, or `ax1.region` for a
     site. Each sits in the world copy of the place its row names, and
     `ax1.adventure` and `ax1.region` in nothing. None but a pair's place
     names a library uuid;
   - the step lays every AX1 zone, and refuses none. Each level's plan carries
     its level's zone once, drawn on the Regions layer alone (a fill over
     the whole plan would hide it), its list the level's table where the
     library holds it, and its target, interval and dungeon
     level within the encounter zone's schema. The walk logs the figures;
     check them against the page by eye;
   - framed on its first pin, relit and tinted, each plan that stands pins
     shows a red pin on the key or letter its page prints. An entry keyed to a
     range pins its first key, and a lettered cell with no entry of its own
     carries none. A block plan shows its drawn squares under the scene's
     grid. The region map, framed the same way at half scale, shows each pin
     in the middle of its hex, and the drawn hex lines under the scene's grid;
     the fort's overview, at half scale, shows its drawn hexes under the grid
     and each pin on its circled key;
   - each plate of storeys (`ax1.fort1Map`, `ax1.fort2-3Map`,
     `ax1.fort5-8Map`) holds a level per storey, each its own picture, each
     starting where the one below it ends. Viewed at its top storey, the
     shot shows that storey's drawing under the grid, its stairs where the
     storey below drew them; every other plan holds core's one level.
2. Run the prune dry.
   *Observable:* its `doomed` holds none of AX1's world places, though a
   section holds no goods, roster or token. It holds both empty fixtures.
3. Run the Adventure step, so the Adventure carries the plans as they now
   stand. Then delete every world AX1 place and every plan but the one with
   fewest pins among those that stand any, so the check on its pins can
   fail. Open
   AX1's Adventure from the library, and press its sheet's
   **Import**. Read what was created from core's `importAdventure` hook.
   *Observable:*
   - the Adventure carries each plan with a token per pin, and each level's
     zone on its plan;
   - the import creates each plan it was handed, linked to its place's new
     copy and standing its pins and its zone as step 1 laid it;
   - the places it creates are exactly step 1's set;
   - every created place sits in a created place, and `ax1.adventure` in
     nothing;
   - the plan the import held names its place's new copy and still stands
     its pins;
   - a dry prune holds none of them.

### Teardown

`api.sweepTracked()`: the fixtures, and, outside `HELD_OK`, every map, copy
and folder the steps and the import made. Under `HELD_OK` the owner keeps
the plans and places the import made.

## Organisations land as factions

The organisations step (`cookbookImportFactions`, the chain's `stepFactions`)
binds a settlement book's authored `kind.organisation` rows as
`acks-extras.faction` actors, each seated at the keyed place its row names,
rostering the people the row names. A person's group heading is NOT read for
membership — a body's quarry is printed under the same heading as its members
(importer DECISIONS, "A body becomes a faction one way"). The sub-type needs a
world launched with the module carrying it (`docs/factions/TESTING.md`).

### Fixtures

- AX3 connected in the importer; the actor step run first, so the people
  exist to roster. Track every id the step reads back, and the district and
  city places it makes when the POI step has not run.

### Steps

1. Run the organisations step.
   *Observable:* one faction per authored row on the book's Factions shelf,
   each named as its page prints it, seated at the place its row names, kind
   as the row states it (never all `other`); the notification counts them.
2. Open a body whose row marks a member hidden.
   *Observable:* that member is on the Members tab marked hidden, and the
   others are not. Then join as the Player seat: the hidden row is not shown
   and the rest are. A roster that shows every member alike means `hidden`
   was dropped between the row and `occupantRow`.
3. Open a body printed on a page that also lists people it is contracted
   against.
   *Observable:* its roster holds its members only. If a target of its
   contracts is rostered as a member, the group heading is being read again.
4. Run it again.
   *Observable:* "already held", nothing created, nobody rostered twice.
5. Delete one faction and run again.
   *Observable:* that one is rebuilt with its roster; the others are held.
6. Run it before the actor step on a fresh world.
   *Observable:* the factions are made with empty rosters and the
   notification says how many members are not yet imported; the actor step
   and a second run fill them.
7. The strength grids the step reads after the relations: `docs/factions/
   TESTING.md` step 14 (the figures, the total-row check, the seven-order
   grid's split, "kept their figures" on a second run). Where the world
   already holds the book's factions from another session, the write cannot
   be exercised without writing to documents that are not the run's; the
   executor half is drivable on the run's own faction instead — execute the
   grid entries in page context (`executeEntry` on the staged book), build
   with `strengthFromGrid`, write the block to a tracked fixture, and read it
   back — which is what the 2026-09-30 walk did.

### Teardown

`api.sweepTracked()` over the ids read back — the factions, and the places
only when this run made them.

## A book lands in the library as one Adventure

The chain's `stepAdventures`, `acksExtras.importer.cookbookImportAdventures()`,
is the last step of Import Everything. The walk needs the GM seat with AX3
connected and the map step already run, so the world holds AX3's maps. Step 9
also needs the Player seat. The Adventure sheet's own **Import** button is
the real trigger for steps 6 to 8. A scripted `adventure.import()` proves the
hook and not the sheet, so script it only to read back.
`tools/live/importer-adventure.mjs` walks it. `tools/live/importer-ax1.mjs`
walks the places case on AX1: its Adventure carries every AX1 place, each in
the carried place its row names in world form, and each roster row names a
carried person or creature in world form or another book's creature where the
library holds it. What an import of it brings is "A plan is the place it
draws", step 3.

What a scripted walk meets:

- The step writes every open Judge book, AX3 among them. After `ready` the
  GM seat reopens the books it remembers one at a time. Let the open set
  settle before reading anything, read the shelf of every Judge book (open
  or not) before step 1, and judge each run by AX3's outcome alone.
- The sheet that opens is core's V1 `AdventureImporter`. Its `element` is a
  jQuery wrapper, so find the Import button under `element[0]`. Check
  whether `element.querySelector` exists before indexing: a V2 sheet's
  element is the `<form>` itself, and its `[0]` is the form's first control.
- A run that should hold, but rebuilds another book, prints the key paths
  that moved in that book's Adventure. That is how an assembly that is not
  stable from one run to the next shows up.
- A document the import brings back can arrive with the Folder it is filed
  in. That Folder is in the import's own result too, so track both.

### Fixtures

Read first, write nothing:

- the world scenes whose `cookbook.book` is `ax3`;
- the line's Adventure shelf, found by label (`ACKS Cookbook — Judge —
  Adventure`);
- that shelf's index, read with `flags.acks-extras.cookbook`.

Note any row with `kind.bookAdventure` and `book: "ax3"`, and any with
`kind.settlementAdventure`. The step writes over the first and deletes the
second. When the shelf holds either and this run did not make it, get its
owner's go-ahead before step 1 (the walk's `SHELF_OK=1`). Then:

- Keep every Adventure id the shelves hold before the run. Step 5 deletes the
  owner's AX3 Adventure, and the step writes it again under the same id and
  lists it in `created.adventures`. Never track an id from that set.
- Step 1 reads `rebuilt` rather than `written`: the carried fixture makes the
  owner's Adventure stale.
- After the sweep, run the step once more. The owner's Adventure still
  carries the swept fixture Item, and that run rebuilds it from the world as
  it stands. Track and sweep anything that run writes afresh.

**The pre-upgrade shape.** Where the shelf holds no per-map Adventure of
AX3, make one. The shape is the stamp the per-map step wrote (`git show
v11.5.1:scripts/importer/cookbook.mjs`, `settlementAdventureSource`). Create
`Adventure.create({ name, flags: { "acks-extras": { cookbook: { id:
"ax3.cityMap.adventure", book: "ax3", kind: "kind.settlementAdventure",
scene: "ax3.cityMap" } } } }, { pack: shelf.collection })` and `api.track`
it.

**A carried source of your own.** Make one world Item stamped `{ id:
"ax3.fixture~<salt>", book: "ax3" }` and track it. Steps 4 and 5 change what
the Adventure carries through it, and through nothing else.

The run's own ledger is what the step RETURNS. Pass `created.adventures` to
`api.track`. `created.packs` names a shelf this run made; at teardown, delete
it by that collection id, and only if its index is empty by then.

### Steps

1. `const c = await api.cookbookImportAdventures()`.
   *Observable:*
   - `c.books.ax3 === "written"`, and the notification says so;
   - `c.retired` names the per-map Adventure;
   - the shelf's index has a row under `bookAdventureId("ax3")` and no
     `kind.settlementAdventure` row of AX3;
   - the shelf is Judge-owned and filed under the line.
2. Probe it with `const o = (await pack.getDocument(id)).toObject()`.
   *Observable:*
   - `o.flags["acks-extras"].cookbook.contents` counts what `o` holds;
   - `o.scenes` follows the recipes' page order. Each scene's `_id`, and
     every region and token id, is the held world scene's;
   - the region map's `grid.size` is its recipe's `grid.pixels`;
   - a zone the world laid over a map is among that scene's regions, and its
     list is in `o.tables`. Where the world map's picture corner
     (`dimensions.sceneX/Y`) differs from the Adventure scene's, as on a map
     made before grid maps carried `GRID_SCENE_PADDING`, each zone polygon is
     moved by the difference and its centroid lies in the cell its
     `zoneHexes` names on the Adventure scene's lattice;
   - tokens are all hidden; `active` and `navigation` are false; `thumb` is
     null;
   - every carried document has `ownership.default === 0`;
   - the fixture Item is in `o.items`;
   - every journal the book's import made is in `o.journal`, its
     `cookbook.id` the one `journalCookbookId` gives its group;
   - every folder a carried document names is in `o.folders`;
   - after a reload, `o.actors.length` still equals the count. Core empties
     an Adventure's actors silently when its pack lacks `metadata.system`.
3. Run the step again.
   *Observable:* `c.books.ax3 === "held"`; nothing is retired; every
   `created` list is empty; the Adventure's `_stats.modifiedTime` is
   unchanged.
4. Rename the fixture Item, then run the step.
   *Observable:* `"rebuilt"`, under the same id; `o.items` carries the new
   name.
5. Wait out `WRITE_SLACK_MS` from the last write. Edit the Adventure's
   description on its sheet and save. Run the step.
   *Observable:* `"kept"`, and the edit stands. Delete the Adventure, then
   run the step again: `"written"`, under the same id.
6. Arm a createActor/createScene/createRollTable/createFolder OBSERVER. Open
   the Adventure and click Import.
   *Observable:* no overwrite dialog. Either "…nothing was added…", or the
   documents the world lacked are added. Pass every uuid the import created
   (from `Hooks.once("importAdventure", (a, o, created) => …)`, this call's
   own result) to `api.track`. The observer holds nothing else of this
   run's.
7. Delete the fixture Item from the world, and import again.
   *Observable:* the Item comes back under its id, or stays in the library
   when the library holds it (counted as left in the library).
8. Empty the library's shelves with core's own `clear()` on each
   (`for (const p of game.packs) if (p.documentName !== "Adventure" &&
   isLibraryPack(p.collection)) p.clear()`, the call core's idle eviction
   makes five minutes after a shelf's last read), confirm `libraryCold()`,
   and click Import.
   *Observable:* "…loading this world's library first…", then the import
   runs to its hook and creates what step 6 would, with no world copy of a
   library document. importer-ax1 walks this at 3b and 3c. The refusal of a
   shelf that never loads ("…the library is still loading…") is pinned
   offline.
9. Join as the Player seat.
   *Observable:* no Adventure shelf in the Compendium tab.
10. Open the Books window on the GM seat.
    *Observable:* the AX3 row reads "In the library as one Adventure:", with
    the stamp's counts and no per-map line.

The fill's own cases (a deleted map or place coming back under its id, a
twin pointed at, people kept in the library) are pinned offline by
`tools/importer/test-book-adventure.mjs`. A live walk needs only the cases
above.

### Teardown

1. Run `api.sweepTracked()` over the world documents.
2. Delete the Adventure and the pre-upgrade fixture page-side, by id
   (`pageSweep`).
3. Delete a shelf `created.packs` names, only if its index is empty.
4. Quote the sweep result.

## A person the page prints in full becomes a character

The rows are AX1's `kind.npc` rows carrying `meta.actor: "character"` and its
`kind.pregen` rows, and `acksExtras.importer.cookbookImportIds(ids)` imports
them. The walk needs the GM seat with AX1 connected and the library holding
the core books' classes. Some pregens print a class no core book defines;
the walk reads which against the library, so a Judge who has built one with
the class builder sees it bound. Steps 3 and 4 also need the Player seat.
`tools/live/importer-characters.mjs` walks steps 1 to 4; `ROWS=people` or
`ROWS=pregens` limits it to one set.

What a scripted walk meets:

- The import's count says how many it made, not which. Read each character
  back under `stableDocId(<cookbook id>)` from every world Actor shelf, and
  track that uuid.
- The import also supplies, on demand, every ability definition a character
  needs that the library lacks. It reports none of them. Take the library's
  ability ids before the import; afterwards, every id a made character embeds
  that was not among them is one it supplied. Read each back under its id,
  and track it.
- A rebuild keeps the id, so the tracked uuid covers the rebuilt document
  too. Tell the two apart by `_stats.createdTime`; wait a second before the
  rebuild so the times can differ.
- The rebuild is the entry picker's (`cookbookReimportEntries()`), two
  DialogV2 windows. Tick `input[name="sel"][value="Monsters|<id>"]`, press
  the prompt's `ok`, then the confirm's `yes`. The promise the picker
  returned resolves once the rebuild's import is done.
- An imported figure is compared with the page in page context, against
  `executeEntry` on the open book. Print booleans, never the figures.

### Fixtures

Every step is setup, and nothing the walk makes is kept: what it makes is
what the next import's presence check needs absent (DECISIONS, 2026-10-28).
First retire `importer/claimant` (`api.retire`), the claimant a run that died
before its sweep left standing.

Then read, write nothing: every world Actor shelf and the world, for a
document under any row's stable id. Where one stands and this run did not
make it, stop: it is another session's. The one exception is a library its
owner imported and handed over (the walk's `REBUILD_OK=1`), holding every
row once. Step 1 then rebuilds all of them through the entry picker, ticking
every row. Each keeps its id, so read each one's `_stats.createdTime` before
and after, and track none of them. Where a library stands for one set
only, `ROWS=` walks the other set beside it.

- The rebuild's fixture is a world `character` claiming the first row's
  entry (`flags.acks-extras.cookbook: {id, book: "ax1", kind: "kind.npc"}`),
  with OWNER for the Player seat's user. Make it with `api.fixture` under
  `importer/claimant`; it is built every run.

### Steps

1. Import every character row.
   *Observable:* the count is the row count, and each stands under its
   stable id. Each is a `character` carrying its entry's stamp. A class the
   library answers (`matchClass`, whole or behind a qualifier) is bound at the
   printed level, and the saves are what `classUpdateData` derives. A class
   read behind a qualifier has a "Class read as" row naming the bound class.
   A class the library lacks is held by none, and has a "Not in the library"
   row naming it. Its scores, hit points and alignment
   are the page's. Its morale is the page's, clamped to the schema's bounds.
   Its biography holds one
   `.acks-extras-importer-as-printed` block, stamped with the entry id, with
   at least `1 + differences + missing` lines (`flags.acks-extras.printed`).
   Its ownership is the Judges' alone. No chat card was posted, and a
   `createActor` observer saw no actor beyond these. A pregen's stamp names
   `kind.pregen`, and it is filed in the book's `Pregenerated` folder.
2. Rebuild the first row through the entry picker.
   *Observable:* a document stands under the same id with a later
   `createdTime`. The player-owned fixture still exists.
3. Join as the Player seat.
   *Observable:* the shelf holding the characters is not visible in the
   Compendium tab.
4. Hand a pregen out. On the GM seat, the compendium entry's **Import**
   (`game.actors.importFromCompendium(pack, id, {}, {clearOwnership: false})`,
   the options core's context menu passes), then OWNER for the Player seat's
   user. Track the copy's uuid. Rebuild the same entry through the entry
   picker.
   *Observable:* the copy is a world `character` whose stamp still claims the
   pregen's entry. After the rebuild the library's pregen stands under the
   same id with a later `createdTime`, and the player's copy still exists. On
   the Player seat the copy `isOwner`, and its sheet renders.

Remove Imports' guard is not walked: it deletes every session's imports.
`playerOwned` is pinned offline (`test-character-binding.mjs`), and the
filter beside it is read in the code.

### Teardown

1. Run `api.sweepTracked()`: the characters, the claimant and the handed-out
   copy, all of them setup.
2. Delete a shelf this run opened, only if its index is empty.
3. Quote the sweep result.

## The city-travel recipe assembles the business prose

The city-travel tables recipe (`cityTravel`, AX3 p. 56) includes two optional
prose windows: the first reads a grid of what a gate pass costs per load stone,
the second reads what the syndicate's smuggling service charges and what risk it
carries. Both are printed values and arrive through import.

1. With AX3 connected, run `node tools/importer/dev-try-binding.mjs cityTravel`.
   *Observable:* the output prints every assembled table's keys. Look for
   `gateTolls` and `smuggling` in the output; both are present or both are absent
   (the two windows are on the same page, so a box error removes both). The
   output prints keys and prose windows only — never the values themselves, since
   every figure is printed. *Names only.* Confirm the values read back through
   the import: `acksExtras.lib.tables.getDoc("cityTravel").tables` must hold
   both `gateTolls` and `smuggling` keys after `cookbookImportTables()`.

## Points of interest: roles written on held places

The points-of-interest step writes a role to any place whose `kind.location`
row in the book carries a role designation. On a world that already holds the
book's places with blank roles, the step stamps the role without reading the
page and counts "given a role" in its report.

1. Manually create a location actor in the world carrying
   `flags["acks-extras"].cookbook.id === "ax3.poiGate"` (a gate POI from the
   book). Set `system.role` to blank. Track it by id. Then run
   `acksExtras.importer.cookbookImportPoiPlaces()`.
   *Observable:* the step reports "N given a role" in its output, and the
   tracked place's `system.role` is now `"gate"` (the role the book's row
   designates). *On a shared test world:* the step skips places another session
   owns; the rule is in `.claude/rules/live-testing.md`, Concurrency —
   never mutate a peer's documents. If a peer session made the places, this step
   reports them as held and nothing is written.
2. Reload the world and confirm the role persists.
   *Observable:* `game.actors.getName(<place>).system.role === "gate"`.

## A region map with zones

A region book's scene recipe carries a `grid`; the map step builds it on
Foundry's lattice of the drawn cells, sets its sites down, and lays every
open book's zone rows over it as encounter-zone Regions (MODEL, "A map on a
grid of drawn cells", "A zone over a map", "A region's places"). The offline
suite `tools/importer/test-region-import.mjs` proves the arithmetic against
a mocked lattice; only a live run proves core's grid answers the same way.

### Fixtures

1. The region book and the zone book connected (`ax3` carries the region
   recipe, `ax5` zones over it), with their compiled rows present: read
   `await foundry.utils.fetchJsonWithTimeout("modules/acks-extras/cookbook/ax3.json")`
   and confirm its `scenes` holds a row with a `scene.grid`, and that the zone
   book's file holds `kind.sceneZone` rows naming it.
2. No scene in the world flagged with the recipe's id
   (`game.scenes.find((s) => s.getFlag("acks-extras", "cookbook")?.id === <recipe id>)`
   is undefined) — otherwise the run holds a peer's map and proves nothing
   about building one. Note every document the steps below create by id as it
   is created (`api.track`); nothing is swept by name.

### Steps

3. Run `acksExtras.importer.cookbookImportRollTables()`, then
   `acksExtras.importer.cookbookImportPoiPlaces()`; track what they made by the
   cookbook ids read back.
   *Observable:* one location actor flagged `<book>.region`, its
   `system.notes` holding the overview; a site whose row names a market has
   written its notes and `parentUuid` (the region place) onto the place
   flagged `<book>.mkt<n>`, and no actor is flagged with that site's own id; a
   site marked `place: "adventure"` likewise onto `<book>.adventure`.
   In a world that already holds the book's places (another session's
   import), the places step binds sites onto them — parent and role written
   onto documents that are not yours — so run it only in a world whose places
   are this run's. Otherwise stand the region's places in as fixtures: the
   region from `regionPlaceData`, and for each entry of the recipe's `places`
   the builder its claim names (`regionSiteClaim(book, entry, id, entries)`
   answers `site` → `poiLocationData`, `market` → `marketActorData`, or
   `adventure` → the held adventure place, nothing to make), created under
   those ids in one `Actor.createDocuments` and tracked by the uuids it
   returns. The map step then finds a document under every placed site and
   step 7 still holds; the overview and site text are not exercised, and the
   report says so.
4. `const counts = await acksExtras.importer.cookbookImportScenes()`; track
   `counts.created.scenes`, `.actors`, `.folders` and `.regions`.
   *Observable:* `counts.made` includes the region map, `counts.gridRefused`
   is 0; the scene's `grid.size` equals the
   recipe's `grid.pixels`, its `grid.type` is the family's hex type, and its
   battlemap flag says `mapSystem: "journey"` and its cookbook flag carries
   `pixelsPerPoint`. Its `padding` is `GRID_SCENE_PADDING`, and
   `scene.dimensions.sceneRect` lies inside `scene.dimensions.rect`.
5. A drawn hex centre lies under a Foundry hex centre. In the console, with
   `{sceneFrame} = await import("/modules/acks-extras/scripts/importer/scene-binding.mjs")`
   and `pixelsPerPoint` read off the scene's cookbook flag:
   `frame = sceneFrame(recipe, {pixelsPerPoint})`, `[x, y] = frame.toScene(...recipe.grid.centre)`,
   `p = {x: scene.dimensions.sceneX + x, y: scene.dimensions.sceneY + y}`;
   `scene.grid.getCenterPoint(p)` is within a pixel of `p`. Then view the
   scene: Foundry's grid lines lie on the printed hex lines at the far corners
   as well as near the centre (drift toward the edges is a scale fault, an
   even offset everywhere is a shift fault).
6. A Region per zone row over this map:
   `scene.regions.filter((r) => r.getFlag("acks-extras", "cookbook")?.zone)`.
   *Observable:* each carries an `acks-extras.encounterZone` behaviour whose
   `tableUuid` resolves to its row's list, whose target and day and night
   throws match the zone's printed figures on the Judge's own page (compare
   by eye; never copy the figures into a report), and whose shapes cover the
   hexes inside the zone's printed outline. Visible to the GM only.
7. A site token stands on its hex: each hidden token sits on the printed site
   marker, its centre inside the marker's hex; a market-bound site's token is
   the market's place.
8. Run step 4 again. *Observable:* `counts.made` 0, `counts.already` counts the
   map, `counts.zones` 0 and `counts.zonesHeld` counts every zone; the scene's
   Region count is unchanged.

### Teardown

9. Delete by the tracked ids only: the scene (its Regions and tokens go with
   it), the world actors and folders the map step made, then the library
   documents and roll tables steps 3 named. The rendered map picture stays in
   the importer's art folder and is reused by the next run. The map step
   writes no Adventure; the adventures step's own recipe is "A book lands in
   the library as one Adventure".
   The run writes to no document it did not make: take every flagged
   document's `_stats.modifiedTime` before the run and again after, and
   quote the count that changed (zero), by kind.

## A map's traced walls

A recipe's `walls` block is traced from the seat's own page at import (MODEL,
"A map's walls, traced from the page"). `tools/importer/test-wall-trace.mjs`
proves the tracer on synthetic plans. Only a live run proves three things: the
render reads the real page, the walls land on Foundry's lattice, and they
block what walls block.

### Fixtures

1. A GM-level seat. When the Gamemaster seat is taken, the Assistant
   Gamemaster creates scenes and walls (core's default `ASSISTANT`).
2. The walled recipe's book connected
   (`connectBookUrl(<book>, "acks-test-books/<book>.pdf", { remember: false })`).
   No world scene may be flagged with the recipe's id.
3. A record of what is already there. A pane seat often has every staged book
   open from remembered locations (`api.bookOpen(id)`), so the map step walks
   every open book's recipes and zones. Snapshot each flagged scene's and
   actor's `_stats.modifiedTime` before the run.
4. A console recorder installed before the run: wrap `console.warn`,
   `console.error` and the `acks-extras` logs into a global. The pane's own
   buffer drops the oldest messages.

### Steps

1. `const c = await api.cookbookImportScenes()`. Fire it into a global and
   read it back in a later call: the pane throttles long awaits. Then
   `api.track` (or note by hand) `c.created.scenes` and `c.created.folders`.
   *Observable:*
   - the console logged one `walls traced` digest for the map, with
     `regions: 1` on a grid plan, meaning one connected floor. A contour
     plan's digest quotes `loops`, `islandsDropped` and `doorsDropped`, and
     a stroke plan's `paths`, `spurs`, `boxes`, `windows` and `doorsDropped`;
     `islandsRefused: 0` is the pass, and a refusal means the render drifted
     from the one the recipe was read on. In stroke, so is `unplaced: 0`: a
     cell that names a door's kind and finds no drawn box means the same;
   - `c.walls` equals the digest's `walls + doors + secret + terrain +
     invisible`, and `c.wallsFailed` is 0;
   - the scene's `walls` count the same, split by `door` 0, 1 and 2 and by
     terrain and invisible as the digest splits them;
   - on a grid plan, `padding` is `GRID_SCENE_PADDING`, `sceneRect` lies
     inside `rect`, and so does every wall endpoint and token; the recorder
     holds no "polygon origin is out of the scene bounds" warning. A wall
     cut off at the canvas edge counts in the scene and blocks nothing;
   - every plain wall's and door's senses are 20/20/20/20, every terrain
     wall's light, sight and sound 10 and move 20, every invisible wall's
     light, sight and sound 0 and move 20. On a map of one storey every
     `levels` is empty. On a plan of storeys every wall's `levels` holds
     one id, one of the scene's levels, every level holds walls, and the
     walls per level meet an offline `traceStoreys` run's per-storey counts
     within a wall or two, as the digest does (`ax1.fort1Map`: 59 and 75
     live, 59 and 77 offline);
   - `tokenVision` is true, `fog.mode` is 1 (each user's own), darkness is
     1 and global light is disabled. From the **Player** seat, a token of
     the player's carrying a lit light shows its radius, and the dungeon
     past it is black. A token with no light and no dark sense shows
     nothing. Squares the token has seen stay explored after it moves on.
     The GM seat sees every square whatever the fields say, so this step is
     the Player's. `tools/live/importer-ax1.mjs` walks it on both of AX1's
     levels: `canvas.visibility.testVisibility` reads the lit and unlit
     squares and `canvas.fog.isPointExplored` the explored one.

   Compare the digest with an offline run of the same recipe on a
   reproduction of the importer's render: pdf.js' legacy build on
   @napi-rs/canvas, print intent, a white ground, Rec. 601 gray, scaled to
   `TRACE_PITCH` pixels per grid box. It meets the live counts within a wall
   or two, and a plate render does not (DECISIONS 2026-10-18). A count that
   differs from the reproduction's means the render moved, not the tracer.
2. The walls lie on the lattice. Core's square grid lines run at multiples of
   `grid.size` from the CANVAS origin; `sceneX`/`sceneY` is the shift that
   moves the picture under them, not the lines. A stroke plan's walls run
   along its drawn strokes, which need not sit on the lattice, so step 5's
   pictures check them instead. On a grid plan:
   - every plain wall's endpoints are within the plate's aspect drift (a pixel
     or two) of a multiple of `grid.size`;
   - each door spans its passage cell across the middle, so its endpoints sit
     at half a cell on one axis and on the side walls' lines;
   - a split box is two leaves on its centre line that meet at its bar and
     together span the opening, one pair per `splitBoxes` in the digest;
   - each secret door is a pair, one on each mouth of its cell, both on
     lattice lines.
3. The walls block. View the scene on this client only (`scene.view()`; it
   stays inactive for everyone else), then probe with
   `CONFIG.Canvas.polygonBackends[type].testCollision(a, b, { type, mode: "any" })`,
   where `a` and `b` are 20 px either side of a wall's midpoint along its
   normal. Keep both inside `sceneRect`: sight from inside the scene stops
   at the picture's edge, so a probe that reaches past it collides there and
   not at the wall, as across the outer-wall windows of AX1 p.15 and p.23
   that lie within 20 px of the crop. Where another wall stands within 20 px
   of a terrain side, probe that side at 5 px (p.15's dais, 8 px from a room
   wall).
   *Observable:*
   - `move`, `sight` and `sound` collide across a sample of plain walls, and
     `move` and `sight` across closed doors and secret doors. The sample
     takes a wall on each side of the crop's edge: that is where a picture
     cut off the canvas would lose its walls (AX1 p.15's north wall);
   - across one side of a terrain box `move` collides and `sight` does not;
     from outside, across the box to its far side, `sight` collides;
   - across an invisible wall `move` collides, and `sight` and `sound` do not;
   - at a stroke plan's window, `sight` passes across its invisible segment
     and collides across the flank wall beside it, a quarter cell along;
   - on a plan of storeys, with `level` passed to `testCollision`, `move` and
     `sight` collide across that level's walls and pass across another
     level's where none of this level's crosses the probe;
   - `polygonBackends.sight.create(point, { type: "sight" })` from inside a
     room covers a small share of the scene's area.
4. A door opens by the real gesture: click its control on the canvas.
   *Observable:* `ds` goes 0 → 1, and `move` and `sight` no longer collide
   across it. A second click closes it and they collide again.

   In the pane, the screenshot frame maps onto an emulated viewport unevenly
   (an 800x600 frame over 1400x900 measured x 1.75, y 1.5). Arm a
   capture-phase `pointerdown` listener to read where a click lands, then aim.
   Pan the door clear of the pause banner first.
5. Sight, seen. The pane composites no frame after a pan, so take pictures
   through the capture driver on a free GM-level seat. In its page, hide
   `#interface` and `#pause`, activate the walls layer, and shoot `#board`.
   Then create a fixture actor with `prototypeToken.sight.enabled`, put its
   token in a room, and control it: a GM controlling a token sees only what
   it sees.
   *Observable:*
   - the walls run along the drawn edges;
   - the token sees its room and nothing past the walls.

   These frames show the Judge's page: keep them local, never in the repo.
6. Run the map step again.
   *Observable:* the map counts as already held; `walls` is 0; its wall count
   and `modifiedTime` are unchanged. A held map is never re-traced.
7. Delete the scene (it is yours) and run the step again.
   *Observable:* a new scene with the same wall split; the picture is reused
   from the importer's art folder.

The book's Adventure carries the walls under the world scene's ids
(`withWorldIds`). That is pinned offline. A live walk of it is "A book lands
in the library as one Adventure". On a seat with peers' books open, that
step rewrites their Adventures, so leave it to that walk.

### Teardown

1. Delete by your own ids, newest first, with `pageSweep`'s expression: the
   scenes (their walls go with them), then the folder the run made, then any
   driver fixtures through `api.sweepTracked()`.
2. Re-read the flagged documents' `modifiedTime`, and quote the count that
   changed (zero) and the sweep result.
3. Log the pane out, so the seat is free for the next session.

## A way between maps

The map step joins a book's link rows into Regions after its last zone (MODEL,
"A way between maps"). `test-scene-binding`, `test-register-rules` and
`test-cookbook-coherence` pin the shapes offline. Only a live run proves that
core takes the Regions, that a token is carried where the rows say, and that
the Adventure carries them. `tools/live/importer-ax1.mjs` walks it as section
2e, in 3, 3b and 3c, and after its sweep.

### Fixtures

1. The GM seat and the Player seat, and a character the Player owns.
2. Every map the links name, made by the map step with the places in the
   library, so each Region is named for its place. A map the world held
   before the run is the owner's, made again only under `HELD_OK=1`.
3. Each token of the character on a map, made beside a link end on the GM
   seat and tracked; a token a teleport makes on another map keeps its id
   there, so read each token's uuid back after every hop and track it.

### Steps

1. Read the map step's counts. *Observable:* `links` is the number of
   distinct ends (rows sharing an end count it once; a level row is one), and
   `linksWaiting` and `linksRefused` are 0.
2. Census the Regions flagged `cookbook.link`, reading each destination with
   `fromUuidSync(uuid, {relative: behaviour})`, as core does. *Observable:*
   - one Region per end, GM-only and locked, on its map, with one behaviour;
   - a teleport end on a plan of storeys carries its storey's one level, and
     on any other map none; a level row's Region carries every storey it
     names and holds `changeLevel`;
   - each teleport leads to exactly the ends its rows name. It asks where it
     leads to several (`LINK_ASK.several`), where a row says `confirm`, and
     on the region's map (`LINK_ASK.one`); otherwise it does not ask;
   - no two link Regions on one map share a name.

   Record one stored destination as it stands: it shows the form the
   Adventure carries.
3. Run `cookbookImportLinks()`. *Observable:* `links` 0, `linksHeld` the
   number of ends, `linksRepaired` 0.
4. The DELETE path: delete one end whose partner leads only to it, and run
   the pass again. *Observable:* before the run the partner's destination
   resolves to nothing; after it, `links` 1, `linksRepaired` 1, and step 2's
   census holds again.
5. Hops from the **Player** seat. Drive each with `TokenDocument#move` and
   `constrainOptions: {ignoreWalls: true}`, fired and not awaited: core holds
   a move a question paused until the question is answered. The question is
   a `DialogV2` on the mover's client with the id
   `dialog-<behaviour uuid>-<token id>`. It carries a `destination` select
   when it offers several ends, with options labelled by Region name when
   they share a map, or a `level` select for a change of storey; press
   `button[data-action="yes"]` or `"no"`. A token's `regions` set says which
   ends its middle stands in. *Observable:*
   - walked onto a stair between two plans, the token stands on the other
     plan's stair and none is left behind; walked off that stair and onto it
     again, it is back;
   - walked into one of the ends sharing a way in, it arrives on that way in,
     on its storey, unasked. Walked off it and back on, the Player is asked
     which end; each option's compass word differs, and the token arrives at
     the end picked;
   - walked onto the stair between storeys, the Player is asked which
     storey and the token stands on the stair of the storey picked;
   - on the region's map, walked into a way, the Player is asked first, and
     answered no, the token stays on the region's map.
6. Delete the character's tokens by the uuids read back, so none stands over
   the end it reached. Then frame each end on a walled plan on the GM's
   canvas and shoot `#board`. *Observable, by eye:* the Region lies on its
   drawn way, and the floor beside it is open, since the hops ignore walls.
   These frames show the Judge's page: keep them local.
7. Write the book's Adventure and read its scenes without importing them:
   build each scene as a temporary `Scene` from the Adventure's source, and
   read each destination with `foundry.utils.parseUuid(uuid, {relative:
   behaviour})`. *Observable:* every end once, each teleport leading to as
   many ends as its rows name, and every destination one of the Adventure's
   own Regions.
8. Delete every plan but one and import the Adventure from its sheet ("A
   book lands in the library as one Adventure"). *Observable:* step 2's
   census holds, the plan that stayed included.
9. With the world holding only some of the maps, write the Adventure again
   and repeat step 7's read. *Observable:* the same, though the world holds
   fewer of the ends. The walk does this after its sweep, when the world
   holds only the owner's maps.
10. Import into a world lacking two plans: delete two, the plan of a way
    several ends share and the plan of an end leading into it, and census.
    Both are the run's, or both the owner's under the owner's go-ahead; the
    owner's come back under the Adventure's seeded ids and stay the owner's. *Observable:* every end on them is missing, and each end leading
    into them names nothing. Write the Adventure again (step 7's observable
    holds), import it from its sheet, and run no link pass by hand.
    *Observable:*
    - the import creates the two plans and nothing else, and each plan and
      each end on it stands under the Adventure's seeded id
      (`stableDocId` of `<map>.adventure|scene` and
      `<map>.adventure|link|<end key>`, `adventure-binding.mjs`);
    - step 2's census holds once the import's hook has run. Poll for it:
      core does not await the hook;
    - from the Player seat, a token walked into the end leading into the
      shared way arrives on it, on its storey, unasked; on the region's map,
      walked into the end leading to a deleted plan and answered yes, it
      arrives on that plan's end.

    The import's plans take new ids that no ledger holds: track what core's
    `importAdventure` hook reports it created where the deleted plans were
    the run's, and delete the character's tokens by uuid after the hops.

A party's formation across a hop is formation's own recipe
(`docs/formation/TESTING.md`, "A teleport between scenes"); a link Region is
the same core behaviour.

### Teardown

1. Sweep the run's ledger; a link Region goes with its map. The character's
   tokens went at steps 6 and 10.
2. Delete the Player's explored fog on every map a token stood on, by id.

## The region's adventures: their tables and monsters

The adventure books' tables, legacy stat-block monsters and encounter zones
are register rows like any other book's (MODEL, "An entry's heading line"
and "A roll table's rows"). `verify:cookbook` proves each row's geometry
against the page offline; only a live run proves the rows become documents
holding the text a reader expects.

### Fixtures

1. The adventure books open on the GM seat. A copy the server's data
   directory holds opens without a picker and leaves nothing behind:
   `acksExtras.importer.connectBookUrl(<id>, <path>, { remember: false })`
   (`TEST_ENVIRONMENT.md` names this machine's staged copies). A book the
   server does not hold is read one-off through the Books window.
2. The world's tables and monsters of those books, noted before the run:
   `game.tables.filter((t) => t.getFlag("acks-extras", "cookbook")?.book === <id>)`
   and the line's RollTable and Actor shelves (the packs whose label opens
   with "ACKS Cookbook — ") indexed with the cookbook flag
   (`pack.getIndex({ fields: ["flags.acks-extras.cookbook.id"] })`).
   The table run skips every id already present, so a table a peer imported
   proves nothing about this build; compare against a world that lacks it.
   A shelf may also hold tables under ids the tree's cookbook no longer
   carries (an earlier build's): count against the cookbook's own id list,
   never against everything flagged with the book.

### Steps

3. `const r = await acksExtras.importer.cookbookImportRollTables()`, then
   `api.track` every table in `game.tables` whose cookbook flag names an id
   fixture 2 did not list (the run reports counts only).
   *Observable:* `r.made` counts the open books' tables the world lacked. Each
   sits in its book's RollTable folder, its `formula` read off the page or
   built from the rows when they start at 1, and each result's `range` is one
   printed die band. A grid cut by its mirror (`centerDies`) has one result
   per die band the page prints: `ax4.ruinedBuildings` has forty-seven, from
   a first band of five to a last of one, and its last result opens on its
   first word although the page welds that band's die onto it.
4. A row's explanation stands under the row. Open `ax4.cityRuinsEncounters`.
   *Observable:* nine results; every result whose page prints a statistics
   paragraph for it carries that paragraph as a `<p>` after the row's own
   text, and the one printed without (the band of three) carries no `<p>`:
   `results.filter((x) => x.text.includes("<p>")).length` is 8.
5. A blank row is a result. Open `ax6.dynamicEncounters`.
   *Observable:* twelve results under a twelve-sided formula; the last four
   have empty text (`keepEmpty`), so the Judge's own entries have rows to
   land in.
6. The two tables 11.0.0 re-cut. On a world that imported them with an older
   build, delete the old pair by id if this session made them, or compare
   against a fresh world. Where the old pair is another session's, read the
   tree's recipe through the executor in the page instead — the read an
   import makes, without the document: with `{ openBook }` from
   `/modules/acks-extras/scripts/importer/extract.mjs` and `{ executeEntry }`
   from `.../executor.mjs`, open the staged copy's bytes
   (`openBook(await (await fetch(<path>)).arrayBuffer())`) and run
   `executeEntry(doc, <the book's cookbook json>, <cookbook/registers.json>, <id>)`;
   `node.fields.rows` are the results to be.
   *Observable:* every result of `ax2.mummyReaction`, the first band included,
   opens with its one-word lead and a period; the older build began the first
   band on its second line. `ax3.cityRumorTruths` holds sixteen results from
   twelve printed rows: a key that lists several rolls stands once per roll
   with the same text, and a roll the page prints no truth for has no result.
7. Legacy monsters: `await acksExtras.importer.cookbookImportIds(<ids>)` with
   a book's `kind.monsterLegacy` ids read off its cookbook file; track the
   actors the shelf's index then answers for those ids.
   *Observable:* one actor per id in its book's group folder, every stat the
   page prints a value for read (not blank), and its description the entry's
   prose with nothing of the next entry's.
   - A row the Monstrous Manual reprints (`meta.revisedBy`, the two AX6
     ids) imports that printing instead while the Manual is open on the seat,
     and is skipped with a notice when the world already holds it: no actor
     is flagged with the adventure's id either way. With the Manual not open
     it imports as its own block.
   - The four `ax5.optic*` ids share one heading, one description that runs
     overleaf to the next heading, and two four-column stat blocks: the four
     actors carry the same prose and differ in their stats, column by column,
     the two whose attack line wraps included. The book-text wrapper names
     the id it was materialized for, so compare the biographies with each
     actor's own cookbook id taken out.
   - `ax5.protoOoze` and `ax5.protoOozeGiant` likewise share a heading and a
     two-column block.
   - `ax5.monster2` ships a neutral name (`anchor.hash`) and takes the heading
     printed on the page; its armour class is read although the page welds
     the value onto its label.
   - `ax5.walkingVenusMantrap`'s heading shares a baseline with the previous
     entry's prose across the gutter; its description is its own.
8. Zones: the four books' `kind.sceneZone` rows (`ax4.zone1`, `ax5.zone1`,
   `ax5.zone2`, `ax6.zone1`) are the previous recipe's step 6 over the region
   map. The two that name a table resolve `tableUuid` to the table step 3
   made from the same book (`ax4.forestEncounters`, `ax5.cliffEncounters`).

### Teardown

9. `api.sweepTracked()` for the tables and actors; quote what it removed,
   what it could not find and what refused. A book opened with
   `{ remember: false }` is closed by a reload.

## A community book, read through its declared typography

`cat` is set off the family's ladder (MODEL, "A book's typography"). This
walk proves the tagged read reaches the seat, not only the compiler: an
untagged seat would read every line as a heading and import nothing.

### Fixtures

- The book staged as `acks-test-books/cat.pdf` on the server
  (TEST_ENVIRONMENT.md, "Staged files"), connected with
  `acksExtras.importer.connectBookUrl("cat", "acks-test-books/cat.pdf", { remember: false })`.
- Nothing else: every document below is created by the import and swept by
  its id.
- A world whose owner already imported part of the book (the walk's
  `HELD_OK=1`) runs the same steps. A class or power imported while the book
  was closed holds no text and no hit die, only what the cookbook entry
  carries, so rebuild every held one through the entry picker
  (`Classes|<id>`, `Abilities|<id>`) once the book is open. *Observable:*
  each answers under the uuid it had, with a later `_stats.createdTime` — the
  same document id on the same shelf, written again. The steps then skip a
  held class and reuse a held power, so take each
  count as the absent ones. Read the classes' shapes off the uuids held under
  their ids, not off the step's result. Track only what was absent before
  the run.

### Steps

1. Connect the book. *Observable:* the open is announced by the book's label
   and a count of what imports from it; the Books window lists it as open
   this session; `init`, `setup` and `ready` threw nothing beforehand.
2. Import the book: the abilities step for its powers, the classes step for
   its classes, the id import for its monster and — after the classes, since
   she binds hers at import — for the person it prints in full
   (`acksExtras.importer.cookbookImportIds(["cat.npc1"])`), the items step
   (`acksExtras.importer.cookbookImportAdventureItems({ books: ["cat"] })`)
   for the ten items it introduces and the journals step
   (`acksExtras.importer.cookbookImportJournals({ books: ["cat"] })`) for
   its seven passages, each scoped to the book. (Import Everything runs the
   same steps over every open book.)
   *Observable:* the journals step reports seven pages made, none refused,
   and two journals created on the line's Judge JournalEntry shelf, named by
   group ("Essays", "Tavern"), each page titled by what its passage is
   (Introduction, Race, Cultures, Design notes, Generic class, Conversion
   notes; Tavern) and holding the page's paragraphs — the first lines of a page's
   top, the bullets and the two-column order included — closed by a page
   reference; the items step reports ten imported, none already present,
   none refused, and the line's Judge Item shelf ("ACKS Cookbook — The OSR
   Catgirl — Judge — Item"), absent before the step, holds ten core items in
   the book's folder under "Items", each named from the page, with one
   paragraph of description closed by a page reference; the series' OPEN Item
   shelf ("ACKS Cookbook — The OSR Catgirl — Item"), absent before the run
   and opened by the classes and powers steps, holds five class-power items
   (Catgirl 0–4, one paragraph each) and three class items with hit die,
   maximum level, prime requisite, requirements, a proficiency list of whole
   names (no pair welded at a line turn) and a description running the whole
   spread — a content row files on its book's series' open line
   (`lineOfClaim`), never the Judge's, and each is filed in its shelf folder
   ("Classes", "Class Powers") inside that pack, not dropped at the root;
   the library's own Item shelf gains nothing from this book; the line's
   Judge Actor shelf ("ACKS Cookbook — The
   OSR Catgirl — Judge — Actor", closed to every player seat as it is made)
   holds one monster actor with AC, HD, movement, three attacks with a weapon
   alternative, morale, saves, alignment, treasure type, XP, vision, a
   proficiency list, a sectioned description and two spoils.
3. Open the monster. *Observable:* the description's sections read in page
   order across the page turn — the Combat section's last paragraph is whole,
   not cut at the column foot — and Spoils lists two components with weight,
   value and effects. Open the keeper. *Observable:* her import step warned
   once, that her class has no progression rows yet (the book prints its
   classes' tables as pictures), and of nothing else; a core character on
   the Judge Actor shelf under "NPCs", named from the page and owned by
   nobody,
   her class one of the book's three (bound, so the class's title, throws
   and saves are derived) at the printed level, her six scores and hit
   points written, her proficiencies embedded as abilities where the library
   answers the name — class ones with the throw the page prints — and the
   rest counted on the sheet's as-printed block, her inventory worn and her
   gold counted; the biography opens with the page's paragraph about her
   house, closed by its page reference, then the as-printed block with every
   figure the class works out differently.
4. Open a class item. *Observable:* the list's names the register knows are
   resolved and the rest stay as text; the description opens each passage
   with the spread's own run-in label.
5. The maps step, scoped to the book:
   `acksExtras.importer.cookbookImportScenes({ books: ["cat"] })`.
   *Observable:* two maps created, none refused; each is a world Scene in a
   folder named for the book, gridless, off the navigation bar, its picture
   cut from the page and uploaded under the art directory, no token and no
   wall on it. The uploaded pictures stay in the data directory after the
   sweep — name them.
6. The adventures step, scoped the same way:
   `acksExtras.importer.cookbookImportAdventures({ books: ["cat"] })`.
   *Observable:* one Adventure written, for this book alone, on the line's
   Judge Adventure shelf, carrying the two maps, the monster, the keeper and
   the ten items and none of the classes or powers; the GM's Books window row
   for the book now reads its contents. The class item stands on the series'
   open Item shelf, the monster and the keeper on the Judge Actor shelf and
   an item on the Judge Item shelf — `lineOfPack(doc.pack)` on each.
7. Join as the **Player** seat. *Observable:* no compendium of the Judge
   line is visible to it, and the series' open Item shelf is, with the five
   powers and three classes in its index.
### Teardown

8. `api.track` every id the imports' results list — the class documents, the
   monster, the keeper and powers read back by id, the items', the journals'
   and the scenes' `created` uuids and the Adventure's, and every ability
   definition the keeper carries under an id the library did not hold before
   her step (her proficiencies are supplied on demand from the library's
   books) — then `api.sweepTracked()`;
   quote what it
   removed, could not
   find and refused. A shelf the run opened is deleted once empty — the
   world's packs are read before the first presence check and again after
   it, and the two lists are equal: a presence check (`importedActorFor`)
   reads, and the line's Actor shelf, absent beforehand, is opened by the
   import and by nothing earlier. The book opened with `{ remember: false }`
   closes on reload.

`tools/live/importer-typography.mjs` walks it; step 1's Books-window line,
step 6's Books-window row and the boot check it leaves to the reader. The
seat reopens the world's shelved books after ready, so a step with no scope
would write every one of them; the walk runs only the scoped steps.
