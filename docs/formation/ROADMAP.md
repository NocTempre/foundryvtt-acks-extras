# Formation — not built

Re-issued 2026-11-14.

What the formation feature does not do yet: the rules it does not automate, the
mapping system's remainder, the wilderness and settlement gaps, the printed
values still in its code, and what the party sheet leaves. How it works now is
[MODEL.md](MODEL.md); the rulings are [DECISIONS.md](DECISIONS.md); the fog
architecture is [FOG.md](FOG.md).

Legend: 🟡 partial or assisted · 🔧 needs development

---

## 1. Rules not yet automated

| Rule | Status | What is missing |
|---|---|---|
| Running fatigue, winded from running | 🔧 | Only the winded state from five turns without rest is automated. Per-round running fatigue (a Paralysis save after a CON-adjusted number of rounds, Endurance's allowance) is a combat-scale rule: it needs a combat-round hook and the save automation. Low priority; fights rarely last that long. |
| Corridor-width formation (RR ch. 6, Marching and Mapping) | 🟡 | The party marches as a column and squeezes where a wall shuts a file out (MODEL "The column"). What remains is a per-formation toggle to march unsqueezed. |
| Mapping proficiency's secret error-detection throw | 🔧 | A Judge-only party check, `kw:mapping`: rolled for a mapper who can work and holds the proficiency, when the map and the ground disagree. One more Judge-only entry in `PARTY_CHECKS` (`party-rolls.mjs`), resolved as the other party checks are (MODEL, "The party check's throw"), with the result shown to the Judge alone. What the proficiency changes today is read by the mapping verdict (MODEL, "Mapping"). |
| Earshot and noise | 🟡 | Left to the Judge's adjudication; nothing automates it. |
| Wandering monsters: number appearing and reaction adjusted by the dungeon and monster level difference | 🟡 | The Encounter Zone carries the dungeon level, a table carries a monster level (`encounter-scaling.mjs` `LEVEL_FLAG`), and a Judge-only card states the multiplier and rolls the reaction (MODEL "Turn tick"). Nothing scales unless both levels are set. Not built: the importer half, the by-level tables and the dungeon-level matrix of the Judges Journal registered so the materializer stamps each level table with `LEVEL_FLAG` and a matrix shifts with no typing. The rate itself is in §6a. |
| Surprise in the encounter procedure | 🔧 | The party's surprise roll against the monster, with light-source penalties and the noise interaction. The proficiency bonuses that modify it are read; the procedure they modify is not automated (core's Surprise Matrix stands, and detection states guide it). The reaction half belongs to the influence feature. |
| Spelunking, squeezing, swimming, jumping | 🟡 | Each is its own derivation published on `api.formation` (`obstacles`, `swimming`, `jumping`) and tested. None has a UI surface: nothing in the party sheet asks the party to cross anything. One surface for all three is the next piece of work. |
| Sequence of play, steps 2 to 4 | 🟡 | Stationary actions, traps and deliberate encounters are Judge-driven with helpers. |
| Strenuous ancillary activity per delve hour (RR p. 21) | 🟡 | The wilderness day board carries an ancillary budget; the delve does not model it. |

## 2. The mapping system

Still unbuilt, in likely order:

- **Auto-suggest anchoring.** Pixel-test the party's position against a held
  Map item's bitmap and offer the anchor (anchoring stays the Judge's call).
- **Bake-Regions-to-bitmap** for partially revealed merchant maps.
- **An optional `_unionizeSharedExploration` override** so anchored items
  survive core fog resets.

## 3. Other open work

1. **Traps: the disarm-or-discharge choice is asked of the wrong seat.** The
   book gives it to whoever made the throw; the throw runs on the Judge's
   client, so a player who declares an attempt has the Judge answer for them.
   Fixing it means a second socket round-trip back to the declaring user, held
   open while the Judge's client waits.
