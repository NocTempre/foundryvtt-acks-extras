---
name: acks-release
description: Cut a major, minor or hotfix release of an ACKS module repo (version bump and release commit, live walks, docs commit with release snapshots, tag, CI check, manifest verification), or pick up one that was cut off part-way. Use when the user asks to release/publish/tag an acks-* module, names a release kind such as "major release", or says to continue, resume or retry a release.
model: sonnet
effort: high
---

Release procedure for any NocTempre `acks-*` module. The kinds, the release
shape (two commits and a tag) and the table of what each kind requires are
`C:\Proj\acks-module-template\docs\TOOLCHAIN.md` §4; the walk gate is §4a; the
capture rules are §4b. This file holds the steps and their commands. Work inside
the module repo; confirm with the user which repo if not stated.

**First, establish the release kind — ask if it is not stated** (TOOLCHAIN §4:
declared, never derived; a major is only ever explicit). It decides the shots,
the walks and the logs the steps below owe.

**A release states rules too** — step 2's changelog entries and step 6's
capture captions both assert what the book says. Verify before asserting, in
`.claude/rules/rules-lookup.md`'s order (snapshot → local extracts and
`DECISIONS.md` → PDF last). Cite book/chapter/section; the snapshot is
LOCAL-ONLY and its paths never appear in a changelog, a commit message or a
tag.

