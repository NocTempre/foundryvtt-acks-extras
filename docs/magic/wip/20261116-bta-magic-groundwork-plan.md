# Magic: By This Axe gnosis groundwork (wip plan)

**Status:** plan, written 2026-11-16 by the session seated on `topic/bta`
(worktree `foundryvtt-acks-extras.bta`). Each slice runs on that branch; a
slice with a runtime surface is landed with `branch.mjs land bta` and walked
on `main`. This file is the hand-over between sessions and is deleted when its
substance has moved into `docs/magic/` and `docs/importer/`
`{MODEL,DECISIONS,ROADMAP,TESTING}.md`.

No printed figure, rule sentence or printed proper name appears here. BTA's
invocations are named by page and ordinal (invocations 1-4 on one gnostic
class's list, invocation 5 on the other's, in page order). Builds and tests use
invented invocations.

## The owner's words

1. "restarting BtA to get the groundwork ready for it's magic system. If that
   can catch the spell effects work great."

Reading: build what the gnosis engine (magic ROADMAP 3c) will stand on, the
documents, the class lists and the tables, and ride the spell-effects channel
(`docs/magic/wip/20261115-spell-effects-plan.md`) instead of a second one.
Example: a gnostic caster's invocations land on the same Spells shelf as RR
spells, and the cast dialog serves them once it can offer an invocation level.

The earlier ruling that kept `topic/bta` off `main` until the Beta was tagged
(Beta plan §43) is spent: `v2026.11.14` is the Public Beta. The branch lands
like any topic (`.claude/rules/shared-tree.md`).

## What BTA prints, and what is imported (inventory, 2026-11-16)

BTA ch. 5 (pp. 118-137) holds the gnosis rules. No wiki oracle covers BTA; the
printed page is the only source.

| Element | Printed | Shape | Imported before this plan |
|---|---|---|---|
| Gnostic casting rows, two classes | pp. 62, 69; secrets pp. 132-135 | casting row + a maximum-invocation-level ladder | kind and ladder; no `spellList` |
| Repertoire rule | pp. 133-134 | prose | no |
| Gnostic value tables | p. 133 | two small tables | no |
| Implements | p. 120 | prose + a cost table | an equipment row with no cost |
| Performance grid, pace, ceremony level to mishap degree | pp. 120-121 | tables | no |
| Invocations, five | pp. 129-131 | a title line with Range, a gnostic-level tag with Duration, then a paragraph per invocation level | no (`cookbook/spells.json` has none) |
| Extemporaneous invocation | pp. 121, 134 | a class power | the power row only |
| Mishap table | p. 128 | table, three degrees | no |
| Corruption, stigma, research | pp. 122-123 | prose | no |
| Trinkets, talismans, scrolls | pp. 123-127 | prose + value tables | no |
| Spell builds | pp. 135-137 | design worked examples | no (later, needs ROADMAP 1b) |

## Rulings (the BTA session's architect, 2026-11-16)

1. **An invocation is the module's ordinary spell item**, through `bindSpell`
   with the same flag, `SpellExtras` and repair path as an RR spell.
   `lists = [{source: "gnostic", level}]` from the page's tag, matched by
   `traditionFor` against the casting row. No invocation marker: an invocation
   is a spell whose list's tradition has kind `gnosis`. The scoping file's
   `invocation: {is, extemporaneous}` is rejected; extemporaneous casting is
   a class power (p. 134), and the schema it would need is in `scripts/magic/`.
2. **One item per invocation, not one per level.** The invoker chooses the
   level at cast, up to the ladder's rung (p. 120); magic DECISIONS #1 (one
   document) applies. Counter, medium: p. 134 presents invocations as a
   prayerful repertoire of one spell per level, each with its own build, which
   five items would mirror for 1b's build records.
3. **The level paragraphs stay prose until the channel can execute them.**
   Executing them needs a row gate on the lowest invocation level a row
   applies at, `pick` for alternatives (exists), and a LevelValue scale on the
   chosen invocation level. The gate and the scale are lib; they are requests
   R1-R3, not built here.
