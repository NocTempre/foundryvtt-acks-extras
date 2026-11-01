# The party sheet, redesigned (wip)

**Status: PROPOSAL — NOT IN EFFECT.** A first-round design answering the
owner's 2026-10-14 feedback on the shipped party sheet (11.2.0). Nothing below
is MODEL until adopted. As each phase lands, its substance moves into
`docs/formation/{MODEL,DECISIONS,ROADMAP,TESTING}.md` (and `docs/vehicles/`,
`docs/battlemap/`, `docs/lib/` where named) and this file is deleted with the
last of them (`.claude/rules/docs-doctrine.md`, wip lifecycle). The owner
answered the first round's questions on 2026-10-14 (§8); the surfaces below
carry those answers.

The visual specification is a Design canvas, five boards:
<https://claude.ai/artifact/1sc1xbNjjwG4DZ8fks5Hzx> (private until shared).
Everything on it is a fixture: the party, its members, every mile, hour and
stone are invented figures, not rules values. The boards are drawn on the dark
seat; every colour is a `vendor/acks-design` token (§10), so the paper seat
follows without a second palette.

## 0. The feedback, read as defects

The owner's words, each paired with what the shipped sheet does that produces
it (`templates/formation/formation-declarations.hbs`, `formation-strip.hbs`):

| Feedback | What the sheet does today |
|---|---|
| "The UI is terrible" | Nine buttons in a row, two roll rows, seven collapsed folds, thirty-one selects, number fields and checkboxes behind them; no image, no reading at a glance |
| "Movement is an actor setting … default to fastest available" | `travel.movement.mode` is a party-wide select; a rider is priced only through the attachment chain, and nothing proposes a faster ride |
| "The terrain should pick up the details from the map hex below … A GM tool for the map might have the palette, not the party" | Ground and road already hide behind the map paint (`travel.mapPaints`); following, territory and encounter terrain are still party-sheet selects, and the brush paints only ground |
| "The day planner should be a horizontal line of boxes … confirmed by the party" | A kind select, four slot selects, an hour select and a hidden `declared` flag |
| "Weather and time of day should roll and sync with the world clock" | The hour follows the clock; the sky is keyed on the formation's End-day counter, not the date (§1) |
| "Camp as a new tab when activating camp time" | Camp is a fold that appears when `travel.camp` is present |
| "Order in travel mode should change to mounts, vanguard, wagon train, livestock, mercs vs hench vs cargo" | One rank grid for every mode; mounts are a chip on a cell; an unridden animal is invisible |
| "A sightings for encounter cards" | One whispered card per throw, nothing structured survives it, players see nothing |

## 1. Defects found in the code while designing

Confirmed by reading, 2026-10-14. They change the brief: the clock sync is
not a UI change, it is a correctness fix the UI then shows.

1. **The sky is keyed on the End-day counter, not the date.** `rollWeatherNow`
   and `endDay` (`scripts/formation/travel.mjs`) build the cache key as
   `{ day: t0.dayCount, … }`. DECISIONS 2026-08-29 "Weather is derived from
   date and climate" rules a `(date, climate)` key, and ROADMAP §4 lists the
   defect as FIXED. Two parties on one date with different counters roll
   different skies; a calendar advanced any other way leaves the sky standing.
2. **Footing and tomorrow's sky move only on End day.** `advanceGround` has one
   caller, inside `endDay`. The formation's `onWorldTimeAdvanced` callback
   credits holed-up days and expires notes and does nothing for the weather.
3. **Season and climate never come from the calendar.** Foundry v14
   `CalendarData.timeToComponents` returns `season`, an index into
   `calendar.seasons.values`; no module code reads it.
4. **"Who saw whom" is computed and unused.** `detection()`
   (`scripts/formation/encounters.mjs`) returns `partySees` and `monstersSee`
   and has no caller; the card uses the visibility figure alone, and
   `postEncounterCard` writes no flags, so nothing structured survives it.
5. **Two answers to "is the party mounted".** The `travel.movement.mode`
   select on one hand; `partyHeads` reading `mountOf` live on the other.
6. **Stale pointer.** The `landNavigationSpec` docstring (`travel.mjs`) cites
   an open ruling in `docs/vehicles/DECISIONS.md` that is not there; formation
   DECISIONS 2026-08-29 (Lost) answers it.

**Phase 0 landed 2026-10-15 (d3c9edc): defects 1 to 4 and 6, the day-change
watcher, the *Calendar seasons* setting and the locked season select; walked
live (TESTING, *The day change*). Defect 5 stays for phase 3.**

