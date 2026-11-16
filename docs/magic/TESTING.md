# Magic — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`. Each release
adds its surface's recipe here before its tag.

## Offline gate

`npm test` runs `tools/test-magic.mjs`: every vocabulary family against the
lang file in both directions, the monsters `USAGE` alias, the importer's
frequency scan, the effect-type domains. Green here proves the tables agree
with each other; it proves nothing about a window.

## The vocabulary (foundation)

The one runtime surface the vocabulary changes outside the spell sheet
is the frequency select on a monster-owned ability.

### Fixtures

- A disposable `monster` actor created through the driver's ledger
  (`api.create`), holding one `ability` item.

### Steps

1. Open the ability from the monster's sheet; the "ACKS Monster" fieldset the
   monsters feature injects is at the bottom of the item sheet.
   *Observable:* the Usage select lists the thirteen shared frequencies, at
   will first and by caster level last, as English labels; no option reads as
   a raw `ACKS-LIB.enum` key.
2. Pick "Printed frequency 1 (from the book)" and let the sheet submit.
   *Observable:* `item.getFlag("acks-extras", "usage")` reads `printedFreq1`,
   `usageText` is unset, and reopening the sheet shows that option selected.
   On an imported creature whose ability prints such a frequency, `usageText`
   holds the page's words and the monster sheet's ability line shows them in
   place of the label.
3. Pick "By caster level (scheduled)", one of the three members the monsters
   table did not have.
   *Observable:* the flag reads `byLevel` and the sheet re-renders without a
   console error.

### Teardown

`api.sweepTracked()`; quote its result. The actor and its ability are the
only documents the run created.

## The spell primitive and the spell import

Every step below needs the seat's own RR PDF connected (the *Your ACKS Books
(this seat)* macro); nothing here is a fixture document.

### Fixtures

- One hand-made `spell` Item through the driver's ledger (`api.create`), with
  no flag on it — the sheet's derived strings are checked on this one.
- One disposable `character` actor through the ledger, for the template and
  picker steps. A class whose starting templates print a spellbook must
  already be imported, and imported after the spells — a class packaged
  before they existed keeps printed names on its template, and step 5 reports
  them unresolved; the class is the world's, not the run's.

### Steps

1. As GM, `acksExtras.importer.importSpells()` (the getting-started chain
   runs the same step, *Importing spells…*, before the classes).
   *Observable:* the notification counts the imports; the imported Items
   compendium's *Spells* folder holds one document per printed entry of the
   spell chapter plus the sample rituals; on any of them
   `getFlag("acks-extras", "spell")` carries a non-empty `lists[]`, a `type`,
   a range shape and a duration shape; `system.class` reads the first list's
   label and `system.lvl` its level; `img` is not the grey placeholder. A
   ritual carries `ritual: true`; a spell whose heading printed an asterisk
   carries `reversible: true` and a `reversedName`.
2. Open one imported spell.
   *Observable:* the ACKS Spell sheet, three tabs — Overview with the lists
   and shapes filled, Description with the book text closing on its cite
   link, Mechanics with no rows and the add control — and no console error.
   Open the one whose prose names two damage types with "or" between them:
   both words are present.
3. Open the hand-made spell. On Overview set the range shape to a distance
   with a value and unit, and a duration shape; let the sheet submit.
   *Observable:* `system.range` and `system.duration` now read the strings
   the shapes express; clearing a string and submitting fills it again from
   the flag.
4. Run `importSpells()` a second time.
   *Observable:* nothing imported, every entry already present. Then
   *Reimport One Shelf → Spells → Repair in place*: every document keeps its
   id; a `cast` count you set beforehand survives; an effect row you added on
   Mechanics survives.
