# Magic items — Decisions

## 2026-11-17 — A `magic-items` feature rolls the imported item tables

The owner's goal: "letting the TT effort start to get those tables of items (and
magic items!) going too". The Judges Journal's and the Treasure Tome's item
generation tables are imported as the `magicItemTables` registry document
(`docs/importer/MODEL.md`, "The magic-item and arms tables"); this feature is the
consumer that rolls them.

**Ruled.** The feature's slug is `magic-items`, lang root `ACKS-MAGICITEMS`, because
`docs/magic/DECISIONS-through-v11.14.5.md` ("Three features, one vocabulary",
2026-09-24) names `magic-items` ("the item model, powers, charges, use,
generation") as the second of magic's three features, and a roll that generates an
item is its generation. It is not part of `magic` (the spell primitive).

The first slice is the chain walk and the service, with no window:

- **The walk is a pure module** (`chain-logic.mjs`). The tables and the roller are
  arguments, the die of every roll is read off the list's own bands, and nothing
  that can be wrong in a table throws: a list that does not tile, a roller that
  answers another die and a hop that leads nowhere each end the walk with a named
  code and the steps already rolled.
- **A hop is followed only where the importer wrote one.** A list is a hop list
  when a band holds a `hop` key of its own. A band of such a list without a string
  hop is flagged `unresolved-hop`, never read as an item: dropping a RollTable
  re-ranges a row and deletes its `hop`, and the walk reports that instead of
  returning the row's words as if it were a finished item.
- **The roll is offered as a `services` contract**, `magic-item-roll` v1
  (`docs/lib/API.md`), so a consumer outside this feature (the treasure hoard
  generator) rolls an item without importing it. `uuid` on the item is reserved,
  always null, for the slice that links an imported item.
- **Per-list cites.** The document's `cites` name a whole table's pages, and
  `classic` holds eight lists. The importer records each list's pages beside the
  captions (`listCites`, `docs/importer/MODEL.md`), so a roll's tooltip points at
  the page the list was read from, and at the Tome where its version replaced the
  Journal's.
- **The roller is `roll(expr) -> {total, sides}`**, and the walk checks `sides`
  against the die it asked for. The few lines that turn a Foundry `Roll` into it
  (`foundryRoller`) are written here; the treasure topic's hoard roller has a
  second copy, which is not in this tree. One copy belongs in lib.

**Rejected.** Drawing from the projected RollTables (`drawQuietly`): the RollTable
holds a tail as one result per outer band and loses the nested die, and a hop
survives a drop only where the same range stood. A roll card template with its own
CSS, instead of the shared card. Lang keys for the rarity and category names: they
are the Judge's captions, from the book. A coarse table-level cite for a list.

**What it cost.** A second place that writes the document's id (`MAGIC_ITEM_DOC`,
pinned to the importer's by `tools/test-magic-item-roll.mjs`), and a second copy
of the Foundry roller until lib has one. The gritty style starts at the heroic lists,
the only rarity lists the document holds. A Judge's override of one list replaces its
whole table (lib's per-table layering), so the table's other lists leave `starts()`.

## 2026-11-17 — The roller is a macro and an entry point, with no Token controls button

The owner approved the roller's design ("I approve the UI for the roller"): a window
"Roll a Magic Item", GM only, with a Style, a Category and a Rarity select, a hint
that the card is whispered to the GM, and Cancel and Roll; and a card whispered to the
GM with a row per chain step and a strip for the item. On the control: "Roller is macro
only, but it might get called by UI elements later."

**Ruled.** The macro "Roll a Magic Item" opens the window; there is no Token controls
button. The roll and the post are one callable function, `rollAndPost`
(`acksExtras.magicItems`), and the window's Roll button calls it, so a sheet or a
control added later calls it without the window. The window has no Reroll button.
The item strip is a section of the card of its own (lib's card has no slot for one),
and a step's row text sits under the list's caption.

**Rejected.** A Token controls button now. A card template with CSS of its own (the
2026-11-17 ruling above already rejected it for the shared card).

**What it cost.** The Judge reaches the roll from the macro bar or the compendium, not
from the canvas. The item strip repeats the card's column headings over a table of one
row.
