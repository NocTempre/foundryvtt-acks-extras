---
name: acks-release
description: Cut a release of an ACKS module repo (version bump and release commit, smoke walk, tag, CI check, manifest verification), or pick up one that was cut off part-way. Use when the user asks to release/publish/tag an acks-* module, or says to continue, resume or retry a release.
model: sonnet
effort: high
---

Release procedure for any NocTempre `acks-*` module. There is one release
path and no release kind; the release shape (one commit and a tag) and what a
release owes are `docs/TOOLCHAIN.md` §4, and the smoke-walk gate is §4a. This
file holds the steps and their commands. Work inside the module repo; confirm
with the user which repo if not stated.

**A release owes no documentation.** No screenshot, guide step or gallery row
is taken or written here; those are tasks of their own, done when the owner
asks. What a release owes a reader is step 2's changelog, where each bullet
says where its feature is found.

**A release states rules too**: step 2's changelog entries assert what the
book says. Verify before asserting, in `.claude/rules/rules-lookup.md`'s order
(snapshot → local extracts and `DECISIONS.md` → PDF last). Cite
book/chapter/section; the snapshot is LOCAL-ONLY and its paths never appear in
a changelog, a commit message or a tag.

**Keep a checkpoint, and resume from what the world says.** A release can
outlast its session: a limit lands between the release commit and the smoke
walk, or after the tag and before the checks. As each step below ends, append
one line to `C:\Proj\acks-rules\release-checkpoints\<repo>-v<version>.md`
(LOCAL-ONLY, beside the intake ledger; the session's scratch space where that
shelf is absent): the step, its result, the output line that shows it, `HEAD`,
and from step 4 the gated tree id and the release commit's sha.

Told to continue, resume or try again, read the checkpoint and then
**establish each fact again before acting on it**. It records what a session
believed, and a peer may have committed, tagged or published since:

| Question | Read |
|---|---|
| Is the version still free, or already this release? | `git fetch -q --tags origin`, then `git tag -l v<version>` and `git ls-remote --tags origin v<version>` |
| Is the release commit landed, and is it the gated tree? | `git log --oneline -8`; `git rev-parse <sha>^{tree}` against the checkpoint |
| Is the runtime still the one the smoke walk ran on? | step 6's preflight run |
| Is the commit on origin? | `git branch -r --contains <sha>` |
| Did every workflow pass? | step 9's call |
| Is it published, and does the manifest resolve? | step 8's and step 10's calls |

Resume at the first step the world does not confirm. An interrupted release
resumes under the same version; an abandoned one costs the day's next version.
A step the checkpoint claims and the world does not show is done again, and the
report says so. A gate result holds for the tree id it was recorded against and
no other. With no checkpoint at all, the same table says where the release
stands. Remove the checkpoint once step 11's report is written.

The CI procedure itself is `.github/workflows/release.yml`. A pre-flight dry run of
the full pipeline (build + validate, no publish) is available anytime:
`gh workflow run Release --repo NocTempre/<repo> --ref main`

1. **Orient.** `git status` and `git log origin/<branch>..HEAD`, to know what is
   going out. Modified paths that are not this release's are another session's:
   list them and ask once whether they ship (`.claude/rules/shared-tree.md`).
   That list is read from the tree, never asked of sessions: a session's "done"
   is not a landing, and the release cuts what `main` holds. What a
   `topic/*` branch has not landed does not ship: list each open topic to
   the owner once, from `git branch --list "topic/*"`, and say which have
   slices on `main` already. `--no-merged main` names the topics holding
   unlanded commits; one it leaves out may be between two landings.
   `ls .github/workflows` says what fires on the push: step 4's clone gate
   covers the Release workflow's build and validate, and `toolchain-tests.yml`
   fires only where the push touches the toolchain, whose suites
   (`tools/toolchain-tests/`) run here singly. A gate that genuinely cannot run
   locally is what step 9 is for; step 9 firing on anything runnable here means
   this step was skipped.
