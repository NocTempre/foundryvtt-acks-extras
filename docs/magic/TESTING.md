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

Placing is also a pointer problem. While `TokenLayer#placeTokens` is pending,
a pointer inside the 50 px edge band edge-pans the canvas until it clamps, and
the Place button leaves the pointer in that band, so a scan taken then reads a
view that keeps moving and finds no bare point. The walk sends a CDP
`mouseMoved` to the viewport's middle before every pan, scans only points at
least 60 px from every edge, and on a miss logs the view it scanned (pivot,
scale, the root pointer event's client point, `document.hidden`). A walk that
fails with a placement pending right-clicks it away, so the next step does not
inherit a live preview.

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
18. **A declaration resolves on its declared targets.** In a begun fight the
    Player targets two fixture tokens and declares the damage spell. The Player
    then targets a third token instead and the tracker reaches the caster's
    turn. *Observable:* the cast resolves with no dialog; the card's targets are
    the two declared; the Player's targets (`game.user.targets`) are those two and
    not the third; the slot is not spent again. Then a second declaration at the
    two, one of the two tokens deleted from the scene, and the turn reached.
    *Observable:* the dialog opens, its bucket holds the one remaining token, its
    mode, picks, level and situational figure are those declared, the notice
    says one declared target is no longer there, and nothing is spent. Cancelling leaves the
    pending record and the flag, as a cancelled cast does.

    Drive: step 17 ended the caster's turn through core's `nextRound`, which cleared every
    initiative, and a caster with no initiative is never at its turn (the cast declares
    instead). The step sets the initiatives again after moving to its round, before it
    declares. At its end the step sweeps its fight by uuid (the steps after it open their own,
    and a caster held by two begun fights answers to the first).

### The lost-item steps

Walked after the declaration steps, in `tools/live/magic-cast-spell.mjs`
(`walkLostItem`). Nothing here needs a tradition procedure with a bucket of its
own: the strip reads the stored answer, so the walk writes the pending record
itself. Every document the steps make comes from `api.create` and is tracked by
its uuid for the run's sweep (a setup the run builds, not a kept fixture): five
`item` copies on the caster (`api.create("Item", …, {parent})`, each with a stack
of two), one monster actor the Player has no ownership of, and three pending
records written as the declaration's own flag shape
(`flags.acks-extras.spellEffect`, role `caster`, a `pending.procedure.buckets.kit`
naming the items, a `combatId` no fight carries so no turn ever reaches it).
The step sweeps its own uuids (`api.sweepTracked({only})`) when it ends, so no
later step finds a pending record or one of these items on the kept caster.

1. **A lost item leaves the declared answers.** The first record, on the caster,
    names three items. *Observable:* the GM deletes one and, within a few
    seconds, the record's `kit` holds the other two and no more; an item named by
    no record, deleted, leaves the record as it was; a stack emptied with
    `system.quantity.value` set to 0 takes its item out of the record and the
    item itself stays; the last deletion leaves `kit` an empty list, not
    absent. A second record on the caster and a third on the monster actor each
    name one item; the Player seat reads `canUserModify` as true for the first
    and false for the second. The Player deletes that item. *Observable:* both
    records lose it, the third by the GM's client (the Player's client asked for
    it through `magicLostItem`).
    The strip runs on the client that made the change, so a delete by the
    Player's seat and one by the GM's seat are the two cases; a delete by a
    peer client is that client's to strip.
2. **The band's heading names the tradition.** The page registers a procedure
    for the class fixture's tradition kind with one number field, so the band
    draws, and takes it off in a `finally`. With a `label` key it supplies
    (an existing lang key, so it localizes), the dialog's band heading reads that
    key's text; with none, it reads the tradition's own label from the class
    fixture, and neither is the generic Invocation string. The heading read is
    that of the band holding the procedure's own field, since the Targets band
    has a heading of its own. Both read from the Player's seat by opening the
    damage spell's dialog and cancelling it, which spends nothing.

*Drive mechanics.* A procedure registered for the class's tradition kind claims
every spell of that tradition while it stands, so the page takes it off before
any other cast is driven. The record carries no `held` and no `tail`, so no
other hook reads it.

### The defense steps

Damage against a target's immunities, resistances and susceptibilities, for a
cast and for a weapon hit (lib MODEL, "Damage against defenses"). The spell is
`magic/cast-spell-damage` (a flat roll, a half save, no throw), cast by the Player
at one targeted token at a time. The walk reads the type its damage row lists
(`rowsOf(spell)`, the row's `damage`) and writes it into the bands below; it never
types a figure or a type of its own, and asserts relations.

Fixtures, found by marker and kept. Each step starts by writing the shape it needs
on the stat block (`flags.acks-extras.extras.defenses`: each of `immunities`,
`resistances` and `susceptibilities` with `damage` set to the row's type, the
quality flags false, no `note`) and by resetting the hit points to 20, since a
kept fixture carries whatever the last walk left.

| Marker | What it is |
|---|---|
| `magic/defense-immune` | A GM-owned monster, a hostile linked token on `magic/cast-scene`, whose `immunities` band lists the row's type. |
| `magic/defense-resistant` | The same, whose `resistances` band lists it. |
| `magic/defense-susceptible` | The same, whose `susceptibilities` band lists it and whose `factor` the step writes (a whole number above 1). |

The `defenses` document's resistance figures (`fraction` and `saveBonus`, read with
`defenseFigures()` in page context) are the import's where the world has them;
where they are blank the resistant steps walk the Judge path, and the report says
which path ran. The walk never writes a figure into the Ruledata Browser.

18. **Immune.** Cast at `magic/defense-immune`. The target passes its save with no
    roll. *Observable:* the stored resist has `auto` and a null `total`, the card's
    save column reads the lang string for Auto, the entry is `applied` with
    `applied` 0, its `steps` hold one defense step whose `band` is `immunities`
    and whose `types` are the row's, and the hit points stay 20 with no write. The
    GM's tooltip on the figure names the source; the Player's, who owns neither
    the token nor its actor, reads the lang string for "a defense", and the stored
    card content names neither.
19. **Resistant.** Cast at `magic/defense-resistant`. With the figures imported:
    the save's target is the base less `saveBonus` (a part labelled by the band),
    and with the save failed and then passed (the dice rigged both ways) the
    applied amount equals the rolled amount through the fraction, the resistance
    and one half-even rounding, read back from `steps` and checked against
    `amountAfter` run in page context over the same figures. With them blank: the
    save's target is the base, the resist lists `defensePending`, the entry is
    `judge` with a `defense` whose `why` is `figure`, the hit points stay 20, the
    line names the defense and the page reference and its tooltip is that
    reference alone, and no Apply shows on it.
20. **Susceptible, and the cases between.** Cast at `magic/defense-susceptible`
    with the factor written: the applied amount is the rolled amount times the
    factor, through the same rounding. With `factor` blank the entry is `judge`
    (`why` `figure`). With the row's own type in the susceptibility band and in
    the resistance band at once, the entry is `judge` too (`why` `mixed`), and
    so is the row's mark read as unstated against a band that sets a quality flag
    (`why` `quality`).
21. **The relay.** The Player casts at a token it does not own: the GM's client
    applies the same amount the owner's path would, read from the target's actor
    on the GM's client, and the entry's `by` is the Player. *Observable:* the
    entry matches step 19's relations; a request the walk sends with an `auto`
    resist at the resistant target (where the GM's client recomputes no pass) is
    answered `badResist` and writes nothing.
22. **A weapon hit's Apply.** The weapon stamp carries the weapon's own types
    (`system.damage.base`), not the spell's, so the step first rewrites the three
    bands to those types. The GM's weapon attack at each of the three targets
    (the dice rigged to hit) leaves a card with no core `applyDamage` button and
    the lib block under it. *Observable:* an Apply at the amount `planAttackApply`
    gives in page context at the immune and susceptible targets; no Apply, and the
    defense named with its page, at a target on the Judge path. Pressing Apply
    writes once and Undo puts the hit points back. A carrier's card (a spell's
    thrown row) has no block, since the cast applies it.

### Instances

Walked by `tools/live/magic-cast-widen.mjs` after the defense steps, with the
fixtures of "Fixtures" and these. The spells are copies of imported spells on
the caster whose rows the walk reshapes from the library original's flag, as the
buff steps do: the walk writes the counts, caps and rolls it needs, so every
figure it asserts is one it wrote and no printed count appears in the recipe.