4. **The register file is `register/bta/p129-p131-invocations.json`, ids
   `def.spell.*`.** Invocations 1-4 are named in common words, as their sigils
   already ship (`def.power.sigilOf…`), and ship under those words.
   Invocation 5's title holds the book's name for a being: it ships as
   "Invocation 5", id `def.spell.invocation5`, anchored by a hash of the
   title's letters (the `def.spell.ritual10` precedent).
5. **The anchor is the title line that carries a Range run.** The titles share
   that line with the Range run and recur in the section's intro prose, so the
   compiler's sub-heading branch (which only finds solo lines) gets an assist
   for a heading with a stat run beside it, and the stat value op reads the
   tag box before the stat box so `parseStatBlock` sees the tag first. Both are
   compiler changes; `bindSpell` and the spell logic are unchanged.
6. **List membership rides the repertoire mechanism**: a classMeta row
   `def.classmeta.invocationLists` reads the two section headings and the
   titles under each; `classes.mjs` gains `classInvocationsFor` beside
   `classRepertoireFor`, and the printed-repertoire call sites concatenate the
   two. `repertoireRefs` is unchanged. Authored refs on the class row are
   rejected: `bindClass` overwrites `spellList` from the repertoire.
7. **Gnosis tables are a `TABLE_RECIPES` group `gnosis`** (optional, book
   bta): the performance grid, pace, ceremony level to mishap degree, the
   mishap table and the implement cost. Grid values only, never the
   derivation printed beside the grid. Stigma, corruption and the item value
   tables come with their engines.
8. **Caster level and invocation level are separate axes (p. 120).** Both
   gnostic casting rows set `casterLevel` to the invocation ladder, so today
   the cast engine's caster level (spell-effects ruling 6) is the cap. B2
   separates them: a casting-row `levelCap` naming the ladder, `casterLevel`
   back to class level. It changes ruling 6's output for gnostic casters, so
   it is sent to the spell-effects line before it is built.

## Slices

Every slice: an offline green on the branch (`npm test`, `npm run validate`)
on invented invocations, committed by hand in the worktree. A slice with a
runtime surface is walked on `main` after landing, from an import of the
seat's own PDF.

| Slice | Agent, why | Files | Accept | Needs |
|---|---|---|---|---|
| **B1** Invocations as spells | `implementer`: scoped compiler + register change against these rulings | `tools/importer/compile-cookbook.mjs`, `register/bta/p129-p131-invocations.json`, full recompile, a test, importer DECISIONS | baseline first (entry counts per `cookbook/*.json`, `npm test`, `validate`); after a full recompile the only diff is five new BTA entries in `spells.json` and no WARN; each entry's extracted text holds every level paragraph and stops before the next entry and the boxed examples; an invented title-with-Range line parses with its tag. Walk: an import shows five items with stat, list and level text; what a cast does today is recorded | nothing |
| **B3** Invocation lists | `implementer` | the classMeta register row, its compile branch, `scripts/importer/cookbook/classes.mjs`, a test, the importer ROADMAP row "Gnostic invocations as documents" removed | offline: an invented two-list page yields `[{tradition, level, names}]` per class and the class's `spellList` refs; walk after a Classes repair: one class lists four, the other one | B1 |
| **B5** Per-level matrix | `implementer`, LOCAL-ONLY output | `C:\Proj\acks-rules\magic\BTA-INVOCATIONS.md` | per invocation and level: row kinds, gate vs scale, caster-level figures, saves, summons | nothing |
| **B4** Gnosis tables | `scout` enumerates, `implementer` writes | `scripts/importer/table-recipes.mjs`, docs | the recipe pages test runs; the Ruledata Browser lists them | word with the Treasure Tome session, which shares the file |
| **B2** Level cap | `implementer` after the line is told | `scripts/classes/class-data.mjs`, `scripts/classes/casting.mjs`, the Casting tab and lang, importer `classes.mjs`, the BTA casting rows, classes MODEL/DECISIONS/TESTING | the pool strip unchanged; `casterLevel()` source is the class; the cap shows on the Casting tab with a tooltip after a Classes repair | the spell-effects line's word on ruling 6 |
| **B6** Effect rows on the five | `implementer` | register rows, `spell-recipe-rules.mjs` | as the spell-effects plan's row rulings | R1-R3 and the 3c invocation throw (owner ruling B) |
| **3c** Ceremony procedure | `architect` first | invocation throw, pace, mishaps, stigma, purification, implements as levelled items, a sigil granting its invocation | | later |

