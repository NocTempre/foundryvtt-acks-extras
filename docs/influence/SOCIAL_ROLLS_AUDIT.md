# Influence Module — Scope & Integration Audit

> ⚠️ **FINDINGS DOCUMENT — most phases NOT IN EFFECT (2026-07-19).**
> Records the state of `acks-influence` v0.9.1 measured against three asks:
> (1) own the automation and UI for every 2d6 social roll — three influence
> stances, NPC loyalty, and combat morale; (2) retire the module's own example
> compendium in favour of acks-lib + acks-abilities; (3) audit what acks-content
> actually produces against what this module needs. No remaining phase runs
> without an explicit go-ahead.
>
> **Status 2026-07-19: phases 0-5 complete, phase 6 partial (8 of 23
> abilities audited).** §7 has the full table. The findings in §1-§4 are
> preserved as written so the reasoning behind each change stays legible;
> where a finding has since been fixed, the phase table says so.
>
> Shipped across four repos: acks-lib 0.6.0, acks-influence 0.12.0,
> acks-henchmen 0.10.0, acks-content (register + specs).

Versions measured: influence 0.9.1, lib 0.5.0, abilities 0.5.0, content 0.15.0,
henchmen 0.9.3, monsters 0.5.3, core system @ `d55c60a`.

---

## 1. Roll inventory — who owns what today

Every 2d6 social roll in ACKS II, and where it currently lives:

| Roll | Cite | Owner today | Influence-hosted |
|---|---|---|:---:|
| Reaction — Diplomacy | RR 84-87, JJ screen | influence | ✅ tone |
| Reaction — Intimidation | RR 84-87, JJ screen | influence | ✅ tone |
| Reaction — Seduction | RR 84-87, JJ screen | influence | ✅ tone |
| Reaction to Hiring Offer | RR 162 | influence mode + henchmen ctx | ✅ external mode |
| Hireling Loyalty | RR 166 | influence mode + henchmen ctx | ✅ external mode |
| **Hireling Obedience** (2d6 + morale) | RR 167 | **henchmen's own ThrowDialog** | ❌ |
| **Irrefusable Offer** (captured monster) | MM 351 | **henchmen's own ThrowDialog** | ❌ |
| **Combat / battle morale** | RR 307 | **core `rollMorale()` — bare 2d6, no bands** | ❌ |
| Domain morale | JJ | out of scope (extract §8) | ❌ |

Influence owns five of eight. The three it does not own are the three the ask
is aimed at — and two of them (obedience, irrefusable offer) are already
implemented twice over, once in henchmen's `ThrowDialog` and once conceptually
in influence's mode engine.

**Obedience and Irrefusable Offer are the cheap wins.** Both are 2d6 + a
modifier stack resolved against a five-band table — structurally identical to
the `hiring` and `loyalty` modes already in `EXTERNAL_MODES`. Porting them is
config, not engine work: henchmen keeps computing the ctx (effective morale,
monster morale mod, refusal counts) and hands it over exactly as it already
does for loyalty. See `acks-henchmen/scripts/engine/events.mjs:152` and
`engine/monster.mjs:67`.

---

## 2. Correctness findings in what already ships

### 2.1 The hiring mode stacks mutually-exclusive proficiencies — BUG

`constants.mjs` `EXTERNAL_MODES.hiring` offers all four tone proficiencies as
auto-populated checkboxes:

```
auto: prof:diplomacy, prof:intimidation, prof:seduction, prof:mysticAura
```

`computeDefaults` pre-checks every box the actor qualifies for, so a character
holding all three tone proficiencies plus Mystic Aura opens the hiring page at
**+4**. RAW (extract §5.1): the three tone proficiencies are *mutually
exclusive* — each stacks with Mystic Aura and with nothing else. The correct
ceiling is **+2**.

The three core tone pages are not affected: each tone renders only its own
proficiency, so exclusivity falls out of the layout. It is only the modes —
which flatten all tones into one page — that expose the gap. Any morale or
obedience mode added later will inherit the same bug unless exclusivity is
modelled rather than implied by layout.

### 2.2 Loyalty applies half of Inhumanity — INCONSISTENCY

`EXTERNAL_MODES.loyalty` sets `includeEffectMods: false`, but `#buildModConfig`
appends the race-relations row to *every* mode unconditionally
(`influence-app.mjs:257`). So on a loyalty roll:

- the campaign relations registry row **applies**, but
- the shipped Inhumanity compendium items (which are effect-based) **do not**.

Both express the same RAW rule. Inhumanity is explicitly stated to cover
"reactions, loyalty, and morale" (extract §6.2), and `RACIAL_REACTIONS_PLAN.md`
§C says as much. The two halves of one rule currently disagree, and the half
that silently drops out is the half a GM actually installed from the compendium.

