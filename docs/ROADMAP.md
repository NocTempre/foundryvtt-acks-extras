# Roadmap — repo level

Work that is designed but not built, and primitives that exist ahead of the thing
that will consume them. Anything here is deliberately absent from the code, not
missing from it.

Feature-scoped roadmaps live in `docs/<feature>/ROADMAP.md`.

---

## Standing cleanup passes (from the 2026-08-02 merge cleanup, still owed)

- **CSS token / dark-mode restyle.** 7 of 10 stylesheets ignore the
  `--acks-*` tokens, so most UI ignores dark mode and the fontScale setting.
  The natural next UI project.
- **Stale flag-scope docstrings.** ~40 comment sites across abilities,
  equipment, henchmen, influence, lib and formation still name pre-merge flag
  scopes (`flags["acks-abilities"]…`) the code no longer uses. Verified stale
  against `getFlag(MODULE_ID, …)`; validate-extra skips comments by design,
  so this is a deliberate scoped pass, not a gate.
- **Pre-merge hook names.** lib's `acksLibMounted` / `acksLibStorage*` /
  `GROUP_HOOKS` keep their old names pending a check for external consumers
  (acks-domains/structures may listen). Rename or ratify — do not "fix"
  without that check.
- **Comment sweep, strict cut: the unswept remainder.** Two waves
  (2026-09-22/23) cut the comments of about 200 scripts and 11 stylesheets to
  the strict reading of `.claude/rules/docs-doctrine.md`: a docstring gives
  what the symbol does or returns, the caller's contract, and a guard in one
  clause; history, rulings and rejected alternatives moved to the feature's
  DECISIONS, dated 2026-09-22. Not yet swept: most of `tools/`, `discord/`,
  `scripts/bridge`, `scripts/location`, `scripts/factions`, the rest of
  `scripts/importer`, `formation`, `equipment`, `classes`, `lib`, `henchmen`
  and `monsters`, the two entry points, and the templates. What the waves
  learned: one agent per file list, with a gate proving each file's code token
  stream unchanged, does the cut cheaply, but the DECISIONS entries it stages
  do not survive unchecked: several jobs invented counts, causes and costs,
  and pointed code at headings they never staged. Each entry has to be read
  against the removed comment text before it merges, and that review is the
  pass's real cost. A cheaper first step is a grep of the unswept files for
  the defect signatures the waves found: porting attribution, `ruledata/` and
  local-only rules paths, pre-merge module names, retired settings and
  macros, printed values beside page citations. Comments the waves cut
  without staging are recoverable from the parent of the 8.0.7 commit.
- **Findings of the comment sweep, not yet fixed.**
  - *Printed values in shipped code:* `WOUND_PENALTIES` in
    `scripts/henchmen/rules/loyalty.mjs` (see
    [henchmen/ROADMAP.md](henchmen/ROADMAP.md)); the band and value fields in
    `scripts/henchmen/rules/throws-data.mjs`; the bribe ladder in
    `#bribeTiers` (`scripts/influence/influence-app.mjs`); three literals in
    vehicle arithmetic (`seaSpeeds` in `vehicle-speed.mjs`, `repairPlan` in
    `vessel-damage.mjs`, `#stationView` in `vehicle-sheet.mjs`). Unverified:
    a multiplier in `scripts/lib/movement-scales.mjs`, the saves lookup in
    `scripts/monsters/config.mjs`, and the hardcoded bonuses the formation
    ability bridge applies in place of cookbook effects.
  - *Printed content in tracked, unshipped files:* the scavenged-condition
    fixtures in `tools/test-equipment.mjs`; a masterwork bonus and price in
    the pristine-snapshot ruling of `docs/equipment/DECISIONS.md`; printed
    item strings quoted in `docs/importer/DECISIONS.md`.
  - *Stale text:* the header of `scripts/henchmen/apps/throw-dialog.mjs`
    (porting attribution, a `ruledata/` path, outcome names with their
    natural rolls); the header of `scripts/monsters/config.mjs` (a local-only
    extract path, the retired sample-monster generation, pre-merge module
    names); the user-visible strings `ACKS-HENCHMEN.migration.wiped` and
    `ACKS-HENCHMEN.repair.swept` (a pre-merge module prefix, a version, a
    history claim); `docs/equipment/MODEL.md` lists the `slayer` effect
    domain as consumed, and no script reads it by name.
  - *Code:* `bindVariation` in `scripts/importer/cookbook.mjs` spreads `data`
    and `dataFields` twice (harmless).

