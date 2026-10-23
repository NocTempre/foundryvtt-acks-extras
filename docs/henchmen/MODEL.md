# Henchmen — Data Model & Integration Contract

How this feature stores data, how proficiencies/powers plug in, and how other
features extend it. Companion to the local rules extract
(`acks-rules/acks-henchmen/RULES.md`, kept outside the repo).

## 1. Design rules

- **Never write the core system's schema** outside `scripts/acks-adapter.mjs`.
  Sanctioned writes: `system.retainer.*` fields, and roster changes via the
  system's own `addHenchman`/`delHenchman`. Coin is not among them: the
  adapter's `getGold`/`spendGold`/`grantGold` are callers of the lib's money
  surface (docs/lib/MODEL.md, "Currency") and write no coin row themselves.
- **Reuse the core hireling plumbing**: hired candidates become real `character`
  actors with `system.retainer.{enabled, loyalty, wage, managerid, category,
  quantity}` set and are pushed into the employer's `system.henchmenList` by
  core `addHenchman` — the stock Hirelings tab keeps working.
- **What kind of hireling an actor is** — henchman, mercenary or specialist —
  is that `retainer.category`: the sheet shows it and core's Hirelings tab
  sorts by it. A hire keeps it and writes the record's `terms.wageBasis` to
  match. Only a henchman's missing wage falls back to the ladder (§4c), and
  only a henchman takes a share of experience (`formation/xp-shares.mjs`).
- Module-owned data lives in **module flags** (hirelings) or a **module actor
  sub-type** (locations). Rules math is pure (`scripts/henchmen/rules/`), fed by
  table documents read through `acksExtras.lib.tables`. **No table ships**: a
  world gets its numbers by importing them from the GM's own book through
  `acks-importer`, and the feature shows a stub plus an import pointer until it
  has them.

## 2. The `acks-extras.location` actor sub-type

One actor per settlement (see `scripts/data/location-data.mjs`):

