# Equipment — Roadmap

What is not built. How it behaves now is [MODEL.md](MODEL.md); why is
[DECISIONS.md](DECISIONS.md).

- **The abilities→attack effects bridge.** The mounted overlay's save
  prompts and economy card shipped WITHOUT pushing the proficiencies' attack
  bonuses or the subjacent height-advantage modifier into the roll's term
  stack, because those numbers arrive with the imported abilities and no
  machinery yet carries an imported effect into `PRE_ATTACK_HOOK`. Building
  that bridge (imported modifier effects, condition-gated by machine-readable
  scopes like "while mounted", contributing labelled terms) upgrades the
  mounted overlay — `heightAdvantage` is already published and waiting — and
  every other conditional combat proficiency with it.

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
- **A weight stated for a bundle.** `weight6` means the weight of one unit and
  quantity multiplies it, but the books price a whole class of goods per
  bundle — a quiver, a set of spikes. A Judge who reads such a row and types
  the printed weight beside the printed count gets an item twenty times too
  heavy, and nothing in the model can say the two numbers have different
  denominators. Wants a `per` field on `GearExtras` defaulting to 1 (so no
  migration), `weight6Of` counting `ceil(qty / per)` because a part-used bundle
  is still one item, and a matching correction in `encumbranceDelta6` — core
  owns the multiplication, so fixing only this module's reader would make the
  item sheet and the character sheet disagree. **`per` itself is content**: it
  comes from the importer, the item's name or the Judge, never from a shipped
  table of bundle sizes.
- **Weight entered in sixths.** The band's badge is the only decimal-stone
  surface in the family — core's item sheet and this module's variation item
  both take sixths directly — and the conversion only exists to serve it.
  Binding `system.weight6` and keeping the stone reading as a label beside it
  removes the lossy round trip rather than guarding it (DECISIONS 2026-08-31).
  Changes what a Judge types, so it is user-facing.
- **One clothing declaration.** The rail's base-type picker writes a
  `baseType` flag and `isClothing` reads core's `system.subtype`, so declaring
  clothing through the picker gives the icon and the wear slot but leaves the
  garment weighing against encumbrance. Wants a forward write in `setBaseType`
  and the same write in `annotateItem` so re-running Annotate repairs existing
  worlds. Making `isClothing` read the flag instead is rejected: it silently
  reinterprets stored data with nothing to roll back.
