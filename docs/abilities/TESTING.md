# Abilities — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

## Fixtures

- A disposable `character` actor.
- A disposable `ability` item on it, with `system.rollTarget` set and
  `system.requiresRoll` true — that is the minimum an ability needs before it
  offers a roll at all.
- For the companion step: two disposable `monster` actors flagged as imported
  animals (`flags.acks-extras.extras.types = ["animal"]`) — one whose
  `extras.hd` reads under one Hit Die, one over — in a library Actor pack, and
  a disposable `ability` item carrying a `companion` effect with no `ref`.

## Core drive mechanics (non-obvious, learned live)

- **The sheet is an OVERRIDE, not a sub-type.** An `ability` item is a core
  system type; `AcksAbilitySheet` is registered over it through
  `DocumentSheetConfig.registerSheet`. Assert `item.sheet.constructor.name`,
  not the item's type, to prove the override took.
- **`rollsOf(item)` derives a `primary` roll from `system.rollTarget`** even
  when the extras flag holds no explicit `rolls` array. So a bare ability with
  a target is rollable, and `getExtras(item).rolls` being empty does not mean
  the ability offers nothing — read `rollsOf`, which is what the sheet reads.
- `rollAbility(item, key)` takes the roll KEY (`"primary"` for the derived
  one), not the item alone; `defaultKeyOf(item)` supplies it. A scripted call
  passes `{skipDialog: true}`, or it opens the roll dialog and awaits it.
- `getExtras()` returns the whole `AbilityExtras` model — categories,
  defenses, choice prompts, effects — not just the roll fields. A test that
  diffs the whole object is asserting the schema, not the behaviour.

## Steps

1. Open the ability item's sheet.
   *Observable:* `item.sheet.constructor.name === "AcksAbilitySheet"`, and the
   window shows the Description / Rolls / Mechanics tabs rather than the
   system's plain ability sheet.
2. Read the resolved roll set: `rollsOf(item)`.
   *Observable:* one entry keyed `primary`, whose target matches
   `system.rollTarget`.
3. Roll it: `rollAbility(item, defaultKeyOf(item), {skipDialog: true})` — without
   `skipDialog` the call opens the roll dialog (step 15) and waits on it.
   *Observable:* a chat card naming the ability, **carrying the system's dice
   box** (formula and total, expandable to the die face), and reporting success
   or failure against the target. Read the dice on the card itself — Foundry
   does not add a box beside custom content, so "the message will show it" is
   not an observable and asserting it is how this card shipped with no dice at
   all for four releases.
4. Rank and scaling: set a rank on the extras flag and re-read `rankOf(item)`
   and `scalesFor(item)`.
   *Observable:* the rank round-trips, and a scaling ability reports its whole
   progression rather than one row.
5. `throwModifiers(actor, item)` with a modifier-bearing Active Effect on the
   actor.
   *Observable:* the effect appears as a named part, not folded into a total.
6. A throw's **score modifier**, driven through the editor rather than the API:
   open the throw, set a flat target, choose a score in the picker, then set the
   multiplier that appears beside it.
   *Observable:* the multiplier is absent until a score is named and shows the
   stored factor when one is; the stored `score` round-trips as `{key, times}`;
   the target drops by `mod × times` on an above-throw and rises by it on a
   below-throw; the editor's preview, the tag strip (`item.getTags()`) and the
   chat card's details line all report the same term and the same number.
   Switch the picker to None and back — the multiplier must survive being off
   screen. Set *Succeeds On* to an exact match: the target must not move, and
   both the preview and the card must say the term is not applied rather than
   claim it.
