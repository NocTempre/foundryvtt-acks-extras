# Classes — not built

How it behaves now is [MODEL.md](MODEL.md); rulings are
[DECISIONS.md](DECISIONS.md).

- **Points/ritual/ceremonial gnosis consumers** — the pool schedules and the
  strip already carry non-vancian kinds, and the gnostic classes bind a
  caster-level ladder; their spend/refresh rules arrive with their books'
  recipes (BTA invocation throws, HFH ceremonial).
- **Sheet editors for casting and templates** — both are stored and preserved
  now; the constructor tabs that edit them arrive with the phases that
  consume them.
- **Roll-editor progression picker** — name a published table instead of
  typing rungs (the abilities ROADMAP seam's UI half).
- **The instance layer, fully** — a skinned item records which generic it is
  an example of (`flags.skin.base/baseName/descriptor`), and the importer now
  splits counted containers and known-equipment pairs; still unbuilt: the
  embellishment parsed apart from the base ("iron-shod", the spells a
  spellbook carries as linked spell items) and a sheet surface that shows
  "instance of <base>".
- **Prose editors** — description/code fields are textareas; ProseMirror
  polish later.
- **Reaching chargen again after the first write** — the Scores Generator is
  offered only while the system considers a character new (`system.isNew`,
  which core clears on the first update touching scores), so a character built
  by hand cannot be sent back through it. What is missing is a way to reopen
  the page deliberately; the surface itself is complete.
- **Unifying the two notions of party** — storage reach asks both a formation's
  marching order and Foundry's party actor, and takes either
  ([location/DECISIONS.md](../location/DECISIONS.md)). Which one is
  authoritative is the owner's call and not yet made.
