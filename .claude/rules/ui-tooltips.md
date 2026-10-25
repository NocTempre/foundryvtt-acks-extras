# Tooltips: a figure says where it came from (canonical)

Tooltips are liberal by default. **Every figure a user reads carries one** —
a stat, a throw target, a modifier, a price, a count, a rate — and so does
every control, chip or badge whose face does not name it in full: a glyph, an
abbreviation, a label cut short. A figure a change adds or alters carries
one in that change; the surfaces built before this rule are retrofitted one
at a time, from the repo's `docs/ROADMAP.md`. A figure without one is
unfinished work.

## What a figure's tooltip says

Where the number came from, never what the rule says. Four shapes, each
already in acks-extras:

- **Read from an imported table**: the row, and the page the importer read
  it from, taken at render (`lib/tables.mjs` `citeOf`).
- **Computed by the module**: its parts, each named, with the actor's own
  numbers, and the page that prints the procedure.
  `ACKS-CLASSES.zero.limit` is the pattern ("Limit {limit}: {levelPicks}
  from level, {intBonus} from Intellect … (RR ch. 3)"); a list of sources
  joined by " · " (`classes/training.mjs` `trainingProvenance`) is the short
  form.
- **Set by a hand or an effect**: which, and the figure it stands in for
  (the character sheet's `is-overridden` mark, `stats.effectiveTip`).
- **With nothing behind it**: that it is not imported, and no number in its
  place.

The names of the parts and how they combine are the procedure, and ship; the
numbers interpolate from the world at render. A tooltip is held to
`ip-doctrine.md` like any other string: no rule sentence, no printed value in
`lang/`. Text the importer materialized from the Judge's own copy may appear
in one at runtime.

## A tooltip that cannot be written is a finding

The tooltip is the doctrine's audit trail, on the surface: a reader holding
the book hovers the figure, opens the page it names, and finds there the
parts it lists. When it cannot be written that way the figure is suspect, and
that is the result to report, not a gap to word around:

- no page to point at — `citeOf` null where a table should have been
  imported;
- a part the cited page does not print, or a page that prints none of them;
- parts that do not produce the figure beside them;
- a figure that reaches the screen from a constant in source instead of a
  table or the actor — the value rule's case in `ip-doctrine.md`.

Register each on the bug-intake ledger (`acks-bug-triage`, source
`tooltip:<YYYY-MM-DD>`) and write the tooltip with what is true: "not
imported", or the parts that do exist. **Never make a tooltip match by
bringing the page's words to it.** The match is the reader's, made with the
book open. A tooltip that paraphrases the page until the two agree is the
leak the doctrine exists to stop, and it hides the discrepancy the tooltip
was there to show.

## Mechanics (core 14)

- Core's tooltip manager, never a `title` attribute: a `title` is the
  browser's own box, outside the theme and the manager's timing, and is read
  to assistive technology as a description.
- `data-tooltip` localizes a bare lang key and renders anything else as
  cleaned HTML. A tooltip assembled at render — a name, an imported row, a
  joined list — goes in `data-tooltip-text`, which core writes as text.
- The manager opens on `pointerenter` only: no keyboard focus, no touch. A
  tooltip adds and never holds the only copy. A control's name is its
  `aria-label` (an empty `data-tooltip` shows that label as the tooltip, so
  one string serves both), and whatever a user needs in order to act — a
  refusal's reason, the figure in force — is also visible on the surface.
- Every string is a lang key under the module's roots.

## Enforcement

No gate can tell a figure from a caption, or a provenance from a paraphrase;
both need a reviewer, every time. The hygiene sweep carries the category
(`missing-provenance-tooltip`, lens `tooltips`), and the live pass over a
touched window hovers its figures against the pages they name.
