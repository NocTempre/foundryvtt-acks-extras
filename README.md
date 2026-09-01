# ACKS II — Extras

### 📖 [Tutorials and feature gallery → noctempre.github.io/foundryvtt-acks-extras](https://noctempre.github.io/foundryvtt-acks-extras/)

Rules automation for the **Adventurer Conqueror King System II** in Foundry VTT:
classes and the class builder, proficiencies and class powers, equipment and
fighting styles, exploration formations and overland travel, battlemaps and hex
terrain, henchmen and hirelings, influence and reactions, locations, storage and
markets, vehicles and voyages, and the full Monstrous Manual stat block — over
one set of shared primitives and one rules-table registry — and the importer
that reads all of it from your own ACKS II PDFs.

This is the merge of nine modules that used to ship separately (`acks-lib`,
`acks-abilities`, `acks-equipment`, `acks-formation`, `acks-henchmen`,
`acks-influence`, `acks-location`, `acks-monsters`, and later
`acks-importer`). They were never really independent — seven of the eight
required the library, two called into each other, two defined the same Actor
sub-type, and the importer filled structures every one of them owned — so they
are one module now.

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
| Your own ACKS II PDFs | Only for importing. The importer reads them in your browser and never uploads them; everything else works without them |

**Recommended:** [game-icons-net](https://foundryvtt.com/packages/game-icons-net)
for ability icons in the ACKS-shaped corners of the imported corpus (Acrobatics,
Blind Fighting, Caving, Mapping). Without it those fall back to core Foundry
icons.

### Upgrading from the eight separate modules

1. Install this module, **disable all eight old ones**, and reload.
2. Run the **Clean Up After the Merge (GM)** macro from the *ACKS Extras*
   compendium folder.

Nothing is migrated — this is a clean break, and the old modules' data is not
carried across. The macro removes what they left behind, which matters because a
document whose sub-type came from a now-absent module cannot load at all and
throws on every world load. It shows you everything it found before removing
anything, and it is safe to run twice.

### Upgrading from the separate Importer module

1. Update this module, then **disable ACKS II — Importer** in *Manage Modules*
   and reload. While it is still active the built-in importer stays off and a
   notice says so on every load, so two importers never write one library.
2. The next load as GM carries your imported library over — every document on
   every *ACKS Cookbook* shelf and in the sidebar, the server-held book shelf,
   any registered OSE sources, this seat's importer settings, and any imported
   macros still addressing the old module. It runs once, and the notice
   reports what moved. Per-seat book locations need nothing.
3. Uninstall the old module when convenient. Nothing is left behind for the
   cleanup macro to find.

---

## Getting started

1. Enable the module. Nothing is mandatory — every feature is opt-in through its
   own settings, and the defaults are RAW.
2. Open **Settings → Configure Settings → ACKS II — Extras**. World-scoped
   toggles are grouped by feature; the optional-rule *overlays* are all off
   unless the rule is already core.
3. Import a couple of items from **ACKS Equipment Samples** to see equipment
   automation working.
4. If you own the books, run **Your ACKS Books (this seat)** from the *ACKS
   Extras Macros* compendium to connect a PDF, then **Import Everything (GM)**:
   classes, proficiencies, equipment, monsters, tables and more arrive from
   your own copy. See [Importing from your books](docs/guides/importer.md).

---

## Features

### Importing from your books

Book content arrives from **your own PDFs**. The module ships extraction
*recipes* — for a given entry on a given page, where its fields are and how to
recognise them — and never the book text. The GM connects a PDF once; the
recipes run against that file, in the browser, and write real world documents.

- **Everything you import persists.** Stat blocks, tables, prices and each
  entry's own descriptive text become world data, so once the GM has imported
  them everyone at the table has them, players who own no books included. Each
  imported passage closes on the book and page it was read from.
- **Only the GM needs the books.** Import is the one moment a PDF is read; a
  book staged on the server is read on every launch with no gesture, and
  nothing is resolved again afterwards. The bytes are never uploaded.
- **What it imports.** The Monstrous Manual's monsters with the full stat
  block, natural weapons, spoils and treasure links; the Revised Rulebook's
  classes (progressions, saves, award ladders, starting templates),
  proficiencies and class powers, equipment and the weapon, armour and gear
  price tables; the Judges Journal's proficiencies, drawbacks, class builder
  and the rules tables the henchmen market, travel, weather and encounters run
  on; By This Axe's dwarven classes; the adventure line's locations as
  journals, roll tables and actors; and another game's books — Old-School
  Essentials adventures — converted through the System Compatibility Guide.
- **Nothing is imported twice, and everything can be removed.** Imports land
  in world compendiums, one per series and document type; re-running updates
  what the page changed, and *Delete Everything Imported (GM)* takes it all
  back.

Guide: [Importing from your books](docs/guides/importer.md).

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
- **Theming.** One design-token layer (`--acks-*`) across every ACKS surface —
  including the ones the *system* renders — measured from the books and carrying
  a light and a dark value for every colour. Per-client controls for colour
  scheme, how much styling the system's own sheets take, and font size.

### Classes and the class builder

A class held as a document rather than as prose: requirements and key
attributes, the level progression, save and attack bands as printed, the named
ladders a spread's extra columns carry, casting traditions with their slot
grids, the printed templates, and the per-level award ladder. Class documents
arrive from your own book through ACKS Importer, or are typed by hand — both
produce the same document in the same sheet.

- **The constructor.** Create Item → Class opens the sheet that builds one.
  Simple mode is the printed spread, entered directly.
- **Advanced mode** — the *Judges Journal*'s class builder, automated. Enter
  build values (Hit Die, Fighting with its 1a/1b split, Thievery with chosen
  skills, magic values, a racial value) plus trade-offs and custom powers; the
  Builder tab shows the accounting and derives the whole spread on demand — XP
  schedule with its smoothing and post-8th climbs, attack throws, saves
  chassis, cleaves, damage-bonus and thief-skill ladders, and a casting
  tradition per magic value including the delayed-acquisition grids. It is a
  tool for balanced homebrew, never a validator: nothing blocks.
- **Races are documents too**, carrying the racial-value ladder — each rung's
  XP cost, level cap and granted powers — attribute minimums, always-on
  traits, and how the race stacks with a magic category.
- **Magic values are an open set.** Arcane and divine are only the first rows
  a world imports; ceremonial, gnostic, alchemical or homebrew traditions are
  rows of the same shape.

The module ships **no class values**. Derivation writes the same fields an
import fills, so applying, levelling and chargen cannot tell the two apart.

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

Condenses the party into a marching formation with a single party token, keeps
the dungeon-turn bookkeeping, and runs an overland journey day by day.

- **Party actor and party token** — one token to move, members inside it.
- **The dungeon turn** — a 10-minute clock with wandering-monster throws at the
  frequency and target you set.
- **Light sources** — torches and lanterns burn down, occupy hands, and light the
  party token; running out is noticed.
- **Mapping and fog** — fog of war can follow the mapper, and player measurements
  are fuzzed without a proficient one.
- **Player requests** — players steer their own members through a GM relay rather
  than needing ownership of the party.

#### Overland travel

The same sheet switches to a journey: the ground it is crossing, the day's sky,
a day board of ancillary hours, and the march derived with every factor named.

- **How the order moves** decides which factors it meets at all — on foot,
  mounted, by vehicle, flying or by vessel. A flier ignores roads entirely and
  feels wind by its own rule rather than the one that slows a walker; a vessel
  meets no ground at all. The readout says which factor replaced which.
- **Weather off the calendar.** The sky is settled once per day for the ground
  you are on, derived from the date and the climate rather than stored on
  whoever rolled it, so two parties in the same country get the same day. Mud
  and snow accumulate and dry out on their own.
- **Provisions are pooled.** Food and water are shared across the whole marching
  order and dealt out by a policy you pick: evenly, so everyone goes equally
  short, or by triage, so as many as possible eat properly.
- **Hunger, thirst and the cold.** Going short tells — hungry, then unable to
  force march or heal, then starving and losing Constitution daily. Thirst
  arrives faster and charges a rolled toll that sweltering weather doubles.
  Cold runs its own clock: a body left unprotected, or one that simply gets wet,
  turns hypothermic and loses Constitution by the hour until it reaches a fire.
  Anyone carrying a cloak or furs is sheltered.
- **Living off the country.** Foraging for food, water and firewood, hunting
  with or without dogs, and grazing for the animals. Hard country, settled
  country whose forage is somebody's crop, and the Survival proficiency each
  move the throw and each is named separately. What is found is deposited on
  the people who found it.
- **Searching and surveying.** An hour spent looking can turn up a lair, a ruin
  or another party — harder the faster you are moving, harder again for
  something particular, easier from the air over open country, and worse under
  a canopy. Surveying tells the Judge how much is left to find. Looking around
  owes its own encounter throw.
- **Getting lost.** A failed navigation throw is whispered, not announced. The
  party walks on believing it is somewhere it is not, and the map fills in with
  the ground they *think* they crossed, while the Judge alone sees where they
  really are. When they realise, that imagined ground closes back over — and
  only finding a known landmark puts the country they really crossed onto the
  map, in its right place.
- **City travel.** A settlement is crossed the same way: a pace, the avenues or
  the alleys, how well the party knows the way, and whether it is dark. Being
  lost in a city is a wrong turning noticed at once. A large party straggles,
  and splitting it is the way out — at the price of each group answering for
  its own encounters.

Every threshold, target, penalty, yield and rate behind this arrives through
**ACKS Importer** from your own books. Until it does, each readout says plainly
what it cannot price; nothing is ever guessed.

### Battlemaps and overland maps

Map tools for both scales, on the scene rather than in a separate window.

- **Hex terrain painting.** Claim hexes as Regions and the travel readout picks
  the ground up from the map. The terrain vocabulary is whatever your own books
  put in the registry, not a list fixed in the module — and mud and snow are
  deliberately not paintable, because they are conditions the weather produces.
- **Roads and routes.** A hex has edges, corners and a centre, and a road is a
  declared path between them. A road only helps a party actually travelling
  along it, and a winding route costs more distance than a straight one — stated
  rather than hidden inside a multiplier.
- **Battlemap alignment** — line a published battlemap up to the grid, and keep
  token scale honest across the two scales.

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
| Macros | Macro | 32, in the *ACKS Extras* folder — the importer's four sit in its *Your Books* and *Import from your books* sub-folders |

Compendium descriptions are authored restatements with page citations, never
transcription. The module ships no book text.

---

## Settings reference

43 settings: 39 configurable, 4 internal (persisted world state, not shown in
the UI).

**Library** — `attackRollPatch`, `manageVision`, `advanceWorldTime`,
`storageDeletePolicy`; per-client `theme`, `sheetStyle`, `fontScale`.

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
acksExtras.lib        acksExtras.henchmen
acksExtras.abilities  acksExtras.influence
acksExtras.classes    acksExtras.location
acksExtras.equipment  acksExtras.markets
acksExtras.formation  acksExtras.monsters
acksExtras.battlemap  acksExtras.vehicles
acksExtras.importer
```

Read it from a hook, not at module top level — features attach during `init`
(the importer's api at `ready`).

The rules-table registry (`acksExtras.lib.tables`) and the named-service registry
(`acksExtras.lib.services`) are the seams for feeding this module data. The
location feature provides `ruledata-import`, which the importer calls to write a
world's imported tables; the importer provides `ability-provider`, which the
class and henchmen features call to resolve proficiency names into real items.
Contracts are named rather than module-scoped, so a third module can stand on
either side — and a contract with no provider reads as `null` rather than
throwing.

The importer's api is `acksExtras.importer` — `bookStatus()`,
`importEverything()`, `importClasses()`, `cookbookRemoveImports()` and the rest.
An imported document carries `flags["acks-extras"].cookbook.id`, the definition
id everything else looks it up by.

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
