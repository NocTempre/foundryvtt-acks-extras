# Defect burn-down (wip plan, opened 2026-11-24)

An in-flight plan. When the last batch closes, what it taught moves into the
feature docs and this file is deleted in the same session.

## The ruling

The owner, 2026-11-24, of the work that ships with the `acks` 14.2.0 repair:
"Include tasking appropriate agents to burn down the known bug/defect list".
And 2026-11-27, when the batches were re-cut: "Can you queue up the bug fixes
until all known bugs/defects are resolved?"

The list is the bug-intake ledger (`acks-bug-triage` §2), which is LOCAL-ONLY
and never quoted into a repo. So this file names batches, their file areas,
their order and their agents; **which rows a batch holds is the batch map
beside the ledger, `burndown-2026-11-24.md`.** A batch's rows are also marked
on the ledger itself, claim `<date> burn-B<nn>`, when its session starts.

Counted on 2026-11-24, after intake: 116 rows not yet worked, 5 deferred
defects, and 24 registered that day from the repair's Phase 1 Results. 114 of
them are in twelve batches. The rest are named in the batch map with why:
two wait on the owner, two belong to the repair's Phase 2, three are the
system's, 23 were opened that day by other live sessions in files they are
editing, and the deferred feature requests are not defects.

## Capacity

Integration is exclusive: every landing takes the one landing lease and a full
gate, and every walk shares one test world. **One batch runs at a time.**

**How the next batch starts.** The app opens a session only on a turn the
owner's own message began. So each batch from B14 on has a **standby**
session, opened in the owner's turn of 2026-11-27 and briefed to wait. The
batch map names each standby's session id. A batch's last act wakes the next
standby by that id. The woken standby checks that its predecessor's State in
the map reads `closed`, and only then starts. The wake is only a trigger:
the standby's task is the brief it was opened with, and the message carries
no instruction of its own.

**If the queue stalls**, because a batch closed and the next standby never
started, the owner or any session sends that standby `start`. It begins once
the marker stands.

That hop from one batch to the next was untested when this was written. The
first batch to close is where it is proven.

## Batches

Order is severity first, then the files no live session is editing.

| Batch | Area | Files, mostly | A user sees a change | Notes |
|---|---|---|---|---|
| B01 | data and writes: import removal and repair, class kit items, a forced re-import, an equip from a stack, the item sheet | `scripts/importer/`, `scripts/classes/`, `scripts/equipment/` | in part | first: these delete, duplicate or lose data |
| B02 | battlemap behaviour | `scripts/battlemap/` | in part | |
| B03 | walk scripts, first half | `tools/live/` | no | not runtime; needs a quiet seat lane |
| B04 | walk scripts, second half | `tools/live/` | no | includes the walk drift the repair's Phase 1 traced |
| B05 | seats, timing and short windows | `tools/live/`, `scripts/importer/`, `scripts/lib/` | in part | mostly diagnosis: `architect` before any fix |
| B06 | battlemap setup window | `scripts/battlemap/`, `templates/`, `lang/` | yes | one design board for the batch |
| B07 | battlemap palette and controls | `scripts/battlemap/`, `templates/`, `lang/` | yes | one design board for the batch |
| B08 | tooltips: item sheet, doors, crossing, class sheet; the bash throw | `scripts/equipment/`, `scripts/formation/`, `scripts/classes/` | yes | `ui-tooltips.md`; `acks-printed-value` where a figure is in source |
| B09 | tooltips: character sheet, henchmen, template sheet, location | `scripts/character-sheet/`, `scripts/henchmen/`, `scripts/lib/`, `scripts/location/` | yes | after the repair's S7c lands: both edit the stats tab |
| B10 | formation, markets, monsters | `scripts/formation/`, `scripts/markets/`, `scripts/monsters/` | in part | check the Beastman sessions' dirty paths first |
| B11 | importer and toolchain, small | `scripts/importer/`, `tools/`, `.claude/skills/`, `docs/` | no | a toolchain tool's change runs its own suite |
| B12 | what 14.2.0 left | `scripts/equipment/`, `scripts/formation/`, `scripts/monsters/`, `docs/` | in part | |

