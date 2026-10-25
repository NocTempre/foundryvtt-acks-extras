# Domains — not built

Work that is designed but absent, deliberately. How the feature behaves now is
[MODEL.md](MODEL.md); why it is shaped that way is [DECISIONS.md](DECISIONS.md).

---

## Wave 3 — the automation

- **The favors-and-duties chart** as a roll table. The other rules tables
  are read already ([MODEL.md](MODEL.md), "The rules tables"); what wave 3
  adds is their use, where a table the Judge's books did not yield degrades
  to "not run" and the Judge can type the figure.
- **The derivations**, pure and with every table passed in: families across a
  realm, land revenue from land value and improvement, tribute in from the
  vassals' last month, base morale and its parts, the stronghold minimum and
  whether it is met, the growth limit, the title tier. An unset wave-1 line
  derives; a typed one stands.
- **The month**, GM only, in the Judge's order: favors and duties, revenue,
  expenses, income into the treasury, growth, the morale roll, then the ledger
  row. Apply-once by month index, with a claim before the write and a resume
  for a month that wrote its row and not its coin. New fields with defaults:
  favors' and duties' times, religion, occupation, tithes, the treasury (the
  Ledger's empty treasury row then shows it), magistrates, the month's inputs,
  the last month applied, the ledger rows.
- **The cut-over**: the henchmen facts read domain income, social rank and
  stronghold from here first; the location's market class and
  `market.domainUuid` lose their third-party reads; the template canon stops
  routing domains out of scope.

## On the map

- **A map colour the Judge picks**: a field on the record, set from the
  Overview, which the Domains mode reads before the hashed one.

## Not in any wave

- Campaign experience from domain income.
- Special domain types.
- The hex survey and a ruler's believed land value.
- Littoral hexes and navies.
- What unpaid expenses cost.
- Followers arriving with families.
- Call to arms and scutage.
- Senates, hijinks and syndicates.
- Ending the month across a whole realm at once, or on a calendar trigger.
- The party sheet naming its domain.
- A garrison troop roster (a record's troop table stays in the notes).
- Prune survival for an organisation's seat.
