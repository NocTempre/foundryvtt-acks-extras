# Lib — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

Of this recipe, `tools/live/markets.mjs` drives the party sheet's entry to the
hit-point tool (`node tools/live/run.mjs markets`; `tools/live/README.md` is
the contract); the rest is walked by hand.

`lib` is the shared surface every other feature reads, so a break here shows up
as ten features breaking. Walk this recipe before the others when several
report the same symptom.

## Fixtures

- Disposable `acks-extras.animal`, `acks-extras.group` and
  `acks-extras.template` actors.
- A disposable `acks-extras.location` actor (a storage provider).
- A disposable `character` and a `monster` to put inside them.
- Step 9's, kept and found again by marker (`flags.world.fixture`), and
  built carrying it where none stands: `lib/follower-employer` (a
  `character`), `lib/follower-hench` (a `character` on the employer's
  hireling list), `lib/follower-beast` (a `monster`) and its power
  `lib/follower-power`. The attack row's two throws are a create path: their
  messages are `lib/follower-throw-row` and `lib/follower-throw-die`, and a
  walk retires each before it throws again.

## Core drive mechanics (non-obvious, learned live)

- **Sub-types need a world relaunch, not an F5** — `.claude/rules/live-testing.md`
  has the whole rule. Check `game.documentTypes.Actor` before concluding a
  model failed to register.
- **`storage.stash(source, provider, spec)` — the place is the SECOND
  argument**, and `spec` is an array of `{id, qty}`, not documents.
  `retrieve(provider, target, spec)` reverses it. Passing documents where a
  spec belongs returns `{ok: false}` with no throw.
- **Coin `cv` is the COPPER value.** A gold piece is `cv: 100`. Minting with
  `cv: 1` produces items that look right on the sheet and are worth a
  hundredth of what the test expects — every downstream spend then reports
  `insufficientGold` and the bug looks like it is in the spender.
- Mint coin with `money.mintCoin(holder, gp)`, or a named kind with
  `money.creditCoin(holder, [{name, cv, count}])` — an ARRAY. A bare object is
  not iterable and throws `credits is not iterable`.
- Hand-creating a `money` item instead is not equivalent: `coinSlots` reads
  `system.coppervalue`, which `creditCoin` sets and a hand-made item does not.
- **Value a purse with `money.purseGp(actor)`.** `money.coinTotalCp` takes
  plain item ROWS, and handed an actor it throws `(plainItems ?? []) is not
  iterable`.
- **A storage round-trip RE-CREATES the item, so a remembered item id is stale
  afterwards.** `stash` then `retrieve` returns an item with a new `_id`;
  `actor.items.get(oldId)` is undefined and every call taking that item then
  reports "missing". Re-fetch by name after any transfer.
- **A group's occupants are `system.stacks`, not a count**, and they are added
  by DROPPING an actor on the group sheet.
- `bracketRow(rows, value)` returns **nothing** off the end of a table rather
  than clamping to the last row. Every ladder in the family reads through it,
  so assert the miss.

### Driving an initiative roll

- **Core's speaker reads `canvas.scene._id`**, so a scene must be VIEWED and the
  canvas ready or `rollInitiative` throws on null before rolling anything. The
  canvas never finishes initializing in a backgrounded browser pane — drive this
  one through the capture driver's browser.
- **Start the combat first.** Core writes flags to every combatant mid-roll
  (`processOutNumbering`, `cleanupStatus`) while its own `lock-turns` flag makes
  `setupTurns()` bail, and on a combat that was never started that update throws
  inside `foundry.mjs` (`#recordPreviousState`, Object.assign on undefined). It
  reads as a module bug and is not one.
- **An aborted roll leaves `lock-turns` set**, and every later combatant write on
  that combat throws the same way. Clear it and `setupTurns()` before retrying,
  or the next check fails for the reason the last one did.
- **Core mutates the group flag object in memory as it rolls** (`initiative` goes
  from `-1` to the rolled total) and never writes it back. Within one client a
  second roll therefore finds the group already rolled, prints nothing, and the
  card correctly does not post — reset the flag between rolls.
- Form a group the way the tracker does: `combat.manageGroup([tokenDoc, …])`,
  two tokens minimum, both already combatants.

## Steps

