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

### A payday handed over and refused whole is told to the seat that asked (2026-10-06)

**Found (live walk).** A Player seat that owned the employer and not the
hireling pressed Pay wages with a month due and the one due hireling out of
the employer's reach. The payday went to the GM's seat, the transfer's
warning was raised there, the answer came back as a bare `refused`, and the
seat that pressed heard nothing: no coin moved and the control stayed drawn.
Both sheets' controls did the same. Extends "Pay wages is one payday on
either sheet, and it pays what is due (2026-10-01)", whose list of what the
pressing seat is told left this status out; that walk is the new evidence.

**Ruled.**
- *The answer says what was refused.* A payday refused whole answers the ids
  of the actors left unpaid and, where the refusals share one, the reason the
  transfers gave.
- *The seat that handed the payday over is told once*, from that answer: the
  reason's sentence with the names where the wording holds one, and otherwise
  that nothing was paid.
- *A seat that ran the payday is told nothing more.* Each refused transfer
  warned there as it was refused.

**Rejected.**
- *Sending the GM seat's sentence back.* The seat that asked words its own
  notification, in its own language, from the reason.
- *One voice for every seat: the payday checks reach itself and the transfer
  stays silent.* `transferCoin` raises its refusal wherever it runs and has no
  quiet form, and a payday that checked reach first would hold a second copy
  of the lib's gate.

**What it cost.** A seat that runs its own payday still hears one warning for
each refused transfer, not one for the press. A handed-over payday that paid
some entries still says only what was paid ([ROADMAP.md](ROADMAP.md)). The
refusal has a sentence here beside the lib's own for the same reach.

### A payday that is not yet due says when it will be (2026-10-06)

**Found (field report, then a live walk).** A Judge reported that paying
wages from the character sheet does nothing. Walked from a Judge's seat and a
player's, every press was answered as the 2026-10-01 entry above rules: with
nothing due the Followers tab draws no control and the system sheet's button
says that nothing is due. Neither said when anything would be, so a press
made before the month was up could not be told from a control that does not
work. An open sheet also kept the line it had drawn while the world's clock
moved under it: the month could turn and the control stay undrawn until
something else re-rendered the sheet.

