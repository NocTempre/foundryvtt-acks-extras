# S7 ruling, half B: points 3 and 4 (S9b, S9c) (architect, read-only)

Read on 2026-11-24 from `main` (`5872c1a7`, with S6a and S6b landed at
`455f2cfa` and the pending `combatOf` fix in `scripts/lib/roll-gate-kinds.mjs`
read as it stands in the working tree). Items, roles and traits are named by
the plan's neutral ids only. The owner's three sentences, restated with an
example each, are in `s7-ruling.md` beside this file and are reused, not
redone; the S9 briefs below quote the words whole.

## Point 3. The consumer slice S6c

What the code holds today, which every reading below starts from:

- `applyGeneratedOrganisation` (`scripts/monsters/organisation.mjs`) writes
  standing figures, records the rest on `extras.organisation`, and mints no
  ability item. `rollGatedModifiers` (`scripts/lib/typed-modifiers.mjs`)
  reads only `ability` items, so nothing S6a or S6b built can reach a
  generated beastman until something mints one.
- The importer's paragraph recipes (`scripts/importer/books/mm/table-recipes.mjs`,
  `BEASTMAN_TROOP_RULES`, `BEASTMAN_TRAIT_RULES`, `BEASTMAN_EQUIPMENT_RULES`)
  read a `condition` text figure only for the condition a row INFLICTS
  (E4, E5, T10). No recipe reads the condition a gate's TARGET must carry:
  R2's lives only in the name of its `vulnerableAttack` key, and T3's is read
  by no spec at all. No spec reads the words R4 and T7 waive.
- The trait row's `condition` figure already flips `gated` in
  `applyGeneratedOrganisation`, so a gate's target word cannot share that key.
- The row keys are minted from the printed labels (`keyByLabel`), so the
  writer can never branch on a row's key: that would put the label in source.
  It branches on the recipe's VALUE keys, which are the module's vocabulary.

### 3(a). Which catalogue condition a printed word means

**Choice.** The word comes from the import, the mapping is a fold made at
generation, and the Judge corrects it in the registry's override layer.

1. **The word is imported.** Every row whose figure is gated on, or
   inflicts, a condition carries that word as a `text` figure read from the
   Judge's copy. Inflicted: the existing `condition` key. Gated on: a new
   key, `targetCondition`, added to the troop and trait recipes (R2, T3).
   Waived: the movement is named by two presence keys, not by a word
   (R4, T7; see the waiver note below).
   The recipe's value key names the ROLE of the word (inflicts, gated on,
   waived); the word itself is never in source.
2. **The fold is made at generation, not at import.** A new
   `matchCondition(word)` beside `matchProficiency` in
   `scripts/monsters/organisation.mjs`. It reuses `matchProficiency` itself,
   with candidates built from lib's catalogue: for each id in
   `CONDITION_IDS`, the id, plus each `/`-separated part of the catalogue
   entry's own `label`. A word that is already a catalogue id answers that
   id first (`CONDITIONS[word]`). Then come an exact fold and the English
   inflection rule `matchProficiency` already applies. An exact fold takes
   the first candidate it meets; two catalogue entries sharing one exact
   fold would be a defect in the catalogue. The inflected branch answers
   null when two entries qualify, and a word no entry answers gets null.
   By eye, against this machine's MM, each word the section prints for
   these rows folds to exactly one id this way, E5's among them through
   `choking`'s own label. The matcher has not been run on them; S6c's
   tests and walk run it. Only the catalogue's own ids and labels are
   compared, and they already ship.
3. **The Judge's correction is the override layer.** The registry's
   `PRIORITY.OVERRIDE` layer (`scripts/lib/tables.mjs`, edited in the
   Ruledata Browser) may replace a row's word with a catalogue id, which
   step 2 answers first. That is the Judge tool, and it needs no new control.
   The fold runs at generation, so a correction reaches the next creature
   generated.
4. **A miss writes nothing.** A word that folds to no id, or to two, puts
   no gated part on the creature. It is recorded as
   `extras.organisation.unresolved[] = {kind, key, figure}`, and the miss is
   passed to `warn`, as `grant()` does for a proficiency miss. The gate is
   never written on a guess.
5. **One lane for the matcher.** It stays in `organisation.mjs` until a
   second feature needs it, and then it moves to lib
   (`docs-doctrine.md`: a fact rises when a second sibling needs it).

**Why.** Each option the brief lists is half of this. An imported field
alone leaves an id nobody resolves. A fold alone has no remedy for the word
a later printing changes. A Judge's pick alone leaves every generated
creature unmapped until a Judge acts, and the owner's first sentence asks for
the section captured mechanically, out of the box. The fold already exists
as `matchProficiency`, used for the same job on proficiencies (T-0713's
path), and the override layer is the registry's existing hand edit. So this
choice is reuse twice and invents only two recipe keys.

**Strongest counter-argument: moderate.** A dropdown of catalogue
conditions beside each row, in the Ruledata Browser or on the template's
troop and trait rows, would be easier for a Judge to find than editing an
override, and it shows the mapping. The rating is moderate because the fold
resolves every row this section prints, so the correction path serves a
later printing or another book. A dropdown is a UI element, and it would
hold S6c for a `/design`.

**Consequences of this choice.** S6c ships with no UI. A Judge sees a
mapping only through the gate's label on the attack card ("against a target
that is {condition}", `roll-gates.mjs` `gateLabel`), which names the
catalogue label. A wrong fold is found by a walk, not shown in advance. The
MM recipe file is a hot shared file (plan section 5), so S6c syncs before it
edits.

**Consequences of the alternative (a Judge's pick only).** Nothing gated
works until a Judge maps each row. The owner's sentence 1 is unmet on a
fresh import. Every world repeats the same picks by hand.

### 3(b). How sides are counted for outnumbering

S6a already chose a reading and it is landed and walked: `outnumberingHolds`
(`scripts/lib/roll-gate-kinds.mjs`) counts the undefeated combatants of the
attacker's own combat (`combatOf`, with today's fix for a combat the
tracker does not view), split by `areEnemies`. A neutral or secret attacker,
a token in no combat, and a gate with no ratio are all undecided.

**Choice.** Confirm it, with two amendments to that landed file.

1. **A combatant counts the bodies it stands for.** Each undefeated
   combatant adds `bodyCount(combatant.actor)` (`scripts/lib/group-logic.mjs`,
   "the one place that answers how many people is this row") instead of 1.
   `group-combat.mjs` already deploys a group's bodies as combatants of
   their own, so this changes nothing in the usual case. It corrects the
   cases where a group's own combatant stays in the fight: a party's group,
   which is left to the party, and a deploy only the primary GM may make.
   Not blocking; it goes in S6c's first commit.
