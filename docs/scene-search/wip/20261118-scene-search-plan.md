# Scene search: plan

The scene screen: the party searches a place, after a fight or whenever it declares a search. Every inspectable at the place is one entry. Members are assigned to entries, each rolls for themself, and time is spent on the party's turn plan. The treasure the place holds is dealt up front and shows as each lot is found.

Feature slug: `scene-search` (`docs/scene-search/`, `docs/guides/scene-search.md`, `docs/releases/v*/scene-search.png`). Branch: `topic/scene-search`, worktree `C:\Proj\foundryvtt-acks-extras.scene-search`, opened with `acks-branch open scene-search`. The orchestrator ruled it lands after `topic/treasure`.

## The owner's words (verbatim, 2026-11-18)

- "Spoils should be rolled into this too, with the bodies shown as cards to inspect to see if they find anything with the proper skills and tools"
- "It should be assigning people to search the area and the bodies, and based on the rolls they find stuff. This rewards having multiple people working together and honors proper time tracking. Check RAW if you need extra hints."
- "Scope is all three, part of the next minor."
- "Finding the loot is the hasty check of the room, just like a hasty body check will turn out the pockets/inventory carried gear. Some things might be explicitly hidden up to judge's discretion. There also might be a hint that something feels off (secrets yet to be found) following the GUMSHOE principle. This is becoming a whole scene tool and could incorporate things like inspecting statues/art. To clarify, there is an obvious layer (bodies, doors, lights), an obvious with inspection layer (hasty search, pockets, chests, history, theology check, secrets present incl traps), found with methodical search and/or appropriate skill (spoils, secret doors, hidden keys, trap defeats). Everything beyond that is narrative in GM responsibility. Survey RAW and the adventures for examples. I like this tool as an end combat screen."
- "It could also be used in general when the party declares searching even without combat... add integration on party sheet?"
- "Seeing there is a fresco is obvious and would show up as a card to assign someone to, inspecting for subject is hasty, learning a secret/clue from it is methodical, as an example"
- On the obstacle redesign, which shares this plan's carrier: "Conditions are present when added, most easily by dragging. This is akin to a natural trap. Not doing a big switchboard of possibilities.", "Traps, obstacles, conditions can stack arbitrarily." and "This is some variation of location."
- The answers to the design questions on canvas v15:
  1. "rolled by judge before interaction, visible as found"
  2. "B" (a hasty check resolves at once, on a Round press)
  3. "missing skill just gets the vague hint there might be something more at hasty search, follow RAW"
  4. "B - GUMSHOE principal, it is meta-public knowledge if more clues remain unless it is hidden behind an unsolved (still something off) clue"
  5. "Unclear question". Built on the drawn default: the Judge may write an optional line, and otherwise the table sees the generic words.
  6. "No picked clean state, only checked hastily and checked methodically for each inspectable, and a found X or did not find X (and a hint if Y is known to be there but unknown what, e.g. a seen trap with a hidden disarm)"
  7. "A" (open loot takes the hasty search throw as printed)
  8. "B" (the imported search reach applies to positions)
  9. "B, there is no "stage a pot" as a thing"
- The go-ahead: "Get this implemented".
- Standing rules: "Standing rule for repo no generated art." and "No house rules ship".

## The design

The approved canvas is https://claude.ai/artifact/MWGwR5rfqxhhgmzrjvytnR, version 15, boards SceneJudge, ScenePlayer, SceneCards and SceneKey. The Spoils and Reveal boards on it are superseded. Its textures are placeholders: the shipped screen paints only textures read through the art seam (`scripts/treasure/card-art.mjs` `textureArt`), and with none imported an entry is a plain slab with its frame and words.

**The carrier is the place**, the `acks-extras.location` actor. Its area is the first of these that exists:
- the linked Region (`scene-link.mjs` `linkRegion`, `regionOfLocation`);
- the place's token footprint (`here.mjs`);
- the place's linked map.

Imported adventures already make each keyed area a place.

