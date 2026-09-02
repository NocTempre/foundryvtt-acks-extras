# Henchmen & hirelings — decision record

Why this feature is shaped the way it is: what was ruled, what was rejected, and
what it cost. How it behaves *now* is [MODEL.md](MODEL.md); unbuilt work is
[ROADMAP.md](ROADMAP.md).

Entries are dated and append-only. A superseded entry stays, marked.

---

### Two repair macros retire into the code that made them unnecessary (2026-09-01)

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
