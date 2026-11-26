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

## 2026-11-25 — Generate makes a root group; a Roll that makes a village makes its faction card — SUPERSEDED IN PART 2026-11-25

The owner: "The specification is the faction card is optional for groups, but it's not a
strict only, rather an only group needed", and, of a village, "Village always has one".
Generate on a family template had been built to make a faction card every time, which broke
the first: a wandering or lair roll of a gang or a warband got a card nobody asked for.

- **Generate makes a root group** holding one empty top row that names the template in its
  `gen`, and opens it on its Organisation section. Nothing is rolled and no card is made.
- **A Roll that makes a village ends with lib's Make its own** (`org.makeFaction`): the
  faction card is named from the group and the rows move onto it. A village is read from the
  evaluated line, never from a unit word: the top unit holds units that hold units
  (`holdsUnitsOfUnits`). A roll of a gang or a warband makes no card; a roll below the top of a
  chart makes none; a chart already on a faction, or whose group a faction already lists
  (`orgHostOf`), is given no second card (`needsFactionCard`, tested for each case).
- **Make its own writes two documents**, the faction and then the group's rows, and the sheet
  redraws on the first; whatever reads afterward waits for the second write and its notice.
- **The Roll on a Generate-made root group fills the top row with that root group itself**
  (hub ruling, corrected in place on 2026-11-25; the bullet it replaces read "Open, for the
  hub"). The group's own top row names it, the chieftain is its officer, and `makeFaction`
  takes that officer as the card's leader and the group's picture as the card's: no shell is
  left in the Actors tab. A Generate-made root group is recognised from what Generate wrote and
  nothing else (`isGenerateRoot`): one row, the top, empty, whose `gen` is the template's uuid
  alone, on a group with no stack and no officer. **No new flag.** A faction host, a row below
  the top, a group already holding stacks or a second row, and a row a pick or a record has
  touched are unchanged. Row (a), "a thing does not nest itself", stands: the plan emits no
  `parent` op for the top unit, and `wouldCycle(x, x)` still refuses a group under itself.
  *Cost:* the root group's own row now names its own host, so `orgHostOf` answers the group
  itself; `listedElsewhere` compares the host's uuid so the village still earns its card.
  `unlistRow` of that top row writes the host's rows twice, and the second write empties the
  chart: reported for the hub, not changed here.

## 2026-11-25 — The family plate is an assist on the overview row, page only, no box — SUPERSEDED IN PART 2026-11-25

The owner, on art: "You can use any part or whole of the images, they are not getting
redistributed they are getting imported by the book owner" (`ip-doctrine.md`, Art, item 1).
The plate is the section's full-page picture, imported from the Judge's own copy; the repo
ships its page number and nothing else.

- **An assist on the overview's register row, `assists.platePage`**, not a row of its own and
  not a new kind. The plan said a register row of its own; a new kind would need exclusions in
  the import dialog, the claim census and the target list for a document that is only a
  picture. `compileMonster` adds `fields.plate`, an art instruction on that page under the
  kind's own pick criteria, and `executeEntry` runs it like any field. Departure from the
  plan's wording; the owner's ruling is unchanged.
- **No box.** The hub's earlier wording was "the page and the box". `uploadPageArt` takes the
  page's placed image first and renders the page only where the recipe carries a `box`, so a
  box lets a missed image object fall back to a render, and a render carries the page foot.
  Without one the plate is the image's own samples or nothing. A test pins that the compiled
  op has no `box`. A box matters only to a later crop of the plate, which is taken from the
  image's placement and linted as a crop.
- **A file of its own.** The strip is uploaded under the member's id and an uploaded file is
  reused by id, so the plate goes under `<member id>.plate`. `img` stays the strip.
- **`flags["acks-extras"].plate`** is written by `importFamily` on the template, and a repair
  in place writes it through the actor policy's flags (every key but `cookbook` and `minted`).
  A read that fails leaves the key out, so a held plate stays; a plain re-import returns early
  and only Repair in place delivers it.
- **The plate is on the compendium index** (`CONFIG.Actor.compendiumIndexFields`, at lib
  `init`): `fromUuidSync` on a pack document answers the index entry after a reload, which
  carries only indexed fields.
- *Open:* the Variant list read through `system.axes` may be empty from the index in the same
  way; it is inferred from the code and is reproduced after a reload before it is fixed.
- *Cost:* the second art op runs on every `executeEntry` of the overview, so a direct import
  of that row decodes the plate page too; a caller that skips the `art` op skips it.

## 2026-11-25 — The Roll panel reads what a roll will make and where the page is silent; Design by selection maps what a Roll reads

Hub rulings, whole: "BUILD in S12, through the service pattern. Both are held to the doctrine: the panel names what the Judge
decides and what will be made, with page references, and carries no sentence of the page." And: "BUILD the mapped slots in S12
(troop and share as the row's gen; variant, rules and choices as rollOrganisation args). The unmapped inputs ... are NOT
rendered, since an input with nothing behind it is a bug."

- **`org-roll`**, a service monsters registers (`docs/lib/API.md`), reads the family's recipe for the panel: lib never learns
  what a part is. "This roll will make" lists the line and each part as its imported expression, chance and page reference;
  nothing is thrown (no preview roll, the owner dropped them).
- **Departure from board 1a, for the hub:** the board draws Generate disabled until the open choice is answered. The evaluator
  asks nothing and defaults every choice (`DEFAULT_CHOICES`), so each select starts at the default or at what an earlier roll of
  the chart recorded, and Roll is never held.
- **Design by selection is the same Roll.** A unit's share and troop are written to its empty row's `gen` through `org.editRow`
  (`planEdit` takes a `gen` patch), which `rollOrganisation` already reads as `inherit`; variant, rules and choices are its own
  arguments; a slot's die is a Roll of that one row. A troop select is offered only where the troops rule is on and the
  unit's share is the special one, since the evaluator reads the pick under no other condition.
- **Not rendered, with what each would need (for the owner):** a per-unit trait (the Roll reads a trait for the unit that holds
  units only through `inherit.trait`, written by an ancestor's roll: a slot needs the evaluator to honour a trait on a unit it
  rolls itself); the village row (a `villageSource` per row, today one for the roll); guard, caster and dependant counts (no
  `inherit` field carries a count: each needs the evaluator to take a count override per part); bodies typed on an empty row (a
  `count` in `inherit`; a count is set by hand on a filled row, Edit); 1b's Build (a Roll writes at once, there is nothing to
  build).

## 2026-11-25 — The chart reads a pack template through `getIndex()` and loads the whole template for its Variant list

Supersedes in part "The family plate is an assist on the overview row" (its bullet that the plate on
`CONFIG.Actor.compendiumIndexFields` is what `fromUuidSync` answers after a reload). New evidence: the
S12 live walk read a pack template after a reload and got an entry with the keys name, type, folder,
img, _id, sort, uuid and pack, and 0 variants where the loaded document has 6. The server builds a
world pack's startup index from the document class's own core fields; `CONFIG.Actor.compendiumIndexFields`
is applied by a client `pack.getIndex()`, which core never calls at startup.

- **The plate:** the chart awaits `game.packs.get(<pack id>).getIndex()` before the sync read
  (`readAfterIndex`); it answers at once once a pack is indexed, one request per pack per client, never a
  whole document.
- **The Variant list** reads `system.axes`, which no index carries: a Roll loads the template whole with
  `fromUuid` on the press (`familyOfRows`). This closes the *Open* note of that entry.
- **Not changed:** `place.mjs` `packPlaces` reads its index fields the same way and has the same gap;
  an index per pack at ready is a cost the hub weighs.
- **A Recall is drawn only where it can succeed** (`recallOffered`): a top row has no row to go back
  under and `recall` refuses it with `topRow`, so a card or chip there draws none; so does a row whose parent row holds no group. A parent holding a lone actor still refuses, with its reason.

- **A body is minted as the rank and file.** A body's spec names no role, and a Role axis with neither
  a default nor a pin rolls among every option, leaders included. A body's mint pins the rank-and-file
  key (`STANDARD_ROLE`) when the template's Role axis has no default and lists that key; an axis that
  names its own default is left to it. A pin is honoured only where a cell names the option (an option
  is available when it is the axis default or a cell names it), so an axis with no default and no
  rank-and-file cell still rolls a leader: its remedy is the default, written where the importer's
  `roleAxis` adds the axis, and is not made here. The key is the importer's structural name for the axis's
  first option, not a printed figure. Whether the walk's champion came from such an axis is not
  established offline; the test pins the procedure.

## 2026-11-25 — Remove takes one row

The owner (k): "the org chart tree is nested, removing from a level does not automatically delete the structure
beneath - these are stacking containers inventory of references to one source of truth objects". Remove from chart
now takes only the pressed row and lifts the rows directly beneath it to its parent, writing the host alone; before,
it handed the whole subtree to the removed row's group. Rejected: keeping the hand-off to the group, which moved
documents the pressed row did not name. Cost: a removed top row takes its `gen.template` with it, so the rows lifted
from it read no template until one is set.

## 2026-11-25 — A village is a faction with one row per part — SUPERSEDED IN PART 2026-11-25

Supersedes in part "Generate makes a root group; a Roll that makes a village makes its faction
card", which moved a village's rows onto a card made after the Roll and left the root group as the
top row's holder. New evidence, which that ruling did not know: the owner's A, "Village is a level
above warband, and is a faction by default/possibly definition", and the owner's sentence on the
parts, "They need the same controls as warbands, they just happen to be druges, whelps, prisoners,
females, beasts etc some of which are non-combat". Of group depth, the owner: "follow raw, it's
clear about up to two levels (group, and group of groups) for random encounters (aka wandering and
in-lair)".

- **The village is the faction.** Its warbands are the faction's top rows, with gangs inside them;
  the chieftain is the faction's `leaderUuid`; the village's own record (template, tier, leader
  role) rides on the faction, `flags["acks-extras"].organisationGen` (docs/lib/ORGANISATION.md),
  since no row carries it. Nothing is written to the faction's `strength`. A Roll makes the card
  first and writes onto it with `planRoll({topIsHost})`, then deletes the now-empty root group;
  the root group's roster rows and its parent group pass to each group that took its place.
  Undo of that Roll restores what it restored before, with the tracked lists the result carries
  (`created` the card, `deleted` the root).
- **Each part that is no body is a row of its own** beside the warbands, one stack, labelled as
  imported; there is no camp wrapping them at the village level. The village-level trait's
  beasts are a part row of their own. No combatant or non-combatant flag, gate or sort exists.
- **The split below the village level was not ruled on**, so a warband's or a gang's own camp
  child stays as landed, in a village or alone. A village whose top unit holds a body part of
  its own keeps the landed shape too, and a part-row plan refuses it (`topHoldsStacks`), since a
  faction holds no stacks.

The phase session's and the hub's rulings on what the build left open, on the owner's words
above and "No shipping house rules please":

1. **A part row's officer line is a warband row's line without Make.** Where a part row's group
   names an officer (`system.unit.officerUuid`, set by any path), the card draws the line with
   the portrait frame, Open, Clear, "Delete actor…" and Delete's linked-actor handling (the
   warning's tick, Undo). Make is absent: no disabled button and no words saying it is missing,
   since the imported entry carries no leader role for a part that is no body. A part row whose
   group names no officer draws no officer line in this slice, since the entry cannot feed a Make and this
   minor has no hand-assign path (superseded in part by lib's "An officer line that cannot make a leader adds an
   actor, and an actor dropped on any line replaces the officer", the same day: the line is drawn with
   **＋ Officer**, and a part row's line names no role word). The owner, of that empty state: "Just add an officer button solves this
   issue, user can manually drop one if they want as a replacement instead". A "+ Officer" button and an
   actor drop on every row's officer line are built in the next slice, not in this one.
2. **The village level's trait beasts are a part row of their own.**
3. **A village with a body part of its own keeps the landed shape**; the live walk reports
   whether the real beastman village has one.
4. **A part row offers no Roll.** The row's `gen.part` names the part's source, which the Roll
   writes for a part and for nothing else; the chart draws no Roll on such a row and Roll, given
   one, is refused as `part` (`ACKS-LIB.org.roll.refused.part`). It was already refused as
   `filled` while its group stood; the new refusal covers a row whose group was deleted. Slice
   (g)'s count die later becomes the part row's reroll; nothing is built for it here.
5. **"+ Make the chieftain" also shows when the faction's leader is blank** (after a Clear, say),
   as board 1q draws for any line with no officer. The seat test is unchanged.
6. **Every control on a part row keeps Foundry's ownership tests only**, as on a warband row, and
   no other gate is added.

Rejected: a flag marking a part combatant or not (the owner: "Add no combatant or non-combatant
flag, gate or sort"); a camp row under the village. Cost: a village whose top unit holds bodies is
the old shape until it is ruled on.

## 2026-11-25 — The recipe editor (S4b)

The editor is `scripts/monsters/recipe-editor.mjs`; what it does now is `MODEL.md`, "The recipe
editor". Ruled and picked while it was built:

**The Role select (the hub's approval of frame 1t).** "The Role select offers the shipped roles
plus Mount and Beast. A Mount or Beast part names its creature by a link to that creature's own
imported entry: its figures and its own recipe are read there and never copied in. 'Label' is not
a role: a part with no source is the labelled stack." This **reverses the S4b brief's pick 1**
(no mount, beast or label role), which was the phase session's pick and not an owner ruling.

**A Roll for a part with no link (the hub's ruling).** "A Roll for a Mount or Beast part with no
link writes a labelled stack named by the part's Label, with a finding on the Judges' card." The
finding is `unlinked` (`MODEL.md`, "The organisation roll").

**Five departures from canvas 3, by the orchestrator.**

1. The Units table shows the recipe's size rows; the village, warband and gang chain is not
   derived.
2. No caster Level field (the owner: "A recipe part carries no grade").
3. "Hit points fixed" is the new `fixedHp` field on a part.
4. Each door edits its own document, and the window's header names it.
5. A blank-label part shows its role.

**The editor's own picks.** No Save and no confirm, and Reset all writes at once; When is a
checkbox per unit word; Found in is a view filter and stores nothing; a share is edited as NN%;
a Mount or Beast word the import resolved is written into the part only on Link; unticking and
reticking a unit word reorders `when.units` and reads as a hand change.

**The doors.** Which document each of the three writes is `MODEL.md`, "The recipe editor".

Strongest counter-argument to departure 4 (medium): a Judge who edits a monster's Ecology tab may
expect a roll to change. The header names the document, and `MODEL.md` says which one a roll reads.

## 2026-11-25 — A grog breaks on its beastman bearer's defeated or dead status, never on its hit points (gear S9b-2)

The page breaks a beastman's own flask when the beastman is slain (MM p. 56).
**Ruled by the release hub** (its ruling 3): the break follows the defeated or
dead status only, and only where the bearer's own kind is beastman. A beastman
at no hit points with no status keeps its grog, since the Judge has not called
it slain; a body of another kind carrying a beastman's grog keeps it. The
listener reads the status on the actor itself, never lib's bearer-down hook,
which fires only for a reach's bearer and names hit points before the status.
The drink flag names beastman as the grog's own kind (`ownKind`), the closed
monster-type key the kind reader carries.

Rejected: breaking at no hit points (the Judge's call, not the hit-point
track's); breaking any bearer's grog (the page names the beastman's own).

## 2026-11-26 — An imported die takes the by-weapon modifier back off its own damage bonus (T-0724)

A stat line that prints a die or "by weapon ±N" moves the ±N onto the actor's
`system.damage.mod`, and core adds that modifier to every weapon the creature
rolls. A die that is the converted equivalent of the by-weapon damage counted
the modifier twice, and a natural attack beside a by-weapon one gained a bonus
it should not have. **Ruled** (the release scope's call, the route the beastman
phase 2 architect named): every weapon the binder mints beside a lifted
modifier whose formula is a die takes the modifier back on its own
`system.bonus.damage`, so core's addition nets to the die. The actor keeps the
modifier, which stays where a Judge edits it, exactly as for a leader-table die
(2026-11-24). It is applied where a die item and a lifted modifier meet:
`bindMonster` (the modifier is known only after every mode is read, so the
take-back is a second pass over the weapons), a form's attack routine
(`weaponsFromRoutine`) and a person block that prints routines beside a damage
clause. The legacy stat line, a grid row's single Strike and a person's single
weapon carry only the marker beside a lifted modifier, so they have nothing to
take back.

A weapon whose formula still says "by weapon" keeps a bonus of 0, including one
printing a different modifier than the first (it keeps that text, as before): a
by-weapon attack is what the actor's modifier is for, and nothing the page
prints would say what its bonus should be.

**Rejected.** Zeroing the actor's modifier, for the 2026-11-24 reasons. Writing
the difference onto a differently-modified by-weapon segment: it would invent a
figure for a case no page forced and cross the grade-die take-back, which reads
a bare marker.

**Cost.** The take-back is written at import against the modifier then on the
actor. Where a later stage rewrites the actor's modifier (a leader's printed
bonus, a kit, a trait), a die weapon nets to the change from the imported
figure rather than to zero. A repair in place replaces a creature's minted
weapons, so it writes the take-back too. The Statblock and the Follower Card
already add the weapon's bonus, so a converted die shows alone with no
modifier part and no converted-die note, and a natural die beside a by-weapon
attack shows its die alone.

Strongest counter-argument (medium): the take-back is a figure on each weapon
that a Judge who edits the actor's modifier must change too. The weapon's own
Damage bonus field (Item sheet) shows it.
