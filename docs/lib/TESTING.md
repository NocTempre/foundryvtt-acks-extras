# Lib — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

`lib` is the shared surface every other feature reads, so a break here shows up
as ten features breaking. Walk this recipe before the others when several
report the same symptom.

## Fixtures

- Disposable `acks-extras.animal`, `acks-extras.group` and
  `acks-extras.template` actors.
- A disposable `acks-extras.location` actor (a storage provider).
- A disposable `character` and a `monster` to put inside them.

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
- Mint coin with `money.creditCoin(holder, [{name, cv, count}])` — an ARRAY.
  A bare object is not iterable and throws `credits is not iterable`.
- Hand-creating a `money` item instead is not equivalent: `coinSlots` reads
  `system.coppervalue`, which `creditCoin` sets and a hand-made item does not.
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
   `unregisterTable(id, source)`.
   *Observable:* in-band rows resolve, out-of-band returns null, and the
   deregistered table is gone from `hasDoc`.
7. Attack patch: with the `attackRollPatch` setting on, roll an attack.
   *Observable:* the patched path runs; turn the setting off and the system's
   own path returns. An inert setting is a bug.
   Set the chat's roll mode to *Private GM Roll* and roll again.
   *Observable:* the dialog's mode select opens on that mode, not on *Public*,
   and pressing Roll without touching it posts a whispered card. Back on
   *Public*, with Dice So Nice active, roll from the GM seat while a player
   seat watches: *Observable:* the player's client animates the dice. Read
   what reached Dice So Nice with a wrapper on `game.dice3d.showForRoll` in the
   roller's page: its fourth argument is `null` for a public roll and the
   whisper's ids for a private one — an empty list there is nobody.
8. Vision and senses: with `manageVision` on, place a token of an actor with a
   declared lightless range.
   *Observable:* the token's vision matches `senses.sightRange`, and the
   "Migrate Token Vision" macro re-derives it for tokens already placed.
9. Follower card: open a plain `monster`.
   *Observable:* `FollowerCardSheet` renders as the compact card, and its
   **Full sheet** control (`data-action="fcOpenFull"`) opens `FullMonsterSheet`
   beside it.
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
- run it twice: the second run creates no folders and moves nothing.

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
