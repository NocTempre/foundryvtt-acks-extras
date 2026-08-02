# Library — Design Model

acks-lib is the family's shared-primitives library (`library: true`). It ships
**no sheets and no world data** — it exposes vocabulary + DataModel field-
builders that consumer modules assemble into their own models.

- **Reuse**: the `acks` system's damage/save vocabulary and (via the core-
  deferral shim `game.acks?.lib`) any surface later upstreamed into core.
- **Extend**: the shared ACKS effect/ability vocabulary (`scripts/vocab.mjs`)
  and its DataModel field-builders (`scripts/fields.mjs`) — the target both
  acks-abilities and (deferred) acks-monsters build their models from.
- **Enhance**: nothing yet — the FAMILY.md §3 plumbing (tables registry, socket
  relay, effects collector, economy data) is deliberately **out of v0.1 scope**
  and remains the family-refactor Phase 1 backlog.
- **Invent**: `LevelValue` — the level-scaling value type + its resolver — the
  one genuinely new primitive, spanning thief skills, per-level throws, and
  attack/save progressions.
