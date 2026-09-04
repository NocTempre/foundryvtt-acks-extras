# Live-test recipes

> Merged from the separate acks-importer repo on 2026-09-01. Text written before then names paths as they were there: `scripts/x.mjs` is now `scripts/importer/x.mjs`, `tools/x.mjs` is `tools/importer/x.mjs`, `flags["acks-importer"]` is `flags["acks-extras"]` (the importer's `generated` key is now `minted`), and `acksImporter.fn()` is `acksExtras.importer.fn()`.

The canonical procedure is `.claude/rules/live-testing.md` — read it first.
This file records only what is specific to this repo: the fixtures each surface
needs, the steps that exercise it, and the observable that proves each one.

`validate` and `npm test` here run against mocked globals and against page
geometry with no Foundry at all. They gate the arithmetic; only a live run
gates that anything reaches a document.

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

Import rules tables ("Import Rules Tables (GM)", then "Create Foundry Tables
from Rules Import (GM)"), confirm the sidebar holds "ACKS Imported Tables"
with per-doc subfolders and readable names, then run "Remove ALL Imports
(GM)". *Observable:* the confirm counts the materialized rules-table
documents; afterwards the folder tree, its RollTables, and the "ACKS Ruledata
(Imported)" journal are all gone, while the imported table DATA still answers
(the ruledata browser still lists tables, and re-running Create Foundry
Tables rebuilds the documents without re-importing).

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
   *Observable:* bundles and gear are in the SIDEBAR under
   `Class Templates / <Class>` — they are world documents on purpose — and the
   class sheet lists them. This is the acks-extras library reader working: a
   blank list here means it is reading `game.items` somewhere.
7. Open an imported template actor and press Generate.
   *Observable:* the new creature is in a top-level **Generated** folder in the
   Actors sidebar, not in the pack and not beside the template.

### Teardown

"Remove ALL Imports (GM)". *Observable:* the confirm counts the packs' contents
AND the class-template documents; afterwards `game.packs` holds no
"ACKS Cookbook — …" pack, and no orphan is left in the sidebar —
`game.items.filter(i => i.flags?.["acks-extras"]?.templatePart).length` is 0.

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

*Observable:* the "ACKS Importer — Macros" compendium holds FOUR macros in two
folders — your books, import everything, reimport one shelf, delete everything.
A fifth is a regression.

Reimport one shelf, e.g. Weapons:
*Observable:* the confirm names the count; afterwards the shelf holds exactly
what it held before and the pack's total is unchanged (38 removed, 38 written,
1,008 either side). Nothing on another shelf is touched, and a class template's
documents are never among the deleted — they carry acks-extras' stamp.

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
   game.items.filter(i => i.getFlag("acks-extras","ammunition")).map(i => `${i.name} [${i.type}] ×${i.system.quantity?.value} enc6=${i.system.weight6} ${JSON.stringify(i.getFlag("acks-extras","ammo") ?? null)}`)
   ```

   Four rows, all `[item]`. The case and the quiver read `×1` with an `ammo`
   flag naming their load; the sling stones read `×30` with none. A run where
   any of them is `[weapon]` means the type column was not read and the rows
   fell back — which is silent on a sheet except for a damage die nobody can
   explain.
2. Check the arithmetic the page states, not the one the sheet renders.
   *Observable:* `quantity × weight6` equals the printed encumbrance for every
   one of the four — 1 for the case, the quiver and the stones, 0 for the
   silver arrow. A stack whose per-unit weight was rounded to an integer shows
   here as 0, and as a character who can carry thirty stones for free.
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
connected; bundles and gear land in the SIDEBAR under `Class Templates /
<Class>` and tables under `Class Templates` (world documents by design — a
package exists to be repaired, and imports live in a pack); and after
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

### Teardown

11. Delete the folder and everything created, and the hand-made fixtures from
    steps 8 and 9.

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
   x/y so a `cellColumns` box can be read off the page.
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

**Teardown:** none. Importing tables registers world ruledata; re-running is
idempotent and no documents are created.

## The hit-point floor and the post-9th rates import

**Fixtures.** None beyond a connected Revised Rulebook and Judges Journal.

**Steps.**
1. Run Import Tables with both books connected.
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
