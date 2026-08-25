# Classes — how it works

The `acks-extras.class` Item sub-type ([scripts/classes/class-data.mjs](../../scripts/classes/class-data.mjs))
holds a character class as a document: what an RR class spread prints, held as
structure. The module ships no values — a class document is filled by
acks-importer from the GM's own book, or typed by hand in the constructor
sheet. Both produce the same document and open in the same sheet.

## The document

- **Fixed fields** — requirements, key attributes, maximum level, hit die,
  the level-progression rows (`levels`: level / XP / title / printed Hit
  Dice), save and attack **bands** exactly as printed (`minLevel`/`maxLevel`
  runs), named numeric **ladders** for the spread's extra columns (damage
  bonus, AC bonus, backstab dice, caster level, the assassin/bard skill
  columns), cleaves as a lib LevelValue, racial traits, and `factored` —
  demi-human spreads print racial save modifiers already applied, and nothing
  may apply them again.
- **Chassis** — `saveChassis` / `attackChassis` name another class whose
  printed bands this class borrows ("Explorer (Fighter)"); they are
  independent because the priestess and witch borrow crusader saves but mage
  attacks. A class with its own bands leaves them empty. Save bands use the
  BOOK's vocabulary (`blast`, `spells`); translation to the released system's
  actor keys (`breath`, `spell`) happens only in
  [lib/actor-compat.mjs](../../scripts/lib/actor-compat.mjs) `savesUpdateData`.
- **Inventory** — the class's pool of available abilities (class proficiency
  list, powers, skills), as refs: a cookbook id (`def.prof.x`) resolved
  against the importer's stamp, or `uuid:<uuid>` for hand-made items. The
  sheet's lists **accept** drops; nothing is offered from a catalogue.
- **Award ladder** — flat per-level entries: a **fixed** award grants a ref;
  a **choice** award carries a ChoiceSpec
  ([lib/choice-spec.mjs](../../scripts/lib/choice-spec.mjs)) — "choose N from
  the class inventory / the general list / a listed set". One chooser shape
  serves the award ladder, template bundles, and any future pick-N grant.
- **Casting** — 0–2 traditions (2 only for the Nobiran), each typed by kind
  (`vancian` now; `points`, `ritual`, `ceremonial`, `gnosis` are carried by
  the schema so later content lands without a break), with a printed slot
  grid or a pool schedule and a repertoire kind.
- **Templates** — the eight printed 3d6 templates. Each row holds the band,
  name, annotation, caste, coin (`gp`/`sp`) and encumbrance note, and either
  binds a materialized **package** (below) or carries its contents as plain
  entry arrays — abilities, items (with the printed skin descriptor), spells.
  Applied by chargen.

## Template packages

[template-packages.mjs](../../scripts/classes/template-packages.mjs) is the
sole owner of the materialized shape: each template row may bind a core
`bundle` Item — a container of uuid links to REAL world documents — so a
Judge repairs one linked item (retype a mis-imported staff to `weapon`, fix
its damage) and every character generated from that template afterwards gets
the fix. A generated 3d6 RollTable per class (`system.templateTable`) links
the bundles as a VIEW; nothing in code reads it, so it cannot become a second
authority for the bands.

Ownership, one fact each: the class row keeps the printed band/name/coin/enc;
the bundle's `itemList` owns WHAT the package contains; each linked world
item owns what one piece of it IS. `materializeTemplates(classItem, {stamp,
folder, tableFolder})` builds all of it from the class document alone (no
book needed).