After 3c: extemporaneous invocations and the printed builds need ROADMAP 1b;
trinkets, talismans and scrolls need 4a.

## Requests to the spell-effects line

Written to the shared notes folder for 1b; BTA builds none of them.

- **R1** lib: `VALUE_SCALES.invocationLevel`.
- **R2** lib: an `effectField` key for the lowest invocation level a row
  applies at, with its row-editor field.
- **R3** magic: an invocation-level choice in the cast dialog, capped by the
  tradition's cap, fed to `scales` and the R2 filter, shown on card and
  record; a Player blocked and a Judge warned above the cap.
- **R4** magic: no in-fight declaration for a casting time longer than a round.
- **R5** magic: a per-kind procedure seam between confirm and resolution, for
  3c's throw.

## Risks

- B1's compiler change is on a path every book compiles through; the
  baseline diff is its guard.
- `cookbook/spells.json` is regenerated by the spell-effects line too. At a
  landing the generated file takes `main`'s side and the full compile reruns,
  never a book-scoped splice.
- One invocation summons; a `summon` row would hand the cast to
  `castSummon`, which has no BTA creatures. Not authored until B6.
- Until R4, a cast invocation in a fight is declared like a one-round spell.

## Owner questions

- **A.** May the invocation documents and the class lists ship before any
  effect rows, cast through today's spell path? *Recommended: yes.*
- **B.** Until the 3c invocation throw exists, may an invocation's effect
  rows execute with the throw left to the Judge? *Recommended: no;* skipping
  a printed procedure is a house rule by omission.
- **C.** Import the gnosis tables now, before any engine reads them?
  *Recommended: yes,* as the dependency half (TOOLCHAIN §10e).
- **D.** Does the BTA groundwork ride the minor held for spell effects?
  *Recommended: yes.*

## Owner rulings (2026-11-17)

The owner, whole: "A Yes, B No, C Yes, D Yes". Reading, per question:

- **A yes:** the invocation documents and class lists ship before any effect
  rows; B1 and B3 stand as built.
- **B no:** no invocation effect row executes until the 3c invocation throw
  exists. B6 waits on 3c as well as R1-R3.
- **C yes:** B4 imports the gnosis tables now, before any engine reads them.
- **D yes:** the BTA groundwork rides the minor held for spell effects.

## 3c rulings (the BTA session's architect, 2026-11-17)

Ruled against `topic/bta` at `a22907fe` and `topic/spell-effects` at
`3ddddb6e`, with BTA ch. 5 and HFH's ceremonial chapter read from the shelf.
Nothing here is a printed figure, a rule sentence or a proper name; tests use
invented tables.

**Reuse map.** lib provides the tables registry (`getTable`, `citeOf`,
`bracketRow`, `bandDie`, the override layer), `abilityMod`,
`renderRollCard`, `field-spec.mjs`, `openCoreWindow` and the loss hook;
classes provides the ladder; the cast seam is R5. New: the ceremony engine,
its two flags, and a table set per tradition kind.

1. **Three outcomes, three steps** (BTA pp. 120-121). Inputs: the invocation
   level (R3, capped by B2's `levelCap` rung); the invoker level (ruling 6's
   `{value, parts}`); the pace; the implement set; the Wisdom modifier
   (`abilityMod`); a situational part, marked as set by hand. Target: the grid
   cell at that row, in the column whose header matches the invoker level,
   never picked by position. Success: the total meets the target and the
   natural roll is outside the pace's failure band; the cast goes ahead.
   Failure: no rows run; one stigma mark. Botch (a natural roll in the band,
   or ruling 8): a stigma mark and a damage mark on the set, then a mishap
   throw with the same parts and target; only if it fails is the degree read
   (`ceremonyDegree` at the invocation level, shifted by the pace's degree
   rule). Below the lowest degree the set is lost and nothing is rolled;
   otherwise the mishap die, read off the table's own faces, picks the row,
   the degree the column, and the card shows the imported cell. Supersedes
   the scoping file's "failure adds stigma and rolls the tier's mishap
   table". Rejected: working a target out of the printed derivation when the
   grid has no cell (B4 ruling 7). Counter (medium): most botches post two
   throws.
