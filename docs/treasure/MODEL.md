# Treasure — how it works now

A table turns treasure over in one window, and a Judge builds the pot behind it.
Source: `scripts/treasure/`, lang root `ACKS-TREASURE`, CSS `acks-extras-treasure-*`,
namespace `acksExtras.treasure` (`newPot`, `findPot`). Rulings and their
counters are [DECISIONS.md](DECISIONS.md); what is not built is
[ROADMAP.md](ROADMAP.md); the live recipe is [TESTING.md](TESTING.md).

## The pot is one core `pile`

A pot is a core `pile` Cards document, GM-only through staging. Its flag
`flags["acks-extras"].treasure` (`pot-logic.mjs` `normalizePot`):

| Key | Holds |
| --- | --- |
| `phase` | `staging` → `open` → `closed` |
| `mode` | `judge` or `table`: who rolls. Stored only; a pot built by hand rolls nothing |
| `flippers` | user ids that may turn cards, or `null` for every seat in the audience |
| `audience` | user ids given LIMITED sight at open |
| `order` | the card ids that are in the pot, **the authority** |
| `buckets` | `{add: [ids], replace: [ids]}`, the seed cards kept out of `order` until open |
| `messageId` | the doorway's chat message, so closing can rewrite it |
| `deal.toggles` | `{noMagic, forceCursed}`, both booleans, set while staging and applied at open |
| `partyId` | the party the aside lists and Quick grab shares among; nothing writes it, so `resolveParty` reads it while the roster lists it, else the only party the roster has (see "The party aside") |
| `grab` | `{leftover: [{cardId, count, code}]}`, what the last Quick grab left: the card, the coin still unplaced (null for a whole card) and `tooHeavy`, `noRoom` or `failed`; null before any grab |
| `origin` | reserved; written empty by a hand-built pot, the fallen's record on a staged one |

Core lets any user create a Card in a pile. A Card whose id is not in `order`
(or a bucket list) is never shown by the window and never acted on by the
relay (`cardInPot`).

## A card

A Card is a core Card of the base type, face down: no `faces`, `face` null.

- `suit` and `back.name` are the pool a seat is shown (`item` for a magic card
  whose magic is not identified), `back.img` is an icon from Foundry's own
  `icons/` library, `value` is the band, written once when the pot opens
  (band 0 until then; see "Bands, backs, faces and deal toggles").
- Its truth is `flags["acks-extras"].card` (`normalizeTruth`): `source`
  `{uuid, data}` (a snapshot of the item taken at the deal, since the item may
  be gone before anyone claims), `pool`, `label`, `coin` `{name, cv, count}` or
  `valueGp`, `weight6`, `mask` (what a seat is shown of an item), `magical`,
  `detected`, `identified` (read from the live item at the deal with
  `magicKnowledge`), `bucket`, and `claimedBy`.
- A flip writes `faces: [apparent], face: 0` in one update (`flipUpdate`), so
  no core sheet shows a face before the card is turned.

Hiding is display-level. Every seat can read a Card's flag; what a seat is
**shown** is chosen by `cardView`, and no part of the design is a security
boundary.

## What a seat sees

`cardView(card, {isGM})` is the one function the window reads.

- A player's face-down card shows its pool, its band and no name, weight or
  worth. Its tooltip names the displayed pool's page reference and nothing
  else, so a seed cannot be told from a rolled card.
- A turned card shows the mask's name, or the card's own where none is set,
  with its stated worth (coin by count and rate, or a value card) or "worth
  unknown", its weight, and an Aura tag when the item's magic has been detected.
- A player is never shown `magic` as a pool until the item is identified in
  full; detection only adds the aura, and recognized (`partial`) stays an item.
- A Judge sees the truth, a Seed mark on a bucket card, the mask beside the true
  name, and a warning on an undetected magic card with no mask.
- The haul is the sum of the **turned** cards' stated worth; the Judge's pot
  value in staging is the sum of them all. Its tooltip lists each pool's part
  and the page reference.

## The window

`PotSheet` (`pot-sheet.mjs`) is a `DocumentSheetV2` registered for `pile` with
`makeDefault: false` and chosen per pot by `flags.core.sheetClass`
(`acks-extras.PotSheet`). Its one part scrolls at the part root; it names the
module's scroll-contract class and the drag corner comes from `lib/window-resize`.
The grid reflows (`auto-fill`), and the side panel wraps beneath the pot when the
window is narrow.

- **Players** (LIMITED, so not editable: `_toggleDisabled` is a no-op): face-down
  cards are buttons with an `aria-label` (pool, band, "face down"); a turned card
  has a Take button.
