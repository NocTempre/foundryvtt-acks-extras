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

## S2b rulings (the S2b session's architect, 2026-11-16)

Ruled on the questions the plan left open for S2b, against source in the
worktree (`topic/spell-effects` at f865da0e) and core's `src/`. Each keeps
its rejected alternative and counter. Tests use invented spells only.

48. **`modifierDisposition` reads a spell row on its bearer by opt-in.**
    `modifierDisposition(spec, {actorType, bearer = false})`: with `bearer`, a
    `target`, `recipient` or `area` subject reads as `self`, and the
    actor-type refusal waits until the at-the-roll answers are tried, so a
    monster recipient's scoped or item-gated row answers `atRoll`. A gate
    registered `at: "item"` answers `atRoll`, reason `item`, right after the
    roll-gate test. Without `bearer` every existing answer is unchanged, and
    the existing suites prove it untouched. Settles ruling 34's finding.
    *Rejected:* testing the scope before the subject (changes pinned answers
    for an `ally` row); a separate spell classifier. *Counter (low):* a second
    option on a function that already branches on actor type.
49. **`weaponMundane` and `weaponMagical` are item gates.**
    `registerGate(kind, fn, {at: "item"})` keeps its own set (`isItemGate`);
    such a row never reaches `rollGatedModifiers` or `roll-gates.mjs`. Each
    reads `ctx.item` alone through `isMagical` and answers null with no item,
    so a second cast never makes a weapon count as magic (ruling 19).
    *Rejected:* `at: "roll"` (the light contributor would ask it with no
    item). *Counter (low):* a third gate timing for two kinds.
50. **A buff rides lib's flag `flags["acks-extras"].rollMods` on an effect:
    `{id, label, cite, sourceAlignment, parts}`.** A part is `{key, on, value,
    itemId, gate, stacksWith, notStacksWith, provides}` plus the scope fields;
    `on` is `attack`, `damage`, `ac`, `save` or `ward` (a ward is told, never
    added). Only a row `modifierDisposition(row, {bearer: true})` answers
    `atRoll` becomes a part; a standing row stays a card line. Magic writes it
    with figures resolved at cast, a blank figure writing none. Every spell
    part provides magic's `kw:spellrecord`, so two spell records never add
    (owner ruling 2); `id` is the spell's definition id, so a printed
    `stacksWith` naming another spell matches. *Rejected:* the record's
    `changes` (no such field is writable); a magic-owned reader. *Counter
    (medium):* a traded weapon leaves its buff with the old holder.
51. **One builder makes every stacking part; each field resolves alone.**
    `typed-modifiers.mjs` exports `capabilitiesOf` and `stackingPart`, the only
    way to build a part (`resolveStacking`'s `conflicts` throws on a bare one,
    and `ask()` swallows a contributor's throw). Resolution runs per `on`, item
    parts first; on a tie the item's figure stands and no row is added; a zero
    item part is left out. *Rejected:* one resolution across fields.
    *Counter (low):* a tie keeps the source already in core's rows; the card
    says which yielded.
52. **Lib's contributor puts the attacker's buff on its weapon's rolls.**
    `roll-mods.mjs`, `carriers: ["attack"]`, installed after the roll gates.
    For `attack` and `damage` it reads the attacker's parts whose `itemId` is
    the weapon's (or names none), whose item gate answers true and whose scope
    applies against the target, resolves them with `itemBonusParts(item, on)`
    from `registerItemBonusSource(source)`, and answers: a kept spell part as
    a row labelled `{name} ({cite})` (core's dice tooltip lists it: the
    tooltip naming the spell); a dropped item part as a row of minus its
    figure, labelled yielding; a dropped spell part or an undetermined scope
    told once per attack. *Rejected:* adding beside core's bonus; writing
    `system.bonus`. *Counter (medium):* a Judge's hand edit of
    `system.bonus.attack` is invisible to the source.
53. **A recipient's AC and ward parts are read on the attack against it.** The
    target's `ac` parts are scoped against the attacker (`creatureKinds`,
    `actorAlignment`, the record's `sourceAlignment`, `areEnemies` of the
    attacker's token and the bearer's): applies → a term of minus the figure
    labelled as the target's, resolved among themselves; undetermined → told,
    nothing added; fails → nothing. A ward part that applies or is
    undetermined is told on the attacking seat, never refused. `vsEnemy`
    reads the bearer's side, and `scopeApplies`' docstring and API "Scoping"
    say so. *Rejected:* the caster's token (an unlinked caster may have none);
    refusing a Player's attack. *Counter (medium):* where the print means the
    caster's enemy, a circle around a hostile bearer reads the wrong side.
54. **A save against a source reads the saver's scoped save parts.**
    `saveSpec(…, {against: {actor, token}, bearerToken, rollMods =
    conditions})`: an applying part is a target part labelled as its spell;
    undetermined or no `against` goes to `pending`. Formation's party save is
    unchanged. The cast passes its caster and token (`casterTokenUuid` on the
    card) and the relay the same, so the recomputed target matches. Core's
    own `rollSave` (`onRollSave`, its one owner) adds no scoped part and tells
    it. *Rejected:* adjusting in magic after `saveSpec`. *Counter (medium):* a
    sheet save never gets the figure; the notice is the Judge's cue.
55. **Concentration is lost to damage and a failed save, and the loss names
    its cause while it lifts.** Both rows gain `lost: HURT_OR_FAILED`;
    `loseStates` holds `{cause, ids}` across `lift`, read by
    `lossInFlight(actor)` from the delete hook on the same client.
    *Rejected:* firing `STATES_LOST_HOOK` before `lift`. *Counter (low):* a
    status lifted any other way carries no cause; the card reads "Removed".
56. **`castDuration` answers a concentration shape `{none: "untimed", held,
    cap?, tail?}`** (ruling 11): `held` from `duration.concentration`,
    `mobile` when blank; `cap` for `concentrationMax` (times the level where
    `maxPerLevel`, `{none: "noLevel"}` with none); `tail` for
    `concentrationPlus`. `levelNeeded` asks for a level where `maxPerLevel`.
57. **Records of a held cast and of a buff.** `spellEffectData` gains `held`,
    `tail`, `item`, `pending`, `rollMods`. A held cast writes a status-only
    caster record (`concentrating` or `concentratingStationary`), flag-timed by
    `cap`. A cast's modifier and ward rows for one recipient are one record,
    free of statuses and changes, carrying `rollMods` and a `startTime`, timed
    only where the cast is timed; its entries are one group, applied in one
    request. Recipient records are found by `castId`; the caster record keeps
    no list (two relays would race it). Supersedes "Data shapes" `recipients`
    and cast-flow step 10's list. *Rejected:* a record per row (owner ruling
    2's example counts two records for two casts). *Counter (medium):* Undo of
    one modifier entry takes the cast's others off that target; the tooltip
    says so.
58. **An area keeps ruling 7: the seat targets every token, its own
    included;** nothing adds the caster. *Counter (medium):* a seat that
    forgets its own token leaves its caster outside its circle; the card names
    who got a record.
59. **Concentration's end is one funnel, driven by the client that deleted the
    record** (supersedes in part ruling 31's "the primary GM's client", on
    new evidence: the cause exists only on the deleting client, and
    `STATES_LOST_HOOK` fires after the delete, locally, and misses the HUD
    toggle, a hand delete, a recast and the cap). Magic's `deleteActiveEffect`
    hook acts on a held caster record when `userId` is this user's; the cause
    is magic's own `endCause` (`cast`, `time`), else `lossInFlight`'s
    (`damage`, `save`), else `removed`. That client ends the recipient records
    it can write and sends the rest through `magicHeldEnd` to the GM's client,
    which accepts only when the requester owns the caster and no held caster
    record of the cast remains; with no GM they stay, listed with End. No tail:
    deleted by id; a tail: re-timed from now; a tail of `none`: kept and
    listed. One card (flag `castHeldEnd`), whispered to the GMs and the
    caster's owners, holds the cause and each record's data; Restore (GMs)
    recreates them with `keepId` and undoes a re-timing; End deletes one by id.
    *Counter (medium):* a seat that disconnects mid-funnel leaves recipients
    standing with no card.
60. **A cast or declaration through the module ends the caster's
    concentration at its spend.** Verdict `concentrating` warns on both seats;
    after the spend the held records are deleted by id with `endCause:
    "cast"`. *Counter (medium):* a cast outside the module ends nothing (lib
    ROADMAP row).
