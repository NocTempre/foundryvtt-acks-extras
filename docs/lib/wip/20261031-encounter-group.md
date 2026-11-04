# The encounter group: a monster party on the map (wip)

**Status: PROPOSAL — NOT IN EFFECT.** The feature map for the owner's
2026-10-31 request: the monster version of the party token, an actor a Judge
drops a monster into and rolls into a group by the creature's ecology, wandering
or in its lair, leaders and young included. Nothing below is MODEL until
adopted. As each slice lands its substance moves into `docs/lib/` and
`docs/monsters/` (`docs/formation/` for the chain's hand-offs) and this file is
deleted with the last of them (`.claude/rules/docs-doctrine.md`, wip lifecycle).

This reverses two standing lines: `docs/lib/GROUPS.md`, "Ecology runway — READ
only, deliberately unimplemented", and `docs/ROADMAP.md`, "Groups", which parks
the same seams on the domain work. The new evidence is the owner's request: the
runway's own condition was that the Judge decides when a group is sized, and a
Roll button is that decision. Both lines are rewritten by the slice that lands
the Roll.

## 1. The ruling: a group, not a new sub-type

**An encounter is an `acks-extras.group`.** The party is its own type
because a formation record holds its state and the actor is a stub. For monsters
the group already is the record, so a new type would add a document with no new
state to put in it.

| What the party token does | What already answers it |
|---|---|
| One token stands for many bodies | `group.mjs` + the representative block mirrored from the first stack |
| Mixed bodies | `system.stacks`, one per kind of body |
| A headcount every feature agrees on | `bodyCount` |
| Bodies take the field and come back | `deploy` / `recall`, folding deltas, fallen become casualties |
| Hurt or dead bodies are remembered | the sparse roster, `applyCasualties`, `reconcileDeletedToken` |
| A collective noun | `system.noun` |
| Morale with a commander | `unit.morale`, `officerMoraleBonus`, `commandMorale` |
| Promote one body to an actor | `detach` |
| Stands in a party's marching order | `isStackMember`, `cellBodies` (a charmed or hired band needs nothing new) |
| Stands in a place | `lib/place.mjs`, `OCCUPANT_KIND.GROUP` |

`GroupSheet` renders one `body` part and already takes an Actor drop as
`addStack`, so it hosts the Roll without a second sheet. `unit.category` defaults
to `monster`, which is the switch for hiding the mercenary rows (troop type,
loyalty, the purse). The sheet shows them on every group today.

**Alternative: `acks-extras.encounter`, `EncounterData extends GroupData`.** It
buys a named entry in the Create Actor dialog and its own default sheet. It costs
a world relaunch (`documentTypes` is read at launch), widening `isGroupActor`, and
the literal type tests in `place.mjs`, `hp-logic.mjs` and the henchmen engine.
**What would force it:** state that cannot sit beside a mercenary unit, or a sheet
that shares nothing with a stack list. Neither is visible today. The Create-dialog
name is the strongest argument for it, and a Make Encounter tool on the monster
sheet answers that gesture without a type.

## 2. How much a roll has to do

Sorted by shape over the 287 monster entries that print encounter lines (MM,
monster entries). Coarse signal counts that size the work and prove no parser.

| Tier | Entries | What the roll does |
|---|---|---|
| A | 96 | A quantity of one body |
| B | 145 | A quantity plus extras: young, companions, a rolled branch |
| C | 41 | Organised: units of units, leaders, dependants as a share of the fighters |
| D | 5 | The line says special, or varies by another axis |

Non-exclusive features: young with a number 152, other creatures present 57, a
rolled branch 56, a leader named 51, a unit-of-units line 37, a ratio or
percent-of 26, a levelled person or caster 26. At sentence level, 168 of the 169
sentences read as composition fall into nine shapes, though the buckets are broad
and a real parser will do worse. Entries print 84 inline stat lines on 58 pages,
the creature's own included, so that is a ceiling on what a line can mint; a
young body's figures also arrive as a sentence of ecology prose, which `bindNpc`
does not read.

## 3. Feature map

**R** reuse as it stands, **X** extend, **N** new.

### a. The actor and its token

- **R** The type, stacks, headcount, Actor drop.
- **X** Token defaults at the Roll: linked, hostile, the monster's art, a name
  built from noun and creature. `ensurePartyActor`'s `prototypeToken` is the
  pattern. An unlinked group would write its stacks to a delta.
- **X** `GroupSheet`: show the Roll where a stack has a monster behind it, and hide
  purse and unit rows on a monster category. Seven `title=` attributes on this
  sheet are the tooltip retrofit's (`ui-tooltips.md`) and go in the same change.
- **N** A folder for encounters, as `generatedFolder` does for generated actors.

### b. Drop a monster in

- **R** `GroupSheet.#onDrop` → `addStack`; a drop onto a stack re-points it.
- **X** Dropping a family template picks a variant first. `#onDropItem`'s refusal
  stands.
- **N** Make Encounter on the monster sheet's tools rail, so one press gives a
  group with this creature in it, sheet open.

### c. The Roll

- **N** Two choices: dungeon or wilderness (defaulted from the scene and any party
  on it), wandering or lair. A third control rolls the lair chance, which is the
  book's own step (JJ ch. 2, the encounter procedure); the monster sheet's `lair`
  action already rolls it and is lifted to a shared reader.
- **X** `sizeFromEcology(source, context)` reads `wandering || lair`, so it cannot
  answer "in lair". It takes a state argument rather than a fork.
- **X** `rollDice` (`encounters.mjs`) refuses multiplied dice; extend it.
- **R** `postToJudges` for one whispered card with every step shown, the door-helper
  idiom `encounter-card.mjs` already follows. `encounterShift` / `scaleNumber` for a
  monster met on the wrong floor, once `encounter-scaling.mjs`'s hardcoded rate moves
  out (`docs/formation/ROADMAP.md`).
- **N** Re-roll replaces only stacks a roll made, and refuses while a body is out or
  fallen.

Every count carries a tooltip naming its parts and page (`ui-tooltips.md`, "Computed
by the module"). A part the roll could not resolve is shown as not imported, never
filled.

### d. The recipe: the structure that ships

The procedure ships and the values import (`ip-doctrine.md`). New field
`extras.encounter.recipe`, world data only:

```
part = {
  key, label, role,        // role: body | leader | young | dependant | guard | captive | caster
  source,                  // { uuid } | { templateCell } | { stat } | { name }
  count,                   // { dice } | { literal } | { ratioOf, percent, round } | { perUnit, of, each }
  chance,                  // percent, null for always
  when,                    // wandering | lair | settlement, and dungeon | wilderness
  branch,                  // one-of group and band, for a die that picks one row
  moraleWhileAlive,        // a bonus while this part lives
  cite
}
```

The shapes this covers: a fixed count, dice, multiplied dice, a share of another
part, an allowance per unit, a percent chance of a part, a die choosing among parts,
one part splitting another (a share as archers), and a part that exists only in one
state.

**A unit is recursion, not a count.** A line of the form `<noun> (<dice> <unit>)`
rolls that many units, each sized by the line whose noun is that unit, on either
side of the entry. Leaders key on units, so the tree must survive to the part step
before it flattens into stacks.

- **N** `scripts/monsters/encounter-recipe.mjs`: pure, Node-evaluable, `rng`
  injected, the shape of `stockHex`. Input a recipe and a state, output the unit
  tree, part counts and every step.

### e. The importer

- **N** `scripts/importer/ecology-recipe.mjs`, following `proseLeaderRoles`: regex
  locators ship, every number is read at import from the seat's own text. It reads
  the paragraphs `monsterProseChannels` already routes to `ecology`, and it adds
  nothing for a sentence it cannot read.
- **R** `importFamily` role cells, and the `.leaders` template an entry outside a
  family gets (monsters MODEL, "Leaders outside a family"), as leader sources; `statLineCreature` and `bindNpc`
  to mint a body from a stat line; `extras.variants[]`, which the Ecology tab edits
  and nothing else writes or reads, as the link from a creature to its young and
  leaders.
- **R** `resolveCreature` for a part naming another creature; a miss is a labelled
  stack with no stat block.

### f. The Judge's tools

A release ships the tool for what it adds (`CLAUDE.md`, Release), so the recipe gets
an editor on the monster sheet's Ecology tab beside Variants, in the same slice as
the schema. Rows, not free text: a hand-built monster can be rolled too, and a wrong
import can be corrected. Beside it, the ecology prose the importer read, so a Judge
sees what it left out.

### g. Turning parts into stacks

- **X** Stack fields: `role`, and whether it fights. `extras.noncombatant` exists for
  the creature; a part can override it. `addStack` takes a count and a role.
- **X** Template generation lives inside `TemplateSheet.#onGenerate`. Lift it over
  `chooseAxes` + `resolveActor` so a role cell becomes a stack source. `stackFromSource`
  wants a document, so it gains a plain-payload form.
- **R** Every body rolls its own hit points. A rolled stack stays pristine, with no
  hit points of its own, until `materializeMembers` gives each body its own roll of
  the stack's `hp.hd` as it first becomes individual. The Roll must not write one
  figure for a whole stack.
- **X** `rollBodyHp` always rolls `hp.hd`. A printed leader's hit points are a fixed
  figure on the role cell, so such a stack keeps its snapshot's value.
- **X** `ensureBaseActor` mints a world actor per compendium stack, and its
  `templateFor` flag is written and never read. One roll per encounter turns that into
  litter: reuse a base by source, file it in the folder, and remove it with the group.
- **X** `system.noun`: `GROUPS.md` says the stat block fills it, and nothing does. The
  Roll writes the state's noun.
- **N** Levelled people (26 entries) are a labelled stack in the first slices. Building
  them joins `henchmen`/`classes` and has no owner yet.

### h. In the fight

- **X** `deploy` with `place`, per stack, leaders first and non-fighters left in the
  token. `formation/deployment.mjs` is formation-bound, so the block layout is lifted
  to lib only if a second caller needs its exact shape.
- **Built** Adding the token to a combat deploys the bodies, and ending it recalls
  them: `GROUPS.md`, "In a fight". The owner ruled the whole group, so the plan to ask
  how many is dropped (`DECISIONS.md`, 2026-11-03).
- **X** `commandMorale` derives from a living part's `moraleWhileAlive`. Derived, so a
  casualty needs no second write.
- **R** Core's Surprise Matrix, the influence feature's reaction roll and its existing
  lair modifier (`influence/constants.mjs`).

### i. After the fight

- **X** `xp-shares.mjs` / `xp-app.mjs`: prefill the total from `deadOf` and each stack's
  own XP.
- **N** Treasure: draw the linked table once per the unit its line names, for a group
  in its lair (JJ ch. 8 states this for dungeon rooms; the wilderness reading is
  unchecked). Today the monster sheet draws it once.

### j. The chain's hand-offs

- **N** A Stand Up button on the encounter card, listening the way `poi.mjs` and
  `navigation-card.mjs` do. The card's flag already carries creature and distance, and
  `resolveCreature` finds the monster. The token lands at the card's distance from the
  party.
- **N** The same from a hex-stock point (`point.creature`, `placeUuid`): a lair is a
  place holding the group as an occupant.
- **X** `detection()` and `evasionModifiers()` have monster-side inputs no caller passes
  (`monsterHeads`, `monsterTerrain`, `monstersFly`, `fasterMonsters`, `slowerMonsters`).
  A big band is therefore seen as one body. With a rolled group these get real heads
  through `headEquivalents` and real speeds from `extras.speeds`. It reorders the card:
  the number is rolled before the distance is judged, which is the book's order.
- **R** A zone table's drawn row (`documentUuid`) is a drop by another route.

### k. Not in the first cut

The optional organisation rules (special troops, tribal traits, optional equipment);
a roll on a template's other axis (tier D); a wandering band moved by the clock on a
journey map, the party's travel half; mass-combat routing of an attack on the stack,
already `GROUPS.md`, "Boundaries".

## 4. Build order

The line parser this builds on landed first: `docs/monsters/MODEL.md`, "Encounter
lines". Each slice ships usable; the tier is what it reaches.

| Slice | Delivers | Reaches |
|---|---|---|
| 1 | Landed: `GROUPS.md`, "The sheet", "A row moved between groups", "The Roll" and "The reveal" | A, and B as a bare quantity |
| 2 | Recipe schema, engine, Ecology-tab editor, units of units, parts into stacks | B and C, Judge-authored |
| 3 | The importer writes recipes: young, leaders, ratios, branches, role XP | B and C, imported |
| 4 | Fight: deploy count, combat bridge, morale, non-fighters stay in | |
| 5 | Stand Up from the card and hex stock, the detection and evasion feeds | |
| 6 | XP prefill, treasure by unit | |

## 5. Verification

- **Offline:** `tools/test-encounter-recipe.mjs` on the pure engine. A rolled die's size
  is asserted, not only its result (a suite that supplies the roll hides a wrong die).
- **IP:** test fixtures are invented sentences with invented names, never book text. The
  parser's coverage against the local reference runs from a local tool that stays
  uncommitted. No figure enters `lang/` or source; `ip-scan` says nothing about that, so
  it needs a reviewer every slice.
- **Live:** `docs/lib/TESTING.md` gains the recipe and `tools/live/` a walk. Import a
  real creature, press the real drop and the real Roll, deploy, fight, recall, and read
  the writes back. A player seat confirms the sheet and the card stay the Judge's. A
  release shot comes from that path, never an API-built group.
- **The window:** every new control at the raised type size, and a second sheet open
  (`ui-layout.md`).

## 6. The owner's rulings (2026-10-31)

1. An encounter is a group, as §1 proposes.
2. The Roll writes stacks at once. Every count is then editable on the sheet, and the
   card shows the work.
3. What a player sees of the token depends on scouting: the noun with no count, or the
   name and the count. The Judge's reveal, and whether scouting sets it, are Slice 1's
   to design. Designed: `GROUPS.md`, "The reveal"; the link to scouting is
   `docs/ROADMAP.md`, "Groups".
4. Each body rolls its own hit points (§3g).
5. (2026-11-01) The group sheet reads as an inventory, its entries draggable: a row
   dragged onto the map deploys, and a row dragged onto another group moves. That move
   needs the split and merge `GROUPS.md` lists as not built. A stack stays one row with
   its count and the bodies holding a record nest under it, as proposed and not
   overruled, since a row per body would mean a record, and a hit-point roll, per body.
6. (2026-11-01) The Roll is per monster, not the whole group. Each monster's row has its
   own, a press rolls that monster alone, and a re-roll replaces only what that monster's
   roll made.
7. (2026-11-01) A row's drag onto the map takes the whole stack: "the row and those
   beneath it", "as in a subgroup".
8. (2026-11-01) A row dragged onto another group moves the same subgroup, its fallen and
   detached records with it, and the seat must own both groups.
