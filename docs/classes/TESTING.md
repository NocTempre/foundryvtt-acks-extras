# Classes — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

## Fixtures

- A disposable `acks-extras.class` Item, and a disposable `acks-extras.race`
  Item.
- A disposable `character` actor to apply them to.

## Core drive mechanics (non-obvious, learned live)

- **A class with no `system.levels` rows is a STUB, and `applyClass` refuses
  it silently** — it returns `{applied: false}` with no throw and no
  notification worth noticing. `system.isStub` is the gate. Give the class at
  least the level rows you mean to apply before anything else; a scripted test
  that skips this reads as "apply is broken".
- **`applyClass(actor, classItem, {confirm: false})`** is the scripted route.
  The default opens a confirmation dialog listing every field it would change,
  and awaits it — a script that omits `confirm: false` hangs.
- **The class item's save bands use `blast` and `spells`; the character uses
  `breath` and `spell`.** `BOOK_TO_RELEASED_SAVES` maps between them. Writing
  a band with the CHARACTER's key names silently stores nulls, and the applied
  saves come out unchanged — which reads as apply not working.
- Save and attack bands are `{minLevel, maxLevel, …}` on input and read back
  as `{min, max, …}`. Both are selected by `lib/tables.mjs`'s `bracketRow`,
  which returns **null** outside every band rather than clamping to the last
  one — assert the null, it is the behaviour that keeps a 9th-level character
  off a 4-level table.
- `registry.classForActor(actor)` answers only after a successful apply; it
  reads the applied ledger flag, not `system.details.class`.

## Steps

1. Open the class sheet and the race sheet.
   *Observable:* `ClassSheet` / `RaceSheet`; the class sheet says it has no
   progression rows yet rather than offering an empty Apply.
2. Give the class four level rows, two save bands and two attack bands.
   *Observable:* `system.isStub` flips to false.
3. `registry.saveBandAt(cls, 1)` and `(cls, 3)`; the same for
   `attackBandAt`.
   *Observable:* level 1 selects the 1–2 band, level 3 the 3–4 band, and a
   level past the last band returns null.
4. `applyClass(actor, cls, {level: 3, confirm: false})`.
   *Observable:* the returned `update` names every field it wrote, and on the
   actor: `system.saves.breath.value` carries the band's `blast` number,
   `system.saves.spell.value` its `spells` number, `system.thac0.throw` the
   attack band's throw, and `system.details.{level,title,xp.next}` the level
   row. `registry.classForActor(actor)` now names the class.
5. Level-up and chargen: `openLevelUp(actor)` and `reopenChargen(actor)`.
   *Observable:* each opens its wizard and, on completion, changes only the
   fields its summary listed.

## Teardown

Delete the character, the class item and the race item. Confirm no
`acks-extras.class` or `acks-extras.race` items named for the fixture remain.
