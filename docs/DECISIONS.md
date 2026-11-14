# Decision record — repo level

Rulings through v11.14.5: [DECISIONS-through-v11.14.5.md](DECISIONS-through-v11.14.5.md).

## In force

- undated — [The merge (0.1.0, 2026-07)](DECISIONS-through-v11.14.5.md#the-merge-010-2026-07)
- undated — [1. Flag key collisions — RESOLVED (flat namespace)](DECISIONS-through-v11.14.5.md#1-flag-key-collisions--resolved-flat-namespace)
- undated — [2. `EFFECT_PREFIX` collapse — RESOLVED](DECISIONS-through-v11.14.5.md#2-effect_prefix-collapse--resolved)
- undated — [3. `stackSignature` — NOT NEEDED (namespace stayed flat)](DECISIONS-through-v11.14.5.md#3-stacksignature--not-needed-namespace-stayed-flat)
- undated — [4. `Actor.location` declared twice — RESOLVED](DECISIONS-through-v11.14.5.md#4-actorlocation-declared-twice--resolved) — superseded in part by "The merge (0.1.0, 2026-07)", its 2026-08-02 addendum
- undated — [4b. Import cycles — pre-existing, not merge-caused](DECISIONS-through-v11.14.5.md#4b-import-cycles--pre-existing-not-merge-caused)
- undated — [5. `Item.attitude` had no type label — FIXED](DECISIONS-through-v11.14.5.md#5-itemattitude-had-no-type-label--fixed)
- undated — [6. The importer references a lang key it does not own — CORRECT AS IS](DECISIONS-through-v11.14.5.md#6-the-importer-references-a-lang-key-it-does-not-own--correct-as-is)
- undated — [7. `TYPES` labels lost a disambiguator — intentional](DECISIONS-through-v11.14.5.md#7-types-labels-lost-a-disambiguator--intentional)
- undated — [8. formation and influence had no `tools/pack-data.mjs` — RESOLVED](DECISIONS-through-v11.14.5.md#8-formation-and-influence-had-no-toolspack-datamjs--resolved)
- undated — [10. `npm run validate` — RESOLVED, and now carries merge guards](DECISIONS-through-v11.14.5.md#10-npm-run-validate--resolved-and-now-carries-merge-guards) — superseded in part by "The merge (0.1.0, 2026-07)", its 2026-08-02 addendum
- undated — [9. Macros — RESOLVED](DECISIONS-through-v11.14.5.md#9-macros--resolved)
- undated — [12. Single-branch development — RESOLVED (isolation off, guard on)](DECISIONS-through-v11.14.5.md#12-single-branch-development--resolved-isolation-off-guard-on) — superseded in part by "2026-11-12 — Topic and parked branches return, opened and landed by one tool" (acks-module-template docs/DECISIONS.md)
- undated — [13. The Patreon link — header icon and one footer line](DECISIONS-through-v11.14.5.md#13-the-patreon-link--header-icon-and-one-footer-line)
- undated — [14. The site's stale sections, and the two guards that end them](DECISIONS-through-v11.14.5.md#14-the-sites-stale-sections-and-the-two-guards-that-end-them)
- undated — [15. Domains at War: Battles is out of scope — interop, not resolution](DECISIONS-through-v11.14.5.md#15-domains-at-war-battles-is-out-of-scope--interop-not-resolution)
- undated — [16. The importer joins — RESOLVED (2026-09-01)](DECISIONS-through-v11.14.5.md#16-the-importer-joins--resolved-2026-09-01) — superseded in part by "2026-11-13 — Only what the module and the current system write is served"
- undated — [17. A free variable fails validate (2026-09-17)](DECISIONS-through-v11.14.5.md#17-a-free-variable-fails-validate-2026-09-17)
- undated — [18. A guide links another by its file, and the site re-points the link (2026-10-01)](DECISIONS-through-v11.14.5.md#18-a-guide-links-another-by-its-file-and-the-site-re-points-the-link-2026-10-01)
- undated — [19. The settings reference names every feature that registers a setting (2026-10-01)](DECISIONS-through-v11.14.5.md#19-the-settings-reference-names-every-feature-that-registers-a-setting-2026-10-01)
- undated — [20. Prose names a compendium pack only while the manifest declares it (2026-10-01)](DECISIONS-through-v11.14.5.md#20-prose-names-a-compendium-pack-only-while-the-manifest-declares-it-2026-10-01)
- undated — [21. The compendia reference lists what an import leaves (2026-10-01)](DECISIONS-through-v11.14.5.md#21-the-compendia-reference-lists-what-an-import-leaves-2026-10-01)
- undated — [22. Prose names a macro only while the pack holds it (2026-10-06)](DECISIONS-through-v11.14.5.md#22-prose-names-a-macro-only-while-the-pack-holds-it-2026-10-06)
- undated — [23. Interface text and comments name a macro only while the pack holds it (2026-10-06)](DECISIONS-through-v11.14.5.md#23-interface-text-and-comments-name-a-macro-only-while-the-pack-holds-it-2026-10-06)
- undated — [24. The suites and the child checks run side by side (2026-10-08)](DECISIONS-through-v11.14.5.md#24-the-suites-and-the-child-checks-run-side-by-side-2026-10-08)
- undated — [25. The macro pack is launchers (2026-10-28)](DECISIONS-through-v11.14.5.md#25-the-macro-pack-is-launchers-2026-10-28)
- undated — [26. The module map and the API reference are generated, published and shipped (2026-11-10)](DECISIONS-through-v11.14.5.md#26-the-module-map-and-the-api-reference-are-generated-published-and-shipped-2026-11-10) — superseded in part by "2026-11-10 — The developer reference is on the site only"
- undated — [27. The developer reference is on the site only (2026-11-10)](DECISIONS-through-v11.14.5.md#27-the-developer-reference-is-on-the-site-only-2026-11-10)

## 2026-11-13 — 28. The walk runner records every walk; suites are discovered

**Problem.** The template's release preflight now refuses a tag while a
required walk has no current result in `aia-tmp/live/walk-results.json`
(template DECISIONS, 2026-11-12, "A tag needs a recorded walk result for every
required walk"). This repo's runner kept no verdict past the console, 52 of
its 65 walks set their exit status as `passed === checks.length ? 0 : 1`, so a
walk that ran no check exited 0, and `run-tests.mjs` named its 205 suites by
hand.

**Ruled.** The module's half, built to that entry's contract:

- `tools/live/run.mjs` records each attempt through the synced
  `tools/walk-results.mjs`, and exits 0 only when every walk it ran reduced to
  `passed`. Before, a walk that exited 0 with no FAIL read green whether or
  not it reached its end. `--list` shows each record and whether it is still
  current; `--classify` puts a ledger row on a non-pass, reading the ledger
  from `ACKS_BUG_LEDGER`, a machine variable, so no ledger path enters the
  repo.
- `partial` is set for every walk of a run whose environment carries a
  variable that narrows a walk (`PARTIAL_VARS` in `run.mjs`), even a walk that
  ignores it: a subset recorded as the whole costs more than a whole recorded
  as a subset.
- Each walk prints `WALK END` through `tools/live/_walk.mjs` `walkDone()` as
  the last statement of its `try`, and `WALK BLOCKED:` through `blocked()`
  where a seat is not its own. Only that condition was converted: a missing
  seat user, an unimported book and a fixture in the wrong shape stay errors,
  because each can also be the code's fault. `validate-extra.mjs` §4b fails a
  walk that does not call `walkDone()` exactly once.
- `run-tests.mjs` finds its suites by glob (`tools/test-*.mjs`,
  `tools/importer/test-*.mjs`, `discord/test/*.test.mjs`) beside an exclude
  list whose entries must name files that exist. Discovery added three
  discord suites nobody had listed. The eight OSE importer suites are
  excluded, since `tools/importer/validate-extra.mjs` already runs them.
- The owner's R17, "The local-only rules tests run once on the working tree
  after step 5's precheck, by a `run-tests` flag P2 adds": `--rules`, as
  `npm run test:tree`, fails when `tools/rules-tests/` is absent or empty.
- `audit-imports.mjs` runs as validate-extra §11 and fails validation.
  `audit-styles.mjs` runs as §12 and reports its count without failing. It
  carries 54 open findings, and its header had claimed a validate run that
  never existed.

**Cost.** A run with `STAGE` set reads partial, and three walks cover less
than the whole by default: henchmen's second stage and monsters-leaders'
stages 4–7 run only with `STAGE` set, and markets with `STAGE` set prints no
`WALK END`. That is ledger row T-0523. Exit 4 is new: the runtime tree could
not be read or a result could not be recorded. A peer's runtime edit during
a walk marks it as changed during its run.

## 2026-11-13 — 29. Only what the module and the current system write is served

**Ruled** (owner, 2026-11-12, for the Public Beta release): "Legacy support
out." It follows the owner's 2026-11-11 words for the close-out, "cancel any
new time on tools designed to repair previous versions" and "Repair broken
imports is not the same as fix previous versions of imports. The former is
still approved." Amended the same day, after the `acks` 14.1.0 migration
runner was found to write only its stamp: `lib/patches/legacy-source.mjs`
and the `lib.stampedRecords` repair check stay, because worlds on the current
system still hold the old record shape.

**The test.** Each item was read, not judged by its comment: who calls it,
and whether anything the current module or the current `acks` system still
writes the shape it handles. What only an earlier version of this module (or
one of the standalone modules merged into it) wrote is removed, with no
migration in its place. What the current system or the current module still
produces stays, under whatever name it carries.

**Removed:**

- The carry-over from the retired standalone importer (`migrate.mjs`,
  `legacy.mjs`, the `importerScopeMigrated` and `shelf` settings and the
  guard that kept the built-in importer off while the old module was
  enabled); `module.json` still declares the conflict, since the two would
  write one library.
- The `@PdfText` placeholder repair (`legacy-text.mjs`, its step in Import
  Everything and its api key): no current writer makes the tag. Ledger row
  T-0368, a placeholder that step left, closes with it.
- The `effectsFrom` stamp's repair check; `effectsOriginOf`, which every
  current writer calls, stays.
- The retirement of per-map Adventures (`retireMapAdventures`,
  `kind.settlementAdventure`): nothing has written one since the book
  Adventure replaced them.
- The location data model's fold of the standalone module's loose market
  fields into `market` (`location-migrate.mjs`), and the henchmen ready-time
  sweep that cleared market postings on a location below schema version 2,
  with its `schemaVersion` setting, which nothing read.
- The two previous-version tools built on 2026-11-11, which the owner had
  asked to see walked: the class builder's correction of a saved racial value
  of 0 with no race to -1 at load, and the `henchmen.monsterEmployers` repair
  check. Asked on 2026-11-13 whether they go, the owner answered "Remove both
  (Recommended)". That is the new evidence the classes entry of 2026-11-11,
  under seven days old, is superseded on.
- The ability flag migration (`thiefSkill`, `levelFactor` onto the throw) and
  the language migration (ability-typed `def.language.*` items, carrier entry
  names); the formation entry of 2026-11-11 that names the first is
  superseded in part on the owner's 2026-11-12 ruling.
- The battlemap's hand-declared routes (`hexRoutes`) and the scene control
  that converted them to road walls; roads are walls.
- Markets' `hubShift` ordinal and `dmKnowledge` with its move into report
  items; a location's string argument to `slanderCountFor`; the table
  documents' lookup of a table or folder by name from before it was stamped.
- `passengerCost`'s unread vehicle argument, `travelMultiplier`'s `road: true`
  and a settlement board's pre-`hour` night flag, read from a stored board
  and accepted by `patchSettlement`.
- Equipment: `isLegacyImport` (an offline run of the importer's weapon path
  over the printed grid bound 25 melee weapons, every one with a size and none
  with a tag), the `thrown`, `handy` and `hands` item flags nothing writes, a
  named item's stored `max`, and the `equipment.railClothing` repair check for
  garments written before the clothing hooks.
- The importer's repairs of what an earlier importer wrote wrong: the four
  equipment sweeps (`repairEquipmentAbilities`, `repairAnimalItems`,
  `repairShieldVariations`, `repairPricedSubtypes`), `repairAmmoWeapons` and
  `repairClassLadderKeys`; the language import's retype of an ability-typed
  language; the location store's read of a bare handle; and an ability with
  no `effectsFrom` stamp read as unverified for its `unaudited` tick. The
  current importer writes none of these shapes, so each was a fix of a
  previous version's import, which the owner's 2026-11-11 words set apart from
  the repair of a broken one. Prune (`danglingAbilities`) stays: it reads the
  world against the cookbook as it stands.
- Lib: the `lib.mountPairs` check and the read of the rider and mount pair
  from before mounts were attachments, with the cleanup that converged it;
  the `lib.mergeResidue` check and its macro, Clean Up After the Merge (GM),
  which §11 ruled for the separate modules' leavings; the `embeddedBundles`
  check's market purchase from before purchases unpacked; the group data
  model's fold of a single-stack group into `stacks`; this module's earlier
  status id for Hidden; and the two ready-time sheet sweeps, the monster
  landing-sheet pin and the one-time release of hirelings from the Follower
  Card, with its `retainerCardsReleased` setting.
- Formation: `mergeFogCopies` with its macro, Merge Fog Copies on This Scene
  (GM), and the complete-snapshot flag a lost party's fog restore read for
  snapshots taken before it; the `hexStock` check's ids for stocked points
  written without one; and the `partyActors` check's report and fix of a member
  held by two parties, which the current membership writers refuse. The
  formation api is version 23.

**Kept, as current-version paths:**

- `migrateDefenseBands` (monsters): the importer still writes a monster's
  defence-band effects as a joined string, and this sweep is what turns them
  into the set the data model stores.
- `lib.legacyEffectKeys`: Active Effects authored under `acks` 14.0.x still
  carry the old field names, in the worlds `legacy-source.mjs` is kept for.
  Asked, the owner answered "Keep it (Recommended)".
- The chargen "legacy row path" (`grantRowEntries`), the whole grant for a
  template row with no bundle; the equipment setters on the Construction tab;
  the base-type guess every item depends on; `WALL_DOOR_TYPES`, core 14's
  plain constant; `canEnter`'s boolean `road`, which its one caller still
  passes from the country reader.

**Cost.** A world built on an earlier version and never repaired or
re-imported keeps whatever shape that version left; the release notes say so
once, and a repair or a re-import is how such a world catches up.

## 2026-11-13 — 30. A major's gate is 47 walks, and the rest are suites

**Problem.** A major requires every walk in `tools/live/` (§28), and the set
had grown to 69 walks, about 265 seat-minutes of one world, with no recorded
reason for most of them to be walks. The owner, on seeing the audit: "I am
skeptical these test walks are necessary or doing more than proving import
value = import value." Most of what the retired walks asserted was a value
read back from a document the same code had just written.

**Ruled.** The owner took the audit in two steps, "B in prep for A" and then
"A: full apply". A check stays a walk only where a real server, a real seat or
a real browser is the thing under test. Everything else runs offline on
invented values, and a check that needs the Judge's own copy of a book lives in
the local-only `tools/rules-tests/` and never in a repo.

- **Retired with nothing carried:** `importer-bookless`,
  `importer-item-repair`, `location-judge-owner`, `formation-live-findings`.
- **Retired after a fold into a kept walk:** `classes-hit-points` into
  `classes-level-cap`; `location-house-spoil` into `location-storage-intent`;
  `importer-adventure` and the AX1 table roll into `importer-ax1` §3;
  `lib-cast-seam` into `magic-cast-summon`; `lib-missing-images` into
  `window-contract`.
- **Merged:** `formation-mapper-vulnerable` into `formation-mapper-mapping`;
  `henchmen-search-steps` into `henchmen-blocked-classes`;
  `classes-levelup-roll` into `classes-hp-record`; `importer-everything` into
  `importer-force-repair`.
- **Moved offline onto invented values:** the equipment layer and weapon-row
  walks, `importer-ax1-markets`, `henchmen-cultures`, `formation-party-skills`
  (`tools/test-party-skills.mjs`), `importer-class-rows`
  (`tools/test-class-sheet.mjs`), `monsters-leaders` (the generated-repertoire
  and leader suites; the Player's pin without a write folded into
  `monsters-encounter`), and the bindings of `importer-characters` and
  `importer-ax1-text`.
- **The smoke walk grew.** `window-contract` re-reads its recorder after the
  windows open, fails on a logged error, lists warnings, and opens every
  registered settings menu, the storage manager and one compendium.

**Rejected.** Keeping a walk for each recipe section: a section whose steps no
check drives stays a by-hand pass in its recipe, which says so, since a walk
that only repeats an offline suite costs a seat-minute per run and proves
nothing the suite does not. Trimming the kept walks' redundant checks in the
same change: each trim is a live-surface edit nobody can verify without a
world, so it waits for whoever next touches that walk.

**Cost.** Coverage the audit judged redundant is no longer checked by any
walk or suite: a Player seat's hand-out and shelf visibility of imported
characters, the Books-tab census row, a deleted carried item coming back under
its id, and the system's own cast with no claimant. Every edited walk is a
live-surface edit that nothing offline ran; the first major's gate walks them,
and a red result there is a finding, not a regression of the retirement.
`equipment-weapon-nulls` and `location-notes-tab` are red and stay on the
ledger (T-0531, T-0532), unfixed here; T-0533 and T-0534 carry two IP notes
the audit found in walks.

## 2026-11-14 — 31. A call meant for callers is published from its own file, and the docs are held to the namespace

**Problem.** The formation guide documented seven saved-marching-order calls
for macros, and none had ever been on `acksExtras.formation`: each feature
hangs a hand-written object on the namespace, the reference (§26) mirrors
those objects, and nothing collects a function from the file that defines it.
A front-door rewrite found the gap and deleted the guide section. Asked "The
formation saved-order calls (saveTemplate, applyTemplate, getTemplate,
deleteTemplate, reconcile) were documented as a macro API but are not on the
public acksExtras.formation api; the guide section was deleted. Keep them
internal or publish them?", the owner answered: "These should get grabbed by
the api publisher, if not that needs fixed, not this canary case".

**Ruled.**

- **A file publishes its own calls.** A file holding calls meant for a macro or
  another module ends with `export const publicApi = { … }`, identifiers only
  (a `key: identifier` entry renames on the way out), with a docstring naming
  the namespace that holds it. The feature's entry imports it and places it,
  as a group (`marchingOrders: marchingOrdersApi`) or spread at the top. The
  extractor reads it like any other literal, so the API page prints each
  call's own docstring.
- **Five checks, in the reference's problems.** R1: a `publicApi` no namespace
  reaches. R2: a file with a `publicApi` reached any other way (a hand key, a
  namespace import), so the manifest is the whole of what its file publishes.
  R3: a call in a manifest with no docstring. R4: a key reached twice where one
  route is a manifest. R5: an `acksExtras.<namespace>.<path>` in the README or
  `docs/` (the logs, `wip/`, `releases/`, `site/` aside) that the namespace
  does not hold; a first segment that is no namespace is a hook name and is
  skipped. They fail `tools/test-reference.mjs` in `npm test`, the site sync
  in `validate`, and the pages build.
- **The 18 hand-written objects stay.** A file converts whole or not at all,
  and R2 fails a conversion that leaves a hand line behind.
- **Where the formation calls live.** Asked where the seven live, with A
  grouped under their source names (recommended), B at formation's top level,
  or C grouped and renamed, the owner answered "C: grouped and renamed":
  `acksExtras.formation.marchingOrders` holds save, apply, get, list, delete,
  formUp and reconcile, and the guards name the call a macro typed.

**What the checks cannot see.** An unmarked function written in a doc by its
bare name: the canary was written exactly so, and no rule can tell
`saveTemplate(formation, name)` from prose. The convention closes it: a doc
names a call by its full `acksExtras.` path, which R5 then holds to the
namespace. A function nobody marks and nobody documents stays internal, which
is the intent: 3,210 exports under `scripts/` reach no key.

**Rejected.**

- *A docstring tag (`@api`) read at runtime.* A function's source text at
  runtime excludes its leading comment, so collecting tags needs generated
  code in `scripts/`, which the shared tree's edit ledger never attributes.
- *Hand assembly plus a gate on documented-public exports.* Doc mentions alone
  cannot define the set (bare names), and adding a tag states "public" twice.
- *A runtime `publish(fn)` registry.* It depends on import order and turns
  declarations into values the extractor cannot follow.
- *A whole-file namespace import.* Right for a file whose every export is
  public; for the saved orders it would also publish six exports nothing
  documents as calls.

**Cost.** The ten formation keys the entry hand-published from
`formation-model.mjs` moved into that file's manifest under the same keys (R2).
Two repeats with no manifest involved, `henchmen.rules.arrivalSplit` and
`vehicles.OFFICER_STATIONS`, are still settled by last-wins and not gated;
generalising R4 waits on their owners. A recipe that reached an unpublished
function through an `acksExtras` path now imports the function's file in page
context instead.

## 2026-11-14 — 32. Four one-time conversions go, one slice per feature

**Ruled** (owner, 2026-11-13, plan §31.11, on the four readers left after
entry 29): "Delete, slice per feature (Recommended)". Each went in its own
commit on 2026-11-13, under entry 29's test: nothing the current module or
the current `acks` system writes still holds the shape it handled.

- battlemap: `foldPaintedClimate` (with `paintedClimateOf` and
  `PAINTED_CLIMATE`) and `settleRegionsOnly`. The brush paints no climate
  regions, and `paintHexAt` makes every region on a regions-only layer already
  settled. This supersedes in part "The climate is the map's" and "The map
  shows one mode at a time".
- location: `storage-intent.mjs` whole, with `clearDefaultStorageOnce` and the
  `storageByIntent` world setting. Storage on a place is only what a GM
  switched on. This supersedes in part "Storage is switched on by intent".
- equipment: `resolveWeaponGroupPick`'s branch that read a bare category key.
  No current path stores one. This supersedes in part "A Martial Training pick
  grants its option's own weapons".
- vehicles: `normalizeTeamRows` and the sheet's `_onRender` that called it.
  This supersedes in part "The team has two halves: abstract rows, real
  attachments".

**Cost.** A world that still holds one of those shapes is not converted: it
starts new, or deletes its imports and imports again (the Beta's upgrading
note).
