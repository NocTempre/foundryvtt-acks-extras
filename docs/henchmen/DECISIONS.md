# Henchmen & hirelings — decision record

Why this feature is shaped the way it is: what was ruled, what was rejected, and
what it cost. How it behaves *now* is [MODEL.md](MODEL.md); unbuilt work is
[ROADMAP.md](ROADMAP.md).

Entries are dated and append-only. A superseded entry stays, marked.

---

### Two repair macros retire into the code that made them unnecessary (2026-09-01) — SUPERSEDED IN PART 2026-09-23

**Superseded in part by docs/lib/DECISIONS.md, "One standing repair tool".**
A standing repair tool now ships beside the source fix, and this reference
repair is one of its checks (`henchmen.references`, wrapping `repair.mjs`).
Both macros stay retired, and the sweep at ready stays.

User direction: fix the bug, do not ship a script that repairs it.

**Repair Henchmen References.** It swept dangling ids out of `system.henchmenList`,
the shape that makes core's `getTotalWages` throw on a deleted hireling and takes
the whole character sheet down with it. Core has no deletion cleanup of any kind,
so the ids accumulate; but this module has carried the durable answer since
`repair.mjs` landed — a `preDelete` prune that clears the list entry, the monster
list and `managerid`, a sweep at ready under `autoRepairReferences` (default on),
and a libWrapper guard on `getTotalWages` itself. The macro added a preview
dialog and a token-scoped run; it added no capability. **Ruled: retired.** The
API stays exposed (`acksExtras.henchmen.repair.*`) for a Judge who turned the
setting off.

**Forgive Wage Arrears.** It repaired worlds billed for every month since
worldTime zero. The three read sites have guarded on `last == null` for some
time, and `enrollNewcomers` starts an unenrolled hireling's clock from today, so
the bug is not reachable through any shipped path. It was still reachable
through the DATA MODEL: `hiredTime` and `lastPaidTime` were declared with `int()`,
whose initial is **0**, so materializing a record for an unenrolled hireling
produced two wage clocks reading the epoch — `0 == null` is false, and every
guard is defeated. No in-repo caller did that, but `getRecord` is public API and
the model is where the contract is supposed to be written down. **Ruled: both
fields become nullable (`num({ integer: true })`), so "never enrolled" survives
materialization**, and the macro retires. `forgiveWageDebts` stays on the API and
in the roster — writing off back wages is a thing a Judge does on purpose.

**Rejected:** treating `lastPaidTime === 0` as unset in the ready sweep. In a
world genuinely sitting at worldTime 0 that silently re-adopts legitimately
hired henchmen.

### Recruiting needs no GM client online (2026-07-22)

User direction. A location is a public bulletin board: new location actors
default to OWNER ownership so players can post searches, run due processing and
hire without a GM logged in. The sheet still hides GM-only tabs from players, and
explicit ownership in the creation data always wins, so a stricter table can set
it down by hand.

The routing rule that falls out of this is **local-first**: a seat that can write
the location applies the result directly; a seat that cannot falls back to the GM
socket relay. Both paths exist because the ownership default is a default, not a
guarantee.

---

### Exactly-once hiring under duplicate socket delivery (2026-07-22)

Found live: the same resolution reached every socket of the addressed GM user —
a GM with two windows open, or a co-GM — and produced **two hires, two actors,
12 ms apart**.

Defence in depth, because neither half is sufficient alone:

- an in-flight key kills same-client duplicates;
- a persisted **claim** settles cross-socket races — each roll carries a
  `resolutionId`, the applier writes it on the candidate, waits a settle beat so
  every claimant's write lands, re-reads, and only the socket whose id survived
  applies.

A related case: multiple open dialog instances for the same candidate each report
the shared completion. Identical resolutions reported inside a short window
collapse to one.

---

### Commit the hire before enriching it (2026-07-23)

Found live: an aborted enrichment step made hiring look broken. The actor
existed, but the candidate was still listed as available.

