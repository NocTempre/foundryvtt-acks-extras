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
   `mundane` / `extraordinary` / `silverFlaw` switches, and type the
   susceptibility's damage multiple and save modifier (blank, the fields show
   the creature's page reference as their tooltip).
   *Observable:* they appear on the sheet as stated defenses. The system's own
   damage path does not read them. Lib's amount path does: cast a damaging
   spell at the token, and press a weapon attack card's Apply under it as a
   Judge. Each card's line names the defense and the steps, and a
   susceptibility with a blank figure is the Judge's call naming its page,
   never a guessed amount.
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
   unavailable role, a `preUpdateActor` hook on the seat sees no write, and the
   actor's `system` is unchanged.
7. Write a stale shape on each kept entry actor (a stale noun and die on
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
   frequency's key (a spell's sheet carries no ACKS Monster group; read the
   flag); the
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
- **`Actor.create` from a `toObject()` keeps its stats.** The system's
  create override (acks 14.2.0) adds `system.isNew` beneath the copy's own
  `system`; `items`, present or not, changes nothing about that.
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
   prints for no other kind but this one is listed plainly; one printed only
   for another kind is still enabled, and its label says it is not printed for
   this choice (pick it: Generate keeps it and writes the option's own name
   alone, and the log marks it `unavailable`). A native select's open list sends no pointer events to its
   options in most browsers, so the label is the copy to read; the
   option's `data-tooltip` is checked by reading the attribute. In the MM's
   beastman family every kind prints every role, so no option is marked
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
    The template's `img` (the pack index row's too) is the family's own
    picture, at the size the overview page prints it, whatever the library's
    copy held before, and the type's default for a family whose overview
    reads none; each variant option's `art` and a sidebar copy's
    `img` and `system` are unchanged. The template's sheet draws no picture,
    so the read is of the document and of the compendium list's thumbnail.
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
- **A template with no Role axis is repaired, or re-imported, to gain one.**
  Its cells are not a regression of the sheet.

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

## The organisation axes

The troop, trait and gear axes, the leader table's grade and a trait's natural
attacks (MODEL, "The organisation axes"). Needs the MM connected with its
tables imported (`monsters` / `beastmanSpecialTroops`, `beastmanTraits`,
`beastmanLeaders`, `beastmanTroopRules`, `beastmanTraitRules`,
`beastmanEquipment`), then the family repaired in place so the template gains
the axes. Marker `monsters/beastman-organisation`. The tables are read by the
recipes the module ships when they are imported, so a world imported before a
recipe change holds rows without the figures it added: re-import the MM's
tables (`acksExtras.importer.cookbookImportTables(["monsters"])` with the books
connected, or the Rules tables shelf) before a walk of a changed row. Step 11
asserts at its start that the gated row's ability item carries a `gate`.

The axes, the unions, the cells and every standing figure on invented tables
are `tools/test-organisation-axes.mjs`. `tools/importer/check-organisation-axes.mjs`
reads this machine's own MM, mints the axes and resolves a generation for every
breed and troop row and every breed and trait row; it prints availability and
what each wrote by ordinal, to be read against the two printed tables by hand.

**Fixtures.**

- `monsters/family-roles` (above), repaired in place after the MM's tables are
  imported; a template built without them has none of the axes. The repair is
  not the subject, so the fixture is kept. Assert at the start of a step that
  the template's axes read, in order, Variant, Leader figures, Role, troop, Kit,
  trait, gear.
- `monsters/beastman-organisation`: one generated creature per step, tracked by
  `api.track` the moment `generateFromTemplate` returns it.

**Steps.** For each breed in the tables' column order:

1. Open the template's sheet, pin the breed and read the Special troop select.
   *Observable:* a role the breed has no band for is listed disabled; every
   other row of the table is enabled. A blank band is never rolled.
2. Pin each enabled special troop in turn and Generate. *Observable:* the
   Statblock's armour class, attack throw note, initiative and avoid-surprise
   rows show the figures the troop paragraph prints; each hover names the
   troop, the actor's own base figure and the page. A troop whose paragraph
   prints only gated figures changes none, and the creature's notes still name
   it with its page.
3. Pin each enabled trait in turn and Generate. *Observable:* morale, damage
   and armour class move only for the traits that print an ungated figure, each
   tooltip naming the trait and the page; the creature's notes name the trait.
   The trait with natural attacks lists one attack per printed die, which the
   breed's own list sets, and a breed with no list gets none.
4. Pin Roll on the table on the troop and then the trait select and Generate
   five times. *Observable:* only rows the breed has a band for come up, and
   the log on the creature's `generated` flag records the die and each roll.
5. Pin a leader rank under Leader figures set to the leader table, for each
   breed and rank the table prints, and Generate. *Observable:* the armour
   class, hit points and Hit Dice are the table's, the throw and saves moved
   with the rating, and the hover on the hit-point note names the table's page
   and the armour words. A rank the table has no cell for lists as unavailable.
   For a table-grade champion and chieftain also read the attack: the
   Statblock's attack tag reads the cell's die alone, and its hover names the
   row, the page, the creature's by-weapon modifier and the take-back; Actor
   Tweaks reads the modifier (+n); the attack item's Damage bonus reads −n; the
   Follower Card's attack row shows the die alone. Roll the attack.
   *Observable:* the card's damage line posts the die, plus n, minus n, and
   totals the die's face, with no `badDamage` warning.
6. The same champion with a troop Kit pinned, and then with Unarmoured.
   *Observable:* under the troop Kit the tag reads "By weapon" with the kit's
   modifier and the item's Damage bonus reads 0 (the die stays recorded on the
   creature's flag and written nowhere); under Unarmoured the die stands as in
   step 5.
