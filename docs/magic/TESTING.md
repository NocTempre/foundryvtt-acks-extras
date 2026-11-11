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

The one runtime surface the vocabulary changes before the spell sheet exists
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
2. Pick "Once per three turns" and let the sheet submit.
   *Observable:* `item.getFlag("acks-extras", "usage")` reads `per3Turns`,
   and reopening the sheet shows that option selected.
3. Pick "By caster level (scheduled)", one of the three members the monsters
   table did not have.
   *Observable:* the flag reads `byLevel` and the sheet re-renders without a
   console error.

### Teardown

`api.sweepTracked()`; quote its result. The actor and its ability are the
only documents the run created.

## The spell primitive and the spell import (1a)

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

## Printed names and repertoires (9.1.0)

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
5. From the GM seat, Summon… (`promptSummon`, the party cell's menu entry): pick
   a library creature with no spell and place it. *Observable:* one token whose
   record carries no spell, and the spell's count unchanged.

**Teardown.** Delete only what the run tracked: the tokens, the cards, the
caster records, and the world copies where none stood before. The fixtures
stay. Quote `gm.sweepTracked({only})`'s result.
