# `acks-extras.group` — the stackable actor

A **group** is many near-identical creatures held as one actor: a mercenary
platoon, a pack of kobolds, a flight of manes. It carries a headcount and a
*sparse* roster — a per-member record only for the members that have become
individual — so storage is proportional to how interesting the group has
become, not to its size.

## Why it lives here

Shared machinery — a new actor sub-type, the deploy/recall token handling —
belongs in the lib subsystem under the family's standing "promote to the lib subsystem" rule
(workspace `CLAUDE.md`; template `TOOLCHAIN.md` §6). Behaviour unique to
mercenary formations (leaders per RR 169, training pipelines, unit wages) is
**not** here — it belongs to a consuming module (`acks-troops`). This split was
the maintainer's ruling (2026-07-23).

The group is the second Foundry document the lib subsystem owns, after `acks-extras.animal`;
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
and explicit `hp`/`aac`/`details`. Same reasoning as `acks-extras.animal`
(`actor-compat.mjs`).

### The collective noun is data

`system.noun` is what a Roll read off the side it rolled (`encounter.*.noun` — a
*pack* wandering, a *tribe* in its lair), else the unit category's word. The first
monster rolled writes it, and only that monster's re-roll replaces it. A noun a hand
typed stands through every Roll.
The internal type name is deliberately neutral (`group`) so it never contradicts a
displayed noun the way `unit` would on a kobold pack.

## The lifecycle (`scripts/group.mjs` + `scripts/group-logic.mjs`)

Deploy/recall is the **compatibility strategy**: a deployed member is an
ordinary token over an ordinary actor, so combat, the equipment feature and
the formation feature all read it with no special-casing.

| Operation | Effect |
|---|---|
| `setPrototype(group, source)` | snapshot the stat block, seed the mirror + size |
| `ensureBaseActor(group)` | mint the world Actor the ActorDelta needs (once) |
| `materializeMember(group)` | pristine body → record; rolls its HP |
| `applyCasualties(group, n)` | pristine fall first (no record lost), then records → `dead` |
| `deploy(group, scene, {count})` | spawn unlinked tokens, member delta pre-applied, its hit points kept over the system's roll |
| `canDeploy(group)` | whether this seat can: it owns the group and may create tokens |
| `recall(group)` | fold `token.delta` back in, drop ≤0-HP bodies, delete tokens |
| `detach(group, key)` | promote a member to a standalone actor; `size.current--` |
| `moveStack(from, to, stackKey)` | the row and everything beneath it to another group ("A row moved between groups") |

`group-logic.mjs` is the **Foundry-free** half (the pure decisions —
`nextOrdinal`, `memberName`, `isDerivedEffect`, `cleanDelta`, `sizeFromEcology`),
split out so it imports under Node and is unit-tested in `tools/test-lib.mjs`,
the same split as `vocab.mjs` vs the Foundry-only `fields.mjs`.

### Derived effects do not survive recall

A deployed member picks up derived state — a module-managed loadout effect, a
combat buff — that must not bake into the resting record or it re-applies
forever. `cleanDelta` strips any effect flagged `flags.<namespace>.managed =
true`; authored effects (a Judge's curse on one kobold, unflagged) are kept. A
module teaches the predicate about its own generated effects through the
`acksLibGroupIsDerivedEffect` hook — the library never hardcodes consumer module
ids. (the equipment feature’s loadout effect is invisible to a group anyway:
`managesLoadout` is `type === "character"`, and a group is not a character. The
interaction only matters for *deployed members*, which are characters, and is
the reason the strip exists.)

### A deleted body, and a moved one

A deployed body's token removed by anything other than `recall` (the Judge
clearing the fallen, core moving it to another scene) is reconciled by the
primary GM's `deleteToken` hook (`registerGroupCleanup`). The write is keyed
on the record still naming that token's uuid, which carries its scene, so a
token under the same id on another scene is not this body. Every deliberate
route (recall, casualties, detach) clears the uuid first.

- **A deletion that names a successor** carrying the same group and member
  flags (docs/lib/MODEL.md, "A token moved to another scene") is the body
  standing somewhere else. The record stays `deployed` under the successor's
  uuid, its hit points are not read, and the headcount does not move. A later
  `recall(group)` with no scene gathers it from there.
