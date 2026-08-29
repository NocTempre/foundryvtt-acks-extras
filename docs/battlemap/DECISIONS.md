# Battlemap — decisions

## 2026-08-26 — The panel is a window again, dismissed by the toolbar

**Ruled (user):** `BattlemapAssistant` is an `ApplicationV2` window, opened by
entering the Battlemap control group, by its panel tool, or from the
scene-config row, and dismissed by its own close control. The sidebar
registrations are gone.

This supersedes *The panel is a sidebar tab* (2026-08-25). **The new evidence
is the field screenshot:** the docked tab does not behave as the mockups
implied. It stands as a permanent panel under whatever directory the sidebar
is showing, on every scene, for every GM, whether or not a map is being
aligned — the compendium list above it and the calibration controls below it,
in one column. The `off` tool shipped the day before (below) disarms the
canvas but cannot put the panel away, which is what the field report meant by
the tools not turning off: a surface summoned by a toolbar has to be
dismissable by that same toolbar, and a docked tab has no such gesture.

The window is the containment. It carries a frame with a close control and can
be dragged clear of the map, which is all the docking was bought for. Nothing
of the calibration rides on it: the session owns the samples, the armed mode
and the entered values, so opening and closing costs nothing (2026-08-25,
still in force).

**Rejected — closing the window when the control group is left.** It was built
that way first, for the symmetry of one gesture opening and closing the panel,
and the live gate killed it: core drops a LAYERLESS control group back to the
token control on every canvas redraw, and `applyGridCalibration` resizes the
scene, so the apply redrew the canvas and took the panel away the instant its
own result landed. A canvas redraw is not a dismissal gesture, and the panel
is at its most useful just after an apply. Leaving the group still disarms.

One module-level instance, not a fresh app per press: a second press focuses
the panel the GM has already positioned rather than stacking a duplicate on
top of it. The session subscription is held only while the window is open,
because a listener over a closed window re-opens it on the next toolbar press.

**Rejected:** a setting to hide the tab. A toggle in the module settings is
not a gesture at the point of use, and it leaves a permanent surface as the
default for everyone who never finds it.

**Cost:** the panel covers part of the canvas until it is dragged aside, which
is the objection the sidebar answered. It is a drag; the docked tab was not
optional.

## 2026-08-26 — The tool group has a resting state, and Escape leaves

**Ruled:** the `acksBattlemap` control group carries an `off` tool, ordered
first and named as the group's `activeTool`, and Escape disarms. A toolbar
whose every tool arms a canvas interaction has no way to stop: the only exit
was to leave the group, and core remembers the last tool per control
(`SceneControls##tools`), so returning re-armed drawing. Escape previously
deleted the newest sample, so the one key a GM presses to get out destroyed
their work instead. Undo stays on right-click, which was already there.

Disarming from a non-toolbar surface goes through `session.requestDisarm()`,
which selects `off` in the group — but only when that group is already
current, since passing `control` would drag the GM into it from wherever they
were. Core's per-control memory then works in our favour: once off, re-entry
is off.

**Rejected:** a mode tool that toggles itself off on a second press. Arming is
driven from two surfaces and core re-fires `onChange` for the already-active
tool when a group is re-entered — that is what made `arm()` a setter rather
than a toggle (2026-08-25), and a self-toggling tool reintroduces the same
silent disarm.

**Cost:** the group is one tool wider, and a GM who wants to sample must now
pick a mode rather than finding one armed.

## 2026-08-26 — One entered value, one slot

**Ruled:** every GM-entered quantity in the panel has exactly one `opts` slot
and exactly one input named for it; chips are shortcuts that write that slot,
never a parallel store. `test-battlemap.mjs` enforces it statically — each
slot must have an input, each handler write must name a slot, and each input
must be a slot or a session toggle.

The map-square value had two slots: a typed `mapCellFeet` and a chip-written
`confirmFeet` that silently outranked it. The field displayed one number while
the arithmetic used another, and which won depended on what had been touched
last — a field reading 10 under a chip reading 20. `customFeet` was the
mirror failure: a slot and a registered action with no control anywhere, so
the token hotbar's custom size could not be reached at all. Both shipped.

**Rejected:** keeping a separate "confirmed" value distinct from the entered
one. The distinction was real in the design — derive, then confirm — but a
confirmation that lives in a second slot is indistinguishable from a bug.
Derivation now seeds nothing: an entered value wins, a scale bar answers when
nothing is entered.

**Cost:** the scale-bar reading no longer overrides a stale typed value; it is
shown beside the field and the GM presses a chip to take it.

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

## 2026-08-25 — The panel is a sidebar tab, and the preview mesh is deaf

**SUPERSEDED (2026-08-26, above) as to the sidebar tab.** The preview-mesh fix
and the two-parts ruling below still stand.

**Ruled (user, from three mockups):** the calibration panel docks in the
sidebar rather than floating over the canvas. A window sits on top of the very
thing being aligned, which is what the field report meant by a clunky UI; a
sidebar tab never covers the map. `BattlemapAssistant` was REPARENTED onto
`AbstractSidebarTab` rather than duplicated — same template, same handlers,
same session — and registers twice at init: the descriptor in `Sidebar.TABS`
draws the button, the class in `CONFIG.ui` is what `ui[name]` is built from at
startup. A descriptor without a class is a button over nothing.

