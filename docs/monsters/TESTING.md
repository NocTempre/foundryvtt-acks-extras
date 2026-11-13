# Monsters — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

## Fixtures

- A disposable `monster` actor.
- A disposable `acks-extras.animal` actor — the sub-type this feature also
  owns the sheet for.

## Core drive mechanics (non-obvious, learned live)

- **A plain `monster` opens the FOLLOWER CARD, not the full sheet.** Its
  registered sheet is `FollowerCardSheet` (from `lib`), the compact card;
  `FullMonsterSheet` is reached from the card's **Full sheet** control,
  `data-action="fcOpenFull"`. Asserting `actor.sheet.constructor.name ===
  "FullMonsterSheet"` fails on a correct install. An `acks-extras.animal`
  DOES open `FullMonsterSheet` directly — the two paths differ and both are
  intended.
- **To test what this sheet does with a plain MONSTER, construct it.** Because
  of the line above, `monster.sheet` is the card, so a part-filter assertion
  ("a monster gets no Animal tab") must build the sheet by hand:
  `new (Object.values(CONFIG.Actor.sheetClasses.monster).map(e => e.cls)
  .find(c => c.name === "FullMonsterSheet"))({document: monster})`, render it,
  assert, close it. Reading `monster.sheet` instead silently asserts nothing —
  the card has no tabs to find.
- **A change on one control re-renders the sheet and DETACHES the others.**
  Scripted checks that touch two fields in a row must re-query the second
  element after the first submit; setting `.checked` on the stale node reports
  success, dispatches its event into nothing, and reads back as "the write did
  not land" on a field that works.
- Both sheets are registered as OVERRIDES over core types through
  `DocumentSheetConfig.registerSheet`, so the sheet class is the thing to
  assert, not the actor type.
- `getExtras(actor)` returns the whole `MonsterExtras` model — types, subtype,
  size, body form, mass, HD, save-as, defenses, spellcasting, scores, speeds,
  vision, lightless range, senses, load, encounter data and variants. A test
  that diffs the whole object asserts the schema rather than any behaviour;
  assert the fields the change touched.
- Vision fields feed `lib`'s vision management: a monster's `lightlessRange`
  is what a placed token's sight is derived from, so a vision assertion
  belongs to a PLACED token, not to the actor.

## Steps

1. Open a plain `monster`.
   *Observable:* `FollowerCardSheet` — the one-line card with HD, XP, AC, HP,
   speed, morale, loyalty, attacks and damage.
2. Press **Full sheet** on the card.
   *Observable:* `FullMonsterSheet` opens beside the card (both instances
   live) on the lib's frame: the band in the window header (the body-form
   glyph, the HD rating, the name, the XP award reading), the two rails
   around the portrait, the tab strip opening on **Statblock**. The
   `.window-header` holds `.acks-extras-frame__band`; the body root is the
   one `scrollable` part. Resize the window below its content: the body
   scrolls and the tab strip stays reachable.
3. Open the `acks-extras.animal`.
   *Observable:* `FullMonsterSheet` directly, with no card in between.
4. Fill the extras on **Classification**: types (the pills), size, body form,
   HD, save-as, speeds, vision.
   *Observable:* each round-trips through `getExtras`, and the frame reads
   them: the band's glyph and rating, the rails' save targets, the Statblock
   rows and the art row's overline and tags change with them rather than
   staying at their defaults. Set Hit Dice to 3, HD Bonus to 1: the Roll
   formula field reads `3d8+1` and `system.hp.hd` holds it; the follower card
   reads 3 HD. Type `2d6` into the Roll formula field, then change an
   unrelated extras field: `2d6` survives. Press the **Roll HP** chip on the
   Rating rule: `system.hp.value` and `.max` are set from a roll of the
   formula, and the heart on the right rail fills to the fraction. (A blank
   rating still rolls: core's schema never leaves `system.hp.hd` empty, so
   there is no warning branch to reach.) Type an armour class, an attack
   throw and a morale under **Figures**: the shield and the fist on the
   rail and the Statblock's attack and morale rows read them.