1. Sub-types: create one actor of each lib type.
   *Observable:* `game.documentTypes.Actor` lists all three, each creates, and
   each opens its own sheet (`GroupSheet`, `TemplateSheet`; an animal opens
   the monsters feature's `FullMonsterSheet`).
2. Groups: drop a monster on the group sheet.
   *Observable:* a stack row appears naming it, with a headcount and the
   Individuate / Record casualties controls; `system.stacks` holds it.
3. Templates: import a table into the template and materialize it.
   *Observable:* the sheet stops saying it has no materialized tables and
   generates a document from them.
4. Storage: `stash(character, location, [{id, qty}])` then
   `retrieve(location, character, [{id, qty}])`.
   *Observable:* both return `{ok: true}` with a manifest; the item moves off
   the character's sheet and back, and `storedItems(location)` tracks it.
   `ownerOf` returns the stamping actor on the way in and attribution is
   dropped on the way out.
5. Money: `creditCoin(actor, [{name: "Gold", cv: 100, count: 500}])`, then
   `planCoinSpend` for an amount needing change.
   *Observable:* `coinSlots` reports `cv: 100, qty: 500`; the plan takes
   smallest-first and books the overshoot as change, and a spend it cannot
   cover plans nothing rather than part-paying.
6. Tables: `tables.registerTable({id, rows}, {source})` a ladder — the
   document must carry its own `id` or registration throws — read it with
   `bracketRow` inside and outside its bands, then
   `unregisterTable(id)`.
   *Observable:* in-band rows resolve, out-of-band returns null, and the
   deregistered table is gone from `hasDoc`. `citeOf` on a re-read document
   answers its stored page, and null for an absent table (the browser rows are
   `docs/location/TESTING.md` step 5). `quantity({value: "4", atLeast: true,
   per: " banner "})` answers `{value: 4, atLeast: true, per: "banner"}`;
   `meetsQuantity` of it is true at 4 and false at 3, `scaleQuantity(it, 3)`
   is 12, and `quantity("none")` is null. Pure functions: an in-page eval
   after `ready` proves only that the live namespace carries them.
7. Attack seam: roll an attack from a character sheet with a weapon the
   character is not proficient in, and `Hooks.on("acksLibPostAttackRoll",
   (actor, ctx, outcome) => …)` armed. *Observable:* the system's own attack
   card carries a **Non-proficient** row among the throw's modifiers, the
   hook fires once with the system's outcome, and `acksExtras.lib.attack.inFlight(actor)`
   is null again afterwards. Set the chat's roll mode to *Private GM Roll* and
   roll an ability throw.
   *Observable:* the dialog's mode select opens on that mode, not on *Public*,
   and pressing Roll without touching it posts a whispered card. Back on
   *Public*, with Dice So Nice active, roll from the GM seat while a player
   seat watches: *Observable:* the player's client animates the dice. Read
   what reached Dice So Nice with a wrapper on `game.dice3d.showForRoll` in the
   roller's page: its fourth argument is `null` for a public roll and the
   whisper's ids for a private one — an empty list there is nobody.
8. Vision and senses: with `manageVision` on, place a token of an actor with a
   declared lightless range.
   *Observable:* the token's vision matches `senses.sightRange`, and
   `await acksExtras.lib.vision.migrateWorld()` re-derives it for tokens
   already placed, answering `ran: true` with its counts. No macro ships for
   the sweep, so the call is the step; it writes to every scene in the world.
9. Follower card (`tools/live/follower-card.mjs` walks this step): open a
   plain `monster`.
   *Observable:* `FollowerCardSheet` renders on the frame — the root carries
   `acks-extras-frame` and `.window-header` holds `.acks-extras-frame__band`
   with the portrait glyph, the rank (`2 HD · Monster`), the name field and
   the chips — and its **Full sheet** chip (`data-action="fcOpenFull"`) opens
   `FullMonsterSheet` beside it. The body is `.acks-lib-follower-card` (no
   `readonly` class) with `.acks-extras-frame__cols.is-3`.
   Give the monster `system.details.appearing` `{d: "2d6", w: "3d10"}`.
   *Observable:* the Vitals column carries a **Number appearing** rule with a
   Dungeon and a Wilderness row, each with a die
   (`[data-action="fcRollAppearing"][data-check]`); pressing the wilderness
   die posts the system's appearing card with the formula `3d10`. A monster
   storing neither formula shows no such block.
   Set a saves-as class on the monster's extras and star one of its powers
   (`[data-action="fcStar"]`, which writes `flags.acks-extras.fcStarred`).
   Make a `character` with a hireling list naming the monster and open its
   Followers tab. *Observable:* the compact card (`.acks-lib-follower-card.readonly`)
   shows the starred power under **Starred**, the saves row reads the
   monsters feature's "Saves as …" line, the name is a button
   (`.acks-lib-follower-card__name`) and **Dismiss** and the two throw
   buttons (`.acks-lib-follower-card__fact.is-roll`) render for the owner.
   Join as a player who can observe but not own the employer: the readings
   render, the name button renders, no Dismiss and no throw buttons.
   Record a calamity on a character hireling and leave its throw unmade.
   *Observable:* its compact card carries `.acks-extras-frame__dot` after
   the name with the pending tooltip. On an attack row of the editable card,
   press the row away from its controls, then its die. *Observable:* two
   chat throws of that attack; the pencil opens `.acks-lib-follower-card__attack-editor`
   under the row (`is-editing`) and nothing is written until a field changes.
   The card as a RETAINER's own sheet is reached without the context menu:
   `actor.setFlag("core","sheetClass","acks-extras.FollowerCardSheet")` with
   `actor._sheet = null` on either side of the write, since `ClientDocument#sheet`
   memoizes. The expand control is injected into the header at render
   (`.acks-lib-fc-expand`), not into the card body, so a body query for it finds
   nothing and reads as a missing feature.
   *Observable:* pressing it three times leaves **one**
   `.acks-extras-character-sheet` in the document. A second window is the
   frame-id collision — both copies answer to one id, and the survivor is the
   one that rendered last.
   The sheet **Full sheet** opens is the registry's `default` for the type,
   which is where the UI preset writes its answer (`ui-preset.mjs`, in memory
   on each client). Set it on THIS client alone — flip `default` to the
   system's entry in `CONFIG.Actor.sheetClasses.character` — rather than
   changing the world's preset, a shared setting other sessions are reading.
   Press **Full sheet** on a character henchman's card. *Observable:* the
   system's character sheet opens, not this module's; flip `default` back and
   the module's opens. A card whose type has no other default still opens this
   module's full sheet. A reload undoes the flip either way.
9b. No card on hire, and the one-time release. Make a `character` and set
   `system.retainer.enabled: true` on it, once at create and once by update
   on a second one. *Observable:* neither carries `flags.core.sheetClass` and
   both open on the character type's default. For the release, build the
   pre-upgrade shape: two serving hirelings (a character and a monster) and
   one non-serving character, each given
   `flags.core.sheetClass = "acks-extras.FollowerCardSheet"`. List the world's
   serving hirelings on the card first — the sweep releases every one, so a
   peer's fixture in that list means waiting. Then
   `game.settings.set("acks-extras", "retainerCardsReleased", false)` and
   reload the window that automates (the REAL ready is the trigger).
   *Observable:* the two hirelings lose the flag and the console logs the
   count; the non-serving one keeps its card; the setting reads `true`.
   Re-pick the card on one hireling and reload again: it keeps it.
9a. Design-canvas geometry survives a ratio it cannot read. On an open character
   sheet, `element.classList.remove("acks-extras")` — the one class that
   publishes `--acks-extras-k`.
   *Observable:* the art box stays 202×202 and the band emblem 22×22. Before the
   ratio was registered these measured 257 and 256, the image's own dimensions,
   and the window header grew to match. Re-add the class and confirm the knob
   still moves both: `fontScale` 18 with the sheet **reopened** gives 260 and 28.
   Reopening is the step — the ratio reaches a window at render, so changing the
   setting under an open sheet leaves it at the size it opened with.
   The build strips are **character-only** — `profileStrips` returns nothing
   for a monster, so a monster card is the wrong fixture for checking pill
   styling and reads as "the strips are broken". Reach the card for a
   character directly, since the character's default sheet is the system's:
   `new CONFIG.Actor.sheetClasses.character["acks-extras.FollowerCardSheet"].cls({document: actor}).render(true)`.
   *Observable:* 19 pills under `.fc-build`, an `on` pill painted burgundy and
   a `gold` one gold. The same pill grammar renders on equipment's Inventory
   **Training** row (`.acks-lib-build`) — check both when either changes.
   What lights a weapon pill is `weaponTokenClasses` — one reading of a grant
   token or a stored pick (`all`, `missile:all`, `melee:<size>`, a group, a
   named weapon) shared with the Class modifiers editor; the picks-to-pills
   recipe is the abilities recipe's weapon-proficiency step, the editor's the
   classes recipe's size-trained class step. Unarmed is lit whenever any
   source declares weapon training.

9b. Managed effects (class training + equipment loadout). Build a character,
   apply a class through `applyClass`, and equip two weapons so a loadout
   effect with changes actually exists (a lone plain weapon yields none, and
   no effect is written). Add ONE hand-made effect as the control.
   *Observable:* on the Effects tab the LOADOUT row shows a lock instead of the
   trash and keeps its toggle and edit controls, while the hand-made row keeps
   its trash. The class-training row is locked the same way, but where the
   loadout row keeps its edit control the training row carries one that goes
   to the Stats tab: its Training editor is the one place that document is
   edited, because two controls for one document can disagree on screen.
   `effect.delete()` on a managed one is refused and warns naming its owner;
   the hand-made one deletes, by a real trash click. Emptying
   (`update({changes: []})`) and disabling both succeed on a managed effect.
   Re-applying the class replaces the training effect (the authorized path),
   and `refreshLoadout` collapses duplicate loadout effects to one.
   **Delete the ACTOR last and confirm it goes** — a per-effect refusal that
   caught the cascade would make every such character undeletable, and nothing
   else in this list would show it.

10. The imported library, in a world that has imported classes with
    acks-importer 3.0.0 — so the library is in a pack and `game.items` is empty
    of it.
    *Observable:* `acksExtras.lib.library.libraryItems().length` exceeds
    `game.items.size`; the class list on a character's Class tab is populated;
    an imported ability's sheet shows relation NAMES, not raw `def.*` ids; a
    language granted by a class resolves to a document. Each of these read
    `game.items` before and rendered blank.
11. Template generation destination: open an imported template actor and press
    Generate.
    *Observable:* the new actor is in a top-level **Generated** folder in the
    Actors sidebar — never the template's own folder, and never a pack.

12. Initiative card: a scene with six tokens in a started combat — three in one
    combat group, two in a second (one of them hidden), one ungrouped — then
    `combat.rollInitiative(everyId)`.
    *Observable:* ONE public card, each group a single row named `Group 0` /
    `Group 1` listing its members, the ungrouped combatant its own row, sorted
    highest first, Name and Total only (no empty Result column); plus a
    Judges-only card carrying the hidden combatant's row, whispered to the GM
    seats. Join as **Player** and confirm the public card is visible and the
    Judges' card is not (`message.visible === false`). Turn `initiativeCard` off
    and roll again: core's one message per roller is back, unchanged. Rolling a
    single combatant posts a one-row card. No console errors on any of it.

### The compendium sidebar

The whole surface is world configuration, so it is driven and read from page
context; no canvas is needed.

**Build the pre-restore shape on purpose.** A world already arranged correctly
proves nothing, and the arrangement this exists to undo is a real one:

```js
for (const f of game.folders.filter(f => f.type === "Compendium")) await f.delete();
const bad = await Folder.create({ name: "ACKS II", type: "Compendium" });
const cfg = {};
for (const p of game.packs) cfg[p.collection] = { folder: bad.id, sort: 900000, locked: false };
cfg["acks-extras.a-pack-that-no-longer-ships"] = { folder: bad.id };  // the dead entry
await game.settings.set("core", "compendiumConfiguration", cfg);
```

Then run the macro the way a Judge does — `pack.getDocuments()`, find
`acksLibRestore00`, `execute()`, and click **Restore it** in the dialog.
Observables, all readable off `game.folders` and the setting:

- the system's own declared trees exist again and hold the system's thirteen
  packs — `ACKS Rulebook` (7), `ACKS II Revised Rulebook › Equipment` (2) and
  `› Setting` (2), `Judges Journal` (1), `VTT Vitals` (1). **Core's tree is the
  observable that matters**; a pass that leaves them empty has done the old
  wrong thing.
- this module's packs and every `ACKS Cookbook — …` world pack sit under
  `ACKS II — Extras`, imports in `From your books` with a sub-folder per line.
- the stale `ACKS II` folder is GONE, and so is the dead configuration entry
  that named it. If the folder survives, look for a config entry whose pack no
  longer exists — that is what used to pin it open.
- `pack.locked` is `true` again for a system pack and `false` for a cookbook
  pack: the reset drops the override, it does not set a value. Read `locked`,
  not the config keys — cleared keys remain present with value `undefined`, so
  `Object.keys(entry).length` lies.
- run it twice: the second run creates no folders and files nothing. Its
  message reads `0 compendium(s) filed`, and the setting is not written — wrap
  `game.settings.set` on the instance for the length of the run and count the
  calls that name `compendiumConfiguration`. Then give one pack an override
  where it stands (`pack.configure({ ownership: … })`) and run it again:
  exactly that one is filed, and the override is gone.

**The gentle pass must create NOTHING** in a world that is already right.
Reload and diff `game.folders.filter(f => f.type === "Compendium")` across the
reload — a second empty copy of the tree appearing here is the bug this design
exists to prevent.

**A new line's shelf materializes with its pack, not before.** No import in a
world whose lines all have packs can mint one, so drive the same call `packFor`
makes:

```js
const made = await foundry.documents.collections.CompendiumCollection
  .createCompendium({ label: "ACKS Cookbook — Test Line — Item", type: "Item" });
await acksExtras.lib.packs.fileImportedPack(made.collection, "Test Line");
```

Exactly one folder appears (`Test Line`), and the pack is in it. Then exercise
the DELETE path: `deleteCompendium()` the pack and run the restore again — the
now-empty line shelf is swept, because a restore also collapses empty shelves
inside this module's own tree.

**A restore closes a Judge's shelf again, and files it only when it was
opened.** The door that makes one is not on the api, so import it from the
address the page loaded:

```js
const lib = new URL("modules/acks-extras/scripts/lib/", document.baseURI).href;
// true when this address is the loaded module and not a second copy
(await import(`${lib}compendium-folders.mjs`)).restoreCompendiumLibrary === acksExtras.lib.packs.restoreCompendiumLibrary;
const { judgeLine } = await import(`${lib}library.mjs`);
const { ensureLibraryPack } = await import(`${lib}library-target.mjs`);
const shelf = await ensureLibraryPack("Item", judgeLine("Test Line"));
```

With a Player seat joined beside the Judge's, read
`game.packs.get(shelf.collection).visible` on the Player's client: `false` as
the shelf is made, and a restore files nothing.
`shelf.configure({ ownership: { GAMEMASTER: "OWNER", ASSISTANT: "OWNER",
TRUSTED: "OBSERVER", PLAYER: "OBSERVER" } })` makes it `true`; the next restore
files exactly one pack and it is `false` again. `deleteCompendium()` and one
more restore remove the shelf's folder and its configuration entry.

**Join as Player** and call `restoreCompendiumLibrary({confirm:false})`: it
warns, returns null, and neither the folders nor the setting change. Confirm the
cookbook packs are still `visible` to that seat — the ownership reset must not
cost players sight of the library.

## A lined shelf is part of the library

**Fixture.** A world compendium you create, labelled for a line the ACKS books
do not use:
`CompendiumCollection.createCompendium({ label: "ACKS Cookbook — Dolmenwood — Item", type: "Item" })`,
holding one class Item with a `system.key`.

1. **Negative control first, on the build you are replacing.** Confirm
   `libraryItems()` does NOT count it. Without this the positive result proves
   nothing — the shelf might simply have been found all along.
2. Run the same read on the build under test. The class is counted,
   `classItems()` lists it, and the chargen page's class `<select>` offers it by
   name.
3. **Order.** Put a document of the SAME name on the unlined shelf and on the
   lined one, then resolve it by name. The unlined one wins, whichever pack
   Foundry registered first — the sort exists so this does not depend on that.
4. **Cost, measured — not assumed.** With the lined shelf populated, reload and
   time `whenReady()` from a fresh F5. Record the elapsed milliseconds, the
   resulting `libraryItems().length`, `libraryPacks("Item").length` and the total
   document count across the shelves. Warming touches every line's shelf rather
   than four packs, and this number is the reason the widen was allowed to ship.
   **Take it more than once and report a RANGE.** The measured spread was
   1.1–3.7 s on ~2030 documents across ten shelves; a single reading here looks
   authoritative and is not. Take it only while nothing else is driving the
   world — another agent reloading in the same window shares or contends the
   load, and a contended reading is worse than none because it will be acted on.
5. **The DELETE path.** Delete the compendium and read again: the count returns
   to what step 1 saw. A shelf that goes away must stop being answered for.

## A generator opened before the library is warm

The failure this catches is permanent, and only a REAL cold render produces it.

**Drive mechanic — winning the race with auto-warm.** A plain navigate followed
by an immediate script call reliably lands AFTER the library has warmed itself,
so the cold path is never entered and the check passes vacuously. Batch the
navigate together with a tight polling loop that yields (`setTimeout` at ~5 ms —
a busy-wait deadlocks the page's own scripts), waiting for `game`, `game.packs`,
`game.actors` and `acksExtras` to EXIST and acting the instant they do, without
waiting for `game.ready`. Prove the render really was cold before trusting the
result: `game.ready === false` and the shelf reporting `pack.size === 0` against
a non-zero `pack.index.size` at click time. A run that cannot show both of those
proves the handler, not the race.

6. Create the lined shelf from the section above **after** the world has reached
   `ready`, so it is genuinely cold and unwarmed — `registerLibraryWarm` has
   already run.
7. Open a character sheet and click **Generate Scores** — a real click, not a
   scripted construction.
   *Observable:* on the FIRST open, without reloading, the injected boxes are all
   present and populated and the class list includes the fixture class. Before
   this was fixed the page rendered core's own two columns with no injected
   element at all, and stayed that way for the life of the window even after the
   shelf finished loading.
8. Reopen the generator in the same session.
   *Observable:* identical — this is the warm path, and it proves the await did
   not cost the case that already worked.

## The UI preset and its prompt

Fixtures: none beyond a disposable `character`, `monster` and
`acks-extras.party` actor. State to reset afterwards: the two world settings
(`uiPreset` back to `acksExtras`, `uiPresetPrompted` back to `false`) and the
client `look` back to `world`.

1. **The prompt fires once.** Set `uiPresetPrompted` to `false` and reload as
   the Gamemaster. Observable: a *Default look and sheets* dialog with three
   radio options, this module's checked, and two buttons. Close it with the
   X and reload: it returns. Press *Keep as is*: `uiPresetPrompted` reads
   `true`, `uiPreset` is unchanged, and a reload shows no prompt.
2. **The ladder, per preset.** For each of `foundry`, `acksCore`,
   `acksExtras`, set `uiPreset` and read the flagged default for
   `CONFIG.Actor.sheetClasses.character`, `.monster` and
   `["acks-extras.party"]`: the character default is this module's sheet under
   `acksExtras` and `foundry`, the system's under `acksCore`; the monster
   default is the follower card under `acksExtras` and `foundry` (the lib's
   own choice survives the round trip), the system's under `acksCore`; the
   party sheet is this module's under all three. Opening each fixture actor
   after a change opens the flagged class — the change closes and forgets
   open world sheets, so no reload is needed for a world actor.
3. **The look follows.** With the client `look` at `world`: `foundry` sets
   `data-acks-look="core"` on `<html>` and removes `body.acks-lib-sheet-theme`;
   the other two do the reverse. Set the client `look` to `book` and repeat
   `foundry`: the attribute stays absent — a player's own choice stands.
4. **A pin outranks the ladder until a preset is applied — through either
   door.** Pin `core.sheetClasses.Actor.character` to the system's sheet and
   run `refreshSheetDefaults` (dynamic-import `scripts/lib/ui-preset.mjs` in
   page context): the character default stays the system's. Then CHANGE
   `uiPreset` through `game.settings.set` — the route Configure Settings
   takes; a set to the value already stored fires no `onChange` and drops
   nothing — and read `core.sheetClasses` after the returned promise settles:
   the pin is gone and the character default is this module's, and
   `new actor.sheet.constructor` names the module's class. Applying from the
   prompt (`applyUiPreset`) drops the same pin.
5. **Applying from the prompt.** Reset the flag, reload, choose *ACKS system
   sheets*, *Apply*: a toast names the preset, Foundry's reload-all
   confirmation appears, and `uiPreset` reads `acksCore`.

## A combatant whose actor was deleted

Covers `patches/combat-round.mjs`. The wedge is invisible offline — mocked
globals never call `nextRound`.

**Fixtures.** A scene (activate it), two actors, and a token for each with
`actorLink: true`. A combat on that scene with a combatant per token,
`flags.acks.initDone` set, an initiative on each, and `{round: 1, turn: 0}`.
Then **delete one of the two Actors from the sidebar** — the token and its
combatant stay, and `combat.turns` reads `[..., null, ...]` for `t.actor`. An
UNLINKED token will not reproduce it: its delta is the actor.

**Steps and what proves each.**

1. **The reported symptom, if the patch is out.** `await combat.nextRound()`
   raises `Cannot read properties of null (reading 'hasEffect')` and
   `combat.round` is unchanged.
2. **The real trigger.** `ui.combat.element.querySelector('[data-action="nextRound"]').click()`
   twice: `game.combat.round` goes 1 → 2 → 3. The click handler swallows the
   throw, so read the round, never the absence of an error.
3. **The stand-in does not outlive the call.** After it returns, the orphan
   combatant's `actor` is `null` again and
   `Object.prototype.hasOwnProperty.call(combatant, "actor")` is `false`.
   A leaked stand-in surfaces as `combatant.actor?.render is not a function`
   from `Combat#updateCombatantActors`, one call later.
4. **`skipDefeated` on.** Merge `{skipDefeated: true}` into the core
   `combatTrackerConfig` setting, then advance twice: this is the only path
   that reads `isDefeated` — and through it `actor.statuses` — off the
   stand-in. Restore the setting after.
5. **Rolling over the end.** Set `turn` to `turns.length - 1` and call
   `nextTurn()`: core delegates to `nextRound`, and the round advances.
6. **A healthy combat is untouched.** Delete the orphan row and advance again —
   still works, and the patch passed core through without defining anything.

**Teardown.** Sweep the combat, the scene and the surviving actor by uuid; the
deleted actor is already gone and reads back as `missing`.

## Captions bound to their controls

Covers `a11y.mjs`. Nothing offline sees it — the binding is made on a rendered
DOM that mocked globals never build. The observable is a counter, not a look.

**Fixtures.** Two `acks-extras.trap` items (two windows of one class is the
point), one `acks-extras.vehicle`, one `acks-extras.location`, one
`acks-extras.class`, a `character`, and three `monster`s hired to that character
so the roster has rows.

**The probe.** Paste this with the windows below open. `inSummary`,
`hreflessInSummary`, `noIdName` and `nameless` must read 0 and `dupIds` must be
empty; `noLabel` and `deadLabel` are counted, not gated, and the paragraph under
the block says what the standing numbers are and why.

```js
const LABELABLE = 'input:not([type=hidden]),select,textarea,meter,output,progress,'
  + 'prose-mirror,multi-select,multi-checkbox,string-tags,file-picker,color-picker,'
  + 'range-picker,document-tags,formula-input,hue-slider,autocomplete-tags,code-mirror';
const INTERACTIVE = (el) => (el.tagName === 'A' && el.hasAttribute('href'))
  || ['BUTTON','SELECT','TEXTAREA','LABEL','DETAILS','EMBED','IFRAME'].includes(el.tagName)
  || (el.tagName === 'INPUT' && el.type !== 'hidden');
const ours = (el) => !!el.closest('[class*="acks-extras"]');
const ctrls = [...document.querySelectorAll(LABELABLE)].filter(ours);
console.log({
  inSummary: [...document.querySelectorAll('summary *')].filter(ours).filter(INTERACTIVE).length,
  hreflessInSummary: [...document.querySelectorAll('summary a:not([href])')].filter(ours).length,
  noIdName: ctrls.filter(c => !c.id && !c.getAttribute('name')).length,
  noLabel: ctrls.filter(c => !c.labels?.length && !c.closest('label')
    && !c.getAttribute('aria-label') && !c.getAttribute('aria-labelledby')).length,
  nameless: ctrls.filter(c => !c.labels?.length && !c.closest('label')
    && !c.getAttribute('aria-label') && !c.getAttribute('aria-labelledby')
    && c.closest('.form-group')?.querySelector('label')).length,
  deadLabel: [...document.querySelectorAll('label:not([for])')].filter(ours)
    .filter(l => !l.querySelector(LABELABLE)).length,
  misbound: [...document.querySelectorAll('label[for]')]
    .filter(l => !document.getElementById(l.htmlFor))
    .map(l => `${l.textContent.trim().slice(0, 20)} -> ${l.htmlFor}`),
  dupIds: [...new Set([...document.querySelectorAll('[id]')].map(e => e.id)
    .filter((v, i, a) => a.indexOf(v) !== i))],
});
```

**What the two counted numbers stand at, and why they are not zero.** With every
window below open, `noLabel` reads **72** and `deadLabel` reads **5**. Both are
template work this pass cannot do from the DOM, and `nameless` is the part of
`noLabel` it can: a control whose group has a caption. That one reads 0, and a
rise in it is the regression to chase.

The 72 are controls with no caption anywhere near them — the document `name` box
in a sheet header, whose only cue is its placeholder, and the character sheet's
fact grid, whose captions are `<span>`s in a layout the pass will not rewrite. A
name for those has to be authored. Of the 5 dead captions, 3 belong to the
system's own sheets and are out of this repo's reach; the 2 in the Full Monster
sheet are a caption over a drop target and a `<label>` used as a rollable
heading, and both are fixed by writing the template, not by binding anything.

**Windows the run must have open when it samples** — a zero with nothing open
proves nothing: the module character sheet, an abilities item sheet, the class
sheet, the Full Monster sheet on every tab, a vehicle sheet, the location sheet
on Contents and Recruitment, the henchmen roster, the equipment item sheet, both
trap sheets, and the scene config.

**The two overruled bindings are only visible on the SYSTEM's own sheets**, and
this module's sheets are the registered default, so they have to be opened by
class:

```js
new CONFIG.Actor.sheetClasses.character['acks.fe'].cls({ document: actor }).render(true);
new CONFIG.Actor.sheetClasses.monster['acks.ye'].cls({ document: monster }).render(true);
```

On the character sheet, the two `Climb` captions must resolve to two DIFFERENT
inputs (`system.adventuring.climb` and `system.movementacks.climb`) — one id for
both is what the pass re-mints. `misbound` keeps exactly one entry per open
monster sheet, the header's `Throw` — so two with the Full Monster sheet and the
system's own sheet both up. The system writes a `for` for an id it never writes
and puts no control behind the caption, so there is nothing to bind and the
attribute stands as authored. An entry naming anything else is a regression.

**Four observables that are not counters.**

1. **The summary is a toggle again.** With a roster row closed, click a GM row
   action: `details.open` stays false and the action fires. Then reach the same
   button by keyboard — it takes focus, which the anchors it replaced could not.
2. **A caption activates its control, and the write lands.** Click the caption
   text of a vehicle sheet checkbox; re-read `actor.system` and confirm the
   value changed. A ticked box that did not write is the failure this catches.
3. **A caption over a GROUP still ticks nothing.** Click "Key attributes" on the
   class sheet: no checkbox changes. That heading fronts a row of boxes each in
   its own label, and binding it to the first would be a mis-association.
4. **Two windows of one class stay separate.** With both trap sheets open, click
   each sheet's "Trigger" caption: focus lands in *that* sheet's input, and
   `dupIds` is empty. This is what the removed literal ids used to break.

Re-run the probe after editing a field on a sheet that submits on change:
`nameless` must still be 0, which is what proves the binding re-runs when a part
is replaced rather than only on first render.

**Teardown.** Sweep the trap, vehicle, location and class items and the actors
by uuid.

## A sub-type opens on this module's sheet, not the system's

The failure this covers is invisible offline and permanent in a world once it
starts: a stored default outranks `makeDefault` for every later registration,
so re-registering the sheet proves nothing about the worlds that are broken.

**Fixtures.** One disposable item of each sub-type this module defines
(`acks-extras.trap`, `.class`, `.race`, `.variation`, `.attitude`).

1. **Build the broken world on purpose.** As GM, merge a pin into the world's
   own setting — `core.sheetClasses` — naming the SYSTEM's sheet id for two of
   the sub-types, then reload the page. Read the id out of
   `CONFIG.Item.sheetClasses[type]` rather than typing it: the system's classes
   are minified, so it is `acks.G` in one release and something else in the
   next. Before the fix, opening either item throws
   `The partial systems/acks/templates/items/v2/details/details-<type>.hbs
   could not be found` and no window appears — that throw IS the reproduction.
2. **Observable after reload:** every `acks-extras.*` entry in
   `CONFIG.Item.sheetClasses` carries the `default` flag on this module's own
   sheet, `game.settings.get("core","sheetClasses").Item` no longer holds any
   `acks-extras.*` key, and each fixture opens on its own sheet class
   (`TrapSheet`, `ClassSheet`, `RaceSheet`, `VariationSheet`, `AttitudeSheet`).
   The setting write is its own cleanup: the repair deletes exactly the keys
   the step added.
3. **A single document pinned by hand is left standing.**
   `item.setFlag("core","sheetClass", <system id>)`, null its `_sheet`, and
   open it. The system's sheet renders — no throw — and its description tab
   carries one `.hint` line pointing at the type's own sheet. This is the
   fallback partial; without it this is the same thrown render as step 1.
4. **A player seat repairs itself.** Join as Player with the pin in place and
   confirm the same defaults: the reclaim is per client and must not wait for
   a GM. Only the pin's removal is the GM's.

**Teardown.** Delete the fixture items by id. Confirm
`game.settings.get("core","sheetClasses").Item` is back to the shape it had
before step 1.

## A relayed call acts for the seat that sent it

Covers `sockets.mjs` `runRelayed` and the handlers that authorize against it.
Every step is a console call from a real PLAYER seat, since that is the attack.
The module's own UI never forges a sender. The last step is the positive
control.

**Fixtures (as GM, each id recorded with `api.track`):**
- "Relay Own", a `character` the Player seat owns.
- "Relay Other", a `character` only the GM owns, carrying one plain item.
- A `acks-extras.location` actor with its market switched on, so
  `system.market.goods` exists.
- A formation holding "Relay Own", with no mapping kit on it.

The player reaches the transport as
`const s = socketlib.modules.get("acks-extras")`. `s.executeAsGM` resolves
with the handler's return value, so every refusal below can be read directly.

1. **A forged GM id buys nothing.** Call `s.executeAsGM("partyRequest",
   {formationId, type: "role", payload: {actorId: <Relay Own id>, role:
   "mapper"}, requestUserId: <a GM's user id>})`.
   **Observable:** the member's `roles` do not gain `mapper`, and no
   "declared" card is posted, because the kit gate refused a player.
2. **An omitted id buys nothing.** Call `s.executeAsGM("marketsSale",
   {locationUuid, sellerUuid: <Relay Other uuid>, itemId: <its item id>,
   qty: 1})` with no `requestUserId`.
   **Observable:** it resolves `{error: "notYours"}`, and the item is still on
   Relay Other.
3. **Companion creation needs the character and the creature.** Call
   `s.executeAsGM("companionCreate", {ownerUuid: <Relay Own uuid>, abilityId:
   "x", index: 0, uuid: <Relay Other uuid>})`.
   **Observable:** it resolves `null`, and `game.actors.size` on the GM seat
   is unchanged.
4. **The hidden influence roll needs the actor.** Call
   `s.executeAsGM("resolveHiddenRoll", {actorUuid: <Relay Other uuid>, tone:
   "diplomacy"})`.
   **Observable:** no chat message is posted (compare `game.messages.size`
   before and after).
5. **Only a Judge announces a lost party.** Call
   `s.executeForOthers("lostDiscovered", {days: 3, fakedHexes: 1})`.
   **Observable:** no dialog opens on the GM seat.
6. **Control.** From the party sheet's own controls, the player takes up a
   role that needs no kit (scout) for Relay Own.
   **Observable:** the member's `roles` gain it, and the declaration card names
   the player.

**Teardown.** `api.sweepTracked()` for the actors. The formation is disbanded
from its sheet, which is its own delete.

## Two windows on one GM seat automate once

Covers the seat election (`automation-client-logic.mjs`,
`automation-client.mjs`), the relay gate in `sockets.mjs`, and the gates at
their callers (MODEL.md, "Which window automates").
`tools/test-automation-client.mjs` is the offline half. It cannot see the
server's real relay order, a real unload or a crashed page. Walked on core
14.369 with the capture driver: three browsers, about 5 minutes.

**Hold.** The active GM's seat, alone, and no world relaunch. Any other
window on that seat is a third voter, and one still running code from before
the election doubles every write with nothing in a census to show it. Count
the seat's joins in the server's debug log before and after
(TEST_ENVIRONMENT). A reload reuses its session and logs no join.

**Windows.**
- A and B, two driver browsers joined on the active GM's seat. Each is its
  own profile, so crashing one leaves the other.
- P, a third driver browser on a player seat.

**Fixtures**, each `api.create()`d or `api.track()`ed: a scene with a 100 px
grid of 5 ft, a `character` P owns, and a party actor with that character
dropped on its sheet and its token on the scene (docs/formation/TESTING.md,
"Fixtures").

**Drive mechanics.**
- The driver exposes no DevTools session of its own. Attach a second client
  to its browser's debug port (`/json/version`, then `Target.attachToTarget`
  with `flatten` on the `/game` page). Through it,
  `Page.addScriptToEvaluateOnNewDocument` installs a boot recorder, a
  `Page.reload` lets it watch a whole load, and `Page.crash` kills the page
  with no unload.
- Read a window's view with `(await
  import("/modules/acks-extras/scripts/lib/automation-client.mjs")).automationCensus()`.
  The URL is the one the module loaded, so this is the live instance. A
  `null` in a game window means a second copy loaded.
- Count the writes a window starts by wrapping `Hooks.call` and tallying
  names that begin `preCreate`, `preUpdate` or `preDelete`. Core calls a
  document's pre-hooks only on the client that asks for the write. Leave out
  `preUpdateToken` in the window that moves the token. A bill that advances
  the clock makes the lead write about 80 actor updates (the clock's
  watchers); the follower's tally stays 0.
- Count relayed calls on `socketlib.modules.get("acks-extras").functions`,
  the map of each window's registered wrappers, by wrapping an entry. Every
  GM window enters a request there; the follower's wrapper declines it, so
  the follower's write tally is the proof.
- Move with `tokenDoc.update({x: tokenDoc._source.x + 500})`: 25 ft on that
  grid. Read a bill off the record's `clock` (`turnsTotal`, `roundsPartial`
  and `carryFeet`, at `turnDistance` feet per turn).
- A reloaded page is a new window with a new id. Its `hello` does not read as
  the lead returning, so with no `bye` the old lead is replaced only by a
  ping or by the new page's own claim after the join wait.
- Nothing on a page can be read after it unloads. Record unload-time state
  in `localStorage`, which survives the reload: the transport's `readyState`
  and `writable`, and the engine's `writeBuffer` length, beside each seat
  emit.
- Time a takeover in a foreground wait, and log the measured seconds.
- The sweep reports the party token `failed`, with "does not exist": the
  party's deletion takes its token. The scene's removal proves it gone.

**Steps.**
1. **The seat settles.** Open A and wait 4 s, then open B and wait 4 s.
   **Observable:** both censuses name the same `lead`, exactly one reads
   `isLead: true`, and both read `settled: true`. Neither boot recorder
   caught a throw.
2. **One adoption.** Create the party actor in the window that does not lead.
   **Observable:** the formations setting gains one record, and the party's
   `flags.acks-extras.formationId` names it on the first read and still names
   it 5 s later. The lead's tally holds the adoption, and the follower's
   holds only its own `preCreateActor`.
3. **One bill per move.** Move the party token three times in the window
   that does not lead.
   **Observable:** the clock bills 75 ft, and `clock.lastPosition` is the
   last destination. The lead wrote, and the follower's tally is 0.
4. **One relayed request.** P toggles a role its character holds, through
   `executeAsGM("partyRequest", {formationId, type: "role", payload:
   {actorId, role: "scout"}})`. A toggle run twice ends where it began.
   **Observable:** P's promise resolves, the member gains `scout`, and one
   declaration card is posted. Only the lead wrote. Then P sends
   `executeForEveryone("reloadFog", sceneId)` with A and B viewing the scene:
   `canvas.fog.load` runs in both.
5. **A closing lead hands over.** `location.reload()` the lead, by script in
   that window.
   **Observable:** the other window reads `isLead: true` within 5 s, through
   the `bye` (0.07 to 4 s measured), before the reloaded page has loaded. The
   reloaded window then follows it, its boot recorder holds no error, and the
   next move bills once, written by the new lead.
6. **A crashed lead is replaced.** Read the census, then `Page.crash` the
   window that leads.
   **Observable:** the survivor leads within 20 s, a ping and its wait (6 to
   9.5 s measured), and the next move bills once.

**Teardown.** `api.sweepTracked()` from a window still alive, with the other
windows' ledgers tracked into it first, quoted. Then confirm from any seat
that the formations setting no longer holds the run's record.

## A load's sweeps run in one window

Covers the gates at the `ready` sweeps and at the legacy mount cleanup: the
retainer sheet sweep and the monster landing-sheet rewrite (`module.mjs`), the
compendium filing (`compendium-folders.mjs`), the defence-band migration
(`monsters/module.mjs`), the language upgrade
(`classes/language-migration.mjs`), and `mount.mjs`'s `deleteActor` cleanup.
Walked on core 14.369 with the capture driver: three browsers, about 3
minutes.

**Windows.** A and B on the active GM's seat, C on the Assistant GM's seat.
The boot recorder and the `Hooks.call` tally are the previous section's. The
recorder's script runs before Foundry's, so it polls for `Hooks` and wraps it
when it appears (3.4 to 4.5 s into the load, measured). Key the tally on the
hook and the document's id, or its name for a create.

**Fixtures**, all through A's ledger:
- a world `ability` stamped `flags.acks-extras.cookbook.id =
  "def.language.fixture-<random>"` (docs/classes/TESTING.md, "The language
  upgrade");
- a `monster` whose `flags.acks-extras.extras.defenses.immunities.effects` is
  a string;
- a `character` created with `system.retainer.enabled: true`, then
  `unsetFlag("core", "sheetClass")`. Its create pins the card, and an update
  that leaves the retainer flag alone does not pin it again;
- a `character` rider and a `monster` steed paired by the legacy flags:
  `flags.acks-extras.mount` on the rider names the steed's uuid, and
  `flags.acks-extras.rider` on the steed names the rider's.

**Steps.**
1. **One window sweeps.** Install the recorder in all three windows, then
   `Page.reload` all three at once. Reloading one of two GM windows hands the
   lead to the other, and the reloaded window follows, so neither sweeps on
   that load: reload every window, or a lone one.
   **Observable:** one `language` item carries the fixture's id and the
   `ability` is gone, the band's `effects` is an array with the string kept
   in its note, and the retainer carries `flags.core.sheetClass`. The lead's
   tally alone holds the `preCreateItem`, the fixture's `preDeleteItem` and
   both actors' `preUpdateActor`. The other GM window's tally and the
   Assistant's hold none of them, and no recorder caught an error.
2. **One cleanup per deletion.** Delete the rider from the GM window that
   does not lead.
   **Observable:** the steed's `rider` flag is gone, and only the lead's tally
   holds the steed's `preUpdateActor`.

The landing-sheet rewrite needs a `core.sheetClasses` pin naming
`acks-extras.FullMonsterSheet`, and the compendium filing a pack with no
folder. Both are world settings a shared test world's other sessions rely on,
so these two stay offline here.

**Teardown.** Track the `language` item by the id read back through the
fixture's cookbook id, then `api.sweepTracked()` from A, quoted. It reports
the rider and the retired `ability` missing.

## A dropped bundle arrives as its goods

Covers `bundles.mjs` (`unpackBundle`, `deliverItems`), the character sheet's
drop, and the markets' `deliverGoods`. The drop is a real drag from the Items
sidebar onto the sheet, made from the PLAYER seat: an owner's gesture is the
path that embedded bundles whole.

**Fixtures (as GM, each id recorded with `api.track`):**
- "Bundle Hero", a `character` the Player seat owns, open on this module's
  sheet. It carries "Bundle Arrows", an `item` with `system.quantity.value` 5.
- World items the player can see: "Bundle Sword" (`weapon`); "Bundle Arrows"
  (`item`, quantity 20, identical to the carried stack apart from quantity);
  "Bundle Coin" (`money`, `coppervalue` 100, quantity 0).
- "Bundle Kit", a `bundle` world item whose `system.itemList` rows point at
  those three: the sword ×3, the arrows ×1, the coin ×7. Add a fourth row
  whose `uuid` points at a fifth world item, "Bundle Ghost", then delete that
  item, so the row resolves to nothing.

1. **The drop.** As the player, drag "Bundle Kit" from the Items sidebar onto
   the sheet's inventory.
   **Observable:** no `bundle` item is on Bundle Hero
   (`actor.items.filter(i => i.type === "bundle").length === 0`). There are
   three "Bundle Sword" documents, all unequipped. "Bundle Arrows" is one
   stack of 25, the carried stack topped up with no second stack created.
   "Bundle Coin" holds 7. One warning names "Bundle Ghost" and nothing else.
   "Bundle Kit" is still in the sidebar with its four rows.
2. **A dead uuid with a living name.** Edit the sword row's `uuid` on "Bundle
   Kit" to a uuid that does not exist, keeping its `name` and `type`, and drop
   it again.
   **Observable:** three more swords arrive, found through the library by name
   and type. The other rows deliver again too: the arrows stack reads 45 and
   the coin 14, still one of each, and the ghost warning repeats.
3. **A purchase.** In page context, `const { deliverGoods } = await
   import("/modules/acks-extras/scripts/markets/engine/trade.mjs")`, then
   `await deliverGoods(hero, {entry: {data: <Bundle Arrows>.toObject()}, qty:
   4})` and `await deliverGoods(hero, {entry: {data: <Bundle Sword>.toObject()},
   qty: 2})`.
   **Observable:** the arrows stack reads 49 with no second stack, and there are
   two more swords. `api.track` every sword id read back from the result's
   `created`.

**Teardown.** `api.sweepTracked()`. Deleting Bundle Hero takes everything the
drops and purchases delivered with it.

## Coin: one stack, moved and never copied

Covers `money.mjs` and `money-logic.mjs`, the stack half of `item-model.mjs`
(`divideStack`, `joinStacks`, `perStoneOf`, `sumWeight6`), `stack-prompt.mjs`,
`coin-order.mjs` on each sheet that hosts it, `bundles.mjs` `landCoin` and
`refuseGoods`, and both guards in `patches/goods-drag.mjs`. The banked-coin
sweep is the location feature's ([location TESTING](../location/TESTING.md)),
the wage run the henchmen feature's, and the till and the changer the markets
feature's; each of those recipes carries its own coin steps.

**Drive notes (learned live):**
- **A drop is a real `DragEvent` on the sheet's element**, carrying
  `{type: "Item", uuid}` as `text/plain`:
  ```js
  const dt = new DataTransfer();
  dt.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
  sheet.element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  ```
  The sheet must be rendered first (`await actor.sheet.render({force: true})`).
- **Read the result only once it has stopped changing.** A hand-over creates
  on the receiver and then deletes from the giver, so a read taken straight
  after the drop shows the coin on both. Poll the two purses until four reads
  in a row agree.
- **Count value, not rows.** Sum `coppervalue × quantity` over both actors
  before and after every step: a copy shows as value that appeared, a loss as
  value that went.
- **An unlinked token's actor is reached through the token**
  (`scene.tokens.get(id).actor`), and a token that still matches its actor has
  `delta: null`. Its coin is written through `token.actor`, never through a
  path into the delta.
- **Foundry stops a drop on a sheet the seat does not own** before the sheet's
  handler runs, so a player's drop on an observed sheet proves the permission
  and not the guard.
- **Deleting a place posts a card.** Sweeping a storage provider runs the
  delete policy, which whispers a "was destroyed" card to the GMs. Read its id
  back as the newest message naming your fixture and `api.track` it, then
  sweep again.
- **A choice in the coin-order block is a `change` on its select.** The block
  is `.acks-extras-coin-order[data-coin-order]`, its selects
  `[data-coin-order-half="payFrom"]` and `[data-coin-order-half="receiveInto"]`,
  the fold `[data-coin-order-gather]` and the note
  `.acks-extras-coin-order__note`. Set the select's `value` to a store key
  (`""`, `item:<id>`, `place:<uuid>`) and dispatch a bubbling `change`. The
  write is not awaited by the event, so read
  `actor.getFlag("acks-extras", "coinOrder")` once it has stopped changing.
- **Put coin where a step needs it with `into`.**
  `creditCoin(holder, credits, {into: "item:<id>"})` lands it in that
  container. No landing reaches a locked container, so coin behind a lock is
  made as a row of its own carrying `flags.acks-extras.containedIn`.
- **A place keeps coin for somebody through `storage.depositCoin(place,
  {ownerUuid, ownerName, coppervalue, quantity, name})`**, and a vault is made
  by `acksExtras.location.payIntoVault(holder, gp)`, which resolves to the
  vault's actor. The feature made that actor, so `api.track` it.
- **The system's own sheet is opened beside the module's**, without changing
  the actor's sheet: `new (Object.values(CONFIG.Actor.sheetClasses.character)
  .find((s) => s.id.startsWith("acks.")).cls)({document: actor})`, then
  `render(true)` and `changeTab("inventory", "primary")`.
- **The world setting is set in the settings window**, under its own label:
  `game.settings.sheet`, the field `[name="acks-extras.coinScope"]`, a bubbling
  `change`, then the form's submit button. Read the value it held first and put
  that back when the step ends.
- **No GM seat means no GM page.** Close the GM seat's page and wait on the
  player's client until `game.users.activeGM` reads null before the step that
  expects `noGm`.
- **A sheet's refusal is read off the notification.** Wrap
  `ui.notifications.warn` for the length of a step and read what it was
  handed; a warning that fades is otherwise indistinguishable from none.

**Fixtures (as GM, each id recorded with `api.track`):**
- "Coin Hero", a `character` the Player seat owns, on this module's sheet. It
  carries "Coin Pouch", a container, and "Coin Strongbox", a container whose
  lock is shut (`flags.acks-extras.container = {locked: true, opened: false}`).
  Its coin is made with `money.creditCoin`: Gold ×100 and Silver ×20 loose, a
  Gold row of 50 in the pouch, and a Gold row of 30 behind the strongbox's
  lock.
- "Coin Payee", a `character` holding one Gold row of 5 and no smaller coin.
- "Coin Merc", a `monster` the Player seat owns, holding a Gold row of 12. It
  opens on the follower card.
- "Coin Faction", an `acks-extras.faction`; "Coin Cart", an
  `acks-extras.vehicle`; "Coin Company", an `acks-extras.group`; and "Coin
  Party", an `acks-extras.party` created with
  `flags.acks-extras.formationId` naming a formation that does not exist,
  which writes no formation record.
- "Coin Bank", an `acks-extras.location` the Player seat can see and does not
  own (`ownership.default` at observer), keeping a Gold row of 200 for the
  Hero. The Hero's vault, keeping 300 gp.
- "Coin Scene", created with `active: false`, holding tokens of the Hero, the
  Payee, the Merc and the Bank, and one UNLINKED token of a second monster,
  "Coin Brute". The vault stands on no scene.
- The uuid of one `money` document in a system compendium, as the shelf coin.

1. **Weight.** Read `itemModel.perStoneOf(gold)` and
   `itemModel.systemCoinsPerStone()`.
   **Observable:** the two are equal and a whole number. `weight6Of(gold)` is
   `100 × 6 / rate`, and `sumWeight6` over the Hero's coin rows equals one
   division of all their counts, with no row rounded.
   `hero.system.encumbrance.value6` exceeds the same figure with every coin
   row's count at 0 by exactly that sum. Reload the page and read it again
   before touching the Hero: the figure is the same.
2. **A rate of the coin's own.** Open the Silver row's sheet in edit mode,
   type a count in the band's **Per stone** field, and close.
   **Observable:** `flags.acks-extras.gear.perStone` holds the number,
   `perStoneOf(silver)` returns it, the band reads it back with the stack's
   weight beside it, and the Hero's `encumbrance.value6` moved by the
   difference. Clear the field: the flag is `null` and the placeholder shows
   the system's rate.
3. **Divide and join.** On the Hero's sheet press the scissors on the loose
   Gold row, enter 30 and confirm.
   **Observable:** two loose Gold rows, 70 and 30, and the same total value.
   Drag the 30 onto the 70: one row of 100. A count of the whole stack and a
   count of 0 are each refused with a warning; a dismissed prompt says
   nothing. None of the three writes.
4. **A transfer makes exact change.** `await money.transferCoin({from: payee,
   to: merc, gp: 0.7, gate: false})`: the Payee and the Merc hold only gold.
   **Observable:** `{ok: false, reason: "noChange"}`, a warning naming the
   Merc, and neither purse changed. Pay the Hero instead (`to: hero`): one
   Gold leaves the Payee and three Silver come back out of the Hero's purse.
   The Payee is down exactly 7 sp in value, the Hero up exactly 7 sp, and no
   coin was created.
5. **The standing order, and no coin from nowhere.**
   `await money.mintCoin(hero, 10)`, then `await money.sinkCoin(hero, 5)`,
   with the Hero's order unstated.
   **Observable:** the loose Gold row gained 10. The sink leaves the purse
   exactly 5 gp lighter, taken from the Silver and the loose Gold rows. The
   pouch's row still reads 50 and the strongbox's 30, and no row holds more
   coin than it did before the sink.
6. **A follower card moves coin.** From the Player seat, open Coin Merc's card
   and drop the Hero's Silver row on it. Then drop the shelf coin on it twice.
   **Observable:** the Silver row is gone from the Hero and the Merc holds
   every Silver the Hero held; total value is unchanged by the first drop. The
   shelf coin adds 2 to the Merc's row of its kind, or makes one row of 2
   where the Merc held none, and the card's equipment list names each coin
   row with its count.
7. **A token's own actor.** Divide 25 off the Gold in the Hero's pouch and
   drop the pile on the Brute token's sheet. Then drop the token's Gold row
   back on the Hero's sheet.
   **Observable:** the pile leaves the Hero and sits on the token's actor,
   while the world actor "Coin Brute" holds no coin. Dropped back, it joins the
   Hero's loose Gold row and the token's row is gone. No warning names a token.
8. **A sheet that lists no goods.** As GM drop on Coin Faction's sheet the
   Hero's loose Gold row, the shelf coin, a piece of the Payee's gear, and a
   world `item` from the sidebar. Drop the same gear on Coin Company's sheet,
   and the gear and then the Gold row on Coin Party's sheet. Then give the
   Player seat ownership of the party and of the gear's holder, and drop the
   gear and the Gold row on the party's sheet from that seat.
   **Observable:** one warning per drop, in one wording, naming the sheet's
   actor (`refuseGoods`). None of the three holds an item it did not hold
   (`actor.items.size`), and the giver still holds what was dragged.
   `game.settings.get("acks-extras", "formations")` is what it was before the
   party sheet opened. The Player seat's drops prove the party sheet's
   `_onDropItem`; the GM's prove its member drop.
9. **A hold.** Drop the shelf coin on Coin Cart's sheet twice, then a pile
   divided off the Hero's Gold. Drop the hold's Gold row on the Merc's card,
   on the Hero's sheet, and on the faction's sheet.
   **Observable:** the shelf coin is one row of 2 on the cart. The pile leaves
   the Hero. Out of the hold it moves to the Merc and to the Hero, each time
   joining the row of its kind, and the faction refuses it with the hold
   keeping it. A crate that is not coin, made on the cart and dragged to the
   Hero, still moves.
10. **An unstamped arrival.** Stamp a Gold row on the Payee for an owner
    (`flags.acks-extras.storage.ownerUuid`), then hand the Payee a Gold pile
    from the Hero.
    **Observable:** the pile becomes a second, unstamped row. The stamped
    row's count is unchanged.
11. **Stores, and how far a payment reaches.** Read
    `money.coinStores(hero, {within})` and `money.spendableGp(hero, {within})`
    at `"all"`, at `"hand"`, at the Bank and at Coin Scene.
    **Observable:** at `"all"` the stores are coin carried loose, the pouch,
    the strongbox, the vault, then the Bank. The strongbox is `shut` with
    `takesCoin: false`, the vault is `vault: true`, and from the Player seat
    the Bank is `writable: false`. At `"hand"` only the first three are
    listed; the Bank's reach adds the Bank, and so does the scene's, which
    leaves the vault out. `spendableGp` at each reach is the worth of that
    reach's rows less the strongbox's, and `purseGp(hero)` is the worth of
    everything carried, the strongbox's included.
12. **The order, stated on the sheet.** From the Player seat open the Hero's
    sheet on its equipment tab. In the Purse rule choose the Bank under **Pay
    from** and the pouch under **Receive into**.
    **Observable:** the rule's caption states what is on hand and what is kept
    elsewhere. Each choice is one `updateActor` whose only change is
    `flags.acks-extras.coinOrder`, the flag holds `{payFrom: "place:<uuid>",
    receiveInto: "item:<id>"}`, and a re-render draws both selects on those
    choices with the sheet still on its equipment tab. **Pay from** offers no
    strongbox, and neither does **Receive into**.
13. **A payment the seat cannot write.** Still as the Player, with that order:
    `transferCoin({from: hero, to: payee, gp: 25})`, then `sinkCoin(hero, 10)`,
    then a transfer of more than the Bank still keeps.
    **Observable:** each resolves `{ok: true}`. The first takes 25 gp from the
    Bank's row for the Hero and lands it on the Payee, neither of which the
    seat owns. The second takes 10 gp more from the Bank and lands it nowhere.
    The third empties the Bank's row, which is deleted, and draws the rest
    from the stores in their standing order, coin carried loose first. The
    Bank is still among the Hero's stores, with no rows.
14. **An arrival follows the order.** `transferCoin({from: merc, to: hero,
    gp: 2})`, then `setCoinOrder(hero, {receiveInto: "place:<Bank uuid>"})` and
    a second transfer of 6 gp, then `creditCoin(hero, [{cv: 100, count: 2}])`.
    **Observable:** the first arrival joins the pouch's Gold row. The second
    becomes a row at the Bank stamped for the Hero by uuid and name. The
    credit, which is no payment and so is not relayed, is carried loose.
15. **More than everything.** `transferCoin({from: hero, to: payee, gp:
    100000})`.
    **Observable:** `{ok: false, reason: "insufficient"}`, a warning naming the
    Hero, and no row changed.
16. **No GM.** Close the GM seat's page. From the Player seat repeat one
    transfer to the Payee and one sink.
    **Observable:** both resolve `{ok: false, reason: "noGm"}`, each with the
    warning that a GM must be connected, and neither purse changed. Bring the
    GM seat back before the next step.
17. **The world's standing reach.** As GM open the settings window, find
    **Paying with coin kept elsewhere**, and set it to each of its three
    values in turn. At each, read `coinStores(hero)` with no `within`, open the
    Hero's sheet, `sinkCoin(hero, 5)`, and pay the Hero 1 gp from the Merc.
    **Observable:** the field is a select of three options under that label
    with a hint. At the scene value the stores are those on hand and the Bank,
    the sheet's note states that reach, and the sink draws on the Bank first.
    At the on-hand value the stores are those on hand alone, the note says
    so, the sink leaves the Bank's row as it was, and the arrival is carried
    loose although the order names the Bank. At the widest value there is no
    note and the arrival lands at the Bank. Put the setting back to what it
    was.
18. **The system's own sheet.** Open the system's sheet for the Hero on its
    inventory tab.
    **Observable:** `.acks-extras-coin-order-line` sits under the money
    header, holding the same block on the same choices, beside a summary of
    what is kept elsewhere. A choice made there writes the same flag, and the
    module's sheet draws it on its next render. The line is there while coin
    sits in a carried container.
19. **The follower card.** From the Player seat open Coin Merc's card.
    **Observable:** with nothing but loose coin the card draws no order block.
    Give the Merc a container: the block appears. Each row holding more than
    one carries a divide control (`[data-action="fcDivide"]`, the row's id in
    `data-stack-id`). Dismissed, it writes and says nothing; a count of 0 is
    refused with a warning; a count of 1 makes a second row and the block
    offers **Gather coin (1)**. Pressing it folds the two rows, says how many,
    and the control goes. Choose the container under **Receive into**, then
    pay the Merc 2 gp: the coin lands in the container.
20. **A group's purse.** Open Coin Company's sheet. Drop the Merc's loose Gold
    row on it, then make a second Gold row on the group and re-render.
    **Observable:** the Purse section reads its hint while the group holds no
    coin. The dropped row is handed over: the group's purse is up by exactly
    what the Merc's is down. With two rows of one coin the section offers
    **Gather coin (1)**, and pressing it leaves one row worth the same. A
    purse row is a drag source: its `dragstart` puts `{type: "Item", uuid}` on
    the event, and dropped on the Hero's sheet it is handed over into the
    container the Hero's order names.

**Teardown.** `api.sweepTracked()`. Deleting the actors takes their coin with
them, and deleting Coin Scene takes the tokens. The Bank and the vault each
post a "was destroyed" card as they go (drive notes); track those and sweep
again. Confirm the world setting reads what it read before step 17.

## The attack seam: rows on the system's card

Covers `patches/attack-throw.mjs` — the wrapper on `makeAttackThrow`, on the
actor model's `getAttackThrowModifiers`/`getDamageModifiers` and on the
weapon's `getAttackTypes`/`getDamageModes`/`getDamageFormula` — and the three
contributors that ride it: the conditions' math (`status-effects.mjs`), the
equipment feature's rows (`equipment/attack-mods.mjs`) and the Follower
Card's overrides (`apps/follower-card-sheet.mjs`).

**Fixtures (as GM, each id recorded with `api.track`):**
- "Seam Hero", a `character` the Player seat owns, 2nd level, STR 16, with a
  sword, a battle axe and a hand axe, proficient in swords only
  (`flags.acks-extras.weaponProficiency` = `swordDagger`, styles
  `single,twoHanded`).
- "Seam Goblin", a `monster` with one attack, placed as a token and targeted.
- "Seam Guard", a `monster` with a sword item, for the Follower Card.
- A scene holding a token of each.

Drive mechanics: arm
`Hooks.on("acksLibPostAttackRoll", (actor, ctx, outcome) => (window.__seam ??= []).push({ctx, outcome}))`
on the seat that rolls; `outcome.result.attack.modifiers` carries the throw's
rows as `{label, value}`, `outcome.attackRoll.formula` the sum, and
`outcome.damageRoll` the damage. Contributors answer the system's modifier ask
directly, so `ctx.terms` holds only what a caller passed in (the Follower
Card's overrides) and is empty for every other attack. `skipDialog: true`
skips the system's dialog; step 3 keeps it, which is the recipe's one real UI
interaction.

1. **A proficient attack adds no row.** On seat A,
   `actor.makeAttackThrow({item: sword, attackType: "melee", skipDialog: true})`.
   **Observable:** the card's throw lists the system's own rows (**STR
   Modifier**) and none from the module; the outcome's modifiers hold the
   system's labels alone, and `acksExtras.lib.attack.inFlight(actor)` is null
   afterwards.
2. **The non-proficient package is one row.** Attack with the battle axe,
   first with no equipment tables imported, then after the Books window's
   *Reimport One Shelf* has materialized the rulebook's `equipment` document
   (`acksExtras.lib.tables.getDoc("equipment").tables` lists
   `zeroLevelAttackThrow` and `nonProficientUse`).
   **Observable:** the card lists **Non-proficient** once each time — the
   cancelled STR bonus alone before the import, and the character's throw
   less the imported throw of a character of no level, less the STR bonus,
   after it; `system.attack.throw` reads as stored afterwards.
3. **The grip is a damage mode.** With the sword alone in hand, open the
   system's dialog (no `skipDialog`).
   **Observable:** the damage mode opens on the alternate (the sword's 1d8);
   choosing the base rolls 1d6. From the item sheet, the 1H and 2H rows each
   open on their own mode.
4. **A condition's row.** Mark Seam Goblin Defending on the palette and attack
   it with the sword.
   **Observable:** the card carries the defence's row under the condition's
   name (**Defending (target)**), signed against the attacker, and the throw's
   target reads as the system's 10 + AC. No notice is raised: the row sits on
   the card itself, and the conditions' notice is for a shift a card cannot
   show.
5. **A thrown weapon is its own kind.** Equip the hand axe and read
   `item.system.getAttackTypes()`.
   **Observable:** `["melee", "thrown"]` — the throw comes from the weapon's
   profile where the item declares none, and `missile` appears only where the
   item declares it. Attack with
   `attackType: "thrown"`: the axe is marked thrown
   (`flags.acks-extras.thrownAway`) and the post hook fired once.
6. **The Follower Card's overrides are rows.** Open Seam Guard's Follower
   Card, set the attack bonus override three above the shown bonus and a
   target override, and roll the attack from the card.
   **Observable:** the card's throw carries one row for the bonus override's
   difference and one for the target's, labelled as overrides; the actor's
   fields are unchanged.
7. **A player seat.** Repeat step 2 from seat A, as the owner.
   **Observable:** the same rows; the throw runs on the player's own client.
8. **Legacy effect keys.** Create an effect on Seam Hero with the change
   `system.aac.mod` +1 and run the `lib.legacyEffectKeys` check from the
   repair window.
   **Observable:** the finding names the effect; Fix rewrites the key to
   `system.ac.mod` and `system.ac.value` climbs by one. An effect on
   `system.surprise.mod` is reported with no fix offered.
9. **A damage that is not dice.** Give a `monster` an equipped melee weapon
   whose `system.damage.base.formula` is two plain words (`"x y"`), and open
   its Follower Card. Rig a hit (`CONFIG.Dice.randomUniform = () => 0.025`)
   and shift-click the weapon's attack row, then restore the rig.
   **Observable:** one attack card posts with its hit and no damage roll, one
   warning names the weapon and its text, and no unhandled rejection is
   recorded. A second hit with the same weapon posts its card with no second
   warning. Without the guard, the hit rejects with a parse error and posts
   nothing.

**Teardown.** `api.sweepTracked()`; delete the chat messages the steps posted
by the ids read back from `game.messages`, and the scene.

## A Judge-only card leaves nothing on a player's seat

Covers `roll-audience.mjs` `postToJudges` and `drawForJudges`, through the
features that post Judge-only cards.

**Fixtures (as GM, each id recorded with `api.track`):**
- A `RollTable` with two results and formula `1d2`.

1. **A card for the GMs.** On the GM seat, in page context:
   `const { postToJudges, drawForJudges } = await import("/modules/acks-extras/scripts/lib/roll-audience.mjs")`,
   then `await postToJudges({content: "<p>test card</p>", rolls: [await new Roll("1d20").evaluate()]})`
   and `await postToJudges({flavor: "plain", rolls: [await new Roll("1d6").evaluate()]})`.
   **Observable:** both messages have `rolls.length === 0` and `whisper` equal
   to the GM ids. On the Player seat, `game.messages.get(id).visible === false`
   for both, and the chat log holds no "privately rolled" line. On the GM seat
   the first card reads "test card" and the second shows a d6 dice box.
2. **A table drawn for the GMs.** `await drawForJudges(table)`.
   **Observable:** one message, flagged with the table, `rolls.length === 0`,
   whispered to the GMs, with the table's result and its dice box in the
   content on the GM seat; `visible === false` on the Player seat.
3. **A feature's card.** Walk one Judge-only path end to end — a formation's
   party search (`docs/formation/TESTING.md`) or a trap zone's trigger.
   **Observable:** the same three facts on its card: no rolls, whispered to the
   GMs, invisible on the Player seat.

**Teardown.** Delete the messages by the ids the steps read back;
`api.sweepTracked()` for the table.

## A secret adventuring throw is posted blind

Covers `patches/adventuring-roll.mjs`, and `withAdventuringConditions` through
it. **Run it from real player seats**: a GM's own throw takes the whisper-to-
self branch and never posts blind, and the system's hook shows a GM the body
of every card.

**Fixtures (as GM, each id recorded with `api.track`):**
- "Secret Thrower", a `character` the Player seat owns, opened on this
  module's sheet.

Seat A is the Player seat; seat B is a second player seat that does not own
the character. The Rolls tab's rows are
`[data-action="roll"][data-roll="adv:listening"]`, `adv:searching` and
`adv:climb`. Read a message on a seat with `game.messages.get(id)`: `blind`,
`whisper`, `rolls.length`, `visible`, and
`(await msg.renderHTML()).querySelector(".blindable")`. The skip key is the
one "Conditions on the palette and on a roll" describes. A roll window's Roll
button is `button[data-action="ok"]`; the first `[data-action]` button in the
window is its header's.

1. **A player listens.** On seat A press the Listen row, enter 2 and roll.
   **Observable:** the dialog states the visibility in a line and offers no
   select. One message: `blind === true`, `whisper` equal to the GM ids,
   `rolls.length === 0`. On seat A the card's whole content is `???`: no
   title, no `.blindable`, no success or failure line and no total. On the GM
   seat it
   shows success or failure against the stored target and the dice with a
   `+ 2[Situational]` term. On seat B `visible === false` and the log holds no
   "privately rolled" line.
2. **A player searches with the skip key held.** On seat A,
   `actor.rollAdventuring("searching", {event: {[key]: true}})`.
   **Observable:** no dialog; the same facts as step 1; the Roll it resolves
   to carries the target at `roll.data.roll.target`.
3. **Another throw is the system's.** On seat A press the Climb row.
   **Observable:** the system's dialog with its roll-mode select, and a card
   posted under the mode chosen there.
4. **The Judge throws.** On the GM seat, step 2's call for the same actor.
   **Observable:** `blind === false` and `whisper` is that GM's id alone; on
   seat A `visible === false`.
5. **A condition reaches it.** With a condition whose figure moves a throw on
   the character (the fixtures of "Conditions on the palette and on a roll"),
   repeat step 2.
   **Observable:** the GM's card states the moved target, the roller is told
   which condition applied, and `system.adventuring.searching` reads its
   stored number afterwards.
6. **The Follower Card's own target.** Give the character an `ability` item
   named Adventuring: the card draws its adventuring panel for an actor
   carrying one. Open the character on the Follower Card on seat A
   (`new CONFIG.Actor.sheetClasses.character["acks-extras.FollowerCardSheet"].cls({document: actor})`),
   set `flags.acks-extras.fcOverrides.adventuring.listening` to a number the
   actor does not store, and press
   `[data-action="fcRollAdventuring"][data-skill="listening"]`.
   **Observable:** a blind card against that number; the actor's stored target
   is unchanged.
7. **Dice So Nice.** On seat A, stand a stub in:
   `game.dice3d = {showForRoll: (...a) => (window.__dsn ??= []).push(a)}`, and
   repeat step 2.
   **Observable:** the call's fourth argument is the GM ids and its fifth is
   `true`; the message carries no `sound`. Delete the stub.

**Teardown.** `api.sweepTracked()`; delete the chat messages the steps posted
by the ids read back from `game.messages`.

## The repair tool

Covers `repair-logic.mjs` and `repair.mjs` (the registry, scan → fix → rescan,
the report), `apps/repair-app.mjs`, the settings menu and the macro, and every
shipped check a create-and-destroy fixture can reach. `lib.strandedCoin`, and
the rows `lib.mergeResidue` lists for a document of a removed sub-type, need a
document the world cannot load, which no fixture here can make. Walk them only
in a scratch world, and otherwise report them as not exercised; offline,
`tools/test-repair-checks.mjs` holds what both scans list for such a document,
against stand-in collections. The rows `lib.mergeResidue` lists for documents
that do load are read in docs/TESTING.md, "The merge cleaner macro".

The scan reads the whole world, so a shared world shows other sessions' rows.
**Tick only the rows that name your own fixtures.**

**Drive notes (learned live):**
- **Write every `system` field with an update after the create.** The
  system's actor create replaces creation-time `system` data unless `items`
  rides along, and `api.create` goes through it. A place created with a
  `sceneUuid` stores `""` and scans clean.
- **The clothing declaration hooks refuse the disagreeing items.** Every
  `preCreateItem` and `preUpdateItem` entry whose function source contains
  `clothingDeclarationPatch` keeps an item's two halves together. Detach them
  in your own client with `Hooks.off(name, id)`, create the three clothing
  fixtures, and restore them with `Hooks.on` straight after.
- **Never reload between building the fixtures and step 3.** The ready-time
  sweeps repair or delete fixtures at load: the henchmen references, the vault
  sweep, the empty-place prune and the orphan-marker sweep. The walk then
  proves nothing.
- **A backgrounded pane lays out at 0×0,** so coordinate and ref clicks miss.
  Call `.click()` on the real controls in page context:
  `button[data-key="acks-extras.repairTool"]` in the settings window, and
  `[data-action="scanAll"]`, `input[data-pick]` and
  `[data-action="fixSelected"]` in the tool.

**Fixtures (as GM, each id recorded with `api.track`):**
- "Repair Hero", a `character` the Player seat owns. Its
  `system.henchmenList` holds one id no actor has.
- "Repair Sword", a world `weapon`. On Repair Hero, four embedded `bundle`
  items, made with `createEmbeddedDocuments`, because the sheet's drop no
  longer embeds one:
  - "Repair Sword ×3", whose one `system.itemList` row points at Repair Sword
    with `quantity` 3. This is the shape a market purchase left (`git show
    7655412:scripts/markets/engine/trade.mjs`).
  - "Repair Kit", whose one row names a world item that was created and then
    deleted, under a name no library item carries.
  - "Repair Half", half unpacked: beside it on Repair Hero, a copy of Repair
    Sword flagged `flags.acks-extras.unpackedFrom` with Repair Half's id.
  - "Repair Journal", stopped between its two writes. Its
    `flags.acks-extras.unpack` is `{merged: true, creates: [...]}`, where the
    two item sources are each stamped `flags.acks-extras.unpackedFrom` with
    Repair Journal's own id, so the flag is set by an update once that id
    exists.
- Also on Repair Hero, the gold `money` item the system gave it, updated to a
  nonzero `system.quantitybank`.
- "Repair Brute", a `monster` carrying one `money` row with a carried count
  and a nonzero `system.quantitybank`.
- "Repair Rider", a `character` flagged `flags.acks-extras.attachedTo =
  {uuid: "Actor.<16 characters no actor has>", role: "rider"}` and
  `flags.acks-extras.mount = "Actor.<the same>"`.
- "Repair Place", an `acks-extras.location` whose `system.sceneUuid` is
  updated to a scene uuid that does not exist.
- "Repair Scene", a scene created with `active: false`, so that no client
  starts drawing it, and flagged `flags.acks-extras.location` with an actor
  uuid that does not exist. On it, a token of Repair Hero flagged
  `flags.acks-extras.shadowFor` with a formation id no formation has.
- "Repair Vault", an `acks-extras.location` flagged
  `flags.acks-extras.storage.vaultOf` with an actor uuid that does not exist.
- Three world items, built with the declaration hooks detached:
  - "Repair Coat", an `item` flagged `flags.acks-extras.baseType =
    "clothing"`, whose `system.subtype` is `item`.
  - "Repair Cloak", an `item` flagged `baseType = "gear"`, whose
    `system.subtype` is `clothing`.
  - "Repair Armour", an `armor` item flagged `baseType = "clothing"`.

1. **A scan writes nothing.** Arm an observer on the create, update and delete
   hooks of Actor, Item, Scene, Token, Setting and ChatMessage, recording only
   calls whose `userId` is your own. Open **Configure Settings → ACKS II —
   Extras → Repair this world** and press **Scan all**.
   **Observable:** every fixture has its row under its check:
   - four bundles: Repair Kit has no tick box and names its missing good, and
     Repair Journal reads "Partly unpacked. Fixing finishes it.";
   - the henchmen list, the attachment and the mount flag, the place link, the
     scene flag, the shadow, and the banked coin of both actors, Repair Brute's
     reading "Banked, with no vault to go to";
   - the orphan vault, marked report only, with no tick box and a line
     pointing at the place's Storage tab;
   - the three clothing items, where Repair Armour names its document type by
     its label.

   The observer holds nothing.
2. **Fix.** Tick your fixtures' fixable rows and press **Fix selected**, then
   confirm.
   **Observable:** one card, whispered to the GMs, lists every ticked row as
   fixed. `api.track` it; it is the newest message whose content links your
   fixtures' uuids. Then check each fixture:
   - Repair Hero carries no `bundle` except Repair Kit. It has three Repair
     Sword copies stamped with the purchase bundle's id, exactly one copy
     stamped with Repair Half's id, and Repair Journal's two copies with
     Repair Journal gone. Its henchmen list is empty.
   - Repair Rider has neither flag.
   - Repair Place's `sceneUuid` is `""`.
   - Repair Scene has no `location` flag and no shadow token.
   - Repair Coat's subtype is `clothing`, Repair Cloak's is `item`, and Repair
     Armour has no `baseType`.
   - Repair Hero's banked coin is in a vault. `api.track` the vault, read
     back as the provider whose `vaultOf` is Repair Hero's uuid.
   - Repair Brute's banked count has joined its carried count on the same
     row, `system.quantitybank` is 0, and no vault was made for it.
3. **The rescan decided.** Press **Scan all** again.
   **Observable:** none of the fixed rows is listed, and Repair Kit and Repair
   Vault still are.
4. **A second fix is a no-op.** In page context, `await
   api.repair.fix("lib.embeddedBundles", [<Repair Sword ×3's old uuid>])`.
   **Observable:** the key is in `gone`, `fixed` and `failed` are empty, and no
   card is posted.
5. **Layout and type size.** Size the window to 480×320, then re-render it.
   **Observable:** the body scrolls, the footer stays pinned, `.window-content`
   itself does not scroll, and the body keeps its scroll position across the
   re-render.

   Raise the type knob, then close and reopen the window. A window that is
   already open keeps its old sizes in the pane.
   **Observable:** the body text, the hints and the window's own buttons all
   grow with the knob.
6. **The player seat.** Join as Player from the capture driver's own browser
   (`connect({ user: "Player" })`). Pane tabs share one session, so a pane
   join demotes the GM.
   **Observable:**
   - the settings window has no **Open the repair tool** button;
   - running *Repair This World (GM)* warns that only a GM can repair the
     world, and no window opens;
   - `api.repair.open()` returns null;
   - `api.repair.scan()` and `api.repair.fix()` both reject.

**Teardown.** `api.sweepTracked()`. Deleting Repair Hero takes its bundles,
copies and coin with it. The shadow token went with the fix, so it sweeps as
missing.

## The hit-point tool

Covers `hp-logic.mjs`, `hp.mjs`, `apps/hp-app.mjs`, the Tokens-layer button,
the macro, and `api.lib.hp`. The party sheet's entry point, and a member inside
the party token, are formation's recipe "An unlinked member's own hit points"
(docs/formation/TESTING.md). Walk it after this one.

**Drive notes:**
- **Write `system.hp` with an update after the create.** The system's actor
  create replaces creation-time `system` data (the repair recipe's first
  drive note).
- **An unlinked monster token rolls its own hit points when it is placed,**
  while the system's `autoRollMonsterHP` setting is on. The world actor's 8
  of 8 does not reach it. Write each token's own with
  `token.actor.update({"system.hp.max": 8, "system.hp.value": 8})` after
  placing it.
- **A batch creation can come back in another order.** Pick the tokens
  `createEmbeddedDocuments` returns by name, never by position.
- **Press the Tokens-layer button through the DOM,**
  `document.querySelector('[data-tool="acksHitPoints"]').click()`, with the
  Tokens layer active. Calling the tool's `onChange` cannot show a
  double-fire, which is how a `button: true` tool fails.
- **The window's controls submit on `change`.** Set a value, then dispatch
  `new Event("change", {bubbles: true})` on the control. Read the next
  render's state from `_prepareContext` (`.claude/rules/live-testing.md`,
  driving techniques).
- **The report is the newest chat message after Apply.** Read it back at once
  and `api.track(id, "ChatMessage")` it. The window returns nothing that names
  it.

**Fixtures (as GM, each id recorded with `api.create` or `api.track`):**
- "HP Scene", created with `active: false`, `ownership.default` OBSERVER, and
  viewed with `scene.view()`.
- "HP Hero", a `character` with `prototypeToken.actorLink: true` and hit
  points 10 of 10, with two tokens on HP Scene.
- "HP Goblin", a `monster` with `prototypeToken.actorLink: false` and hit
  points 8 of 8, with two tokens on HP Scene named "HP Goblin A" and "HP Goblin
  B", each token's own hit points then written to 8 of 8.
- "HP Cart", an `acks-extras.vehicle`, with a token on HP Scene.
- "HP Guards", an `acks-extras.group` made a stack of HP Goblin with
  `api.lib.groups.setPrototype(guards, goblin, {count: 3})`. Nothing is
  deployed yet.

1. **Rows from the selection.** Select both HP Hero tokens, both goblins and
   the cart, and press the Tokens layer's **Adjust hit points**.
   **Observable:** one window, with rows HP Hero (once), HP Goblin A, HP
   Goblin B, and HP Cart. HP Cart is unticked and reads "A vehicle. Adjust it
   on its own sheet." The footer reads 3 of 4 ticked.
2. **A formula, rolled once each, and a half.** Type `2d6`, choose **Once for
   each**, set HP Goblin B's multiplier to ×½, and press **Apply**.
   **Observable:**
   - While the amount is a formula, the After column reads "?".
   - The new card is whispered to the GMs and carries no rolls. It has a row
     per target, with "before → after" and the amount, and "×½" on HP Goblin
     B's row.
   - HP Hero's world actor lost its row's amount. Each goblin token's actor
     lost its own amount, HP Goblin B's halved and rounded up. The HP Goblin
     world actor still reads 8 of 8, and HP Cart is unchanged.
3. **Heal, set, an own amount, and Stop at 0.** Heal `100`: before you apply,
   the After column previews each maximum, and after you apply, each row is at
   its maximum. Set to `3`, with an own amount of `-2` on HP Goblin A. Then
   clear that own amount, which a row keeps until it is cleared, tick **Stop at
   0**, and damage `5`.
   **Observable:** after the set, HP Hero and HP Goblin B read 3 and HP Goblin
   A reads −2. After the damage, HP Hero and HP Goblin B read 0 and HP Goblin A
   is still −2.
4. **Undo.** Press **Undo last**.
   **Observable:** HP Hero and HP Goblin B read 3 again and HP Goblin A still
   reads −2. A "Hit Points Restored" card is whispered to the GMs, and Undo is
   disabled until the next change.
5. **Down, and Mortal Wounds.** Untick Stop at 0 and damage `5`.
   **Observable:** the card rows of HP Hero and HP Goblin B say Down, and HP
   Goblin A's, already below 0, does not. Under Last change, HP Hero alone has
   a **Mortal Wounds** button, because the goblins are monsters.
   Pressing it opens the system's own Mortal Wounds window. Close that window
   without rolling.
6. **Shown to players.** Tick **Show the report to players** and heal `1`.
   **Observable:** the card has no whisper list, and the Player seat (step 9)
   sees it.
7. **A stack.** In page context, `api.lib.hp.open({actors: [guards]})`.
   **Observable:** one HP Guards row, unticked, reading "A group. Deploy it and
   adjust its members on the map."

   Deploy two bodies with `api.lib.groups.deploy(guards, scene, {count: 2})`,
   `api.track` each returned token, and `api.track` the stack's
   `template.uuid` if it names an actor that is not HP Goblin. Then open the
   tool on HP Guards again.
   **Observable:** a row per body, under the body's token name. Damage `1`,
   and each body token's actor loses 1 while HP Guards is unchanged.
8. **Layout and type size.** Size the window to 480×320, then re-render it.
   **Observable:** the body scrolls, the footer with Apply stays pinned, and
   the body keeps its scroll position across the re-render. Raise the type
   knob, then close and reopen the window: the rows, the controls and the
   footer buttons all grow with it.
9. **The player seat.** Join as Player from the capture driver's own browser
   (`connect({ user: "Player" })`).
   **Observable:**
   - The Tokens controls have no **Adjust hit points** button.
   - Running *Adjust Hit Points (GM)* warns that only a GM can adjust hit
     points, and no window opens.
   - `api.lib.hp.open()` returns null.
   - `await api.lib.hp.adjust({actors: [<HP Hero>]}, {amount: 1})` returns
     null, and HP Hero's hit points do not change.
10. **First rendered in a detached window.** As GM, take the window's class
    from an open one, `api.lib.hp.open({actors: [<HP Hero>]}).constructor`,
    and close it. Detach HP Cart's sheet ("A long window title stays on one
    line", drive notes), then
    `cartSheet.renderChild(new Cls({from: {actors: [<HP Hero>]}}))`. With real
    input in the popup, click the amount, select all, type `7` and press Tab,
    then click **Show the report to players**.
    **Observable:** the window's root reads `instanceof HTMLElement` false.
    The After column reads HP Hero's hit points less 7, and the box is still
    ticked after the render its click caused. A capture listener for `change`
    on the root reads `event.target instanceof HTMLInputElement` false for
    both events, so a guard written that way would have dropped them.

**Teardown.** `api.sweepTracked()`. The scene takes every token on it with
it, the body tokens included, so those sweep as missing.

## A token created again under its own id

Covers `installRecreatedHitPoints` and `recreatedHitPointsPatch` (MODEL.md,
"The hit-point tool"). Driven by a script over the capture driver, from the
Gamemaster and from the Assistant Gamemaster, each on its own port; no walk in
`tools/live` covers it. The system's `autoRollMonsterHP` must be on.

**Fixtures**, each `api.create()`d or `api.track()`ed:
- Scenes A and B, the arrival and the departure: docs/formation/TESTING.md,
  "A teleport between scenes".
- "Soldier", a `monster` with `prototypeToken.actorLink: false`, then
  `system.hp` written by an update (`hd` 2d8, 9 of 9).
- A group of Soldiers with two bodies deployed on A: "A group body moved
  between scenes", below.
- "Hireling", a `monster` like Soldier at 6 of 6, dropped on a hand-created
  party actor's sheet, with the party token on A, then detached
  (docs/formation/TESTING.md, "A detached member moved between scenes"). Track
  the token the member's `deployedTokenId` names.
- A loose token of Soldier on A, created from plain data.

**Drive mechanics.**
- Arm a `preCreateToken` observer on the seat that runs each create. Record
  `options.keepId`, `options.isUndo`, `data.delta.system.hp`, and
  `tokenDoc.delta._source.system.hp`. It is registered after lib's hook, so the
  last figure is what the token will store.
- Wound each token with `token.actor.update` to a value below a maximum of 13.
  A roll sets the value and the maximum alike, so it cannot pass for a wound.
- Read a delta that matched its actor's maximum as sparse: a member wounded to
  2 of 6 carries only `{value: 2}`.
- A teleport views the destination for the seat that moved. View A again
  before cutting there.
- Cut: control the token, `canvas.tokens.copyObjects({cut: true})`, view B,
  `canvas.tokens.pasteObjects({x, y})`, whose return is the pasted documents.
  A copy is the same without `cut`. Undo: delete a token while viewing its
  scene, then `canvas.tokens.undoHistory()`; it returns the token re-created
  under the same uuid.
- Place from plain data, `scene.createEmbeddedDocuments("Token", [{actorId,
  actorLink: false, x, y}])`. Core's own actor drop (`getTokenDocument`, then
  `create`) leaves the delta empty, and the system does not roll it at all.

