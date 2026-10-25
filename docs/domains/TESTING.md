# Domains — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`; the location
and market fixtures are `docs/location/TESTING.md`. Steps 1–18 are walked by
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
- An organisation, refused as a ruler and refusing a domain.
- An `acks-extras.location` with a market (press **Add a market**) and urban
  families entered — the settlement.
- An `acks-extras.location` with nothing in it — the stronghold.
- A second empty `acks-extras.location` — the prune's control.
- A world `item` and a piece of gear on the ruler, for the refused drops.
- A scene, for the tokens of step 18.

Steps 15 and 16 make a domain and a location of their own; each is tracked
the moment its id is read back (below).

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
- **The band's fields live in the window header**, not the content box:
  `name`, `system.title`, `system.morale.current` and `system.morale.base` are
  found from the application's root (`app.element`), and submit as any field.
- **A drop on a domain is read by what is dropped**, and for a domain by where
  it lands: on the liege chip (`[data-drop-zone="liege"]`) it becomes the
  liege, anywhere else a vassal. The chips stand above every tab; click the
  Realm or Overview tab first so a tab target is rendered.
- **A picker is a prompt with one select.** Press the chip's
  `[data-action="pickRuler"]` or `[data-action="pickLiege"]`; the dialog holds
  `select[name="choice"]` with a uuid per option. Set its value, dispatch
  `change`, press `button[data-action="ok"]` — never take the first option, in
  a shared world it is anyone's. Closing the dialog chooses nothing. A picker
  with nothing to offer opens no dialog and says so.
- **The row remove and the promote buttons ask first.** Each opens a confirm
  dialog; press its yes button, or nothing happens.
- **Read back what a press made, and track it at once.** Promoting a row
  makes a domain: list `vassalsOf(Domain 1)` before and after, and track the
  new uuid. Founding makes a location: the new uuid is the last holding's.
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
   *Observable:* every tab renders the record; the land rail's peasant
   families, urban families, hexes and stronghold value equal the sums by
   hand; the Ledger's totals and the month rail equal the lines by hand, and
   the Ledger carries the partial note naming one unset line. Enter the
   missing line. *Observable:* the partial note is gone.
2. **Every kind of field.** On the sheet, edit the title and the name in the
   band (text), the classification (select), the current and base morale in
   the band (number), a territory row's families (row field), its hex labels
   (typed as `0101, 0102`), a vassal row's classification checkbox, and the
   notes. *Observable:* each survives a re-render, and the stored value has
   its type — `system.territory[0].hexLabels` is `["0101", "0102"]`, a checked
   class is in `classes`, a cleared number is null.
3. **Rows added and removed.** Press **Add tract** under Territory. *Observable:* a
   new row with an id of its own; the rows before it keep their values. Remove
   it and confirm. *Observable:* it is gone and the others are unchanged.
   Remove one and cancel. *Observable:* nothing is removed.
4. **A place is held, once.** On Holdings, drop the settlement on Domain 1.
   *Observable:* a row with role **settlement**, the place's own families and
   market class shown beside it, and the urban families on the rail include
   them. Drop the stronghold. *Observable:* a row with role **other**. Drop
   the settlement on Domain 2. *Observable:* refused with a warning naming
   Domain 1; Domain 2's holdings are unchanged.
5. **The realm.** On Domain 1's Realm tab, drop Domain 2 (not on the liege
   chip). *Observable:* `Domain 2.system.parentUuid` is Domain 1's uuid;
   Domain 2 is listed among Domain 1's vassal domains, and its tribute joins
   tribute in. Now drop Domain 2 on Domain 1's **liege chip**. *Observable:*
   refused as a loop with a warning naming both; neither `parentUuid` moved.
   Domain 1's liege picker offers neither Domain 2 nor Domain 1. Press the
   release button on the vassal. *Observable:* Domain 2's `parentUuid` is
   empty.
6. **The ruler.** Drop the character on the ruler chip. *Observable:*
   `rulerUuid` and `rulerName` are the character's, and
   `domainsRuledBy(character)` names Domain 1. Drop an organisation.
   *Observable:* refused.
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
   `holdsPlace(it)` is false. Open the settlement's sheet. *Observable:* its
   Domain line (`.acks-extras-place-domain`) names Domain 1, holding it. Open
   the inner place's. *Observable:* its line names Domain 1 and the
   settlement around it. Create a location with no parent, which no domain
   holds (the prune took the control), and open its sheet. *Observable:* it
   renders, with no Domain line. Walk this before step 10 deletes the
   settlement.
10. **The delete path.** Delete the settlement. *Observable:* its holding row
    stays, marked missing; the urban families drop to the unplaced town's and
    say one settlement gives no figure; the urban rates make the ledger
    partial rather than smaller; the sheet renders without a console error.
    The row still names the uuid, so `holdsPlace` and `domainOf` still answer
    for it until the Judge removes the row.