### 2.3 Everything else checks out

Attitude ladder, band tables, the 6-8 toward-Neutral special case, natural
2/12 clamps on loyalty, bribe tiers and the gold transfer, the hidden-target GM
relay, and per-tone modifier layouts all match the extract. The three-stance
automation is in good shape — the defects are at the mode boundary, not in the
core roller.

---

## 3. The compendium retirement — the load-bearing finding

**There are two incompatible effect models in the family, and they do not talk.**

| | influence | abilities + content |
|---|---|---|
| Storage | **ActiveEffect documents** on the item | **structured data** at `flags["acks-abilities"].extras.effects[]` |
| Discovery | change key `flags.acks-influence.reaction` | `{type:"modifier", target:"reaction"}` |
| Vocabulary | influence's own effect flags | acks-lib `MODIFIER_TARGETS` / `effectField()` |

`bindAbility()` (`acks-content/scripts/cookbook.mjs:856`) returns an item with
`system` and `flags` — and **no `effects` array at all**. Content-imported
abilities carry zero ActiveEffect documents.

> **Consequence: dropping the example compendium today blinds the roller.**
> Every effect-granted modifier — Beast Friendship, Ancient Pacts, Deathly
> Visage, the four Inhumanity tiers, the BTA caste items, all of it —
> disappears, and nothing from acks-content replaces it. The migration is not
> "delete the packs and add a dependency"; influence must first grow a reader
> for the abilities model.

### 3.1 Field-by-field gap analysis

Mapping each influence effect flag onto its acks-lib equivalent:

| influence flag | acks-lib / abilities equivalent | Verdict |
|---|---|---|
| change value | `effect.value` (LevelValue) | ✅ lib is **richer** — level scaling; influence is flat-only |
| `actsAs` | `provides` (`kw:` capability) + `notStacksWith` | ✅ lib is **better** — capability tokens generalise it |
| `label` | item name | ✅ |
| `situational` | `condition` (free text) | ⚠️ semantic drift — boolean UI toggle vs. free-text prose |
| `tone` | — | ❌ **no home in lib** |
| `vs` (target kind) | — | ❌ **no home in lib** (`appliesTo` is a different axis) |
| `alignmentSign` | — | ❌ **no home in lib** |
| `alignmentOnly` | — | ❌ **no home in lib** |
| `bewitched` | — | ❌ **no home in lib** |
| `optionalRule` | — | ❌ **no home in lib** |
| — | `appliesTo` (self/opponent/ally) | ➕ influence lacks it |
| — | `stacksWith` / `notStacksWith` | ➕ influence lacks it — **would fix §2.1 declaratively** |
| — | `mode` (add/replace/set) | ➕ influence lacks it |
| — | `unaudited` | ➕ influence must surface it |

Six influence axes have no representation in acks-lib. Three lib axes have no
representation in influence — and one of them (`notStacksWith`) is the correct
fix for the hiring bug, because it lets Diplomacy declare that it does not
stack with Intimidation instead of the roller inferring it from page layout.

**Recommendation:** extend acks-lib rather than sidecar these in an
influence-private flag. `tone` and `vs` are not reaction-specific — morale and
loyalty want target-kind gating too (Inhumanity is the proof: one rule, three
roll families). `bewitched` and `optionalRule` are narrower and could live
either place; `alignmentSign`/`alignmentOnly` sit naturally beside `vs` as
target-predicate axes.

---

## 4. What acks-content actually produces

### 4.1 Audit coverage is 3.7%

| Cookbook | Entries | Audited |
|---|---:|---:|
| proficiencies | 120 | 16 |
| powers | 327 | 0 |
| skills | 13 | 1 |
| **total** | **460** | **17** |

Per the recipes-not-rules doctrine, everything else imports with
`unaudited: true` — a machine draft whose sign could be inverted. Diplomacy,
Intimidation and Seduction *are* audited, but **carry no authored `specs`**:
their mechanics materialize only from the seat's own book prose via the generic
scan. Of every reaction-relevant entry, only **Bribery** has an authored spec.

### 4.2 A concrete misclassification — "loyalty rolls" imports as a proficiency throw

`cookbook/registers.json > tables.modifierTarget` has 36 surface forms. It maps
`reaction rolls`/`reaction roll` → `reaction` and `morale`/`morale score` →
`morale`, but for loyalty it has **only `loyalty score`**. The table ends with
catch-all surfaces `rolls`/`roll`/`throws`/`throw` → `proficiencyThrow`.

Simulating `classify()` against the phrasings the books actually use:

