# The beastmen, captured whole (wip)

**Status: PLAN — NOT IN EFFECT.** The map for the owner's 2026-11-24 request.
Nothing below is MODEL until its slice lands. As each slice lands, its substance
moves into `docs/monsters/`, `docs/lib/` and `docs/importer/`, and this file is
deleted with the last of them (`.claude/rules/docs-doctrine.md`, wip lifecycle).
A phase session appends its results under "Results" and corrects the next
phase's start prompt before it reports.

This file ships in the repo, so it holds no printed figure, no option name and
no tribe name. The section is MM pp. 47-57. Troop roles are **R1-R7** in the
order of the p. 55 table's rows, traits **T1-T10** in the order of the p. 57
table's rows, the optional equipment **E1-E9** in the order the section prints
it, the village rows **V1-V7** in the order of the p. 54 table's rows.

It extends `docs/lib/wip/20261031-encounter-group.md` (the encounter group,
unbuilt §3d-§3g) and does not run beside it.

## The owner's words

1. "I want the beastmen template fixed with special attention towards capturing
   everything in this document mechanically (plus arranging art correctly,
   etc)."
2. "Fixing the group actor type to handle generating a warband, assigning
   special troop types, equipment packages, spell casters, etc. Seems like the
   right approach. Many of these items generate ranged aura effects or require
   an action to activate. All of that game surface is in scope."
3. "Furthermore, creating kits (including random ones suited to matching roles
   and custom as a group, as a unit type, or as an individual) is desired."

A brief quotes these, and the agent's report restates each with one example
before building on it.

## What was checked on 2026-11-24

- **The shipped axes are right.** The library template `mm.familyBeastman`
  (Variant, Leader figures, Role, Kit; 204 cells) was read from the test world
  and its 42 leader, caster and dependant cells and six stat blocks compared
  with the six breed pages figure by figure. Every one matches the breed page.
- **Four pages reach no world.** MM pp. 54-57 belong to no cookbook entry.
  One recipe, `hookedWeapon`, reads two figures from them, and neither caller
  of `maneuverMods` passes `hooked`, so those figures are applied nowhere.
- **Two pictures are imported nowhere.** The overview page's strip of five
  captioned heads is placed 1036 by 329 samples, a ratio the `art` op's
  `maxRatio` of 3 refuses, so `mm.beastman` reads no art; and `importFamily`
  leaves the overview member before its art block either way. The p. 56 plate
  (1032 by 1134 samples) sits on a page no entry reads. The template's picture
  is the first breed's portrait. The six portraits import correctly.
- **`group.mjs` `rollBodyHp` rolls a stack's Hit Dice for every body**, so a
  printed leader's fixed hit points would not stand in a group.

## 1. Coverage matrix

**Today:** Y captured, P partly, N not. **Lands in:** R a table in the
`monsters` registry document; Rc a part of the variant's
`extras.encounter.recipe`; Ax a template axis; C a template cell; I an item; G
a field on the group. **Class:** STAND a standing figure written at
generation; GATE a modifier gated at the roll; RANGE a save, condition or part
that applies within range of a bearer; ACT activated by an action; CONS a
consumable; GEN at generation only; INFO description only.

