# Map setup revision — plan

**NOT IN EFFECT.** A plan for work not yet built. Nothing here describes the
module as it ships; `MODEL.md` does. When the work lands, its substance moves
into `MODEL.md`, `DECISIONS.md`, `TESTING.md` and the guide, and this file is
deleted in the same session.

Opened 2026-11-15 from a field report the owner agrees with. This file is the
only hand-over between sessions: each phase session reads it, runs its own
agents, appends its results under its phase, corrects the next phase's start
prompt, and reports to the owner.

## 1. The report

The owner's words, 2026-11-15, given as "an example of some of the feedback
I've received and agree with":

> 1. Battlemap setup for hex maps is very unintuitive. I tried to do this with
> scale bar, but it dont work. I tried with corners, abut still dont work. And
> in teh final i tried the Box, but everytime it says that it needs another
> samples, and with another hexes with it still sayas 20% offset or something
> like this, very stressful experience. And "Apply hex grid scene" looks like
> "save changes" button by functionality. THIS IS REAL UX PROBLEMS, not just
> skip it with assumption that i dumb (but i am). Token Size refit
> functionality is still puzzling to me what is this does, because it says it
> is feets. AND very good thing will be that party formation on the wilderness
> automatically set mode to Journey, but this issue not that bad anyway.

And, on how the work is run: "Orchestrate includes managing tasking with
intentional subagent selection".

The owner's answers to §5, the same day, in full:

> 1) Yes, and Anything that is outside scale should get a border (maybe a
> looking glass effect?) to clarify that it is not to scale.
> 2) I don't understand
> 3) Yes
> 4) I noticed a lot of bugs and duplication in the UI
> 5) doesn't matter develop as a brach

## 2. What the live reproduction showed

Walked 2026-11-15 on the GM seat, build 2026.11.14, no other seat joined, on
a new gridless scene (the state of a freshly imported map) with the family set
to hex rows and the units to miles. Samples were geometrically exact hex
bounding boxes and vertices pushed into the session in image pixels; every
figure below was read from `app._prepareContext({})` and the rendered panel.

| Attempt | What the panel showed | Apply |
|---|---|---|
| Scale bar alone | The card reads the measured pixels per mile and nothing else. No warning, no next step. The map-cell field shows the gridless scene's old distance under the new unit, with no chips. | disabled, unexplained |
| Corners alone, one hex's six vertices | A fit of the wrong size, 36.2% loose, with both the one-hex-box warning and the samples-disagree warning. Twelve vertices: 30.8% loose. | disabled |
| One exact box around one hex | 0.0% tight, the right hex size. | enabled |
| A second exact box, same row | 0.0% tight. | enabled |
| A third exact box, next row | **19.7% loose**, with the warning to erase outliers or add better samples. | enabled |
| Five exact boxes over four rows | 30.4% loose, same warning. | enabled |
| One box spanning three hexes of a row, spans set to 3 | The height is divided by three as well as the width; 13.6% loose; the one-hex-box warning. | disabled |

The reporter's "20% offset" is the third-box row: exact samples on two hex
rows cannot agree in the fit as written, and the advice shown makes it worse.

Applying from the single box, with the map-cell field set to 6:

- The confirmation states the hex size, the distance and that the background
  is rescaled and shifted. After it the scene is a hex grid at the entered
  distance in miles and the drawn hex's centre lies 0.13 px from a grid centre.
- The success notification words the result per square, on a hex map, and
  gives the distance no unit.
- The token section's chips read 15840', 31680', 63360', 95040', 126720' and
  190080', under a heading and a custom-size field labelled in feet, with no
  other words. Neither footer button carries a tooltip or a label for
  assistive technology.
- The apply turned the scene's auto-sizing on. A plain character with a
  one-cell prototype token dropped on the map was created at half a cell.
  Pressing the first chip with it selected stamped a 15840-foot footprint
  override on it; the rescale button reported one token rescaled and changed
  nothing to see.
- `acksExtras.formation.travel.inferredTravelSystem(scene)` answers journey,
  from the scale, on the applied scene.

Not exercised: a real pointer drag (samples were pushed), the square and
scale-only families, the hex-columns family, the bake path, a party token
placed on the applied scene, any seat but the GM's.

**The fixture this left**, kept for the phases: a scene carrying
`flags.world.fixture = "battlemap/hex-setup-feedback"`, now a hex grid in
miles, holding one token of the `formation/cadence-member` actor with a
footprint override. A step that needs the gridless start asserts it: the
grid type back to gridless, the grid's size, distance and unit, the scene's
dimensions and shift as a new scene has them, and the module's scene flag
cleared.

## 3. Diagnosis

From an `architect` reading of the code against §2. "Confirmed" is read in the
code; "inferred" is reasoned and wants the probe named.

| Report | Cause | Where | Status |
|---|---|---|---|
| Scale bar "doesn't work" | A fit exists only from boxes or corners, the bar's own conversion needs a fit, and the hex apply needs a one-hex box. The one prompt that asks for a measurement is hidden once a bar exists. | `session.mjs` `fit`; `assistant-app.mjs` `scaleBarFeet`, `#canApply`, `showNoMeasurement` | confirmed; the square family has it too |
| Corners "don't work" | Corners are fitted as points of a rectangular lattice, which a hex's vertices are not, and the hex anchor reads boxes only. The tool and its hint are offered on a hex family all the same. | `calibrate-logic.mjs` `axisObservations`; `assistant-app.mjs` `hexCentre`; `module.mjs` tools | confirmed |
| "Needs other samples … 20% offset" | A box's edges are scored against a lattice whose period is the box's own side. Hex rows repeat every three quarters of a box height and alternate half a width, so boxes on two rows disagree by construction. The apply never reads that phase: the residual scores a model nothing uses, and the warning asks for more of what makes it worse. | `calibrate-logic.mjs` `axisObservations`, `fitGrid`; `apply.mjs` `applyHexCalibration` | confirmed |
| Spans | The count divides both axes of a box. | `calibrate-logic.mjs` `boxCells` | confirmed; the square family has it too (a strip of three) |
| A wrong default distance | With nothing entered the map-cell value falls back to the scene's distance, read in the scene's old unit and shown under the newly chosen one, and the hex apply does not require an entry: the walk's scene would have been written at five miles a hex. | `assistant-app.mjs` `mapCellFeet`, `outputFeet`, `#canApply` | confirmed |
| Apply "looks like save changes" | The footer shows a label and nothing of what the press rewrites; the system and country selects beside it do write as they change, the units select does not. The done notice says "per square" with no unit for every family. | `assistant-foot.hbs`; `assistant-app.mjs` `#submit`; `apply.mjs` | confirmed |
| Token sizes "says it is feet" | The chips are steps of the scene's cell in feet with a prime mark and no words; every apply turns auto-sizing on, whatever the scale. | `assistant-app.mjs` `hotbarFeet`; `apply.mjs` `setupPatch` callers | confirmed |
| A half-cell token, "1 rescaled" every press | The footprint quantises to a quarter cell; core 14 appears to hold a token's width to half-cell steps, so the written quarter reads back as a half and never matches. | `footprint.mjs` `SPAN_STEP`, `SPAN_MIN`; `token-scale.mjs` `changed` | **inferred**: read `TokenDocument.schema.fields.width` live |
| Journey not adopted | Adoption exists on every arrival (`createToken`, the apply's `updateScene`, a teleport's replacement token, the repair check) once a cell is a mile or more, or the scene declares a system. A scene's unit counts as miles only when it is written `mi`, `mile` or `miles` (case and punctuation folded); any other text reads as feet, so a hex scene gridded in core's Scene configuration and left at the default unit infers nothing. A token created while no primary GM is connected does not adopt. | `formation/module.mjs` `createToken`, `updateScene`; `formation/travel.mjs` `inferredTravelSystem`; `lib/distance-units.mjs` `unitKey`, `isExpeditionScale` | **not shown to be a gap**: inference answered journey on the applied scene; a party token there is not walked, and Phase 2's walk decides, a hand-gridded hex scene included |
| Hidden state | "Allow skew" ticked under the square family still selects the affine fit after the family becomes hex, where the box is not shown. | `session.mjs` `fitMode` | confirmed |
| A box of the other family's shape | The size takes the mean of the two axes' votes and the apply scales each axis by itself, so a flat-topped box under rows distorts the image without a word. | `calibrate-logic.mjs` `hexSizeFromBox`; `apply.mjs` | confirmed in code, not walked |
| A bar read across the long axis | The bar's conversion divides by the box sides; a hex's cell distance is centre to centre. | `calibrate-logic.mjs` `feetPerSquare` | confirmed by arithmetic |
| No preview on hex | The fitted-grid preview returns early for every family but square. | `capture.mjs` `drawPreview` | confirmed |
| The even-offset hint | Both parities are one lattice shifted and the apply re-lands the drawn centre either way, so the box most likely changes hex numbering and not the landing. | `hex-fit.mjs` `hexAlignment` | **inferred**: apply both parities from one box and compare |

