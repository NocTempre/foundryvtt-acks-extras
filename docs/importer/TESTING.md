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
`tools/live/importer-typography.mjs` drives "A community book, read through
its declared typography" (`tools/live/README.md` is the contract); the rest is
walked by hand.

## The Books tab

The Books tab of the import manager (`openImportManager({tab: "books"})`) is
the one place a book is connected, shelved or forgotten; `bookStatus()`,
`connectBook()`, `reconnectBooks()`, `gettingStarted()` and the join-time offer
all open the manager on it. Every seat may open it, and a seat that is not a
GM has this tab alone.

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
   *Observable:* the import manager, on its Books tab, holding the panel
   `.acks-extras-importer-books` in four bands. The walkthrough band is open (this
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
   *Observable:* the window does not auto-open (a seat with nothing open in a
   world whose shelf holds books is offered no walkthrough); opening it by
   macro shows the server band read-only, with no Add/Remove/Scan controls.
   The shelf journals are not in the player's Journal sidebar (Foundry's
   default ownership — the GM alone), the rows carry no **Open** button and
   each says the book is not shared with this seat; give the seat Observer on
   one journal and that row's button appears.
10. The migration. Delete one book's journal, then put the old record back by
   hand — `game.settings.set("acks-extras","shelf",{ax1:{path:"acks-extras-books/ax1.pdf",name:"ax1.pdf",size:0}})`
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
aside on disk (`mv ax1.pdf ax1.pdf.aside`), stage it, then delete what the
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
acksExtras.importer.cookbookDebug("mm.<entry id>");
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
`world.acks-cookbook--item`, and a line's creatures in
`world.acks-cookbook--<line>--actor` — so a presence check written against
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
4. **Counting reads** (the stack-counting check). Wrap
   `CompendiumCollection.prototype.getDocuments` from the page with a counter
   that records the call's query shape, its milliseconds and the top frames of
   its stack, then run a bulk step that writes many library items:
   `acksExtras.importer.cookbookUpdateAbilities()` after flipping
   `flags.acks-extras.extras.unaudited` on a few dozen library abilities whose
   book is open (the update restores the flag, so each write is a real one).
   *Observables:* the calls with `_id__in: []` are counted apart and cost about
   nothing each (the lib patch answers them before the server; one per write
   per core load is expected); the calls that reach the server are the step's
   whole-pack reads (the abilities listing, the dangling-ability listing, the
   imported index on a cold client) plus ONE ladder refresh after the loop and
   one per quiet second inside it, and no `refreshLadders` frame appears among
   the stacks while writes are running. A count that grows with the number of
   writes means one of the two guards moved. Edit an actor's embedded copy of a
   skill ability while watching: no pack read follows.

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
  `def.race.dwarf` and two `def.race.elf`; with JJ attached the JJ tables make
  four race documents (`def.race.dwarf`, `elf`, `people1`, `people2`), one of
  each after every repeat.
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
SIX macros — your books, manage imports, import everything, reimport one
shelf, reimport individual entries, delete everything. A seventh is a
regression. The management window is the surface; the four controls are
shortcuts into it, and the entry picker is the debug tool beside them.

Reimport one shelf, e.g. Weapons:
*Observable:* the confirm, titled Repair in place, names the count; afterwards
the shelf holds exactly what it held before, every document under its own id
and `_stats.createdTime`, and the pack's total is unchanged. Nothing on another
shelf is touched, and a class template's documents are never written.

Reimport one book. Fixtures: a second book open on this seat that is not yet
imported (By This Axe, read one-off so nothing is remembered), then import
equipment — its own items appear; note their ids. Steps: the same picker, the
"Books open on this seat" group, that book, confirm.
*Observable:* the confirm names the count AND the shelves it spans; afterwards
every noted id answers again with the same name and the same
`_stats.createdTime` — written over in place; every other book's item count is
unchanged; a Rulebook item carrying one of the book's ids in `cookbook.merged`
is still there. The group lists only books open on this seat, and
`cookbookReimportBook` for a book that is not open warns and writes nothing.
Teardown: delete the items the first import made, by id; reload the seat so
the one-off book is closed.
Right after a reload the group can list only part of the shelf while books
reconnect; wait until `bookStatus()` shows the book before opening the picker.
A book read one-off is closed by that reload and needs reading again first.

Content after a reimport. Presence is not content: after a By This Axe
reimport, scan the rebuilt descriptions as well as counting them.
*Observable:* no token of 16 or more letters the vocabulary does not know (a
welded clause), no lowercase run straight into uppercase, and the Earthshooter
description is one paragraph that ends above the table following it on its
page. Portable Battering Ram and Personal Automaton read as separate words.

## The import manager

**Manage Imports (GM)** — `acksExtras.importer.openImportManager({tab})`.
One AppV2 window, five tabs; it runs nothing of its own, so the walk is each
tab's primary action reaching the run it names.
`tools/live/importer-force-repair.mjs` walks steps 1 and 2, the Player seat
included, and step 3's bar and its Repair everything, answered No. The Import
everything / Repair everything handlers' routing, and the merged repair's
counting, run offline in `tools/importer/test-import-manager.mjs` and
`tools/importer/test-reimport-everything.mjs`.

### Fixtures

- A Judge's adventure book open on this seat (AX1 is the one with maps,
  places, items and tables all at once), already imported once by *Import
  Everything*, so its Adventure stands on its shelf and the Adventures tab
  has a row with a census.
- A second non-adventure book open (the Rulebook), for the Books tab's
  "open" column and the Rebuild tab's book group.

### Steps

1. Run the macro on the GM seat.
   *Observable:* one window titled Manage Imports, a tab strip of five, the
   Books tab open; the frame scrolls its body, not the strip
   (`.acks-extras-importer-manager-body` is the element with `overflow-y:
   auto`); no `id=` on anything inside the body
   (`root.querySelectorAll("[id]")` is empty below the window root). Run
   the macro again: the same window is raised, not a second.
2. Books tab: the groups' counts ("Open this session", "Waiting", "Not
   connected") add up to `Object.keys(api.BOOKS).length`, and each open book
   is one `api.bookOpen(id)` answers true for; each row's scope matches
   `cookbookCount(id)`. Press a control in the panel (a row's connect, Add to
   server, Scan) and then another tab and back: the panel is built again with
   the report of what was done in the shelf band. Close the window and call
   `api.bookStatus()`: the manager opens on this tab.
   **The player seat.** Join as the Player-level user with a book the Judge
   shared on the shelf, and run "Your ACKS Books (this seat)".
   *Observable:* the manager opens with a tab strip of ONE tab, Books; the
   panel shows the shelf rows and the seat's own controls, no Add to server,
   no census line; `openImportManager({tab: "tools"})` still lands on Books;
   the join-time offer on a seat with a remembered book that needs a gesture
   opens the same window.
3. Import tab: the steps are listed in `GM_STEPS` order, numbered. Press
   **Run** on *Importing roll tables…*.
   *Observable:* the window's status line names the step while it runs and
   its buttons are disabled; the step's own notification lands; the buttons
   return.
   The bar above the steps holds **Import everything** and **Repair
   everything**, and no select. Press **Repair everything** and answer the
   confirm **No**, with a create/update/delete observer armed.
   *Observable:* one confirm, titled Repair in place, listing every open book
   and every open adventure book under its own name, each with the lines its
   own repair shows; the observer holds nothing after the No. A Yes repairs the whole
   library and puts every held edit of every part to one choice; each part's
   Yes is walked in its own recipe. The asking pass of a repair reads
   the whole library, so the confirm can take longer than one scripted
   evaluation: press, then wait for it in rounds, and log the seconds.
   Then call the journals, keyed-places and maps steps narrowed to a book id
   no seat holds (`{books: ["qa-no-such-book"]}`), as a book's rebuild
   narrows them.
   *Observable:* each resolves null and no notification is raised. Run
   unnarrowed from this tab, the same step still warns when no open book has
   anything for it.