| # | Row | Today | Lands in | Class: surface | A walk observes |
|---|---|---|---|---|---|
| 1 | Overview prose | Y, template biography (`overviewIsLore`) | — | INFO | — |
| 2 | Chance of speaking Common, by rank (per HD for leaders) | N | R | GEN: `organisation-logic` | speaker count on the stack; language on a leader |
| 3 | Head strip: five heads, each captioned with a trait | N | trait option `art`, trait ability `img` | INFO | five trait options show a head |
| 4-5 | Stat block and portrait, ×6 | Y, variant preset | — | — | — |
| 6 | Breed combat qualities, ×6 | P: figures folded into the stat line; the surprise part and the leader exemption are unread | I, a quality ability per breed | GATE, plus a new against-side surprise part | the surprise card lists the part |
| 7 | Breed's default split and its rounding | N | Rc | GEN | counts in the unit tree |
| 8-9 | Warrior and archer loadouts with tribe alternatives, ×6 | P: RR rows exist as Kit-axis stat cells; the MM's are unread | kit bundles; Kit option `ref` | STAND for armour; weapon items; `equipment/ammo.mjs` | an archer fires and its ammunition counts down |
| 10 | Leader sentences | Y, Role cells | — | — | — |
| 11 | Morale part while the chieftain lives | N | Rc `moraleWhileAlive` | GATE: the `morale-roll` provider reads the living leader stack | the part is gone after the chieftain falls |
| 12 | Dependant shares | N | Rc | GEN | dependant stack counts |
| 13 | Dependant figures and "fight as" | Y, Role cells | — | — | — |
| 14 | Village guard beasts | N | Rc: chance, dice, creature ref | GEN, a labelled stack where the library has no such creature | beast stacks |
| 15 | Captives per warband | N | Rc | GEN, labelled stack | captive stack |
| 16 | Caster chance (the level die is Y) | N | Rc, which pins the role | GEN; the level is rolled by `generateFromTemplate` | level in the log |
| 17 | One breed's chieftain's guard | N | Rc | GEN | guard stack |
| 18 | Spoils | Y | — | — | — |
| 19 | Encounter lines counted in units | P: parsed; the Roll and the lair refuse units (`ROLL_KIND.units`, `planLair` answers `"units"`) | Rc, unit recursion | GEN | unit tree |
| 20, 22 | Role XP; lair chance | Y | — | — | — |
| 21 | Treasure per warband | P: drawn once per monster | G hand-off | GEN: rows added to the treasure pot's deal list | one row per warband |
| 23 | Sidebar quotations | n/a | — | INFO | — |
| 24 | A leader per unit (gang, warband, lair or village) | N | procedure | GEN | leader stacks |
| 25 | Village table V1-V7 × breeds | N | R `beastmanVillage` | GEN (`source: table`) | rows in the Ruledata Browser |
| 26 | Leader table (AC with armour words, HD, hp, die or modifier) | N; the prose covers AC, HD, hp and modifier | R `beastmanLeaders`; a `table` option on Leader figures | STAND, through `leaderCell` | a leader generated with source = table |
| 27 | Optional three-way split | N | R | GEN | counts |
| 28 | Leaders take their unit's role | N | procedure plus a Judge choice | GEN | leader pins |
| 29 | Special-troop table, a band per breed | N | R `beastmanSpecialTroops`; troop Ax (`bandsFrom`) | GEN, template engine | a blank role is disabled |
| 30 | R7 | N | R, plus an Rc mount ref | GEN, `stack.mounted`; pairing at deploy is new (`lib/mount.mjs`) | the rider is attached on deploy |
| 31 | R1 | N | troop option and ability | STAND attack and AC; GATE fear immunity (`recordImmunity`); GEN kit tag and E1/E7 carry | Statblock tooltip |
| 32 | R2 | N | ability rows | against-surprise part; GATE `targetCondition` plus range plus a damage mode | the row appears only against a qualifying target |
| 33 | R3 | N | proficiency grant | GEN E2 share | — |
| 34, 36 | R4, R6 | N | troop option | STAND initiative and `avoidsurprise`; R4 waives the `charging` and `retreating` figures; R6 takes a proficiency grant | initiative card |
| 35 | R5 | N | troop option | STAND AC; maneuver parts (`maneuverMods`, generalized) | the overrun card shows the parts |
| 37 | Elite-troop sidebar | N | R | the wage reaches `unit.wageGpEach`; the battle-turn part is a page reference only (no mass combat is built) | wage at hire |
| 38 | Who may carry, by breed, role and rank | N | R per item | GEN | — |
| 39 | E1 | N | gear item | GEN carry; a new damage rider on maneuvers | a wrestle hit adds the rider |
| 40 | E2 | N | gear item with effect rows | ACT (throw, fumble), CONS; area damage, save fraction; fuse on `turn-life`; structural damage handed off | blast card, halved on a save |
| 41 | E3 | N | gear item | ACT; RANGE parts with `endsOn: attack` | the next damage roll shows the part |
| 42 | E4 | N | gear item | ACT; RANGE save → `shaken`, then an immunity window; ends when lowered or the bearer dies | prompt, `shaken`, lift |
| 43 | E5 | N | consumable | CONS heal (`adjustHp`); save → `choking` | heal; the condition on a human |
| 44 | E6 | N | gear item | STAND AC; a per-die stage in `defenses`, gated on mundane damage | the Apply card shows the reduction |
| 45 | E7 | P: `hookedWeapon` is read and never applied | flag on the item | maneuver parts | disarm parts |
| 46 | E8 | N | ammunition variant | GEN carry and cascade; on-hit save; delayed damage (new) | damage lands a turn later |
| 47 | E9 | N | gear item | ACT; RANGE parts for the same group | parts only in range |
| 48 | Plate, p. 56 | N | template `img`; a crop for E4 | INFO | template picture |
| 49 | Trait table, a band per breed | N | R `beastmanTraits`; trait Ax (`bandsFrom`) | GEN | a blank trait is disabled |
| 50 | One trait per warband or village | N | G, trait on the tree node | GEN | a pinned trait survives a re-roll |
| 51 | T1 | N | `variant\|trait` cells | STAND natural attacks | the attacks are listed |
| 52-54 | T2, T3, T4 | N | ability rows | GATE `outnumbering`, `targetCondition`, `combatRound`; T3's feeding is the Judge's | rows appear only under their gate |
| 55, 57-59 | T5, T7, T8, T9 | N | trait option | STAND damage, morale and AC (after the kit); T5 grants ranks; T7 waives as R4 does | tooltips |
| 56 | T6 | N | Rc | GEN beasts by HD; a note on the pot | beast stack |
| 60 | T10 | N | ability with an always-on range | RANGE save → `queasy`, then an immunity window, at reach | a prompt for an engaged human |

