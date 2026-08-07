# Classes — decisions

Dated, append-only. How it works now is [MODEL.md](MODEL.md); what is not
built is [ROADMAP.md](ROADMAP.md).

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

## 2026-08-05 — The JJ custom-class builder informs the model, and is not automated

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