**Ruled (the owner's, between three offered).**
- *The line counts down.* With nothing due the Followers wage line states
  what the payroll costs a month and the days until a payday would next bill
  anything. `wageBill` answers that time as `nextDue`.
- *The notice says the same days.* A payday with nothing due tells its seat
  how many days remain, on the seat that pressed, whichever seat ran it.
- *The line follows the clock.* An open sheet re-renders when the clock has
  moved far enough to change what the line reads
  ([character-sheet MODEL](../character-sheet/MODEL.md), "Re-rendering").
- The 2026-10-01 ruling stands whole: one payday, paying what the wage clock
  says is due, with the control drawn only while something is.

**Rejected.**
- *A Judge-only control that pays a month whatever the clock says.* The entry
  above rejects it as a payment ahead of the clock. It was offered again with
  the report as new evidence, and not chosen.
- *Leaving it.* The press was answered, and the answer left the reader to
  work out the date from the hireling's record.
- *A date in place of a count of days.* A world with no calendar has none to
  print, and the wage clock counts months in days of the world's own setting.

**What it cost.** A table that never advances the world clock reads the same
count at every session; the line now says why nothing is due and still pays
nothing for it. The roster's Pay wages button is greyed while nothing is due
and says nothing beside it. Every advance of the clock reads the bill once
for each open character sheet on each seat.

### The sheet's hireling category decides what kind of hireling an actor is (2026-10-15)

**Found (field report, then a live walk).** A Judge reported hirelings
treated as henchmen: a half share of experience, and wages and loyalty as a
henchman's. Walked live on 11.2.0 with a mercenary and a specialist enrolled
on the system sheet. Before the wage engine adopted them, Deal XP gave each a
FULL share, as if they were player characters. Adoption gave them a record
with no wage basis, and Deal XP then gave each a henchman's half share. The
specialist, who had no wage, was billed the henchman ladder's wage for its
level. A special hire wrote `henchman` over whatever category the actor's
sheet already held. The category was read by core's Hirelings tab and by the
henchman limit, and by nothing that paid or shared. On loyalty, the posting
dialog offers a presented level for every kind of search, and the loyalty
roll took the apparent-level penalty from any hireling's record.

**Ruled.**
- *`system.retainer.category` answers while the hireling serves.* Deal XP
  reads it first. The record's `terms.wageBasis` answers only for someone out
  of service, and a hire writes the basis to match the category.
- *A special hire keeps the actor's category.* It wrote none of its own.
- *The henchman ladder is a henchman's fallback only.* A mercenary or
  specialist whose wage is stated nowhere is billed nothing. Any entry whose
  wage comes to nothing is left off the bill, as a paid unit's already was:
  it is never due, so it can be neither paid nor missed. Missing it would
  have been a calamity.
- *The apparent-level penalty is a henchman's.* It is what a henchman does
  on concluding he outclasses his employer (RR ch. 4). The roll reads the
  category, so records already holding a presented level stop costing a
  mercenary or specialist anything. The rest of loyalty is every
  hireling's — calamities, level gains and the roll itself (RR 166) — and
  is unchanged.

**Rejected.**
- *Writing the wage basis at adoption.* It would mend only records adopted
  after the fix. Reading the category mends every one already adopted, with
  no migration.
- *The record's basis over the sheet's category.* A Judge who corrects a
  hireling's kind does it on the sheet, so the category is the one that
  stays current.
- *Hiding the presented level on a mercenary or specialist search.* The
  dialog's field is shared by every kind of search. A read-time guard also
  mends the records that already hold one.

**What it cost.** A henchman enrolled by hand takes a half share from the
first Deal XP, where before adoption it took a full one. A wageless mercenary
or specialist leaves the payroll until a wage is set. The months it served
meanwhile are billed then, from the clock its adoption started.

### An offer to a bulk row reaches the heads named, and each answers for itself (2026-10-15)

**Ruled (user).** A bulk market row — mercenaries, or specialists such as
skilled laborers that the market counts by the score — can be offered in
part: the employer names how many heads, and each head offered rolls its own
reaction to the hiring offer (RR 162, the reaction is each potential
hireling's). Reported as a Judge's plan to hire six skilled laborers from a
week's arrivals: the Hire button took the whole row as one actor, and Hire as
Group listed mercenary rows only and marked the whole row hired when it took
part of it.

- *The row splits by answer.* The heads not offered keep the row's id and its
  churn clock; each group that answered alike becomes a row of its own, so a
  refusal attaches to the heads that refused and the next offer to them takes
  the cumulative penalty, while the rest are untouched.
- *Each slandering head writes one `slander` entry*, as a single NPC's does.
- *The accepting heads are one actor*, carrying the count in
  `retainer.quantity` (wages already multiply by it); élan heads are a second
  actor, since loyalty is per actor. A signing bonus is paid per head hired.
- *Hire as Group keeps the remainder* (`takeFromRow`): the stepper's count is
  hired and the rest of the row stays available.

**Rejected.**
- *One roll for the whole offer.* The user's call (R2): six heads are six
  hirelings. One roll would make a group hire all-or-nothing.
- *An actor per head.* A bulk row is aggregated so that a crew is not six
  actors; the per-head rolls change how many join, not how they are kept.

**What it cost.** The further heads resolve on this feature's `throws`
outcome table while the first head resolves on the hiring page's own bands;
the two carry the same rungs, and a world that overrides one and not the
other would answer the heads on different edges. *Resolved by "The hiring
throw reads the Judge's table, and the hosted pages read the employer's
powers (2026-10-16)": both read one imported column.*

### The network's class step is read from the page, and no name supplies it (2026-10-15)

The owner ruled to retire the value `NAME_FALLBACKS.marketClass` shipped for
Mercantile Network now, rather than with the rest of that table. The value
was a printed figure in code, which the IP doctrine forbids however small.

Ruled: the step comes from a typed effect the importer locates on the
power's page (`register/rr`, `def.power.mercantileNetwork`) and the collector
reads for the domains in `TYPED_TARGETS`, or from a Judge's Active Effect on
the key; an item's own effect wins over the located value. The name still
proves the power is present (`config.NAME_PRESENCE`): `hasEffectFlag` stays
true, so a trader is still a trader, and `unvaluedPowers` names the item so
a surface can say the value is missing.

Rejected: keeping the value until every name fallback is retired together
(a known breach shipping one more release); a value-free fallback row inside
`NAME_FALLBACKS` (a row that sometimes means a modifier and sometimes only
presence).

Cost: a world that has not re-imported the class powers loses the shift on
equipment, hiring and ventures until it re-imports them or the Judge adds an
Active Effect. The other name-fallback values remain: ROADMAP.

### A mercantile network widens its holder's hiring market, never the town's (2026-10-15)

The owner ruled that the network reaches hiring retainers as the page says
(RR ch. 2, Mercantile Network), with the most rules-accurate reading of
the rest. Before this, only directed searches read the shifted class, always,
and a generic posting saw the town's pool alone.

Ruled:
- *Using it is the employer's choice*, per posting (`network`): the power says
  a holder "can" treat the market as larger, and the fee rises with the class.
- *The fee is the class the search reads.* Hiring there is dealing in the
  larger market, so the weekly search fee is that class's (`feeMarketClass`).
  Without the network it stays the town's.
- *A generic posting adds the difference, privately.* The holder's market is
  the town's read one class larger, so everyone the town's roll found is in it.
  A roll at the larger class adds whoever it finds beyond the town's roll, as
  rows only the holder sees and hires (`networkFor`), once per segment per
  month (`networkRolls`).
- *Only the holder hires a network find*, refused before the reaction roll.

Rejected:
- *Re-rolling the shared pool at the holder's class*: the town's stock does
  not depend on who is asking, and every other recruiter would see the
  holder's market.
- *A whole private pool at the larger class*: it counts the town's people
  twice, once shared and once private, so the holder could hire both.
- *Applying the shift without asking*: it bills a larger fee to an employer
  who may not want the larger market.

Cost: the holder's count is the greater of two rolls, not one roll at the
larger class, so it runs slightly high. Two holders in one market each get a
supplement the other cannot see.

### No henchmen power takes its value from its name (2026-10-16)

The owner ruled to retire the rest of `NAME_FALLBACKS`, finishing the move
the 2026-10-15 entry above made for Mercantile Network alone and left on the
ROADMAP. That entry is extended, not reversed. What it did not know: the
"See X." powers, which looked like they needed their own importer work, did
not. The compiler already resolves an alias to its target's prose and copies
the target's specs, so each one takes its target's located value with no new
mechanism.

Ruled:
- *Every value is the page's or a Judge's.* Hiring reads the abilities'
  `reaction` modifiers. The limit, a hire's base loyalty and the hirelings'
  morale read three new typed targets (`lib/vocab.mjs`), each kept apart from
  the influence feature's `loyalty` and `morale` so that no power is counted
  twice. The register gains locators for Leadership, Command, and the class
  and Judge's-journal powers the table held. The "See X." powers inherit
  theirs. The one alias whose condition differs from its target's (Unholy
  Fanaticism) carries a spec of its own.
- *Two rows go with no successor.* Familiar Folkways is printed in no book in
  the owner's library. Military Genius's morale bonus is a battlefield
  commander's, not a hireling's. Neither is recognized by name any more.
- *A missing value is named where it would apply* (owner's choice; the
  surfaces are MODEL §4, "Presence without a value"), rather than once at
  import or on the power's sheet.
- *These reads judge what they can and offer the rest.* A modifier scoped to
  a tone or a kind of target is offered, since these rolls know neither. So,
  on a roll, is a value from an entry the register has not signed off. That
  matches the influence pages, which never pre-tick an unaudited row. The
  limit, base loyalty and class shift are sums with no row to offer, so they
  take the located value whether or not its entry is signed off.

Rejected:
- *Keeping the two unbacked rows as presence only.* A power with no page
  behind it never has a value to import, so its "no value imported" notice
  would be permanent and false.
- *Feeding the influence feature's `loyalty` and `morale` targets.* Those
  pages read them as roll modifiers, so they would count the same power a
  second time.
- *Treating a draft entry's value as situational in the sums.* The limit
  would then ignore every imported power until the register's audit reached
  it, which is worse than the name table it replaces: that table asserted a
  figure with no audit at all.

Cost: a world whose characters hold powers imported before this change
loses the limit, base-loyalty, hiring and morale bonuses those names
supplied. Each one is named where it would apply until **Update Abilities**
refreshes the copies or a Judge gives the power an Active Effect. The limit
counts a located value the register has not yet signed off. A Beast
Friendship holder's reaction bonus, which the fallback dialog never read
before, now appears there unticked on every hiring roll.

### The henchman limit rests on core's Charisma allowance or on nothing (2026-10-16)

*Superseded 2026-10-23 by "The henchman limit's base is imported, and
Charisma adds to it" below.*

`acks-adapter.mjs > getRetainBase` read core's `system.scores.cha.retain`,
and where that was absent or zero it built the allowance itself from the
Charisma modifier with the book's own formula. That formula is a printed value
held in code. The fallback is retired. Core declares `cha.retain` on
characters alone and derives it on every prepare (`actor.mjs >
computeModifiers`), so the fallback only ever ran for a non-character
employer, or replaced a zero that core had derived.

Ruled:
- *Core's figure stands as it is.* A zero is a zero, never a gap to fill.
- *No figure from core means no limit.* `getRetainBase` and `getRetainMax`
  answer null, `checkHenchmanLimit` reports `max: null` and `ok`, every hire
  path admits the henchman under every `enforceHenchmanLimit` mode, and the
  roster shows the limit as unknown and says why.

Rejected:
- *Running core's derivation for the actor.* Core runs it only for characters,
  and a monster carries no ability scores for it to read. Copying it into the
  module would only move the same formula.
- *A zero limit.* That would refuse a non-character leader every henchman,
  which nothing on the page says.

Cost: an employer that is not a character has no henchman limit. The module
neither counts nor enforces one for it, and the manual `retainBonus` flag has
nothing to add to (ROADMAP).

### The hiring throw reads the Judge's table, and the hosted pages read the employer's powers (2026-10-16)

**Ruled** (owner, 2026-10-16: the most rules-accurate solution). The
`reactionToHiring` throw ships no result column and no per-count figure. Its
column and the figure each earlier refusal and each slander adds are the
influence feature's imported `hiringOffer` (`rules/hiring-offer.mjs`), the
table the hosted hiring page reads; the fallback throw, a peaceful monster
offer and every further head of a bulk offer read it too, and the core
influence roller's slander row multiplies its count by the same figure. A
throw that needs a figure the world has not imported warns and does not open.

The hosted pages now say what the fallback dialogs say:
- *Obedience* is offered the employer's `obedienceRoll` and `henchmanMorale`
  rows through `ctx.offeredModifiers`. The page reads the hireling's own
  morale effects, which these are not, so nothing is counted twice.
- *Hiring* is offered the employer's `hiring`-key Active Effects alone: the
  page already reads the influence reaction key and the abilities' reaction
  values.
- *Loyalty* is offered the employer's `loyaltyRoll` rows, which the fallback
  dialog counted and the hosted page did not.
- A power held by name with no imported value is a note naming it, carrying
  its item, on the hiring and obedience pages. A Diplomacy-kind proficiency
  is the influence page's own box (`docs/influence/DECISIONS.md`,
  2026-10-16), so its note is left out there.