## 4. The proposal this plan builds

An `architect`'s proposal. The owner has agreed with the report of §1 and has
not yet ruled on this design; §5 holds what is the owner's to decide, and a
phase builds a defaulted answer only where §7 says it may. It is the smallest
change under which each of the three reported attempts either succeeds or is
refused up front, naming the one thing to do instead.

1. **Extra hex boxes feed a hex-lattice fit.** `hexProbe` also answers the
   lattice basis and one hex's vertex offsets, asked of its clone; no hex
   geometry is written down. A pure `fitHexLattice` takes the boxes and that
   basis, assigns each box a lattice cell outward from the anchor, and fits the
   size from box centres once they span two cells on an axis, else from the
   box edges. It answers the hex box, the fitted centre, the centre spacing,
   per-box residuals and flags: `notOneHex` (left out of the fit) and
   `otherFamily`. `hexCentre` becomes the fitted centre. A box's shape is
   judged as it is drawn on the canvas, with the image's own scale divided
   out: §2's exact box is 30.7 by 47.3 in image pixels, because its square
   texture is stretched over a 4:3 scene, and regular on screen. The apply
   keeps scaling each axis by itself, which is what carries that stretch; how
   far a per-axis stretched scan may lean before a box reads as the other
   family is the tolerance Phase 1's review settles.
2. **The hex residual is what the apply uses**: box centres' distance from the
   fitted hex centres, as a share of one hex. One box says that boxes far
   apart refine the size. A loose fit names the worst box. It stays a warning
   and Apply stays enabled (owner 2026-11-14: a Judge gets warnings).
3. **Capture modes on a hex family.** Draw box: as now, with a hex-worded
   hint. Scale bar: allowed, suggests the hex's worth as chips through the
   fitted centre spacing, and says only a box places the hexes. Pick corners:
   refused at the press with a notice naming the box tool, the toolbar back at
   rest; corner samples already held are listed as unused and left out.
4. **Spans are not shown on a hex family**; a box of several hexes is caught
   by its shape.
5. **"What Apply needs"** replaces the bare disabled button: a list under the
   family choice, one line per gap, each naming the one action and where it is.
6. **The map-cell field and the units select share a row.** The field takes
   the scene's own value only when the chosen unit is the scene's; otherwise it
   is blank and the needs list asks for it. Units stay written by the apply.
7. **The footer says what Apply rewrites**, one row per change with units
   (grid, cell worth, the image's rescale and shift and what moves with it,
   token sizing, the system a party takes where none is declared), and the
   confirmation carries the same rows. The button names the act. A scene that
   already matches says so and disables the button. The done notice names the
   family and the unit. `apply.mjs` splits its solve from its write so the
   rows and the write read one answer.
8. **The system and country selects keep writing as they change**, under a
   heading that says so.
9. **Tokens.** Where a cell is a mile or more (`isExpeditionScale`) the
   section is one line saying tokens are not sized to footprints here, and the
   apply leaves auto-sizing off (§5 Q1, answered yes; a token drawn at a size
   that is not its footprint is marked, slice I). Below that scale the
   section says what a footprint is, the chips carry their unit and a tooltip
   of their parts, the whole-scene resize moves in from the footer with a
   tooltip and label naming what it leaves alone, and a line says whether
   tokens placed here are auto-sized.
10. **A hex preview** is drawn from the probe's vertex offsets (§5 Q3,
    answered yes).

Rejected: taking only the first box (discards the Judge's best data);
averaging sizes with no lattice (cannot use distant boxes, and still needs a
lattice to score); hiding the corners tool (the family is session state, the
toolbar would re-render on every change); a bar plus a centre click (a new
capture mode); blocking Apply on a loose fit (the 2026-11-14 ruling); writing
units on change (a unit without its distance flips the scale test).

Doctrine held to in every slice: a hint says what the field or tool does and
never a rule's sentence (`ip-doctrine.md`); the mile threshold is the unit's
definition; every touched figure and glyph control carries a tooltip of its
parts through core's manager, and a refusal's reason is on the panel itself
(`ui-tooltips.md`); the window stays inside the scroll contract with its
footer pinned at a raised type size (`ui-layout.md`).

## 5. Owner questions

Answered 2026-11-15 (§1 has the words):

- **Q1: yes**, and more: a token drawn at a size that is not its footprint at
  the scene's scale is marked as not to scale, with a border or a
  looking-glass effect. Slice C builds the auto-sizing half; the mark is
  slice I, designed in `20261115-map-ui-audit.md` beside this file.
- **Q2: two counts; slice G is in.** First not understood; asked again in
  plainer words the same day, the owner chose: "Two numbers (recommended): “3
  across, 1 down”. Any box shape works." A box on a square grid carries a
  count across and a count down (recorded first in `main`'s
  `20261115-map-ui-audit.md` §1, d72419f8).
- **Q3: yes.** Slice F is in.
- **Q4:** the owner has seen "a lot of bugs and duplication in the UI" and
  named none. An audit of the map tools' surfaces is `20261115-map-ui-audit.md`
  beside this file; Phase 3 builds what it finds (slice J).
- **Q5:** the release kind does not matter yet; the work is developed on a
  branch (§7).
- **Q1's follow-up, 2026-11-15.** Asked "Keep auto-sizing off on a
  mile-scale apply even where the scene had it on?", the owner answered: "Yes,
  write it off". A scene with auto-sizing on that is applied at a mile or more
  a cell has it written off, and the token-sizing row reads before on, after
  off, because of the scale. `planSetup` already answers so and its suite pins
  it (the `wasOn` case); the panel passes the scale test from
  `isExpeditionScale` and never keeps the scene's own on.

The questions as they were asked, each default first:

1. On a map whose cells are a mile or more, does applying leave token
   auto-sizing off? **Yes** (the Scene configuration row can still turn it
   on) / No (every token dropped there shrinks to the smallest size).
2. Does the square family's spans count become two, across and down? **Yes**
   (slice G) / No (the label says it means a square block).
3. Does the hex preview ship in this revision? **Yes** (slice F) / No (a
   ROADMAP row).
4. Is there more feedback beyond the example in §1? It is registered and
   sorted into these phases or a later batch.
5. Which release kind carries this: minor, or held for the next major?

## 6. What the work makes stale

Rulings (`DECISIONS.md`): one new entry, "A hex map is set up from its boxes,
and Apply says what it rewrites", quoting §1 and landing with slice C. It
supersedes in part, each on its In force row with the evidence named:

- 2026-11-13 "The footprint's square is the book's; the assistant's ladders
  are the scene's" (under seven days old): the sentences that an unentered map
  cell is worth the scene's distance and that the size chips are steps of the
  scene's cell in feet. New evidence: the five-mile default and the
  15840'-to-190080' chips of §2.
- 2026-08-19 "preCreateToken auto-sizing is opt-in per scene": the apply turns
  it on only below a mile a cell. Evidence: the half-cell token of §2.
- 2026-08-30 "The right button pans; a sample says what it represents": no
  count on a hex box. Evidence: the three-hex box of §2.
- 2026-08-30 "The tool says what a scene IS": pitched to one hex becomes
  fitted to every box. Evidence: 19.7% loose from three exact boxes.
- 2026-08-19 "Quarter-square quantization with a quarter-square floor", only
  if Phase 2 confirms that core holds a token's width to half-cell steps.

`MODEL.md`: "A hex apply pitches ONE hex…", "The plain ladders are the
scene's", the count clause of "Every field states…", "Token sizing —
ownership" triggers, the `autoScale` bullet, and the Files rows for
`calibrate-logic.mjs`, `capture.mjs`, `assistant-app.mjs` and
`scene-setup.mjs`. `ROADMAP.md` rows 2 and 3 are re-read against what ships.

From a `scout` inventory, 2026-11-15:

- Tests: `tools/test-battlemap.mjs` pins the solver, the footprint and the
  panel's slots (it also reads `session.mjs` and `assistant-app.mjs` as
  text). `tools/importer/test-{scene-binding,region-import,book-adventure}.mjs`
  read the scene flag's keys and move with any change to its shape.
