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
| [1](https://claude.ai/artifact/UGfWMFuhLm7hcLGMC3YhXb) | Generate window, organisation chart, re-roll, pin, edit, deploy, role frames and upgrade badges, affiliation and place, a stack that is another creature, views and tools, the overlap with followers, a roll with no faction card (boards 1a to 1m) | S12 |
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
so.

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
above stand as written. What it changed and added:

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
groups. Example: Generate makes Warband 1's group at the village's site with
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

### Start prompt, phase 2

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

### Start prompt, phase 3 — HELD

Held until both are true: the owner has accepted the re-rule of `architect`'s
A, C, F and G that the planning session records above as proposed, and has
answered question 2 of "The owner on the two cards" (a wandering warband or a
lair roll and a faction card of its own). Section 3's rows S10 to S12 are
rewritten on that ruling before this prompt runs.

> Read `docs/monsters/wip/20261124-beastman-organisation-plan.md` whole, then
> `.claude/rules/ip-doctrine.md`, `docs/monsters/MODEL.md` ("The encounter
> recipe", "The organisation axes"), `docs/lib/GROUPS.md` and
> `docs/factions/MODEL.md`. This session starts on Opus.
> `acks-branch sync beastman-organisation`, then build in its worktree, one
> `implementer` per slice, S10, S11, S11b, then S12 once canvas 1 is
> approved, and S4b once canvas 3 is answered; until then S4b is listed as
> held. S11's first requirement is section 4, answer 6,
> whose words the brief quotes from there: a recipe part, a village cell or a
> mount that names a creature outside the family holds a reference to that
> creature's entry, resolved at generation, and a generated unit includes it
> as that creature. Its acceptance is phase 1's census ("References
> to other creatures", Results, with the script and output on the rules
> shelf it names): every resolved row resolves, and every unresolved row
> stays a finding the Judge links by hand (board 1j). Each
> brief quotes the owner's three sentences and the slice's acceptance. Land
> and walk on `main` as in phase 1. Append results here, correct the phase 4
> prompt, and report.
