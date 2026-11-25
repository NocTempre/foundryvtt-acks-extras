# The organisation chart

Who belongs to whom, as rows on a host actor, and the controls that move groups
about without changing it. A faction card is affiliation and a group is who is
where; the chart is how the two meet. The groups it holds are
[GROUPS.md](GROUPS.md)'s, the places they stand on are [PLACES.md](PLACES.md)'s,
and the faction that hosts a village's chart is [factions/MODEL.md](../factions/MODEL.md)'s.

| File | Owns |
|---|---|
| `scripts/lib/fields.mjs` | `unitField()`, the row. |
| `scripts/lib/org-tree-logic.mjs` | Foundry-free: the node, the walks, the ordered write plans, the host preference, the morale walk, `affiliationRows`, the two view models. |
| `scripts/lib/org-write-logic.mjs` | Foundry-free: the Roll, Add and Edit plans of a generated organisation. |
| `scripts/lib/org-host.mjs` | The reads over the world: `orgHostOf` and its index, `unitsOf`, `orgHosts`, `chartRows`, `moraleFromUnitsAbove`. Imports nothing that writes, so a group's data model can read it. |
| `scripts/lib/org.mjs` | The writes (`addRow`, `setHolder`, `sendOut`, `recall`, `join`, `leave`, and a group's own `joinFaction`, `makeFaction`, `leaveFaction`), the two views over a world (`orgChart`, `locations`), `chartOf` and the faction line's reader `factionLineOf`. Exposed as `acksExtras.lib.org`. |
| `scripts/lib/group-faction.mjs` | The group sheet's faction line: its view and the four presses (join, make its own, leave, open) with the picker and the notifications. Not part of the API. |

## The row

A chart is a list of rows, `units`, on a host: `FactionData.units` and
`GroupData.units`, the same row in both.

| Field | Is |
|---|---|
| `key` | The row's name. Never re-keyed: a row keeps its key through a join, a leave and a send out. |
| `parentKey` | The row it stands under, blank for the top. A parent naming no row reads as a top row. |
| `label` | What the row is called until its holder says. |
| `holderUuid` | The group (or lone actor) holding the row's bodies. Blank is an **empty row**. |
| `kind` | The unit word an import read, so an empty row knows what a Roll makes of it. Data at runtime; no choice list and no word in source. |
| `notes`, `hidden` | The Judge's note; a mark hiding the row from a player. |
| `gen` | An object lib stores and never reads. The generating feature keeps there what a later Roll of an empty row needs. |

An empty row is the open-language-slot pattern (`docs/classes/MODEL.md`,
"Languages"): a row that waits to be decided, and a chart with empty rows is
finished. A holder that no longer resolves reads empty too.

One reduction serves every reader. `nodesOf(rows)` makes
`{key, parentKey, label, holderUuid, kind}` nodes, dropping a row with no key and
keeping the first of a repeated key. `rowAncestors`, `rowDescendants` and
`subtreeKeys` are place-logic's walker over them (the walk a place's parent, a
faction's parent and a group's parent use), so data that loops is read safely and
a chart cannot hang a reader.

## Which host answers

Every chart lives on a host actor. A village's host is its faction card; a roll
with no village is hosted by the group of its top unit. `orgHostOf(holderUuid)`
answers `{host, row}` for the row that names the holder, from a lazy reverse index
over the actors that carry `units`. It reads affiliation and never location: a
group on a map or inside another group answers by the chart that names it.

The index is a cache and never truth. Every hit is read again against the host's
own rows and the holder itself, so a stale index costs a wasted lookup and never a
wrong answer: a holder deleted answers null, and so does a host deleted. A create,
a delete, or an update touching `units` drops it, and the next read rebuilds it.

Where two hosts name one row, between the two writes of a join or a leave, the
faction answers. `twinKeys` lists such rows and the org chart marks them.

## Add and fill

