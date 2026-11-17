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
| `magic/cast-spell-circle`, `magic/cast-spell-edge` | Copies, on the caster, of two more imported spells (cookbook ids `def.spell.holyCircle`, `def.spell.sharpness`), the circle with scoped modifier and ward rows, the edge with weapon-gated ones. Built as the first three are, from the seat's own import; each step reshapes its copy from the library original's flag: first-level list, a fixed duration of the walk's own, and where a step needs one, a flat figure on one row. |
| `magic/cast-ally` | A character only the GM owns, no condition, equal hit points and saves; a friendly linked token. |
| `magic/cast-ally-blade` | A weapon on the ally with no magic and no layer. |
| `magic/cast-ally-fine` | A weapon on the ally stamped with the both-ways masterwork tier through the module's own `setMasterwork`; each case clears and re-stamps it. |
| `magic/cast-foe`, `magic/cast-foe-claw`, `magic/cast-foe-spell` | A GM-owned monster typed undead with alignment Chaotic, its melee weapon, and a copy of the damage spell with a flat roll and a save; a hostile linked token. |
| `magic/cast-stranger`, `magic/cast-stranger-claw` | A GM-owned monster with no type and no alignment, its melee weapon; a hostile linked token. |

The caster's alignment is set to Lawful at the start of the buff steps. The
walk reads each creature back through lib's own readers (`creatureKinds`,
`actorAlignment`) before it relies on it, and fails if any spell record already
stands on the ally, the foe or the stranger.

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

### The buff steps

Walked after step 8 and before the console step. They are numbered here as
the walk labels them (`buff N`); the numbers between 5 and 11 are the
steps the held casts add and those after 14 the declaration's, written
below under "The held-cast steps" and "The declaration steps". Every observable is a relation
between two things the world holds, and a figure the import left blank fails
its step as an import finding (the walk never supplies one).

1. **The circle at two tokens.** The Player targets the caster's token and the
   ally's and casts the circle. *Observable:* the cast settles with every
   entry applied; each recipient holds exactly one record of the cast, with no
   status and no change, carrying lib's `rollMods` with one `ac`, one `save`
   and one `ward` part, the scope of each as its spell row declares it (the
   same count of `anyOf` branches, the same kinds) and `sourceAlignment`
   equal to the caster's alignment key; the ally's record was last written by
   the GM's user and the Player's `isOwner` on the ally is false; every
   modifier entry on the rendered card carries a tooltip naming the spell.
   The caster holds one more record of the cast: status-only, the
   `concentratingStationary` status alone, no change, no `rollMods`, with the
   kind held in its flag, and the actor stands under the status.
2. **The foe's claw at the ally** (GM seat, the ally targeted, the dice rigged
   to a hit). *Observable:* the stored attack card's modifier list holds one
   row named as lib words it for the circle on the ally, of minus the ally's
   `ac` part, and a recorded `ui.notifications.warn` is lib's ward notice for
   the ally and the foe.
3. **The stranger's claw at the ally.** *Observable:* no row names the circle;
   a recorded warning is lib's undetermined notice for the circle, the ally
   and the stranger (the ward notice may also be told, so its absence is not
   asserted).
4. **The ally's blade at the caster.** *Observable:* no row names the circle
   and no recorded notice names it.
5. **The foe's spell at the ally** (cast through the module on the GM seat).
   *Observable:* the stored resist has one part labelled as the circle whose
   value equals the circle's `save` part, and its base target less its target
   equals that value. Then the Judge's Undo on one modifier entry of each
   recipient: the cast's record is gone from both.
11. **Sharpness on the blade, a Player's cast.** The Player targets the ally
    alone and picks the blade in the dialog. *Observable:* the dialog's
    weapon list holds the ally's two weapons and keeps the pick; the card
    names the blade for the ally's entry; one record on the ally has no status
    and no change, every part naming the blade; on the blade's attack card the
    modifier list holds one row labelled `{spell} ({cite})` equal to the
    attack part, the damage list one equal to the damage part that fits a
    mundane weapon; the other weapon's attack carries no such row; Undo takes
    the record off.
12. **Twice.** The copy's attack figure is the import's plus one for the first
    cast, then the import's for a second cast thirty world-seconds later.
    *Observable:* two timed records and one row equal to the larger figure; past
    the first's end by the clock one record and the row equal to the smaller;
    past the second's end no record and no row.
