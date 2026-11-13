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
  `category` is blank until something that read the item says what it is, and
  blank means unknown: no reader treats it as a proficiency, a power or a skill
  (the Training strip and the equipment bridge each name the categories they
  act on). An import writes the category of the definition it resolved, or
  blank for a name it could not (`docs/importer/MODEL.md`, "A stat block's
  proficiencies"); the Mechanics tab's Category select offers the blank, so a
  save leaves it blank.
- **Enhance**: an alternate ability sheet — Description, **Rolls**, **Mechanics**
  (Foundry's own Active Effects folded into the last of these).
- **Invent**: nothing the system provides is duplicated.

## Imported modifiers apply

A character's abilities' `modifier` rows change its sheet. The resolution
(which rows apply, gates, stacking, stand-aside) is lib's and is stated in
`docs/lib/API.md`, "Typed modifiers"; the equipment loadout effect is the one
writer (`docs/equipment/MODEL.md`). What this feature owns:

- **The origin stamp.** `extras.effectsFrom` is `"recipe"` when the import read
  the row through a register recipe and `"scan"` when the vocabulary scan
  produced it. A scan's rows still apply; every surface that shows them marks
  them unverified. A copy with no stamp is not marked.
- **The Mechanics tab** labels each modifier row with its disposition
  (applied, applied when met, at the roll, situational, read elsewhere, not
  applied) and adds "unverified" on a scan's. A row scoped to one of the
  ability's throws (`appliesToRoll`) carries a chip naming that throw by its
  Rolls-tab label (`rollScopeChip`). A capability, sense, reroll, companion or
  limitation row shows its condition after its face, as a modifier row does.
  On a GM seat each row carries Edit and Delete and the list an Add a row:
  the lib effect-row editor (`lib/apps/effect-row-editor.mjs`) through
  `abilityEffectStore`, which reads and writes the stored `extras.effects`
  flag whole and uncoerced, so a row the window did not touch is written back
  as it was. A player's seat shows the rows only. Repair in place reads every
  row again from the book, over an edit.
- **Quick effects** (`quick-effects.mjs`). On a character's own copy, a row
  that is standing, gated, situational or at the roll and names a field
  offers **Start**: an Active Effect on the copy (`transfer: true`) writing the
  row's figure at the holder's level and rank (`lib` `modifierValue`), flagged
  `flags.acks-extras.quickEffect = {key, target, value, level, rank}` with
  `key` the row's `specKey`. A standing row's effect starts on; every other
  starts disabled, named as situational. While on, it is the ability's own
  effect on that field, so the row stands aside and the figure counts once.
  The row then shows the effect's state (on, off, stale); **stale** means the
  value, level or rank differs from the flag, and **Refresh** rewrites the
  changes and the flag in one update, keeping whether it is on. Deleting the
  ability deletes the effect.
- **A row's condition** is the seat's own page words where the import read
  them (`conditionFrom`, `docs/importer/MODEL.md`), else a neutral label with
  the entry's page reference ("by method (RR p.31)"), else a scope's own word
  or two. Every one of them leaves the row situational; what decides a row is
  its structure (`appliesToRoll`, `appliesTo`, a `gate`), never the words.
- **Rank** for a rank-scaled value is `rankOf`, which lib reads through the
  public API; copies of one definition count once, at that rank.
- Monsters' abilities are not applied.

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

A skill's throw can also stand for an Adventuring throw: `adventuringThrow`
(`adventuring-throw.mjs`) names which held skill's which throw answers each
`system.adventuring` key and returns the better of that and the stored figure,
before conditions, read by `throwOutcome` like every other surface
([character-sheet DECISIONS](../character-sheet/DECISIONS.md) 2026-11-11).
`throwOutcome` and `targetModifiers` take `{conditions: false}` for a caller
whose own roll applies them.

**What other abilities do to a throw** is `throwModifiers`, and it returns the
parts as well as the sum: one `{label, value, cite}` per ability, the cite being
the page the ability's own import names. A `modifies` row on the proficiency
throw acts on every ability that provides a capability its `refs` name, by
capability and never by name; every `ifHas` must be held by the character;
two rows whose abilities share a capability do not stack (the larger applies,
lib `resolveStacking`); a row scoped by `appliesToRoll` acts on that throw
alone. The older `modifier` row naming the activity in `forWhat` still applies
unconditioned and is returned in `pending` where it carries a condition. For an
Adventuring figure the same rows act on a subject that is only a capability
(`modifiesParts`, `unskilled`): a row that needs the skill held is left out of
the stored side, and a row that does not (the Trapfinding shape) lowers it. An
ability that provides `kw:alertness` and carries a `searchListen` throw stands
in for the stored Adventuring figure on Searching and Listening where the
character holds no skill for it, and only when it is the better figure.

A borrowed throw reads a thief-style ladder from the skill the world imported
(`skill-ladders.mjs`) when no class document publishes one: the thief's skills
live on the skill items, so `ladderRungAt` falls back to the imported
`def.skill.<table>`'s ladder. A cold cache answers no rung, never a wrong one.
The recipe for such a throw ships the class and the skill, and the proportion
and the rounding are read off the seat's own page (`target.progression`,
`docs/importer/MODEL.md`); a rounding the page does not state is left to the
registry's default.

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

**Rolling a throw asks first.** `rollAbility(item, key, {event, skipDialog,
bonus, messageMode})` opens lib's roll dialog (`lib/roll-dialog.mjs`) once
the rung is known to need a throw — a rung with no throw posts without asking,
and an unavailable rung says why and posts nothing. The dialog's modifier is
added to the formula as a `Situational` term, and the card's first detail line
reads the natural die back out of the total. An ability the system marks blind
fixes the visibility, so the dialog states it instead of offering the choice.
The system's skip key skips the dialog on every surface that rolls a throw:
the ability's Rolls tab, the system sheet's throw tags and favourites and the
character sheet pass their click event; the system sheet's row reads the key
itself and passes `skipDialog`; the chat card's button passes its event
through `rollFormula`. The lock roll (`equipment/locks.mjs`) passes
`skipDialog: true`, because it reads the result to open the lock. Closing the
dialog returns `null` and posts nothing.
Rulings: lib DECISIONS, "One roll dialog, and the natural die on the card".

## A companion is an inventory slot

An ability that confers a creature — a familiar, a totem animal, a summoned
servant — carries a `companion` effect, and that effect is a SLOT: it exists
the moment the character holds the ability, filled or not. The slot's pointer
is the effect's `actorUuid`; the creature it names is a world actor of the
character's own, never a library document.

Two writers fill a slot, and they never meet. A slot whose page NAMES the
creature carries a cookbook `ref`, and the importer's fill pass writes the
pointer from the library (`resolveCompanion`). A slot whose page leaves the
creature to the reader carries no `ref`, and is filled from the table:
`companions.mjs` offers a picker the moment such an ability lands on a
character, and again from the Equipment tab, where the character sheet lists
every slot as a **Companions** section between Carried and Stowed
(`character-sheet/tabs/equipment.mjs`; the equipment feature injects the same
section into the system's own sheet) with the creature's name, the ability
that confers it, and its controls — open, release, or choose.

The picker reads the imported library: the animals the rule allows first
(`underOneHitDie` over `hitDiceOf`, which reads the importer's structured
hit-dice record and falls back to the roll formula), every other animal after
them at the Judge's discretion, and a typed name for a creature the library
has not got. What is chosen is COPIED into the world — a library creature keeps
its stat block and embedded items and sheds the cookbook stamp, so Remove ALL
Imports never takes a character's companion with the library it was copied
from — filed under a Companions folder, owned by whoever owns the character,
and stamped `flags.acks-extras.companion = {ownerUuid, abilityId, index}` so
the creature can say whose slot it fills. A seat that may not create actors
asks the GM's client to, over the module's socket, and writes only the pointer.

Releasing a slot clears the pointer and leaves the creature in the world. The
ability sheet reads the same pointer: a filled slot names the creature, an
empty one says "(not yet chosen)" or "(not yet loaded)" by which writer owns
it. Nothing else reads or writes `actorUuid`.
