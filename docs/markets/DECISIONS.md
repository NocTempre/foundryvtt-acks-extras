# Markets — Decisions

## 2026-08-13 — Feature founded as `markets`, not an equipment extension

**Ruled (user):** item markets are their own feature (`scripts/markets/`,
`ACKS-MARKETS` root) rather than growing the equipment or location features.
Location keeps market *state*; markets owns the goods engine — the same
split henchmen recruitment already uses. Rejected: extending equipment
(pricing/availability is commerce, not gear mechanics) and folding into
location (already the largest feature; its docs frame it as place identity).

**Ruled (user):** v1 scope includes selling within caps, merchant importing,
Bargaining, demand modifiers, extended search time, the market-total (RR 124)
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
stock (the multi-party cap, RR 124) is its own roll at the cap multiple of
the cell's chance, decomposed into guaranteed units plus a d100 on the remainder
(with an invented multiple of ten: 23% → 230% → 2 units + 30% for a
third), made once per item per month.
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

## 2026-09-22 — A purchase arrives as the things bought, never as a bundle

**Reported.** Military oil bought at a market was paid for and never appeared
in the buyer's inventory. Any unit item bought two or more at a time did the
same: the purchase was delivered as ONE core `bundle` document embedded on
the buyer, meant to be dragged out and unpacked. No actor sheet lists an
embedded bundle — core's included — so there was nothing to drag, and the
receipt and the ledger both said the sale had happened.

**Ruled: deliver the copies.** A unit item bought N at a time arrives as N
copies of its source, stripped of the source's id, folder, sort and
ownership — the documents core's own bundle drop leaves behind, and the shape
chargen's bundle grant already delivers. Stackables still merge into the
buyer's stack. Imports and commissions deliver through the same function and
change with it.

Rejected: listing the bundle on the sheets. It would add a surface to two
sheets for an intermediate object whose only purpose is to be unpacked into
what this ruling delivers directly.

Cost: bundles already delivered stay embedded and unlisted on their buyers;
this change does not unpack them. Thirty swords are thirty documents, as they
would be after core unpacked the bundle. (Addressed 2026-09-23: the repair
tool's `lib.embeddedBundles` check opens them. See docs/lib/DECISIONS.md, "One
standing repair tool".)

### A purchase folds only into an identical stack (2026-09-23)

**Supersedes in part** the entry above: "Stackables still merge into the
buyer's stack" now means an identical stack (`stackSignature`), no longer any
stack of the same name. **New evidence:** the character sheet embedded dropped
bundles whole the same way the purchase had, so delivery moved into
`lib/bundles.mjs` to serve both writers, and lib's merge identity is the one
storage transfers use. Ruling and cost: docs/lib/DECISIONS.md, "A bundle
arrives as its goods, and delivery has one owner".

### Every PC belongs to one implicit party until configured (2026-09-22)

Recorded from the header of `scripts/markets/engine/parties.mjs`.

**Ruled** (by the user). By default every PC belongs to one implicit party,
whose size for the party-size rule counts the player characters and their
henchmen, because the book counts adventurers, not players. The
`marketParties` world setting overrides it with explicit rosters.

## 2026-09-29 — The trade layer: RAW demand, trade state as Items, setting data through the register

**Ruled (user):** demand over time follows RAW only. A market's true demand
modifier is DERIVED — the generated base (JJ Ch6 Step 7 A–D) plus trade-route
equalisation (Step 7E) — and is recomputed when the route network or a
market's class changes (urban families, Commerce Disrupted/Improves JJ 111,
terrain transformation JJ Ch16). Exhaustion of Arbitrage and Price Reset
(RR 375) are world settings, off by default. Rejected: a saturation house
rule where trading pushes demand and it recovers monthly — RAW has no such
mechanic, and Step 7E is a setup step, not a monthly one.

**Ruled (user):** trade state a player owns, inspects or hands over is an
Item — merchandise definitions, trade routes, market reports, holdings
(investments, loans, contracts). Owned items are housed as embedded documents
on one GM-designated location actor through `lib/storage`, stamped with their
owner, and reached from the owner's actor and from the market location actors.
Month-scoped mechanics (prices, solicitations, existence rolls, handling) stay
market state. Rejected: a world setting for routes and per-market rows for
beliefs — neither can be inspected, handed over or exported with an Adventure.

