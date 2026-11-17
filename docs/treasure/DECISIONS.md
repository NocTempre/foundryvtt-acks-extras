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
