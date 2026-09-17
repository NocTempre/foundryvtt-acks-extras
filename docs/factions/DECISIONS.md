# Factions — decisions

Dated rulings: what was ruled, what was rejected, what it cost. Append-only;
how the feature behaves now is [MODEL.md](MODEL.md).

### A relation is a stance and a note (2026-09-17)

**Ruled:** how one organisation regards another is a row of
`{stance, note, hidden}` on the organisation holding the opinion, where the
stance is one of five labels — allied, friendly, neutral, rival, hostile — that
nothing reads as a number. Relations are directed: the other side's view is its
own row on its own sheet.

**Why.** A stance is the same kind of thing as `kind`: a word the Judge picks
so the table can see at a glance who deals with whom. The moment it carries a
figure it is a reaction modifier the books do not print, and the ruling above
about the ledger applies to it unchanged. Directed rather than symmetric,
because two organisations misreading each other is the interesting state and a
symmetric edge cannot hold it — a guild that believes the syndicate is friendly
while the syndicate has written it down as prey is a scene, not a data error.
The reverse view is derived (`regardedBy`), so neither side's row is a copy of
the other's and neither can drift.

**Rejected:** a derived score between organisations (friendliness 0–100, or a
stance that sums with the ledger). Every rung of such a ladder is a value
nobody printed, and it would put an invented figure on a reaction throw beside
the Judge's own. **Rejected:** one shared edge per pair — it cannot hold a
disagreement, and it makes both sheets the owner of one row.

**Cost:** a Judge who wants a mutual alliance writes it twice, once on each
sheet. The reception dialog says the stance and adds nothing, so a Judge who
wants a rivalry to cost something must also write a ledger row.

### A ledger row can be about an organisation (2026-09-17)

**Ruled:** `faction` joins `all`, `party` and `character` as a standing
subject scope. A row about an organisation counts for every side that answers
for it — the organisations rostering the speaker, and the speaker itself when
it is one — which the subject set carries as `factionUuids`.

**Why.** The numeric side of a rivalry has to flow through the ledger the
Judge already writes, or it needs a second record with its own arithmetic and
its own place in every reader. One scope carries it: `standingFor` counts a
faction row exactly as it counts a party row, so the hunt, the market shift and
the reception price a standing feud with no new code. Members inherit it the
way party members inherit a party row, which is the behaviour a Judge who wrote
"−3, the guild" already expects, and is why the relation stance stays a label —
the figure has a home.

**Rejected:** a per-pair modifier stored on the relation row. That is the
rejected score of the entry above wearing a different name, and it would sit
outside every reader that already sums a ledger.

**Cost:** the subject set now takes a scan of the world's factions, one per
call, on a path that runs at every reaction roll.

### A faction holds places; the seat is one of them (2026-09-17)

**Ruled:** `seatUuid` stays the principal seat and `holdings` carries every
other place the organisation is behind the door of, each with a note and a
Judge's hidden flag. A place already held — the seat included — is refused
rather than listed twice. `factionsAt` reads seat and holdings alike;
`factionsHolding` answers for one place with no ancestor standing in, and is
what a location's own sheet asks through the api.

**Why.** An organisation with one roof was the shape of the first pass and it
was wrong the moment a guild had a hall and a warehouse: a second seat meant a
second faction, which splits its roster, its ledger and its relations in half.
The seat is kept as its own field rather than folded into the list because
every existing reader names it, because a place's sheet wants to say "seated
here" and not merely "one of several", and because the importer's binding
writes it. The location sheet reads the list through `acksExtras.factions`
rather than importing the feature, so a world without factions renders no
section and the location feature keeps its one family edge.

**Rejected:** a faction per building, related to the others by `parentUuid` —
it makes the parent chain a map of real estate and puts the roster on the wrong
document. **Rejected:** storing the pointer on the PLACE instead, as a flag —
a place is the thing more likely to be deleted, duplicated or imported, and the
organisation is the one that knows what it keeps.

**Cost:** two fields answer "where is it", so every reader has to ask
`holdsPlace` or `placeUuids` rather than comparing `seatUuid`.

### Standing is a ledger of the Judge's values; RAW has no score (2026-09-16)

**Ruled:** a faction's standing toward the party is a ledger of rows the
Judge writes — a signed value, a reason, a source, a subject — and every
reader sums the rows that name its subject. Nothing derives a number: no
band, no decay, no scale from favour to enmity.

**Why.** The rules price a reception with modifiers and a hiring with a
market class, and never print a reputation figure to move either by. A score
the module invented would be a rule the book does not have, wearing the shape
of one it does; a ledger of typed values is the Judge's own record, and the
sum is arithmetic on it. The recruitment feature's slander registry — the
per-town penalty a refused offer earns — was the shape already built for this
and is the shape kept: rows, not a number.

**Rejected:** a numeric reputation derived from events (a crime costs N, a
favour earns M) — every N is a printed value or an invented one. **Rejected:**
storing the party's attitude toward the faction here — the influence feature
already keys an attitude item to any actor, and a faction is one.

**Cost:** a Judge who wants standing to move a market has to say what a step
is worth; the setting defaults to nothing.

### A faction is an Actor sub-type (2026-09-16)

**Ruled:** `acks-extras.faction`, a TypeDataModel on Actor, seated in a
place and rostering members with the same row a place keeps.

**Why.** Everything an organisation needs to be dealt with — a sheet, a
folder, a compendium shelf, a drag onto another sheet, an attitude item keyed
to it, a reaction roll opened against it — exists for actors and for nothing
else. A journal page has none of it; a flag on a place would make a guild
with three halls three factions. The roster row is lifted into
`scripts/lib/fields.mjs` rather than copied, because a place and a faction
roster the same people.

**Cost:** a sub-type is read by the server at world launch, so the release
carrying it needs a relaunch, and the release is a major.

### The slander row stays with its holder (2026-09-16)

**Ruled:** the recruitment feature keeps pushing its slander row from
`openInfluenceFor`, and does not move to the modifier hook.

**Why.** The hook's contract (`docs/influence/MODEL.md`) is that a consumer
holding the roll passes its rows directly, and the hook is for a consumer
that only knows the surroundings. The hiring roll is held by the recruitment
feature; its slander row is a fact about the hiring, not about where the
party stands. The plan had it moving; the contract ruled otherwise, and the
two routes add.

**Cost:** a reader of the reaction card sees two feeds for two kinds of row.
The MODEL says which is which.

### Kind matters once, and it is the Judge's (2026-09-16)

**Ruled:** the faction's `kind` is a label the Judge picks, and the only
mechanic that reads it is the authority row — a `watch` or `noble` faction
controlling the district and rostering the character. The importer lands
every organisation as `other`.

**Why.** What a hideout or a cult is to the law is a reading of the book, not
a structure the register prints; the module has no business deciding it. One
mechanic reads the kind because a character speaking for the law is a thing
the Judge needs to see on the dialog before ticking authority, and a note
with no figure is the whole of what the book supports. The roller dropped
every zero row, so the hook's contract grew the `note` mark for it
(`docs/influence/MODEL.md`, "The modifier hook") rather than the label
carrying an invented figure to survive the filter.

**Rejected:** per-kind reception modifiers — printed values.

The market's rarity overrides, which landed with this phase, are the henchmen
feature's ruling (`docs/henchmen/DECISIONS.md`); the hunt's cadence is the
formation feature's (`docs/formation/DECISIONS.md`); the organisations the
importer binds are the importer's (`docs/importer/DECISIONS.md`).
