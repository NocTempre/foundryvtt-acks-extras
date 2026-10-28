# Character sheet — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

## Fixtures

- A disposable `character` actor. On it: a `weapon` named after a RAW weapon
  that can be held one- or two-handed (a sword), a second weapon that is
  thrown as well as swung (a dagger), a shield `armor` (`system.type`
  "shield"), a suit `armor`, an `item` "Torches (6)" with a quantity, an
  `item` "Backpack" annotated so it declares a capacity, an `item` "Rations"
  with a quantity, an `ability` carrying at least one throw, an `ability`
  carrying none, and a `money` stack. Set `system.hp` to a wounded value
  below the maximum. Grant the Adventuring proficiency with
  `grantAdventuring(actor, [])` (`classes/grants.mjs`), the call chargen and
  the level-up wizard make.
- A second disposable `character` to serve as a hireling (`retainer.enabled`
  with the first as manager, and its id on the first's `henchmenList`).
- Disposable ActiveEffects on the first: one with a status id from
  `CONDITION_SAVES` (e.g. `restrain`) and `duration: {value: 6, units:
  "rounds"}`; one change of each type the sheet reads, each `{key, type,
  value: "<n>"}` with no `mode` — `add` and `subtract` on `system.save.mod`,
  `override` on `system.saves.death.value`, `multiply` on
  `system.saves.spell.value`, `downgrade` on `system.saves.implements.value`;
  and one timer per remaining unit — turns, seconds, minutes, hours, days,
  months, years — one of them backdated with `start: {time:
  game.time.worldTime - 3600}` so part of its life has run.
- Optionally an imported class document bound through the picker, for the
  Class tab's preview and the band's threshold.
- For the party cell: a disposable scene, ACTIVATED, holding a token of the
  first actor, a token of the hireling, and a token of a disposable monster
  actor to bind as a summon.

## Core drive mechanics (non-obvious, learned live)

- **The sheet is the default for characters**: a fresh actor opens on it.
  Reach the system's sheet through Sheet Config; both must open on the same
  fixture with no console error.
- **Fold state is on the USER**: `game.user.getFlag("acks-extras", "sheetFold")`
  keyed by actor id — check there, not on the actor.
- **Pins split by owner**: `actor.flags["acks-extras"].sheet.pins` holds
  actor-owned roll ids, timers (`timer:<effectId>`, `light:<id>`) and
  resources (`res:<key>`); an item's roll pins as the item's own
  `system.favorite`.
- **`_prepareContext()` is the probe**: construct the sheet and await it in
  page context to read the frame model and every panel without a screenshot.
  `acksExtras.characterSheet.snapshotFrame(actor)` and `buildFrameModel(snap)`
  give the rail decisions alone.
- **Rail menus are DOM, not applications**: the movement, grip and light cells
  append `.acks-extras-frame__menu` to their rail; a pointerdown
  outside closes it.
- **The system's save keys are `blast` and `implements`** (acks 14.1.0; the
  lib's `saveKindOf` still reads a `breath`/`wand` key off an older effect).
  Assert against `system.saves.blast`, and roll through
  `rollById(actor, "save:blast")`.
- **An effect's duration is `{value, units}` and its start is `start`**:
  `duration.rounds`/`turns`/`seconds` and `duration.combat` are Foundry 14
  shims that log once per session — create with `duration: {value, units}`,
  backdate with `start: {time}` instead of advancing world time. Outside
  combat Foundry restates a rounds or turns effect in seconds through
  `CONFIG.time.roundTime`/`turnTime` (`duration.units` reads `seconds` and
  `remaining` is in seconds; a zero length reads `Infinity` and *None*). The
  clock converts back, so assert the clock string (`6r`, `3t`), not the
  prepared fields.
- **A scene created in a world with no active scene is activated by core**
  and drawn at once. On a client whose canvas has never drawn a scene, a
  token or effect written before `canvasReady` throws inside core
  (`addChild`, `OBJECTS`: the render-flag queue is made by the first draw).
  Await the hook before placing anything on it:
  `await new Promise((r) => Hooks.once("canvasReady", r))`.
- **Starting a combat**: the system's `startCombat` opens the Surprise Matrix
  and never sets the round, and it reads every combatant's token
  disposition, so the combatant needs a token on the viewed scene
  (`Scene.create`, then a token from `actor.getTokenDocument()`,
  `Combat.create({scene})`, a combatant with `tokenId` and `sceneId`).
  `combat.nextRound()` is what starts it, and posts a *Round N has started*
  chat message each call — teardown deletes them. An effect created once the
  combat is started stamps `start.combat` and counts from its own round; one
  created before counts from the combatant's `roundJoined`. Core refreshes
  every registered effect's duration on round start, so the clock is current
  after `nextRound()` with no re-prepare; deleting the combat restates the
  effect from its FULL value in seconds.
- **A month is approximate**: Foundry converts months through the calendar's
  average month and counts the remainder up, so a fresh two-month effect
  answers `remaining 3`; the clock caps it at its total (`2mo`).
- **A template field named `mod` calls the system's Handlebars helper**, not
  the field, and prints `N/A`. The system registers `mod`, `add`, `mult`,
  `readonly`, `getWeight`, `stoneWeight` and a few more; a context key with
  any of those names is shadowed.
- **DocumentSheetV2 disables every form control on a read-only sheet**, so an
  observer's buttons — the fold, the tab strip, the rail menus — go dead
  unless re-enabled; the sheet re-enables its view-only actions after render.
  Assert with the Trusted Player seat, whose fold must write that seat's own
  user flag.
- **Page scripts longer than about twenty seconds time out in a hidden
  pane.** Drive the sheet in short steps (one tab per script) and read the
  results back between them; a long script's writes still land, which is how
  a fate point ended up awarded twice.
- **`rollSave` opens the system's roll dialog** unless the skip key is held;
  dispatch a `MouseEvent` carrying `game.settings.get("acks", "skip-dialog-key")`
  to roll straight to chat, or the script waits on a dialog forever.

## Steps

1. Open the fixture. *Observable:* the band sits in the window header with
   the name field and the XP bar; the art row shows five save cells and the
   six right-rail cells; the tab strip reads Rolls · Abilities · Equipment ·
   Stats · Class · Followers · Notes · Effects (Magic absent for a non-caster,
   Trade for a non-trader);
   no console error at open.
2. Rails. *Observable:* the heart shows the current HP with a partial fill;
   the AC cell cycles shield → without → unarmoured on click and the figure
   changes; the movement cell opens its menu and picking Combat changes the
   figure; the grip cell reads both hands open with no weapon drawn, one
   clenched after Draw from its menu, both joined after the two-handed grip;
   the light cell reads the dark at 0′, and a torch readied and lit reads the
   torch glyph with its reach and an amber fill.
3. Riders. *Observable:* the restrained effect rides on the Paralysis cell
   (image, clock, corner glyph, red tone); the save-modifier effects colour
   every save cell with the net signed number — the subtraction lowers it,
   the override reads as its difference from the source, the downgrade as
   help, the multiply as harm in warn tone; a save cell with both a rider
   and a modifier is split. Clicking a save cell makes the system's save
   roll (a chat card).
4. Rolls tab. *Observable:* every group lists; the five adventuring throws
   appear once, as `adv:*` rows under Adventuring, and no `abl:` row names
   the Adventuring item; the sword shows melee and
   two-handed rows and the dagger a thrown row; clicking a row makes the roll
   through core's pipeline (a chat card, the module's attack card format);
   the pin on a save row writes the actor flag, the pin on a weapon row flips
   the item's favourite. A crossbow's missile row, clicked and then starred
   and fired from the fold's pin bar: *Observable:* both post a MISSILE attack
   whose terms carry Dexterity and no Strength. The pin stores the row id
   `wpn:<itemId>:atk:missile`, and a reader that keeps one segment after the
   item id rolls every weapon row as melee.
   The throwless ability: *Observable:* it is a row under *Post to chat*,
   ending in an eye, and no ability with a throw is in that group. Click it:
   the system's item card posts. Pin it: the item's `system.favorite` is
   true, and the fold's pin bar shows its chip with the eye, which posts the
   card too. Unpin it: the favourite clears and the row stays. Click the
   ability row with a throw: the roll dialog opens (abilities TESTING step
   15); hold the system's skip key and it does not.