| Field | Meaning |
|---|---|
| `marketClassOverride` / `urbanFamilies` / `domainUuid` | Market-class derivation inputs: override → urban-families bracket (RR 352, local table) → acks-domains courtesy read → default IV. Derived getter: `system.marketClass`. |
| `classRarityTableId` | Which JJ class-rarity variant applies (`default`, `jutland`, or setting-specific additions). |
| `rarityOverrides[]` | `{classKey, rarity}` — the Judge's word on a class's rarity in THIS market, consulted before the variant on every directed search (`overrideRarity`). |
| `desertRealm`, `compositeVariant` | Camel-troop gate; composite-vs-longbow either/or (RR 164). |
| `postings[]` | One per paid search spec: monthly pool (`totalAvailable`), 3-week `arrivalPlan`, `feesPaid[]`, `monthStartTime`, `status`, `network` (searched with the employer's mercantile network). |
| `candidates[]` | Plain records (NOT actors): identity, rolled attributes/class/level (feature 4 — recorded, not generated), wage, `availableFromTime`, `status`, `refusals[]`, `networkFor` (only that employer's network reaches them). |
| `networkRolls[]` | One employer's roll of a segment at their network's class, once per market month: `{employerUuid, segment, monthStartTime, marketClass, total, detail}`. Cleared at the month roll. |
| `slander[]` | Refuse-and-slander registry — the per-town slander count (RR 162). |
| `searchLedger[]` | Fee history. |

**Extension point**: future domain-family modules (structures/strongholds…)
attach their own data to the same location actor under their own flag
namespace (`actor.flags["<their-module>"]`) — this schema stays minimal.

**Slander** is a structured **subject**, not a single-scope flag:
`{scope: "all"|"party"|"character", uuid}` held once per entry on the
location, so a party-scoped slur and a character-scoped slur against one of
its members are two distinct entries rather than one double-tallying the
other. `slanderCountFor({employerUuid, characterUuid})` matches each entry
against at most one branch (`scope==="all"`, or `uuid` equal to the
employer/party, or equal to the character) and sums in a single pass.
Refuse-and-slander (`recruit-dialog.mjs`) writes `{scope:"party", uuid:
employer.uuid}`; the location sheet's ledger adds and edits arbitrary rows,
default `{scope:"all"}`. The read side — "where am I slandered" — is
`acksHenchmen.slanderedAt({employerUuid, characterUuid})`, a scan over
location actors, not a second store.

**Henchman levels.** The levels a market stocks are the ones the imported
`availability.henchmanAvailability` rows list (`rules/availability.mjs >
henchmanLevels`), lowest first, a row the import could not read left out:
the month roll's henchman segments (`allSegmentSpecs`), the segments a
general henchman posting reaches (`postingSegments`) and the posting
dialog's **Level** options all read it. Until the table is imported the list
is empty, as the mercenary and specialist lists beside it are.

**Bulk rows.** Mercenaries, and specialists whose largest market counts them
by a multiple, arrive as one candidate row per week with a `quantity`
(`isMassSpec`, `engine/recruitment.mjs`). An offer names how many of the row
it reaches, and each head answers for itself (`rules/bulk-offer.mjs`): the
hiring page rolls the first head, the same seat rolls the rest with the same
modifiers on the imported hiring column and posts them on one card, and the
GM side splits the row by answer (`splitBulkRow`). The heads not offered keep
the row's id; each answer is a row of its own with the original's segment,
arrival time and wage, a refusal recorded on the refusing rows, `slandered`
on the slanderers' (one `slander` entry per head). The accepting heads are
hired as one actor of that `quantity`, the élan heads as a second, and a
signing bonus is paid per head hired. A unit assembled by Hire as Group takes
its count the same way (`takeFromRow`): the taken heads are a hired row, the
rest stay on the market.

**The hiring figures.** The Reaction to Hiring Offer's result column and the
figure each earlier refusal and each slander adds are the influence feature's
imported `hiringOffer` table (`docs/influence/MODEL.md`, "Printed pages"),
read here by `rules/hiring-offer.mjs`. The hosted hiring page, this feature's
own `reactionToHiring` throw (handed the column as `outcomes` and the two
figures as `stepValues`), a peaceful monster offer, every further head of a
bulk offer and the core influence roller's slander row all read it, so no two
of them can answer on different edges. The `throws` config carries none of
it; a throw that needs a figure the world has not imported warns and does not
open, and the core roller's slander row is a note giving the count.

**A network posting.** A posting made with the employer's mercantile network
(`network`; the posting dialog offers it to a holder and ticks it where the
markets feature counts the market as known to them) reads the market at the
class `effectiveMarketClass` gives that employer. A directed search rolls at
that class. A generic posting keeps the town's shared pool and adds, for each
segment it reaches (`postingSegments`), what a roll at the network's class
finds beyond the town's roll (`networkSupplement`). Those people are ordinary
shared-pool rows (they arrive by week, churn weekly and go with the month)
stamped `networkFor`: only that employer's owners see them on the location
sheet, and only that employer hires them (`hire`, Hire as Group, and the
recruit dialog before any roll). Each segment rolls once per employer per
market month, the roll kept in `networkRolls` so a notice taken down and
posted again finds it. The weekly fee is charged at the class the search
reads (`feeMarketClass`); without the network it is the town's.

## 3. `HenchmanRecord` (hireling flag)

Serialized DataModel at `actor.flags["acks-extras"].record`
(`scripts/data/henchman-record.mjs`):

- `origin`, `locationUuid`, `settlementName`, `employerUuid`, `hiredTime`.
  `enrollHenchman` (`engine/hire.mjs`) puts an existing character on a roster
  with no hire behind it, as an imported official sheet does: origin `manual`,
  no location, the loyalty start set so the henchman reads the score given
- `rolled.*` — recorded roll results (attributes 3d6×6, double-d100 class,
  1d20 level, template) for the future class-autogeneration module
- `terms.*` — wage + basis, shares (½/½), signing bonus, `lastPaidTime`,
  `arrearsGp`, `vassalDomain`
- `loyalty {start, permanents[]}` / `morale {base, permanents[]}` — the
  ledgers; **effective scores are computed at read time** (base + permanents +
  employer CHA + employer effect bonuses) so transfers recalculate (RR 163).
  Each entry carries `compensated`: RR 166 penalties (permanent wounds,
  tampering side effects) apply only *while uncompensated*, so the Judge
  suspends one from the roster ledger and it stops scoring **without leaving
  the record**. Nothing sets it on its own — not even the wage-arrears repair,
  which compensates instead of deleting so the forgiveness stays auditable and
  reversible
- `counters {calamities, levelsGainedInService, startLevel}`
- `events[]` — capped log (hired, calamity, rolls, wages, wounds, transfer…)
- `special {skipCalamityLoyalty, noSlot, pendingCalamity, irrefusableResult}`

Employer-side flags: `monsterHenchmenList[]` (monster roster — core
`addHenchman` accepts only characters), `retainBonus` (manual extra slots),
`apparent {monthlySpendGp, lastCheckTime}`.

The henchman limit (`acks-adapter.mjs > getRetainMax`) is the imported base
(`wages.henchmanLimit`, RR 168, read by `rules/wages.mjs > henchmanLimitBase`)
plus the employer's Charisma modifier (`system.scores.cha.mod`), plus the
typed `retainBonus` effects, plus that manual flag. An employer with no
Charisma score (every actor but a character), or a world that has not
imported the base, has no limit: `max` is null, no hire is refused or warned
for it, and the roster shows the limit as unknown. `checkHenchmanLimit`'s
`why` (`acks-adapter.mjs > retainGap`) says which gap it is, the actor's own
first, and the roster tooltip names it.

The highest henchman level an employer may seek
(`rules/wages.mjs > maxHenchmanLevel`) is the imported ladder
(`wages.employerLevelCap`, RR 168): rungs of employer levels, each with the
level it allows, the last open above and rising by its `perLevel` for each
level past its floor. A domain ruler may seek any level below their own,
whatever the ladder says. The posting dialog judges a leveled henchman search
against the level the candidates believe the employer to be, the presented
one where a level is presented, and refuses a search above the cap. Where
the world holds no rung for that level the cap is null and nothing is
refused.

## 4. The Active Effect contract (data-driven modifiers)

**Mechanics live on proficiency/power Items as Active Effect changes — never
hardcoded name lists.** Any effect change keyed `flags.acks-extras.<domain>`
feeds that domain (`scripts/effects.mjs` collects them at each roll or
computation):

| Change key (`flags.acks-extras.`) | Feeds | Example |
|---|---|---|
| `hiring` | Reaction to Hiring Offer rolls | Diplomacy, Beast Friendship (animals) |
| `loyaltyRoll` / `moraleRoll` / `obedienceRoll` | those 2d6 throws | Inspire Courage (morale rolls) |
| `retainBonus` | henchman limit (Charisma + …) | Leadership, Blood of Kings |
| `baseLoyalty` | starting/effective loyalty of hires | Blood of Kings |
| `henchmanMorale` | employer's morale modifier to hirelings | Command, Battlefield Prowess (led) |
| `marketClass` | market-class shift (equipment, hiring, a venture's class option) | Mercantile Network — situational; counted where the markets feature says the market is known to the employer (`docs/markets/MODEL.md`, "Known markets") |
| `moraleBase` | added to hirelings' base morale | Utter Domination |
| `skipCalamityLoyalty` | boolean: no loyalty rolls on calamity | Utter Domination |
| `recruitKinds` | unlock henchman kinds (CSV string) | Beast Friendship → `animal` |
| `reactionRollTwice` | roll 2d6 twice, take better/worse | White Luck Presence |

Effect-level metadata (on the effect's own flags, `flags["acks-extras"]`):

- `condition` — i18n key/text; its presence marks the bonus **situational**:
  roll dialogs render it as a toggle (GM/player decides applicability).
  Without it the bonus is always-on (locked, pre-applied).
- `target` — scope note appended to the label (e.g. "animals").
- `label` — display override (defaults to the effect/item name).

The Judge's tool for a network without a re-import: one Active Effect on the
power with the change `flags.acks-extras.marketClass` (the class option) and,
for ventures, `flags.acks-extras.marketImpact` (the impact option, markets'
key), each with the page's value, and the `condition` flag set.

Interop: hiring rolls **also honor the influence feature’s**
`flags.acks-extras.reaction` effects (with their `situational`/`tone`/
`label` flags). Bribery is detected by name to select the cheaper
signing-bonus scale.

**Imported powers.** No pack ships ready-made items carrying these effects.
The abilities a world holds come from the Judge's own books through the
importer, which writes its typed effect model, not these change keys. For
`hiring` (typed target `reaction`), `retainBonus`, `baseLoyalty`,
`henchmanMorale` and `marketClass` (`effects.mjs > TYPED_TARGETS`), the
collector reads the typed modifiers whose value the importer located on the
power's page (`lib/effect-scan.mjs > abilityModifiers`), wherever the item
carries no Active Effect on that key; for `hiring`, an influence `reaction`
effect on the item also sets its typed value aside. These reads know nothing
of the roll's tone or target, so a typed modifier with a condition, tones or a
target scope is situational; so, on a roll (`hiring`, `henchmanMorale`), is one
from an entry the importer marks unaudited. The limit, base loyalty and class
shift are sums with no row to offer, and take the located value audited or
not. A "See X." power takes X's located value through the importer's alias.

**Presence without a value.** `config.mjs > NAME_PRESENCE` recognizes these
powers by name only to say they are held: no name ever supplies a value. A
power held by name with neither a located value nor an Active Effect on a key
its domain reads (for `hiring`, the influence `reaction` key counts) adds
nothing, and `unvaluedPowers` names it where the value would apply — the
henchman-limit refusal (`hire.mjs > limitReachedMessage`), the roster's note
over the limit and base loyalty, a locked, unticked row at no value in this
feature's own hiring and obedience dialogs (`unvaluedDialogModifiers`), and a
note naming it on the influence-hosted hiring and obedience pages
(`unvaluedNoteRows`, carrying the item's id). For `skipCalamityLoyalty`, which
has no value, presence is the whole of the power.

**On the influence-hosted pages.** The influence roller reads its own change
keys and the abilities' typed values for the page's roll family, and nothing
of this feature's domains. So each opener (`integrations/influence.mjs`)
offers the employer's rows for the domains the page would otherwise miss, as
`ctx.offeredModifiers` (`offeredRows`): `hiring`-key Active Effects alone on
the hiring page, since its influence reaction effects and reaction values are
the page's own reads; `obedienceRoll` and `henchmanMorale` on the obedience
page, whose own reads are the hireling's; `loyaltyRoll` on the loyalty page.
Every row names the item it rides, so the item's typed value on the page
stands aside for it, as here.

## 4b. Core's two wage methods

Core's actor class has two wage methods, and this feature wraps both
(libWrapper MIXED, registered at `init`).

**`getTotalWages`.** Core reads `system.henchmenList` there and dereferences
each id without checking, so one deleted hireling throws inside the character
sheet's `_prepareContext` and takes the whole sheet down. Core has no deletion
cleanup, so the ids accumulate. Three layers answer it, all in `repair.mjs`:

| Layer | What it does |
| --- | --- |
| `registerDeletionCleanup()` | on a hireling's delete, clears its id from every employer's list and any `managerid` naming it — the ids never accumulate in the first place |
| `sweepAtReady()` | one GM-side pass for the ids a world already has, under the `autoRepairReferences` setting (default on) |
| `installWageGuard()` | the wrap on `getTotalWages`: it skips a missing hireling instead of throwing, so a sheet renders even mid-repair |

**`payWages`.** It is what the system sheet's Hirelings tab calls from its Pay
Wages button. Core's method takes a month's total off the coin rows on the
employer, lands it on nobody, records no payday and posts a chat card.
`installWagePayment()` in `engine/events.mjs` wraps it and never calls it: a
character's payday goes to `payWagesFor` (§4c), and for any other actor the
wrap returns undefined, as core's method does. Both sheets' Pay wages controls
therefore run one payday.

**Both wraps live here rather than in `lib/`** — the module's default home for
overrides of core logic — because the methods they replace read
`system.henchmenList` and `system.retainer.wage` and compute a wage from them.
That is this feature's rule, and lib would be owning a henchmen formula. One
owner each: nothing else in the module wraps `getTotalWages` or `payWages`.

A wage clock is never given a numeric initial. Zero is a real `worldTime`, so an
unset clock has to materialize as null or the billing guard cannot tell "never
enrolled" from "hired at the dawn of the world".

## 4c. A payday

**What is due.** `wagedOf(employer)` is the roster entries paid a wage, each
with its record and its monthly cost (a vassal is not among them, nor an
entry whose wage comes to nothing: a mercenary or specialist whose wage is
stated nowhere, or a henchman's before the wage table is imported), and
`unitsOf(employer)` the group actors whose `unit.employerUuid` names the
employer. `dueOf(employer, time)` is what a payday at that time would bill:
each entry whose wage clock is a whole month or more behind, for as many
months as it is behind. `wageBill(employer)` reads those three and answers
`{due, count, monthly, nextDue}`: the gold a payday would bill now, how many
entries that is, what the roster costs a month, and the world time at which a
payday would next bill more than it does now. That time is the nearest month
boundary ahead on any wage clock that has started, and null while none has.
The Followers tab's wage line and its Pay wages control read the bill
([character-sheet MODEL](../character-sheet/MODEL.md)), and a payday with
nothing due tells its seat the days until `nextDue` (`time.mjs` `daysUntil`:
a part day counts as a whole one).

**Where a wage lands.** `runPayday` pays each due entry by `transferCoin` with
`upTo`: the employer's own coins land where the hireling keeps arriving coin,
on the row of their kind, and what the employer's coin cannot represent
exactly books as arrears on the record. A wage states no reach, so both sides
take the world's standing one (docs/lib/MODEL.md, "Currency"); the check that
a payday can be covered reads `getGold`, which counts the same stores. A paid
unit is billed the same way and its coin sits on the group actor, whose sheet
lists it as the unit's purse. An employer reaches the unit it pays through
the unit's `system.unit.employerUuid`, as it reaches a hireling through the
roster.

A part-paid wage is logged on the hireling as what moved and what is owed.

A transfer that is refused (the two are not together) has said why and moved
nothing, so no payday is recorded for that entry, its month stays due, and
the `wagesPaid` hook counts neither the entry nor its gold. When every entry
is refused the hook does not fire, and `runPayday` answers `refused` with the
ids of the actors left unpaid (`payees`) and the `reason` their refusals
share, when they share one.

**Which seat runs it.** `payWagesFor(employer)` is the one entry: the
Followers tab's control, the system sheet's button (§4b), the roster app and
the Judge's wage card all call it. A payday writes the employer, each managed
hireling's record and each paid unit (`payrollOf`). The seat runs it itself
when it is a GM's, or when it owns the employer and every one of those;
otherwise the whole payday is handed to the GM (`henchmenPayWages`), whose
seat checks that the sender owns the employer and runs it from the employer's
uuid alone. Marking a payday missed is the Judge's and is never relayed. With
no GM connected the lib's transport says so and nothing is written.

**What the seat is told.** `runPayday` answers a status and `tellPayday`
turns it into one notification on the seat that asked: nothing is due, the
employer cannot cover the month, the wages are not this seat's to pay, or
what was paid and, on a part-payment, what is still owed. A refused transfer
says why on the seat that ran the payday: the warning is `transferCoin`'s
own. A payday refused whole is therefore told no further on a seat that ran
it. A seat that handed it over is told once, from the answer: the refusal and
who went unpaid where the wording holds a sentence for the `reason`
(`ACKS-HENCHMEN.wage.refusedBecause.<reason>`), and otherwise that nothing
was paid. A handed-over payday that paid some entries and was refused others
tells the asking seat what was paid, and its refusals are said on the GM's
seat alone. No chat card is posted. The `wagesPaid` and `wagesMissed` hooks
fire on the seat that ran the payday, which is the GM's when it was relayed.

A signing bonus and a week's recruiting fee are paid where the hire is made:
they state the market as their reach, so they draw on coin on hand and coin
that market keeps for the employer.

## 5. Time model

Everything is anchored on `game.time.worldTime` seconds. A GM-client
`updateWorldTime` watcher processes every location idempotently (arrival
tranches, weekly fees, month rollover — watermarked, never double-charged).
Months are day-counted via the `daysPerMonth` setting (the v14 calendar month
component advances 0 seconds). Any worldTime clock works — Simple Timekeeping
is the recommended UI; fallback "Advance 1 week" buttons are gated by lib's
world-clock policy ([../lib/MODEL.md](../lib/MODEL.md)), the same switch dungeon
turns obey, and say so in a notice rather than doing nothing when it is off.

## 6. Public API & hooks

`game.modules.get("acks-extras").api.henchmen` (mirrored to `globalThis.acksExtras.henchmen`):
apps (`openPostingDialog`, `openRecruitDialog`, `openThrowDialog`…), engine
(`createPosting`, `processLocation`, `processAllLocations`, `hire`,
`checkHenchmanLimit`, candidate rollers, `payWagesFor`, `wageBill`),
`getRecord(actor)`, pure `rules.*`, `tables`, `adapter`, `effects`, `time`.

Hooks fired (`Hooks.on("acksExtras.<event>", …)`): `postingCreated`,
`candidatesArrived`, `candidateRolled`, `hiringOutcome`, **`hired`**
(`{employer, actor, location, record, candidate}` — the class-autogen
module's entry point), `loyaltyEvent`, `loyaltyRolled`, `calamity`,
**`wagesPaid`** (`{employer, total, arrears, count}` — `total` is the gold
that left the employer, `arrears` what was booked as owed instead),
`wagesMissed` (`{employer, total, count}`), `rosterChanged`.

## 7. Cross-module facts — the "has X" fallback chain

Facts owned by WIP/future modules resolve through a chain, so those modules
supersede transparently later: **module API (if active) → actor flag →
inventory marker item → GM dialog.** Marker items are plain Items on the
actor whose name declares the fact with its value, e.g. `Stronghold: Border
Fort` (cost 15,000 gp), `Domain Income: 350gp/month`, `Syndicate Member:
<boss>`. Used for: follower stronghold prerequisites, vassal-domain wage
waivers, ruffian syndicate loyalty, urban families.

**Social rank** rides the same chain (`getSocialRank`): a domains module's
answer, then the actor flag `socialRank` (a number, or `{rank, title}`), then
a marker item `Rank: 3 (Baron)` — the number is the rung, the parenthesis the
title — or `Rank: Baron` for a title with no rung; nothing stated is null,
never zero. What a title is worth is the Judge's or the module that owns
titles; this feature only reads it. Its consumer is the influence feature's
status row (`docs/influence/MODEL.md`, "The modifier stack"), which reads the
fact through the api at call time.

**Standing moves a market too.** `effectiveMarketClass` adds the factions
feature's `marketClassShift` (asked through the api at call time, never
imported) to the employer's effect shift; at the default setting it is zero
and every market is exactly what the sheet says (`docs/factions/MODEL.md`).
