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
| 40 | E2 | N | gear item with effect rows | ACT (throw, fumble), CONS; area damage, save fraction; fuse on `turn-life`; structural damage handed off | blast card, reduced on a save by the imported fraction |
| 41 | E3 | N | gear item | ACT; RANGE parts with `endsOn: attack` | the next damage roll shows the part |
| 42 | E4 | N | gear item | ACT; RANGE save → `shaken`, then an immunity window; ends when lowered or the bearer dies | prompt, `shaken`, lift |
| 43 | E5 | N | consumable | CONS heal (`adjustHp`); save → `choking` | heal; the condition on a human |
| 44 | E6 | N | gear item | STAND AC; a per-die stage in `defenses`, gated on mundane damage | the Apply card shows the reduction |
| 45 | E7 | P: `hookedWeapon` is read and never applied | flag on the item | maneuver parts | disarm parts |
| 46 | E8 | N | ammunition variant | GEN carry and cascade; on-hit save; delayed damage (new) | damage lands after the imported delay |
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

Section 4, answer 2 widens this section: the inventory is a humanoid
monster's, opt-in, and a kit may carry stat changes and abilities beside its
items. The bullets below are the design before that answer.

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

Section 4, answer 1 rules these differences intended. The breed pages and the
p. 54 tables differ in seven places: one breed's
sub-chieftain armour class, one's chieftain armour class, one's champion
damage, one's chieftain damage and die, one's young share, one's second
guard-beast chance, and one breed's alternative guard beast the table omits.
`leaderSource` gains a third option, `table`, its cells keyed
`variant|role|table` and filled from `beastmanLeaders`. Village parts carry
`source`, and the generator follows the template's pin. The default stays the
breed page, which is what ships today.

### f. Art

Section 4, answer 3 gives the plate to the warband generator and the overview
page's strip to the template, which is built (Results). The plate has no
reader until S12. Before that answer: the plate is the template's `img`. Each head goes onto its trait option and
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
| S12 | 3 | topic | implementer, then a live walk | Generate dialog, tree, re-roll/pin/edit, the Judges' card, the pot hand-off, `rollLair`; the p. 56 plate read by a register row of its own, as the generator's picture. Marker `lib/beastman-warband` | yes | S11 |
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

Section 4 is answered, so phase 1 may start. It builds no new window and does
not wait for the design session.

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

## 4. The owner's answers, 2026-11-24

Each was put as an assumed answer and amended by the owner the same day. The
owner's words are quoted whole; "Read as" is the planning session's reading,
and a brief quotes the words, not the reading.

1. **Two sources (2e).** Assumed: both offered, the breed page the default.
   Owner: "Breed is default, Table 54 shows leaders who are both better
   equipped and tougher (higher HD)". Read as: the default stands, and the
   table is no competing printing of the same leaders. Its leaders are a
   better-equipped, tougher grade, so where the two differ the difference is
   the table's point. The `table` option of Leader figures is that grade.
2. **Real items (2c).** Assumed: kits give weapon items, the optional
   equipment is real items, armour stays a stat cell. Owner: "Humanoids,
   including beastmen, should have an (optional, not used for basic entries,
   used for advanced beastmen rules) equipment inventory. A kit can ALSO
   include stat bumps or abilities". Read as: the inventory belongs to
   humanoid monsters as a kind, not to this family; it is opt-in, a basic
   entry stays stat-only as it imports today, and the advanced beastman rules
   turn it on; a kit carries items and may also carry stat changes and
   abilities. Not ruled: whether armour is an inventory item. The reading the
   design session draws is an armour item in the inventory with its armour
   class delivered by the kit's stat change, so nothing counts twice.
