# Proficiencies and class powers

The system's own `ability` item, given a real model: several throws instead of
one, targets that scale with level or rank, and selections that light up the
matching proficiency pills.

![](../releases/v1.0.0/ability-sheet.png)

*An ability item with its rolls and mechanics tabs.*

## The sheet

Open any **ability** item. Beyond core's fields:

- **Mechanics** — the structured effect model (what this ability actually does),
  with the system's own Active Effects folded in rather than kept in a separate
  tab.
- **Rolls** — every throw the ability makes.
- **Selections** — the picks a proficiency of this category can take.

## Multiple rolls

Core stores **one** roll per ability, so every route into a roll — the sheet's
proficiency row, a chat card button, `item.use()`, a hotbar macro — could only
ever reach an ability's *first* throw, while the Rolls tab showed all of them.
The same ability rolled differently depending on where you clicked.

This module owns the ability roll path and routes all of them to the same place.
Add as many throws as the ability has; they all work from everywhere.

**An ability with no roll shows itself instead of rolling.** Core intends this,
but tests a field that defaults to `"1d20"` and is therefore never empty — so a
proficiency that makes no throw used to post a d20 against a target of 0.

## Ladders

A throw can key its target on:

- **class level** — the usual case;
- **rank** — how many times the proficiency has been taken. Several proficiencies
  are rated this way rather than by level: Animal Husbandry's diagnosis throw is
  11+ at one rank, 7+ at two, 3+ at three, and the ranks carry different titles.

A conditional ladder reads off a scale rather than a level, so the sheet names
which scale it is using.

## Selections

Ticking a selection box is guaranteed to light the matching proficiency pill —
the keys are the same ones the profile strips match on. A pick outside the
shortlist is still valid; it goes in the free-text field instead of a box.

## Common problems

**The sheet died with "the partial could not be found".** Open an ability first
after a reload and the system's Active Effects partial may not be registered yet.
The module preloads it; if the system renames the file, the tab renders without
that block rather than breaking.

**A shared world item shows a ladder instead of a number.** It has no owner to
resolve against, so it presents the ladder itself. That is correct.

**My roll target is 0.** A core record sitting at its schema defaults (`1d20`,
target 0) is not a roll — those are field initials, not a throw anyone entered.