4. Rebuild tab: the picker's groups equal `rebuildOptions()` — the same
   options as *Reimport One Shelf*'s picker, in the same order. Pick
   *Rules tables → one document*, **Go**; the picker is the tab's only
   select.
   *Observable:* the table's re-read notification, nothing deleted.
5. Adventures tab: one row per open Judge's book, each with the census line
   (`bookCensus`) and two buttons, **Repair** and **Write Adventure**.
   Repair is walked in the recipe below.
6. Tools tab: **Repair checks** opens the repair window already scanning;
   **(Re)import individual entries** opens the picker; **Audit the recipes**
   runs the audit. **Remove ALL imports** asks first — Cancel.
7. Settings → Module settings → ACKS Extras → *Manage imports*: opens the
   same window; with it already open, raises it.
8. Join as a player: the macro warns "Only a GM can manage imports" and
   opens nothing; the settings menu is not listed.

### Teardown

Close the window. Nothing was built; the roll-table step and the table
re-read wrote in place.

## A fresh world's first Import Everything reads the tables before the classes

Import Everything with no Repair. Reading and applying the rules tables is
split across two steps of the chain (DECISIONS 2026-11-13, "The rules tables
are read first and applied after the classes"); this walk shows the first
run completes what a Repair used to, on its own.

### Fixtures

No document carries a marker: the fixture is the world's absence of imports,
which setup must make true and which the step asserts before it starts, so
setup is the subject. Before it, find out who is seated (`live-testing.md`,
Concurrency): emptying the imports takes every importer walk's corpus with it,
so it waits while a peer drives an importer surface. The ledger is empty; the
step builds nothing with `api.create`, so nothing is swept.

The books the walk needs are the GM's own, open on the GM seat: the Rulebook
and one book that prints a creature template family with leaders, a priced
class, a race that grants tongues, and a skill the book restricts by armour.
Name them by kind in the run's log, never by printed name.

### Steps

1. Empty the world's imports. Manage Imports → Tools → **Remove ALL imports**,
   confirm. That removes the documents and the materialized tables but keeps
   the table DATA registered (`ruledata-import`'s `removeMaterializedDocs`), so
   then log the `ruledata-import` service's `listDocs()` and call
   `removeDoc(id)` for each world-priority entry. *Observable:* the library
   holds no imported race, class, skill or creature, and `listDocs()` returns
   no world-priority entry. Record the counts found in the run's log; a
   non-empty state after setup is a failed setup, and the walk stops.
2. Manage Imports → Import → **Import everything**, once. Do not press
   Repair, Rebuild or any Rebuild option. Wait for the status line to clear,
   in rounds if one evaluation cannot cover it, and log the seconds.
3. Import tab: the steps are listed numbered in `GM_STEPS` order, 21 of them,
   and step 10 is *Applying the rules tables to races, classes, skills and
   languages…*, directly after the classes step and before template packages.
   *Observable:* that numbering, read off the window.
4. A creature template family whose members print leaders: a member's throws
   are derived (set, not the absent state) and its kit axis is set. *Observable:*
   the member sheet's throw figures and its kit field, with the tooltip on each
   naming where the figure came from.
5. A priced class: each of its levels carries an experience figure, and the
   class Item's `system.builder` is set (its build provenance). *Observable:*
   the level rows on the class sheet, and the Item's `system.builder` read back.
6. A race that grants tongues: the race Item's `system.languages` lists the
   granted tongues. *Observable:* the race Item read back, with a character of
   that race showing the tongues on its languages.
7. A skill the book restricts by armour: the skill's gate carries the
   armour-limit row. *Observable:* the skill's item read back, and the
   armour-limit line on its sheet.

Each observable is read on a fresh read of the document, not from the window
that wrote it.

### Teardown

None. The imported world is the fixture later walks reuse. A walk that needs
the empty state again empties it by step 1 under the setup rule above, after
reading what the world holds.

## Rebuild or repair an adventure book

`acksExtras.importer.cookbookReimportAdventure(bookId)`, from the Adventures
tab's **Repair** button.
`tools/live/importer-force-repair.mjs` walks step 3, answered No.

### Fixtures

- AX1 open and imported, as above. Note before the walk: the ids of its
  places (`game.actors.filter(a => a.getFlag("acks-extras","cookbook")?.book
  === "ax1")`), its journals, its roll tables, its items, and the id of its
  Adventure on the shelf (`bookAdventureId("ax1")`).
- One place dragged out of the library into the sidebar (a world copy), one
  of the book's pregen characters handed to a player (owner), and one scene
  of the book with a drawing added by hand. Each is what the repair must
  keep.

### Steps

1. **Repair** on the AX1 row. Edit the Adventure's description on the shelf
   first.
   *Observable:* the confirm, titled Repair in place, counts the documents by
   kind and says the edited Adventure is written anew; answer Yes. If the
   repair held an edit or lists a pregenerated character, the choice opens:
   answer every character *Leave it as it stands* and press *Keep every edit
   of mine*.
   After it, the Adventure's `flags.acks-extras.cookbook.writtenAt` is fresh
   and the description edit is gone; no place, journal, table or item was
   deleted (same ids, same `_stats.createdTime`); the scene still carries the
   hand-drawn drawing; the dragged copy and the player's character are
   untouched (neither is listed in the choice); the scenes step's summary
   names the held maps it repaired; the result object lists one entry per
   step and no errors.
2. The same action on a row for a book that is not open (close it, reload):
   the Adventures tab lists no such row, and the api call warns "not open on
   this seat" and writes nothing.
3. **Repair** on the AX1 row, the confirm answered **No**, with a
   create/update/delete observer armed.
   *Observable:* the confirm is titled Repair in place; the observer holds
   nothing. The row offers Repair and Write Adventure and no other button.

### Teardown

The repaired documents are the fixtures from then on. Delete the hand
drawing, return the pregen to the Judge, delete the dragged copy by id.

## An adventure book's repair writes places in place, and holds a Judge's edits

`cookbookReimportAdventure(bookId, {ask, choose})`; the Adventures tab's
buttons run it with the choice dialog. Every fixture below is a library
document the import made. A live walk may write over the test world's corpus
(owner ruling, 2026-11-11), but the repair writes the book's places for every
client, so find out who is seated on this surface first.

Live: `tools/live/importer-forced-places.mjs` walks the census (answered No)
and steps 1–4 on ax1 and ax3, the character steps included; every choice it
answers names only the walk's own edit keys and its one character.

**Answering the choice from a script.** `choose(edits, {pregens})` is called
with what the dialog would list and answers as the dialog does:
`{take: Set<edit key>, pregens: Map<uuid, "restore"|"leave"|"rewrite">}`. A key
or character it does not name is kept or left. A `decision` passed instead
answers before anything is held and runs one pass, so it never reaches a
character.

### Fixtures

Library actors live in a compendium, where no marker can name them (a fixture
is a world document): each is found by its cookbook claim
(`importedActorFor(id, {copies: false})`), and the shared places by the rows
that write onto them (`placeBlockRows`). The names below are the recipe's
labels, not markers. When the book holds no such document, import the book
first (Adventures tab, Repair on its row) and look again. ax1 and ax3 together
hold every kind.

- `importer/forced-keyed-place`: a keyed place of an adventure book whose
  roster names a creature made from its own stat line (a roster row whose
  `uuid` is an actor claiming `<place id>-o<n>`).
- `importer/forced-statline-creature`: that creature.
- `importer/forced-shared-place`: a place two books print, both imported: its
  `flags.acks-extras.cookbook.merged` is not empty and its notes hold two
  stamped blocks (`data-acks-entry`), one per book. The book under test is the
  one whose row is in `merged` or in `id`; note which.
- `importer/forced-bound-place`: a market or settlement place a region site of
  the same book is bound onto: its notes hold a block whose `data-acks-entry`
  is not the place's own claim.
- `importer/forced-quarter`: a quarter's place (claim `<book>.district.<slug>`)
  whose notes hold its overview's block.
- `importer/forced-pregen`: a pregenerated character of the book (a library
  `character` actor whose cookbook `book` is the book under test), where the
  book prints one.

Record each fixture's uuid, `_stats.createdTime`, name, notes and cookbook
flag before step 1.

### Steps

1. **The first repair**, from the API with the confirm answered and the
   character answered restore:
   `r = await acksExtras.importer.cookbookReimportAdventure(book, {ask: async () => true, choose: async () => ({take: new Set(), pregens: new Map([[pregenUuid, "restore"]])})})`.
   *Observable:* every fixture but the character keeps its uuid and
   `createdTime`; the choice listed the character `changed` (and
   `unstamped` where it was imported before the play stamp), so the dialog
   would have offered restore; `r.restored` is 1 and `r.kept` holds one uuid:
   a copy in the same pack, named "(kept)", with no cookbook claim, no
   `playStamp` and `keptFrom.uuid` the character's; the character stands
   again under its own uuid with a later `createdTime` and a `playStamp`.
   Track the copy's uuid from `r.kept` and sweep it. The shared
   place keeps its `id`, `merged` and the other book's block byte for byte;
   the bound place and the quarter keep every block but the one this book's
   row writes; the creature's `_stats.modifiedTime` moved and its roster row
   on the keyed place still resolves; `r.edits` is an array. On the first run
   a block no digest covers yet (a place made before digests were recorded)
   reads as unedited: it is written from the page and gains its digest in
   `flags.acks-extras.cookbook.sums`. A row with no block is written only onto notes empty but
   for the place's erratum notes; beside the Judge's text or another row's
   block it is listed in `r.edits` with `current` empty.
2. **A Judge's edits.** Change one word inside this book's block on the
   shared place, rename the shared place (only where this book's row is its
   `id`), add `<p>Judge note.</p>` after the block on the keyed place, delete
   this book's block from the bound place, and add the same note to the
   pregenerated character's biography. Repeat step 1, the character answered
   rewrite.
   *Observable:* the choice lists the character `changed` and stamped (its
   biography moved the play stamp), so restore would be offered; `r.edits`
   lists each edit once, each with `key`, `uuid`, `path`
   (`system.notes#<row id>`, `name`, `system.notes`,
   `system.details.biography`), `current`, `page` and `cite`; the edited word,
   the rename, both notes and the deleted block's absence all stand (the
   deleted block's `current` is empty); every other block is written again;
   `r.rewritten` is 1. A changed figure (a stat, a roster row) is not held: it
   is the page's again.
3. **Take one.** Repeat with `choose` answering `{take: new Set([r.edits[0].key])}`.
   *Observable:* that one edit is replaced by the page's value; the others
   stand and are listed again. The character, rewritten and so re-stamped in
   step 2, is listed unchanged: the dialog would offer leave, with the note
   that it matches what was imported.
4. **Take the rest.** Repeat with `choose` answering every remaining key of
   the walk's own, the character answered rewrite where its biography edit is
   among them (an edit to a character is written only by a rewrite).
   *Observable:* every fixture reads as the page gives it, each block of this
   book's rows now carrying a checksum; uuids are still those recorded but the
   character's. Steps 2 and 3 assume this stamped state, which step 1 leaves.
5. **The control.** Adventures tab, the book row's Repair; Yes.
   *Observable:* the choice opens (titled *Your edits and the book*) with a
   fixture edited as in step 2 listed, its two values each carrying a
   tooltip, and the character with its note. Set the character to *Leave it
   as it stands* and press *Keep every edit of mine*: the edit stands and is
   still held, and the notice counts the places written.

### Teardown

The fixtures stay. Step 4 returns them to the page's text; after step 5, run
step 4 once more. The only document the walk creates is the character's kept
copy, tracked from `r.kept` and swept.

## One entry at a time

**(Re)import Individual Entries (GM)** —
`acksExtras.importer.cookbookReimportEntries()`. The finest rebuild: it lists
every entry the build can import, grouped by the run that rebuilds one, each
row carrying its id.

### Fixtures

An imported world. Note the document id, `img` and `_stats.createdTime` of ONE
imported trap and ONE imported proficiency, and the `_stats.createdTime` of
every other trap and proficiency, before starting. A rebuild writes every
document again under the id it had, a monster included (DECISIONS,
2026-10-28, "Every rebuilt document keeps its id"), so the creation time is
what tells a rebuilt document from an untouched one. Either way the documents are the
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
    anew — each under the id it had with a later `_stats.createdTime`, the
    monster included — because the refill did not take a copy for the
    library's own document. Then *Reimport one shelf* for the trap's shelf.
    *Observable:* the copy is still there, unchanged, and the shelf's count
    matches the count before the step.
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

**Closing a book on one seat.** A world whose books are SHELVED reopens each
one at join on every seat its shelf page is open to (`restoreShelf`; every GM
seat), so a GM seat never holds a closed book unless the book is unshelved for
the whole world, and
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

`tools/live/importer-force-repair.mjs` walks step 9 on its own items of one book and step 10's confirms answered No.

Every control runs the one repair (`mergedRepair`): Reimport One Shelf and the
entry picker carry no Mode select, and the API's `mode` option is ignored
(`cookbookReimportShelf(shelf)`, `cookbookReimportBook(bookId)`). Each goes to
a confirm titled *Repair in place* that counts what it will write over; where
the run held an edit a Judge made to what the import wrote, or met a
pregenerated character, *Your edits and the book* opens next; then a notice
counts what was written over, what was taken, what is still held and what was
left. Steps 2–7 answer that choice **Keep every edit of mine**, which leaves
the documents as the old *Repair* did.

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
   *Observable:* no Mode select; no option ends in *(no in-place write)*.
2. **A shelf.** Choose Traps.
   *Observable:* the confirm counts 13 to write over and says what a repair
   keeps. Confirm; the choice lists the edited trap's description; Keep every
   edit of mine. The notice reads 13 written over, 1 kept; every fixture keeps
   its id and its `Fixture · ` name, and the edited one its level and its
   note. A document already equal to its
   build is not written at all — Foundry drops an empty diff — so its
   `modifiedTime` does not move although the notice counts it.
3. **Picked entries.** Open the entry picker.
   *Observable:* no Mode select; only a row no run writes in place
   (`monsterRepair` null, not a pregenerated character) carries the hammer
   mark, whose tooltip and accessible name say a repair deletes it and
   imports it again under the same id; a stat-block monster's, a family's
   and a pregenerated character's row do not.
   Tick the stack, the proficiency, the class and the monster, press
   *Reimport*.
   *Observable:* the confirm counts the four documents and carries the
   monster, ability and class lines. Confirm, and Keep every edit of mine. The
   notice counts five written over — the character's copy is the fifth — all
   five keeping the note.
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
   variation and the vehicle table's entry, *Reimport*, Keep every edit of
   mine.
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
8. **A book.** Reimport One Shelf, the books group, a book.
   *Observable:* the confirm names the count and the shelves it spans.
   Answer No: a book repair writes over every document of that book, through
   the runs steps 2–4 already walked.
9. **The choice.** Import one book's items (the run's own, `api.track`ed) and
   give the first a Judge's note in its description, a quantity of 3 and an
   owner beside the default. Tick the run's items in the entry picker and
   press *Reimport*; answer the confirm **No**.
   *Observable:* the confirm is titled *Repair in place*, counts the
   documents and closes on what a repair keeps; nothing is written, no
   choice opens, and the note stands.
   Again, **Yes**.
   *Observable:* *Your edits and the book* opens with one frame for the
   edited item and one row, its description, carrying a *Take the book's*
   box; *Yours* and *The book's* each carry a tooltip (the page the build read
   from, or that none was recorded); the buttons are *Apply these choices*,
   *Take the book's for every edit* and *Keep every edit of mine*; the frame
   scrolls and resizes. Tick the box and press Keep every edit of mine.
   *Observable:* nothing is taken (`taken` 0, `held` 1): the note stands, the
   price is the page's again, and the notice reads *Repaired in place* with
   the counts.
   Again, Yes, tick the box and press Apply these choices.
   *Observable:* `taken` 1, `held` 0; the description is the build's again,
   the note gone; the item keeps its id, folder and owners, and its quantity
   of 3.
   Again, Yes, with nothing held.
   *Observable:* no choice opens; `held` 0.
   With a pregenerated character in the world, its row in the choice offers
   three answers — keep it under a new id and restore the book's, leave it,
   or write the book over it — preselected by its note: *Changed since it was
   imported* and *Imported before changes were recorded* default to the
   first, *Matches what was imported* to Leave. `tools/live/importer-forced-places.mjs`
   walks all three answers.
