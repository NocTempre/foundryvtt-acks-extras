# Influence — not built

## 1. Printed figures the roller still ships

The roller's pages read their figures from the imported page, and their labels
carry none (`MODEL.md`, "Printed pages"). Still shipped, found while moving
them and left for their own rows:

- the wording of each tone result (`ACKS-INFLUENCE.band.<tone>.result1` to
  `result5`) and of the irrefusable and loyalty results, which paraphrase the
  page's own text.

**The surface is wider than the influence feature.** A sweep of `lang/en.json`
for a signed number, a coin/weight/die quantity, or a `per`-scaled figure
inside a string a user reads counted **73** `ACKS-INFLUENCE` keys and **125**
module-wide (`ACKS-HENCHMEN` 22, `ACKS-FORMATION` 12, `ACKS-EQUIPMENT` 9, the
rest in ones and twos) before the tone pages were moved. Whatever mechanism
retires the rest has to run over the other roots too, and `ACKS-EQUIPMENT`
reaches into macro bodies as well as labels.

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
world. `tools/validate-producers.mjs` waives it against this section.

The bribe's own Cost of Bribes table (RR ch. 6, "Offering Bribes") has no
capture of its cost column. Its tier bonuses are read (`bribeTiers`), but a
bribe prices off the signing bonus ladders the hiring and Bribery pages print,
which hold the same pay periods (`DECISIONS.md`, "A bribe is priced off the
imported wage and pay-period ladders"); a capture of the cost column itself
would let its cite name the bribe's own page.

The `morale` document and the `influence` document's `hiringOffer` are the
pattern: each has a recipe, and the `morale`, `obedience` and `hiring` pages
read them (`MODEL.md`, "Printed pages"), and so do the three reaction tones'
modifier tables, proficiency boxes included.

## 4. What the morale pages left behind

- **An unread obedience page raises no insist card.** The henchmen feature
  offers the insist action when the roll's outcome is a refusal, and a page
  with no result column reports none. The Judge reads the result off the page
  and has no button for what follows it. Wanted: a way to name the result by
  hand on a card that named none.
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

## 6. Result text arrives through the importer (T-0512)

A roll's result shows its name and a page reference and nothing else: the
reaction tones' attitude names, the Hireling Loyalty results, the Irrefusable
Offer results, and the intimidation notes. Not built: a recipe that captures
each result's printed text from the Judge's own copy, and a card that shows it
beside the name when it is imported. Owner ruling on T-0512 ("Name now, import
text later"). The henchmen strings that name the same
results are the matching row in [../henchmen/ROADMAP.md](../henchmen/ROADMAP.md).
