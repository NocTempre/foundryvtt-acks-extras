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
a body is first materialised. A record holds the body's `delta`, and beside it
the size a hand gave its token (`tokenSize`, "A size a hand gave a body"); a
pristine body has neither.

### The representative individual

Undeployed, the stack token must still be attackable and show a sensible bar, so
the schema mirrors ONE body's stat block — `acksCompatStubs()` for the floor the
system touches on every actor, `savingThrowFields()` for the full five saves,
and explicit `hp`/`aac`/`details`. Same reasoning as `acks-extras.animal`
(`actor-compat.mjs`).

The block follows the group's first stack. It seeds when a group gains one, and when
that stack leaves, removed or moved, it reseeds from the stack that takes its place. An
emptied group keeps what it showed.

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
| `deploy(group, scene, {count})` | spawn unlinked tokens, member delta pre-applied, its hit points kept over the system's roll, the size a hand gave it laid back |
| `canDeploy(group)` | whether this seat can: it owns the group and may create tokens |
| `deployAnchor(group, scene)` | `{x, y}` the sheet's own Deploy places a body at: the group's token on the scene, else the playable area's centre |
| `recall(group)` | fold `token.delta` and the size a hand gave the token back in, drop ≤0-HP bodies, delete tokens; every group inside it is recalled with it |
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

### A size a hand gave a body

A record keeps `tokenSize` beside its delta: `{width, height, scaleX, scaleY}`,
each part null where nothing is kept. `recall`, and a body's token deleted by
hand, fold it in through the one reading (`foldOf` in `group.mjs`, deciding in
`keptTokenSize` of `group-logic.mjs`).

- **Width and height are kept as a pair**, since the footprint lock freezes both
  axes, where the pair differs from the prototype token's and a hand set it: the
  token carries `flags.acks-extras.footprintLock`, or it carries a `sizeStamp`
  the pair differs from. A token with neither is no body this module sized, so
  none of its size is kept.
- **The texture scale is kept** where it differs from the prototype's, since
  nothing automatic writes scale.
- **`flags.acks-extras.sizeStamp`** (`{width, height}`) is the size the module
  last wrote to the token, written in the same update as the size. Deploy writes
  the prototype's size as the stamp of a body with nothing remembered; the
  battlemap's own size writes stamp too (`docs/battlemap/MODEL.md`, "Token
  sizing — ownership"). A stamp blocks nothing; only the lock does.
- **The next `deploy` lays the remembered pair back with the lock**, so the
  scene's auto-size leaves it alone. A remembered scale goes onto the token's
  texture and takes no lock. A body with nothing remembered is sent out at its
  prototype's size and stamped with it, and an auto-sizing scene then sizes it as
  it does any new token.

The constants are `FLAG_FOOTPRINT_LOCK` and `FLAG_SIZE_STAMP` in
`scripts/lib/constants.mjs`. The ruling is `DECISIONS.md` (2026-11-25).

### A body sent out carrying its item

