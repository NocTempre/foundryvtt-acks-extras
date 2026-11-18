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

## Results

(appended per slice)
