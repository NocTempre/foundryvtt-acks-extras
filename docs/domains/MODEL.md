# Domains — how it works now

A domain is a ruler's land as the campaign game keeps it (RR ch. 8 §VIII.3):
its territory and the peasant families on it, the settlements and strongholds
it holds, the month's revenue and expense lines, its morale, and its place in a
realm of lieges and vassals. It is an Actor sub-type, `acks-extras.domain`, so
everything the rest of the module does with an actor works on it unchanged.

This is the **record**: every field a printed domain record fills, in its
final shape, a sheet in the character sheet's frame that edits it, and the
sums read off what it states, with the hexes painted into a domain on the map
read in beside its rows. Nothing here derives a figure the record does not
hold — a line nobody has entered is unset, not zero. The rules tables are
read but not yet used. The automation (the derivations, the month) is
[ROADMAP.md](ROADMAP.md); why it is shaped this way is
[DECISIONS.md](DECISIONS.md); the live recipe is [TESTING.md](TESTING.md).

| File | Owns |
|---|---|
| `scripts/domains/constants.mjs` | The sub-type id, the lang root, the vocabularies: classifications, holding roles, revenue and expense lines, a line's four figures. |
| `scripts/domains/domain-logic.mjs` | The pure half: the row normalisers and `normalizeDomain`, the sums (families, hexes, stronghold value, a line's amount, tribute in, the ledger), the realm walks (the loop guard, which domain holds a place), `promoteVassalRow`, the record a vassal row becomes, and the realm on the map (`realmChain`, `borderTier`, `realmOrder`, `domainColors`, and the territory with the map read in: `territoryRows`, `keepCandidates`, `keepPaintedRow`). Foundry-free. |
| `scripts/domains/domain-map.mjs` | The domain paint layer and the Domains map mode, registered into battlemap's registries; the hexes painted into a domain on every scene (`paintedHexesOf`, `territoryOf`, `hexCountFor`); the redraw when a domain the map draws changes. The one file here that imports battlemap. |
| `scripts/domains/data/domain-data.mjs` | `DomainData` — the schema, and readers delegating to the logic (`peasantFamilies`, `hexCount`, `strongholdValue`, `holdsPlace`, `placeUuids`, `hasLiege`). |
| `scripts/domains/domains.mjs` | The world-facing readers and the Judge's writers: `setLiege`, `hold` and `release`, checked against every other domain, and `promoteVassal` and `foundSettlement`, which make a document. |
| `scripts/domains/domain-frame.mjs` | The frame decided over the sums: the ruler and liege chips, the classification and alignment tags, the rail cells, and what the figures leave out. Foundry-free. |
| `scripts/domains/apps/domain-sheet.mjs` | The sheet: the band, the frame, six pill tabs, row add and remove, keeping a row read from the map, the pickers, promoting and founding, every drop a domain takes. |
| `scripts/domains/module.mjs` | Registration (data model, sheet, templates, token defaults) and the `acksExtras.domains` api. |

## Design doctrine

- **Reuse**: Actor documents; the lib place layer's ancestor walk
  (`ancestorUuids`, `indexPlaces`) for both the realm's loop guard and the
  question of which domain a place stands in; the location's own market for a
  placed settlement's families and market class; lib's alignment vocabulary
  and the formation feature's territory keys.
- **Extend**: the `acks-extras.domain` sub-type (TypeDataModel). Every field
  defaults, so a field a later wave adds needs no migration.
- **Enhance**: the domain sheet; a paint layer and a map mode registered into
  battlemap's registries; one clause in the location feature's
  empty-location prune; the location sheet's Domain line, and the location
  and faction sheets' refusal of a dropped domain, each asked through
  `acksExtras.domains` so neither feature imports this one.
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
families are the rows' `families` summed. `map` is `{sceneUuid, key}`, the
hex on a map the row stands for, or null (§Territory on the map); `landValue`
is null until someone knows it, and `revealed` says whether a player reading
the sheet sees it.

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

**A vassal row becomes a domain.** `promoteVassal(liege, rowId)` makes a
domain actor answering to the liege, filed in the liege's folder, and deletes
the row once the new domain holds its record — a vassal is an actor or a row,
never both. `promoteVassalRow` decides where each of the row's figures lands:

| The row's | The new domain's |
|---|---|
| `name`, `rulerName` | its name, `rulerName` |
| `domainHexes`, `families.peasant` | one territory row: the labels, the count, the peasant families |
| `families.urban` | one unplaced settlement holding with those families |
| `domainHexes.classes` | `classification` where the row names one class; else blank, and the classes in the notes |
| `tributeGp` + `extraTaxGp` | `tributeGp` |
| `favors`, `duties` | one favor row, one duty row |
| `realmFamilies`, `realmHexes`, `realmGarrisonGp`, `revenueGp`, `extraTaxGp`, `note` | the notes, one labelled line each |

The liege's tribute in is the same before and after: it counted the row's
tribute and its additional tax, and now counts the new domain's tribute out.

**A settlement is founded.** `foundSettlement(domain, {name, market})` makes a
world location with a market — the location model's empty one unless a
market is passed — and holds it at once as a settlement.

## Territory on the map

`domain-map.mjs` registers into battlemap's two registries
(`docs/battlemap/MODEL.md`, "The layer registry" and "Map modes"); battlemap
imports nothing of this feature.

**The domain layer.** The Country brush gains a Domain pill. A hex is painted
into a domain by the domain's uuid (`flags["acks-extras"].domain`, its cells
in `domainHexes`), one region per domain, drawn on the Regions control alone.
The palette lists the world's domains in realm order (`realmOrder`: each
sovereign by name, its vassals depth first under it, a domain caught in a loop
of lieges last), its swatches folded under each realm's sovereign.

