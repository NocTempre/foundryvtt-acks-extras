# acks-lib — not built

## Behavioral dedups awaiting a hygiene sweep

The mechanical collapses (MODULE_ID ×11, inline `bracketRow`, hand-rolled
`makeLoc`) are done and validate-enforced. What remains changes behavior or
needs design, so it ships through a dedicated `/acks-hygiene-sweep` with live
verification, not as drive-by edits:

- **A lib dialog helper.** Raw `DialogV2` in ~25 files and 14 separate
  `openXDialog` functions; the loudest missing primitive. Needs a design pass
  over the confirm/prompt/form shapes actually in use (and DialogV2's
  attribute-stripping hazard baked in once).
- **Coin math onto `lib/money.mjs`.** henchmen's `acks-adapter`
  `getGold`/`spendGold`/`grantGold` keep a parallel legacy-sink path; four
  independent copper-total reductions exist. Only two files import
  `lib/money.mjs` today.
- **`classLevel`/`abilityMod` bypasses.** ~25 inline reads with drifting
  fallbacks (`?? 0` vs `?? 1` vs `Math.max(1, …)`) — each replacement must
  decide which fallback was load-bearing.
- **GM detection.** `firstActiveGm` exists twice (sockets.mjs and henchmen's
  adapter, byte-identical) plus ~11 inline `activeGM` checks; validate warns
  on new ones.
- **`collectEffectModifiers` merge.** equipment and henchmen export same-named
  same-shape collectors over `lib/effect-scan.mjs`; the divergence is
  documented as deliberate in effect-scan's header — merging needs that
  ruling revisited, not silently overridden.
- **Chat cards onto `roll-card.mjs`.** Direct `ChatMessage.create` in 32
  files; henchmen has a parallel card layer.
- **Settings registration convention.** Three competing styles (dedicated
  settings.mjs / feature module.mjs / arbitrary file); pick one, document it,
  move the strays.

## What coin does not do yet

- **A unit's pay is listed nowhere.** A paid unit's wage lands on the unit's
  own actor, and neither the group sheet nor the roster shows a purse.
- **The follower card has no join.** Two rows of one kind on a hireling are
  joined from the full sheet, or with `itemModel.joinStacks`.
- **Rows the old paths duplicated.** A drop that copied, and a credit matched
  by name, left some holders with two rows of one kind. Nothing finds them: a
  divided pile is a legitimate state and a check cannot tell the two apart.
- **A spent-out row stays at 0.** A payment that empties a row leaves it
  listed at none, where a hand-over that empties one deletes it.
- **A character with roll automation off.** The encumbrance wrapper belongs to
  that setting, so with it off a character's load counts coin as core does, in
  whole stones.
- **Freight onto a sheet that lists no goods.** Coin is refused there. Other
  freight dragged out of a vehicle is still moved onto it by the vehicles
  feature's own hook.

## What the repair tool only reports

- **Documents the world cannot load.** `lib.strandedCoin` and
  `lib.mergeResidue` list what they find and write nothing. Their fixes wait
  for a scratch world, because no create-and-destroy fixture in the shared test
  world can hold such a document. Designed:
  - stranded coin credited to an actor the Judge picks, with the fixed keys
    kept in a hidden `repairLedger` world setting so that a rescan cannot mint
    the coin twice (the unloadable actor cannot record that it was emptied),
    and a per-check forget;
  - the residue fix deleting what the cleaner macro deletes, but skipping an
    actor that still holds unrecovered coin unless the Judge says otherwise;
  - the cleaner macro becoming a launcher into those two checks, under its
    own id.
- **Region behaviours the retired modules left.** `lib.mergeResidue` reports
  them. The cleaner macro no longer reaches them, and nothing removes them.
- **More checks.** Class-training effects whose class uuid no longer resolves:
  they refuse hand-deletion, and `resetTraining` returns false for them.

## What the hit-point tool does not do

- **Nonlethal damage.** Stop at 0 holds damage at 0, and nothing records which
  damage was nonlethal or lets it heal on its own schedule.
- **An undo that outlives the window.** Undo covers the last change while the
  window is open, and restores values without checking whether anything else
  changed them since.

## Who carries `acks`, and whether that is deliberate

Five surfaces do — the two item sheets (abilities, equipment), the roll editor,
the door app and the follower card — against roughly forty that carry
`acks-ui acks-extras` alone. The sheet theme's field rule is written
`body.acks-lib-sheet-theme .acks .window-content input:not([type="checkbox"])`,
so it dresses core's windows and those five; everywhere else a field takes
Foundry's default chrome inside an ACKS-dressed frame.

