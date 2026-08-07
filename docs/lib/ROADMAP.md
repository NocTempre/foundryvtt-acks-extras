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

## The override highlight never reaches an input

`.overridden` is meant to print a card-only override in the spot colour. On an
`<input>` only the `font-weight: 600` half lands: the colour loses the cascade
to a core rule, so AC, the adventuring skills and the vitals all show an
override in ordinary ink. The read-only spans and the attack rows are unaffected
— they are not inputs.

Confirmed live 2026-08-07 on a monster card: `--acks-spot` resolves correctly on
the element and the selector matches (the weight proves it), so this is a
specificity loss, not a token or markup fault. The competing declaration is not
in this module's CSS or in the vendored design sheet.