3. **Obstacles, swimming and jumping have no surface** (§1).
7. **Wilderness mode: per-kind road refinement.** The road table is read from
   the Rulebook; the Judges Journal's per-kind road refinement does not
   replace it yet. An importer recipe and a binding read are owed.
11. **An unlinked member inside the party token is read from the world actor
   in everything but hit points and death.** Their items, effects, rolls,
   lights, rations and experience all go through `getMemberActor`, which
   returns the world actor, and a stash has no document to write to. Reading
   them from the stash needs an actor built from it, and a write path that
   lands in the stash, as `adjustStashedHp` does for hit points (MODEL, "Data
   flow"; DECISIONS 2026-09-23).
12. **Dividing coin and treasure among the party.** Experience divides across
   the party's members by a shares rule (`divideXp` in
   `scripts/formation/xp-shares.mjs`, a henchman's share read from its own
   record, else the imported one). Nothing in formation moves coin or divides
   treasure. Not built: a split of a find or a hoard over the members the party
   names, which would move the coin through `transferCoin` in
   `scripts/lib/money.mjs`. Whether the split is equal or by share is a ruling
   this file does not take.

## 4. Land travel: not built

| Rule | State | Note |
|---|---|---|
| Hex-click tool and a Region overlay for the stock | not built | The Wilderness tab's Points of interest section is the surface, and a Region per hex was rejected (DECISIONS 2026-10-09, *A hex's stock lives on its map*). |
| Climate by terrain | not built | The monster sub-tables stay a terrain pick (DECISIONS 2026-10-09, *Climate does not pick the monster sub-table*). |
| `lost.mjs` `hexKey` duplicates `battlemap/terrain-paint.mjs` `hexKeyOf` | defect | One key, one owner. |
| Carrying the stock into a promoted place's notes | not built | |
| Substituting only a share of the lairs | not built | `substitute` rolls every lair on the bands, which is the page's own worked example; a cap on the share is the Judge's by hand. |
| Moonlight on the card; measuring along waypoints; two journeying parties on one clock; voyages | not built | Named out of scope by the movement ruling (DECISIONS 2026-10-09, *A drag on a journey spends miles*). |
| The navigation throw at the halt after an evasion | not built | The rules price it apart from the day's throw. The Judge throws it by hand with the Judge tab's Throw now, which also counts as the day's throw (DECISIONS 2026-10-16). |
| A calendar reminder that a hex's stock is old | not built | `hexStockView`'s `stockedAgo`, the age the Points of interest block says, is the reading it starts from. A restock stays the Judge's gesture, with its confirm (DECISIONS 2026-10-16). |
| The sky under a lost party, read at the true hex | not built | The day change and Roll now read the climate of `travelOf`, the hex the party believes it is in, where the shadow-token ruling (DECISIONS 2026-08-29) has the weather read the truth; `trueTravelOf` is the reader the encounter column already uses. |
| The day's claim across two GM clients | not built | `claimNavigationDay` locks on its own client, so two GM clients each stepping the party in one day can each throw once; one active GM is the premise (MODEL "The navigation throw"). A claim written to the setting and compared on read-back is the shape. |
| The plate's crop off a background that does not fill the scene | not built | `paintPlate` crops the scene's background as if it filled `sceneRect`; a background placed, scaled or tiled off it draws the wrong ground under the cell. The level's background placement is the input the crop lacks. |
| The faked reveal when the active GM is viewing another scene | not built | A drag walks the truth from the active GM's client and paints the reveal only where that client has the scene's fog texture drawn (`canFake`); a drag made while it views another scene records the faked hexes and paints none until the next walk made with the scene viewed. A paint routed to a client viewing the scene, or deferred to its next view, is the fix. |
| Sea encounters | not built | The sea voyage encounter tables (Judges Journal ch. 2, the sea civilized and sea monster grids and their nautical follow-ups) have no recipe, no binding and no pick: `ENCOUNTER_TERRAINS` holds no sea entry, so the chain cannot be stood at sea, and the treasure-by-terrain lookup's ocean row is read by nothing. Voyages themselves are out of scope above; the tables are the import half, which ships first (TOOLCHAIN §10e). |
| Encounters while asleep | not built | `slumbering` (`lib/conditions.mjs`) applied to a party met asleep and lifted by the insert's three endings (*Wilderness Expeditions I*). |
| Who saw whom after dark | not built | The encounter card's sight lines read the daylight figure at every hour (`postEncounterCard`), because the three night lights need a moon that nothing in the world declares. A party met at night is told it saw, or was seen, by daylight. A lunar source, or a Judge's per-encounter light pick, is the missing input. |
| A hazard's trap equivalent | printed, not placed | The card prints the row's `trap` beside the hazard; placing the equivalent trap on a battlemap is the Judge's (DECISIONS 2026-10-09, *The insert pages' rules ship with the major*). |
| Visibility of terrain and of a fire | partial | `visibilityMax` scales the imported light figure by the formation-size ladder; the insert's two rows that are not formations have no consumer, and raising the distance by elevation is the Judge's (*Wilderness Expeditions I*). |

