# Magic items — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.
`tools/live/magic-items.mjs` walks steps 1 to 10 on the GM seat and a real
Player seat, then rolls once from the world's own import where one stands.

The surface is the roller window, the Judges-only card it posts and the entry
point both go through (`acksExtras.magicItems.openRoller`, `rollAndPost`). The
offline suites that pin the logic are `tools/test-magic-item-chain.mjs`,
`tools/test-magic-item-roll.mjs` and `tools/test-magic-item-card.mjs`; none of
them renders a window or posts a message.

## Fixtures

The feature makes no world document but its chat cards, and reads one registry
document. A walk drives it from an invented copy of that document, registered
in the client, so a seat's real import is neither needed nor touched.

- **The invented `magicItemTables` layer, `magic-items/tables`.** Registered at
  priority 25, above a world import (20) and below a Judge's override (30), so
  it wins per table without reading as an override:
  `acksExtras.lib.tables.registerTable({id: "magicItemTables", tables, source:
  "magic-items/tables"}, {priority: 25})`. A client-side layer has no document
  and no marker; the teardown line below removes it. `tables` holds, every name
  and page invented:
  - `classicType.bands`: one band `1-6`, `item` "Zq Kk", `hop` `classic.kk`.
  - `classic.kk`: one band `1-10`, `item` "Xx ten". `classic.tt`: bands `1-3`
    ("Xx low") and `4-6` carrying `sub` `[{min: 1, max: 2, item: "Xx tail a"},
    {min: 3, max: 3, item: "Xx tail b"}]`. A tail's die is the top of its own
    inner bands, so this one is a 1d3.
  - `heroic.rr` and `heroic.ss`: one band `1-100` each, `item` "Hh one" and
    "Hh two".
  - `captions`: a caption for each list id (`classicType.bands`, `classic.kk`,
    `classic.tt`, `heroic.rr`, `heroic.ss`); `listCites`: "ZZ p.1" and so on.
  A single band over the whole die makes a roll on it deterministic without
  rigging the dice; only the tail (step 4) needs a roller.
- **Cards.** Each card a walk posts is tracked by the id `rollAndPost` answers
  (`result.message.id`, `api.track(id, "ChatMessage")`), or, for a card the
  window posted, by the newest message of the run's minute whose content holds
  the invented item text. Never swept by a create-hook ledger.
- **Seats.** The GM seat and a real Player seat (`live-testing.md`): a GM seat
  cannot prove a gate meant for a player.

## Core drive mechanics

- **The window is found by its class.** `openRoller()` resolves when the window
  closes, so a walk starts it without `await`, finds
  `.acks-extras-magicitems-roller`, and drives the controls the way a user does:
  set a `select`'s value, dispatch `change` on it, then click the dialog's
  `button[data-action="roll"]`. Setting `value` alone does not fire the picker
  that switches the other off.
- **A disabled control is read by `disabled`, not by its value.** The category
  picker is off under Heroic and Gritty, the rarity picker under Classic.
- **The card is whispered, and its dice are in its content.** Assert
  `message.whisper` is exactly the GM ids and `message.rolls` is empty; Foundry
  would otherwise show the other seats a "privately rolled" line.
- **A tooltip is `data-tooltip-text` on the Total cell.** It is read off the
  DOM of the rendered card, `.acks-extras-roll-card td[data-tooltip-text]`.

## Steps

1. Register the invented layer. `acksExtras.magicItems.starts()`.
   *Observable:* `classicType` names `classicType.bands`; `classic` lists `kk` and
   `tt` by their captions; `heroic` lists `rr` and `ss`.
2. `openRoller()` on the GM seat.
   *Observable:* a window titled "Roll a Magic Item" with three labelled
   selects, each label above its control, and the whisper hint. Style offers
   Classic, Heroic, Gritty. Category opens on "Roll the type", then each classic
   list by its caption. Rarity lists the heroic captions. Rarity is disabled
   while Style is Classic. Switch Style to Heroic: Category is disabled and
   Rarity enabled; back to Classic reverses it. The window resizes by its
   corner and scrolls when shrunk; the frame carries `acks-extras-scroll`.
3. Press Roll on Classic with "Roll the type".
   *Observable:* one card, titled "Magic Item", subtitle "Classic": a row for
   the type list (its caption, `1d6 = n`, "Zq Kk" beneath) and a row for the
   hopped list (`1d10 = n`, "Xx ten" beneath), then an "Item" strip reading
   "Xx ten". Each total's tooltip is `Die 1d6 · Band 1–6 · ZZ p.1` (the die,
   the band, the list's own page). `message.whisper` is the GM ids and
   `message.rolls` is empty. No seat but a GM's shows the card.
4. `rollAndPost({style: "classic", category: "tt", roller})` with a roller that
   throws a 5 on the 1d6 and a 2 on the 1d3.
   *Observable:* one row whose roll reads `5 › 2`, "Xx tail a" beneath, and a
   tooltip `Die 1d6 › 1d3 · Band 4–6 › 1–2 · <page>`. The asserted die strings
   are read off the call the roller received.
5. Press Roll on Heroic with each rarity, then on Gritty.
   *Observable:* one row each, headed by the rarity's caption, the subtitle
   naming the style; Gritty reads the same two lists as Heroic.
6. Register an override layer at priority 30 holding `heroic` alone (a copy of
   the invented one), then Roll on Heroic.
   *Observable:* the heroic row's tooltip ends "Set by hand" and carries no
   page. The classic rows keep their pages. Unregister the layer.
7. Open `openRoller({tables: {}})`.
   *Observable:* a warning that no magic-item tables are imported, naming what
   is still to import, with no window. Also `rollAndPost({tables: null})`: the
   same warning, `message` null, no card posted.
8. On the Player seat: `openRoller()` and `rollAndPost({style: "heroic", rarity:
   "rr"})`.
   *Observable:* each warns that only a GM can roll a magic item; no window
   opens and no message is created.
9. Cancel the window.
   *Observable:* nothing posted; the promise resolves `false`.
10. The contract: `acksExtras.lib.services.get("magic-item-roll").roll({style:
    "heroic", rarity: "rr"})` answers `ok` with one step and `item.uuid`
    null.
    *Observable:* a result and no card, since only `rollAndPost` posts.

Not covered by an offline suite, and so to be looked at: how the labels sit
above their controls, the disabled option text, the card in the chat log's dark
and light themes, and the type-size knob on the window and the card.

## Teardown

`acksExtras.lib.tables.unregisterTable("magicItemTables", {priority: 25})` and,
for step 6, `{priority: 30}`. Delete the cards by the ids the run tracked
(`api.sweepTracked()`), and report its removed / could-not-find / refused
object. The feature creates nothing else.

## A rolled row names its imported item (the Tome's entries)

### Fixtures

The Tome connected, its magic items imported (importer recipe step 1), and the
rules tables imported with the Tome open (step 5). Nothing is built here.

### Steps

1. `acksExtras.magicItems.roll({from: "subtables.potions4", roller})`, with a
   roller returning a total on a row that names an imported entry.
   *Observable:* `item.ref` is `tt.item<n>` and `item.uuid` resolves with
   `fromUuid` to that item.
2. The same roll on a row with no entry. *Observable:* `item.ref` and `item.uuid`
   are null, and `ok` is true.
3. With the `cookbook-items` service absent (a world where the importer is
   disabled), the roll of step 1. *Observable:* `ok` true, `uuid` null.
4. Open the roller's chat card for step 1's roll. *Observable:* the card is as
   before; it draws no link (the card's link waits on its design).

### Teardown

None; nothing is created.
