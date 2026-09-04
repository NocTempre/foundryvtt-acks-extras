# Character sheet — roadmap

What is designed and not built. Everything here is deliberately absent from
the code, not missing from it; the rulings behind the built half are
[DECISIONS.md](DECISIONS.md).

---

## From the design canvas

- **Hex rails (option D).** The six cells a side drawn as the printed sheet's
  saving-throw hexagons, staggered the same way both sides and overlapping
  the portrait by a quarter hex; the far-right tools rail stays square. Costs
  recorded on the canvas: a strip 53px wide instead of 38, a hex's corners are
  dead click area, a fill rising inside a hexagon reads less precisely, and
  the row carries two cell shapes. A middle path — hexes for the saves only —
  was floated and not ruled on.
- **Option B (medallion header) and option C (vitals strip)** stay lo-fi
  boards on page 2 of the canvas. Neither was chosen.
- **Pick slots on the training list.** The canvas drew dashed drop targets for
  a class's "any five" broad pick, "any three" narrow pick and the four
  restricted weapons of a caster's list. A pick that is a set of weapons is
  now expressible — the Stats editor writes single weapons into the grant —
  but nothing records HOW MANY a class may pick or which tier the picks
  belong to; the slots need that count, which is the book-picks table below.
- **The book's six weapon categories.** The lib's `SLOT_VOCAB` (eight classes,
  bows and crossbows split, an unarmed chip) is what the Stats tab renders;
  the canvas's "raw" note asks for the six narrow categories of the book.
  Cross-feature: the follower card, the inventory strip and the
  class-modifiers editor share the vocabulary.
- **Undrawn boards**: the Magic tab and a caster's Effects tab were never drawn
  on the canvas. Both are built here from the tab vocabulary; a design pass
  on them is owed.
- **The pin bar's cap.** The folded bar wraps; nothing limits how many pins a
  character carries. A cap, or a "more" fold, once a table hits the ceiling.
- **The light cell's disabled state** for a character carrying no light source
  at all (the cell answers "dark · 0′" today, which is right but offers no
  action).

- **A summons model.** The party cell reads a summon off one flag on the
  summoned actor, bound by hand from the party menu. A spell that summons
  could write that flag when its creature is placed, and a duration could
  release it; the initiative card's summoner groups could read it too.

## Held for a rulings round

- **The AC cell as a menu.** Built as a three-state cycle (shield → without →
  unarmoured), the canvas's second reading. The movement and grip cells open a
  menu; AC may want the same shape.
- **Magic light on the light cell.** The cell reads a burning source, daylight,
  the dark and a sense; a light SPELL in force is not detected because no
  effect on the actor declares it. Needs a convention (a status id, or a flag
  on the effect) before the violet state can light.
- **Split beyond one unit.** The Split control on a stack peels one unit off
  (`item-sheet/stack.mjs` `splitOne`); moving "part of a stack somewhere else"
  in one gesture wants a quantity prompt.
- **A *book picks* organisation of the training list.** The Stats editor
  regroups weapons by category, by size and ungrouped — the kinds of token
  the grammar has. The page's numbered pick-combinations (which sizes or
  categories pair into one broad choice, "any five") are the class builder's
  option table and do not ship; a fourth organisation would read a table the
  importer registers (`lib/tables.mjs`) and appear only where one exists.
