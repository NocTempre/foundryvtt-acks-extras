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
   apply leaves auto-sizing off (default pending §5 Q1). Below that scale the
   section says what a footprint is, the chips carry their unit and a tooltip
   of their parts, the whole-scene resize moves in from the footer with a
   tooltip and label naming what it leaves alone, and a line says whether
   tokens placed here are auto-sized.
10. **A hex preview** is drawn from the probe's vertex offsets (default
    pending §5 Q3).

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

None blocks Phase 1. Each default is the first answer. Q1 changes an in-force
ruling, so slice C builds its half only once the owner has answered; Q2 and
Q3 each gate their own slice.

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

Each phase is a clean session that orchestrates itself in `main`'s tree (the
work is walked live as it goes, so no topic branch). Agent routing is part of
the brief: `implementer` for a scoped slice with its acceptance, one fresh
agent per slice and never two on one file; `architect` for a review that must
not be anchored on the author's reading; `scout` for a lookup; `doc-scribe`
for fragments, index rows and pointer fixes. The phase session itself drives
the live walks in the browser pane, writes `DECISIONS.md` and `MODEL.md`, and
commits with `acks-commit` after each slice passes `npm test` and
`npm run validate`. Agents edit with the Edit and Write tools only, so the
commit ledger sees their lines. A slice that changes what a user sees ships a
`changelog.d/` fragment; slices A and B change nothing a user sees and ship
none. Nothing is pushed without the owner's word.

`main` can be released by a peer between phases, so each phase leaves the
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
run its Phase 1 as that phase's orchestrator: step 0, slices A and B with one
`implementer` each in parallel, then the `architect` review and the mutation
check. Commit each slice with `acks-commit` once `npm test` and
`npm run validate` pass. Append your results under 'Results — Phase 1',
correct Phase 2's start prompt to what you found, put Phase 2 up as a
proposal card, and report to the owner, opening with the card."

### Phase 2 — wiring and preview, walked

- **Slice C** (`implementer`): `session.mjs`, `assistant-app.mjs`,
  `apply.mjs`, `lang/en.json`, `assistant-body.hbs` (the spans input and the
  worst-box line only) and `tools/test-battlemap.mjs` (it reads `session.mjs`
  and `assistant-app.mjs` as text): the lattice fit behind the hex family,
  corners refused, spans gone on hex, the blank cell worth, the solve split
  from the write, the done notice, the affine leak closed, and auto-sizing by
  scale once §5 Q1 is answered.
- **Slice F** (`implementer`, after C; `capture.mjs` alone): the hex preview.
- **Walk** (the phase session, GM seat, on the §2 fixture reset to gridless,
  and on a hex-columns scene): with **real pointer drags**, the three reported
  attempts in the reporter's order; five boxes over four rows read tight; the
  notice's wording; a one-cell token dropped after a mile-scale apply keeps
  its size; a party token placed there takes Journey with the scale notice;
  both parities applied from one box; `TokenDocument.schema.fields.width`
  read for the half-cell question; `init`, `setup` and `ready` clean on a
  recorder attached before load.
- The `DECISIONS.md` entry of §6 and `TESTING.md`'s changed steps land here.

Start prompt: "Read `docs/battlemap/wip/20261115-map-setup-revision.md`,
including Phase 1's results, and run its Phase 2 as that phase's
orchestrator: slice C, then slice F, one fresh `implementer` each, then walk
it live yourself per `.claude/rules/live-testing.md` and
`docs/battlemap/TESTING.md`. Commit each slice with `acks-commit`. Append
'Results — Phase 2' sorted into exercised live, offline only and not checked,
correct Phase 3's start prompt, put Phase 3 up as a proposal card, and report
to the owner, opening with the card."

### Phase 3 — the panel's surface and the token section

- **Slice D** (`implementer`): `assistant-body.hbs`, `assistant-foot.hbs`,
  `styles/battlemap.css`, `lang/en.json`, `assistant-app.mjs` (context only):
  the needs list, the cell-and-units row, the "saved as you choose" heading,
  the footer's rows, labels and tooltips.
- **Slice E** (`implementer`, after D, same files): the token section of
  proposal 9. If Phase 2 confirmed the half-cell finding, its fix is a slice
  of its own in `footprint.mjs` and `token-scale.mjs` with their tests, and
  it takes the quarter-square entry of §6 with it.
- **Slice G** (`implementer`, after E, only on a yes to §5 Q2).
- **Walk** (the phase session): the flow of §4 read top to bottom by someone
  who has not seen the panel; the footer pinned at a raised type size and in
  a short window; every figure hovered against its parts; the square and
  scale-only families' needs lists; a player seat is offered nothing.

Start prompt: "Read `docs/battlemap/wip/20261115-map-setup-revision.md`,
including the earlier phases' results and the owner's answers in §5, and run
its Phase 3 as that phase's orchestrator: slices D then E (then G where §5
says so), one fresh `implementer` each, then the walk, including
`.claude/rules/ui-layout.md`'s eye checks and `.claude/rules/ui-tooltips.md`'s
hover pass. Commit each slice with `acks-commit`. Append 'Results — Phase 3',
correct Phase 4's start prompt, put Phase 4 up as a proposal card, and report
to the owner, opening with the card."

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
all its results and run its Phase 4 as that phase's orchestrator. Finish by
moving what this file still holds into `MODEL.md`, `DECISIONS.md`,
`TESTING.md` and the guide, deleting the file, and reporting to the owner
with the release question."

## 8. Registered, not in scope

- The country brush is offered on a scene that is not a hex grid and refuses
  only at the first click.
- The square family's loose-fit warning names no sample.

## Results
