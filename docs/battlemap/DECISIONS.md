# Battlemap — decisions

## 2026-08-19 — Scene fields are written directly, no flag mirror

**Ruled:** `applyGridCalibration` writes `width`, `height`, `shiftX`,
`shiftY`, `grid.size` and `grid.distance` straight onto the Scene. Core's own
GridConfig writes exactly this field set, so this is reuse of core's contract,
not an extension — the module's flag records only what core has no field for
(the calibration mark and the `autoScale` gate). The shift is solved off a
preview clone's `getDimensions()` rather than assuming the padding-rounded
rect origin is grid-aligned, so a change to core's rounding degrades to a
correct answer instead of a wrong constant.

**Rejected:** mirroring the written values into flags (two sources of truth
for one number), and a custom "calibrated dimensions" model beside core's
(reuse → extend doctrine).

## 2026-08-19 — Quarter-square quantization with a quarter-square floor

**Ruled:** token spans quantize to 0.25 squares and never drop below 0.25. A
5-ft man on a 100-ft wilderness square is 0.05 squares by arithmetic —
ungrabbable in practice. The floor trades a little geometric truth for a
token a hand can still pick up.

## 2026-08-19 — preCreateToken auto-sizing is opt-in per scene

**Ruled:** the hook only acts on scenes whose `autoScale` flag is set (by the
apply action, or by hand in the scene-config row). On an ordinary uncalibrated
5-ft scene, prototype token sizes are deliberate GM choices; a global
override would fight them on every drop.

**Rejected:** always-on sizing (fights prototypes), and keying on "does
grid.distance differ from 5" (a 10-ft scene the GM configured by hand is not
ours to re-interpret).

## 2026-08-19 — Skew is baked into a corrected image, never simulated

**Ruled:** Scene background TextureData carries only scaleX/scaleY — no
rotation, no shear — so a skewed scan is corrected by rendering the image
through the inverse affine transform into a NEW file (`<name>-aligned.webp`
beside the original, `FilePicker.upload`) and pointing the scene at it. The
original upload is never modified. Declining the bake applies the best
orthogonal approximation and surfaces the residual skew as a warning.

**Rejected:** counter-rotating via a Tile instead of the scene background
(loses fog/vision semantics and every scene-level consumer), and silently
applying the orthogonal approximation without saying so.

## 2026-08-19 — The grid-mode seam: hex and gridless are ruled now, built later

**Ruled:** grid-type-specific behaviour — target scale sets, token sizing,
cell-fill arrangement — sits behind a mode seam: v1 ships the square mode and
`applyGridCalibration` refuses other grid types, while the solver stays
grid-type-agnostic (a hex lattice is the same two-basis-vector fit with a
different cell shape). Ruled for later so the architecture does not preclude
it: **hex** gets its own exploration scale set, tokens that resize and
auto-arrange to fill a hex as occupancy changes, an optional fixed
"slots-per-cell" override, and a show-all button; **gridless** offers the GM
a choice between the square and hex behaviour modes. Staged in ROADMAP.

## 2026-08-19 — Related rulings owned elsewhere

The party token's face-width sizing and the `marchFeetPerBody` setting (with
its ip-doctrine reviewer flag) are formation rulings —
`docs/formation/DECISIONS.md` 2026-08-19. The SIZES footprint structuring
(and its reviewer flag) is a monsters ruling — `docs/monsters/DECISIONS.md`
2026-08-19.

## 2026-08-20 — Verify scene writes by reading back; never emit NaN

**Ruled** (from the first live run, which found both): a Scene update carrying
a non-finite number is dropped WHOLE by schema validation with no exception —
the first build read a field `getDimensions()` does not return (`dims.x`),
sent NaN shifts, and reported success over an unchanged scene. Two guards
now stand: `solveShift` is a pure function that returns null instead of NaN
and has offline tests for every non-finite input, and `applyGridCalibration`
re-reads `grid.size`/`grid.distance` off the document after the write and
reports what is actually there.

**Ruled:** the scene background lives on a Level (`Scene#background` is a
deprecated read-only shim since v14 — reads work, writes are silently
dropped, which the first bake run demonstrated by uploading its corrected
image and then failing to repoint the scene). `scene-image.mjs` owns the
level-aware read/write; no other battlemap file touches the background
directly, and the repoint is read back the same way the apply is.
