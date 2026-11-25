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
| **Immunities / resistances / susceptibilities** | extras | `.defenses.{immunities,resistances,susceptibilities}` = `{damage:Set, effects:Set, conditions:Set, mundane, extraordinary, silverFlaw, note}`; a susceptibility also carries `factor` (the multiple of damage it takes) and `save` (its saving-throw modifier), blank until read from the creature's entry or typed on the sheet's Defenses tab, where a blank one's tooltip is the creature's page reference. `silverFlaw` is RR ch.6's common flaw — silver counts as magic against this defence — and rides immunities and resistances only, never a susceptibility. The import reads all of it (`docs/importer/MODEL.md`, "Defenses"); `lib/defenses.mjs` applies it (`docs/lib/MODEL.md`, "Damage against defenses"). |
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

## The encounter recipe

`extras.encounter.recipe` is a list of parts saying what a group of this
creature is made of. The importer writes it, at the same two places
`extras.encounter` travels: the imported creature, and the variant option of a
family template. `scripts/importer/ecology-recipe.mjs` reads the creature's
Combat and Ecology paragraphs and its parsed encounter lines; shipped locators
find each structure, and every figure and every creature word is the page's.
The evaluator that rolls a recipe into stacks, and the Judge's editor for it,
are later slices (`docs/monsters/wip/20261124-beastman-organisation-plan.md`,
S11 and S4b; the design is `docs/lib/wip/20261031-encounter-group.md`, §3d).

A part carries `key`, `label` (the word as printed), `role`, `source`, `count`,
`chance` (percent; null for always), `when`, `branch`, `moraleWhileAlive`,
`cite` (the page) and `basis`.

- `source` is the creature the part is made of: `templateCell` names a Role
  cell of the family template (`variant|role`, never a copy of its figures),
  `name` a creature as printed, and `uuid` and `stat` are for a Judge's own
  part. The variant is the key the family files the creature under; an entry in
  no family takes the key `mintLeaderTemplate` files its own leaders under.
- `count` is `dice` or `literal`. A share of another part is `ratioOf` with
  `percent` and `round`: `ratioOf` is a part's key, or `unit`, a share of the
  units the sentence names counted in whole units (the gangs of a warband, the
  warbands of a lair or village), rounded as printed. `perUnit` names the unit
  a count is rolled once for.
- `when.units` are the unit words the part applies to, as the stat block's
  lines print them; `state` and `place` are set only where a line fixes them.
- Parts of one `branch.group` are alternatives. `band` names a die's share
  where a page prints one, and no reader invents it.
- `basis` is `page` for everything the reader writes. `table` is for a part
  that cites a printed table, which is the evaluator's to choose over the page
  and never a correction of it.

| Part | Role | Reads |
|---|---|---|
| `archers`, `warriors` | `body` | each share (`ratioOf: unit`) of the gangs or warbands the sentence names, in whole units, with its printed rounding |
| `leader-<role>` | `leader` | the rank that leads each unit and how many; the chieftain's part carries `moraleWhileAlive`, the printed bonus while that rank lives |
| `dependant-drudge`, `dependant-whelp` | `dependant` | each share of the warriors; the rounding stays blank where the page prints none |
| `guard-<n>` | `guard` | a village guard's chance, dice and creature; beasts joined by "or" share one `branch.group` |
| `chieftain-guard` | `guard` | the chieftain's escort, pointing at the Role cell the page says it is equivalent to |
| `captives` | `captive` | chance and dice per unit |
| `caster-shaman`, `caster-witchDoctor` | `caster` | each caster's chance, pointing at the Role cell that holds its level die |
| `size-<place>-<state>` | `body` or `unit` | what each side of the encounter lines counts: bodies, or the unit it counts and how many |

A sentence no locator reads adds no part, and a failed read is no recipe: the
import goes on. A creature whose prose yields no part has no recipe, and the
size parts join only a recipe the prose started. A morale sentence with no
leader part to carry it adds nothing. Any creature whose pages state the same
structures gets the same read, so the recipe is not limited to one family.

