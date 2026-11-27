# Library reads off the index: build plan (wip, 2026-11-27)

In-flight plan for `docs/lib/ROADMAP.md`, "Library reads off the index". The design (sections 1 to 11) is
the architect's. The section below it holds the planning session's rulings, which settle the design's open
questions. The build session reads both, appends its results under "Results" at the end, and deletes this
file when the last slice lands (`.claude/rules/docs-doctrine.md`, wip lifecycle).

## Planning session's rulings (2026-11-27)

1. **Step 0's script stays parked, and the build runs it untracked.** `tools/live/perf-leads.mjs` was moved
   to `parked/unjustified-checks` by `e35040ed`, under the owner's "I want you to park on a branch every walk
   and test that is not justifiable under the principles I just described. They must catch errors not found
   otherwise and not require agent supervision." A measuring tool that an agent runs and reads is not
   brought back onto `main` without the owner's word. Instead, write it to its old path from the parked
   branch, so its relative imports resolve:
   `git show parked/unjustified-checks:tools/live/perf-leads.mjs > tools/live/perf-leads.mjs`.
   Then add `tools/live/perf-leads.mjs` to `.git/info/exclude`, so it is never staged. S0's extensions (the
   census, the quiet queries, the post-eviction read, the player seat) are made to that untracked copy. The
   S0 marks in `scripts/lib/library.mjs` land with S1. The junction serves `main`'s tree, so the copy lives
   and runs there, never in the topic's worktree.
2. **S2c's bar is the architect's**: build the coalescing loader only if a lone `_id__in` of 40 ids on the
   Item shelf takes at least 1,000 ms in quiet.
3. **S6's bar is the architect's**: build the sub-type warm only if the sub-types outside class, race,
   spell, ability and variation hold at least a quarter of the Item rows.
4. **Two phases, split at S4b's decision point.**
   - **Phase 1** is S0 to S4b. It takes three of the four shelf types off the warm, removes the duplicate
     whole loads and decides T-0824.
   - **Phase 2** is S5a to S10, the Item readers. The owner asked for a lighter load, so phase 2 goes
     ahead by default. Phase 1's last act re-runs the census and appends the numbers. If those show the
     Item warm is under 1 s per seat at load and after an idle, phase 1 instead reports that to the owner
     and stops.
   - A phase session ends after its phase. It appends its results here, corrects the phase 2 start prompt
     below, and reports to the owner.
5. **S9 adds the gate.** The `tools/validate.mjs` check refusing `libraryItems()`, `libraryActors()`,
   `libraryDocs(` and `whenReady(` outside `scripts/lib/library.mjs` and `scripts/importer` is built in S9,
   with its toolchain suite. A rule that recurs becomes a gate (`CLAUDE.md`, "Where a lesson lands").
6. **S10's bar:** build the busy mark only if, after S9, a wait a user meets on a fresh page or after an
   idle is still at least 1,000 ms. It starts with `/design`, and the build session approves its own board.
7. **Walks are driven by the build session's own driver**, not by `live-tester`, which re-delegates its
   brief. Each walk covers a player seat and a read after a real 310 s idle wherever the slice touches a
   player surface. Fixtures follow `.claude/rules/live-testing.md`: found by marker, kept, and deleted only
   by the run's own ledger.
8. **Agents:** each code slice goes to `implementer` (sonnet), since the design is fixed here and each
   slice is a scoped change. A departure from section 4's API goes back to `architect` (opus) before any
   edit. The build session reviews S3's `lib/library.mjs` diff against section 4 itself before landing it.