4a. **Statblock.** Click a save row: the system's save roll posts to chat.
   Click the reaction, morale, initiative and surprise rows: each posts.
   Add a weapon item on Attacks and click its row on Statblock: the item's
   use dialog (or its roll, with the skip key) fires, and the row shows the
   damage and the counter. Add an ability item with a roll target and one
   without: the first rolls, the second posts its card (the eye). Press a
   row's pin, then the fold chevron: the folded card shows the pinned row as
   a chip that rolls, and `actor.flags.acks-extras.sheet.pins` holds its id;
   unfold and unpin. Link a RollTable by dropping it on the sheet and click
   the Treasure row: the table draws.
4b. **The rails.** Click the map cell: a menu lists every speed row and the
   pick changes the cell's reading. Click the eye: the senses menu lists the
   vision kinds and the other senses with their ranges. Place two tokens of
   the monster on the scene: the group cell reads ×2 and a click selects
   both. Set `system.retainer.managerid` to a character (the Service tab's
   **Serve as henchman of…**): the band gains the employer chip, the group
   cell becomes the handshake and opens the employer, Statblock gains
   the Loyalty row, and Service gains the record panel under the manager
   picker (walked in docs/henchmen/TESTING.md, step 1a).
4c. **The tools rail.** The pen turns the appearance into an editor on the
   art row; save a paragraph and `extras.description.appearance` holds it,
   and the Description tab shows no appearance editor. The tags tool prompts
   for alignment and XP award and writes both. On an imported creature the
   book tool opens the Source dialog with the printed block and its tables;
   a hand-built monster shows no book tool. Make Encounter is
   docs/lib/TESTING.md, "The encounter group". Join as a player with observer
   permission on the monster: the rolls, the menus and the fold work and
   every field is disabled.
5. Defenses: declare an immunity and a susceptibility, including the
   `mundane` / `extraordinary` / `silverFlaw` switches.
   *Observable:* they appear on the sheet as stated defenses, and damage
   applied through the system's own path respects them.
6. Variants: add a variant entry.
   *Observable:* it is listed and can be applied without editing the base
   monster.
7. Place a token of a monster with a lightless range, with `lib`'s vision
   management on.
   *Observable:* the token's sight range matches the declared lightless range.
8. Imported monsters: open a monster the importer created from the Judge's
   books (no sample monsters ship).
   *Observable:* it loads, its sheet renders, and its extras are populated
   rather than default.
9. Right-click the plain monster in the Actors directory and pick the Full
   Monster sheet entry three times — the real context menu, not a
   `new FullMonsterSheet(…)` in the console, which is the path under test.
   *Observable:* collect the app objects `renderFullMonsterSheet` hands its
   listeners into a `Set` across the three picks — it holds ONE, and that
   one's `element.isConnected` is true. Three is the frame-id collision: each
   new instance takes the last one's id and replaces its element, and the
   older keep rendering into nodes nobody sees. The DOM shows one window
   either way, and `actor.apps` is keyed by that shared id, so neither counts
   instances.
10. Description tab: create the monster with several paragraphs in
    `flags["acks-extras"].extras.description.combat` — the sheet reads
    `extras.description`, and a bare `flags["acks-extras"].description`
    renders nothing. `flags.core.sheetClass: "acks-extras.FullMonsterSheet"`
    at create opens the full sheet without the card. Open the Description tab
    and press the Combat editor's toggle (the appearance is the art row's,
    step 4c).
    *Observable:* the open editor's `.editor-content` starts at or below the
    `menu`'s bottom edge. For a section shorter than 40vh its `clientHeight`
    equals its `scrollHeight` — all of the text in view, not one line under
    the toolbar; a longer one has `clientHeight` at 40vh and a larger
    `scrollHeight`, scrolling inside the editor, and is never held to the
    first assertion. An empty section opens at least 6em tall. Click into a
    paragraph, type, and press Save: the flag holds the typed text, and the
    closed editor grows to fit it.
    - The toggle has no box until the pointer is over the editor: a pointer
      click at its centre without a hover first lands on the canvas, and the
      editor stays shut.
    - The HTML source view (`</>`) moves Save and its own toggle to the
      menu's right end: re-read their rects after toggling, because a
      coordinate read in the rich-text view clicks nothing there. Save from
      the source view stores the text too.
    - The flags route above is an API fixture: it proves the layout and
      never supplies the release shot. For the shot, make the monster in the
      Actors directory, open the full sheet from the card's **Full sheet**
      control, press the Appearance toggle and type the text through the
      editor — or open an imported monster that already holds its text.

