# IP doctrine: structure ships, content is imported (canonical)

Three rules, and the third is not a grudging exception to the first two:
**no rules WORDS ship, no page VALUES ship, and a REFERENCE to the page does.**
No `ruledata/` in any shipped artifact. The line is **structure vs content**,
and it is finer than it looks:

- **The procedure ships.** Which modifiers exist, when each applies, how they
  combine, what a failure costs, what order things resolve in. That a crowbar
  helps force a door and that its help is additive is the rule being
  performed, and it belongs in the function performing it.
- **The values do not.** A modifier's size, a botch band's edge, a rate, a
  price, a ladder rung — every number read off a page is content, however
  small and however alone. They arrive through the importer (acks-extras'
  `scripts/importer/`) from the GM's own copy and are **passed in**.
  `formation/jumping.mjs` is the pattern: it knows a proficiency raises the
  score and that the landing is a Paralysis save, and it takes `dexCap` and
  `saveBonus` as arguments because what Acrobatics is *worth* is printed, not
  structural.
- **A table of options a reader picks from** — tiers, variants, qualities —
  is content whatever it is made of, and is registered rather than shipped.
  `lib/tables.mjs` has said "no book values, no fallback samples" since the
  extraction program; a frozen table in a `config.mjs` is that rule broken
  somewhere the gate was not looking.
- **The book's sentences never ship.** A user-visible string that states,
  explains or paraphrases a rule is its expression. A hint says what the FIELD
  does ("In feet."), never what the rule says ("A pit deals 1d6 per 10 feet
  fallen").
- **The page reference ships — everywhere, and deliberately.** A citation
  reproduces nothing. It is a pointer that only pays out to a reader who
  already holds the book, so unlike a copied sentence or a copied number it
  can never stand in for the purchase; it sends people toward the book rather
  than around it. It is also the module's audit trail: a Judge can check what
  the module applies against the page that says it, and a later session can
  tell a structural constant from a printed one by following the pointer.
  Cite in `lang/`, in a template, in a pack source, in a comment, in `docs/`.

## What a citation does not do

**It does not launder the sentence beside it.** Strip the prose and the
numbers; keep the reference. Three shapes, one right:

| | |
|---|---|
| `"Search fee (RR 162)"` | **Right.** Names the field, points at the rule. |
| `"Search fee: 25gp per week (RR 162)"` | A printed value with a footnote. The number has to go. |
| `"Rolled weekly per hireling type searched"` | Unattributed derivative text — **the worst of the three.** |

The third shape is the one to watch for, because it is what "remove the
citation" produces when applied to a hint that was paraphrasing. Deleting the
pointer never deletes the paraphrase; it only hides where the paraphrase came
from. When a string is wrong, the fix is to rewrite what it *says* and leave
the reference standing.

Where a citation lived only in `lang/` and the string is genuinely being
rewritten away, the reference is **moved** into the comment beside the key's
consumer — not dropped. A pointer costs nothing to keep and is unrecoverable
once gone.

## Enforcement

`ip-scan.mjs` hard-FAILS on a tracked `ruledata/` directory, on a LOCAL-ONLY
rules extract, and on a copyright notice inside machine data. That is the
whole of what a machine can decide.

**Neither the prose rule nor the value rule has a gate, and neither can have
one.** No regex tells a rule's sentence from an authored one, or a structural
constant from a printed one. A green `ip-scan` is evidence about paths and
paste artifacts and about nothing else — do not read it as a content verdict,
and do not let a release procedure read it as one either. Both rules need a
reviewer, every time. Book content reaches a world through the importer,
materialized from the GM's own books.

The real gate fires **pre-commit** (`ip-quarantine.mjs`, armed by the
`prepare` script on every clone): a flagged staged file is unstaged and
appended to `.git/info/exclude`, so the commit proceeds without it and the
file cannot be re-staged by accident. Distinguish the two failure classes:
**a leak** (bulk book extracts, rules words, page values in anything tracked)
never ships and is purged from history if it landed; **app-licensed in-app
content** (what the importer materializes into a world from the GM's own
books) is legitimate and is not a leak when it appears in a screenshot or a
world backup.

This doctrine is deliberately stricter than the licence requires on words and
numbers — the margin is the point, and it is not relaxed because a particular
string looks legally safe. The margin buys nothing on attribution, which is
why it is not spent there. The ruling and its history live in
`acks-module-template/docs/DECISIONS.md`.