**Ruled (user):** merchandise is a catalogue Item sub-type imported through the
register (so values arrive from the Judge's own book) and extendable by the
Judge: a world item with the same `key` overrides the compendium's. The
merchandise table recipe and the hard-coded key list retire.

**Ruled (user):** routes are Judge-authored between two market locations, with
a suggest-from-map helper over battlemap roads and hex routes.

**Ruled (user):** loot goes down the merchandise path — gems, jewelry, special
treasures and monster parts map to merchandise, sold at base in one click (the
JJ special-treasure default) or taken through arbitrage.

**Ruled (user):** venturers and other trade specialists get a Trade tab on the
character sheet for their research, routes and holdings.

**Ruled (user):** official setting data (AX and setting books) is imported
through the register like core data: printed market classes, families, demand
modifiers, routes, local business rules. Printed names follow the neutral-label
rule. Printed demand modifiers land as the BASE layer — equalisation still
shifts them, and a Judge who wants one frozen pins it.

**Ruled (user):** the trade layer is RAW implemented inside acks-extras. The
existing guarded read of an external domain module is left as it is and
nothing new is built on it; every domain-side input RAW takes (land revenue,
the ruler, urban families) is a field the Judge fills on the market.

Cost: four new Item sub-types, each a world relaunch when it arrives; a housing
actor the Judge must designate; the `dmKnowledge` rows migrate to report Items.
Program and phase state: `wip/trade-layer.md`.

### Housing visibility follows the storage attribution ruling (2026-09-29)

Players hold OBSERVER on the housing actor and the UI filters by owner — the
`lib/storage` ruling that attribution is a UI convention, not a security
boundary. Nothing secret goes in a trade Item: true demand stays on the market;
a report holds only what its owner believes.

## 2026-09-29 — Markets reads its figures from the page

**Ruled:** every figure markets v1 carried as a constant is either read from
the Judge's book through a `proseValues` recipe or derived from an imported
table; none stays in code. Read: the crowd head-count and its multiplier, the
all-parties ceiling, hub class shifts and the transit-loss roll (RR 124);
Bargaining's swing and per-rank bonus (RR 107); the magic-item buy and
self-made multipliers (JJ 131); the research level, engineering tiers and
dabbling backfire band (JJ 130); the impact cap and its family-scaled
exception (RR 371); the assessment and negotiation result bands (RR 373,
RR 376); the price's class and season shifts (RR 375); the typical merchant
(RR 376). Derived: an item's demand-step fraction is its merchandise
category's `priceStep / pricePerStone`. Removed: the placeholder family
ladder that sized an unset till, and the 11+ throw assumed for an ability
with no printed target.

**Procedure, kept in code:** dice expressions (2d6, 4d4−10, 1d6, d100); that
a natural minimum or maximum of 2d6 counts as the first or last band; which
hub takes days and which weeks; the order of the price-step adjustments.

**Rejected:** keeping round constants because they "look structural". The
bands and multipliers are exactly the values the doctrine names.

Cost: an action whose value is not imported refuses with the table named
rather than guessing. Worlds that imported before this release must re-run
Rules tables (Reimport One Shelf) to gain the new tables. The recipes' result
bands are read in order and keyed by position; a book that reorders a result
column would mislabel it, and the content test checks shape, not meaning.

### Family income stays a Judge setting (2026-09-29)

`economy.familyIncome` keeps its producer waiver. The settlement recipe
leaves the settlement table's income column out on purpose: it is domain
revenue after expenses, not what the market's till should float, and the
trade layer does not model domains. The till is this module's device, not a
printed rule, so its sizing input is the Judge's.

### A market's own held magic items sell off the shelf (2026-09-29)

A magic item sold to a market becomes a row the next buyer can take. It is a
physical item already present, so buying it skips the monthly transaction
roll, the caps and the ledger, and writes only the market log. It still
charges the magic buy price.

## 2026-09-29 — A setting book's market profile lands as the base

**Ruled:** a gazetteer's regional demand grid and domain records import onto
location actors as the market's printed class (`marketClassOverride`), urban
families and BASE demand layer, with `dmProfile.source` naming the grid page.
A market with a domain record takes the record's printed heading as its name;
a grid-only market keeps its neutral label. The book's own city is bound onto
the city actor the POI step builds, not a second actor.

**Ruled:** where the domain record and the grid print different classes for
one market (AX3 has two), the record wins and the Judge is told. The record is
the market's own entry; the grid summarises many markets on one page.

**Ruled:** the grid speaks ACKS I goods. The System Compatibility Guide has no
merchandise conversion, so the ACKS I → II translation is module vocabulary
(`ACKS1_GOODS` in `scripts/importer/market-profile-binding.mjs`). A merchandise
item's `aliases` outrank it, which is how a Judge maps a good the module leaves
unmapped. An unmapped good is reported and left out, never priced. Where two
columns feed one good, a column the Judge aliased stands over one the default
map sent there (otherwise page order decides), and the other is reported.

**Ruled:** an import never overwrites what the Judge set. Class and families
are written only where empty; the base only where it is empty or came from the
same page.

Rejected: writing the class as `urbanFamilies` alone and letting the RR
bracket derive it — the printed class is the book's statement about that
market and the bracket can disagree with it.

Cost: the grid's rotated market names are not text, so 18 of 25 AX3 markets
arrive as `Market N` until the Judge renames them.

## 2026-09-29 — Demand is three layers with one reader

**Ruled:** a market's demand is a base layer (generated by the Demand
Generator, JJ 199–202, or supplied by a book), a derived layer reserved for
trade-route equalisation, and the Judge's pins. `trueDemand` is the only
reader — pin, else derived, else base — and `engine/demand.mjs` the only
writer. The generator writes the base and never touches a pin.

**Ruled:** a hand write to the base (Set, Clear, or Apply in the generator)
clears `dmProfile.source`. The base is then the Judge's, and a book re-import
leaves it standing.

**Ruled:** the land-revenue step reads both the count and the signed size of
each clause from the imported table, rather than assuming a size of one.
"Drop any fractions" truncates toward zero, so a sum of −1½ gives −1.

Rejected: a single demand array with a per-row origin tag — every reader would
have to know the precedence, which is the bug the one-reader rule prevents.

## 2026-09-29 — Market reports: build choices

**Chosen in the build (not yet the user's):**

- Assessment resolves on a GM seat only and writes a report only when it
  learned something. The trade house is not writable by a player, so a
  player's "Process now" leaves an assessment pending for the GM's sweep; a
  *failed* result and an expertise result with no matching ability write no
  report, and the whispered card still says so.
- The Trade tab is shown to the GM on every character. The trader flag is
  only reachable from the tab, and the alternative (a tool cell or menu entry
  on every sheet) costs more than an extra tab for the GM.
- The report sheet is a plain window (`tag: "div"`), not a form: a player holds
  OBSERVER on the house, so the document's own submit is closed to them, and
  the owner's notes travel through the GM relay as escaped plain text.
- `lib/storage` `providersFor` counts goods only, so the house does not show as
  a place a character can retrieve from and a report is never "retrieved".

Rejected: a report written from a player seat with the relay authorizing on
the location (a player clicking Process could then stamp a report for another
player's assessor).