10. **Every kind has an in-place write.** With the books of the shelves open,
    pick the Weapons, Armor, Languages and Races shelves and a book's monster
    templates and families, and NPCs one at a time, answer
    **No**, then **Yes**. Before the Yes, edit one weapon's damage die and mark
    it equipped, change one language's taxonomy flag, and rename nothing; if
    the choice opens, press Take the book's for every edit (a field the kind
    does not hold as the Judge's is written over without asking).
    *Observable:* no shelf is marked as having no in-place write; each Yes reports a replaced
    count; the weapon's die is the table's again and it is still equipped; the
    language's flag is back; every document keeps its id, folder and owners (the
    run's own `modifiedTime` and `_id` record). A pregenerated character picked in
    the entry picker is listed in the choice, not written over. Close the book of
    one shelf and repeat: its rows are counted as left, none written. The rewrite
    scope is not observable apart from these; confirm that no second copy of any
    document appears on the shelf (counts before and after are equal).

### Driving it

- The entry picker loads the whole library before it renders — about ten
  seconds on a full world. Poll for `.acks-extras-importer-mon-list`.
- Typing in its filter unticks every row the filter hides; tick after clearing
  the filter.
- `bookStatus()` opens the manager on its Books tab and resolves with the
  window at once. Count the books open on the seat with `reimportableBooks()`.
