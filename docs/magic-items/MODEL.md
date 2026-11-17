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

## The entry point, the card and the window

- `rollAndPost({style, category, rarity, from, roller, tables})`
  (`chat-card.mjs`) is the one call that rolls and posts: the window, a macro and
  any sheet that wants an item go through it. A seat that is not a GM's is
  refused (`gm-only`) with a notification. A roll that cannot begin, or that stops
  before its first step, posts no card and says why in a notification (a world
  with nothing imported adds, from lib's `missingTablesList`, the documents it
  still lacks, never a figure). A walk that stops after a step, or an item the
  chain could not follow to its end, posts the steps it has with a footnote. It
  answers `{ok, reason?, result, message}` and does not throw on the tables'
  content or on a failed post (`post-failed`).
- The card is `chainCard(result, {loc, style})` (`card-model.mjs`, pure) rendered
  by lib's `renderRollCard`, and posted by `postToJudges`: whispered to every GM,
  its dice in its content, never public. A row per step: the list's caption, the
  roll (`1d100 = 57`, or `face › inner` for a nested tail) and the row's text beneath
  the caption; then an "Item" section holding the final text; then a footnote for
  a flagged item or a stopped walk. A total's tooltip joins the parts that exist: the
  die, the band the roll landed in, and the list's page, or "Set by hand" where the
  list is overridden. A list with no page recorded adds nothing in its place.
- `openRoller({tables})` (`roll-dialog.mjs`) opens "Roll a Magic Item", GM only: three
  selects (style; category, opening on "Roll the type" and then each imported classic
  list by its caption; rarity, the imported heroic lists by caption), a hint that the
  card is whispered to the GM, and Cancel and Roll. Roll calls `rollAndPost`. The
  category picker is switched off under Heroic and Gritty and the rarity picker
  under Classic (`roller-options.mjs`, pure: `rollerContext`, `appliesTo`,
  `rollArgs`). A list the import did not read is a disabled option marked "not
  imported"; a world with nothing rollable gets the notification and no window.
  Cancel answers `false`. The macro "Roll a Magic Item"
  (`tools/pack-data/magic-items.mjs`) opens it, and no Token controls button does.

## What the feature publishes (`scripts/magic-items/module.mjs`)

- `init`: the `magic-item-roll` contract, `{roll: rollMagicItem}`
  (`docs/lib/API.md`), and `acksExtras.magicItems = {apiVersion, roll, starts, rollAndPost, openRoller}`.
- `setup`: `expectTables("magicItemTables", ["classicType", "classic", "heroic",
  "captions"])`, so the missing-tables notice names what an import lacks.