### The settlement

| Not built | What it is |
|---|---|
| A city list routing several bands | The map states a single stretch and the district a single special list (MODEL "A city list can hand its roll to the quarter"). A list with several routed bands, each to its own sub-table (JJ ch. 7 Step 7), wants the band to become a list of `{from, to, table}` on the map, and the world's own imported list to take one as well. Core RollTable nesting still covers static routing. |
| The rest of JJ ch. 7 Step 5 | A settlement's dynamic buildings and the per-shop availability fractions are printed figures with no register yet; the place a point of interest is has the `market` subtree to receive them when they arrive. |
| A quarter left and re-entered is asked again | `applyHunt` asks once per quarter (`huntRegion`), so a turn on a building's map with no district clears `huntedBy` and keeps `wanted`, and walking back out into the quarter asks it again: a hunter the Judge unticked marks the party hunted once more. A city's buildings are their own maps (DECISIONS 2026-10-28, "A city's buildings are the city"), so this happens at every door. It needs a ruling: the quarter's ask remembered across a building, or a building's map read as the quarter it stands in. |

## 5. Rulings taken 2026-08-29: what remains

| Work | State |
|---|---|
| Route tax: a path's own encounter profile | not built. `routeCost` reports the tax apart from the speed multiplier; the path's encounter profile is not modelled. |

## 6. The door numbers leave the module

`doors.mjs` holds printed values in code: the bash target, the
Strength, pair, crowbar, size and spike magnitudes, the spike cap, the botch
damage, and `DOOR_KINDS`, which is RR ch. 6's door grid retyped (with a
"portcullis" row the books do not print). Ruled content, not structure:
[DECISIONS.md](DECISIONS.md). Two steps, importer first, since extras cannot
read a table no world can supply.

| Step | Where | Work |
|---|---|---|
| 1 | importer | An RR ch. 6 recipe: the door grid through `assists.grids` with `ac` / `shp` columns (as the sea table on p. 319 already does), the batter-down turns per construction, and the bash modifiers as `from: {pattern}` reads out of the section's prose. Ch. 6 has no register file yet, so the page range is new; the extraction shape is not. |
| 2 | formation | `doors.mjs` reads a `doors` document via `getDoc` / `expectTables`, as `classes/hitpoints.mjs` does. `bashPlan` keeps its shape; only the magnitudes are passed in. |

Without an imported table, bash and batter refuse and say so, while every
structural door gesture (open, close, lock, spike, unspike, evil doors) keeps
working. There is no identity value for a missing throw target, and falling
back on a remembered target would reinstate the value the ruling removes. This
file and `doors.mjs`'s module docstring state the magnitudes in prose; they are
cleared in the same pass.

## 6a. What else in formation still holds printed values

Each needs its own ruling, and no gate can make it: the structure/content line
is a reviewer's call by design (`.claude/rules/ip-doctrine.md`). Roughly worst
first:

| Where | What | Note |
|---|---|---|
| `party-rolls.mjs` resolver | the methodical-use bonuses, the proficiency bonus magnitudes, a substituted throw target | The worst by doctrine: each is a magnitude the book attaches to a NAMED proficiency a reader picked, so each already has an owner, the character's own imported ability. `ability-bridge.mjs` already resolves imported ability terms; what is missing is a granted-modifier read, not a subsystem. |
| `trap-rules.mjs` `CRUDE` | the crude-trap modifiers (find, remove, attack, save) | Printed in the Judges Journal's trap chapter and no recipe reads them yet. The reaches, the trigger die and band, the botch bands, the methodical bonus and the pit's dice are imported (DECISIONS 2026-11-13). |
| `formation-model.mjs`, `formation-view.mjs`, `deployment.mjs` | the combat-speed ratio | The exploration-speed bands are read off the system's own movement calculation (`lib/capacity.mjs` `explorationSpeedBearing`), and the blinded share is imported (`blindedSpeedShare`); the combat ratio is not. |
| `travel.mjs` `rollLandNavigation`, `navigation-card.mjs` | the natural result on which a navigation throw fails whatever the bonus | `navigationProse` reads only the competence bonuses; the failure band needs a window on the same page and a binding read. |
| `weather.mjs` `frontShift` | the size of a front's drift and the natural results it exempts | The weather recipe holds no fronts window; it needs a new recipe row and a binding. |
| `provision-day.mjs` `weatherToll` | the fatigue a failed heat throw adds | `heatProse` is read whole for the armour threshold and never for this count. |
| `deployment.mjs` leash, `lang` `app.leashed` | how far a detached member may range ahead of the party | No printed rule found for it (RR ch. 6); a house limit, so removal is a behaviour ruling. The `detachHint` string does not state it, but MODEL and the guide do. |
| `encounter-zone.mjs`, `district-zone.mjs` | the schema's `max` on the encounter target and throw-count fields | The die the target is thrown on, written into a field bound. The delve die is imported; the bound needs the same reading. |
| `constants.mjs` `ROLE_GEAR` | the parchment fallback's cost | A printed price in the fallback item's data. |
| `obstacles.mjs` `OBSTACLES` | each obstacle's vulnerability and movement type (`vertical`, `descendOnly`) | Cells of the Spelunking grid whose failed- and botched-throw rows import (`spelunkingOutcomes`). The next row of that recipe; `tools/test-obstacles.mjs` asserts the vulnerabilities and moves with them. |
| `encounter-scaling.mjs` | the number-appearing rate per level step and the reaction step | Pass them in, as `jumping.mjs` takes its figures. |

Ruled STRUCTURAL and not to be stripped: see DECISIONS, "Three printed figures
leave the module; the rest are inventoried" (2026-09-02).

## Other open rows

- **The night, and what a night restores.** The night's fatigue and
  armoured-sleep clocks are built (`lib/fatigue.mjs`, `formation/rest.mjs`).
  Missing: a rest-now prompt; a night restoring castings (`restPools` in
  `classes/casting.mjs` is not called from `formation/rest.mjs`); and a day
  restoring hit points, which a night does not. ACKS II has no watch
  procedure (standing watch is an activity, not a throw, and the Surprise
  Matrix takes no watch input), so a watch roster would be invention and is not
  planned. Every hour count and healing die is a printed value: the importer
  recipes ship first and this degrades by refusing to adjudicate, never by
  defaulting. `survival.mjs`'s `naturalHealing` forbid has no consumer until
  the day's healing exists.
- **One owner for chat visibility.** `lib/roll-audience.mjs` `postToJudges`
  covers the card meant for the Judges alone. The public/private split of a
  card is still its own in `initiative-card`, `surprise-card` and
  `influence-app`. Wants one `lib/` helper taking an explicit policy (`secret`,
  `declared`: a public notice naming the actor plus a whispered result, or
  `public`) absorbing all of them. **Traps take `secret` explicitly**, stated in
  the helper's own docstring: a trap crossing has no declaration, and
  announcing that the party checked is the leak the 2026-08-18 secrecy ruling
  exists to prevent.