9. **Rows:** ledger T-0824 rides S4b and closes with it. T-0810 (the importer's compiled cookbook fetch)
   is not in this work.

### Phase 2 start prompt (corrected by phase 1 before it reports)

> You are phase 2 of the acks-extras work "Library reads off the index". Read `CLAUDE.md`,
> `.claude/rules/shared-tree.md`, `.claude/rules/live-testing.md` and
> `docs/lib/wip/20261127-library-index-reads-plan.md`, including phase 1's results. Sync
> `topic/library-index-reads` with `acks-branch sync`. Build S5a to S10 in order, landing and walking each
> on `main`. Append results to the plan, then do section 11's docs, close the topic, delete the plan, set
> ledger rows, and report to the owner. Push nothing.

## 1. Goal

The owner's words, which every brief quotes; each agent's report restates them with one example before
building on them:

- 2026-11-27: "I'd like you to work the performance recommendation of indexing the cookbooks. I thought the
  importer already did that but want to speed up/lighten the runtime load"
- 2026-11-26, on hearing the first Deal waited on the whole library: "The pack indexes should already be
  implemented"
- 2026-11-25, release closeout: "Suspiciously heavy runtime tasks are a quality check for necessity before
  release."

"Cookbooks" means the library's shelves, the `ACKS Cookbook — …` world compendia the importer writes. Done
means no seat instantiates a whole shelf in ordinary play, at load or after an idle. The measure is the
count of whole-shelf `getDocuments` calls and of documents instantiated per seat, by caller. Milliseconds
are secondary.

Tree: `topic/library-index-reads`, opened with `acks-branch open library-index-reads`, built in the sibling
worktree. Each slice is landed with `acks-branch land` and walked live on `main` before the next starts.
Line numbers are at `c2ce4c2f` and drift; the symbol is the anchor.

## 2. What the reads found

Grounded in a file and line unless marked inferred.

- **F1. Step 0's script is parked.** `e35040ed` (2026-11-26) moved `tools/live/perf-leads.mjs` to
  `parked/unjustified-checks`, byte-identical to `e35040ed^`. These still name the path:
  `tools/live/run.mjs:128-129`, `equipment/weapon-rows.mjs:62`, `classes/registry.mjs:518`,
  `lib/library.mjs:394`, `lib/util.mjs:323`, `docs/equipment/TESTING.md:137,1414`,
  `docs/lib/DECISIONS.md:3205,3324`. Its imports still resolve on `main` (`acquire`, `connect`, `sleep`,
  `seats`, `PORTS`, `ROOT`, `walkDone`). It writes `aia-tmp/20261126-perf-timings.json`, so a rerun would
  overwrite the baseline. The baseline holds no `libraryLoad` key and no `getDocuments` log.
- **F2. There are whole loads beside the warm.**
  - `abilities/skill-ladders.mjs` `refreshLadders` (:90-109) runs `pack.getDocuments()` on every world Item
    pack. `initLadders` calls it at `ready` on every seat (`abilities/module.mjs:25`,
    `formation/module.mjs:758`), and again 1 s after any item hook on a document with no parent
    (`onItemChange` :57). It is not a narrow read, so the warm does not wait for it. It fetches the Item
    shelf the warm fetches. Inferred: two full transfers and two instantiations per seat at `ready`; the
    baseline has no `getDocuments` log to confirm it.
  - `markets/engine/merchandise.mjs` `primeMerchandiseCatalog` (:115-131) calls `pack.getDocument(id)` per
    merchandise row, each a server pass, at `ready` on every seat (`markets/merchandise-module.mjs`) and
    after compendium merchandise changes.
  - `classes/grants.mjs` `warmSpellPacks` (:267) loads every pack holding a spell whole, the library Item
    shelf included. A player's pending-choice dialog reaches it (`pending-choices.mjs:137`).
- **F3. `libraryDocs` is a warm on demand.** `isCold` is `pack.index.size > pack.size` (`library.mjs:168`),
  true whenever a shelf is not wholly instantiated, and `libraryDocs` then calls `loadPack(type)` (:220).
  Foundry evicts a shelf 300 s after its last `get` or `set`, keeping only documents with a rendered app
  (Foundry 14.370 `client/documents/collections/compendium-collection.mjs:83,287,294-310,323-327`). So
  after every idle the first synchronous read reloads the whole type, and stopping `registerLibraryWarm`
  without moving the readers only moves the load. Unverified: a shelf holding an invalid document may never
  read warm, since `getDocuments` keeps invalid ones in `invalidDocumentIds` (:416-421). Step 0 records it.
- **F4. JournalEntry and RollTable shelves serve only GM actions.** JournalEntry's one reader outside
  `library.mjs` is `location/table-docs.mjs`. RollTable is read by `classes/template-packages.mjs` (:721,
  :1215) and `table-docs.mjs`; `formation/settlement-turn.mjs:292` does its own `getIndex`.
- **F5. The cast.** The claim runs before the cast's wait: `lib/patches/spell-use.mjs` `claimantFor`
  (:76-85) is synchronous and runs before `claimant.cast`, whose `castSpellRun` awaits `deps.ready`
  (`magic/cast-spell.mjs:676`, `ready: whenReady` :524). `castSpellClaims` (:114-124) falls back to
  `rowsOf`, which reads the twin when the copy has no rows (`magic/cast-rows.mjs:40-46`), so a twin not in
  memory leaves the cast unclaimed and the system's own cast runs. The roadmap's claim that the cast reads
  `spellsByName` and `repertoire.classNamed` is wrong: those serve `importer/cookbook/monster.mjs:228,306,322`
  and generation (`repertoire.mjs:204`). The cast reads `classForActor`; `classForActorAsync`
  (`classes/registry.mjs:167`) exists.
- **F6. Twin reads on other clients and later triggers**, all in async bodies that can await:
  `cast-apply.mjs` `recomputeDuration` (:1013) and `castInputs` (:1034) on the GM's client;
  `cast-held.mjs:550` on the GM's client; `cast-recur.mjs` `worldLookups` (:384, used :406, :553);
  `cast-seal-live.mjs:52`; `cast-control.mjs` `applyCastControl` (:60) on the GM's client;
  `spell-die-prompt.mjs` `askSpellDie` (:162) and `offerToJudge` (:233); the card buttons `applyTargetsFrom`
  and `pressThrow` (`cast-spell.mjs:1376, 1422`, through the synchronous `rowOfCard` :1293). Lib's
  `summonRefusal` policy (`cast-summon.mjs:199`) is called synchronously from `checkPlaceRequest`, in lib's
  async request handlers (`lib/summons.mjs:358, 392, 693`). `lib/patches/item-use.mjs`'s only claimant
  (`lib/item-run.mjs:2142`) declines spells and reads item flags; inferred to need no twin.
- **F7. Reclassified against the roadmap row:** `scene-search/keying.mjs` `proficiencyChoices` (:77) reads
  type, stamp and the capability label, an index list and not a whole-shelf pass. `monsters/module.mjs:168`
  needs `hit.toObject()` inside the synchronous `TEMPLATE_HOOKS.RESOLVED` call
  (`lib/template-generate.mjs:123`), so it is not a startup-index list. `formation/encounter-card.mjs`
  `resolveCreature` (:80; used :162, :409) needs name and uuid. `classes/languages.mjs` `worldLanguages`
  (:107) needs name, uuid and type. `classes/chargen.mjs:190` matches a name, then copies one document.
  `lib/bundles.mjs:81` matches name and type, then loads one document. About 25 `findByRef(x)?.name` sites
  read the name alone. `abilities/companions.mjs` reads `flags.acks-extras.extras.types`, then `extras.hd`
  or `system`; the importer types animals in that flag (`importer/cookbook/monster.mjs:85`).
- **F8. `whenReady` awaiters the roadmap omits:** `abilities/add-proficiency.mjs:98`;
  `character-sheet/pdf/app.mjs:79` and `apply.mjs:707`; `classes/assign-app.mjs:321, :340`;
  `classes/pending-choices.mjs:135`; `classes/stat-page.mjs:718`; `henchmen/engine/hire.mjs:137`;
  `formation/encounter-card.mjs:330`; `location/table-docs.mjs:688`; `lib/bundles.mjs:85`.
- **F9. Latent short read in Polyglot.** `lib/polyglot.mjs` `publishWorldLanguages` runs on Polyglot's
  provider-ready hook and reads the documents in memory. Inferred: it can publish a short list there. The
  startup index fixes it.
- **F10. Prior art for the redraw helper:** `classes/registry.mjs` `warmDocument` (:91), which re-renders
  an actor's apps when a document lands; `abilities/skill-ladders.mjs` `redrawActorSheets` (:76);
  `lib/org-chart-ui-logic.mjs` `readAfterIndex` (:57).
- **F11. `lib/place.mjs` `packNodeOf` (:209) reads `row.system?.parentUuid` off an index row**, against the
  letter of lib DECISIONS 2026-11-24. `foundryvtt-acks-core` holds no `parentUuid`, and `scripts/location`
  has no `migrateData`.
- **F12. Importer reads.** No feature outside `scripts/importer` calls `importedItem`, `importedItemFor`,
  `importedDocs` or `importedActor`. The bindings (`builder-binding`, `thief-limit-binding`,
  `language-binding`) run from `importer/tables-phases.mjs`, a GM import. The one runtime path,
  `documentOf`, moved in `389ba879`.
- **F13. Public API.** `acksExtras.lib.library` exposes `whenReady` and `libraryDocs`
  (`lib/module.mjs:206-215`). A grep of `acks-domains`, `acks-divine-conduit` and `discord-acks-extras`
  finds no caller.
- **F14. The 4.7 s narrow reads.** The baseline's first publications took `readMs` 4,684 and 9,239 ms on a
  second run, for one index pass and two `_id__in` loads of about 40 documents; the whole Item shelf alone
  loaded in 4,556 ms. Inferred: the reads contended with F2's loads; the alternative is a high per-query
  floor on the server. Step 0 times lone queries to decide, and S2c branches on it.
- **F15.** `docs/lib/README.md` does not exist; `scripts/lib/README.md` is lib's index.

## 3. The three questions

"Warmed" covers three paths: `registerLibraryWarm` at `ready`, `libraryDocs`' cold kick, and the
`whenReady` awaiters.

**Q1. Which synchronous readers must move before the warm stops, and which stay synchronous on the
index.** The startup index carries Item and Actor `_id, name, img, type, sort, folder`
(`common/documents/item.mjs:30`, `actor.mjs:30`). A declared field is present once the pack's first
`getIndex()` has run, which `pack.indexed` reports (`compendium-collection.mjs:277`). The Item shelves are
already indexed at `ready` on every seat: the weapon rows and the class registry register unconditionally
(`equipment/module.mjs:99`, `classes/module.mjs:241`).

| Stays synchronous on the index | What it reads | Slice |
|---|---|---|
| `encounter-card` `resolveCreature`; `organisation-run:172`; `recipe-editor` `#library` (:157) | name, uuid, type | S3 |
| `languages` `worldLanguages`, `polyglot`, `language-slots` picker | name, uuid, type | S5b |
| `chargen:190` spell match; `bundles` `resolveBundleRow` | name and type, then one `fromUuid` | S5b, S5a |
| `ability-sheet` `capabilityLabel`, `refName`; `keying` `proficiencyChoices`; `spell-sheet` `reverseDocument` | stamp and `extras.aliasOf` (declared) | S5a |
| `findByRef(x)?.name` sites, `grants` `heldCount`, `adventuringDoc` | stamp, then name, type, uuid | S5b |
| summon names (`spell-sheet:388`, `effect-row-editor:696,758`) | Actor stamp (declared) | S4b |
| `place` `packPlaces` (T-0824) | place flag and `parentUuid` (F11) | S4b |
| `registry` `classRowsNamed`, `summons` `summonShelves` | already on the index | none |

| Must move (needs `system`, a large module flag, or a document to copy) | Slice |
|---|---|
| `skill-ladders` `refreshLadders`; `merchandise` `primeMerchandiseCatalog` | S1 |
| `template-packages` (detach, materialize, `findSource`, `syncTemplateTable`); `table-docs` (`openShelf`, `removeMaterializedDocs`); `book-adventure` | S2 (explicit loads; GM actions) |
| `companions`; `lair` `lairMonster`; `summons` `resolveSource`; `cast-spell` `resolveRef`; `token-art` | S4a |
| `printed-layers` `libraryVariation` default and its render callers | S7a |
| `registry` `classItems`, `classByKey`, `classNamed`, `classForActor` (name path), `findByRef` (document path); `builder` `raceItems`; `assign-app`, `stat-page`, `hire` | S7b |
| `add-proficiency`; `grants` `choosableGenerals`, `choosableSpells`, `warmSpellPacks`, `grantAbility`; `chargen` `grantRanked`; `pending-choices`; `pdf` app, apply and match | S7c |
| `RESOLVED` listeners: monsters `findProficiency`, magic `fillGeneratedRepertoire`; importer monster's `spellsByName` and `classNamed` | S7d |
| `castSpellClaims`, cast `deps.ready`, the F6 readers, `cast-reach` `twinLookups`, `repertoire` `makeRepertoireSource`, `ability-rolls` `grantRows`, `grantedThrows`, `availableThrows` | S8a to S8c |

**Q2. Does a player seat need the warm?** It needs the Item warm today. Player-facing surfaces read Item
documents synchronously: the character sheet (class by name, chassis tables, granted names), the ability
and spell sheets, the cast claim and twin, the roll dialog's castable and granted throws, chargen and the
stat page, add-proficiency, the language picker, pending choices, and an item sheet's masterwork figures.
Each reads short until the cold kick reloads the type, or waits on `whenReady`. It needs the Actor warm
only for a spell sheet's summon names and a summoning cast, and never needs RollTable or JournalEntry. A
player seat already skips the Judge's shelves (`libraryPacks` applies `seatOpens`). Stopping the warm per
seat gains nothing early, because players read the same Item sub-types the GM does.

**Q3. Can the warm stop per seat or per type before every reader has moved?** Per document type, yes:
JournalEntry and RollTable after S2, Actor after S4b. Per Item sub-type, yes, conditionally (S6): after S5b
no synchronous reader reads an Item sub-type outside class, race, spell, ability and variation, so the warm
and the cold kick can load only those, and each later slice removes its own. Per seat, no (Q2).

## 4. Design: reuse, extend, invent

Reused as they stand: `libraryDocsWhere`, `shelfIndex` and `lib/republish.mjs`; `getIndex`'s reuse of the
index once `#indexedFields` covers the declared fields (`compendium-collection.mjs:337-342`), so one index
pass per pack per page load; `fromUuidSync`'s fallback to the index row (`client/utils/helpers.mjs:213`);
`classForActorAsync`; the attack seam's contributor `ready` (`equipment/roll-wrap.mjs`) as the pattern for
awaitable seams.

Additions to `lib/library.mjs`, one owner:

- `WARM_TYPES`, a `Set`: the types the `ready` warm, `whenReady` and `libraryDocs`' cold kick still load
  whole. `{Item, Actor}` after S2, `{Item}` after S4b, gone at S9. `loadLibrary(types = LIBRARY_TYPES)` is
  an action's explicit whole load (it reuses `loadPack`). `libraryCold(types = LIBRARY_TYPES)`.
  `warmLibrary()` loads `WARM_TYPES` only.
- `loadIds(pack, ids)`: loads in flight per pack and per id. Ids not in flight go in one `_id__in` now; ids
  already in flight await their load. No wait and no merging across readers, which keeps 2026-11-26's
  rejection of a shared `_id__in` unless S2c fires. `readWhere` uses it too.
- `packDocsWhere(packs, match, {except})`: `readWhere`'s per-shelf body over a pack list the caller gives
  (seat-filtered through `openPacks`), with `failed` on the answer, tracked as a narrow read.
  `libraryDocsWhere` becomes the world's documents plus `packDocsWhere(libraryPacks(type))`.
- `libraryRows(type, match, {redraw})`, synchronous, never loads. It answers projections
  `{_id, id, uuid, name, type, img, flags, pack}`: the world's documents first, then each seat-open shelf's
  index rows, unlined shelf first and in index order. It never hands out a document, so no caller can read
  `system` off a row. A shelf whose `pack.indexed` is false is read as it stands, `shelfIndex(pack)` is
  started, and the answer's non-enumerable `pending` is that promise. A shelf whose index failed within
  `HELD_RETRY_MS` is named on `failed` and gets no `pending` (suggested 30,000 ms, a timing choice of the
  module and no page value).
- `libraryHeld(type, match, {redraw})`, synchronous. It answers documents: the world's that pass `match`,
  then each shelf's held documents among the passing rows (read through `pack.get`, which re-arms Foundry's
  cache lifetime). The rest go to `loadIds`, and `pending` resolves when they land. It never loads a whole
  shelf. A failed load follows the same `HELD_RETRY_MS` guard, so a redraw cannot loop.