2. **A clause that prints no ratio means strictly more.** T2's morale
   clause prints no ratio. Today the gate answers null without one, and a
   ratio of 1 under `>=` would admit parity. The gate gains `strict: true`:
   with no ratio, the comparison is opposing `>` own (or own `>` opposing).
   A gate with neither a ratio nor `strict` stays undecided, because that is
   a ratio the import failed to read. The writer sets `strict` only from a
   recipe key whose name says its clause has no ratio (3(c)), never on a
   miss. That "outnumber" means more than is the procedure, so it ships.

**Why.** "Allies" and "opponents" are the sides of a fight, and the tracker
holds exactly the fight. A radius would need a figure the page does not
print, so it is a house rule ("No house rules ship", owner 2026-11-11). A
group's bodies would count a warband's absent members and leave out allies
of other kinds. Disposition is the side reading the gates and the surprise
part already share (`areEnemies`).

**Strongest counter-argument: moderate.** In a large melee spread over a
battle map, the two sides as a whole can be even while one knot of
fighters is three to one, and the table may read the rule locally. The
rating is moderate because the tracker reading is the only one the page
supports without an invented figure. A local reading needs a radius, which
the value rule forbids inventing and the page does not print.

**Consequences of this choice.** The gate is decided only inside a combat,
and outside one the part is not added. Tokens whose disposition is set
wrong count on the wrong side, and the fix is the token's disposition.
Summoned creatures and mounts count once each they are in the tracker.

