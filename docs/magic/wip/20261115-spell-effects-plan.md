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
   damage resolver is built, and no defense arithmetic: a lib ROADMAP row
   covers damage against defenses for weapons and magic alike. An
   `attackTypes` contributor answers `["magic"]` for a carrier flagged as a
   spell's, and the modifier wrappers drop core's melee and missile rows for
   it. The carrier is a transient, unsaved core weapon item parented to the
   caster, its base damage `{formula, types, extraordinary}` taken from the
   row. A row with a throw calls `makeAttackThrow` with the carrier and gets
   core's card and core's Apply; a row's `delivery` lets the throw take that
   delivery's rows while the damage stays magic. A row with no throw has no
   core entry point: lib's `magicDamageSpec(actor, carrier)` asks the same
   `getDamageModifiers("magic")` question, the cast card rolls it, and Apply
   goes through `adjustHp` with the save's multiplier. Core has no label for
   the type; lib supplies one at runtime. *Rejected:* "magic" as a damage
   type (it would erase the printed type); core's chat apply in the module's
   card (GM-only, cannot heal). *Counter (medium):* the no-throw path is the
   same roller in modifiers and typing only, not in code.
10. **A recipient's record is the effect's lifetime; the flag stays.** A
    condition is `statuses: [key]` on the recipient's cast record, so ending
    the record ends the condition and no effect is stranded. A modifier row
    is classified by `modifierDisposition`: a standing one becomes a change
    on the record at a `MODIFIER_PATHS` path, any other is listed on the card
    and the record. Stacking: a condition is held or not (RR Appendix B); a
    printed non-stacking clause is authored as `notStacksWith` / `provides`
    and resolved by `resolveStacking`. The duration is `castDuration` with
    the resolved level, stored in the flag, with core's `duration` unset on a
    record that carries statuses or changes, because core counts an
    unconvertible rounds duration as already run. Ruling #11 is settled for
    the flag: a sub-type needs a world relaunch and leaves invalid documents
    when the module is off. *Rejected:* `holdCondition` (its managed guard
    would fight lib's loss path).
11. **Concentration is a held status on the caster's record.** Both
    concentration catalogue rows gain what they are lost to, the mechanism
    the `casting` condition already uses. Casting again warns and lifts it on
    confirm. When the caster's record goes, a card to the GMs and the
    caster's owners lists the recipients' records with an End button; the
    card tells and a press removes. A recurring row raises a prompt card at
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
15. **Casting time is taken from the cast's source.** The RR stat line prints
    none; the casting chapter's rule by source is structure, and a printed
    exception is captured from prose. Phase 1 shows it and acts on nothing.
16. **Judge tools ship with the engine.** The row editor's per-kind fields
    gain: damage `saveEffect`, `delivery`, `extraordinary`, `recur`, `pick`,
    `reversed`; heal `saveEffect`, `pick`, `reversed`; conditionGrant
    `saveEffect`, `lasts`, `recur`, `reversed`; modifier `notStacksWith`.
    Overview gains `target.hdCap` and `save.exemptBelowHd`. The Mechanics
    list marks `origin` and `unread`.

## Owner questions

Each phase proceeds on the recommendation until the owner answers; none
idles a slice.

1. When a recipient's record (a condition, a buff) runs out, does it stop
   applying by itself, with a card offering removal, or wait for a press as a
   summon does? *Recommended:* stop by itself.
2. When the same spell lands twice on one recipient and the book prints
   nothing, do both records land with a standing bonus counted once and the
   card saying so, or do both add? *Recommended:* count once.
3. Do damage, healing and conditions apply on a press (one "Apply all" for
   the Judge), or at cast? *Recommended:* a press.

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
applied}]}]}`.

## Bucket map

| Bucket (JJ ch. 14 axis or RR term) | Field | Phase 1 | Gap |
|---|---|---|---|
| Type | `type`, `schools` | shown | none |
| Effects | `effects[]` | ruling 9 roller, `hp.mjs`, status records, listed modifiers | `max` reserved |
| Targeting | `target.model`, `count`, `area`, `filters` | targeted tokens, HD cap per target | `hdCap` new; templates later |
| Attack required | `delivery` | magic throw | new key |
| Range | `range` | player blocked, Judge warned | none |
| Duration | `duration` | flag-held duration, expiry fan-out by `castId` | combat rounds do not age a record |
| Concentration | `duration.shape`, `concentration` | status, loss, end card | `castDuration` change |
| Until a save ends it | `recur` | prompt card | slice 3 |
| Casting time | `castingTime` | shown | rituals later |
| Saving throw | `save`, `saveEffect` | typed resist in the card | `save.kind` new |
| Save modifiers | `save.modifier` | per-row toggle | none |
| Stacking | statuses, `notStacksWith`, `provides` | held-or-not; card notice | owner question 2 |
| Source | `lists[].source` | tradition to caster level | 1b factors |
| Level | `lists[].level` | core's spend | slot caps later |
| Reversal | `reversible`, `reversed` | dialog mode | none |
| Choice at cast | `pick` | dialog | none |
| Triggered start, beholding and earshot, the perpetual cap, dispelling, targeting the dead, signatures | none or tracked | none | later phases |

## The cast flow

1. `item.use()` reaches lib's `_useSpell` wrapper; the summon claimant
   declines; `castSpell` claims, synchronously (casting seat).
2. `rowsOf(spell)`: own rows, else the twin's.
3. Caster level by ruling 6.
4. Dialog: mode, picks, level if needed, the target list, the range verdict,
   a concentration warning. Cancel spends nothing.
5. `spend()`.
6. Resist rolls per target: HD gate, then `saveThrow`, or `makeAttackThrow`
   with magic for a row with a delivery; the result is kept.
7. Rolls for rows with no throw (`magicDamageSpec`), and heals.
8. The cast card (`lib/roll-card.mjs`): a row per target, Apply for GMs and
   the target's owners, a tooltip on every figure.
9. The caster's record: `spellEffectData`, role caster, the flag duration,
   `held`, the recipient list.
10. Apply, on a press: `adjustHp` (damage by its multiplier, or a heal) and
    the recipient's record. Where the presser does not own the target, the
    GM's client applies after checking the request against the caster's
    spell item (the summon relay's precedent).
11. Expiry: the GM window's sweep covers every actor and unlinked token
    actor's caster records and fans out by `castId`.
12. Concentration lost: lib's loss path, the end card, the End press.

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
  per target, and whether a general stacking rule is printed (the oracle
  search found none).

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

Every slice: an offline suite on invented spells, then a walk from content
imported from the seat's own PDF. Commits go through `acks-commit`; nothing
is pushed without the owner's word.

**Session 1a: the channel and the vertical engine.**

- *S1, importer channel* (`implementer`): `lib/fields.mjs`,
  `magic/spell-extras.mjs`, `importer/executor.mjs` (new locatable kinds,
  `onMiss`, `unread`), `importer/cookbook/variations.mjs` `bindSpell`,
  `importer/refresh.mjs` (merge by `origin`),
  `tools/importer/lint-register.mjs`, the importer DECISIONS entry, and
  register rows for `def.spell.desiccate`, `def.spell.cureLightInjury`,
  `def.spell.frightenHumanoid`, `def.spell.holyCircle`. *Accept:* invented
  spells materialize, go blank on a miss and survive a repair by origin; an
  import from the PDF shows the four spells' rows with their figures.
- *S2, vertical engine* (`implementer` twice, lib then magic). Lib: the
  magic type in `patches/attack-throw.mjs`, `lib/saves.mjs`, the loss
  export, what the concentration rows are lost to. Magic: `cast-spell.mjs`,
  `apps/cast-dialog.mjs`, `templates/magic/cast-card.hbs`, changes to
  `spell-effect.mjs`, `cast-duration.mjs`, `cast-expiry.mjs`, the row
  editor's fields for these four kinds, and the TESTING recipe with its
  walk. *Accept, live:* `def.spell.desiccate` at several targets posts a
  typed save per target and applies the halved amount with its type shown;
  the reversed `def.spell.cureLightInjury` throws through core's card as
  magic with no melee modifier on the damage; `def.spell.frightenHumanoid`
  cast twice on one target leaves one condition and two records, and the
  condition stays when the first ends; `def.spell.holyCircle` loses
  concentration on damage and raises the end card; a core monster's attack
  item still posts core's card; a Player seat casts its own spell and cannot
  apply to an actor it does not own.

**Session 1b: widening.** *S3* (`implementer`): recurring rows and their
prompts, several instances per cast, picks, HD gates, range checks, the rest
of the row editor. Rows: `def.spell.blindingFlash`, `def.spell.thunderclap`,
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
`def.spell.sharpness`, `def.spell.silentStep`, `def.spell.spiderClimbing`,
`def.spell.slickness`.

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
> for spell effect rows and the vertical cast engine, for the four spells the
> plan names. Read the plan whole first, then `docs/magic/MODEL.md`,
> `.claude/rules/ip-doctrine.md` and `.claude/rules/live-testing.md`. You are
> the orchestrator: brief one agent per slice with the routing the plan
> gives, quote the owner's words from the plan in every brief, review each
> agent's change against the IP doctrine yourself, and drive the live walk
> yourself. Settle the plan's "Not verified" list before the code that leans
> on each item. The level 1 matrix is on the rules shelf beside the magic
> extract (`L1-EFFECTS.md`); it is LOCAL-ONLY. Proceed on the three owner
> questions' recommended answers. Commit each finished slice with
> `acks-commit`; push nothing. Finish by appending a "Results, 1a" section to
> the plan (what was built, walked and not walked, by sha), writing the
> session 1b start prompt under it, and reporting to the owner. You start no session;
> put the next one up as a card.

## Results

None yet.
