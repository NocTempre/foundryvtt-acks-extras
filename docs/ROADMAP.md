# Roadmap — repo level

Re-issued 2026-11-14.

Work that is designed but not built, and primitives that exist ahead of the thing
that will consume them. Anything here is deliberately absent from the code, not
missing from it.

Feature-scoped roadmaps live in `docs/<feature>/ROADMAP.md`.

---

## Open after the 2026-11-17 bug sweep

Rulings that wait for the owner (the sweep decided none of them):

- **A search order's trader.** `markets/engine/imports.mjs` `createItemSearch` is the only order path without `awayFromMarket`. Should a search require the trader at the market?
- **Container capacity stated as 0.** Does it mean "holds nothing" or "unstated"? `equipment/containers.mjs` (`if (!cap) return false`) and `lib/capacity.mjs` disagree, and `capacityStone` gives 0 versus null for an unstated capacity. Once ruled, containers delegate to lib.
- **Combat rounds and rest.** `docs/formation/MODEL.md` says combat rounds do not count toward rest; the code counts them (`onCombatRoundChange` → `advanceRounds` → `turnsSinceRest`). Which is intended?
- **A weapon dropped on a non-hand slot.** `equipment/placement.mjs` `placeItem` draws it. Should it draw, be worn where the slot allows, or be refused with `equipment.notWearable`?
- **The detach leash's units.** `formation/deployment.mjs` `feetBetween` returns scene units and is compared with feet, so the leash is wrong on a metric scene. Converting with `sceneFeetPerCell` makes every step breach on an expedition-scale scene, so it needs a ruling on whether the leash stands down there (`isExpeditionScale`).
- **A range hyphen read as a minus.** The prose readers in `importer/table-extract.mjs` (`signed`/`int`/`gp` windows) read the hyphen of "1-3" as a sign. The obvious lookbehind fix breaks "1d6-2". Needs a book check of which printed windows hold a range, then `test-recipe-content` with the books.
- **The vehicles api version.** `hullValue` and `clearSinkingClockIfAfloat` were added to `acksExtras.vehicles`; `vehicles/module.mjs` says additive changes bump `apiVersion` (3).
- **A requirement scan's letter case.** `importer/cookbook/classes.mjs` matches upper-case ability abbreviations only; check a printed requirements line before widening it.
- **A bold-cell role across Detach.** Detaching a template package cannot restore an ability's bold-cell `role`, since the bundle never recorded it (a schema change).
- **A solicitation resolving in the next market month** is spent and logged, not re-resolved against the month it was posted in (`markets/engine/ventures.mjs`); re-resolving is a design change.

Unbuilt, found by the sweep:

- **Named items and property layers:** see `docs/equipment/ROADMAP.md`.
- **pdf.js lifecycle:** `importer/module.mjs` `ingestBook` and `shelvePath` re-ingest an already-open book without destroying the earlier pdf.js document, so a worker leaks; fingerprint with a throwaway open instead.
- **Not reviewed by any reader:** all of `scripts/abilities/`; `location/apps/{location-sheet,scene-link,table-docs,ruledata-browser}`; `vehicles/vehicle-sheet.mjs` outside ~140-445 and ~540-705; `monsters/monster-sheet.mjs`; `classes/class-data.mjs`; `importer/wall-trace.mjs` ~650-2030; `importer/adventure-binding.mjs` past line 200; `formation/formation-view.mjs` ~1000-1190 and ~1670-1840; `lib/vocab.mjs` lines 1-900; and the importer bindings `adventure-item`, `character`, `conditions`, `delve-encounter`, `faction`, `flight`, `foraging`, `formation`, `market-profile`, `merchandise`, `searching`, `survival`, `travel`, `weapon`, `weather` (searched, not read).
- **Unverified against core 14** (core source was not on the sweep's machine): `lib/module.mjs` flip-face menu reads only `li.dataset.entryId`; `lib/conditions.mjs` `giverOf` assumes the shape of `effect.start`; `lib/patches/morale-roll.mjs` catches a synchronous throw only; `magic/cast-expiry.mjs` `calendarSeconds`; `formation/party-actor.mjs` and `lib/data/animal-data.mjs` default `movement.base` to 120 (a printed value unless it mirrors core's field default); `ApplicationV2.RENDER_STATES` (import manager) and `FogManager.reset()` (New Map).
- **Refactoring backlog** (decoupling, helper dedup, one character-sheet decorator pipeline, header-band, importer splits): take an item when it fixes a defect.