2. **The throw's parts are closed.** The talisman (pp. 120, 126) comes with
   4a, one bonus counted through `resolveStacking`; the extemporaneous
   penalty (p. 122) with 1b; the trinket-storing and substitute-component
   penalties (p. 124) with 4a and research. The grid already counts the
   abilities p. 120 gives every invoker the book prints: the gnosis set
   declares `gridIncludes`, and the throw adds no part for them, p. 127's
   bonus included. Counter (medium): a Judge-built gnosis class without those
   abilities gets too easy a target (question 3c-E).
3. **Values are imported; units and step order ship.** Imported through
   `getTable("gnosis", …)`, Judge-editable through the Ruledata Browser's
   override layer (an overridden figure's tooltip says so): the grid; each
   pace's time, modifier, failure band and degree rule; the degree bands; the
   mishap cells; the implement costs; and, new in C1, a `proseValues` table
   `gnosisProse` (the corruption multipliers, pp. 122-123; the purification
   times, p. 123), and the stigma marks a failure adds and the damage marks a
   botch adds (the BTA session's IP call, 2026-11-17: printed figures, so the
   engine takes them as arguments and a missing one writes nothing; this
   supersedes the block's first wording, which shipped them as counts of
   events). Shipped: the threshold comparison and step order;
   pace keys `hasty|regular|methodical`, matched by the word in the pace
   cell; the degree as an ordinal matching the mishap columns in print order;
   Wisdom-score multiples as the corruption thresholds. One reader parses the
   raw cells; an unparsable cell is null, never a guess; a missing cell stays
   blank with its page.
4. **HFH shares the procedure, not the tables.** No importer reader for HFH
   exists, and secrets p. 134 keeps gnostic and eldritch items apart.
   `ceremony.mjs` takes a set per tradition kind (`CEREMONY_SETS.gnosis`: doc
   id, table ids, `gridIncludes`); `ceremonial` registers its own once a
   reader exists (a ROADMAP row).
5. **Where state lives.** Actor:
   `flags["acks-extras"].ceremony = {stigma: [{castId, at, cause}],
   corruption: {points, wounds, log}}`; stigma is the entry count, at most
   one per `castId`, so a replay writes nothing; it belongs to the invoker,
   not a tradition (p. 123). Threshold: a new `casting.mjs` export,
   `traditionCapAt(classItem, tradition, level)`, which `poolState` also
   reads; null means no lockout, only a note. Item:
   `flags["acks-extras"].ceremony = {implementLevel, damage}`, offered on the
   imported row (`def.equip.gnosticImplements`) and on any item carrying the
   flag; effective level is level less damage; the invoker picks the set
   used from those whose effective level reaches the invocation level, the
   card names it, and a botch damages that set (the owner, 2026-11-18,
   superseding "the throw takes the highest set high enough"). Rejected: stigma in
   `classes.pools` (`restPools` clears the whole flag, so a rest would
   purify); a spent `RESOURCE_KINDS.stigma` pool; implements on 4a's
   `magicItem` flag (gear, not magic items); one item per implement level.
6. **Corruption** (pp. 122-123; secrets p. 133). Each invocation is authored
   with `SpellExtras.corruption` (`none|creates|souls`); the multiplier is
   imported; corruption is written on success only; each Wisdom-score
   multiple crossed adds a wound due, up to the tradition's cap rung; the
   card offers `openCoreWindow("mortalWounds", actor)`. Counter (medium): the
   page ties the cap to the repertoire's highest invocation, and "performs"
   may mean the attempt rather than the success.
7. **Verdicts** go through `castVerdicts`' severity (a Player blocked, a
   Judge warned): stigma at or over the threshold; no set high enough; the
   pace not imported; a non-hasty pace in a started fight; a blank target
   cell. A Judge past a blank target posts the roll and no rows run (owner
   ruling B). Counter (medium): the Judge has no single-press way to apply an
   outcome.
8. **Disruption.** In a fight a hasty invocation is declared like a spell; a
   gnosis declaration stamped lost is a botch (p. 121). R5's `lost` runs it
   once on the primary GM, else when the caster reports, idempotent by
   `castId`.