7. **A measure — a throw with no target.** Add a throw, set its dice to `2d6`
   and *Succeeds On* to **no target**.
   *Observable:* the editor's second fieldset ("What It Is Rolled Against") is
   ABSENT, not empty; the preview reads "Rolls 2d6…"; the Rolls tab row, the tag
   strip (`item.getTags()`) and the Favorites control all print `2d6` where a
   scored throw prints its number — none of them prints `?` or `—`. Roll it: the
   card names the throw and shows its dice box with the total, with **no**
   success/failure row and **no** "no target" explanation. A measure has no
   verdict, so the dice box is the entire answer — if it is missing the card is
   a banner and a portrait and says nothing. Name a score on it: the Roll's own
   formula becomes `2d6 + <mod>` (fold it into the DICE, never onto the total —
   the card's own box prints the formula) and the card says the term was added
   to the result.
   Then take a LADDERED throw, switch it to no target and back: its rungs must
   survive the round trip. The target section is not rendered while the throw is
   a measure, so anything that reads the form for rungs or for a scale would
   read an empty screen as an emptied table.
8. **A scored throw with no target, both ways.** Roll a laddered throw on the
   shared world item, then on a character whose level is below the ladder's
   first rung.
   *Observable:* two DIFFERENT cards — "no target on a shared item" only for the
   first; the second says the character has reached no rung yet. One message for
   both sends the reader looking for a copy on a character they already have open.
9. **A borrowed ladder, read at a fraction of level.** Create a class document
   whose `system.ladders` holds a rebuking-shaped column — a `none` rung, then
   targets, then two `auto` rungs carrying their printed cell. Point a throw at
   it (`target.kind: "progression"`, `as`, `table`) at **full** level on one
   character and **half, round down** on another.
   *Observable:* the full-level reader steps the table one rung per level; the
   half-level reader stands on `floor(level / 2)` and does NOT advance on odd
   levels. Both show the SAME table under the throw, headed by the lending
   class's levels, and the borrower's row carries the line naming which of the
   lender's levels it is reading. Switch the fraction to two thirds and the
   rounding to up: the rung moves to `ceil(level × 2/3)`.
   **Drive it through the editor, not the API.** `as` and `table` are the two
   fields a closed schema silently discarded — the API path writes the flag
   directly and never proves they survive normalization, which is exactly how
   that bug lived through a release. Read the stored target back after a real
   `change` event on the pickers.
10. **The three verdicts a rung can give.** Walk one throw up through its ladder.
   *Observable:* at a `none` rung the row reads the printed cell, says the throw
   is not available, and clicking it posts NOTHING to chat (a notification only).
   At a target rung a d20 is rolled and scored. At an `auto` rung the row reads
   the cell, and clicking posts a card with **no dice attached** whose success
   row carries the cell. Then roll the ability's measure: that is the 2d6 the
   procedure ends with, and it must post normally after any of the three.
11. **Tab isolation, then a re-render.** Walk Description → Rolls → Mechanics,
   then re-render the open sheet (`sheet.render()` — what a field edit does) and
   walk back.
   *Observable:* exactly one `section.tab` has a computed `display` other than
   `none` at every step, and it is the one the nav marks active. On Description
   the prose editor and the requirements field have real height; a panel that
   survives a re-render at `display: none` while its nav button reads active is
   the failure this step exists to catch.
12. **Weapon proficiency picks.** On an ability whose category is Weapon
   Proficiency, type `all missile weapons, dagger` into the selections line;
   save and reopen.
   *Observable:* *All missile weapons* is ticked, the line holds only `dagger`,
   and the stored selections read `["missile:all", "dagger"]` — a box stores
   equipment's grant token, a single weapon stays as typed and is never widened
   to its group. The name reads `… (All missile weapons, dagger)`. Put the
   ability on a character and open the follower card: the weapon strip lights
   Bows & Crossbows, Other, Swords & Daggers and Unarmed, and NOT Axes, Flails
   or Spears. Tick *Medium melee* and save: the three dark pills light.

13. **A companion is chosen into its slot.** Drag the companion ability onto
   the character — a real drop, since the prompt fires on `createItem` for the
   seat that made the item.
   *Observable:* the picker opens at once, titled for the ability, the slight
   animal under the rule's group and the other under "Judge's discretion",
   plus a name field. Choose the slight one: a new actor of its name appears
   in the Actors sidebar under **Companions**, carrying
   `flags.acks-extras.companion = {ownerUuid, abilityId, index}` and NO
   `cookbook` flag, owned by the character's owners; the effect holds its
   uuid, and the ability sheet's Mechanics tab names it. Open the character's
   Equipment tab: a **Companions** section sits between Carried and Stowed,
   its row naming the creature and the ability; the paw control opens the
   creature's sheet. Press release: the row reads "No companion chosen yet"
   with a plus control, the pointer is empty, and the creature is still in
   the sidebar. Press plus and type a name instead of choosing: a blank
   monster of that name is made and bound. **Join as the Player seat**, owning
   the character and without the Create Actor permission, and choose again:
   the actor is made all the same (on the GM's client — a GM must be
   connected) and the player owns it.
14. **An imported modifier is read, and an Active Effect applies.** Fixture: a
   character and, on it, a copy of an imported class power whose Mechanics tab
   lists an Armor Class modifier row. *Observable:* that fieldset's legend
   reads *Imported mechanics* with the hint under it, and the character's
   `system.ac.value` does not include the row. Under *Effects* press
   **+ New Effect** and add a change `system.ac.mod`, type Add, value 1 — a
   real click through the system's effect sheet. *Observable:* the actor's
   `system.ac.value` (re-read from `fromUuid`) moves by one, and disabling the
   effect moves it back.

15. **The roll dialog, from every surface.** Fixture: the character from the
   fixtures, owned by the Player seat, carrying the ability; for the sub-steps
   add an ability that succeeds low (`system.rollType` "below"), one with
   `system.blindroll`, one standing on an automatic rung, one the lock code
   recognises as lockpicking (by name, `equipment/locks.mjs`), and a locked
   container (`flags.acks-extras.container = {locked: true}`). **Join as the
   Player seat.** Click the throw from the character sheet's Rolls tab, the
   ability sheet's Rolls tab, the system sheet's ability row and — with the
   row expanded — its throw tag, and the ability card's button in chat.
   *Observable:* each opens one dialog, titled with the ability (and the
   throw's label, when it has one), showing the formula, a *Situational
   modifier* field and a visibility select opened on the chat's own mode.
   Enter 2 and roll: the card's dice box reads the formula with
   `+ 2[Situational]` and the total, and the card's first detail line reads
   *Natural N + 2 (Situational) = N+2* with N the die's face. A negative entry
   reads `- 1[Situational]` and *Natural N − 1 (Situational)*; 0 adds no term
   and no audit line.
   Then, one observable each:
   - Hold the system's skip key (`game.settings.get("acks", "skip-dialog-key")`,
     Shift by default) and click: no dialog, the card posts with the bare dice
     and no audit line.
   - Close the dialog with its X: `game.messages.size` is unchanged.
   - A throw that succeeds low: the field's hint says a positive number makes
     it harder.
   - Tick the ability's blind checkbox (the system's `blindroll`) and click:
     the dialog states the visibility as a line with no select, and the card
     posts blind.
   - A throw standing on an automatic rung: the card posts with no dialog.
   - Pick a lock with the ability that opens it (the character sheet's
     Equipment tab, the container's pick control): no dialog opens, and the
     lock opens exactly when the card's total (`message.rolls[0].total`) meets
     the target; a failed pick's notice says the lock holds.

   Drive mechanics: the skip key is read off the click's event, so a scripted
   click holds it with
   `el.dispatchEvent(new MouseEvent("click", {bubbles: true, shiftKey: true}))`;
   `el.click()` never does. The system sheet is not the character's default:
   construct it from the `acks.` entry of `CONFIG.Actor.sheetClasses.character`
   with `{document: actor}`. Its ability row rolls from
   `[data-action="itemUse"]`, and `[data-action="toggleSummary"]` on the name
   expands the row and writes the throw tags (`[data-acks-throw]`). An
   automatic rung is a stored roll:
   `flags.acks-extras.extras.rolls = [{key: "primary", formula: "1d20", rollType: "above", scale: "level", target: {kind: "breakpoints", breakpoints: [{atLevel: 1, value: null, outcome: "auto", text: "Auto"}]}}]`.

## Typed modifiers apply

Walked by `tools/live/typed-modifiers.mjs`. The mechanics are `docs/lib/API.md`, "Typed modifiers".

**Fixtures** (every figure invented; each an `ability` item on the one
character `abilities/typed-character`, a level-3 `character` actor):

- `abilities/typed-standing` — `extras.effects`: a flat `ac` modifier and a
  flat `surprise` modifier, `effectsFrom: "recipe"`.
- `abilities/typed-gated` — a flat `initiative` modifier with
  `gate: {kind: "lightlyEquipped", armourMax: "light", loadMax: 6}`; give the
  character a heavy armour item, unequipped.
- `abilities/typed-ladder` — an `ac` modifier whose value is
  `{kind: "breakpoints", breakpoints: [{atLevel: 1, value: 1}, {atLevel: 4, value: 2}]}`.
- `abilities/typed-pair` — two abilities, each a flat `initiative` modifier
  (1 and 2), the first naming the second in `notStacksWith`.
- `abilities/typed-handAE` — a flat `ac` modifier, plus an Active Effect on
  the item writing `system.ac.mod` Add.
- `abilities/typed-situational` — a flat `save` modifier with `condition:
  "situational"`, and a second ability, `abilities/typed-scan`, a flat `save`
  modifier with `effectsFrom: "scan"`.

**Steps → observable:**

1. Open the character's Stats tab and hover Initiative, Avoid Surprise and the
   Saving throw modifier → each tooltip names every applied ability with its
   figure; the scan's save part reads "(unverified)"; the situational one is
   under "not applied" with its reason. The save row shows the figure in
   force beside its input.
2. Roll surprise from core's Surprise Matrix → the card's avoid-surprise
   figure carries the standing part.
3. Equip the heavy armour → the gated part leaves the Initiative tooltip and
   is listed "its gate is not met"; unequip → it returns.
4. Set the level to 4 → the ladder's AC part moves to the second rung (the
   loadout rebuilds on a level change).
