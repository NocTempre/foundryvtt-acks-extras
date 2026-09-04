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
- **The Scores Generator has no button on the released system's character
  sheet** — `generateScores` is a registered sheet action with no control
  rendered for it in the 14.0.1 build. Drive it the way the action would:
  `sheet.constructor.DEFAULT_OPTIONS.actions.generateScores.call(sheet, new
  PointerEvent("click"), null)`. Hunting for the button reads as the app being
  gone.
- **A score roll posts a chat card whose `rolls` array is EMPTY.** `AcksDice`
  renders the total into the message HTML, so the die that was actually thrown
  is read as `.dice-total` out of `message.content` — `message.rolls[0].total`
  is `undefined` and, read as a number, silently answers every comparison
  false. This is the only way to tell a raised score from a natural one.
- **Rolling in a loop outruns a 45 s scripted budget.** Each roll awaits a
  chat message; do a handful of attempts per call and carry the state on
  `window`, or the call times out mid-loop and leaves the page half-driven.

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
6. With the campaign on the standard generation rule, open the Scores
   Generator and roll the 5d6 formula until the chat card's `.dice-total`
   comes up under the floor that formula carries; reset and re-roll between
   attempts.
   *Observable:* the score box holds the floor, and the box beside it states
   the modifier rather than standing empty. Then submit: the actor stores the
   floor and the modifier its own data model computes, because the modifier
   box is disabled and carries no key into the submitted form.

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
5a. A class holding no template rows: a disposable `class` item with an empty
   `system.templates`, chosen in the picker with *Show all classes* on.
   *Observable:* the template box offers only "no starting package" and its
   hint is the generator's no-packages sentence, not the optional-package
   one; picking a class with rows brings the rows and the optional hint back.
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

### Base-vs-descriptor resolution (the whole point of a skin)

Build ONE disposable class whose single row prints the shapes that have gone
wrong, and assert the TYPE of each resulting document — a mis-typed weapon
looks fine until someone tries to swing it.

| Printed descriptor | Entry `ref` | Expect |
|---|---|---|
| `polished sword` | `def.weapon.sword` | `weapon`, base `Sword` |
| `Torches` ×6 | `def.equip.torch` | `item` (a carried stack), base `Torch` |
| `war hammer carved with clan emblem` | `def.weapon.warhammer` | `weapon`, base `Warhammer` — NOT the carpentry `Hammer (small)` |
| `Feathered darts` ×5 | *(none)* | `weapon`, base `Dart` — resolved by name, plural |
| `Weighted net` | *(none)* | bare `item`, `unresolved: true`, named in `report.unresolved` |

*Also observable on every one of them:* `flags["acks-extras"]` is present. A
skin that keeps the base's importer stamp answers ref lookups meant for the
base.

9. **The importer half, without a book connected.** `parseEquipment` is
   exported, so the split can be driven directly:
   `const m = await import("/modules/acks-extras/scripts/importer/cookbook.mjs")`,
   then build a menu row `{name, ref, fold, foldStripped}` per imported gear
   item (`flags["acks-extras"].cookbook.id`, types weapon/armor/item,
   template parts excluded, sorted by name length descending) and call
   `m.parseEquipment(cell, menu, {})`.
   *Observable:* `polished sword and dagger` → TWO items, `def.weapon.sword`
   and `def.weapon.dagger`; `wool tunic and pants` → ONE
   (`def.equip.tunicAndPants`); `Torches` → `def.equip.torch`.
10. **The field-repair path**, which is what an already-broken world runs.
   Create a bare `item` named for the descriptor, flagged
   `templatePart.unresolved`, with `asImported` set from its own `toObject()`
   (name/type/system — otherwise `editedSinceImport` reads it as hand-edited
   and skips it); point a bundle row at it and delete the document it
   displaced. Re-run `materializeTemplates`.
   *Observable:* `report.created` names `<descriptor> (resolved)`, the bundle
   row now points at a `weapon`, and the bare item is gone.

### Combat training reaches the CHARACTER, not just the class

The class document has always carried the training as an ActiveEffect. Asserting
that the effect exists proves nothing — `transfer: true` cannot fire, because a
character does not own the class document. Assert on the ACTOR.

1. Apply a class that RESTRICTS. A Mage is the sharp case: `armourProficiency`
   `unarmored`, `weaponProf` `club,dagger,dart,staff`.
   *Observable:* `actor.effects` holds exactly ONE effect flagged
   `flags["acks-extras"].fromClass`; its changes carry the three keys.
