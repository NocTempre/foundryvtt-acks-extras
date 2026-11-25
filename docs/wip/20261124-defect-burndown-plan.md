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
ends; a batch session starts none.

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