11. **A player reads, and writes nothing.** Give the Player seat Observer on
    Domain 1, hide one holding, and join as that player. *Observable:* every
    control is disabled; no add, remove, clear, release, picker, promote,
    found or heraldry press renders; the hidden holding is absent, a land
    value shows only on a revealed row, and the GM notes are absent. The band
    sits in the header and names the domain; the pills open their tabs, and no
    pill, rail cell or name press is disabled. In that seat's console,
    `await acksExtras.domains.hold(Domain 1, place)` returns
    `{ok: false, reason: "judgeOnly"}`.
12. **Layout.** Shrink the sheet until the Ledger outgrows it. *Observable:*
    the Ledger's part scrolls to its end and to its last control, and the tabs
    stay in view. Shrink it below the frame's own height. *Observable:* the
    content box scrolls the whole panel into view, and the panel still scrolls
    to its end and to its last control. The Ledger's totals and treasury row
    follow its last control and hold none, so a panel at its end does not show
    that control: scroll back to it, and never read "reached" off the end.
    Raise the type-size setting and open a fresh copy of the sheet.
    *Observable:* the body and the band both take the new size.
13. **The frame.** *Observable:* after every re-render the window holds one
    band (`[data-application-part="band"]`), inside `.window-header`, showing
    the stored title, name and morale. The rails equal `familiesOf` and
    `ledgerFor`; over a partial ledger the three month cells are marked
    partial and the four land cells are not. The chips name the ruler and the
    liege (or its absence); the tags the classification and the alignment.
    Press the hexes cell, then the income cell. *Observable:* Territory, then
    Ledger, opens.
14. **The ruler and liege chips.** Clear the ruler on its chip. *Observable:*
    `rulerUuid` is empty and `rulerName` kept. Open the ruler picker.
    *Observable:* it offers the character and no place, organisation or
    domain. Choose the character. *Observable:* it rules again. On Domain 2,
    open the liege picker. *Observable:* it offers Domain 1 and not itself.
    Choose Domain 1, then clear the liege on its chip. *Observable:*
    `parentUuid` is Domain 1's, then empty, with a notice naming Domain 2.
15. **A vassal row becomes a domain.** On Domain 1's Realm tab, press the
    vassal row's promote button and confirm. *Observable:* one new domain,
    answering to Domain 1, in its folder; the row is gone; the new domain's
    ruler is the row's, its tribute out is the row's tribute plus its
    additional tax, its hexes and peasants are one territory row, and the
    row's two classes (step 2 ticked a second) leave the classification blank
    and appear in its notes. Domain 1's tribute in is unchanged.
16. **A settlement is founded.** On Holdings, press **Found a settlement** and
    accept the name. *Observable:* one new location with a market, held by
    Domain 1 as a settlement; `domainOf` it is Domain 1; its sheet opens; a
    notice says so and nothing errs.
17. **A domain is refused by a place and by an organisation.** Drop Domain 1
    on the stronghold's sheet and on the organisation's. *Observable:* a
    warning naming Domain 1 for each, and neither record changes.
18. **A domain's token is a marker.** Make a scene with `active: false`
    written out: core activates a new scene when none is active, which pulls
    every seated client to it and draws its canvas under the tokens being
    placed. Set on it a token of Domain 1, of the organisation, of the
    stronghold and of the character (`actor.getTokenDocument(...)`, then
    `scene.createEmbeddedDocuments`). *Observable:*
    `acksExtras.lib.places.sceneOccupants(scene)` lists the character alone,
    and `acksExtras.battlemap.sizeForToken` returns null for the three markers
    and a size for the character; the scene is still inactive and the console
    took no error.
19. **The official sheet's domain page.** Walked with the official sheet,
    not by `tools/live/domains.mjs`: `docs/character-sheet/TESTING.md`, "The
    official sheet (PDF)", steps 3–5a, 11 and 13.

## Teardown

Delete by the run's own ids: both domains, the character, the organisation,
the locations (the inner one of step 9 with them), the world item, the
domain step 15 made, the location step 16 founded, and the scene (its tokens
go with it). Holdings, vassal rows
and every other list are rows on the domains, so they go when the domains do;
steps 5 and 14 write `parentUuid` only on Domain 2. Quote
`api.sweepTracked()`'s result. Restore the prune and type-size settings.

## Territory on the map (added with the domain layer)

Walked by hand from a browser pane; not yet in `tools/live/domains.mjs`.
"Before anything else" above holds here too.