### The Animal tab

Fixture: `Actor.create({name, type: "acks-extras.animal", system: {animal:
{training: "untrained", mountable: false}}})`, plus a plain `monster` for the
negative half.

1. Open the animal. The nav shows **Animal** between Classification and
   Attacks; the section carries `select[name="system.animal.training"]` (six
   localized options) and `input[name="system.animal.mountable"]`.
2. Change the select, then RE-QUERY and tick the checkbox (see above). Read
   back `actor.system.animal` — both writes land through the sheet's own
   submission, with no handler of ours in the path.
3. `setFlag("acks-extras", "cookbook", …)` and re-render: the legend gains
   the `.acksm-cat-tag` badge.
4. Build `FullMonsterSheet` on the plain monster (see above). It must show
   neither `[data-tab="animal"]` nor any `[name^="system.animal"]` — the
   body renders a panel only for a tab the strip holds.
5. Scan the section's text for `/ACKS-[A-Z-]+\.[a-zA-Z.]+/` — any match is a
   missing lang key.

## Teardown

Delete both actors and any tokens placed for the vision step. Confirm no
fixture actors remain.

## Encounter lines

Walked by `tools/live/monsters-encounter.mjs`, with `mm` and `ax2` on
`ACKS_TEST_BOOKS`.

**Fixtures.** Kept, and each brought to shape at its step's start.

- `monsters/encounter-typed`: a hand-built monster, its wilderness line blank.
- `monsters/encounter-units`, `monsters/encounter-times`,
  `monsters/encounter-literal`, `monsters/encounter-percent`: a bare monster
  carrying a cookbook id in its `cookbook` flag, for an entry of that shape. A
  repair fills it from the open book.
- `monsters/pin-template`: an invented generator template (a Variant axis of
  two kinds, a Role axis defaulting to Standard, one cell naming a role for the
  first kind only). Its axes and cells are written at the step's start.

**Steps.**

1. Parse invented lines in the page and roll each formula on Foundry's `Roll`:
   a die, a literal, a multiplied die, a sum, a sum under a multiplier.
   *Observable:* every total sits in its dice's range, and `new Roll("")` throws.
2. On the Ecology tab of the typed monster, measure the line fields at the
   window's width and at the narrowest it can reach, then again at `fontScale`'s
   maximum on a window opened after the knob moves.
   *Observable:* the window narrows, the type grows, the longest count the parser
   writes fits every number field, a run of it does not, and the grid has no
   overflow.
3. Type a count into a side.
   *Observable:* the four sides each show a unit field, and the count lands in
   `extras.encounter` and in `system.details.appearing`.
4. Type a unit beside it.
   *Observable:* the unit lands and core's field goes blank. The Statblock reads
   the count with its unit and the row offers no roll, its line carrying the
   tooltip that says why; a press posts nothing. The follower card has no die
   for it, and `sizeFromEcology` gives null.
5. Clear the unit.
   *Observable:* core's field holds the count again and the row rolls it.
6. Join as the Player seat, granted Observer on the typed monster, and open its
   Ecology tab.
   *Observable:* every line field shows and none can be edited. Grant Observer
   on `monsters/pin-template` and open it: the axis selects carry no `name` and
   *Generate* is absent. Pin the second kind: the Role select marks the
   disabled role, a `preUpdateActor` hook on the seat sees no write, and the
   actor's `system` is unchanged.
