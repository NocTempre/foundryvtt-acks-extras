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
- **To test what this sheet does with a plain MONSTER, construct it.** Because
  of the line above, `monster.sheet` is the card, so a part-filter assertion
  ("a monster gets no Animal tab") must build the sheet by hand:
  `new (Object.values(CONFIG.Actor.sheetClasses.monster).map(e => e.cls)
  .find(c => c.name === "FullMonsterSheet"))({document: monster})`, render it,
  assert, close it. Reading `monster.sheet` instead silently asserts nothing —
  the card has no tabs to find.
- **A change on one control re-renders the sheet and DETACHES the others.**
  Scripted checks that touch two fields in a row must re-query the second
  element after the first submit; setting `.checked` on the stale node reports
  success, dispatches its event into nothing, and reads back as "the write did
  not land" on a field that works.
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
   staying at their defaults. Set Hit Dice to 3, HD Bonus to 1: the header's
   HD field reads `3d8+1` and `system.hp.hd` holds it; the follower card
   reads 3 HD. Type `2d6` into the header's HD field, then change an
   unrelated extras field: `2d6` survives. Click the dice button on the
   Rating & Saves legend: `system.hp.value` and `.max` are set from a roll
   of the formula. (A blank rating still rolls: core's schema never leaves
   `system.hp.hd` empty, so there is no warning branch to reach.)
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

### The Animal tab

Fixture: `Actor.create({name, type: "acks-extras.animal", system: {animal:
{training: "untrained", mountable: false}}})`, plus a plain `monster` for the
negative half.

1. Open the animal. The nav shows **Animal** between Classification and
   Attacks; the section carries `select[name="system.animal.training"]` (six
   localized options) and `input[name="system.animal.mountable"]`.
2. Change the select, then RE-QUERY and tick the checkbox (see above). Read
   back `actor.system.animal` — both writes land through the sheet's own
   submission, with no handler of ours in the path.
3. `setFlag("acks-extras", "cookbook", …)` and re-render: the legend gains
   the `.acksm-cat-tag` badge.
4. Build `FullMonsterSheet` on the plain monster (see above). It must show
   neither `[data-tab="animal"]` nor any `[name^="system.animal"]` — the part
   gate, not just the nav gate.
5. Scan the section's text for `/ACKS-[A-Z-]+\.[a-zA-Z.]+/` — any match is a
   missing lang key.

## Teardown

Delete both actors and any tokens placed for the vision step. Confirm no
fixture actors remain.