9. **Purification** (p. 123). The strip's Purify press checks a set is held,
   empties the ledger and names the imported rest and rite times; it writes
   no time. Trinkets (4a) are named, not touched. Purification as a turn
   activity is a ROADMAP row.
10. **Sigils stay out of 3c**: a sigil granting its invocation is a
    repertoire grant (ROADMAP 2). Counter (medium): this plan's 3c row named
    sigils.
11. **The R5 contract** (the spell-effects line builds it; nothing new in
    `scripts/lib/`). A lane file `cast-procedure.mjs` holds
    `registerCastProcedure(kind, procedure)`.
    - (a) Every magic claimant consults it: `castSpellClaims` also claims a
      flagged spell whose tradition has a procedure, rows or not (today it
      turns rowless spells away); `castSummon`, asked first, runs the same
      step, since `isSummonSpell` takes any spell with a summon row and two
      invocations summon.
    - (b) `fields(ctx)` returns field-spec specs rendered by
      `apps/cast-dialog.mjs`; `verdicts(ctx, answer)` feeds `castVerdicts`.
    - (c) `castingTime(ctx, answer)`, read by `cast-moment.mjs` for R4. The
      one invocation level that prints its own casting time waits for R2;
      the Judge's call until then.
    - (d) `perform(ctx, answer)` runs in `cast-spell.mjs` and
      `cast-summon.mjs` after `spend()` and before the rows, returning
      `{proceed, section, rolls, undo}`; the card draws the section;
      `proceed: false` runs no rows and writes no records.
    - (e) `lost(ctx, declaration)`, called from `cast-declare.mjs`.
    - `ctx` = `{actor, spell, tradition, classItem, invocationLevel,
      casterLevel, isGM, moment, combat, source, roll, now}`; a trinket
      `source` (4a) skips the procedure. Also needs R3 reading `levelCap`,
      R4, and B2 landed.
12. **Before R5 only the dependency half is built** (TOOLCHAIN §10e): C1-C4
    add no hook and no surface, and a release carries them only with C5.

### 3c slices (`topic/bta`; none starts before the minor ships)

| Slice | Agent | Files | Accept | Mark |
|---|---|---|---|---|
| C1 prose figures | implementer | `table-recipes.mjs` `gnosis.gnosisProse` (shared: talk to the TT and importer-books sessions first), importer TESTING | invented prose reads each figure, blank on a miss; a local import reads every figure ruling 3 lists for it, with cites; walk: the Browser lists it | buildable without UI |
| C2 engine | implementer | `scripts/magic/ceremony-tables.mjs`, `ceremony.mjs`, `tools/test-ceremony.mjs` | invented tables cover every path in ruling 1; pace cells in several wordings; dash and minus forms; negative targets; a blank cell gives null with its cite; an override is cited as the Judge's; mutation checks; Foundry-free | buildable without UI; needs 3c-A, 3c-E |
| C3 state | implementer | `scripts/magic/ceremony-state.mjs`, `traditionCapAt` in `casting.mjs` (shared with the spell-effects line), tests | a replay writes nothing; purify empties the ledger; damage lowers the effective level; wounds stop at the cap; test-classes unchanged | buildable without UI |
| C4 corruption kind | implementer | `spell-extras.mjs` (tell the spell-effects line), BTA invocation register rows, lint, full recompile | the only cookbook diff is the authored field | data buildable; Overview field needs /design |
| C5 surfaces | implementer | `casting.mjs` strip, equipment item sheet, lang, styles | walk with `magic/gnosis-invoker` and `magic/gnosis-implements`: +/− refused on a Player seat; Purify; implement level | needs /design |
| C6 procedure | implementer | `scripts/magic/ceremony-procedure.mjs`, lang, magic TESTING | walk on a Player seat: a failure adds stigma; a rigged botch shows the mishap; threshold and missing set block the Player and warn the Judge; a hurt hasty declaration botches | needs R5, /design, 3c-B, 3c-C |
| C7 = B6 effect rows | implementer | register rows, `spell-recipe-rules.mjs` | this plan's row rulings | needs R5 (through C6), R1-R3 |
| C8 docs | session; doc-scribe for fragments | magic MODEL "Ceremony", DECISIONS, ROADMAP rows (HFH set, mishap execution, a performing-time record, purification as an activity, sigils), fragments | nothing stated twice | with C5 and C6 |

