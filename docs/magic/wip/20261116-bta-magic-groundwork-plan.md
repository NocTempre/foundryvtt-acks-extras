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
| **B6** Effect rows on the five | `implementer` | register rows, `spell-recipe-rules.mjs` | as the spell-effects plan's row rulings | R1-R3 and question B |
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
