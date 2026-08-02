# Abilities — Design Model

Extends the core `ability` item — used for proficiencies, class powers, skills,
and monster abilities — with a structured, level-aware **effect model** and the
classification the ACKS books express, so an imported ability is a usable game
object (rollable, effect-bearing) even before its full prose is streamed.

- **Reuse**: the core `ability` item (name, description, proficiencytype,
  roll/rollType/rollTarget, requirements, save) and its sheet; the shared
  effect vocabulary + `LevelValue` + field-builders from **acks-lib** (`requires`).
- **Extend**: `flags["acks-abilities"].extras` — an `AbilityExtras` DataModel
  (blank numerics `null`, never 0): `category`, `general`, `repeatable`,
  `powerValue`, `deprecated`, `requires`, a `choice` branch, `effects[]` (the
  acks-lib typed primitives), and `defenses` (immunity/resistance/susceptibility).
- **Enhance**: an alternate ability sheet with an Effects tab (pending).
- **Invent**: nothing the system provides is duplicated.

## Decisions

- **2026-07-18 — flag-stored model, not a document sub-type** (mirrors
  acks-monsters): reuse the system's own `ability` item, add data via a flag
  DataModel + alternate sheet. Nothing mutates the acks system.
- **Effect vocabulary lives in acks-lib**, imported sibling-relative
  (`../../acks-lib/scripts/fields.mjs`) so it is one definition across the
  family. immunity/sense/movement/naturalAttack shapes are shared with the
  (deferred) monster migration.
- **Ownership is never stored here.** Which class or monster HAS an ability is
  defined by the container (a class/monster item lists its abilities), per the
  register model — the ability node is a reusable definition. `general` (the
  "(G)" marker) is the one membership fact tracked, because it is intrinsic.
- **Binding target for acks-content:** on import it writes this flag; the full
  literal prose stays a lazy `@PdfText` descriptor, the mechanical effect
  materializes per seat and persists here.
- **2026-07-24 — this module owns core's ability roll path.** `AcksItem#rollFormula`
  is the system's ability roller and can only ever make **one** roll: it reads
  `system.roll` / `system.rollType` / `system.rollTarget` directly. So every
  route into it — the proficiency row on the character sheet, the chat card's
  Roll button, `item.use()`, a hotbar macro — reached only an ability's *first*
  throw, while the Rolls tab showed all of them. That is one ability rolling two
  different ways depending on where you clicked.

  `scripts/roll-wrap.mjs` wraps `#rollFormula` and `#getTags` (lib-wrapper,
  MIXED) and routes `ability` items to `rollAbility()`. Other item types fall
  through untouched.

  **One owner per wrapped core method: these two are ours.** Multi-roll
  abilities are this module's domain, so the wrap lives here rather than in
  acks-lib. No sibling may wrap them; anything else that needs to influence an
  ability roll goes through the API (`rollsOf`, `rollAbility`, `targetOf`).

  A no-roll ability now **shows** itself instead of rolling. Core intends this
  already — `use()` has a "no roll, so show it" branch — but it tests
  `system.roll`, which defaults to the string `"1d20"` and is therefore always
  truthy, so a proficiency that makes no throw still posted a d20 scored
  against a target of 0.

  *Handoff:* this exists only because the system stores one roll per ability. If
  `system.rolls` ever lands upstream as an array, delete the wrap and let core
  roll them — the store, not the roller, is the thing that has to change.
- **One store, one read path for rolls.** `extras.rolls` is where an ability's
  throws live; `rollsOf(item)` is the only place anything reads them, and it
  folds core's singleton fields in when this module has not written the flag
  yet. So an unmigrated item presents the same shape as a migrated one, nothing
  writes core's roll fields, and there is no migration to run. A core record
  sitting at its schema defaults (`1d20`, target 0) is **not** a roll — those
  are field initials, not a throw anyone entered.
