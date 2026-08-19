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
8. Every shipped macro compiles.
   *Observable:* each `macro.command` parses when compiled as an **async**
   function. Compiling as a plain `Function`, or with Foundry's injected
   parameter names bound, reports syntax errors that belong to the harness.

## Teardown

Delete the character, its items and the variation item. Confirm no fixture
items remain in `game.items`.