So the market commit happens **first** — once the actor exists, the candidate is
taken. Everything after (grants, roster link, record, loyalty) is enrichment, and
a failure there must never leave a phantom "available" candidate standing beside
a real hired actor.

---

### Late market rolls schedule from the roll, not the month start (2026-07-23)

User report. When a month is rolled after its start — the clock jumped, or nobody
processed — backdating arrivals to the month start expired whole cohorts
instantly, giving each one week of visibility. Arrivals now schedule from the
roll time. On-time rolls keep the RAW week 1/2/3 pacing.

---

### A directed search finds a person, and finds them now (2026-07-23)

User model, after a live report. A pending future-week arrival that stayed
"pending" was invisible and unhirable — the search had found somebody the
recruiter could not talk to. A directed result is available immediately and for
the whole month.

Directed results are **private to the recruiter** (JJ 118) and live in the
Recruitment tab's directed bucket, not the shared walk-in tabs. Employer-less GM
posts stay shared.

---

### The empty-uuid guard on directed purge is load-bearing (2026-07-23)

User report, reproduced live. A recruiter's previous directed results purge on
re-roll. An employer-less posting carries `""` as its uuid — and an unguarded
match against the shared pool's empty `privateToUuid` deleted **the whole fresh
month**.

The guard is not an optimisation. It is the difference between purging one
recruiter's stale results and purging the market.

---

### Proficiency modifiers are discovered, never listed (founding)

Mechanics live as Active Effect changes on proficiency/power Items, not as
hardcoded proficiency lists. Any effect change keyed
`flags.acks-extras.<domain>` — this feature's domains only, tested by membership
— contributes to that modifier domain, with per-effect metadata read from the
effect's own flags.

**Graceful degradation:** items named like the classic book proficiencies that
carry no effect changes in this feature's domains are still recovered, via the
name regexes in `config.NAME_FALLBACKS`. A world that never set up effects still
gets the common cases.

The membership-vs-prefix test is a repo-level rule — see
[../DECISIONS.md](../DECISIONS.md) § *`EFFECT_PREFIX` collapse*.

---

### The location sub-type belongs to the location feature (2026-07-19)

henchmen declared its own `location` sub-type and sheet. That collision, and its
resolution, is recorded in [../location/DECISIONS.md](../location/DECISIONS.md).
What remains here is the consumer side: the recruitment engine reads and writes
`system.market.*` on a location it does not own, and refuses a place that has no
market subtree at all.

---

### Reaction effects are shared with influence (founding)

Hiring rolls honour the influence feature's Active Effect reaction convention
(`flags.acks-extras.reaction` plus its `situational`/`tone`/`label` flags), so an
effect written for social rolls feeds hiring without being written twice. This is
why influence imports before henchmen in `scripts/module.mjs`.

---

### Attributes outside Foundry's allowlist are set from the render callback (2026-08-05)

Found in the field. `inputmode="numeric"` on the "Hire as Group" troop-count
inputs never reached the DOM. `DialogV2` runs a string `content` through
`foundry.utils.cleanHTML`, and `CONST.ALLOWED_HTML_ATTRIBUTES.input` is
checked/disabled/name/value/placeholder/type/alt/height/list/max/min/readonly/
size/src/step/width/required. `inputmode` is on neither that list nor the global
one, so it was dropped silently — no error, no warning — and a tablet opened the
alphabetic keyboard over a number field.

The rule for this feature: **an attribute outside Foundry's allowlist is set as a
property from the dialog's `render` callback, never written into DialogV2 string
markup.** The callback holds the real elements and runs after the sanitiser, and
one callback per dialog carries all of it. Two traps make eyeballing unsafe, so
check candidates against the table in `resources/app/common/constants.mjs`
instead: the allowlist is per-tag with a separate global list, and the matcher is
built as `^a|b|c$` with no grouping, so every alternative but the first and last
matches as an unanchored substring — attributes pass or fail for reasons the list
does not read like it says.