- An influence reaction effect on a hiring power is a value: such a power is
  no longer reported as missing one.

The new evidence against the bulk-offer entry's cost (2026-10-15) is the
`influence` recipe: the column it lacked now arrives with the Revised
Rulebook's tables.

**Rejected.**
- *Keeping the shipped column as a fallback for a world without the import.*
  It is the printed table, and a hire resolved on it is resolved on this
  repo's copy of the page.
- *Offering the hiring page every hiring modifier.* Its reaction-effect and
  ability rows are the page's own reads; offered again they would count twice.

**What it cost.** An upgraded world cannot roll a hiring offer, hosted or
not, until the Judge re-imports the Revised Rulebook's tables. A peaceful
monster offer still opens this feature's own dialog, not the hosted page.

### The henchman limit's base is imported, and Charisma adds to it (2026-10-23)

Supersedes "The henchman limit rests on core's Charisma allowance or on
nothing" (2026-10-16).

**New evidence.** Core 14.1.0 no longer derives `system.scores.cha.retain`
(core commit 19d73f9), and its m5 migration deletes the field from stored
actors. The earlier ruling read that field as the whole allowance, so since
extras 11.7.0 every employer on that core has had no limit at all: `max`
null, every hire admitted under every `enforceHenchmanLimit` mode, the roster
reading `count / —`. Core's only remaining figure for the allowance is
computed inside a sheet's display context
(`CharacterModifiersInfo._prepareContext`), a render path and not a source.

