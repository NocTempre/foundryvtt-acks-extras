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
   window shows the Description / Rolls / Mechanics / Requirements tabs rather
   than the system's plain ability sheet.
2. Read the resolved roll set: `rollsOf(item)`.
   *Observable:* one entry keyed `primary`, whose target matches
   `system.rollTarget`.
3. Roll it: `rollAbility(item, defaultKeyOf(item))`.
   *Observable:* a chat card naming the ability and reporting success or
   failure against the target — not a bare die.
4. Rank and scaling: set a rank on the extras flag and re-read `rankOf(item)`
   and `scalesFor(item)`.
   *Observable:* the rank round-trips, and a scaling ability reports its whole
   progression rather than one row.
5. `throwModifiers(actor, item)` with a modifier-bearing Active Effect on the
   actor.
   *Observable:* the effect appears as a named part, not folded into a total.

## Teardown

Delete the ability item and the character. Confirm no `ability` items named
for the fixture remain in `game.items` or on any actor.