5. The pair → only the larger initiative part is applied; the smaller is
   listed "a larger one of its kind applies".
6. The hand-made effect → AC rises by the Active Effect alone; the typed part
   is listed as standing aside. Disable that effect → the typed part applies.
7. Delete `abilities/typed-standing` → its parts leave the tooltips and AC
   (the DELETE path); rebuild the fixture by its marker afterwards.
8. Open each fixture's Mechanics tab → every modifier row carries its
   disposition chip; `abilities/typed-scan` also carries "unverified".
   On `abilities/typed-situational`, press **Start** → an Active Effect
   appears on the copy, disabled, named as situational, and the row reads
   "effect off"; enable it → the save tooltip names it and the row is listed
   as standing aside. On `abilities/typed-ladder`, Start, then change the
   level → the row reads "effect stale"; **Refresh** → the effect's value is
   the new rung and its enabled state is unchanged. A Player seat that does
   not own the character sees no Start.
9. Join as a Player seat that owns the character → the same figures and
   tooltips. Edit an unrelated field on core's sheet → the stored Avoid
   Surprise does not change.
11. Conditions read off the page: with the rulebook imported, give the
    character the library's Lockpicking skill and a power whose row carries a
    page condition (any row whose cookbook spec has `conditionFrom`), then run
    **Update Abilities** → on each Mechanics tab, the conditioned rows show
    either words from the Judge's own page or a short label with its page
    (*by method (RR p.N)*), never an empty condition; Lockpicking's hasty and
    methodical rows read "at the roll", not situational. The Stats tab's
    figures are the same before and after the update. A Player seat that owns
    the character sees the same rows.
