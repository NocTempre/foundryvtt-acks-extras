# Factions — not built

Work that is designed but absent, deliberately. How the feature behaves now is
[MODEL.md](MODEL.md); why it is shaped that way is [DECISIONS.md](DECISIONS.md).

---

- **A body the page never sets its name apart for.** A row anchors on the
  `printKey` of a run the book set the name in, so a body named only inside a
  longer run of prose cannot be anchored at all — a box is geometry over runs,
  and nothing can cut a name out of the sentence carrying it. Four AX3 bodies
  are in this position: a labour guild, two patrician houses and a foreign
  monastic house. They reach a world as prose in another entry's description
  and never as a faction, and the people tied to them keep only the ties an
  anchored row can state. The unbuilt part is a Judge-facing way to make such a
  body by hand and have the import roster it.

- **People named only in the room-by-room writeups.** A settlement book runs
  its keyed places twice: once as a quarter's gazetteer entry and again, later,
  as a detailed writeup. The register covers the gazetteer everywhere and the
  writeups only where a quarter's own rows reach into them, so a person whose
  single statline sits in an unreached stretch has no row and cannot be
  rostered. Two who lead the packs of one concealed AX3 body are in that
  position, which is why it ships with a head and no members. Closing it is a
  reading pass per quarter, not a mechanism.

- **A holding the players should not see, authored in a register.** The model
  and the sheet already conceal a holdings row, and a Judge sets one by hand.
  What has no spelling is the REGISTER's: an organisation block takes its
  holdings as bare ids, so a recipe cannot say that the safehouse among a
  body's three roofs is the one a player is not shown. Giving holdings the
  `{id, hidden}` shape the roster already takes is the whole of the work.

- **A division inside a body.** One AX3 order divides into seven named
  divisions, each under its own head. The register has no `parent`, so the
  choice is seven sibling rows that lose the order, or one row that loses the
  divisions. It ships as one row; the divisions arrive as its description.

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
- **A map of who deals with whom.** Relations are read one sheet at a time —
  its own rows, and the reverse view beneath them. Nothing draws the whole web,
  which is the surface a Judge running a city with six organisations wants.
- **A relation between an organisation and a person.** What a guild thinks of
  one character is a ledger row and an attitude item, not a stance; a named
  enmity with a person has no row of its own.