**The territory a hex derives.** The layer derives a hex's territory: its
domain's `classification` (RR §VIII.3), or nothing where the domain has none.
A territory painted on the hex is the Judge's override and wins; `countryAt`
names a derived territory's source `"domain"`, and the Territory mode stripes
a painted hex in its domain's class where the two differ
(`docs/battlemap/MODEL.md`, "One reader").

**The Domains mode** draws each painted hex's border in its domain's colour.
A sovereign's colour is hashed from its uuid, so every client draws the same
one; a vassal's is its liege's lightened by its place among the liege's
vassals ordered by uuid, so a rename moves no colour and no vassal takes its
liege's own. A side weighs by where the two hexes' realms part (`borderTier`):
the edge of a realm, against another realm or unpainted land, is heaviest;
a side between two vassals of one sovereign, or a sovereign and its vassal,
is lighter; one deeper in a realm is lightest. The legend lists the domains
painted on the scene in realm order, a vassal as its name under its liege's.
A hex painted into a domain no longer in the world is drawn grey, named as
such in the legend, and derives nothing; the palette offers no swatch for it.

**Rows from the map.** `territoryOf(domain)` is the record's territory with
the map read in (`territoryRows`): every stored row first, then one row READ
from the map for each hex painted into the domain on any hex scene that no
stored row's `map` names, a hex and no families. A stored row's `map` state
is *painted* where its hex is still painted into this domain, *stale* where it
is not (erased, painted to another domain, its scene gone) and *unmapped*
where it names none. The stored row wins its hex, a read row is never written
by a paint, and erasing a cell deletes no row. `hexCountFor` counts over
`territoryOf`; the families stay the stored rows'.

**The sheet's Territory tab** lists the read rows after the stored ones as
text, with the map's name, and a Keep press for the Judge. Keep stores the
hex as a row: tied to one of `keepCandidates` (a stored row naming no hex on a
map and covering one hex at most) where the Judge picks it, else a row of its
own. A stale stored row carries a broken-link mark. The frame's hex count is
`hexCountFor`'s.

**The map follows the domains.** A domain created, deleted, renamed, given
another liege or another class changes no region, so `installDomainMap`
calls battlemap's `paintLayerChanged("domain")` and the overlay and an open
palette redraw.

## The sheet

The sheet stands in the character sheet's frame, as the party sheet does:

- **The band is the window header** (lib `moveBandIntoHeader`): the heraldry
  — the domain's picture, which a press changes along with a token still
  wearing the old one — the title before the name, and the current and base
  morale.
- **The art row** stands above every tab. Its reading column holds the
  **chips** — the ruler and the liege, each naming the actor, else the
  record's word for one, else that there is none — and the classification and
  alignment **tags**. Its **rails** are the land (peasant families, urban
  families, hexes, the stronghold's value) and the month (revenue, expenses,
  income). A count with rows nobody counted reads as a floor (`70+`); a month
  over a partial ledger marks each of its cells, and its tooltip says what is
  missing. A cell is a press that opens the tab its figure is kept on.
  `domain-frame.mjs` decides every chip, tag and cell.
- **Six pill tabs**: **Overview** (the record's words for the ruler and the
  liege, the classification and alignment, and what the rails' figures leave
  out), **Territory**, **Holdings** (the places and the structures; founding a
  settlement), **Ledger** (with a treasury row standing empty: the domain
  keeps no treasury yet), **Realm** (vassal domains, vassal rows — each with
  its promote button — favors and duties) and **Notes**. Each tab is a part of
  its own and scrolls at its root, so it keeps its place across the re-render
  every edit makes; in a window shorter than the frame, the content box
  scrolls down to the panel.

**The chips take a drop or a picker.** The ruler picker lists the world's
characters and monsters; the liege picker every other domain that would not
close a loop. Each chip's clear drops the actor and keeps the record's word.

