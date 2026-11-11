# Adventures taken out of the library on demand, and Clear Unused (wip)

> **Status: PROPOSAL — NOT IN EFFECT.** An architect's design (2026-11-04) for
> the owner's two requests of 2026-11-03: an adventure keeps its links without
> putting everything in the world, taking out only what is in use; and a clear
> button that removes everything except maps with player characters present
> and documents a player owns or can see. Nothing here is ruled. The five
> questions at the end are the owner's. When a slice lands, its substance moves
> into MODEL, DECISIONS and TESTING, and this file is deleted. Line numbers are
> from the tree of 2026-11-04; cite symbols once it moves.

## How an adventure imports and links today

- **Import Everything puts every map, and what stands on it, into the world.**
  `cookbookImportScenes` runs `importScene`, which carries the map's places,
  quarters, rooms (with their parent chain) and the book's organisations
  across as world copies owned by nobody (`bringAcross`, the `worldCopy` flag;
  library ids kept as `worldCopySource`), then `Scene.create(mapCreateData(…))`.
  The scene's id is core's: `mapCreateData` sets no top-level `_id`.
- **Everything else stays shelved.** People, pregens, monsters, journals,
  lists and items live on the Judge's world compendia, closed to players
  (`JUDGE_SHELF_OWNERSHIP`, `lib/library.mjs`).
- **The book's Adventure.** `ensureBookAdventure` and `bookAdventureSource`
  write one Adventure per book to the Adventure shelf. Each map is rebuilt
  from its recipe under the world scene's ids where one is held, and under the
  seed's ids otherwise (`withWorldIds`, `adventure-binding.mjs`). Its import is
  steered (`steerImport`): `fillPlan` creates only what the world lacks, and
  `afterImport` re-mirrors the place links and runs the link pass.
- **Links.** A token names a world actor by `actorId`. Scene and region link
  flags are authoritative, and a place's `sceneUuid`/`regionUuid` mirror them.
  Teleports name relative Region uuids. Rosters, journal links and list rows
  are library uuids.
- **What a delete breaks.** A deleted world map leaves teleports into it doing
  nothing (core logs and returns). A rebuild while the map is absent gives it
  the seed's id, not its old core-minted one, so **a map does not come back
  under its old uuid today**: the link pass re-joins what it knows, and
  anything else that named the old id dangles.

## Where the canonical copy lives

On the Judge's own world shelves, which already exist: the importer writes
world compendia from a GM client (`ensureLibraryPack` →
`CompendiumCollection.createCompendium`), and the Adventure shelf has shipped
since 11.10.0. Nothing ships in the module, so link-on-demand needs no change
to the IP posture. A world compendium belongs to one world, so carrying an
adventure to another world stays on the ROADMAP.

## Link-on-demand

**Taking out = the existing fill, narrowed to what was asked for.**
`adventure.import({dialog: false, "acks-extras": {roots}})` reaches
`preImportAdventure` with the options, and core creates with `keepId`.
`fillPlan` gains `roots` (in place of "every document is a root") and
`followHeld: false`, so a put-away map that a world document names is not
pulled back. The closure is unchanged (`refsOf`): a map brings its tokens'
actors, its city and quarters and each room's parent chain, and taking out a
place brings its map. The smallest unit is **a map and what stands on it**,
the unit importer DECISIONS 2026-09-17 says must be world documents together.
A second mode, Restore missing (`followHeld: true`), mends a hand deletion.

**Built beside the narrowed fill:**
- **An id ledger** in the book's stamp: cookbook id → world id for every
  carried document, a scene's regions, tokens and walls included, which
  `withWorldIds` prefers to the seed. Worth having on its own: it makes
  "every rebuilt document keeps its id" (2026-10-28) true of scenes.
- **Zones laid from their rows**, as link ends already are, since today a zone
  is carried only from a map held in the world.
- **A controls pass after each take-out**, so an organisation already in the
  world gains the quarters of a map taken out later (`claimControlledQuarters`
  runs only inside `importScene` today).

**When a document comes out:** the Judge takes a map out from the Adventures
tab's per-map list (each map shown as in the world or on the shelf); a place
sheet's "open the map" takes its map out; a pregen handed out keeps core's
Import, which keeps the id. A shelf journal cannot be shown to players
(`_showEntry` resolves the uuid on the player's client, and the shelf is
closed to them), so it comes out first.

**Existing worlds:** nothing is deleted on upgrade. One Repair after the
ledger ships records the world's existing map ids; the first dry-run clear is
the migration; the clear refuses a document its book's ledger does not name.

