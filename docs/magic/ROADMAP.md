# Magic — Roadmap

What is designed and not built. The full decomposition — data model,
importer recipes, engines, UI, verification, open questions — is
[wip/20260924-scoping.md](wip/20260924-scoping.md) until each release moves
its substance into MODEL and DECISIONS.

Each release below is a major unless the owner rules otherwise, and each
ships the Judge tools for what it adds.

- **1a — Foundation: the spell.** `SpellExtras` on core's spell Item with its
  sheet (Overview, Effects, Text); the shared effect-row editor; the
  `kind.spell` importer recipe for RR ch. 5 and the RR ch. 8 rituals (rituals
  import here and become castable with research); `choosableSpells` reading a
  spell's lists and deduplicating core-pack namesakes; template spellbooks
  resolving imported spells; the repair-in-place policy for spells; the
  uninstall path.
- **1b — Foundation: the math.** The `acks.spellBuilder` document from JJ
  ch. 14 (AXIOMS 18 and HFH ch. 8 as alternate producers); the pure cost
  engine; the Build tab; the printed worked builds as build records.
- **2 — Casting and tracking.** The `spendSpell` wrap (falling through for
  spell items without the flag, which core's packs use as monster attacks),
  the cast dialog, targets and templates, per-target saves inside the card,
  spell effects as flag-marked Active Effects aged by Foundry's own expiry
  with the rounds-to-seconds rewrite when a combat ends, damage and healing
  cards, summons with a Judge-confirmed dismissal, concentration and
  disruption prompts, repertoires and the spellbook migration to references,
  the Magic tab redesign, settings and macros. A points or gnosis caster
  keeps today's pool strip until its engine lands.
- **3a — Magic types.** The `acks-extras.magicType` document, its sheet and
  builder from JJ ch. 15; publication to `acks.magicTypes`, merged over the
  class builder's imported rows by key; inherited repertoires; the
  `VALUE_SCALES` wiring.
- **3b — Eldritch.** Shades promoted to code, the corruption ledger, the
  Annals of the North ceremonies, the HFH shaded list.
- **3c — Gnosis and ceremonial.** The shared ceremony procedure (performance
  ladder, mishap tiers, stigma, purification); BTA invocations and
  implements; HFH codices, trinkets and talismans.
- **3d — Spellsinging.** The points engine, tapping, extemporaneous builds
  through the cost engine.
- **4a — Magic items: JJ.** The `magicItem` flag, its fieldset and tab, the
  use flow; `kind.magicItem` for JJ ch. 4; the classic and heroic generation
  tables; traits; the markets bridge.
- **4b — Magic items: Treasure Tome.** The `tt` reader; the Mechanics block;
  gritty tables; the advanced item rules and the appendices.
- **5 — Research.** The `acks-extras.research` document, its sheet and the
  Judge's ledger; every RR ch. 8 project kind; experimentation; components
  and compounds; rituals learned and cast; facilities; XP; power ledgers; the
  spellcasting-services bridge. Congregation-scale divine power waits for
  the domain module family.
- **6 — Optional rules** (minor). Overcasting, places of power, spell damage
  against structures, magic in construction, mortal-wounds inputs from
  tracked effects.
