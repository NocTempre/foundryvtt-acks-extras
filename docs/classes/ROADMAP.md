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
- **Unifying the two notions of party** — storage reach asks both a formation's
  marching order and Foundry's party actor, and takes either
  ([location/DECISIONS.md](../location/DECISIONS.md)). Which one is
  authoritative is the owner's call and not yet made.
