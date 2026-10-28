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

**Amended (2026-10-28)** by "A later printing's demand replaces an earlier
one's, and a sideways grid's columns say which market they are": an earlier
printing's base gives way to a later one's, and a grid-only market whose
header is text takes it as its name.

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

## 2026-09-29 — The assessment is an influence roll; the queue can be undone; the ledger names its trader

Ruled after the first live walk of the venture flow (9.2.x): the assessment
day rolled 2d6 + Charisma inside the sweep with no way to bribe, tone or
apply a reaction effect, a mis-posted day could not be taken back, and a
player had no view of what their trades had cost.

- **The assessment's roll is made on the influence page, against the market
  as the target actor** (`marketAssessment`, secret, reaction family). RR's
  assessment is a reaction-style throw, so the influence feature's stack is
  what applies to it: Charisma, one tone proficiency, Mystic Aura, a bribe
  (RR 287 "Offering Bribes") and every reaction-family effect, on a page
  whose bands are the imported assessment column passed in as `ctx.bands`.
  The roll reaches the sweep stored on the action; the sweep never rolls
  when a total is there. The bribe is paid as the day is posted, to the
  market, because the merchants keep it whatever the day brings. Its fee is
  priced against one hit die (`assessmentBribeBasisHd`): a market's
  merchants are ordinary people, and the Judge raises the fee on the page
  where a market's merchants are grander. Rejected: a bribe field on the
  Trade tab beside the button — a second modifier stack, out of the
  influence feature's sight, that would have had to re-implement tones.
- **The queue refuses a duplicate and allows a withdrawal, refunding
  nothing.** The same trader's same day cannot wait twice; a pending day is
  withdrawn by the Judge or the trader's owner and its row stays, marked
  `cancelled`, so the ledger still says the day was bought. Nothing comes
  back: the gate has the toll and the merchants the bribe, and a refund
  would be a second write with a failure mode of its own (an action removed
  and the coin never returned, or returned twice). A resolved day is not
  withdrawable; it happened.
- **A party may leave the market, and the toll stays paid.** The month's
  row keeps `entered` false and its toll; the party's solicitations for the
  month are dropped (what a day of soliciting opened closes with the party
  gone) and its waiting venture days are withdrawn (a day cannot resolve for
  a party that is not there — the sweep would otherwise mark a solicit day
  done in silence). Entering again is a fresh declaration at a fresh toll.
  Rejected: refusing to leave while days wait (the mistake the button exists
  to undo is usually the queued day itself).
- **A trader's history is the market ledger, read back by actor stamp.**
  Every ledger row about a trader carries `actorUuid` and that trader's
  signed coin movement; nothing is written twice. Rejected: a per-actor
  ledger on the character (a second copy of every row, and a row written to
  a document a player's seat may not be able to write). Consequence: rows
  written before 9.3.0 carry no stamp and do not appear in a history — the
  market log still lists them for the Judge.
- **The ledger masks a false assessment as partial.** A trader can read
  their own rows; the truth stays on the Judge's copy of the report.

## 2026-09-30 — A mercantile network counts in a known market, and "known" is evidence the world already holds

Hotfix 9.3.1, from a Judge's report that a venturer's market read the town's
class on equipment and on sales. The power reached the class domain only as
the name fallback `marketClass` in henchmen's config, marked situational
("in a previously entered market"), and `effectiveMarketClass` summed the
always-on modifiers — nothing ever satisfied the condition, so the shift had
never applied to buying, selling, hiring or imports.

- **The condition is decided by the markets feature, asked at call time.**
  Henchmen owns the shift and knows nothing of visits; markets owns the
  ledger and the venture rows. `effectiveMarketClass` asks
  `acksExtras.markets.marketKnownTo` the way it asks factions for standing,
  so the henchmen engine never imports markets.
- **Known is what the world already records, plus the Judge's word.**
  *Superseded in part 2026-10-15: a sign counts only when it is dated before
  the current visit ("A market is known from an earlier day").* A
  ledger row stamped to the trader, or a venture row for their party in any
  month, is the visit the rule names; nothing new is written when a trader
  walks in. The Judge's list on the trader exists because ledger stamps date
  from 9.3.0 and a venturer's earlier travels are unrecorded. Rejected: a
  `visits[]` record written on every Trade-tab open (a write on a read, from
  seats that cannot write the location) and a per-trader "entered" prompt.
- **Not built:** the rule's alternative, +1 market impact on a venture
  instead of the class, "whichever is more useful"; the entry keeps the true
  class for its impact arithmetic. ROADMAP. *Superseded 2026-10-15: built
  ("A known market gives a venture a larger class or more impact").*

## 2026-09-30 — A venture enters with its vehicles, and loads go into one of them

RR §VIII.6 figures a party's market impact and the gate toll on the cargo
capacity of its transport, and has a buyer load purchases into their own
transport. The entry prompt took one typed number, and every load landed in
the trader's own inventory, so a wagon train that entered a market could not
carry what it bought there, and the number it declared was unconnected to the
wagons it drove in with.

Ruled: the entry dialog lists the seat's own vehicles (a vehicle a party
member rides starts ticked) beside a number for anything else — porters,
pack animals. The capacity counted is each chosen vehicle's hold capacity
(`vehicles/hold.mjs`) plus the number, and the venture row records the
vehicles (`vehicleUuids`). A trade names its hold: the trader's own packs or
one of the venture's vehicles. A purchase into a vehicle is refused past its
free room, before any negotiation is rolled; a sale draws across the hold's
stacks (`planLoadDraw`), all or nothing, and never touches goods kept aboard
for someone else. Both directions require the seat to own the hold, and the
relay checks the attested sender, never the payload.

