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
| **Spellcasting** | extras | `.spellcasting.{class,level,note}` (repertoire = core spell items + `system.spells` slots) |
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
- **ability**: `abilityCategory` (enum), `usage` (enum), `xpAsterisks` (optional)
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

## Source tab

A creature converted from another game's book carries the importer's whole
provenance record, and the sheet grows a **Source** tab to show it: the stat
block as printed, a row per converted field naming the rule it came from, a row
per axis the importer refused to fill and why, and anything its grammar did not
recognise. A hand-built monster has no such flag and no such tab.

The tab reads only — it recomputes nothing. The flag shape is the
`import-provenance` contract in [../lib/API.md](../lib/API.md); the vocabulary
that turns its keys into readable labels is `scripts/monsters/source-view.mjs`.

## Animal tab

Shown only on an `acks-extras.animal`, whose DEFAULT sheet this is. It carries
the two facts the mounted and vehicle rules ask of a beast and that no other
surface renders — `system.animal.training` and `system.animal.mountable` —
bound by `name` so the sheet's own submission writes them. An import that
supplied them is marked with the `.acksm-cat-tag` badge.

**Both the part and the nav entry are gated** (`#animalData`, mirroring the
Source tab): dropping only the nav entry would still render the part, and its
`system.animal.*` inputs would then submit that path against a plain monster,
whose schema has no such subtree.

What the beast CARRIES is deliberately absent here — it is edited on
Classification and drawn on Inventory. The data-side ruling behind that one
store is `docs/vehicles/DECISIONS.md`.
