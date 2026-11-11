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
  a class's broad pick, its narrow pick and the restricted weapons of a
  caster's list. A pick that is a set of weapons can already be expressed,
  because the Stats editor writes single weapons into the grant. Nothing
  records HOW MANY a class may pick or which tier the picks belong to. The
  slots need that count, which the imported option lists carry (the printed
  groups entry, below).
- **Undrawn boards**: the Magic tab and a caster's Effects tab were never drawn
  on the canvas. Both are built here from the tab vocabulary; a design pass
  on them is owed.
- **The pin bar's cap.** The folded bar wraps; nothing limits how many pins a
  character carries. A cap, or a "more" fold, once a table hits the ceiling.
- **The light cell's disabled state** for a character carrying no light source
  at all (the cell answers "dark · 0′" today, which is right but offers no
  action).

- **A melee attack modifier row on the Stats tab.** Two-weapon fighting
  writes `system.attack.mod.melee` with its part cited to the imported table,
  and no surface shows that field, so the part's provenance rides the loadout
  effect's flag alone. A row with the typed ledger's tooltip, beside the save
  and Avoid Surprise rows, gives it a figure to sit on.

- **A summons model.** The party cell reads a summon off one flag on the
  summoned actor, bound by hand from the party menu. A spell that summons
  could write that flag when its creature is placed, and a duration could
  release it; the initiative card's summoner groups could read it too.

## The official sheet (PDF)

- **The gear boxes' per-line columns.** Each gear place has a column of item
  counts and a column of weights beside its list. The import reads only the
  list, where a count is written in the line, and the export writes only the
  list. The columns want a line-by-line pairing that survives a reader who
  wrote the count in the list instead.
- **Which proficiency box an ability belongs in, for one never imported.**
  The export sorts by the ability's own type, and the record decides only for
  a name the last import read from the class box. Class proficiencies a class
  grants as general ones come out in the general box.
- **A henchman's derived lines.** The export writes a henchman's movement,
  attack and damage lines from the record. Working them out from the
  henchman's own weapons and movement, as the character's are, would keep
  them current.
- **The domain page's lines whose families match no count.** They import
  as notes and the Judge sets them on the domain. A families figure that is
  part of one side has no shape in the record's lines yet.
- **The domain page for a player.** Import and export read and write the
  domain only for the Judge; a player's export carries the page the last
  import read. Opening it to the ruler's player waits on the domain's own
  player write gate (`docs/domains/ROADMAP.md`, wave 3).
- **A weapon's initiative bonus** has no field on the character; it rides
  the record and the notes.

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
- **The book's printed groups as shortcuts on the training list.** Ruled in
  DECISIONS (2026-11-11). It needs three pieces: the importer's option lists
  (`weaponLists.options`), weapon placement that resolves each option the same
  way in every list, and the buttons with their provenance tooltips. The
  buttons appear only where the lists are imported.
- **A situational modifier on the surprise and out-of-combat initiative
  rolls.** Both roll at once with the character's stored modifier and no
  window, where an ability's throw asks first. Route them through
  `scripts/lib/roll-dialog.mjs` as ability rolls do, so Shift skips the
  window and the figure typed there lands as its own term on the card.
- **A summoning entry's own limits on the summons.** *Summon…* places any
  library creature, any number, anywhere on the viewed scene; a spell that
  names the creature, how many and how far from the caster would supply them
  as imported figures through `placeSummons`' `preConfirm`, which a spell
  entry does not yet reach. The prompt's spell choice records the cast and
  constrains nothing.
