# Dungeon close-out: the plan

Opened 2026-11-16. In flight: this file is deleted when the work lands, its
substance moved into MODEL, DECISIONS, ROADMAP and TESTING
(`.claude/rules/docs-doctrine.md`).

- Branch: `topic/dungeon-closeout`, opened at `d3d924f4`.
- Worktree: the sibling folder `foundryvtt-acks-extras.dungeon-closeout`.
- This file stays in `main`'s tree. Every phase reads it there and appends its
  results there.

## 0. How the plan is used

Each phase is a clean session and its own orchestrator (CLAUDE.md, "Sizing the
task"). It reads this file, runs its own agents, appends a results section
(exercised live, checked offline only, not checked; commits by sha; fixtures by
marker), corrects the next phase's start prompt, and reports to the owner. It
starts no session that reports back to it. Nothing may live only in a
session's context.

Before any phase fans work out it lists the sessions, reads the running ones'
latest turns, reads `main`'s dirty paths and each open topic's changed files,
and says in one line what it found.

A walk is driven in the Foundry pane by the phase session itself, not handed
to an agent.

## 1. The owner's words

2026-11-16, opening this work:

> I'd like to start a work branch to close out roadmap features on the dungeon
> formation. Hazardous terrain navigation comes to mind but might need an audit
> against RAW and roadmap in addition to a UI improvement pass following best
> practices principals. Please follow repo design principals and task out
> agents intentionally and appropriately.

Read here as: the first row of the batch is getting a party past hazardous
ground (ROADMAP §1, "Spelunking, squeezing, swimming, jumping", and §3 item
3). "UI improvement pass" was first read as the new crossing surface plus the
dungeon-mode windows it joins, and that reading was put to the owner (§5,
OQ7).

2026-11-16, asked "Should the UI pass cover the crossing surface plus the
three windows it joins?", with "Yes, as planned" and "Every dungeon window" as
the answers offered:

> Every dungeon window

Read here as: every window, dialog, sheet tab and sheet section the formation
feature renders or opens while a party is in dungeon mode, a tab or dialog
shared with the other modes included. §10 says which those are and which are
left out, each with its reason.

Standing rulings every phase holds to, each quoted where it lives: no house
rules ship; a printed figure or categorical table is imported, Judge-editable,
and blank with its page reference when absent; a player is blocked where a
Judge is warned (`docs/lib/DECISIONS.md`); no tools for previous-version data.

## 2. State at opening

- `main` at `d3d924f4`. Its one dirty path, `docs/importer/ROADMAP.md`, is a
  peer's and is not touched.
- Peers at work when the plan was written (re-read before every fan-out; this
  list ages in hours):
  - `topic/spell-effects`: its cast registers on the turn plan, and its plan
    names `turn-plan.mjs`, `lib/turn-activities.mjs`, `lib/roll-card.mjs` and
    `lib/saves.mjs`. Touches S7, S9, S17 and U2 below.
  - `topic/summons-formation` (landed and closed during Phase 1; its plan
    has left `wip/`): a summon marches as a party member; formation
    `module.mjs`, `formation-model.mjs`, `combat-bridge.mjs`. Touches S1 and
    S13, and settles whether a summon member may join a crossing.
  - `topic/cast-cell`: `lang/en.json` and the character sheet.
  - `topic/bta`, `topic/tt-importer`: no unlanded commit.
- The next release is a minor, held by the owner until spell effects is
  finished. Slices landed from this branch ride it. No phase cuts a release.
- A runtime landing is refused while `main` holds a version with no tag
  (`acks-branch land`, exit 6).

## 3. What exists

Read 2026-11-16 by a `scout` inventory; symbols, not lines.

- **Derivations.** `scripts/formation/obstacles.mjs`, `swimming.mjs`,
  `jumping.mjs`, published whole as `api.formation.obstacles`, `.swimming`,
  `.jumping` (`scripts/formation/module.mjs`).
- **Callers.** None outside each file and `tools/`. The one cross-caller is
  `trap-rules.mjs` reading `jumping.mjs` `fallFigures`.
- **Producers.** `scripts/importer/formation-binding.mjs` `PRODUCES`,
  `assembleFormationTables`, `assembleSpelunking`,
  `assembleSpelunkingOutcomes`, `assembleJumping`, `assembleFall`; recipes
  `spelunkingGrid`, `spelunkingOutcomeGrid`, `jumpingProse`,
  `jumpingLandingProse`, `swimmingProse` in `table-recipes.mjs`
  `TABLE_RECIPES`.
- **No code at all** for squeezing, a chokepoint, belaying, the grappling-hook
  throw or a traverse rig. "Squeeze" in `column.mjs` is the marching column
  narrowing, a different rule.
- **No proficiency read.** Climbing, Mountaineering, Swimming, Acrobatics,
  Contortionism and Cat Burglary appear under `scripts/` only in comments.
  `ability-bridge.mjs` (`abilityKey`, `overrideFor`) and `party-rolls.mjs`
  (`resolveCheck`, `skillGateAllows`, `boundChecks`) are the existing reads.
  The read itself needs no producer: an imported item answers its own
  definition id's token (`lib/vocab.mjs` `capabilityForId`, through
  `lib/capabilities.mjs` `hasCapability`), so `kw:climbing`, `kw:acrobatics`,
  `kw:swimming` and `kw:mountaineering` are satisfied by the imported entries
  as they stand. A hand-made item has no token and is caught by name, the
  union `rest.mjs` takes for Endurance (`hasCapability(…) || hasAbility(…)`).
- **Member weight.** `formation-model.mjs` `carriedLoad`; `lib/capacity.mjs`
  `borneWeight6`, `carriedWeight6`, `loadStone`.
- **Plug-in points.** `lib/turn-activities.mjs` `registerTurnActivity`;
  `turn-plan.mjs` `registerFormationActivities`; `party-rolls.mjs`
  `PARTY_CHECKS`; `formation-actions.mjs` `SHARED_ACTIONS`;
  `player-requests.mjs` `handlePartyRequest` (kinds `plan`, `check`,
  `trapbreak` and the rest); `party-actor.mjs` `PartySheet.PARTS`, `.TABS`,
  `DEFAULT_OPTIONS.actions`; `frame-view.mjs` `MODE_TEMPLATES`;
  `templates/formation/formation-tab-dungeon.hbs`.
- **Suites.** `tools/test-obstacles.mjs`, `tools/test-jumping.mjs`,
  `tools/test-formation-binding.mjs`. Swimming has no committed suite of its
  own. `tools/live/formation-day.mjs` walks swimming's throw only.
- **Docs.** TESTING has three sections (Swimming; Jumping, the fall, the
  Spelunking table; the Spelunking outcomes). MODEL has no section and the
  guide has no step. Lang: `ACKS-FORMATION.obstacles.*` and `.swimming.*`;
  none for jumping.

## 4. The audit against the page

Read-only, by an `architect`, 2026-11-16. The ch. 6 findings were checked
against the printed page (RR pp. 268-271); the ch. 3 proficiency entries and
the automatic-failure rule against the fan compendium only. Nothing live was
touched. Findings keep their letters so a phase can cite them.

Two were re-read by the planning session against source and the compendium:
A3 and A5 hold as written.

### A. Wrong against the page

| Id | What | Where | Needs first |
|---|---|---|---|
| A1 | A miss whose printed outcome covers no ground is counted as a stretch covered, so a miss then a make reports the obstacle crossed. The difference is per cell: one fail cell does advance. | `obstacles.mjs` `attemptObstacle` | an `advances` flag parsed per outcome cell from the existing grid; the loop re-throws the stretch |
| A2 | A cell that prints a fall with an exemption is read as a fall for everyone. | `formation-binding.mjs` `parseOutcomeCell`; `obstacles.mjs` `readThrow` | the exemption parsed per cell (proficiency set, gear clause); member inputs; OQ2, OQ3 |
| A3 | The target is tested before the natural result, so a climber with a low enough target never botches. | `obstacles.mjs` `readThrow` | nothing |
| A4 | One `assisted` flag stands for three printed routes up a sheer face, and is wrong both ways: a supervising mountaineer does not make the face an easy one, and assistance is ignored for the rappel, the narrow ledge and the crawl, where the page lets it change who may try. | `obstacles.mjs` `obstaclePlan` and the file header | structural inputs: rope fixed; the assisting mountaineer (throw, Climbing, kit); the crawl's rigger; the member's gear; OQ4 |
| A5 | The page names three water conditions and, apart from them, discretionary penalty sizes with an open end. The binding pairs conditions with sizes by position and has no key for the third condition; a lang label merges two conditions. A suite pins the misreading. | `formation-binding.mjs` `parseWaterModifiers`, `WATER_KEYS`; `swimming.mjs` `WATER`; `tools/test-formation-binding.mjs` | OQ1 |
| A6 | The no-throw case is printed as the proficiency's; it is given to every swimmer. The auditor's reading; small. | `swimming.mjs` `swimmingThrow` | nothing |
| A7 | An acrobat's leap takes the bonus of the un-raised score, while the jump takes the raised score. Nothing passes `extended`. A creature with an assumed score gets no bonus. | `jumping.mjs` `leapHeight`, `dexModifier` | importer rows (C7), then the read |
| A8 | The obstacle throw is a bare d20: no pace penalty, no Judge modifier, no conditions, no Cat Burglary term. | `obstacles.mjs` `attemptObstacle` | structural inputs; B6's rows |

### B. Printed procedure absent

| Id | What (RR ch. 6 unless said) | Needs first |
|---|---|---|
| B1 | Squeezing, whole: chokepoint against squeeze, the per-round throw, stuck, the two escapes. Reuses `swimmingThrow`'s shape, `lib/conditions.mjs` `stuck`, `PARTY_CHECKS.dungeonbashing`, core's save. | a `squeezingProse` recipe |
| B2, B8 | The fall from a climb or traverse: its distance, the midpoint, the hand-off to `fallFigures`, the damage type. | nothing for the distance; a depth input for traverses |
| B3, B12 | Belaying: the belayer's throw, the climber's weight against it, three outcomes, the cascade, the rope's length. | a recipe row; ROADMAP §6's door import for the Strength factor |
| B4 | The grappling hook: an attack throw against a Judge-set counterweight, range bands, the secret throw, the botch that holds until the first failed climb on it. | a recipe row |
| B5 | Rigging: rounds to secure a rappel rope, to secure and tighten a traverse, the far-side hook, the load per rope. | a recipe row |
| B6 | Faster paces at a throw penalty for proficient climbers, climbs and traverses priced apart. | a recipe row |
| B7 | Rates of progress on a success, and the one fail cell that is slower progress. Core already derives `system.movementacks.climb`. | a recipe row reading the row's words |
| B9 | Damage taken on a narrow or precarious path: a save, or a fall. The Cat Burglary term has an owner in the cookbook. | the abilities' situational read |
| B10 | Vulnerability is returned by `readThrow` and applied by nothing. `lib/conditions.mjs` holds `vulnerable`, `clambering`, `drowning`, `stuck`, `prone`, `winded`. | nothing |
| B11 | Mountaineering and Cat Burglary as RR ch. 3 prints them: the kit, the party cap, the leader's throw; the traverse term and the catch-yourself throw. | cookbook rows; OQ2, OQ4 |
| B13 | Swimming's round: the exemption for a creature with a swim speed, what each pace allows, the rescue's cost and haul, the drowning state's effects and the death's timing, and a per-round driver. Candidates for the driver: `lib/status-effects.mjs` `installConditionRolls` (per combatant turn), formation's `onCombatRoundChange` (per round). | nothing imported; a design ruling on the driver |
| B14 | Jumping: the distance counted against the round's movement; a hanging jumper's climb up. | nothing |

### C. Printed values and rule words in code

| Id | What | Verdict | Needs first |
|---|---|---|---|
| C1 | `OBSTACLES[*].vulnerable` | content: a printed categorical row of the grid. The in-force 2026-11-11 entry calls it procedure; ROADMAP §6a already calls it content. | a DECISIONS entry superseding that clause in part, naming the 2026-11-14 ruling as the new evidence; then a `spelunkingGrid` row |
| C2 | `OBSTACLES[*].vertical`, `descendOnly` | content with no reader | delete, unless the surface reads movement type |
| C3 | `readThrow` `natural === 1` | the grid's row label prints the band; low | a recipe row, or the general band's reader |
| C4 | lang `obstacles.reason.notPermitted` | a rule sentence, and wrong for two columns | rewrite to say only that the member cannot attempt it |
| C5 | lang `obstacles.rappel`, `obstacles.easyClimb` parentheticals | restate printed cells and examples | drop the parentheticals |
| C6 | lang `swimming.water.rough` | a paraphrase merging two conditions | goes with A5 |
| C7 | The Acrobatics score cap and the bonus bands past the system's table | printed in Jumping and Leaping, written by no import; the 2026-08-15 entry is wrong that the cap arrives with the ability | a row in the jumping windows |
| C8 | `swimming.mjs` `swimmingBonus` | two owners: the formation document and the cookbook's Swimming entry extract one figure | the granted-modifier read ROADMAP §6a's `party-rolls.mjs` row names |
| C9 | `jumping.mjs` `landingSave` docstring examples; the `obstacles.mjs` header's assistance sentence | prose close to the page | rewrite as mechanics |

The archived `DECISIONS-through-v11.14.5.md` entries of 2026-08-15 and
2026-08-19 state printed figures in a tracked, frozen file (OQ6).

### D. Doc claims false

- ROADMAP §1, the row: names four rules and three modules; "tested" is true of
  two files in the committed run; the partial mark overstates what is built.
- ROADMAP §3 item 3 omits squeezing.
- ROADMAP §6a's `obstacles.mjs` row contradicts the in-force 2026-11-11 clause
  and MODEL "Data flow", offers an import for two fields nothing reads, and
  omits C3 to C6 and C8.
- `module.mjs`: the comment above `obstacles` describes `encounterScaling`.
- The in-force 2026-08-15 entry "Jumping is a distance, not a throw": the
  ruling stands; its premises and its worked example are stale.

### E. Fine as built

Jumping's leap, jump, order of conditions, range, `canClear`, the two landing
cases, the save's name, the three footings, the imported dice. Swimming's
target arithmetic, pace share, sink rate, breath, rescue load. Obstacles'
imported stretch with its one-throw minimum, permitted-or-not per column, fail
and botch read apart, a fall ending the attempt, the fixed rope making a sheer
face easy, the blank degradation, the six keys as structure. `fallFigures` as
the one fall reader.

### Proficiency reads the crossing rules need

| Proficiency | Readable today | Missing |
|---|---|---|
| Adventuring | `abilities/adventuring-throw.mjs` `adventuringThrow(actor, "climb")`, unused here; the imported column also holds a target, so the target has two owners | the table answers permitted-or-not only; the throw is the actor's |
| Climbing | `skillThrow(actor, item, "climb")` on the cookbook's ladder; held: `kw:climbing` or the name (§3) | the supplier of `obstaclePlan`'s `classThrow`, which S6 gives through `resolveCheck` |
| Mountaineering | held: `kw:mountaineering` or the name | kit, cap, leader's throw (B11) |
| Cat Burglary | a situational save effect | the traverse term, the exemption, the catch-yourself throw |
| Contortionism | an escape-save effect | the squeeze and push terms, printed only in ch. 6 |
| Acrobatics | a situational save effect; held: `kw:acrobatics` or the name; level from the actor | the cap and bands (C7), `saveBonus` |
| Swimming | the item's effect, unread (C8); held: `kw:swimming` or the name | the granted-modifier read |
| Dungeonbashing | `resolveCheck(actor, PARTY_CHECKS.dungeonbashing)` | the Strength factor (ROADMAP §6) |

## 5. Owner questions

Each is answerable in a letter and names what it unblocks. A phase asks the
ones its slices need, once, and builds what they do not touch meanwhile.

- **OQ1, the water penalty (A5).** (a) The Judge picks one of the imported
  penalty sizes or types a larger one, and ticks the conditions as the reason.
  (b) The Judge types the penalty; the imported sizes show in the tooltip. (c)
  Keep a price per condition, which the page does not print. Recommended: (a).
  **Answered 2026-11-17: (a)** (§13, "Owner answers").