`addRow(host, parentKey, {label, kind, notes})` makes an empty row under any row on
any host, or at the top of a chart. It is the only way a row comes to exist here;
the Roll (a later slice) writes its own. `setHolder(host, key, holderUuid)` names
the actor that holds a row, or empties it. Deleting a row, with its group and any
prototype nothing else names, is the generator's.

## Where things are

Affiliation (`units`) never changes by a move. Where a group is stands in two
stored things: a place's roster (`addOccupant`) and the group's
`unit.parentGroupUuid`, and a nested group is wherever its outermost container is.

- **Send out** (`sendOut(host, key, placeUuid)`) writes the place's roster first,
  then lets every other roster that held the group go, then clears the group's
  parent. The target goes first, as `moveStack` orders two-document writes, so a
  group caught between the writes stands in two places and never in none. The
  place must carry a stored roster.
- **Recall** (`recall(host, key)`) sets the group under the group its parent row
  holds first, then takes it off every roster. It says why where there is no group
  to go back under: a top row (`topRow`), a parent row with no holder
  (`emptyParent`), a parent holder that is no group (`parentNotGroup`), or a holder
  that is a lone actor (`notGroup`), which stands inside no group. A loop is
  `setParentGroup`'s own refusal (`cycle`).
- **An empty row's press makes its group**: an empty group actor named from the
  row's label (else its `kind`, else the shipped unit word), written to the row as
  its holder. Send out and leave both do it, and no press refuses an empty row.

A body on the map is GROUPS.md's rule; this adds no refusal of its own. Every
write answers `{ok, reason?}` and none throws for a refusal. A document the seat
does not own refuses the whole plan before any write, with `notOwner`.

## Join and leave

`join(group, faction, underKey)` joins a group's chart to a faction's: the faction
is written first, with the group's rows appended under the chosen row (the top of
the chart when none), then the group's own rows are cleared. `leave(faction, key)`
is the reverse, for any subtree: the group holding the subtree's top row is
written first, hosting the subtree with its top row at the top of its own chart,
then the faction drops it.

Keys are never re-keyed, and both are idempotent by key: a row the target already
holds is the first write having landed, so a second press writes no row twice and
only completes the clearing. Between the two writes a row stands on two hosts; the
faction answers, the view marks the twin, and a second press completes the move.
After a join the group's sheet draws its subtree from the faction's rows
(`chartOf(group)`: the rows above and beneath its own), with no copy. "Make a
faction card of its own" is a create followed by the join.

## A group's own gestures

A group needs no faction card and a Judge may give it one. The group sheet's first
line, **Faction**, is where the three gestures sit (`group-faction.mjs` reads the
line and carries the presses out; `org.mjs` does the writes, as `join` and `leave`
do):

- **Join a faction…** opens a picker over the world's factions (`worldFactions()`,
  the world's `acks-extras.faction` actors) and `joinFaction(group, faction)`
  joins the group at the top of the faction's chart. A world with no faction says
  so and opens nothing; a closed picker writes nothing.
- **Make its own…** is `makeFaction(group)`: a faction actor named from the group,
  with `leaderUuid` the group's `unit.officerUuid` where one is set, then the join.
  A join that refuses leaves the card made, and the result names it.
- **Leave** is `leaveFaction(group)`, `leave` over the row the faction holds for the
  group. **Open** opens the card.

`joinFaction` is `join` for a group that hosts rows, with its own rows. A group
inside no group that hosts none joins as one row that holds itself, the shape a
roll with no village gives its top unit, so a group standing alone can be listed
under a faction. Leaving gives it that chart back.