## Standing cleanup passes

- **A nightly walk run with no model.** `node tools/live/run.mjs` already runs
  every walk unattended and writes the result file the release preflight
  reads. What is not built is the schedule around it: a job on the test
  machine that brings the world up, runs the whole list once a night against
  `main`, and opens one `nightly-failure` intake row per walk that did not
  pass (`.claude/rules/delegation.md`, Tier A). The schedule itself is
  machine-specific and belongs in the local test-environment file, never in
  the repo.
- **Rename the module-wide identifiers.** Low priority. The 18 lang key roots
  (`ACKS-CLASSES`, `ACKS-LIB`, and the rest of the list in `CLAUDE.md`) and the
  lib hook names (`MOUNT_HOOKS` in `scripts/lib/mount.mjs`, the storage hooks in
  `scripts/lib/storage.mjs`, `GROUP_HOOKS` in `scripts/lib/group.mjs`, and
  `acksLibGroupIsDerivedEffect` in `scripts/lib/group-logic.mjs`) are to become
  names inside the module's one namespace. `tools/validate.mjs` enforces the lang roots as they
  stand, so the rename changes its configuration with them, and every key
  consumer in `scripts/`, `templates/` and `tools/` moves in one change. The
  hook names need a check for external listeners first: another module may
  listen to them. Rename or ratify; do not rename without that check.
- **Comment sweep, strict cut: the unswept remainder.** Under `scripts/`, three
  files are not cut to the strict reading of `.claude/rules/docs-doctrine.md`:
  `importer/executor.mjs` and `importer/books.mjs` (changed by the JJ scenarios
  and JJ parties tracks) and `abilities/skill-ladders.mjs` (an unowned dirty
  line). The files the lair-maps track added or changed after the cut, under
  `scripts/` (`lib/lair.mjs` among them), have not been measured against it.
  Outside `scripts/`, `tools/`, the templates and the stylesheets
  are not in the cut. The pass's method: one agent per file list, with the
  comment-only gate proving each file's code token stream unchanged; each
  DECISIONS entry a job stages is read against the comment text it removed
  before it merges, since staged entries have invented counts, causes and costs.
- **Findings of the comment sweep, not yet fixed.**
  - *Printed values in shipped code:* `WOUND_PENALTIES` in
    `scripts/henchmen/rules/loyalty.mjs` and the henchmen figures left beside
    it (see [henchmen/ROADMAP.md](henchmen/ROADMAP.md)); literals in vehicle
    arithmetic (`seaSpeeds` in `vehicle-speed.mjs`, `repairPlan` and the
    `SHARE_SOURCES` entries for a personal and a light-siege share in
    `vessel-damage.mjs`, `#stationView` in `vehicle-sheet.mjs`). The candidates
    the cut listed for its second and fourth waves are not yet judged
    structural or printed.
  - *Printed content in tracked, unshipped files:* a masterwork bonus and price in
    the pristine-snapshot ruling of `docs/equipment/DECISIONS.md`; printed
    item strings quoted in `docs/importer/DECISIONS.md`.
  - *Code:* `bindVariation` in `scripts/importer/cookbook/variations.mjs` spreads `data`
    and `dataFields` twice (harmless).
- **A namespace key reached twice.** The API publisher settles two keys by last
  write with no manifest involved: `henchmen.rules.arrivalSplit` and
  `vehicles.OFFICER_STATIONS`. The publisher's duplicate-key rule is generalised
  once both are gone.