5. Equipment tab. *Observable:* worn gear sits at its slot, the backpack shows
   a capacity bar and contents, the coin stack lists under Coin & valuables;
   drag the sword onto the Main hand slot — it is drawn (`system.equipped`
   true) — and back onto the Carried column — sheathed; drag the rations onto
   the backpack — stored (`containedIn` set) and its take-out control appears.
   Annotate, split and the container lock cycle each write. Dividing a
   stack and joining two rows by a drop are walked in docs/lib/TESTING.md,
   "Coin: one stack, moved and never copied", step 3; the coin row there
   reads its count, its worth and its weight. The **Purse** rule under the
   carried rows, with its two selects and the gather control, is step 12 of
   the same recipe, and the world's reach note step 17.
   The sword drawn alone in the two-handed grip (from the grip cell's menu,
   or by itself with the two-handed style trained) lists as **one row
   spanning Main hand · Off hand** (`.is-span`, both labels behind one
   bracket), and the two hand slots return, separate, when it is sheathed or
   the shield is drawn beside it. A bow drawn lists as the same spanning row
   with no grip control, so no empty off hand is offered beside it; drop the
   readied torch on the row and the hand overflow names both while the torch
   comes back off. Drop the torch STACK (the `item`) on a hand place:
   *Observable:* a `weapon` "Torch" appears drawn in the main hand, the stack
   reads one fewer, and the hands badge reads 1 / 2; the same stack dropped on
   the belt is refused with a notice naming the place. Two one-hand weapons
   (two daggers): draw both by their row controls — *Observable:* the first
   lists under Main hand and the second under Off hand, 1 / 1 each, the style
   reads Dual Wield; drag the second onto Main hand — it moves there
   (`flags.acks-extras.hand` = `main`) and the first shifts to Off hand; drag
   it onto Off hand — back, `off`; sheathe it — the flag is gone. Add the character to a
   party formation as its mapper: *Observable:* the badge reads 2 / 2 with
   "2 held for mapping" visible beside it, not in a tooltip, and the torch
   dropped on a hand comes back off with the same clause in the notice.
   Wear the harness (created from the system's
   compendium and annotated, so its Construction tab shows the figure under
   **Secures**) with three small items loose: the Load bar shows a **dashed
   phantom** (`<s>`) running on from the fill, the header reads the carried
   figure after the burden, and the bar's tooltip names the weight forgiven;
   take the harness off and the phantom shrinks to what the worn clothing
   weighs, and with no clothing worn it goes. A belt pouch worn beside the
   harness and a scabbard shows no count on the belt. A helm and a coif at
   the head read *1 / 1* with no tint and both counts in the badge's tooltip;
   a second helm tints the place (`is-full`); declaring the coif magic on its
   Details fold keeps *1 / 1*, and a second magic piece at the head
   tints.
