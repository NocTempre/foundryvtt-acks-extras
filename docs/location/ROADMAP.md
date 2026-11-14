# Locations — not built

Re-issued 2026-11-14.

Work that is designed but absent, deliberately. How the feature behaves now is
[MODEL.md](MODEL.md); why it is shaped that way is [DECISIONS.md](DECISIONS.md).

---

### Pinning a place you are not standing in

The pin is the manual control over which places a character's sheet lists
([DECISIONS.md](DECISIONS.md), 2026-09-20), and it lives on the row — so a
place the sheet does not list cannot be pinned from the sheet. Visiting the
place once is the ordinary route, and the API
(`acksExtras.location.reach.setPinnedPlace`) is the Judge's. What is unbuilt is
a picker that offers the world's places to pin without standing in them; it
wants a search, because the world this rule exists for holds ninety of them.

### The table projection belongs to lib

`table-docs.mjs` projects every feature's rules tables onto the library's
shelves, but lives under this feature. Its encounter-doc projections are rows
in a descriptor table, so the next doc adds a row rather than a branch, and
moving the file changes no behaviour. The move is to `scripts/lib/`, with the
Ruledata Browser following it, in a release that touches neither.

### Trade routes that move a market's till

`tillTargetGp` (`system.market.tillTargetGp`, `scripts/location/data/location-data.mjs`)
is the till's stored float. Trade routes that raise and drain it are not built;
they arrive with the markets feature's route layer
([../markets/ROADMAP.md](../markets/ROADMAP.md), "Trade routes and demand
equalisation").