**Re-cut 2026-11-27.** B05 to B12 had gone stale: other work had fixed,
released or moved many of their rows since 2026-11-24. Their open rows, and
every defect registered since, now run as B13 onward, one at a time in this
order. The batch map holds the rows, and it lists each row left out with the
reason.

| Batch | Area | Files, mostly | A user sees a change | Notes |
|---|---|---|---|---|
| B13 | the first ten after T-0907: walk teardowns, a conversion rename, a ruling's DECISIONS entry, monster sheet coverage, a burst tooltip, a labelled stack, a roll table's ceiling, three battlemap wordings | `tools/live/`, `scripts/importer/`, `scripts/monsters/`, `scripts/magic/`, `scripts/lib/`, `scripts/battlemap/`, `lang/` | in part | it was already running when the batches were re-cut, under the claim `batch:2026-11-27b`, which it keeps |
| B14 | the owner's reports of 2026-11-27 (a character import's hand warnings; the camp's provisions), then importer, toolchain and the walk runner | `scripts/character-sheet/pdf/`, `scripts/equipment/`, `scripts/formation/`, `tools/`, `.claude/skills/`, `scripts/importer/` | in part | the owner's two reports go first. A change to a toolchain tool runs that tool's own suite. Two rows were filed against the retired template, whose code now lives in this repo |
| B14b | weapon sets switched at the book's draw cost | `scripts/equipment/`, `scripts/character-sheet/`, `scripts/importer/`, `templates/`, `lang/` | yes | a feature the owner ordered into the queue on 2026-11-27 ("Build in queue"). Built on `topic/weapon-sets` with a design board; the switching costs are printed values, imported |
| B15 | tooltips: item sheet, item loss, doors, template sheet, lair | `scripts/equipment/`, `scripts/formation/`, `scripts/lib/`, `scripts/location/`, `templates/`, `lang/` | yes | `ui-tooltips.md`: a field with nothing imported shows its page reference alone |
| B16 | tooltips: character sheet, henchmen, influence | `scripts/character-sheet/`, `scripts/henchmen/`, `scripts/influence/`, `templates/`, `lang/` | yes | as for B15 |
| B17 | magic, conditions, markets, monsters, influence, theme faces | `scripts/magic/`, `scripts/lib/`, `scripts/markets/`, `scripts/monsters/`, `scripts/influence/`, `styles/` | in part | a condition's printed odds arrive through `acks-printed-value`; one row waits on the owner's word (batch map) |
| B18 | battlemap: the palette, setup tooltips, controls, a brush size (the owner's request), the hex fit | `scripts/battlemap/`, `templates/`, `lang/` | yes | the hex-fit rows carry the architect's measurements in their notes; one design board |
| B19 | seats, timing and short windows | `tools/live/`, `scripts/importer/`, `scripts/lib/` | in part | rows seen once or confounded by other runs: reproduce each on a quiet tree first, and `not-reproducible` is a valid close |
| B20 | the module clock and performance | `scripts/lib/`, `scripts/magic/`, `scripts/location/`, `scripts/importer/` | in part | design work, so `architect` rules on the clock first. This is the post-release clock pass the hub named on 2026-11-26. Each measured lead is timed again, then closed, built, or left deferred with its numbers |
| B21 | found on the way | wherever they fall | | every defect row registered while B13 to B20 ran |

**When the queue ends.** It ends when the ledger holds no `new` or `claimed`
row outside the batch map's exclusions. B21 takes about ten of what is left.
If more remain, it writes their batch into the map and its start prompt here.
Only an owner's turn can open a session, so B21 then puts the next start to
the owner as a card.

**The release follows the queue.** The owner was asked on 2026-11-27, "Cut a
release of the seven pushed fixes now, ahead of the queue?", and answered
"After the queue". So once no defect row remains, the last batch cuts one
release of everything on `main` with `acks-release`. That answer is the
owner's go-ahead for the release's tag and push. Every gate the skill names
still applies, and a red gate stops the release and goes to the owner.

## What every batch session does

One fresh session per batch, on a model its start names, working about ten
rows and no more. It follows `acks-bug-triage` §3 to §5 with these limits:

- **It stops at `fixed-unreleased`.** No release is cut, nothing is pushed,
  and no report asks about a release; the owner calls releases. The one
  exception is the release that ends the queue ("When the queue ends",
  above). The skill's default that a fix ships as a hotfix does not apply
  here.
- **It is the one ledger writer for its own rows.** It re-reads the ledger
  before every write and writes no other batch's rows. A finding outside its
  rows is registered `new` and left for the batch map.
- **Agents.** Investigators diagnose and edit nothing.
  - A defect is fixed with no design gate in front of it. The owner,
    2026-11-25: "Bugs: just fix them … No architect pass needed first".
  - `architect` (opus) takes a cause that resists a first diagnosis, and
    B20's clock design.
  - A design choice inside a fix is the batch's own call. The batch states
    how the choice meets the owner's three principles: "every value has a
    control, everything has a manual override or entry point, and nothing is
    buried in a hidden table".
  - A scoped fix goes to `implementer` (sonnet), one fresh agent per fix,
    with the owner's words in its brief.
  - A lookup goes to `scout` (haiku).
- **Four dispositions.** A row closes as a false report, a docs gap or style
  feedback as readily as a fix, each with its evidence.
- **Design before build.** Every row in the batch that changes what a user
  sees goes on one board (`/design`). Rows with no visible change are built
  meanwhile.
  - The batch session reviews its own board against `ui-layout.md`,
    `ui-tooltips.md` and the design system, then approves it. It records the
    approval as its own, item by item, never as the owner's. The owner,
    2026-11-25: "Unless it's a major judgement call, I'll just try it and
    give feedback after testing."
  - A major judgement call goes to the owner, with the board's link inside
    the question itself. That covers what happens in play, who may do what,
    and a reversal of an owner ruling. The batch works its other rows
    meanwhile.
  - The batch's Results keep a "to try" list for the owner: each thing built
    on the batch's own approval, where it is in the UI, and its board link.
- **A printed figure found in source** is moved by `acks-printed-value`, in
  the batch that finds it.
- **Tree.** A fix is written in `main`'s tree through `acks-commit`, one batch
  at a time (`.claude/rules/shared-tree.md`). A change that spans several
  commits, none walked until the last, may take `topic/defects-b<nn>` through
  `acks-branch`.
- **Live check.** Each landing's live check runs on `main` at the landing. It
  is a short look at the changed surface: no thrown error, and the observable
  the row names. A kept walk runs only where the feature's recipe already
  names one, and no fix gets a new walk script. The owner, 2026-11-26: "Only
  what changed needs checked, and that's part of the implement land".
- **Before a walk:** who holds the Gamemaster seat, and which lane is quiet.
  **Before a runtime landing:** `main`'s version has its tag.
- **A finding outside its rows** is registered `new` on the ledger, and B21
  takes it.
- **Its last acts, in order:**
  1. each row's status and sha on the ledger;
  2. a Results entry below: what was walked live, what was checked offline
     only, what was not checked, and the "to try" list (no row titles);
  3. any topic it opened, closed;
  4. its State in the batch map set to `closed <date>`;
  5. the next standby woken by the session id the map gives it;
  6. `archive_session` on itself.

## Start prompt, per batch

"Read `CLAUDE.md`, `docs/wip/20261124-defect-burndown-plan.md` and the batch
map `C:\Proj\acks-rules\bug-intake\burndown-2026-11-24.md`. You are batch
B<nn>. The owner: 'Include tasking appropriate agents to burn down the known
bug/defect list' (2026-11-24) and 'Can you queue up the bug fixes until all
known bugs/defects are resolved?' (2026-11-27). Check that the batch before
yours reads `closed` in the map. Claim your rows on the ledger if they are
not already yours, then work them as 'What every batch session does' says.
Stop at `fixed-unreleased`; push nothing; ask nothing about a release. Your
last act wakes the next standby."

## Results

Appended by each batch session.

### 2026-11-24, intake

Both GitHub queues were empty. The repair's Phase 1 findings were registered
or joined to the rows they repeat, one stale claim was closed against the tag
that shipped its work, and B01's rows were claimed. Two ledger rows parse to
a field count other than the header's, before and after; not repaired.

### 2026-11-24, B01

Eleven rows worked. Eight are fixed, and one more found on the way is fixed
with them: 0f9fcdfb, d3a2b1f1, 5ffb241a, ac846dc9, e63dc295, 3e572086,
74a05be2, 43f6a2b8, and the item sheet's dead Uses row in 8c979fd0, e29ceb3f
and this commit. One is a docs gap (907159e5), one is deferred, and one is a
false report. The Uses row was removed on the owner's ruling, "Remove the
row", which also approved its design board (option B). Four more findings
were registered and left `new` for a later batch. All on `main`, not pushed.

Walked live on `main`, lane A:

- 5ffb241a and d3a2b1f1: `equipment-weapon-stacks` passed 19 of 19, after a
  first run that errored at the GM seat's login. The same recipe's steps 7
  to 9 were run as a scripted check, 9 of 9. Step 9 drove the character
  sheet's drop handler, not a pointer drag.
- ac846dc9: `importer-forced-places` passed 28 of 28, after the same login
  error, and `importer-book-actors` passed 16 of 16.
- The Uses row: a scripted check passed 7 of 7. A plain item with charges and
  a weapon both render the Durability tab with no Uses row and no page error.
  The key is gone from the loaded strings, and the item's charges are still
  stored.
- 43f6a2b8, in part: an ability created with the unattended option reaches
  `createItem` carrying it, and the picker offers no slot. A plain create
  still offers one. The probe saw no picker window open in either case, so
  the dialog itself is not observed.

Checked offline only: 0f9fcdfb, e63dc295, 74a05be2, 907159e5, and 3e572086.
3e572086 is Remove ALL imports: walking it would come close to emptying the
shared world, which is the owner's call.

Not checked: the companion picker's dialog opening or staying shut, as
above.

### 2026-11-24, between B01 and B02

The four findings B01 registered are in the batch map: one in B05, three in
B12, so 118 rows are in the twelve batches. B02's eleven rows are claimed and
its session is proposed to the owner as a card.

### 2026-11-25, B02

Eleven rows worked, built on `topic/defects-b02` and landed on `main` in one
land. Seven are fixed: T-0595 and T-0632 (999759b1, with f85dea09, which the
walk found and is written in `main`'s tree), T-0630 and T-0633 (bcb811ab),
T-0602 (1e3bc714), and T-0599 and T-0600 (e9bd6d27). Their recipe steps are in
7dd564cf and e9bd6d27. Two were already released: T-0627 and T-0631 shipped in
v2026.11.19 (ec5b05c4, aad8121f) before the batch reached them. Two are
deferred with the architect's numbers on the ledger: T-0593 and T-0594. One
finding was registered `new`: T-0768. All on `main`, not pushed.

T-0599, T-0600 and T-0602 were built from a design board on which the owner
ruled "A on all three" (2026-11-25). The battlemap DECISIONS entry of that date
records the ruling for T-0599 and T-0600.

T-0593 is deferred because none of the variants measured separates a bias
shared by every box from an honest small-hex set. Every one that catches the
misplacement also breaches an acceptance bound or fires on honest sets.
T-0594 splits three ways:

- (a) is a lattice-gate change measured with no case made worse. It supersedes
  the earlier fit's three-box threshold and rewords
  `ACKS-BATTLEMAP.warn.familyAmbiguous`, so it needs a DECISIONS entry and a
  wording board, and is left for the batch that picks the row up. Its change
  list is in the row's ledger notes.
- (b) is deferred.
- (c) waits on a ruling about the hex shape tolerance.

Walked live on `main`, lane B (Gamemaster 2), alone on the server:

- Battlemap TESTING steps 19 to 22:
  - Pressing the group again arms nothing (DOM clicks), and a scripted
    activate still arms.
  - Ctrl+Z removes the newest sample of any kind, in order.
  - A field change renders once on square and on hex.
  - A scene spelled `Miles` keeps `Miles`. Re-walked after f85dea09, the row
    reads the same spelling.
- Map modes steps 7 and 8:
  - Closing the palette disarms, the group rests, and a press reopens the
    palette. A brush armed from a sheet closes to null with the toolbar's tool
    left alone.
  - A Terrain pick and a handout tick each hold until the next real pointer
    stroke, which shows Territory with the handout off. A Terrain-layer stroke
    leaves the view.
- The water step 5 addition: the Coastline preset marks a coast. Paved road
  then Alley marks a paved alley.
- The released pair re-confirmed: the map-cell field shows on scale-only with
  boxes, and a custom size pressed once sizes the token.
- No page error was recorded from the walk's own listener, installed after
  `ready` on each run.
- Kept fixtures: `battlemap/unit-spelling`, `battlemap/b02-brush@b02` and
  `battlemap/b02-custom-size@b02`. Regions and walls drawn on the brush
  fixture were deleted by their own uuids (2 regions, 2 walls).

Checked offline only: the six battlemap suites on each fix. T-0593 and T-0594
were measured offline by the architect at the fit's interface.

Not checked: the ordinary-preset branch of the two marking tools, live (unit
tests only); the erase stroke, live (unit tests only); `init`/`setup`/`ready`
console (the walk's listener attached after `ready`).

### 2026-11-25, between B02 and B03

T-0594 and the finding B02 registered are in the batch map under B06, and the
two findings the repair's Phase 2 registered are under B09, which no longer
waits: the repair's S7c is on `main`. T-0593 stays deferred. B03's ten rows
are claimed and its session is proposed to the owner as a card.

### 2026-11-25, B03

Ten rows worked, all in `main`'s tree (walk scripts and recipes only, so no
topic branch was opened). Four are fixed in 0f44b0ba: T-0533, T-0562, T-0563
and T-0564. Five were already released in v2026.11.14: T-0532, T-0566, T-0567
and T-0568 (1838c199) and T-0565 (bb051e26). Their walk checks pass in the
three or four runs from 2026-11-15 to 2026-11-25 that each ledger note names. T-0534 is a false
report: its walk was retired in 546248b1, and the id it named belongs to a
coined monster, whose name the owner ruled on 2026-11-18 ships. Four findings
were registered `new`: T-0771, T-0772, T-0783 and T-0784. All on `main`, not
pushed.

- The guards are gone. The importer walks' setup deletes a standing import of
  the book by the uuids it reads back, through `track` and
  `sweepTracked({only})`. That follows the owner's 2026-11-11 ruling: "tests
  always may clear away items on the test server as needed". `HELD_OK` and
  `TAKEOVER_OK` are removed. importer-ax1 remakes the AX1 import and keeps it;
  the world held 17 AX1 scenes and 219 AX1 actors before and after.
- importer-typography reads every count from the cookbook. Its paragraph
  oracle is replaced by a check on page shape: a paragraph closes unless it is
  a list or stat line, and none is cut mid-sentence.
- Walk drift fixed on the way:
  - The typography setup missed the monster's leaders template.
  - importer-ax1 had a table roll on an Adventure's data-model tables.
  - Its zone checks predated region-wide zones.
  - Its link count read one cookbook where the importer reads all of them.
  - force-repair's No observer counted every user's writes. It now keeps the
    GM seat's own writes and counts other users' apart. A setup check proves it
    still records the seat's own edit. That a peer's writes made the earlier
    run's 10 is inferred, not shown: the subject's modifiedTime did not move,
    and a peer disclosed holding a seat in that window. The passing runs saw 0
    writes by other users.
- An architect diagnosed importer-ax1's backlog: one module finding (T-0772,
  the pair block's stale register list) and two walk drifts, both fixed.

Walked live on `main`, lane B (Gamemaster 2 / Player 2):

- importer-typography 20261125-112211: passed (49 pass, 0 fail).
- importer-force-repair 20261125-112211: passed (54 pass, 0 fail). With the
  observer's own-write check added, 20261125-120036 passed (55 pass, 0 fail).
  The run between them, 20261125-114842, errored: the GM page stopped
  answering after Keep all, a step that passed on both sides of it. Its own 10
  items were swept by uuid afterwards (all removed), and the shelf it opened
  was deleted once empty.
- importer-ax1 20261125-112211: failed (98 pass, 1 fail). It reached WALK END,
  and the one FAIL is T-0772.
- formation-column 20261125-113354, with FIXTURE_OWN=b03, so the entry is
  partial: 117 pass, 2 fail. Every step-20 check passes, including the trap
  die's import check. The two FAILs, at steps 1 and 2, passed on 2026-11-24 and
  are T-0784. The earlier run 20261125-110733 is not counted: lane B's kept
  fixtures are owned by lane A's player, and a peer held lane A's Judge, the
  active GM, from 11:11 to 11:16 UTC.

Deleted and kept, from each log's ledger. Every sweep quoted here ended with
nothing missing and nothing failed:

- The typography setup sweep removed nothing (the shelves were already
  clear). Its teardown swept its own Adventure, maps, actors and shelves.
- The force-repair 120036 teardown removed its 10 items and one actor, and
  deleted the shelf it opened. It reused `importer/token-art-wildcard`.
- importer-ax1 deleted the world's AX1 maps, places, creatures and plans by
  read-back uuids and remade them as the standing import: 17 maps, 219 actors
  copied. It reused `importer/lamplighter`, and its own token sweep found its
  tokens already gone with their maps.
- formation-column built and kept 13 `@b03` fixtures:
  - `formation/column-scene`, `column-party`, `column-lead`, `column-torch`,
    `column-lantern` and `column-watcher`
  - `formation/column-party-token`, `column-trap-item` and `column-trap`
  - `formation/cadence-party`, `cadence-member`, `rest-party` and
    `rest-member`

Checked offline only: the cookbook-derived counts, and the shape rule against
an offline `executeEntry` run on the two six-box prose entries.

Not checked:

- formation-column's re-import branch for the trap die, because the world
  already held it.
- A formation-column run that is not partial.
- Typography step 1's announcement on opening the book: the seat had it open
  before the run.
- force-repair's steps 2, 3, 5, 6 and 7: no active module ships a monster
  compendium with token art.
- `init`/`setup`/`ready` console beyond each walk's own load-to-ready check.

### 2026-11-25, B04

Thirteen rows worked: the batch's eleven, T-0822 added by the hub, and
T-0802, which the batch found. All the work was in `main`'s tree. The walk
fixes and recipe steps are in b8c75769, 646fba4b, b5a48ff3 and b39d0e86, and
8b1dbb88 adds instrumentation.

- Fixed:
  - T-0680, T-0693, T-0694, T-0753 and T-0754 (b8c75769).
  - T-0756 (646fba4b).
  - T-0757 (646fba4b with f1edbe02).
  - T-0685 and T-0704 (b5a48ff3).
  - T-0822 (b39d0e86).
  - T-0695, in the local rules suite, which is not tracked.
- One runtime fix, on the hub's ruling: T-0802 (f1edbe02). An unarmed strike
  never asks for a damage formula. The equipment DECISIONS entry of
  2026-11-25 records it and marks the 2026-11-17 entry superseded in part.
- T-0569 was already released in v2026.11.19 (f5f530d6).
- One finding was registered `new`: T-0808. It failed once during a run that
  three landings crossed, and passed on the rerun with none crossing. It is
  left for the batch map.
- All on `main`, not pushed.

Cause, where the batch found it:

- T-0822 was the walk's own reading. The wall create answers in its own
  order, and the walk took the fourth wall for the locked one. The
  instrumented run showed no door-state write at all.
- T-0685 and T-0704 were the treasure walk's press, which landed on a control
  that moved under the pointer. The step 5 order check also predated the
  replace card's slot. The press now refuses when the control moves and
  records it. T-0685 failed one press in 25, so one clean run cannot rule out
  a recurrence. A recurrence now reads as a refused press, not as a missing
  window.

Walked live on `main`, lane A (Gamemaster / Player), alone on the server,
kept fixtures:

- Half 1, 20261125-124649, started after f1edbe02 landed:
  - magic-sacrifice passed (32 pass, 0 fail).
  - magic-cast-summon passed (92 pass, 0 fail).
  - formation-steps passed (58 pass, 0 fail).
  - scene-search-session passed (49 pass, 0 fail).
  - location-prune-keyed passed (7 pass, 0 fail).
  - formation-day failed (184 pass, 1 fail). The FAIL is T-0808, and step 6
    (T-0756) passed.
  - equipment-printed-figures passed (51 pass, 0 fail).
- Half 2, 20261125-155804, main feac8b6a:
  - treasure passed (77 pass, 0 fail).
  - treasure-faces passed (51 pass, 0 fail).
  - treasure-seeds passed (34 pass, 0 fail).
  - treasure-deal passed (59 pass, 0 fail).
  - treasure-magic-deal passed (41 pass, 0 fail).
  - treasure-party passed (36 pass, 0 fail).
  - treasure-search passed (48 pass, 0 fail).
  - scene-search-sheet-crossing passed (70 pass, 0 fail).
  - formation-day passed (185 pass, 0 fail).
- magic-cast-tracked 20261125-163409, on feac8b6a with b39d0e86: passed (163
  pass, 0 fail).

Deleted and kept, from each log's ledger. No sweep failed anything:

- What was not found: Cards piles, combats and their combatants, and
  documents embedded under actors.
- The treasure walks swept 10 to 19 documents each, and kept their
  `treasure/*` fixtures.
- The scene-search walks kept their `scene-search/*` fixtures, and
  formation-day kept its `formation/day-*` fixtures.
- formation-steps built and kept 19 `formation/steps-*` fixtures.
- magic-cast-tracked reused 25 `magic/tracked-*` fixtures. It built one Combat
  and swept 71 documents.

Checked offline only:

- T-0802's suite, `tools/test-weapon-damage-blank.mjs`.
- T-0695's local rules suite.

Not checked:

- The import notice that T-0812 asks about: no walk in the batch captures it.
- A second treasure run to bound T-0685's rate.
- `init`/`setup`/`ready` console beyond each walk's own load-to-ready check.
- A world relaunch after S12's new stylesheet.

### 2026-11-27, B13

Ten rows worked under the claim `batch:2026-11-27b`, all in `main`'s tree,
each landed through `acks-commit` with its full gate. `main`'s version
(2026.11.26.1) carried its tag throughout. Nothing pushed.

- Fixed:
  - T-0825 (3d642f6d).
  - T-0846 (d279f36e).
  - T-0852 (44d0dd94; its recipe step 8ef907f1).
  - T-0853 (3ba77031). The follow-up that lands with this correction names
    the rounding after the defense, which the resistance probe below found
    missing.
  - T-0904 (fb6cb8f1).
  - T-0543 (26ca0d1a).
  - T-0628 and T-0603 (e318e507; the same follow-up wraps the card head and
    names the street for Alley alone), on a board
    (https://claude.ai/artifact/SxK4Y3zRJxXnw7sXJjnJsF) approved by the
    planning session, not by the owner or this batch, item by item:
    - T-0628: "image px" on the card head, the residual, the box rows and
      the scale bar; "canvas px" on the size field label and the Measured
      line.
    - T-0603: the Alley notice names its street; the Coastline button
      becomes Coast; the earthen preset gets fa-mound, gravel fa-braille,
      and paved keeps fa-road; the Walls control's mark tool becomes
      fa-road-circle-check.
- T-0771, docs-only: 078a5ac6 had already recorded the ruling in importer
  DECISIONS. Noted and not changed: that entry says the owner's exact words
  survive nowhere else, and the local adjudication file of that day holds
  them. The entry is append-only, so it stands.
- T-0626, released: 29c02bb7 fixed it, and v2026.11.19 shipped it.
- One finding registered `new` for B21: T-0908, seen live in T-0852's check.
- T-0904 and T-0543 change nothing an import writes today: no table the
  importer holds carries either shape they fix.

Walked live on `main`, lane A (Gamemaster / Player), alone on the server,
kept fixtures:

- equipment passed (31 pass, 0 fail) and close-role-side passed (40 pass,
  0 fail), run 20261127-145941 (T-0825). Each kept its marked fixtures and
  swept only what it built without a marker.
- lib-aura-fuse passed (83 pass, 0 fail) on 3ba77031, then a one-off probe
  built from its setup passed 13 of 13 (T-0853). An immune near body's Damage
  tooltip named the defense and the figures it moved, before the page, on the
  GM seat and on the Player seat that owned it. The stored entry kept the
  stage. The tooltip stood after Apply and after the defense was taken off;
  undefended rows named none, and no cell carried a `title`. The same probe
  with a resistance (the world holds the imported figures) passed 13 of 13,
  but its tooltip ended on the defense's fractional figure beside a rounded
  one: the stored rounding step was not named. After the follow-up a second
  run passed 13 of 13 and named the rounding before the page, on both seats
  and on the applied row. Both probes wrote the defense flag directly, not
  through the Defenses tab. lib-aura-fuse passed again on a350a77b (83 pass,
  0 fail), its passed-save rows among them; it checks their amounts and no
  tooltip's tail, so a passed save's rounding, which the same change names,
  is pinned offline only.
- A one-off driver for T-0852, through the group sheet's Individuate press.
  The labelled stack stored its figure, the press added no record, and one
  body took the figure once a monster was dropped on the row; a `createActor`
  observer recorded nothing.
- A read for T-0543: the one imported city map's after-dark figure equals what
  the landed code recomputes from its table.
- A look at Map setup and the presets for T-0628 and T-0603. Every new word
  rendered. At the window's minimum width (200 px) the hex card head's unit
  first overflowed its box, held on one line. After the follow-up the head
  wraps to two lines at 200 px and three at a 20 px type base, with no
  overflow. The size labels and the Measured line wrapped. Each re-glyphed
  control kept its accessible name, shown by an empty `data-tooltip`. Real
  presses noticed "Paved road.", then "Paved road, Alley.", then "Coast.". On
  a settlement scene Paved arms an avenue and its notice reads "Paved road."
  alone.

Deleted and kept:

- close-role-side built and kept five marked actors and swept four unmarked
  documents (a seal item, two walls, a token). equipment kept
  `equipment/ac-sum`; its sweep found one unmarked item already gone.
- The fuse probe reused the walk's 13 kept fixtures. Its claim-based teardown
  swept nothing, so its one burst card was listed afterwards and swept by
  id. It restored the near body without the defense and the walk's figures
  without fire. The two resistance runs left one burst card each, listed and
  swept by id (removed 2, missing 0, failed 0).
- T-0852's driver built and kept `lib/labelled-hp-group` and reused
  `lib/org-monster`. The group keeps the one labelled stack and its record.
- The battlemap look wrote nothing to the world except the GM seat's armed
  wall preset, which it left on Coast.

Checked offline only:

- T-0904 (`tools/importer/test-executor.mjs`) and T-0846 (its own suite).
- The unit suites each fix touched, and each landing's full gate.

Not checked:

- A square map's card head ("image px cell"). The hex label, the longer of
  the two, was measured.
- The Measured line on a fitted map. It was seen on the scale-only map only.
- A defense given through the Defenses tab before a burst; the probes wrote
  the flag.
- T-0904 on a real import, since no table holds either alternative.
- Map setup's apply notices and summary rows still say a bare "px"; the
  board did not cover them.

To try (approved by the planning session, not the owner; board
https://claude.ai/artifact/SxK4Y3zRJxXnw7sXJjnJsF):

- Map setup's pixel words: Battlemap scene control → Map setup.
- The road presets' glyphs, the Alley notice and the Coast preset: the
  Battlemap scene control.
- The mark tool's glyph: Walls scene control → Mark the selected walls as
  roads.
- The rounding at the end of a burst row's Damage tooltip, a wording no board
  drew: Chat tab → a fuse's burst card → the Damage figure of a row.