- **The Judge in staging:** items dropped on the pot become cards (a money item
  is a coin card, an item is an item or magic card, wearing the disguise it
  already carries), a value card is added through a prompt, **Add** and
  **Replace** buckets take dropped items as seed cards, and **Open to the
  table** opens the pot.
- **Take** goes to the one actor a player owns, or asks among several. A Judge
  is asked among every actor that carries goods and gets a warning for one no
  seat at the table owns.
- **A turned, unclaimed card drags** as `{type: "Card", uuid}`, to a member's zone
  in the party aside or to an actor's sheet (see "The party aside" and "Drag onto
  a sheet").
- A card turning changes its colour and brightness for one beat and never
  turns in space; nothing plays under `prefers-reduced-motion`.

## Opening, the relay and closing

**Open** (`planOpen`): the replace bucket's cards join `order` as they are,
nothing struck; the add bucket's cards land at random positions in `order`
(`placeAdds`, an injected rng); both buckets empty; the pile's ownership becomes
LIMITED for every non-Judge seat and never OWNER, which would let a seat pass or
delete cards around the relay; the doorway is posted.

**The relay** (`pot-relay.mjs`, handler `treasurePot`, built over the world in
`pot.mjs` `createPotRelay`): every player act is `executeAsGM`, and the handler
authorizes on the attested sender (`runRelayed`), never on the payload. It
refuses a pot that is not open, a seat outside the audience or not among the
`flippers`, a card not in `order`, a card of the wrong face, a claimed card, a
target that is no actor, and a target a player does not own. The in-flight key
`potId:op:cardId` is claimed before the first await (`potId:grab:` for a grab);
one request runs at a time per pot. A `grab` is the third op, below.

