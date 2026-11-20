# Treasure — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`. Offline coverage
is `tools/test-treasure.mjs` (pure rules) and `tools/test-treasure-relay.mjs`
(the relay's guards). Neither proves a window opens or a Card writes; only this
walk does. `tools/live/treasure.mjs` drives the sections from Fixtures through
Teardown on both seats (`node tools/live/run.mjs treasure`); each later section
names its own walk. A walk's header says which gestures are real pointer
presses and which are scripted, and what it does not reach.

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
- `treasure/party` — the world's only formation (`services.get("party-roster")
  .list()` answers one entry), holding `treasure/player-character`,
  `treasure/judge-character` and a third `character` actor, `treasure/ally`
  (owned by the Judge), each with an encumbrance maximum and movement on
  automatic, so the roster answers a pace for each. Build it as the formation
  recipe does (docs/formation/TESTING.md): tokens of the three on a scene, then
  the party window's add to party. The pot reads it as its party with no
  `partyId` set. `treasure/party-b` is a second formation, built only for the
  no-party step, since two parties and an unset `partyId` is how a pot has none.
- A pot is **not** a kept fixture: it is made by the step that builds it (the
  scene control's tool with no token selected, which calls
  `acksExtras.treasure.newDealPot()` and opens By hand), is marked
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

## Party aside, drag and Quick grab (both seats)

Walked by `tools/live/treasure-party.mjs` (`node tools/live/run.mjs
treasure-party`), steps 1 to 7: steps 1 to 5 and 7 on the Player seat, step 6
on the Judge seat.

Fixtures: `treasure/party`, the three members, `treasure/coin`, and
`treasure/item-masked` (see above). Build a pot with: a coin card whose stack
weighs about a third of a member's room (set the coin item's count so), two item
cards of invented weights that together fill most of `treasure/player-character`'s
room, a card heavier than any member's room, and a card left face down. Open it,
turn all but the face-down one. Read each member's speed and load first through
`services.get("party-roster").pace(partyId, actorId)` and `load6`/`capacity6`
(lib), so every observable below is compared with the world's own figure, not
the window's.

1. **The aside (Player seat).** Observables: one zone per member showing name,
   speed, a load bar and "load of capacity · items"; the speed and load tooltips
   name their parts and the page; "Party moves" equals the slowest member's
   `roster.pace(...).speed`; no leftover line; **Quick grab** has its one-line
   hint. With `treasure/party-b` present and the pot's `partyId` unset, the aside
   is the one line "No party is set for this pot." and nothing else; delete
   `party-b` after.
2. **Drag to a character sheet (Player seat).** Open `treasure/player-character`'s
   sheet beside the pot and drag a turned item card onto the sheet. Scripted, a
   `drop` event whose `dataTransfer` holds `{"type":"Card","uuid":<card uuid>}`,
   dispatched at the sheet's content. Observables: the actor holds the item; the
   card reads "To <name>" and no longer drags (`draggable` absent); no console
   error; the item landed once.
3. **Drop on a member zone (Player seat).** Drag a turned card to
   `treasure/player-character`'s zone. Observables: the card is claimed by that
   character; the zone's load figure and bar rise by the card's weight and its
   speed re-reads from `roster.pace`.
4. **Refusal, unowned target (Player seat).** Drag a turned card to
   `treasure/judge-character`'s zone. Observables: a notification "You do not own
   that character."; the Card is unclaimed; the actor gains nothing. Then drag a
   card onto `treasure/judge-character`'s sheet if the seat can open it. Whether
   core fires the hook for a sheet the seat cannot edit is not known offline:
   record what the sheet does (the same notification, or nothing).
4b. **Quick grab needs a member the seat owns (Player seat).** As the Judge, set
   the Player user's ownership of `treasure/player-character` to none, then
   re-render the Player's pot window. Observables: the aside has no **Quick
   grab** button (the pace line stays); the seat's scripted grab
   (`executeAsGM("treasurePot", {potId, op: "grab"})`) answers `{ok: false,
   reason: "notAllowed"}` and nothing is claimed. Give ownership back (Owner)
   and re-render: the button is back. A step that needs the seat to own its
   character asserts that ownership at its start.
5. **Quick grab (Player seat), the predicted pace.** From the figures read before
   the step, work out the slowest speed the party could keep with everything
   placed (try each member's load with the whole of each card added; the planner
   chose the best split). Press **Quick grab** once. Observables: the
   notification reads "Quick grab: N taken. The party moves X ft."; once it
   lands, every member's `roster.pace(...).speed` is no lower than X, the slowest
   equals X, and "Party moves" shows X; each member's load is within its
   capacity; the coin card became several turned cards, each "To <name>", whose
   counts plus the card still in the pot sum to the original stack; the card
   heavier than any member's room stays turned and unclaimed, the notification
   warns that it fits nobody, and the leftover line names it with the tooltip
   "heavier than any member can bear"; the face-down card is untouched. The
   Player seat owns one member and the rest received goods: that is the ruled
   behaviour. Press twice quickly: the second answers "That is already being
   done." or finds nothing left.
6. **Quick grab (Judge seat).** A party of its own, so the main party stays as
   steps 1 to 5 left it: `treasure/grab-hand`, `treasure/grab-full`,
   `treasure/grab-down` (characters) and `treasure/grab-cart` (a vehicle, whose
   sheet keeps no goods), in a formation record found by name. Assert the start
   shape first: the hand and the full member standing, the down member at 0 hit
   points, and the full member's ballast row (an item on it carrying the marker
   `treasure/grab-ballast`) re-weighed so its room is less than either weight
   card. On a second pot of the coin, both weights and the small card, all
   turned by the Judge, press Quick grab in the Judge's own window.
   Observables: the aside marks the down member "Down: takes no share of a
   grab" and the cart "Carries no goods"; the full member takes less than the
   hand and no more than its room; the down member and the cart take nothing,
   and one notification names both with their reasons ("Takes nothing: …
   (down), … (no sheet that carries goods)").
7. **Narrow window.** Shrink the pot's window below about 46em wide. Observables:
   the aside sits below the pot grid, every zone and the button are reachable by
   scrolling the part root, and the window keeps its resize corner.

Teardown: the pot is closed or deleted by the Judge's close step; the actors'
added items and coin rows are tracked by the ids read back from each actor and
swept with `api.sweepTracked()`; `treasure/party-b` (built for step 1 only) is
tracked and swept; the fixtures with markers stay, and their loads are reset
by a step that needs a known shape (assert it at the step's start).

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

## Search the fallen (Judge seat, a real fight)

Offline coverage is `tools/test-treasure-search.mjs` (who is fallen, the record,
who owes a take-off). The hooks and the card are walked by
`tools/live/treasure-search.mjs` (`node tools/live/run.mjs treasure-search`), which
runs the whole of scene-search TESTING, "S5 — the ways in": the fight, the card
and its button, what the button opens, and the take-off through the scene's pot.
Fixtures, steps and observables are stated there once and are not repeated here.

What this surface adds to that recipe:

- **The card (hook and render).** A real End Combat on the Combat tracker fires
  `deleteCombat` on the primary Judge's client, which posts the "The fight is
  over" card to the Judges. Observables: it lists each defeated hostile body with
  its carried-item count, its letter and a table mark where one is linked; a
  defeated friend and the party's own token are not listed; the Player seat holds
  the message in its collection and neither sees nor renders it. A second Judge
  seat sees it once (not walked: the walk has one Judge seat).
- **The take-off** (changed 2026-11-19, walked 2026-11-19, treasure-search 130212). A pot whose origin asks
  for it takes a good off its body when that good's lot is found, from the Judge's
  client that resolved the check; opening the pot takes nothing. Observables: the
  pot's `origin.takeOff` true and `origin.taken` empty after the open; each
  `origin.carried` entry names a goods card; the card's lot found, its card is in
  `origin.taken` and the item it points at is gone from its body, while the
  other goods stay; a body's natural weapon never leaves it and never becomes a
  card.
- **A linked table** is drawn quietly, once per card: no chat message of a table
  draw, an item result becomes a lot (its world item stays in the world), a text
  result is listed on the card. A second press reuses the draw.

### Teardown

`api.sweepTracked({only})` over the run's own ids (the tokens, the combats, the
chat cards, the pots, the declaration card), the session ended through
`acksExtras.sceneSearch.end` and the party token put back. The marked
fixtures stay.

## Bands, backs, faces and deal toggles (both seats)

Walked by `tools/live/treasure-faces.mjs` (`node tools/live/run.mjs
treasure-faces`), which covers steps 1 to 5 and the layer half of step 7 (the
texture layers by band, the reader wired and put back); its header lists what
it does not reach. Offline coverage is `tools/test-treasure.mjs`'s R2 blocks.

**Fixtures** (found by marker, built through `api.fixture`):

- `treasure/item-plain` — a physical item with invented name and `system.cost`
  of 5, not magical.
- `treasure/item-masked-cheap` — `treasure/item-masked` with the disguise's
  apparent `cost` set to 5 and a true `system.cost` of 5000, so the mask and the
  truth fall in different bands.
- `treasure/item-detected` — a magical item marked detected, identification `none`.
- `treasure/item-identified` — a magical item marked detected, identification
  `full`, with `markets.cursed: true` and `curseKnown: true`.
- `treasure/coin` and an expensive plain item (cost 500) to fill the top band.
  Together with the above, at least four distinct worths.

**Steps** (a fresh pot per run, as the Judge seat above builds one):

1. **Bands and pips.** Drop the fixtures. Observables: each Judge tile shows a
   band swatch and a row of pips (one to four marks) that agree with the legend
   (Low, Middling, High, Highest), and the lowest-worth card is band Low. Tiles
   hold the staging preview; every Card's `value` is still 0 in the pile.
2. **Frozen at open.** Open to the table. Observable: every Card's `value` is
   now its band; change a source item's cost in the world and reopen the window:
   no card's band changes.
3. **An undetected card's back matches a plain card's (Player seat).** The
   masked fixture (mask cost 5) and the plain item (cost 5) sit face down. Observable: same
   icon, same label, same colour, same pips, same accessible name
   ("Item card, <band> band, face down; turn it over"), same tooltip. Only the
   detected fixture's back wears a different icon (the aura), with its accessible
   name adding that an aura was detected. Read the pile's own Card data as the
   Player: `back.img` and `suit` of the masked and the plain card are equal.
4. **Faces after identification and curse (Player seat).** Turn the masked,
   detected and identified fixtures. Observables: the masked card's face is
   plain; the detected one's is plain with the Aura tag; the identified one's
   face is cursed-coloured with "Cursed" as its tag, because its curse is known.
   Clear `curseKnown` on the item before the deal and repeat: the face turns
   the magic colour and not the cursed one. On the **Judge seat** every
   magical tile wears the magic colour and a cursed one the cursed colour,
   face down or up.
5. **Toggles (Judge seat, staging).** The panel stands to the right of the pot
   and drops below it when the window is narrow (drag the frame narrower than
   about 46 type units). Each button reads `aria-pressed`, and the keyboard
   reaches both.
   - **No magic** on, then Open: observables: every magic card (the masked one,
     seeds included) is gone from the pot and from the pile; tiles it was to
     strike said "Removed when the pot opens" beforehand; one whisper to the
     Judge only, "deal toggles", names them; the Player seat sees no whisper.
     A pot of magic cards only refuses to open ("The deal toggles would leave
     nothing in the pot").
   - **Force cursed** on, then Open, as the Player seat takes a magic card: the
     item that lands on the character has `markets.cursed` true and
     `curseKnown` not true, and the sheet shows no curse to the player. A card
     identified in full (`treasure/item-identified-unknown`: full, cursed, the
     curse not known) in the same pot reads `curseKnown` true in the pile's
     snapshot after Open, and the item it lands as carries `curseKnown` true.
   - Both on: no magic card remains; the whisper's second row says "none".
6. **Narrow and keyboard.** At a narrow width the grid, the toggles and the
   bucket panels reflow and the part root scrolls; every toggle and card button is
   reached by Tab and named; `prefers-reduced-motion` turns off the turn's
   brightness beat and the face's colour transition.

7. **Dress and pictures (both seats).** With the step 1 pot open: lozenge
   corners from the third band, breaks at the top, and the detected card's frame
   gold. With no texture imported, no back or face carries a grime, foil or
   vignette layer (none of `.acks-extras-treasure-grime`, `-foil`, `-vignette`
   in the window). Wire a reader from the console, through the loaded module's
   own URL so it is the same instance:
   `(await import("/modules/acks-extras/scripts/treasure/card-art.mjs")).setArtReader(({side}) => side === "texture" ? "<a world raster>" : null)`,
   then re-render the window: the lowest
   band's back carries the grimiest layer and the highest none, the top band a
   foil. The undetected masked card's back matches the plain card's in frame,
   corners and layers as well as in icon. Turn a card whose item has a world raster
   picture: the face shows it in a framed slot; an item with only a core icon
   shows the lozenge. Give `treasure/item-masked` a disguise with a name and no
   picture: the Judge tile shows "Undetected, and its disguise has no picture, …",
   and on the Player seat the turned face and the pile's Card `faces[0].img`
   show the pool icon, never the item's own picture. The header reads "In the
   pot: {n}" in staging and "You found {n} items" once open.

**Teardown:** the run's own pots and whispers are tracked and swept; the kept
fixtures stay.

## Replace seeds at open (both seats)

Walked by `tools/live/treasure-seeds.mjs` (`node tools/live/run.mjs
treasure-seeds`), steps 1 to 7, and every pot's doorway pressed once on the
Player seat, with five more one-lot pots for that press alone. Offline coverage
is `tools/test-treasure.mjs`'s T3 blocks (the planner and `planOpen`); nothing
offline renders the window or writes a Card.

**Fixtures** (found by marker, built through `api.fixture`):

- `treasure/lot-high`, `treasure/lot-mid`, `treasure/lot-low` — coin cards
  (`money` items at 100 cp a coin) worth 400, 150 and 100 gp, so their worths
  show. A plain item's worth never shows on the pot (`worthOf` answers only a
  coin or a value card), so a plain-item lot leaves the pot value blank. A coin
  card's true name carries its count ("400 …"); the plan's row, the tile and the
  audit use that name.
- `treasure/lot-plain` — a plain item costing less than any lot, dropped with
  the lots in step 5 so the seed has a lot of its own pool to be compared with.
- `treasure/seed-replace` — a plain item with `system.cost` 250, dropped into
  the Replace bucket.
- `treasure/seed-replace-big` — a plain item costing 1000, for the shortfall.
- `treasure/lot-magic` — a magic item disguised (`disguiseData`) as a 150 gp
  one, for step 7.

**Steps** (a fresh pot per run; drop the three lots on the pot, the seed in the
Replace bucket):

1. **The plan shows (Judge seat, staging).** Observables: the 400 lot's tile is
   struck through and reads "Replaced by <seed>"; the seed's bucket row reads
   "Takes <lot> (150 gp over)" and its tooltip gives the seed's worth against the
   lots taken; the 150 and 100 tiles are untouched; the pot value counts the 150
   and 100 lots and not the struck one (250 gp: the plain-item seed shows no
   worth).
2. **Open, Judge deals.** Observables: the pot's `order` lists the seed where the
   400 lot stood, and not the 400 lot; the pile still holds the 400 lot's Card;
   `flags.acks-extras.treasure.replaced` is `[{seedId, struck: [<400 lot>],
   shortGp: null}]`; every listed Card's `value` is a band ranked without the
   struck lot; a whisper to the Judge only lists the seed, the lot's true name and
   the overshoot, and the Player seat sees no whisper.
3. **Open, table rolls.** Repeat step 2 on a pot whose mode is Table.
   Observable: the same plan and the same record.
4. **Struck is never delivered (Player seat).** The Player sees one card fewer
   than the lots dropped plus the seed, and none carries the struck lot's name
   or worth. As the Judge, run a `claim` for the struck lot's Card id through
   the relay: refused as not in the pot. Close the pot: the doorway record lists
   no struck lot, and the haul counts none.
5. **A seed cannot be told apart (Player seat).** The seed's back and
   `treasure/lot-plain`'s differ only by band: each wears exactly the dress
   `card-art.mjs` `backDress` gives its own band in that pool (the frame and the
   rich stone follow the band, so the two class lists differ between bands), under
   the same pool plate, and no seed mark reaches the Player. The seed's position in
   `order`, noted per pot over the walk, is not the tail on every pot. A coin lot
   is no comparison: its pool plate differs by design.
6. **A shortfall (Judge seat, staging).** Drop only `treasure/seed-replace-big`
   in the Replace bucket. Observables: its row reads "No lots cover it (<n> gp
   short); takes none", and no tile is struck; open: `replaced` holds
   `shortGp` and an empty `struck`, and the pot keeps every lot. Press Open on
   the Judge seat: one warning notification reads "<seed> took no lot, so the
   pot holds <worth> gp more than the table rolled", the pot opens, and the
   Player seat's notifications hold no such line.
7. **No magic first.** Add a magical lot (disguised as a 150 gp item) and turn
   No magic on. Observable: the plan ignores it and its tile says "Removed when
   the pot opens", not "Replaced by".

**Teardown:** the run's own pots and whispers are tracked and swept; the kept
fixtures stay.

## Dealing letters (Judge seat)

Walked by `tools/live/treasure-deal.mjs` (`node tools/live/run.mjs
treasure-deal`), one section per step to step 7; step 8 by
`tools/live/treasure-magic-deal.mjs`, whose census of every treasure type's
magic placeholders, counted by match outcome, is its first observable. Each
walk's header lists the gestures that are scripted and what it does not reach.
Offline coverage is `tools/test-treasure-deal.mjs` (the stored deal state, the
rows, the letters a Deal sends, the warning, the fake world's deal),
`tools/test-treasure-magic-deal.mjs` (the magic cards rolled at the deal) and
`tools/test-hoard-map.mjs`; nothing offline renders the rail, the monster
sheet's button or the token control, and nothing offline holds the item tables
or the cookbook documents a real import writes.

**Fixtures** (found by marker, built through `api.fixture`):

- `treasure/monster-lettered` — a `monster` actor whose
  `system.details.treasure.type` is a letter the world's imported treasure-type
  table holds, with two tokens of it on a scene (one linked, one unlinked).
- `treasure/monster-bare` — a `monster` actor whose treasure type is `none`,
  with one token on the same scene.
- The world's `treasure` registry must be imported (the importer's Treasure
  Tome book); without it every Deal reports "not imported", which is step 7.
  Step 8 also needs the `magicItemTables` registry document, and the cookbook
  documents for any item to be linked.

**Steps:**

1. **Selected tokens (Judge seat).** Select the three monster tokens and
   `treasure/player-character`'s token, then press Scene controls → Token controls →
   New treasure pot. Observables: a staged pot opens with two Monsters rows,
   `<name> ×2 · Type <letter>` ticked and the bare monster's row disabled with
   its no-letter reason; the character makes no row. Nothing is dealt. With the
   same tokens selected, run Compendium Packs tab → ACKS Extras Macros → Deal
   Treasure (drive: `(await game.packs.get("acks-extras.macros").getDocument("acksTreasDeal000")).execute()`).
   Observable: a second staged pot opens with the same rows.
2. **Lair warning.** With "Met in their lair" off, press Deal. Observable: the
   rail's warning callout appears naming the toggle, and the pot holds no new
   card. Press Cancel: the callout clears, still no card.
3. **Deal anyway.** Press Deal, then Deal anyway. Observables: the pot gains
   face-down cards from one hoard of the letter (one hoard for the two tokens,
   not two); a notification reports the deal; the deal toggles (No magic,
   Force cursed) are honoured.
4. **Met in their lair.** Tick it and press Deal. Observable: no callout; a
   second hoard is dealt at once. Reopen the window: the toggle, the style and
   the Special treasure tick read back as left.
5. **By hand and case.** Untick both rows, type the letter in lower case in the
   Treasure type field and press Deal at once. Observable: a hoard is dealt on
   the first press.
6. **Monster sheet.** Open `treasure/monster-lettered`'s sheet, Ecology tab.
   Observables: a Deal button beside Treasure type (Judge seat only; the
   Player seat, given Observer on the actor, sees none); on
   `treasure/monster-bare`'s sheet it is disabled. Press it: a staged pot opens
   with that one monster's row ticked and nothing dealt.
7. **Refusals.** On a pot opened to the table, the rail is gone. In a world
   with the registry unimported (or a style whose table is missing), Deal
   reports the not-imported error by lang string and nothing throws.
8. **Magic cards are rolled at the deal.** With the world's item tables
   (`magicItemTables`) imported and a letter whose magic cell names a kind the
   tables hold a list for, press Deal. Observables: the pot gains a card for
   the item rolled, not a placeholder. Its turned face wears what it passes
   for (its document's disguise, else the placeholder's name), never the item's
   name, on the Judge's reading as on a Player's, and a Player seat is shown no
   aura (undetected, unidentified, even where the linked document is identified
   in its own sheet). Where the item links to a world or compendium document the
   card claims as that document, with no identification and no curse
   known; where it links to none, the card is named for the item. A
   second Deal in the Heroic style rolls on the rarity lists instead. With No
   magic on before a Deal, the hoard deals no magic card at all; turned on
   after one, the rolled cards are struck when the pot opens. A magic cell whose
   noun names no list, two lists, or several at once (a compound: a comma, a
   semicolon or a parenthetical) leaves its card the placeholder it was and the
   deal's notice says some magic was not rolled; so does a world with no item
   tables imported. Read the rolls
   from the deal's result (`dealt[].audit`, the rows with `magic: true`); the
   deal posts no card for them (`MODEL.md`).

   **Arms and their apparent worth (T6c-2).** Re-import the Tome's item tables
   first (a world imported before this slice has rows with no `arms` link), with
   the equipment tables and the masterwork documents imported. A seat can
   re-import alone: wait for `acksExtras.importer.bookOpen("jj")` and `("tt")`
   (the shelf restore opens them after `ready`), then
   `acksExtras.importer.cookbookImportTables(["magicItemTables"])`. The links sit
   on the rows of `getTable("magicItemTables", "subtables")`; `classic`'s bands
   only hop there, so a count over `classic` finds none. The walk sets the
   pot's column by API (`setDealOption(pile, "armsSetting", "s1")`) and reads the
   pot back; a second new pot opens with it, and a blank clears it (the field in
   the window is walked below). It then rolls sixty times
   on the weapons list through the real roll service on random dice
   (`rollMagicTruths` with `armsSeam()`'s bases and tier costs), so which rows it
   reaches varies by run, and
   checks each card that stored `apparent` against the documents: `baseGp` is
   the base's own `system.cost`, `masterworkGp` is the tier's `costAdd` for the
   base's kind (a weapon's `weaponBoth`, armour's or a shield's `armorAC`), and
   `rankWorth` is their sum. With a blank column no weapons-list card stores
   figures, since each of those rows links a grid or the weapon-kind list and
   needs a type; a row linked by name is priced without one. A ring, a cloak and
   ammunition rolled by name store nothing (offline only; no live row is known
   to land on one).

   **The arms column field (T6c-3).** With the same imports, on the Judge seat
   open a staged pot (Scene controls → Token controls → New treasure pot) and
   read the rail. The pick is a scripted `change` on the select (the native list
   is an operating-system popup the page cannot press), so the write is real
   and the dropdown's own gesture is not; hover each tooltip with a real pointer.
   - *State A, a new pot.* A field "Arms and armor column" sits directly under
     Table style, its label bound to the select (`for`), the hint "Used for arms
     and armor dealt into this pot." bound by `aria-describedby`, "(none)" first
     and selected, then one option per setting column of the imported arms grids
     in the import's own labels and order. Hovering the select shows the page
     reference alone.
   - *State B, a pick.* Choose a column. Observables: the select re-renders with
     it selected; `setDealOption` stored it (`potOf(pile).deal.armsSetting`) and
     the Judge's `treasureArms` flag holds it; hovering the select shows the
     column's label and the page. Press Deal at once after the change (no click
     in between): the deal runs on the first press, since the change writer holds
     the write until the press ends. A second new pot opens with the column
     selected; choosing "(none)" clears the pot's column and the flag.
   - *The card.* Deal a hoard with arms rolled on the weapons list with the
     column set (the walk stages a typed arm through `rollMagicTruths`, since
     which row a die reaches varies). Observables: the Judge's tile for an
     undetected typed arm has the line "Undetected · rolled: <type>"; hovering
     its band pips shows the band's tooltip followed by "<type> <base> gp (its
     imported item) + masterwork <cost> gp (RR ch. 4) · <page>", the two figures
     being the base document's `system.cost` and the tier's `costAdd`; the tile
     of an arm with no type, a masked one with a cost, or a detected one has no
     parts in its tooltip.
   - *The Player seat.* Open the pot to the table and join as the Player. The
     window has no deal panel and no field, and no tile or tooltip shows the
     type, the line or the parts: the band alone, as before.
   - *State C, no arms grid imported* (a world without the Tome's arms grids;
     walked only where one is at hand, offline otherwise): the select is
     disabled, holds "(none)" alone, and hovering it shows the page reference
     alone, with no words saying anything is missing. Deal still works, and a
     row linked by name is still priced.
   - *Not walked by a script:* the disabled select's hover (the tooltip sits on
     its wrapper so a disabled control still shows it; read it with a real
     pointer), and the select at the narrowest rail width, where a long label
     must not widen the rail.

**Teardown:** the run's pots are tracked and swept; the kept fixtures stay.
