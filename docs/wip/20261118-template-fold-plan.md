# Plan: fold acks-module-template into this repo

> **Adopted 2026-11-18.** This plans cut C1 of `20261118-overhead-cuts-proposal.md`, which holds
> the evidence. The owner: "Yes, plan it", then "Implement". The fold is built on its topic now
> and stops before its land. This file is deleted when the fold lands.

## What the fold is

It moves here what this repo runs, and deletes the machinery that copied it. No gate changes what
it checks. Cuts C2 and C3 follow as their own changes, so a failure after the fold has one cause.
Files are copied from a template commit the phase records at its start; no history is merged.

## Before the build, and before the land

1. **C1 is adopted; C4 is not answered.** All 14 suites therefore move. A later yes to C4 deletes
   the shared-tree ones.
2. **Both repos are clean and level, checked 2026-11-18:** the template is at `a85dd50`, clean and
   pushed; this repo's sync of it is committed (`2503d48e`) with no drift; `main` is level with
   `origin`. The phase checks this again and records the template commit it copies from. A canon
   change that lands in the template after that commit is synced here first and re-copied.
3. **The land waits for the owner.** The minor is not tagged, and the owner ruled on 2026-11-17:
   "Minor release is after all are merged." The fold is no part of that minor, so it lands after
   the tag unless the owner says sooner, and never inside a release's live window.
4. **The land takes a quiet window.** The fold edits hooks that act on every session in `main`'s
   tree. Six topic worktrees are open; each is synced or closed after the land.

## Where each piece lands

| In the template | Here |
|---|---|
| `.claude/` skills, rules, hooks, agents, `settings.json` | Already here. They become this repo's own, and "synced, never hand-edit" goes. |
| `skeleton/tools/`: validate, ip-scan, ip-quarantine, release-preflight, logs, walk-results, build-packs; `.githooks/pre-commit` | Already here, same. |
| `bin/foundry-capture.mjs` | `tools/live/_capture.mjs`. `_driver.mjs` loads it; `ACKS_CAPTURE_DRIVER` stays as an override. |
| 14 suites in `bin/` that test the tools above | `tools/toolchain-tests/test-*.mjs`, which `run-tests.mjs` does not find, so they stay out of every land's gate as they are today. One sequential run on 2026-11-18, with other sessions working, took 1,648 s; five suites passed 60 s (commit-own-hunks 559, release-preflight 277, branch 257, shared-tree-hooks 202, ip-quarantine 67). A change to a tool runs the suite that covers it. |
| The template's `ci.yml`, which runs those suites on its pushes | `.github/workflows/toolchain-tests.yml` here, on a push that touches `.claude/`, `.githooks/`, the tools the suites cover or the suites. It replaces `ci.yml` and `toolchain-check.yml`; nothing runs that did not run before. |
| `release-module.yml` | Inlined into `.github/workflows/release.yml`. |
| `docs/TOOLCHAIN.md`, `docs/LICENSING.md` | `docs/`, same names. TOOLCHAIN keeps its section numbers, since 31 files here cite them. |
| `docs/DECISIONS.md` (74 entries, 63 marked in force) | Not copied. `docs/DECISIONS.md` here gains one index row per in-force entry, naming the template's final commit. New toolchain rulings are entries here. |

**Deleted, each with the text that names it:** `sync-toolchain.mjs`, `new-module.mjs`, the
skeleton's scaffold files, `manifest.mjs`, their three suites (sync, new-module, pre-commit),
`nightly.mjs` with its mention in `delegation.md`, `toolchain-check.yml`, the skills
`acks-sync-toolchain` and `acks-new-module`, TOOLCHAIN §9 and the multi-repo half of §0.

**Paths that run code from the template today** (a missed one keeps running the old copy, since
the template's folder stays on disk): `tools/live/_driver.mjs`, `.claude/hooks/unpushed-report.mjs`,
a permission in `.claude/settings.json`, three commands in `acks-hygiene-sweep/SKILL.md`, one in
`acks-release/SKILL.md`, and both workflows.

**Not touched: `scripts/`.** Six runtime files carry a comment naming the template or TOOLCHAIN.
One changed byte there makes every walk result stale, so each is corrected by the next runtime
change to its file.

## Slices

One phase, on `topic/template-fold` (worktree `foundryvtt-acks-extras.template-fold`): several
commits, nothing walked until the end, one land.

| Slice | Who, and why | Observable |
|---|---|---|
| **F1 Move in.** Copy the capture driver and the suites; rewrite their paths from `skeleton/tools/` and the template root to this repo. | `implementer`: mechanical, with an exact check. | Each moved suite prints its pass line in the worktree, and `node tools/ip-scan.mjs` passes there. |
| **F2 Workflows.** Inline the release workflow; delete the drift workflow; add `toolchain-tests.yml`; `test-walk-results` reads `release.yml`. | `implementer`: same. | `test-walk-results` passes, and each suite the new workflow names exists. |
| **F3 Text.** `CLAUDE.md`, rules, skills, agents and hook headers stop naming the template; TOOLCHAIN and LICENSING move; the DECISIONS index and one entry that supersedes the sync and scaffold rulings, listed from the template's own headings. | `scout` lists the pointers; the phase session writes the text, since it is doctrine and `doc-scribe` does not edit doctrine. | `git grep acks-module-template` returns only the DECISIONS and CHANGELOG history, the index rows and the six runtime comments. |
| **F4 Land and prove, on the owner's word.** `acks-branch land`, which is the one full gate. | The phase session. | In a fresh clone with no template beside it, the moved suites pass. On `main`, one walk starts with `ACKS_CAPTURE_DRIVER` unset. |
| **F5 Retire.** The template's README and `CLAUDE.md` say it is retired and name the commit here; the local folder stays as a read-only archive. `TEST_ENVIRONMENT.md` and the session memory's pointers are corrected. | The phase session, after the owner's steps below. | The template's last commit is pushed. |

**The owner's steps, in order:** confirm `toolchain-check` is not a required status check on
`main`; give the push; run the Release workflow by hand, which is a dry run that builds and
validates and publishes nothing; on a green run, give the word to retire; archive the template's
GitHub repository.

Until F5 the template is untouched, and the fold here is one range of commits that reverts.

## Start prompt

> Read `docs/wip/20261118-template-fold-plan.md` and the proposal it names. Check item 2 of
> "Before the build" against the repos as they are now, and stop with a report if it does not
> hold. Record the template commit you copy from. Open `topic/template-fold` with `acks-branch`
> and run F1 to F3 with the agents the table names, each slice checked by the suites it touches.
> Do not land: stop with the topic built, and report what F4 and F5 need from the owner. Change no
> gate's behaviour.
