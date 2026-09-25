# Magic — Design Model

The magic feature is the spell primitive on the acks system's `spell` Item,
the vocabulary every magic surface shares, and, as the releases land, the
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
with abilities and monster powers. Each family is a descriptor map with an
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
system's Active Effects folded in below. `acksExtras.magic` exposes the
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

**Uninstall** (`uninstall.mjs`; the *Uninstall — Strip Spell Data* macro)
strips the flag from every spell item in the world, on world actors and on
unlinked token actors; core's strings stay, so a spell keeps its stat line.
The importer's provenance stamp is the importer's to strip.

Nothing casts or prices yet; those are the releases in
[ROADMAP.md](ROADMAP.md).
