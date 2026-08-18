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
