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

Answered 2026-11-17 (importer DECISIONS, "The Treasure Tome wins whole"):
A "Whole tables", C "The Tome's", E "Only flagged ones". F (below):
"Roller is macro only, but it might get called by UI elements later." B is
open.

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

**2026-11-17: S0, S1 (as S1a and S1b), S2 and S4a landed on `main`** (not
pushed): S1a `28e3635c`, S1b `8fe8c29f`, S2 `c0c9f54a`, the walk `2d80da5d`,
S4a `74c87fa1`.

- Offline, on the local books: `check-treasure-tables` reads 20 Journal
  tables (13 band lists tile) and the Tome side; `check-magic-item-tables` reads
  34 lists that tile, 8 of 8 Random Type rows resolving; every Journal row count
  agrees with the wiki oracle; `test-recipe-pages` 2974 checks; `npm test` 251
  suites; validate green.
- S0's probe: the shipping extractor gives no U+008D or U+FFFD in any Tome
  table region, so `books.mjs` `tt` needs no glyph. Recto and verso pages take
  two geometries. The Tome's small-capital initials extract as lone lower-case
  runs (`smallCaps`).
- Built beyond the slice lines, on a consumer's request (the treasure plan's
  hoard generator): the coin columns' unit (`typeUnits`), each special list's
  lot unit (`specialPer`) and the gem and jewelry dice legends.
- Live, lane C (`FIXTURE_OWN=tt`, so recorded partial):
  `tools/live/importer-treasure-tables.mjs` passed 21 of 21 with the Journal and
  the Tome connected (the import, both documents' counts and tiling, the Tome's
  cite where it layers and the Journal's where it does not, the Browser's
  entries, two exported RollTables against their bands, the Player seat's read).
  A one-off probe of S4a's `magic-item-roll` service with Foundry's own dice:
  classic two steps, one with a category, heroic and gritty one each, no rarity
  refused, a rigged top face rolling the tail's inner die, every step carrying
  a caption and a cite.
- Not walked: the edit-and-drop steps of both TESTING sections and a
  Journal-only seat (the downgrade guard).
- Findings, not fixed here: a Judge's override of one classic list replaces the
  whole `classic` table (lib's per-table layering), so the other lists drop out
  of the roller's choices; BtA's `wrapRows.boxed` and this plan's
  `wrapRows.centered` may fold into one mode, with the two table gates as proof.

Next: S4b landed (9e6bc718) and walked 27 of 27 on `main`. F is answered:
the roller is macro only, with `rollAndPost` callable by later UI (the owner,
2026-11-17). On the owner's instruction to keep building unsupervised, S3, S6
and S8 are built ahead on `topic/importer-books` under
`scripts/importer/books/tt/` ("They should be building separate importer files
per book"), committed per slice and not landed. The branch lands first after
the coming minor is tagged (the owner, 2026-11-17: "A lot of changes hanging
open. Needs to be a cap that now is clearly past."; landing order "Yes, land in
order"), then walks on `main`. A, C and E are answered. The code already landed
stays where it is until the owner's cleanup. D was closed by the treasure plan.

S6 status (2026-11-18): every Tome entry heading has a register row. The batches are S6a-S6k, 1220 rows, under `register/tt/p<a>-p<b>-items.json`, each landed from `topic/importer-books` and walked on `main` (`tools/live/importer-magic-items.mjs`, 59 of 59). The S6j+S6k walk first failed step 11 twice. The join's shelf restore reopened the Tome after the walk closed it, because the Tome now sits on the world's shelf. The walk now waits for that restore before it connects books, and the restore skips a book already open (T-0675).
- **Names.** Headings follow ruling E. A cleared heading ships its common name; a heading with a figure, a printed proper name or an undecided spelled number ships as `Item <n>` with the census key as its anchor hash.
- **Coined entry names.** The owner ruled on 2026-11-18 that a coined monster or spell entry name ships as the thing's name. Two items the name pass had held in doubt cleared under it.
- **Variant entries.** An entry that prints two or more header labels is variant-led and carries `values: []` by design. No figure is located for it; the imported description carries the labels. verify-cookbook therefore prints `located=[]` for it. There are 15 such rows.
- **Coverage anomaly.** The whole-book `census-rows check tt --pages 55-287` lists S6c's ordinals 207-212 (PDF 93) outside the coverage band, at 0.45-0.66 for three and 2.8-3.7 for the other three. A word count over each entry's own column region matches the compiled text for all six, within the heading's words. The census measure splits that page's regions differently from the compiler, and no text is lost. Coverage outside the band is batch evidence, never a defect on its own: count before acting.

Book recipes in shared files: `resistanceProse` and `squeezingProse` (landed from main, 6cac2c8a and 78434f38) moved the `rr` silo baseline from 161 to 163. They are Revised Rulebook recipes and belong under `scripts/importer/books/rr/` at the owner's cleanup.

Next: S8, the Journal's ch. 4 entries under `kind.magicItem` with the Journal-Tome pairs (ruling C). A local census found 158 items, of which 140 pair by heading key and 18 are reprints. The Journal needs its own page bands (`books/jj/`). The seed must learn that the Journal prints its labels at an entry's end. After S8, the treasure-art seam and the MM harvest.