Rejected: counting a vehicle's FREE room (the rule counts what the transport
can carry, and a half-full wagon still moves the market by its size);
loading into the first vehicle automatically (where the salt goes is the
trader's decision, and the packs stay a choice); taking the vehicles from the
formation's train (a party can own a wagon that is not travelling with it,
and a vehicle in the train can belong to someone else).

## 2026-10-01 — A market takes coin on hand or kept at that market

The owner, ruling on where a payment may draw its coin: "Some transactions
could be restricted to at X location (including locked to scene or on hand)
but that should be an explicit choice not the default. I do think markets
require money in the location or on the character so logistics still matter.
Moving money around the city may not be risk free!" The stores, a holder's
order and a payment's reach are docs/lib/DECISIONS.md, "Coin is kept in
stores, and a holder states their order (2026-10-01)". What this feature
decided under it:

Ruled: every payment made at a market states that market as its reach
(`within: location`), so it draws on the payer's coin on hand and on the coin
that market keeps for them, and on nothing kept anywhere else, whatever the
world's `coinScope` says. That is a purchase, an import order, a commission,
and a venture's toll, bribe and load. What a market pays out reaches the same
way: a sale's proceeds and a load's price land where the seller keeps arriving
coin when that is on hand or at this market, and loose on the seller when
their order names a place elsewhere. A changer hands the new coin back under
the same reach, and the stacks it offers to change are the ones carried.

Rejected: leaving a market to the standing reach, which by default is every
store. Coin in a vault across the city would pay at a stall, and carrying it
there would never be a decision. A fee or a risk charged on coin drawn from
elsewhere: the figure would be this module's own invention, and what happens
to coin on the road is played at the table. A reach set per market: a Judge
who wants one place to take coin kept elsewhere moves the coin there.

Cost: a buyer whose coin is in a vault elsewhere is refused as short and has
to withdraw it and carry it in. A world that set `coinScope` to on-hand still
has a market draw on the coin it keeps for the payer, which 10.0.0 refused.

## 2026-10-15 — A partial assessment is goods of the trader's choosing, and a false one looks the same

