# Proposal: state a behaviour once, and keep logs out of the tree

> **NOT IN EFFECT.** A proposal for the owner. No rule, tool or doc changes until a cut below is
> ruled on. Each cut ends in one yes/no question. This file is deleted once every cut is adopted
> or declined.

## What was measured

`main`, 2026-10-18 to 2026-11-18, from `git log --numstat`. Generated files and five bulk-move
commits are left out.

| | Lines added | Lines deleted |
|---|---|---|
| Runtime (`scripts`, `templates`, `styles`, `lang`) | 126.5k | 52.3k |
| Offline tests | 93.1k | 7.9k |
| Live walks | 61.7k | 14.5k |
| Docs (DECISIONS, TESTING, MODEL, plans) | 65.2k | 15.8k |

One slice traced in full (`9daa9627`, research days): 535 runtime lines, 428 test lines, 120 walk
lines, 173 doc lines. "A day is credited once" is written as prose in six places (DECISIONS,
MODEL, TESTING, the walk's header, a runtime comment, the commit message) and asserted three
times (two unit tests, one walk check). A same-day reversal (`ba2679a2`) then edited eight of
those files. The sample is one slice; a second walk was compared by its header only.

## Part A: the per-slice docs duty

**A1. A DECISIONS entry holds what was ruled, what was rejected and what it cost.** The doctrine
already says this. In practice an entry also re-describes the build, which MODEL states, and
lists every default the session took with a rated counter (16 of them in the sampled entry, 96
lines). No canon text asks for that list.
*Proposed:* behaviour goes in MODEL only. A default the owner has not ruled on goes in the
session's report as a question, and enters DECISIONS when it is ruled.
*Changes:* one sentence in `docs-doctrine.md`. No tool.
*Question:* adopt A1?

**A2. Where a scripted walk exists, the script is the recipe.** A TESTING step lists each
observable in prose, the walk prints the same observables as its check labels, and the walk's
header lists the steps a third time. TESTING files hold 26.8k lines, and the header comments of
the 72 walks and their six helpers 2.6k.
*Proposed:* a TESTING section keeps its fixtures and markers, the drive mechanics, what is not
walked, and the walk's name. Observables live in the walk's check labels. A surface with no
script keeps its prose recipe. Existing sections shrink when next touched, not in a sweep.
*Changes:* the TESTING bullet in `docs-doctrine.md`, the first bullet of TOOLCHAIN §4 "Release
discipline", `tools/live/README.md`. The preflight finds a walk by the mention of
`tools/live/<name>.mjs` in TESTING (TOOLCHAIN §4a), which stays. By the Part C audit's reading,
the preflight's recipe check needs only that the TESTING file exists.
*Question:* adopt A2?

**A3. A commit message says what the diff cannot.** The median message since 2026-11-11 is 882
characters (757k characters in the week). The sampled ones restate the changelog fragment, test
counts and mutation scores.
*Proposed:* a subject, the reason, and the owner's words where a ruling drove it. The
user-facing description is the fragment's; counts are the gate's output.
*Changes:* one line in the `acks-commit` skill, and a length limit in its tool, since a rule
that recurs becomes a gate.
*Question:* adopt A3 with a 400-character limit?

**A4. A plan is a hand-over.** 105 of the 206 docs-only commits since 2026-11-11 edit a `wip/`
plan; the largest is 3,978 lines with 37 commits in a week. Of its last three appends, two list
commit shas and walk counts that `git log` holds (one also carries findings and design status),
and one records ruling 237, which `docs/magic/DECISIONS.md` also holds. The 2026-11-12 ruling stands: "The plan file is the only hand-over." What changes is what
a phase appends, and the evidence for narrowing a ruling under seven days old is this
measurement.
*Proposed:* a phase appends the corrected start prompt for the next phase and its open
questions. Landed work is its commits. A ruling goes to DECISIONS once.
*Changes:* the "new phase" bullet in `CLAUDE.md`, "Sizing the task".
*Question:* adopt A4?

Estimate, from the one traced slice: A1 and A2 take its 173 doc lines to about 70.

## Part B: logs stay local

The owner, 2026-11-18: "a lot of these docs are throwaway ledger/logs that can stay local and
clear as needed instead of dragging everything forward forever. An archive process at minimum."

| Tracked today | Size | Read by |
|---|---|---|
| `DECISIONS-through-v*.md` archives | 35.7k lines | the live files' "In force" rows link into them |
| `CHANGELOG-through-v*.md` | 9.6k lines | `CHANGELOG.md` links to it; `tools/walk-results.mjs` names it |
| `docs/*/wip/` plans | 10.4k lines, 14 files | the sessions working them |
| Live DECISIONS, four days after the roll | 8.3k lines | sessions |
| `docs/releases/v*/` shots | 522 files, 20 MB, 65 versions | guides, GALLERY, the site |
| For comparison: MODEL, API, READMEs, guides | 27.7k lines | sessions and users |

**B1. A roll moves the archives out of the tree.** `tools/logs.mjs roll` writes each
`-through-v<version>.md` beside its live file, tracked forever. The release tag's own tree
already holds the same bytes: the changelog archive and three DECISIONS archives (importer,
formation, lib) compare identical to their files at `v11.14.5`.
*Proposed:* the roll writes the archives to a local, untracked folder and removes them from the
tree. An "In force" row names the tag and the entry's heading in place of a link.
*Changes:* `tools/logs.mjs`, the roll paragraph in `docs-doctrine.md`, the preflight's roll
check. The roll ruling is from the 2026-11-14 release; the new evidence is the sizes above.
*Question:* adopt B1?

**B2. Plans are local files.** A plan is read by sessions on this machine and is history once
its work lands. Four of the 14 tracked plans have not been touched in two weeks or more; whether
their work has landed was not checked.
*Proposed:* `docs/*/wip/` is ignored by git. A plan lives there untracked and goes to the local
archive when its topic closes. *Cost:* a cloud session or a second machine cannot read a plan,
and a plan has no history.
*The minimum, if B2 is declined:* plans stay tracked, and `acks-branch close` refuses while the
topic's plan file is still in the tree.
*Question:* adopt B2, or the minimum?

**B3. Release shots are kept per surface, not per version.** All 65 version folders are still
referenced (257 references from GALLERY, the guides, the README and the site), so nothing is
unreferenced today and removing a folder means cutting the rows that point at it.
*Proposed:* GALLERY and the guides reference the latest shot of each surface. A folder with no
reference left is removed; git history keeps it, since only two release tags exist. *Cost:* the
public gallery stops showing how a surface looked in earlier versions.
*Changes:* GALLERY and the guides. By the audit's reading, the preflight's roll check fails on
a shot folder nothing links, so it is unaffected.
*Question:* adopt B3?

## Part C: release gates and the template repo

The owner, 2026-11-18: "the release gates (full workflow toolchain really) need a full audit.
They are hold-over from when the repo was very different in scope and structure. For example,
module template seems redundant now."

From a read-only audit of both repos on 2026-11-18. Five of the six findings below were
re-checked against the files by hand. The count of full gates is the audit's reading of the
release procedure, and the line counts in the cuts are the audit's own; neither was re-run.

- **The template has one consumer.** `manifest.mjs` lists `foundryvtt-acks-extras` as its only
  sync target. A canon change is a template edit, commit and push, a sync, a land here under a
  full gate, and a push. This repo took 21 sync commits in the month.
- **One change passes three full gates before it is published:** the land's gate, the release
  commit's clone gate, and CI on the tag. Release step 5 runs the committed suites once more.
- **No push workflow here runs validate or the tests.** The tag build is the only run in a clean
  environment.
- **The live walks load their capture driver from the template's checkout**
  (`tools/live/_driver.mjs`); it is not synced.
- **A tag is built by the template's `release-module.yml@main`,** whatever that branch holds at
  the time.
- **TOOLCHAIN §5 and §6 describe two gates that no validate file contains:** one libWrapper
  registration per target, and resolved flag scopes. 18 files under `scripts/` call
  `libWrapper.register`. The stale-id check they name beside these does exist, in
  `tools/importer/validate-extra.mjs`.

**C1. Fold the template into this repo.** About 2,820 lines go: the sync tool, the scaffolder,
the skeleton, the manifest, the drift workflow, the nightly script and two skills, each with its
suite. The 14 suites that test the tools this repo runs move here with the capture driver, and
the release workflow is inlined, which pins it. *Lost:* a one-command scaffold for a second
module, and toolchain commits kept out of this repo's history.
*Adopted 2026-11-18* (the owner: "Implement"). Its plan is `20261118-template-fold-plan.md`.

**C2. A release commit that changes only the version and the changelog skips its local full
gate, and release step 5 runs the local rules suites alone.** Its runtime already passed the
land's gate, and CI gates the tag. *Cost:* a red CI after the tag spends the day's version. This
narrows a 2026-11-12 ruling; the new evidence is topic landings since 2026-11-15 and the owner's
"checked once after build (unit test) and once as part of integration".
*Question:* adopt C2?

**C3. Remove what is dead or duplicated; no ruling is reversed.** The nightly script,
validate's `ruledata` branches and intra-family exemption, the lang leaf-and-prefix check held
twice (`validate.mjs` §3, `validate-extra.mjs` §4), the preflight's tag check that its version
check repeats, the two-repo routing in `acks-hotfix` and the hygiene sweep, and TOOLCHAIN's
"for the next module" clauses. The two undelivered gates are struck from TOOLCHAIN or built.
*Question:* adopt C3, striking the two gate claims rather than building them?

**C4. The shared-tree commit machinery goes if `main` has one writer.** The edit ledger, the
own-hunk commit tool and the shared-tree guard are about 2,060 lines with 2,170 of tests. That
is an upper bound: a topic's landing runs its gate through the commit tool's `postgate` and
takes the landing lease, and both stay. The rest exists because several sessions wrote `main`'s
tree at once. *Counter, strong:* the incidents
that built them return the day a second session writes there.
*Question:* from now on, does `main`'s tree have at most one writing session at a time?

**Kept, each for a recorded incident:** the walk-result gate and `tools/live`, the pre-commit
quarantine and the scans, validate's checks that the module loads, the land's gate, and the tag
build. A major walking every walk also stays: scoping it to changed recipes would leave a lib
change unwalked in the features that use it.

## Not covered

Offline test growth (93k lines added against 8k deleted) and mutation runs (named in 70 of 771
commit messages since 2026-11-11).
