# Classes — not built

How it behaves now is [MODEL.md](MODEL.md); rulings are
[DECISIONS.md](DECISIONS.md).

## A racial power that raises the maximum level

The owner's ruling (2026-11-11): the cap is a base plus a racial adjustment,
where the base is the human cap (-1) or the points table's row (0 to 4), and the
adjustment is the sum of the maximum-level adjustments the race's own powers
carry, 0 for no race and for a race whose powers carry none. One human-bodied
race's value-0 power is printed in the Judges Journal's custom-class chapter as
raising the maximum level, and the same chapter lists a custom power with the
same effect that any class below a printed ceiling may buy through the builder's
powers. The adjustment's size is printed, so it is imported, never shipped.

Not built, because the carrier is a design call. What exists today: a race rung
has a `maxLevel` field the derivation does not read; a rung's `powers` are ability refs; an ability
carries typed `modifier` effects, but `MODIFIER_TARGETS` names no maximum-level
target; the importer materializes race documents only for the two races whose
value ladders it reads (`builder-binding.mjs`), so the human-bodied race has no
document to carry a power at all.

Two carriers: (1) a `maximumLevel` modifier target, read from the power's own
imported text through the ability effect scan or a register recipe, summed by
the builder from the rung powers (and from `builder.powers`, which would give the
custom power the same effect for free); (2) a Judge-editable adjustment field on
the race rung, filled by a `proseValues` read of the power text. Either needs a
race document for the human-bodied race, so an importer table for that race's
ladder first. An unresolved power has to show its adjustment as "not imported"
and the cap has to say it is the base only.

## Starting templates, folded into the path group rather than pointed at

Templates became one of a class's PATH groups by REFERENCE (2026-08-22,
DECISIONS): `system.paths` names the group and points at `system.templates[]`,
which stays exactly where 4.14.0 put it, bundles and RollTable included. That was
the deliberate choice — a world four versions deep in this data should not have
to survive a rewrite to gain a selector, and a migration standing between a
player and their starting kit is the one this family least wants to run.

The cost is two shapes for one idea: every consumer that walks a group has a
branch for "this group's options live somewhere else", and a template row's
`annotation` carries a path option's identity in a string field that knows
nothing about it.

Folding them in properly means moving the eight rows inside the group, and that
is a real migration — `migrateData` on the class model, a Foundry-free rules
half under test at both answers, and a live gate against a world rebuilt from
`git show v4.14.0:` (TOOLCHAIN §4a). Worth doing on its own, announced as its
own decision, and not as a side effect of whatever comes next.

- **Points/ritual/ceremonial gnosis consumers** — the pool schedules and the
  strip already carry non-vancian kinds, and the gnostic classes bind a
  caster-level ladder; their spend/refresh rules arrive with their books'
  recipes (BTA invocation throws, HFH ceremonial).
- **Builder cookbook, the rest of it** — the JJ import now covers the core
  builder tables, four races (dwarf, elf, people1, people2) and the
  Ready-for-Play build of every RR class. Still importer-side work: the
  halfling race (JJ p302); the people races' attribute floors and their
  max-level power (read as a power name, not applied to a cap); the
  custom-power index with costs (JJ p308–331) and drawbacks; magic types
  beyond arcane/divine (ceremonial, gnostic, alchemy, eldritch, fairie —
  each its own `magicTypes` row from its book); and the boosted Arcane +
  racial-value 5–8 rows of the two races that stack with arcane.
- **Builder fidelity still open** — trade-off ELECTIONS are recorded as
  prose in `builder.notes` (the Ready-for-Play paragraphs name them; the
  Judge ticks the boxes by hand); custom-power EFFECTS (a chosen power
  grants its ability doc; what the power does is the abilities subsystem's
  business); attack bands generated from bare progression parameters
  (Monster/Hero) are flagged for verification against a printed table.
- **Sheet editors for casting and templates** — both are stored and preserved
  now; the constructor tabs that edit them arrive with the phases that
  consume them.
- **The instance layer, fully** — a skinned item records which generic it is
  an example of (`flags.skin.base/baseName/descriptor`), and the importer now
  splits counted containers and known-equipment pairs; still unbuilt: the
  embellishment parsed apart from the base ("iron-shod", the spells a
  spellbook carries as linked spell items) and a sheet surface that shows
  "instance of <base>".
- **Retiring the party actor properly** — the authority question is RULED: the
  formation is the party and core's is deprecated
  ([location/DECISIONS.md](../location/DECISIONS.md)). Storage reach and XP
  dealing both honour it. What is left is the migration a deprecation earns —
  offering to build a formation from an existing party actor, so a world does
  not have to retype its roster to stop being a fallback case.
- **Re-opening a rung that was closed by a claim** — "already covered" closes a
  choice award without granting anything, which is an assertion the module
  cannot verify ([DECISIONS.md](DECISIONS.md), 2026-08-15). A Judge who wants
  the question asked again has to clear `flags["acks-extras"].classes
  .awardsTaken` by hand; nothing in the UI lists the rungs a character has
  closed or takes one back. Nor does anything list the ones left OPEN: a
  character with picks waiting reads exactly like one with none until the
  picker is opened on them.