**Consequences of the alternative (a radius, or a group's bodies).** A
radius ships an invented figure and needs a Judge setting nobody can source
from the page. A group's bodies outside a fight counts warriors who are not
there, and needs S10's group schema, which belongs to the other topic.

### 3(c). Where R2's damage-dice multiplier and T2's morale part go

Four code facts decide this:

- `rollGateContributor` (`scripts/lib/roll-gates.mjs`) answers only `attack`.
  A roll-gated `damage` row is already disposed AT_ROLL by
  `modifierDisposition`, but nothing reads it, so T2's damage figure
  "while outnumbering" has no reader either.
- A spec carries one gate (`gateOf`). R2's rows need two at once: the
  target's condition, and melee or the short band of a missile.
- `morale` is a `CONSUMED_TARGETS` entry owned by influence, so
  `modifierDisposition` answers CONSUMED before its roll-gate branch.
  Influence's reader, `getAbilityReactionMods`
  (`scripts/influence/ability-effects.mjs`), never reads `effect.gate`. A
  gated morale row written today would be pre-ticked on every morale page.
  Core's own path, `withMoraleConditions`, reads no ability row at all.
- The attack seam already asks contributors `damageFormula(item, mode,
  formula)`, through `onWeaponDamageFormula` in
  `scripts/lib/patches/attack-throw.mjs`, the one owner of that wrapper. A
  contributor can read the attack in flight with `attackInFlight(item.parent)`,
  as `equipmentContributor.damageModes` already does. S6b's per-die stage
  reads the dice stamped on the card (`damageDiceOf`), so a multiple applied
  by hand never reaches it.

**Choice.**

1. **R2's multiplier rides the existing `damageFormula` seam as a new
   consumed target.**
   - The new target is `damageDice`, a `CONSUMED_TARGETS` entry whose
     consumer is `roll-gates`; its value is the imported multiplier
     (`damageDiceTimes`).
   - `modifierDisposition` answers CONSUMED before its roll-gate branch, so
     `rollGatedModifiers` never returns such a row. `roll-gates.mjs`'
     contributor gains a `damageFormula` answer that reads the rows with
     `consumedRows(actor, "damageDice")` and keeps those whose gate
     `gateVerdict` answers true, as `defenses.mjs` reads `damageReduction`.
   - **The delivery.** `damageFormula(item, mode, formula)` is handed no
     attack type, and the context's `type` is null when the dialog picks
     one. Core 14.2.0's builder (`src/module/throw/attack-throw-builder.mjs`)
     asks `getAttackThrowModifiers(attackType)` before
     `getDamageFormula(damageMode)` in the same build. So the contributor's
     `attack` answer records `ctx.delivery = attackType` on the context in
     flight, and the `damageFormula` answer passes it as the gate context's
     `type`. Without a recorded delivery the gate is undecided, and nothing
     is multiplied.
   - The answer multiplies the count of every dice term in the formula and
     leaves flat terms alone, since the page multiplies the dice. Two such
     rows multiply once, by the largest.
   - It tells the table once per attack which part multiplied the dice, as
     a notice (`ui.notifications.info`, a lang key under `ACKS-LIB`), since
     the system's card shows the formula it rolled and has no place for a
     label.
   - No new wrapper is added; `attack-throw.mjs` stays the one owner of
     `getDamageFormula`.
2. **The dice multiplier qualifies lib DECISIONS-through-v11.14.5, "The
   attack seam rides the system's labelled modifiers" (2026-10-20), and does
   not supersede it.** That entry tells the table about "a scaled damage
   roll", and its case is a factor on the total, which no labelled row can
   carry (`shrunk`'s `damageFactor`, still told by `notice.unplaced`). A
   multiple of the DICE is a formula, and the entry's own list of
   contributor answers includes `damageFormula`. S6c writes a lib DECISIONS
   entry saying so. Its evidence: S6b's per-die stage counts the card's
   dice, so a by-hand multiple applies the reduction to the wrong count.
3. **A conjunction gate, `allOf`.** It is registered at the roll in
   `roll-gate-kinds.mjs`. `gate.of` is a list of gates, each asked through
   `gateVerdict`: any false gives false, all true gives true, and otherwise
   the answer is undecided. Its `gateLabel` joins its children's phrases.
   R2's attack row and its multiplier row each carry
   `allOf[targetCondition, rangeBand]`. The band list is melee plus short,
   which is when the part applies, so it is procedure and ships.
4. **T2's damage half: `roll-gates.mjs`' contributor gains `damage(ctx,
   attackType, rows)`.** It reads `rollGatedModifiers(actor, "damage")`
   exactly as `attack` reads `attackThrow`, with the same label. Its
   `carriers` stays `["attack"]`, since a spell's damage is the spell's own.
5. **T2's morale part goes to the existing morale consumer, influence.**
   `getAbilityReactionMods` reads `effect.gate`. Where a gate is present, it
   asks `gateVerdict(actor, gate, {token: actorToken(actor)})`:
   - true: the row is offered pre-ticked;
   - false: the row is left out;
   - undecided: the row is offered unticked (`situational: true`), the
     page's existing "offered, never asserted" state.
   The gate is `outnumbering` with `side: "against"` and `strict: true`, as
   in 3(b). Core's own path (page off, or the skip key) reads no ability
   morale row today for any creature. That stays as it is and is recorded
   as a known limit in influence MODEL.
6. **Nothing here is recorded only.** Every one of these has a seam, and
   the owner's sentence 1 asks for the section to be captured mechanically.

**Why.** Each piece extends a seam that exists, with its one owner: the
attack seam's `damageFormula` and `damage` answers, the registry of gates,
and influence's morale reader. Nothing new wraps a core method. The dice
multiple is placed where it changes what the system rolls, and so what S6b's
per-die stage and the card's Apply read, which a notice cannot do.

**Strongest counter-argument: moderate, against item 1.** The 2026-10-20
entry wants what the throw cannot label told rather than hidden. A formula
silently doubled reads on the card as a bigger weapon. The rating is
moderate because the notice names the part and its page, and the
alternative (told only) leaves the per-die stage counting the
un-multiplied dice. Against item 5, weak: the morale page is a setting, and
the page-off path loses the part. Every ability morale row has that limit
today; S6c adds no new one.

**Consequences of this choice.** S6c touches lib (`roll-gate-kinds.mjs`,
`roll-gates.mjs`, and `typed-modifiers.mjs` for the `damageDice` entry in
`CONSUMED_TARGETS`), influence (`ability-effects.mjs`) and monsters
(`organisation.mjs`), and it writes a lib DECISIONS entry. An influence
gated row read before S6c lands would be wrong, so S6c lands the reader
before or with the writer, never after.

**Consequences of the alternative (record only, or a notice).** R2's
paragraph is applied by hand at every hit. The per-die stage of E6 (S9c)
then reduces the wrong number of dice whenever the two meet. T2's morale
row could not be written at all, because influence would pre-tick it
unconditionally.

### R4's and T7's waiver, and their free withdrawal

**Choice.**

- **The Armor Class half is S6b's waiver.** R4's ability item carries
  `{type: "modifier", target: "acWaiver", conditions: ["charging",
  "retreating"]}`, and T7's carries `["retreating"]`. Both are ungated,
  because `waivedBy` (`scripts/lib/conditions.mjs`) skips a gated row by
  design. S6b's walk showed that waiving `charging` also leaves out the row
  of the condition it implies. The list never names `disordered`: that would
  waive disorder from every cause, a manoeuvre's or a spell's included.
- **The movement is named by the recipe key, not by a fold (ruled here).**
  The run word cannot fold: `matchProficiency` needs a stem of at least
  `MIN_STEM` characters and an ending from its fixed set, and the run word
  fails both. Loosening the fold for every condition word to reach it is
  rejected. Instead the recipe reads two presence keys, `waivesCharge` and
  `waivesRun`, whose anchors sit in the paragraph's Armor Class clause, and
  the writer maps them structurally, as it maps `vulnerableAttack`:
  `waivesCharge` to `charging`, and `waivesRun` to `retreating`. Retreating
  is the catalogue's one state that moves at running speed (RR ch. 6,
  movement actions), and it carries the disorder through `implies`. This
  reading is the plan's row 34, stated once, in the writer's key map. A
  Judge can replace the ids in the override layer.
- **What stays a recorded note.** A creature that takes the bare run action
  is disordered by hand, through `disordered`, and is not covered, since
  waiving `disordered` is ruled out above. That is a line in the creature's
  notes with the page reference, and it is recorded on
  `extras.organisation`.
- **The free withdrawal is a recorded note.** It is withdrawing or
  retreating without the pre-initiative declaration, for both R4 and T7.
  The module enforces no declaration: `withdrawing` and `retreating` are
  toggled by hand, and lib refuses no undeclared one. So there is nothing to
  waive, and the part is a line in the creature's notes with the page
  reference. Granting the proficiency the rules book attaches to that
  freedom is rejected: the paragraph does not name it, and the proficiency
  grants more than this.

**Strongest counter-argument: moderate.** Mapping the run word to
`retreating` is a reading in code, the very thing 3(a) keeps out by folding.
The rating is moderate because the alternative leaves R4's and T7's main
Armor Class part unapplied on every fresh import until a Judge edits an
override. The reading is stated once, in the writer, and it is reversible
per world.

**Consequences.** On a beastman with R4 or T7, a charge or retreat toggled
on it shows no Armor Class loss, and `acMath` lists the waiver in its `waived`
(whether a hover shows it is unread). A bare run toggled as `disordered` still costs it
Armor Class, and the notes say so. **Of the alternative (record all of
it):** every R4 and T7 creature is played by hand on the most common thing
it does.

### S6c's placement: its own slice

**Choice.** S6c is its own slice, in phase 2, after S6b and before S9c and
S9b. It goes to an `implementer`: a scoped change whose readings this
ruling has made. It adds no UI element.

**What it delivers.**

- **Recipes** (`scripts/importer/books/mm/table-recipes.mjs`):
  - a `targetCondition` text figure on the troop and trait paragraphs
    (R2, T3);
  - a `targetBand` text figure (R2): the band word the paragraph names for
    a missile;
  - two presence keys named by the movement they waive, `waivesCharge` and
    `waivesRun` (R4, T7; see the waiver note). Whatever take the extractor
    offers for a clause that is there or not is used; where none exists,
    `text` captures the word and its presence is what the writer reads;
  - a key for the morale part whose clause prints no ratio, whose name says
    so (for example `outnumberedMorale`), reading the signed figure;
  - the existing `damageDiceTimes`, `vulnerableAttack`, `round`,
    `outnumber` and `opponentSurprise` keys stay as they are.
  Each new spec is checked against the page on this machine's MM, and that
  check is the stop rule's place. Stored shapes, read in the extractor:
  `ratio` is an array `[a, b]` (`prose-rows.mjs`), and `times` and
  `ordinalWord` are numbers. The writer writes `gate.ratio` as `a / b`;
  `Number([a, b])` is NaN, which `outnumberingHolds` would read as no ratio.
- **The writer** (`scripts/monsters/organisation.mjs`):
  - `matchCondition` (3(a)).
  - An `organisationAbility(kind, row, specs)` mints one `ability` item
    payload per chosen troop and per chosen trait, pushed onto
    `resolved.items` the way `grant()` pushes a proficiency. It is named by
    the row's imported label, carries `flags.acks-extras.cookbook.cite` (so
    `roll-gates.mjs` `labelOf` prints the page) and a cookbook id built from
    the row key (so `definitionKey` counts one copy once), and its effect
    specs sit in `flags.acks-extras.extras.effects`.
  - **Who gets one (ruled here).** It follows the rule the standing figures
    already follow (`fights`): a noncombatant, a caster and a dependant
    take no troop ability and no trait ability. Every part these abilities
    carry belongs to a fighting creature.
  - The specs are built from the recipe's VALUE keys only, never from a row
    key:

    | Value key | Spec written |
    |---|---|
    | `opponentSurprise` | S6b's against-side surprise part (`surprise-parts.mjs`' target) |
    | `vulnerableAttack` | `attackThrow` under `allOf[targetCondition, rangeBand]` |
    | `damageDiceTimes` | `damageDice` under `allOf[targetCondition, rangeBand]` |
    | `outnumber` with `attack` and `damage` | `attackThrow` and `damage` under `outnumbering {ratio: a / b}` |
    | the no-ratio morale key | `morale` under `outnumbering {side: "against", strict: true}` |
    | `round` with `attack` | `attackThrow` under `combatRound {round}` |
    | a row's `targetCondition` with `attack` | `attackThrow` under `targetCondition` |
    | `waivesCharge`, `waivesRun` | `acWaiver` with `charging`, `retreating` |

    In R2's two rows, `targetCondition` is the folded `targetCondition`
    word. `rangeBand` is `melee` plus the `targetBand` word where that word
    is one of `RANGE_BANDS`. A band word outside them writes no spec and is
    recorded.

  - A word that does not fold writes no spec and is recorded (3(a), step 4).
  - The prose line for R4 and T7's undeclared withdrawal and for the bare
    run is added through `noteLine`, with the page reference.
  - The standing figures it writes today are unchanged.