- The dialog's promise resolves with the run's result — `{mode: "repair",
  replaced, keptProse, taken, held, refused, refill, …}` (`mergedRepair`) —
  once the confirm and the choice are answered and the run ends; wrapping
  `ui.notifications.notify` records the notices word for word.
- The choice is a `DialogV2` carrying `.acks-extras-held-list`; a scripted
  run that does not drive it passes `choose` to the API instead (it resolves
  `{take: Set, pregens: Map}`, or `"keep"` / `"take"`), and closing the
  window answers keep.

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

The Revised Rulebook connected, and the equipment import run.

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
3. Apply a class template package that names a belt (any vaultguard or explorer
   template).
   *Observable:* the skinned "leather belt" on the character carries the base's
   subtype.

### Teardown

Delete the fixtures you created; the imported library is the world's.

## Ammunition is inventory, not a weapon

### Fixtures

The Revised Rulebook connected.

### Steps

1. Import weapons with the Rulebook connected.
   *Observable:* the four rows the page types Ammunition are `item`, and every
   other row is still `weapon`. The one-liner:

   ```
   game.items.filter(i => i.getFlag("acks-extras","ammunition")).map(i => `${i.name} [${i.type}] ×${i.system.quantity?.value} enc6=${i.system.weight6} per=${i.getFlag("acks-extras","gear")?.per ?? "-"}`)
   ```

   Four rows, all `[item]`. The case and the quiver are named from the page's
   own label, count included, and read `×N` with `per=N` for that count; the
   sling stones read the count their label prints, the silver arrow `×1`. A run where any of them is
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
The device actually holding its bolts, and choosing between stacks at the roll,
are acks-extras' surfaces — its `docs/equipment/TESTING.md` owns those steps.

### Teardown

Delete the fixtures you created; the imported library is the world's.

## A shield form is a shield

### Fixtures

The Judges Journal connected — the six forms are the only thing that reads
pp.409–410. ACKS Extras active, for the overlay.

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
   *Observable:* none of the six arrives, and the equipment notice counts them
   as passed over with their book not open on this seat. A shield appearing
   here, with or without an AC, means something was built from the entry's
   shape alone (see "An import with a book closed", below).
