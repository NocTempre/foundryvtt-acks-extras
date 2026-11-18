# Treasure — decisions

Append-only; each entry is dated. How it works now is [MODEL.md](MODEL.md).

## 2026-11-17 — A new `treasure` feature

The owner, 2026-11-16: "I want new window for treasure rolling, to make it feel
more like a casino for players when they defeat a group or find a stash." It is
a feature of its own: `scripts/treasure/`, lang root `ACKS-TREASURE`, CSS
`acks-extras-treasure-*`, namespace `acksExtras.treasure`.

**Counter (moderate):** it adds a fourth root beside the magic features, and the
magic DECISIONS "Three features, one vocabulary" places generation in
`magic-items`. The ruling stands: treasure deals and shows the pot and will call
`magic-item-roll` through a lib services contract rather than generate magic
items itself.

## 2026-11-17 — The pot is a core `pile` Cards document

The owner, 2026-11-17: "Use the actual card item type built into foundry if
going this direction." One pot is one `pile`; each card is a Card in it. Core
re-renders the pile's sheet on every Card change, and the doorway needs no
storage of its own.

**Rejected:**
- *Hands.* A claim lands in an actor's inventory, so no hand is needed.
- *A Cards sub-type.* It would need a world relaunch to register and buys
  nothing a flag does not.
- *A plain ApplicationV2.* It loses core's re-render on card changes, which a
  window that turns on every flip needs.
- *A ChatMessage pot* (the first design). A chat message cannot be the card type
  the owner named, and its storage was a single flag rewritten on every flip.

## 2026-11-17 — A seat gets LIMITED, never OWNER

At open the pot's audience is given LIMITED sight. An OWNER could pass or delete
cards without going through the relay, so every act a player makes is a request
to the Judge's client, which checks the attested sender, the phase, ownership of
the target and an in-flight key. `pot.order` is the authority on what is in the
pot, because core lets any user create a Card in a pile.

## 2026-11-17 — Hiding is display-level, not a security boundary

The owner, 2026-11-16: "including hiding what is magical unless they detect, and
hiding effect unless they identify". Foundry gates no read, so every seat can
read a Card's flag and the item behind it. The pot chooses what the window
shows (`cardView`) and a Card's `suit` and faces carry only that. A flip writes
`faces` and `face` in one update so no core sheet shows a face early. A player
who reads the flag sees the truth, as with the equipment disguise.

## 2026-11-17 — Who rolls is the Judge's choice, per pot

Owner question A, answered: "Judge chooses per pot". The choice is the pile's
`mode` (`judge` or `table`), a toggle in staging. In R1 a pot is built by hand
and rolls nothing, so the mode is stored and shown and gates nothing yet; the
dealing it chooses between arrives with the hoard rolls.

**Counter (strong, from the plan):** two modes double the walk, and in table mode
the Judge cannot review a replacement before players see it.

## 2026-11-17 — A player's card tooltip names the displayed pool's page and nothing else

This departs from `ui-tooltips.md`, which wants a figure's tooltip to say where
it came from. A seed (a plot item the Judge drops in) must not be told from a
rolled card, so a card's tooltip names its displayed pool's page reference
(JJ ch. 4) and no part of what sits behind the card. The haul total's tooltip
lists its parts as the doctrine asks, since it sums only turned cards.

## 2026-11-17 — A claim reuses `creditCoin`

The slice brief asked for a new `creditCoin(actor, {key|name, count})` built on
`coinTemplate`. `lib/money.mjs` already exports a `creditCoin(holder, credits)`
that lands coin by `source`, and a new one would collide with it. A claim hands
it the card's own coin row, else the world's coin of that name found with
`coinTemplate`, and writes nothing where neither exists. A value card pays
through `mintCoin`.

## 2026-11-17 — Seed buckets are Cards in the pile

