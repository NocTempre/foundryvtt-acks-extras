# Location — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

## Fixtures

- A disposable `acks-extras.location` actor.
- A disposable `character` to store goods and coin in it.

## Core drive mechanics (non-obvious, learned live)

- **A location starts with no market, and most of its sheet with it.** A fresh
  location shows only Contents / Storage / GM Settings / GM View. Pressing
  **Add a market** (`data-action="addMarket"`) is what raises the Recruitment,
  Henchmen, Mercenaries, Specialists and Trade tabs — so any henchmen or
  markets check against a location has to add the market first or its tabs are
  simply absent, which reads as the feature being broken.
- The market subtree is `system.market`, and it holds far more than goods:
  postings, candidates, slander, the search ledger and the market log all live
  there. It goes away with the location, which is what makes a location a
  clean disposable fixture.
- `openStorageManager()` and `openRuledataBrowser()` take **no arguments** —
  they are world-wide GM tools, reachable from the settings menus as well.
- A location is a storage **provider** (`lib.storage.isProvider`) as soon as it
  exists; nothing has to be enabled for goods to be stashable in it.
- Coin stored in a location belongs to `HOUSE_OWNER` unless stamped with an
  `ownerUuid`, and that sentinel is deliberately unresolvable — no character
  can claim house coin.

## Steps

1. Create the location and open it.
   *Observable:* `LocationSheet`, with Contents (0) and Storage (0).
2. Press **Add a market**.
   *Observable:* Market class and search fee appear; the Recruitment,
   Henchmen, Mercenaries, Specialists and Trade tabs appear, Trade carrying
   the shipped catalogue's row count.
3. Storage: stash an item and coin from the character (see
   [../lib/TESTING.md](../lib/TESTING.md) for the argument order), then
   retrieve them.
   *Observable:* Contents and Storage counts move; `storedItems(location)`
   tracks the item; house coin and the character's own stored coin are
   attributed separately.
4. `openStorageManager()`.
   *Observable:* `StorageManager` lists this location as a place, offers
   "let an actor hold goods" and "give a character a vault", and each control
   changes what `providers()` returns.
5. `openRuledataBrowser()`.
   *Observable:* `RuledataBrowser` lists the tables imported from the GM's own
   books — and says so; with nothing imported it is empty rather than showing
   shipped samples.
6. Vault sweep: `runVaultSweep()` with the prune setting on and a location
   holding goods past its window.
   *Observable:* the sweep reports what it would take before taking it, and
   turning the setting off stops it.
7. "Recover Coin from Unloadable Locations (GM)": build a pre-upgrade shape
   first — recover an old sub-type's location definition from git
   (`git show <tag>:<path>`) and create it as a world document — then run the
   macro.
   *Observable:* the coin inside the unopenable actor is listed and minted
   onto the chosen actor exactly once; the location itself is left untouched.
   Running it twice mints twice, which is the documented behaviour and worth
   confirming rather than discovering.

## Teardown

Delete the location and the character. Confirm nothing the storage steps
created survives — `game.items` holds no fixture goods, and `providers()` no
longer lists the location.