| Phrase | Classifies as | |
|---|---|---|
| `reaction rolls` | `reaction` | ✅ |
| `morale rolls` | `morale` | ✅ |
| `loyalty score` | `loyalty` | ✅ |
| **`loyalty rolls`** | **`proficiencyThrow`** | ❌ **wrong** |
| **`loyalty roll`** | **`proficiencyThrow`** | ❌ **wrong** |
| `reaction` (bare) | `null` | ⚠️ dropped |

"+1 to loyalty rolls" is standard ACKS phrasing, and it currently imports as a
proficiency-throw bonus — silently, and to the wrong subsystem. Fix is one
register edit: add `loyalty rolls` / `loyalty roll` (and, defensively, bare
`reaction`) ahead of the catch-alls.

### 4.3 The scan cannot produce the axes influence needs

Even with a perfect book and a clean register, `extractEffects` emits
`{type, target, value, mode, condition:"situational"}`. It has no way to derive:

- **tone** — nothing distinguishes a diplomacy-only bonus from a universal one
- **target kind** (`vs`) — Beast Friendship's "+2 vs normal animals" imports as
  a bare, unconditional "+2 reaction"
- **alignment scoping** — Deathly Visage's ±2 split is unrepresentable
- **the 12+ bewitched kicker**

The scan's `judge()` does mark conditional sentences `condition: "situational"`,
which is the honest degradation — but that turns every scoped bonus into a
manual checkbox with no hint of *when* it applies. That is a downgrade from the
current compendium, where Beast Friendship auto-checks against an animal target.

**These axes have to come from authored `specs` in the cookbook, not the scan.**
Which means the compendium's 23 hand-built source items are not redundant with
content — they are the *reference answers* the content specs should be written
to reproduce.

---

## 5. Combat morale — ✅ unblocked (extract done 2026-07-19)