**A claim** builds an item from the snapshot through `disguiseData(data, mask)`
and writes `markets.detected: false` only where the card says undetected
(`claimItemData`); delivers through `deliverItems`; coin through `creditCoin`
(the card's own coin row, else the world's coin of that name from
`coinTemplate`, else nothing is written); a value card as `mintCoin`. The card is
marked claimed before its goods move, and the mark is cleared if the delivery
fails. Each card weighs its own document (`goodsWeights6`, lib's `weight6Of` on
the document's data), so a grab can place cards apart; `droppedGoods` gives one
document for any drop today.

**The doorway** is a chat message carrying only the pot's uuid. Every client
fills its count, haul and row of card backs from the live pile when it renders
and when a Card of that pile changes; no message is rewritten for a flip.

**Close** files what is unclaimed at a place through `lib/storage.mjs`
(`stockProvider` for items, `creditCoin`/`mintCoin` for coin, each marked as it
goes so a retry never files twice), rewrites the doorway as the record of the
haul, and deletes the pile by its own id with `{chatNotification: false}`.

## The Judge's way in

**Scene controls → Token controls → New treasure pot** (a Judge-only button), or
`acksExtras.treasure.newPot()`. A pot already made is reopened from the Cards
directory, whose open action uses the pot's own sheet.

## Search the fallen

Source: `search-logic.mjs` (pure) and `search.mjs`. When a combat is deleted, the
primary Judge's client records its **fallen**: combatants that are defeated
(`isDefeated`: the tracker's mark, the dead status, or hit points of zero or
below read through the token) and hostile (`isHostile`: the token's disposition
against the system's constant), standing on an actor (`fallenOf`). Each entry
holds the actor's uuid, its carried goods as snapshot truths (`truthsFromItem`,
the same snapshotting a dropped item gets), its treasure letter
(`system.details.treasure.type`, none when blank or "none") and its linked
table's uuid (`system.details.treasure.table`, a `@UUID[...]` link). A goods item
is a physical item or coin (`isGoods`), and never a weapon the monster sheet marks
as a natural weapon, nor a monster's weapon that states no cost (`isNaturalWeapon`):
that is the creature's body, and an imported attack row carries no flag.

The record rides on a chat card whispered to the Judges, in
`flags["acks-extras"].treasureSearch`: `{combatId, sceneId, fallen, stagedPot,
drawnText}`. A fight whose fallen hold nothing posts no card. **Stage a pot** on
the card (`stageFromCard`):

- carried goods become cards, and the pot's `origin` is `{kind: "combat",
  combatId, sceneId, messageId, fallen, carried, takenOff}`, where `carried` maps
  each goods card's id to the `{actorUuid, itemId}` it came from;
- each linked table is drawn quietly (`drawQuietly`); item results become cards,
  text results are listed on the card;
- the letters are listed and deal nothing yet (`dealLetter`, the seam the hoard
  adapter fills);
- the staged pot's uuid is written back to the card, so a second press opens it.

**Open** moves the goods: an `updateCards` listener on the opening client calls
`takeOffBodies`, which deletes, once per item, the goods of cards still in
`order` from bodies that still exist (`planTakeOff`), and marks `origin.takenOff`.
Nothing is posted to a player until the Judge opens the pot. Why each choice:
[DECISIONS.md](DECISIONS.md).

## Quick grab

`planGrab({members, lots, paceWith})` in `grab-logic.mjs` is the pure planner of
who takes which lot so the party keeps moving as fast as it can, and the only
one: the relay plans again on the GM's client and never reads a plan from a
payload. A lot is a card's truth (`weight6`, and `coin {name, cv, count}` whose
`weight6` is the whole stack's). A member is `{id, capacity6, load6, casualty,
hasDocument}`: `capacity6` is the most the member can bear, `load6` what they
bear now, the room the difference. A casualty, a member with no document, no
stated capacity or load, or a pace with no figure takes nothing, and a note says
why.

`paceWith(memberId, adding6)` is injected and answers a rank, larger for slower,
that must not fall as the weight rises. In the world it is the `party-roster`
contract's `pace` (docs/lib/API.md), whose `rank` it returns, so core's
encumbrance steps never enter treasure and the planner states none: it finds
where a member's rank steps by probing `paceWith`.

The party's pace is its slowest member's. The plan:

1. The lots that can be placed at all are fixed first with only capacity
   limiting them. A whole lot heavier than every member's room is left with a
   `tooHeavy` note, and what exceeds the party's total room is left with
   `noRoom`.
2. Each party pace, from the fastest the members' own steps allow, is tried in
   turn. At a pace each member can bear up to where their rank passes it. Whole
   lots go heaviest first by best fit (the member left with the least room); with
   `EXACT_LOT_LIMIT` whole lots or fewer an exact search backtracks over the
   placements where best fit strands one. Coin then pours by whole coins into
   the room left, tightest member first, and a stack splits across members. The
   first pace that places the whole set wins.
3. A worst-fit re-pack at that pace (each lot to the member with most room left,
   coin poured to even what remains) replaces the plan when it places the same
   set at no slower a pace.

It returns `{assignments: [{lotId, memberId, count?}], pace, leftover:
[{lotId, count?}], notes}`; `pace` is read back off `paceWith` at the final loads.
Ties go to the lower member id and then to the earlier lot, so equal input gives
an equal plan.

### The `grab` op

Source: `pot-relay.mjs` (`grab`, `claimCard`), `grab-pot.mjs`, `pot.mjs`
(`partyFigures`, `splitCard`). Anyone who may Take may press it (the Judge, or a
seat the pot opened to), and it needs no ownership of the members: they come
from the roster read on the Judge's client, never from the payload, which names
only the pot.

1. `planGrabStart` refuses a pot not open, a seat outside the audience, and a
   pot with no turned unclaimed card (`nothingToGrab`); `deps.party` refuses a
   pot with no party (`noParty`).
2. The members are the roster's: `capacity6` and `load6` from lib on the row's
   `document`, a casualty at or below zero hit points, `hasDocument` false where
   the document is missing or its sheet lists no goods. `paceWith` is the roster's
   `pace(partyId, id, {adding6}).rank`. The lots are `grabLots`: the turned,
   unclaimed cards in `order`, a coin card carrying its coin row and its whole
   stack's weight.
3. `planGrab` plans; each assignment is carried out through `claimCard`, the code
   a Take runs, one at a time inside the queued request. A coin share smaller
   than the card's current count first splits (`splitCoin`, `splitCard`): a new
   turned card holds the share, the original keeps the rest, and the new id sits
   after it in `order`. The share is then claimed like any card.
4. What is still turned and unclaimed afterwards is the leftover, the plan's or a
   failed delivery's, with `tooHeavy`, `noRoom` or `failed`. It is written to
   the pot's `grab` flag and returned with the plan's pace as feet per turn
   (`speedOfRank`), the number of cards placed, and the members who took nothing
   and why.

### The party aside

Shown in the window once the pot is open, to every seat (`#partyContext`). The
party is `resolveParty`: the flag's `partyId` while the roster lists it, else the
only party the roster has, else none, and with none the aside is one line.
Otherwise it holds the caption, one zone per member, **Quick grab**, a "Party
moves" readout and, only when a grab left something, a leftover line.

