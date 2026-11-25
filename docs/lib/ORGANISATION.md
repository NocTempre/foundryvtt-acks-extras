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
| `scripts/lib/org-host.mjs` | The reads over the world: `orgHostOf` and its index, `unitsOf`, `orgHosts`, `chartRows`, `moraleFromUnitsAbove`. Imports nothing that writes, so a group's data model can read it. |
| `scripts/lib/org.mjs` | The writes (`addRow`, `setHolder`, `sendOut`, `recall`, `join`, `leave`), the two views over a world (`orgChart`, `locations`) and `chartOf`. Exposed as `acksExtras.lib.org`. |

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

`FactionData#affiliation` is the one list: the faction's `members`, then the holder
of each chart row that no member row names (`affiliationRows`). A stored member row
wins over a chart row for the same actor, so a hidden mark set on the roster
stands; a chart row's own `hidden` rides on the row it makes; an empty row and a
holder the world no longer resolves affiliate nobody. `hasMember`, `headcount`,
`factionRecord`, `readableLeaderUuid` and the reaction listener's concealed-member
test read it, and nothing reads `members` for "who belongs". The headcount counts
each holder group live, nested groups included, each body once (`liveRows`,
GROUPS.md "A count read now").

## What is not here

The Roll that fills an empty row, the plans that make groups and stacks from a
recipe (`lib/org-write-logic.mjs`), Delete, the sheets that draw the two views,
the gestures for join, leave and "make its own", and henchmen's `serviceNodes`
(which feeds the same nodes) are later slices.

## Verification

Offline: `tools/test-org-tree.mjs` (the node, the plans, the views, the morale walk
and the affiliation list), `tools/test-org.mjs` (the index and its deletes, the
writes over mocked documents and their order, the twin a stopped join leaves),
`tools/test-group-command.mjs` (command morale through the real getter) and
`tools/test-factions.mjs` (the affiliation readers). Live: docs/lib/TESTING.md,
"The organisation chart through the API".
