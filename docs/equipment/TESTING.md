# Equipment — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

## Fixtures

- A disposable `character` actor.
- On it: a `weapon` whose name matches a RAW weapon (e.g. "… Sword"), an
  `armor`, and a plain `item` to serve as a container.
- A disposable `acks-extras.variation` Item for the variation path.
- **Kept, found by marker** (`tools/live/equipment.mjs` walks steps 2b–2e on
  it): `equipment/hands-probe`, a `character` carrying a "Long Bow"
  (missile only), a "Sword, Two-Handed", a "Dagger", a "Torches (6)" stack,
  a "Quill, writing" and a "Parchment". Each step brings it to shape first:
  every weapon sheathed with its hand flag cleared, any readied torch
  deleted and the stack back to six, the actor's own light flag cleared, and
  the actor out of every formation. The walk's party ("QA Hands Probe
  Party") is created and deleted by the run; the torch it readies is tracked
  and swept.

## Core drive mechanics (non-obvious, learned live)

- **The loadout effect is written by the primary GM window alone**
  (`enforce.mjs` `primaryResponder`), and a window still joining its seat's
  election answers false. A run that equips in its first seconds writes no
  effect and logs nothing: await lib's `primaryGMSettled()`
  (`scripts/lib/util.mjs`) before the first equip.
- **`annotateItem(item)` writes flags at the item's own root**, not under an
  `equipment` sub-object: read `item.flags["acks-extras"]` and expect
  `size`, `damageType`, `handy`, `thrown`, and a `gear` block with `slots`.
  Reading `getFlag(MODULE_ID, "equipment")` finds nothing and reads as a
  no-op.
- **Annotation is keyed on the item's NAME.** `weaponKey(item)` matches the
  name against the RAW weapon list; an item called "Test Weapon" annotates to
  nothing. Name the fixture after a real weapon.
- **`drawItem(item)` / `sheatheItem(item)` take the ITEM alone.** Passing
  `(actor, item)` sets `system.equipped` on the actor object and silently
  changes nothing.
- **`freeHands` and `handCost` answer different questions and both are
  right.** Drawing a one-hand medium sword leaves `handsFree: 0` while
  `handsCommitted: 1` and `handsSpare: 1` — the sword's `gear.slots` include
  `bothHands`, so both hands are ON it and one is releasable. Assert against
  `getLoadout(actor)`, which names all four numbers, rather than against
  `freeHands` alone.
- **A container must DECLARE that it holds gear** before `isContainer` is true
  and anything can be stored in it — a plain sack is not a container until its
  `gear.capacity` says so.
- **The container calls take the ACTOR first, and `contentsOf` takes an ID.**
  `canStore(actor, item, container)`, `storeIn(actor, item, container)`,
  `contentsOf(actor, containerId)`, `contentsWeight6(actor, containerId)`,
  `encumbranceDelta6(actor)`. Reading `contentsOf(container)` returns an empty
  list from a container that really does hold the item — a successful store
  then looks like a silent failure. The one exception is `takeOut(item)`,
  which takes the item alone: passed the actor first it finds no container
  on it and does nothing, silently.
- **`canPick` and `canBash` take the ACTOR, not the lock**: they ask whether
  the character has the ability, so they answer false for a GM probing a
  locked chest with nobody selected.
- **A shut lock blocks storing for everyone, the GM included** —
  `canStore` answers `{ok: false, reason: "locked"}`. That is deliberate: a
  lock that silently let the GM through would be decorative.
- **A fixture's string flag is an `add`, an `override` or a `custom`
  change.** All three grant (MODEL §3); a `multiply`, `upgrade` or
  `downgrade` on `flags.acks-extras.damageAttribute` is ignored, so Strength
  of Faith never fires and the damage roll looks unfixed. A boolean domain
  (`finesse`) fires on the key alone, whatever the type — which is why one
  half of a fixture can work while the other does not. Roll with
  `actor.makeAttackThrow({item: weapon, attackType: "melee", skipDialog: true})`
  and read the rows from the `acksLibPostAttackRoll` hook's outcome
  (`outcome.attackRoll`, `outcome.damageRoll`); the damage box renders only on
  a hit, so loop until one lands to read it on the card.
- **The shipped macros read the canvas selection**, not an actor argument.
  `macro.execute({actor})` runs without throwing and does nothing visible;
  place a token and control it first.

## Steps

1. `annotateItem(weapon)`.
   *Observable:* the flags above appear, matching the RAW profile for that
   weapon name; `classifyWeapon(weapon)` returns its key, damage, category and
   hand cost.
2. Draw and sheathe it.
   *Observable:* `system.equipped` flips both ways, and `getLoadout(actor)`
   moves `handsFree`/`handsCommitted`/`handsSpare` accordingly.
2b. Draw a bow (a `weapon` named "Long Bow", missile only) with nothing else
   in hand. *Observable:* `getLoadout(actor).weapons[0].wieldTwoHanded` is
   true and `handsUsed` is 2; `wearLocation` answers `bothHands`, so the
   character sheet lists it as the one row spanning both hands. Ready a torch
   and drop it on that row: *Observable:* the hand overflow is reported as
   3/2 naming both, and the torch comes back off — the off hand was never
   offered as empty.
