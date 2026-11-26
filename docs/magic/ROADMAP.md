# Magic — Roadmap

Re-issued 2026-11-14.

What is designed and not built. The spell primitive, the vocabulary, the
importer's spells and the first casting parts are built; MODEL carries them.
Each part below carries the design of what remains.

Each part below ships the Judge tools for what it adds. The order is the
owner's ruling of 2026-09-25 (DECISIONS, "The order, and the scoping's eleven
questions, ruled"): 2 and 4a before 1b.

- **2 — Casting and tracking.** The cast of a spell, its card, targets and
  saves, records, concentration, declarations, summons and recurring prompts are
  built for the level 1 spells (MODEL, "Casting a spell" and the sections after
  it). Not built: area templates, line of sight, and what a creature that enters
  an area later gains (nothing today); an expiry card for a non-summoning
  spell's record; combat rounds that age a cast record by the clock (combat does
  not move it); preparing and unpreparing a repertoire, signature spells and a
  prayerful caster's first-level repertoire; the spellbook migration to
  references ([equipment ROADMAP](../equipment/ROADMAP.md), "Spell book
  contents as documents"); the Magic tab's corruption and stigma meters,
  concentration indicator, signature text and effects grouped by cast; a
  spell-effect section on the Active Effect sheet; Judge macros (drawing an NPC's
  repertoire, sweeping expired records, dismissing summons) and settings; and the
  formation's own spell countdown as a view of the cast records where world time
  advances, since two clocks would then age one spell. A points or gnosis caster
  keeps the pool strip until its engine lands.
- **Levels 2 to 6.** One phase each, planned from that level's own matrix:
  standing modifiers through `standingModifiers` with spell records as sources,
  damage per level with `max`, dispel and counterspell throws, detection
  results, beholding and earshot warnings, the perpetual cap, triggered starts,
  and transform and teleport executors. Rituals come with research (part 5).
- **4a — Magic items.** Built: the generation tables and their roll
  ([magic-items MODEL](../magic-items/MODEL.md)), and magic items imported as
  documents (importer DECISIONS 2026-11-17, "A magic item is
  `kind.magicItem`; …"), which write no item flag; where both books print an
  item, the Treasure Tome wins. Not built: the
  `flags["acks-extras"].magicItem` DataModel on core `item`, `weapon` and
  `armor` (the item's kind, absorbing markets' `MAGIC_KINDS`; powers, each a
  spell pointer, effect rows, a bonus, a proficiency, a class power or a
  special, with its activation and charges; the cursed state, drawbacks,
  restrictions, lifespan, set, traits, formula, base cost, and the scroll and
  potion fields; value, rarity, identification state and aura stay in the
  markets flag); a fieldset on core's item sheets and a tab on the extras
  item sheet with the shared effect-row editor; the use flow, which casts a
  power with the item as its source, spends a charge or consumes a one-use
  item, and puts a cursed reveal and a user restriction to the Judge; JJ
  traits; the markets bridge (identification, value, availability and
  commissioning); and definition nodes for the `magicProperty` tokens, which
  closes a spoil's `researchEffects`. The magic-items feature's own gaps are in
  [its ROADMAP](../magic-items/ROADMAP.md).
- **1b — Foundation: the math.** A pure cost engine (`magic/spell-cost.mjs`)
  that does the procedure only: sum the chosen effect rows' costs with their
  count and pick multipliers, multiply by the target, range, duration,
  saving-throw and source factors, round by the printed rule, read the level
  off an imported band table and apply breakthrough allowances. Every figure
  arrives in an imported `acks.spellBuilder` document: for each spell type,
  tables of effects, range, duration, targeting, saving throw and source
  (JJ ch. 14's design axes), whose rows carry a key, a label and a cost or
  factor from the page, beside a register-authored kind and parameters that
  expand a picked row into an executable effect row. JJ ch. 14 is the primary
  producer; AXIOMS 18 is a second recipe for the same document id, for a Judge
  who holds only it and as a cross-check while authoring; HFH ch. 8 fills the
  eldritch source column; a magic type's source factors multiply in the same
  way. The printed worked builds import as build records on their spells, a
  Build tab prices a custom spell, and extemporaneous spellsinging (3d) reuses
  the engine at the table.
- **3a — Magic types.** The `acks-extras.magicType` Item sub-type and its
  sheet, in the class sheet's shape, with JJ ch. 15's ten steps as a builder
  tab. Its fields: key and label, source factors per spell type, base XP,
  progression (family, tier, delayed), the value ladder the class builder
  prices from, repertoire and casting kinds, saves-as and progenitor, the code
  of behaviour, the category value, the research menu, the save progression,
  the spell list and the knobs the ACKS I systems need (shade, resources,
  ceremony). Documents publish to `acks.magicTypes`, and
  `classes/builder.mjs` `builderTables()` merges them over the imported rows
  by key, a document winning (DECISIONS 2026-11-26, "The scoping doc
  closes"). `kind.magicType` makes the printed types: JJ ch. 15 with the
  ch. 12 grids, and BTA, HFH and Annals of the North for the others. Also:
  inherited repertoires, and the `VALUE_SCALES` `arcaneValue` and
  `divineValue` wiring.
- **3b — Eldritch.** Shades move from the open family to code when the
  corruption engine branches on them; a corruption ledger on the caster
  (points and weaknesses); the Annals of the North ceremonies; the HFH shaded
  eldritch list, its ACKS I names converting through
  `register/_refs/conversion.json` (an unknown name stays plain text). The
  casting engines for slots, points, stigma and corruption are pure modules
  (`magic/engines/`) with a thin document layer, beside one shared ceremony
  procedure.
- **3c — Gnosis and ceremonial.** The shared ceremony procedure (performance
  ladder, mishap tiers, stigma, purification); BTA invocations and
  implements; HFH codices, trinkets and talismans — items on the flag 4a
  ships. Built: the level cap, the ceremony record and the invocation throw
  as pure functions, read by no surface yet. Deferred (owner, 2026-11-19);
  the rulings these build to are [DECISIONS.md](DECISIONS.md), "Gnosis and
  ceremony". What remains:
  - the gnosis prose figures (`gnosisProse`: the corruption multipliers, the
    purification times, the stigma marks of a failure and the damage marks of
    a botch), read by the importer under `scripts/importer/books/bta/`;
  - the corruption kind on the spell (`SpellExtras.corruption`) and the
    invocation register rows that author it;
  - the invocation throw wired into the procedure seam (a `gnosis` procedure,
    with its lang and recipe), and after it the invocations' effect rows, which
    no cast executes until the throw exists (their per-level row matrix is on
    the rules shelf, LOCAL-ONLY; one invocation summons, and a `summon` row
    would hand its cast to `castSummon`, which has no By This Axe creatures);
  - the surfaces, which await `/design` approval: a pace choice and a
    situational modifier in the cast window (D1); the throw section on the card,
    with the damage mark, the mishap, stigma against its threshold, corruption
    with a wound line and a press that opens the Mortal Wounds window, and the
    Judge's Undo (D2); the casting strip's stigma chip with a Judge-only step,
    and Purify (D3) with its confirm (D4); the corruption chip (D5); the
    implement level and its Judge-only damage reset on the item sheet (D6); the
    corruption kind on the spell Overview (D7); and the warnings and blocks of
    ruling 7 (D8). The canvas is
    https://claude.ai/artifact/DyscmRWo2r7x3fpzbSRMZT, version
    1794984538-829c, which draws no placeholder art and awaits the owner's
    approval;
  - an HFH ceremony table set, once a reader exists; a record held for a
    regular or methodical invocation's performing time; purification as a turn
    activity. Extemporaneous invocations and the printed builds need 1b;
    trinkets, talismans and scrolls need 4a; a sigil's grant of its invocation
    waits for part 2's repertoire work;
  - not yet walked: casting an invocation from a character (importer TESTING,
    "By This Axe invocations and the gnostic classes' lists", step 3), and
    importing the gnostic tables with the book closed (importer TESTING, "The
    gnostic tables, read from By This Axe", step 4).
- **3d — Spellsinging.** The points engine (a cost by spell level from the
  type's ladder, and recovery), tapping, and extemporaneous builds through the
  cost engine (needs 1b).
- **4b — Magic items: Treasure Tome.** The Tome's tables and entries import
  (importer DECISIONS 2026-11-17, "The Treasure Tome wins whole: …"). Not
  built: its Mechanics block (activation time, frequency, cancellation) read
  onto the item flag's activation; the walk of its Gritty tables; the advanced
  item rules (cursed, formula length, drawbacks, proficiency and power
  granting, perpetual, periodic, random lifespan, rechargeable, set,
  triggered, user restrictions); and the appendices (item generation, traits,
  corruption, weapon development, potion miscibility, monsters).
- **5 — Research.** Projects at a location, research days, Finish, rituals and
  blood sacrifice are built (MODEL, "Research projects", "Blood sacrifice").
  What remains: a visible link on the researcher's sheet; every RR ch. 8 project
  kind beyond the four built; experimentation; components and compounds;
  rituals learned (casting one is built); XP; material paid is recorded and
  charges no coin; the spellcasting-services bridge. A sacrificed character's value reads the XP
  award for its level from a table that is not imported, so the Judge's value
  box is the only way such a victim yields (DECISIONS, ruling 226).
  Congregation-scale divine power waits for the domains feature's realm
  model. The RR ch. 8 design also holds arcanogenesis (AX1's design and genesis
  vat) and AX7's compounds, a substitution layer over components, and
  magic-item research; a Judge's ledger over every project in the world; an
  NPC repertoire helper (a random draw by level, no figures); and a project's
  facilities, which are its location's (DECISIONS 2026-09-25, answer 4).
- **6 — Optional rules.** Overcasting (JJ ch. 16, a setting off by default),
  places of power (JJ ch. 2, a location flag the throw modifiers read), spell
  damage against structures (RR ch. 12, through the vehicles feature's
  `spellAreaFactor`), magic in construction, and mortal-wounds inputs from
  tracked effects.
- **Recipes, books and walks the parts above need.** Table documents
  `acks.magicTypeBuilder`, `acks.eldritch`, `acks.spellsinging`,
  `acks.overcasting` and `acks.placesOfPower` (the magic-item tables are
  `magicItemTables`; `magicItems` stays markets'). Books: HFH, the Almanac of
  Unusual Magic, the two Annals of the North posts and AXIOMS, under ids that
  cannot collide with the adventure ids (such as `axc1`, `axi17`,
  `axse2020`), each added only once a recipe reads it. A repair keep-policy
  for magic types. Each part is walked on content imported from the seat's own
  PDF (a caster for each engine, an item for each activation kind, a project
  for each research kind), never on a fixture built by the API.
- **A held cast whose caster's whole actor is deleted.** Foundry fires no
  `deleteActiveEffect` for the embedded records of a deleted actor (confirmed
  live), so concentration's end (MODEL, "Concentration's end") never runs and
  that cast's recipient records stay standing untimed. A Judge ends them by
  hand, from each recipient's effects. A sweep that finds recipient records
  whose caster no longer exists would close it.
- **One card per cast.** A cast posts two cards: the system's spell card, from
  the `spend()` that runs core's `_useSpell` (docs/lib/API.md, the cast seam), and
  the cast card. Both show on every cast, so a Judge sees the spell twice;
  folding the module's card into the system's, or suppressing one, is not built.
- **Research tables outside rulings 219 and 227.** The cost of researching a
  spell per level, the item-creation cost table by effect type, and the ritual
  repertoire table are not imported. M-i read only the rows those two rulings
  name, and nothing reads these three yet.
- **Research throw bonuses the page prints as figures.** A sample studied
  while the item is made, and a research proficiency's rank (RR ch. 8,
  "Creating Magic Items" and "Proficiencies and Powers"), each add to the
  research throw by a printed size. Neither is imported or read; when built,
  the size is a register row and the throw names it as a part.
- **A range ring while summons are placed.** Board 21 of the cast canvas (approved by the owner, "Build it now", then moved out of the 2026-11-19 minor: "no new surfaces") draws a dashed ring of the spell's range around the caster's token while the seat clicks the summons' points, with a counting banner. The range check itself is built (lib `pickPlacement`); the ring is not. The rulings are [DECISIONS.md](DECISIONS.md), "Summons join the spell cast".
- **A caster stashed in a party that is in a fight summons by click.** A summoning joins its caster's party only while the party is in no fight (MODEL, "Casting a summoning spell"). A caster still stashed in a party that is in a fight has its cast placed by click, and a spell that states a range is refused to a Player for want of a caster token to measure from.
- **The Magic tab's summon row counts the scene in view.** Creatures held in a party read 0 from a scene the party's token does not stand on, on the standing figure and on the joined one.
- **Creatures of one cast made into a party share one appended number**, where the creature's prototype token appends one to its name.
- **What changes the end of a conjuration's control.** Three printed abilities change it (RR ch. 3, p. 115; JJ ch. 12, pp. 312 and 328). Two give a save that keeps the concentration against damage while a conjured creature is controlled, with a printed bonus when both are held; the third makes a conjured creature leave instead of turning hostile when concentration breaks. Building them takes an ability-domain `summonControl` effect kind with importer rows on the three entries, a keeper lib's `loseStates` consults before it lifts, the cause carried to `castControlOutcome`, and a tooltip naming the ability and its page. Until then a Judge who applies one changes the spell row's "When control ends" before the end, or the creature's token after it.
- **A warlock's dark-path rewards are granted at their levels.** The dark-path choice grants one description-only power and each later rung the generic one; the rewards the path names are never granted, so a character holds them only by a Judge's drop from the library.
- **A conjured creature out of range loses its control.** The page ends control when a conjured creature is out of range, and nothing measures that while the cast is held; a Judge ends the concentration by hand.
- **A light cast onto an item.** A cast light sits on a creature: the caster, or the target a recipient row names. The cast window has no item pick, so a light spell cast on a weapon, a shield or a stone becomes a light on whoever the row names, never on the thing. An item pick in the cast window is a board of its own (the 2026-11-25 bug-batch board 2, decision 2).
- **A light ended by dispel.** A dispel row only records today, so a dispelled light keeps shining until its owner deletes the record or its duration runs out.
- **A light spell held by concentration.** A cast held by concentration writes the held record (`heldRecordData`) and no light: its light rows change nothing until the held record carries them.
- **A dice formula the cast rolls for a summon's number.** A summon row's number is a whole figure (`amount`), and the cast window's count is one too. Two of the calling spells print their number as dice (RR ch. 5, the spell descriptions); neither carries a summon row today. Rolling it needs a formula on the row, a reader in the importer and a roll at the cast, with the figure's tooltip naming the dice and the page.
- **A reversed purify spell.** The purify entry's reverse, which spoils what its forward form cleans, has no rows: no apply kind models it.
- **The seal stage failed once in three walks.** In one `magic-cast-tracked` run on 2026-11-19, the door that stage I makes locked read as closed straight after its create. The later clicks then met the wrong doors, and nine checks failed. The next run passed with the same code. The cause is not known.
- **What the level 1 spells leave to the Judge or to another feature.** Each is a card line, a default or a blank today:
  a points tradition's cost is shown and never spent (DECISIONS, ruling 98); the heal at each rest of the Death-save spell, and
  its save part, which needs a status gate kind in the register lint; the casting time one invocation level prints (ruling 207);
  a magic weapon's bonus on the save a weapon-destroying spell asks (ruling 124); an XP-valued character victim (above, part 5);
  the leaping spell's distances (formation's); tracking and evasion for the spell that hides trails (ruling 137); an automatic
  climb or trap disarm in the crossing and trap paths, which ignore records; a spell-granted Climbing as a candidate for a
  party's best skill; a reaction bonus for a proficiency a record grants (`ifHas` reads ability items only, and the
  bonus of the spell that grants Mystic Aura reaches only a bearer who holds the item); the target's side of an opposed
  reaction roll, which reads no records; a per-row target filter, since the spell's filters cover both forms and so one
  reversed form's living-only gate is not applied.
- **A scroll, or a monster's spell-like ability, is not a source of castable spells.** Only magic's repertoire registers one
  (`registerSpellSource`), so a carried scroll shows no pale throw. The scroll waits for the spell pointer of the magic items
  (part 4a).
- **A grant with no level pair of its own is read at the bearer's level.** The spell that hides trails therefore reads its
  throw at the bearer's level, against ruling 137, which reads it at a level the cast supplies (`cast-mods.mjs` `partOf` sets
  a part's `atLevel` only where the row carries the pair). Giving such a grant the caster's level is not built.
- **The pale caster level leaves out the caster's ability deltas.** `repertoire.mjs` takes `casterLevel` alone, while a cast
  adds the deltas (`castAbilityLevel`), so a pale throw can read at a lower level than the cast would use.
- **The creature-kind pick offers no dragon kind,** since no module kind key exists.
- **Caster abilities the cast does not read** (ruling 111): a caster level that counts only for dispelling or against magic
  resistance; `spellLike` as a source of casts; a summoned creature's hit points; a damage type tied to a selection; a swap of
  attack progression; a concentration save; and buffs from places and items. A missing register entry for one lore proficiency
  leaves its power's combined row and that row's progression unauthored.
- **A card that stores an inventory answer.** A declared cast drops an item that leaves its holder; no chat card stores a bucket
  answer yet, so nothing drops one from a card. A value set by hand in a bucket is not in the stored answer, so re-reading a
  stored answer loses it.
- **A relayed Throw, and Apply to the presser's targets.** An owner of the caster who did not cast is offered Apply and not
  Throw: a thrown row on a card the Judge cast for a Player's character waits for the Judge (DECISIONS 2026-11-26, "A cast
  card's Apply is an owner of the caster's, not the card's author's").
- **Tooltips that stop short of their source.** An unaffected target row's reason is in its tooltip only; the invocation cap's
  tooltip names the ladder and the class level, and the ladder carries no page reference; the workshop research project's level
  tooltip cites the library's page for every kind; a chip under a table set by hand shows an empty citation; the save and damage
  parts of caster abilities sit in the cast card's level note tooltip, which a cast with no level drops (needs `/design`).
- **Open for the owner on the level 1 spells.** Whether lawful undead count with the lawful incarnations that holy circle's
  reverse names (as shipped, they do not); and three questions proceeded on at their defaults (DECISIONS, "Owner questions at
  their defaults, on abilities, saves and the sheet"): whether Humanoid should count giants, whether Living should leave out
  constructs, incarnations and enchanted creatures, and whether a Judge's line keeps the page's clause or becomes a
  structural line.
- **Cast behaviour no walk has driven** (named unwalked when its slice landed, and not read as walked since): the spell
  Overview's submit on a spell whose row has an `anyOf` branch; the cast, a held end and a declaration with no GM connected at
  all (the recipe's no-GM steps only make a Player seat read no active GM while the Judge's seat stays up); a two-handed or several-weapon
  carrier; Dice So Nice with rigged dice; the masterwork tie where a spell's figure is one below masterwork's; a Player's
  recurring Save on a bearer it owns; two lanes at once, the seal relay among them; the effect-row editor's Lasts, Effects and
  "When control ends" fields; the battlemap's modes and country parts after the pointer catcher moved to lib. Also unchecked:
  whether the monster book's overview prints a general susceptibility multiple that ruling 67 does not read, and whether the
  Eldritch Magic supplements or AXIOMS add component rules that rulings 209 onward leave out.
- **A spell on two lists reads its first list in two places.** A cast pressed under a list's heading spends that list's slot, but the tradition's procedure (`cast-procedure.mjs`) and a declaration's lost-procedure check (`cast-declare.mjs` `procedureLost`) still resolve the first of the class's lists the spell stands on. A class whose two lists are of different kinds would find the first list's procedure for a cast pressed under the second.
- **The system's own sheet has no row gate.** The Magic tab's rows show the cast's verdict before the press; on the system's sheet a Player learns of a refused cast from the notification (`cast-gate.mjs`) or the cast window's foot.
- **The cast window reads the system's one slot grid where no list's slot row answers.** A spell with effect rows that names no list, or whose list has no slot row at the character's level, is judged in the cast window by the system's count at its level (`castCapacity`'s `core` source), which on a class with two lists is the first list's maxima against every list's casts. The Magic tab's row and the gate claimant no longer read it (`listGate`).
- **A card the Judge cast for a Player's character offers that Player no Revert.** Revert is offered to a seat that owns the caster and can edit the card (MODEL, "A tradition's procedure"), and a Player cannot edit a card the GM authored. Offering it would take a relay that runs the procedure's `revert` under a seat's ownership of the caster alone, or a card the Player may write; neither is built, and a procedure's revert writes under the seat's own permissions today.
- **Three Research presses the owner has not ruled on.** Actors sidebar → a place's sheet → Research tab →
  Post days…, a Player's post on a day other than today, and the Common check stay the Judge's as built
  (DECISIONS 2026-11-25, "The spell's audit mark, the Research tab's figures and a ritual's charge item follow
  ownership"). The work that takes them up asks the owner first.
