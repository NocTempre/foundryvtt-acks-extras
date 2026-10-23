# Follower Card

The printed ACKS II **Henchman/Follower card** as a compact, theme-styled actor
view. One layout, two surfaces:

- **`FollowerCardSheet`** — a hireling's own sheet (editable essentials), and
- the **read-only cards** the character sheet's hirelings tab is re-skinned into
  (rendered by **the henchmen feature**, which consumes the api below).

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

- the **Expand / details** header button and a labelled **Full sheet** footer
  link on the card sheet open the full sheet for the session;
- **right-click the actor in the directory** → *Use full sheet* / *Use
  Follower Card sheet* switches the actor's sheet for good (the same
  `flags.core.sheetClass` core's Sheet Configuration writes);
- the henchmen feature’s Roster app has **Cards for all / Full sheets for all** bulk
  buttons, built on `acksLib.followerCard.setSheet(actor, useCard)`.

**Casters** get a slots strip on the card (per-level used/max, read from
`system.spells`) with the Full sheet link beside it — the spell page itself
(memorize, cast, reset) deliberately stays core's.

**Coin** is listed with the rest of what the follower carries: every coin row
that holds anything, always with its count, and an emptied row not at all.
The card's weight counts the purse to the coin and prints the nearest sixth.
Coin dropped on the card is handed over or lands on the row of its kind
(docs/lib/MODEL.md, "Currency"). On the follower's own sheet a row holding
more than one carries a divide control, which asks through the lib's one
prompt (`promptDivide`), and the lib's coin-order block sits under the list
wherever the follower has a store to choose or a row to fold. The read-only
cards on an employer's sheet carry neither: their actions resolve against the
employer's form.

## API — `acksLib.followerCard`

| member | purpose |
| --- | --- |
| `context(actor, {editable})` | Build the flat card view model. Branches by `actor.type`; precomputes every derived value in JS (no system Handlebars helper needed). Character shows the six ability boxes and class/level/xp; a monster hides the ability grid and shows HD + its stored AC / attack routine. |
| `render(actor, {editable})` | Render the card to an HTML string (used by the hirelings-tab grid). |
| `Sheet` | `FollowerCardSheet` class. |
| `TEMPLATE` | Template path (`modules/acks-extras/templates/lib/follower-card.hbs`). |

**Read-only vs editable.** In `editable` mode the template emits `name=` inputs that
submit through the FollowerCardSheet's own form. In read-only mode (embedded in an
employer's hirelings tab) it emits **no `name=` inputs** — they would bind to the
employer's form — only the system's own hireling actions
(`hirelingShow/Loyalty/Morale/Delete`), which resolve the hireling by the
`data-item-id` on the card root.
