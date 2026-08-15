# Vehicles

Carts, wagons, chariots, palanquins, galleys and ships are actors, like
characters. Make one from the Actors tab: **Create Actor → Vehicle**.

Screenshots for each section are indexed in [GALLERY.md](../GALLERY.md).

## Setting one up

A vehicle holds what its book prints and derives everything else. Fill in the
**cargo capacity in stone**, the **crew** it wants, the **team** it is built for
(land) or its **oar and sail speeds** (sea), and its **AC and structural hit
points** if it is a vessel. Nothing you type says what is aboard — that comes
from what you actually put aboard.

Pick **Land** or **Sea** first. It decides which sections you get: a wagon is
pulled and driven, a ship is crewed, and offering either the other's controls
would teach you the wrong model.

## Loading it

Drag a character, an animal or an item onto the hold. A dropped character is
asked what they are: a **passenger**, a **crew member**, or (for an animal) part
of the **team**. That choice matters:

- a **passenger** weighs against the hold and travels at the vehicle's pace;
- **crew** and **draft animals** do not weigh against cargo at all;
- on a **land vehicle**, passengers and cargo come out of one pool — a cart has
  a bed, not cabins. On a **vessel** they are separate: she can be full of
  people and still have a hold to fill.

**Board for best pace** loads everyone the vehicle would carry faster than their
own legs, slowest first, and stops when the hold is full. **Re-board as before**
puts everyone back where the last change found them, which is what you want at a
ford.

## Making it move

The sheet always shows the speed the vehicle *actually* makes, with a list of
what reduced it — short crew, a heavy load, a hungry crew, a stowed mast, the
wind, the ground. Change the **wind** or the **terrain** selector to see the
answer change; those are your view of the moment, not properties of the vehicle.

A wagon on ground that wheels cannot enter without a road is **stopped**, not
slow, and says so.

## A ship's day is not a party's day

A vessel is worked **twelve hours**; a marching party walks **eight**. So a ship
that shows 90 miles a day and a party that shows 24 are not two numbers you can
compare — the sheet prints the **miles per hour** beside the day for exactly
that reason. Compare those.

Under sail, in open water, with a navigator and a full crew, a ship may work
around the clock: **twice the distance in a day, at the same speed**.

## Damage, and what it costs

Most things cannot hurt a hull. A man-sized or large creature swinging at a
warship does **nothing** — hull damage is artillery's business and the business
of things far bigger than a person. Light and medium ballistae reach a tenth of
the way; heavy ballistae and the lighter catapults a third; siege artillery and
the truly enormous all of it.

Damage **slows her**, in proportion to the hull she has lost. So do casualties,
in proportion to the hands missing — but the two are **not added together**.
Whichever is worse governs, and the sheet names which one, so you do not patch a
hull to fix a speed the missing rowers were costing.

At nothing left she cannot move under her own power and goes down in 1d10
rounds.

**Repairs** are hand work: five of the crew, one turn, one point, doing nothing
else meanwhile. Only **half** of what she took at sea can be put back before she
reaches a dock, so a long voyage accumulates damage no amount of crew-turns will
clear. The sheet works that out for the hands you actually have aboard.

## Getting lost, and getting holed

Two different questions, with two different people answering them.

The **navigator** keeps her on course: a throw at the start of each day *and*
each night — a river is nearly unmissable, the open sea is not. Someone aboard
with Pathfinding or Navigation is worth +4, and both together +8.

The **captain** keeps her off the rocks: on entering water that holds a hazard,
a Seafaring throw, easier for a master mariner. **Slowing down helps twice** —
it makes the throw easier *and* halves the damage if she strikes anyway. Kelp
holds her until she is cut free; rock, reef and wreck hole her; a shoal grounds
her until the tide lifts her or the crew throws enough cargo over the side.

These are derived and published for macros, but nothing rolls them for you yet
— see [the roadmap](../vehicles/ROADMAP.md).
