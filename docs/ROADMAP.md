# Roadmap — repo level

Work that is designed but not built, and primitives that exist ahead of the thing
that will consume them. Anything here is deliberately absent from the code, not
missing from it.

Feature-scoped roadmaps live in `docs/<feature>/ROADMAP.md`.

---

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

The enum migration is **done** — `monsters/config.mjs` re-exports the shared
vocabulary from `lib/vocab.mjs` rather than defining its own. What remains is the
DataModel side: the defence, sense and speed field *shapes* in `lib/fields.mjs`
are built and unused, waiting for the monster extras model to adopt them.

---

## Influence

An **opposed mode** — two actors rolling against each other rather than one actor
against a situation. The subject of an effect is already carried through the
resolver for this reason, so an effect aimed at an opponent is not silently
folded in as a modifier on the roller.

---

## Groups

`lib/group-logic.mjs` reads a monster's number-appearing to size a group. The
richer seams — lair chance, supply cost, battle rating — are documented in
`group-data.mjs` and deliberately unread, waiting on the domain work that would
give them somewhere to be spent.

---

## Capacity is one concept, still answered in four places

`lib/item-model.mjs` `capacityOf` (1.2.1) made capacity a property of gear rather
than of the equipment feature's container record. It is the same question asked
everywhere else, and the rest has not been collapsed yet:

| Who asks | What it reads today |
|---|---|
| an item | `gear.capacity` — the one that moved |
| a character | core's `system.encumbrance.max` (`20 + STR mod`, or the GM's `forcemax`) |
| a monster or mount | the monster extras model's `load.normal` / `load.capacity` (MM p. 13) |
| a party carrying a body | `formation-model.mjs` `carriedLoad`, which **re-derives `20 + STR mod` inline** and so ignores a forced maximum a GM has set |

**Encumbrance is capacity applied to an actor** (owner, 2026-08-03), and mounts,
wagons, crates and the hands of a team lifting a body all ask it the same way.
One primitive over any document — `capacityStone` / `loadStone` / `overCapacity`
— replaces all four, and the formation bug disappears as a consequence rather
than as a separate fix. Scheduled as a major release: it moves the load model
that monster and party sheets read.
