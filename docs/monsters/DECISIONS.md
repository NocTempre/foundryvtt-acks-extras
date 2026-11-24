# Full monster stat block — decision record

Rulings through v11.14.5: [DECISIONS-through-v11.14.5.md](DECISIONS-through-v11.14.5.md).

## In force

- 2026-08-02 — [the Full Monster sheet is the DEFAULT, not an alternate](DECISIONS-through-v11.14.5.md#full-monster-stat-block--decision-record)
- 2026-08-02 — [the animal sub-type gets it too](DECISIONS-through-v11.14.5.md#full-monster-stat-block--decision-record)
- 2026-08-02 — [REJECTED: unregistering the system's monster sheet](DECISIONS-through-v11.14.5.md#full-monster-stat-block--decision-record)
- 2026-08-02 — [REJECTED: a replacement character sheet](DECISIONS-through-v11.14.5.md#full-monster-stat-block--decision-record)
- 2026-08-02 — [the base-class lookup ignores this module's own sheets](DECISIONS-through-v11.14.5.md#full-monster-stat-block--decision-record)
- 2026-08-14 — [Defence bands adopt the shared shape; capacity answers once](DECISIONS-through-v11.14.5.md#2026-08-14--defence-bands-adopt-the-shared-shape-capacity-answers-once)
- 2026-08-19 — [SIZES frontage structured into numeric footprints](DECISIONS-through-v11.14.5.md#2026-08-19--sizes-frontage-structured-into-numeric-footprints) — superseded in part by "2026-11-11 — SIZES keeps a label and a footprint; the unread printed columns go"; "2026-11-11 — The size footprint is imported, and a category with none is left alone"
- 2026-08-28 — [The animal's fields are a tab on this sheet, not an injected panel](DECISIONS-through-v11.14.5.md#2026-08-28--the-animals-fields-are-a-tab-on-this-sheet-not-an-injected-panel)
- 2026-09-04 — [The Hit Dice rating writes core's roll formula](DECISIONS-through-v11.14.5.md#2026-09-04--the-hit-dice-rating-writes-cores-roll-formula)
- 2026-10-23 — [The monster sheet is drawn on the lib's frame](DECISIONS-through-v11.14.5.md#2026-10-23--the-monster-sheet-is-drawn-on-the-libs-frame)
- 2026-10-31 — [One encounter-line parser, and a count of units is no headcount](DECISIONS-through-v11.14.5.md#2026-10-31--one-encounter-line-parser-and-a-count-of-units-is-no-headcount)
- 2026-11-11 — [SIZES keeps a label and a footprint; the unread printed columns go](DECISIONS-through-v11.14.5.md#2026-11-11--sizes-keeps-a-label-and-a-footprint-the-unread-printed-columns-go) — superseded in part by "2026-11-11 — The size footprint is imported, and a category with none is left alone"
- 2026-11-11 — [The size footprint is imported, and a category with none is left alone](DECISIONS-through-v11.14.5.md#2026-11-11--the-size-footprint-is-imported-and-a-category-with-none-is-left-alone)

## 2026-11-14 — The body-form list is imported

**Ruled (owner).** Asked: "The monster sheet's Body form dropdown ships 40
body-form names in code, each with an example creature in brackets ("<name>
(<sample>)"), taken from the Monstrous Manual's body-form table. What should
happen to that list?" with the options "Import it (Recommended)", "Trim the
examples" and "Leave it, roadmap it", the owner answered **"Import it
(Recommended)"**. And, the same day: **"Missing imports stay blank with page
reference as a subtle clue on where they could get that info. Fields that
require imports stay blank period. How a feature behaves without imports is not
really a concern for this project as long as long as it fails in a non-breaking
way"**. (The example in the question is left out of this quotation: a printed
name is the book's, and this file ships.)

So `BODY_FORMS` is gone from `config.mjs`. The table is read from MM p. 389 into
`monsters` / `bodyForms` (MODEL, "The body forms"), the select offers what was
read, and a Judge's override replaces the list whole. With nothing imported the
select is blank and disabled and its tooltip is the page reference; no text
says "not imported". The one thing a missing import must not do is lose data, so
`bodyForm` is a plain string field, a stored key the table lacks keeps an option
of its own, and the disabled select is left out of the form data so the stored
key never meets a submit. `acksExtras.monsters.config.BODY_FORMS` goes with it,
and the lib API version moves to 43.

**Glyph locator.** The band's glyph map keeps its 32 assignments, keyed by
`printKey` of each form's key (the hash of its folded letters,
`importer/printed-name.mjs`), because the map is a second place a printed name
would ship. A glyph is looked up by hashing the key, and a form with none wears
the paw. `test-recipe-content` holds every glyph hash to a row the local book
reads, so a hash that matches nothing fails there.

**Rejected.** Trimming the examples and keeping the names: the names are the
table of options the doctrine says is registered, not shipped. A list of named
row specs in the recipe: it ships the names. Keeping a `choices` list on
`bodyForm`: validation would drop a stored key the imported table spells
differently, and one of the forty stored keys does differ from the print.

**What it cost.** A monster that stored the spelling that differs from the print
shows its key as an orphan option and no band name until the Judge picks the
printed form. A world without the Rules tables imported shows a blank Body Form.

## 2026-11-14 — An attack throw that is not a number shows no figure — SUPERSEDED IN PART 2026-11-14

**Ruled (owner).** "Caught printed values are fixed on the spot" (2026-11-04);
"a figure a page prints is imported; stop asking" (2026-11-14); and "Missing
imports stay blank with page reference as a subtle clue on where they could get
that info. Fields that require imports stay blank period." (2026-11-14). The
readers of an actor's attack throw fell back to one printed row of the attack
throw column when the field held no number. Nothing needs reading for this one:
each reader now shows no figure.

**Calls made here.** The statblock's `N+` cell and the rail's attack figure are
empty, the group's caption reads without its figure, and the rail button's
tooltip says what the button does (`frame.rail.attackNoThrow`). The caption's
tooltip is the page reference where the import marked the throw missing and
none otherwise: the code that builds it is unchanged. The Rolls tab shows an
attack's bonus alone, the Stats tab's field is blank, and the follower card
prints a row's bonus without a target.

**The roll with no throw.** Core builds an attack's target as the actor's own
throw plus the target's armour class (`attack-throw-builder.mjs`), so a blank
throw rolls against the armour class alone and an absent one against NaN. The
rail button is disabled, and an attack row on the monster sheet, a Rolls tab
attack (`atk:`, `unarmed`, a weapon's attack mode) and a Follower Card attack
refuse with a warning, as a monster's missing save does
(`ACKS-MONSTERS.notify.noAttackThrow`, `ACKS-CHARACTER.rolls.noAttackThrow`,
`ACKS-LIB.followerCard.noAttackThrow`). Two computations that subtracted the
throw are dropped while it is absent: the non-proficient package's difference
against the imported throw (`equipment/attack-mods.mjs`) and a follower card's
typed target, which is a difference from the shown throw. Neither has anything
to measure against.

**Rejected.** Leaving the buttons live: they would post a roll whose target is
the armour class alone.

**What it cost.** A weapon rolled from its own item sheet or the character
sheet's Equipment tab is not refused and takes core's target. Core declares the
field with a default and no null, so a sheet may clean a blank back to a number;
the blank face is reached by an actor whose data holds none, and no live walk
has made one (monsters TESTING, "An actor with no attack throw").

## 2026-11-14 — Core's attack throw holds a blank

Supersedes in part the entry above: its "What it cost" sentence that core
declares the field "with a default and no null, so a sheet may clean a blank
back to a number". **New evidence, since that entry is under a week old:**
core declares `attack.throw` as `NumberField({ required: true, initial: 10 })`
(`actor-common-template.mjs`), and Foundry 14's `NumberField` is nullable unless
told otherwise. Probed against the installed common code: `nullable` true,
`clean(null)` null, `clean("")` null, `validate(null)` passes; only an absent
value (`clean(undefined)`) takes the initial. So clearing the Classification
tab's field stores null, and the blank face is reachable from the sheet. The
same default is what let a hire's loyalty be blank (henchmen DECISIONS,
"2026-11-14 — A hire's starting loyalty is the figure an import read, or
blank").

**Ruled.** The correction only: nothing in the attack-throw fix is rebuilt on
it now. That an item sheet's or the Equipment tab's weapon roll is not refused
while the field is blank stays as that entry's cost, and is a ROADMAP row.

## 2026-11-17 — The ACKS Monster group lives in the Details tab

**Ruled.** The group injected into a monster-owned item's sheet goes inside
the sheet's scrolling body, last in its Details tab (the extras sheet's body
when it shows no tabs; the abilities sheet's Description tab, which has no
Details and holds an ability's properties that are not rolls), headed like
that tab's own groups. A reporter asked for it to be removed because it blocked
the sheet; the owner chose: "Move into scroll". The placement was drawn and
approved before it was built; the drawing put abilities on the system's sheet,
and the walk found them on the abilities sheet.

The extras item sheet's window content also takes `min-height: 0`: a flex
column's automatic minimum is its content, so in a window resized shorter the
scroll region kept its capped height and the window clipped it, the group's
old place included.

**Rejected.** Removing the group: it is the only editor of eight flags (natural
weapon, damage type and extraordinary on weapons; category and usage on
abilities; spoil, component and research effects on items), and the monster
sheet's hints send users to it. Keeping it under `.window-content`: outside
every part's scroller it kept its full height on every tab and took that height
from the body, and at the viewport cap its lower part fell outside the window.

**What it cost.** The group is added after core restores each part's scroll
offset, so an offset inside it is clamped to the shorter body; the hook reads
the offset before the render and puts it back. The weapon's damage type and
extraordinary fields still write flags beside core's own fields, which the
attack roll reads; that is its own change.

## 2026-11-17 — A monster weapon's damage type and extraordinary mark are core's fields — SUPERSEDED IN PART 2026-11-19

Superseded in part by lib's 2026-11-19 "A weapon's damage type is core's alone"
(the fallback "Calls made here" leaves to lib).

**Ruled.** The ACKS Monster group's Damage Type and Extraordinary damage
controls read and write the weapon's `system.damage.base.types` and
`.extraordinary`, the fields the attack roll and lib's damage stage read. They
wrote flags beside those fields, so an edit in the group never reached the
roll. This is the change the entry above left for later; the group now edits
six flags and these two fields. The controls are the approved ones, so nothing
was redrawn. The importer stops writing the two flags on both monster paths:
the cookbook import already wrote core's fields beside them, and Apply Stats
wrote only the flags, with the damage as a bare formula that core reads as
untyped and mundane. The monster sheet's attack rows read lib's
`damageTypeOf` and `extraordinaryOf`, and equipment's silver answer reads the
same mark (equipment DECISIONS, 2026-11-17). Natural Weapon stays a flag: core
has no such field.

**Calls made here.** A pick replaces the weapon's whole type set and clearing
empties it, so a weapon given two types on the system's sheet keeps one after
a pick. The select shows `ownDamageType`, core's alone, so the control shows
what it writes; the attack row and the Rolls tab show `damageTypeOf`, which
falls back past core. An old flag is not cleared on write. The owner: "cancel
any new time on tools designed to repair previous versions". The `damageType`
key is also equipment's per-item override, so it is not this feature's to
clear. The group's change stops at the group, so the host sheet's
submit-on-change never posts the form's own copies of the same fields.

**Rejected.** Keeping the flags and copying them into core's fields on write:
two stores of one fact. A flag for a type core does not accept: core accepts
all thirteen. Clearing the old flags on write: a repair of what earlier
versions wrote.

**What it cost.** A monster given stats by Apply Stats before this change
holds its type and mark only in flags. Its attacks rolled untyped all along,
and its attack row stops showing the mark. Applying stats again replaces its
minted weapons with core-typed ones. Where such a weapon holds a type flag and
no core type, the attack row still names the flag's type through lib's
fallback while the roll carries none; that fallback is lib's to settle.

## 2026-11-18 — The Apply Stats fix tells users to apply stats again

**Ruled (owner).** The entry above leaves a monster that Apply Stats filled in
v2026.11.14 with its type and mark in flags no reader uses for the roll. Asked
"Should the Apply Stats changelog tell users to re-apply stats?", the owner
answered **"Yes, add it"**. The public beta wrote that data itself, so the
2026-11-14 ruling of one start-fresh line for alpha worlds does not cover it.
The fix's changelog bullet says to apply stats again, which replaces the
monster's natural attacks with typed ones. A line is all it gets: no check, no
warning and no repair tool.

## 2026-11-24 — A beastman's special troop, tribal trait and optional equipment are template axes, banded per breed and read at generation

**Ruled (owner).** "I want the beastmen template fixed with special attention
towards capturing everything in this document mechanically (plus arranging art
correctly, etc)." On the two leader sources, asked whether the breed page or
the leader table is the default: **"Breed is default, Table 54 shows leaders
who are both better equipped and tougher (higher HD)"**. On the overview
page's five heads, asked whose they are: **"They are tribes, neither"**, then
"Can reuse for roles" and at once **"Wait no you can't"**.

**Ruled (this change).** The family template gains three axes beside Variant,
Leader figures, Role and Kit, in the order Variant, Leader figures, Role,
special troop, Kit, tribal trait, optional equipment (`orderAxes`). Troop and
trait are single axes whose options take their roll bands per breed from the
registry tables (lib DECISIONS, "A template axis can take its bands from a
registry table"); optional equipment is a multi axis that is only pinned. The
template holds keys, labels and cells; every figure is read at generation from
the imported `monsters` document (`applyGeneratedOrganisation`), so a Judge's
override counts with no repair. The leader table is a third Leader figures
option, a better-equipped and tougher grade, applied before the kit
(`applyGeneratedLeaderGrade`); the breed page stays the default. A share of
missile troops in a breed's encounter recipe (`ratioOf: "unit"`) counts whole
units, the gangs of a warband or the warbands of a lair or village, rounded as
printed. No head from the overview strip is placed on a trait, a variant or a
role.

**Rejected.** Bands on cells: every patch duplicated per breed, and an
option's own patch defeats the blank handling. Bands copied onto options at
import: an override would need a repair. A registry with no axes: the builder
could not make one creature with a troop or a trait. The share read as a share
of bodies: the sentence divides units. A trait head: the heads are tribes'.

**What it cost.** The axis order is fixed, since the variant merge splices the
Kit axis at its place. A figure the page makes conditional (a first round, an
outnumbering, a target's state) is recorded on the creature and its notes and
applied by nothing until the roll gates exist. A proficiency a troop or trait
grants lands only where the printed word folds onto one of the world's
proficiency names; elsewhere the creature gets none and the console says so.