- `redrawOnRead(answer, target)`: once per pending read and target, re-renders `target`, which is a
  function, an application, or a document (each rendered app in `doc.apps`); skips an app no longer
  rendered. `redrawOpen(predicate)`: a target that re-renders every rendered `ApplicationV2` whose document
  passes `predicate`, lifted from `skill-ladders` `redrawActorSheets`.
- `pickCarrier(docs, id, {original, prefer})` is `byCookbookId`'s predicate, factored out.
  `byCookbookIdAsync(type, id, opts)` is `libraryDocsWhere` on the stamp, then `pickCarrier`.
  `cookbookRow(type, id, {redraw})` is a synchronous projection by stamp for display, template parts
  skipped. `byCookbookId` (sync) reads through `libraryHeld` on the index stamp where the type declares
  one; otherwise it reads the documents held (`book-adventure` asks after its explicit four-type load;
  JournalEntry and RollTable declare no stamp).
- `libraryTwinReady(doc)` awaits `byCookbookIdAsync(doc.documentName, cookbookId(doc))`; a no-op for an
  unstamped document.
- `LIBRARY_INDEX_FIELDS`, declared at `init` and never passed: Item gains
  `flags.acks-extras.extras.aliasOf` (S5a); Actor is `flags.acks-extras.cookbook.id`,
  `flags.acks-extras.templatePart` and `flags.acks-extras.extras.types` (S3). The Actor plate field and the
  location fields stay where their features declare them.

