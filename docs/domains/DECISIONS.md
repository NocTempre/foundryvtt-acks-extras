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
