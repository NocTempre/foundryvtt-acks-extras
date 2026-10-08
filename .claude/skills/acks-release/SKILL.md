---
name: acks-release
description: Cut a major, minor or hotfix release of an ACKS module repo (version bump, live gate, release snapshots, tag, CI watch, manifest verification), or pick up one that was cut off part-way. Use when the user asks to release/publish/tag an acks-* module, names a release kind such as "major release", or says to continue, resume or retry a release.
model: sonnet
effort: high
---

Release procedure for any NocTempre `acks-*` module (canonical definition:
`C:\Proj\acks-module-template\docs\TOOLCHAIN.md` §4). Work inside the module
repo; confirm with the user which repo if not stated.

**First, establish the release kind — ask if it is not stated.** The kind is
declared, never derived from the version number, and it decides what you have
to capture on screen:

| Kind | Snapshot obligation (§4b, step 5a below) |
|---|---|
| **Major** | Full gallery refresh — re-shoot **every** feature area, changed or not |
| **Minor** | Changed features only — one shot per user-visible changelog entry |
| **Hotfix** | None, unless the fix is UI-visible *and* the user asks |

**A major release is always explicit.** Never infer one from a large diff, a
long changelog, or a `1.0.0`-looking bump — ask. Everything else in this
procedure is identical for all three kinds: a hotfix does not skip the live
gate.

**A release states rules too** — step 2's changelog entries and step 5's
capture captions both assert what the book says. Verify before asserting, in
`.claude/rules/rules-lookup.md`'s order (snapshot → local extracts and
`DECISIONS.md` → PDF last). Cite book/chapter/section; the snapshot is
LOCAL-ONLY and its paths never appear in a changelog, a commit message or a
tag.