The line is `factionLineOf(group)`: **joined** where a faction answers for the
group's row and the group hosts no rows of its own (its name, the row's label as
"listed there as", Open and Leave); **free** otherwise for a group inside no group or
one that hosts a chart (None, Join and Make its own); no line for a group another
group's chart lists, and for a group inside another group that hosts none. A group
that hosts rows while a faction also names it is a join stopped between its two
writes: it reads free with that faction first in the picker, so the same press
completes the move and no Leave can undo it. A leave stopped between its two writes
is the same stored shape, so the line reads the same and offers a Join, not a
Leave; the sheet says which press stopped, a join or a leave, and the Join it offers
puts the group back under the card. A faction's name or a row's label is
the world's own text.

These are controls, not gates. The only refusals are `join`'s and `leave`'s: a seat
that cannot write a document (`notOwner`, naming it, before any write), a document
gone, a write that failed partway. Each is said in a warning on the sheet's seat,
and a Judge is warned of nothing else. The presses show on any sheet the seat can
edit.

## The two views

Built once, in lib, over nodes, for the faction sheet, the root group's sheet and
a character's Followers tab. Pure functions over plain data in
`org-tree-logic.mjs`; `orgChart(host)` and `locations()` read a world into them.

- **`orgChartView(rows, read, twins)`**: the tree of a host's rows. Each row has its
  holder's name and art, its live `count` (`bodyCount`, nested groups included),
  its `officer` (the holder group's `unit.officerUuid`, as name and art), `empty`,
  `twin`, and `covered`. A holder standing inside another row's group keeps its own
  count and is `covered`, so the chart's `total` counts each body once.
- **`locationsView({places, rows, read})`**: for each place, the outermost groups on
  its stored roster, each with the chart rows it holds or holds through a group
  inside it (`inside`). A group whose container is on the same roster is `covered`.
  A row whose holder stands on no place is listed in `unplaced`. A roster row
  marked hidden is a Judge's alone.

## Leader and morale

A unit's leader is one actor, named by its group's `unit.officerUuid`
(GROUPS.md). A village's chieftain is also the faction's `leaderUuid`. The
officer's morale part is the group's `unit.officerMoraleBonus`, which
`commandMorale` already adds.

`moraleFromUnitsAbove(group)` is the other half, and `commandMorale` adds it: each
**ancestor** row's holder group contributes its `officerMoraleBonus` while its
officer is up, walking the rows of whichever host holds the group's row. The page
gives the morale part to the chieftain alone (MM pp. 47-57); the walk is what
carries it to every gang under the chieftain, and takes it from all of them when
the chieftain falls. An officer is up when it resolves, is above zero hit points
and is not marked `dead`. An officer that does not resolve, an empty row and a
null part add nothing. A group's own officer stays `commandMorale`'s own term and
is not read here. The influence feature's `moraleRatingOf` and every sheet that reads
`commandMorale` or `unitMoraleOf` take it with no change of their own. The sum is
held to the character's morale range as before.

## Who a faction affiliates

`affiliationRows(members, units, resolve)` is the pure reduction: a faction's
`members` and the holder of each chart row as one list of roster rows. What it
means for a faction, who reads it and how its headcount counts is
[factions/MODEL.md](../factions/MODEL.md), "Who belongs".

## The Roll, Add and Edit plans

`org-write-logic.mjs` plans the three hand controls over a generated
organisation and carries nothing out. What is rolled, and why, is the generating
feature's ([monsters/MODEL.md](../monsters/MODEL.md), "The organisation roll");
this file owns what the plans write. A plan is `{ok, reason?, ops}` as above, and
an executor carries the ops out in order. A document a plan makes does not exist
yet, so the plan names it by a ref, `"new:<id>"`: the executor creates it,
remembers its uuid under the ref and puts that uuid wherever the ref stands in a
later op, a row's `holderUuid` included. Ops: `prototype` (one creature to mint,
once per `key`), `createGroup`, `parent`, `addStack` and `addLabelledStack`,
`makeActor` and `setOfficer`, `update` (the host's rows, and a faction host's
`leaderUuid`) and `addOccupant`.