61. **The declaration (ruling 23), built.** `castMoment({combat, combatant})`
    answers `free`, `resolve` (the caster's turn, initiative rolled) or
    `declare`. Declare: capacity checked and spent once, concentration ended,
    a status-only `casting` record, a status-free pending record
    (`pending {spellUuid, mode, picks, casterLevel, situational, visibility,
    item, combatId, at}`), `acks.prepareSpell` set, no card. Magic's
    `STATES_LOST_HOOK` listener stamps the caster's pending records `lost` and
    clears the flag. On the turn an unstamped record resolves with its stored
    answers and the seat's current targets, with no dialog, capacity check or
    spend (the dialog only where a stored weapon no longer fits). A stamped
    record → `declarationLost`, none → `noDeclaration` (a hand-set
    `prepareSpell` counts); each blocks a Player and warns a Judge, whose cast
    runs fresh with a spend. The primary GM deletes a pending record when a
    caster's turn begun after it ends unresolved, or the combat is deleted; the
    spend stands. A second declaration: `declared`, block or warn; the Judge's
    replaces the first. *Rejected:* a record that waits any number of rounds
    (core resets initiative each round and lib lifts `casting` at the turn, so
    it could no longer be lost). *Counter (medium):* a misclicked declaration
    is spent.
62. **A buff on a weapon names the weapon at the cast.** A kept item-gated row
    needs one bearer, the seat's one targeted token; verdict `oneBearer`
    blocks a Player and warns a Judge (those rows are then written for
    nobody, listed). The dialog lists the bearer's weapons, marking magic
    ones; the pick is `card.item {targetKey, id, name}`; parts carry `itemId`;
    the relay refuses `badItem` unless the item is a weapon of the target.
    *Counter (medium):* ammunition and paired small weapons stay outside S2.
63. **Every record is built from the spell's rows, on either client.**
    `applyOnTarget` takes the spell's keyed rows for the mode and picks;
    `card.rows` is display only; the GM's client recomputes the duration.
    *Finding fixed:* S2a's `applyRow` builds a condition's records from
    `card.rows`, which the requesting seat wrote (`cast-apply.mjs`).
    *Counter (low):* a Judge's edit between cast and Apply changes what
    applies.
64. **A modifier or ward row is a section of the cast card.** Its figure is
    the part's value, tooltip `{spell} · {weapon} ({cite})`, a blank figure
    `—` with the page reference alone; a dry run at cast says what an entry
    would yield to, and the roll decides again; bounds are skipped for these
    rows; Undo (GMs) deletes the group's record. *Counter (low):* the card can
    read stale; the attack card is the record.
65. **Equipment registers masterwork as an item bonus source.**
    `printed-layers.mjs` `masterworkBonusParts(item, on)`, registered at
    `init`, reads the tier's figures (`masterworkFigure`) or an applied
    `masterwork.*` variation's, `provides: ["kw:masterwork"]`, cite
    `provenanceTip`; nothing imported → no part. *Rejected:* lib reading
    equipment's flag.
66. **S2b is a probe, the lib half, two magic slices, then the walk.** Probes
    on `main` in page context before the magic half, each with its fallback:
    P1 `deleteActiveEffect` fires on the deleting client inside
    `toggleStatusEffect`, on a linked actor and an unlinked token's; P2
    operation options reach the local delete hook; P3 `keepId` holds on a
    synthetic actor; P4 a Player sets `acks.prepareSpell` on its own
    combatant; P5 `combatTurnChange` fires at a round's turnover; P6 (after
    the lib half lands) a roll-mods row's label reaches core's attack card.
    Lib half (`implementer`): rulings 48 to 55. Magic slice M1
    (`implementer`): rulings 57, 62 to 65 for the buff, the weapon pick,
    masterwork and the relay fix. Magic slice M2 (a fresh `implementer`):
    rulings 56, 59 to 61, held ends and the declaration, with TESTING.

The full split, signatures, lang keys and the walk extension are in the
architect's report, handed to each implementer with its brief. Owner
questions, proceeded on at the default (S2b results list them): lawful undead
in the reverse (no); a Player's attack on a ward refused (no, told); a
creature entering an area later gains nothing until templates (yes); a cast
outside the module leaves concentration (yes, ROADMAP row); a declaration
resolves without a dialog (yes); a declaration after the caster's turn waits
a round (yes); an unread tail leaves the records standing with End (yes); a
Judge's second declaration replaces the first (yes); a tie with masterwork
keeps masterwork (yes). Departures from earlier rulings, also on that list:
53's `vsEnemy` on the bearer's side, 58's caster outside its own area unless
targeted, 59's deleting client, 61's lapse at the end of the caster's next
turn.

## Early rulings for session 1b (an architect, 2026-11-16)

Ruled ahead of session 1b, in parallel with S2b, on owner ruling 4's
question: where the fractions come from, and the one place an amount is
reduced. Made against `main` at `cf23a0fe`. `2e9585de` (S2b's M2, since
landed) changes no amount-path symbol: `amountOf`, `applyRow`,
`amountAfter`, `saveSpec`, `adjustHp`. Before it builds, session 1b checks
each line of "Rests on" against its own tip. A line that is no longer true
reopens the ruling that leans on it.

67. **Resistance's figures are imported into a `defenses` registry document;
    immunity ships as procedure; susceptibility's figures are the
    creature's.** Resistance's amount fraction and save modifier (RR ch. 6,
    "Damage Type Immunity and Resistance") are a `proseValues` table
    `resistanceProse`, with keys `fraction` (take `fractionWord`) and
    `saveBonus` (take `signed`). It follows the `senses` precedent.
    `lib/defenses.mjs` declares it with `expectTables`. `defenseFigures()`
    answers each figure, null until read. `defenseCite()` gives the page
    through `citeOf`. The Judge edits the figures in the Ruledata Browser,
    which writes the override layer.
    - Immunity prints no figure: it removes the damage and passes the save.
      That is procedure, and it ships.
    - Susceptibility prints no general figure. The susceptibility band
      gains nullable `factor` and `save`, which `defenseScan` locates in the
      creature's own clause (takes `times` and `signed`). The monster sheet
      edits them, and an unread one stays blank with the creature's page
      reference.

    *Rejected:* the fraction as structure, on `saveFractionOf`'s word map;
    a world setting; a table on the `monsters` document (characters need
    the figures too). *Counter (medium):* `saveFractionOf` already ships a
    word-to-fraction map. Medium, because that word is a vocabulary key
    authored per row, while resistance's figure is the rule's own printed
    number.
68. **`amountAfter` stays the one reducer.** It applies the save fraction,
    then one defenses stage, then one half-even rounding. Only the pure
    `lib/defenses.mjs` `defenseStage(sources, damage, figures)` builds that
    stage. `amountAfter` gains a `judge` stage, which answers `applied:
    null` and rounds nothing.
    - **Callers:** magic's `amountOf`, from `applyRow`, on the owning seat
      and inside `magicCastRelay` on the GM's client. The sources are read
      from `found.actor` on the client that writes. The types and the
      extraordinary mark come from the spell's own keyed row, never from the
      card or the request. A heal row takes no stage. The weapon Apply
      (ruling 69) is the other caller.
    - **Not callers:** the HP tool, `adjustTargets`, `planHpChange` and
      provision-day. Their amounts are untyped, and the HP tool's
      multiplier is the Judge's way to apply a defense by hand.
    - `adjustHp` stays the one writer, at multiplier 1.

    *Rejected:* wrapping `AcksActor#applyDamage`. It is untyped, core's
    card never calls it, and lib's `writeOne` does, so it would reduce a
    cast twice. Also rejected: a `preUpdateActor` reducer. *Counter
    (medium):* the HP tool still rounds up as core does, so two rounding
    rules remain. It is the Judge's manual route, and it gets a ROADMAP row.
69. **A weapon hit is applied by lib, not by core's button.** Core's Apply
    (`#onChatCardAction` → `#applyDamageToTarget`, a raw hit-point update)
    is private and cannot be wrapped.
    - Lib's `onPreCreateMessage` in `attack-throw.mjs`, which already owns
      that stamp, widens to every attack card in flight that is not a
      carrier's and still has an apply button. It reads `data-damage` and
      `data-target-uuid` and strips the button (`stripApplyDamage`). It
      stamps `flags.acks-extras.attackApply {targetUuid, rolled, types,
      extraordinary, silver}`. The types and quality come from
      `attackInFlight(actor).item.system.damage.base`, the field core's
      builder reads, and silver from `system.silver`.
    - The new `lib/attack-apply.mjs` adds a render hook and an Apply press
      outside `.card-buttons`. Only GMs press it, as in core. The press
      recomputes against the target's current sources through
      `amountAfter`, writes through `adjustHp` and stores `{applied, steps,
      before, after, by}`. A GM's Undo uses `restoreHp`.
    - A judge stage offers no Apply, and its line names the defense with
      its page reference.
    - `rolled` is core's floored `damageTotal`, so a defense can take a hit
      to 0 (inferred; owner question 3).
    - Core's other apply, `chat.mjs` `.damage-roll`, is out of scope: no
      core template emits that class, and it carries no type.

    *Rejected:* a second button beside core's (two writers, one of which
    ignores defenses); a capture-phase listener that swallows core's click.
    *Counter (medium):* every weapon card changes shape. Medium, because a
    failure at preCreate leaves core's button, which is the safe failure.
