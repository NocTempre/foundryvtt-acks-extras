# Character sheet — how it works now

The module's own sheet for `character` actors (`scripts/character-sheet/`),
registered at `ready` as this module's default for the type; whether the
world opens on it is the lib's UI preset (lib MODEL § "The UI preset"), which
ships choosing it. The system's sheet stays registered untouched; Sheet
Config switches an actor back. Why it is shaped
this way is [DECISIONS.md](DECISIONS.md); what is not built is
[ROADMAP.md](ROADMAP.md); the live-test recipe is [TESTING.md](TESTING.md).

## Three layers

`snapshot.mjs` and `tabs/*.mjs` read the actor into plain data through the
feature that owns each fact — the loadout for the hands, the light model for
what is burning, the senses model for what sees in the dark, the class
registry for the XP threshold, the container report for what is inside what.
`view-model.mjs` makes every decision about what the FRAME shows — the XP
bar's gold state, the HP fill, the AC cycle, the grip glyphs, the light
cell's reading, the condition riders, the tab badges, the pin store — on that
data, with no Foundry in reach, and `tools/test-character-sheet.mjs` asserts
it offline. `sheet.mjs` binds the decisions to Foundry: the form, the
actions, the drops, the rail menus, the window chrome.

## The frame

**The band is the window header.** The title band renders as its own part
and `_onRender` moves it into Foundry's `.window-header` — the same mechanics
as the item sheet. It carries the class glyph (the bound class document's
image, else a mortarboard), the level title before the name, the name field,
and the XP bar: burgundy toward the threshold, gold and labelled *Level up*
at it. The threshold is the bound class document's next-level XP, else the
sheet's own `xp.next` field; with neither the bar stays empty.

**The art row** carries the two rails around the portrait, the prose column
(the biography, enriched; the class and alignment as an overline; alignment,
level, age and fate points as tags) and, for an owner, the sheet-tools rail:
description, portrait, tags, ownership, source (a Judge), Tweaks.

**Left rail**: Influence (the influence feature's roller), then the five
saves as roll cells. A save cell shows its glyph alone; the target is the
tooltip and the Rolls tab. A condition riding on the save (see below) takes
the cell over: the effect's image, its clock, the fill as the time left, the
save's glyph in the corner, a count when several share it. A modifier in
force on the save colours the cell with the signed number.

**Right rail**: the heart with the current total inside and the fill as the
fraction (red at zero, where a click opens the system's Mortal Wounds
window; otherwise a click goes to Stats); the AC figure inside a shield, a
shirt or a dashed box — a click steps shield → without → unarmoured, and the
choice is kept on the actor's sheet flag; the movement mode's glyph and
figure, amber or red when the load slows the character, a click opening a
menu of the six modes; the grip — two hand icons, each open or clenched, on
one haft for a two-handed weapon, the shield hand wearing a shield, the
cleave count beside them while a weapon is held — with a menu to draw,
sheathe or change grip; the light cell answering *what can I see by*
(blinded → a burning source with its reach and burn-down → daylight → a dark
sense → the dark, explicitly 0′), with a menu to light, douse, shutter or
ready a torch; and the party cell.

**The party cell** (`snapshot.mjs` `partyOf`, `view-model.mjs` `partyCell`)
is the character's own party on the scene: the henchmen present as a figure
and each summon present as an asterisk (`1**`), red while any henchman has a
calamity pending on its henchmen record. A summon is a token whose actor
carries `flags["acks-extras"].summonedBy` naming this character. The click
opens a menu: each member on the scene (a pick selects its token and pans to
it), how many are elsewhere, and for an owner the binding of the controlled
tokens as summons, their release, the roster and the Followers tab. While the
character marches in a formation whose party token is on the scene the cell
is that formation — the marching-order glyph, the count of its members
present — and opens the party sheet. With no party and no formation it is a
dashed pad that still opens the menu, which is where the first summon is
bound. Token creates, updates and deletes on the scene, the scene change and
the formation record all re-count it.

Every glyph is a Font Awesome icon the platform ships; the figure-in-glyph
is text overlaid on the icon.

**Daylight or dark** is read off the scene the character's token stands on
(darkness below one half is day), else the viewed scene, else nothing; with
no scene the cell falls through to a sense or the dark.

## Conditions on the rails

`snapshot.mjs` maps every enabled effect on the actor: a status id in
`CONDITION_SAVES` rides on that save; otherwise, for an effect that is a
status or a timer, the origin item's `save` field names the save (free text,
matched by prefix: paralysis, death/poison, blast/breath, implements/wand/
staff, spell/magic). `RAIL_CONDITIONS` sends prone and stunned to the
movement cell, unconscious and dead to HP, blinded to light. A change to
`system.save.mod` colours all five cells; a change to one save's value
colours that one — a lowered target reads as help.

