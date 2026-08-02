# `acks-lib.group` — the stackable actor

A **group** is many near-identical creatures held as one actor: a mercenary
platoon, a pack of kobolds, a flight of manes. It carries a headcount and a
*sparse* roster — a per-member record only for the members that have become
individual — so storage is proportional to how interesting the group has
become, not to its size.

## Why it lives here

Shared machinery — a new actor sub-type, the deploy/recall token handling —
belongs in acks-lib under the family's standing "promote to acks-lib" rule
(workspace `CLAUDE.md`; template `TOOLCHAIN.md` §6). Behaviour unique to
mercenary formations (leaders per RR 169, training pipelines, unit wages) is
**not** here — it belongs to a consuming module (`acks-troops`). This split was
the maintainer's ruling (2026-07-23).

The group is the second Foundry document acks-lib owns, after `acks-lib.animal`;
it reuses that type's whole apparatus — `acksCompatStubs()`, `savingThrowFields()`,
the `library:true` setup-registration timing, the `game.acks.lib` deferral shim.

## The model (`scripts/data/group-data.mjs`)

### Member records ARE ActorDeltas

Foundry already has a sparse per-instance override document: an unlinked token's
**`ActorDelta`** stores only what differs from its base actor — embedded item
overrides included (a different sword, an extra potion). The acks system already
writes into it (`src/module/documents/token.mjs` rolls an unlinked monster's HP
straight into `token.delta`). So a member's individuality **is** an ActorDelta
source object: same shape, same merge rules, and Foundry does the merging. No
parallel override system is invented.

The consequence that shapes everything else: ActorDelta needs a real **world**
Actor as its base — a compendium entry cannot be one. So `template.uuid` points
at a world actor, minted from `template.snapshot` on first deploy if absent.

> **Why the field is `template`, not `prototype`.** Foundry blocks `prototype`
> (with `__proto__` and `constructor`) as a forbidden key in dotted-path
> expansion — a prototype-pollution guard — so `actor.update({"system.prototype.
> x": …})` silently drops the key and nothing persists. The field is therefore
> named `template`; the *concept* is still "the prototype every member copies",
> and the API method is still `setPrototype`. (Found the hard way in live
> testing: every other `system.*` write worked, only `system.prototype.*` no-oped.)

### The laziness invariant

```
size.current  ≥  livingRecorded.length
pristine      =  size.current − livingRecorded.length
```

`size.current` counts living bodies. The `roster` holds a record only for
members that are `materialized`, `deployed`, `detached`, or `dead`. Pristine
bodies are the **difference** and have no record at all — a 30-strong platoon
that has never fought is `size.current: 30, roster: []`. HP is not rolled until
a body is first materialised.

### The representative individual

Undeployed, the stack token must still be attackable and show a sensible bar, so
the schema mirrors ONE body's stat block — `acksCompatStubs()` for the floor the
system touches on every actor, `savingThrowFields()` for the full five saves,
and explicit `hp`/`aac`/`details`. Same reasoning as `acks-lib.animal`
(`actor-compat.mjs`).

### The collective noun is data

`system.noun` is filled from acks-monsters ecology (`encounter.*.noun` — a
*pack* wandering, a *tribe* in its lair) or the unit category, and is always
GM-overridable. The internal type name is deliberately neutral (`group`) so it
never contradicts a displayed noun the way `unit` would on a kobold pack.

## The lifecycle (`scripts/group.mjs` + `scripts/group-logic.mjs`)

Deploy/recall is the **compatibility strategy**: a deployed member is an
ordinary token over an ordinary actor, so combat, acks-equipment and
acks-formation all read it with no special-casing.

| Operation | Effect |
|---|---|
| `setPrototype(group, source)` | snapshot the stat block, seed the mirror + size |
| `ensureBaseActor(group)` | mint the world Actor the ActorDelta needs (once) |
| `materializeMember(group)` | pristine body → record; rolls its HP |
| `applyCasualties(group, n)` | pristine fall first (no record lost), then records → `dead` |
| `deploy(group, scene, {count})` | spawn unlinked tokens, member delta pre-applied |
| `recall(group)` | fold `token.delta` back in, drop ≤0-HP bodies, delete tokens |
| `detach(group, key)` | promote a member to a standalone actor; `size.current--` |

`group-logic.mjs` is the **Foundry-free** half (the pure decisions —
`nextOrdinal`, `memberName`, `isDerivedEffect`, `cleanDelta`, `sizeFromEcology`),
split out so it imports under Node and is unit-tested in `tools/test-logic.mjs`,
the same split as `vocab.mjs` vs the Foundry-only `fields.mjs`.

### Derived effects do not survive recall

A deployed member picks up derived state — a module-managed loadout effect, a
combat buff — that must not bake into the resting record or it re-applies
forever. `cleanDelta` strips any effect flagged `flags.<namespace>.managed =
true`; authored effects (a Judge's curse on one kobold, unflagged) are kept. A
module teaches the predicate about its own generated effects through the
`acksLibGroupIsDerivedEffect` hook — the library never hardcodes consumer module
ids. (acks-equipment's loadout effect is invisible to a group anyway:
`managesLoadout` is `type === "character"`, and a group is not a character. The
interaction only matters for *deployed members*, which are characters, and is
the reason the strip exists.)

## Ecology runway — READ only, deliberately unimplemented

`sizeFromEcology(source, context)` is the ONE reader of acks-monsters data and
the only ecology consumption today: a monster's number-appearing → a size
formula, soft-read so acks-monsters stays optional, and **not auto-rolled** (the
Judge decides when a group is sized). The richer seams named in `group-data.mjs`
— lair chance, supply cost, `battleRating.unit` for mass combat — are documented
and left unread.

## Boundaries / what is NOT here

- **Mercenary specifics** (leaders, training, unit wages/morale rules) →
  `acks-troops` (consumes this).
- **Abstract-mode damage routing** (an attack on the undeployed stack →
  auto-casualty) → the data + `applyCasualties` primitive exist; hooking the
  system's damage application is a follow-up, live-tested.
- **Split / merge** of stacks → planned, not built.
- **Socket routing** — these ops write documents on the calling client under
  Foundry's own permissions; a consumer needing GM-routed writes wraps them.
  acks-lib is `socket:false`.

## Verification

- Offline: `tools/test-logic.mjs` covers the Foundry-free lifecycle logic
  (ordinals, naming, derived-effect stripping, delta cleaning, ecology read).
- Live: the model registration, sheet, and deploy/recall/detach round-trip need
  the test world (they write tokens and actors) and are a release gate.