3. **Pictures (2f).** Assumed: the plate on the template, the heads on their
   traits. Owner: "Use the template picture for the template, use the
   specifics for each where available. Use the art splash (pg 56) for the
   warband generator". Read as: each breed and each trait shows its own
   picture where the section prints one, and the p. 56 plate is the warband
   generator's. Settled the same day in the phase 1 session, which asked
   "should the p. 56 plate be the template's picture, with each of the five
   heads placed on its trait?" and "should a repair in place keep replacing
   the template's picture only when that picture is one of the variants'
   portraits?". Owner: "3) no, see previous answer" and "4) yes, template
   should show a unique template image or none at all". Read as: the plate
   comes off the template; a template shows a picture that is its own or
   none, so no variant's portrait stands in on any family's template. Still a
   reading: that this family's own picture is the overview page's strip
   rather than none, and that "yes" to the second question sits beside
   answer 5's "always reset" for the library's copy (a hand-set picture there
   is written over).
4. **Starting now.** Assumed: the 2026-11-17 "start nothing new" cap is lifted
   by this request. Owner: "work pause lifted in full".
5. **A repair and a held picture.** Assumed: a repair replaces a family
   template's picture only where it is one of the variants' portraits. Owner:
   "Unclear, repairs always reset the compendium copies, may offer to fix
   existing entries if a simple fix, must offer keeping a copy/as is for
   modified actors". Read as three rules. A library (compendium) copy is
   always written to what the import makes, its picture included. An entry
   outside the library may be offered the fix where the fix is simple. A
   modified actor is always offered the choice to keep a copy or stay as it
   is. The first is applied to the family template's picture (Results); the
   rule as a whole is wider than this plan and is registered as T-0712.

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

**The change reaches every family whose overview is lore and reads art.**
Across the cookbooks' 47 families that is two, both in the MM: this one and
`mm.familyLycanthrope`, whose overview reads art on its own page with no
`artPage`. Repaired in place on lane B: its held picture (the overview's own,
written by an older build into the older art folder) was kept, the fresh pick
on that page is the same picture by size (496×565 against the first variant's
497×497), the cells and the five portraits were unchanged, and no warning or
error was recorded. Its axes hashed differently after the repair; the template
had not been repaired since an older build, the commit writes no axis, and
what moved was not diffed.