A generated stack's `gen.carry` is `{[equipmentRowKey]: share}`: how many of its
bodies carry that row's item. `deploy` lays two things on the delta of whichever
body goes, resting or new, on its token and in its record, so a gather (which
folds the token's delta back) keeps them: the caller's `extraDelta`, merged as
`mergeObject` merges with `items` joined to the body's own list by `_id`; and the
items `gen.carry` gives it.

- **lib names no item.** `registerCarryResolver(fn)` is the one slot;
  `fn(group, stackKey, rowKey)` answers an Item source, an array of them, or null.
  monsters fills it (`carriedGearItems` in `scripts/monsters/organisation.mjs`,
  which mints a row's item as a generated leader's gear is minted). A null, a
  throw or no resolver sends the body out plain and spends nothing.
- **The share is counted on the records.** A record's `carries` lists the rows
  its body was given. Every record stamped with a row, in any state, counts
  against that row's share, so a slot once spent stays spent; a body going out
  unstamped is given the row's items and stamped only while the count is below
  the share, and a stamped body is never given a second copy.
- The group sheet's send-out reaches this through `deploy` itself, so a body sent
  out with no press carries its item.

A stack's row can also carry a press for the item, drawn from a second slot:
`registerStackRowControl(fn)`, where `fn(group, stack)` answers `{key, line, lineTip,
label, tip, icon, variant, disabled, press}` entries (a blank `label` draws the line
alone). The sheet draws them only where `canDeploy` answers true and runs a pressed one
by `pressStackRowControl`, which reads the slot again by `key`. monsters fills it
(`scripts/monsters/carry-press.mjs`; the decisions are `carry-press-logic.mjs`) with
"{n} carry {item}" for each `gen.carry` row whose item the carrier runs.

- **A press finds a carrier, and never sends a body that carries nothing.** A stamped
  body out on the viewed scene acts at once (several: the lowest ordinal). Otherwise a
  stamped body at rest, or a slot of the share still unspent, is sent out by `deploy`
  with `deployAnchor` (the placement the sheet's own Deploy takes) and `carrying: rowKey`,
  which sends the resting records stamped with that row before the others, and then the
  press is `Item#use` on the body's own copy, found by its cookbook id and a run
  activation. With every slot spent on bodies that are not here, the row keeps its line
  and draws no press.
- **The press follows Foundry's ownership.** It is drawn and run only where the seat
  owns the body that acts: the carrier out (its token's actor), or the actor a sent-out
  body is built from (the stack's world base actor; a stack with none yet is a GM's).
  Elsewhere the row keeps its line, so no press sends a body it cannot act through.
- **The press tells the item's own state:** Lower where the out carrier holds it raised,
  the spent press, held off, where its copy is used up.
- **The line's tooltip is where the share came from:** the imported row (found by its
  `gen.carry` key) and its page for a stack a part generated, "chosen by the Judge" for
  any other.

### A group inside a group

`unit.parentGroupUuid` names the group this one stands inside, blank for none: a gang
inside a warband. It is a pointer and nothing is copied, so each group keeps its own
stacks, records and tokens, and a body's flags name the group it belongs to.

One walker serves every reader. It is place-logic's `ancestorUuids` and
`descendantUuids`, the walk a place's parent and a faction's parent already use, over
`{uuid, parentUuid, own}` nodes read from the world's group actors (`groupNodes`).
Its visited set ends it on data that loops, so no reader can hang. `groupDescendants`,
`groupAncestors`, `wouldCycleGroup` and `groupTree` (a group and every group inside it,
as actors, the group first) are that walk.

`setParentGroup(group, parentUuid)` is the writer the lib offers. It refuses a loop (a
group inside itself or inside its own descendant), a parent that is no group, and a seat
that cannot write the group, and answers `{ok, reason}`. A blank parent takes the group
out. The group's data model refuses the loop as well, in `_preUpdate`, so a direct
`update` from a hand or a macro cannot nest a group inside its own descendant either: the
update is cancelled and the console says why. Data written around both (a create, an
imported world) and looping is read safely and counted once.

The leader of a unit is the group's `unit.officerUuid`; nesting adds no field for it.

A group may also host an organisation chart, `units`: the rows of the units under
it, each naming the group that holds its bodies. It is affiliation, where nesting is
location, and it never moves a group. [ORGANISATION.md](ORGANISATION.md) owns the
rows, the controls over them and the morale part a group takes from the units
above it.

### A count read now

A group's `bodyCount` is its own living bodies plus those of every group inside it,
read when asked and never from a stored figure. An emptied group counts none. A roster
row that names a group (a place's occupants, a faction's members, a location's
headcount) is read through `liveRows`: its `quantity` is that group's `bodyCount`
whatever the row was written with. A row whose group stands inside another row's
group still reads its own count and is marked covered, so the total counts none of it,
since the outer count holds those bodies already. A row
that does not resolve (a deleted group, a pack not loaded) keeps the figure it stored.
`headcount`, `headcountOf` and the location's `headcount` count a group row at its
quantity, none included, and any other row at its quantity or one. An emptied group
stays on its roster.

## The sheet

The group sheet reads as an inventory. A stack is one row: its art, its name, what it
is and how many of its bodies hold no record, then its counts, editable in place, and
the row's actions. It stays one row however many bodies it holds, because a row per
body would mean a record and a hit-point roll per body. The bodies that hold a record
nest under it, with the fallen and the detached.

The figure at the head of the sheet is the group's whole tree: the living bodies of its
own stacks and of every group inside it (`bodyCount`), with the pristine and the fallen
summed the same way (`treeTotals`, `group-logic.mjs`). Its tooltip lists the parts that add
to the figure: each own stack as its label and count, then each group inside it as its
name and the bodies it holds in its own stacks. The rows below it stay the group's own
stacks.

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

The body's first line is the faction line: which faction card lists the group, with
Join a faction, Make its own, Open and Leave. A group needs no card; the line and its
rules are [ORGANISATION.md](ORGANISATION.md)'s, "A group's own gestures".

### A generated stack

A stack the generator made carries `gen: {part, cite}`, the recipe part's key and the
page that prints it; a blank part is a stack nothing generated. Its count's tooltip
names the formula and total, the part and its page. Its row offers no per-monster Roll,
since a press would make the count again from the creature's own line, and shows a note
in the Roll's place; `rollEncounter` refuses it as `generated`.

The Roll also writes `gen.rolled` (the count it gave) and, where the count was dice, `gen.formula`,
the expression as the roll entry gave it. The organisation chart's count die throws `gen.formula`
again and records the dice it threw in `gen.thrown`, beside `gen.rolled`
(docs/lib/ORGANISATION.md, "The chart's tab").

Two generated stacks never merge in a move, whatever their base: the same creature in
two units is two rows, and a generated stack that meets a plain one over the same base
merges into it as any two do.

`fixedHp` on a stack is a printed hit-point figure. Every body the stack makes
individual takes it in place of a roll of the prototype's hit dice; null, the default,
rolls. Only a part that prints hit points sets it, and it is read at the moment a body
gets its record.

### A stack with no creature

A stack with no prototype is a label and a count (`addLabelledStack`): the word an
import read for a creature no library entry matched, which arrives from data. It has no
snapshot, so no base actor can be minted from it and nothing of it is placed. Sending it
to the map, by a row dropped there, the row's Deploy or its group's token joining a
combat, whispers the Judges that the stack has no creature behind it, in the form a
group holding nothing to place is whispered, and places nothing of that stack while the
group's other stacks still go. It is a warning and no refusal. Dropping a creature on
its row (`setStackPrototype`) gives it one. It carries the roll's printed `fixedHp` as an
addStack does, which its bodies take once it has a creature; until then
`materializeMembers` makes no body of it, since there are no hit dice to roll.

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
hand.

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

## In a fight

A group's own token, added to a combat, deploys the whole group
(`scripts/lib/group-combat.mjs`, installed by `registerGroupCleanup`). The primary GM's
window acts, one piece of work at a time.

| When | What happens |
|---|---|
| The token joins a combat | Every stack sends out every body it holds, as a row dragged onto the map does: `deploy` with `count: Infinity`, from the token's square, five abreast, one stack after another. Each body on the scene gets a combatant, hidden where the group's was. The group's own combatant is deleted, and the token is hidden and flagged `groupCombat` with the combat's id and whether it was hidden before |
| The combat is deleted | Every token whose flag names it recalls the group's bodies on its scene through `recall`, and the token goes back to the visibility it had, flag cleared. A body at zero hit points is a casualty, as in any recall |
| The token is added again to the combat it fights in | The bodies gather early. Their combatants leave the combat, `recall` folds them back and the token returns, while the combatant just added stays, so the group fights as one token. Adding it once more sends them out again |
| The token is added to a second combat | The combatant is deleted and the Judges are whispered that it fights elsewhere |
| The group holds nothing to place | The Judges are whispered, and nothing is written: the combatant stays, the token stays visible and no flag is set |
| A group stands inside it | Every group inside it sends out its bodies the same way, after its own stacks, and each body carries its own group's flags and gets its combatant. The end and the early gather recall them all into the groups they came from |
| A group inside it is a combatant already | Its token, fighting as one row, goes out as a token added to the combat does: its bodies out, the token hidden and flagged, its row deleted. It fights as one of the joining group's gangs with no entry of its own. A token fighting in another combat, and a party's, stay as they are |
| The bodies are in | Each group in the tree with two or more bodies fighting is grouped for initiative by one `combat.manageGroup(tokens)` over that group's own bodies, as many calls as there are such groups, the root's own bodies included |

A body already on the map stays where it stands and fights with the rest, and the end
recalls it with them. The flag is written before the combatants exist, so a deploy that
fails part way still leaves the combat's end the bodies to gather. A flag naming a
combat no longer in the world holds nothing back.

### Initiative groups

The grouping is the system's. `manageGroup` is the call behind the group control of the
Combat Tracker sidebar tab, and the Judge regroups with that control. Lib writes no list
of its own and no initiative: the system rolls once for each group and prints a group
mark beside each name, and `patches/initiative-card.mjs` reads the same list to print a
group as one row. The partition is `gangPartition` (`group-logic.mjs`), the calls are
`groupGangs` (`group-combat.mjs`).

- A group is every group in the tree, nested or not. A gang that joins alone is the root of
  its own tree and is grouped the same way.
- A group with one body fighting makes no call, since the system refuses a single token.
  A lone leader rolls alone. A token that is no combatant is never passed: the system
  refuses the whole call over one.
- A group the stored list already holds, with exactly those tokens, is left alone. A call
  replaces a group with a fresh one that has not rolled, so repeating it would clear a
  roll a gang already carries; this is how a gang already in the fight keeps its roll when
  its warband joins.
- The call returns its write, through `patches/group-initiative.mjs`, and each one is
  awaited, so the next call starts from a list that has the group. The stored list is then
  read until it holds the group, which passes at once and still orders the calls where that
  patch stands down. The wait writes nothing. If the list never holds the group, the wait
  ends at three seconds, a line goes to the console and the next gang goes on.
- Lib writes no list of its own, but the write the system's call makes drops what is dead
  (`patches/group-initiative.mjs`): every token id no combatant of the combat holds, and
  any group that leaves with fewer than two tokens. An early gather deletes the bodies'
  combatants and leaves their group stored with token ids that no longer exist; it stands
  until the next group call on that combat, which removes it, so sending the bodies out
  again stores one group and not two. While it stands it holds no live body and is
  harmless to the roll.
- A body that joins a combat on its own, as a monster added by hand, is no group's and is
  never grouped.

A formation member that holds a group deploys and recalls the same tree, its bodies
laid into the member's cells one stack after another.

Left alone: a body (its token carries the member flag and its actor is no group), a
token that is no group, the party's own token (it carries the formation's flag), and a
group a formation records as a member, which that formation deploys and gathers
(`formation/combat-bridge.mjs`). Lib reads the flag and the formation setting by key, as
it cannot import the formation.

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
the monster pressed where the group has none (its token's image, else its portrait;
a wildcard token names no single image, so the portrait stands in), and writes the token defaults (linked,
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
The name and the count read the group's tree (`treeStacks`, `group-encounter-logic.mjs`):
every stack of the group and of each group inside it, stacks sharing a creature's label
added into one. A change to a group inside brings the token of each group it stands
inside to the new count.
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
- **The generator.** `encounter-generator` v1 (docs/lib/API.md) is the contract through
  which a provider will make a unit's stacks. Lib declares it, registers nothing and calls
  it nowhere yet; what it answers arrives as `addStack` (with `gen` and `fixedHp`) or
  `addLabelledStack` data.
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
  `tools/test-group-move.mjs` drives a row's move between groups, and
  `tools/test-group-combat.mjs` a group token's joining, gathering and ending a combat,
  nested groups, `setParentGroup` and the labelled stack. `tools/test-lib.mjs` covers the
  walker, the live counts and the roster floors; `tools/test-group-deploy.mjs`, `fixedHp`
  and a stack with no creature.
- Live: a body moved between scenes is docs/lib/TESTING.md, "A group body
  moved between scenes"; the Roll, the reveal, a row's drag and its move are "The
  encounter group", and a group token in a fight is "A group token in a fight".
- Live: the model registration, sheet, and deploy/recall/detach round-trip need
  the test world (they write tokens and actors) and are a release gate.
