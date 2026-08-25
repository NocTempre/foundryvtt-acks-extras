# Location — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

## Fixtures

- A disposable `acks-extras.location` actor.
- A disposable `character` to store goods and coin in it.

## Core drive mechanics (non-obvious, learned live)

- **A location starts with no market, and most of its sheet with it.** A fresh
  location shows only Contents / Storage / GM Settings / GM View. Pressing
  **Add a market** (`data-action="addMarket"`) is what raises the Recruitment,
  Henchmen, Mercenaries, Specialists and Trade tabs — so any henchmen or
  markets check against a location has to add the market first or its tabs are
  simply absent, which reads as the feature being broken.
- The market subtree is `system.market`, and it holds far more than goods:
  postings, candidates, slander, the search ledger and the market log all live
  there. It goes away with the location, which is what makes a location a
  clean disposable fixture.
- `openStorageManager()` and `openRuledataBrowser()` take **no arguments** —
  they are world-wide GM tools, reachable from the settings menus as well.
- A location is a storage **provider** (`lib.storage.isProvider`) as soon as it
  exists; nothing has to be enabled for goods to be stashable in it.
- Coin stored in a location belongs to `HOUSE_OWNER` unless stamped with an
  `ownerUuid`, and that sentinel is deliberately unresolvable — no character
  can claim house coin.

## Steps

1. Create the location and open it.
   *Observable:* `LocationSheet`, with Contents (0) and Storage (0).
2. Press **Add a market**.
   *Observable:* Market class and search fee appear; the Recruitment,
   Henchmen, Mercenaries, Specialists and Trade tabs appear, Trade carrying
   the shipped catalogue's row count.
3. Storage: stash an item and coin from the character (see
   [../lib/TESTING.md](../lib/TESTING.md) for the argument order), then
   retrieve them.
   *Observable:* Contents and Storage counts move; `storedItems(location)`
   tracks the item; house coin and the character's own stored coin are
   attributed separately.
4. `openStorageManager()`.
   *Observable:* `StorageManager` lists this location as a place, offers
   "let an actor hold goods" and "give a character a vault", and each control
   changes what `providers()` returns.
5. `openRuledataBrowser()`.
   *Observable:* `RuledataBrowser` lists the tables imported from the GM's own
   books — and says so; with nothing imported it is empty rather than showing
   shipped samples. Entries carry reader-facing labels ("Class Percentages —
   Level 0"), not raw dotted keys.
6. With tables imported, materialize and remove:
   `acksExtras.lib.services.get("ruledata-import").materializeDocs()`, then
   `countMaterializedDocs()`, then `removeMaterializedDocs()`. The write COUNTS
   are gated offline (`node tools/test-table-docs.mjs`); what only a live run
   proves is that the batched calls reach real documents.
   *Observable:* the sidebar gains "ACKS Imported Tables" with one subfolder
   per ruledata doc and readable table names (identity in
   `flags["acks-extras"].tableKey`); the count matches the tree plus the
   journal; after removal the tree and journal are gone while the browser
   still lists every imported table, and a second `materializeDocs()` rebuilds
   the documents without re-importing.
   *Also observable, and the point of the batching:* a full materialize on a
   multi-book world completes in seconds, and an immediate second run reports
   the same totals while writing nothing at all — no result rows rebuilt and
   no document touched, so the tables' "last modified" times do not move.
   Check the rows actually carry their labels: blank entries with correct
   ranges is what a broken `description` looks like, and a count-based check
   sails straight past it.
   *The churn check, which is where three separate bugs have hidden:* compare
   every rollable table's `TableResult` ids across **three** passes, and make
   one of those passes follow a real change. Nothing but a genuinely changed
   table may get new ids, and a table that legitimately rebuilt must be
   settled again on the pass after. Two known traps, both invisible in the
   documents themselves: the **ampersand tables**
   (`people.occupationSubTables.artisan` and `.merchant`, whose entries read
   "grain & vegetables") — storage normalizes a bare `&` to `&amp;`; and
   **anything freshly rebuilt** — an embedded collection reads back in its own
   order, not the one it was written in.
7. Vault sweep: `runVaultSweep()` with the prune setting on and a location
   holding goods past its window.
   *Observable:* the sweep reports what it would take before taking it, and
   turning the setting off stops it.
8. "Recover Coin from Unloadable Locations (GM)": build a pre-upgrade shape
   first — recover an old sub-type's location definition from git
   (`git show <tag>:<path>`) and create it as a world document — then run the
   macro.
   *Observable:* the coin inside the unopenable actor is listed and minted
   onto the chosen actor exactly once; the location itself is left untouched.
   Running it twice mints twice, which is the documented behaviour and worth
   confirming rather than discovering.

9. **A place held in a COMPENDIUM.** Import an authored adventure with
   acks-importer (`acksImporter.oseImportAreas("pc3")` — one adventure plus 32
   rooms). Since acks-importer 4.3.0 these land in the pack for the book's own
   SERIES — "ACKS Cookbook — Planar Compass — Actor", not the shared
   "ACKS Cookbook — Actor" — so find the pack by label rather than assuming it.
   Then open the adventure's sheet.
   *Observable:* `CONTENTS (32)`, one drillable row per room, and no "Nothing
   is kept here yet". A room's own sheet breadcrumbs back to the adventure, and
   clicking a content row opens that room. The pack index must carry the
   pointer — `[...pack.index].filter(r => r.system?.parentUuid).length` is the
   room count, and it is 0 if `CONFIG.Actor.compendiumIndexFields` was not
   extended before the index built, which needs a **world relaunch**, not an
   F5.
10. Drag one room out of the library into the world
   (`game.actors.importFromCompendium(pack, id)`).
   *Observable:* the world copy still breadcrumbs to the adventure in the
   library, and the adventure now lists BOTH copies — two documents do name it,
   and the sheet says so rather than choosing one.
11. **The roster on a packed place.** Write one occupant row onto a location
   held in a compendium and re-render.
   *Observable:* `WHO IS HERE (1)` naming that occupant. The roster is stored
   on the document rather than scanned for, so this is the check that it never
   depended on `game.actors` in the first place. Read the context AFTER the
   update settles: a `_prepareContext` taken in the same breath as the
   `update()` reports the old roster and reads as a bug in the pane.

   **The row needs a resolvable `uuid`.** A roster entry whose `uuid` is `""`
   is stored on the document exactly as written and then counted by nothing —
   `headcount` stays 0 and `occupants` is empty, which reads as the pane
   ignoring the roster. It is the fixture that is wrong, not the pane: point
   the row at a real document. The element fields are
   `{uuid, name, img, kind, quantity, ownerUuid, notes, hidden}` and `kind` is
   one of `actor | group | monster | henchman | place`.

## Teardown

Delete every document the compendium steps imported (filter the pack index by
`flags["acks-importer"].cookbook.book`), and the location and the character. Confirm nothing the storage steps
created survives — `game.items` holds no fixture goods, and `providers()` no
longer lists the location.