## 2. Data design

### a. Per-breed bands, and where the optional systems live

- **Two new single axes, troop and trait**, each with
  `bandsFrom: {doc: "monsters", table, by: "variant"}`. The band is read at
  roll time from the registry cell for that option's row and the chosen
  variant's column. `generateFromTemplate` passes a resolver to `chooseAxes`,
  so `template-logic.mjs` stays pure.
- **Opt-in.** An axis without `bandsFrom` behaves exactly as now, which keeps
  `summonVariant`, the cast dialog and the builder as they are.
- **Under `bandsFrom`:** an option with no band for the chosen variant is
  unavailable (`optionAvailable`); a roll outside every band takes the default
  and logs `gap` (the uniform fallback would invent a distribution); a
  `ROLL_PIN` lets a Judge roll an axis that names a default.
- **Gear is a multi axis**; the group generator rolls who carries.
- **Every figure is read at generation** by monsters
  (`importedOrganisation()`), as `applyGeneratedKit` reads natural armour
  class, so a Judge's override counts without a repair. The template keeps
  structure only: keys, imported labels, items, cells, art.
- **Keys** are ordinals bound to the register's paragraph anchors, as
  `hookedWeapon`'s `locate` is; a table row is matched to its rule paragraph at
  import by folding both labels; labels are minted with `keyByLabel`
  (the `bodyForms` precedent). No troop, trait or item name is in source,
  `lang/`, a test or a doc.

*Rejected:* bands on cells (every patch duplicated per breed, and an option's
own patch defeats the blank handling); bands copied onto options at import (an
override would need a repair); the registry with no axes (the builder could
not generate one creature with a role or a trait).

### b. A warband, lair or village from a family

- **Boundary.** The lib group sheet calls a `services.mjs` contract,
  `encounter-generator` v1, and monsters provides it (GROUPS.md, "Boundaries").
