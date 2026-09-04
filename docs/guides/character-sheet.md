# The character sheet

Every character opens on the module's own sheet: the band across the window
header, the portrait between two rails, and tabs organised by what you do at
the table rather than by document type. The system's sheet is still there —
Sheet Config, on any actor, switches back — and nothing is migrated: the two
read and write the same fields.

![](../releases/v6.4.0/character-sheet.png)

*Rolls: every throw on the sheet with its target, the wielded weapon ringed,
and a pin on each row for the folded card.*

## The band and the rails

The header carries the class glyph, the level title, the name and the XP
bar. The bar goes gold when the threshold is reached and reads *Level up*;
the Class tab goes gold with it and carries the wizard.

Down the left of the portrait: Influence, then the five saves. A save cell
shows its glyph; the target is in its tooltip and on Rolls. A condition that
a save clears rides on that cell — its image, its clock, the save's glyph in
the corner — and a modifier in force on the save colours it with the number.
Clicking rolls the save.

Down the right: hit points inside the heart with the fill as the fraction
(red at zero, where a click opens Mortal Wounds); armour class inside the
shield, the shirt or a dashed box, cycling with the shield, without it and
unarmoured on click; movement for the mode you are in, amber or red when the
load slows you, with a menu of the six modes; the grip, two hands open or
clenched, joined on one haft for a two-handed weapon, with the cleave count
beside them and a menu to draw, sheathe or change grip; what you see by —
a burning source with its reach and burn-down, daylight, a dark sense, or
the dark at 0′ — with a menu to light, douse, shutter or ready a torch; and
the party: how many of the character's henchmen are on the scene, with an
asterisk for each summon present (`1**` is one henchman and two summons),
red while a henchman is down with a calamity pending. Click it for who is
here — a pick selects the token — and, as the owner, to bind the tokens you
have selected as this character's summons or release them. When the
character marches in a formation that is on the scene, the cell is the
formation and opens the party sheet.

The far-right rail is sheet tools only: description, portrait, the alignment
and age and fate tags, ownership, source, Tweaks.

## Folding

The chevron before the tab strip folds the sheet to the table card: the
band, the portrait, the rails and, along the bottom, the starred rolls,
timers and counts. The fold is remembered per user, so an observer can fold
a sheet they cannot edit.

![](../releases/v6.4.0/character-sheet-folded.png)

## Equipment

![](../releases/v6.4.0/character-sheet-equipment.png)

The Load header's underline is the encumbrance bar with the breakpoints as
ticks. Every wear slot lists on the left, head to foot then off-body, and is
a drop target; a worn container shows its capacity bar and its contents. Loose
gear files on the right by kind, containers you carry rather than wear sit
under Stowed, and every place holding your goods lists under Kept elsewhere.
Drop a thing on a place to wear or draw it, on a container to store it, on
the right column to take it off or out.

## Stats

![](../releases/v6.5.0/character-sheet-stats.png)

What is not a throw: the attributes, the training, movement by mode, vision
light by light, the vitals, and the throw targets that Rolls reads.

**Training** is where a character's combat training is read and edited. Every
fighting style, every weapon in the game as its own pill, every armour rung
and the shield; lit when trained, gold when specialised or focused. The view
button regroups the weapons — by category, by size, or as one flat list — and
each group's header is captioned with the kind of choice it is (broad, narrow,
unrestricted). Hover a pill to see where the training came from when it was
not the class: an ability, another effect, the sheet's own profile.

An owner presses **Edit** to arm the pills: click a weapon, a whole group's
toggle, a style, an armour rung (it sets the ceiling; clicking the ceiling
clears it) or the shield (which is the Weapon & Shield style). A pill that
another source lit refuses the click and names the source. A pill moved off
what the class prints wears a dot, and **Reset to class** puts the printed
training back. A character with no class gets a *Training, by hand* effect on
the first edit; applying a class later replaces it.

## Class, Magic, Followers, Notes, Effects

![](../releases/v6.4.0/character-sheet-class.png)

Class shows the bound class document, the XP pair, and — while the bar is
full — what the next level changes, grants and asks, with the Level up button.
Magic appears for a caster, with the casting pools and the repertoire. Followers
renders the hirelings as Follower Cards beside the Roster chip. Notes holds the
notes and the relationships on record.

![](../releases/v6.5.0/character-sheet-effects.png)

Effects is where the timers live — what is burning, what is blessing you, what
is riding on a save — with the counts a player checks between fights (rations,
oil, torches, fate points, a caster's pools) and the modifiers in force. A
star on any row keeps it on the folded card.
