# Magic items — Roadmap

What is not built. How the roll works now is `MODEL.md`.

- **The Judge's roller dialog, card and macro: waits on a /design approval.** The
  service (`roll-service.mjs`) and the `magic-item-roll` contract are built and have no
  window: a Judge reaches a roll only through the API. The window (style, category and
  rarity pickers over `starts()`, nothing offered for a list that was not imported),
  the Judges-only chat card (a row per step, the list's page in each total's tooltip,
  "set by hand" where a Judge overrode the list, a footnote for a flagged item) and a
  macro that opens it are held until a design is approved
  (`.claude/rules/ui-layout.md`, "Design before build"). A Token controls button waits
  on the owner's ruling as well.
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