13. **Beside masterwork.** The weapon is stamped with the tier and the walk
    reads the tier's imported attack figure `m` (importing the variations
    first when it reads none; where it still reads none the step fails as an
    import finding, "not reachable on this import"). The copy's attack figure
    `s` is set to `m + 1`, `m` and, where `m` is at least 2, `m - 1`.
    *Observable* on the attack card of the stamped weapon, in every case: the
    net of the weapon's own row and the spell's and yielding rows is the
    larger of `m` and `s`. With `s > m`: one spell row of `s` and one
    yielding row of minus `m`. With `s <= m`: neither row, lib's yielded notice
    among the recorded ones, and the cast card's dry run names what the entry
    yields to. Each case ends by the Judge's Undo and a check that the record
    is gone.
14. **Two creatures targeted.** *Observable:* the Player's dialog shows the
    one-bearer verdict as a block (its text the lang string for it) with Cast
    off, and cancelling spends nothing and posts nothing; the Judge's dialog
    shows it as a warning with Cast on.

### The held-cast steps

Walked inside the buff steps, between their 5 and 11, on the same fixtures: no
fixture is added. The circle copy is reshaped before each step to a duration of
the walk's own (stationary concentration; with a time after; with a longest
hold), and its figures are invented. The held record is the caster's
status-only record and the cast's trigger: every observable is the set of
records the world holds after the end, plus the one card of concentration's end
(`flags["acks-extras"].castHeldEnd`) found by its cast id since the step began.

6. **The caster is hurt, on the GM's client.** First the status is toggled off
   as the HUD does (`toggleStatusEffect(id, {active: false})`) on step 1's
   still-standing cast. *Observable:* one card of that cast, cause `removed`,
   the caster holding no held record. Then a fresh circle is cast at both
   tokens, and the caster's hit points are lowered through the token's actor
   on the GM client. *Observable:* the status and every record of the cast
   (the caster's and both recipients') are gone, exactly one card of the cast
   with cause `damage` lists both recipients as ended; the GM's rendering of it
   has the Restore button and the Player's has none; pressing Restore puts the
   same records back under the same ids and the status on again.
7. **The Player hurts its own caster.** The same lowering from the Player's
   client. *Observable:* every record gone and one card listing both
   recipients, authored by the Player, though the Player owns neither the ally's
   token nor its actor: the Player's client ended what it can write and the GM's
   client, asked through `magicHeldEnd`, ended the ally's.
8. **A time after concentration.** The copy carries a tail of three minutes.
   *Observable:* the caster's record carries the tail in its flag; after the
   loss the caster's record is gone and each recipient's is flag-timed from the
   world's now for three minutes; the card lists both as running on and none as
   ended; past the tail the clock removes both.
9. **A longest hold.** The copy carries a cap of four minutes. *Observable:* the
   caster's record is flag-timed (start and duration in its flag, no core
   duration); past the cap the clock ends everything of the cast with one card
   whose cause is `time`.
10. **A recast.** With the circle held, the Player opens the damage spell's
    dialog. *Observable:* the dialog shows the concentrating verdict as a
    warning with Cast on; confirming it posts the cast card, and the held
    records end with one card whose cause is `cast`, the caster holding
    nothing of the circle.

### The declaration steps

Walked at the end of the buff steps, in a Combat of the run's own (the one
document the run adds, tracked by its uuid). The fight is begun by writing
`round`, `turn` and `flags.acks.initDone` on it, never by `startCombat`,
and moved by `combat.update({round, turn})` and `combat.nextTurn()`. Each step
starts from the shape it needs: no pending record on the caster and the spent
slots at zero.

15. **A declaration, lost.** The Player opens the damage spell's dialog in the
    begun fight, before the caster's turn. *Observable:* its confirm button
    reads the lang string for Declare; confirming leaves a `casting` status, one
    pending record and the combatant's `prepareSpell` flag (written by the GM's
    client, which the walk waits for), spends the slot and the spell's count once
    and posts no cast card. The caster is then hurt: `casting` is gone, the
    pending record carries `lost` with the cause `damage` and the flag is clear.
    With initiatives set and the tracker on the caster's turn, the Player's
    dialog shows the declaration-lost verdict as a block with Cast off, and
    cancelling spends nothing; the GM's shows it as a warning, and its cast
    spends once and ends the lost declaration.
16. **A declaration, resolved.** In the next round a Player's declaration
    stands, and the tracker moves to the caster's turn. *Observable:* the cast
    resolves with no dialog, posts its card, spends nothing, and leaves no
    pending record and no flag.
17. **A declaration, lapsed.** A declaration made in a round, the tracker
    reaching the caster's turn and then passing it with no cast. *Observable:*
    the pending record is still there at the turn, deleted when the turn ends,
    the flag is clear, and the spend stands.

### Drive mechanics

- A cast starts with `item.use({skipDialog: true})`; the dialog is DialogV2
  and is found by `.acks-extras-cast-dialog`. Its Cast button is
  `button[data-action="cast"]`, and the form's `[data-cast-mode]` select
  picks the form, with a bubbling `change` after the value is set.
