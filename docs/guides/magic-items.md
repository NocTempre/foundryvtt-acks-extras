# Magic items

A magic item is rolled down the item-generation tables of your own Judges
Journal and Treasure Tome, once you have imported them: the rules tables arrive
with Import everything, and [the importer guide](importer.md#rules-tables) says
how to read them again on their own.
Nothing is rolled from a table the module holds itself: with nothing imported
the roller says so and shows no figure.

## Rolling one

Run the **Roll a Magic Item** macro ([Macros](#macros)). The window is for GMs
only; a player who runs the macro is told so.

- **Style** is Classic, Heroic or Gritty.
- **Category** applies to Classic. *Roll the type* rolls the type list first and
  follows it to a category list; the other options start at one of the classic
  lists you imported, named as your book names it.
- **Rarity** applies to Heroic and Gritty, which read the same lists: one entry
  per imported heroic list, named as your book names it.

The picker a style does not use is switched off. An option for a list your import
did not read is greyed and marked *not imported*. **Roll** posts the card;
**Cancel** posts nothing.

## The card

The card is whispered to the GMs, never shown to players. It lists each list the
roll passed through: the list's name, the roll (`1d100 = 57`, or for a list that
ends in a second roll on a smaller die, the outer face then the inner roll,
`7 › 2`), and the row's text beneath the name. An **Item** section then holds the
item the chain ended on.

Hover a roll for where it came from: the die, the band it landed in, and the page
the list was read from. A list you have overridden in the Ruledata Browser says
*Set by hand* in the page's place.

A note under the card means the chain could not be followed to its end: a list
it pointed at is not imported, or it would have looped. The item stands as it was
reached.

## Macros

**Roll a Magic Item**, in the **ACKS Extras Macros** compendium (Compendium
Packs sidebar tab), opens the window.

## Common problems

**"No magic-item tables are imported."** The Judges Journal's item tables are not
in this world. Import them, then run the macro again.

**An option is greyed and says *not imported*.** That list was not read from your
book. The rest of the style still rolls.
