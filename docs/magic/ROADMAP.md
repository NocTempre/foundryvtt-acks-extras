# Magic — Roadmap

What is designed and not built. The full decomposition — data model,
importer recipes, engines, UI, verification, open questions — is
[wip/20260924-scoping.md](wip/20260924-scoping.md) until each release moves
its substance into MODEL and DECISIONS. Releases 1a (9.0.0) and 1a+ (9.1.0)
are built; MODEL carries them.

Each release below is a major unless the owner rules otherwise, and each
ships the Judge tools for what it adds. The order is the owner's ruling of
2026-09-25 (DECISIONS, "The order, and the scoping's eleven questions, ruled"): 2 and 4a
before 1b.

- **2 — Casting and tracking.** The `spendSpell` wrap (falling through for
  spell items without the flag, which core's packs use as monster attacks),
  the cast dialog, targets and templates, per-target saves inside the card,
  spell effects as flag-marked Active Effects aged by Foundry's own expiry
  with the rounds-to-seconds rewrite when a combat ends (the flag weighed
  against a sub-type first), damage and healing cards, summons placed by
  click with a Judge-confirmed dismissal, concentration and disruption
  prompts, repertoires (a prayerful caster's first-level repertoire among
  them) and the spellbook migration to references, the Magic tab redesign,
  settings and macros. A printed spell executes the effect rows the
  register authors for it; a points or gnosis caster keeps today's pool
  strip until its engine lands.
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
  Congregation-scale divine power waits for the domain module family.
- **6 — Optional rules** (minor). Overcasting, places of power, spell damage
  against structures, magic in construction, mortal-wounds inputs from
  tracked effects.
