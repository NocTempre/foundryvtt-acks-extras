# Importer: the Treasure Tome's tables and items (wip plan)

**Status:** plan, written 2026-11-16 by the session working `topic/tt-importer`
(worktree `foundryvtt-acks-extras.tt-importer`). Each slice below is built on
that branch, landed with `branch.mjs land tt-importer`, and walked on `main`.
Results are appended under "Results". This file is deleted when the last
slice has moved its substance into `docs/importer/{MODEL,DECISIONS,ROADMAP,TESTING}.md`
and `docs/magic-items/`.

The owner, 2026-11-16: "letting the TT effort start to get those tables of
items (and magic items!) going too."

## Standing orders this work changes

- Importer DECISIONS 2026-11-11, "Treasure is read from the Judges Journal,
  and the Treasure Tome is a layer over it", says "The wave order 3 to 8
  stands". This plan runs wave 7 ahead of waves 3 to 6.
- Magic DECISIONS 2026-09-25 orders 2 and 4a before 1b, with 4b after 4a.
  This plan reads the TT's tables (4b's reader) before 4a's `magicItem` flag
  exists.

The new evidence for both is the owner's goal above. The branch's first
DECISIONS entry quotes it and names both entries. To leave 4a's design to the
magic work, no slice here writes `flags["acks-extras"].magicItem`: items use
stores that exist (`flags.acks-extras.markets`, core's fields, the cookbook
stamp).

## Where it stands (gap table)

| Family | JJ prints (ch. 4) | TT prints | Built | Consumer today |
| --- | --- | --- | --- | --- |
| Treasure Type, Classic / Heroic | yes, A–R | yes, A–R | no | monsters `details.treasure.type` (a letter); formation encounters `treasureByTerrain` (letters) |
| Treasure Type, Gritty | no | yes | no | none |
| Gem value, jewelry value | yes | yes | no | none |
| Special treasures (11 tables) | yes | yes | no | none |
| Random magic item type (classic) | yes | yes | no | none |
| Category tables (classic) | one per category, item rows | rarity-banded subtables per category | no | none |
| Rarity tables (heroic / gritty) | five, item rows | five, subtable rows (two stage) | no | none |
| Arms and armour type tables | yes | yes | no | none |
| Magic item market tables | transaction by market class; availability by market class | adds by rarity, by type | JJ's transaction and price prose (`TABLE_RECIPES.magicItems`) | markets `magicItems/*` |
| Item traits | yes | appendix B | no | none |
| Item entries | about 150, prose | over 1,300, header line plus prose | no | none (no `kind.magicItem`) |
| Item creation, appendices A, C to F | partly (ch. 14 math) | yes | no | none |

The pdftotext hazards in the inventory do not carry over: the shipping
extractor gives proper Unicode on twelve sampled pages. One open glyph
(a lone control character at a column's left edge on 5 of 64 entry pages) is
probed in S0.

## Design

- **A generation table is rules data, projected as a RollTable.** Recipes go
  into `TABLE_RECIPES` (registry docs, read at import into the world layer,
  band edges off the page), projected by `location/table-docs.mjs`
  `COLUMN_GRIDS`. Not `kind.rolltable`, which is for a chart only the Judge
  rolls (importer DECISIONS 2026-09-23, "A Judges Journal chart has one source
  and at most two projections"). Doc ids: `treasure` (treasure types, gems,
  jewelry, special treasures) and `magicItemTables` (the item chain, arms and
  armour); `magicItems` stays markets'.
- **The layer unit is the table.** A recipe gains `over: {book: "tt", …}`:
  where the TT is open and the page locates, its whole table replaces the
  JJ's under the same id. TT-only tables (Gritty, the banded subtables, the
  extra market tables) take their own ids, `optional: true`. JJ-only tables
  stay. A re-read on a seat without the TT keeps a table whose stored cite is
  the TT's. Row merging is rejected: a re-banded d100 table merged row by row
  overlaps.
- **A chain is walked, not linked.** A row whose text names another table in
  the doc is a hop, matched by `printKey` against each table's caption as
  read, with an `alsoKey` where the spelling drifts. One walker serves the
  JJ's two stages and the TT's three. Its home is `scripts/magic-items/`
  (magic DECISIONS 2026-09-24, "Three features").
- **Names.** Common-phrase captions may be `locate` anchors; a caption that
  holds a proper name uses `locateHeadingKey`; no anchor holds a figure. Rows
  are read at import. Committed tests use invented captions and items.
- **A magic item** (later slices): core type by category (`weapon`, `armor`,
  `item`); a new `kind.magicItem` reusing the adventure-item name-line flow
  plus header-line `values` into `flags.acks-extras.markets.{magic, kind,
  rarity, baseCostGp, apparentValueGp}`; activation stays in the description
  until 4a. Ids `tt.item<n>`, per the 2026-11-11 ordinal ruling. A row links
  to its item by `printKey` against the entries' heading hashes.
