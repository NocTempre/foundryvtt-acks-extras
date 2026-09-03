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

`ip-scan.mjs` does not catch these and cannot: it decides file paths and
pasted copyright notices, and since the 2026-09-03 ruling nothing else — the
prose rule and the value rule are both reviewer-only. This is what that clause
is for. Note that these labels carry no page reference either, having never had
one; the fix that retires a magnitude should leave a reference behind it.

**Shape of the fix.** The label states what the row *is*; the magnitude arrives
registered, the way `influenceTimeLadder` now takes its ladder — so the row
reads "Harmed by character" and shows its value only where the reader's own
book supplied one. The awkward cases are the two that are not a single number
(`±1 or more`, `±1 per unrequited favor`): those are a *rule about how to pick*
a value, not a value, and want deciding before the sweep rather than during it.

Not a 6.2.0 regression — these have shipped since the feature existed.

**The surface is wider than `mod.*`.** A sweep of `lang/en.json` for a signed
number, a coin/weight/die quantity, or a `per`-scaled figure inside a string a
user reads counts **73** `ACKS-INFLUENCE` keys and **125** module-wide
(`ACKS-HENCHMEN` 22, `ACKS-FORMATION` 12, `ACKS-EQUIPMENT` 9, the rest in
ones and twos). The 25 above are the concentration, not the extent; whatever
mechanism retires them has to run over the other roots too, and
`ACKS-EQUIPMENT` reaches into macro bodies as well as labels
(`item-loss-from-damage` prints its threshold in three places, one of them the
default value of an input).

## 2. The unaudited badge is a standing admission

`ACKS-INFLUENCE.unaudited.badge` tells the reader that some mechanics were
classified from book text automatically and never checked against the page,
and offers them unticked. That is honest, but it is a permanent banner in a
shipped surface. Either the classifications get audited and the badge retires,
or the badge becomes the documented steady state and says so deliberately.
It is currently neither.
