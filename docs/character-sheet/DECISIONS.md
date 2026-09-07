# Character sheet — decision record

Why the sheet is shaped the way it is: what was ruled, what was rejected, and
what it cost. How it behaves *now* is [MODEL.md](MODEL.md).

Entries are dated and append-only. A superseded entry stays, marked.

---

### The module's own character sheet, and it is the default (2026-09-03)

User direction, verbatim: *"note this is new default preserve original"*. The
sheet in `scripts/character-sheet/` registers at `ready` as the **default**
sheet for `character` actors. The system's own sheet is not touched, not
unregistered and not wrapped: it stays in the sheet registry, a Judge can set
it back per actor or for the world through Foundry's Sheet Config, and every
injection this module makes into it (wear buckets, the class picker, the
casting strip, the roster button, the Storage tab, the class-modifiers
section) keeps working there unchanged. No field moves and nothing is
migrated: the new sheet reads and writes the same core paths the old one did,
so switching an actor between the two loses nothing either way.

**Rejected: subclassing the system's sheet.** The whole point of the design
is a different layout — the band in the window header, the rails around the
portrait, tabs organised by play rather than by document type — and a
subclass that moved core's nodes around would depend on the shape of core's
templates for every one of them. The item sheet went through that once
(equipment DECISIONS 2026-08-23) and the ruling there transfers whole: the
surface is this module's own markup over the module's own view-model, and
nothing in it depends on how the system renders.

**Rejected: registering it as an alternative only.** Conservative, and what
the first draft of this entry did — but the user's direction is the default,
and "the original is preserved" is the safeguard that makes that safe: a
world that prefers the old sheet is one Sheet Config click away, and the old
sheet's injections are still maintained.

**Refined 2026-09-04** (new evidence: the user's ruling that the sheet
defaults are a world-level selection between Foundry's, the system's and this
module's, asked once at startup). `makeDefault` here is now this module's
declared choice for the lib's default-sheet ladder to read; whether a world
opens on it is the `uiPreset` world setting — lib DECISIONS 2026-09-04. The
module's sheets remain the shipped default, so nothing above is reversed.

### The design canvas is the specification (2026-09-03)

The layout, the tab set, the rails, the tones and the dedup ledger were
worked out on the Claude Design canvas *Extras Character Sheet* across some
thirty rounds with the user; the working files are the gitignored
`design/character-sheet/` (`build.mjs`, `shared.mjs`, the artboards). The
rulings that came out of it, so they survive the canvas:

- **Style follows the printed sheet by way of the vendored tokens**; organisation
  follows play. Rolls is the one-stop dashboard, the rails carry what is asked
  for mid-fight, and everything else is filed by kind.
- **"Anything in two places has to pass a justification round."** The
  sanctioned exceptions, and why each stands:
  - *Rolls* repeats every throw with its target — so nobody hunts a die
    mid-round. Every other surface shows a throw as the d20 alone; the target
    is the tooltip and this tab.
  - *HP*: the rail heart holds the current total and the fill is the fraction;
    the full pair, current over maximum, is edited on Stats. One is the gauge,
    the other the pen.
  - *Movement and AC*: the rail cell shows the number in force for the mode
    you are in; Stats lists the table. Same shape as HP.
  - *Save and adventuring targets*: Rolls shows them, Stats edits them.
- **Gone from the header**: the Class badge (the tab and the glyph carry it),
  the encumbrance cell (the Load bar is the one place; the movement cell's
  colour is the alert), the THROW tags and targets on ability rows, the fixed
  coin ledger, and the roster and rest cells (character actions, not sheet
  tools). The far-right rail is sheet tools only.
- **Attribute checks are not rolls in ACKS II**, so the attribute boxes carry
  no die. Hit dice are a stat, not a throw; the Stats page offers the one
  roll that writes a new total, for a monster or a fresh sheet.
- **Counts in the tab strip only where "how many" is the reason to open the
  tab** (Followers, Effects). A gold badge is a choice waiting and disappears
  when answered.
- **Six tones, one meaning each**: green a positive status, red a negative
  status or harm, amber a mundane thing burning down, violet magic running,
  gold specialization and achievement, burgundy identity and selection.
- **The fold** hides everything but the band, the portrait and the rails, and
  puts the starred rolls, timers and counts in a bar beside the unfold
  chevron. No XP bar folded; no targets in any rail cell, folded or not.

**Not built from the canvas** (each is on [ROADMAP.md](ROADMAP.md)): the
staggered hex rails of option D, the medallion header (B) and the vitals
strip (C), the dashed "any three / any five / restricted" drop slots on the
training list, and the Magic and caster-Effects boards that were never drawn.

### The rails draw Foundry's icons (2026-09-03)

The canvas drew its own stroke glyphs — a heart with the total inside, a
shield with the AC inside, two hands open or clenched. The equipment feature
ruled on 2026-08-23 that *the rails draw Foundry's icons and no mark is this
module's own drawing*, and that ruling was not reopened: the user was told
of the conflict during the design pass and left it standing. So every glyph
on this sheet is a Font Awesome icon the platform ships. The two shapes the
canvas composed — a figure inside a glyph, two hands side by side — are
composed here too, from those icons: the number is text overlaid on the
heart or the shield, and the grip cell is two hand icons, each open or
clenched, drawn together on one haft for a two-handed weapon. What was
bespoke on the canvas was a design-time stand-in, not a spec.

### Core's sheet is dressed by injection; this sheet asks for what it wants (2026-09-03)

Eleven render hooks in this module decorate the system's character sheet
by DOM injection. Every one of them gates on the actor's type, and most gate
on a selector core's template carries (`.sheet-inventory`, the class input,
`.active-effects`), so on this sheet they fall through harmlessly. Three did
not, and were gated rather than left to guess:

- the casting strip fell back to `root.querySelector("header")` when no class
  input was found, which on any non-core sheet is the WINDOW header — the
  strip landed between the frame and the content. The fallback is now core's
  own `.sheet-header`; this sheet mounts the strip where its Magic tab wants
  it, through the exported builder.
- the Storage tab injected itself into any sheet with a primary tab strip.
  Storage here is the "Kept elsewhere" rule on Equipment, so the injector now
  skips the module's own sheets.
- the roster button landed in every character sheet's window header. Roster
  here is a chip on Followers, beside the cards it manages.

The gate is one predicate, `ownsSheet(app)` in `lib/util.mjs`: an application
whose declared classes carry `acks-extras`. The rule it states: **an
injector dresses the system's sheet; a sheet this module draws itself calls
the feature's builder and places the result.** The class-modifiers section
and the casting strip export exactly such builders, so the two sheets render
the same section from the same code and cannot drift.

### Where the fold and the pins live (2026-09-03)

The canvas said the fold "remembers its state per user, on the actor's
flags". Built on the **user document** instead (`flags["acks-extras"].sheetFold`,
keyed by actor id): a user can always write their own flags, so an observer
seat — a player looking at another's sheet, a Judge on a player's character —
can fold too, where an actor flag would need ownership and silently not
stick. The fold is a viewing preference, and viewing preferences belong to
the viewer.

The **pins** are character data — what this character's player wants at hand
— so they live on the actor (`flags["acks-extras"].sheet.pins`), the way an
item's favourite lives on the item. A pin on an ITEM'S roll is that item's own
`system.favorite`, which core already stores and the item sheet already
toggles; the actor flag carries only the rolls no item owns (saves,
adventuring, initiative, the healing rate) and the starred timers and
resources. One fact per thing, and the folded bar reads both.

### The training list keeps the lib vocabulary (2026-09-03)

The canvas drew the RAW weapon hierarchy — the six narrow categories of the
book, with bows and crossbows as one — and noted that the lib's `SLOT_VOCAB`
splits bows from crossbows and adds an unarmed chip. That vocabulary is
shared by the follower card, the inventory strip and the class-modifiers
editor, and changing it is a cross-feature decision the user has not ruled
on. So the Stats tab renders the explicit list FROM the vocabulary as it is:
each of the eight lib classes as a collapsible bucket, opened to the
individual weapons the equipment feature's own table files under it, lit by
the same proficiency test the attack roll uses. Adopting the book's six is
[ROADMAP.md](ROADMAP.md).

### Rolls the system has no method for (2026-09-03)