- **A "+N" reaches a roll through core's fields**: the import writes
  `system.bonus.attack`, the damage formula and `system.ac.value` from a
  per-entry located value over the base row a register `base` key names. A
  `magicBonusParts` source in `equipment/printed-layers.mjs`, registered
  beside `masterworkBonusParts` through lib's `registerItemBonusSource`,
  carries the typed part; no lib edit. Worn grants and "vs X" bonuses wait
  for the grants proposal's ruling
  (`wip/20261029-item-grants-as-effects-design.md`, not in effect).

## Slices

| # | Scope | Agent, and why | Owner answer | Walk |
| --- | --- | --- | --- | --- |
| S0 | Probe the shipping extractor on the TT: side-by-side subtable x-windows, sidebar runs inside bands, caption heights, the header line's runs, how many subtable rows key to an entry heading, the lone glyph | `scout` (lookup, no judgment) | none | no |
| S1 | JJ base tables: treasure types (classic, heroic), gems, jewelry, special treasures, random item type, classic category tables, heroic rarity tables, arms and armour. New `scripts/importer/table-recipes-treasure.mjs` joined into `TABLE_RECIPES`; `COLUMN_GRIDS` rows; gate `tools/importer/check-treasure-tables.mjs` (every row found, bands tile the die, hops resolve to one table); TESTING recipe | `implementer` (scoped, the recipe pattern exists) | none | yes, Ruledata Browser and the projected RollTables, from the seat's own JJ |
| S2 | The TT layer: `over` and the downgrade guard in `tables-binding.mjs`; the TT's same-shape tables and Gritty | `implementer` | A for the different-shape tables only | yes |
| S3 | The TT's banded subtables, in three batches (potions, rings, scrolls; implements, miscellaneous; swords, weapons, armour). TT has no wiki oracle, so band tiling and hop resolution are the self-check | `implementer` per batch | A | yes |
| S4 | Chain walker and a "Roll a magic item" control in `scripts/magic-items/` (`ACKS-MAGICITEMS`, `docs/magic-items/`) | `architect` for the feature skeleton, then `implementer` | none | yes |
| S5 | Moved: the hoard generator and its entry points are T4 and T5 of `docs/treasure/wip/20261116-treasure-table-plan.md`, a new `treasure` feature, which answers D. That plan deals from this plan's S1 tables and calls S4's walker | — | — | — |
| S6 | TT entries: `register/tt/`, `register/_kinds/magicItem.json`, compiler branch, `scripts/importer/cookbook/magic-items.mjs`; `books.mjs` `tt` gains `judge: true` and a glyph only if S0 proves one | `architect` first (new kind), then `implementer` batches | C, E | yes |
| S7 | "+N" arms and armour into core fields; `magicBonusParts` | `implementer` (touches equipment, coordinate with magic) | none past S6 | yes |
| S8 | JJ ch. 4 entries under the same kind | `implementer` | C | yes |

Built first, with no owner answer: S0, S1, and S2's same-shape tables.
Shared files (a BtA session also edits them; message before the first edit):
`table-recipes.mjs` (one join line), `books.mjs` (`tt` only), `cookbook/*.json`
(generated: take `main`'s side at a rebase and regenerate),
`docs/importer/ROADMAP.md` (wave 7 only). `scripts/lib/` and `scripts/magic/`
are not touched; a slice that needs them stops and reports.

A second finding, outside this branch: `kind.rolltable` ships band edges as
section keys, which the template's 2026-08-15 owner correction ("band edges
and modifier values are content and need importing") may forbid. Undetermined,
to be registered; these slices add none.

## Owner questions

- **A.** When the TT is open, does its whole table replace the JJ's, including
  where the TT splits a JJ table into a chain of subtables? Recommended: yes,
  whole tables. Counter (moderate): a JJ row the TT's reprint drops is lost.
- **B.** With the TT open, do markets price and stock magic items from its
  rarity- and type-keyed tables? Recommended: yes, as a later markets slice.
  Counter (moderate): a world's prices shift the moment a book is connected.
- **C.** When both books print the same item, does the library keep the TT's
  entry? Recommended: the TT's. Counter (moderate): the magic scoping and
  `books.mjs` `keptBook` today keep the JJ's.
- **D.** Answered by the treasure plan (S5 above): a new `treasure` feature.
- **E.** Does every TT entry ship a neutral label and a heading hash, or only
  an entry whose heading holds a figure or a proper name? Recommended: only
  those, since spells and equipment ship their common names and an entry
  picker would otherwise show neutral labels until import. The design's
  architect recommended every entry. Counter (strong): one rule for 1,300
  entries cannot miss a name a reviewer would.

## Results

(Appended by each slice.)
