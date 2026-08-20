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

## Template packages

Fixtures: a disposable class Item with two template rows — one whose items
name a base the world holds by a SHORT name (create a disposable `weapon`
named `Staff`; the row prints "staff tipped with glass gemstone"), one naming
gear the world does not hold. A disposable character.

1. `acksExtras.classes.templates.materializeTemplates(cls)` (or the sheet's
   **Build packages** button on the Templates tab).
   *Observable:* one bundle Item per row; `system.templates[i].bundle`
   filled; a `<Class> Templates` RollTable, formula 3d6, ranges matching the
   bands; the materialized entries GONE from the row arrays.
1a. **Open the bundle's Contents tab.** *Observable:* the proficiencies are
   listed under Abilities and the eye icon opens each as its own editable
   item. An empty Abilities group is the compendium-mode failure below.
1b. **Compendium-mode worlds.** Where the importer was pointed at a pack
   rather than the world, proficiencies and bases resolve out of the pack
   INDEX and are COPIED into the world. *Observable:* the bundle's abilities
   are world items (editable), not pack links; nothing is left on the row
   except what genuinely resolved nowhere. A name nothing defines is a
   **placeholder** ability — named as printed, empty, and repairable; re-run
   materialize after importing the real definition and it is replaced, the
   bundle repointed, the placeholder deleted.
2. Open the first row's bundle → its staff item.
   *Observable:* `type === "weapon"` (the reported bug — assert the type, not
   that the code ran), name is the printed descriptor, `flags["acks-extras"]
   .skin.baseName === "Staff"`.
3. The second row's gear.
   *Observable:* a bare `item` whose `templatePart.unresolved` is true —
   visible, never dropped.
3a. **Run materialize a SECOND time with nothing else changed**, on a class
   whose package still holds a genuinely-undefined proficiency.
   *Observable:* the placeholder is still flagged `unresolved` and still
   named in `report.unresolved`. A placeholder silently becoming "resolved"
   here is it answering its own name search — the defect this step exists to
   catch, found in the 4.14.0 live gate.
4. Repair-once: hand-edit the bare item (set a type/damage), re-run
   `materializeTemplates` and `importTemplatePackages()` (importer side).
   *Observable:* the repaired document untouched, counted in
   `skippedEdited`; nothing duplicated (idempotence).
5. Generate a character from the repaired template (Scores Generator, and the
   picker's opt-in package).
   *Observable:* the character's staff is a `weapon` and equips from the
   sheet; the chat card lists the bundle's contents; coin arrives per the
   row's `gp`/`sp`.
6. The DELETE path: delete one linked gear item, apply the template again.
   *Observable:* the missing name on the chat card's unresolved list,
   everything else lands. Delete the whole bundle and apply: the row falls
   back to its remaining entries (or grants nothing) without throwing.
6a. **`cookbookUpdateClasses()` is GLOBAL** — it rewrites `system` on every
   imported class whose cookbook id it recognises, with no way to scope it to
   one document. A fixture cannot claim an id one of the world's real classes
   already holds, so this step cannot be walked safely in a shared test world:
   run it in a scratch world, or accept it as untested and say so.
7. Importer Update survival: run `cookbookUpdateClasses()` on an imported
   class.
   *Observable:* `system.templates[i].bundle` re-derived (relinked) after the
   system rewrite, and the row arrays re-stripped — applying the template
   grants the package ONCE.
8. Core's own path: drag a bundle from the sidebar onto the character sheet.
   *Observable:* contents arrive via core's bundle-drop.

## Teardown

Delete the character, the class item and the race item; for template
packages also the bundles, gear, specialized copies and the RollTable (all
carry `flags["acks-extras"].templatePart`), and the fixture `Staff` weapon.
Confirm no `acks-extras.class` or `acks-extras.race` items named for the
fixture remain and the template folders are empty.