- **Provenance tooltips: the retrofit.** `.claude/rules/ui-tooltips.md` asks
  every figure to name where it came from. Done: the henchmen Service panel.
  A census of `templates/` on 2026-10-24 counted the lines that render a
  figure with no tooltip within two lines above it, so each count is an upper
  bound and figures assembled in scripts are not in it: about 73 lines —
  `monsters/` 15 (the stat block and the Henchman tab, which also prints bare
  `HP`, `AC` and `XP` labels outside the lang file), `formation/` 13 (most in
  the wilderness tab's camp forecast and throws), `character-sheet/` 9,
  `lib/` 7 (the follower card, the group sheet), `influence/` 6,
  `location/` 6, `equipment/` 5, `abilities/` 3, `markets/` 2, `factions/` 2,
  `vehicles/` 1. Beside them, 7 `title=` attributes (the domain realm and
  ledger tabs 4, the class, race and template sheets) and
  the tooltips assembled at render in `data-tooltip` rather than
  `data-tooltip-text`, most of them on the class sheet. A figure whose
  tooltip cannot be written goes on the bug-intake ledger as the rule says,
  not into this list.

---

## Content

- **AX2, whole.** The AXIOMS 2 adventure is not imported as a book of its own;
  AX1 and AX3 are, and AX2 gets no register beyond what the region needs of it
  ([importer/ROADMAP.md](importer/ROADMAP.md)). Whether it needs a new row shape
  is not yet asked.
- **A monster heading that is a kind in one book and a name in another.** A
  monster heading the name scanner reports against an aliased book's ring ships
  as a monster id, name and display anchor in the MM, AX6, JJ and L&E
  registers. Whether a heading one book prints as a kind of creature, and
  another book's name audit knows as a name, ships under its own words or a
  neutral label is open across books. The owner ruled it stays for now ("leave
  on roadmap for further investigation into cross-book issues"); nothing is
  renamed and no register is recompiled.
- **The scenario plans' grid distance is read at import.** `scene.grid.distance`
  on the nine plan rows in `register/jj/` (and the scenes compiled from them in
  `cookbook/jj.json`) is a figure the page prints and ships as a literal; the
  importer is to read it from the Judge's copy, and a plan with nothing read
  stays blank.

---

## Vehicles

The sub-type is `acks-extras.vehicle`, namespaced so core
[#154](https://github.com/AutarchLLC/foundryvtt-acks-core/issues/154) (open)
can ship a bare `vehicle` without a name fight; if it does, this becomes a
migration.

Not built — the feature-level list is
[docs/vehicles/ROADMAP.md](vehicles/ROADMAP.md); the headline is **war
machines** (an engine as an item with stone cost, damage class, and a crew to
lay and loose it) and the surfaces for hazards, navigation, and the sinking
clock.

## Magic

Magic's releases are [docs/magic/ROADMAP.md](magic/ROADMAP.md). Two primitives
exist ahead of what will consume them.

**A real spell primitive.** `lib/fields.mjs` `spellRefField()` is a placeholder:
it points at the core system's existing spell item by uuid and carries the
printed name as a fallback, which is enough to link and display but models
nothing about the spell itself. When magic lands it becomes a real primitive —
school, range, duration, save, reversibility, ritual/formula cost — and the
`spell` string on `effectField` retires in favour of it. It exists now so the
shape is agreed before anything depends on it.

**Spellcasting value as a conditional scale.** `lib/vocab.mjs` `VALUE_SCALES`
carries `arcaneValue` / `divineValue` so a custom-class power can state a cost
that varies by the class's spellcasting value ("counts as 1 power at Arcane Value
1–2, 2 at Arcane Value 3–4"). Nothing consumes them yet; the ability model still
stores a plain numeric `powerValue`. Wiring `powerValue` onto `levelValueField()`
is the step that activates them (magic's release 3a).

---

## The domain-module family

`location` is designed for extension by a future structures/strongholds module:
other modules store their own data in their own flag namespace on the same
location actor, and this schema stays minimal.

The "has X" fallback chain in `henchmen/facts.mjs` is the contract — owning-module
API, then actor flag, then an **inventory marker item** whose name declares the
fact ("Stronghold: Border Fort", cost = gp value), then null so the caller asks
the GM. The `domains` feature's record exists; taking over the chain's
first step from it is that feature's wave 3 ([domains/ROADMAP.md](domains/ROADMAP.md)),
and nothing else in the chain changes.

---

## Experience beyond the character

**A will's items.** Settling a will pays coin into the heir's vault only;
bequeathing named items to the heir is by hand (docs/classes/DECISIONS.md,
2026-09-30).

**A monster henchman's advancement.** Deal XP credits a monster henchman's
share onto its own flag and the Service panel shows the total
(docs/henchmen/MODEL.md). Not built: showing that the creature has enough
experience to advance, and advancing it. Both need the book's monster
advancement thresholds, which no importer recipe reads yet, so the panel shows
the credited figure alone. The importer reads the threshold first, then the
panel shows readiness as a figure with its page; applying an advance stays the
Judge's.

---

## Henchmen

**Candidate generation.** Rolled results are RECORDED today; generating the
people is a future module. The record is the interface between the two.

**The full class distribution.** Candidate class rolls currently fall back to the
core-six percentages when the full JJ double-d100 distribution has not been
imported — fighter, crusader, thief, mage, explorer, venturer. The expansion and
demihuman classes are GM endpoints anyway and simply do not appear until the
distribution is imported.

---

## Monsters

**Costing a spell-like ability by its usage.** The monster-creation table
that prices a spell-like ability by how often it can be used imports with the
creation tables when a monster builder consumes it. Nothing reads a factor
today, so none ships; the usage itself is the shared frequency vocabulary.

**The lair line reads the hex.** The Statblock's lair row rolls the chance;
what a stocked hex holds for this creature (`formation/hex-stock.mjs`) is not
read back onto the sheet, because the hex exposes no read keyed by actor. A
reading of the lair's stock and its place on the map waits on that read.

---

## Groups

The Roll sizes a group from a creature's encounter line (`docs/lib/GROUPS.md`), a
creature's encounter recipe makes the units, leaders and young the line names
(`docs/monsters/MODEL.md`, "The encounter recipe"), and a group token added to a
combat deploys the group (`GROUPS.md`, "In a fight"). The rows below are what is not
built between the encounter card and the aftermath.

**Stand Up.** Neither the encounter card nor a stocked hex point stands a group up.
The card's flag already carries the creature and the distance, so a button on it
would find the monster (`resolveCreature`, `formation/encounter-card.mjs`) and put
the token that distance from the party. A stocked point's lair would be a place
holding the group as an occupant (`point.creature`, `placeUuid`); `rollLair`
(`lib/lair.mjs`) already makes a group for a place.

**The monsters' side of detection and evasion.** `formation/encounter-card.mjs`
passes `detection()` and `evasionModifiers()` the party's side alone, so a band is
seen as one head: `monsterHeads`, `monsterTerrain`, `monstersFly`,
`fasterMonsters` and `slowerMonsters` have no caller. A rolled group gives heads
(`headEquivalents`) and its creatures' speeds (`extras.speeds`). It reorders the
card, since the number is rolled before the distance is judged, as the book orders
the two.

**Scouting and the reveal.** A scouting result does not set the reveal. Nothing in
the module produces one for a group yet: the Judge's select is the control. The
first result that can reach it is `detection()`'s `partySees`, when an encounter
card stands a group up.

**XP for a beaten group.** The XP award dialog (`formation/xp-app.mjs`) opens on a
total of zero. It would fill the total from each stack's fallen (`deadOf`) and the
XP of the creature each was.

**Treasure by unit.** Only the organisation Roll hands a lair's hoards to a treasure
pot (`docs/monsters/MODEL.md`, "The treasure hand-off"). A group sized by a stack's
own Roll deals none, and the monster sheet's draw is once per monster. The draw
would be made once for each unit the treasure line names, for a group in its lair
(JJ ch. 8 says so of dungeon rooms; the wilderness reading is unchecked).

**Base actors.** `ensureBaseActor` (`lib/group.mjs`) mints a hidden world actor for
a stack whose creature has none in the world, one for each such stack of each group.
None is reused by source or filed in a folder, and deleting the group leaves them
behind. Only the organisation chart's row delete removes the ones it minted.

**A line with no count to roll.** A side that states no count the parser reads (one
that says special, or varies by something other than its side) gives no Roll
(`lib/encounter-line.mjs`). A wandering band moved by the clock on a journey map is
not built either.

**Levelled people.** A recipe part's source is a creature, a family role cell, a
stat line or a word, never a class at a level. Building a person a line names that
way would join the henchmen and classes generators, and no feature owns it.

Supply cost and battle rating are documented in `group-data.mjs` and deliberately
unread, waiting on the domain work that would give them somewhere to be spent.

---

## The free-variable gate, family-wide

`tools/free-variables.mjs` (DECISIONS §17) is started from `validate-extra`.
Once a release has proven the gate on the Node version CI runs, `validate.mjs`
calls it itself.

## Printed option lists are imported

The lists of options a page prints still ship as lang labels, as named row sets
in `scripts/importer/table-recipes.mjs` and as frozen tables under `scripts/`.
Each is to be imported: an ordinal id, a label read from the Judge's own copy, a
blank select where nothing is imported, and the page reference as its tooltip.
Not built in the Beta. Six batches, one row each; OL-1 goes first and alone, the
rest follow it, and OL-5 follows OL-4.

- **OL-1, the shared helper and the monster sheet's four lists.** A new
  `scripts/lib/option-lists.mjs` (the locator and the id minting, once), then
  `SPECIAL_ABILITIES`, `AGE_CATEGORIES`, `TRAINED_ROLES` and `INTELLIGENCE` in
  `scripts/monsters/config.mjs`, with `ACKS-MONSTERS.*` and the monster
  recipes' stored keys.
- **OL-2, henchmen.** The troop and specialist types (`MERC_ROWS`,
  `SPECIALIST_ROWS`, `ACKS-HENCHMEN.troop.*`, `.specialist.*`), class rarity
  (`RARITY_TIER_ROWS`, `.rarity.*`), occupations, slave types
  (`.slavery.type.*`) and the beastman troop matrix.
- **OL-3, markets.** Merchandise types and environments (`MERCHANDISE_TYPES`,
  `RARITIES`, `MERCH_ROWS`, `ACKS-MARKETS.merch.*`, `.merchandise.env.*`),
  moorage, stabling animals (`.ventures.stay.animal.*`) and workers
  (`.commissions.worker.*`).
- **OL-4, weather and sea.** `ACKS-FORMATION.travel.weather.temp.*`, `.precip.*`
  and `.cond.*`; `ACKS-VEHICLES.wind.*`, `.water.*` and the reason keys beside
  them.
- **OL-5, terrain and encounters (after OL-4).** `ENC_TERRAIN_ROWS`,
  `ACKS-FORMATION.travel.enc.terrain.*`, the vehicle `TERRAIN` list and the
  travel terrain multipliers, with the encounter and travel recipe blocks.
- **OL-6, classes and equipment.** The chargen methods (`METHODS` in
  `scripts/classes/stat-page.mjs`, `ACKS-CLASSES.chargen.methods.*`) and the
  shield variants (`SHIELD_VARIANTS` in `scripts/equipment/config.mjs`, a second
  copy of a list the importer already reads from JJ pp. 409–410); the
  `ACKS-CLASSES.builder.magicHint` string, which copies an imported list, is
  reworded.

---

## Book text still in comments and lang strings

- **Comments that quote a book sentence.** The 2026-09-23 quote audit cleared
  equipment, formation and lib; what remains sits mostly in the importer, with
  a few each in classes, location, markets, henchmen and influence. Many
  importer hits are compile anchors, which are structural, so each hit needs a
  reviewer's call rather than a sweep.
- **Lang strings a user reads that print a figure.** Influence, henchmen,
  formation and equipment still hold keys whose text states a number. Each key
  is ruled printed (it moves onto the import, `acks-printed-value`) or
  structural (it stays), after a recount against the 2026-11-11 imports.
- **The IP sweep's printed values stay on their own rows.** A value the sweep
  found that already has a row in a feature ROADMAP or in the importer's keeps
  it; none is restated here.

---

## Tool permissions that still read the seat's role

The rule is [DECISIONS.md](DECISIONS.md), 2026-11-26. Each feature's own rows are in its ROADMAP; this is the
one that crosses them.

- **A role test where Foundry has a permission a world can grant.** Reads across the module answer
  `game.user.isGM` where Foundry asks `game.user.can(...)`: Create Actors, Create Items, Create Tokens, Delete
  Tokens, Upload Files, Configure Settings. Each agrees with Foundry on a default world and refuses what a Judge
  grants in Configure Permissions. Most are the importer's and the party sheet's; markets, scene search,
  treasure, battlemap, classes, domains, lib and monsters hold a few. Of the same kind: a place sheet's
  Contents → Add child place and the Scene config's Place row "+", whose siblings Split and the storage
  manager's Create vault already read Create Actors, and a place sheet's Recruitment → Advance week, which
  writes the world's time. A world that grants nothing sees no change; a builder enumerates at its own base.

---