Rejected: passing `content` as an `HTMLDivElement`, which skips `cleanHTML`
entirely. It would carry any attribute through, but it discards the sanitiser for
markup built by interpolating candidate and employer names, and every dialog in
the feature is string-content — the trade is one silent presentation bug for a
class of escaping bugs across the whole surface.

A sweep of every DialogV2 `content` string in `scripts/henchmen/apps/` against
the real allowlist regexes found no other dropped attribute.

---

### The ready-time table check names only ids an import can supply (2026-08-05)

Field report: every world load warned `rules tables not installed (followers,
monsters)`, and the reporter read it as a load-order fault — the check running
before the tables were mirrored in.

It is not. `scripts/location/module.mjs` mirrors the persisted set from its
`init` hook, synchronously (`table-store.mjs` `registerPersisted` is a plain
loop, no await), and this check runs at `ready`. Those are different phases, so
the registry is always fully populated by the time the check runs, whatever the
import order in `scripts/module.mjs`. The warning's own text proved it: it named
two ids out of eight, so the other six were present.

The real fault was that `RULEDATA` listed two ids no GM could ever satisfy.
`acks-importer` defines extraction recipes for equipment, rarity, wages, people,
slavery, settlement and availability — there is none for `followers` and none
for `monsters`. So the notice was permanent, unclearable, and told the GM their
market and wage automation was disabled when it was not.

The rule: **`RULEDATA` holds only ids an import path can actually supply**, which
makes it exactly the set already declared through `expectTables`. `monsters` was
additionally dead — nothing in the tree read it. `followers` is still read, but
gates at the point of use in `apps/followers-dialog.mjs`, where the message can
name the pages to import instead of shouting at world load. Re-add an id here,
with its `expectTables` declaration, when a recipe for it ships.

Rejected for this fix: a "notice seen" world flag. A new setting takes the change
out of hotfix range, and once the list is honest the notice clears itself the
moment the GM imports.

Deferred, and still open: `hasDoc` tests document presence, not table coverage,
and this module registers its own `rarity` doc (`RARITY_AUTOMATION`) at SAMPLE
priority — so `hasDoc("rarity")` is true in every world and the check can never
report a genuinely missing rarity import. Counting `Object.keys(doc.tables)` does
not fix it either: `RARITY_AUTOMATION` ships one table, so the count is always
≥ 1. Closing it needs an intersection against `expectedTables()`, which makes a
warning appear where none did before — a minor, not a patch.

---

### Attitude and slander match conventions, and share no primitive (2026-07-22)

Two social edges — influence's **attitude** (character → character) and this
feature's **slander** (party or character → location) — are the same shape, a
directional edge keyed by a soft uuid, and are built to matching conventions
on purpose: soft references that degrade to a stored display name rather than
throwing on a deleted endpoint; held on whichever side owns the governing
query (the influencer for attitude, since it is one person's stance; the town
for slander, since RR 162's penalty is the town's); survive endpoint deletion
as tombstones; and each exposes a visible ledger, open/transfer/delete, and a
namespaced change hook (`acksExtras.influenceAttitudeChanged`,
`HOOKS.SLANDER_CHANGED`).

**Rejected: a shared cross-feature relationship registry.** The two edges
differ enough in what they key on and who reads them that a shared primitive
would have bought conformity at the cost of an abstraction neither store
actually needs — each feature keeps its own store, and only the shape agrees.
A graph/map VIEW over both is a different question; see
[ROADMAP.md](ROADMAP.md).

### Rarity overrides are rows on the market, not a second table variant (2026-09-16)

**Ruled:** a location's market carries `rarityOverrides` rows
`{classKey, rarity}`, consulted before the rarity table on every directed
search (`overrideRarity` in `rules/availability.mjs`); the location sheet's
GM Settings edits them beside the variant picker.

**Why.** A town where wizards are common is a fact about the town, and the
Judge who knows it types it on the town's sheet rather than registering a
whole table variant that differs from `default` by one row. The seam was
already there — `shiftRarity` and the variant argument — and this is the
untaken half of it.

