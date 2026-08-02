# Abilities Integration Audit (2026-07-19, v0.18.4)

Audit of how acks-formation interfaces with abilities, against the three-module
abilities program: **acks-lib** (shared effect vocabulary), **acks-abilities**
(binding target / flag model), **acks-content** (the cookbook that materializes
values per seat). Covers (1) whether the library carries the mechanical concepts
this module needs, (2) a per-entry audit of the shipped
`exploration-proficiencies` compendium against what content currently extracts,
and (3) the retirement plan for that compendium.

**Headline:** all 25 compendium entries exist upstream in the cookbook, and the
library covers nearly every mechanical concept this module hand-rolls — usually
better. The compendium is ready to retire on a phased path. Three correctness
defects and one IP exposure were found on this side and are listed in §4.

---

## 1. What this module needs from an ability

acks-formation reads abilities for exactly five purposes:

| # | Purpose | Where | Today's mechanism |
|---|---|---|---|
| 1 | Bind an ability to a party roll (listen/search/bash/track) | `party-rolls.mjs` `skillCandidates()` | `checkKey` flag, else **name regex** (`cfg.pattern`) |
| 2 | Scale a skill target by owner level | `scaledSkillTarget()` | `thiefSkill` + `levelFactor` flags → hardcoded `THIEF_PROGRESSION` |
| 3 | Stack conditional bonuses onto a throw | `resolveCheck()` | hardcoded `ALERTNESS_PATTERN`, `ATTUNEMENT_PATTERN`, `TRAPFINDING_PATTERN` |
| 4 | Detect operating without light | `formation-model.mjs` `canSeeInDark()` | hardcoded `DARK_SENSE_PATTERN` (PCs) / monster extras (monsters) |
| 5 | Detect role competence (mapping, poles) | `hasAbility()`, `hasPoleItem()` | name regex |

Every one of these is a name-match or a hardcoded constant. That is the thing
the program exists to replace.

---

## 2. Library validation — does acks-lib carry the concepts?

### Covered, and better than the local version

