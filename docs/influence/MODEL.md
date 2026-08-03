# Influence & reactions — Design Model

How this feature applies the family doctrine **reuse → extend → enhance →
invent**.

- **Reuse**: the core `acks` actor's alignment, level and proficiency data; the
  system's own Active Effect machinery.
- **Extend**: an `attitude` Item sub-type recording how one party regards
  another, and effect conventions under `flags["acks-extras"]` —
  `reaction` / `loyalty` / `morale` change keys plus their
  `situational` / `tone` / `label` metadata.
- **Enhance**: the Influence application — one dialog that resolves a social
  roll with its whole modifier stack itemized and every situational modifier
  offered as a toggle.
- **Invent**: nothing the system provides.

## The modifier stack

Every modifier resolves from one of three sources:

- **auto** — computed from the two actors (alignment relationship, level gap,
  age, proficiencies). A source whose input is unknown returns nothing and is
  skipped, rather than being counted as zero.
- **effect** — contributed by an Active Effect whose change key is exactly a
  member of this feature's domain set. Membership is tested exactly, not by
  prefix, because sibling features share the flag scope.
- **manual** — set by the roller.

`ctx:<key>` sources read the caller's own context bag, which is the seam an
external mode resolves against.

**An ability counts once per page.** One proficiency can reach the roller by
every route at once: its name fills a static `prof:` row, an Active Effect on it
speaks, and its abilities-model effects speak. So each page settles which source
speaks for an item — a static proficiency row wins over that item's effects, and
an Active Effect wins over the same item's abilities model. The claim is made
per page, because which proficiencies a page renders a row for differs by page;
an ability the page offers nowhere else keeps its own row.

A power standing in for a proficiency (`actsAs`) fills that same row, renames it
after itself, and is claimed with it. The rename lives in the config rather than
the view, so the dialog and the chat card name it identically; a character
holding both the power and the proficiency keeps the proficiency's name, because
the two are one non-stacking capability.

## Recipes, not rules

The dialog **offers** modifiers; it does not assert them. Situational modifiers
render as toggles so the table decides what is in play, and a mechanic that has
not been read against the printed page is badged **unaudited** — amber rather
than red, because it is probably right and is genuinely offered; it is simply not
the book's ruling until somebody has checked it.

## Shared with hiring

The reaction convention is consumed by the henchmen feature's hiring throws, so
an effect that grants a reaction bonus is written once and works in both places.
This is why influence imports before henchmen in `scripts/module.mjs`.