1. **A moved body keeps its wounds.** Wound the two bodies to 1 and 0 of 13
   and teleport each from the seat under test (the group recipe's steps 1 and
   2).
   **Observable:** each arrival reads its body's figures. The observer saw
   `keepId: true` and the data holding them.
2. **A moved member keeps its wounds.** Wound the hireling's token to 2 of 6
   and teleport it, then press its detach control again.
   **Observable:** the arrival reads 2 of 6, and after the recall the stash's
   `tokenData.delta.system.hp` reads 2 of 6.
3. **Cut and paste between scenes.** Wound the loose token to 1 of 13, cut it
   on A and paste it on B.
   **Observable:** 1 of 13, with `keepId: true`.
4. **A copy is a new creature.** Copy the pasted token and paste it on B.
   **Observable:** no `keepId`, and the copy reads a roll while its data held
   1 of 13.
5. **An undone deletion.** Delete the pasted token and undo.
   **Observable:** 1 of 13, with `keepId` and `isUndo` true.
6. **A placement rolls.** Place a Soldier on B from plain data.
   **Observable:** no `keepId`. The data held no hit points and the token
   reads a roll.
- Unfixed, every arrival in steps 1, 2, 3 and 5 read a roll, and the recall
  stashed the member's.

**Teardown.** `api.sweepTracked()`. The originals the teleports and the cut
deleted, and the arrivals the recalls deleted, sweep as missing. The detach
and the recall post chat cards: read each card's id back right after the
gesture that posted it and `api.track(id, "ChatMessage")` it.