12. A row's other prose read off the page: on the same character, with the
    library's Lockpicking, Trapbreaking, Searching, Shadowy Senses, Sneaking
    and Climbing skills and the Berserkergang proficiency (fixture
    `abilities/clause-character`, a level-3 `character`; its abilities are the
    library's, so they need no marker of their own), run **Update
    Abilities** → each limitation row's text is a clause from the Judge's page,
    or a cited label such as *a retry limit (RR p.N)*, followed by its
    condition; each outcome row opens with its trigger phrase (*natural …*,
    *on failure* or *result below …*), then a clause or *a mishap
    (RR p.N)*; Sneaking's two capability rows and Berserkergang's show a
    clause, with the condition after it. Lockpicking's, Trapbreaking's and
    Searching's scoped rows carry a chip naming the throw (*hastily only*,
    *methodically only*, as the Rolls tab labels them) whose tooltip says the
    row belongs to that throw alone. No row reads empty, and no row holds a
    sentence of the module's in place of the page's.
13. Stats tab provenance: with the equipment tables imported, wear an
    enclosing helmet → the Avoid Surprise tooltip names *an enclosing helmet*
    with the page the import read (*from the imported table (RR p.N)*). Set
    the helmet's surprise figure in the Ruledata Browser → the part reads *as
    the Judge set it*. Clear the override and remove the equipment import →
    the part is not written and the tooltip does not name it. The dual
    style's part carries its table the same way, but it writes the melee
    attack modifier, which no Stats row shows; check it on the loadout
    effect's `loadoutParts` flag (`table: "dualWeaponStyle"`).
