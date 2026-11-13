# Data Model & Storage Map

This module is **storage-only**. It reuses the ACKS `monster` actor and the
system's own item documents wherever they already fit, and stores only the
genuinely-new stat-block data in flags. Consumer modules read these to add
behavior.

## Where each stat-block line lives

| Stat block line | Storage | Path |
|---|---|---|
| Name / image | core | `name`, `img` |
| Armor Class | core | `system.ac.value` / `.mod` (authored on the header; core's `computeAC()` hard-returns for non-character actors, so nothing carried on Inventory derives or changes it) |
| Hit points (rolled) | core | `system.hp.hd` (formula — rewritten from the Hit Dice rating on submit whenever the rating's count, die or bonus changes, via `lib/actor-read.mjs` `hdFormula`; the rating's dice button submits and calls core `rollHP`), `.value`, `.max`, `.bhr` |
| Saving throws (values) | core | `system.saves.{paralysis,death,blast,implements,spell}.value` |
| Morale | core | `system.details.morale` |
| XP | core | `system.details.xp` |
| Alignment | core | `system.details.alignment` (Lawful/Neutral/Chaotic) |
| Treasure type / table | core | `system.details.treasure.type` / `.table` (RollTable link) |
| Number appearing (primary) | core (mirrored) | `system.details.appearing.d` / `.w` |
| Retainer / henchman | core | `system.retainer.{enabled,loyalty,wage,managerid,category,quantity}` |
| **Type(s) / sub-type** | extras | `flags.acks-extras.extras.types` (Set) / `.subtype` |
| **Size / mass** | extras | `.size`, `.mass.{stone,lbs}` |
| **Body form** | extras | `.bodyForm` |
| **Hit Dice rating** | extras | `.hd.{count,bonus,asterisks,dieType}` |
| **Saves-as class/level** | extras | `.saveAs.{class,level}` |
| **Attributes** | extras | `.scores.{str,int,wis,dex,con,cha}` |
| **Speeds (multi-row)** | extras | `.speeds[]` = `{type,combat,run,hover}` |
| **Vision / senses** | extras | `.vision` (Set), `.lightlessRange`, `.otherSenses[]` |
| **Normal / max load** | extras | `.load.{normal,capacity}` |
| **Noncombatant** | extras | `.noncombatant` |
| **Secondary characteristics** | extras | `.secondary.*` (expeditionSpeed, supplyCost, trainingMonths, intelligence, trainingModifier, battleRating, lifespan, oviparous, reproduction, untrainedValue, trainedValue[]) |
| **Encounter (rich)** | extras | `.encounter.{lairChance, dungeon, wilderness}`; each context `{wandering, lair}`, each side `{noun, number, unit}` |
| **Immunities / resistances / susceptibilities** | extras | `.defenses.{immunities,resistances,susceptibilities}` = `{damage:Set, mundane, extraordinary, silverFlaw, effects, note}`. `silverFlaw` is RR ch.6's common flaw — silver counts as magic against this defence — and rides immunities and resistances only, never a susceptibility. |
| **Spellcasting** | extras + items | `.spellcasting.{class,level,note}`, read off the prose at import; the repertoire is `system.spells` slots plus embedded `spell` items — copies of the imported documents the prose names, or a draw to the slots (`docs/magic/MODEL.md`, Repertoires) — `usage`-flagged where the page prints a frequency beside the name |
| **HD / save ranges** | extras | `.hd.countMax`, `.saveAs.levelMax` (e.g. hydra "5 to 12") |
| **Related stat lines** | extras | `.variants[]` = `{label, uuid}` |
| **Entry prose** | extras | `.description.{appearance,combat,ecology,encounterText,lore,notes}` |
| **Attacks** | items | `weapon` items (`system.damage`, `counter`) + flags below |
| **Proficiencies / special abilities** | items | `ability` items (`rollTarget`, `proficiencytype`) + flags below |
| **Spoils / harvestable parts** | items | `item` items (`weight6` = N/6 stone, `cost` = gp) + flags below |
| **Active effects** | core | actor `ActiveEffect`s |

## Encounter lines

`scripts/lib/encounter-line.mjs` reads a printed line for both importers. A
side's `number` is a formula core's `Roll` takes; `unit` names what it counts
when that is not bodies, and is blank otherwise. A line of one side is wandering
only.

Core's `details.appearing.{d,w}` holds `appearingFormula` of the matching line:
the first side stating a count, blank when that count is in units. So a count of
units never reaches a roll: the follower card shows no die for it, the Statblock
reads it with its unit and offers no roll, and `sizeFromEcology` gives nothing.
The Ecology tab edits all three fields, and its submit keeps core's field in step
(`appearingChanges`).

Walking a unit to the bodies it holds is the recipe engine's, not built:
`docs/lib/wip/20261031-encounter-group.md`, §3d.

## Item flag metadata (`flags["acks-extras"]`)

Set via the "ACKS Monster" fieldset injected into monster-owned item sheets.

- **weapon**: `damageType` (enum), `extraordinary` (bool), `naturalWeapon` (enum)
- **ability**: `abilityCategory` (enum), `usage` (lib's `SPELL_LIKE_FREQ`, re-exported as `USAGE`), `xpAsterisks` (optional)
- **item (spoil)**: `component` (bool), `researchEffects` (string[])

## Empty vs. 0

Every numeric extras field is nullable with `initial: null`. A blank input is
stored as `null` (unspecified) and is **never** coerced to `0` — so "morale 0"
and "lair 0%" (real values) are distinct from "not filled in". Number `<input>`s
submit `null` when empty via FormDataExtended.

## Consumer API

```js
const api = game.modules.get("acks-extras").api.monsters; // also globalThis.acksExtras.monsters
api.getExtras(actor);      // → MonsterExtras (typed view of the flag)
api.MonsterExtras;         // the DataModel class
api.config;                // all enum tables (MONSTER_TYPES, BODY_FORMS, …)
api.FLAG_EXTRAS;           // "extras"
```

Read raw: `actor.getFlag("acks-extras", "extras")`.

## Enums

All enumerations live in `scripts/config.mjs` (pure data, English labels). See
`acks-rules/acks-monsters/RULES.md` for the rules behind them. The body-form table carries BME/CCF/
AC/training/lair metadata for downstream calculators.

## The sheet

`FullMonsterSheet` (`scripts/monsters/monster-sheet.mjs`) subclasses the
system's monster sheet and is drawn on the lib's frame — the band in the
header, the rails, the fold, the pins, the read-only seat and the rail menus
are docs/lib/MODEL.md, "The sheet frame". The system's own header and tab
parts are replaced by the frame's `band` and one `body` part that includes
the frame's partials and this feature's tab templates; the system's Spells
and Effects templates are included as partials of that body, so their
actions keep working while they sit inside the frame's panels. What the
monster's band and rails show is this feature's, decided on plain data in
`statblock.mjs` from a snapshot the sheet reads off the actor, and pinned
by `tools/test-monster-sheet.mjs`.

**The band** carries the body form's glyph (`BODY_FORM_ICONS`; the paw where
no form is set; a click goes to Classification), the Hit Dice rating before
the name (`hdRating`, falling back to core's roll formula), the name field,
an in-service chip naming the employer while `system.retainer` names one (a
click goes to Service; a dot on it says a calamity's loyalty throw is owed),
and the XP award as a plain reading in the bar's place.

**The rails.** Left: the reaction roll, then the five saves with their
targets (a click rolls through the system's `rollSave`, resolving `blast` and
`implements` onto the `breath` and `wand` keys a legacy actor stores). Right:
the heart (the current total inside, filled to the fraction, red at zero; a
Judge opens the hit-point tool, a player goes to Classification), the shield
with the armour class, the map with the speed row in force (a menu picks
another; `#ui.moveRow`), the fist with the attack throw (a click rolls it),
the eye with the lightless range (a menu lists every sense, read only), and
the group cell: ×N of this creature's tokens on the current scene, a click
selects them all and pans to the first; in service it is the handshake and
opens the employer instead.

**The art row** shows the portrait, the types · size · form · alignment as
an overline, the appearance prose (enriched; the pen on the tools rail turns
it into the editor, and it is edited HERE alone — the Description tab holds
the other channels, since two editors on one field would submit the name
twice) and the tags: alignment, size, lair chance, treasure type,
intelligence, saves-as. The tools rail: edit the appearance, change the
portrait, alignment and XP award (a prompt), ownership, the Source dialog
(only on an imported creature), Make Encounter (a Judge's alone; it opens a new
group holding this creature, `docs/lib/GROUPS.md`) and the system's Actor Tweaks.

**Statblock** is the first tab and the dashboard: three columns of
rule-headed groups. Saves, reactions (morale, loyalty in service, reaction,
initiative, surprise both ways) and encounter (the number appearing by side,
the lair chance, the treasure — drawn from the linked table) roll; attacks
roll the weapon item with its throw, damage and counter beside it; hit points
roll from the rating and the dice row posts; an ability with a throw rolls it
and one without posts its card. The third column reads: speeds, senses, the
load bar (`loadReading`: the normal-load tick, amber past it, red past the
maximum), the defence pills (immune · resist · susceptible) and, for a
caster, the slot pills with a chip to the Spells tab. Row ids are stable
strings (`statblock.mjs` header) because the pins are stored by id; the
folded card's bar shows the starred rows.

**Classification** is the pen for what the frame reads: the types as pills,
the identity fields, the rating (count and range, bonus, asterisks, die, the
roll formula core keeps in `system.hp.hd`), saves-as, the five save targets
with their roll glyphs, the normal and maximum load, the attributes, and the
**Figures** rule holding the core fields the system's header used to carry:
hit points, armour class, attack throw, morale, initiative, surprise, XP
award, alignment, movement base and details. The senses and the speed rows
have their + chip and bin on the rule. Loyalty and the wage live on Service
alone, which holds core's retainer fields and the manager picker, and under
them, while the actor serves, the henchmen feature's Service panel
([henchmen MODEL](../henchmen/MODEL.md) §4d) with its actions bound to this
sheet's `service*` and `toggleCompensated` handlers. The number appearing
stays on Ecology, mirrored into core's `appearing.d/.w` on submit as before.

**On the Follower Card.** A monster hired opens on the lib's card, and its
compact card on an employer's sheet reads the saves-as line in the saves row:
this feature answers the lib's `FOLLOWER_CARD_HOOK` (`module.mjs`) with
`ctx.savesAs` from the extras' `saveAs`, the class label and the level or
its range ([lib FOLLOWER-CARD](../lib/FOLLOWER-CARD.md), "What a feature
adds"). A creature with no saves-as class leaves the row to the stored
targets.

**Unlinked tokens.** The fold is a user flag keyed by the document id and
the pins are the actor's sheet flag, so every unlinked token of one actor
shares one fold state and one set of pins.

## Animal tab

Shown only on an `acks-extras.animal`, whose DEFAULT sheet this is. It carries
the two facts the mounted and vehicle rules ask of a beast and that no other
surface renders — `system.animal.training` and `system.animal.mountable` —
bound by `name` so the sheet's own submission writes them. An import that
supplied them is marked with the `.acksm-cat-tag` badge.

**The tab is gated in `_prepareTabs`** (`#animalData`), and the body renders
a panel only for a tab the strip holds, so a plain monster gets neither the
nav entry nor the section — whose `system.animal.*` inputs would otherwise
submit that path against a schema with no such subtree.

What the beast CARRIES is deliberately absent here — it is edited on
Classification and drawn on Inventory. The data-side ruling behind that one
store is `docs/vehicles/DECISIONS.md`.

## Family templates: the Role axis

A family template (`importFamily`) has a Variant axis of complete members and,
where a member's prose prints them, a **Role** axis: champion, sub-chieftain,
chieftain, shaman, witch doctor, drudge, whelp. `scripts/importer/leader-roles.mjs`
reads the sentences (shipped locators; every figure is the page's) into one
cell per variant×role, keyed `variant|role`; a role is on the axis only where
some variant has its cell.

**What a leader cell writes.** From its sentence: AC, the fixed hit points,
the Hit Dice rating (as `hp.hd` and as the extras `hd` the band shows), and the
damage bonus as a **total** on `system.damage.mod`, melee and missile alike (a
sentence with no damage clause totals 0, so the member's own modifier does not
leak onto a leader whose page drops it). From the member's own block, moved by
the procedure that relates them: the attack throw, the member's printed throw
moved by what the Judge's imported attack-throw ladder adds between the
member's row and the leader's (a hit-point bonus rounds the dice up a row; 1-1
and fractions are the rows below 1); the save class at the member's save
level moved by the levels the two ratings differ by (whole dice, less one for
a hit-point penalty, none below 1 HD), as the system's save rows and the
extras `saveAs`. XP is the role's own figure from the member's XP cell, read
whole at import ("N (role)" in either order); a role the cell does not list
writes none and keeps the member's.

**The attack-throw ladder** is the Monster HD column of RR ch. 6, Attack
Throws by Level and HD, imported with the rulebook's tables into the registry
document `monsters`, table `attackThrowByHd`, one row per ladder row
(`half`, `oneLess`, `hd1` …; a rating past the last row takes it, as the page
prints it open-ended). The Judge edits it in the Ruledata Browser like any
imported table, and the override wins. With no ladder in the world a leader
cell writes no throw, so the member's own stands, and a grid template row with
no printed throw keeps the actor's default; nothing is guessed. The same
ladder gives a grid row its throw where the row prints none.

**The size frontage** is the Frontage (5'-squares) line of the Monster Size
table (MM Overview p. 11), imported into registry document `monsters`, table
`sizeFrontage`: one row, `squares`, with a cell per size category (`small` …
`colossal`, the keys of `config.mjs` `SIZES`) holding the page's own text.
`scripts/monsters/sizes.mjs` `sizeSquares(key)` reads a cell as `{w, h}`
squares: the first printed pair, else a lone figure or fraction, each side held
to one square at the least (a body never occupies less than a token square).
The unit of that row's label, what one of its squares is worth in feet, is
read from the label itself into table `sizeSquare` (`squares: {feet}`, the
`squareFeet` label pattern of the importer's `gridRows`), and
`sizes.mjs` `sizeSquareFeet()` answers it. Two readers take them: the
battlemap's `footprintFeet`, which multiplies the one by the other
(`docs/battlemap/MODEL.md`, "Token sizing"), and the importer, which sets a
monster's prototype token to the squares. The Judge edits both in the Ruledata
Browser like any imported table, and the override wins. A world with no table,
an unread row, or a cell holding no figure answers null for that category, and
a world with no square answers null for every one, so the battlemap leaves the
token as it is and a monster is imported with Foundry's default token. The
weight, length and feet lines of the same table are not read.

**The load rule and the default score** are two more `monsters` tables, read
by `scripts/monsters/load-rule.mjs`. `loadRule` is the Normal Load entry (MM
p. 13): `maxMultiple`, the creature's maximum load as a multiple of its normal
load, and `speedShare`, the share of its speed it keeps above the normal load.
`defaultScore` (`score`) is the figure MM p. 349 starts every attribute at.
`loadRule()` and `defaultScore()` answer null for a figure that was not
imported or is no figure (a multiple at or below one, a share outside zero to
one, a score that is not a whole number above zero), and a Judge's override
layer wins. `loadStanding` places a load against the normal load and a ceiling,
which is the creature's own Max Load, else `maxMultiple` times its normal load;
the Inventory tab's `computeEncumbrance` and the Statblock bar's `loadReading`
both take it. With no ceiling a load past normal is Encumbered and never
Overloaded, the bar scales to the larger of the two loads, and the Statblock
note names no maximum. The Encumbered speed readout shows `speedShare` and shows
nothing where none is imported. A blank attribute stays blank on the Classification
tab and shows `defaultScore()` as its placeholder, or none.

**Provenance.** Each derived throw and save row stores its parts on the
generated actor (`extras.derived`: the figure written, the member's figure
and rating it moved from, the rating it moved to, the ladder rows between, the
ladder's citation, or `missing` where the ladder was not imported). The
Statblock's attack and save figures carry a tooltip naming them
(`derivationTips`), shown only while the actor still holds the figure written,
so a throw a Judge has since typed is not explained by parts it no longer
comes from.

**Derived leaders (the AXIOMS procedure).** Where the Judge has imported the
AXIOMS Compendium (book `axc`), the family pass also builds champion,
sub-chieftain and chieftain cells for every variant from the member's own
block (`derivedLeaderRoles`, `scripts/monsters/leader-derive.mjs`). Two
tables carry the procedure's content, both in registry document `monsters`:
`leaderLadder`, the column of Hit Dice ratings the procedure climbs (AXIOMS
44), and `leaderSteps`, how many rungs each role climbs, the Hit Dice the
member needs before its hit-point bonus carries, the factor a chieftain's
carried bonus is multiplied by (`bonusFactorChieftain`, read as a word), and
each role's armour and damage additions. The leader's rating is the member's
rung moved up by its role's step (a member whose rating is on no rung, or a
role that would climb past the last rung, gets no derived cell), the member's
hit-point bonus carried where the member qualifies: whole for a champion and a
sub-chieftain, for which the page prints no factor, and multiplied by the
imported factor for a chieftain (`BONUS_FACTOR_ROLES`). The leader record
keeps `carried` (`"carried"` or `"multiplied"`) and `bonusFactor`; a record
generated before the factor was kept says `"doubled"` and no factor, and its
tooltip names the factor its own two ratings imply. AC and the damage total add
the role's figures to the member's.
Throw and saves move by the attack-throw ladder and the save rule above, from
the member's figures to the derived rating. A derived leader's hit points are
not printed, so the cell carries `rollHp` and Generate rolls them from the
derived dice. A procedure missing any of its figures builds no derived cell:
half a procedure would write numbers no page prints. The rung printed as a
bare `N+` is read as `N+1`, as `hdOf` reads it (importer DECISIONS,
2026-11-04). The procedure does not reach
casters, drudges or whelps; those roles stay printed-only.

**Leader figures axis.** Where a variant has a printed leader and the
procedure also applies, the two are options of an axis `leaderSource`
("Leader figures"), placed before Role: **As printed** is the default and
**AXIOMS procedure** is the alternative, and the cells are keyed
`variant|role|source`. A variant whose page prints no leaders has only the
derived cells, keyed `variant|role`, so the procedure is the only source there:
with that variant pinned the builder leaves the axis off (an axis with at most
one option available is no choice, `axisOffersChoice` in
[../lib/API.md](../lib/API.md)), and the leader's tooltips name the procedure.
The Statblock's hit-point note names the
source: the printed page for a printed leader; for a derived one, the
member's rating, armour and damage, the role's additions, the rungs climbed,
whether the bonus carried whole or multiplied and by what factor, and the
AXIOMS citation. It names the
parts only while the actor still holds the derived armour and damage; once a
Judge has changed either, it says the figures were edited and keeps only the
citation. The rail's armour class cell names the leader's armour class alone
(`derivationTips` `acTip`): as printed with its page, or the member's figure
and the rank's addition with the AXIOMS citation, again only while the actor
holds it; a printed leader's cell records the armour class its sentence
prints (`extras.derived.leader.ac`) so the check has something to compare.

**Leaders outside a family.** A stat-block entry that is no family's member
gets a template of its own beside the creature when its prose prints a
leader, caster or dependant, or when the procedure is imported and the
creature's type is beastman (`entryLeaderTemplate`, minted by
`mintLeaderTemplate` in the importer). Its Variant axis holds the creature
alone, as its default, so the builder leaves that axis off; its Role axis and
cells, and the Leader figures axis where both sources apply, are built exactly
as a family member's. It is named for the creature with a "(leaders)" suffix
from the importer's lang, and answers for the cookbook id
`<entry id>.leaders` (`leaderTemplateId`), which no entry carries, with the
creature's id under `leadersOf`: the creature keeps its own id to itself, and
a family import never adopts the template as a family's. An entry whose page
names no leader, and a type the procedure does not build for, mint nothing.
The import, a Rebuild and a repair of the creature each write the template
held under that id over in place, or mint it where none is held.

**Casters** copy the cell of the rank they are "equivalent to" and add
`extras.spellcasting {class, levelDie}`. Generate rolls the level die
(`rollDice`, logged as `casterLevel`), and the magic listener takes that class
document's slots at that level and draws the repertoire. With no such class in
the world, the caster has no slots and the class word stays on the sheet.

**Dependants.** A line printing their figures gives a noncombatant cell (speed,
AC, hit points, morale, damage total 0, `extras.noncombatant`), which drops the
member's weapons (`dropItemTypes`), so it generates with no attack. "Drudges fight
as KIND" gives the named member's combat block whole (AC, hit points, rating,
throw, saves, damage total, morale, XP).

**Choosing.** The axis's `default` is Standard: an unpinned role generates the
rank and file and a leader appears only when picked. A role with no cell for
the chosen variant is unavailable — listed disabled on the builder, never
rolled, and a stale pin of it falls back to Standard (`optionAvailable`,
[../lib/API.md](../lib/API.md)).

**Members.** An overview member (named as the family is) whose every stat
field reads another member's page and box is the family's description, not a
variant: its prose becomes the template's own description
(`overviewIsLore`). In the MM this drops the generic Beastman (a bugbear's
block) and the generic Lycanthrope (a werebear's).

**The "by weapon" modifier** of every monster stat line moves at bind time out
of the weapon item's formula into `system.damage.mod`, where core adds it to
every melee and missile damage roll; the item keeps "By weapon". Every binder
that writes a monster does it: `bindMonster`, the legacy stat line
(`bindLegacyMonster`), the person block (`bindNpc`), and a grid template's row
and form cells (`templateOption`, `weaponsFromRoutine`). A die with its own
modifier ("1d6+1") is a natural attack's and keeps it. A refill clears a
modifier the re-read no longer finds (`REFILL_STAT_PATHS`). The Statblock's attack tag shows the die and the modifier together
and its tooltip names each part.

**Repair.** A family is built only by its importer; a repair in place
(`withRewrite`) runs that build and writes it over the held template whole,
carrying over the variants another book merged into it. A held variant that is
the family's own overview, which the build reads as its description, is never
carried back. The template a family merges into, rewrites or puts back is the
library's: a copy dragged out of the library (`isWorldCopy`) is never found by
the lookup (`importedActorsOfType`) and never written, so it keeps the shape it
was copied with.

## The Kit axis

A beastman template (a family, or an entry's leader template) gains a **Kit**
axis where the Judge's tables hold its kinds' troop rows
(`kitPresets`, `scripts/importer/kit-presets.mjs`). It is built after the Role
axis and chosen last; its default, **Stat block**, is the member as printed,
so nothing changes until a kit is picked.

**The tables**, all in registry document `monsters`
(`scripts/monsters/kits.mjs` `importedKits`): `beastmanTroops`, RR ch. 9
Beastman Troops, one row per troop type per kind with its armour class, move,
Hit Dice, damage cell and morale, and the kit's own words read off the label's
brackets; `beastmenByType`, AXIOMS 2 Beastmen by Type, each kind's natural
armour class; `damageDieConversion`, the same issue's conversion of a weapon's
die and a damage modifier to another die, its header row read as a row so
each column's modifier is the page's. Mounted troop rows (a rider's and its
mount's figures in pairs) are not read. The AXIOMS move, encumbrance and
damage columns are not read either: the Monstrous Manual prints each kind's.

**What a troop row writes.** A row stands for a variant only where the variant
is the row's kind (its option key) and its Hit Dice rating is the row's, so a
row read under the wrong heading dresses nobody. For the rank and file
(`variant|standard|kit`, or `variant|kit` on a template with no Role axis) the
cell writes stat cells only, never an item: the row's armour class, its damage
as the total on `system.damage.mod`, its move as `system.movement.base`, and
its morale. The kit rides on `extras.kit`: the troop type, the kit's words,
the row's figures and its citation. The Full Monster Sheet's speed rows are
the stat block's and are not rewritten.

**A kit no page prints a figure for** is worked out at generation, by the
monsters feature's listener on the template engine's resolved hook
(`applyGeneratedKit`, which calls the pure `kitArmourClass`); core's
`computeAC`, which returns early for a monster, is not wrapped. Two cases, both
cells carrying `extras.kit.compute`:

- **A leader in a troop's kit** (champion, sub-chieftain, chieftain, and the
  casters equivalent to them): its own damage total stands, it takes the row's
  move and morale, and its armour class is the row's plus the leader's armour
  class over its warrior's (the leader cell's figure less the member's), so a
  printed leader and a procedure-derived one alike keep their advantage.
- **Unarmoured**: the kind's natural armour class, plus that same difference
  for a leader. It changes the armour class alone. The natural figure is read
  from the world's table at generation (the cell names the kind), so a Judge's
  override counts without a rebuild, and a kind the table no longer holds
  keeps the stat block's armour class.

The figure written goes to `ac.value` and its parts to `extras.derived.kit`
(the base figure and where it came from, the leader's and the warrior's armour
class, the citation). A part missing (the member's armour class, a natural
armour class not imported) leaves the armour class the cells wrote. On
generation the kit's words are added to both prose channels, the biography
and the Full Monster Sheet's notes, with the row's citation.

**Availability.** Kit options carry no patch of their own, so a kit is offered
only where a cell matches the chosen variant and role (`optionAvailable`): a
kind that fields no bowmen is not offered them, and a dependant takes no kit.

**Tooltips.** The rail's armour class names the troop row for a printed kit,
or the parts and the row's or the natural table's citation for one worked out
(`derivationTips`, where a kit's armour class outranks the leader's own); the
morale row names the troop row; an attack's damage tag adds the troop row
where the modifier is the row's, and the die the conversion table makes of the
attack's die and the creature's modifier where the table is imported and
prints a cell for the pair. Each is shown only while the actor still holds
the figure.

**Merging.** A variant another book adds to a held template brings its kit
cells, and the held template gains the Kit axis where it had none
(`unionKitAxis`); a repair in place carries a kept variant's kit cells and the
axis with them, kept last.
