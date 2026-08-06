# Classes — using them at the table

Screenshots land here with each release (see [GALLERY](../GALLERY.md)).

## Getting class documents

Import them from your own book: connect the Revised Rulebook — and By This
Axe, if you own it — in ACKS Importer, then run
`acksImporter.importClasses()` (or the macro). Every class arrives as a
**Class** item — progressions, saves, awards, starting templates — read from
your PDF. Or build homebrew from scratch: **Create Item → Class** opens the
same constructor.

## On the character sheet

Three small controls appear beside the class field:

- **Graduation cap** — bind the character to a class document and apply its
  printed numbers for the current level (saves, attack throw, title,
  XP-to-next, hit dice, cleaves, spell slots). The confirm lists every change
  old → new and flags anything you hand-edited since the last apply.
- **Dice** (level 1 characters) — roll a starting template: 3d6, then choose
  the rolled template or any lower band. Applying grants the proficiencies
  (ranks and selections included), the equipment — each piece named as
  printed over its base item's mechanics — the coin, and your Intellect
  bonus proficiency picks.
- **Rising arrow** (when XP qualifies) — the level-up wizard: HP rerolled per
  RAW (full Hit Dice, Constitution per die, never on the flat bonus past
  9th, minimum one over the old maximum — an additive house rule is a world
  setting), the new level's powers granted, class/general proficiency picks
  offered, slots bumped.

Casters get a per-tradition slot strip under the class field — click a pip to
spend, click a spent pip to refund, the bed icon to rest. The Nobiran's
arcane and divine pools sit side by side.

## Keeping documents current

After reconnecting your book, `acksImporter.cookbookUpdateClasses()` rewrites
imported class documents from the page (hand edits on them are replaced —
the confirm says so). `repairSaveReferences` under
`acksExtras.classes` finds stale save-key references world-wide; dry-run by
default.