Add and Replace are Cards in the same pile, kept out of `order` and listed in
`pot.buckets` until the pot opens, so a seed is already a card and only one
document needs cleaning up. **Rejected:** separate piles, because `pass` posts
to chat. At open, add cards take a random position in `order` and replace cards
join as they are; nothing is struck from the roll until the replace planner
exists.

## 2026-11-17 — Search the fallen: its own `deleteCombat` hook, the record on a whispered card

The owner, 2026-11-17: "It should show up as part of a search after a battle."
And: "It should be an inventory stash players can click a button or drag and drop
pick up items to their own." For this slice that means a fight that ends hands
the Judges a card, and the card stages a pot whose goods the players then pick up
as they do any pot's. Nothing like it existed: formation's searches are
wilderness hours and throws for hidden features, and no combat hook read what a
body carries.

- **Its own hook.** Treasure adds a `deleteCombat` listener run by the primary
  Judge's client (`isPrimaryGM`), beside the status engine's, which lifts
  statuses on the same event. The record is built synchronously before the first
  await, since a token may be removed the moment after.
- **Who is fallen.** A combatant that is defeated (the tracker's mark, the dead
  status, or hit points of zero or below, read through the token so an unlinked
  token's own points count) and whose token disposition is hostile. A defeated
  friend, a hostile still standing and a combatant with no token or actor are
  left out.
- **Where the record lives.** On the whispered chat card's flag
  (`flags["acks-extras"].treasureSearch`), as snapshots rather than live
  references, so it holds after the bodies go. A world setting would outlive the
  card's deletion and need a clean-up path of its own; the card is already the
  Judge's thing to keep or delete. The storage is display-level, not secret: a
  flag reaches every client the message reaches, and whispering plus a GM-only
  render handler decide who sees the card. A fight whose fallen carried nothing,
  and had no letter or table, posts no card.
- **Moved at open, not at staging.** Staging only copies snapshots into cards.
  The take-off runs when the pot's phase becomes `open` (an `updateCards`
  listener on the client that opened it, so `openPot` and the sheet's Open
  button are untouched). It keys on `origin.carried`, a map from each goods
  card's id to `{actorUuid, itemId}`, and takes only goods whose card is still
  in `order`, once per item, from bodies that still resolve. A card from a drawn
  table is never in the map, so a world or compendium item is never deleted.
  A body removed before Open leaves its cards standing on their snapshots.
- **A linked table is drawn at staging**, once per creature, through
  `drawQuietly`. An item result becomes a card; a text result has no card a
  claim can deliver (`claimItemData` returns null with no snapshot), so it is
  listed on the Judge's card instead of staged unclaimable.
- **A letter adds nothing yet.** The card lists it with a note and
  `dealLetter` in `search.mjs` returns no cards. The hoard engine's adapter and
  the lair warning (T4, T5) fill that one function.
- **Staging is idempotent:** the card's flag names the staged pot, so a second
  click opens it and never stages another.

**Counter (moderate):** a hook on `updateCards` for the take-off reacts to any
update whose diff opens a pot, where a call inside `openPot` would be explicit.
It was chosen because `openPot` is another slice's code; the take-off is a no-op
for any pot whose origin is not a fight's.

## 2026-11-17 — Quick grab's planner and the roster's `pace`

The owner, 2026-11-17: "Quick grab should calculate the distribution that
leaves the party moving as fast as they can." Owner question D stays on its
default: Quick grab takes everything, at the fastest pace that carries it.

- **Pace comes through the roster contract, not core's thresholds.** The planner
  is pure and takes `paceWith(memberId, adding6)`; the world's answer is the
  `party-roster` contract's optional `pace` (v3, docs/lib/API.md), which formation
  computes. Treasure holds no encumbrance step, so none can drift from core's.
  The dungeon close-out session's ruling holds it additive: "Keep `pace`
  additive: call the existing carrier-speed code as it stands." `pace` changes
  and moves none of `formation-model.mjs`. It calls `carrierSpeedFor` for a
  member whose pace a carrier sets, and recomposes the rest from the exports
  (`carriedLoad`, `encumbranceOf`, `explorationSpeedOf`) and lib's
  `explorationSpeedBearing`, because `memberPace` takes no added weight and its
  helpers `paceBearing` and `pacingCarrierOf` are private. A test pins `pace`
  with nothing added to `memberPace` for every branch, so a change to
  `memberPace` that is not mirrored fails there.