**Chosen in the build (not yet the user's):** a partial result leaves the
report holding a count of PICKS (1d6, capped at the catalogue) and no beliefs;
the report's owner chooses the goods on its sheet and learns their true
modifiers then (RR ch. 8, Assessing Supply and Demand: the partial band names
the goods as the trader's choice). A false result writes the same picks, and
the choice learns each good moved 1d3 steps up or down from the truth, the
same wrong belief the sweep used to draw at random. The assess card links the
report so the choice is one click from the result.

Rejected: drawing the partial goods at random, which is what 11.3.0 did. It
denies the trader the choice the band gives, and the goods a trader came for
were rarely among them. Keeping the false result random while the partial
became a choice: a report that arrived already filled would tell the trader
it was the false one, and the mask on every other surface would be worth
nothing.

Cost: a partial or false report is empty until its owner chooses, so a
trader who never opens it learns nothing, and the Trade tab's chips stay
blank for that market. Picks are spent per choice and never refunded.

## 2026-10-15 — A market is known from an earlier day; the current visit never counts itself

The owner, ruling on a trader's plan to enter a market and enter it again the
next day so the network would count: "previously entered" needs an entry on
an earlier day, the current visit never counts itself, and the module
granting the network on the first entry is a bug to fix by the rule. The
evidence that 2026-09-30 named made the market known the second the first
entry was posted: `postVentureAction` writes a stamped ledger row, and
`marketKnownTo` counted any stamped row whatever its date.

Ruled, on the owner's instruction to take the reading closest to the rules:

- **A visit is the stay, not the day.** RR ch. 8 says "previously visited":
  a party entered this month is on the visit its entry opened, so the second
  day of one stay never counts the first. A party not entered is on a visit
  of one day. Re-entering on a later day, after leaving, opens a new visit
  that the first entry precedes.
- **Hiring and buying count as having been there.** RR ch. 4 uses "enter the
  market" for hiring, and the power names buying, selling and hiring beside
  ventures; henchmen's own rows now carry the employer.
- **Days are calendar days**, dated by `dayOfWorldTime`, the same for a row
  written a month ago as for now.
- The Judge's list stays undated and wins, and the Trade tab's switch now
  flips that list rather than the combined verdict, which could not be
  switched off where the record already said known.

Rejected: a 24-hour window from the entry (a purchase near midnight would
read differently from one the next morning for no reason a player sees); the
current day alone as the visit (the second day of one stay would count its
first); a `visits[]` record (the record already holds every entry, dated).

Cost: every world loses its first-visit shift until the visit after, which is
the point and is visible on the tab. Ledger evidence older than the latest
rows is gone; the Judge's list is the remedy. A search posted on a first
visit counts from the next day's sweep on.

## 2026-10-15 — A known market gives a venture a larger class or more impact, whichever opens more, or the trader's pick at entry

The owner ruled the network on a venture: a class larger or more impact, the
module picking the better one by default and the trader able to override it
at entry; tolls never rise. Asked to settle the open readings, the owner
said to use the most rules-accurate one. Ruled on that instruction (RR ch. 8,
Entering the Market, Mercantile Networks and No Market Impact; RR ch. 2,
Mercantile Network):

- **The class option reads the merchandise a class larger at the impact the
  cargo earned.** The impact is figured at entry against the market's own
  baseline and is not refigured. Skepticism in carriage (RR ch. 8) moves
  class and impact apart in the same way, and the network's own text has
  the trader rely on reputation instead of caravan size; refiguring the
  impact at the larger baseline would cancel the benefit the option exists
  to give. Counter-reading, moderate: No Market Impact refigures the impact
  when it moves the class.
- **The maximum binds the impact option.** Steady Trade Routes and the
  carriage modifiers both stop at it.
- **Auto picks per solicitation, good by good.** The rule reads "whenever"
  the venturer engages, and the better option differs by good; the mode the
  entry declares holds for the whole visit.
- **The network that counts is the soliciting trader's**, in a market that
  trader had been in before this visit; the one who deals is the one whose
  reputation the merchants know.
- **The steps come from the page or the Judge.** Two located effects on the
  power in the importer register, `marketClass` and `marketImpact`, or an
  Active Effect carrying either key. No number for either ships.

Rejected: refiguring the whole entry at the larger class (the reading
above); one pick at entry for every good; the network moving the toll or the
month's price; any member's network counting for a solicitation another
member made.

Cost: a world that has not re-imported the class powers has no impact
option until it does or until the Judge gives the power an Active Effect,
and the dialog says so. Supersedes the 2026-09-30 entry's "Not built" bullet.

## 2026-10-17 — The toll is on capacity, loaded or empty; the goods charge is the tariff, not built

A field report asked whether the entry toll is figured on the party's total
capacity or on the stone it declares for sale, expecting an empty wagon to
pay less than a loaded one, and said the entry still asked for a goods type.

Ruled: the toll stays on capacity. RR ch. 8 (Entering the Market) prices the
toll per stone of the transport's capacity, and its worked example prices a
caravan's capacity without naming its load; the 2026-09-30 entry already
rejected counting free room. What the rule charges on goods is the tariff on
merchandise brought in to sell, which is a separate charge at the same gate
and is unbuilt (ROADMAP, venture logistics). The hint that said "declared
cargo" read as goods and now says capacity, loaded or empty.

The goods type was the merchandise picker, rendered beside Enter before
entry where no control on a player's seat reads it. It is rendered where
Solicit or the Judge's Set demand is offered, and captioned.

Rejected: building the tariff in the hotfix (a new charge, read off the
loads aboard and the imported tariff cell, is a minor's surface); a toll on
the stone declared for sale (not the rule).

## 2026-10-23 — The gate charges the tariff with the toll; the Ruler's Privilege waives both; the Judge may throw it

**Superseded in part** by the next entry (the book's fees on what the party
brings): what is charged and whose rule earns the privilege.

Builds the tariff the 2026-10-17 entry left unbuilt for a minor; nothing
that entry ruled is reversed. The owner answered four questions:

- **Every merchandise load aboard is charged, with no declaration.** RR
  ch. 8 has the point of entry inspect cargo for taxable goods; leaving
  goods out is smuggling, the Judge's call or the smuggling service's. The
  build narrows what the owner was offered ("the vehicles' holds and the
  party members' own packs") to the entering trader's own packs and the
  holds of the vehicles entering with them — the holds a venture's trades
  buy into and sell from — because the implicit party is every player
  character at the table, and its members' packs would be charged wherever
  they stood. Goods kept aboard for anyone else are not the trader's and
  are not charged.
- **Paid at entry, with the toll, in one payment** (step 3 charges both at
  the point of entry): a purse that falls short pays neither. Like the toll
  it stays paid when the day is withdrawn or the party leaves, and a
  re-entry pays it again.
- **The basis is the good's base price per stone × stones**, the catalogue's
  price, else the load's own cost: the rule's word is base cost. Rejected:
  the price the party paid. The book's worked example happens to tax a
  purchase, but a load found as loot or bought in another month carries no
  price paid.
- **The rates are the class's tariff cell**, read precious figure first, the
  order the step's prose names them in. A cell that reads neither as none
  nor as two percentages refuses the entry naming the table; it never
  charges nothing.
- **The Ruler's Privilege** waives toll and tariff where the trader or a
  member of the trader's party rules the domain the market lies in (the
  domains feature's `domainOf`, read at call time). Rejected, offered: a
  liege's privilege reaching a vassal's market.
- **The randomized tariff is built**, behind a world setting off by default:
  each tier the class tariffs is thrown once per entry on the dice the
  designer's note prints, imported as `mercantile.tariffProse`; a tier the
  class does not tariff is never thrown. The owner chose it over the
  recommended deferral.

Cost: a world imported before this release reports the new table missing
at `ready` until its Rules tables are re-imported, and with the setting on
an entry carrying taxable goods is refused until then. An entry posted
before its action stored the toll records the toll refigured from its
capacity when it resolves.

## 2026-10-23 — The gate assesses the book's fees on what the party brings, and nothing else

Supersedes part of the entry above, the same day. The new evidence is the
owner's own goal for the gate and their reconciliation of two answers that
disagreed. The build above had narrowed the charged goods to the trader's
own packs without the owner seeing the narrowing. An answer the owner gave
on reading it ("the party is blocked from entry until all members are
accounted for (smuggle is another option to present) or a member chooses to
stay outside") was built as a per-member muster, walked live and never
released. The owner then asked for the book's cases to be checked before
building, and answered again. In the owner's words:

- The goal: "This whole mechanic is only to satisfy the RAW fees. Assess as
  the book does when appropriate." And, from a side comment: "the module
  goal is to realize the cost side of the protections of the city." The
  toll, the tariff and smuggling are how this feature realizes it.
- "Assess as the book does, demand no others, leave mechanism documented
  and exposed in game for GM to invent new rules but you do not."
- On the muster: "Build it per RAW", then, reconciling it with the answer
  above: "Party or separately only".
- On the tariff's base: "Base cost".
- On an item brought to sell that has no merchandise type: "Not assessed".

Ruled:

- **The fees fall on transport and merchandise, never on people** (RR ch.
  8, Entering the Market, step 3): the toll on the capacity declared, the
  tariff on merchandise brought in to sell. No member is declared, and no
  member is refused a later day.
  - Assessed: the merchandise loads in the packs of the party's members at
    the market and in the holds of the vehicles entering. "At the market"
    is the presence the trade path already reads (`coinReach`), not a
    declaration. A member elsewhere is not arriving with the party.
  - An item a member brings to sell is assessed when it is merchandise: an
    item `categoryOf` gives a merchandise type (JJ ch. 4, Special
    Treasures). It is assessed at its type's tier on its cost times its
    quantity.
  - Not assessed: coin, kit not brought to sell, a magic item, and anything
    of no merchandise type. A Judge who wants those charged adds the charge
    through the hook.
- **The trader pays**, in one payment as before. Which member funds it is
  the players' bookkeeping.
- **Entering as one party or separately** (step 2, Parties) is the one
  choice about members the owner kept. It changes market impact, not the
  fees, and is built on its own (ROADMAP until it lands). *Superseded in
  part* by the next entry: entering separately, the gate assesses the
  entrant's own packs, and the privilege is the entrant's own.
- **Smuggling is marked on goods, and the attempt is the Judge's.** A good
  marked smuggled is not assessed. The entry lists it, and a card tells the
  Judge, who resolves the Smuggling hijink (RR ch. 8, Hijinks). Nothing is
  thrown and nothing is confiscated.
- **Sneaking in is the party's choice and skips the toll** (step 3). One
  tick sneaks the whole party in: no toll, no tariff, everything it brings
  smuggled. Goods marked smuggled one by one still pay the toll, because
  the toll falls on the transport that comes through the gate.
- **The Ruler's Privilege needs its ruler among the members entering.**
  This replaces "the trader or a member of the trader's party" above.
- **The tariff's base is base cost**, as the entry above ruled. The owner
  chose it over the reading taken from the Mercantile Income worked example
  (RR ch. 8, Mercantile Income), which applies the rate to the price the
  venture paid.
- **The feature invents no fee; it exposes the mechanism instead.**
  - The gate's quote is on `acksExtras.markets.gate`.
  - The `acksExtras.marketGateQuote` hook lets the Judge's own script add
    charges, which the trader pays with the book's (MODEL, Ventures).
  - The world's existing levers stay the Judge's: the imported Market
    Characteristics row and a market's class override.

Rejected:
- The per-member muster: each member declared entering, smuggling or
  staying outside, with refusals for a member left undeclared, sent in from
  elsewhere, or paying from a purse the seat does not own. It also split
  the payment purse by purse. It attached the fees to people, which the
  book does not do.
- "Judge sets it" for an item of no merchandise type: the Judge picking its
  type, or exempting it, at the gate. Superseded by "Not assessed".
- Price paid as the tariff's base: the worked example's reading.
- Throwing the smuggling attempt, and confiscating what it fails to move.
  Hijinks belong to the domains feature.

Cost: none for a world's data. The api's entry takes `forSale`, `smuggled`
and `sneak`; an entry posted without them assesses every load the party
brings and smuggles nothing. That is more than the entry above charged
where a member besides the trader stands at the market with loads in their
packs. An entry posted before this release has no `sneaked` field and
resolves as it did.

## 2026-10-23 — A party's characters may enter separately, each with a share of the maximum impact

Builds the choice the entry above kept (RR ch. 8, Entering the Market, step
2, Parties), which it left on the ROADMAP. It narrows one sentence there:
entering separately changes what one entry's gate assesses, not only market
impact, as the gate bullet below says. The new evidence is the owner's
answer on the privilege. Nothing else ruled above is reversed. The owner
answered three questions, and the default on rounding stood unanswered:

- **The count is the party's roster** ("Party roster"): the characters
  `partyMembers` gives, with the trader. The month's first separate entry
  counts them and stores the count, and every later entry that month reads
  it back, even once that entrant has left, so a roster that changes
  mid-month changes no share. Once that many stand or wait entered, another
  separate entry is refused. A party of one has nobody to enter apart from
  and enters as one. Rejected: counting the members at the market, a number
  that moves with each arrival and with each seat's sight.
- **Every class divides the printed maximum**, the family-scaled Class I
  included. The owner chose the parties paragraph's own text over the
  recommendation, which divided Class I's family-scaled maximum. The
  numerator is the imported maximum (`impactLimits().impactCap`), the figure
  the Class II-and-smaller maximum is read from, so no number ships.
- **The share rounds down.** A share of 0 trades down the classes to Class
  VI at impact 1, as any entry too small for its class does.
- **The Ruler's Privilege is the entrant's own** ("Entrant's own only"): a
  character entering separately pays unless they rule the domain themselves.
  This is the entry above's rule, its ruler among the members entering,
  applied to an entry whose only member entering is the entrant, so it
  supersedes nothing. Rejected: a ruler in the party waiving every member's
  separate entry.

Built besides, because the rule leaves no choice:

- A separate entrant's packs and items brought to sell are their own. The
  holds of the entrant's vehicles still bring in the loads stamped for any
  member arriving, so splitting the party passes nothing unassessed.
- A vehicle goes through a market's gate once a month, whoever declares it.
  Otherwise two separate entrants could each count one wagon's capacity
  toward their impact.
- A character not entered beside the party's separate entrants is in no
  venture: they neither solicit nor enter as the party until every separate
  entrant has left.

Cost:

- Entering as one, two members soliciting the same merchandise on the same
  day now share one solicitation: the second is refused while the first
  waits, where before each opened the pool whole (RR ch. 8, Arbitrage
  Trading, step 3, Solicit Buyers or Sellers).
- Two parties can no longer declare the same vehicle at one market in one
  month.
- None for a world's data. A venture row, pool or day stored without
  `entrantUuid` reads as the party's, through the schema's defaults.
- A Judge's `marketGateQuote` handler that ignores the new `separately` in
  its context charges a separate entrant as it would the party.

## 2026-10-23 — The stay is a daily fee the gate figures and the visit's end charges

Builds Moorage and Stabling (RR ch. 8, Engaging in Mercantile Ventures,
RR 372), the last of the gate's fees the entry above left on the ROADMAP,
with the Ruler's Privilege on it. It follows that entry's rule: the module
charges what the book charges and nothing else, and a Judge who wants more
uses the gate hook. Nothing ruled above is reversed. The owner answered
six questions:

- **A land vehicle says how it is stabled** ("Stabled as": wagon, cart or
  not stabled), and the vehicle remembers the answer. Its carriage only
  picks the first answer.
- **Loose animals are counted per row of the table** in the Enter dialog,
  a head count for each.
- **A ship's berth is pro rata** to its size where the imported cell prices
  by size.
- **A stay still standing at the month's end is charged automatically** to
  that day, by the primary GM's month roll.
- **Sneaking in does not escape the stay.** Sneaking avoids the gate, not
  the market's berths and stables.
- **A visit counts both its ends**, as the chapter's Mercantile Income
  example counts. This overrode the default offered, the Arbitrage Trading
  example's exit step, which counts the departure day less the arrival day.

Defaults that stood unanswered:

- Leaving is refused whole while the leaver's purse cannot cover the stay.
- One berth-or-anchor choice covers the whole entry.
- No new hook: the stay rides the gate quote, and a `marketGateQuote`
  handler may set `quote.stay.cpPerDay`. The gate keeps its own lines and
  waiver.
- The time it takes to load at an anchorage or a pasture is not built; it
  stays on the ROADMAP with cargo handling times.
- Each line rounds up to a whole copper a day.
- The leaver pays on leaving; at the month's end the character who
  entered pays. A payer away from the market, short or gone is not charged:
  a card tells the Judge, and the row is settled once.
- A drawn or blank-carriage vehicle starts as a wagon, a carried one as not
  stabled. A wagon marked not stabled does not add its team as loose
  animals.
- Pack animals count twice, in the capacity the toll reads and in the head
  count the stable reads, since the two fees charge different things.

Cost:

- **A world that has not re-imported the Mercantile rules refuses every
  entry that brings anything to stable**, naming the table, until it does.
  A party with nothing to stable never reads the table.
- A ship priced by size with no size recorded is refused (`stayNoShp`).
- A non-primary GM's sweep resolves queued days but leaves stays for the
  primary GM, so a world whose primary GM never logs in settles no
  month-end stays.
- None for a world's data. A venture row stored before the stay reads a fee
  of 0 and is never charged.

## 2026-10-28 — A later printing's demand replaces an earlier one's, and a sideways grid's columns say which market they are

AX1 p.27 prints its settlements' demand sideways: the goods down the side,
six markets across, each column headed by the market's name as text, and no
market class.

**Ruled.**
- **The page imports as one transposed `kind.marketGrid`** (`ax1.marketGrid1`).
  Its rows carry authored band keys, AX3's own column keys, so a Judge's alias
  for a good reaches both books and no key hangs on how a label slugs (one of
  the 31 slugs differently from AX3's key).
- **A column says which market it is in `meta.markets`.** `sameAs` pairs it
  with a later book's market record, as a place pair does: the earlier side is
  the column's market id (`<book>.mkt<n>`), which prints no paragraphs.
  `place` lands it on a place another row builds, or on the book's settlement
  (`"adventure"`); while that place is absent the column waits (`waiting`) and
  never stubs one. Column 1 pairs with `ax3.mkt21`, column 2 lands on
  `ax1.fort`, each named by the hash of its header; columns 3–6 are AX1's own
  markets.
- **One claim joins a pair from all three sides** (`claimMarketPlace`): a
  region site's market, a book's market step and an earlier book's column.
  Whichever lands first, the market ends with the later book's id, name (while
  the Judge has not renamed it), notes, parent, region, class, families and
  base, and the earlier id merged. A column wrote no parent, so a takeover
  leaves the parent the market holds.
- **A later printing's base replaces an earlier printing's**
  (`baseIsImportable`, by `laterBook`). A later book's base, one from a book
  whose year ties or is unknown, and one the Judge set stay. Amends "A setting
  book's market profile lands as the base" (2026-09-29), which wrote the base
  only where it was empty or from the same page. Evidence: the user's ruling of
  2026-10-28 that later printings replace earlier ones' demand, with the
  precedence ACKS II over AX6 over AX5 and down, a later AXIOMS over an
  earlier.
- **A grid-only market whose header is text takes it as its name.** Amends the
  same entry's "a grid-only market keeps its neutral label", whose Cost names
  the reason it held: AX3's rotated names are not text. A market place stamps
  the name it was built under (`printed`), so a later takeover renames it only
  while the Judge has not.
- AX1's fort and AX3's site 28 stay unpaired, as docs/importer/DECISIONS.md
  "A place two books print is joined by the row that arrives second"
  (2026-10-24) ruled.

*Rejected:*
- Creating AX1's column market under AX1's id with AX3's id pre-stamped in
  `merged`. AX1 first and AX3 first would end in two world states, against
  "Later books supersede" (2026-10-17), and `merged` would promise an id no AX3
  page wrote.
- Binding column 1 to an AX3 grid row. Two of AX3's grid keys hold another
  market's figures (Cost).
- A stub for the fort. The places step patches a held place's parent and never
  reads its page, so the fort's text would never land.
- Precedence for class and families. Neither carries a source, and AX1 prints
  neither.

*Cost:*
- The pairing is by header hash alone; figures are not identity. Column 2
  matches AX3's grid row 20 on all 31 cells, column 3 row 23 and column 6 row
  17 likewise; column 4 matches none (26 of 31 at best). So the fort and AX3's
  market 20, and two AX1 markets beside AX3's markets 23 and 17, are each two
  actors carrying one market's figures until a reviewer pairs them.
- Column 1 matches AX3's grid row 22 on all 31 cells and row 21 on 15; column
  5 matches row 21 on all 31. AX3's row keyed `mkt21` holds another market's
  figures, so until AX3's grid keys are corrected its market step writes them
  onto `ax3.mkt21`, and they replace column 1's base in every order. AX1's
  minor holds for that fix (docs/importer/ROADMAP.md).
- AX2 to AX6 share a year, so between them nothing replaces; the user's order
  among them waits on a tie-break `laterBook` does not have.
- A transposed grid's unmapped and duplicate reports name a good by its key,
  not by its printed label.
