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

Not every throw is scored. A **measure** — `rollType: "measure"` — is dice with
nothing to beat, and its result is the whole answer: how many Hit Dice of undead
a successful rebuke turns, how much a treatment heals. It has no target, so it
shows its DICE wherever the others show a number, its card carries no success
row, and its editor has no target section at all. Every surface asks `measures()`
for this, so none of them can read a measure as a throw whose target failed.

`rollsOf()` reads the set and `writeRolls()` changes it — no other path does
either. Between them they keep two invariants: every throw has a unique key,
which is assigned once and never rewritten, and an emptied list stays empty
(core's own `roll` / `rollTarget` are reset to their initials, which is what the
fold in `rollsOf()` reads as "no roll").

A throw's ladder is either **internal** — the rungs typed onto the throw — or
**borrowed**: a `progression` target names a class the world publishes and one
of its ladders, and reads it at a fraction of the character's own level. That is
how the books' "as a <class> of <fraction> your level" powers are expressed: the
lending class publishes the table once, and every ability that borrows it says
which fraction and which way it rounds. The fraction is a numerator over a
denominator, read off the page rather than picked from a list, so a rule stating
one this module has never seen needs no code. The sheet
shows the borrowed table under the throw, headed by the LENDING class's levels
and captioned with the rung the reader actually stands on.

Borrowed ladders resolve through `classes/registry.mjs`, never through lib — lib
is Foundry-free and cannot see the world's class documents, so it answers null
for this kind by design.

**A rung is not always a number.** It may declare that no throw is made at that
rung, or that the throw is not available yet, and it carries the cell as the
page prints it. `throwOutcome()` returns that whole verdict — `outcome`,
`target`, `text` — and every surface asks it, so an automatic rung reads as one
everywhere instead of as a target that failed to resolve. `throwText()` is the
one place a throw is rendered as a string.

A throw may also name an **ability score** it is written against, with a
multiplier: the character's own modifier for that score, counted once or several
times. It resolves through `targetOf()` like every other bonus, so the number the
sheet shows, the strip shows, and the chat card scores against are the same one —
and a score-bearing throw reads differently for two characters, which is the
point. The chat card and the editor's preview name the term, because a target
that moved with no visible cause reads as a typo. On a measure the term goes into
the DICE instead — there is no target to move — and the line says so.
