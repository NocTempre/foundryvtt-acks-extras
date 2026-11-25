# Magic — Roadmap

Re-issued 2026-11-14.

What is designed and not built. The full decomposition — data model,
importer recipes, engines, UI, verification, open questions — is
[wip/20260924-scoping.md](wip/20260924-scoping.md) until each part moves
its substance into MODEL and DECISIONS. The spell primitive, the vocabulary,
the importer's spells and the first casting parts are built; MODEL carries
them.

Each part below ships the Judge tools for what it adds. The order is the
owner's ruling of 2026-09-25 (DECISIONS, "The order, and the scoping's eleven
questions, ruled"): 2 and 4a before 1b.

- **2 — Casting and tracking.** A claimant on lib's cast seam, the one wrap
  of core's `use()` → `_useSpell()` (falling through for spell items without
  the flag, which core's packs use as monster attacks),
  the cast dialog, targets and templates, per-target saves inside the card,
  spell effects as flag-marked Active Effects aged by Foundry's own expiry
  with the rounds-to-seconds rewrite when a combat ends (the flag weighed
  against a sub-type first), damage and healing cards, summons placed by
  click (a summoning spell's cast is built; MODEL, "Casting a summoning
  spell", and its expiry card, "A cast's end"), the same expiry card for a
  non-summoning spell's record, combat rounds that age a cast record (combat
  does not move the clock), disruption
  prompts, repertoires (a prayerful caster's first-level repertoire among
  them) and the spellbook migration to references, the Magic tab redesign,
  settings and macros. A printed spell executes the effect rows the
  register authors for it; a points or gnosis caster keeps the pool
  strip until its engine lands. The cast of a spell that is not a
  summoning spell is planned level by level in
  [wip/20261115-spell-effects-plan.md](wip/20261115-spell-effects-plan.md).
- **4a — Magic items: JJ.** The `magicItem` flag, its fieldset and tab, the
  use flow; `kind.magicItem` for JJ ch. 4; the classic and heroic generation
  tables; traits; the markets bridge.
- **1b — Foundation: the math.** The `acks.spellBuilder` document from JJ
  ch. 14 (AXIOMS 18 and HFH ch. 8 as alternate producers); the pure cost
  engine; the Build tab; the printed worked builds as build records.
- **3a — Magic types.** The `acks-extras.magicType` document, its sheet and
  builder from JJ ch. 15; publication to `acks.magicTypes`, merged over the
  class builder's imported rows by key; inherited repertoires; the
  `VALUE_SCALES` wiring.
- **3b — Eldritch.** Shades promoted to code, the corruption ledger, the
  Annals of the North ceremonies, the HFH shaded list.
- **3c — Gnosis and ceremonial.** The shared ceremony procedure (performance
  ladder, mishap tiers, stigma, purification); BTA invocations and
  implements; HFH codices, trinkets and talismans — items on the flag 4a
  ships. Built: the level cap, the ceremony record and the invocation throw
  as pure functions, read by no surface yet. Deferred past the next minor
  (owner, 2026-11-19): the prose figures, the corruption kind, the Magic-tab
  and item-sheet surfaces, the ceremony procedure and the invocations' effect
  rows; the plan and its /design canvas are
  [wip/20261116-bta-magic-groundwork-plan.md](wip/20261116-bta-magic-groundwork-plan.md).
- **3d — Spellsinging.** The points engine, tapping, extemporaneous builds
  through the cost engine (needs 1b).
- **4b — Magic items: Treasure Tome.** The `tt` reader; the Mechanics block;
  gritty tables; the advanced item rules and the appendices.
- **5 — Research.** The project record on the location and its Research
  tab are built (MODEL, ruling 220); what remains: posting and crediting
  research days, the outcome writers, a visible link on the researcher's
  sheet, every RR ch. 8 project kind beyond the four built; experimentation;
  components and compounds; rituals learned and
  cast; XP; the spellcasting-services bridge.
  Congregation-scale divine power waits for the domains feature's realm
  model.
- **6 — Optional rules.** Overcasting, places of power, spell damage
  against structures, magic in construction, mortal-wounds inputs from
  tracked effects.
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
- **A range ring while summons are placed.** Board 21 of the cast canvas (approved by the owner, "Build it now", then moved out of the 2026-11-19 minor: "no new surfaces") draws a dashed ring of the spell's range around the caster's token while the seat clicks the summons' points, with a counting banner. The range check itself is built (lib `pickPlacement`); the ring is not. The 1d-B rulings are in `docs/magic/wip/20261115-spell-effects-plan.md`.
- **A caster stashed in a party that is in a fight summons by click.** A summoning joins its caster's party only while the party is in no fight (MODEL, "Casting a summoning spell"). A caster still stashed in a party that is in a fight has its cast placed by click, and a spell that states a range is refused to a Player for want of a caster token to measure from.
- **The Magic tab's summon row counts the scene in view.** Creatures held in a party read 0 from a scene the party's token does not stand on, on the standing figure and on the joined one.
- **Creatures of one cast made into a party share one appended number**, where the creature's prototype token appends one to its name.
- **The perpetual light spell has no importer recipe.** The importer authors no light row for it (RR 193, 228), so its cast writes no light and the party sheet's Kit tab cannot offer it. Until the recipe is built a Judge writes the light row on the spell by hand, in the effect-row editor. The owner's selection on the 2026-11-25 bug-batch board ("Importer recipe later, by hand until then"); the rejected alternative was a Judge's row on the Kit tab for a light already burning, with no cast and no slot.
- **A dice formula the cast rolls for a summon's number.** A summon row's number is a whole figure (`amount`), and the cast window's count is one too. Two of the calling spells print their number as dice (RR ch. 5, the spell descriptions); neither carries a summon row today. Rolling it needs a formula on the row, a reader in the importer and a roll at the cast, with the figure's tooltip naming the dice and the page.
- **A reversed purify spell.** The purify entry's reverse, which spoils what its forward form cleans, has no rows: no apply kind models it.
- **The seal stage failed once in three walks.** In one `magic-cast-tracked` run on 2026-11-19, the door that stage I makes locked read as closed straight after its create. The later clicks then met the wrong doors, and nine checks failed. The next run passed with the same code. The cause is not known; the 1d-B part of "Results, 1d" in `docs/magic/wip/20261115-spell-effects-plan.md` names the runs.