**Section 4's answer 5, applied to this picture the same day.** A repair in
place now writes the family's picture over whatever the library's copy holds;
a template held outside the library keeps the narrower rule (only a variant's
portrait gives way). Exercised live on lane B, with a peer on lane A: Repair
in place on the Lycanthrope family row moved the library copy's picture, which
was no variant's portrait, from the older art folder's file to the import's
own (496×565, loads), and the pack index row with it; axes, cells and the five
portraits hashed the same before and after, so a second repair moves no axis;
the Beastman template's picture was unchanged; no warning or error from the
click to the read. Not walked: a template held outside the library. The rest
of the answer (offering a fix to entries outside the library, offering a kept
copy for a modified actor, a library copy's name and listed edits) is T-0712
and is not built.

Found on the walk, for the design session: **the template's sheet draws no
picture.** The plate shows only as the compendium list's thumbnail, so "the
plate, with the heads on their traits" (section 4) needs a place on the sheet
before it is visible where a Judge works.

S0b: T-0709 is fixed-unreleased; T-0710 and T-0711 stay `new`, owned by S9c
and S10.

**Section 4's answer 3, built the same day: the plate comes off the template.**
The Beastman overview's register row no longer names the plate's page; it
widens the pick's ratio limit for that one row (`assists.artSelect`), so the
template takes the overview page's own strip. `importFamily` gives a template
its overview's picture or none, on every family; the first-variant fallback is
gone. A repair writes that over the library's copy, the type's default where a
family prints none, and leaves the held picture where the read failed. The
compile differs from the cookbook before S0 by one ratio figure on one entry.

Exercised live on lane B, peers seated on lane A: one Repair in place of three
family rows. Lycanthrope: picture, axes, cells and portraits unchanged. Bear
(no overview picture): the library copy's picture went from its first
variant's portrait to the type's default, the pack index row with it; cells
and portraits unchanged; axes hashed differently, as Lycanthrope's did on its
first repair in this build, and were not diffed. Beastman: the first pass kept
the plate's pixels, because an art file already uploaded under an entry's id
is reused and the earlier walk had put the plate there. That one file, this
session's own, was deleted from the art folder by its path, and a second
repair read the strip (1036×329, loads) with axes, cells and portraits
unchanged. The sidebar copy's picture was untouched throughout; no warning or
error was recorded in either pass. A world that never ran the unreleased S0
holds no such file.

Offline, on the final tree: `test-leader-roles` 40, `test-leader-template` 7,
`test-executor` 87, `test-cookbook-inputs` 92, `test-ax1-cookbook` 47.

Not checked: a fresh import of any family; a read that fails (the
held-picture guard is read from the code); a template held outside the
library; what the strip looks like as a list thumbnail.

Phase 1's start prompt above stands as written. S5 puts each head on its trait
and leaves the template's `img` alone.

### Design session, 2026-11-24

Five canvases, one per surface, drawn with the ACKS II design system and
private to the owner. Nothing is implemented. **No slice is released:** the
owner gave four rulings while the first canvas was open, and has not yet
answered the questions below or approved a canvas.

| Canvas | Surface | Slices |
|---|---|---|
| [1](https://claude.ai/artifact/UGfWMFuhLm7hcLGMC3YhXb) | Generate window, organisation chart, re-roll, pin, edit, deploy, role frames and upgrade badges (boards 1a to 1h) | S12 |
| [2](https://claude.ai/artifact/UaXrrRsaJwLm9GXEwBuLzY) | The three kit scopes, the random pick, what a kit suits, what a kit holds, the optional inventory (boards 2a to 2d) | S14 |
| [3](https://claude.ai/artifact/Vohd3xxedZW72JZrCJNoRL) | The recipe editor | S4b |
| [4](https://claude.ai/artifact/Bb3mZgyZmYNoPCKpEcXp4v) | An item raised or thrown, its cards, a body in reach | S8, S9a |
| [5](https://claude.ai/artifact/PxYv6twWXeHwarsiXU8Vkh) | The template sheet: its picture, the variants' portraits, the trait heads | S5's place on the sheet |

Every figure on them is a placeholder (`n`, `NdN`, `nn%`), every option a
neutral id (R1 to R7, T1 to T10, E1 to E9, V1 to V7), every picture a labelled
empty box. One tooltip of each provenance shape is drawn open on each canvas.

**The owner's rulings, given while canvas 1 was open.**

1. "The UI should split between generate random and design via selection".
   Read as: one Generate window with two tabs. Example: *Roll at random* rolls
   every slot of a village; *Design by selection* has the Judge choose the
   village row, each warband and each gang's troop type and size, and a die
   beside a slot rolls that slot alone.
2. "The end result should be the same and allow editing between. It should
   look like and org chart with a tree grouping and expanding into leader
   cards with their gangs. collapse and expand options including all at
   once." Read as: both tabs fill one organisation chart, which stays when
   the tab changes; a chieftain's card opens into sub-chieftains' cards, each
   into its champions' cards holding their gangs. Example: a gang rolled on
   the first tab is opened on its card, given another troop type and pinned;
   *Expand all* opens every warband to its champions.
3. "So reroll gang within a warband, also expand to full village including
   noncombatants, sub-beastmen, prisoners, pets. This might have become a
   faction card that lets you deploy gangs as group actors (that can deploy
   to individual during tactical)". Read as two rulings and one thought. A
   gang's own die rolls that gang and leaves its warband as it is. The chart
   carries the whole village: a camp branch of dependants, lesser kin,
   captives and beasts beside the warbands (stand-in labels). The thought,
   which the owner worded as "might": the village is a card that is never on
   a map, a gang leaves it as a group actor, and that group's bodies leave it
   as tokens by the group's existing Deploy. Example: Gang 1 is sent out,
   shows on the village's card as out, cannot be re-rolled from there, and
   comes back by Recall with its fallen still counted (board 1g).
4. "There's only one head available per breed so will need to use
   borders/icons for role/upgrades". Read as: every card, row and tile of a
   breed shows that breed's one head; the role is a frame around it and an
   upgrade (troop type, trait, kit or optional equipment) is a badge on one
   of its corners. Example: a champion of Variant 1 with R3, T5 and Kit B
   shows Variant 1's head in the champion's frame with three badges (board
   1h). The badge glyphs on the canvas are stand-ins: the build takes each
   from the import where a page prints one, or from Foundry core's icon set
   by path, and draws none (`.claude/rules/ip-doctrine.md`, "Art").

**Ruling 4 reaches S5, in phase 1.** S5's row has "trait art", and Results
above ends "S5 puts each head on its trait". The owner's words give a head to
a breed. Canvas 5 asked whose heads the strip prints (question 3 there), and
the owner answered the same day: "They are tribes, neither", then "Can reuse
for roles" and at once "Wait no you can't". Read as: the strip's five heads
are tribes' heads; none is cut onto a trait, a variant or a role, and the
strip stays whole as the template's picture, as `78f3c109` built it. Example:
a trait's tile on the template sheet carries the trait's badge and no head,
and a champion and a chieftain of one breed show the same portrait in
different frames. **S5 therefore puts no head on a trait**, which takes
"trait art" off its row; the rest of S5 stands and is not held.

**Section 4's answers, drawn in the owner's words.** Answer 1: the leader
choice on boards 1a, 1b and 3a is a grade, the variant's own leaders or the
table's, and no count of differing figures. Answer 2: board 2d draws a kit's
three kinds of content (items, stat changes, abilities) and a humanoid
monster's inventory as off on a basic entry until turned on. Answer 3: the
p. 56 plate heads the Generate window. Answer 5: no canvas draws a repair or
a re-import prompt.

What these change above. Section 2b's `tree` gains the camp's kinds as nodes
and a re-roll scoped to one node. S12's "unit tree" is the chart. The thought
in ruling 3 does not fit 2b as written, where every unit's bodies sum into the
stacks of one group actor: it needs a holder for the chart and a way for a
gang to leave it. `acks-extras.faction` is an actor sub-type that already
keeps members, a counted strength, a leader and a seat
(`docs/factions/MODEL.md`). Which holder it is goes to the owner (question 1)
and then to `architect`, before S12 is briefed.

Carried without a ruling: the Kits window on canvas 2 is drawn with the same
two tabs, at random and by selection. Canvas 5 draws section 4's answer 3 as
ruled: the template's own strip or an empty box on the template, a portrait
on each variant's tile, a head on each trait's tile, and the p. 56 plate at
the head of the Generate window on canvas 1.

**Open questions.** The first option of each is the one drawn.

Canvas 1 (S12):

1. What holds a generated village? (a) One group actor holds every stack, as
   2b has it, and a gang sent out becomes a second group. (b) A faction actor
   holds the chart and a gang becomes a group only when sent out. (c) One
   group actor, and no gang leaves it as a group. Boards 1c and 1g are drawn
   so that (a) or (b) fits.
2. On the Design tab, a slot left blank at Build: (a) that unit is left out
   until filled, (b) it is rolled.
3. A troop type or trait the variant's bands do not give: (a) a Judge may
   choose it and the card is marked, (b) it is refused.
4. Re-roll while bodies are out of the village or on a map: (a) only the
   cards that are out are refused, (b) the whole roll is refused.
5. A gang recalled with losses: (a) the fallen stay counted against its card,
   (b) the card is whole again.
6. When the chart is written: (a) it is staged in the Generate window and
   written by a Save, as board 1f draws, (b) Generate writes the stacks at
   once and every later change to a card edits them live. The standing ruling
   of 2026-11-01 is (b)'s first half, "the roll writes stacks at once"; (a)
   is drawn because a chart that two tabs edit needs a moment at which it is
   done, and it would qualify that ruling.
7. A token on the map: (a) its ring carries the role and the upgrades are on
   its hover line, (b) the ring and the badges both.

Canvas 2 (S14):

1. A kit drawn at random: (a) one kit for the whole stack, (b) one for each
   body, which splits the stack.
2. Where a Judge sets what a kit suits: (a) a window of its own, opened from
   a button on core's bundle sheet, (b) a fieldset inside core's sheet.
3. A kit that does not suit the stack: (a) a Judge may give it and the row is
   marked, (b) it is refused.
4. The Kits window: (a) two tabs, at random and by selection, as Generate has
   them, (b) one list with a Roll button.
5. Armour, which answer 2 leaves open: (a) an armour item listed in the
   inventory, its armour class delivered by the kit's stat change so nothing
   counts twice, (b) an armour item that itself sets the armour class, (c) no
   armour item, a stat change only.
6. What turns a monster's inventory on: (a) a switch on its sheet, thrown for
   it when a kit or a piece of optional equipment is first given, (b) one
   world setting for every humanoid monster.

Canvas 3 (S4b):

1. Where the editor opens from: (a) the monster's Ecology tab, the family
   template's variant row and the Generate window, (b) one of them.
2. A "Try a roll" preview that writes nothing: (a) in, (b) out.
3. A leader's grade, the variant's own or the table's: (a) set for each
   leader part in the recipe, with the Generate window's choice setting it
   for a roll, (b) set once in the Generate window only.

Canvas 4 (S8, S9a):

1. A bearer still inside a stack: (a) the item cannot be raised until that
   body is deployed, (b) raising it deploys the body.
2. What a player sees of a reach they stand in: (a) the Judge's choice for
   each item, (b) always the ring and the source's name, (c) never.
3. A player's save against a raised item: (a) a whispered card with their own
   Roll, which the Judge can roll for an absent player, (b) the Judge rolls
   all of them.

Canvas 5 (the template sheet):

1. The strip, once its heads sit on the trait tiles: (a) still shown whole at
   the head of the sheet, (b) shown only as the heads.
2. Variants and traits are picked: (a) from picture tiles, (b) from selects
   with a thumbnail beside each.
3. Answered: the strip's five heads are tribes', neither the breeds' nor the
   traits' (the owner's words are under ruling 4 above).
4. A tribe's head, beyond the template's strip: (a) shown nowhere else, (b)
   shown on that tribe's kit alternatives (coverage rows 8-9), once S13 mints
   them.

Not checked: how any canvas renders (the canvas type's own rule is to verify
only when asked); which five of the ten traits carry a head, and the camp's
four labels, which are stand-ins until S5 and the village rows are imported;
the overview strip's page number, drawn as a placeholder.

For whoever builds from a canvas: only board 1f draws the organisation chart;
1c and 1d show it as the indented outline a window narrower than about 900
gets, and were relabelled after ruling 2, not redrawn. A blank field's
`aria-label` on the canvases reads "Not imported" before its page; the live
field carries the page reference alone (`.claude/rules/ui-tooltips.md`).

Released: none. Each of S12, S14, S4b, S8 with S9a, and S5's place on the
sheet waits for the owner's answers on its canvas; S12 also waits for
`architect` on question 1.

**Phase 3 holds on canvas 1's question 1.** S10 (the group schema, the
labelled stack, `fixedHp`) and S11 (`encounter-recipe.mjs`,
`organisation-logic.mjs`) are built before S12 and on 2b's shape, one group
actor holding every unit's stacks. Ruling 3's thought questions that shape, so
neither is briefed until the holder is settled. Phase 1 (S1 to S5) and phase 2
build no group and no generation record, and their prompts stand.
