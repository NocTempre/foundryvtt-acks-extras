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

## 2026-11-24 — A leader-table die is the by-weapon attack's formula

**Ruled (architect).** The leader table's die cell states the leader's damage
with its arms, the grade's modifier already folded in. It is not an unarmed or
natural attack. Core has no monster damage formula (the actor holds a modifier
only), and an attack's damage is its weapon's formula plus the actor's
modifier, so the die becomes the formula of the leader's by-weapon attack, that
item's own damage bonus takes back the grade's modifier, and the actor keeps
the modifier (a kit, a trait's damage and a natural attack read what they read
for a printed leader). The die is read from the imported cell and never worked
out from the modifier. A troop kit leaves the die recorded alone, since it
states the leader's damage as a modifier over its troop row's; Unarmoured is
no troop kit. A die that does not read whole as dice writes nothing, and no
item is added where none holds the marker. The Statblock and the Follower Card
show what core rolls, the weapon's own damage bonus included.

**New evidence** (the die had only been recorded on the creature, as a printed
leader's cell records none, and no entry ruled on it; the ledger row T-0714
found that nothing read it): the companion arms article pairs a weapon's modifier form with a
converted die for the same arms, so the die is a second statement of the same
damage and not a second attack; by the architect's own hand count over the local extracts, not re-checked,
the conversion fits 16 of the 18 cells, the two misses being the plan's 2e
damage-conflict cells, so a computed die is wrong where the printed one is
right; and a by-weapon marker is no formula a roll can read, so a leader with
only the marker had a modifier and nothing to add it to.

**Rejected.** An unarmed or natural die: it is not what the cell says, and the
creature already fights by weapon. A labelled take-back row at the lib seam:
the roll's rows would show a figure that is no modifier of the weapon. Zeroing
the actor's modifier: the kit, the trait and the natural attacks read it, and
the Tweaks reading would stop saying what the grade is. A second item at mode
0: two attacks for one routine. The status quo: the table's die reached no
roll. Reverse-computing a die from the modifier: the conversion does not fit
every cell.

**What it cost.** The grade's die sits in two places on the creature, the
formula and the take-back, and an edit of either ends the sheet's naming of
the table. A creature generated under a troop kit shows the kit's modifier and
the marker, as before. The Follower Card's shown damage now includes a
weapon's own bonus on every body, which changes a figure a character's card
showed.

## 2026-11-24 — A beastman's equipment rows write by figure key, as abilities, a stat bump and an item flag

**Ruled.** A chosen equipment row writes what its figures say, branching on the
figure keys and `figuresFrom`, never on the row key (`gearPayloads`). A marking
is an ability item (a per-die reduction gated on a mundane weapon) plus a
standing Armor Class bump (the `gear` part); an armour's rider is an ability
item with a `maneuverRider` row, read at the damage roll by equipment's
`damageRows`; a hooked weapon is the module's `hooked` item flag on the melee
weapons, which `classifyWeapon` reads with core's `hooked` tag. A creature with
no equipment row stays stat-only (the owner: an equipment inventory is optional,
not used for basic entries). A caster and a dependant carry none of it, as they
take no armour bump from a trait.

The rider and the hooked part follow the `overlayManeuvers` setting, since both
are parts of a manoeuvre. A monster has no loadout, so `attackThrowRows` answers
its manoeuvre row from the weapon item alone; the Rolls tab still lists
manoeuvres for a character's weapon only.

**Rejected.** Armour as an inventory item: whether armour is an item on a
monster is not ruled, so the rider rides an ability named by the row and S14
moves the spec if it is. Suppressing the weapon's own damage on an overrun or a
wrestle: applying it stays the Judge's call.

**What it cost.** Nothing rolls a manoeuvre's saving throw, so the hooked
figures' save part reaches only the Rolls tab's tooltip. The penalty a human or
demi-human takes from wearing the armour is not built.

## 2026-11-25 — The organisation roll: references fold to one entry or stay findings, shares divide the first level with more than one unit — SUPERSEDED IN PART 2026-11-25

The slice that builds the evaluator, the optional rules and the write plans
(`docs/monsters/MODEL.md`, "The organisation roll") ruled what the plan left open.
Owner words it follows: "Make sure to include the outside references such as to
[two creatures a section names]" (a stack built from the other creature's own entry), "Just drop
the reroll entirely. You can roll some or all of the org chart up to village and
you can manually edit or add from there" (Roll fills an empty row and nothing
re-rolls), "Don't overcomplicate. A lair is just an encounter flag for size and
loot when RNG generated" (nothing is named a lair), and "Look at how languages can
be left undecided until needed" (an empty row waits).

- **A reference resolves on equality with exactly one entry, and on nothing less.**
  The word and each entry's name fold to sorted singular tokens, a training
  adjective dropped from the page's side (`QUALIFIERS`). Two entries of one fold,
  or an entry that carries every printed word and more, are findings with their
  candidates, for board 1j's hand link. *Rejected:* taking the first of two
  entries; resolving a lone entry that merely contains the word (it would invent
  the category word the page leaves out); dropping leading words until something
  matches (it turns a qualified creature into its plain kin). Measured against
  the phase 1 census on this machine's Monstrous Manual: every row it called
  resolved resolves, every row it left unresolved stays one.
