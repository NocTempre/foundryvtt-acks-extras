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
8. Imported monsters: open a monster the importer created from the Judge's
   books (no sample monsters ship).
   *Observable:* it loads, its sheet renders, and its extras are populated
   rather than default.
9. Right-click the plain monster in the Actors directory and pick the Full
   Monster sheet entry three times — the real context menu, not a
   `new FullMonsterSheet(…)` in the console, which is the path under test.
   *Observable:* collect the app objects `renderFullMonsterSheet` hands its
   listeners into a `Set` across the three picks — it holds ONE, and that
   one's `element.isConnected` is true. Three is the frame-id collision: each
   new instance takes the last one's id and replaces its element, and the
   older keep rendering into nodes nobody sees. The DOM shows one window
   either way, and `actor.apps` is keyed by that shared id, so neither counts
   instances.

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

## A spellcasting monster

Needs the MM PDF connected, and the spells and classes imported: the class
document supplies the slot grid a level is read off.

**Fixtures.** `api.track` the actor each import below creates, read off the
import's own result, and the generated creature.

**Steps.**
1. Import an entry whose prose says it casts spells as a class of a level and
   prints no repertoire (the entry picker, Monsters). *Observable:*
   `system.spells.enabled` is true and the `spells.N.max` values are that
   class document's grid row at that level; the actor carries as many `spell`
   items of each level as the slots say, each a copy of an imported document
   (`flags.acks-extras.spell` present, the cookbook id kept, `minted` set);
   a second import of the same entry draws differently.
2. Import an entry whose prose lists spell-like abilities with a frequency per
   group, and one that names a spell "(as the spell X)". *Observable:* one
   `spell` item per named spell, its `flags.acks-extras.usage` the printed
   frequency's key (the ACKS Monster fieldset's Usage select shows it); the
   Spells tab is on with every slot at zero unless the prose also casts as
   a class.
3. Import an entry whose prose prints a repertoire by level ("1st - …; 2nd -
   …"). *Observable:* the named spells as items; the slot maxes equal the
   printed counts per level where no class grid applies.
4. Repair the actor from step 1 in place (Reimport One Shelf → Monsters →
   *Repair in place*, or the picker's repair). *Observable:* the minted spell
   items are replaced by a fresh draw; the id stays.
5. Generate a creature from a template family whose row prints a spell column
   (the generator sheet, *Generate*). *Observable:* the actor has the row's
   slot block, `flags.acks-extras.extras.spellcasting.class` holds the
   prose's word and `.level` the row's caster level, and it carries a drawn
   repertoire; a row printing no spells generates none.

### Drive mechanics (non-obvious, learned live)

- **A repair on a copy.** `refillMonster(actor, {whole: true})` is not on
  the api; `await import("/modules/acks-extras/scripts/importer/cookbook.mjs")`
  in page context reaches the same module instance. It reads the entry from
  the connected book and rewrites the actor it is handed, so a disposable
  copy of a shelf monster (`toObject()`, the cookbook flag kept, no `_id`)
  is the fixture and the shelf document is never touched.
- **`Actor.create` from a `toObject()` needs `items`.** The system's
  create override replaces `system` unless the data carries an `items`
  array; a source with no embedded items loses its stats on the copy. Pass
  `items: []`.
- **The binder reads the entry's description paragraphs, not the actor.** A
  stored monster keeps its prose in `flags.acks-extras.extras.description`
  channels; `bindMonsterSpells` and `castsAsClass` run on the executed
  entry's paragraphs at import. A creature whose casting paragraph sits on a
  page the register's span does not reach imports with none — the
  importer ROADMAP, "A monster whose entry runs past its first page", lists
  them; check the register's `pages` before reading a missing repertoire
  as a reader fault.
- **The generated actor is read off `createActor`.** *Generate* posts
  nothing that names it; hook `createActor` for `userId === game.user.id`
  around the click, and track that uuid.
- **A whole-shelf class repair narrows by a Set.** `cookbookUpdateClasses({
  only: new Set(ids), confirm: false })` — an array throws.

**Teardown.** `api.sweepTracked()`; quote it.
