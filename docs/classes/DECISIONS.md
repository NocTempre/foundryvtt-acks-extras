# Classes — decisions

Dated, append-only. How it works now is [MODEL.md](MODEL.md); what is not
built is [ROADMAP.md](ROADMAP.md).

## 2026-08-15 — a language is the system's document, not our private string

The system owns a `language` item type and has since before this module: it
declares the type, gives it an icon and a details template, files it in its own
section of the character sheet, and reads it in the Polyglot provider it
registers at startup, whose `getUserLanguages` scans an actor for
`type === "language"` and looks at nothing else.

This module recorded a known tongue as a `{name, uuid}` pair inside a
`languageSlots` flag on an ability. Not a document of the wrong type — **not a
document at all**, so a character who spoke six languages was invisible to the
sheet section and to Polyglot alike. The abilities DECISIONS entry of 2026-08-14
already described a tongue as "a document in a slot carrier"; the intent was
right and the implementation never matched it, which is why this is a defect
and not a design change.

**Ruled: the document is the truth, and the carrier keeps only what the system
cannot say.** Granted tongues are `language` items on the actor. The open-slot
carrier survives because "may still choose two more" has no representation in
the system and the rules require it — an Intellect bonus may be left open and
filled during play. It records `capacity` and the ids of the languages chosen
against it; `entries` is gone.

**Ruled: the carrier reads its slots back through the documents.** A recorded
id whose item no longer exists is simply absent, so deleting a language off the
sheet frees its slot with nothing to reconcile. The alternative — mirroring
names into the flag and keeping both in step — is two sources of truth for one
fact, and the drift is one-directional and silent.

**Ruled: find before minting.** A granted name is looked for on the actor, then
among the world's languages, then in the system's compendium, and only built
when nothing answers. A class's `languages.granted` is a ref list whose sheet
field is free text, so an entry may be a name or a ref; both resolve. Before
this, a class naming a language the world already held gave the character a
bare namesake of it.

**Ruled: capacity never shrinks below what was spent.** A character whose
Intellect fell does not un-learn a language they chose while it was high.

**Rejected: registering our own Polyglot provider.** Polyglot's
`defaultProvider()` prefers a `system.*` registration over a `module.*` one, so
ours would sit unused until a GM found the setting and picked it. Feeding the
system's provider is both the working answer and the one reuse-before-invent
asks for. The one thing left to add is the world's imported languages, which
the system's provider cannot know about — it builds its list from its own
compendium ([lib](../lib/DECISIONS.md) owns that bridge).

**Cost:** a world's existing carriers and imported language abilities must
convert, which `language-migration.mjs` does at `ready`, GM-only and
idempotent. The "Tongues" carrier is retired outright — everything it held is a
document now — so the v4.1.0 gallery shot of it no longer describes the sheet.

## 2026-08-14 — Chargen rolls the hit die it was assumed to have already rolled

The Scores Generator produced characters whose hit points were never rolled at
all. `applyChargen` called `applyClass` without `rebuildVitals`, which defaults
to false, so no die was thrown, Constitution was never applied and the per-die
floor never ran. A generated character kept whatever the bare actor was created
with — the same number every time, whatever their class die or Constitution.

The 2026-08-06 entry below is **superseded in its chargen half**. It recorded
that "chargen builds its own 1st level … rebuilding underneath either would
discard a roll the player watched". That holds for the level-up wizard, which
does roll its own die. It was never true of chargen, which rolls none: the
page's `roll` is the 3d6 that picks a template, not a hit die. The protection
was written for a roll that did not exist, and cost every generated character
their hit points.

Chargen now asks for the same rebuild the picker does. At first level that is
one roll of the class's own die with Constitution applied per die and its floor
of one; experience is left alone, because the level has not moved.

Not migrated, per the standing rule — a character already generated is repaired
by generating again, or by applying their class from the picker.

## 2026-08-14 — A level set is a level owed: applying a class grants its ladder