7. Pin a troop and a trait on a leader with a Kit pinned. *Observable:* the
   armour class stands on the kit's figure with the bumps added, and its
   tooltip keeps the kit's part and names each organisation part.
8. Type another armour class on a step 2 creature and hover. *Observable:* the
   organisation parts are gone from the tip. Edit the table-grade champion's
   attack formula or its Damage bonus. *Observable:* the attack tag shows what
   core adds and the table's hover is gone.
9. Pin a piece of optional equipment. *Observable:* nothing on the sheet
   changes; the notes name it with its page, and the creature's flag records
   it with the row's figures.
10. Join as the Player seat, granted Observer on a step 2 creature.
   *Observable:* the tooltips render as on the GM seat.
11. The gated rows, one creature each (below, "The gated rows"). Generate the
   troop row that carries `vulnerableAttack`, on a breed that has a band for
   it, and put a target token in the condition its `targetCondition` word
   folds to. Attack in melee, then with a missile weapon inside the `targetBand`
   reach, then beyond it. *Observable:* in melee and inside the band the
   attack card's throw lists the row (label and page) and the damage formula
   shows the dice multiplied (a flat term unchanged) with one notice naming the
   part; beyond the band, or with the target's condition off, neither the row nor
   the notice appears. Open the Surprise Matrix against it. *Observable:* the
   creature's part shows whatever the target's condition.
12. Generate the trait row that carries `outnumber` and `outnumberedMorale`.
   Start a combat with the creature, allies and opponents as tokens whose
   dispositions are set; attack with the ratio met, then not met. *Observable:*
   the attack and damage rows are on the card only while the ratio is met. Open
   the morale page with the opponents strictly more numerous. *Observable:* the
   morale row is pre-ticked; with the sides even it is absent; outside a combat
   it is offered unticked.
13. Generate the trait row that carries `round` and attack in the named round
   and in another; generate the one that carries `targetCondition` and attack a
   target carrying the condition its word folds to, and one that does not.
   *Observable:* the row is on the card only under its gate.
14. Generate each troop and trait row that carries `waivesCharge` or
   `waivesRun`; toggle Charging, then Retreating, then Disordered on it.
   *Observable:* the Armor Class on the sheet keeps its figure under Charging
   and Retreating and loses the Disordered row's; the notes carry the
   withdrawal and bare-run lines with the page.
15. Override a gated row's word in the registry (Ruledata Browser) with a word no
   catalogue entry answers, and generate. *Observable:* no gated row on the
   creature, `extras.organisation.unresolved` lists the figure, the console
   carries the warning; restoring the word brings the row back on the next
   creature.
16. Generate a standard creature with no gear pinned, and one with the
   equipment row that carries `reductionPerDie` pinned. *Observable:* the first
   has no equipment ability item and no flagged weapon; the second has one ability
   item named by the row (`flags["acks-extras"].cookbook.id` is
   `organisation.gear.<key>`) whose spec is a per-die `damageReduction` gated on
   `weaponMundane`, and its Armor Class carries the row's `ac` figure with the
   gear part and the page in the hover on the Full Monster sheet. Hit it from a
   token with a mundane weapon, then a magical one, and Apply the card.
   *Observable:* the Apply card shows the per-die stage for the mundane weapon
   and none for the magical one.