- **Lib:**
  - `roll-gate-kinds.mjs`: `allOf`, `strict` and `bodyCount` (3(b), 3(c)).
  - `roll-gates.mjs`: the `damage` and `damageFormula` answers, the
    delivery the `attack` answer records on the context in flight (3(c),
    item 1), plus the
    one-per-attack notice. Each new phrase is a lang key under `ACKS-LIB`.
  - `typed-modifiers.mjs`: `damageDice` as a `CONSUMED_TARGETS` entry
    (consumer `roll-gates`). The contributor reads it with `consumedRows`
    and asks `gateVerdict` itself, as `defenses.mjs` reads
    `damageReduction`, so `modifierDisposition` needs no new mode.
  - `docs/lib/API.md` (typed modifiers, gates) and a lib DECISIONS entry
    qualifying 2026-10-20 (3(c), item 2).
- **Influence:** `ability-effects.mjs` `getAbilityReactionMods` honours
  `effect.gate` (3(c), item 5). An influence MODEL line records the
  core-path limit.
- **Tests:**
  - `tools/test-typed-modifiers.mjs`: `allOf` true, false and undecided;
    `strict` with and without a ratio; `bodyCount` through a mocked group
    combatant.
  - The suite that covers `roll-gates.mjs`, found by grepping `tools/`: the
    `damage` answer adds a labelled row only under a true gate. The
    `damageFormula` answer turns two dice into twice that count and leaves
    a flat term alone. It returns the formula unchanged with no attack in
    flight. Two multiplier rows multiply once. With the delivery the
    `attack` answer recorded, a short-band missile multiplies and a
    long-band one does not; with none recorded, nothing multiplies.
    The writer turns a `ratio` of `[a, b]` into `a / b`, and a troop or
    trait on a noncombatant, caster or dependant mints no ability.
  - `tools/test-organisation*.mjs` on INVENTED rows (no printed figure in a
    fixture): each value key writes its spec. An unfolded word writes
    nothing and is recorded. A row key never decides a spec.
  - Influence's suite: a gated morale row's three verdicts map to pre-ticked,
    absent and offered.
  - Mutation-check the writer's table (the "mutation-check a pinning suite"
    memory).

**Tree.** `topic/beastman-gear`, after `acks-branch sync beastman-gear`.
`organisation.mjs` and the MM recipe file are phase 1's and phase 3's files
too, and the recipe file is hot (plan section 5). S6c is the gear topic's
one slice that writes them, and no phase 3 slice may write them while it is
open. Land it, then walk it on `main`.

**Acceptance (new row for plan section 3, wording for the orchestrator):**
"S6c | 2 | gear | implementer | The gated troop and trait rows written as
ability items: on every breed, R2's surprise part, attack and dice multiple
apply only against a target in the folded condition at melee or short range.
T2's attack and damage apply only while outnumbering at the imported ratio,
and its morale part is offered pre-ticked only while outnumbered. T3 and T4
apply only under their gates. R4 and T7 lose no Armor Class to their waived
conditions. A word that does not fold writes nothing and is listed | no |
S6b".

**Walk (observables).** Lane B, marker `monsters/beastman-organisation` (the
phase 1 recipe), plus a target fixture under a marker of its own, for example
`monsters/beastman-gates-target`:

- An R2 creature attacks a target toggled to the folded condition, in
  melee: the card's throw lists the row with its label and page. The damage
  formula shows the multiplied dice, and the notice names the part. With the
  condition off, neither appears. At long range, neither appears.
- A T2 creature in a combat with the ratio met adds its attack and damage
  rows. Outnumbered, it opens the morale page with the row pre-ticked.
- A T4 creature attacks in its round and in another round.
- An R4 creature toggled to `charging` keeps its Armor Class on the sheet.
- A T3 creature attacks a target carrying the condition its word folds to, and one that does not.

**Why its own slice.** S8 and S9a are held for the owner's canvas answers,
and folding S6c into them would hold mechanics that need no design.
S9b and S9c are about items, and S6c is about troop and trait abilities.
Folding them together would put two agents' worth of reading into one
brief and give two slices one file for the same edits. Its order matters:
S9c's per-die stage meets R2's multiplied dice, and S9b's save-or-condition
uses 3(a)'s fold, so S6c lands first.

**Strongest counter-argument: weak.** One more slice means one more land
and walk. The rating is weak because the walk is phase 1's recipe with one
target fixture added, and the alternative is a slice too wide for one
agent.

## Point 4, in part. S9c and S9b

Both briefs depend on one shared reading, about real items against the kit
question. Section 4, answer 2 makes the inventory optional and leaves it
off for a basic entry. The gear axis is that switch: a creature generated
with no E pinned or rolled is a basic entry and gets nothing below. A
creature with one is using the optional equipment rules, and gets its gear
on generation. Neither slice waits for S13's kits. Each E is written from
its row in `extras.organisation.gear` (`{key, label, cite, figures}`, which
`applyGeneratedOrganisation` already records) by one builder,
`gearPayloads(gear, resolved)` in `scripts/monsters/organisation.mjs`. S13
later replaces that builder's source with a library kit and keeps the shape
it returns. The writer branches on the row's figure keys and its
`figuresFrom`, never on its key, which is minted from the printed label.

What each E is on the creature:

- **E6** is a marking on the body, so it is an ability item and never
  inventory.
- **E7** is a property of the creature's own weapon items, which the
  monster import already mints.
- **E1** is armour. Armour stays a stat cell on a monster (plan 2c), and the
  owner has not ruled whether armour is an inventory item (section 4,
  answer 2, "Not ruled"). So E1's rider rides an ability item named by the
  row. If that ruling later puts armour in the inventory, S14 moves the
  same spec onto the armour item.
- **E5** is a real consumable item.
- **E8** is a flag on a real ammunition stack. A generated archer holds
  that stack only once S13's kit writes it (row 8-9).

### S9c brief (E1, E6, E7), implementer-ready

**Agent.** `implementer` (sonnet): a scoped change whose readings are made
here. **Tree.** `topic/beastman-gear`, after S6c lands, starting with
`acks-branch sync beastman-gear`. **Design.** None: no new control, window
or card (see "UI" below). **Fixes.** Ledger T-0710.

**The owner's words, quoted whole** (plan, "The owner's words" and section 4):

1. "I want the beastmen template fixed with special attention towards
   capturing everything in this document mechanically (plus arranging art
   correctly, etc)."
2. "Fixing the group actor type to handle generating a warband, assigning
   special troop types, equipment packages, spell casters, etc. Seems like
   the right approach. Many of these items generate ranged aura effects or
   require an action to activate. All of that game surface is in scope."
3. "Furthermore, creating kits (including random ones suited to matching
   roles and custom as a group, as a unit type, or as an individual) is
   desired."

Section 4's six answers, the owner's words only:

1. "Breed is default, Table 54 shows leaders who are both better equipped
   and tougher (higher HD)"
2. "Humanoids, including beastmen, should have an (optional, not used for
   basic entries, used for advanced beastmen rules) equipment inventory. A
   kit can ALSO include stat bumps or abilities"
3. "Use the template picture for the template, use the specifics for each
   where available. Use the art splash (pg 56) for the warband generator",
   then "3) no, see previous answer" and "4) yes, template should show a
   unique template image or none at all"
4. "work pause lifted in full"
5. "Unclear, repairs always reset the compendium copies, may offer to fix
   existing entries if a simple fix, must offer keeping a copy/as is for
   modified actors"
6. "Make sure to include the outside references such as to ogres and
   wargs."

Before building, the agent's report restates each of the three sentences
with one example. Answer 2 governs this slice: a creature with no gear stays
stat-only.

**Acceptance (plan section 3, S9c, and section 1 rows 39, 44, 45).** "E1,
E6, E7 (E7 applies the figures read today)". A walk observes: "a wrestle hit
adds the rider" (E1), "the Apply card shows the reduction" (E6), "disarm
parts" (E7).

**Shape, part 1: E7, the hooked weapon (T-0710).**

- `scripts/equipment/profiles.mjs` `classifyWeapon`: the profile gains
  `hooked`. It is true where the weapon carries the module flag
  `flags.acks-extras.hooked` (a new `ITEM_FLAGS` key in
  `scripts/equipment/constants.mjs`), or the tag token `hooked` in core's
  `system.customTags`. That is read as `tagTokens` already reads the thrown
  and handy tags, so a Judge marks any weapon with core's own tag editor and
  no new control.
- Both callers of `maneuverMods` pass `{hooked: profile.hooked}`:
  `attackThrowRows` in `scripts/equipment/attack-mods.mjs` and the
  manoeuvre rows in `scripts/equipment/item-sheet/rolls.mjs`.
  `maneuverMods` already sums the `hookedWeapon` table's reduction and save
  modifier for a disarm, so it is not changed.
- Generation: a gear row whose `figuresFrom` is `MANEUVER_TABLES.hooked`
  sets the flag on the creature's melee weapon items in `resolved.items`.
  Check first that `importedOrganisation()` keeps `figuresFrom` on its
  equipment rows, and carry it if it does not.
- Two limits stay as they are. Each is registered on the ledger as a
  finding, and none is built here:
  - Nothing rolls a manoeuvre's saving throw. `targetSaveMod` is read by no
    path but the Rolls tab's tooltip, so E7's save part reaches the tip
    only.
  - The Rolls tab lists manoeuvres for a character's weapon only
    (`actor?.type === ACTOR_TYPE.character` in `rolls.mjs`). Widening it to
    a monster changes a sheet a user sees, and needs `/design`.

**Shape, part 2: E6, the marking.**

- An ability item from S6c's `organisationAbility` builder carries
  `{type: "modifier", target: "damageReduction", perDie: true, value: <the
  row's reductionPerDie>, gate: {kind: "weaponMundane"}}`. `actorReductions`
  reads it and `reductionStage` stages it (`scripts/lib/defenses.mjs`);
  S6b built both and walked them.
- The Armor Class bump is a standing figure written at generation, as the
  troop's and the trait's are. A monster has no `MODIFIER_PATHS` entry, so
  an ability `ac` row would be refused.
  - `parts.ac` gains a `gear` part beside `troop` and `trait`.
  - `extras.derived.organisation` gains `gear: [{label, cite}]`.
  - `scripts/monsters/statblock.mjs` `derivationTips` `orgText` names the
    gear part with the gear row's label and cite.
- A figure the import left blank writes nothing. The hover then keeps the
  page reference alone (`ui-tooltips.md`).

**Shape, part 3: E1, the rider.**

- An ability item carries `{type: "modifier", target: "maneuverRider",
  maneuvers: ["overrun", "wrestling"], dice: <the row's riderDice>}`.
  `maneuverRider` is a new `CONSUMED_TARGETS` entry in
  `scripts/lib/typed-modifiers.mjs`, with consumer `equipment`. Which two
  manoeuvres is the procedure, so it ships.
- `damageRows` (`scripts/equipment/attack-mods.mjs`) reads it with
  `consumedRows`. On an attack in flight whose manoeuvre is in the spec's
  list, it adds `{label: "<row label> (<cite>)", value: "+<dice>"}`, which
  the seam takes as a signed formula fragment (`attack-throw.mjs`,
  contributors). `damageRows` is handed no manoeuvre today:
  `equipmentContributor.damage` in `scripts/equipment/roll-wrap.mjs` passes
  `(ctx.actor, ctx.weapon, attackType, modifiers)`. So `roll-wrap.mjs` joins
  the change and passes `{maneuver: ctx.maneuver}`, as its `attack` answer
  already does for `attackThrowRows`.