- **Cells are read at generation, not written to parts at import.** The village
  makeup and the mount row are registry tables a Judge can override; reading them
  when a roll runs makes the override count without a repair and keeps the import
  path out of this slice. A cell is read by its grammar and never by its row key.
- **Shares divide the first level, from the top, that holds more than one unit.**
  The page says "gangs or warbands" without saying of what. A unit that holds
  exactly one unit (a side whose noun is a unit holding one) would otherwise take
  one kind for its whole warband, so the division passes down to the first level
  with several. Where the printed roundings leave units over, the largest dropped
  fraction takes them (`remainder`), and a unit alone in its level takes the
  shares' own roundings (`loneSplit: "printed"`); both, and the default rounding of
  a share the page prints none for (`nearest`), are the Judge's choices in `gen`.
- **A unit's non-body parts go to a camp node of its own.** The unit's group
  holds its bodies and its leader, the camp (dependants, guards, captives,
  casters) is a row and group under it, as the plan's section 3 draws it. A chance
  `perUnit` is thrown once and its count once for each unit of that word.
- **A side whose noun is a unit holding one unit is a unit.** The line that
  counts one warband under a lair-noun is evaluated as printed, with its own
  leader and the warband beneath. The adopted example reads it as "a warband's
  group with its gangs inside"; a surface may collapse the single-child level. A
  rule that collapsed it in the evaluator would drop the leader the recipe gives
  that unit.
- **A trait goes to the top unit when it holds units**, and everything under it
  takes it ("one trait per warband or village"); a lone gang rolls none. A Roll of
  an empty row below reads the ancestor's from `inherit`.
- **A mount beside its riders writes no stack.** The page prints no count for
  beasts that fight beside a rider, so the roll lists the finding and a Judge adds
  them. A trait's added beasts need the Judge's word for the creature.
- **A piece a leader's table does not give is listed on the leader (`gearNot`)
  and never rolled onto** (T-0720); a Judge may add it by hand.
- **Coverage rows 11 and 24, and section 2b, re-read on "a leader is an actor".**
  Row 11: the chieftain part's morale goes to the group's `unit.officerMoraleBonus`
  and the shipped walk (`moraleFromUnitsAbove`) carries it down; no provider reads
  a leader stack. Row 24: a leader per unit is the officer actor of its unit's
  group, made from a Role cell prototype; no leader is a stack. Section 2b's need
  of a printed leader's fixed hit points in `rollBodyHp` falls with it. `fixedHp`
  stays for a part that is a stack and prints its hit points (an escort
  statistically equal to a rank).


Superseded in part by "The organisation provider" below: the bullet "A side whose noun is a
unit holding one unit is a unit", for a fixed count.

## 2026-11-25 — The organisation provider: a lone counted unit is the root, prototypes are marked, Delete takes the subtree

The slice that carries the roll out (docs/monsters/MODEL.md, "The organisation roll", "The
provider") ruled what the plan left open.

- **A line counting one unit by a fixed figure is lowered to that unit.** *New evidence for
  superseding the same day's reading:* the adopted shape's own example, "a warband's group,
  gangs inside" ("A wandering warband is Warband 1's group with its gangs' groups inside
  it"), is the counted unit at the root with no wrapper above it. The wrapper's leader comes
  first among the root's leaders, so it is the group's officer; the wrapper's non-body parts
  join the unit's camp. The test is the line's count formula having no dice: a count of dice
  that came up one is not lowered, since the dice could as well have made several.
  *Rejected:* lowering on any single child (a village that rolled one warband would lose its
  chieftain's level); a wrapper group kept (the owner: "only group needed"); a Judge's Add
  makes a row above where one is wanted. For the owner: this reverses the evaluator's reading
  recorded above for fixed counts.
- **A Roll of a row below the top takes the share and troop its ancestor fixed.** The empty
  row's `gen` keeps `shareKind`, `troop` and `trait`; without them a lone unit would be split
  again and a special unit would throw its troop again, which is a re-roll.
- **The template rides on the root row's `gen`.** A later Roll of an empty row cannot find
  the recipe otherwise.
- **A minted prototype carries its key as a flag.** The flag is how a later Roll reuses it and
  the only mark that lets Delete remove an actor, so a library entry and a hand-made actor
  are never removed. A prototype is minted only when a stack names it; each leader is
  generated directly, one actor, not a prototype and a copy.
- **A stack's mount, carried pieces and speakers live in its `gen`.** The stack schema had no
  field for them, and with no re-roll a figure dropped by a roll is gone for good. *Not done:*
  materialising the carriers as roster members, and binding a mount actor to a leader (the
  leader records the mount; no second actor is made).
- **Delete takes the subtree.** A group nests inside its parent row's group; a row taken
  alone would leave its subtree's groups inside a deleted one. *Rejected:* lifting the
  children to the parent row. The leaders stay in the world, since the plan's sentence names
  the row, its group and the prototypes only. Both are readings and are put to the owner.
- **The treasure hand-off is one row for the first creature the roll made that carries a
  treasure type**, raised by the hoards the line counts, to the pot given or a new staged
  pot. A row for each creature would deal a hoard for every kind of beast in a camp.
- **`officerLevel` is not written.** It drives the command-capacity rule of a personally led
  unit, and nothing here gives a beastman leader a command level.
