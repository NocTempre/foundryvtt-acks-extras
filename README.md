# ACKS II — Extras

### 📖 [Tutorials and feature gallery → noctempre.github.io/foundryvtt-acks-extras](https://noctempre.github.io/foundryvtt-acks-extras/)

Rules automation for the **Adventurer Conqueror King System II** in Foundry VTT:
the character sheet, classes and the class builder, spells, proficiencies and
class powers, equipment and fighting styles, exploration formations and
overland travel, battlemaps and hex terrain, henchmen and hirelings, influence
and reactions, factions and standing, domains, places, storage and markets,
vehicles and voyages, and the full Monstrous Manual stat block — over one set
of shared primitives and one rules-table registry — and the importer that
reads all of it from your own ACKS II PDFs.

A Foundry VTT module extending the
[ACKS II game system](https://github.com/AutarchLLC/foundryvtt-acks-core).

---

## Installation

On Foundry's setup screen: **Add-on Modules → Install Module** → paste the
manifest URL:

```
https://github.com/NocTempre/foundryvtt-acks-extras/releases/latest/download/module.json
```

**Requirements**

| | |
|---|---|
| Foundry VTT | v14+ |
| System | ACKS II (`acks`) 14.1.0+ |
| [lib-wrapper](https://github.com/ruipin/fvtt-lib-wrapper) | v1.12.0+ — wraps core roll methods |
| [socketlib](https://github.com/manuelVo/foundryvtt-socketlib) | v1.1.0+ — routes GM-only writes so players can act without ownership grants |
| Your own ACKS II PDFs | Only for importing. The importer reads them in the browser; a book leaves your machine only if the GM puts it on your own Foundry server for the table. Everything else works without them |

**Recommended:** [game-icons-net](https://foundryvtt.com/packages/game-icons-net)
for ability icons in the ACKS-shaped corners of the imported corpus (Acrobatics,
Blind Fighting, Caving, Mapping). Without it those fall back to core Foundry
icons. [Automated Animations](https://foundryvtt.com/packages/autoanimations),
with Sequencer and JB2A, animates attacks and spells on the map, a miss included
([guide](docs/guides/appearance.md#animate-attacks-and-spells-on-the-map)).

### Installing from source

A clone is not a module: the compiled compendiums are build output and are not
in git, so a clone straight from GitHub loads with every compendium present and
empty. One command closes the gap.

```bash
git clone https://github.com/NocTempre/foundryvtt-acks-extras.git acks-extras
cd acks-extras
npm run rebuild
```

**Clone as `acks-extras`, not as the repository name.** Foundry resolves a
module by the name of its folder under `Data/modules`, so a folder called
`foundryvtt-acks-extras` never appears in the module list at all — with no error
to explain it. Cloning into `Data/modules/acks-extras` installs it in place;
`npm run rebuild` reports the mistake before it builds anything.

`npm run rebuild` installs the build dependencies, compiles the compendiums, and
then verifies that every path the manifest declares is really on disk — a
compendium that would load with no documents is reported rather than shipped.
Two options:

| | |
|---|---|
| `node tools/rebuild.mjs --prune` | the same, then delete `node_modules` — around 100 MB the running module never reads |
| `node tools/rebuild.mjs --check` | verify only; build nothing |

Rerun it after a `git pull` that changes `packs/_source` or `tools/pack-data`.
A release tag builds the same way — check it out and run `npm run rebuild` —
so a tag is enough to get that release running, with or without its zip.

---

## Getting started

1. Enable the module in **Settings tab → Manage Modules**. Nothing is
   mandatory — every feature is opt-in through its own settings, and the
   defaults are RAW.
2. Open **Settings tab → Game Settings → ACKS II — Extras**. World-scoped
   toggles are grouped by feature; the optional-rule *overlays* are all off
   unless the rule is already core.
3. Open a character. It opens on the module's own sheet, and the system's is
   one **Configure Sheet** away. See
   [The character sheet](https://noctempre.github.io/foundryvtt-acks-extras/guides/character-sheet/).
4. If you own the books, open the **Compendium Packs tab → ACKS II — Extras →
   Macros → ACKS Extras Macros** compendium, run **Your ACKS Books (this
   seat)** to connect a PDF, then **Import Everything (GM)**: classes, spells,
   proficiencies, equipment, monsters, tables and more arrive from your own
   copy. See [Importing from your books](https://noctempre.github.io/foundryvtt-acks-extras/guides/importer/).

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
- **Only the GM needs the books.** A book is read at the moment something is
  imported from it. It can sit on the importing seat's own disk, or the GM can
  put it on the Foundry server so every GM seat reads it without being asked.
- **What it imports.** The Monstrous Manual's monsters with the full stat
  block, natural weapons, spoils and treasure links; the Revised Rulebook's
  classes (progressions, saves, award ladders, starting templates), spells,
  proficiencies and class powers, equipment and the weapon, armour and gear
  price tables; the Judges Journal's proficiencies, drawbacks, class builder
  and the rules tables the henchmen market, travel, weather and encounters run
  on; By This Axe's dwarven classes; and the adventure line's books, each as
  one Adventure.
- **Nothing is imported twice, and everything can be removed.** An import
  steps over what the world already holds, a repair brings an imported
  document back in line with the page, and **Delete Everything Imported (GM)**
  takes it all back.

Guide: [Importing from your books](https://noctempre.github.io/foundryvtt-acks-extras/guides/importer/).

### The character sheet

Every character opens on the module's own sheet: a band across the window
header, the portrait between two rails, and tabs organised by what you do at
the table. Every throw is a row, and the whole row is the button. The system's
sheet stays one **Configure Sheet** away; the two read and write the same fields.

Guide: [The character sheet](https://noctempre.github.io/foundryvtt-acks-extras/guides/character-sheet/).

### Shared primitives

The foundation the other features are built on, and useful on its own.

- **The attack seam.** Every attack the system rolls picks up labelled
  modifiers from the conditions, the equipment feature and any other feature
  that registers one, each named in the roll. What the system's throw has no
  place for is told to the table as a notice.
- **Storage.** Goods can be kept at a place. Stored items are real embedded items
  on that actor, attributed to their owner, so a warehouse holding three
  characters' gear reads as three inventories rather than one shared pile.
- **Groups and mounts.** A stackable group actor (troops as stacks with a linked
  commander) and a rider/mount binding other features can ask about.
- **Animal, Group and Template actor sub-types**, and the Follower Card sheet.
- **The rules-table registry.** A priority-layered store the other features read
  through: imported book tables, world tables, and the GM's overrides on top.
  Nobody reads a table by module name.
- **Repair This World (GM).** One window that finds the data this module left
  damaged: bundles no sheet lists, links to documents that are gone, writes
  that stopped part-way. It changes only the findings you tick, and checks
  every fix by scanning again. Open it from **Settings tab → Game Settings →
  ACKS II — Extras → Repair this world**, or its macro.
- **Adjust Hit Points (GM).** Damage, heal or set the hit points of several
  creatures at once, each with its own multiplier, through the system's own
  damage rule. It opens on the selected tokens from the Tokens controls or its
  macro, and on a whole party from the party sheet. Undo works while the
  window is open.
- **Restore the Compendium Library (GM).** Re-files every ACKS compendium to
  the folder its manifest declares and resets each pack's sort, lock and
  ownership, for a world whose packs were moved or unfiled. Its macro is in
  the *ACKS Extras Macros* compendium.
- **Theming.** One design-token layer (`--acks-*`) across every ACKS surface —
  including the ones the *system* renders — measured from the books and carrying
  a light and a dark value for every colour. Per-client controls for colour
  scheme, how much styling the system's own sheets take, and font size.
  Guide: [Appearance](https://noctempre.github.io/foundryvtt-acks-extras/guides/appearance/).

### Classes and the class builder

A class held as a document rather than as prose: requirements and key
attributes, the level progression, save and attack bands as printed, the named
ladders a spread's extra columns carry, casting traditions with their slot
grids, the printed templates, and the per-level award ladder. Class documents
arrive from your own book through the importer, or are typed by hand — both
produce the same document in the same sheet.

- **The constructor.** **Create Item → Class** opens the sheet that builds one.
  Simple mode is the printed spread, entered directly.
- **Advanced mode** — the *Judges Journal*'s class builder, automated. Enter
  build values (Hit Die, Fighting with its split, Thievery with chosen skills,
  magic values, a racial value) plus trade-offs and custom powers; the class
  sheet's Builder tab shows the accounting and derives the whole spread on
  demand — XP schedule, attack throws, saves chassis, cleaves, damage-bonus and
  thief-skill ladders, and a casting tradition per magic value. It is a tool
  for balanced homebrew, never a validator: nothing blocks.
- **Races are documents too**, carrying the racial-value ladder — each rung's
  XP cost, level cap and granted powers — attribute minimums, always-on
  traits, and how the race stacks with a magic category.
- **Magic values are an open set.** Arcane and divine are only the first rows
  a world imports; ceremonial, gnostic, alchemical or homebrew traditions are
  rows of the same shape.

The module ships **no class values**. Derivation writes the same fields an
import fills, so applying, levelling and chargen cannot tell the two apart.

Guide: [Classes and the class builder](https://noctempre.github.io/foundryvtt-acks-extras/guides/classes/).

### Magic and spells

The spell as a document with structure, not only prose. Every `spell` Item
opens on the ACKS Spell sheet: the printed stat line as fields — the lists the
spell prints on, each with its magic type and level; its type; range and
duration as a shape with a value; target, save, reversal — and a Mechanics tab
of effect rows in the vocabulary the abilities already use. The system's own
level, class, range and duration strings follow the fields, so the system
sheet and the character sheet keep reading.

- **Every printed spell imports.** Connect your Revised Rulebook and **Import
  Everything (GM)** writes one document per entry of the spell chapter and
  each sample ritual, the stat line parsed onto the fields and the description
  closing on its page. Spells land before classes, so a starting template's
  spellbook finds what it names.
- **Casting stays the system's**: the counter, the chat card and the Save
  button are the system's own.
- **Leave no trace.** The **Uninstall — Strip Spell Data** macro removes the
  fields from every spell in the world and keeps the strings.

Guide: [Magic](https://noctempre.github.io/foundryvtt-acks-extras/guides/magic/).

### Proficiencies, class powers and skills

An extended effect model for ability items — the structured mechanics a plain
description cannot carry: what an ability grants, what it modifies, what it lets
you roll, and at which ranks. Rolls made through it pick up those modifiers
automatically. Adds an *Abilities* tab to ability items.

Guide: [Proficiencies and class powers](https://noctempre.github.io/foundryvtt-acks-extras/guides/abilities/).

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

Guide: [Equipment and fighting styles](https://noctempre.github.io/foundryvtt-acks-extras/guides/equipment/).

### Exploration formations

Condenses the party into a marching formation with a single party token, keeps
the dungeon-turn bookkeeping, and runs an overland journey day by day.

- **Party actor and party token** — one token to move, members inside it.
- **The dungeon turn** — a turn clock with wandering-monster throws at the
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

- **How the order moves** — on foot, mounted, by vehicle, flying or by vessel —
  decides which factors it meets at all, and the readout says which factor
  replaced which.
- **Weather off the calendar.** The sky is settled once per day for the ground
  you are on, derived from the date and the climate rather than stored on
  whoever rolled it, so two parties in the same country get the same day. Mud
  and snow accumulate and dry out on their own.
- **Provisions are pooled.** Food and water are shared across the whole marching
  order and dealt out by a policy you pick: evenly, or by triage.
- **Hunger, thirst and the cold** each run their own clock on every member, and
  the sheet shows where each one stands.
- **Living off the country.** Foraging for food, water and firewood, hunting,
  and grazing for the animals, each throw with its factors named. What is
  found is deposited on the people who found it.
- **Searching and surveying.** An hour spent looking can turn up a lair, a ruin
  or another party, and surveying tells the Judge how much is left to find.
- **Getting lost.** A failed navigation throw is whispered, not announced. The
  party walks on believing it is somewhere it is not, and the map fills in with
  the ground they *think* they crossed, while the Judge alone sees where they
  really are.
- **City travel.** A settlement is crossed the same way: a pace, the route, how
  well the party knows the way, and whether it is dark.

Every threshold, target, penalty, yield and rate behind this arrives through
the importer from your own books. Until it does, each readout says plainly
what it cannot price; nothing is ever guessed.

Guide: [Exploration formations](https://noctempre.github.io/foundryvtt-acks-extras/guides/formation/).

### Battlemaps and overland maps

Map tools for both scales, on the scene rather than in a separate window.

- **Hex terrain painting.** Claim hexes as Regions and the travel readout picks
  the ground up from the map. The terrain vocabulary is whatever your own books
  put in the registry, not a list fixed in the module — and mud and snow are
  not paintable, because they are conditions the weather produces.
- **Roads and routes.** A hex has edges, corners and a centre, and a road is a
  declared path between them, which the travel readout follows.
- **Battlemap alignment** — line a published battlemap up to the grid, and keep
  token scale honest across the two scales.

Guide: [Map alignment and token scale](https://noctempre.github.io/foundryvtt-acks-extras/guides/battlemap/).

### Vehicles and voyages

Carts, wagons, chariots, palanquins, galleys and ships are actors, made from
**Actors tab → Create Actor → Vehicle**. The sheet keeps who is aboard and where,
the hold, the hull and the crew, derives the speed it makes now and why, and
deploys a vehicle as a place that keeps its passengers' goods.

Guide: [Vehicles, wagons and vessels](https://noctempre.github.io/foundryvtt-acks-extras/guides/vehicles/).

### Henchmen and hirelings

The hireling procedure, end to end.

- **Availability** by market class, kept on the market, so every recruiter in a
  town draws on the same month.
- **Recruitment postings** — generic searches draw on the town's shared pool;
  a directed search's results go only to whoever paid.
- **A player-facing recruitment board.**
- **Hiring negotiation** — Reaction to Hiring Offer, including presenting as a
  level you are not.
- **Henchman generation** — stats, class, level, culture, age and occupation from
  the settlement's demographics.
- **Loyalty and morale** — calamities, level-up loyalty, obedience, wages, arrears.
- **Monstrous henchmen**, followers, and the optional slavery rules (JJ 409).

Guide: [Henchmen and hirelings](https://noctempre.github.io/foundryvtt-acks-extras/guides/henchmen/).

### Influence and reactions

A reaction and influence roller for the three ACKS II tones — Diplomacy,
Intimidation, Seduction — with attitude tracked per subject on an `attitude`
item, and ability effects feeding the roll. Optional *By This Axe* dwarven caste
modifiers and a configurable race-relations matrix.

Guide: [Influence and reactions](https://noctempre.github.io/foundryvtt-acks-extras/guides/influence/).

### Places and storage

The **Location** actor: a place where people are hired and goods are kept. One
sheet carries both halves — market tabs (recruitment, henchmen, mercenaries,
specialists) and a storage tab showing what is kept there, grouped by owner.

Also: a **Storage** tab on the character sheet, a storage manager for the GM
(**Settings tab → Game Settings → ACKS II — Extras → Storage manager**, or the
**Open Storage Manager** macro), and coin that is kept somewhere real in place
of the system's bank column. The Ruledata Browser (**Settings tab → Game
Settings → ACKS II — Extras → Imported Rules Tables**) is the GM's audit
surface over imported tables — export, edit, override, revert.

Guide: [Places and storage](https://noctempre.github.io/foundryvtt-acks-extras/guides/location/).

### Item markets and ventures

Buy and sell equipment at any settlement with a market, at the availability
and prices your own books give — with merchant imports, commissions, directed
searches, the magic-item market, mercantile ventures, market research, and
the goods and demand a settlement trades in. An action whose table is not
imported refuses and names the table.

Guide: [Item markets and ventures](https://noctempre.github.io/foundryvtt-acks-extras/guides/markets/).

### Factions, standing and status

The **Faction** actor: a guild, a temple, a syndicate, a noble house, the watch.
It has a seat, a leader, members, the quarters of a city it controls, and a
ledger of how it stands toward a party or a character, in the Judge's own
figures. The ledger's total is listed on reaction rolls made against the faction,
against its members, and anywhere in its quarters; a **Wanted** row marks the
party hunted in those quarters, so the district's hunted table answers there; and
an optional setting lets standing move a market's class for one recruiter. The
influence roller also fills its social status row from the ranks of the two
people talking. Adventure books that describe a settlement's organisations import
them as factions seated in their quarter.

Guide: [Factions, standing and status](https://noctempre.github.io/foundryvtt-acks-extras/guides/factions/).

### Domains

The **Domain** actor: a ruler's land, kept as the campaign game keeps it. Its
territory and peasant families, the settlements and strongholds it holds, the
structures of its stronghold, the month's revenue and expense lines, its
morale, and the lieges and vassals around it. Every figure is the Judge's or an
imported adventure's, the sheet adds them up, and a line nobody has entered is
reported as unset rather than counted as zero.

Guide: [Domains](https://noctempre.github.io/foundryvtt-acks-extras/guides/domains/).

### The Full Monster Sheet

An alternate monster sheet carrying the complete structured Monstrous Manual stat
block — classification, attacks, abilities, defenses, ecology, spoils, treasure,
henchman details — instead of one prose block. A monster opens on the Follower
Card, which expands into it; **Open Full Monster Sheet** in an actor's
right-click menu in the **Actors tab** opens it directly, and an Animal opens on
it by default.

Guide: [The Monstrous Manual stat block](https://noctempre.github.io/foundryvtt-acks-extras/guides/monsters/).

### Playing from Discord

A bot that runs beside your Foundry server, holds a seat of its own in the
world, and lets the members of your Discord server roll, speak and read their
characters without opening Foundry. Every command runs as the Foundry user the
member is linked to, and the world keeps every roll and every word.

Guide: [Playing from Discord](https://noctempre.github.io/foundryvtt-acks-extras/guides/bridge/).

---

## Compendia

The [compendia reference](https://noctempre.github.io/foundryvtt-acks-extras/reference/compendia/)
lists every compendium pack the module ships, with the documents in it, and
the compendiums an import from your own books leaves in a world, with a brief
of what each one holds. That page is generated from the pack data the build
compiles, the manifest and the code that names the importer's shelves, so no
pack name or count is kept here to fall behind it.

---

## Settings reference

The [settings reference](https://noctempre.github.io/foundryvtt-acks-extras/reference/settings/)
lists every setting the module registers: what each configurable one does, its
scope and its default, and the internal ones that only persist world state.
That page is generated from the registration calls themselves, so no count or
list is kept here to fall behind it.

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
acksExtras.importer   acksExtras.factions
acksExtras.domains
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

The [API reference](https://noctempre.github.io/foundryvtt-acks-extras/reference/api/)
has one page per key, generated from the code.

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

**Requires:** legitimate copies of the ACKS II publications this module draws
on — the **ACKS II Revised Rulebook** and **ACKS II Judges Journal**; optional
content additionally draws on the **ACKS II Monstrous Manual** (monstrous
henchmen, the Full Monster Sheet) and **By This Axe** (dwarven cultures and
castes). The module is not a substitute for the books, and is free to use.