- **The rider follows the `overlayManeuvers` world setting (ruled here).**
  The setting gates every manoeuvre part (`attackThrowRows` checks
  `maneuverOverlayEnabled()`, and the Rolls tab lists no manoeuvre with it
  off). So `damageRows` asks `maneuverOverlayEnabled()` before the rider,
  and with the setting off the rider adds nothing, even on a manoeuvre an
  API call declares.
  E7's hooked part follows the same gate, since it is a `maneuverMods`
  part. The walk turns the setting on, and the report names it.
- The weapon's own damage on those two manoeuvres stays as it is today.
  RR ch. 6 deals damage on an overrun in some outcomes, so suppressing it
  would be wrong, and applying it stays the Judge's call. The rider's dice
  reach `damageDiceOf`, so a per-die reduction counts them.
- Out of S9c, and registered as a plan row for the orchestrator: the
  paragraph's penalty to a human or demi-human who wears E1. It needs
  point 1's kind reader and a character's attack-throw override, and no
  generated beastman ever has it.

**Tests.** Every fixture is invented; no printed figure appears in one.

- The equipment suite that covers `profiles.mjs` and `attack-mods.mjs`
  (grep `tools/` for `maneuverMods`):
  - a flagged weapon and a tagged weapon each give `hooked: true`;
  - a disarm with `hooked` adds the `hooked` part, and one without it does
    not;
  - `attackThrowRows` passes the flag through.
- `tools/test-typed-modifiers.mjs`: `maneuverRider` is CONSUMED.
- The equipment damage-rows test:
  - an overrun with the rider adds the fragment, and adds nothing with
    `overlayManeuvers` off;
  - `equipmentContributor.damage` passes the manoeuvre through;
  - a disarm with the rider adds nothing;
  - no attack in flight adds nothing.
- `tools/test-organisation*.mjs`:
  - an E6 row writes the ability and the `gear` Armor Class part;
  - an E7 row flags the melee weapons and leaves the missile ones alone;
  - an E1 row writes the rider ability;
  - a row with blank figures writes nothing;
  - no gear writes no item (answer 2).
- The statblock suite: the Armor Class tip names the gear part and its
  cite.
- Mutation-check the hooked pass-through: a caller that drops it must turn
  a test red.

**Unit suites that cover it.** The equipment suites over `profiles.mjs`, `roll-wrap.mjs`,
`attack-mods.mjs` and `rolls.mjs`; `test-typed-modifiers`;
`test-organisation-axes`; `test-organisation`; the statblock suite. Run
them in the worktree. The land's gate is the full one (`shared-tree.md`).

**UI.** No new element:

- E6's figure joins the Armor Class hover the Full Monster sheet already
  draws, as one more part of the same shape.
- E7's part joins the Rolls tab's manoeuvre row and its tooltip, which
  already list parts.
- E1's fragment is a row on the system's own card.

Counter-argument, weak: a new line in a hover is a visible change. The
design it rides is the hover's own, so it needs no `/design`
(`ui-layout.md`, "a fix restoring what the approved design already shows").
If any part turns out to need a new control, the implementer stops and
asks.

**IP stop rule.** No printed figure, condition word, option name or proper
name goes into source, `lang/`, a test or a comment. Each figure arrives
from the gear row; the manoeuvre keys and the tag token are the module's
own vocabulary. A printed value found in source while working is a stop
and a report (`ip-doctrine.md`, the `acks-printed-value` skill). Lang
strings name the field and cite the page.

**Walk.** On `main` after the land, lane B, no world shutdown, with the
`overlayManeuvers` world setting on (Settings tab → Game Settings → the
module's settings); a setting a peer relies on is asked about first.

Fixtures:
- `monsters/beastman-organisation`, phase 1's marker, for the generated
  creatures;
- `equipment/hooked-character`, a character holding a melee weapon tagged
  `hooked`;
- `monsters/beastman-gates-target`, S6c's target.

Observables:
- **E7 on a character.** On the weapon's sheet, the Rolls tab's disarm row
  shows the penalty, with the hooked part and its page in the tooltip. Its
  Roll puts that row on the card's throw. The same weapon untagged shows no
  hooked part.
- **E7 on a generated beastman.** Its melee weapons carry the flag. A
  disarm driven through the call the Rolls tab's Roll makes,
  `actor.makeAttackThrow({item, attackType: "melee", acksLib: {maneuver:
  "disarm"}})`, lists the hooked part on the card's throw. The report says
  it was driven through the API, since a monster has no manoeuvre row.
- **E1.** A wrestle driven the same way carries the rider row in the card's
  damage.
- **E6.** A beastman generated with E6 shows the Armor Class bump, with its
  gear part in the hover. A mundane weapon's hit shows the per-die stage on
  the Apply card; a magical weapon's hit shows none.
- **Teardown.** Delete by the uuids the generation returned, through the
  ledger (`api.track`, `api.sweepTracked`).

### S9b brief (E5, E8), implementer-ready, in two halves

**What waits on point 2's item carrier, and what does not.** The test is
whether the effect fires from a roll or press the module already wraps, or
from a gesture nothing wraps yet.

- **E5's swig is a gesture nothing wraps.** "Swig" is in point 2's list of
  activated items, beside raise, crack, play and throw. Its save is asked
  of the drinker, so it needs a prompt with a Save press.
- **E8's hit fires from the attack seam** (`POST_ATTACK_HOOK`, which already
  spends the ammunition). Its save is asked of the struck creature, another
  seat, so it needs the same kind of prompt.
- **The prompt is the carrier's.** In the cast engine it is the recur
  prompt with `magicCastSave`. A card S9b drew for itself would be a second
  save prompt and a new UI element.
- **Bearer death is point 2's too.** E5's "broken when its bearer is slain"
  needs the bearer-death reader point 2 rules for E4. lib has no death hook
  today.
- **The kind test is point 1's.** E5's split between the bearer's kind and
  a human or demi-human needs point 1's kind reader.

So **S9b-1** (data, records, pure outcomes, no UI) is built now, after S6c.
**S9b-2** (the swig, the two prompts, the breakage) waits on point 2's
carrier, on its approved design (canvas 4, held with S8 and S9a) and on
point 1's kind reader. This corrects section 3's "no" in S9b's `/design`
column, for S9b-2 only.

**Agent.** `implementer` (sonnet) for each half, one agent per half.
**Tree.** `topic/beastman-gear`, after `acks-branch sync beastman-gear`;
S9b-1 after S6c lands (it uses `matchCondition`).

**The owner's words, quoted whole** (plan, "The owner's words" and section 4):

1. "I want the beastmen template fixed with special attention towards
   capturing everything in this document mechanically (plus arranging art
   correctly, etc)."
2. "Fixing the group actor type to handle generating a warband, assigning
   special troop types, equipment packages, spell casters, etc. Seems like
   the right approach. Many of these items generate ranged aura effects or
   require an action to activate. All of that game surface is in scope."