| Marker | What it is |
|---|---|
| `magic/widen-spell-<id>` | A copy of an imported spell on `magic/cast-caster` with one damage row carrying a `delivery`, a flat roll and a per-level `value` with a flat `max` (both written by the walk), and a second copy with the same row and no `delivery`. `<id>` is the cookbook id the copy came from. |
| `magic/widen-target-a`, `-b` | Monsters only the GM owns, each reset to 40 hit points, with a linked token on `magic/cast-scene`. |
| `magic/widen-token-off` | A token of `magic/widen-target-b` on a second scene that is not in view. |

Each step asserts the shape it needs at its start (hit points, no record on a
target, the row's count and cap) and never relies on the last step's leavings.

1. Cast the thrown copy at two targeted tokens, the caster level raised past
   the cap. *Observable:* the dialog offers a split with one input per target,
   defaulting to round-robin; its tooltip names the count, the caster level, the
   cap and the page; the card's row holds the count equal to the cap, and
   `card.allocation[rowKey]` the typed split, summing to the count.
2. Type a split that sums to one more than the count. *Observable:* the Player's
   dialog shows the verdict as a block, Cast disabled and nothing spent after
   Cancel; the Judge's shows a warning and Cast stays on, and the Judge's cast
   throws the split as typed.
3. Cast with the dice rigged to alternate hit and miss across the throws.
   *Observable:* one core attack card per instance, in order, each aimed at its
   own target (the card names that token); one entry per target and row holding
   one instance per allotted throw; the amount applied is the sum of each hit
   rounded alone through that target's defenses, the token's hit points fall by
   exactly that sum in one write, and one Undo restores them. The seat's targets
   after the cast equal the targets it had before it. Check first, in page
   context, that `game.user.targets` holds the one token immediately after
   `canvas.tokens.setTargets`, with no wait.
4. Cancel core's dialog on the second throw. *Observable:* the entry reads
   Throw, its first instance holds its figures, and the Throw press throws only
   the instances that wait, each at its own token, then applies.
5. Show the second scene and cast at the token on the first: the instance stays
   at Throw and a notice names the token. Press Throw with the scene shown again.
6. The Player seat casts at a token it does not own. *Observable:* the GM's
   client applies each entry. In page context on the GM client, send
   `magicCastApply` for the same card with one more hit than the entry holds,
   with a hit outside the roll's bounds, and with a card whose split sums over
   the count (written by the Judge for the check): each is refused with
   `tooManyInstances` or `badAmount` and the target's hit points do not move.
7. The copy with no throw, cast with the count above one. *Observable:* one
   roll, its formula the row's dice times the count, its total within that
   formula's bounds, and the relay accepts it as the amount.
8. Reshape a copy so `unread` lists `value`, and cast it. *Observable:* no roll
   and no throw, the card's row shows the page reference alone, no entry, no
   Throw press.

Teardown: sweep the run's tracked uuids; restore no seat's targets by hand, since
the cast restores them and step 3 asserts it.

### Gates

Walked by `tools/live/magic-cast-widen.mjs` after the instance steps, on the
GM and Player seats, with the fixtures of "Fixtures" and "Instances" and these.
Every figure a step asserts is one the walk wrote at its start: the size key is
read from the world's imported monsters vocabulary (`Object.keys` of
`acksExtras.monsters.config.SIZES`, the last key being the largest), and the Hit
Dice and thresholds are the walk's own numbers, so no printed figure appears here.

| Marker | What it is |
|---|---|
| `magic/widen-huge` | A monster only the GM owns, with a linked token on `magic/cast-scene`; its stat block's size is set at the start of each step to the largest key the world imported, and its Hit Dice to the walk's own figure. |
| `magic/widen-spell-<id>` | The copy of the instance steps (one damage row with no `delivery`, a flat roll and a save), whose Overview `hdCap` and `exemptBelowHd` are written at the start of each step through the sheet's Overview tab, and whose row's `exemptSizeFrom` is written through the row editor. Blank unless a step sets it. |

Each step asserts the shape it needs at its start (the target's Hit Dice and
size read back through lib's `monsterHd` and `sizeKeyOf`, hit points reset, no
record on the target) and never relies on the last step's leavings.

1. Set `hdCap` to one below the target's Hit Dice and cast at the target and at
   `magic/widen-target-a` (Hit Dice at or under the cap). *Observable:* the
   over-cap target's line reads Exempt with a tooltip naming its Hit Dice, the
   cap and the page; no save is rolled for it (the cast's rolls hold one save,
   not two), no Apply press stands, its hit points do not move and no record
   lands on it; the other target is saved against and applied as before.
2. Set `hdCap` equal to the target's Hit Dice. *Observable:* the cap is
   inclusive, so the target is applied as any other.
3. Blank `hdCap` and set `exemptBelowHd` one above the target's Hit Dice.
   *Observable:* the card shows No save in the target's save column with a
   tooltip naming the Hit Dice, the threshold and the page; no save die is among
   the cast's rolls; with a "half" save the whole amount is applied; a condition
   row's record lands. Set it equal to the Hit Dice: the save is rolled.
4. Give the damage row `exemptSizeFrom` equal to the target's size key, and add
   a second row (a condition) with none. *Observable:* the damage line reads
   Exempt with a tooltip naming both sizes; the condition row on the same target
   applies. Set the row's key one size larger than the target's: both apply.
5. Scale `hdCap` by level and cast on a caster with no resolvable level, the
   dialog's level field left blank. *Observable:* the dialog asks for a caster
   level; confirm with none and the cap gates nothing, since a level is never
   defaulted.
6. From the Player seat, send `magicCastApply` to the GM's client for a card
   whose over-cap target's entry the Judge wrote pending for the check, and for
   a card whose no-save target carries a rolled pass. *Observable:* each is
   refused, with `exempt` and `badResist`, and no hit points move. Send one for
   the card of step 3 as it stands: it applies once, as a failed save.
7. Reshape the row with a `delivery` and a count of two, `hdCap` under the
   target's Hit Dice, and cast at `magic/widen-huge` and `magic/widen-target-a`.
   *Observable:* no core attack card is made at the exempt token, and both throws
   are dealt to the other.

Teardown: sweep the run's tracked uuids (tokens, cast cards and the core attack
cards, each tracked by id as it is made). The fixtures stay; the next walk's
first step rewrites their size and Hit Dice and blanks the copy's gates, and
nothing is deleted by name or marker pattern.

### Record lives

Walked by `tools/live/magic-cast-widen.mjs` after the gate steps, on the GM and
Player seats. A condition row whose `lasts` is `nextTurn` or `rounds` writes a
record with lib's `turnLife` flag and the flag clock (MODEL, "A record that
lives"). The walk needs a begun fight, so it makes one: a Combat on
`magic/cast-scene` created for the run (not a kept fixture: its turn order is the
state under test), holding the caster's token and `magic/widen-target-a`'s, with
initiative rolled and the fight started. It is tracked by uuid as it is made and
swept with the run's other leavings. No figure is printed here: every count is
the one the walk rigs or reads back.

| Marker | What it is |
|---|---|
| `magic/widen-spell-blindingFlash` | The copy of the imported `def.spell.blindingFlash`; its condition row is `lasts: nextTurn` as imported. |
| `magic/widen-spell-kindleFlame` | The copy of the imported `def.spell.kindleFlame`. Its imported burning row lasts `duration`, and the imported `rounds` figure sits on its `ignite` row, a different option of the spell's choice group, so a cast of the creature option has no rounds figure of its own: the step writes `lasts: rounds` and a `rounds` formula on the burning row through the row editor (a step's own formula, rigged by the dice) and blanks it again in the step after. |

Each step asserts its shape at its start (the fight's current turn, no record of
an earlier run on the target, the row as the step needs it).

1. In the fight, on the caster's turn, cast Blinding Flash at the target.
   *Observable:* one record on the target carrying `blinded`, with
   `flags["acks-extras"].turnLife` equal to `{combatId, combatantId: <the target's
   combatant>, edge: "end", count: 1, seen: 0}` and the spell flag's `duration`
   one round with `startTime` the world time; the entry's tooltip names the end
   it was written with and the page.
