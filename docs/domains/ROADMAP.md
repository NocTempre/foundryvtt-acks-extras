# Domains — not built

Work that is designed but absent, deliberately. How the feature behaves now is
[MODEL.md](MODEL.md); why it is shaped that way is [DECISIONS.md](DECISIONS.md).

---

## Wave 2 — the stylized sheet

- **The character sheet's frame**, as the party sheet took it: the band in the
  header (heraldry, the title before the name, the morale figures), an art row
  with the ruler, liege, classification and alignment, and rails for the
  families, the stronghold value and the month's lines. The plain sheet's
  class and actions stay; its templates go.
- **A lib helper for the band**, so the frame's header is written once. The
  existing copies move onto it later.
- **Ruler and liege chips** that take a drop or a picker; **promote a vassal
  row** to a domain actor (the row is deleted); **found a settlement** — a world
  location with a market, held at once.
- **A marker test in lib** (`isMarkerActor`: a location, an organisation or a
  domain) for the readers that take a token for a body, closing the same gap
  for organisations.
- **Drop guards** on the location and faction sheets: a dropped domain is
  refused with where it belongs. **The location sheet names its domain**
  beside its organisations.

## Wave 3 — the automation

- **The rules tables** as recipes of a `domain` ruledata document, each with
  its printed page: revenue and expenses, the stronghold minimum, peace and
  growth, prestige immigration, the morale levels, effects and roll, the base
  morale modifiers and personal authority, titles, tribute and its
  inefficiency, the settlement revenue, expense and investment tables, the
  magistrates' share; the favors-and-duties chart as a roll table. A missing
  table degrades to "not run", and the Judge can type the figure.
- **The derivations**, pure and with every table passed in: families across a
  realm, land revenue from land value and improvement, tribute in from the
  vassals' last month, base morale and its parts, the stronghold minimum and
  whether it is met, the growth limit, the title tier. An unset wave-1 line
  derives; a typed one stands.
- **The month**, GM only, in the Judge's order: favors and duties, revenue,
  expenses, income into the treasury, growth, the morale roll, then the ledger
  row. Apply-once by month index, with a claim before the write and a resume
  for a month that wrote its row and not its coin. New fields with defaults:
  favors' and duties' times, religion, occupation, tithes, the treasury,
  magistrates, the month's inputs, the last month applied, the ledger rows.
- **Territory on the map**: battlemap gains a paint-layer seam (its own three
  layers re-registered on it), and a GM-only domain layer paints the rows; a
  painted row is read from the map, the stored row wins, and erasing a cell
  never deletes a row.
- **The cut-over**: the henchmen facts read domain income, social rank and
  stronghold from here first; the location's market class and
  `market.domainUuid` lose their third-party reads; the template canon stops
  routing domains out of scope.

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
- The character sheet PDF's domain page written as a domain.
- The party sheet naming its domain.
- A garrison troop roster (a record's troop table stays in the notes).
- Prune survival for an organisation's seat.