Binding a class granted **no abilities at all**. `applyClass` wrote the printed
numbers and (for the picker) rebuilt hit points and experience; `grantAbility`
had exactly two callers, and neither was on that path — chargen granted a 1st
level on the Scores Generator, and the level-up wizard granted the single rung
it was climbing. So a character bound at 5th stood there with a 5th-level
attack throw, 5th-level saves, 5th-level hit points and not one class power,
not one proficiency, not even Adventuring. A character bound at 1st got the
same nothing, which is the case that was reported.

Ruled: the 2026-08-06 reading already decided this — the picker SETS a level
rather than earning one, "so it rebuilds what that level implies". Abilities
are as implied by a level as hit points are. `{grantAwards: true}` on the two
paths that set a level hands over every award AT OR BELOW it.

**Every rung, not the last one.** A ladder read as "the awards at level N" is
the level-up wizard's question, because a level is earned one at a time. The
question a set level asks is what a character who HOLDS 5th has taken, and the
printed spread answers all five rungs.

**The choices are asked in the apply dialog**, not deferred. The level-up
wizard only ever offers the rung it is climbing, so a pick owed at 2nd is
unreachable forever once a character stands at 5th — deferring would have left
the character permanently short in a way no surface could repair.

**The dialog opens for abilities alone.** It used to be skipped when no printed
number changed, which would have made re-applying — the one way an
already-bound character collects what they were owed — silently do nothing.

**An owned copy is not the world item, and the dedupe never knew it.** Found by
live-testing the re-apply above: `ownsRef` matched a `uuid:` ref against the
owned item's own uuid, which is an embedded id and can never equal the world
item's — so every hand-made (uuid-ref) ability was granted again on every pass,
and the repair path this ruling creates doubled Adventuring and the first-level
power. Recognition now runs importer stamp → a `grantedFrom` stamp written at
grant time → the source's name, the same name-matching that already identified
a world's hand-made Adventuring. The importer-stamped path was always sound,
which is why level-up and chargen never showed it.

**A choice rung answered is remembered** (`awardsTaken` on the class flag), so
re-applying adds what is missing instead of asking every question again. Keyed
by ladder position and level: a Judge who reorders a ladder afterwards may be
asked a rung a second time, and the options a character already holds are
filtered out either way, so the cost is a question rather than a duplicate.

**Not migrated**, per the standing rule against dev-cycle migrations: existing
characters are repaired by applying their class again, which the guide now
says, rather than by a sweep that writes items onto player-owned actors.

## 2026-08-12 — Import makes the examples: builds stamped, races materialized

