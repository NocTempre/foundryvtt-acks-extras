# acks-lib — not built

## An open editor takes the full width, everywhere

The follower card now does this: while its notes `<prose-mirror>` is open, the
right-hand stack spans the card's whole grid instead of sitting in a ~177px
column, because ProseMirror's toolbar wants roughly 870px and a clipping panel
hid every control. The rule is local to `.acks-lib-follower-card`.

It should be a property of the family's UI rather than of one card. Every place
this module opens a rich-text editor inside a multi-column layout has the same
arithmetic against it, and the same fix — editing is a mode, not a column.

What that needs: an agreed signal (core marks the element `[open]` and
`.active`), one rule that owns the behaviour for every acks surface, and an
audit of the sheets that embed an editor in a narrow column — the group and
template sheets first.

## Audit the rest of the card against the sheet theme's field rule

The override highlight is fixed, but the fault it exposed is general. The sheet
theme dresses every field on an ACKS window at (0,4,2):

    body.acks-lib-sheet-theme .acks .window-content input:not([type="checkbox"])

Any card rule that colours an input while leading with `.acks-lib-follower-card`
tops out at (0,4,1) and loses — silently, and only for the properties the theme
also sets, so the rest of the rule lands and the loss reads as "that rule does
nothing" rather than as a conflict. `background` and `border` are set there too
and are equally reachable.

Worth a sweep of every input-colouring rule in this module, and of the group and
template sheets, which sit under the same theme.

## Night Vision reaches through walls

`brightestLightReaching` measures straight-line distance from every lit source to
the token, so a torch on the far side of a closed door counts as reaching it. A
night-eyed creature therefore sees twice a light it could not actually see by.

Resolving it needs real occlusion — `CONFIG.Canvas.polygonBackends.sight`, or a
`ClockwiseSweepPolygon` per candidate source — and that needs the live canvas.
The pass has to answer for every scene in the world, including the ones nobody
has open, so it cannot depend on one being drawn.

What that needs: a split between the sweep (geometry only, every scene) and the
active scene (which may test line of sight), plus a decision about which answer a
token on an undrawn scene should carry in the meantime.
