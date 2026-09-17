# Factions — not built

Work that is designed but absent, deliberately. How the feature behaves now is
[MODEL.md](MODEL.md); why it is shaped that way is [DECISIONS.md](DECISIONS.md).

---

- **A group organisation has no name left to read.** Blocking, and the shipped
  data is wrong today: a group organisation is a heading of the form
  `<Quarter> — <Organisation>`, so the body's PRINTED name was the second half
  of the group string — exactly what the aliasing pass took out
  ([importer DECISIONS](../importer/DECISIONS.md), "A printed proper name is
  not an identifier either"). The register now writes a neutral bucket there,
  so `organisationGroupOf` reads three quarters' `— Special Locations` as three
  bodies called that, and the roaming company, whose head lost its ` — <Name>`
  suffix entirely, binds to nothing. `tools/importer/test-faction-binding.mjs`
  fails on the count and is the tripwire: it is left failing on purpose.

  The shape of the answer is to retire the group-derived path — an organisation
  the book names is an authored `kind.organisation` row anchored by hash, which
  is what the other twenty already are. What is missing is authoring: 20 of
  AX3's 57 people are named by no row, the roaming company among them, and who
  belongs to which body is read off the page rather than derived.

- **Heat and laying low.** A `crime` row is recorded and shown as a prior
  record; nothing yet cools it with time spent out of sight, and nothing
  raises a search on the party's trail. Needs the crime-and-punishment
  figures, which are printed and arrive through the importer.
- **Prior-crime trial modifiers.** The rows are there to count; the
  modifiers a trial applies are printed values.
- **Several hunters in one quarter.** The board names the first faction that
  wants the party; a second is folded into the same flag. A card naming all
  of them wants a list on the board.
- **An organisation's keyed rooms.** A settlement book's hideout prints its
  rooms under the organisation's group; they land as pages, as they always
  did. Binding them as places under the faction's seat is the place binding's
  next consumer.
- **Standing on the character sheet.** A player has no view of what the
  factions hold about them beyond the reaction card; a read-only panel of the
  non-hidden rows is the obvious surface.
- **Notable residents who belong to a house.** A resident printed under a
  quarter's residents group joins no faction on import; the Judge rosters them
  by hand.
- **Relations and holdings from the books.** The importer's organisations step
  writes the seat and the roster; the places an organisation keeps beyond its
  seat, and whom it deals with, are left to the Judge. Both are printed prose
  rather than a structured group, so they need the binding to read a body of
  text and not a table.
- **A map of who deals with whom.** Relations are read one sheet at a time —
  its own rows, and the reverse view beneath them. Nothing draws the whole web,
  which is the surface a Judge running a city with six organisations wants.
- **A relation between an organisation and a person.** What a guild thinks of
  one character is a ledger row and an attitude item, not a stance; a named
  enmity with a person has no row of its own.