**A surface is exposed to that rule exactly when it carries `acks`** — the
cheap test, and the reason the group and template sheets were never in the
fight the follower card lost.

Whether the split is intended has never been ruled. It is not a defect to fix
blind: adding `acks` to a window opts it into every core `.acks` rule at once,
not just the field dressing, so the answer needs a live read of what each
surface would inherit.

## Night Vision reaches through walls

`brightestLightReaching` measures straight-line distance from every lit source to
the token, so a torch on the far side of a closed door counts as reaching it. A
night-eyed creature therefore sees twice a light it could not actually see by.

Resolving it needs real occlusion — `CONFIG.Canvas.polygonBackends.sight`, or a
`ClockwiseSweepPolygon` per candidate source — and that needs the live canvas.
The pass has to answer for every scene in the world, including the ones nobody
has open, so it cannot depend on one being drawn.

What that needs: a split between the sweep (geometry only, every scene) and the
active scene (which may test line of sight), plus a decision about which answer a
token on an undrawn scene should carry in the meantime.

## One automation client, not one automation user

`isPrimaryGM` elects a USER, `game.users.activeGM`, so a Judge with the world
open in two windows runs every primary-GM hook twice. Compare-before-write
hooks shrug that off; a write racing a delete does not. T-0184's console error
at load was one window's party-ownership write landing on an actor the other
window had just deleted. The fix is electing one CLIENT. Core gives two windows
of one user no way to agree, so it needs a handshake of the module's own over
its socket, and a live two-window run proving the loser stays quiet.

## What the conditions do not do yet

The catalogue lists every condition of RR 507-515, and `status-effects.mjs`
applies the rows a roll can see. The rest of each entry is not automated:

- **Rows that wait on a circumstance.** A save against fear, a throw that
  needs sight or hearing, and a save against the source of a condition are
  told to the roller with their figure and not applied. The roll dialog could
  offer each as a tick-box.
- **Damage over time and ability drain.** Burning and Vexed deal nothing on
  their own; Dehydrated, Starving and Hypothermic are driven by `survival.mjs`
  for a marching order and by nothing for a token marked by hand.
- **Size.** Enlarged and Shrunk do not change a creature's size category, its
  extra damage dice, its carrying capacity or its Armor Class. Shrunk's
  halved damage applies to every attack, not only physical ones.
- **Concentration.** Nothing ends a concentrating creature's spell when it is
  struck or moves.
- **Escapes and spell failure.** No throw is offered to slip a hold, and a
  condition that forbids casting only warns on an attack.
- **Monster speed.** The speed share reaches a character's derived speeds
  through `_calculateMovement`; a monster's speed is a stored field and is
  left alone.
- **Core's cards.** A save, an adventuring throw, a morale roll and a surprise
  roll carry the figure in the target or the modifier and name it only in a
  notification.
- **Implied statuses are not on the token.** A slumbering creature is blinded
  for the math, and for the senses' deafness check, but Foundry's own vision
  is blinded only by the Blinded status itself.
- **The Armor Class readout.** `acMath` exists for a sheet to show a
  conditioned AC; no sheet calls it.

## A window title cuts what rises above a capital

On an `acks-ui` root the title is one line of `line-height: 1`
(`vendor/acks-design/foundry.css` § 2) inside a box core gives
`overflow: hidden`, so the box is one em tall and clips at its own edges. At
the default type size an accent over a capital loses its top 2px and a
descender half a pixel. The header is not what cuts them. Core's own title
takes the header's height as its line height and loses nothing. A taller line
changes the title's box on every window, and wants its own before-and-after
reading (TESTING, "A long window title stays on one line").

## A client setting changed while a window is detached

`applyLook`, `applyRootPin` and `applyFontScale` write their pins to the main
page. Core copies the main page's `<html>` and `<body>` attributes into a
detached page as it opens and again at its own interface pass, so a type size,
a theme or a look set in between is missing there until that pass (DECISIONS,
"An element is told by its `nodeType`, never by its constructor", the last
finding). Under the `core` look the dress classes do come off a detached
window, since `applyLook` walks every open application, while the attribute
and the body class the adapter keys on stay as they were in that page. Not
built: the three appliers writing to every open detached page as well. Core's
copy sets each attribute the main element has and removes none (read in its
`copyAttributes`, not measured), so the look and theme pins, which this module
removes to release them, would outlive core's pass in a detached page too.