Core's `rollMorale()` (`src/module/documents/actor.mjs:487`) is `2d6 +
system.details.morale` with a flavor line: no band table, no modifier UI, no
outcome. Compare `rollLoyalty()` immediately below it, which *does* carry a
result table.

The blocker was that RR 307's tables were absent from every local extract. They
have now been extracted to **`acks-rules/acks-influence/ACKS-Reactions-Reference.md`
§8** (LOCAL-ONLY, as always). What that pass established:

**Three distinct morale subsystems, previously conflated.** This matters more
than the table itself, because building the wrong one is the easy mistake:

| Subsystem | Cite | Scale | Owner |
|---|---|---|---|
| **Monster Morale** | RR 307 | encounter / combat | **influence** — this is the ask |
| Unit Morale | RR 468 | mass combat (Rout/Flee/Waver/Stand Firm/Rally) | acks-formation / DaW |
| Domain Morale | JJ | campaign | out of scope |

RR 436 is explicit that a commander's **morale modifier** (CHA + Command +2 +
battlefield prowess) applies to the **Unit** table — and parenthetically that
it does *not* affect Unit Loyalty. It must **not** be added to an RR 307 roll.
The audit's own §5 previously listed that modifier stack as an input for combat
morale; that was wrong, and the extract corrects it.

**What RR 307 gives us:** 2d6 + morale rating (−6…+4) against a five-band table
(Frightened Retreat / Morale Faltering / Fight On / Advance and Pursue /
Victory or Death), seven suggested modifiers, and defined trigger conditions
(group: 1/3 felled, then each further casualty; solitary: 1/3 HP, then each
further wound; either: first round the party flees).

Three implementation notes the rules force:

- The modifier list is explicitly **"suggested"**, and its pairs are **tiers,
  not cumulative** — 2/3 HP lost supersedes 1/2; 2:1 outnumbering supersedes
  plain outnumbering. Summing them would be wrong.
- **No natural-2/12 clamp** is stated (unlike Hireling Loyalty, RR 166). Do not
  invent one.
- The three outcome states — **frightened, faltering, cowering** — are already
  in acks-lib's `CONDITION_KEYS`. Apply them as conditions, not bespoke flags.
- **PCs are exempt.** Morale is Judge-side for monsters and NPCs; a roller must
  never force a PC's action.

---

## 6. Housekeeping

### 6.1 The example compendium is no longer shipped — ✅ removed

The 23 items in `packs/proficiencies` are **superseded, not unsafe.** They are
ACKS II proficiency and class-power content used in-app under the **ACKS II App
License** §2, which covers ACKS II names, text, tables and data incorporated
into a registered app. That use was vetted and remains legitimate. This is a
different category from the bulk book extracts in `acks-rules/`, which are
LOCAL-ONLY for their own reasons and stay that way.

They were removed because the module is handing this job to acks-lib +
acks-abilities + acks-content, and a module should not ship a placeholder
compendium that its own successor is meant to replace — it invites GMs to
install duplicate copies of abilities that content will import properly.

Removed from the manifest, the repo, and the release artifact on 2026-07-19.
The macro pack (authored JS) is unaffected. Reference copies are preserved at
`acks-rules/acks-influence/compendium-reference/` because the effect
*structures* remain the specification acks-content's authored specs should
reproduce (§4.3) — kept out of the repo to avoid a second copy drifting from
whatever content eventually produces, not because the content is restricted.

**Git history purge is a hygiene pass, not remediation** — deferred until a
replacement is fully in place. Nothing about the current history is an
exposure, and there is no reason to retract the published `v0.9.1` asset.

> **Correction (2026-07-19):** an earlier revision of this section framed the
> removal as IP remediation and flagged `tools/ip-scan.mjs` for missing a leak
> at its 1500-char prose threshold. That was wrong on the premise. App-licensed
> mechanical text belongs in packs; tightening the scanner to fire on
> 300-char item descriptions would raise false positives on permitted content
> and erode a gate that is correctly aimed at bulk extract dumps and
> attribution boilerplate. No scanner change is warranted.

### 6.2 Other

- **Stale version prose in henchmen.** `integrations/influence.mjs` and
  `engine/events.mjs` say "acks-influence v1.3+" — that line was purged in the
  0.9.0 renumber. The `hostsModes()` gate itself is correct (`apiVersion >= 3`,
  influence ships 4); only the comments mislead.
- **No declared dependency** on acks-lib or acks-abilities in `module.json` yet.
- Name-based proficiency detection (`PROFICIENCY_MATCHERS`) survives the
  migration: content's entry names — Diplomacy, Intimidation, Seduction, Mystic
  Aura, Performance — all match the existing regexes. Detection is not a
  migration risk; *effects* are.

---

## 7. Recommended sequencing

Ordered by dependency, not by appeal. Phases 1 and 6 are independently
shippable; the rest are gated.

| # | Phase | Status | Landed in | Notes |
|---|---|:---:|---|---|
| 0 | **RR 307 rules extract** | ✅ | rules extract §8 | Also corrected a scope error: unit-morale modifiers do **not** apply here. |
| — | **Stop shipping the compendium** | ✅ | influence 0.10.0 | Superseded, not unsafe (§6.1). |
| 1 | **Fix §2.1 + §2.2** | ✅ | influence 0.10.x, apiVersion 5 | `exclusive` mod sets; roll families via change key. |
| 2 | **Register fix** (§4.2) | ✅ | acks-content | Plus `reactions`, and every family's roll/score forms. |
| 3 | **Extend acks-lib** | ✅ | **acks-lib 0.6.0**, apiVersion 2 | `scopeApplies` + `vsKinds`/`vsAlignment`/`tones`/`optionalRule`/`kickerAt`. |
| 4 | **Influence reads the abilities model** | ✅ | influence 0.11.0, apiVersion 6 | Dual-source, one gating path. `unaudited` badged and never pre-ticked. |
| 5 | **Morale-family pages** | ✅ | influence 0.12.0 (apiVersion 7) + henchmen 0.10.0 | `morale`, `obedience`, `irrefusableOffer`; henchmen's dialogs adopted. |
| 6 | **Content audit burn-down** | ◑ partial | acks-content | **8 of 23** reference abilities audited. See below. |

### Phase 6 status

Audited and specced (RR 107-117, read per entry): **Diplomacy, Intimidation,
Seduction, Mystic Aura, Beast Friendship, Folkways, Bargaining, Bribery.**

Still unaudited — the remaining 15:

- **RR proficiencies:** Animal Husbandry, Performance.
- **JJ class powers:** Command of Voice, Bedazzling Glamour, Glamorous Aura,
  Ancient Pacts (+ Greater), Deathly Visage, Inhumanity 1-4. Inhumanity needs
  paired effects of opposite sign across all three roll families.
- **BTA caste:** Highborn, Oathsworn/Craftborn/Workborn, Houseless — each needs
  `optionalRule: "btaCaste"` and `vsKinds: ["dwarf"]`.

Until those are done they import as machine drafts: badged unverified in the
roller and never pre-ticked, which is the correct degradation but not the
finished state.

**What changed about the headline.** The functional gap the compendium removal
opened is closed — imported abilities now drive the roller, with their scoping
intact and their audit state visible. What remains is not architecture but
reading: 21 of 460 content entries are chef-audited, and zero of the 327
powers. That burn-down is the long pole it always was, and the preserved
reference items remain the specification to write against.

One method note for whoever continues it: verify every `from` locator against
the real page text before stamping `audited`. Doing so on this pass caught a
live defect — Bribery's existing spec was missing its first tier, because the
day-pay bonus is phrased differently on the page than the week and month ones
and the old locator silently missed it. A spec that looks right and matches
nothing is indistinguishable from an ability with no mechanics.
