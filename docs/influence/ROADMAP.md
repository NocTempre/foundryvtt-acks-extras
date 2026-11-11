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

## 3. The attempt-time ladder has no producer

The `influence` document's `attemptTime` (the attempt-time ladder) is read in
`influence/constants.mjs`, and no recipe writes it, so it is absent in every
world. `tools/validate-producers.mjs` waives it against this section. §1's
fix is this work seen from the other side: a label can drop its magnitude
once the magnitude has a document to arrive in.

The bribe's own Cost of Bribes table (RR ch. 6, "Offering Bribes") has no
capture either. A bribe prices off the signing bonus ladders the hiring and
Bribery pages print, which hold the same pay periods (`DECISIONS.md`, "A bribe
is priced off the imported wage and pay-period ladders"); a capture of the
table itself would let its cite name the bribe's own page.

The `morale` document and the `influence` document's `hiringOffer` are the
pattern: each has a recipe, and the `morale`, `obedience` and `hiring` pages
read them (`MODEL.md`, "Printed pages"). The three reaction tones, `loyalty`
and `irrefusable` are what §1 still describes, and the tone pages'
proficiency rows still carry a figure each; the hiring page's `held` rows are
the shape that retires it.

## 4. What the morale pages left behind

- **An unread obedience page raises no insist card.** The henchmen feature
  offers the insist action when the roll's outcome is a refusal, and a page
  with no result column reports none. The Judge reads the result off the page
  and has no button for what follows it. Wanted: a way to name the result by
  hand on a card that named none.
- **The insist penalty is still a shipped figure.** The henchmen feature
  applies it from a constant in `engine/events.mjs` and prints it in
  `ACKS-HENCHMEN.card.insist`. RR 167 prints it in prose beside the table the
  `hirelingObedience` recipe already reads, so it can ride that recipe as one
  more value.
- **The obedience fallback has no rows.** When the influence roller cannot
  open, the henchmen feature's own throw dialog rolls the morale score and
  whatever the employer's effects add, and names no result.
- **The morale rating's own range is not checked.** The page adds whatever the
  actor holds.
- **The obedience page takes no conditions.** The morale page lists the
  subject's conditions because the system's morale roll takes them. Whether a
  figure on morale rolls reaches the obedience roll of RR 167 is a reading of
  RR 507-515 nobody has made; until it is, a Judge adds one through the
  adjustment row.
- **Conditions are read when the page opens.** The modifier hook fires once
  per open, so a condition gained while the page is up is not on it.

## 5. A dialog keeps the target it was opened for

The dialog takes its target when it opens, from the caller or from the first
targeted token (`openingTarget` in `scripts/influence/actor-data.mjs`), and the
modifier hook's rows are that target's. Reset defaults reads the current target
again (`#onResetDefaults` in `scripts/influence/influence-app.mjs`) without
firing the hook again, so a dialog opened against one token switches to
whichever token is targeted when Reset is pressed while keeping the first
target's standing rows. The code comment calls the re-read deliberate. Not
built: a dialog that keeps the target it was opened for, or a Reset that
re-fires the hook for the new one. That needs a ruling first, since the re-read
is how a newly selected token is picked up.