- **Any other deletion** folds the body back in, as a recall does, and a body
  at ≤0 HP is a casualty (`acksLibGroupCasualty`).

The reconciliations run one at a time, each reading what the one before it
wrote. Run side by side, two bodies deleted in one batch each read the roster
before the other's write, and one fold is lost. A body sent out and straight
back is two deletions before the first write lands, and the second one's
guard is the uuid the first one recorded.

## The sheet

The group sheet reads as an inventory. A stack is one row: its art, its name, what it
is and how many of its bodies hold no record, then its counts, editable in place, and
the row's actions. It stays one row however many bodies it holds, because a row per
body would mean a record and a hit-point roll per body. The bodies that hold a record
nest under it, with the fallen and the detached.

A row is a subgroup, and its grip, its art and name, drags on an editable sheet. It
carries `STACK_DRAG_TYPE` and names the group and the stack. On a seat that cannot place
tokens the tooltip names the move alone, and a drop on the map warns and places nothing
(`canDeploy`). `registerStackDrop` answers the drop on
the map: the row and those beneath it deploy, every body the stack holds off the map,
with `deploy`'s `count: Infinity`. The fallen and the detached have left the stack, and
a body already out stays where it stands. They land where core would seat a dropped
actor, the first body centred on the cursor and snapped unless Shift is held, hidden
where a Judge holds Alt, the rest five abreast. The row's Deploy takes its Count, for
part of a stack. The fields stay outside the grip, because a field inside a dragged
element loses its text selection to the drag.

### A row moved between groups

A row dropped on another group's sheet moves there, `moveStack(from, to, stackKey)`:
its pristine bodies, its resting records with their deltas, its fallen and its
detached. A drop is the whole row, so a stack moves or it stays, and it never splits.
Where it lands on the sheet decides nothing.

| On the target | What happens |
|---|---|
| A stack over the same `template.uuid` | They merge. Both counts add, so bodies that fell stay counted as fallen, and the crossing records take that stack's next ordinals in their own order. An unnamed "#3" can read as a new number there, and a named body keeps its name |
| No such stack | The row stands whole under a new key, its roll, ordinals, `mounted` and `baseMorale` as they were |

The match is the base actor, because a record's delta overlays what it was written
against. A shared label does not merge, so a stack minted from a compendium entry can
stand as a second row beside one of the same creature.

An empty stack that a hand and a roll never sized takes the crossing stack's roll with
its count. Any other stack keeps its own, so its count's tooltip reads as changed by
hand. A group gaining its first stack seeds its representative block from it, and a
group losing its first reseeds from the stack that takes its place.

`moveRefusal(from, to, stack)` says why not, or null. The seat must own both groups,
and a sheet it cannot edit still takes the drop, so that seat hears which group stopped
the row. A token's own copy refuses as the Roll does.

A body on a map refuses the whole row, and the warning says to recall it first. Its
token's flags name the group, the stack and the record that recall and the deletion hook
fold it back through, so a body that crossed would be deleted unfolded and its wounds
lost. A resting record refuses nothing, which is why this is not the Roll's `stackHeld`.
A record whose token is gone crosses at rest.

The two actors take two writes and no transaction. The target goes first, so bodies
caught between the writes stand twice rather than nowhere. A source that then refuses
the write takes the target back to what it held. A write between those two would be
lost to that rollback.

## The Roll

Every monster's row has its own Roll, a Judge's on an editable sheet.
`rollEncounter(group, stackKey, {context, state})` (`scripts/lib/group-encounter.mjs`,
its decisions in `group-encounter-logic.mjs`) sizes that stack from its creature's
ecology, in one write, and posts one card to the Judges with every step. A press
rolls that monster alone, and a re-roll replaces only what that monster's roll made.
Nothing rolls until a Judge presses it: a stack gets its formula when it is added,
and its count from a Roll or a hand. `context` is the dungeon or the wilderness line.
`state` is a side, or `chance`, which throws that monster's lair chance and lets it
choose the side (JJ ch. 2).

`sizeFromEcology(source, context, state)` is the ONE reader of a side. Named a
state, it reads that side alone. Core's `details.appearing` stands for a wandering
side only, and only where the line states no count anywhere, since it holds the
first count and so never a lair's.