2. Equip Plate Armor on that Mage and read the loadout.
   *Observable:* `getLoadout(actor).armorProficient === false` and the
   violations include `armorNotProficient`. A Fighter in the same plate is
   `true`. If BOTH are true the effect never reached the actor — which is the
   defect this step exists to catch, and it stood in every version through
   4.14.4.
3. Apply a second class over the first, then a third.
   *Observable:* still exactly one `fromClass` effect — a re-apply replaces
   rather than stacks, and a change of class removes the previous class's
   training rather than leaving a character trained by both.

### Where the difference is VISIBLE (unfinished — read before shooting it)

4.15.1 owed a release snapshot for the training fix and did not get one, because
nothing found renders the difference on the character sheet. What was
established, so the next attempt starts here rather than repeating it:

- The violations are real and computed. A Mage in Plate Armor holding a Sword
  reports `weaponNotProficient`, `armorNotProficient`, `nonProficientUse` — none
  of which existed before 4.15.1.
- `proficiencyEnforcement` is `"on"` in the test world, so display is NOT gated
  behind a setting.
- The Worn & Wielded panel shows only the STYLE note
  (`ACKS-EQUIPMENT.wear.untrained`), and only when the active style is untrained.
  A Mage is trained two-handed, so a Mage with a sword shows nothing there — the
  panel is the wrong surface for this entry whatever the fixture.
- The armour and weapon notes are composed for the ATTACK ROLL
  (`equipment/roll-wrap.mjs`, "armour unusable by class"). That is the surface to
  shoot.
- `item.rollWeapon()` exists but posted no message when driven headlessly
  (`game.messages.size` stayed 0), which is consistent with it opening an attack
  dialog that nothing submitted. Driving that dialog is the unsolved step.

## Paths

Fixture: a disposable class with BOTH kinds of group — one authored, whose
options carry training, and one whose `source` is `"templates"` — plus two
template rows whose annotations name authored options. It must not be a stub
(give it a description and a level row) or `applyClass` refuses it and returns
`{applied: false}`, which reads as the feature failing when it is the fixture.

1. `acksExtras.classes.paths.pathGroups(cls.system)`.
   *Observable:* both groups; the `templates` one lists the ROWS
   ("Pit Fighter (Jutland)"), and `cls.system.templates` is unchanged — the
   group points at the rows rather than absorbing them.
2. `applyClass(actor, cls, { paths: { region: "ivory" } })`.
   *Observable:* the ledger flag carries `paths.region`, and the actor holds one
   `fromClass` effect whose changes are that option's training.
3. Re-apply choosing the OTHER option.
   *Observable:* the training SWAPS and the effect count stays 1 — a second
   choice replaces the first rather than stacking two regions on one character.
4. On a fresh character, apply the class with NO choice, then apply the template
   whose annotation names an option.
   *Observable:* before, no training at all (an unanswered group grants
   nothing); after, the group is answered and the training follows. Then apply a
   row printing no annotation: the earlier choice STANDS.
5. The class sheet's **Paths** tab.
   *Observable:* one block per group, options listed with their training, and
   the templates group marked as drawing its options from the rows.

### A lang/en.json hazard this release walked into

Adding the paths strings as a NESTED `"ACKS-CLASSES": { … }` object, in a file
where that root is written as flat dotted keys, made every
`ACKS-CLASSES.sheet.tab.*` label stop resolving — the class sheet rendered raw
key names — while `validate` passed, because every key it was asked about
existed. Flattening the new keys to match the root's existing shape fixed it.

**The mechanism is NOT established.** `ACKS-EQUIPMENT` and `ACKS-FORMATION` mix
both shapes today, including a nested `ACKS-EQUIPMENT.container` sitting over a
flat `ACKS-EQUIPMENT.container.expand`, and those resolve correctly — so the
obvious "nested shadows flat" rule is not it. A guard written on that theory was
drafted and REMOVED rather than shipped, because it fired on healthy data. Until
someone establishes what actually differs, the working rule is: **add keys in
whatever shape the root already uses**, and check one existing sibling key
resolves live afterwards.

## Teardown

