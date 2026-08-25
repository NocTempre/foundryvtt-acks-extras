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

## 2026-08-24 — Gridless is an INPUT, and the correction squares the cells

**Supersedes the gridless half of the 2026-08-19 seam ruling below.** New
evidence: that ruling treated gridless as a *behaviour mode* to be designed —
"offers the GM a choice between the square and hex behaviour modes" — and
refused the type meanwhile. Walking a real import showed the refusal lands on
the commonest case there is: a scene made from a downloaded map has no grid at
all, so the assistant declined every map it was built for and told the GM their
grid was not square when they had no grid. Gridless as an *input* needs no mode
choice: calibrating IS choosing square. `CALIBRATABLE_GRIDS` holds `{GRIDLESS,
SQUARE}` and the apply writes `grid.type: SQUARE`. The hex half of that ruling
is untouched, and a hex OUTPUT mode remains unbuilt.

**The bake corrects out-of-square cells too.** It straightened skew and
rotation while keeping each axis's own edge length, which left a stretched scan
straight and still oblong — and a scene has one grid size, so the only way to
live with that was a grid whose squares were not square. Skew, rotation and
unequal X/Y are one transform, so they are corrected in one: `A = s·M⁻¹`. `s`
is the LARGER of the two edges, so the short axis is stretched rather than the
long one squeezed — resampling up discards less than resampling down.
**Rejected:** carrying the anisotropy on the scene instead, via the background
TextureData's `scaleX`/`scaleY`. It cannot work — the grid is isotropic, so a
scene stretched to make the image's cells square makes the grid's cells oblong.

**Arming a capture mode is a setter, never a toggle.** 4.22.0 gave the modes
both a toolbar and a mirrored set of panel buttons, and left `arm()` toggling.
Two drivers of one piece of state, each re-firing `onChange` for the tool
already active — re-entering the group did it — meant arming silently disarmed:
the toolbar showed a tool armed and the map ignored every drag, which reads as
a broken capture layer. `arm(mode)` now sets, `arm(null)` disarms, and the
panel's duplicate buttons are gone. The toolbar is the sampling; the panel is
the numbers.

## 2026-08-19 — The grid-mode seam: hex and gridless are ruled now, built later

**Gridless half superseded 2026-08-24** (see above); the hex ruling stands.

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

## 2026-08-20 — Calibration gets a control group; the session owns the state

**Ruled (user):** the capture modes belong in the scene controls, as a
Battlemap group of their own. Each mode arms a canvas interaction, which is
exactly what a scene-control tool models — so Foundry keeps one active at a
time for free, and the armed mode is visible in the toolbar instead of buried
in a window. It also answers the reported symptom, which was that the feature
was an unlabeled icon at the end of the tokens toolbar and nothing announced
it existed.

The group carries **no `layer`**. A `SceneControl` has never required one —
the v14 typedef has no such property, and group activation is DOM plus
callbacks — so a group driving an overlay rather than a placeables layer is a
first-class thing, not a workaround. The first mode is armed on entry so the
group is never a row of dead buttons, and leaving the group disarms, or the
overlay would go on swallowing pointer events under whatever layer the GM
moved to.

**Ruled:** the split is modes in the toolbar, numbers and actions in the
window. The fit residual, the two scale fields, the output square, the apply
buttons and the token hotbar all want a form; arming a mode does not.

**Ruled:** the session (`session.mjs`) owns samples, mode, toggles and entered
values — not the window. Two surfaces now read one calibration, and the state
outliving the window is the better behaviour anyway: closing the panel
mid-calibration keeps the work, where before it discarded every sample. The
window subscribes and re-renders; the toolbar mutates the session.

**Rejected — a shipped macro, or a scene context-menu entry.** Both were on
the table as discoverability fixes and both leave the modes as buttons inside
a dialog, which is the part that was modelled wrongly. A macro would have
added a second way to open a window nobody could find a reason to open.

**Rejected — moving the apply actions onto the toolbar too.** A toolbar tool
is a gesture, not a form; the applies depend on values the GM types and
confirms, and a button that acts on unseen numbers is how the first build
reported success over an unchanged scene (2026-08-20, above).

**Cost:** the family's first module-owned scene-control group, so the left bar
gains an icon for every GM running extras. Accepted as the price of the
feature being findable at all.
