# Monsters — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

## Fixtures

- A disposable `monster` actor.
- A disposable `acks-extras.animal` actor — the sub-type this feature also
  owns the sheet for.

## Core drive mechanics (non-obvious, learned live)

- **A plain `monster` opens the FOLLOWER CARD, not the full sheet.** Its
  registered sheet is `FollowerCardSheet` (from `lib`), the compact card;
  `FullMonsterSheet` is reached from the card's **Full sheet** control,
  `data-action="fcOpenFull"`. Asserting `actor.sheet.constructor.name ===
  "FullMonsterSheet"` fails on a correct install. An `acks-extras.animal`
  DOES open `FullMonsterSheet` directly — the two paths differ and both are
  intended.
- Both sheets are registered as OVERRIDES over core types through
  `DocumentSheetConfig.registerSheet`, so the sheet class is the thing to
  assert, not the actor type.
- `getExtras(actor)` returns the whole `MonsterExtras` model — types, subtype,
  size, body form, mass, HD, save-as, defenses, spellcasting, scores, speeds,
  vision, lightless range, senses, load, encounter data and variants. A test
  that diffs the whole object asserts the schema rather than any behaviour;
  assert the fields the change touched.
- Vision fields feed `lib`'s vision management: a monster's `lightlessRange`
  is what a placed token's sight is derived from, so a vision assertion
  belongs to a PLACED token, not to the actor.

## Steps

1. Open a plain `monster`.
   *Observable:* `FollowerCardSheet` — the one-line card with HD, XP, AC, HP,
   speed, morale, loyalty, attacks and damage.
2. Press **Full sheet** on the card.
   *Observable:* `FullMonsterSheet` opens beside the card (both instances
   live), showing alignment, D.E./W.E., morale, XP award, HP/HD, AC, throw,
   MV, I.B. and S.O.
3. Open the `acks-extras.animal`.
   *Observable:* `FullMonsterSheet` directly, with no card in between.
4. Fill the extras: types, size, body form, HD, save-as, speeds, vision.
   *Observable:* each round-trips through `getExtras`, and the derived lines
   on the sheet (save row, encounter numbers) change with them rather than
   staying at their defaults.
5. Defenses: declare an immunity and a susceptibility, including the
   `mundane` / `extraordinary` / `silverFlaw` switches.
   *Observable:* they appear on the sheet as stated defenses, and damage
   applied through the system's own path respects them.
6. Variants: add a variant entry.
   *Observable:* it is listed and can be applied without editing the base
   monster.
7. Place a token of a monster with a lightless range, with `lib`'s vision
   management on.
   *Observable:* the token's sight range matches the declared lightless range.
8. Bestiary samples: open the shipped sample monsters.
   *Observable:* each loads, its sheet renders, and its extras are populated
   rather than default.

## Teardown

Delete both actors and any tokens placed for the vision step. Confirm no
fixture actors remain.
