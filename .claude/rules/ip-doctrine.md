# IP doctrine: structure ships, content is imported (canonical)

No `ruledata/`, no rules WORDS, no page VALUES in any shipped artifact. The
line is **structure vs content**, and it is finer than it looks:

- **The procedure ships.** Which modifiers exist, when each applies, how they
  combine, what a failure costs, what order things resolve in. That a crowbar
  helps force a door and that its help is additive is the rule being
  performed, and it belongs in the function performing it.
- **The values do not.** A modifier's size, a botch band's edge, a rate, a
  price, a ladder rung — every number read off a page is content, however
  small and however alone. They arrive through `acks-importer` from the GM's
  own copy and are **passed in**. `formation/jumping.mjs` is the pattern: it
  knows a proficiency raises the score and that the landing is a Paralysis
  save, and it takes `dexCap` and `saveBonus` as arguments because what
  Acrobatics is *worth* is printed, not structural.
- **A table of options a reader picks from** — tiers, variants, qualities —
  is content whatever it is made of, and is registered rather than shipped.
  `lib/tables.mjs` has said "no book values, no fallback samples" since the
  extraction program; a frozen table in a `config.mjs` is that rule broken
  somewhere the gate was not looking.
- **The book's sentences never ship.** A user-visible string that states,
  explains or paraphrases a rule is its expression, and a page citation is a
  pointer into it. A hint says what the FIELD does ("In feet."), never what
  the rule says ("A pit deals 1d6 per 10 feet fallen"). Citations belong in
  code comments and `docs/` — attribution, not reproduction — and never in
  `lang/`, a template, or a pack source.

`ip-scan.mjs` hard-FAILS on a tracked `ruledata/` directory and on a page
citation in shipped text; **the value rule still needs a reviewer** — no gate
can tell a structural constant from a printed one. Book content reaches a
world through `acks-importer`, materialized from the GM's own books.

This doctrine is deliberately stricter than the licence requires — the margin
is the point. The ruling and its history live in
`acks-module-template/docs/DECISIONS.md`.
