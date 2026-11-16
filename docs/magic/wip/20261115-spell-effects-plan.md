# Magic: spell effects, level by level (wip plan)

**Status:** plan, written 2026-11-15 by a planning session that has ended.
Each phase below is run by its own clean session, which reads this file, runs
its own agents, appends its results under "Results", corrects the next start
prompt and reports to the owner. This file is the only hand-over. It is
deleted when the last phase has moved its substance into
`docs/magic/{MODEL,DECISIONS,ROADMAP,TESTING}.md`.

This is the build of ROADMAP part 2 ("Casting and tracking") for every spell
that is not a summoning spell, rolled out one spell level at a time.
`20260924-scoping.md` beside this file is older and partly stale: it names a
`spendSpell` wrap and Foundry-registry expiry, and what is in force is lib's
`_useSpell` seam (docs/lib/MODEL.md, "The cast seam") and the module's own
clock math (magic DECISIONS, 2026-11-11). Where the two files disagree, this
one is the plan.

No printed figure, dice expression or sentence of a book appears in this
file. Spells are named by register row id (`def.spell.<x>`,
`register/rr/p196-p262-spells.json`). The level 1 matrix, with every figure
and capture hint, is on the rules shelf beside the magic extract, as
`L1-EFFECTS.md`; it is LOCAL-ONLY and nothing from it enters a commit, a
committed test, a changelog fragment or a commit message.

## The owner's words

Each is quoted whole. A brief to an agent quotes them in these words, and
the agent's report restates each with one example before building on it.

1. "Orchestrate (architect then manage with intentional subagent selection)
   the development of the RR magic. Spells want their proper effects,
   damage/effects should apply with correct amount and type. This will be a
   phased rollout, let's start with level 1 spells."
2. "Damage should just use "magic" as a weapon roller type. Don't forget core
   design principles of this project"
3. "cast time and spell duration (and if it requires concentration to hold)
   are the other obvious buckets to think about. The JJ spell design system
   probably offers the most clues on mapping the design space"
4. "for example I forgot resist rolls with their types as another major thing
   to track, and stacking rules"
5. "When ready, start this work as a new branch"
6. "1 stops, 2 spells track separate, effects don't stack but can overlap, 3 on
   cast if target
   Don't forget to track interaction with spells per day and abilities that
   buff certain spells"
7. "Yes to damage types/resistances/immunities interactions" (the answer to
   owner question 4)
8. "1) yes; follow raw, 2) maybe yes, check raw, 3) maybe yes, check raw, 4)
   yes, automation with transparency is the design principle, size per
   spell, normalize for stats, ask case by case
   Build out missing surfaces like alignment checks (should already exist)"
   (the answers to session 1a's four owner questions and its area-size
   finding)

Messages 6 and 7 reached session 1a through the planning session on
2026-11-15, after it had started; message 8 answered session 1a's report.
Their readings are under "Owner rulings".

The readings the plan proceeds on (the planning session's, tested against
source by the architect):

- **2:** core's weapon pipeline has three attack types, melee, missile and
  thrown. "magic" is a fourth beside them, registered through lib's attack
  seam, and a spell's damage goes through that pipeline. The spell's printed
  damage type still rides the roll's `types`. "Core design principles" is
  reuse → extend → enhance → invent, one owner per wrapped core method, and
  `.claude/rules/ip-doctrine.md`. If the owner meant every spell's damage is
  typed "magic", ruling 9 changes and nothing else does.
