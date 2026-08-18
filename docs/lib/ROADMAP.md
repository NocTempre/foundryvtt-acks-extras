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
