# Obstacle regions: plan

The owner approved the design boards (the "Proposal: obstacle regions seed the
crossing" row of the crossing design canvas, v10) and said: "Implement it".
Scope ruling, relayed 2026-11-18: "Scope is all three, part of the next minor."
This topic lands last in the minor (after importer-books, treasure,
dungeon-closeout and bta) unless it is ready sooner, and only on the managing
session's "your turn".

Tree: `topic/obstacle-regions`, worktree `foundryvtt-acks-extras.obstacle-regions`,
opened at main. Each slice goes to a fresh `implementer` agent (sonnet), because
each is scoped against this plan. The design ruling was an architect pass (opus).

## Mechanism (architect ruling, 2026-11-18)

- **Seeding record.** `crossing.region = {uuid, taken: {key: value}, judge: {key: true}}`
  is written in `beginCrossing`'s single replacement write and removed by End.
  A key in `taken` and not in `judge` shows the region mark.
- **Judge mark.** `applyCrossingForm` sets `region.judge.<key>` for each key
  whose value changed. Its existing equality check skips untouched fields.
- **Region edits are compared on render.** Drift is the keys where the region's
  current seed differs from `taken`, with Judge-marked keys left out. The
  `updateRegionBehavior`, `deleteRegionBehavior` and `deleteRegion` hooks only
  re-render. Take writes the drifted keys and updates `taken`. Reset writes
  every key the region fills and clears `judge`. A deleted region shows no
  warning, no buttons, and the glyph in the art frame.
- **Booleans.** A boolean is a StringField with yes/no choices and a blank
  option, so blank means "the Judge sets it".
- **Entry.** The step `crossingRegionEntry` sits in `module.mjs`'s party-token
  movement hook, after `runTrapCheck`. That hook already runs only on the
  primary GM and only for the party token, and already skips halt, travel,
  resize and truth moves.
  - Entered regions are the current `zonesUnder(token, TYPE)` minus the party
    actor flag `obstaclesUnder`, a list of uuids.
  - Journey and settlement mode start nothing.
  - One entry runs at a time per formation.
  - Core's TOKEN_ENTER events are rejected: they split every move at the
    region's edge, and they fire when a behaviour is enabled under a party
    already standing there.
- **An open crossing.** `beginCrossing` already refuses while a crossing is
  open. The card's "End it and start this one" runs End, then Begin, and refuses
  when the open crossing's id has changed since the card was posted.

## Slices

| Slice | What | Waits on |
|---|---|---|
| S1 | The behaviour type: `CROSSING_OBSTACLE_TYPE`, `crossing-region-logic.mjs` (kinds, keys per kind, `regionSeed`), `crossing-region.mjs` (data model, registration, a config render hook that shows only the chosen kind's fields), `module.json` documentTypes, lang | — |
| S2 | Seeding, the marks, the drift warning, Open / Reset / Take, the art frame | S1 |
| S3 | Party-token entry, the Judges' card, Start at once, End and start | S2 |
| S4 | Swim and squeeze keys. `penaltyPick` gets a validator and a select built at render, never `choices` | dungeon-closeout landed, then sync |
| S5 | Docs: MODEL, DECISIONS, TESTING, changelog. The live walk on main after landing, which needs a world relaunch for the sub-type | landing |

## Defaults built on the architect's open UI points (owner may overrule)

1. Booleans are yes/no selects with a blank option.
2. The climb obstacle pick is required and starts on the first column.
3. If the region's kind changes mid-crossing, the warning says so and Take
   moves only setup keys. A deleted region is silent.
4. "Start at once" posts no card.
5. There is no way back after "Not now" or "Nothing" except the old card or
   re-entering. A "begin from region" control needs `/design` first: ROADMAP.
6. The config window hides the fields the chosen kind does not use.
7. The marks are small tags, "region" and "Judge", each with a tooltip.

## Owner ruling on the defaults (2026-11-18)

Relayed, verbatim: "Conditions are present when added, most easily by
dragging. This is akin to a natural trap. Not doing a big switchboard of
possibilities." It supersedes default 1, and touches 3 and 6. S2 was stopped
before it wrote anything. An architect re-rules the data shape, and the
affected board is redrawn for the owner before building resumes.

Follow-up, relayed verbatim: "The questions reveal the design is off." The
whole design is being redone from the trap zone's model: an obstacle is a
natural trap whose conditions the Judge drops on. All implementer work stops.
S1 (b1be395a) stays on the topic until the owner decides whether to keep or
drop it. An architect pass comes first, then a new board goes to the owner
before any build.

A further constraint, relayed verbatim: "Traps, obstacles, conditions can
stack arbitrarily." One region, or several overlapping regions, may carry any
mix of them, and all of them apply on entry.

A starting point, relayed verbatim: "This is some variation of location." An
obstacle, and whatever is stacked with it, is designed as a kind of location or
as a location's contents, not as a new region-behaviour type. The design is
cross-checked against the treasure plan's scene-search screen.

### Redesign ruling (architect, 2026-11-18). The Mechanism, Slices and Defaults above are superseded.

- **The container is the place.** A location actor is linked to its Region
  (`scene-link.mjs` `linkRegion`). Obstacles and conditions are one new Item
  sub-type, `acks-extras.hazard` (a `key`, plus nullable `length`, `gap` and
  `depth`), kept in a Hazards compendium.
  - A drop on the place's sheet, or on the Region on the map, embeds a copy.
  - A condition is either present or absent: `ropeFixed`, `noRunUp`,
    `precarious`, `waterCold`, `waterRough`, `waterFast`.
- **Traps stay trap zones on the Region,** and the place's sheet lists them.
  One drop mechanism serves traps, obstacles and conditions.
- **On entry,** things happen in this order:
  1. the search sweep;
  2. each armed trap fires with its own card;
  3. if nothing halted the move, one Judges' card covers every newly entered
     place, with a Begin button per obstacle.

  Begin seeds the crossing once, from every condition of the places the party
  stands in, and nothing re-reads the place afterwards. Begin over an open
  crossing asks the Judge to End it first.
- **Gone from the first design:** the region behaviour type, the yes/no/blank
  selects, the entry choice, the marks, drift tracking, and Take/Reset.
- **What S1 keeps:** `SETUP_FIELDS` export, the reader logic, and the
  template-parsing test.
- **Slices:**

  | Slice | What | Needs |
  |---|---|---|
  | H0 | Trap stacking (`findZone`, `livePlacement`, `behaviorOf` and `runTrapCheck` assume one zone each) | The dungeon close-out landed |
  | H1 | The Item type, its compendium and the logic | Board B4 |
  | H2 | The place-sheet section, the drops, and the Region's Place row | Boards B1 and B3 |
  | H3 | The entry step, the card and the seeding | H0, and the close-out landed |
  | H4 | Swim and squeeze keys | The sync |
  | H5 | Docs and the live walk | — |

- **Owner, on where traps live (2026-11-18), verbatim:** "Everything to a place
  that can apply effects to a region. All to region if easiest". The split
  with traps on the region is out. Decisions 1, 3 and 4 were not answered, so
  their defaults as drawn stand. An architect picked the place over
  all-on-region on build cost: imported keyed rooms are places with no Region,
  and the shape co-signed with scene search already keeps things on the place.
  - New traps become trap things on the place, and P3 is formation's
    `Placement` source for them.
  - Existing trap zones and trap walls stay as `Placement` sources, listed
    read-only.
  - The Hazard item holds no figures. The figures sit in each thing's
    `params`.
  - Boards redrawn: canvas v13.
- **Owner approval of v13 (2026-11-18), verbatim:** "Approve, build it".
  - Obstacle regions builds B4 (the Hazard type and `crossingSeed`), B3 (the
    Region's Place row), B2 (the entry card and seeding), P3 and the trap
    stacking.
  - Scene search builds the carrier, location's drop branches and B1 inside
    "Things here".
  - S1's behaviour type is dropped on the topic. Its `SETUP_FIELDS` export,
    reader logic and template-parsing test are kept.
  - Before H0 or H3, sync onto the PR #5 merge (its sha comes from the
    orchestrator), and read 1c18168f ("trap check reads its start inside the
    move queue"). A fix that merge already holds is not built again.
- **Boards B1–B4** are on the crossing canvas, v12. The build waits for the
  owner's feedback on them.

## Results

(appended per slice)
