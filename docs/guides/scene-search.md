# Searching a scene

When the party stops to search a room or a battlefield, the scene search puts
everything there is to look at on one screen. The Judge and the players assign
characters to check each thing, the party's own clock pays for the time, and
what a check finds comes out of the treasure the Judge rolled when the scene
opened. Searching is described in RR ch. 6, Searching.

## Open a scene

Two buttons open a scene. Both are the Judge's:

- **Search the scene**, on the card a fight posts in the Chat sidebar when it
  ends with fallen foes who carried something.
- **Search here**, on the party sheet's Dungeon tab, in the Turn plan section.
  A player whose character is in the party sees it too. A player's press tells
  the table the party wants to search and moves nothing; the Judge then presses.

The scene opens at the place the party's token stands in, the nearest one when
areas overlap. A party with no token on the map, or standing in no place, is
told so and nothing opens. The treasure is rolled as the scene opens and dealt
face down, so nothing is found yet.

**A card opens one scene.** Once that scene has ended, the Judge's press on the
same card reopens it: same place, same treasure, and whatever was found stays
found. A player's press on a spent card is refused.

## The screen

The screen opens as **The scene**, one window per party.

- **The header** names the place and whose seat this is. The Judge's seat says
  whether the table has been shown the scene, and has **Show the scene**, which
  also opens the screen for every player who owns a character in the party.
  Until then a player's screen reads "The Judge has not shown the scene yet."
- **The bar** counts the items found and the places still untouched, says what
  the next Round and the next Turn would resolve, shows the party's turn count,
  and holds the two presses, **Round** and **Spend a turn**.
- **What is here** has one card per thing at the place: its kind and state, what
  its checks found, and a rail for each check, *Checked hastily* and *Checked
  methodically*. The Judge also sees a Hidden tag, the lots waiting, and what a
  hidden thing hides behind. A player sees only what the Judge has shown.
- **The party** shows where each member is assigned, and **What turned up** is
  the log, newest first.
- **The haul** has one tile per item, a dashed tile for each item nobody has
  found yet (Judge only), and **Open the pot**.

## Assign and resolve

Press **+ Assign** on a check's rail and pick a member, or drag a member's tile
from The party onto a rail (that check) or onto a card (the first check the
member can make). A member who cannot make a check is listed with the reason.
A player assigns their own characters.

- **Round** resolves every hasty check assigned, a round each, at once.
- **Spend a turn** spends one turn on the party's clock. A methodical check
  resolves when its last turn is spent, and its rail shows a bar until then.

On a player's seat both presses ask the Judge. The table is told, and the clock
does not move until the Judge presses.

Each member throws for themself. The Judges get a whispered card with the
throw, and the log notes it on the Judge's screen. The table sees *Found
something*, *Found nothing*, or a line saying there may be something more here.
After a failed hasty check, the member is struck from that thing's hasty rail.
Hover the struck chip for the page.

## A fallen body's sheet

Every fallen body has a **Sheet** button, on the Judge's seat only:

- on the fight's card, a book icon after each fallen name;
- on the screen, on the body's name plate.

Either one opens the sheet of that body itself: for an unlinked token, the
token's own copy, hit points and all, never the actor in the sidebar it was
made from. Once the body's token and actor are gone the button is greyed out,
and its tooltip says why. Nothing is harvested from a body yet. Its sheet is
where to look.

## Key a place

Open the place's sheet (Actors sidebar → the place), then its **Things here**
tab, which only a Judge sees. Each row is one thing at the place, with a summary
of both its checks. Click a row to open its keying fields. The same fields are
on the scene screen's left side for the card selected there.

To add a thing, drag a trap, an obstacle or a condition onto the tab, from the
**ACKS Extras Hazards** compendium (Compendium Packs sidebar) or from your
Items. Any other item dropped there goes to the place's goods as before.

| Field | What it sets |
|---|---|
| Hidden from the table | Players do not see the thing until it is shown. |
| Behind (a clue that shows it) | Another thing's check whose find shows this one. |
| Something more | An optional line the table reads after a check. Blank uses the generic words. |
| Check | No throw, the party's hasty or methodical search, or a proficiency. |
| Proficiency | Which proficiency's throw the check makes (see Lore checks). |
| Others may look hastily | Whether anyone in the party may make the hasty check. |
| Yields | The clue the table reads when the check is found. The items the scene dealt here are listed below it. |
| Tools | Drop an item that a methodical check needs. |
| Turns | How many turns the methodical check takes. Blank stores nothing. |
| Show to the table | Shows the thing now. |
| Remove | Takes the thing off the place. |

**Crossing**, for an obstacle only, holds the figures and picks the party
sheet's crossing reads for this place:

- a climb takes its length and depth;
- a jump takes its gap and depth;
- a squeeze takes its shape and length;
- a swim takes its water penalty.

The penalty list is built from the steps your world imported, with *None* and
*Larger…*, and **Larger penalty** opens only for *Larger…*. *Not set*, or a
blank figure, removes the value, so the crossing's own default stands. Each
field's tooltip names the page the figure comes from.

A keyed place survives the world-start clean-up of empty places
([Places and storage](location.md#make-a-place)).

## Lore checks

Set a check to **Proficiency…** and choose the proficiency: Theology,
Naturalism, Magical Engineering or Loremastery, or another your world holds.
The member throws their own imported throw for it, at their level, and only the
Judges see the figure.

- A member who does not have the proficiency gets the vague hint at a hasty
  check. At a methodical check they cannot be assigned.
- A member who has it, but whose throw was never imported, cannot be assigned
  either. The picker's tooltip names the page their ability cites. Import the
  book to fill it.
- A proficiency whose page prints no throw is made, not rolled.

## Common problems

- **Search the scene does nothing but warn.** The party's token is not on the
  map, or not inside a place's area. Put the token in the room, or give the
  room a place.
- **A player's screen is empty.** The Judge has not pressed Show the scene.
- **A player's Round does nothing.** It asked the Judge. Only the Judge's
  press resolves.
- **The Things here tab is missing.** It is a Judge's tab. A player's sheet
  has none.
- **The From the map list is empty.** Doors and old-style trap zones are not
  read from the map yet. Key them as things.
