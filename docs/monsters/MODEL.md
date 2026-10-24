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
| **Encounter (rich)** | extras | `.encounter.{lairChance, dungeon, wilderness}` |
| **Immunities / resistances / susceptibilities** | extras | `.defenses.{immunities,resistances,susceptibilities}` = `{damage:Set, mundane, extraordinary, silverFlaw, effects, note}`. `silverFlaw` is RR ch.6's common flaw — silver counts as magic against this defence — and rides immunities and resistances only, never a susceptibility. |
| **Spellcasting** | extras + items | `.spellcasting.{class,level,note}`, read off the prose at import; the repertoire is `system.spells` slots plus embedded `spell` items — copies of the imported documents the prose names, or a draw to the slots (`docs/magic/MODEL.md`, Repertoires) — `usage`-flagged where the page prints a frequency beside the name |
| **HD / save ranges** | extras | `.hd.countMax`, `.saveAs.levelMax` (e.g. hydra "5 to 12") |
| **Related stat lines** | extras | `.variants[]` = `{label, uuid}` |
| **Entry prose** | extras | `.description.{appearance,combat,ecology,encounterText,lore,notes}` |
| **Attacks** | items | `weapon` items (`system.damage`, `counter`) + flags below |
| **Proficiencies / special abilities** | items | `ability` items (`rollTarget`, `proficiencytype`) + flags below |
| **Spoils / harvestable parts** | items | `item` items (`weight6` = N/6 stone, `cost` = gp) + flags below |
| **Active effects** | core | actor `ActiveEffect`s |

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
(only on an imported creature) and the system's Actor Tweaks.

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

## Source dialog

A creature converted from another game's book carries the importer's whole
provenance record, and the sheet's tools rail gains a **Source** tool that
opens it in a dialog: the stat block as printed, a row per converted field
naming the rule it came from, a row per axis the importer refused to fill and
why, and anything its grammar did not recognise. A hand-built monster has no
such flag and no such tool.

The dialog reads only — it recomputes nothing. The flag shape is the
`import-provenance` contract in [../lib/API.md](../lib/API.md); the vocabulary
that turns its keys into readable labels is `scripts/monsters/source-view.mjs`.

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
