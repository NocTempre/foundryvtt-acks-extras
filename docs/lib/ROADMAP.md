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

## Sweep the legacy `--color-*` reads out of styles/classes.css

`styles/classes.css` carries nine reads of Foundry's **legacy** `--color-*`
names, each with a hex fallback:

    :41  --color-shadow-primary        :145 --color-border-light-primary
    :114 --color-border-light-primary  :169 --color-border-highlight
    :120 --color-border-light-tertiary :175 --color-border-highlight
    :134 --color-level-success         :201 --color-border-light-2
                                       :225 --color-level-warning

That set is the v10-era one Foundry v14 declares once with no theme scoping, so
the names are light-theme constants — which is exactly what the 2026-08-01 token
sweep removed everywhere else, and what MODEL.md's theming section otherwise
claims is true of all of `styles/`.

**They are invisible today, and that is the trap.** `vendor/acks-design/foundry.css`
re-points five of these same names at ACKS tokens inside `.acks-ui` /
`.acks-palette`, so on a book-style seat they resolve to the right value by
accident. Under the `core` look those classes come off and the reads fall
through to Foundry's own light-theme constants — or, where v14 has dropped the
name entirely, to the hex fallback, which is the failure mode the sweep called
out: a fallback masks a missing token instead of revealing it.

What this needs: map each read to the token that carries the same role
(`--color-border-light-primary` → `--acks-rule-color`, `--color-border-light-tertiary`
→ `--acks-neutral-2`, `--color-border-highlight` → `--acks-spot` as INK and
`--acks-burgundy` as SURFACE at :175, and a decision on the two `--color-level-*`
reads, which have no ACKS equivalent and may want `--acks-success` /
`--acks-warning`). Drop every hex fallback in the same pass.

Deliberately not done during the 3.6.2 `look` work: five of the nine are masked
today, so changing them moves existing book-style seats, and that belongs in a
change whose subject is the sweep rather than one whose subject is the opt-out.
Worth pairing with a `tools/validate.mjs` check so the doctrine stops relying on
a doc claim nothing enforces.

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
