# lib API (apiVersion 77)

`lib` is the module's shared-primitives subsystem, `scripts/lib/`. It is what
every other feature is allowed to depend on, and the one place overrides of core
logic belong — a feature patches core directly only where the behavior is unique
to its own domain.

Features import it directly (`import … from "../lib/vocab.mjs"`), which is what
makes a moved surface fail at load instead of degrading into silence. There is
no `requires` edge and no installed-but-disabled case, and `apiVersion` is an
informational stamp rather than a handshake — a feature and the lib always ship
at the same version.

Scope: the effect/ability vocabulary and DataModel field-builders, the scoping
primitives the social rolls need, the layered tables registry, the
service-contract registry, the ruledata loader, the core patch layer, and the
actor sub-types the module owns. **No book-read value ships here or anywhere
else in the repo.**

## Exposure

- `globalThis.acksExtras.lib` — assigned at module evaluation; re-affirmed at
  `init`. The `game.acks?.lib ?? localImpl` shim stays in place so that if a
  surface is ever upstreamed into the `acks` system, consumers defer to core
  without changing.
- `game.modules.get("acks-extras").api.lib` — the same object. **`api` is the
  whole namespace, never a feature — always drill in.**
- Node/offline tooling imports the files directly, e.g.
  `import { resolveLevelValue } from "../scripts/lib/vocab.mjs"`.

```
acksExtras.lib = {
  apiVersion: 77,
  // --- primitives ---
  vocab,               // lib/vocab.mjs — enums + resolvers (Foundry-free)
  fields,              // lib/fields.mjs — DataModel field-builders (Foundry-only); 17 adds `occupantField`, the roster row a place and a faction share
  wallGeometry,        // lib/wall-geometry.mjs — segments and the graph they draw (Foundry-free)
  wallLayers,          // lib/wall-layers.mjs — a flag over a wall: read, write, preset, region (Foundry-only)
  resolveLevelValue,   // (levelValue, level, scales?) → number | null
  tables,              // lib/tables.mjs — layered rules-table registry (Foundry-free)
  services,            // lib/services.mjs — named-contract registry (Foundry-free)
  loadRuledata,        // lib/ruledata.mjs — register table documents (Foundry-only)
  // --- patch layer ---
  acksCompatStubs, savingThrowFields,
  // --- owned actor sub-types ---
  AnimalData, ANIMAL_TYPE,
  GroupData, GROUP_TYPE, groups,
  TemplateData, TEMPLATE_TYPE, templateLogic,
  // --- domain surfaces ---
  mount, senses, light, perception, storage, places, itemModel, money, …
  repair,              // lib/repair.mjs — the standing repair tool (below); 18
  hp,                  // lib/hp.mjs — the group hit-point tool (below); 19
  worldTime,           // lib/world-time.mjs — the clock's reading (below); 22
  conditions,          // lib/conditions.mjs — the condition catalogue and its math (below); 23
  statusPalette,       // lib/status-palette.mjs — the token palette as the Judge arranged it (below)
  // 24: currency — `money` and the stack half of `itemModel` (below)
  coinOrder,           // lib/coin-order.mjs — the coin-order controls a sheet draws (below); 25
  // 25: coin stores, a holder's order, a payment's reach — `money` (below)
  drawQuietly,         // lib/roll-audience.mjs — a table draw with nothing posted (below); 28
  // 30: places.isMarkerActor — the bodies whose token marks a place (docs/lib/PLACES.md)
  groupEncounter,      // lib/group-encounter.mjs — the Roll, Make Encounter, the reveal (docs/lib/GROUPS.md); 32
  // 33: groups.canDeploy, groups.STACK_DRAG_TYPE — a stack's row dragged to the map (docs/lib/GROUPS.md, "The sheet")
  // 34: groups.moveStack, groups.moveRefusal — a stack's row between groups (docs/lib/GROUPS.md, "A row moved between groups")
  // 35: tables.bandDie — a one-die table's die, read off its own bands
  summons,             // lib/summons.mjs — a character's summoned creatures (below); 36
  spellUse,            // lib/patches/spell-use.mjs — the cast seam (below); 36
  // 51: attack.{MAGIC_ATTACK_TYPE, spellCarrier, isSpellCarrier, carrierOf, magicDamageSpec}, saves, loseStates, STATES_LOST_HOOK (below)
  // 54: TURN_BEGAN_HOOK, TURN_ENDED_HOOK, turnLife.{FLAG, EDGES, readTurnLife, turnLifeStep, turnEdges} (below, "Turn hooks and a record's turn life")
  // 70: attack.TARGET_AC_FLAG (below, "The attack card's Armor Class line")
  // 71: rollMods.countsOnce (below, "A condition counted once")
  // 73: groups.{setParentGroup, addLabelledStack, groupTree, deployedTree, groupNodes, groupDescendants, groupAncestors, wouldCycleGroup, liveRows, isGeneratedStack} (docs/lib/GROUPS.md, "A group inside a group"); addStack takes `gen` and `fixedHp`
  // 74: org.{runPlan, deleteRow, planRoll, planAddUnit, planEdit, planDelete, keySource, ORG_PROTOTYPE_FLAG} (below, "`org` — the organisation chart"); a stack's `gen` carries `mount`, `carry` and `speakers`
  // 73: fields.unitField; org.{orgHostOf, orgHosts, unitsOf, chartRows, addRow, setHolder, sendOut, recall, join, leave, orgChart, locations, chartOf, rostersHolding, moraleFromUnitsAbove, nodesOf, rowAncestors, rowDescendants, rowRoots, subtreeKeys, twinKeys, isEmptyRow, affiliationRows, registerOrgIndex} (below, "`org` — the organisation chart"); a faction and a group carry `system.units`
}
```

`groupEncounter` is `rollEncounter(group, stackKey, {context, state, roll})`, which
sizes that one stack and resolves to `{ok, reason?, name?, why?, found?, total?, message?}`;
`rollRefusal(group, stack)`; `makeEncounter(source)`; `defaultRollContext()`; and
`ROLL_CONTEXT_HOOK`
(`"acksExtrasGroupRollContext"`), called with `{scene, context}` for a feature to
write `context` in place. `groups.sizeFromEcology(source, context, state)` takes
the state (`"wandering"`, `"lair"` or null) as its third argument.

The elided trailing group and the full file-by-file surface are indexed in
**`scripts/lib/README.md`** — check there first. No gate compares that index
with the files, so a file added without its row is found only by reading. `scripts/lib/module.mjs` builds the exposed
object. Every path is under `scripts/lib/`.

## `tables` — layered rules-table registry (Foundry-free)

Documents are plain JSON carrying `id` (`{ id, source, tables, throws? }`).
Each id holds at most one document per **priority layer**; a read merges the
layers **per table**, the highest layer holding a table winning it, so a
partial layer never hides the tables beneath it:

| layer | who registers |
|---|---|
| `PRIORITY.SAMPLE` (0) | a module's own shipped config — automation and vocabulary only (extraction-program ruling: no book values, no samples), e.g. henchmen's `throws` and its one inferred `rarity` shift |
| `PRIORITY.CATALOG` (10) | premium/companion content modules |
| `PRIORITY.WORLD` (20) | per-world imported tables (via the `ruledata-import` contract) |
| `PRIORITY.OVERRIDE` (30) | a GM's hand edits: partial documents holding only the tables replaced in the location Ruledata Browser, persisted in the same store and reverted per table |

`registerTable(doc, {priority, source})` (same-layer re-registration
replaces — idempotent re-import) · `initTables(doc)` (drop-in alias, layer
0) · `unregisterTable(docId, {priority?})` (layer removal falls back to the
next-highest; no priority = remove all layers) · `getDoc` / `getTable` /
`getThrowDef` (the merged read; throw when absent — callers gate with
`hasDoc`) · `getLayer(docId, priority)` → that one layer as registered, or
null, never merged · `hasDoc` · `docInfo()` → `[{id, priority, source}]` for
diagnostics · `bracketRow(rows, value)` (null max = open-ended) ·
`bandDie(rows)` → `"1d<top>"`, the die of a table rolled on one die, its faces
the highest band edge (bands run up from 1 or from a band open below), or
null with no edge · `resetTables()` (silent) ·
`onTablesChanged(listener)` → unsubscribe (`listener(docId)` runs after a layer
registers or is removed, on the client that made the change; a surface that
draws from a table repaints from it, the way the marching column repaints its
lights).

**Rows an import could not read** (apiVersion 21). An importer stores
`{__missing: true}` where the page held no such row, and a later import
replaces the table. `isMissingRow(row)` recognises it; `bracketRow` and
`findRow(rows, test)` never return one, so a keyed or banded lookup answers
nothing for a gap instead of matching it; a consumer that finds a row by any
other route filters with `isMissingRow`. `incompleteRows(docId, tableId)` and
`missingRowKeys(table)` list the gaps as keys (never content), and
`missingCoverage` reports them per table in `incomplete`.

A writer that merges into what it wrote before reads its own layer with
`getLayer`, never `getDoc`: the merged read would carry an override or a
sample down into the write.

**Where a table was read** (apiVersion 20). A document may carry
`cites: { tableId: "RR p.505" }` beside `tables`, one citation per table in the
cookbook's form. The importer writes it: a raw table cites its recipe's printed
page (every block's page for a table gathered from several, only the blocks a
run actually read), and an assembled table cites the raw tables its binding's
`PRODUCES` map names. The classes registry cites each class table with its
class item's `source.cite`. `citeOf(docId, tableId)` answers from the layer a read
takes the table from, falling back to that layer's `source.pages`; it returns
null for a table no layer holds, and for one a Judge's override or a module's
sample supplies, since neither was read off a page. A document with no `cites`
shows the document's pages.

**A printed quantity** (apiVersion 20) is `{value, atLeast, per}`: a figure,
whether it is a floor ("4 or more") rather than an exact amount, and the unit a
rate is counted in ("per banner"), or null. `quantity(x)` reads that shape, or
a bare number, and returns null for anything holding no figure;
`meetsQuantity(q, amount)` tests an amount against it, and
`scaleQuantity(q, count)` multiplies a rate by its count and returns a flat
figure as it stands. A `proseValues` recipe writes the shape with
`take: "quantity"` (`scripts/importer/table-extract.mjs`).

`expectTables(docId, tableIds)` at `setup` declares what a consumer reads;
`expectedTables()` → `[{docId, tableIds}]` drives placeholder generation, and
`missingCoverage(docIds)` → `[{docId, expected, present, missing}]` is what
**missing-tables UX asks** — a shipped SAMPLE layer claims an id while
supplying none of the book tables, so `hasDoc` cannot answer "has this been
imported". The Foundry-side `missingTablesList(docIds)` (ruledata.mjs) turns
that into a localized list for a notice, naming a table that arrived with rows
unread apart from a table that did not arrive.

Consumers read ONLY through this registry — never another feature's name —
so any provider can substitute data without consumer changes.

## `services` — named-contract registry (Foundry-free)

`register(name, impl)` at `init`; `get(name)` from hooks onward (→ `null`
when absent, never a throw); `names()`. Contract names and shapes are
defined HERE, never by module ids.

### Contract `ruledata-import` v1

Provider: the location-domain binding target (the location feature). Consumers:
content import flows (the importer subsystem, `scripts/importer/`). Shape:

```
{
  importDoc(doc, {priority = 20, source}) → Promise<void>,  // persist + register
  removeDoc(docId, {priority = 20})       → Promise<void>,  // unpersist + unregister
  listDocs() → [{id, priority, source}],
  // v1.1 (additive): mirror every imported table into world documents
  materializeDocs() → Promise<{exported, placeholders}>,
  // v1.2 (additive): re-mirror the persisted store into the registry
  reload() → {layers, docs},
  // v1.3 (additive): the materialized documents, without the data —
  // count for a remove-all confirm, remove for the sweep itself
  countMaterializedDocs() → number,
  removeMaterializedDocs() → Promise<number>,
  // v1.4 (additive): count only what the SIDEBAR holds — for a consumer that
  // deletes the library's packs whole and has counted their contents already
  countMaterializedDocs({sidebar: true}) → number
}
```

Consumers hold no version handshake: each addition is feature-detected
(`svc.countMaterializedDocs?.()`), so an older provider simply contributes
nothing to the newer flow.

Persistence (world storage, re-registration on world load, GM permission
checks) is entirely the provider's job; consumers call `importDoc` and
nothing else. No provider registered ⇒ `get("ruledata-import")` is `null`
and import UIs say "no import target installed".

### Contract `ability-provider` v1

Provider: the content binding (the importer subsystem). Consumers: anything that
embeds proficiency/power items on an actor from name tokens (henchmen's
hire-time occupation packages). Shape:

```
{
  resolve(tokens: string[]) → Promise<{ items: ItemData[], missing: string[] }>
}
```

Tokens are printed proficiency names, optionally with a specialty and rank
("Craft (scribe)", "Military Strategy 2"). The provider resolves each to an
embeddable ability ItemData — reusing the world's already-imported item,
else importing the definition from its own pipeline — and reports what it
could not resolve; it never throws on content. The specialty suffix lands
on the embedded copy's name only. No provider ⇒ consumers skip granting.

### Contract `party-roster` v3

Provider: formation (`scripts/formation/party-roster.mjs`). Consumers: the
hit-point tool (`lib/hp.mjs`), which works on a whole party at once, the
summons (`lib/summons.mjs`), which reach a summon riding in a party token, and
the treasure pot's party aside and Quick grab (`list`, `members`, `pace`). Shape:

```
{
  list() → [{id, name}],                    // every party in the world
  partyOf(tokenDoc) → id | null,            // the party whose token this is
  members(id) → [{actorId, actor, name, document, stashed, unlinked, hp, summonedBy, summon}],
  adjustStashedHp(partyId, actorId, next) → Promise<{before, after, max} | null>,
  memberOfToken(tokenDoc) → {partyId, actorId} | null,
  release(partyId, ids) → Promise<{released: number}>,
  // v3 (additive)
  pace(partyId, actorId, {adding6}) → {rank, speed} | null
}
```

`summonedBy`, `summon`, `memberOfToken`, `release` and `pace` are optional to a
consumer: each is read with an optional call, and with one absent the consumer
does what it does with no party in play.

A member row:

- `actor` is the world actor the member was made from.
- `document` is what an update reaches the member through. It is the world
  actor for a linked member, the token's actor for an unlinked member on the
  map, and null for an unlinked member inside the party token.
- `name` is the token's for an unlinked member.
- `hp` is `{value, max}` from the member's own token, on the map or inside the
  party token, when the member is unlinked, and from the world actor otherwise.
  It is null when no value is known.
- `summonedBy` is the summoner's actor uuid and `summon` the cast record
  (`{sourceUuid, name, castId, at, spellId?, spellName?}`), both read off the
  member's own token data by `summonOfData` (`lib/summons-logic.mjs`), so a
  stashed member and a deployed one read alike. Both are null for a member that
  is no summon, and `summon` is null where the record carries no `castId`.

`adjustStashedHp` writes only a member whose `document` is null. `next(hp)` is
handed the value found inside formation's save lock and returns the new value,
or null to write nothing. It returns null for a player, for a member who is
linked or on the map, and when `next` declines. With no provider, a party token
is an ordinary token to the tool, and there are no party rows.

`memberOfToken(tokenDoc)` names the member a live scene token is, by the id
that member's row carries as `actorId`, or null for a token that is no
member's.

`pace(partyId, actorId, {adding6})` answers the pace the member would move at
if it bore `adding6` more weight, in sixths of a stone, than it does now: `speed`
in feet per turn and `rank`, its negative, so a larger rank is slower and ranks
compare as paces. The figure is formation's own, through the pacing carrier, the
Carrier's share of a casualty and core's movement calculation, so no encumbrance
step is stated by a caller. The added weight reads as the stone core will round
the member's load to, which is what the sheet shows once it has landed. A rider's
weight loads the carrier that sets the pace; two riders of one wagon are each
priced alone, not together. `adding6` below zero, absent or not a number is 0.
It is null for a member the party does not hold and where no figure answers. It
reads only and runs on any seat.

`release(partyId, ids)` ends the named members' membership, `ids` being row
`actorId`s, whether each is stashed or deployed at the time it runs. It removes
the member records first, then deletes the live tokens of the ones deployed, in
that order: a recall of the party then has no record to restore a deleted
creature from, and a token's deletion never finds a record left behind. It
runs on the GM's client only. It answers `released`, the count of members it
removed, and skips an id no member carries. It does not ask whether a member is
a summon: the caller has already authorized the dismissal.

### Contract `morale-roll` v1

Provider: the influence feature (its `morale` page). Consumer: the lib's
wrapper of the system's `Actor#rollMorale` (`patches/morale-roll.mjs`). Shape:

```
{
  open(actor, options) → unknown   // open the page for this actor; may throw
}
```

`options` is what the system passed to `rollMorale`. The wrapper calls `open`
in place of the system's roll when a provider is registered, the world setting
`moralePage` is on, and the system's skip-dialog key is not held; otherwise,
and when `open` throws, the system's own roll runs, with the creature's
conditions held on its score (`withMoraleConditions`). `open` is handed the
actor with its score as stored, and a page that wants the conditions reads
them from `conditions.rollMath("morale", conditions.subjectOf(actor))`.

