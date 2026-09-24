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
- **Equipment numbers through the importer.** The strings and comments name the
  field and cite the page. The numbers behind them still ship in code:
  `STYLE_SPEC_BONUS`, `DUAL_WIELD_ATTACK_BONUS`, the manoeuvre table,
  `HELM_MODIFIERS`, the spell book constants, the unarmed and torch dice, the
  non-proficient penalties, the bowquiver counts and the scavenged fallback.
  Each arrives as an imported `equipment` table or from the item's own text, and
  a feature whose table is absent refuses by naming it. `test-equipment` asserts
  those shipped numbers today; it passes invented values in once the code takes
  them.
- **The clothing repair's encumbrance preview.** The repair tool's
  `equipment.railClothing` check settles an item whose two halves disagree
  (docs/lib/MODEL.md, "The repair tool"). It does not yet show each carrier's
  encumbrance change before the fix.

- **The `SLAYER` effect domain is declared but not read.** `EFFECT_DOMAINS.SLAYER`
  (`scripts/equipment/constants.mjs`) is a seam for a future situational
  roll-time consumer (e.g. Goblin-/Vermin-Slaying); nothing in
  `scripts/equipment` currently reads it. Note: `docs/equipment/MODEL.md`'s
  effect-contract table lists `slayer` as already consumed — that line is
  stale and should be corrected when this lands or is dropped.
- **The `NO_SHIELD_BENEFIT` effect domain is declared but not read.**
  Same shape as `SLAYER` (`scripts/equipment/constants.mjs`): a seam for a
  future consumer, currently write-only.
- **Primary-GM socketlib routing for loadout writes.** `primaryResponder`
  (`scripts/equipment/enforce.mjs`) picks the active GM, else the actor's
  owner, as the one client that performs loadout writes. A later phase
  replaces this with explicit socketlib routing to the primary GM so a
  non-GM owner never has to be the writer.
- **Variation ruledata has no producer.** `variation-defs.mjs` reads base-type
  fields from a `variations` document that no recipe writes, so a world records
  nothing extra, as that file's header says, and no import changes it until a
  recipe reads the fields off a page. `tools/validate-producers.mjs` waives the
  document against this entry.
