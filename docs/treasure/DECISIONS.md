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

## 2026-11-17 — Seed buckets are Cards in the pile — SUPERSEDED IN PART 2026-11-17

Add and Replace are Cards in the same pile, kept out of `order` and listed in
`pot.buckets` until the pot opens, so a seed is already a card and only one
document needs cleaning up. **Rejected:** separate piles, because `pass` posts
to chat. At open, add cards take a random position in `order` and replace cards
join as they are; nothing is struck from the roll until the replace planner
exists.

## 2026-11-17 — Search the fallen: its own `deleteCombat` hook, the record on a whispered card — SUPERSEDED IN PART 2026-11-19

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
- **Moved at open, not at staging.** *Superseded 2026-11-19: moved when the
  lot is found.* Staging only copies snapshots into cards.
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

## 2026-11-17 — Bands rank within the pot; four is a design constant — SUPERSEDED IN PART 2026-11-18

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

## 2026-11-17 — The hoard adapter reads the import's own shapes — SUPERSEDED IN PART 2026-11-17

The adapter (`hoard-map.mjs`, `hoard.mjs`) was built against the importer's
documents. The choices, each of which the engine's contracts left open:

- **Kinds are derived, not imported.** The import gives no list of kind names.
  A coin column is one kind named by the nouns its cells print and, with special
  treasure on, by the coin lists' own results; each distinct magic noun is a
  kind whose `tableRef` is the noun; a gem or jewelry kind is one legend row.
  No noun is written in source. **Counter (moderate):** an importer-written
  kinds table would be explicit, at the cost of a second read of the same page.
- **A legend row's place picks its special list.** The legend gives dice and a
  kind per row but not which special list each belongs to; the rows are paired
  with `GEM_LISTS` and `JEWELRY_LISTS` by position, and a legend not three rows
  long skips its column rather than pair by guess. **Counter (strong):** the
  pairing is a structural assumption read off one printing; a reordered legend
  silently swaps two lists. It needs the live walk against a real import, and
  the importer could name the list on each legend row.
- **A kind is matched in either number.** The legend prints one number and the
  cells the other, so `formsOf` adds the regular plural or singular. A kind the
  rule does not reach fails as `unknown-noun`, typed.
- **A special list's die is the die its bands span** (`bandDie`, the
  importer's own `ownDie` convention). The engine's header says a die is never
  derived from a top band; the exception is a list the import already checked
  "ends on a die's face", and the adapter passes the die in as an argument like
  any other.
- **Special treasure is off by default.** The Judge's procedure makes lots and
  the special lists optional, so a deal throws on them only when asked. The
  default is the owner's to confirm.
- **A "stays as it was" result is read by its words' shape.** The import marks
  none. A gem or jewelry result of `1 <own kind>` is kept; a coin result that
  counts a coin is coin, which for a same-coin result nets to no change. The
  engine's `coinResult` now sets a trailing parenthesized note aside. A coin
  list result of `N <coin name> <word>` for a thing that is not a coin would be
  read as coin; the lists the book prints give none.
- **The world's coin is found by lang name.** The engine's key (`cp` to `pp`)
  is not a rate. The adapter looks up the world's coin item by the localized
  name of each denomination and takes its `coppervalue`, so a Judge's renamed
  or re-rated coin is theirs; with none, no card and `coin-missing`.
- **A magic card is undetected with no mask.** It is a placeholder the
  magic-item roll replaces; until then the Judge sees the no-mask warning.
- **A column the type row leaves empty is not reported when skipped.** A legend
  gap names a skipped column only where the dealt cell has something in it.

## 2026-11-17 — The replace planner takes the fewest whole lots, and the seed stands in their slot — SUPERSEDED IN PART 2026-11-18

