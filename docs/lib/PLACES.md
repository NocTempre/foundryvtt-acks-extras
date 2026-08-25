# `acksLib.places` — the place primitive

A **place** is anything that can hold things and can itself be somewhere: a
realm, a town, an inn, its cellar, and the chest in the cellar. The layer sits
directly on top of `acksLib.storage`, which answers only "whose goods are these
and where are they kept".

## Why it lives here

Same standing rule as the group and the storage primitive: shared machinery
belongs in the lib subsystem (workspace `CLAUDE.md`; template `TOOLCHAIN.md` §6). Nesting,
occupancy and stack-splitting are not specific to settlements — a wagon train, a
dungeon level and a stronghold all want them, and the domains program will want
them again. What is *not* here is anything that knows what a settlement is: the
market, the demographics, the recruitment board. Those are acks-extras'
location feature, built on this.

## A container is the trivial place

The owner's framing (2026-08-02), and it is the constraint that keeps the model
honest: **anything the location sheet can do to a town, it must be able to do to
a chest.** A chest is a place with no market, no occupants, and one level of
nesting; a duchy is a place with all three. If a rule cannot be stated for both,
it is the wrong rule.

Three documents therefore reduce to one node shape (`nodeOf`):

| Backing | Parent pointer lives in | Contents are |
|---|---|---|
| `acks-extras.location` actor | `system.parentUuid` | embedded items stamped by storage |
| any other storage **provider** actor | `flags.acks-extras.place.parentUuid` | embedded items stamped by storage |
| the equipment feature **container item** | *derived* — carrier + `containedIn` | sibling items pointing at it |

Three readers, one fact each, no copies. The container carries no parent of its
own on purpose: the equipment feature already owns "what is this item inside of", and a
second copy would drift the first time somebody moved a sack into a backpack.

```
{uuid, parentUuid, name, img, kind, count}
```

## The one invariant

**No cycles.** Every walk in `place-logic.mjs` is individually cycle-guarded
(a visited set, exactly as `expandContainerClosure` guards nested containers), so
a corrupt chain renders short instead of hanging the sheet. But guards are not
the rule — `wouldCycle` refuses the write, because a cycle silently orphans
everything inside it from the root, and the sheet is where a GM would go to fix
the thing that just became unreachable.

## Occupancy: two sources, one list, stored wins

Foundry has no actor-inside-an-actor, so the living things at a place are
**references** (`system.roster`), denormalised with name and image so a deleted
actor leaves a row that still says what used to be here.

`mergeOccupants(stored, derived)` folds in the tokens standing on the place's
linked scene:

- a **stored** row is the deliberate record — the GM said the garrison is
  billeted here — and survives the scene being renamed, deleted or never opened;
- a **derived** row is a live observation, marked `derived: true`, never written
  back, and gone when the token walks away.

Promoting a derived row to a stored one is an explicit act (the sheet's pin
button), because a party crossing a map should not silently take up residence in
it. Dedup is by actor uuid and **stored wins**, so a row placed by hand keeps its
notes and attribution when its token also shows up.

`visibleOccupants` then filters. That order is load-bearing: filter last or a
hidden row leaks; merge first or a stored row loses its notes to its own derived
duplicate. Both orderings are pinned by tests.

> Visibility here is the same ruling storage makes about attribution: **a UI
> convention, not a security boundary.** A player with ownership of a shared town
> can enumerate its roster from the console. A garrison that must genuinely stay
> secret belongs on a GM-owned place.

## Stacking, and how it differs from a group

Eight identical warehouse bays are one actor until one becomes interesting —
the laziness invariant of `acks-extras.group` (see [GROUPS.md](GROUPS.md)), applied
to places.

The mechanism is **not** the same, and the difference is forced. A group's
members can diverge in place because a member *is* an ActorDelta over a shared
base. A place cannot borrow that: its contents are embedded items and a roster,
neither of which has a delta representation. So divergence here is a **split** —
the interesting bay becomes its own actor and the stack shrinks by one — and
`count` is the only stack state there is.

A split deliberately carries **nothing** across: no goods, no roster. The stack's
contents were never per-instance (eight identical bays hold one pooled
inventory), so dividing them would be inventing an answer the model never had.
The split exists to let one bay *become* interesting; what goes in it is the next
thing the GM does.

## Cost

`allPlaces()` is a single pass over `game.actors` — cheap at world scale, but a
scan. Take one per render and thread it through `childPlaces`, `placePath` and
`coinRollupGC` rather than letting each re-scan.

`allPlaces({ pack })` adds the places ONE compendium holds, read from its
already-loaded index — no fetch on a render path, because the location feature
puts `system.parentUuid` and the place flag into
`CONFIG.Actor.compendiumIndexFields` at init. One pack, not all of them: a
pack's places point at each other (an imported adventure and its rooms are
written together), so the pack being looked at is the whole world those
pointers live in. The location sheet passes its own document's `pack`, or —
for a place dragged out of a library into the world, whose parent pointer
still names the library's copy — the pack that parent lives in.

Container items are deliberately **not** enumerated world-wide; that would be
O(actors × items) on every breadcrumb. They are resolved only as the children of
the place actually being looked at.

## Surface

`acksLib.places` — pure rules (Node-importable, unit-tested in `tools/test-lib.mjs`)
plus the document layer:

- **nesting** — `parentUuidOf`, `setParent`, `childPlaces`, `placePath`,
  `ancestorUuids`, `descendantUuids`, `wouldCycle`, `planReparent`
- **contents** — `contentsOf`, `contentRows`, `coinRollupGC`, `rollup`
- **occupancy** — `rosterFor`, `addOccupant`, `removeOccupant`, `sceneOccupants`,
  `mergeOccupants`, `visibleOccupants`, `headcount`
- **stacking** — `countOf`, `planSplit`, `splitPlace`, `stackMemberName`
- **hooks** — `acksLibPlaceReparented`, `acksLibPlaceOccupantAdded`,
  `acksLibPlaceOccupantRemoved`, `acksLibPlaceSplit`