Delete the character, the class item and the race item; for template
packages also the bundles, gear, specialized copies and the RollTable (all
carry `flags["acks-extras"].templatePart`), and the fixture `Staff` weapon.
Confirm no `acks-extras.class` or `acks-extras.race` items named for the
fixture remain and the template folders are empty.

## Class modifiers (the SYSTEM sheet's Effects tab section)

The module's own character sheet edits training on its Stats tab — that
recipe is [character-sheet/TESTING.md](../character-sheet/TESTING.md),
*Training on Stats*. This section is the injected grid on the system's sheet;
switch the fixture to the system sheet first.

1. Apply a class to a character and open the **Effects** tab.
   *Observable:* a **Class modifiers** section above the effect list, naming the
   class, with three groups of pills; the training effect's own row is GONE from
   the list below it (one control, not two). A character with no class applied
   has no section at all. The Unarmed chip shows and does not answer the mouse.
2. Click a style pill, then a weapon pill on a class granting `all`.
   *Observable:* the style leaves `flags.acks-extras.styleProficient` and the
   remainder is rewritten in canonical spelling (`twoHanded,weaponShield`); the
   weapon grant is rewritten CANONICALLY — `all` becomes the size and category
   clauses that still hold plus the remaining weapons by name, the one clicked
   absent (`equipment/training-view.mjs`).
2b. Apply a class whose training is size- or missile-based — an imported class
   carrying `missile:all,melee:tiny,melee:small,melee:medium`.
   *Observable:* every weapon pill but Unarmed is lit — a chip lights when ANY
   of its class is granted, and the great axe (large) is not. Click Axes: a lit
   chip WITHDRAWS its class, so the grant is rewritten without the three axes;
   `missile:all` and `melee:tiny` stay whole, while the small and medium
   clauses, each now missing an axe, become their remaining weapons by name.
   Nothing widens: the module sheet's Stats tab lights exactly the same
   weapons. Click Axes again: the three axes return, and the grant is the
   canonical form of that set — which is NOT the printed four clauses, because
   the great axe was never in them; re-applying the class restores those.
3. Click an armour rung below the ceiling, then click the ceiling itself.
   *Observable:* the first sets `armourProficiency` to that rung; the second
   removes the change entirely. It is a ladder, never a hole in the middle.
4. Compare against the Inventory tab's Training row.
   *Observable:* they legitimately DIFFER — the section shows only what the class
   grants, the strip the effective profile (single and missile always available,
   an unset armour grant reading grey rather than as the permissive fallback).
   This is the design, not a bug; see DECISIONS 2026-08-25.
5. Disable the effect, then re-apply the class.
   *Observable:* the head marks it disabled; the re-apply restores the class's
   full grant over every toggle made — that is how edits here are undone.

## The 1st-level hit-die floor

**Fixtures.** A character actor you create, and one imported class with a
levels table. Nothing else.

**Steps.**
1. With no book imported, check `acksExtras.classes.firstLevelDieMinimum()` in
   the console. Expect 1 — the world has read no floor and applies none.
2. Generate the character through the Scores Generator on a low-Constitution
   score and note the hit points. This is the pre-import behaviour and must be
   unchanged from before this release.
3. Import the hit-point table (the importer, Import Tables, with the rulebook
   connected). `firstLevelDieMinimum()` now returns the printed floor.
4. Delete the character and generate a fresh one on the same scores.

**Observable.** The 1st-level total is now taken from a die read at the floor,
with Constitution added AFTER it. A d4 class can no longer roll below the floor
at all. The floor must NOT reach 2nd level: bind a 2nd-level character through
the picker and confirm the total is a full reroll of two dice, unfloored.

**Teardown.** Delete both characters.

## A skipped template die, and a package that answers the picks

**Fixtures.** A character actor you create, and one imported class that prints
starting packages (Venturer serves — eight bands, all bundled).

**Drive mechanics.** Core's generator template declares NO `value` attribute on
any input: the die and the scores are written into the DOM by its own roll
actions at runtime. So the page renders empty every time, and a scripted check
sets `input[name="scores.*"]` directly and dispatches `change`. Throw the
template die through core's own `button[data-action="rollTemplate"]` and allow
~3 s — it awaits a chat message. The generator applies at CLOSE, not at submit:
`requestSubmit()` then `close()`, and read the actor after both settle.

**Steps.**
1. Set the six scores, choose a class, and leave the template die UNTHROWN.
   *Observable:* `select[name="acks-template"]` renders with zero options, and
   the hint beside it asks for the die.
