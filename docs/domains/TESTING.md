# Domains — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`; the location
and market fixtures are `docs/location/TESTING.md`. Steps 1–12 are walked by
`tools/live/domains.mjs` (`node tools/live/run.mjs domains`).

## Before anything else

`game.documentTypes.Actor.includes("acks-extras.domain")` must be true. The
sub-type is read by the server at world launch, not on reload: on a world
launched before the module carried it, `Actor.create({type: "acks-extras.domain"})`
returns falsy with "not a valid type" on the console and nothing persists.
Shut the world down and relaunch it, then check again.

## Fixtures

Every one disposable, tracked by id as it is made.

- Two `acks-extras.domain` actors: **Domain 1** (the liege) and **Domain 2**
  (the vassal).
- A character to rule Domain 1.
- An `acks-extras.location` with a market (press **Add a market**) and urban
  families entered — the settlement.
- An `acks-extras.location` with nothing in it — the stronghold.
- A second empty `acks-extras.location` — the prune's control.
- A world `item` and a piece of gear on the ruler, for the refused drops.

## Core drive mechanics

- **Create, then update.** The ACKS system overrides `Actor.create` and
  replaces a single create's `system` unless the data carries `items`, so a
  domain created with its record lands blank. Create the bare actor, then
  `update({system: acksExtras.domains.normalizeDomain(record)})` — the order the
  importer's binding uses, and the order a Judge works in.
- **List fields are named form rows**: `system.territory.0.families`,
  `system.vassalRows.1.domainHexes.classes.outlands`. A scripted edit sets the
  control's value and dispatches `new Event("change", {bubbles: true})`; the
  sheet submits on change and writes the whole list. Hex labels are one text
  field, split on commas and spaces into a list.
- **A drop on a domain is read by what is dropped**, and for a domain by where
  it lands: on the liege row (`[data-drop-zone="liege"]`) it becomes the
  liege, anywhere else a vassal. Click the Realm or Overview tab first so the
  target is rendered.
- **The row remove button asks first.** It opens a confirm dialog; press its
  yes button, or the row stays.
- **The prune is not on the api**:
  `(await import("/modules/acks-extras/scripts/location/module.mjs")).pruneEmptyLocations()`,
  with the `acks-extras.pruneEmptyLocations` setting on.

## Steps

1. **A record, written the way the binding writes it.** Create Domain 1 bare,
   then update it with a record of invented figures: two territory rows (one
   with hex labels, one with a count), an unplaced settlement holding with
   families, two structure rows with costs, every revenue line set (one as
   per-family rates, one as totals), every expense line but one, a vassal row
   with a tribute and an extra tax, morale, a favor and a duty.
   *Observable:* every tab renders the record; on Overview the peasant
   families, hexes and stronghold value equal the sums by hand; the Ledger's
   totals equal the lines by hand, and both totals carry the partial note
   naming one unset line. Enter the missing line. *Observable:* the partial
   note is gone.
2. **Every kind of field.** On the sheet, edit the title (text), the
   classification (select), the current morale (number), a territory row's
   families (row field), its hex labels (typed as `0101, 0102`), a vassal
   row's classification checkbox, and the notes. *Observable:* each survives
   a re-render, and the stored value has its type — `system.territory[0].hexLabels`
   is `["0101", "0102"]`, a checked class is in `classes`, a cleared number is
   null.
3. **Rows added and removed.** Press **Add tract** under Territory. *Observable:* a
   new row with an id of its own; the rows before it keep their values. Remove
   it and confirm. *Observable:* it is gone and the others are unchanged.
   Remove one and cancel. *Observable:* nothing is removed.
4. **A place is held, once.** On Holdings, drop the settlement on Domain 1.
   *Observable:* a row with role **settlement**, the place's own families and
   market class shown beside it, and the urban families on Overview include
   them. Drop the stronghold. *Observable:* a row with role **other**. Drop
   the settlement on Domain 2. *Observable:* refused with a warning naming
   Domain 1; Domain 2's holdings are unchanged.
5. **The realm.** On Domain 1's Realm tab, drop Domain 2 (not on the liege
   row). *Observable:* `Domain 2.system.parentUuid` is Domain 1's uuid;
   Domain 2 is listed among Domain 1's vassal domains, and its tribute joins
   tribute in. Now drop Domain 2 on Domain 1's **liege row**. *Observable:*
   refused as a loop with a warning naming both; neither `parentUuid` moved.
   Domain 1's liege picker does not offer Domain 2. Press the release button
   on the vassal. *Observable:* Domain 2's `parentUuid` is empty.
6. **The ruler.** On Overview drop the character. *Observable:* `rulerUuid`
   and `rulerName` are the character's, and `domainsRuledBy(character)` names
   Domain 1. Drop an organisation. *Observable:* refused.
7. **Goods are refused.** Drop the world item and the ruler's gear on the
   sheet. *Observable:* one warning per drop naming the domain;
   `Domain 1.items.size` is 0 and the ruler still has the gear.
8. **A held place survives the prune.** The prune deletes every empty place
   in the WORLD, not this run's alone: run it only when every empty location
   the world holds is a fixture of this run, and otherwise report the step not
   run. Turn the prune setting on and run it. *Observable:* the held
   stronghold survives; the control location is gone. The sweep then reports
   the control missing, which is expected.
9. **A place a domain holds, and the place around it.** Create a location
   inside the settlement (`system.parentUuid` the settlement's uuid).
   *Observable:* `acksExtras.domains.domainOf(it)` is Domain 1, and
   `holdsPlace(it)` is false.
10. **The delete path.** Delete the settlement. *Observable:* its holding row
    stays, marked missing; the urban families drop to the unplaced town's and
    say one settlement gives no figure; the urban rates make the ledger
    partial rather than smaller; the sheet renders without a console error.
    The row still names the uuid, so `holdsPlace` and `domainOf` still answer
    for it until the Judge removes the row.
11. **A player reads, and writes nothing.** Give the Player seat Observer on
    Domain 1, hide one holding, and join as that player. *Observable:* every
    control is disabled; no add, remove, clear or release button renders; the
    hidden holding is absent, a land value shows only on a revealed row, and
    the GM notes are absent. In that seat's console,
    `await acksExtras.domains.hold(Domain 1, place)` returns
    `{ok: false, reason: "judgeOnly"}`.
12. **Layout.** Shrink the sheet to its shortest height. *Observable:* the
    body scrolls to its last control and the tabs stay in view. Raise the
    type-size setting and open a fresh copy of the sheet. *Observable:* the
    body and the header both take the new size.
13. **The official sheet's domain page.** Walked with the official sheet,
    not by `tools/live/domains.mjs`: `docs/character-sheet/TESTING.md`, "The
    official sheet (PDF)", steps 3–5a, 11 and 13.

## Teardown

Delete by the run's own ids: both domains, the character, the locations (the
inner one of step 9 with them), the world item. Holdings, vassal rows and
every other list are rows on the domains, so they go when the domains do;
step 5 writes `parentUuid` only on Domain 2. Quote `api.sweepTracked()`'s
result. Restore the prune setting.