3. Put one on a character and equip it.
   *Observable:* AC rises by the number the sheet shows, not by a number this
   module chose. With the overlay on, cycle the strap to the back: the ordinary
   bonus goes away (the overlay corrects downward from the item's own value),
   and cycling back to hand restores it. A form that never moves the AC either
   way means the flag did not reach the overlay.
4. Make a Judge's own "Kite Shield" with no importer stamp, then re-import.
   *Observable:* it is untouched, and a second, generated Kite Shield stands
   beside it.

What a form does once it is on a character — the carry states, the mounted
rules, the specialization gate — is acks-extras' surface; its
`docs/equipment/TESTING.md` owns those steps.

### Teardown

Delete the fixtures you created; the imported library is the world's.

## An import with a book closed

Every importer that builds a document from one entry reads it off the seat's
own book first; with the book not open, the entry is passed over and counted,
and nothing is created (MODEL, "What an import reads"). Offline, for spells,
abilities and equipment: `tools/importer/test-bookless-import.mjs`. A drive of
the same on a seat is a closed book's entries run narrowed with `{only}`:
nothing is created, a notice reads "N passed over — their book is not open on
this seat", and the library still holds nothing under those ids. A document
appearing there, named and iconed with no description, is the stub this
behaviour refuses.

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

Everything here is about what a document CONTAINS after import, so every check
is worth more from a seat that cannot read the book than from the one that
imported it. Flags are stored in
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
5. Search the actor's HTML for a `data-acks-entry` block. Every imported
   description holds one — including the journal pages, roll tables, traps,
   equipment and class items an "Import Everything" run produces.
6. Confirm the text is ESCAPED, not parsed: import an entry whose page prints a
   `<` or `&` (a formula or a "&" in a name) and confirm the character shows as
   itself rather than vanishing into markup.
7. **A Judge's own writing survives.** Edit an imported ability's description by
   hand, then run *Update abilities*. The edited one keeps its prose and takes
   the mechanics; an untouched one is rewritten. Reversing that pair is the
   failure this stamp exists to prevent.
8. **A book left disconnected must cost nothing.** Import an entry and confirm
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

### Teardown

9. Delete the folder and everything created.

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

## The shelf opens on the seats it is shared with

At join, `restoreShelf` opens each shelved book whose shelf page the seat may
observe: every one on a GM seat, on a player seat only what the Judge shared.
Each open book is a fetch of the whole PDF and a pdf.js worker of its own, so
the observable is what the seat fetched and holds, not only what it shows.

### Fixtures

1. **The world's shelf** — books a GM staged, their journals at Foundry's
   default ownership. Read it, never drive it:
   `game.journal.filter(j => j.getFlag("acks-extras", "shelf")?.book)`. Each
   step asserts at its start which of them the Player seat may observe
   (`testUserPermission(game.user, "OBSERVER")` on the PDF page); a peer who
   shared one moves the count, not the rule.
2. **`importer/shelf-shared`** — a shelf journal for a registry book that has
   none on the shelf, its PDF page pointed at a staged copy of that book under
   the Data directory, Observer for the Player seat and nobody else. Build it
   from a GM seat with `api.fixture` in the shape `shelfPut` writes: named for
   the book's label, in the shelf-flagged *Your Books* folder,
   `flags.acks-extras.shelf` = `{book, name, size}`, one `pdf` page. Every GM
   seat opens it at join as well, so pick the smallest book that fits. Kept.

### Drive mechanics

- **Join from a capture browser of its own profile**, so no pane's seat is
  taken, and time the join from the page. The restore runs after `ready` and
  holds the main thread while it parses, so a probe sent at `ready` waits on
  it. A script added with `Page.addScriptToEvaluateOnNewDocument` before the
  navigation to `/game` registers `Hooks.once("ready")` as soon as `Hooks`
  exists, wraps `fetch` to count `.pdf` requests, and wraps `console.log` to
  catch `opened N book(s) from the shelf` — the restore's last act whenever it
  opened anything.
- **The main-thread heap misses the books.** pdf.js hands each buffer to a
  worker of its own, outside `performance.memory` and the page's
  `Runtime.getHeapUsage` alike. Count the workers (`Target.setAutoAttach`)
  and read the renderer processes' private bytes, found by the capture
  profile's path on their command line.

### Steps

3. Join as the **Player**. *Observable:* of the world's shelf, only
   `importer/shelf-shared`'s book is open (`acksExtras.importer.bookOpen`);
   the seat fetched one PDF and holds one pdf.js worker; the console reads
   `opened 1 book(s) from the shelf`; no Getting Started window opened; no
   progress bar and no "entries available" notice appeared for the book (a
   book connected by hand afterwards raises both).
   *Your Books*: each withheld row says the book is not shared with this
   seat, and the shared row says it is read from the server on every launch.
4. Press a citation to a withheld book (step 7 above). *Observable:* the
   permission warning and nothing opens. A citation reads the shelf page, not
   the seat's open book, so this answer does not depend on step 3.
5. Join as a **GM** seat. *Observable:* every shelved book is open, the
   fixture's included. Joined alone, this seat is the primary GM and runs the
   GM-at-ready duties; say so in the report.

### Teardown

None: the fixture is kept, and the world's shelf was only read.

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
8. **A Judge's edit to a page is kept.** On an AX3 page from step 5, add a
   paragraph of your own after the imported block (open the page, edit, save).
   Run `cookbookImportJournals()` again. *Observable:* the result carries
   `preserved: 1` beside `updated: 16`, the notice says one page is kept
   (edited), and the page still holds your paragraph and the imported block as
   it was. Remove your paragraph and run again: `preserved: 0`, `updated: 17`,
   the page rewritten from the book. A page that only has the import's own
   block and a creature line is never held, whichever way the book's text moved.
   **An edit inside the block is kept too.** Pages made by the run in step 5 or
   later carry the digest of their block in
   `page.flags["acks-extras"].cookbook.sum`; a page written before the digest
   existed has none and is read as unedited, so use a page that the step 5 run
   wrote. Open another AX3 page, change one word inside the imported text
   itself (not beside it), save, and run `cookbookImportJournals()`.
   *Observable:* `preserved: 1`, the notice says one page kept (edited), and the
   word stands. Then open a third page and press save without typing (the
   editor re-serializes the block), and run again: that page counts `updated`
   and still holds the book's text, and its `sum` is unchanged. Put the first
   page's word back as it was: the next run counts it `updated`.
   *The editor's half without an AX3 world:* build a block from invented
   paragraphs with `bookText(paragraphs, label, {id, book, page})`
   (`scripts/importer/prose.mjs`), put a table inside it, create a page holding
   it with `cookbook.sum` set to `blockDigest(bookTextBlock(html, id))`, open
   it, save without typing, and compare `blockDigest` of the saved block with
   `sum`. *Observable:* equal, although the editor reordered the block's
   attributes, dropped the anchor's `href` and wrapped each table cell in a
   `<p>`; one changed word makes them differ.
   `foundry.prosemirror.dom.serializeString(parseString(html).content)` is the
   same round trip with no window open. This reaches neither the run's counts
   nor its notice; those need the AX3 run above.
9. **The same edit under a repair is listed, and taken only on a yes.** With
   your paragraph back on the page, and again with a word of the block
   changed, run
   `acksExtras.importer.cookbookReimportAdventure("ax3")`, answer the confirm
   Yes. *Observable:* the held-edits dialog lists the page (field
   `text.content`, the AX3 reference). Keep it: the page still holds your
   paragraph. Run the repair again and tick the page: the page is the book's
   again and your paragraph is gone.

### Teardown

10. Delete the journals AND the folders from the pack (`Folder.deleteDocuments`
    with `{pack}` — deleting the entries leaves the folders behind), remove the
    staged PDFs, and reload so the refresh bridge restores the seat's real books.

## An edit inside any imported block is kept

Every writer of a stamped block other than a journal page (that one is steps 8
and 9 above) reads an edit inside the block against the digest its stamp
records in `flags.acks-extras.cookbook.sums`, one per field and block. The
walks below need no book: each builds a disposable document from invented
paragraphs and drives the writer directly. A paragraph of the walk's own,
never the book's, is the text. The editor's re-serialization is part of each
step, since the page is what proves an untouched block is not read as edited.

### Fixtures

1. In the page context: `const P = await import("/modules/acks-extras/scripts/importer/prose.mjs")`,
   `const R = await import("/modules/acks-extras/scripts/importer/refresh.mjs")`,
   `const C = await import("/modules/acks-extras/scripts/importer/cookbook.mjs")`.
   A block is `P.bookText(["An invented passage."], "ZZ 1", {id: "zz.block1", book: "zz", page: 1})`;
   its slot is `P.sumKey(<field path>, "zz.block1")` under
   `flags["acks-extras"].cookbook.sums`, holding `P.blockDigest(block)`.
2. One disposable document per kind, marked
   `flags.world.fixture = "importer/block-edit/<kind>"` and tracked for the
   sweep: a world Item (kind `description`), a RollTable (`table`), a monster
   Actor (`monster`), a location Actor (`place`). Each carries
   `flags["acks-extras"].cookbook = {id: "zz.block1", sums: {...}}` with the
   slot for its field set to the digest of the block it holds: `system.description`;
   `description`; `flags.extras.description.lore`; `system.notes`.

### Steps

3. **A description repair (`description`).** Open the Item, change one word
   inside the passage in the editor, save. Run
   `await R.refreshImported(item, {type: item.type, system: {description: <a block of another invented passage>}, flags: {"acks-extras": {cookbook: {id: "zz.block1"}}}}, {prose: ["description"]})`.
   *Observable:* the returned plan's `keptProse` is `["description"]`, the Item
   still holds the word, and its `sums` slot is unchanged. Put the word back
   and run it again: the description is the new passage and the slot holds
   the digest of the new block. Open the Item and press save without typing
   (the editor reorders attributes, drops the anchor's `href`, reflows lines),
   then run once more: the description is the new passage, `keptProse` is empty.
   With `sums` deleted from the stamp and a word changed, the run rewrites the
   description: no digest reads as unedited.
4. **A roll table (`table`).** Edit a word inside the table's description,
   then `const t = R.mergedTally("keep"); await C.rewriteTable(table, {formula: "1d6", description: <a new block>, results: [{text: "a"}], flags: {"acks-extras": {cookbook: {cite: "ZZ 1"}}}}, t)`.
   *Observable:* `t.edits` holds one edit with `path: "description"` and the
   description is the Judge's, `t.keptProse` is 1. Run it with
   `R.mergedTally({take: new Set([table.uuid + "#description"])})`: the
   description is the new block and the slot is the new digest. A save without
   typing, then the keep run: `t.edits` is empty and the new block is written.
5. **A monster's prose (`monster`).** Edit a word inside the Lore field of the
   actor's Full Monster Sheet, then run `refreshImported` as in step 3 with
   `R.REPAIR.monster` and a build whose `flags["acks-extras"].extras.description.lore`
   is a new block. *Observable:* `keptProse` is `["flags.extras.description.lore"]`
   and only that field keeps the edit; another prose field of the actor, if
   built, is written and its slot advances.
6. **A place's notes (`place`).** Edit a word inside the block, then run
   `const {update, edits} = (await import("/modules/acks-extras/scripts/importer/place-pair.mjs")).rowBlockPatch({...place.toObject(), uuid: place.uuid}, {id: "zz.block1", notes: <a new block of id zz.block1>, cite: "ZZ 1"})`.
   *Observable:* `update` is empty and `edits[0].path` is `system.notes#zz.block1`
   with no `unstamped` mark. After a save without typing, `edits` is empty and
   `update["system.notes"]` is the new block. Delete `cookbook.sums` and edit a
   word: the run writes the new block (no stamp reads as unedited) and records
   its digest.
7. **A character's biography and the abilities pass.** These run only from a
   book. A pregenerated character: edit a word inside the biography's page
   block, then step 2 of "An adventure book's repair writes places in place,
   and holds a Judge's edits" above; *Observable:* the
   edit is listed with path `system.details.biography`. An ability the abilities
   import made: edit a word inside its description's block, run the Update
   step; *Observable:* the result counts it `preserved` and the word stands.

### Teardown

8. `api.sweepTracked()` for the documents built here; the book-bound checks in
   step 7 use the world's own imported documents, which the walk puts back by
   rewriting them from the page.

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
- Two empty places, the second inside the first, made with `api.create`
  and swept every run: a place with nothing in it is pruned at a GM seat's
  `ready`, so it cannot be kept (DECISIONS, 2026-10-28).

### Steps

1. Run the maps step, `cookbookImportScenes({ books: ["ax1"] })`.
   *Observable:*
   - every AX1 map is made, and `missing` is 0;
   - each plan's scene is linked to its place's world copy
     (`flags.acks-extras.location`) and named as that place is;
   - its battlemap flag's `mapSystem` is the recipe's `travel`: `settlement`
     on the fort's overview and each of its building plans, `delve` on the
     dungeon's levels, `journey` on the region map;
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
     level within the encounter zone's schema. The region map carries the
     forest's zone once, over the forest's hexes (p.34), its list the forest
     table and its target alone. The walk logs the figures;
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
`tools/importer/test-book-adventure.mjs` pins the ids, references, fill and
staleness logic behind steps 1 to 7 offline; steps 4 to 7, 9 and 10 are walked
by hand. `tools/live/importer-ax1.mjs` walks, on AX1, step 2's stamp counting
what a fresh server read holds, step 3 (the second run holds, the server write
time unmoved, and no world document of the book is written), step 8 and the
places case: its Adventure carries every AX1 place, each in
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

Note any row with `kind.bookAdventure` and `book: "ax3"`. The step writes
over it. When the shelf holds one this run did not make, get its owner's
go-ahead before step 1 (the walk's `SHELF_OK=1`). Then:

- Keep every Adventure id the shelves hold before the run. Step 5 deletes the
  owner's AX3 Adventure, and the step writes it again under the same id and
  lists it in `created.adventures`. Never track an id from that set.
- Step 1 reads `rebuilt` rather than `written`: the carried fixture makes the
  owner's Adventure stale.
- After the sweep, run the step once more. The owner's Adventure still
  carries the swept fixture Item, and that run rebuilds it from the world as
  it stands. Track and sweep anything that run writes afresh.

**A carried source of your own.** Make one world Item stamped `{ id:
"ax3.fixture~<salt>", book: "ax3" }` with `api.fixture` under
`importer/carried-item`, after retiring one a dead run left standing
(`api.retire`): a standing one rides into every Adventure of the book, the
owner's included, so it is built every run. Steps 4 and 5 change what the
Adventure carries through it, and through nothing else.

Every step is setup, and nothing the walk makes is kept (DECISIONS,
2026-10-28).

The run's own ledger is what the step RETURNS. Pass `created.adventures` to
`api.track`. `created.packs` names a shelf this run made; at teardown, delete
it by that collection id, and only if its index is empty by then.

### Steps

1. `const c = await api.cookbookImportAdventures()`.
   *Observable:*
   - `c.books.ax3 === "written"`, and the notification says so;
   - the shelf's index has a row under `bookAdventureId("ax3")`;
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
   *Observable:* `c.books.ax3 === "held"`; every
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
10. Open Manage Imports on its Books tab on the GM seat.
    *Observable:* the AX3 row reads "In the library as one Adventure:", with
    the stamp's counts.

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
No walk drives it. `tools/importer/test-character-binding.mjs` pins the binding
on invented lines (the boxes a stat line fills, the as-printed block's lines,
the alignment word, a class read behind a qualifier, who owns a character), and
the local-only `tools/rules-tests/test-characters-book.mjs` reads AX1's
characters off the Judge's own copy and holds each box to the page's figures
(class and level, the six scores, hit points, alignment, morale). The steps
below are walked by hand, for what only a world shows: the stamp under the
stable id, the bound class, the rebuild and the Player seat.

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

Every step is setup, and nothing a run makes is kept: what it makes is
what the next import's presence check needs absent (DECISIONS, 2026-10-28).
First retire `importer/claimant` (`api.retire`), the claimant a run that died
before its sweep left standing.

Then read, write nothing: every world Actor shelf and the world, for a
document under any row's stable id. Where one stands and this run did not
make it, stop: it is another session's. The one exception is a library its
owner imported and handed over, holding every row once. Step 1 then rebuilds
all of them through the entry picker, ticking every row. Each keeps its id, so
read each one's `_stats.createdTime` before and after, and track none of them.
Where a library stands for one set only (the inhabitants or the pregens),
step 1 imports the other set beside it.

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
     1 and locked, global light is disabled and `weather` is empty. One
     Region flagged `cookbook.indoors` carries a `suppressWeather` behaviour
     and its rectangle spans `dimensions.rect`. An update naming
     `environment.darknessLevel: 0` alone, as a time module writes it, reads
     back 1. The fort's overview and the region map, which have no walls,
     state none of this: no lock and no such Region. From the **Player** seat, a token of
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

1. The GM seat and the Player seat, and a character the Player owns, kept:
   `api.fixture` finds it again under `importer/lamplighter`, and its step
   gives it back the Player's ownership and one fresh unlit torch before
   anything reads it. It is the one fixture the importer walks keep
   (DECISIONS, 2026-10-28).
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

1. Sweep the run's ledger, all but the character, `sweepTracked({only})`; a
   link Region goes with its map. The character's tokens went at steps 6
   and 10.
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
   server does not hold is read one-off through the Books tab.
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

## An adventure's text: passages, tables, an item and gear

AX1's passages (`kind.prose`), roll tables, appendix item and gear rows
become documents, each holding what the executor reads off its page.
No walk drives the whole recipe: the local-only `tools/rules-tests/test-ax1-text.mjs`
runs the executor over every one of those rows and holds the read to the
shape the steps build from (counts and booleans, never text), and
`tools/importer/test-prose.mjs` pins the text block on invented rows. The
steps below are walked by hand, in the page against `executeEntry`'s read,
for what only a world shows: the journals' ids, order and in-place refresh,
the tables' documents and their roll, the item's folder and the gear's stamps.

What a scripted walk meets:

- After `ready` the GM seat reopens every book it remembers, one at a time.
  The table step reads every open book, so let the open set settle, then
  count every open book's tables. A table the step makes for another book is
  this run's too: find it by uuid and sweep it.
- Each step decides presence by cookbook id. A table or item that stands is
  skipped, not written, so it proves nothing about this build. A journal under
  a passage group's id is written over in place, which is a write onto its
  owner's document.
- A gear entry whose printed name an item in the library already carries
  joins or tags that item (`reconcileByName`), which is a write onto its owner's.
- `importAllEquipment` takes `only` as a Set. The api passes it through
  positionally, so build the Set in the page.

### Fixtures

Read first, write nothing:

- the library's JournalEntry, RollTable and Item documents stamped with AX1's
  ids, and every open book's tables;
- the journals of AX1 that no passage group names (an earlier release's
  keyed-area journal), with each one's page count and `_stats.modifiedTime`;
- every world shelf of those three types and the folders on it, and the
  sidebar's folders of those types.

Stop when a journal stands under a passage group's id
(`journalCookbookId(book, group)`). A table, item or gear row that stands
is the owner's: prove it through the executor's read, never as a
document. The gear step does not run while an item carries a gear entry's
printed name.

Every step is setup, and nothing a run makes is kept. The run's ledger is
what each step returns (`created.journals`, `created.items`) or, where it
returns counts, the uuids the library did not hold before it. It also covers
the folders and shelves found by difference.

### Steps

1. `await acksExtras.importer.cookbookImportJournals({ books: ["ax1"] })`.
   *Observable:*
   - `made` is the passage count, and `updated` and `refused` are 0;
   - `created.journals` holds one journal per group: `Adventure` (10 pages)
     and `Notes` (13 pages);
   - each journal stands once under its group's id, named for its group, in
     the library;
   - its pages are its passages in page order, each titled by `meta.title`;
   - each page's `text.content` is exactly `entryText(node, id, cite)` of the
     executor's read, and no read is empty;
   - each page's last element is the cite line, reading the row's `cite`;
   - the keyed-area journal keeps its page count and modified time.
2. Run step 1 again.
   *Observable:* `made` is 0, `updated` is the passage count, and
   `created.journals` is empty. No journal or page doubles.
3. `await acksExtras.importer.cookbookImportRollTables()`, then track every
   RollTable uuid the library did not hold before it.
   *Observable:*
   - `skipped` is the count of open-book table ids the library held, and
     `made` is the count of new uuids;
   - each AX1 table the library lacked stands once under its id;
   - its results are the read's row bands, built as the step builds them;
   - its bands run without a gap, and its formula spans them
     (`evaluate({ minimize })` and `({ maximize })`);
   - its description is `entryText` of the read;
   - its name is `printedNameOf(node, name)`. `ax1.whereabouts` keeps its
     row's own name, since its header check is a key (`names: false`);
   - `table.roll()` returns one result whose band holds the total
     (`importer-ax1` section 3b runs it on one AX1 table). `draw()` would
     post a chat message.
4. For each AX1 table the library already held, read it through the executor.
   *Observable:* it reads, and its bands run without a gap. `ax1.rumors` and
   `ax1.motivations` each read a paragraph above their grid. A table an earlier
   build made may lack that paragraph, and only the read shows it.
5. Run step 3 again.
   *Observable:* `made` is 0, and `skipped` counts every table now standing.
6. `await acksExtras.importer.cookbookImportAdventureItems({ books: ["ax1"] })`.
   *Observable:*
   - `made` is 1, and `refused` is 0;
   - `ax1.item1` is a library item stamped with its row, in the book's `Items`
     folder;
   - its name is the page's, not the row's ordinal label;
   - its description is `entryText` of the read, and not empty.
   A second run counts it `already`.
7. Gear: in the page, `importAllEquipment({ only: new Set(<AX1's def.equip
   ids>) })`. Track each id's item where its uuid is new.
   *Observable:*
   - `total` and `created` are 3;
   - each item stands once, stamped with its row and book, in a folder;
   - each wears its row's `icon`.
   A second run creates nothing.

### Teardown

8. `api.sweepTracked()` over the whole ledger, then delete any shelf the run
   opened, but only if its index is empty. Quote what the sweep removed, what
   it could not find and what refused.

## A book's items repaired in place

An item a book introduces that the world already holds is passed as already
present by the items step and written over in place by a repair (MODEL, "An
item a book introduces"). Offline, the policy, the plain step's pass over a
stripped item, the tally's repair and the book repair's confirm:
`tools/importer/test-adventure-item-repair.mjs`. The book repair through the
real dialogs, on the run's own items, is "An adventure book's repair, edits
taken" below (`tools/live/importer-force-repair.mjs`).

## An adventure book's repair, edits taken

The Adventures tab's repair, every button of it (MODEL, "An adventure book,
repaired"), with the Judge's edits taken. Offline:
`tools/importer/test-adventure-item-repair.mjs` (the rewrite scope) and
`tools/importer/test-import-manager.mjs`.
Live: `tools/live/importer-force-repair.mjs` walks step 1 (answered No, on each
button) and step 3; `tools/live/importer-forced-places.mjs` walks step 2's
takes through the API's `choose`, its own edits by key rather than the Take
all button, on places and a pregenerated character.

### Fixtures

A book that holds creatures, an item and a roll table, imported once and kept
under the marker `importer/adventure-force@<tag>` on its first creature
(`api.mark`). The walk edits its own copies only: it writes a note into one
creature's biography and one roll table's description and changes one item's
price, all on documents the marker names.

### Steps

1. GM seat, Adventures tab, any of the book's repair buttons; answer **No**.
   *Observable:* a confirm titled *Repair in place* counts the creatures and
   people, places, organisations, items and roll tables it will write over,
   says the market profiles are written onto the places, names the count it
   leaves until after the run, and closes on what is kept; nothing's
   `modifiedTime` moved.
   Before this step, edit one of the book's places (its notes and one roster
   row), one organisation (add a relation and a member), set a market class on
   a place the book's grid prints, and note a pregenerated character's
   biography; the book must have a place row, an organisation row, a market grid
   and a pregenerated character, or the step for the missing one is not walked.
2. Again, answer **Yes**.
   *Observable:* *Your edits and the book* opens, listing each edit above by
   document and field, and the pregenerated character with its three
   answers. Press **Take the book's for every edit** with the character
   answered *Write the book over it*.
   The result is `mode: "repair"` with replaced counts and `taken` equal to
   the edits listed; the edited price and the table's description are the
   build's again, as is a note in a stat-block monster's description; the
   place's roster, the organisation's relations and roster, and the market
   class are the book's again (a base a later book wrote is not); the
   character's biography note is gone and `rewritten` is 1. The character
   holds each item once (count its items before and after: no twin, the item
   a Judge gave it still there); ids, folders and owners are unchanged; no
   document of the book is added or removed; the maps, a library copy dragged
   out and a player's character are untouched. A place two books print has
   its row's block written in place (the recipe "An adventure book's repair
   writes places in place, and holds a Judge's edits").
   The same run answered **Keep every edit of mine** keeps the notes, the
   place and the character as they were, and lists them again on the next
   repair.
3. Player seat: open Manage Imports.
   *Observable:* the Books tab alone; the Adventures tab and its buttons are
   absent.

### Teardown

The sweep removes the ledger's documents; the edited copies are the kept
fixtures and are rewritten by step 2.

## Overhead token art from an installed compendium

MODEL, "Overhead token art from an installed compendium". Offline:
`tools/importer/test-token-art.mjs`, with invented names and paths only.
Live: `tools/live/importer-force-repair.mjs` walks steps 1, 8 and step 4's Make Encounter.

### Fixtures

- A third-party monster compendium module, active in the world. The tester
  checks `game.modules.get(id)?.active` first; turning a module on relaunches
  the world and drops every seat, so ask the seated owners before it. Without
  one, the walk stops at step 1's absence check and says so.
- Two imported monsters from the monster shelf whose names the source answers,
  marked `importer/token-art-a` and `importer/token-art-b`; a third whose token
  the walk sets to a world path (`importer/token-art-own`); a world copy of the
  first with one unlinked token placed on a scene, marked
  `importer/token-art-placed`.

### Steps

1. Open Manage Imports, Tools tab, on the GM seat with the module inactive.
   *Observable:* no Apply button and no Restore button.
2. Activate the source (or use it already active), reload, reopen the tab.
   *Observable:* one Apply button reading the module's own title; no other
   package's packs and none of this module's are offered.
3. Press Apply, then Cancel.
   *Observable:* the confirm shows the counts and the placed-tokens tick;
   nothing's prototype token changed.
4. Apply again, tick the placed tokens, confirm.
   *Observable:* monsters a and b show the source's token image and keep their
   book portrait (`img`), their token width, height and scale; the fit is
   contain; the flag records the source, the new path and the token that stood;
   the own-token monster is untouched and counted as kept; the placed unlinked
   token shows the new image; a linked token follows its actor. A wildcard art
   monster has `randomImg` set. Make Encounter from it: the group's portrait is
   the monster's portrait, not the wildcard path.
5. Press Apply a second time.
   *Observable:* the counts read "already show it" and nothing is written.
6. Rebuild one marked monster, then Apply.
   *Observable:* the fresh actor shows the book token before and the source's
   after.
7. Press Restore.
   *Observable:* a and b show the token they showed before, the flag is gone, the
   Restore button disappears; the own-token monster is untouched. Deactivate the
   source and Restore a freshly applied monster: it still restores.
8. Player seat: open Manage Imports.
   *Observable:* the Books tab alone; no token-art control exists.

### Teardown

`api.sweepTracked()` for the ledger; the markers' monsters are kept and are
restored by step 7.

## A community book's classes, read from their sentences

A class whose spread states its levels in sentences imports with rows, its
throws lent by its chassis, and a held one is repaired in place (MODEL, "A
class stated in sentences"). Offline, on invented pages and classes: the
readers, the experience priced from the build, the repair's keep, a held stub
refilled and a priced figure replacing a typed one in
`tools/importer/test-class-prose-levels.mjs`; the class sheet's stub,
unread-experience and unread-title notices and its build tooltip on a class
read from sentences, one priced, one typed over, a stub and a filled one in
`tools/test-class-sheet.mjs`; the throws a chassis lends in
`tools/test-classes.mjs`. Live: `tools/live/importer-typography.mjs` imports
the book's classes through `importClasses({ only })`, and
`tools/live/classes-level-cap.mjs` opens a class sheet.

### By hand, with the book open

Offline suites run on invented pages, so the printed column is the one thing
only a Judge's copy can answer. Import the book's classes, open each class
sheet, and compare the priced experience column with the printed table by eye,
off the repo: the differences are the errata DECISIONS 2026-10-30 reports, not
a failed read. Where the world holds no builder tables (`acks.classBuilder`),
each imported class leaves experience unread past the first level and its sheet
names the page to copy it from. A book repair (`cookbookReimportBook(book)`)
takes no `only` and writes over every document the world holds from the book,
its items and abilities too: run it when no peer is walking that book's other
surfaces.

## A community book, read through its declared typography

`cat` is set off the family's ladder (MODEL, "A book's typography"). This
walk proves the tagged read reaches the seat, not only the compiler: an
untagged seat would read every line as a heading and import nothing.

### Fixtures

- The book staged as `acks-test-books/cat.pdf` on the server
  (TEST_ENVIRONMENT.md, "Staged files"), connected with
  `acksExtras.importer.connectBookUrl("cat", "acks-test-books/cat.pdf", { remember: false })`.
- Nothing else: every document below is created by the import and swept by
  its id. Every step is setup, and nothing is kept: a standing import is what
  the next run's first import needs absent (DECISIONS, 2026-10-28).
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
   and a count of what imports from it; the Books tab lists it as open
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
   paragraph of description closed by a page reference, each priced from its
   cost line, the eight worn ones declaring one slot (four at the hands, two
   at the belt, two at the uncapped worn place) and marked magic, the two
   doses declaring none; a copy of a worn one embedded on the keeper is
   offered on her Follower Card and the card's toggle wears it at its slot
   and puts it away again; the series' OPEN Item
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
   of nothing; a core character on
   the Judge Actor shelf under "NPCs", named from the page and owned by
   nobody,
   her class one of the book's three (bound, so the class's hit dice,
   throws and saves are derived; its titles are the Judge's to type) at the
   printed level, her six scores and hit
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
   the ten items and none of the classes or powers; the GM's Books tab row
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

## A held plan's travel system

What the map step's repair brings to a held map besides its lists: the
declared travel system, where the map still carries the mark the step minted
before recipes declared one. `repairHeldMap` is exported for this walk.

**Fixtures** (kept, by marker): `formation/t0361-delve` — a scene with a
square 70 px grid at 10 ft, `flags.acks-extras.battlemap`
`{calibrated: true, distance: 10, autoScale: false, mapSystem: "delve"}`;
`formation/t0361-party` — an `acks-extras.party` actor, with
`formation/t0361-a` and `-b` as its members. The party token the walk places
is a create path: track it and sweep it.

1. Write the minted mark on the scene: `mapSystem: "journey"`. Set the
   party's mode to journey (`travel.setJourneyMode(id, "journey")`), zero
   its clock, place the party token on the scene and wait for adoption
   (the record's `tokenId` becomes the token's).
   *Observable:* the record's `travelOf(...).mode` is `journey`.
2. In page context, `repairHeldMap({ grid: { family: "square", size: 70,
   distance: 10, units: "ft" }, travel: "delve" }, scene)`.
   *Observable:* it resolves `1`; the scene's `battlemap.mapSystem` reads
   `delve`; within two seconds the record's mode is `delve` — the formation
   module's `updateScene` hook re-adopted it for the standing party, no
   formation code of the repair's own.
3. Move the token 12 cells with `{animate: false}`.
   *Observable:* `clock.turnsTotal` 1, one "dungeon turn(s) pass" card under
   the party's name.
4. Call the repair again on the same scene. *Observable:* `0`; nothing
   written.

Teardown: sweep the token and the party's card by their uuids; leave the
scene's mark at `delve`. Walked 2026-10-29, steps 1–3: written 1, mode
journey → delve, the drag billed 1 turn, no console errors; sweep removed
the token and the one card, none missing, none refused. Step 4 is held
offline by `tools/importer/test-region-import.mjs` ("and is not written
twice"), beside the cases the repair must refuse: a mark that is not the
minted one, and a recipe declaring no travel.

## A family's rebuild with a copy in the sidebar

### Fixtures

- `monsters/beastman-pre-11-14` — a template actor in the Actors sidebar
  carrying the family stamp (`flags["acks-extras"].cookbook.id`
  `mm.familyBeastman`) and `_stats.compendiumSource` naming a library
  template, so `isWorldCopy` answers true: what a Judge's drag out of the
  library leaves. Built from the library template's `toObject()` with no Kit
  axis, no kit cell and no default on the Role axis, so a write to it shows.
  A kept copy's `_stats.compendiumSource` is not trusted: each walk writes it
  with an update and asserts it equals the library template's uuid before the
  step that needs it.

### Steps

The Monstrous Manual open on the seat (`acksExtras.importer.bookOpen("mm")`;
a fresh seat opens its books one by one after `ready`, and the entry picker
lists only an open book's rows, so wait for it first). Drive the picker
(Manage Imports → Tools → (Re)import individual entries) in short page calls:
open it, tick `Monsters|mm.familyBeastman`, press Reimport, press Yes, and
leave the run's promise on the page; poll for it to settle. A single evaluate
held over the import outlives the driver's timeout, and closing the page then
kills the run part-way.

1. Reimport, answered Yes. *The confirm, titled Repair in place, counts no
   document of the copy; the library template stamped `mm.familyBeastman` is
   written in place under its id, with the current Role axis (its default
   Standard); no "already covers" notice; the copy's `system` is
   byte-identical before and after.* Where *Your edits and the book* opens,
   the copy is not among its rows.
2. Repair everything pressed on the Import tab (Settings tab → Game Settings →
   ACKS II — Extras → Manage imports), answered No. *The one confirm lists the
   bestiary's part with its own-rows line; the observer holds no create, update
   or delete.*
3. The library's template of the family written with no Kit axis, no kit cell
   and the Role axis without its default, and the sidebar copy the same. Manage imports → Rebuild → the bestiary's pick → Go. *The confirm
   is titled Repair in place and carries the own-rows line once.* Answer Yes,
   and Keep every edit of mine where the choice opens. A bestiary repair
   refills every held creature of the book: minutes, so poll the manager for
   its busy line to clear in short page calls. *One library template stands
   under the same id (no twin), with the current Role axis and a Kit axis and
   its cells; the sidebar copy's `system` is byte-identical before and after;
   the notice reads Repaired in place.* Walked by `importer-book-actors`; its
   wall clock is its own (`WALK_WALL_MS`).

### Teardown

The fixture is kept. The library template is left in the current shape.
