# acks-lib — not built

## ~~An open editor takes the full width, everywhere~~ — SHIPPED

The follower card now does this: while its notes `<prose-mirror>` is open, the
right-hand stack spans the card's whole grid instead of sitting in a ~177px
column, because ProseMirror's toolbar wants roughly 870px and a clipping panel
hid every control. The rule is local to `.acks-lib-follower-card`.

It should be a property of the family's UI rather than of one card. Every place
this module opens a rich-text editor inside a multi-column layout has the same
arithmetic against it, and the same fix — editing is a mode, not a column.

DONE: `styles/lib.css` now owns it for every acks surface, keyed on core's own
`prose-mirror[open]`, so a container holding an open editor spans its whole row
and the toolbar wraps rather than clipping.

## ~~Audit the rest of the card against the sheet theme's field rule~~ — SWEPT

The override highlight is fixed, but the fault it exposed is general. The sheet
theme dresses every field on an ACKS window at (0,4,2):

    body.acks-lib-sheet-theme .acks .window-content input:not([type="checkbox"])

Any card rule that colours an input while leading with `.acks-lib-follower-card`
tops out at (0,4,1) and loses — silently, and only for the properties the theme
also sets, so the rest of the rule lands and the loss reads as "that rule does
nothing" rather than as a conflict. `background` and `border` are set there too
and are equally reachable.

SWEPT: every input-colouring rule across `styles/` was measured against the
theme's (0,4,2). The follower card's field rules were the real losers and are
restated under `body.acks-lib-sheet-theme`, which outweighs it. The remaining
low-specificity hits colour `select`, which the theme's input rule does not
claim, so they were never in the fight.

The group and template sheets are CLEAN, and structurally so rather than by
luck: the theme's field rule needs `.acks` on the application, and those two
carry `acks-ui acks-extras` only, so it never reaches their fields. `lib.css`
also declares no `input` rule at all — its one field-adjacent selector,
`.acks-lib-template-sheet .axis-row select`, sets `flex` and picks a element
the theme's `input` rule cannot match. **A surface is exposed to this rule
exactly when it carries `acks`**, which is the cheap test for the next audit.

## Who carries `acks`, and whether that is deliberate

Five surfaces do — the two item sheets (abilities, equipment), the roll editor,
the door app and the follower card — against roughly forty that carry
`acks-ui acks-extras` alone. So the sheet theme dresses core's windows and
those five; everywhere else the fields take Foundry's default chrome inside an
ACKS-dressed frame.

Whether that split is intended has never been ruled. It is not a defect to fix
blind: adding `acks` to a window opts it into every core `.acks` rule at once,
not just the field dressing, so the answer needs a live read of what each
surface would inherit.

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
