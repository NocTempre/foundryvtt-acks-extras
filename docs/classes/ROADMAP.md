# Classes — not built

How it behaves now is [MODEL.md](MODEL.md); rulings are
[DECISIONS.md](DECISIONS.md).

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
- **Reaching chargen again after the first write** — the Scores Generator is
  offered only while the system considers a character new (`system.isNew`,
  which core clears on the first update touching scores), so a character built
  by hand cannot be sent back through it. What is missing is a way to reopen
  the page deliberately; the surface itself is complete.
- **Retiring the party actor properly** — the authority question is RULED: the
  formation is the party and core's is deprecated
  ([location/DECISIONS.md](../location/DECISIONS.md)). Storage reach and XP
  dealing both honour it. What is left is the migration a deprecation earns —
  offering to build a formation from an existing party actor, so a world does
  not have to retype its roster to stop being a fallback case.
- **A template when the picker binds a 1st-level class** — chargen offers the
  class's templates; the sheet picker never does, so a character bound at 1st
  from the sheet gets the class's numbers and awards but no starting package.
  The surface is small; the ruling is not. `applyChargen` WIPES the actor's
  items, because generating a character replaces the last run of the page. A
  character bound from the sheet may already own gear, so offering a template
  there has to say first whether it replaces what they hold, merges into it, or
  refuses when the sheet is not empty. Reported from the field 2026-08-14.
- **Where a general proficiency may be picked from** — `choosableGenerals()`
  reads `game.items` alone, so the picker offers only proficiencies already
  materialized into the world; the proficiencies shipped in compendia (core's
  `acks-proficiencies`, this module's `proficiencies-powers`) are invisible
  until something imports them. Note that core's pack cannot be used to tell
  general from class — every document in it carries the schema's `initial:
  "general"`, so the column asserts nothing. That is consistent with the
  family's model — the importer materializes book content, and a ref is a
  cookbook id — but nothing states it where a user meets it, and `coinSource()`
  in chargen.mjs already searches compendia, so the codebase is not of one mind.
  Deciding it means saying whether picking from a compendium materializes the
  item.