Initiative and the two surprise throws are on the Rolls tab because the
canvas put every throw there. The system rolls initiative only through the
combat tracker and surprise only through the Judge's Surprise Matrix, so the
sheet does this: a character who is a combatant in the active combat rolls
initiative through the tracker (core's formula, and the initiative-card
patch applies); otherwise the row rolls the initiative die with the
character's modifier to chat. Surprise rolls the die with the character's
own modifier and posts the result, and states no threshold — the matrix is
the Judge's, and the sheet does not second-guess it.

### The last right-rail cell is the character's own party (2026-09-03)

User direction, verbatim: *"the bottom right rail, I want it to be the actors
party, so their henchmen and summons by default with a little # of how many
(summons add a * per, eg 1** is 1 hench 2 summons) are on the scene and
color shift if suffering a calamity. it promotes to the formation if in one
on the scene."* Built exactly so, with three readings the direction left to
be settled:

- **"The party" is the henchmen the system and the henchmen feature already
  record** — `henchmenList` and the monster henchmen list — plus the
  summons. **A summon is a creature whose actor names this character as its
  summoner** (`flags["acks-extras"].summonedBy`, the character's uuid), because
  nothing in the module modelled a summon before this: the formation feature
  files "a summoned thing" under not-a-person for XP, and the initiative card
  mentions a summoner's group, neither with data behind it. The party menu is
  where a Judge binds one — the controlled tokens become this character's
  summons — and releases them. The flag lands on the summoned actor, which
  for an unlinked token is that token's own delta, so a summoned monster's
  three tokens are three summons and go away with their tokens.
- **"Suffering a calamity" is the henchmen record's `pendingCalamity`**: set
  when a managed hireling is brought to zero hit points and cleared when they
  are healed above it. That is the one calamity state the module holds per
  henchman; the tone is the harm red, and it counts every henchman of the
  character, present or not — a follower down in the next room is still your
  calamity.
- **"On the scene" is the scene on the canvas**, else the world's active
  scene; the formation "is on it" when its party token is. A formation whose
  token is elsewhere leaves the cell in party mode and is named in the
  tooltip.

**Rejected: counting formation members with the asterisk notation.** A
formation's members are people in a marching order, not a summoner's
creatures; the cell in formation mode shows the plain count of members
present and opens the party sheet, which is where the order is read.

### Conditions ride on the save that clears them (2026-09-03)

A status effect on the character rides on a left-rail save cell, keyed by
status id: the Foundry ids for restraint, paralysis and the like ride on
Paralysis; poison, disease and bleeding on Death; burning, frozen, shock and
corrosion on Blast; sleep, fear and a curse on Spells. A status with no
mapping takes the save its source names, when the effect's origin is an item
with a `save` field. The book names the save only for escapes and
enervation; everything else takes the save of what imposed it, which is what
the origin knows. The mapping is a table in `constants.mjs`, so a world that
adds its own conditions extends it in one place.

An effect that CHANGES a save — the global save modifier or one save's value
— colours that cell with the signed number, green when it helps and red when
it hurts, split when both are in force. That reading is data-driven and
replaces the canvas's illustrative "Bless +1" on the Spells cell: Bless does
not touch saves, so it is a timer on Effects and nothing on the rail.

### Training is edited once, on Stats, at the weapon (2026-09-04)

**Asked.** Three surfaces edited the class training effect and disagreed on
grain: the Effects tab's class-modifiers grid (eight weapon chips, five
armour icons), the Stats tab's buckets (class toggles beside an explicit
weapon list that could not be toggled), and core's Active Effect config —
reached from the Stats note's EFFECTS button — a fixed-height window outside
the scroll contract that offers three CSV text fields. User direction:
training is one thing, edited in one place, on the Stats tab; the grid
leaves the Effects tab; the core window is no longer a route; **every armour
rung and the shield are shown explicitly** (overruling the Stats note's
"heaviest only · lighter is implied"); the weapon list regroups by book tier
and by size and can be shown ungrouped, with the individual weapons as the
atomic units that move between groups; a pencil arms editing; a badge marks
a departure from what the class prints; owners may add training by hand.