The windowed form is NOT a second implementation. Right-clicking a sidebar tab
calls Foundry's own `renderPopout`, which clones this class into a framed
application, and the tab's `render` carries the popout with it — so only the
DOCKED instance subscribes to the session, or every change would render the
popout twice. `gmOnly` is the descriptor's own field; `activate()` also
expands a collapsed sidebar, which a bare tab change does not.

**Ruled:** the pinned footer carries the apply. "No obvious way to save the
scale" was a disabled button at the bottom of a long scroll; an action that is
the point of a panel does not go hunting for.

**Ruled:** body and footer are TWO declared parts, not one template with two
roots. A Handlebars part must render exactly one root element — a single part
holding both threw on every render, and because the ordinary tab-click path
never calls `render` itself, the failure was SILENT: the tab looked selected
and the panel area stayed blank. Two parts also give the layout the sibling
structure it needs; a wrapper element would have satisfied the renderer while
nesting the footer inside the scrolling body, losing the pin.

**Fixed, and it is the real "cannot draw more than one box":** `previewMesh`
is added to the overlay AFTER the pointer catcher, so it draws on top of it,
and it was the only child above the catcher never assigned
`eventMode = "none"`. It turns visible the instant a fit exists — the instant
the FIRST sample lands — and from then on swallowed the pointer. First drag
worked, every later one did not. Three live runs reported this and the first
two, this session included, wrote it off as a synthetic-input limitation of
the headless driver; it reproduced identically across three different setups,
which is not what a harness artifact does. Verified against a prediction
rather than an absence: three drags now give sample counts 1, 2, 3.

**Rejected:** keeping the window alongside the tab as a separate class. The
popout is the window, for free, and two view classes over one session is two
things to keep in step.

**Cost:** the tab occupies a permanent slot in the sidebar bar for every GM
running extras, where the window appeared only when opened.


## 2026-08-28 — Terrain paints as regions, and the cell key is the identity

**Ruled:** hex terrain is ONE scene region per terrain kind (its shapes the
painted cells), never a region per hex — a 40-hex forest as forty documents
is an Actors-tab problem wearing a Regions tab. Beside the shapes the region
carries the painted OFFSET KEYS (`terrainHexes`, aligned index-for-index
with `shapes`): erase drops the pair by index, and the journey's
"what terrain is this hex?" is a flag read — exact, and canvas-free, where a
point-in-polygon test needs a rendered placeable and floats.

**Ruled: one terrain per hex.** Painting removes the cell from every other
terrain region first; two regions claiming one cell is a map that answers a
question two ways.

**Ruled:** regions paint with `visibility: ALWAYS` — a hex map's terrain is
the map, not a GM overlay. The Judge who wants hidden terrain has the
region's own visibility control. **Ruled:** hex grids only; a square-grid
scene refuses with a warning rather than approximating cells the grid does
not have. The brush is a battlemap-group TOOL, so Foundry's one-active-tool
rule is the exclusivity with the calibration modes; the palette window only
picks what the brush lays down.

**Rejected:** a PIXI overlay of our own (a second renderer for something
regions already draw, tint, and persist); painting roads (linear features do
not cell-paint; the journey's road picker stays manual until the encounter
work returns to it).

## 2026-08-29 — The terrain vocabulary opens to imported keys

`TERRAIN` was a frozen list of eleven keys and the brush rejected everything
else, so an imported `terrainMultipliers` row for a kind the code did not know
was unreachable — a Judge with an ash waste had nowhere to put it.

Ruling: the brush's vocabulary is the UNION of the shipped structural keys and
whatever keys the imported table carries. Adding a terrain becomes adding a
registry row, which is how everything else in this family extends, and a
world-priority override subtracts one. Colour, which is not a book value,
ships as a default map with a per-row override and a derived hue as the
fallback for an unknown key. A key with no multiplier row still degrades with
a stated reason rather than quietly multiplying by one.

## 2026-08-29 — Mud and snow leave the brush

Both are rows of the printed terrain table, so they are legitimately terrain
keys — but they describe what the weather has LEFT on the ground, and the
footing state machine already derives them each day. Painting them baked a
transient into permanent geography and left two systems holding an opinion
about the same hex.

Ruling: they are withheld from the brush and applied at read time from the
footing alone. They remain valid terrain keys for the multiplier lookup; they
are simply not paintable.

## 2026-08-29 — A hex has sides, corners and centres, and a road is a declared path

Roads and development are geography and were per-day dropdowns. Promoting them
to paint layers is the easy half; the ruling is what a road actually IS.

**A hex is not a single cell for this purpose.** It carries addressable
**sides**, **corners** and a **centre**, and connections are declared between
them. A hex may hold several connection hubs, connected to each other or not —
a bridge and a ford in the same hex need not join.

**A road applies only to travel ALONG a declared path.** Entering a hex that
contains a road earns nothing; following the road through it does. This is
what makes a road network a thing a party can be ON or OFF, which the
navigation rule already depends on (a party following a road does not get
lost).

**A non-straight path carries a route tax.** Following a winding road is
longer in distance than crossing the hex straight, and that cost is explicit:
the road is still usually worth it because its multiplier is better, but the
trade must be visible rather than free. A path also carries its OWN encounter
profile — a road is not the wilderness beside it.

Cost, stated plainly: this is a real topology, not a flag. It is the largest
single piece of modelling in the travel program, and it makes the terrain
brush a route editor as well as a fill tool.