2. Submit and close.
   *Observable:* the die is rolled for the character and named in a notice with
   the package it reached; the class is bound, and the actor carries that
   package's proficiencies, gear and coin. Before this was fixed the same
   sequence left the actor with the scores and nothing else — no class, no
   items — which is the regression this step exists to catch.
3. Open the class picker on a fresh character and choose a class with NO
   package.
   *Observable:* the level-1 proficiency rungs are asked.
4. Choose a package on the same window.
   *Observable:* those rungs come OFF the page, and the Intellect bonus picks
   (raise the actor's `int` to 16 to make them appear) no longer list any
   ability the package's own "brings" line names. Apply, and each of those
   abilities is on the sheet exactly once.
5. Read any hint on either surface with `getComputedStyle`.
   *Observable:* `--acks-fs-body`, not `--acks-fs-fine`. The vendored
   `.acks-ui .form-group > .hint` matches at (0,3,0) and silently outranks a
   two-class module rule, so this is worth asserting numerically rather than
   by eye.

6. **A class that prints no packages at all** — the state a field report read as
   a broken menu. Create a class Item whose `system.templates` is empty (a
   hand-made class does this by construction) and select it on the chargen page.
   *Observable:* the menu is disabled, and the note under it says the class has
   no packages — NOT "roll the template die". Throw the die and tick the Judge
   override in turn: the note does not change and the menu does not open, which
   is correct. Both branches read the same empty array, so the override lifts
   the die-band filter and nothing else; a note that still asked for the die
   here is the defect this step exists to catch.
   *Then select a class that does print packages, without reopening the window:*
   the note and the menu recover. The page auto-selects the first class in book
   order, so a reader can land on the empty one without having chosen it.

7. **The override goes down and the write follows the page.** As GM: tick Judge
   Override, tick *build without a package*, then UNTICK Judge Override. First
   confirm the non-defect — re-tick the override and read
   `input[name="acks-manual"].checked`: it is `true` and the label is visibly
   there, so a dead menu at that moment is the tick saying so, not a fault.
   Then leave the override DOWN, roll the six attributes, pick a class, leave
   the template die unthrown, and save.
   *Observable:* the auto-roll notice fires and the package's proficiencies,
   gear and coin are on the actor. The page was offering packages, so the close
   must apply one. Before this was fixed the close read the tick that the page
   had stopped honouring, suppressed the rescue, and wrote a class with no
   package and no gold — the page showing one thing and the write doing another.
   Verify on the actor's own fields, not on the notification.

**Teardown.** Delete the characters you created, and the empty class from step
6; the imported class is content and is left alone.

## Post-9th hit points on a built class

**Fixtures.** A class document in advanced (builder) mode, and the Dwarf race
document.

**Steps.**
1. With the class-builder tables imported, set a Fighting value that yields a
   fighter chassis and a maximum level above 9. Press Derive.
2. Read the level 10 and level 11 rows' Hit Dice cells.
3. Set the class to a racial build spending the dwarf's value and Derive again.
4. Clear `Extra hit points per level after 9th` on the Dwarf race sheet and
   Derive once more.

**Observable.** Past 9th the die count stops and a flat appears, growing by the
per-level rate on each row (cumulative, not per-level). The racial build's flat
is larger by the race's own rate; clearing that field shrinks it back. With the
builder tables NOT imported, the cells carry no flat at all and the derive
report names `missingHpAfterNine` — never an invented number.

**Teardown.** Delete the class document; restore the race field if you changed
a race the importer materialized (a re-import will also restore it).

## A pick the character owes

**Fixtures.** A spellcasting class whose printed package offers a choice (the
Mage's spellbook template), imported with its templates.

**Steps.**
1. Generate a character on that template.
2. Read the chargen chat card.
3. Open the character's sheet and find the marker.
4. Click it and choose an option.
5. Re-run chargen on the SAME character (Reopen Chargen) and generate again.
6. Delete the marker by hand on a fresh character, then re-apply the class.

**Observable.** The card lists the pick under its own heading — not among the
things granted, and not among the unresolved. The sheet shows one marker,
readable as a question. Choosing replaces it with the chosen document and the
marker is gone. Re-running chargen does not produce a second marker beside the
redeemed pick. A world with no spell documents at all shows the marker and says
so when clicked, rather than offering an empty list silently.

**Teardown.** Delete the characters.
