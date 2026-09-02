# Classes — not built

How it behaves now is [MODEL.md](MODEL.md); rulings are
[DECISIONS.md](DECISIONS.md).

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
  builder tables, the dwarf and elf races, and the twelve RR Ready-for-Play
  builds. Still importer-side work: the halfling / Nobiran / Zaharan races
  (JJ p304–307), the JJ campaign classes' builds (barbarian, paladin,
  priestess, shaman, venturer, warlock, witch, wonderworker, ruinguard),
  the custom-power index with costs (JJ p308–331) and drawbacks, magic
  types beyond arcane/divine (ceremonial, gnostic, alchemy, eldritch,
  fairie — each its own `magicTypes` row from its book), and the boosted
  Arcane + Elf/Zaharan 5–8 rows.
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
  closed or takes one back.
- **A package that knows what the character already carries** — the picker
  offers a starting template and merges it, but `applyTemplate` grants a
  printed rank as N copies by design, so adding one to a character who already
  holds its proficiencies doubles them. The package is opt-in and says it adds,
  which makes the consequence visible rather than absent. Reconciling the two —
  a merge that recognises what is already there without breaking the rank-N
  convention — is unbuilt.
- **Where a general proficiency may be picked from** — `choosableGenerals()`
  reads `game.items` alone, so the picker offers only proficiencies already
  materialized into the world; system compendia are invisible until something
  imports them. Proficiencies from the importer materialize into the world and
  become available. Note that core's pack cannot be used to tell general from
  class — every document in it carries the schema's `initial: "general"`, so
  the column asserts nothing. That is consistent with the family's model — the
  importer materializes book content, and a ref is a cookbook id — but nothing
  states it where a user meets it, and `coinSource()` in chargen.mjs already
  searches compendia, so the codebase is not of one mind. Deciding it means
  saying whether picking from a compendium materializes the item.

## Deferred with the 2026-08-29 hit-point and open-pick work

- **The RR's optional 1st-level hit-point rules.** The book offers three (max
  at 1st, no minimums, the 0th-level walk-up). The imported floor is
  unconditional; a campaign wanting one of the options has no switch. If this
  is wanted, extend the existing level-up HP mode setting rather than adding a
  second one — one family of campaign HP options, not two.
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
