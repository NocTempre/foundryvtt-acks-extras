# Domains — how it works now

A domain is a ruler's land as the campaign game keeps it (RR ch. 8 §VIII.3):
its territory and the peasant families on it, the settlements and strongholds
it holds, the month's revenue and expense lines, its morale, and its place in a
realm of lieges and vassals. It is an Actor sub-type, `acks-extras.domain`, so
everything the rest of the module does with an actor works on it unchanged.

This is the **record**: every field a printed domain record fills, in its
final shape, a plain sheet that edits it, and the sums read off what it states.
Nothing here derives a figure the record does not hold — a line nobody has
entered is unset, not zero. The stylized sheet and the automation (the rules
tables, the derivations, the month, territory painted on the map) are
[ROADMAP.md](ROADMAP.md); why it is shaped this way is
[DECISIONS.md](DECISIONS.md); the live recipe is [TESTING.md](TESTING.md).

| File | Owns |
|---|---|
| `scripts/domains/constants.mjs` | The sub-type id, the lang root, the vocabularies: classifications, holding roles, revenue and expense lines, a line's four figures. |
| `scripts/domains/domain-logic.mjs` | The pure half: the row normalisers and `normalizeDomain`, the sums (families, hexes, stronghold value, a line's amount, tribute in, the ledger) and the realm walks (the loop guard, which domain holds a place). Foundry-free. |
| `scripts/domains/data/domain-data.mjs` | `DomainData` — the schema, and readers delegating to the logic (`peasantFamilies`, `hexCount`, `strongholdValue`, `holdsPlace`, `placeUuids`, `hasLiege`). |
| `scripts/domains/domains.mjs` | The world-facing readers and the Judge's two checked writers, `setLiege` and `hold`. |
| `scripts/domains/apps/domain-sheet.mjs` | The plain working sheet: six tabs, row add and remove, every drop a domain takes. |
| `scripts/domains/module.mjs` | Registration (data model, sheet, templates, token defaults) and the `acksExtras.domains` api. |

## Design doctrine

- **Reuse**: Actor documents; the lib place layer's ancestor walk
  (`ancestorUuids`, `indexPlaces`) for both the realm's loop guard and the
  question of which domain a place stands in; the location's own market for a
  placed settlement's families and market class; lib's alignment vocabulary
  and the formation feature's territory keys.
- **Extend**: the `acks-extras.domain` sub-type (TypeDataModel). Every field
  defaults, so a field a later wave adds needs no migration.
- **Enhance**: the domain sheet; one clause in the location feature's
  empty-location prune.
- **Invent**: nothing. No rate, no band, no table the book prints. The module
  ships the shape a record takes; the figures are the Judge's, or a book's
  through the importer.

## The record

**Who and under whom.** `rulerUuid` names the ruler's actor; `rulerName` is the
record's word for a ruler with no actor, and is also written when an actor is
dropped, so the record still reads after the actor is gone. `title` is the
Judge's word. `parentUuid` names the liege domain and `liegeName` a liege with
no actor; either one means tribute is owed. `classification` is blank or one of
`CLASSIFICATIONS` — the formation feature's `TERRITORY_KEYS` less `unsettled`,
which is a hex no domain has claimed. `alignment` is blank (the ruler's) or a
lib `ALIGNMENTS` key. `notes`, and `gmNotes` for the Judge's eyes only, are
HTML.

**Territory** is rows of `{id, label, hexLabels, count, map, landValue,
improvement, families, revealed, note}`. A row stands for one hex or for a run
of them: its hex count is the length of `hexLabels` where any are given, else
`count`, else unknown. A record that prints only totals is one row. Peasant
families are the rows' `families` summed. `map` is null until wave 3 paints a
row; `landValue` is null until someone knows it, and `revealed` says whether a
player reading the sheet sees it.

**Holdings** are places, by reference: `{uuid, name, role, families,
marketClass, investmentGp, note, hidden}`. The role is `settlement`,
`stronghold` or `other`. A row with a `uuid` is **placed** — its families and
market class are its location's own (`system.market.urbanFamilies`,
`system.marketClass`), and the row's `families` and `marketClass` are ignored.
A row with no `uuid` is **unplaced**: a record's town with no location yet,
whose figures are the row's. Urban families are the settlement rows summed,
and a settlement nobody has entered families for is counted as unknown, never
as empty. A placed row whose location is gone stays, marked missing; nothing
rewrites a domain when a place is deleted.

**Structures** are the stronghold's rows, `{id, name, count, ac, unitCapacity,
shp, costGp, note}`. `costGp` is the row's total cost; the stronghold's value
is their sum, with the rows that give no cost counted apart.

**Lines.** `revenue.{land, service, tax, trade}` and
`expenses.{garrison, liturgy, upkeep, tithe}` are each `{peasantPer, urbanPer,
peasantGp, urbanGp, note}`, every figure nullable, because a printed record
gives a line either as a rate per family or as a flat total, and gives it for
the domain's peasants, its settlements, or both. On each side the flat figure
wins over the rate; a rate is multiplied by that side's families. The note
carries what the figure cannot, such as a festival's timing. `otherRevenue` and
`otherExpenses` are rows of `{id, label, gp}` for whatever a record lists
beyond the eight.

**Tribute.** `tributeGp` is what this domain pays its liege, null where nobody
has entered it. Tribute in is never stored: it is the sum of the vassals'
payments (below).

**Vassals** are of two kinds, and a vassal is one or the other. A **vassal
domain** is a domain actor whose `parentUuid` names this one — it carries its
own whole record. A **vassal row** is the summary a liege's record prints for
a vassal with no actor: `{id, name, rulerName, families: {peasant, urban},
realmFamilies, revenueGp, tributeGp, extraTaxGp, domainHexes, realmHexes,
realmGarrisonGp, favors, duties, note}`, where each hexes block is `{count,
labels, classes}` — a count, or the labels the record lists, and the
classifications it names.

**Morale** is `{current, base}`, both nullable: a record prints one or the
other. **Favors** and **duties** are rows of `{id, label, note}`.

`schemaVersion` is 1.

## The ledger

`ledgerOf(record, {families, vassalDomains})` is the month as the record
states it: each line's amount on each side, the other lines, tribute in and
out, and totals over what is known. Two things keep a total out of the
"exactly" column:

- a line is **unset** when none of its four figures is entered, an other line
  when its `gp` is blank, and tribute out when it is owed and blank;
- a line is **unknown** when its rate meets a count of families nobody has
  entered, and a vassal is unknown when its tribute is.

Either makes the ledger `partial`, and the sheet then says how many of each
beside the totals, which read as "at least". A domain with no lord owes no
tribute and is not partial for its absence.

Tribute in sums each vassal row's `tributeGp` plus its `extraTaxGp`, and each
vassal domain's own `tributeGp`. Wave 3 replaces the second with the vassal's
last month's tribute out.

## Holdings and the map of places

**One holder per place.** `hold(domain, place)` refuses a place another domain
already holds, naming that domain, because a settlement counted in two domains
is the same families twice. It writes the row's role as `settlement` when the
place has a market and `other` otherwise. `release(domain, uuid)` lets go.

**A place answers to the domain around it.** `domainOf(place)` walks the place
and then its ancestors, nearest first, and returns the first domain holding
one of them — so a domain holding a town answers for every inn in it, and a
domain holding the inn itself answers for the inn before the town's does.
`domainsHolding` and `holdsPlace` ask about the place alone.

**A held place survives the prune.** The location feature's
`pruneEmptyLocations` asks `acksExtras.domains.holdsPlace` before it deletes an
empty place, which is why the api is published at `init`: the prune runs at
`ready`.

## The realm

`setLiege(domain, liege)` sets or clears `parentUuid`. A liege that is the
domain itself, or one that already answers to it at any depth, is refused
(`wouldCycleDomain`, the factions' loop guard over the same ancestor walk).
`vassalsOf` and `liegeOf` read the edge from either end, and `domainsRuledBy`
answers which domains an actor rules.

## The sheet

Six tabs: **Overview** (ruler, title, liege, classification, alignment,
morale and the totals), **Territory**, **Holdings** (the places and the
structures), **Ledger**, **Realm** (vassal domains, vassal rows, favors,
duties) and **Notes**.

**The record is the Judge's.** A player who can open the sheet reads it and
edits nothing: the controls render disabled, the row buttons do not render, a
hidden holding is left out, a territory row's land value shows only once
revealed, and `gmNotes` is absent. `setLiege`, `hold` and `release` refuse a
player's client whatever calls them.

**Lists are named form rows** (`system.territory.0.families`) written whole on
submit. `_processFormData` fills each row's unrendered fields from the stored
document (lib `keepUnrenderedFields`) and turns the index-keyed objects a form
submits into rows before the model cleans them. A row's add and remove buttons
submit the form first, so an edit in flight is not written over.

**Drops are read by what is dropped.** A place is held. A domain dropped on
the liege row (`[data-drop-zone="liege"]`) becomes this domain's liege, and
dropped anywhere else becomes its vassal. An organisation is refused — it is
not a ruler. Any other actor becomes the ruler. Items are refused, goods in
the words every sheet that lists no goods uses.

**An open sheet follows the actors it reads.** Core re-renders a sheet for its
own document only; `registerDomainSheetRefresh` re-renders every open domain
sheet when another domain, a place or its ruler is created, changed or
deleted, gathered into one render per burst. Without it a liege's sheet keeps
listing a released vassal and a deleted settlement's families.

The sheet scrolls at its body part root, which keeps its place across the
re-render every edit makes.

## The api

`acksExtras.domains`, published at `init`:

- readers — `isDomain`, `allDomains`, `domainOf`, `domainsHolding`,
  `holdsPlace`, `domainsRuledBy`, `vassalsOf`, `liegeOf`, `wouldCycle`;
- the record — `normalizeDomain` (what a writer, the importer's binding
  included, hands `system`), `blankDomain`, and the sums `familiesOf`,
  `ledgerFor`, `ledgerOf`, `peasantFamiliesOf`, `urbanFamiliesOf`,
  `hexCountOf`, `strongholdValueOf`, `tributeInOf`;
- the Judge's writers — `setLiege`, `hold`, `release`, each returning why it
  refused;
- the vocabularies and `DomainSheet`.

A domain is created like any actor, then updated: the system's own
`Actor.create` replaces a single create's `system` unless the data carries
items ([TESTING.md](TESTING.md), "Core drive mechanics").

Its prototype token is a marker — named on hover, neutral, no bars, no sight —
and its picture is core's castle where the maker names none.