**Cost:** two places can now say a class's rarity; the row wins, and the
sheet shows the rows beside the variant so nothing is hidden.

### Unit morale interpretation stays with the Judge, not auto-verdicted (2026-09-22)

*Superseded 2026-10-01 by "A hired unit rolls morale on the Combat Morale
page" below.*

Recorded from the comment on `openUnitMoraleDialog` in `scripts/henchmen/apps/unit-morale-dialog.mjs`.

**Ruled.** The dialog posts the 2d6 roll and total to chat; it does not look up an outcome band itself, so the Judge reads the result off the table by hand.
**Rejected.** Auto-resolving the outcome band, because the book's morale scales are close enough to one another that an automatic pick risks applying the wrong one.

### Directed searches replace pool members, and contend most-specific-first (2026-09-22)

Recorded from the `specSpecificity`, `applyDirectedReplacement` and `createPosting` comments in `scripts/henchmen/engine/recruitment.mjs`.

**Ruled.** A successful directed search (JJ 118-119) replaces rolled leveled henchmen still left in the month's shared pool rather than minting new people. When several directed searches contend for the same month, the more specific resolves first — class+level, then class, then class+proficiency, then general proficiency — random order on ties.

### A month roll never fires against an unloaded table registry (2026-09-22)

Recorded from the month-anchor guard comment in `processLocation` (`scripts/henchmen/engine/recruitment.mjs`).

**Ruled.** Rolling a new market month replaces the whole shared pool, so the roll is skipped whenever the availability tables are not loaded in the registry (a world relaunch, a GM leaving, or a module update can leave it momentarily empty) rather than proceeding and persisting a zero-candidate market over a full one. The existing market stays intact and the roll retries on the next process pass; the Reload button forces an earlier retry.

### Insufficient wages is a stop, not a silent miss (2026-09-22)

Recorded from the guard comment in `payWagesFor` (`scripts/henchmen/engine/events.mjs`).

**Ruled.** When the employer's gold is short of the total due and the caller has not explicitly asked to mark wages missed, pay stops entirely: no payday is recorded, no arrears accrue, and no calamity fires. The GM can sell something and press Pay again, pay by hand, or press "Mark missed" meaning it.

### Candidate class and level are fixed at the market roll, not at hire (2026-09-22)

Recorded from the design-rule comment on `scripts/henchmen/rules/candidates.mjs`.

**Ruled.** A candidate's class and level are fixed when the monthly pool is rolled — the market offers what it offers, subdivided into weekly arrival tranches — with no per-candidate reroll surface. Attributes are rolled once, at hire time, and recorded.
**Rejected.** A per-candidate reroll surface, which would let a recruiter re-roll until a better class or level came up.

### Wage pay-period conversions match the influence feature's bribe tiers (2026-09-22)

Recorded from the comment on `signingBonusCost` in `scripts/henchmen/rules/wages.mjs`.

**Ruled.** A week's pay converts to monthly ÷ 4 and a day's to monthly ÷ 30 (the book names the periods, not the arithmetic), matching the influence feature's bribe-tier conversions so both rollers price a period identically.

### History the source comments carried, recorded (2026-09-22)

These were written into code comments as the reason a guard exists. The
comments now state the guard; the story is here.

- **`checkWagesDue`'s due-total sum.** It once reduced over a key `dueHirelings` never wrote, producing NaN on the wages-due card in every world; it now sums the same list Pay itself bills.
- **`HenchmanRecord`'s field-builder import.** `num`/`str`/`int` were a verbatim copy of `location-data.mjs`'s leaf builders before both were consolidated onto the shared `lib/fields.mjs`.
- **The location schema migration's version markers.** The migration that clears old-shape postings/candidates dates to the v2 schema change that moved availability from per-posting pools to the location's shared market; pre-0.3.0 test data predates that change and cannot be converted.
- **`installWageGuard`'s libWrapper registration.** It replaced an earlier hand-rolled raw patch; libWrapper's own idempotence now does the job that patch's idempotence check did by hand.
- **`generateOccupation`'s occupant path.** A retired `people.occupations` category table backed it before the street-column/sub-table system replaced it; the old table is orphaned by that migration and no longer read.