**Ruled.**
- *The base is a printed value and arrives through the importer.* The
  `wages` recipe's `henchmanLimit` table reads the one figure the Revised
  Rulebook prints for it (RR 168), beside `baseLoyalty`, on the
  `proseValues` path a printed figure takes (importer DECISIONS 2026-08-29,
  "A printed floor and a printed rate are read, not shipped").
  `rules/wages.mjs > henchmanLimitBase` returns it, or null for a blank or
  non-integer figure; nothing stands in for it.
- *Charisma adds to the base.* `getRetainBase` is the base plus the
  employer's Charisma modifier (`system.scores.cha.mod`, which core still
  derives). `getRetainMax` adds the typed `retainBonus` effects and the
  manual flag, as before.
- *An unknown limit still admits.* With no Charisma score (a monster) or no
  imported base, the limit is null and never enforced. `checkHenchmanLimit`
  returns `why` (`"charisma"` or `"import"`), and the roster tooltip names
  the actor's own gap first, since an import never closes it.

**Rejected.**
- *Reading core's display context.* It is a render-time computation core can
  move or drop without notice.
- *A shipped default base.* That is the printed value held in code.
- *Writing the field core removed.* The module does not write the system's
  derived data.

**What it cost.** A world that imported its Rules tables before 11.8.0 has
no limit until the Judge runs **Rules tables** in **Reimport One Shelf**.
A monster employer still has none (ROADMAP).

