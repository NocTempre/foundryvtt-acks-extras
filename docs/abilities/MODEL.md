# Abilities — Design Model

Extends the core `ability` item — used for proficiencies, class powers, skills,
and monster abilities — with a structured, level-aware **effect model** and the
classification the ACKS books express, so an imported ability is a usable game
object (rollable, effect-bearing) even before its full prose is streamed.

- **Reuse**: the core `ability` item (name, description, proficiencytype,
  roll/rollType/rollTarget, requirements, save) and its sheet; the shared
  effect vocabulary + `LevelValue` + field-builders from **acks-lib** (`requires`).
- **Extend**: `flags["acks-extras"].extras` — an `AbilityExtras` DataModel
  (blank numerics `null`, never 0): `category`, `general`, `repeatable`,
  `powerValue`, `deprecated`, `requires`, a `choice` branch, `effects[]` (the
  acks-lib typed primitives), and `defenses` (immunity/resistance/susceptibility).
- **Enhance**: an alternate ability sheet with an Effects tab (pending).
- **Invent**: nothing the system provides is duplicated.
