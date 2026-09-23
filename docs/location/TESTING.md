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
- **A character's reach list is on ONE of two surfaces, never both**, and which
  one depends on whose character sheet the world is using. `installStorageTab`
  returns early on a sheet this module owns, so with the module's sheet active
  there is no **Storage** tab at all — the list is the **Kept elsewhere** rule
  at the foot of the **Equipment** tab, and it prints the refusal SENTENCE in
  the row. On the system's own sheet the Storage tab appears and the same
  refusal is only a `data-tooltip` behind "Out of reach". Looking for a Storage
  tab on the module's sheet finds nothing and reads as the tab having failed to
  inject.
- **Both seats are read, and they must agree.** `depositReach` asks about the
  CHARACTER, so a Judge and a player get the same answer about the same sheet;
  quoting only one seat is what let a seat-keyed ownership test hide behind a
  Judge's blanket `isOwner` for as long as it did. Give the character to the
  Player seat, leave the places at OBSERVER for it, and read both.
- **A `can: true` carrying `scene: null` has been answered by a TITLE, not by a
  short-circuit** — the vault clause, `ownersShare`, a pin and a companion's
  ownership all answer that way and all are correct. It is not a defect tell,
  and reading it as one sends you hunting a bug that is not there. To find out
  which answered, delete the place's token and ask again: only a ground answer
  flips to a refusal.
- **`update()` MERGES an ownership object, so `{default: 0}` strips nothing.**
  Foundry stamps whoever creates a document at OWNER, so a fixture built from
  the Judge's seat is owned by them, `ownersShare` answers for it before the
  ground is ever consulted, and every reach step passes no matter where the
  tokens stand. Name every user explicitly —
  `Object.fromEntries(game.users.map((u) => [u.id, 0]))` — when a place is
  meant to be reachable only by standing beside it.

- **What a sheet LISTS is a different question from what reach ALLOWS, and a
  fixture built from the Judge's seat cannot tell them apart by reading
  `canReach`.** The listing rule (`listsWhenEmpty`) ignores ownership, so an
  empty fixture place the Judge created is absent from the list while
  `depositReach` still says `can: true` about it from the row it is not in.
  Probe the list itself: `buildEquipmentTab(actor).elsewhere` under
  `await import("/modules/acks-extras/scripts/character-sheet/tabs/equipment.mjs")`
  in page context returns exactly what the Equipment tab will draw, which is
  reachable in a backgrounded pane where the rendered rows are awkward.