- **Roll** (`planRoll`) fills an **empty** row, or starts a chart, from a rolled
  tree. A row with a holder is refused (`filled`): there is no re-roll. With
  `scope: "one"` the row's own unit is made (its group, bodies, leader, and its
  camp, the unit's parts that are no sub-unit) and each unit beneath it becomes
  an empty row that keeps what the roll fixed in its `gen`; with `"below"` every
  unit beneath is made too. Nothing outside the row and its new descendants is
  written: every other row comes back as it went in. The generation record rides
  as `gen` on the row the roll began at, and lib stores it and never reads it.
  A roll with no host is hosted by its top unit's group; a faction host's top row
  also writes the faction's `leaderUuid`.
- **One prototype per creature.** The tree's creatures are keyed by their own
  fields, so identical creatures across the whole roll are one `prototype` op and
  every stack and leader names its ref. A library entry needs no op: its stack
  names the entry's uuid. A creature no entry answered is an `addLabelledStack`,
  the printed word arriving in the tree.
- **A leader is an actor.** Its `makeActor` is followed, for a unit's first
  leader, by `setOfficer` with the morale part the tree carries (null where the
  figure is out of the group field's range).
- **Add** (`planAddUnit`) is `planAdd` with the next free key chosen and the host
  write named.
- **Edit** (`planEdit`) changes a filled row by hand: its label, note, kind or
  visibility on the host's row, a stack's count or prototype and the officer on
  the unit's group. Bodies on a map keep the figures they went out with until
  they are recalled, which comes back as `warnings: ["onMap"]` and no refusal.

## The executor

`runPlan(plan, {mint, makeLeader})` (`org-run.mjs`) carries a Roll or Add plan out in order
with a ref map: every `"new:<id>"` the plan names becomes the uuid of the document made
for it, wherever it stands in a later op (a row's `holderUuid`, a faction's `leaderUuid`,
an update's own target). Lib names no creature, so the caller supplies `mint(spec, {key})`,
which finds or makes the actor of a prototype spec and answers `{actor, made}`, and
`makeLeader(op, spec, mount)`, which makes a leader's actor. A prototype is minted when a
stack first names it. A library entry is read, never minted. A stack's `gen` also stores
the `mount`, `carry` and `speakers` the op carried. An op the executor does not know, and a
document the seat cannot write, refuse the plan before the first write (`badOp`, `missing`,
`notOwner`). A write that fails stops the run with `reason: "failed"`; the result lists every
id made (`created`, `made.{groups,prototypes,leaders}`) in either case, and a string still
starting `new:` is never written.

## Unlist, and Delete as API

`unlistRow(host, key)` is what every Remove press ends in: the row and every row beneath it come off the
host's chart and **no document is deleted**. It is `leave` widened to any host: each topmost row of the
subtree that names a holder moves, with the rows beneath it, onto that holder, which hosts them as its own
chart; where the host is a group that holder is taken out of the group that nested it
(`setParentGroup(null)`); a subtree naming no holder is only dropped and no group is made for it. Every
seat is checked before the first write. `org.deleteRow` stays as API only, with no caller on any sheet.

`deleteRow(host, key)` removes a row and every row beneath it (a group nests inside its
parent row's group, so a row taken alone would leave its subtree inside a deleted group),
the group each holds, and each prototype carrying `ORG_PROTOTYPE_FLAG` that no group's stack
names as its `template` or `gen.mount`. A group comes off every roster, and the faction's
`leaderUuid` is cleared where it was a deleted group's officer. The officers are actors of
their own and stay (listed in `leaders`); so does every actor the generator did not mint.
Bodies on a map warn (`warnings: ["onMap"]`, a whisper to the Judges) and refuse nothing.

## The chart's tab

`org-chart-ui.mjs` (context and presses) and `org-chart-ui-logic.mjs` (the pure half:
`templateOf`, `chartCards`, `emptyKeys`, `subtreeView`) draw the chart on a faction's
**Org chart** and **Locations** tabs and, through the `org-chart` partial, on a root
group's sheet, above its stacks; the same sheet lists the groups standing directly inside the
group (`org-nested`). A group that has joined a faction reads the faction's rows beneath its
own row, in place and never copied. One set of actions (`ORG_ACTIONS`) serves both sheets;
each press finds its host from the markup, drives `org.addRow`, `org.editRow`,
`org.deleteRow`, `org.sendOut` and `org.recall`, and Roll through the generating
feature's `rollOrganisation`, and writes at once: there is nothing to save, no re-roll and no pin.

- **Roll** on a card fills that card and every card beneath it. It is offered on an empty
  card whose row, or the nearest row above it, carries a family template in its `gen`. The press loads that template whole (`fromUuid`) for the panel's Variant list; the chart's plate is read from a pack's index after `getIndex()`.
  **Roll at random** fills every empty card in reading order, each as a Roll of its own,
  after one panel: where it was found, its state, the variant, the leaders' grade and which
  optional rules are on.
- **+ Warband** adds an empty row under the top row, taking the unit word the level already
  uses; **Add** on a card adds one beneath it. An empty card's pen gives its row a group of its
  own and opens the same Edit.
- **Edit** changes a label, a note, visibility (the Judge's) and each stack's count, through
  `planEdit` and the `setStack` executor op; a stack's count never goes below the bodies it
  already records, and bodies on a map keep the figures they went out with until recalled (a
  whisper, never a refusal).
- **Remove**, in a card in edit, unlists the row and its subtree (`unlistRow`) and deletes nothing. A
  line above the chart names each group that now hosts what came off, with an Open, and the count of rows
  dropped for naming no group, until dismissed.
- The tree is board 1f's chart: leader cards joined top-down by connector lines, children side by side, in a
  box that scrolls sideways. A leader's card is the Follower Card's compact face (`frame` option) inside the
  role frame of its tier (`gen.tier`, read from the evaluated line), with troop, trait and kit badges drawn
  by the generator's `org-chart` service. A card in edit is a form in the card: troop, bodies, champion,
  Remove and Done. A count is **set by hand** when it differs from the total its Roll threw (`gen.rolled` on
  the stack), derived each draw and never stored.
- A reader who is no Judge is shown no `hidden` row and nothing beneath one, in the chart
  and in the Locations rows (`readableUnits`, `readableChartRows`).
- **Expand all** and **Collapse all** keep their fold on the window (a press redraws the
  sheet); the tree scrolls sideways in a box of its own.
- **Locations** lists each place with the groups of the host's rows on its roster, a chip per
  row, and the rows whose group stands on no place; a chip's Recall brings its group back, and is drawn only where `recall` can succeed (`recallOffered`: not a top row, and a parent row that holds a group). A parent that holds a lone actor, or a cut chart's root whose parent is out of view, can still refuse and says why.

`readHolder`, `orgChartView` and `locationsView` are on the lib api (`org`) for the
Followers tab's views.

## What is not here

Design by selection (the per-slot panel of board 1b) and a card's troop-type pick. A
character's service tree reaches the same nodes through henchmen's `serviceNodes`
([henchmen/MODEL.md](../henchmen/MODEL.md), "Who serves whom").

## Verification

Offline: `tools/test-org-tree.mjs` (the node, the plans, the views, the morale walk
and the affiliation list), `tools/test-org.mjs` (the index and its deletes, the
writes over mocked documents and their order, the twin a stopped join leaves),
`tools/test-org-run.mjs` (the executor and Delete), `tools/test-group-command.mjs` (command morale through the real getter) and
`tools/test-factions.mjs` (the affiliation readers), `tools/test-org-write.mjs` (the
Roll, Add and Edit plans) and `tools/test-group-faction.mjs` (the faction line and its
presses). Live: docs/lib/TESTING.md, "The organisation chart through the API" and
"Join, leave and make its own".