**Keep a checkpoint, and resume from what the world says.** A release often
outlasts its session: a limit lands between the release commit and the walks,
between the docs commit and the push, or after the tag and before the checks.
As each step below ends, append one line to
`C:\Proj\acks-rules\release-checkpoints\<repo>-v<version>.md` (LOCAL-ONLY, beside
the intake ledger; the session's scratch space where that shelf is absent):
the step, its result, the output line that shows it, `HEAD`, and from step 4 the
gated tree id and the release commit's sha, and from step 6 the docs commit's
sha. A release tracks those two shas.

Told to continue, resume or try again, read the checkpoint and then
**establish each fact again before acting on it**. It records what a session
believed, and a peer may have committed, tagged or published since:

| Question | Read |
|---|---|
| Is the version still free, or already this release? | `git fetch -q --tags origin`, then `git tag -l v<version>` and `git ls-remote --tags origin v<version>` |
| Are the release commit and the docs commit landed, and are they the gated trees? | `git log --oneline -8`; `git rev-parse <sha>^{tree}` for each sha against the checkpoint |
| Is the runtime still the one the walks ran on? | step 7's preflight run |
| Are the commits on origin? | `git branch -r --contains <sha>`, for each sha |
| Did every workflow pass? | step 10's call |
| Is it published, and does the manifest resolve? | step 9's and step 11's calls |

Resume at the first step the world does not confirm. An interrupted release
resumes under the same version; an abandoned one costs the day's next version.
A step the checkpoint claims and the world does not show is done again, and the
report says so. A gate result holds for the tree id it was recorded against and
no other. With no checkpoint at all, the same table says where the release
stands. Remove the checkpoint once step 12's report is written.

The CI procedure itself lives in acks-module-template's
`release-module.yml` (reusable workflow) — module `release.yml` files are thin
synced callers; never edit either in a module repo. A pre-flight dry run of
the full pipeline (build + validate, no publish) is available anytime:
`gh workflow run Release --repo NocTempre/<repo> --ref main`

1. **Orient.** `git status` and `git log origin/<branch>..HEAD`, to know what is
   going out. Modified paths that are not this release's are another session's:
   list them and ask once whether they ship (`.claude/rules/shared-tree.md`).
   That list is read from the tree, never asked of sessions: a session's "done"
   is not a landing, and the release cuts what `main` holds. An unlanded
   `topic/*` branch does not ship: list each one to the owner once, from
   `git branch --list "topic/*" --no-merged main`. Run the toolchain
   check, the one push-triggered gate no later step covers:
   `node C:\Proj\acks-module-template\bin\sync-toolchain.mjs --check` (zero
   drift against the template's pushed `main`, which is what CI checks out —
   TOOLCHAIN §9). `ls .github/workflows` says what else fires on the push;
   step 4's clone gate covers the Release workflow's build and validate, and
   step 6's gate covers the docs site. A gate that genuinely cannot run locally
   is what step 10 is for; step 10 firing on anything runnable here means this
   step was skipped.
2. **Bump and compile.** Read `git tag --sort=-v:refname | head -3` first: an
   open CHANGELOG heading reserves nothing, and a peer may have shipped the
   number it names. Set `version` in `module.json` to the release day,
   `YYYY.M.D`, with `.N` for a later release that day (the preflight prints the
   day's next version and refuses any other). Compile the changelog:
   `node tools/logs.mjs compile --label "<stage>"` writes the version's section
   from `changelog.d/` and deletes the fragments. On a major,
   `node tools/logs.mjs roll` runs first; then the reviewer rules the flagged
   index rows and each ROADMAP is re-issued. On a major or minor every Added and
   Changed bullet names its shot as it is written, in its fragment (TOOLCHAIN
   §4b).
3. **Preflight at the bump.** `node tools/release-preflight.mjs --kind <kind>
   --live-pending` — a red result stops the release. It lists the walks and the
   `docs/<feature>/TESTING.md` recipes for the surfaces changed since the last
   tag (a changed surface with no recipe means writing the recipe IS part of
   this release), the shots still to take and the release folder not yet linked;
   its header carries every check.
4. **The release commit.** Shut the world down, then `npm run build:packs`
   (the junction's deploy to the test world, not a gate; commit `packs/_source`
   if it changed). Land the release commit through **`acks-commit`**,
   `land --no-push`, subject `Release <version> (<kind>) — …`: `module.json`,
   `CHANGELOG.md`, the removed fragments under `removed`, `packs/_source`, a
   major's roll output, and any fix released with it (a fix that is released at
   once rides this commit, so one gate covers both). Its clone gate runs
   `build:packs`, `validate` and `test` on the release's own tree; a run in the
   working tree reads every session's in-flight hunks, so only this one counts.
   A release takes no carried base: a commit that lands under the gate means the
   gate runs again.
5. **Walk.** Launch the world. `git status --porcelain` must name nothing
   outside `docs/`: a runtime path there is a peer's writer in the live window
   (`.claude/rules/shared-tree.md`), so stop and ask. Run `npm test` once on the
   working tree, with the runner's working-tree flag where it has one: the
   gitignored local-only rules suites exist only in the working tree, and this is
   their one run. **Live-verify. This is a GO-LIVE GATE** (TOOLCHAIN §4a: no
   waiver, so a machine without `C:\Proj\acks-rules\TEST_ENVIRONMENT.md` stops
   here and the report says so); the procedure — environment, fixtures built once
   and kept, real player seats, pre-upgrade shapes, what to report — is
   `.claude/rules/live-testing.md`. Run the walks step 3 listed:
   `node tools/live/run.mjs <walk…>`. A defect is fixed through `acks-commit`
   and walked again, or the non-pass is classified:
   `node tools/live/run.mjs --classify <walk> <T-id> defect|world-state|stale-walk|environment`
   (a `defect` ships only when its row is `deferred`). Quote the preflight's walk
   table under "exercised live".
6. **The docs commit**, in this same live session while the world is up: the
   shots the kind calls for, `docs/GALLERY.md` and the guides (TOOLCHAIN §4b:
   what to capture, where it lives, how to compose and clip a frame). Capture
   with `acks-module-template/bin/foundry-capture.mjs` to
   `docs/releases/v<version>/<feature-slug>.png`; machine-specific values live in
   `TEST_ENVIRONMENT.md`. A major removes the orphan shot folders `roll` listed,
   once the new shots are linked. Land it through `acks-commit`, `land --no-push`,
   with `"gate": ["node docs/site/tools/sync.mjs"]` where the repo has
   `docs/site/`, else `"gate": []`; the PNGs go under `added`, a removed folder's
   files under `removed`. Skipped for a hotfix with no shots: the tag then goes on
   step 4's commit.
7. **Preflight on the commit.** With the world still up:
   `node tools/release-preflight.mjs --kind <kind> --at <sha>`, `<sha>` the docs
   commit, or the release commit where there is no docs commit. It judges that
   commit and takes no `--live-pending`: a shot the changelog names and the
   commit lacks, a required walk not run or not current, an unlinked shot folder
   and a version a peer has published since step 2 each stop the release here. A
   published version moves the release to the day's next: edit `module.json` and
   the changelog heading, land that again through step 4's route (the docs that
   name the old version move with it), and run this step again.
