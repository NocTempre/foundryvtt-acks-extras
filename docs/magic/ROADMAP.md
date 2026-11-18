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
  ships.
- **3d — Spellsinging.** The points engine, tapping, extemporaneous builds
  through the cost engine (needs 1b).
- **4b — Magic items: Treasure Tome.** The `tt` reader; the Mechanics block;
  gritty tables; the advanced item rules and the appendices.
- **5 — Research.** The `acks-extras.research` document, anchored at a
  location whose facilities gate it and linked to the researching
  character, its sheet and the Judge's ledger; every RR ch. 8 project
  kind; experimentation; components and compounds; rituals learned and
  cast; XP; power ledgers; the spellcasting-services bridge.
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
- **Summons: the caster level, the capacity and the fight (1d-B).** What the
  built summons (MODEL, "The five built summons") and the tracked kinds leave
  for the next slice, each a row:
  - the caster level reaches a summon's count and duration, so a count scaling
    with it (`max`) is resolved and capped, and a per-level duration is timed;
  - a summons takes the capacity verdict and spends the tradition's pool, as a
    cast does; today it spends core's count only;
  - placement range, the summoner's abilities and a declaration in a begun
    fight (today a summons resolves at once in a fight);
  - Dismiss on the card of a held summons' end (today the card tells, no
    Dismiss, and the creatures stay);
  - a summon row's `name`, and a summon arm of the describe reading `max`;
  - the describe's default arm names its kind;
  - three kinds the vocabulary lacks, for delayDisease, purifyFoodAndWater and
    sealPortal (the last is a third kind beyond the two first named);
  - a cast whose rows open no entry measures no target, so stale targets no
    longer range-block a Player's cast of a spell that only creates an effect.
- **Extract the held-record write.** `castSpellRun` and `castSummonSpell` each
  compose a concentration's held record (the status by kind, `held`, `tail`, the
  start time, the cap). One `cast-held` function would own it, and
  `cast-summon` would stop repeating the composition.
- **One card per cast.** A cast posts two cards: the system's spell card, from
  the `spend()` that runs core's `_useSpell` (docs/lib/API.md, the cast seam), and
  the cast card. Both show on every cast, so a Judge sees the spell twice;
  folding the module's card into the system's, or suppressing one, is not built.