Supersedes, in part, "Seed buckets are Cards in the pile", whose last sentence
had replace cards join the pot as they are until a planner existed. **New
evidence:** the planner now exists, and with it the sentence's other half was
found to leak: a replace seed appended at the tail of `order` is a card a
player can tell from the rolled ones by where it sits, which the plan's walk
criterion for T3 forbids ("A seeded card cannot be told apart on the Player
seat").

Owner question A, "Judge chooses per pot", and question B's default, which no
owner has answered, so it stands: a replacing seed takes the fewest lots that
cover its value, pre-ticked; in "Judge deals" mode the Judge can change the
ticks; in "table rolls" mode the auto-pick stands.

- **The rule.** Fewest lots, then the smaller total, then pot order
  (`planReplace`, MODEL "The replace planner"). Seeds are planned in turn and no
  lot is taken twice. Worth is `rankWorth`, the apparent worth the bands use, so
  a masked magic lot counts as what it passes for and an undetected unmasked
  magic seed is worth nothing.
- **Where the seed goes.** In the slot of the first lot it strikes, so it
  neither trails the pot nor needs a drawn position. A seed that strikes nothing
  (worth nothing, or a shortfall) lands at a drawn position like an add card.
- **A shortfall strikes nothing.** Where the free lots cannot cover a seed it
  takes none rather than emptying the pot; the staging row and the audit say
  how far short. The alternative (strike every free lot) was rejected: it
  deletes the roll to place one seed.
- **Struck Cards stay in the pile.** They leave `order`, which is the authority
  on what is in the pot, so no window, relay act, haul or close reaches them,
  and the flag's `replaced` is the record. Deleting them, as No magic does, was
  rejected: the Judge's audit and a later look at the pile read the lots that
  went.
- **Counter to B's default (moderate, from the plan):** a whole lot can overshoot
  by a gem's worth where exact coin in proportion would stay within a coin. The
  Judge sees the overshoot on the seed's row and in the audit; exact coin is a
  ROADMAP row.
- **Ticks are not built.** The approved staging design shows struck cards and a
  "Takes ..." line and draws no tick control, so changing a pick has no control
  to live on; both "Who rolls" modes take the planner's pick until one is
  designed (ROADMAP, "Replace ticks").
- **Staging's pot value now counts the pot as it will be:** the lots held plus
  every seed's stated worth, as the design's total does.

## 2026-11-17 — A legend row names its special list, and the import marks the band that keeps the lot

The owner, answering the plan's question 8: "Take recommendations", so the
tt-importer tags each dice-legend row with its list key and marks the "leave
the lot" band, and the adapter stops pairing by order and wording. The new
evidence against "A legend row's place picks its special list" is that answer
and the importer's report that the `1 <kind>` match misses real bands (a
bracketed note, words between the count and the kind, an alternative clause).

- **Pairing by `list`.** A row's `list` names its special list; a row with
  none takes the list at its place, so an import from before the tag still
  deals. A key outside the column's lists, or two rows on one list (a tagged
  row meeting an untagged row's place included), skips the column rather than
  guess.
- **`keep` from the marks.** A gem or jewelry list's kept results are the
  result texts of its bands marked `keep: true`; the engine's contract (a
  result text matched folded) is unchanged. Only a list with no marked band
  falls back to the wording match. **Counter (weak):** two bands printing one
  text would both keep; identical text deals an identical outcome.
- **The brilliant band's break.** The brilliant list's leave-the-lot band also
  offers breaking the stone into the lower kind. `keep` applies unchanged: the
  deal leaves the brilliant as it was, and breaking it stays the table's choice
  after the deal. **Counter (moderate):** the deal never offers the break, so a
  table that wants it splits the card by hand.

## 2026-11-17 — An uncovered replace seed warns the Judge at open

The owner, answering question 11a: "Take recommendations", so a seed the free
lots cannot cover still takes none, and the Judge who opens the pot is warned
that it holds more than the table rolled. The warning names each such seed and
the sum of their worth, not of their shortfalls, since each seed's shortfall is
measured against every free lot on its own and the shortfalls do not add. It is
a notification on the opening Judge's client; nothing is refused and no player
sees it. **Counter (moderate):** striking every free lot (11a's option b) keeps
the pot's total near the roll; the warning only tells the Judge it was not.

## 2026-11-17 — "Met in their lair" is the Judge's toggle, and a kind of monster deals one hoard — SUPERSEDED IN PART 2026-11-20

The owner: "These are GM tools, there doesn't need to be a logic, just an input
toggle". So the pot's staging state carries `deal.metInLair`, the Judge sets
it, and the lair warning reads it alone: with it off, dealing a letter waits on
the Judge confirming the warning, and with it on nothing is asked. Rejected:
detecting a lair from the scene, a token or the sheet. Core's monster data holds
only `treasure.{type,table}`, so there was nothing to detect from, and the
"Carried only" option that leaned on such a field is dropped.

Selected tokens deal one hoard per kind of monster, not per token: a treasure
type is the lair's hoard, and four ogres from one lair share it. A kind is the
base actor, so unlinked tokens of one actor are one row. **Counter (moderate):**
two bands of one monster from two lairs then deal one hoard where the table
means two; the Judge deals the second by hand. The UI, its lang and its walk
come with T5's approved design.

## 2026-11-18 — A lot carries a found mark; the scene deals its pot open, with no doorway — SUPERSEDED IN PART 2026-11-19

The owner, answering scene search's Q1: "rolled by judge before interaction,
visible as found", and Q9: "B, there is no "stage a pot" as a thing". So a
scene's haul is rolled when the scene opens, every lot's band is set then, and
a lot is shown to the table only once a check has found it. The pot is dealt
and opened in one call (`dealSceneHaul`); the Judge never holds a staged scene
pot. The fight-over card's Stage a pot stays until scene search's own slice
replaces it.

- **The mark is in the card's truth** (`found`, with `lot`, the key its entry
  lists), and a truth with no mark reads as found, so no pot made before this
  loses a card. Rejected: a list of found ids on the pot flag, which every
  later rewrite of the flag would have to carry.