## The tabs

Rolls · Abilities · Equipment · Stats · Class · Magic (casters only) ·
Followers · Notes · Effects. Followers and Effects carry a count; Abilities
and Class carry a gold badge for choices waiting; Class goes gold while the
XP bar is full. The chevron before the strip folds the sheet.

**Rolls** (`rolls.mjs`) lists every throw with its target in three columns:
saves, initiative and the two surprise throws (plus morale and loyalty for a
retainer); the two attack boxes, every weapon's modes (from the item sheet's
own roll rows, wielded first and ringed), the unarmed strike when nothing is
held, and the healing rate; the adventuring throws and every ability's
throws (the abilities feature's roller, one row per throw). The whole row is
the button; the pin beside it stars the roll for the folded card. Row ids are
stable (`save:death`, `wpn:<id>:atk:melee`, `abl:<id>:<key>`), and
`rollById` dispatches each to the path that owns it: the system's actor
methods, the item sheet's `rollById`, the abilities feature's `rollAbility`,
the combat tracker for initiative when the character is a combatant, and a
plain die with the character's own modifier for initiative outside combat
and for surprise.

**Abilities** files proficiencies, powers and languages by the buckets the
classes feature already uses for its category tabs, with a filter row when
more than one bucket is present. A row carries one d20 per throw, the
favourite star (the item's own `system.favorite`), show, edit and delete. A
pending pick (the classes feature's marker item) is listed under *Choose*,
and the classes feature's own render hook makes the row open the chooser.
Open language slots on a carrier item appear as a *Choose: a language* row
whose button runs the abilities feature's picker.

**Equipment** (`tabs/equipment.mjs`) is the body map made a list. The Load
header's underline is the encumbrance bar with the system's breakpoints as
ticks, beside the hands badge (used of budget, the active style, the clause
for hands a light or the map is taking) and the annotate chip. The left
column lists every wear slot in the lib's order, each a drop target: worn
gear at its slot (resolved by the equipment feature's `wearLocation`), a
worn container with its capacity bar, its header controls and its contents
nested, and an empty slot as a hint. The right column is a drop target for
taking things off: loose gear filed as weapons, armour, coin and valuables,
and gear; the unarmed strike when nothing is held; containers carried rather
than worn under *Stowed*; and *Kept elsewhere*, one row per place holding
the character's goods (the lib's storage providers), with deposit, retrieve
all, pin and open. Row controls sit in three groups: the attack die, the
state toggles (draw or sheathe, wear or remove, grip, strap, light, ready a
torch, take out, split, favourite), and edit and delete.

A drop of the character's own item onto a slot wears or draws it (out of a
container first), onto a container stores it, onto the loose column takes it
off or out. Coin arriving from a compendium merges into the stack of the same
name. A dropped place is pinned; any other actor is hired, as the system's
sheet does.

**Stats** is what is not a throw. The six attributes in the design system's
attribute boxes, editable, with the modifier under each and no die; the
system's Modifiers summary and Scores Generator as chips. **Training** is
the one editor of the class training effect, at the finest grain the grammar
has: the five styles; every weapon of the equipment table as its own pill
(name and damage-type glyph, the same in every arrangement), placed once
under whichever organisation the viewer chose with the view button — by
category, by size, or ungrouped (`equipment/training-view.mjs`; the choice
is a user flag, `trainingView`) — each group header captioned with its tier
and toggling its whole clause; every armour rung, lit to the ceiling, and the
shield as its own slot, lit by the Weapon & Shield style. Each pill is lit by
the attack roll's own proficiency test (gold under Weapon Focus or a
specialisation), names in its tooltip every source beyond the class that
grants it (`classes/training.mjs` `trainingProvenance`), and wears a dot
where a hand moved it off what the class prints (`editedSlots`). The pencil
arms the pills for an owner — a pill another source lit refuses the click
and says why; a character with no training effect gets one, stamped by hand,
on the first edit — and *Reset to class* re-applies the printed training
while a departure exists. A note names the effect the edits write. Movement
by mode (fields freed when the system's
auto-movement is off), vision light by light (daylight ∞, the dark at 0′ or
the sense's reach, each light source's reach, the two dark senses), the
vitals (HP current over full, the hit dice with a roll that writes a new full
total after confirming, AC with and without the shield and unarmoured, the AC
modifier, cleaves, mortal wounds), and the throw targets — attack throw,
saves, the save modifier, adventuring throws, initiative modifier, surprise
modifiers, healing rate — which is the pen for what Rolls shows. A retainer
gets its wage, morale and loyalty fields.

**Class** shows the bound class document (opens on click), the level and
title, the XP pair and the free-text class field, with chips for the class
picker and the Scores Generator. While the XP bar is full a gold band names
the level advanced to and the *Level up* button opens the classes feature's
wizard. Underneath, a preview built from the same `classUpdateData` the
wizard writes with: every field the next class row changes, from → to; the
awards fixed at the next level; the choices owed. A class stating paths gets
one select per group, writing the choice to the class ledger.

**Magic** appears when the system's spells are enabled or the bound class has
a casting tradition. The classes feature's casting strip mounts at the top
(pips to spend, a rest control); the repertoire lists by level with the
system's slot pair (used, and the editable maximum), each spell with its
cast count, a Cast control that spends it, show, edit and delete.

**Followers** renders the employer's hirelings as Follower Cards in the
henchmen feature's buckets — the system's character henchmen and the
module's monster henchmen alike — with show, loyalty, morale and dismiss on
each, the Roster chip, and the wages due with a Pay button.

**Notes** is the character's notes as prose with an edit toggle, and the
influence feature's relationships (attitude items) as rows: open, drag to
another actor, delete.

**Effects** (`tabs/effects.mjs`): timers — every effect with a duration and
every light burning — each with its bar in the tone of what it is (amber
mundane, the magic tone for a spell's effect, red for a condition, green
otherwise), with douse and shutter on a light, toggle, edit and delete on an
effect, and a star; the riders on a save, each with its clock and the save's
die; what the module manages (the managed effects, locked, each with an open
control — except the training effect, whose control goes to the Stats tab,
the one editor of what it holds); the
resources — rations, oil, torches from the stacks on Equipment, fate points
with spend and award, and a caster's pools — each with a star; and the
modifiers in force with toggle, edit, delete and an add control.

## The fold and the pins

The fold hides everything but the band (compact, no XP bar), the portrait and
the rails, narrows the window to the card once the root carries `is-folded`
(the open sheet's minimum width would otherwise clamp it), and puts a bar
under the art row: the unfold chevron, then the starred rolls as quiet roll
chips (the wielded one ringed), the starred timers as filling chips, the
starred counts with their number. The fold state is a user flag keyed by
actor id, written as an explicit true or false because `setFlag` merges; the
pins are the actor's sheet flag for rolls no item owns and for timers and
resources, and an item's own `system.favorite` for its rolls.

## Read-only seats

DocumentSheetV2 disables every form control on a sheet the viewer cannot
edit. The sheet re-enables its view-only actions afterwards — the fold, the
tab strip, the rail menus, a roll (as the system's own sheet lets an observer
roll), and anything that opens another window — so an observer can fold,
browse and roll, while every write control stays disabled and every owner
control is not rendered at all.

## What the injectors do here

`ownsSheet(app)` (`lib/util.mjs`) is true for every window this module draws.
The casting strip, the Storage tab and the roster header button stand down
on it; every other core-sheet injector gates on a selector this sheet does
not carry and falls through. The classes feature's pending-choice hook still
wires the *Choose* rows, which carry the item id it looks for, and its class
drop still opens the picker.

## Re-rendering

The sheet re-renders on the actor's own changes as any document sheet does.
It also watches the actors it shows off other documents — hirelings, storage
providers — and the formation feature's light and role hooks, and re-renders
debounced.

## The magic tone

The design's violet has no token in the vendored design system, so the
stylesheet mixes it from the spot colour and the ink (`--acks-extras-magic`
on the sheet root) and it follows both seats. A published token would replace
the mix in one place.