**Keep a checkpoint, and resume from what the world says.** A release often
outlasts its session: a limit lands between the commit and the push, or after
the tag and before the checks. As each step below ends, append one line to
`C:\Proj\acks-rules\release-checkpoints\<repo>-v<X.Y.Z>.md` (LOCAL-ONLY, beside
the intake ledger; the session's scratch space where that shelf is absent):
the step, its result, the output line that shows it, `HEAD`, and from step 6
the gated tree id and the release commit's sha.

Told to continue, resume or try again, read the checkpoint and then
**establish each fact again before acting on it**. It records what a session
believed, and a peer may have committed, tagged or published since:

| Question | Read |
|---|---|
| Is the version still free, or already this release? | `git fetch -q --tags origin`, then `git tag -l v<X.Y.Z>` and `git ls-remote --tags origin v<X.Y.Z>` |
| Is the release committed, and is it the gated tree? | `git log --oneline -8`; `git rev-parse <sha>^{tree}` against the checkpoint |
| Is the commit on origin? | `git branch -r --contains <sha>` |
| Did every workflow pass? | step 7a's call |
| Is it published, and does the manifest resolve? | step 7's and step 8's calls |

Resume at the first step the world does not confirm. A step the checkpoint
claims and the world does not show is done again, and the report says so. A
gate result holds for the tree id it was recorded against and no other. With
no checkpoint at all, the same table says where the release stands. Remove
the checkpoint once step 9's report is written.

The CI procedure itself lives in acks-module-template's
`release-module.yml` (reusable workflow) — module `release.yml` files are thin
synced callers; never edit either in a module repo. A pre-flight dry run of
the full pipeline (build + validate, no publish) is available anytime:
`gh workflow run Release --repo NocTempre/<repo> --ref main`

1. Preflight: working tree clean (or only the changes being released);
   `git log origin/<branch>..HEAD` to know what's going out. Modified paths
   that are not this release's are another session's: list them and ask once
   whether they ship (`.claude/rules/shared-tree.md`).
   **Run every push-triggered workflow's gate locally NOW, before anything
   is tagged** — discovering a red companion after publishing means doing
   the fix anyway, plus a wasted CI round-trip and a permanently red release
   commit. `ls .github/workflows` says what will fire; the local equivalents:
   - Toolchain check → `node C:\Proj\acks-module-template\bin\sync-toolchain.mjs --check`
     (zero drift, with the template's `main` already pushed — TOOLCHAIN §9).
   - Docs site (repos that have `docs/site/`) → the staging gate is
     `node docs/site/tools/sync.mjs`; repos wire it into `npm run validate`
     (validate-extra), so a green validate already covers it.
   - Release → steps 3–4 below are its build+validate, run locally.
   A gate that genuinely cannot run locally is what step 7a is for; 7a
   firing on anything runnable here means this step was skipped.
2. Read `git tag --sort=-v:refname | head -3` first: an open CHANGELOG
   heading reserves nothing, and a peer may have shipped the number it names.
   Bump `version` in `module.json` (plain semver X.Y.Z). Update `CHANGELOG.md`
   if the repo has one. **Then run `node tools/release-preflight.mjs` — a red
   result stops the release.** It reads the bumped version, refuses a tag
   that already exists (never retag; bump a new patch instead), and lists the
   `docs/<feature>/TESTING.md` recipes for every surface changed since the
   last tag — step 5 walks exactly those recipes, and a changed surface with
   no recipe means writing the recipe IS part of this release.
3. `npm run build:packs`. Compiled packs are gitignored build output — commit
   `packs/_source` if it changed; there is no timestamp churn to discard
   (pack `_stats` stamps are fixed, so a diff means content really changed).
4. `npm run validate` and, if a `test` script exists, `npm test`. Both must
   pass — fix, don't skip.
5. **Live-verify on the local test server. This is a GO-LIVE GATE**, not an
   optional extra — offline checks run against mocked globals and have
   shipped dead modules green. The canonical procedure (environment, the
   create-and-destroy fixture discipline, real player seats, pre-upgrade
   shapes, what to report) is `.claude/rules/live-testing.md` — follow it.
   Skip only when `C:\Proj\acks-rules\TEST_ENVIRONMENT.md` is absent (no
   test server on this machine), and say so in the report.
5a. **Capture the release snapshots the kind calls for (TOOLCHAIN §4b) — in
   this same live session, before you shut the world down.** A shot staged
   later proves nothing about the release. Skip only for a hotfix with no
   requested shot, or where §4a itself was skipped for want of a test server.
   - Save to `docs/releases/v<X.Y.Z>/<feature-slug>.png` (PNG, cropped to the
     window, ~300 KB ceiling). A previous release's directory may be rewritten
     where its surface changed; a minor never re-captures surfaces its
     changes did not touch.
   - Update `docs/GALLERY.md`: rewrite **every** row on a major release, only
     the re-shot rows on a minor. Rows left pointing at an older version are
     the staleness record — that is intended, not an oversight to tidy.
   - Point the camera at the disposable fixtures you built for step 5; a
     fixture named for what it demonstrates makes the better guide image.
   - **Clip to the app window.** That keeps world id, user name and server URL
     out of frame by construction — Foundry paints them into the players
     panel, settings tab and title bar. Book-derived text showing up
     incidentally in a feature's UI is fine and needs no working around; just
     don't make a page of imported prose the subject of a shot.
   - **Compose the frame**: close every other application and clear
     notifications before shooting, and again after creating the fixture —
     other modules' onboarding dialogs open over the subject and document
     writes raise toasts into the crop.
   - Capture with `acks-module-template/bin/foundry-capture.mjs` (headless
     Chromium over CDP, clips to one element's box). Your own browser pane
     **cannot** screenshot here — it composites frames only while displayed,
     so it times out in any backgrounded session. Machine-specific values live
     in `TEST_ENVIRONMENT.md`. If a shot is unreachable, name it in the report
     rather than skipping it silently.
6. Commit through **`acks-commit`** (snapshots and `docs/GALLERY.md`
   included). Its gate runs steps 3–4 again on the release's own tree in a
   clone, which is the tree CI will build; step 4's run in the working tree
   read every session's in-flight hunks. A release takes no carried base: a
   commit that lands under the gate means the gate runs again.
   Then run `node tools/release-preflight.mjs` once more, immediately before
   the tag: a peer may have published the number since step 2, and the answer
   is the next patch. Tag the release commit's own sha, exactly
   `v<module.json version>`, and push that sha with its tag in one motion:
   `git tag v<X.Y.Z> <sha> && git push --atomic origin <sha>:refs/heads/<branch> refs/tags/v<X.Y.Z>`
   (CI fails the release if tag and manifest version differ. Never
   `--tags`: it pushes every tag the clone holds.)
   - If the remote rejects the push with a server error
     (`! [remote rejected] … (Internal Server Error)`, an HTTP 5xx): GitHub
     failed, not the release, and it can do so while its reads, its API and
     its status page all answer. Do not look for a local cause first. The
     push is atomic, so nothing is published; read both refs once to
     confirm it:
     `git ls-remote origin refs/heads/<branch> refs/tags/v<X.Y.Z>`
     Then repeat the push alone (the tag is made, and the line above would
     stop at `git tag`) every ~90s for at most ~15 minutes, in the
     background as step 7 polls. Read both refs before each attempt and
     push only while they read as they first did: a tag there on `<sha>`
     is an attempt that landed, and a `<branch>` that moved is the case
     below. Never push the branch and the tag apart to get one through: a
     remote failing writes is where one can land without the other. Any
     other reading, and any other refusal, ends the loop.
   - If the bound is reached: stop. The release commit and its tag are
     local and origin holds neither. The checkpoint and the report say so,
     with what both refs read, the attempts and the remote's lines, and
     give the one command that completes the release: that push, written
     out. Undo nothing and bump nothing: the gate holds for that tree, and
     the preflight would refuse this release's own tag.
   - If a peer pushed `<branch>` above the release commit before the tag
     landed: origin already holds the commit (`git fetch -q --tags origin`,
     then `git branch -r --contains <sha>` names `origin/<branch>`), and
     the atomic push is refused as a non-fast-forward. Only the tag is
     left, and it goes alone:
     `git push origin refs/tags/v<X.Y.Z>`
     If step 2's read now shows a later version, stop and report instead:
     an older release is not published behind a newer one. The companion
     workflows ran on the peer's push, so 7a reads them at the sha origin's
     `<branch>` holds as well as at the release commit's.
7. Confirm the release published — **bounded checks only, never
   `gh run watch`** (it blocks forever through GitHub API outages, which
   happen; 2026-07-16 stranded several agents this way). Poll with your
   harness's non-blocking waiting (background until-loop or Monitor with a
   timeout), checking `gh release view v<X.Y.Z> --json assets` every ~30s
   for at most ~5 minutes. The workflow itself takes ~30s when healthy.
   - If the API returns 5xx: GitHub is down, not the release. The tag is
     pushed; CI fires or finishes on its own. Report "published pending
     API recovery" and STOP — do not wait out an outage.
   - If the run genuinely failed: read the log, fix, delete the tag
     locally+remotely only if the release never published, and retry.
7a. **Check EVERY workflow the push triggered, not only Release — as the
   BACKSTOP to preflight step 1, which already ran these gates locally.** A
   release push also fires the repo's companion workflows (Toolchain check,
   Docs site, …), and "assets published" says nothing about them — a red
   companion on the release commit is a red release to anyone looking at
   the repo, and it stays red on every later push until someone acts
   (2026-08-14: the extras Docs site failed on every push for a day because
   a new guide was never added to the site sidebar, and no release session
   looked). One bounded call, on the release commit and with its full
   40-character sha (`HEAD` may be a peer's commit by now, and a short sha
   returns an empty list that reads as nothing having run):
   `gh run list --repo NocTempre/<repo> --commit $(git rev-parse <sha>)`
   Every run must end `success`; an empty list is a query that missed, never
   a pass. A failure is YOURS to resolve in this
   session: read its log (`gh run view <id> --log-failed`), fix the cause,
   push the fix, and re-check — or, if the check itself is wrong, fix the
   check in its canonical home (template workflows sync from
   acks-module-template). Never report the release done over a red run
   without saying exactly which run is red and why.
8. Verify the manifest resolves with the new version (bounded, `-m 15`):
   `curl -sm 15 -L https://github.com/NocTempre/<repo>/releases/latest/download/module.json`
   `<repo>` is the GitHub repo name, which is NOT the module id — the merged
   repo is `foundryvtt-acks-extras` (id `acks-extras`). The repo is public
   (since 2026-08); if it has been taken private (e.g. IP quarantine), the URL
   404s unauthenticated — use `gh release view` instead and note it.
9. Report: release kind, version, release URL, the status of every triggered
   workflow, the snapshots captured (and any obligation you could not meet,
   with the reason), and anything skipped. The shape is
   `.claude/rules/live-testing.md` step 6's: exercised live, checked offline
   only, not checked, and what the release left stale. Each status is quoted
   from the command that returned it.

Never force-push tags over a published release; cut a new patch version
instead.

There is no release-cadence rule: ship whenever the gates pass, as often as
the work warrants. The quality control is the preflight's recipe walk, not a
waiting period (TOOLCHAIN §4 "Release discipline").
