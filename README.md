# ACKS II — Extras

### 📖 [Tutorials and feature gallery → noctempre.github.io/foundryvtt-acks-extras](https://noctempre.github.io/foundryvtt-acks-extras/)

Rules automation for the **Adventurer Conqueror King System II** in Foundry VTT:
proficiencies and class powers, equipment and fighting styles, exploration
formations, henchmen and hirelings, influence and reactions, locations and
storage, and the full Monstrous Manual stat block — over one set of shared
primitives and one rules-table registry.

This is the merge of eight modules that used to ship separately (`acks-lib`,
`acks-abilities`, `acks-equipment`, `acks-formation`, `acks-henchmen`,
`acks-influence`, `acks-location`, `acks-monsters`). They were never really
independent — seven of the eight required the library, two called into each
other, and two defined the same Actor sub-type — so they are one module now.

A Foundry VTT module extending the
[ACKS II game system](https://github.com/AutarchLLC/foundryvtt-acks-core).

---

## Installation

In Foundry: **Install Module** → paste the manifest URL:

```
https://github.com/NocTempre/foundryvtt-acks-extras/releases/latest/download/module.json
```

**Requirements**

| | |
|---|---|
| Foundry VTT | v14+ |
| System | ACKS II (`acks`) v14+ |
| [lib-wrapper](https://github.com/ruipin/fvtt-lib-wrapper) | v1.12.0+ — wraps core roll methods |
| [socketlib](https://github.com/manuelVo/foundryvtt-socketlib) | v1.1.0+ — routes GM-only writes so players can act without ownership grants |

**Optional:** [ACKS II — Importer](https://github.com/NocTempre/foundryvtt-acks-importer)
imports book content from your own PDFs into the structures this module owns.
Everything here works without it; several features simply have more to work with
once the tables have been imported.

### Upgrading from the eight separate modules

1. Install this module, **disable all eight old ones**, and reload.
2. Run the **Clean Up After the Merge (GM)** macro from the *ACKS Extras*
   compendium folder.

Nothing is migrated — this is a clean break, and the old modules' data is not
carried across. The macro removes what they left behind, which matters because a
document whose sub-type came from a now-absent module cannot load at all and
throws on every world load. It shows you everything it found before removing
anything, and it is safe to run twice.

---

## Getting started

1. Enable the module. Nothing is mandatory — every feature is opt-in through its
   own settings, and the defaults are RAW.
2. Open **Settings → Configure Settings → ACKS II — Extras**. World-scoped
   toggles are grouped by feature; the optional-rule *overlays* are all off
   unless the rule is already core.
3. Import a couple of items from the **Equipment Samples** compendium to see
   equipment automation working, or open a monster from **Bestiary** to see the
   Full Monster Sheet.
4. If you own the books and want the real tables, add the Importer.

---

## Features

### Shared primitives (the former `acks-lib`)

The foundation the other features are built on, and useful on its own.

- **Attack roll, remodeled.** ACKS distinguishes the attack *throw* — a target
  that moves with class and level — from *bonuses* added to the roll. Core folds
  the target movement into the die pool: the same hit test algebraically, but the
  rolled value is masked and no modifier is attributable. This restores the
  model — `1d20 + labeled terms` against `throw + target AC`, every term visible
  in the roll tooltip. Outcomes are identical to core's for identical inputs
  (parity-tested). Toggle: *Attack roll: throw as target*.
- **Storage.** Goods can be kept at a place. Stored items are real embedded items
  on that actor, attributed to their owner, so a warehouse holding three
  characters' gear reads as three inventories rather than one shared pile.
- **Groups and mounts.** A stackable group actor (troops as stacks with a linked
  commander) and a rider/mount binding other features can ask about.
- **Animal, Group and Template actor sub-types**, and the Follower Card sheet.
- **The rules-table registry.** A priority-layered store the other features read
  through: built-in sample tables at the bottom, imported book tables above them,
  GM overrides on top. Nobody reads a table by module name.
- **Theming.** One design-token layer (`--acks-*`) across every ACKS surface,
  plus a per-client font-size control.

### Proficiencies, class powers and skills

An extended effect model for ability items — the structured mechanics a plain
description cannot carry: what an ability grants, what it modifies, what it lets
you roll, and at which ranks. Rolls made through it pick up those modifiers
automatically. Adds an *Abilities* tab to ability items.

### Equipment and fighting styles

RAW equipment-rule automation.

- **Equip limits and hand budget** — what you can hold and wear at once, and what
  a two-handed weapon or a shield costs you.
- **Fighting styles** — Weapon & Shield, Two-Handed, Dual-Wield, Missile, Single
  Weapon: detected from what is equipped, with specialization bonuses applied
  through one managed Active Effect.
- **Proficiency requirements** — non-proficient use penalties, weapon and armour
  proficiency, Martial and Armour Training.
- **Draw and sheath action economy**, ammunition consumption, thrown-weapon
  recovery.
- **Containers** — capacity, contents, and encumbrance that follows the goods.
- **Optional overlays**, each independently switchable: shield variants (JJ),
  combat maneuvers, item loss from damage (JJ), named magic items (JJ),
  scavenged equipment (RR), enclosing helmets.

### Exploration formations

Condenses the party into a marching formation with a single party token, and
keeps the dungeon-turn bookkeeping.

- **Party actor and party token** — one token to move, members inside it.
- **The dungeon turn** — a 10-minute clock with wandering-monster throws at the
  frequency and target you set.
- **Light sources** — torches and lanterns burn down, occupy hands, and light the
  party token; running out is noticed.
- **Mapping and fog** — fog of war can follow the mapper, and player measurements
  are fuzzed without a proficient one.
- **Player requests** — players steer their own members through a GM relay rather
  than needing ownership of the party.

### Henchmen and hirelings

The complete hireling ruleset.

- **Availability** by market class, rolled once a month for the whole town —
  availability belongs to the market, not to the recruiter.
- **Recruitment postings**, paid per week per hireling type: generic searches
  draw on the town's shared pool, directed searches are rolled privately for
  whoever paid.
- **A player-facing recruitment board.**
- **Hiring negotiation** — Reaction to Hiring Offer, including presenting as a
  level you are not.
- **Henchman generation** — stats, class, level, culture, age and occupation from
  the settlement's demographics.
- **Loyalty and morale** — calamities, level-up loyalty, obedience, wages, arrears.
- **Monstrous henchmen**, followers, and the optional slavery rules (JJ 409).

### Influence and reactions

A reaction and influence roller for the three ACKS II tones — Diplomacy,
Intimidation, Seduction — with attitude tracked per subject on an `attitude`
item, and ability effects feeding the roll. Optional *By This Axe* dwarven caste
modifiers and a configurable race-relations matrix.

### Locations and storage

The **Location** actor: a place where people are hired and goods are kept. One
sheet carries both halves — market tabs (recruitment, henchmen, mercenaries,
specialists) and a storage tab showing what is kept there, grouped by owner.

Also: a **Storage** tab on the character sheet, a GM storage manager, and the
retirement of the system's banked-coin column in favour of coin that is actually
somewhere. The **Ruledata Browser** is the GM's audit surface over imported
tables — export, edit, override, revert.

### The Full Monster Sheet

An alternate monster sheet carrying the complete structured Monstrous Manual stat
block — classification, attacks, abilities, defenses, ecology, spoils, treasure,
henchman details — instead of one prose block. Enable it per-actor from the actor
context menu.

---

## Compendia

| Pack | Type | Contents |
|---|---|---|
| Equipment Training | Item | 34 |
| Equipment Proficiencies | Item | 42 |
| Equipment Samples | Item | 9 |
| Equipment Actors | Actor | 4 demo characters |
| Henchmen Proficiencies & Powers | Item | 20 |
| Bestiary | Actor | 8 |
| Spoils | Item | 7 |
| Treasure | RollTable | 1 |
| Macros | Macro | 25, in one *ACKS Extras* folder |

Compendium descriptions are authored restatements with page citations, never
transcription. The module ships no book text.

---

## Settings reference

43 settings: 39 configurable, 4 internal (persisted world state, not shown in
the UI).

**Library** — `attackRollPatch`, `manageVision`, `advanceWorldTime`,
`storageDeletePolicy`; per-client `sheetTheme`, `fontScale`.

**Equipment** — `enforceMode`, `proficiencyEnforcement`, `rollAutomation`,
`ammoTracking`, `defaultHandBudget`, plus six `overlay*` optional rules.

**Formation** — `partyTokenImage`, `playersMoveParty`, `publicTurnCards`,
`lightItemEnforcement`, `encounterEvery`, `encounterTarget`, `manageFog`,
`mapperNeedsLight`, `syncTokenLight`, `signalAffectsEncounters`,
`fuzzMeasurement`.

**Henchmen** — `daysPerMonth`, `autoRollCalamity`, `enforceHenchmanLimit`,
`wagesToBank`, `wageReminders`, `autoRepairReferences`, `playerMarketVisibility`,
`enableExpectedLiving`, `enableSlavery`.

**Influence** — `enableBtaCaste`, `raceRelations`.

---

## For module authors

The module exposes one global, `globalThis.acksExtras`, which is also
`game.modules.get("acks-extras").api`. Each feature hangs off its own key:

```js
acksExtras.lib        acksExtras.formation
acksExtras.abilities  acksExtras.henchmen
acksExtras.equipment  acksExtras.influence
acksExtras.location   acksExtras.monsters
```

Read it from a hook, not at module top level — features attach during `init`.

The rules-table registry (`acksExtras.lib.tables`) and the named-service registry
(`acksExtras.lib.services`) are the seams for feeding this module data. This
module registers `ruledata-import` (the location feature provides it) and the
Importer calls it to write a world's imported tables; the Importer in turn
registers `ability-provider`, which this module calls to resolve proficiency
names into real items. Contracts are named rather than module-scoped, so neither
side needs to know who is on the other end — and a contract with no provider
reads as `null` rather than throwing.

---

## License

**Code:** © NocTempre — proprietary; all rights reserved except as granted to
Autarch LLC under the **ACKS II App License**. This module is **not** open source
or Open Game Content, and no license is granted to copy, redistribute, or reuse
its code. See [`LICENSE`](LICENSE).

**ACKS II content** is used under the **ACKS II App License**. ACKS, ACKS II, and
Adventurer Conqueror King System are trademarks of **Autarch LLC**.

**Unofficial** — this is an unofficial fan module, not published or endorsed by
Autarch LLC.

**Registration #:** _[pending registration]_

**Requires:** legitimate copies of the ACKS II publications this module draws
on — the **ACKS II Revised Rulebook** and **ACKS II Judges Journal**; optional
content additionally draws on the **ACKS II Monstrous Manual** (monstrous
henchmen, the Full Monster Sheet) and **By This Axe** (dwarven cultures and
castes). The module is not a substitute for the books, and is free to use.