## A deployed body's hit points

Covers `KEEP_HIT_POINTS_OPTION` as `deploy` passes it (MODEL.md, "The
hit-point tool"). Driven by a script over the capture driver, from the
Gamemaster and from the Assistant Gamemaster, each running every create from
its own seat; no walk in `tools/live` covers it. The system's
`autoRollMonsterHP` must be on.

**Fixtures**, each `api.create()`d or `api.track()`ed:
- Scene A.
- "Soldier", a `monster` with `prototypeToken.actorLink: false`, then
  `system.hp` written by an update (`hd` 2d8, 9 of 9).
- A group with one stack of Soldier, three strong
  (`acksExtras.lib.groups.addStack(group, soldier, {count: 3})`). The stack's
  template is Soldier itself, so `deploy` mints no base actor; track
  `stackOf(key).template.uuid` if it differs.
- Every token `deploy` returns, a plain placement, and a pasted copy.

**Drive mechanics.**
- Arm the `preCreateToken` observer of "A token created again under its own
  id" on the seat that deploys, and wrap the system's
  `CONFIG.Actor.documentClass.prototype.rollHP` there to record each roll's
  total. A roll can land on the record's own figures (seen: data 12 of 12,
  roll 12). Only the wrap tells that from a kept record.
- A fresh body's record exists only after `deploy` has materialized it, and
  `deploy` writes no record's delta: read the roster after the deploy.