A whole repair writes the recipe it reads. Where the page no longer yields one
and the document holds parts, the build writes an empty list, since an update
merges and would otherwise leave the old parts standing (`retractRecipe`). A
refill that rewrites only the stat leaves does not touch it. The extras schema
declares the field, so a sheet submit keeps the parts it does not render.
`tools/importer/check-ecology-recipe.mjs` reads the local Monstrous Manual
through the importer's path and reports the parts read per breed.

## Item flag metadata (`flags["acks-extras"]`)

Set via the "ACKS Monster" group injected into monster-owned item sheets
(`scripts/monsters/item-annotations.mjs`): the last group of one tab, inside
the sheet's scrolling body, so it shows on no other tab. A weapon or item opens
on the extras item sheet, which takes it in the Details panel (the body's end
when the sheet shows no tabs); an ability opens on the abilities sheet, which
takes it in the Description tab, where an ability's properties that are not
rolls live. The system's own item sheet, picked by hand, takes it in its
`details` part.

- **weapon**: `naturalWeapon` (enum) is the one flag. Its damage type and extraordinary
  mark are core's own fields, `system.damage.base.types` and
  `system.damage.base.extraordinary`, which core's attack roll reads; the group's
  Damage Type select and Extraordinary checkbox edit those through `item.update`
  and write no flag. The select shows the weapon's own first type and names no
  fallback, so it shows what it writes; a pick replaces the whole set and a blank
  pick clears it. The monster sheet's attack rows read the same fields through
  `lib/damage-type.mjs` `damageTypeOf`, which answers core's types alone: a weapon
  with none shows a blank type.
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
api.config;                // all enum tables (MONSTER_TYPES, SIZES, …)
api.FLAG_EXTRAS;           // "extras"
```

Read raw: `actor.getFlag("acks-extras", "extras")`.

## Enums

All enumerations live in `scripts/monsters/config.mjs` (pure data, English
labels: MM ch. 1 Monster Overview, Monster Creation and Monster Rules). A row
carries its label and no printed figure; the tables the sheet reads figures
from are imported.

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
no form shows; a click goes to Classification, and the glyph's tooltip names the
form, or the field's provenance where none shows), the Hit Dice rating before
the name (`hdRating`, falling back to core's roll formula), the name field,
an in-service chip naming the employer while `system.retainer` names one (a
click goes to Service; a dot on it says a calamity's loyalty throw is owed),
and the XP award as a plain reading in the bar's place.

**The rails.** Left: the reaction roll, then the five saves with their
targets (a click rolls through the system's `rollSave`, resolving `blast` and
`implements` onto the `breath` and `wand` keys the system stores). Right:
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
**Figures** rule holding the core fields the system's own header shows:
hit points, armour class, attack throw, morale, initiative, surprise, XP
award, alignment, movement base and details. The senses and the speed rows
have their + chip and bin on the rule. Loyalty and the wage live on Service
alone, which holds core's retainer fields and the manager picker, and under
them, while the actor serves, the henchmen feature's Service panel
([henchmen MODEL](../henchmen/MODEL.md) §4d) with its actions bound to this
sheet's `service*` and `toggleCompensated` handlers. The number appearing
stays on Ecology, mirrored into core's `appearing.d/.w` on submit.

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

### A figure the import left unread

An adventure creature whose picture read left a figure unread
(docs/importer/MODEL.md, "The Judges Journal's scenarios") holds core's value
for it, and the actor's `flags["acks-extras"].extras.derived.unread`
(`MonsterExtras`, `[{path, held, cite}]`) names it with the value core gave it
and the page reference. In `_prepareContext` the sheet calls `blankedFigures`
(`monsters/unread-figures.mjs`) with that list and a reader of the actor's
paths, which answers each figure whose actor still holds `held`, with its
`cite`, then `blankUnreadRows` over `statblockColumns`' columns. A blanked row
draws no figure (`value` and, on the hit dice row, `line`, empty), takes the
`cite` alone as its tooltip (`valueTip`) and is marked `blank`. The rows are
the five saves, morale, the attack rows, the hit points row and the hit dice
row; the attacks group's note goes with an unread attack throw and the hit
points group's with unread hit dice. Once a Judge changes a figure it no
longer equals `held` and draws as any figure. Armour class, movement and
experience are listed too and no row draws them blank; the rails, the band and
Classification still show core's value. A creature with no list is untouched.

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

**The family's picture.** The template's picture is the art its overview
entry reads, or none: a variant's portrait is that option's, never the
template's. An overview whose picture has a shape the kind's pick criteria
refuse widens them in its register row (`assists.artSelect`); the pick is by
size, never by an image's name, which differs from one read of a page to the
next. Each variant option keeps its own portrait. A repair in place writes the
family's picture, or the type's default where the family prints none, over
whatever the library's copy holds; a template held outside the library gives
way only where it holds a variant's portrait. A picture whose read failed
leaves the held one as it is. An art file already uploaded under the entry's
id is reused, not read again. The picture shows in the compendium list; the
template's sheet draws none.

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

**The body forms** are the Monster Body Form table (MM Monster Creation p.
389), imported into the same `monsters` document as table `bodyForms`: one row
per form, `{label, example}`, the key minted from the printed name by the
importer's `gridRows` `keyByLabel` (so the table names no form in source) and
the sample monsters beside it as the row's `example`. The columns past the
samples are not read. `scripts/monsters/body-forms.mjs` reads them:
`bodyFormRows()` in table order, `bodyFormOrigin()` (imported with its page,
the Judge's override, or missing) and `bodyFormView(stored, loc)`, which gives
the Classification tab's Body Form select its options (`name — sample
monsters`) and its tooltip, and the band its form's name. `bodyForm` in the
extras schema is a plain string, so any stored key survives validation. A
stored key the table does not hold gets an option of its own showing the raw
key, so a submit from another field cannot erase it; the band names no form for
it and wears the paw. With nothing imported the select is blank and `disabled`,
its tooltip is the page reference alone, and the stored key is untouched: a
disabled field is left out of the form data, and `_prepareSubmitData` merges
the submit over the stored flag. The Judge edits the list in the Ruledata
Browser, where an override replaces the table whole. The band's glyph map
(`statblock.mjs` `BODY_FORM_ICONS`) is keyed by `printKey` of the form's key,
the hash of its folded letters, so it names no form either.

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

**Natural weapons and extraordinary damage.** Two more `monsters` tables, from
the Damage entry of the Monster Overview (MM p. 12), read by
`scripts/monsters/natural-weapons.mjs`. `naturalWeaponDamage` is one row per
damage type the page files natural weapons under (keyed by `DAMAGE_TYPES`),
each holding the list of weapon words (`weapons`); `naturalWeaponDamageMap()`
folds it to weapon word against type, and a weapon key of
`lib/vocab.mjs` `NATURAL_WEAPONS` takes the type of the word that equals it.
`NATURAL_WEAPONS` itself carries keys and labels only, so a weapon the page does
not list (and a key the module adds beside the printed ones) has no type.
`extraordinaryRule` holds the rule's three edges: `animalHd` and `otherHd`
(`{count, bonus}`, the hit dice a monster must exceed) and `animalSize` (the
size category an animal must reach); `extraordinaryEdges()` answers each as
read or null. Which types each rule covers is the importer's procedure
(`stats-map.mjs` `extraordinaryNatural`). The Judge edits both tables in the
Ruledata Browser like any imported table, and the override wins. Without them
an imported natural attack carries the damage type its stat block's icon
names, or none, and writes no extraordinary mark where the monster's type
needs an edge, which the sheet reads as unticked; an incarnation, an enchanted
creature and a humanoid are decided without any edge.

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
keeps `carried` (`"carried"` or `"multiplied"`) and `bonusFactor`, which the
tooltip names. AC and the damage total add
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
modifier the re-read no longer finds (`REFILL_STAT_PATHS`). The Statblock's
attack tag shows the die, the modifier and the weapon's own damage bonus
together (what core adds to the roll) and its tooltip names each part. A
leader generated from the leader table gives the marker a die of its own
("The organisation axes", step 1).

**Repair.** A family is built only by its importer; a repair in place
(`withRewrite`) runs that build and writes it over the held template whole,
carrying over the variants another book merged into it. A held variant that is
the family's own overview, which the build reads as its description, is never
carried back. The template a family merges into, rewrites or puts back is the
library's: a copy dragged out of the library (`isWorldCopy`) is never found by
the lookup (`importedActorsOfType`) and never written, so it keeps the shape it
was copied with.

**The organisation tables**, in registry document `monsters` (MM pp. 54-55, 57;
`scripts/monsters/organisation.mjs` `importedOrganisation`): `beastmanVillage`,
the village makeup, a row per kind of inhabitant with a cell of printed text per
breed; `beastmanLeaders`, the leader grades, a row per rank with a cell per
breed holding the armour class, the armour words, the Hit Dice, the hit points,
the damage die and the modifier a weapon adds (`{ac, armour, hd, hp, die,
dmg}`, `dmg` null where none is printed); `beastmanSpecialTroops` and
`beastmanTraits`, a row per troop role or trait with, per breed, the band of
the die roll that picks it, `{min, max}` of whole numbers (a single printed
value is both). The leader table is a distinct, tougher and better-armed grade
than the breed pages' own leaders and does not replace them. No row or breed is
named in the recipe: row keys are the slug of the printed label (`keyByLabel`),
the label kept as the row's `label`, and column keys are the slugs of the
printed header words (`headerColumns`), which are the family template's Variant
option keys (the family's overview variant has no column). A breed the page
prints a dash for, or no cell, is **null** on its row, never an absent key or a
zero. The reader returns each table's rows in print order and its page for
`citeOf`; a table not imported reads no rows and no page, and a Judge's
override of a table, which wins, reads its own rows and no page. A cell that
does not read whole is null. The Judge edits any table in the Ruledata Browser.
The importer's mechanic is in `docs/importer/MODEL.md`.

**The paragraph tables**, in the same document (MM pp. 47, 54-57): the figures
the section's prose prints, read from the Judge's own copy so the standing
figures, the gated, ranged and activated parts and the organisation generator
read them and never a constant. Each is a row per paragraph, `{label, ...figures}`
(`importedOrganisation()` returns `{key, label, figures}`), and a figure the
paragraph does not print is an absent key, never a zero; a row whose paragraph
the page lacks holds its label alone. Rows sit under keys the page's tables
already mint, so no troop, trait or item name is in source:

- `beastmanTroopRules` (MM p. 55): a row per row of `beastmanSpecialTroops`, under
  its key. Fields: `attack`, `vulnerableAttack`, `initiative`, `avoidSurprise`,
  `opponentSurprise` (bonuses read with their sign), `acReduction`,
  `targetCondition` and `targetBand` (the words the vulnerable-target figures
  wait on, as printed), `waivesCharge` and `waivesRun` (a movement's word where
  the paragraph waives its Armor Class loss; its presence is what is read),
  `armourBump`, `damageDiceTimes`, `overrunPenaltyCut`, `opponentSave`,
  `xpAbilities` (the special-ability count counted for XP), `proficiency` (the
  words printed beside "as the proficiency", for a consumer to fold against a
  proficiency name), `carry` (`{equipmentKey: percent}`, the keys
  `beastmanEquipment`'s), and, on the mounted role, `mounts` and `alongside`
  (`{breedKey: creature text as printed}`; a breed that rides no creature is
  absent from `mounts`).
- `beastmanEquipment` (MM pp. 55-57): a row per optional equipment paragraph,
  keyed by `slugLabel` of its run-in heading. Who may carry: `ranks` (role
  keys), `troops` (`beastmanSpecialTroops` keys), `kinds` (unit kinds);
  `carry`, a list of `{pct, perHitDie?, scope?}` (`scope` one of gang, warband,
  village, lair, where the paragraph says "each"). Figures: `riderDice`,
  `wearerLevel`, `sizes` (`{breedKey: size}`), `blast` (a list of `{lb, dice,
  radius}`), `throw`, `fuseDice`, `fumble`, `saveKind`, `saveMod`,
  `saveFraction`, `radius`, `damage`, `immunityTurns`, `condition`, `penalty`,
  `healDice`, `successHealDice`, `swigs`, `ac`, `reductionPerDie`,
  `delayTurns`, `bonus`; radii are feet and a turn count whole turns. A
  paragraph `hookedWeapon` reads its maneuver figures from carries `figuresFrom:
  "hookedWeapon"` and only who and how often; the figures are read there.
- `beastmanTraitRules` (MM p. 57): a row per row of `beastmanTraits`, under its
  key. Fields: `damage` (a bonus, or `{breedKey: [printed die text per
  attack]}`), `attack`, `morale`, `armourBump`, `outnumber` (`[allies,
  opponents]`), `round`, `strategy`, `proficiency`, `proficiencyRanks`,
  `treasurePct`, `beastDice`, `saveKind`, `condition`, `immunityTurns`,
  `durationTurns`, `durationMinutes`, `outnumberedMorale` (the morale figure of
  a clause that prints no ratio), `targetCondition` (the word an attack bonus
  waits on) and `waivesRun`.
- `beastmanOrganisation` (MM pp. 47, 54, 55): one block per page, `split`
  (`archerShare`, `archerRound`, `warriorShare`, `warriorRound`, `specialShare`,
  `specialRound`: percentages and "up" or "down"; `moraleWhileChieftain`),
  `speech` (`commonWarrior`, `commonLeaderPerHd`: percentages) and `elite` (the
  sidebar: `wageExtra`, `wageEvery`, `wageMin` in gp, `battleAttack`, and
  `battleCite`, the Revised Rulebook page the sidebar points at, read as a
  citation `"RR p.N"` and not a figure). The reader returns them as one flat
  `{figures, cite}`, whether an override stores blocks or a flat map.

A condition or a save is read as the printed word (`condition`, `saveKind`,
lowercased) for the consumer to map to its own key. The reader drops a figure
that is not a plain number, text, list or map, and an override of any table wins
and reads no page. The importer's mechanic is `rowsFrom` in
`docs/importer/MODEL.md`.

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
  casters equivalent to them): it takes the row's move and morale, its armour
  class is the row's plus the leader's armour class over its warrior's (the
  leader cell's figure less the member's), and its damage modifier is the
  row's plus the leader's modifier over its warrior's (`memberDamage` on the
  leader's cell, the member's own modifier), written to both the melee and
  the missile modifier. A printed leader and a procedure-derived one alike
  keep their advantage.
- **Unarmoured**: the kind's natural armour class, plus that same difference
  for a leader. It changes the armour class alone. The natural figure is read
  from the world's table at generation (the cell names the kind), so a Judge's
  override counts without a rebuild, and a kind the table no longer holds
  keeps the stat block's armour class.

The figure written goes to `ac.value` and its parts to `extras.derived.kit`
(the base figure and where it came from, the leader's and the warrior's armour
class, the citation). A part missing (the member's armour class, a natural
armour class not imported) leaves the armour class the cells wrote.

The leader's damage modifier is a signed integer, so "over" is a subtraction,
and a sum that comes to none is a worked-out 0. Its parts go to
`extras.derived.kit.damage` (value, base, step, the leader's and the
warrior's). A part that is not a number (the row's, the leader's, or a warrior
the cell recorded none for) leaves the modifier null on both sides and records
`{missing: true}`: core's field is nullable and its attack path adds a null as
no modifier. A modifier a page does not print reads 0, so an unprinted figure
is an input and not a missing one. On
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
attack's die and the figure core adds to it (the creature's modifier and the
weapon's own damage bonus) where the table is imported and prints a cell for
the pair. A worked-out leader's damage tag names the modifier,
the row's figure, the leader's modifier over its warrior's, and the page; with
the modifier left blank the tag is the die alone and its tooltip the row's page. Each is shown only
while the actor still holds the figure, and a derived leader's tooltip stays
whole while its armour class and its damage modifier are the ones the kit
worked out from it.

**Merging.** A variant another book adds to a held template brings its kit
cells, and the held template gains the Kit axis where it had none
(`unionKitAxis`); a repair in place carries a kept variant's kit cells and the
axis with them, in the canonical order ("The organisation axes").

## The organisation axes

A beastman template (a family, or an entry's leader template) whose variants
are columns of the imported organisation tables gains three axes and a third
source of leaders (`scripts/importer/organisation-axes.mjs`, built after the
Kit axis from `importedOrganisation()`, "The organisation tables"). **The
canonical order** is Variant, Leader figures, Role, troop, Kit, trait, gear
(`orderAxes`); a build, a merge and a repair each restore it, and each unions
the axes a kept variant's cells are keyed by (`unionOrganisationAxes`: a
repair takes the rebuilt table's options, a merge widens them). A held template
with none of them gains them on the repair, since the build is whole.

- **Special troop** (`troop`): one option per row of `beastmanSpecialTroops`,
  its key the row's and its label the imported one, after a default, **No
  special troop**. It takes its bands from the registry by variant
  (`bandsFrom`, [../lib/API.md](../lib/API.md)) and names no die of its own, so
  a roll throws the one the variant's bands imply. An unpinned generation takes
  the default; a pin of Roll on the table (`ROLL_PIN`, one more entry in the
  builder's select on a banded axis that names a default) rolls it. A troop
  the variant has no band for is listed disabled. It reaches the rank and file
  and the leaders (a champion shares its gang's role); a caster, a dependant
  and a noncombatant take none of its figures.
- **Tribal trait** (`trait`): the same over `beastmanTraits`, default **No
  trait**, placed after the Kit axis. Every option carries a marker flag, since
  a trait with `variant|trait` cells would otherwise stand only where a cell
  matches.
- **Optional equipment** (`gear`): a multi axis keyed by the rows of
  `beastmanEquipment`, after the trait, with no bands. Who may carry a piece is
  the generator's carry roll (not built); a Judge's pin is the Judge's call.
- **Leader table** (`table`, the third option of Leader figures, labelled with
  the page): never the default, the breed page stays it. Its cells,
  `variant|role|table`, exist for each breed and rank `beastmanLeaders` holds a
  cell for, and mark variant and role only. The axis is added where the template
  had none (AXIOMS not imported), and so is the Role axis.
- **Natural attacks** (`variant|trait` cells): a trait whose table row lists a
  die per attack for each breed has a cell for each breed with a non-empty list,
  marking variant and trait.

**What generation writes.** The template carries structure and imported labels;
every figure is read at generation by the monsters feature's listener on the
template engine's resolved hook, in this order:

1. `applyGeneratedLeaderGrade`, **before the kit** (the kit reads the leader's
   armour class and damage modifier): a leader generated under a `table` cell
   takes the grade's armour class, hit points, Hit Dice rating and damage
   modifier as a printed leader's cell writes them (`leaderCell`: the throw and
   saves move from the variant's own block by the attack-throw ladder and the
   save rule). The armour words, the row's label, the modifier and the page go
   to `extras.derived.leader` (`source: "table"`); the role's XP stays the
   printed leader's. The cell's die is the leader's damage with its arms, the
   grade's modifier already in it, and it is recorded on
   `extras.organisation.grade` whatever follows. **Without a troop kit it
   becomes the formula of the by-weapon attack** (each weapon item whose
   formula is the bare marker, "The "by weapon" modifier"), keeping its damage
   types and extraordinary mark, and that item's own damage bonus takes back
   the grade's modifier, so core's addition of the actor's modifier nets to the
   die; the actor keeps the modifier, so a kit, a trait's damage and a natural
   attack read what they read for a printed leader. The die is read from the
   imported cell and never worked out from the modifier. A troop kit
   (`extras.kit` with a troop other than Unarmoured, set before the grade is
   applied) leaves the die recorded alone, since the kit states the leader's
   damage as a modifier over its troop row's; Unarmoured is no troop kit and
   keeps the die. A die that does not read whole as dice writes nothing, and no
   item is added where none holds the marker (`extras.derived.leader.die` names
   the die only when it was written). The Statblock's attack tag shows the die
   alone (or with a trait's figure), and its tooltip names the row, the page,
   the modifier and the take-back while the attack still holds the die and the
   take-back. A grade the table holds no cell for writes nothing.
2. `applyGeneratedKit` (above).
3. `applyGeneratedOrganisation`, **after the kit**. It **writes** only the
   standing figures: a troop's attack bonus (`attack.mod`, melee and missile),
   armour reduction and armour bump (`ac.value`, net), initiative
   (`initiative.mod`), avoid-surprise bonus (`surprise.avoidsurprise`) and
   proficiency grant; a trait's damage (both modifiers) and morale (held to the
   core field's range) where its row has no gate (`outnumber`, `round`,
   `condition`, `saveKind`, `targetCondition`, `outnumberedMorale`), its armour bump for a fighting rank, and, for a
   chieftain, its proficiency ranks; and a natural attack for each die a marked
   cell's list holds. A damage modifier left blank by the kit stays blank, an
   armour class that is not a figure is left alone, and a figure the table did
   not import writes nothing. A proficiency is granted as copies of the world's
   library ability whose folded name equals the folded printed word or, failing
   that, differs from it only by an English inflectional ending (`matchProficiency`:
   a stem of at least four letters plus one ending from a short fixed set, either
   way round) and does so for exactly one folded name; a miss or an ambiguity
   writes none and is logged.

**The gated figures ride on ability items.** For a fighting creature (a standard
rank, a champion, a sub-chieftain, a chieftain, and no noncombatant, caster or
dependant) the chosen troop and the chosen trait each mint at most one `ability`
item (`organisationAbility`), pushed onto `resolved.items` as a proficiency
grant is: named by the row's imported label, carrying the row's page
(`cookbook.cite`, which the attack card prints) and a cookbook id built from
the kind and the row key (`organisation.<kind>.<key>`, so a copy counts once),
its typed specs on `extras.effects`. A row that yields no spec mints none. The
specs are built from the recipe's VALUE keys, never from a row key, which is
minted from a printed label and cannot be branched on:

| Value key | Spec |
|---|---|
| `opponentSurprise` | the surprise part against the opposing side, ungated |
| `vulnerableAttack` | `attackThrow` under `allOf[targetCondition, rangeBand]` |
| `damageDiceTimes` | `damageDice` under the same `allOf` |
| `outnumber` with `attack`, `damage` | both under `outnumbering {ratio: a / b}` |
| `outnumberedMorale` | `morale` under `outnumbering {side: "against", strict: true}` |
| `round` with `attack` | `attackThrow` under `combatRound` |
| `targetCondition` with `attack` | `attackThrow` under `targetCondition` |
| `waivesCharge`, `waivesRun` | `acWaiver` for `charging`, `retreating` |

A trait row that carries more than one of the three gate keys gates its attack and
damage figures by all of them (`allOf`); a conjunction never applies where one
alone would not. A figure is a standing field or a gated spec, never both: a
troop's `attack` is the field, a trait's `attack` and `damage` under a gate are
specs (and the standing damage and morale are held back by every gate key the
row carries). `rangeBand` is melee plus the `targetBand` word where that word is
a range band; a ratio is stored `[a, b]` and written `a / b`. The surprise part
is ungated because the matrix asks a creature's gates with no context. The
waiver keys are structural: the charge is the catalogue's `charging`, and the
run is its `retreating`, the one state that moves at running speed and carries
the disorder through `implies`; `disordered` itself is never waived, so a bare
run toggled by hand, and a withdrawal made without declaring it, stay with the
Judge and are two lines in the notes (`organisation.kind.run`,
`organisation.kind.withdrawal`, with the page) wherever `waivesRun` is read.

**The fold.** A condition word is imported text (`targetCondition`, read
from the page by the recipe), and `matchCondition` folds it at generation: a
catalogue id answers itself, then an exact fold of an id or of a `/`-part of a
label, then `matchProficiency`'s inflection rule, which answers only for one
entry. The Judge's correction is the registry's override layer, which may
replace the word with a catalogue id. A word that does not fold, a band outside
the range bands, a ratio that is no pair of positive numbers and a gate word the
import did not read each write no spec and are listed on
`extras.organisation.unresolved` (`{kind, key, figure, word}`) and passed to
`warn`; an unresolved gate on one figure leaves that row's other, ungated
parts (the surprise part, the waiver) in place. The gates are read at the roll
(`roll-gates.mjs`), at the morale page (`influence/ability-effects.mjs`) and at
the Armor Class (`conditions.mjs`); see [../lib/API.md](../lib/API.md),
"Typed modifiers".

**Equipment** (`gearPayloads(gear, resolved, {fights})`) writes from a row's
figure keys and its `figuresFrom`, never its key, and only for a fighting
creature that was given a row: a creature with no equipment row stays stat-only,
a blank figure writes nothing, and a caster or dependant carries none of it.

| A row with | Writes |
|---|---|
| `reductionPerDie` | an ability item named by the row with a `damageReduction` spec `{perDie, value, gate: weaponMundane}`, read by `actorReductions` and staged at the Apply of a weapon hit |
| `ac` | a standing bump into `ac.value`, the `gear` part of `extras.derived.organisation.ac`, and `extras.derived.organisation.gear` (`[{label, cite}]`) for the hover |
| `riderDice` | an ability item with a `maneuverRider` spec `{maneuvers: [overrun, wrestling], dice}`, read by `damageRows` in `equipment/attack-mods.mjs` |
| `figuresFrom: hookedWeapon` | the module's `hooked` item flag on each melee weapon item (a missile weapon stays unflagged) |

The rider and the hooked part follow the equipment feature's `overlayManeuvers`
world setting, since both are parts of a manoeuvre: `damageRows` adds the rider
as a signed dice fragment, labelled with the carrier's name and page, only for a
manoeuvre declared with the attack (`acksLib: {maneuver}`), and `maneuverMods`
adds the hooked part to a disarm. A monster has no manoeuvre row on a weapon's
Rolls tab, so a manoeuvre on a generated creature is declared through the
attack call. The weapon's own damage on those manoeuvres is unchanged. The save
part of the hooked figures reaches the Rolls tab's tooltip only: no path rolls a
manoeuvre's save.

Everything else ranged, activated or generated (the rest of a row's figures) is
not applied: `extras.organisation` records the chosen troop, trait and gear with
each row's label, page and figures, and every piece is named with its page in
both prose channels, for the later slices to read. The parts of every figure
written go to `extras.derived.organisation` (the value, the base it moved from
and each source's part). Their tooltips (`derivationTips`) name the parts with
the actor's own numbers and the page, only while the actor still holds the
figure, and are unwound first, so the kit's and the leader's own tips stand
beside them.
