# Domains — decisions

Dated rulings: what was ruled, what was rejected, what it cost. Append-only;
how the feature behaves now is [MODEL.md](MODEL.md).

### A domain is an actor, built in three waves (2026-10-17)

**Ruled:** the domain is an Actor sub-type, `acks-extras.domain`, a level above
the location: a domain holds places, a place does not hold a domain. It is
built and released in three waves: the **record** (the data model and a plain
working sheet), then the **stylized sheet** (the character sheet's frame), then
the **automation** (the rules tables, the derivations, the month, territory on
the map). Wave 1 ships first, on its own release, because the adventure
imports wait on a record to write into (the AX1 design's domain record, p. 28).

**The constraint that makes a fast first wave safe:** wave 1 ships every field
a printed domain record fills, in its final shape. A later wave only ADDS
fields, each with a default; a TypeDataModel fills a missing field from its
default on read, so an actor written by wave 1 loads unchanged under wave 3 and
nothing migrates. No later wave reshapes a wave-1 field.

**Rejected:** one release carrying all three. The automation is most of the
work, and the imports would have waited on all of it for a schema they could
use today. **Rejected:** a thin wave-1 schema to be widened later — every
field that lands after the imports start writing is a migration of imported
actors.

**Cost:** the wave-1 sheet is plain on purpose and is replaced in wave 2; until
wave 3, every line is a figure someone typed, and a blank one is reported as
unset rather than derived.

**Out of scope:** the third-party `acks-domains` module. Nothing here reads or
writes it; its probes elsewhere in the tree are wave 3's cut-over.

### A line is a rate or a total, on each side (2026-10-17)

**Ruled:** every revenue and expense line is `{peasantPer, urbanPer, peasantGp,
urbanGp, note}`, all nullable. On each side the flat figure wins over the
rate; the rate is multiplied by that side's families.

**Why.** The printed records read for the shape (the RR Domain Sheet, AX1 and
AX3's domain records) give a line in both forms: one record states its
expenses as domain and settlement totals, another as rates per peasant and
per urban family, and a rate that does not divide evenly appears as a total
that is not per family at all. A schema holding only rates cannot store the
first; one holding only totals loses what the second says.

**Rejected:** per-line `decrees.*Gp` overrides on top of derived figures, the
first draft's shape. It assumed the derivation exists, and in wave 1 it does
not.

**Cost:** four figures per line where a record uses one. The sheet shows all
four; the stylized sheet may fold them.

### An unset figure stays out of every total (2026-10-17)

**Ruled:** a line with no figure is **unset**, a rate over a count of families
nobody entered is **unknown**, and either makes the ledger **partial**. The
sheet shows the totals over what is known and says how many lines are unset or
unknown beside them. A blank is never zero.

**Why.** A domain whose garrison line nobody has entered does not pay nothing
for its garrison. A total that silently treats the blank as zero is a smaller
number that looks exact, and the Judge acting on it overpays the treasury.

**Cost:** a fresh domain reads as partial until every line is entered, or
until wave 3 derives the standard figures.

### Vassals are actors or summary rows (2026-10-17)

**Ruled:** a vassal is a domain actor naming its liege (`parentUuid`), or a
summary row on the liege's record (`vassalRows`) — one or the other, never
both. Promoting a row to an actor (wave 2) deletes the row.

**Why.** A printed record lists its vassals as summary rows: families, hexes,
revenue, tribute. Most of them will never be anything more, and a domain actor
for each would be a sheet of blanks. A vassal the campaign does reach wants its
whole record, and that is an actor. Holding both for the same vassal is two
sources for one tribute.

**Cost:** tribute in sums two kinds of source, and a realm walk reads two
shapes.

### Holdings are places by reference (2026-10-17)

**Ruled:** a domain holds a location by uuid, the faction precedent. A placed
settlement's families and market class are its location's own; the row keeps
its own only for a settlement with no location yet. One domain holds a place:
a second hold is refused, naming the first holder. A place's deletion leaves
the row standing, marked missing — nothing rewrites a domain on a delete, as
nothing rewrites a faction's holdings.

**Why.** The market already owns a settlement's urban families, and the
henchmen and markets features read it there. A copy on the domain would drift
from it the first time either was edited.

**Rejected:** a domain flag on the location (`market.domainUuid`, which the
location schema carries for the third-party module). A place pointing at its
domain cannot answer "what does this domain hold" without a walk of every
place in the world, and the location stays minimal. The field leaves the
schema in wave 3.

### A held place survives the prune (2026-10-17)

**Ruled:** the empty-location prune spares a place a domain holds. A held
settlement already survives on its market; this clause is for the stronghold
or the holding with nothing in it yet.

**Cost:** the api is published at `init`, not `ready`, because the prune runs
at `ready` and must be able to ask.

### The wave-1 sheet is the Judge's (2026-10-17)

**Ruled:** only a GM edits a domain on the wave-1 sheet. A player with the
sheet open reads it; the writers that must check every other domain (`setLiege`,
`hold`, `release`) refuse a player's client whatever calls them.

**Why.** The sheet hides a hidden holding from a player, and the lists are
written whole by index. A player able to edit would submit a list with the
hidden row missing and every index after it shifted. Wave 3 opens the decree
lines and the month inputs to the ruler's player, with a write gate in the
model, once the rows are no longer submitted by index.

### A printed classification word is mapped at import (2026-10-17)

**Ruled:** `classification` holds only this edition's keys. A record printing
an older edition's word is mapped to a key by the importer's binding, not by
the schema. *Inferred, unverified:* the older edition's wilderness class
corresponds to outlands; the binding settles it against the System
Compatibility Guide, where conversions start.

### Wave 2: the sheet in the character sheet's frame (2026-10-22)

**Ruled:** the domain sheet takes the frame the party sheet took in 11.4.0 —
the band in the window header, an art row of chips, tags and rails above the
tabs, the tabs as pills, each tab a part that scrolls at its root. The
wave-1 class, its actions, its tab ids and its form handling stay; its
templates are replaced. This is the replacement the 2026-10-17 entry
scheduled, and it reverses no ruling of that day. The band's move into the
header is lib's `moveBandIntoHeader`, written once here; the character, item
and party sheets still carry their own copies (`docs/lib/ROADMAP.md`).

**Rejected:** the plain sheet's liege `<select>` kept beside the chip. The
chip's picker does what the select did, and two controls for one field are
two places for an edit to land.

### A promoted vassal row keeps every figure it held (2026-10-22)

**Ruled:** each of a vassal row's figures lands where a domain keeps it
(`docs/domains/MODEL.md`, "The realm"). The additional tax is added to the new
domain's tribute out, because a row's tribute and its additional tax are both
what its liege receives: the liege's tribute in is the same before the
promotion and after. The figures a domain sums from its own record rather
than storing — realm families and hexes, the realm garrison, the row's
revenue, and the tax split — go to the new domain's notes, one labelled line
each. A row naming one classification gives it; a row naming several leaves
it blank and notes them.

**Rejected:** dropping the summed figures. They are the record's, and the
Judge reconciling the new domain against its printed row needs them.
**Rejected:** schema fields to hold them. A stored copy of a figure the
domain sums is a second source for it, the drift the holdings ruling refused,
and wave 3 derives them.

**Cost:** the new domain's month reads partial until its lines are entered,
as any fresh domain does.

### The pickers offer the system's people and the realm's domains (2026-10-22)

**Ruled:** the ruler picker lists the world's `character` and `monster`
actors; the liege picker every other domain that would not close a loop. A
drop still takes any actor that is not a marker as the ruler.

**Rejected:** every actor in the ruler picker. The list would be the world's
places, organisations and vehicles, and a domain's ruler is a person.

### A place and an organisation refuse a dropped domain, through the api (2026-10-22)

**Ruled:** the location and faction sheets refuse a dropped domain with a
warning saying where it belongs, and the location sheet names the domain
holding it or the place around it. Both ask `acksExtras.domains`, never this
feature's files.

**Why.** Domains imports the location's and the factions' constants; either
importing domains back is a cycle, and the api is the seam between features.

### The treasury row stands empty until the month writes it (2026-10-22)

**Ruled:** the Ledger shows a treasury row with no figure and no field.

**Rejected:** a treasury field now. Wave 3's month is its one writer, and a
field added before its writer is a stored figure nobody keeps.

### Territory on the map: a hex is painted into a domain (2026-10-25)

**Ruled:** the domain a hex belongs to is a layer of the Country brush that
this feature registers (`domain-map.mjs`; battlemap's registry, its
DECISIONS 2026-10-17), drawn on the Regions control alone, its value the
domain's uuid. The hex's territory is its domain's `classification` (the
owner's ruling Q1a, battlemap DECISIONS 2026-10-24), derived through the
layer, and a territory painted on the hex is the Judge's override (battlemap
DECISIONS 2026-10-25, which also names the derived source `"domain"`). The
Domains mode draws a colour per domain, a sovereign's hashed from its uuid
and a vassal's a shade of its liege's, and weighs a side by where the two
hexes' realm chains part: a realm's edge, then a side within one sovereign's
realm at its first level, then anything deeper.

**Why the uuid:** a rename changes nothing painted, and a domain is named the
same way by `parentUuid` already.

**Rejected:**
- *The weight by the ruler's title tier*: the tier is read off a printed
  table, and the record's `title` is the Judge's free word, so the weight
  would need an import and a parse for what the realm's own edges already
  say.
- *A weight per domain by its depth under the sovereign*: a side between two
  domains of different depths would have two weights, and a side is drawn
  once.
- *A map colour the Judge picks, now* (`mapColor`): a field with no control on
  the sheet to set it (ROADMAP).
- *The colour by the domain's name*: a rename would move it.

**Cost:**
- Two sovereigns can hash to hues close enough to read as one.
- A painted region is named for its domain when it is made; a rename leaves
  the old name in the Regions tab, while the palette, the legend and the sheet
  read the current one.
- A hex painted into a domain since deleted stays painted, drawn grey, until
  the Judge erases it.

### Territory rows from the map (2026-10-25)

**Ruled:** a domain's territory is its stored rows and then one row read from
the map for each hex painted into it that no stored row's `map` names
(`territoryOf`). The stored row wins its hex; erasing a cell deletes no row,
and a stored row whose hex is no longer painted into this domain is marked
stale. A read row is written only by the Judge's Keep, which ties the hex to
a stored row naming no hex and covering one at most, where the Judge picks
one, or stores it as a row of its own. This is the ROADMAP's wave-3 bullet
("a painted row is read from the map, the stored row wins, and erasing a cell
never deletes a row") built ahead of the rest of the wave.

**Rejected:**
- *Writing a stored row on every paint*: a stroke across twenty hexes writes
  twenty rows nobody asked for, and erasing would then have to delete them.
- *A read row rendered as the stored row's named inputs*: the next submit
  would store it, a write by any edit of any other field.
- *A read row carrying families*: a painted hex says where the land is, not
  who lives on it.

**Cost:**
- The read walks every hex scene's domain regions on each render of the
  sheet, and the sheet re-renders on every stroke over that domain.