- **Engine.** `scripts/monsters/encounter-recipe.mjs`, pure, rng injected:
  units of units, parts carrying role, count, chance, when,
  `moraleWhileAlive`, cite and `source` (page or table).
  `scripts/monsters/organisation-logic.mjs` layers the optional rules: the
  split, a troop roll per sub-unit, one trait per warband or village, carry
  rolls with their cascades, mounts, T6. The breed prose is read by
  `importer/ecology-recipe.mjs` (the encounter-group wip's §3e).
- **Stacks.** One stack per identical prototype, counts summed across units,
  each with `stack.gen = {rollKey, nodes: {nodeKey: n}, pins, fixedHp}`.
- **One mechanism for a per-body difference.** A carry roll that hits one body
  and a kit given to one individual both become a roster record whose delta
  adds the items (`materializeMembers(…, {extraDelta})`).
- **The record.** `system.generation = {rollKey, template ref, variant, state,
  context, rules {troops, traits, gear}, source, choices, tree [{key, kind,
  parent, role, trait, flags, pinned[]}], log}`.
- **Re-roll, pin, edit.** A re-roll replaces only the stacks carrying its
  `rollKey` and refuses while a body is on the map or fallen; pinned node
  fields survive; editing a node regenerates that node's stacks.
- **Needed in lib:** a printed leader's fixed hit points standing in
  `rollBodyHp`; a labelled stack with no prototype; `rollLair` asking the
  service where `planLair` answers `"units"`.
- **Judge choices where the page is silent**, each asked once and kept in
  `generation.choices`: a lone warband's sub-chieftain role when its gangs
  differ; which eligible leader carries E4 or E9; a breed page's alternative
  guard beast; the alternative loadouts; rounding of dependant shares, and
  whether missile troops count for the shares and for T9; what beasts T6 adds;
  how often E5 is used; whether E9's condition is range alone; whether a
  breed's weapon damage modifier reaches T1's natural attacks.

### c. Kits

- **A kit is a core bundle** (`system.itemList`, `bundles-logic.mjs`
  `bundleRows`) linking shared library items, plus
  `flags.acks-extras.kit = {stat, suits {variants, roles, troops, tags}, cite}`.
  `stat` is today's `extras.kit` payload, or null.
- **Minted at import:** one kit per breed × troop row (its stat side the
  current Kit-cell payload, its weapons resolved with `lib/weapons.mjs`
  `keyForName` against the library), and one per gear item.
- **The Kit axis stays** (`kitPresets`, `applyGeneratedKit`); each option gains
  a `ref` to its kit, so the weapons ride along at generation.
- **Three scopes.** Individual: a drop on an actor sheet runs `unpackBundle`,
  and on a group body the roster delta of 2b; the stat side goes through
  `kitArmourClass` / `kitDamage` into `extras.derived.kit`. Stack: a drop on
  the row regenerates the prototype with the kit pinned. Group: a drop on the
  header reaches every stack the kit suits.
- **Random kit** picks among library kits whose `suits` match. **Custom kit**
  is a Judge-built bundle plus a suitability fieldset.
- **Items against stat cells.** Armour stays a stat cell: core's `computeAC`
  returns early for a monster, so an armour item would do nothing or count
  twice. Weapons become items (the split needs a missile attack, and "by
  weapon" needs a die). Gear becomes items: a stat cell cannot hold an action,
  charges or a range.
- **This supersedes in part** importer DECISIONS-through-v11.14.5, "2026-11-04
  — A beastman's kit is a preset of stat cells…" (its no-items bullet), and
  qualifies importer DECISIONS, "2026-11-14 — A kit leader's damage…". The new
  evidence is the owner's words 2 and 3. The slice that lands it writes the
  DECISIONS entry and edits the "In force" row in the same change.

### d. What performs each piece at the table

Exists: standing figures by the kit precedent (the resolved hook writes them,
with `extras.derived.organisation` and `derivationTips`); gated rows through
`rollGatedModifiers`; `shaken`, `queasy` and `choking` in `conditions.mjs`;
`saveSpec`, `amountAfter`, `adjustHp`, `ends-on.mjs`, `turn-life.mjs`,
`tokenGapFeet`, `maneuverMods`.

Missing in lib:

1. Gates `targetCondition`, `combatRound`, `outnumbering`, `rangeBand`; and
   `roll-gates.mjs` `labelOf` reads only `gate.light`.
2. An against-side part in `withSurpriseConditions`.
3. A waiver of a condition row's figure inside `acMath`.
4. A per-die stage in `defenses.mjs`.
5. A delayed-damage record.
6. A reader of who stands within range of a bearer, filtered by group, side
   and kind, refreshed on turn edges and moves.
7. A carrier that runs an item's effect rows.

For 6 and 7, extending the cast engine (`cast-recur.mjs`, area rows, `endsOn`,
the effect-row editor) is plausible and unproven: `cast-spell.mjs` claims
flagged spells and leaves a monster's item to the system. Slice S7 rules on
extending it against building beside it.

### e. Two sources for leaders and villages

The breed pages and the p. 54 tables disagree in seven places: one breed's
sub-chieftain armour class, one's chieftain armour class, one's champion
damage, one's chieftain damage and die, one's young share, one's second
guard-beast chance, and one breed's alternative guard beast the table omits.
`leaderSource` gains a third option, `table`, its cells keyed
`variant|role|table` and filled from `beastmanLeaders`. Village parts carry
`source`, and the generator follows the template's pin. The default stays the
breed page, which is what ships today.

### f. Art

The plate is the template's `img`. Each head goes onto its trait option and
trait item, matched by reading its caption from the Judge's PDF and folding it,
so no word ships. A crop of the plate is E4's image. Portraits stay on their
variants, and the group's image stays the creature's.
`uploadBookPicture({stem, page, crop})` renders a page region; a crop stays
above the purchaser stamp (`CROP_LIMITS.stampLine`).

## 3. Phases and slices

Each phase is a clean session that orchestrates its own agents, on a model
chosen for the work; one slice, one agent. Every slice with a live surface is
landed and walked on `main` (`acks-branch`), by `live-tester` or by the session
itself where the agent re-delegates.

| Slice | Phase | Tree | Agent, why | Delivers; acceptance | `/design` | Needs |
|---|---|---|---|---|---|---|
| S0 | 0 | main | implementer: scoped fix | The plate as the template `img`; a repair in place shows it; portraits unchanged. **Landed `1eeef046`, walked** (Results) | no | — |
| S0b | 0 | — | this session | Ledger rows: the template picture (T-0709), the unapplied `hookedWeapon` figures (T-0710), the leader hit-point reroll (T-0711) | no | — |
| S1 | 1 | topic/beastman-organisation | implementer | `bandsFrom`, `ROLL_PIN`, no uniform fallback on a gap. Offline tests on invented bands. Dependency half | no | — |
| S2 | 1 | topic | implementer | The four tables of pp. 54-55 and 57; rows and blanks match the pages; the Ruledata Browser is the Judge tool | no | — |
| S3 | 1 | topic | implementer | proseValues for R, E and T, the sidebar, speech | no | S2 |
| S4 | 1 | topic | implementer | `ecology-recipe.mjs` breed parts. Dependency half until S4b | no | S2 |
| S5 | 1 | topic | implementer | Troop, trait and gear axes; the `table` source; T1 cells; trait art; `applyGeneratedOrganisation`; tooltips; axis-order fix. Marker `monsters/beastman-organisation` | no (builder controls) | S1, S3, S4 |
| S4b | 3 | topic | implementer | The recipe editor (the Judge tool); marker `monsters/beastman-recipe` | yes | S4 |
| S6a | 2 | topic/beastman-gear | implementer | Roll gates and `labelOf` | no | S5 |
| S6b | 2 | gear | implementer | Against-surprise part, `acMath` waiver, per-die stage, delayed damage | no | S5 |
| S7 | 2 | gear | architect: crosses lib, magic and equipment | Ruling on the range reader and the item carrier | — | S6a |
| S8 | 2 | gear | implementer | E3, E4, E9, T10. Marker `lib/aura-bearer` | yes | S7 |
| S9a | 2 | gear | implementer | E2 | yes | S7 |
| S9b | 2 | gear | implementer | E5, E8 | no | S6b |
| S9c | 2 | gear | implementer | E1, E6, E7 (E7 applies the figures read today) | no | S6b |
| S10 | 3 | topic | implementer | Group schema, labelled stack, `fixedHp`, service contract, leader morale. Dependency half | no | — |
| S11 | 3 | topic | implementer | `encounter-recipe.mjs` and `organisation-logic.mjs`, offline, mutation-checked | no | S5, S10 |
| S12 | 3 | topic | implementer, then a live walk | Generate dialog, tree, re-roll/pin/edit, the Judges' card, the pot hand-off, `rollLair`. Marker `lib/beastman-warband` | yes | S11 |
| S13 | 4 | topic | implementer | Kit bundles minted; Kit option `ref` | no | S5 |
| S14 | 4 | topic | implementer, then a live walk | Three scopes, random kit, custom fieldset. Marker `monsters/beastman-kits` | yes | S13, S12 |

Phases 1, 3 and 4 run in order on the one worktree of
`topic/beastman-organisation`. Phase 2 opens `topic/beastman-gear` after S5
lands and may run beside phase 3: it writes lib's roll, defence and effect
files, phase 3 the group's.

**The design session** draws, before phases 2 to 4 build them: the group's
Generate dialog and unit tree (S12), the kit scopes and the custom-kit fieldset
(S14), the recipe editor (S4b), the activated-item and in-range surfaces (S8,
S9a). The owner's feedback on each is that slice's go-ahead
(`.claude/rules/ui-layout.md`, "Design before build").

### Start prompt, phase 1

> Read `docs/monsters/wip/20261124-beastman-organisation-plan.md` whole, then
> `.claude/rules/ip-doctrine.md` and `docs/monsters/MODEL.md` ("Family
> templates: the Role axis", "The Kit axis"). Open `topic/beastman-organisation`
> with `acks-branch` and build slices S1 to S5 there, one implementer per
> slice, each brief quoting the owner's three sentences. The book is
> `C:\Proj\acks-reference\Snips\MM_Beastmen.pdf` (LOCAL-ONLY). Land after S5,
> walk the family on `main` on seat lane B (a peer may hold lane A; no world
> shutdown without asking): repair the family in place, then for every breed
> generate each troop role and each trait and compare the figures with the
> pages. Append results here, correct the phase 2 and 3 prompts, and report.

## 4. Assumed answers, for the owner to overturn

- **Two sources (2e):** both offered, the breed page the default.
- **Real items (2c):** kits give weapon items from the imported weapons and
  the optional equipment is real items with their actions; armour stays a stat
  cell.
- **Template picture (2f):** the plate, with the heads on their traits.
- **Starting now:** the 2026-11-17 "start nothing new" cap is read as lifted by
  this request; no topic branch was open on 2026-11-24.

## 5. Risks

- `carryMergedVariants` and the repair branch force Kit to be the last axis
  (the `kitAt` splice). Troop comes before Kit, trait and gear after it, and
  each needs a union like `unionKitAxis`.
- The `monsters/family-roles` steps and `tools/live/importer-book-actors.mjs`
  read the template's axes; whether they tolerate new ones is unread.
- `importer/kit-presets.mjs` `TROOP_LABELS` and the `beastmanTroops` rows ship
  troop labels (ROADMAP's OL-2). The new tables do not copy that.
- `generateFromTemplate` makes one world actor per prototype; a village leaves
  about twenty in Generated, to be removed with the group.
- `chooseAxes` is shared by summons and the cast dialog: S1 stays opt-in.
- Hot shared files: `lang/en.json`, `register/mm/p25-p348.json`,
  `importer/table-recipes.mjs`.

## Results

*(appended by each phase)*

### Phase 0, 2026-11-24

**S0 landed on `main` as `1eeef046`, not pushed (T-0709, fixed-unreleased).**
Gate at the land: build:packs, validate and test green.

What was built, where it differs from the slice row:

- The overview's register row names the plate's page (`assists.artPage`) and
  the pick keeps the kind's size criteria. A pick by image name was tried and
  dropped: the same plate carried three different names in three reads of its
  page, and in one of them the name first chosen was a page background.
- A repair in place keeps a held actor's name and picture
  (`refresh.mjs` `refreshPlan` writes `img` only under the name policy, which
  `actorPolicy` never sets). `importFamily` therefore swaps the held picture
  itself, and only where it is one of the variants' portraits, by file name,
  so the older art folder's copy counts.
- `docs/monsters/MODEL.md` ("The family's picture") and TESTING step 10 carry
  the mechanic and the observable.

Exercised live, lane B, the second Judge seat, Monstrous Manual open: Repair
in place on the family row. The library template's `img` and its pack index
row moved from the first portrait to the plate (1032×1134, loads); the axes
and cells hashed the same before and after; the six option portraits and the
`monsters/beastman-sidebar-copy` fixture's `img` and `system` were unchanged;
no console warning or error from the click to the read. The recorder was
attached at the click, so it says nothing of `init`, `setup` or `ready`.

Offline only: `test-leader-roles` 40, `test-leader-template` 7,
`test-executor` 87, `test-cookbook-inputs` 92, `test-ax-stops` 8,
`test-ax1-cookbook` 47, each on the final tree; the compile, 291 entries
before and after with one field of one entry changed.

Not checked: a fresh import of the family (the library template stands, and
retiring it is a setup walk); a Judge-set picture surviving a repair (read
from the code); the overview strip, which is still imported nowhere and waits
for the trait rows it illustrates (2f).

Found on the walk, for the design session: **the template's sheet draws no
picture.** The plate shows only as the compendium list's thumbnail, so "the
plate, with the heads on their traits" (section 4) needs a place on the sheet
before it is visible where a Judge works.

S0b: T-0709 is fixed-unreleased; T-0710 and T-0711 stay `new`, owned by S9c
and S10.

Phase 1's start prompt above stands as written.