- **`stash(source, provider, spec)` takes a LIST of item ids**
  (`[item.id]`, or `[{id, quantity}]`), not an options bag. An object is read
  as an empty iterable and throws `(spec ?? []) is not iterable` from
  `readSpec` — which reads as a broken storage API rather than a wrong call.

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
   *Observable:* "ACKS Cookbook — RollTable" gains "ACKS Imported Tables"
   with one subfolder per ruledata doc and readable table names (identity in
   `flags["acks-extras"].tableKey`), "ACKS Cookbook — JournalEntry" gains
   "ACKS Ruledata (Imported)", and the sidebar gains nothing; the count
   matches the tree plus the journal; after removal the tree and journal are
   gone while the browser still lists every imported table, and a second
   `materializeDocs()` rebuilds the documents without re-importing.
   *The upgrade shape:* build the pre-upgrade sidebar by hand — a RollTable
   folder "ACKS Imported Tables" flagged `ruledataDocs`, a child folder, one
   table in it flagged `tableKey` with a real entry key, and a journal "ACKS
   Ruledata (Imported)" flagged `ruledataDocs` — then `materializeDocs()`.
   *Observable:* the three are gone from the sidebar and their shelf
   counterparts exist; a second run writes nothing (the tables' "last
   modified" times do not move).
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
   the importer (`acksExtras.importer.oseImportAreas("pc3")` — one adventure plus 32
   rooms). These land in the pack for the book's own
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

12. **Deposit reach, through a place's own token.** Drop the location's token
    onto a scene the character's token is also on, one empty square away, and
    open the character's reach list.
    *Observable:* the place is offered with its deposit control live. Drag the
    place's token four squares off and re-render: the control is gone and the
    row reads "You must be at &lt;that scene&gt;".

    **Drop the token the ordinary way — do not link it.** An unlinked token is
    Foundry's default and is the shape the reach test has to survive; a token
    with `actorLink` on passes a check that a Judge's own token would fail, so
    a linked fixture proves the wrong thing. Confirm what you dropped with
    `token.actorLink` before reading anything off the tab.

13. **The same place, reached by a party.** Put the character into a formation
    with a placed party token, and move the PARTY token next to the place's
    token. The character's own token is gone — `addMember` deleted it.
    *Observable:* the deposit control is live again, driven by the party token.
    Move the party token away and it refuses, naming the scene.

14. **A linked place, and a party inside it.** Link a scene to a second
    location (`linkScene`), then put the party token on that scene.
    *Observable:* every member of the formation can deposit, not just a member
    who happens to own it. This is the half that was refusing the whole party,
    and it cannot be seen from one character's sheet alone — check a second
    member's sheet too, joined as that member's player.

14b. **A detached member stands where the deploy put them.** Detach one member
    from the party sheet and move the token the detach created next to a place's
    token, leaving the party token many squares away.
    *Observable:* that member can deposit and the members still riding cannot.
    Then deploy a member as a STACK instead: the stack's bodies are built from a
    template actor, so the cell keeps answering through the party token — park
    the bodies at the place and confirm the cell is still refused, and that the
    party token beside the place still lets it through. The two deployment kinds
    answer differently on purpose; a Judge reading it as a bug is the reason it
    is written down.
14c. **A formation with no party token falls back to its members' own tokens.**
    Delete the party token from the canvas — the formation survives, unlinked —
    with a member's own token standing on a scene linked to a place.
    *Observable:* that member can deposit there. Before this they could not
    deposit anywhere at all, and the refusal named the very map they were on.
14d. **An unlinked copy reaches only what IT is beside.** Drop two unlinked
    tokens of one hireling: one next to a cart place's token, one on a distant
    scene. Open the sheet of the DISTANT copy, joined as the player who owns it.
    *Observable:* the cart is refused. One token is one body; the copy beside
    the cart still reaches it from its own sheet.
14e. **The same answer on both seats.** Read one place's row from the Judge's
    seat with a player's sheet open, and from that player's own seat.
    *Observable:* the two agree. A Judge owns every document, so a seat-keyed
    ownership test reads `can` for every unlinked place in the world and hides
    the whole gate — quote both answers rather than trusting one.
15. **The two refusals are different sentences.** Read the reach list against
    a place whose token is on some other scene, and against a place with no
    token and no linked scene at all.
    *Observable:* the first says you must be at a named scene; the second says
    it is not yours. A "you must be at" with a blank scene name is the defect
    this step exists to catch.

16. **A floor above is not underfoot.** Raise the place's token's elevation by
    more than the scene's own square distance (`scene.grid.distance`) with the
    party token left at ground level.
    *Observable:* the deposit control goes away. Lower it to within one square's
    distance and it comes back.
17. **A place's token is a marker.** Create a location actor without stating a
    picture and drop its token on any scene (`const td = await
    actor.getTokenDocument({x, y}); await scene.createEmbeddedDocuments("Token",
    [td.toObject()])`; track the token by id).
    *Observable:* actor and token both show core's house; the token's name
    shows on hover for anyone, it has no bars, a neutral disposition and sight
    off. Create a second one WITH `img` and `prototypeToken.disposition`
    stated: both are kept. `prototypeToken.actorLink` is whatever core gave it
    — the hook never sets it.
18. **It is not a body.** Link the scene to a second disposable place and open
    that place's Roster; select the point's token and open the token HUD;
    change the point's actor in a way token sync would follow (its senses).
    *Observable:* the roster lists every creature's token and NOT the point;
    the HUD shows no **Add to party**; the token neither lights nor sees.
19. **A quarter's own place.** On a scene carrying a District Region
    ([../formation/TESTING.md](../formation/TESTING.md) steps 15–16), open the
    behaviour's sheet: the **Place** row lists every location actor and a
    **+** button. Press **+**.
    *Observable:* a place named after the Region appears, inside the scene's
    place when the scene is linked;
    `acksExtras.location.scenes.locationOfRegion(region)` returns it and its
    `system.regionUuid` is the Region's uuid. Pick **— none —**: both ends
    clear. Pick it again: both set. Delete the Region: the place survives with
    `regionUuid` empty. Track the place the button made by id.
20. **A placed or quartered place survives the prune.** With the prune
    setting on, run the sweep — it is not on the api:
    `(await import("/modules/acks-extras/scripts/location/module.mjs")).pruneEmptyLocations()`.
    *Observable:* the quarter's place (empty, but a quarter) and the point
    (empty, but standing on a map — hide its token and run again) survive; an
    empty place with no token, no link and nothing in it goes.

The repair tool's location checks (stale links, banked coin, storage whose
owner is gone) are walked in docs/lib/TESTING.md, "The repair tool".

## Teardown

Delete every document the compendium steps imported (filter the pack index by
`flags["acks-extras"].cookbook.book`), and the location and the character. Confirm nothing the storage steps
created survives — `game.items` holds no fixture goods, and `providers()` no
longer lists the location.