- Live walks: no walk under `tools/live/` reaches the hex apply.
  `battlemap.mjs` covers layers, modes, footprint and country;
  `battlemap-nav.mjs` and `battlemap.mjs` import `session.mjs`.
- Recipe: `TESTING.md` "Steps" 5, 7, 7a, 8, 9, 13, 14, 15 and 17 name the
  apply, the hotbar, the rescale button or the hex box.
- Guide: `docs/guides/battlemap.md` sections "Teaching it the grid",
  "Confirming the scale", "Applying" and "The size hotbar", and its plates
  `v4.27.1/battlemap.png`, `v5.5.0/battlemap-setup.png` and
  `v5.5.0/battlemap-hex.png`. `GALLERY.md`'s row shows the country brush and
  stands.
- Strings: 113 keys under `ACKS-BATTLEMAP`; `samples.empty`,
  `samples.wipeHint` and the top-level `tool` have no reader.
- Styles: `styles/battlemap.css` alone.

## 7. Phases

Each phase is a clean session that orchestrates itself. The owner's word is
"develop as a brach", so the code is written on topic branches, each opened,
landed and closed with the `acks-branch` skill and worked in its sibling
worktree by one writer at a time, committing there by hand
(`.claude/rules/shared-tree.md`, "Topic and parked branches"):

- `topic/map-setup` carries Phases 1 and 2. Phase 1 opens it. Phase 2 builds
  on it, lands it, and then walks it live on `main`, where the walk's fixes
  are written and committed with `acks-commit`.
- `topic/map-setup-panel` carries Phase 3, opened from `main` after that
  landing, landed and walked the same way.
- Phase 4 is written in `main`'s tree: it is the recipe, the plates and the
  docs, all of which need the live world.

The test server serves `main`'s tree, so nothing on a topic branch is walked
before it lands, and no phase repoints the dev junction. While a branch is
open, its worktree's copy of this file is the live one; `main`'s copy is not
edited until the branch lands.

Agent routing is part of
the brief: `implementer` for a scoped slice with its acceptance, one fresh
agent per slice and never two on one file; `architect` for a review that must
not be anchored on the author's reading; `scout` for a lookup; `doc-scribe`
for fragments, index rows and pointer fixes. The phase session itself drives
the live walks in the browser pane, writes `DECISIONS.md` and `MODEL.md`, and
commits after each slice passes `npm test` and `npm run validate`: by hand in
a topic worktree, with `acks-commit` in `main`'s tree. Agents edit with the
Edit and Write tools only, by absolute path in the tree the phase works in. A
slice that changes what a user sees ships a
`changelog.d/` fragment; slices A and B change nothing a user sees and ship
none. Nothing is pushed without the owner's word.

`main` can be released by a peer between landings, so each landing leaves the
panel coherent by itself: nothing half-wired, no string without its reader.

A phase ends by appending its results, correcting the next phase's start
prompt, and putting up the next phase's session as a proposal card (a phase's
closing turn cannot start a session itself); its closing message opens by
saying the card is waiting for the owner's click.

### Phase 1 — the solver and the plan, offline

- **Step 0.** Register §1's reports on the bug-intake ledger
  (`acks-bug-triage`, source `feedback:2026-11-15`), one row per row of §3
  that is a defect, and the two rows of §8, which have no other home once
  this file is deleted.
- **Slice A** (`implementer`): `calibrate-logic.mjs` `fitHexLattice` and the
  bar's conversion through centre spacing; `scene-setup.mjs` `hexProbe`'s
  basis and vertex offsets; `tools/test-battlemap.mjs`. Acceptance: five exact
  boxes over four rows fit under 0.1%; boxes 25 hexes apart with three pixels
  of noise give the size within 0.2%; a three-hex box is `notOneHex`; a
  flat-topped box under rows is `otherFamily`; a bar along either axis of
  either family gives the exact cell worth; one box alone answers its own
  size and centre; and every one of those again on §2's fixture, a square
  texture stretched over a 4:3 scene, where an exact one-hex box must not be
  flagged.
- **Slice B** (`implementer`, alongside A): new
  `scripts/battlemap/setup-plan.mjs` and its test: the what-is-missing list
  for every family and sample combination, the apply's rows, the
  already-matches case, the auto-sizing decision as a parameter.
- **Review** (`architect`, given the two diffs and §2, not this plan's
  conclusions): do the tests' inputs include ones that can fail? Then a
  mutation check of A's suite in a scratch replica.

Start prompt: "Read `docs/battlemap/wip/20261115-map-setup-revision.md` and
run its Phase 1 as that phase's orchestrator: open `topic/map-setup` with the
`acks-branch` skill and work in its worktree; step 0, slices A and B with one
`implementer` each in parallel, then the `architect` review and the mutation
check. Commit each slice by hand in the worktree once `npm test` and
`npm run validate` pass there. Append your results under 'Results — Phase 1',
correct Phase 2's start prompt to what you found, put Phase 2 up as a
proposal card, and report to the owner, opening with the card."

### Phase 2 — wiring and preview, landed, then walked

Slices C and F are written in `topic/map-setup`'s worktree. The branch is
then landed and closed with `acks-branch`, and the walk is on `main`.