14. A gate's armour rung read off the page (fixture `abilities/gate-character`,
    a level-3 `character`, found by that marker; the abilities are the
    library's and need none): with the rulebook and the Judges Journal
    imported, give it Swashbuckling, Blade-Dancing and the bladedancer's
    Graceful Fighting, then run **Update Abilities** (top of the Items
    sidebar). On each ability, read `flags.acks-extras.extras.effects` → every
    `lightlyEquipped` gate carries `loadMax` and `armourMax`, the latter a
    ladder key, and `cookbook/powers.json` and `proficiencies.json` hold no
    `armourMax` on those specs. Equip armour of a heavier category than the
    rung → the part leaves the AC tooltip, listed "its gate is not met"; unequip
    → it returns. Add a hand-made row `{type: "modifier", target: "ac", value:
    {kind: "flat", flat: 1}, gate: {kind: "lightlyEquipped", loadMax: 4}}`
    (no rung) → the tooltip lists it as not applied under every loadout, never
    applied by a default rung. A row stamped before the rung was read keeps
    its old literal until **Update Abilities** rewrites it; compare a copy
    made before this change.

This walk is also the Stats tab's first live pass.

**Teardown:** keep the fixtures; a step that needs a shape asserts it first.

## Editing an imported row

The Mechanics tab's Edit, Delete and Add a row controls (GM seat only) are
walked on the `equipment/armour-step` fixture, equipment TESTING "Armour
Training's step", steps 1 and 4-6, which cover an edit that keeps the row's
other fields, an add and a delete, and the Player seat's read-only rows. On
any other ability, also check that editing one row leaves every other row of
`flags.acks-extras.extras.effects` byte for byte as it was (compare
`JSON.stringify` of the array before and after, minus the edited index), and
that a row with a Start-ed quick effect still reports its state after a row
above it is deleted.

## A stat block's proficiencies: resolved, or unknown

Fixture, marker `abilities/statblock-proficiencies`: a `monster` actor built
from `bindMonster` (`/modules/acks-extras/scripts/importer/cookbook.mjs`) fed
`{fields: {stats: {proficiencies: [...]}}}` naming one proficiency the loaded
cookbook carries (read one off `cookbookAbilityIds()` and its entry, whose
`meta.category` is not `proficiency`) and one invented name no definition has.
Where the Judge's book is open, import a monster whose own stat block lists a
proficiency instead, and add the invented name by hand through the same bind.

1. Open the monster's sheet, Abilities tab. Both items are listed.
2. Open the resolved item's sheet, Mechanics tab, Classification. **Observable:**
   Category shows the definition's category, never Unknown, and
   `flags.acks-extras.cookbook.id` is the definition's id.
3. Open the invented one. **Observable:** `flags.acks-extras.extras.category`
   is `""`, there is no `cookbook` flag, and Category shows Unknown. Save the
   sheet without touching a field and read the flag again: still `""`, not the
   select's first entry.
4. Copy both onto a disposable `character` (track the copies) and open its
   Training strip. **Observable:** neither the invented item nor an item of
   blank category adds a pill, whatever the item is named; the resolved item
   adds one only when its category is a style, weapon or armour proficiency.
5. Re-run the bind through *Repair* on the monster (or *Apply Stats* on a
   Proof of Concept monster): the minted items are replaced and steps 2-3
   read the same.

Teardown: sweep the ledger (`api.sweepTracked()`), which holds the monster and
the character.

## Teardown

Delete the ability item and the character. Confirm no `ability` items named
for the fixture remain in `game.items` or on any actor.

The companion step's creatures are not imports — Remove ALL Imports leaves
them — so delete them by the uuids the effect held, then the two animal
fixtures and their pack.
