# Follower Card

The printed ACKS II **Henchman/Follower card** as a compact, theme-styled actor
view. One layout, two surfaces:

- **`FollowerCardSheet`** — a hireling's own sheet (editable essentials), and
- the **read-only cards** the character sheet's hirelings tab is re-skinned into
  (rendered by **acks-henchmen**, which consumes the api below).

## Why it lives here

The card and its default-assignment are the family's **override layer** on the
system's actor sheets, so they live in acks-lib rather than any one domain module.
Hirelings stay core `character`/`monster` actors — a distinct actor type is *not*
viable, because core gates every character derivation (ability mods, AC, encumbrance,
attack throws, rolls) on the literal type string `"character"`, and core is a
read-only reference. So a henchman genuinely *is* a `character` with an employer;
`system.retainer.enabled` already models that, and the card is made its **per-instance
default** via `flags.core.sheetClass` rather than a new type.

## Default-for-retainers

Keyed purely on the core `system.retainer.enabled` flag, so it covers **character and
monster** hirelings alike with no dependency on acks-henchmen:

- `preCreateActor` — an actor born as a retainer gets the flag in its creation source.
- `updateActor` — a plain actor flipped into service adopts the card (drop-as-henchman,
  hires that set the flag). Only the originating client writes, once.
- `ready` GM sweep — existing retainers with no explicit sheet choice adopt the card.

It only ever **sets** the flag when unset — a hand-picked sheet is never clobbered, and
dismissing a hireling does not revert it. PCs and wild monsters
(`retainer.enabled = false`) are untouched.

**Getting out of the card** (everything the card omits — items, effects, deep
monster stats — lives on the full sheet):

- the **Expand / details** header button and a labelled **Full sheet** footer
  link on the card sheet open the full sheet for the session;
- **right-click the actor in the directory** → *Use full sheet* / *Use
  Follower Card sheet* switches the persistent default (the same
  `flags.core.sheetClass` core's Sheet Configuration writes);
- acks-henchmen's Roster app has **Cards for all / Full sheets for all** bulk
  buttons, built on `acksLib.followerCard.setSheet(actor, useCard)`.

**Casters** get a slots strip on the card (per-level used/max, read from
`system.spells`) with the Full sheet link beside it — the spell page itself
(memorize, cast, reset) deliberately stays core's.

## API — `acksLib.followerCard`

| member | purpose |
| --- | --- |
| `context(actor, {editable})` | Build the flat card view model. Branches by `actor.type`; precomputes every derived value in JS (no system Handlebars helper needed). Character shows the six ability boxes and class/level/xp; a monster hides the ability grid and shows HD + its stored AC / attack routine. |
| `render(actor, {editable})` | Render the card to an HTML string (used by the hirelings-tab grid). |
| `Sheet` | `FollowerCardSheet` class. |
| `TEMPLATE` | Template path (`modules/acks-lib/templates/follower-card.hbs`). |

**Read-only vs editable.** In `editable` mode the template emits `name=` inputs that
submit through the FollowerCardSheet's own form. In read-only mode (embedded in an
employer's hirelings tab) it emits **no `name=` inputs** — they would bind to the
employer's form — only the system's own hireling actions
(`hirelingShow/Loyalty/Morale/Delete`), which resolve the hireling by the
`data-item-id` on the card root.