**Ruled.** The Stats tab's Training block is the editor. Its units are the
36 weapons of the equipment table (`equipment/training-view.mjs`), each one
pill with one glyph, placed once per organisation by first-match against the
grammar's own tokens: *by category* (the seven narrow tokens), *by size*
(the four `melee:<size>` clauses, then `missile:all` — the broad kinds), *no
grouping* (`all`). A group header is a control for its token; a member is a
control for that weapon. Anything an organisation does not place lands in a
trailing *Elsewhere* group — empty for the shipped table, present so a
future weapon cannot vanish. The organisation is a viewing preference and
lives on the user (the fold's ruling, above); the pencil and the open groups
are sheet state.

**The grant is always written canonically.** A toggle computes the unit set
and writes the shortest clause list that covers exactly it, in a fixed order
(`canonicalGrant`). This supersedes the classes ruling of 2026-09-03
("append on ON, expand only the clause that must expand on OFF, never
collapse back to `all`"). New evidence: that ruling's cost — a size clause
widening to a whole category because a class pill could not say "swords of
medium size" — existed only because the editor's finest control was the
class; with a control per weapon every expansion is lossless and every
collapse is one click reversible, so nothing needs to stay explicit for a
later edit's sake. The bare `crossbow` is a category in the grammar and a
weapon in the table, so the one weapon is written `weapon:crossbow`
(`equipment/proficiency.mjs`), the only token the grammar gained.

**Provenance explains; it never decides.** Each pill's lit state is still the
strips' and the attack roll's own test. Beside it, `trainingProvenance`
lists every source that grants the slot — the class effect, another effect
by name, an ability item by name (the bridge now records which item
contributed which token), the sheet's own flag — and a pill lit by no class
source refuses the click in edit mode with the source in its tooltip, since
a control that will not switch off must say why. The badge compares the
class effect's grant to the class document's printed one (`editedSlots`,
reading the document through the effect's `fromClass` uuid plus the chosen
path options) and is silent when the document is gone.

**Rejected:** shipping the page's numbered pick-combinations (broad choices
i–vi, "any five") as a fourth organisation. Those are the custom-class
builder's option table, content under the IP doctrine; a *book picks* view
would read a registered table the importer emits and appear only in a world
that imported it ([ROADMAP.md](ROADMAP.md)). The tier CAPTIONS ship: the
kind of a token is what `classifyGrantToken` already distinguishes.

**Rejected:** keeping the Effects-tab grid on this sheet as a second view.
Two controls for one document disagree on screen the moment one of them
rounds; the training row stays in *Managed by the module*, locked, with its
control sending the reader to Stats. The system sheet's injected grid
stands, at class granularity, until that sheet is retired.

*Cost:* a grant edited by hand no longer round-trips to the spelling the
importer wrote — `missile:all,melee:tiny,melee:small,melee:medium` comes
back from an ON/OFF pair as the same four clauses, but a class that printed
`swordDagger,spearPolearm` returns as `sworddagger,spearpolearm`. The
profile compares case-insensitively; only a hand-read notices.
*Learned live, same day:* the first live pass could not open the sheet for
any classed character — `printedTraining` called `flatMap` on the class
document's `effects`, an EmbeddedCollection that has `map` and `filter` and
no `flatMap`, and every offline mock is a plain array. Two guards came out
of it: the read spreads the collection first, and the Stats build wraps its
two explainers so a throw there leaves the pills lit and unannotated rather
than the sheet unrendered. The test mocks the document's `effects` as a
Collection-like object so an array cannot hide it again.
### The XP bar is a slider as well as a button (2026-09-04) — SUPERSEDED the same day, below

User direction: *"I would also like to make the xp bar draggable instead of a
button."* The bar opened the Class tab, where the XP field lives; the request
is to set the number on the bar itself.

Ruling: a press that travels sets the experience by where it is released,
mapped across the bar's width and clamped to the threshold; a press that does
not travel is still the click that opens the Class tab. The fill and the label
follow the pointer live, the write lands on release, and the re-render settles
the band. The Class tab's field stays — it is where a number past the
threshold, or one with no threshold to map against, is typed.

Rejected: replacing the button outright. The Class tab is where the level-up
lives, and the bar is the one control on the band that points there; a slider
that could not open it would strand the gold band's promise.

Cost: a click after a drag is swallowed for a moment so the release does not
also open the tab; a bar with no threshold is not draggable, since there is
nothing to map the width to.

### The XP bar is a reading, and a press on it drags the window (2026-09-04)

Supersedes the slider ruling above, made earlier the same day. **The new
evidence is the user's own reading of the request**, given once the slider
was built and live-verified: *"Not at all what I want. It stays a display
only, not a control."* "Draggable instead of a button" meant the bar should
behave like the rest of the title bar — a press on it moves the window — not
that the bar should set the number. The first ruling read "draggable" as a
gesture on the value; the author meant a gesture on the sheet.

Ruling: the bar is a plain element with no action and no listeners. The band's
pointer guard stops only its controls, so a press on the bar reaches Foundry's
header drag exactly as a press on the title does. XP is typed on the Class
tab, which the class glyph before the name still opens.

Cost: the bar no longer opens the Class tab on click. Accepted; the glyph
beside it does, and a reading that is also a button was the confusion the
report names.

### Changes are replayed by type, and the clock reads the unit it was given (2026-09-05)

Evidence: one bridge `sheet` read of a character logged eight Foundry 14
deprecations — the `CONST.ACTIVE_EFFECT_MODES` enum, the numeric `mode` of
every change, and the `rounds`/`turns`/`seconds` getters of every effect's
duration — all removed in Foundry 16. Under them the sheet counted only
`add` changes: a `subtract` was not read at all, an `override` or a
`multiply` was summed as if it were an addition, and the clock knew rounds
alone.

Ruling: the lib's effect scanner is the one reading of what a change does.
It replays the enabled changes on a field, in Foundry's priority order, from
the field's source value — add, subtract, multiply, override, upgrade and
downgrade each by Foundry's own arithmetic — and attributes to each effect
the movement it caused. A save modifier is that movement: an override reads
as the difference it makes, a lowered target as help. The CSV grants honour
subtract and override the same way. The clock reads the unit the effect was
given — rounds and turns for the game, seconds, minutes and hours for the
clock, days, months and years for the calendar — and counts down through
Foundry's prepared remaining, which the world calendar converts; a rounds or
turns effect outside combat, which Foundry restates in seconds, is converted
back through the world's round or turn length. The rider and the Effects tab
print each change with a glyph for its type.

Rejected: reading a modifier as the derived value minus the source. It would
have been the system's arithmetic rather than a second copy of it, but it
cannot run under Node, it says nothing about which effect did what, and a
derived value the system rounds or clamps would hide an effect entirely.

Rejected: keeping the numeric-mode reading behind Foundry's migration shim.
Foundry 16 removes it, and the shim's once-per-session log is the first thing
every bridge client sees.

Cost: a `custom` change reads as nothing, since only the package that wrote
it knows its meaning; an `override` on a CSV grant replaces the set where it
used to add to it; a thirty-second effect reads `30s` where it used to round
up to `1m`; Foundry counts a month's remainder up on both ends, so a fresh
two-month effect stands at its total where Foundry's own label says three;
and a rounds effect that outlives its combat restates from its full value,
as Foundry's label does, not from what was left when the combat ended.

### The hands span, and the bar shows what is forgiven (2026-09-05)

Field report: *"two-hands should not be a separate bucket in equipment,
rather two handed items bridge the main and off hand"*, and *"show the true
weight as a phantom extension on the bar dashed with no fill so the effect
is visually explained and clear its working"* — the second after finding
that a harness makes the number on the sheet smaller than the kit adds up
to, with nothing saying why.

Ruling: the vocabulary keeps its both-hands place — the lib's resolver and
core's buckets answer "where is this held" with it — and the sheet folds it.
When a weapon is held in both hands, the Main hand and Off hand places become
one row carrying both labels behind one bracket, keyed by the main hand so a
drop on it still draws; when nothing is held in both hands the two stay
separate targets and no both-hands row is listed. The Load bar draws two
readings on one track: the burden core computes as the fill, and the true
weight — the lib's `carriedWeight6`, everything on the body at what it
weighs — as a dashed, unfilled phantom running on from the fill. The label
reads both figures and the tooltip says how much is forgiven. Where the two
agree, or a correction adds weight, there is no phantom.

Rejected: removing the both-hands place from the vocabulary. It is the true
answer to where a thing is held, core's inventory and the wear resolver both
use it, and the report is about the listing, which the sheet owns. Rejected:
rescaling the track to the true weight so the fill never reaches the end.
The breakpoints are core's percentages of the maximum, and the bar has to
keep telling the truth about slowing. Rejected: a setting to hide the
phantom. It appears only while a rule is working, which is the moment it is
wanted.

Cost: the folded row's over-capacity mark is the sum of two capacities rather
than a rule of its own; the over-capacity class is `is-full`, since `is-over`
is the drag state every drop zone shares and a place wore both; the forgiven
weight is a tooltip beside the label rather than a third figure on it, so a
reader who never hovers sees the two figures and the dashed gap between them.

### Magic slots and equip slots are different counts (2026-09-05)

Evidence, the same day as the entry above: that entry marked a place over
capacity by counting everything at it, and the owner ruled on a helm over a
coif reading as two of one — a magic item takes its form's slot, a piece of
armour or a weapon takes the place, and clothing takes neither; a magic item
stacks over plain wear.

Ruling: the lib counts a place twice (`slotUse`): magic items against the
Treasure Tome's capacity for the form, armour and weapons against the one the
body allows, and the place is over when either count is. Clothing and plain
gear count against neither. The badge shows the larger count and carries both
in its tooltip; the folded hands row is over when the equipment across both
hands is more than two hands hold. "Magic" is the markets feature's
declaration on the item or a magical variation inside it.

Rejected: counting plain gear against the form. A coif under a helm, an amulet
beside a torc and a pouch beside a scabbard are ordinary wear the rules never
refuse. Rejected: a physical capacity per place. The one physical exclusion
the body has is a second piece of armour or a second weapon at one place, and
that is a type test rather than a number per place.

Cost: a plain ring is jewellery, so three of them show no warning — the
Tome's rule is about magic rings — and an unmarked magic item counts as plain
until it is declared magic or wears a magical variation.

### The canvas figures are a specification, scaled by a ratio (2026-09-07)

Field report: the `fontScale` client setting had no effect on this sheet
while it worked on every other ACKS surface. Measured live, dragging it from
14 to 18 moved **26 of ~865 elements** — the sheet was written in absolute px
(63 `font-size` declarations, 62 of them literal, and 213 px lengths in all)
because the design canvas is stated in px. Two files in the module were off
the `--acks-fs-*` ramp; every other stylesheet was already on it.

Ruling: the canvas figures stay exactly as drawn and are **multiplied by
`--acks-extras-k`**, the type knob expressed as a ratio (`calc(var(--acks-fs-base)
/ 14px)`, published on `.acks-extras` in `styles/lib.css`). The whole drawing
scales — type, cells, rails, portrait, gaps — so the sheet at 18 is the sheet
at 14, larger. A px literal that survives in the stylesheet is therefore one
of exactly two things, a **stroke** (0 and 1px) or a **floor**, which is the
rule a diff is read against.

Rejected: **snapping the 16 canvas sizes to the vendored ramp.** The ramp is a
book scale and has one step between 9.38 and 12.46px; 40 of the 63
declarations live in that gap. Snapping would move them by −6% to +25% *at the
default setting*, redrawing the sheet for every user in order to fix a knob.
A form scale wants six steps where a book wants one.

Rejected: **CSS `zoom` on the sheet root**, the one-line answer. It puts the
frame in a second coordinate space that ApplicationV2 mixes with the first:
the window travels 1.29px per 1px of pointer drag, the implicit-height branch
re-measures and re-writes an inflated height on every render, and the
off-screen clamps compare a zoomed paint against an unzoomed figure. It also
scales the hairlines the token file keeps at whole pixels, and double-scales
every shared component that already rides the ramp.

Cost: a large mechanical diff, and a second file (`equipment-item-sheet.css`)
in the same shape still to follow. The two `@container` breakpoints moved from
px to `em` so they resolve against the sheet's own size and collapse the row
when the *drawing* outgrows the frame — verified live: the place column
collapses below 840px at base 14 and below 1080px at base 18. The opening
width follows the ratio in `sheet.mjs` (`atTypeScale`), while `min-width`
deliberately does not: scaling the floor to 823px would push it past those
breakpoints and disable the narrow layouts for the user most likely to need
them.

Two cascade defects surfaced with it, both invisible offline. Core pins a
font-size on `.window-content` **and** on `.window-header`, and those are the
elements the sheet body and the title band inherit from — so the size set on
the frame reached neither. And core's `flex: 0 0 36px` on the header outranks
this sheet's `height: auto`, which had been clipping the 45px band at both
edges since it shipped; `flex: 0 0 auto` is what makes the declaration real.
