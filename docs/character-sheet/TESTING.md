# Character sheet — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

## Fixtures

- A disposable `character` actor. On it: a `weapon` named after a RAW weapon
  that can be held one- or two-handed (a sword), a second weapon that is
  thrown as well as swung (a dagger), a shield `armor` (`system.type`
  "shield"), a suit `armor`, an `item` "Torches (6)" with a quantity, an
  `item` "Backpack" annotated so it declares a capacity, an `item` "Rations"
  with a quantity, an `ability` carrying at least one throw, and a `money`
  stack. Set `system.hp` to a wounded value below the maximum.
- A second disposable `character` to serve as a hireling (`retainer.enabled`
  with the first as manager, and its id on the first's `henchmenList`).
- A disposable ActiveEffect on the first with a status id from
  `CONDITION_SAVES` (e.g. `restrain`) and a duration in rounds; a second with
  a change to `system.save.mod`.
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
  append `.acks-extras-character-sheet__menu` to their rail; a pointerdown
  outside closes it.
- **The released system stores Blast as `breath`** (and carries a `wand` save
  the book folded into Implements). The sheet reads and writes through the
  lib's `BOOK_TO_RELEASED_SAVES`; assert against `system.saves.breath`, not
  `.blast`, and roll through `rollById(actor, "save:blast")`.
- **A rounds-or-turns effect reads in SECONDS outside combat**: Foundry's
  prepared duration restates it through the world's round length, so
  `effect.duration.units` is `seconds` and `remaining` is in seconds. The
  sheet's clock reads the SOURCE duration for the unit; assert the clock
  string (`6r`), not the prepared fields.
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
- **The RAW torch stack "Torches (6)" is not recognised by
  `equipmentClass`**, so the Ready control (the sheet's and the system
  sheet's alike) does nothing for it; a stack named "Torch" readies. An
  equipment-feature matching gap, not the sheet's.

## Steps

1. Open the fixture. *Observable:* the band sits in the window header with
   the name field and the XP bar; the art row shows five save cells and the
   six right-rail cells; the tab strip reads Rolls · Abilities · Equipment ·
   Stats · Class · Followers · Notes · Effects (Magic absent for a non-caster);
   no console error at open.
2. Rails. *Observable:* the heart shows the current HP with a partial fill;
   the AC cell cycles shield → without → unarmoured on click and the figure
   changes; the movement cell opens its menu and picking Combat changes the
   figure; the grip cell reads both hands open with no weapon drawn, one
   clenched after Draw from its menu, both joined after the two-handed grip;
   the light cell reads the dark at 0′, and a torch readied and lit reads the
   torch glyph with its reach and an amber fill.
3. Riders. *Observable:* the restrained effect rides on the Paralysis cell
   (image, clock, corner glyph, red tone); the save-modifier effect colours
   every save cell with the signed number; a save cell with both is split.
   Clicking a save cell makes the system's save roll (a chat card).
4. Rolls tab. *Observable:* every group lists; the sword shows melee and
   two-handed rows and the dagger a thrown row; clicking a row makes the roll
   through core's pipeline (a chat card, the module's attack card format);
   the pin on a save row writes the actor flag, the pin on a weapon row flips
   the item's favourite.
5. Equipment tab. *Observable:* worn gear sits at its slot, the backpack shows
   a capacity bar and contents, the coin stack lists under Coin & valuables;
   drag the sword onto the Main hand slot — it is drawn (`system.equipped`
   true) — and back onto the Carried column — sheathed; drag the rations onto
   the backpack — stored (`containedIn` set) and its take-out control appears.
   Annotate, split and the container lock cycle each write.
6. Stats tab. *Observable:* an attribute edit submits and the modifier
   follows; the weapon buckets open to weapons; the hit dice roll asks first
   and writes a new maximum; the throw fields submit.
7. Class tab. *Observable:* with a bound class the preview lists the next
   row's deltas; raising XP to the threshold turns the band and the tab gold
   and shows the Level up button, which opens the classes wizard.
   Back on the band, press the XP bar and drag: the WINDOW moves, as from
   the title bar; `system.details.xp.value` is unchanged and no tab opens.
   The class glyph before the name still opens the Class tab.
8. Followers tab. *Observable:* the hireling's Follower Card renders with the
   four controls; Roster opens the roster app.
9. Effects tab. *Observable:* both fixtures list under Timers with bars in
   tone; the restrained one also lists under Riding on a save; starring one
   puts a chip on the folded bar; fate award and spend write.
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
    and opens the party sheet.

## Teardown

Delete both actors, the monster and the scene and confirm `game.actors` and
`game.scenes` no longer hold them; clear the user's `sheetFold` flag of the
fixture id.

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