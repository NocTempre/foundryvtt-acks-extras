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
structural, curse — carry `domain: "spell"`, and `effectTypesFor(domain)`
keeps them out of an ability's picker while a spell may carry every kind.

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

**The sheet** (`spell-sheet.mjs`, `createSpellSheet(Base)`) is built at
ready as a subclass of the system's registered spell sheet and registered as
the default for `spell` Items. Three tabs: Overview, the stat line as
structure — a shape picker with its value control per line, the lists, the
reversal pair; Description, core's own part with its strings editable and
following the flag; Mechanics, the effect rows through the shared row editor
(`lib/apps/effect-row-editor.mjs`, over a store the sheet supplies) with the
system's Active Effects folded in below. A summon row names its creature
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
import `cookbook.mjs` `bindSpell` parses the block (`parseStatBlock` →
`spellFromStat`), reads the asterisk and the reverse's name off the prose,
and writes one core `spell` Item: the flag, core's strings, the prose as the
description with its cite, the row's icon, the cookbook stamp. `importSpells`
is the entry — `acksExtras.importer.importSpells()`, the *Spells* shelf of
Reimport One Shelf, and the getting-started step that runs before the classes
so a template's spellbook finds what it names. `REPAIR.spell` (`refresh.mjs`)
keeps `cast`, `memorized`, `favorite`, a description the Judge wrote and the
effect rows across a repair. A damage-type mark in the prose lands as its
word through the shipped `damageGlyph` table (executor `glyphWords`); the
mark's colour does not.

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
amount, value, summonFormat, control}` (`value` is the row's LevelValue object,
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
fires on, every `character` actor's caster records are checked against their
end: the record's `start.time` plus its stored duration, a calendar unit
converted by the world's calendar the way core converts one, `rounds` at
`ROUND_SECONDS` (`TURN_SECONDS` over `ROUNDS_PER_TURN`). A record with no
duration, or one in a unit the clock cannot count, never ends here. Core's own
`duration.expired` is not read (DECISIONS, 2026-11-11). A record past its end
is stamped `ended` (the world time, in the `spellEffect` flag; `spellEffectOf`
reads it back) and only then, where its cast still has creatures standing on
any scene, one card is whispered to every GM and every other owner of the
caster: the spell, the caster, the count, and a Dismiss button that runs lib's
`promptDismiss` on that cast's tokens (`castTokens`, matched by the summons'
`castId`). The card tells; the creatures stay until someone presses it. A
recipient's record is never announced, since it carries the same cast. Combat
does not move this system's clock, so a combat's rounds do not age a record.

Nothing prices yet, and a cast of any other spell is still the system's own;
those are in [ROADMAP.md](ROADMAP.md).