**Things at a place** live at `flags["acks-extras"].things` on the place, written whole by a GM client as a ForcedReplacement. Scene search and the obstacle redesign (dungeon close-out) agreed the shape, and it is signed in lib's DECISIONS by both before S1 lands:

```
{id, kind, ref, hidden, hint, point, params, layers: {hasty?, methodical?}, state}
```

- `ref` points at the document and never copies it: a trap Item, a Hazard (obstacle or condition), stored goods, a JournalEntryPage or an Actor.
- `point` is `{x, y}|null`: set by a map drop, null on a sheet drop.
- `params` holds the kind's own authored figures (an obstacle's `length`, `gap` and `depth`, each nullable); a condition's is empty.
- `state` is runtime progress only. A Reset clears `state` alone.
- Call the list "things", never "stack": `lib/place.mjs` already uses "stack" for identical places.
- Kinds: body, container, fixture, exit, trap, obstacle, condition, lot, floor.

**Derived, never stored:**
- doors: core walls touching the area, where `door === 2` is a hidden exit;
- old-style traps: zones and trap walls in the area, hidden unless `known`;
- a fight's bodies: read from Search the fallen's record (a message id, plus per-body state).

**The session** lives on the party actor at `flags["acks-extras"].sceneSearch`: `{sceneId, placeUuid, recordMessageId, potUuid, bodies, log}`. End unsets it.

**Checks.** Each inspectable has two:
- **Checked hastily:** a round; resolves at once on the Round press.
- **Checked methodically:** a turn; resolves on Turn.

Each check reads "Found X" or "Found nothing". There is no picked-clean state.
- A hint names the kind of thing still unfound, never the thing ("Something more: how to disarm it").
- Whether something more remains is public (GUMSHOE), unless it hides behind a clue not yet solved. A thing whose only way in is another entry's methodical check carries no mark of its own until that clue is solved.
- A hasty check is the searching throw. A member without the searching capability gets only "There might be something more here." when something is there (RAW: hasty search is a thief's throw, RR ch. 6). A failed hasty throw locks that character on that spot until they gain a level. A methodical check may be repeated.
- Open loot takes the hasty search throw as printed. Pockets turn out on a hasty check of a body.
- Every searcher rolls for themself (`rollCheckFor`, secret). A harvest takes one hand per part.
- Reach: a thing with a `point` is in reach when its distance from the party token is within the imported `searchReachFeet` (formation `trap-rules.mjs`). A thing with no point is the Judge's call.

**Time.** Activities register at init, with options per thing and layer and refusals under the `scene:` prefix:

| Activity | Length |
|---|---|
| `sceneHasty` | round |
| `sceneMethodical` | turn |
| `sceneHarvest` | turn, multi-turn, figures imported |
| `sceneIdentify` | turn |

- `length` is close-out's new registry field; `pace` keeps meaning hasty or methodical.
- The Round press calls close-out's `resolvePlanRound`. Spend a turn is formation's `resolvePlanTurn`, one press with the Dungeon tab, and it first resolves round-length entries still due.

**The haul** is dealt by the Judge's roll when the scene opens, before anyone acts, so bands are set at the deal. Every lot carries a "found" mark that starts false and sits behind the entry that hides it. Players see a lot only once it is found. The tray shows found lots, and its Open the pot opens the approved pot window, unchanged.

**Ways in:**
- The fight-over card offers **Search the scene**, and its Stage a pot goes away. This supersedes in part treasure DECISIONS "2026-11-17 — Search the fallen"; the new evidence is the owner's Q9 answer.
- The party sheet's Dungeon tab gets **Search here** (close-out's R-DC4). A player's press is a declaration the Judge accepts.

Both call `acksExtras.sceneSearch.open(...)`.