Seams gain an awaited `ready`, mirroring the attack seam, each owned by lib: `lib/patches/spell-use.mjs`
claimants (awaited before `claimantFor`); `lib/spell-sources.mjs` sources, through
`spellSourcesReady(actor)`; `lib/template-generate.mjs` `addGenerateReady(fn)`, awaited immediately before
`RESOLVED`.

Rules kept: an index row is read only for core fields and module flags, never `system` (lib DECISIONS
2026-11-24), with the one exception recorded in S4b; one `_id__in` per shelf, never `getDocument` in a loop;
readers hold ids across an eviction (the skill-ladder item cache is a named risk, section 9); seat rules
unchanged (lib readers apply `seatOpens`, the importer's do not, no permission invented);
`foundryvtt-acks-core` never edited; no TODO in source.

## 5. Step 0: baseline (slice S0)

Where the script lives is ruled above (ruling 1). Files: the untracked `tools/live/perf-leads.mjs`, and
`scripts/lib/library.mjs` marks only (`WARM_MARK_ENDED`, `acks-extras:libraryWarm:<type>:ended`), which land
with S1.

Changes to the script:
- Output goes to `PERF_OUT`, by default `aia-tmp/<YYYYMMDD>-perf-timings-<label>.json`, never the 20261126
  file.
- The page-start recorder (`GET_DOCUMENTS_RECORDER`) also wraps `getIndex` and records every compendium,
  not only Item. Per call: the query kind (whole, `_id__in`, `_id` or other), the documents returned, and
  `caller`, the first `modules/acks-extras/scripts/…` frame of `new Error().stack`.
- New leads, each on the GM seat and on a player seat (`PORTS.player`):
  - `loadCensus`, on a fresh page at `ready` and at `ready`+60 s untouched: per library shelf, type, index
    rows, rows by sub-type, `pack.size` (held), `pack.indexed`, cold, `invalidDocumentIds.size`; per
    caller, whole-shelf `getDocuments`, `_id__in`, `getDocument` and documents instantiated; the warm's
    start and end per type, and `ready` to warm end.
  - `quietQueries`, GM, in a quiet page, each timed through `documentClass.database.get` so pack state is
    untouched, median of five: a lone index query on the Item shelf, a lone `_id__in` of 40 ids, a lone
    whole query, a lone `_id` query.
  - `afterEviction`, on a fresh page: wait for the census to settle; a real foreground wait of 310 s with
    the elapsed time logged (`.claude/rules/live-testing.md`, "the REAL trigger"); the census again; then
    open, recording calls by caller and render ms, a character sheet whose class is bound by name, an
    ability sheet, a spell sheet with a summon row, and a masterwork weapon's item sheet; then a cast and an
    attack.
  - `firstCast` and `firstUnequip` on the player seat as well as the GM's.

Step 0 decides: the per-query floor (S2c); Item rows by sub-type (S6); whether `refreshLadders` and
`primeMerchandiseCatalog` show as whole or per-id callers (confirms or retires F2's inferred double load);
whether `isCold` stays true after a full load (F3). The census is re-run after every landing as that slice's
acceptance check.

## 6. Slices

Each slice lands, then is walked on `main`: its own observables, plus the S0 census on both seats. Every
unit case is written red, then green.

### S1. The two loads at `ready` beside the warm
- Files: `scripts/lib/library.mjs` (`packDocsWhere`, `loadIds`, the S0 marks);
  `scripts/abilities/skill-ladders.mjs`; `scripts/markets/engine/merchandise.mjs`;
  `tools/lib-shelf-mock.mjs` (an `indexed` getter); suites `tools/test-library-where.mjs`,
  `tools/test-skill-ladders.mjs`, `tools/test-merchandise.mjs`.
- Change: `refreshLadders` reads `packDocsWhere(world Item packs from openPacks, row => row.type ===
  ability && cookbookId(row).startsWith("def.skill."))`, keeps the generation guard, and on `failed` keeps
  the previous map as the republisher does. `primeMerchandiseCatalog` keeps its type filter on the startup
  index, then loads with one `loadIds(pack, ids)` per pack.
- Unit: a shelf of 3 skills among 50 abilities is one `_id__in` of the 3 (today a bare `getDocuments`); a
  burst of hooks is one read; five merchandise rows are one `_id__in` (today five `_id` queries); `loadIds`
  with the same ids twice makes one call; with overlapping ids the second asks only for the new ones; a
  rejected load releases its ids.
- Live: the census shows both callers as `_id__in` only, GM and player; a borrowed skill throw shows its
  rungs (abilities TESTING), including after a 310 s idle; the market catalogue lists compendium goods
  (markets TESTING); editing a sidebar item causes no whole load.
- Warm effect: the second whole Item load, at `ready` and on every item burst, leaves every seat.

### S2. Warm per type; RollTable and JournalEntry come off
- Files: `scripts/lib/library.mjs`; `scripts/classes/template-packages.mjs`;
  `scripts/location/table-docs.mjs`; `scripts/importer/book-adventure.mjs`; suites
  `tools/test-library-where.mjs`, `tools/test-lib.mjs`, `tools/test-table-docs.mjs`,
  `tools/importer/test-book-adventure.mjs`, plus whichever suite covers template-packages (to confirm).
- Change: `WARM_TYPES` becomes `{Item, Actor}`. `template-packages`' `materializeTemplates`,
  `detachTemplatePackages` and the exported `findSource` and `resolveBaseDoc` await
  `loadLibrary(["Item", "RollTable"])` first (today they read the warm). `table-docs` `openShelf` awaits
  `loadLibrary([type])` instead of `whenReady`. `removeMaterializedDocs` awaits the RollTable and
  JournalEntry loads before listing (today it deletes only what is held after an eviction, a latent
  defect). `book-adventure` uses `libraryCold(LIBRARY_TYPES)` and `loadLibrary(LIBRARY_TYPES)` explicitly;
  without that its retry loop refuses forever once the warm list shrinks.
- Unit: the warm loads no RollTable or JournalEntry shelf; a cold RollTable shelf read synchronously starts
  no load; `removeMaterializedDocs` after `evict()` deletes every flagged table; `warmBeforePrepare` loads a
  cold JournalEntry shelf.
- Live: at `ready`+60 s the RollTable and JournalEntry shelves hold 0 documents on both seats; after a 310 s
  idle, materializing the rules tables adopts the tables that exist and duplicates none (location TESTING);
  Build packages and Detach work on an evicted shelf (classes TESTING); a cookbook adventure import loads
  (importer TESTING).
- Warm effect: RollTable and JournalEntry stop on every seat.

### S2c. Coalescing id loader (conditional, ruling 2)
- Change: `loadIds` holds new ids for one macrotask and merges concurrent callers into one `_id__in` per
  shelf. Supersedes 2026-11-26's rejection of "sharing one `_id__in`"; that entry is under 7 days old, so
  the new entry names the measured floor as its new evidence. Files: `library.mjs` and its suite.

### S3. The held reader and the Actor lists
- Files: `scripts/lib/library.mjs` (everything in section 4 not yet built);
  `scripts/formation/encounter-card.mjs`; `scripts/monsters/organisation-run.mjs`;
  `scripts/monsters/recipe-editor.mjs`; `tools/lib-shelf-mock.mjs` (Actor rows); a new suite
  `tools/test-library-held.mjs`; suites `tools/test-encounters.mjs`, `test-encounter-line.mjs`,
  `test-organisation*.mjs`, `test-recipe-editor-logic.mjs`.
- Change: `resolveCreature` matches names over the world's actors, then `libraryRows("Actor", …)`;
  `postEncounterCard` drops `whenReady`; both Actor lists read `libraryRows("Actor", monster or animal)` and
  drop `whenReady`.
- Unit: `libraryRows` makes no server call; an unindexed shelf with a flag test sets `pending`, calls
  `shelfIndex` once, and redraws once even when asked twice in one pass; missing ids load by one `_id__in`;
  a failed load is named on `failed` and, asked again within `HELD_RETRY_MS`, sets no `pending` (fake
  clock); no bare `getDocuments`; a Judge's shelf is skipped for a seat that cannot open it;
  `byCookbookIdAsync` loads only the stamp's matches; the synchronous `byCookbookId` on JournalEntry falls
  back to the documents held; the encounter card resolves a monster with no load.
- Live (GM): an encounter card posted on a fresh page before the warm ends links its creature (formation
  TESTING); the org chart's Roll and the recipe editor's mount list are complete (monsters TESTING); the
  census shows no loads from these callers.
- The build session checks the lib diff against section 4 before landing (ruling 8).

### S4a. Actor documents by stamp
- Files: `scripts/abilities/companions.mjs`; `scripts/lib/lair.mjs`; `scripts/lib/summons.mjs`
  (`resolveSource`, plus `await libraryTwinReady(spell)` before each `checkPlaceRequest` at :358, :392 and
  :693, so magic's policy finds the twin on the GM's client); `scripts/magic/cast-spell.mjs`
  (`liveDeps.resolveRef` only, :555); `scripts/importer/token-art.mjs`; suites `test-companions`,
  `test-lair`, `test-summons`, `test-magic-cast`, `tools/importer/test-token-art`.
- Change: the narrow and async-stamp readers of section 4; each drops `whenReady`.
- Unit: companions loads only animals; lair and summons make one `_id__in` per stamp; `resolveRef` is
  async; token art loads only stamped monsters; the place request awaits the twin.
- Live: player, the companion picker (abilities TESTING) and a summoning cast (magic TESTING), on a fresh
  page and after a 310 s idle; GM, a lair's Roll (location TESTING) and token art (importer TESTING).

### S4b. Actor names on sheets, T-0824, and Actor comes off the warm
- Files: `scripts/magic/spell-sheet.mjs` (:388); `scripts/lib/apps/effect-row-editor.mjs` (:696, :758);
  `scripts/lib/place.mjs` (`packPlaces`); `scripts/location/apps/location-sheet.mjs` (`#preparePlace`);
  `scripts/lib/library.mjs`; suites `test-summon-list`, `test-region-place-row`, `test-location-*.mjs`,
  `test-library-held`.
- Change: the summon lookups pass `cookbookRow(type, id, {redraw: this})`; `packPlaces` starts
  `shelfIndex(pack)` when the pack is not indexed, and `#preparePlace` (async) awaits it; `WARM_TYPES` drops
  Actor.
- T-0824, decided lazy and not eager. T-0824 priced its fix as an eager `getIndex` per Actor pack per seat
  at `ready`. Lazy costs a player seat nothing at load: one index pass per pack at the first compendium
  place sheet, summon or companion, then free for the page's life (`compendium-collection.mjs:342`). The
  declared Actor stamp and `shelfIndex` cover T-0824 and the summon and lair readers. The `parentUuid` read
  (F11) is recorded as the one standing exception to lib DECISIONS 2026-11-24.
- Unit: a summon name resolves from an index row with no load; an unindexed pack starts one `shelfIndex`
  and answers its startup rows.
- Live: player, a summon spell's sheet on a fresh page names its creature (or shows the neutral label on a
  pack the player cannot open) after at most one redraw; GM, a place held in an Actor pack shows its
  children and providers (fixture marker `location/t0824-pack-place`); the census at `ready`+60 s shows
  Actor shelves holding 0 on both seats.
- Warm effect: Actor stops. Decision point: phase 1 ends here (ruling 4).

### S5a. Item names from the index: abilities, scene-search, magic, lib
- Files: `scripts/lib/library.mjs` (the `aliasOf` field); `scripts/abilities/ability-sheet.mjs` (:94,
  :108); `scripts/scene-search/keying.mjs` (:77); `scripts/magic/spell-sheet.mjs` (:226);
  `scripts/lib/bundles.mjs` (:81); suites `test-ability-sheet`, `test-scene-keying`, the bundles case in
  `test-lib`.
- Change: the three render readers read `libraryRows` or `cookbookRow`, passing the sheet as `redraw`;
  bundles match name and type, then `fromUuid` the one row, and drop `whenReady`.
- Live: player, the ability sheet's labels and the spell sheet's reverse name, on a fresh page and after a
  310 s idle, with no whole loads; GM, the keying tab's choices are complete.

### S5b-1. `findByRef` split, display callers
- Files: `scripts/classes/registry.mjs` (`refRow`, `refName`, `findByRefAsync`); the mechanical
  `findByRef(x)?.name` to `refName(x)` sites: `character-sheet/tabs/class.mjs:155`, `classes/apply.mjs:457`,
  `class-sheet.mjs:206-351`, `grants.mjs:285`, `levelup.mjs:216`, `panels.mjs:21,24`,
  `race-sheet.mjs:72,79`, `zero-level.mjs:63`, `template-packages.mjs:671`; `add-proficiency.mjs:58`
  (`refRow`); suite `test-class-registry`.
- Live: granted names on a player's class tab and on the GM's class sheet, after a 310 s idle, with no
  whole loads.

### S5b-2. Classes actions on rows
- Files: `scripts/classes/grants.mjs` (`heldCount` on `refRow`, `adventuringDoc` returns a row,
  `grantAbility` uses `findByRefAsync`); `scripts/classes/chargen.mjs` (`grantRanked` uses
  `findByRefAsync`; the spell match uses rows, then `fromUuid`); `scripts/classes/sheet-helpers.mjs`
  (`openRef` becomes async); `scripts/classes/languages.mjs` (`worldLanguages`, `resolveLanguage`); suites
  `test-languages`, `test-classes`.
- Live: the player's language picker is complete on a fresh page; with Polyglot active, every imported
  language is published at its ready.

### S6. Item warm by sub-type (conditional, ruling 3)
- Files: `library.mjs` and its suite. Change: the Item warm and the cold kick load
  `libraryDocsWhere("Item", row => WARM_ITEM_TYPES.has(row.type))`; Item's cold test counts only those
  sub-types, read from the startup index's `type`.
- Live: the census holds only those sub-types; the weapon draw and attack (equipment), the deal (treasure)
  and the first cast (magic) are unchanged.

### S7a. Variations
- Files: `scripts/equipment/printed-layers.mjs` (:35); `item-sheet/sheet.mjs` (:291);
  `item-sheet/snapshot.mjs` (:277-281, :409); `properties.mjs` (:240-266); suite `test-variations`.
- Change: the render readers use `libraryHeld(variation, {redraw: sheet})`.
- Live: a player's masterwork weapon sheet, on a fresh page and after a 310 s idle, shows its figures after
  at most one redraw, with one load of at most 7 documents. The S6 set loses variation.

### S7b. Classes and races
- Files: `scripts/classes/registry.mjs` (`classItems` on `libraryHeld` with `redrawOpen(actor and
  class/race sheets)`; `warmDocument` moves onto `loadIds`; a new export `classDocuments()`, which is
  `readClasses`); `builder.mjs` (`raceItems`); `assign-app.mjs` (:318, :336); `stat-page.mjs` (:718);
  `henchmen/engine/hire.mjs` (:137); `magic/repertoire.mjs` `classNamed` (:105); suites
  `test-class-registry`, `test-classes`, the hire suite.
- Change: the picker and the stat page await `classDocuments()` unconditionally, keeping classes
  2026-09-07's principle on a narrower read; the stat page keeps one injection (2026-09-02).
- Live: player, the chargen class select on a fresh page; a character bound by name shows saves and attack
  after a 310 s idle; GM, dropping a class on the picker, and a henchman's hire with its HP roll. The S6 set
  loses class and race.

### S7c. Abilities and spells for actions
- Files: `abilities/add-proficiency.mjs` (:96); `classes/grants.mjs` (`choosableGenerals` and
  `choosableSpells` take lists; `warmSpellPacks` uses `packDocsWhere(spell)`); `pending-choices.mjs` (:135);
  `assign-app.mjs:206` and `stat-page.mjs:355`; `character-sheet/pdf/app.mjs` (:79), `apply.mjs` (:707),
  `match.mjs` (:103); suites `test-character-pdf`, `test-classes`.
- Live: player, Add proficiency lists both lists, and a pending spell choice offers spells; GM, the PDF
  import preview's counts.

### S7d. Generation seam
- Files: `scripts/lib/template-generate.mjs` (`addGenerateReady`); `monsters/module.mjs` (ready loads the
  ability definitions when organisation choices are made); `magic/module.mjs` (ready loads classes and
  spells when a spellcasting class is named); `importer/cookbook/monster.mjs` (:228, :306, :322: await the
  class and spell reads first; check `actor-import.mjs:69` `warmSpellPacksOnce` before adding a read);
  suites `test-generate-host`, `test-generated-repertoire`, `test-organisation`.
- Live (GM): generate a troop with a caster, on a fresh page and after a 310 s idle; its proficiencies and
  repertoire are present.

### S8a. Seams and the cast's claim
- Files: `lib/patches/spell-use.mjs` (claimant `ready`); `magic/cast-spell.mjs` (`castReady(spell)` runs
  `libraryTwinReady`, `classForActorAsync(caster)` and `byCookbookIdAsync("Actor")` for each non-uuid
  summon ref; the claimant's `ready`; `deps.ready?.(spell)`); `magic/module.mjs`.
- Supersedes 2026-11-26's rejection of "narrowing the cast's wait"; new evidence: F5's trace and
  `classForActorAsync`.
- Unit: a stamped spell with no own rows and an unheld twin is claimed (today it is declined); `ready` runs
  before claims.

### S8b. Twin reads on other clients
- Files: every F6 site awaits `libraryTwinReady(spell)` before building lookups: `cast-apply.mjs`,
  `cast-held.mjs`, `cast-recur.mjs`, `cast-seal-live.mjs`, `cast-control.mjs`, `spell-die-prompt.mjs`, the
  card buttons in `cast-spell.mjs`.
- Live: the apply on the GM's client applies twin rows; a held spell ends; a recurrence fires; a seal
  reads.

### S8c. Castable register and granted throws
- Files: `lib/spell-sources.mjs` (source `ready`, `spellSourcesReady`); `magic/repertoire.mjs`
  `makeRepertoireSource` (ready: twins of the actor's spells and the class); `magic/cast-reach.mjs`
  `twinLookups` (a memo per call over `byCookbookId`); `abilities/ability-rolls.mjs` (`grantRows` :1151;
  `grantedThrows` and `availableThrows` move to `libraryHeld` with a redraw; `rollGrantedThrow` awaits);
  suites `test-spell-sources`, `test-magic-cast`.
- Live (player): the first cast on a fresh page, and again after a 310 s idle, is claimed by the module's
  window; a self-buff's latent throw is listed; the census shows no whole load from any cast path. The S6
  set loses spell and ability.

### S9. The warm goes
- Files: `scripts/lib/library.mjs` (`WARM_TYPES` and `registerLibraryWarm` removed; `libraryDocs` answers
  the sidebar plus the documents held and never starts a load; `whenReady` becomes `loadLibrary()`, kept for
  the public API); `scripts/lib/module.mjs` (:1161); the `tools/validate.mjs` check (ruling 5) with
  `tools/toolchain-tests/test-validate.mjs`.
- Departure from the roadmap: it says `libraryDocs` ends answering "the sidebar alone". Answering the
  sidebar plus held documents keeps `await whenReady(); libraryItems()` complete for an external caller of
  `lib.library`.
- Live: the census on both seats shows the shelves holding only what narrow reads loaded; the smoke walk
  passes; spot checks on a fresh page and after a 310 s idle (first cast, attack, deal, sheets).
- Warm effect: Item stops; no shelf is warmed whole on any seat.

### S10. Busy mark (conditional, ruling 6)
- Starts with `/design` (`.claude/rules/ui-layout.md`); the board is approved before any build. Built only
  if the S9 re-measure shows a wait a user sees at or above the bar: the deal's `armsSeam` load, a first
  cast's narrow read, or a first Actor index. 2026-09-02 rejected a loading state "for a wait nothing has
  yet measured as visible"; the re-measure is its evidence or the reason to drop it. The deal figures (16.5
  s, then 5,635 ms on `389ba879`) were measured with the warm contending, and `armsSeam` is already narrow
  (`treasure/deal.mjs:190`).

## 7. When each shelf type stops being warmed

| Shelf type | Stops after | Readers it waited on |
|---|---|---|
| JournalEntry | S2 | `table-docs` (GM) |
| RollTable | S2 | `template-packages`, `table-docs` (GM) |
| Actor | S4b | lists, stamps, summon names, T-0824 |
| Item | S9 (five sub-types from S6, if built) | the duplicate whole load goes in S1 |

## 8. Rejected

- An eager Actor `shelfIndex` at `ready` on every seat (T-0824's priced fix): lazy costs nothing at load.
- Dropping the warm first: the cold kick reloads the type anyway (F3).
- Async readers on render paths (2026-08-24's rejection stands): the held reader plus one redraw keeps
  renders synchronous.
- Declaring large flags such as the spell flag or `extras.rolls` on index rows: every row grows.
- Per-seat stops (Q2).
- Keeping shelves warm by re-arming the cache lifetime: the instantiation cost stays.
- A coalescing loader by default: 2026-11-26's rejection stands unless S2c's evidence arrives.

## 9. Risks and counter-argument

Risks: redraw loops (the dedupe per pending read and target, and `HELD_RETRY_MS`, pinned in tests); silent
short reads on an unindexed shelf, such as one minted mid-session or after a CONFIG change (reads check
`pack.indexed`); unmigrated rows (the `parentUuid` exception is the only standing one); the skill-ladder
`itemCache` holds instances across an eviction (display-only, but a document updated after eviction goes
stale; inferred that item hooks do not fire for a pack document the seat does not hold, untested); the
index grows with `aliasOf` and the Actor stamp and types; `domainOf` and `factionsAt` are synchronous with
no app to redraw and read short on a first call before the location sheet's await; rebase conflicts with
the queue sessions in magic, classes, abilities and monsters (slices are small and name their files);
`acks-branch land` refuses a runtime landing while `main`'s version is untagged (exit 6); `lib.library`
semantics change (API.md, changelog `upgrading`); the new awaited `ready` on every cast (inferred about
1 ms when documents are held, since `readWhere` makes no server call when nothing is missing).

Counter-argument, rated MODERATE: S1, S2 and S4b remove the duplicate loads, three of the four warmed types
and the merchandise scans in five small slices. The rest rewrites about 40 readers across ten features and
adds three seams to save the Item warm, which blocks no `ready` and is the bulk only if Item is most of the
6,440 documents. Not rated strong: the Item shelf is 4,473 documents and 11.9 MB per seat, it reloads after
every idle (F3), and the owner asked for a lighter load explicitly. Ruling 4's decision point after S4b lets
the build stop there.

## 10. Out of scope

- `loadCookbook`'s compiled cookbook fetch (T-0810).
- The defect queue.
- The importer's `importedIndex`, `readLibrary`, `importedActor` and the binding applies: GM import actions
  (F12).
- `book-adventure`'s four-type load: a GM import, kept explicit in S2.
- `settlement-turn`'s `getIndex({fields: ["flags"]})`: its own read, loads no documents.
- `money.mjs` `onShelf`'s per-coin loads: cached, and stop at the first fit.
- `equipment/grant.mjs` `findGearEntry`: loads one id.
- "One load for two readers": 2026-11-26's rejection stands unless S2c fires.

## 11. Docs on finishing

- `docs/lib/MODEL.md`, "The imported library": the synchronous readers become rows and the held reader, the
  warm and the cold kick are gone, the eviction section stays, the consumers list is updated.
- `docs/lib/DECISIONS.md`, one entry per ruling slice:
  - S1 and S2: whole loads beside the warm, and the warm kept per type.
  - S3: the held reader. Supersedes in part 2026-08-24's rejections of "making the readers async" and
    "reading the pack INDEX instead of instantiating", on the 300 s eviction, the 11.7 s warm and the
    declared stamps; updates In-force row 23 in the same change.
  - S4b: T-0824 decided lazy, and the `parentUuid` exception to 2026-11-24.
  - S8a: supersedes in part 2026-11-26's "narrowing the cast's wait".
  - S9: supersedes in part 2026-11-26's "dropping the warm" and qualifies 2026-09-02; updates In-force row
    17.
  - S2c, if built: supersedes the shared-`_id__in` rejection.
  - S10, if built: supersedes 2026-09-02's rejected loading state. The redraw helper is not 2026-09-02's
    rejected "re-running the injection": it re-renders module windows, and the stat page awaits instead.
- Classes DECISIONS: 2026-09-07 "warmed unconditionally" superseded in part.
- Feature MODEL files: classes, equipment, abilities, markets and location, each for its slice.
- `scripts/lib/README.md`'s `library.mjs` row; `docs/lib/API.md` and the generated
  `docs/site/.../reference/api/lib.md` for `whenReady` and `libraryDocs`.
- TESTING: `docs/lib/TESTING.md` step 4 (it times `whenReady`), `docs/classes/TESTING.md:396,899`,
  `docs/equipment/TESTING.md:137,1414`; new steps in each feature's TESTING.
- A `changelog.d` fragment per slice; `fixed` for the latent defects (the claim, the Polyglot list,
  `removeMaterializedDocs`, the ladder reload).
- The built groups of `docs/lib/ROADMAP.md`'s row come out. Ledger T-0824 closes. This plan is deleted in
  the session that lands the last slice.

## Results

(Appended by the phase sessions, one entry per slice: commit, census and timings before and after, what was
walked, what was checked offline only, what was not checked.)

### S0. Baseline (phase 1, 2026-11-27)

Run on `main` at `2aceec65` with peers' uncommitted edits in the working tree (the junction serves the tree),
world `test`, lane A (Gamemaster and Player), both seats on fresh pages at once. The script is the untracked
`tools/live/perf-leads.mjs` (ruling 1), run as `PERF_LEADS=1 PERF_SET=census PERF_LABEL=<label>`; it wraps the
database backend's `get` before the page's first script, so every compendium server pass is recorded with its
kind, documents returned and caller frames. Output: `aia-tmp/20261127-perf-timings-baseline.json`. Counts are
the measure; every ms figure is one run and swung widely between runs (the GM's first unequip took 92 ms in a
smoke run and 2,636 ms here). Every boot reached `ready` with no error in init, setup or ready. A smoke run
before it (5 s idle) logged 16 `ready` rejections ("reading '_source'") on one GM boot, right after its own
chat messages were swept and while the Actor shelves grew from 1,534 to 1,538 rows; not seen again, cause not
found.

- **Shelves.** Item 4,474 rows on two shelves (the ACKS shelf 4,473, a Judge's shelf 1), Actor 1,538 (374 on
  the ACKS shelf, 1,164 on a Judge's shelf), RollTable 427, JournalEntry 6. The Player seat opens 4,473, 374,
  378 and 2 of them. No shelf holds an invalid document, and a shelf loaded whole reads not cold (F3's
  unverified case does not occur here).
- **Load (ready+60 s, untouched).** GM: 9 whole loads, 1 `getDocument`, 2 index passes, **6,447 documents**;
  ready to warm end 23.5 s. Player: 4 whole loads, 1 `getDocument`, 1 index pass, **5,228 documents**; 21.4 s.
  By caller: `refreshLadders` made the whole Item load on both seats (4,474 GM, 4,473 Player) before the warm
  began, so the warm's Item share was the Judge's 1-row shelf on the GM seat and nothing on the Player's; the
  warm loaded Actor, JournalEntry and RollTable whole (GM 1,972 documents, Player 754).
  `primeMerchandiseCatalog` made one `getDocument` and found the other 28 goods held, because the ladder's
  whole load had landed first. `readClasses` made the index passes.
- **F2 corrected.** On a quiet page the Item shelf is instantiated once, by `refreshLadders`, not twice. The
  second whole Item load happens where a `whenReady` races it (the first cast below: 10,920 documents on the GM
  seat, 9,701 on the Player's) and on every burst of sidebar item edits, where the bare `getDocuments()` moves
  and instantiates the whole shelf again although it is held.
- **Quiet queries (ruling 2).** Lone queries on the ACKS Item shelf, median of five: index 443 ms, `_id__in` of
  40 **360 ms**, `_id` 298 ms, whole 5,391 ms. The floor is about 300 ms per pass (the server scans the shelf
  for any query), so F14's 4.7 s narrow reads were contention. **S2c is not built** (360 ms is under the
  1,000 ms bar).
- **Item rows by sub-type (ruling 3).** class 31, race 4, spell 342, ability 700, variation 7: 1,084 of 4,473.
  The rest is 3,389 rows (76%: item 2,171, weapon 597, armor 273, bundle 248, language 58, merchandise 29,
  trap 13). **S6's bar is met**; phase 2 builds it.
- **After a real 310 s idle** (310,001 ms measured): every shelf on both seats held **0** documents. Then, on
  each seat: the character sheet bound to its class by name rendered in 5.5 s (0.8 s before the idle), with
  `classItems`' cold kick loading the Item shelf whole and `warmDocument` one `getDocument`; the ability sheet
  and the masterwork weapon's sheet made no server pass; the spell sheet with a summon row loaded the Actor
  shelves whole through `resolveCreature`'s cold kick (GM 1,538, Player 374); the cast window stood after
  4.3 s (GM) and 4.0 s (Player), its `whenReady` loading JournalEntry and RollTable whole; the attack made no
  pass. Total after the idle: GM 8 whole loads and 6,446 documents, Player 4 and 5,228, the whole library again.
- **Firsts on a fresh page.** Cast window: GM 14.9 s, Player 11.5 s (`castSpellRun`'s `whenReady`). Unequip:
  GM 2.6 s, Player 3.3 s.
- **T-0824 confirmed:** both Actor shelves read `indexed: false` on both seats throughout; nothing builds their
  declared-field index.

### S1. The two loads at `ready` beside the warm (phase 1, 2026-11-27)

Commit `f4f95130`, landed with the full gate green. Walked on `main` at `f20b4e9a` with a clean tree, same
world and seats, the census extended with two observables: each seat's readers (`P.readers`: skill rows on the
index, imported skill keys, the first key's rungs, goods on the index, catalogue rows) and a sidebar edit (the GM
writes a flag on the kept world Item `perf/sidebar-item`, then both seats are counted for 3 s; the ladder's quiet
period is 1 s). Output: `aia-tmp/20261127-perf-timings-s1.json`, after a smoke run with a 5 s idle
(`…-s1-smoke.json`). Nine boots, each reaching `ready` with no error in init, setup or ready.

- **Callers.** `refreshLadders` made index passes only (GM 2, Player 1); the skill definitions it names load
  through `packDocsWhere`'s `_id__in`, which the census attributes to `lib/library.mjs` `readPacks`, since the
  async frames above it are lost after the index await. `primeMerchandiseCatalog` made one `_id__in` of 29 goods
  on each seat. Neither made a whole load.
- **Load (ready+60 s).** GM: 8 whole loads, 4 `_id__in`, 2 index passes, 6,561 documents, ready to warm end
  27.4 s. Player: 4 whole, 4 `_id__in`, 1 index, 5,343 documents, 16.4 s. At a quiet ready nothing is saved:
  the warm now makes the whole Item load `refreshLadders` made in the baseline, and the narrow startup reads
  (classes, variations, weapon rows, skills) load their 87 ids in three `_id__in` passes, where in the baseline
  they found them held because the ladder's load had landed first.
- **Sidebar edit.** At ready+60 s: no server pass on either seat. After the 310 s idle (310,006 ms measured,
  every shelf at 0): one `_id__in` of 15 documents on each seat. The baseline re-fetched the whole shelf
  (4,474 documents) on each burst.
- **Readers, both seats, at ready+60 s and after the idle:** 14 skill rows on the index, 9 imported skill keys,
  the first key's ladder 14 rungs; 29 goods on the index, catalogue 37 rows, 29 of them from the compendium.
- **Firsts.** Cast window: GM 19.9 s with 6,561 documents (baseline 10,920: the Item shelf now loads once, not
  twice), Player 13.5 s with 5,343 (baseline 9,701). Unequip: GM 0.19 s, Player 0.15 s.
- **After the idle**, the sheet, spell and cast steps load as in the baseline (`classItems` and
  `resolveCreature` cold kicks, the cast's `whenReady`); S1 does not touch them.
- **Quiet queries:** `_id__in` of 40 364 ms, index 436 ms, whole 5,225 ms.
- **Offline only:** `test-library-where` 30, `test-skill-ladders` 16, `test-merchandise` 254 checks, and the
  land's full gate.
- **Not checked:** the rendered borrowed-skill throw and the market window were not opened (the ladder map and
  the catalogue they read were); a compendium merchandise change was not driven.
- The S1 changelog fragment is reworded on `main`: the saving is the sidebar-edit burst and the first action
  that races the warm, not the quiet ready.
- **Process note:** S2 was committed in the worktree during this walk and is landed only after it passed.

### S2. Warm per type; RollTable and JournalEntry come off (phase 1, 2026-11-27)

Commit `2fd1798a`, landed with the full gate green. Walked on `main` at `a526d375` (S1's results and a peer's
commit above it), same world and seats. The census gains each seat's shelf state per type and three GM leads:
building and detaching template packages (the shelf class whose packages already exist, then a kept fixture
class, `perf/s2-package-class`, carrying one row of the kept world Item `perf/s2-flask`), the rules-table pass
on a fresh page, and a book adventure's `prepareImport` on a fresh page. Two smoke runs (`…-s2-smoke.json`,
`…-s2-smoke2.json`) fixed the script's fixture sub-type and the prepare call's options. Output:
`aia-tmp/20261127-perf-timings-s2.json`. Eleven boots, each reaching `ready` with no error in init, setup or
ready.

- **Load (ready+60 s).** GM: 4 whole loads (Item 4,474, Actor 1,538), 4 `_id__in`, 2 index passes, **6,128
  documents**, ready to warm end 19.8 s. Player: 2 whole, 4 `_id__in`, 1 index, **4,963 documents**, 17.4 s.
  RollTable and JournalEntry hold 0 on both seats (S1: GM 6,561, Player 5,343; the difference is the 433 and
  380 roll tables and journal entries).
- **Sidebar edit and readers:** as in S1, at ready+60 s and after the idle.
- **After the 310 s idle** (310,017 ms measured, every shelf at 0): the cast window stood in 132 ms (GM) and
  151 ms (Player) with **no server pass**, where S1's `whenReady` loaded JournalEntry and RollTable whole. The
  character sheet (5.5 s, 5.3 s, `classItems`' cold kick on Item) and the summon-row spell sheet
  (`resolveCreature`'s cold kick on Actor: 1,538 and 374) load as before; S3 and S4 take those. Total after the
  idle: GM 4 whole loads and 6,013 documents, Player 2 and 4,848 (S1: 6,446 and 5,228).
- **Firsts.** Cast window: GM 13.5 s, its `whenReady` loading Item and Actor only (6,128 documents; S1 19.9 s,
  6,561), Player 7.9 s (4,963; S1 13.5 s). Unequip: GM 0.22 s, Player 0.14 s.
- **Template packages** (GM, Item held, RollTable cold): rebuilding the shelf class's packages loaded the
  RollTable shelves (427) and created 0, relinked 0, left 0 unresolved, and kept its table and bundles; the
  fixture class built one bundle and one table in 60 ms, and detaching removed both and the one item. The sweep
  found both already gone.
- **Rules-table pass** (fresh page, RollTable and JournalEntry cold): loaded both shelves (427 and 6),
  exported 1,091, 346 keyed tables, **0 duplicate keys**, 4.4 s.
- **Adventure prepare** (fresh page, both cold): loaded all four types before planning (none cold after) and
  planned 49 actors, 1 journal entry, 1 roll table and 17 folders to create, 77 actors, 11 scenes and 3 folders
  to update. Prepare only: nothing was imported.
- **Quiet queries:** `_id__in` of 40 383 ms, index 470 ms, whole 5,436 ms.
- **Offline only:** `test-library-where` 37, `test-lib` 314, `test-table-docs` 49, `test-classes` 169 checks,
  the book-adventure suite, and the land's full gate.
- **Not checked:** removing materialized tables was not driven (it deletes the world's materialized tables);
  the packages were built and detached through the module's functions, not the class sheet's controls; the
  adventure's plan was not compared against one made on warm shelves.
