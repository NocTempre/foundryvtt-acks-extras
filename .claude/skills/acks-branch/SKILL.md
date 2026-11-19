---
name: acks-branch
description: Open, land, sync, park and close a topic branch kept in a sibling worktree, in an acks-* repo. Use when a new feature starts or its next slice lands (`.claude/rules/shared-tree.md`, "Topic and parked branches"), when the user says "open a branch", "land the branch", "sync the branch", "park this", "close the topic", or when the Stop hook lists a topic as landed and open. Not for a fix, docs or a release's own commits, which are written in main's tree (acks-commit), and not a release (acks-release).
---

`branch.mjs`, beside this file, carries out every command; its header is the
reference. Run it from any checkout of the repository, as
`node .claude/skills/acks-branch/branch.mjs <mode> <slug> ...`. A slug is
`^[a-z0-9][a-z0-9-]{0,40}$`.

Which work takes a branch is `.claude/rules/shared-tree.md`, "Topic and
parked branches": a new feature does, and a fix, docs and a release's own
commits are written in `main`'s tree. A topic lands once per slice and stays
open between landings: the Stop hook lists it as landed and open, `sync <slug>`
before the next slice brings in what `main` gained, and `close` follows once
the feature is walked. `land` refuses a topic with nothing new.

## The five commands

- `open <slug>`: `topic/<slug>` at `main`, in the sibling folder
  `<repo>.<slug>`, with `main`'s `node_modules` linked in. Start the session in
  that folder and commit there by hand.
- `land <slug> [--wait <minutes>] [--change <dir>] [--despite-release <version>]`: the session that wrote the
  topic lands it. It rebases an unpushed topic onto `main` in its worktree and
  stops at the first conflict (resolve, `git rebase --continue`, land again),
  takes the landing lease, rebases once more where `main` moved while it waited,
  runs `commit-own-hunks.mjs postgate` on the tip from `main`'s root with the
  lease's heartbeat beating, fast-forwards `main` and reads `HEAD` back. It
  refuses a dirty worktree, a topic on `origin`, staged changes in `main`'s
  index, and a lease lost or a `main` moved during the gate; it never carries
  and never pushes. `--change` is a
  change directory whose `change.json` names the gate where the repo's
  `package.json` does not. While `main`'s `module.json` holds a version with no
  local tag `v<version>` (a release's live window, in a repository that has
  tagged before) it refuses, with exit 6, a topic whose runtime tree differs
  from `main`'s, checked after the rebase and again under the lease; a topic
  that changes only what the zip leaves out lands. `--despite-release <version>`
  passes an abandoned release's window and stands for the owner's word; it is
  refused (exit 1) where the window is another version's or closed. Exit
  statuses: 0 done, 1 refused, 2 usage, 3 main moved or the lease was lost
  (land again), 5 the lease was still held when `--wait` ran out, 6 the release
  window.
- `sync <slug>`: brings `main` into a topic's worktree between landings, as a
  rebase onto `main` that stops at the first conflict (resolve, `git add`,
  `git rebase --continue` finishes the sync). A topic that already holds `main`
  is left as it is and a contained one fast-forwards. It refuses a dirty
  worktree, a stopped rebase, a worktree not on `topic/<slug>` and a topic on
  `origin`; it takes no lease and never touches `main`.
- `close <slug> [--discard-unmerged]`: removes a landed topic's worktree and
  branch. It unlinks every top-level link in the worktree first and refuses to
  remove while one stands, because `git worktree remove` on Windows deletes
  through a junction and empties `main`'s `node_modules`; afterwards it checks
  that folder survived and prints the `npm install` that restores it where not.
  A removal that fails on a locked folder is retried with a backoff. Where git
  had already stripped the worktree, the links stay out and the refusal names
  the folder as safe to delete once released; `close` run again over the gone
  worktree unlinks and removes what it left, or reports the folder still
  locked. An unmerged topic is dropped only with the flag, which stands for the owner's
  word.
- `park <slug> [--at <rev>] [--push]`: `parked/<slug>`, no worktree. Without
  `--push` it prints the command; `--push` pushes it once, on the owner's
  go-ahead, and refuses a branch already on origin. A parked branch is never
  synced and never built by CI. A topic is never pushed.

What the standing approval covers, how a rebase conflict is resolved, and
that a worktree folder is never deleted by hand are
`.claude/rules/shared-tree.md`, "Topic and parked branches".

## What a worktree lacks

Every gitignored file, since git copies none into a new worktree:
`node_modules` (the tool links `main`'s), compiled packs (run `build:packs`
there), `aia-tmp/`, `settings.local.json`, pipeline state, and the Foundry
junction.

The Stop hook (`unpushed-report.mjs`) lists unmerged topics, topics landed and
open, parked branches not on origin, and any other local branch.
