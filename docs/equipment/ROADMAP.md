# Equipment — Roadmap

What is not built. How it behaves now is [MODEL.md](MODEL.md); why is
[DECISIONS.md](DECISIONS.md).

- **`acks-importer` publishes the variations compendium.** One document per
  published variation, plus the `baseTypeFields` table, plus loot-table and
  template support for granting variations directly — a table entry names an
  item *and* the variations it comes with, so a masterwork blade needs no
  pre-combined document. The receiving end already ships; this is the sending
  end.
- **`acks-extras` migrates the three legacy flags onto documents**, once the
  importer side lands: `masterwork`/`silvered`/shield-variant flags convert to
  variation documents, `config.MASTERWORK` / `SILVER` / `SHIELD_VARIANTS` are
  deleted, and the legacy-family refusal that stands in for the migration now
  comes out (DECISIONS 2026-08-15, "a variation is a document").
- **An inventory of bespoke per-category items to retire onto base type +
  item, and the order to do it in.** `CLOTHING_SLOT_PATTERNS`, `GEAR_PROFILES`
  and `WEAPON_ALIASES`/`WEAPONS` are the bulk of the name-inference this
  replaces, but which unique-item cases actually retire, and in what order, is
  still unscoped.
- **The item sheet's mocked groups.** The design's Upkeep, Study, Reading The
  Chart and Ability Rolls Boosted roll groups, the spell book's legibility
  rows and the named-item note prose have no data source in this module; the
  sheet lists only what a feature holds. Each arrives with the model that owns
  it.
- **Spell book contents as documents.** A spell book's formulae are a data
  list (`spellbook.mjs`), so its Contents tab edits text rather than taking
  spell-page drops. Moving them onto the `containedIn` relation would give the
  book the same drop zone a chest has.
- **The item sheet's drop targets, pointer-driven.** Live-verified through the
  API each target calls; a real drag onto Contents, the disguise panel, the
  keys row and a Scene onto the band still wants a session with a compositing
  pane.
