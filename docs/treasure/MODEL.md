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
| `partyId`, `origin`, `deal.toggles` | reserved; written empty |

Core lets any user create a Card in a pile. A Card whose id is not in `order`
(or a bucket list) is never shown by the window and never acted on by the
relay (`cardInPot`).

## A card

A Card is a core Card of the base type, face down: no `faces`, `face` null.

- `suit` and `back.name` are the pool a seat is shown (`item` for a magic card
  whose magic is not identified), `back.img` is an icon from Foundry's own
  `icons/` library, `value` is the band. Every band is 0 until the bands are
  computed behind `bandOf` (`pot-logic.mjs`).
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
- A player is never shown `magic` as a pool until the item is identified past
  `none`; detection only adds the aura.
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
`potId:op:cardId` is claimed before the first await; one request runs at a time
per pot.

**A claim** builds an item from the snapshot through `disguiseData(data, mask)`
and writes `markets.detected: false` only where the card says undetected
(`claimItemData`); delivers through `deliverItems`; coin through `creditCoin`
(the card's own coin row, else the world's coin of that name from
`coinTemplate`, else nothing is written); a value card as `mintCoin`. The card is
marked claimed before its goods move, and the mark is cleared if the delivery
fails.

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
