# Places, storage and markets

A **place** is anything that holds things: a duchy, a town, an inn, its cellar,
and the chest in the cellar. They nest, they hold goods and living things, and
some of them have a recruitment market. One actor type covers all of it.

![](../releases/v4.0.0/location-sheet.png)

*A place that holds goods, and who is recorded there.*

## Make a place

Actors sidebar → **Create Actor** → type **Location**.

A new place opens on the **Contents** tab with nothing but a name. That is the
whole of the minimum: identity, and what it sits inside.

- **Parent** — the place this one is in. Set it and a breadcrumb appears
  (Duchy of Aura › Rusty Anchor › cellar).
- **Stack count** — for eight identical warehouse bays, keep one actor and set
  the count to 8. Split one off when it becomes interesting.
- **Roster** — the living things kept here: a garrison, a stabled horse, a
  captive. These are references to real actors, so a deleted actor leaves a
  struck-through row rather than vanishing.

A place also keeps a private record beside its shared one, which only the Judge
can read.

![](../releases/v4.1.0/location-judge-notes.png)

*A place's private record, beside the shared one and readable only by the
Judge.*

If the place is a map you already have, link it: **Scene config → Location**, or
right-click the scene in the sidebar. The link is never made automatically —
most scenes are battle maps and lighting tests, and forty auto-created actors on
first load is not a favour.

## Store goods there

Drag an item onto the sheet's **Storage** tab, or use **Deposit here**.

**Drag it from a character's sheet, not from the Items sidebar.** Goods are
filed under whose they are, and an item in the sidebar or a compendium belongs
to nobody yet — there is no owner to file it under, so that drop is refused with
a notice rather than landing unattributed. To put a hoard into play, give it to
a character first (or to the party's pack mule) and stow it from there.

Goods are grouped by **whose they are**, because a warehouse holding three
characters' gear is three inventories in one actor, not a shared pile. Each
character sees a **Retrieve** button on their own rows; the GM sees it on all of
them.

![](../releases/v4.0.0/location-storage-manager.png)

*Moving goods in and out of a place that holds them, and giving a character a
vault.*

One of those piles is **the house** — what the place itself owns rather than
what somebody left there. The Judge can lock a row so it cannot be taken, and a
spoil that has not been valued yet sits there awaiting its throw.

![](../releases/v4.0.0/location-house-pile.png)

*A location's own coin and stock: the Judge's locks, and a spoil awaiting its
throw.*

Stored goods are real items on the location actor, so an item that has left a
character genuinely stops weighing on them. Stowing is a **move, not a copy**:
the item leaves the character. Dragging between two ordinary character sheets is
the system's own copy, which is why a plain "treasure actor" leaves the original
behind — a place is the surface built to hand goods over without duplicating
them.

> Attribution is a UI convention, not a security boundary. Anything that must
> genuinely stay private belongs on a GM-owned actor.

**Deleting a place returns its goods by default** — each owner gets a container
named after the place. The GM setting `storageDeletePolicy` can change that to
"lose", for the campaign where a sacked city takes your warehouse with it.

Coin stows like anything else you carry: drag a coin row onto a place or into a
pouch, or pick it in **Deposit here**. Coin kept in the old **bank** column is
not carried, so it cannot be stowed from there — it is swept into a vault first.

## Give a character a vault

A vault is a place of one character's own: only they and their players can reach
it. You are given one automatically the first time a banked balance is swept out
of the retired bank column.

That sweep only visits a character who still has a balance to move, so a vault
that is **deleted does not come back on its own** — by then there is nothing left
to sweep. **Settings → Storage Manager → Give a character a vault** makes one on
demand.

This is not the same as **Let an actor hold goods**, which makes a *shared*
place — a wagon, a stronghold, an inn — that anyone with access can reach.

## Add a market

Most places have no market. **GM Settings → Add market** creates one, and four
extra tabs appear.

Removing a market removes the data with it, not just the tabs.

## Common problems

**The market tabs aren't there.** The place has no market. Add one from GM
Settings — they are opt-in per place.

**A roster row is struck through.** Its actor was deleted. The row stays so you
can act on it; remove it when you have.

**The breadcrumb stops short.** A parent points at a place you cannot see, or
one in an unloaded compendium. The chain renders as far as it resolves.

**Retrieve isn't offered.** The goods are attributed to a character you do not
own. A GM can reassign attribution in the **Storage Manager** (Settings →
Storage Manager).

**"Nothing was moved."** The stack you picked is empty. Coin sitting in the old
bank column is not carried, so it cannot be stowed from there — it is swept into
a vault at the next world load, and stows from the vault.

**My character has no vault any more.** Deleting one does not regenerate it. A GM
makes a new one with **Storage Manager → Give a character a vault**.

**My character has become a warehouse.** Something turned storage on for them —
most likely the **Enable Storage Here** macro run with their token selected. Open
**Storage Manager**, pick them in the list, and use **Stop holding goods**; the
Disable Storage Here macro does the same for a selected token. If anything is
stored on them, return it to its owners first — the button is on that same
screen. Clearing the flag moves nothing, so goods left behind would sit on an
actor that no longer appears as a place to anyone.

A character can no longer be made a place by accident: the macro refuses one and
points at **Give a character a vault**, which is the thing you almost certainly
wanted. A place is somewhere goods are left; a character is who leaves them.