**Printed values.** Every figure arrives through the importer, and with nothing imported a field stays blank with its page reference in the tooltip, and its option cannot be assigned.
- The search throws and the thief's bonus are already imported.
- The lore proficiencies (Theology, Loremastery, Naturalism, Magical Engineering, Sensing Power) have no `rolls` spec in `cookbook/proficiencies.json`; request R-I1, owner to be named by the orchestrator.
- Harvest figures come from Treasure Tome's MM harvest work (its H1–H4, schema relayed 2026-11-18): `alternatives` prerequisite rows, `{turns}` and `{turns, perGp, minTurns}`, a keep window `{turns}`, `partKinds()`, and the identify target read from each proficiency's RR roll.
- `searchReachFeet` is already imported.

## Dependencies on other sessions

- **Dungeon close-out**, accepted 2026-11-18:
  - R-DC5 (a `skillCandidates` guard) is being fixed on main now.
  - After dungeon-closeout lands:
    - R-DC1 `revealSecretDoor(wall)`;
    - R-DC2, the exported trap hasty-search ledger;
    - R-DC3, registrant labels and reason roots;
    - R-DC6 widened: `length: "round"|"turn"` and `resolvePlanRound`;
    - the third `Placement` source in `trap-zone.mjs`.
  - R-DC4 (Dungeon tab Search here): its board is now approved; tell close-out.
- **Treasure Tome:** the harvest import (H1–H4) and the `side: "texture"` art rows.
- **The obstacle redesign** syncs onto this plan's carrier and builds none of its own.

## Slices

All slices are built on `topic/scene-search` by fresh agents. Each brief quotes the owner's words above, and each agent's report restates the ruling it builds on, with one example.