70. **The procedure ships.** A band covers a type dealt when it lists the
    type, or lists none and sets a quality flag that matches. The damage's
    quality is extraordinary when the damage is, or when a silver weapon
    meets `silverFlaw`; otherwise it is mundane. A band with no quality flag
    covers both.
    - Every type covered by immunity → 0.
    - Every type covered by immunity or resistance, at least one by
      resistance → `fraction`, or judge while it is null.
    - Every type susceptible → the creature's `factor`, or judge while it is
      null.
    - Judge in every other mixed case: a susceptibility covering some types,
      a susceptibility beside an immunity or resistance, or an applying band
      with a `note`.

    `actorDefenses(actor)` gathers the actor's `flags.acks-extras.extras.defenses`
    and each owned item's bands (ability items carry `defensesField()`).
    Each source is named, and a type covered twice counts once, so a
    fraction never applies twice (owner ruling 2). *Counter (medium):*
    tables meet more judge entries than they expect. The bands come from a
    prose scan, so sending a doubtful case to the Judge is the honest
    answer.
71. **The save side is built in S3** (owner word 4, "resist rolls with their
    types"). `saveSpec` takes `damage {types, extraordinary}`, and the new
    `defenseSaveParts` reads the same sources under the same coverage rule:
    - immunity → an `auto` success;
    - resistance → a target-side part of `saveBonus`, or `pending` while it
      is null;
    - susceptibility → the creature's `save`.

    The cast passes the union of its damage rows' types, and `worldFor`
    passes the same, so the relay's recomputed save matches.
    `checkApplyRequest` accepts an `auto` success. *Counter (medium):* one
    save covers rows that deal different types (owner question 4).
72. **Transparency.** A defense step is stored as `{key: "defense", label,
    band, types, source, cite}`. `cast-card.mjs` `appliedTip` lists every
    stored step, where it lists only rolled, fraction and applied today. A
    judge entry's detail names the defense, and its tooltip is the page
    reference alone. The save part carries the band's label, and the weapon
    line shows the same steps. The defense is named to GMs and the target's
    owners; other seats read "a defense" (owner question 1).
73. **Data fixes inside S3.**
    - `bindMonster` `packSide` writes `effects` as a set and keeps
      `silverFlaw` and `note`.
    - `defenseScan` reads the silver flaw and the susceptibility figures.
    - The monster sheet edits `factor` and `save`.
    - `docs/monsters/TESTING.md` step 5 is rewritten. It claims core's damage
      path respects defenses, and nothing reads them.
74. **Slice S3d, and what waits.** One `implementer` for each part, in this
    order:
    1. lib: `defenses.mjs`, `amountAfter`, `saves.mjs`, `attack-apply.mjs`,
       the `onPreCreateMessage` change, MODEL and DECISIONS, and the
       damage-against-defenses ROADMAP row S2 never wrote;
    2. the importer and monsters;
    3. magic: `amountOf` and `applyRow`, the card and the relay.

    The session then walks it on `main`. Effect and condition bands go to
    S4's opening ruling, since they act on the grant path. ROADMAP rows:
    - a damage-type pick in the HP tool, with the printed rounding;
    - a weapon Apply a player can press, through a relay;
    - quality per type within one band;
    - the incorporeal-weapon rule;
    - spell records as defense sources;
    - magic resistance;
    - core's sheet save, which gets no defense part.

**Rests on** (at `cf23a0fe`):

- `lib/hp-logic.mjs`:
  - `amountAfter` applies a fraction, then `stages` (a `factor` or a
    function), then one `roundHalfEven`. It has no judge stage.
  - `planHpChange` rounds up, as core does.
- `magic/cast-apply.mjs`:
  - `amountOf` calls `amountAfter(rolled, {fraction})` with no stages.
  - `applyRow` holds `found.actor` and stores `steps`.
  - `magicCastRelay` runs the same `applyOnTarget`.
  - `checkApplyRequest` requires `success === (total >= target)`.
- `lib/hp.mjs` `writeOne` calls `actor.applyDamage`.
- Core:
  - `chat-message.mjs` `#applyDamageToTarget` is private and GM-only, and
    writes `system.hp.value` raw.
  - `chat.mjs` `addChatMessageButtons` binds `.damage-roll`, which no
    template emits.
- `lib/patches/attack-throw.mjs`: `onPreCreateMessage` strips only a
  carrier's card. `attackInFlight` holds the context while core posts.
- `lib/fields.mjs` `defensesField`: bands `{damage, effects, conditions,
  mundane, extraordinary, silverFlaw, note}`, with no figure fields.
- The importer and monsters:
  - `importer/executor.mjs` `defenseScan` and `mergeDefenses` read neither
    silver nor figures.
  - `importer/cookbook/monster.mjs` `packSide` writes `effects` as a string
    and drops `silverFlaw`, `conditions` and `note`.
  - `monsters/module.mjs` `migrateDefenseBands` turns the string into sets.
- The monster sheet, `monsters/statblock.mjs` and the ability sheet read the
  bands, and only to display them.
- `lib/senses.mjs` reads a raw `proseValues` document through `getDoc` and
  `citeOf`. `location/table-store.mjs` mirrors imported documents to the
  world layer and keeps the override layer. That a new raw document persists
  the same way is inferred from the `senses` precedent, not checked live.
- `importer/table-extract.mjs` has the takes `fractionWord`, `signed` and
  `times`.
- Neither `docs/lib/ROADMAP.md` nor `docs/magic/ROADMAP.md` has a
  damage-against-defenses row.

**Owner questions**, each with the default to proceed on:

1. Is a target's defense named to every seat on a public card? Default: to
   GMs and the target's owners.
2. What happens when a susceptibility covers only some of the types dealt,
   or stands beside a resistance? Default: the entry goes to the Judge.
3. Does a hit's damage floor apply before the defense, so that a defense
   can take a hit to 0? Default: yes.
4. When a spell's rows deal different types, does the save part apply only
   when the target's defenses cover them all? Default: yes.

## Early rulings for S5 (an architect, 2026-11-16)

Ruled ahead of session 1c's S5, in parallel with S2b, on the readers ruling
10 lists. Each is ruled against lib's `rollMods`, `stackingPart` and
`saveSpec` as `874950a3` built them. Made against `main` at `cf23a0fe`.
`2e9585de` (S2b's M2) adds `held`, `tail` and `pending` to the record and
touches neither `rollMods`, `cast-mods.mjs` nor `scripts/lib/`. Session
1c checks "Rests on" against its own tip before it builds.

**Which row goes to which reader** (by register id):

- **The throw reader:**
  - `chameleon` and `silentStep`: a bonus where the bearer holds the
    proficiency, a set target where it lacks it.
  - `leaping`: a bonus on a held proficiency's throw.
  - `spiderClimbing`: a grant.
  - `passWithoutTrace`: a grant with no throw.
  - Ruling 10's fifth proficiency row is `locateAnimalOrPlant`, which is in
    S6's list (inferred count).
- **Influence:** `allure`.
- **A set armour class:** `arcaneArmor`, two rows.
- **A save under a condition:** `salvingRest`, which is in S4's list.
- **No new reader:** `baneRune` (M1's weapon part plus a creature kind
  picked at cast) and `slickness` (its object row is the Judge's).

At `cf23a0fe` only `sharpness` of these has register rows. S5 authors the
rest before any reader can be walked.

75. **One way into the record.** None of the four reaches a part today:
    `modParts` needs a `ROW_ON` entry and `atRoll`. `modifierDisposition`
    answers `consumed` for a proficiency throw or a reaction,
    `unsupported` for mode `set`, and `gated` for a status gate.
    `rollModsOf` drops any `on` outside `ROLL_MODS_ON`.
    - **Lib:**
      - `ROLL_MODS_ON` gains `throw`, `reaction` and `grant`.
      - A part may carry `mode`, `attackKinds`, `saves`, `ref`, `rollKey`,
        `ifHas` and `atLevel`.
      - With `bearer`, `modifierDisposition` answers `atRoll` for a `set` on
        `ac` and for a gated row. A declared `attackKinds` answers `atRoll`
        with reason `narrowed`, on both paths.
      - `effectField` gains `attackKinds`, a choice set over `conditions.mjs`
        `ATTACK_KINDS`, and `gate.occasion`.
      - `typed-modifiers.mjs` exports `saveKeyOf`.
    - **Magic, `cast-mods.mjs`:**
      - `isModRow` admits `modifies` and `grants` rows.
      - `ROW_ON` gains `proficiencyThrow` → `throw` and `reaction` →
        `reaction`.
      - A `consumed` row whose consumer is abilities or influence is
        admitted.
      - A save `forWhat` is written as `saves`.
    - A blank figure writes no part, and the card shows "—" with the page
      reference, as in M1. Every part keeps the spell-record capability.
    - **The row editor:**
      - `modifier` gains `attackKinds`, `gate.status` and `gate.occasion`.
      - `modifies` gains `appliesTo`, `ifHas` and `appliesToRoll`.
      - `grants` gains `appliesTo`, `mode` and `value`.

    *Rejected:* a magic-owned reader (ruling 50); `delivery` for attack
    kinds, since `cast-card.mjs` treats any row with a `delivery` as a throw
    row. *Counter (medium):* seven new fields for five spells. Medium,
    because each is a narrowing the conditions catalogue already uses or an
    existing `effectField` key.
76. **Lib reads every record part through `recordParts`.** The new
    `roll-mods.mjs` function `recordParts(actor, on, {subject, rollKey,
    save, ctx})` answers `{kept, dropped, pending}`, each labelled `{spell}
    ({cite})`:
    1. It filters by `on`, by `ref` (through `satisfies`), by `rollKey` and
       by `saves`.
    2. `partHolds` tests a non-item gate through `gateVerdict`: true
       applies, false drops, null goes to pending. It tests each `ifHas`
       through `hasCapability`.
    3. The applying parts go through `resolveStacking`, oriented so that the
       part kept is the better figure.

    `defenderSide` and `saveModParts` adopt `partHolds`; neither checks a
    gate today. Every reader reads applied effects at the roll, so a part is
    gone when its record ends. *Rejected:* each feature re-implementing
    gates, `ifHas` and stacking. *Counter (low):* abilities and influence
    import lib, the direction lib's index already allows.
77. **The abilities roller reads record parts.** `ability-rolls.mjs`
    `throwModifiers` gains a third source, `recordParts(actor, "throw",
    {subject: refOf(item), rollKey})`.
    - Record parts are resolved among themselves, then add to the actor's
      own bonuses: ruling 10's non-stacking is between spell records.
    - They join `parts`, so `targetModifiers`, `itemized` and the Rolls tab's
      tooltip name the spell.
    - Row shape: `{type: "modifies", target: "proficiencyThrow", refs:
      ["kw:<prof>"], ifHas?, appliesToRoll?, value}`.
    - `leaping` reaches whatever throw `rollsOf` gives the held proficiency.
      A bearer without it has no throw, and the part does nothing.

    *Rejected:* `modifier` with `forWhat`, since a name slug misses the
    routes a capability token catches. *Counter (medium):* a granted
    proficiency never satisfies an ability's `ifHas`. It matters only where
    a bearer's own ability depends on the granted one.
78. **A grant is a record part, never an item.** `{on: "grant", ref: <def
    id>}` means the bearer counts as holding that proficiency while none of
    its abilities provides `capabilityForId(ref)`.
    - `mode: "set"` with `value` sets the throw target (`chameleon`,
      `silentStep`). Each spell also carries an `ifHas` bonus part, so
      exactly one of the two applies.
    - With no mode, the throw is the definition's own at the bearer's level
      (`spiderClimbing`).
    - `atLevel` is the level the granted proficiency's figures are read at
      (`passWithoutTrace`).
    - The definition comes from `library.mjs` `byCookbookId(type, ref,
      {original: true})`, and only its formula, roll type and ladder are
      read.
    - A blank set figure still writes the grant, with `value: null`. The
      throw shows "—" with the spell's page and rolls with no target.
    - Two grants of one `ref` leave one, the better target for that throw's
      type.

    Readers:
    - abilities: `grantedThrows(actor)` and `rollGrantedThrow(actor,
      grant)`. `pickThrow` takes the holder as an explicit argument where it
      reads `item.actor` today.
    - the character sheet, `rolls.mjs`: a row kind `grant:<effectId>:<key>`.
    - influence: ruling 79.

    `hasCapability` stays items-only. Perception's hiding test reading
    grants is a ROADMAP row. *Rejected:* adding the proficiency item to the
    bearer, which a record deleted while no GM is connected would leave
    behind for good, against ruling 10's lifetime. *Counter (medium):* only
    the module's character sheet lists granted throws.
79. **Influence reads reaction parts and grants.**
    - `#buildModConfig` adds `recordParts(subject, "reaction")`, resolved
      among themselves first, because ticked rows sum.
    - Each part goes to `scopeApplies` whole, with the record's
      `sourceAlignment` and `enemy: null`, so `vsEnemy` is undetermined and
      offered unticked.
    - `getActsAsPowers` reads grant parts whose `ref` maps to a `CORE_PROFS`
      key: `allure` maps to `mysticAura`.
    - `resolveHeldRows` gives that stand-in the reaction figure from the
      library definition. With nothing imported it stays unvalued, as
      today.
    - `allure`'s bonus row carries `ifHas: ["kw:mysticaura"]`.
    - Core's `rollReaction` takes no part (inferred from a grep).
    - The same slice replaces `influence/ability-effects.mjs`'s three-key
      scope copy (the S1b finding).

    *Rejected:* writing influence's `actsAs` flag on the record, which
    would put a second flag vocabulary on a record lib owns. *Counter
    (low):* the scope fix touches ability rows no import writes yet.
80. **An armour class set by the kind of attack is a term on the attack.**
    The part is `{on: "ac", mode: "set", value, attackKinds}`.
    `arcaneArmor`'s missile row lists `["missile", "thrown"]`, since RR
    ch. 6, "Missile Attacks", counts a thrown item as a missile attack. Core
    adds the target's armour class inside `buildAttackThrow`, so the set can
    only enter as a term.
    - `rollModRows` passes `attackType` (a carrier's delivery) to
      `defenderSide`, which it does not today.
    - `defenderSide` drops a part whose `attackKinds` miss that type.
    - A set part becomes its lift: `max(0, value − (ac.value − dexMod +
      acMath(subject, {kind}).total))`. The lift joins the add parts in one
      `resolveStacking`, so the larger applies and the spell-record
      capability keeps it from adding to another spell's.
    - The term is `−lift`, labelled with the spell and the kind. A lift of 0
      is told as yielding to the target's own armour class.
    - Conditions that improve the attacker's throw are attack-side terms and
      are unaffected.

    *Rejected:* writing `system.ac.value`, which core recomputes and which
    knows no attack kind. *Counter (medium):* reading the set figure as a
    floor is inferred from the print's wording and its non-stacking clause
    (owner question 1).
81. **A save changed under a condition: `saveSpec` does not cover it yet.**
    `saveModParts` and `sheetSaveShift` skip every gated part and are not
    told which save is rolled. `salvingRest`'s figure belongs to the daily
    Death save the enervated condition imposes (RR Appendix B), not to every
    Death save.
    - The part is `{on: "save", saves: ["death"], gate: {kind: "status",
      status: "enervated", occasion: true}}`.
    - `saveSpec` and `onRollSave` pass the save kind. A part whose `saves`
      miss it is skipped, and a gate that is off adds nothing.
    - An `occasion` gate that holds goes to `pending`, unless the caller
      passes `occasion: "enervated"`. No module roller passes it yet.
    - The clause on how enervation ends stays a card line.

    This supersedes, for gated save parts, lib DECISIONS 2026-11-16's "only
    the unscoped, ungated parts". The new evidence is that this is the first
    save part to carry a gate. *Rejected:* a plain status gate, which would
    add the figure to an enervated creature's Death save against poison.
    *Counter (medium):* until an enervation roller exists, the figure only
    ever shows as pending.
82. **Owners and slices.** Lib owns its half of ruling 75, and rulings 76,
    80 and 81. No wrapper is added: `defenderSide` runs inside the
    roll-mods contributor, and `onRollSave` stays `status-effects.mjs`'s. No
    reader refuses anything, so the block-and-warn rule has nothing to gate.
    Each slice gets a fresh `implementer`:
    - **S5a:** lib, the row editor, `docs/lib`, the README and the API
      version.
    - **S5b:** `cast-mods.mjs`, the register rows (`salvingRest`'s too,
      unless S4 authored them) and the recompile.
    - **S5c:** abilities and the character sheet.
    - **S5d:** influence, which may run beside S5c.

    The session walks it on `main`.

**Rests on** (at `cf23a0fe`):

- `lib/roll-mods.mjs`:
  - `ROLL_MODS_ON` holds five values.
  - `saveModParts` and `sheetSaveShift` skip gated parts and take no save
    kind.
  - `defenderSide` gets no `attackType` and checks no gate.
  - `attackerSide` checks gates through `gateHolds`.
- `lib/typed-modifiers.mjs` `modifierDisposition`:
  - `CONSUMED_TARGETS` is answered before mode and subject.
  - Any mode other than `add` is unsupported.
  - A gated row answers `gated` even with `bearer`.
  - `saveKeyOf` is private.
- `magic/cast-mods.mjs`: `ROW_ON`, `isModRow`, and `modParts` keeping
  `atRoll` rows only.
- `abilities/ability-rolls.mjs`: `throwModifiers` reads item rows only, and
  `pickThrow` uses `item.actor`.
- `lib/capabilities.mjs` `hasCapability` reads ability items only.
- `influence/actor-data.mjs`:
  - `getActsAsPowers` reads `actsAs` flags.
  - `resolveHeldRows` gives an item-less stand-in an unvalued row.
- `influence/influence-app.mjs` `effectModRow`'s `scopeApplies` context
  carries no `sourceAlignment` or `enemy`.
- Core:
  - `buildAttackThrow` adds the target's `ac.value` itself.
  - `AcksActor#computeAC` sums armour, DEX, shield and `ac.mod`.
- `lib/conditions.mjs` has `acMath(…, {kind})`, `ATTACK_KINDS`, and
  catalogue rows narrowed by `scope` and `saves`.
- `lib/status-effects.mjs`: `onRollSave` knows the save key, and
  `recordSaveShift` drops it.
- `magic/cast-card.mjs` treats any row with a `delivery` as a throw row.
- The register: `def.prof.acrobatics` carries a `throw` effect, and
  `def.prof.passingWithoutTrace` has none.

**Owner questions**, each with the default to proceed on:

1. Where the target's own armour class, less DEX, is already better than
   `arcaneArmor`'s figure, does the target keep it? Default: yes.
2. Does a granted proficiency's throw take the bearer's conditions and other
   bonuses? Default: yes.
3. `passWithoutTrace`'s level-scaled figure has no reader, since evasion is
   formation's. Is it shown on the grant, with a ROADMAP row for evasion?
   Default: yes.
4. Should anything roll the enervated daily save, so that ruling 81's
   figure applies instead of sitting as pending? Default: no.
5. Are granted throws shown on the module's character sheet only? Default:
   yes.

## S3 rulings (session 1b's architect, 2026-11-17)

Ruled against `topic/spell-effects` at `7a3329ad`, with S3d's lib part in
flight. Each keeps its rejected alternative and counter. Tests use invented
spells only. Already built and not rebuilt: picks (`cast-rows.mjs`
`pickGroups`), the schema's `target.count`, `target.hdCap`,
`save.exemptBelowHd`, a row's `value`, `max` and `roll`, `recur` in the
vocabulary and editor (read by nothing), range data and `areaExtent`, lib's
turn lifting, ruling 16's per-kind editor list.

83. **Range is measured per target, centre to centre** (extends ruling 7).
    Pure `cast-range.mjs` `rangeFeet(range, level)` → `{value, parts}`
    (distance and touchOrDistance read `value`; distancePerLevel times the
    caster level; self, touch, unlimited, special and blank → null, no
    verdict); lib `distance-units.mjs` `tokenGapFeet(a, b)` through core's
    `grid.measurePath` and `feetPerUnit`. A creature target must be within
    range; an area target within range plus `areaExtent`'s reach; a blank
    extent, no caster token or another scene gives no verdict and a dialog
    note. `VERDICT.outOfRange` blocks a Player and warns a Judge, its tooltip
    naming targets, distances and the range's parts. The relay does not
    re-measure. *Rejected:* a pairwise spread check on an area (templates are
    later); measuring on the relay. *Counter (medium):* centre to centre
    overstates the gap to a large token (owner question C).
84. **A target count read from the import is a cap**: `VERDICT.tooManyTargets`;
    a blank count, none. *Rejected:* trimming. *Counter (low):* the verdict
    says how many are over.
85. **A spell's throw takes no range band** (ruling 37's counter): the spell
    prints one range; core's bands are a weapon's. *Rejected:* bands invented
    from one figure. *Counter (medium-strong):* one spell beyond the ten
    states its throw takes no range adjustment, which can be read as implying
    others do (owner question A).
86. **A throw's delivery is authored from the page; a page naming no kind
    gives missile.** *Rejected:* melee (RR ch. 5's melee throw is touch's).
    *Counter (medium):* owner question B.
87. **A pick option is one or more rows.** `effectField` `pickOption`; rows
    sharing `(pick, pickOption)` are one option; a row with `pick` and no
    `pickOption` is its own option keyed by its row key (existing groups keep
    working). The label joins `describeSpellEffect(row).text`; the legend is a
    lang string; `pick` is offered on every kind. *Rejected:* one row per
    option. *Counter (low):* a mistyped token splits an option.
88. **Instances.** `value` is a damage or heal row's instance count, capped by
    `max`; never authored means one; `unread` means blank (no roll, the page
    reference). Pure `cast-instances.mjs` `instanceCount(row, level)` →
    `{value, parts}`, `scaledRoll(formula, count)` (one NdM term multiplies
    its dice, any other formula repeats), `allocate(count, targetKeys)`. A
    no-throw row hands lib a derived `{...row, roll}` (one roll per cast,
    ruling 28). A throw row's count is a number of throws split among targets
    in the dialog, round-robin by default, as `card.allocation[rowKey][tKey]`;
    over-allocation is `tooManyInstances`; `severalTargets` fires only for a
    count of one or blank. One entry per target and row with `instances:
    [{throw, rolled, critical, state}]`; `amountOf` runs `amountAfter` per hit
    and sums; one `adjustHp`, one Undo. The relay recomputes the count and
    checks each instance against the row's bounds. *Supersedes ruling 41 in
    part* (2026-11-16) on new evidence: two of S3's rows print several throws
    per cast split among targets, and no S2a row did. *Rejected:* an entry id
    per instance; one throw per target. *Counter (medium):* a page splitting
    by creature needs another default; the split is editable.
89. **The cast owns the seat's targets around each core throw**:
    `setTargets([id], {mode: "replace"})` before each `makeAttackThrow`, the
    prior targets restored in `finally`; a token off the viewed scene leaves
    the entry at Throw with a notice; `pressThrow` narrows the same way
    (finding F2). *Rejected:* core's `buildAttackThrow` (skips its dialog and
    card); patching core. *Counter (medium):* other seats see targets flicker.
90. **A count per breakpoint is read from the page, increments included**:
    `ladderFrom` `accumulate`; a locator may set `articles: true`, reading an
    article as one inside that locator alone. *Rejected:* articles in
    `WORD_NUMERALS` globally; a literal step in a locator. *Counter (medium):*
    the article reading is the module's grammar, shipped as language.
91. **Gates.** Pure `cast-gates.mjs` `targetGate({actor, extras, row, level})`
    → `{affected, noSave, why: {key, parts}}`: over `hdCap` (HD from
    `hitDiceOrLevel`) unaffected on every row; below `exemptBelowHd` no save,
    applied as a failure; row field `exemptSizeFrom` (locatable `sizeKey` to a
    monsters `SIZES` key) exempts at or above that size from that row only;
    `sizeRank` moves to lib `actor-read.mjs`. State `exempt` with a tooltip
    naming the figure, threshold and page; a blank threshold gates nothing;
    the relay recomputes and refuses an exempt entry. *Rejected:* dropping
    exempt targets from the card. *Counter (low):* the comparator is read per
    page (owner questions D, H).
92. **The rest of the row editor.** `TYPE_FIELDS`: `max` on damage and heal;
    `pick`, `pickOption` on every line kind; `recurAt`, `recurSave`,
    `recurTarget`, `exemptSizeFrom` on damage and conditionGrant; `rounds` on
    conditionGrant; `stacksWith`, `provides` on modifier; all in
    `SPELL_ONLY_FIELDS` and `TIPPED_FIELDS`. Overview edits `hdCap` and
    `exemptBelowHd` (blank: the page reference alone). The Mechanics list
    marks origin and lists blank fields with the page reference (finding F5).
    *Rejected:* leaving them to 1d. *Counter (low):* a wider editor.
93. **Setting things alight is a new spell kind `ignite`** (lib `vocab.mjs`
    `EFFECT_TYPES`), a ruling-14 line. *Rejected:* `structural`, a note,
    `light` (formation would act on it). *Counter (medium):* a new kind;
    later levels' need is inferred.
94. **Turn handling stays lib's.** `status-effects.mjs` fires
    `acksExtras.turnBegan(combat, combatantId)` and `acksExtras.turnEnded`
    (not on a re-sort), on the primary GM, with its handling of rounds opened
    before initiative. Lib lifts a record carrying flag `turnLife {combatId,
    combatantId, edge, count, seen}` by id at its edge once `seen` reaches
    `count`. *Qualifies the cost line* of magic DECISIONS 2026-11-11 (the
    clock math) on new evidence: S3's rows last a next turn or a few rounds
    inside one fight, which the clock never reaches. *Rejected:* magic on
    `combatTurnChange` (a second owner). *Counter (medium):* a write per turn.
95. **`lasts` gains `nextTurn` and `rounds`** (a locatable dice `rounds`). In
    a started fight with the bearer a combatant, `nextTurn` writes `turnLife
    {edge: "end", count: 1}` and `rounds` `{edge: "start", count: rolled}`;
    each also carries `startTime` and the flag clock, and the first end
    deletes it. A blank formula leaves it untimed with its page reference.
    *Rejected:* counting the combat's rounds (initiative is rerolled each
    round). *Counter (medium):* the end edge is not printed (owner question F).
96. **Recurring rows.** `recur` gains `laterRounds`; `eachRound` resolves at
    the cast, then recurs. Fields `recurAt` (casterTurn, bearerStart,
    bearerEnd), `recurSave` (blank, `row`: a pass ends that bearer's record of
    the row, `cast`: a pass ends the cast), `recurTarget` (blank, `pick`). A
    casterTurn row recurs while the caster's record stands, so `cast-spell`'s
    `timed` test counts it; a bearer row while the bearer holds a record of
    the cast, the row writing a status-free anchor where none is written.
    *Rejected:* an instant twin plus a recurring row. *Counter (medium):*
    `recurSave` row against cast is a page reading.
    **96a (session 1b, from the widen walk).** A casterTurn row with
    `recurSave: cast` writes the caster's record even on an untimed cast. The
    walk found the `timed` test did not count it: a cast whose duration parses
    `special` wrote no record, so its caster-turn rows never prompted and Next
    round posted nothing. The untimed record has no clock, and the passed
    cast-wide save (`endCast`) is what ends it. *Rejected:* every casterTurn
    row (a row with no cast-wide save would leave a record nothing ends);
    reading the duration as held. *Counter (medium):* an untimed casterTurn
    row with no cast-wide save still never prompts.
97. **The recurring prompt is a cast card.** At the hook the primary GM posts
    a `castCard`-model card through `renderRollCard` with `recurOf {cardId,
    castId, round, combatId, moment}`, nothing rolled (ruling 11). Presses:
    Save (`magicCastSave`, the bearer's owners and GMs; a pass ends the row's
    record, or the held record with a new `HELD_CAUSES` member `saved`; a fail
    on a damage row rolls and applies in the press), Roll (`magicCastRoll`,
    the caster's owners and GMs), a pick row through `magicCastApplyTargets`
    range-checked by ruling 83. The relay requires a GM-authored prompt card
    and the requester owning the bearer (Save) or caster (Roll), reads level,
    mode and picks from the cast card. Outside a fight, a Next round press
    posts the round's prompts; with no GM connected none is posted.
    *Rejected:* entries on the cast card by round; auto-rolled NPC saves.
    *Counter (medium):* a card per moment (owner questions E, G).
98. **The points pool's spend stays deferred** (a ROADMAP row). *Supersedes in
    part* ruling 25's placement (2026-11-15) on new evidence: no register
    authors a points tradition, so no printed cost is reachable. *Rejected:* a
    Judge-typed cost. *Counter (low):* a Judge's points class is spent by hand.
99. **Caster abilities move to session 1c's opening as slice S3c** (scout,
    architect, implementer). *Supersedes in part* ruling 26's placement on new
    evidence: ruling 74 added S3d's three parts to 1b after ruling 26, and
    ruling 18's scout inventory has not run. *Rejected:* the last slice of 1b.
    *Counter (medium-strong):* owner word 6 names the abilities; the Judge
    applies them by hand for one session.
100. **Every figure S3 adds is `{value, parts}`** (range, count, gates,
     rounds), so S3c adds an ability as a part. *Counter (low):* unused parts.
101. **(session 1b) An unread extraordinary mark is undetermined.** Every
     imported spell damage row reads `extraordinary` null with it `unread`.
     Quality is three-valued; a band whose coverage depends on quality meets
     undetermined damage as the judge stage, and as `pending` on the save
     side. Qualifies ruling 70's quality line, which read null as mundane, so
     a mundane-only band made a creature immune to every imported spell.
     *Counter (medium):* more judge entries until the mark is read.

## Session 1c rulings

Numbered 102 to 149.

## Session 1d rulings

Numbered 150 to 199.

**Findings:** F1 a pick option's label renders an object (S3p); F2 a Throw
press throws at the presser's targets (ruling 89); F4 `resisting` counts line
rows, so a spell whose other rows all throw rolls saves for nothing (S3p).

**Owner questions**, with the defaults proceeded on: A no range band on a
spell's throw; B a throw naming no kind is missile; C range centre to centre;
D a monster's HD bonus ignored in the gates; E a recurring save is rolled by
the bearer's owners or a GM, never auto-rolled; F a `rounds` record ends after
its count of the bearer's turn starts; G a Next round press outside a fight;
H an HD cap is inclusive.

**Slices**, one `implementer` each, in this order: S3d-1 (lib, ruling 74);
S3d-2 (importer, monsters) beside S3p (picks and range: 83, 84, 87, F1, F4);
S3d-3 (magic's amount path) beside S3v (vocabulary, editor, importer,
register rows for the ten: 90, 92, 93); S3i (instances: 88, 89) beside S3t
(lib turn hooks: 94); S3g (gates: 91); S3l (record lives: 95); S3r (recurring
prompts: 96, 97). The walk is `tools/live/magic-cast-widen.mjs` (markers
`magic/widen-far`, `magic/widen-huge`, `magic/widen-spell-<id>`; its fight is
created and swept per run).

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

### Results, S2b (2026-11-16)

S2b is built and walked on `main`. The architect's rulings 48 to 66 (above)
split it into a probe, a lib half and two magic slices, M1 (the weapon's
buff) and M2 (held records and the declaration). Each was built on
`topic/spell-effects` by its own `implementer` and landed. The topic stays
open for 1b. Nothing is pushed.

**Built.**

- `da6b2f29`: docs, rulings 48 to 66.
- `874950a3`, the lib half (rulings 48 to 55):
  - `lib/roll-mods.mjs`: the `rollMods` flag, its reader and its
    attack-seam contributor; `registerItemBonusSource`; the item gates
    `weaponMundane` and `weaponMagical`.
  - `typed-modifiers.mjs`: `modifierDisposition` takes a `bearer` and answers
    unsupported for an area or recipient subject before it tests a scope;
    `stackingPart`.
  - `saves.mjs`: `against`, the scopes judged against the attacker at the
    roll.
  - The concentration rows' `lost`; `lossInFlight`; `actorToken`.
  - API version 52.
- `8f703c3c`, M1 (rulings 57 and 62 to 65): `magic/cast-mods.mjs`.
  - The cast dialog's weapon pick.
  - Records built from the spell's own rows through `castInputs`, never the
    card's.
  - One group write per cast, and Undo by entry.
  - Equipment's masterwork registered as an item-bonus source at `init`.
- `cf23a0fe`: on `main`, the walk's buff steps and the recipe.
- `2e9585de`, M2 (rulings 56 and 59 to 61): `cast-moment.mjs`,
  `cast-held.mjs`, `cast-declare.mjs`.
  - The held caster record. Concentration's end ends that cast's recipient
    records on the deleting client, with one end card that carries End and
    a Judge's Restore.
  - The declaration: free, declare or resolve. It is lost on `loseStates`,
    resolved on the caster's turn with no dialog and no second spend, and it
    lapses when that turn passes.
  - Magic MODEL, DECISIONS (two entries), ROADMAP and TESTING, and the
    walk's held and declare steps.
- `8de2898c`, a walk find fixed on `main`. The walk's token helpers paired
  a create's answer with its actors by position. They now pair by
  `actorId`. The round card a tracker move posts is swept with the run's.

**Exercised live** (GM and Player seats, `main`'s junction, nobody else
seated, world relaunched after the pause):

- The probe before the lib half (P1 to P6, in the notes folder's
  `20261116-s2b-probes.md`). P4 failed: a Player cannot update its own
  combatant. So `prepareSpell` is set by the GM's client through the relay,
  ruling 60's fallback.
- After M1: `magic-cast-spell` passed (93 pass, 0 fail, exit 0).
  `magic-spell-recipes` passed (36 pass, 0 fail). The seams the lib half
  touched passed: `typed-modifiers` (76), `equipment-ability-training` (8)
  and `formation-day` (185).
- After M2 and `8de2898c`, the final run: `magic-cast-spell` passed (124
  pass, 0 fail, exit 0) and `magic-spell-recipes` passed (36 pass, 0 fail,
  exit 0). The sweep reported `"missing":[],"failed":[]`. In the walk:
  - Holy circle cast at the caster's token and an ally's by the Player seat.
    A foe's claw meets the ally's ward. A stranger's attack does not. The
    ally's own attack at the caster is not changed. The foe's spell at the
    ally takes the save part.
  - Sharpness on the blade, cast by the Player. The GM's client writes the
    record. The figure is on that weapon's attack and damage, with a tooltip
    naming the spell. Cast twice: two records and one figure, which stays
    while either record stands. Beside masterwork on the other weapon, the
    two resolve through `resolveStacking`. Cast with two creatures targeted,
    the Player's dialog blocks it and a cancel spends nothing; the Judge's
    dialog warns and leaves Cast on.
  - Held steps:
    - Hurt on the GM's client, the caster's cast ends with one card, and
      Restore puts it back.
    - Hurt on the Player's client, that client ends what it can.
    - A time past concentration runs out the recipients' records.
    - The longest hold ends the cast with the cause `time`.
    - A recast warns, and confirming ends the held cast with the cause
      `cast`.
  - Declare steps:
    - A declaration is lost to damage and reported lost at the caster's
      turn.
    - One is resolved on the turn with no dialog and no second spend.
    - One the turn passes unresolved lapses, and its spend stands.
  - S2a's steps 1 to 9 still pass.
- Fixtures kept, by marker: S2a's, plus
  - `magic/cast-ally` and `magic/cast-ally-blade`, `-fine`;
  - `magic/cast-foe` and `magic/cast-foe-claw`, `-spell`;
  - `magic/cast-stranger` and `magic/cast-stranger-claw`;
  - `magic/cast-spell-circle` and `magic/cast-spell-edge`.
- The run's cards and tokens were swept by id, none missing and none
  refused.

**Offline only:**

- `npm test`: 240 suites. Validate: 0 failures. Among them, on invented
  spells: test-roll-mods 27, test-typed-modifiers 75, test-saves 15,
  test-conditions 52, test-lib 247, test-cast-mods 8, test-cast-held 10,
  test-cast-declare 10, test-magic-cast 61, test-magic 90, test-equipment
  886.
- The relay's refusals for a record write.
- `restorePlan`'s sanitizing of an end card's entries.
- A Judge's second declaration replacing the first.

**Not checked:**

- The no-GM fallbacks: a Player's held end or declaration with no GM
  connected, where the pending record waits with Apply and End.
- A points pool's spend.
- A cast made outside the module, which leaves concentration standing.
- Dice So Nice.
- The masterwork case where the spell's figure is one below masterwork's:
  no imported weapon reaches it on this import.
- The guide and a release shot (S7).

**Defaults proceeded on, for the owner:**

1. Lawful undead do not count for holy circle's reverse.
2. A Player's attack at a warded creature is not refused; the Player is
   told.
3. A creature that enters an area after the cast gains nothing until area
   templates are built.
4. A cast outside the module leaves concentration standing. The lib
   ROADMAP's concentration row records it.
5. A declaration resolves without a dialog.
6. A declaration made after the caster's turn waits a round.
7. An unread tail leaves the records standing, with End.
8. A Judge's second declaration replaces the first.
9. A tie with masterwork keeps masterwork.
10. (M1) A spell whose duration is dice keeps the card's rolled figure when
    a recompute finds it in range.
11. (M2) A Judge's Restore may act on an end card a Player's client wrote.
    `restorePlan` takes only that cast's entries.

**Departures from the rulings, as built:**

- Ruling 53's `vsEnemy` is judged on the bearer's side.
- Ruling 58: the caster is outside its own area unless targeted.
- Ruling 59: concentration's end runs on the deleting client.
- Ruling 61: a declaration lapses at the end of the caster's next turn.

**Findings:**

- Deleting an actor fires no effect delete, so its held records end with
  nothing. A magic ROADMAP row records it.
- S2a's relay read the card's rows. Ruling 63 moved it to the spell's own,
  in M1.
- A `prepareSpell` set by hand counts as a declaration, but that cast runs
  fresh and spends.
- A cast still posts two cards (S2a's finding stands).

### Start prompt, session 1b

> Run session 1b of `docs/magic/wip/20261115-spell-effects-plan.md` in
> `C:\Proj\foundryvtt-acks-extras`: S3 as "Session 1b: widening" lists it
> (recurring rows and their prompts, several instances per cast, picks, HD
> gates, range checks, the rest of the row editor, for its ten
> `def.spell.*` rows) and the slice S3d that ruling 74 makes of damage
> against defenses. Read the plan whole first: owner rulings 1 to 4,
> rulings 17 to 82, and the Results sections. Then read "Early rulings for
> session 1b" (rulings 67 to 74), which govern S3d:
> - a `defenses` registry document, `lib/defenses.mjs`, with resistance's
>   figures imported;
> - `amountAfter` as the one place an amount is reduced;
> - lib's apply of a weapon hit;
> - the save side built in S3.
>
> Before anything is built, check each line of that section's "Rests on"
> list against your own tip, and report the result. A line that is no
> longer true reopens the ruling that leans on it, and goes to an
> `architect`. Since those rulings were made, S2b changed `cast-apply.mjs`
> (records from `castInputs`, group writes, `undoEntries`), `saves.mjs`
> (`against`) and `patches/attack-throw.mjs` (`actorToken`).
>
> Then read `docs/magic/MODEL.md` "Casting a spell", `docs/lib` where the
> plan names a seam, `.claude/rules/ip-doctrine.md` and
> `.claude/rules/live-testing.md`. Proceed on the four owner questions'
> defaults under ruling 74, and list them in your Results. Number any new
> ruling from 83.
>
> You are the orchestrator. S3 gets its own `implementer`, or one per slice
> if an `architect` splits it. S3d gets one `implementer` for each part, in
> ruling 74's order: lib, then the importer and monsters, then magic. Each
> brief quotes the owner's words from the plan, and each report restates
> them with one example. An `architect` takes any design question the plan
> does not answer. Review each change against the IP doctrine yourself:
> resistance's fraction and save figure are imported and never shipped, and
> committed tests use invented spells. Before an agent writes under
> `scripts/lib/`, list the running sessions and `main`'s dirty paths.
>
> You work in the worktree `C:\Proj\foundryvtt-acks-extras.spell-effects`
> on `topic/spell-effects`.
> - Run `node .claude/skills/acks-branch/branch.mjs sync spell-effects`
>   there first.
> - Commit by hand, and land with `branch.mjs land spell-effects`.
> - Walk on `main` yourself through `tools/live`, never the `live-tester`
>   agent. Extend `magic-cast-spell`, whose fixtures are kept by marker, or
>   add a walk for the widened rows. Rerun it and `magic-spell-recipes`, and
>   walk S3d's resisted, immune and susceptible targets from an import. Its
>   tokens pair by `actorId` (TESTING's drive mechanics).
> - Check who is seated before a world relaunch.
> - Push nothing.
>
> For the prompts after yours: of S5's spells, only `sharpness` has
> register rows today, and the save-under-a-condition row, `salvingRest`,
> is in S4's list.
>
> Finish by appending "Results, 1b" to the plan, by sha, sorted exercised
> live, offline only and not checked, with the defaults you proceeded on.
> Write session 1c's start prompt under it (S4 and S5, per "Session 1c" and
> "Early rulings for S5"). Commit that on `main` with `acks-commit`, and
> report. You start no session; the managing session starts the next one
> from your prompt.

### Results, 1b (2026-11-17)

**Rests on.** Every line of the "Early rulings for session 1b" list held at
the session's tip but one. Ruling 70 read a null `extraordinary` as mundane,
and every imported spell damage row reads it null and `unread`. Ruling 101
qualifies that line: an unread mark is undetermined. The S3 architect's
rulings 83 to 101 and 96a are under "S3 rulings" above.

**Landed** on `main` from `topic/spell-effects` (rebased, gate green,
fast-forward to 777e9e13, not pushed). The topic stays open for 1c.

- 87deee21 S3d-1, lib: `lib/defenses.mjs`, `amountAfter`'s defense stage,
  the judge stage, `saveSpec` `damage` with its `auto` pass, and the weapon
  Apply in `lib/attack-apply.mjs`.
- 77980786 S3p: pick options, `cast-range.mjs`, lib `tokenGapFeet`, and the
  verdicts `outOfRange` and `tooManyTargets` (F1, F4).
- 3b37b59d S3t: lib's turn hooks and `turnLife`.
- 87b9ad15 S3d-3: magic's amount path meets the defenses, and a save
  meets them too.
- 6cac2c8a S3d-2: resistance's two figures import into the defenses
  document; the monster scan reads the silver flaw and the susceptibility
  figures, and the monster sheet edits them.
- a38fccf2 S3i: instances, throws split among targets, and the cast sets
  the seat's targets around each throw (F2).
- 55d8441b S3v: row fields, the vocabulary, the `ignite` kind, the editor,
  and the ten spells' register rows (cookbook 337 entries).
- f602c9fc S3g: HD cap, the no-save threshold and size exemption.
- 981fb457 S3l: `nextTurn` and `rounds` lives.
- 46e18ce1 S3r: recurring prompts, and the ignite recipient record.
- 777e9e13 the walk `tools/live/magic-cast-widen.mjs`.

**Fixed on `main` from the walk:**
- 6163110e: the cast card shows Auto and None in its save column, via lib
  roll-card `targetText`.
- d579f9a5: an untimed cast with a caster-turn row that carries a cast-wide
  save writes its caster record (ruling 96a).
- d579f9a5: the walks' own defects (thirteen in widen, one in
  `magic-cast-spell`). The widen setup now imports the defenses table from
  the seat's book, so the resistant path runs instead of the Judge fallback.

**Exercised live**, on lane A without `FIXTURE_OWN`, on the working tree that
holds the fixes above:
- `magic-cast-widen` passed 73 of 73: range verdicts (Player blocked, Judge
  warned), pick labels, damage against immune, resistant (imported fraction)
  and susceptible targets with the weapon Apply, instances split and thrown
  through core's dialogs at their own targets, the Throw press at the
  card's target, the scaled formula and its tooltip, the size, cap and
  no-save gates, record lives in a fight and on the clock, and the
  recurring prompts. The prompts covered were thunderclap's bearer save,
  chokingGrip's caster-turn save ending an untimed cast, mageMissile's
  range-checked Roll, kindleFlame's burning, and Next round outside a
  fight. Neither seat recorded a console error since the seat was
  installed.
- `magic-cast-spell` passed 124 of 124. Its first two reruns stopped before
  any check with "devtools endpoint never came up", which is the driver's
  browser start under load, not a world result.
- `magic-spell-recipes` passed 36 of 36.

**Offline only:**
- The untimed record's end through the real `endCast`: the test fakes
  `endCast`, and the walk saw the caster record gone.
- `migrateDefenseBands`, which is dead code and left in place.
- Every suite named in the slice commits.

**Not checked:**
- A Player seat's recurring Save on a bearer it owns. The walk proves a
  Player is refused on a bearer it does not own.
- Two lanes up at once.
- The release shots and guide, which belong to the close.

**Defaults proceeded on.** Owner questions 1 to 4 under ruling 74 are at
their defaults. The S3 owner questions A to H are under "S3 rulings". The
departures each slice made, also at defaults and open to the owner:
- **S3d:**
  - Silver is read from `system.special.silver`.
  - An untyped damage meets no band.
  - An immunity-only Judge line falls back to the citation of RR ch. 6,
    Damage Type Immunity and Resistance.
  - The union of damage types covers unread rows.
  - An unpriceable save effect goes to the Judge before the defenses.
- **S3p:**
  - No api bump for `distance-units`.
  - No range verdict on a declaration.
  - A twin's range is used.
- **S3t:** `turnEnded` fires when an unrolled round opens.
- **S3i:**
  - A blank count makes no throw.
  - A Judge's over-allocation throws.
- **S3v:**
  - The area sizes of blindingFlash, thunderclap and fanOfFlames stay blank;
    the lint needs the measure word.
  - kindleFlame is modelled as an area.
  - `provides` is not in `effectField`.
  - earthsExcrescence's count locator holds for a single die only.
- **S3g:**
  - The gate tooltip's HD is shown to every seat.
  - A blank character size reads man-sized.
- **S3l:** a `rounds` life has a floor of one round, which is not printed.
- **S3r:**
  - `RECORD_KINDS` is `ignite` only.
  - Prompts post public.
  - kindleFlame's flames row lasts `duration`, so its burning is untimed
    where the page burns until extinguished.
- **96a:** an untimed caster-turn row with no cast-wide save never prompts.

**Findings for later sessions:**
- A general susceptibility multiple may be printed in MM's overview chapter
  (a counter to ruling 67), to check against the page.
- Ruling 98's points pool and ruling 99's caster abilities (S3c) move to 1c.
- BtA's groundwork B2 sets the gnosis casterLevel ladder to "" (class level)
  and adds a `levelCap` key, which fits ruling 6; 1c's S3c reads it.

### Start prompt, session 1c

> Run session 1c of `docs/magic/wip/20261115-spell-effects-plan.md` in
> `C:\Proj\foundryvtt-acks-extras`: S3c (caster abilities, ruling 99), then
> S4 and S5 as "Session 1c: saves, conditions and buffs" lists them. Read
> the plan whole first: owner rulings 1 to 4, rulings 17 to 101 and 96a,
> "Early rulings for S5", and every Results section, 1b's last. Number new
> rulings from 102 to 149 under `## Session 1c rulings`; owner questions are
> 1c.1, 1c.2 and so on.
>
> - **S3c** (`scout` inventories ruling 18's list, then an `architect` rules,
>   then an `implementer`): the caster's own abilities as `{value, parts}`
>   parts on the figures S3 added (ruling 100). BtA's groundwork has set the
>   gnosis casterLevel ladder to "" (class level) and added a `levelCap`
>   key; read it, do not reshape it.
> - **S4 and S5** per the plan. S5 opens with the `architect` ruling "Early
>   rulings for S5" calls for. Of S5's spells only `sharpness` has register
>   rows; `salvingRest` is in S4's list.
> - Ruling 98's points-pool spend stays a ROADMAP row; do not build it.
>
> You are the orchestrator. One slice, one agent, each brief quoting the
> owner's words from the plan and each report restating them with one
> example. Review every change against the IP doctrine yourself: imported
> figures only, and committed tests on invented spells. Before an agent
> writes under `scripts/lib/`, list the running sessions and `main`'s dirty
> paths.
>
> **A second session, 1d-A, runs beside you** on `topic/spell-effects-1d`.
> Yours is `topic/spell-effects`, in the worktree
> `C:\Proj\foundryvtt-acks-extras.spell-effects`. You own:
> - all of `scripts/lib/`;
> - `scripts/magic/cast-*.mjs` except `cast-summon.mjs`;
> - `spell-effect.mjs`, `describe.mjs`, `spell-sheet.mjs`, `templates/magic/`
>   and `styles/magic.css`;
> - `scripts/importer/`, abilities, influence, classes and the character
>   sheet;
> - S4 and S5's register entries;
> - `docs/lib`, `docs/importer` and `docs/magic/MODEL.md`;
> - the existing magic walks and tests.
>
> When collisions come:
> - The cookbook is generated: take `--ours`, recompile, and check the entry
>   count holds.
> - `lang/en.json`: keep both.
> - DECISIONS and ROADMAP appends: keep both, `main`'s first.
> - Your TESTING steps go inside "Casting a spell", before "Drive
>   mechanics".
> - ROW_KEYS is the union.
>
> When your last code slice lands, write `1c code complete: <sha>` under
> `### Results, 1c`. That line releases 1d-B.
>
> Run `node .claude/skills/acks-branch/branch.mjs sync spell-effects` there
> first. Commit by hand, and land with `branch.mjs land spell-effects`. Walk
> on `main` yourself through `tools/live`, never the `live-tester` agent, on
> lane B (its seats and ports are in `TEST_ENVIRONMENT.md`) with
> `FIXTURE_OWN=1c`. Reload clients after any landing. A failure seen with
> two lanes up is rerun on lane A alone before it is called a bug. Check who
> is seated before a world relaunch. Rerun `magic-cast-widen`,
> `magic-cast-spell` and `magic-spell-recipes` after your last landing. Push
> nothing.
>
> Finish with `### Results, 1c`, by sha, sorted exercised live, offline only
> and not checked, with the defaults you proceeded on. Commit it on `main`
> with `acks-commit`, and report. You start no session.

### Start prompt, session 1d-A

> Run session 1d-A of `docs/magic/wip/20261115-spell-effects-plan.md` in
> `C:\Proj\foundryvtt-acks-extras`, beside session 1c: the register entries
> of S6 and S7 as "Session 1d: tracked kinds and the close" lists them,
> except `locateAnimalOrPlant`, which is 1d-B's. Also a check of the three
> built summons' rows, and the summons ruling. Read the plan whole first:
> owner rulings 1 to 4, rulings 17 to 101 and 96a, and every Results
> section. Number new rulings from 150 to 199 under `## Session 1d rulings`;
> owner questions are 1d.1, 1d.2 and so on.
>
> Open `topic/spell-effects-1d` with
> `node .claude/skills/acks-branch/branch.mjs open spell-effects-1d`
> (worktree `C:\Proj\foundryvtt-acks-extras.spell-effects-1d`). Commit by
> hand, and land with `branch.mjs land spell-effects-1d`. Session 1c is
> writing `topic/spell-effects` at the same time. You own only:
> - the S6 and S7 register entries and the three built summons' entries;
> - `scripts/magic/cast-summon.mjs` and `summon-spell.mjs`;
> - new tests, and a new walk `tools/live/magic-cast-tracked.mjs` with
>   markers `magic/tracked-*`;
> - changelog fragments slugged `spell-effects-tracked` and
>   `spell-effects-l1-summons`;
> - a new `##` section at the end of magic TESTING;
> - DECISIONS and ROADMAP appends, and lang keys;
> - one line in `spell-recipe-rules.mjs` ROW_KEYS.
>
> Anything else is 1c's. If a slice needs one of 1c's files, the work waits
> for 1d-B, which starts once `### Results, 1c` reads
> `1c code complete: <sha>`. That covers:
> - recipient records for tracked kinds: the six `ignite` sites in
>   `cast-spell` and `cast-apply`, and `RECORD_KINDS`;
> - the row editor's `lasts` on tracked kinds;
> - new kinds, condition keys and describe arms (delayDisease,
>   purifyFoodAndWater);
> - the summon-claimant work under S3c's rules.
>
> A tracked row that lasts must carry `lasts: "duration"`, or no caster
> record is written.
>
> When collisions come:
> - The cookbook is generated: take `--ours`, recompile, and check the entry
>   count holds.
> - `lang/en.json`: keep both.
> - DECISIONS and ROADMAP appends: keep both, `main`'s first.
> - ROW_KEYS is the union.
>
> You are the orchestrator: one slice, one agent, each brief quoting the
> owner's words from the plan. Review every change against the IP doctrine:
> register rows read from the Judge's page, never shipped figures, and tests
> on invented spells. Walk on `main` through `tools/live` on lane C with
> `FIXTURE_OWN=1d`. Reload clients after any landing. A failure seen with two
> lanes up is rerun on lane A alone before it is called a bug. Push nothing.
>
> Finish with `### Results, 1d` (1d-A's part), by sha, sorted exercised live,
> offline only and not checked. Then write 1d-B's start prompt, and commit
> both on `main` with `acks-commit`. You start no session. The close comes
> after 1c's walks and 1d-B.

### Progress after handover (run from 1b)

The managing session could not start sessions while the owner was on Remote
Control. Session 1b runs 1c and 1d-A from its own session, per their start
prompts, with one change: every walk runs on lane A, one at a time, without
`FIXTURE_OWN`. 1c works in `topic/spell-effects` and 1d-A in
`topic/spell-effects-1d` (opened at 6e1999dd).

### Results, 1c

### Results, 1d