3. "Furthermore, creating kits (including random ones suited to matching
   roles and custom as a group, as a unit type, or as an individual) is
   desired."

Section 4's six answers, the owner's words only:

1. "Breed is default, Table 54 shows leaders who are both better equipped
   and tougher (higher HD)"
2. "Humanoids, including beastmen, should have an (optional, not used for
   basic entries, used for advanced beastmen rules) equipment inventory. A
   kit can ALSO include stat bumps or abilities"
3. "Use the template picture for the template, use the specifics for each
   where available. Use the art splash (pg 56) for the warband generator",
   then "3) no, see previous answer" and "4) yes, template should show a
   unique template image or none at all"
4. "work pause lifted in full"
5. "Unclear, repairs always reset the compendium copies, may offer to fix
   existing entries if a simple fix, must offer keeping a copy/as is for
   modified actors"
6. "Make sure to include the outside references such as to ogres and
   wargs."

Before building, the agent's report restates each of the three sentences
with one example. Answer 2 governs this slice: a creature with no gear stays
stat-only.

**Acceptance (plan section 3, S9b, and section 1 rows 43 and 46).** "E5,
E8". A walk observes: "heal; the condition on a human" (E5), and "damage
lands after the imported delay" (E8). S9b-1 meets the parts below that need
no gesture or prompt. S9b-2 meets the rest.

**A finding S9b-1 must fix first: S6b's delayed damage is lost when its
fight ends before it comes due.**

- `installDelayedDamage` listens only on `TURN_BEGAN_HOOK` and
  `TURN_ENDED_HOOK`. Nothing lifts or deletes a record when its combat is
  deleted, so the effect stays on the creature for good and the damage
  never lands.
- The world clock does not move during a fight. Foundry's
  `CONFIG.time.roundTime` defaults to 0 (`client/config.mjs`), and neither
  the acks system nor this module sets `CONFIG.time`, so `Combat#nextRound`
  advances world time by nothing.
- E8's delay is given in turns. Measured in rounds it outlasts most fights,
  so for E8 this case is the common one, not an edge case.

**S9b-1, part 1: lib, `scripts/lib/delayed-damage.mjs`.** This edits S6b's
file, and the file keeps one owner.

- The record gains a second clock, `{dueAt}`, in world seconds, beside the
  combat clock. `readDelayedDamage` accepts either clock;
  `delayedDamageEffectData` takes `dueAt` in place of the combat fields.
- On `deleteCombat`, the primary GM converts each pending record of that
  combat. The rounds still to run become seconds on the world clock, at
  `TURN_SECONDS / ROUNDS_PER_TURN` each (`scripts/lib/constants.mjs`).
- `onWorldTimeAdvanced` (`scripts/lib/world-time.mjs`) lifts a due record
  in the order S6b's reader uses: delete first, then `adjustHp`, then the
  card. A bearer that is gone or down gets nothing.
- A record made outside any fight starts on the world clock.
- Before building on `ROUNDS_PER_TURN`, a reviewer rules whether it is a
  printed value. It is a shipped constant with a page citation, and E8's
  count multiplies by it. If it is printed, it goes through the
  `acks-printed-value` procedure first; that is the IP stop below.

**S9b-1, part 2: E8 data, `scripts/equipment/ammo.mjs`.**

- An ammunition stack carries `flags.acks-extras.onHit` (a new `ITEM_FLAGS`
  key), holding `{saveKind, saveMod, formula, delayTurns, source, cite}`.
  These are copied from the gear row's figures (`saveKind`, `saveMod`,
  `damage`, `delayTurns`); nothing is set from source.
- `onHitOf(stack)` reads the flag.
- A pure `shotStack(actor, weapon, profile)` names the stack a shot comes
  from, using the order `pickAmmo` uses (a nocked stack first). Both
  `consumeForAttack` and the hit reader ask it, so the stack that is spent
  is the stack whose hit asks the save.
- The silver precedent (`isSilvered`) is the model: a variant is a flag on
  its stack.
- Generation: an E8 gear row flags the archer's ammunition stack in
  `resolved.items` (`launcherAmmoPattern` against the creature's
  launcher) and nocks it, since the archer fires its E8 shots. Where the
  creature holds no stack, the row stays recorded only on
  `extras.organisation.gear`. A generated archer holds a stack once S13's
  kit writes one; no count is invented before then.
- The carry cascade across gang, warband, lair and village is group
  generation and belongs to S11. S9b works per creature.

**S9b-1, part 3: E5 data and outcome, `scripts/monsters/organisation.mjs`
and a new pure `scripts/monsters/gear-outcomes.mjs`, which moves to lib only when
point 2's carrier, in lib, consumes it).**

- An E5 gear row writes one consumable item through `gearPayloads`, named
  by the row's label, with `flags.acks-extras.cookbook.cite` and
  `flags.acks-extras.drink = {healDice, saveKind, condition,
  successHealDice, swigDice}` copied from the row. The flag key is the
  module's own word, never a word of the item's printed name. The condition
  is stored as the catalogue id `matchCondition` folds (S6c). A word that
  does not fold leaves `condition: null` and is recorded.
- **Swig count: an owner question, needed before S9b-2 and not before.**
  S9b-1 stores `swigDice` and sets no count. The question, answerable as
  (a) or (b): "Does a beastman's own E5 item count its swigs? (a) No: the
  page counts only a recovered one, so the bearer swigs without limit, and
  the count is rolled when the item first reaches another actor. (b) Yes:
  the count is rolled at generation from the same dice, and the bearer runs
  dry." Under (a), a bearer may heal every action for the whole fight.
  Under (b), the creature gets a count the page does not give its bearer.
  Either way, each swig spends one where a count exists, and at none the
  item is spent (as `consumeItem` spends ammunition).
- `swigOutcome({drinkerKind, drink, saved})` is pure:
  - the bearer's kind: a heal of `healDice`;
  - a human or demi-human with `saved` undefined: a save of `saveKind` is
    owed;
  - `saved` true: a heal of `successHealDice`;
  - `saved` false: the condition, with a turn-life record `{edge: "end",
    count: 1}` (`scripts/lib/turn-life.mjs`, ended by the tracker);
  - an unknown kind: null, and the caller asks the Judge (players get
    blocks, Judges get warnings).
- Outside a fight no turn-life record can be made, so the condition then
  stays until it is removed by hand. That is a recorded limit.

**S9b-2 (held: point 2's carrier, canvas 4's approved design, point 1's
kind reader).**

- **The swig.** It is the carrier's activation on the E5 item. It calls
  `swigOutcome`, writes a heal through `adjustHp` (`HP_MODE.heal`), and
  spends one swig where the item is counted.
