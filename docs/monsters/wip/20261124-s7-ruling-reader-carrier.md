# S7 ruling, part A: points 1 and 2 (the range reader and the item carrier)

Architect, read-only. Read on 2026-11-24 from `main`'s working tree at `5872c1a7` (S6a and S6b landed at `455f2cfa`, an ancestor), which carried peers' uncommitted edits in `docs/lib/API.md`, `scripts/lib/roll-gate-kinds.mjs` and `tools/test-typed-modifiers.mjs`; code is cited by symbol. Core reference: the acks system at `release-14.2.0` where it matters. Items, roles and traits are named by the plan's neutral ids only. Points 3 and 4 belong to the other architect; the closing section here covers S8 and S9a only.

The lib index is `scripts/lib/README.md`; `docs/lib/README.md` does not exist.

## The owner's words, restated

1. "I want the beastmen template fixed with special attention towards
   capturing everything in this document mechanically (plus arranging art
   correctly, etc)." Read: every rule the section prints is performed by the
   module, not only noted. Example: E4's paragraph is not finished when the
   creature's notes name it; it is finished when raising it makes a creature
   in reach roll the save and carry the condition the paragraph names.
2. "Fixing the group actor type to handle generating a warband, assigning
   special troop types, equipment packages, spell casters, etc. Seems like the
   right approach. Many of these items generate ranged aura effects or require
   an action to activate. All of that game surface is in scope." Read: the
   group generator is the vehicle, and the items' table behaviour, both the
   standing zones around a bearer and the things a bearer does with an action,
   is part of the job, not a later nicety. Example: E9 played by a leader puts
   its parts on the beastmen of its own unit inside its radius and takes them
   off when they leave it; E2 lit by an R3 body burns its fuse on the tracker
   and blasts everyone in its radius when it comes due.
3. "Furthermore, creating kits (including random ones suited to matching roles
   and custom as a group, as a unit type, or as an individual) is desired."
   Read: a kit is a reusable bundle a Judge can hand out at three scopes,
   rolled or chosen, and section 4 answer 2 lets it carry items, stat changes
   and abilities. Example: a random kit suited to R3 given to one gang's stack
   carries its weapons and E2, and the stack's bodies all carry them.

This ruling answers to sentence 2's last two sentences.


Sentence 2, quoted whole: "Fixing the group actor type to handle generating a warband, assigning special troop types, equipment packages, spell casters, etc. Seems like the right approach. Many of these items generate ranged aura effects or require an action to activate. All of that game surface is in scope."

## What the five pieces need from a reader (from the plan's rows 40-42, 47, 60)

Read from the page by structure only; every figure below is an imported key
of the `beastmanEquipment` / trait rules the importer already reads (S3).

| Piece | Trigger | Who is reached | Live membership? |
|---|---|---|---|
| E3 | one action | the bearer's subordinates of its kind, within the imported `radius`, at that moment | no: a snapshot |
| E4 | raised until lowered | any creature (the row's filter) that starts its initiative within, or moves within, the imported `radius` | yes: pulses on turn start and on moving in |
| E9 | played | bodies of the bearer's own unit, of its kind, within the imported `radius`, while there | yes: a standing part while inside one or more |
| T10 | always on | the kinds the row names, engaged with a bearer at its turn start or becoming engaged during its initiative | yes: pulses, at reach |
| E2 | the fuse comes due | every creature within the blast row's `radius` at detonation | no: a snapshot |

## Point 1: the range reader

### The choice

**Extend core: a live reach is a core Region attached to the bearer's token,
carrying a new module behaviour sub-type, and core's Region membership is
the verdict.** A pure lib filter decides who of those inside counts, and lib's
turn hook is the clock. Nothing in the module computes the area or keeps the
membership.

- **Governing ruling, in force:** `docs/lib/DECISIONS.md`, "2026-11-16 — The
  core Region is the object, and the module's types compose onto it": "The
  core Region owns shape, Levels, elevation, membership and area … Nothing in
  the module computes geometry or membership that core keeps." A module-side
  scan that keeps who is inside a radius would rebuild exactly what that entry
  forbids. This ruling applies it and supersedes nothing.
- **What core 14 provides** (read in the installed build 14.370, not walked):
  - `RegionDocument` has `attachment.token` (common `documents/region.mjs`
    `defineSchema`).
  - An attached Region's shapes move with its token inside the token's own
    update (client `TokenDocument` `#computeAttachedRegionUpdates`).
  - Its `hidden` follows the token's.
  - It is deleted with its token (`TokenDocument._onDeleteOperation`).
  - A Region whose boundary moves has its tokens recomputed on the active GM,
    which fires `tokenEnter` and `tokenExit` (`RegionDocument` `_onUpdateOperation`
    calls `#updateTokens`).
  - The events `tokenEnter`, `tokenMoveIn`, `tokenExit`
    reach a behaviour's `_handleRegionEvent` (`CONST.REGION_EVENTS`).
  - Core 14 has no MeasuredTemplate document. A Region is core's only area on
    the map, so a ring a player sees is a Region in any case (question 2 below).
  - The module already registers three behaviour sub-types (`district`,
    `encounterZone`, `trapZone` in `module.json` `documentTypes.RegionBehavior`).
    `regions.mjs` `behaviorsUnder(token, type)` already answers which live
    behaviours of a type a token stands in.
  - **The shape is core's too.** Core 14 has an `emanation` region shape
    (common `data/data.mjs` `EmanationShapeData`: a `base` shape grown by
    `radius`, with a `gridBased` field; the words "conforming to the grid's metric" are the cone's docstring for the same field, and the emanation's own docstring and its radius unit were not read), and a
    `token` base shape (`TokenShapeData`). A reach is therefore a
    `gridBased` emanation of the bearer's token footprint by the imported
    radius. No circle is drawn by the module, and a large bearer's reach
    starts at its edge, not its centre.

### Which measure is the verdict

**Core's containment of the attached Region is the verdict.**
`tokenGapFeet` is not a second test. It appears only in the tooltip, as the
measured distance. Two verdicts would disagree at the edge, and the in-force
ruling gives membership to core: formation's party membership is "Core's
footprint". The grid-based emanation keeps the two close (read, not
walked). No second test is made, so no event is needed for a re-test.