- **The party's position is its centre, not its corner.** `clock.lastPosition`,
  the trap check's `from`/`to`, the halt's back-out and the scouts' leash all
  pass the party token's top-left corner around, so any change to the token's
  size moves the coordinate everything measures from. `syncPartyTokenSize`
  re-baselines the clock after each resize; a centre-based position would make
  that unnecessary and would stop a frontage edit from reading as a step. It is
  a change to the trap geometry, not to the clock: `trap-zone.mjs` converts
  corner to centre and back at three seams that would collapse. The journey's
  miles (`journeyMilesBetween`) measure the same corner, so the same change
  moves that seam too.
- **A sunrise the book supplies.** The dark's bounds are two world settings
  standing at the day's quarter points (DECISIONS 2026-09-30, "The city's hour
  follows the world clock"). A season table that printed sunrise and sunset
  would arrive through the importer and write those two settings by season;
  no page this feature reads prints one.

## Scoped effects for ability matching

The ability bridge does not yet wrap the lib's `scopeApplies` or
`nonStackingGroups`. `scopeApplies` answers when a modifier applies, and this
feature cannot use it until it consumes cookbook `effects` instead of its own
hardcoded bonuses, because until then no scoped effect reaches the pipeline
for it to gate. When it does, `undetermined` is not `false`: an unsettled scope
surfaces as a manual toggle rather than silently dropping the bonus.
`nonStackingGroups` stays unnecessary while every capability here is consumed
as a boolean.

## Figures the feature reads that no import writes

`tools/validate-producers.mjs` checks every ruledata read against what the
importer and its bindings write. This one has no producer, and is waived there
against its line below.

- **The street encounter list has no recipe.** `settlementEncounter` reads
  `cityTravel.encounters100` when no RollTable is handed in. A Judge can author
  it through the Ruledata Browser's absent row; no import writes it.

## The party sheet: what the frame leaves

The frame's later phases are `wip/20261014-party-sheet-redesign.md` §7 until
each one lands.

| Not built | What it is | What it needs first |
|---|---|---|
| The Camp tab | the Camp tab, gold, while camp time is on; needs the camp-time state | the camp-time state (the redesign's phase 4). Until then camp is a section of the Wilderness tab and End day stays at that tab's head. |
| The city's stay bar | The City band's bar reads the turns since the last rest, as the Dungeon's does; the redesign's city bar fills with the days credited to a stay. | a figure for the bar to fill against: the board credits days (`creditHoledUpDays`) but keeps no stay's length. |
| The light cell's press | The light figure opens the Kit tab in every mode; the design canvas names the clock as that cell's press. | a ruling between the two, and a clock control for the press to reach. |
| Tweaks' other contents | Tweaks holds the encounter table alone. | what else a party's tweak could hold. |
| The day-declared chip | The canvas draws a gold chip while the day is declared. | a stored state: `travel.day.declared` is a submit marker and is never kept. |
| A name for every older control | The frame names every control it adds, but the bodies it carried over keep controls a screen reader announces only by their kind: the Order tab's member arrows and blank-row remove, the Kit tab's light and spell pickers and their removes, and the requests section's pickers. | an accessible name each (a label, or an `aria-label` from the lang file). |
| A window height the user set | The sheet opens at its content's height (`height: "auto"`, the character sheet's opening), and core re-fits an auto-height window to its content on every render and tab change, so a window the Judge shortened springs back at the next field change. | a ruling: a numeric opening height at the type scale, re-fit only when the panel folds, or a height remembered per user beside the panel flag. |
| The arrival on another scene | Placing the party token on a new scene re-reads the map (`refreshCountryOn`) but leaves `travel.hex` as the old scene's, so the first drag counts a crossing against an offset from elsewhere; on the module-created path the refresh can run before the token's linkage is written and pass the party over until it moves. A halt's or a resize's move, which the token hook passes over, re-reads nothing. | the arrival seating the hex as a drag does (`seatJourneyHex`), once the linkage is written; a ruling on which passed-over moves are moves. |
| The cadence carry across territories | `day.cadenceCarry` banks miles under one territory's cadence and spends them under the next's unscaled, and a grid step leaves a miles carry to fire later. | a ruling: rescale the carry at the border, or clear it. |
| The strip's next-hex line | The design names the hex ahead of the party on the strip; nothing in the record says which way the party is heading. Under unknown country it would hide with the hex label. | a heading the party walks: the token's rotation, or the Judge's word. |
| A carrying rule on another seat | A seat that does not own a member reads their borne weight (MODEL "Conveyance"), so a member a harness, a bundle or a shield variant lightens can read a tier slower there than on the Judge's seat. | the equipment feature's correction reachable from a seat core gave no figure, without formation importing a sheet's module. |
| A free carrier across parties | A carrier nobody rides goes to whichever of its player's parties meets a dawn first (DECISIONS 2026-10-31, "What carries a member is arranged"). | a test on party membership, or the owner's word that ruling 2a stands as read. |
| The redesign's later phases | measure on the Judge's tab (phase 2; the rest of it is built, MODEL "The country", "The plate", "Lost" and "The navigation throw"); the day's boxes and their confirm, camp time's night rows, Make camp and Break camp (phase 4); the train's groups, with the owner's needs for a player's own (phase 5, the plan's §4f); the sightings feed's flags, reveal and count badges (phase 6); combat and night as gold states, and the Dungeon tab's own lights and spells sections (unscheduled). | each phase's own build. |

