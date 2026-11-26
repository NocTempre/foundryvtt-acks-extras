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
| 3 | Head strip: five captioned heads. The owner: "They are tribes, neither" a breed's nor a trait's; this row first read the captions as traits, wrongly | Y since `78f3c109`, whole, as the template's picture | template `img` | INFO | the template's picture is the strip |
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
reader until S12. No head is cut from the strip onto a trait, a variant or a role: the heads
are tribes' (Results, "Ruling 4 reaches S5"). A crop of the plate is E4's image. Portraits stay on their
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
| S4b | 3b | topic | implementer | **Released** on the go-ahead on canvases 2 to 5. The recipe editor (the Judge tool), built from canvas 3; marker `monsters/beastman-recipe` | yes | S4 |
| S6a | 2 | topic/beastman-gear | implementer | Roll gates and `labelOf` | no | S5 |
| S6b | 2 | gear | implementer | Against-surprise part, `acMath` waiver, per-die stage, delayed damage | no | S5 |
| S7 | 2 | gear | architect: crosses lib, magic and equipment | Ruling on the range reader and the item carrier | — | S6a |
| S8 | 2 | gear | implementer | E3, E4, E9, T10. Marker `lib/aura-bearer`. Split by S7 into S8a (no UI) and S8b. **S8b released without T10** on the go-ahead on canvases 2 to 5, built from canvas 4; T10 waits for `architect` (S7's addendum A5) | yes, S8b | S7; S8b needs S8a |
| S9a | 2 | gear | implementer | **Released** on the same go-ahead. E2, built from canvas 4 | yes | S8a |
| S9b | 2 | gear | implementer | E5, E8. Split by S7 into S9b-1 (no UI) and S9b-2. **S9b-2 released** on the same go-ahead, built from canvas 4, board 4d | yes, S9b-2 | S6b, S6c; S9b-2 needs S8a |
| S9c | 2 | gear | implementer | E1, E6, E7 (E7 applies the figures read today) | no | S6b |
| S10a | 3 | topic | implementer | **Landed `97075983`..`2201349b` with S10b and S10c, walked** ("Phase 3", Results). Lib groups: a group inside a group (`unit.parentGroupUuid`, its cycle guard, one walker); a group's count read live with its nested groups, an emptied group counting none (T-0732, T-0733); deploy, recall and placing walk nested groups; `stack.gen = {part, cite}` with the count's tooltip and a note in place of the per-monster Roll; a whispered warning when a stack with no base actor is sent to the map; the labelled stack, the service contract, and `fixedHp` for a stack whose part prints hit points. A unit's leader is the shipped `unit.officerUuid`, and no field is added for it. Accepted when the unit suites cover nesting, the guard and the counts, and a live walk shows an outer token deploying and recalling every nested body and an emptied group reading no bodies on its place and its faction | no | — |
| S10b | 3 | topic | implementer | **Landed `97075983`..`2201349b`, walked.** The chart: `unitField` and `units` on factions and on groups, `org-tree-logic.mjs`, `orgHostOf`, the two view models, `org.mjs` (send out, recall, join, leave, add), the morale reader that walks ancestors' officers, the affiliation readers, `docs/lib/ORGANISATION.md`. Accepted when the tree and write-plan suites pass and a walk through the API adds a row on each kind of host, joins and leaves, sends out and recalls, and shows a chieftain's morale part reaching a gang and gone when the chieftain falls | no | S10a |
| S10c | 3 | topic | implementer | **Landed `97075983`..`2201349b`, walked.** Henchmen's `serviceNodes(employer)`. Accepted when its nodes for an employer with henchmen and a hired unit match the cards the Followers tab shows | no | S10b |
| S10d | 3 | topic | implementer | **Landed `d829908f`..`e96833b1` with S11 and S11b, walked.** A group's bodies joining a combat are grouped by the system's own tracker call; a gang already in that combat is absorbed; the lib DECISIONS entry. Nothing is written beside the system's feature. Accepted on a live walk: a warband's token puts every body in, each gang rolls once, and a gang already in the fight is one of its groups. The walk's first observation is whether a group rolls again each round | no | S10a, S10b |
| S11 | 3 | topic | implementer | **Landed `d829908f`..`e96833b1`, walked through S11b.** `encounter-recipe.mjs` and `organisation-logic.mjs`; the Roll (one level, or all below), Add and Edit plans in `lib/org-write-logic.mjs`; the Roll takes lib's shipped `context` and `state`, and nothing is named a lair; section 4, answer 6. Offline, mutation-checked | no | S5, S10a to S10c |
| S11b | 3 | topic | implementer | **Landed `d829908f`..`e96833b1`, walked.** The provider, shared prototypes, library stacks for other creatures, leaders made as actors and named as officers, the Judges' card for each Roll (board 1e), Delete, the pot hand-off. Walked through the API. Marker `monsters/beastman-village` | yes, its card | S11 |
| S11c | 3 | topic | implementer | **Landed `a7eabfbb`..`bd069195`, walked.** Join, leave and make-its-own gestures (board 1m) | yes | S11b |
| S12 | 3b | topic | implementer, then a live walk | **Released.** The tree and the Locations rows on the faction sheet and the root group's sheet; Roll, Add and Edit; nested rows; the p. 56 plate read by a register row of its own, as the generator's picture. Marker `lib/beastman-warband` | yes | S11b |
| S12b | 3b | topic | implementer, then a live walk | **Released.** The Followers tab's views over `serviceNodes` (board 1l) | yes | S10c, S12 |
| S13 | 4 | topic | implementer | Kit bundles minted; Kit option `ref` | no | S5 |
| S14 | 4 | topic | implementer, then a live walk | **Released** on the go-ahead on canvases 2 to 5. Three scopes, random kit, what a kit suits, built from canvas 2. Marker `monsters/beastman-kits` | yes | S13, S12 |

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
6. **References to other creatures.** Not asked; the owner, after phase 1's
   first walk stage: "Make sure to include the outside references such as to
   ogres and wargs." Read as: wherever the section names a creature that is
   not a beastman (a village's guard beasts, a chieftain's guard, a mount, the
   beasts a trait adds), the capture holds a reference to that creature's own
   library entry, and a generated warband or village includes it as that
   creature, with its own figures and picture. Example: a village whose page
   gives it guard beasts generates a stack built from that beast's own entry,
   not a stack that carries only the beast's printed word. Where it stands:
   S4 writes such a part with `source.name`, the word as the page prints it,
   and leaves `source.uuid` empty, so no part yet points at an entry. A
   printed word is matched to an entry at import, by folding both, so no
   creature's name is written in source; a word that matches no entry is a
   finding to list, and the labelled stack is what is left for it alone.

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

Phase 1's start prompt above stands as written. S5 leaves the template's `img`
alone. This paragraph first said S5 puts each head on its trait; the owner's
later answer ("Ruling 4 reaches S5", below) takes that away.

### Design session, 2026-11-24

Five canvases, one per surface, drawn with the ACKS II design system and
private to the owner. Nothing is implemented. **No slice is released:** the
owner gave four rulings while the first canvas was open, and has not yet
answered the questions below or approved a canvas.

| Canvas | Surface | Slices |
|---|---|---|
| [1](https://claude.ai/artifact/UGfWMFuhLm7hcLGMC3YhXb) | Generate window, organisation chart, re-roll, pin, edit, deploy, role frames and upgrade badges, affiliation and place, a stack that is another creature, views and tools, the overlap with followers, a roll with no faction card, roll then edit or add with no re-roll (boards 1a to 1n) | S12 |
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

**Open questions.** The first option of each is the one drawn. The lists
for canvases 2 to 5 are replaced by "Canvases 2 to 5 audited", below.

Canvas 1 (S12):

1. What holds a generated village? (a) One group actor holds every stack, as
   2b has it, and a gang sent out becomes a second group. (b) A faction actor
   holds the chart and a gang becomes a group only when sent out. (c) One
   group actor, and no gang leaves it as a group. Boards 1c and 1g are drawn
   so that (a) or (b) fits. **Answered: (b)**, in the owner's words at the
   foot of this entry.
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

**Canvas 1's question 1, answered the same day.** Asked "What holds a
generated village: a faction card, or one group actor?", the owner: "Faction
card". Read as option (b): a generated village is an `acks-extras.faction`
actor that holds the organisation chart and every body not sent out; a gang,
a warband or a camp card becomes a group actor when it is sent out, and that
group's bodies become tokens by the group's existing Deploy. Example:
Generate on the family template makes one faction and no group; sending Gang
1 out makes the first group, and the faction's card shows Gang 1 as out
(boards 1f and 1g). Board 1c, one group holding every stack, is not the
design and is kept only for the chart's narrow layout.

What the answer changes, and what it leaves to `architect` before any phase 3
slice is briefed:

- Section 2b is superseded in part. The roll's record and its tree sit on the
  faction; a group's stacks are written when a card is sent out, for that
  card alone. "A stack stays one row" (2026-10-31) holds inside a group.
- Not settled by the two words: whether a roll smaller than a village (a
  wandering warband, a lair) is also a faction or goes straight to a group;
  where the faction keeps bodies that are counted and unnamed (`strength`,
  `members`, or a field of its own); which of S10's group fields (`fixedHp`,
  the labelled stack, `stack.gen`) a sent-out card carries; how a re-roll and
  a Recall with losses are booked; and what "the roll writes stacks at once"
  (2026-11-01) means when a roll writes none until a card is sent out, which
  is question 6.
- The rows of S10, S11 and S12 in section 3 are written for one group actor
  and are rewritten on that ruling.

Released by this answer: none. It settles the holder; phase 3 stays held for
`architect`, and S12 for the rest of canvas 1's questions.

**The ladder, in the owner's words, the same day:** "(Faction > Army > not
yet mentioned extension) Village > Warband > Gang > Individual". Read as: four
rungs are this plan's, a village holding warbands, a warband holding gangs, a
gang holding individuals; the three in brackets sit above a village and are
not this plan's to build, the third being an extension the owner has not yet
described. Example: Gang 3 of Warband 1 is sent out of its village as a
group, and one of its bodies is then deployed as a token. Still a reading:
that a village is itself a card of the faction kind whose parent may later be
an army or a faction (`acks-extras.faction` already keeps a `parentUuid`),
and not a rung beneath a separate faction that must exist first; and that a
warband sent out whole is one group holding its gangs' stacks, not a card
that holds groups.

### Architect's ruling on the holder, 2026-11-24

`architect` read this plan, `FactionData`, `GroupData`, the group, encounter
and lair code, lib's README and the "In force" rows, and edited nothing. This
is its ruling, **proposed and not yet the owner's**; the design session did
not check its code citations. Section 3's rows are unchanged until the owner
answers the questions at its foot.