- Recall with `acksExtras.lib.groups.recall(group)`. The deployed tokens it
  deletes sweep as missing.

1. **A fresh deploy.** Deploy two bodies onto A.
   **Observable:** each arrival reads its record's hit points. The observer
   saw `acks-extras.keepHitPoints: true` and no `keepId`. The wrap saw one
   roll per body.
2. **A wounded body deployed again.** Wound the first body to a value of 1,
   leaving its maximum, recall the group, then deploy two again.
   **Observable:** the recall reports no casualty, the record reads 1 of its
   maximum, and its arrival reads the same. The other body reads its record.
3. **A placement rolls.** Place a Soldier on A from plain data.
   **Observable:** no option, and the token reads the wrap's roll.
4. **A copy rolls.** Control a deployed body on A, `copyObjects()`, then
   `pasteObjects({x, y})`.
   **Observable:** no option, and the copy reads the wrap's roll.
- Unfixed, every arrival in steps 1 and 2 read the wrap's roll.

**Teardown.** `api.sweepTracked()`.

## A long window title stays on one line

Covers the design system's heading rule (`vendor/acks-design/base.css`,
HEADINGS) where it meets core's window header, and the title rule that
answers it (`vendor/acks-design/foundry.css` § 2). Nothing offline sees it:
the fault is a cascade result, and the suite has no cascade. Steps 5 to 10
cover the hover that shows a cut-short title whole (`window-title.mjs`):
`tools/test-window-title.mjs` holds its guards against a stand-in manager, and
only a real pointer on a real header proves the rest. Step 10 is also the
walk for `elementOf` (`util.mjs`), which every render hook takes its root
through: `tools/test-lib.mjs` holds its cases against stand-ins from a second
realm, and only a window first rendered in a detached one proves the hooks.
Steps 11 to 13 cover the look, theme and type-size pins on a detached page
(`client-pins.mjs`): `tools/test-lib.mjs` holds the writers against stand-in
pages, and only a second document that core itself copies into proves the two
agree. Step 14 covers core's own mark on that page, which the same file
keeps: the suite holds the watch against a stand-in window, and only core's
own pass over a real page proves the watch answers it.

**Drive notes:**
- **Count lines from a `Range`.** Select the title's contents and count the
  distinct `top`s of `getClientRects()`. The header clips a wrapped title to
  its own height, so a screenshot shows two lines where there are three.
- **Take `app.element` as it is.** A sheet's root is a `<form>`, and a form
  indexes its controls: `app.element[0]` is the first input, not the root.
- **The character sheet and the item sheet cannot show this.** Both clip
  their title to a 1px box.
- **Construct the system's monster sheet.** The world's default for a monster
  is this module's follower card. The system's own is
  `Object.values(CONFIG.Actor.sheetClasses.monster).find((r) => r.id.startsWith("acks.")).cls`,
  built with `{document: actor}`. Under `sheetStyle` `full` its root carries
  `acks-ui` from the render hook, and its own `classes` do not name it. Keep
  the instance and close it yourself.
- **A window refuses a width below its minimum.** The system's sheet stays
  900px wide when asked for 420.
- **Give the two dialogs a title of about 66 characters.** The unclassed
  dialog sets its title in core's smaller face: one of 58 characters shows
  whole there at 420px. One of 66 truncates there, and shows whole on the
  dressed dialog at 1100px.
- **Raise the type size in this client alone.**
  `document.documentElement.style.setProperty("--acks-fs-base", "18px")` pins
  the `fontScale` setting's maximum without writing the setting. Close the
  windows and open them again before measuring; `removeProperty` restores the
  default.
- **Centre against the header's box.** Core's header has a 1px bottom border
  and this module's dress has none, so on a core window the title and the
  controls read −0.5 against the box, and on a dressed one they read 0.
- **Hover with real input.** Attach a second DevTools session to the page
  (`Target.attachToTarget` on the `/game` page target, `flatten: true`) and
  send it `Input.dispatchMouseEvent`: `mouseMoved`, `mousePressed`,
  `mouseReleased`, and for a drag `mouseMoved` with `buttons: 1` between the
  two. A `PointerEvent` dispatched from script reaches the title's listeners
  and skips the browser's hit test, and the hit test is what says a hidden
  title takes no pointer. A listener that records `event.isTrusted` tells the
  two apart.
- **Park the pointer and clear the tray before each hover.** Move the pointer
  to bare canvas, wait out the manager's half second, clear
  `ui.notifications`, and check that `document.elementFromPoint` at the
  title's centre returns the title. A toast over a window near the viewport's
  top takes the hover, and the result then reads as a title that did not
  answer.
- **Read the tooltip off the manager.** `game.tooltip.element` is the element
  it shows for, and `game.tooltip.tooltip` carries the class `active` while it
  shows. The tooltip keeps its last text and position after it hides, so
  neither says one is up.
- **Sample on both sides of the delay.** Nothing at 250ms, showing at 950ms,
  still showing 250ms after the pointer leaves, gone by 1150ms. Let the page
  go quiet before the first hover: after a reload, or after opening several
  sheets, the delay's timer waits on the thread and the tooltip is late, not
  absent. A `longtask` `PerformanceObserver` says when the page is quiet.
- **The probe's `truncated` is coarser than the watch.** Its 1px allowance
  reads false until the text is 1.5px over, and the watch answers from the
  first fraction of a pixel. Set a width to a fraction through
  `app.element.style.width`.
- **A detached window is its own page.** After core's Detach control the
  window is in a popup with a page target of its own (`/detached/index.html`).
  Attach a session to that target and send the pointer there, in the popup's
  viewport coordinates. State is still read from the main page:
  `app.element.ownerDocument` is the popup's document.
- **Detach from script with a user gesture.** `app.detachWindow()` opens the
  popup with `window.open`. Evaluate it on the second session with
  `Runtime.evaluate` and `userGesture: true`, which the popup blocker lets
  through.
- **First rendered in a popup is `parent.renderChild(app)`.** The parent is a
  window already detached. Nothing in core, the system or this module renders
  an ACKS window that way, so the walk does it by hand. The known positive is
  `app.element instanceof HTMLElement === false`. A window detached after it
  rendered reads true there, and proves nothing about the hooks.
- **Ask `instanceof` of an element something holds.** The answer belongs to
  the script object, and an element nothing holds may be given a new one
  between two readings. `app.element` is held by its application.
- **Widen the popup before a press.** It opens at its parent's size, and a
  header control of a wider sheet sits off the page: a press there lands on
  nothing and reads as a dead control. `Emulation.setDeviceMetricsOverride` on
  the popup's session sets its viewport, and `elementFromPoint` in the popup's
  document says whether the control is under the point.
- **`detachWindow()` resolves before the window has moved.** Core queues the
  move behind the render it awaits. Poll until
  `app.element.ownerDocument !== document` and
  `foundry.applications.detached.windows.has(app.id)`.
- **Read a page's pins off its own document.**
  `foundry.applications.detached.windows` maps an id to `{window}`. The pins
  are `data-acks-look` and `data-acks-theme` on
  `window.document.documentElement`, its inline `--acks-fs-base`
  (`style.getPropertyValue`), and `acks-lib-sheet-theme` on
  `window.document.body`. Compute a window's styles with its own page's
  `getComputedStyle`, `el.ownerDocument.defaultView`. Leave `body.detached`
  out of a comparison with the main page: it is core's, and the main page
  never has it.
- **Core's interface pass is
  `game.configureUI(game.settings.get("core", "uiConfig"))`.** After the
  driver's `api.compose()`, call `ui.hotbar.render({force: true})` first.
  `compose()` closes core's own interface too, and the pass resizes the
  hotbar, so it throws on the element that is gone.
- **Change a setting while a page opens.** For one detach, wrap
  `copyAttributes` on `Object.getPrototypeOf(foundry.applications.detached)`.
  When it is handed a `<body>` of another document, put the original back and
  call `game.settings.set`: a client setting's `onChange` has run by the time
  `set` returns. The new window joins `detached.windows` only after that.
- **A closed window stays listed for a second.** `window.closed` is true, the
  entry is still in `detached.windows`, and its `document` still answers. The
  closed document's own attributes say whether anything wrote to it.
- **Drive Configure Settings with keys.**
  `game.settings.sheet.render({force: true})` opens it. The module's tab is
  `nav.tabs button[data-action="tab"][data-tab="acks-extras"]`, a control is
  named `acks-extras.<key>`, and Save is
  `footer.form-footer button[type="submit"]`. A `<select>` focused from
  script moves one option for each `ArrowDown` or `ArrowUp`. The type size is
  a `range-picker`, and its `input[type="range"]` moves half a pixel for each
  `ArrowRight`. Send a key as
  `Input.dispatchKeyEvent`, `rawKeyDown` then `keyUp`. The walk had
  `Emulation.setFocusEmulationEnabled` on, and was not tried without it. The
  window closes on Save.
- **The three settings are this browser's alone.** They are client settings,
  kept in the driver's own profile, and changing them moves no other seat.
- **Read core's mark in the evaluation that runs the pass, and again after
  it.** `body.classList.contains("detached")` straight after
  `game.configureUI(...)` reads what core's write left. Read it again in the
  `then` of `Promise.resolve()` returned from that evaluation: the watch has
  answered by then.
- **What a page shows without the mark, with the watch in place.** Take the
  class off and read in one evaluation. `getComputedStyle` and
  `getBoundingClientRect` lay the page out as it stands at that moment, and
  the watch answers once the evaluation returns.