## Combat: a fight that is over

A party whose fight is over reforms at its next move, deploy or Form Up
(DECISIONS, "A fight no combat holds a body of is over" and "Form Up reforms
a fight that is over").

| Not built | What it is | What it needs first |
|---|---|---|
| The record read before the next move | Until that move, deploy or Form Up, the party still reads "in combat": the sheet's warning and its detach, a relayed leave-behind and the map session refuse. | a ruling: each reader asks whether the party is fighting, or reforms first. |

## The marching column

| Not built | What it is | What it needs first |
|---|---|---|
| The trail with no GM online | The trail is written by the primary GM, so a party moved while no GM is seated keeps the trail of its last GM-seen step and reads straight behind the head after a reload. | a writer other than the primary GM that is still one writer, or a ruling that a straight column is enough there. |

## A copy of the party token on another scene

| Not built | What it is | What it needs first |
|---|---|---|
| The scene's travel system taken from the linked token only | The `createToken` hook adopts the scene's travel system for any flagged party token it creates, so a flagged copy pasted onto another scene can switch the party's travel mode from a scene the party is not on. The token the party is about to be linked to (a new party token, a teleport's replacement) is also created flagged before the record names it, which is why the hook is not gated on the linkage yet. | a test that tells a copy from a token about to be linked, such as a teleport's `replacements` option. |

## The turn plan

Magic's cast, location's harvest and identification, and the abilities'
generic throw register later slices on the turn plan (MODEL, "The turn plan").

| Not built | What it is | What it needs first |
|---|---|---|
| Key and lockpicking at a door | RR ch. 6 names using a key and picking a lock, hasty and methodical, among the turn's activities. The formation has no door-lock procedure: the door helper bashes, batters and spikes, and a container's pick belongs to the equipment feature. | a door-lock resolution (which door, the lockpicking throw through the abilities, what a key is) and the owner's word that the formation owns it. |
| Battering as a plan choice | Registered with no length: the turns an axe needs are the door's printed figure (`DOOR_KINDS`), so the choice cannot lock. Its resolve also has no door to open. | §6's door import, then a door option per door within reach. |
| A door within reach | Bashing in the plan is the party's Dungeonbashing check, as the party check rolls it; no door is named, so the Judge opens the door by hand. | a reader of the doors within reach of the party, like `knownPlacementsNear` for traps, that never lists a secret door to a player. |
