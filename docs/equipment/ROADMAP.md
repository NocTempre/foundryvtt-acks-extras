# Equipment — Roadmap

Re-issued 2026-11-14.

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

- **The Proficiency penalties "Automatic" choice is inert.** It enforces only
  while `acksExtras.abilities` is absent, and the abilities feature assigns
  that unconditionally at init, so Automatic always acts as Never enforce.
  Removing the choice or giving it a real condition is the owner's decision.
  The real condition is the abilities feature expressing a class's base
  proficiency lists, which it cannot yet do (`proficiency.mjs`
  `enforcementActive`).

- **Loot tables and templates grant variations directly.** A table entry or a
  template names an item *and* the variations it comes with, so a masterwork
  blade needs no pre-combined document. The importer already mints one
  document per published variation (the Variations shelf); the base-type
  fields table is *Variation ruledata has no producer*, below.
- **Flag-held families, and the shield variants table.** The masterwork,
  silvered, scavenged and shield-variant flags still hold a family a variation
  document also names, and `applyRefusal` (`variation-items.mjs`) refuses the
  variation while a flag holds it. Converting the flags to variation documents
  removes that refusal (DECISIONS 2026-08-15, "a variation is a document").
  `config.SILVER` and `config.MASTERWORK` hold no figure and read the imported
  documents (MODEL, "The silver and masterwork flags read the imported
  documents"); `config.SHIELD_VARIANTS` still holds a table, and whether the
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
- **A list of the weapons the lists cannot place.** The weapon import does not
  name the rows it could not identify, because the rows are published
  from the documents it makes and nothing can be asked of them until it ends.
  A repair check run after the rows publish would list every weapon the
  imported lists leave without a class, so a Judge sees them in one place
  instead of on each sheet.
- **The scavenged damage floor.** The passage that prints the scavenged grids
  (RR p. 160) also prints a floor on a weapon's damage. No recipe reads it and
  no code applies it: a stacked damage penalty is written as rolled. It wants a
  value in the `scavengedCaps` recipe and a clamp in `toItemUpdates`.
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
- **Two macros still carry a form of their own.** *Configure
  Proficiencies* and *Loadout Inspector* (`tools/pack-data/equipment.mjs`)
  build their dialog and their chat card in the macro body, so their strings
  are not in `lang/` and their layout is not under the window contract. Each
  becomes a window of the feature (an app under `scripts/equipment/apps/`, a
  template, lang keys), and the macro its launcher, as docs/DECISIONS.md §25
  rules for every macro.
- **An armour limit is stamped by cookbook id only.** A Judge's ability with
  no cookbook id is never given the imported limit row (it carries its own
  through the row editor), and a change to which skills the page names reaches
  the abilities only at the next class-builder tables import or Update
  Abilities; the rung and the shield rule follow an override live.
- **The named-item bonus categories are still a set in source.**
  `overlays/named.mjs` `NAMED_CATEGORIES` lists the categories a named item's
  points go to (JJ p. 399). Its labels now name fields and carry no size. The
  set itself ships on the building session's call that it is procedure
  ([DECISIONS.md](DECISIONS.md), "2026-11-14 — A named item's bonus categories
  are procedure, and their labels name fields"); the owner has not ruled. If
  it is a table of options, it wants an importer recipe and a registered
  table, with `toItemUpdates` reading which field each category writes.
- **A core `system.encumbrance.mod` would let a wrapper go.**
  `roll-wrap.mjs` `onComputeEncumbrance` corrects the stored encumbrance after
  core computes it, because core has no adjustment field. If the system gains
  one, the wrapper is deleted in favour of it.
- **An extensible inventory bucket list would let the wear regrouping go.**
  `sheet.mjs` moves core's inventory rows into wear-location buckets. If the
  system gains a list the module can extend, the regrouping is deleted in
  favour of it.
- **Blank figures that have no page reference yet.** Fields left blank when
  nothing is imported carry a page-reference tooltip only where one was
  written. These carry none, and each needs its page looked up:
  `ACKS-EQUIPMENT` `printed.capacityNotImportedTip`, `printed.notImportedTip`,
  `itemLoss.notImportedTip`, `props.figureMissing` and
  `maneuver.notImportedTip`.
