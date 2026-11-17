# Treasure — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`. Offline coverage
is `tools/test-treasure.mjs` (pure rules) and `tools/test-treasure-relay.mjs`
(the relay's guards). Neither proves a window opens or a Card writes; only this
walk does. `tools/live/treasure.mjs` drives every section below on both seats
(`node tools/live/run.mjs treasure`); its header says which gestures are real
pointer presses and which are scripted, and what it does not reach.

`styles/treasure.css` is a `module.json` `styles` entry, which the server reads
at world launch: **after the first install of this slice, relaunch the world**,
not just F5.

## Fixtures

Found again by `flags.world.fixture`, built through `api.fixture(marker, kind,
data)`; a run's own documents are tracked with `api.create` / `api.track` and
swept with `api.sweepTracked()`.

- `treasure/player-character` — a `character` actor owned by the Player seat
  (OWNER for that user, nobody else).
- `treasure/item-masked` — an Item the pot's item card is made from: a physical
  item that is magical (`flags.acks-extras.markets.magic: true`), undetected
  (`markets.detected: false`), identification `none`, and disguised as a plain
  item (`flags.acks-extras.disguise` = `{true: {name, …}, apparent: {name: "Plain
  thing", img}}`, as the equipment sheet's disguise writes it).
- `treasure/coin` — a `money` Item with an invented name, a quantity and a copper
  value, for the coin card. Its name is not any coin the system ships, so a
  Take makes its own row on the character instead of folding into one.
- `treasure/judge-character` — a `character` actor the Player seat does not own
  (the target of the not-owner refusal).
- `treasure/place` — a location actor with `flags.acks-extras.storage.provider:
  true`, the place the close files leftovers at.
- A pot is **not** a kept fixture: it is made by the step that builds it (the
  scene control's tool, which calls `acksExtras.treasure.newPot()`), is marked
  `flags.world.fixture = "treasure/pot"` by the run (`newPot` sets none; the
  run retires a standing one first, since a marker names one document), and is
  deleted by the close step. A pot left behind is tracked and swept.

## Judge seat (Gamemaster)

1. **Scene controls → Token controls → New treasure pot.** Observable: a window
   titled "Treasure" opens in staging with "Source: By hand", the Judge / Table
   toggle, "Open to the table" and two buckets, Add and Replace, beneath an
   empty grid. The Cards directory lists the pile. The pile's flag reads
   `phase: "staging"`, `order: []`.
2. **Drop** `treasure/item-masked`, `treasure/coin` onto the grid, and a second
   copy of the item into the Add bucket and another into Replace. Observables:
   the grid shows the item and coin cards, each with its Judge face (the item
   with "Shown as Plain thing"); the buckets list their items; `order` lists the
   two grid cards only and `buckets.add` / `buckets.replace` one id each; every
   pile card is `face: null`. The pot value reads the coin's worth.
3. **Add a value card** (a gem, a name, a gp figure). Observable: a gem-pool
   card joins the grid; the pot value rises by that figure.
4. **Mode:** press Table, then Judge. Observable: `pot.mode` follows; the hint
   changes.
5. **Open to the table.** Observables: phase `open`; `order` now holds the
   replace card and the add card as well, the add card at a position that
   varies between runs; both buckets empty; the pile's ownership is LIMITED
   for each non-Judge user and the Judge's own is unchanged; one chat card,
   "Treasure on the table", shows "0 of N turned".

## Player seat

1. **The doorway.** On the chat card, **Open the table**. Observable: the window
   opens (LIMITED is enough to render it); every card is face down, a button
   whose accessible name reads pool, band and "face down"; the masked item's
   card reads "Item", never "Magic"; the card's tooltip is the pool's name and
   its page reference only.
2. **Flip** the masked item card. Observables: it shows "Plain thing", "Worth
   unknown" and no Aura tag; the doorway's count reads "1 of N turned"; the
   Card's `face` is 0 and `faces[0].name` is the mask; nothing but that one
   Card was written. Flip the coin card: the haul so far shows its worth and
   its tooltip names the coin part and the page.
3. **Take** the coin onto `treasure/player-character`. The Player seat owns other
   characters, so Take asks which one: the pick offers only characters the seat
   owns. Observables: the actor holds the coin at the card's count; the card
   reads "To <name>" and has no Take button; the doorway is unchanged (a claim
   turns nothing, and a claimed card still counts in the haul so far).
4. **Take** the masked item. Observables: the actor holds an item named "Plain
   thing" whose `markets.detected` is `false`, magical and still disguised; the
   Player's item sheet shows no magic, as the equipment feature's recipe
   requires.

## Refusals

- **Take onto an unowned actor.** From the Player seat, call the relay with
  `treasure/judge-character` as the target, on a card that is turned and not yet
  taken (the sheet offers only the seat's own characters, so the request is sent
  by hand: `executeAsGM("treasurePot", {potId, op: "claim", cardId, actorUuid})`
  from `lib/sockets.mjs`). Observable: `{ok: false, reason: "notOwner"}`; the
  actor gains nothing and the Card is unmarked. The same call for a face-down
  card answers `faceDown`, since the card is judged before the target.
- **A planted Card.** After Open, as the Judge, create a Card in the pile with a
  turned face and the card flag copied from a real one, and leave `order` alone.
  Observables: neither seat's window lists it; a flip or Take request for its id
  is refused `notInPot`; the doorway's count does not change.
- **A staging pot** refuses a flip with `phase`, asked for from the Player seat
  before Open. **A closed pot is deleted**, so a request after the close answers
  `noPot`; `phase` is not reachable on a closed pot.

## Close (Judge seat)

1. Leave cards unclaimed. **Close the pot** and choose `treasure/place` as "Put
   what is left at".
2. Observables: each leftover card's goods are at the place (items stamped for
   the house, and the value card's coin credited there to the copper); the chat
   card is rewritten as the record, listing every card, the taken ones "to" the
   character and the filed ones "to" the place (a card is "left behind" only
   when no place is chosen), and no longer has an Open the table button; the
   pile is gone from the Cards directory and from both seats; **no** "pot deleted"
   or other chat message is created by the delete.

## Window contract

On both seats the pot's window has the resize corner and its part root scrolls
(computed `overflow-y` auto); shrunk to a small window, the content scrolls
inside the frame (scrollHeight beyond clientHeight, a scroll that moves) and is
not cut off.

## Teardown

`api.sweepTracked({only})` over the run's own ids and the quoted result
(removed / could not find / refused). The fixtures with markers stay; the pot,
its chat card, the planted Card and the rows the claims and the close built on
the character and the place were created by this run and are tracked by their
ids as they are made: the rows by the ids read back from the actor and the
place, the chat card by the message id in the pile flag.