**Phase 1 landed 2026-10-16 (db20994): the frame (band in the header, the one
set of rails with the Key legend, the plate, pill tabs named by domain, each
mode's actions at its tab's head, the Judge part a GM seat's only), part-root
scroll, the ratio; walked live on both seats (TESTING, *The frame*). What it
leaves is ROADMAP, *The party sheet: what the frame leaves*.**

**Phase 2a landed 2026-10-16 (7a59357): the country read off the map
(`countryAt`; the brush's territory and climate layers; water walls; the
scene's country), `travelOf`'s resolution with provenance, the Judge's
overrides and declarations on the Judge tab, the Country cards; the review's
fixes landed with it (an overridden ground takes its encounter table, a paused
journey follows its token, a declaration clears). Walked live on both seats
(TESTING, *The country*; battlemap TESTING, *The country's layers and water*).
What it leaves is ROADMAP, *The arrival on another scene* and *The cadence
carry across territories*.**

**Phase 2b landed 2026-10-16 (22fe69c): the plate's drawing, Where they are
and Shift the truth, the navigation throw at the day's first step off a road
(keyed on the calendar day and the End-day count together), the card's Begin
at the belief, What the party is shown, Navigation, quietly, the hex stock's
age; the read-only review's fixes landed with it (DECISIONS 2026-10-16, *The
day is keyed twice, the stock says its age, and the card's Begin is the
throw's own opening*). Walked live on both seats, 67 of 67, and the GM seat
booted under a recorder with no init, setup or ready error (TESTING, *The hex
the party is shown*). What it leaves is ROADMAP: the day's claim across two
GM clients, the plate's crop off a background that does not fill the scene,
and the faked reveal when the active GM is viewing another scene. The guide's
lost-episode shots (v8.1.0) show the old Begin wording and are the next
release's to re-take.**

## 2. Principles

Taken from the character sheet's rulings (`docs/character-sheet/DECISIONS.md`)
and from plain interface practice. Each is applied below; none is restated
there.

1. **The canvas is the specification, scaled by a ratio.** Figures are px on a
   920 px window times `--acks-extras-k`; the space ramp is re-declared at the
   root (character sheet 2026-09-07). The party sheet joins the same contract.
2. **The band is a reading.** The day bar in the header shows hours walked of
   the budget, gold when spent; a press on it drags the window (the XP bar
   ruling, 2026-09-04). Nothing in the band edits.
3. **Gauge and pen.** A rail cell shows the figure in force; editing happens
   where the figure is owned (a member's row, a popover, the brush). A field
   that edits holds the stored value, not a derived one (2026-09-16).
4. **Foundry's marks, the Judge's map, never book art.** Imagery is the
   module's own drawing or Foundry's icon set (`icons/svg`,
   `icons/environment`); the hex plate is drawn from the painted region and the
   drawn roads. No book art, ever.
5. **Derive once, declare on top.** Every value the map, the clock or the
   roster can supply is derived and shown with its source; the Judge's
   declaration sits on top as a visible chip that can be cleared. Provenance
   explains and never decides.
6. **One gesture per decision.** A tile, a drop or a press; a select only
   where the choice is a free string. A drop on a seat says what a dialog
   would ask (vehicles 2026-08-28).
7. **Disclosure by state, not by fold.** The sheet shows what the mode and the
   hour make relevant, and nothing is folded: the Judge's records are a
   Judge-only tab (§4i), the log is the Sightings tab (§4g).
8. **Players see every reading and the controls for what is theirs** (MODEL,
   "The player surface"). The Judge tab, the overrides and the reveals never
   reach a player's DOM; the brush and the line tool are scene controls, not
   sheet controls.
9. **Undo over confirm.** Toggles undo themselves; arrangements are
   snapshotted and restored. Only the irreversible step, closing the day, asks.
10. **Six tones, one meaning each.** Burgundy fill: the active choice or a
    Judge's declaration. Rose keyline: a thing to press. Gold: a choice
    waiting, a dynamic tab, a fact the map or the clock supplied. Red tint:
    harm or shortfall. Dashed: stock and placeholders. Neutral: a reading.
11. **Re-render on what the view reads.** The `PARTY_TOKEN_KEYS` precedent;
    the sheet submits on change, so scroll lives on part roots
    (`.claude/rules/ui-layout.md`, "Where a window's scroll actually lives").

## 3. The frame, and how it morphs

One layout in every mode, after the character sheet: a **band** in the window
header (crest, mode word, name, day bar; Foundry's menu and close), an **art
row** (saves rail, plate, figures rail, quick tools, the reading, sheet
tools), **pill tabs**, a **panel**. What each part shows answers to the mode
and to its state; the Morph board on the canvas is the full table. In short:

| | Delve | Journey | City | Camp time |
|---|---|---|---|---|
| Band bar | turns since rest | hours walked of the budget | days credited | full, gold, "Encamped" |
| Plate | party image, light ring | the hex under the token | the district or place | the hex at night |
| Rails | the one set; light reads torch turns, pace per turn | the one set; supplies, mouths, pace, light to dusk | the one set; pace reads blocks a turn, light is the hour | the one set; pace reads encamped, light reads dawn |
| Mode tab | **Dungeon**: strip, player actions | **Wilderness**: strip, country, movement, sky, day | **City**: strip, city tiles, board | boxes spent, night band |
| Order tab | **Order**: rank grid | **Train** (§4f) | **Company** | the train, with watches |
| Kit tab | as now | as now | as now | lights lead |
| Camp tab | absent | absent | absent | **appears**, gold |
| Sightings tab | the dungeon's wandering throws and turns spent | the journey's results: throws, hours spent, navigation, the toll | the city's encounters and the board's throws | night entries name the watch |
| Judge tab | the true map beside the party's; overrides | the true hex beside the believed hex; the episode; what the party is shown; quiet navigation; measure; overrides | the hunted tally's hidden side; overrides | the night's throws before they post |

The first tab is named by the mode's domain: Dungeon, Wilderness, City. The
last, Judge, is a part rendered on a GM seat only; a player's parts list
never carries it (§4i).

**The band and the art row never change with the tab.** They answer to the
mode and to its state only, so the saves, the plate, the figures, the quick
tools, the reading and the sheet tools are the same on every tab; a tab's own
controls (the Wilderness tab's Work the country and Make camp, the Train's
arrangement pills and Disband, the Sightings filters and counts, the Judge's
episode state) sit at the head of its panel. A chevron at the end of the tab
row hides the panel, leaving the band, the art row and the tabs as a compact
window; the window shrinks with it and the choice is kept per client, as the
character sheet keeps its open tab.

**Each mode has one gold state.** The journey's is camp time; the delve's is
combat; the city's is night. Night is `isNight` in `settlement.mjs`: the
world clock's dark, or the Judge's word through `HOUR_MODES` (clock, day,
night), and the encounter cadence is already keyed `{day, night}` per where.
By night the band reads By night, the light figure reads the hour, the throw
tool reads the night column, lodging is the City tab's, the City tab morphs to
lodged-or-abroad and the night's intents, and the Company tab says who is
lodged, who is abroad and who stands the door. Combat is
`formation.combat.active`, set by `combat-bridge.mjs` when the party
token joins a combat and cleared when the combat ends. In combat the band
reads In combat and its bar counts rounds, the pace figure reads combat speed
(the view's `combatSpeed`), the light figure what is left, and the fight's own
tools (round, initiative, morale, disengage, reform) head the Dungeon tab,
which morphs to the initiative order, who is engaged and who is down, morale for the
hirelings, spells and lights in hand; the Order tab is the battle line; the
Judge tab holds the other side and **Reform the party**. The Morph board
carries the column; the Dungeon board draws the state, toggled by **Enter
combat** at the tab's head.

**The rails are one set in every mode and state.** Around the plate sit the
always-relevant controls, as on the character sheet: the five party saves left
of it (the character sheet's left rail holds the character's), and right of it
the figures (hit points, supplies, mouths, pace, light; each a control: the
supplies figure rations, the pace figure opens Movement, the mouths figure the
roster) and the five quick tools (encounter throw on the column the hex and
the hour pick, party checks, search in the mode's unit, pause the clock, deal
experience). Only the figures' readings change with the mode and the state.
Right of the reading is the sheet-tools rail, which holds window and document
management only, as the character sheet's does: edit the description, change
the image, ownership, Tweaks, and **Key**, which opens a legend under the art
row naming every rail glyph (every cell also names itself on hover). The band
keeps only what Foundry's title bar owns, the menu and close. A mode's own
actions sit at the head of its tab: Work the country and Make camp on the
Wilderness tab; turn, round, rest and undo on the Dungeon tab; hop and lodge
on the City tab. Disband is the Train tab's, beside Form up. End day leaves
the sheet: it is the Camp tab's **Break camp** and the dusk offer's **Make
camp**.

Mechanics: the Camp part is added through `_configureRenderParts` only while
`travel.camp.active` is set, the dynamic-tab shape the character sheet uses for
Magic and Trade. The mode word's menu stays the Judge's override of the
inferred travel system.

## 4. Surfaces

### a. Movement: an actor setting, defaulting to the fastest available

- **The per-actor record already exists: the attachment** (`lib/attachment.mjs`,
  roles `rider`/`passenger`/`draft`/`crew`/`cargo`, each `setsPace`). It is
  what `partySpeed` reads through `rootCarrierOf`. Nothing new is stored for
  the common case.
- **New:** an actor flag `conveyance = { pinned }`, written by the actor's
  owner, so a player can hold "on foot" (or "this mule") against the default.
  `formation/conveyance.mjs` `bestConveyance(actor, formation)` ranks: the
  current carrier, then an unridden mountable animal, then a land vehicle with
  `holdOf(v).free` enough for the passenger, then foot. A carrier counts for a
  member when its owners include the member's player, whether or not it is in
  the train yet (ruling 2a); one the arrangement picks from outside the train
  joins it. The arrangement applies itself when a member joins the party and
  at each dawn, unless the member is pinned (ruling 1a); between those, a gold
  dot says a faster ride has become available. Pace comes from
  `carrierSpeedFor` and `explorationSpeedOf` as now.
- **Fastest for all** generalises `boardForBestPace` (`vehicles/boarding.mjs`)
  to mounts: one `snapshotArrangement(members)` is stored at
  `travel.lastArrangement`, and **Undo** restores it (the `reboardLast`
  shape). The five mode tiles on the Wilderness tab show the **derived** mode and,
  pressed, apply a group arrangement with the same snapshot: on foot (everyone
  dismounts and disembarks), mounted or wagon (fastest for all), vessel (all
  aboard). Flying stays a declared override because hours aloft are declared.
- **The formation's `travel.movement.mode` becomes derived:** vehicle when any
  root carrier is a land vehicle (its wheel and footing gates apply), mounted
  when anyone rides, otherwise foot. The select goes.
- **The pace line** heads the Movement section, not the reading: who sets the
  pace and why (the `slowest` row the Order tab already marks), how many ride,
  are carried and walk, and the pace; a gold chip names who could go faster.
- **Players:** a `conveyance` relay in `player-requests.mjs`; the GM seat
  validates ownership and calls `ride` or `attach`.

### b. The country: read from the hex under the token

- **The map is the source.** `paintedTerrainAt` already yields ground and the
  encounter pick per hex; the road comes from the drawn network
  (`battlemap/roads.mjs`). Both already hide the sheet's selects when painted.
- **New brush layers: territory and climate.** One region per value, keyed per
  hex with the `terrainHexes` mechanics of `terrain-paint.mjs`. One
  `countryAt(scene, point)` reader returns
  `{ ground, encounterTerrain, territory, climate, road, following }`.
  `following` (river, known route) is derived from what is drawn under the
  token: a route, or a river. **A river is drawn, not painted** (ruling 7a):
  rivers and coasts are a line layer with the road tool's mechanics (a wall
  flag beside `ROAD_FLAG`, carrying kind and navigability), the two river
  terrain keys leave the brush palette, and they stay as encounter sub-tables
  chosen when the party travels on the water. The palette lives on the Judge's
  brush and the line tool, both scene controls on the map; the party sheet
  carries no button to either, only the reading and its override.
- **Scene default country:** the setup tool's flag (`battlemap/scene-setup.mjs`)
  gains a default `{ ground, territory, climate }` for a map that is one
  country throughout, or is not a hex map.
- **Store:** `travel.map` is a cache of the values plus `{ sceneId, i, j }`,
  written by `traceStep`/`seatJourneyHex` and refreshed by the GM client on
  region or road-wall updates on the party's scene. `travel.override` holds
  what the Judge declared. `travelOf` resolves override → map → legacy record
  and returns provenance, so every consumer keeps reading `t.ground` and the
  rest unchanged.
- **Plate and cards:** the plate is the module's drawing of the hex (region
  tint, the river ribbon, the road, the points, the token's mark), never book
  art; when the scene has a background image, a crop of it under the party
  token fills the plate's frame and the drawing rides over it as an overlay
  (ruling 8c). The crop is taken at the believed hex, so the true position
  stays the Judge's while lost. Four detail cards carry a 40 px swatch, a
  label and the value: ground, road, following, territory. An override shows
  as a burgundy chip with a clear.
- **While lost:** players see the believed hex (the party token); the Judge
  sees the true hex (`truePositionToken`) and a compass badge.
- **Fallbacks:** unpainted hex → the scene default, then the declared value,
  shown with the pen and a **Paint this hex** chip for the Judge; no party
  token → declared values plus the hex label and Next hex in the popover.
- **Points of interest** is the section under the Country: the hex's stock
  (`hex-stock-run.mjs`, the scene flag `hexStock[<key>]`) as an inventory. A
  point is what `hex-stock.mjs` already records (`{id, kind, name, found,
  placeUuid, note}`; kinds lair, valuable, dangerous, unique, placed), and a
  point made a place is a location actor's token (`placeFromPoint`;
  `poi-logic.mjs`: a static point of interest IS a place actor's token), so
  no new document type is needed. Players see the points their formation has
  found (`found[formationId]`): name, kind, when and how, **Open** (the place
  actor, where one exists) and **Walk there** (`travelToPlace`, the turns the
  walk costs); under them **Search an hour** (`runSearchHour`, the same action
  as the quick tool) and **Survey** (`surveyHex`, when the order holds Land
  Surveying). The Judge's half is a dashed block rendered on a GM seat only,
  as the Country override chip is: the stock summary (`stockSummary`: stocked
  when, up to N from the row's dice and the territory's share, unfound, search
  credit), the unfound points with **Mark found**, **Make it a place** and
  **Remove** (`markPointFound`, `placeFromPoint`, `removePoint`), **Add a
  point by hand** (`addPlacedPoint`), **Restock** (`openStockDialog`, whose
  confirm says the old finds and credit drop) and **Set a restock day**, which
  is new: the record stamps `stockedAt` and nothing reads it, so a Judge-set
  day the world clock restocks on is phase 2's (§9). **Lost** is the Judge tab
  (§4i); the Country cards and the plate read the believed hex while an
  episode is open.

### c. The sky: rolled from the world clock

- **Key:** `(calendarDay, climate, season)`, where `calendarDay` is world time
  over the calendar's seconds per day, floored. This is what DECISIONS
  2026-08-29 ruled; §1 defect 1 is the code brought into line.
- **Climate** comes from the map layer, then the scene default, then the
  declared value. **Season** comes from `timeToComponents().season`, mapped to
  the four generator keys by a world setting: name match by default (the
  calendar's season names against the module's four), position as fallback.
- **Settling:** a lib `onWorldTimeAdvanced` watcher settles the sky for every
  journeying formation on a day change and advances the footing once per day
  crossed. A watermark `travel.weather.settledDay` makes it idempotent, so a
  dragged calendar pays once. `endDay` stops calling `advanceGround` itself:
  one owner.
- **Display:** the plate shows the day band or the night band
  (`temperatureNight`) by `clockReading().dark`. Chips for temperature,
  precipitation, wind, footing, by-night; effect chips name what is in force
  (missile fire, footing, wheels) and never a number: what each is worth is
  on the imported table and shows on hover, or reads "unpriced".
- **Still declared by the Judge:** an override of any band from the ladder in
  the popover, with clear; the climate where the map is silent; the season
  where the calendar has none; the `travel.hour` override. **Judge: reroll**
  and **Set by hand** are the two chips.

### d. The day: a line of boxes, picked then confirmed

- **Layout:** a segmented choice of three tiles (March, Forced march, Camp
  day), then the four slot boxes (`ANCILLARY_SLOTS`), the hours bar under
  them (dawn to dusk, the clock's mark on it), and the confirm.
- **Picking:** a box is selected, then an activity from the row of glyphs
  (`ANCILLARY_ACTIVITIES`: travel, hunt, forage, search, rest, other). A done
  box (`day.done`) is shaded and shows what it held. **The kind never adds or
  removes a box** (four always, `ANCILLARY_SLOTS`); it says what the day does
  around them, and a meaning bar and line under the boxes say so for the
  chosen kind: a march is the dedicated march plus the four; a forced march
  spends all four on the road (`withDayKind`, `consumesAncillary`), shown as
  gold boxes marked spent; camp drops the dedicated march (`pace: null`) and
  leaves the boxes as the whole day, a travel box still walking its hour
  (`dayBudget`). A hunt,
  forage or search box carries a resolve action that replaces the Work the
  country and Search an hour buttons for that box.
- **Who selects:** any member-owner, through a new `dayPlan` relay, and the
  Judge.
- **Who confirms:** any one member-owner, or the Judge (ruling 3b). **Confirm
  the day** sets `day.declared`, posts the plan to chat naming who pressed
  it, and locks the boxes; a later change by anyone clears the declaration
  and the next confirm re-posts it. No Ready marks.
- **Never a drag gate.** The Judge drives the token whatever the plan says;
  the plan is what the party meant, not a lock on the map.
- **The dusk offer** (`offerDayEnd`) keeps its trigger; its answers become
  Make camp, Push on (forced), Not yet.

### e. Camp: a tab while camp time is on

- **Entry:** Make camp from the dusk offer, or the Camp tile in the day's
  segmented choice, and never on its own at dusk (ruling 5a);
  `travel.camp.active` is set. The party token wears a campfire status. A token drag while encamped ends camp time, undoable from
  the tile.
- **Contents** (from `buildCampView`): mouths and supplies as two bars
  (rations against mouths and days, water at hand or a throw); **the night as
  one row a head**, after the Order tab's role chips
  (`formation-tab-order.hbs`, `toggleRole`): at the fire, wet, in armour, on
  watch and willing to steal as toggle cells, hours in the open as a stepper,
  and what the head owes at dawn as the row's last cell (red a shortfall,
  gold a throw owed, green rests). Gold on a cell says the watch roster or
  the kit answered it. Water at hand and the fire are the hex's and the kit's
  answers, shown once above the grid with the traps stepper and two group
  actions (everyone at the fire, nobody in armour); work the country as rows
  (forage, hunt, search) with the throw state and the result. The who-suffers
  chips go: the row says it.
- **Store:** the five toggles and the hours move from the party-wide camp
  record to a per-member one (`travel.camp.heads[memberId]`); water, fire and
  traps stay on `travel.camp`. The toll reads the member's row.
- **Break camp** closes the day: `closeDay` stays the one closer; the toll and
  the rest post whispered to the Judge as now; the clock runs to dawn; the sky
  settles for the new day; the tab folds away. **Strike camp now** ends camp
  time without closing the day (a night march).

### f. The train: the Order tab in journey mode

**The groups are the party's own.** Players name them, add them, and order
them front to rear; the store is `travel.train.groups[]` (`{id, name,
members[]}`), and the engine reads position only, never a name: the first
group is the front, the last the rear. The four on the canvas (a vanguard, a
main body, a wagon train, a rear guard) are one party's example, offered as
the defaults a new party may rename or delete. What a group shows for a
member is derived from records that exist; nothing else new is stored except
one missing role.

| Section | Derived from | Existing API | Missing |
|---|---|---|---|
| A group's members | `travel.train.groups[]`, player-defined | a drag between groups | the store |
| The front group | the scout role for its members, detached scouts | `toggleRole`, `toggleDetach` | — |
| The rear group | the rear-guard role for its members | `toggleRole` | — |
| A wagon in a group | root carrier is a vehicle | `occupantsOf`, `holdOf`, `fillBuckets`, `stationsFor` | — |
| Rider to mount | the `rider` attachment | `mountOf`, `ride`, `dismount`, `station-chip.hbs` | — |
| Pack animals, herds | animal items and actors | `animalNeeds` | a **`led`** attachment role: a handler, weight on the animal, sets the pace; a herd as a stack led by a herder. Today an unridden mule neither slows the party nor appears |
| Standing tag | core `system.retainer.{enabled,category}` | core schema, `ATTACH_ROLES.cargo` | — |

A drag between groups writes the group; into the front or rear group it also
writes the scout or rear-guard role, and onto a carrier it calls
`attach`/`detach`; a drop on a vehicle goes through the vehicles drop dialog,
which asks what it already asks. The standing tags are read, never typed: PC, henchman, mercenary,
specialist (core's `hireling_categories`), stock (dashed). A herd without a
herder reads red and slows the party.

**A group's kind is read, never set.** The first group is the front and its
heads carry the scout role; the last is the rear and its heads the rear-guard
role; a group whose member's root carrier is a vehicle is a wagon group; one
whose members lead animals is a stock group. The head shows the name (the
party's), the position word and what it holds, and a **×** that removes the
group, its cards falling to the group before it (the front's to the one
after). A long group scrolls inside its column (`max-height`, `overflow-y:
auto`), with the head and the drop zone pinned. **Frontage is not a Train
control**: `effectiveFrontage` still sizes the party token's face
(`faceWidthFeet`, `syncPartyTokenSize`) in every mode, which on a hex-scale
scene is a marker's footprint, not a column's width; the Train's width is its
groups, so the pill is gone from the tab and the delve's Order tab keeps it.
Whether a hex scene should size the marker by the hex instead is a scene-sync
question (§9).

### g. Sightings: the journey's results, kept

The owner's scope (ruling 6): sightings are encounter rolls, the results of
hours spent, and the rest of what a journey throws, not only creatures seen.

- **What is an entry.** Every card the journey already posts: an encounter
  throw (quiet or not), a search hour, a forage or hunt day, a rest, a hex
  survey, a hex entered, a navigation event (lost, found, re-anchored), the
  weather toll and the night. The tab keeps them so they are not lost in
  chat; the card stays the record, the entry points at it. There is no
  separate log: the old Log fold is gone and its lines are entries here.
- **Store:** `travel.sightings`, capped like `travel.log`, newest first:
  `{ kind, when, hex, messageId, summary, visible }`. The encounter entry also
  carries `{ feet, partySees, monstersSee, creatureUuid, heads, outcome }`,
  written as `flags["acks-extras"].encounter` on the card with `detection()`
  (§1 defect 4) wired in.
- **Who sees what.** An entry has the visibility its card had: a public card
  is an entry for everyone; a whispered card is a Judge-only entry with
  **Reveal to the party**, which posts the public version with "what was
  seen" as a line the Judge words (default: a neutral count). **Passed
  unseen** closes an encounter without a reveal. The Judge sets an encounter's
  outcome from tiles: evaded, parleyed, fought, passed unseen. Reactions stay
  with the influence tools.
- **The tab:** filter chips by kind (all, encounters, hours spent, navigation,
  supplies); each entry carries its glyph, day and hour, hex, the summary
  line, its chips, and **Judge's card** to open the message. The Wilderness tab's
  reading carries the count. In a delve the same list holds the dungeon's
  wandering throws and turns spent; in a city, the board's encounters and
  incidents.

### h. Saves, checks and the folds

The five party saves are the left rail. The five checks (listen, hasty
search, methodical search, bash, track) are one **Party checks** tool opening
a grid with the Magical toggle; `playerCheck` stays for players. No fold
remains: Lost is the Judge tab (§4i), the log is the Sightings tab (§4g), and
every other fold's control has moved into the card or popover that owns its
subject.

### i. The Judge tab: the truth and the belief

A part rendered only on a GM seat (`_configureRenderParts` drops it for a
player, as the character sheet drops its dynamic tabs), dashed in the tab row
so it reads as the Judge's. It holds what the party must not see and gathers
every override in one place.

- **Where they are:** two plates, the token's hex and the believed hex, the
  second dashed and gold while they differ. The token is the truth and never
  moves for a belief; the Wilderness tab's plate, Country cards, strip and
  next hex read the believed hex while an episode is open, and the hex the
  party enters next is counted from it. The encounter column always runs on
  the true hex.
- **The episode** (the lost record as now): **Begin an episode** by hand, or
  a failed navigation throw opens one; **Shift the belief** moves the believed
  hex one step in a hex direction; each hex walked while astray moves the
  belief with the token; **They find themselves** closes it with a public
  navigation entry; **Close quietly** writes only the Judge's entry.
- **What the party is shown:** `travel.shown` picks between the believed hex
  and **unknown country**, where the plate is blank, the Country cards read
  nothing and the strip shows no next hex. The section previews what a
  player's seat renders now.
- **Navigation, quietly:** the throw is made here when the token crosses a
  hex edge (`landNavigationSpec`, `travel.mjs`), with a **Throw now** for the
  Judge; the party sees a result only when it finds itself. Past throws list
  with their Judge-only entries.
- **The Judge's hand:** measure mode (`measure-fuzz.mjs`: off, fuzzy,
  unknown), the Country override, the sky reroll and set-by-hand, and the
  whispered count linking to the Sightings tab. Where an override bites, the
  reading wears a burgundy chip with a clear, as before.
- **Players:** nothing. An episode begins on this tab's episode card; no rail
  tool opens it, and the tab is absent for a player.

## 5. Automation rules

| Value | Source | Goes stale when | Override, and how it clears |
|---|---|---|---|
| Country | `countryAt` at the true or believed hex | the hex changes; a region or road is edited | burgundy chip with clear (`travel.override`) |
| Following | a drawn river or route under the token | the line is edited; the hex changes | chip with clear |
| Sky bands | `skyFor(calendarDay, climate, season)` | the calendar day changes | ladder pick, chip with clear |
| Season | `timeToComponents().season` | the season changes | chip with clear |
| Day or night | `clockReading()` | every clock update | the `travel.hour` chip |
| Movement mode | attachments | an attachment flag update | the flying declaration |
| Conveyance | `bestConveyance` | the train or a hold changes | `conveyance.pinned` |

Degradation: no calendar → the key falls back to `dayCount` and the season is
declared, with a hint; no painted terrain → scene default, then declared; no
party token → declared values and Next hex; nothing imported → ladders stay
declarable, the generator is off and the effects read "unpriced", as now.

## 6. Rulings touched

Each is recorded in DECISIONS when its phase lands, naming the new evidence
(the owner's 2026-10-14 feedback on the shipped surface) where an entry under
seven days old is superseded.

- **Superseded in part:** formation 2026-10-09 "A drag on a journey spends
  miles…", its one-surface clause collapsing the declarations under the strip
  and "never a picker, the day board" for players (the boxes are a picker).
- **Superseded in part:** 2026-10-09 "The insert pages' rules ship with the
  major", which rejected a separate wilderness tab. The Camp tab is the
  surface of a state (encamped), not a calculator.
- **Superseded in part:** 2026-10-09 "A search reads the stock…": the two
  standing selects move into the search gesture, which asks only when several
  unfound points exist.
- **Kept, code brought into line:** 2026-08-29 "Weather is derived from date
  and climate" (§1 defects 1 to 3). ROADMAP §4's FIXED line is corrected.
- **Kept and extended:** 2026-09-30 "The city's hour follows the world
  clock"; 2026-08-31 and 2026-10-09 on the day's end (`closeDay` stays the one
  closer; the offer's answers change); 2026-08-28 "Travel state lives on the
  record" (the movement mode becomes derived).
- **Kept:** battlemap 2026-08-28 and 2026-10-09, one terrain per hex
  (territory and climate answer different questions); lib 2026-08-28, the
  attachment is the single model for carrying; vehicles 2026-08-28, the drop
  dialog asks; character sheet 2026-09-03, Foundry's icons; formation
  2026-09-23, strings name the field; ROADMAP §4 "roads are drawn", which
  rivers and coasts now join.
- **Fix:** the stale pointer in `landNavigationSpec` (§1 defect 6).

## 7. Build order

Every phase ships the Judge tools for what it adds (CLAUDE.md, "Release"),
walks its `TESTING.md` recipe live before it ships, and its release kind is
the owner's call.

| Phase | Content | Risk | Live check |
|---|---|---|---|
| 0 | §1 defects 1 to 4 and 6; the day-change watcher | medium: old cache keys are orphaned, harmlessly | advance the clock a day through core: two parties in one climate get one new sky, the footing moves once |
| 1 | the frame: band, the one set of rails (saves, figures, quick tools, sheet tools with the Key legend), plate, pill tabs named by domain, a mode's own actions at its tab's head, the Judge part replacing the folds, part-root scroll, the ratio | low: view only | every former fold's control reachable; the rails identical across modes and states; a player seat never receives the Judge part; the ui-layout pass at two type sizes |
| 2 | brush layers, scene default, the river and coast line layer, `travel.map` and `travel.override`, the Country cards and plate, the believed hex driving them while an episode is open, `travel.shown` | medium | paint territory, draw a river, drag; the cards, the plate and the encounter column follow; override and clear; open an episode: a player's sheet reads the believed hex, the Judge's the true one; unknown country blanks the plate |
| 3 | conveyance, derived mode, dawn and join application, Fastest for all and Undo, the relay | medium: writes to holds | a player pins foot; a member joins and is mounted; the Judge presses Fastest for all, then Undo |
| 4 | the day's boxes, confirm, camp time, the Camp tab with the night one row a head, the offer's answers | high: supersedes rulings | a player seat fills and confirms; the Judge changes a box; Make camp, one head wet and out an hour, then Break camp: that head alone owes the throw |
| 5 | the train with the party's own groups (`travel.train.groups`), standing tags, the `led` role | medium: a new lib role needs its ruling | a player names a group and adds one; a drag into the front group marks the scout; a mule led by a handler slows the party; a herd without a herder reads red |
| 6 | sightings: the results feed, the encounter flags, reveal, the tab | low | a search hour and a throw appear as entries; Reveal from the Judge; a player seat sees only the public ones |

Files, by phase: `travel.mjs` (`travelOf` resolution, `endDay`,
`applyTravelForm` reshaped for tiles), `sky.mjs`, `weather.mjs`,
`lib/world-time.mjs` (calendar-day helper, season mapping), `module.mjs` (the
watcher), `formation-view.mjs` (`buildStripView` → rails and tiles), the
`formation-*.hbs` templates plus a new `formation-tab-camp.hbs`,
`party-actor.mjs` (parts, `_configureRenderParts`), `formation-actions.mjs`,
`player-requests.mjs` (`dayPlan`, `conveyance`), a new `conveyance.mjs`,
`battlemap/terrain-paint.mjs`, `scene-setup.mjs` and a new `rivers.mjs`
beside `roads.mjs`,
`encounter-card.mjs`, `lib/attachment.mjs` (phase 5), `styles/formation.css`
(ratio scaling), `lang/en.json`, and the four formation docs plus
`docs/guides/formation.md`.

## 8. Rulings taken 2026-10-14

The owner's answers to the first round's eight questions, as given:
`1a 2a 3b 4a 5a 6 (rescoped) 7a 8c`.

1. **Fastest available applies itself** when a member joins and at each
   dawn, unless the member is pinned (a).
2. **A carrier counts for a member** when its owners include the member's
   player, in the train or not (a).
3. **Any one player confirms the day plan**, or the Judge (b). No Ready marks.
4. **Territory and climate are brush layers** per hex, plus a scene default (a).
5. **Camp time starts** from the dusk offer and the Camp tile only (a).
6. **Sightings are the journey's results**: encounter rolls, the results of
   hours spent, and the rest (§4g). Who sees an entry follows its card's
   visibility; that is the design's reading of the answer, not a ruling, and
   §9 lists it.
7. **A river is drawn like a road**, not painted as a hex type (a); it comes
   in with the country phase.
8. **The plate shows both**: the module's drawing over a crop of the scene
   background when the scene has one (c).

## 9. Open points the canvas does not settle

- Visibility of a feed entry follows its card (public or whispered). If every
  result should be public to the party, the reveal step goes and the cards'
  whisper changes with it; that is one ruling, taken before phase 6.
- The feed's retention: per journey or per party, and how many entries.
- The Kit tab is described in the Morph board and not drawn; it follows the
  same frame once phase 1 lands. The Dungeon and City boards draw the other
  two modes on that frame, each with its gold state as a toggle at the tab's
  head (Enter combat, Night falls); the combat state's initiative, morale and
  line sections are this design's shape for a surface the module has not
  built; they are confirmed against the turn engine's combat hooks when the
  Dungeon tab is built on the phase-1 frame, which no phase above schedules.
- Which night answers stay party-wide (water, fire, traps) and which are a
  head's is this design's split; phase 4 confirms it against the toll's code.
- Watches (who stands which, and the night sighting naming the watch) are a
  Camp-tab row with no store behind it yet; it rides with phase 4 or later.
- The `led` role's weight and pace rules are a lib ruling before phase 5.
- A restock day: `stockedAt` is stamped and nothing reads it. Whether the
  world clock restocks a hex on a Judge-set day, or a restock stays a
  gesture, is phase 2's ruling.
- The party token on a hex-scale scene: `faceWidthFeet` sizes it by frontage
  in every mode. Sizing the marker by the hex there is a scene-sync ruling.

## 10. Design-system mapping

The canvas uses literal values from `vendor/acks-design/tokens.css` (dark
block) so a reader can check it against the tokens; the sheet uses the tokens.

| Role on the canvas | Token |
|---|---|
| window ground, boxed field | `--acks-paper`, `--acks-field` |
| band, panels, cards | `--acks-paper-warm`, `--acks-tint`, `--acks-tint-2` |
| text, soft text, faint text | `--acks-ink`, `--acks-ink-soft`, `--acks-ink-faint` |
| active fill, header bands | `--acks-burgundy` with `--acks-on-burgundy` |
| keylines, glyphs, chips | `--acks-spot` |
| gold tab, suggestion, confirm | `--acks-gold`, `--acks-gold-deep`, `--acks-gold-ink`, `--acks-warning-tint` |
| harm, shortfall | `--acks-danger-ink`, `--acks-danger-tint` |
| settled, at hand | `--acks-success-ink`, `--acks-success-tint` |
| display, ui, script faces | `--acks-font-display`, `--acks-font-ui`, `--acks-font-script` |
| cell, rail widths, art plate | 32, 38, 40, 202 px times `--acks-extras-k`, the character sheet's figures |

The terrain swatches reuse `TERRAIN_COLORS` (`battlemap/terrain-paint.mjs`)
so the plate and the map agree; the river uses the river terrain's hue, the
road the `ROAD_TINT` surfaces.