- **3 and 4:** a spell's executable model is a small set of buckets, and the
  owner's list is open. JJ ch. 14's design axes are the map (see "Bucket
  map"). Its costs, factors and option lists stay with the importer;
  ROADMAP part 1b is not pulled forward.

Earlier rulings in force (magic DECISIONS, "The order, and the scoping's
eleven questions, ruled"): #1 one document, the reverse a mode of it; #2 and
#6 a spell's rows keep their own vocabulary and Active Effects carry statuses
several sources can impose; #11 flag or sub-type, settled in ruling 10 below.
Repo-wide: players get blocks and Judges get warnings; a missing import stays
blank with its page reference; no house rules ship; no tools for
previous-version data.

## State at the start

Verified in source on 2026-11-15 (`main` at a6eb79be):

- 337 spell register rows (317 of RR ch. 5, 20 rituals). No row carries
  effect keys. `bindSpell` writes the stat line and no `effects`.
  `REPAIR.spell` keeps `spell.effects` whole.
- The ability recipe channel already carries authored rows: a register row's
  `effects` compile to `fields.effects {op: "effects"}`
  (`tools/importer/compile-cookbook.mjs`) and the executor's
  `materializeEffects(specs, paras)` locates their figures in the entry's own
  prose.
- One claimant on the cast seam, `acks-extras.magic.castSummon`. Claimants
  are asked in registration order and the first to answer exactly true wins.
- Core's `AcksActor#makeAttackThrow({item, attackType, skipDialog})` rolls
  damage only for a weapon item (`throw/attack-throw-builder.mjs`), with
  `types` and `extraordinary` from the weapon's base damage. Nothing in core
  or in this module reduces damage by a target's defenses; `types` is
  display only.
- Lib owns the attack seam (`lib/patches/attack-throw.mjs`: an `attackTypes`
  contributor, wrappers on `getAttackThrowModifiers` and
  `getDamageModifiers`). `lib/hp.mjs` `adjustHp` is the one HP writer.
  `lib/typed-modifiers.mjs` is the stacking model (`modifierDisposition`,
  `resolveStacking`, `standingModifiers`). `lib/conditions.mjs` holds the
  condition catalogue, `rollMath` and what a condition is lost to.
- `resolveLevelValue` defaults its level to one, so a caller with no caster
  level must not call it.
- Level 1 is 56 rows: 11 deal damage, 2 heal, 12 carry a modifier, 16 grant a
  condition, 5 need an attack throw, 12 recur or need concentration, 14 scale
  a figure with caster level, 7 take a choice at cast, 7 have a reversed
  form, 8 are areas, none uses an HD pool, and 24 need no arithmetic.

## Rulings

Each is the architect's decision; the rejected alternative and the strongest
counter-argument are kept so a later session can reopen one with evidence.

1. **The numbers come through the ability recipe channel.** A spell register
   row gains `effects: [spec]` and `values: [spec]`. A spec holds structure
   and figure-free locators only: the row kind, `appliesTo`, `saveEffect`,
   `delivery`, `lasts`, `recur`, `pick`, `reversed`, condition keys, modifier
   targets, the LevelValue shape, `notStacksWith` and `provides` refs. New
   locatable kinds: `dice`, `damageType` (a word mapped to a `DAMAGE_TYPES`
   key through the shipped label table), `flag`, `saveCategory`, `filters`.
   Structure, shipped: what a passed save does, the target model, the
   delivery, the fact that a figure scales. Content, captured at import: the
   damage type, the extraordinary mark, the save category, the filters, every
   per-level figure, HD cap and fraction. `bindSpell` takes rows only when
   the entry has authored specs, since `effectScan` already runs over every
   spell's prose and would otherwise write guessed rows. Figures live only in
   a row's `roll`, `value` and `max`, so 1b's JJ rows can later expand into
   the same shape. *Rejected:* extending `DERIVE_PATTERNS` (one flat value
   per entry). *Counter (medium):* the doctrine's own jumping example ships a
   save category as structure, so capturing it costs locators for no gain.
2. **A capture that misses leaves the figure blank.** A spell spec carries
   `onMiss: "blank"`; the row lands with the figure unset and `unread:
   [field]`. This supersedes, for spell rows only, the importer's rule that a
   missed locator drops its whole row, and the DECISIONS entry names the new
   evidence (the 2026-11-14 blank-import ruling, and that the row's structure
   is still what a Judge needs). At cast a blank row rolls nothing and offers
   no Apply; saves and conditions still resolve; nothing throws.
   *Counter (medium):* a half row can read as complete; the Mechanics tab
   shows the `unread` mark.
3. **Repair tells rows apart by `origin`.** A register-authored row carries
   `origin: "register"`. `REPAIR.spell` merges: register rows are replaced
   from the fresh bind, every other row is kept. The row editor clears
   `origin` on any edit. *Rejected:* a document-level stamp.
4. **Imported worlds get rows by the Spells repair; a copy reads its twin.**
   No migration ships. At cast a copy's own rows win; with none, the library
   twin's rows are read live (`libraryTwin`, the summon precedent). No twin
   rows means the claimant declines.
5. **One claimant, `acks-extras.magic.castSpell`, registered after the
   summon's.** It claims when the item has the flag, the seat owns the actor,
   the spell is not a summoning spell and own or twin rows exist. It declines
   unflagged items (core's monster attacks) and rowless spells, which stay
   the system's. `spend()` runs at dialog confirm, before any dice.
   *Rejected:* one claimant per kind; spend after resolution.
6. **Caster level is resolved, never defaulted.** `options.casterLevel`, then
   the class tradition matching the spell's list source (its `casterLevel`
   ladder at the class level, or the class level where the ladder is blank),
   then a monster's `spellcasting.level`. Unresolved and needed: the cast
   dialog shows an empty level field, and a typed value is marked as set by
   hand in its tooltip. *Counter (medium):* a player can inflate it; the mark
   is the Judge's trail.
7. **Targets are the seat's targeted tokens, for every model, in phase 1.**
   Self is the caster. An area has no template yet; the seat picks the
   tokens. A target over a captured HD cap reads unaffected on its row.
   Range is measured where the shape is a distance with a figure: a player
   is blocked, a Judge warned. Line of sight is not checked. Filters are
   shown, not enforced. *Counter (medium):* a player can include anyone; the
   range check and the Apply press bound it.
8. **Resist rolls are typed and kept.** The spell's `save {category, effect,
   perTarget, modifier}` is the saving-throw bucket; a row's `saveEffect`
   overrides `effect` for that row. `save.kind` branches three ways. *save*:
   rolled in the card by the casting seat for each target, composed as core's
   `rollSave` composes it plus lib's `rollMath("save", …)`, plus the captured
   situational modifier as a per-row toggle; a failed save runs lib's loss
   path; the result is stored on the recipient's record. *attack*: ruling 9.
   *other* (a derived target, an item's bonus): the card hands it to the
   Judge in phase 1. New shared helper `lib/saves.mjs` `saveThrow(actor,
   category, {situational})`, promoted from `rollPartySave`. *Rejected:*
   core's `rollSave` per target (a dialog and a card per call).
9. **Damage uses the weapon pipeline with "magic" as an attack type.** No
   damage resolver is built. An
   `attackTypes` contributor answers `["magic"]` for a carrier flagged as a
   spell's, and the modifier wrappers drop core's melee and missile rows for
   it. The carrier is a transient, unsaved core weapon item parented to the
   caster, its base damage `{formula, types, extraordinary}` taken from the
   row. A row with a throw calls `makeAttackThrow` with the carrier and gets
   core's card and core's Apply; a row's `delivery` lets the throw take that
   delivery's rows while the damage stays magic. A row with no throw has no
   core entry point: lib's `magicDamageSpec(actor, carrier)` asks the same
   `getDamageModifiers("magic")` question and the cast rolls it. Core has no
   label for the type; lib supplies one at runtime. *Rejected:* "magic" as a
   damage type (it would erase the printed type); core's chat apply in the
   module's card (GM-only, cannot heal). *Counter (medium):* the no-throw
   path is the same roller in modifiers and typing only, not in code.

   **Applying (owner rulings 3 and 4).** Where the seat had tokens targeted
   when it cast, damage, healing and conditions apply at the cast, after each
   target's resist roll; with nothing targeted the card posts its rolls and
   an Apply press does the same work later. One lib path takes a rolled
   amount to a target: the save's fraction, rounded as the RR's rounding rule
   prints (to the nearest whole, a half to the even number; core's
   `applyDamage` and lib's `planHpChange` round every half up), then the
   target's defenses (the seam session 1b fills: immunities, resistances,
   susceptibilities, built once for weapons and magic), then `adjustHp`. A
   target the seat does not own is written by the GM's client after it
   checks the request against the caster's spell item (the summon relay's
   precedent); with no GM connected that target falls back to the press. The
   card shows what was applied to whom, and the Judge has an undo
   (`lib/hp.mjs` `restoreHp` for hit points, the record's deletion for a
   condition).
10. **A recipient's record is the effect's lifetime; the flag stays.** A
    condition is `statuses: [key]` on the recipient's cast record, so ending
    the record ends the condition and no effect is stranded. A modifier row
    is classified by `modifierDisposition`: a standing one becomes a change
    on the record at a `MODIFIER_PATHS` path, any other is listed on the card
    and the record. Stacking (owner ruling 2): every cast keeps its own
    record, the same spell twice or two spells granting the same kind of
    effect, and their effects do not add; they overlap. A condition is held
    or not (RR Appendix B: each instance keeps its own duration and the
    condition does not get worse), so it stands while any record holding it
    stands. A figure from two spell records applies once, the larger, through
    `resolveStacking` with non-stacking as the default between spell records;
    when one record ends the other's figure still applies until its own end.
    A printed clause that two things DO add wins, authored as `stacksWith`; a
    printed non-stacking clause against a source that is not a spell record
    (a masterwork weapon) is authored as `notStacksWith` / `provides`. The duration is `castDuration` with
    the resolved level, stored in the flag, with core's `duration` unset on a
    record that carries statuses or changes, because core counts an
    unconvertible rounds duration as already run. Ruling #11 is settled for
    the flag: a sub-type needs a world relaunch and leaves invalid documents
    when the module is off. *Rejected:* `holdCondition` (its managed guard
    would fight lib's loss path).

    **A record is a modifier source, and a buff reaches the roll it
    changes.** Checked against `modifierDisposition` on 2026-11-15: of level
    1's twelve modifier rows none is standing on a `MODIFIER_PATHS` path.
    Two are scoped by an attacker's kind or alignment (at the roll); two sit
    on a weapon, one of them with a printed non-stacking clause; five change
    or grant a proficiency throw (read by the abilities roller); one changes
    a reaction roll (read by influence); one changes a single saving throw
    under a condition; one sets an armour class by the kind of attack, which
    no path or mode expresses today; one is an object's and the Judge's. A
    row listed on a card and applied nowhere is not a built effect. Each row
    reaches its roll through the seam that owns that roll, reading the
    recipient's cast records as sources: lib's attack seam contributor for a
    weapon's bonus and for an armour class against an attack, `saveThrow`
    for a save, the abilities roller and influence for theirs. Slice 2
    proves the pattern on one weapon buff; slice 5 opens with an `architect`
    ruling on the readers the others need.
11. **Concentration is a held status on the caster's record.** Both
    concentration catalogue rows gain what they are lost to, the mechanism
    the `casting` condition already uses. Casting again warns and lifts it on
    confirm. When the caster's record goes, a card to the GMs and the
    caster's owners lists the recipients' records with an End button; the
    card tells and a press removes (superseded in part by ruling 31: the end
    removes them, and the card lists what ended). A recurring row raises a prompt card at
    the relevant initiative, never an automatic effect. `castDuration`
    answers `{none: "untimed", held, cap?, tail?}` for concentration shapes.
12. **A reversed form is rows marked `reversed`.** The cast dialog offers the
    mode on a reversible spell and filters the rows.
13. **Every figure on the card says where it came from** (`ui-tooltips.md`):
    a rolled total its dice and their cite; a save target its named parts
    with the actor's numbers; the caster level its ladder or "set by hand"; a
    blank figure its page reference alone.
14. **A kind with no arithmetic is a record and a card line.** Illusion,
    wall, detect, light, ward, transform, dispel, createObject, structural
    and curse rows write the caster's record (and a recipient's where the row
    names one) and a line from `describeSpellEffect`. Nothing more in
    phase 1.
15. **Casting time is the declaration and what disrupts it.** The RR stat
    line prints no casting time; the casting chapter's rule by source is
    structure, and a printed exception is captured from prose. In a started
    fight a spell is declared before initiative and lost to damage or a
    failed save (RR ch. 6), and lib's `casting` condition already is that
    state: it ends at the caster's turn and is lost to both. The cast joins
    it. Opened in a started fight before the caster's turn, the cast dialog
    declares: `casting` goes on the caster with the spell named on a pending
    record, and nothing is spent (superseded in part by ruling 23: the
    declaration spends at its confirm). Opened on the caster's turn it resolves
    and lifts `casting`. Where the declaration was lost the dialog says so;
    a player is blocked and a Judge warned. Outside a fight a cast resolves
    at once. A casting time longer than an action is shown and tracked only,
    until rituals. *Rejected:* showing the casting time and acting on
    nothing, which leaves the owner's third message unbuilt.
    *Counter (medium):* a table that never uses the `casting` status gets a
    new step in every fight; the Judge's warning is the way through.
16. **Judge tools ship with the engine.** The row editor's per-kind fields
    gain: damage `saveEffect`, `delivery`, `extraordinary`, `recur`, `pick`,
    `reversed`; heal `saveEffect`, `pick`, `reversed`; conditionGrant
    `saveEffect`, `lasts`, `recur`, `reversed`; modifier `notStacksWith`.
    Overview gains `target.hdCap` and `save.exemptBelowHd`. The Mechanics
    list marks `origin` and `unread`.

## Owner rulings

The plan's four owner questions are answered (owner's words 6 and 7). Each
reading is restated with one example, as CLAUDE.md asks of a ruling before
anything is built on it.

1. **"1 stops."** A recipient's record that runs out stops applying by itself;
   no card offers its removal and no press is waited for. *Example:* a
   condition granted for a number of turns is gone from the token when the
   world clock passes the record's end, with nobody pressing anything. This
   is the recommendation; ruling 10 and the expiry sweep build it.
2. **"2 spells track separate, effects don't stack but can overlap."** Every
   cast keeps its own record, whether the same spell lands twice or two
   spells grant the same kind of effect; their effects never add, and they
   overlap in time. *Example:* two casts of `def.spell.sharpness` on one
   weapon leave two records and one figure on its throw; when the first
   record ends the figure stays until the second ends. Non-stacking is the
   default between spell records, wider than the recommendation (which
   covered only the same spell twice); a printed clause that two things do
   add wins, authored as `stacksWith`. Ruling 10's stacking paragraph is
   this.
3. **"3 on cast if target."** Where the seat had tokens targeted when it
   cast, damage, healing and conditions apply at the cast, after the resist
   roll, with no press; a cast with nothing targeted posts its rolls and
   leaves application to a press. *Example:* a Player casts a damaging spell
   at two targeted monsters it does not own; each saves or fails, and the
   GM's client writes each amount once it has checked the request against
   the caster's spell item; with no GM connected the card offers the press
   instead. This reverses the recommendation; ruling 9's "Applying" is this.
   Seat rights settle the reading without a further question: a seat cannot
   write an actor it does not own, so the relay is forced, and the fallback
   is the press.
4. **"Yes to damage types/resistances/immunities interactions."** Damage
   against a target's immunities, resistances and susceptibilities is built
   in this rollout, once, in lib, for weapons and magic alike, reading the
   defenses the monster import already writes (`defensesField()` under the
   `extras.defenses` flag). *Example:* a monster whose import marks it
   immune to the type a spell's row carries takes none of that row's damage,
   and the card's tooltip names the defense. It is built in session 1b's S3,
   which opens with an `architect` ruling on where the fractions are
   imported from (they are printed values: none ships) and the one place an
   amount is reduced; session 1a leaves the seam between the roll and
   `adjustHp` (ruling 9, "Applying").

Two buckets the owner added in message 6:

17. **Spells per day: capacity and spend.** Verified in source on
    2026-11-15: core's `_useSpell` increments the spell item's `system.cast`
    and posts its card, and the character sheet counts a level's used slots
    as the sum of `system.cast` over that level's spells against
    `system.spells.<level>.max`, reset on rest; core never refuses a cast. The
    class document is this module's capacity: `scripts/classes/casting.mjs`
    `poolState` reads a vancian tradition's slot row at the caster's level
    (`slotRowAt`) or a points tradition's pool (`poolValueAt`), the actor
    stores only what is spent under `flags.acks-extras.classes.pools`
    (`adjustPool`), and `restPools` clears it. A cast checks the capacity of
    the tradition matching the spell's list source at the spell's level on
    that list before its dialog confirms: with none left a player is blocked
    and a Judge warned (the repo's automation rule). The spend happens once,
    at confirm, through the seam's `spend()` and the tradition's pool
    together, so a cancelled dialog spends nothing. A declaration lost to
    damage or a failed save spends the spell (RR ch. 5, the casting rules). The reversed
    form spends as its spell. A spell on two lists spends from the tradition
    whose source cast it. A monster's printed repertoire is counted by core's
    `system.cast` alone until the repertoire work. S2 builds the check and
    the spend at confirm; slot caps beyond the class grid wait for the
    repertoire work.
18. **Caster abilities that buff certain spells.** The vocabulary carries the
    rows (`spellcastingMod` and `spellLike` in `EFFECT_TYPES`,
    `casterLevelDelta` and `school` on `effectField()`, `casterLevel` in
    `MODIFIER_TARGETS`) and nothing reads them. At cast the caster's ability
    rows are gathered and matched to the spell by what each narrows on
    (spell type, school or element word, list source, a named spell), and
    each match changes the bucket it names: the caster level a figure scales
    with, a target's resist roll, the damage, the range or duration, the
    capacity. Each applied one is named in the figure's tooltip. The size of
    each bonus is printed and arrives by import. A `scout` inventories which
    imported proficiencies and class powers carry such rows and what they
    narrow on before an `architect` rules the matching; where it lands (S2
    with ruling 6, or S3) is in "Results, 1a".

## S2 rulings (session 1a's architect, 2026-11-15)

Ruled after owner messages 6 and 7 and the session's runtime probes ("Not
verified", settled in "Results, 1a"). Each keeps its rejected alternative and
counter, as above.

19. **Sharpness names its weapon; a lib roll-mods flag carries a buff to the
    weapon's rolls.** The recipient's record names the weapon as
    `spellEffect.item {id, name}`, picked in the dialog from the targeted
    token's actor's weapon items; ammunition and several small weapons are
    outside S2 (ammunition is not a weapon item). "Already magic" is lib's
    `isMagical(item)`, never `system.bonus` (masterwork writes there too).
    Lib registers gate kinds `weaponMundane` and `weaponMagical`, read off the
    item alone, so a second cast never makes a weapon count as magic. The row
    pair: the mundane row carries `notStacksWith: ["kw:masterwork"]`. Lib
    defines a roll-mods flag any effect may carry (`on`, `itemId`, `value`,
    `gate`, `stacksWith`, `notStacksWith`); magic writes it with figures
    resolved at cast from the row, a blank figure writing none. Lib's attack
    seam contributor reads the attacker's effects for `itemId` equal to the
    weapon's, adds what a new `registerItemBonusSource` reports for the item
    (equipment registers masterwork, `provides: kw:masterwork`), and runs
    `resolveStacking`; every spell-record part carries one shared capability,
    so two spell records never add (owner ruling 2). Where masterwork loses,
    a labelled negative row takes its figure back out of core's rows; where
    the spell loses, the card says so. *Rejected:* the record on the weapon
    item (follows a trade, but supersedes ruling 10 on nothing probed); a
    magic-owned contributor importing equipment (lib imports no feature).
    *Counter (medium):* a traded weapon leaves its buff on the old holder.
20. **A record holds at most one status, and a record holding a status holds
    no changes.** Core 14.370's `toggleStatusEffect` off deletes every effect
    whose only status is the one toggled, changes and all, and never one
    holding two. A condition rides a status-only record; the cast's modifiers
    ride a separate status-free record under the same `castId`. The HUD
    toggle then ends the condition and leaves the buff. Expiry, undo and End
    delete one record by id, never by toggle. *Rejected:* one combined record.
    *Counter (low):* a modifier belonging to a condition is the catalogue's
    `mods`, which leave with the status anyway.
21. **Rounding.** The printed rounding (RR Introduction) is procedure and
    ships: `hp-logic.mjs` gains pure `roundHalfEven` and
    `amountAfter(rolled, {fraction, stages})`, which applies the save
    fraction, then the defenses stage (a pass-through until S3), then rounds
    once; `adjustHp` gets the result with multiplier 1, and the card shows
    rolled and applied. `planHpChange` keeps core's round-up (its contract is
    what core would write); core's chat Apply and the HP tool are untouched
    in S2. *Counter (medium):* two rounding rules coexist until S3.
22. **Where the print is silent, the module does what the owner answers;
    until then, the defaults below.** Area damage: one roll per row per cast,
    each target saving against it (`rollAmounts`' `perTarget` makes the other
    answer free). A row with no throw has no damage floor (the printed floor
    is an attack's); a row with a throw keeps core's. A spell's throw takes
    core's criticals under the Judge's setting. All three go to the owner.
23. **Declaration** (supersedes ruling 15's "nothing is spent" on new
    evidence: RR ch. 5 counts a disrupted declared spell as cast, and the
    seam's `spend` stops working once `cast` settles, so nothing can spend at
    the moment of loss). A fight has begun when `combat.started` or core's
    `acks.initDone` flag is set; it is the caster's turn when
    `combat.combatant` is the caster's and its initiative is rolled. At any
    other moment in a fight the dialog declares: at confirm it checks
    capacity and spends once, then writes a status-only `casting` record, a
    status-free pending record naming the spell, and core's combatant flag
    `acks.prepareSpell` (the tracker's own Casting toggle). Lib exports its
    loss path with a hook carrying `(actor, ids, cause)`; magic stamps the
    pending record `lost`. On the caster's turn an unstamped pending record
    resolves with no second check or spend; a stamped one is reported lost;
    with none a Player is blocked and a Judge warned, and a hand-set
    `prepareSpell` counts as a declaration. The module clears `prepareSpell`
    at resolution or loss. *Counter (medium):* a misclicked declaration is
    spent; the Judge lowers core's count by hand.
24. **Concentration** (ruling 11). `concentrating` and
    `concentratingStationary` gain `lost: HURT_OR_FAILED` (not `moved`, which
    means moved out of turn). Automated: damage, a failed save, the caster's
    next cast through the module. Left to the Judge, with a ROADMAP row:
    attacking, other actions, movement (`POST_ATTACK_HOOK` is the route for
    attacks). Whether concentration's end also ends the recipients' records
    goes to the owner; default no (the end card tells, a press removes).
    *Superseded in part by ruling 31* (owner message 8): it ends them.
25. **Capacity and the relay** (ruling 17). `castCapacity(actor, spell)` is
    pure: ruling 6's tradition, for a vancian one `slotRowAt` minus the spent
    pool; else core's `system.spells.<lvl>.max` minus the level's summed
    `system.cast`; else unknown and no verdict. Checked once, at the confirm
    that spends; the spend is `spend()` plus `adjustPool` for a vancian
    tradition (a points pool is shown, not spent: its cost is printed, S3).
    The relay is a magic handler on `sockets.mjs` (`executeAsGM`); the
    caster's record is written first, and the GM's client checks the
    requester owns the caster, the spell item and a caster record with this
    `castId` exist, the row exists in the spell's or its twin's rows, the
    amount fits the row (`magicDamageSpec` recomputed there), and the
    castId/target/row was not already applied; it rebuilds the record from
    the row, not the request, and runs the loss path for a failed save.
    Undo is the Judge's: the message keeps target uuids and before-values.
    Core's attack card for a spell carrier is stamped while in flight and
    loses its apply-damage button, so nothing applies twice.
    *Counter (medium):* a range check does not prove a player's roll honest.
26. **Caster abilities go to S3** (ruling 18). No S2 row scales with level
    and every S2 range and duration is fixed. S2's caster level returns
    `{value, parts}` and `saveThrow` takes labelled parts, so S3 adds ability
    rows without reshaping. The register carries no authored
    `spellcastingMod` or `spellLike` row today; only the prose scan writes
    them (a spell name with frequency, or a caster-level delta with no
    school), so S3 authors before it reads.
27. **S2 splits in two**, each lib first, then magic. *S2a:* lib — the magic
    type and `isSpellCarrier` in `patches/attack-throw.mjs` (equipment's
    `attack-mods.mjs` / `roll-wrap.mjs` stand down for a carrier), `saves.mjs`,
    `hp-logic.mjs` rounding, the loss export with its hook; magic —
    `cast-spell.mjs`, `apps/cast-dialog.mjs`, `templates/magic/cast-card.hbs`,
    `cast-capacity.mjs`, the relay, `spell-effect.mjs` (one status per
    record, roll-mods, `item`), `cast-expiry.mjs` (the flag's duration, every
    actor and unlinked token, recipients deleted by id), the row editor's
    fields, `docs/magic/TESTING.md`; live: the desiccate, cureLightInjury and
    frightenHumanoid observables, a monster's attack still core's, the Player
    relay, the refusal with no slot. *S2b:* lib — the concentration rows,
    the roll-mods contributor, `registerItemBonusSource`, the two gates;
    magic — declaration, held records and the end card, the weapon pick,
    equipment's masterwork registration; live: holyCircle, a lost
    declaration, sharpness cast twice on a masterwork weapon.

## S1b rulings (owner message 8 and session 1a's architect, 2026-11-15)

Message 8 answered the four questions "Results, 1a" asked and two of its
findings. The print was checked for each (`rules-lookup.md`): no general rule
on rolling area damage once or per creature; RR ch. 6 "Dealing Damage" floors
an attack's damage against modifiers, magic excepted, and prints no floor for
a spell with no throw; JJ ch. 16's Critical Hits is optional and names no
spell; area sizes print as a diameter, a radius or a length by width, with no
general convention.

28. **"1) yes; follow raw."** One roll per row per cast, each target saving
    against it. *Example:* desiccate at three tokens rolls once and each
    target that saves takes the halved amount. A page that prints a roll per
    creature gets a row flag for `rollAmounts`' `perTarget`; none of the five
    does. Ruling 22 stands.
29. **"2) maybe yes, check raw."** The printed floor belongs to an attack, and
    no house rules ship: a row with a throw keeps core's floor, a row without
    one has none. *Example:* a rolled 1, halved by a save, applies 0. Ruling
    22 stands.
30. **"3) maybe yes, check raw."** The optional rule is core's setting; a row
    whose delivery is an attack throw takes it, and a row with no throw is
    never critical. That it reaches a spell's delivery throw is inferred from
    "attack throw", since the rule names no spell. Ruling 22 stands.
31. **"4) yes, automation with transparency is the design principle."** When
    concentration ends, that cast's recipient records end with it; a record
    whose duration prints a time after concentration runs that tail instead.
    The primary GM's client ends what the seat does not own; with no GM
    connected the card offers End. The card lists what ended and carries a
    Judge's Restore. *Example:* holy circle's caster is hurt; the caster's
    record and every recipient's record of that cast go, and one card names
    them. Supersedes in part rulings 11 and 24; S2b's list (ruling 27),
    Phase 1's holyCircle acceptance and cast-flow step 13 follow it.
32. **"Size per spell, normalize for stats, ask case by case."**
    `target.area` becomes `{shape, measure, size, width, unit, height}`:
    `measure` (`AREA_MEASURES`: radius, diameter, length, in magic-vocab) is
    the word the page uses and is authored; every number is located; `width`
    joins `LOCATABLE_FIELDS`; `unit` is a `DISTANCE_UNITS` key, feet by
    default. `scripts/magic/cast-area.mjs` `areaExtent` computes the
    normalized extent from resolved figures and stores nothing. Lint: a
    located size needs a `measure`, its pattern contains the measure word, and
    `length` needs a width locator. A spell whose measure is ambiguous ships
    no size locator: the size stays blank with its page reference, and its id
    goes on the owner's list in the session's results. Desiccate's measure is
    a diameter, holy circle's a radius; the other three have no area.
33. **"Build out missing surfaces like alignment checks (should already
    exist)."** The evaluator exists (`lib/vocab.mjs` `scopeApplies`); the
    reader, a caster-relative scope, a disjunction and an enemy test did not.
    - `vsAlignmentOf: "source"` reads the reference alignment from
      `ctx.sourceAlignment` (whoever the effect comes from: a spell record's
      caster, stamped on the record at cast; an ability's holder), and the
      new mode `except` applies against every alignment but the reference.
      On a defensive row `ctx` describes the attacker.
    - `anyOf: [branch]` on `effectField`, one level deep, each branch holding
      `vsKinds`, `vsAlignment`, `vsAlignmentOf`, `vsAlignmentMode` and
      `vsEnemy`; top-level clauses AND the `anyOf`. Three-valued: applies if a
      branch applies, else undetermined if a branch is, else fails. A branch
      never takes `sign`. `hasScope(effect)` is exported and
      `typed-modifiers`' `hasRollScope` and influence's `vsGated` call it.
    - `vsEnemy` reads `ctx.enemy` from lib's `areEnemies(tokenA, tokenB)`:
      friendly against hostile is true, the same side false, a neutral,
      secret or missing token null (undetermined); the tooltip names the
      dispositions read.
    - `creatureKinds(actor)` in lib: the monster's types (`MONSTER_TYPES`
      already holds construct, enchanted, incarnation, undead), `summoned`
      where `summonerOf` is set, the defined term `enchanted` when any member
      holds, `character` for a character; an untyped monster gives an empty
      set (undetermined).
    - `alignmentKey(text)` in `vocab.mjs` and `actorAlignment(actor)` in
      `actor-read.mjs`; influence's `classifyAlignment` delegates to it, which
      supersedes influence's "Alignment is translated at the boundary"
      reason ("no live consumer") now that magic is a second one.
    - Holy circle: the ward scoped to `vsKinds: ["enchanted"]`; the two bonus
      rows scoped by `anyOf` (an enemy of an alignment other than the
      caster's, or incarnations and undead of the chaotic alignment) with
      their free-text `condition` gone; reversed twins whose second branch is
      incarnations of the lawful alignment, the print's one example (on the
      owner's list: whether lawful undead count too).
    *Rejected:* a sentinel `vsAlignment` value (that enum feeds `choice()`,
    the PDF reader and the lint); two conjunctive rows sharing ruling 19's
    capability (doubles the located figures, lets a Judge edit one twin).
    *Counter (medium):* disposition is how a token is drawn, not whom it
    fights for.
34. **S1b, one slice on the branch before S2a** (`implementer`): lib
    (`fields.mjs`, `vocab.mjs`, `magic-vocab.mjs`, `actor-read.mjs`,
    `typed-modifiers.mjs`, `apps/effect-row-editor.mjs` scope fields for
    modifier and ward rows with `anyOf` shown read-only, `influence/actor-data.mjs`,
    README, API "Scoping", a lib DECISIONS entry, the api version), importer
    (`LOCATABLE_FIELDS`, `spell-recipe-rules.mjs`, MODEL, the recompile),
    register (holy circle's rows and twins, the two measures), magic
    (`spell-extras.mjs`, `cast-area.mjs`, the Overview's measure, unit and
    width with a tooltip on the normalized extent, lang, MODEL). *Accept,
    live:* after the Spells repair the ward's scope, both branches, the twins
    and the two measures are on the rows; in page context `scopeApplies`
    answers applies, fails and undetermined on fixtures
    `magic/scope-chaotic-undead`, `magic/scope-ally-caster` and
    `magic/scope-neutral-token`; a row-editor submit keeps `anyOf`. Runtime
    evaluation against an attacker stays S2b. *Finding for S2b:*
    `modifierDisposition` answers unsupported for an area or recipient
    subject before it tests any scope, against ruling 10's classification.

## S2a rulings (the S2a session's architect, 2026-11-16)

Ruled on the questions the plan left open for S2a, against source in the
worktree and core's `src/`. Each keeps its rejected alternative and counter.
Tests use invented spells only.

35. **A register row carries a `key`; a repair skips a row the Judge took
    over and asks about it.** Every register effects spec carries an authored
    `key` (`/^[a-z][A-Za-z0-9]*$/`, unique per entry, reversed twins
    distinct); `effectField` gains `key`, the lint requires it, and a Judge's
    added row gets `"_" + randomID(8)`, which can never match. *An edited
    row:* a stored row with no `origin` whose key is a fresh register key
    stands in for it; the fresh row is not added; where the Judge's row no
    longer covers the fresh one (`coversFigure` minus `origin`, `unread`,
    `key`) the repair lists a held edit, default keep, "take" puts the fresh
    row in its place. *A deleted row:* `SpellExtras.retired: string[]`; the
    row editor's delete passes `{removed}` to the store, which retires a
    register key; a repair skips a retired key and lists a held edit, "take"
    restores it. *`values`:* `bindSpell` stamps `cookbook.read.spell` (leaf
    path → value written); a leaf equal to the stamp takes the page, one
    differing from both is a held edit, an unstamped one takes the page.
    `force` makes the page win everywhere but on a `_` row. Supersedes the
    cost line of importer DECISIONS 2026-11-15 ("A repair tells a spell's
    rows apart by `origin`") and ruling 3 in part, on new evidence: 1a saw
    four rows after an edit and a repair, a deleted row return and `values`
    overwritten, and S2a makes rows executable, so a doubled damage row would
    apply twice. Built as slice **S1c**, before the lib half. *Rejected:* a
    `supersedes` field; a compile-minted positional key; a silent stand-in.
    *Counter (medium):* every repair re-lists each edit that still differs.
36. **The carrier is lib's and is known by identity, never by a flag.**
    `spellCarrier(actor, row, cast)` builds an unsaved weapon parented to the
    caster and records it in a private `WeakMap`; `isSpellCarrier(item)` is
    membership, `carrierOf(item)` the info. Its base damage is the row's
    `{formula, types, extraordinary}` (`varies` → core's `variesByWeapon`,
    unknown types dropped, the formula always written). Supersedes in part
    ruling 9's "a carrier flagged as a spell's": a flag survives copy and
    drag, and a real weapon answering as a carrier would lose equipment's
    rows. *Counter (medium):* a core clone between dialog and builder would
    miss the identity; loud (the card reads its delivery), and the first walk
    proves it.
37. **The type is "magic"; the throw asks the delivery's question;
    contributors opt in per question.** A contributor declares `carriers?:
    ["attack"|"damage"]`; for a carrier's attack `ask()` skips one that has
    not opted in. The conditions and roll-gates contributors declare
    `["attack"]`; equipment declares nothing and is never asked, so
    `equipment/attack-mods.mjs` and `roll-wrap.mjs` stay untouched. For a
    carrier the weapon wrappers answer `["magic"]`, wrapped's modes and
    wrapped's formula. The attack base is `wrapped(delivery)` and
    contributors are asked with the delivery while `ctx.type` stays "magic";
    the damage base is `[]` plus `damageTerms`. Supersedes ruling 27's
    "equipment stands down" mechanism; the intent stands. *Rejected:* passing
    the delivery type and swapping only the damage (the card would read the
    delivery). *Counter (medium):* a missile delivery loses core's range
    band; no S2a row has one, S3 rules it.
38. **Core's label for the type is written at ready**: lib's
    `ACKS-LIB.attack.type.magic`, copied into `game.i18n.translations` at
    core's key unless the system already has one. *Counter (low):* none
    beyond a future system key, which the guard keeps.
39. **A no-throw row's damage asks the same question inside a context lib
    holds.** `magicDamageSpec(actor, carrier, {terms})` holds an attack
    context with no target around the two synchronous modifier calls and
    returns core's roll-spec shape (or null for no formula), composed by
    `modifiedFormula`, a mirror of core's, pinned by a test. No floor (29).
40. **The cast applies a throw's damage itself; core's card loses its Apply
    before it is stored.** The cast awaits `makeAttackThrow`; on a hit
    `damageTotal` goes to the one amount path. A lib `preCreateChatMessage`
    hook matches a carrier attack in flight by speaker and strips the
    apply-damage button from the stored content, stamping
    `flags.acks-extras.magicAttack`. Ruling 25 stands over ruling 9's "core's
    Apply": core's handler writes raw hit points outside `amountAfter`, the
    defenses stage and the relay. *Counter (medium):* a seat that reloads
    mid-throw leaves the entry "throw pending".
41. **A throw row takes one target and is never thrown at nothing.** Several
    targets: a Player is blocked before the spend, a Judge warned that the
    first is used. None: the card carries a Throw press. A cancelled core
    dialog after the spend leaves the entry pending with Throw. A no-throw
    cast with nothing targeted rolls once and posts; Apply takes the
    presser's targets then. Throw and Apply: the caster's owners and GMs;
    Undo: GMs.
42. **`lib/saves.mjs`: the spec is pure, the throw rolls it, the loss is the
    applier's.** `saveSpec(actor, save, {magical, conditions, situational,
    parts, values})` composes core's `rollSave` parts on the roll side and
    lib's `rollMath("save", …)` on the target side, labelled, with
    circumstance-bound rows `pending` for the Judge; `saveThrow` rolls it
    (`total >= target`). `saveThrow` never runs the loss path; the applier or
    the relay calls `loseStates`. Formation's `rollPartySave` calls it with
    `conditions: false`, unchanged. *Finding:* party saves skip conditions
    that a creature's own save applies.
43. **The cast card is `lib/roll-card.mjs`, extended; no `cast-card.hbs`.**
    Supersedes ruling 27's file name: lib DECISIONS 2026-08-11 ("One renderer
    for every card where several people roll") is in force. Optional row
    `tooltipText` and `actions`, section `titleTooltip`, card `noteTooltip`
    and `buttons` (never `.card-buttons`, which core binds); output
    byte-identical when none is given. The message flag
    `flags.acks-extras.castCard` holds the model, entries keyed
    `<tKey>_<rowKey>`, written by dotted per-entry updates; a magic render
    hook rebuilds the body per seat. *Counter (low):* core's spell card from
    `spend()` posts beside it.
44. **A caster record is written only for a timed or held cast; the relay's
    anchor is the cast card.** An instantaneous cast writes none (it would
    never end). Supersedes in part rulings 10 and 25 and cast-flow step 10.
45. **The relay is `magicCastApply`, idempotent through the message.**
    Payload `{messageId, targetKey, resist, entries: [{rowKey, rolled,
    critical}]}`; the GM's client checks the message's author is the
    requester and its `castId`, the requester owns the caster and the spell
    is the caster's, each row is in the spell's rows for the mode, `rolled`
    within `damageBounds`, the recomputed save target and success, and the
    entry not already written or in flight; it computes `amountAfter`, runs
    `adjustHp`, builds the record from the row and calls `loseStates` on a
    failed save. With no GM the entry stays pending with Apply. Undo (GM):
    `restoreHp` and the record deleted by id. *Counter (medium):* a player's
    save total is unchecked beyond the bounds and the target.
46. **Records and expiry.** `spellEffectData` gains `statuses` (at most one,
    never with changes), `rowKey`, `resist`, `sourceAlignment`, and flag
    `duration` and `startTime`; core's `duration` stays unset on a record
    with statuses or changes. A condition record is timed only where its row
    `lasts` a duration. `castRecordEnd` reads the flag first; the sweep runs
    over every world actor and unlinked token, deleting a flag-timed record
    by id and keeping the summon caster record's stamp and card.
47. **Capacity, caster level and verdicts are pure over lib's readers.**
    `castCapacity` reads `classes/casting.mjs` `poolState` for the tradition
    matching the spell's list, else core's `system.spells` minus summed
    `cast`, else unknown; the spend is `spend()` plus `adjustPool` for a
    vancian one. `casterLevel` follows ruling 6 with `{value, source,
    parts}`. `castVerdicts` blocks a Player and warns a Judge on no slot,
    several targets for a throw row, and a condition that forbids casting.
    The row editor's ruling 16 fields are lib-half work (the file is lib's),
    with `pick` on conditionRemove and `key` read-only.

S2a is then three slices: **S1c** (ruling 35), the **lib half** (36 to 43,
the row editor, `rollPartySave`), the **magic half** (`cast-rows`,
`cast-level`, `cast-capacity`, `cast-plan`, `cast-card`, `cast-apply`,
`cast-spell`, `apps/cast-dialog` with its template, `spell-effect`,
`cast-expiry`, TESTING). Not verified, to prove live: the label write
reaching core's dialog and card, the `preCreateChatMessage` strip storing
the stripped content, the carrier's identity surviving core's dialog, a GM
updating a player-authored message's flags, the sweep deleting on an
unlinked token. Rules left at their defaults (not asked of the conditions'
damage rows, no range band, core's direction modifiers offered, the mounted
rider save firing on a delivery throw) go to the owner with S2a's results.

## Data shapes

Effect row (`lib/fields.mjs` `effectField`), new keys: `saveEffect`
(`SAVE_EFFECTS` member or empty to inherit), `delivery` (none, melee,
missile), `extraordinary`, `origin`, `reversed`, `lasts` (instant, duration),
`recur` (none, eachRound), `pick` (choice-group id), `max` (LevelValue,
reserved for 1b), `unread`. Reused: `roll` (dice per instance), `value`
(instance count), `damage`, `conditions`, `healKind`, `appliesTo`.

`SpellExtras`, new: `target.hdCap`, `save.exemptBelowHd` (both LevelValue),
`save.kind` (save, attack, other).

`spellEffect` flag, new: `rows`, `duration {value, units}`, `held` (mobile,
stationary), `recipients` on the caster's record, `resist {kind, category,
total, target, success}` on a recipient's, `reversed`, `casterLevel`.

Cast card data: `{castId, spellUuid, caster, mode, casterLevel {value,
source}, rows: [{index, kind, types, extraordinary, roll {total, formula,
cite}}], targets: [{uuid, resist, perRow: [{amount, multiplier,
applied, undo}]}], pending}`.

## Bucket map

| Bucket (JJ ch. 14 axis or RR term) | Field | Phase 1 | Gap |
|---|---|---|---|
| Type | `type`, `schools` | shown | none |
| Effects | `effects[]` | ruling 9 roller, `hp.mjs`, status records, modifiers read at their roll | `max` reserved; readers in slice 5 |
| Targeting | `target.model`, `count`, `area`, `filters` | targeted tokens, HD cap per target | `hdCap` new; templates later |
| Attack required | `delivery` | magic throw | new key |
| Range | `range` | player blocked, Judge warned | none |
| Duration | `duration` | flag-held duration, expiry fan-out by `castId` | combat rounds do not age a record |
| Concentration | `duration.shape`, `concentration` | status, loss, end card | `castDuration` change |
| Until a save ends it | `recur` | prompt card | slice 3 |
| Casting time | `castingTime`, lib's `casting` condition | declared, lost to damage or a failed save, resolved on the caster's turn | rituals later |
| Saving throw | `save`, `saveEffect` | typed resist in the card | `save.kind` new |
| Save modifiers | `save.modifier` | per-row toggle | none |
| Stacking | statuses, `stacksWith`, `notStacksWith`, `provides` | records separate; a condition held or not; a figure applied once, the larger, non-stacking the default between spell records | none (owner ruling 2) |
| Source | `lists[].source` | tradition to caster level | 1b factors |
| Level | `lists[].level` | core's spend | slot caps later |
| Spells per day | the class tradition's slots or pool, core's `system.cast` | checked before confirm, spent at confirm (ruling 17) | repertoire caps later |
| Caster abilities | `spellcastingMod`, `spellLike`, `casterLevelDelta`, `school` | matched at cast, named in tooltips (ruling 18) | inventory, then a ruling |
| Damage against defenses | `extras.defenses` | the seam between roll and `adjustHp` | built in 1b (owner ruling 4) |
| Reversal | `reversible`, `reversed` | dialog mode | none |
| Choice at cast | `pick` | dialog | none |
| Triggered start, beholding and earshot, the perpetual cap, dispelling, targeting the dead, signatures | none or tracked | none | later phases |

## The cast flow

1. `item.use()` reaches lib's `_useSpell` wrapper; the summon claimant
   declines; `castSpell` claims, synchronously (casting seat).
2. `rowsOf(spell)`: own rows, else the twin's.
3. Caster level by ruling 6.
4. Dialog: mode, picks, level if needed, the target list, the range verdict,
   a concentration warning, the capacity verdict (ruling 17). Cancel spends
   nothing.
5. `spend()` and the tradition's pool, once.
6. Resist rolls per target: HD gate, then `saveThrow`, or `makeAttackThrow`
   with magic for a row with a delivery; the result is kept.
7. Rolls for rows with no throw (`magicDamageSpec`), and heals.
8. Application, where the seat had tokens targeted (owner ruling 3): each
   amount through the save's fraction, the printed rounding and the
   defenses seam to `adjustHp`, and each recipient's record; a target the
   seat does not own goes to the GM's client, checked against the caster's
   spell item, and falls back to a press with no GM connected.
9. The cast card (`lib/roll-card.mjs`): a row per target with what was
   applied, an undo for the Judge, Apply for what is still pending (nothing
   targeted, no GM), a tooltip on every figure.
10. The caster's record: `spellEffectData`, role caster, the flag duration,
   `held`, the recipient list.
11. Apply, on a press, for what step 8 left pending: the same path, the
    same relay.
12. Expiry: the GM window's sweep covers every actor and unlinked token
    actor's caster records and fans out by `castId`.
13. Concentration lost: lib's loss path, the end card, the End press.

## Not verified, to prove before it is built on

- A transient weapon item prepares its damage data and passes core's
  builder. Prove it live first in slice 2; the fallback is the no-throw path
  plus a throw rolled through lib's seam.
- `toggleStatusEffect` off deletes a record that carries only that status.
- Core's visibility stripping reaches a module card.
- A runtime label for the magic attack type passes validate's namespacing.
- Against the printed page, through `.claude/rules/rules-lookup.md`, before
  slice 2's arithmetic: whether halved spell damage rounds as core's
  `applyDamage` does, whether a critical changes spell dice, whether a
  minimum-damage floor applies, whether an area's damage is one roll or one
  per target, whether a general stacking rule is printed (the oracle
  search found none), whether a declaration lost to damage spends the
  spell, and whether a spell not declared may be cast in a fight at all.
- The level 1 matrix is one reading pass over the fan oracle, and the
  register structure authored from it ships. Each authored row's structure
  is checked against the printed page before its batch is committed; that
  is an acceptance of every batch below.
- Authoring a `summon` row on a spell makes `isSummonSpell` true, and the
  summon claimant then takes the whole cast. The matrix gives five rows a
  summon kind and three of them are the built summoning spells. Session 1d
  rules, per remaining row, whether it is a summoning spell or carries
  another kind.

## Phase 1: level 1, in four sessions

Agent routing, set per slice and named in every brief: `scout` (haiku)
enumerates; `implementer` (sonnet, no model override) applies a scoped change
against acceptance criteria; `architect` (opus) rules when a slice meets a
design question this file does not answer; `doc-scribe` (haiku) writes
changelog fragments, guide and gallery rows. Live walks are driven by the
session itself through `tools/live`; the `live-tester` agent is not used.
One slice, one agent. Register authoring is `implementer` work against the
shelf's matrix, and its brief carries the leak guard above.

Before any agent writes under `scripts/lib/`, the session lists the running
sessions, reads their latest turns and `main`'s dirty paths, and says in one
line what it found. A world relaunch asks who is seated first.

**The work is on a topic branch** (owner, 2026-11-15: "When ready, start
this work as a new branch"): `topic/spell-effects`, in the sibling worktree
`foundryvtt-acks-extras.spell-effects`, opened with `acks-branch`. One
session writes there at a time and commits by hand; the pre-commit IP
quarantine still runs. The worktree has no Foundry junction, so a slice's
live walk cannot run from it. A session builds its slices to an offline
green on the branch, lands the branch with `branch.mjs land`, walks live on
`main`, and commits what the walk finds on `main` with `acks-commit`
(`.claude/rules/shared-tree.md`, "Topic and parked branches"). The next
session rebases by landing, or reopens the branch if the last one closed it.
A slice is not reported built until its walk has run on `main`. Nothing is
pushed without the owner's word, and a topic branch is never pushed.

Every slice: an offline suite on invented spells on the branch, then, after
the landing, a walk from content imported from the seat's own PDF.

**Session 1a: the channel and the vertical engine.**

- *S1, importer channel* (`implementer`): `lib/fields.mjs`,
  `magic/spell-extras.mjs`, `importer/executor.mjs` (new locatable kinds,
  `onMiss`, `unread`), `importer/cookbook/variations.mjs` `bindSpell`,
  `importer/refresh.mjs` (merge by `origin`),
  `tools/importer/lint-register.mjs`, the importer DECISIONS entry, and
  register rows for `def.spell.desiccate`, `def.spell.cureLightInjury`,
  `def.spell.frightenHumanoid`, `def.spell.holyCircle`,
  `def.spell.sharpness`. *Accept:* invented
  spells materialize, go blank on a miss and survive a repair by origin; an
  import from the PDF shows the five spells' rows with their figures.
- *S2, vertical engine* (`implementer` twice, lib then magic). Lib: the
  magic type in `patches/attack-throw.mjs`, a contributor that reads a
  wielder's cast records for a weapon's bonus, `lib/saves.mjs`, the loss
  export, what the concentration rows are lost to, and a lib ROADMAP row
  for damage against defenses. Magic: `cast-spell.mjs`,
  `apps/cast-dialog.mjs`, `templates/magic/cast-card.hbs`, changes to
  `spell-effect.mjs`, `cast-duration.mjs`, `cast-expiry.mjs`, the row
  editor's fields for these four kinds, and the TESTING recipe with its
  walk. *Accept, live:* `def.spell.desiccate` at several targeted tokens posts a
  typed save per target and applies at the cast the amount each save leaves,
  a half rounded as printed, with its type shown, and the Judge's undo
  restores it; cast with nothing targeted it posts the rolls and an Apply;
  the reversed `def.spell.cureLightInjury` throws through core's card as
  magic with no melee modifier on the damage; `def.spell.frightenHumanoid`
  cast twice on one target leaves one condition and two records, and the
  condition stays when the first ends; `def.spell.holyCircle` loses
  concentration on damage and raises the end card; `def.spell.sharpness` on
  a recipient's weapon puts its figure on that weapon's attack throw and
  damage with a tooltip naming the spell; cast twice on that weapon it leaves
  two records and one figure, which stays when the first record ends and is
  gone when the second does; beside the masterwork source its printed
  clause names the two resolve through `resolveStacking`; in a started fight a caster declared and then
  hurt before their turn has lost the declaration, and a Player seat's cast
  is refused; a core monster's attack item still posts core's card; a Player
  seat casts its own spell at a targeted actor it does not own and the GM's
  client applies it, and with no slot left on its tradition the Player's
  cast is refused while the Judge's is warned.
- *Exit point.* S1 and the "Not verified" items come first. If they fill
  the session, it stops there, writes S2's start prompt under its results
  and puts S2 up as the next card.

**Session 1b: widening.** *S3* (`implementer`): recurring rows and their
prompts, several instances per cast, picks, HD gates, range checks, the rest
of the row editor, and (owner ruling 4) damage against
defenses in lib (an `architect` ruling first: where the fractions are
imported from, and the one place an amount is reduced). Rows: `def.spell.blindingFlash`, `def.spell.thunderclap`,
`def.spell.fanOfFlames`, `def.spell.earthsExcrescence`,
`def.spell.kindleFlame`, `def.spell.chokingGrip`, `def.spell.mageMissile`,
`def.spell.slicingBlow`, `def.spell.slingStone`, `def.spell.frightenBeast`.

**Session 1c: saves, conditions and buffs.** *S4* (`scout`, then
`implementer`): `def.spell.beguileHumanoid`, `def.spell.infuriateBeast`,
`def.spell.infuriateHumanoid`, `def.spell.slumber`,
`def.spell.wordOfCommand`, `def.spell.removeFear`, `def.spell.destroyDead`,
`def.spell.shatterBlade`, `def.spell.sanctuary`, `def.spell.salvingRest`.
*S5:* `def.spell.allure`, `def.spell.arcaneArmor`, `def.spell.baneRune`,
`def.spell.chameleon`, `def.spell.leaping`, `def.spell.passWithoutTrace`,
`def.spell.sharpness` (built in S2; its row is checked here),
`def.spell.silentStep`, `def.spell.spiderClimbing`, `def.spell.slickness`.
S5 opens with an `architect` ruling on the readers ruling 10 lists: the
abilities roller and influence reading a cast record, an armour class set
by the kind of attack, a save changed under a condition. *Accept, each
row:* the figure reaches the roll it changes, with a tooltip naming the
spell; it is gone when the record ends; a second spell record of the same
kind leaves one figure, the larger, which stays until the last record ends
(owner ruling 2).

**Session 1d: tracked kinds and the close.** *S6:*
`def.spell.angelicChoir`, `def.spell.auditoryIllusion`,
`def.spell.illusoryFigment`, `def.spell.discernEvil`,
`def.spell.discernGist`, `def.spell.discernMagic`,
`def.spell.discernPoison`, `def.spell.locateAnimalOrPlant`,
`def.spell.predictWeather`, `def.spell.illumination`. *S7:*
`def.spell.counterspell`, `def.spell.delayDisease`, `def.spell.iceFloe`,
`def.spell.purifyFoodAndWater`, `def.spell.sealPortal`,
`def.spell.wallOfSmoke`, `def.spell.weaveSmoke`,
`def.spell.faithfulCompanion`, `def.spell.unlivingPuppet`, and a check of
the three built summons' rows (`def.spell.callOfTheWolf`,
`def.spell.conjureCacodemonSpawn`, `def.spell.summonManes`). Then
`doc-scribe`: fragments, the guide, the gallery row shot from an imported
spell. The substance of this file moves into MODEL, DECISIONS, ROADMAP and
TESTING, and the owner is asked which release kind level 1 ships as.

## Later phases

Levels 2 to 6, one phase each, planned from that level's own matrix: standing
modifiers through `standingModifiers` with spell records as sources, damage
per level with `max`, dispel and counterspell throws, area templates,
detection results, beholding and earshot warnings, the perpetual cap,
triggered starts, transform and teleport executors, and damage against
defenses (lib). Rituals come with research (ROADMAP part 5).

## Start prompt, session 1a

> Run session 1a of `docs/magic/wip/20261115-spell-effects-plan.md` in
> `C:\Proj\foundryvtt-acks-extras`: slices S1 and S2, the importer channel
> for spell effect rows and the vertical cast engine, for the five spells the
> plan names, with the exit point the plan gives. Read the plan whole first, then `docs/magic/MODEL.md`,
> `.claude/rules/ip-doctrine.md` and `.claude/rules/live-testing.md`. You are
> the orchestrator: brief one agent per slice with the routing the plan
> gives, quote the owner's words from the plan in every brief, review each
> agent's change against the IP doctrine yourself, and drive the live walk
> yourself. Settle the plan's "Not verified" list before the code that leans
> on each item. The level 1 matrix is on the rules shelf beside the magic
> extract (`L1-EFFECTS.md`); it is LOCAL-ONLY. Proceed on the owner
> questions' recommended answers. You work in the worktree
> `C:\Proj\foundryvtt-acks-extras.spell-effects` on `topic/spell-effects`,
> as the plan's branch paragraph says: commit each finished slice there by
> hand, land it, walk on `main`; push nothing. Finish by appending a "Results, 1a" section to
> the plan (what was built, walked and not walked, by sha), writing the
> session 1b start prompt under it, and reporting to the owner. You start no session;
> put the next one up as a card.

## Results

### Results, 1a (2026-11-15)

Session 1a took the exit point: S1 and the "Not verified" list filled it,
and S2 is not started. S2 is split (ruling 27) and S2a is the next card.

**Built.** `573a42ac` (docs: owner rulings 1 to 4, rulings 17 to 27, the
bucket map and cast flow they change) and `58f009c3` (S1, the importer
channel and the five spells' register rows), written on `topic/spell-effects`
and landed on `main` above `ab0f921a`. The walk, `tools/live/magic-spell-recipes.mjs`,
and its recipe, `docs/magic/TESTING.md` "Spell effect rows (the recipe
channel)", are committed on `main` beside this section. Nothing is pushed;
the topic branch stays open for S2a.

**Exercised live** (GM seat, on `main`'s junction after the landing):

- `node tools/live/run.mjs magic-spell-recipes`: "passed (21 pass, 0 fail,
  exit 0)". The Spells repair writes each of the five spells' recipe row
  kinds in order, all `origin: "register"`; every damage and heal row has its
  dice, every damage row one type, every modifier row its figure; save
  categories, area sizes and creature filters read; the only `unread` field
  is `extraordinary`. A Judge's own row survives a repair with the register
  rows replaced, not doubled. An Overview submit keeps `origin`, `unread`,
  `extraordinary`, `saveEffect`, `lasts` and `delivery`. A row-editor change
  clears `origin` and a repair keeps the row. Teardown left desiccate with
  register rows only.
- The three runtime probes of the "Not verified" list, each swept by id: a
  transient unsaved weapon parented to an actor prepares its damage, passes
  `makeAttackThrow` and posts core's card without being persisted;
  `toggleStatusEffect` off deletes every effect holding only that status,
  one carrying changes beside it included (ruling 20); core's `renderHTML`
  strips `[data-acks-visibility]` on a module card per seat.

**Offline only:** `tools/importer/lint-register.mjs` green; `npm test` 229
suites green, `test-spell-recipes` (16 tests, invented spells) among them;
`npm run validate` green with no drift; the cookbook recompile kept its
entry count with no mismatches; the local rules test (gitignored) reads every
figure of the five from the RR but the extraordinary mark. The "Not verified"
rules items were settled by lookup and spot-check, and their answers are
rulings 21 to 24. The runtime label for the magic type is unverified against
validate: validate scans globals, hooks, helpers and lang keys, not a runtime
write, so S2a confirms it when it writes one.

The console at `init`, `setup` and `ready`: the GM client reloaded under a
recorder registered before the document loaded (it ran before Foundry's
scripts) logged no error and no warning through `ready` and the RR's
opening. The walk's teardown was narrowed to its own marked rows and run
again green.

**Not checked:** the Player seat (S1 has no player surface); any cast (S2).

**Findings, for S2a or 1b to rule:**

- The extraordinary mark is unread on every printed row: the PDF prints it as
  the damage glyph's fill colour, which the text op does not read. The field
  stays null and is listed in `unread`, as `onMiss: "blank"` intends.
- An edited register row plus a repair leaves two rows: the edited one,
  now the Judge's, and a fresh register row beside it (seen live: two
  register rows, four in all, on desiccate). A deleted register row also
  returns on a repair, and `values` fields carry no origin, so a Judge's
  edit to the primitive is overwritten. Whether a repair should skip a row
  the Judge has taken over needs a ruling before S3 widens the rows.
- `target.area.size` carries no unit and no shape of measure: one spell's
  figure is a diameter and another's a radius. S2a's area handling needs one
  before it draws or counts.
- Holy circle's bonus rows are scoped by the caster's own alignment, which
  no fixed `vsAlignment` key expresses; the rows ship unscoped.

**Owner questions** (asked here, answered by message 8, read as rulings 28
to 31): is an area spell's damage one roll for every target, or one per
target; does save-halved damage with no throw have a floor; do spell attack
throws use core's criticals; does the end of concentration also end the
recipients' records? Message 8 also answered the area-size and alignment
findings above (rulings 32 and 33), and session 1a built them as S1b.

### Results, S1b (2026-11-15)

**Built.** `92dce2ae` (docs: message 8, rulings 28 to 34) on `main`, and
`603b8ea3` (S1b: the caster-relative, disjunctive and enemy scopes, the lib
alignment, kinds and enemy readers, the area measure, holy circle's scoped
rows and twins, the walk's steps 5 to 7), written on `topic/spell-effects`
and landed above `a0995bb4`. The walk's two check fixes and the recipe's
drive mechanics are committed on `main` beside this section. Nothing is
pushed; the topic stays open for S2a.

**Exercised live** (GM seat, `main`'s junction, after the landing):

- The GM client reloaded under a recorder registered before the document
  loaded: no error and no warning through `ready` and the RR's opening.
- `node tools/live/run.mjs magic-spell-recipes`: "passed (31 pass, 0 fail,
  exit 0)". Beside 1a's 21 observables: holy circle's two wards scoped to one
  kind token, one reversed; its four bonus rows carry an `anyOf` of two
  branches and no `condition`, two reversed; desiccate's measure a diameter
  and holy circle's a radius; the Overview's extent reads a figure and its
  tooltip names its parts; `scopeApplies` on the three kept fixtures answers
  applies for the chaotic undead, fails for the ally and undetermined for the
  neutral token; a row-editor submit keeps the `anyOf` and clears `origin`,
  and the editor shows it. Fixtures, reused by marker:
  `magic/scope-chaotic-undead`, `magic/scope-ally-caster`,
  `magic/scope-neutral-token` (built by the run before, kept).
- The first run failed three checks, all the walk's own: a monster is created
  hostile whatever its data names (the step now sets the disposition it
  reads), and a submit fills an `anyOf` branch's unset fields with their
  initial values, which `scopeApplies` reads as unset (the step now compares
  with them dropped). No runtime change followed.

**Offline only:** test-lib 240, test-magic 78, test-spell-recipes 20 (229
suites); register lint (2525 entries); validate green; the cookbook at 2416
entries; a mutation of the branch rule caught by test-lib; the local rules
test reads holy circle's radius and rows and desiccate's size.

**Not checked:** the Player seat; the scopes evaluated against an attacker in
a roll (S2b); the Overview submit path on a spell with an `anyOf` row beyond
the row editor's.

**Findings:**

- `influence/ability-effects.mjs` copies three scope keys from an ability
  row, so a row with `anyOf`, `vsAlignmentOf` or `vsEnemy` reaches
  `scopeApplies` unscoped there. No imported row carries one today; the
  session that first authors such an ability row fixes it.
- `classifyAlignment` now reads "None" and a two-letter abbreviation as no
  alignment, where the first-letter reader called them one (lib DECISIONS,
  2026-11-15).
- `modifierDisposition` answers unsupported for an area or recipient subject
  before it tests any scope (ruling 34's finding, for S2b).

**Owner question:** the reverse's second branch names incarnations of the
lawful alignment, the print's one example. Do lawful undead count too
(default no, as shipped)?

### Start prompt, session S2a

> Run slice S2a of `docs/magic/wip/20261115-spell-effects-plan.md` in
> `C:\Proj\foundryvtt-acks-extras`: the vertical cast engine's first half,
> lib then magic, for `def.spell.desiccate`, `def.spell.cureLightInjury`
> and `def.spell.frightenHumanoid`, with the files and live acceptance
> ruling 27 gives S2a, as rulings 28 to 31 amend them. Read the plan whole
> first (its owner rulings 1 to 4, rulings 17 to 34, "Results, 1a" and
> "Results, S1b"), then `docs/magic/MODEL.md`,
> `docs/lib` where the plan names a seam, `.claude/rules/ip-doctrine.md` and
> `.claude/rules/live-testing.md`. You are the orchestrator: one
> `implementer` for the lib half and a fresh one for the magic half, each
> brief quoting the owner's words from the plan and each report restating
> them with one example; an `architect` for any design question the plan
> does not answer, first among them whether a repair skips a register row
> the Judge has taken over ("Results, 1a"). Review each
> change against the IP doctrine yourself: committed tests use invented
> spells. Before an agent writes under `scripts/lib/`, list the running
> sessions and `main`'s dirty paths. You work in the worktree
> `C:\Proj\foundryvtt-acks-extras.spell-effects` on `topic/spell-effects`:
> `node .claude/skills/acks-branch/branch.mjs sync spell-effects` there
> first, commit by hand, land with
> `branch.mjs land spell-effects`, walk on `main` yourself through
> `tools/live` (never the `live-tester` agent), and check who is seated
> before a world relaunch. Push nothing. Finish by appending "Results, S2a"
> to the plan (by sha, sorted exercised live / offline only / not checked),
> writing the S2b start prompt under it, and reporting to the owner. You
> start no session; put the next one up as a card.

### Results, S2a (2026-11-16)

S2a is built and walked on `main`. The architect's rulings 35 to 47 (above)
split it into three slices, each built on `topic/spell-effects` by its own
`implementer` and landed; the topic stays open for S2b. Nothing is pushed.

**Built.** `c626bb8b` (docs: rulings 35 to 47); `21a4c248` (S1c, ruling 35:
register row keys, a repair that holds a Judge's edited or deleted row and
edited `values` leaf); `c1057d38` (lib half: the carrier and the "magic"
type, the contributor opt-in, `magicDamageSpec`, the card strip and label,
`lib/saves.mjs`, `amountAfter`, `loseStates`, the roll card's actions, the
row editor's cast fields, gated to a spell's rows); `5f166d35` (walk find,
on `main`: a returning register row takes its recipe place, and the recipe
walk checks S1c live); `f6c4ad98` (magic half: the claimant, dialog, cast
card, relay, capacity, records, expiry over unlinked tokens, the
`castSummons` adoption the summons-in-formation session asked for, the
"Casting a spell" recipe and walk `magic-cast-spell`). The walk's own fixes
and this section are committed on `main` beside it.

**Exercised live** (GM and Player seats, `main`'s junction, nobody else
seated):

- A probe before the magic half: `ACKS.throw.attackType.magic` localizes; a
  carrier passed to core's `makeAttackThrow` keeps its identity through
  core's builder, the stored card carries no apply button and the
  `magicAttack` stamp, no Strength row, and the carrier is never saved.
- `magic-cast-spell`: "passed (44 pass, 0 fail, exit 0)". Both seats
  reloaded under a recorder attached before Foundry's scripts: no error from
  the load through the walk. Desiccate at three targeted tokens: one damage
  roll, each target's save, each applied amount the roll through its save's
  fraction and one half-to-even rounding, decisive this run (two saved
  entries rolled one more than a multiple of four and went down), hit points
  down by exactly that, the type on the card, one spend of the cast count
  and the tradition's slot, a tooltip on every figure, no system button,
  Undo on each entry that wrote something, Undo restoring every target. Cast
  with nothing targeted: the roll posts, nothing moves, Apply takes the
  presser's two targets and leaves the third. The reversed cure: the form
  offered, core's attack card posted as magic with no apply button and the
  cast's mark, the hit's damage applied through the amount path; thrown at
  nothing, a Throw press. The plain cure heals through `adjustHp`.
  Frighten twice on one target: two status-only records, flag-timed with
  core's duration unset, one condition; the clock ends the first and the
  condition stays, the second's end takes it off. A monster's attack item
  posts core's card with no cast dialog. The Player casts at a GM-owned
  token and the GM's client applies. No slot left: the Player's Cast is off
  with the verdict shown and a cancel spends nothing; the Judge's dialog
  warns and leaves Cast on. Fixtures kept, by marker: `magic/cast-scene`,
  `magic/cast-class`, `magic/cast-caster`, `magic/cast-spell-damage`,
  `magic/cast-spell-cure`, `magic/cast-spell-fright`,
  `magic/cast-target-a`, `-b`, `-c`, `magic/cast-monster`,
  `magic/cast-monster-weapon`; the run's cards and tokens swept by id, none
  missing, none refused.
- `magic-spell-recipes`: "passed (36 pass, 0 fail, exit 0)", with S1c's
  checks: an edited row keeps its key and stands in, no fresh row beside it,
  a covering edit held as nothing; a register row deleted from the Mechanics
  tab is retired and a repair keeps it away and lists it held.
- Regressions on the seams the lib half touched: `equipment-ability-training`
  passed (16), `typed-modifiers` passed (76, on a rerun: its first start
  never got a browser), `formation-day` passed (185, the party save among
  its steps).

**Walk finds, fixed on `main`:** the merge put a returning register row at
the first stamped row's place (holy circle came back out of order, and a
repair keeps a stamped row where it stands); a repair lists held edits only
with a `decision` in its tally; core 14 targets through
`canvas.tokens.setTargets`; the Undo check counted damage entries only, and
the rounding check could pass on a roll where the two roundings agree.

**Offline only:** `npm test` 235 suites, validate green, test-magic-cast 34
and test-spell-carrier 17 and test-saves 10 and test-roll-card 8 on invented
spells; the relay's refusals (author, owner, spell, target, resist, row,
already applied, amount out of bounds) and the in-flight claim; the summon
expiry with a non-empty `held`; ability rows offered no cast field.

**Not checked:** a Player's cast with no GM connected (the entry pending
with Apply); a missile delivery and its range band (no S2a row has one); a
points pool's spend (shown, not spent); a summon held in a party at expiry
(`held` is empty until the summons-in-formation provider ships); a
two-handed or several-weapon carrier; Dice So Nice under rigged dice; the
guide and a release shot (S7 closes them).

**Defaults proceeded on, for the owner:**

1. Lawful undead do not count for holy circle's reverse (as shipped in S1b).
2. A cast card's Throw and Apply are pressed by the caster's owners and GMs,
   Undo by GMs alone (ruling 41).
3. A save whose effect is partial or special is left to the Judge: no
   fraction, the entry marked for the Judge.
4. A spell's damage is not asked of the conditions' damage rows; a missile
   delivery takes no range band; core's direction modifiers are offered on
   a touch throw; the mounted rider's save fires on a delivery throw like
   any attack (ruling 37's counter and the architect's rules list).

**Findings:** a party's save skips the conditions a creature's own save
applies (formation's behaviour, kept unchanged); a Judge's edit to a
stat-block field outside `values` (range, duration) is still overwritten by
a repair; a cast posts two cards, core's spell card from `spend()` and the
cast card.

### Start prompt, session S2b

> Run slice S2b of `docs/magic/wip/20261115-spell-effects-plan.md` in
> `C:\Proj\foundryvtt-acks-extras`: the vertical cast engine's second half,
> lib then magic, for `def.spell.holyCircle` and `def.spell.sharpness`, with
> the files and live acceptance ruling 27 gives S2b as rulings 31 and 35 to
> 47 amend them: lib — the concentration rows' `lost`, the roll-mods flag and
> its contributor (ruling 19), `registerItemBonusSource`, the gates
> `weaponMundane` and `weaponMagical`, and ruling 34's finding that
> `modifierDisposition` answers unsupported for an area or recipient subject
> before it tests a scope; magic — the declaration (ruling 23, on lib's
> `STATES_LOST_HOOK`), held records and concentration's end ending that
> cast's recipient records with one card and a Judge's Restore (ruling 31),
> the weapon pick, equipment's masterwork registration; the scopes
> evaluated against an attacker at the roll. Read the plan whole first (owner
> rulings 1 to 4, rulings 17 to 47, the Results sections), then
> `docs/magic/MODEL.md` "Casting a spell", `docs/lib` where the plan names a
> seam, `.claude/rules/ip-doctrine.md` and `.claude/rules/live-testing.md`.
> You are the orchestrator: one `implementer` for the lib half and a fresh
> one for the magic half, each brief quoting the owner's words from the plan
> and each report restating them with one example; an `architect` for any
> design question the plan does not answer. Review each change against the
> IP doctrine yourself: committed tests use invented spells. Before an agent
> writes under `scripts/lib/`, list the running sessions and `main`'s dirty
> paths. You work in the worktree
> `C:\Proj\foundryvtt-acks-extras.spell-effects` on `topic/spell-effects`:
> `node .claude/skills/acks-branch/branch.mjs sync spell-effects` there
> first, commit by hand, land with `branch.mjs land spell-effects`, walk on
> `main` yourself through `tools/live` (never the `live-tester` agent):
> extend `magic-cast-spell` (its fixtures are kept by marker) and rerun it
> and `magic-spell-recipes`, and check who is seated before a world
> relaunch. Push nothing. Finish by appending "Results, S2b" to the plan (by
> sha, sorted exercised live / offline only / not checked, with the defaults
> you proceeded on), writing the session 1b start prompt under it,
> committing that on `main` with `acks-commit`, and reporting. You start no
> session; the managing session starts the next one from your prompt.