- A zone shows the member's name, speed, a load bar and "load of capacity · items".
  Speed is the roster's `pace` read with nothing added; the load and capacity
  are lib's `load6` and `capacity6` of the member's document. A figure the actor
  or the roster does not give is a dash. A member with no goods-bearing sheet is
  shown dashed with a note and takes no drop; a casualty is noted and takes no
  share of a grab but takes a drop. Each figure's tooltip names its parts and
  cites the page; with nothing behind it, the page alone.
- "Party moves" is the slowest speed among the members who are not casualties,
  read live. A member the planner leaves out for want of a stated capacity or
  load still walks with the party, so it counts here and can make this slower
  than the plan's pace. The leftover line lists the
  cards of the last grab still in the pot; its tooltip gives each card's reason.
- A drop on a zone sends `claim` for the zone's actor; the sender's ownership is
  the relay's to refuse, and the refusal is shown as a notification.
- At a narrow width the aside drops below the pot, as the staging panels do.

### Drag onto a sheet

`sheet-drop.mjs` (`createCardDrop`, wired in `module.mjs`) is the
`dropActorSheetData` hook. A drop of `{type: "Card", uuid}` whose Card is in a
pot's `order` returns `false` at once and sends `claim` for the sheet's actor;
the relay's answer is shown, a refusal included. Any other drop is left to the
sheet. It reaches the sheets that fire the hook (the system's and extras'
character sheets); a sheet that overrides `_onDrop` does not (ROADMAP).

## Bands, backs, faces and deal toggles

Source: `pot-logic.mjs` (`rankWorth`, `bandsOf`, `dealOf`, `faceLook`,
`backIconOf`), `pot.mjs` `openPot`, `setDealToggle`.

**Bands rank a card within its pot.** A card's rank worth (`rankWorth`) is its
stated worth where it has one (coin by count and the coin row's rate, or a
value card), else its mask's cost, else the snapshot's `system.cost`, else
nothing. A magic item nobody has detected is ranked only by its mask's cost,
and as nothing where the mask gives none: its own cost would give the seed away.
Its band is therefore the band of the item it passes for. `bandsOf` gives each
worth `floor(BAND_COUNT × the number of strictly lower worths ÷ n)`: equal worths
share a band, a pot of one or of equals is band 0, and no band is out of range.
`BAND_COUNT` is four, a design constant and no printed figure. Bands are
computed once, over the cards the pot will hold (`order` and both buckets, after
the toggles), in `planOpen` and written to each Card's `value` by `openPot`
before the pile opens; nothing recomputes them. While staging, `withBands`
previews them on the Judge's tiles.

**The back** of a face-down card is the band's colour (the four band tokens in
`styles/treasure.css`, lighter for lower) with a white icon, the pool's label and the band as pips (`◆` repeated), so colour is never
the only cue; the band name is also in its accessible name. The icon is the
displayed pool's (`backIconOf`), except that a magic card whose magic is detected
or identified wears core's aura icon, and an identified one is also labelled
magic. An undetected magic card's back data is its plain twin's, field for field
(`cardView` carries every input the back is worded from: `backIcon`, `backKey`,
`auraBack`, `band`). A detected one's accessible name adds that an aura was
detected.

**A turned card's face** takes its colour from `faceLook`, which feeds
`magicKnowledge` and `curseKnowledge` an item shaped from the card: the card's
own `magical`, `detected` and `identified` (read from the live item at the deal,
so a variation inside it counts) and the snapshot's `markets.cursed` and
`curseKnown`. A seat is shown `cursed` where `showCurse`, else `magic` where the
magic is known and identified in full, else `plain`; recognized stays `plain`. The Judge's tiles read
the truth: magic or cursed whether or not anyone has been told, face down or up.
A cursed face's tag reads "Cursed".

**Deal toggles** are buttons with `aria-pressed` in the staging panel beside the
pot (below it when the window is narrow), stored on the pile as
`deal.toggles` (`setDealToggle`, staging only, Judge-only), applied by `planOpen`
through `dealOf`:

- **No magic** strikes every card whose truth is magic, undetected and seeded
  ones included, from `order` and both buckets, and deletes those Cards. A pot
  built by hand has no roll to skip, so this is what the toggle does there. A
  staged tile it will strike says so.
- **Force cursed** sets `markets.cursed` on the snapshot of every magic card
  that remains, and never `curseKnown`; a claim then creates the item cursed
  (`disguiseData` keeps the mark) and the table is shown the curse only once it
  is known.
- A pot that the toggles would leave empty refuses to open.
- When any toggle is on, `openPot` whispers the Judges a card listing, per
  toggle, the true names of the cards it changed. No card is posted otherwise.