- **`load6` joins the member.** lib's `capacity6` is the whole capacity and the
  planner cannot see a load, so a member states both and the room is the
  difference. A member with no `load6` takes nothing, so a caller that passes
  the capacity alone cannot overfill anyone.
- **Counter (moderate) to the default:** a Judge may want the party to leave
  the weighty, low-value lots behind to keep a faster pace. That needs a value
  per lot, which a card does not always state, and drops goods the table sees;
  the plan takes everything and says what stays only for want of room.
- **Tie rules.** Members tie to the lower id, lots to the earlier in the pot's order. Best fit leaves the least
  room; worst fit the most. The exact search tries members in best-fit order, so
  its first placement is best fit's, and it gives up at a node limit rather than
  stall, a pace it gave up on counting as not placing. Coin pours tightest-first
  for best fit and level-first for the re-pack.
- **Rejected:** a pace enumerated from member speeds. A speed is a figure, and
  steps found by probing `paceWith` follow whatever its provider says.

## 2026-11-17 — Bands rank within the pot; four is a design constant

The owner, 2026-11-17: "Definitely should use icons on the backs before
flipping and color for value bands (with card face color for special status
like magic and curse once identified)." For this slice that means a face-down
card shows its pool's icon on a colour that says how much it is worth next to
the others, and a face turns magic or cursed only once a seat has been told.

- **Rank, not thresholds.** A card's band is its place among the pot's cards by
  apparent worth: `floor(4 × strictly lower ÷ n)`. A gp threshold would be a
  printed figure of the module's own, would mean nothing in a pot of
  copper-sized goods, and would put every card of a modest haul in one band.
  Ranking needs no figure and always uses the whole ladder. Four is a design
  constant (the legend and the colours), not a rule.
- **Rejected:** thresholds the Judge sets (a control nobody wants to tune per
  pot); bands read from an imported table (a table of options is content, and no
  printed band exists to read).
- **Apparent worth is what a seat could believe.** Coin by count and the coin
  row's rate; a value card by its worth; an item by its mask's cost, else its
  snapshot's. An undetected magic item is ranked by its mask only, and as nothing
  where the mask gives no cost, so its band is the band of what it passes for and
  its back is its plain twin's. **Counter (weak):** an unmasked undetected item
  sits in band 0 beside genuinely worthless ones; the Judge's tile already warns
  that nothing hides its name.
- **Frozen at open.** The bands are written to each Card's `value` once, in
  `openPot`, before the pile opens. A band that moved as cards were claimed or
  the world's coin rate changed would tell a table what is left.
- **Detection changes only the back's icon.** A detected magic card wears core's
  aura on its back and still reads as an item; identification adds the label.
  The face colours wait on identification (magic) and on a shown curse (cursed),
  so a face is never a stronger claim than what the table has been told.
- **Colours.** The four band colours are four theme hues at fixed lightness
  (`oklch(from <token> L c h)`), so the ladder and the contrast with the white
  icon (5.2, 7, 11 and 15 to one) hold in both themes; the plain token values
  are the fallback. No theme token is a blue, so the magic face's hue is the one
  literal in the file, at a lightness that passes in both themes.

## 2026-11-17 — Deal toggles are Judge controls; two are built — SUPERSEDED IN PART 2026-11-17

The owner, 2026-11-17: "Replace the right for clicking toggles like no magic or
force cursed etc." The right-hand panel of the staging window is a set of
buttons, each holding a state, in place of a control per right.