### The employer-level cap is imported, and an unread rung refuses nothing (2026-10-23)

**Ruled.**
- *The ladder is printed and arrives through the importer.* Every figure in
  it is read off RR 168: each rung's employer levels, the henchman level it
  allows, the floor of the open top rung and its rise per level. The `wages`
  recipe's `employerLevelCap` table reads them on the `proseValues` path
  with a `levelLadder` take. `maxHenchmanLevel` had held the top rung's floor
  and allowance as literals, beside a read of a table no recipe wrote; the
  literals are gone and the read is fed.
- *The domain ruler's bound stays in code.* Any level below their own is a
  relation, and no figure in it is printed.
- *An unread rung refuses nothing.* Where the world holds no rung for a
  level, the cap is null and the posting dialog lets the search through, as
  an unknown henchman limit admits (the entry above).

**Rejected.**
- *The ruler's bound for everyone until import.* That was the old read's
  fallback below the top rung: a rule standing in for a printed ladder, and
  looser than the ladder at every rung.
- *A table of exact levels.* The `rows` the old read expected cannot hold an
  open rung, which is why the literals stood beside it.

**What it cost.** No world refuses a leveled search by the employer's level
until the Judge imports the Rules tables; before, every employer from the
top rung's floor up was refused above it whatever the world held. A world
that imported before this change is named in the missing-tables notice.

### The market's henchman levels are the availability table's rows (2026-10-23)

**Ruled.**
- *The highest level for hire is printed, and the imported rows carry it.*
  RR 168 says how high a henchman the market offers, and the availability
  table (RR 164) prints one row per level up to it. The month roll's
  segments, a general posting's reach and the posting dialog's **Level**
  options each held the run of levels as a literal; all three now read the
  rows' levels (`henchmanLevels`), lowest first, and skip a row the import
  could not read.
- *Nothing imported lists no level.* The list is empty until the table
  arrives, as the mercenary and specialist lists beside it have always
  been; the missing-tables notice already names the table.

**Rejected.**
- *A stated empty state in the dialog.* Its troop and specialist lists show
  none either, and without the table no search could roll a pool anyway.

**What it cost.** Nothing for a world that has imported the table. In one
that has not, the dialog lists no henchman level, and the month roll passes
over henchmen where it used to throw at the first level it could not read,
which stopped the roll for every segment after it.

