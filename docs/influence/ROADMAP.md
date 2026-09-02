# Influence — not built

## 1. The modifier labels still carry printed magnitudes

25 of the 39 `ACKS-INFLUENCE.mod.*` keys in `lang/en.json` state a modifier's
size inside the label a user reads:

- `mod.diplomacy.personallyHarmed` — "Harmed by character (-5)"
- `mod.diplomacy.brandishing` — "Brandishing a weapon (-1)"
- `mod.diplomacy.authority` — "Has authority over the other (±1 or more)"
- `mod.diplomacy.favors` — "Owes favors (±1 per unrequited favor)"

A modifier's size is content: it is read off a page, and the doctrine puts it
on the far side of the line from the procedure that applies it. That these are
*labels* rather than constants changes nothing — the number reaches the reader
either way, and a label is the more visible of the two.

**Why it survived the 6.2.0 pass.** That pass moved the two figures the code
*computed* with (`INFLUENCE_TIME_STEPS`, `HENCHMAN_MONTHLY_WAGE`) and stopped
at the boundary of `lang/`. The magnitudes here are not computed with at all —
each row's value is a number the user types into the box beside the label — so
they never appeared in the constants sweep. Searching for values the code
*reads* does not find values the code only *prints*.

`ip-scan.mjs` does not catch these and is not expected to: it fails on tracked
`ruledata/` and on page citations, and the doctrine states plainly that the
value rule needs a reviewer. This is what that reviewer clause is for.

**Shape of the fix.** The label states what the row *is*; the magnitude arrives
registered, the way `influenceTimeLadder` now takes its ladder — so the row
reads "Harmed by character" and shows its value only where the reader's own
book supplied one. The awkward cases are the two that are not a single number
(`±1 or more`, `±1 per unrequited favor`): those are a *rule about how to pick*
a value, not a value, and want deciding before the sweep rather than during it.

Not a 6.2.0 regression — these have shipped since the feature existed.

## 2. The unaudited badge is a standing admission

`ACKS-INFLUENCE.unaudited.badge` tells the reader that some mechanics were
classified from book text automatically and never checked against the page,
and offers them unticked. That is honest, but it is a permanent banner in a
shipped surface. Either the classifications get audited and the badge retires,
or the badge becomes the documented steady state and says so deliberately.
It is currently neither.