### Where it lives

All in lib, since it crosses monsters, equipment and characters (marker
`lib/aura-bearer`, as the plan's S8 row names it):

- `scripts/lib/aura-reach-logic.mjs`, Foundry-free:
  - `reachAdmits(bearer, subject, filter, deps)`: true, false, or null.
  - The pulse decision: given an event or a turn start, the subject's
    immunity records and the row, answer prompt, skip (immune), or standing
    part on or off.
  - The behaviour's config shape.
- `scripts/lib/aura-reach.mjs`, the Foundry half:
  - The `aura` RegionBehaviorType sub-type: config only, holding the source
    item's uuid, the bearer actor's uuid, an activation id and the row key.
    It is registered on `CONFIG.RegionBehavior.dataModels` at `init`, beside
    formation's three.
  - `raiseReach` and `lowerReach`: create and delete the attached Region,
    through lib's socket relay where the seat is a Player.
  - The event handler and the turn listener.
  - The one teardown (below).
  - Its events, in `static events`: `tokenEnter`, `tokenMoveIn`,
    `tokenMoveIn`, `tokenExit` (which pulse listens to which: Addendum, A2).
- `module.json` `documentTypes.RegionBehavior` gains `aura`.

No core method is wrapped for the reader. It composes onto core documents
only, so point 1 adds no seam owner.
### The filter

The filter is a field of the row, `{kinds, exceptKinds, side, unit}` (A6), and every key is
module vocabulary. A clause that cannot be settled answers null, never
false. A null subject is listed on the Judge's card as undetermined, with a
tick for the Judge. This follows the owner's ruling of 2026-11-14,
"automation blocks a player, warns a Judge".

- **`kinds`: the row's kind keys, read by lib `creatureKinds`, extended.**
  This is the one kind reader the scope evaluator already takes as
  `ctx.kinds` (`vocab.mjs` `scopeApplies`, "the consumer's own vocabulary").
  - For a monster, `creatureKinds` reads the imported `extras.types` today.
    A Judge already edits that field on the monster sheet (`monster-sheet.mjs`,
    `types` choices), so the "Judge's tag" exists and nothing new is added for
    it.
  - Two gaps, supplied in S8:
    - A monster's imported `subtype` qualifier is not read. The extension adds
      its folded tokens beside the types.
    - A character gives only `character`. The extension adds the race key and
      its category from the classes feature's own answer for the class
      (`raceKeyOfClass`, which influence's `inferRace` already calls), reached
      through a lib registration so lib does not import classes.
  - The row stores kind keys, never the page's words. The importer folds the
    item's printed qualifier onto those keys. The Judge edits them with the
    effect-row editor's existing scope-kinds control ("A modifier or ward row
    edits its scope: the kinds it applies against").
  - **Finding to register:** influence's `kindOf` (`scripts/influence/racial.mjs`)
    is a second kind reader with its own name matchers. It stays influence's
    for now and goes on the ledger (`acks-bug-triage`) as a duplicate of lib's
    reader.
- **`side`: `any`, `own` or `opposing`, read by lib `areEnemies`.** That is
  the disposition reading `outnumberingHolds` already uses. A neutral or
  secret token is null.
- **`unit`: `any`, `own` or `under`.**
  - `own` means the subject token's `flags.acks-extras.group` (`group-logic.mjs`
    `GROUP_FLAG`) equals the bearer's. Only this flag exists on `main`.
  - `under` means the unit the bearer leads is the subject's group or one of
    its ancestors. Who leads what, and the upward pointer
    (`unit.parentGroupUuid`, still proposed), are S10's and S11's. lib takes
    them through a registration (`registerUnitAncestry`) that the monsters
    feature fills.
  - Until it is filled, `under` answers true for an `own` match and null
    otherwise. A character bearer, which has no group, answers null.
  - This is the architect's re-ruling's three meanings of "the same group",
    made a field the Judge can see rather than a guess.
- **A marker token is never a subject.** This is `place.mjs` `isMarkerActor`,
  "the ONE test a reader that takes a token for a body". Inferred: a party
  token's members are not reached until combat deploys them.
### What refreshes it, and on which client

Everything below runs only where `isPrimaryGM()` (`util.mjs`: the active GM
seat and its lead window) holds. Core dispatches Region events on every
active-GM client, and its own toggle behaviour guards with
`game.user.isActiveGM`. Two windows of one GM seat would both act.

- **Moves.** A move is core's region events on the behaviour. A subject
  walking in fires `tokenEnter` / `tokenMoveIn`. The bearer walking up to a
  subject moves the attached Region, and core fires `tokenEnter` for the
  tokens it now covers.
- **Turn edges come from one source, lib's `TURN_BEGAN_HOOK`.** This is the
  hook `turn-life.mjs` and the cast engine's recurring prompts already run
  on. On a turn start, `behaviorsUnder(subjectToken, "aura")` names the live
  reaches the subject stands in.
  - Core's own `tokenTurnStart` event is not used. It fires from core's
    `Combat#onStartTurn`, and the system's `AcksCombat` overrides `nextTurn`
    and `nextRound`. Nobody has seen core's event fire under the system, and
    lib's `turnEdges` already decides what a re-sort or a step back is.
- **E9's standing part** is one held, managed effect per subject, written
  only when state differs. It follows `held-condition.mjs`'s pattern: on
  while the subject stands in at least one qualifying reach of the item's
  kind, off when it stands in none. Parts from several bearers never stack,
  which the page's wording needs.
- **The one teardown is the Region's deletion** (a `deleteRegion` hook on
  the primary GM). It lifts every record carrying that Region's activation
  id. Each way a reach ends deletes the Region, and nothing else lifts its
  records:
  - **Lowered:** `lowerReach` deletes the Region.
  - **The bearer slain:** a slain body keeps its token, so core deletes
    nothing. No existing defeat hook was found to reuse: S8 adds a primary-GM
    listener (on the bearer's hit points reaching zero, read through lib
    `hp-logic.mjs` `tokenHitPoints`, or the system's dead status landing,
    `tokenHasStatus`) that calls `lowerReach`, and that also deletes a slain
    T10 body's Region.
  - **The token deleted:** this covers a recall at the fight's end
    (`group.mjs` `recall` deletes each body's token) and a Judge's delete.
    Core deletes the attached Region (`TokenDocument._onDeleteOperation`),
    and the hook lifts the records.
  - Every record the carrier writes carries `flags["acks-extras"].managed:
    true`. A recall then drops it from the member it folds back
    (`group-logic.mjs` `isDerivedEffect`) instead of storing it on the stack.
- **Snapshots (E3 at its action, E2 at detonation) also take core's
  containment**, never a module-side scan.
  - First choice, plausible and to verify in the slice: test each token with
    core's own `TokenDocument#testInsideRegion` against an unsaved Region of
    the same emanation on the scene. That needs no database write.
  - If an unsaved Region does not compute its shapes, create the Region,
    read `region.tokens`, and delete it after the card posts. Core's
    containment holds either way.
- **T10 shares the driver.**
  - Its row is always on, and its Region is created when its body becomes a
    combatant: the primary GM's `createCombatant`, which also covers
    `group-combat.mjs` sending bodies out. The Region dies with the token or
    when the combatant is removed.
  - Its shape is the body's footprint grown by the engagement reach. That
    reach is OPEN, not structural (Addendum, A5). Its visibility is
    `GAMEMASTER` unless question 2 says otherwise.
  - "Begins its initiative engaged" is lib's turn start with
    `behaviorsUnder`. "Becomes engaged during its initiative" is
    `tokenEnter` / `tokenMoveIn` while the subject is the combat's current
    combatant.
  - **The cost, stated:** one attached Region per deployed body of a T10
    unit in a fight. Each body's move then carries a Region update inside the
    same token operation (core batches `_regionUpdates`). The cost is not
    measured, and S8's walk measures it.
### Version floor and relaunch

- **Version floor.** The manifest says Foundry minimum 14, verified 14.364
  (`CLAUDE.md`, Conventions). Only build 14.370 was read. Whether 14.364 and
  earlier 14 builds have `attachment.token` and the `emanation` shape is not
  checked.
  - S8 starts by reading `RegionDocument.schema.fields.attachment` and the
    shape types on the test world's build.
  - Where either is absent, raising an item refuses, with a whispered line to
    the Judge naming the missing core feature. The module then neither
    computes a moving area itself nor writes a Region that stands still while
    its bearer walks.
  - Raising the manifest minimum is a release question, not S8's.
- **Relaunch.** `aura` is a new `documentTypes.RegionBehavior` entry. The
  server reads it at world launch (`.claude/rules/live-testing.md`,
  "Sub-types need a world relaunch"). Until the world relaunches, creating
  the behaviour silently fails.
  - Check with `game.documentTypes.RegionBehavior.includes("acks-extras.aura")`.
    The prefixed id is inferred from how core names module sub-types.
  - A relaunch drops every seat, a peer's included. S8's walk finds out who
    is seated first and asks where a seat is not its own (`live-testing.md`,
    "Concurrency").
### How a player sees it: canvas 4 question 2 is the owner's

What core does, read in client `canvas/placeables/region.mjs` `isVisible`:

- `ALWAYS` shows a Region to every seat, with no vision test. A ring
  around a bearer that a seat cannot see is still drawn.
- `GAMEMASTER` shows it to GMs only.
- A hidden Region is GM-only, and an attached Region's `hidden` follows its
  token's. A hidden bearer therefore hides its ring under every answer.
- Core draws no name on a Region, only measurement labels when
  `displayMeasurements` is set.

| Answer | What it needs | A design? |
|---|---|---|
| (a) The Judge's choice for each item | A row field (`showReach`, boolean) set by the Judge, which sets the Region's `visibility` (`ALWAYS` or `GAMEMASTER`) at the raise. A new control in the effect-row editor's gear fields, and the ring's look (colour, border) on the canvas. | Yes: a new editor control and a canvas element |
| (b) Always the ring and the source's name | Every reach is `ALWAYS`. The name is not core's, so the module draws it: a label on the ring, or the item's name in a `data-tooltip-text` on hover of the ring (`ui-tooltips.md`). T10 would show a ring around every engaged body. Whether a ring should hide when the seat cannot see its bearer is a further question for this answer, since core's `ALWAYS` does not hide it. | Yes: a canvas label or hover, and the ring's look |
| (c) Never | Every reach is `GAMEMASTER`. A player learns of a reach only from its prompt card and from the condition on the palette. | Only the Judge's view of the ring and the cards, already on canvas 4 |

Whatever the answer, the reader, the filter and the teardown are the same
code. Only the Region's `visibility` and the label differ. S8 is held for the
owner's answers on canvas 4 regardless (plan section 3); the answer moves
one field and one label, not the design of the reader.
### Rejected

- **Extending a module reader into a scan**, with lib keeping its own
  membership by `tokenGapFeet` over the scene's tokens and refreshing it on
  `updateToken` and turn edges (the brief's search list: `tokenGapFeet`,
  formation's reach, the cast's range).
  - It contradicts the in-force lib entry of 2026-11-16 point for point: the
    module would compute membership, enter/exit, and following the bearer,
    all of which core keeps.
  - It would still need a Region to show any ring (question 2 a and b), so the
    area would exist twice.
  - `tokenGapFeet` stays what it is: the distance between two tokens for a
    verdict about a pair (a cast's range, a roll's band).
- **The cast engine's area** (`cast-area.mjs` `areaExtent`, `cast-range.mjs`)
  judges targets a seat already picked. It never collects who is inside, and
  it has no notion of a reach that persists. Nothing in it is a reader.
- **Light gates and `token-sync.mjs`.** They write light onto tokens and
  read no membership.
- **Core's `tokenTurnStart` event.** Not seen to fire under `AcksCombat`
  (above). One turn source, lib's.
- **A subject-side pairwise check for T10**, with no Region per body. It is
  cheaper (no Region writes), but it is the module computing who is engaged
  with whom, which is membership the in-force entry gives to core. It would
  also make T10 the one reach with a second driver and a second walk recipe.
  If S8's walk measures the per-body cost as too high, this is the fallback,
  and taking it is a new lib DECISIONS entry naming the measurement.

### The strongest counter-argument

**Strength: medium.** Every live reach becomes a scene document that the
GM's client must create, move and delete. A T10 unit in a fight is one
Region per body. Each body's move carries a Region update, and a relaunch
is needed for the sub-type. A pure scan writes nothing to the scene and
needs no relaunch.

It is medium, not strong, for three reasons:

- core batches the attached Region's update into the token's own operation;
- the scan would still need a Region for any visible ring;
- the in-force ruling was made exactly to stop a module copy of Region
  behaviour.

It would become strong if the walk shows a fight of a full T10 unit lagging.
That is the measurement the fallback above names.

### Consequences

- **Of the choice:**
  - Membership, the moving shape, hidden-follows-token, delete-with-token and
    every visibility answer come from core.
  - The module writes one behaviour sub-type and a filter.
  - Player visibility is one enum.
  - It costs a world relaunch at S8, a version check, and one Region per T10
    body in a fight.
  - The teardown has one path (Region deleted), so lowering, death, recall
    and delete cannot disagree.
- **Of the alternative (a lib scan):**
  - No relaunch and no scene writes.
  - A second membership model beside core's, enter/exit diffing to write and
    test, and the bearer's move to track by hand.
  - A ring drawn by the module or a second Region for question 2.
  - It would reverse a ruling eight days old in its own subject with no new
    evidence. The docs doctrine's seven-day test is passed by age alone,
    which is not a reason.

## Point 2: the item carrier

### The choice

**Build the carrier beside the cast engine, in lib. It takes every
row-level piece the cast engine already moved into lib, and nothing from
`scripts/magic/`. Its door is a new lib seam on the system's `Item#use`.**

What already sits in lib and is reused unchanged:

- **The row schema.** `lib/fields.mjs` `effectField` already holds the cast's
  fields (`saveEffect`, `lasts`, `rounds`, `recur`, `recurSave`).
- **The editor.** `lib/apps/effect-row-editor.mjs`, over a store, "so a
  spell, an ability or any later carrier edits rows through one editor".
- **Saves and amounts.** `saves.mjs` `saveSpec`, and `hp-logic.mjs`
  `amountAfter` for the save fraction and the stages.
- **Damage.** The `defenses.mjs` stages, with S6b's per-die
  `damageReduction`.
- **Clocks and ends.** `turn-life.mjs` and `ends-on.mjs`, with the
  `POST_ATTACK_HOOK` that lifts `endsOn: attack`.
- **Parts and immunities.** `roll-mods.mjs`: a record's `rollMods` parts on
  the attack, damage and AC sides, and `recordImmunity`, which reads
  `{on: "immune"}` parts.
- **Conditions.** `held-condition.mjs` for a standing part,
  `status-effects.mjs` for the loss paths, and `delayed-damage.mjs` as the
  pattern for a turn-counted record that acts when it comes due.
- **Cards and relay.** `roll-card.mjs` ("ONE chat card for a roll several
  people made at once") and `sockets.mjs` `executeAsGM` / `executeAsUser`.
- **Throws.** `throws.mjs` for a throw's natural die.

Why not extend the cast engine:

- `castSpellClaims` takes only a flagged spell on an owned actor. Its
  module header says "A monster's attack item is no spell and stays the
  system's".
- The seam it claims on wraps `Item#_useSpell`, which the system's `use()`
  reaches only for `spell` items. For `item`, `armor` and `money` it calls
  `showChatCard()` (core `documents/item.mjs` `use`, 14.2.0).
- What remains in magic is bound to a spell's identity:
  - the `castId`, the cast card and its `castCard` flag;
  - the `spellEffect` mark;
  - the caster's record that a recurring row stands on;
  - the dialog's tradition, caster level, reversal and picks;
  - targets taken from the seat's own `game.user.targets`;
  - `checkApplyRequest` holding a press to the spell's own formula.
- A reach collects its subjects from core's Region, not from a seat's
  targets. It persists while raised, not for a duration. It pulses on
  events, not at `recurAt` moments for bearers fixed at the cast. It ends on
  lowering or on the bearer's death.
- Routing an item through `castSpellRun` would mean an item posing as a
  spell, or a branch for items in every magic file. Either way magic would
  own gear behaviour that monsters, equipment and characters use.
### The carrier's shape

**Rows.** A reach is a field group on the shared row,
`effectField.reach = {radius, filter, pulse}`, so any row list can carry one.

- `radius` is a figure reference.
- `filter` is point 1's `{kinds, exceptKinds, side, unit}`.
- `pulse` is one of:
  - `action`: once, at the press (E3);
  - `turnStart+moveIn`: E4 and T10;
  - `standing`: while inside (E9);
  - `burst`: at detonation (E2).

Each item kind has one row list. No item holds two.

- A gear item (system type `item`) gains
  `flags["acks-extras"].itemRun = {activation, rows}`, with `rows` an
  `effectsField()`. This is a flag on the system's own document, the extend
  rule in `CLAUDE.md`.
- An ability (T10) keeps its rows where they are, in the ability's
  `extras.effects` (`abilities/ability-extras.mjs`). An always-on reach is a
  row there, and the ability takes no activation.
- `itemRunRowsOf(item)` reads the one list the item's kind has, as magic's
  `rowsOf` reads a spell's.

**Activation** (`itemRun.activation`, the item's, not a row's):

- `kind` is one of:
  - `once`: E3;
  - `toggle`: E4 raised or lowered, E9 played or stopped;
  - `fuse`: E2;
  - `consume`: the S9b items, the other architect's.
- `state` is `{active, activationId, regionId}` while a toggle is up.
- Optional fields for a fuse: `throw` (the imported target), `fumble`, and
  `fuseDice` (figure references).
- `uses` is a figure reference for a counted item. The count itself is the
  system's own item quantity.

**Records.** Every record the carrier writes is an Active Effect with
`flags["acks-extras"].itemRun = {source: <item uuid>, activationId,
rowKey}` and `managed: true`.

- A **standing part** (E9) is a `rollMods` record held by
  `held-condition.mjs`'s rules: one per subject per item kind, written only
  when state differs.
- An **action part** (E3) is a `rollMods` damage part with `endsOn:
  ["attack"]`.
- A **condition** is the catalogue key the row names. Which key a printed
  word means is point 3(a)'s ruling (the other architect), and is not
  decided here. Its life:
  - E4: lib `turnLife` `{edge: "start", count: 1}`, which is the start of
    the subject's next initiative, plus the activation id, so the point 1
    teardown lifts it when the Region goes.
  - T10: a clock duration from the imported duration figure.
- An **immunity window** is a record with
  `rollMods: [{on: "immune", spells: [<the item's or trait's register key>]}]`
  and a clock duration from the imported `immunityTurns`.
  - `recordImmunity(subject, {spell: {id: key}})` is the test before a
    prompt.
  - The key is the item kind's, never the bearer's, so a pass covers every
    such item on the field, as the page's structure requires for E4.
- A **fuse** is a record on the bearer with lib `turnLife`
  `{edge: "end", count: <rolled fuseDice>}` and
  `flags["acks-extras"].fuse = {source, activationId}`. It is stepped by
  `turnLifeStep` on lib's turn hooks, beside `delayedDamageStep`, which is
  the pattern.
  - At its lift, the burst is a point 1 snapshot centred on the bearer's
    token.
  - A fuse on an unlinked body lives in its token's delta and dies with the
    token. A token deleted while a fuse burns (a recall, a Judge's delete)
    posts a Judge line naming the fuse and its count, and nothing bursts
    automatically.
  - The damage is rolled once. Each subject's save gives the imported
    fraction through `amountAfter`. Damage applies through lib's damage path:
    `defenses.mjs` `defenseStage`, `hp-logic.mjs` `amountAfter`, `hp.mjs`
    `adjustHp`.
  - Damage to a structure's own hit points is a card line with the page
    reference, handed off and not written. The plan's row 40 says the same.
  - The item is consumed (quantity down, deleted at zero) at the burst.
- **Light.** The throw is rolled by the carrier against the imported
  target.
  - A natural result at the imported `fumble` figure bursts at once.
  - A miss writes nothing.
  - A hit writes the fuse.
  - `throws.mjs` reads the natural die. Whose proficiency the throw rides on
    (the bearer's proficiency item through abilities' `rollFormula`, or a
    bare throw at the target) is checked in S9a against what the proficiency
    item carries. That is not decided here.
- **E9's morale part and its narrowed save part** go through `roll-mods.mjs`
  `recordParts` ("the one reader of a record's parts for any other roll")
  and `saveModParts` for `saveSpec`. Whether the morale provider
  (`patches/morale-roll.mjs`) reads `recordParts` today is not checked. S8
  checks it, and where it does not, adds the read to the morale provider's
  own owner (lib), not a second wrapper.
### The doors, and one owner per wrapped core method

Every door that ends in `item.use()`:

- the system's own sheets;
- the system's hotbar macro (`macros.mjs`: `void item.use()`, 14.2.0);
- the monster sheet's `atk` and `abl` rolls (`monster-sheet.mjs`);
- the character sheet's spell cast (`sheet.mjs` `#onSpellCast`).

The doors that call `showChatCard()` directly post the item's card:
`monster-sheet.mjs` `post`, character `sheet.mjs` `#onItemShow`, and
`follower-card-sheet.mjs`. Showing an item is not using it, so they stay
show-only and the carrier does not claim them.

The character sheet's inventory and the module's monster and group sheets
have no use control for a gear item today. Each needs a visible control for
the press and for a toggle's state (raised or lowered). That is a UI element,
in the closing section.

| Core method | Owner | This ruling |
|---|---|---|
| `Item#use` (system `documents/item.mjs`) | **lib, new: `scripts/lib/patches/item-use.mjs`** | A claimant registry shaped like `spell-use.mjs`. The carrier's claimant takes an item whose `itemRun.activation` is set, before any other branch, and declines everything else: every spell (so `_useSpell` and its claimants are reached as before), every ability with no activation (so abilities' `rollFormula` path is unchanged), and every unflagged item. Nobody wraps `use` today (grep of `scripts/`). |
| `Item#_useSpell` | lib `patches/spell-use.mjs` | Untouched. Magic stays its claimant. |
| `Item#rollFormula` | abilities `roll-wrap.mjs` | Untouched. |
| `makeAttackThrow`, and the actor model's and weapon's modifier and mode methods | lib `patches/attack-throw.mjs` | No new wrapper. E3 and E9 attack, damage and AC parts reach the throw through `roll-mods.mjs`'s existing contributor. |
| Actor `rollSave`, `_calculateMovement` | lib `status-effects.mjs` (`wrapActorMethod`) | No new wrapper. The carrier's conditions reach saves and movement through the catalogue. |
| The morale roll | lib `patches/morale-roll.mjs` | No new wrapper (E9, above). |

The carrier wraps one new method, `Item#use`, and its owner is lib.
### Figures and the Judge's tools (the value rule)

**A row's figure is a reference into the registry, resolved live at the
moment of use.** The reference is `{doc: "monsters", table, row: <key>,
figure: <key>}` over the imported `beastmanEquipment` and trait rules, whose
keys the importer already reads: `radius`, `saveKind`, `saveFraction`,
`immunityTurns`, `fuseDice`, `fumble`, `throw`, `durationTurns`, and the
others.

- **Precedent:** equipment's `resolveArmourGate` (`docs/equipment/MODEL.md`,
  "Armour limits on abilities"): "a row naming no rung resolves its figures
  LIVE from the table, so a Ruledata Browser override or a revert reaches
  every stamped ability with no re-stamp and no figure sits on an item".
- A Judge's own item states its own figure in the row instead.
- The tooltip on each figure is `lib/tables.mjs` `citeOf` (the row and its
  page), per `ui-tooltips.md`.
- **`extras.organisation.gear[].figures` is not read by the carrier.** It is
  the generation record: what was pinned or rolled, with its page, for the
  sheet's prose and tooltips. A snapshot would miss a later override in the
  Ruledata Browser.
- **Nothing imported means a blank figure.** Pressing the item then blocks a
  Player and warns a Judge, which is the owner's ruling of 2026-11-14. The
  card shows the field blank with its page reference and no stand-in number
  (`ip-doctrine.md`; the owner's ruling of 2026-11-14, "Missing imports stay
  blank").

The Judge's tools:

- **Imported figures:** the Ruledata Browser's override layer. It exists and
  needs no new UI.
- **The structure of a row** (which condition, the filter, the pulse, the
  activation kind): the effect-row editor.
  - Gear items get a new store over `itemRun.rows`, with domain `gear`, whose
    pickers offer the kinds the carrier runs (modifier, condition, damage,
    heal).
  - The `reach` field group appears in the `gear` and `ability` domains.
  - A new domain's pickers, the reach group, and the place on a gear item's
    sheet that opens the editor are **UI changes and need a design**.
  - Canvas 4 draws "an item raised or thrown, its cards, a body in reach".
    It does not draw this editor host. That is a gap for the orchestrator to
    take to the owner with the canvas 4 answers.

### Cards and relay, without presupposing canvas 4 questions 1 and 3

- The prompt is one `roll-card.mjs` card per pulse moment. It has a row per
  admitted subject, an undetermined row for each null subject (Judge's tick),
  and a Roll action per row.
- A press rolls `saveSpec` on the presser's seat. `sockets.mjs` `executeAsGM`
  carries it to the primary GM, whose client checks the figure against the
  item's own row (resolved live, as above) before writing.
- This is the cast engine's discipline, rebuilt over lib's transport, and
  nothing is imported from `cast-recur.mjs`.
- **Question 3:**
  - Answer (a), a whispered card with the player's own Roll that the Judge
    can roll for an absent player, is this relay with the card whispered to
    `judgesAndOwners` of each subject.
  - Answer (b), the Judge rolls all of them, is the same card with a Judge's
    roll-all footer button and no player rows.
  - The relay serves both. The card's face is the owner's answer.
- **Question 1** (a bearer still inside a stack) changes only the door's
  first step: refuse until the body is deployed, or deploy it through lib
  `group.mjs` and then press. The carrier needs a token for its Region in
  both answers.
### Rejected

- **A second claimant that feeds an item to `castSpellRun`.** That run
  carries:
  - a spell's spend and pools;
  - its tradition step;
  - its caster level and invocation ladders;
  - a dialog built for reversal and picks;
  - targets from `game.user.targets`;
  - range verdicts from a spell's `range`;
  - records keyed to a `castId`.

  An item would pose as a spell, and magic would grow item branches.
- **Lifting the cast's prompt, relay and apply out of `scripts/magic/` into
  lib now, so both use one.** This is the cleanest end state. It is also a
  refactor of a shipped and walked surface (the cast card, recurring prompts
  and Undo) inside a beastman slice, with its own walk. Nothing S8 or S9a
  needs requires magic's spell-bound half.
  - Recorded as a ROADMAP row for `docs/lib/ROADMAP.md`: "the cast engine's
    recurring prompt may move onto the carrier's lib card".
  - This ruling does not schedule it.
- **The module's own buttons with no seam.** These would miss the hotbar
  macro and the system's sheets, which end in `item.use()` and would post
  the bare item card for an item that should act.
- **Reading figures from the generation record.** Rejected above: a later
  override would not reach the item.

### The strongest counter-argument

**Strength: strong on cost, not decisive.** The cast engine already has a
walked per-target save prompt, a GM relay that holds a press to its source's
own figures, Undo through `recordIds`, and timed records. Building beside it
writes a second prompt, relay and apply loop. Two card styles could drift
apart in front of the same players, and a fix to one would not reach the
other.

It does not decide the matter, for three reasons:

- every part of that loop that is not spell-bound (row schema, editor, saves,
  amounts, defences, clocks, ends, immunity, card, transport) is already
  lib's and is shared;
- the carrier's card is built on lib's one roll card, so the drift is
  bounded to the cast card itself;
- the ROADMAP row names the merge.

Undo is the real gap. **Proposed, not in the plan:** the carrier's card
carries Undo for what it wrote, by the ids of its own records, as the cast's
`recordIds` do. Precedents are the cast card's Undo and lib's hit-point
window (`apps/hp-app.mjs`, Undo while the window is open).

### Consequences

- **Of the choice:**
  - Gear, abilities and later carriers (scrolls, wands, the ammunition of
    S9b) run rows through one lib carrier, over one new seam (`Item#use`,
    owner lib).
  - Magic is untouched, and its walks stay valid.
  - The value rule holds by live registry references.
  - It costs a second card and relay over lib's transport, Undo built anew,
    and an editor domain plus host that need a design.
- **Of the alternative (extend the cast engine):**
  - One prompt loop and one Undo.
  - Magic owns gear behaviour.
  - Every item path runs through spell-shaped code.
  - A change to the cast engine re-walks gear, and a change for gear risks
    spells.
  - The brief's own note stands against it: `cast-spell.mjs` "claims flagged
    spells and leaves a monster's item to the system", and its claim and
    its seam both stop at `_useSpell`.

## What S8 and S9a consist of on this ruling

Both are on `topic/beastman-gear`, and both are `implementer`, since the
design is ruled here. S9a builds on S8's lib pieces. The plan's row gives S9a
"Needs: S7" alone, and that is no longer enough on this ruling.

**Proposed, for the orchestrator to accept or not:** split S8 into
S8a, the dependency half with no surface a user sees, and S8b, the surface.
S8a could then be built while canvas 4 waits. The design rule does not hold
a change no user can see (`ui-layout.md`, "Design before build"). Whether
the plan's hold on S8 covers such a half is the owner's or the
orchestrator's call, not this ruling's.

### S8a: the dependency half (no UI)

- New in lib:
  - `scripts/lib/aura-reach-logic.mjs` and `scripts/lib/aura-reach.mjs`:
    point 1's reader, filter, `aura` behaviour sub-type, raise and lower,
    events, turn listener, and the `deleteRegion` teardown.
  - `scripts/lib/item-run-logic.mjs` and `scripts/lib/item-run.mjs`: the
    activation kinds `once`, `toggle` and `fuse`, the records, the card model
    over `roll-card.mjs`, the relay over `sockets.mjs`, and Undo by the
    carrier's own record ids.
  - `scripts/lib/patches/item-use.mjs`: the seam, installed from
    `scripts/lib/module.mjs`, with the carrier on the lib api.
- Changed in lib:
  - `scripts/lib/fields.mjs`: the `effectField.reach` group.
  - `scripts/lib/vocab.mjs`: the pulse and activation vocabularies.
  - `scripts/lib/actor-read.mjs`: `creatureKinds` reads `subtype`, and takes
    a character's race category through a registration that the classes
    feature fills.
- `module.json`: `documentTypes.RegionBehavior.aura`. This forces a world
  relaunch before any walk.
- Suites: `tools/test-aura-reach.mjs`, `tools/test-item-run.mjs` and
  `tools/test-item-use.mjs`, on invented figures, mutation-checked.
- Docs:
  - `docs/lib/MODEL.md` and `docs/lib/API.md` sections;
  - a `docs/lib/DECISIONS.md` entry carrying this ruling's substance;
  - `scripts/lib/README.md` rows;
  - the ROADMAP row named in point 2;
  - a ledger finding for influence's second kind reader;
  - a `changelog.d` fragment.
- What a walk observes: nothing a user sees yet. The live check is the
  relaunch, `ready` clean, the version check's answer on the world's build,
  and an `aura` Region created by API on a fixture token that moves with it
  and is deleted with it.

### S8b: the surface (E3, E4, E9, T10), marker `lib/aura-bearer`

- **Importer.**
  - Gear items (system type `item`) are minted from the imported equipment
    rows, with `itemRun.activation` and `itemRun.rows` holding registry
    references. No figure sits on an item.
  - T10's ability row gains a `reach` in `extras.effects`.
  - The printed qualifier of each filter is folded onto kind keys.
  - The condition keys follow point 3(a)'s ruling.
- **Generation.** `scripts/monsters/organisation.mjs`
  `applyGeneratedOrganisation` copies the minted item onto a creature whose
  gear axis chose it, and T10's ability onto a creature whose trait axis
  chose it.
  - The gear axis is the optional advanced rule. A basic entry has no gear
    pin and gains nothing, which is section 4 answer 2.
  - The `under` filter is whole only after S10 and S11 write who leads what
    and the parent pointer. Before that it answers for the bearer's own
    group and leaves the rest to the Judge.
- Each item, through the carrier:
  - **E3:** `once`, then a snapshot reach, then an action part with
    `endsOn: attack`.
  - **E4:** `toggle`, then an attached reach with `turnStart+moveIn`, then
    the immunity test, then a prompt. A pass writes an immunity window. A
    fail writes a condition, which lifts at the subject's next start or at
    the teardown.
  - **E9:** `toggle`, then an attached reach with `standing`, then one held
    part per subject.
  - **T10:** always on, a combat-time Region per body at the engagement
    reach (open, Addendum A5),
    `turnStart+moveIn`, the immunity test, and a prompt that writes a
    condition on a clock.
- Docs: `docs/lib/TESTING.md` recipe, `docs/guides/` steps, and the gallery
  row.

**UI elements S8b adds. Each needs the owner's approved design first:**

1. The press control and the raised or lowered state on the monster sheet,
   the character sheet's inventory and the group sheet's stack row (canvas
   4, "an item raised"; question 1 decides the stack row).
2. The ring on the canvas and who sees it (canvas 4, "a body in reach";
   question 2). Under answer (b), a name label or hover on the ring as well.
3. The prompt card and the Judge's undetermined ticks (canvas 4, "its
   cards"; question 3).
4. The effect-row editor's `gear` domain, the `reach` field group in the
   `gear` and `ability` domains, and the host on a gear item's sheet that
   opens it. **Not on canvas 4: a gap to put before the owner.**

### S9a: E2

- Files:
  - `scripts/lib/item-run-logic.mjs` and `item-run.mjs` gain the `fuse` path:
    the light throw (`throws.mjs`, the imported target and `fumble`), the
    fuse record stepped like `delayedDamageStep`, and the burst.
  - The burst is a point 1 snapshot, a single damage roll, a save fraction
    per subject through `amountAfter`, application through lib's damage path
    and `defenses`, consumption, and a structural hand-off line on the card.
  - The importer mints one item per row of the imported `sizes` options. The
    generation copies the breed's row onto an R3 body whose gear axis chose
    it.
  - Suite: `tools/test-item-run-fuse.mjs`.
  - Docs: the recipe's E2 walk.
- **UI elements, each needing the approved design:**
  1. The light press.
  2. The fuse's visible state on the bearer while it burns.
  3. The blast card with each subject's save and amount (canvas 4, "an item
     … thrown, its cards").
- What a walk observes:
  - a light that misses writes nothing;
  - a natural fumble bursts at once;
  - a hit burns for the rolled count of the bearer's turns and then bursts;
  - each subject's damage is reduced on a save by the imported fraction, and
    the card names the fraction's page;
  - the item is gone afterwards.

## Not checked

- Nothing here was walked live. Every core 14 claim was read in the installed
  build 14.370, and 14.364 was not read.
- Whether an unsaved Region computes containment.
- Whether the morale provider reads `recordParts`.
- How a proficiency item carries the light throw.
- The per-body Region cost of T10 in a full fight.
- The exact prefixed sub-type id core gives `aura`.

## Addendum: checks made after the first draft

### A1. Rulings that look as if they bind, and why they do not

**Formation DECISIONS, "2026-11-18 — An obstacle is a natural trap on a
place; the region behaviour type is dropped".**

- It rejected a behaviour type for an obstacle. The owner refused the
  Judge-authored "switchboard": a kind and its setup fields on the Region,
  seeding marks, drift warnings.
- It also kept the rejection of core's token-enter events as formation's
  entry trigger. Those events "split every move at a region's edge and fire
  when a behaviour is enabled under a party already standing there".
- It rules on a Judge's authoring of terrain, in formation, and does not bind
  here:
  - The `aura` behaviour is config the item runner writes. No Judge authors
    it, and it has no setup fields.
  - The two event properties are what a reach needs, provided each pulse
    reads the right event (A2). The split at the edge is "moves within". The
    enter on activation is filtered by kind.

**Formation DECISIONS, "2026-11-18 — Traps live on the place, not on the
Region".** Traps go on places because imported rooms have no Region. A
bearer always has a token, so the reason does not carry over.

**Lib DECISIONS 2026-11-16, its "Kept" paragraph.** Formation polls
`updateToken` because core's movement events carry none of the module's own
update options, and because the clock must advance before a trap is checked.
A reach reads no module update option and has no clock to advance first.
Neither reason applies here.

Nothing is superseded, so the seven-day evidence rule does not arise.

### A2. Which event each pulse listens to (core's own docstrings, read)

Core's docstrings in common `constants.mjs` `REGION_EVENTS`:

- `tokenEnter` fires when the token moves in, when the Region's boundary
  changes so the token is now inside, and when a behaviour becomes active.
- `tokenMoveIn` fires only when the token itself moves in.
- The bearer's sweep is read in `RegionDocument` `#updateTokens`. On a
  boundary change the active GM tests every token of the scene except the
  attached one and writes its `_regions`.

So a subject that walks in gets both events, and listening to both would
prompt twice. Each pulse takes one:

- **`standing` (E9) listens to `tokenEnter` and `tokenExit`.** Membership,
  from any cause, is exactly what a standing part follows.
- **`turnStart+moveIn` (E4) listens to `tokenMoveIn`, plus lib's turn
  start.** Its subject must move. The raise itself (activation) and the
  bearer walking up both fire `tokenEnter` without `tokenMoveIn`, and
  neither prompts: by the page's structure, a creature already inside is
  reached at the start of its initiative.
- **T10 listens to `tokenEnter` while the subject is the combat's current
  combatant, plus lib's turn start.** Either side's move can engage. The
  enter that fires when the Region is created at the combatant's creation
  comes before any turn has begun. S8 checks that guard on the walk.

### A3. A hidden bearer has no reach, as well as no ring

- `regions.mjs` `live` excludes a hidden Region's behaviours.
- Core turns them off and fires `tokenExit` for the tokens inside
  (`RegionDocument` `_onUpdateOperation`, read).
- An attached Region's `hidden` follows its token's.

So a Judge who hides a bearer's token switches its reach off: E9's parts
drop, and E4 and T10 stop pulsing until the token is revealed. This is a
consequence of the choice, and a walk observable for S8. It is also a
question to show the owner beside canvas 4: an ambusher whose token is
hidden from players has an inert reach until it is revealed.

### A4. The `Item#use` seam beside the cast seam

Lib's archived ruling "2026-11-11 — One owner of the cast seam: lib"
(`docs/lib/DECISIONS-through-v11.14.5.md`, row in force in the live file):

- It rejected "each feature offering its own cast button" because the
  system's sheet and the hotbar both end in `_useSpell`.
- `Item#use` is the same situation one step upstream. The new wrapper is a
  different method, so one owner each holds.
- It must decline every spell before it does anything, so `_useSpell` and
  magic's claimant are reached as before. Its suite pins that case.

**Name collision.** "Carrier" is taken in lib: `attachment.mjs`'s carry
model, the attack seam's "attack type on a carrier", `delayed-damage.mjs`.
The new files are therefore `item-run-logic.mjs` and `item-run.mjs`, and its
flag is `flags["acks-extras"].itemRun`, renamed throughout above. "The
carrier" in this file's prose is the brief's word for the concept.

### A5. T10's reach is engagement, and engagement is open

- The rules lookup (RR, the battle-map combat section on engagement, and the
  conditions appendix) says engagement depends on **facing** as well as
  distance, and the distance is a printed figure.
- The module reads facing nowhere.
- Its catalogue `engaged` state (`conditions.mjs`) is set by hand, has no
  writer, and names no partner.
- So "one grid space, structural" was wrong, and is withdrawn above. Three
  ways remain. **This ruling picks none:**
  1. **A Region at an imported engagement distance**, facing ignored, with a
     Judge's warning on each prompt. Whether the importer reads that
     distance is not checked. If it does not, it must, by the value rule.
  2. **Gating on the subject carrying `engaged` plus membership** of a
     bearer's Region at that distance.
  3. **The Judge's tick alone.**
- S8 settles T10 after the import question is answered. It is the one piece
  of S8b that can slip without holding E3, E4 or E9.

### A6. The filter must be able to exclude

- `vsKinds` in `scopeApplies` (`vocab.mjs` `clauseVerdict`) is any-of only.
  Only the alignment clause has an `except` mode.
- A monster's `subtype` is one open string (`monster-extras.mjs`, `subtype`).
- A phrase naming men and demi-humans folds to a type that also admits other
  creatures sharing it. A plain man monster carries the type with no
  qualifier.
- So the reach filter is `{kinds, exceptKinds, side, unit}`. `reachAdmits`
  tests `exceptKinds` itself, and `scopeApplies` is left unchanged for every
  other consumer.
- The table saying which race keys count as men and which as demi-humans
  lives today in influence (`racial.mjs` `HUMAN_RACES`,
  `DEMI_HUMAN_RACES`). The classes feature gives only the race key.
- S8's extension of `creatureKinds` moves that category reading into lib,
  beside the classes race key, and influence's `kindOf` then reads lib's.
  That is the dedup the ledger finding asks for.
- Whether that table's keys are content is for a reviewer under
  `ip-doctrine.md`. This ruling does not decide it.
