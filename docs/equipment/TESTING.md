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
  then looks like a silent failure.
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
3. Proficiency enforcement: set the enforcement setting to its strict mode and
   attack with a weapon the character is not proficient in.
   *Observable:* the violation is reported, and the setting genuinely gates it
   — flip the setting off and the same attack passes.
4. Containers: declare capacity on the sack, `storeIn` the weapon, then
   `takeOut`.
   *Observable:* `contentsOf(sack)` lists it, `encumbranceDelta6` changes, and
   `overCapacity` fires when the declared capacity is exceeded.
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
8. Training row: open a fresh character's Inventory tab, then grant training
   the way a class apply does — an Active Effect whose changes set
   `flags.acks-extras.weaponProf` (CSV), `.armourProficiency` (category) and
   `.styleProficient` (CSV) — and re-render.
   *Observable:* `.acks-equipment-training` sits between the encumbrance
   panel and Worn & Wielded; with no profile every pill is grey (`unset`),
   after the grant the covered weapon chips, the armour ladder up to the
   granted rung, and the trained styles light (`on`), and the row appears
   once however many render hooks fire.
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
2. Band: edit the name; type `1` in St. *Observable:* `item.name`,
   `system.weight6 === 6`. Close button closes; dragging the band's empty area
   moves the window and clicking into the name does not.
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