**The record is the Judge's.** A player who can open the sheet reads it and
edits nothing: the controls render disabled, no row, chip, promote, found or
heraldry press renders, a hidden holding is left out, a territory row's land
value shows only once revealed, and `gmNotes` is absent. Core disables every
control of a sheet its reader cannot edit, the band's before it is moved;
the reading presses — the pills, the rail cells, a name that opens another
sheet — are enabled again after each render. Every writer in `domains.mjs`
refuses a player's client whatever calls it.

**Lists are named form rows** (`system.territory.0.families`) written whole on
submit. `_processFormData` fills each row's unrendered fields from the stored
document (lib `keepUnrenderedFields`) and turns the index-keyed objects a form
submits into rows before the model cleans them. A row's add and remove buttons
submit the form first, so an edit in flight is not written over.

**Drops are read by what is dropped.** A place is held. A domain dropped on
the liege chip (`[data-drop-zone="liege"]`) becomes this domain's liege, and
dropped anywhere else becomes its vassal. An organisation is refused — it is
not a ruler. Any other actor becomes the ruler. Items are refused, goods in
the words every sheet that lists no goods uses. The other way round, a
domain dropped on a place's sheet or an organisation's is refused, with where
it belongs.

**A place's sheet names its domain.** Beside its organisations, a location
sheet shows the domain holding it, or holding the nearest place around it,
for the Judge and the place's owners; a hidden holding shows to the Judge
alone.

**A domain's token is a marker**, kept out of every reader that takes a
token for a body by lib's `isMarkerActor` ([PLACES.md](../lib/PLACES.md)).

**An open sheet follows the actors it reads.** Core re-renders a sheet for its
own document only; `registerDomainSheetRefresh` re-renders every open domain
sheet when another domain, a place or its ruler is created, changed or
deleted, gathered into one render per burst. Without it a liege's sheet keeps
listing a released vassal and a deleted settlement's families. A region
painting hexes into a domain re-renders that domain's open sheet when it is
made, changed or deleted, and a scene deleted re-renders every open one,
since no region hook fires for the regions it takes.

## The official sheet's domain page

The character sheet's PDF import writes the official sheet's domain page into
the character's domain, and its export writes a domain back onto the page,
both for the Judge alone: `docs/character-sheet/MODEL.md`, "The official
sheet (PDF)".

## The rules tables

The month's tables arrive through the importer from the Judge's own book, as
the recipes of the `domain` ruledata document
(`scripts/importer/table-recipes.mjs`, each with its printed page). Nothing
reads them yet; wave 3 does ([ROADMAP.md](ROADMAP.md)). Each is stored in the
shape its reader takes, so no reader parses a cell:

- a count band (families, realm families, vassals, a tribute inefficiency
  band) as `{min, max}`, an open end null (`countBand`: thousands commas,
  `K` and `M`, "or more", "or fewer", a trailing `+`);
- a rate per family as `{min, max, per}` in gp, a printed range kept whole,
  silver and copper converted (`gpRate`); a row printing a word instead is
  null;
- a list of signed modifiers as integers (`signedList`);
- a share written in words as a fraction (`fractionWord`), a decimal as a
  number (`num`), and a die as Foundry rolls it, with an exploding mark as
  `x` (`rollFormula`);
- the stronghold minimum's header row, the hex size each column is for, as
  the row `hexMiles` (a row spec that is `unlabelled` and carries its own
  `cellPattern`).

`tools/importer/test-recipe-content.mjs` holds each table to its shape on the
seat's book; `test-grid-rows.mjs` and `test-prose-values.mjs` pin the
patterns and takes on invented text.

## The api

`acksExtras.domains`, published at `init`, `apiVersion` 3 (2 added
`promoteVassal` and `foundSettlement`, 3 `territoryOf` and `hexCountFor`):

- readers — `isDomain`, `allDomains`, `domainOf`, `domainsHolding`,
  `holdsPlace`, `domainsRuledBy`, `vassalsOf`, `liegeOf`, `wouldCycle`,
  `territoryOf`, `hexCountFor`;
- the record — `normalizeDomain` (what a writer, the importer's binding
  included, hands `system`), `blankDomain`, and the sums `familiesOf`,
  `ledgerFor`, `ledgerOf`, `peasantFamiliesOf`, `urbanFamiliesOf`,
  `hexCountOf`, `strongholdValueOf`, `tributeInOf`;
- the Judge's writers — `setLiege`, `hold`, `release`, `promoteVassal`,
  `foundSettlement`, each returning why it refused;
- the vocabularies and `DomainSheet`.

A domain is created like any actor, then updated: the system's own
`Actor.create` replaces a single create's `system` unless the data carries
items ([TESTING.md](TESTING.md), "Core drive mechanics").

Its prototype token is a marker — named on hover, neutral, no bars, no sight —
and its picture is core's castle where the maker names none.
