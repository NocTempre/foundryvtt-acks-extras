# Battlemap — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server
and driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

## Fixtures

- A disposable scene with any gridded battlemap image as background,
  deliberately misaligned: set `grid.size` wrong and `shiftX/shiftY` nonzero
  so the Foundry grid visibly disagrees with the drawn one.
- A second disposable scene whose background is a stretched (and, for the
  bake path, skewed) copy of the same image — build it once with an image
  editor or a canvas render and upload it to the world's data directory.
- A disposable monster actor with extras size = Large (Classification tab).
- A disposable 3-member formation with its party token on the first scene
  (see `docs/formation/TESTING.md` fixtures for the drop mechanics).
- One disposable plain character actor with a default 1×1 prototype token.

## Drive mechanics (non-obvious)

- The tool is a `button: true` tool on the TOKENS control group — press it
  through the DOM (`document.querySelector('[data-tool="acksBattlemap"]')
  .click()`), which is also the double-fire check: exactly ONE app must open.
- **A scripted `pointerdown` on the canvas needs a hover-in first.** PIXI's
  federated event system drops a bare synthetic `pointerdown` unless a
  `pointerover` + `pointermove` at the same point preceded it — real input
  always carries that, scripted input does not. Without it the overlay's
  handler never fires and no sample is captured, which reads exactly like a
  broken capture layer and is not one.
- The capture overlay swallows canvas pointer events only while a mode is
  armed; scripted sampling can bypass the pointer path by pushing into
  `app.samples.{squares,corners}` (image px) and calling
  `app.onSamplesChanged()` — but finish with at least one REAL drag, since
  the samples list proves the solver, not the pointer plumbing.
- Sample coordinates are IMAGE pixels: convert an intended canvas point via
  the exported `acksExtras.battlemap` helpers or by reading
  `scene.dimensions.sceneX/sceneWidth` against the texture size.
- `app._prepareContext({})` returns the fit panel without rendering — use it
  to assert sizes/residuals, then confirm one value in the real DOM.
- **Verify grid↔image alignment with `round(x / gridSize) * gridSize`**
  against pixel-measured line positions, never with
  `canvas.grid.getTopLeftPoint` — that returns the CONTAINING cell (floor
  semantics), so a perfectly aligned line just past a boundary reads as a
  full-cell residual.

## Steps

1. Open the assistant from the tokens controls.
   *Observable:* the app renders; the scene-config Basics tab separately shows
   the "Battlemap" row with the Calibrate button and autoScale checkbox.
2. Arm "Draw box", drag two boxes over two different drawn cells; arm "Pick
   corners", click three grid intersections several cells apart.
   *Observable:* red rects and blue numbered dots on the canvas; the fit
   panel shows a cell size and a tight/fair residual; the red preview grid
   visibly locks onto the map's drawn lines.
3. Arm "Scale bar", drag along the map's scale bar, type its end-to-end value
   in the app.
   *Observable:* "From scale bar" shows the derived feet-per-box; a chip
   rounds it (e.g. 4.9 → 5).
4. Eraser: arm it and click one sample; then press Wipe.
   *Observable:* the clicked sample vanishes (list and canvas); Wipe empties
   both; Escape and right-click each remove the newest sample while capturing.
5. Re-sample (two boxes + two corners), confirm the box value, leave the
   output square at 1:1, press "Apply grid to scene", confirm the dialog.
   *Observable:* one Scene update — `grid.size`, `shiftX/shiftY`,
   `grid.distance` change and Foundry's grid sits on the drawn one; the
   scene flag `acks-extras.battlemap` reads `{calibrated: true, autoScale:
   true, distance: <D>}`.
6. Drop the Large monster onto the calibrated scene.
   *Observable:* its token lands 2×1 (preCreateToken sized it). Toggle
   autoScale off in scene config and drop again: the token keeps its
   prototype size.
7. Press "Rescale tokens on scene" with the character token and the party
   token present.
   *Observable:* the character token resizes to man-size at the scene's
   scale; the party token is UNTOUCHED by this path.
8. Select two tokens, click the 10' hotbar chip; then "Reset selected".
   *Observable:* both resize and carry `flags.acks-extras.footprint =
   {w:10,h:10}`; reset clears the flag and re-derives (monster back to its
   category, character to man-size).
9. Coarse-map output: confirm the box value as 100, set output square 5.
   *Observable:* the grid-px field re-derives to box/20; after apply, each
   drawn box carries 20 Foundry squares whose lines coincide with the box
   edges, and `grid.distance` is 5. An output of 7.5 shows the
   will-not-coincide warning.
10. On the stretched scene: enable "Independent X / Y", sample boxes and
    corners.
    *Observable:* the fit panel shows two cell sizes; after apply, cells land
    square (the background scales anisotropically).
11. On the skewed scene: enable "Allow skew", click ≥5 corners.
    *Observable:* the fit reports skew/rotation degrees and the preview
    lattice lies on the skewed lines; "Bake corrected image" appears. Press
    it: a `<name>-aligned.webp` appears beside the original, the scene
    background swaps to it, and the retained fit locks onto the new image;
    apply then behaves as step 5. The original image file is unchanged.
12. Formation face width on the calibrated scene: see
    `docs/formation/TESTING.md` step 9 (frontage, heading swap, coarse-scale
    floor).

## Teardown

Delete both scenes, the monster, the character, the party actor (its
formation goes with it), and the baked `-aligned.webp` file. Confirm the
scenes directory and `getFormations()` are clean.
