# Equipment — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

## Fixtures

- A disposable `character` actor.
- On it: a `weapon` whose name matches a RAW weapon (e.g. "… Sword"), an
  `armor`, and a plain `item` to serve as a container.
- A disposable `acks-extras.variation` Item for the variation path.

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
2d. The light refusal names held hands: with the character a formation's
   mapper (`toggleRole(formation, actor.id, "mapper", {override: true})`)
   and nothing drawn, light a torch from the sheet. *Observable:* the notice
   reads "no free hand … (2 held for mapping)" — the same clause the hands
   badge shows — rather than a bare refusal.
3. Proficiency enforcement: set the enforcement setting to its strict mode and
   attack with a weapon the character is not proficient in.
   *Observable:* the violation is reported, and the setting genuinely gates it
   — flip the setting off and the same attack passes.
3b. The shield and its style: on a character trained in the single style only
   (`flags.acks-extras.styles` = `single`), draw a sword and a shield.
   *Observable:* `getLoadout(actor).shieldStyled` is false with the
   `shieldNoStyle` advisory; the managed loadout effect carries
   `system.aac.mod` at minus the shield's AC, and `system.aac.value` reads
   as it did without the shield. Add `weaponShield` to the styles flag:
   the advisory and the change go, and the value climbs by the shield's AC.
   Add a Specialization marker (`styleProficient` = `weaponShield:spec`):
   one more. The same character with the sword alone stays one-handed
   (`wieldTwoHanded` false, `activeStyle` single); add `twoHanded` to the
   flag and the auto grip widens.
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

### Steps

1. Open each fixture's sheet. *Observable:* no console error; weapon/armour
   show Rolls · Durability · Effects · Details; Backpack, Torch, Flask, coin
   are SIMPLE (no tab strip, a Details button); the band holds the name, Value
   and St; the left rail shows the type glyph and the slot cell.
2. Band: edit the name; type `1` in St; type `12` in Value. *Observable:*
   `item.name`, `system.weight6 === 6`, `system.cost === 12` and the Details
   ledger's listed line reads 12; on a silvered or masterwork item the write
   lands on the pristine layer's cost, `system.cost` is recomputed from it,
   and the worth the layers make of it reads beside the field. Set the value mode to Unknown in Details:
   the band's field gives way to the *Unknown* reading. Close button closes;
   dragging the band's empty area moves the window and clicking into the
   name does not.
3. Rolls: pin a row, click Roll. *Observable:* `flags.acks-extras.pins`
   updates; core's attack dialog/card appears.
4. Editor rail: description editor (save → `system.description`, editor
   closes), art (FilePicker), tags ("Masterwork" → `system.tags` and a tag
   under the prose), ownership only on the world item.
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

## Teardown

Delete the character, its items and the variation item. Confirm no fixture
items remain in `game.items`.


## The mounted overlay (added with its first release)

Fixtures: a disposable character "QA Rider" (no abilities), a second "QA
Lancer" holding ability items named "Riding" and "Mounted Combat", a
disposable animal "QA Steed" (give it an Item named "Military Saddle" for
step 3's second half), and a disposable land vehicle with carriage set to
each value in turn for step 4. Enable the "Overlay: mounted saves" setting.

1. Mount QA Rider on QA Steed (`acksExtras.lib.mount.mountActor`) and make
   an attack roll with the rider (any target).
   *Observable:* a whispered "save to stay mounted" prompt reaches the GM
   and the rider's owner, naming the attack reason. An attack BY the steed
   prompts the same rider. Repeat with QA Lancer riding: no prompt — either
   proficiency waives it.
2. Damage either half of the pair (lower the steed's hp).
   *Observable:* with no military saddle, the prompt names the damage
   reason; with the saddle item on the steed (or the lancer's two
   proficiencies), silence. The damage prompt is spoken by the PRIMARY GM's
   client (`game.users.activeGM`) — if your seat is not it, assert
   `damageSaveDue`'s four cells directly instead of waiting on a whisper.
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

Teardown: delete the item, the container and the character; confirm nothing
named for the fixture remains.

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
9. **The controls are real.** Render the item sheet, then dispatch a genuine
   `click` on the `Two-handed` chip and a `change` on the Weapon type bucket.
   *Observable:* `getFlag("acks-extras", "grips")` is `"2h"` and `profileKey`
   is what was picked — **re-read from `fromUuid` afterwards**, not from the
   open sheet's document. These controls live inside core's `<form>` and an
   un-stopped change re-renders the sheet from ITS form data; a check that
   reads the in-memory document cannot tell a persisted write from one that is
   about to be thrown away.

### Teardown

Sweep by the run's own uuids (`api.create` records them; `api.track` the four
items after they are made). Quote the sweep result.
