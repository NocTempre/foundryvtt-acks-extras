# Abilities — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

## Fixtures

- A disposable `character` actor.
- A disposable `ability` item on it, with `system.rollTarget` set and
  `system.requiresRoll` true — that is the minimum an ability needs before it
  offers a roll at all.

## Core drive mechanics (non-obvious, learned live)

- **The sheet is an OVERRIDE, not a sub-type.** An `ability` item is a core
  system type; `AcksAbilitySheet` is registered over it through
  `DocumentSheetConfig.registerSheet`. Assert `item.sheet.constructor.name`,
  not the item's type, to prove the override took.
- **`rollsOf(item)` derives a `primary` roll from `system.rollTarget`** even
  when the extras flag holds no explicit `rolls` array. So a bare ability with
  a target is rollable, and `getExtras(item).rolls` being empty does not mean
  the ability offers nothing — read `rollsOf`, which is what the sheet reads.
- `rollAbility(item, key)` takes the roll KEY (`"primary"` for the derived
  one), not the item alone; `defaultKeyOf(item)` supplies it.
- `getExtras()` returns the whole `AbilityExtras` model — categories,
  defenses, choice prompts, effects — not just the roll fields. A test that
  diffs the whole object is asserting the schema, not the behaviour.

## Steps

1. Open the ability item's sheet.
   *Observable:* `item.sheet.constructor.name === "AcksAbilitySheet"`, and the
   window shows the Description / Rolls / Mechanics tabs rather than the
   system's plain ability sheet.
2. Read the resolved roll set: `rollsOf(item)`.
   *Observable:* one entry keyed `primary`, whose target matches
   `system.rollTarget`.
3. Roll it: `rollAbility(item, defaultKeyOf(item))`.
   *Observable:* a chat card naming the ability, **carrying the system's dice
   box** (formula and total, expandable to the die face), and reporting success
   or failure against the target. Read the dice on the card itself — Foundry
   does not add a box beside custom content, so "the message will show it" is
   not an observable and asserting it is how this card shipped with no dice at
   all for four releases.
4. Rank and scaling: set a rank on the extras flag and re-read `rankOf(item)`
   and `scalesFor(item)`.
   *Observable:* the rank round-trips, and a scaling ability reports its whole
   progression rather than one row.
5. `throwModifiers(actor, item)` with a modifier-bearing Active Effect on the
   actor.
   *Observable:* the effect appears as a named part, not folded into a total.
6. A throw's **score modifier**, driven through the editor rather than the API:
   open the throw, set a flat target, choose a score in the picker, then set the
   multiplier that appears beside it.
   *Observable:* the multiplier is absent until a score is named and shows the
   stored factor when one is; the stored `score` round-trips as `{key, times}`;
   the target drops by `mod × times` on an above-throw and rises by it on a
   below-throw; the editor's preview, the tag strip (`item.getTags()`) and the
   chat card's details line all report the same term and the same number.
   Switch the picker to None and back — the multiplier must survive being off
   screen. Set *Succeeds On* to an exact match: the target must not move, and
   both the preview and the card must say the term is not applied rather than
   claim it.
7. **A measure — a throw with no target.** Add a throw, set its dice to `2d6`
   and *Succeeds On* to **no target**.
   *Observable:* the editor's second fieldset ("What It Is Rolled Against") is
   ABSENT, not empty; the preview reads "Rolls 2d6…"; the Rolls tab row, the tag
   strip (`item.getTags()`) and the Favorites control all print `2d6` where a
   scored throw prints its number — none of them prints `?` or `—`. Roll it: the
   card names the throw and shows its dice box with the total, with **no**
   success/failure row and **no** "no target" explanation. A measure has no
   verdict, so the dice box is the entire answer — if it is missing the card is
   a banner and a portrait and says nothing. Name a score on it: the Roll's own
   formula becomes `2d6 + <mod>` (fold it into the DICE, never onto the total —
   the card's own box prints the formula) and the card says the term was added
   to the result.
   Then take a LADDERED throw, switch it to no target and back: its rungs must
   survive the round trip. The target section is not rendered while the throw is
   a measure, so anything that reads the form for rungs or for a scale would
   read an empty screen as an emptied table.
8. **A scored throw with no target, both ways.** Roll a laddered throw on the
   shared world item, then on a character whose level is below the ladder's
   first rung.
   *Observable:* two DIFFERENT cards — "no target on a shared item" only for the
   first; the second says the character has reached no rung yet. One message for
   both sends the reader looking for a copy on a character they already have open.
9. **A borrowed ladder, read at a fraction of level.** Create a class document
   whose `system.ladders` holds a rebuking-shaped column — a `none` rung, then
   targets, then two `auto` rungs carrying their printed cell. Point a throw at
   it (`target.kind: "progression"`, `as`, `table`) at **full** level on one
   character and **half, round down** on another.
   *Observable:* the full-level reader steps the table one rung per level; the
   half-level reader stands on `floor(level / 2)` and does NOT advance on odd
   levels. Both show the SAME table under the throw, headed by the lending
   class's levels, and the borrower's row carries the line naming which of the
   lender's levels it is reading. Switch the fraction to two thirds and the
   rounding to up: the rung moves to `ceil(level × 2/3)`.
   **Drive it through the editor, not the API.** `as` and `table` are the two
   fields a closed schema silently discarded — the API path writes the flag
   directly and never proves they survive normalization, which is exactly how
   that bug lived through a release. Read the stored target back after a real
   `change` event on the pickers.
10. **The three verdicts a rung can give.** Walk one throw up through its ladder.
   *Observable:* at a `none` rung the row reads the printed cell, says the throw
   is not available, and clicking it posts NOTHING to chat (a notification only).
   At a target rung a d20 is rolled and scored. At an `auto` rung the row reads
   the cell, and clicking posts a card with **no dice attached** whose success
   row carries the cell. Then roll the ability's measure: that is the 2d6 the
   procedure ends with, and it must post normally after any of the three.
11. **Tab isolation, then a re-render.** Walk Description → Rolls → Mechanics,
   then re-render the open sheet (`sheet.render()` — what a field edit does) and
   walk back.
   *Observable:* exactly one `section.tab` has a computed `display` other than
   `none` at every step, and it is the one the nav marks active. On Description
   the prose editor and the requirements field have real height; a panel that
   survives a re-render at `display: none` while its nav button reads active is
   the failure this step exists to catch.

## Teardown

Delete the ability item and the character. Confirm no `ability` items named
for the fixture remain in `game.items` or on any actor.