### Contract `magic-item-roll` v2

Provider: the magic-items feature (`scripts/magic-items/roll-service.mjs`).
Consumers: any feature that rolls a magic item without importing it. Shape:

```
{
  roll({from, style, rarity, category, armsSetting, roller}) → Promise<result>   // never throws on table content
}
```

`from` is a list id, `"<table>.<column>"`, and wins over `style`. Otherwise
`style` is `classic` (with `category`, the category list's key, or none to roll
the type list that picks one), or `heroic` or `gritty` (with `rarity`, the rarity
list's key). `roller(expr) → {total, sides}` is optional, sync or async; the
default evaluates a Foundry `Roll`. The result is `{ok, reason?, start, steps,
item, error?, rolls}`. `ok` is false with a `reason` of `not-imported` (the
Judge's tables are not imported, and no figure stands in place), `rarity-required`,
`unknown-style`, or a walk error (`bands-untiled`, `roll-failed`, `die-mismatch`,
`roll-out-of-range`); `steps` then holds what was rolled before it. Each step is
`{list, die, total, band: {min, max}, inner?: {die, total, band}, fields, caption,
cite, overridden}`. `item` is `{list, text, fields, flag, ref, hop?, uuid}`: `flag` is
null or `unresolved-hop`, `missing-list`, `cycle` or `too-deep` (the item reached
where the chain could not go on). `ref` is the cookbook entry id the importer linked
the reached row to when it assembled the tables, else null; it is not one of `fields`.
`uuid` is the document of `ref` where a `cookbook-items` provider (below) answers
one, else null. `rolls` holds the Foundry `Roll`s of the default roller.

v2 adds the typing of an arm. A row the importer found to name an arm by its bonuses
alone carries `item.arms`, its link: `{grid}` (the arms grid that types it), `{kind}`
(the id of the weapon-kind list, which picks the grid) or `{name}` (the row's own noun
names the arm); the key is absent on any other row and is not one of `fields`.
`armsSetting` is a setting column's key in the arms grids (`s1` and on, named by
`armsSettings` in the document). With it, a `{grid}` link rolls that grid's column and a
`{kind}` link rolls the kind list and then the column of the grid it landed on, and the
type as the grid prints it is `item.armsType`. Its dice follow the chain's in `rolls` and
are not steps. `armsType` is absent, the roll still ok, when no setting is given (nothing
extra is rolled), the link is `{name}` or none, the ammunition grid is the one named (the
importer links none to it), a list or column is not imported, or a die is not the one
asked for. The setting is the caller's: the contract takes no default and rolls no type
without one.

### Contract `cookbook-items` v1

Provider: the importer subsystem (`scripts/importer/cookbook/magic-items.mjs`,
`cookbookItemsProvider`, registered at `ready`). Consumer: the magic-items roll
(`scripts/magic-items/roll-service.mjs`), which asks it only for a rolled row that
carries a `ref`. Shape:

```
{
  documentOf(id: string) → Promise<{uuid: string}|null>
}
```

`id` is a cookbook entry id (`<book>.item<n>`). The provider answers the Item the
importer made of that entry, one merged into another document included, and null
when none stands; a consumer treats a null, a throw and no registered provider alike
and leaves the uuid null. The roll's result carries the uuid as data; no card or
window draws it yet.

### Contract `template-generate` v1

Provider: monsters (`scripts/monsters/generate-host.mjs`). Consumer: the template
sheet's Generate press. `generate(template)` answers `{handled: false}` for a
template it does not own, and lib then generates a creature as it always has. For
one it owns it makes a host (a root group holding an empty top row whose `gen`
names the template) and answers `{handled: true, actor, tab?}`; the sheet opens
`actor` (on `tab` where it names one) and generates nothing. Lib never learns what a recipe is.

### Contract `org-chart` v1

Provider: monsters (`scripts/monsters/org-chart-service.mjs`). Consumer: the organisation chart.
`badges({actor, row})` answers `[{corner, label, tip, icon, byHand}]` for a leader's head;
`troopOf(stack)` answers `{current, options: [{key, label, offBands}]}` or null; `prototypeFor(stack,
troop)` answers the uuid of the prototype for the stack with that troop, found or made by the Roll's own
mint. No provider means no badge and no troop select; the chart still draws and edits.

### Contract `org-roll` v1

Provider: monsters (`scripts/monsters/org-roll-service.mjs`). Consumer: the organisation chart's Roll and Design panels.
`describe({family, variant, context, state, rules, chosen})` answers `{choices, make, shares, troops, special}` or null where
the variant carries no encounter line: `choices` are the choices where the page is silent that the variant can reach, each
`{name, label, tip, options: [{key, label, selected}]}`; `make` is `{line, rows}`, what a Roll will make, read from the
imported parts as expressions, chances and page references and never rolled; `shares` and `troops` are the options of a unit
slot and `special` is the share a troop pick is read under. Pure reads: nothing is rolled or written. A chart with no provider
draws neither section.

### Contract `encounter-generator` v1

Provider: the monsters feature (its recipe evaluator), which registers it at `init`.
Consumer: the lib's groups, which ask it to make the stacks of a unit the Judge has not
filled, and which read nothing else of the provider. No provider registered means
`get("encounter-generator")` is null and a consumer offers nothing to generate. Lib
declares the contract and calls nothing through it yet; the shape below is the one
the provider is built to. It is a name and a shape here and registers nothing in
`scripts/lib/services.mjs`, since a registration with no provider would read as one.

```
{
  generate({unit, count, context, state}) → Promise<{
    stacks: [{creature, label, count, gen: {part, cite}, fixedHp?}]
  } | null>
}
```

`unit` is the unit word the importer read, `count` how many of it, and `context` and
`state` the line and side of lib's own Roll. Each answered stack is data for
`groups.addStack` (a `creature` the provider resolved to an actor) or, with no creature
resolved, `groups.addLabelledStack` (the `label` alone). `gen` names the recipe part and
its page, and `fixedHp` is the figure the part prints where it prints one. A null is a
unit with no recipe, which a consumer treats as no provider.

## `org` — the organisation chart (apiVersion 74)

`acksExtras.lib.org`. The shape, the rules of each control and the reasons they
answer are docs/lib/ORGANISATION.md's; this is the surface.

| Call | Answers |
|---|---|
| `orgHostOf(holderUuid)` | `{host, row}`, the actor hosting the chart and a plain copy of the row that names the holder, or null. The faction answers where a row stands on both a faction and a group. Reads affiliation, never location |
| `unitsOf(host)`, `orgHosts()`, `chartRows()` | A host's rows as plain objects; every actor hosting a chart; every row of every chart, flat |
| `addRow(host, parentKey, {label, kind, notes})` | `{ok, key}`: an empty row under any row, or at the top |
| `setHolder(host, key, holderUuid)` | `{ok}`: names the actor holding a row, blank to empty it |
| `sendOut(host, key, placeUuid)` | `{ok, group, made}`: the group onto a place's roster, out of its parent group; an empty row's group is made |
| `recall(host, key)` | `{ok}`: the group back under its parent row's group, off every roster |
| `join(group, faction, underKey)`, `leave(faction, key)` | `{ok, moved}`: a chart joins a faction, or a subtree leaves onto its top row's group; each writes one host, then the other |
| `orgChart(host)`, `locations()` | The two view models |
| `chartOf(group)` | `{host, row, above, below}`: the group's place in whichever chart names it |
| `moraleFromUnitsAbove(group)` | The part the units above a group bring while their officers are up |
| `runPlan(plan, {mint, makeLeader})` | `{ok, reason?, error?, done, created, made: {groups, prototypes, leaders}, reused, refs}`: carries a `planRoll` or `planAddUnit` plan out in order with a ref map. `mint(spec, {key})` answers `{actor, made}` and `makeLeader(op, spec, mount)` the leader's actor; lib names no creature. `created` is every id made, on a failure too |
| `deleteRow(host, key)` | `{ok, rows, groups, prototypes, kept, leaders, warnings}`: the row and its subtree, the groups they hold, and each prototype carrying `ORG_PROTOTYPE_FLAG` that no stack still names; bodies on a map are `warnings: ["onMap"]` and a whisper to the Judges |
| `planRoll`, `planAddUnit`, `planEdit`, `planDelete` | The Foundry-free plans (docs/lib/ORGANISATION.md) |

A refusal is `{ok: false, reason}` and nothing is written. The pure half is
`nodesOf`, `rowAncestors`, `rowDescendants`, `rowRoots`, `subtreeKeys`, `twinKeys`,
`isEmptyRow` and `affiliationRows`. `fields.unitField()` is the row both
`FactionData.units` and `GroupData.units` store.

## `vocab` — Foundry-free enums (Node-importable)

Enum objects are `{ key: { label, … } }`; `vocab.choicesOf(enumObj)` maps them
to `{ key: label }` for DataModel `choices`.

- **Shared with the monsters feature** (value-identical mirror until its deferred
  migration): `DAMAGE_TYPES`, `MOVEMENT_TYPES`, `VISION_TYPES`, `SENSE_TYPES`,
  `NATURAL_WEAPONS`, `ALIGNMENTS`.
- **Ability effect model** (new): `ABILITY_CATEGORIES`, `EFFECT_TYPES`
  (spell kinds marked `domain: "spell"`, `slay` and `destroyItem` among them;
  `effectTypesFor(domain)` is a picker's list), `MODIFIER_TARGETS`, `EFFECT_KEYS`, `CONDITION_KEYS`,
  `PROGRESSION_CLASSES`, `RESOURCE_KINDS`, `ROLL_TYPES`, `REROLL_KEEP`,
  `VALUE_SCALES`, `CONVERSION_STATUS`.
- **Magic families** (`magic-vocab.mjs`, re-exported here): `SPELL_TYPES`,
  `RANGE_SHAPES`, `DISTANCE_UNITS`, `DURATION_SHAPES`, `TIME_UNITS`,
  `CONCENTRATION_KINDS`, `CASTING_TIME_SHAPES`, `TARGET_MODELS`,
  `AREA_SHAPES`, `TARGET_FILTERS`, `SAVE_CATEGORIES`, `SAVE_EFFECTS` (`none`
  marks a row no save governs), `EFFECT_LASTS` (`instant`, `duration`,
  `nextTurn`, `followingTurn`, `rounds`),
  `EFFECT_RECURRENCES` (`none`, `eachRound`, `laterRounds`) and the three a
  recurring spell row names: `EFFECT_RECUR_MOMENTS` (`recurAt`),
  `EFFECT_RECUR_SAVES` (`recurSave`: `row`, `cast`, `fail`), `EFFECT_RECUR_TARGETS` (`recurTarget`),
  `HEAL_KINDS`, `CONTROL_KINDS`, `CONTROL_ENDS` (a summon row's `controlEnd`:
  `stays`, `gone`, `hostile`), `SUMMON_FORMATS`, `SPELL_LIKE_FREQ` (the
  one frequency table; the monsters feature's `USAGE` is this), the
  `MAGIC_VOCAB` registry keyed by lang id, and `vocabLabel(family, key)` /
  `vocabChoices(family)` — the label from `ACKS-LIB.enum.<family>.<key>`
  when the client has it, else the inline one.
- **Scoping**: `INFLUENCE_TONES`, `SCOPE_ALIGNMENT_MODES`.
- **Roll outcomes**: `OUTCOME_TRIGGERS` and `outcomeFires(effect, {natural,
  total, target, success})`. An `outcome` effect states "on a roll of X, Y
  happens" — a botch band on the natural die (`naturalBand`/`naturalMax`), the
  result under a fraction of the target (`belowFraction`), or plain `failure`.
  The band edge and fraction are page numbers and locate per-seat; `consequence`
  is a chef conclusion in own words. Owner ruling 2026-08-01: such rules are
  mechanics, never prose. `outcomeFires` returns `null` for "cannot decide" (no
  natural die supplied, number not located) — surface it, never treat as false.

### Scoping — when a modifier applies

`condition` on an effect is free text a human reads. The scoping fields are the
part a machine can decide, and `scopeApplies(effect, ctx)` is the one place
that decides them.

| field | meaning |
|---|---|
| `vsKinds` | target kind tokens (`animal`, `dwarf`, `human`, `demi-human`, `monster`). The token vocabulary belongs to the **consumer** — lib carries the list and matches it. |
| `vsAlignment` | an `ALIGNMENTS` key the target must be |
| `vsAlignmentMode` | `gate` (default) — applies only versus that alignment; `sign` — applies always, negated otherwise; `except` — applies versus every alignment but that one |
| `vsAlignmentOf` | `source` — the reference alignment is `ctx.sourceAlignment`, whoever the effect comes from, in place of a fixed `vsAlignment` |
| `vsEnemy` | applies only where the roll's other party and the effect's bearer stand on opposing sides (`ctx.enemy`) |
| `anyOf` | a list of branches, each holding `vsKinds`, `vsAlignment`, `vsAlignmentOf`, `vsAlignmentMode` and `vsEnemy` and never a `sign`; the effect's own clauses AND it |
| `tones` | restrict to some of the three `INFLUENCE_TONES` |
| `optionalRule` | obeys a world setting of this name; **absent means enabled** |
| `kickerAt` / `kickerNote` | a rider that fires when the roll total reaches `kickerAt` (Mystic Aura's bewitched rider) |

```js
scopeApplies({ vsKinds: ["animal"] }, { kinds: ["animal"] })
// → { applies: true, sign: 1, undetermined: false }
```

`gate` and `sign` are separate modes because the books write both and they are
different rules: Ancient Pacts applies against Chaotic monsters and nothing
otherwise; Deathly Visage applies a bonus versus Chaotic and a penalty versus
everyone else. Storing either as the other is wrong, in the direction that
matters most.

`ctx` carries `kinds`, `alignment`, `sourceAlignment`, `enemy`, `tone` and `optionalRules`. On a
defensive row (a bonus a recipient gains against an attacker) it describes the
ATTACKER, and `enemy` is the attacker's side against the recipient's, the
bearer's, never the caster's. The readers are lib's: `alignmentKey(text)` folds a free-text alignment
to a key (null for "None", blank or anything else), `actorAlignment(actor)`,
`creatureKinds(actor)` and `areEnemies(tokenA, tokenB)` (`actorRead`). `actorRead`
also reads a creature's size: `sizeKeyOf(actor)`, `rankOfSize(key)` and
`sizeRank(actor)`, its place in the monsters feature's size ladder, null where no
ladder or size is known.
`hasScope(effect)` is true when an effect declares any target-side clause, and
is what `modifierDisposition` and influence's target gating ask; a tone is the
roll's, not the target's, and does not count.

`anyOf` is three-valued. It applies when a branch applies; failing that it is
undetermined when a branch is; failing that it fails. Inside a branch a failing
clause fails the branch whatever another clause leaves undetermined, and a branch
that declares no clause is undetermined. A top-level clause that fails fails the
effect, and one that is undetermined leaves it undetermined, so an effect is
never applied on a branch alone. `vsEnemy` is true for an enemy, fails for the
same side, and is undetermined for a neutral, secret or missing token. The row
editor shows an `anyOf` as text and keeps it as stored on every edit.

**`undetermined` is the field to respect.** It means a scope was declared but
`ctx` could not settle it — an untyped target, no tone chosen yet. That is not
the same as a scope that failed, and collapsing the two makes a bonus vanish
against a target the GM simply has not classified. Offer an undetermined
modifier as a manual toggle; never drop it and never auto-apply it.

### LevelValue

A value that may be flat or a function of class level. `resolveLevelValue(lv,
level, scales)` returns the number at `level`:

| shape | example | @level → |
|---|---|---|
| flat number | `5` | `5` |
| `{ kind:"perLevel", base, per }` | `{base:18, per:-1}` | `18 + per·(level−1)` |
| `{ kind:"breakpoints", breakpoints:[{atLevel,value}] }` | `+1/+2/+3 @1/7/13` | last `value` whose `atLevel ≤ level` |
| `{ kind:"progression", as, atLevelNum, atLevelDen }` | thief skills | `null` — caller resolves via the class table |
| `{ kind:"conditional", on, breakpoints }` | cost by Arcane Value | ladder keyed on `scales[on]`, not level |

A `conditional` reuses the breakpoint ladder unchanged — only the number fed
into it differs — so `atLevel` there reads *"at this value of `on`"*. `on` is a
`VALUE_SCALES` key. Returns `null` when the caller did not supply that scale.

### The invocation level (apiVersion 60)

`VALUE_SCALES.invocationLevel` is a scale marked `domain: "spell"`: a cast
supplies it as `scales.invocationLevel`, so a conditional keyed on it resolves
at the level the caster invoked at, `null` below its first rung and `null` when
no level is supplied. `valueScalesFor(domain)` is a picker's list on the rule
`effectTypesFor` uses (`"ability"` leaves spell-domain scales out; the ability
roll editor offers that list, and a stored scale stays selectable).

An effect row also carries `invocationFrom` and `invocationTo`, nullable whole
numbers bounding the levels it applies at, both inclusive, a blank side open.
`rowInInvocationRange(row, level)` is the reader (on `vocab`): a row with
neither bound is in at every level, with or without one; a bounded row with no
level set is out; a side counts as set only when it is an integer. The
effect-row editor offers both fields on every spell-domain kind.

A rung of a `conditional` ladder (`breakpoints[]`) may also carry `hand`
(`"edited"` or `"added"`, blank as imported), `was` and `wasAt` (the figure and
level an edit replaced): display marks a Judge's edit in the rung editor
leaves, read by nothing that resolves. The rung editor is not on the lib api;
its model is `rung-ladder.mjs` (magic MODEL, "The rung editor").

### Rerolls

`{type:"reroll", keep, times, target, rollType}` — `times` counts the *extra*
rolls and defaults to 1, so the common "roll twice" needs no field set.
`resolveReroll(results, keep, rollType)` picks the result that stands, and
`rerollTotal(effect)` says how many to roll.

**"Better" is not "higher."** ACKS throws run both ways: an attack or
proficiency throw is roll-high (`above`), so better is the maximum; a roll
measured against a ceiling (`below`) is roll-low, so better is the minimum.
Pass the effect's own `rollType` and the polarity stays honest.

### Companions

`{type:"companion", ref, actorUuid, amount, note}` — `ref` is the **monster
entry id** the ability confers, when the page names one. The pointer ships; the
creature's text does not. `actorUuid` is the bucket the actor lands in: the
importer's fill pass writes it from `ref`, and for a slot the page leaves to
the reader the table chooses (acks-extras `abilities/companions.mjs` — the
slot, the picker and the sheet section are `docs/abilities/MODEL.md`).
Empty, a bookless seat still gets the slot and fills it later.

### Capabilities — the gate pattern

A **capability** is what an ability lets you do, named independently of which
ability grants it. Abilities declare what they `provide`; prerequisites, gates
and stacking are written against the capability.

| token | meaning |
|---|---|
| `def.<class>.<slug>` | one exact ability |
| `kw:<slug>` | a capability — any ability providing it |

Either form works anywhere a ref is accepted (`requires`, `ifHas`,
`stacksWith`, `notStacksWith`).

```js
satisfies(abilities, token)       // abilities: [{ id, provides }]
satisfiesAll(abilities, tokens)
capabilityForId("def.prof.sensingEvil")   // "kw:sensingevil"
nonStackingGroups(abilities)      // { capability: [ids] } held more than once
```

This exists because the books print one capability several ways. *Searching* is
a thief skill, a proficiency, and what several class powers hand out — and an
alias prints it under another name again. A gate naming `def.prof.searching`
misses every other route to it; `kw:searching` catches them all. An ability
always implicitly provides its own id's capability, so a gate resolves before
anything has been tagged.

It also collapses aliases and non-stacking into one mechanism: two abilities
providing the same capability *are* that capability twice, so they do not stack.
That falls out of the data instead of being asserted per pair.

### Conversion status

`CONVERSION_STATUS[status]` → `{ label, severity, icon, tip }`, and
`conversionTip(status, name)` fills the `{name}` placeholder. All three are
marked: `renamed` is a note (*"{name} has been renamed for ACKS II"*), `deleted`
a caution, `absent` an info. Read the wording from here so the family says the
same thing everywhere.

## `fields` — DataModel field-builders (Foundry-only, lazy)

Each is a function dereferencing `foundry.data.fields` only when called (at model
definition). Leaf helpers `num/str/bool/html/choice/choiceSet`, plus:

- `levelValueField()` — a LevelValue SchemaField.
- `spellRefField()` — **placeholder** (`{uuid, name}`) pointing at the core
  system's existing spell item. See *Not yet consumed* below.
- `defensesField()` — `{ immunities, resistances, susceptibilities }`, each
  `{ damage:Set, effects:Set, conditions:Set, mundane, extraordinary,
  silverFlaw, note }` (the shape the monsters feature’s defenses adopt on
  migration); a susceptibility also holds the creature's own nullable `factor`
  and `save`. How the bands act on damage is `lib/defenses.mjs`, not yet on this
  api (docs/lib/MODEL.md, "Damage against defenses").
- `speedsField()` / `sensesField()` / `visionField()` — Speed/Senses/Vision
  shapes shared with the monster sheet.
- `effectField()` / `effectsField()` — one typed effect primitive (wide
  all-optional schema discriminated by `type` ∈ `EFFECT_TYPES`) and the array of
  them. This is what the abilities feature stores as an ability's `effects[]`.
  A spell row also carries `pickOption` (its option within a `pick` group),
  `recurAt`, `recurSave`, `recurTarget`, `rounds` (a dice formula for a `rounds`
  lasting) and `exemptSizeFrom` (a monsters size key, a string: lib sits below
  the monsters feature). `ignite` is a spell kind with no arithmetic. A
  `spellcastingMod` row (a caster ability that buffs certain spells) narrows on
  `schools`, `elements`, `saveCategories` (word lists), `bySelection` (the
  ability copies' picks name the spell's element or school), `spell` and
  `spellRef`; a damage row's `perDie` multiplies its size by the scaled
  formula's dice. The words are authored structure, the sizes are located.

### Relational effects — requires / grants / modifies, stacking and chaining

ACKS abilities constantly depend on, confer, or alter *other* abilities, so
these are structured refs rather than free text. Any effect may carry:

| field | meaning |
|---|---|
| `ref` / `refs` | the ability this effect targets (`modifies`), requires, or grants |
| `name` | the name of the document `ref` points at, as the import materialized it (a summon row's creature); a label, never matched on |
| `ifHas` | gate — applies only while the character *also* has these |
| `mode` | `add` \| `replace` \| `set` ("instead of" is a replace variant) |
| `stacksWith` / `notStacksWith` | explicit stacking rules |
| `choose` | for `grants`: pick N of `refs` |

How the book's recurring shapes map:

- **Modifies another ability** — one that adds to the throws of two others:
  `{type:"modifies", refs:[hiding, sneaking], target:"proficiencyThrow", value:N, mode:"add"}`.
- **Conditional override ("instead")** — Alertness is a stand-in throw that a
  separately held Searching replaces with an additive bonus: a `searchListen`
  throw (read only where no skill is held, as the Adventuring figure's
  stand-in) plus one additive row per skill,
  `{type:"modifies", refs:[searching], ifHas:[searching], value:N, mode:"add"}`.
  The row names a capability, so it follows the skill however the item is named;
  with no skill held it is not applied.
- **Stacking rules** — Diplomacy's reaction bonus stacks with Mystic Aura but
  not Intimidation or Seduction:
  `{type:"modifier", target:"reaction", value:N, stacksWith:[mysticAura], notStacksWith:[intimidation, seduction]}`.
- **Chaining / partial stack** — Counterspelling adds caster levels, and a
  larger number with Bright Lore of Aura: the base
  `spellcastingMod` plus `{…, ifHas:[brightLoreOfAura], casterLevelDelta:N, mode:"replace"}`.
- **Prerequisite** — Eldritch Warrior *requires* Eldritch Talent:
  `{type:"requires", refs:[eldritchTalent]}`.
- **Grants a choice** — Expert Traveler begins play with one of two named abilities:
  `{type:"grants", refs:[driving, seafaring], choose:1}`.

### Typed modifiers — which rows change the sheet

`lib/typed-modifiers.mjs`, Foundry-free. A `modifier` row on a character's
ability is resolved in this order (`modifierDisposition`):

1. a target another feature reads (`reaction`, `morale`, `loyalty` →
   influence; `proficiencyThrow` or an `appliesToRoll` → abilities;
   `marketClass`, `retainBonus`, `baseLoyalty`, `henchmanMorale` → henchmen;
   `marketImpact` → markets) is **consumed** there;
2. a `mode` other than `add`, or a subject other than self or opponent, is
   **unsupported**;
3. a `vsKinds`, `vsAlignment` or `tones` scope, or a `forWhat` narrower than
   any field, waits **at the roll**;
4. a target with no field (`MODIFIER_PATHS.character`: `ac`, `save`,
   `initiative`, `surprise`, `cleaves`, `attackThrow`, `damage`) is
   **unsupported**; a save `forWhat` naming one save writes that save's target
   (subtract), and `melee`/`missile` narrow attack and damage;
5. a `gate` whose kind has an evaluator is **gated**; one with none, or any
   `condition`, is **situational**;
6. the rest is **standing**.

`gate` (`effectField`) is `{kind, armourMax, noShield, loadMax, style, status,
condition, round: {from, to}, ratio, side, band}`; the
importer reads its figures off the page (`loadMax` through a `gate.loadMax`
locator, the `armourMax` rung through a `gate.armourMax` locator whose captured
clause the armour-limit word table maps to a ladder key) and the recipe ships
only the kind. A gate with no rung answers null. Evaluators
answer true, false, or null when they cannot decide, which lists the row as
situational: lib registers `status`, equipment `lightlyEquipped` (armour rung
and load in stone, against the loadout), `activeStyle`, and `specializedStyle`
(the active style, specialized in; `docs/equipment/MODEL.md`). The
`armourCeiling` gate is read off a `limitation` row, not a modifier: true is
"the limit stands now" (`docs/equipment/MODEL.md`, "Armour limits on abilities").

`standingModifiers(actor, {ctx, resolve})` values the standing and gated rows
(the classes resolver where loaded; rank from `abilities.rankOf`, else the
copies) and then:

- **copies** of one definition (one cookbook id, else one name) count once;
- **stacking**, per field: the largest first, and a part is dropped when it
  shares a capability (`kw:` + its id's tail, or a `provides` token) with one
  kept, or either names the other in `notStacksWith`; a `stacksWith` pair
  always adds; everything else adds;
- **stand-aside**: an ability whose own enabled Active Effect writes a field
  contributes nothing to it.

It returns `parts` to write and `listed` rows left out with a `reason`
(`unresolved`, `gateOff`, `gate`, `condition`, `scope`, `narrowed`,
`standAside`, `notStacking`). Monsters and other actor types get nothing.
`isUnverified(item)` is true for a scan's rows (`extras.effectsFrom`, else
`unaudited`). The equipment loadout effect is the one writer
(`docs/equipment/MODEL.md`).

`spellcastingRows(actor, {resolve})` gathers a different kind of row: the
`spellcastingMod` rows of an actor's abilities, which no reader above sees
(each filters on `type === "modifier"`). It returns `[{item, spec, index,
value, selections, ref, unverified}]`: copies of one definition count once,
`selections` pools every copy's picks, `value` is the located figure at the
actor's level (null when blank, the row kept), `ref` is what `stackingPart`
takes, and `unverified` is the scan's flag. It matches nothing to a spell; the
cast does.

`modifierDisposition(spec, {actorType, bearer = false})` takes one opt-in. With
`bearer`, a row on a record is read on the actor that carries it: a `target`,
`recipient` or `area` subject reads as `self`, and the actor-type refusal (step 0
above step 1) waits until the at-the-roll answers have been tried, so a monster
bearer's scoped or item-gated row answers `atRoll`. Without it every answer is
the one this section lists; the ability sheet and quick effects never pass it.

`registerGate(kind, evaluate, {at})` takes `at: "roll"` (the roller's place or the
attack's moment: a token's light, the attack-moment gates below; `isRollGate`) or `at: "item"` (the weapon of the roll,
`ctx.item`; `isItemGate`). A row gated by an item gate answers `atRoll` with
reason `item`, right after the roll-gate test and on either path, and never
reaches `rollGatedModifiers`. A later registration of a kind replaces its timing.
`weaponMundane` and `weaponMagical` are item gates (`roll-mods.mjs`).

**Attack-moment roll gates** (`roll-gate-kinds.mjs`, each `at: "roll"`, each read
with the attack's context `{token, target, targetActor, item, type}` that
`roll-gates.mjs` passes). Each answers true, false or null, and null whenever
its context or its figure is missing; every figure comes from the gate, which
the import fills, never from source.

| Kind | Figure on the gate | Reads | True when |
|---|---|---|---|
| `targetCondition` | `condition`: condition ids of `conditions.mjs`, a list stored as written (a bare string from a caller is one) | `targetActor.statuses`, closed over what each condition implies (`conditionSet`) | the target carries any named condition. An id the catalogue lacks is ignored; none left is null |
| `combatRound` | `round`: `{from, to}`, either bound optional, equal bounds one round (the schema stores the span; a caller's bare number is read as that round) | the `round` of the combat the token fights in: `token.combatant`'s, else the combat on the token's scene that holds it, the active one first (core's getter sees only the combat this client's tracker views; `outnumbering` reads the same combat) | the round is inside the span. A token in no combat, or a combat at round 0, is null |
| `outnumbering` | `ratio`, and `side: "against"` to read the opposing side; `strict: true` for a clause that prints no ratio | the dispositions of the undefeated combatants of the token's own combat (`areEnemies`: friendly against hostile; neutral and secret tokens count for neither side), each counting the bodies it stands for (`bodyCount`: a stack its living bodies, any other actor one; a combatant whose actor cannot be read counts one) | the bearer's side, itself included, is at least `ratio` times the other side's (with `against`, the other side at least `ratio` times the bearer's). With no ratio and `strict`, strictly more than the other side (the other side strictly more than the bearer's, with `against`); a ratio that is read wins over `strict`. With neither a ratio nor `strict`, null, since that is a ratio the import failed to read. A neutral or secret bearer, no combat, or nobody on the other side is null |
| `rangeBand` | `band`: `melee`, `short`, `medium` or `long`, a list stored as written | the delivery `type`; for `missile` and `thrown` the gap between `token` and `target` (`tokenGapFeet`) against the weapon's `system.range` reaches, in feet | the attack's band is the one named. The band is the nearest whose reach the gap does not exceed, not the choice made in the system's attack dialog, which no contributor sees. No target, no weapon reaches, another scene, or beyond the long reach is null |
| `allOf` | `of`: a list of gates | each gate of the list, asked through `gateVerdict` with the same context | every gate in the list is true. Any false is false; with none false and one undecided, null; an empty or missing list is null |

`roll-gates.mjs` `gateLabel(gate)` names the gate for the row's label by kind
(`ACKS-LIB.gate.*`; the light level for `light`, the children's phrases joined
for `allOf`, the kind itself for a kind with no phrase). Two readers ask a gate:
the throw's contributor in `roll-gates.mjs` (the whole context above) and
`roll-mods.mjs`' record parts, which hand a gate `{item, token}` only, so a record
part under `targetCondition` or `rangeBand` answers null and `combatRound` and
`outnumbering` read the attacker's token. The surprise reader
(`surprise-parts.mjs`) and the social-roll reader (`influence/ability-effects.mjs`)
ask with the context they hold (`{}` and `{token}`), so a gate that needs more
answers null there.

**What the roll-gates contributor answers** (the attack seam's questions, one owner):

- `attack`: a labelled row for each `attackThrow` modifier whose roll gate answers
  true; it also records the delivery on the context in flight (`ctx.delivery`),
  which the formula answer reads.
- `damage(ctx, attackType, rows)`: the same for `damage` modifiers
  (`rollGateDamageRows`), with the same label, `{name} · {gate} ({page})`. The
  contributor's `carriers` stays `["attack"]`: a spell's damage is the spell's own.
- `damageFormula(item, mode, formula)`: for `damageDice` rows, a `CONSUMED_TARGETS`
  entry whose consumer is `roll-gates`, read with `consumedRows` and asked
  `gateVerdict` under `type: ctx.delivery` (`diceMultipleOf`). The count of every
  dice term in the formula is multiplied by the largest whole value of two or more
  among the rows that answer true (`multiplyDice`); a flat term, a formula with no
  dice term, a row with no delivery recorded, and a row whose gate cannot decide
  are left alone, and `ui.notifications.info` names the part once per attack
  (`ACKS-LIB.gate.diceMultiplied`). A row with no gate always answers.

`stackingPart({value, label, ref, stacksWith, notStacksWith, ...rest})` is the
one way to build a part for `resolveStacking`: it always gives `caps`
(`capabilitiesOf(ref)`, the capabilities a `{id, provides}` reference provides)
and `ref`, which the resolver reads, and passes every other field through.

## Not yet consumed (built ahead of the magic work)

These exist so the shape is agreed before anything depends on it. Nothing reads
them today; treat a change here as cheap until magic lands.

- **`VALUE_SCALES.arcaneValue` / `.divineValue` + `conditional` LevelValue.** A
  custom-class power can cost differently by the class's spellcasting value
  ("1 power at Arcane Value 1–2, 2 at Arcane Value 3–4"). The resolver handles
  it; the abilities feature still stores a plain numeric `powerValue`. **TODO(magic):**
  move `powerValue` onto `levelValueField()`.
- **`spellRefField()`.** Points at the core system's spell item by uuid with the
  printed name as a fallback — a link, not a model. Consumed since 9.0.0 by the
  spell primitive's `reverseOf` (`scripts/magic/spell-extras.mjs`, which is the
  model: lists, type, range and duration shapes, target, save, reversal,
  ritual, effect rows) and by `effectField.spellRef`, which the free-text
  `spell` string on `effectField` still shadows for rows written before it.

## `weapons` — the weapon seam (module-internal, not on the api)

`scripts/lib/weapons.mjs` exports `weaponRow(key)`, `weaponKeys()`,
`keyForName(name)`, `hasWeaponRows()`, `weaponFocusGroup(key)`,
`weaponThrowsAsAnyone(key)`, `listedKind(table, text)`,
`optionUnits(id)`, `optionFindings()`, `martialOption(pick)` and `registerWeaponSource(source)`. Features import them from the file; `lib.*`
does not carry them. A feature outside this module reads a weapon through the equipment
API's `classifyWeapon`; its `config` holds no weapon table. The contract is docs/lib/MODEL.md, "The weapon seam".

## `senses` — what a creature perceives

`senseProfile(actor, {litBy})` answers `{seesInDark, sightRange, visionMode,
detection, suppressed}` and `canSeeInDark(actor)` the movement rule's reading of
the same answer. `sightRange` is **null** where the figure it stands on is not
imported: the shadowy senses' radius, or Night Vision's multiple with light
reaching the creature, or the default reach a dark sense takes when the stat
line records none. A sense with no radius is still the sense (`seesInDark`
holds) and adds no `detection` range. Callers test `sightRange > 0` for a figure
to show, and `== null` for the "not imported" state.

`shadowySenseRange()`, `lightlessDefaultRange()` and `nightLightFactor()` read
the `senses` ruledata document (`SENSES_DOC`, tables `shadowySensesProse`,
`lightlessDefaultProse` and `nightVisionProse`) and answer a positive number or
null; `senseCite("shadowy" | "lightless" | "night")` is the page the table was
read from, null where it is the Judge's own. The importer reads both ([docs/lib/MODEL.md](MODEL.md),
"Perception: senses, light, and the token").

## `capacity` — what a document can hold and is holding (apiVersion 47)

`capacity6`, `load6`, `overCapacity`, `capacityStone` and `loadStone` answer for a character, a monster or mount and a container item. A man-sized body's weight is imported (`capacity` ruledata document, table `riderBody`, RR p. 161), so `riderBody6()`, `borneBy6(actor)` (body plus kit) and, for a mount bearing such a rider, `load6` and `loadStone` answer **null** where the weight is unknown; `overCapacity` reads a null load as not over. `bodyWeight6(actor)` is one body, `statedBodyStone(actor)` the creature's own stated weight, `riderBodySource()` and `riderBodyTip(actor)` say where the figure came from. `RIDER_BODY6` is gone. See [MODEL](MODEL.md), "Capacity".

## `timeUnit` — the dungeon turn and the round (apiVersion 72)

The dungeon turn and the round are the module's own units of game time (RR
p. 263), stated in `time-unit.mjs` and read from nowhere else: `constants`
carries no time constant, and no ruledata document holds one. The exports are
`ROUNDS_PER_TURN`, `TURNS_PER_HOUR`, `SECONDS_PER_HOUR` and `HOURS_PER_DAY`, and
the readers over them, each a positive number: `roundsPerTurn()`,
`turnsPerHour()`, `turnsPerDay()`, `turnSeconds()` (the hour over the turns it
holds) and `roundSeconds()` (the turn over the rounds it counts).
`timeUnitCite()` is the page, `"RR p.263"`. A consumer converting rounds to
world seconds reads `roundSeconds()` at the time it converts. The ruling is in
[DECISIONS](DECISIONS.md).

## `movementScales` — the expedition figures

No feet-per-mile, march-hours or wilderness-factor constant exists, and
`TRAVEL_PACE` entries carry `label` and `hoursKey` (the name of the figure the
pace's hours are read under) and no `multiplier` or `hours`. The figures are the `expedition` table of the `travel` ruledata
document (`TRAVEL_DOC`, `EXPEDITION_TABLE`; keys `EXPEDITION_KEYS`):
`declareMovementTables()` registers the expectation, `expeditionFigures()`
returns the figures (each a positive number or null) and `expeditionCite()` the
page the table was read from, null for a Judge's override.

- `paceFigures(pace)` answers `{hours, multiplier}`, each null where the table
  lacks its figure. The multiplier is the pace's hours over the dedicated day's.
- `expeditionFrom(feet, {multiplier, pace, milesPerHex})` answers null
  `milesPerDay`, `hexesPerDay` and `milesPerHour` where their inputs are not
  imported; `explorationFeetPerTurn` stays a number. `explorationFromExpedition`
  and `inWilderness` answer null likewise.
- `expeditionTip({pace})` is the provenance string for a tooltip, already
  localized (the "not imported" text where nothing is), so a caller joins it
  or hands it to `data-tooltip-text` as it is.

The formation `marchBudget` and `dayBudget` return null hours and miles, and
the vessel `compareToMarch`'s `partyPerHour`, `marchHours` and `faster` are
null, where a march is unpriced. Callers test `== null` for the "not imported"
state, never `> 0` alone. The mechanics are [docs/lib/MODEL.md](MODEL.md),
"Expedition figures".

## `repair` — the standing repair tool (apiVersion 18)

How the tool behaves is docs/lib/MODEL.md, "The repair tool". `scan` and `fix`
throw for a seat that is not a GM, and `open` warns and returns null.

```
acksExtras.lib.repair = {
  register(spec),                   // → the frozen check; call it at `init`
  checks({only}?),                  // → the checks this world meets, in window order
  async scan({only}?),              // → [{id, findings, error}]
  async fix(id, keys, {report}?),   // → {id, fixed, failed, gone, rescan}
  open({only}?),                    // the window, scoped to `only` when given
  danglingRefCheck(spec),           // → a spec for register()
  async fixEach(findings, fn),      // → the result list a fix returns
}
```

A spec is `{id, label, hint?, scan, fix?, order?, requires?}`:

- `id` is `<feature>.<name>`. A second registration of one id throws.
- `label` and `hint` are lang keys.
- `scan()` is read-only and returns findings
  `{key, uuid?, name, detail, fixable?, reason?}`. `key` is unique within the
  check: a duplicate keeps the first, and a finding with no key is dropped.
  `fixable: false` lists a finding without offering it, and `reason` says
  where it is fixed instead.
- `fix(findings)` returns `{key, ok, summary?, error?}` per finding it was
  handed; `fixEach` builds that list from a per-finding function, turning a
  throw into `ok: false`. The runner does not trust the list: it rescans the
  check, and a finding still found has failed. With no `fix` the check is
  report-only.
- `requires()` returning false, or throwing, hides the check.

`fix(id, keys)` takes `keys` from a fresh scan: a key that scan no longer
reports is returned in `gone` and left alone, and a key the scan reports as
`fixable: false` is skipped without appearing in any list. Each `failed` entry
carries `why` (`still`, `refused`, `threw` or `unverified`) and `error`. With
`report` left true, a fix that changed anything whispers one card to the GMs.

## `hp` — the group hit-point tool (apiVersion 19)

How the tool behaves is docs/lib/MODEL.md, "The hit-point tool". `open` and
`adjust` warn and return null for a seat that is not a GM.

```
acksExtras.lib.hp = {
  open(from?),                // the window, on `from` or on the selected tokens
  async adjust(from, opts),   // → a result per target; no window
  plan(hp, change),           // → what a change would write (Foundry-free)
  eligibility(actor),         // → why an actor is left out, or null
}
```

`from` is `{tokens?, actors?, parties?}`: tokens (placeables or documents),
actors, and party ids from the `party-roster` contract. A party token among the
tokens stands for its members.

`adjust` takes `{mode, amount, multiplier, perTarget, floorAtZero, report,
visible}`:

- `mode` is `damage` (the default), `heal` or `set`.
- `amount` is a whole number or a formula. A formula is rolled once for
  everyone, or once per target with `perTarget`, and throws when Foundry cannot
  roll it.
- `multiplier` (default 1) applies to every target. `floorAtZero` stops damage
  at 0.
- `report` (default true) posts the card. `visible` shows it to the players as
  well as the GMs.

Rows that cannot be adjusted are left out. Each result is `{target, amount,
multiplier, ok, before, after, max, crossedDown, crossedUp, why, error}`. When
`ok` is false, `why` is `gone`, `moved`, `noHp` or `failed`.

`plan(hp, {mode, amount, multiplier, floorAtZero})` returns `{before, after,
max, delta, crossedDown, crossedUp, clamped}`, or null when the hit points or
the amount are not numbers. `eligibility(actor)` returns `missing`, `stack`,
`template`, `vehicle`, `noHp`, or null.

## `worldTime` — the clock as this module reads it (apiVersion 27)

The policy is docs/lib/MODEL.md, "The world clock".

```
acksExtras.lib.worldTime = {
  SETTING_ADVANCE_WORLD_TIME, SETTING_DAWN_HOUR, SETTING_DUSK_HOUR,
  mayAdvanceWorldTime(),        // → whether this module may move game.time
  onWorldTimeAdvanced(cb),      // cb(worldTime, dt) on the active GM, forward steps only
  clockReading(),               // → {hour, minute, second, hoursPerDay, secondsPerHour, dawn, dusk, dark} | null
  darkBounds(hoursPerDay, {dawn?, dusk?}),  // → {dawn, dusk} (Foundry-free)
  isDarkAt(hour, {dawn, dusk}), // → boolean | null (Foundry-free)
  secondsToNextDawn(reading, {secondsPerHour?}),  // → whole seconds, a whole day at the dawn itself | null (Foundry-free)
  untilNextDawn(),              // → secondsToNextDawn(clockReading()) | null
  dawnWithin(reading, dt),      // → whether a step of dt seconds, read after it, crossed a dawn (Foundry-free)
}
```

`clockReading` is null when the world clock keeps no calendar to read an hour
from. `dawn` and `dusk` are the two world settings; a blank one stands at a
quarter and three quarters of the calendar's day. `isDarkAt` reads light from
`dawn` up to `dusk`, over midnight when dusk comes first, and no dark at all
when the two are equal. `secondsPerHour` is the calendar's minutes per hour
times its seconds per minute, 3600 when it states neither.

## `drawQuietly` — a table draw for the caller's own card (apiVersion 27)

The policy is docs/lib/MODEL.md, "Who reads a roll".

```
acksExtras.lib.drawQuietly(table, options?)  // → Promise<{roll, results}>, what table.draw returned
```

`options` are passed to `table.draw` with `displayChat` forced false, so core
posts nothing; the caller renders `results` on a card of its own. A draw that
lands on rows shows its roll to the GMs through Dice So Nice; one that lands on
none shows nothing. `drawForJudges` (`scripts/lib/roll-audience.mjs`, imported
directly) is this draw followed by core's own result card, whispered.

## `conditions` — the condition catalogue and its math (apiVersion 23, Foundry-free)

The policy is docs/lib/MODEL.md, "Conditions". Every figure is read from the
registered `conditions` document; with none registered each reader returns no
parts and names the condition in `unpriced`.

```
acksExtras.lib.conditions = {
  CONDITIONS, CONDITION_IDS,    // the catalogue: id → {label?, img?, state?, implies?, mods?, forbids?, ends?, given?, lost?, …}
  systemEntryOf(id),            // → the system's entry for an id it ships (CONFIG.ACKS.conditions, combatStates), or undefined
  conditionNameKey(id),         // → the lang key of a condition's name: the system's for an id it ships, the module's otherwise
  conditionLabel(id),           // → that name, localized
  CONDITIONS_DOC, CONDITIONS_TABLE, CONDITION_SLOTS,  // where the figures are read, and which each condition wants
  ACTS, ATTACK_KINDS, SAVE_KINDS, LOSSES, STACKS_FLAG, AC_WAIVER_TARGET,
  conditionSet(statuses),       // → Set of ids, closed under `implies`, in catalogue order
  conditionValues(),            // → the registered rows, {} when none
  conditionsReady(),            // → whether any row is registered
  subjectOf(actor),             // → {statuses, counts, sources, gifts, id, acWaived, implied} | null
  acWaivedSet(subject),         // → Set of ids: the conditions whose Armor Class figure the subject does not suffer
  giverOf(effect, actor),       // → the combatant that gave `actor` the effect's state, or null for its own
  forbiddenBy(set, act),        // → the ids in a closed set that take `act` away
  attackMath({attacker, target?, kind, attackerSize?, targetSize?, values?}),
  rollMath(on, subject, values?, {save}?),   // on: "save" | "throw" | "morale" | "surprise"; save: one of SAVE_KINDS
  acMath(subject, values?, {kind}?),   // → {total, parts, unpriced, waived}; kind: one of ATTACK_KINDS
  speedMath(subject, values?),  // → {factor, parts, unpriced}
  endingAt(statuses, moment),   // moment: "turn" | "combat" → the ids the tracker lifts
  endingAtTurn(statuses, {self, acting, givers?}),  // → the ids ending as combatant `acting`'s turn begins
  lostTo(statuses, cause),      // cause: one of LOSSES → the ids that cause takes away
}
```

`subjectOf(actor).gifts` maps a state another combatant gave the creature to
`{statuses}`, that giver's statuses, which is where a row's `unless` is read
for it. `endingAtTurn` takes the bearer's combatant id as `self` and, for
each given state, its giver's combatant id in `givers`. `giverOf`,
`endingAtTurn`, `lostTo`, `LOSSES` and `gifts` are the conditions surface's.

`attackMath` returns `{terms, damage, damageFactor, damageFactorBy, forbidden,
shielded, autoHit, pending, unpriced, waived}`. A term is `{condition, value, side}`
with `side` `"own"` for the attacker's condition and `"target"` for the
defender's; a defender's Armor Class row arrives as a term with its sign
reversed. `autoHit` is the defender's condition that waives the throw, or null.

**A waiver of Armor Class figures.** `subjectOf(actor).acWaived` lists the
condition ids whose Armor Class row the creature does not suffer, read from the
actor's abilities: a `modifier` row with `target: "acWaiver"`, no value, and
the ids in `conditions` (`AC_WAIVER_TARGET`). A row under a gate or a
free-text `condition` is not read. `acMath` and the target's side of
`attackMath` leave a waived condition's module-owned `ac` row out of the total
(and the terms) and report it in `waived`, `[{condition, value}]`; those rows
are Defend's alone, since a figure the system's condition effect applies has no
row here, so the list is empty in practice. `acWaivedSet(subject)` is the one
decision the appliers read: the ids a subject's `acWaived` names that it
carries, and what only a waived one implies. `subjectOf(actor).implied` is derived from
the actor's enabled effects: the conditions carried only by effects that also
carry a status whose entry `implies` them (an effect of charging and disordered
carries an implied disordered; another enabled effect carrying disordered
without such a status makes it carried in its own right). The decision does not
count an implied condition as carried in its own right. A condition a state
implies rides on that state's own effect (apiVersion 71, "A condition counted
once", below). A subject with no `acWaived` reads as before. The rule is in docs/lib/MODEL.md,
"Conditions".

**The steps the system's condition effects make.** `conditionSteps(actor, key)`
(`roll-mods.mjs`, used inside lib and not a member of the api object) answers
`{steps, waived}` for any actor type. `steps` is `activeNumericChanges(actor,
key, {base, admit: countsOnce})`, `base` the field's stored value (`_source`), narrowed to the effects whose statuses include an id
whose entry in `CONFIG.ACKS.conditions` carries `system.changes`, each step the
effect's own with `condition` added (the status its change belongs to, below,
else the first such status), valued as the field takes it, a bonus positive. On
`CONDITION_STEP_KEYS.ac` a step whose own condition sits in `acWaivedSet`
(for a change that belongs to no one status: every status of its effect) is
returned in `waived`, `[{condition, value, effect}]`, with the same sign as
`steps`; the attack seam reverses both when it puts them on the attacker's
throw. On any other key `waived` is empty. The reader looks at no
actor type: a caller that puts a step on a roll asks for a non-character, since
a character's prepared field already holds it.

**A condition counted once** (apiVersion 71). A status entry of the palette whose
catalogue `implies` names a condition that carries `system.changes` in
`CONFIG.ACKS.conditions`, and whose own closure does not forbid acting, is
registered with `statuses` (the brought condition ids that carry changes), a
static `_id` (`conditionEffectId(statusId)` of `status-effects.mjs`: 16 letters
and digits, a pure function of the id) and `system.changes` (its own, then each
brought entry's), so Foundry builds one effect carrying the state and the
condition it brings. Which ids qualify is read at registration and is not
listed in source. `rollMods.countsOnce(effect, change)` answers whether a
change counts: it belongs to the status of its effect whose system entry
carries its key (none, or more than one, and it counts), and it counts unless
an earlier active effect of the actor, in `allApplicableEffects()` order,
carries that status and a change on that key. It reads effects and never
`actor.statuses`. `status-effects.mjs` installs it, at `init` with the palette,
as a wrap of the Active Effect class's `shouldApplyChange` (the wrapped answer
first, a refusal stands, a throw is logged and the wrapped answer returned),
and `orderedChanges` and `activeNumericChanges` (`effect-scan.mjs`) take an
optional `admit(effect, change)`, which `conditionSteps` fills with
`countsOnce`: a step Foundry did not apply is a step no reader reports. The
model is docs/lib/MODEL.md, "Conditions".

`rollMath` returns `{total, parts, pending, unpriced, exempt}`. A positive
total helps the roll. `pending` holds the rows bound to a circumstance the
roll does not state, as `{condition, value, when}`, unapplied; `exempt` names
the conditions that take a creature out of morale.

A row narrowed to some saving throws is read only when `save` names one of
them, and a row narrowed to some kinds of attack only when `kind` does: a call
that passes neither gets the rows that reach every save, or stand against
every attack.

**What a creature imposes on the surprise roll.** `surprise-parts.mjs` reads an
ability's `modifier` row `{target: "surprise", appliesTo: "opponent", value}` on
a creature whose type has no `surpriseothers` field (a monster; a character's
row is the loadout's, written to that field for core to read). `opposingSurpriseParts(actor)`
answers `{parts: [{source, cite, value}], left: [{source, why}]}`, `why` being
`gate` or `condition` for a row nothing at the matrix can decide;
`surpriseAgainst(pools)` answers `{imposedOn: {monsters, adventurers}, left}`,
the parts each side's roll gains, from the other side's combatants (`sideOfPool`:
hostile, neutral and secret against friendly); `imposedOn` holds one part per side, the most adverse (`mostAdverse`: largest
magnitude, a penalty first on a tie) with `others`, how many carriers it
outweighs; `sumOfParts(parts)` adds a list, which here is that one part.

The roll wrappers and the two helpers a roll's owner calls
(`withMoraleConditions`, `withSurpriseConditions`) are
`scripts/lib/status-effects.mjs`, imported directly; it re-exports
`conditionNameKey(id)`.

**A condition's name, icon and id come from the system** (apiVersion 77). A
catalogue row carries `label` and `img` only where the system ships no entry
for its id; `conditionNameKey(id)` answers the system's `name` key for an id in
`CONFIG.ACKS.conditions` or `combatStates`, read at the call, and the module's
`ACKS-LIB.condition.<id>` for any other. `CONDITION_KEYS[id].label` (`vocab`)
is the localized name, read when asked. Three ids changed: `concentratingStationary`
is `concentrating-and-stationary`, `covered` is `cover-waist-high` and
`coveredGreater` is `cover-chest-high`; `vomiting` is a new id beside `choking`.
A consumer that stored or compared an old id, or built a name key from the
pattern `ACKS-LIB.condition.<id>`, reads the new id or `conditionNameKey`. A row
marked `state` is filed under States on the palette.

## `statusPalette` — the token palette as the Judge arranged it (apiVersion 29)

The model is docs/lib/MODEL.md, "The palette is arranged by the Judge".

```
acksExtras.lib.statusPalette = {
  read(),   // → every known status: {id, source, name, img, defaultOn, keep, data?, on, order, registered}
  open(),   // → the editor window, or null for a seat that is not a GM
}
```

`read` lists the statuses on the palette first, in palette order, then the
rest. `source` is `condition`, `state`, `custom`, `system` or `foreign`;
`order` is the place on the palette or null off it; `registered` is whether
`CONFIG.statusEffects` holds the status. The arrangement itself is the world
setting `acks-extras.statusPalette`; the Foundry-free model that reads and
writes its shape is `scripts/lib/status-palette.mjs`, imported directly.

## `summons` — a character's summoned creatures (apiVersion 64)

The model is docs/lib/MODEL.md, "Summons"; the ruling is
docs/character-sheet/DECISIONS.md, "A summon is an unlinked token of a GM-made copy".

```
acksExtras.lib.summons = {
  summonerOf(actor),                       // → the summoner's actor uuid, or null
  summonsOf(summoner, {scene}?),           // → the TokenDocuments on the scene (default: the canvas's) whose creature names it
  placeSummons(summoner, {sourceUuid, count?, spellId?, preConfirm?, positions?, castId?, cast?, rangeFeet?, calling?, casterToken?}),
                                           // → Promise<{ok, reason?, castId?, tokenUuids?}>
  pickPlacement(summoner, {sourceUuid, count?, spellId?, preConfirm?, rangeFeet?, calling?, casterToken?}),
                                           // → Promise<{positions}|null>  (the clicks alone; makes nothing)
  summonVerdict(summoner, {sourceUuid, count?, spellId?}),
                                           // → Promise<{ok: true, scene, source}|{ok: false, reason}>
  dismissSummons(summoner, {tokens?, entries?, held?, scene?, castId?, confirm?}),
                                           // → Promise<{ok, reason?, deleted?, refused?}>
  pickSummon(summoner, {spell?, options?, resolveRef?}),
                                           // → Promise<{sourceUuid, count, spellId}|null>
  registerSummonPolicy(fn),                // → unregister(): boolean
  registerSummonNaming(fn),                // → unregister(): boolean
}
```

A summon may ride in its summoner's party token, where it is a member record
and no scene token. Lib reads and ends it through the `party-roster` contract
(above) and imports no feature; with the contract's v2 members absent, a summon
is only the scene token it is. A placement announces itself: `acksExtras.summonsPlaced`
(`SUMMONS_PLACED_HOOK`, constants) is called with `{summonerUuid, sceneId, tokenIds}`
on the placing GM's client once the tokens stand.

`placeSummons` runs on the summoner's owner's seat: core's click-to-place
(`canvas.tokens.placeTokens`, `create: false`), then a relay to the GM's client
that makes the tokens. `preConfirm` is core's placement hook; returning false
refuses a click. `pickPlacement` is the clicks alone: it returns `{positions}`
and makes and sends nothing, or null when nothing was chosen (a cancel, or a
request that could not start, which it warns the seat of; `summonVerdict` is the
same checks answered first, with no warning, for a cast that must decide before
it spends). `placeSummons` given `positions` makes no click and stands the
creatures where those say; its `castId` and `cast` `{castId, casterLevel,
invocationLevel}` name the cast, and a malformed id is replaced by the GM's own.
`rangeFeet`, passed in by the caller and never read from a table here, bounds
each place from the centre of `casterToken`'s token (the stored point, no
creature size added): the seat's click is refused to a Player and warned to a
Judge, and the GM's client measures the points again, refusing a Player's
request `outOfRange`, or `noCaster` where the token is not the summoner's on
that scene. `calling` (the creature is called from where it stands), a `rangeFeet`
that is null or not a finite number, a place the grid cannot measure and a
Judge's request are exempt. The levels, the range and `calling` are the seat's
word. `dismissSummons` asks the seat first (`confirm: false` only
when the caller already has); it removes only summons the module's own
summoning made for that summoner. It takes the union of `tokens`, the tokens
`entries` name (`{tokenId, sceneId?}`, read on `sceneId`, else on `scene`,
default the canvas's) and the held summons `held` and `entries` name (`held` is
`{partyId, actorId}`, an entry's `held` that, or null); with none of the three
it takes the summoner's tokens on the scene and every summon of theirs riding
in a party token. `castId` filters both halves. The GM's client re-reads each
held summon from the roster rather than the request. `refusalText(reason)`,
exported from `scripts/lib/summons.mjs` and imported directly, is a refusal
reason in the seat's own words, for a caller that tells it in a place of its own
(a cast's verdict). `applyControlEnd(summoner, {castId, outcome})`, also imported
directly, runs on the GM's client alone and ends the control of one cast's
creatures, named by their own recorded cast and never by a name or a type:
each is stamped `lost`, then `outcome` (one of `CONTROL_ENDS`, read by the
caller from the spell's row) removes it (`gone`), turns it hostile with its
owners dropped (`hostile`) or leaves it (`stays`). A stamped creature is
refused to a non-GM's `dismissSummons` as `controlLost`. A deployed member's token
and a held summon are removed through the roster's `release`, and any other
token from its scene; with `release` absent, a held summon is refused and
counted in `refused`, and a token is deleted from its scene. `deleted` counts
every one removed. `reason` is one of `noUser`, `notSummoner`,
`notOwner`, `badCount`, `badSource`, `unreadable`, `badSpell`, `spellRequired`,
`badScene`, `badPositions`, `outOfRange`, `noCaster`, `noCopy`, `badOp`, `noCanvas`, `paused`,
`placement`, `none`, `cancelled`, `declined`, `noGm`, or a reason id a
registered policy gave.

A summoning belongs to the spell that calls it: `spellId` names a spell item of
the summoner, and the record the cast stamps keeps `spellId` and `spellName`.
A request naming no spell is refused `spellRequired` unless
`bareSummonAllowed(user)` (summons-logic.mjs) answers true, which it does for a
GM seat; that function is the one place the choice is made.

`registerSummonPolicy(fn)` adds a refusal a feature owns, so lib imports no
feature. `fn({user, summoner, source, sourceRef, count, spellId, spell, cast, positions, scene})`
returns null to allow or a reason id to refuse, synchronously (a promise
allows). `source` is null, and `sourceRef` the ref the request carries, on a
seat that could not resolve the creature a spell names. `cast` is `{castId, casterLevel, invocationLevel}` (a level not stated is null);
`positions` and `scene` are the places chosen and their scene on the GM's client,
null on the seat's own pre-check. Policies run after every
built-in check, on the requesting seat and on the GM's client, and each must
answer from documents both can read. A policy that throws is logged to the
console and counts as an allow. The call returns a function that unregisters it.

`registerSummonNaming(fn)` says which creatures a spell names: `fn` takes the
same request and answers exactly `true` when the spell's own rows name the
creature. A creature so named is exempt from the shelf-readable check
(`unreadable`) and from nothing else; the GM's client resolves it with its own
access. A throw is logged and means not named.

`pickSummon` is the creature and count prompt for a cast from `spell`: each
`options` row (`summonOptionsOf`) whose `ref` the caller's `resolveRef(ref)`
turns into `{uuid, name}` is offered, the first preselected with the row's
`amount` as the count. A row it cannot resolve is still offered when its ref
reads as an id: the ref goes on untouched as the answer's `sourceUuid`, labelled
by the row's `name` or "Creature N". With no offerable row it offers the shelves
the seat can open. It asks and places nothing; pass the answer to
`placeSummons`, whose `sourceUuid` may then be a uuid or a cookbook id for a
request that names a spell.

`heldSummonsOf(summoner)` lists the summons of a character stashed in a party
token, `{partyId, actorId, name, img, record}` each; a summon deployed with its
party is a scene token and appears in `summonsOf` only. `castSummons(caster,
castId, {scenes?})` answers `{tokens, held}` for one cast: its scene tokens (on
`scenes`, default every scene of the world) and its held summons. Both answer
empty with no provider. They are exported from `scripts/lib/summons.mjs` and
imported directly. The Foundry-free
checks (`summonOfData(tokenData)`, `{summonedBy, summon}` read off a token's
plain data, `checkPlaceRequest`, `checkDismissRequest`, `groupByCast`,
`groupBySpell`, `bareSummonAllowed`, `summonOwnership`, and `summonRefName`,
the name of the creature a row's ref names, or null) are in
`scripts/lib/summons-logic.mjs`, imported directly.

## `spellUse` — the cast seam (apiVersion 36)

The model is docs/lib/MODEL.md, "The cast seam"; the ruling is DECISIONS, "One
owner of the cast seam: lib".

```
acksExtras.lib.spellUse = {
  addClaimant({key, claims, cast}),   // register, or replace the claimant under `key` in place
  removeClaimant(key),                // → whether one was registered
}
```

`claims(item, options)` is synchronous and answers whether this claimant takes
this cast; claimants are asked in registration order and the first to answer
exactly `true` wins (a promise declines).
`cast(item, options, spend)` is awaited. `spend()` runs the system's own
`_useSpell(options)`, the cast count and the chat card, and a second call
returns the first's promise; it resolves true when the system's method ran. It
is libWrapper's chained call underneath, so call it before `cast` returns: a
later call is a logged no-op that resolves false and throws nothing. A
claimant that never calls `spend` spends nothing. A throw from `claims` skips that claimant; a throw from `cast` is
logged and spends nothing unless `spend` already ran. The system's `use()` does
not await `_useSpell`; a feature that must wait for a cast calls
`item._useSpell(options)`. The registry and the wrapper are
`scripts/lib/patches/spell-use.mjs`.

## `attack`, `saves`, `rollMods` and `loseStates` — a spell on the weapon pipeline (apiVersion 52)

The model is docs/lib/MODEL.md, "A spell's damage on the attack seam", "A
record's modifiers at the roll" and "Saving throws as parts"; the rulings are
DECISIONS, "A spell's damage is a fourth attack type on a carrier", "A record's
buff reaches its roll through a lib flag, resolved beside the weapon's own bonus"
and "The loss path names its cause while it lifts".

```
acksExtras.lib.attack = {
  PRE_ATTACK_HOOK, POST_ATTACK_HOOK, addContributor, inFlight,   // as before
  MAGIC_ATTACK_TYPE,                       // "magic"
  spellCarrier(actor, row, cast) → Item,   // cast: {spell, castId, rowKey, delivery}; unsaved, parented to actor
  isSpellCarrier(item) → boolean,          // identity, never a flag
  carrierOf(item) → {castId, rowKey, spellUuid, delivery, row} | null,
  magicDamageSpec(actor, carrier, {terms}) → Promise<{formula, data, modifiers, types, extraordinary} | null>,
  TARGET_AC_FLAG                           // 70: "targetAc"
}
acksExtras.lib.saves = {
  saveSpec(actor, save, {magical = true, conditions = true, situational, parts, values,
                         against = null, bearerToken = null, rollMods = conditions,
                         damage = null, defenses = null,    // damage: {types, extraordinary, silver}
                         occasion, ownRows})                // 58: occasion names the roll's occasion; ownRows are the spell's own-save rows
    → {save, kind, formula, baseTarget, target, parts: [{key, label, value, side}],
       pending: [{condition, value, when} | {label, value, when: "source" | "save" | "gate"}
                 | {label, value: null, when: "defense", why}], unpriced,
       auto?: {label, source, types} | null},   // `auto` only with `damage`: an immunity, a success with no roll
  saveThrow(actor, save, {…saveSpec options, roll}) → Promise<{…spec, roll, total, success}>
}
acksExtras.lib.rollMods = {
  FLAG: "rollMods",                         // flags["acks-extras"].rollMods on an Active Effect
  rollModsOf(actor) → [{effect, id, label, cite, sourceAlignment, part}],   // active effects only
  registerItemBonusSource(source) → unregister,   // source(item, on) → [{key, label, value, provides, cite}]
  // 58: one reader of a record's parts for every other roll
  recordParts(actor, on, {subject, rollKey, save, kind, ctx, rollType = "above", entries = rollModsOf(actor)})   // 59: entries
    → {kept, dropped, pending},             // on: throw | reaction | grant | save | ac | immune
  throwResolution(actor, recordParts options)
    → {outcome: "throw" | "auto", add, total, set, auto, dropped, pending},
  recordImmunity(actor, {spell: {id, provides}, conditions: [key], ctx})
    → {spell, conditions: {key: {label, spell, effect}}, pending},
  partHolds(actor, partOrRow, {item, token, occasion}) → true | false | null,
  ownSaveParts(saver, rows, {save, ctx}) → {parts, pending},
  countsOnce(effect, change) → boolean,     // 71: whether a condition's change counts, or an earlier effect of the actor carries it
}
acksExtras.lib.loseStates(actor, cause) → Promise<string[]>   // cause: "damage" | "save" | "moved"
acksExtras.lib.lossInFlight(actor) → {cause, ids} | null       // held while loseStates lifts, on that client
acksExtras.lib.STATES_LOST_HOOK                                // "acksExtras.statesLost", called with (actor, ids, cause)
acksExtras.lib.lift(actor, ids) → Promise<void>                // statuses off an actor, through the system's toggle
acksExtras.lib.loseRecords(actor, cause) → Promise<string[]>   // cause: "damage" | "attack"; the ids deleted
acksExtras.lib.endsOn = {FLAG: "endsOn", CAUSES, readEndsOn(flag) → string[], endedBy(effects, cause) → string[]}
```

**The attack card's Armor Class line** (apiVersion 70). The card of an attack
whose target is a character holding condition effects that move its Armor Class
carries `flags["acks-extras"][attack.TARGET_AC_FLAG]`, `{target, rows: [{name,
value}]}`: the target's name, and each effect's own name (with its condition's
name where the two differ) with its signed step as it stood when the attack was
rolled; a step the Armor Class waiver spares is a row too, since the system
counted it (apiVersion 71). Absent where there is none (a monster
target, no effect, a card that is not the system's attack card). The seam reads
the rows through a reader slot, `setTargetAcReader(reader)` in
`patches/attack-throw.mjs` (not on the api object), which
`attack-card-target-ac.mjs` fills with `targetAcRows(actor)`; lib draws the line
on the card in the Chat tab from the stamp alone. The model is
docs/lib/MODEL.md, "The attack card names a target's condition".

**The `rollMods` flag** is `{id, label, cite, sourceAlignment, parts}`, `id` the
definition id the record stacks as. A part is `{key, on, value, itemId, gate,
stacksWith, notStacksWith, provides}` plus the scope fields (`vsKinds`,
`vsAlignment`, `vsAlignmentOf`, `vsAlignmentMode`, `vsEnemy`, `anyOf`); `on` is
`attack`, `damage`, `ac`, `save` or `ward`, and a `ward` part carries no figure.
The attack seam adds the attacker's `attack` and `damage` parts to the weapon the
roll is made with (its `itemId`, or no item named; its item gate; its scope
against the target), resolved against what the registered item bonus sources
report for that weapon: the larger of two that do not stack applies, the
weapon's figure on a tie, and a weapon figure that yields is taken back by a row
of its negative. A target's `ac` parts are a term against the attacker. A source's
parts are already in core's rows. `saveSpec`'s `against` is `{actor, token}`, what
the throw is made against, and `bearerToken` the saver's own token; a `save`
part that applies is a target part, one that cannot be settled is in `pending`
with `when: "source"`. Core's own `rollSave` reads only the unscoped, ungated
`save` parts and tells each scoped one. `lossInFlight` is read by a delete hook
the lift fires on the same client. A `ward` part that names a `save` (a system
save key) has its notice carry the attacker's target number for that throw
(`saveSpec`), and the notice stays the plain one when the part names none or the
attacker has no target stored; a ward is told and never refused.

**A record's parts at any roll** (apiVersion 58). `ROLL_MODS_ON` gains `throw`,
`reaction`, `grant` and `immune`. A part may carry `mode` (`add`, `set`, `auto`),
`ref` or `refs`, `rollKey`, `saves`, `attackKinds`, `ifHas`, a `gate`
(`gate.occasion` marks a status gate that belongs to one occasion) and `spells` /
`conditions` (an `immune` part). `recordParts` reads them in a fixed order:
narrow by `ref` (matched through `satisfies` against `subject`, `{id, provides}`),
`rollKey`, `saves` and `attackKinds`; test `partHolds`; then resolve the parts that
apply among themselves. Two records of one kind give one figure, the larger, and a
part is gone with its record. A part that declares a narrowing the caller named
nothing to test is in `pending` (`why: "narrow"`), as is one whose gate cannot be
told (`why: "gate"`); neither reaches the roll. A part with no figure never
reaches the stacking, except a `grant` and a `throw` of mode `auto`, which carry
`value: null`. A `grant` applies only while no ability of the bearer provides
`capabilityForId(ref)`. A `set` figure is a target: `rollType` `"below"` makes the
higher one the better, any other the lower. Stacking is per group (a grant's by
`ref`, a throw's by mode), so a bonus on one proficiency never displaces another's.
`partHolds` answers true, false or null: a gate through `gateVerdict` (an item
gate waits for `ctx.item`, a roll gate for the context it reads (`ctx.token` for the light gate; the attack-moment gates read more, and answer null where `partHolds` is not handed it); one marked `occasion` that
holds waits for `ctx.occasion` to name its status), each `ifHas` through
`hasCapability`; false beats null. It takes a row as well as a part, so a row of a
spell's own save is tested per saver before any record exists (`ownSaveParts`,
`saveSpec`'s `ownRows`: a positive figure lowers the number to roll). `saveModParts`
and `sheetSaveShift` take `{save, occasion}`. The attack against a bearer reads
its `ac` parts narrowed by the attack's kind; a `set` part is the lift
`max(0, figure - (ac.value - dexMod + conditions))` (DEX is read only for a
character), resolved with the add parts so the larger stands. `modifierDisposition`
with `bearer` answers `atRoll` for a `set` on `ac` (reason `set`) and for a gated row
(`gate`); a declared `attackKinds` answers `atRoll` / `narrowed` on both paths.
`EFFECT_MODES.auto` is a success with no roll; `throwResolution` answers it as
`outcome: "auto"`. `effectField` gains `attackKinds`, `ownSave`, `pickKind`,
`exemptSizeOver` and `gate.occasion`; `typed-modifiers.mjs` exports `saveKeyOf`.

**The `endsOn` flag** (apiVersion 57) is a list of causes on an Active Effect,
`flags["acks-extras"].endsOn`: `damage` and `attack`. The loss hooks delete such
a record by id: on `damage` when the bearer's hit points fall (the records first,
then the states damage costs, in that order), and on `attack` after the bearer's
own attack throw resolves, on the client that made it, a spell carrier's attack
included. A word that is no cause, or a flag that is not a list, ends nothing.
The catalogue's `slumbering` is lost to `damage` and `moved` through
`loseStates`, as `casting` is.

A contributor passed to `addContributor` may declare `carriers: ["attack" |
"damage"]`: the questions it answers for a spell carrier's attack. Without it a
contributor is never asked about a carrier. For a carrier's attack the contributor
receives the delivery kind (`melee` or `missile`) as `attackType` and sees
`ctx.type` as `"magic"`. A `saveSpec` target part's `value` is the figure that
lowers the number to roll, so a positive value helps the roller on either side.
`saveThrow` rolls nothing and answers `roll`, `total` and `success` null for a
creature with no stored target (and `success` true, nothing rolled, for a spec
with `auto`), and never calls `loseStates`.

## `spellSources` — the castable-spell register (apiVersion 59)

The ruling is DECISIONS, "One register of what a character can cast: lib owns it".

```
acksExtras.lib.spellSources = {
  registerSpellSource(kind, source) → unregister,   // source(actor, {viewer, call}) → [{spell, itemId, casterLevel, capacity, cite?, twin?}]
  registerSpellReach(reach) → unregister,           // reach(actor, entry, call) → {onSelf: true | false | null, selfParts}; one owner
  castableSpells(actor, {viewer, kinds}) → [{key, spellRef: {cookbookId, uuid, name}, source, sources, itemId,
                                             casterLevel, capacity, cite, onSelf, selfParts}],
  availableRollMods(actor, {viewer, kinds}) → [{effect: null, id, label, cite, sourceAlignment, part, source}],
  spellRefOf(spell, twin) → {cookbookId, uuid, uuids, name, key},
  SPELL_CAPACITY: {ok, unknown, none},
}
```

A **source** answers what one kind of place holds for an actor: `spell` the
document, `itemId` the item that holds it, `casterLevel` `{value, source, parts}`
or null, `capacity` `"ok"`, `"none"` or `"unknown"` (what a cast would find now;
`"none"` is a known spell with nothing left to cast it with, still listed), `cite`
the spell's page reference and `twin` its library document where the source read
one. A source lists only a spell the actor can cast at all. `call` is one object
shared by every source and the reach during one `castableSpells` call, for a
provider's per-call scratch. `viewer` is whoever asks; no source reads a seat, and
one that names a spell the viewer may not know (an unidentified scroll) answers
nothing for a non-GM `viewer`. A kind registered again replaces its source; a source
or the reach that throws is logged and contributes nothing.

`castableSpells` merges a spell two sources both hold into one entry by the order
a row names a spell: the cookbook id, else the uuids, else the folded name. The
source with the better capacity (`ok`, then `unknown`, then `none`; the first
registered on a tie) speaks for the entry (`source`, `itemId`, `casterLevel`,
`capacity`, `cite`) and `sources` lists every kind that holds it. The reach is asked
once per merged spell. `onSelf` is true where a cast would write on the caster,
false where it would not, null where the reach cannot tell or none is registered,
and `selfParts` are the parts that cast would write (`[]` unless `onSelf`).

`availableRollMods` is every on-self entry's parts as `rollModsOf` entries, with
`effect` null and the `source` kind added; its `id` is the cookbook id or null and
its `sourceAlignment` the actor's. Pass them to `recordParts` after the recorded
ones: `recordParts(actor, "grant", {entries: [...rollModsOf(actor), ...availableRollMods(actor)]})`.
They go through the same narrowing, `hasCapability` skip, `partHolds` and stacking.
A part with no figure (a grant) keeps the first of its group, so with the recorded
entries first a recorded grant stands and an available one of the same ref is
told as yielding to it; figured parts stack by size as they always did.

## `bucket` — the inventory bucket (apiVersion 61)

The ruling is DECISIONS, "The inventory bucket is lib's, and states no rule"; the model is MODEL, "The inventory bucket".

```
acksExtras.lib.bucket = {
  // model (bucket.mjs, Foundry-free)
  makeEntry(parts), powerEntry({key, name, amount, balance, value, fit}),
  entryFromDrop(data, resolve, {policy, present}) → {entry} | {refused: "noDrop"|"gone"|"duplicate"|"kind", name?},
  entriesFromAnswer(list, resolve, {policy}) → {entries, gone},  answerOf(entries) → [{uuid, qty, fit}],
  withQty, withValue, withFit, nextFit, preselectFit(entry, fit),
  totalOf(entries) → {gp, blank},  coverage(entries, due) → {total, blank, due, short, status},
  acceptVerdict(policy, entry, doc),  settlementPlan(entries, outcome, settle, {used}) → [{uuid, kind, qty, action}],
  bucketView(policy, entries, {key, loc, legend, icon, picked, rows, locked, dropText, emptyText}),
  ENTRY_KIND, OUTCOME, SETTLE, COVERAGE, BUCKET_ACTIONS, BUCKET_LANG_PREFIX, TEMPLATE,
  // valuation (bucket-value.mjs): every figure is an argument
  itemValue({cost, count, cite}), partValue({cost, count, effects, cite}),
  creatureValue(actor, {items, isComponent, costOf, countOf, xpOf, multiplier, bars, cite}),
  characterValue(level, {award, multiplier, cite}), fallbackBar(actor, bars), blankValue(cite),
  // writes (bucket-apply.mjs, Foundry)
  applySettlement(plan, resolve) → {spent, marked, gone, handed, failed},
}
```

An **entry** is `{uuid, kind: item|actor|token|power, name, img, qty, cap, value: {gp, each?, source, cite, basis?}, fit, reason?, effects?}`.
`gp` is null where nothing was read. A row with a `reason` is listed and dimmed and
adds nothing to a total or a settlement. A **policy** is the owning window's:
`{accepts: {kinds, reason?}, value?, fit: {options: [{key, label, tone?, names?}], fallback?}, due: {gp, cite?}|null, parts: [{label, gp?}], settle, verdicts, pick?: "one"}`.
`verdicts` are findings for the owner's plan; lib assigns no severity.

`settle` maps an outcome (`success`, `failure`, `botch`) to an action for every kind or
to `{item, actor, token, power}`; an action is `consume`, `keep`, `destroy` or `mark`, and a
row or outcome it does not name is kept. `settlementPlan` turns `consume` or `destroy` of
an actor or token into `mark`. `applySettlement` writes the plan: an item through
`divideStack` and a delete, a creature marked with core's dead status. It returns a
power row and an item `mark` in `handed` for their owners.

`creatureValue`'s `multiplier` is three-valued: absent means the reading has none, `null`
means it applies and was not imported (blank figure), a number is applied.
A window draws `bucketView`'s result with the `TEMPLATE` partial and binds `loc` as
`makeLoc(BUCKET_LANG_PREFIX)`; it wires `BUCKET_ACTIONS` (`bucketRemove`, `bucketFit`, `bucketPick`)
and the `data-bucket-drop` zone itself.

## A reduction per die (`defenses.mjs`; not on the lib api yet)

The model is docs/lib/MODEL.md, "Damage against defenses".

```
REDUCTION_TARGET, REDUCTION_GATES     // "damageReduction"; ["weaponMundane", "weaponMagical"]
actorReductions(actor) → [{source, cite, per, gate}]
reductionStage(reductions, {dice, gates}) → {stage: {key: "perDie", label, band, minus, per, dice, source, cite} | null, skipped: [{source, why}]}
planAttackApply(stamp, actor, {sources?, figures?, reductions?}) → amountAfter's answer, plus skipped when a reduction could not be decided
patches/attack-throw.mjs: damageDiceOf(rolls) → number | null; weaponGatesOf(item) → {weaponMundane, weaponMagical}
```

The attack card's stamp (`flags["acks-extras"].attackApply`) gains `dice` (absent
where no die count could be read) and `gates`. `amountAfter` takes a stage with
`minus`.

## Delayed damage (`scripts/lib/delayed-damage.mjs`, Foundry-free but `installDelayedDamage`; not on the lib api yet)

The model is docs/lib/MODEL.md, "Damage that lands later".

```
FLAG_DELAYED_DAMAGE                  // "delayedDamage", from constants.mjs
readDelayedDamage(flag) → {combatId, combatantId, edge, count, seen, amount|null, formula, source, cite}
                          | {dueAt, amount|null, formula, source, cite} | null
                                     // dueAt (world seconds) wins over combat fields beside it
delayedDamageStep(flag, {kind, combatId, combatantId}, {gone?, down?}?) → {act, seen, record}
                                     // act: "none" | "count" | "apply" | "drop"; "none" for a dueAt record
delayedDamageDue(flag, worldTime, {down?}?) → {act, record}
                                     // act: "none" | "apply" | "drop"; only a dueAt record is ever due
delayedDamageToWorld(flag, combatId, {now, roundSeconds, gone?, down?}) → {act, record}
                                     // act: "none" | "drop" | "convert" (record: the dueAt record); "none" too where `now` is no number
delayedDamageEffectData({amount?, formula?, source, cite?, dueAt?, combatId?, combatantId?, count?, edge?, name?, img?}) → ActiveEffect data | null
                                     // dueAt in place of the combat fields starts it on the world clock
liftDelayedDamage(combat, combatantId, kind, {roll, damage, post}) → Promise<[{name, source, cite, amount, result}]>
liftWorldDelayedDamage(actors, worldTime, {roll, damage, post}) → Promise<[{name, source, cite, amount, result}]>
convertDelayedDamage(combat, actors, {now, roundSeconds}) → Promise<[{name, act}]>
                                     // act: "convert" | "drop"
installDelayedDamage()               // the two turn hooks, deleteCombat and the world clock, once; called from module.mjs
```

## Turn hooks and a record's turn life (apiVersion 54)

The model is docs/lib/MODEL.md, "The tracker lifts what ends" and "A record that
lasts turns"; the ruling is DECISIONS, "The tracker fires the turn hooks and
lifts a record by its turn count".

```
acksExtras.lib.TURN_BEGAN_HOOK   // "acksExtras.turnBegan", called with (combat, combatantId)
acksExtras.lib.TURN_ENDED_HOOK   // "acksExtras.turnEnded", called with (combat, combatantId)
acksExtras.lib.turnLife = {
  FLAG: "turnLife",              // flags["acks-extras"].turnLife on an Active Effect
  EDGES: ["start", "end"],
  readTurnLife(flag) → {combatId, combatantId, edge, count, seen} | null,
  turnLifeStep(flag, {kind, combatId, combatantId}) → {seen, lift},   // kind: "began" | "ended"
  turnEdges(prior, current, {unrolled}) → {ended: combatantId | null, began: boolean}
}
```

Both hooks fire only on the primary GM's client, as a combatant's turn begins
and as the tracker leaves one that began; a re-sort after an initiative roll and
the Judge stepping back fire neither, and a round that opened before its
initiative was rolled begins no turn until it is rolled. A listener sees the
records of that edge already lifted.

**The `turnLife` flag** is `{combatId, combatantId, edge, count, seen}` on an
Active Effect of any combatant's actor in the fight `combatId` (a linked actor or
an unlinked token's). Each turn start of `combatantId` adds one to `seen`. At
`edge: "start"` the record is deleted at the turn start that brings `seen` to
`count`; at `edge: "end"`, at the end of that combatant's turn once `seen` is at
`count` or more, so a turn already running when the record was written does not
count. Another fight's records are never touched. A writer sets `seen: 0` and
need not write it again; lib writes it.

## Turn activities (`scripts/lib/turn-activities.mjs`)

Imported from the file; `lib.*` does not carry it. The model is
docs/lib/MODEL.md, "The turn-activity registry". Plans are plain objects,
`{[actorId]: {key, option, remaining, turns, by, advancedTurn?, resolvedTurn?}}`,
and every helper returns a new one.

```
registerTurnActivity({key, pace, options, turns, blocked?, resolve, oncePerTurn?}) → unregister()
turnActivity(key) → declaration | null
listTurnActivities() → declarations, in registration order
offeredActivities(actor, ctx) → [{key, pace, oncePerTurn, option, turns, blocked}]
lockActivity(plan, {actorId, actor, key, option?, by?, usedThisTurn?, ctx?})
  → {ok: true, plan, entry} | {ok: false, reason, missing}
unlockActivity(plan, actorId) → plan
advanceTurn(plan, turn) → {plan, due, progressed}        // turn: a finite number once per turn; due entries come back stamped
resolveDue(due, {actorOf, ctx?}) → Promise<[{actorId, key, option, status, reason?, result?, error?}]>
cancelForCombat(plan) → {plan, cancelled, kept}
partyRest(plan, actorIds, {endures?, restKey?}) → {rests, owing, chose, missing}
REST_KEY, TURN_PACES, TURN_REASONS
```

`options(actor, ctx)` answers plain option objects (`id`, anything else) and the
registry passes each through untouched. `turns` answers a positive whole number
or null for not imported. `usedThisTurn(actorId, key)` is asked only of an
`oncePerTurn` activity. `blocked` answers null, a reason id, or `{reason,
missing}`. `resolve(actor, option, ctx)` runs when the entry's last turn ends.
`status` is `"resolved"`, `"dropped"` (the activity, option or member is gone)
or `"failed"` (`resolve` threw). Write the plan `advanceTurn` returns before
calling `resolveDue`.

## `bookArt` — pictures from the Judge's books (module-internal, not on the api)

`scripts/lib/book-art.mjs`, imported directly, Foundry-free. An import writes
one registry document, one table of rows per book:

```js
{ id: "bookArt", source: { pages: "ZZ p.1; ZZ p.4" }, cites: { zz: "ZZ p.1; ZZ p.4" },
  tables: { zz: [
    { side: "back", pool: "zz.p1", band: null, kind: null, src: "x/a.webp", cite: "ZZ p.1" },
    { side: "face", pool: "zz.p1", band: null, kind: "zz.item1", src: "x/b.webp", cite: "ZZ p.4" },
    { side: "texture", pool: null, band: 0, kind: "grime", src: "x/c.webp", cite: "ZZ p.4" },
  ] } }
```

Three sides (`ART_SIDES`): a `back` has a pool and kind null; a `face` has a
pool and a kind or null; a `texture` has a kind and pool null. `band` is null
or an integer of 0 or more, matched by equality: band 0 is a band, never null.
`licence` is an optional string. `artRowProblems(row)` lists what is wrong.

`treasureArt({side, pool, band, kind})` answers `{src, cite}` (plus `licence`
when the row has one) or null. Books are read in sorted key order and the
first matching row wins. Every step except a kind step reads kind-null rows
only, and a null band skips any step that names the band.

- Back: the pool at the band; the pool at band null.
- Face: the kind (case- and accent-folded) at any pool; the pool at the band;
  the pool at band null; the pool at its lowest band. A face with no kind
  never reaches a kind-keyed row.
- Texture: the kind at the band; the kind at band null. Never another kind's
  row.

## `distance-units` — scene distance in feet (module-internal, not on the api)

`scripts/lib/distance-units.mjs`, imported directly, Foundry-free: `feetPerUnit`,
`feetToUnits` and `sceneFeetPerCell` read a scene's `grid.units` through the
unit table, and `tokenGapFeet(a, b)` is the centre-to-centre gap in feet of two
token documents on one scene, measured by the grid's own `measurePath`
(diagonals count as the scene's ruler counts them). It answers null for a
missing token, tokens on different scenes, or a grid that cannot measure, so a
caller judges nothing rather than guessing. A token's centre is its document's
`getCenterPoint`, else its corner plus half its size.

## Versioning

`apiVersion` is bumped when this surface changes shape, and it is informational:
the lib and its callers are one module at one version, so nothing pins a minimum
against it. The importer subsystem (`scripts/importer/`) lives in this repo, so
a symbol added here and the importer code that consumes it land in the same
commit.

## Patch layer — what the lib adds to the system

The acks system is an **unmodifiable reference**. Anything the module needs that
it does not provide lands here, once. A feature patches core directly only for
behaviour unique to its own domain (the abilities feature owns the ability roll
path); everything shared is here. One owner per wrapped core method —
`tools/validate-extra.mjs` fails on a second registration against one target.

### `acksCompatStubs()` / `savingThrowFields()`

`AcksActor` runs for every actor and touches `isNew`, `attack`, `initiative`,
`movement` and `saves` unguarded — the setup-time
`updateWeightsLanguages` sweep reads them on *every actor in the world*, so one
module actor with an incomplete schema aborts the system's own ready work.

Spread `acksCompatStubs()` into any module actor sub-type's `defineSchema()`.
One definition serves every sub-type: a system patch several features
maintain separately is one system update away from some of them being wrong.

`savingThrowFields()` is separate, for a sub-type that genuinely saves — same
field paths and initials as the system's own `SavingThrowsTemplate`.

### `acks-extras.animal` — the animal/monster bridge

An animal is a monster you can also buy, load and ride. `AnimalData` mirrors the
monster's field paths (`hp`, `ac`, `attack`, `movement`, `saves`,
`details.morale`) **on purpose**, so anything already reading a monster reads an
animal unchanged, and adds the shop-and-stable half under `system.animal`:
`species`, `training`, `capacity6`, `unencumbered6`, `mountable`, `cost`.
Loads are in `weight6` (sixths of a stone), the family's only weight unit.

Registered at `init` into `CONFIG.Actor.dataModels`; declared in `module.json`
`documentTypes`.

Animals use the **system's own monster sheet**, registered for the type at
`ready`. The library ships no sheet: the schema mirrors the monster's field
paths precisely so the monster sheet renders an animal unchanged, and a second
sheet over the same fields would just be a second thing to keep in step. The
schema therefore also carries the four fields that sheet reads unguarded
(`pattern`, `counter`, `spells.enabled`, `details.treasure`), for the same
reason the compat stubs exist.

### `mount` — who is riding what

```js
const { mountOf, riderOf, isMounted, mountActor, ride, dismount, unseat } = acksExtras.lib.mount;
```

Mounting is the `rider` role of the one attachment relationship, stored once on
the rider ([MODEL.md](MODEL.md), "Carrying: mounts, teams and everything
aboard"). `mountActor(rider, mount)` makes the binding and resolves to whether
it was made; the seat must own both. `ride(rider, mount)` is the same call with
a notice naming both, for a gesture that leaves nothing else on screen. Hooks:
`acksLibMounted`, `acksLibDismounted`. A mount need not be an
`acks-extras.animal` — in ACKS plenty of people ride monsters.

This exists because the equipment feature’s mounted-combat overlay was blocked on
there being any mounted state in the system at all.

### `itemModel` — the shared item baseline

The system declares `cost`/`weight6` per type, `equipped` separately on `weapon`
and `armor`, and `favorite`/`save`/`pattern` across overlapping subsets — so
every module re-derived "is this physical / can it be equipped / what does it
weigh" with its own type list, and they disagreed.

```js
const { isPhysical, isEquippable, isEquipped, weight6Of, weightStoneOf,
        physicalItems, equippedItems, setEquipped, STONE,
        isGoods, isStowable, isClothing, encumbering6,
        hasStock, findCarried, carriesItem,
        isWearable, isWorn, slotsOf, declaresSlots, wornSlotOf, setWorn,
        gearOf, itemsInSlot, slotOverfilled,
        isCurrency, stackCountOf, perStoneOf, systemCoinsPerStone, sumWeight6,
        divideStack, joinStacks } = acksExtras.lib.itemModel;
```

These read the **schema**, not a type name (`"cost" in item.system`), so they
keep working when the system adds a physical type this library never heard of.
`weight6Of` multiplies by the quantity an item carries, a weapon's and an
armour's included, and reads the count through `stackCountOf`.
`physicalFields()` / `equippableFields()` build a module sub-type's own schema
to match the system exactly rather than approximately.

`isGoods` is `isPhysical` plus coin: the system gives `money` no cost and no
weight, so the schema probe alone loses it. `encumbering6` is what core's
`computeEncumbrance` counts (clothing excluded), with coin weighed to the coin
where core counts it in whole stones.

**The stack (apiVersion 24).** `stackCountOf(item)` is how many units a row
stands for, read by the field's shape, and `null` for an item whose data
carries no quantity. `storage.isStackable(item)` (apiVersion 66) is whether a
row carries a quantity and has no Active Effects of its own: a weapon and
armour included. `storage.offersCount(item)` (apiVersion 66) is the narrower
question a surface asks before drawing a count control: stackable and not
equippable by core. `canDivide(item)` is whether `divideStack` will take the
row (two or more, nothing stored in it, no variation).
`divideStack(item, count, {also})` puts `count` into a row of its own beside the stack
and resolves to the new row, or to `null` when `count` does not fall strictly
inside the stack or the reducing write is refused (the new row is deleted
again); `also` is a pending change written in the same reducing write.
`foldIntoRest(item)` (apiVersion 66) joins a row no longer in use into the
resting row of the same thing and resolves to that row or `null`;
`oneAtATime(holder, task)` runs divides and folds on one holder in turn. `joinStacks(item, onto)` folds one row into another of the
same thing on the same holder (same stack signature, owner and container) and
resolves to `onto`, or to `null` when the two are not one thing or either row
is no longer on the holder. `joinInTurn(item, onto)` (apiVersion 67) is
`joinStacks` taken in the holder's turn, after the folds and divides already
queued there: it looks both rows up again when its turn comes and joins only if
both remain. A caller outside a turn, such as a sheet's drop, uses it; a task
already inside `oneAtATime` calls `joinStacks`, since `joinInTurn` waits on the
turn the task is part of and never resolves.

**Currency (apiVersion 24).** `isCurrency(item)` is the system's `money` type.
Its weight is stated as how many make a stone: `perStoneOf(item)` is the
item's own `flags["acks-extras"].gear.perStone`, else
`systemCoinsPerStone()`, the rate the system weighs coin at, read off the
system's own arithmetic. `weight6Of` returns a coin row's weight as an exact
fraction of a sixth. **Sum rows with `sumWeight6(items, each?)`, never by
adding `weight6Of` and rounding**: it adds coin counts per rate before the one
division, so a purse in several rows weighs what one stack would. Round only
where a figure is printed.

`findCarried(actor, pattern)` / `carriesItem` answer "have they got one?" for
every rule that demands a physical implement — a 10' pole to probe with, a quill
to map with, a flask of oil to burn. Physical items only, so a proficiency whose
NAME matches is never mistaken for the gear, and `hasStock` makes a bundle of
nothing read as not carried.

**Worn state has two stores and one read path.** Core owns `system.equipped` on
`weapon` and `armor`; everything else records `flags["acks-extras"].gear.wornAt`,
because core declares no `equipped` field for it and Foundry prunes off-schema
keys. Always ask `isWorn` / `wornSlotOf` / `setWorn` — narrowing to
`system.equipped` answers `false` for every cloak, glove, harness and pack on the
character. `declaresSlots` separates "declared to sit nowhere" from "never
annotated"; name-heuristic fallbacks must gate on it.

Slot keys and their capacities come from `vocab.mjs` `WEAR_SLOTS` / `SLOT` /
`slotCapacity`. The ring place's capacity is imported (the `wearSlots` document,
JJ p. 144): `slotCapacity("ring")` answers `null` until it is, `slotUse` then
reports `cap: null` and never `full`, and `slotCapacitySource` says where the
figure came from. `ACCESS_COSTS` names the two retrieval kinds (`free`, `action`; RR p. 294) as ids and holds no label.
Which carriers sit on which side is imported (the `gearAccess` document, table `retrieval`, `{action, free}` lists of the page's carrier words): `retrievalAccess(name)` answers `"free"`, `"action"` or `""` (the longest imported word the folded name contains decides; a tie, an unlisted name and an empty import answer `""`), and `retrievalAccessSource()` says whether the lists are a page's, the Judge's or absent. `GEAR_ACCESS_DOC`, `RETRIEVAL_TABLE` and `declareGearAccessTables` name and declare it (apiVersion 49).

### `storage` — goods kept somewhere other than on you

The system has no inventory anywhere except an actor's own item list, and no way
to move an item between actors at all: its drop handlers **copy** — they create
on the target and never delete from the source. Markets, banks, base camps and
"leave it at the inn" all need that same missing primitive, so it lives here.

```js
const { isProvider, setProvider, findVaultOf, storedItems, storesByOwner,
        providersFor, storedCoinGC, stash, retrieve, moveStored, handOver,
        stockProvider, depositCoin, consolidateMoney, returnGoodsTo,
        landGoods, coinContainerOf, coinMayEnter,
        STORAGE_HOOKS } = acksExtras.lib.storage;
```

**The model.** Stored goods are REAL EMBEDDED ITEMS on a provider actor, stamped
`flags.acks-extras.storage = {ownerUuid, ownerName}`. That is what makes the rest
work: the goods stop weighing on the character because they are genuinely not on
the character, and every sheet, macro and rule that reads an actor's items reads
a location's stock unchanged — nothing has to stay in sync with a parallel record
of what is really where.

A **provider** is any actor carrying `flags.acks-extras.storage.provider`; a
personal vault also carries `vaultOf: <owner uuid>`. This library deliberately
does not know what a "location" is — the location feature’s settlement, the henchmen feature’s
market actor and the carts a later pass turns into base camps are all just actors
with the flag, so `setProvider(actor)` is the whole of "this can hold goods now".

**Transfers** plan everything before writing, then create on the target *before*
deleting from the source: a half-finished move duplicates goods rather than
destroying them, and the source half failing triggers a compensating delete (with
a loud error if even that fails). Arrivals are normalised — nothing arrives
equipped, a balance in the system's retired `quantitybank` field never travels
(the row it sits on is kept when its coin leaves), and the equipment feature’s
`containedIn` pointers are remapped when a container travels with its contents
and stripped when it does not. `spec` is `[{id, quantity?}]` — omit `quantity`
for the whole stack.

`stash`, `retrieve` and `moveStored` cross a place. `handOver(from, to, spec)`
is actor to actor: nothing is stamped, the goods leave the giver, and the seat
must own both ends. `moveStored` asks the same.

`stash(source, provider, spec, {quiet, userId} = {})` (apiVersion 63) takes two options, both
for a caller that makes the move on another seat's behalf and says the result
itself: `quiet` refuses by result alone (no warning for a refusal, and no
Judge's reach warning before the move), and `userId` is the user the move is
made for, reported on the `STASHED` hook in place of the seat's own. Both are
forwarded to the transfer; a call that passes neither behaves as before. The
set-down handler (`docs/location/MODEL.md`, "On the ground") is the caller.

A seat that owns the character's end of a `stash` or a `retrieve` and not the
place's hands the whole move to the GM (the `libMoveGoods` handler), whose seat
plans it again from the same arguments. It is made only for a sender who owns
the character. A deposit is put to the location feature's deposit reach there;
a retrieval takes rows kept for that character and house rows marked
`retrievable`, and one row outside those refuses the whole request, except
that a character who reaches a set-down pile (`depositReach`, the pile's own token)
takes any row on it. Every move
resolves `{ok, manifest?, reason?}`: `noGm` with no GM connected, `outOfReach`
(with `why` and `scene`) for a deposit the character cannot make from where
they stand, `permission` for a sender or a row the rule does not allow. The
refusal is said on the asking seat. The `STORAGE_HOOKS` fire on the client that
made the writes, their `userId` the user who asked.

A move that stamps an owner refuses an unlinked token's own
actor at either end, because the stamp is a uuid that dies with the token; a
hand-over stamps nothing and crosses one freely. `stockProvider(provider,
goods, {ownerUuid, ownerName})` puts goods that come from nobody (a
compendium, the sidebar) at a place under an owner.

Arriving stacks **merge into matching rows** rather than piling up beside them:
the system's own merge matches on document ID, which only works for items
sharing an id lineage, so without this a retrieved 20 gp becomes a second "Gold"
row and half a stack of torches comes back as a second torch row. Coin is keyed
on its kind, name and rate together (`money.coinKind`); every
other stackable is keyed on the whole document minus the quantity, which is
strict on purpose — a torch in a backpack, a torch that costs more, and an item
carrying its own Active Effects each keep their own row, because over-merging
destroys data silently while under-merging is a tidy-up. At a provider the key
also carries the owner, so two characters' goods stay two rows. Away from a
provider an arrival is nobody's, and it never folds into a row that is stamped
for an owner. Coin handed to a holder goes inside the carried container their
coin order names, else loose (`coinContainerOf`); see `money` below. Every
landing writes through `landGoods(actor, arrivals, {byOwner?, coinInto?,
keepId?})`, which resolves to `{created, updated}`. `coinMayEnter(holder,
box)` is whether coin may be put inside a carried container: not while a lock
shuts it, and not where it names the kinds it holds and leaves coin out.

**When the place is destroyed**, `registerStorageCleanup()` (installed at init)
applies the world setting **`storageDeletePolicy`**: `return` (default) hands
each owner their goods back inside a container named after the place, `lose`
drops them. Exactly one client executes — elected via `game.users.activeGM`,
unlike the idempotent mount cleanup — because this one creates documents. The
manifest is whispered to chat *before* anything moves, so a failure still leaves
a record. Hooks: `acksLibStorageStashed`, `…Retrieved`, `…Moved`, `…Returned`,
`…Lost`, `…ProviderChanged`.

**Attribution is a UI convention, not a security boundary.** `ownerUuid` lets
sheets group and gate rows; a player with ownership of a shared location can
still reach every item on it from the console — the same ruling the equipment feature
makes for containers. Anything that must genuinely stay secret belongs on a
GM-owned actor.

`providersFor(actor)` scans the world's actors once; call it per render and share
the result rather than per row. It counts goods only: a stored Item that is not
goods (a market report on the trade house) never makes its place a row.

### `money` — coin as a thing that sits somewhere (apiVersion 25)

Every path that counts, values, moves, makes or destroys coin goes through
this surface. A feature never writes a coin row's count itself.

```js
const { coinKind, coinCount, coinRate, coinTotalCp, coinTotalGC,      // read
        coinSlots, planCoinSpend, planCoinPayUpTo, planChange,        // plan
        LOOSE_STORE, containerStoreKey, placeStoreKey, readStoreKey,  // stores
        coinStores, coinOrderOf, setCoinOrder, keepsCoinElsewhere,
        ownCoin, purseGp, spendableGp,
        standingCoinScope, COIN_SCOPE_SETTING,                        // reach
        coinReach, exchangeTermsAt, HOUSE_OWNER,
        creditCoin, mintCoin, sinkCoin, transferCoin, exchangeCoins,  // write
        gatherCoin, coinTemplate } = acksExtras.lib.money;
```

The read and plan halves are `money-logic.mjs`, Foundry-free, and take plain
item data. Everything is integer copper inside.

**`within`** is how far a call reaches into coin kept away from the holder:
`"all"` (every store), `"hand"` (the stores on the holder), an Actor that is
a place (those and the coin that place keeps), a Scene (those and the places
on it). Left out, the call takes the world setting `coinScope`.

| Call | Answers or does |
|---|---|
| `coinCount(row)` / `coinRate(row)` / `coinKind(row)` | How many coins a row holds, what one is worth in copper, and the key it stacks under (name and rate together). |
| `coinTotalCp(rows)` / `coinTotalGC(rows)` | What a set of rows is worth. Rows that are not coin count for nothing. |
| `coinStores(holder, {within?})` | The stores a holder's coin is kept in, in the standing order: loose, each carried container, each place. Each is `{key, kind, name, actor, containerId, rows, shut, takesCoin, writable, vault}`. |
| `containerStoreKey(itemId)` / `placeStoreKey(actorUuid)` / `LOOSE_STORE` / `readStoreKey(key)` | The key that names a store, and what a key names: `{kind: "loose"}`, `{kind: "container", id}` or `{kind: "place", uuid}`. A key that reads as nothing names coin carried loose. |
| `coinOrderOf(holder)` / `setCoinOrder(holder, {payFrom?, receiveInto?})` | The order a holder states, as two store keys, and the write of either half. `setCoinOrder` resolves to the order now stated. |
| `keepsCoinElsewhere(holder)` | Whether a place may keep coin for this holder: not for a location, and not for an unlinked token's own actor. |
| `ownCoin(holder)` / `purseGp(holder)` | The coin rows a holder has on them that are their own, loose ones first: an actor's purse and what its containers hold, or a place's house-owned stacks. And what they are worth in gold. |
| `spendableGp(holder, {within?})` | What a payment may draw on, in gold: every store inside the reach that no lock shuts. |
| `standingCoinScope()` / `COIN_SCOPE_SETTING` | The world's standing reach, `"all"`, `"scene"` or `"hand"`, and the key of the setting that states it. |
| `coinReach(from, to)` | `{can, reason, scene?}`: may coin get from one holder to the other now. A refusal about a place on a map names the map. |
| `reachRefusalText(reach, from, to)` | `coinReach`'s refusal as a sentence about the two holders. |
| `creditCoin(holder, credits, {ownerUuid?, ownerName?, into?, within?})` | Lands coin in the store the holder's order names, on the row of its kind there. A credit is `{count}` plus `source` (a coin row's plain data), or `name` and `cv`, or `cv` alone. `into` is a store key that overrides the order; `ownerUuid` puts the coin on the holder under that owner whatever any order says. Resolves to `{updates, creates}`. |
| `mintCoin(holder, gp, opts?)` | Coin from nowhere, in standard denominations. `opts` are `creditCoin`'s. |
| `sinkCoin(holder, gp, {within?})` | Coin paid to nobody. `{ok, changeCp}`, or `{ok: false, reason: "insufficient", shortfallCp}` with nothing written. It does not warn; the caller says why. |
| `transferCoin({from, to, gp, reason?, at?, gate?, allowMint?, upTo?, within?, judge?})` | Coin from one holder to another. `judge` carries the Judge's own payment past a reach refusal and tells them what was waived (`judgeDeclares`, `lib/sockets.mjs`). `{ok, changeCp}`, or `{ok, paidCp, arrearsCp}` under `upTo`, or `{ok: false, reason}` after its own warning (`notTogether` and the other reach reasons, `insufficient`, `noChange`). |
| `exchangeCoins({actor, place, itemId, count, toCv, judge?})` | One kind for another at a market. `{ok, paidOutCp}`. `judge` is `transferCoin`'s. |
| `gatherCoin(holder)` | Folds rows of one kind in one store into one, on the holder and at each place keeping coin for them that the seat may write. `{merged}`. |
| `coinTemplate({cv?, name?})` | The plain data a new row of that coin is copied from, or `null` when the world has none. |

**A payment the seat cannot write.** `transferCoin` and `sinkCoin` hand the
whole payment to the GM when it touches a document the seat does not own: a
place keeping coin for either side, or a payee. The result has the same
shape. With no GM connected it is `{ok: false, reason: "noGm"}`, nothing is
written, and the relay tells the seat that a GM must be connected. A relayed
payment never mints: `allowMint` is honoured only at a seat that owns the
till.

`transferCoin` takes no `toBank` option: coin lands where the payee keeps
arriving coin, and coin kept at a place for somebody else goes there through
`storage.depositCoin` or `storage.stash`.

`creditCoin` lands coin in the store the holder's order names, and a payment
draws on every store in reach. A caller that must keep to coin on hand passes
`within: "hand"`.

The rules these calls keep (one count, the kind as merge key, stores and a
holder's order, a payment's reach, exact change) are [MODEL.md](MODEL.md),
"Currency".

### `coinOrder` — the order on a sheet

```js
const { view, bind, TEMPLATE } = acksExtras.lib.coinOrder;
```

A sheet that lists a holder's coin draws the order with these and writes none
of its own. `view(holder, {places?})` builds what the `TEMPLATE` partial is
handed: `{uuid, editable, shown, choice, payFrom, receiveInto, foldable,
onHandGp, keptGp, reachNote}`, the two option lists as `{key, label,
selected}`. `places` are `{uuid, name}` rows for places the sheet lists that
keep none of the holder's coin yet. Draw the block only while `shown`. Every
actor sheet's blocks are bound as it renders; `bind(root)` is for a block a
sheet injects after its render hooks have run. The selects carry no `name`:
the listener writes the choice through `setCoinOrder` and stops the event, so
the block is safe inside a form that submits on change.

### `wallGeometry` / `wallLayers` — a line the Judge drew (apiVersion 16)

A wall is Foundry's only drawn line, and the module means more than one thing
by one: a tripwire across a corridor, a street through a city. Neither is a
barrier; both are a LAYER — a flag under `flags.acks-extras.<key>` over whatever
segment is already there — and the mechanics every layer shares live here once.

`wallGeometry` (`lib/wall-geometry.mjs`) is Foundry-free: crossings and
point-to-segment distances, `chainWalls` (a hand-drawn loop into a ring),
`joinSegments` (a planar graph — endpoints within a tolerance are one node, and
a segment is cut wherever another crosses it), `shortestPath`, and
`pathLengthAlong` — how far it is ALONG the lines between two points, with the
legs off the lines reported apart; null when neither end is within reach or the
two ends sit on networks that never meet. A macro can measure a route with it
and no canvas.

`wallLayers` (`lib/wall-layers.mjs`) needs a world: `wallLayer`/`hasWallLayer`
(read through the document's accessor where there is one and off the raw flags
where there is not — a create hook's data bag and the palette preset carry the
same layer with no accessor), `setWallLayer` (the patch is
merged here and written as a forced replacement, since a flag write is a merge
and a merge cannot empty a field), `clearWallLayer`, `wallsFlagged`,
`openWallData` (the all-NONE restriction shape a non-blocking line is drawn
with), `blocksMovement`, `wallNear`, `armWallPreset`/`currentWallPreset`
(core's ONE wall-drawing preset slot — arming a street disarms a tripwire),
`wallSheetFields` (where a layer's row goes on the wall sheet, whose application
root is its form), and `regionFromWalls` (the Region a closed loop encloses,
idempotent by behaviour type). What a layer MEANS belongs to the feature that
owns its key: the trap line in `docs/formation/MODEL.md`, the road in
`docs/battlemap/MODEL.md` "Roads".

Versions 13 to 15 landed with 4.19.0 (the library read where the importer
writes it), 4.20.0 (one name rule; packages that link rather than copy) and the
carry-model release of 2026-08-28; every surface they added is a row in
`scripts/lib/README.md`.

### `acks-extras.template` — the generator actor

The MM's "characteristics by rank/age/tier" creatures (dragon, cacodemon,
elemental) have no stat block — every cell points at tables on the following
pages — and modifier creatures (vampire thrall) rewrite a victim rather than
standing alone. `TemplateData` holds that procedure as a document: AXES whose
options carry **engine-ready patches** (`system.*` fragments, embedded-item
payloads, name pieces, art paths, description snippets), N-dimensional `cells`
refinements, and a rolled special-ability `menu`. The importer subsystem
materializes all of it from the reader's own book; this library never
interprets book content — a bookless template has empty axes and the
sheet says so instead of offering an empty Generate.

```js
const { chooseAxes, resolveActor, rollMenu, rollDie, mergePatch, seededRng } =
  acksExtras.lib.templateLogic; // Foundry-free, Node-importable
```

Per-axis precedence is **pinned > derived > rolled**: the Judge pins what they
care about, an axis with `derive.from` reads a dropped base actor (the thrall
keeps its victim's HD, capped), and everything else rolls per the book's own
die over the printed bands (uniform when the page prints no die). Quick use
pins nothing: drop a Dragon template in and Generate yields a rules-legal
random dragon in one click. `resolveActor` merges the chosen options in axis
order, then the `cells` (so a per-age-per-form damage cell outranks the age
row it refines), and composes the name from `output.nameFormat`
(`"{tier} {element} Elemental"`, `{base}` = the dropped actor's name).

The **builder sheet** (`TemplateSheet`, registered at `ready`) shows one select
per axis defaulting to "Roll", a drop zone for the base actor, and Generate;
pins and the base are per-window UI state, never document data. Generated
actors carry `flags["acks-extras"].generated = {templateUuid, choices, log, menu}`
as provenance.

Options carry actor-level `flags`/`token` channels (a family
variant is a complete creature — sheet extras and token size included) and a
NULLABLE `nameLabel` (null → label; empty string → contributes nothing, so a
Standard role stays out of generated names). Axes may set `multi: true` —
opt-in, never rolled, every checked option applies in list order (stacked
add-ons instead of a combinatorial option list). A dropped base actor
SEEDS generation (full system/items/flags, patches layered on top), so
templates COMPOSE: generate a Goblin Chieftain, drop it on Vampire Thrall.
The sheet's edit mode adds/removes axes and options and CAPTURES a dropped
actor as an option's preset — hand-built families with no import, post-import
extension, and cross-book merging all ride that one gesture; capturing into
an otherwise-empty template adopts the source actor's TYPE (mounts and pack
animals are container roots too).

`mergePatch` understands RELATIVE leaves — `{"$add": n}` adjusts the
existing numeric value instead of replacing it (missing base counts from 0;
only the exact one-key `{$add: number}` shape is relative). This is the
primitive MODIFIER templates build on: an aging template's attribute patch
composes with whatever base actor it is stacked onto.

Menu rows may carry a `sub` generation roll ({die, twice?, outcomes:
[{min,max,text}]}, importer-materialized from the ability's own prose);
`rollMenu` resolves it when the row is picked (picks are row COPIES carrying
`subResult`) via the exported `resolveSubRoll`. Never recurses — an outcome
that itself says "roll 1d8+4 twice" stays text for the Judge.

`system.base` {merge, flags} is the FIXED foundation applied before
any axis (the stat rows a template page prints as plain values); options
gain `tint` (token texture tint — a dragon wears its hide color), applied
by the builder alongside art and token-size fragments.

Cells carry `flags` beside `merge` and `items`: `resolveActor` merges a
matching cell's flags into the generated actor's, so what the Full Monster
Sheet reads outside `system` (a leader's Hit Dice rating, its save class)
moves with the cell's stats. An axis may name a `default` option: an
unpinned, underived axis takes it instead of rolling (precedence **pinned >
derived > default > rolled**), logged as `source: "default"`. The
**availability rule** (`optionAvailable(system, axis, option, choices)`): an
option with no patch of its own (empty `merge`, `items` and `flags`) on an
axis some cell names is only the key of its cells, so it stands only where a
cell matches it beside the choices already made; the axis's `default`, any
option with a patch, and every option of an axis no cell names always stand.
`chooseAxes` chooses only among available options; a pin of an unavailable
one is logged as `source: "unavailable"` and falls through to default or
roll. The builder sheet and the group sheet's variant dialog name the default
in the blank choice, and the builder lists an unavailable option disabled.
`axisOffersChoice(system, axis, choices)` is false for an axis with at most
one option available beside the choices: the builder leaves such an axis off
(outside edit mode) and drops a pin left on it, since generation can take only
that one. A multi axis and one that derives from a base always show.
A cell may carry `rollHp: true`: `resolveActor` returns `rollHp` true when the
last matching cell that touches hit points (one with `rollHp` or an `hp`
merge) asks for it, and the generator then rolls `system.hp.hd` for the
actor's value and max, logged as `{axis: "hitPoints", source: "rolled"}`. A
cell whose figures leave hit points unprinted (a derived leader) uses it, and
a later cell that writes fixed hit points turns it off.
A cell may carry `dropItemTypes` (item types): when it matches, every item of
those types leaves the payload, whichever axis or cell added it. A
noncombatant dependant drops `weapon`, so it keeps no attack.
`rollDice(expr)` rolls a die with a flat modifier (`"1d4+1"`); the generator
uses it for a caster whose `extras.spellcasting.levelDie` stands in for a
printed level, logs the roll as `{axis: "casterLevel"}`, and the magic
listener then takes that class's slots at that level before drawing the
repertoire. The family Role axis built on all of this is
[docs/monsters/MODEL.md](../monsters/MODEL.md), "Family templates: the Role
axis".

**Per-variant bands** (apiVersion 66). An axis may carry `bandsFrom: {doc,
table, by}` (strings; all blank is none, and any one filled in makes the axis
banded, so a half-written spec offers its default alone and never rolls
uniform). It is opt-in: an axis without it behaves as above, which keeps
summons, the cast dialog and the builder as they were. The bands are read at
roll time from the registry, not copied onto options, so a Judge's override
counts at once. **Band contract:** in `getDoc(doc).tables[table]`, the row
keyed by the option's `key` holds, under the key of the option chosen on axis
`by` (which must come earlier in axis order), a band `{min, max}` of whole
numbers, `min <= max`, a band printed as one value having `min === max`; a
column with no printed band holds nothing (absent, null or blank), and a row
the import marked missing reads as none. Under `bandsFrom`: an option with no
band for the chosen variant is unavailable (the axis's `default` aside, which
needs none); with no resolver, no table or no choice on `by` yet only the
default stands, and nothing throws. The roll uses the axis's own `roll` die,
else `bandDie` of that variant's column (a column topping at 20 rolls `1d20`),
over the available options' bands; the roll and die ride the log entry
(`{source: "rolled", roll, die}`). A roll outside every band takes the default
and logs `source: "gap"`, or with no default leaves the axis unchosen and logs
the gap with no `option`; the uniform fallback never applies. A multi axis uses
the bands for availability only.

The Foundry-free logic takes the bands as a resolver,
`bandOf(axis, option, choices) → {min, max} | null`, in the options of
`chooseAxes`, and as a last argument of `optionAvailable` and
`axisOffersChoice`. `registryBands()` (`scripts/lib/template-bands.mjs`)
builds it from the registry, never throws, and returns null for every absence;
`generateFromTemplate` and the builder sheet each build one. `axisIsBanded(axis)`
is the one test of the field. `ROLL_PIN` (`templateLogic.ROLL_PIN`) as an axis's
pin makes it roll though it names a default, passing over derive too; an axis
without `bandsFrom` then rolls by its printed option bands, else uniform. The
group sheet's variant dialog lists a banded axis's every option, since the
variant is not yet chosen there; `chooseAxes` drops one with no band.

## `itemUse`, `itemRun` and `auraReach` — the item carrier and the live reach

Rows on the lib api from `apiVersion` 76.

- `itemUse.addClaimant({key, claims, run})` / `removeClaimant(key)`: the seam on `Item#use`. The first claimant whose synchronous `claims(item, options)` answers exactly `true` runs `run(item, options, system)`; `system()` is the system's own use, once. A claimant must decline every spell.
- `itemRun.useItem(item)`, `registerRunner(kind, fn)`, `setPresenter(fn)`, `setFuseBurst(fn)`, `pressRoll({itemUuid, rowKey, activationId, subject})`, `undoEntry({subject, entry})` (GM only), `rowsOf(item)`, and `logic` (the pure half: `readItemRun`, the record builders, `checkPressRequest`, `promptCardModel`, the fuse functions). An item carries `flags["acks-extras"].itemRun = {activation: {kind: once|toggle|fuse|consume, state, throw, fumble, fuseDice, uses}, rows}`; an ability keeps its rows in `extras.effects`.
- `auraReach.raise({tokenUuid, sourceUuid, rowKey, activationId})`, `lower({tokenUuid, activationId?})`, `snapshot(scene, {token}|{point}, rangeFeet)`, `support()`, and `logic` (`reachAdmits(bearer, subject, filter, deps)` true, false or null; `registerUnitAncestry(fn)`; `resolveFigure(ref)` and `figureNumber(ref)`; `pulseAct`).
- Vocabularies `REACH_PULSES`, `REACH_SIDES`, `REACH_UNITS`, `ITEM_RUN_ACTIVATIONS`; constants `AURA_BEHAVIOR_TYPE` and `BEARER_DOWN_HOOK` (`acksExtras.bearerDown`, `(token, {cause})`, cause `hp` or `defeated`).
- `actor-read.mjs` (internal): `creatureKinds` reads a character's race key and category and a monster's `subtype`; `registerCharacterRace(fn)`, `raceCategoryOf`, `kindToken`, `MEN_RACES`, `DEMI_HUMAN_RACES`.