**Resolution reads the world first, then the compendia** — `findSource` (a
ref via the importer's stamp in the pack index, then exact name) and
`resolveBaseDoc` (`resolveBase`'s fuzzy match — exact fold at any length,
word-boundary containment at 4–5 characters, plain containment at 6+ — re-run
over the index). The importer can be configured to import into a pack, and a
package that reads only `game.items` materializes empty in such a world. A
pack document is **copied into the world**, never linked: a locked pack
document is what a Judge cannot repair.

So: gear becomes an already-skinned copy deduped per class by descriptor,
else the equipment root's strict name classification, else a bare `item`
flagged unresolved; a plain proficiency the WORLD defines is linked (one
shared document), one only a pack defines is copied, one with a printed
selection becomes a specialized copy stamped `grantedFrom` so `ownsRef` still
dedupes it, and one nothing defines yet is **minted as a placeholder** — the
printed name, empty system, flagged unresolved — because a name left on the
class row is invisible on the character and cannot be repaired. Spells
resolve the same way. `upgradeUnresolved` runs before any row is read: a
placeholder the world can now answer for is replaced (the `type` must
change), every bundle row repointed and the old document deleted, unless it
was edited — a Judge's repair is skipped and reported; an upgrade to a
definition the WORLD holds links it rather than copying, the same rule the
create path follows, and a gap still unfilled is re-reported on every pass
rather than only the one that minted it. **An unresolved part is never a
source** (`usableAsSource`), and the document being upgraded excludes itself
by uuid: a placeholder carries the printed name and nothing
else, so without that it answers its own name search and closes the gap it
exists to mark. Gear bases exclude every part this feature minted, so a skin
never becomes the base of a second skin.

**A package never consumes the imports.** Gear is a COPY skinned from its
base, a world proficiency is LINKED, and every deletion — `detachTemplate
Packages`' optional cleanup, a replaced placeholder — is gated on this
module's own `templatePart` stamp. The imported Sword a template names, and
the shared Adventuring proficiency it links, carry no such stamp and are
never touched: the item library is a source, not a package's private
contents.

**One owner, evidence-based.** `stripRepresented` removes from the row every
entry the bundle demonstrably carries (by ref, or by name for a name-only
cell) and nothing else, so the two lists are disjoint and neither the sheet
nor a grant can double them — while a package that could not carry something
leaves it printed on the row, still applying the old way. That is what makes
single ownership safe: a partial package can never silently shorten a
starting kit. `detachTemplatePackages` clears every link (documents kept
unless asked) and the class applies its printed entries again.
Packages the sheet builds land in a `Class Templates / <Class>` world folder
so every part is findable; the importer passes its own cookbook folder.

Identity lives on the created documents (`flags["acks-extras"].templatePart`),
never only on the row — an importer Update pass replaces the whole `system`,
so the row's `bundle` uuid is a cache the materializer re-derives from that
flag, then re-strips the freshly rewritten arrays (`stripRepresented`).
Every created document carries an `asImported` snapshot; a pass that would
replace one compares live against snapshot first and skips-and-reports an
edited document, so a repair survives re-import. acks-importer calls the
materializer after class import/update and ships a standalone
`importTemplatePackages()` macro as the upgrade path for worlds imported
before packages existed.

`applyTemplate` is bundle-first: a bound bundle grants its LINKED documents
(then whatever printed entries the row still holds — the disjoint remainder)
(abilities as rank-N copies, stackables by quantity, spells; a money item a
Judge placed in the bundle IS the coin and the row's `gp`/`sp` is skipped),
with the Intellect shortfall taken on the bundle's own order and a missing
linked document reported, never silently dropped. No bundle — or one that
resolves to nothing — is the unchanged legacy row path, so an un-upgraded
world behaves exactly as before. The sheet's Templates tab shows the bound
package with its contents read-only (Build packages / open / unbind / drop a
bundle to rebind); core's own actor sheet also explodes a dragged bundle, so
the packages work even without chargen.

## Advanced mode — the builder

The class document carries the Judges Journal's builder workflow as INPUT
state (`system.builder`): a Hit Die value, Fighting and Thievery values with
their elections, **magic values as an open typed list** (each row keys a
`magicTypes` table entry — arcane, divine, ceremonial, gnostic, alchemy,
eldritch, fairie, or anything a world's tables define), a racial value spent
against the bound race document, trade-off elections and chosen custom
powers, plus a Judge's manual XP adjustment.

The engine ([builder-logic.mjs](../../scripts/classes/builder-logic.mjs),
pure; [builder.mjs](../../scripts/classes/builder.mjs) resolves documents)
turns that state into a PLAN:

- **XP schedule** — 2nd level costs the summed category values (a stacking
  race's discount applied); thresholds double through 8th with the budget's
  smoothing level rounded to its printed nearest; past 8th a flat increment
  keyed on the SAVES chassis, plus any racial increase the race document
  carries.
- **Maximum level** — the budget's racial cap table by TOTAL build points
  when a racial value is spent; 14 otherwise.
- **Attack** — an imported attack-throw grid if one exists, else the chassis
  class the fighting row names (its printed table is already in the world),
  else the row's progression parameters based off the fighter chassis's
  first printed throw (flagged for verification).
- **Saves-as chassis** — largest category value; ties by the printed
  precedence. The racial value NEVER counts here, even when it stacks —
  the book is explicit.
- **Casting** — one tradition per magic value: the value row's own printed
  grid (the delayed variant when elected), else the type's 100% grid scaled
  by the fraction, halves up. A printed caster-level column that lags class
  level becomes a ladder the tradition names. A stacking race (elf → arcane)
  raises the effective value before the row is looked up.
- **Ladders** — mortal wounds from the HD row; the damage bonus borrowed
  from the fighter chassis's printed ladder when the fighting row grants
  one; each chosen thief skill's ladder copied from the progenitor thief.
- **Racial traits and requirements** — every power the race ladder grants
  up to the chosen rung, and the race's attribute floors.

The sheet's Builder tab shows the accounting (points, power picks, base XP)
and every issue the tables could not answer; **Derive** writes the plan as
one update after showing it. Derived fields are the SAME simple-mode fields
an import fills — nothing downstream reads builder state, and a field the
tables cannot answer is skipped, never zeroed.

Every number the engine consumes arrives per world as the
`acks.classBuilder` ruledata document (expected tables declared via lib
`expectTables`: budget, hd, fighting, thievery, magicTypes, tradeoffs) —
acks-importer extracts the raw JJ tables and assembles this shape
(its `builder-binding.mjs`), or a world hand-authors an OVERRIDE layer.
Extras ships none of it. The same import materializes race documents
(`def.race.dwarf`, `def.race.elf`) and stamps the JJ's Ready-for-Play
builds onto the twelve matching RR class documents, so every imported core
and demi-human class opens as a WORKING advanced-mode example whose derive
reproduces its own printed spread.

## Race documents

`acks-extras.race` ([race-data.mjs](../../scripts/classes/race-data.mjs))
holds a race as a document: the racial-value ladder (one rung per spendable
value — XP cost, level cap, the racial powers granted at that rung),
attribute minimums, always-on traits, and the same `factored` warning the
class carries. Rung power lists and traits accept ability drops on the race
sheet; nothing is offered from a catalogue.

A class binds a race by ref (`system.race`, cookbook id / uuid / key). The
builder spends the bound race's ladder; a simple-mode imported class may
bind one so its racial identity lives on the race document rather than
being restated per class.

A rung stores each power as a REF, and the sheet resolves it to a name for
display — so a rung may point at a definition the world has not imported yet
and light up when it arrives. Refs written by import come from acks-importer,
which resolves the name a race spread PRINTS ("Hardy") to the definition it
means (`def.power.hardyPeople`); a name it cannot place unambiguously stays
in the rung's note instead. Whatever a name means is that module's business,
recorded in its own DECISIONS.

## The registry

[scripts/classes/registry.mjs](../../scripts/classes/registry.mjs) publishes
class-derived rules tables into lib's layered registry at WORLD priority
whenever world class items change: `acks.classProgressions` (the four chassis
attack/save progressions) and `acks.class.<key>` per class with own bands or
ladders. `resolveLevelValue` completes lib's resolver: the `progression` kind
("as a fighter of half his level") reads the published chassis attack table —
the seam named in [abilities/ROADMAP](../abilities/ROADMAP.md).

## Applying a class

`applyClass` ([scripts/classes/apply.mjs](../../scripts/classes/apply.mjs))
builds one batched update for the character's level — saves (released keys),
attack throw, title, XP-to-next, hit-dice formula, cleaves, the vancian slot
grid — and shows every change old → new before writing. Fields whose current
value differs from what the LAST apply wrote are marked hand-edited; the
written values are recorded at `flags["acks-extras"].classes.applied` so the
next apply can make that distinction again. Cells the book leaves blank are
skipped, never zeroed.

**A set level grants what it owes.** `{grantAwards: true}` — passed by the
picker and by a dropped class, the two paths that SET a level — also hands over
every award at or below it: Adventuring, each fixed award, and one pick per
choice award, granted after the level lands.
[grants.mjs](../../scripts/classes/grants.mjs) owns the granting for all three
consumers (`awardsThrough` reads the ladder for a level, `awardsAt` reads the
single rung a level-up climbs, `grantAbility` writes one item, deduped by ref)
— chargen builds its own 1st level and the level-up wizard has already granted
the rung it climbed, so neither passes the flag and neither has the whole
ladder handed over underneath it.

**Answers travel by key, not by position.** `applyClass` takes `{answers}` —
award key → the ref chosen for it — so a surface that asked the questions
itself hands them over instead of having them asked again in a confirm dialog;
and `{answered}` for keys a caller closed without this call granting anything.
Every rung a surface closes is recorded at
`flags["acks-extras"].classes.awardsTaken`, by the level-up wizard and by
chargen as well as by the picker. That record is the whole reason a character
who levelled to 5th is not asked every choice they ever made a second time the
moment their class is re-applied.

## Class modifiers — editing the training

`syncClassTraining` writes the class's combat training onto the character as an
Active Effect whose changes are three CSV strings (`weaponProf`,
`armourProficiency`, `styleProficient`). `class-modifiers.mjs` draws that effect
as a **Class modifiers** section at the top of the Effects tab and removes its
row from the list below, so there is one control rather than two; `training.mjs`
reads and rewrites the grants inside it.

The pills are the same slot vocabulary the Inventory strip and the follower card
use (`SLOT_VOCAB`, exported from `lib/proficiency-strip.mjs`), so the three
surfaces cannot drift on what a slot is or what order slots come in. Here they
are buttons:

- **Styles and weapons toggle.** `all` is expanded to the explicit list on the
  first edit that removes one, and stays explicit afterwards.
- **Armour is a ladder.** A click sets the ceiling; clicking the current ceiling
  clears the grant.
- **Written in canonical spelling** (`twoHanded`, `veryLight`) — the profile
  compares case-insensitively, but what is stored reads the way the rest of the
  module spells it.

What the section shows is **this effect's grant**, not the character's effective
profile: training also arrives from proficiency items, actor flags and the
abilities bridge, and a pill lit by one of those could not be switched off here.
The Inventory strip is the effective total; this is the class's contribution to
it. A character with no training effect has no section.

Applying a class REPLACES the effect wholesale, so a re-apply discards edits
made here — which is what makes re-applying the way to undo them.

## Asking a rung

[picks.mjs](../../scripts/classes/picks.mjs) is the single owner of the
question every surface asks: of the abilities this rung offers, which does the
character take? An option the character already holds is **shown and
selectable**, grouped above the rest — picking it closes the rung and grants
nothing, because `grantAbility` declines to double what `ownsRef` recognises.
Beside the options sit two answers no ref can express: *already covered*
(`ANSWERED` — the rung is satisfied by something it never listed, so stop
asking) and *leave open* (the empty answer, the only one that closes nothing).
`grantsFrom` and `closesRung` are the two halves that used to be conflated:
what a rung grants and what closes it are different questions.

[panels.mjs](../../scripts/classes/panels.mjs) owns the boxes themselves — the
class box, the package box and the picks box — so the picker and the Scores
Generator render the same markup from the same code.

## The picker

The control beside the system's free-text class input, and the sheet's drop
target for a dragged class document, both live in
[assign.mjs](../../scripts/classes/assign.mjs); both open
[assign-app.mjs](../../scripts/classes/assign-app.mjs), which binds the actor
to a class document (`flags["acks-extras"].classes` + `details.class` for
system compat).

It is the Scores Generator's own layout with the column it has no use for
replaced: the attribute dice give way to the level being SET and the ladder
picks that come with it, then the class and its starting package, then the
opening choices and the Intellect bonus picks. Every question is asked in that
one window and handed to `applyClass` as `{answers}`, so nothing is asked
twice.

**The picker never wipes.** A starting package is offered here — the gap a
character bound from their sheet used to fall into — but it is opt-in,
defaults to none, and is applied through `applyTemplate`, the merging half of
chargen. `applyChargen`'s wipe belongs to generating a character, which is the
opposite act.

## Level-up

[scripts/classes/levelup.mjs](../../scripts/classes/levelup.mjs) watches XP
cross the class document's next-level threshold and notifies — never applies.
The wizard rolls HP per the world setting (RAW default: reroll the full Hit
Dice, Constitution per die and never on the printed flat bonus past 9th,
minimum one over the old maximum), lists the new level's fixed awards, opens
a rung control per choice award ([picks.mjs](../../scripts/classes/picks.mjs)),
then grants the abilities (deduped by cookbook ref), writes HP, applies the
class row for the new level **carrying the keys of the rungs it closed**, and
posts a chat summary.

## Chargen

Chargen happens on the system's own Scores Generator — the page that already
rolls the attributes, a 3d6 template die and starting gold.
[scripts/classes/stat-page.mjs](../../scripts/classes/stat-page.mjs) injects
the rest of it: a reset beside everything rollable, a class chosen once the
scores are known and before the template is rolled, the template die read
against that class under the printed at-or-below rule, whatever level-1 choice
the template does not itself answer, and the Intellect bonus general picks.
All of it rebuilds on every change, because all of it is downstream of the
scores — but only when the markup actually differs, so nothing flickers and
nothing loses focus. Picks are read at submit and applied at close: close is
the first moment core's own write of the scores is known to have landed, which
the Intellect count depends on, and the submitted page is re-read at that point
rather than trusted from an earlier pass.

**The page is laid out in three columns**, in the order a character is built:
the attributes and the rule they are rolled under; the class and the template
die read against it (core's own die row is MOVED into that column, because a
die means nothing until a class is chosen); then what is left to choose, the
summary and the coin. The columns are built once and the moved row is
recognised by where it now lives.

A roll writes its result straight onto a readonly input, fires no event, and
does so only after awaiting the dice — an animation that can outlast any fixed
delay. The three roll actions are therefore wrapped on the application's own
options, which is where they hang and where they can be reached; awaiting the
original is what guarantees the value is on the page before it is read. The
page is also made resizable and given room, in `preRenderApplicationV2` —
the frame's resize handle is built once, from the option, before that hook's
successor runs.

**The campaign's attribute rule is enforced on the page** (`METHODS`, world
setting `chargenAttributeMethod`). `standard` is the printed method (RR Ch. 1
§I.2) held as an ALLOWANCE rather than an order, because the book lets the
player choose which attribute gets which dice: one 5d6-drop-two raised to 13,
two 4d6-drop-one raised to 9, three 3d6. A spent formula's buttons are struck
through, and a row that claims a different formula gives its old one back. The
other three are the Judges Journal's options (JJ Ch. 16) — one formula for every
attribute, no minimum. The formulas themselves are core's, carried on its own
buttons; nothing here decides how dice are thrown, only how many times.

A score raised to its floor re-derives the modifier beside it by asking a
detached clone of the actor (`computeModifiers`), never by carrying a copy of
the book's table — no repo in this family ships a value read off a page.

Classes are listed as the books print them (registry `byBookOrder`): the book's
rank times a thousand plus the printed page, taken from `system.sortOrder` where
a class states its own place and derived from `source` where it does not.

**A class is offered unless the scores rule it out.** A score not yet rolled is
unknown rather than zero, so it disqualifies nothing; a class leaves the list
the moment the deciding die contradicts its requirement.

**One Judge unlock governs the page** (GM only, remembered on the Judge's own
user document): it offers every class and every template whatever the dice say,
and frees the rolled fields to be set by hand. The derived boxes stay locked —
the summary statistics are recomputed from the scores, and a score's modifier
box is a path under a field that submits.

[chargen.mjs](../../scripts/classes/chargen.mjs) applies what was chosen:
the class at level 1, then the template bundle — proficiencies as owned
abilities, equipment as skins over base items, coin, the spellbook's spells —
then Adventuring (free with every class, RR Ch. 3 §III.4) and the class's own
first-level awards (fixed grants deduped by ref against what the template
carried, plus the chosen picks).

**A template's printed proficiencies ARE the character's level-1 picks.** RR
Ch. 2 hands a template over "with weapons, armor, equipment, proficiencies, and
spells ready for play", and the Intellect bonus is chosen "on top of those
listed for the template" — so a level-1 offer drawing on the class inventory or
the general list is answered by the template and not asked again beside it. An
offer among named alternatives (a warlock's dark path, a witch's tradition) is
not something a template lists, and stays on offer.

**The template pays the starting coin**, in the denominations it prints — most
pay gold, a few pay silver, and three pay silver alone. Each lands in the money
item of that name, which is the only handle `Actor#manageMoney` has on a purse,
and a missing one is cloned from the world's own item so it keeps that coin's
valuation. The page's gold row shows the figure that will be written and is
cleared at submit, so the system is never asked to pay it a second time.

**A build with no package** is the Judges Journal's option (JJ Ch. 16), reachable
only under the Judge unlock: no equipment and no spellbook, every level-1 choice
asked rather than answered, and the character's coin rolled on the gold row —
3d6×10, the formula core's own button already carries. That row is the only
thing on the page whose die a package silences.

**Generating a character replaces the last attempt**, so a class rerolled is a
character rebuilt rather than one carrying two starting packages. Under the
Judge unlock a second control offers the additive behaviour instead.

**Intellect is netted against the template.** Most templates assume no bonus
(RR Ch. 2 §II.1), so the whole bonus is the player's to spend. The studious
spellcasters' templates assume one — a proficiency listed last and a spell
listed second — recorded as `templatesAssumeIntBonus` on the class document
and filled by acks-importer, because it cannot be derived from the document
([DECISIONS.md](DECISIONS.md)). Below that band the two printed entries are
withheld and named in the chat summary; above it only the difference is
offered.

## Casting

[scripts/classes/casting.mjs](../../scripts/classes/casting.mjs): the class
document is authoritative for CAPACITY (slot row or pool schedule at the
character's level); the actor stores only what is SPENT
(`flags["acks-extras"].classes.pools`). The character sheet gains a
per-tradition strip — slot pips to spend/refund, a +/− pair on a points
pool, a capacity line for a ladder-backed tradition (the gnostic invocation
level), and a rest control that DELETES the pools key (update merges
objects, so writing an empty object resets nothing). It is the only surface
that can show two traditions at once. The system's own `spells.1..6.max`
grid stays the single-tradition compatibility surface applyClass writes.

## Languages

[scripts/classes/languages.mjs](../../scripts/classes/languages.mjs). RR §I.10:
a class and a race each print tongues a character simply knows, and the two
ADD; each may also allow free picks; an Intellect bonus buys that many more,
which may be left OPEN and filled during play; an Intellect penalty costs
literacy, never tongues.

**A known tongue is a `language` document on the actor** — the system's own item
type. That is what its Languages sheet section lists and the only thing the
Polyglot provider the system registers will look at. `languageGrant` is the
pure counter (testable without a world); `grantLanguages` writes the result.

**A named language is found before it is built.** `resolveLanguage` tries a ref
(`uuid:…` or an importer cookbook id), then the world's languages by name, then
the system's `acks.acks-languages` compendium — so a character ends up holding
the world's document, description and art included. A class's
`languages.granted` is a ref list whose sheet field is free text, so an entry
may be either. Only when nothing answers is a bare language minted.
`ensureLanguage` is idempotent by name: re-applying a class hands back what is
already there.

**A proficiency or power buys slots too.** `languagesFromAbilities` counts
them: the Language proficiency grants `LANGUAGES_PER_GRANT` (3) and is
repeatable, and rank needs no special case because rank IS the count of
same-named items, so summing per item multiplies. Matched by the cookbook id
an import derives, never by name, with `flags["acks-extras"].languageGrant`
as the open door for a hand-made or third-party power. Never gated on the
Intellect bonus — the book offers the proficiency to a low-Intellect
character so they can read what they already speak.

**One carrier ability holds the OPEN slots**, because "may still choose two
more" is a thing the system cannot say. Its flag is
`flags["acks-extras"].languageSlots = {capacity, filled, source}`, where
`filled` is the ids of the languages chosen against it. `filledLanguages` reads
those back as documents and drops any that no longer exist, so deleting a
language off the sheet frees its slot with nothing to reconcile; `freeSlots` is
`capacity` minus that live count. Capacity never shrinks below what has been
spent. The picker and drop live in
[abilities/language-slots.mjs](../../scripts/abilities/language-slots.mjs);
clearing a slot deletes the document the slot bought.

[language-migration.mjs](../../scripts/classes/language-migration.mjs) converts
worlds written the old way at `ready` — GM-only, idempotent, and creating every
replacement before removing what it replaced.

Which languages exist is never shipped: they arrive through acks-importer from
the GM's own books, or a Judge writes their own. Telling Polyglot about those
imported ones is [lib/polyglot.mjs](../../scripts/lib/polyglot.mjs).

## Sheet category tabs

[scripts/classes/sheet-tabs.mjs](../../scripts/classes/sheet-tabs.mjs)
filters the character sheet's ability list by bucket — fighting (the
training flag), thief skills, general and class proficiencies, class
powers, and racial (whatever the bound class awards with a racial-trait
note) — and the spell list by tradition (`system.class`), so new tradition
tabs appear the day such spells exist. A skinned item's sheet carries a
badge naming what it is an instance of, with the embellishment parsed
apart from the base at grant time (`flags.skin.embellishment`).

## Save-reference repair

`repairSaveReferences` (lib/actor-compat.mjs) finds references to save keys
the released schema does not carry — stray dev-schema `saves.blast` data,
ability items whose `save` names a book key, Active Effect change keys — and
remaps them, dry-run by default. It is also the future migration seam for the
system's breath→blast rename.

## Paths — a class's groups of mutually exclusive options

`system.paths` is a list of GROUPS, each holding options of which a character
takes exactly one: a Barbarian's region, a Zaharan's dark path, a dwarven caste,
and the eight starting templates. `paths.mjs` resolves them; the resolution is
pure and takes a class's `system` plus a selection map.

A group's `source` says where its options live. Empty means they are stated on
the group, in `options`, and an option may carry its own `training` — the same
three parts a class states, for a class whose training differs per option and
which therefore states none of its own. `"templates"` means the options ARE the
class's `system.templates` rows, POINTED AT: the rows, their bundles and the 3d6
table stay exactly where they were, and a world gained the selector with nothing
migrated. Folding them in is ROADMAP's.

A character's choices live on the class ledger flag (`paths`, keyed by group).
`applyClass` asks for any group with options, pre-selecting what the character
already chose, and writes the chosen options' training as one more actor effect
stamped `fromClass` — so it is replaced on re-apply and removed with the class,
exactly like the class's own training. An unanswered group grants nothing:
choosing for the player would hand them a training nobody selected.

Applying a TEMPLATE answers the group its annotation names, and only if that
group is unanswered — "Pit Fighter (Jutland)" chooses Jutland, while a row
printing no variant chooses nothing and a choice already made is never
overwritten.