### 3c surfaces awaiting /design

- **D1 cast dialog:** a pace choice from the imported rows (tooltip: time,
  modifier, band, cite) and a situational modifier.
- **D2 cast card:** the throw section — target and parts, natural roll,
  total, outcome; damage mark; mishap throw, degree, face and imported result
  with cite; stigma as n/threshold; corruption with a wound line and an Open
  Mortal Wounds press; the Judge's Undo.
- **D3 casting strip:** stigma chip, Judge-only +/−, Purify.
- **D4:** the Purify confirm dialog.
- **D5 casting strip:** corruption chip, Judge-only +/−.
- **D6 equipment item sheet:** implement level select (cost row in its
  tooltip); damage with a Judge-only reset.
- **D7 spell sheet Overview:** corruption kind select.
- **D8:** ruling 7's warning and block notices.

### 3c owner questions

Answered 2026-11-17, the owner: "Take recommendations". A yes, B yes, C no,
D yes, E yes.

- **3c-A.** Is every automatic failure p. 120 lists a botch? *Recommended:
  yes;* p. 121 groups being hurt with a natural roll.
- **3c-B.** A regular or methodical invocation outside a fight: throw at
  confirm, the card names the time, the Judge moves the clock and applies any
  disruption? *Recommended: yes;* a record held for the performing time is a
  ROADMAP row.
- **3c-C.** Do mishap results run automatically? *Recommended: no;* the card
  shows the imported result and the Judge applies it.
- **3c-D.** No repair is printed for a damaged set: is the Judge's reset the
  only way back? *Recommended: yes.*
- **3c-E.** A Judge-built gnosis class uses the grid as printed, the tooltip
  naming what the grid already counts? *Recommended: yes.*

### 3c risks

- R5 without (a) or (e): the throw is unreachable, or a lost declaration's
  botch is never written.
- A misparsed cell blocks every cast.
- `table-recipes.mjs`, `spell-extras.mjs` and `casting.mjs` are shared.
- `levelCap` shares its name with `levelCap()` in `classes/level-cap.mjs`.
- Without C5 the stigma ledger has no Judge tool.

## Results

### Results, 2026-11-17

Built on `topic/bta` and landed on `main` (not pushed): B1 `5d9d8a32`, B3
`a68d34ce`, the importer TESTING recipe `dc98b92d` ("By This Axe invocations
and the gnostic classes' lists"). B5's matrix is on the rules shelf beside the
level 1 matrix, LOCAL-ONLY.

- **B1, offline:** a full recompile adds five entries to `cookbook/spells.json`
  (337 to 342) and moves nothing else; the WARN set is unchanged.
  test-stat-beside 5 checks on invented content; npm test and validate green.
- **B3, offline:** one classMeta entry added to `cookbook/classes.json` (37 to
  38), nothing else moved; test-invocation-lists 14 checks on invented
  content; npm test 243 suites; validate green. Rulings beside the plan's are
  importer DECISIONS 2026-11-17.
- **Walk, recipe steps 1-2,** on main from the seat's own BTA PDF (a seat lane
  with `FIXTURE_OWN`, so partial): the entry picker reimported the five
  invocations and the two classes through its Repair in place confirm. Each
  invocation has one gnostic list, a range, a duration and four labelled level
  paragraphs, with no worked example and no stat text in the description; the
  fifth is named from the page. One class's gnosis row lists four invocations
  and the other's one, each resolving to its spell. 16 of 16 observables
  hold (one check first read "for example" in prose as a leaked callout; the
  callout marker is absent).
- **Not walked:** recipe step 3, the cast of an invocation from a character,
  which is the evidence for owner questions A and B. The walk was a scratch
  driver, not a committed `tools/live` walk.
- **Spell-effects line:** requests R1-R5 and the caster-level finding are in
  the shared notes folder for session 1b.
- **Next:** B4 (a word with the Treasure Tome session first), then B2 once the
  spell-effects line has answered on ruling 6; B6 waits on R1-R3 and owner
  question B.