- **Every reader honours it, not the window alone** (`seatCards`): the
  doorway, Quick grab, the record, and the relay's flip and claim. A player can
  send a flip for any card id, so the relay refuses an unfound one as it
  refuses a card not in the pot. Hiding is display-level, as it is for a
  face-down card.
- **The session's call, owner may overrule: no doorway card at a scene's open.**
  `openPot(pile, {doorway: false})` skips the chat card, since a pot whose lots
  are unfound has nothing to announce and the scene's tray is its way in. The
  default is unchanged.
- **The session's call, owner may overrule: an unfound lot is neither filed
  nor recorded at close.** The table never saw it, so the record does not list
  it and no place is stocked with it.
- **The caller says which entry hides what.** The deal takes sources, each an
  entry's thing id, a check and letters or ready truths; the module chooses no
  hiding place. Counter (weak): a Judge who wants the haul scattered at random
  deals one source per thing from a list the caller shuffles.

## 2026-11-18 — An undetected magic item ranks at its apparent value

The owner, 2026-11-18, answering the T6 question (an undetected rolled magic
find with no disguise of its own ranked at worth 0): "Apparently value is based
on the non-magical version of the item, although almost all magic items are
masterwork quality at a glance unless disguised intentionally".

- **New evidence.** This supersedes in part "Bands rank within the pot" and
  "The replace planner takes the fewest whole lots" (both 2026-11-17, under
  seven days old). Both ranked an undetected item with no mask cost at nothing.
  The owner's answer, above, is what they did not have.
- **The ruling.** An undetected magic item ranks by its intentional disguise's
  cost where it carries one, else by its non-magical worth at a glance, else at
  nothing. The bands and the replace planner both read it through `rankWorth`.
- **The figure is the book's own.** The importer already reads each magic
  item's printed apparent value (JJ ch.4) into
  `markets.apparentValueGp`, which markets prices on. The book defines it as
  what the item would be worth non-magical, typically a masterwork's worth (RR
  ch.6), so the module reads it and computes nothing. On the 2026-11-18 world,
  757 of 801 imported magic-item documents carry it.
- **What it cannot reach yet.** The sword, weapon and armor lists link no
  document, so those finds are named placeholders with no figure, and they are
  the class the book prices as masterwork plus the base item's cost. That
  needs a link from the rolled row to its base item, with the imported
  masterwork tier cost (treasure plan, slice T6c). Until then they rank at
  nothing, and no figure is written: the pot shows a band, never an item's
  worth.
- **Rejected:** computing every find's worth from a base item and the
  masterwork tier cost. The printed figure exists for most items and is what
  the book means, and a computed figure would disagree with it wherever the
  entry prints its own.
- **Counter (moderate):** a seed hidden by Replace now takes lots up to its
  apparent value instead of standing alone, which changes what a replaced pot
  looks like. That is the ruling's intent: a seed weighs what a seat would
  believe it is worth.

## 2026-11-19 — The arms column is a select in the deal panel, and its label is the module's

- **Ruled by the owner (2026-11-18).** The column is per pot, in the deal panel,
  remembered ("Accept recommended"), and blank rolls no type. The board
  ("ArmsColumn") was approved with "Approve, build it", and the label is
  "Fixed label (Recommended)": the field reads "Arms and armor column" and never
  the imported grid heading.
- **Built.** A select under Table style listing "(none)" and the imported
  columns by the import's own labels, disabled with "(none)" alone where no arms
  grid is imported. Its tooltip names the column and the page; with none picked
  or none imported it is the page alone. Where the import recorded a page for the
  settings the tooltip cites it, else the reference the module ships.