## Clear Unused

On the Tools tab beside Remove All Imports; it never touches a shelf, an
Adventure, a template part or a materialized rules table.
`clearUnused({dryRun})`, on the pattern of `pruneEmptyLocations({dryRun})`.

- **May remove:** world Scenes, Actors, Items, JournalEntries and RollTables
  that a book's Adventure carries, and their importer folders. Anything with
  no shelf copy to restore from is kept, reason "no shelf copy".
- **In use, kept:**
  - a map with a token whose actor a non-GM user owns (party and group tokens
    through their members; marker actors skipped), the active scene or a
    connected player's viewed scene, a map with a combat, or a map the Judge
    has worked on (question 2);
  - an actor, item or table a non-GM user can see at LIMITED or more, or a
    user's character; places that are vaults, markets or held by a domain;
  - a journal with persisted OBSERVER or more on the entry or a page (a forced
    show grants ownership only in memory and leaves no trace);
  - everything a kept document names: `refsOf` slots, every token's actor on
    a kept scene, combatants, group and party members, the parent-place chain.
- **Guard:** the dry run lists every document by uuid in two groups, removed
  and kept with a reason; the confirm states counts per type; at confirm the
  plan is recomputed and only what is in both the new plan and the shown list
  goes; active GM seat only; scenes first, folders last; the result is
  returned as uuids.
- **Coming back:** Take out or Restore missing, under the same ids, followed by
  the mirrors, the link pass and the controls pass.

## Questions for the owner

1. **Does Import Everything still put a book's maps in the world?**
   (A) No: maps go to the Adventure only and come out on use. (B) Yes, as
   today, and the clear trims them. (C) A setting. Recommended: A.
2. **A map the Judge has worked on** (notes, drawings, their own tokens, fog):
   (A) counts as in use and is never removed, detected by embedded ids absent
   from the carried source; (B) is set aside on a closed shelf and restored
   with the work (needs a Scene shelf); (C) is removed, and restore brings back
   the book's version, which the confirm says. Recommended: A first.
3. **What takes a document out automatically?** (A) Only the Adventures tab
   and the place sheet. (B) A, and a teleport into a map not in the world
   (needs a hook ahead of core's teleport; unproven). (C) A, and Show Players
   on a shelf journal. Recommended: A first.
4. **What can the clear reach?** (A) Only what a book's Adventure carries.
   (B) Every importer world document with a shelf twin. Recommended: A, the
   only ones whose restore keeps links.
5. **What does "visible to a player" mean?** (A) LIMITED or more.
   (B) OBSERVER or more. Recommended: A.

**Answered 2026-11-11: A to each of the five.** The proposal is otherwise
unchanged and still not in effect; the answers move into DECISIONS with the
first slice that lands.

## Slices, for a later release

| | Slice | Effort |
|---|---|---|
| S0 | Probes: does a scene's delete delete its fog; `roots` through `steerImport`; the Scene shelf round trip if 2B | 0.5 day |
| S1 | The id ledger; `withWorldIds` prefers it; offline: delete, rebuild, same ids | 1 |
| S2 | Zones laid from rows; the maps step stops putting a book's maps in the world (question 1) | 1.5 |
| S3 | `roots`/`followHeld`, the take-out api, the controls pass, the per-map list, the place-sheet trigger | 2 |
| S4 | The in-use reader (pure half in lib, mutation-checked) and the dry run | 1.5 |
| S5 | The clear: confirm, recompute guard, delete order, the Tools button, restore | 1.5 |
| S6 | Docs: importer MODEL, TESTING, DECISIONS, the guide | 1 |

The in-use rules are walked live from a **Player seat**: a GM seat passes
every ownership check and would report a false pass.

## Rejected

- Dragging maps out of the compendium: a dragged scene names library actors
  (DECISIONS 2026-09-17's own reason).
- Taking out one document at a time: places and organisations must stand in
  the world with their map.
- Telling a touched map by hash: the hash drifts as data models change
  (DECISIONS 2026-10-17).

## What it would supersede

DECISIONS 2026-09-17 "A map and what stands on it are world documents, owned
by nobody" on WHEN maps stand in the world, not on WHAT stands there; 2026-10-17
"Every carried document is a root", narrowed for take-outs; 2026-10-28 "Every
rebuilt document keeps its id", extended to scenes.

## Not verified

Whether deleting a scene deletes its fog; whether a hook can act before core's
teleport; a Scene's round trip through a compendium with its embedded
documents intact. Everything above is read from code and docs; nothing was
run live.
