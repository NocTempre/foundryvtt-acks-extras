# Roadmap — repo level

Work that is designed but not built, and primitives that exist ahead of the thing
that will consume them. Anything here is deliberately absent from the code, not
missing from it.

Feature-scoped roadmaps live in `docs/<feature>/ROADMAP.md`.

---

## Vehicles

SHIPPED 4.2.0–4.4.0 as the `acks-extras.vehicle` sub-type — namespaced so core
[#154](https://github.com/AutarchLLC/foundryvtt-acks-core/issues/154) (still
open, untouched since 2026-04) can ship a bare `vehicle` without a name fight;
if it does, this becomes a migration.

Built: cargo weighed by the capacity primitive, crew complements with
proportional understrength slowdown, draft teams with the book's substitutions,
wind and hunger and stowed-mast multipliers, terrain and road multipliers with
Driving and Seafaring, passengers bound through `lib/attachment.mjs`, and the
boarding macros.

Not built:
- **War machines** — the third vehicle category the books name (ballistae and
  catapults ride ON vessels as cargo with their own stone cost, and siege
  engines are a chapter of their own). Nothing models a mounted weapon.
- **Vessel damage and sinking** — SHP is stored and shown; the 1d10 rounds to
  sink, the fractional damage rules by attacker size, and repair at sea are
  not automated.
- **Nautical hazards and navigation** — shoals, getting lost, the Navigation
  throw and its Pathfinding/Seafaring bonuses.
- **A vessel's own voyage clock** — sea travel is measured in miles per day
  over a 12-hour day, which is a different clock from the party's turn scale
  and has no surface.

## Magic

The largest unbuilt area, and the reason two primitives already exist unused.

**A real spell primitive.** `lib/fields.mjs` `spellRefField()` is a placeholder:
it points at the core system's existing spell item by uuid and carries the
printed name as a fallback, which is enough to link and display but models
nothing about the spell itself. When magic lands it becomes a real primitive —
school, range, duration, save, reversibility, ritual/formula cost — and the
`spell` string on `effectField` retires in favour of it. It exists now so the
shape is agreed before anything depends on it.

**Spellcasting value as a conditional scale.** `lib/vocab.mjs` `VALUE_SCALES`
carries `arcaneValue` / `divineValue` so a custom-class power can state a cost
that varies by the class's spellcasting value ("counts as 1 power at Arcane Value
1–2, 2 at Arcane Value 3–4"). Nothing consumes them yet; the ability model still
stores a plain numeric `powerValue`. Wiring `powerValue` onto `levelValueField()`
is the step that activates them.

---

## The domain-module family

`location` is designed for extension by a future structures/strongholds module:
other modules store their own data in their own flag namespace on the same
location actor, and this schema stays minimal.

Until such a module publishes, the "has X" fallback chain in `henchmen/facts.mjs`
is the contract — owning-module API, then actor flag, then an **inventory marker
item** whose name declares the fact ("Stronghold: Border Fort", cost = gp value),
then null so the caller asks the GM. A future module supersedes the markers
transparently by taking over the first step; nothing else changes.

---

## Henchmen

**Candidate generation.** Rolled results are RECORDED today; generating the
people is a future module. The record is the interface between the two.

**The full class distribution.** Candidate class rolls currently fall back to the
core-six percentages when the full JJ double-d100 distribution has not been
imported — fighter, crusader, thief, mage, explorer, venturer. The expansion and
demihuman classes are GM endpoints anyway and simply do not appear until the
distribution is imported.

---

## Monsters

The enum and DataModel migrations are **done** — `monsters/config.mjs`
re-exports the shared vocabulary, and the extras model stores lib's shared
field shapes (speeds, senses, vision, defences). Nothing monster-shaped is
parked here.

---

## Groups

`lib/group-logic.mjs` reads a monster's number-appearing to size a group. The
richer seams — lair chance, supply cost, battle rating — are documented in
`group-data.mjs` and deliberately unread, waiting on the domain work that would
give them somewhere to be spent.

---
