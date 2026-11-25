# Character sheet — roadmap

Re-issued 2026-11-14.

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
  slots need that count, which the imported option lists carry (`pick` and
  `total` on each list of the `weaponLists` options table).
- **An undrawn board**: a caster's Effects tab was never drawn on the canvas.
  It is built here from the tab vocabulary; a design pass on it is owed.
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

- **A per-source breakdown of an attack or damage bonus.** A weapon figure's
  tooltip says whether the item declares it, the weapon table states it, or
  nothing does (`figureState` and `figureTip` in
  `scripts/equipment/weapon-figures.mjs`), and an adventuring throw lists its
  parts (`rolls.adv.parts` in `scripts/character-sheet/rolls.mjs`). Neither
  names the item, ability or effect behind an attack or damage bonus. Not
  built: a figure's parts, each named by its contributor, read from the
  modifiers the figure is made of.

- **A summons model.** The party cell reads a summon off one flag on the
  summoned actor, bound by hand from the party menu. A spell that summons
  could write that flag when its creature is placed, and a duration could
  release it; the initiative card's summoner groups could read it too.

- **Set down on the system sheet.** The system sheet's own container header
  has no Set down control; only this sheet's Equipment tab does. It needs its
  own design before it is built.

- **Set down packs, party-wide.** One control that sets every member's carried
  containers down at once. Deferred by the owner's choice (4A, per character
  only); the per-character control is built.

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
  the dark and a sense, and not the actor's magic lights. A cast light spell
  now writes one (lib `magicLights` / `effectLight`, magic DECISIONS
  2026-11-25), so the violet state needs only the cell to read it.
- **Split beyond one unit.** The Split control on a stack peels one unit off
  (`item-sheet/stack.mjs` `splitOne`); moving "part of a stack somewhere else"
  in one gesture wants a quantity prompt.
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