- **OQ2, the Cat Burglary no-fall (A2, B11).** RR ch. 6 and RR ch. 3 state it
  differently. (a) Ch. 6 governs on this surface. (b) Ch. 3 governs. (c)
  Either route exempts, and ch. 3's extras apply. **Answered 2026-11-17:
  (a)** (§12, "Phase 3's questions").
- **OQ3, where the Spelunking grid and its prose disagree (A2, A4).** (a) The
  grid governs. (b) The prose governs. (c) Clause by clause, the stricter.
  **Answered 2026-11-17: (c), applied to conditions only** (§12, "Phase 3's
  questions").
- **OQ4, Mountaineering without its kit (A4, B11).** (a) The ch. 3 rule
  applies everywhere. (b) Only where a ch. 6 cell names gear. **Answered
  2026-11-17: (a)** (§12, "Phase 3's questions").
- **OQ5, which Acrobatics terms the landing save takes.** (a) The ch. 6 term
  only, read from the item's situational effect. (b) Both ch. 3 terms. (c) The
  ch. 6 term plus the class-level term. **Answered 2026-11-17: (a)** (§12,
  "Phase 3's questions").
- **OQ6, the archived DECISIONS entries that state figures (C9).** (a) Leave
  them. (b) Amend the frozen archive. (c) Run the leak procedure.
- **OQ7, what the UI pass covers.** (a) The crossing surface and the
  dungeon-mode windows it joins. (b) Every dungeon-mode window. (c) The
  crossing surface alone. Planned on: (a). **Answered 2026-11-16: (b)**, in
  the owner's words in §1.

## 6. What the importer owes, in order

Names of figures only. Each lands with its Judge-editable override and its
blank-with-citation degradation (`acks-printed-value`).

1. `spelunkingOutcomes.<kind>.<fail|botch>.advances` and `.unless`: a binding
   parse of the existing `spelunkingOutcomeGrid` cells. No new window.
2. `spelunking.vulnerable.<kind>` and `spelunking.progress.<kind>`: new rows of
   `spelunkingGrid`. `spelunking.botchBand` from the row label, optional.
3. `jumping.acrobaticsDexCap`, `jumping.extendedDexBands` (Jumping and
   Leaping, RR p. 271).
4. `swimWaterPenaltySteps` in place of `swimWaterModifiers` (Swimming and
   Drowning, RR p. 271), after OQ1.
5. A `squeezingProse` recipe: `contortionismBonus`, `chokepointFeet`,
   `escapeFeet`, `escapePenaltyStep` (Squeezing, RR p. 271).
6. `climbPacePenalties`, `crawlPacePenalties`, `balancePacePenalties` (RR pp.
   269-270).
7. `grappleRangePenalties`, `grappleCounterweightAc` (Climbing, RR p. 268).
8. `rappelSecureRounds`, `traverseSecureRounds`, `traverseTightenRounds`,
   `traverseLoadPerRope` (RR p. 269).
9. `belayTarget`, `belayDangerMargin` (Belaying, RR p. 270).
10. Cookbook rows, abilities' side (RR ch. 3): Mountaineering's cap and kit;
    Cat Burglary's traverse term and catch-yourself penalty.

The Swimming, Acrobatics landing, Cat Burglary ledge-save and Contortionism
escape-save terms are already imported as effects and want only the
granted-modifier read.

## 7. The rest of the dungeon backlog

Triaged read-only by an `architect`, 2026-11-16, row by row against the code.
The obstacle row (§4) is row 1 and was not re-audited here.

### The batch, in build order

Each importer half sits directly before its reader.

| # | Row | Kind and tree | Size | Blocked on | Walk (TESTING section) |
|---|---|---|---|---|---|
| 1 | Obstacle crossing (§4, §8) | new surface, topic | several phases | per slice | new recipe |
| 2 | ROADMAP §3 item 1: the disarm-or-discharge choice is asked of the wrong seat. `trap-zone.mjs` `attemptDisarm` calls a private `askDischarge` on whichever client runs it; `lib/sockets.mjs` exports only `executeAsGM`. | fix, `main` | M | nothing | "Steps" 8 and 11, a real player seat |
| 3 | ROADMAP §6 step 1: the door figures import. No door recipe in `table-recipes.mjs`. | printed-value move, two commits with 4 | M | nothing | "The delve's figures, imported" |
| 4 | ROADMAP §6 step 2: `doors.mjs` reads them (`BASH_STR_FACTOR`, `MAX_SPIKES`, `DOOR_KINDS`, the magnitudes in `bashPlan` and `bashDoor`). `api.formation.doors` publishes the module, so `apiVersion` moves. | as 3 | M | 3 | "Steps" 13 |
| 5 | Turn plan: a door within reach. No door reader exists beside traps' `knownPlacementsNear`; it never lists a secret door to a player. | new surface, topic | S to M | nothing | "The turn plan" |
| 6 | Turn plan: battering as a plan choice. `turn-plan.mjs` `BATTER_KEY` has no length and opens no door. | new surface, topic | S | 4, 5 | "The turn plan" |
| 7 | ROADMAP §1: Mapping's secret throw. `def.prof.mapping` carries no `rolls` spec, so a `kw:mapping` check would resolve no target; the importer half comes first (RR ch. 3, Mapping), then a Judge-only `PARTY_CHECKS` entry for mappers who can work (`mappersOf`). | new surface, topic | M | nothing | "The mapper", "The audit roll", a new step |
| 8 | ROADMAP §6a: `trap-rules.mjs` `CRUDE`. A window beside `pitSpikeProse` (JJ ch. 8, Crude Traps), then `trapFigures` reads it. Edits `attemptDisarm`'s neighbours, so it follows 2. | printed-value move, two commits | M | 2 | "Steps" 4, 7, 8 |
| 9 | ROADMAP §6a: `encounter-scaling.mjs`. One more window in `delveEncounters`; `encounterShift` takes the rate as an argument. `announceShift` rolls a reaction of its own beside influence's; `district-influence.mjs` feeding `acksExtras.influenceModifiers` is the precedent. | printed-value move, two commits | M | nothing | "The wrong-floor shift" |
| 10 | ROADMAP §6a: the zone schema's `max` on `encounter-zone.mjs` and `district-zone.mjs` fields. Both dice are already imported. | printed-value move, `main` | S | nothing | shares 9's |

Routing follows `shared-tree.md`: rows 1, 5, 6 and 7 are features and are
built on the topic; rows 3-4, 8 and 9 are multi-commit moves, which the rule
lets ride the topic; rows 2 and 10 are single fixes written in `main`'s tree.

### Left out, and why

- **The wandering-monster tables' importer half** (ROADMAP §1): large, the
  importer's own wave, and it carries a routing conflict between the importer
  ROADMAP and the importer's 2026-09-23 chart ruling that its plan settles.
- **The combat-speed ratio** and **`ROLE_GEAR`'s parchment cost** (§6a): each a
  single-commit fix in `main`'s tree that needs no branch. The ratio needs no
  import: core derives `movementacks.combat` and `lib/capacity.mjs`
  `explorationSpeedBearing` already runs that derivation.
- **A fight that is over**: a mode-agnostic fix in `main`'s tree.
- **Key and lockpicking, the detach leash, the trail with no GM, earshot,
  running fatigue**: each waits on a question below.
- **The corridor-width toggle**: stands against the in-force 2026-11-04 entry
  "The column stands inside its walls"; the row is to be deleted.
- **Surprise**: core rolls the matrix and its modifier stack, and no module
  seam reaches the stack.
- **Strenuous activity per delve hour; the party's position as its centre;
  the mapping system's remainder**: each large, or with its reason mostly gone.
- **The night; one owner for chat visibility**: not delve work.

### Backlog questions for the owner

- **BQ1, a door's lock (turn plan, key and lockpicking).** (a) Formation
  registers key and pick, thrown as `equipment/locks.mjs` throws a
  container's. (b) Equipment extends `locks.mjs` to wall doors and formation
  only registers the activities. (c) Neither; delete the row.
- **BQ2, the detach leash (§6a).** (a) Keep it as a clock guard. (b) Remove it
  as a house limit. (c) Keep it behind a Judge switch.
- **BQ3, the trail with no GM online.** (a) A straight column is enough;
  delete the row. (b) Build a second single writer.
- **BQ4, earshot and noise.** (a) It stays the Judge's; delete the row. (b)
  Import RR ch. 6's earshot table and show its reach on the listen card.
- **BQ5, running fatigue.** (a) Leave it to the Judge; delete the row. (b)
  Keep it for a later batch.

### ROADMAP sentences that are false today

A `doc-scribe` chore in `main`'s tree, checked against the code first.

1. §6a's `party-rolls.mjs` row: built 2026-11-11; `resolveCheck` holds no
   literal. The one figure the file still reads is §6's Strength factor.
2. §6 step 1's route and step 2's model: the delve's figures arrive through
   `TABLE_RECIPES.formation` and `formation-binding.mjs` and are read through
   `formationValue`. The Strength factor is printed in RR ch. 1.
3. §6 "the bash target": on the triage's reading (fan compendium only, not the
   page) it is the figure RR ch. 3's Adventuring prints for Dungeonbashing,
   which `def.prof.adventuring` already imports and `resolveCheck` already
   resolves; `bashDoor` resolves it a second way and ignores a held skill and
   conditions. Row 4 checks the page before acting. Precedent:
   `equipment/locks.mjs` `bashOpen`.
4. §6's closing sentence: the module docstring no longer states the
   magnitudes; `bashPlan`'s spike comment and `spikeDoor`'s docstring do.
5. §6a's "Each needs its own ruling": overtaken by the owner's "Values: import
   or drop" (DECISIONS 2026-11-13, the trap-figures entry).
6. §1 Mapping omits its importer half. §1 Sequence of play is mostly built.
   §1 Surprise says the procedure is not automated.
7. §6a `encounter-scaling.mjs`, "and the reaction step": the shift is the
   level difference itself.
8. "The party's position is its centre" argues from frontage edits resizing
   the token; `scene-sync.mjs` `partySizeTarget` targets one cell.
9. "Scoped effects for ability matching" rests on hardcoded bonuses deleted
   2026-11-11.
10. MODEL "Deliberate non-features", first line: `combat-bridge.mjs` counts
    combat rounds.

## 8. The crossing surface

Designed read-only by an `architect`, 2026-11-16, from §4. Offline reading
only; nothing here was seen live. Findings A1, A3, A6, A8, C1, C2, C4, C5, C9
and the `module.mjs` comment were re-read against source by that pass and
hold.

### Where it lives

A section of the party sheet's Dungeon tab, "The crossing": a new partial
`templates/formation/formation-crossing.hbs` included from
`formation-tab-dungeon.hbs`, its context from a new `buildCrossingView` in
`formation-view.mjs`. It renders inside the mode part, which already scrolls at
its root (`party-actor.mjs` `PartySheet.PARTS`), so a press keeps the scroll.

- The Judge always sees a begin row in Dungeon mode: a kind pick and Begin.
  With a crossing open every seat sees the member rows, and the Judge also
  the setup fields. A player sees the section only while a crossing is open.
- Actions in `formation-actions.mjs` `SHARED_ACTIONS`: `crossingBegin`,
  `crossingEnd`, `crossingThrowAll` (Judge); `crossingThrow` (any seat, by
  member). Judge fields named `crossing.*` route through `onChangeForm`.
- One new relay kind, `crossing`, in `player-requests.mjs` `executeRequest`.
- `scripts/formation/crossing-logic.mjs` holds the logic and imports nothing
  from Foundry; `scripts/formation/crossing.mjs` holds the glue (`readCrossing`,
  `writeCrossing`, `writeMemberStep`, `throwFor`).

Reused, not rebuilt: `resolveCheck`, `obstaclePlan`, `readThrow`,
`obstacleOutcome`, `outcomeProvenance`, `canClear`, `landingSave`,
`landingFailure`, `fallFigures`, `lib/roll-card.mjs` `renderRollCard`,
`postToJudges`, `announceDeclaration`, `lib/capabilities.mjs` `hasCapability`,
`lib/held-condition.mjs`, `lib/press-focus.mjs`.

The three timescales: a press throws one stretch for one member (the Spelunking
columns); a prompt at the member's turn in combat throws the round (swimming,
squeezing, Phase 2); a jump is a verdict row with no throw.

### Seats

| | Judge | Player who owns the member | Any other seat |
|---|---|---|---|
| Section | always, in Dungeon mode | while a crossing is open | while open, read-only |
| Begin, End, setup fields | yes | not rendered | not rendered |
| Throw | any member | owned members only | none |
| A permission refusal (the grid refuses the member, a proficiency not held, an impossible jump) | warned, and the throw proceeds on the actor's own figure; the card says it was thrown over a refusal | blocked, the reason as text on the row | |
| An absence refusal (a figure not imported) | refused; nothing is rolled | refused | |
| A seat refusal (not the owner; a member down, left behind or detached) | | blocked locally; the GM client checks again and whispers the refusal | |
| Declaration | none | `announceDeclaration`, public | |
| Result card | `postToJudges`, as every party check card | same | same |
| Row state (covered, across, fell) | shown | shown | shown |

The absence row is the one place a Judge is refused too: proceeding would roll
against a guess (DECISIONS 2026-11-11, the import entry).

### Inputs, first slice

| Kind | Input | Source | With nothing imported |
|---|---|---|---|
| Obstacle | kind | Judge pick among the `OBSTACLES` keys | structure |
| | length | Judge field | blank is one stretch |
| | stretch | `stretchFeet()` | the throw is refused for everyone |
| | permitted or not | `adventuringTarget(kind)`, as permitted-or-not only | the row is blank |
| | holds Climbing | `hasCapability(actor, "kw:climbing")` or the name, as `rest.mjs` reads Endurance (§3) | |
| | the member's figure | `resolveCheck(actor, climbCfg)`, a cfg local to the crossing (`capability`, `rollKey`, `advKey` all the climb's): a holder throws on the skill ladder, anyone else on the actor's own Adventuring field, which characters alone carry | a blank target, its tooltip the page reference |
| | conditions | inside `resolveCheck` | |
| | Judge modifier | Judge field | zero |
| | rope fixed | Judge checkbox, in place of `assisted` | off |
| | outcome on a miss | `obstacleOutcome` | the miss ends the attempt |
| | traverse depth | Judge field | the fall distance reads unknown |
| Jump | gap, run-up, precarious, charging | Judge fields | |
| | the member's score, level, weight | the actor's own Dexterity score and level; `formation-model.mjs` `carriedLoad`'s per-member reading for the stone carried | |
| | holds Acrobatics | `kw:acrobatics` or the name | |
| | the Acrobatics cap and bands | the `jumping` table after S4; nothing is passed before it | the leap reads unknown for an acrobat |
| | range and verdict | `jumpDistance`, `canClear` | the verdict reads unknown |
| | landing | `landingSave`, then core's `rollSave`; the footing after a miss is the Judge's pick, then `landingFailure` | |

Mountaineering is not read in the first slice: a holder of it alone is treated
by the grid's column and the Judge may proceed. It waits on B11, OQ2 and OQ4.

### Tooltips

Numbers interpolate at render; no lang string holds a figure or a rule
sentence. Keys under `ACKS-FORMATION.crossing`.

| Figure | Shape (`ui-tooltips.md`) | Parts |
|---|---|---|
| a member's target | computed | each of `resolveCheck(...).parts` with its own cite, the Judge modifier, conditions |
| permitted or refused | imported table | the row, `citeOf(FORMATION_DOC, "spelunking")` |
| stretch, throws needed | imported | the same cite |
| outcome words | imported | `outcomeProvenance` |
| covered of length | computed | stretches made, the stretch and its cite |
| fall distance | computed | covered and the stretch's midpoint (RR ch. 6, Spelunking) |
| fall dice | imported | `fallFigures`, `citeOf(…, "fall")` |
| jump range, verdict, faces that clear | computed | `jumpDistance` parts, `canClear` |
| landing save | computed | the save's name, the bonus's source effect |
| Judge modifier | set by hand | that the Judge set it |
| any blank field | nothing behind it | the page reference alone |
| a glyph button | a control's name | `aria-label`, an empty `data-tooltip` |

### Layout

