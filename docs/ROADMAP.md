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
    `scripts/henchmen/rules/loyalty.mjs` and the henchmen figures left beside
    it (see [henchmen/ROADMAP.md](henchmen/ROADMAP.md)); three literals in
    vehicle arithmetic (`seaSpeeds` in `vehicle-speed.mjs`, `repairPlan` in
    `vessel-damage.mjs`, `#stationView` in `vehicle-sheet.mjs`). Unverified:
    the saves lookup in `scripts/monsters/config.mjs`, and the hardcoded
    bonuses the formation ability bridge applies in place of cookbook effects.
  - *Printed content in tracked, unshipped files:* the scavenged-condition
    fixtures in `tools/test-equipment.mjs`; a masterwork bonus and price in
    the pristine-snapshot ruling of `docs/equipment/DECISIONS.md`; printed
    item strings quoted in `docs/importer/DECISIONS.md`.
  - *Stale text:* the header of `scripts/monsters/config.mjs` (a local-only
    extract path, the retired sample-monster generation, pre-merge module
    names); the user-visible string `ACKS-HENCHMEN.repair.swept` (a pre-merge module
    prefix, a version, a history claim); `docs/equipment/MODEL.md` lists the `slayer` effect
    domain as consumed, and no script reads it by name.
  - *Code:* `bindVariation` in `scripts/importer/cookbook.mjs` spreads `data`
    and `dataFields` twice (harmless).
- **Provenance tooltips: the retrofit.** `.claude/rules/ui-tooltips.md` asks
  every figure to name where it came from. Done: the henchmen Service panel.
  A census of `templates/` on 2026-10-24 counted the lines that render a
  figure with no tooltip within two lines above it, so each count is an upper
  bound and figures assembled in scripts are not in it: about 73 lines —
  `monsters/` 15 (the stat block and the Henchman tab, which also prints bare
  `HP`, `AC` and `XP` labels outside the lang file), `formation/` 13 (most in
  the wilderness tab's camp forecast and throws), `character-sheet/` 9,
  `lib/` 7 (the follower card, the group sheet), `influence/` 6,
  `location/` 6, `equipment/` 5, `abilities/` 3, `markets/` 2, `factions/` 2,
  `vehicles/` 1. Beside them, 7 `title=` attributes (the domain realm and
  ledger tabs 4, the class, race and template sheets) and
  the tooltips assembled at render in `data-tooltip` rather than
  `data-tooltip-text`, most of them on the class sheet. A figure whose
  tooltip cannot be written goes on the bug-intake ledger as the rule says,
  not into this list.

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
Scoped 2026-09-24: [magic/wip/20260924-scoping.md](magic/wip/20260924-scoping.md)
holds the feature decomposition (`magic`, `magic-items`, `research`), the data
model, the importer recipes, the release phasing and the open questions; its
substance moves into `docs/magic/` as each release lands.

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

The "has X" fallback chain in `henchmen/facts.mjs` is the contract — owning-module
API, then actor flag, then an **inventory marker item** whose name declares the
fact ("Stronghold: Border Fort", cost = gp value), then null so the caller asks
the GM. The `domains` feature's record now exists; taking over the chain's
first step from it is that feature's wave 3 ([domains/ROADMAP.md](domains/ROADMAP.md)),
and nothing else in the chain changes.

---

## Experience beyond the character

**A will's items.** Settling a will pays coin into the heir's vault only;
bequeathing named items to the heir is by hand (docs/classes/DECISIONS.md,
2026-09-30).

**A monster henchman's advancement.** Deal XP credits a monster henchman's
share onto its own flag and the Service panel shows the total
(docs/henchmen/MODEL.md). Not built: showing that the creature has enough
experience to advance, and advancing it. Both need the book's monster
advancement thresholds, which no importer recipe reads yet, so the panel shows
the credited figure alone. The importer reads the threshold first, then the
panel shows readiness as a figure with its page; applying an advance stays the
Judge's.

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
field shapes (speeds, senses, vision, defences).

**Costing a spell-like ability by its usage.** The monster-creation table
that prices a spell-like ability by how often it can be used imports with the
creation tables when a monster builder consumes it. Nothing reads a factor
today, so none ships; the usage itself is the shared frequency vocabulary.

**The lair line reads the hex.** The Statblock's lair row rolls the chance;
what a stocked hex holds for this creature (`formation/hex-stock.mjs`) is not
read back onto the sheet, because the hex exposes no read keyed by actor. A
reading of the lair's stock and its place on the map waits on that read.

---

## Groups

The Roll sizes a group from a creature's encounter line (`docs/lib/GROUPS.md`). The
rest of the encounter group, the recipe a side's units, leaders and young need
through to the fight and its aftermath, is mapped in
`docs/lib/wip/20261031-encounter-group.md`.

A scouting result does not set the reveal. Nothing in the module produces one for a
group yet: the Judge's select is the control. The first result that can reach it is
`detection()`'s `partySees`, when an encounter card stands a group up.

Supply cost and battle rating are documented in `group-data.mjs` and deliberately
unread, waiting on the domain work that would give them somewhere to be spent.

---

## The free-variable gate, family-wide

`tools/free-variables.mjs` (DECISIONS §17) is repo-owned for now. Every module
in the family has the same exposure, so once a release has proven the gate on
the Node version CI runs, it moves to acks-module-template's synced tools. The
browser/Foundry allowlist becomes the shared base, each repo's additions sit
beside it, and `validate.mjs` calls the gate instead of each repo's
`validate-extra`.

## Book text still in comments and lang strings

- **Comments that quote a book sentence.** The 2026-09-23 quote audit cleared
  equipment, formation and lib; what remains sits mostly in the importer, with
  a few each in classes, location, markets, henchmen and influence. Many
  importer hits are compile anchors, which are structural, so each hit needs a
  reviewer's call rather than a sweep.
- **Lang strings a user reads that print a figure.** Influence, henchmen,
  formation and equipment still hold keys whose text states a number. Each key
  is ruled printed (it moves onto the import, `acks-printed-value`) or
  structural (it stays), after a recount against the 2026-11-11 imports.

---