Ruled (user): the JJ import must leave WORKING examples — after the table
import, the twelve RR classes (seven-plus-one core humans and the four
demi-humans) carry their printed Ready-for-Play build as advanced-mode
state, bound to materialized `def.race.dwarf` / `def.race.elf` documents,
and derive reproduces each class's own printed spread. Live-verified exact
on Fighter (2,000 → 250,000 XP) and Elven Spellsword (4,000 → 430,000 XP,
cap 10, the L5 slot row equal to the printed grid). The rest of the JJ
roster and races is ROADMAP by the same ruling ("just the core classes and
the demihumans for now").

**The saves chassis ignores the racial value** — JJ p301 is explicit
("not used … even when the Racial Value stacks"), and the first live derive
caught the engine counting elf stacking toward saves (mage instead of the
spellsword's printed fighter). Casting stacking and saves independence are
now separate paths, tested.

**The build paragraphs' trade-offs stay prose.** The Ready-for-Play text
names each class's trade-offs in sentences ("Armor selection is reduced to
Broad for one class power"); parsing those into elections is a judgment the
binding does not make. The paragraph lands whole in `builder.notes` and the
Judge ticks the trade-off boxes with the source in view.

## 2026-08-11 — The builder IS automated: advanced mode derives the spread

Ruled (user), superseding 2026-08-05 "…and is not automated": the class
document gains an advanced mode that emulates the Judges Journal's builder
workflow — build values in (Hit Die, Fighting, Thievery, magic values,
Racial), the printed-spread fields out (XP schedule, hit die, max level,
attack bands, saves-as chassis, cleaves, casting grids, racial traits).

**Derivation writes the simple-mode fields; nothing downstream reads builder
state.** applyClass, level-up, chargen and the registry see one document
shape, so an imported simple-mode class and a derived one are
indistinguishable to every consumer — and the builder's output stays
hand-editable afterwards, which is the same review-and-tweak workflow the
constructor sheet already rules.

**Every number is imported, none ships.** The engine
([builder-logic.mjs](../../scripts/classes/builder-logic.mjs)) is structure
only; the JJ builder tables (category XP costs, the attack-throw grid, magic
value ladders and fractions, trade-off yields, power costs) reach a world as
the `acks.classBuilder` ruledata document — an acks-importer cookbook recipe
from the GM's own book, or a hand-authored OVERRIDE layer. A missing table
degrades to a named issue on the plan, never a shipped fallback. What IS code
is the arrangement the spreads share: thresholds double to 8th then climb by
a flat rounded increment, halves round up on scaled spell slots, the largest
category decides the saves chassis.

**Rejected: deriving on every builder edit.** The derive is an explicit
action with a shown plan (what will be written, what the tables left open) —
a silent write under submitOnChange would clobber hand tweaks on every
keystroke.

## 2026-08-11 — Race is an Item sub-type; the ladder lives on the race

Ruled (user): a race is a document (`acks-extras.race`), not rows in a global
table — its racial-value ladder (per-rung XP cost, level cap, granted
powers), attribute minimums and always-on traits are the race's own, filled
by acks-importer (`def.race.<key>`) or typed by hand, exactly like classes.
The builder spends the ladder of the race the class binds (`system.race`);
a SIMPLE-mode imported class may bind the same ref so its racial traits
resolve from the race document instead of being restated per class — the
existing demi-human classes benefit without entering advanced mode.

## 2026-08-11 — Magic values are an open, data-defined set

Ruled (user): magic build categories are not two columns. Arcane and divine
are merely the first rows of the `magicTypes` table; ceremonial, gnostic,
alchemy, eldritch, fairie and any later or homebrew tradition are rows of
the same shape (value ladder with costs and fractions, casting kind,
repertoire, saves-as, progenitor grid). The class document stores magic
values as a typed LIST keyed by those row names; no enum in code closes the
set. The casting-kind vocabulary (vancian, points, ritual, ceremonial,
gnosis) stays a code enum because it names MECHANISMS the module implements,
not content.

## 2026-08-07 — A package pays its own coin; only a package-less build rolls for it

Ruled (user): the gold row is not rolled and not rollable while a starting
package governs the character — the package prints what they begin with, so a
die beside it is the same decoration the template die used to be. The one case
the book has a character roll for their own money is the Judges Journal's
template-less option (JJ Ch. 16: "the players roll 3d6 × 10"), which is core's
own gold formula, so nothing new throws dice.

**Building without a package is a Judge's option**, reachable only under the
override: no equipment and no spellbook, and every level-1 choice asked rather
than answered by a printed list.

**Templates pay in the coin they print.** The document had `gp` alone, and five
RR templates print silver — three of them ONLY silver, so a proselytizer, a
priest and a tribal warrior began play with an empty purse. `sp` joins `gp` on
the template, and each lands in the money item of that name because that name is
the only handle the system's `manageMoney` has on a purse. Not migrated: a class
document carries no silver until it is imported again, which is the honest
state — the value is one acks-importer reads off the page, and extras ships no
value read off a page.

## 2026-08-07 — The page is three columns, and it enforces the campaign's dice

Ruled (user): the attributes and the rule they are rolled under stand in the
first column, the class above the template die in the second, and what is left
to choose with the summary and the coin in the third. Core's own template row is
MOVED rather than duplicated — a die that means nothing until a class is chosen
belongs beneath the class it answers to, and two surfaces asking the same
question is how this feature's first version went wrong (below).

The generation rule is a campaign setting, not a per-character one, so the world
holds it and every player's page obeys it. `standard` is held as an ALLOWANCE
rather than a fixed order: RR Ch. 1 §I.2 says "pick one attribute … pick a second
and third", so which attribute gets the good dice is the player's choice and only
the counts are the rule's. The Judges Journal options (JJ Ch. 16) are one formula
for every attribute.

**A raised score re-derives its modifier from the actor, not from a table.** The
system's modifier table is not exposed, and no repo in this family ships a value
read off a page — so a detached clone of the actor is asked
(`computeModifiers`), and a blank box is the honest fallback if that fails.

**Rejected: leaving core's three dice buttons unconditional and explaining the
rule in a hint.** The page already had every formula on every row with no limit,
which is what let a character be rolled six times on 5d6 without anyone noticing.

## 2026-08-07 — A starting template answers the level-1 proficiency picks

RR Ch. 2: a template arrives "with weapons, armor, equipment, proficiencies, and
spells ready for play", and §II.1 spends the Intellect bonus "on top of those
listed for the template". The page had been asking for the class proficiency and
the general proficiency beside the template that already printed them, so every
generated character began with two proficiencies the book never gave them — and
the general dropdown defaulted to the first name alphabetically, which is
Adventuring, which RR Ch. 3 §III.4 gives everybody for free anyway.

Ruled: a level-1 choice drawing on the class inventory or the general list is
the template's to make, and the page shows what the package brings instead of
asking. A choice among NAMED alternatives — a warlock's dark path, a witch's
tradition, an earthforger's sigil — is not a proficiency a template lists, so it
is still offered. Adventuring is granted with the class and never offered as a
pick, at chargen and at level-up alike.

**Not migrated.** A character generated before this keeps the two proficiencies
they were handed; nothing rewrites existing characters, and a silent sweep over
player-owned items to take abilities away is worse than the surplus.

## 2026-08-07 — An unrolled score disqualifies nothing

The class filter read a score that had not been rolled as zero, which is below
every printed minimum — so before a single die was thrown every class with a
requirement was withheld, and the page said nothing about having withheld them.
The list looked unfiltered because what remained was exactly the classes the
book gives no requirement.

Ruled: absence is unknown, not failure — the same way an unrolled template die
legalises no package rather than disqualifying every one. A class leaves the
list when a score contradicts it, not before.

## 2026-08-07 — One Judge unlock, remembered on the Judge

Two checkboxes governed two halves of the same authority. Ruled (user): one
control for the whole page — every class, every template, and the rolled fields
editable by hand — remembered so it comes back the next time that Judge opens
the page.

Remembered as a flag on the user document rather than a registered setting:
there is nothing for a settings panel to configure, the control is GM-only, and
an absent flag reads exactly as today's default.

The derived boxes stay locked. The summary statistics are recomputed from the
scores; a score's modifier box is a path UNDER a field that submits, so freeing
it would put both into the form data core expands.

**Generating a character replaces the last attempt** (user ruling): a class
rerolled is a character rebuilt, not a character with two starting packages.
Under the unlock a second control adds instead of replacing, for the Judge who
means it.

## 2026-08-06 — Chargen lives on the Scores Generator, not in a window of its own

The system's Scores Generator already rolled the six attributes, a 3d6 template
die and starting gold — and discarded the template die on submit, its handler
writing only the scores and the gold. Meanwhile this module's chargen dialog
rolled its OWN template die. Two rolls decided one thing, and the one the
player watched was the one thrown away.

Ruled (user): the chargen surface moves onto that page. A class is chosen after
the scores are known and before the template is rolled; the template die is
read against the chosen class. The separate dialog is deleted, not kept as an
alternative — two entry points asking the same questions is how the two dice
came to disagree.

**Rejected: keeping the dialog and having it read the generator's die.** It
still leaves two surfaces to learn, and the die is only meaningful once a class
is chosen, which the dialog is where you do.

Cost: the surface is reachable only from a character the system considers new
(`system.isNew`, which core clears on the first update touching scores), so a
character generated by hand cannot return to it. Recorded in
[ROADMAP.md](ROADMAP.md).

## 2026-08-06 — Setting a level by hand rebuilds hit points and experience

Ruled (user): the picker SETS a level rather than earning one, so it rebuilds
what that level implies. Hit points are rolled from 1st level upward, each
level after the first following the level-up rule already recorded below.
Experience moves the shortest distance that agrees with the level — the floor
of the new band when raising, one short of the next when lowering — rather than
being zeroed or left contradicting the level beside it.

Only the picker and a dropped class ask for this (`rebuildVitals`). Chargen
builds its own 1st level and the level-up wizard has already rolled the die it
means to add; rebuilding underneath either would discard a roll the player
watched.

**Constitution applies per die, not to the total** (RR Ch. 1, Constitution: the
adjustment applies to each Hit Die and a penalty cannot reduce any of them
below 1). The level-up wizard had been applying it in bulk, which is the same
arithmetic only while Constitution is a bonus. Both now read one file.

## 2026-08-06 — Which classes are studious spellcasters comes from the book, not the document

RR Ch. 2 §II.1: the studious spellcasters' templates assume an Intellect of
13–15, carrying one bonus proficiency (listed last) and one bonus spell (listed
second). Chargen must not offer that bonus again, and must withhold both
entries from a character below the band.

Two structural derivations were tried against the world's 32 imported classes
and BOTH fail, which is why this is a stored field rather than a rule:

- **By repertoire kind** — `studious` names only the Dwarven Craftpriest and
  the Witch. Widening to include `arcaneInt` catches the other five and also
  the Warlock, which the book does not list.
- **By template shape** ("a studious template prints three proficiencies") —
  the studious classes print 2 AND 3 (Mage, Elven Spellsword, Zaharan
  Ruinguard), while plain classes print 3 and 4 (Venturer, Barbarian, Bard).
  The counts overlap in both directions.

Ruled: `templatesAssumeIntBonus` on the class document, filled by acks-importer
from the reader's own book, initial 0. A world that re-imports nothing keeps
today's behaviour exactly.

**Rejected: shipping the list of seven class names in extras.** It is a value
read off a page, which no repo in this family ships.

## 2026-08-05 — Class is an Item sub-type; the constructor is the only editor

Ruled: classes are `acks-extras.class` Items (module sub-type), owned by
extras; acks-importer materializes INTO this model and the dependency edge
stays one-directional. Rejected: a JournalEntry+flags blob (no typed fields,
no validation), an Actor sub-type (token/sheet semantics a class does not
have), extending the system's free-text `details.class` alone (nothing to
hold tables). Imported and hand-made classes share one sheet deliberately —
review-and-tweak and homebrew are the same workflow (user ruling: editable
constructor from v1, composition-first over primitives).

## 2026-08-05 — The JJ custom-class builder informs the model, and is not automated (SUPERSEDED 2026-08-11, above)

The Judges Journal's custom-class rules are how the printed spreads are
arranged under the hood — every class is category progressions (the four
chassis) plus trade-offs. That arrangement is why `saveChassis` /
`attackChassis` are the model's borrowing primitive. Ruled (user): the
builder itself is NOT automated — no build-point validation, no XP-cost
derivation; the document stores what the RR spread prints and the UI stays
RR-spread-simple.

## 2026-08-05 — Inventory accepts; it does not offer

Ruled (user): the constructor's inventory lists accept drops (and typed
refs). No catalogue picker of world abilities is offered by the sheet.

## 2026-08-05 — Book vocabulary in the document, released keys at the write

Save bands store `blast`/`spells` as printed. The one book→released mapping
(`blast`→`breath`, `spells`→`spell`, `wand` never written) lives in
lib/actor-compat.mjs `savesUpdateData`; extras also owns the repair pass for
dangling save-key references (user ruling). When the system releases its
breath→blast rename, that file is the single place that changes.

## 2026-08-05 — Level-up HP is RAW: reroll the full HD, minimum +1

Ruled (user): on gaining a level the full Hit Dice are rerolled and the new
maximum is at least one higher than the old; past 9th the printed flat bonus
applies with no CON adjustment. An additive-die house rule may be offered as
a setting, never as the default. (Consumed by the level-up wizard — ROADMAP.)

## 2026-08-05 — Casting is a typed framework from the start

Ruled (user): nothing deferred — the casting schema carries kind-typed
traditions (vancian, points, ritual, ceremonial, gnosis) and per-tradition
pools now, so By This Axe gnosis and Heroic Fantasy ceremonial content
materialize into the same fields; the Nobiran's dual pools are tracked fully
(implementation lands with the casting framework phase, on this schema).