5. Apply a spellbook-printing template to the disposable actor through the
   class's Templates tab.
   *Observable:* the named spells land on the actor as spell Items that carry
   the flag (the imported documents, not the core pack's namesakes); the
   printed pick, where the template prints one, is a pending-choice marker,
   and opening it lists each imported spell of the class's tradition once.
6. Join as the player seat that owns the disposable actor and open one of its
   spells.
   *Observable:* the sheet renders with no console error; fields submit for
   the owner and are inert for a seat that does not own the actor.
7. Run the *Uninstall — Strip Spell Data* macro, confirm.
   *Observable:* the notification counts the items stripped; a spell in the
   world's Items directory or on an actor keeps its name, description and
   strings and has no flag. The imported shelf is a world compendium, which
   the strip leaves alone, so its documents still carry theirs. Then
   *Repair in place* on the Spells shelf.
   *Observable:* every document on the shelf replaced in place, ids
   unchanged, a `cast` count and an effect row kept; a copy on an actor
   stays stripped.

### Drive mechanics (non-obvious, learned live)

- **A shelf repair and the strip macro both open a confirm, so neither is
  awaited from a page-context call.** `cookbookReimportShelf("Spells",
  { mode: "repair" })` and `macro.execute()` each raise a `DialogV2`; kick the
  call off, wait a couple of seconds, click its `button[data-action="yes"]`,
  and poll a `window` flag the promise sets — a repair of the whole shelf runs
  well past a driver call's timeout. The macro is read from the module's Macro
  compendium (`pack.getDocuments()`), not from `game.macros`.
- **Step 6's inert half is a compendium document, not a second seat.** As the
  player, `fromUuid` a spell on the imported shelf and render it: `isEditable`
  is false and every input on the sheet is disabled, which is the observable;
  the owned copy on the player's actor is the half that submits.

### Teardown

`api.sweepTracked()`; quote its result. The imported spells are the seat's
own world content and stay; the hand-made spell and the actor are the only
documents the run created.

## Printed names and repertoires

Needs the RR and MM PDFs connected, the spells imported and the classes
imported after them. The surfaces are the classes' and the monsters', so the
recipes live there; this section says which.

### Steps

1. The class side — the repertoire count on the Casting tab, the narrowed and
   level-capped pick, the relink of a kept spell: `docs/classes/TESTING.md`,
   "A tradition's list and a level cap the spell pick; a kept spell relinks".
2. The monster side — a stat block that names spells, one that casts as a
   class of a level, one that prints a repertoire, and a generated creature
   whose row prints a spell column: `docs/monsters/TESTING.md`, "A
   spellcasting monster".
3. A starting spellbook whose printed title carries "and": apply a template
   that prints one. *Observable:* the spell lands whole, one document, not
   two.

### Teardown

Each recipe's own; `api.sweepTracked()` once, quoted.

## Casting a summoning spell

Built for the Magic tab's Cast on a summoning spell (MODEL, "Casting a summoning
spell"). A mock cannot prove three things: that a Player seat that may not
observe the creature still places it, that the cast count is spent only after the relay
answers, and that core's click-to-place takes the plain preview. No book needs
to be connected; the spell's row is built by hand.

**Fixtures** (kept; found by marker, built when none carries it):
- `magic/summon-creature` and `magic/summon-other` are `monster` actors with
  `ownership.default` 0. The Player's client still resolves a world actor by
  uuid (`fromUuid` returns it) but may not observe it, and observing is what the
  exemption turns on. The walk asserts both at its start.
- `magic/summon-open` is a `monster` the Player observes, which the spell does
  not name.
- `magic/summon-caster` is a `character` the Player owns, spells enabled.
- `magic/summon-spell` is a `spell` on that character. Each run rewrites its
  flag to one summon row (`ref` the creature's uuid, `amount` 2) and a fixed
  two-hour duration, and its `system.cast` to 0.
- `magic/summon-scene` is the field both seats view, as in
  docs/character-sheet/TESTING.md "Summons from a Player seat".

`tools/live/magic-cast-summon.mjs` walks the steps on the GM and Player seats,
after a reload of each seat under a boot recorder.

**Drive mechanics (learned live).** The mechanics of "Summons from a Player
seat" apply: unpause the world, close every framed window before placing, pan
the scene's middle to the viewport's before reading click points, real CDP
clicks. The Cast button is pressed without awaiting it, because `item.use()`
does not await the cast. The prompt is the answer, and the count is read in
three states.

**Steps, from the Player seat** (the sheet open on the Magic tab):
1. Press the spell row's Cast (Character sheet → Magic tab → Cast).
   *Observable:* the creature prompt, titled for the spell, offers the row's one
   choice, labelled, with the count opening on the row's amount and no free
   spell field. `system.cast` is unchanged with the prompt up, and again with
   the previews up.
2. Place on the map and click twice. *Observable:* two tokens carry `spellId`,
   `spellName` and one `castId`, and the Player owns each. `system.cast` rose by
   exactly 1 and exactly one card posted. One caster record carries that
   `castId`, the spell and the caster, with a 2-hour duration. The GM's client
   made the one world copy, owned by no player.
3. Cast again and right-click the preview; cast again and close the prompt.
   *Observable:* each leaves the count, posts no card, makes no token and writes
   no record, with no warning or error.
4. Refusals. *Observable:* a request sent straight to the relay for an unnamed
   creature the Player cannot open answers `unreadable`; for an unnamed one the
   Player can read, `notNamed`; for the named creature over the row's amount,
   `badCount`; with no spell, `spellRequired`. Nothing is made. The seat's own
   `placeSummons` stops before any click, and the Player's Summon… is refused
   with a warning and no prompt.
5. From the GM seat, Summon… (`promptSummon`, the cast menu's entry): pick
   a library creature with no spell and place it. *Observable:* one token whose
   record carries no spell, and the spell's count unchanged.

**Teardown.** Delete only what the run tracked: the tokens, the cards, the
caster records, and the world copies where none stood before. The fixtures
stay. Quote `gm.sweepTracked({only})`'s result.

## Spell effect rows (the recipe channel)

Walk: `tools/live/magic-spell-recipes.mjs`, on the GM seat only: nothing here
is a player's surface. It needs the seat's own RR open (the shelf opens it on
join) and the five recipe spells already imported (`def.spell.desiccate`,
`def.spell.cureLightInjury`, `def.spell.frightenHumanoid`,
`def.spell.holyCircle`, `def.spell.sharpness`).

### Fixtures

Steps 1 to 5 and 7 build none. The rows are written onto the library's own
imported spells, the path an existing world takes (the Spells repair), and the
walk leaves each spell with register rows only. Step 6 uses three kept
fixtures, each found by its marker (`flags.world.fixture`) with the capture
driver's `api.fixture(marker, kind, data)` and built from `data` when none
carries it: `magic/scope-chaotic-undead` (a monster actor typed undead, of
Chaotic alignment, and a hostile token), `magic/scope-ally-caster` (a character
of Lawful alignment and a friendly token) and `magic/scope-neutral-token` (a
monster actor with no type and a neutral token).

### Steps

1. Run the Spells repair over the five
   (`acksExtras.importer.importSpells({only, repair})`).
   *Observable:* each spell's `flags["acks-extras"].spell.effects` holds the
   recipe's row kinds in order, every row `origin: "register"`; every damage
   and heal row has its dice, every damage row one damage type, every
   modifier row its figure; the save category, the area size and the creature
   filters read where the recipe locates one; the only `unread` field is
   `extraordinary` (the PDF prints that mark as the damage glyph's colour,
   which the text op does not read).
2. Append a row of the Judge's own (no `origin`) to one spell and repair it.
   *Observable:* the hand row is there once, and the register rows number as
   before (replaced, not doubled).
3. Open the spell's sheet and change a text field on the Overview, letting
   the sheet submit.
   *Observable:* every row's `origin`, `unread`, `extraordinary`,
   `saveEffect`, `lasts` and `delivery` read back as before, an unset field
   reading back as the schema's empty value.
4. On the Mechanics tab press a row's edit control and change a text field
   in the editor.
   *Observable:* the row's `origin` is cleared and its `key` kept; a repair
   keeps it and adds no fresh row beside it (one row carries the key, the
   register rows number as before), and a repair that decides lists nothing
   held, since an edit to the note still covers every figure of the fresh row.
4a. On the Mechanics tab press a register row's delete control and confirm.
   *Observable:* the row is gone and its key is in the spell's `retired`; a
   repair does not bring it back and lists it as held.

5. Read the scope and the measure off the repaired rows.
   *Observable:* holy circle's ward row carries `vsKinds` of one token; its
   two bonus rows carry an `anyOf` of two branches (an enemy of an alignment
   other than the source's; two kinds of one alignment) and no `condition`;
   three more rows carry `reversed: true`, their second branch one kind of the
   opposite alignment; desiccate's `target.area.measure` is `diameter` and
   holy circle's is `radius`, each with a located size. The Overview's
   Extent in feet reads the normalized figures, and its tooltip names the
   measure, the printed figure and unit, the unit's worth in feet and the
   page.
6. Evaluate a bonus row's scope in page context, with
   `scopeApplies(row, ctx)` from `scripts/lib/vocab.mjs` and a `ctx` built from
   three fixtures: `magic/scope-chaotic-undead` (an undead monster of
   Chaotic alignment, hostile token), `magic/scope-ally-caster` (a
   Lawful character, friendly token) and `magic/scope-neutral-token` (a monster
   with no type, neutral token). *Observable:* with the caster's alignment as
   `sourceAlignment`, the chaotic undead applies (`creatureKinds` and
   `areEnemies` from `actor-read.mjs` build `kinds` and `enemy`), the ally
   fails, and the neutral token is undetermined.
7. Open a bonus row in the row editor and change a flat scope field.
   *Observable:* the `anyOf` reads back as stored, shown in the editor as one
   line of text, and the row's `origin` is cleared.

### Drive mechanics

- The importer's api is published after `ready`, once the cookbook has
  loaded, and the shelf opens the seat's books after that: wait on
  `acksExtras.importer.bookOpen("rr")` before the first step.
- The library's spell is found in page with
  `import("/modules/acks-extras/scripts/lib/library.mjs")` and
  `byCookbookId("Item", id, {original: true})`; the module's own URL gives
  the loaded instance.
- A sheet submit writes every row whole through the schema, so a field the
  row left unset reads back as `""` or `[]`, never as missing. An `anyOf`
  branch is filled the same way (`""`, `[]`, `false`, mode `gate`), which
  `scopeApplies` reads as unset: step 7 compares branches with those dropped.
- The row editor is a form with `submitOnChange`: set a field's value and
  dispatch a bubbling `change` on it. Its first text field is `condition`.
- A repair lists held edits in its tally only when the tally carries a
  `decision` (the Judge's path through the repair dialog): pass
  `{replaced: 0, refused: 0, keptProse: 0, decision: "keep"}` and read
  `tally.edits`. Without one it writes under the plain policy and lists
  nothing.
- The delete control raises a DialogV2 confirm; press its `yes` button.
- A repair keeps a stamped row in its own place, so a spell whose rows an
  earlier run left out of recipe order stays so: clear its register rows and
  repair it once to restore the order before step 1 reads it.
- A monster actor is created hostile whatever disposition its data names, so
  step 6 sets each fixture's prototype token disposition before it reads
  them; `areEnemies` takes the prototype tokens.

### Teardown

The walk removes the rows it added, found by their own marks
(`walk-hand-row`, `walk-edit`, `walk-edit-scope`), clears desiccate's
`retired` so the row step 4a deleted returns, and repairs each spell it
edited once more; its last checks are that none of its rows remains and the
register rows number as before. A row anyone else added stays, and the three
scope fixtures are kept.

## Casting a spell (the cast engine)

Walked by `tools/live/magic-cast-spell.mjs` on the GM and Player seats. The
spells are the seat's own import from the RR by cookbook id (the three recipe
spells of "Spell effect rows"); the walk's assertions are relations between
what the card shows and what the world holds, never a printed figure.

### Fixtures

Found by marker, built by `api.fixture` when nothing carries it, and kept.

| Marker | What it is |
|---|---|
| `magic/cast-scene` | A gridded field, no vision, global light. |
| `magic/cast-class` | An `acks-extras.class` item with one vancian tradition, two first-level slots. |
| `magic/cast-caster` | A character the Player owns outright, bound to the class by `flags.acks-extras.classes.uuid`, level 1, `system.spells.enabled`. |
| `magic/cast-spell-damage`, `-cure`, `-fright` | Copies of the three imported spells on the caster, as the walk reshapes them at its start: first-level list, a flat roll and a "half" save on the damage copy, a two-minute duration and a "negates" save on the condition copy. |
| `magic/cast-target-a`, `-b`, `-c` | Monsters nobody but the GM owns, each reset to 20 hit points and equal saves. |
| `magic/cast-monster`, `magic/cast-monster-weapon` | A monster with one melee weapon. |

The run's own tokens, cards and records are tracked by uuid and swept alone.
The walk moves the world clock forward by a few minutes and restores the dice
it rigged.

### Steps

1. The boot recorder, attached before the reload on both seats, sees `init`,
   `setup` and `ready` with no cast registration error. *Observable:* the
   recorder ran before Foundry's scripts and holds no such error.
2. Cast the damage spell at three targeted tokens with the dice rigged so one
   save passes and one fails. *Observable:* one card, one rolled amount
   shared by every entry, each applied amount equal to the rolled amount
   through that entry's save fraction and one half-to-even rounding, each
   target's hit points fallen by exactly its applied amount, the damage type
   and a tooltip on every figure, and the cast count and the tradition's
   slot each up by one. Press Undo on each entry: hit points restored.
3. The same cast with nothing targeted. *Observable:* the card posts the
   roll with no target and nothing applied; with two tokens then targeted,
   the footer Apply takes them, rolls their saves and applies; the third
   token is untouched.
4. The cure spell's reversed form with one target. *Observable:* the
   system's own attack card is posted for the cast, carries our
   `magicAttack` mark and has no apply button; the cast's entry applied the
   amount that card's damage roll made. Cast at nothing, the card carries a
   Throw press.
5. The cure spell's plain form on a wounded token. *Observable:* hit points
   raised by the applied amount, capped at the maximum.
6. The condition spell twice on one token, thirty seconds apart.
   *Observable:* two records, each with one status and no changes, flag-timed
   (core's `duration` unset), and one condition standing. Advance
   `game.time` past the first record's end: one record left, the condition
   stays. Past the second's: both gone, the condition off.
7. A monster's weapon used through its own item. *Observable:* core's attack
   card, no cast dialog, no cast card, no `magicAttack` mark.
8. The Player seat casts the damage spell at a token it does not own.
   *Observable:* the entry is applied by the GM client, the token's hit
   points move on the GM's view, and the Player's `isOwner` on it is false.
9. Spend both slots. *Observable:* the Player's dialog shows the verdict as a
   block and disables Cast; cancelling it spends nothing and posts nothing;
   the GM's dialog shows the same verdict as a warning and leaves Cast on.
10. Neither seat recorded a console error after its load.

### Drive mechanics

- A cast starts with `item.use({skipDialog: true})`; the dialog is DialogV2
  and is found by `.acks-extras-cast-dialog`. Its Cast button is
  `button[data-action="cast"]`, and the form's `[data-cast-mode]` select
  picks the form, with a bubbling `change` after the value is set.
- Rig the dice with `CONFIG.Dice.randomUniform` (reads from the top: 0.025
  throws a 20, 0.975 a 1) and restore it in `finally`.
- Targets are set with `token.object.setTarget(true, {user, releaseOthers:
  false, groupSelection: true})` on the viewed scene.
- A card button is pressed by its `data-action` (and `data-target`,
  `data-row`) inside `[data-message-id]` with the chat tab up; the entry
  settles when none is `pending` or `applying`.
- The walk's seats do not own the targets, so every apply from a Player
  goes through the GM client's relay: wait for the entry rather than the
  hit points.

### Teardown

The walk lists the cards speaking as its fixtures since it began and the
caster's own records, tracks them with its tokens, and `sweepTracked` deletes
exactly that list. It resets the caster's spent slots, restores the dice and
clears each seat's targets. The fixtures stay.
