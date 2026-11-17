# Treasure — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`. Offline coverage
is `tools/test-treasure.mjs` (pure rules) and `tools/test-treasure-relay.mjs`
(the relay's guards). Neither proves a window opens or a Card writes; only this
walk does. No live walk script exists yet; the steps are driven by hand or with
the capture driver.

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
- `treasure/coin` — a `money` Item with a quantity and a copper value, for the coin
  card.
- A pot is **not** a kept fixture: it is made by the step that builds it
  (`acksExtras.treasure.newPot()`), carries `flags.world.fixture =
  "treasure/pot"`, and is deleted by the close step. A pot left behind is
  tracked and swept.

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
3. **Take** the coin onto `treasure/player-character`. Observables: the actor
   holds the coin row at the card's count; the card reads "To <name>" and has no
   Take button; the doorway is unchanged except the haul.
4. **Take** the masked item. Observables: the actor holds an item named "Plain
   thing" whose `markets.detected` is `false`, magical and still disguised; the
   Player's item sheet shows no magic, as the equipment feature's recipe
   requires.

## Refusals

- **Take onto an unowned actor.** From the Player seat, call the relay with the
  Judge's own character as the target
  (the sheet offers only the seat's own characters, so the request is sent by
  hand: `socketlib` `executeAsGM("treasurePot", {potId, op: "claim", cardId,
  actorUuid})`). Observable: `{ok: false, reason: "notOwner"}`; the actor gains
  nothing and the Card is unmarked.
- **A planted Card.** As the Judge, create a Card in the pile with a turned face
  and the card flag copied from a real one, and leave `order` alone. Observables:
  the window does not list it; a flip or Take request for its id is refused
  `notInPot`; the doorway's count does not change.
- **A closed or staging pot** refuses a flip with `phase`.

## Close (Judge seat)

1. Leave one card unclaimed. **Close the pot** and choose a place that keeps
   goods (a storage provider) as "Put what is left at".
2. Observables: the leftover card's goods are at the place (an item stamped for
   the house, or the coin row credited there); the chat card is rewritten as
   the record, listing every card as taken or left behind and no longer has an
   Open button; the pile is gone from the Cards directory; **no** "pot deleted" or
   other Cards chat message appears.

## Teardown

`api.sweepTracked()` and the quoted result (removed / could not find /
refused). The fixtures with markers stay; the pot, its chat card and anything
the claims built on the character were created by this run and are tracked by
their ids as they are made: the claimed items by the ids read back from the
actor, the chat cards by the message ids in the pile flag.
