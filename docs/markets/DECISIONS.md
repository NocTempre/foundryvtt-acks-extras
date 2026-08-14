# Markets — Decisions

## 2026-08-13 — Feature founded as `markets`, not an equipment extension

**Ruled (user):** item markets are their own feature (`scripts/markets/`,
`ACKS-MARKETS` root) rather than growing the equipment or location features.
Location keeps market *state*; markets owns the goods engine — the same
split henchmen recruitment already uses. Rejected: extending equipment
(pricing/availability is commerce, not gear mechanics) and folding into
location (already the largest feature; its docs frame it as place identity).

**Ruled (user):** v1 scope includes selling within caps, merchant importing,
Bargaining, demand modifiers, extended search time, the market-total (10×)
vs per-party cap split (all PCs are one party until configured), and the
magic-item market **with automated identification**. Spell-casting purchases
and the full arbitrage/trade-route game stay out (ROADMAP).

**Ruled (user):** a sale destroys the sold item document (quantity decrement
for stacks); only a purchase creates one. Rejected: stashing sold goods into
location storage as second-hand stock — sold goods leave play, matching the
JJ's "removed from play" default for items sold to the Tower.

**Ruled (user):** mercantile-venture mechanics (demand modifiers, extra
search time) are extracted from the local ACKS II wiki snapshot into
`acks-rules/acks-markets/RULES.md`, cross-checked against the RR PDF only
where shapes disagree.

## 2026-08-13 — %-cell market stock rolls at tenfold chance, floored by a party's find

**Ruled (user):** for a percent availability cell, the market-wide monthly
stock (the multi-party 10× cap) is its own roll at ten times the cell's
chance, decomposed into guaranteed units plus a d100 on the remainder
(23% → 230% → 2 units + 30% for a third), made once per item per month.
A party's own successful existence roll floors the result at one — the
market never contradicts what a party already found, so a 5% success
stands even if the 50% market roll fails. Each party's access stays capped
at its own existence roll.

**Addendum (user):** the location's rolled capacity binds the SELL side even
when the party's own roll fails — a failed contact roll does not empty the
town of buyers, so a party may still sell (one unit, within the market
total). Buying stays gated on the party's own find.

## 2026-08-13 — A venturer widens the party's share, never the market

**Ruled (user, RAW reading):** treating a market as a higher class
(mercantile network, RR §VIII.6) reads the PARTY's availability cell at the
effective class, but the cross-party monthly total stays the town's TRUE
class — a bigger share of the same market, not a bigger market. Where the
effective class guarantees a find that the true class only chances (the RR
heavy-warhorse example), the find stands: the market total floors at any
party's find, even on a true-class none cell.

**Addendum (user):** the tenfold market on a %-cell is TEN INDEPENDENT
rolls at the cell's chance — the successes are the stock (binomial), never
a fixed decomposition into guaranteed units. Supersedes the 230%→2+30%
reading above.

**Addendum (user, final):** the tenfold %-cell stock decomposes into
guaranteed whole units plus AT MOST ONE d100 for the fractional remainder
(230% → 2 + d100 vs 30). The asking party's own existence roll is made
FIRST: it floors the stock, and where the floor alone decides the answer
(no whole units, party found one) the market roll is skipped entirely.
Quantity cells keep the printed tenfold total as RAW states.

## 2026-08-14 — Identification is a ladder anyone qualified may climb

**Ruled (user):** the JJ identification methods are automated, and the
qualifier may be any character or henchman the user acts through (a sage in
the retinue identifies as well as a PC). Throw targets read from the
identifier's own imported ability item (`rollTarget`), 11+ when absent; a
failed throw locks that method for that identifier until a level is gained
(recorded on the item). Automatic methods (trial by use, sipping, combat/
training) always advance the state — their cost is adjudicated in the
fiction, and the card says so. Only FULL identification (magic research)
sells at base cost; partial still trades at apparent value. The equipment
sheet mounts the markets-owned magic panel on its Construction tab, the
same one-line composition as the goods schema.