| # | Scope | Agent, and why | Waits on | Offline gate | Live walk |
|---|---|---|---|---|---|
| S1 | The pure model. `scripts/lib/place-things-logic.mjs`: the shape, `normalizeThings`, `addThing`, `removeThing`, the `kindOfDrop` registry. `scripts/scene-search/scene-logic.mjs` and `constants.mjs`: `sceneEntries`, `seatView` (hidden and behind-a-clue absent for players), `moreRemains` (the GUMSHOE mark), `layerOptions`, `layerRefusal` (the per-level hasty lock, named-approach needs, reach), `outcomeOf` ("Found X", "Found nothing", the vague hint for a missing skill, the "something more" hint). Every printed figure is an argument. `tools/test-scene-search.mjs`; a lib DECISIONS entry for the shape, co-signed by close-out. No UI | `implementer`: the model is fixed here | the lib shape co-sign | every rule above as a case, mutation-checked in a replica | none |
| S2 | The Foundry side, no screen: lib `place-things.mjs` writes, `placesAround`, the location drop branches, activities and resolution, the session API, reach from the party token | `implementer` | S1; R-DC1–3, R-DC5, the round resolver (stub the Round press until it lands) | | through the Dungeon tab's column |
| S3 | The haul dealt at open: lots with a "found" mark, players see only found lots, bands at the deal (treasure's pot, `scripts/treasure/`) | `implementer` | S1 | pot suites with the found mark, mutation-checked | yes |
| S4 | The screen, per SceneJudge and ScenePlayer: entries, party aside, assign by picker and by drag, Round and Spend a turn, the log, the haul tray. Recipe in `docs/scene-search/TESTING.md` | `implementer` | S2, S3 | | both seats |
| S5 | Ways in: the fight-over card's Search the scene (Stage a pot removed); close-out's Dungeon tab button | `implementer` | S4; R-DC4 | | a real fight ends; a declared search with no fight |
| S6 | Keying: the location sheet's Things here (SceneKey), the Judge's keying rail | `implementer` | S2 | | Judge seat |
| R-I1 | Lore rolls: a `rolls` spec for Theology, Loremastery, Naturalism, Magical Engineering and Sensing Power, in the per-book layout `scripts/importer/books/rr/` (owner: "They should be building separate importer files per book... new work should be building that clean version"); each roll cites its page, no target ships. The Treasure Tome session reviews the recipe shape against `identifyComponents` before the first commit | `implementer`: a scoped importer recipe | S1 | cookbook compiles, silo gate | none |
| S7a | Lore checks | `implementer` | R-I1 | | yes |
| S7b | Harvest and identify, multi-turn. **Deferred out of the minor** (owner, 2026-11-19); now a `ROADMAP.md` row, and a fallen body's Sheet control is the cutoff | `architect` ruling on the imported schema first, then `implementer` | Treasure Tome H1–H4, and the owner's monster-import audit | | yes |
| S8 | MODEL, DECISIONS, guide, gallery, changelog; shots from data a user produced | session, plus `doc-scribe` | all | | |

Every UI slice (S4, S5, S6) builds from the approved boards. A change beyond them goes back to `/design` first.

## Start prompt for the phase session

> You are the scene-search phase orchestrator for acks-extras. Read `docs/scene-search/wip/20261118-scene-search-plan.md` on main, the canvas it names, and `.claude/rules/` (shared-tree, live-testing, ip-doctrine, ui-layout, ui-tooltips). Open `topic/scene-search` with `acks-branch open scene-search`. Then build the slices in order with fresh agents: the `implementer` for S1–S7a, the `architect` before S7b, `doc-scribe` for S8. Quote the owner's words from the plan in each brief.
>
> Before S1 lands, draft the lib DECISIONS entry for the thing shape and have the dungeon close-out session co-sign it (session `local_bfe7fed4-186d-4405-b14c-744a05cd9fa3`). Tell close-out the SceneKey board is approved, so R-DC4 can go ahead. Coordinate landings and requests through the orchestrator session "Parallel agents progress check" (`local_92c2ccc0-455d-48a5-9262-71dd94b4bc45`).
>
> Land each slice that needs a walk, and walk it on main. Append results to this plan's "Results" section, and report to the owner.

## Results

### 2026-11-18 — phase start (scene-search orchestrator, session local_80255613)

- `topic/scene-search` is open in the sibling worktree, branched at defe2eff.
- The lib thing-shape entry is co-signed by dungeon close-out and committed on the topic as d8efe23b, not landed. Close-out changed two things: the co-signer is obstacle regions, and the Hazard `ref` is provisional until the obstacle redesign's boards are approved.
- R-DC5 is on main as f6dcc299. R-DC4 moves to this topic: S5 carries the Dungeon tab's Search here button and its relay, built after dungeon-closeout lands, and formation reviews it. Close-out confirmed `resolvePlanRound(formation)`, which returns `{results}` like `resolvePlanTurn`.
- R-I1 is a scene-search slice (row above), assigned by the orchestrator.
- S1, the pure model, is building. Its layer schema is the orchestrator's ruling: a layer is authored only, `{check: inspect|search|skill, capability, anyone, tools, turns, yields: {lots, clue, reveal}}`, and its runtime is at `state.layers` and `state.shown`.
- Owner rulings relayed by the orchestrator:
  1. Where the stack lives: "Everything to a place that can apply effects to a region. All to region if easiest". Close-out's architect picks the carrier by build cost, and S2 waits on that pick.
  2. Harvest time between printed steps: "Round up" (S7b).
  3. A dual-typed creature: "Any of its rows" qualifies a harvester, and the Judge overrides per body (S7b).

### 2026-11-18 — S1, S3 and R-I1 landed and walked; the rest held (scene-search orchestrator)

- Landed on main with `branch.mjs land`, tip eb4db7a2, fast-forwarded from 9b7b65e2: the thing-shape entry 4a8a7d0f, S1 997c57d7 and cea5a898, the carrier on the place a5fc4827 (the owner's "Everything to a place that can apply effects to a region", close-out's architect's pick), S3 3e35a628 and 1b331e6f, the Hazard ref 048c37b3 (H1's `acks-extras.hazard` Item, keyed by `system.key`), and R-I1 eb4db7a2. The orchestrator pushed eb4db7a2.
- S3 is walked on main: `tools/live/scene-search.mjs`, 20 of 20 on lane A, after a world relaunch on eb4db7a2. The walk found that the deal answered each lot with the wrong card. The fix is 0aecb809, not pushed: `lotsInPot` finds a lot's card by its key, and a new offline check fails on the old code. A lane B attempt was blocked before its first step because its GM was not the active GM. TESTING records the drive mechanics.
- Held under the orchestrator's convergence order (the owner: "Orchestrate the agents toward completion so this can get back to serial work ASAP, it seems like the parallel work path is not saving time in the end"): S2, S4–S8 and R-I1b (`docs/scene-search/ROADMAP.md`). The next slice is S2. `topic/scene-search` stays open; sync it before S2.
- Findings registered for S2 and S4, not worked:
  - `seatView` does not redact unfound yields, so a player projection is needed.
  - Lot keys stay in the session record and never in the place's authored `yields.lots`.
  - A body's keys come back in `missing`.
  - Set the pot's `partyId`.
  - Search targets come per actor from `PARTY_CHECKS` and `resolveCheck`.
  - The thief's-bonus reading is unverified.
- S3 has no changelog fragment yet. S8 writes it with the feature's others.
- Owners of what is held: S2–S8 are this phase's, started when the orchestrator dispatches them. The B-slices (H2, H3, P3, H0) are obstacle regions', on dungeon close-out (local_bfe7fed4), held the same way.

### 2026-11-18 — obstacle regions B3 built the carrier's write half (dungeon close-out session)

- `scripts/lib/place-things.mjs`: `THINGS_FLAG`, `thingsOf(place)` and `addThingTo(place, thing)`, the list written whole by a GM client as a `ForcedReplacement`, the co-signed shape unchanged. S2 extends this file rather than writing its own.
- Formation registers the `trap`, `obstacle` and `condition` kinds (`formation/hazard-things.mjs`). `createLocationForRegion` takes `{render: false}` for a map drop.
- A registrant keeps its `accepts` narrow: one as broad as "any Item" makes `kindOfDrop` null for every trap and hazard drop.

### 2026-11-18 — S2 built on the topic, not landed (scene-search orchestrator, lane 5)

- S2, the Foundry side with no screen, is on `topic/scene-search`, 2cba574d..05edc173, synced on df8ec005 (P3's `updateThingOn` reused for state writes). It was built by an `implementer` agent; two validate fixes are the orchestrator's (the api's calls named so the developer reference reads them, and lang prefixes that end in a dot). Offline: test-scene-session 108, test-scene-drop 26, test-scene-search 171, test-scene-haul 105; 33 of 33 mutants killed. Not walked; the S2 section of `docs/scene-search/TESTING.md` is marked not yet walked.
- The canvas check: the live canvas reports version id 1795055765-e6c1, with no numeric 15. S2 reads no board, so the check moves to S4's brief.
- Seams for unbuilt dependencies:
  - The Round press, `scripts/scene-search/round.mjs` `resolveSceneRound(formation, deps)`. It calls `resolvePlanRound` once `turn-plan.mjs` exports it (R-DC6, `via: "plan"`). Until then it unlocks the scene's round-length plan entries and resolves them through the activities' own `resolve` (`via: "scene"`), and spends no clock time.
  - A hidden exit found, `scripts/scene-search/seams.mjs` `revealExit(scene, wallId, {reveal})`. The reveal is recorded in the thing's `state.revealed`; no wall is edited until R-DC1's `revealSecretDoor` is passed as `reveal`.
  - Doors and old-style traps as entries, `scripts/scene-search/session.mjs` `derivedInputs`. It answers none until R-DC1 and the third `Placement` source exist.
  - R-DC2 is not wired: the failed-hasty lock lives in the thing's `state.layers.hasty.failed`.
  - R-DC3 is not wired: `scene:` refusals take their own words (`words.mjs` `sceneReasonText`), and turn-plan's `reasonText` shows them as its generic line.
- Rulings applied in the build:
  - Reach with nothing imported, no scene scale or no party token is the Judge's call, never a refusal (S1's reading of "B", the imported search reach applies to positions).
  - `open` and `end` are Judge-only. A player's `assign` is a declaration through the party's `plan` relay, for a character that seat owns.
  - The thief's bonus is folded into the searching target by the cookbook's Searching throw modifier, so S1's `searchBonus` stays null. This rests on the cookbook row and the `ability-rolls.mjs` docstring, not on the gating code.
- Findings registered, not worked:
  - (S4) The relay's registrant calls carry no user, so a hand-made `plan` request can name a hidden entry. Pass the requesting user in the lock's `ctx`.
  - (S4) While a session is open, the Dungeon tab's activity select lists one identically labelled option per entry.
  - (S5) Goods a fight's bodies carry, dealt into a scene pot, are not taken off the bodies, since treasure's take-off keys on a combat origin.
  - (S5) A body's linked table is not drawn at the deal; only its letter and carried goods are.
  - (S4) The Round press spends no clock time.
  - (S8) `docs/README.md` has no row for `docs/scene-search/DECISIONS.md`.

### 2026-11-18 — S2 landed and walked (scene-search orchestrator, lane 5)

- S2 is landed on main: `branch.mjs land`, tip 782fbe48, fast-forwarded from 8e9916c5. The orchestrator pushes it.
- S2 is walked on main: `tools/live/scene-search-session.mjs`, 49 of 49 on lane A, committed with the recipe's drive mechanics as f4868813. The walk found no defect.
- The seams stay as recorded above: R-DC1 and R-DC6 have not landed. The Round press resolved `via: "scene"`.
- Next is S4, the screen. Its brief confirms which canvas version is the approved board before the first edit. S5, S6 and S7a follow, and the orchestrator dispatches each. `topic/scene-search` stays open; sync it before S4.

### 2026-11-19 — S4 landed and walked (scene-search orchestrator, lane 5)

- S4 is landed on main: `branch.mjs land`, tip c3ca9e17 (bb5ce9ad the screen, 41067586 a player's press asks the Judge, c3ca9e17 the Round press spends a round), fast-forwarded from 63588364. Not pushed; the orchestrator pushes.
- The owner chose "Notify the Judge" for a player's Round and Spend a turn: the party relay's `askPress` request declares the ask and moves no clock (41067586).
- R-DC6 is on main, so the scene's Round press is the Dungeon tab's own pair, one round on the clock and then `resolvePlanRound`. The scene's fallback resolution and its `lockedBy` map are gone (c3ca9e17).
- S4 is walked on main: `tools/live/scene-search-screen.mjs` on lane C, six runs. The walk found two defects, fixed in 6e94d01d:
  - a short window cut the tray off;
  - the screen started watching only after its first draw.
- Not checked live:
  - The player's relays (Player 3's assigns and Player 6's asks) failed in runs 5 and 6, while lane A's Gamemaster was the active GM and did not answer. They passed in runs 1-3 and 1-4 respectively, and need one run where this walk's GM is the active GM.
  - The layout step ran on an injected copy of `styles/scene-search.css`: the running world was launched before `module.json` named it, so the stylesheet loads only after the next world relaunch.
- Findings carried forward:
  - A refused check at a hidden entry is stamped resolved and tells the Judge nothing.
  - (R-DC3) A player's hand-made lock at a hidden key still lands in the plan.
  - (R-DC3) The Dungeon tab's identically labelled options.
- Next are S5, S6 and S7a, each when the orchestrator dispatches it. `topic/scene-search` stays open; sync it before the next slice.

### 2026-11-19 — S5 and S6 landed and walked (scene-search orchestrator, lane 5)

- The S4 relay re-run passed 58/58 on lane C with Gamemaster 3 as the only GM seated (`/api/status` users 0 before and after): Player 3's assign was accepted by Gamemaster 3, and Player 6's asks each posted one card and moved no clock.
- S5 (ways in) and S6 (keying) are landed on main: tip 25a38137 (6dc4712e S5, 24f642e5 S6, 25a38137 fixes), fast-forwarded from 3ef4245c. Not pushed.
  - The first land was refused: test-strip's Handlebars mock lacked core's `or`, which the Dungeon tab's Search here uses. 25a38137 adds it.
  - 25a38137 also rolls a body's linked table once per card (`drawnBy`, `heldDraw`), so a re-press after a refused open no longer draws it again.
- Walked on main, lane C:
  - S5 passed 35/35 on the rewritten `tools/live/treasure-search.mjs`.
  - S6 passed 54 of 55 on the new `tools/live/scene-search-keying.mjs`. Its one skip is step 8, since nothing derives the map's doors.
  - The S5 walk found one defect, fixed in f5a4e97f: a chat card's stored content loses `hidden`, so every fight-over card showed its empty table-text block.
- `tools/live/treasure-search.mjs` is not committed yet: the edit ledger gives one of its lines to session e9a0fede, which may still be working, so it waits on that line's adopt.
- Not checked live:
  - Both walks ran on an injected copy of `styles/scene-search.css`, because the world has not been relaunched since `module.json` named it.
  - Drops are synthetic events.
  - A seat that owns no member was not tried, since there is one Player seat.
- Owner answers relayed by the orchestrator: S5 Q1 keeps the lair notice ("players get blocks, judges get warnings"). S6 Q2, Q3 and Q4 are deferred to the ROADMAP ("What S6 left"). Still with the owner: whether a spent card can reopen its scene, the take-off timing, how long Show to the table lasts, and the board deviations (S5 card rows and relabel; S6 tab position, proficiency select, empty-aside prompt).
- Next: S7a (lore checks) on the topic, after a sync. Then S7b, with the architect first.

### 2026-11-19 — S7a, S5b, the Sheet control and the Crossing fieldset landed and walked; S7b deferred (scene-search orchestrator, lane 5)

- Owner answers relayed by the orchestrator, verbatim:
  - Harvest: "Defer, the MM imports already partially carry that data, and those need a full audit in general that I will dedicate a full pass to. Put in the entry point that looks at the monster's sheet for now as a cutoff point." S7b moved to `ROADMAP.md` (d5b20d34).
  - Where the sheet opens: "Both (Recommended)", the fight-over card and the scene screen.
  - S5b, a spent card reopening its scene: "Yes, for a Judge". Take-off timing: "When found".
  - Where a place's crossing figures are edited: "Keying rail (Recommended)". The three departures from the board: "Keep all (Recommended)" (95045976).
- S7a (lore checks) is on main: 8e215b7d, f1f829e9, 18e0f398. Walked by `tools/live/scene-search-lore.mjs`, 33 pass, 1 fail (6a9d7f5b). The fail was the party-check card's target tooltip, which named no page for a skill-thrown check. It is registered as T-0683, and a peer fixed it in 8b285f48. The tooltip is not re-walked here.
- S5b is on main (09630273). A Judge's press on a spent card reopens its scene, and a body found is taken off. `tools/live/treasure-search.mjs` walked it: 48 pass, 0 fail (6d24e62e).
- The Sheet control (bdec34b7) and the Crossing fieldset (ebb599f2), built on the topic, were landed together (tip 4545820c, after the land's gate refused a literal `uppercase`). The new `tools/live/scene-search-sheet-crossing.mjs` walked both on lane C: 70 pass, 0 fail, no console error on either seat, recorder attached before `init`. TESTING says per step what was not driven: the crossing's narrow window and type size, keyboard order, Begin over the place, a pass with no imported penalty steps, a container's card, and deleting the world actor.
- Stylesheet check closed. `styles/scene-search.css` loads natively: a probe of the top-level `document.styleSheets` cannot see it because core 14 nests module sheets under an `@import`. The sheet-crossing walk found it loaded on both seats.
- Not pushed: everything above except 6d24e62e. The orchestrator pushes.
- Next: S8 (docs, guide, gallery, shots from user-made data), then `branch.mjs close scene-search` once the feature is walked.