- **A stored column the import no longer has** reads as "(none)" in the select
  and stays on the pot, where it types nothing: the roll finds no such column.
- **The type is kept.** `apparent.type` holds the type a roll typed, so the
  Judge's card can say it and its band's tooltip can name the parts; a row
  linked by name rolled none and keeps none. The tooltip lists parts only where
  `rankWorth` reached them, since a stated worth, a mask's cost or an apparent
  value outranks them and a tooltip naming parts that did not make the band
  would be wrong.
- **Rejected:** widening the `magic-items` API with an accessor for the setting
  columns. The deal panel reads the imported document through `lib/tables.mjs`,
  as the hoard reads its own.

## 2026-11-19 — The fight-over card opens the scene; the take-off asks by `takeOff` — SUPERSEDED IN PART 2026-11-19

The owner's Q9 answer (2026-11-18): "B, there is no "stage a pot" as a thing".
New evidence since the 2026-11-17 entry: scene search's S5 built the card's
replacement, so the card now carries **Search the scene** and nothing stages a
pot by hand. This supersedes in part the 2026-11-17 entry (its Stage a pot,
`stageFromCard`, the combat `origin` and its `stagedPot`) and the 2026-11-18
sentence that kept Stage a pot until then.

- **The take-off keys on the origin's own say-so.** `needsTakeOff` reads
  `origin.takeOff === true` rather than `kind === "combat"`, since no pot is
  made with a combat origin any more and the scene's pot is the one that
  carries goods. Rejected: widening it to `kind: "scene"`, which would make
  treasure name a feature that is not its own.
- **Cost:** a pot staged from the card before this change and still unopened
  keeps its `kind: "combat"` origin and no longer takes its goods off the
  bodies (the take-off now waits for the find, below). No tool is written for it (the owner: no tools for
  previous-version data).
- **A body's linked table is drawn at the scene's open**, by treasure's own
  routine (`drawFallenTable`), so the draw stays quiet and its text results
  stay on the card.

## 2026-11-19 — The take-off waits for the find: a good leaves its body when its lot is found