### A troop prototype is created through the base `Actor.create` (2026-09-30)

**Ruled.** Hire as Group creates each troop type's prototype with `Actor.create`, as a single hire already did. `Actor.implementation.create` runs the system's static `create` override, which replaces create-time `system` on any actor created without `items` and seeds a character's coins, so every group hire until 9.3.3 stacked a first-level, classless 1d8 body carrying coins whatever the market row said. `findOrCreateGroup`'s comment had blamed the group's data model for the same loss; the post-create update it describes stays.
**Rejected.** Passing `items: []` to `Actor.implementation.create`. It dodges the override as well, but it keeps the unit's correctness hanging on the override's own test for `items`.
**Cost.** A unit hired before 9.3.3 keeps the stat block its stacks copied. The Judge corrects one by editing the troop actor and dropping it onto its stack on the group's sheet, which re-points the stack and keeps its headcount.

### A hired unit rolls morale on the Combat Morale page (2026-10-01)

Supersedes "Unit morale interpretation stays with the Judge, not auto-verdicted" (2026-09-22).

**Ruled.** A group actor's **Roll Morale** opens the influence roller's `morale` page (RR 307) with the group as its subject and its command morale as the rating, and the unit-morale dialog is gone. The obedience throw's rows and result column left `throws-data.mjs` for the same page family (`docs/influence/DECISIONS.md`, "The morale pages read the Judge's table, and post with no result when it is absent"), and the shipped obedience macro calls `openObedienceRoll` so it reaches that page.

**What changed since the superseded entry.** That entry kept the dialog from naming a result because the module could not tell which morale scale applied. The page now names a result only from the table the Judge imported for it, and names none when the table is absent, so the risk it guarded against is carried by the import rather than by silence. The dialog also asked for one typed number and showed no list of what had been added, which is what the owner's 2026-10-01 ruling asks every morale roll to show.

**Rejected.** A Unit Morale page of its own (RR 468): `docs/DECISIONS.md` §15 puts the battle rules out of scope.

**Cost.** A world that imported the "Obedience Check (Selected)" macro before this release keeps a copy that opens the bare throw dialog, which now rolls the morale score alone and names no result; re-importing the macro from the compendium replaces it.

### A wage is paid into the purse, and a refused payment books no payday (2026-10-01)

Follows docs/location/DECISIONS.md, "2026-10-01 — Banked is not a state coin
can be in", and docs/lib/DECISIONS.md, "Currency is one stack with one count,
weighed by how many make a stone (2026-10-01)".

**Ruled.** Wages land in the hireling's purse. The `wagesToBank` setting is
removed with the field it chose: there is one place a wage can land.
`getGold`, `spendGold` and `grantGold` delegate to the lib (`purseGp`,
`transferCoin` or `sinkCoin`, `transferCoin` or `mintCoin`) and keep no
denomination handling of their own. A wage transfer that is refused records
no payday.

**Rejected.** Keeping the setting with a vault as its second choice: a
hireling's vault is a place per hireling, and a monster keeps none. Recording
the payday when the transfer refused: the record then said a month was paid
that no coin moved for, which is what the earlier code did for a unit standing
away from its employer.