2. **Bump and compile.** Read `git tag --sort=-v:refname | head -3` first: an
   open CHANGELOG heading reserves nothing, and a peer may have shipped the
   number it names. Set `version` in `module.json` to the release day,
   `YYYY.M.D`, with `.N` for a later release that day (the preflight prints the
   day's next version and refuses any other). Read the Added and Changed
   fragments in `changelog.d/` once: a bullet that names a feature says where
   it is found, as a path in the vocabulary of
   `.claude/rules/docs-doctrine.md`, taken from the code or a guide and never
   composed. Then compile: `node tools/logs.mjs compile` writes the version's
   section from the fragments and deletes them.
3. **Preflight at the bump.** `node tools/release-preflight.mjs --live-pending`
   — a red result stops the release. It lists the smoke walk as still to run
   and notes each changed surface that has no `docs/<feature>/TESTING.md`; its
   header carries every check.
4. **The release commit.** Shut the world down, then `npm run build:packs`
   (the junction's deploy to the test world, not a gate; commit `packs/_source`
   if it changed). Land the release commit through **`acks-commit`**,
   `land --no-push`, subject `Release <version> — …`: `module.json`,
   `CHANGELOG.md`, the removed fragments under `removed`, `packs/_source`, and
   any fix released with it (a fix that is released at once rides this commit,
   so one gate covers both). Its clone gate runs `build:packs`, `validate` and
   `test` on the release's own tree; a run in the working tree reads every
   session's in-flight hunks, so only this one counts. A release takes no
   carried base: a commit that lands under the gate means the gate runs again.
5. **Smoke.** Launch the world. `git status --porcelain` must name no runtime
   path: one there is a peer's writer in the live window
   (`.claude/rules/shared-tree.md`), so stop and ask. Run `npm test` once on
   the working tree, in the background, carrying
   `# full-gate-ok: release smoke` so the full-gate hook passes it: the
   gitignored local-only rules suites exist only in the working tree, and this
   is their one run. **This is the GO-LIVE
   GATE** (TOOLCHAIN §4a: no waiver, so a machine without
   `C:\Proj\acks-rules\TEST_ENVIRONMENT.md` stops here and the report says so);
   the environment and its seats are `.claude/rules/live-testing.md`. Run the
   smoke walk from a real load, with the recorder attached before `init`:
   `node tools/live/run.mjs window-contract`. It is the only walk a release
   runs. A thrown error is a defect: fix it through `acks-commit`, walk the
   surface that threw, and run the smoke walk again on the new tree. A
   non-pass that is the walk's own fault is classified, never repaired in a
   loop:
   `node tools/live/run.mjs --classify window-contract <T-id> defect|world-state|stale-walk|environment`
   (a `defect` ships only when its row is `deferred`).
6. **Preflight on the commit.** With the world still up:
   `node tools/release-preflight.mjs --at <sha>`, `<sha>` the release commit.
   It judges that commit and takes no `--live-pending`: a smoke walk not run or
   not current on that commit's runtime tree and a version a peer has published
   since step 2 each stop the release here. A published version moves the
   release to the day's next: edit `module.json` and the changelog heading,
   land that again through step 4's route, and run steps 5 and 6 again.
7. **Tag and push, on the owner's go-ahead** (TOOLCHAIN §2). Tag `<sha>`, step
   6's, exactly `v<module.json version>`, and push that sha with its tag in one
   motion:
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
     background as step 8 polls. Read both refs before each attempt and
     push only while they read as they first did: a tag there on `<sha>`
     is an attempt that landed, and a `<branch>` that moved is the case
     below. Never push the branch and the tag apart to get one through: a
     remote failing writes is where one can land without the other. Any
     other reading, and any other refusal, ends the loop.
   - If the bound is reached: stop. The release commit and the tag are
     local and origin holds neither. The checkpoint and the report say
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
     workflows ran on the peer's push, so step 9 reads them at the sha
     origin's `<branch>` holds as well as at `<sha>`.
8. **Confirm the release published** — **bounded checks only, never
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
9. **Check EVERY workflow the push triggered, not only Release** — the
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
   re-check — or, if the check itself is wrong, fix the check
   (`.github/workflows/`). Never report the
   release done over a red run without saying exactly which run is red and why.
10. **Verify the manifest** resolves with the new version (bounded, `-m 15`):
    `curl -sm 15 -L https://github.com/NocTempre/<repo>/releases/latest/download/module.json`
    `<repo>` is the GitHub repo name, which is NOT the module id — the merged
    repo is `foundryvtt-acks-extras` (id `acks-extras`). If the repo has been
    taken private (e.g. IP quarantine), the URL 404s unauthenticated — use
    `gh release view` instead and note it.
11. **Report:** version, release URL, the release commit's sha, the status of
    every triggered workflow, and anything skipped. The shape is
    `.claude/rules/live-testing.md` step 6's: exercised live (the smoke walk's
    row, quoted from the preflight), checked offline only, not checked, and what
    the release left stale: a guide step or a screenshot the release's changes
    outdated is named here and left for the owner's documentation ask. Each
    status is quoted from the command that returned it.

Never force-push tags over a published release (TOOLCHAIN §4, "Release
discipline").

There is no release-cadence rule: ship whenever the gates pass, as often as
the work warrants (TOOLCHAIN §4 "Release discipline").
