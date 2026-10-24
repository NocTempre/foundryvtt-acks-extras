# Follower Card

The printed ACKS II **Henchman/Follower card** as a compact actor view, drawn
on the lib's sheet frame (MODEL.md, "The sheet frame"). One template, two
faces:

- **the follower's own sheet** (`FollowerCardSheet`, `editable`): the frame's
  band in the window header and a three-column body of the frame's rules and
  rows, every essential a Judge edits at the table in place;
- **the compact card** (read-only) an employer's sheet shows for each
  follower: the character sheet's Followers tab and the system sheet's
  Hirelings tab, re-skinned by the henchmen feature through the api below.

## Why it lives here

The card and its default-assignment are the family's **override layer** on the
system's actor sheets, so they live in `lib` rather than any one feature.
Hirelings stay core `character`/`monster` actors — a distinct actor type is *not*
viable, because core gates every character derivation (ability mods, AC, encumbrance,
attack throws, rolls) on the literal type string `"character"`, and core is a
read-only reference. So a henchman genuinely *is* a `character` with an employer;
`system.retainer.enabled` already models that, and the card is an actor's sheet
per instance via `flags.core.sheetClass` rather than a new type.

## Who opens on the card

- **A monster** — wild or hired — opens on the card: it is the monster type's
  default unless the world's preset picks the system's sheets, and the
  extended block opens behind it.
- **A character** — a PC or a hireling alike — opens on the character type's
  sheet, which the world's preset decides. The card is an alternative a user
  picks per actor, through any of the routes below; nothing picks it on its
  own. Picking it writes `flags.core.sheetClass`, which outranks the preset.
- **The one-time release.** Hirelings used to adopt the card on hire, and a
  world that upgrades holds those flags. The `ready` sweep in the window that
  automates (MODEL.md, "Which window automates") drops the card flag from every
  serving character or monster hireling (`retainerCardsToRelease`,
  `ui-preset-logic.mjs`) and records `retainerCardsReleased`, so it runs once
  per world; a card picked after it stays. A dismissed hireling is not in
  service and keeps its card.

**Switching an actor's face** (everything the card omits — items, effects, deep
monster stats — lives on the full sheet):

- the **Expand** header button, the band's portrait and its **Full sheet**
  chip open the full sheet for the session;
- **right-click the actor in the directory** → *Use full sheet* / *Use
  Follower Card sheet* switches the actor's sheet for good (the same
  `flags.core.sheetClass` core's Sheet Configuration writes);
- the henchmen feature's Roster app has **Cards for all / Full sheets for all** bulk
  buttons, built on `acksLib.followerCard.setSheet(actor, useCard)`.

## The follower's own sheet

The sheet is an `ActorSheetV2` carrying the frame's root class, not the
`FrameMixin`: it has no rails, no fold and no tabs, so it takes the band
partial alone and moves it into the header itself (`header-band.mjs`), with
the frame's floor narrowed to the card's. The band's glyph is the portrait,
its rank the card's rank line (class and level, or Hit Dice and type), its
chips the card's tools — **Attack** and **Skill** add a card-only line,
**Commit** (gold while an override stands) and **Reset** are the override
controls, **Full sheet** the way out.