---

## Vehicles

SHIPPED 4.2.0–4.4.0 as the `acks-extras.vehicle` sub-type — namespaced so core
[#154](https://github.com/AutarchLLC/foundryvtt-acks-core/issues/154) (still
open, untouched since 2026-04) can ship a bare `vehicle` without a name fight;
if it does, this becomes a migration.

Built: cargo weighed by the capacity primitive, crew complements with
proportional understrength slowdown, draft teams with the book's substitutions
(abstract rows plus real animals in harness, one carry model in
`lib/attachment.mjs`), wind and hunger and stowed-mast multipliers, terrain
and road multipliers with Driving and Seafaring, the boarding macros, vessel
damage and sinking, sea navigation and hazards, and the 12-hour voyage clock
(all derived and published; some still lack a rolling surface).

Not built — the feature-level list is
[docs/vehicles/ROADMAP.md](vehicles/ROADMAP.md); the headline is **war
machines** (an engine as an item with stone cost, damage class, and a crew to
lay and loose it) and the surfaces for hazards, navigation, and the sinking
clock.

## Magic

The largest unbuilt area, and the reason two primitives already exist unused.

**A real spell primitive.** `lib/fields.mjs` `spellRefField()` is a placeholder:
it points at the core system's existing spell item by uuid and carries the
printed name as a fallback, which is enough to link and display but models
nothing about the spell itself. When magic lands it becomes a real primitive —
school, range, duration, save, reversibility, ritual/formula cost — and the
`spell` string on `effectField` retires in favour of it. It exists now so the
shape is agreed before anything depends on it.

**Spellcasting value as a conditional scale.** `lib/vocab.mjs` `VALUE_SCALES`
carries `arcaneValue` / `divineValue` so a custom-class power can state a cost
that varies by the class's spellcasting value ("counts as 1 power at Arcane Value
1–2, 2 at Arcane Value 3–4"). Nothing consumes them yet; the ability model still
stores a plain numeric `powerValue`. Wiring `powerValue` onto `levelValueField()`
is the step that activates them.

---

## The domain-module family

`location` is designed for extension by a future structures/strongholds module:
other modules store their own data in their own flag namespace on the same
location actor, and this schema stays minimal.

Until such a module publishes, the "has X" fallback chain in `henchmen/facts.mjs`
is the contract — owning-module API, then actor flag, then an **inventory marker
item** whose name declares the fact ("Stronghold: Border Fort", cost = gp value),
then null so the caller asks the GM. A future module supersedes the markers
transparently by taking over the first step; nothing else changes.

---

## Henchmen

**Candidate generation.** Rolled results are RECORDED today; generating the
people is a future module. The record is the interface between the two.

**The full class distribution.** Candidate class rolls currently fall back to the
core-six percentages when the full JJ double-d100 distribution has not been
imported — fighter, crusader, thief, mage, explorer, venturer. The expansion and
demihuman classes are GM endpoints anyway and simply do not appear until the
distribution is imported.

---

## Monsters

The enum and DataModel migrations are **done** — `monsters/config.mjs`
re-exports the shared vocabulary, and the extras model stores lib's shared
field shapes (speeds, senses, vision, defences). Nothing monster-shaped is
parked here.

---

## Groups

`lib/group-logic.mjs` reads a monster's number-appearing to size a group. The
richer seams — lair chance, supply cost, battle rating — are documented in
`group-data.mjs` and deliberately unread, waiting on the domain work that would
give them somewhere to be spent.

---

## The free-variable gate, family-wide

`tools/free-variables.mjs` (DECISIONS §17) is repo-owned for now. Every module
in the family has the same exposure, so once a release has proven the gate on
the Node version CI runs, it moves to acks-module-template's synced tools. The
browser/Foundry allowlist becomes the shared base, each repo's additions sit
beside it, and `validate.mjs` calls the gate instead of each repo's
`validate-extra`.

---