- **A package that knows what the character already carries** — the picker
  offers a starting template and merges it, but `applyTemplate` grants a
  printed rank as N copies by design, so adding one to a character who already
  holds its proficiencies doubles them. The package is opt-in and says it adds,
  which makes the consequence visible rather than absent. Reconciling the two —
  a merge that recognises what is already there without breaking the rank-N
  convention — is unbuilt.
- **A class power the spread equates to several ranks of a proficiency** — a
  fixed award grants one copy, and three BTA awards
  (`def.class.dwarvenExcavator` → `def.prof.engineering`,
  `def.class.dwarvenMachinist` → `def.prof.siegeEngineering`,
  `def.class.dwarvenSporecaster` → `def.prof.alchemy`) stand for more than one
  rank of their proficiency, so a character gets one rank where the page
  prints more. The count is printed as a word in the power's closing
  parenthesis; reading it needs an award locator for a copy count (beside
  `from`, which reads the level) and the award writing that many rungs. Until
  then the award's note says it grants one rank, and the Judge adds the rest.

## Deferred with the 2026-08-29 hit-point and open-pick work

- **The RR's optional 1st-level hit-point rules.** The book offers three (max
  at 1st, no minimums, the 0th-level walk-up). The imported floor is
  unconditional; a campaign wanting one of the options has no switch. If this
  is wanted, it is one setting for the book's own options; the wizard ships no
  house rule (DECISIONS 2026-11-11, "The level-up wizard ships the rules'
  procedure only").
- **Whether a racial value of 0 should still carry its race's rates.** The
  books gate neither the racial XP increment nor the racial hit-point rate on
  points spent, but the derivation gates both (and the cap, traits and
  requirements) on `racialValue > 0`. The new hit-point term copies that gate
  for consistency; the whole question is one item, not five.
- **Race-sheet fields still unreachable.** `stacksWith`, `stackXpDiscount` and
  `postEight` have readers and no editor. They are deferred together with the
  question they share with `hpAfter9`: a re-import rebuilds a materialized
  race's `system` wholesale, so a Judge's typing is replaced rather than
  merged.
- **`templateItem.choice`** — an item a package offers rather than grants. The
  schema carries it; nothing writes or reads one, and no printed RR cell needs
  it yet.
- **Proficiency-cell offers from the books.** The open-pick surface handles an
  ability offer the moment something writes one, but no RR proficiency cell
  prints a pick — the only printed offer in the corpus is the spell clause. By
  This Axe has not been swept for one.
- **Retire the Class modifiers injection with the system sheet.**
  `class-modifiers.mjs` still dresses the SYSTEM sheet's Effects tab at class
  granularity; the module's own sheet edits training on Stats at the weapon.
  When the system sheet stops being a supported surface, the injector and
  `grantedKeys` go with it.
- **The other sync compendium readers meet the index row too.** The registry
  answers *unbound* for an evicted class (DECISIONS 2026-09-16), but
  `template-packages.mjs` reads a bundle's `system.itemList` and
  `class-sheet.mjs` its bundle and template table through `fromUuidSync`
  directly, and `training.mjs` reads an item the same way; on a cold shelf
  each sees a row with no `system` and degrades to an empty list rather than
  a crash. One stub-aware read in lib, awaited where a surface builds from
  the answer, would close them together.

## Deferred with the 2026-10-23 0th-level gate

- **Erosion on the calendar.** A marked proficiency is removed by the Judge;
  nothing watches world time to remove one a month, and the mark's `since` is
  read by nothing yet.
- **An unmark control.** A mark set in error comes off only by deleting the
  item or clearing its flag by API.
- **A cap on a 0th-level gain.** The gate has one threshold, so nothing stops
  a single award from carrying a 0th-level character past 1st's band.

## Readers that take an index entry for a document

`materializeTemplates` loads a row's bundle and the class's table before it
reads them. Two readers still ask `fromUuidSync` and read
`system.itemList` off the answer: `templateContents`, which on a shelf that
is not loaded falls back to the row as printed, and `stripRepresented`,
which then strips nothing. Neither throws; both read a package as absent.

## Printed dice and floors still held in source

Found by the T-0512 lang sweep; each needs a recipe or a ruling, none is
built.

- **The attribute methods.** `stat-page.mjs` `METHODS` holds the standard
  method's counts, formulas and floors and the three variants' formulas, and
  `chargen.remaining` prints the counts. They need an attribute-method recipe
  (RR ch. 1, Attributes; JJ ch. 16).
- **The generated template table's die.** `template-packages.mjs`
  `syncTemplateTable` writes the table's formula as a literal, and
  `class-data.mjs` bounds a template band by the range that die spans. Core's
  roll button carries the die only on the Scores Generator, which is not open
  when the table is built.
- **The level-up floor.** `hitpoints.mjs` `rebuildHitPoints` and `levelup.mjs`
  `levelUpHitPoints` hold a level's maximum at a fixed amount over the previous
  one. No recipe carries it and the sweep did not find it printed for levels
  past the first; the `hpAudit.stepNone` text names the two maxima and no
  amount.