8. **Tag and push.** Tag `<sha>`, step 7's, exactly `v<module.json version>`, and
   push that sha with its tag in one motion:
   `git tag v<version> <sha> && git push --atomic origin <sha>:refs/heads/<branch> refs/tags/v<version>`
   (CI fails the release if tag and manifest version differ. Never `--tags`: it
   pushes every tag the clone holds.)
   - If the remote rejects the push with a server error
     (`! [remote rejected] … (Internal Server Error)`, an HTTP 5xx): GitHub
     failed, not the release, and it can do so while its reads, its API and
     its status page all answer. Do not look for a local cause first. The
     push is atomic, so nothing is published; read both refs once to
     confirm it:
     `git ls-remote origin refs/heads/<branch> refs/tags/v<version>`
     Then repeat the push alone (the tag is made, and the line above would
     stop at `git tag`) every ~90s for at most ~15 minutes, in the
     background as step 9 polls. Read both refs before each attempt and
     push only while they read as they first did: a tag there on `<sha>`
     is an attempt that landed, and a `<branch>` that moved is the case
     below. Never push the branch and the tag apart to get one through: a
     remote failing writes is where one can land without the other. Any
     other reading, and any other refusal, ends the loop.
   - If the bound is reached: stop. The release commits and the tag are
     local and origin holds none of them. The checkpoint and the report say
     so, with what both refs read, the attempts and the remote's lines, and
     give the one command that completes the release: that push, written
     out. Undo nothing and bump nothing: the gate holds for that tree, and
     the preflight would refuse this release's own tag.
   - If a peer pushed `<branch>` above `<sha>` before the tag landed: origin
     already holds the commit (`git fetch -q --tags origin`, then
     `git branch -r --contains <sha>` names `origin/<branch>`), and the atomic
     push is refused as a non-fast-forward. Only the tag is left, and it goes
     alone: `git push origin refs/tags/v<version>`
     If step 2's read now shows a later version, stop and report instead:
     an older release is not published behind a newer one. The companion
     workflows ran on the peer's push, so step 10 reads them at the sha
     origin's `<branch>` holds as well as at `<sha>`.
9. **Confirm the release published** — **bounded checks only, never
   `gh run watch`** (it blocks forever through GitHub API outages, which
   happen). Poll with your harness's non-blocking waiting (background
   until-loop or Monitor with a timeout), checking
   `gh release view v<version> --json assets` every ~30s for at most ~5
   minutes. The workflow itself takes ~30s when healthy.
   - If the API returns 5xx: GitHub is down, not the release. The tag is
     pushed; CI fires or finishes on its own. Report "published pending
     API recovery" and STOP — do not wait out an outage.
   - If the run genuinely failed: read the log and fix the cause through
     `acks-commit`; the release goes out as the day's next version.
10. **Check EVERY workflow the push triggered, not only Release** — the
    BACKSTOP to step 1, which already ran what could run here. A release push
    also fires the repo's companion workflows (Toolchain check, Docs site, …),
    and "assets published" says nothing about them: a red companion on the
    release commit is a red release to anyone looking at the repo, and it stays
    red on every later push until someone acts. One bounded call, on the tagged
    commit and with its full 40-character sha (`HEAD` may be a peer's commit by
    now, and a short sha returns an empty list that reads as nothing having run):
    `gh run list --repo NocTempre/<repo> --commit $(git rev-parse <sha>)`
    Every run must end `success`; an empty list is a query that missed, never
    a pass. A failure is YOURS to resolve in this session: read its log
    (`gh run view <id> --log-failed`), fix the cause, push the fix, and
    re-check — or, if the check itself is wrong, fix the check in its canonical
    home (template workflows sync from acks-module-template). Never report the
    release done over a red run without saying exactly which run is red and why.
11. **Verify the manifest** resolves with the new version (bounded, `-m 15`):
    `curl -sm 15 -L https://github.com/NocTempre/<repo>/releases/latest/download/module.json`
    `<repo>` is the GitHub repo name, which is NOT the module id — the merged
    repo is `foundryvtt-acks-extras` (id `acks-extras`). If the repo has been
    taken private (e.g. IP quarantine), the URL 404s unauthenticated — use
    `gh release view` instead and note it. A major, once verified published,
    then rolls the bug ledger: its closed rows move to
    `ledger-through-v<version>.csv` (see `acks-bug-triage`).
12. **Report:** release kind, version, release URL, the release commit's and the
    docs commit's shas, the status of every triggered workflow, the snapshots
    captured (and any obligation you could not meet, with the reason), and
    anything skipped. The shape is `.claude/rules/live-testing.md` step 6's:
    exercised live, checked offline only, not checked, and what the release left
    stale. Each status is quoted from the command that returned it.

Never force-push tags over a published release (TOOLCHAIN §4, "Release
discipline").

There is no release-cadence rule: ship whenever the gates pass, as often as
the work warrants. The quality control is the preflight's recipe walk, not a
waiting period (TOOLCHAIN §4 "Release discipline").
