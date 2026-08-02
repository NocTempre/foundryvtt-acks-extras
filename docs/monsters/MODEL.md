# Data Model & Storage Map

This module is **storage-only**. It reuses the ACKS `monster` actor and the
system's own item documents wherever they already fit, and stores only the
genuinely-new stat-block data in flags. Consumer modules read these to add
behavior.

## Where each stat-block line lives

| Stat block line | Storage | Path |
|---|---|---|
| Name / image | core | `name`, `img` |
| Armor Class | core | `system.aac.value` / `.mod` |
| Hit points (rolled) | core | `system.hp.hd` (formula), `.value`, `.max`, `.bhr` |
| Saving throws (values) | core | `system.saves.{paralysis,death,blast,implements,spell}.value` |
| Morale | core | `system.details.morale` |
| XP | core | `system.details.xp` |
| Alignment | core | `system.details.alignment` (Lawful/Neutral/Chaotic) |
| Treasure type / table | core | `system.details.treasure.type` / `.table` (RollTable link) |
| Number appearing (primary) | core (mirrored) | `system.details.appearing.d` / `.w` |
| Retainer / henchman | core | `system.retainer.{enabled,loyalty,wage,managerid,category,quantity}` |
| **Type(s) / sub-type** | extras | `flags.acks-monsters.extras.types` (Set) / `.subtype` |
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
| **Immunities / resistances / susceptibilities** | extras | `.defenses.{immunities,resistances,susceptibilities}` = `{damage:Set, mundane, extraordinary, effects, note}` |
| **Spellcasting** | extras | `.spellcasting.{class,level,note}` (repertoire = core spell items + `system.spells` slots) |
| **HD / save ranges** | extras | `.hd.countMax`, `.saveAs.levelMax` (e.g. hydra "5 to 12") |
| **Related stat lines** | extras | `.variants[]` = `{label, uuid}` |
| **Entry prose** | extras | `.description.{appearance,combat,ecology,encounterText,lore,notes}` |
| **Attacks** | items | `weapon` items (`system.damage`, `counter`) + flags below |
| **Proficiencies / special abilities** | items | `ability` items (`rollTarget`, `proficiencytype`) + flags below |
| **Spoils / harvestable parts** | items | `item` items (`weight6` = N/6 stone, `cost` = gp) + flags below |
| **Active effects** | core | actor `ActiveEffect`s |

## Item flag metadata (`flags["acks-monsters"]`)

Set via the "ACKS Monster" fieldset injected into monster-owned item sheets.

- **weapon**: `damageType` (enum), `extraordinary` (bool), `naturalWeapon` (enum)
- **ability**: `abilityCategory` (enum), `usage` (enum), `xpAsterisks` (optional)
- **item (spoil)**: `component` (bool), `researchEffects` (string[])

## Empty vs. 0

Every numeric extras field is nullable with `initial: null`. A blank input is
stored as `null` (unspecified) and is **never** coerced to `0` — so "morale 0"
and "lair 0%" (real values) are distinct from "not filled in". Number `<input>`s
submit `null` when empty via FormDataExtended.

## Consumer API

```js
const api = game.modules.get("acks-monsters").api; // also globalThis.acksMonsters
api.getExtras(actor);      // → MonsterExtras (typed view of the flag)
api.MonsterExtras;         // the DataModel class
api.config;                // all enum tables (MONSTER_TYPES, BODY_FORMS, …)
api.FLAG_EXTRAS;           // "extras"
```

Read raw: `actor.getFlag("acks-monsters", "extras")`.

## Enums

All enumerations live in `scripts/config.mjs` (pure data, English labels). See
`acks-rules/acks-monsters/RULES.md` for the rules behind them. The body-form table carries BME/CCF/
AC/training/lair metadata for downstream calculators.