- Rig the dice with `CONFIG.Dice.randomUniform` (reads from the top: 0.025
  throws a 20, 0.975 a 1) and restore it in `finally`.
- Targets are set with `canvas.tokens.setTargets(ids, {mode: "replace"})` on
  the viewed scene, which replaces the seat's targets whole.
- A card button is pressed by its `data-action` (and `data-target`,
  `data-row`) inside `[data-message-id]` with the chat tab up; the entry
  settles when none is `pending` or `applying`.
- The walk's seats do not own the targets, so every apply from a Player
  goes through the GM client's relay: wait for the entry rather than the
  hit points.
- The buff steps' tokens are linked (`actorLink: true`) with an explicit
  disposition, read back after creation: the roll's scope reads the sides from
  the two tokens, and a record on a linked token's actor is the world actor's,
  which is what lib reads on the attacker.
- An attack is `token.actor.makeAttackThrow({item, attackType: "melee",
  skipDialog: true})` with the seat's targets set through
  `canvas.tokens.setTargets`; a rigged `0.025` throws a natural 20, so the
  attack hits and the damage list renders. The observable is the stored
  message: parse its `content` and read the `li` rows of each
  `.attack-throw-card__roll` block (the first is the attack, the second the
  damage), never the contributor's return. The weapon's own bonus is the row
  core labels for the weapon.
- Notices are recorded by wrapping `ui.notifications.warn` and `.info` in the
  page for the one attack, and restored in a `finally`. Expected texts are
  built in the page with `game.i18n.format` from the lang keys, so the
  comparison is to the module's own wording and the walk prints a boolean.
- Who wrote a record is the effect's `_stats.lastModifiedBy`; a card entry's
  `by` is the requesting user, not the writing client.
- A rendered card's cells are read at `.acks-extras-roll-card td.acks-nums`,
  whose tooltip is `dataset.tooltipText`; a dash cell counts, since a ward
  entry shows no figure.
- Masterwork is stamped through `setMasterwork` from
  `scripts/equipment/actions.mjs` (a bare flag leaves core's weapon row
  without the figure), cleared first so every case starts from the weapon's own
  figures. The tier's figure is read live with `masterworkFigure`; the
  variations are imported through `acksExtras.importer.importVariations()` when
  it reads none.
- A foe with no class casts through the claimant like any caster: capacity is
  unknown there and gives no verdict.
- Hit points are written on the GM client, the client whose apply path the
  step asserts (held step 7 writes them on the Player's, the client whose
  funnel it asserts).
- `nextTurn()` past the last combatant goes through core's `nextRound`, which
  resets initiatives and posts a "Round N has started" card with no speaker;
  declaration step 17 ends the caster's turn that way, as a user does. A move
  tracks the speakerless cards its own client authored during it, so the
  round card is swept with the run's.
- Tokens a step creates are paired with the actors asked for by `actorId`,
  never by position: a create answers in its own order, and a pairing by index
  hands a step another fixture's token.
- The held steps drive concentration's end by the real triggers: hit points
  written through the token's actor (lib's loss path), `toggleStatusEffect`
  with `active: false` (the HUD), and the clock (`game.time.advance`). A card of
  the end is found by its flag and cast id with a `timestamp` at or after the
  step's start; the funnel posts it asynchronously, so poll for it. Restore is
  pressed in the chat tab on the GM seat, which has the button; the Player's
  rendering of the same message has none.
- The declaration is made by clicking the dialog's confirm, and a Player cannot
  update a combatant, so the flag lands only after the GM's client has handled
  `magicDeclareFlag`: poll for it. A resolving cast is started with
  `item.use({skipDialog: true})` and no dialog should open; the observable is the
  card appearing with no dialog element.
- A record is taken off by the Judge's Undo (or by the clock, in the step that
  walks the clock) before the next step counts records, since a standing one
  resolves against the next.

### Teardown

The walk lists the cards speaking as its fixtures since it began and the
caster's own records, tracks them with its tokens, and `sweepTracked` deletes
exactly that list. It resets the caster's spent slots, restores the dice and
clears each seat's targets. The fixtures stay.

The buff steps add the records their casts left, found by the cast ids the
walk recorded, on the fixtures that carry a marker of this walk's; the tokens
(by their uuids) and every attack and cast card, tracked by id as each is made.
Nothing is deleted by name, folder or pattern. A record an earlier run that
died left on the ally, the foe or the stranger fails the buff steps' first
check: delete it by its id, then run again.

The held and declaration steps add: the caster's held records of the run's casts
are deleted first, by their cast ids, and the funnel's own cards of those casts
(found by the `castHeldEnd` flag, the cast ids and the run's start) are tracked
with the rest; the run's Combat is tracked by its uuid and swept with them.