7. Write the old parser's shape on each kept entry actor (a stale noun and die on
   both sides, a die in core's field) and call `refillMonster(actor, {whole:
   true})`.
   *Observable:* the stale noun is gone from every side. The units entry keeps a
   unit and a count that rolls, core's field blank, and the group sizes nothing.
   The multiplied entry keeps its multiplier and states no lair count. The
   literal entry holds a bare figure. The percent entry's `lairChance` reads as a
   number.

- **A row that cannot roll has no `data-roll`.** Its pin button always does, so
  find a row from its pin.
- **The sheet theme's floor stops the window at its opening width.** The
  narrowest reachable frame is the one with `acks-lib-sheet-theme` off, so the
  probe drops that body class, sets a width of zero for `min-width` to clamp, and
  puts both back in the same task.
- **The walk opens its books on its own seat** (`remember: false`), so a shelf
  book is not needed in the world.

**Teardown.** The cards the run posts, by id: `api.sweepTracked({only})`; quote
it. The fixtures stay.

## A spellcasting monster

Needs the MM PDF connected, and the spells and classes imported: the class
document supplies the slot grid a level is read off.

**Fixtures.** `api.track` the actor each import below creates, read off the
import's own result, and the generated creature.

**Steps.**
1. Import an entry whose prose says it casts spells as a class of a level and
   prints no repertoire (the entry picker, Monsters). *Observable:*
   `system.spells.enabled` is true and the `spells.N.max` values are that
   class document's grid row at that level; the actor carries as many `spell`
   items of each level as the slots say, each a copy of an imported document
   (`flags.acks-extras.spell` present, the cookbook id kept, `minted` set);
   a second import of the same entry draws differently.
2. Import an entry whose prose lists spell-like abilities with a frequency per
   group, and one that names a spell "(as the spell X)". *Observable:* one
   `spell` item per named spell, its `flags.acks-extras.usage` the printed
   frequency's key (the ACKS Monster fieldset's Usage select shows it); the
   Spells tab is on with every slot at zero unless the prose also casts as
   a class.
3. Import an entry whose prose prints a repertoire by level ("1st - …; 2nd -
   …"). *Observable:* the named spells as items; the slot maxes equal the
   printed counts per level where no class grid applies.
4. Repair the actor from step 1 in place (Reimport One Shelf → Monsters →
   *Repair in place*, or the picker's repair). *Observable:* the minted spell
   items are replaced by a fresh draw; the id stays.
5. Generate a creature from a template family whose row prints a spell column
   (the generator sheet, *Generate*). *Observable:* the actor has the row's
   slot block, `flags.acks-extras.extras.spellcasting.class` holds the
   prose's word and `.level` the row's caster level, and it carries a drawn
   repertoire; a row printing no spells generates none.

### Drive mechanics (non-obvious, learned live)

- **A repair on a copy.** `refillMonster(actor, {whole: true})` is not on
  the api; `await import("/modules/acks-extras/scripts/importer/cookbook.mjs")`
  in page context reaches the same module instance. It reads the entry from
  the connected book and rewrites the actor it is handed, so a disposable
  copy of a shelf monster (`toObject()`, the cookbook flag kept, no `_id`)
  is the fixture and the shelf document is never touched.
- **`Actor.create` from a `toObject()` needs `items`.** The system's
  create override replaces `system` unless the data carries an `items`
  array; a source with no embedded items loses its stats on the copy. Pass
  `items: []`.
- **The binder reads the entry's description paragraphs, not the actor.** A
  stored monster keeps its prose in `flags.acks-extras.extras.description`
  channels; `bindMonsterSpells` and `castsAsClass` run on the executed
  entry's paragraphs at import. A creature whose casting paragraph sits on a
  page the register's span does not reach imports with none — the
  importer ROADMAP, "A monster whose entry runs past its first page", lists
  them; check the register's `pages` before reading a missing repertoire
  as a reader fault.
- **The generated actor is read off `createActor`.** *Generate* posts
  nothing that names it; hook `createActor` for `userId === game.user.id`
  around the click, and track that uuid.
- **A whole-shelf class repair narrows by a Set.** `cookbookUpdateClasses({
  only: new Set(ids), confirm: false })` — an array throws.

**Teardown.** `api.sweepTracked()`; quote it.

## A family's roles

Needs the MM PDF connected and the rulebook's tables imported (Manage Imports,
Tables) before the family is, with spells and classes imported for the caster
step. What a role cell writes is MODEL, "Family templates: the Role axis".

The generator's arithmetic on invented figures is `tools/test-leader-roles.mjs`,
`tools/test-leader-derive.mjs` and `tools/test-generated-repertoire.mjs` (steps
1-8 and 11-14). No walk drives this recipe against the real books: a pass over
it is by hand, with `rr`, `mm` and `axc` mapped on `ACKS_TEST_BOOKS`. Steps 9
and 15's observer pin is walked on an invented template by
`tools/live/monsters-encounter.mjs` (the Encounter lines recipe, step 6).

**Fixtures.**

- `monsters/family-roles`: the beastman family template, as an import makes
  it. The import is the subject, so a walk that changed the importer retires
  it first (`api.retire("monsters/family-roles", "Actor")`), imports the
  family (the entry picker, Monsters, the family row), and marks what the
  import returned (`api.mark(uuid, "monsters/family-roles")`). A walk that
  changed only the generator reuses it. Where the import lands in the library
  compendium, `api.mark` refuses it: the walk finds the template by its
  cookbook id instead, and writes to it only through Repair in place.
- Each generated creature: `api.track` its uuid, read off `createActor` as in
  the section above.

**Steps.**

1. Open the template's sheet and read the Role axis. *Observable:* its
   options are Standard and the roles the family's prose prints, in the
   order MODEL gives; its roll line reads the default, Standard, not a die.
2. Pin a kind, then open the Role select. *Observable:* a role the prose
   prints for no other kind but this one is enabled; one printed only for
   another kind is disabled and its label says it is not printed for this
   choice. A native select's open list sends no pointer events to its
   options in most browsers, so the label is the copy to read; the
   option's `data-tooltip` is checked by reading the attribute. In the MM's
   beastman family every kind prints every role, so no option is disabled
   there: this step needs a family where one kind lacks a role.
3. With the kind pinned and Role left blank, generate five times.
   *Observable:* each actor is the Standard member, and the generation log
   shows `role` sourced `default`, never `rolled`.
4. Pin a leader role that prints its own HD and generate. *Observable:*
   `system.hp.hd` and `flags.acks-extras.extras.hd` hold the leader's HD, the
   AC and hit points are the leader's, `attack.throw` is the member's moved by
   what the world's ladder (`game.modules.get("acks-extras").api` registry,
   `monsters` / `attackThrowByHd`) adds between the two rows, and the Saves
   rail reads the save level MODEL derives.
4a. Hover an attack row's throw and a save row's figure on that actor.
   *Observable:* the throw's tooltip names the member's throw and HD, the
   rows moved, the leader's HD and the ladder's citation; the save's names
   the member's save level and HD and the leader's. Type another throw on
   Classification and hover again: the throw's tooltip is gone.
4b. The ladder not imported (a world without the rulebook's tables, or
   unregister the `monsters` world layer in the page and repair the
   template). Generate the same leader. *Observable:* `attack.throw` is the
   member's, and the throw's tooltip says the ladder is not imported. Restore
   the layer (re-import the rulebook tables) before the next step.
4c. In the Ruledata Browser, override one row of `attackThrowByHd`, repair
   the template, and generate. *Observable:* the leader's throw follows the
   overridden row, and its tooltip names the Judge's own ladder in place of a
   page. Revert the override.
5. On the same actor, read the Statblock's attack rows. *Observable:* a role
   printing a damage bonus shows it after each attack's formula, and the tag's
   tooltip names the formula and the modifier apart. Roll one weapon attack's
   damage from the sheet; the card's formula carries the same modifier once.
   A role printing none shows the bare formula.
6. Read the leader's XP. *Observable:* where the family prints an XP figure
   per role, `system.details.xp` is that role's; where it prints none, the
   member's.
7. Pin a caster role and generate twice. *Observable:* `extras.spellcasting`
   holds the class word and an integer level, the log carries a
   `casterLevel` line with its roll, the slot maxes are that class's row at
   that level, and the two levels can differ.
8. Pin a non-fighting dependant and generate. *Observable:* no attacks, the
   damage total zero, `extras.noncombatant` true.
9. Join as the Player seat, granted Observer on the template, and open it.
   *Observable:* the Role select and its disabled options render, *Generate*
   is absent, and pinning the kind re-marks the Role options with nothing
   written: pins live on the open sheet, never on the actor, and the select
   carries no `name` for the form to submit.
10. Repair the template in place (Manage Imports, Repair in place on the
    family row). *Observable:* the same id, the Role axis and its cells as an
    import writes them, and any other book's merged variants still present.
10a. In a world without the rulebook's or the compendium's tables, with a
    boot recorder attached before load (the capture driver misses load-time
    errors), reload. *Observable:* no console error at `init`, `setup` or
    `ready`, and the import's missing-tables list names `monsters` with
    `attackThrowByHd`, `leaderLadder` and `leaderSteps`.
11. **Derived leaders.** Connect the AXIOMS Compendium PDF (Books tab; its PDF has
    no title, so the page count alone fingerprints it), import its tables (`monsters` /
    `leaderLadder` and `leaderSteps` appear in the Ruledata Browser with an
    AXIOMS citation), then re-import the family. *Observable:* the sheet
    shows a **Leader figures** axis before Role, its roll line reading the
    default, As printed.
12. Pin a kind whose page prints leaders, pin **AXIOMS procedure** and a
    chieftain, and generate. *Observable:* `system.hp.hd` and
    `extras.hd` hold the derived rating, AC and `system.damage.mod` the
    member's plus the role's additions, the hit points are a roll of those
    dice (the log's `hitPoints` line, `source: "rolled"`), and the hit-point
    note's tooltip names the member's rating, armour and damage, the
    additions, the rungs climbed, whether the bonus carried whole or was
    multiplied by the imported factor (named in the tooltip; check it against
    the page's step 1), and the AXIOMS citation. Pin **As printed** instead:
    the printed leader's figures, and the note's tooltip names the MM page.
12b. In the Ruledata Browser, `leaderSteps` lists `bonusFactorChieftain`
    beside the other steps. Override it with an invented factor and re-import
    the family, then generate a chieftain from a kind whose member carries a
    hit-point bonus. *Observable:* the chieftain's bonus is the member's
    times the override, and the tooltip names the override's factor.
    Revert the override.
12a. On the step 12 actors, hover the rail's armour class cell.
    *Observable:* the AXIOMS one names the member's armour class, the rank's
    addition and the AXIOMS citation; the As printed one names the MM page.
    Type another armour class on Classification and hover again: the cell
    reads its plain label.
13. Pin a kind whose page prints no leaders. *Observable:* the Leader
    figures axis is gone from the sheet; champion, sub-chieftain and
    chieftain are enabled on Role (derived only), and shaman, drudge and
    whelp are disabled unless the page prints them. Generate a chieftain:
    its hit-point note and armour class tooltips name the AXIOMS procedure,
    never the printed page. Clear the kind pin (Roll): the Leader figures
    axis is back, reading As printed.
14. In the Ruledata Browser, override `leaderSteps` with one figure blanked
    and re-import the family. *Observable:* no derived cell and no AXIOMS
    option; the printed leaders stand. Revert the override.
15. Join as the Player seat, granted Observer on the template. *Observable:*
    the Leader figures select renders and pins without writing, as in step 9.

**Drive mechanics.**

- **A pin is the select's `change`, and it re-renders the sheet.** The
  availability marks are recomputed against the other axes' pins on that
  render, so read the Role select again after pinning the kind.
- **A family imported before this release has no Role axis to repair from.**
  A repair or a re-import writes it; reading the old template's cells as a
  regression is reading pre-upgrade data.

**Teardown.** `api.sweepTracked()` for the generated creatures; quote it. The
template stays.

## Leaders outside a family

A creature that is no family's member gets a template of its own for its
leaders (MODEL, "Leaders outside a family"). Needs the MM connected and the
rulebook's tables imported; the AXIOMS steps also need the compendium
connected and its tables imported.

The template's shape on invented figures is `tools/test-leader-template.mjs` and
`tools/test-kit-presets.mjs`. No walk drives this recipe against the real
books: a pass over it is by hand. Step 8's observer pin is walked on an
invented template by `tools/live/monsters-encounter.mjs`.

**Fixtures.**

- `monsters/standalone-leaders`: the leader template of an MM creature
  outside the beastman family whose prose prints a leader sentence (the
  shelf's beastman extract, §3.9, lists them). The import is the subject, so a
  walk that changed the importer retires it and the creature
  (`api.retire("monsters/standalone-leaders", "Actor")`,
  `api.retire("monsters/standalone-creature", "Actor")`), imports the
  creature from the entry picker, then finds the template by its cookbook id,
  the creature's with `.leaders` after it, and marks both
  (`api.mark(uuid, …)`).
- `monsters/standalone-derived`: the same for a beastman-type creature whose
  page prints no leader (§3.9 names two), imported with the AXIOMS tables in.
- Each generated creature: `api.track` its uuid.

**Steps.**

1. After the import, read the Monsters folder. *Observable:* the creature and,
   beside it, a template named for it with "(leaders)"; the creature's own
   `flags.acks-extras.cookbook.id` is the entry's, the template's is that id
   with `.leaders`, and its `leadersOf` is the entry's id. Import a creature
   whose page names no leader: no template appears.
2. Open the template. *Observable:* no Variant select (the creature is the
   only one), a Role select whose blank choice reads Standard, and the roles
   the prose prints.
3. Generate with nothing pinned. *Observable:* the creature itself, named as
   the direct import, the log's `role` sourced `default`.
4. Pin the printed leader and generate. *Observable:* the leader's printed
   armour class and hit points, its rating on `hp.hd` and `extras.hd`, the
   throw and saves moved as in "A family's roles" step 4, and the rail's
   armour class tooltip naming the MM page.
5. On `monsters/standalone-derived`: *Observable:* champion, sub-chieftain and
   chieftain on Role, no Leader figures axis; a generated chieftain's
   tooltips name the AXIOMS procedure and its hit points are rolled.
6. Repair the creature in place (Manage Imports, Repair in place). *Observable:*
   the template keeps its id and its cells match a fresh import's. Delete
   the template and repair again: it comes back.
7. Import the beastman family, then read the standalone template.
   *Observable:* the family is a template of its own; the standalone one
   gained no variant and kept its name.
8. Join as the Player seat, granted Observer on the template. *Observable:*
   the Role select renders and pins without writing, and *Generate* is
   absent.

**Teardown.** `api.sweepTracked()` for the generated creatures; quote it. The
templates and creatures stay.

## A beastman's kit

The Kit axis and the armour class worked out at generation (MODEL, "The Kit
axis"). Needs the MM and the rulebook connected with the rulebook's tables
imported (`monsters` / `beastmanTroops`), and for the unarmoured and
die-conversion steps the AXIOMS Compendium connected with its tables imported
(`beastmenByType`, `damageDieConversion`).

The kit cells and the armour class worked out at generation, on invented
figures, are `tools/test-kit-presets.mjs`. No walk drives this recipe against
the real books: a pass over it is by hand.

**Fixtures.**

- `monsters/family-roles` (above), repaired in place after the tables are
  imported, since a template built before them has no Kit axis. A walk that
  changed the kit builder repairs it first; the repair is not the subject, so
  the fixture is kept.
- `monsters/standalone-derived` (above), repaired the same way, for a kind
  outside the family that the troop rows print.
- Each generated creature: `api.track` its uuid.

**Steps.**

1. Open the Ruledata Browser on `monsters`. *Observable:* `beastmanTroops`
   with one row per infantry and missile troop type, each holding an armour
   class, move, Hit Dice, damage cell, morale and the kit's words, citing the
   rulebook's page; no mounted rows. `beastmenByType` holds a natural armour
   class per kind, and `damageDieConversion` a header row and one row per
   die, both citing the AXIOMS page. Check three troop rows against the
   printed page.
2. Open the family template. *Observable:* a **Kit** axis after Role, its roll
   line reading the default, Stat block.
3. Pin a kind and Standard, open the Kit select. *Observable:* the troop
   types the page prints for that kind and Unarmoured are enabled; a troop
   type printed only for another kind is disabled. Pin a dependant role: the
   Kit select offers Stat block alone.
4. Pin a troop type and generate. *Observable:* armour class, the damage
   modifier (`system.damage.mod`, melee and missile), `system.movement.base`
   and morale are the row's; the creature carries no item the stat block
   did not; its notes (Full Monster Sheet, Description) and its biography end
   with the kit's words and the rulebook's citation. Hover the rail's armour
   class, the morale row and a weapon's damage tag: each names the troop row
   and its page.
5. Pin a printed leader with the same troop type and generate. *Observable:*
   the armour class is the row's plus the leader's printed armour class over
   the member's (read both off the template's cells), and the rail's tooltip
   names the four figures and the row's page; the damage modifier is the
   leader's own; move and morale are the row's. Repeat with Leader figures on
   AXIOMS procedure: the leader's derived armour class is the one moved.
6. Pin Unarmoured on Standard and generate. *Observable:* the armour class is
   the kind's natural figure from `beastmenByType`, the tooltip names the
   AXIOMS page; the damage modifier and move are the stat block's.
7. On a generated creature with a nonzero damage modifier, give it a weapon
   whose die the conversion table prints (drag one from the items
   compendium) and hover its damage tag. *Observable:* the tooltip ends with
   the die the table prints for that die and modifier and the AXIOMS page.
8. In the Ruledata Browser, override `beastmenByType` with the kind's figure
   blanked and generate the step 6 creature again. *Observable:* the stat
   block's armour class, and a tooltip that names no kit part. Revert the
   override.
9. Type another armour class on a step 4 creature and hover again.
   *Observable:* the rail's cell reads its plain label.
10. Join as the Player seat, granted Observer on a step 4 creature.
    *Observable:* the armour class, morale and damage tooltips render as on
    the GM seat, and the notes show the kit line.

**Teardown.** `api.sweepTracked()` for the generated creatures; quote it. The
templates stay.

## The size frontage and its square

The Monster Size table's squares row and its unit (MODEL, "The size
frontage"). Needs the Monstrous Manual connected on a GM seat and the Rules
tables import run (Settings tab → Game Settings → ACKS II — Extras → Manage
imports → Rules tables). The battlemap's walk of the same figures is
`docs/battlemap/TESTING.md` steps 6 to 7a.

**Fixtures.** None of its own; the import is the subject.

**Steps.**

1. Open the Ruledata Browser (Settings tab → Game Settings → ACKS II — Extras →
   Imported Rules Tables → Open Ruledata Browser) on `monsters`.
   *Observable:* `sizeFrontage` and `sizeSquare` are listed, each with one
   `squares` row; the first holds a cell per size category and the second a
   `feet` figure, both citing the Monster Size table's page. In the console,
   `acksExtras.lib.tables.getDoc("monsters").tables.sizeSquare.squares.feet`
   is a positive number and the frontage cells parse through `sizes.mjs`.
2. Override `sizeSquare`'s `feet` with a figure of your own and read it back.
   *Observable:* the override wins and its cite is empty; clearing it returns
   the imported figure.
3. Take the world layer of `monsters` off the registry, as in battlemap
   TESTING 6a, and read both.
   *Observable:* `sizeSquareFeet()` and `sizeSquares("large")` are null, and a
   monster imported now carries Foundry's default prototype token. Re-import
   to restore.
