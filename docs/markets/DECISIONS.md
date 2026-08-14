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