- **Judge controls, not house rules.** Each toggle edits this pot's result the
  way striking a card would, and is recorded for the Judges. Rejected as house
  rules: coin multipliers, scaling by party level, a chance of curse.
- **Built: "No magic" and "Force cursed"**, the two the plan names. **No magic**
  strikes every magic card at open, seeds included: on a by-hand pot there is
  no roll to skip, so removing the cards is the only thing it can mean there.
  **Force cursed** marks every remaining magic card's snapshot cursed and never
  known, so a claimed item is created cursed and the table learns of it by the
  ordinary routes.
- **Deferred:** "No coin" and "No gems or jewelry" wait for the hoard rolls,
  where they gate a roll; "Leave carried gear" and "Hide worth until turned" were
  never ruled. Each is a ROADMAP row.
- **Applied at open, recorded then.** A toggle changes nothing while staging but
  its own state and a "removed when the pot opens" mark on the tiles it will
  strike; `openPot` applies it, then whispers the Judges the names of what
  changed. A pot every card of which a toggle would strike refuses to open
  rather than open empty.

## 2026-11-17 — The stash: a card drags to a sheet or a member's zone, and the party aside is built as designed

The owner: "It should be an inventory stash players can click a button or drag
and drop pick up items to their own. Quick grab should calculate the
distribution that leaves the party moving as fast as they can." And: "Don't
forget the general rules of every window needs to be resizable and
scrollable." The owner approved the mockup ("Approved for development"); the
aside is its structure and nothing new beyond it.

- **One claim, three ways in.** Take's button, a drop on a member's zone and a
  drop on an actor's sheet all send the relay's `claim`. The relay already
  refuses a target the sender does not own, so the sheet hook and the zone
  repeat no check; each says the refusal (`report`).
- **The hook decides synchronously.** `dropActorSheetData` takes a Card of a
  pot's `order` and returns `false` before core's own drop goes on, face-down
  cards included, so the relay's "Turn the card over first" is what the player
  reads and no sheet gets a Card it cannot use. Any other drop is left alone.
- **Sheets that override `_onDrop`** (vehicle, item, party, unit) never reach the
  hook and stay a ROADMAP row.
- **Counter (weak):** a Take that asks which actor makes a drag unnecessary. A
  drag is the owner's word, and it keeps the character sheet and the pot open
  side by side.

## 2026-11-17 — The aside's party: the flag's, else the world's only one; none is one line

