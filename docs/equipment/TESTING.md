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
- **A fixture's string flag must be an `add` change.** An effect carrying
  `{key: "flags.acks-extras.damageAttribute", type: "custom", value: "wis"}`
  is ignored by `collectStringFlags`, so Strength of Faith never fires and the
  damage roll looks unfixed; `type: "add"` reaches it. A boolean domain
  (`finesse`) fires on the key alone, whatever the type — which is why one
  half of a fixture works and the other does not. Roll with
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
   one more. The same character with the sword alone stays one-handed
   (`wieldTwoHanded` false, `activeStyle` single); add `twoHanded` to the
   flag and the auto grip widens.
3c. A pick made after the kit is drawn: draw the sword and the shield first,
   then give the character a Fighting Style Specialization ability and tick
   *Weapon & Shield* on its Mechanics tab — the ability sheet's own checkbox,
   a real click, not a flag write. *Observable:* with no equip toggle and no
   reload, the managed loadout effect gains the specialization's change and
   `system.ac.value` climbs; untick it and the value falls back. Read the
   actor from `fromUuid` after each, not the open sheet's document.
3d. The penalty is named: with proficiency enforcement `on`, attack from the
   character sheet with a weapon the character is not proficient in.
   *Observable:* the system's attack dialog and its card carry a row labelled
   **Non-proficient**, apart from the weapon's own row, which carries only the
   weapon's bonus; `attackThrowRows(actor, item, "melee")`
   (`scripts/equipment/attack-mods.mjs`) returns that one row. Roll the same
   weapon from the item sheet's 2H row: the dialog opens on the two-handed
   die (the system's alternate damage mode first).
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
    named Sword at 1d6. Give one masterwork +1 damage
    (`api.equipment.setMasterwork(item, "weaponToDamage")`) and type another's
    damage to 1d10. *Observable:* the first's Rolls tab lists a one-handed row
    at `1d6 + 1` and a two-handed row at `1d8 + 1`; the 1d10 Sword lists one
    row. Silver the third (Details → Silver), press the pencil, type `1d8` in
    Record → Damage with real keys and leave the field, then apply masterwork
    +1 damage. *Observable:* damage reads `1d8 + 1` (it read `1d6` before the
    fix). Type `1d10 + 1`, then clear masterwork and silver. *Observable:* the
    snapshot reads `1d10` after the typing, damage reads `1d10` after each
    clear, and `flags.acks-extras.pristine` is gone after the last. The
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