- **Two save requests.** Both are posted as the carrier's prompt, with a
  Save press for the saver's owners and GMs, and resolved with `saveSpec`
  and `saveThrow` (`scripts/lib/saves.mjs`):
  - the drinker's, for E5;
  - the struck creature's, for E8: on `POST_ATTACK_HOOK`, after a hit with
    a shot whose `shotStack` carries `onHit`.
- **A failed E8 save** creates S9b-1's delayed record on the struck
  creature: `delayedDamageEffectData` with the combat clock in a fight
  (count = `delayTurns` x `ROUNDS_PER_TURN`, subject to the review above),
  else `dueAt`.
- **The breakage.** On the carrier's bearer-death reader, the E5 item of a
  slain bearer is deleted.

**Tests (S9b-1).** Fixtures are invented.

- The delayed-damage suite (grep `tools/` for `delayedDamageStep`):
  - a `dueAt` record reads;
  - deleting a combat converts the rounds left into seconds;
  - a world-time lift deletes first and writes once;
  - a bearer that is gone or down is dropped;
  - a record from outside a fight starts on the world clock.
- The ammunition suite:
  - `shotStack` picks the nocked stack, else plain before silver;
  - the stack `consumeForAttack` spends is the one `shotStack` named;
  - `onHitOf` reads the flag.
- `tools/test-organisation*.mjs`:
  - an E5 row writes the E5 item with its folded condition;
  - an unfolded word gives `condition: null` and is recorded;
  - an E8 row flags and nocks an existing stack, and with no stack it is
    recorded only;
  - no gear writes no item.
- The `swigOutcome` table: all five cases.
- Mutation-check the delete-before-write order of the world-time lift.

**Unit suites that cover it.** The delayed-damage, ammunition and
organisation suites, and `test-lib` for the new lib exports. Run them in the
worktree; the land's gate is the full one.

**UI.** S9b-1 adds none. The delayed-damage card, the hit-point card and
the condition's token status are existing surfaces, and S9b-1 writes
through them. S9b-2 adds a control and a card, so it stops for the approved
canvas 4 design (`ui-layout.md`, "Design before build").

**IP stop rule.** No printed figure, condition word, option name or proper
name goes into source, `lang/`, a test or a comment. Every figure is copied
from the gear row, and the condition is stored as a catalogue id. Stop and
report if `ROUNDS_PER_TURN` is ruled a printed value, or if any other
printed value turns up in a file this slice touches (`acks-printed-value`).
A tooltip on the E5 item or the stack names its fields and cites the page.

**Walk (S9b-1, on `main` after the land, lane B).**

- **Fixtures.** `monsters/beastman-organisation` for the generated
  creatures, and the delayed-damage bearer whose marker S6b's TESTING recipe names,
  for the world-clock check.
- **E5 data.** A beastman generated with E5 holds the E5 item: its
  page shows in the tooltip, and its flag carries the folded catalogue id.
  It carries no count until the owner answers the swig question.
- **E8 data: offline only before S13.** Generation writes the payload
  before any stack exists, and no generated archer holds an ammunition
  stack until S13's kit writes one. So the flag-and-nock path is checked by
  the organisation suite alone, and the report says so. What is walked
  live: a stack given `onHit` through the API on a fixture archer
  (`equipment/onhit-archer`) is the one `shotStack` names, and firing it
  spends that stack. No prompt appears until S9b-2.
- **The world-clock leg.** Make a delayed record on the bearer inside a
  fight, then end the fight. The effect stays and now carries `dueAt`.
  Advance the world clock past it and the damage lands once, with its card
  and the effect deleted.
  - Advancing the clock is visible to every seat. Ask before moving a
    clock a peer is using (`live-testing.md`, Concurrency), or use the
    formation's dungeon turn where that is the session's own.
- **Teardown.** Delete by the uuids the run tracked.

**Walk (S9b-2), when it is released.** Swig as the beastman: its hit
points rise by the imported dice. Swig as a human seated as a player: the
prompt asks the save the row's `saveKind` names. A failure
shows the catalogue condition, gone at the end of its next turn; a pass
heals. Hit a character seated as a player with an E8 shot: the prompt asks
the save. A failure leaves the delayed record, and the damage lands after
the imported delay, inside or outside the fight. Kill the E5 bearer: the
E5 item is gone.

## For the orchestrator

**Slice order this ruling implies.** S6c, then S9c, then S9b-1, all on
`topic/beastman-gear`. Each is landed and walked on `main` before the next
is briefed. S9b-2 is held with S8 and S9a.

**Findings to register on the intake ledger** (each confirmed in code, as
cited above):

1. A delayed-damage record whose fight ends before it comes due is never
   lifted or deleted (`installDelayedDamage`). S9b-1 fixes it.
2. Influence's morale reader ignores a row's `gate`
   (`getAbilityReactionMods`). S6c fixes it, and no gated morale row may
   be written before then.
3. Nothing rolls a manoeuvre's saving throw: `targetSaveMod` reaches only
   the Rolls tab's tooltip.
4. The Rolls tab lists manoeuvres for a character's weapon only. Opening
   it to monsters is a UI change and needs `/design`.
5. E1's penalty to a human or demi-human wearer has no slice. It needs
   point 1's kind reader.
6. `ROUNDS_PER_TURN` (`scripts/lib/constants.mjs`) is a shipped figure with
   a page citation. A reviewer rules whether it is a printed value before
   S9b builds on it.

**Plan section 3 corrections.**
- Add the S6c row (wording above).
- Split S9b into S9b-1 (`/design` no; needs S6c) and S9b-2 (`/design` yes,
  through canvas 4; needs point 2's carrier and point 1's kind reader).
- S9c needs S6c as well as S6b.

**Rejected, in one line each.**
- A dropdown for each row's condition: it needs a design, and the fold
  already resolves every row.
- A radius for outnumbering: an invented figure.
- Counting a group's absent bodies for outnumbering: it counts warriors who
  are not in the fight.
- Telling the dice multiple instead of rolling it: the per-die stage would
  count the wrong dice.
- Waiving `disordered`: it waives disorder from every cause.
- Granting a proficiency for the free withdrawal: the paragraph names none.
- Suppressing weapon damage on an overrun: RR deals damage in some
  outcomes.
- A save card of S9b's own: it duplicates the carrier's prompt and is new
  UI.
- A world-clock-only delay: the clock does not move in a fight on this
  stack.

**One owner question, needed before S9b-2 only:** the swig count of a
beastman's own E5 item, (a) or (b), as worded in S9b-1, part 3.

**Read but not run.** Every code claim above comes from reading `main`'s
source and core 14.2.0's. No suite, matcher or walk was run for this
ruling.