**What it cost.** A hireling's wages weigh on them. A world that set
`wagesToBank` off sees no change; one that left it on has its hirelings'
banked wages moved at the next load, a character's to a vault and a monster's
into its purse (the location feature's sweep).

### A wage draws on what the employer can pay with, and the hook reports what moved (2026-10-01)

Follows docs/lib/DECISIONS.md, "Coin is kept in stores, and a holder states
their order (2026-10-01)". Amends "A wage is paid into the purse, and a
refused payment books no payday (2026-10-01)", ruled the same day. The new
evidence is that lib ruling, which the earlier entry did not have, and a
part-paid wage read back from the record: the hireling's log named the whole
wage as paid and the `wagesPaid` hook totalled what was billed, where part of
it had been booked as owed.

**Ruled.**
- *A wage states no reach.* It takes the world's standing reach on both
  sides: an employer's coin at a place pays a wage where the setting allows
  it, and a hireling's order may send the wage to a place. `getGold` reads
  what a payment may draw on (the lib's `spendableGp`), so the check that a
  payday can be covered counts the stores the payday then draws on.
- *A hire is paid where it is made.* A signing bonus and a week's recruiting
  fee state the market (`within: location`): coin on hand, or kept there
  (docs/markets/DECISIONS.md, "2026-10-01 — A market takes coin on hand or
  kept at that market").
- *A part-paid wage is logged as part-paid.* The hireling's log line names
  what moved and what is owed.
- *`wagesPaid` reports what moved.* Its `total` is the coin that left the
  employer and `arrears` what was booked as owed instead. `wagesMissed` is
  unchanged.

**Rejected.** Keeping `total` as the billed sum with the coin moved beside
it: a listener that books `total` as spent would book coin that never left.
A wage that states the hireling's place: a hireling has none, and an employer
pays a roster wherever it stands.

**What it cost.** A listener written against 10.0.0 reads a smaller `total`
on a payday that booked arrears. The earlier entry's sentence on what
`getGold` delegates to no longer holds: it reads `spendableGp`.

### Pay wages is one payday on either sheet, and it pays what is due (2026-10-01)

**Found (live walk).** Pressing Pay wages on the Followers tab moved coin off
the employer and onto nobody. The control called core's `payWages`, as it had
since the module's own character sheet shipped, and the system sheet's
Hirelings button calls the same method. Core's method takes a month's total
off the coin rows on the employer, lands it nowhere, records no payday and
posts a chat card; the wage clock, which is this feature's, then bills the
same month again. The line beside the control read "wages due" over core's
monthly total whether or not a month had gone by.

**Ruled.**
- *One payday.* Core's `payWages` is wrapped and never called
  (`installWagePayment`); a character's payday is `payWagesFor`, from the
  Followers tab, the system sheet, the roster and the Judge's wage card
  alike. The wrap is this feature's for the reason the `getTotalWages` wrap
  is ([MODEL.md](MODEL.md) §4b).
- *It pays what the wage clock says is due*, and says so when that is
  nothing. `wageBill` is the one reading of what is due and what a month
  costs, and the Followers line prints the first when something is due and
  the second otherwise. The control is drawn only while something is due.
- *A payday the seat cannot write is the GM's to run.* It writes every
  hireling's record and every unit's, which a player's seat may not own. Such
  a seat hands the payday over whole (`henchmenPayWages`); the GM's seat
  checks that the sender owns the employer and takes nothing else on trust.
  Marking a month missed stays the Judge's and is never handed over.
- *The seat that pressed is told.* One notification: nothing due, not enough
  coin, not yours to pay, or what was paid and what is still owed.

**Rejected.**
- *Leaving the system sheet's button on core's method.* It is the same button
  to the person pressing it, and it destroyed coin.
- *Calling core's method and then booking the payday.* Its coin leaves the
  rows on the employer whatever their order says, a lock included, and lands
  nowhere; the hireling would be paid in the record and not in the purse.
- *A control that pays a month ahead of the clock.* The wage is monthly
  (RR 168) and the wage clock bills the whole months that have gone by; a
  prepayment would need a credit on the record that nothing reads.
- *Relaying only the writes the seat lacks.* A relay that failed would leave
  a payday half recorded.
- *Keeping the chat card.* It announced a month's total to the table whether
  or not that was what moved.

**What it cost.** A table that does not advance the world clock can no longer
take a month's wages with the button: it answers that nothing is due. Coin is
handed over on the sheets, or the clock is advanced. The public "pays wages"
card is gone, and the hireling's log, the notification and the `wagesPaid`
hook are what record a payday. One more socket handler is registered, and a
relayed payday fires its hook on the GM's seat, not the one that pressed.