Nothing writes the pot's `partyId` and the design has no chooser, so the aside
would never list a member. `resolveParty` reads the party the flag names while
the roster lists it, else the only party the roster has, else none; the window
and the relay read it the same way. With none, the aside is one line ("No party
is set for this pot.") instead of hiding, so a table can tell why no zone is
there; a drop on a character sheet still works. **Rejected:** hiding the
aside (a missing panel reads as a broken window); a stored party written at
open (a party created after the pot opened would never be picked up). **Open
for the owner:** with two or more parties the pot has none until a picker
exists (ROADMAP, "Party picker").

## 2026-11-17 — Members come through the roster contract alone

`partyFigures` reads `party-roster` (`members`, `pace`) and lib's `capacity6`
and `load6` on the member's `document`; treasure imports nothing from
formation. A member with no document, or whose sheet lists no goods, is shown
and takes nothing (`hasDocument` false). The contract has no casualty flag, so a
member at or below zero hit points is the casualty; if formation's own notion
differs, the contract should carry it and this derivation goes. The window's
"Party moves" is the slowest pace among the members the planner would count, read
live from `pace`, so after a grab it is the figure the sheet shows.

## 2026-11-17 — Quick grab: the Judge's client plans and delivers, and a player need not own the members — SUPERSEDED IN PART 2026-11-17

`grab` is a relay op. The Judge's client builds the members from the roster, the
lots from the pot's turned unclaimed cards, and `paceWith` from the roster's
`pace`, runs `planGrab`, and carries out each assignment through `claimCard`,
the code a Take runs, inside the one queued request. Nothing in the payload
names a member, a card or a plan. Who may press it is who may Take (the Judge,
or a seat the pot opened to); the in-flight key `potId:grab:` runs one at a time.

**It does not ask that the presser owns the members.** A grab shares the pot
across the party, and a seat that owns one character could otherwise only ever
share with itself. Targets come from the roster read on the Judge's client, so
a payload cannot aim goods at an actor outside the party. **Counter (strong):**
a player can now put goods on another player's character without that player's
say. The pot already lets any seat in the audience turn and take every card, so
the grab moves goods only between characters of one party, to the planner's
placement; a Judge who wants a gate limits who may press it. **Open for the
owner:** restrict Quick grab to the Judge, or to a seat that owns at least one
member.

## 2026-11-17 — A coin share is a card of its own; the leftover is stored, the pace is read live

A claim marks a whole card and credits `coin.count`, so a share smaller than
its stack has no card to mark. `splitCoin` divides the truth by whole coins
(counts and weights add back to the stack's); `splitCard` creates a turned card
for the share, reduces the original to the rest, and inserts the new id after it
in `order`, then the share is claimed like any card. The haul and the closed
record count the share and the rest as two cards that sum to the stack. A failed
delivery leaves the share as an unclaimed card, so the coin is never lost or
credited twice. **Rejected:** shares kept on the card (the claim mark, the card's
"to <name>" line and the record hold one name); decrementing the count (it
shrinks the haul by what was delivered).

What the last grab left is stored on the pot flag (`grab.leftover`: card id,
unplaced coin count, reason code), because the window re-renders on every card
write and a plan per render is an exact search per seat. The window shows only
the entries still turned and unclaimed. The pace is not stored: it is read live
from the roster, and the relay returns the plan's own pace so the notification
can state what was predicted.

## 2026-11-17 — Each card weighs its own document

`truthsFromItem` gave the whole item's weight to the first document a drop
delivers and nothing to the rest. A grab places cards on different members, so
`goodsWeights6` reads each document's own data through lib's `weight6Of`. Today
`droppedGoods` answers one document for any drop, so the defect was unreachable;
the change holds for the first multi-document source. A coin stack with no
count weighs the one coin that is delivered, not the nothing the live item
weighs.

## 2026-11-17 — The owner's answers: who may grab, what a value card weighs, a forced curse on a full card

The owner, answering the plan's owner questions: "Take recommendations". The
new evidence against the two entries this supersedes in part is that answer;
both left the point open for the owner.

- **Quick grab needs a member the seat owns** (question 1, option c). The
  Judge, or a seat the pot opened to that owns at least one member of the pot's
  party. Supersedes "who may press it is who may Take" in the Quick grab entry;
  its "it does not ask that the presser owns the members" stands for where the
  goods land. **Counter (moderate):** a seat that owns one member still loads
  another player's character; only a Judge-only button stops that, at a click
  per pot.
- **A value card weighs the coin it is delivered as** (question 3, option b),
  since the member carries coin once the grab lands, and keeps its own weight
  where a coin rate it needs states no per-stone figure. The plan weighs each
  rate by `coinTemplate`'s coin, not the receiving member's own row, because a
  lot needs one weight before a member is chosen. **Counter (moderate):** with
  `perStoneOf` falling back to the system's own coin rate, the own-weight
  fallback is rare, and a member whose held coin states another per-stone
  figure ends a little off the predicted pace. **Open:** the tile still shows
  the card's own weight, and a 0 gp value card plans at no weight.
- **Force cursed marks the curse known on a card identified in full**
  (question 6, option a), so a card that shows all of itself does not hide part
  of itself. Supersedes "never known" in the deal toggles entry for those cards;
  a card identified in part or not at all is forced cursed and not known, as
  before. **Counter (moderate):** a Judge forcing a curse late loses the
  surprise on a fully identified card.