| Need | acks-lib primitive | Assessment |
|---|---|---|
| Bind ability → party roll (#1) | `kw:<slug>` **capability tokens**; `satisfies()`, `satisfiesAll()`, `capabilityForId()` | **Strictly better.** A capability catches every route to a mechanic — *Searching* is a thief skill, a proficiency, and several class powers. `kw:searching` matches all; my regex matches whatever the item happens to be named. An ability implicitly provides its own id's capability, so gates resolve before anything is tagged. |
| Level scaling (#2) | `LevelValue` `{kind:"progression", as, atLevel}` + `resolveLevelValue()` | Covered — but the resolver deliberately returns `null` for `progression` and defers to the class table. **The table is not in lib**; content materializes it (§3). Correct division: lib owns semantics, content owns page values. |
| `levelFactor` (#2) | `PROGRESSION_LEVELS` = `full \| half \| third \| quarter` | **Better.** My `levelFactor` is a free float (0.25–2.0) that accepts nonsense like 1.75 and cannot express "as a thief of one-third level" as a named concept. |
| Bonus stacking (#3) | `modifier` / `modifies` effects with `mode: add\|replace\|set`, `ifHas`, `stacksWith`, `notStacksWith`; `MODIFIER_TARGETS.proficiencyThrow` | Covered exactly. `proficiencyThrow` is precisely my target. Non-stacking falls out of shared capabilities rather than being asserted per pair. |
| Roll polarity | `ROLL_TYPES` = `result \| above \| below` | Covered. Worth adopting: I assume roll-high everywhere; ACKS runs both ways. |
| Dark operation (#4) | `VISION_TYPES` / `SENSE_TYPES` (shared with acks-monsters) | Covered, already consumed on the monster path via `monster-traits.mjs`. |
| Rerolls, companions, defenses, spell-likes | `reroll`/`resolveReroll`, `companion`, `defensesField`, `spellLike` | Covered; not needed here yet. |

### Genuine gaps for this module

These are **not** defects in acks-lib — they are exploration-domain concepts the
library was never scoped to hold. Recording them so the boundary is explicit:

| Gap | Detail | Where it should live |
|---|---|---|
| **Action time cost** | `PARTY_CHECKS` carries `consumesRound` / `consumesTurn` / `oncePerTurn` / `blockedWhenHurried`. Nothing in `EFFECT_TYPES` models action economy or time cost. | Stays here. It is dungeon-turn procedure, not ability vocabulary. |
| **Exploration vs combat speed** | `MODIFIER_TARGETS.speed` is undifferentiated; ACKS speed is `[combat] / [exploration]`. An ability modifying one, not both, cannot be expressed. | Candidate lib refinement if any ability ever modifies exploration speed specifically. Not blocking. |
| **Group/party rolls** | Rolling one check across N members with per-member resolution. | Stays here — squarely this module's job. |

**Verdict: the library is sufficient.** No lib change is required to migrate
this module. The two gaps above are correctly outside its scope.

---

## 3. Per-entry audit — 25 compendium entries vs. cookbook

**All 25 resolve to cookbook nodes. Zero missing.** Mechanic extraction is
partial and almost entirely unaudited, which governs the retirement timing.

Legend: **prog** = `op:"progression"` instruction · **eff** = count of `effects.specs` ·
**roll** = count of `rolls.specs` · **aud** = chef sign-off

| My entry | Cookbook id | prog | eff | roll | aud | Notes |
|---|---|---|---|---|---|---|
| Alertness | `def.prof.alertness` | – | – | 1 | – | **Two nodes** (see below) |
| Alertness | `def.power.alertness` | – | – | – | – | `provides: [kw:alertness]` |
| Caving | `def.prof.caving` | – | – | – | **Y** | `repeatable` |
| Climbing | `def.prof.climbing` | – | – | – | – | |
| Climbing | `def.skill.climbing` | **Y** | 1 | – | – | Two nodes (prof + skill) |
| Contortionism | `def.prof.contortionism` | – | – | – | – | |
| Eavesdropping | `def.prof.eavesdropping` | – | – | – | – | |
| Endurance | `def.prof.endurance` | – | – | – | – | |
| Hiding | `def.skill.hiding` | **Y** | – | – | – | |
| Land Surveying | `def.prof.landSurveying` | – | – | – | – | |
| Listening | `def.skill.listening` | **Y** | – | – | – | |
| Lockpicking | `def.skill.lockpicking` | **Y** | 1 | – | – | |
| Mapping | `def.prof.mapping` | – | – | – | – | `repeatable` |
| Mountaineering | `def.prof.mountaineering` | – | – | – | – | |
| Navigation | `def.prof.navigation` | – | – | – | – | |
| Passing Without Trace | `def.prof.passingWithoutTrace` | – | – | – | – | |
| Pickpocketing | `def.skill.pickpocketing` | **Y** | – | – | – | |
| Searching | `def.skill.searching` | **Y** | 1 | – | – | methodical `+N` as `modifier/proficiencyThrow/add` |
| Shadowy Senses | `def.skill.shadowySenses` | – | – | – | – | **no `provides`** — see §4.1 |
| Skulking | `def.prof.skulking` | – | – | – | – | |
| Sneaking | `def.skill.sneaking` | **Y** | 1 | – | – | |
| Swimming | `def.prof.swimming` | – | 1 | – | – | Two nodes (prof + power) |
| Swimming | `def.power.swimming` | – | – | – | – | |
| Tracking | `def.prof.tracking` | – | – | 1 | – | `repeatable` |
| Trapbreaking | `def.skill.trapbreaking` | **Y** | 1 | – | – | |
| Trapfinding | `def.prof.trapfinding` | – | 1 | – | – | targets `kw:searching` **and** `kw:trapbreaking` |
| Trapping | `def.prof.trapping` | – | 1 | 2 | – | |
| Wakefulness | `def.prof.wakefulness` | – | – | – | – | |

**Totals:** 28 nodes for 25 names (3 names carry two nodes each) · 8 progression
instructions · 8 effects specs · 4 rolls specs · **1 of 28 audited (Caving)**.

### What this replaces, concretely

- **The 8 `progression` instructions are exactly my 8 `THIEF_PROGRESSION` rows**
  (climbing, hiding, listening, lockpicking, pickpocketing, searching, sneaking,
  trapbreaking). The cookbook ships level/value box coordinates; the runtime
  reads the ladder out of the seat's own PDF. My hardcoded table becomes dead.
- **`def.skill.searching` effects** carry the methodical search bonus as
  `{type:"modifier", target:"proficiencyThrow", mode:"add", condition:"methodical
  attempt (one turn); not a hasty attempt"}` with a `from.pattern` locator —
  structurally identical to my `skillBonus: 4`, with the digit read per seat.
- **`def.prof.alertness` rolls** carry the Adventuring 14+ target with the note
  *"Used in place of the usual Adventuring search/listen target, not added to
  it."* — **confirming my unskilled-path implementation is correct** (I treat it
  as a target change, not a bonus).
- **`def.prof.trapfinding` effects** target `kw:searching` **and**
  `kw:trapbreaking` — see §4.3.

### Modelling mismatches to resolve on migration

1. **One item, two nodes.** Alertness, Climbing and Swimming each exist as both
   a proficiency and a class power/skill. My compendium collapses each to one
   item. On migration the binding must pick the right node per character, not
   merge them.
2. **`checkKey` is unset on all 25 shipped entries.** Binding runs entirely on
   name regex today. This is the exact fragility `kw:` tokens fix.
3. ~~**Only `kw:alertness`, `kw:lightlessvision`, `kw:scalyhide` exist** of the
   36 capabilities registered. The tokens I need — `kw:searching`,
   `kw:listening`, `kw:trapbreaking` — are referenced by Trapfinding's spec but
   not *provided* by their own nodes. Migration must wait on those.~~
   **WRONG — corrected 2026-07-19.** This read the `provides` field and
   concluded the capability did not exist, missing the implicit rule stated
   plainly in acks-lib's own docs: *"an ability always implicitly provides its
   own id's capability, so a gate resolves before anything has been tagged."*
   `satisfies()` checks `capabilityForId(a.id) === want` **first**, and
   `capabilityForId("def.skill.searching")` is `"kw:searching"`. Verified by
   execution: an actor holding only `def.skill.searching` satisfies
   `kw:searching`; `def.prof.trapfinding` satisfies `kw:trapfinding`. An empty
   `provides` list is the normal case, not a gap — explicit `provides` is only
   needed to declare a capability an ability's *own id does not name* (which is
   exactly what Attunement→`kw:alertness` in §4.2 is for).
   **Phase 3 was therefore never blocked.** It is now done — see below.

---

## 4. Defects found in acks-formation

### 4.1 `DARK_SENSE_PATTERN` contradicts this module's own monster rule — **bug**

`constants.mjs` matches `night\s*vision` as a dark sense for PCs:

```js
export const DARK_SENSE_PATTERN = /shadowy\s*sense|lightless\s*vision|infravision|darkvision|night\s*vision|dark\s*sight/i;
```

But `monster-traits.mjs` (shipped v0.18.0) **deliberately excludes** Night
Vision, because the MM states it fails in total darkness ("moonlight → daylight;
indoors 2× light range; **not total dark**"). The same rule is implemented twice
with opposite answers: a monster with Night Vision is correctly blinded in a
dark dungeon; a PC with an ability named "Night Vision" is incorrectly granted
dark sight. `night\s*vision` should be removed from the pattern.

Corroborating: content registers `kw:lightlessvision` on `def.power.infravision`
and `def.power.lightlessVision` only — Night Vision is not among them.

*Also noted:* `def.skill.shadowySenses` carries no `provides`, so it is not yet
tagged `kw:lightlessvision` upstream. My pattern does treat Shadowy Senses as a
dark sense. That is a **content gap, not necessarily my error** — flagging it for
the chef pass rather than changing behavior here.

### 4.2 Attunement to Nature `+4` on Listening — **RESOLVED: this module was right, cookbook fixed upstream**

Initially flagged as a possible invented rule, because the register listed
`kw:alertness` on **alertness, alienSenses, keenInsectSenses, mindfulness** but
not `attunementToNature`, whose node was a stub with no provides, effects or
rolls.

Re-checked against the source. This module's local rules extract
(`acks-rules/acks-formation/PROFICIENCIES.md`) records the asymmetric reading,
and re-reading JJ p.311 through acks-content's own extractor confirms it: the
entry grants a wilderness surprise bonus, the Adventuring search/listen throw at
the improved target, and — for a character *separately proficient* — one value
for Searching and a **larger** one for Listening. `party-rolls.mjs` is correct.

**Why the register missed it, and why the obvious fix would have been wrong.**
The compiler auto-aliases powers whose prose cross-references another entry, and
that is how the other three got `kw:alertness`. Its alias scan *correctly
declined* to alias Attunement — because it is not one. Alias it and it inherits
Alertness's Listening value, which is the wrong number. What was missing was a
per-entry recipe, which is precisely the *"scans locate, recipes interpret"*
case: the asymmetry is a judgment no generic scan can make.

**Action taken** (acks-content `e4b98aa`): authored the recipe — `rolls` spec
for the Adventuring target (modelled as a roll, matching `def.prof.alertness`),
three `effects` specs (wilderness surprise; `modifies kw:searching` and
`modifies kw:listening`, both `mode:"replace"` since the "instead" clauses
substitute for the Adventuring throw), and `meta.provides: [kw:alertness]` so
the two cannot stack. Locators only, no value off the page. Verified through
`tools/merge-recipes.mjs` against the reference PDF — all four materialize, 0
rejected. **Not** marked `audited`; merging makes an entry correct, sign-off is
a separate act.

Also corrected: this module's own extract carries a stale note claiming the +4
was "applied as +2 — half a point of fidelity traded for one code path". The
code has since implemented the full reading, so the note now understates it.

By contrast the **Alertness `+2`-when-separately-skilled branch was already
sound** — it appears in the entry text and matches the acks-lib worked example
(`modifies … mode:"replace"`).

### 4.3 Trapfinding implements half its effect

Register spec targets `kw:searching` **and** `kw:trapbreaking`. My `TRAPFINDING_PATTERN`
is applied only to the two search checks; there is no Trapbreaking party check,
so the trapbreaking half is unimplemented. Low impact (trap resolution is the
separate traps module's job) but it should be a deliberate scope note rather
than an omission.

### 4.4 The compendium ships book values and close-paraphrase prose — **vetted acceptable; hygiene only**

> **Status 2026-07-31: BOTH halves are resolved — nothing described below still
> ships.** The pack went in v0.27.0 (§5 Phase 5) and `THIEF_PROGRESSION` went in
> v0.28.0 (§5 Phase 4), the latter by owner ruling that every thief progression
> is fixed at the acks-content level — i.e. NOT grandfathered as module
> automation config. The henchmen `throws-data.mjs` boundary points the same way
> on inspection: what ships there is a generic 2d6 ladder mapped to module
> enums, whereas these were eight rows of the book's own printed numbers, which
> is the book-database side of that line.
>
> The description below is kept as the record of what *was* published and for
> how long, which is what a history purge would need to scope.

> **Ruling (owner, 2026-07-19):** this content is already vetted as *not* an IP
> leak as it stands. A history purge is a hygienic courtesy to perform **once a
> replacement is fully in place** — not urgent containment. The description
> below is retained as the factual record of what ships and why the migration
> tidies it up; it is **not** an open risk item.

`packs/_source/exploration-proficiencies/` ships, for 25 named proficiencies:

- **exact printed throw targets** (`system.rollTarget`: Searching 18, Listening
  14, Hiding 19, Pickpocketing 17, …);
- **~8.7 KB of mechanical prose** (mean 350, max 703 chars/entry) that closely
  paraphrases each proficiency's rules text — e.g. Alertness: *"+1 bonus to
  avoid surprise. When using Adventuring proficiency to search or listen,
  succeeds on 14+ (instead of 18+); if separately proficient in Searching or
  Listening, gains +2 to the throw instead."*

Plus `scripts/constants.mjs` reproduces the **entire thief-skill progression
table** (8 skills × 14 levels) as a literal array.

The cookbook exists precisely so these numbers materialize from each seat's own
PDF, which is why the migration removes them from this repo as a side effect.
Sequencing per the ruling: **replacement first, purge second.**

**`npm run validate` reports `ip-scan: clean` on this — a false negative.**
`tools/ip-scan.mjs` is deliberately structural (it holds no book text, so it
cannot match known passages). It flags a prose leaf only above
`PROSE_CHARS = 1500`; the longest description here is **778 chars**, so all 25
pass individually while aggregating to **9.3 KB**. The scan also does not
inspect numeric values, so `rollTarget` is invisible to it by design. Two
template-level gaps worth raising against `acks-module-template` (the file is
synced — **do not hand-edit it here**):

1. **No aggregate check.** N sub-cap prose leaves in one pack is the
   death-by-a-thousand-cuts case the per-leaf cap cannot see.
2. **No value-density signal.** A pack of items each carrying a printed target
   number is exactly the "compilation of values" principle 2 forbids, and no
   structural signal currently reaches it.

Neither is a criticism of the scan's design — a structural gate cannot detect
paraphrase. It does mean **a clean scan is not evidence this pack is safe**,
which is the operative point for the Phase 0 decision.

---

## 4a. Addendum — the scoping restructure (acks-lib 0.6.0 / acks-content `bf4a369`)

Reviewed 2026-07-19, after eight reaction proficiencies were re-authored with
scoping specs and acks-lib gained the primitive behind them.

**What landed.** acks-lib 0.6.0 adds `scopeApplies(effect, ctx)` and six effect
axes — `vsKinds`, `vsAlignment`, `vsAlignmentMode`, `tones`, `optionalRule`,
`kickerAt`/`kickerNote` — answering *when* a modifier applies, which the model
previously could not express (acks-influence was carrying these in private
ActiveEffect flags where nothing else could read them). acks-content then used
them on Diplomacy, Intimidation, Seduction, Mystic Aura, Beast Friendship,
Folkways, Bargaining and Bribery, all now `audited`.

**Assessment: correct, and two design calls are worth adopting family-wide.**

1. **Gate and sign are different things, not a flag.** *"+1 versus Chaotic and
   nothing otherwise"* and *"+2 versus Chaotic, −2 versus everyone else"* are
   different rules; storing either as the other is wrong by double the value.
   Defaulting to gate is the safe direction.
2. **`undetermined` is not `false`.** A scope the context cannot settle has not
   *failed*. Collapsing the two makes a bonus silently vanish against a target
   the GM merely hasn't classified — a wrong answer that looks like a correct
   one, which is the failure mode this whole pipeline is built to avoid.

**Impact on this module: no adoption required yet, by design.** The axes are
target- and tone-scoped, and exploration checks have neither. This module's own
scope axis — methodical vs hasty search, careful vs hurried pace — is a
procedure-time distinction with no corresponding axis, and correctly stays in
`PARTY_CHECKS` (§2 records this as a boundary, not a gap). The one scoped effect
that touches this module's domain is Attunement to Nature's *wilderness-only*
surprise bonus (§4.2), and this module does not model surprise.

`scopeApplies` therefore becomes relevant at **Phase 4**, when cookbook
`effects` replace the hardcoded bonuses. `ability-bridge.mjs` records this
deliberately rather than wrapping the call now with no caller.

**One thing to carry forward.** The restructure caught a real defect the same
way this audit caught §4.2: Bribery's existing spec silently missed its day
tier because the page phrases it differently from the week and month tiers. A
locator that matches *some* of an entry looks identical to one that matches all
of it. That is an argument for the per-entry read the doctrine already
mandates — and against exactly the "systematically fix all entries with that
language" instinct principle 3 warns about.

## 5. Retirement plan

Phased, because deleting the pack breaks worlds whose actors reference its items,
and because the upstream mechanics are 1-of-28 audited — migrating binding onto
unaudited data would trade a known-correct hardcode for an unverified one.

**Phase 1 — fix the local defects (no dependency on upstream). DONE.**
`night vision` removed from `DARK_SENSE_PATTERN` (§4.1). Attunement `+4`
verified correct and the cookbook fixed upstream instead (§4.2). Trapfinding
scope noted (§4.3).

**Phase 2 — soft-deprecate the pack.**
Mark `exploration-proficiencies` deprecated in `module.json`/docs and add
`acks-abilities` + `acks-content` to `relationships.recommends`. Keep shipping
it so existing worlds keep working. Stop adding entries.

**Phase 3 — capability-based binding. DONE (2026-07-19).**
`scripts/ability-bridge.mjs` folds an ability item into the `{id, provides}`
shape acks-lib reasons over — `id` from `flags["acks-content"].cookbook.id`
(written on import), `provides` from `flags["acks-extras"].extras` — and
exposes `hasCapability` / `itemHasCapability` over `acksExtras.lib.satisfies()`.

Wired into `skillCandidates()` (per-check `capability` token), the Alertness
and Trapfinding bonus gates, `canSeeInDark()` (`kw:lightlessvision`) and
`mapperIsProficient()` (`kw:mapping`).

**Union, not replacement.** Candidates are capability matches ∪ `checkKey`
bindings ∪ name matches. A strict capability check would have *regressed*
coverage: hand-made abilities carry no cookbook id at all, and at the time of
writing Eavesdropping did not declare `kw:listening`. The union can only add
members the old path would have missed — chiefly the renamed-item case, which
was the whole fragility.

**Two of the untagged cases have since been fixed upstream** (acks-content
`2d434f0`), each read individually against its printed page:

| Entry | Now provides | Why |
|---|---|---|
| `def.prof.eavesdropping` (RR p.112) | `kw:listening` | Listens "as a thief of his class level"; the Judge makes a "**Listening** proficiency throw" on the character's behalf. |
| `def.skill.shadowySenses` (RR p.34) | `kw:lightlessvision` | "Sees" as if carrying a light source shedding dim light in a stated radius — Lightless Vision's mechanic, with the same fine-detail caveat. |

Neither was authored as `assists.aliasOf`, deliberately: the alias mechanism
replaces the alias's description with its target's, and both entries carry their
own printed constraints (Eavesdropping's quiet-environment and once-per-turn
limits; Shadowy Senses' caveat list) that aliasing would discard. Same call as
§4.2. These make the capability route reach two abilities the name pattern
previously caught only by coincidence.

**The union's audit surface.** A generous matcher needs somewhere to show its
work, so the Skill Audit window opens with a **party ability roster**: every
distinct ability in the party once, deduplicated by identity (register id, else
folded name), with who holds it, which checks would take it, and **by which
route** — capability, explicit binding, or name. Name-only matches are marked,
since those are both the rename-fragile ones and the likeliest false positives.

Each row cycles `automatic → forced off → forced on → automatic`, and a reset at
the top clears every ruling. Rulings are world-scoped and keyed to the ability,
not the item: "does Eavesdropping count as listening" is a ruling about the
rules, so one decision governs every copy in every party. Absence means
automatic — reset *deletes* entries rather than writing the current state, so
returning to defaults restores automation rather than freezing a snapshot of it.
A ruling outranks the per-item Skill checkbox, because the surface that shows
what automation decided has to be able to overturn it.

Degrades to the previous behaviour with acks-lib absent (no tokens fold, every
call falls through to the name pattern), so it is `recommends`, not `requires`.

Verified by execution against the item shapes acks-content actually writes: a
GM-renamed `def.skill.searching` resolves (the regex would miss it); Attunement
satisfies `kw:alertness` via §4.2's authored `provides`; `def.prof.trapfinding`
satisfies `kw:trapfinding` implicitly; a flagless hand-made item yields no
capability and is left to the name path.

**Phase 4 — drop the local tables. DONE (2026-07-31, v0.28.0), by owner ruling
that every thief progression is fixed at the acks-content level.**
`THIEF_PROGRESSION` is gone from `scripts/constants.mjs`. The eight ladders are
read from the GM's own book: the cookbook's `progression` op takes each skill's
grid column off the page, and — this is the part the earlier analysis had
wrong — emits `{kind:"breakpoints"}`, **not** `kind:"progression"`. Breakpoints
are exactly what `resolveLevelValue` answers, and `bindAbility` lifts every
classified `throw` effect into `extras.rolls[].target`, so the whole ladder was
already arriving on every imported skill and resolving at any level. Nothing in
acks-content had to change. The only defect was on this side: `scaledSkillTarget`
consulted its own table FIRST, so the imported ladder was never reached and the
shadowing looked like an absence.

`levelFactor` stays a float for now; `PROGRESSION_LEVELS` was the other half of
the original Phase 4 sketch and is a separate, smaller change.

**The gate was answered on the merits rather than waived.** Its purpose was to
avoid trading a verified number for an unverified one, and `skills.json` is
still **1/13 audited** with the one signature on `def.skill.deciphering` — none
of the eight. But the eight imported ladders were compared against the departing
table cell by cell: **112 level/value cells, 0 mismatches**, including
Trapbreaking's odd `… 3, 2, 2, 1` tail, which is the sort of cell a
transcription error would land on. Two independent renderings of the page — a
hand-typed table and a live extraction — agreeing everywhere is the evidence the
gate was asking for. Formal `audited` sign-off remains acks-content's to give
and is still outstanding; it covers a whole entry (prose, effects, rolls), not
just the ladder, so this does not pre-empt it.

**What the `thiefSkill` flag means now.** It was an index into a shipped array;
it is now a POINTER at a cookbook definition — "scale as Listening does" — which
resolves through that skill's imported copy. Existing bindings keep working once
the named skill is imported, and where it is not, the Skill tab says so instead
of silently using the sheet target. Lookup order in `scaledSkillTarget`: the
explicit binding (a GM override, so it wins), then the item's own ladder, then
its cookbook identity.

**Two defects live testing caught here, both invisible offline:**

1. **The read did not follow the write.** acks-content's `importToCompendium`
   setting sends imports to a world compendium instead of the item directory.
   The first cut scanned `game.items` only and found nothing on a test world
   holding 467 imported items — every ladder was in the pack. This is the same
   trap acks-content documents against itself in `importedIndex()`; the lookup
   now reads both, and caches the pack side because pack reads are async and
   `scaledSkillTarget` is called inside a roll loop.
2. **An emptied cache reads as "no ladder".** Invalidating on `createItem` set
   the cache to null, and the synchronous read then returned null — so creating
   an actor moments before a party roll silently downgraded every borrowed skill
   to its sheet target. Caught because the fixtures for the test were built in
   the same breath as the roll. A ladder is a page from a book and does not
   change between rolls, so invalidation now schedules a rebuild and keeps
   serving the previous map; anything readable synchronously is still read
   synchronously first.

Regression-checked live against the v0.27.0 baseline with the same roster: every
resolved target identical (L3 Listening 12+, L3 Searching 16+ with methodical
+4, Alertness improving Adventuring to 14+, Tracking 11+), now sourced from the
book rather than from this repo.

**Phase 5 — remove the pack. DONE (2026-07-31, v0.27.0).**
`exploration-proficiencies` is unshipped: the `packs[]` entry is gone from
`module.json`, the 25 `packs/_source/` definitions are deleted, and the inline
item tables that generated them are out of `tools/build-packs.mjs` (which no
longer imports `THIEF_PROGRESSION` at all — see below).

What unblocked it was v0.26.0, not the Phase 4 burn-down. The pack's remaining
job was being the only thing that reliably *worked*: until capability matching
actually fired, an imported skill fell through to Adventuring, so the bundled
copies were the dependable path. With `acksExtras.lib.vocab.satisfies` imported
statically and `inferredThiefSkill()` reading `def.skill.<key>`, an imported
skill now matches by capability and scales at the owner's level with zero
setup — strictly better than the placeholder it replaces, since it survives a
rename and reads the seat's own book.

**Migration is documentation, per the acks-influence 0.10.0 precedent** (its
`03ad534`, and the `72449a5` correction that re-framed the rationale from IP
remediation to supersession — the framing followed here). Foundry does not
delete world documents when a compendium is removed, so worlds holding the
items keep them and the name-match and hand-bound Skill-tab routes still serve
them unchanged. No warning hook, no cleanup code: nothing in the module ever
read the pack, and the items are inert data rather than machinery writing
stale state. README and CHANGELOG carry the switch-over instructions.

The history purge (§4.4) remains the hygienic tail, per the owner's sequencing.

**Phase 4 is NOT closed by this** — see the re-check below. The pack could go
while the table stays because they are different exposures: the pack was 25
public JSON files of printed targets and paraphrased rules text, whereas
`THIEF_PROGRESSION` is eight arrays consumed by code. Removing the pack was
never gated on Phase 4; the audit's own ordering had them independent.

**Phase 4 gate re-checked 2026-07-31 — STILL CLOSED, and now load-bearing.**
`cookbook/skills.json` reads **1/13 audited**, and the one signed-off entry is
`def.skill.deciphering` — *not* among the eight this module consumes. All eight
progression skills (climbing, hiding, listening, lockpicking, pickpocketing,
searching, sneaking, trapbreaking) carry `audited: false`. Their `progression`
field ops exist and are extractable, so the data is *there*; it is the chef
sign-off that is missing, which is exactly the gate the plan set.

The table has meanwhile become **more** load-bearing, not less. v0.26.0's
`inferredThiefSkill()` maps an imported `def.skill.<key>` onto
`THIEF_PROGRESSION`, so the zero-setup scaling that justified retiring the pack
is *delivered by this table*. `importedThrowTarget()` deliberately returns
`null` for progression-kind ladders (they defer to a class table the extras do
not carry), so with the table gone today, imported thief skills would fall back
to the Adventuring target — reintroducing the exact v0.26.0 bug. Dropping it
therefore requires the cookbook progressions to be audited **and** the imported
ladder to resolve them, in that order.

---

## Appendix — audit method

- Cookbook read from `C:\Proj\acks-content\cookbook\` (`proficiencies.json` 120
  entries, `skills.json` 13, `powers.json` 327, `registers.json`).
- Every one of the 25 `packs/_source/exploration-proficiencies/*.json` entries
  was matched by name and its cookbook node's `fields` (progression/effects/rolls)
  and `meta` (category, general, repeatable, provides, notStacksWith, audited)
  read in full — no sampling, per the recipes-not-rules audit doctrine.
- Library surface read from `acks-lib/docs/API.md` + `scripts/vocab.mjs`
  (enum key extraction), `acks-abilities/docs/MODEL.md` + `scripts/*.mjs`.
- This audit reads upstream data only; it asserts no sign-off on any cookbook
  entry. `audited` remains content's to set.
