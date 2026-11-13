---
name: acks-branch
description: Open, land, park and close a topic branch kept in a sibling worktree, in an acks-* repo. Use when a track of work qualifies for a branch (`.claude/rules/shared-tree.md`, "Topic and parked branches"), when the user says "open a branch", "land the branch", "park this", "close the topic", or when the Stop hook lists a topic as landed and still open. Not for work that is walked live before it is finished, and not a release (acks-release).
---

`branch.mjs`, beside this file, carries out every command; its header is the
reference. Run it from any checkout of the repository, as
`node .claude/skills/acks-branch/branch.mjs <mode> <slug> ...`. A slug is
`^[a-z0-9][a-z0-9-]{0,40}$`.

A track goes on a branch only when the three-part test in
`.claude/rules/shared-tree.md`, "Topic and parked branches", holds; otherwise
it is written in `main`'s tree.

## The four commands

- `open <slug>`: `topic/<slug>` at `main`, in the sibling folder
  `<repo>.<slug>`, with `main`'s `node_modules` linked in. Start the session in
  that folder and commit there by hand.
- `land <slug> [--wait <minutes>] [--change <dir>]`: the session that wrote the
  topic lands it. It rebases an unpushed topic onto `main` in its worktree and
  stops at the first conflict (resolve, `git rebase --continue`, land again),
  takes the landing lease, runs `commit-own-hunks.mjs postgate` on the tip from
  `main`'s root, fast-forwards `main` and reads `HEAD` back. It refuses a dirty
  worktree, a topic on `origin`, staged changes in `main`'s index, and a base
  that moved under the gate; it never carries and never pushes. `--change` is a
  change directory whose `change.json` names the gate where the repo's
  `package.json` does not.
- `close <slug> [--discard-unmerged]`: removes a landed topic's worktree and
  branch. It unlinks every top-level link in the worktree first and refuses to
  remove while one stands, because `git worktree remove` on Windows deletes
  through a junction and empties `main`'s `node_modules`; afterwards it checks
  that folder survived and prints the `npm install` that restores it where not.
  An unmerged topic is dropped only with the flag, which stands for the owner's
  word.
- `park <slug> [--at <rev>] [--push]`: `parked/<slug>`, no worktree. Without
  `--push` it prints the command; `--push` pushes it once, on the owner's
  go-ahead, and refuses a branch already on origin. A parked branch is never
  synced and never built by CI. A topic is never pushed.

What the standing approval covers, how a rebase conflict is resolved, and
that a worktree folder is never deleted by hand are
`.claude/rules/shared-tree.md`, "Topic and parked branches".

## What a worktree lacks

`node_modules` (the tool links `main`'s), compiled packs (run `build:packs`
there), `aia-tmp/`, `settings.local.json`, and the Foundry junction.

The Stop hook (`unpushed-report.mjs`) lists unmerged topics, topics landed and
still open, parked branches not on origin, and any other local branch.