The owner, asked when carried goods leave the bodies: "When found". This
supersedes in part "2026-11-17 — Search the fallen" (its "Moved at open, not at
staging", the `updateCards` listener and the pot-wide `takenOff` mark) and the cost
line of "2026-11-19 — The fight-over card opens the scene"; the new evidence is
the owner's answer. The scene search's side (the reopening it makes possible) is
in scene-search DECISIONS, same date.

- **Opening a pot takes nothing.** The `updateCards` listener and `openedNow` are
  gone. `takeOffBodies(pile, {cardIds})` runs for the cards a scene's check has
  just turned found, called by the scene search through a seam
  (`configureSceneChecks`' `takeOff`), so treasure names no scene feature and
  the scene search no treasure document. Example: two bodies, one carrying a spoon
  and the other a ladle; the check that finds the first body's lots takes the
  spoon, and the ladle stays on the second until its own check finds its lots.
- **One mark per card, not per pot.** `origin.taken` lists the cards settled, and
  `planTakeOff` skips them and takes only the cards asked for; the pot-wide
  `takenOff` could not tell which good was owed once goods left one at a time.
  The cards are recorded before any item is deleted, so a repeated find or a
  reopened search cannot take twice, and a card whose body is gone is settled and
  keeps its snapshot.
- **What the pot's own flows do with an unfound lot still on a body: nothing.**
  Flipping, claiming, Quick grab, the doorway's count and the close's filing and
  record all read found lots only (`seatCards`, `isFound`, `planFlip`,
  `planClaim`), and `markLotsFound` is the only writer of the mark. Closing a pot
  deletes it with its unfound cards, and their goods are still on the bodies, so
  nothing is lost; under the old timing the same close would have lost them.

## 2026-11-19 — The pot's look: a find in the muck, no motion, no card words

The treasure plan retired today. Each slice had already moved its rulings into
the entries above. This entry records the rulings on the pot's look that no
entry carried, in the owner's words.

- **The mood.** The owner, approving the deal controls on 2026-11-18: "It
  should evoke the feeling of ripping a TCG pack!" On the cards: "Full art,
  foils, special borders, fun". This produced the band frames, lozenge corners
  and breaks, foils and the aura and curse frames (MODEL, "How a card is
  dressed").
- **Not literally cards.** On the Fable pass: "Only miss is they are not
  literally cards. So something like "You found X items" makes more sense." No
  user string calls an entry a card. The header reads "In the pot: {n}" while
  staging and "You found {n} items" once open.
- **No motion.** "No motion, or literal card packs. It was a mood to evoke, not
  a physical procedure to mimic". This supersedes the plan's owner question E,
  whose default was a colour swap and whose counter was a card that turns over.
  It also rejects the drawn departure, seal, tear, deal, turn and Reveal board.
  A turn changes a colour and nothing moves.
- **Grime around the lucre.** "These are adventurers rummaging through guts and
  filth. But it should be somehow justified by the (sometimes literally filthy)
  lucre". Grime is heaviest on the lowest band and is gone at the top.
- **Textures are read, never drawn.** The owner's standing rule against
  generated art (`.claude/rules/ip-doctrine.md`, "Art") removed the drawn grime,
  foil, vignette and hatch before T5 slice B was committed. Each layer paints
  only a texture the art reader finds.
- **A core raster icon takes the framed slot** (`CORE_RASTER_SLOTS`). This was
  the plan's default for its picture question Q1. It stands unanswered, beside
  Q2 (ROADMAP, "Face pictures: two open questions").
- **Counter (moderate):** the mood the owner asked for was a pack torn open.
  Without motion, the opening carries that feeling only through the frames, the
  foils and the count.

## 2026-11-20 — The deal rail is one list of hoards, and a row asks for as many as the Judge raises it to

The owner, reporting the bug: "Treasure scene tool does not show options of
what to roll, just text field. Should be inventory with bucket of options and
qty (e.g. click to open selector and add O, click X to remove, click again to
add 2xA and B, drag monster to include it's roll, etc)." The design was drawn
and the owner said "Skip approval on a budgey". The monster checklist and the
typed treasure type are one section, "Hoards to deal": a monster row (a
selected token, or an Actor dropped on the zone) and a by-hand row (a type picked
from the imported table of the pot's style) each carry a hoard count with a
stepper and a remove. A row in the list is a row dealt, so the tick is gone.
The deal sends a letter once per hoard (`dealLines`). This supersedes in part
the 2026-11-17 entry on "Met in their lair": a kind still deals one hoard
however many tokens stand for it, but the Judge can now raise that kind's hoards
by hand, so two bands from two lairs no longer need a by-hand second hoard. The
new evidence is the owner's bug report above, which asks for a count per row.
Stored by-hand letters of pots staged before this are not read (no tools for
previous-version data). The picker lists only the imported table of the pot's
current style, and a count stops at 99. **Counter (weak):** a by-hand hoard needs
two presses (open the picker, pick) where a typed letter needed one field; the
list shows what will be dealt, which the field never did.

## 2026-11-25 — A seat is its LIMITED on the pile, read when it acts

The owner, 2026-11-25: "Tool permissions are hardcoded (e.g. summons) by server
role instead of object ownership, only judge secrets are supposed to be an
exception to this rule". And, on T-0793: "In either case the approach is follow
foundry permissions, don't invent new ones." The relay's seat test was a copy
this module wrote once: `pot.audience`, the user ids `openPot` gave LIMITED at
the opening. It is now Foundry's own test, `pile.testUserPermission(sender,
"LIMITED")`, read when the act arrives (the relay's `seated` dep, which
`planFlip`, `planClaim` and `mayStartGrab` take as a flag). A Judge passes it on
every pile, so the Judge's act is as it was. A seat a Judge sets to None after
the opening is refused, and a seat given LIMITED afterwards is admitted; the
copy answered the opposite way for both. `mayGrab`, which decides whether the
window offers Quick grab, reads the same test, so the button and the relay
agree. The 2026-11-17 entry "A seat gets LIMITED, never OWNER" stands: this
reads the level that entry grants and grants nothing. `audience` stays a field,
the opening's record of whom it gave LIMITED to, and nothing migrates. LIMITED
is sight of the window and gives no sight of a card's truth: every projection
that hides a truth (`cardView`, `seatCards`) is untouched, so what a Judge
keeps hidden stays hidden. **Counter (moderate):** the relay now reads Foundry
state on the Judge's client at each act, where the copy was a field already in
the view; the read is one permission test on a document already in memory, and
a Judge who edits Configure Ownership by hand now changes who may act, which is
the rule asked for. **Rejected:** keeping the copy and refreshing it on an
ownership change, since a second record of a level Foundry already holds goes
stale in exactly the cases that prompted this.

## 2026-11-25 — Close is the pile's owner's, through the relay

The owner, 2026-11-25: "Tool permissions are hardcoded (e.g. summons) by server
role instead of object ownership, only judge secrets are supposed to be an
exception to this rule". And, on T-0793: "In either case the approach is follow
foundry permissions, don't invent new ones." Close was the Judge's by role: the
window drew it for a Judge, and `closePot` refused every other seat. A pot is a
Cards pile, and Foundry lets the pile's OWNER delete it, so the window now draws
Close for `this.document.isOwner`, and the Close dialog lists the places the seat
owns. A seat that is not a Judge cannot rewrite the doorway message (its author
or a Judge may) or write a place it does not own, so its Close is forwarded to the
relay as a `close` op. The handler, on the Judge's client, admits the attested
sender who holds OWNER on the pile, read when the request arrives, refuses a
closed pot, and refuses a named place that is an actor the sender does not own;
then it calls `closePot` inside the pot's queue. A Judge passes by owning every
document, and no gate reads a role. The 2026-11-17 entry "A seat gets LIMITED,
never OWNER" stands: opening still grants LIMITED and nothing here grants a
level. This only answers for a seat a Judge has made OWNER of the pile by hand,
in Configure Ownership. **Counter (strong):** it admits nobody today, since no
player owns a pot until a Judge grants OWNER by hand, so the control and the op
are built for a case the module does not yet produce. It is built anyway because
the gate is Foundry's, so the rule holds the day a Judge, or a later slice,
grants it. **Counter (weak):** an OWNER of a pile could already delete it in core,
around the module; the relay's op gives that seat the module's close (leftovers
filed, the record written) in place of a bare delete. **Rejected:** a Judge-only
Close with the owner's bare core delete as the player's route, which leaves the
doorway card a live doorway to a pot that no longer exists. A seat that is not a
Judge closes an open pot only: staging stays the Judge's surface until its own
role-check batch rules on it (T-STAGE, held by the release hub).

## 2026-11-26 — The treasure tables live in the Ruledata Browser, and a page read is not editable there

The owner, 2026-11-20: "Treasure tables aren t improting?" and 2026-11-26: "where are they stored? no hidden surfaces. also no way to select on treasure deal card". The import worked; the tables were stored in the world setting `acks-extras.importedTables` and seen only through the Ruledata Browser, which listed the importer's page reads beside the tables the deal reads and offered Edit and drop on both. An override of a page read is inert, since the deal reads the assembled tables and a re-import rereads the world layer. The browser is the one home (no second window): its group for each treasure document leads with the tables the deal reads, sets the page reads apart under a collapsed list with View and Export only, and names the table the deal reads instead. Treasure declares its tables through `expectTables`, so an empty world lists them as not supplied, and the pot's rail opens the browser on them with a button drawn for a seat holding `SETTINGS_MODIFY`.

**Cost:** a page read is not editable in the browser, so a Judge who wants to change what was read from a page changes the assembled table beside it. An override already stored on a page read keeps its revert, the one control left on those rows. **Rejected:** a treasure window of the module's own (a second surface for one setting); hiding the page reads (nothing buried, and Export of one is how a Judge audits the read); drawing the button for any Judge (the override it leads to asks `SETTINGS_MODIFY`, and the module invents no permission of its own).

## 2026-11-26 — The fight-over card holds the deal choices, and writes them only until its scene opens

The owner, 2026-11-26: "also no way to select on treasure deal card"; standing: "every value has a control, everything has a manual override or entry point, and nothing is buried in a hidden table", "follow foundry permissions, don't invent new ones", "players get blocks, judges get warnings". Search the scene dealt at the first style, special off, the Judge's last arms column, and answered the lair warning on its own, so the Judge had no say in the deal the card started. The card now records the pot's four choices as `treasureSearch.deal`, seeded as `newPot` seeds a pot, draws them from the pot rail's shared partial, and the pot its press opens carries exactly them (MODEL, "Search the fallen"). Who writes is Foundry's answer for the message, `canUserModify(user, "update")`; no role is tested. Met in their lair off keeps the existing behavior: the Judge is warned and the deal goes on.

**Ruled:** a card whose scene is open is drawn the reason line "This card's scene is open" and no controls (a Judge who sees the line knows why the choices are gone). The choices are not remembered per user: a column chosen on a card does not update the Judge's last-column default, which only a pot's own select writes. **Cost:** a Judge who wants a different deal after the scene opens changes it on the pot's own deal, not on the card; two Judges editing one card race and the last write wins. **Rejected:** a role test for the block (Foundry's own answer is the permission); remembering the card's choices per user (a second default beside the pot's); a refusal when the lair is off (a Judge is warned, never blocked).