- **Make a page taller than 850px to see core's size cap.** Without the mark
  core caps a window at the whole viewport in one 850px high or less, and at
  one and a half hotbar heights short of it in a taller one, so only a taller
  page shows the cap. `Emulation.setDeviceMetricsOverride` on the popup's
  session (800 by 1000 here) resizes the page, and core's resize listener
  there sets a resizable first window to the page's size.
  `Emulation.clearDeviceMetricsOverride` puts the page back.
- **Core's Configure Interface.**
  `new foundry.applications.settings.menus.UIConfig().render({force: true})`
  opens it, with the id `ui-config`. A control is named
  `core.uiConfig.<path>`. The fade speed is a `range-picker` whose
  `input[type="range"]` moves 50ms for each `ArrowRight`, and each step
  previews by running core's pass: the main `<body>`'s inline
  `--ui-fade-duration` then reads the previewed speed. The header's
  `[data-action="close"]` closes it unsaved, which runs the pass again with
  the stored configuration. `core.uiConfig` is a client setting too.
- **Flip the browser's colour scheme.** `Emulation.setEmulatedMedia` with
  `features: [{name: "prefers-color-scheme", value: "light"}]` on the main
  page's session, and an empty `features` to release it. Core answers each
  change with a pass that is handed no configuration, and the main
  `<body>`'s `--ui-fade-opacity` reads `undefined` until a pass with the
  stored one has run.

**Fixtures (each id recorded with `api.create`):** an `acks-extras.vehicle`
named with an invented phrase of about 45 characters, and a `monster` and an
`acks-extras.marketReport` item named with one of about 85. For steps 7 and 8,
a `character` owned by every seat (`ownership: {default: 3}`) holding an
`item` of `system.quantity.value` 6 named with one of about 70, and a plain
world `item`. For step 10, a second `acks-extras.vehicle`, a second `monster`
and two more `character`s, each named with the 85-character phrase. For steps
11 to 14, three `acks-extras.vehicle`s under any name.

**The probe.** Run it on a heading element. A window's title is
`app.element.querySelector(":scope > .window-header .window-title")`.

```js
(h) => {
  const range = document.createRange();
  range.selectNodeContents(h);
  const rects = [...range.getClientRects()].filter((r) => r.width > 0);
  return {
    whiteSpace: getComputedStyle(h).whiteSpace,
    lines: new Set(rects.map((r) => Math.round(r.top))).size,
    truncated: h.scrollWidth > h.clientWidth + 1,
  };
}
```

1. **Five windows at 420px.** Open the vehicle's sheet and the monster's,
   render the system's monster sheet, and render two `DialogV2`s whose
   `window.title` is a few words followed by the 45-character phrase: one with
   `classes: ["acks-ui", "acks-extras", "acks-extras-scroll"]`, one with no
   classes. `setPosition({width: 420})` on each and probe each title.
   **Observable:** all five read
   `{whiteSpace: "nowrap", lines: 1, truncated: true}`. The unclassed dialog
   is core's own behaviour, and the other four match it. A wrapped title reads
   `whiteSpace: "normal"` and two or more lines.
2. **Widened.** `setPosition({width: 1100})` on each.
   **Observable:** every title still reads one line. The vehicle's and both
   dialogs' read `truncated: false`, the whole title showing.
3. **A heading in a window's body still wraps.** Open the market report and
   probe `.acks-extras-markets-report-title`, the item's name set as a heading
   in the sheet's body.
   **Observable:** `whiteSpace: "normal"` and more than one line.
4. **The title sits on the header's centre line.** Run the centring probe on
   the five windows of step 1. Then raise the type size, open the five windows
   fresh and run it again.

   ```js
   (app) => {
     const header = app.element.querySelector(":scope > .window-header");
     const h = header.querySelector(".window-title");
     const mid = (el) => {
       const r = el.getBoundingClientRect();
       return (r.top + r.bottom) / 2;
     };
     const off = (el) => Math.round((mid(el) - mid(header)) * 10) / 10;
     const range = document.createRange();
     range.selectNodeContents(h);
     const line = Math.max(...[...range.getClientRects()].map((r) => r.bottom));
     const cs = getComputedStyle(h);
     return {
       margins: `${cs.marginTop} ${cs.marginBottom}`,
       title: off(h),
       controls: [...header.querySelectorAll(".window-icon, .header-control")]
         .filter((el) => el.getClientRects().length)
         .map(off),
       past: Math.round((line - header.getBoundingClientRect().bottom) * 10) / 10,
     };
   }
   ```

   **Observable:** at both sizes the four `acks-ui` windows read
   `margins: "0px 0px"`, a `title` of 0, every entry of `controls` 0, and a
   negative `past`: the title's line ends inside the header. The unclassed
   dialog reads −0.5 for `title` and for each control. A title that takes the
   heading rule's margins reads `margins: "24px 8px"` and a `title` of 8, and
   at 18px its `past` is 3: the line's box ends below the header's edge,
   though the capitals' ink does not.
5. **A cut-short title shows whole on a hover.** With the five windows of
   step 1 at 420px, rest the pointer on each title for a second and move it
   away. Widen each to 1100px and do the same, then set the vehicle's sheet
   back to 420px and hover it once more. On the dressed dialog, hover the
   header 13px above the title's centre as well.
   **Observable:** at 420px the four `acks-ui` windows show nothing 250ms in.
   At 950ms `game.tooltip.element` is the title, the tooltip's text is the
   title's `textContent`, its bottom edge is 5px above the title's box, and
   the title has no `aria-describedby`. It is gone within 1150ms of the
   pointer leaving. The unclassed dialog shows nothing. At 1100px the
   vehicle's sheet and the dressed dialog show nothing, and the monster's two
   windows, still cut short, still answer. Back at 420px the vehicle's sheet
   answers again with no render in between. The header above the title's line
   hit-tests as the header, and shows nothing.
6. **The title is still the handle.** On the dressed dialog, with its tooltip
   showing, press on the title, drag 120px right and 70px down, hold for a
   second, release, and leave the pointer where it is. Then start a fresh
   hover, press 150ms into it and hold. Then double-click the vehicle sheet's
   title.
   **Observable:** the tooltip is gone 60ms after the press. `app.position`
   has moved by the drag. Nothing shows while the button is held. Half a
   second after the release the tooltip is back: the title logged a fresh
   `pointerenter`. The early press shows nothing while it is held, and nothing
   after its release. The double click minimizes the sheet, and its title, cut
   short at the minimized width, answers a hover.
7. **What stays silent, and where the tooltip sits.** Open the character's
   sheet and the plain item's.
   **Observable:**
   - On both, `document.elementFromPoint` at the title's centre returns the
     sheet's own band, a listener on the title records no pointer event, and
     nothing shows. The same with each minimized.
   - `game.settings.set("acks-extras", "look", "core")`: the follower card's
     root wears neither dress class, its title is still cut short, and nothing
     shows. Set back, it answers again with no render in between.
   - `sheetStyle` `palette`: the system's monster sheet wears `acks-palette`
     and narrows to 420px. Its title is cut short and answers.
   - The dressed dialog at `top: 0`: the tooltip starts 5px below the title.
     At `top: 430` it ends 5px above. At no position does it overlap the
     title.
   - Rest on the dialog's close button until its tooltip shows, then move
     onto the title: the title's tooltip replaces it at once and is still up a
     second later.
   - With the type size at 18px, a dialog opened fresh answers at 420px.
   - A touch held on the title for a second (`Input.dispatchTouchEvent`,
     `touchStart` then `touchEnd`): the title logs `pointerenter` and
     `pointerdown` together, and nothing shows.
   - Close the dressed dialog from script while its tooltip shows, the
     pointer left where it is. Over bare canvas the tooltip is gone within
     600ms; closed 200ms into a hover, nothing shows at all. Over another
     window, what lies beneath takes the pointer within a frame and may show
     a tooltip of its own: the observable there is that the closed title's
     text is not up.
   - A middle press on the title while its tooltip shows: the tooltip goes,
     and the page holds no `.locked-tooltip`.
   - While a tour's step shows (a `foundry.nue.Tour` of one step, started,
     its overlay set to `pointer-events: none` so the pointer reaches the
     title), a long hover on a cut-short title leaves the tooltip the tour's:
     it keeps the class `tour` and the step's text. After `tour.exit()` the
     title answers again.
8. **A dialog a player opens.** From a player's seat, open the character's
   sheet, click the Equipment tab, and click the stack's Divide control
   (`[data-action="divideStack"]`).
   **Observable:** a `DialogV2` wearing `acks-ui`, 400px wide with
   `options.window.resizable` false, titled "Divide" and the item's name. The
   name is cut off the end, and a long hover shows the whole title.
9. **Popped out.** On the dressed dialog, click the header's controls button
   and then Detach Window. Hover the title in the popup, then call
   `app.attachWindow()` and hover it in the main window.
   **Observable:** `app.element.ownerDocument !== document`. The tooltip
   shows, and `game.tooltip.tooltip.ownerDocument` is the popup's document. It
   sits below the title: the popup's viewport begins at the window's top.
   Attached again, the title answers in the main window.
10. **First rendered in a popup.** Detach the first vehicle's sheet from a
    user-gesture evaluation. Hand its `renderChild`, in turn, a dressed
    dialog, an unclassed one, the second vehicle's sheet, and the system's
    sheets for the second monster and for one character, each constructed as
    the monster's is. In the main window render a dressed dialog and the
    system's sheets for the first monster and the other character.
    **Observable:**
    - Each of the five roots reads `instanceof HTMLElement` false, with
      `ownerDocument` the popup's.
    - The system's two sheets wear `acks-ui`. On each, and on the dressed
      dialog, the dress classes, the computed face of the root and of the
      title, and the `--acks-*` token values equal the main-window copy's.
    - The second vehicle's sheet wears the dress on its root, and its first
      control, `app.element[0]`, wears neither dress class.
    - The character sheet carries the class picker, the roster button and
      influence's button, as its main-window copy does, and a second
      `render()` leaves one of each.
    - A hover in the popup shows the whole title on the four ACKS surfaces and
      nothing on the unclassed dialog.
    - With the popup widened, a real press on the roster button
      (`.acks-henchmen-roster-button`) opens the roster, in the main window.
    - `attachWindow()` on the first vehicle's sheet brings its children back
      with it. The character sheet is then in the main document, still reads
      `instanceof HTMLElement` false, keeps the dress and one of each control
      across a `render()`, and its title answers a hover in the main page.
    - The console holds no error.
11. **A setting changed while a window is popped out.** Detach a vehicle's
    sheet and take a reading at the defaults. Then take one after each of
    these: `fontScale` 18; `theme` `light`, then `dark`, then `follow`;
    `theme` `dark` with `look` `core`; `look` `book`; `fontScale` 14; `theme`
    `follow` with `look` `world`. From `dark` on, take another once core's
    interface pass has run. A reading is each page's pins, a dressed dialog
    rendered fresh in the main window, one handed to the sheet's
    `renderChild`, and the detached sheet itself. The figures are with core's
    colour scheme dark, as the driver's browser has it.
    **Observable:**
    - At every reading the popup's pins equal the main page's, and the two
      fresh dialogs agree in title size, ground, ink and `--acks-paper`.
    - At 18 both pages carry an inline `--acks-fs-base` of `18px` and both
      fresh titles read 19.98px. Under `light` both grounds are
      `rgb(253, 251, 249)`, and under `dark` `rgb(27, 20, 22)`.
    - Under `core` both pages carry `data-acks-look="core"`, neither carries
      `data-acks-theme` or the body class, and both fresh dialogs come up
      undressed, a 13px title on `rgba(11, 10, 19, 0.9)`.
    - A release arrives with no interface pass. After `follow` neither page
      has `data-acks-theme`. After `book` neither has `data-acks-look`, both
      bodies carry the class and both carry `data-acks-theme="dark"` again.
      After 14 neither has an inline `--acks-fs-base`.
    - The detached sheet, open since before each change, follows at once. Its
      title reads 19.98px at 18 and 15.54px at 14, it loses the dress under
      `core`, and after `book` its ground is `rgb(27, 20, 22)` with
      `--acks-paper` at `#1b1416`. A sheet dressed in a page that kept
      `data-acks-look` reads `rgba(0, 0, 0, 0)` and `transparent` there.
12. **A page that opens, and a window that has closed.**
    - With `fontScale` 16.5 and `theme` `light` set, detach a second sheet.
      **Observable:** the new page equals the main one as it opens, a fresh
      title of 18.315px on `rgb(253, 251, 249)` in all three pages, and the
      next change reaches both popups.
    - Set `theme` `dark` and `fontScale` 14, arm the wrap of the drive notes
      with `theme` `follow` and `fontScale` 18, and detach a third sheet.
      **Observable:** the wrap finds the page unlisted, carrying
      `data-acks-theme="dark"` and no inline knob. Once the detach completes,
      the page carries no theme pin and `18px`, as the main page does, and a
      fresh title there reads 19.98px.
    - Call `attachWindow()` on the second sheet and change `fontScale` at
      once, again 400ms later, and then run core's interface pass. Close the
      third popup with its window's `close()` and do the same with `theme`.
      **Observable:** each window reads `closed` and is still listed. No
      change throws, core's pass does not, and the console holds no error.
      Through both changes the closed document keeps the knob and the theme
      attribute it closed with. Core's pass then sets `data-acks-theme` on
      the popup closed by hand, and that write is core's.
13. **Through Configure Settings.** With a sheet detached and the defaults in
    force, open the settings window in the main page and click the module's
    tab. Set the theme to light and the type size to 18 with the keys of the
    drive notes, and click Save. Open it again, set the look to core, and
    save. Open it again, put all three back, and save.
    **Observable:** before each Save, neither page has changed. After each,
    the settings window has closed and the two pages carry the same pins, by
    the figures of step 11: 19.98px on `rgb(253, 251, 249)`, then undressed,
    then 15.54px on `rgb(27, 20, 22)` with no pin left in either page.
14. **Core's own mark outlasts core's pass.** Detach a vehicle's sheet and
    take a reading: whether each detached `<body>` and the main one carry
    `detached`, the detached body's computed `background-color`, and the
    sheet's computed `max-height` and its box. Take one again after each of
    these: core's interface pass; one `ArrowRight` on the fade speed in
    core's Configure Interface, then its header close; the same key press
    saved, then `core.uiConfig` set back; the browser's colour scheme flipped,
    then released, then core's pass with the stored configuration. Detach a
    second sheet and run the pass, and a dressed dialog and run it again. Make
    the first page 1000px tall, run the pass, and take the reading of the
    drive notes with the mark off. Close the second popup with its window's
    `close()` and run the pass at once and 400ms later. Put the first sheet
    back with `attachWindow()` and run the pass once more.
    **Observable:**
    - At every reading each detached `<body>` carries `detached` and reads
      `rgb(46, 44, 41)`, and the main `<body>` never carries it.
    - Read in the evaluation that runs the pass, the mark is off. Read after
      it, the mark is back.
    - A sheet reads `max-height: none` and stands the full height of its
      page: 511px in the page the driver's browser opens, and 1000px in the
      one made that tall.
    - With the mark taken off that tall page, in the same evaluation: the
      ground reads `rgb(0, 0, 0)`, and the sheet reads `max-height: 922px` and
      stands 922px high over 78px of ground. The next reading has the mark,
      and 1000px again.
    - The dialog keeps the inline `max-height` and `max-width` core wrote on
      it as it detached, and its page reads `rgb(46, 44, 41)` after the pass.
    - After the key press the main `<body>`'s `--ui-fade-duration` reads 50ms
      above the stored speed, and the stored speed changes only at Save.
    - With the closed window still listed, neither pass throws, and the
      console holds no error.

**Not reached.** A browser other than the Chromium build the capture driver
launches. The world's UI preset changed from another seat while a window is
detached: it arrives through the `look` setting's own applier and was read,
not driven. In a detached page: a window that carries `faded-ui`, as core's
placeable palettes do, and one minimizing or maximizing. Core has a `detached`
rule for each, and the walk met neither. A change of the operating system's
own colour scheme: the walk stands the browser's media emulation in for it.
In a popup: a scene, region, wall or roll-table configuration
window, the token HUD, a chat card and a directory context menu, whose hooks
take their element through the same resolver. The hit-point window is "The
hit-point tool", step 10; the repair window's own checkbox guard needs a
finding to tick and was read, not driven.

**Teardown.** Close the windows, the constructed system sheet included, set
`look` and `sheetStyle` back to what step 7 found, `theme` and `fontScale`
back to what step 11 found and `core.uiConfig` back to what step 14 found,
and `api.sweepTracked()`.

## Conditions on the palette and on a roll

Covers `conditions.mjs`, `status-effects.mjs`, the palette's arrangement
(`status-palette.mjs`) and its editor (`apps/status-palette-app.mjs`), the
attack throw's condition rows and the damage factor and waived throw it is
told of (`patches/attack-throw.mjs`), the surprise shim (`patches/surprise-card.mjs`),
the `lib.statusIds` repair check, and the importer's `conditions` document.
The morale page's condition rows are influence's own recipe.

**Drive notes:**
- **Price the conditions in your own client, not in the world.**
  `acksExtras.lib.tables.registerTable({id: "conditions", source: "invented",
  tables: {modifiers: {…}}}, {priority: PRIORITY.OVERRIDE + 1, source:
  "live-test"})` registers invented figures for this client alone and outranks
  whatever the world imported. `unregisterTable("conditions", {priority:
  PRIORITY.OVERRIDE + 1})` ends it. Name the priority: a call without one
  drops every layer of the document in that client, the world's import
  included, until the page reloads. A second seat registers its own.
- **A monster's token is unlinked.** Toggle and read its conditions on
  `tokenDoc.actor`. The world actor's statuses do not change when the tracker
  lifts a condition from the token, which reads as the lift having failed.
- **Read an attack's terms from the hook, not the card.**
  `Hooks.on("acksLibPostAttackRoll", (actor, ctx, res) => …)` hands over
  `ctx.terms`, `ctx.damageTerms`, `ctx.damageFactor` and `ctx.autoHit` as the
  roll used them.
- **Roll without a dialog.** An attack takes `{skipDialog: true}`. A save, an
  adventuring throw and a morale roll take
  `{event: {[game.settings.get("acks", "skip-dialog-key")]: true}}`, and the
  Roll they resolve to carries the target it used at `roll.data.roll.target`.
- **Record notifications and rejected promises yourself.** Wrap
  `ui.notifications.info/warn/error` to collect what the roller is told. A
  throw inside a clicked action is an unhandled rejection and never reaches
  `console.error`: listen for `unhandledrejection`.
- **View the scene before creating tokens on it.** Tokens created first raise
  `RenderFlags` errors from the token sense sync while the canvas draws, which
  read as a fault in the code under test.
- **The Surprise Matrix's cells** are
  `[data-action='rollSurprise'][data-adventurer-status][data-monster-status]`;
  `fore`/`fore` rolls both sides. Core's own action, taken from
  `app.constructor.DEFAULT_OPTIONS.actions.rollSurprise`, is the baseline with
  no module wrapper. In the capture driver's browser the combat's round stays
  0 after the roll with or without the wrapper, so do not use it as the
  observable.
- **The token HUD** binds with `canvas.hud.token.bind(token)` after
  `token.control()`; its palette is `[data-status-id]`.
- **A token's `detectionModes` is a map** of id to range, not a list.
  `token.object.vision` exists only while the token is controlled, so
  `token.object.control()` comes before any `_canDetect` or
  `canvas.visibility.testVisibility(point, {object})` reading.
- **A creature that hears.** A monster whose stat block records
  `vision: ["blind"]` and nothing else reads as having shadowy senses; a sense
  listed under `otherSenses` with an unknown type gives it none, and a check on
  it then passes for the wrong reason.
- **Read an attack's rows from the system's own outcome.** Arm
  `Hooks.on("acksLibPostAttackRoll", (actor, ctx, outcome) => …)` and roll
  with `actor.makeAttackThrow({item, attackType: "melee", skipDialog: true})`:
  `outcome.attackRoll` is the throw rolled, its terms the rows the card
  names, and `outcome.damageRoll` the damage; `ctx.conditions[attackType]`
  is the condition math the contributor read for that kind.
- **Fire the import into a global** and poll it
  (`TEST_ENVIRONMENT.md`, chained waits):
  `cookbookImportTables(["conditions"])` reads one document in seconds.