17. Generate with the row whose `figuresFrom` is `hookedWeapon` pinned.
   *Observable:* the creature's melee weapon items carry
   `flags["acks-extras"].hooked`, a missile one does not. Turn the
   `overlayManeuvers` world setting on (Settings tab → Game Settings → ACKS II —
   Extras → Overlay: combat maneuvers) and drive a disarm through the API.
   *Observable:* the card's throw lists the manoeuvre row carrying the hooked part
   (an unflagged creature's disarm lists the base alone); with the setting off,
   no manoeuvre row.
18. Generate with the row that carries `riderDice` pinned, and drive a wrestle
   and then an overrun through the same call. *Observable:* the card's damage
   lists the row's label with its page and the dice as a signed fragment; a disarm
   from the same creature lists none, and with `overlayManeuvers` off none appears
   on any.
19. On a character, tag a melee weapon `hooked` in core's tag editor (the
   weapon sheet's tags) and open its Rolls tab. *Observable:* the Disarm row
   shows the penalty with the hooked part and its page in the tooltip, and its
   Roll puts that row on the card's throw; the same weapon untagged shows the
   base alone. Marker `equipment/hooked-character`.
20. Generate with the row that carries `healDice` pinned. *Observable:* the
   creature holds one item named by the row, type `item`, whose `flags["acks-extras"]`
   carry `cookbook.cite` (the row's page) and `drink`, with the printed condition as a
   catalogue id and `swigDice` set, and no `rounds` flag or count. No inventory
   surface shows the page on that item today, so read the flag. Set the row's
   condition word in the registry override to a word no entry answers and generate
   again. *Observable:* `drink.condition` is null and `extras.organisation.unresolved`
   lists it; restore the word.
21. The ammunition flag, which no generated creature can show before the kits: a
   rank-and-file creature's only weapon is the "By weapon" marker and it holds no
   ammunition. Give a fixture archer (marker `equipment/onhit-archer`) a launcher
   and two stacks of its ammunition by script, one carrying `flags["acks-extras"].onHit`
   with invented figures. Import the module's file in the page, `await
   import("/modules/acks-extras/scripts/equipment/ammo.mjs")`, and call
   `shotStack(actor, weapon, classifyWeapon(weapon))` and `onHitOf(stack)`, with
   `classifyWeapon` from `/modules/acks-extras/scripts/equipment/profiles.mjs`.
   A stack's count is `system.quantity`, a plain number on core 14.2; read it
   through lib's `stackCountOf` (`/modules/acks-extras/scripts/lib/item-model.mjs`).
   *Observable:* `shotStack` returns the flagged stack, `onHitOf` its figures;
   firing through `actor.makeAttackThrow({item, attackType: "missile",
   skipDialog: true})` with ammunition tracking on spends that stack and no
   other, and no prompt appears. Without `skipDialog` the call waits on core's
   roll dialog and a scripted run hangs.
   The generation half (flag, nock, record-only) is held by the organisation suite
   alone.

**The gear rows (steps 16 to 21).** A creature has gear only by pin:
`generateFromTemplate(template, {pins: {variant, role, gear: [<row key>]}})`,
the key read from `importedOrganisation().equipment` by the row whose figures
hold the key the step names, or by `figuresFrom` (never by label), then
`api.track` it. A monster's weapon lists the manoeuvre rows on its Rolls tab
(the overlay on), and a row's press is the call a scripted manoeuvre makes:
`actor.makeAttackThrow({item, attackType: "melee", acksLib: {maneuver:
"disarm"}})`, the item a melee weapon of the creature; the card is read off the
chat message. The rider and the hooked part are read from `damageRows` and
`attackThrowRows` only while `overlayManeuvers` is on, a setting a peer may rely
on, so ask before changing it and put it back. The weapon of a rank-and-file
creature is the "by weapon" marker until a kit or an added weapon gives it a
damage die; give it one (a created weapon item, tracked) to read a hit.

**The gated rows (steps 11 to 15).** A second fixture, a target creature,
carries `monsters/beastman-gates-target` and is found by it; it serves every
walk, since a step only sets its statuses. Make a creature from the kept
template with `generateFromTemplate(template, {pins: {variant, troop, trait,
role}})`, the troop or trait key read from `importedOrganisation().troopRules`
by the row whose figures hold the value key the step names (never by label),
then `api.track` it. Put the target in a condition with
`target.actor.toggleStatusEffect(<catalogue id>, {active: true})`; the id is
what `matchCondition` returns for the row's word, read from the generated
creature's ability item (`flags["acks-extras"].extras.effects[].gate`). Set
the outnumbering by creating combatants for tokens of friendly and hostile
disposition on one scene and starting the combat; only undefeated combatants
count, each as many bodies as its actor stands for. Create the combat with
`active: true`: lib's turn edges, which step a delayed-damage record, fire only
for an active combat, and only on the primary GM seat (`primaryGMSettled()` from lib's `util.mjs` before the first
turn). A rank-and-file creature's only weapon is the "by weapon" marker, whose
formula no roll parses, so give it a weapon item with a damage die (created,
tracked) before rolling. The attack card is posted
by rolling the creature's weapon from a token with the target selected; read
the throw's labelled rows and the damage formula off the card, and the notice
off `ui.notifications`. Core's own morale path (page off) reads no ability row,
so open the influence morale page.

**Drive notes.** A generated creature opens on the Follower Card, a
monster's default face, which shows no organisation part; every hover above
is read on the Full Monster sheet, opened from the card or built from its
registered class. The troop and trait selects appear only once a variant is
pinned. The sheet's root is a `<form>`, so a helper that takes
`element[0]` gets its first control; tell the root by `nodeType === 1`. The
sheet's Generate opens the new creature's sheet, whose document is the
action's own result to track.

**Teardown.** `api.sweepTracked()` for the generated creatures; quote it. The
template stays.

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
  imported, since a template built without them has no Kit axis. A walk that
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
   names the four figures and the row's page; the damage modifier, on both
   the melee and the missile side (Actor Tweaks), is the row's plus the
   leader's over the member's (read the three off the template's cells); move
   and morale are the row's. Hover a weapon's damage tag. *Observable:* it
   names the modifier, the row's figure, the leader's over its warrior's and
   the row's page. Type another damage modifier and hover again: the tag no
   longer names the parts. Repeat with Leader figures on AXIOMS procedure: the
   leader's derived armour class is the one moved, and the damage modifier
   follows the same sum.
   The blank branch is offline only. A modifier a page does not print reads 0,
   so no import leaves a part missing; `tools/test-kit-presets.mjs` pins the
   case of a cell with no recorded warrior (modifier null on both sides, the
   record `missing`, the tooltip the row's page alone), and a walk reaches it
   only by writing such a cell by hand: Actor Tweaks' damage field then reads
   empty, the Statblock shows the die alone and an attack card has no modifier
   row and no error.
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

The Monster Size table's squares row (MODEL, "The size
frontage"). Needs the Monstrous Manual connected on a GM seat and the Rules
tables import run (Settings tab → Game Settings → ACKS II — Extras → Manage
imports → Rules tables). The battlemap's walk of the same figures is
`docs/battlemap/TESTING.md` steps 6 to 7a.

**Fixtures.** None of its own; the import is the subject.

**Steps.**

1. Open the Ruledata Browser (Settings tab → Game Settings → ACKS II — Extras →
   Imported Rules Tables → Open Ruledata Browser) on `monsters`.
   *Observable:* `sizeFrontage` is listed with one `squares` row holding a
   cell per size category and citing the Monster Size table's page. A world
   whose first import is this one lists no `sizeSquare` table; one that
   imported while the square was imported still lists it, and
   `sizes.mjs` `sizeSquareFeet()` answers its `squares` row's `feet`. In the
   console the frontage cells parse through `sizes.mjs` `sizeSquares`.
1a. In a world that lists `sizeSquare`, override the `squares` row's `feet`
   with a figure of your own, and read `sizeSquareFeet()`.
   *Observable:* it answers the override and the battlemap's `footprintFeet({})`
   is that many feet on each side; clearing the override returns the imported
   figure, and a world that lists no `sizeSquare` answers the stated square.
2. Override `sizeFrontage`'s Large cell with a pair of your own and read it
   back.
   *Observable:* the override wins and its cite is empty; clearing it returns
   the imported cell.
3. Take the world layer of `monsters` off the registry, as in battlemap
   TESTING 6a, and read both.
   *Observable:* `sizeSquares("large")` is null while `sizeSquareFeet()` still
   answers the stated square, and a monster imported now carries Foundry's
   default prototype token. Re-import to restore.

## Natural weapons and extraordinary damage

The two Damage-entry tables of the Monster Overview (MODEL, "Natural weapons
and extraordinary damage") and the first-pass import's use of them. Needs the
Monstrous Manual connected on a GM seat and the Rules tables import run
(Settings tab → Game Settings → ACKS II — Extras → Manage imports → Rules
tables).

**Fixtures.** A disposable `monster` actor carrying `flags.world.fixture` =
`monsters/natural-weapons`, named for a monster whose recipe the import knows
(Apply Stats finds the recipe by the actor's name). Find it by the marker;
build it with `api.fixture("monsters/natural-weapons", "Actor", {type:
"monster", name: <a recipe's name>})`.

**Steps.**

1. Open the Ruledata Browser (Settings tab → Game Settings → ACKS II — Extras →
   Imported Rules Tables → Open Ruledata Browser) on `monsters`.
   *Observable:* `naturalWeaponDamage` lists a row per damage type with a list
   of weapon words, and `extraordinaryRule` lists `animalHd`, `animalSize` and
   `otherHd`; both cite MM p. 12.
2. Select the fixture's token and run `acksExtras.importer.applyStats()` in the
   console, then read the minted weapon items' `system.damage.base` and
   `flags.acks-extras`.
   *Observable:* a natural attack the stat block prints no icon for holds in
   `types` the type the table lists its weapon word under, and an empty set
   where the table does not list it; an attack with an icon holds the icon's
   type; `extraordinary` follows the monster's types, hit dice and size against
   the imported edges; `formula` holds the printed damage. The flags hold
   `naturalWeapon` and neither `damageType` nor `extraordinary`.
3. Override `extraordinaryRule`'s `animalSize` with another category, apply
   again, and read `system.damage.base.extraordinary`.
   *Observable:* the animal's mark follows the override; clearing it returns the
   imported edge.
4. Take the world layer of `monsters` off the registry, as in battlemap TESTING
   6a, apply again, and read `system.damage.base`.
   *Observable:* no natural attack holds a type except from its icon, and an
   attack of an animal or other edge-bound type reads `extraordinary` false.
   Re-import to restore.

**Teardown.** The fixture stays; `api.sweepTracked()` for anything the run
built.

## The body-form list

The Classification tab's Body Form select and the band's glyph (MODEL, "The
body forms"). Needs the Monstrous Manual connected on a GM seat and the Rules
tables import run (Settings tab → Game Settings → ACKS II — Extras → Manage
imports → Rules tables).

**Fixtures.** A disposable `monster` actor carrying `flags.world.fixture` =
`monsters/body-form`. Find it by the marker; build it with
`api.fixture("monsters/body-form", "Actor", {type: "monster", name: <any>})`.

**Steps.**

1. Open the fixture's sheet, Classification tab, and open the Body Form select.
   *Observable:* it holds one option per row of the imported table, each
   reading `name — sample monsters`; hovering its label shows `Body Form` and
   the page the table cites (MM p. 389).
2. Pick a form, then read `actor.flags["acks-extras"].extras.bodyForm`.
   *Observable:* the key stored is the form's printed name, folded to letters;
   the band's overline names the form and the glyph follows it, the paw for a
   form with no glyph of its own.
3. Open the Ruledata Browser on `monsters` and override `bodyForms` with a table
   of one row of your own, then reopen the sheet. Clear the override.
   *Observable:* the select holds only your row and its tooltip says it is the
   Judge's own table; the form picked in step 2 shows as an option reading its
   raw key while the override stands; clearing returns the imported list.
4. Set `extras.bodyForm` to a key the table does not hold, then edit another
   field on the sheet (the Subtype) and read the key back.
   *Observable:* the key is still there, offered as the select's selected
   option under its raw key, and the band names no form.
5. Take the world layer of `monsters` off the registry, as in battlemap TESTING
   6a, and reopen the sheet with a form stored. Edit another field and read the
   key back. Re-import to restore.
   *Observable:* the select is disabled and blank, hovering its label shows the
   page reference alone, the band wears the paw and names no form, and the
   stored key is unchanged after the edit.

**Teardown.** The fixture stays; `api.sweepTracked()` for anything the run
built.

## An actor with no attack throw

The Statblock's Attacks group and the right rail's attack button; the Rolls
tab, the Stats tab and the follower card read the same field and are unwalked.

**Fixtures.** A disposable `monster` actor carrying `flags.world.fixture` =
`monsters/no-throw`, found or built with `api.fixture`, with a weapon item on
it.

**Steps.**

1. Clear the Attack throw field on the Classification tab and read
   `actor.system.attack.throw`.
   *Observable:* it reads `null`. Core's field is nullable, and a cleared field
   cleans to null (monsters DECISIONS, "2026-11-14 — Core's attack throw holds
   a blank"). If it reads a number, that is a finding: record it, then drive
   the render directly. Import `scripts/monsters/statblock.mjs` in page context
   and call `statblockColumns` and `attackReading` with a snapshot whose
   `attackThrow` is absent.
2. Read the Statblock tab's Attacks group and the right rail's attack button.
   *Observable:* each attack row's throw cell is empty (no `NaN+`, `null+` or
   `0+`), the group's caption reads `throw`, the rail button shows no figure,
   is dimmed and disabled, and its tooltip says `Attack throw — roll`. The
   caption's tooltip names the page only where the import marked the throw
   missing.
3. Click an attack row.
   *Observable:* a warning says the monster has no attack throw, and no roll
   card is posted.
4. Roll the weapon from its own item sheet, and from the character sheet's
   Equipment tab if the fixture is a character.
   *Observable:* the lib warning (`ACKS-LIB.attack.noThrow`) names the actor,
   and no dialog opens and no roll card is posted. The refusal is the wrapper on
   `makeAttackThrow` (lib MODEL, "An attack card is the system's"), unwalked.

**Teardown.** The fixture stays; `api.sweepTracked()` for anything the run
built.

## A figure the import left unread

MODEL "A figure the import left unread". No shipped row leaves a figure
unread, so the fixture carries the list by hand, with invented figures.

**Fixture.** `monsters/unread-figure`: a `monster` actor built with
`api.fixture` whose `flags["acks-extras"].extras.derived.unread` lists
`system.saves.death.value`, `system.details.morale`, `system.attack.throw`,
`system.hp.max`, `system.hp.hd` and `system.ac.value`, each
`{path, held, cite}` with `held` read off the created actor at that path and
`cite` an invented reference such as `XX p. 1`. A step that needs the list
whole asserts each `held` still equals the actor's value at its start and
rewrites the list where it does not.

**Steps.**

1. Open the sheet's Statblock tab.
   *Observable:* the save, morale, attack-throw, hit-point and hit-dice rows
   listed draw no figure; the unlisted saves draw theirs. Each blank row's
   value span carries `data-tooltip-text` equal to the `cite` and nothing
   else. Armour class draws its figure though it is listed.
2. On the edit tab, change the death save to another number and return.
   *Observable:* that row draws the new figure; the other listed rows stay
   blank.
3. Set the death save back to the held value.
   *Observable:* the row is blank again (ROADMAP, importer, "An unread figure
   blanks on the Statblock tab alone").
4. Read the rail and the band.
   *Observable:* they show core's values for the listed figures (the same
   ROADMAP row).

**Teardown.** The fixture stays.

## An entered ability score

MODEL, the default-score paragraph: an entered score gives the acks system's
modifier through `lib/actor-read.mjs` `abilityMod`; a blank gives none. What a
mock cannot show is that the system's table answers under the real
`CONFIG.Actor.dataModels.character`, and that a crossing row a monster stands
in reads it.

**Fixtures.** `monsters/entered-scores`: a `monster` actor built with
`api.fixture`, no items. `formation/swim-party` from the formation recipe, read
only. A step asserts the scores it needs at its start: the fixture keeps
whatever the last walk wrote.

**Drive mechanics.** No party fixture holds a monster member, and none is
needed: `crossing.mjs` `rowFor(party, {kind}, {member: {actorId}, actor})`
builds the row for any actor without writing a crossing, so the rows are read
in page context on a synthetic member of the kept party. The Constitution part
is in the swim row's `drown.parts`, not its `parts`. A score typed into the
Classification tab's field and changed takes from under one to about five
seconds to reach the flag: poll the flag for the value, re-querying the input
for each write, never a fixed wait. A cleared field stores `null`.

**Steps.**

1. Write `scores` `{con: 16, str: 3, cha: 12}` and blanks for the rest, then
   read `enteredScore` and `abilityMod` for each key beside
   `getAttributeModifier` called on the entered figure.
   *Observable:* each entered key's `abilityMod` equals the table's answer for
   its score; a blank, a `0` and an empty string read `enteredScore` null and
   `abilityMod` 0. A character's `abilityMod` still equals its sheet's `mod`.
2. With Constitution and Strength blank, read the swim and squeeze rows.
   *Observable:* the swim row's `drown.parts` hold the `breath` and no
   `conMod`; the squeeze row holds no `strength` part.
3. Enter Constitution 16 and Strength 16 on the Classification tab's
   Attributes, then read both rows again.
   *Observable:* the swim row gains `conMod` with the table's figure for 16 and
   its breath rounds rise by it; the squeeze row's `strength` part carries the
   same figure as its `mod`.
4. Enter Wisdom 16 and Dexterity 16 the same way, then read
   `saveSpec(actor, "spells")`, the same with `{magical: false}`, and the jump
   row's `options.dex`.
   *Observable:* the magical save's parts are one `wis` roll part with the
   table's figure; the other save has none; the jump's `dex` is 16.
5. Clear the four fields.
   *Observable:* each stored score is `null`, the parts of step 2 return, the
   save has no parts and the jump's `dex` is undefined, so the jump takes the
   creature's assumed score.

**Teardown.** The fixture stays, blank.

## An attack row's count

MODEL, the Attacks row: a weapon stack above one prints `×N` from lib
`countView`. The Inventory tab's count is the same rule and is walked with the
storage lists.

**Fixture.** `monsters/attack-count`: a `monster` actor built with
`api.fixture`, carrying a weapon `Spear` of Quantity 3 and a weapon `Claw` of
Quantity 1. A step asserts both quantities at its start.

**Steps.**

1. Build `FullMonsterSheet` on the fixture (Core drive mechanics, above) and
   read each `[data-tab="attacks"] li.item`.
   *Observable:* the Spear's `.item__text` holds a span reading `×3` whose
   `data-tooltip-text` names 3 and the item's Quantity; the Claw's holds no
   span.
2. Set the Claw's Quantity to 2 on its item sheet and read again.
   *Observable:* the Claw row reads `×2`. Set it back to 1.

**Teardown.** The fixture stays, at Quantities 3 and 1.

## The ACKS Monster group on an item sheet

The group injected into the sheet of a monster-owned weapon, ability or
generic item (MODEL, "Item flag metadata"). Needs nothing imported.

**Fixtures.** A `monster` actor carrying `flags.world.fixture` =
`monsters/annotated`, holding one weapon, one ability and one generic item.
Find it by the marker; build it with `api.fixture("monsters/annotated",
"Actor", {type: "monster", name: "Annotated Monster", items: [{type: "weapon",
name: "Claw"}, {type: "ability", name: "Gaze"}, {type: "item", name:
"Hide"}]})`.

**Drive mechanics.**

- A weapon and a generic item open on the extras item sheet; an ability opens
  on the abilities sheet (`AcksAbilitySheet`: Description, Rolls, Mechanics),
  so one fixture reaches both placements. The fixture's generic item has
  nothing else to show, so its sheet takes the no-tab view.
- The group is `.acks-monsters-flags`; its scroller is the nearest ancestor
  whose computed `overflow-y` is `auto`: the extras sheet's `body` part, the
  abilities sheet's `description` part.
- Shorten the window the way a user does. Core's corner handler writes the
  dragged size into `options.position`, and a re-render keeps it;
  `app.setPosition({height})` leaves `options.position.height` at `auto`,
  which the next render puts back. Scripted, the drag is a `pointerdown` on
  `.window-resize-handle`, then a `pointermove` and a `pointerup` on the
  frame, each with `pointerId: 1`; in a hidden pane only the first move
  lands, since core frees the next on an animation frame.
- In a hidden browser pane `requestAnimationFrame` never fires; read layout
  straight after `await app.render({force: true})` instead.
- `system.damage.base.types` is a Set live (its source is an array): read it
  with `Array.from`.
- An attack at a target: place a token of the fixture on a scene (the magic
  recipe's `magic/cast-scene` keeps none between walks, so the run places its
  own and deletes it by id), view the scene, `canvas.tokens.setTargets([id],
  {mode: "replace"})`, then attack from the TOKEN's actor:
  `token.actor.makeAttackThrow({item, attackType: "melee", skipDialog:
  true})`, with `CONFIG.Dice.randomUniform` returning 0.025 (a natural 20 on
  core 14) and put back after. The card's speaker resolves to the token, so an
  attack from the world actor while its unlinked token is on the viewed scene
  is looked up under the token's actor and carries no stamp. Only a hit's card
  carries one. The run deletes its token and its cards by id.

**Steps.** Each step clears what it sets before it starts.

1. Open the fixture's weapon on its Details tab.
   *Observable:* the group is the last child of the Details panel's stack,
   inside the `body` part; on the Rolls tab it has no box
   (`getClientRects().length === 0`).
2. Drag the window's corner up to about 320 px tall.
   *Observable:* the body part's `scrollHeight` takes in the group, and
   scrolling the body to its end brings the group's checkbox into view.
3. With the body scrolled to its end, pick a Natural Weapon.
   *Observable:* `flags.acks-extras.naturalWeapon` holds the key, the select
   shows it, the sheet holds one group, and after the re-render the body is
   still scrolled to its end with the group in view.
4. Pick a Damage Type in the weapon's group.
   *Observable:* `system.damage.base.types` holds the key core spells
   (`variesByWeapon` for Varies by Weapon) and nothing else, no `damageType`
   flag is written, and the select, the monster's attack row (Full sheet) and
   the weapon's Rolls tab name the same type. Clearing the select empties the
   set.
5. Tick Extraordinary damage.
   *Observable:* `system.damage.base.extraordinary` is true, no
   `extraordinary` flag is written, and the monster's attack row marks it.
6. With the weapon typed and marked, attack a target with it (Drive
   mechanics).
   *Observable:* the card's `flags.acks-extras.attackApply` holds the picked
   type in `types` and `extraordinary` true. Cleared and unticked, the next
   card holds empty `types` and `extraordinary` false.
7. Open the weapon on the system's own item sheet (picked by hand in the
   sheet's configuration), pick a type in the group and read the field back
   after a second.
   *Observable:* the field keeps the pick, and core's own Damage Type control
   shows it. Put the weapon back on the default sheet.
8. Open the fixture's ability.
   *Observable:* the group is the last child of the `description` part and
   has no box on Rolls or Mechanics; a picked Usage lands in
   `flags.acks-extras.usage`.
9. Open the fixture's generic item and check Spoil.
   *Observable:* the group ends the Details panel, or the body in the sheet's
   no-tab view; `flags.acks-extras.spoil` is true.

**Teardown.** The fixture stays.


## The organisation roll through the API

The provider, the executor and Delete, driven through `acksExtras.monsters.rollOrganisation`
and `acksExtras.lib.org`. There is no user surface yet beyond the whispered card.

**Fixtures.** The beastman family template with the organisation tables imported (a world
whose tables predate a recipe change re-imports them first), and a faction
`monsters/beastman-village` as the host, found or built with
`api.fixture("monsters/beastman-village", "Actor", {type: "acks-extras.faction", name: <any>})`,
and a location `monsters/beastman-village-place` for the send-out. Every document a roll
makes is `api.track`ed from `result.created` (and `result.pot` as a Cards document); the
host and the place are the kept fixtures. A step that needs an empty host empties its rows
first (`host.update({"system.units": []})`) after tracking and sweeping what they held.

**Steps.** Each observable is read back from the documents, not from the return value.

1. Roll a village: `const r = await acksExtras.monsters.rollOrganisation({host, template, variant, context: "wilderness", state: "lair", scope: "below", rules: {troops: true, traits: true, gear: true}})`,
   then `r.created.forEach((u) => api.track(u, "Actor"))`. Observe: each of the host's
   `system.units` rows names an existing group, one top row for each warband and one for each part
   (the village has no row of its own, and `r.deleted` names a root group where the host was one);
   the faction's `leaderUuid` names the chieftain and `flags["acks-extras"].organisationGen` the template; no
   group is left with no stacks and each part row's group holds one; every stack's `template.uuid` resolves; two stacks
   of one body kind copy one prototype; a whispered card is in the chat log with its links and
   its tooltips.
2. A reference nothing answers: the card lists a `reference` finding and the group holds a
   labelled stack (`template.uuid` null, `template.label` the printed word).
3. Send a gang out with `acksExtras.lib.org.sendOut(host, key, placeUuid)` and observe its group
   on the roster; take a casualty (`acksExtras.lib.groups.applyCasualties`); `recall(host, key)`
   and read the count live.
4. A one-row Roll leaves the others byte-identical: `org.addRow(host, parentKey, {kind})`,
   snapshot every other row with `JSON.stringify`, `rollOrganisation({host, rowKey})` with no
   `template` argument and compare. Only that row and its new descendants differ, and the new
   empty rows' `gen` hold their share and troop.
5. Rolling a filled row returns `{ok: false, reason: "filled"}` and writes nothing.
6. Delete with `org.deleteRow(host, key)`: the row, its subtree, its groups and a prototype no
   stack names are gone; a prototype another stack names stays (`result.kept`); an actor the
   roll did not mint stays. With a body on the map the result carries `warnings: ["onMap"]`
   and the Judges are whispered.
7. `gen` survives a reload: reload the client and read the root row's `gen.template`, then
   roll an empty row below it as in step 4.
8. Hand-off: with `state: "lair"` the pot's `deal.monsters` holds the creature with `hoards`
   the count the line gave; a second Roll with `pot` given raises that row.

**Teardown.** `api.sweepTracked()`, and quote its result.

## Family plate

The family's plate, imported from the Judge's own Monstrous Manual onto the Beastman
template's `flags["acks-extras"].plate` (MODEL, "The family's plate"). Needs the MM connected
(`ACKS_TEST_BOOKS`). Walked by `tools/live/monsters-beastman-plate.mjs`.

**Fixtures.**

- `monsters/beastman-plate`: the library's family template (cookbook id
  `mm.familyBeastman`). A pack document takes no marker and is written only by
  Repair in place (as for `monsters/family-roles` above), so the marker names
  the lookup, not a flag: the one library document whose cookbook id is the
  family. A library with no template is imported first through the entry
  picker; two templates stop the walk.
- `monsters/beastman-plate-host`: a faction card, built by `api.fixture`, whose
  one top row names the template in its `gen`. A step that needs the row writes
  it at its start.
- The root group Generate makes: `api.track` its uuid the moment the press makes
  it; it is found by the template its top row names.

**Steps.**

1. Repair the template in place (Settings tab → Game Settings → ACKS II —
   Extras → Manage imports → (Re)import individual entries, the family row
   ticked; Yes to the confirm, Keep all to a held-edits list). *Observable:* the
   flag ends in the plate's own file (`mm-beastman-plate.png`) and `img` is
   still the strip, a file of another name; the Variant options are as many as
   before.
2. Open the uploaded file. *Observable:* it is the plate and carries no page
   foot. The walk fetches it, logs its pixel size and saves a copy under the
   run's `aia-tmp/live/`; the walker views the copy, since a foot is for eyes.
   A plate that does not arrive is no file and no flag: nothing is rendered in
   its place.
3. Reload, then open the faction host on its Org chart tab. *Observable:*
   `.acks-extras-org__plate` is drawn with the plate's file. A pack
   document answers `fromUuidSync` with its index entry after a reload, so this
   step fails if the flag is missing from `compendiumIndexFields`: the walk reads `fromUuidSync` raw before anything loads the document, and says so when it answered a Document.
4. Press Generate on the template's sheet. *Observable:* one root group is made
   and its `img` is the plate. Then Roll its top card until a village is made
   (Organisation section → Roll): *Observable:* the faction card the Roll made has
   `img` equal to the root group's, the plate, and the root group is deleted
   (`docs/lib/TESTING.md`, "The Org chart and Locations tabs", step 1, for the documents
   that Roll makes and deletes). The walk tracks the root group before the Roll and reads
   it back gone.

**Teardown.** `api.sweepTracked()`, and quote its result. The template and the
host are kept.

## The recipe editor

The Judge's window over `extras.encounter.recipe` (MODEL, "The recipe editor"), driven from
its three doors. Needs the Monstrous Manual connected (`ACKS_TEST_BOOKS`) and the family
template in the library. `tools/live/monsters-beastman-recipe.mjs` carries this recipe; the
walk logs keys' positions, counts and booleans, and nothing the book prints.

**Fixtures.**

- `monsters/beastman-recipe`: a **world copy** of a family member's library entry, its
  recipe emptied and read again by the importer. Built so because the driver marks world
  documents only and an import lands in the library pack. Take the member's `toObject()`,
  stamp `_stats.compendiumSource` with the library entry's uuid and read it back (a copy
  without the stamp is not a copy, and a picker repair would then write it), delete
  `flags["acks-extras"].extras.encounter.recipe` and `cookbook.read.recipe`, create it, then
  run `refillMonster(actor, {whole: true})` from `importer/cookbook/monster.mjs`. A library
  entry imported before this release holds parts with no `origin`, and no repair restamps
  one, which is why the recipe is read fresh. The fixture is usable when every part reads
  `register`, the read copy has as many parts, and one part has a count of its own. The setup
  retires the standing fixture with `api.retire` and marks the result with `api.mark`.
- The family template: the library's, found by cookbook id (`mm.familyBeastman`) and read,
  never written, except that a library with no variant option holding stamped parts is
  repaired in place first through the entry picker. The run edits a **tracked world copy** of
  it (the same stamp), so no library document changes. A variant option is chosen at run
  time: stamped, with a Roll side (`sidesOf`: wilderness before dungeon, wandering before
  lair, a top unit that counts bodies first) whose top unit word some part names.
- A faction host, tracked, whose one row `top` carries `gen: {template: <copy>, variant}`.
  The chart's Recipe… needs a row or a record naming template and variant.

**Drive mechanics.**

- *Door 1.* A plain `monster` opens the follower card, so build the sheet: the entry of
  `CONFIG.Actor.sheetClasses.monster` named `FullMonsterSheet`, `new Cls({document})`,
  `render(true)`, `changeTab("ecology", "primary")`, press `button[data-action="organisation"]`.
- *Door 2.* The variant option's Recipe… exists only in the template sheet's **Edit
  structure** mode: render the copy's sheet, press `[data-action="editToggle"]`, then
  `li.editor-option[data-axis-key="variant"][data-option-key=<key>] button.acksm-recipe-door`.
  A render hook adds it, and the toggle is absent where the sheet is not editable (a locked
  pack).
- *Door 3.* Seed the host, open it on the Org chart tab (`sheet.tabGroups.primary =
  "orgChart"`), press `[data-action="orgRecipe"]`.
- A window is found by `app.title` over the instances whose constructor is `RecipeEditor`.
  The title is `Recipe · <name>` or `Recipe · <name> · <option>`, composed from the lang.
  `app._prepareContext({})` returns `canWrite` and `foot.canResetAll`. The window re-renders
  after every write: re-query a control after each change, and read the stored recipe to know
  a write landed. A part's controls sit under its row (`li[data-key]`), opened by the pen
  `[data-action="editPart"]`, which toggles. `[data-field=count|label|role|fixedHp|linkQuery]`
  take a value and a bubbling `change`; `[data-field="unit"][data-word]` is a checkbox.
- *Which stored recipe a door writes.* The Ecology door writes the actor's, which no Roll
  reads. A Roll reads the option's, so the Roll steps run on the option window.
- *Rolling.* `acksExtras.monsters.rollOrganisation({host, rowKey: "top", template, variant,
  context, state, scope: "below", card})`, template and variant passed as the chart's Roll
  passes them. It refuses a filled row, so reseed the host's rows before each Roll. Track
  `result.created` (and `result.pot`) with `api.track(uuid)` and no kind: it can hold a pot
  and a faction card. A group's stack names its part in `gen.part`; a labelled stack has
  `template.uuid` blank and `template.label` the part's Label. Findings are
  `result.findings` and, on the whispered card, `li[data-finding="unlinked"]`.
- A part reaches a unit only through its unit words (`appliesTo`), whatever its state, so the
  Judge part ticks the top unit's word or no Roll applies it; the field's hint says so.
- *Repair.* A picker repair passes a copy by. The walk calls the refill the picker runs for a
  stat-block monster (`refillMonster`, `whole`).
- The 460-wide measure: `setPosition({width: 460, height: 420})`. The part root is
  `[data-application-part="body"]` (`overflow-y` auto, `scrollHeight > clientHeight`); the
  footer part `[data-application-part="footer"]` stays inside the frame.
- The Player seat needs a real second seat. The monster's ownership is written with
  `update({ownership}, {diff: false, recursive: false})` and the editor reopened for each level.

**Steps.** Each observable is read from the stored recipe or the window, not from a return value.

**Setup, and the lock (before step 1).** A Roll on the host before any edit (step 8's baseline). Record, as
a note and never a failure, whether the seat may edit the library family template:
`pack.locked`, `canUserModify(update)`, the sheet's `isEditable`. A chart host naming the
library template opens its editor read-only while the pack is locked. The check is only
that the editor agrees with Foundry.

1. *Three doors.* Each opens a window headed by its document: `Recipe · <monster>` from the
   Ecology tab's Organisation…, and `Recipe · <template> · <option>` from the template
   sheet's option and from the chart's Recipe….
2. *Hand mark.* Change a part's count. *Observable:* the part's `origin` is blank and every
   other part's is `register`; the head reads "1 of N parts changed by hand"; the row has
   `is-hand`; its tooltip names the figure the import read and its page reference.
3. *Reset this part.* *Observable:* `origin` is `register`, the part equals the read copy
   (compared without `origin`), and the head reads 0 of N.
4. *Add from a sentence.* Press a sentence marked unread. *Observable:* a part `_…` with a
   blank origin whose row shows the "No role yet" text, muted.
5. *Mount, unlinked, then linked.* On the option window: Add a part, type a QA Label, Role
   Mount, Count 1, tick the top unit word. Roll with the card on. *Observable:* a labelled
   stack named by the Label, a finding of kind `unlinked` naming the part, and a card carrying
   it (track the message, found by the Label). Then search the library and press Link on an
   entry. *Observable:* the part's `source.uuid` is the entry's, and the next Roll's stack has
   that entry as its template.
6. *fixedHp.* Type 13. *Observable:* the stack on the entry carries `fixedHp` 13. A labelled
   stack drops it (T-0852), which the walk does not assert.
7. *Repair keeps the hand part.* On the monster: change a count again, then refill in place.
   *Observable:* the hand part and the Judge part stand byte for byte, and every other part
   equals its read copy.
8. *Rolled earlier keeps its figures.* The baseline group's stacks read the `gen` and `size`
   they were rolled with, after the option was edited in steps 5 and 6.
9. *Narrow.* At 460 wide: one column (the reading pane under the tables), the body scrolls,
    the footer is inside the frame.
10. *Player seat.* Observer: the window opens, rows draw, and there is no pen, no Add a part,
    no sentence button, no Reset all, and the read-only line shows. Owner: pens, Add a part
    and sentence buttons are there.
11. *Reset all.* *Observable:* the recipe equals the read copy part for part, the Judge part
    is gone, and the head reads 0 of N.

**Teardown.** `api.sweepTracked({only})` over the unmarked ledger, quoted: the template copy,
the host, every group, prototype, faction card and pot the Rolls made, and the whispered card.
The monster's ownership is set back to what the run found. The marked monster stays; the next
run retires and rebuilds it.