2c. Ready from core's own stack: create "Torches (6)" from the system's
   equipment compendium and press its Ready control (the character sheet's
   or the system sheet's). *Observable:* a `weapon` named "Torch" appears,
   1d4, melee and thrown, `flags.acks-extras.light` true, and the stack
   reads one fewer. Press Ready on a plain `item` with "torch" nowhere in
   its name through the API (`prepareTorch(actor, item)`): *Observable:* a
   notice says it is not a torch stack, and nothing is created.
   `prepareTorch(actor, stack, {draw: true})` — what the stack's own Equip
   control and a drop on a hand place call: *Observable:* the Torch is
   created with `system.equipped` true and `getLoadout(actor).handsUsed` is
   1; with a bow already drawn the overflow notice names the torch and the
   torch comes back off, as for any weapon.
   A light burns in the hand that holds it: with the Torch in hand and a
   Dagger drawn (2 / 2), press the Torch row's Light control on the
   character sheet. *Observable:* the flame lights (a burning record with the
   actor's id, in the party's record when they are a member, else the actor's
   own `lights` flag), the badge still reads 2 / 2 with no clause, and
   `getLoadout(actor).lightsInHand[0].lit` is true. Sheathe the Torch by its
   row control: *Observable:* the badge reads 2 / 2 with "1 held for light"
   and the Torch row sits under Carried, still burning; douse it and the hand
   comes back. A torch lit from the stack with no Torch readied holds a hand
   of its own, member or not.
2d. The light refusal names held hands: with the character a formation's
   mapper (`toggleRole(formation, actor.id, "mapper", {override: true})`)
   and nothing drawn, light a torch from the sheet. *Observable:* the notice
   reads "no free hand … (2 held for mapping)" — the same clause the hands
   badge shows — rather than a bare refusal. (The kit is in a container for
   this line, or the clause is empty: see 2e.)
2e. The kit is listed at the hands. With the quill and parchment loose on
   the actor and the role taken: *Observable:* the character sheet's Main
   hand place lists the quill and the Off hand the parchment, each row's
   line reading *held for mapping*, each place at 1 / 1; the badge reads
   2 / 2 with no clause; `wearLocation` answers `mainHand` and `offHand`.
   Draw the bow by its row control: *Observable:* the overflow is resolved
   and the bow comes back off; sheathe it and the badge still reads 2 / 2
   beside the two kit rows. Taking the role with a weapon drawn and no
   override is refused with a notice naming the hands. Set the role down:
   *Observable:* both rows return to Carried and the badge reads 0 / 2.
3. Proficiency enforcement: set the enforcement setting to its strict mode and
   attack with a weapon the character is not proficient in.
   *Observable:* the violation is reported, and the setting genuinely gates it
   — flip the setting off and the same attack passes.
3b. The shield and its style: on a character trained in the single style only
   (`flags.acks-extras.styles` = `single`), draw a sword and a shield.
   *Observable:* `getLoadout(actor).shieldStyled` is false with the
   `shieldNoStyle` advisory; the managed loadout effect carries
   `system.ac.mod` at minus the shield's AC, and `system.ac.value` reads
   as it did without the shield. Add `weaponShield` to the styles flag:
   the advisory and the change go, and the value climbs by the shield's AC.
   Add a Specialization marker (`styleProficient` = `weaponShield:spec`):
   nothing more, because the marker carries no figure (3c carries it). The
   same character with the sword alone stays one-handed
   (`wieldTwoHanded` false, `activeStyle` single); add `twoHanded` to the
   flag and the auto grip widens.
3c. A pick made after the kit is drawn (`tools/live/typed-modifiers.mjs`
   walks 3c and 3e; its header names the fixtures): draw the sword and the shield first,
   then give the character the IMPORTED Fighting Style Specialization (from
   the importer's library, imported with the rulebook after this release, so
   its copy carries five `specializedStyle` rows; a hand-made one carries
   none) and tick *Weapon & Shield* on its Mechanics tab — the ability sheet's
   own checkbox, a real click, not a flag write. *Observable:* with no equip
   toggle and no reload, the managed loadout effect gains one `system.ac.mod`
   part named for the proficiency, at the figure the page's bonus table prints,
   and `system.ac.value` climbs; the AC tooltip names the proficiency. Sheathe
   the shield (single style): the part leaves, and no initiative part arrives,
   because the pick is Weapon & Shield. Untick the pick and the value falls
   back. Read the actor from `fromUuid` after each, not the open sheet's
   document.
3e. Imported style and helmet figures, on the kept fixture
   `equipment/style-figures` (a `character` trained in the dual style, two
   daggers and a "Heavy Helmet" armour item; build it by marker when absent),
   with the rulebook's tables imported and `overlayEnclosingHelm` on. Assert
   at the start that both daggers are drawn and the helmet worn.
   *Observable:* the loadout effect carries a `system.attack.mod.melee` part
   labelled two-weapon fighting at
   `acksExtras.lib.tables.getDoc("equipment").tables.dualWeaponStyle.attack`,
   and a `system.surprise.avoidsurprise` part labelled an enclosing helmet at
   `heavyHelm.surprise`; `api.equipment.HELM_MODIFIERS` returns the three
   `heavyHelm` figures. In the Ruledata Browser (GM seat), override
   `dualWeaponStyle` with a different invented number: after the next loadout
   sync the part carries it. Clear the override: it returns. On a world with
   no rulebook tables imported, neither part exists and every
   `HELM_MODIFIERS` figure is null. From a Player seat that owns the fixture,
   open the sheet: the same two parts show, and the Ruledata Browser offers no
   override. Teardown: clear any override left; the fixture stays.
3d. The penalty is named: with proficiency enforcement `on`, attack from the
   character sheet with a weapon the character is not proficient in.
   *Observable:* the system's attack dialog and its card carry a row labelled
   **Non-proficient**, apart from the weapon's own row, which carries only the
   weapon's bonus; `attackThrowRows(actor, item, "melee")`
   (`scripts/equipment/attack-mods.mjs`) returns that one row. Roll the same
   weapon from the item sheet's 2H row: the dialog opens on the two-handed
   die (the system's alternate damage mode first).
3e. Training an imported proficiency states (`tools/live/equipment-ability-training.mjs`,
   GM seat). Fixture `equipment/ability-training`: a character whose training
   effect declares one weapon class (`weaponProf` = `axe`), an equipped sword,
   a Strength above average, and a weapon-proficiency ability as the ability
   sheet writes one (`flags.acks-extras.extras`: category `weaponProficiency`,
   picks set by the walk); each run brings it to that shape first. With
   enforcement `on` and a pick covering swords: *Observable:* the swords pill
   is lit, `getLoadout(actor).nonProficientUse` is false, and an attack through
   the system's own `actor.makeAttackThrow({item, attackType: "melee",
   skipDialog: true})` carries no **Non-proficient** row in
   `outcome.result.attack.modifiers` or on its card. Move the pick to Bows: the
   pill goes dark and the same attack carries the row. Put it back: the row is
   gone. Assert presence only, never the row's size. Teardown: the walk sweeps
   its attack cards by id and restores the enforcement setting; the fixture
   stays.
4. Containers: declare capacity on the sack, `storeIn` the weapon, then
   `takeOut`.
   *Observable:* `contentsOf(sack)` lists it, `encumbranceDelta6` changes, and
   `overCapacity` fires when the declared capacity is exceeded.
4b. Take out from the sheet, not the API: open the character's Inventory tab and
   click the take-out control (`a.acks-equipment-takeout`) on a stowed row.
   *Observable:* the row leaves the container's bucket and reappears in core's
   type list for its type, `containedIn` is gone, and no wear slot was asked
   for. Lock the container and re-open the tab as a player seat: the bucket
   shows the locked hint and no rows, so there is no control to click.
4c. Use gear that is still stowed: with a weapon, a slotted cloak, a shield and
   a lantern all inside one container, click Draw on the weapon's row, Wear on
   the cloak's, and core's own equip toggle on the shield's.
   *Observable:* each item leaves the bucket and appears under Worn & Wielded in
   **one** `updateItem` firing — count them on a hook, since the whole point is
   that the containment is patched into the same write — with `containedIn`
   gone and `getLoadout(actor)` naming the item. The lantern's light control and
   the shield's strap control are absent while stowed and present once loose
   (check both halves; absent alone also describes a control that never renders,
   and the strap needs `overlayShieldVariants` on to appear at all).
   *Regressions to re-check in the same pass:* `storeIn` on an **equipped**
   weapon still unequips and stows it; an unrelated write to a stowed item (a
   rename) leaves it stowed; and writing an EMPTY `gear.wornAt` — taking a thing
   off — does not take it out of the container.
4d. The harness, by weight: create the harness from the system's compendium
   and annotate it — `reliefOf(item)` reads the figure its description states
   and the Construction tab shows it under **Secures** — then wear it on the
   belt beside a dagger and three small items, with light armour or none.
   *Observable:* `encumbranceDelta6` relieves the dagger and the small items
   up to that figure, and a two-handed sword beside them is not relieved;
   over heavy armour the relief is 0; clear **Secures** and the relief is 0.
   The lib's `carriedWeight6(actor)` is the full mass regardless, and
   `borneWeight6(actor)` agrees with it except for clothing, which is free to
   bear.
5. Locks: `setLocked(container, true)`, then `pickLock` and `bashOpen`.
   *Observable:* each reports its throw before rolling; a locked container's
   contents are not readable through `canSeeInside`.
6. Variations: apply the variation item to the weapon via `variations`.
   *Observable:* the named bonus lands on the item and is visible on its
   sheet; removing the variation removes it.
7. Wear and item loss: run `planItemLoss(actor, …)` and the "Item Loss from
   Damage" macro with a token controlled.
   *Observable:* the plan names the stones at risk and which items are
   vulnerable; nothing is deleted until the macro is confirmed.
8. Training: the pills are read and edited on the Stats tab, not the
   Inventory — the render is walked in `docs/character-sheet/TESTING.md`
   under "Training on Stats". What a grant does to equipment is steps 3 and
   3b above: grant training the way a class apply does — an Active Effect
   whose changes set `flags.acks-extras.weaponProf` (CSV),
   `.armourProficiency` (category) and `.styleProficient` (CSV) — and the
   attack that reported `weaponNotProficient`, or the loadout that reported
   `shieldNoStyle`, reports neither afterwards.
9. Every shipped macro compiles.
   *Observable:* each `macro.command` parses when compiled as an **async**
   function. Compiling as a plain `Function`, or with Foundry's injected
   parameter names bound, reports syntax errors that belong to the harness.

## The item sheet

### Fixtures

- A disposable `character`; on it a `weapon` ("Battle Axe", melee, bonus 1),
  an `armor` ("Chainmail"), an `item` "Backpack", an `item` "Torch" with
  `system.quantity.value` 3, an `item` "Flask of Oil", a `money` "Gold Pieces".
- A WORLD `item` "Crowbar" (no actor) and a disposable Scene.

### Drive mechanics (non-obvious, learned live)

- **The band lives in `.window-header`.** Query the name input under the
  header, not the content; the part element is moved there on every render.
- **Sibling changes re-render the open sheet** (`_onFirstRender` hooks). A
  store/take-out or a new ability on the actor must show without closing the
  sheet; if it does not, the hooks are detached or the debounce never fired.
- **Foundry's `editImage` action accepts only an `<img>` target**; the rail's
  art cell is `data-action="changeArt"` and opens the FilePicker itself.
- **Drops, when no pointer can drag:** the zones call `storeIn(actor, item,
  container)`, `disguiseItem(item, {name,img,cost,description,damage,ac})`,
  `bindScene(item, scene)` and `setContainerRecord(item, {keys})` — exercise
  those, and say the drag itself was not driven.
- **A scripted `.blur()` does not save ProseMirror.** Call the element's own
  `.save()`; a real click on its save control is the pointer path.
- **A lock row's Roll button is ABSENT from the Rolls tab** until the actor
  carries a Lockpicking / Dungeon Bashing ability item (`canPick`/`canBash`);
  the same roll PINNED to the art renders as a disabled cell, since the rail
  never changes height.
- **The Appearance tab is bootstrapped from Details → Options**: the Judge's
  "Magical" and "Can be disguised" switches live there, because the tab they
  add cannot be the only door to the flags that gate it.
- **`splitOne` / `restack`** are `item-sheet/stack.mjs`; the split item
  carries `flags.acks-extras.splitFrom`.
- **The coin's band, its rate and its weight in a load** are walked in
  docs/lib/TESTING.md, "Coin: one stack, moved and never copied", steps 1
  and 2. Annotate's half is here: give a `money` item a description that
  states a count of coins to a stone, run `api.equipment.annotateItem(item)`,
  and read `flags.acks-extras.gear.perStone`; run it again with a rate typed
  on the sheet and the typed rate stands.
- **Annotate has two surfaces that sweep coin, and each is driven as itself.**
  The sheet's is the wand in the stowed section's title
  (`.acks-equipment-stowed .acks-equipment-wear__title`, the anchor around
  `.fa-wand-magic-sparkles`), on the system sheet's inventory tab and on this
  module's equipment tab. The macro's is the pack document "Annotate
  equipment RAW profiles"; the dev install's compiled pack is only as new as
  its last build, so run the committed source instead: a tracked world
  `Macro` whose `command` is the `command` of
  `packs/_source/macros/annotate-equipment-raw-profiles.json`, executed with
  no token selected so that it sweeps the world's items.
- **Roll automation is a world setting read at `setup`.** Turning it off takes
  a page reload to act, and so does turning it back on. Read the value first
  and restore it.

### Steps

1. Open each fixture's sheet. *Observable:* no console error; weapon/armour
   show Rolls · Durability · Effects · Details; Backpack, Torch, Flask, coin
   are SIMPLE (no tab strip, a Details button); the band holds the name, Value
   and St; the left rail shows the type glyph and the slot cell.
2. Press the pencil (editor rail, first cell). *Observable:* until then the
   band's inputs, every Details field and the construction controls are
   disabled and a drop only warns, and a real hover on the band's name (the
   `computer` hover, not a dispatched event: what is under test is that the
   browser delivers pointer events to a disabled control) shows the pencil
   hint, while a field with its own tooltip keeps it; armed, the cell's `aria-pressed` is true
   and the description editor is open. Then edit the name; type `1` in St;
   type `12` in Value. *Observable:*
   `item.name`, `system.weight6 === 6`, `system.cost === 12` and the Details
   ledger's listed line reads 12; on a silvered or masterwork item the write
   lands on the pristine layer's cost, `system.cost` is recomputed from it,
   and the worth the layers make of it reads beside the field. Set the value mode to Unknown in Details:
   the band's field gives way to the *Unknown* reading. Close button closes;
   dragging the band's empty area moves the window and clicking into the
   name does not.
2a. Construction (Details, armed), on the axe. *Observable:* Base type,
   Weapon type, Class and Size are selects, Auto first and naming the guess,
   and Class lists the character sheet's classes in its order. Pick Class
   *Bow* → `flags.acks-extras.category === "bow"` and `classifyWeapon(item).cat`
   reads it; Auto clears the flag. Grips: both chips dashed, since the
   axe offers either; click *Two-handed* → `grips === "1h"` (One-handed
   solid, Two-handed ghost); click *Two-handed* again → `versatile`, both
   solid; click *One-handed* → `2h`; click *Two-handed* → both off, the flag
   gone, both dashed again. Qualities: one chip for *Melee*, one for
   *Missile* and one per key of the system's `special` field, each lit from
   its field; click *Slow* → `system.special.slow` true; click again → false.
   Other tags: type a word, Enter → `system.customTags` gains it; its ×
   removes it. Worn at: every `WEAR_SLOT_ORDER` place in the rail's order,
   Main Hand / Off Hand / Both Hands solid and locked (tooltip says why), no
   other lit; click *Belt* → `gear.slots` holds the three hands and `belt`;
   *Auto* → the key is gone. On the Chainmail: *Body* dashed; click it →
   declared `["body"]`; click it off → `gear.slots` is `[]` and the note
   reads carried; *Auto* → dashed again.
3. Rolls: pin a row, click Roll. *Observable:* `flags.acks-extras.pins`
   updates; core's attack dialog/card appears.
4. Editor rail: the armed sheet's description editor (save →
   `system.description`); *Done editing* disables the fields again, and a
   sheet closed and reopened is locked; art (FilePicker); ownership only on
   the world item.
5. Right rail: EQP toggles `system.equipped`; PIN toggles `system.favorite`.
   Torch: `splitOne` → a worn qty-1 split with `splitFrom`, stack reads 2;
   `restack` → split gone, stack reads 3.
6. Container: Details → Holds other items (`gear.capacity` 0, Contents tab
   appears), capacity 4, tick Weapons + Tools, type a refusal. Store the axe
   (row appears in place); `canStore` on the Flask → `{ok:false,
   reason:"refused", message}` and `storeIn` warns with it; take-out clears
   `containedIn` in place.
7. Lock: Durability → Locked; LOCK cell and "The Lock" group appear; add a
   Lockpicking ability to the actor → the Pick Roll button appears without
   reopening; a pick modifier and quality write to the container record.
8. Effects: Add Effect creates an ActiveEffect and opens it; set
   `markets {magic:true, identified:"none"}` → Appearance tab; the three
   steps write `identified`; the Aura select writes `markets.aura` and rings
   the art. Tick Can be disguised, disguise with the Crowbar → renamed,
   Masked chip, striped body; Preview As Player / Judge view; Remove restores.
9. Player seat: at `identified:"none"` the Effects tab reads Unidentified, no
   aura, no Appearance tab; at `partial` the aura shows.
10. Named: overlay on → Make named; true name + ladder `hit,damage` +
    unlocked 1 → `system.bonus` rises by one; Un-name restores.
11. Chart: bind the scene → Chart tab and band chip; Update From Exploration
    captures or warns "nothing explored"; Unbind removes the tab.
12. Both seats, both looks. Dark seat: no near-white ground among the
    sheet's elements. `core` look: the window still HAS a ground —
    `getComputedStyle(app.element).backgroundColor` reads Foundry's own,
    never `rgba(0, 0, 0, 0)`.
13. Close the sheet. *Observable:* `Hooks.events.updateItem.length` returns
    to its pre-open count (the sibling watch detached).
14. Layered fields and the two-handed figure. Fixtures: three world weapons
    named Sword at 1d6, and the library's `masterwork.weaponDamage` variation
    (imported, or made by hand; read its `deltas.damage` as D first). Give one
    the damage tier
    (`api.equipment.setMasterwork(item, "weaponToDamage")`) and type another's
    damage to 1d10. *Observable:* the first's Rolls tab lists a one-handed row
    at `1d6` plus D and a two-handed row at `1d8` plus D; the 1d10 Sword lists
    one row. Silver the third (Details → Silver), press the pencil, type `1d8`
    in Record → Damage with real keys and leave the field, then apply the
    damage tier. *Observable:* damage reads `1d8` plus D (it read `1d6` before
    the fix). Type `1d10` plus D, then clear masterwork and silver.
    *Observable:* the snapshot reads `1d10` after the typing, damage reads
    `1d10` after each clear, and `flags.acks-extras.pristine` is gone after the
    last. With the library variation absent, the tier stamps nothing, the
    Details ledger lists the layer as *not imported* with no figure, and its
    tooltip names the key; with it present the ledger line's tooltip names the
    document and its page, or *Set by hand* on a hand-made one. The
    importer's library notices stack over the top of a sheet at load; move the
    sheet below them before clicking the pencil.
15. A typed guess holds, and an empty one is no guess. On a disposable
    character holding a weapon with an unrevealed `named` record and one other
    item, open the weapon's sheet and press Speak it with the box empty.
    *Observable:* a warning, no write and no `guesses` entry. Arm
    `updateItem` and `renderAcksItemSheet` counters and type a wrong name with
    a `change`. *Observable:* no write and no render. Rename the other item.
    *Observable:* the sibling watch redraws the sheet and the typed name is
    still in the box. Press Speak it. *Observable:* `guesses` holds the
    character's level under its id and the box comes back empty.
16. A field rendered from the record holds what was typed, and only that.
    Same fixtures; tell the two items apart by `type`, since
    `createEmbeddedDocuments` returned them in a different order from the one
    passed. Write a new `givenName` to the record from a script. *Observable:*
    the untouched Rename box shows it. Type a name there, then rename the
    other item and write the record again. *Observable:* no write or render
    from the typing, and the typed name survives both redraws. Press Rename.
    *Observable:* the item takes the name; a later record write shows in the
    box. With the pencil on, type a true name, a ladder holding one known
    word and one that is not, and a different unlocked count; rename the other
    item. *Observable:* all three survive. Press Save. *Observable:* the
    record holds the true name, the known word alone and the count, and the
    redraw shows the stored ladder rather than the typed one; a later
    `trueName` write shows in its box.

## Teardown

Delete the disposable character, its items and the variation item. Confirm
no fixture items remain in `game.items`. The kept fixture
(`equipment/hands-probe`) stays, reset to its start shape.


## The mounted overlay (added with its first release)

Fixtures: a disposable character "QA Rider" (no abilities) owned by the
Player seat, a second "QA Lancer" holding ability items named "Riding" and
"Mounted Combat", a disposable animal "QA Steed" (give it an Item named
"Military Saddle" for step 2's second half), and a disposable land vehicle
with carriage set to each value in turn for step 4. For step 2's unlinked
case, a scene created with `active: false`, a `monster` with
`prototypeToken.actorLink: false` placed on it as a token, and a second
character riding that token's actor. Enable the "Overlay: mounted saves"
setting.

Seats: the Gamemaster seat, which is `game.users.activeGM` and the client
that speaks the damage prompt; the Player seat; and the Assistant Gamemaster
seat. Join all three from one capture script, giving each `connect()` its own
`port`.

Drive notes:
- **A pre-update hook runs only on the client that makes the change.**
  Lower hit points with `api.eval` on the connection of the seat under test.
  An update made from the GM's connection says nothing about another seat's
  damage.
- **Place the unlinked token without a canvas.** Use
  `actor.getTokenDocument({x, y, actorLink: false})`, then
  `scene.createEmbeddedDocuments("Token", [td.toObject()])`. A monster token
  rolls its own hit points when placed, so write
  `token.actor.update({"system.hp.max": 9, "system.hp.value": 9})` before
  mounting anyone. `mountActor(rider, token.actor)` stores the token actor's
  own uuid.
- **An unlinked token's actor update runs `preUpdateActor`, not
  `preUpdateActorDelta`** (docs/lib/MODEL.md, "Lost before it ends"). Drive
  the delta's own pre-update with `token.delta.update(...)`, a write to the
  ActorDelta document. `tokenDoc.update({delta})` is another route
  (docs/lib/TESTING.md, "An unlinked token in the carry").
- **Count the prompts by id.** Give every fixture name one random token for
  the run. Before each fall, list the `game.messages` ids on the GM seat whose
  content holds the token. After the fall, read the new ids, `api.track` each
  one, and count them. Read `game.users.activeGM` in the same call as the fall:
  a peer's GM seat that joins mid-walk speaks in your place.

1. Mount QA Rider on QA Steed (`acksExtras.lib.mount.mountActor`) and make
   an attack roll with the rider (any target).
   *Observable:* a whispered "save to stay mounted" prompt reaches the GM
   and the rider's owner, naming the attack reason. An attack BY the steed
   prompts the same rider. Repeat with QA Lancer riding: no prompt — either
   proficiency waives it.
2. Damage either half of the pair, from each seat in turn. From the
   Gamemaster seat, lower the rider's and then the steed's hp. From the Player
   seat, lower QA Rider's hp, once by `actor.update` and once by changing the
   sheet's `system.hp.value` field. From the Assistant Gamemaster seat, lower
   the rider's hp and then the unlinked mount token's hp. Then heal the rider.
   Last, mount a second token of the monster on QA Steed, which unseats QA
   Rider, and lower the steed's hp from the Gamemaster and Assistant
   Gamemaster seats.
   *Observable:* every fall produces exactly one prompt naming the damage
   reason, authored by the Gamemaster seat, whoever lowered the hp; the steed's
   falls name the token's actor. A prompt
   about QA Rider is whispered to every GM and to the Player, and it is
   `visible` on the Player seat. Healing produces none. With the saddle item on
   the steed, or with the lancer's two proficiencies, a fall from any seat
   produces none.
3. Toggle the overlay setting off and repeat step 1.
   *Observable:* silence — every handler gates on the setting live, no
   reload.
4. Post the card (`api.equipment.mounted.mountedCombatCard(rider)`).
   *Observable:* the three mount-state rows, the war-trained line only for a
   war-trained steed — rename the steed "QA War Steed" at its default
   training and the line appears; set training explicitly to any non-war
   kind and it goes even with the name — the save obligations matching the
   fixtures, and the bonuses hint deferring the numbers to the imported
   proficiencies.

Teardown: dismount, delete every QA fixture, disable the overlay if the
world had it off.

## Weight in sixths, and bundled goods

Fixtures to create and destroy: one disposable `character`, one disposable
`item` named for the test.

1. **Entry is sixths.** Open a plain item's sheet. The band's weight field is
   labelled `1/6 st` and steps by 1. Type `1`.
   *Observable:* `item.system.weight6 === 1`, and the label beside the field
   reads `¹⁄₆`. Typing `6` reads `1`. (Before 5.7.0 this field took decimal
   stone — a Judge who typed `1` got a whole stone.)
2. **No unrelated submit moves it.** Rename the item through the UI.
   *Observable:* `weight6` unchanged. There is no derived weight control left
   to write it, which is what makes this structural rather than guarded.
3. **A bundle counts once.** Set the item's quantity to 20 — the `Per` field
   appears on the Record panel — and set `Per` to 20, weight to 1.
   *Observable:* `weight6Of(item) === 1` — one full bundle. The band prints a
   single figure here, because at exactly one bundle the stated weight and the
   carried total ARE the same number; step 5 is where the two diverge and the
   paired display appears.
4. **The character sheet agrees.** Put it on the character.
   *Observable:* encumbrance rises by **1 sixth, not 20**. Read the encumbrance
   bar with your eyes, not only the API — core computes the sum and this module
   corrects it, so an API-only check can pass while the sheet disagrees.
5. **A part-used bundle is whole.** Set quantity to 21.
   *Observable:* 2 sixths, not 1.05. This is the `ceil` ruling; it is what
   distinguishes a bundle from a per-unit fraction. The band now shows the pair
   — `¹⁄₆ · ¹⁄₃`, one bundle's weight and the whole stack's. Open the item's
   sheet with the owning actor's sheet CLOSED; a known defect duplicates the
   title band otherwise and hides this readout.
6. **Annotate declares it.** Create an item named `Quiver, 20 Arrows` with no
   bundle, and press **Annotate**.
   *Observable:* `gear.per` becomes 20 and the weight does not multiply; the
   quantity stays what it was — Annotate never writes the count. Set the
   quantity to 7 and `per` by hand to something else, then re-annotate:
   *Observable:* both survive — a half-spent quiver does not refill, and the
   Judge's bundle size stands.
7. **Containers roll up bundled.** Stow the quiver in a container.
   *Observable:* the container's load counts one bundle, and its capacity rail
   is not over-full.
8. **Coin, from the sheet's control.** Give the character a `money` item whose
   description states a count of coins to a stone, and no rate of its own.
   Open the system's sheet on its inventory tab and press the wand in the
   stowed section's title.
   *Observable:* the coin's `gear.perStone` is the stated count, the notice
   counts the items annotated, and the character's `encumbrance.value6` moved
   by the difference between the two rates.
9. **Coin, from the macro.** Create a world `money` item with the same
   description and run the macro's source with no token selected (drive
   notes).
   *Observable:* the notice counts a coin stack in the world apart from the
   other kinds, and the world item's `gear.perStone` is the stated count.
10. **Weighed with roll automation off.** With a purse of several hundred
    coins on the character, read `system.encumbrance.value6`. Turn the
    roll-automation setting off, reload the page and read it again.
    *Observable:* the same figure, part-stone included, and
    `CONFIG.Actor.documentClass.prototype.computeEncumbrance` is still
    libWrapper's wrapper. Turn the setting back on and reload.

Teardown: `api.sweepTracked()` takes the item, the container, the character,
the world coin and the macro; confirm nothing named for the fixture remains
and that the roll-automation setting reads what it read before step 10.

## One clothing declaration

Fixtures to create and destroy: one disposable `character` owned by the Player
seat, and on it an `item` named for the test with `system.weight6: 6` (one
stone). `api.track` every item a step creates, including the embedded copy a
drag makes. Read encumbrance on the character sheet's bar as well as the API.

1. **The rail, from the Player seat.** Open the item's sheet, Construction
   panel, and set Base type to Clothing.
   *Observable:* `system.subtype === "clothing"` and the flag reads
   `clothing`, in one write; the encumbrance bar drops by one stone.
2. **Back off it.** Set Base type to Gear, then to Clothing again and then to
   Auto.
   *Observable:* Gear writes `system.subtype: "item"` and the stone returns;
   Auto unsets the flag and weighs it too, because the declaration left both
   halves.
3. **The subtype half** (core's sheet, a macro, the importer all write this):
   `item.update({"system.subtype": "clothing"})`.
   *Observable:* the flag becomes `clothing` in the same write, and the rail
   shows it.
4. **A create.** `Item.create` an `item` with `system.subtype: "clothing"` and
   no flag, as the importer writes one, and drag an item from core's clothing
   compendium onto the character.
   *Observable:* both carry the `clothing` flag as created, and weigh nothing.
5. **A disagreement already stored is left alone, then settled.** Build the
   pre-upgrade shape with the hook skipped:
   `Item.create({name, type: "item", system: {subtype: "item", weight6: 6},
   flags: {"acks-extras": {baseType: "clothing"}}}, {noHook: true})`. Rename it.
   *Observable:* the subtype stays `item`; an unrelated edit repairs nothing.
   Press Annotate on it.
   *Observable:* `system.subtype === "clothing"`, and Annotate's count
   includes it.
6. **One control.** Open a plain item's Record panel.
   *Observable:* no Kind select; Quantity and Max remain. On an `armor`
   document the rail's Base type list offers no Clothing.
7. **A disagreement left from before.** Walked as the repair tool's
   `equipment.railClothing` check in docs/lib/TESTING.md, "The repair tool".

Teardown: `api.sweepTracked()`; quote what it removed, what it could not find
and what refused.

## Weapon identity

What a weapon IS, and the three declarations that state it when nothing can
read it. Everything here is drivable from `api.eval` against the module API; the
last step is the one that has to be a real gesture.

### Fixtures

A disposable character `ZZ Weapon Identity Probe` with
`flags.acks-extras.weaponProficiency = "axe"` (the shape a class-training
effect leaves), carrying four weapons created on it:

| Name | Flags | Reproduces |
|---|---|---|
| `Francisca` | `skin: {base: "def.weapon.handAxe", baseName: "Hand Axe"}` | a template's printed descriptor over an imported base |
| `Francisca (bare)` | none | the same item with nothing to identify it |
| `Two-handed iron sword` | `skin: {base: "def.weapon.twoHandedSword", …}` | a name whose LOOSE match is a different, smaller row |
| `Hachereau` | `cookbook: {id: "def.weapon.battleAxe"}` | a row the importer minted from the reader's grid |
| `Sword, Two-Handed` | none | the catalogue's head-first name, with nothing else to read |

No base document has to exist: the resolver reads the recorded id and name, it
does not dereference them.

### Steps

1. **A skin keeps its base's identity.** `weaponIdentity(francisca)`.
   *Observable:* `{key: "handaxe", source: "skin"}`, `classifyWeapon().cat` is
   `axe`, and `isWeaponProficient(actor, profile)` is **true** — the reported
   bug, inverted.
2. **Nothing to read is still nothing.** The same on `Francisca (bare)`.
   *Observable:* `key: null`, `cat: "other"`, proficient **false**. This is the
   control: it is what every skinned weapon used to do.
3. **The loose match no longer beats a recorded base.**
   `weaponIdentity(sword)`. *Observable:* `twohandedsword`, and
   `classifyWeapon().damage2h` is `null` — the sword stops offering a
   two-handed row at a smaller die than its own.
4. **A mint id identifies.** *Observable:* `Hachereau` → `battleaxe`, source
   `mint`.
5. **A declaration outranks all of it.** `setWeaponProfile(bare, "handaxe")`.
   *Observable:* source becomes `flag` and the item reads proficient.
6. **Grips answer ahead of size.** `setWeaponGrips(francisca, "2h")`.
   *Observable:* `handCost(profile, {twoHanded: false})` is 2 on a SMALL
   weapon. `setWeaponGrips(item, "auto")` → `profile.grips` is `null` again.
7. **Size declares and clears.** `setWeaponSize(item, "large")` then `"auto"`.
   *Observable:* `classifyWeapon().size` is `large`, then back to the table's
   own `small`.
8. **Stowing keeps the hands.** `setGearSlotList(item, [...hands, "belt"])`.
   *Observable:* `gear.slots` holds all four; the weapon is still wieldable.
9. **The controls are real.** Render the item sheet, press the pencil, then
   dispatch a genuine `click` on the Grips strip's *Two-handed* chip and a
   `change` on each of the Weapon type and Class selects.
   *Observable:* `getFlag("acks-extras", "grips")` is `"versatile"` (the
   inferred one-handed grip kept, the second added), `profileKey` is
   what was picked and `category` is the class chosen, which
   `classifyWeapon().cat` now reads ahead of the row's own — **re-read from
   `fromUuid` afterwards**, not from the
   open sheet's document. These controls live inside core's `<form>` and an
   un-stopped change re-renders the sheet from ITS form data; a check that
   reads the in-memory document cannot tell a persisted write from one that is
   about to be thrown away.
10. **A head-first name identifies by name.** `weaponIdentity` on
   `Sword, Two-Handed`. *Observable:* `{key: "twohandedsword", source: "name"}`
   and `damage2h` null. Draw it on a character and open the character sheet:
   its attack list shows **one** row for it, and a damage roll from that row
   rolls the item's own die — read the formula off the chat message, not the
   row's label, since the row and the roll are separate readings.

### Teardown

Sweep by the run's own uuids (`api.create` records them; `api.track` the four
items after they are made). Quote the sweep result.

## The Configure Proficiencies macro

What the macro stores for a weapon profile that is set, cleared or was never
stated, from a GM seat and from a player's. The prompt that answers a typed
name matching no weapon is not walked here.

### Fixtures

Two disposable scenes, each viewed on the driving client alone
(`scene.view()`; neither is activated), four `character` actors and a token
for each:

| Actor | `flags.acks-extras` as created | Token |
|---|---|---|
| stored | `weaponProficiency: "axe,sword"`, `styles: "single,missile,dual"`, `armorMax: "light"`, and one key the macro does not write | linked |
| blank | none | linked |
| base | `weaponProficiency: "bow"` | **unlinked** |
| player-owned | `weaponProficiency: "axe,sword"`, `styles: "single,missile"`, `armorMax: "light"`, and one key the macro does not write; `ownership.default: 3` | linked, on a scene of its own with `ownership.default: 2` |

`api.create` records every one of them.

### Drive mechanics (learned live)

- **The macro's id** is `acksEqConfig0000`, and its dialog's title is
  `Proficiencies — <actor name>`. How a shipped macro is run, how an edit is
  walked before the pack is rebuilt, and how a compatibility warning is heard
  are docs/TESTING.md, "Walking a shipped macro".
- **The form** is checkboxes `input[name="style"]` and `input[name="grant"]`,
  a text field `input[name="named"]` and `select[name="armorMax"]`; Save is
  `button[data-action="ok"]`. The macro reads the form with `FormData` when
  Save is pressed, so what the controls hold at that moment is what is stored.
- **A profile with nothing stored opens with All weapons ticked**, and that
  box overrides every box under it. Untick it before ticking anything else.
- **Single-weapon and missile are stated, never offered.** Every save writes
  `styles` beginning `single,missile`.
- **Read what is stored from `_source`**
  (`(await fromUuid(uuid))._source.flags`, and a token's own from
  `tokenDoc.delta._source.flags`). An unlinked token's actor answers `flags`
  through its base actor, so the prepared read cannot tell an override from a
  value it inherits.
- **A player seat runs it only with `MACRO_SCRIPT` and sight of the
  compendium.** Read `macro.canExecute` on that seat before the step.

### Steps

Each step controls one token, runs the macro, brings the form to the state
named and presses Save.

1. **A stored profile is cleared.** On `stored`: untick every weapon box and
   empty the named field.
   *Observable:* `weaponProficiency` is absent from the stored flags; `styles`,
   `armorMax` and the key the macro does not write are unchanged; the notice
   reads `weapons unrestricted`; no `forced deletion` line.
2. **A profile is set.** On `stored` again: untick All weapons, tick Axes,
   Bows and Two-handed, type `sword`, pick Medium.
   *Observable:* `weaponProficiency: "axe,bow,sword"`,
   `styles: "single,missile,dual,twoHanded"`, `armorMax: "medium"`.
3. **Nothing stated, nothing stored.** On `blank`: untick All weapons.
   *Observable:* `styles: "single,missile"` and `armorMax: "heavy"` are
   written and no `weaponProficiency` key appears; no `forced deletion` line.
4. **An unlinked token keeps its own.** On `base`'s token: untick Bows, tick
   Axes.
   *Observable:* the token's delta holds `weaponProficiency: "axe"`; the base
   actor still holds `"bow"`.
5. **Clearing an unlinked token returns it to its base.** On the same token:
   untick Axes.
   *Observable:* the delta holds no `weaponProficiency` and the token's actor
   reads the base actor's `"bow"` again. The notice still says `unrestricted`:
   it reports what was saved, which is no longer what the token reads.
6. **A player's own character.** From the Player seat in a browser of its own,
   with a GM client connected: step 1 on `player-owned`.
   *Observable:* the key is gone on the Player's client and on the GM client's
   copy of the actor; no `forced deletion` line on either console.
7. **A reload keeps it.** Reload the GM client.
   *Observable:* `stored`, `blank`, `base` and the token's delta read what
   steps 2, 3 and 5 left.

### Teardown

`api.sweepTracked()`; quote what it removed, what it could not find and what
refused.

## Two windows of one GM

Every window of the active GM user writes the loadout, so this walk needs two
of them. The effect must still be one document.

### Fixtures

- Two capture-driver seats as the SAME GM user, on two debug ports, both
  loaded after the change under test.
- A character the run creates, with chain armour, a shield and a sword
  equipped, made a Fighter through `acksExtras.classes.applyClass`.

### Drive mechanics (learned live)

- Read `/api/status` `users` with every seat of your own closed. Any other
  connection seated as that GM is a THIRD writer. If its page loaded before
  the change, it writes the old way and spoils the run; find its owner first.
  The census's active-user list cannot show this, because it lists users,
  not connections.
- In each page, arm a `preCreateActiveEffect` hook on loadout-flagged
  effects. It fires only in the window that sends the create, so it says
  which window wrote. A create with no local preCreate in either page came
  from a connection you do not hold.
- Core logs the losing window's refused create ("The _id [...] already
  exists within the parent collection"), and the delete or update another
  window overtook. Those lines are expected. A line prefixed
  `acks-extras | ... loadout sync failed` is not.

### Steps

1. From seat A, apply Thief to the Fighter, then wait 3 s.
   *Observable:* in both pages, exactly one loadout effect, `_id`
   `acksExtLoadout00`, `system.ac.mod -1`, AC 4. Each page shows at most one
   local preCreate.
2. From seat B, unequip the shield and equip it again, then wait 3 s.
   *Observable:* still one loadout effect under that id, AC 4.
3. From seat A, apply Fighter, then wait 3 s.
   *Observable:* no loadout effect in either page, AC 5.

### Teardown

`api.sweepTracked()` on the seat that created the fixture; quote what it
removed, what it could not find and what refused.

## Armour Training's step

The step an Armour Training ability raises the armour rungs by is its
imported `modifies`/`armor` row's value times its rank; with no row the
Stats tab says the step is not imported (MODEL, "Armour Training's step").
Walked by `tools/live/typed-modifiers.mjs` (`STAGE=3`), which marks the two
items `equipment/armour-step-hand` and `equipment/armour-step-row`.

### Fixtures

- **Kept, `equipment/armour-step`**: a `character` with
  `flags.acks-extras.armorMax` `"veryLight"` and no class training effect,
  carrying two `ability` items:
  - "Armour Training" made by hand (no `cookbook` flag, no
    `extras.effects`), `extras.qty` 1;
  - a copy of the imported Armor Training proficiency (from the world
    library after a Proficiencies import with the RR mapped, or
    `api.fixture` with `flags.acks-extras.cookbook.id`
    `def.prof.armorTraining` and one `extras.effects` row
    `{type: "modifies", refs: ["kw:armorproficiency"], domain: "armor",
    value: {kind: "flat", flat: 2}, mode: "add"}`, an invented step),
    `extras.qty` 1.
  Each step below brings it to this shape first: both items present, the
  quantities and the row's value as listed.
- The imported library item `def.prof.armorTraining`, for step 1. Build it
  by importing Proficiencies with the RR mapped; it is the import's, so it is
  not tracked or swept.

### Steps

1. GM seat. Open the library Armor Training item's sheet, Mechanics tab.
   *Observable:* the Imported mechanics list holds a Modifies row whose face
   ends in a signed step; the row has Edit and Delete buttons. Open Edit.
   *Observable:* an editor window titled with the item's name, Domain
   "Armor", Value kind Flat and the flat box holding the step the page
   prints (hover nothing; read it against RR ch. 3, Armor Training).
   Close without changing it.
2. GM seat, the fixture's Stats tab. *Observable:* under the armour rungs, a
   line for the hand-made "Armour Training" with no figure and "· step not
   imported", whose tooltip says the step is read on import or set on the
   row; a line for the imported copy reading `+2`, whose tooltip names a
   step of 2 times rank 1 and the cite. The lit rungs end at Medium
   (very light plus 2).
3. Set the hand-made item's `extras.qty` to 3. *Observable:* its line still
   shows no figure; the lit rungs do not move. (`qty` is a count the item
   records, not a rank; rank is the number of same-named copies.)
4. On the imported copy's sheet, Edit the row and type 3 into Flat (an
   invented figure, the Judge's). *Observable:* the Stats line reads `+3`,
   the rungs end at Heavy; `item.flags["acks-extras"].extras.effects[0].value`
   is `{kind: "flat", flat: 3}` and the row's `refs` and `domain` are as they
   were. Restore the flat box to 2.
5. Give the character two more hand-made "Armour Training" copies (rank 3,
   built and swept by the run). On the first one's sheet, Add a row: kind
   Modifies, Domain Armor, Value Flat 2. *Observable:* its Stats line now
   reads the rungs it adds (step 2 × rank 3), the other two copies still say
   "step not imported", and the rungs end at Heavy. Delete the row again.
   *Observable:* "step not imported" is back. Delete the two extra copies.
6. **Player seat** owning the fixture: open both item sheets. *Observable:*
   the Imported mechanics rows show no Edit, Delete or Add controls; the
   Stats tab lines and their tooltips read as on the GM seat.
7. Pre-change copy: give the imported copy's row a bare `value: 2` (the shape
   an import made before the step was located, a bare number; the figure is
   invented). *Observable:* its line reads `+2`, the rungs end at Medium.
   Restore the LevelValue.

### Teardown

The fixture stays. Nothing else is built.

## What every class throws

A flask, a bottle, a rock or a torch is proficient for a character who holds no
grant for it (MODEL, "What every class throws is not a grant").

### Fixtures

- **Kept, `equipment/anyone-throws`**: a `character` with
  `flags.acks-extras.weaponProficiency` `"swordDagger"`, carrying copies of
  the world's imported "Flask of military oil", "Flask of unholy water",
  "Dart" and "Sword" (from the cookbook item compendium), and a hand-made
  `weapon` "Torch" with `system.melee` and `system.missile` true. Each step
  sets `system.equipped` on what it names and off on the rest first.
- Needs `proficiencyEnforcement` on and the non-proficient table imported;
  with no table the penalty rows are empty and steps 3–4 prove nothing.

### Steps

1. Draw each weapon in turn. *Observable:* `api.getLoadout(actor)` reports
   `nonProficientUse: false` for the oil, the unholy water (a name the table
   does not print, identified as holy water), the torch and the sword, and
   `true` with a `weaponNotProficient` violation for the dart, which is granted
   by name, not by the rule; `classifyWeapon(item).anyoneThrows` is true for
   the first three only.
2. Character sheet, Rolls tab. *Observable:* the dart's row carries a
   Non-proficient tag; the oil's and the unholy water's do not; the torch's
   melee and two-handed rows carry it and its thrown row does not.
3. Draw the oil and press its row. *Observable:* the attack-throw dialog
   reads `1d20`, "Hits on 10+", with no Non-proficient line. Roll it; the
   chat card's formula is `1d20`. The card is the run's: delete it by its id.
4. The same with the dart, then Cancel. *Observable:* the dialog reads
   `1d20 - 1` with a Non-proficient line carrying the imported figure.
5. Draw the torch and press its melee row. *Observable:* `1d20 - 1` with the
   Non-proficient line. Pick Thrown under Attack type in the same dialog.
   *Observable:* `1d20`, no line. Cancel.
6. The Stats tab's Training pills. *Observable:* no pill lit that the
   `swordDagger` grant does not light.

### Teardown

The fixture stays; the step 3 card is swept by id.

## Gear nobody annotated

A garment that declares no place is worn where its name puts it (MODEL, the
gear flag's storage row).

### Fixtures

- **Kept, `equipment/unannotated-belt`**: a `character` carrying an `item`
  "Leather belt" with no `flags.acks-extras.gear`, as a price-list row from
  before this change carries it (a copy of the cookbook item compendium's
  "Leather belt", or an `item` built with the bare name), owned (level 3) by
  the Player seat. Each step starts it unworn with no gear flag:
  `item.unsetFlag("acks-extras", "gear")`.

### Steps

1. Character sheet, Equipment tab, the belt's row. *Observable:* a Wear control
   whose tooltip reads "Wear it — Belt".
2. Press it. *Observable:* one write sets
   `flags.acks-extras.gear` to `{slots: ["belt"], wornAt: "belt", …}`, and the
   belt moves to the Belt bucket on the left.
3. Press the control again (now "Take it off (Belt)"). *Observable:* `wornAt`
   clears and `slots` stays `["belt"]`.
4. **The item sheet's EQP cell.** Open the plain belt's item sheet with its
   `gear` flag deleted. *Observable:* not simple mode — the tab strip and the
   right rail show, and the rail's first cell is EQP. Press EQP.
   *Observable:* the flag becomes `{slots: ["belt"], wornAt: "belt", …}` and
   the cell reads "EQP Belt". Press it again to take it off.
4b. **The Follower Card's toggle.** Give a hireling `character` actor (marker
   `equipment/follower-belt`) a plain belt with no `gear` flag, open it on the
   Follower Card sheet, and find the belt in the Equipment list.
   *Observable:* a shield toggle (`data-action="fcToggleEquip"`), not the
   faint circle. Press it. *Observable:* the flag becomes
   `{slots: ["belt"], wornAt: "belt", …}` and the shield turns solid. Press it
   again: `wornAt` clears.
5. Set the flag to `{slots: []}` (a declaration of nowhere). *Observable:* no
   Wear control on the row, `wearableSlots` is `[]`. Unset it again.
6. **Player seat** (the capture driver's `connect({user: "Player"})`): steps
   1–3 on the owned fixture. *Observable:* the same control and the same two
   writes. The driver has no pointer input; a page-context `click()` on the
   control runs the sheet's action as that seat.
7. **The system's own sheet.** Render the actor with core's `Ct` sheet class
   (not its default), Inventory tab. *Observable:* the injected control on the
   belt's row reads "Wear it — Belt" and makes step 2's write.
8. **A stack.** A copy of the belt with `system.quantity.value` 2, tracked.
   Press "Split one off the stack". *Observable:* a new one-belt item with
   `{slots: ["belt"], wornAt: "belt"}`, the stack at 1. Track the new item.
9. **Annotate.** On core's sheet, the annotate control in the inventory's
   wear section. *Observable:* "Annotated N item(s)"; each belt gains
   `slots: ["belt"]`, and a worn one keeps its `wornAt`. Sweep the step 8
   items and unset the fixture's flag.
9b. **Annotate keeps what is set.** On the fixture, a tracked "Backpack" with
   `gear: {slots: ["back"], capacity: 3}`, a tracked "Cloak" (subtype
   clothing) with `gear: {slots: ["back"], capacity: 0.5, wornAt: "back"}`,
   and a tracked "Battle Axe" weapon with `system.size` "large". Press
   Annotate gear on the character sheet's Equipment tab. *Observable:*
   "Annotated N item(s)." (wait for it: the pass writes one item at a time);
   the backpack's and the cloak's `slots` and `capacity` are as set, the cloak
   still worn at the back, the axe has its `profileKey` and no
   `flags.acks-extras.size`, and an unannotated belt beside them still gains
   `slots: ["belt"]`. A second pass through the macro's own step,
   `acksExtras.equipment.annotateItem(axe)`, leaves the size unset too (the
   macro itself, with no token selected and no assigned character, sweeps
   every item in the world). Sweep the three.
10. **The importer.** With the rules book open on the seat, snapshot every
   world item whose `flags.acks-extras.cookbook.id` starts `def.priced.`, then
   run the price rows alone in Repair in place: the importer module's
   `importPricedGear(undefined, {repair})` with `repair` a `repairTally()`
   whose `tables` is `{"priced"}`. The Manage imports Equipment step in that
   mode also rewrites every equipment entry. *Observable:* every held row
   that declared no place and has an inferred one gains a `gear` flag, and
   no other field of any row changes; a second run changes nothing. The
   create path (a row this world does not hold yet) is not walked here: it
   needs a world without the price rows.

### Teardown

The fixture stays, with its Player ownership. The importer step's writes are
the import's, not the run's: they are neither tracked nor swept.

## Grants a pack wrote as overrides

Every CSV grant an item's effect states counts, whatever its change type,
beside the class training's own (MODEL §3). The shape under test is a world
that still holds items from the retired equipment-training pack, whose
effects are all `override` at priority 50
(`git show 741cdff^:packs/_source/equipment-training/`).

### Fixtures

- **Kept, `equipment/override-grants`**: a `character` with no
  `weaponProficiency`, `styles` or `armorMax` flag, carrying, each found by
  `flags.world.fixturePart`:
  - six `ability` items, each with one transfer effect whose one change is
    `type: "override"`, `priority: 50`: `weaponProf` `axe` (`grant-a`) and
    `bow` (`grant-b`), `styleProficient` `weaponShield` (`style-a`) and
    `twoHanded` (`style-b`), `armourProficiency` `light` (`armour-a`) and
    `medium` (`armour-b`). Names are neutral (`QA pre-upgrade <part>`); the
    pack's own are in git;
  - four bare `weapon` items: Sword, Hand Axe, Short Bow, Spear (`w-sword`,
    `w-axe`, `w-bow`, `w-spear`);
  - an actor effect (`hand-override`) overriding `weaponProf` with `crossbow`;
  - a class training effect granting `sworddagger`, written the way the Stats
    tab's Training pills write it:
    `toggleTraining(actor, "weapons", "sworddagger", {create: true, on: true})`
    (`scripts/classes/training.mjs`), an `add` at priority 20.
- Needs `proficiencyEnforcement` on and the non-proficient table imported
  (`nonProficientFigures().attackThrow` not null); without it the Spear's
  control proves nothing.
- Each step starts with nothing equipped and the three profile flags unset.

### Steps

1. Read the sets. *Observable:* `collectStringFlags(actor, "weaponProf")`
   holds `axe`, `bow`, `crossbow` and `sworddagger`; `trainedStyles(actor)`
   holds `weaponshield` and `twohanded`; `armorMax(actor)` is `medium`.
   *Control:* the replaced reading (an override resets the set), replayed over
   `orderedChanges(actor, "flags.acks-extras.weaponProf")`, keeps one token.
2. Equip each weapon alone; equipping round-trips through the server, so wait
   for its `updateItem` hook before reading. *Observable:* `getLoadout(actor)`
   reports `nonProficientUse: false`, and `attackThrowRows` carries no
   Non-proficient row, for the Sword, the Hand Axe and the Short Bow; the
   Spear, granted by nothing, reports `true` and carries the row.
3. Equip the Hand Axe and open its attack throw
   (`actor.makeAttackThrow({item, attackType: "melee"})`). *Observable:* the
   dialog has no Non-proficient line. Cancel; no chat card is posted.
4. Character sheet, Effects tab. *Observable:* the hand-made override's row
   reads `weaponProf crossbow`, with no `=` before the value.

### Teardown

The fixture stays, with nothing equipped. A card step 3 posted despite the
Cancel is the run's: delete it by its id.

## A helmet over the suit

Core's AC reads the last equipped non-shield armour as its base; the loadout
effect puts the suit's back (MODEL, "A helmet never replaces the suit").

### Fixtures

- **Kept, `equipment/helm-after-suit`**: a `character` with dexterity
  modifier 0. Its armour is copied each run from the imported price list
  (`world.acks-cookbook--item`): the first `medium` armour with an AC above 0
  (`suit`), and the first armour whose name reads helm (`helm`), each found by
  `flags.world.acPart`. A run deletes the copies the last one left, by that
  flag, before copying.
- `equipment/override-grants` (above) takes the same suit and helm, plus the
  first `shield` with an AC above 0 (`shield`).

### Steps

1. Equip the suit, then the helm, waiting for each `updateItem`.
   *Observable:* `system.ac.value` equals the suit's AC both times, and
   `system.ac.mod` after the helm equals it too (core's base is the helm's 0).
2. On `equipment/override-grants`: suit, shield, helm. *Observable:* AC is
   the suit's plus the shield's after the shield and after the helm, and
   `getLoadout(actor).nonProficientUse` is false (the medium grant).
3. With suit and helm on and the loadout effect written, open the character
   sheet on its Stats tab; then again with the sheet open before the suit and
   the helm go on. *Observable:* both times the armour AC figure reads
   `system.ac.value` less the shield, and its tooltip names the helm as core's
   armour, then the suit's AC under a helmet with its figure.
4. The pre-update shape: suit and helm on, the loadout effect deleted (what
   the code before this fix left for the pair). Close the window and connect a
   fresh one, toggling nothing. *Observable:* within the ready pass, the effect
   is written and AC equals the suit's.

### Teardown

The fixtures stay with their armour unequipped.

## Weapon rows, and the silver and masterwork figures

The `weapons` ruledata document is built from the minted library weapons;
the silver plating and the masterwork tiers read the library's variation
documents (MODEL, "Weapon rows" and "The silver and masterwork flags read
the imported documents").

### Fixtures

- **Kept, `equipment/layer-sword`**: a world weapon with no layers. Found by
  its marker; built from any imported sword row when nothing carries it.
- **Setup is the subject for the figures.** The library variations
  `material.silver` and `masterwork.*` are the import's own. A world that
  imported the rules book has them; for the absent case, remove the import
  with the driver's `api.retire` and reimport, tracking what the import made.
- **Kept, `equipment/provenance-variation`**: a world variation the importer's
  own binder builds from the first masterwork entry whose page states a delta
  and a cost, under the walk-only key and entry id `walk.provenance`, so no
  reader of the library's variations finds it. Needs the rules book open on the
  GM seat (`connectBookUrl` with `remember: false`); each run repairs it to the
  page's shape (`refreshImported` with `REPAIR.variation`) before its first
  check. The library's own variations are never edited: they carry no marker.

### Steps

1. After `ready`, read `acksExtras.lib.tables.getTable("weapons", "grid")`.
   *Observable:* one row per imported weapon, keyed by weapon key, each with
   a `cite`; `citeOf("weapons", "grid")` names a page. Edit one library
   weapon's damage and read again: the row follows. Delete that weapon: its
   row is gone. A weapon on an actor moves nothing. A weapon imported before
   the system's own weapon fields were written gives no row.
2. Set `layer-sword` to the damage tier and to Silvered (Details). With the
   variations imported, *Observable:* the stamped fields equal the
   documents' figures; the ledger lines' tooltips name the document and its
   page. A hand-made `masterwork.weaponDamage` variation reads *Set by hand*.
3. Remove the variations from the library. *Observable:* the next recompute
   stamps nothing, the ledger lists each layer as *not imported* with no
   figure, its tooltip names the variation key, and the Net row says so.
4. **Player seat** (`connect({user: "Player"})`): repeat step 2's recompute
   on an owned item. *Observable:* the figures read as the GM seat read them;
   a seat that cannot open the shelf reads *not imported*, which is the case
   this step is looking for.
5. On `equipment/provenance-variation`, read `printed-layers.mjs`
   `sourceOf` and `provenanceTip`. *Observable:* the import stamp's
   `cookbook.read` is present after the data model has had the document; the
   tooltip is the *read from* one, not edited. Raise `system.cost.add` by one:
   *edited by hand*, naming the page the import read. Repair it again: the
   figure is the binder's and the tooltip reads from its page.
   `tools/live/equipment-printed-layers.mjs` walks this step.

### Teardown

The kept sword stays; re-import the variations if step 3 removed them.