**Fixtures**, every one tracked by id as it is made: a disposable HEX-gridded
scene made with `active: false`, whose scene default names a territory; a
second hex scene for step 9; three `acks-extras.domain` actors, **Realm 1**
(classification civilized), **Vassal 1** (borderlands, `parentUuid` Realm 1's)
and **Realm 2** (outlands), each created bare and then updated (Core drive
mechanics); Realm 1 updated with two territory rows, one with no hex labels
and a count of 1 and one with a count of 3.

**Drive mechanics.** The brush, the palette, a point and a stroke are
`docs/battlemap/TESTING.md`, "The country's layers and water" and "Terrain
painting"; the overlay and the Map modes window are its "Map modes". A domain hex is
`paintHexAt(scene, point, domain.uuid, "domain")`, `null` to erase, and
`layerRegionsOf(scene, "domain")` lists its regions. A stroke through the
catcher carries `nativeEvent: { target: canvas.app.view }`, since a stroke
opens only on a press over the board. `mapModes()` returns each mode's key,
label and layer and none of its functions, so the drawing is read from the
modules: `borderSegments(scene, layerPlan(scene, "domain"), undefined,
domainWeights())`, `domainWeights` from `await
import("/modules/acks-extras/scripts/domains/domain-map.mjs")`, gives each
side's `weight`, and a drawn side's width is
`geometry.graphicsData[n].lineStyle.width`. A region placeable's `visible`
is set by its render flags, which a hidden pane applies at 1 frame a second:
read `isVisible`, or `visible` after a refresh. The sheet's Keep press is
`button[data-action="keepTract"]` on the read row; its picker is a prompt with
one `select[name="choice"]`, as the other pickers are.

1. **A hex painted into a domain through the palette.** View the scene, open
   the Country brush, press the **Domain** pill, Realm 1's swatch, and stroke
   one hex. *Observable:* the palette's context lists the domains in realm
   order, Realm 1 and Vassal 1 under Realm 1, Realm 2 under itself; one region
   flagged `domain` with Realm 1's uuid and `domainHexes` naming the hex, at
   `visibility` 0. Paint by `paintHexAt` two more Realm 1 hexes, two Vassal 1
   hexes beside them and two Realm 2 hexes beside Realm 1's.
2. **The Domains mode.** *Observable:* `mapView().mode` is "domain"; the
   legend lists Realm 1, Vassal 1 under Realm 1, then Realm 2, and Vassal 1's
   colour is Realm 1's hue, lighter. A side between Realm 1 and Realm 2, or
   facing unpainted land, weighs 1.75; one between Realm 1 and Vassal 1 weighs
   1; the drawn widths stand in the same ratio, and no hatch is drawn.
3. **The territory a hex derives.** *Observable:* `countryAt` at a Realm 1
   hex reads civilized with `source.territory` "domain"; at a Vassal 1 hex,
   borderlands; at an unpainted hex, the scene default with "scene". Clear
   Realm 2's classification. *Observable:* its hexes read the scene default.
   Set it back.
4. **The Judge's override, striped.** On the territory layer paint one Realm
   1 hex outlands, and one unpainted hex any class. *Observable:* `countryAt`
   at the first reads outlands with "map". In the Territory mode the
   overridden hex is planned with civilized's colour as its `stripe`, the
   overlay holds `stripeSegments(scene, territoryPlan(scene)).length` stripe
   lines, the legend carries the stripes line, the hexes of every classified
   domain have borders in their class, and the unpainted hex painted a class
   is not striped.
5. **The map follows the domains.** With the palette and the Domains mode
   open, rename Realm 1, set Vassal 1's classification to outlands, then clear
   Vassal 1's liege. *Observable:* within a moment the palette and the legend
   name the new name and no region was written; `countryAt` at a Vassal 1 hex
   reads outlands; Vassal 1 takes a colour of its own, and the side between it
   and Realm 1 now weighs 1.75. Set its liege back.
6. **Rows read from the map.** Open Realm 1's sheet on Territory.
   *Observable:* the two stored rows, then one read row per Realm 1 hex,
   naming the scene, with the paintbrush mark and a Keep press; the hexes rail
   is the stored rows' count plus the painted hexes. Paint a fourth Realm 1
   hex with the sheet open. *Observable:* within a moment a read row more.
7. **Keep.** Press Keep on a read row. *Observable:* the picker offers a row
   of its own and the count-1 row, not the count-3 row. Pick the count-1 row.
   *Observable:* that row's `map` is `{sceneUuid, key}` of the hex, the read
   row is gone, the row carries the painted mark, and the hexes rail is one
   lower. Keep another. *Observable:* with no row left to tie it to, no picker
   opens; a stored row naming the hex's label, a count of 1 and its `map`;
   the rail unchanged.
8. **Erasing deletes no row.** Erase the hex kept in step 7 onto the count-1
   row. *Observable:* the row stands, with the broken-link mark. Paint the
   same hex into Realm 2. *Observable:* Realm 1's row stays stale, and Realm
   2's sheet lists the hex as a read row.
9. **The delete paths.** Paint one Realm 1 hex on the second scene, with Realm
   1's sheet open, then delete that scene. *Observable:* its read row goes.
   Delete Realm 2. *Observable:* its hexes draw grey, the legend's last row
   names a domain no longer in the world, and `countryAt` at one reads the
   scene default. The sweep then reports Realm 2 missing, which is expected.
10. **A player.** Give the Player seat Observer on Realm 1 and join as that
    player. *Observable:* the sheet lists the read rows with no Keep press and
    the same hexes rail as the Judge's; the player's overlay holds no child
    and no region `isVisible`. Give the seat Observer on the scene to view it.
    In that seat's console, `countryAt` reads the derived class with
    "domain" at a Realm 1 hex and at a Vassal 1 hex, which the player cannot
    observe: the client holds every scene and every domain actor.

**Teardown:** `api.sweepTracked()`, which takes both scenes with their
regions and the domains, and quote its result. Set this seat's view back with
`setMapView({mode: "terrain", opacity: 0.85, handout: false})`.