- **Slice C** (`implementer`): `session.mjs`, `assistant-app.mjs`,
  `apply.mjs`, `lang/en.json`, `assistant-body.hbs` (the spans input and the
  worst-box line only) and `tools/test-battlemap.mjs` (it reads `session.mjs`
  and `assistant-app.mjs` as text): the lattice fit behind the hex family,
  corners refused, spans gone on hex, the blank cell worth, the solve split
  from the write, the done notice, the affine leak closed, and auto-sizing
  left off by a mile-scale apply (§5 Q1, answered yes).
- **Slice F** (`implementer`, after C; `capture.mjs` alone): the hex preview.
- **Walk** (the phase session, GM seat, on the §2 fixture reset to gridless,
  and on a hex-columns scene): with **real pointer drags**, the three reported
  attempts in the reporter's order; five boxes over four rows read tight or
  fair with no box unreachable, their `rmsPx` recorded (Phase 1's results:
  the bands are image px against hand accuracy, and a fit of fewer than three
  boxes is never tight); the live `hexProbe` (`refW`, `refH`, `basis`,
  `vertices`, all four hex types) compared with the test mock; one token's
  and one wall's position read before and after a hex apply; the notice's
  wording; a one-cell token dropped after a mile-scale apply keeps
  its size; a party token placed there takes Journey with the scale notice;
  both parities applied from one box; `TokenDocument.schema.fields.width`
  read for the half-cell question; `init`, `setup` and `ready` clean on a
  recorder attached before load.
- The `DECISIONS.md` entry of §6 and `TESTING.md`'s changed steps land here.

Start prompt: "Read `docs/battlemap/wip/20261115-map-setup-revision.md`,
in `topic/map-setup`'s worktree (`<repo>.map-setup`, the branch at a343e518
or later) and including Phase 1's results, and run its Phase 2 as that
phase's orchestrator: slice C, then slice F, one fresh `implementer` each,
committed by hand in the worktree; land and close the branch with the
`acks-branch` skill; then walk it live yourself on `main` per
`.claude/rules/live-testing.md` and `docs/battlemap/TESTING.md`, committing
the walk's fixes with `acks-commit`. Slice C's brief carries, from Phase 1's
results: `fitHexLattice`'s output contract as committed (per-box
`notOneHex`/`unreachable`, fit-level `warnings`, `rmsPx`, `worst` null below
three boxes or on a tight fit; no per-box `otherFamily`), fed with `hexProbe`
for BOTH hex families (`otherProbe`) and with `scale` as canvas px per image
px on each axis, which the caller computes and a test pins, since a 4:3
stretch is exactly the ratio between the families; the bar's worth through
`unitsPerCentreSpacing`; `planSetup`'s needs, unused, warnings and rows,
with `expeditionScale` computed by the caller through `isExpeditionScale` from
the solution's distance and unit and pinned by a test (six miles leaves
auto-sizing off, five feet turns it on); a loose-fit line that reads without a
box name when `worst` is null; the unreachable count and the family warnings
shown on the worst-box line's slot in `assistant-body.hbs`, so a box left
out never vanishes without a word before Phase 3's needs list; and no wording that says placed tokens, tiles
or walls move with the image, which they do not (no apply passes
`autoReposition`; `20261115-map-ui-audit.md` §3 finding 1 on `main`). The
walk adds Phase 1's items: the live probe against the test mock, a token's
and a wall's position across a hex apply, `rmsPx` of real drags, and what the
panel says for a lone box drawn around several hexes (Phase 1 found it is
taken as one hex, with only a shape warning). Append 'Results — Phase 2'
sorted into exercised live, offline only and not checked, correct Phase 3's
start prompt, put Phase 3 up as a proposal card, and report to the owner,
opening with the card."

### Phase 3 — the panel's surface, the tokens, and the audit's findings