2. Advance the tracker to the target's turn, and then past it. *Observable:* the
   record stands at the target's turn start and is gone once its turn ends
   (poll: lib lifts it on the primary GM's window); the `blinded` state ends with
   it. Cast again during the target's own turn: the record survives that turn's
   end, since that turn began before it, and goes at the end of the next.
3. Outside a fight (the fight ended, or a cast on a token no fight holds), cast
   it again. *Observable:* the record has no `turnLife`; `game.time.advance` one
   second short of a round leaves it and a step to the round deletes it by id.
4. In the fight, cast at a token that is not one of its combatants. *Observable:*
   the record carries the clock only, and the entry's tooltip says the bearer
   holds no turn.
5. On the kindle copy, write the burning row's lifetime, rig the dice for the
   count, and cast in the fight. *Observable:* the entry reads the formula, the
   rolled detail and the count; the record's `turnLife` is `{edge: "start",
   count: <rolled>, seen: 0}`; after one fewer turn starts of the target than the
   count it stands with `seen` one fewer than the count, and the start that
   reaches the count deletes it. A step to the round past the clock's end of
   the rolled rounds, taken instead, deletes it by the clock; whichever comes
   first, one delete and no second.
6. Blank the burning row's formula and cast. *Observable:* the record is written
   with no duration, no start and no `turnLife`; the entry's tooltip is the page
   reference alone and its line says nothing of a lifetime.
7. From the Player seat, send `magicCastApply` to the GM's client for a card whose
   condition entry carries a count outside the formula's reach, one inside it and
   none. *Observable:* the first and the last are refused with `badRounds`, the
   middle applies once, and the record's `turnLife.count` is that count.

Teardown: the run's Combat, cast cards and records are swept by the uuids and ids
the walk tracked as it made them; the copies and the fixtures stay, and the
kindle copy's row is left blank of a lifetime, as imported.

### Recurring prompts

Walked by `tools/live/magic-cast-widen.mjs` after the record-lives steps, on the
GM and Player seats (MODEL, "Recurring rows"). The walk's Combat is created for
the run and swept with it, as the record-lives steps' is: the prompts follow the
turns, so a fight is the state under test, and a turn is advanced with the
tracker's own `nextTurn()`. No figure is printed here: every count and total is
rigged by the dice or read back.

| Marker | What it is |
|---|---|
| `magic/widen-spell-thunderclap` | The copy of the imported `def.spell.thunderclap`: a damage row that resolves at the cast and a deafening condition row that recurs `laterRounds`, `bearerEnd`, `recurSave: row`. |
| `magic/widen-spell-chokingGrip` | The copy of `def.spell.chokingGrip`: a held cast whose damage row recurs `eachRound`, `casterTurn`, `recurSave: cast`. |
| `magic/widen-spell-mageMissile` | The copy of `def.spell.mageMissile`: a damage row that recurs `eachRound`, `casterTurn`, `recurTarget: pick`. |
| `magic/widen-spell-kindleFlame` | The copy of `def.spell.kindleFlame` (record lives, above). |

Each step asserts its shape at its start (the fight's current turn, no record or
prompt of an earlier run on the fixtures, the row as the step needs it). A prompt
is found by its `recurOf` flag and the run's cast id; it is posted
asynchronously on the primary GM's window, so poll for it.

The Save steps need a bearer the Player seat owns and one it does not, which the
other steps' fixtures are not by default (Drive mechanics): `magic/widen-target-a`
is the owned bearer and `magic/widen-target-b` the one that is not. The first
step sets the Player seat's ownership of `magic/widen-target-a`'s actor to Owner,
asserted at its start since a kept fixture carries what the last walk left, and
the walk's last step sets it back by the same write. `magic/widen-far` is the
token beyond the spell's range, and is no bearer.

1. In the fight, cast Thunderclap on the caster's turn at `magic/widen-target-a`
   and `magic/widen-target-b`. *Observable:* the cast writes the deafened record on
   each target that did not save, carrying its `rowKey`, and the damage row
   applies at the cast as any row does.
2. Advance the tracker to the end of `magic/widen-target-a`'s turn. *Observable:*
   one prompt card whose flag `recurOf` names the cast, the round and `moment:
   "bearerEnd"`, with one target and a Save on that row, nothing rolled; the
   Player seat that owns the target sees Save, a seat that does not sees none.
   Press Save as the owning Player with the dice rigged to pass. *Observable:* the
   entry reads Saved, that target's deafened record is gone, the other target's
   stands (its own prompt is at its own turn end), and the GM seat's card shows
   the figure's tooltip with the page.
3. Repeat the turn with the dice rigged to fail. *Observable:* the entry reads
   Failed, the record stands, and no second prompt is posted for the same round
   and bearer when the tracker is stepped back and forward.
4. From the Player seat, send `magicCastSave` for `magic/widen-target-b` (a bearer
   it does not own) and `magicCastRoll` for a prompt whose card a Player authored.
   *Observable:* the first is refused `notOwner`, the second `notAuthor`, and
   nothing is written.
5. Cast Choking Grip from the caster's turn at the target, a held cast. Advance
   to the caster's next turn. *Observable:* a prompt at `moment: "casterTurn"`
   with the target and a Save. Press Save as the target's owner rigged to fail:
   the damage is rolled and applied in the one press, with the target's defenses
   as a cast's, and the caster's record stands. Advance to the next caster turn
   and press Save rigged to pass. *Observable:* the caster's held record is gone,
   the target's records of the cast are gone, and the end card names the cause "A
   passed saving throw" and lists what ended; Restore (GM) puts them back.
6. Cast Magic Missile and advance to the caster's turn. *Observable:* a prompt at
   `moment: "casterTurn"` with one line and a Roll and no target. As the caster's
   Player, target one token within range and press Roll: the damage is rolled
   there, applied to that token by the GM's client, and the line now names the
   target. Target `magic/widen-far` out of range and press Roll: a Player is
   refused with the range notice and nothing is sent; the GM is warned and the
   press goes through. Pressing Roll a second time on the same prompt is refused
   `applied`. A press with two tokens targeted, or none, says so and sends
   nothing.
7. On the kindle copy, cast in the fight with the creature option and advance to
   the target's turn start. *Observable:* a prompt at `moment: "bearerStart"`
   whose row is the burning damage, with a Roll for the caster's owner and none
   for the target's Player; pressed, the damage applies to the target. The
   rounds the burning lasts are the burning row's own `lasts` (record lives,
   step 5). Cast the objects option on the same copy at a token: the `ignite`
   row writes that recipient's status-free record carrying `rowKey` and, in a
   fight, `turnLife` `{edge: "start", count: <rolled>, seen: 0}`, and lib deletes
   that record by id at the start of the token's turn that reaches the count; the
   entry's tooltip names the roll and the end written.
8. Outside a fight (the Combat ended), cast Thunderclap and press **Next round**
   on its card as the caster's Player. *Observable:* the round's prompts are
   posted by a GM (message author a GM), each moment with its bearers; a second
   press posts round two's, and `castCard.recurRound` reads 2. Press it as a
   Player who does not own the caster: refused `notOwner`. Press it in a fight
   that holds the caster: refused `inFight`.
9. With no GM connected (the GM seat closed) advance a turn: no prompt is posted,
   and Next round answers that no Judge is connected. Reconnect the GM seat and
   press it: the prompts are posted. Last, set the Player seat's ownership of
   `magic/widen-target-a`'s actor back to what step 1 found.

Teardown: the run's Combat, cast cards, prompt cards, end cards and records are
swept by the ids the walk tracked as it made them (a prompt is the GM client's
write, so it is tracked by the flag and the cast id read back, and listed by id);
the copies and the fixtures stay.

### Drive mechanics

- A cast starts with `item.use({skipDialog: true})`; the dialog is an
  ApplicationV2 found by `.application.acks-extras-cast`. It re-renders on
  every change, so read the live element again after each step rather than
  holding the first one. Its Cast button is `button[data-action="cast"]`; the
  form is the `input[name="mode"]` radio (a bubbling `change` after `checked`
  is set), a choice's option is `input[data-pick="<group>"][value]`, a weapon is
  the `.acks-extras-cast-pill[data-weapon]` button of a target row.
- The targets bucket (`.acks-extras-cast-targets`) is the seat's own targets.
  Drive it as a user does: a row's X is `[data-action="untarget"]` inside
  `.acks-extras-cast-trow`; T is `canvas.tokens.get(id).setTarget(true,
  {releaseOthers: false})`; the Add my token button is `[data-action="addMine"]`
  and needs the caster's token on the viewed scene; a drop is a real
  `DragEvent("drop", {dataTransfer, bubbles: true})` on the bucket whose
  `text/plain` is `JSON.stringify({type: "Actor" | "Token", uuid})`. An Actor
  drop targets only where the actor has exactly one active token on the scene,
  and the notices (none, several) are read through the `ui.notifications.warn`
  wrap. Wait about 600 ms after a step: the window re-renders on the
  `targetToken` hook after a short debounce. `tools/live/magic-cast-spell.mjs`
  section 1b walks X, T, an Actor drop, a Token drop and Add my token with a shot
  after each, and checks with `H.bucketOf` that the footer sits outside the
  scrolling body. A damage spell has no row a seat picks among, so it renders
  no effect cell; the tone cells are read on the kind pick
  (`magic-cast-buffs.mjs` step D).
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

The defense steps add the cast cards and the weapon attack cards they posted, each
tracked by its id as it is made, and the hit points are reset to 20 on the
three fixtures, which stay. A band the steps wrote on a fixture is rewritten by the
next walk's first step, never deleted by a search for it.

## Tracked rows and the built summons

Walk: `node tools/live/run.mjs magic-cast-tracked`, on the GM and Player seats,
with the GM seat's own RR open (the walk imports its thirteen
spells by cookbook id and stops `blocked` when the book is not open). It walks
the tracked kinds (illusion, detect, light, dispel, createObject, wall), a
reversed twin, the five built summons' rows and a concentration summoning's
held record (MODEL, "The tracked kinds", "Casting a summoning spell"). Its
assertions are relations between what the card or the world holds, never a
printed figure, a card line or a spell name.

### Fixtures

Found by marker with `api.fixture`, built when nothing carries it, and kept.

| Marker | What it is |
|---|---|
| `magic/tracked-scene` | A gridded field, no vision, global light, both seats view it. |
| `magic/tracked-class` | An `acks-extras.class` item with one vancian tradition, nine first-level slots. |
| `magic/tracked-caster` | A character the Player owns, bound to the class, level 5, spells enabled. |
| `magic/tracked-spell-<slug>` | A copy of each of the thirteen imported spells on the caster: eight tracked (one per kind, an instant detect, two reversed twins) and the five summoning spells. Each step rewrites its copy's flag from the library original, with a fixed two-hour duration of the walk's own on the tracked ones and no range. |
| `magic/tracked-held-a`, `-held-b`, `-timed` | Three hand-built summoning spells on the caster: one summon row naming the creature, a mobile concentration with a tail of the walk's own, a stationary concentration, and a fixed two hours. Each flow rewrites them. |
| `magic/tracked-creature` | A monster nobody but the GM may observe, which the three hand-built spells name by uuid. |
| `magic/tracked-target` | A monster with a linked token, for the aimed casts and the fight. |

The first step asserts each imported spell carries the register's row (the kind,
its `lasts`, a reversed twin where one is authored), and stops `blocked` when the
kept caster carries a spell record or a summon of a run that did not sweep:
remove it by its id and run again. A copy imported before the rows were authored
fails that check; re-import it (the Spells repair).

### Steps

1. *Each tracked kind, cast from the Player seat with no target held.*
   *Observable:* the card carries one line for the row, its footnote is that line,
   and the cast made one cast card beside the system's spell card the spend
   posts, with no roll and no row, target or entry in the card's model. A row that lasts the duration leaves exactly one caster record
   timed by the walk's duration; the instant detect and the dispel leave none.
2. *A reversed twin, cast in each mode.* *Observable:* the dialog offers the
   reverse mode; each form posts one line, the reverse card's note says
   reversed and the normal card's does not, each footnote is its card's own line
   (the two lines may read alike: the twins differ in key and the reversed flag
   alone), and each cast writes its own one caster record.
3. *A dispel row with no delivery, cast untargeted and aimed at a token.*
   *Observable:* the card has no section, no button and no entry either way.
4. *The five summon rows, read through the module's own reader on the Player
   seat.* *Observable:* one summon row per copy, a control on each, a format
   and a creature ref where the register reads one; a count over a located
   amount is refused `badCount` and the amount is not; the spell that states
   no amount refuses no count, and the one carrying a caster-level ceiling
   carries it unresolved on the row. The two rows that name a creature resolve
   to one: the walk imports the creature as setup when the Monster Manual is
   open on the GM seat (SKIP only when it is not, naming why). Pressing
   Cast on those two from the GM seat opens the creature prompt with the row's
   one choice, labelled, the count open above one; closing it writes no record.
5. *A concentration summoning, on each seat* (Character sheet → Magic tab →
   Cast; the Player seat, then the GM seat). *Observable:* the first cast places
   one creature, spends one, posts one card and writes the held record: the
   `concentrating` status, the kind held, the tail, a start time, no clock.
   Cancelling the second summoning's pick keeps the same record with no warning,
   card, creature or spend. Casting it warns once, naming the caster, the held
   cast and the new spell, and the warning's log shows the old record still
   standing and no end card for it yet; then the old record is gone, its end
   posted one card with the cause `cast`, and the new record is the one held, of
   the stationary kind; both creatures stand.
6. *Ending the held summons, on the Player seat, by the status's toggle.*
   *Observable:* one funnel card for the cast with the cause `removed`, Restore
   and no Dismiss; every creature still stands.
7. *A summons in a begun fight.* *Observable:* with a fight begun and the
   target first in the order, the Player's summoning places its creature, spends
   one, posts one card and leaves one record; no `casting` status, no pending
   record, no declared flag on a combatant and no declared notice.

### Drive mechanics (learned live)

- The mechanics of "Casting a summoning spell" apply: unpause the world, close
  every framed window, real CDP clicks, and `item.use()` unawaited (the prompt is
  the answer). Each seat's page is brought to the front before its clicks, since
  both seats place here, and each click point is chosen apart from the earlier
  ones so a placement never lands on a standing token. The pointer is parked
  mid-viewport before each pan, as "Casting a summoning spell" describes.
- The order of a warning and an end is read from the world and never from
  clocks: the warning patch logs, at the moment it fires, the caster's held
  cast ids and the cast ids with an end card.
- The tracked casts hold no target and give the spell no range. A stale target
  range-blocks a Player's cast of a spell that only creates an effect (a
  roadmap row); where the Player's dialog still blocks, the walk casts from the
  Judge's seat, with no target either, and prints a GAP.
- A copy's duration is the walk's own so that a record's absence is the row's
  doing; an imported duration may be untimed or held, which writes none or
  another record. The hand-built summoning spells carry the shape they test.
- The cast dialog is the ApplicationV2 window of "Casting a spell (the cast
  engine)", "Drive mechanics": the walk's `cast` finds it by
  `.application.acks-extras-cast`, reads the live element again after every
  change, and picks a form with the `input[name="mode"]` radio, which the header
  draws only for a spell with more than one form (the reversed twin's step reads
  the forms offered from those radios; a spell with one form lists none).
- A summons' tokens are found by the summoner's flag on the world, never by
  position; a created world copy of the named creature is the run's only where
  none stood before it.

### Teardown

Everything the run made is tracked by uuid as it appears: tokens, cards, the
caster's records by cast id, the funnel's end cards, the world copy of the
creature where none stood, and the Combat. The caster's held records of the
run's casts are deleted first, by cast id, so their funnels post their cards
before the cards of the fixtures since the run began are listed by id; the sweep
deletes exactly that list and its result is quoted. The fixtures stay, and the
world is paused again if the run unpaused it.

## Saves, gates and record lives (S4)

Walk: `node tools/live/run.mjs magic-cast-saves`, on the GM seat. The spells it
casts are invented world spells on invented names, each rewritten at its step from
rows the walk authors (`spellFlag` and `rowOf` of `tools/live/_magic-cast-kit.mjs`,
which the two spell-effects walks share); no figure of a book is in it. Its first
stage imports seven register spells through the importer when the seat's RR is open
and reads the kinds of the rows they carry (SKIP when the book is closed); the
register's located figures are printed as booleans and never compared.

### Fixtures

Found by marker with `api.fixture`, built when nothing carries it, and kept.

| Marker | What it is |
|---|---|
| `magic/saves-scene` | A gridded field, no vision, global light, the GM seat views it. |
| `magic/saves-class` | An `acks-extras.class` item, one vancian tradition, nine first-level slots. |
| `magic/saves-caster` | A character the Player owns, bound to the class, level 5, spells enabled. |
| `magic/saves-spell-<slug>` | Ten invented spells on the caster (`gate`, `kind`, `negate`, `none`, `toggle`, `slay`, `destroy`, `lift`, `ends`, `follow`), each rewritten whole at its step: the old flag is deleted first, so no stale key survives. |
| `magic/saves-m-a`, `-m-b` | Two linked monsters, brought to known hit points, Hit Dice, saves and creature kinds at each step's start. |
| `magic/saves-w-a1`, `-a2`, `-b1`, `-b2` | Two weapons on each monster, brought to no destroyed mark and one equipped at the destroy step's start. |

A kept monster may carry records of an earlier run that died. Every step starts by
deleting the records cast by one of this walk's own casters (the caster's marker
matches `^magic/saves-`) and the run's own cast ids, by id.

### Steps

1. *A strict Hit Dice gate.* Hit Dice 3 and 4 against a bound of 4. *Observable:*
   the bucket marks the target at the bound `is-off` before the cast; after it the
   lower target's entry is applied and it holds the condition, the one at the bound
   has `state: "exempt"` with `gate.key: "hd"`, made no save (`resist` null) and
   holds nothing.
2. *A creature-kind filter.* An undead and an animal against `filters: ["undead"]`.
   *Observable:* the animal is off in the bucket, exempt with `gate.key: "kind"`,
   and holds nothing; the undead holds the condition. The refused target carries a
   wrong kind: a creature of no known kind is never gated.
3. *A save that negates, and `none`.* *Observable:* a passed save leaves an applied
   entry with `saved: true`, no `recordIds` and no condition; a failed one writes
   the record and the condition. A spell whose save is `none` makes no throw
   (`resist` null) and writes the condition.
4. *Ruling 126's save toggle.* *Observable:* with a modifier read, the toggle is
   enabled and off and the save band lists no part of the spell's; switched on it
   lists one part, signed; the card keeps `saveMod`, and the throw's formula
   carries the modifier as a roll term (`1d20 +n`) while `resist.target` and
   `baseTarget` stay put: the spell's part is roll-side, which lib `saveThrow`
   folds into the formula. A `spell:save` part is on the throw; with the
   modifier blank the toggle is `disabled`.
5. *A slay row.* *Observable:* a passed save leaves the hit points and an entry that
   saved; a failed one takes them to zero and leaves the `dead` status.
6. *A destroy row, a weapon per holder (ruling 124).* Two monsters of two weapons
   each, a count of two. *Observable:* each holder's row offers a pill per weapon
   with the picked one `is-on` and the second holder's default its equipped weapon;
   after the cast the weapon picked for the first holder is marked destroyed and the
   other is not, the second holder's default is marked and its other is not, and
   every weapon is still carried: the module marks a weapon and never deletes it.
7. *A lifting row.* A hand-made `frightened` effect on the target. *Observable:* the
   entry is applied with no save and names what it lifted; the effect and the status
   are gone.
8. *A record that ends on damage.* *Observable:* the record's flag names `damage`;
   lowering the bearer's hit points deletes it and the condition goes; the same row
   with no cause stands through the same hurt.
9. *A following-turn duration.* *Observable:* outside a fight the record has a clock
   of two rounds and no turn life, stands a second short of it and is gone once it
   passes; in a begun fight its turn life starts at a turn's start and counts two.

### Drive mechanics

- The dialog is the ApplicationV2 of "Casting a spell (the cast engine)", "Drive
  mechanics". The walk's `cast` picks a weapon with
  `.acks-extras-cast-trow[data-uuid="<token uuid>"] .acks-extras-cast-pill[data-weapon]`,
  the toggle is `input[name="saveMod"]` (disabled while the spell's modifier is
  blank), and a bucket row's `is-off` is the gate's verdict.
- A save is rigged on the casting seat: `CONFIG.Dice.randomUniform` reads from the
  top (0.025 throws a 20, 0.975 a 1) against a target of 15 on each monster.
- The record's `endsOn` and `turnLife` are the flags `flags["acks-extras"].endsOn`
  and `.turnLife`; the damage that ends a record is an update of the actor's hit
  points made on the GM seat, since the client that makes the change runs the loss.
- `target.hdBelow`, `target.filters`, `save.modifier` and `target.count` are written
  on the invented spell's flag; the walk sets an invented count of two on the destroy
  spell so the cap of weapons does not refuse the second holder.

### Teardown

Tokens, cards, the hand-made condition and the Combat are tracked by uuid as they are
made; the records of the run's casts and of any cast by one of the walk's own
casters, and the cards speaking as its fixtures since it began, are listed by id and
tracked; the sweep deletes exactly that list and its result is quoted. The fixtures
stay. The weapons are reset to carry no mark.

## Buffs and granted throws (S5)

Walk: `node tools/live/run.mjs magic-cast-buffs`, on the GM and Player seats. Like
the saves walk it casts invented world spells (and names invented definition ids:
the immunity's spell and two proficiencies), reads the kinds of nine imported
register rows when the RR is open, and prints SKIP when it is not. Its armour
figures are read off the bearer's own armour class so every lift is positive.

### Fixtures

| Marker | What it is |
|---|---|
| `magic/buffs-scene`, `magic/buffs-class` | A gridded field both seats view; a class with nine first-level slots and none at level two. |
| `magic/buffs-caster` | A character the Player owns, bound to the class, Lawful, level 5. |
| `magic/buffs-caster-b` | A second character only the GM owns, bound to the same class: the other caster. |
| `magic/buffs-spell-<slug>` | Eight invented spells on the first caster (`ac`, `bolt`, `plain`, `kind`, `grant`, `auto`, `cant`, `cap`), rewritten whole at their steps. `cant` is listed at level two, which the class has no slot for. |
| `magic/buffs-b-grant` | The second caster's copy of the granting spell. |
| `magic/buffs-bearer`, `-foe`, `-ally`, `-undead`, `-animal` | Linked monsters; the last two carry one creature kind each. |
| `magic/buffs-foe-blade`, `magic/buffs-ally-blade` | A weapon that attacks in melee and at range, on the foe and the ally. |

### Steps

1. *Armour class set by attack kind.* One set for missile and thrown and one for
   melee, each above the bearer's armour class. *Observable:* the bearer's one record
   holds two `ac` parts of mode `set` with the right kinds and an `immune` part
   naming the spell; a real missile attack at the bearer carries one row for the
   spell of the missile figure's lift, a melee attack one of the melee figure's, and
   the two lifts differ by the two figures' difference.
2. *An immunity to a named spell.* *Observable:* the spell carrying the named id is
   exempt on the bearer with `gate.key: "immune"`; another spell is applied and the
   bearer holds its condition.
3. *A creature-kind pick (ruling 139).* *Observable:* the dialog's kind select lists
   the row's two kinds, and the row it opens wears a named tone cell (cells render
   only for rows a seat picks among: pick groups and the kind pick); the ally's
   record holds the attack bonus narrowed to the picked
   kind alone; the ally's attack at a creature of that kind carries a row for the spell,
   its attack at the other kind none.
4. *Granted throws on the Rolls tab* (Character sheet → Rolls tab → Proficiencies &
   powers). *Observable:* (a) with no record on the caster, one pale row (`is-latent`,
   no `is-roll`, no action, its pin disabled) whose figure's tooltip names the spell;
   the Player's seat shows the same row and pressing it, its figure or its pin posts
   nothing; (b) after the caster casts the spell on itself the one row is gold
   (`is-granted`), rolls and has its pin, with no pale twin; (c) with that record
   deleted and the other caster's cast on the character, the only record was cast by
   the other caster and the row is gold again; (d) a spell the character cannot cast
   (listed at a level the class has no slot for) leaves no row, pale or gold; the
   castable register does not list it; (e) rolling the gold row posts one card on the
   party roll card's format that names the spell.
5. *An automatic Adventuring throw.* *Observable:* with the record on the caster the
   Climbing row's figure changes and its tooltip names the spell; rolling it posts one
   card, on the party card's format, that says it is automatic through the spell.
6. *The cast dialog with three targets, and the target cap.* *Observable:* three
   rows, each with its X, the count, the drop strip and Add my token; the footer is
   outside the scrolling body. With a cap of two and
   three targets the count reads over; the Judge's dialog warns and Cast stays enabled,
   the Player's blocks and Cast is disabled.

### Owner-facing shots

Taken into the logs directory (`ACKS_WALK_SHOTS=0` takes none), each clipped to an
element, never the viewport: `magic-cast-buffs-a-pale-row.png`, `-a-pale-tip.png`
(the sheet and the tooltip core's manager shows beside it, in one clip over an
invisible box the walk adds and removes), `-b-gold-self.png`, `-c-gold-other.png`,
`-e-granted-card.png`, `-f-auto-card.png` and `-g-dialog.png`. Shot (d) is an
assertion: a spell the character cannot cast has no row to show.

### Drive mechanics

- A granted throw's row id is `grant:<ref>:<key>`. An invented proficiency that is
  not imported has the blank throw, key `grant`; the grant's `set` figure gives it a
  target. A pale row has no `data-action`, so a Player's press on it, its figure or its
  pin does nothing: the walk presses with the skip-dialog key held, as a user does,
  and one dispatch on the row is one roll.
- Core's tooltip is a node of the page outside the sheet. The walk dispatches a
  `pointerenter` on the figure, waits the manager's delay, reads
  `game.tooltip.tooltip`, and shoots a clip over the union of the sheet's and the
  tooltip's boxes; a second shot of the sheet alone is taken after the hover is let go.
- An attack at the buffed token is `actor.makeAttackThrow({item, attackType,
  skipDialog: true})` with the seat's targets set; the attack types a weapon offers
  are its `melee`, `missile` and thrown flags, so the walk's weapon sets both.
- The record's parts are flags on the effect, `flags["acks-extras"].rollMods.parts`;
  the cast's mark names the caster as `casterUuid`.

### Teardown

As the saves walk's: tokens and cards by uuid as they are made, the records the run's
casts and the walk's own casters left on its fixtures and the cards speaking as them
listed by id and swept. The fixtures stay.

## The Invocation band (R-c)

The cast dialog's one band between the spell and the saves: the invocation level as one
menu, the procedure's implement-set bucket, and a declared cast that keeps both. Offline:
`tools/test-cast-invocation-band.mjs`. Live: the steps below run in `magic-cast-spell`
(the lost-item steps' caster), after them.

### Fixtures

The walk's own: the class fixture `magic/cast-class` and the caster `magic/cast-caster`
(both kept; the walk rewrites the class's casting row to name an invented cap ladder,
`qacap` with rungs at class levels 1, 3 and 5, and sets the caster's class level to 4,
then puts the row, the ladder and the level back), and four invented implement sets made
on the caster with `gm.create` and tracked, which carry `flags["acks-extras"].ceremony`
`{implementLevel, damage}`. A procedure for the tradition's kind (`vancian`) is registered
on each seat for the run (`acksExtras.magic.registerCastProcedure`, `buckets` returning
`implementsBucket`) and taken off after.

### Steps

1. **A Player's menu.** The Player opens the dialog on the damage spell. *Observable:* one
   select named `invocationLevel` with five levels, the cap (3) preselected, the levels
   above it disabled with their reason in their words, "Cap 3" beside it with a tooltip
   naming the ladder and the class level, and the band headed "Arcane". Choosing level 5 is
   refused.
2. **A Judge's menu.** The GM chooses level 5. *Observable:* every option enabled, the
   select in the warn tone, a warning in the footer, Cast enabled.
3. **The bucket.** *Observable:* the four sets are rows with their pictures; the pick is the
   lowest set reaching the cap, tagged Used; a set too low has its radio disabled and its
   reason shown; a worn set's caption reads "Level N · effective M" with hollow diamonds for
   the levels lost; a radio changes the pick; X removes a set and the pick opens again;
   dropping an item from the inventory (a real `drop` event carrying a `DataTransfer` of the
   item's JSON) adds a row.
4. **No set reaches.** Every set is worn below the cap. *Observable:* the Player's footer
   carries the finding as a block and Cast is off; the GM's warns and Cast is on.
5. **The level reaches the card.** The GM casts at level 3. *Observable:* the card's
   `invocationLevel` is 3 and its source `chosen`, and the level note reads Invocation 3.
6. **A declared cast** (finding 1c.35, step 18 of the cast steps). In a begun fight the
   Player declares with the Foe targeted, then targets the caster instead and the tracker
   reaches the turn. *Observable:* the pending record stores the declared target; the cast
   resolves with no dialog and the card posts on the declared target; with the band, the
   record stores `invocationLevel` and `procedure.picked`, and the cast resolves with no
   dialog carrying that level.

### Drive mechanics

A native `<option>` takes no tone reliably, so the warn tone is read on the select; the
disabled state is read on the option. The bucket's rows are found by their `.acks-extras-bucket__name`;
a radio is clicked, not set, so the window's action fires. A drop is a dispatched
`DragEvent("drop")` on `[data-bucket-drop]`, not a click. Every helper closes the
dialog it opened on every return path, a refusal and a cast that was to resolve with no dialog
included, and `invBand` reads the dialog that was not on the page before its own `use` and
reports the dialogs it found standing (`stale`, expected 0): a window left open is read by the
next call in place of its own, which shows the previous call's rows. Step 6 sets the fight's
initiatives after opening it (the caster is at its turn only with its initiative rolled).

### Teardown

The sets and cards by id as they are made, the fight deleted by its uuid, the class row, the
ladder and the level restored, and the procedure taken off on each seat.

## The rung editor (R-e)

A Judge edits an imported invocation-level ladder inline: in the effect-row editor (a
spell sheet's Mechanics tab, a row's Edit button) and on the spell sheet's Overview.
Offline: `tools/test-rung-editor.mjs`. Live: `tools/live/magic-rung-editor.mjs`, the GM seat
and a Player seat together (`SEAT_GM`, `SEAT_PLAYER`).

### Fixtures

One spell Item the walk creates (`type: "spell"`, ownership default Owner so the Player seat
owns it), carrying an invented three-rung ladder on a damage row's `value` and on
`target.count` (model `creature`, which shows the count on the Overview). The walk tracks its
uuid and sweeps it at the end; nothing else is made. The Player must be no GM and an owner of
the spell, so that only `game.user.isGM` can be what refuses a write. A counter hook on the GM
seat (`updateItem` for the spell's uuid) is what "written once" is read from.

### Steps

1. **The switch and the inline rungs.** Open the spell sheet's Mechanics tab and the row's
   editor. *Observable:* the Figure field is three buttons (Flat, By caster level, By
   invocation level) with the last pressed and no `<select>`; the three rungs show under it
   with no `name` on any rung box; no window of the rung editor class is open; the footer
   part is drawn with Save row on.
2. **A draft writes nothing.** Edit a rung's figure, add a rung, remove another.
   *Observable:* the box shows the draft, the edited rung and the added one carry the gold
   edge, the edited figure's tooltip names the figure it replaced, and the update counter has
   not moved. Then change another field of the row (the note): it writes once, on change, and
   the redraw keeps the draft.
3. **An invalid draft.** Give two rungs the same level. *Observable:* the footer names the
   fault, the level box is `aria-invalid`, Save row is `aria-disabled` and points at the
   verdict, a click on it writes nothing, and the footer sits inside the window.
4. **Restore.** *Observable:* an edited rung is back as imported, an added one is gone, a
   removed one stays removed, nothing is written.
5. **Cancel.** *Observable:* the stored ladder shows again; nothing is written.
6. **Save row.** Edit one rung and add one. *Observable:* exactly one write; the stored rungs
   carry `hand` (`edited`, `added`) and the edited one its `was`; the row's `origin` is blank;
   the window shows the saved ladder with a clean footer.
7. **The kind buttons.** By caster level writes at once and the ladder and footer go; By
   invocation level brings the saved rungs back.
8. **The Overview.** On the Overview tab the count figure is the same button group with the
   rungs inline and a Save / Cancel bar under them. *Observable:* an edit and an added rung
   write nothing, survive `sheet.submit()` and a redraw, an invalid draft keeps Save off,
   Restore and Cancel behave as above, and Save writes the flag once with the marks. The
   fixture's flag was written raw, so the sheet's first `submit()` fills schema defaults into
   it (a write of `target.count.*` defaults and the core strings, not the draft): take that
   submit as setup, before the counter is read, and the submit under test then writes nothing.
9. **A Player.** The Player seat opens the same editor and the Overview. *Observable:* the
   rung boxes are read-only, no rung button and no footer or bar is drawn, the ladder's own
   kind buttons are disabled and so is "By invocation level" on every figure (the other
   figures' Flat and By caster level stay on: a click there moves nothing on or off the
   invocation scale), every call the Player's client makes to add, change, remove, restore, save or
   switch is refused, and the GM seat's counter does not move.

### Drive mechanics

A rung is typed by setting the box's value and dispatching `input` then `change` with
`bubbles`: the `input` moves the draft, and the `change` must reach nothing, which is what the
update counter proves. Buttons are clicked, not driven through their actions, except for the
Player's refusals, which call the window's own `DEFAULT_OPTIONS.actions` as a Player's client
would. After an add or a remove the part redraws, so the boxes are looked up again by
`data-rung-at` / `data-rung-value` under `[data-rung-ladder="<field or path>"]`.

### Teardown

The windows are closed on both seats, the counter hook is removed, and the spell is deleted by
its uuid from the run's own ledger.

## The power ledger (M-l)

A character's divine and arcane power on the casting strip, with the API the ritual and
sacrifice slices call. Offline: `tools/test-power-ledger.mjs`. Live:
`tools/live/magic-power-ledger.mjs`, the GM seat and a Player seat together (`SEAT_GM`,
`SEAT_PLAYER`).

### Fixtures

Kept, found by marker (`gm.fixture` builds them where none carries it): `magic/power-class` (an
`acks-extras.class` with one vancian casting row, so the strip has a pool), `magic/power-hero`
(a linked character bound to that class by `flags["acks-extras"].classes.uuid`, owned by the
Player seat's user) and `magic/power-stranger` (a character whose default ownership is Observer,
which the Player cannot write). Each step that needs a known shape starts it: both characters'
ledgers are unset at the start and the end (`flags.acks-extras.-=power`), since a kept fixture
carries what the last walk left. A counter on `updateActor` for the two characters, on the GM seat,
is what "written" is read from. The walk makes no document of its own.

### Steps

1. **A gain.** The GM seat calls `acksExtras.magic.power.gain`. *Observable:* `{ok, balance}`, one
   entry whose `day` is `dayOfWorldTime(game.time.worldTime)`.
2. **The chip.** Open the hero's sheet, Magic tab. *Observable:* a tag for divine power with the
   balance, one for arcane power at nothing, a plus and a minus on each, a Fades / Stays group on each
   (Fades pressed), one count box, one row for
   the entry (its name, a picture or a glyph), the tooltip listing the entry with its sign and the
   page, and no element with an `id`.
3. **Plus, minus, Undo.** Press them. *Observable:* a plus adds one entry marked `by: "judge"`; a
   minus adds a spend; Undo on a spend removes it and the face and `balance` agree; each press is one
   write; a minus on a power with none held writes nothing.
4. **The count.** Type a count into the box beside the arcane tag and change it. *Observable:* the box
   starts blank with the page in its tooltip, writes `arcane.count` and leaves the entries, and a blank
   writes null.
5. **A Player's seat.** Open the same sheet as the Player, who owns the character. *Observable:* the
   divine tag, its rows and tooltip, no arcane tag, no plus, minus, Fades / Stays, Undo or count; a spend past the
   balance answers `short`; a hand's gain, an undo and the count answer `judge`; the GM seat's counter
   has not moved; a spend within the balance writes once, from the Player's seat.
6. **The relay.** The Player calls `gain` on the stranger. *Observable:* `canUserModify` is false, the
   answer is `{ok: false, reason: "owner"}` (it came from the GM's client, which a missing GM would not
   give: that is `noGm`), nothing is written.
7. **Expiry.** Override the registry's `divineLifetime` through the Ruledata Browser's store
   (`table-store.mjs` `setOverride`; a table another hand overrode blocks the walk) with an invented
   three days, write three lots with days of today minus three, minus two and today, and open the
   sheet. *Observable:* the oldest lot is out of the balance and its row is dimmed, the next to fade is
   the middle lot one day away, a spend takes from the lots that stand. Override it with a blank unit:
   nothing expires, `expiry` is null. Clear the override: the registry serves its own read again.
8. **Fades and Stays.** Walked under step 7's override (the walk sets its own again, its section 6b),
   on a ledger unset first. On the GM seat press Stays on the divine tag, then its plus. *Observable:*
   the press of Stays moves `aria-pressed`, re-renders nothing and writes nothing (the counter holds);
   the plus writes one entry with `stays: true` and `by: "judge"`; its row has the pin and "stays until
   removed", and so does the tag's tooltip; the switch still reads Stays after the render the write made.
   Write that entry's `day` thirty days back: the balance, the face and the row are unchanged, nothing
   is due to fade. Press Fades, then the plus: an entry with no mark, which expires once its `day` is a
   lifetime back (rows newest first, the expired one dimmed). Add a fading lot and press the minus: it
   takes the fresh fading lot, not the older lot that stays, and not the one that had expired (read
   with `standing` imported from `power-ledger.mjs`). On the Player seat: no `[data-power-stay]`, no
   group, the lot that stays shown with its pin, and `gain(actor, "divine", {amount: 1, stays: true})`
   answers `judge` with nothing written.
9. **The switch holds, and the minus follows it.** Walked in the walk's section 6c, on a ledger unset
   first, under the same override. On the GM seat press Stays on the divine tag, then the plus twice.
   *Observable:* after each render (the strip element is a new one) the divine pair still reads Stays
   pressed and its minus carries the staying `aria-label`, the arcane pair is on Fades, and both entries
   carry `stays: true`. Press Fades and the plus (a fading lot), press Stays and the minus. *Observable:*
   the new spend carries `fromStays: true` and `by: "judge"`, `standing` shows the oldest point that
   stays at nothing and the fading lot untouched, its row reads "Removed a point that stays", and the
   pair still reads Stays. Press Fades and the minus: a spend with no `fromStays`, which took the fading
   lot. With the point that stays gone, press Stays and the minus twice more: the first removes the
   last one, the second writes nothing (the entry count and the counter hold). Press Stays on the first window, open a second window on the
   same actor (`new sheet.constructor({document, id})`, Magic tab). *Observable:* its divine pair reads
   Fades while the first reads Stays, a plus pressed in it writes an entry with no mark, and both keep
   their own state after the write. The presses and the open wrote nothing (the counter moved once, for
   that plus). Close the sheet and open it again: Fades.
10. **The bucket row.** `power.row(actor, "divine", {amount: 50})` after a gain of five.
   *Observable:* `power:divine`, quantity and cap five; a smaller ask stands; a power with none held
   gives no row; `power.settle` of a handed row spends it.

### Drive mechanics

The plus and minus sit beside their tag as siblings, so each is found as
`[data-power="<kind>"] ~ [data-power-adjust="1|-1"]` and the first match is that kind's; the Fades /
Stays pills are `[data-power-stay="0|1"][data-power-kind="<kind>"]` inside a group that follows the
minus. A press of a plus or minus re-renders the sheet, so the strip is looked up again after each; a
press of a pill does not. The pill's state lives on the sheet window (`powerSwitchOf`, keyed by the
application), so it survives that render and a second window is its own; a close ends it, though the
document keeps its one `actor.sheet` instance. A second window is built by hand with an `id` of its
own and closed in a `finally`. The clock is shared by every seat
and the walk never moves it: a lot's day is written in the past (`actor.update` of the kind's
`entries`), which is what a gain a lifetime ago is, and the balance reads the clock as it stands.
A real advance of the clock, and the calendar's own weekday list for a lifetime counted in weeks
(`calendar.days.values`), are not walked. The sheet's chip is also on the system's own character
sheet, through the same `castingStripElement`.

### Teardown

Both ledgers are unset, the update counter hook is removed, both sheets are closed, and the override
is cleared (also in the walk's `finally`). The fixtures stay.

## Research projects (M-q1, M-q2)

A location's facility values, the research projects held there and the days posted and credited
on them, on the location sheet's Research tab. Offline: `tools/test-research-project.mjs`. Live: `tools/live/magic-research-project.mjs`,
the GM seat and a Player seat together (`SEAT_GM`, `SEAT_PLAYER`).

### Fixtures

Kept, found by marker (`gm.fixture` builds them where none carries it): `magic/research-place`
(an `acks-extras.location` with no market and default ownership Observer, so the Player seat may
open it and cannot write it, which makes every Player write a relayed one), `magic/research-hero`
(a character the Player seat owns), `magic/research-pell` (a character the Player only observes),
`magic/research-lena` (a character the Player owns who is never put on the roster) and
`magic/research-part` (an item dropped as a component). Each step that needs a known shape starts
it: the place's research flag is unset and its roster is rewritten to the hero and Pell
(`lib/place.mjs` `addOccupant`) at the start and the end, since a kept fixture carries what the last
walk left. A counter on `updateActor` for the place and the hero, on the GM seat, is what "written"
is read from. The run's table overrides are the registry's own layer, cleared in its `finally`. The
walk makes no document of its own: the projects are flag records. Step 5 sets the hero's and
Pell's class level (`system.details.level`) and step 10 puts them back; the overrides added for
the days are `researchProse` and `assistantProse` (set in step 5, in the same blocking and clearing
list as the others).

### Steps

1. **The tab.** The GM opens the place's sheet and presses Research. *Observable:* Research follows
   Storage in the strip although the place has no market; the section is active and holds an input
   for the library and one for the workshop, a New project button and no element with an `id`; the
   header chip counts none.
2. **A facility value.** Type 9000 in the library input. *Observable:* one write of
   `flags.acks-extras.magic.facilities.library`, and the face reads it back. The Player seat's tab
   shows the value as text, no input, with Storage absent from its strip; its `setFacility` answers
   `judge`.
3. **A Judge's project, no level.** `research.create` from the GM seat with no level, which reads as
   unread whatever the world has imported. *Observable:* an open
   project stamped with the calendar day, its card drawn with the facility chip unread (no words, a
   tooltip carrying a page reference), Finish disabled with its reason as text, the header chip counting
   one.
4. **A Player starts one.** From the Player seat, for the hero (no level), Pell, Lena and with a cost.
   *Observable:* the hero's is written (the answer came from the GM's client); Pell's is `owner`, Lena's
   is `researcher` and a cost is `judge`, each writing nothing.
5. **The facility, imported.** Override `libraryProse`, `researchLadder`, `researchLadderNote`,
   `researchProse` and `assistantProse` with invented figures, and set the hero to level 5 and Pell to level 4 (`table-store.mjs` `setOverride`; a table another hand overrode blocks the walk),
   then the Judge enters level 2 on both projects. *Observable:* the second level's minimum is the first level's plus one step; with two open projects the
   9000 divides to a share that meets it and the chip reads ok with the bonus and a tooltip listing value,
   sharers, share and minimum. A third project from the Player seat is `facility` and writes nothing; from
   the GM seat it is written with `warn: "facility"`, and `gate` agrees for each seat.
6. **The controls.** The GM types a material cost, the material paid and a level. *Observable:* each
   writes its field and leaves the rest. On the Player seat the Player's own project draws its controls
   with none disabled by the sheet's lock and none of the Judge's fields, and Pell's project draws none;
   the assistant pick offers only linked characters not already on it, adds one and removes it, each
   relayed.
7. **The bucket.** Drop the item on the project's bucket from the Player seat. *Observable:* a row of
   the item's own picture and name, the same item held once however often it is dropped, X is not
   disabled by the sheet's lock and takes it out, and the location itself holds no item.
8. **The link and close.** `projectsOf(hero)` lists the open project the hero researches, and nothing
   was written on the character. The Player closes it: it stays on the record with its day and the link
   is gone.
9. **Research days.** Override the ladder (levels 4 and 5, each row carrying `marked: false`) and its
   footnote (the rate for other projects and a `markedProjects` text, in the shape the importer reads:
   the page's span ending in the footnote's sentence after a mark glyph) again
   (the ancillary fraction, the assistant levels and the two class levels stand from step 5), and the
   Judge creates a project with Pell as assistant and a research cost. *Observable:* a day is worth the
   two rates added, the due is computed from them (`progress().dueBy` "ladder"), the chip reads day 0 of
   the due, each participant's chip names its rate, and the strip draws one empty cell per due day. From
   the Player seat pick ancillary and press Post: the pick writes nothing, the radios belong to no form,
   the day is posted at that pace by one relayed write, the control is disabled, the radio still reads
   ancillary after the re-render and one cell is posted; a second post of the day is `duplicate` and
   another day is `day`. From the GM seat post a day two calendar days back (a Judge may), then
   override the ladder's rows with no `marked` (the marks unread) and call `research.credit`.
   *Observable:* nothing is credited and nothing is written, both posted days remain, `progress()`
   reads `unread: 1` and no due is computed, and the card draws a waiting cell (dashed) for the held day
   beside today's posted cell and a tooltip that names the held day and the page of the rate. Override the rows with `marked: false` again and call
   `research.credit`: one write, two credited rows stamped with that day and valued at the pace, today's
   day still posted; a second call and a Player's relayed call credit nothing and write nothing. The
   world clock reads the same before and after. The sweep on a clock step is not walked.
10. **An assistant under the level.** Set Pell to level 1 and clear the assistants. *Observable:* the
   Player's add of Pell is `assistantLevel` and writes nothing; the Judge's is written with
   `warn: "assistantLevel"` and `progress().people` marks Pell as not counting (`below`).
11. **The footnote from the import.** With the hero at level 5, override the ladder with one row for
   level 5 carrying `marked: true`, and the footnote with a rate for other projects and a list text
   naming the spell kind's word, and start a spell and an item project for the hero. *Observable:* the
   researcher's rate (`progress().people[0].rate`) is the printed rate on the spell project and the
   footnote's on the item. Change the list to name the item kind's word: the two swap. Override the
   footnote with the rate alone: both are null. No kind is fixed in the module; the list is the page's.
12. **The Judge's due, Post days… and withdrawing (board 16).** Override the ladder again with
   `marked: false` rows and start a project for the hero with a research cost and no assistant.
   *Due:* with the rates read the due is computed (12 days) and shown as text with no box; override the
   rows with no `marked` and the Judge's tab draws a days-due box, blank, labelled, its tooltip naming the
   ladder's page, and no text; type 7 and `dueDays` is written once and the standing reads the Judge's 7.
   The Player's tab shows 7 as text with no box, and the Player's own `update` of `dueDays` is `judge`. Read the rows
   again and the computed 12 is text, the box gone. *Post days…:* the Judge posts the next day, presses
   the project's Post days… button (the label differs from the Player's, and no Post day stands beside it),
   and the prompt opens in the module's classes at 1 day from today with dedicated pressed. Type 4 days from
   today, press the Both pill, and the caption names the first and last day; Post writes one range: the day
   already posted is skipped and keeps its pace, the other three are posted at Both, and a notification
   names the days posted and the day skipped. The same range again, by `postRange`, posts nothing and
   writes nothing; 0 days is `range`. The Player's button on the same project reads Post day, is disabled
   while today is posted, and a `postRange` from the Player is `judge`. *Withdrawing:* the Judge posts a day
   five days back and credits it (`research.credit` by id), then overrides the ladder rows with no
   `marked` and posts a day four days back: it is held. The strip draws one dashed waiting cell and one
   credited cell; the list under it has a row per posted day (five), the held one tagged waiting with a
   tooltip naming the page, and no row, no X, for the credited day. A day is posted on Pell's project, which
   the Player does not own: the Player's card for it lists the day with no X, and the Player's `withdraw` of
   it is `owner` and the day stands; the Player's `withdraw` of the credited day is `credited`. On the
   Player's own project the Player clicks the X of a future day: it goes, relayed, and its row with it. The
   Judge clicks the X of the waiting day: it goes, with its dashed cell; `withdraw` of a day not posted is
   `notPosted`, and the Judge's of a day on Pell's project is written. The clock is not moved.

### Drive mechanics

A control writes by its own listener and stops the change there, so a value is set with `el.value = ...`
and a bubbling `change` event, then a wait for the relayed write to come back. A drop is a `drop`
`DragEvent` on `[data-bucket-drop]` carrying `text/plain` JSON `{type: "Item", uuid}` in a
`DataTransfer`; the zone stops it, so nothing reaches the sheet's own drop. A write re-renders the
sheet, so each card is looked up again after one. A pace radio is picked by setting `checked` and
dispatching a bubbling `change`. The world clock is shared and is never advanced: a day that has
"passed" is a Judge's `post` with a backdated `day`, then `credit`. Post days… is opened by clicking the Judge's button without awaiting it (the click resolves when the prompt
closes); the prompt is `.acks-extras-research-prompt` and its application, the pills are `[data-pace]`, the
fields are named `days` and `from`, the dialog's own button is `button[data-action="ok"]`, and the notification is
read by wrapping `ui.notifications.info` for the click. A withdraw X is `[data-action="withdrawResearchDay"][data-day]`
and the due text and box are `[data-research-due]` and `[data-research-field="dueDays"]`. Not walked: the researcher's own
sheet (no link is drawn on it), a second Player seat for the project of someone else's character, the
sweep that credits on a real clock step and at `ready` (it needs the world clock to move), and Finish
(drawn disabled).

### Teardown

Both sheets are closed, the counter hook is removed, the place's research flag and roster are cleared and
the run's overrides are cleared (also in the walk's `finally`). The fixtures stay.