| Stack | Its row |
|---|---|
| Empty, or sized by an earlier roll | A Roll, which throws the side's formula on Foundry's `Roll` and writes `size.current`, `size.initial`, `size.formula` and `rolled` |
| A count with no `rolled` | No Roll: a hand set it, and it says to zero both counts to roll |
| Some sides in units | A Roll, and a note naming those sides, since units are no bodies. A press on one writes nothing and says so |
| Every side in units, or no count stated | No Roll, and a note says why |
| No creature behind it | No Roll |

A stack that holds a record, or a living count under its initial one, refuses its
Roll before a die is thrown, because a new count would erase those bodies. The stack
beside it still rolls, and a hand's count refuses nothing, since no Roll would write
it. A token whose actor is its own copy refuses too: the write would reach that token
alone. Every new group is linked (`GroupData._preCreate`), and a create that states
`actorLink` keeps what it states.

The Roll writes no body. A rolled stack stays pristine until `materializeMembers`
rolls each body's own hit points as it becomes individual.

The first press makes the group an encounter: it sets the reveal, takes the art of
the monster pressed where the group has none, and writes the token defaults (linked,
hostile, name on hover). Make Encounter on the monster sheet does all of that at
creation, so a token placed before the Roll gives nothing away. A later press leaves
the reveal and the token defaults as they stand.

The dialog opens on the line the viewed scene reads. Lib cannot import a feature, so
it calls `ROLL_CONTEXT_HOOK` and formation answers (`travel.sceneEncounterLine`):
the scene's travel system, else the mode of a party on it. A settlement reads no
line, so the dialog stays on wilderness.

## The reveal

`system.reveal` is what every seat reads off the token. Blank is no encounter, and
this module leaves that token alone. `noun` is the noun alone, over core's default
art, because a creature's art names it as surely as its name does. `full` is the name,
the count and the art.

The Judge's select on the sheet sets it, and hiding a token is core's own toggle.
Nothing sets it from a scouting result yet: `docs/ROADMAP.md`, "Groups".

The name is the token document's own, so the combat tracker and a chat speaker read
what the map does. The primary GM's `updateActor` hook (`registerEncounterTokens`)
keeps the prototype and every placed token on the face, the count included at `full`.
A hand's token name or art is overwritten for as long as `reveal` is set. The Judge's
own nameplate reads the name and the count whatever the reveal (`refreshToken`), so
two masked tokens stay two.

Deployed bodies are seen on the field and keep their own names. The reveal does not
reach them.

## Seams left unread

Supply cost and `battleRating.unit` for mass combat, named in `group-data.mjs`, are
documented and read by nothing.

## Boundaries / what is NOT here

- **Mercenary specifics** (leaders, training, unit wages/morale rules) →
  `acks-troops` (consumes this).
- **Abstract-mode damage routing** (an attack on the undeployed stack →
  auto-casualty) → the data + `applyCasualties` primitive exist; hooking the
  system's damage application is a follow-up, live-tested.
- **A split** of a stack into two, within a group or across → not built. A drag takes
  the whole row, as the owner ruled, so nothing asks for one yet.
- **Socket routing** — these ops write documents on the calling client under
  Foundry's own permissions; a consumer needing GM-routed writes wraps them.
  The lib layer writes on the calling client and owns no socket of its own;
  the module-wide transport is `scripts/lib/sockets.mjs`.

## Verification

- Offline: `tools/test-lib.mjs` covers the Foundry-free lifecycle logic
  (ordinals, naming, derived-effect stripping, delta cleaning, ecology read).
  `tools/test-group-lifecycle.mjs` drives the deletion hook over mocked
  documents: a moved body, a fallen moved body, a round trip, a plain
  deletion, a successor that is not the same body, and a twin on another
  scene. `tools/test-group-encounter.mjs` drives the Roll, Make Encounter and
  the token hooks, its dice asserted by the formula thrown.
  `tools/test-group-move.mjs` drives a row's move between groups.
- Live: a body moved between scenes is docs/lib/TESTING.md, "A group body
  moved between scenes"; the Roll, the reveal, a row's drag and its move are "The
  encounter group".
- Live: the model registration, sheet, and deploy/recall/detach round-trip need
  the test world (they write tokens and actors) and are a release gate.