Part-root scroll (the party sheet's own). No literal `id=`; `for=` from
`{{@root.partId}}`. Ramp steps only. Labels wrap their controls; glyphs are
`inert`; no control inside a `<summary>`. The rows grid gives names
`minmax(0, 1fr)`. `PartySheet` is not a frame sheet, so `PressFocus` is wired
by hand (`lib/README.md`). Nodes are told by `nodeType` and `matches`.
Live-only: the sheet's floor, clipping in narrow rows, the type knob on a
fresh window, a detached window, two party sheets at once.

### State

| Datum | Where | Writer | Life |
|---|---|---|---|
| setup: id, kind, obstacle, length, depth, rope, Judge modifier, gap, run-up, precarious, charging | the party actor's `flags["acks-extras"].crossing` | the GM, whole, as `turn-plan.mjs` `writePlan` writes | Begin to End; End unsets it |
| per member: covered, throws, state (climbing, across, fell, stalled), last | `crossing.members.<actorId>` | the executing GM client, one dotted-path update per member | the same |
| targets, verdicts, permission, tooltip parts | recomputed in `buildCrossingView` | | each render |

Per-member writes because `handlePartyRequest` awaits with no queue: two
relayed throws can interleave, and a whole-flag write would drop a step whose
card still stands. Guards: an in-flight set keyed by crossing and member, and
a crossing-id check before each write. A member removed mid-crossing is
ignored and dropped at the next write. The crossing does not close on a move;
the Judge ends it. The first slice applies no condition, spends no time on the
clock, and reports fall damage without touching hit points.

### Positions taken, each with its strongest counter

| Position | Counter | Strength |
|---|---|---|
| A tab section, not a dialog | Trapbreaking's precedent is a dialog, and the tab gets busier | medium: that dialog has no refresh, a fixed id and a footer that scrolls away (§10) |
| A climb cfg local to the crossing, not a `PARTY_CHECKS` entry | an entry would give the Skill audit a climb column | medium: every check consumer would pick it up |
| Cards to the Judges | a climb is seen at the table | medium: OQ10 |
| One press, one throw | `attemptObstacle` rolls a whole climb | medium: `crossingThrowAll` throws a step for everyone |
| A miss that does not advance stalls the batch `attemptObstacle`, with no re-throw | §4 A1 says re-throw | medium: a re-throw has no printed bound, and a cap would be an invented figure |
| A formation `combatTurnChange` listener, not a lib registry | lib already listens on that hook | medium: one consumer; promote at the second |
| No clock until S17 | a crossing takes time | low |
| Absence refuses the Judge too | the block-or-warn ruling reads as universal | medium |
| S2 to S4 in `main`'s tree | an importer for a kind of entry is a feature | medium: each adds leaves to an existing table and moves a printed value or corrects a shipped read |

Rejected: a Trapbreak-style dialog; the crossing as a turn-plan activity
(`memberBlock` refuses after a move and in combat, a move cancels the plan,
and a peer is editing the turn plan); a `PARTY_CHECKS` climb entry; writing the
whole flag per throw; producing `.unless`, `progress` or `vulnerable` before
its reader; closing the crossing on a move; reading Mountaineering as
permitted before OQ2 and OQ4.

### Owner questions the design adds

- **OQ8, the jump attempt (unblocks S19).** (a) At the attempt the distance's
  die is rolled and the footing follows; the verdict is still shown first. (b)
  Verdict only; the Judge picks the footing. Recommended: (a). It supersedes
  in part the 2026-08-15 entry's rejection of a single roll; the new evidence
  is that the imported shortfall die and the footings have readers nothing can
  feed without an attempt's result. **Answered 2026-11-17: (a).**
- **OQ9, the per-round throw in combat (unblocks S13, S15).** (a) A prompt
  card at the member's turn, whose button throws. (b) The throw rolls itself
  at the start of the turn. (c) No driver; presses from the section only.
  Recommended: (a). **Answered 2026-11-17: (a).**
- **OQ10, the crossing card's audience (S7 ships (b)).** (a) A public card.
  (b) A public notice for a player's press, the card to the Judges, row state
  on every seat. (c) The card to the Judges and the rows hidden from players.
  Recommended: (b). **Answered 2026-11-17: (b).**

## 9. Slices

Every runtime slice carries its `changelog.d/` fragment (naming the control's
path), its lang keys under `ACKS-FORMATION`, and the TESTING section it
changes. Every printed-value slice follows `acks-printed-value`: the import
with its `PRODUCES` entry, the Judge-editable override, blank with the page
reference when absent.

**Agents.** `implementer` builds each scoped slice, since the design is ruled
here; a slice that turns up a design question stops and goes to `architect`.
`doc-scribe` takes the docs chores. `architect` rules S26's two-owner
question before an `implementer` builds it. The phase's own session reviews
each diff for the word and value rules (no gate can), lands, and walks.

**Order.** Slices that share a file run one after another, never in parallel;
the table at the end of this section lists the files. A topic slice is
preceded by `acks-branch sync dungeon-closeout`.

### Phase 1: the first surface (no owner question)

| Id | Tree | Agent | Scope | Closes | Offline acceptance |
|---|---|---|---|---|---|
| S1 | `main` | implementer | `obstacles.mjs`: `readThrow` tests the natural result first; `OBSTACLES` loses `vertical` and `descendOnly`; the header rewritten as mechanics. `swimming.mjs`: `swimmingThrow` answers the no-throw case for a holder only; `partySwim` and `tools/live/formation-day.mjs` follow. `jumping.mjs`: `landingSave`'s docstring. `module.mjs`: the comment. Lang: `obstacles.reason.notPermitted`, `.rappel`, `.easyClimb`. A new `tools/test-swimming.mjs`, registered in `tools/run-tests.mjs`. Two published fields go, so the `apiVersion` policy is checked. | A3, A6, C2, C4, C5, C9, D | the lowest face with a total at or over the target reads a botch, and restoring the old order fails it; a non-holder with a nil target still throws, and dropping the input fails it |
| S2 | `main` | implementer | `formation-binding.mjs` `parseOutcomeCell` gains `advances`; `obstacles.mjs` `obstacleOutcome` returns it, a new pure `obstacleStep` answers covered, across, fell or stalled, and `attemptObstacle` uses it. `.unless` is not in this slice. Changelog `upgrading`: a re-import. | A1, §6.1 in part | a miss that does not advance, then a make, leaves the member not across; counting every miss fails it; an absent `advances` ends the attempt |
| S3 | `main` | implementer | New `spelunkingGrid` rows for `vulnerable` and the botch band; `OBSTACLES` loses `vulnerable`; `readThrow` reads both through `formationValue`. The band is the Spelunking grid's own row and is read by nothing else: the floor literal in `trapbreak-app.mjs` and `door-app.mjs` is the general automatic-failure rule (RR Introduction, "Throwing the Dice"), a different figure, and is U1's and Phase 4's. A DECISIONS entry supersedes in part the 2026-11-11 import entry's clause on helplessness, naming the 2026-11-14 ruling as the new evidence, and qualifies its `## In force` row in the same change. | C1, C3, §6.2 in part | with nothing imported, vulnerable is null; restoring the constant fails it |
| S4 | `main` | implementer | `jumpingProse` and `assembleJumping` gain `acrobaticsDexCap` and `extendedDexBands`; `jumping.mjs` `dexModifier` reads the bands, `effectiveDex` defaults its cap from the import, `leapHeight` uses the raised score's modifier. A DECISIONS entry supersedes in part the two archived 2026-08-15 jumping entries (the cap's owner; the stale premises), evidence the §4 audit, and qualifies both `## In force` rows. The archive is not edited. | A7, C7, D, §6.3 | a leap on the un-raised modifier fails; missing bands answer null, never a table edge |
| U0 | `main` | implementer | Lang strings that state a rule are rewritten to say what the field does, the page reference kept or moved to the consumer's comment: `app.speedHint`, `app.paceHint`, `traps.mayTryAgain`, `traps.noSecondHastyTry`, `traps.refuse.hastyNeedsSkill`, `doors.spikeHint`. | §10's word findings | `validate`; a hover pass at the walk |
| S5 | `main` | doc-scribe | `docs/formation/ROADMAP.md`: §1's row, §3 item 3, §6a's `obstacles.mjs` row, and §7's list of false sentences, each checked against the code after S1 to S4. | D | none |
| S6 | topic | implementer | New `crossing-logic.mjs`: the local climb cfg; `memberRow` with its three refusal classes; `stepMember` on `obstacleStep`; `fallFromClimb` and the traverse depth; `jumpRow` on `canClear`. `obstaclePlan` and `attemptObstacle` rename `assisted` to `ropeFixed` (a published name; changelog `changed`). New `tools/test-crossing.mjs`. | B2, B8, A4 in part, A8 in part | a Judge's permission refusal proceeds and an absence refusal does not; swapping the classes fails it; a fall distance without the midpoint fails it |
| S7 | topic | implementer | New `crossing.mjs` and the partial; `buildCrossingView`; the four actions and the `crossing.*` branch of `onChangeForm`; `PressFocus` wired in `party-actor.mjs`; `styles/formation.css`; the card through `renderRollCard` and `postToJudges`. MODEL and TESTING gain "The crossing". Changelog `added`, path: Actors sidebar, party sheet, Dungeon tab, The crossing. | the surface | `buildCrossingView` gives blank rows with their citations when nothing is imported; a target filled in then fails it |
| S8 | topic | implementer | `executeRequest` case `crossing`: `userOwnsMember`, the crossing open and its id matching, the member's state, the in-flight guard, `announceDeclaration`, a whispered refusal. `buildPlayerPanel` gains `canCross`; the partial's player rows. | the player seat | a non-owner is refused, and removing the ownership test fails it; two interleaved requests both land, pinned with a fake async update |
| S9 | topic | implementer | The jump rows: verdicts; precarious or charging to `landingSave` and core's `rollSave`; the Judge's footing to `landingFailure`. | the no-throw timescale | the rows equal `canClear`; dropping the run-up input fails it |

S1 to S5 and U0 land through `acks-commit` as they pass. S6 to S9 land with
`acks-branch land` as one landing, and the phase then walks §11 on `main`. A
feature is not reported built until that walk has run.

### Phase 2: the round rules

OQ1, OQ8, OQ9 and OQ10 were answered on 2026-11-17 (§13, "Owner answers"), so nothing in this phase waits on the owner.

**Design approved 2026-11-17.** `ui-layout.md` "Design before build" was
synced after this plan was written, so Phase 2 drew its surface first: six
boards at https://claude.ai/artifact/JmdFLnu3QPncGFCxQspvMX (private to the
owner). They show swim on the Judge and Player seats, the combat prompt card,
the squeeze with its two escapes, the climb's pace pick, rounds spent and held
conditions, and the jump attempt. The owner's word, relayed by the managing
session: "Go". S13, S15, S16, S17's round count, S18's chips and S19 are
built to those boards.

| Id | Tree | Agent | Scope | Closes | Blocked on |
|---|---|---|---|---|---|
| S10 | `main` | doc-scribe | `docs/guides/formation.md` gains the crossing step; a `docs/GALLERY.md` row. The shot is of a crossing a user set up through the section. | the guide | Phase 1's walk |
| S11 | `main` | implementer | `parseWaterModifiers`, `WATER_KEYS`, `swimWaterPenaltySteps` in place of `swimWaterModifiers`, `module.mjs` `expectTables`, `swimming.mjs` `WATER` and `waterModifier`, lang `swimming.water.*`, and the suite that pins the misreading. | A5, C6, §6.4 | OQ1 |
| S12 | topic | implementer | Swim rows in `crossing-logic.mjs`: `swimmingThrow` with the holder, `drowning`, `rescueStone`, the pace share; a creature with a swim speed takes no throw. | B13, logic | S1, S11 |
| S13 | topic | implementer | Swim rows on the section; a new `crossing-driver.mjs`, a `combatTurnChange` listener on the primary GM posting a prompt at a crossing member's turn; drowning applied and lifted. Check `topic/summons-formation` first. | B13, surface | OQ9 |
| S14 | topic | implementer | A `squeezingProse` recipe and its binding. | B1 import, §6.5 | nothing |
| S15 | topic | implementer | Squeeze rows; `stuck`; the two escapes through core's save and `resolveCheck(actor, PARTY_CHECKS.dungeonbashing)`; the S13 driver. | B1 | S13, S14 |
| S16 | topic | implementer | The three pace-penalty rows, then a pace pick on a holder's row; two commits. | B6, §6.6, A8 in part | S7 |
| S17 | topic | implementer | The grid's progress row; the crossing spends rounds through the existing round advance. Check `topic/spell-effects` first. | B7, §6.2 in part | S7 |
| S18 | topic | implementer | `holdCondition` and `releaseCondition` with a crossing marker, released on across, fell, End or removal. | B10 | S3, S7 |
| S19 | topic | implementer | The jump attempt: the die, the footing, `landingFailure`; the distance against the round's movement; a hanging jumper's climb up on `stepMember`. A DECISIONS entry for OQ8. | B14 | OQ8 |

### Phase 3: the windows it joins, and the proficiency terms

OQ2 to OQ5 were answered 2026-11-17 (§12, "Phase 3's questions"); it asks
none of them again, and S24's brief puts OQ11. The UI slices are §10's findings.