Written in `topic/map-setup-panel`'s worktree, opened from `main` after
Phase 2's landing; landed, closed and then walked on `main`. Before slice D
is briefed, the phase session walks the map tools' surfaces on `main` once
(the Battlemap group's tools, the setup window, the brush palette, the Map
modes window, the Scene configuration row, the navigation card's icon) and
adds what it sees to `20261115-map-ui-audit.md`'s list: that file was written
from the code, and the owner's report is of what is on screen.

- **Slice D** (`implementer`): `assistant-body.hbs`, `assistant-foot.hbs`,
  `styles/battlemap.css`, `lang/en.json`, `assistant-app.mjs` (context only):
  the needs list, the cell-and-units row, the "saved as you choose" heading,
  the footer's rows, labels and tooltips.
- **Slice E** (`implementer`, after D, same files): the token section of
  proposal 9. Phase 2 refuted the half-cell cause: core 14 stores a quarter
  width. So T-0583's "1 rescaled every press" is diagnosed again first
  (`architect`, read-only) before any fix in `footprint.mjs` or
  `token-scale.mjs`. The lead: an immediate read after `await update`
  returned the old width live.
- **Slice G** (`implementer`, after E, only on a yes to §5 Q2).
- **Slice I** (`implementer`): the not-to-scale mark, to the design in
  `20261115-map-ui-audit.md`.
- **Slice J** (one `implementer` per file group, never two on one file): the
  audit's in-scope findings, in the order that file gives them.
- **Walk** (the phase session): the flow of §4 read top to bottom by someone
  who has not seen the panel; the footer pinned at a raised type size and in
  a short window; every figure hovered against its parts; the square and
  scale-only families' needs lists; a player seat is offered nothing.

Start prompt: "Read `docs/battlemap/wip/20261115-map-setup-revision.md`,
and `docs/battlemap/wip/20261115-map-ui-audit.md`, including the earlier
phases' results and the owner's answers in §5, and run its Phase 3 as that
phase's orchestrator: the surface walk on `main`, then open
`topic/map-setup-panel` from `main` at f06cbec0 or later with the
`acks-branch` skill and build slices D, E, (G where §5 says so,) I and J in
its worktree, one fresh `implementer` each, committed by hand there; land and
close the branch; then the walk on `main`, including
`.claude/rules/ui-layout.md`'s eye checks and
`.claude/rules/ui-tooltips.md`'s hover pass. `topic/map-setup` is closed.
Phase 2's 'Found on the walk' list goes into slices D, E and J's briefs. D's
footer rows name the auto-sizing write; D's needs list also covers a lone box
around several hexes reading fair with Apply on (T-0592). E starts from
T-0583's re-diagnosis, not a footprint quantum. T-0584 (Journey) worked
live on a mile scene: dispose it as `false-report` or `docs-only`, asking the
owner once whether a guide line would have prevented it. The hex walk uses
the kept scenes `battlemap/hex-setup-feedback` and `battlemap/hex-cols-setup`
(`docs/battlemap/TESTING.md` steps 14 and 14a). Append 'Results — Phase 3',
correct Phase 4's start prompt, put Phase 4 up as a proposal card, and report
to the owner, opening with the card."

### Phase 3J — the audit's findings (split from Phase 3)

Phase 3 built D, E, G and I and walked them. J was split off, for the reasons
in 'Results — Phase 3'. It is written in the still-open
`topic/map-setup-panel` worktree, which is synced with `main` first.

Start prompt: "Read `docs/battlemap/wip/20261115-map-setup-revision.md`
(with 'Results — Phase 3') and `docs/battlemap/wip/20261115-map-ui-audit.md`,
and run Phase 3J as its orchestrator.
- Before any edit, sync `topic/map-setup-panel` with `acks-branch sync
  map-setup-panel` in `C:\Proj\foundryvtt-acks-extras.map-setup-panel`.
  `main` holds c7b403da's footer and footprint fixes.
- Defects first, from the audit's J list: 3, 4's remainder, 5, 6 and 17.
  Then the ledger rows T-0608 to T-0615, which Phase 3 registered for this
  batch. Each slice is one fresh `implementer`, never two on one file, and
  is committed by hand in the worktree once `npm test` and
  `npm run validate` pass.
- Finding 1 (auto-repositioning) contradicts step 14's 'stay where they
  are'. Put it to `architect`, and to the owner if it reverses a ruling,
  before anyone builds it.
- Finding 31's name ('Map setup') is a proposal. Ask the owner once before
  renaming.
- Land and close the branch. Walk J on `main` per
  `.claude/rules/live-testing.md` and `docs/battlemap/TESTING.md`, with
  `ui-layout.md`'s eye checks and `ui-tooltips.md`'s hover pass. Commit the
  walk's fixes with `acks-commit`.
- Append 'Results — Phase 3J', sorted into exercised live, offline only and
  not checked. Put Phase 4 up as a proposal card and report to the owner,
  opening with the card."

### Phase 4 — the recipe, the guide, the plates, and the close

- `tools/live/battlemap.mjs` gains a part that walks the hex setup
  (`implementer`); `TESTING.md` names it.
- `MODEL.md`'s stale paragraphs (§6) are rewritten from the code by the phase
  session; `docs/guides/battlemap.md`'s four sections follow, each control
  with its path (`doc-scribe` for the pointer and index fixes).
- The three stale plates are retaken from a map a user can produce: a scene
  whose background is a drawn hex map, set up through the panel.
- The three unread strings go; `ROADMAP.md` is re-read; this file's substance
  is in its permanent homes and the file is deleted.
- The owner is asked the release kind if §5 Q5 is still open.

Start prompt: "Read `docs/battlemap/wip/20261115-map-setup-revision.md` with
all its results (Phase 3J's included) and
`docs/battlemap/wip/20261115-map-ui-audit.md`, and run its Phase 4 as that
phase's orchestrator, once Phase 3J has landed and closed
`topic/map-setup-panel`.
- The guide's Token sizes section and Applying intro, and MODEL's token rows,
  were brought to slice E in Phase 3. Re-read them against the code rather
  than rewriting them.
- The plates must show the mark (slice I) and the footer's rows (slice D).
  Shoot them from a scene set up through the panel, with the pane on screen.
  A hidden pane freezes core's ticker and its shots.
- Move what this file and the audit file still hold into `MODEL.md`,
  `DECISIONS.md`, `TESTING.md`, `ROADMAP.md` and the guide. Delete both
  files.
- Report to the owner with the release question."

## 8. Registered, not in scope

- The country brush is offered on a scene that is not a hex grid and refuses
  only at the first click.
- The square family's loose-fit warning names no sample.

## Results

### Results — Phase 1

Run 2026-11-15 in `topic/map-setup`'s worktree, opened at 98cf65cf. Four
commits, none pushed or landed:

| Commit | Slice | What |
|---|---|---|
| 793fddfe | A | `fitHexLattice`, `unitsPerCentreSpacing`, `hexProbe` gains `basis` and `vertices` |
| eb7db213 | B | `setup-plan.mjs` `planSetup`, `resolveCellWorth`, and their suite |
| 4546de08 | A2 | the fit brought to the review's ruling (below) |
| a343e518 | B2 | the planner on the fit's real output; `moves: true` dropped |

A2 and B2 exist because the review found that A's tests could not fail
where the report lives (below). §7's slice list is unchanged; the fix took
one round.

**Ledger (step 0).** T-0576 to T-0591, source `feedback:2026-11-15`; no
earlier row matched. T-0576 to T-0589 are §3's rows, claimed
`2026-11-15 topic/map-setup`; T-0583 (the half cell), T-0584 (Journey) and
T-0589 (the even offset) carry their §3 status, inferred or not shown, in
their notes. T-0590 and T-0591 are §8's two rows, left `new`.

#### Checked offline

- **Gates.** `npm test` printed "229 committed suite(s)", exit 0, on the
  trees of eb7db213, 4546de08 and a343e518 in the worktree, and "228" on
  793fddfe alone in a replica built by `git archive`. `npm run validate`
  printed "validate: scripts, templates, JSON, packs, module.json, i18n, and
  namespacing OK", exit 0, on the same four. `test-battlemap-setup-plan`
  printed "OK (53 tests …)" at eb7db213 and "OK (83 tests …)" at a343e518.
- **The fixture is the walk's.** Today's `fitGrid` run over the test's
  stretched boxes (a square texture over a 4:3 scene, the exact box 30.7 by
  47.3 image px) reads three boxes over two rows 19.71% loose and five over
  four rows 30.44% loose, which is §2's figures. On an unstretched image the
  same boxes read 18.4% and 25.8%, so the control depends on the fixture.
- **The hex mock is core's.** Compared with core 14's `HexagonalGrid`
  (`common/grid/hexagonal.mjs` of the desktop install): `sizeX`, `sizeY`,
  `getCenterPoint` and `getVertices` for all four hex types agree on 3592
  numbers in the author's check and on 24216 in the reviewer's, with the
  largest difference 2.3e-13.
- **Review verdict** (`architect`, given the diffs and §2 only). Q1, whether
  a wrong implementation could pass: weak. Every fixture had exact box sizes,
  so a size read off the edges was already right and assignment could not go
  wrong. Q2, the stretch: sound, with one gap, `scale.y` never other than 1.
  Q3, the shape tolerance: the wrong instrument at the walk's size; a fixed
  aspect gate rejects about a quarter of honest 31 px boxes, and with each
  axis free the centres of pointy rows and flat columns are one point set.
  Q4, the 1% small-hex bound: fair for that noise model, but the fit dropped
  the edges where the span is short. Q5, the planner: weak; the review lists
  nine surviving mutants of the 21 it ran, and `moves: true` was a constant
  asserted as behaviour.
  Reproduced on 793fddfe from the reviewer's probes: the walk's five boxes
  on the small hex under ±3 px of position noise read the size p95 35.8%,
  max 44.1% wrong (rows), and the anchor 0.2 hex off reads it 44.8% wrong.
- **The ruling A2 builds** (a second `architect`, asked for exact numbers).
  Hand accuracy `HAND_PX` 3 image px per edge. Each axis fits every placed
  box's edges with its centre, and boxes not yet placed lend their sides. A
  box whose node cannot be pinned within half a centre spacing at `REACH_Z`
  3.5 is `unreachable` and left out. The family is decided from the other
  family's fit once three boxes span both axes. Otherwise it is the set's
  mean proportion at `FAMILY_Z` 2. Either way it is a warning, and the
  Judge's family stands. Shape is a plausibility bound only (`HEX_SHAPE_LEAN`
  0.12 plus a hand allowance), and the size consensus is a symmetric log
  ratio. Confidence is the edge residual in px: `TIGHT_PX` 2.5, `FAIR_PX` 6.
  Fewer than three boxes is never tight.
- **A2's acceptance**, 400 seeds by four hex types, measured max against the
  ruled bound, all met: the walk's five on the small hex 5.90% under edge
  noise (6.5%) and 6.31% under position noise (7.0%); the same at 150 px
  1.29% (1.5%); a diagonal pair on the small hex 18.73% under edge noise
  (20.5%); the anchor 0.2 hex off 10.82% on the small hex (12%); a ladder at
  0, 1, 3, 8 and 25 hexes on the small hex 8.11% (9%), its far rung
  unreachable until a rung at 16 is added; the committed far set at 150 px
  0.16% (0.2%). The far pair drawn 4% oversize, which read tight on the wrong
  hex, is unreachable. A pointy map stretched 1.25 times fitted as columns
  reads `familyMismatch` and loose.
- **Mutation check of A's suite**, single edits in a replica outside both
  trees. On 793fddfe: 19 edits, 12 killed, 7 survived. The survivors were a
  narrow shape lean, a narrow size spread, plain rounding, a residual off
  one axis, the RMS without its root, `worst` always named, and no
  reassignment pass. On 4546de08, with a table rewritten for the new code:
  26 edits, 24 killed, 2 survived. The survivors are the nearest-first sort,
  near-redundant since the reach loop takes the first reachable box, and the
  reassignment pass, which the ruling measured moving no node. Six edits to
  the constants were run again with the test that reads the constants back
  removed, and all six were still killed.
- **B2 against the real fit.** The planner now takes the fit's answer as
  produced. A lone three-hex strip is the one-hex need. A box 3 px off every
  edge is used. The far pair is an `unreachable` warning with Apply on. The
  stretched map as columns is a `familyMismatch` warning with Apply on.

#### Not checked

- Nothing is wired and nothing was walked; that is Phase 2.
- ±3 px of hand accuracy is an assumption about image px. A Judge drags in
  screen px at some zoom, and §2's samples were pushed, not dragged.
- The mock is checked against core's source, not against a live clone's
  probe; Phase 2's walk compares them.
- The caller that computes `scale` does not exist yet.
- The planner's suite was not mutation-checked after B2 (the task named A's).
- The reviewer's own mutation scripts target 793fddfe and were not re-run;
  A2's implementer ran its own table on 4546de08 (11 killed, the
  reassignment pass surviving), and the table above is independent of it.