- **Roll a save under the system's own key.** Read the keys from
  `CONFIG.Actor.dataModels.character.schema.fields.saves.fields` (`blast`,
  `implements` since acks 14.1.0). A roll under a key the actor does not have
  proves nothing about the throw it was meant to be.
- **Start a fixture combat with `combat.update({round: 1, turn: 0})`.** The
  system's `startCombat` opens the Surprise Matrix and leaves the round at 0,
  and a `nextTurn` from round 0 begins round 1 on nobody's turn. Print
  `combat.combatant?.name` beside every reading; a helper that names "the
  other one" for a null combatant reports a turn that never began.
- **The system posts a chat line at every new round**, and no fixture speaks
  it. Wrap `CONFIG.ChatMessage.documentClass.create` in the walk's own client
  to collect the uuid of everything that client asks Foundry to post, and
  `api.track` those with the fixtures' own messages.
- **A missile weapon with no ammunition** tells "Out of ammunition" and still
  rolls; the hook still hands over the terms.
- **A real mouse drag through DevTools** (`Input.dispatchMouseEvent` on a
  second socket to the driver's page): pressed on the source, a dozen moves,
  **two more moves over the drop point**, released. A move that changes the
  element under the pointer fires `dragenter` only; the `dragover` that
  accepts the drop needs a second move over the same element, and without it
  no `drop` is ever sent. Read both ends' boxes after the last scroll, never
  with a `scrollIntoView` between them. `Page.bringToFront` first.
- **Keys and typed text.** With a tile focused, `Input.dispatchKeyEvent`
  `rawKeyDown` then `keyUp` with `key`, `code` and `windowsVirtualKeyCode`;
  text goes into the focused box with `Input.insertText`.
- **The editor's dialogs** carry the class `acks-extras-palette-dialog`: find
  the newest such application in `foundry.applications.instances`. Click the
  control that opens one without awaiting the action, which resolves only
  when the dialog is answered.
- **The stored arrangement is a `Setting` document, and this run's fixture.**
  `game.settings.storage.get("world").getSetting("acks-extras.statusPalette")`
  is null until the first Save. Stop if it is not null before the walk: that
  arrangement is someone's. `api.track` its uuid after the first Save. Reset
  and Save before the sweep: deleting the document calls no change handler,
  so a client still open keeps the arrangement it last heard.
- **A reloaded page opens on the world's active scene, or on none.** Wait for
  `game.ready`, read `CONFIG.statusEffects`, then view the fixture scene again
  before binding a token HUD.
- **An effect is dragged from the module's character sheet.** One with a
  duration is a row under Timers, one without a row under Modifiers in force;
  press on the row's name, clear of its controls. The system's own sheets
  drag no effect row.
- **Two clients on one GM seat both lift.** "ActiveEffect … does not exist"
  at a turn change, once per lifted state, is a second client of the same
  user lifting beside this one. Rerun alone before reading it as a fault.
- **Create the fixture combat `active: true`.** `game.combat` is the tracker's
  viewed combat only while the tracker is rendered; during a re-render it
  falls back to the first active combat. An inactive fixture then reads as no
  fight between two status toggles, and the second effect's `start` is all
  null.
- **Find a created token by its actor.** `createEmbeddedDocuments("Token", …)`
  hands the documents back in no promised order, and a walk that indexes them
  runs every step on the wrong creature without one error.
- **The system clears initiative at each new round** (`game.settings.get(
  "acks", "initiativePersistence")`, `reset` by default: read it, never set
  it) and lists the unrolled with the hostile first. `combat.rollAll()`
  refuses unless the system's own start ran; `combat.rollInitiative(ids)` is
  the method its buttons reach, and it puts the tracker on the first
  combatant 200 ms after its update lands. A direct
  `updateEmbeddedDocuments("Combatant", [{_id, initiative}])` leaves the
  tracker on whoever was current, at that one's new place.
- **Rig the die through `CONFIG.Dice.randomUniform`**, restored in a
  `finally`: `() => 0.025` throws a 20 on core 14 and `() => 0.975` a 1. Roll
  once and read `roll.terms[0].total` before trusting either.
- **A token dragged through DevTools.** Collapse the sidebar,
  `canvas.animatePan({x, y, scale: 1, duration: 0})` to the token, read both
  ends with `canvas.clientCoordinatesFromCanvas`, then: pressed, twenty moves
  90 ms apart each carrying `buttons: 1`, released. Eight quick moves select
  the token and move nothing. An arrow key sent to the same page moves
  nothing in the driver's browser.
- **The tracker's own control** is
  `ui.combat.element.querySelector('[data-action="nextTurn"]')`, clickable by
  the pointer once `ui.sidebar.changeTab("combat", "primary")` has shown it.
- **A player's client sees a fight only on the scene it views.** Call
  `scene.view()` from that seat before reading what a move there costs.

**Fixtures (as GM, each id recorded with `api.create` or `api.track`):**
- A scene, created with `active: false`, `ownership.default` OBSERVER, and
  viewed with `scene.view()`.
- "Hero", a `character` with `prototypeToken.actorLink: true`, owned by the
  Player seat, carrying a melee weapon and a missile weapon, with a token on
  the scene.
- "Goblin", a `monster` with `flags["acks-extras"].extras.size` set to the
  character's size, carrying a melee weapon, with a token on the scene.
- The chat messages the rolls post: collect the ids of messages whose content
  or speaker names a fixture, and `api.track` them.
- For steps 14 to 17: a third weapon on Hero that is both melee and missile
  (a thrown one), the saves' stored targets set to one known number, an Active
  Effect on Hero with a change and no duration, another with a duration, and
  the stored arrangement (drive notes).
- For steps 18 to 20: "Guard", a second linked `character` with a token, and
  a combat of the three made `active: true` with an initiative on each.

1. **The palette.** Read `CONFIG.statusEffects` and open the Hero token's HUD.
   **Observable:** an entry per catalogue condition plus `dead`, `invisible`
   and Running, every name localized, none of Foundry's generic ids, and
   `CONFIG.specialStatusEffects.BLIND` is `blinded`. Clicking Prone in the HUD
   puts `prone` on the actor; clicking again takes it off.
2. **Nothing imported.** With no figures registered, mark Hero Prone and
   attack Goblin twice.
   **Observable:** no term on either throw; one warning that nothing was
   applied for Prone, on the first roll only.
3. **The attacker's own conditions.** Register the invented figures. Attack as
   a Prone Hero; as a Blinded Hero in melee and with the missile weapon; with
   two Prone effects and two Fatigued effects, one flagged `conditionStacks:
   2`; as a Shrunk and Queasy Hero.
   **Observable:** a Prone term; a Blinded term in melee and, for the missile,
   no term and a warning that the attack is ruled out; Prone once and Fatigued
   at three times its figure, on the throw and on the damage; a damage factor
   and a Queasy damage term.
4. **The target's conditions.** Attack a Prone Hero as Goblin; a Disordered
   and Flanked Hero; a Prone Goblin as a Charging Hero; a Paralyzed Goblin in
   melee; a Hidden Goblin with the missile weapon. Then target the Goblin
   token and call `hero.targetAttack(…)`.
   **Observable:** a "Vulnerable (target)" term; a Disordered term with its
   sign reversed and no Flanked term (the flank is the system dialog's
   direction choice); the attacker's and the target's
   terms on one throw; `ctx.autoHit` naming Helpless and the card reading an
   automatic hit; a warning that the attack cannot be made, with no term. The
   targeted roll's card line names the target's term.
5. **The creature's own rolls.** Roll a save as a Hungry and Blessed Hero, an
   adventuring throw as a Queasy Hero, and morale as a Shaken Goblin token.
   Read a Blinded Hero's `system.movementacks` before, during and after.
   **Observable:** the save's and the throw's target moved by the figure, the
   stored field and `_source` unchanged afterwards, and a notification naming
   the condition; the fear-only row told as not applied; the morale formula
   carrying the figure once; every derived speed scaled while Blinded and back
   afterwards.
6. **Surprise.** Mark Hero Blinded and the Goblin token Deafened, start a
   combat holding both, and click the `fore`/`fore` cell.
   **Observable:** one notification naming both figures; the surprise card's
   totals lower by them than core's own action gives; both actors'
   `system.surprise.avoidsurprise` back at their stored value.
7. **The tracker.** In a started combat, mark both combatants Charging and
   Berserk and Hero Prone. Advance two turns, mark Hero Charging again, and
   delete the combat.
   **Observable:** each combatant loses Charging as its own turn begins and
   keeps it through the other's; deleting the combat takes Berserk from both
   and leaves Prone and the re-applied Charging.
8. **A status from before the palette.** Create an effect on Hero with
   `statuses: ["blind"]`. Scan the repair tool's "Statuses from before the
   conditions list" check and fix this run's finding only, by its uuid.
   **Observable:** the finding reads "blind becomes Blinded.", the effect's
   statuses become `["blinded"]`, and a second scan no longer lists it.
9. **The player seat.** Join as Player from the driver's own browser, register
   the invented figures there, and attack the Prone Goblin with Hero.
   **Observable:** the same two terms a GM gets. The seat cannot lift the
   goblin's condition; Foundry refuses the delete.
10. **The import.** Unregister the invented figures and run
    `cookbookImportTables(["conditions"])` with the Revised Rulebook connected.
    **Observable:** the report lists the `conditions` document and no missing
    book or table; `conditionsReady()` is true; every slot in
    `CONDITION_SLOTS` holds a number; an attack between conditioned fixtures
    carries non-zero terms.
11. **A proficiency throw and the save cell.** Give Hero an `ability` item
    with a flat target, register the invented figures, and roll it with
    `acksExtras.abilities.rollAbility(item, null, {skipDialog: true})` clean,
    Queasy, and Queasy with Blinded. Open Hero's sheet and click the ability's
    `[data-action='roll']` button with the skip key held. Then mark Hero Hungry
    and read the sheet's `[data-roll^='save']` cells.
    **Observable:** the target moves by Queasy's figure and not by Blinded's,
    whose row waits on sight; the button's tooltip and the posted card carry
    the moved target; each save cell shows the signed figure, toned as a
    penalty, and its tooltip names a modifier in force.
12. **The senses.** In a dark scene, control a token whose creature hears
    (drive notes) and read `senseProfile`, the token's detection modes, the
    shadowy mode's `_canDetect` and Hero's visibility: clean, Deafened, clean
    again, and Slumbering. Then control a token with lightless vision and read
    the lightless mode against a Hero who has an ability named for hiding:
    clean, Hidden, clean again.
    **Observable:** Deafened and Slumbering each suppress the profile, take the
    shadowy mode off the token, turn `_canDetect` false and hide Hero, and
    lifting either brings all four back; Slumbering does it with only
    `slumbering` among the creature's statuses. Hidden turns the lightless
    reading false and hides Hero, and lifting it restores both.
13. **The rows on the system's card.** Attack as in steps 3 and 4 with the
    post-attack hook armed (drive notes).
    **Observable:** the system's attack card lists each condition's row under
    its own name, the target's beside the attacker's, and its damage roll
    carries the damage row; `system.attack.mod` and `system.damage.mod` read
    as stored afterwards; a scaled damage roll and a waived throw are each
    told in a notification as something the throw cannot carry; a ruled-out
    attack warns and rolls.
14. **The states of a round on a roll.** With the invented figures: attack a
    Defending Hero as Goblin, and a Defending Goblin with Hero's missile
    weapon; a Goblin Defending with a Shield with the missile weapon, the
    thrown one and the melee one; a Defending and Casting Goblin; a Goblin In
    Cover with the missile weapon and with the melee one, then In Cover and In
    Greater Cover; attack as a Countercharging Hero, then attack that Hero,
    and a Retreating one; attack as a Readied, Delayed, Withdrawing and
    Casting Hero. Roll the Blast save and another as a Hero In Cover, In both
    covers, Defending with a Shield, that and Casting, and In Cover and
    Hungry. Open Hero's sheet and read the `[data-roll^='save']` cells.
    **Observable:** a "Defending (target)" term in melee and none for the
    missile; the shield's missile figure, its thrown figure, and Defending's
    own in melee; no term for the caster; cover's term on the missile and none
    in melee, and only the greater cover's when both are set; the
    countercharge's own term, and a "Disordered (target)" term against it and
    against the retreat; no term and no warning for the four that carry no
    figure. The Blast target moves by cover's figure, by the greater alone, by
    the shield's, and not at all for the caster; the other save moves only by
    Hungry's; the stored target and `_source` read the same afterwards. The
    sheet's Blast cell shows cover's figure where the other four show none.
15. **The tracker and the round's states.** In a started combat (drive notes),
    on Hero's own turn mark Hero with every state of step 14, and on the
    Goblin's own turn mark its token Defending, Readied, In Cover and Delayed.
    Advance over the round's end, roll the new round (`combat.rollInitiative`),
    and advance to each turn.
    **Observable:** as the round opens, before its roll, Delayed comes off
    both (the system's doing) and nothing else comes off anyone. In the rolled
    round each one's turn takes its Readied, Casting, both Defending states,
    Countercharging, Retreating and Withdrawing, and cover is still on both.
    No error is logged.
16. **The palette editor.** Assert nothing is stored. Open **Arrange the
    palette** from this module's settings and call
    `acksExtras.lib.statusPalette.open()`. Drag a tile before another, a tile
    onto *Off the palette* and back to a place, with the mouse. Focus a tile
    and press Right, Left, Home, End, Delete, Enter. Type in the filter. Press
    *Add all* on each group. Make a status with **New status** (a typed name,
    a picked icon, no id); ask again with an id Foundry's generic list used,
    one a condition has, a misshapen one, and no name, then Cancel; rename the
    new status. Drag each effect from Hero's sheet onto a tile, the one with a
    duration from its Timers row. Drop an Actor's drag data. Save.
    Bind Hero's token HUD on the GM seat and on a Player seat that has not
    reloaded. Toggle each new status on Hero, from both seats. Reload the GM
    page. Take a condition off and Save. Move a tile and close: answer No,
    then Yes. Shrink the window to a phone's width. Delete both statuses,
    Reset, Save.
    **Observable:** one window however it is opened, listing the catalogue and
    the three states by name with Save disabled, and the tracker's two other
    marks and Foundry's own statuses in groups under *Off the palette*. Each
    drag and each key moves the one tile, the focus stays on it, and Save
    comes alive. The filter leaves the matching tiles and keeps the caret.
    *Add all* empties its group onto the end of the palette. The new status is
    last on the palette with its icon and its Edit and Delete controls; each
    refused id is said and asked again with what was typed; Cancel adds
    nothing; the rename keeps the id. Each effect becomes a tile at the place
    it was dropped, marked as carrying an effect, and the Actor is refused
    with a notice. After Save the setting holds the tiles' order, every
    `CONFIG.statusEffects` entry has its place as `order`, and both seats' HUD
    lists the statuses in that order. A toggled status of the Judge's own
    makes an effect with its name and icon, and the adopted ones carry the
    dropped effect's `system.changes` and duration. The reloaded page builds
    the same list before any scene is viewed. The condition taken off has
    `hud: false`, is absent from the HUD, and is still set by
    `toggleStatusEffect`. No keeps the window and its draft; Yes closes it and
    stores nothing. The small window shows one column, scrolls, cuts no tile,
    and keeps both footer buttons inside the frame. After Reset and Save the
    setting holds no order, the list is the catalogue's again on both seats.
17. **The Player seat and the palette.** From the Player seat, open the
    module's settings, call `acksExtras.lib.statusPalette.open()`, and try
    `game.settings.set("acks-extras", "statusPalette", …)`.
    **Observable:** no *Arrange the palette* entry; the call returns null with
    a warning that only a GM arranges the palette; Foundry refuses the write.
18. **A defence given to an ally.** In a rolled round of the three, on Guard's
    turn mark Hero Defending with a Shield and Readied. Read each effect's
    `start`, `subjectOf(hero).gifts`, and the melee terms and the Blast figure
    against Hero (`attackMath`, `rollMath`). Mark Hero Casting, then Guard
    Casting, then lift Guard's. Press the tracker's Next Combatant to Hero's
    turn, on through the round, and to Guard's next turn.
    **Observable:** both effects' `start.combatant` is Guard's combatant;
    `gifts` holds `defending` and `defendingShield` and not `readied`. The
    defence's term and the shield's Blast figure stand while Hero casts, go
    while Guard casts, and come back. Hero's turn takes its Readied and
    Casting and leaves the shield; Guard's next turn takes the shield.
19. **A round opens before it is rolled.** On each round's last turn mark all
    three Readied, then advance. One round each: roll everyone at once; roll
    one combatant at a time; roll two of the three and press Next Combatant;
    roll nobody and press it. In the last two, mark the round's first
    combatant Defending before pressing. In one opened round, move a Readied
    token before anything is rolled.
    **Observable:** as each round opens the tracker stands on a combatant with
    no initiative, nobody loses anything, and the move costs nothing. Rolled
    at once, only whoever comes out first loses Readied, and the others at
    their turns. Rolled one at a time, the tracker goes to each first-so-far
    and nobody loses anything until the last roll, then only the first. With
    one unrolled, or none, pressing Next takes Readied from the combatant the
    tracker left and leaves the Defending it took up that round, and takes
    Readied from the one it lands on.
20. **Lost before it ends.** Mark Hero Readied, Casting and In Cover and the
    Goblin token Readied and In Cover. Heal Hero, then `hero.applyDamage(3,
    1)`; damage the Goblin token's actor. Mark again and roll a save with the
    die rigged to 20, then to 1. Mark again and, with Guard acting, drag
    Hero's token and update the Goblin's position; on Hero's own turn move
    Hero's. From the Player seat lower Hero's hit points, then move Hero's
    token while Guard acts.
    **Observable:** healing costs nothing. Damage takes Readied and Casting
    from Hero and Readied from the token's own actor, whose world actor keeps
    its hit points, leaves cover, and tells the client that dealt it who is no
    longer what, and why. The made save costs nothing; the failed one costs
    both and says so. A token moved while Guard acts loses Readied and keeps
    Casting, by a drag (`movement.method` is `dragging`) and by an update;
    moved on its own turn it keeps both. The Player's client lifts and is told
    for the changes it makes, and the GM's client says nothing for them.

**Teardown.** `unregisterTable("conditions", {priority: PRIORITY.OVERRIDE +
1})` in every seat that registered, then `api.sweepTracked()`. The scene takes its tokens with it and
a deleted combat sweeps as missing. The imported `conditions` document is
world ruledata and stays, like every other imported table. The stored
arrangement is swept with the rest, after step 16's Reset and Save.

## The Surprise Matrix with a combatant that cannot roll

Covers `leaveOutUnrollable` and the caught throw in
`patches/surprise-card.mjs`. One GM seat; the conditions recipe's drive notes
on the matrix's cells, notifications and rejections apply.

**Fixtures (each tracked):** two `character` actors and a `monster`, and an
actor of a type with no `system.surprise` (an `acks-extras.vehicle` is the
simplest, since it has no automation of its own). A scene with a linked token
for each: the characters and the vehicle friendly, the monster hostile.
Combat A holds all four. Combat B holds the vehicle and the monster.

**Drive mechanics.** `combat.startCombat()` opens the matrix; on a page with
the pane hidden, poll `foundry.applications.instances` for the instance whose
`options.combat` is that combat before clicking. A second call before the
first renders opens a second matrix.

1. **The vehicle is left out.** Start combat A and click `fore`/`fore`.
   **Observable:** an info notice names the vehicle; one surprise card posts
   with the monster and both characters and no vehicle row; the matrix closes;
   `combat.getFlag("acks", "initDone")` is true; `combat.pools.friendly`
   still lists the vehicle. Without the prune, the click rejects reading
   `surpriseothers` and the matrix stays open with nothing said.
2. **A side left empty.** Start combat B and click `fore`/`fore`.
   **Observable:** the info notice names the vehicle; an error notice says the
   Adventurers side has no combatant with surprise figures; no unhandled
   rejection; no card; the matrix stays open and `initDone` is unset.
3. **A cell where neither side rolls.** In the same matrix click
   `forelos`/`forelos`.
   **Observable:** the matrix closes and `initDone` is true.

**Teardown.** Close any dialog the combat start opened, then delete the
combats, the card and the actors by their tracked ids, and the scene.

## A deposit at a place the seat does not own

Covers `storage.mjs` `stash` and `retrieve` where the move is handed to the GM
(`askJudge`, `moveForSeat`). Two seats, each a driver session of its own: the
GM builds the fixtures and holds the ledger, and every step is made from the
PLAYER seat.

**Fixtures (as GM, each id recorded with `api.track`):**
- "Relay Depositor", a `character` the Player seat owns, carrying a `money`
  row (`coppervalue` 100, quantity 3500) and two plain `item`s.
- "Relay Other", a `character` only the GM owns, carrying one plain `item`.
- "Relay Abbey", a `acks-extras.location` with `ownership: {default: 2}`,
  made a place with `setProvider`. Give it three rows by
  `createEmbeddedDocuments`, each stamped under `flags["acks-extras"].storage`:
  a house row (`ownerUuid` the lib's `money.HOUSE_OWNER`) with
  `retrievable: true`, a house row without it, and a row whose `ownerUuid` is
  Relay Other's.
- Pin the abbey to the depositor (`location.reach.setPinnedPlace`), so it
  lists under *Kept elsewhere* and is within reach.

**Drive mechanics.**
- **Foundry stamps the creating user at OWNER on every document it makes**,
  whatever `ownership` the create states. A character and a place the GM
  created therefore share an owner, and `depositReach` answers yes for the
  pair by ownership. For the out-of-reach step take the GM off the place
  (`place.update({ownership: {[game.user.id]: 0}})`) and unpin it.
- **Let both pages go quiet before timing anything.** For about a minute after
  `ready` each page reads the library's books, and a relayed move resolves
  seconds late while it does. Poll for the state a step expects; a fixed wait
  followed by one read reported a finished retrieval as half made.
- The stash dialog's form names its fields `pick_<item id>` and
  `qty_<item id>`, and its confirm is `button[data-action="ok"]`.
- The no-GM step needs the GM's driver closed. Wait for the Player page to go
  quiet first: a page still reading books answers the question later than a
  thirty-second bound. Then close the driver, wait for
  `game.users.activeGM` to read null on the Player seat, and on reconnecting
  `api.track` the fixture uuids again: the ledger lives in the driver handle.
- **A player's two surfaces are both on the character.** The place's own
  sheet gives a player no Storage tab. The system's character sheet carries
  one this module injects: build it from the entry of
  `CONFIG.Actor.sheetClasses.character` that is not this module's, render it
  and click `.acks-location-storage-anchor`. The place is `[data-place-uuid]`
  inside `.acks-location-storage-tab`, its controls
  `[data-acksl-action="deposit"]`, `"retrieveAll"` and, on a row, `"retrieve"`
  beside `input[data-quantity]`.

1. **No GM connected.** With the GM's driver closed, press the abbey row's
   Deposit on the depositor's Equipment tab, tick the coin, type 3000, confirm.
   **Observable:** the "A GM must be connected" warning, the purse still at
   3500, the abbey's rows unchanged.
2. **The deposit.** With the GM back, do the same, ticking one plain item too.
   **Observable:** the purse reads 500 and the item is gone from the
   character; the abbey holds a 3000 coin row and the item, both stamped with
   the depositor's name; the row under *Kept elsewhere* counts them; no
   notification on the GM's seat.
3. **The system's sheet.** On its Storage tab, type 1000 beside the coin row
   and press that row's Retrieve; then press the place's deposit control and
   tick the other plain item.
   **Observable:** the purse reads 1500 with 2000 left at the abbey; the
   second item leaves the character and is kept under the depositor's name.
4. **Taking it back.** Press Retrieve all on the abbey's row of the
   depositor's Equipment tab.
   **Observable:** the purse reads 3500 in one row, both items are back, the
   abbey holds nothing of the depositor's, and the row (still pinned) reads
   empty and offers no Retrieve.
5. **What a relayed retrieval takes.** From the console,
   `acksExtras.lib.storage.retrieve(abbey, depositor, [{id}])` for each of the
   three stamped rows, then for the marked house row together with Relay
   Other's.
   **Observable:** the marked house row arrives; the unmarked one, Relay
   Other's and the mixed request each resolve `{ok: false, reason:
   "permission"}` with the ownership warning, and move nothing.
6. **A forged request.** `const {executeAsGM} = await
   import("/modules/acks-extras/scripts/lib/sockets.mjs")`, then
   `executeAsGM("libMoveGoods", {kind: "stash", sourceUuid: <Relay Other>,
   targetUuid: <abbey>, spec: [{id: <its item>}], requestUserId: null})`.
   **Observable:** `{ok: false, reason: "permission"}`, and the item still on
   Relay Other.
7. **Out of reach.** With the GM off the place's owners and the pin removed,
   `acksExtras.location.reach.depositReach(depositor, abbey)` reads
   `notYours` on both seats. Call `storage.stash(depositor, abbey, [{id:
   <coin>, quantity: 10}])` from the player's console.
   **Observable:** `{ok: false, reason: "outOfReach", why: "notYours"}`, the
   reach refusal as a warning on the Player seat naming the character and the
   place, the purse unchanged, nothing on the GM's seat.

**Teardown.** `api.sweepTracked()`, which takes the abbey's rows with the
abbey.

## A mount bound by a drop

Covers `mount.mjs` `registerMountDrop` and `ride`, and the character sheet's
Mount line. Made from the PLAYER seat on this module's character sheet.

**Fixtures (as GM, each id recorded with `api.track`):**
- "Mount Rider", a `character` the Player seat owns, carrying one plain
  `item` ("Mount Rope", `weight6` 6).
- "Mount Horse", a `acks-extras.animal` the Player seat owns, with
  `system.animal.mountable: true` and a load of your own invention under
  `flags["acks-extras"].extras.load.normal`.
- "Mount Beast", a `monster` the Player seat owns.

**Drive mechanics.** A drop is a `DragEvent("drop", {bubbles: true,
cancelable: true, dataTransfer})` whose `DataTransfer` carries the drag
payload as `text/plain` JSON (`{type: "Actor", uuid}` or `{type: "Item",
uuid}`), dispatched on the target sheet's `.window-content`, or on the element
a step names. An animal left at the schema's `mountable: false` is still
mounted and raises the not-marked-mountable warning beside the notice.

1. **On foot.** Open Mount Rider on the Equipment tab.
   **Observable:** the Mount rule with its on-foot hint and no row.
2. **The drop.** Drop Mount Horse on the rider's sheet.
   **Observable:** one notice naming both; `lib.mount.mountOf(rider)` is the
   horse and `riderOf(horse)` the rider; the rider's `henchmenList` is
   unchanged; the Mount row names the horse, reads what it bears against what
   it can, and carries Dismount and Open.
3. **Kit to the mount.** Drop Mount Rope from the rider onto the horse's
   sheet.
   **Observable:** one rope, on the horse; the rider's
   `system.encumbrance.value6` falls by 6; the horse's load is unchanged,
   because it bears the rider's kit either way.
4. **Kit back.** Drop the rope from the horse onto the rider's sheet.
   **Observable:** one rope, on the rider, and the Mount row reads the same
   figure `lib.capacity.loadStone(horse)` does.
5. **The line follows the mount.** As GM, create a heavy `item` on the horse.
   **Observable:** the row on the Player seat reads the new load without the
   sheet being touched.
6. **Dismount.** Press the row's Dismount.
   **Observable:** `mountOf(rider)` is null and the hint is back. Drop the
   rope on the horse again: the rider keeps theirs and the horse gains one,
   the system's own copy.
7. **A monster.** Drop Mount Beast on the Mount line (`[data-mount-drop]`).
   **Observable:** the notice, and the row naming the beast with no "of"
   figure, its load being unstated. The row's name opens the beast's sheet.

**Teardown.** `api.sweepTracked()`. Deleting a mount clears its rider's
binding.

## An unlinked token in the carry

Covers `attachment.mjs` `attachedTo` and its index for unlinked tokens, and
through them `mount.riderOf`, a vehicle's passengers and draft, and the mounted
overlay's damage prompt. Read from the Gamemaster, Assistant Gamemaster and
Player seats, joined from one capture script.

**Fixtures (as GM, each recorded with `api.create`):** a scene created with
`active: false, navigation: false`; three `monster`s with
`prototypeToken.actorLink: false` ("Cavalier", "Goblin", "Ox"); two
`acks-extras.animal`s ("Steed", "Steed2") with hit points set; a `character`
"Hero" owned by the Player seat; an `acks-extras.vehicle` "Wagon". Turn on
"Overlay: mounted saves" and put it back after.

**Drive mechanics.**
- Place tokens as the mounted overlay's drive notes say
  (docs/equipment/TESTING.md). Tokens embedded in the fixture scene go with
  it, so only the scene is tracked. A bound token "pasted" is that placement
  with `delta.flags["acks-extras"].attachedTo` written into the `toObject()`
  data before `createEmbeddedDocuments`.
- Read a token's own binding from `tokenDoc._source.delta.flags`, which is
  what the index reads. `token.actor.getFlag` also answers a flag the token
  only inherits.
- `tokenDoc.update({delta})` and `tokenDoc.update({actorLink: true})` raise
  `updateToken`, and no `updateActor`, on the seat that makes them (measured
  on the Gamemaster seat). `token.actor.update` and `token.delta.update` raise
  `updateActor`.
- Count the damage prompts as the mounted overlay's drive notes say.

1. **A token rides a world mount.** `mountActor(cavalierToken.actor, steed)`.
   **Observable:** the token's delta holds `{uuid: steed.uuid, role:
   "rider"}`; `riderOf(steed)` is `<token uuid>.Actor.<cavalier id>` on all
   three seats; `lib.capacity.loadStone(steed)` rises from 0; the steed's
   sheet names the cavalier.
2. **Its damage prompts the token's rider.** Lower the steed's hit points from
   the Gamemaster and the Assistant Gamemaster seats.
   **Observable:** one prompt per fall, naming the cavalier.
3. **A new rider unseats it.** `mountActor(hero, steed)`, then the token again.
   **Observable:** the token's delta binding is gone and `riderOf(steed)` is
   the hero on all three seats; mounted again, the hero rides nothing.
4. **A paste.** Place a second cavalier token already bound to Steed2.
   **Observable:** `riderOf(steed2)` is the new token's actor on all three
   seats with no reload, and Steed2's fall from the Assistant Gamemaster seat
   prompts once.
5. **Through the token document.** Place a goblin token and give it the
   binding with `tokenDoc.update({delta: {flags: …}})`, as a passenger of the
   wagon.
   **Observable:** `attachedTo(wagon, "passenger")` lists it on all three seats.
6. **Two copies board.** Place a second goblin token and `attach` it as a
   passenger.
   **Observable:** two distinct uuids, neither the goblin's world uuid.
7. **A world actor counts once.** Attach Ox as draft, then place two Ox tokens.
   **Observable:** `attachedTo(wagon, "draft")` is `[ox.uuid]`, once.
8. **Linked since.** `tokenDoc.update({actorLink: true})` on the second goblin.
   **Observable:** one passenger left, the first goblin token.
9. **The rider's token deleted.** Delete the Steed2 rider's token.
   **Observable:** `riderOf(steed2)` is null on all three seats, and its fall
   prompts nobody.
10. **The mount deleted.** Delete Steed.
    **Observable:** the cavalier token's delta binding is gone, and its
    `mountOf` is null.

**Teardown.** Put the overlay setting back, then `api.sweepTracked()`. Steed
reads as `missing`, deleted by step 10.

## A field an effect changes, on the system's sheets

Covers `patches/stored-inputs.mjs`. One GM seat; the helmet overlay need not
be on, since a hand-made effect on the same field is the same write path.

**Fixtures (each tracked):** a `character` holding an Active Effect that
adds −1 to `system.surprise.avoidsurprise`, and a weapon; a `monster`
holding the same effect.

**Drive mechanics.**
- The system's character sheet is minified. Find it with
  `Object.values(CONFIG.Actor.sheetClasses.character).find(s => s.id.startsWith("acks.") && s.cls.DEFAULT_OPTIONS?.classes?.includes("character-v2")).cls`
  and render `new Cls({document: actor})`.
- A real form submit is a value set on `input[name="system.hp.value"]` and a
  bubbling `change` event: the sheet submits the whole form on change.
- Read `actor._source.system.surprise.avoidsurprise` (stored) beside
  `actor.system.surprise.avoidsurprise` (in force).

1. **The input shows the stored value.** Open the system's character sheet.
   **Observable:** the Avoid Surprise input reads 0 and carries the
   `acks-extras-overridden` class, and its tooltip names −1.
2. **Equipment changes write nothing.** Unequip and re-equip the weapon three
   times with the sheet open.
   **Observable:** stored stays 0.
3. **A save of another field does not compound it.** Lower hit points twice
   from the sheet.
   **Observable:** stored stays 0 and in force stays −1. Without the patch,
   stored reads −1 and then −2.
4. **A deliberate edit lands as typed.** Set Avoid Surprise to 1.
   **Observable:** stored 1, in force 0, the tooltip names 0.
5. **Monster sheets.** Open the monster with each registered monster sheet.
   **Observable:** on the system's monster sheet and the module's full monster
   sheet, the input reads 0 and the tooltip names −1.
6. **The Follower Card.** Add a second effect to the character, +1 to
   `system.scores.str.value`, and open the card
   (`Object.values(CONFIG.Actor.sheetClasses.character).find(s => s.id === "acks-extras.FollowerCardSheet").cls`).
   Lower hit points twice from the card.
   **Observable:** the STR input reads the stored score with the
   `acks-extras-overridden` class and a tooltip naming the score in force, and
   the stored score is unchanged after both edits. Without the call, it rises by
   one per edit.

**Teardown.** Delete both actors by their tracked ids.

## A record the system stamped without renaming

Covers `patches/legacy-source.mjs`. One GM seat. Each step reloads the page,
so drive it from a pane or the driver, and poll `game.ready` after each reload.

**Drive mechanics.**
- The record as stored, before any client-side `migrateData`:
  `(await foundry.helpers.SocketInterface.dispatch("modifyDocument", {type: "Actor", action: "get", operation: {query: {_id}}})).result[0].system`.
  `actor._source` and `toObject()` are already migrated and cannot show it.
- A raw socket `create` (`action: "create"`, `operation: {data: [data]}`)
  stores `system` exactly as given. The requesting client does not add the
  actor to `game.actors` until a reload.

**Fixture (tracked by id):** a `character` created raw with the 14.0 fields:
`details.level` 2, `saves` with `paralysis` 13, `breath` 14 and `wand` 15,
and `thac0` `{value: 19, bba: 1, throw: 9, mod: {melee: 0, missile: 0}}`.
Mark it `flags.world.fixture`.

1. **The system's migration write.** Reload. Then send the update the
   system's runner sends: `raw = actor.toObject()`,
   `raw.system._schemaVersion = 5`, drop `items` and `effects`,
   `Actor.implementation.updateDocuments([{_id, ...raw}])`.
   **Observable:** `foundry.utils.diffObject(actor._source, raw)` is
   `{system: {_schemaVersion: 5}}`, and the raw record reads stamp 5 with
   `thac0.throw` 9, `saves.breath` 14 and no `attack` or `blast`.
2. **The next load.** Reload.
   **Observable:** the actor reads attack 9, Blast 14, Implements 15 and
   Paralysis 13, and the raw record is unchanged. Without the wrap it reads
   10, 15 and 16.
3. **A record on the new fields.** Read any other character.
   **Observable:** its figures are its own. In-page,
   `new Actor.implementation({name, type: "monster", system: {_schemaVersion: 5, attack: {throw: 6}, saves: {blast: {value: 9}}}})`
   keeps 6 and 9, and the same build with `thac0.throw` 7 and no `attack`
   reads 7.

**Teardown.** Delete the character by its tracked id.

## A group body moved between scenes

Covers the roster's `deleteToken` hook (GROUPS.md, "A deleted body, and a
moved one") and `replacementToken`. Driven by a script over the capture
driver, from the Gamemaster and from the Assistant Gamemaster, each on its
own port; no walk in `tools/live` covers it.

**Fixtures**, each `api.create()`d or `api.track()`ed:
- Scenes A and B with a departure Region on A that teleports to an arrival on
  B: docs/formation/TESTING.md, "A teleport between scenes", lists the shapes.
- A `monster` source with `system.hp.hd` set, and an `acks-extras.group`
  actor. `groups.addStack(group, source, {count: 3})`, then
  `groups.deploy(group, A, {stackKey, count: 2, x, y})` away from the
  departure. Track each token it returns, and the stack's base actor
  (`group.system.stackOf(key).template.uuid`) when it is not the source.
- The second body's actor at 0 HP: `token.actor.update({"system.hp.value": 0})`.

**Drive mechanics.**
- A seat other than the one that deployed hears the tokens over the socket.
  Before it moves one, wait until `fromUuidSync(uuid)` resolves on that seat.
- The roster is `group.system.toObject().stacks[].roster`, each record's
  `state` and `tokenUuid`, beside the stack's `size.current`.

1. **A moved body stays deployed.** From the seat under test, move the first
   body into the departure with `tokenDoc.update({x, y})`. Poll B for a token
   whose `flags.acks-extras.member` is the body's member key and
   `api.track()` it.
   **Observable:** the record is `deployed` and its `tokenUuid` is the
   arrival's. `size.current` is 3.
2. **A fallen body moved is not a casualty.** Move the second body the same
   way.
   **Observable:** as step 1, and `size.current` is still 3.
3. **A recall gathers them from where they stand.** `groups.recall(group)`
   with no scene.
   **Observable:** it returns `recalled: 2` and `casualties: 1`, and B holds
   no token flagged for the group. The fallen body arrived at 0 ("A token
   created again under its own id", step 1), so its record reads `dead` and
   `size.current` is 2. The other reads `materialized`.
- **To see the mechanism:** an observer `deleteToken` hook on the primary GM
  reads `options.replacements[oldId]` as the arrival's uuid, and
  `fromUuidSync` of it resolves inside the hook. Unfixed, step 1 left the
  record `materialized` with an empty `tokenUuid`, and step 2 recorded the
  body `dead` and the stack at 2.

**Teardown.** `api.sweepTracked()`. The originals on A, and the arrivals the
recall deleted, sweep as missing.

## The band in the header, and the marker test

`header-band.mjs` is walked by its first user's recipe,
`docs/domains/TESTING.md`: step 13 reads one band, in the window header,
after every re-render, and step 11 reads it on a player's seat, whose header
the GM's controls do not crowd. `isMarkerActor` and `sceneOccupants` over a
domain's, an organisation's and a place's tokens are step 18 there, and are
pinned offline in `tools/test-poi.mjs`.

Formation reads the same test, and no driver walks it yet. On a scene, put a
character's token and a domain's token, select both, and press the
character's token HUD "add to party". *Observable:* the party gains the
character alone. Open the domain token's HUD. *Observable:* it has no
form-up press. Track the party the press made from `getFormations()`, read
back after it, and `api.sweepTracked()`.

## A group stack's count holds until its button reads it

Fixtures: a disposable group with two stacks (`groups.addStack(group, source,
{count})` twice, from disposable sources). Open its sheet and arm
`updateActor` and `renderGroupSheet` counters.

1. Type a different count in each stack's row, with a `change` on each.
   *Observable:* no write and no render.
2. Change the second stack's current headcount.
   *Observable:* one write and a redraw, and each row still shows its own
   count.
3. Press Record casualties on the first stack.
   *Observable:* its headcount drops by exactly that row's count, and the
   second stack's is unchanged.

Teardown: delete the group and its sources by id.

## Teardown

Delete every fixture actor and the items the storage and money steps created.
Delete the lined compendium with `deleteCompendium()` and confirm
`libraryItems()` returns to its pre-fixture count.
Confirm `storedItems(location)` is empty before the location goes. The
initiative step also leaves a combat, a scene with tokens, and the chat messages
both settings produced — delete all three, and issue the scene delete WITHOUT
awaiting it (awaiting a viewed scene's deletion hangs the headless driver).

The sidebar step leaves a throwaway compendium and its folder: delete the pack
with `deleteCompendium()`, then run the restore once more to sweep the shelf.
The pre-restore shape you built is undone by the restore itself — that is the
step, not the cleanup.
