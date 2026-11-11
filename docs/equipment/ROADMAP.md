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

- **Loot tables and templates grant variations directly.** A table entry or a
  template names an item *and* the variations it comes with, so a masterwork
  blade needs no pre-combined document. The importer already mints one
  document per published variation (the Variations shelf); the base-type
  fields table is *Variation ruledata has no producer*, below.
- **`acks-extras` migrates the legacy flags onto documents.** The
  `masterwork`/`silvered`/shield-variant flags convert to variation documents
  and the legacy-family refusal that stands in for the migration comes out
  (DECISIONS 2026-08-15, "a variation is a document"). `config.SILVER` and
  `config.MASTERWORK` already hold no figure and read the imported documents
  (MODEL, "The silver and masterwork flags read the imported documents").
  What remains of the legacy tables is `config.SHIELD_VARIANTS`: whether the
  fields the imported shield documents do not carry are read from the book now
  or waived is the owner's call.
- **An inventory of bespoke per-category items to retire onto base type +
  item, and the order to do it in.** `CLOTHING_SLOT_PATTERNS` and
  `GEAR_PROFILES` are the bulk of the name-inference this replaces, but which
  unique-item cases actually retire, and in what order, is still unscoped.
- **A suit worn without a helmet.** The page prices a light helmet into every
  suit and charges a suit worn bare (RR ch. 4, "Helmet, Light"); nothing reads
  that yet. The figures are printed, so they arrive through the importer's
  equipment rule table and are applied by the loadout effect beside the
  helmet's base correction (MODEL, "A helmet never replaces the suit").
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
- **A declared two-handed damage.** A weapon whose die is not its row's has no
  two-handed figure (`twoHandedDamage`), so a Judge-made versatile weapon deals
  the same damage in either grip. A field on the item for its two-handed damage
  would let one be declared.
- **A list of the weapons the lists cannot place.** The weapon import no
  longer names the rows it could not identify, because the rows are published
  from the documents it makes and nothing can be asked of them until it ends.
  A repair check run after the rows publish would list every weapon the
  imported lists leave without a class, so a Judge sees them in one place
  instead of on each sheet.
- **Equipment numbers through the importer.** The strings and comments name the
  field and cite the page. The numbers behind them still ship in code: the
  manoeuvre table, the spell book constants, the unarmed and torch dice, the
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
- **Three macros still carry a form of their own.** *Configure
  Proficiencies*, *Item Loss from Damage* and *Loadout Inspector*
  (`tools/pack-data/equipment.mjs`) build their dialog and their chat card in
  the macro body, so their strings are not in `lang/` and their layout is not
  under the window contract. Each becomes a window of the feature (an app
  under `scripts/equipment/apps/`, a template, lang keys), and the macro its
  launcher, as docs/DECISIONS.md §25 rules for every macro.
