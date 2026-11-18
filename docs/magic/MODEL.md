# Magic — Design Model

The magic feature is the spell primitive on the acks system's `spell` Item,
the vocabulary every magic surface shares, and, as each part lands, the
spell builder, the cast engine and the tracking of what a cast leaves behind.
Two sibling features build on it: `magic-items` and `research`. The design of
the whole program stays in [wip/20260924-scoping.md](wip/20260924-scoping.md)
until each part lands here.

## What exists now

**The vocabulary** (`scripts/lib/magic-vocab.mjs`, re-exported by
`lib/vocab.mjs` so every consumer keeps one import path). Sixteen families:
the thirteen spell types; the shapes a printed range line and a printed
duration line take; distance and time units; the two kinds of concentration;
casting-time shapes; target models and area geometries; the creature filters
a spell applies; save categories and what a passed save does; heal kinds;
control dispositions; summoning formats; and the one frequency table shared
with abilities and monster powers. Three of its members are `printed`
(`printedFreq1` to `printedFreq3`): the module acts on the frequency and the
book words it, so each has a neutral label and the importer's frequency scan
(`frequencyFieldsOf`) keeps the page's phrase beside the key, as an effect
row's `frequencyText` or a monster item's `usageText` flag. A window shows
that phrase through `printedFrequencyText` and falls back to the label; a
frequency a Judge picks by hand clears the phrase. Each family is a descriptor map with an
inline label. The label a window shows comes from
`ACKS-LIB.enum.<family>.<key>` through `vocabLabel` (`vocabChoices` builds a
select's options the same way), and `tools/test-magic.mjs` proves the lang
file complete in both directions. Which lists are families and which ship
empty is [DECISIONS.md](DECISIONS.md), "A code enum names a mechanism".

**The spell kinds in `EFFECT_TYPES`** — damage, heal, summon, control,
transform, wall, detect, dispel, ward, illusion, light, teleport, createObject,
structural, curse, ignite — carry `domain: "spell"`, and `effectTypesFor(domain)`
keeps them out of an ability's picker while a spell may carry every kind.
`ignite`, setting a thing alight, is a record-and-card-line kind like the
others that have no arithmetic of their own: it is a line on the cast card from
`describeSpellEffect` and nothing more is computed from it.

**The tracked kinds** — illusion, detect, light, dispel, createObject, wall —
are the same record-and-card-line shape, and the register authors a row of one
for thirteen first-level spell entries (each reversed form its own row, marked
`reversed`). A row that lasts the spell's duration carries `lasts: "duration"`
and is one line on the cast card plus, where the spell's duration is timed or
held, the caster's one record (one record for several such rows); a row spent
in the cast carries `lasts: "instant"` and is a line and no record. Nothing is
rolled or applied for them: a row with no `delivery` is no throw row,
so a dispel row posts no section, no Throw press and no Apply. A spell with a
reversed row offers the cast dialog's reverse mode, and each form posts only
its own line and records its own cast. The register leaves their sizes and radii
blank.

**The spell primitive** (`scripts/magic/spell-extras.mjs`, `SpellExtras`) is
a DataModel read through `flags["acks-extras"].spell` on the acks system's
own `spell` Item; `fromItem` reads it and `normalize` coerces a raw object
into it. Its fields: `lists[]` — one row per list the spell prints on,
`{source, level, classes, note}`, `source` an open magic-type key; `type`, a
`SPELL_TYPES` member; `schools`, `elements` and `components`, open strings;
`range` and `duration`, a shape from the vocabulary with a value, a unit and
a note; `castingTime`; `target` (model, count, area, filters) and `save`
(category, what a passed save does); `reversible`, `reverseOf` (a spell
reference) and `reversedName`; `ritual`; `effects`, the `effectsField()` rows
in the shared vocabulary; `notableUse`; `cite`; `unaudited`. Core's `lvl`,
`class`, `range`, `duration` and `save` are written from the flag by
`spell-logic.mjs` `coreFieldsFrom` ([DECISIONS.md](DECISIONS.md), "Core's
strings are derived"), so the system sheet, the character sheet and every
consumer keyed on the strings keep reading.

A spell's effect row carries the fields a cast reads beside the shared
vocabulary's own (`lib/fields.mjs` `effectField`): `saveEffect`, `delivery`,
`extraordinary`, `lasts`, `recur`, `pick` and `reversed`; `max`, the ceiling of
an instance count; and six that name where a row belongs or how it runs:
`pickOption` (rows sharing a `pick` and a `pickOption` are one option of a choice
group), `recurAt` (the caster's turn, or the start or the end of the bearer's),
`recurSave` (blank, or a save whose pass ends the row's record or the whole
cast), `recurTarget` (blank for the bearer, or a target the caster picks each
time), `rounds` (the dice formula a `lasts: rounds` row counts, located from the
page) and `exemptSizeFrom` (the monsters size key at or above which a target is
exempt from that row). `lasts` is `instant`, `duration`, `nextTurn` or `rounds`
("A record that lives", below, for the last two); `recur` is `none`,
`eachRound` or `laterRounds`. No cast reads `recur`, `recurAt`, `recurSave` or
`recurTarget` yet; they are authored, imported and edited so a recurring row
exists as data.

**The sheet** (`spell-sheet.mjs`, `createSpellSheet(Base)`) is built at
ready as a subclass of the system's registered spell sheet and registered as
the default for `spell` Items. Three tabs: Overview, the stat line as
structure — a shape picker with its value control per line, the lists, the
reversal pair, and the two Hit Dice figures a cast gates on, `target.hdCap` and
`save.exemptBelowHd`, each a level-value control whose tooltip is the spell's
page reference alone while it is blank; Description, core's own part with its
strings editable and following the flag; Mechanics, the effect rows through the
shared row editor (`lib/apps/effect-row-editor.mjs`, over a store the sheet
supplies; `fieldsForType` lists per kind which fields it edits, every cast field
above on the kinds that read it and `pick` and `pickOption` on every kind) with
the system's Active Effects folded in below. Each row of the Mechanics list
shows its kind, its reading from `describeSpellEffect`, its option where it has
a `pickOption`, a mark for where it came from (the register's, or a hand's: a
Judge's edit clears `origin`), and each field the import left blank (`unread`)
beside the spell's page reference, which is also that blank's tooltip. A summon row names its creature
where the world can open it: `describeSpellEffect(e, {nameOf})` takes the
sheet's lookup (lib's `summonRefName`), and with none, or none found, prints
the ref. `acksExtras.magic` exposes the
model, the stat-line readers and writers, the traditions and dedupe key the
class picker uses, and `stripModuleData`.

**Importing spells** (`register/_kinds/spell.json`, `kind.spell`; the
register rows under `register/rr/`). One row per printed entry of the RR's
spell descriptions and of its sample rituals. The row's anchor is the
heading; a proper-name heading carries a locator hash instead of the words,
and `assists.columns` states the page's two column lefts, because a long
entry that fills one column defeats column detection. The compiler
(`tools/importer/compile-cookbook.mjs`, the sub-heading branch) emits three
fields: `name`, an `expect` or `heading` op over the heading box; `stat`, one
raw `value` op over the two-line block beneath it; `description`, text
paragraphs to the next heading, flowing across the column and the page. At
import `cookbook/variations.mjs` `bindSpell` parses the block (`parseStatBlock` →
`spellFromStat`), reads the asterisk and the reverse's name off the prose,
and writes one core `spell` Item: the flag, core's strings, the prose as the
description with its cite, the row's icon, the cookbook stamp. `importSpells`
is the entry — `acksExtras.importer.importSpells()`, the *Spells* shelf of
Reimport One Shelf, and the getting-started step that runs before the classes
so a template's spellbook finds what it names. A row carrying authored `effects` and `values`
recipes (the importer's "Spell recipes", docs/importer/MODEL.md) also writes
the effect rows, each `origin: "register"`, and the figures and captured
words its locators read into `target` and `save`; a row with none writes no
effect rows. A missed capture leaves its field blank and the row's `unread`
names it. `REPAIR.spell` (`refresh.mjs`) keeps `cast`, `memorized`,
`favorite` and a description the Judge wrote across a repair, and holds the
rows and `values` leaves a Judge changed (docs/importer/MODEL.md, "Spell
recipes"). Each row carries a `key` (`effectField`), which is how a repair
matches a stored row to the register's; the row editor's add mints a Judge's
own, its edit clears `origin`, and its delete adds a register key to
`SpellExtras.retired`, so a repair does not write the row back. A damage-type mark in the prose lands as its word through the
shipped `damageGlyph` table (executor `glyphWords`); the mark's colour does
not, so the extraordinary mark of a damage row is not read from text.

**An area's measure** (`target.area`: `shape`, `measure`, `size`, `width`, `unit`,
`height`). A page prints an area's size as a radius, a diameter or a length by a
width, so the spell keeps the figure as printed and which measure it is
(`AREA_MEASURES` in `lib/magic-vocab.mjs`); the importer's recipe states the
measure and locates the size and the width, and `unit` is a `DISTANCE_UNITS`
key, feet unless set. `cast-area.mjs` `areaExtent({measure, size, width, height,
unit})` is pure and stores nothing: it turns the resolved figures into one extent
in feet (a radius gives its diameter and the reverse; a length carries its width),
and a size with no known measure gives no extent, since the figure alone does not
say which one it is. The Overview's Measure, Unit and Width controls edit the
fields, and the Extent in feet beside them carries a tooltip naming its parts: the
measure, the figure and unit as printed, the unit's worth in feet, and the page
reference, which stands alone where nothing could be normalized. A size that
varies by level shows no extent on the sheet.

**The rung editor** (lib `rung-view.mjs`, draft and model `rung-ladder.mjs`). A
figure that is a level value takes a kind switch drawn as a button group (Flat,
By caster level, By invocation level; `aria-pressed`), and "By invocation
level" is a UI choice, never a stored kind: it stores `{kind: "conditional",
on: "invocationLevel", breakpoints}`, and a figure the importer wrote as that
ladder opens on it. The switch is on each of the Overview's eight figures
(`LEVEL_VALUE_PATHS`) and on a row's `value` and `max` in the effect-row
editor. The ladder's rungs (a level and the figure from it up) are edited
inline, under the switch, in the row editor and on the Overview alike. They are
a DRAFT (`RungDrafts`), held on the window and keyed by figure, apart from the
form: a rung box has no `name` and its `change` is stopped below the form, so
neither the row editor's apply-on-change nor core's submit-on-change sees it,
and the draft outlives every redraw those make. Only a ladder is drafted. Every
other field of the window, and a figure that is no ladder, keeps writing on
change. Levels are whole numbers and rise strictly, a figure left blank is null
and resolves to no figure, and a ladder's bar (the verdict, Cancel, Save) is
disabled while the draft is invalid, so no invalid ladder is ever written. The
row editor's bar is a pinned footer part, "Save row", over every ladder the row
holds (a row's `value` and `max` save in one write); the Overview draws the
bar under each figure's rungs, "Save rungs". Save writes once. A kind button
applies at once and drops the figure's draft; closing a window drops its
drafts. The Overview's store (`spellFigureStore`) writes the figure's flag
path through the spell's normalisation and lets core's strings follow, as a
sheet submit does; a row writes through the row's own `store.write`, which
makes the row the Judge's. The write is a Judge's (`game.user.isGM`, checked in
every draft mutator and in Save): a Player sees the ladder read-only, with no
bar and the kind buttons off the invocation scale, and no write is sent. A rung
a hand changed or added carries `hand`, and an edit keeps the figure and level
it replaced (`was`, `wasAt`): the gold edge and the tooltip read them, and the
page the spell cites stays on every imported rung's tooltip, alone where the
import left the figure blank. "Restore imported" puts edited rungs back and
drops added ones; a rung a hand removed is not kept anywhere.

**A row's scope.** A modifier or ward row scopes itself with `lib`'s scope fields
(docs/lib/API.md, "Scoping"): kinds, an alignment fixed or the source's, an enemy
test and an `anyOf` of branches. A spell's rows author them as structure, and
the importer's recipe ships them with the row; the row editor edits the flat
fields and shows an `anyOf` as text, keeping it as stored. No cast reads a
spell's scope against an attacker yet.

**Printed names** (`spell-names.mjs`, pure). `titleIndex(pairs)` resolves a
printed title whole, in the singular, or from a column's closing abbreviation
— over the register's entries at import, over the world's documents at bind
(`repertoire.mjs` `spellsByName`). `splitSpellNames(text, known)` splits a
printed list on commas, semicolons and conjunctions and rejoins an "and"
that is a title's own word ([DECISIONS.md](DECISIONS.md), "An "and" can be a
title's own word"); the importer's `liftBookSpells` reads a starting
spellbook through it. `scanMonsterSpells` reads a creature's prose four ways
— "(as the spell X)", "X (as the spell)", a spell-like-abilities list opening
on a frequency or closing each group on one, a printed repertoire by level —
and
`castsAsClass` / `castSourceOf` read what it casts as; `levelUnder` gives a
spell's level under a tradition off its lists, else core's own.

**Repertoires** (`repertoire.mjs`). A slot count read off a template's cell
(`slotsFromCells`) or a class's grid at a level (`slotsOfClass`) is written
onto core's `spells` block (`coreSlotsPatch`) and read back
(`slotsOfSystem`); `drawRepertoire` draws as many distinct spells of each
level as the slots say, and `repertoireFor(source, slots, {level})` draws
from the class picker's own list for a class document, a class name or a
bare tradition ([DECISIONS.md](DECISIONS.md), "A creature's repertoire is
drawn to its slots"). The importer's monster binder carries the result as
embedded copies (`spellPayload`; `docs/monsters/MODEL.md`), and
`fillGeneratedRepertoire` does the same for a generated creature on the
generator's `acksExtras.templateResolved` hook (`lib/constants.mjs`
`TEMPLATE_HOOKS`), registered at init. `acksExtras.magic` exposes all of it.

**Casting: durations and the cast record.** Two pure files shape what a cast
leaves on an actor; neither casts. `cast-duration.mjs` `castDuration(duration,
{casterLevel, roll})` reads a spell's duration object (the flag's, shape plus
value, unit, dice and the plus pair) into the `{value, units}` pair a Foundry
Active Effect stores, or `{none: <reason id>}`. Every figure comes from the
object and the caster: `fixed` is its value, `perLevel` the value times the
caster's level, `basePlusPerLevel` the base plus the per-level figure times the
level and only when both are in one unit, `dice` the injected `roll(formula)`
(synchronous; Foundry's `evaluateSync` serves). A caster's level is never
defaulted: a shape that needs one without it answers `noLevel`. Instantaneous,
every concentration, perpetual, indefinite, permanent and special have no time
to count and answer `untimed`. The unit map has one row per `TIME_UNITS`
member: rounds stay rounds, an ACKS turn becomes seconds through
`TURN_SECONDS` (Foundry's `turns` is a combat turn), a week becomes seven days,
and minutes, hours, days, months and years pass through. Core 14's effect
duration has no seconds-only shape beside `{value, units}`, so a `seconds`
count is a `value` in the `seconds` unit. A `rounds` duration is correct data
that Foundry ages only through a combat's round counter: the world's
round length is zero, so outside combat it does not run down on the clock.
`TURN_SECONDS` and `ROUNDS_PER_TURN` are the module's own time unit, owned by
`lib/constants.mjs`; `formation/constants.mjs` re-exports them under the same
names.
`spell-effect.mjs` is the cast record: `spellEffectData({spell, caster, castId,
role, duration, changes, transfer, name})` returns Active Effect creation data
with `origin` the spell's uuid, the spell's name and image, the cast's
duration, and `flags["acks-extras"].spellEffect = {spellUuid, castId,
casterUuid, role}`, role `caster` or `recipient`. One `castId` (`newCastId`)
ties the caster's record to each recipient's. `spellEffectOf(effect)` reads the
flag back or answers null. The record is not a managed effect
(`lib/managed-effects.mjs` locks only markers a feature registers), so its
owner may delete it.

**Summon spells** (`summon-spell.mjs`, pure apart from injected lookups).
`isSummonSpell(item)` is true for a `spell` item on an actor of type
`character` whose flag carries a `summon` effect row, or whose type words
(`schools`, which keeps every word a stat line printed) or primary `type` name
the summoning type; a spell on a monster or on no actor is never summonable.
`summonOptionsOf(spell, {twin})` turns each `summon` row into `{ref, name,
amount, value, max, summonFormat, control}` (`value` is the row's LevelValue
object and `max` the count's ceiling at the caster level, both passed through
unresolved; `name` is the creature's imported name where the row carries one,
else empty); a spell with no rows of its own reads its library twin's, and no
rows at all is `[]`, which the caller reads as the open shelf picker. An empty
`ref` is an open pick within a row. `libraryTwin(spell, {byCookbookId,
fromUuidSync})` finds the twin by the cookbook stamp, else by the document
`_stats.compendiumSource` names. `resolveSummonRef(ref, {fromUuid,
byCookbookId})` resolves a uuid first (a `uuid:` prefix is dropped), else a
cookbook id on the Actor shelf, else null.

**Uninstall** (`uninstall.mjs`; the *Uninstall — Strip Spell Data* macro)
strips the flag from every spell item in the world, on world actors and on
unlinked token actors; core's strings stay, so a spell keeps its stat line.
The importer's provenance stamp is the importer's to strip.

**Casting a summoning spell** (`cast-summon.mjs`). A claimant on lib's cast
seam (key `acks-extras.magic.castSummon`, registered at `init`) takes the cast
of a summoning spell on a `character` this seat owns, whichever door the player
pressed (the system's sheet button, the Magic tab's Cast, a macro); `claims` is
synchronous and never answers true for a monster's spell items or a character
the seat does not own. Its `cast` asks with lib's `pickSummon` (the spell's rows
as the choices, the first row's amount as the count), has the seat click the
places and the GM's client make the tokens (`placeSummons`, naming the spell),
and calls the seam's `spend()` only when the relay answered ok, before `cast`
returns: a cancel, a closed prompt or a refusal spends nothing. The system's
`use()` does not await `_useSpell`, so `castSummon(spell, options)` (also on
`acksExtras.magic`) awaits the wrapped `_useSpell` for a caller that must wait.
After the spend the caster gets one cast record (`spellEffectData`, role
`caster`, `castId` the relay's answer, so it matches the summons' record), whose
duration is `castDuration` of the spell's imported duration, else its library
twin's. No caster level is passed, because a class level is not always the
caster level (a lagging ladder), so a per-level duration reads "none" and the
record stays until its owner removes it.

A summoning held by concentration writes the held record a held cast writes
(the `concentrating` or `concentratingStationary` status by the kind, `held`,
the `tail`, the start time, and a flag-timed cap only where it needs no level),
and any summoning cast first ends what the caster already holds by concentration:
a notice (`ACKS-MAGIC.cast.notice.endsConcentration`) names the held cast and the
new spell, to a Player seat and the Judge alike, and `endCasterHeld` ends it
before the new record is written, so the end posts the funnel's card with the
cause `cast`. A summons is not declared: in a begun fight it resolves at the cast
like any other, with no `casting` status, pending record or declared flag. The
end of a held summons posts the funnel's card (Restore, no Dismiss) and leaves
its creatures on the map; Dismiss belongs to the card of a timed cast's end.

**The five built summons** carry a `summon` row in the register: a calling and
a summoning that each name their creature by cookbook id (`ref`), a conjuration
whose creature is a template actor and so names none, and two animation spells
that name none. Each row carries `control`, read from its own page, and
`summonFormat` where the page names the kind; a count and Hit Dice are located
from the page and stay blank on a miss. A count that scales with the caster level
is carried as `max` (unresolved) with no `amount`, because the policy caps a
count at `amount` and would otherwise cap it at one.

*The creature resolves on the GM's client.* A row's `ref` is a uuid or a
cookbook id. A seat that cannot open the creature's shelf (the Judge's shelves
are closed to players) still offers the row when its ref reads as an id, labelled
by the row's `name` or else "Creature N", and passes the ref on untouched; the
GM's client resolves it (lib MODEL, "Summons"). The preview that seat places is
the plain token core draws for one with no picture, so the creature's size and
look are unknown to it until the tokens appear.

*Two rules ride lib's registries* and read the summoner's spell item on both
sides. The naming (`registerSummonNaming`) says a spell names a creature when
one of its non-empty rows' refs equals the creature's uuid, its cookbook id or
its name; only a spell-named creature is exempt from the shelf-readable check.
The policy (`registerSummonPolicy`) refuses `notNamed` (the rows name creatures
and this is not one), `badCount` (more than the amount every fitting row states)
and `badSpell` (a seat that may not summon bare naming a spell that is no
summoning spell). A row with no ref is an open pick that fits any creature; a
row stating no amount sets no limit; a spell with no rows asks nothing. Both
read the spell item the player owns, so they hold a player to what the spell
says and to nothing a player can not edit on their own item.

**A cast's end** (`cast-expiry.mjs`, registered at `init`). On each forward
step of the world clock, read on the one GM window lib's `onWorldTimeAdvanced`
fires on, the cast records of every world actor and every unlinked token's actor
(lib's `worldActors`) are checked against their end: the record's `start.time` plus its stored duration, a calendar unit
converted by the world's calendar the way core converts one, `rounds` at
`ROUND_SECONDS` (`TURN_SECONDS` over `ROUNDS_PER_TURN`). A record with no
duration, or one in a unit the clock cannot count, never ends here. Core's own
`duration.expired` is not read (DECISIONS, 2026-11-11). A record the cast
engine timed itself carries its `duration` and `startTime` in the flag and is
read from there first; it is not announced but deleted by id when its end
passes, so the status it held ends with it and a second record of the same cast
keeps its own end (`endAction`: announce, delete or nothing). A record past its end
is stamped `ended` (the world time, in the `spellEffect` flag; `spellEffectOf`
reads it back) and only then, where its cast still has creatures standing on
any scene, one card is whispered to every GM and every other owner of the
caster: the spell, the caster, the count, and a Dismiss button that runs lib's
`promptDismiss` on that cast's tokens and the summons held in a party token
(`castSummons`, matched by the summons' `castId`); the count the card states
includes the held. The card tells; the creatures stay until someone presses it. A
recipient's record is never announced, since it carries the same cast. Combat
does not move this system's clock, so a combat's rounds age no record by the
clock; a record anchored to turns is aged by turns instead ("A record that
lives", below).

**A record that lives** (`cast-life.mjs`, pure; `cast-apply.mjs`). A condition
row whose `lasts` is `nextTurn` or `rounds` writes its status-only record with
two ends, and the first to come deletes the record by id. The clock end is the
record's own flag `duration` and `startTime` (above): one round for `nextTurn`,
the rolled rounds for `rounds`, counted at `ROUND_SECONDS`. The turn end is lib's
`turnLife` flag, `flags["acks-extras"].turnLife` beside the `spellEffect` mark,
`{combatId, combatantId, edge, count, seen}` with `seen` zero, which lib lifts
at its edge (lib MODEL, "A record that lasts turns"): `nextTurn` is
`{edge: "end", count: 1}`, the end of the bearer's next turn, and `rounds` is
`{edge: "start", count: rolled}`, the start of the bearer's turn that makes that
many begun since the cast. It is written only where the writing client finds the
bearer a combatant of a begun fight (`cast-moment.mjs` `fightHolding`, over the
viewed fight and every other, matching a token by its id before an actor, with
`begun` the notion `castMoment` reads), through `deps.fight`; with no fight, a
bearer who is no combatant, or a fight that has ended, the clock alone ends the
record. `lifeOf(row, {count, fight})` answers the kind, the rounds, the flag and
the row's formula; `spellEffectData` takes the flag as `turnLife` (a malformed
one is not written) and `spellEffectOf` reads it back.

The count of a `rounds` row is rolled once per target's record, on the casting
client, as `buildTargets` opens the entry: `life {kind: "rounds", count,
formula, detail}`, the roll on the message, a total below one held to one round.
`requestOf` carries `rounds` in the apply request, and `checkApplyRequest` holds
it to the reach of the spell's own formula (`roundsBounds` over Foundry's
extremes; `badRounds` for a count that is absent, not whole, or out of reach, or
sent for a formula that cannot be read). A blank formula, a missing or invalid
count and a formula that will not roll leave the record untimed; the card then
carries the page reference alone. A modifier or ward row's `lasts` of either kind
times nothing. A condition record lives, and so does the recipient record of an
`ignite` row (below), written status-free with the same `life`.

**A ruling-14 kind with a recipient writes the recipient's record.** A kind with
no arithmetic is a card line and a record. `writesRecipientRecord(row)`
(`cast-spell.mjs`, `RECORD_KINDS`) names the rows whose record is the
recipient's: today `ignite` alone, with a recipient (`appliesTo` not `self`) and a
`lasts` of `duration`, `rounds` or `nextTurn`. Such a row is a section of the card
with an entry per target, beside its `describeSpellEffect` line, and applies as a
condition does but with no status: `conditionRecords` leaves one status-free
recipient record carrying `rowKey` and `startTime`, timed by the row's `lasts`
(the cast's duration, or the `life` of a `rounds` or `nextTurn` row, with its
rolled count in the request, held to the formula's reach as a condition's is). The
save is not rolled for it. An `ignite` row that lasts once (`instant`) or is the
caster's own stays a line. Every other ruling-14 kind stays a line until its own
row asks for a record.

**Recurring rows** (`cast-recur.mjs`, `cast-rows.mjs` `recurringRows`, registered
at `init`). A row's `recur` is `eachRound` (resolved at the cast like any row, then
recurring) or `laterRounds` (a damage or heal row is withheld from the cast: no
roll, no entry, a card line says it waits; a condition row is applied at the
cast). `recurAt` names the moment (`casterTurn`, `bearerStart`, `bearerEnd`;
blank names none), `recurSave` what the bearer throws first (`row`: a pass ends
that bearer's records of the row; `cast`: a pass ends the cast), `recurTarget`
whom it meets (blank, its bearers; `pick`, a target the caster picks). A row
recurs while its anchor stands: a caster-turn row on the caster's record of the
cast, which `castSpellRun` writes for a timed cast (its `timed` test counts
`castersTurnRecurs` beside a row that lasts the duration; flag-timed). An untimed
cast writes the record only where a caster-turn row asks `recurSave: cast`, whose
passed save ends it (`endCast`); that record carries no start and no duration, and
an untimed cast with no such row writes none, since the record would never end. A bearer row on a
recipient record of the cast the bearer holds. Where the cast writes the bearer no
such record, `anchorsNeeded` names the row and `applyOnTarget` writes a status-free
recipient record carrying `rowKey`, `startTime` and the row's life (its `lasts`,
else the cast's duration); a row `recurSave: row` stands on a record carrying its
own key, so it writes one of its own, and the rows that ask only a record of the
cast share one. A save that negated the row, a judged entry and a pick row write
none; a prompt's own entries are never anchored. The anchor is named among the
entry's `recordIds`, so Undo takes it off. A `laterRounds` damage or heal row has
no entry at the cast, so it writes no anchor of its own: it prompts only where
another row of the cast leaves the bearer a record (a condition row, an `ignite`
row, an `eachRound` row).

*The prompt.* On lib's `acksExtras.turnBegan` and `acksExtras.turnEnded`, which
fire on the primary GM's client alone, `duePrompts` answers the prompts the
combatant's turn raises: at a start, the caster-turn prompt of each cast whose
caster it is (while the caster's record stands; it meets every bearer of the cast)
and the bearer-start prompt of each cast it holds a record of; at an end, the
bearer-end prompt. The cast is found by the `castId` on the actor's records, its
card by the message holding that `castCard` and no `recurOf`, its rows by the
card's mode and picks; with the card, spell or caster gone nothing is posted. The
GM's client posts, through `postCastCard`, one card per cast, moment, round of the
fight and bearer (`samePrompt` skips a repeat): a `castCard` model
(`promptModel`: the cast's spell, caster, level, mode, picks and save, a row each
with nothing rolled, a target per bearer, a pending entry for each row a bearer
meets, `recur {moment, round, combatId, bearer, pick}`) and the message flag
`recurOf {cardId, castId, round, combatId, moment, bearer}` (`bearer` is the
actor's uuid, blank for a caster-turn prompt and a Next round's, which meet them
all; the prompt's targets are actors, so the presses read a target's actor from
an actor or a token alike). A prompt asks damage
and heal rows, and condition rows that ask a save. Outside a fight the cast
card's **Next round** (the caster's owners and GMs, through `magicCastNextRound`)
posts each moment of the round in turn for every bearer, counting rounds on the
card (`recurRound`); the GM's client refuses it while a begun fight holds the
caster. With no GM connected no prompt is posted on the hook, and Next round
answers no GM.

*The presses* roll on the presser's seat and are applied on the GM's client. A
prompt's entries have no Apply: **Save** (`magicCastSave`; the bearer's owners and
GMs) rolls the bearer's saving throw against what the row resists
(`resistedDamage`), and where the pass does not negate the amount (`saveFractionOf`)
rolls the row's damage or healing too; **Roll** (`magicCastRoll`; the caster's
owners and GMs) rolls the row and applies it, with no save, to the bearer. A **pick
row** has one line with Roll: the presser's one targeted token must be within the
spell's range (`pickRange`, a Player blocked and a Judge warned; the relay does not
measure again), and the relay adds it to the prompt as a target. Nothing is ever
auto-rolled, an NPC's save included. The relay (`relayRecur`) requires a prompt a
GM authored, the requester owning the bearer for a Save and the caster for a Roll,
a row the prompt asks that recurs, an anchor that still stands, and a Save only on
a row that asks one and a Roll only on one that asks none; a pick row is pressed
once and only with a target named, any other with none (`checkRecurRequest`).
Level, mode, picks, rows and duration come from the original cast card
(`worldFor`'s `source`), and the rest is the cast relay's own check
(`checkApplyRequest`): the save's target and total recomputed, the amount within
the row's bounds, the gates. A passed save that negates carries no figure
(`settleEntries`). The damage or healing goes through `applyOnTarget` as a cast's
does (defenses, rounding, instances, a failed save's loss path). A pass then ends
what the row asks: `recurSave: row` deletes that bearer's records of the row;
`cast` deletes the caster's held record with `endCause: "saved"`, so the one
funnel ends the cast and its card lists what ended (cause "A passed saving
throw"), and a cast not held ends its own records and the caster's. The entry
keeps `ended {kind, count}`. Entries and Undo live on the prompt card.

**Casting a spell** (`cast-spell.mjs`, registered at `init` after the
summoning's). A second claimant (key `acks-extras.magic.castSpell`) takes the
cast of a flagged spell item on an actor this seat owns when the spell is no
summoning and has effect rows of its own or of its library twin's
(`cast-rows.mjs` `rowsOf`, the copy's rows winning), or whose tradition has a
registered procedure ("A tradition's procedure", below), rows or none and
summoning or not; it declines a rowless spell with no procedure, an actor the
seat does not own and any item that is no spell, so a monster's attack item stays
the system's. The cast runs in this order, and a
cancel at any point before the spend costs nothing:

1. *The dialog* (`apps/cast-dialog.mjs`, `apps/cast-dialog-model.mjs`,
   templates `cast-dialog.hbs` and `cast-dialog-footer.hbs`): an
   ApplicationV2 with a scrolling body and a pinned footer, the `acks-extras-cast`
   class on its root. The model file is Foundry-free and shapes the answer
   state and the render context; the window captures its named controls into
   that state before every render, so a re-render keeps what was typed. It holds
   the form of a reversible spell, the pick of each choice group, a kind select
   where a spell's rows offer `vsKinds` choices, the caster level where
   nothing resolved one (marked as set by hand in its tooltip), the spell's own
   save modifier as a toggle (off by default; the figure is the import's, read
   at the caster level, and joins the throw as one part named by the spell), a
   situational save modifier, the card's visibility, the targets bucket and each
   verdict. A verdict that blocks a Player disables Cast for that form. Each
   effect row leads with a cell in the character sheet's tone (`is-neg`,
   `is-pos` or the neutral one) holding a condition's status image or a glyph.

   *The targets bucket* is the seat's own `game.user.targets`, not a list of the
   window's. A row's X is `setTarget(false, {releaseOthers: false})` on that
   token; the Add my token button is `setTarget(true, {releaseOthers: false})`
   on the caster's canvas token; T on the canvas and the key on the board change
   it too, and the window re-renders on `targetToken` (this user's, debounced)
   and unhooks on close. A drop on the bucket's strip is a Token (targeted) or an
   Actor: one active token on the scene is targeted, none gives a notice, several
   a notice that asks for the token itself. Targets are per user, so the bucket
   uses no GM-only call and works at a Player seat. Each row shows the measured
   distance (tooltip: the parts, from `cast-range.mjs`), the weapon pick for a
   holder of a gated row (a pill per live weapon of that token's actor, each
   marked magic where lib's `isMagical` says so; the pick is stored per token
   uuid and the default is the equipped weapon, else the first), the throw split
   input per token, and chips for the verdicts that name it. The engine reads
   the seat's tokens and gaps again after the answer, so a target changed while
   the window was open is the one cast on. `wait()` resolves null on close. A pick option is one or
   more rows: rows sharing a `pick` and a `pickOption` are one option, a row
   with a `pick` and no `pickOption` is its own option keyed by its row key
   (`cast-rows.mjs` `optionTokenOf`), and the choice stores the option token.
   Its label joins the `describeSpellEffect` reading of each of its rows. Where
   a range could not be measured the dialog says so beside the targets. A
   thrown row whose count is above one, with several targets, offers a split of
   its throws: a number per target, round-robin by default, its tooltip naming
   the count's parts; the total is read as it is typed, and a total over the
   count shows its verdict and stops a Player (a split shown for a choice's
   option or a form not chosen is hidden and answers none).
2. *The verdicts* (`cast-plan.mjs`), a Player blocked and a Judge warned: no
   slot at the spell's level, several targets for a thrown row whose count is
   one or blank, a split of throws over the row's count (`tooManyInstances`,
   judged on the answer, before the spend), a
   condition that forbids casting, and `oneBearer` where a kept row is gated on
   the weapon and the seat has not targeted exactly one token; in a begun fight,
   `declarationLost`, `noDeclaration` and `declared` ("A declaration", below);
   and `concentrating`, which is always a warning. `outOfRange` and
   `tooManyTargets` are not judged at a declaring, since the gap is measured at
   the turn, on the declared targets. They are checked after the dialog and
   before anything is spent.

   *Range* (`cast-range.mjs`) is measured per target, centre to centre. The
   spell's `range` gives a figure in feet only for a distance, a touch-or-
   distance, or a distance per caster level (the figure times the level, read
   once a level is known); every other shape and a blank figure judge nothing.
   `readWorld` measures each targeted token against the caster's token with
   lib's `tokenGapFeet` (the scene grid's `measurePath`, in the scene's unit).
   A creature, recipient, Hit Dice pool or object target must be within the
   range; a target of an area spell within the range plus the area's reach
   (`cast-area.mjs` `areaExtent`: its radius, else its length). A model with no
   such reading, a blank area extent, no caster token and a target on another
   scene give no verdict, and the dialog notes that the range was not
   measured. The verdict line names the targets out of range; its tooltip gives
   each one's measured distance, then the range's parts (the figure, the caster level, the
   reach) and the spell's page reference, all from the world's figures. The
   relay does not measure again. *A target count* the import read (`target.count`,
   at the caster level) caps the targets, and `tooManyTargets` says how many are
   over; a blank count caps nothing.
3. *The spend*, once: the seam's `spend()`, and `adjustPool` for a vancian
   tradition (`cast-capacity.mjs`: the tradition whose key or label a list of the
   spell names, its slot at the spell's level less what the actor spent; a
   points tradition is shown and not spent; with no tradition, core's
   `system.spells` count less the summed `cast`; else unknown and no verdict).
   The spend also ends what the caster holds by concentration (`concentrating`
   always warns and never refuses): the caster's held records are deleted by id,
   naming the cast as the cause, after the spend and before any record of the new
   cast, and the cast waits for each end's card ("Concentration's end", below). A
   cast that resolves a declaration spends nothing ("A declaration", below).
4. *The caster level* (`cast-level.mjs`): the typed figure, else the matching
   tradition's caster-level ladder at the class level (the class level where the
   ladder is blank), else a monster's spellcasting level; never defaulted. It is
   asked for only where the duration, the range, the target count, the area's
   size or a row (its `value` or `max`) scales with it.

   *The invocation level* (`cast-level.mjs` `invocationLevel(ctx, answer)`) is a
   second figure, apart from the caster level and never defaulted from it. A
   spell reads it two ways: a row bounded by `invocationFrom` and `invocationTo`
   (both counted in, a blank side open), and a LevelValue keyed on the
   `invocationLevel` scale. It is offered where the tradition has a cap
   (`traditionCapAt`, the classes feature's, read through `castReading`'s `capAt`
   and left on the register call's `caps` by spell; with none every level is
   open) or where a raw row or figure reads the scale (`readsInvocation`, judged
   before a gate drops a row, since with no level set the kept rows show no sign
   of it). The answer is `invocationLevel`, a whole number from one up; the
   result is `{value, source, cap}`, `source` being `chosen` under a cap and
   `hand` without one. `overCap` (above the cap) and `invocationUnset` (a row or
   figure reads the scale and none is set) are verdicts: a Player is blocked, a
   Judge warned. A cap that no row reads never makes the level missing.

   `rowsOfMode`, `rowsForMode` and `pickGroups` take `at = {invocationLevel}`.
   They drop a bounded row outside its range, and every bounded row when no level
   is set, and return the standing rows with the scale's conditionals flattened
   (`flattenAt`: a rung's value, null below the first rung or with no level).
   `castFiguresOf` and `castGateExtrasOf` flatten the target and save figures the
   same way. A row keeps the key and position it has in the whole spell, so a
   `#<index>` key does not move with the level. Only conditionals on this scale
   flatten: a figure on any other scale comes back as written. A range, a duration
   and a casting time are `num()`, so they do not follow the level. A flattened row
   is a copy and is never written back to the spell. The level rides
   `card.invocationLevel` (with `card.invocation {source, cap}`, which the note's
   "Invocation n" and its tooltip read), each record's `invocationLevel` and
   `pending.invocationLevel`, and every place that turns a card back into rows
   reads it as `castAt(card)`: the relay, the recurring prompts' rows and presses,
   the card's Apply and Throw presses. The register's `makeSelfReach` reads gated
   rows at the spell's cap, found on that call, since lib hands the reach a
   rebuilt entry that carries none.
5. *The rows*: the mode's rows less the rows of each choice group's unpicked options.
   A damage row with no throw and a heal row are rolled once for the cast; a
   damage row is asked through lib's `magicDamageSpec`, so the caster's
   modifiers that opted in apply and no melee row does. A damage row with a
   `delivery` is thrown through the system's own pipeline as the `magic` attack
   type on a carrier (lib MODEL, "A spell's damage on the attack seam"), once
   per instance (below); a hit's `damageTotal` is that instance's amount. A modifier or ward
   row is a buff part where it waits for a roll (`cast-mods.mjs`, below) and a
   section of the card with an entry per target; any other row kind, and a
   modifier that stands, is a line on the card from `describeSpellEffect`.

   *Instances* (`cast-instances.mjs`, `cast-throw.mjs`). A damage or heal row's
   `value` is its instance count, a LevelValue read at the caster level
   (`modifierFigure`, never a defaulted level) and held to its `max`; a row that
   never authored one acts once, and `instanceCount(row, level)` answers
   `{value, parts}` with the figure, the level and the cap as the parts. A
   count the import left unread (`value` or `max` in `unread`), one that needs a
   level none resolved, and one that resolves below one are blank
   (`value: null`): nothing is rolled or thrown and the card carries the page
   reference alone. A row with no throw rolls once for its count: its roll is
   `scaledRoll(roll, count)` (a single `NdM` term takes `count` times its dice,
   any other formula repeats joined with " + "), derived in `rowSpecOf`, which
   the cast and the relay's bounds both read. A row with a throw is thrown
   `count` times, split among the non-self targets: the seat's typed split by
   target position, else `allocate` (round-robin, the first targets taking the
   remainder), kept on the card as `allocation[rowKey][targetKey]`. A count of
   one is the first target's alone (a Judge warned of the rest, as
   `severalTargets` says). Each target and row has one entry, `instances:
   [{state, throw, rolled, critical}]`, thrown in turn with one core
   `makeAttackThrow` each. Before a throw the seat's targets are set to that
   instance's one token (`canvas.tokens.setTargets([id], {mode: "replace"})`,
   `withOnlyTarget`) and restored in `finally`, so core aims the throw and its
   card at the token the instance is for; a token off the viewed scene is not
   thrown at, its instance stays at Throw and a notice says so. A cancelled
   core dialog stops the sequence: that instance and those after it wait at
   Throw, and the entry with them, so it applies whole when a Throw press has
   thrown them all. The Throw press narrows the targets the same way, and with
   no target on the card takes all the row's throws at the presser's first
   target. A request to apply an entry carries its hits (`requestOf`); `amountOf` runs
   per hit, so each hit rounds and meets the target's defenses alone, the
   amounts are summed, and the entry writes one `adjustHp` and takes one Undo; a
   hit the module cannot price makes the whole entry the Judge's and writes
   nothing.

   *A buff.* A recipient's modifier and ward rows are one record, which carries
   lib's flag `flags["acks-extras"].rollMods` and holds no status and no change.
   `modParts` turns a row into a part (`{key, on, value, itemId, gate,
   stacksWith, notStacksWith, provides}` and the row's scope fields) only where
   `modifierDisposition(row, {bearer: true})` says it waits for a roll and its
   target is attack, damage, AC or a save; a ward row is a part with no figure.
   A figure is the row's flat value, or its level-scaled value where the cast
   has a caster level, and a blank one writes no part and shows its page
   reference alone. Every part provides `SPELL_RECORD_CAP`, so two spell
   records never add and the larger applies. A row gated on the weapon names it:
   the seat's one targeted token and the weapon it picked are `card.item`, the
   part carries the weapon's `itemId`, and lib's item gates (`weaponMundane`,
   `weaponMagical`) are read at the roll, so a magic weapon is never refused at
   the pick. With no weapon named such a row is a line, written for nobody. The
   record is timed by the cast's duration only where the cast is timed and the
   rows last, carries its own `startTime`, names the caster's alignment as
   `sourceAlignment`, and is read by lib at the attack, the attack against its
   bearer and the bearer's save (lib MODEL, "A record's modifiers at the roll").
   A dry run at the cast reads which of the weapon's parts would yield to the
   weapon's own bonus (`registerItemBonusSource`; equipment registers masterwork)
   and tells it on the card; the roll decides again.
6. *The resists*: where the spell saves (`save.kind` blank or `save`, a category
   other than none), each target rolls lib's `saveThrow` once for the cast, with
   the situational figure, the roll kept as labelled parts. The throw is rolled
   only where the save governs an entry the cast opens on the target: a damage,
   heal or condition row with a figure, aimed at the target and decided by no
   attack throw, and that no gate exempts (below). A buff, the caster's own row, a thrown row and a row that is
   only a card line call for none. A row's `saveEffect`
   wins over the spell's. A passed save leaves nothing (negates) or half (half);
   any other effect is left to the Judge (`saveFractionOf`).

   *The gates* (`cast-gates.mjs`, pure). `targetGate({actor, extras, row,
   level})` answers `{affected, noSave, why: {key, parts}}` for one target and
   one of the spell's own rows. Three figures, each read from the world and none
   shipped: `target.hdCap`, the most Hit Dice a target may have for the spell to
   touch it, so a target over it is unaffected on every row (the cap is
   inclusive: a target at it is affected); `save.exemptBelowHd`, the Hit Dice
   below which a target makes no save and takes the effect as on a failed save;
   and a row's `exemptSizeFrom`, a monsters size key, from which a target of that
   size or a larger one in the monsters feature's size ladder is exempt from that
   row only (lib's `actor-read.mjs` `sizeKeyOf` and `rankOfSize`, which lib's
   conditions also read through `sizeRank`). A target's Hit Dice are
   `hitDiceOrLevel` (a character's class level; a monster's rating with its
   bonus ignored). Both Hit Dice figures are LevelValues read at the card's
   caster level through `modifierFigure`, so one that scales by level and meets
   no level gives no gate, a blank one gates nothing, and a target whose Hit
   Dice are unread (blank or none) is gated by no Hit Dice figure. The cap is
   checked before the size, and a target that is unaffected makes no save to
   skip. `why` names the gate that decided (`hd`, `size`, `noSave`) with its
   parts: the target's figure, the threshold, and the caster level where the
   threshold scales. `levelNeeded` reads `hdCap` and `exemptBelowHd`, so the
   dialog asks for a level where either scales. The spell's figures come from
   one reader, `castGateExtrasOf` (`target` from the copy or its twin as
   `castFiguresOf` reads it, `save` from the copy), on the casting client, the
   card's presses and the GM's relay alike.

   `buildTargets` asks the gate per token and row. A row the target is exempt
   from has the entry `{state: "exempt", gate: why}`, a thrown row's and a
   modifier row's included, and nothing is rolled, thrown, written or recorded
   for it: the cast's throw loop skips the target, dealing the default split
   among the others, and a throw a typed split assigns to an exempt target is
   spent. A save is rolled only for a target with a governed row left. For a
   target below `exemptBelowHd`, `rollResist` rolls nothing and returns a failed
   save marked as no save (`noSaveResist`: `success` false, no `total` or
   `target`, `noSave: why`), so the application reads it as a failure: the whole
   amount where the save would have halved it, the loss a failed save runs
   (`loseStates`), the record's `resist`. The caster's own target is gated by
   none. The card prints Exempt, or No save in the target's save column, each with a
   tooltip naming the target, the parts and the spell's page reference; the Throw
   press with no target on the card reads the gate before it throws.

   The relay recomputes it on the GM's client. `worldFor` builds `gateOf(row)`
   from the target's actor, the spell's own figures and the card's caster level;
   `checkApplyRequest` refuses an entry the card holds as exempt, or the
   recompute exempts, whatever state the card calls it (`exempt`); a no-save
   failure stands only where the recompute says the target makes no save, and a
   rolled save never stands for a target that makes none (`badResist`); and
   `applyOnTarget` skips an exempt entry (`skipped: "exempt"`) and applies a
   no-save target as a failure whatever resist the card carries.

   *The save meets the target's defenses.* The throw is made against the damage it
   resists: `resistedDamage` is the union of the types of the spell's own damage
   rows for the mode and picks that the save governs (no throw decides the row and
   it is not the caster's own), and its extraordinary mark where every such row
   states the same one, else none. A condition alone resists no damage and the
   throw meets no defense. `lib/saves.mjs` adds the target's defenses against it
   (lib MODEL, "Damage against defenses"): a creature immune to every type passes
   with no roll (the resist is `{success: true, total: null, auto: {label,
   source, types, cite}}`), a resistant one gains resistance's save modifier as a
   labelled part, and a case the module does not price (a blank figure, a defense
   covering only some of the types dealt, an unstated quality a band waits on) is
   listed on the resist as `defensePending` and changes nothing in the number.
   A spell whose rows deal different types is thus saved by a defense only when
   the target's defenses cover all of them.
7. *The card* (`cast-card.mjs`): lib's roll card, one section per rolled row, one
   row per target, one entry per target and row in `flags["acks-extras"].castCard`,
   rewritten per seat by a `renderChatMessageHTML` hook. The caster's own record
   is written first. For a concentration (`castDuration`'s `held`, with its `cap`
   and `tail`, which leave the duration untimed for every caller that tests
   `none`) it is written whatever the rows are: status-only, `concentrating` or
   `concentratingStationary` by the kind held, with `held` and `tail` in the flag,
   flag-timed by the cap where there is one. For any other duration it is written
   only where the duration is timed and a row lasts, or where a row recurs on the
   caster's turn ("Recurring rows", below).
8. *The application* (`cast-apply.mjs`), where the seat had targets, for each
   target on the right client. The amount is the roll through the save's fraction,
   then the target's defenses, then `amountAfter`'s one rounding, to `adjustHp`
   with multiplier 1. The defense stage is `defenseStage` over `actorDefenses` of
   the actor the writing client resolves (read there, as it stands) and the types
   and extraordinary mark of the spell's own keyed row; a heal row takes no stage
   and neither does a condition row. An immune target is 0 and writes nothing; a
   case the module does not compute (lib MODEL, "Damage against defenses") is the
   Judge's, in the state the partial save already has: no amount is written, and
   the entry keeps `defense {label, band, types, source, cite, why}`. An entry
   stores every step (`steps`: the fraction, each defense, the rounding). The
   card's tooltip on an applied figure lists the roll, each step and the amount
   applied; a defense is named there, on the save's part and on the line of a
   Judge's case to a Judge and to the target's owners, and every other seat reads
   "a defense" with the figures. A Judge's case reads the defense and its page
   reference on the line, with the page reference alone as the tooltip. A
   condition row writes a status-only record per condition (at most one status
   to a record, never with changes), timed by the row's `lasts`: from the cast's
   duration for `duration`, and for `nextTurn` and `rounds` by the record's life
   ("A record that lives", above), the entry keeping what was written (`life
   {kind, count, formula, detail, turn}`) for its line and tooltip, which name
   the count, the roll and which end was written; a failed save runs `loseStates` first, so the cast's own grant is
   not what is lifted. Two casts of one condition leave two records and one
   condition, which stays while either record stands. A target's modifier and
   ward entries are one group: they are applied in one request, write one buff
   record, and each entry names that record, so the Judge's Undo on one of them
   takes the record off for all (its tooltip says so). A buff is not resisted
   and has no amount, so the save is not rolled for it and the amount bounds
   skip it.

*The relay.* A seat writes the targets it owns and sends any other to the GM's
client through `magicCastApply` on lib's socket transport. The handler
authorizes against `requestUserId`: the message's author is the requester and
owns the caster, the card's spell is an item of the caster, each row is in the
spell's rows for the card's mode and picks, each amount is within the bounds of
the row's own roll as recomputed there (a thrown row keeps the system's floor of
one and doubles its dice on a critical; a modifier or ward row has none; a
thrown row's hits are each checked against that one roll's bounds, the row's
count is recomputed from the spell's row at the card's caster level and the
card's split of it may not exceed it, a target's hits may not exceed the hits its
entry holds, and an entry that holds instances is applied by hits alone:
`tooManyInstances`, `badAmount`, `badRow`; a condition row's rolled rounds are
within the reach of the spell's own formula: `badRounds`), the
target's save is recomputed against the caster and the caster's token the card
keeps (`casterTokenUuid`, read only where it is a token of that caster) and the
damage its save resists (`resistedDamage` over the spell's own rows), so the
target's defenses join the recomputed throw as they joined the rolled one, and its
total lies within its formula (a save the card keeps as an `auto` pass has no roll:
it stands only where the GM's client recomputes the same pass from the target's
defenses, and neither the card's word nor the request's is enough), a weapon the card names is a weapon of the
target's actor (`badItem`), a request naming one entry of a modifier group
names every open entry of it (`badGroup`), and the entry is neither written nor
in flight. Every record is built from the spell's own rows for the card's mode
and picks, never from the card's display rows, on whichever client writes: the
GM's client recomputes the duration from the spell and the card's caster level
(a `dice` duration cannot be recomputed, so the card's figure stands where it
lies between the formula's extremes, else the shortest), and reads the spell's
id, page and the caster's alignment from the documents, and the amount is the one
the seat's path makes, with the defenses read from the target's actor on the GM's
client (step 8); nothing of it is taken from the request but the rolled figure within
its bounds. With no GM connected the entry stays
pending and the card's Apply stays. A card cast with nothing targeted posts the
rolls and an Apply that takes the presser's targets; a thrown row waits on a
Throw press. Apply and Throw are for a GM and the user who cast; Undo is the
GM's: the hit points return to what they were and the records are deleted by
id.

**A declaration** (`cast-moment.mjs`, `cast-declare.mjs`, registered at `init`).
`castMoment({combat, combatant, castingTime})` answers where a cast falls: `free`
where no begun fight (`started`, or core's `acks.initDone`) holds the caster's
combatant, `long` where one does and the casting time is longer than a round,
`resolve` where the tracker's current combatant is the caster's and its
initiative is rolled, `declare` at any other moment. A time is longer than a
round by its unit and with no conversion figure: a `timed` time of more than one
round, or of any other `TIME_UNITS` unit (`longerThanRound`). The time is the
procedure's `castingTime(ctx, answer)`, else the spell's own (its library twin's
where the copy prints none), and it is read again from the dialog's answer in the
dialog and from the final answer in the cast. A `long` cast is never declared:
`longCast` blocks a Player and warns a Judge, whose cast resolves at its confirm
and whose card names the time (`card.castingTime {value, unit, source}`). A
declaration being resolved stays `resolve`. At `declare` the dialog's
button reads Declare and, at its confirm, the cast checks capacity, spends once,
ends the caster's concentration, writes a status-only `casting` record and a
status-free pending record (`pending {spellUuid, <the answer's fields>, combatId,
round, at}`), and posts no card. The answer's fields are one table,
`ANSWER_FIELDS` in `cast-declare.mjs`: mode, picks, casterLevel, invocationLevel, situational,
visibility, pickKind, items, saveMod, the uuids of the seat's `targets` at the
answer, the throw `allocation` by row key and token uuid, the tradition's
`procedure` answer and the `procedureKind` it belongs to. A later field is
added to that table and nowhere else. `round`
is the round whose turn of the caster's takes the declaration back (`lapseRound`:
this round where the caster's turn is still to come or its initiative unrolled,
the next once it has passed). The pending record alone is the declaration.
Core's combatant flag `acks.prepareSpell` follows it, written by the GM's client:
a Player cannot update a combatant, so a seat asks through `magicDeclareFlag`,
which accepts it from a user who owns the combatant's actor (and, to set the flag,
while a declaration of that actor names the fight); with no GM connected the flag
is left alone and nothing depends on it. A flag set by hand with no record to
explain it counts as a declaration for the missing-declaration verdict, and its
cast runs fresh, asks and spends. At `resolve`, an unlost pending record of this
spell and fight resolves with its stored answers on the targets it declared,
whatever the user's own targets are at the turn: no dialog, no capacity check, no
spend, the other verdicts still checked. The cast runs on the client of the user
who presses it, the caster's owner or a Judge casting for it, and no turn hook
casts. That client finds each stored token again by uuid (`declaredSeat`; a
deleted token, scene or actor is gone), makes the found ones its user's targets
and no others (`retarget`: `setTarget(true, {releaseOthers})`, on a token with a
canvas object, so one on another scene is in the seat and not on the canvas) and
holds that seat to the end of the cast without reading the user's targets again.
A record with no `targets` (written before they were stored) reads the user's
targets as they stand; one with an empty list resolves on nobody. The dialog
opens, spending nothing, where a declared target is gone or a stored weapon is not
a weapon of the one target: it opens prefilled with the stored answer (`ctx.initial`,
which `initialState` merges, copying it) and the remaining targets, after a notice
naming what changed, and the cast reads the bucket again at its answer as any
dialog cast does. The flag is cleared and both records deleted at the resolution.
Lib's `STATES_LOST_HOOK`, for ids that hold `casting`, stamps the caster's pending
records `lost {cause, at}` and clears the flag; a stamped record gives
`declarationLost` at the turn, no record `noDeclaration`, and each blocks a Player
and warns a Judge, whose cast then runs fresh with a spend. A second declaration
gives `declared`, blocked for a Player; a Judge's replaces the first, which stays
spent. The primary GM deletes the records of a caster's declaration (and clears the
flag) when that caster's turn that reaches its `round` ends with it unresolved
(`turnEnded`: the round advances, or the tracker moves forward to another
combatant; the tracker re-sorting after an initiative roll ends no turn), and when
the fight is deleted. A Judge's fresh cast through a lost declaration ends it. The
spend stands. The client that saw the loss also runs the tradition's `lost` for
a record that names a `procedureKind`, once for each cast.

**A tradition's procedure** (`cast-procedure.mjs`, Foundry-free; magic's api
exports `registerCastProcedure` and `procedureOfKind`). A casting tradition's
kind registers one procedure; a second registration of the kind replaces the first
and the first's handle then does nothing. Every member is optional: `fields(ctx,
answer)` (field specs, `lib/field-spec.mjs`), `band(ctx, answer)` (`{template,
context}`, a partial for what a field cannot say), `verdicts(ctx, answer)`
(`[{key, notice}]`), `castingTime(ctx, answer)`, `perform(ctx, answer)`,
`lost(ctx, declaration)`, `revert(ctx, undo)` and `buckets(ctx)`, and a `label`, a
lang key the tradition owns that names the band's heading (a string, never a
function; the registration refuses any other). The `ctx` is
`{actor, spell, tradition, classItem, invocationLevel, casterLevel, isGM, moment,
combat, source, roll, now}` (`castId` too for `perform`); a ctx whose `source` is
not `spell` is given no procedure. The procedure is found by the kind of the
tradition that cast the spell (`world.tradition`), and the claimants find it the
same way, synchronously, through the classes feature's `classForActor` injected at
registration (`registerCastSpell({classFor})`, `registerCastSummon({classFor})`);
the summoning's claimant declines a spell with a procedure and
`castSpellClaims` ignores its summoning. The answer to a procedure is one plain
object, `answer.procedure`: the field values coerced to the specs, the controls of
its band (named `procedure.<key>`), and the reserved key `buckets`,
`{bucketKey: [{uuid, qty, fit}]}`. A member that throws is logged and left out.
The buckets' key belongs to no field and no control: a field spec keyed `buckets`
is left out, the dialog's read of `procedure.<key>` skips it, and a value in its
place that is not a list per bucket reads as no entries. An entry exists only by
a drag of a real document (lib's `bucket.entryFromDrop`); nothing typed makes one.

The dialog draws the fields and then the band in one band between the spell and
the saves, and loads the band's partial before it renders; a partial that cannot
load is left out. The band's heading names the tradition (`procedureHeading`): the
procedure's `label` localized, else the tradition's own label, else the generic
Invocation heading for a tradition with neither. The cast hands the dialog both in
`ctx.procedure` (`label`, `traditionLabel`). The cast's verdicts add the procedure's
findings, each taking the plan's severity (a Player blocked, a Judge warned) and
reading in its own words (`notice`), and add `ritualPending` for a spell whose
`ritual` flag is set (no ritual is cast from the dialog yet).

An item a stored answer's buckets name that leaves its holder before the cast uses
it is struck from every pending record's answer (`stripLostItem`,
`cast-declare.mjs`). The `deleteItem` hook, and `updateItem` where the item's stack
is left empty (`hasStock`), run it on the client that made the change. An item's
uuid names its holder, so a move to another holder is a delete and the new uuid is
another entry. The records are every actor's and each unlinked token's; one this
client may write (`canUserModify`) is written, every bucket keeping its key so a
write that merges objects lands, and the rest are asked of the GM's client once
(`magicLostItem`), which re-reads the world and writes them only for an item that is
gone. Nothing is gated on ownership, a repeat writes nothing, and with no GM
connected the records stay. At the cast, declared or run fresh, each uuid still in
the answer is read again and an entry the world no longer holds is dropped without a
word (`withoutMissing`; a `power:` entry names no document and stays). The dialog
does not reopen, no notice names it and the plan has no verdict of its own for it.
What remains is judged by the verdicts of the bucket the procedure supplies: a
Player is blocked and a Judge warned. `perform` runs after the cast has its id and the caster's
concentration has ended, before the first row, at every moment but `declare`; a
declaration stores the answer and the kind and the turn performs on them.
`perform` returns `{proceed, section, rolls, undo}`: the card draws `section`
above the rows' sections, `rolls` ride the message and `undo` is data on
`card.procedure {kind, section, undo}`. `proceed: false` posts a card with only the
section, with no row, record or application, and a throw posts a card with no
section and a line saying the step did not complete. A Judge's Revert button
(`magicCastRevert`, shown to a Judge for a card with `undo` not yet reverted) calls
`revert(ctx, undo)` with that data and marks `card.procedure.reverted`.

**The Invocation band** (`apps/cast-dialog-model.mjs`, `apps/cast-dialog.mjs`,
`templates/magic/cast-dialog.hbs`). One band between the spell and the saves, headed
by the tradition (`procedureHeading`; a tradition with no procedure still has its
own label, `ctx.traditionLabel`). It holds, in this order: the invocation level, the
procedure's buckets, its fields, then its band partial. The level is ONE select named
`invocationLevel`, offered where the tradition has a cap or a kept row or figure reads
the scale (`invocationOffered`). Its options are every whole level from 1 to the top
of the cap ladder (`traditionCapLadder`: the ladder the casting row's `levelCap`
names, its highest whole rung) or the cap if that is higher. A Player's options above
the cap are disabled and say so on their own face, with the cap named beside the
select and its tooltip naming the ladder and the class level; a Judge's can be chosen,
the select and the cap take the warn tone, and `overCap` joins the footer. With no
cap read every level is offered; with no ladder at all the level is a number box
marked as set by hand. The dialog opens on the cap (R.1), never on a default the cast
invented: `initialState` holds it, `answerOf` answers it as a whole number or null,
and a declaration stores and reopens on it. Every question the dialog asks of the cast
is asked at the level the seat holds: the verdicts, the reach, the gates, the pending
own-saves, the moment, the procedure's view and the pick groups and splits, through
`ctx.invocationAt`, `groupsAt`, `instancesAt` and the trailing level argument of
`verdictsAt`, `reachAt`, `gatesAt`, `pendingAt`, `momentAt` and `procedure.at`.

A procedure's `buckets(ctx)` are drawn as lib's inventory buckets (`bucketView`,
`templates/lib/bucket.hbs`) in the same band. `bucketStates` (cast-procedure) reads
each against the answer: its rows are the stored list, else its `initial`, each uuid
read synchronously through `ctx.resolve`, and a uuid the world cannot resolve is left
out; the answer carries the list (`buckets[key]`) and, for a `pick: "one"` bucket,
the pick (`picked[key]`, a reserved key like `buckets`), so a seat that never touches a
bucket still answers what the cast reads, and a declaration stores both. The pick is
the seat's while that row is still held and usable, else the policy's `opens`. The
window holds a drop zone on `[data-bucket-drop]` (lib's `entryFromDrop`: a real
document, once, of a kind the policy takes; no typed entry exists), and the three
`BUCKET_ACTIONS`: X removes a row, the chip cycles a fit, a radio picks. It holds only
the seat's own picks on the answer, so a pick the cast opened on follows the level and
the rows. A bucket's findings (`policy.verdicts`) join `castVerdicts` through the
procedure's own list, so a Player is blocked and a Judge warned, at the dialog and at a
declared cast's turn alike.

The implement-set bucket (`cast-implements.mjs`, exported on the magic api as
`implementsBucket` and `IMPLEMENTS_KEY`) is the first user. It opens holding the sets the
caster carries (items with an implement level, `ceremony-state`), takes a dragged set,
and picks the set used: the pick opens on the LOWEST set whose effective level (level
less damage) reaches the chosen level (`usableSets`). A row is drawn from its entry
alone, as "Level N · effective M" with diamonds (filled for the effective level, hollow
for the levels lost), tagged Used when picked; a set too low is listed, its picture and
name dimmed and its reason in full ink, its radio disabled. With no set reaching the
level the finding is `noSetReaches`. A procedure that wants the line returns
`implementsBucket(ctx, {cite})` from `buckets` and reads the pick from
`answer.picked.implements`; the page its figures answer to is the procedure's `cite`.
A pick whose set was lost before a declared cast's turn is dropped with the entry
(`withoutMissing`), and the pick opens on the lowest set that still reaches the level.

**Concentration's end** (`cast-held.mjs`, registered at `init`). However the
caster's held record goes (damage or a failed save through lib's loss path, the
status's own toggle, a hand delete, another cast, the cap running out) the client
that deleted it ends the cast, in one funnel on `deleteActiveEffect` for its own
user's delete, because the cause exists only there. The cause, read before
anything awaits: the cast's own delete names `cast`, `time` or `saved` (a
recurring prompt's passed save, below) in the operation's
options (`{"acks-extras": {endCause}}`); else lib's `lossInFlight(actor)` gives
`damage` or `save`; else `removed`. `heldEndPlan` sorts the cast's recipient
records, found by `castId` over every actor and unlinked token, by the caster
record's `tail`: none, deleted by id; a tail, re-timed from now (the earlier start
and duration kept for Restore); a tail the import did not read, kept and listed
with End. A record the client cannot write goes to the GM's client through
`magicHeldEnd` `{casterUuid, castId, cause}`; the GM's client takes the tail from
the spell, never from the request, and accepts the request only from a user who
owns the caster once no held record of the cast remains. With no GM connected those
records stay and are listed with End. One card is posted after the relay answers,
whispered to the GMs and the caster's owners, in plain HTML: the cause, what ended,
what runs on (each figure with a tooltip carrying the page reference), what still
stands with End (the record's owners and GMs), and Restore (GMs only), which puts
back the caster's record and each ended one with its own id and undoes the
re-timings. Its flag `castHeldEnd` holds the cause, those lists with each ended
record's data, and the caster record's data. Restore keeps only the keys this
module writes of a record whose mark carries the card's own cast and caster, with
an empty change list. A cast's recipient records are not found when the caster's
whole actor is deleted, since Foundry fires no per-record hook for it
([ROADMAP.md](ROADMAP.md)).

What is not built yet is in [ROADMAP.md](ROADMAP.md) and the plan, `wip/`.

## The research tables

The printed figures magic research, ritual casting and blood sacrifice run on
are imported into the `magicResearch` registry document (importer MODEL, "The
magic research tables") and read by `scripts/magic/research-tables.mjs`,
which is Foundry-free and takes the registry as an injectable lookup, as
`ceremony-tables.mjs` does. Each reader answers `{present, ..., cite, byHand}`:
`present: false` and every figure null when nothing is imported, `cite` the
page the table was read from, and `byHand: true` with no page when a Judge's
override replaced it. What ships is the procedure the helpers apply to the
figures: the capped research rate (`researchRateAt`), the pro-rated
substitution penalty (`substitutionPenalty`), assistant capacity, a facility's
minimum by level and the bonus its surplus buys, divided among the researchers
sharing it (`facilityMinimum`, `facilityBonus`), a library's share of a
research's spend, ritual costs by level and the sacrifice bonus. Each helper
answers null when a figure it needs is unread, and nothing here falls back to
a default. The power ledger below and the research project's facility panel read these; the
crediting, outcome, ritual and sacrifice slices consume the rest.

## The power ledger

An actor's divine and arcane power is `flags["acks-extras"].power`, `{divine: {entries},
arcane: {entries, count}}`, magic's own and not the classes' pools (`classes.pools`),
which a rest clears. The pure model is `scripts/magic/power-ledger.mjs`; its live half
(the flag, the calendar, the imported lifetimes, the write and the relay, and the API on
`acksExtras.magic.power`) is `power-ledger-live.mjs`; the chip is the classes feature's
(`scripts/classes/power-chip.mjs`), drawn on the casting strip.

An entry is `{id, amount, day, name, img, ref, by}`: a positive amount is power gained, a
negative one spent, `day` the calendar day it was written (lib `world-time`
`dayOfWorldTime`), `name` and `img` the source's (a victim, a ritual), `ref` the cast
that caused it and `by: "judge"` a figure a Judge set by hand. A gain a Judge marked
`stays: true` is a lot that stays: it has no lifetime, never expires and is never due to
fade; the key is written on such a gain only, and a spend or a Player's request never
carries it. A spend a Judge marked `fromStays: true` draws on the lots that stay alone; the
key is written on such a spend only. Entries only append.

The balance and the expiry are a pure function of `(entries, today, span)` and nothing
is written when time moves. Spent power takes from the lots that fade before the lots that
stay, each group oldest first, and only from a lot that still stands on the spend's own
day (the order follows the mark, so it holds with no lifetime imported too); a fading lot
expires once `span` whole days have passed since its day. The
span is the imported lifetime (`readDivineLifetime`, `readArcaneLifetime`) converted to
days by the calendar the world runs: a day is one, a year the calendar's days per year, a
month that over its months (rounded up, as core converts an effect's month) and a week
the calendar's list of weekdays. A lifetime that is not imported, a unit the calendar
cannot say, or an arcane count left blank is no span, and nothing expires; no figure
stands in. Arcane power's page names the unit and no count, so the count is
`arcane.count`, a Judge-written field on the chip, blank until set.

The API (`acksExtras.magic.power`) answers `{ok, ...}`. `balance` and `expiry` read;
`gain({amount, name, img, ref})` and `spend(...)` write (a Judge's `gain` may add
`stays: true` and a Judge's `spend` `fromStays: true`; a Player's request for either answers
`judge`); `undo(id)` takes back a spend and
`setCount(n)` writes the arcane count, both the Judge's; `row(actor, kind, {amount})` is
the bucket's power row, lib's `powerEntry` capped by the whole power held and absent where
none is held (lib's `powerEntry` counts one under a cap of nothing); `settle(actor, step)`
spends what `applySettlement` handed back for a power row. A Player's spend beyond the
balance is refused (`short`) and a Judge's takes what is held and answers `warn: "short"`.

A write is made where Foundry lets the seat write the actor (`canUserModify`, never
ownership) and otherwise asked of the GM's client under the handler `magicPower`. The
handler authorizes on the sender Foundry attested (`runRelayed`): a gain or spend is an
owner's, and a hand adjustment, a gain that stays, a spend from the lots that stay, an undo
and the count are the Judge's.
No GM connected means not written (`reason: "noGm"`).

The chip sits on the casting strip, on the character sheet's Magic tab and on the system's
sheet alike (`castingStripElement`). A tag for each power carries the balance on its face
and the entries, the next to fade and the page in its tooltip; the entries are rows below
it, newest first, each led by its source's picture (else a glyph), with Undo on a spend
for a Judge. A lot that stays is a row led by a pin (Font Awesome, where it has no picture
of its own) with the caption "stays until removed", and its part of the chip's tooltip says
so; it is never dimmed for a lifetime. A Judge also has a plus and a minus on each tag (one
each, no amount box), a Fades / Stays switch beside them and the arcane count; a Player's
strip draws none of them and shows only a power with entries.

The switch is two pills in a group named for the power, Fades pressed by default, and sets
what that tag's pair does. On Fades the plus writes a gain with no mark and the minus is the
ordinary spend. On Stays the plus writes a gain marked `stays: true` and the minus writes a
spend marked `fromStays: true`, which draws on the lots that stay alone, oldest first, and
never on a fading lot. A spend carries `by: "judge"` and so has an Undo like any hand spend;
its row reads "Removed a point that stays", and the tag's minus is labelled for what it does
(`aria-label` swapped when the switch moves). With no point that stays held the removal
writes nothing and warns `staysShort`; asked for more than they hold it takes what they hold.
The mark is written on a spend only, so a stored spend without it reads as it always did,
and it is the Judge's on every path: `spend` answers `judge` to a Player's `fromStays`
before any request is sent, `checkPowerRequest` refuses it on the sender Foundry attested,
and `apply` refuses it for a sender who is no Judge rather than running it as an ordinary
spend. The API's own `spend` and `settle` keep the order fading lots first, then the ones
that stay.

The switch's state is a per-window record, `powerSwitchOf(app)` in `power-chip.mjs`:
`{divine, arcane}`, true where that tag is on Stays, held in a `WeakMap` keyed by the
application that hosts the strip. Each render of the strip draws the pills and the minus's
label from it and wires its controls to it, so it survives the re-render every plus and
minus causes. A window that has not set a tag reads Fades, two windows on one actor hold two
records, and the record ends when its window closes (`closeApplicationV2`,
`forgetPowerSwitch`), since a document keeps one sheet instance for as long as the world
runs. It is never written to the actor, and pressing a pill writes nothing.
An actor that casts nothing and holds no power draws no ledger. A rest does not touch it.

## Research projects

A research project is a record on a `location` actor, `flags["acks-extras"].magic = {facilities,
projects}`, magic's own. The pure model is `scripts/magic/research-project.mjs`; its live half
(the flag, the characters linked to the place, the imported tables, the write and the relay, and
the API on `acksExtras.magic.research`) is `research-project-live.mjs`; the tab on the location
sheet is `research-tab.mjs` and `templates/magic/research-tab.hbs`. The researcher's sheet links
to a project and does not own it (`projectsOf`, derived, nothing written on the character).

`facilities` is `{library, workshop}`, a gold value the Judge writes for each (null while unset,
counted as nothing). A project is `{id, kind, subject, level, costs, researcher, assistants, paid,
posted, credited, dueDays, bucket, throw, status, opened, closed}`: its kind (spell, item, identify or ritual) and
subject (`{uuid, name, img}`, blank for none); the level of effect the facility's minimum is read
by; the three costs as due (material, component, research), blank until a Judge enters them; the
researcher and assistants, uuids of the characters on the place's roster (stored occupants and
scene tokens); the material paid at the start with its day; the days posted and not yet credited as
`[{day, pace}]`; the research credited so far as `[{day, amount, by}]`, which only crediting writes;
the Judge's `dueDays`; the components bucket as lib stores an answer, `[{uuid, qty, fit}]`; and
`throw: {target}` where one is written.

A kind reads one or two facilities (`KIND_FACILITIES`): the library, the workshop, or for a ritual
both, each against its own imported passage (`readFacility`). The minimum is `facilityMinimum` by
the project's level (an identification reads the imported research figure instead), the share is
the value divided by the number of open projects reading that facility, and the bonus is
`facilityBonus` over the same share. A share below the minimum blocks a Player's project and warns
a Judge's (`facilityGate`); a figure not imported, or no level, is `unknown`, which blocks and
warns nothing and draws a chip carrying the page reference alone. Everything that is a figure is
read through `research-tables.mjs`; nothing here holds one.

Writes (`create`, `update`, `close`, `setFacility`) run where Foundry lets the seat write the
location (`canUserModify`) and otherwise are asked of the GM's client under the handler
`magicProject`, which applies the sender's rule (a Judge's is Foundry's attested GM, never the
payload's). A Player may start a project for a character they own and change its subject,
assistants and components; the facility values, the costs, the material paid, the throw and, once
the project exists, the level are the Judge's. A project is closed and kept, never deleted.

The Research tab is `{id: "research"}` in the location sheet's `TABS.primary`, after Storage, on
every place whether or not it has a market. It draws the facility values (inputs for the Judge,
text for anyone else, with how many open projects use each), then per open project its
researchers, level, costs, material paid, credited against due, the throw, one chip per facility
verdict and the components bucket (lib's bucket, with a drop zone for those who may change it).
A strip of day cells, a day chip and a rate on each participant's chip show the days (below). Finish is
drawn disabled with its reason beside it.

### Research days

A day is posted, then credited once world time has passed it, the shape of a venture day. `post`
writes `{day, pace}` to the project's `posted`: the day is the calendar day the world clock stands in
(`dayOfWorldTime`), the pace is dedicated, ancillary or both (overtime), and one day stands once. A
Player posts today and no other day; a Judge posts any day. A facility share below its minimum, or an
assistant who does not count, blocks a Player's post and warns a Judge's (`facilityGate`,
`assistantGate`).

`credit` takes the posted days whose day is before today. Each leaves `posted` and adds one
`credited` row per counted participant, `{day, amount, by}`, valued by the rates read at that moment;
a day that no rate could be read for is one row with a null amount and a blank `by`, so it still counts
as a day worked and adds no gold. It runs on the primary GM's client alone: on each forward step of the
world clock (lib `onWorldTimeAdvanced`) and once at `ready`, over every location, and writes a place
only where a day is due. It is a function of the record and today, and a (day, participant) is credited
once (`cleanCredited` keeps the first row of a key), so a second sweep, a clock dragged back and forward
again, or a request from another seat finds nothing due. The API's `credit` serves the same function to
a seat, relayed under the sender's authority; a requester credits the projects of the characters they own,
and a Judge every project.

Who counts and what a day is worth (`weighParticipants`, `dayAmounts`): the researcher's rate is the
ladder's rate for the class level (`system.details.level`). A ritual reads the rung's own rate and every
other kind the lesser rate the ladder's footnote gives other projects (`FULL_RATE_KINDS`), unread while
that figure is. An assistant counts when at or above the imported level that aids a researcher and within
the imported number the researcher manages, which is the base plus one per point of Intellect bonus; one
whose figure is not read does not count. A pace's share of the rate is 1, the imported ancillary fraction,
or both added. A participant is paid the rate at the pace, the participants add, and the sum is a day.

The due (`progressOf`): while the research cost and every counted rate are read, it is the days credited
and posted plus the days the remaining cost takes at a dedicated day's rate (`dueBy` "ladder"). Otherwise it
is the Judge's `dueDays` (`dueBy` "judge"), and with neither it is unknown. `complete` is true once the
credited gold reaches the cost, false while the rates are read and it has not, and, where they are not,
whether the credited days reach the Judge's days. `dueDay` is the calendar day the last needed day falls
on were each remaining day worked in turn from today.

The tab's strip draws one cell per due day (at most 60), the credited ones first, then the posted; the
chip reads the day worked (credited plus posted) against the due. The pace is a radio group per project,
held per window and never written; Post posts today at that pace. A radio belongs to no form, so the
sheet's own submit never carries it.
