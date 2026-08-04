# Abilities — Design Model

Extends the core `ability` item — used for proficiencies, class powers, skills,
and monster abilities — with a structured, level-aware **effect model** and the
classification the ACKS books express, so an imported ability is a usable game
object (rollable, effect-bearing) even before its full prose is streamed.

- **Reuse**: the core `ability` item (name, description, proficiencytype,
  roll/rollType/rollTarget, requirements, save) and its sheet; the shared
  effect vocabulary + `LevelValue` + field-builders from **the `lib` subsystem**
  (`scripts/lib/vocab.mjs`, `fields.mjs` — a direct import, not a module dependency).
- **Extend**: `flags["acks-extras"].extras` — an `AbilityExtras` DataModel
  (blank numerics `null`, never 0): `category`, `general`, `repeatable`,
  `powerValue`, `deprecated`, `requires`, a `choice` branch, `effects[]` (the
  lib's typed primitives), and `defenses` (immunity/resistance/susceptibility).
- **Enhance**: an alternate ability sheet — Description, **Rolls**, **Mechanics**
  (Foundry's own Active Effects folded into the last of these).
- **Invent**: nothing the system provides is duplicated.

## Rolls are an inventory

The Rolls tab lists every throw the ability offers and is edited like one: add a
throw, delete a throw, open a throw. Opening it gives that throw a window of its
own, where its dice, its qualifier and its target are set — including the level
table, when the target is one, because a ladder is part of a target rather than
a second thing attached to it.

A target is read at the scale its roll declares: class level for most, rank for
the proficiencies the books rate by how many times they were taken. A shared
world item has no character to read against, so it shows the whole ladder.

`rollsOf()` reads the set and `writeRolls()` changes it — no other path does
either. Between them they keep two invariants: every throw has a unique key,
which is assigned once and never rewritten, and an emptied list stays empty
(core's own `roll` / `rollTarget` are reset to their initials, which is what the
fold in `rollsOf()` reads as "no roll").

Level tables are **internal** — the rungs live on the throw. Pointing several
abilities at one shared table is [ROADMAP.md](ROADMAP.md).