**A. The faction sub-type as it stands, schema untouched.** The roll's record
and the tree of cards live in one flag on the faction,
`flags["acks-extras"].organisation`: the roll's key, template, variant,
state, context, rules, source, choices and log, and a `tree` of cards (`kind`
village, lair, warband, gang or camp; parent, role, troop, trait, `pinned`,
`out`, and the card's own `stacks`). A pure reader cleans it and it is
written whole, as `lib/place-things.mjs` does its flag. One writer, the
monsters provider; factions reads it through the contract. Bodies counted and
unnamed are lib stack objects on each card, not `strength` (a second home for
one count, which the 2026-09-30 factions ruling rejects) and not `members`
(actor uuids). The village sets `seatUuid` to its lair's place and leaves
`leaderUuid` and `parentUuid` blank. This qualifies `FactionData`'s "every
value is what the Judge typed": rolled content stays in the generator's flag,
never in a faction field. Against it, moderate: rolled villages fill the
faction directory and every faction scan.

**B. Every organised roll is a faction**, a warband or a lair included, its
root card of that kind; a plain monster stays on the group's Roll. A group
cannot hold a tree, and ruling 3 asks for a gang re-rolled inside its
warband. Against it, moderate: a wandering band is met to be fought now.

**C. Sending a card out.** The group is written first and holds the stacks of
the card and of every card under it; then one faction write marks those cards
out, drops their stacks and adds a hidden roster row; a failed faction write
deletes the group. Each stack carries `gen` (faction, roll key, node),
`fixedHp` where a leader's hit points are printed, and a label where the
library has no creature. A warband sent out whole is one group with a stack
for each gang and prototype, not summed. S10 must also stop a `gen` stack
offering the per-monster Roll, and make the stack match compare `gen.node`,
or a drag between groups merges two gangs.

**D. Recall and re-roll.** A stack returns to the card its `gen.node` names,
so a gang dragged into another group still finds its card; the fallen stay on
the card. A card whose group was deleted by hand reads as lost and can be
rolled again. A card that is out is not re-rolled or edited; in its parent's
re-roll it stands as pinned, as does a card with losses or individual
records. A card at home with fallen warns the Judge and proceeds. The variant
changes only while no card is out.

**E. "The roll writes stacks at once"** holds if Generate writes the faction
and its cards' stacks at once and every edit is live. A Save that stages the
chart, as board 1f draws, would qualify the 2026-11-01 ruling and needs the
owner's word. "An encounter is a group" (lib DECISIONS, the same entry) is
superseded in part by "Faction card"; the slice that builds the provider
writes that entry.

**F. The upper rungs.** `parentUuid` is enough, with its loop guard and its
picker on the faction sheet. The village is itself the faction, not a rung
under one that must exist first. Against it, weak: an army may gather
warbands from several villages, which a parent link does not express.

**G. Section 3, proposed.**

| Slice | Agent | Delivers; acceptance | `/design` | Needs |
|---|---|---|---|---|
| S10 | implementer (lib only) | `stack.gen`; `fixedHp`; the labelled stack; a plain-data stack builder; a generate that creates no actor; Roll and count origin treat a `gen` stack as its card's; the stack match compares `gen.node`; leader morale. Offline: a fixed body keeps its figure, two gangs stay two rows through a move, the morale part goes when the leader falls. Dependency half | no | — |
| S11 | implementer | `encounter-recipe.mjs`, `organisation-logic.mjs`, and a pure `organisation-record.mjs` for A's record and D's verdicts, mutation-checked. A gang re-roll leaves every other card identical | no | S5, S10 |
| S11b (new) | implementer | The generator provider and its API row; send out and return; `rollLair` for lairs counted in units; the Judges' card; the pot hand-off; the DECISIONS entry; a pointer in factions MODEL. Walked live through the API: generate, send out, a casualty, return. Marker `monsters/beastman-village` | no | S11 |
| S12 | implementer, then a live walk | The Generate window, the faction sheet's entry to it, the lair row on the location sheet, the plate | yes | S11b, the owner's answers |

**For the owner.** `architect`'s pick is first. Three repeat canvas 1's
questions, with its pick against the one drawn where marked.

1. A warband or lair roll: (a) a faction with the same chart, (b) a group,
   and only a village is a faction.
2. A parent re-rolled while one of its cards is out (canvas 1, question 4):
   (a) the card that is out stands as pinned, (b) the re-roll is refused.
3. A gang recalled with losses (canvas 1, question 5): (a) its fallen stay on
   the card, (b) the card is whole again.
4. When the chart is written (canvas 1, question 6, where the Save is drawn):
   (a) Generate writes at once and edits are live, (b) staged until a Save.
5. A card dragged onto the map: (a) sent out and deployed whole in one
   gesture, (b) sending out and deploying stay two steps.
6. A gang that is out: (a) also listed on the faction's Members tab, (b)
   shown on the chart only.

Not checked by `architect`: how the faction sheet handles a dropped group,
validate's flag-scope check, the canvases, whether the template-resolved
listeners work without creating an actor, the group sheet, and anything live.

### The owner on the two cards, 2026-11-24

Given after `architect`'s proposal was shown, in two messages: "Faction card
is affiliation, group card is who's where." and "Both are nestable".

Read as: the faction card is the organisation chart, who belongs to which
village, warband and gang, and holds no bodies. Every body is in a group from
the moment it is rolled, and a group says where those bodies are. A faction
card may sit under another, and a group may hold groups. Example: Generate
makes the village's faction card and a home group at the village's place; the
faction card's Gang 3 names the group that holds Gang 3's bodies, and sending
Warband 1 out moves its group, with its gangs' groups inside it, out of the
home group.

What this changes in `architect`'s proposal above, which was written before
these words:

- **A** kept each card's bodies as stacks on the faction card. They are in
  groups. The generator's flag holds the chart, and each card names its group.
- **C** made a group when a card was sent out. The bodies are already in a
  group; sending out moves or splits a group, and Recall puts it back.
- **A warband sent out whole** is a group holding its gangs' groups. The
  design session's reading under the ladder, "one group holding its gangs'
  stacks, not a card that holds groups", is withdrawn.
- **E** loses its tension: a roll writes its groups' stacks at once, so the
  2026-11-01 ruling stands unqualified on this reading, and board 1f's Save
  is then the odd one out (question 4 above is still the owner's).
- **F** has nesting on both sides. A faction's parent link exists. A group
  cannot hold a group today; the next entry has what was read.
- **G**'s rows are not valid as written; S10 gains whatever group nesting
  needs.

Still the owner's, the reading's pick first. Question 1 is no longer put in
this form; see "A faction at several places" below.

1. Where a village's bodies are at Generate: (a) a home group at the
   village's place that holds a group for each warband, each holding a group
   for each gang, and one for the camp; (b) a home group with a stack row for
   each gang, and nested groups made only when a card is sent out.
2. A wandering warband or a lair roll: (a) its groups and a faction card of
   its own, (b) its groups only, joined to a faction when the Judge names
   one. This replaces `architect`'s question 1.

`architect`'s questions 2, 3, 5 and 6 stand. Its rulings A, C, F and G are
re-ruled on these words, by a fresh agent, once questions 1 and 2 here are
answered; the two shapes of question 1 are different schemas. Released: none.

### The two cards share references, 2026-11-24

Given next, on the same subject: "And containers that share references". With
the two statements before it, one sentence: the faction card and the group
card are both nestable, and both are containers that share references.

Read as: neither card owns what it lists. Each holds references, and one
thing may be referenced from both, by the faction card for what it belongs to
and by a group card for where it is. Sending out and Recall change the second
reference and leave the first alone. Example: Gang 3 is one thing; the
village's faction card lists it under Warband 1 and the home group lists it
as present, and sending it out takes it off the home group's list and nothing
off the faction card's.

What can be referenced today, read in source for this entry. These are facts
for the re-rule's brief, not options for the owner:

- A faction's `members` and a place's `roster` are the same row,
  `occupantField` (`scripts/lib/fields.mjs`): a uuid with a name, an image, a
  kind and a quantity. Its kinds include a group and a place
  (`OCCUPANT_KIND`, `scripts/lib/place-logic.mjs`), and a group row counts
  its whole stack. Two containers that reference one group actor exist
  already: a faction and a place.
- A place holds places by the same row (`docs/lib/PLACES.md`, "Occupancy").
- A group holds `stacks` and no other list (`scripts/lib/data/group-data.mjs`).
  A stack is an embedded row with a `key`; it is no document and has no uuid.
  No field of a group holds a group. A group names where it is in
  `unit.locationUuid`.

So the words do not answer question 1 above; they change what it turns on. A
gang that both cards reference is a group actor of its own, which every
reference row above can name today, or a stack inside a larger group, which
needs a reference nothing has yet (a group and a stack key). Question 1,
restated, the reading's pick first:

1. What a gang is, for both cards to reference: (a) a group actor of its own
   from Generate, so a village is one group actor for each card that holds
   bodies; (b) a stack row in the village's home group, referenced by group
   and stack key, and a group actor only once it is sent out.

What each costs. (a) makes many actors for one village, and a warband's group
then lists its gangs' groups, which no group field does today. (b) puts two
gangs of identical bodies in one group as two rows, which "a stack stays one
row" (2026-10-31), held above to apply inside a group, does not allow as
worded.

Question 2 stands. `architect` is not run again on these words alone; the
re-rule waits for question 1. Released: none.

### A faction at several places, a place with several factions, 2026-11-24

Given in answer to the restated question 1: "A faction can be at multiple
places, a place can contain multiple factions."

Read as: where is a place, and a place is not the faction's own. One
faction's things may be at several places at once, and one place lists the
things of several factions. Example: a village's Gang 1 is at a ford while
its Gang 2 is at the village's site, and that site also lists another
faction's patrol.

Which "at" the reading takes: where a faction's bodies are, since the subject
was who is where. The other "at", the places a faction holds, is already many
to many as built: a seat and `holdings` on the faction, and `factionsAt` and
`factionsHolding` answering with several factions for one place
(`docs/factions/MODEL.md`, "Where a faction stands"). Holding a place and
having bodies at it are two facts, and this reading leaves the first alone.

What it withdraws: "home group". The words were the design session's and
never the owner's, in the two entries above (the first's example, and both
forms of question 1) and on board 1g. A group names one place
(`unit.locationUuid`), so one group cannot be a village's bodies at two
places. Where those entries say it, read "the groups a place lists". Board
1g's strings name a place now.

For the re-rule, a consequence and not a ruling: option (b), a gang as a row
inside a larger group, needs a group for each place a faction has bodies at,
and a gang that changes place moves its row from one group to another, so a
reference to it by group and stack key does not survive the move.

Drawn as [board 1i](https://claude.ai/artifact/UGfWMFuhLm7hcLGMC3YhXb), the
four statements over one set of things, labelled on the board as a reading.
Affiliation is on the left and places on the right, with the same lettered
things in both. Gang 1 is away from its warband, another faction's group is
at the village's site, and a warband out whole is a group card that lists two
gangs' groups.

Question 1 was put twice as (a) or (b) and drew a statement of the model each
time, so it is not put a third time. The owner is asked whether board 1i is
the model, and the board marks the three points where it chose:

1. A gang is a group actor of its own (drawn), or a row inside a larger group
   for each place.
2. A warband and a gang are lines on the village's faction card (drawn), or
   faction cards of their own nested under it.
3. A warband out whole is a group card that lists groups (drawn). It is the
   one kind of thing on the board that no model has today.

Question 2 of "The owner on the two cards" stands. `architect` is not run.
Not checked: board 1i's rendering. Released: none.

### A stack that is another creature, 2026-11-24

The owner's instruction is section 4, answer 6, relayed by the planning
session; the words and their reading are there and are not restated.
[Board 1j](https://claude.ai/artifact/UGfWMFuhLm7hcLGMC3YhXb) draws what it
asks of the surfaces, with the owner's words on the note beside it: a stack
that is another creature, on the chart (1f's cards), on a group sheet and on
the Judges' card (1e), in three states.

- **Matched to an entry.** The creature's own portrait and name, its own
  figures with a tooltip that names its entry, and a control that opens the
  entry. 1f's Lesser kin and Beasts cards take this shape.
- **No entry matched.** The word the import read off the page, a dashed card,
  blank figures whose tooltip is the page reference alone, and "Link an
  entry…" for the Judge. Every such row is in this state until S4's
  `source.uuid` is filled at import.
- **A rider and its mount.** Two creatures and two counts on one row, the
  rider's head in its role frame beside the mount's own portrait.

Open on board 1j, the drawn shape first:

1. A reference with no entry: (a) says nothing in words, as a figure not
   imported stays blank (owner, 2026-11-14), (b) carries a worded warning on
   the row.
2. A stack with no entry linked: (a) is refused the map, and the row says
   why, (b) deploys as a bare token carrying the word alone.
3. A rider and its mount on a map: (a) one token for the pair, (b) one each.

"Link an entry…" is a Judge's tool the capture needs wherever a word matches
no entry; which slice builds it is not ruled. Not checked: board 1j's
rendering. Released: none.

### The owner on board 1i, 2026-11-24

Asked whether board 1i is the model, with boards 1h and 1i on screen: "It's
okay. I'd rather have tabs with horizontal spread and rows than columns of
vertical spread."

Read as two things. First, the model stands as board 1i drew it, its three
marked points included: a gang is a group actor of its own, a warband and a
gang are entries on the village's faction card and not faction cards of their
own, and a warband out whole is a group card that lists groups. The reading
is thin, two words over three points, and a correction to any of the three is
still the owner's to give. Second, a layout ruling that changes nothing in
the model: a surface that shows units or places is tabs, each tab a set of
rows with its things spread along the row, not side-by-side columns of
indented lists. Example: the village's faction sheet has a row for Warband 1
with Gang 1 and Gang 2 along it, and on another tab a row for each place with
the things there along it.

Board 1i is redrawn that way: the village's faction sheet on two tabs, and
the place's own roster with a row for each faction there. Its rows wrap at a
narrow width and nothing scrolls sideways. Drawn, and still open: the rows by
unit sit on the sheet's existing Members tab and Where is a new tab beside it
(`docs/factions/MODEL.md`, "The sheet", has five tabs today); the other shape
is one new tab for both.

What it puts in question, not redrawn: the indented outline that boards 1c
and 1d and the "Window behaviour" note give the chart in a narrow window is a
column of vertical spread. Whether the chart of 1f wraps as rows instead is
not drawn.

Question 1 of "The owner on the two cards" is answered on this reading, so
the re-rule of `architect`'s A, C, F and G runs now, on the owner's words,
by a fresh agent, and is recorded below as proposed. Question 2, a wandering
warband or lair roll and a faction card of its own, stays the owner's; the
re-rule covers both branches and picks neither. Not checked: the redrawn
board's rendering. Released: none; section 3's rows change on the owner's
word on the proposal.

### Tabs are views, Roll and Design are tools, 2026-11-24

With board 1f on screen: "The Roll at Random and Design by selection are
tools for the tab. The tabs are different ways to view the data (org chart,
locations, etc"

Read as: there is one window, the village's sheet, and its tabs are views of
one set of data. Roll at random and Design by selection are not tabs; they
are tools on a tab. This corrects the design session's reading of "The UI
should split between generate random and design via selection", which boards
1a and 1b drew as the two tabs of a Generate window. Example: on the Org
chart tab a Judge presses Roll at random and the chart fills, then opens
Design by selection and changes one gang's troops; the Locations tab shows
the same village by place.

Drawn as [board 1k](https://claude.ai/artifact/UGfWMFuhLm7hcLGMC3YhXb): the
Org chart tab with its two tools at rest, with each tool open (the panels are
what 1a and 1b hold; those boards are retitled and not redrawn), and the
Locations tab. Board 1i's tabs take the owner's names. The owner named tools
for one tab; Send out and Recall as the Locations tab's tools is the design
session's reading.

Open on board 1k, the drawn shape first:

1. The Org chart tab's layout: (a) rows, each warband a row with its gangs
   along it (board 1i, after "tabs with horizontal spread and rows"), (b) a
   tree, each warband a column with its gangs beneath (board 1f).
2. Generate on a family template: (a) makes the village's sheet and opens it
   on the Org chart tab with nothing rolled, and no Generate window exists,
   (b) a window first, as 1a drew.
3. What else "etc" holds beside Org chart and Locations. Drawn: nothing.

Not checked: board 1k's rendering. Released: none.

### The owner on followers, 2026-11-24

"PS this should overlap with followers. Follow project rules to merge the
code instead of parallel"

Read as: a leader with the bodies under it, shown as cards, sent out and
recalled, is what the followers surface already is, and the Beastman
organisation is built on the same code, extended where it falls short, and
not as a second implementation beside it. The project rule is CLAUDE.md's
"reuse → extend → enhance → invent", with shared logic in `scripts/lib/`.
Example: the card the chart draws for a champion is the lib's follower card
in its compact face, the one an employer's Followers tab already shows for
each follower, with the role frame of board 1h around its portrait; it is not
a new card component.

Read in source for this entry, and no further: `docs/lib/FOLLOWER-CARD.md`
gives one template with two faces, the follower's own sheet and a read-only
compact card that an employer's sheet shows for each follower, and names a
Roster app in the henchmen feature. A group has `unit.employerUuid` and a
`follower` category (`scripts/lib/data/group-data.mjs`). What followers
stores for who follows whom, and whether it has a tree or a place, was not
read.

What it changes. The cards and rows of boards 1f, 1g, 1h, 1i and 1k are the
design session's own shapes and were drawn without looking at the follower
card; they are not reconciled with it yet, and are redrawn on it once the
ruling below says what is shared. The words went to the `architect` that was
already re-ruling the holder, verbatim, with the question of which parts are
reused as they are, which extend a shared lib piece, which are new, and what
moves into `scripts/lib/` so there is one implementation. Released: none.

### Architect's re-ruling on the owner's words, 2026-11-24

**Proposed, not ruled.** A fresh `architect`, read-only, briefed with the
owner's statements verbatim, re-ruled the earlier A to G. It reported before
the owner's words on followers and on tabs as views reached it; what it adds
on those is the next entry. Nothing here is the owner's until the owner says
so. Replaced, wherever the two differ, by "Architect, consolidated" below.

Its restatement of the owner's words, with its example: a faction card
records who belongs to what and a group card records where bodies are; each
nests inside its own kind; neither owns what it lists and one thing can be
listed by both; one faction's things can stand at several places and one
place can hold several factions' things; board 1i's three points stand.
Gang 1 is a group, listed on the village's card under Warband 1; sent to a
ford, it moves from the site's roster to the ford's, and the card does not
change.

**A. The chart is a factions field; the roll's record is a monsters flag.**
`FactionData.units`, rows of `{key, parentKey, label, holderUuid, notes,
hidden}`, where `holderUuid` is the group or the single actor that holds the
entry's bodies. Factions owns the field and its writers. The roll's state is
`flags["acks-extras"].generation` on the faction, keyed by unit key and
written whole, with monsters its one writer. Every affiliation reader takes
`members` plus the holders through one getter: `hasMember`, `headcount`,
`factionRecord`, `readableLeaderUuid` and the influence listener's
concealed-member call, which passes raw `members` today. `leaderUuid` names
the chieftain's group, since a stack has no uuid. Rejected: `members` alone
(its row has no key or parent and is also the place roster's row), the chart
in a monsters flag (the faction sheet's Judge tool would be a second writer),
a member row for each holder (one fact in two places). Cost: one schema field
with no migration, and five readers. Not checked: whether the standing
listener follows a deployed body's token back to its group.

**B. Where things are: a place's stored `roster` is the source of truth.**
It lists the outermost things present, and a nested group is wherever its
outermost container is. `rollLair` records a group this way already.
`unit.locationUuid` is not reused: its one writer is `hire-group.mjs`, where
it means the hiring settlement, and its one reader keys wages by that
settlement's market, so "where now" in it would rekey a mercenary's wages
when the group moves. Readers: `placeOf(holder)` and `thingsAt(place)`. A
roster row naming a nested group is stale and ignored; a root on two rosters
shows at both and is flagged.

**C. A warband out whole needs one new field.** No existing container
serves: a location's token is a marker that deploy, combat and formation
skip; a group flagged as a place provider would put every gang in the
storage manager, the coin scan and the site's contents; a faction's `members`
is belonging; a formation is the party's record. New:
`GroupData.unit.parentGroupUuid`, loop-guarded as `wouldCycleFaction` is.
One guarded walker serves every reader. Nested bodies count for formation
cells, vehicles, capacity, a place's headcount, the full caption, the lair
state, group combat and formation deployment; a faction's headcount, the
sheet's totals and mercenary wages count a group's own bodies only. Counts
are read live, never from a row's `quantity`.

**D. The writes.** Each touches two documents, target first, as `moveStack`
does. Sending a gang out adds the target's row, then clears the pointer.
Sending a warband out adds the target's row, then removes the source's.
Recall sets the pointer, then removes the row. A re-roll of one gang is
refused before any die where a body is deployed, the gang is pinned, or it is
away; otherwise it replaces that gang's own generated stacks in one write and
writes the faction's flag last. A re-roll of all leaves held, away and pinned
entries standing, and deletes unnamed actors last, by the record's own list,
so a half-finished run leaves extra actors and never missing ones.
Casualties stay recorded in their own group and never move. A leader's
morale parts are found through `units`, whether or not the leader's group is
at the same place.

**E. The standing Roll rulings.** "A stack stays one row" is about one row
for a stack and not one for a body; the clause about summing every unit's
bodies into one stack is this plan's section 2b and appears in no ruling,
and is moot once gangs are separate groups. Generate stamps one key on every
stack and group it makes, and a re-roll replaces only stacks with its key.
World actors for one village, as it reckons: one faction, a group for each
warband, a group for each gang, two more (the camp, the chieftain's unit),
and the shared prototypes, plus one base for each other-creature stack on
its first deploy.

**F. A stack that is another creature.** Matched: `template.uuid` holds the
library entry until the first deploy mints a world base; the link survives
as the snapshot's cookbook id. Not matched: a null uuid, an empty snapshot,
and the imported word as the label; `ensureBaseActor` already returns
nothing without a snapshot type, so the map already refuses it (board 1j,
question 2a), and the row has to say why. "Link an entry…" is the existing
drop onto a stack row (`setStackPrototype`); mending the recipe's
`source.uuid` is S4b's.

**G. A wandering warband or a lair roll, both branches, no pick.** (a) A
faction card of its own: A's schema, joined to a village by `parentUuid`;
one more faction in every scan. (b) Groups only: one root group for the roll
holds the others and carries the record as a flag; joining a faction writes
`units`, then clears the flag. It leaves one record with two possible
carriers, and a roll with several warbands at its top gets a root group
close to the withdrawn "home group". It adds slice S11c.

**The earlier A to G.** A falls, its flag surviving as the record's home. B
becomes G here. C falls. D's verdicts stand and its mechanism falls. E and F
stand.

**If a point of board 1i is reversed.** A gang as a row in a larger group:
holders become a group and a stack key, and C's field is not needed.
Warbands and gangs as faction cards: `units` goes. A warband out as one
group of its gangs' stacks: no pointer, and the gangs lose their identity on
the way out.

**Phases.** Phase 1 is untouched. Phase 2: "the same group" in coverage row
47 and section 2d item 6 now has three possible meanings (a gang's own
group, its container, its faction's subtree); S7 takes this ruling as input
and S8 needs S10b. Phase 4: S14 says whether a kit dropped on a group
reaches its nested groups.

**Section 3, proposed.** All on `topic/beastman-organisation`, all
`implementer`, since the design is ruled here. These rows are replaced by
the table in the next entry, written once the owner's words on followers
reached `architect`; they stay here as what it proposed without them.

| Slice | Delivers | `/design` | Needs |
|---|---|---|---|
| S10a | lib only: `unit.parentGroupUuid`, its guard and writer; the walker and the nested counts of C; `stack.gen`; a labelled stack refused the map with a reason; no per-monster Roll on a generated stack. No visible surface | no | none |
| S10b | factions and lib place readers: `FactionData.units`, the affiliation getter and its five readers; `placeOf`, `thingsAt`; live counts. No visible surface | no | none |
| S11 | the recipe, the organisation logic and the record (its normalizer, D's refusals, the ordered write plans), mutation-checked | no | S5, S10a, S10b |
| S11b | the provider runs S11's plans; shared prototypes; library stacks for other creatures; the Judges' card; DECISIONS entries. Walked through the API | no | S11, and the owner's questions 1 and 2 |
| S11c | branch (b) only: a root group's record joins a faction's `units` | yes, if the join is a new gesture | S11b |
| S12 | the surface: the village's sheet with its views and tools, nested-group rows on the group sheet, place roster rows by faction, Delete, the plate | yes: boards 1i and 1k and canvas 1's answers first | S11b |

S12's row names the views by the owner's later words (Org chart, Locations);
`architect` wrote "unit rows on Members and a Where tab" from board 1i as it
then stood.

**For the owner**, `architect`'s pick first:

1. A warband's group: (a) made at Generate, holding its gangs at home, (b)
   made only when it is sent out whole. Board 1i draws (b).
2. A wandering warband or a lair roll: (a) its groups and a faction card of
   its own, (b) its groups only, joined to a faction when the Judge names
   one. No pick.
3. A warband's token joining a combat: (a) every body under it, as the
   2026-11-03 whole-group ruling has it, (b) its gangs as group tokens.
4. Canvas 1's question 4: (a) an entry that is away stands as pinned, (b)
   the re-roll is refused.
5. Canvas 1's question 6: (a) Generate writes at once, (b) staged until a
   Save.

**To register on the bug ledger**, shipped defects it found on the way and
did not touch: a stored roster row's `quantity` is never refreshed, so a
place's headcount goes stale after casualties; `place.mjs`'s
`groupHeadcount` reads an emptied group as one.

Not checked by `architect`: anything live, and how validate treats the new
flag and fields. Released: none.

### Architect on followers and on tabs as views, 2026-11-24

**Proposed, not ruled.** The same `architect`, given the owner's two later
statements verbatim, revised its report. Rulings B to F and the questions
above stand as written. Replaced, wherever the two differ, by "Architect,
consolidated" below. What it changed and added:

**A, changed.** A unit row is a lib field, `unitField()` in
`scripts/lib/fields.mjs` beside `occupantField`: `{key, parentKey, label,
holderUuid, notes, hidden}`. `FactionData.units` is a list of them, and in
branch (b) of G the root group's record stores its tree as the same rows.

**H. Followers.** Its restatement of the owner's words, with its example:
each shared piece is built once, in lib, so that a lord's company and a
village use the same code; a unit sent to garrison a keep and a gang sent to
a ford are the same write. Read by it in `docs/lib/FOLLOWER-CARD.md`,
`docs/henchmen/MODEL.md`, `character-sheet/tabs/followers.mjs`,
`henchmen/engine/events.mjs` and core's `actor.mjs`. Part by part:

- **The tree: the same shape, a different fact.** Followers store who serves
  whom as child pointers: core's `retainer.managerid` with `henchmenList`,
  the module's `record.employerUuid`, and a unit's `unit.employerUuid` and
  `unit.officerUuid`. A generated monster never gets an employer pointer,
  since payday, the henchman limit and the Roster would all pick it up, and
  `units` does not replace the service tree, half of which is core's.
  Extend lib: `lib/org-tree-logic.mjs` reduces both trees to one node shape,
  `{key, parentKey, label, holderUuid}`. Factions supplies nodes from
  `units`; henchmen supplies them through `serviceNodes(employer)`.
- **A leader with the bodies under it: extend lib's command block.**
  `unit.officerStackKey` beside `officerUuid`, so `commandMorale` counts a
  leader stack's part while that stack has a living body. A gang needs no
  reader of its own for it; parts from leaders above a gang stay S11b's.
- **Where things are: new, and lib's.** Followers record no place today, and
  B's readers serve both.
- **Send out and Recall.** Putting bodies on a map and taking them off:
  lib's group code as it is. The moves between places in D: new, in
  `lib/org.mjs`, on `addOccupant` and `removeOccupant`.
- **Cards.** A leader that is its own actor: a monster already opens on the
  Follower Card, reused as it is. A leader still inside a stack:
  `followerCardContext` extended to draw the base actor with that body's
  record. A unit: the group sheet's stack row, reused.
- **The org chart and locations views: new.** The Followers tab is three
  flat buckets of cards, and units linked by `unit.employerUuid` are not on
  it. Both views are built once, in lib, over nodes.
- **Generation: extend lib.** `GROUP_CATEGORY.follower` has no writer and the
  followers roll makes no actors. The plan that turns nodes into groups,
  stacks, pointers and roster rows goes in lib, where a followers roll can
  use it once its tables are imported.

Docs: a new `docs/lib/ORGANISATION.md` owns the node shape, the walks, the
views and send-out; `docs/lib/GROUPS.md` owns nesting and the officer stack;
factions' MODEL owns `units`, henchmen's the adapter, monsters' the recipe
and the generation flag.

**I. Tabs are views.** One stored shape: `units`, the generation flag, the
groups and the rosters. Each tab is a view of it, by unit and by place, and
Roll at random and Design by selection are tools on a view that both write
that shape. The generating surface is the faction sheet's view by unit.

**Section 3, proposed, replacing the table above.** S10a to S10c are built
on the topic branch and landed on `main` together, walked through the API,
before S11 starts, so followers work can build on `main`. It rejected a lib
topic of its own: S11 needs the pieces at once and a second branch is a
second lane over the same files. All take `implementer`.

| Slice | Delivers | `/design` | Needs |
|---|---|---|---|
| S10a | lib only: `unit.parentGroupUuid`, its guard and walker; the nested counts of C; combat and formation deploy walk descendants; `unit.officerStackKey` in `commandMorale`; `stack.gen`; a labelled stack refused the map with a reason; no per-monster Roll on a generated stack | no | none |
| S10b | lib and factions: `unitField`, `org-tree-logic.mjs`, the two view models, `placeOf`, `thingsAt`, `lib/org.mjs` send-out and recall; `FactionData.units` and the five readers; `docs/lib/ORGANISATION.md` | no | S10a |
| S10c | henchmen's adapter: `serviceNodes(employer)` over core's pointers and the module's | no | S10b |
| S11 | monsters' recipe and organisation logic; `lib/org-write-logic.mjs` with the plans that make and re-roll; the generation flag's normalizer. Mutation-checked | no | S5, S10a to S10c |
| S11b | the provider; shared prototypes; library stacks for other creatures; leader parts read through `units`; the Judges' card; DECISIONS entries. Walked through the API | no | S11, and the owner's questions 1 and 2 |
| S11c | branch (b) only: a root group's record joins a faction | if it adds a gesture | S11b |
| S12 | the faction sheet's views by unit and by place with both tools; nested rows on the group sheet; a place's roster rows by faction; leader cards drawn by the Follower Card; Delete; the plate | yes: boards 1i and 1k and canvas 1's answers first | S11b |
| S12b | the character sheet's Followers tab hosts both views over `serviceNodes`, the employer's units listed | yes | S10c, S12 |

**One more for the owner**, `architect`'s pick first:

6. The Followers tab gets the two views in this plan: (a) yes, as S12b, (b)
   later.

Not checked by `architect`: anything live, how validate treats the new
fields, and whether the influence listener resolves a deployed body's group.
Released: none.

**Drawn from H, as a proposal:**
[board 1l](https://claude.ai/artifact/UGfWMFuhLm7hcLGMC3YhXb), with the
owner's words on followers beside it. The Follower Card's compact face as
`docs/lib/FOLLOWER-CARD.md` describes it, on a lord's Followers tab and on a
village's chart; a unit as the group sheet's stack row; the two views on a
character's Followers tab over who serves whom; and which parts are one thing
and which stay two. Open on the board, the drawn shape first:

1. The Followers tab gets the two views with this work (question 6 above).
2. Today's flat cards on the Followers tab: (a) stay as a third view, (b)
   the Org chart takes their place.
3. On a chart the card: (a) keeps Show, loses Dismiss and gains a foot with
   roll again, edit and send out, (b) is drawn some other way.

The cards of boards 1f and 1h are still the design session's own and are not
redrawn on the Follower Card. Not checked: board 1l's rendering.

### The owner on the Followers tab, 2026-11-24

Asked "Does the Followers tab get the two views as part of this work?", with
the buttons "Yes, with this work" and "Later", the owner chose:

"Yes, with this work"

The words are the button's, written by the design session; the choice is the
owner's. It answers `architect`'s question 6 with (a) and closes point 1 of
board 1l. S12b is part of this plan and is not left for later work. Example:
a lord's sheet, on its Followers tab, shows its henchmen and units by who
serves whom and by place, in the views the village's faction sheet shows.

Read as, and no wider: the scope of S12b is ruled, its shape is not. The
answer leans on H, since S12b is drawn over views built once in lib, and the
owner was not asked about H's parts one by one. Still open and S12b's to wait
for: points 2 and 3 of board 1l, and whether the Org chart tab is rows (1i)
or a tree (1f), which decides both sheets at once.

Section 3's table above stays proposed. S12b's row is the one row this answer
covers, and it keeps its needs: S10c, S12 and an approved design. Released:
none. Board 1l's first callout and the note beside it carry the answer.

### The owner on the Org chart tab's layout, 2026-11-24

Asked "Is the Org chart tab drawn as rows (board 1i) or as a tree (board
1f)?", with the buttons "Rows, as 1i" and "Tree, as 1f", the owner chose:

"Tree, as 1f"

The words are the button's; the choice is the owner's, and it went against
the design session's lean to rows. The Org chart tab is board 1f's tree: a
leader's card at the head, the cards under it spread beside one another
beneath, each opening and closing. Example: on the village's sheet the
chieftain's card heads the tab, the warbands' cards stand in a line under it,
and each warband's gangs hang under their own warband.

Read as, and marked as a reading:

- The Followers tab's Org chart is the same tree, since H draws both sheets
  from one view. Board 1l's tab is redrawn as one. H is still proposed.
- The Locations tab keeps board 1i's rows. The owner's "I'd rather have tabs
  with horizontal spread and rows than columns of vertical spread" was said
  of 1i's first drawing and is taken to stand there, not against the tree.
  The owner was not asked to square the two.
- Board 1i's Org chart rows are not the tab. Its model, its Locations rows
  and its place roster stay.

This closes point 1 of board 1k and the open point of board 1i, and settles
the earlier words "It should look like and org chart with a tree grouping and
expanding into leader cards with their gangs" as the tab's layout. Still open
for S12 and S12b: what the tree does in a window narrower than itself (it
scrolls sideways in its own box, or it falls to the outline of boards 1c and
1d); points 2 to 4 of board 1k; points 2 and 3 of board 1l; board 1j's three
points; canvas 1's questions 4 and 6. Board 1f's window frame is still the
first drawing's Generate window, and its cards and 1h's are not redrawn on
the Follower Card. Released: none. Not checked: any board's rendering.

### The owner on a warband's group, 2026-11-24

Asked "Is a warband's group made at Generate, or only when the warband is
sent out whole?", with the buttons "At Generate" and "When sent out", the
owner chose:

"At Generate"

The words are the button's; the choice is the owner's. It answers
`architect`'s question 1 with (a), its own pick: every warband has a group
actor from Generate, and that group holds no bodies and lists its gangs'
groups. ("Holds no bodies" was the design session's reading and not the
owner's words; "Architect, consolidated" below corrects it: the group holds
the warband's own leader.) Example: Generate makes Warband 1's group at the village's site with
Gang 1's and Gang 2's groups inside it. Gang 1 sent alone to a ford leaves
Warband 1's group and stands on the ford's roster, and the Org chart still
lists it under Warband 1. Warband 2 sent whole is one move of one group, its
gangs inside it.

What follows, as a reading: a group that lists groups exists from the first
roll and not only on a send-out, so C's `unit.parentGroupUuid` is written by
Generate (C is still proposed), and E's count of a village's actors, which
already has a group for each warband, stands. Board 1i drew (b) and is
changed: its Locations tab and Place A's roster show Warband 1's group at
home.

Not asked, and open on board 1i: a warband's group whose gangs were all sent
out alone lists nothing. It stays on its place's row empty, or it leaves the
row until a gang is recalled. The second listed defect above
(`groupHeadcount` reads an emptied group as one) would count such a group as
a body.

S11b needed the owner's questions 1 and 2; 1 is answered and 2, a wandering
warband or a lair roll, is not. Released: none. Not checked: board 1i's
rendering.

### The owner on a roll with no village, 2026-11-24

Asked "Does a wandering warband or a lair roll get a faction card of its
own?", with the buttons "Yes, its own card" and "Groups only", the owner
chose the second, against the design session's lean, and then wrote:

"Groups only"

"Or more specifically, not by default nor required"

The first is the button's words and the owner's choice; the second is the
owner's own. It answers `architect`'s question 2 with (b), and says more than
(b) did: such a roll makes groups and no faction card, nothing it does
afterwards needs one, and a faction card for it is neither made unasked nor
ruled out. Example: a Judge rolls a wandering warband and gets the warband's
group with its gangs' groups inside it and no faction. It is re-rolled,
edited, sent to a place and fought from those groups alone. Later the Judge
may put it under a faction, and never has to.

Read as, and marked as a reading:

- "Not required" binds the build: the Org chart view, both tools, re-roll,
  pin, send out, recall and a leader's morale parts all work on a roll that
  has no faction. In `architect`'s G(b) the roll's record rides on the root
  group as a flag, and D reads a leader's parts "through `units`", which such
  a roll does not have. That reader needs a second source, the root group's
  record. `architect` has not been asked.
- "Not by default" leaves the Judge two optional gestures: join the roll to
  a faction that exists, or make it a faction card of its own. G(b) has the
  first only. Whether the second is wanted was not asked.
- With "At Generate", a wandering warband's root is the warband's own group.
  A roll with several warbands at its top (a lair roll, as G has it) has no
  such group. What its root is stays open, and G warns that a root group made
  for it is close to the withdrawn "home group".
- The Org chart view gets a third host, the root group's sheet, beside the
  faction's sheet and a character's Followers tab.

Section 3, as a consequence and still proposed: S11c applies. Its row reads
"branch (b) only: a root group's record joins a faction", with `/design` "if
it adds a gesture"; it does, and S12 grows by the root group's sheet as a
host. Both of S11b's owner questions are answered. Released: none, since
`architect`'s shape and section 3's table are proposed and the owner has not
been asked to adopt them.

**Drawn:**
[board 1m](https://claude.ai/artifact/UGfWMFuhLm7hcLGMC3YhXb), a wandering
warband on its root group's sheet with the tree and the tools, the two
optional faction gestures, and the same group once joined. Open on the
board, the drawn shape first:

1. On a group's sheet the tree is: (a) a section above the stack rows, (b) a
   tab of its own.
2. A roll with several warbands at its top: (a) each warband's group is a
   root with its own record, and the roll is that many records, (b) one root
   group is made for the roll and lists them.
3. The optional faction gestures: (a) both, join one that exists and make
   one of its own, (b) join only.
4. Once joined, the tree and its tools: (a) show on both sheets, the
   group's and the faction's, (b) leave the group's sheet for the faction's.

Not checked: board 1m's rendering.

**The owner, once more, after the entry above was written:**

"The specification is the faction card is optional for groups, but it's not a
strict only, rather an only group needed"

This is the owner's wording of the rule and replaces the button's "Groups
only" as its name: a group is all such a roll needs, and a faction card for
it is optional. Example: the same wandering warband runs from its group
alone, and a Judge who wants it on a faction card may put it there. It
confirms the first two readings above ("not required" binds the build; a
faction card stays available as the Judge's choice) and settles nothing on
board 1m's four points: point 3 still asks which optional gestures there
are.

Not widened, and marked as a reading: "optional for groups" is taken to
speak of the rolls the question named, a wandering warband and a lair roll.
A generated village keeps its faction card, as the owner ruled it ("Faction
card"). Whether a village's card is optional too was not asked.

Then asked: "Does a generated village always get its faction card, or is the
card optional there too?", with the buttons "Village always has one" and
"Optional there too", the owner chose:

"Village always has one"

The reading above stands as the owner's choice. A generated village is always
a faction card with its chart on it; only a roll with no village runs from a
group alone. Example: Generate for a village makes the faction card, the
warbands' groups and the gangs' groups in one go, and the tree shows on the
faction's sheet; no group of the village's carries its chart. Released: none.

### The owner on a warband's token in a combat, 2026-11-24

Asked "When a warband's token joins a combat, does it bring every body under
it, or its gangs as group tokens?", with the buttons "Every body" and "Gangs
as tokens", the owner chose:

"Every body"

The words are the button's; the choice is the owner's. It answers
`architect`'s question 3 with (a), its own pick, which it tied to the
2026-11-03 whole-group ruling. Example: a warband's group stands on a map as
one token with two gangs inside it. Added to a combat, it puts every body of
both gangs and the warband's leader into that combat; neither gang appears
there as a group token of its own.

It keeps C's walk as proposed: group combat and formation deployment count a
group's nested bodies. Not asked: how the bodies of a gang are told apart
from another gang's once they stand in the same combat. Released: none.

The owner then answered what was not asked:

"BUT! gangs should automatically join combat as groups for group initiative"

Read as: every body still comes in, and the bodies come in gang by gang, each
gang one group for initiative, with no gesture from the Judge to make it so.
Example: the warband's token joins a combat; Gang 1's bodies stand on the map
and act on one initiative, Gang 2's on another, and the warband's leader on
its own. The 2026-11-03 ruling ("A group token in a combat deploys the whole
group") says nothing of initiative, so this adds to it and reverses none of
it.

Two shapes fit the words, and the owner was not asked which:

- (a) every body is a row in the tracker, and a gang's rows share one
  initiative;
- (b) a gang is one row in the tracker for all its bodies, which stand on the
  map without rows of their own.

Not checked by the design session: what core 14 and the `acks` system offer
for a shared initiative, and what lib's combat patches (`turn-order.mjs`,
`initiative-card.mjs`) do with one. That goes to `architect` with the rest.
Whether a gang that joins a combat on its own, with no warband, is one
initiative group the same way is taken as yes, as a reading.

**Where the owner's questions stand.** Of `architect`'s six: 1 (at
Generate), 2 (only a group is needed, a faction card optional), 3 (every
body, each gang one group for initiative) and 6 (the Followers tab, with this
work) are answered. Open: 4 (an
entry that is away, on a re-roll) and 5 (Generate writes at once or is
staged). The Org chart tab is the tree. `architect` has seen none of these
answers; a fresh one is given them verbatim, and its result is the next
entry.

### The owner on "absorbed", not yet understood, 2026-11-24

Asked `architect`'s question 4 as "On a re-roll, does an entry that is away
stand as if pinned, or is the re-roll refused?", with the buttons "Stands as
pinned" and "Refuse the re-roll" and the gloss "a gang that is away (sent out
or deployed)", the owner chose neither and wrote:

"It gets absorbed if part of the combat"

The design session cannot tell which question this answers, and builds on
neither reading until the owner says:

- (a) It is about the combat, and adds to "Every body": a gang that is out
  as a group of its own, and is part of the combat its warband joins, is
  taken into the warband's side of that combat as one of its gangs, with its
  one initiative, and has no separate entry there. Example: Gang 1 stands on
  the map as its own token; the warband's token joins the same combat; Gang
  1's bodies come in with the rest and Gang 1 is one initiative group among
  the warband's.
- (b) It is about the re-roll: a gang whose bodies are deployed in a combat
  beside its warband is not away at all, and a re-roll treats it as part of
  the warband. What happens to a gang at another place is then still
  unanswered.

Question 4 stays open either way for a gang that is at another place and in
no combat. `architect`, already running, was not sent these words. Released:
none.

Then asked "Absorbed into what: its warband's side of the combat, or the
re-roll?", with the buttons "Into the combat" and "Into the re-roll", the
owner chose:

"Into the combat"

Reading (a) is the owner's, and with it the sentence is understood: a gang
out as a group of its own that is part of the combat its warband joins is
taken into the warband's side of that combat as one of its gangs, on its one
initiative, with no separate entry. It adds to "Every body" and to "gangs
should automatically join combat as groups for group initiative". Not asked:
what "part of the combat" is measured by (the gang's token already a
combatant, or standing on the combat's scene), and whether the gang's own
token is hidden as the warband's is. Both go to `architect`, which is sent
the two sentences verbatim. Question 4, the re-roll, is unanswered.

### The owner on re-roll: a setup-only tool, 2026-11-24

Asked question 4 again as "A gang is at another place and in no combat: does
a re-roll of its warband leave it, or get refused?", the owner chose neither
button and wrote:

"Reroll is only until the element is confirmed. It's a setup only tool."

The words are the owner's own. An element of the chart (a gang, a warband,
the village) is in setup until it is confirmed. Re-roll exists in setup and
nowhere else; a confirmed element is never re-rolled. Example: a Judge rolls
a village, rolls Gang 2 again twice, and confirms it. Gang 2's die is gone
from its card. Sent to a ford next week, it is as it was confirmed, and no
re-roll of its warband can reach it.

What it settles: question 4 as asked falls away. Both of its branches
described a re-roll meeting an entry that is away, and a re-roll no longer
reaches anything a Judge has confirmed. D's re-roll paragraph (refused where
a body is deployed, a gang is pinned or away; a re-roll of all leaving held,
away and pinned entries standing) is to be rewritten on it, and canvas 1's
question 4 with it.

Read as, and marked as a reading:

- Pinning is a setup tool too: a pin holds a choice through a re-roll, and
  means nothing once re-rolls are over.
- Hand edits stay after confirm, on the standing "every count stays
  editable". Whether Design by selection stays was not said.
- An element is confirmed before it is sent out, deployed or put in a
  combat. Without that, a re-roll could still meet an element that is away.
- The standing per-monster Roll rulings (2026-10-31, 2026-11-01) are not
  touched: the owner spoke of this generator's re-roll.

Not asked, the drawn shape first where board 1n draws one:

1. What is confirmed: (a) each card on its own, a card's confirm taking
   every card under it, with a Confirm all at the head, (b) the whole roll
   at once.
2. An unconfirmed element: (a) cannot be sent out, deployed or fight until
   confirmed, (b) is confirmed by the first of those.
3. Confirm: (a) is final, (b) can be undone while the element has not been
   sent out or fought.
4. After confirm, Design by selection: (a) goes with re-roll, hand edits
   remaining, (b) stays.
5. `architect`'s question 5 in its new form: (a) an unconfirmed element
   already exists as its actors, marked in setup, (b) it is staged and its
   actors are made on confirm.

`architect`, still running, is sent the owner's words verbatim with these.
**Drawn:**
[board 1n](https://claude.ai/artifact/UGfWMFuhLm7hcLGMC3YhXb), a card in
setup beside the same card confirmed, the Org chart tab's tools in setup and
after, and a tree partly confirmed. Released: none. Not checked: board 1n's
rendering.

Asked point 1 as "Is each card confirmed on its own, or the whole roll at
once?", with the buttons "Each card" and "Whole roll at once", the owner
chose neither and wrote:

"Either"

Read as: both gestures exist, and the Judge uses whichever suits. That is
what board 1n draws, so the drawing stands: a Confirm on each card, taking
the cards under it, and a Confirm all at the head. Example: a Judge confirms
Gang 4 alone while still rolling the rest of its warband, then confirms
everything left with one press. The other reading, that the owner has no
preference and leaves the pick to the build, ends at the same drawing. Point
1 is closed on board 1n; points 2 to 5 are open.

The owner then pointed at a pattern the module already has:

"Look at how languages can be left undecided until needed"

What was looked at: `docs/classes/MODEL.md`, "Languages", and
`docs/character-sheet/MODEL.md` on the Abilities tab. A character is granted
a count of tongues and may leave picks open. One carrier item holds the open
slots as `languageSlots = {capacity, filled, source}`; the sheet shows each
open slot as a *Choose: a language* row whose button runs the picker
(`scripts/abilities/language-slots.mjs`); a pick makes the `language`
document then and not before, and clearing a slot deletes the document the
slot bought. Nothing ever forces the picks to be made.

Read as, with one example: an element of the chart may stay undecided for as
long as the Judge likes, and is decided when it is needed and not before.
The chart knows the element is there, as the carrier knows a slot is there,
and shows it as a row that asks to be decided. Example: a village is rolled
with three warbands. The Judge decides Warband 1 and its gangs, since the
party is about to meet them, and leaves Warbands 2 and 3 as undecided cards
for weeks. The day Warband 2 is sent to a ford, it is decided then.

What this changes on board 1n, as a reading:

- Nothing asks for a Confirm all, and a chart with undecided cards is a
  finished state, not a half-done setup.
- Point 2 leans to its second branch: sending out, deploying or fighting is
  the need, and the element is decided at that moment.
- Point 5 leans to its second branch: an undecided element holds no group
  yet, as an open slot holds no language, and its group is made when it is
  decided.

Tensions the design session does not resolve, both sent to `architect`:

- "At Generate" has a warband's group made at Generate. Read together: a
  decided warband has its group at once and never waits for a send-out; an
  undecided one has none yet. The owner was not asked to square the two.
- How much may stay undecided: (a) a whole element, a gang or a warband,
  whose place on the chart is known and whose contents are not; (b) single
  slots inside a decided element, such as a gang's size with its troop type
  already chosen. The language pattern is (b) in kind, a known count with
  open picks; board 1n draws (a).

Not asked: when an undecided element is needed, (a) the Judge is asked to
roll or choose it there and then, (b) it is rolled for the Judge. Board 1n
gains an undecided card and the moment it is needed. Not checked: the
board's rendering. Released: none.

### The owner's correction: controls, not gates, 2026-11-24

Asked that last point as "When an undecided card is needed, is the Judge
asked to roll or choose it, or is it rolled for them?", the owner answered
neither and wrote:

"This is the same question again and again and again. Stop reinventing
wheel, owner can use the controls, don't hard code permissions unless
explictly asked"

This is a correction of the design session, and it binds the rest of this
plan. Three things, each with what it undoes here:

- **The Judge has the controls and uses them.** A surface offers Roll,
  Choose, Edit, Confirm, Send out and Recall, and the Judge presses what the
  moment needs. Example: Warband 3 is undecided and the Judge wants it at a
  ford. The Judge rolls it, or chooses it, and sends it out, in whatever
  order the controls allow. No dialog stands between the two presses to ask
  which.
- **No permission, refusal or ordering rule is built unless the owner asked
  for it in words.** The one such rule the owner has given on this surface is
  "Reroll is only until the element is confirmed": Confirm takes the die off
  a card. Everything the design session added around it is withdrawn: that a
  card must be confirmed before it is sent out or fights, the prompt drawn on
  board 1n for "the moment it is needed", whether Confirm can be undone as a
  rule, and whether Design by selection is taken away. The repo's standing
  rule is the same one ("players get blocks, judges get warnings",
  2026-11-14), and these are a Judge's tools.
- **Use what exists.** The owner had already pointed at the open language
  slot. An undecided card is that pattern: a row that offers the pick. The
  design session drew a new mechanism around it and asked about each part.

What it closes, without a further question to the owner:

- Board 1n's points 2 to 6 and the "not asked" point above. They were one
  question asked five ways: what the module should stop a Judge from doing.
  The answer to all of them is nothing.
- `architect`'s D, where it refuses: a re-roll of one gang "refused before
  any die where a body is deployed, the gang is pinned, or it is away", and
  S10a's "a labelled stack refused the map with a reason". Each is to be
  re-read against this correction; `architect` is sent the words.
- The layout points still open on boards 1j, 1k, 1l and 1m. They are taken
  as drawn. The owner corrects a drawing by saying so; none is put as a
  question again one at a time.

Still the owner's, and not a permission: adopting the data shape and the
slice table once `architect` has revised them. Released: none.

### The owner drops re-roll, 2026-11-24

After the correction above the owner wrote:

"Just drop the reroll entirely. You can roll some or all of the org chart up
to village and you can manually edit or add from there."

The words are the owner's own, and they replace the owner's earlier
"Reroll is only until the element is confirmed. It's a setup only tool" of
the same day: there is no re-roll at all, in setup or after. What is new
since that sentence is this one. Example: a Judge rolls a whole village, or
only Warband 1 and its gangs. Gang 2 came out wrong for the table, so the
Judge changes its troop type and its count by hand. A fourth warband is
wanted, so the Judge adds one, and rolls it or fills it in.

What it is, in three verbs:

- **Roll.** A part of the chart that has nothing in it yet can be rolled:
  one gang, one warband with what is under it, or everything up to the
  village. A part left unrolled is the open language slot's pattern and
  waits.
- **Edit.** A part that has been rolled or filled is changed by hand.
- **Add.** A warband, a gang or a body is added by hand, and can then be
  rolled or filled.

What goes with re-roll, since each existed only for it:

- The pin, which held a choice through a re-roll.
- Confirm, the setup state, and "Confirm all", which ended re-rolling. The
  owner's "Either" answered a question about Confirm and falls with it.
- Canvas 1's question 4 and `architect`'s question 4, in every form.
- In `architect`'s D, the whole re-roll paragraph, and whatever part of the
  generation record was kept only to replace a roll's stacks. What a card
  needs for its tooltip, the roll it came from, is a separate matter and
  stays `architect`'s to rule.

Read as, and marked as a reading: Roll at random is the roll, of some or of
all; Design by selection is the owner's "manually edit or add", done slot by
slot. Both names are the owner's from earlier and neither was withdrawn. A
filled part shows no die. Changing it is an edit, or a delete and an add.

On canvas 1: board 1n is redrawn as roll, edit and add, with no die on a
filled card, no pin and no Confirm. Boards 1f, 1j, 1k, 1l and 1m lose their
re-roll dice, pins and the wording about them, and 1f loses its Generate
window frame, its "Roll all again" and its "Save the village". Boards 1a to
1e and 1g were drawn before this and still show a re-roll or a pin in
places; they are not redrawn and are read without them. Not checked: any
board's rendering. Released: none.

### Architect, consolidated: the chart, the roll and the fight, 2026-11-24

**Proposed, not ruled.** A fresh `architect`, read-only, was briefed with
the owner's statements verbatim and sent each later one as it came, the drop
of re-roll last. Its report replaces the two earlier `architect` entries
wherever they differ, and what it does not restate stands. Nothing here is
the owner's until the owner says so. It cites symbols, not lines. Its
rulings 2, 3 and 4 and its adoption ask are replaced by "The owner's
corrections, and the audit" below; rulings 1, 5 and 6 stand as changed there.

Its restatement of the owner's words, each with its example:

- "only group needed": a roll that makes no village is made, edited, sent
  out and fought from its groups alone, and no tool needs a faction card. A
  wandering warband is Warband 1's group with its gangs' groups inside it,
  and its Org chart sits on that group's sheet.
- "Every body", "BUT! gangs should automatically join combat as groups for
  group initiative": every body under a warband's token enters, and each
  gang's bodies share one initiative with no gesture from the Judge. Gang
  1's rows take one roll, Gang 2's another, and a lone leader rolls alone.
- "It gets absorbed if part of the combat", "Into the combat": a gang away
  from its warband and already in the combat its warband joins fights there
  as one of that warband's gangs. Gang 1 is at a ford with its token in the
  fight; Warband 1's token joins, and Gang 1 stays in as one initiative
  group beside Gang 2.
- "Look at how languages can be left undecided until needed": an element
  may stay empty as long as the Judge likes, and a chart with empty elements
  is finished. Warband 3 is an empty row for weeks and is rolled the evening
  it matters.
- "owner can use the controls, don't hard code permissions unless explictly
  asked": the Judge has Roll, Edit, Add, Send out and Recall and presses
  them in any order. The module builds no refusal or ordering rule the owner
  did not ask for, and at most warns. An empty Warband 3 is sent to a ford
  and rolled there, or rolled and then sent, and no dialog asks which.
- "Just drop the reroll entirely…": an empty part is rolled, a filled part
  is edited by hand, a part is added by hand. Gang 2 came out wrong for the
  table, so the Judge changes its troop type and count by hand.

**1. One chart shape, on a faction or on a group (changes A).** Every chart
lives on a host actor. A village's host is its faction card; a roll with no
village is hosted by the group of the roll's top unit, and Generate makes the
host first. `unitField()` gains two keys: `kind`, the imported unit word an
empty row needs to know what a Roll makes, and `gen`, an object lib stores
and never reads. `FactionData.units` and a new `GroupData.units` are lists of
the same row.

- *What is left of the generation record.* Only what a later Roll of an
  empty row needs: the template and variant, state and context, which rules
  are on, the leader source, and the Judge's choices where the page is
  silent. It rides as `gen` on the row where a roll began, and a Roll of an
  empty row reads the nearest ancestor's. Gone: the roll key, pins, the
  state, the log (the Judges' card is the log) and any list of minted actors.
- *`stack.gen = {part, cite}` stays*, for the count's tooltip (formula,
  total, the part and its page) and to stop the per-monster Roll re-sizing a
  gang's stack from the wrong line: a `gen` stack shows the Roll's shipped
  note form instead.
- *One reader.* Lib `orgHostOf(holderUuid)` returns `{host, row}` from a
  lazy reverse index over actors with `units`. It reads affiliation and
  never location. A row whose holder no longer resolves reads empty, the
  language slot's rule.
- *Leader morale (changes D and H).* The leader's group gets
  `unit.officerStackKey`, the part's morale goes into the shipped
  `unit.officerMoraleBonus`, and one reader adds each ancestor holder's
  bonus while its officer stack has a living body. It works the same on
  either kind of host.
- *Join and leave.* Join writes the faction first (the root's rows appended
  under the chosen row, keys never re-keyed), then clears the group's own
  rows. Leave is the reverse and any subtree may leave. Between the two
  writes a row can stand on two hosts: the reader prefers the faction, the
  sheet marks the twin, and a second press completes the move. "Make a
  faction card of its own" is a create followed by the join. After a join
  the group's sheet draws its subtree from the faction's rows, with no copy.
- *A Roll writes at once.* Each press writes its groups, stacks and
  prototypes then; board 1f's Save goes. Against, moderate: a village
  rolled whole puts every prototype in the world at once, and rolling less
  is the remedy.
- Against the whole shape, moderate: every group, a mercenary unit
  included, carries an empty chart field. The alternative, a flag on the
  root group, gives the one reader two shapes.

**2. A lair is one host group, its warbands beside it (new).** The lair's
group holds the lair's own parts (its leader where the recipe gives one,
guards, captives) and carries the chart. Each warband's group stands beside
it on the lair's place roster and not inside it. It lists no warband, which
is what separates it from the withdrawn "home group". Cost: a group that
may hold no bodies. This departs from board 1m point 2 as drawn.

**3. A warband's group holds its own leader (corrects a reading).** It is
emptied only when its gangs are out and its own bodies are gone. An emptied
group stays on its place's roster and a recalled gang returns into it. The
count defect has three floors, each confirmed by `architect` and again by
the design session's grep: `place.mjs` `groupHeadcount`, `place-logic.mjs`
`headcount` and `factions/standing-logic.mjs` `headcountOf` each read an
emptied group as one. S10a reads a group's count live, nested groups
included, and stops using the stored roster figure. Registered on the bug
ledger as T-0732 (the three floors) and T-0733 (the stored figure).

**4. Combat (new mechanism).** Every body is a tracker row, and a gang's
rows form one of the system's own initiative groups; the other shape, one
row for a gang, is neither the system's model nor core's. Lib
`group-combat.mjs` `sendOut`, once the bodies' combatants exist, writes the
system's group list in one combat update: one entry for each group actor
with two or more bodies, its bonus the lowest member value as the system
computes it. `gather` prunes the same way. `turn-order.mjs` keeps one
group's members together on a tie.

- *Why not the system's own writer.* It does not await its write, and its
  bonus loop recomputes every entry from the tokens just passed in, so
  grouping Gang 2 would hand Gang 1 Gang 2's bonus. Both are confirmed in
  the system's source by `architect` and by the design session.
- *Why not core's CombatantGroup.* It would be a second grouping beside the
  system's.
- *Supersedes lib DECISIONS 2026-08-24 in part*: its rejection of
  auto-grouping a deployed stack (new evidence: the owner's words above),
  and its note that a module does not write the system's namespace (new
  evidence: the system's writer cannot group several gangs). Its main
  ruling, no grouping beside the system's, is followed.
- *Scope, `architect`'s own ruling.* Auto-grouping applies to every group
  actor whose token joins a combat, a gang joining alone and a hand-built
  group included. Against, **strong**, in its words: "the 2026-08-24
  rejection was the owner's own ruling. Going past "gangs" reverses it for
  groups the owner did not name, including a mercenary unit outside a
  formation, and the system offers no ungroup."
- *Absorption.* "Part of the combat" is Foundry membership, not standing on
  the scene. On the warband's join, each group under its row that is in
  that combat joins the one grouping write, and one present as a single
  token row is sent out. The gang's own token is hidden and restored by the
  shipped path. Against, moderate: the owner may picture a gang standing
  beside the warband pulled in with no press.
- Plausible and not confirmed: that a gang's initiative rolls again each
  round. It is S10d's first live acceptance.

**5. The tree on three hosts (stands).** One view model reads rows from a
`units` host, faction or group alike, or from henchmen's
`serviceNodes(employer)`. Still undrawn: the tree in a window narrower than
itself.

**6. Verbs, refusals, slices (replaces D's re-roll paragraph).** Roll fills
an empty row, at that level or with all below it. Add makes an empty row
under any row. Edit changes a filled row by hand; bodies already on the map
keep the figures they went out with until recalled, which is a warning and
not a refusal. Delete removes a row, its group, and any prototype no stack
still names.

| Refusal | Verdict | Basis |
|---|---|---|
| Every re-roll rule; variant only while no card is out | gone | no re-roll; no rule asked |
| A stack with no base actor sent to the map | a warning in place of today's silence | the code cannot place it |
| A second combat; a row with a body on the map moved between groups | kept | shipped, GROUPS.md |
| The per-monster Roll on a `gen` stack | a note in its place | it would be a re-roll |
| A parent-group cycle | kept | the walker could not end |
| Send out or Leave of an empty row | none: the press makes its group | |

| Slice | Delivers | Needs |
|---|---|---|
| S10a | Lib groups: `parentGroupUuid`, its cycle guard, one walker; live nested counts and the three floors; deploy, recall and placing walk descendants; `officerStackKey`; `stack.gen`; the note; the warning | none |
| S10b | `unitField`, `units` on factions and groups, `org-tree-logic.mjs`, `orgHostOf`, the view models, `org.mjs` send out, recall, join, leave, add; morale with ancestors; `docs/lib/ORGANISATION.md` | S10a |
| S10c | Henchmen's `serviceNodes(employer)` | S10b |
| S10d (new) | The combat-group write and prune, absorption, the tie key, the lib DECISIONS entry | S10a, S10b |
| S11 | The recipe evaluator; Roll, Add and Edit plans; mutation-checked | S5, S10a to S10c |
| S11b | The provider, shared prototypes, leader figures, the Judges' card, Delete; walked through the API | S11 |
| S11c | Join, leave and make-its-own gestures (board 1m) | S11b |
| S12 | The tree and Locations rows on both sheets; Roll, Add, Edit; nested rows; the plate | S11b |
| S12b | The Followers tab's views over `serviceNodes` (board 1l) | S10c, S12 |

All on `topic/beastman-organisation`, each to an `implementer`, live walks
by the phase session. S10a to S10c land together before S11.

**Read against the owner's words by the design session.** Four points, and
the design session's pick on each:

- `architect` shows Add only on a host with `gen` settings or one made from
  a family template. Roll needs a template; Add does not, and the owner's
  "manually edit or add" names no such condition. Pick: Add on every
  `units` host, Roll where a template is known.
- S11b's Judges' card is board 1e's, a chat card, and 1e was drawn before
  re-roll was dropped. That part of S11b waits on the canvas with S11c, S12
  and S12b. S10a's warning is posted in the shipped whisper form of "holds
  nothing to place", so it needs no drawing; board 1j's row text comes with
  S12.
- Board 1m point 2 drew each warband's group as a root with its own record.
  Ruling 2 above differs, and the board's callout now says so.
- Writing the system's flag from the module has a shipped precedent:
  `magic/cast-declare.mjs` sets the system's prepared-spell flag on a
  combatant. Not checked: whether validate's flag-scope check passes a
  `combat.update` spelling of the same write.

**What is the owner's.** One decision: adopt this shape. Adoption releases
S10a, S10b, S10c, S10d, S11, and S11b less its card. It also takes four
points as written unless the owner corrects one:

1. Group initiative for every group token, not only a generated gang (the
   strong counter-argument above).
2. Lib writes the system's combat-group list.
3. A warband's group holds its own leader.
4. A lair is one host group with its warbands beside it.

The go-ahead on canvas 1 as redrawn then releases S11c, S12, S12b and
S11b's card.

Not checked by `architect`, in its words or close to them: anything live;
whether every imported leader morale figure fits the bonus field's declared
range; the stale stored roster figure beyond its write at row creation;
whether core deletes a body's combatant with its token; an edited prototype
under a deployed body's delta; any board's rendering. Released: none.

### The owner's corrections, and the audit against the book, Foundry and the shipped code, 2026-11-24

Shown the four adoption points above, the owner wrote:

"1) Group initiative is a foundry feature
2) this doesn't make sense
3) no, RHIP
4) lair is a location that can be a gang or a warband depending on the rng
or selection

Seriously, most of these questions reveal a lack of investigating foundry
and RAW before designing"

then: "I'm getting annoyed at the incompleteness, I've come to expect
better. Not all of my criticisms were explictly aimed at the latest list"

then: "Don't overcomplicate. A lair is just an encounter flag for size and
loot when RNG generated"

The words are the owner's. The fault they name is the design session's: it
and its `architect`s designed first and read second, and put to the owner
what a page, Foundry or this repo's own shipped code already answered. This
entry is the reading, done over everything asked or proposed today and not
only the four points.

**Read:** MM pp. 47-57 (the six breed pages and the organisation pages); RR
ch. 6, "Round and Initiative"; Foundry core 14, build 370, the combat
documents and the tracker; the `acks` system's combat source at 14.2.0; lib
groups, lair and place code, factions, and henchmen's hire of a unit.

**1. A lair is the encounter's state, and it is shipped.**

- *The page.* Each breed's encounter lines (MM pp. 47-53) name a unit for
  each context and state: a gang, a warband or a village. The lair is the
  state. No line yields warbands with no village over them.
- *Shipped.* Lib reads `ecology.encounter[context][state]` as a unit and a
  count (`group-encounter-logic.mjs` `lineReading`).
  `rollEncounter(group, stackKey, {context, state})` takes the state or
  throws the lair chance for it, and `lair.mjs` `rollLair(place, {context})`
  rolls a place's lair.
- *So.* Nothing in the data is named a lair. The generator's Roll takes the
  shipped `context` and `state`. The state picks which unit is rolled and
  whether treasure is dealt (coverage rows 19, 21 and 22), and the chart
  then has that unit at its top like any other. Where a lair is rolled for
  a place, the place is the location and the unit stands on its roster.
- *Withdrawn:* `architect`'s ruling 2 (a lair's host group), board 1m's
  point 2 (a roll with several warbands at its top), and "a lair roll" as a
  kind of roll anywhere in this plan.

**2. A leader is the unit's officer, an actor of its own, and it is
shipped.**

- *The owner:* "no, RHIP". Read as, and marked as a reading: rank has its
  privileges, so a leader is no row of bodies inside its unit's group. It
  is an individual, with a card of its own at the head of its unit.
- *The page.* MM pp. 47-57 give each unit one leader with its own figures.
  By its rank a leader has its own chances to carry gear, a mount when its
  unit rides, and the role of its unit.
- *Shipped.* A group already names its commanding officer:
  `unit.officerUuid`, "a lone leveled actor, not a stack"
  (`lib/data/group-data.mjs`), with `officerMoraleBonus` and `officerLevel`
  cached beside it and written today by `henchmen/engine/hire-group.mjs`. A
  faction names its `leaderUuid`. The owner's "expanding into leader cards
  with their gangs" and board 1l's Follower Card said the same.
- *So.* A unit's leader is one actor, named by its unit group's
  `unit.officerUuid`; a village's chieftain is also the faction's
  `leaderUuid`. Example: Gang 1's champion is an actor with its own sheet
  and kit. Gang 1's group holds the warriors as a stack and names the
  champion as its officer. The chart's card shows the champion's head with
  the gang's count under it.
- *Withdrawn:* `unit.officerStackKey`, and `architect`'s ruling 3.
- *To re-read, not ruled here:* coverage rows 11 and 24 and section 2b speak
  of leader stacks, and `fixedHp` on a stack was needed only because a
  leader was a stack. Not checked: what else reads a group's officer.

**3. Group initiative is the system's feature, and the module calls it.**

- *The owner:* "Group initiative is a foundry feature", "this doesn't make
  sense".
- *The page.* RR ch. 6, "Round and Initiative", leaves rolling once for a
  group of like monsters to the Judge.
- *Foundry core 14.* A combat holds `CombatantGroup` documents, and a
  combatant in one takes its group's initiative
  (`Combatant#_prepareGroup`). Core's tracker draws nothing for a group, and
  the `acks` system does not use the document.
- *The `acks` system.* What a Judge has in the tracker: a control that
  groups the selected tokens (`combat.manageGroup(tokens)`), one roll for
  each group in `rollInitiative`, and a group mark beside each name. Lib
  already reads those groups (`patches/initiative-card.mjs`).
- *So.* The module builds no grouping and writes no list. When lib puts a
  group's bodies into a combat, it makes the call the tracker's control
  makes, for those bodies, and the Judge regroups with that same control.
  It is one path with no condition on which group, since a gang is a group
  and the feature draws no line between them (a reading).
- *The system's two defects* are the system's, for the core repair plan,
  and no reason to write beside it: T-0734 (a second group overwrites the
  first's bonus, confirmed by reading) and T-0735 (the write is not
  awaited; the dropped group is inferred).
- *Of lib DECISIONS 2026-08-24*, only the rejection of auto-grouping is
  superseded, on the owner's "gangs should automatically join combat as
  groups for group initiative". Its note on the system's namespace stands.
- *Withdrawn:* `architect`'s write of the system's list, its scope ruling,
  and the tie key in `turn-order.mjs`, which is built only if a live walk
  shows two groups on one total interleaving.

**4. Asked today, and already answered where the design session did not
look.**

| Put to the owner, or invented | Where the answer stood |
|---|---|
| Does a warband's token bring every body into a combat | lib DECISIONS 2026-11-03, "A group token in a combat deploys the whole group" |
| Confirm, a setup state, and what an unrolled part is | the open language slot (`docs/classes/MODEL.md`, "Languages"), which the owner pointed at |
| A lair's host; several warbands with no village | the breed pages' encounter lines, and lib's shipped `state` |
| Where a leader is held | `unit.officerUuid`, shipped |
| How gangs share initiative, and for which groups | the system's tracker control, and RR ch. 6 |

**What stands of "Architect, consolidated".** Ruling 1 (one chart shape on
a faction or on a root group, `kind`, `gen`, `orgHostOf`, join and leave, a
Roll writes at once), ruling 5, and ruling 6's verbs and refusals. The
slices change in three places:

- S10a: the leader is the shipped officer field, so `officerStackKey` goes.
- S10b: the morale reader walks ancestors' officers. The page gives the
  morale part to the chieftain alone, and the walk is what carries it to a
  gang.
- S10d: the call to the system's control when a group's bodies join, the
  absorbing of a gang already in that combat, and the lib DECISIONS entry.
  No list of the module's, and no tie key.

Canvas 1's board 1m point 2 now reads as answered. Still the owner's, and
no design question: the word that adopts the shape as corrected and
releases its slices. Not checked: anything live; any board's rendering.
Released: none.

### The owner adopts the shape as corrected, 2026-11-24

Asked "Adopt the data shape as corrected and release slices S10a to S11?",
with the one button "Adopt as corrected", the owner chose:

"Adopt as corrected"

The words are the button's; the choice is the owner's. Adopted: rulings 1,
5 and 6 of "Architect, consolidated" as changed by "The owner's corrections,
and the audit". Example: Gang 1 is a group whose officer is its champion, an
actor of its own. In a village its row sits on the faction card under
Warband 1. Rolled as a dungeon's lair, the same shape is a warband's group
with its gangs' groups inside it and no faction card, and nothing in it is
named a lair. Its token joins a combat, every body goes in, and each gang is
grouped by the system's own tracker call.

**Released: S10a, S10b, S10c, S10d and S11.** Section 3's rows S10 to S12
are rewritten as S10a to S12b with each slice's acceptance, and phase 3's
start prompt is no longer held.

Not released, and waiting on the owner's go-ahead on canvas 1 as redrawn:
S11b (its Judges' card is board 1e's, and it was not in the question), S11c,
S12 and S12b. Still waiting on their own canvases: S14 (canvas 2), S4b
(canvas 3), S8 and S9a (canvas 4).

Left as it was, for the phase 3 session to re-read against ruling 2 of the
corrections: coverage rows 11 and 24 and section 2b, which speak of leader
stacks. Not checked: anything live; any board's rendering.

Canvas 1 after the adoption: boards 1c, 1d, 1e and 1g lose the re-roll
buttons, the pins and two refusals drawn before the owner's "controls, not
gates" (a card that is out is edited on its own sheet, and bodies on a map
keep the figures they went out with until recalled, as a note). A search of
every board for a re-roll, a pin or a confirm finds none. The canvas is as
it would be built, and its go-ahead is what S11b, S11c, S12 and S12b wait
on.

### The owner's go-ahead on canvas 1, 2026-11-24

Asked "Go ahead on canvas 1 as redrawn, releasing S11b, S11c, S12 and
S12b?", with the one button "Go ahead", the owner chose:

"Go ahead"

The words are the button's; the choice is the owner's. It is the go-ahead
`.claude/rules/ui-layout.md` ("Design before build") asks for, on canvas 1
at Version 53. Example: S12 builds the Org chart tab as board 1f's tree,
with board 1n's card (Roll and a pen on an empty card, a pen on a filled
one) and no re-roll, pin or confirm anywhere.

**Released: S11b, S11c, S12 and S12b.** With the adoption above, every
slice of phase 3 but S4b is released.

The boards were drawn over one day and the later ones correct the earlier.
Where two differ, a builder takes:

- the tree and its tab from 1f, and the Locations rows from 1i;
- a card's controls from 1n;
- a leader's card from 1l, the Follower Card, where 1f and 1h still draw
  the design session's first card;
- a stack that is another creature from 1j, and a roll with no village
  from 1m;
- the Judges' card from 1e, the sheet at its width from 1c, and the narrow
  window from 1d.

What a board marks as the design session's own reading is approved as
drawn, and the owner corrects it by saying so. Not checked: any board's
rendering. Not drawn: the tree itself in a window narrower than it, which
scrolls in its part root (`ui-layout.md`).

### Canvases 2 to 5 audited against the book, Foundry and the shipped code, 2026-11-24 — approved the same day

The owner's corrections of the same day ("The owner's corrections, and the
audit", above) were made of canvas 1 and hold for every canvas. Each open
question that "Design session" lists for canvases 2 to 5 was read against
the printed pages, Foundry core 14, the `acks` system 14.2.0 and this
repo's shipped code before anything was asked. Each board is redrawn to the
answer found there, or, where none is, to the least restrictive pick. This
entry replaces those four question lists, S7's "Canvas 4 question 2 stays
the owner's" and S7's owner question on E5. It is proposed until the owner
gives a go-ahead on the four canvases; one ask covers them.

**Canvas 2 (S14)**, https://claude.ai/artifact/UaXrrRsaJwLm9GXEwBuLzY,
Version 7.

1. A random kit is drawn at the scope the Judge chose: the group, a stack
   or one body. No stack is split: a body's own kit is a record on its
   stack ("A stack stays one row", lib DECISIONS 2026-10-31, archived).
2. What a kit suits is a group on the system's bundle item sheet, added by
   the `renderApplicationV2` injection that
   `scripts/monsters/item-annotations.mjs` already makes into an item
   sheet's Details tab. No window of its own.
3. A kit that does not suit a stack may be given, and the row is marked
   (the owner, 2026-11-14: "players get blocks, judges get warnings").
4. One Kits window with two tools, and no tabs. The owner, of the chart:
   "The Roll at Random and Design by selection are tools for the tab."
5. An armour item is listed and the kit's stat change carries the armour
   class. The system's `computeAC()` returns early for an actor that is not
   a character, and the module's own Inventory tab says so in
   `ACKS-MONSTERS.hint.inventory`.
6. Nothing turns an inventory on. Both monster sheets already list a
   monster's items with their own Add controls: the system's
   `attributes-monster.hbs` and the module's
   `templates/monsters/tab-inventory.hbs`. This is a reading of the owner's
   "optional, not used for basic entries": optional means empty until
   something is given, and no switch hides the tab. Example: a basic entry
   shows an empty Inventory tab, and giving it Kit B lists three items.

The boards' "pinned" kits are gone with re-roll; a kit given by hand is
left alone by a later roll through one tick box.

**Canvas 3 (S4b)**, https://claude.ai/artifact/Vohd3xxedZW72JZrCJNoRL,
Version 7.

1. The editor opens from all three places: the monster's Ecology tab, the
   template's variant row and the chart's Roll.
2. No preview roll. A roll writes at once ("Just drop the reroll
   entirely").
3. A leader's grade is the template's Leader figures axis, built in phase 1
   and chosen at the Roll. A recipe part carries no grade.

**Canvas 4 (S8b without T10, S9a, S9b-2)**,
https://claude.ai/artifact/Bb3mZgyZmYNoPCKpEcXp4v, Version 7.

1. A unit's leader is an actor of its own under the adopted shape, with
   board 4a's rows on its sheet. Any other carrier still in a stack presses
   from its stack row: Raise or Throw puts the body out by the group's
   shipped Deploy and then acts. Nothing is refused.
2. Who sees a reach is the Judge's choice for each item, the first option
   and the one first drawn: a tick in the row editor's reach group (S7's
   `showReach`), which sets the Region's `visibility` when the item is
   raised. Core's own Visibility field on the Region changes one ring until
   the item is lowered, since lowering deletes the Region. A hidden
   bearer's reach does nothing, as S7 proposed.
3. A save is the carrier's prompt with a Save press for the saver's owners
   and the GMs, as the cast card's recurring prompt has it
   (`docs/magic/MODEL.md`). Nothing is rolled for anyone.

S7's E5 question is answered by the page: (a), no count on the item's first
bearer (MM p. 56). A Judge may type one.

Board 4d is new and draws what S7 found undrawn. The place on a carried
item's sheet that opens the row editor is the row list of the ability
sheet's Mechanics tab (`templates/abilities/tab-mechanics.hbs`, with its
`effectAdd`, `effectEdit` and `effectDelete`), put into the system's item
sheet by the same injection as canvas 2's. The editor gains a reach group.
4d also draws E5's row with its Swig press, and says where S9b-2's two
prompts and the breakage appear.

S7's two lists of UI elements, each walked to a board. For S8b: the press
and its state are on 4a (the sheet row, the stack row and, by a line, a
character sheet's inventory); the ring and who sees it on 4a, 4c and 4d;
the prompt card on 4b; the editor's host and reach group on 4d. For S9a:
the press is 4a's Throw, which S7 calls the light press; the fuse's state
on the bearer while it burns is that row's second state on 4a; the blast
card is on 4b.

T10 is left out of canvas 4. S7's addendum A5 leaves its reach open among
three ways and no board draws them. S7 calls it the one piece of S8b that
can slip, and it stays with `architect`.

**Canvas 5 (the template sheet)**,
https://claude.ai/artifact/PxYv6twWXeHwarsiXU8Vkh, Version 9.

1. and 3. The strip's heads are tribes' and the strip stays whole.
2. Variants and traits are picked from the selects phase 1 built
   (`templates/lib/template-sheet.hbs`). The picture tiles are withdrawn.
4. A tribe's head is shown nowhere else.

The picture is the actor's image at the head of the sheet. A click on it
is core's `editImage` action, and showing it large is `ActorSheetV2`'s own
header control, which `TemplateSheet` inherits.

One rule is drawn for a choice the variant's tables do not give: it is
marked and a Judge may still make it, in a select and in a tick box alike.
Canvas 1, approved, keeps such a pick on board 1b ("A Judge may keep it"),
the first option of its question 3, and the owner's "players get blocks,
judges get warnings" (2026-11-14) asks for it. A roll never lands on one.
The rule changes four things:

- the selects' `disabled` on such an option, built and walked in phase 1,
  goes, and the words it is listed with stay;
- `chooseAxes` (`scripts/lib/template-logic.mjs`) today logs a pin on such
  an option as `unavailable` and rolls in its place. Under the rule it
  keeps the pin, logs it as given by hand, and writes what the option's own
  patch and matching cells give that variant, which may be the option's
  name alone;
- T-0719: the variant-pin prompt lists such an option with the same words;
- T-0720: the gear axis is `multi` and takes no bands
  (`scripts/importer/organisation-axes.mjs`), so nothing says today which
  piece a role may carry. The build needs that read from the equipment
  table by role, the mark, and a ticked piece given at generation.

**Not checked.** How any board renders; open and close tags were counted on
the eleven boards and balance. Whether the system's item sheet has a
Details tab for every item type the import mints for gear. The token HUD's
Raise and Throw on board 4a, which were drawn before this audit and reuse
nothing named. Which pieces board 5a marks, which is a stand-in.

**Released: none.** A go-ahead on canvases 2 to 5 would release S14 (after
S13 and S12), S4b, S8b without T10, S9a and S9b-2 (each after S8a), and
the design of T-0719 and T-0720. It would also accept the points of S7's proposed ruling
that canvas 4 is drawn on: the reach as a core Region, the carrier built
beside the cast engine, and the split of S8 and S9b. Section 3's rows and
the phase prompts are unchanged until then.

### The owner's go-ahead on canvases 2 to 5, 2026-11-24

Asked "Go ahead on canvases 2 to 5 as corrected?", with the buttons "Go
ahead" and "Changes first", the owner chose:

"Go ahead"

The words are the button's; the choice is the owner's. It is the go-ahead
`.claude/rules/ui-layout.md` ("Design before build") asks for, on canvas 2
at Version 7, canvas 3 at Version 7, canvas 4 at Version 7 and canvas 5 at
Version 9, as "Canvases 2 to 5 audited" (above) describes them. Example:
S14 builds one Kits window with two tools and no tabs, adds no inventory
switch, and lets a Judge give a kit that does not suit a stack, marked.

The message that asked listed the picks that depart from something said or
built earlier, so the go-ahead covers them by name: no inventory switch,
which is a reading of "optional, not used for basic entries"; tools in
place of tabs in the Kits window; a choice the variant's tables do not give
marked and pickable, which reverses the unpickable select options phase 1
built and walked; S7's canvas 4 question 2 and its E5 question answered;
board 4d; and no preview roll in the recipe editor.

**Released:**

- S4b, built from canvas 3 (phase 3).
- S14, built from canvas 2, after S13 and S12 (phase 4).
- S8b without T10, S9a and S9b-2, built from canvas 4, each after S8a
  (phase 2, `topic/beastman-gear`).
- The design of ledger rows T-0719 and T-0720, from board 5a, with the two
  other changes its rule makes: the selects' `disabled` and `chooseAxes`.

**Accepted with it**, as the same message named them: the points of S7's
ruling that canvas 4 is drawn on, which are the reach as a core Region,
the item carrier built beside the cast engine, and the split of S8 and of
S9b.

**Still open:** T10's reach (S7's addendum A5), which stays with
`architect` and holds nothing else.

Not checked: any board's rendering. This session starts no build session.
Section 3's rows, the note above phase 2's prompt and phase 3's prompt are
corrected on this entry; phase 4's prompt is phase 3's to write.

### Phase 1, 2026-11-24

S1 to S5 built on `topic/beastman-organisation`, one `implementer` per slice,
landed on `main` and walked on seat lane B. Commits, none pushed: S1
`b6b8297e`, S2 `467c0c3a`, S4 `ddf61bba`, S3 `e3248745`, S5 `02b0544f`, and
`be3508b1`, which moves the new table recipes into the MM's book folder after
the first land was refused by check-silos. The topic is landed and open;
phases 3 and 4 build on it. What landed is described in `docs/monsters/MODEL.md`
("The organisation tables", "The encounter recipe", "The organisation axes")
and ruled in monsters and lib DECISIONS (both 2026-11-24). The walk recipe is
`docs/monsters/TESTING.md`, "The organisation axes", marker
`monsters/beastman-organisation`.

Breeds below are named by their page, pp. 48 to 53; roles, traits and items
by the ids at the head of this file.

**Exercised live**, on lane B, the Gamemaster 2 and Player 2 seats, with
Gamemaster and Player seated by peers and nothing shut down:

- The import wrote the MM's 21 `monsters` tables. A repair in place took the
  family template from the axes Variant, Leader figures, Role and Kit to the
  seven axes in their order, with 23 more cells. Its picture was unchanged.
- Availability on the template sheet, through a real pick in its selects: on
  the p. 48 breed, every R is enabled and the two T without a band are listed
  disabled. Through the resolver on every breed, all 102 R and T cells match
  pp. 55 and 57, the 19 blank ones unavailable.
- For every breed: each R and each T pinned alone, and each leader rank under
  both Leader figures sources, 131 creatures in all. Every armour class,
  attack, initiative, avoid-surprise, morale and damage change matches the
  paragraph that prints it. The T1 natural attacks are each breed's printed
  dice exactly as written. A row whose paragraph prints
  only conditional figures (R2, R7, T2, T3, T4, T6, T10) changes no figure.
  Every leader cell matches p. 54 under the table grade, and the breed's own
  page under the default. The four cells where the two print differently
  each come out as their own source prints them: the p. 48 breed's chieftain
  damage, the p. 50 breed's chieftain armour class, the p. 51 breed's
  champion damage and the p. 52 breed's sub-chieftain armour class.
- Rolls: 36 rolls on each of R and T (six per breed). Every result lands on a
  band the breed has. None landed on a blank and none fell into a gap.
- Each of E1 to E9 pinned alone on every breed (54 creatures): no figure
  moves, and the flag records the item with its row and cite.
- Step 6, on every breed: a rank and file with each Kit the breed has
  (18 breed-and-kit pairs), then with R5 and T9 added, and a champion with the same.
  The armour class stands on the kit's figure with the bumps added, a row the
  breed has no band for adds nothing, and the hover keeps the kit's part (its
  row and page) before the organisation parts. Every kit pinned on a rank and
  file wrote the breed's own armour class, so the kit's figure was the base
  each time; that is the Kit axis's data and is not judged here. A
  table-grade champion's damage with a Kit is the kit's figure plus the
  grade's step over the warrior, by importer DECISIONS 2026-11-14. On the
  p. 51 breed that differs from the grade's own figure with no kit, as that
  rule says it should.
- The sheet gesture: the troop and trait picked in the template sheet's
  selects and Generate clicked. The creature it opened has the base armour
  class plus both bumps. On the Full Monster sheet, the armour-class hover
  names the base, each part and both pages. It renders the same on the
  Player 2 seat once that seat is given Observer, and it is gone after
  another armour class is typed.
- The other hovers on the Full Monster sheet, on the p. 53 breed: attack (R1),
  initiative and avoid surprise (R4), morale (T8), damage (T5) and armour
  class (R1) each give the figure, its base, the part and its page. A
  table-grade champion's and chieftain's armour class and Hit Dice hovers name
  the leader table, its page and the armour words.
- The proficiency grants: R3's lands as one ability item on every breed. R6's
  word folds onto no world proficiency, so the creature gets none, and that is
  the console warning seen seven times (six pinned, one rolled).
- Teardown: every creature was deleted by the uuid its own generation
  returned. Sweeps removed 131 + 108 + 1 + 4 + 60, with nothing missing and
  nothing refused. A console recorder attached after `ready` saw no error.

**Checked offline only.** The second land's full gate, on the landed tree,
passed 346 suites, among them `test-lib` 280, `test-organisation-axes` 69,
`test-prose-values` 67, the ecology recipe 38 and `test-organisation` 26. `check-organisation-axes` and
`check-ecology-recipe` were read against pp. 54 to 57 on this machine's MM.

**Not checked.** A fresh import into an empty world, and a world missing one
table. The variant-pin prompt dialog. The creature's notes, where each
conditional row and each E is said to be named with its page. The Follower
Card's figures (see T-0715). The sheet at a raised type size or a narrow
width. `init`, `setup` and `ready` themselves, since no recorder was attached
before them. A leader rank whose two sources differ in armour class, under a
Kit. Whether a breed's damage modifier reaches its T1 natural attacks,
which section 2b leaves open.

**References to other creatures** (section 4, answer 6). This is a census of
what phase 1 holds, matched by folding the printed word against the MM's
cookbook entries (plural to singular, the entry's "X, Y" order), offline on
this machine's MM. Nothing writes the match yet: every such part keeps
`source.name` and an empty `source.uuid`. The census script and its output
are on the rules shelf, `C:\Proj\acks-rules\acks-monsters\beastman-outside-refs\`
(LOCAL-ONLY), and print the words this file leaves out.

- Resolved, one entry folds: the guard-beast part `guard-1` of all six breeds,
  and `guard-2` of the p. 53 breed. On p. 54, the beast cells of row V1 that
  name a creature outside the family and five of V2's six cells. On p. 55,
  four of R7's six mounts, the p. 48 breed's beasts that fight alongside
  included.
- Unresolved, a finding each, none guessed at: `guard-2` of the p. 49 breed,
  whose word two entries answer because the page leaves out the qualifier
  both carry, and V2's cell for the same breed, for the same reason. `guard-2`
  of the p. 52 breed and that breed's R7 mount, whose entry is filed under a
  category word the page leaves out. The p. 51 breed's R7 mount, which matches
  no entry by fold because the entry is named by another word.
- Not creatures to resolve: each breed's `captives` part, a count of no named
  kind. T6's added beasts, which the page leaves to the breed. V6 and V7's
  "fights as" cells, which name breeds of the family.
- The owner's second example word names no creature the section prints. The
  p. 50 breed's guard beast and mount are printed under another word, which
  folds to its own entry.

Making these references real is more than a fix to S4. The part needs an
entry reference resolved at generation, since a library uuid exists only
once the other creature is imported. The resolver needs a category word and
a two-entry case, which no fold settles. The text cells of V1, V2 and R7 need
reading into parts. All of it is the new S11 requirement in the phase 3
prompt below; ledger T-0717.

**Findings**, each on the intake ledger:

- T-0713: R6's proficiency is never granted.
- T-0714: the table grade's die is recorded and read by nothing.
- T-0715: the Follower Card names no organisation part.
- T-0716: the armour-class tip opens with the unwound base.
- T-0717: no references to other creatures.
- T-0718: `acks-branch land` deletes its gate log on a refusal.
- T-0719: the variant-pin prompt lists bandless options.
- T-0720: the E checkboxes have no unavailable state (needs `/design`).
- T-0721: the recipe reader yields parts for seven entries outside the
  family.
- T-0722: a one-per-N dependant share is unread.
- T-0723: the trait table's `damage` key holds two shapes.

Two more for the slices that own them. E5's condition is printed under a
word other than the `choking` that section 2d names (S9b). The recipe
part's `basis` field and its whole-unit share are what S11 reads (MODEL,
"The encounter recipe"). lib's `apiVersion` is 66.

Section 3's S5 row is delivered as built, without its "trait art" (Ruling 4
above). Phase 1's start prompt is spent.

### Architect's S7 ruling, 2026-11-24 — proposed

Two `architect` rulings, read-only, on `main` at 455f2cfa and core 14.2.0;
whole in `wip/20261124-s7-ruling-reader-carrier.md` (points 1 and 2, S8,
S9a) and `wip/20261124-s7-ruling-consumers-gear.md` (point 3, S6c, S9b,
S9c). Neither ran a suite or a walk. Proposed until the owner accepts it;
S6c, S9c and S9b-1 are built on it because they need no design and no
owner answer. Its canvas 4 question 2, its owner question on E5 and the
editor host it found undrawn are taken up in "Canvases 2 to 5 audited",
above. The owner's go-ahead on canvases 2 to 5 accepts the points canvas 4
is drawn on: the reach as a core Region, the carrier beside the cast
engine, and the split of S8 and of S9b. T10's reach stays open.

- **The range reader** is a core Region attached to the bearer's token, a
  grid emanation of its footprint, with a new lib behaviour sub-type
  `aura`: core decides who is inside, a pure lib filter `{kinds,
  exceptKinds, side, unit}` decides who counts, turn starts come from lib's
  turn hook on the primary GM, and deleting the Region is the one teardown.
  It follows lib DECISIONS 2026-11-16 (shape and membership are core's). A
  hidden bearer's reach does nothing. T10's reach is engagement, which is
  left open with three options.
- **Canvas 4 question 2** stays the owner's: each answer changes only the
  Region's visibility and whether the module draws a label; answers (a)
  and (b) each need a design.
- **The item carrier** is built beside the cast engine, in lib
  (`item-run`), importing nothing from `scripts/magic/`, and reuses the row
  schema, row editor, saves, amounts, defences, turn clocks, end-on-attack,
  immunity records, the roll card and the relay. Its door is a new lib seam
  on `Item#use`, lib its one owner, refusing every spell. An item's rows
  point into the registry and are read at use.
- **S8 splits** into S8a (reader, carrier, seam, kinds, the sub-type in
  `module.json`, which needs a world relaunch; no UI) and S8b (E3, E4, E9,
  T10; design). S9a (E2's fuse and burst) builds on S8. Canvas 4 does not
  draw the row editor's host on a gear item, nor the hidden-bearer
  behaviour; both are for the owner beside its questions.
- **3(a)** A row's condition word is imported (`targetCondition`, R2 and
  T3) and folded at generation by `matchCondition` against the catalogue,
  reusing `matchProficiency`; a Judge corrects it in the registry's
  override layer; a word that does not fold writes nothing and is listed.
- **3(b)** Outnumbering stays S6a's count of the combat's undefeated
  combatants by disposition, each counting as its `bodyCount`, with a
  `strict` flag for a clause that prints no ratio.
- **3(c)** R2's dice multiple is a consumed target `damageDice` through the
  `damageFormula` seam under a new `allOf` gate, the delivery recorded from
  the `attack` answer (qualifies lib DECISIONS 2026-10-20). T2's damage half
  is a `damage` answer; its morale half goes to influence's
  `getAbilityReactionMods`, which must first honour `gate`.
- **R4 and T7** waive `charging` and `retreating` through `acWaiver`,
  chosen by two recipe keys; the undeclared withdrawal is a recorded note.
- **S6c is its own slice**, before S9c and S9b: one ability item per chosen
  troop and trait on a fighting creature, specs built from the recipe's
  value keys only. No design.
- **S9b splits**: S9b-1 (delayed damage survives the end of its fight on a
  world-clock leg; E8's `onHit` on the ammunition stack; E5's data and a
  pure `swigOutcome`; no UI) and S9b-2 (the swig, the two prompts, the
  breakage; needs the carrier, the kind reader and canvas 4's design).

**Owner question, before S9b-2 only.** Does a beastman's own E5 item count
its swigs: (a) no, counted only once recovered, or (b) yes, rolled at
generation?

**Section 3 corrections, on this ruling.** Add "S6c | 2 | gear |
implementer | The gated troop and trait rows written as ability items: on
every breed, R2's surprise part, attack and dice multiple apply only
against a target in the folded condition at melee or short range. T2's
attack and damage apply only while outnumbering at the imported ratio, and
its morale part is offered pre-ticked only while outnumbered. T3 and T4
apply only under their gates. R4 and T7 lose no Armor Class to their waived
conditions. A word that does not fold writes nothing and is listed | no |
S6b". S9c needs S6c as well as S6b. S9b becomes S9b-1 (no design; needs
S6c) and S9b-2 (design, through canvas 4; needs S8a). S8 becomes S8a (no
design) and S8b (design); S9a needs S8.

### Phase 2, 2026-11-24

Built on `main` as fixes and on `topic/beastman-gear` (landed slice by
slice, the topic left open for phase 2b), every slice walked on `main` on a
lane no peer held, without a world shutdown. Every commit is local and not
pushed.

**Commits.**

- T-0713: a2e1fe65. T-0714 (on architect's ruling): 9fd59365.
- S6a and S6b: 8bc358b1, 1cffe874, b3addefd, 1777664f, 455f2cfa. The round
  and outnumbering gates read nothing in a
  combat the roller's tracker does not view, which the walk found and
  6413dbb8 fixed.
- S7, two `architect` rulings ("Architect's S7 ruling", above): 8cad19ec.
- S6c: b1922b13, 9d530932, bdceea57 (closes T-0726).
- S9c: 368c133f (closes T-0710). The Full Monster sheet's Armor Class hover
  lost E6's gear part, since the monster extras schema never declared it:
  e02a4537.
- T-0730, found by S7: the rounds to a turn and the turns to an hour were
  printed values shipped in lib's constants. They are read at import
  (RR p. 263), and every delve, door, search, journey and spell-duration
  reader fails without breaking on a blank: 2726bf8d.
- S9b-1, parts 2 and 3 (E8's data, E5's data and `swigOutcome`): dd5c22e1,
  df4a2dc0.
- S9b-1, part 1 (the delayed-damage world-clock leg, T-0725): bdf35501,
  cde77921.
- The walk recipe's drive mechanics and the re-import upgrading note:
  176216f7.

**Exercised live** (lane B, scripted through the capture driver, every
generated document tracked and swept by id):

- R3 and R6 grant their proficiency on every breed; a leader-table grade
  carries the table die on its by-weapon attack, and a hit posts it.
- The gates: R2's row and dice multiple only against a target in the
  folded condition, in melee and inside its band (`rangeBand` checked in
  and beyond); T2's attack and damage only while the ratio is met, its
  morale part offered, absent and pre-ticked as the sides stand; T4 in its
  round; T3 under its condition; R4 keeps its Armor Class under Charging and
  Retreating and loses Disordered's. Opposing carriers' surprise parts
  apply once, the most adverse.
- The per-die reduction stage on Apply; E6's Armor Class part and its
  hover on the Full Monster sheet; a hooked character weapon's Disarm row on
  its Rolls tab, and none on an untagged one.
- Delayed damage through the real turn edges of an active combat: it lands
  at the bearer's next turn start once, and the record goes.
- E5's drink item with its page, catalogue condition and swig dice, and no
  count, which is the page's answer (a). E8 recorded only on a generated
  creature; on a scripted archer, `shotStack` names the flagged stack,
  `onHitOf` reads it, and a shot spends that stack and no other.
- T-0730: a real blank world (the tables predated the recipe), then the
  import, a turn and a round on the clock, the world clock moved by a turn,
  the strip's text and page, and an override layer that moves the figure
  and reverts.
- T-0725: a record still due when its active fight is deleted moves to the
  world clock with no combat keys, pays nothing then, stays pending short of
  its due point and lands once past it; with the round's length taken off
  the client's registry, the fight's end deletes it and warns the Judge once,
  naming the bearer.
- No console error during any run, recorded from after `ready`.

**Offline only:**

- The mutation checks of every new mapping (each slice's report).
- E8's generation half (flag, nock, record-only), held by the organisation
  suite alone.
- T-0730's lights burnt per turn, door and search costs, journey seconds
  and spell durations in turns.

**Not checked:**

- The Surprise Matrix display of R2's part; T7; the influence morale
  page's own UI; the Ruledata Browser's UI writing an override (the walks
  used the registry's override layer in the client); a printed word
  overridden to one no entry answers.
- T-0730 at `init`, `setup` and `ready` in a blank world (the recorder
  attaches after `ready`), the encounter card's minute, and a party token's
  drag billing.
- The committed follower-card walk (lane A held the active GM).
- T-0725 through a scene's deletion, on an unlinked token's actor, and the
  notification's text read on screen.
- The upgrading notes' own path (Reimport One Shelf, Rules tables): the
  walks called the importer's table import directly. The menu offers every
  document and each by name, `formation` and `monsters` among them.

**What the walks left in the world:** world time advanced by the T-0730 and
T-0725 walks; the `monsters` and `formation` tables re-imported from the
staged books. The fixtures `equipment/onhit-archer` and
`formation/time-unit@bm2`, which their recipes call kept, were built by
`api.fixture` and swept with the run's ledger each time, so none stands.

**Findings and choices for the owner:**

- **Answered by the owner, 2026-11-25: T-0730's import is undone.** Asked
  whether to keep it as committed, the owner: "Too aggressive, rounds per
  turn is very generic rules, not IP". The rounds to a turn and the turns to
  an hour are constants in `lib/time-unit.mjs` again, under the same reader
  names, never null; the ruling and its reading are in `docs/lib/DECISIONS.md`
  (2026-11-25). The rest of this bullet is the cost as it was put, and no
  longer holds: T-0730 was committed before its cost was put to
  you. With its figures not imported, round-level play advances nothing
  (advance-round, hasty actions and combat rounds move no clock, and the
  delve counts whole turns), a spell duration counted in turns has no
  figure, a record counted in rounds never ends, and the world clock is not
  moved by a delve. A world imported before this release re-runs the Rules
  tables import (its upgrading note).
- T-0725's world-clock leg reads every world and token actor on every
  world-time tick, uncached. A bearer who left the fight is paid on the
  world clock but dropped on the combat clock; no ruling covers the
  difference.
- Monsters now take manoeuvre throw rows (S9c); no ruling covers it.
- R2's surprise part is written ungated, where section 3's acceptance
  reads it under the gate.
- A world whose `monsters` tables predate a recipe change carries rows
  without the new figures until it re-imports (upgrading note).
- Turn edges fire only for an active combat, on the primary GM. A combat
  deleted while no primary GM is seated leaves its delayed-damage records on
  a clock that no longer exists.
- Generated rank-and-file creatures carry only the "By weapon" marker, so
  every walk of an attack or of E7 or E8 gave the creature a weapon.
- Registered, not built: T-0727 (nothing rolls a manoeuvre save), T-0728
  (the Rolls tab lists manoeuvres for characters only), T-0729 (E1's human
  and demi-human penalty has no slice), T-0731 (influence's `kindOf`
  duplicates lib's kind reader), T-0765 (the importer's two private
  turns-to-an-hour copies, `city-travel-binding.mjs` and
  `survival-binding.mjs`, found by T-0730's work and not moved, against
  `ip-doctrine.md`'s "fixed by the work that finds it"). On the owner's
  2026-11-25 ruling above, T-0765 is no printed-value finding: the two
  copies read lib's constant.

**Held, then released.** S8a, S8b, S9a and S9b-2 were held through this
phase. The owner's go-ahead on canvases 2 to 5 released S8b without T10,
S9a and S9b-2, each after S8a, with the page answering E5's question. They
are phase 2b's ("Start prompt, phase 2b").

### Hand-over from the planning session, 2026-11-25

The session that wrote this plan and relayed for the phases hands over to
the release hub. What it holds that no entry above does:

**What `main` gained outside the phases.** `5bed0126`, `c1a965e0`,
`1cfa6ec7`, `c5226cc9` and `0141bd57`, none pushed. The rounds to a turn, the
turns to an hour and the battle-map square's feet are constants in source
(`docs/lib/DECISIONS.md` and `docs/battlemap/DECISIONS.md`, 2026-11-25; the
owner's test is in `.claude/rules/ip-doctrine.md`). For a topic's next sync:
lib `apiVersion` 72 is the time unit's, 73 phase 3's, and phase 2b takes the
next; `sizeSquareFeet()` never answers null; `footprintFeet` and `sizeChips`
take no `feetPerSquare`; `tools/time-unit-fixture.mjs` exports counts and no
register or remove function. A size category's frontage stays imported.

**Not exercised live from those commits.** The delayed-damage record whose
fight ends (`docs/lib/TESTING.md`; its suite passes, no walk covers it); the
battle-map recipe's steps 6b through the Ruledata Browser, 7a, and step 8's
chip click, reset arrow and two-scene comparison; the time-unit recipe's T4
drag. Token sizing (steps 6, 6a, 7, part of 8) and the time unit's T1 to T3
were walked by one-off probes, since `tools/live/battlemap.mjs` sizes no
token.

**Registered, not built.** T-0781: the rules-table import carries forward a
table no recipe produces, so an upgraded world keeps `monsters.sizeSquare`
listed and unread. The owner was asked twice whether a way to drop such
tables should be designed and has not answered. T-0782: the battle-map walk's
G2 failed once and was not rerun alone. Noted on its row: the battle-map
walk's two L5 checks fail since `1e3bc714` (T-0602), read as a walk written
before that ruling.

**Seat lanes.** Measured this day and written into the machine's
`TEST_ENVIRONMENT.md`, "Seat lanes": the active GM is the seated Judge whose
user id sorts first (lane A, then C, then B), and the kept fixtures the
committed walks reuse belong to lane A's player. A walk on lane B or C
without `FIXTURE_OWN` fails its player-seat checks, and a Judge seated on
lane A takes the automation from a walk on B or C.

**With no session and no brief.** T10's reach: S7's addendum A5 leaves it to
`architect`, nobody has been given it, and its surface was left off canvas 4,
so it needs a design board once ruled. Phase 4 (S13, S14) has no start prompt
here; phase 3's close-out writes it.

### Phase 3, 2026-11-25

Built from "Start prompt, phase 3" through S11c, one `implementer` per slice,
each brief quoting the owner's words and the agent restating them first. The
walk scripts came from further `implementer`s and the gate fixes were made by
the session itself. The release hub then gave S12, S12b and S4b to a clean
session, phase 3b, under the prompt below. Every commit is on `main` and
none is pushed.

**Landed.** All three landings had a green gate:

- S10a, S10b and S10c: `97075983`..`2201349b`, 13 commits. lib `apiVersion`
  is 73, renumbered at the land above the time unit's 72.
- S10d, S11, S11b and their walks: `d829908f`..`e96833b1`, 15 commits,
  `apiVersion` 74. The rebase met one `docs/lib/DECISIONS.md` conflict and
  kept both entries, `main`'s first.
- S11c, its walk and the initiative walk's fixes: `a7eabfbb`..`bd069195`,
  7 commits, `apiVersion` 75. The first gate was red on validate:
  ``makeLoc(`${LANG_PREFIX}.org`)`` reads as a literal lang key. `bd069195`
  binds the root as `ORG_LANG_PREFIX`.
- On `topic/beastman-organisation` and not landed: `78a59ae4` and
  `46f159a4`, two walk fixes, `tools/live` only. The topic stays open with
  its worktree clean.

**What each slice built.** The mechanics are in `docs/lib/GROUPS.md`,
`docs/lib/ORGANISATION.md`, `docs/monsters/MODEL.md` ("The organisation
roll") and `docs/henchmen/MODEL.md` ("5b"):

- **S10a:** nested groups through `unit.parentGroupUuid`, with
  `setParentGroup` refusing a cycle; live counts with nested bodies; the
  count floors (T-0732, T-0733); `stack.gen`; `stack.fixedHp` (T-0711's lib
  half); the labelled stack and its whisper; the `encounter-generator` v1
  contract.
- **S10b:** `units` on factions and groups; `org-tree-logic.mjs`,
  `org-host.mjs` and `org.mjs`; the morale walk over the officers above.
- **S10c:** `serviceNodes(employer)`. A hired unit's officer has no node and
  heads its unit's row.
- **S10d:** `gangPartition` and `groupGangs` make the system's
  `combat.manageGroup(tokens)` call once per gang of two or more bodies. Each
  call waits for the stored list before the next (T-0735). `absorbNested`
  handles a gang already in the fight. lib DECISIONS 2026-11-25 supersedes
  2026-08-24 in part.
- **S11:** the recipe evaluator, the organisation roll, the outside-reference
  resolver, and the Roll, Add and Edit plans. Section 4, answer 6's
  acceptance is met: the shipped resolver reads 23 outside references, and
  18 resolve. The other 5 stay findings the Judge links by hand: two with two
  entries, two category words and one with no match.
- **S11b:** `lib/org-run.mjs`, `org.deleteRow`, `api.monsters.rollOrganisation`,
  the Judges' card (board 1e) and the pot hand-off. A stack's `gen` records
  `mount`, `carry` and `speakers`, and nothing enacts them yet.
- **S11c:** the Faction line on a group's sheet (board 1m): Join a faction,
  Make its own, Open and Leave.

**Exercised live**, on `main`, every run with `FIXTURE_OWN=p3`; each line is
the runner's:

- `2201349b`: `lib-org-chart` on lane C, "passed (43 pass, 0 fail)". On lane
  A, `lib-nested-groups` "passed (29 pass, 0 fail)"; its first run errored
  after 6 checks because its bare place was pruned (T-0780).
- `e96833b1`: `monsters-beastman-village` on lane A, "passed (44 pass, 0
  fail)". One roll made 14 groups, 5 prototypes shared by 10 stacks, and 13
  leaders. One group names no officer, and which one was not read.
  `lib-group-initiative` on lane A was "failed (36 pass, 5 fail)", every
  failure the walk's own set-up. With the walk fixed it "passed (41 pass,
  0 fail)".
- `bd069195`: `lib-org-join` on lane A, "passed (58 pass, 0 fail)" with
  `78a59ae4`. Its two earlier runs failed 3 at step 5, because the walk read
  before the leave's second write. `lib-org-chart` on lane A "passed (43
  pass, 0 fail)" with `46f159a4`; its first run errored when the kept place
  was pruned.
- S10d's first observation: under the system's initiative persistence
  "reset", a group rolls again each round. The round turn clears every
  initiative, and each gang then takes a new shared value. The system never
  writes a group's rolled initiative back to its stored list, which stays
  -1. A gang's bodies share a value because one `rollInitiative` call rolls
  them together.
- T-0734 was reproduced: three groups made by three calls all hold the last
  call's bonus.
- Every sweep: failed 0. Its "missing" are the walk's own deletes.

**Offline only.** Each slice's suites were green as its agent reported them,
and the orchestrator re-ran them on a copy of the committed tree: test-lib
287, test-org 30, test-org-tree 33, test-org-write 13, test-org-run 12,
test-encounter-recipe 19, test-organisation-logic 33, test-organisation-card
5, test-group-combat 31 and test-group-faction 9. Each slice's mutation
checks were killed. `monsters/organisation-run.mjs` has no offline suite; the
village walk is its only check.

**Not checked:**
- a page reload before `gen` is read back (it was read through `fromUuid`);
- hovering any tooltip on the card or on the Faction line;
- the card at a raised type size;
- whether a lone counted unit is lowered, since no walk asserts it;
- the tracker's group mark.

**What the walks keep.** These fixtures stay in the world, each `@p3`:
- `lib/org-{monster,faction,warband,gang,chief,place}`
- `lib/org-wander` and `lib/org-wander-faction`
- `henchmen/service-{employer,hench-a,hench-b,officer,unit}`
- `lib/nested-group-{monster,outer,inner}`
- `lib/combat-{monster-a,monster-b,warband,gang-a,gang-b}`
- `monsters/beastman-village` and `monsters/beastman-village-place`

Lane A's player is left at Observer on `lib/org-wander`; the join walk's
shape step resets it.

**Readings drawn as the session's pick, and built so.** The owner has not
answered these:
- (a) A single counted lair unit roots at that unit's group, with its
  printed leader as officer and no level above it. `docs/monsters/DECISIONS.md`
  records it; it supersedes S11's same-day reading on the adopted example.
- (b) Delete takes a row's whole subtree.
- (c) Delete leaves leader actors in the world and lists them.
- (d) The Join picker joins at the chart's top only.
- (e) A gang under a faction's chart shows the Faction line with Leave, a
  reading of "Village always has one".

**Ledger.** Fixed, unreleased:
- T-0711, T-0732 and T-0733 (`97075983`);
- T-0717 (`d829908f`).

T-0734's row notes the live reproduction. New rows:
- T-0773: the group sheet's totals read own bodies only.
- T-0774: `parentGroupUuid` has no update guard.
- T-0775: a group's own officer morale bonus is ungated.
- T-0776: a negative warband modifier cannot be held under the field's
  floor.
- T-0777: a player's send out of an empty row throws.
- T-0778: `rosterOf` gathers differently from the tab.
- T-0779: the system's stored groups are never pruned.
- T-0780: the empty-location prune takes a location made just after
  loading.

Docs debts:
- `docs/lib/TESTING.md` names no script for "A warband's token in a combat".
- Its "Join, leave and make its own" step 9 restores at teardown, where the
  walk reshapes at start.
- `scripts/lib/README.md` lists neither `gangPartition` nor `groupGangs`.

### Phase 3b, slices (f) and (e), 2026-11-25

A fresh session (chart-feh) took over slices (f), (e) and (h) from the
phase 3b orchestrator at its hand-over. Slices (a) to (d) and (g) are that
session's, landed at `379002b6` and `18fface1`. Under the hub's protocol
v2 each landing is logged in the gitignored `aia-tmp/20261125-landings.md`,
and the walker runs every walk. This session ran none. Nothing is pushed.

**(f), T-0836, landed at `42505a86`, lib `apiVersion` 88.** It
reproduced by reading and by a red unit case. A gather now keeps a size a
hand gave a body's token, and auto-size leaves it alone: every automatic
size write stamps `sizeStamp`, the roster record keeps `tokenSize`, and
the send-out lays it back with `footprintLock`. The ruling (architect,
option C, held by the hub) is in `docs/lib/DECISIONS.md`. The walk step
is in `lib-nested-groups`.

**(e), S4b, the recipe editor.** It was scoped as one field. It is the
whole editor, plus the hub's frame 1t (Mount and Beast in the Role select),
which reverses the S4b brief's pick 1.
- e1 and e2 (origin on a part, the repair merge for the actor and for each
  template option, the read copy, guard keys by creature word) landed at
  `c2b59799`.
- e3 to e5 (the editor's logic, `fixedHp`, the `unlinked` finding, the
  window, the Ecology and variant-option doors, the docs, and the walk
  `monsters-beastman-recipe`) land after this entry.
- The departures from canvas 3 and their counter-arguments are in
  `docs/monsters/DECISIONS.md`, 2026-11-25, "The recipe editor (S4b)".

**Offline only.** Each slice's suites were green as its agent reported them
and as this session re-ran them before each landing; every mutation check
was killed. The editor app itself (`recipe-editor.mjs`) is checked only by
`node --check`, since no suite can import it.

**Not checked:** everything live. The walks owed are listed per landing in
the landings file.

**Registered:** T-0852, a labelled stack drops `fixedHp` in lib.

**Left to (h):** S12b, the Followers tab's views over `serviceNodes`
(board 1l), in a fresh session from `aia-tmp/20261125-handover-chart-h.md`.

### Phase 3b, slice (h), 2026-11-25

A fresh session (chart-h) built S12b from board 1l in three `implementer`
slices on `topic/beastman-organisation`, each from a brief quoting the
owner's words, and landed them once. Board 1l's points 2 and 3 were taken
as drawn ("The owner's correction: controls, not gates"): the views are
Cards, Org chart and Locations, and Show stays on the card with edit and
send out under it. Nothing is pushed and no walk was run here.

**What was built.** The mechanics are in `docs/lib/ORGANISATION.md` ("The
Followers tab's service mode") and `docs/character-sheet/MODEL.md`
("Followers"):

- **h1 (lib `apiVersion` 100):** `serviceChartContext` and
  `serviceLocationsContext` draw lib's chart and Locations partials in a
  service mode over the nodes the tab passes in (lib imports no henchmen
  reader). A hired unit's head is its officer's Follower Card and the officer
  has no node; a lone follower's head is its own card; the root is the lord
  with a count of its direct followers. `org.sendOutHolder` and
  `org.recallHolder` are keyed by the follower's uuid, and `org.placesOf` is
  the one reader of the places, so a hidden roster row stays a Judge's.
- **h2:** the Followers tab's switch, kept per
  window in the sheet's `#ui.followersView`; the sheet takes six org actions
  by name, never `ORG_ACTIONS` whole, since its `hirelingShow` would replace
  the sheet's. Also four fixes to h1's output: Out at reads `placesOf`, a
  placed follower's name prints once, service-worded tooltips and refusals,
  and the rank line names the kind in words.
- **h3:** `tools/live/character-followers-views.mjs` and
  `docs/character-sheet/TESTING.md` "The Followers tab's views", on fixtures
  of its own, `character-sheet/followers-*`, so it never fights
  `lib-org-chart` over `henchmen/service-*`.

**Readings drawn as the session's pick, and built so:**
- (a) The pen is Open: a service row stores nothing an in-card form could
  write through, so editing a follower is its own sheet.
- (b) A lord's cards wear no role frame; board 1l's text gives the frame to
  the village.
- (c) A follower's Recall takes it off every roster and writes no group
  (`docs/lib/DECISIONS.md`, 2026-11-25).
- (d) The root's "henchmen" count is every lone direct follower, mercenaries
  and specialists included; its tooltip says so.

**The two items the hub deferred into S12b were found built.** The
champion's mint is the officer line's Make (`orgMakeLeader`, through the
`org-chart` service's `makeLeader`, with its tooltip), from the
officer-assign slice. The die beside bodies is `orgRollCount` in the card's
form, from (g) at `18fface1`. Neither was rebuilt.

**Offline only.** Suites as the agents and this session ran them:
test-org-tree 38, test-org-chart-ui 42, test-org 43, test-org-service 11,
test-character-sheet 109, test-service-nodes 12, test-lib 296, test-org-run
30, test-org-write 31, test-org-delete 10, test-org-chart-service 7,
test-group-faction 14. h1's mutation checks were all killed (14). A scratch
Handlebars render showed the faction and group sheets' partials
byte-identical to before.

**Not checked:** everything live. The real render, the tree's sideways
scroll inside the sheet's body, the Send out dialog, and a Player seat's
presses are the walk's.

**Findings, not fixed:**
- `chartContext` (the faction and group sheets) builds Out at from
  `rostersHolding`, which ignores a roster row's `hidden` mark, so a
  non-Judge can read where a hidden group stands.
- `org.recallHolder` takes a follower off a roster row a non-Judge cannot
  see; on a place the seat does not own it is refused before any write.
- With hired units and no hirelings, the Cards view shows its empty hint
  under the switch, since the cards list hirelings only.

### Start prompt, phase 2

Since this prompt was written, the owner's go-ahead on canvases 2 to 5
(Results) released S8b without T10, S9a and S9b-2, each after S8a and each
built from canvas 4 as approved. The prompt's sentence that holds S8 and
S9a is spent. T10 waits for `architect`. Phase 2 has run ("Phase 2",
Results); what it did not build is phase 2b's.

> Read `docs/monsters/wip/20261124-beastman-organisation-plan.md` whole, then
> `.claude/rules/ip-doctrine.md`, `docs/monsters/MODEL.md` ("The organisation
> axes") and `docs/lib/README.md`. This session starts on Opus, since it
> orchestrates and S7 crosses features. First, on `main` as fixes: ledger
> T-0713, an `implementer`, accepted when R6 grants the proficiency its
> paragraph names on every breed, R3's grant still lands, and no warning is
> logged; then T-0714, `architect` first, since what the table's die does
> beside "or by weapon" is a reading, then an `implementer` on its ruling.
> Each is walked by the "organisation axes" recipe in
> `docs/monsters/TESTING.md` before the next starts. Then open
> `topic/beastman-gear` with `acks-branch` and build, one agent per slice:
> S6a and S6b (`implementer`), S7 (`architect`, since it crosses lib, magic
> and equipment; its ruling is appended here before S8 or S9a is briefed),
> S9b and S9c (`implementer`). S8 and S9a are released only once the owner
> has answered canvas 4's questions (Design session, above); until then they
> are listed as held. Each brief quotes the owner's three sentences (section
> "The owner's words") and the slice's acceptance from section 3. Land each
> slice that needs a walk and walk it on `main`, on a lane no peer holds,
> without shutting the world down unasked. Append results here sorted as
> exercised live, offline only and not checked, correct the phase 3 prompt,
> and report every commit by sha and "not pushed". The book is
> `C:\Proj\acks-reference\Snips\MM_Beastmen.pdf` (LOCAL-ONLY).

### Start prompt, phase 2b

Phase 2 built S6a to S6c, S9c and S9b-1 ("Phase 2", Results). The owner's
go-ahead on canvases 2 to 5 released what it held. `topic/beastman-gear`
is landed and open.

> Read `docs/monsters/wip/20261124-beastman-organisation-plan.md` whole, then
> `.claude/rules/ip-doctrine.md`, `.claude/rules/ui-layout.md`,
> `docs/lib/README.md`, and both S7 rulings whole
> (`docs/monsters/wip/20261124-s7-ruling-reader-carrier.md`,
> `docs/monsters/wip/20261124-s7-ruling-consumers-gear.md`). This session
> starts on Opus: it orchestrates, and S8a crosses lib, magic and
> equipment. Run `acks-branch sync beastman-gear`, then build in its worktree,
> one agent per slice. First S8a, which has no UI: the range reader as a core
> Region with lib's `aura` behaviour sub-type, the item carrier beside the
> cast engine, the `Item#use` seam, and the kind reader. If the ruling leaves
> a choice open, `architect` decides it before the `implementer` builds.
> The sub-type enters `module.json` and needs a world relaunch: find out who
> is seated and ask before the relaunch. Then build S8b without T10, S9a
> and S9b-2 (each `implementer`) from canvas 4 as approved ("The owner's
> go-ahead on canvases 2 to 5", Results; boards 4a to 4d). E5 counts no swig
> on its first bearer, which is the page's answer (a). T10 waits for
> `architect` (S7's addendum A5) and is not built. Each brief quotes the
> owner's three sentences and the slice's acceptance from section 3, and
> the agent restates them with one example before building. Phase 2's live
> facts are in its Results entry: tables re-imported after a recipe change,
> an active combat for turn edges, a weapon given to a generated creature.
> Land each slice and walk it on `main` on a lane no peer holds. Append
> results here, sorted as exercised live, offline only and not checked, and
> report every commit by sha and "not pushed". The book is
> `C:\Proj\acks-reference\Snips\MM_Beastmen.pdf` (LOCAL-ONLY).

### Start prompt, phase 3b

Phase 3 built, landed and walked S10a to S11c ("Phase 3", Results). What is
left of phase 3 is S12, S12b and S4b, all released, and nothing is held.
Integration turns (a land and its walk on `main`) are granted one at a time
by the release hub: send it "ready to land <slice>" with a clean worktree,
wait for "your turn", then send "turn released" with the sha and each walk's
summary line.

> Read `docs/monsters/wip/20261124-beastman-organisation-plan.md` whole, then
> `.claude/rules/ip-doctrine.md`, `.claude/rules/ui-layout.md`,
> `.claude/rules/ui-tooltips.md`, `docs/lib/ORGANISATION.md`,
> `docs/lib/GROUPS.md`, `docs/monsters/MODEL.md` ("The organisation roll")
> and `docs/factions/MODEL.md`. This session starts on Opus, since it
> orchestrates. The shape is "Architect, consolidated" (rulings 1, 5 and 6)
> as changed by "The owner's corrections, and the audit", which wins
> wherever the two differ. Each brief quotes the owner's three sentences, the
> governing lines of those entries and the slice's acceptance from section
> 3, and the agent restates them with one example before building. Before
> adding a field, an agent names what it read in the book, in Foundry core,
> in the `acks` system and in the repo's shipped code. Run
> `acks-branch sync beastman-organisation` (lib `apiVersion` is 75 on
> `main`), then build in its worktree, one `implementer` per slice:
>
> - **S12** from canvas 1: the tree from board 1f, the Locations rows from 1i,
>   a card's controls from 1n, the sheet at its width from 1c, the narrow
>   window from 1d, a stack that is another creature from 1j. Read every
>   board without re-roll, pin or confirm. The saved copies, with a README
>   naming which board wins, are in `main`'s gitignored
>   `aia-tmp/20261125-canvas1/`; they are scratch, not doctrine. S12 drives
>   S11b's shipped API and invents no second path: `rollOrganisation({host,
>   rowKey})`, `org.addRow`, `planEdit` and `org.deleteRow`. Its brief carries
>   three findings that are S12's: lib re-exports `orgChartView` and exposes
>   `readHolder` (S12b needs both); hidden rows are not filtered for players;
>   the faction sheet's member list still reads `members`. The p. 56 plate
>   arrives by a register row of its own.
> - **S12b** from board 1l: the Followers tab's views over `serviceNodes`,
>   where a hired unit's officer heads its unit's row.
> - **S4b** from canvas 3 (`aia-tmp/20261125-canvas3/`, its README says what
>   to ignore).
>
> A peer, phase 2b, writes the group sheet's stack-row press on
> `topic/beastman-gear`. S12 edits `templates/lib/group-sheet.hbs` and
> `apps/group-sheet.mjs` too, so keep hunks small and say so to the hub.
> Live facts this phase learned, besides phase 2's:
>
> - The active GM is the seated Judge whose user sorts first (lane A, then C,
>   then B). Group combat and the primary-GM sweeps run on its client. Walk
>   anything that needs them on lane A, and read `game.users.activeGM` in the
>   same call as the measure. Lanes B and C need `FIXTURE_OWN`.
> - The empty-location prune (T-0780) runs on a newly elected primary GM's
>   client seconds after ready. Every location a walk builds or keeps carries
>   a `system.gmNotes`.
> - A press that writes two documents (join, leave, send out) redraws its
>   line on the first write. A walk waits on the second document and on the
>   notice.
> - A monster's `system.initiative.value` is derived from `.mod`, so a
>   fixture writes `.mod`. A walk's combat is activated, or the system's roll
>   timer misses it.
> - validate reads a template-literal lang prefix as a literal key, so a
>   lang root is bound as a constant (`ORG_LANG_PREFIX`).
> - An empty land log is a running land; read the lease before calling it
>   dead.
>
> Kept fixtures and their markers are listed in "Phase 3", Results. S12's
> marker is `lib/beastman-warband`, S4b's `monsters/beastman-recipe`. Land
> and walk each on `main` in the hub's turn, then append results here sorted
> as exercised live, offline only and not checked. Write the phase 4 prompt
> (S13, then S14 from canvas 2 on "The owner's go-ahead on canvases 2 to
> 5"), and report every commit by sha and "not pushed". The book is
> `C:\Proj\acks-reference\Snips\MM_Beastmen.pdf` (LOCAL-ONLY).
