# Magic items — Model

How a magic item is rolled from the imported tables, now. The ruling for the
slug and the shape is `DECISIONS.md`; the tables themselves, and how they are read
from the Judge's copy of the books, are `docs/importer/MODEL.md` ("The magic-item
and arms tables"). The feature ships no table, caption, band edge or page: with
nothing imported a roll answers `not-imported` and shows no figure.

## The document it reads

Registry document `magicItemTables`, read per table through lib's layered
registry (`getDoc`, so a Judge's override wins per table). The tables a roll
touches:

- `classicType.bands`, the list that picks a category: each band `{min, max, item,
  hop}`, `hop` the id `<table>.<column>` of the category list the row names, or
  null.
- `classic.<category>` and `heroic.<rarity>`: lists of items, a band `{min, max,
  item, ...cells}`; a tail of the die is a band `{min, max, sub: [inner bands]}`
  (the outer face, then a roll on the inner bands' own die).
- `captions` (`{<list id>: caption as printed}`) and `listCites` (`{<list id>:
  cite}`, the pages the list was read from).

A list id is `<table>.<column>`. The scroll, map, creature-type and arms tables are
in the document and are not walked.

## The walk (`scripts/magic-items/chain-logic.mjs`)

`walkChain({tables, from, roll, maxHops})` rolls the list `from`, and while the
band it landed on names another list, rolls that. Pure; the roller is
`roll(expr) -> {total, sides}`, sync or async.

- A list is rolled only if its bands tile from 1 with no gap or overlap and every
  edge is a whole number (`bands-untiled` otherwise). The die is lib's `bandDie`
  of the bands; the roller's `sides` must equal the top band's edge
  (`die-mismatch`) and the total lie in 1 to that edge (`roll-out-of-range`); the
  band is lib's `bracketRow`. A roller that throws or answers nothing is
  `roll-failed`. A list that is not in the tables is `not-imported`.
- A band with `sub` rolls its inner bands the same way, on their own die, and the
  step records `inner`; the item is the deepest band.
- A list is a hop list when any band, or inner band, carries a `hop` key. In one,
  a string hop is followed; a band without one is flagged `unresolved-hop`, a hop
  to a list already rolled `cycle`, one past `MAX_HOPS` (8) hops `too-deep`, one to
  a list the tables lack `missing-list`. A flag keeps the item reached; the walk
  never throws on content.
- Result: `{steps, item, error}`. A step is `{list, die, total, band: {min, max},
  inner?: {die, total, band}, fields}`; `fields` is the deepest band without
  `min`, `max`, `sub` and `hop`. `item` is `{list, text, fields, flag, hop?,
  uuid}`, `text` the `item` field or the first text field, `uuid` null (reserved
  for a linked item). `error` is `{code, list}` and `steps` holds what was rolled
  before it.

## The service (`scripts/magic-items/roll-service.mjs`)

- `readTables()` is the merged `tables` of the document, null while no layer holds
  it.
- `startOf({from, style, rarity, category})`: `from` wins; `classic` starts at
  `classic.<category>`, or at `classicType.bands` with no category; `heroic` and
  `gritty` start at `heroic.<rarity>` and refuse without one (`rarity-required`);
  any other style is `unknown-style`.
- `describeList(id)` is `{caption, cite, overridden}`. `overridden` is true when
  the registry's override layer holds the list's table, and then `cite` is null (a
  Judge's hand has no page). Otherwise `cite` is `tables.listCites[id]`, else the
  table's own cite (lib's `citeOf`).
- `rollMagicItem({from, style, rarity, category, roller, tables})` answers `{ok,
  reason?, start, steps, item, error?, rolls}`; each step is the walk's with its
  `caption`, `cite` and `overridden`. `reason` is `not-imported`, a start refusal
  or the walk's error code. The default roller evaluates a Foundry `Roll` and
  answers `sides` from its first die's faces, keeping each `Roll` in `rolls`.
  `tables` replaces the registry read (tests, the live walk).
- `starts(tables)` is `{classicType, classic: [{key, id, caption}], heroic: [...]}`
  for a roller window to list; a list the import did not read is absent.

## What the feature publishes (`scripts/magic-items/module.mjs`)

- `init`: the `magic-item-roll` contract, `{roll: rollMagicItem}`
  (`docs/lib/API.md`), and `acksExtras.magicItems = {apiVersion, roll, starts}`.
- `setup`: `expectTables("magicItemTables", ["classicType", "classic", "heroic",
  "captions"])`, so the missing-tables notice names what an import lacks.