The body is the frame's three columns. **Vitals**: hit points, the three
card-only overrides (AC, speed, encumbrance, each `is-overridden` while it
stands against the sheet's figure), morale and loyalty, the six scores with
their modifiers. **Powers & proficiencies**: one row per power with its text
shortened to a line, a roll for a proficiency with a throw, a star (below)
and show; **Adventuring** throws, a typed figure being a card-only target;
**Attacks**, each row a throw on the row itself and on its die, with the
pencil opening the attack's editor under it (`is-editing`, view state only).
**Notes** as a prose editor, **Equipment** with the worn toggle, the divide
control and the coin-order block, the class-build strips, and the caster's
slots.

**Starred powers.** The star on a power row writes the actor's `fcStarred`
flag (`STAR_FLAG`, a list of item ids, `follower-card-model.mjs`
`toggleStar`); the compact card lists the starred rows under its attacks
(`starredRows`), so a Judge chooses what the employer's tab shows of a
follower's abilities. Unstarred, a card shows no powers at all.

## The compact card

The head: portrait, the name as a button that opens the follower
(`hirelingShow`), a dot after it while a feature says something is owed
(`pending`), the rank line; and, with `controls`, the employer's controls:
**Show** and **Dismiss** (`hirelingDelete`). Six readings in one strip —
HP, AC, speed, encumbrance in stone, morale and loyalty — the last two as
buttons that throw (`hirelingMorale`, `hirelingLoyalty`) when `controls` is
set and a reading otherwise, each with its figure spelled in the tooltip.
Then the attacks with the routine throw or `#AT · DMG` as the note, the
starred powers, the saves line (a monster's saves-as line where a feature
supplies one, else the five targets for a body that stores them), a trained
animal's training and whether it is a mount, what is worn, the caster's
slots, and the build strips compact.

The card carries **no `name=` inputs**: on an employer's sheet it sits inside
the employer's form, so a bound field would write to the employer. Its
actions resolve the follower by the `data-item-id` on the card root
(`.item[data-item-id]` on the system sheet) or the `data-actor-id` on the
Followers tab's wrapper; the henchmen feature re-tags a monster's actions
(`hirelings-grid.mjs`) because the system's own handlers expect a character.

**`controls`** is the employer's side: `renderFollowerCard(actor, {editable:
false, controls})`, which defaults to `!editable`. The Followers tab passes
the employer's `isOwner`, so a viewer of someone else's sheet gets the
readings and Show alone.

**Coin** is listed with the rest of what the follower carries: every coin row
that holds anything, always with its count, and an emptied row not at all.
The card's weight counts the purse to the coin and prints the nearest sixth.
Coin dropped on the card is handed over or lands on the row of its kind
(docs/lib/MODEL.md, "Currency"). On the follower's own sheet a row holding
more than one carries a divide control, which asks through the lib's one
prompt (`promptDivide`), and the lib's coin-order block sits under the list
wherever the follower has a store to choose or a row to fold. The compact
card lists what is worn as tags and nothing else of the inventory.

## What a feature adds: `FOLLOWER_CARD_HOOK`

The lib knows the system's actor. What a feature stores on it — a calamity
owing its throw, a creature's saves-as class — reaches the card through
`Hooks.callAll(FOLLOWER_CARD_HOOK, actor, ctx)`, fired once the context is
built, so a feature sets fields on `ctx` and the lib imports nothing of the
feature:

| field | set by | shown as |
| --- | --- | --- |
| `ctx.pending = {title}` | henchmen (`special.pendingCalamity`) | the dot after the compact card's name |
| `ctx.savesAs = "…"` | monsters (`MonsterExtras.saveAs`) | the compact card's saves row |

## API — `acksLib.followerCard`

| member | purpose |
| --- | --- |
| `context(actor, {editable, interactive, controls})` | Build the flat card view model and fire `HOOK` on it. Branches by `actor.type`; precomputes every derived value in JS. A character shows the six scores and class/level/xp; a monster hides the grid and shows HD and its stored AC and attack routine. `interactive` draws the controls that dispatch an action; `controls` the employer's own on a read-only card. |
| `render(actor, {editable, interactive, controls})` | Render the card to an HTML string (the hirelings-tab grid and the Followers tab). |
| `Sheet` | `FollowerCardSheet` class. |
| `TEMPLATE` | Template path (`modules/acks-extras/templates/lib/follower-card.hbs`). |
| `HOOK` | `FOLLOWER_CARD_HOOK`, above. |
| `setSheet(actor, useCard)` | The one sanctioned card↔full switch. |

The decisions on plain data — stones, Hit Dice, the rank line, the save
targets under the new keys or the legacy ones, the one-line cut, the star
list — are `scripts/lib/follower-card-model.mjs`, pinned by
`tools/test-follower-card.mjs`.
