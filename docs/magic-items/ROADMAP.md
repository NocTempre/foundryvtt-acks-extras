# Magic items — Roadmap

What is not built. How the roll works now is `MODEL.md`.

- **The scroll, treasure-map, creature-type and arms tables are not walked.** They are
  in the `magicItemTables` document; `walkChain` follows the classic category and the
  heroic rarity lists only. Each is a follow-up that adds its own start and its own
  step shape.
- **One copy of the Foundry roller.** `foundryRoller` here and the treasure hoard
  generator's roller are the same few lines. Move the roll check into `scripts/lib/`
  once the treasure topic lands, and delete both copies.
- **A Judge's override of one classic list replaces its whole table** (lib's per-table
  layering), so the table's other lists leave `starts()` and cannot be rolled by
  category. A per-list override layer would keep them.
- **A linked item.** `item.uuid` is reserved and always null; a slice that links an
  imported item fills it.
- **No sheet or control calls the roll yet.** The Judge reaches it through the
  macro "Roll a Magic Item" and the API. `acksExtras.magicItems.rollAndPost` takes
  the style, category and rarity without the window, for a sheet or a control that
  wants to roll in place; none has been built.
