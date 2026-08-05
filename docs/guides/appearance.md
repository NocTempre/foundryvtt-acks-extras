# Appearance

Every window this module opens — and every window the ACKS system opens — is
drawn from one palette: the burgundy spot colour and warm black the books are
printed in, on parchment or on tooled leather depending on your seat.

![](../releases/v2.0.0/character-sheet-dark.png)

*The system's own character sheet on a dark seat, wearing the ACKS frame.*

## Pick a colour scheme

**Configure Settings → Module Settings → Extras → ACKS colour scheme.** Per
player; it changes nothing for anyone else at the table.

| Setting | What it does |
|---|---|
| **Follow Foundry** (default) | Matches whatever colour scheme the rest of your client uses |
| **Always light** | Parchment, whatever Foundry is set to |
| **Always dark** | Tooled leather, whatever Foundry is set to |

Follow Foundry genuinely follows. Foundry lets you theme application windows
separately from the rest of the interface (**Configure Settings → Core → Colour
Scheme**), and the ACKS palette tracks whichever of those applies to the window
you are looking at.

One combination is imperfect: with the interface set **dark** and application
windows set **light**, ACKS surfaces stay dark inside those windows. Set ACKS
colour scheme to **Always light** and it resolves.

## Change the text size

**ACKS font size** sets the base size, in pixels, for every ACKS surface —
follower cards, module windows, and the system's sheets. One knob rescales the
whole family; Foundry's own UI scale applies on top of it.

## What happened to the character-sheet theme

There used to be a **Character-sheet theme** toggle. It is gone, and what it
switched on is now simply how the module looks.

Turning it off never returned you to a neutral Foundry — it left this module's
windows in the ACKS look and the system's in Foundry's default one, which is the
split this release exists to close. It could not be made safe in the off position
either: the ACKS system publishes no dark palette of its own, so with the theme
off a dark seat put the module's panels on a page drawn for a light one.

If what you wanted was a lighter or darker look, **ACKS colour scheme** above is
the knob that was actually being reached for.

## Colour is never the only signal

No distinction in this module is carried by hue alone. A lit lamp and an unlit
one differ by the weight of the glyph, not its colour; a magical light and a
mundane one are different marks. That is partly the books' own discipline — they
are printed in one spot colour and a black — and partly so the interface still
reads on a colourblind seat, in greyscale, or printed.