#### Where these results overrule §2 and §4

- §4 item 1's per-box `otherFamily` flag does not exist. The family is a
  fit-level warning, and the Judge's family and boxes stand.
- §4 item 2's hint that "boxes far apart refine the size" is wrong at the
  reporter's hex size. At 30.7 px a box 25 hexes out is unreachable even
  when drawn exactly, until boxes step out to it (a rung at 16 reaches 25).
  The hint the panel gives is to add boxes between.
- One box alone (§2's attempt 3) now reads fair, never tight, and on the
  small hex it usually carries `familyAmbiguous`. §2's "0.0% tight" was
  today's fit.
- Where §4 and these results disagree, these results stand.

#### Not settled (found, recorded, not fixed)

Registered as T-0592 (the lone block), T-0593 (the far box one hex short),
T-0594 (the stretched canvas with no spread) and T-0595 (the respelled unit),
source `derived:T-0578`, status `new`.

- A lone real 2×2 hex block is taken as one hex 3.75 times too large, with
  only a shape-based `familyMismatch` warning. One box alone cannot show its
  own size; with one-hex companions the size consensus leaves blocks out.
- Several boxes sharing one outline bias, with a far box beyond them: on the
  column types the far box lands one hex short. It reads fair or loose,
  never tight. A bias term that closes it refuses the committed far set.
- At the small hex a tight fit is not always an accurate one: the anchor 0.2
  hex off reaches 10.8% with some runs tight.
- A stretched canvas with no spread on both axes leaves the family to the
  shape fallback, which is wrong for pointy rows stretched 1.25 times with
  one or two boxes or one row.
- At the small hex one honest box draws `familyAmbiguous` in 147 to 200 of
  200 runs, so the panel's wording for it matters (slice D).
- The planner reads a unit respelled (`Miles` to `mi`) as unchanged, so a
  scene can read as matching while an apply would still rewrite the unit's
  spelling. A mile-scale apply writes auto-sizing off even where the scene
  had it on. That is read as "leaves it off"; Phase 2 can confirm it against
  §5 Q1.

The probes, the two rulings, the diffs, the mutation tables and every log
quoted above are kept outside the repo in the session family's shared notes
folder, `%APPDATA%\Claude\side-session-notes\local_6a0ea1de-306e-410c-893c-53ad4db2e8f3\phase1-evidence\`.

### Results — Phase 2

Run 2026-11-15. Slices C and F, and C2 (what an `architect` review of C
found), were committed by hand in `topic/map-setup`'s worktree. The branch
was landed on `main` with `acks-branch` (rebased, gated, fast-forwarded from
78fc4bf1) and closed after the walk. The walk's fixes were committed on
`main` with `acks-commit`. Nothing is pushed.

| Commit on `main` | Slice | What |
|---|---|---|
| ec5b05c4 | C | the lattice fit behind the hex family, corners refused, no spans on hex, the blank cell worth, the solve split from the write, the done notice, the affine leak closed, auto-sizing off at a mile or more |
| 33005dd6 | F | the hex preview (`hexPreviewOutlines`, capped at `HEX_PREVIEW_MAX` 3000) |
| 78893b8d | docs | DECISIONS entry, In force rows qualified, §5's "Yes, write it off" |
| 8f5e9b32 | C2 | `tools/test-battlemap-panel.mjs` runs the real panel; spans back on scale-only; the shown solve follows a flag-only scene update |
| f06cbec0 | walk | the Even offset hint and guide line, "1 box", the placeholder rounded, `TESTING.md` steps 14, 14a and 15 |

C's commit message names T-0579, T-0581 and T-0582. C fixes them only in
part; their remainder belongs to slices G, D and E (below).

**Ledger.** `fixed-unreleased`, sha in the notes: T-0576, T-0577, T-0578,
T-0580, T-0585, T-0586, T-0587, T-0588 and T-0589. Still `claimed`, re-claimed
`2026-11-15 map-setup Phase 3`, with this walk's evidence in the notes:
T-0579, T-0581, T-0582, T-0583 and T-0584. T-0592 stays `new`, confirmed
live.

#### Exercised live

GM seat, the pane at 1366×768, on `battlemap/hex-setup-feedback` (rows, a
square image stretched over a 4:3 scene) and `battlemap/hex-cols-setup`
(columns, built this walk). Both carry generated maps with drawn hexes; the
§2 parchment has none, so a fit there proves nothing.

- **The reporter's three attempts, in order, with real drags.** A bar alone:
  Apply disabled, and the line under it says a bar does not place hexes and
  names "Draw box". "Pick corners": refused with a notice naming "Draw box".
  Boxes: three over two rows read tight at 0.75 px, five over four rows at
  0.70 px. Hex columns: five boxes, tight at 1.0 px (80.1 × 69.1 against the
  true 80 × 69.28).
- **The live probe against the test mock.** `hexProbe` from the scene's clone
  for types 2–5 against `coreHexGrid`: 18 numbers per type (`refW`, `refH`,
  `basis`, six vertices), largest difference 2.8e-14.
- **A hex apply, confirmed through the dialog's real Yes.** At 6 mi:
  `grid.type` 2, size 51. The token at 780,623 and the wall
  [700,500,900,500] were unmoved, as the confirmation now says. The notice
  read "Hex grid applied: 51 px hexes, 6 mi per hex." The flag read
  `autoScale: false`. Every drawn hex centre (1254) mapped through the
  background sprite lies in its own Foundry hex. The farthest, 32 rows from
  the boxes, is 4.5 px from its grid centre, the residue of the scene's
  integer size. Columns: type 4, size 69, 442 hexes, max 2.5 px, rms 1.35.
- **Both parities from one box.** Type 2, then type 3: the box's hex is 1.65
  and 1.49 px from a grid centre. The flip moves the background half a hex
  and renumbers the hexes. §3's inference holds, and T-0589 is fixed in
  f06cbec0.
- **The mile-scale drop.** A one-cell character dropped through core's
  `_onDropActorData` after the 6 mi apply stays 1 × 1.
- **Journey.** A party actor dropped on the applied scene took Wilderness,
  with the notice naming the scale as the reason. With the party already on
  the scene, units `ft` → delve → `mi` switched it back, with the same
  notice. A scene at `ft` infers nothing, by design. T-0584 is not a gap on
  a mile scene.
- **`TokenDocument.schema.fields.width`** is a `NumberField`, positive,
  `integer: false`, with no step. On the hex scene a write of 0.25, 0.75 or
  0.3 reads back exactly once the update has settled (`animate: false`, then
  a wait). An immediate read after `await update` returned the old width.
  Core's 0.5 rounding is in `getSnappedPosition`, not the schema. §3's
  half-cell cause is refuted (T-0583).
- **A lone box around a 2×2 block** reads fair, as one hex 2.5 times too
  large (75.8 × 81.5), with only the other-family warning. Apply is enabled,
  and the bar then converts to 14.82 mi a hex. T-0592, confirmed.
- **The preview** draws on both scenes' drawn hexes.
- **Console.** After a real `location.reload()`, the pane's console buffer
  holds this load from core's "Initializing Foundry Virtual Tabletop Game",
  then `acks-extras | Initializing` (init) and the ruledata provider's ready
  line. It has no error-level entry. The buffer is the pane's CDP capture,
  attached across the reload, not the capture driver.
- **The walk's fixes**, re-read live after a reload: the new hint text, "1
  box · scale bar", and the placeholder 3.93 where it printed the raw
  quotient.

Fixture ledger: built `Scene.O9jMQk3EOUPYTE5S`, marker
`battlemap/hex-cols-setup`, kept. Built and swept: two tokens on
`CBskaS5AQcGHmjYf`, removed `[…Token.8V9pgg4nvD7TFSSI, …Token.xJd8qvOgyDHtw9OZ]`,
could not find `[]`, refused `[]`. The kept formation `formation/cadence-party`
is left in `journey`.

#### Checked offline only

- `npm test` "230 committed suite(s)" and `npm run validate` OK, on C2's tree
  and again on the landing's tip under the lease. f06cbec0's gate in a clone:
  build:packs 2 s, test 169 s, validate 698 s, green.
- The review's 26 mutants on C's tree: 22 survived. On C2's tree, with the
  panel suite: 24 killed. S6 (parity) and P1 (a unit key equal to its
  abbreviation) are equivalent.
- T-0585 (the affine leak) and T-0587 (the bar through centre spacing) are
  pinned by tests. The bar read 6.02 mi a hex live, but no bar was laid
  across the long axis.

#### Not checked

- A player seat. Tiles across an apply (the fixture has none).
- The preview following a family or parity switch, and its cost at its cap.
  The largest scene walked held about 1300 hexes.
- `ui-layout`'s eye checks and the hover pass: Phase 3's walk.

#### Found on the walk, for Phase 3

- The confirmation does not name the auto-sizing write a mile-scale apply
  makes; the footer's rows (slice D) should.
- The confirmation's placeables sentence shows on a scene with nothing
  placed. "Hexes 69 px across" on columns is flat to flat.
- After a 6 mi apply the token chips read 15840' to 190080' (T-0582,
  slice E).
- The delete-sample × has a `data-tooltip` and no accessible name: `find`
  by its label returns nothing. The panel's selects are named by their value,
  not their label (slice J).
- The body loses its scroll on every delete (the audit's finding 2).
- Each apply drops the Battlemap control group (known, `TESTING.md`), so
  "Draw box" must be re-armed for the next box.

### Results — Phase 3

Run 2026-11-15 and 2026-11-16. The surface walk ran on `main` first, and what
it saw went into the audit file (8abf3108, findings 32 to 37). Slices D, E, G
and I were built in `topic/map-setup-panel`'s worktree, one fresh
`implementer` each, and committed there by hand once `npm test` and
`npm run validate` passed. T-0583 was diagnosed again by `architect` before E
was briefed. The branch was landed with `acks-branch`: rebased, gated green on
ede09328 under the lease, then `main` fast-forwarded from 03abcc78. It stays
open for J (below). The walk's fixes were committed on `main` with
`acks-commit`. Nothing is pushed.

| Commit on `main` | Slice | What |
|---|---|---|
| 8abf3108 | surface walk | the audit takes what the screen showed: 32 (a hex scene cannot be set up as square), 33 (three windows on one spot), 34 (the country block splits the setup), 35 (a reopened applied scene reads as fresh), 36 (31×47 px against 30.7 × 47.3), 37 (whole-cell chips at a mile-scale cell); the proposed window name "Map setup"; T-0599 to T-0607 for its later batch |
| 29c02bb7 | D | the needs list, the cell-and-units row, "saved as you choose", the footer's rows naming what Apply rewrites (the auto-sizing write included), the dialog repeating them, a lone box reading as the other family (`familyMismatchLone`), and the way out of a hex scene for a square fit |
| aad8121f | E | the token section in feet, the rescale moved into it, one line at a mile or more a cell, and the rescale comparing `_source` and counting real writes |
| 221fd613 | G | a box counts across and down (owner: "Two numbers (recommended): “3 across, 1 down”. Any box shape works.") |
| 69809285 | docs | DECISIONS: the two box counts; the panel's surface and the token section |
| bbf0deaa | I | the not-to-scale mark: a looking-glass rim and handle (owner: "Anything that is outside scale should get a border (maybe a looking glass effect?)"), a hover readout, a client setting to turn it off |
| ede09328 | docs | DECISIONS: the mark |
| c7b403da | walk | the footer capped at `max(45%, 9em)` so a short window at a raised type size keeps its body; a party actor's token is never judged by footprint (its shadow had a mark) |

D's commit message cites T-0579 where it means T-0581 (and T-0592 in part).
It was not amended: that is a history rewrite, and those wait for the owner.

**T-0583's diagnosis.** `architect`, then a live probe. `changed` read the
prepared width, which core's token animation merges into the document frame
by frame; frame 0 runs synchronously. The count was attempts, and a no-op
size write is not dropped, because movement forces `diff: false`. Live, with
the pane's ticker frozen: a settled 0.5 token rescaled twice gave 0, 0. Set to
1 × 1, three rescales gave 1, 1, 1, with `_source` 0.5 and the prepared width
1. After 90 driven frames the prepared width was 0.5, and a rescale gave 0.
So the reported "1 every press" was a walk artifact sitting on a real compare
bug. E fixes the compare. "Created at half a cell" was not confirmed and
nothing is built on it.

**Slice J is not built in this session.** The audit's in-scope findings
are 1, 3–6, 17 and the rest of its J1 list. They touch the same panel files
as D, E and I, one `implementer` per file group, and finding 1
(auto-repositioning) needs a ruling first: its acceptance contradicts step 14
("Tokens, tiles and walls stay where they are"). E absorbed J1's findings 4,
11's ↺ and ✓, 13 and 15. J runs as its own session in the open worktree
(start prompt below). Phase 4 follows it.

**Ledger.** Marked `fixed-unreleased`, with shas and walk evidence in the
notes: T-0579 (G), T-0581 (D), T-0582 (E), T-0583 (E), and T-0592 in part
(D: the line names the cause and the cure; one box alone still cannot tell a
block from a hex). T-0616 (the shadow's mark) is registered fixed in
c7b403da. T-0584 stays `claimed`, waiting on the owner's answer (below).

New rows for the J batch:
- T-0608: an anchor tie keeps a multi-hex box drawn before an honest one.
- T-0609: audit 35's part left (a bare reopen shows nothing of the applied
  grid).
- T-0610: the `familyAmbiguous` wording with two boxes in one row.
- T-0611: the travel-system row is all but unreachable.
- T-0612: the done notice's "px hexes".
- T-0613: "Now No grid" capitalised mid-sentence.
- T-0614: audit 37, not built.
- T-0615: three figures without a tooltip.

**T-0584 (Journey).** Phase 2's walk showed a party dropped on a mile scene
takes Journey with a notice. A scene at `ft` infers nothing, by design. It
is not a code gap. Whether it is `false-report` or `docs-only` turns on one
question to the owner: would a guide line (journey mode is taken
automatically once a scene's cell is a mile or more) have prevented the
report?

#### Exercised live

The GM seat, in the pane at 1366 × 768. The pane was hidden for part of the
walk, so core's ticker was frozen. Where a check reads render state, the
ticker was stepped by hand: `canvas.app.ticker.update` for 90 to 120 frames.
Kept scenes `battlemap/hex-setup-feedback` and `battlemap/hex-cols-setup`.

- **Step 14, the hex apply, through the dialog's real Yes.** Five boxes at
  6 mi gave rows of type 2, size 41.
  - The dialog listed Grid, Cell worth, Image and "Token sizing: on → off,
    written off because a cell is a mile or more". It also gave the
    placeables sentence.
  - The token at 780,623 and the wall [700,500,900,500] were unmoved.
  - The notice read "Hex grid applied: 41 px hexes, 6 mi per hex." The flag
    read `autoScale: false`.
  - 560 drawn hex centres, mapped through the background sprite, fell in 560
    distinct Foundry hexes. The worst was 5.6 px from its grid centre, on a
    41 px hex.
- **Step 14a.** `hex-cols-setup` was brought back to gridless `ft` at
  1600 × 1200 first. Five boxes over five columns read 0.6 px off, tight.
  - The cell worth was typed into the form's own field. The rows then read
    Grid, Cell worth and Image.
  - The dialog left out the placeables sentence: the scene holds none.
  - The apply gave type 4, size 69, `autoScale: false`. 429 centres fell in
    distinct hexes, the worst 1.5 px out.
- **The lone block (T-0592).** On rows, one box at four shapes gave the
  `familyMismatchLone` line with Apply enabled: 76.8 × 82.8, 92.1 × 82.8,
  76.8 × 70.9 and 33.8 × 33.1.
- **Step 15.** A plain character, `battlemap/plain-character`, was created
  through `preCreateToken` on the applied 6 mi scene. With auto-sizing off it
  kept 1 × 1. With it on it took 0.25. Both copies carried the mark, and both
  were swept.
- **Slice G through the panel's own input.** A 150 × 50 box set to 3 across
  read a 50 px cell. Scale-only, empty, asked for the scale bar. With a
  90 × 30 strip at 3 across it read a 30 px cell, with Apply on.
- **Finding 32's way out.** The square family on the hex scene names Scene
  configuration → Grid → Gridless.
- **The mark (slice I).**
  - On the 6 mi hex after the apply, a one-cell character carries it.
  - The readout gives the GM four lines: "Drawn larger than its footprint /
    Drawn at 6 × 6 mi / Footprint 5 × 5 ft / One square of 5 ft (MM p.11)".
    The 5 ft comes from the world's import.
  - It stayed through a move and a resize to 2 × 2, and after a resize back.
  - The client setting turns it off and back on.
  - It came back after leaving the scene for `formation/combat-scene` (square
    5 ft: neither the party nor a one-cell character is marked),
    `formation/steps-march` and `formation/day-journey-hex`, and returning.
  - On `day-journey-hex`, the formation's shadow token (`shadowFor`, no
    formation flag) carried a mark. That gap predates I (`resolveSize` had
    it), and c7b403da fixes it. After a reload the shadow has none.
- **The footer at a raised type size** (D, fixed on the walk). At 20 px type
  in a 480 px window the footer took 375 px and left the body 67. With
  c7b403da, at 14 px the body is 177, 243 and 455 px in 360, 480 and 760 px
  windows. At 20 px it is 142, 243 and 397. The Apply button is inside the
  frame in all six.
- **`ui-layout` eye checks.** At 420, 320 and 260 px wide: no element past
  the frame's right edge, and the body and footer `scrollWidth` equal their
  `clientWidth`. The floor is `min-width: 200px`.
- **The hover pass.** The fit residual, the image row and Apply carry
  tooltips. The cell figure, the box count and the box rows do not (T-0615).
- **A player seat, by a real join** in the capture driver's own browser, as
  Player. `openAssistant()` answers null. The scene controls offer regions,
  tokens and notes, with no Battlemap group. The cadence member's token is
  not visible to that seat, so its mark, a child of the token, is not either.
  The readout, forced by a `hoverToken` call, gives a non-owner two lines.
- **Console.** At the end of the walk the pane's buffer held no error-level
  entry. It had already dropped 2642 earlier lines, so it says nothing of
  `init`, `setup` or `ready` on this load.

Fixture ledger:
- Built and kept: `Actor.97FrYzGyW6eb2Iea`, marker
  `battlemap/plain-character`.
- Built and swept: two tokens on `CBskaS5AQcGHmjYf`. Removed
  `[…Token.ELs1EsE2B5W7imec, …Token.PpUV3jit3WNSmcjD]`; could not find `[]`;
  refused `[]`.
- Both kept scenes were brought to their recipe's starting shape (gridless
  `ft`, flag cleared) and applied again. They are left applied at 6 mi.
- The cadence member is back at 780,623, 1 × 1.

#### Checked offline only

- Each slice's `npm test` and `npm run validate` green in the worktree before
  its commit. D's run: "231 committed suite(s)".
- The landing's gate, green on ede09328 under the lease.
- c7b403da's gate in a clone: build:packs 2 s, test 169 s, validate 668 s,
  green.
- `test-battlemap` covers the footprint a token is judged by (now with the
  shadow case), the not-to-scale predicate, and the mark's listener, key and
  readout.

#### Not checked

- Both parities from one box, and the travel-system row (T-0611).
- Step 15's party drop. Phase 2 walked it, and D, E, G and I do not touch it.
  Dropping a party here would move a kept formation's party.
- The mark's look on screen. The pane was hidden, so no shot was taken. Its
  draw order: it sits at child index 1, behind core's first child, not 0.
- The footer and token section at an expedition scale (`travelSystem`).

#### Docs refreshed

The docs are brought to E's token section: the guide's Applying intro and
"Token sizes" section, MODEL's `token-scale.mjs` and `assistant-app.mjs`
rows and its chip and trigger lines, and TESTING steps 7a and 8. DECISIONS is
dated history and keeps "size hotbar". Phase 4 still owns the plates.