6. Stats tab. *Observable:* an attribute edit submits and the modifier
   follows; the weapon buckets open to weapons; the hit dice roll asks first
   and writes a new maximum; the throw fields submit.
6a. Morale, on three characters: the hireling, a disposable `character` no
   player owns (default ownership NONE, no player OWNER), and one the Player
   seat owns. Read `actor.hasPlayerOwner` on each first — the predicate keys
   on it. *Observable:* the first two show a Morale field at the foot of the
   Throws column and a Morale row on Rolls (the hireling's in the Retainer
   group beside Loyalty, the NPC's in a Morale group); the player's shows
   neither. Type a value into the NPC's field: `system.details.morale` holds
   it, and pressing its Rolls row posts a morale throw carrying it. The
   hireling's Retainer block on Stats holds Wage and Loyalty only.
7. Class tab. *Observable:* with a bound class the preview lists the next
   row's deltas; raising XP to the threshold turns the band and the tab gold
   and shows the Level up button, which opens the classes wizard.
   Back on the band, press the XP bar and drag: the WINDOW moves, as from
   the title bar; `system.details.xp.value` is unchanged and no tab opens.
   The class glyph before the name still opens the Class tab.
7a. Service tab, on the hireling fixture. *Observable:* the strip holds
   Service between Trade and Followers and the band's chip names the
   employer; the employer's own sheet holds no Service tab. The panel's
   contents, the owed-calamity badge and dot, and the seat gates are walked
   in docs/henchmen/TESTING.md, step 1a; here, press the Loyalty row: the
   loyalty throw posts, as from Rolls; star it: the folded bar carries it.
8. Followers tab. *Observable:* the hireling's Follower Card renders with the
   four controls; Roster opens the roster app. With a waged hireling and
   nothing due the rule reads what the payroll costs a month and the days
   until the next wage falls due, and draws no Pay wages chip; with a month
   due it reads the wages due and draws the chip,
   whose press is walked in docs/henchmen/TESTING.md, steps 5b and 5c.
9. Effects tab. *Observable:* every timer lists under Timers with its unit
   mark (`6r`, `3t`, `30m`, `1h`, `3d`, `2mo`, `1y`; seconds climb, `90s` to
   `2m`, `5400s` to `2h`) and a bar in tone, the backdated one part-spent;
   the restrained one also lists under Riding on a save; each modifier line
   carries a glyph for its type (`+2`, `−1`, `=10`, `×2`, `≤12`); starring
   one puts a chip on the folded bar; fate award and spend write. A timer
   effect's row and a modifier's row each start a drag carrying the effect's
   uuid (`{type: "ActiveEffect", uuid}`); a light's row starts none.
10. Fold. *Observable:* the chevron narrows the window to the card — band,
    portrait, rails and the pin bar with the starred rolls and timers — and
    the user flag records it; unfold restores the tabs; the state survives a
    close and reopen.
11. Player seat. Join as a player owning the fixture: everything above except
    the Judge's source cell; as an observer of it: no tools rail, no controls,
    the fold still works.
12. The system's sheet. Switch the fixture to it through Sheet Config.
    *Observable:* the wear buckets, the class picker control, the Storage tab
    and the roster header button all still appear there.
13. The system's windows. Click Generate Scores and Modifiers on Stats, Tweaks
    on the tools rail, and the HP cell with hit points at zero. *Observable:*
    each opens the system's own window — the Scores Generator, Attribute
    Bonuses, Tweaks, Mortal Wounds — titled for the character; a "could not be
    reached" notice means the bridge is reading the wrong half of the
    system's sheet class chain (the four live on two classes).
14. The party cell, on the disposable scene. *Observable:* with the hireling's
    token on the scene the cell reads `1`; control the monster's token and
    pick *Bind* from the cell's menu — its actor gains `summonedBy` and the
    cell reads `1*`; set `pendingCalamity` on the hireling's henchmen record
    and the cell turns red; picking the hireling from the menu selects its
    token; *Release* clears the flag and the asterisk; deleting the hireling's
    token drops the figure to `0`. With a formation whose party token is on
    the scene the cell shows the marching-order glyph and its member count
    and opens the party sheet. Count renders with
    `Hooks.on("renderAcksCharacterSheet", …)`, then move the hireling's token
    a few squares (`{animate: false}`): *Observable:* the count does not
    move. Rename the token: it rises by one — a move touches nothing the cell
    reads, and a rename does.
15. The Mount line. Walked with the drop that fills it, from a player's seat:
    `docs/lib/TESTING.md`, "A mount bound by a drop".
16. The Notes tab, on a fixture whose notes and biography each hold eight
    paragraphs. *Observable:* on the Notes tab the prose's `clientHeight`
    equals its `scrollHeight` (710 px at base 14) and its `max-height` is
    `none`, the frame's scroller carrying the length; the art row's prose
    beside the portrait stays a 130 px snippet that scrolls in place.

## Type scale (the `fontScale` knob)

**Fixture.** One populated `character` — the sheet has to hold weapons, gear,
an ability, an effect and a follower before a scale change can be judged.

**Drive.** The opening width is computed at CONSTRUCTION (`atTypeScale`), so a
setting change does not resize an open window: close the sheet, set the
setting, `actor._sheet = null`, and render again. Read the result off computed
style rather than a screenshot — `--acks-extras-k`, and the font-size of the
root, `.window-header` and `.window-content` (three separate answers; core
pins its own size on the latter two).

**Steps and observables.** At each of base 12, 14 and 18:

- Width is `900 × base/14` (771 / 900 / 1157) and the folded card is
  `400 × base/14` (343 / 400 / 514). Fold and unfold and confirm both.
- `--acks-extras-cell` computes `32 × base/14`, and the root, header and
  content font-sizes all equal the base.
- The title band fits its header: the band's bottom sits *above* the header's,
  not below it. It was clipped by 3.5px before the header's `flex: 0 0 auto`.
- Walk all eight tabs. Diff `scrollHeight - clientHeight` and
  `scrollWidth - clientWidth` per element against the same reading at base 14:
  the only elements that may grow are `__scroll` (the designed scroller) and
  the visually-hidden `.acks-sr-only` / `.window-title` boxes, whose text
  overflows a 1x1 clip either way. Anything else growing is a real clip.
- The place column collapses when the DRAWING outgrows the frame, not at a
  fixed pixel count: step `setPosition({width})` down and watch
  `__where-label`'s display. It goes `none` below 840px at base 14 and below
  1080px at base 18 — the same 60em either way. A collapse at the same px
  width at both bases means the `@container` thresholds went back to px.

**Teardown.** Delete the actor by id and set `fontScale` back to 14 — it is a
client setting, so a raised value follows you into the next session's test.

## Teardown

Delete both actors, the monster, the scene, any combat and the chat messages
the rounds and the save roll posted, and confirm `game.actors`,
`game.scenes`, `game.combats` and `game.messages` no longer hold them; clear
the user's `sheetFold` flag of the fixture id
(`update({flags: {"acks-extras": {sheetFold: {[id]: new foundry.data.operators.ForcedDeletion()}}}})`),
and unset the flag itself when that leaves it empty and the run created it.

## Training on Stats

**Fixtures.** A character actor you create; one class whose training effect
writes weapons by size and missile (`missile:all,melee:tiny,melee:small,
melee:medium`), armour `medium`, styles `weaponShield`; one imported *Martial
Training* proficiency. Apply the class to the character.

**Drive mechanics.** The Training block's model is `panels.stats.training`
from `_prepareContext()` — `groups[].members[]` carry `on`, `edited`,
`locked`, `others`, `token`. A scripted edit is `toggleTraining(actor,
"weapons", token, {create: true})` from `scripts/classes/training.mjs`, or
the real pill click with the pencil armed. The view is
`game.user.getFlag("acks-extras", "trainingView")`. Read the grant back from
the effect carrying the `fromClass` flag: its `changes`.

1. Open Stats. *Observable:* Fighting styles as five pills; Weapons under
   seven category headers each captioned *narrow*, every weapon of the table
   exactly once across them, no *Elsewhere* group; Armour as five rungs lit
   to Medium plus a Shield pill; the note names the class. The pills do not
   answer the mouse.
2. Press the view button twice. *Observable:* *By size* — Tiny/Small/Medium
   melee headers lit (*broad*), Large dark, Missile lit, the staff sling under
   Medium; *No grouping* — one *Any weapon* header (*unrestricted*), every
   weapon inline. A third press returns to *By category*. Reopen the sheet:
   the last view stands (user flag).
3. Press Edit. *Observable:* the chip goes gold, the editing hint shows, the
   pills become buttons. Click *Lance* (a large weapon whose category the
   class does not complete — a weapon that completes one, such as the
   two-handed sword, collapses into its category token instead, which is the
   canonical form and not a fault). *Observable:* the grant gains `lance`
   after its four clauses, the pill lights and wears a dot, *Reset to class*
   appears. Click the *Large melee* header's toggle (size view). *Observable:*
   the grant is rewritten as `missile:all,melee:tiny,melee:small,melee:medium,
   melee:large`, the lance's dot is now on every large weapon. Click *Reset to
   class*. *Observable:* the printed four clauses return, no dots, no Reset.
4. Armour, still editing. Click *Light*. *Observable:* `armourProficiency`
   is `light`, Medium goes dark and wears a dot. Click *Shield*.
   *Observable:* `styleProficient` loses `weaponShield` (the fixture grants
   it); the Shield and the Weapon & Shield style pills go dark, each with a
   dot. Click *Shield* again: both light, the dots clear. Reset.
5. Add the Martial Training item with a swords pick. *Observable:* sword
   pills the class does not grant light; in edit mode each is disabled with
   the item's name in its tooltip; the class's own sword pills still toggle.
6. Effects tab. *Observable:* no Class modifiers section; the training row
   under *Managed by the module* is locked and its control jumps to Stats.
   No training control opens core's Active Effect window.
7. Join as the Trusted Player seat: on a character it owns, the pencil
   works; on one it observes, the view button cycles and the pencil is
   replaced by *view only*.
8. A character with no class: Edit, click a style. *Observable:* an effect
   named *Training, by hand* appears, locked, and the note names it. Apply a
   class: the hand-made effect is replaced.

**Teardown.** Delete the character, the class and the proficiency you
created; clear `trainingView` from your user flags if you want the default
back.

## The official sheet (PDF)

**Fixtures.**
- Your own blank copy of the official fillable sheet, in both editions the
  publisher prints (colour and monochrome), and one printed or flattened
  sheet to be refused.
- A filled copy made from the blank by a scratch Node script: open the
  blank with the vendored `vendor/pdfjs/pdf.mjs` and call
  `fillForm(doc, values)` (`pdf/form.mjs`) with invented values. Read it back
  with `readForm` and compare before using it: a value that does not
  survive the round trip is a fixture fault, not a feature fault. Fill at
  least: a class the world holds, at a level; scores; saves that disagree
  with the class; a general proficiency twice (rank two) and one the world
  lacks; a feature and a language the world lacks; both coin boxes, one as a
  running tally (`40 - 10 = 30`); a backpack on the back, three lines in the
  backpack (one with a count), a sword in the main hand, a shield in the off
  hand, armour, a dagger at the belt, one hidden item; two weapon rows, one
  the world lacks, one with an initiative bonus; a spell the world holds and
  a ritual it lacks; ticks; one henchman slot naming no roster member; and
  the domain page: a name no world domain carries, one region tick, two
  structures (one written with a count, "Tower ×2"), two hex rows with
  revenue, peasant and urban families, a land line whose families are the
  peasant count, a line whose families are both counts together, one whose
  families match neither, an other-revenue row, tribute paid, a vassal row,
  and the location.
- The PDFs in a Data folder of the run's own, so the page can fetch them.
- For the player pass, a `character` the Player seat owns
  (`api.create("Actor", {…, ownership: {[playerId]: 3}})`).
- No sheet on the shelf: no journal stamped `flags.acks-extras.shelf.book`
  `"sheet"`, and no `acks-extras-books/sheet.pdf` under the Data directory.
  Staging writes that file and Foundry offers no delete, so the run removes it
  from disk by that path at teardown.
- A GM-level seat no other client holds. Joining a seat another session is
  driving puts two clients behind one user.

**Drive mechanics.**
- **A file input takes a real `File`**: fetch the PDF, wrap it in a `File`,
  add it to a `DataTransfer`, assign `input.files = dt.files` and dispatch
  `change` (bubbling). The window reads the file on `change`.
- **`foundry.utils` is a frozen module namespace.** Assigning
  `foundry.utils.saveDataToFile` fails silently in page code, and the real
  save then drops the PDF in the browser profile's Downloads folder. Catch
  the download where core clicks it instead: give
  `HTMLAnchorElement.prototype` its own `dispatchEvent` that keeps a click on
  an anchor whose `download` ends `.pdf` (fetch its `href` at once — core
  revokes it after 100 ms) and passes every other event through; delete the
  override after the export. Upload the bytes to the run's Data folder with
  `FilePicker.implementation.upload` and read them back in Node with
  `readForm`.
- **The window menu entry** is reachable as
  `sheet._headerControlContextEntries()`. The real gesture is the sheet's
  `toggleControls` button and then the context item.
- The window's id is `acks-extras-sheetpdf-<actor id>`, or `-new` for a new
  character. The new-character window keeps that id after an import, and a
  new-character window opened while it is still open is `-new-2`.
- **Arm a console and toast recorder before the import.** An import that
  lands and then throws shows a complete report; only the error toast and
  the missing done notice tell the two apart.
- The import and export take seconds on the colour form. Poll for the
  report or the captured download with a bound of minutes, not a fixed
  sleep.
- **The importer's api arrives after `ready`** (5–17 s on this world): poll
  `acksExtras.importer` before reading `bookOpen("sheet")`. The shelf opens
  one book at a time, so the sheet waits behind every shelved book the seat
  may read: on a GM seat the whole shelf, on a Player seat only what the
  Judge shared with it.
- **Your Books' row controls are file-system pickers** on localhost and
  cannot be scripted. The shelf band's `input[data-shelf-bulk]` (GM) and the
  local band's `input[data-bulk]` take Files as above and match the sheet by
  its filename. A refusal is written on the row (`[data-status="sheet"]`),
  not raised as a toast.
- The window's state is `await app._prepareContext({})`: `sheetOpen`,
  `cannotExport`, `sheetNote`.
- **The domain page needs the domain sub-type registered**:
  `game.documentTypes.Actor.includes("acks-extras.domain")`. A world launched
  before the type arrived keeps the page in the notes, and the preview says
  so; relaunch it first (ask whoever is seated).
- A domain the import makes is the report's link: `report.domain.uuid` on the
  window's `_prepareContext`. Track it by that uuid the moment the import
  resolves.

**Steps** (an Assistant GM seat unless named).
1. Press *Import sheet* in the Actors directory. *Observable:* the window
   opens on a new character; there is no Export section yet.
2. Pick the flattened PDF. *Observable:* the error names the file and 0% of
   the fields; Import stays disabled.
3. Pick the filled copy. *Observable:* the preview names the class and
   level, counts what the world holds per list, offers the henchmen box, and
   reads *A new domain:* with the page's name beside a ticked domain box.
   Tick the henchmen box and press Import.
4. Read the report and the character. *Observable:* the class is bound at
   the level; the class's saves and attack throw are checks with *Keep*; the
   unknown names are under *Not found*. The sword is in the main hand, the
   shield in the off hand, the armour on the body, and the backpack on the
   back holds its three lines with their counts. The dagger is carried, not
   drawn, and no AC check appears. The coin rows hold each box's count. The
   character's notes carry one block and no domain table. The henchman is
   created and on the roster. `recordedFields(actor)` (`pdf/export.mjs`)
   returns every filled box under its dotted key, and the flag's `unmatched`
   lists the four unknown names. One chat message lists what was added. The
   done notice names the character, and no error is raised; the preview now
   reads *Writes to* the character and counts the henchman on the roster.
4a. With that window open, press *Import sheet* again. *Observable:* a second
    window opens as `-new-2` beside the first, which keeps its report. The
    character's own *Official sheet (PDF)* brings the first forward.
4b. Open the domain from the report's Domain link. *Observable:* the
    domain's ruler is the character; the region is its classification; the
    counted structure has that count and its capacity per unit; each hex row
    carries its number, land value and families; one unnamed settlement
    holds the urban families; the land line is a peasant rate, the
    both-counts line a rate on both sides, and the unmatched line is unset;
    the other revenue, tribute paid and the vassal row are there. Its notes
    carry one block with the location and the revenue by hex. The report's
    checks list, under the domain's name, the unmatched line (not written)
    and tribute paid with no liege.
5. Pick the same file again and import. *Observable:* nothing is added, no
   check says an item is not worn there, the notes still hold one block,
   and `importedAt` moved. The report reads the domain *updated*; it gains no
   row and its notes still hold one block.
5a. Untick the domain box and import again. *Observable:* the report says
    the page was kept in the character's notes, which now carry the domain
    tables; the domain is unchanged, and the record still names it.
6. Delete one packed item, add an Active Effect raising STR by 1, and import
   again. *Observable:* the deleted item lands again in the backpack; STR is
   a check carrying the effect mark and no Keep, and the stored STR is
   unchanged.
7. Press *Keep* on a save check. *Observable:* the row reads *Kept* and the
   stored save holds the sheet's value.
8. With no sheet open anywhere, read the Export section. *Observable:*
   Export is disabled and the note says the sheet is not open on this seat.
   *Your Books* opens the Books window, whose sheet row says connecting lets
   the official-sheet window export into it.
9. Give the shelf band's input the printed copy. *Observable:* the row says
   the file is not the fillable sheet (0% of its fields); no journal and no
   file on the server.
10. Give it the monochrome blank. *Observable:* a journal named for the sheet
    in *Your Books*, ownership default Observer, its page at
    `acks-extras-books/sheet.pdf` (the file's size equals the blank's); the
    book row reads open, from the server; the official-sheet window
    re-rendered with Export enabled.
11. Press Export; capture the download. *Observable:* the note says it was
    written and counts the items listed under Backpack. Read back in Node,
    the file is the form. It carries the ticks, the weapon's initiative, the
    dagger at the belt, the hidden item under hidden, and the unknown
    proficiency, feature, language and ritual in their boxes. Its domain page
    is the domain's: the counted structure as "name ×count", the hex numbers
    with the record's revenue beside them, each written line as rate,
    families and total, the vassal, and the location from the record. Change
    a land value on the domain and export again: the page shows the new
    figure.
12. Shrink the window to about 320 px tall. *Observable:* the body scrolls,
    the footer's Import stays in view, and every input has a label.
13. As the Player seat: the owned character's window menu carries *Official
    sheet (PDF)*, and the Actors directory has no *Import sheet*. The sheet
    opens from the server at join. Import the filled copy. *Observable:*
    there is no henchmen box, and the henchman goes to the notes. The
    preview's domain row says the page is kept in the notes and there is no
    domain box; the domain is unchanged. Export works from the server's
    sheet, and its domain page is the one this import read.
14. As GM, set the sheet journal's default ownership to None, then join a
    fresh Player seat. *Observable:* the sheet is not open there and Export
    is disabled. Give the local band's input the colour blank. *Observable:*
    the window re-renders with Export enabled, and the export reads back as
    the form holding the character.

**Teardown.** Sweep by the run's ledger: the imported character, the
henchman it created, the domain it created, the player's character, the
sheet's shelf journal
(tracked by the id read back once it appears), and every chat message the
imports posted (found by speaker, tracked by id). Remove
`acks-extras-books/sheet.pdf` from the Data directory by that path. Delete
the run's Data folder; check the browser profile's Downloads folder for a
stray export.

## A field an effect changes

**Fixtures.** A disposable `character` with `system.ac.mod` and
`system.surprise.avoidsurprise` at 0, carrying one Active Effect that ADDs 1
to both paths (`ActiveEffect.create` on the actor with two `changes` rows,
mode `ADD`).

**Steps.**
1. Render the sheet and read the Stats tab's AC-modifier and Avoid Surprise
   inputs.
2. Edit an UNRELATED field — HP current — and let the sheet submit; repeat
   once more.
3. Read `actor._source.system.ac.mod` and `actor.system.ac.mod` after each
   submit.
4. Edit the AC-modifier input itself to 3 and submit.

**Observable.** Both inputs show 0 with the effect in force, wear the
`is-overridden` class, and their tooltip names 1. After step 2 the stored
value is still 0 and the prepared value still 1 — before the fix each submit
wrote the prepared value back as the base, so the pair read 1/2 then 2/3, the
climb the field report described. After step 4 the stored value is 3 and the
prepared value 4: the field still writes what was typed.

**Teardown.** Delete the character by its uuid; the effect goes with it.