### Results, B4 (2026-11-17)

- **Landed** on `main` as `c8eeaac9` (not pushed), as built: the owner's
  "get the done code released" overrode moving it into the per-book layout
  first; new book-specific importer code goes under
  `scripts/importer/books/<id>/` once that seam lands. The `boxed` wrap mode
  stands beside the Treasure Tome's `centered` (agreed with that session; a
  later cleanup may fold them).
- **Offline:** test-grid-rows 73, test-recipe-content 187 tables (local),
  test-recipe-pages 2415, npm test 247 suites, validate; the treasure and
  magic-item table checks pass on the merged extractor.
- **Walk, importer TESTING "The gnostic tables", steps 1-3,** on main from
  the seat's own BTA PDF (seat lane, `FIXTURE_OWN`, partial): the gnosis-only
  import ran with no page notice; the five tables read their full shapes with
  no empty or missing row, the mishap table's thirty cells each a whole
  sentence; each cites its BTA page; the Ruledata Browser lists and renders
  the five with cites. 13 of 13 observables (one check first misread the pace
  table's named fields as missing columns). **Not walked:** step 4, the import
  with the book closed.
- **Owner, 2026-11-17:** "Wait for 1b's seam" for the invocation throw (B7),
  and no new BTA slice starts until the minor ships.
- **Owner, 2026-11-17 (relayed):** the minor ships after every topic is
  merged, landing in the order importer-books, treasure, dungeon-closeout,
  bta. Its scope is "All scheduled work", so B6 and B7 are asked about too.
  Topic/bta was synced onto main 4c42e5e6, and B2 is now `a93a5177` (was
  `a22907fe`). The rebase conflicted only on the cookbook stamp, which took
  main's side and was regenerated by a full compile; that compile differs from
  main only in B2's two class rows. npm test (270 suites) and validate are
  green on the new tip. R1-R5 are unscheduled on the spell-effects line (main
  4c42e5e6: `castSpellClaims` still turns away rowless and summoning spells,
  and nothing hooks between `spend()` and the rows), so the orchestrator holds
  an owner question on how B6 and B7 reach the minor. C2 and C3 are built
  ahead on topic/bta. C1 is held under the per-book importer ruling, and C4
  until the spell-effects line agrees to the `spell-extras.mjs` change.

### Results, C2, C3 and the 3c design (2026-11-18)

- **Owner on how B6 and B7 reach the minor:** "(b) spell effects adds it".
  R1-R5 are ruled 200+ in the spell-effects plan and are built after
  topic/spell-effects lands with 1c.
- **C3** `fba9f898` on topic/bta (not landed): `ceremony-state.mjs` and
  `traditionCapAt`; `poolState` shares a private `capRungAt`, its output
  unchanged. test-ceremony-state 21, npm test 271 suites, validate green, 6
  mutation checks.
- **C2** `c2bf7f7e` and `910c787e` (mishap cells keyed by column number) on
  topic/bta (not landed): `ceremony-tables.mjs`, `ceremony.mjs`,
  test-ceremony 45 checks and 9 mutation checks; npm test 272 suites, validate
  green. A read-only probe on a seat lane ran the topic's readers against the
  world's imported gnosis tables:
  - every printed grid cell parses (50 of 50; the 34 misses are levels the
    grid does not print);
  - every pace parses its time, modifier, band and shift;
  - the three degree rows read, and the mishap rows read 10 by 3 with no empty
    cell and the die read;
  - all 15 level-and-pace pairs resolve to a degree, or to a lost set where
    the shift goes below the lowest band.

  Readings to keep: the degree rule shifts the level before the band lookup;
  a level above the bands blocks with `degreeUnreadable` (never on the
  imported data); the `gridIncludes` keys `invokerAbilities` and
  `supplementBonus` are the part keys C6 and 4a must use.
- **/design for D1-D8:** https://claude.ai/artifact/DyscmRWo2r7x3fpzbSRMZT,
  sent for the owner's approval. Placement agreed with 1b: a canvas of its
  own, cast canvas v6 untouched; where R3's level select sits follows ruling
  200+. The owner on the first revision: "Spend more effort to unify style
  with the repo design language. BTA ceremony surface is directionally
  correct. More leveraging game-icons for things like pace, Show the
  fetish/foci/etc as buckets to fill with attention on them. Stigma should add
  visual feedback like cracking or smoke effect, idk." Then: "The stigma
  comment was not an animation request, it was a suggestion for visual
  feedback of getting darker/more broken as stigma accumulates". Revision 2
  (version 1794981040-b5ae) is drawn in the family's parts, with glyphs from
  the game-icons pack by path or core Font Awesome; implements as an
  equipment-slot bucket; stigma in three static steps on the badge and the
  portrait, the crack texture a labelled placeholder. Open owner questions on
  the canvas: Q1, one bucket of levelled sets or one slot per kind of
  implement; Q2, may an invoker choose a lower set that is still high enough.
- **R5 gains a `band(ctx, answer)` hook,** extending 3c ruling 11(b): a
  field spec cannot carry glyph segments or a bucket. Relayed to the
  spell-effects line.
- **Owner, 2026-11-18:** "Find open art to attribute or better yet
  art/texture imported from the book. Standing rule for repo no generated
  art." and "Make sure that rule gets stored properly to not get missed
  again." The rule is the template's `ip-doctrine.md`, "Art: imported or
  attributed, never generated" (template `93c8fce1`); it reaches this repo at
  the next toolchain sync.
- **Owner on Q1 and Q2, 2026-11-18:** "BTA implements should follow raw with
  values and tiered effects. You get the effect you use the supply for..."
  Read against BTA p. 120: a set of implements is rated in levels, with a
  cost per level and one encumbrance whatever the level; the invoker chooses
  the invocation level at cast, and the set used must reach it. Q1: one
  bucket of levelled sets, so ruling 5's item shape stands. Q2: the invoker
  picks the set used. Example: an invoker holding sets at effective levels 3
  and 4 performs at level 3 with either and gets the level 3 effect; a botch
  damages the set picked, so choosing the level 3 set puts it at risk and
  spares the other. A set at effective level 2 cannot be picked for level 3.
  The pick is a cast-dialog input to C6. C3's `bestSet`, which chose the
  highest set, gives way on topic/bta to a list of the sets high enough,
  lowest first, which the dialog offers. The canvas (version 1794982312-362a) draws D1 as a radio group of
  the sets held, opening on the lowest set high enough, a display choice.

### Results, the bta landing (2026-11-18)

- **Landed** on `main` as `e2e8d7f6` (not pushed), after the treasure topic:
  B2 `f291b0b0`, C3 `06ee7ced`, C2 `fd531602` and `b636d3c0`, and
  `e2e8d7f6` (`bestSet` becomes `usableSets`; the invoker picks the set).
  These replace the shas above, which the syncs rewrote; the stamp commit was
  dropped when main deleted the cookbook stamp. Gate on the landed tip: npm
  test, validate, a full recompile with no drift. Board 7 of the cast canvas
  and D1 here draw one implements bucket (spell-effects ruling 229).
- **Walk, classes TESTING "A casting row's level cap", steps 1-2,** on main
  from a seat lane with the staged BTA copy: both gnosis classes were repaired
  from the old shape (`casterLevel` holding the ladder, no `levelCap`, no
  strip line) to `levelCap` holding the ladder and `casterLevel` empty. The
  class sheet's Level cap select shows the ladder, with tooltip and
  aria-label; at level 5 the Magic tab's strip shows the rung's text, and
  `traditionCapAt` answers the rung's number on both classes. The console
  was not recorded.
- **Next slice:** C1, the gnosis prose figures, under
  `scripts/importer/books/bta/`. C4 waits on the spell-effects line's word;
  C5 and C6 wait on R5 and the /design approval.

### Results, deferral (2026-11-19)

- **Owner, relayed:** "BtA magic can get defered as simply needs more work
  later, mostly concerned about RR completion". C1, C4, C5, C6, B6 and B7
  are out of the next minor; what has landed (B1-B5, C2, C3) ships with it,
  read by no surface beyond the Casting tab's Level cap. The /design canvas
  (version 1794984538-829c, no placeholder art) awaits the owner's approval
  when the work resumes. topic/bta holds nothing beyond main and stays open
  for the next slice. ROADMAP 3c names what is deferred.