### The level-gain morale bonuses and the apparent-level figure are imported (2026-10-23)

**Ruled.**
- *Both level-gain bonuses are printed: each trigger level and each bonus.*
  RR 166 lists two permanent morale bonuses a level gain earns. The watcher
  held both bonuses and the level each fires at as literals, and the ledger
  labels named the levels. The `wages` recipe's `levelMorale` table now
  reads all four figures, and `levelMoraleRungs` reads the table. That a
  level gain can earn a permanent bonus, and that one is recorded per rung
  crossed, is procedure and stays in code. The new labels name no level;
  the entry's note does.
- *The first bonus's level is read too.* The page keys it on a hireling
  leaving 0th level, which could be read as the level system's edge rather
  than a figure chosen off it. It is a printed number all the same, and the
  doctrine's margin is the point. The recipe reads the level left, and the
  rung is the one above it.
- *Unread, no bonus is recorded and the card says so.* An admitting limit or
  cap waits harmlessly for an import, but a permanent bonus missed is not
  made up when the table arrives: the watcher acts once, on the gain. So the
  level-gain card names the gap when it happens, and the missing-tables
  notice names the table.
- *The apparent-level figure is the influence document's.* The throw's
  stepper (`throws-data.mjs`) carried the per-level figure as
  `valuePerStep`; `openLoyaltyRoll` now hands in the figure the hosted page
  reads (docs/influence/DECISIONS.md, "The loyalty page's apparent-level
  figure is read from a table its row names"). Unread, its info line names
  the count, since the stepper still shows a count that adds nothing.

**Rejected.**
- *Reading the first bonus from `baseMorale`.* That table already read it
  and nothing consumed it. One table for both rungs keeps their four figures
  together, and a new table is what puts a world imported before this change
  in the missing-tables notice; a new key on an expected table would not. The
  key left `baseMorale`.
- *Recording the missed bonuses when the table arrives.* A level gain leaves
  no trace of the rungs it crossed beyond the counter, and rebuilding them
  from it would guess at gains the Judge has since adjusted.

**What it cost.** Until the Judge imports the Rules tables, a level gain
records no morale bonus, and a henchman's loyalty roll types the
apparent-level penalty by hand. Ledger entries recorded before this change
no longer name their level.

### The record is read on the lib frame, once, from both sides (2026-10-23)

**Ruled.**
- *One panel, two sheets.* The hireling's side of its record was reachable
  only through the employer's roster, and the monster sheet's Henchman tab
  held the two core fields and a manager picker. One partial
  (`service-panel.hbs`), fed by one reader (`service-view.mjs`) over pure
  decisions (`rules/service.mjs`), is now the character sheet's Service tab
  and the foot of the monster sheet's, renamed Service. The character sheet
  gates the tab on `retainer.enabled` in its tab list, where Magic and Trade
  are gated, so an actor out of service never grows an empty tab.
- *The roster is redrawn on the frame's vocabulary and keeps every control.*
  Rules, rows, chips, pills and bars from `lib-frame.css`; the roster owns
  only its grid. The filters, the counts on them, the limit bar, the wage
  clock per row and the drop zone are added; nothing the old window did is
  gone. Which rows are open is window state, as before, not a flag.
- *The name is the disclosure, and it is a button.* `<details>` put the
  row's controls where a click trades with the toggle, which the layout
  contract forbids inside a `<summary>`; a button toggle with
  `aria-expanded` reaches the keyboard and a second copy of the window
  without a literal id.
- *A mercenary shows no loyalty.* The record keeps none for it, and a dash
  with the reason beside the morale throw says so in place of a score of 0.
- *The owed throw is marked where the eye already is.* The band's in-service
  chip carries a dot (a lib addition to the band's chip contract), the
  Service tab carries a count, and the panel opens on the warning row with
  the Judge's **Throw now** beside it.
- *The share is said from the stored fraction.* `shareKind` turns 0.5, 1 and
  0 into words and anything else into a percentage; the panel never stores a
  word.

**Rejected.**
- *A loyalty panel per sheet.* Two copies drift; the character and monster
  sheets already shared the frame partials for the same reason.
- *Pin ids of the panel's own.* The pins are the sheet's roll ids; the panel
  pins `loyalty` and `morale`, which the sheets' roll inventories hold, and
  nothing a sheet cannot throw.

**What it cost.** The roster's release screenshot (`docs/releases/v11.0.0/henchmen.png`)
shows the old window and is stale until the next release shoots it. The
loyalty score was already the hireling's player's to see on Rolls and Stats;
its parts, the ledger and the events now are too, which the roster's
GM-and-employer gate used to keep from them. The throws and the toggle stay
the Judge's.

### Every figure on the Service panel names its source, and Obedience reads morale (2026-10-24)

**Found** by writing the panel's tooltips to `.claude/rules/ui-tooltips.md`,
which asks each figure to list the parts its page prints:

- The Judge's **Obedience** row showed the loyalty score (11.9.0). The throw
  it opens, `openObedienceRoll`, rolls on `effectiveMoraleFor`, and the
  obedience throw is a morale throw (RR 167). No parts of loyalty could be
  written for it.
- The morale line read base and permanents, while the score beside it also
  adds the employer's `moraleBase` powers. With such a power on the employer,
  the line's parts did not produce the figure.

**Ruled.** The Obedience row reads the morale score. The morale line and its
tooltip carry the employer's powers as a third part, read through
`employerMoraleBase`, which `effectiveMoraleFor` now also calls, so the roll
and the panel read one figure. Each figure's tooltip is written as text
(`data-tooltip-text`), since it is assembled from names and numbers at render.

**Left for review, not changed here.** Two figures reach the panel from a
constant in source rather than from a table: the share `termsOf` reads where
the record states none (its tooltip says it is the module's default),
and the score range `clampScore` holds both scores to. Both are the value
rule's case (`.claude/rules/ip-doctrine.md`) and are on the bug-intake
ledger.

**What it cost.** The wage's tooltip names the table's page only where the
importer recorded one; a Judge's override layer and a module sample record
none, so their wage reads "no page recorded".

### Wage reminders post once per month owed, and walks leave the module's cards alone (2026-10-28)

**Found.** The live walks that move the world clock (formation-hex, -day,
-steps, battlemap, markets) drew wages-due whispers for the employers other
walks keep: 10 to 15 cards in one formation-hex run. `checkWagesDue` kept no
mark of what it had reminded, so once a month was owed it posted on every
forward tick until a payday. That broke `onWorldTimeAdvanced`'s rule that
each callback keeps its own watermark, and the setting's hint, which promises
a card each game month. A comment at the end of the function said the
opposite of what it did. formation-steps and markets claimed those cards by
author and time window, so each run's next run deleted them.

**Ruled.**

- `checkWagesDue` posts for an employer only when the latest month boundary
  it owes is past `flags.acks-extras.wageRemindedThrough`, and writes that
  boundary with the card (MODEL §4c). Ticks are queued, because two arrive
  within one card's render and the second would read the mark before the
  first writes it.
- The kept fixtures keep their wages. A tick writes no arrears, loyalty,
  morale, calamity or coin. Its only wage write is `enrollNewcomers` starting
  an unenrolled clock, and no walk reads what a tick writes. A step that needs
  a wage state writes it on the record at its start.
- A walk claims a card only when its own client made it under the run's nonce
  and it speaks as, carries or names one of the run's fixtures, or came from
  the action in flight (`tools/live/README.md`). The module's cards for other
  walks' fixtures are left alone.

**Rejected.**

- *Fixtures without a wage outside the wage steps.* A henchman's zero wage
  falls back to the imported ladder. A vassal domain, or a `lastPaidTime` in
  the future, is a false record the next walk inherits.
- *Journey walks switching henchmen's time processing off.* Their seat is the
  one that processes time, so this stops it for every session. `wageReminders`
  is a world setting, so it would also be a restore at the end. And it would
  have hidden this defect.
- *Closing the postings and unlinking the hirelings at a run's end.* That too
  is a restore at the end (`.claude/rules/live-testing.md`, step 4).

**What it cost.** Each kept employer still posts one card per month of world
time. Each posting that henchmen stage 2 leaves open still rolls its fee and
moves coin every week, until the next stage 2 run reshapes its halls. Proving
the cadence live (TESTING 5g) moves the shared clock by two seconds.
