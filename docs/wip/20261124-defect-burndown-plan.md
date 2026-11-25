# Defect burn-down (wip plan, opened 2026-11-24)

An in-flight plan. When the last batch closes, what it taught moves into the
feature docs and this file is deleted in the same session.

## The ruling

The owner, 2026-11-24, of the work that ships with the `acks` 14.2.0 repair:
"Include tasking appropriate agents to burn down the known bug/defect list".

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
gate, and every walk shares one test world. At most three lanes write at a
time, counting lanes that are not this plan's (on 2026-11-24: the repair's
conditions work and the Beastman gear work). **One batch runs at a time until
a lane frees.** The session that started a batch starts the next one when it
ends; a batch session starts none. The app refuses a start on a turn that
another session's note began, so the next batch then reaches the owner as a
card, with its rows already claimed.

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

## What every batch session does

One fresh session per batch, on a model its start names, working about ten
rows and no more. It follows `acks-bug-triage` §3 to §5 with these limits:

- **It stops at `fixed-unreleased`.** No release is cut, nothing is pushed,
  and no report asks about a release (TOOLCHAIN §4, "Release kinds"). The
  skill's default that a fix ships as a hotfix does not apply here.
- **It is the one ledger writer for its own rows.** It re-reads the ledger
  before every write and writes no other batch's rows. A finding outside its
  rows is registered `new` and left for the batch map.
- **Agents.** Investigators diagnose and edit nothing. A row whose cause is
  not known goes to `architect` (opus: diagnosis) before any edit. A scoped
  fix goes to `implementer` (sonnet), one fresh agent per fix, with the
  owner's words in its brief. A lookup goes to `scout` (haiku).
- **Four dispositions.** A row closes as a false report, a docs gap or style
  feedback as readily as a fix, each with its evidence.
- **Design before build.** Every row in the batch that changes what a user
  sees goes on one board (`/design`). Rows with no visible change are built
  meanwhile. The owner, 2026-11-24, to the session that starts the batches:
  "You can approve design boards for simple items". So a batch session sends
  its board's link to that session with each item marked simple or not, and
  that session reads the board and answers. **Simple**, as that session reads
  the word: a label, a tooltip, an accessible name, a hint's wording, a
  missing disabled or empty state, a figure's format, on a control that
  already exists where it already is. **Not simple**, and still the owner's:
  a new control or window, a control moved or removed, a changed layout, a
  changed order of steps, a new setting, anything a Judge or player must
  relearn, and anything the approving session is unsure of. An approval is
  recorded in the batch's Results as the planning session's, with the item,
  and never as the owner's.
- **A printed figure found in source** is moved by `acks-printed-value`, in
  the batch that finds it.
- **Tree.** A fix is written on `topic/defects-b<nn>`, opened and landed with
  `acks-branch`, so nothing sits uncommitted in `main`'s tree. A walk-script
  or docs-only change may be written in `main`'s tree through `acks-commit`.
- **Before a walk:** who holds the Gamemaster seat, and which lane is quiet.
  **Before a runtime landing:** `main`'s version has its tag.
- **Its last acts:** each row's status and sha on the ledger, a Results entry
  below (what was walked live, what was checked offline only, what was not
  checked; no row titles), its topic closed, and `archive_session` on itself.

## Start prompt, per batch

"Read `CLAUDE.md`, `docs/wip/20261124-defect-burndown-plan.md` and the batch
map `C:\Proj\acks-rules\bug-intake\burndown-2026-11-24.md`. You are batch
B<nn>. The owner: 'Include tasking appropriate agents to burn down the known
bug/defect list'. Claim your rows on the ledger if they are not already
yours, then work them as 'What every batch session does' says. Stop at
`fixed-unreleased`; push nothing; ask nothing about a release."

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
