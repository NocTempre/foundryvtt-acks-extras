---
name: acks-release
description: Cut a major, minor or hotfix release of an ACKS module repo (version bump, live gate, release snapshots, tag, CI watch, manifest verification). Use when the user asks to release/publish/tag an acks-* module, or names a release kind such as "major release".
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

The CI procedure itself lives in acks-module-template's
`release-module.yml` (reusable workflow) — module `release.yml` files are thin
synced callers; never edit either in a module repo. A pre-flight dry run of
the full pipeline (build + validate, no publish) is available anytime:
`gh workflow run Release --repo NocTempre/<repo> --ref main`

1. Preflight: working tree clean (or only the changes being released);
   `git log origin/<branch>..HEAD` to know what's going out.
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
2. Bump `version` in `module.json` (plain semver X.Y.Z). Update `CHANGELOG.md`
   if the repo has one.
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
6. Commit (snapshots and `docs/GALLERY.md` included), then tag exactly
   `v<module.json version>` and push branch + tag:
   `git tag v<X.Y.Z> && git push origin <branch> --tags`
   (CI fails the release if tag and manifest version differ.)
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
   looked). One bounded call:
   `gh run list --repo NocTempre/<repo> --commit $(git rev-parse HEAD)`
   Every run must end `success`. A failure is YOURS to resolve in this
   session: read its log (`gh run view <id> --log-failed`), fix the cause,
   push the fix, and re-check — or, if the check itself is wrong, fix the
   check in its canonical home (template workflows sync from
   acks-module-template). Never report the release done over a red run
   without saying exactly which run is red and why.
8. Verify the manifest resolves with the new version (bounded, `-m 15`):
   `curl -sm 15 -L https://github.com/NocTempre/<repo>/releases/latest/download/module.json`
   `<repo>` is the GitHub repo name, which is NOT always the module id — the
   merged repos are `foundryvtt-acks-extras` / `foundryvtt-acks-importer`
   (ids `acks-extras` / `acks-importer`). The repos are public (since
   2026-08); if one has been taken private (e.g. IP quarantine), the URL
   404s unauthenticated — use `gh release view` instead and note it.
9. Report: release kind, version, release URL, the status of every triggered
   workflow, the snapshots captured (and any obligation you could not meet,
   with the reason), and anything skipped.

Never force-push tags over a published release; cut a new patch version
instead.
