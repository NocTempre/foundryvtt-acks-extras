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

- **A count the page states in a sentence.** The strength block reads a
  printed GRID; a body whose numbers the book gives in prose — a watch's men
  per gate and per patrol, an order's clergy by house, a garrison stated in a
  district's overview — has no grid to read and ships with an empty table. Five
  AX3 bodies are in that position. Closing it is either a Judge typing the
  rows (the sheet supports it now) or a prose-value op that reads a number
  after a phrase the recipe locates by geometry, not by the phrase's words.

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
- **The target's standing on a roll opened from a sheet.** The roller's
  modifier hook is handed the target a caller names and nothing else, while the
  page finds its target from the targeted token after it opens. A roll opened
  from the Influence button therefore carries the quarter's rows and never the
  rows or the relation note about the target; those arrive only through
  `acksExtras.influence.open(actor, {targetActor})`. Handing the hook the
  target the page finds is the small half. The other half is a ruling: a
  membership can be hidden, and a row named after the organisation a target
  secretly belongs to would tell a player's dialog what the roster hides.
- **Standing on the character sheet.** A player has no view of what the
  factions hold about them beyond the reaction card; a read-only panel of the
  non-hidden rows is the obvious surface.
- **A map of who deals with whom.** Relations are read one sheet at a time —
  its own rows, and the reverse view beneath them. Nothing draws the whole web,
  which is the surface a Judge running a city with six organisations wants.
- **A relation between an organisation and a person.** What a guild thinks of
  one character is a ledger row and an attitude item, not a stance; a named
  enmity with a person has no row of its own.
- **The syndicate's consignment service.** A body marked
  `services.smuggling` (the AX3 import names one) carries a party's loads past
  the gates for the terms the city-travel document's `smuggling` table
  imports: a monthly cap, a fee on the goods' value, an interception chance,
  and an arrival in a rolled number of days at one of its places. The shape
  drawn on 2026-09-30: `consignments` rows on the faction holding the loads'
  snapshot from `acksExtras.markets.removeLoads`, the fee spent through the
  gold adapter, delivery on the world-time watcher by `createEmbeddedDocuments`
  onto the chosen place stamped for the trader, an intercepted consignment
  reported to the Judge. The thief's smuggling hijink is the domains module's
  and is not built here.