| Id | Tree | Agent | Scope | Closes | Blocked on |
|---|---|---|---|---|---|
| U1 | `main` | implementer | `trapbreak-app.mjs`, `door-app.mjs`: an id built from the party and the actor; a re-render when their subjects change; `cite` kept on the parts; a pinned footer; a Judge warned where a player is blocked; `PressFocus`; the Trapbreaking floor read from the general rule's reader. | §10 Trapbreaking 1-7, 9-10; Door 3, 7, 9 | nothing |
| U2 | `main` | implementer | `formation-strip.hbs` (the speed's parts, the rest, carry and elapsed tooltips), `formation-player-actions.hbs`, one home for the Trapbreaking opener, `planLock` warning the Judge. Check `topic/spell-effects` first. | §10 Dungeon tab 1, 3-9, 11 | nothing |
| U3 | `main` | implementer | `door-app.mjs`: the basher captured at render and re-rendered on `controlToken`; partners limited to the party and the scene. | §10 Door 1-2 | nothing |
| S26 | `main` | architect, then implementer | One owner for the Swimming term; a granted-modifier read for the Swimming, Acrobatics, Cat Burglary and Contortionism terms; `landingSave`'s `saveBonus`. | C8, the §6 read | OQ5 |
| S20 | topic | implementer | `parseOutcomeCell` `unless`; the member inputs; `readThrow`'s exemption. | A2, §6.1 | OQ2, OQ3 |
| S24 | topic | implementer | The cookbook rows; Mountaineering's kit, cap and leader's throw; the assisting mountaineer. | B11, A4, A8 in part, §6.10 | OQ2, OQ4 |
| S25 | topic | implementer | Damage on a narrow or precarious path: a save, or a fall. | B9 | S26 |

### Phase 3b: the party sheet in dungeon mode

Added on OQ7's answer; §10's wider pass is its findings. It runs after Phase 3
and before Phase 4, as a clean session of its own, and asks nothing of the
owner at its start. Every slice shares `formation-view.mjs`, `lang/en.json`,
`party-actor.mjs` or `styles/formation.css` with another, with S7 and S8, and
with U2, so they run one after another in this order. All are surfaces already
shipped, so all are `main`'s tree. Before its first slice the session
registers Frame 2 and Kit 2 on the bug-intake ledger, source
`tooltip:2026-11-16`: two figures whose tooltip cannot be written yet.

Nothing in the wider pass was seen live. This phase's walk, and Phase 3c's, is
§10's two "Only a live look settles" lists for the surfaces its slices
touched, hovered figure by figure against the pages they name, with a real
player seat wherever a finding names one; what the walk settles goes into
`docs/formation/TESTING.md` with the slice.

| Id | Tree | Agent | Scope | Closes | Blocked on |
|---|---|---|---|---|---|
| U4 | `main` | implementer | Lang strings that state a rule are rewritten to say what the field or the module does, the page reference kept, or moved to the comment beside the consumer (`buildWarnings`, `ROLE_HINTS`). The session reads every rewritten string itself before it lands. | §10 Frame 6; Order 5, 8, 9; Kit 4; Trap sheet 9; discharge 3; small dialogs 6 | U0 landed |
| U5 | `main` | implementer | Provenance on the band, the figures rail, the overline and the tab heads: parts and page for each figure, the rest bar's page reference when nothing is imported, `data-tooltip-text` for a string assembled at render; `formatTurns` reads lib's `TURN_SECONDS`. `tools/test-party-frame.mjs`. | §10 Band 1; Frame 1, 3, 4, 5, 9 | S7, U2 |
| U6 | `main` | architect, then implementer | Which count a stack eats by, read from the page (`rules-lookup.md`); then `campSupplies`, `consumeRations` and `provisions.mjs` agree with the Mouths cell, and the cell's tooltip lists parts that give the figure. A page that does not settle it is the owner's question, put once. | §10 Frame 2 | the ruling |
| U7 | `main` | implementer | The Order tab's figures and glyphs: tooltips with their parts for speed, encumbrance, a carrier's load, the train's pace and counts, and the stack's body count; the dark-sight chip's source and its page reference when unread; an accessible name on every state glyph; a mark beside colour for the slowest. | §10 Order 4, 6, 7, 10, 11, 12 | U5 |
| U8 | `main` | implementer | Keyboard routes and names: buttons where an `<a>` with no `href`, an `<img>` or a `<span>` takes the press; the map name shown only where `canOpen`; a lit state in text and in the toggle's name; `inert` glyphs. | §10 Frame 10; Order 1, 2, 3, 15; Kit 5, 6, 8 | U7 |
| U9 | `main` | implementer | Refusals say why, on the surface: a reason beside take-out, detach and anchor; the Judge warned and let through where `toggleDetachMember` itself does not refuse. | §10 Order 13, 14; Kit 7 | U8 |
| U10 | `main` | implementer | The Kit tab: a citation key for the light table's page, shown on a blank burn figure and on the light types; the tracked spell's record keeps where its count came from (`addSpell`, `adjustSpell`, the `spell` request) and the tooltip says it; labels on the add-spell inputs. | §10 Kit 1, 2, 3 | U9, S8 |
| U11 | `main` | implementer | Layout: the active panel keeps a usable height under the frame, the warnings and an open Key; the art row wraps or takes an em container breakpoint, the window's floor left as ruled 2026-10-15; `scrollable` gains the members grid and the description box; member controls sized off the ramp. | §10 Frame 7, 8, 11; Order 16, 17 | U10 |
| U12 | `main` | implementer | The band's focus and uncommitted name text kept across a re-render, with S7's `PressFocus`; an open description edit not rebuilt by a peer's write; the overline clock redrawn on `updateWorldTime` in dungeon mode. | §10 Band 2; Frame 12, 13 | U11, S7 |
| U13 | `main` | implementer | The strip's combat figure by `acks-printed-value`: core's own encounter-movement reader first; the unread `combatSpeed` removed. `tools/test-strip.mjs`. | §10 the view's finding 1 | U2 |

### Phase 3c: the other dungeon windows

Also added on OQ7's answer, after Phase 3b and before Phase 4, a clean session
of its own. `main`'s tree throughout. U14 and U15 share `skill-audit.mjs` and
run in that order; the rest share only `lang/en.json` and
`styles/formation.css` and run one at a time.

| Id | Tree | Agent | Scope | Closes | Blocked on |
|---|---|---|---|---|---|
| U14 | `main` | implementer | The Skill audit's mechanics: an id per party, a re-render when the party or an ability item changes, the scroll on a part root, `PressFocus`, sizes off the ramp, columns that scroll and do not clip. `tools/live/formation-audit.mjs` finds the window by its new id. **Done**: `c3bce7a2`, and `b388e2cd` for what the walk found; `formation-audit` 47 of 47 (§14). | §10 Skill audit 1-4, 11-15; Skill tab 5 | nothing |
| U15 | `main` | implementer | The audit's and the Skill tab's figures and names: one cited-parts helper shared with `rollCheckFor`; names on the Used-for selects and check names in their options; the Sheet target and the progression table with their sources; core's tooltip in place of `title`. **Done**: `a55dd9c5`, and `736dccfa` for what the walk found; `formation-audit` 60 of 60, twice (§15). | §10 Skill audit 5, 6, 8, 9, 10; Skill tab 1-3 | U14 |
| U16 | `main` | implementer | The trap sheet and the trap zone's config: the level strip's state in text; the pit's damage with its parts, and its page reference alone when a part is not imported; the trigger band shown with its source; a scrolling part root; the State select's labels and the `known` field's label. **Done**: `eb51e9b2`; `formation-trap-sheet` 23 of 23 (§14). | §10 Trap sheet 1-8; configs 1, 2 | nothing |
| U17 | `main` | architect, then implementer | The party token's HUD: a named button; `addTokensToParty` as the `architect` rules it against the 2026-11-14 ruling and formation's MODEL. `module.mjs` is shared with S1, S11, S13 and `topic/summons-formation`: check them first. The picker's part is done: on the owner's "Fix it now" (2026-11-16) `dbdf1ecf` put both openers of the picker on `marching-templates.mjs` `carryOutPick`, walked by `formation-marching-picker`, 19 of 19 on the GM seat. | §10 HUD 1, 3 (2 closed by `dbdf1ecf`) | the ruling |
| U18 | `main` | implementer | The Walls and Regions layers: the wall's trap row names its trap, opens it and takes it off; the canvas drop is tested by seat; the two tools told apart; the door tool's `order`; the Place row's button named. | §10 Walls 1-5; configs 5 | U1, U3 |
| U19 | `main` | implementer | The experience dialog: the gain's parts, the unread adjustment's page reference where it can be hovered, a re-read at confirm, a total below nothing refused; the two unescaped names; the overview's `title`. | §10 small dialogs 1-5, 7, 8 | U2 |

Findings the wider pass made that rows already in the plan close: the
discharge question's 1 and 2 are §7's row 2 (Phase 4), which also escapes the
name; the region configs' 3 and 4 are §7's row 10 (Phase 5).

### Phase 4: doors and the turn plan

§7's rows 2 to 6, cut into slices by the phase's own `architect` pass from the
code as it then stands: the disarm seat (row 2, `main`), the door import and
its reader (rows 3 and 4), a door within reach and battering as a plan choice
(rows 5 and 6, topic). Asks BQ1.

### Phase 5: rope work, the remaining moves, close-out

| Id | Tree | Agent | Scope | Closes | Blocked on |
|---|---|---|---|---|---|
| S21 | topic | implementer | The grappling hook; its throw goes to the Judges alone, with no notice. | B4, §6.7 | nothing |
| S22 | topic | implementer | Rigging and the traverse's load; the crawl's rigger. | B5, A4, §6.8 | nothing |
| S23 | topic | implementer | Belaying and the rope-length fall. | B3, B12, §6.9 | Phase 4's door import |
| | | | §7's rows 7 to 10: Mapping's throw, the crude-trap figures, the wrong-floor rate, the zone bound. | | nothing |
| U20 | `main` | implementer | A bash's Strength term shown on the Skill audit and the Skill tab as `rollCheckFor` throws it, read from where Phase 4 leaves the factor. | §10 Skill audit 7; Skill tab 4 | Phase 4's door import, U15 |
| S27 | `main` | the phase session | OQ6's answer carried out. | C9 | OQ6 |
| S28 | `main` | the phase session, doc-scribe | The substance of this file moved into MODEL, DECISIONS, ROADMAP and TESTING; this file deleted; `acks-branch close dungeon-closeout`. | | all |

### Coverage

| Finding | Slice | Finding | Slice |
|---|---|---|---|
| A1 | S2 | B6 | S16 |
| A2 | S20 | B7 | S17 |
| A3, A6 | S1 | B9 | S25 |
| A4 | S6, S22, S24 | B10 | S18 |
| A5 | S11 | B11 | S24 |
| A7 | S4 | B13 | S12, S13 |
| A8 | S6, S16, S24 | B14 | S19 |
| B1 | S14, S15 | C1, C3 | S3 |
| B2, B8 | S6 | C2, C4, C5, C9 | S1 |
| B3, B12 | S23 | C6 | S11 |
| B4 | S21 | C7 | S4 |
| B5 | S22 | C8 | S26 |

### Files more than one slice edits

| File | Slices |
|---|---|
| `scripts/formation/obstacles.mjs` | S1, S2, S3, S6, S20 |
| `scripts/importer/formation-binding.mjs`, `table-recipes.mjs`, `tools/test-formation-binding.mjs` | S2, S3, S4, S11, S14, S16, S17, S20, S24 |
| `scripts/formation/jumping.mjs` | S1, S4, S19, S26 |
| `scripts/formation/swimming.mjs` | S1, S11, S12, S26 |
| `crossing-logic.mjs`, `crossing.mjs` | S6 to S9, S12 to S25 |
| `formation-tab-dungeon.hbs`, `formation-player-actions.hbs`, `formation-actions.mjs`, `formation-view.mjs` | S7, S8, U2, U4, U5, U7, U9, U10, U13, U19 |
| `formation-tab-order.hbs`, `formation-tab-kit.hbs`, `formation-frame.hbs` | U2, U5, U7, U8, U9, U10 |
| `frame-view.mjs`, `turn-engine.mjs` | U5, U10 |
| `party-actor.mjs` | S7, U2, U7, U11, U12 |
| `skill-audit.mjs`, `party-rolls.mjs` | U14, U15, U20 |
| `door-app.mjs` | U1, U3, U18 |
| `trap-zone.mjs` | U16, §7's row 2 |
| `player-requests.mjs` | S8, S13, S15, U10 |
| `trapbreak-app.mjs` | S3, U1 |
| `scripts/formation/module.mjs` | S1, S11, S13, U12, U17, and `topic/summons-formation` |
| `styles/formation.css` | S7, U1, U2, U8, U11, U14, U16 |
| `lang/en.json` | nearly every slice, and `topic/cast-cell` |

## 10. The UI pass: findings

Offline reading against `ui-layout.md` and `ui-tooltips.md`: three windows by
the design pass, then, on OQ7's answer, every other surface dungeon mode
reaches ("The wider pass", below). Findings, not fixes; the fixes are the U
slices of §9 and the slices named. Nothing `tools/validate.mjs` §8 already fails is listed.

### The party sheet's Dungeon tab

| # | What | Where | Severity | Fix |
|---|---|---|---|---|
| 1 | The speed figure's tooltip is a rule sentence with no parts and no citation | `formation-strip.hbs`, delve branch | degrades | U0, U2 |
| 2 | The pace pill's tooltip states a rule | `formation-tab-dungeon.hbs` `togglePace` | degrades | U0 |
| 3 | The rest figure has no tooltip | `formation-strip.hbs` | degrades | U2 |
| 4 | The elapsed-rounds denominator is a template literal with no tooltip; core's figure is looked for first, else it is registered for import | `formation-strip.hbs` | degrades | U2 |
| 5 | The carry figure has no tooltip | `formation-strip.hbs` | degrades | U2 |
| 6 | A number input is named only by its placeholder | `formation-player-actions.hbs` `playerSpellTurns` | blocks a user | U2 |
| 7 | Button glyphs are not `inert` | `formation-player-actions.hbs` | cosmetic | U2 |
| 8 | The Judge's Trapbreaking opener is on the Order tab and the player's on the Dungeon tab | `formation-tab-order.hbs` `openTrapbreak` | degrades | U2 |
| 9 | `planLock` refuses the Judge as it refuses a player | `formation-actions.mjs` `SHARED_ACTIONS.planLock` | degrades | U2 |
| 10 | No `PressFocus`: after a press, keyboard focus falls to the body (mechanism read from source; the symptom wants a live look) | `party-actor.mjs` `PartySheet` | blocks a user | S7 |
| 11 | `window.resizable` is declared although the lib hook grants the corner by class | `party-actor.mjs` `DEFAULT_OPTIONS` | cosmetic | U2 |

### The Trapbreaking dialog

| # | What | Where | Severity | Fix |
|---|---|---|---|---|
| 1 | A fixed id: a second opening takes over the first window's element | `trapbreak-app.mjs` `DEFAULT_OPTIONS` | degrades | U1 |
| 2 | No re-render when the trap, the member or their conditions change | `trapbreak-app.mjs` | degrades | U1 |
| 3 | The parts lose their `cite` on the way to the template | `_prepareContext` | degrades | U1 |
| 4 | The needs figure has no tooltip, and its floor is a literal: the general automatic-failure rule's (RR Introduction, "Throwing the Dice"). Core's or lib's reader of that rule is looked for first; the door window's floor is the same figure | `_prepareContext` | degrades | U1 |
| 5 | The range figure has no tooltip | `trapbreak.hbs` | degrades | U1 |
| 6 | Any refusal disables the attempt for the Judge too | `trapbreak-app.mjs` | degrades | U1 |
| 7 | The request carries no extra modifier, so the figure shown can differ from the throw (inferred) | `trapbreak-app.mjs`, `player-requests.mjs` `trapbreak` | degrades | U1 |
| 8 | Three strings state rules | `lang/en.json` | degrades | U0 |
| 9 | The footer's buttons sit inside the scrolled body | `trapbreak.hbs` | degrades | U1 |
| 10 | The width is in px and does not follow the type size (inferred) | `DEFAULT_OPTIONS.position` | degrades | U1 |

### The door window

| # | What | Where | Severity | Fix |
|---|---|---|---|---|
| 1 | The basher is the controlled token, read at render and again at the press, with no re-render between: the window can show one basher and roll another | `door-app.mjs` | blocks a user | U3 |
| 2 | The partner list holds every character in the world | `door-app.mjs` | degrades | U3 |
| 3 | A fixed id | `door-app.mjs` `DEFAULT_OPTIONS` | degrades | U1 |
| 4 | The needs and batter figures have no provenance; their sources are §7's rows 3 and 4. Registered on the bug-intake ledger as `tooltip:2026-11-16` by Phase 1 | `doors.mjs`, `door.hbs` | degrades | Phase 4 |
| 5 | The spike cap reaches the screen as a figure | `door.hbs` | degrades | Phase 4 |
| 6 | The spike hint is a rule sentence | `lang/en.json` | degrades | U0 |
| 7 | One hint repeated under two fields | `door.hbs` | cosmetic | U1 |
| 8 | The needs floor is a literal | `door-app.mjs` | degrades | Phase 4 |
| 9 | The width is in px (inferred) | `DEFAULT_OPTIONS.position` | degrades | U1 |

Only a live look settles: every window's floor and horizontal clipping, the
type size on a fresh window, a first render in a detached window, two copies
open, the footers on a short display, and focus after a press.

### The wider pass: what "every dungeon window" takes in

OQ7's answer (§1) widened the pass. Two `architect` readings on 2026-11-16,
offline, against the same two rules, the word and value rules, and the
2026-11-14 ruling that a player is blocked where a Judge is warned. The test
for a surface: it renders, or can be opened, while the party's mode is
`delve`. A finding marked (inferred) has its mechanism read in source and its
symptom still to be seen live. The planning session re-read Order 1 to 3,
Kit 6 and the strip's combat figure in source; they hold.

**The party sheet, in.** Each with the symbol that shows it renders in
`delve`:

| Surface | Shown by |
|---|---|
| Band: crest, the Judge's mode pick and name field, the rest bar | `framePartIds`; `bandBar`'s delve branch |
| Frame art row: saves, plate, figures, tools, reading column, sheet tools | `buildFrameView`, `figureCells`, `framePlate` |
| Frame: the Key, the warnings | `keyLegend` on `toggleKey`; `buildWarnings` |
| Tab row and each tab's head | `frameTabs`, `headsOf` |
| Order tab: the Judge's head actions, ranks, bring-in, train, the mount's station chip | part `order`, ungated but for the two journey blocks below |
| Kit tab: lights, magic lights, tracked spells, maps | part `kit`, ungated |
| Sightings tab and Judge tab: the head and the off-journey line | `travel.isJourney` false |
| The stack badge | `PartySheet` `#markStacks` |

**The party sheet, out.** `formation-tab-city.hbs` and
`formation-tab-wilderness.hbs` (`MODE_TEMPLATES` settlement and journey);
`formation-country.hbs` and its card (included only on a journey); the Order
head's two arrangement actions and a member's conveyance block (journey only);
the Sightings day log and the Judge tab's five journey sections
(`travel.isJourney`); the frame's territory, following and astray chips, its
day, hex and season, the journey bar, the hours to dusk, the blocks per turn
and the journey tools (journey or settlement branches).

#### Band

| # | What | Where | Severity | Fix |
|---|---|---|---|---|
| 1 | The rest bar's tooltip `ACKS-FORMATION.frame.bar.restTitle` names the field and not the page its interval was imported from; with nothing imported (`frame.bar.restUnpriced`) it carries no page reference either | `frame-view.mjs` `bandBar`; `formation-band.hbs` bar block | degrades | U5 |
| 2 | Core restores focus by finding the prior part inside the content box, and the sheet has moved the band into the window header: every re-render, a peer's write included, drops the Judge's focus and any uncommitted name text (inferred). A different mechanism from the Dungeon tab's finding 10 | `party-actor.mjs` `#moveBandIntoHeader`, `_preSyncPartState` | blocks a user | U12 |

#### Frame

| # | What | Where | Severity | Fix |
|---|---|---|---|---|
| 1 | Each figures-rail cell (hit points, supplies, mouths, pace, light) takes `ACKS-FORMATION.frame.cell`, its own name and reading, as its tooltip: no parts and no page, though `lightCite` and the members' speeds are at hand | `frame-view.mjs` `figureCells`, `railCell` | degrades | U5 |
| 2 | The Supplies figure counts one mouth per member actor (`campSupplies`, as `consumeRations` does) and the Mouths cell beside it reads `partyHeadcount`, which counts a stack's bodies. With a stack in the party the two disagree and no tooltip can list parts that give both | `formation-view.mjs` `campSupplies`; `figureCells` | degrades | U6 |
| 3 | The overline's clock and the heads chip (`ACKS-FORMATION.frame.chip.heads`) have no tooltip | `frame-view.mjs` `readingOf`; `formation-frame.hbs` reading block | degrades | U5 |
| 4 | The tab heads' figures have no tooltip: the turn count and elapsed time in `frame.head.delve`, the heads and frontage in `frame.head.order` | `frame-view.mjs` `headsOf` | degrades | U5 |
| 5 | VALUE: the elapsed time comes from `formatTurns`, which keeps a literal for a turn's length beside lib's `TURN_SECONDS`: two owners of one figure | `turn-engine.mjs` `formatTurns` | degrades | U5 |
| 6 | WORDS: `ACKS-FORMATION.warnings.noMapper`, `.noLight`, `.winded`, `.restDue` and `.darkSighted` each state a rule. `mapperNoLight`, `mapperDown`, `mapperNoProficiency`, `carrying` and `inCombat` say what the module does and stay | `lang/en.json`; `buildWarnings` | degrades | U4 |
| 7 | The frame and the tab row are `flex: none` and the active panel has `min-height: 0`: when the art row, the warnings and an open Key outgrow the window the panel collapses to its padding, and the content box's scroll reaches the frame alone (inferred) | `styles/formation.css`, "The frame: the panels" | blocks a user | U11 |
| 8 | The art row never wraps: its rails and plate are fixed widths scaled by the type ratio, the window's floor does not scale (by ruling, formation DECISIONS 2026-10-15), and the content box hides horizontal overflow. At a raised type size near the floor the sheet-tools rail is cut off (inferred) | `styles/formation.css`, "The frame: the art row" | degrades | U11 |
| 9 | Rail cells pass a string assembled at render through `data-tooltip`, where `data-tooltip-text` is asked for | `formation-cell.hbs`, both branches | cosmetic | U5 |
| 10 | The warnings glyph is not `inert` | `formation-frame.hbs` warnings block | cosmetic | U8 |
| 11 | The description box scrolls and the frame part declares no `scrollable`, so its position resets on every re-render (inferred) | `party-actor.mjs` `PARTS.frame`; `__prose` | cosmetic | U11 |
| 12 | The open description editor sits in the frame part, which re-renders on every write to the formations setting and on a member's hit-point or item change: an open edit is rebuilt from the saved source (inferred) | `formation-frame.hbs` reading block; `_onFirstRender` | degrades | U12 |
| 13 | In dungeon mode the overline clock is not redrawn when world time moves with no formation write: the `updateWorldTime` hook refreshes party sheets only on a journey or in a city (inferred) | `module.mjs` `updateWorldTime` hook | cosmetic | U12 |

#### Order tab

| # | What | Where | Severity | Fix |
|---|---|---|---|---|
| 1 | Leave behind and go back for them is an `<a>` with no `href` (`toggleLeftBehind`): no keyboard route | `formation-tab-order.hbs` casualty span | blocks a user | U8 |
| 2 | A member's sheet opens only from a click on an `<img data-action="openSheet">` | `formation-tab-order.hbs` member row | degrades | U8 |
| 3 | The train row's name is an `<a>` with no `href` (`stationChipOpen`); the mount's chip uses a button for the same action | `formation-tab-order.hbs` train row | degrades | U8 |
| 4 | A member's figures have no tooltip: speed per turn, encumbrance over its maximum, a carrier's load. `ACKS-FORMATION.app.enc` is an abbreviation with none. The slowest member is marked by border colour alone | `formation-tab-order.hbs` `.details`; `buildFormationView` members | degrades | U7 |
| 5 | WORDS: `ACKS-FORMATION.app.darkSightHint` states a rule | `lang/en.json` | degrades | U4 |
| 6 | The dark-sight chip does not say where the member's radius came from (`senseProfile`); with a dark sense whose radius is not imported (`darkSightUnread`) the glyph has no tooltip at all | `formation-tab-order.hbs` `.details` | degrades | U7 |
| 7 | The state glyphs (down, blinded, detached, deployed, no stashed token, riding, casualty or dead, the train's pace-setter) have a tooltip and no accessible name: the tooltip holds the only copy | `formation-tab-order.hbs` `.name`, casualty span, mount, train row | degrades | U7 |
| 8 | WORDS: `ACKS-FORMATION.app.downBadge` states a rule, its threshold included | `lang/en.json` | degrades | U4 |
| 9 | WORDS: `ACKS-FORMATION.role.scoutHint`, `.rearguardHint`, `.carrierHint`, and `.mapperHint` in part, state rules. Their imported figures (`roleFigures`) and page references stay | `lang/en.json`; `constants.mjs` `ROLE_HINTS` | degrades | U4 |
| 10 | Role-chip tooltips are assembled at render and passed through `data-tooltip` | `formation-tab-order.hbs` roles | cosmetic | U7 |
| 11 | The train's pace and station counts have no tooltip | `buildTrain`; train row | degrades | U7 |
| 12 | The stack badge's tooltip (`ACKS-FORMATION.app.stackHint`) says what a press does and not where the body count came from | `PartySheet` `#markStacks` | degrades | U7 |
| 13 | A player's take-out button is disabled during a fight (`takeOutLocked`) with no reason shown; the bring-in list beside it shows one | `formation-tab-order.hbs` member controls | degrades | U9 |
| 14 | Detach is disabled with no reason on either seat (`canDetach`), and for the Judge also when the member is down, though `toggleDetachMember` refuses only a fight | `formation-view.mjs` `canDetach`; `SHARED_ACTIONS.toggleDetach` | degrades | U9 |
| 15 | The detach, remove and casualty glyphs are not `inert` | `formation-tab-order.hbs` | cosmetic | U8 |
| 16 | `.members` scrolls sideways inside a part that declares only `scrollable: [""]`: a wide frontage loses its horizontal position on every re-render (inferred) | `PARTS.order`; `styles/formation.css`, "Arbitrary frontage" | degrades | U11 |
| 17 | Member controls are fixed px boxes holding ramp-sized glyphs, and the grid's track floor is in rem (inferred) | `styles/formation.css`, "Marching order controls", "Members" | cosmetic | U11 |

#### Kit tab

| # | What | Where | Severity | Fix |
|---|---|---|---|---|
| 1 | With the light table not imported a light's burn figure is blank and its tooltip empty (`burnTip` falls to `lightCite()`, which is null): no lang key carries the page reference, only a comment in `buildFormationView`. The light-type options have the same gap | `buildFormationView` lights; `buildGMExtras` `lightTypes` | degrades | U10 |
| 2 | A tracked spell's turns-left figure has no tooltip, and the record keeps only the count (`addSpell`, `adjustSpell`), so nothing can say whether it came from the spell's duration, a hand entry or the Judge's adjustment | `formation-tab-kit.hbs` spells; `turn-engine.mjs` | degrades | U10 |
| 3 | The Judge's add-spell inputs (`data-pick="spellName"`, `"spellTurns"`) are named only by their placeholders | `formation-tab-kit.hbs` add-spell row | blocks a user | U10 |
| 4 | WORDS: `ACKS-FORMATION.app.shieldHint` and `ACKS-FORMATION.app.toggleLightHint` state rules; the second also carries a printed duration | `lang/en.json` | degrades | U4 |
| 5 | Whether a light is lit shows only in its glyph's weight and colour, and the toggle's accessible name is the same in both states | `formation-tab-kit.hbs` lights | degrades | U8 |
| 6 | A map's name opens its sheet from a clickable `<span data-action="openMapItem">`: no keyboard route, and it is shown to every seat, since `buildMapsView` computes `canOpen` and the template never reads it | `formation-tab-kit.hbs` map row | degrades | U8 |
| 7 | Anchor's refusal reason lives only in the disabled button's tooltip (`anchorReason`), and a player who does not own the holder gets no reason at all | `formation-tab-kit.hbs` map row; `buildMapsView` | degrades | U9 |
| 8 | Glyphs in the light, spell and map rows and the add buttons are not `inert` | `formation-tab-kit.hbs` | cosmetic | U8 |

The tab row, and the Sightings and Judge tabs as dungeon mode renders them,
have no finding.

#### The view behind the strip

| # | What | Where | Severity | Fix |
|---|---|---|---|---|
| 1 | VALUE: the strip's combat figure is the party's speed divided by a literal, written twice (`buildStripView`, and `buildFormationView`'s `combatSpeed`, which nothing reads). Core derives each actor's encounter movement itself (`computeAdditionnalData`); that reader is looked at first | `formation-view.mjs` | degrades | U13 |

Only a live look settles, party sheet: the panel's collapse with the Key open
and several warnings, on a short window or at a raised type size; the right
rail's clipping near the floor; the band's focus and name text after a mode
change and after a peer's write; an open description edit across a peer's
write; the members grid's sideways position after a press; whether a tooltip
shows at all on the disabled Anchor button; the overline clock after world
time moves; a player without ownership pressing a map name, the train name or
a portrait; two party sheets open; a first render in a detached window (the
band's move, and the stack badge built with the main window's `document`).

**Windows, dialogs and injected sections, in.** A surface is out only where a
mode gate can be named on its opener; one with no gate is in, whatever mode
its subject belongs to.

| Surface | Opener | Shown by |
|---|---|---|
| `SkillAuditApp`, `skill-audit.hbs`, its reset confirm | the Order tab's `openSkillAudit` (Judge) | `SHARED_ACTIONS.openSkillAudit`; the Order head is gated on the seat alone |
| The Skill tab and checkbox injected into ability item sheets | any ability item's sheet | `registerSkillFlagEditor` |
| `TrapSheet`, `trap-item.hbs` | any trap item | the sheet's registration in `module.mjs` |
| `askDischarge` | a Trapbreaking success | `attemptDisarm`, from `TrapbreakApp`, the `trapbreak` request and the turn plan |
| The trap scene tools, the canvas drop, the wall sheet's trap row | the Walls layer, the canvas, a wall's sheet | `installTrapControls`, `installTrapDrop` |
| The door tool's button | the Walls layer | `installDoorControl` |
| The district tools and the District sheet's Place row | the Regions and Walls layers | `installDistrictControls`, `installDistrictPlaceRow` |
| The Trap Zone, Encounter Zone and District behaviour configs | a region's behaviour | `registerTrapZone`, `registerEncounterZone`, `registerDistrictZone` |
| `partyChecks`, `dealExperience` | the quick-tools rail (Judge) | `frame-view.mjs` `toolCells` |
| `tweaks` | the sheet tools (Judge) | `frame-view.mjs` `sheetCells` |
| The `newMap` confirm | the Kit tab | `formation-tab-kit.hbs` `newMap` |
| `disband`, `promptForOrderName`, `pickMarchingOrder` | the Order tab; the picker also from the party token's HUD | `formation-tab-order.hbs` head; `formUpFromHud` |
| The token HUD button | a token's HUD | the `renderTokenHUD` hook in `module.mjs` |
| The monster-level row on a roll table's sheet | the encounter table's sheet | `installMonsterLevelRow` |
| The core party overview's suppressed experience button | core's party overview | `installCoreXpSuppression` |
| `poi.mjs` `askName`, `lost-fog.mjs` `showDiscovery` | a card left in the log from another mode | `promoteFromCard` and `discoverEpisode` read no mode |

**Out.** `offerDayEnd` (returns unless on a journey); `lost-dialog.mjs`'s
begin, re-anchor, end and shift dialogs (their openers sit in the Judge tab's
journey block); `confirmBarOverride`, `openStockDialog`, `askStockInputs`,
`hexAddPoint`, `hexClear`, `openCountryBrush` (controls only the Wilderness
tab renders); `pickAndTravel` (the City tab). Another subsystem's window,
opened unchanged: lib's hit-point tool (`SHARED_ACTIONS.adjustHp`), core's
file picker and ownership config, and the member, station, place and map-item
sheets. `ability-rolls.mjs` opens nothing for formation. Chat cards
(`encounter-card.hbs`, `lib/roll-card.mjs` cards and the three card-action
hooks) and canvas overlays (`trap-markers.mjs`, `column-view.mjs`) are not
windows.

#### Skill audit window

| # | What | Where | Severity | Fix |
|---|---|---|---|---|
| 1 | A fixed id: a second audit, another party's or a second press, replaces the first window's element and the first instance's actions go dead | `skill-audit.mjs` `DEFAULT_OPTIONS.id` | degrades | U14 |
| 2 | No re-render when a member joins or leaves or an ability item is added, edited or deleted; `PartySheet.refreshAll` reaches party sheets only | `SkillAuditApp` | degrades | U14 |
| 3 | The window's content box is the scroller while the body part declares `scrollable: [""]` on a root that never scrolls: nothing is retained, on a window that re-renders on every ruling, select change and reset (inferred) | `PARTS.body`; `styles/formation.css` | degrades | U14 |
| 4 | No `PressFocus`: after a ruling, a roll or a select change focus falls to the body (inferred) | `SkillAuditApp` | blocks a user | U14 |
| 5 | The items table's Used-for selects have no accessible name | `skill-audit.hbs` `select[data-field="checkKey"]` | blocks a user | U15 |
| 6 | Each resolution's parts lose their `cite`, where `rollCheckFor`'s `sourceTip` keeps them | `_prepareContext` `resolutions` | degrades | U15 |
| 7 | A bash's resolution omits the Strength term `rollCheckFor` adds from `cfg.strScaled`: the figure shown is not the one the card throws | `_prepareContext` `resolutions`; `party-rolls.mjs` `rollCheckFor` | degrades | U20 |
| 8 | The Sheet target column reads core's single `system.rollTarget` with a zero fallback: an item with no target shows a zero, and a scaled or multi-throw item can disagree with the resolution table. No tooltip | `_prepareContext` `items[].target` | degrades | U15 |
| 9 | The progression table labels its rows with the internal ladder key and shows imported values with no `citeOf` tooltip | `_prepareContext` `progressionTable` | degrades | U15 |
| 10 | The level is printed after a literal English abbreviation in the template, and the same literal is in `resolveCheck`'s source string | `skill-audit.hbs` `.lvl`; `party-rolls.mjs` `resolveCheck` | cosmetic | U15 |
| 11 | Table selects and inputs carry a px height while their type rides the ramp (inferred) | `styles/formation.css` `.audit-table` | degrades | U14 |
| 12 | One column per party check beside a `nowrap` member cell, in a frame that hides horizontal overflow: the right-hand columns clip (inferred) | `styles/formation.css` `.audit-table .member-cell` | degrades | U14 |
| 13 | Width and height in px (inferred) | `DEFAULT_OPTIONS.position` | degrades | U14 |
| 14 | `window.resizable` is declared although the lib hook grants the corner by class | `DEFAULT_OPTIONS.window` | cosmetic | U14 |
| 15 | The reset button's glyph is not `inert` | roster heading | cosmetic | U14 |

#### The Skill tab on ability item sheets

| # | What | Where | Severity | Fix |
|---|---|---|---|---|
| 1 | Two `title=` attributes carry the Throw bonus hint | `buildSkillTabHTML` | degrades | U15 |
| 2 | The Used-for options show internal check ids where the audit window's same select shows names | `buildSkillTabHTML` `checkOpts` | degrades | U15 |
| 3 | The resolved target's parts lose their `cite` | `buildSkillTabHTML` | degrades | U15 |
| 4 | A bash's resolved target omits the Strength term | `buildSkillTabHTML` | degrades | U20 |
| 5 | The select and number input carry px sizes while their type rides the ramp (inferred) | `styles/formation.css` `.acks-formation-flags` | degrades | U14 |

#### Trap sheet

| # | What | Where | Severity | Fix |
|---|---|---|---|---|
| 1 | The level strip marks the current and the filled levels by border, weight and opacity alone: no text, tooltip or state for assistive technology | `trap-item.hbs` `.acks-extras-trap-strip` | degrades | U16 |
| 2 | The pit's derived damage has no tooltip naming its parts: the depth, the imported fall dice with their page, the spikes | `trap-item.hbs` `derivedDamage` | degrades | U16 |
| 3 | `pitDamage`'s `unknown` is dropped: a spiked pit with no imported spike figures shows the fall's dice as if complete, and with no fall import the line vanishes with no page reference | `TrapSheet._prepareContext` | degrades | U16 |
| 4 | The imported trigger band shows only as a placeholder: no visible copy of the figure in force and no tooltip saying where it was read | `trap-item.hbs` `system.triggerOn` | degrades | U16 |
| 5 | The frame scrolls on a sheet that submits on change and declares no `scrollable` part (inferred) | `TrapSheet` `DEFAULT_OPTIONS`, `PARTS.form` | degrades | U16 |
| 6 | The level field's `max` is a template literal and not `TRAP_LEVELS` | `trap-item.hbs` `system.level` | cosmetic | U16 |
| 7 | An inline `style` gives the description editor a `rem` height | `trap-item.hbs` `prose-mirror` | cosmetic | U16 |
| 8 | Width in px (inferred) | `DEFAULT_OPTIONS.position` | degrades | U16 |
| 9 | WORDS: `ACKS-FORMATION.traps.hint.attackThrow` states a rule | `lang/en.json` | degrades | U4 |

#### Region behaviour configs

| # | What | Where | Severity | Fix |
|---|---|---|---|---|
| 1 | The trap zone's State select lists raw state ids; the `ACKS-FORMATION.traps.state.*` labels exist and are unused | `TrapZoneBehavior.defineSchema` `state` | degrades | U16 |
| 2 | `known` has no label or hint key under `ACKS-FORMATION.TRAP_ZONE.FIELDS`, so core labels the checkbox with its field path | `TrapZoneBehavior.defineSchema` | degrades | U16 |
| 3 | `encounterEvery` and `encounterTarget` carry schema `max` literals the world settings of the same names do not: a figure the setting accepts is refused on a zone. The District behaviour repeats it | `EncounterZoneBehavior.defineSchema`; `DistrictBehavior.defineSchema` | degrades | §7 row 10 |
| 4 | VALUE (inferred): the target's `max` stands for the encounter die's faces, which `importedEncounterCadence` reads from the Judge's book | same | degrades | §7 row 10 |
| 5 | The Place row's create button is a glyph with a tooltip and no `aria-label`; its glyph is not `inert` | `district-tools.mjs` `installDistrictPlaceRow` | blocks a user | U18 |

#### The discharge question

| # | What | Where | Severity | Fix |
|---|---|---|---|---|
| 1 | A player's Trapbreaking runs `attemptDisarm` on the Judge's client, so the question opens on the Judge's screen and the thrower is never asked; the turn plan's resolution waits on the answer | `trap-zone.mjs` `askDischarge`, `attemptDisarm` | degrades | §7 row 2 |
| 2 | The actor's name is interpolated into the dialog's HTML unescaped | `askDischarge` content | cosmetic | §7 row 2 |
| 3 | WORDS: `ACKS-FORMATION.traps.chooseHint` states a rule | `lang/en.json` | degrades | U4 |

#### The Walls layer and the canvas drop

| # | What | Where | Severity | Fix |
|---|---|---|---|---|
| 1 | The wall sheet's trap row names the state alone: it neither names nor opens the trap item nor takes it off, and an item reaches a wall only by a drag | `trap-walls.mjs` `installTrapDrop`, the injected row | degrades | U18 |
| 2 | The canvas drop has no seat test, where the row's injection has one: a player's drop attempts the wall write with no relay (inferred) | `installTrapDrop` | degrades | U18 |
| 3 | The trap-area tool and the district-from-walls tool share one glyph on the Walls layer | `installTrapControls`; `installDistrictControls` | cosmetic | U18 |
| 4 | The door tool declares no `order` | `door-app.mjs` `installDoorControl` | cosmetic | U18 |
| 5 | The row's `<label>` fronts a `<span>` and names nothing | the injected row | cosmetic | U18 |

#### The token HUD button

| # | What | Where | Severity | Fix |
|---|---|---|---|---|
| 1 | Named by a glyph and a tooltip, with no `aria-label`; the glyph is not `inert` | the `renderTokenHUD` hook in `module.mjs` | blocks a user | U17 |
| 2 | On the party token with several saved orders, the picker's Delete forms the party up in that order: `formUpFromHud` reads the answer's `template` and never its `action`. Re-read in source by the planning session | `module.mjs` `formUpFromHud`; `pickMarchingOrder` | blocks a user | fixed, `dbdf1ecf` |
| 3 | Add to party refuses the Judge as it refuses a player (`partyHolding`). Whether one actor in two parties is a refusal the 2026-11-14 ruling reaches, or a limit of the model it does not, is ruled first | `module.mjs` `addTokensToParty` | degrades | U17 |

#### Small dialogs

| # | What | Where | Severity | Fix |
|---|---|---|---|---|
| 1 | `dealExperience`: the gain figure has no tooltip naming its parts | `xp-app.mjs` `preview` | degrades | U19 |
| 2 | `dealExperience`: an unread adjustment renders an empty span that carries the cell's only page reference, with no width to hover (inferred) | `xp-app.mjs` `bonusCell` | degrades | U19 |
| 3 | `dealExperience`: participants and adjustments are read at open and awarded at confirm with no re-read (inferred) | `dealExperience` | degrades | U19 |
| 4 | `dealExperience`: a negative total passes the input; the division clamps it and the card still announces it | the ok callback | cosmetic | U19 |
| 5 | `dealExperience`: width in px for a four-column table (inferred) | `position` | cosmetic | U19 |
| 6 | WORDS: `ACKS-FORMATION.xp.reason.mercenary` states a rule | `lang/en.json` | degrades | U4 |
| 7 | `disband`: the party's name is interpolated into the confirm unescaped | `SHARED_ACTIONS.disband` | cosmetic | U19 |
| 8 | The overview injection sets a `title` on the button it hides | `installCoreXpSuppression` | cosmetic | U19 |

No finding on `partyChecks`, `tweaks`, `newMap`, `promptForOrderName`,
`askName`, `showDiscovery` or the monster-level row. Every dialog caller's
test of the answer matches what core resolves, the HUD's finding 2 aside.

Only a live look settles, the rest: whether the audit keeps its scroll and its
focus across a ruling, its clipped columns at a raised type size and two
audits open for two parties; the trap sheet's floor, width and scroll after a
field change, and its level strip under a screen reader; the trap zone's
`known` label as rendered; whether the experience dialog's unread adjustment
can be hovered; the HUD button and the district create button under a screen
reader, and the door tool's place in its row; which seat sees the discharge
question on a player's success; what a player's trap drop shows; a first
render in a detached window for the audit and the trap sheet.

## 11. The walk, first surface

The outline of TESTING's "The crossing", written in full by S7.

Fixtures, each found by `flags.world.fixture`:

| Marker | What |
|---|---|
| `formation/crossing-party` | a party in Dungeon mode with its token on a scene, holding the members below |
| `formation/crossing-adventurer` | a character the Player seat owns, without Climbing |
| `formation/crossing-climber` | a character holding the world's imported Climbing, added from the imported library as a user adds it. (`formation/imported-climber`, kept by TESTING's jumping section, is a plain character with no proficiency, whatever its name.) |
| `formation/crossing-acrobat` | a character holding the imported Acrobatics |
| `formation/crossing-beast` | a monster actor, which carries no Adventuring field |

Seats: the GM; the Player who owns the adventurer; one seat that owns nobody.
The walk writes the party fixture, so with a peer on the surface it connects
with `own: <tag>`.

| # | Step | Observable |
|---|---|---|
| 0 | Re-import the Rulebook's tables in the test world: S2 to S4 add keys a standing import does not hold | `advances` on an outcome cell, `vulnerable` on the grid, the Acrobatics cap and bands, each read back through `formationValue`. Without them step 6 passes on the absent-figure path and proves nothing |
| 1 | Assert the start: no `crossing` flag, the four tables present | End the crossing if one stands |
| 2 | The GM begins a sheer climb with a length | rows on both seats; kind labels with no parentheticals; each figure's tooltip in its shape; the beast's target blank, its tooltip the page reference |
| 3 | The player's seat | no Judge field in the DOM; the adventurer's Throw blocked, its reason as text |
| 4 | Rope fixed | the row flips on both seats |
| 5 | The player throws, the die rigged | a public declaration; a card to the Judges alone; the member's entry one stretch on |
| 6 | A miss that does not advance, then a make | not across; covered is one stretch |
| 7 | The Judge modifier set so the lowest face meets the target, the lowest face rigged | the botch row |
| 8 | A fall | distance and dice reported; hit points unchanged |
| 9 | The GM throws for a refused member | a warning, then the throw; the card says so |
| 10 | A jump: gap and run-up | verdicts equal `canClear` read in page context |
| 11 | Precarious | core's save card; the picked footing's readout |
| 12 | A member removed mid-crossing, then a press | nothing thrown; the stale entry gone |
| 13 | End, then Begin | a fresh id; no member state carried |
| 14 | A second party sheet, a detached window, the type size on a fresh window | scroll kept after a press; focus back on the pressed row's button |
| 15 | A hover pass | each figure's parts against the page it names |
| 16 | Teardown | End; the cards tracked by the ids their actions returned and swept; the sweep's result quoted; fixtures kept |

The fixes landed in `main`'s tree are walked in the sections they change,
before §11: S1 in TESTING's Swimming step 4 (rewritten) and "The Spelunking
outcomes" with the lowest face rigged; S2 in "The Spelunking outcomes" step 2;
S3 in the same section; S4 in "Jumping, the fall, the Spelunking table"; U0 as
a hover pass over the six controls.

## 12. Start prompts

A phase corrects the next one's prompt before it ends.

The planning session closed on 2026-11-17 and answers nothing further. Each
later phase is started by the session managing the walk lanes, from the
"Phase 2 and later" prompt below, once the phase before it has appended its
results.

**The phase session's model.** `claude-opus-5-5`. The design is ruled and
every slice is briefed, so the session's own work is dispatching, reading
diffs against the word and value rules, landing, and driving the walk: review
and judgment on a settled design, which does not need the planning session's
model. Its agents take their definitions' models with no override.

### Phase 1

> You are the Phase 1 session of the dungeon close-out in
> `C:\Proj\foundryvtt-acks-extras`, and its orchestrator. Read
> `docs/formation/wip/20261116-dungeon-closeout-plan.md` whole before anything
> else; it is the only hand-over. Read `CLAUDE.md`, `.claude/rules/` and
> `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.
>
> Build §9's Phase 1: S1, S2, S3, S4, U0 and S5 in `main`'s tree, in that
> order, each landed with `acks-commit` as it passes; then
> `acks-branch sync dungeon-closeout`, and S6, S7, S8, S9 in the worktree
> `C:\Proj\foundryvtt-acks-extras.dungeon-closeout`, committed there by hand
> and landed once with `acks-branch land dungeon-closeout`. One slice, one
> fresh `implementer`, started with no model override; its brief is the
> slice's row, the sections of the plan it rests on, its files by symbol, its
> acceptance with the mutation, and the reporting rule that no printed value,
> rule sentence or shelf path enters a tracked file. A slice that meets a
> design question stops and goes to an `architect`. Review every diff yourself
> for the word and value rules before it lands. S5 goes to `doc-scribe`.
>
> Before the first agent and before each topic slice: list the sessions, read
> the running ones' latest turns, `main`'s dirty paths and each open topic's
> changed files (§2 names the peers), and say in one line what you found.
> `docs/importer/ROADMAP.md` is a peer's.
>
> When S6 to S9 have landed, find out who is seated, re-import the Rulebook's
> tables in the test world (§11 step 0), walk the S1 to S4 and U0 sections
> §11 names, then walk §11 on `main` yourself in the Foundry pane, with a real
> player seat; do not hand the walk to an agent. Register §10's
> door finding 4 on the bug-intake ledger. Then append "Phase 1 results" to
> the plan (exercised live, checked offline only, not checked; commits by sha
> and whether pushed; fixtures by marker), correct Phase 2's prompt, and
> report to the owner with OQ1, OQ8, OQ9 and OQ10 put as lettered questions.
> Push nothing. Cut no release: the next minor is held by the owner.

### Phase 2 and later

> You are the Phase N session of the dungeon close-out in
> `C:\Proj\foundryvtt-acks-extras`, and its orchestrator. Read
> `docs/formation/wip/20261116-dungeon-closeout-plan.md` whole, the last
> phase's results first. Ask the owner the questions §9 lists for this phase,
> once, and build what they do not touch meanwhile. Otherwise as Phase 1's
> prompt: one slice, one fresh agent of the kind §9 names; the peer check
> before every fan-out; your own review, landing and walk; results appended;
> the next prompt corrected.

**Phase 2's corrections, from Phase 1's walk.** The Phase 2 session also
reads these before its first agent:

- The owner was put OQ1, OQ8, OQ9 and OQ10 in Phase 1's report. Answers given
  since are recorded under §13; ask only the ones still open.
- `topic/summons-formation` has landed and closed, so S13's check reads
  `main`. `topic/dungeon-closeout` is landed and open: `acks-branch sync
  dungeon-closeout` before S12.
- The test world runs parallel walk lanes. Take the lane the managing session
  assigns: export its `SEAT_GM`, `SEAT_PLAYER`, `CAPTURE_PORT_GM` and
  `CAPTURE_PORT_PLAYER`, and set `FIXTURE_OWN` where a peer may drive the same
  fixtures. A failure that shows only with other lanes up is checked again
  alone before it is called a bug.
- The crossing walk is a hand walk: no `tools/live` walk drives it. The pane
  must be the active GM for its die rig to reach a relayed player throw, and a
  hidden pane throttles its timers (Phase 1's froze once); timing and focus
  checks run on a driver seat.
- Ledger rows T-0638 to T-0641 (§13's W2, W3, W4, W7) are fixes to the shipped
  surface: written in `main`'s tree, by one `implementer`, before S12.
- S10's shot is of a crossing a user set up through the section; Phase 1's
  fixtures (§13) are API-built and are not shot.

**The next start, from Phase 2's results (§16).** The owner capped Phase 2
on 2026-11-17 at the unpushed work it had landed, and asked for build-ahead
meanwhile. The managing session starts the next session on the topic from
the "Phase 2 and later" prompt; it also reads these before its first agent:

- What lands waits for the owner's minor. A slice is built to an offline
  green on `topic/dungeon-closeout` and committed there; nothing is landed
  on `main` until the managing session says the minor is tagged. Then
  `acks-branch sync dungeon-closeout`, the full gate on the tip, the land,
  and the walk on `main`.
- Phase 2's remaining slices come first, in this order: S13 (built on
  S12's logic, `982eee0a`), S15, S16, S17; then Phase 3's. S10 waits for a
  walk on `main` of a crossing a user set up, so it follows the first land
  after the minor. Phase 3's S20 and S24 read S16's pace pick.
- S12's full gate has not run on its tip: run it before S13 starts. S12
  left S13 the stepping questions B13 owns: where a round's throw leaves a
  swimmer, how a swimmer gets across, who counts `drownedRounds` and when
  `left` reaching 0 ends it, a rescuer's cost and who may rescue, and what
  each pace allows. S13's brief reads B13 against the page; a question the
  page leaves open goes to an `architect`, not to the implementer.
- OQ2 to OQ5 are answered (below); OQ11 is put in S24's brief.
- Re-run rigged, on a lane with no other GM seated, the Player-relayed
  presses §16 records as unrigged (step 5, 11j), and walk the relayed
  landing save and 11k there too.
- Formation's `apiVersion` is 31 on `main` and 32 on the topic. A
  topic-side gate can rewrite `tools/importer/cookbook-stamp.json`; restore
  it before `land`, which refuses a dirty worktree.
- The CPU is shared with release walks: no full gate in the worktree while
  the managing session says a walk holds the machine.

### Phase 3's questions, put for one pass

Phase 2 read RR ch. 3 and ch. 6 against §5's OQ2 to OQ5 (an `architect`,
read-only, 2026-11-17) so the owner can answer all four in one reply, e.g.
"2a 3c 4a 5a". No printed rule says which of two statements in the same book
wins (a phrase search of the RR introduction, ch. 3 and ch. 6, not a full
read), and "later printing wins" is between books only.
**Answered 2026-11-17**, the owner's words relayed by the managing session:
"Yes, all four", to taking the recommendations 2a, 3c (conditions only), 4a
and 5a. Each question below carries its answer; OQ11 stays open. The test applied: an
option is printed procedure when every clause it applies is printed and it
drops none that bears on the case; the owner ruled no house rules ship.

- **OQ2, the Cat Burglary no-fall.** Ch. 6 (grid and prose agree) lifts the
  fall for a member holding both Climbing and Cat Burglary, at the base pace
  only, and lifts the fall alone. Ch. 3 lifts it for a Cat Burglary holder
  alone, at any pace; on the precarious path its wording can be read as a
  success rule. **(a)** ch. 6's conditions. **(b)** ch. 3's (§5's (c) is the
  same as (b): everyone ch. 6 exempts, ch. 3 exempts too). **(d)** ch. 6's
  conditions, with ch. 3's precarious wording read as a success rule.
  *Recommended: (a)* — the imported cell names both proficiencies, so the
  exemption has one source and a Judge's override reaches it; (b) needs a
  rule in source that contradicts the imported cell. *Strongest counter
  (moderate):* ch. 3 is the proficiency's own grant, and under (a) a holder
  without Climbing gains nothing on a narrow ledge. *Build:* S20 parses the
  pair from the cell and reads the pace from S16. Under every option an
  exempted miss lifts the fall and does not advance, which `obstacleStep`
  answers as stalled; ch. 3's other Cat Burglary terms apply whatever the
  answer. **Answered: (a).**
- **OQ3, where the Spelunking grid and its prose disagree.** Mostly one side
  is silent where the other prints a condition: the prose adds the base-pace
  condition to the exemptions on five columns, and the grid's cells name gear
  on the rappel and the crawl. One real conflict: the grid's proficiency row
  admits Mountaineering on the precarious path, the prose Climbing only.
  **(a)** the grid. **(b)** the prose. **(c)** every printed condition
  applies (pace and gear both), and on the precarious path Climbing only.
  *Recommended: (c), applied to conditions only* — (a) and (b) each drop a
  printed clause; "the stricter" is not extended to who may try, which would
  also refuse the supervised and assisted routes the grid admits. *Strongest
  counter (moderate):* the prose's rappel sentence reads as unconditional,
  though the grid on the same page prints the gear. *Build:* S20 parses
  proficiencies and gear per cell, gear being S24's per-member input, and
  waits on S16's pace pick. **Answered: (c), conditions only.**
- **OQ4, Mountaineering without its kit.** Ch. 3 makes its kit the
  condition for the leader's and the party's level-based throws, and refuses
  a sheer climb without it. Ch. 6 names gear only in the exemption for a
  member holding Climbing and Mountaineering. **(a)** the kit gates every
  Mountaineering benefit. **(b)** only the exemption. *Recommended: (a)* —
  it reads the page whole; (b) is a house rule on the sheer face, where
  ch. 3 says no. *Strongest counter (moderate; weak on the sheer face):*
  ch. 6 is the procedure the surface performs and names gear selectively.
  *Build:* S24's rows (the kit, the party cap; blank with their page
  reference until imported); under (a) a Mountaineering member counts as
  proficient only with the kit, the supervised and assisted routes need the
  leader's kit and each member's, a missing kit warns a Judge and blocks a
  player. A per-member gear control is a visible control: `/design` first.
  **Answered: (a).**
- **OQ5, which Acrobatics terms the landing save takes.** Ch. 6 names one
  term for the landing; ch. 3 grants two save terms under different
  conditions, the agility term and a class-level term against falling down.
  Each procedure in the book names one of the two, never both, and the
  landing names the agility term. **(a)** the agility term only, read from
  the proficiency's situational save effect. **(b)** both. (§5's (c) is
  (b) if the ch. 6 term is the agility term restated.) *Recommended: (a)*
  — the landing names one term, and the archived 2026-08-15 ruling (in
  force) holds that the save bonus belongs to the proficiency. *Strongest
  counter (moderate):* a failed landing on solid ground leaves the jumper
  prone, which is the class-level term's own condition. *Build:* S26
  replaces `NO_ACROBATICS.saveBonus` at `rowFor`, no import needed; (b) adds
  the actor's level, which `rowFor` already reads. **Answered: (a).**

Not asked by §5 and found on the way: whose level an assisted member throws
at on the rappel and the crawl (ch. 6 prose: the member's own; ch. 3
Mountaineering: the mountaineer's) — S24 needs it, so it is put as
**OQ11**, (a) the member's own, (b) the mountaineer's, with no
recommendation until S24's brief reads both passages in full.

## 13. Phase 1 results

Phase 1 ran on 2026-11-16. Nothing is pushed; no release was cut.

**Commits on `main`, none pushed.** S1 `f7e37962`, S2 `d591105a`, S3
`6cea4785`, U0 `e95da0b6`, S4 `ea4174f9`, S5 `ce5f6b6e`; the topic's S6
`bb559b5e`, S7 `99563419`, S8 `4527eb4d`, S9 `918fde8f`, landed by one
fast-forward from `0abb2ac5` with the gate green on `918fde8f`;
`topic/dungeon-closeout` stays open. The walk's fixes: `4d6dd428`.

**Published names.** Formation's `apiVersion` rose one step at each of S1,
S2, S3, S4 and S6, from 24 to 29. Two steps remove or rename a published
name: S1's (`vertical` and `descendOnly` left `OBSTACLES`) and S6's
(`assisted` became `ropeFixed`).

**Rulings the slices took, for the owner to see.** S4: an imported extended
band answers for a raised score where core's own table also has a row, so the
import wins over core inside the bands. S6: a fall from a climb in progress
counts the stretches covered and half the stretch under way. S7: OQ10 shipped
as its default (b). S9: core's save card follows the roll mode the Judge set;
the save term from Acrobatics is 0 until OQ5 is answered; the jump rows gained
a depth field so a failed landing can price its fall.

### Exercised live

On `main` at `918fde8f` plus the walk's fixes, the GM in the app's pane and
a player in a driver seat whose recorder was attached before load (`init`,
`setup` and `ready`, no errors; a trusted-player and an assistant-GM seat the
same). The pane's recorder was attached after load and saw core socket errors
only, with no module frame.

- §11 step 0: the formation tables re-imported (11), and `formationValue`
  read back `advances`, `vulnerable`, the botch band, the Acrobatics cap and
  the extended bands.
- TESTING's Swimming steps 1 to 7, the Spelunking outcomes steps 1 to 4 and
  the Jumping steps 1 to 5, each with its teardown.
- U0: the six strings read live; the pace and speed hints hovered on the
  Dungeon tab, each naming its field and carrying its page.
- §11 steps 1 to 13 and 16, including 5a to 5e (a non-owner, a refused
  member, an ended crossing, two interleaved requests, a member already
  across; 5c's die count was not captured) and 11a to 11d (the landing save's
  card, a closed dialog, a member out of reach, each footing). Step 14 in
  part: scroll kept across a press; focus back on the pressed row while its
  button survives, except on the first press after the sheet opened, which
  lost it to the page in the pane (1 of 5); two party sheets
  render with no duplicate id; no row clips at the largest font knob or at
  420 px. Step 16's sweep of the run's own cards: asked 49, removed 49, could
  not find 0, refused none.

### Found by the walk

Each fix below was re-walked live on `4d6dd428` after its landing: W1 by
`readThrow` in the GM pane; W5 and W6 by requests from the player and the
trusted-player seats with the adventurer dropped from the party (the owner
told it is no longer in the party, a non-owner told it is not theirs, a
request with no member answered with the neutral fallback); W8 by measuring
the button against the font knob. The three whispers were swept by id
(removed 3, could not find 0, refused none), the adventurer re-added and
the crossing ended.

- **W1, fixed.** `readThrow`'s success read carried no `botch` key.
- **W2, T-0638.** A member's target tooltip names its source only, with no
  part and no page.
- **W3, T-0639.** A Climbing holder's permitted cell is blank.
- **W4, T-0640.** A player's refused request still toasts that it was
  declared.
- **W5, fixed.** A refusal named its member "?".
- **W6, fixed.** A player asking for a member the party dropped was refused
  as not the owner.
- **W7, T-0641.** A press that takes the member across drops focus to the
  page.
- **W8, fixed.** The panel's buttons kept core's size at every font knob
  setting. The turn plan's buttons may share it: not checked.
- The member record in the party flag keeps a copy of the imported outcome's
  words, which a later Judge override does not reach. World data, not a leak;
  S16 to S18 touch that record.
- TESTING's step 2 observable over-reached plan C5, which names the easy
  climb and rappel labels; the ledge labels keep the word that tells them
  apart. Narrowed with the fixes.
- §10's door finding 4 is T-0637.

### Checked offline only

The suites the slices added or changed and `npm test` at each landing's
gate; the walk's fixes against the crossing (29 checks), crossing-surface
(34) and obstacle (40) suites and the landing gate on `4d6dd428`.

### Not checked

- Jumping steps 6 and 7 (the city's dice): Phase 1 did not touch them.
- Jumping step 8 and the pane's own load: the pane takes no pre-load
  recorder.
- Step 14's detached window: the driver opened no second document.
- Step 15 against the printed page: every tooltip's text was read and its
  page is the importer's citation at render, but none was compared with the
  book open.

### Fixtures kept

`formation/imported-climber`, `formation/crossing-scene`,
`formation/crossing-party`, `formation/crossing-adventurer` (owned by the
player seat), `formation/crossing-climber` (an imported class bound, Climbing
taken through the sheet's class proficiency chip), `formation/crossing-acrobat`
(Acrobatics the same way), `formation/crossing-beast`. The crossing is ended.

### Incidents

The Foundry server process died mid-walk, not stopped by this session; the
app was restarted and the world relaunched, and the crossing and the import
survived. The pane's in-page fixture ledger did not, so the run's own cards
were listed by author, time and fixture, and swept by that list.

### Owner answers

Given 2026-11-17 in reply to Phase 1's report, in the owner's words:
"1a 8a 9a 10b". OQ1 (a): the Judge picks an imported penalty size or types
a larger one, ticking the conditions as the reason (S11). OQ8 (a): the
attempt rolls the distance's die and the footing follows, the verdict still
shown first (S19). OQ9 (a): a prompt card at the member's turn whose button
throws (S13, S15). OQ10 (b): S7's shipped audience stands. Phase 2 asks none
of the four again.

## 14. Phase 3c results: U14 and U16

Run 2026-11-16/17 by a session started beside Phase 1, in `main`'s tree. Each
slice was built by a fresh `implementer`. The walks were driven by the session
itself. U15 follows U14 and is not built.

Commits, none pushed:
- `c3bce7a2`: U14.
- `b388e2cd`: what the U14 walk found.
- `eb51e9b2`: U16, with its walk.

### Exercised live

- `tools/live/formation-audit.mjs`: 47 of 47 on lane A (the GM and Player
  seats), before the seat lanes existed. The load recorder was attached before
  `init`. Its new section "the audit window" covered:
  - two parties' audits open together, the first still posting its card;
  - a second press bringing the open window forward;
  - a redraw on an ability's create, rename and delete on a member, none for
    an actor outside the party, and a redraw on a member leaving and
    rejoining;
  - the body part's scroll kept across a ruling's render;
  - focus back on the ruling button and on a Used-for select;
  - the Resolution table scrolling sideways to its last column at 340 px;
  - the window and its select growing with the type size.
- `tools/live/formation-trap-sheet.mjs` (new): 23 of 23 on lane C with
  `FIXTURE_OWN=u14-u16`. It is recorded as partial, so the release lane walks
  it again without the tag. It covered TESTING steps 1, 2, 5, 6, 7 and 8:
  - the strip's caption, its `aria-current` and each step's words;
  - the pit line's figure equal to the world's formula, its depth, fall and
    spike parts each ending in the imported page, and spiked and unspiked;
  - the band in force when blank, typed and 0;
  - the form part keeping a mid offset across a changed field;
  - the State labels and the Known label and hint;
  - the width at the largest type size, on a fresh instance.
- `tools/live/window-contract.mjs`: 247 of 248 on lane C. Every trap sheet
  check passes. The failure is in the importer's own window, under Found below.

### Found by the walks

- Each draw of the audit read every world compendium through
  `refreshLadders`. That took about 2 s warm and 14 s cold on the test seat,
  past `PressFocus`'s 3 s, so focus came back only by luck. Fixed in
  `b388e2cd`: the first draw only reads the ladders fresh.
- A Used-for change rendered twice and lost its focus. A ruling pressed just
  before a change took the focus back. Both fixed in `b388e2cd`.
- The first walk's redraw checks read before the redraw landed, so three of
  them passed on nothing. The walk now counts the watched audit's renders.
- Core puts an auto-height window back to `height: auto` on every render, a
  bare `ApplicationV2` included. A trap sheet the user shrinks therefore
  regrows when a field changes. This is core's behaviour, not U16's, and
  TESTING step 6 says so.
- An item keeps one sheet instance, and its width is decided when that
  instance is built. A trap sheet opened once keeps its width until reload
  after the type size changes. TESTING step 8 says so.
- Not this plan's: `window-contract`'s "settings menu importManager: every
  control is reachable in a short window" fails. Its Open and Remove buttons
  are lost at 300 px.
- The U16 implementer flagged two more: `traps.hint.level` still says "1st to
  6th", and `searchLock` has no `TRAP_ZONE.FIELDS` label.

### Checked offline only

- `test-skill-audit-window` (12 checks; written against a stand-in
  application, with no mutation check).
- `test-trap-sheet-view` (13 checks).
- `npm test` and `validate` at each landing's gate.
- U16's TESTING steps 3 and 4 (spike tables cleared, `fall` cleared). They
  clear tables every lane of the shared world reads.

### Not checked

- U16 on a Player seat: the trap sheet and the zone config are the Judge's.
- Any tooltip's page against the printed page with the book open. The pit's
  shipped fallback references are `crossing.ref.jumping` for the fall (its
  dice come from the landing passage) and "JJ ch. 8" for the spikes.

### Fixtures kept

- `formation/audit-party` with `formation/audit-member-1` to `-3` (lane A, no
  tag).
- `formation/combat-party` and `formation/combat-member-1` (read as the second
  party).
- `formation/trap-sheet-pit@u14-u16`, `formation/trap-sheet-scene@u14-u16` and
  `formation/trap-sheet-zone@u14-u16`.
- The walks swept their own cards and probe items by tracked id.

## 15. Phase 3c results: U15

Run 2026-11-17 in `main`'s tree by a session started for U15. A fresh
`implementer` built the slice, and the session drove the walks itself.

No `/design` was run. The visible changes stay within the design fence the
brief set:
- check names in the Skill tab's options, in place of flag ids;
- skill names on the progression rows, in place of ladder keys;
- an empty Sheet target cell in place of `0+`;
- the level tag read from a lang string, the same text in English.

Every page reference is in a tooltip. Nothing new was added as a column, an
element or inline text. Finding 8 was ruled before the brief: the column stays
the sheet's stored target, blank when that is not a positive number. The
resolved figure is not shown there.

Commits, none pushed:
- `a55dd9c5`: U15. `party-rolls.mjs` exports `citedParts`, `citedSource`,
  `checkTip` and `usedForOptions`. `rollCheckFor`'s `sourceTip` comes from
  `citedSource`, unchanged byte for byte (pinned in `test-skill-audit-roll`).
  `skill-ladders.mjs` exports `importedSkillFor`. The walk section is in the
  same commit.
- `736dccfa`: what the walk found. A Used-for option is named by its own
  `audit.flag.<flag>` string.

The landing adopted orphan session `db28ad96` under the owner's "Adopt orphans
as necessary" (2026-11-14). Its last ledger record is from 2026-11-12. The one
hunk it shared was the deletion of `skill-audit.mjs`'s old option builder,
whose lines date from `569d7d67`.

### Exercised live

- `tools/live/formation-audit.mjs`: 60 of 60 on lane B with `FIXTURE_OWN=u15`,
  once on `a55dd9c5`'s tree and once with the fix. Both runs are recorded as
  partial. The load recorder was attached before `init`, and both seats loaded
  with no error through `ready`. The new section "names and sources" checked
  each of the following against the module's own `resolveCheck` and
  `usedForOptions` on the same seat:
  - finding 6: a member's Methodical Search cell carries `audit.checkTip`
    with the part's page ("QA p. 9"), and core's tooltip shows that text when
    activated;
  - finding 8: a stored target reads `13+` with the sheet-target tooltip, and an
    imported item with no stored target shows an empty cell whose tooltip is
    its page alone;
  - finding 5: each select's `aria-label` names its item, `data-item-uuid` and
    `data-field` are kept, and the options read the binding names in order;
  - finding 9: the progression row is named for the imported skill, its
    tooltip is its page, and a rung with no value is blank;
  - finding 10: the level column reads `audit.levelTag`;
  - no `title` attribute anywhere in the audit;
  - Skill tab 1-3 on the GM seat: the select is named, editable and bound, with
    binding names; the Throw bonus has an `aria-label` and core's tooltip and no
    `title`; the resolution's tooltip cites the part's page, and core shows it;
  - the Skill tab on a Player seat that owns the member: read-only, named, with
    binding names and the cited tooltip. Ownership was put back after the step.

### Found by the walk

- A Used-for option was named by the first check that takes its flag, so the
  search binding read "Hasty Search" and the trapbreaking binding read "Hasty
  Trapbreaking", though each serves both of its checks. The audit had shown
  this before U15, and U15 carried it to the Skill tab. Fixed in `736dccfa`;
  the second walk read "Search".

### Checked offline only

- `test-skill-audit-window` (20 checks), `test-skill-audit-roll` (18 checks, plus
  the binding-name assertion in `736dccfa`), `test-skill-ladders` (12 checks).
- `npm test` and `validate` at each landing's gate. `a55dd9c5`: test 145 s,
  validate 622 s. `736dccfa`: test 151 s, validate 587 s.
- The first gate of `a55dd9c5` timed out after 10218 s with no output. At the
  time about six validates from several worktrees were compiling the cookbook
  at once in `check-cookbook-drift.mjs`, one of them since 02:36. A rerun was
  green.

### Not checked

- A screen reader reading the selects. The names were checked as attributes.
- A quote passing through a `data-tooltip-text` value. `esc` is core's
  `escapeHTML`, and the select's `aria-label` escape is tested offline.
- Any page against the printed book. The fixture's pages ("QA p. 9", "QA p. 11",
  "QA p. 13") are invented.
- An item with no cookbook page on a progression row. The table lists imported
  skills only.
- The Strength term on a bash, which is U20.

### Fixtures kept

- `formation/audit-party@u15` with `formation/audit-member-1@u15` to `-3@u15`,
  and `formation/combat-party@u15` and `formation/combat-scene@u15` with their
  members, built by the first run on lane B.
- `formation/audit-skill-ladder@u15`: a world ability item, "QA Audit Ladder",
  carrying an invented `def.skill.qaauditladder` ladder and page. Every Skill
  audit in the world lists it as a progression row.
- The three probe items on member 1 and the run's cards were swept by tracked
  id each run.

## 16. Phase 2 results

Phase 2 ran on 2026-11-17 and is capped there by the owner: "A lot of
changes hanging open. Needs to be a cap that now is clearly past", then "As
in unpushed commits, I'm fine burning the work down for the next release."
Later the same day: "Get as much work done unsupervised over the next
several hours, skipping around work that requires more input to clear
blockers", which the managing session read as build-ahead: slices built to
an offline green on the topic and not landed until the minor is tagged.
Nothing is pushed; no release was cut.

**Commits on `main`, none pushed.** T-0639, T-0640 and T-0641 `ecbe809c`;
the design approval `6ef27ea4`; S11 `848f3702`; T-0638 `a587ac26`; the
topic's S14, S18, S19, the S19 defect fixes and two review commits, landed
by one fast-forward as `7289480d` (gate green on that tip); the OQ answers
`f212486d`. Ledger: T-0638 to T-0641 fixed-unreleased; T-0642 registered.

**Built ahead on `topic/dungeon-closeout`, not landed.** S12 `982eee0a`,
the swim row's logic. Its single suites are green (test-crossing 50,
test-swimming 15, test-crossing-surface 65; `npm test` 268 suites before a
comment-only edit); the full gate was held while the machine served the
minor's walks and has not run on the tip.

S13, the swim rows on the section, in five commits: `244dc7b8` (the logic,
`crossing-driver.mjs` on the primary GM's `combatTurnChange` with the
`thrownAt`, `drownedAt`, `breathOut` and `promptedAt` guards, the prompt
card, drowning held as a crossing status), `f2c2949d` (the view, template,
CSS, the `rescue` relay step and the haul), `eaf7417b` (MODEL, DECISIONS,
TESTING "Swim rows" S0 to S14, ROADMAP, fragment), `30d8a9c3` (review
fixes) and `d5e10365` (a Judge picking a down, detached or busy rescuer is
warned and the link written; a Player is refused, per the owner's "Players
get blocks, judges get warnings"). Single suites: test-crossing 58,
test-crossing-surface 96, test-swimming 16, test-formation-flows all
scenarios; fourteen mutations, each caught. Not walked; no full gate.
`apiVersion` stays 32. S13's owner questions:
- A monster with no swim figure of its own has no target, so its row is
  refused for every seat and the board's "Throw anyway" on a monster is not
  built. What would a Judge throw against?
- The SwimPlayer board draws no Rescuer, Sinks or Vulnerable on a Player's
  drowning row; the build shows all three, since a Player names a rescuer.
  Keep or hide?
- A Player cannot replace or clear a rescuer another seat owns (the
  implementer's call, in DECISIONS).
- A Judge's Rescuer select lists down, detached and busy members with no
  marker beside them; a marker is a UI change and waits on a design.

S15, the squeeze rows: `7f91a0a5` (logic), `72da18c3` (rows, the two
escapes, the driver's squeeze prompts), `3366892b` (docs, folded below).
S16, the faster paces: `5c535e15` (the three pace-penalty imports, folded
below), `bace53bb` (the pace pick on a Climbing holder's row, its relay and
docs), `607d2940` (review fixes). A read-only architect then ruled the open
stepping questions against the page; the rulings are in the managing
session's notes, `20261117-s13-s15-rulings.md`. Two were build defects
against rulings in force, fixed with three more found the same way:
`cbd91b3e` (the push takes Strength, per the 2026-08-30 "Strength on a
Dungeonbashing throw has one owner"), `bc4b8ba5` (the squeeze's botch band
is imported from S14's own passage, a printed value per the template's
2026-08-15 ruling), `59dc1c79` (a monster's swim and squeeze target is the
load it carries, through `lib/capacity.mjs` `loadStone`), `f91fb968` (the
wiggle's tooltip no longer names a Contortionism part the figure lacks; S26
owns that read), `75d8b2a7` (End warns the Judge naming members still stuck
or drowning) and `c2a13680` (its lang keys moved off `crossing.end`, which
the gate caught as a parent and a string at once). `520a16eb` marks S15's
open questions 2 and 3 answered by the page; `1c98be5b` rewords a phrase
that echoed it. S15's question 1, how far a made squeeze throw carries a
member, went to the owner; the managing session: build (a), nothing moves,
and no "Through" control until its design has the owner's feedback.

S17, the grid's rates of progress: `2fda5ba5` (the import of
`spelunking.progress.<kind>` and `progressRate`) and `497cc8d6`
(`apiVersion` 33, since `obstacles` is published whole). The round half
stopped on seven questions, which a second architect pass ruled
(`20261117-s17-rulings.md`): a made throw covers one stretch and the rate
sets the time; outside a fight a base pace bills the exploration branch;
time sums across the crossing and bills whole rounds; nothing accrues in a
fight; the non-advancing miss's duration and the faster paces' shares are
printed and imported. Its import half is being built; the round half
follows.

**Rewritten on the owner's word.** The owner, relayed: "Yes, fold both".
Both on the unpushed topic, between slices, by one rebase from `7289480d`:
- S15's doc fix `1aa32a94` folded into `3af1167a`: now `3366892b`.
- S16's review fix `15b81fb4`: its three import files folded into
  `17585f07`, now `5c535e15`; its surface and doc hunks touch `a820c524`'s
  files, so they stay after it as `607d2940` (`a820c524` is `bace53bb`).
The rebased tip's tree is byte-identical to the old tip `3f6c7e1b`, and
neither folded commit's diff holds the quoted words or the printed face.

**The offline gate on the topic** ran once the machine's hold allowed it:
`npm test` 268 suites passing on `1c98be5b`; `validate` failed there on the
lang collision above and passed on `c2a13680`; the crossing suites passed
again after the rename. Single suites on the tip: test-crossing 83,
test-crossing-surface 125, test-formation-binding 211, test-obstacles 44,
test-swimming 16. Nothing on the topic is walked.

Owner questions this stretch adds: S17-3, how several members on one face
spend time ((a) together, the slowest member's time once, built as the
default; (c) a Judge's setup pick, which needs a design; (d) a fixed rope
starts the later members' time); and, optionally, B-b, billing the grid's
round rate everywhere instead of the exploration branch outside a fight.
Registered: T-0644 (a monster carrier's own pack is not counted on the
Order tab) and T-0645 (a drowning monster's breath reads a Constitution it
lacks).

**Published names.** Formation's `apiVersion` is 31 on `main`: S11 took 30
and removes `waterModifier` and `WATER.calm`, a removal the module's own
comment calls a major; S19 took 31 when the sync met it. S12 takes 32 on the
topic.

**Rulings the slices took, for the owner to see.**
- S14: Contortionism's figure applies to the squeeze and push throws, not to
  the wiggle-back save, which its ch. 3 effect already modifies (DECISIONS).
- S18: Clambering is not held, since the condition catalogue puts it in
  combat toward a creature; the board's example chip showed one. Only the
  status the imported grid row names is held, and nothing while the figure
  is not imported.
- S19: the footing is the rolled distance less the slip less the gap: past
  the edge, solid ground and prone; on it, the edge and hanging; short of
  it, empty space and a fall. A short jump falls with no save. The climb up
  is one stretch of the sheer climb on the member's own figure, the easy
  climb with Rope fixed. A dismissed save dialog keeps the distance and the
  next press finishes the save. Two controls are not on the board: Rope
  fixed on a jump, and the "Save to roll" state with its resume press.
- S12: a water penalty is none, an imported step, or a figure above the
  largest step; one between or below the steps is refused; with no steps
  imported any size stands.

### Exercised live

On `main` at `7289480d`, lane B: Gamemaster 2 in the app's pane (its
recorder attached after load and saw the hidden pane's zero-size canvas
errors only, no module frame) and Player 2 in a capture-driver seat held
open for the walk.

- Step 0: the formation tables re-imported through the reimport dialog; the
  log names the four squeeze keys and `swimWaterPenaltySteps`, each read
  back in its shape (four positive figures; a list of two positive sizes);
  `vulnerable` and `advances` present.
- T-0638: a member's target tooltip reads its source with the base figure
  and ends on the Spelunking page; the beast's blank target carries the page
  alone. T-0639: the Climbing holder's Permitted cell reads "May try" with
  the kind, the proficiency and the page. T-0640: two refused Player
  requests (a member across, a stale crossing id) whispered their reasons
  and raised no "Declared" toast. T-0641: a focused press that takes the
  member across leaves focus on the row, on an obstacle row and on a jump
  row.
- TESTING steps 1 to 4.
- Step 6a on the narrow ledge: one marked Vulnerable per member beside an
  unmarked hand-set one; the chip on both seats with its tooltip and page; a
  second throw makes no second effect; a hand delete is refused; across, a
  fall and End each release it; the hand-set effect stands; the easy climb,
  not vulnerable, held nothing.
- 11e; 11f; 11g with the save made (two dice; the system's card target
  equal to the row's); the failed save and 11h's three footings (three dice,
  two cards each); the Judge's override to the edge (record and state
  follow, Climb up offered, "Set by the Judge" in the tooltip); 11i, a
  climb-up miss that fell, thrown over a refusal and priced at the setup's
  depth, and a make by the Climbing holder with the footing kept as the
  edge, neither holding a condition; a blank gap drawing no Attempt.
- Teardown: the run's cards swept by id, asked 29, removed 29, could not
  find 0, refused none; the two hand-set Vulnerable effects removed; the
  crossing ended.

**Ran unrigged: lane A's GM was the active relay.** Lane A joined mid-walk,
and Foundry handed every Player-relayed request to its GM client, where the
pane's die rig does not reach: step 5's Throw (the declaration, the
Judges-only card, the toast and no local write, as written), a narrow-ledge
Throw (it rolled a botch and fell) and 11j's Attempt (the declaration "…
jumps.", one card, the record written). They are re-run rigged on a lane
with no other GM seated.

### Found by the walk

- After a climb-up fall the row's state reads Fell while its result line
  still reads "An edge: Hanging". Fixed on `main` as `59f2aa34` and walked
  there with Gamemaster 2 in a capture-driver seat, the die rigged (a 20 on
  the distance, a 1 on the shortfall and the save, then 7s): the member hung
  on the edge, and the climb-up miss left the row reading "Landing short by
  1 ft → An edge: Fell" with "Fell 20 ft, 2d6" priced at the depth, and the
  footing tooltip ending "Climb up: Natural 7, total 7 · RR p.270-271". The
  run's three cards were swept by id: asked 3, left 0.
- The Judge's "Climb up anyway" press is preceded by a warn toast and no
  dialog: "<member> cannot attempt this", raised at the press, after which
  the climb up throws (captured on the same run; a Judge is warned where a
  Player is blocked).
- The covered cell's tooltip reads "1 stretches"; older than this phase.
- T-0642 (`tooltip:2026-11-17`): the target's base figure carries no page,
  since `resolveCheck` drops the winning item's cite.
- Found offline, not by the walk: `acks-rules`' formation RULES.md §11 has
  the narrow and precarious botched-throw cells swapped against the printed
  grid (local-only; corrected there, uncommitted by design); `tools/rules-tests/test-obstacles.mjs`
  (gitignored) still calls the `assisted` name S6 renamed.

### Checked offline only

Each slice's suites with its mutations (S11 13 and 165, S14 182, S18 32 and
46, S19 38 and 60, then 39 and 65 after its fixes, S12 50 and 15); `npm
test` and `validate` on each landing's gate; the topic's tip before the land
(`npm test` 260 suites, `validate` OK).

### Not checked

- 11k with the jumping table or the shortfall die blanked: lane A shares
  the world's tables.
- A relayed landing save: its dialog would open on lane A's GM client.
- A climb-up miss that holds on, short of a fall; a holding member removed
  from the party.
- Swimming in a crossing: S12 has no surface yet.
- The detached window and the font knob on the new jump result cells.

### Fixtures kept

`formation/crossing-party`, `formation/crossing-adventurer` (owned by
Player 2), `formation/crossing-climber`, `formation/crossing-acrobat`,
`formation/crossing-beast`, all reused; nothing built. The crossing is
ended.
